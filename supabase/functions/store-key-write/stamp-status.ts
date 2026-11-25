/**
 * P2-2 CORRECTION (2026-11-16, round 4) — PATCH MODULE for `store-key-write`.
 * NOT a deployed file and NOT the real `store-key-write/index.ts`.
 * Supersedes the round-3 version of this file (same filename) — round 3's
 * client-generated `seq` is replaced by a server-owned `revision` (see
 * 20261116000002_stamp_status_identity_scoped.sql's header for why: two
 * different devices could independently produce the SAME `seq` for two
 * genuinely different, conflicting writes, and round 3's function treated
 * "same seq" as proof of "same request", which it never was).
 *
 *   POST /functions/v1/store-key-write
 *   { action: 'getStampStatus' }
 *     -> 200 { active: boolean, ts: number|null, aoId: string|null,
 *              hasRow: boolean, revision: number }
 *        hasRow:false means "this user has never written a stamp_status
 *        row" — NOT "confirmed clocked out". `revision` is the value the
 *        client must send back as `expectedRevision` on its NEXT write.
 *   { action: 'setStampStatus', active: boolean, ts?: number, aoId?: string, expectedRevision: number }
 *     -> 200 { active, ts, aoId, hasRow: true, revision, stale: boolean, replayed: boolean }
 *        stale:true means a DIFFERENT write already landed since the
 *        caller last read this row — the returned active/ts/aoId/revision
 *        are the real CURRENT values; the caller must reconcile to them,
 *        never assume its own intent succeeded.
 *        replayed:true (stale:false) means this exact write was already
 *        applied (idempotent retry) — safe, no-op, not an error.
 *     -> 403 forbidden | 400 missing_fields
 *     -> T3-B: 403 {error:'forbidden', reason:'not_assigned'} | 409 ao_locked | 404 not_found
 *        när aoId inte är anroparens tilldelade, olåsta AO (AP-B)
 *
 * Identity for BOTH actions is `auth.user.id` (checkViftAuth()'s
 * `ViftAuthOk.user.id`) — never read from `body`, never trusted from the
 * client, unchanged since round 2.
 */

// deno-lint-ignore-file no-explicit-any
type Json = Record<string, any>
type SupabaseLike = any
type JsonFn = (body: unknown, status?: number) => Response

function hasPermLocal(perms: string[], perm: string): boolean {
  return Array.isArray(perms) && (perms.includes('all') || perms.includes(perm))
}

export async function handleGetStampStatus(
  supabase: SupabaseLike, authUserId: string, json: JsonFn,
): Promise<Response> {
  if (!authUserId) return json({ error: 'forbidden' }, 403)
  const { data, error } = await supabase.rpc('store_read_stamp_status', { p_auth_user_id: authUserId })
  if (error) {
    console.error('[store-key-write] store_read_stamp_status RPC-fel:', error.message)
    return json({ error: 'read_failed' }, 500)
  }
  const d = data || {}
  return json({ active: !!d.active, ts: d.ts ?? null, aoId: d.aoId ?? null, hasRow: !!d.hasRow, revision: Number(d.revision ?? 0) })
}

export async function handleSetStampStatus(
  supabase: SupabaseLike, authUserId: string, perms: string[], body: Json, json: JsonFn,
): Promise<Response> {
  if (!authUserId) return json({ error: 'forbidden' }, 403)
  if (!hasPermLocal(perms, 'ao_time')) return json({ error: 'forbidden' }, 403)
  if (typeof body.active !== 'boolean') return json({ error: 'missing_fields' }, 400)
  const expectedRevision = Number(body.expectedRevision)
  if (!Number.isFinite(expectedRevision) || expectedRevision < 0) return json({ error: 'missing_fields' }, 400)
  const active = body.active
  const ts = active ? Number(body.ts) : null
  const aoId = active ? (typeof body.aoId === 'string' ? body.aoId : null) : null
  if (active && (!Number.isFinite(ts) || ts === null)) return json({ error: 'missing_fields' }, 400)

  const { data, error } = await supabase.rpc('store_write_stamp_status', {
    p_auth_user_id: authUserId, p_active: active, p_ts: ts, p_ao_id: aoId, p_expected_revision: expectedRevision,
  })
  if (error) {
    /* T3-B (AP-B, F23): instämpling med aoId kräver tilldelning (eller ao_edit) och
       en olåst AO. Kontrollen görs i store_write_stamp_status under lås; här tolkas
       felen enligt felkodskatalogen (BEHORIGHETSMATRIS §4). */
    const msg = String(error.message || '')
    const m = /\bforbidden:([a-z_]+)/.exec(msg)
    if (m) return json({ error: 'forbidden', reason: m[1] }, 403)
    if (/\bforbidden\b/.test(msg)) return json({ error: 'forbidden' }, 403)
    if (msg.includes('ao_locked')) return json({ error: 'ao_locked' }, 409)
    if (msg.includes('not_found')) return json({ error: 'not_found' }, 404)
    console.error('[store-key-write] store_write_stamp_status RPC-fel:', msg)
    return json({ error: 'write_failed' }, 500)
  }
  const d = data || {}
  return json({
    active: !!d.active, ts: d.ts ?? null, aoId: d.aoId ?? null, hasRow: true,
    revision: Number(d.revision ?? expectedRevision), stale: !!d.stale, replayed: !!d.replayed,
  })
}

/**
 * Hunk for index.ts's action dispatch — unchanged insertion shape from
 * round 2/3, only the two handler bodies above changed:
 *
 *   if (action === 'getStampStatus') {
 *     return await handleGetStampStatus(supabase, auth.user.id, json)
 *   }
 *   if (action === 'setStampStatus') {
 *     return await handleSetStampStatus(supabase, auth.user.id, perms, body, json)
 *   }
 */
