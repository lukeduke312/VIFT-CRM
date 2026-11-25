/**
 * F-002 SERVER-SIDE ENFORCEMENT — PATCH MODULE for `invoice-write`
 * (2026-11-12). NOT a deployed file and NOT the real `invoice-write/index.ts`.
 *
 * The real `invoice-write` Edge Function source is NOT in this repository
 * (it lives in the workspace that deploys the Edge Functions). This module
 * was written against the most recent reference copy available to this
 * engagement (`invoice-write/index.ts`, 253 lines, sha256
 * 784e7f0223f7e475c1ce0cb63c963a4f5065a6c9863dc72f4234b442c529bb0b,
 * from the 2026-11-03 LIVE_FINAL_PACKAGE_V2–V6 packages). Whoever holds the real source must diff it against
 * that reference before merging. See SPEC_f002_server_enforcement_2026-11-12.md
 * (same directory) for the full spec, the three hunks to apply to index.ts,
 * the residual race and the optional airtight SQL follow-up.
 *
 * Deliberately self-contained (no remote imports) so it can be copied next
 * to index.ts as `stale-override.ts` and imported:
 *
 *   import { handleApproveStaleOverride, guardSendAgainstStalePrice,
 *            stripClientStaleOverrides } from './stale-override.ts'
 *
 * Every rule below MIRRORS the client (src/services/InvoiceService.js:
 * staleFixedPriceLines(), staleDiscrepancySnapshot(), latestStaleOverride(),
 * staleOverrideStatus(), approveStaleLineOverride(), setStatus()) and is
 * enforced independently — no client-supplied staleness flag or snapshot
 * is ever trusted. Parity is tested in
 * _staging_integration/tests/test_f002_server_patch_parity_2026-11-12.js.
 *
 * NO SQL / NO SCHEMA CHANGE: `staleOverrides` is an extra key on the
 * invoice object inside the existing `public.store` row `vift_invoices`
 * (JSONB). `Schema.invoice()` (src/data/schema.js) does not declare it —
 * invoices are free-form JSONB, same as `revision`/`sourceAware`, which
 * are not declared there either.
 */

// deno-lint-ignore-file no-explicit-any
type Json = Record<string, any>
/** The service-role supabase-js client index.ts already creates. */
type SupabaseLike = any
type JsonFn = (body: unknown, status?: number) => Response

// ── Constants (must equal InvoiceService.STALE_OVERRIDE_*_JUSTIFICATION) ──
export const STALE_OVERRIDE_MIN_JUSTIFICATION = 10
export const STALE_OVERRIDE_MAX_JUSTIFICATION = 2000
const MAX_OVERRIDE_LINES = 500
const OVERRIDE_ID_RE = /^[A-Za-z0-9_-]{8,100}$/
// Statuses from which 'skickad' is an allowed transition — must equal
// invoice_set_status()'s v_allowed table ('utkast' → skickad,
// 'förfallen' → skickad) and the client's getAllowedStatusTransitions().
const SENDABLE_FROM = new Set(['utkast', 'förfallen'])

export interface StaleItem {
  lineId: string
  workOrderId: string
  lineUnitPrice: number
  aoFixedPrice: number
}

// ════════════════════════════════════════════════════════════════════
// 1. Pure staleness rules (exact port of the client logic)
// ════════════════════════════════════════════════════════════════════

/** = InvoiceService.staleFixedPriceLines() + staleDiscrepancySnapshot().
 *  `workOrders` is the FULL server-side `vift_workOrders` array (the
 *  client only sees the AOs its view scope returns — the server is
 *  therefore stricter, never looser; see spec §2.3). */
