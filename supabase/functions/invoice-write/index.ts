/**
 * invoice-write — Supabase Edge Function
 * (P0 FINAL INTEGRATION — INVOICE CORRECTION — consolidates the
 * earlier, narrower `invoice-set-status` function into one dispatcher,
 * same style as `rondering-pass-write`, covering EVERY atomic
 * vift_invoices write path: setStatus, lineAdd, lineUpdate, lineDelete,
 * draftDelete, discountSet, taxReductionSet, metaUpdate, appendChecked.
 *
 * See supabase/migrations/20261018000003_invoice_set_status_atomic_rpc.sql
 * and 20261018000004_invoice_lines_and_create_atomic_rpc.sql, and —
 * R9B TEST 9 (oberoende granskad dataförlust, ronda 3) —
 * supabase/migrations_phase1_additive/20261024000001_invoice_revision_conflict_control.sql,
 * som lägger till en OBLIGATORISK `p_expected_revision`-parameter på
 * lineUpdate/lineDelete/draftDelete/discountSet/taxReductionSet/
 * metaUpdate/setStatus. Denna fil skickar nu `expectedRevision` vidare
 * till RPC:n för var och en av dem, och validerar den HÄR (innan RPC-
 * anropet) så att ett ogiltigt/saknat värde ger ett tydligt
 * `missing_fields`-fel istället för ett ospecifikt Postgres-typfel.
 *
 * Auth: checkViftAuth() + invoice_create (same permission the client
 * already required for every one of these operations).
 *
 * T3-B (2026-11-28, D-07, punkt 269/G9): ny åtgärd `aoBilling` — den ENDA vägen
 * att sätta eller backa en AO:s faktureringsstatus (status 'fakturerad', invoiceId,
 * billingPreviousStatus). patch_ao avvisar de fälten för alla roller
 * (403 forbidden/invoice_path_required). RPC:n work_order_billing_set kontrollerar
 * under lås att underlaget finns, inte är makulerat och hänvisar till AO:n.
 *
 * POST /functions/v1/invoice-write
 * body: { action: '...', ...fields }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'  // pinned 2026-11-12 = version bundled in deployed v6
import { checkViftAuth, hasPerm, aoRuleError, projectWorkOrder } from '../_shared/vift-auth.ts'
import { handleApproveStaleOverride, guardSendAgainstStalePrice, stripClientStaleOverrides } from './stale-override.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control':                'no-store, no-cache',
  'Referrer-Policy':              'no-referrer',
  'X-Content-Type-Options':       'nosniff',
  'X-Frame-Options':              'DENY'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const VALID_STATUSES = new Set(['utkast', 'skickad', 'betald', 'förfallen', 'makulerad'])

/* R9B TEST 9 (ronda 3): `expectedRevision` måste vara ett icke-negativt
   heltal — `null`/`undefined`/en sträng/ett negativt tal avvisas HÄR,
   med ett tydligt `missing_fields`, innan RPC:n ens anropas (RPC:ns
   egen parameter är nu OBLIGATORISK utan default — ett ogiltigt värde
   skulle annars bara ge ett rått Postgres-typfel, inte ett hanterbart
   API-svar). Returnerar `null` om ogiltigt. */
function parseExpectedRevision(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || Math.floor(v) !== v) return null
  return v
}