export function staleDiscrepancySnapshot(inv: Json | null, workOrders: Json[]): StaleItem[] {
  if (!inv || !Array.isArray(inv.lines)) return []
  const aos = Array.isArray(workOrders) ? workOrders : []
  const out: StaleItem[] = []
  for (const l of inv.lines as Json[]) {
    const ref = (Array.isArray(l?.sourceRefs) ? l.sourceRefs : [])
      .find((r: Json) => r && r.sourceType === 'fixed' && r.workOrderId)
    if (!ref) continue
    const ao = aos.find((a: Json) => a && a.id === ref.workOrderId)
    if (!ao) continue
    const aoPrice = Number(ao.fixedPrice)
    if (!Number.isFinite(aoPrice) || aoPrice <= 0) continue
    if (Number(l.unitPrice) === aoPrice) continue
    out.push({
      lineId: String(l.id),
      workOrderId: String(ref.workOrderId),
      lineUnitPrice: Number(l.unitPrice),
      aoFixedPrice: aoPrice,
    })
  }
  return out.sort((a, b) => (a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0))
}

/** = InvoiceService.latestStaleOverride(): ONLY the last entry counts. */
export function latestStaleOverride(inv: Json | null): Json | null {
  const arr = inv && Array.isArray(inv.staleOverrides) ? inv.staleOverrides : []
  return arr.length ? arr[arr.length - 1] : null
}

function itemMatches(o: Json, item: StaleItem): boolean {
  return !!o &&
    String(o.lineId) === item.lineId &&
    String(o.workOrderId) === item.workOrderId &&
    Number(o.lineUnitPrice) === item.lineUnitPrice &&
    Number(o.aoFixedPrice) === item.aoFixedPrice
}

/** = InvoiceService.staleOverrideStatus(). `covered` is true ONLY if there
 *  is at least one discrepancy AND the latest override has an exact match
 *  for every currently-stale line. */
export function staleOverrideStatus(inv: Json | null, workOrders: Json[]) {
  const stale = staleDiscrepancySnapshot(inv, workOrders)
  const override = latestStaleOverride(inv)
  const covers = (item: StaleItem) =>
    !!override && Array.isArray(override.lines) && override.lines.some((o: Json) => itemMatches(o, item))
  const uncovered = stale.filter((it) => !covers(it))
  const covered = stale.length > 0 && uncovered.length === 0
  return { stale, override, covered, uncovered, supersededOverride: !!override && stale.length > 0 && !covered }
}

/** Approval-time check: the client's `override.lines` must describe EXACTLY
 *  the current server-side discrepancy — same set, no missing and no extra
 *  entries. (Stricter than `covers` on purpose: an approval is a statement
 *  about one concrete discrepancy, so a snapshot with extra/foreign lines
 *  is rejected instead of being silently trimmed.) */
export function snapshotMatchesExactly(current: StaleItem[], clientLines: unknown): boolean {
  if (!Array.isArray(clientLines) || clientLines.length !== current.length) return false
  const used = new Set<number>()
  for (const item of current) {
    const i = clientLines.findIndex((o, idx) => !used.has(idx) && itemMatches(o as Json, item))
    if (i === -1) return false
    used.add(i)
  }
  return true
}

// ════════════════════════════════════════════════════════════════════
// 2. Store helpers (service-role client; public.store key/value/updated_at)
// ════════════════════════════════════════════════════════════════════

async function readStoreRow(supabase: SupabaseLike, key: string): Promise<{ ok: boolean; value: any; updatedAt: string | null }> {
  const { data, error } = await supabase.from('store').select('value, updated_at').eq('key', key).maybeSingle()
  if (error) return { ok: false, value: null, updatedAt: null }
  return { ok: true, value: data ? data.value : null, updatedAt: data ? data.updated_at : null }
}

/** Compare-and-swap on the whole store row: succeeds only if NO other
 *  writer touched the row since it was read. Every existing writer of
 *  vift_invoices / vift_activityLog (all invoice_* RPCs, ActivityService
 *  via store-key-write) sets `updated_at`, so an unchanged `updated_at`
 *  means an unchanged value. Returns false on conflict (0 rows updated). */
async function casWriteStoreRow(supabase: SupabaseLike, key: string, value: unknown, readUpdatedAt: string | null, nowIso: string): Promise<boolean> {
  let q = supabase.from('store').update({ value, updated_at: nowIso }).eq('key', key)
  q = readUpdatedAt === null ? q.is('updated_at', null) : q.eq('updated_at', readUpdatedAt)
  const { data, error } = await q.select('key')
  if (error) { console.error('[invoice-write] CAS-skrivning misslyckades för', key, ':', error.message); return false }
  return Array.isArray(data) && data.length === 1
}

function parseRev(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || Math.floor(v) !== v) return null
  return v
}

function hasPermLocal(perms: string[], perm: string): boolean {
  return Array.isArray(perms) && (perms.includes('all') || perms.includes(perm))
}

/** Best-effort activity-log prepend with up to 3 CAS attempts. The
 *  approval itself is ALREADY committed when this runs; failing here only
 *  means the response carries `activityLog: null` and the client falls
 *  back to its own local ActivityService.log() (existing client branch). */
async function prependActivity(supabase: SupabaseLike, entry: Json, nowIso: string): Promise<Json[] | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await readStoreRow(supabase, 'vift_activityLog')
    if (!row.ok) return null
    const log = Array.isArray(row.value) ? row.value : []
    const next = [entry, ...log]
    if (row.value === null && row.updatedAt === null) {
      const { error } = await supabase.from('store').insert({ key: 'vift_activityLog', value: next, updated_at: nowIso })
      if (!error) return next
      continue // someone created it concurrently — retry as CAS
    }
    if (await casWriteStoreRow(supabase, 'vift_activityLog', next, row.updatedAt, nowIso)) return next
  }
  return null
}

// ════════════════════════════════════════════════════════════════════
// 3. action 'approveStaleOverride'
// ════════════════════════════════════════════════════════════════════
/**
 * Request (exactly what InvoiceService.approveStaleLineOverride() sends via
 * _call(); expectedRevision is added by _call() because the action is in
 * its revisionActions list):
 *   { action: 'approveStaleOverride', invoiceId, expectedRevision,
 *     idempotencyKey, override: { id, approvedById, approvedByName,
 *     approvedAt, justification, lines: StaleItem[] } }
 * approvedById/approvedByName/approvedAt from the client are IGNORED —
 * the server derives them from the JWT-resolved staff member and its clock.
 *
 * 200 { invoice, activityLog: Json[] | null, serverSignature }
 *     (replay of an already-stored override.id: same shape + replayed:true)
 * 400 missing_fields | invalid_justification
 * 403 forbidden                      (lacks invoice_create AND admin_manage)
 * 404 not_found
 * 409 stale_write                    (revision mismatch or CAS conflict)
 *     invalid_transition             (invoice not in utkast/förfallen)
 *     no_stale_discrepancy           (nothing to approve server-side)
 *     stale_snapshot_mismatch        (+ currentStale: StaleItem[])
 * 503 stale_check_unavailable        (store read failed — fail closed)
 */