function mapRpcError(error: { message?: string } | null): Response | null {
  if (!error) return null
  const msg = String(error.message || '')
  if (msg.includes('stale_write'))         return json({ error: 'stale_write' }, 409)
  // P0-2/N2 historical key cutover, tombstones and stale-key refusal.
  if (msg.includes('legacy_idempotency_key_retired')) return json({ error: 'legacy_idempotency_key_retired' }, 409)
  if (msg.includes('idempotency_key_consumed_deleted')) return json({ error: 'idempotency_key_consumed_deleted' }, 409)
  if (msg.includes('idempotency_key_stale_or_reassigned')) return json({ error: 'idempotency_key_stale_or_reassigned' }, 409)
  // A3a: authoritative SQL guard on send, inside invoice_set_status.
  if (msg.includes('stale_price_unapproved')) return json({ error: 'stale_price_unapproved' }, 409)
  if (msg.includes('stale_check_unavailable')) return json({ error: 'stale_check_unavailable' }, 503)
  if (msg.includes('invalid_status'))      return json({ error: 'invalid_status' }, 400)
  if (msg.includes('invalid_transition'))  return json({ error: 'invalid_transition' }, 409)
  if (msg.includes('source_collision'))    return json({ error: 'source_collision' }, 409)
  /* T4-B (D-10, R20, R21, SÄK-6, VK-1): källraderna prövas mot sina källor i invoice_append_checked
     och okänt pris stoppar utskick i invoice_set_status. */
  if (msg.includes('price_unknown'))           return json({ error: 'price_unknown' }, 409)
  if (msg.includes('price_mismatch'))          return json({ error: 'price_mismatch' }, 409)
  if (msg.includes('included_in_fixed_price')) return json({ error: 'included_in_fixed_price' }, 409)
  if (msg.includes('source_not_billable'))     return json({ error: 'source_not_billable' }, 409)
  if (msg.includes('performed_date_required')) return json({ error: 'performed_date_required' }, 409)
  if (msg.includes('source_not_found'))        return json({ error: 'source_not_found' }, 409)
  if (msg.includes('not_draft'))           return json({ error: 'not_draft' }, 409)
  if (msg.includes('line_not_found'))      return json({ error: 'line_not_found' }, 404)
  if (msg.includes('not_found'))           return json({ error: 'not_found' }, 404)
  /* R9B TEST 9 (oberoende granskning, ronda 6, Blockerare 3): RPC:ernas
     nya server-sidiga fält-allowlist/sanity-validering (se migrationen)
     ska ge ett tydligt 400-svar, inte ett generiskt 500. */
  if (msg.includes('forbidden_field'))        return json({ error: 'forbidden_field' }, 400)
  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 2): skydd mot
     manipulerat/dubblerat rad-id i invoice_line_add. */
  if (msg.includes('duplicate_line_id'))      return json({ error: 'duplicate_line_id' }, 409)
  if (msg.includes('invalid_line_id'))        return json({ error: 'invalid_line_id' }, 400)
  if (msg.includes('invalid_qty'))            return json({ error: 'invalid_qty' }, 400)
  if (msg.includes('invalid_price'))          return json({ error: 'invalid_price' }, 400)
  if (msg.includes('invalid_vat'))            return json({ error: 'invalid_vat' }, 400)
  if (msg.includes('invalid_discount_type'))  return json({ error: 'invalid_discount_type' }, 400)
  if (msg.includes('invalid_discount_value')) return json({ error: 'invalid_discount_value' }, 400)
  if (msg.includes('invalid_tax_type'))       return json({ error: 'invalid_tax_type' }, 400)
  if (msg.includes('invalid_tax_amount'))     return json({ error: 'invalid_tax_amount' }, 400)
  if (msg.includes('invalid_tax_basis'))      return json({ error: 'invalid_tax_basis' }, 400)
  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 3): den fulla
     server-sidiga finansiella invarianten (se migrationen). */
  if (msg.includes('financial_invariant_violation')) return json({ error: 'financial_invariant_violation' }, 400)
  /* R9B FINAL (sista oberoende granskningen, punkt 2): invoice_append_checked's
     nya indatavalidering (se migrationen). */
  if (msg.includes('invalid_source_ref'))     return json({ error: 'invalid_source_ref' }, 400)
  if (msg.includes('duplicate_source_key'))   return json({ error: 'duplicate_source_key' }, 409)
  console.error('[invoice-write] RPC-fel:', msg)
  return json({ error: 'update_failed' }, 500)
}

/* T3-D (2026-11-28, B4): aktivitetsloggen i svaret projiceras med samma regel som
   store-key-write:s läsningar (vift_store_project). Standardrollerna med invoice_create har
   ao_view_all och får hela loggen; en egen roll med bara invoice_create får urvalet per post.
   Misslyckas projektionen lämnas loggen bort (null; klienten läser då om), aldrig oprojicerad.
   approveStaleOverride kräver admin_manage (skrivrätt till loggen = hela loggen). */