export async function handleApproveStaleOverride(
  supabase: SupabaseLike, body: Json, perms: string[], staffMember: Json, json: JsonFn,
): Promise<Response> {
  // index.ts has already required invoice_create for every action; checked
  // again here so the module is safe on its own.
  if (!hasPermLocal(perms, 'invoice_create') || !hasPermLocal(perms, 'admin_manage')) {
    return json({ error: 'forbidden' }, 403)
  }
  const invoiceId = String(body.invoiceId ?? '').trim()
  const expectedRevision = parseRev(body.expectedRevision)
  const override = body.override
  if (!invoiceId || expectedRevision === null || !override || typeof override !== 'object' || Array.isArray(override)) {
    return json({ error: 'missing_fields' }, 400)
  }
  const overrideId = typeof override.id === 'string' ? override.id : ''
  if (!OVERRIDE_ID_RE.test(overrideId)) return json({ error: 'missing_fields' }, 400)
  if (!Array.isArray(override.lines) || override.lines.length > MAX_OVERRIDE_LINES) {
    return json({ error: 'missing_fields' }, 400)
  }
  const justification = typeof override.justification === 'string' ? override.justification.trim() : ''
  if (justification.length < STALE_OVERRIDE_MIN_JUSTIFICATION || justification.length > STALE_OVERRIDE_MAX_JUSTIFICATION) {
    return json({ error: 'invalid_justification' }, 400)
  }

  const invRow = await readStoreRow(supabase, 'vift_invoices')
  if (!invRow.ok) return json({ error: 'stale_check_unavailable' }, 503)
  const invoices: Json[] = Array.isArray(invRow.value) ? invRow.value : []
  const idx = invoices.findIndex((i) => i && i.id === invoiceId)
  if (idx === -1) return json({ error: 'not_found' }, 404)
  const inv = invoices[idx]

  // Idempotent replay BEFORE the revision check: a duplicate delivery of a
  // request that already succeeded (revision has since moved on) must
  // return the stored result, not a spurious stale_write.
  const existing = Array.isArray(inv.staleOverrides) ? inv.staleOverrides : []
  if (existing.some((o: Json) => o && o.id === overrideId)) {
    return json({ invoice: inv, activityLog: null, replayed: true, serverSignature: new Date().toISOString() })
  }

  const currentRevision = parseRev(inv.revision ?? 0) ?? 0
  if (currentRevision !== expectedRevision) return json({ error: 'stale_write' }, 409)
  if (!SENDABLE_FROM.has(String(inv.status ?? ''))) return json({ error: 'invalid_transition' }, 409)

  const woRow = await readStoreRow(supabase, 'vift_workOrders')
  if (!woRow.ok) return json({ error: 'stale_check_unavailable' }, 503)
  const workOrders: Json[] = Array.isArray(woRow.value) ? woRow.value : []

  const st = staleOverrideStatus(inv, workOrders)
  if (!st.stale.length) return json({ error: 'no_stale_discrepancy' }, 409)
  if (!snapshotMatchesExactly(st.stale, override.lines)) {
    return json({ error: 'stale_snapshot_mismatch', currentStale: st.stale }, 409)
  }

  const nowIso = new Date().toISOString()
  const callerStaffId = String(staffMember?.id ?? '')
  const approvedByName = `${staffMember?.firstName ?? ''} ${staffMember?.lastName ?? ''}`.trim()
  const entry = {
    id: overrideId,
    approvedById: callerStaffId,             // server-derived, never client
    approvedByName,                          // server-derived, never client
    approvedAt: nowIso,                      // server clock, never client
    justification,
    lines: st.stale.map((x) => ({ ...x })), // SERVER-computed snapshot
    idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey.slice(0, 100) : null,
  }

  // P1-1 fix (2026-11-16): commit through a SECURITY DEFINER RPC instead of
  // a raw service-role table UPDATE. The raw UPDATE used before (CAS via
  // casWriteStoreRow on vift_invoices) runs as the EF's own PostgREST role,
  // which the live `_protect_critical_store_keys()` trigger blocks for
  // anything other than `postgres` — every attempt therefore updated 0 rows
  // and was indistinguishable from a genuine CAS conflict, so this action
  // always answered 409 stale_write regardless of expectedRevision. The RPC
  // (owned by postgres, same pattern as sensitive_fields_write/I5) performs
  // the SAME idempotent-replay check, revision check, and atomic write, now
  // inside the one role the trigger allows. See
  // 20261116000001_f002_stale_override_commit_atomic.sql.
  const { data: commitData, error: commitErr } = await supabase.rpc('invoice_stale_override_approve_commit', {
    p_invoice_id: invoiceId,
    p_expected_revision: expectedRevision,
    p_entry: entry,
  })
  if (commitErr) {
    const msg = String(commitErr.message ?? '')
    if (msg.includes('stale_write')) return json({ error: 'stale_write' }, 409)
    if (msg.includes('stale_snapshot_mismatch')) return json({ error: 'stale_snapshot_mismatch' }, 409)
    if (msg.includes('no_stale_discrepancy')) return json({ error: 'no_stale_discrepancy' }, 409)
    if (msg.includes('invalid_transition')) return json({ error: 'invalid_transition' }, 409)
    if (msg.includes('not_found')) return json({ error: 'not_found' }, 404)
    console.error('[invoice-write] invoice_stale_override_approve_commit RPC-fel:', msg)
    return json({ error: 'stale_check_unavailable' }, 503)
  }
  if (commitData?.replayed) {
    return json({ invoice: commitData.invoice, activityLog: null, replayed: true, serverSignature: nowIso })
  }
  const newInv = commitData.invoice

  const activityLog = await prependActivity(supabase, {
    id: 'ACT-' + nowIso.replace(/[-:.TZ]/g, '') + '-' + crypto.randomUUID().slice(0, 6),
    type: 'invoice_stale_override_approved',
    description: `Prisavvikelse på ${invoiceId} godkänd av ${approvedByName || 'okänd'}: ${justification}`,
    timestamp: nowIso,
    customerId: String(inv.customerId ?? ''),
    propertyId: '', workOrderId: '', offerId: '',
    invoiceId, salesOpportunityId: '', inspectionId: '', ronderingId: '', deviationId: '',
    userId: callerStaffId,
  }, nowIso)

  try {
    await supabase.from('store').upsert({ key: 'vift_lastChanged', value: nowIso, updated_at: nowIso })
  } catch (_e) { /* best-effort, same as the RPCs' lastChanged bump */ }

  return json({ invoice: newInv, activityLog, serverSignature: nowIso })
}

// ════════════════════════════════════════════════════════════════════
// 4. Guard for action 'setStatus' → 'skickad'
// ════════════════════════════════════════════════════════════════════
/**
 * Call from the existing setStatus branch, AFTER its own input validation
 * and BEFORE supabase.rpc('invoice_set_status'), only when status ===
 * 'skickad'. Returns a Response to send (refusal) or null (proceed).
 *
 * 409 { error: 'stale_price_unapproved', staleLineIds, uncovered,
 *       supersededOverride }   — no mutation, RPC never called
 * 503 { error: 'stale_check_unavailable' } — store read failed (fail closed)
 * null — no discrepancy, or every stale line exactly covered by the LATEST
 *        override; also null when the invoice is missing or its revision
 *        differs from expectedRevision (the RPC then returns its own
 *        not_found / stale_write, keeping ONE source of truth for those).
 *
 * Why the revision makes the invoice side safe: the RPC re-checks
 * p_expected_revision under its row lock, so ANY invoice change (lines,
 * overrides) between this read and the RPC makes the RPC fail stale_write.
 * The one residual window is the AO price (vift_workOrders) changing in
 * the milliseconds between this read and the RPC — see spec §5.
 */
export async function guardSendAgainstStalePrice(
  supabase: SupabaseLike, invoiceId: string, expectedRevision: number, json: JsonFn,
): Promise<Response | null> {
  const invRow = await readStoreRow(supabase, 'vift_invoices')
  if (!invRow.ok) return json({ error: 'stale_check_unavailable' }, 503)
  const invoices: Json[] = Array.isArray(invRow.value) ? invRow.value : []
  const inv = invoices.find((i) => i && i.id === invoiceId)
  if (!inv) return null
  if ((parseRev(inv.revision ?? 0) ?? 0) !== expectedRevision) return null
  const woRow = await readStoreRow(supabase, 'vift_workOrders')
  if (!woRow.ok) return json({ error: 'stale_check_unavailable' }, 503)
  const workOrders: Json[] = Array.isArray(woRow.value) ? woRow.value : []
  const st = staleOverrideStatus(inv, workOrders)
  if (st.stale.length && !st.covered) {
    return json({
      error: 'stale_price_unapproved',
      staleLineIds: st.uncovered.map((x) => x.lineId),
      uncovered: st.uncovered,
      supersededOverride: st.supersededOverride,
    }, 409)
  }
  return null
}

// ════════════════════════════════════════════════════════════════════
// 5. appendChecked hardening (forged-approval vector)
// ════════════════════════════════════════════════════════════════════
/** invoice_append_checked() does not allowlist top-level invoice keys, so
 *  without this a client could CREATE an invoice that already carries a
 *  fabricated `staleOverrides` entry. Strip it; overrides can only ever
 *  be added through handleApproveStaleOverride(). */
export function stripClientStaleOverrides(invoice: Json): Json {
  if (!invoice || typeof invoice !== 'object') return invoice
  const { staleOverrides: _dropped, ...rest } = invoice
  return rest
}