// deno-lint-ignore no-explicit-any
async function projectActivityLog(supabase: any, log: unknown, perms: string[], callerStaffId: string): Promise<unknown> {
  if (!Array.isArray(log)) return log ?? null
  const r = await supabase.rpc('vift_store_project', { p_key: 'vift_activityLog', p_value: log, p_perms: perms, p_caller_staff_id: callerStaffId })
  if (r.error) { console.error('[invoice-write] projektion av activityLog:', r.error.message); return null }
  return r.data ?? null
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return json({ error: 'forbidden' }, 403)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const auth = await checkViftAuth(supabase, jwt, CORS)
  if (!auth.ok) return auth.response
  const { perms, staffMember } = auth
  if (!hasPerm(perms, 'invoice_create')) return json({ error: 'forbidden' }, 403)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const sm = staffMember as Record<string, unknown>
  const callerStaffId = String(sm?.id ?? '')
  const action = String(body.action ?? '')

  if (action === 'setStatus') {
    const invoiceId = String(body.invoiceId ?? '').trim()
    const status    = String(body.status ?? '')
    const expectedRevision = parseExpectedRevision(body.expectedRevision)
    if (!invoiceId || expectedRevision === null) return json({ error: 'missing_fields' }, 400)
    if (!VALID_STATUSES.has(status)) return json({ error: 'invalid_status' }, 400)
    if (status === 'skickad') {
      const refusal = await guardSendAgainstStalePrice(supabase, invoiceId, expectedRevision, json)
      if (refusal) return refusal
    }
    const { data, error } = await supabase.rpc('invoice_set_status', {
      p_invoice_id: invoiceId, p_status: status, p_expected_revision: expectedRevision, p_actor_id: callerStaffId
    })
    const err = mapRpcError(error); if (err) return err
    const r = (data || {}) as Record<string, unknown>
    return json({ invoice: r.invoice, prevStatus: r.prevStatus, changed: r.changed, activityLog: await projectActivityLog(supabase, r.activityLog, perms, callerStaffId), serverSignature: r.serverSignature })
  }

  if (action === 'approveStaleOverride') {
    return await handleApproveStaleOverride(supabase, body, perms, staffMember as Record<string, unknown>, json)
  }

  if (action === 'lineAdd') {
    const invoiceId = String(body.invoiceId ?? '').trim()
    const line = body.line
    /* R9B FINAL (slutlig komplettering, "inga missade skrivvägar" —
       Blockerare 1): invoice_line_add ÄNDRAR en BEFINTLIG faktura
       (fogar in en rad i dess `lines`) — till skillnad från
       invoice_append_checked (som skapar en helt NY faktura), är den
       alltså INTE konfliktfri. `expectedRevision` är nu OBLIGATORISK,
       samma NULL-fail-closed-princip som för lineUpdate/lineDelete
       ovan — se migrationen för den nya RPC-signaturen. */
    const expectedRevision = parseExpectedRevision(body.expectedRevision)
    if (!invoiceId || !line || typeof line !== 'object' || expectedRevision === null) {
      return json({ error: 'missing_fields' }, 400)
    }
    const { data, error } = await supabase.rpc('invoice_line_add', {
      p_invoice_id: invoiceId, p_line: line, p_expected_revision: expectedRevision
    })
    const err = mapRpcError(error); if (err) return err
    return json({ invoice: (data || {}).invoice, serverSignature: (data || {}).serverSignature })
  }

  if (action === 'lineUpdate') {
    const invoiceId = String(body.invoiceId ?? '').trim()
    const lineId = String(body.lineId ?? '').trim()
    const patch = body.patch
    const expectedRevision = parseExpectedRevision(body.expectedRevision)
    if (!invoiceId || !lineId || !patch || typeof patch !== 'object' || expectedRevision === null) {
      return json({ error: 'missing_fields' }, 400)
    }
    const { data, error } = await supabase.rpc('invoice_line_update', {
      p_invoice_id: invoiceId, p_line_id: lineId, p_patch: patch, p_expected_revision: expectedRevision
    })
    const err = mapRpcError(error); if (err) return err
    return json({ invoice: (data || {}).invoice, serverSignature: (data || {}).serverSignature })
  }

  if (action === 'lineDelete') {
    const invoiceId = String(body.invoiceId ?? '').trim()
    const lineId = String(body.lineId ?? '').trim()
    const expectedRevision = parseExpectedRevision(body.expectedRevision)
    if (!invoiceId || !lineId || expectedRevision === null) return json({ error: 'missing_fields' }, 400)
    const { data, error } = await supabase.rpc('invoice_line_delete', {
      p_invoice_id: invoiceId, p_line_id: lineId, p_expected_revision: expectedRevision
    })
    const err = mapRpcError(error); if (err) return err
    return json({ invoice: (data || {}).invoice, serverSignature: (data || {}).serverSignature })
  }

  if (action === 'draftDelete') {
    const invoiceId = String(body.invoiceId ?? '').trim()
    const expectedRevision = parseExpectedRevision(body.expectedRevision)
    if (!invoiceId || expectedRevision === null) return json({ error: 'missing_fields' }, 400)
    const { data, error } = await supabase.rpc('invoice_draft_delete', {
      p_invoice_id: invoiceId, p_expected_revision: expectedRevision
    })
    const err = mapRpcError(error); if (err) return err
    return json({ deletedInvoice: (data || {}).deletedInvoice, activityLog: await projectActivityLog(supabase, (data || {}).activityLog, perms, callerStaffId), serverSignature: (data || {}).serverSignature })
  }

  if (action === 'discountSet') {
    const invoiceId = String(body.invoiceId ?? '').trim()
    const discount = body.discount
    const expectedRevision = parseExpectedRevision(body.expectedRevision)
    if (!invoiceId || !discount || typeof discount !== 'object' || expectedRevision === null) {
      return json({ error: 'missing_fields' }, 400)
    }
    const { data, error } = await supabase.rpc('invoice_discount_set', {
      p_invoice_id: invoiceId, p_discount: discount, p_expected_revision: expectedRevision
    })
    const err = mapRpcError(error); if (err) return err
    return json({ invoice: (data || {}).invoice, serverSignature: (data || {}).serverSignature })
  }

  if (action === 'taxReductionSet') {
    const invoiceId = String(body.invoiceId ?? '').trim()
    const taxReduction = body.taxReduction
    const expectedRevision = parseExpectedRevision(body.expectedRevision)
    if (!invoiceId || !taxReduction || typeof taxReduction !== 'object' || expectedRevision === null) {
      return json({ error: 'missing_fields' }, 400)
    }
    const { data, error } = await supabase.rpc('invoice_tax_reduction_set', {
      p_invoice_id: invoiceId, p_tax_reduction: taxReduction, p_expected_revision: expectedRevision
    })
    const err = mapRpcError(error); if (err) return err
    return json({ invoice: (data || {}).invoice, serverSignature: (data || {}).serverSignature })
  }

  if (action === 'metaUpdate') {
    const invoiceId = String(body.invoiceId ?? '').trim()
    const patch = body.patch
    const expectedRevision = parseExpectedRevision(body.expectedRevision)
    if (!invoiceId || !patch || typeof patch !== 'object' || expectedRevision === null) {
      return json({ error: 'missing_fields' }, 400)
    }
    const { data, error } = await supabase.rpc('invoice_meta_update', {
      p_invoice_id: invoiceId, p_patch: patch, p_expected_revision: expectedRevision
    })
    const err = mapRpcError(error); if (err) return err
    return json({ invoice: (data || {}).invoice, serverSignature: (data || {}).serverSignature })
  }

  if (action === 'aoBilling') {
    const aoId = String(body.aoId ?? '').trim()
    const mode = String(body.mode ?? '')
    const invoiceId = String(body.invoiceId ?? '').trim()
    if (!aoId || (mode !== 'invoiced' && mode !== 'restore') || (mode === 'invoiced' && !invoiceId)) return json({ error: 'missing_fields' }, 400)
    const { data, error } = await supabase.rpc('work_order_billing_set', {
      p_ao_id: aoId, p_invoice_id: invoiceId, p_mode: mode, p_actor_id: callerStaffId
    })
    if (error) {
      const regel = aoRuleError(error.message)
      if (regel) return json(regel.body, regel.status)
      const err = mapRpcError(error); if (err) return err
    }
    const r = (data || {}) as Record<string, unknown>
  /* T4-A (SÄK-7, B5, B1): AO i svaret projiceras som en läsning (projectWorkOrder) — tidigare
     fick t.ex. fältet portkoden och inköpspriserna här trots att work-orders-list tog bort dem. */
    return json({ workOrder: r.workOrder ? projectWorkOrder(r.workOrder, perms) : r.workOrder, noop: r.noop === true, serverSignature: r.serverSignature })
  }

  if (action === 'appendChecked') {
    const invoice = body.invoice
    if (!invoice || typeof invoice !== 'object') return json({ error: 'missing_fields' }, 400)
    /* P0-6 FIX (independent-reviewer finding): forward the client's
       idempotencyKey (if provided) so a network retry on invoice
       creation — "the request succeeded server-side but the client
       never saw the response, then retried" — returns the SAME
       already-created invoice instead of creating a second one. An
       older client that doesn't yet send one still works unchanged
       (the RPC's new parameter has a default of NULL). No
       expectedRevision — creates a NEW invoice (R9B TEST 9, ronda 3). */
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null
    const { data, error } = await supabase.rpc('invoice_append_checked', { p_invoice: stripClientStaleOverrides(invoice as Record<string, unknown>), p_idempotency_key: idempotencyKey })
    const err = mapRpcError(error); if (err) return err
    return json({ invoice: (data || {}).invoice, serverSignature: (data || {}).serverSignature })
  }

  return json({ error: 'unknown_action' }, 400)
})
