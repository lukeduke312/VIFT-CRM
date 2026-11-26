/**
 * rondering-pass-write — Supabase Edge Function
 * (P0 PART B — RONDERINGSPASS R1 — Atomic Multi-User Checklist Mutation)
 *
 * Narrowly-scoped write path for vift_ronderingspass, reusing the SAME
 * established pattern as work-order-checklist-resolve / project-document-upload:
 *   authenticated client -> this Edge Function -> service-role RPC
 * (see supabase/migrations/20261018000001_rondering_pass_atomic_rpc.sql).
 *
 * Does NOT accept or trust any client-supplied permission claim or actor
 * id — everything security-relevant is derived server-side from the
 * verified JWT via checkViftAuth(): perms must include ao_view_all OR
 * 'all' (same gate the client router already applies to every
 * rondering page — see CLAUDE.md's permission table), and the caller's
 * OWN staff id is used for checkedBy/completedBy, never a client value.
 *
 * POST /functions/v1/rondering-pass-write
 * body: { action: 'pointPatch'|'pointReset'|'saveNote'|'autoStart'|'complete'|'create'|'bulkCreate', ...fields }
 *
 * action=pointPatch:  { passId, categoryId, pointId, status, comment?, deviationId?, workOrderId? }
 * action=pointReset:  { passId, categoryId, pointId }
 * action=saveNote:    { passId, note }
 * action=autoStart:   { passId }
 * action=complete:    { passId }
 * action=create:      { passTemplate: {...} }  (ronderingId, categories, scheduledDate, ...)
 * action=bulkCreate:  { ronderingId, candidates: [...] }
 *
 * 200: { pass: <updated/created pass> }  (or { created, createdCount, skippedCount } for bulkCreate)
 * 400/403/404/500: { error: '...' }
 *
 * T4-D (2026-11-28, SÄK-14/F19, Ö3, R52/R53): behörighet PER PASS.
 *   - pointPatch, pointReset, saveNote, autoStart, complete: ao_view_all (alla pass, som förut) ELLER
 *     rondering_utfor (bara egna tilldelade pass). Kontrollen görs i RPC:n under radlåset på
 *     vift_ronderingspass (p_caller_perms + p_caller_staff_id, härledda ur JWT:n), aldrig här ensam.
 *     403 { error: 'forbidden' } (behörighet saknas), 403 { error: 'forbidden', reason: 'not_assigned' }
 *     (inte eget pass), 409 { error: 'pass_completed' } (fältet ändrar inte ett avslutat pass).
 *   - create, bulkCreate, migrateLegacy (skapa pass, massskapande): fortsatt ao_view_all.
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'

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

const VALID_STATUSES = new Set(['ok', 'anmärkning', 'ej_aktuell', 'ej_kontrollerad'])

function mapRpcError(rpcErr: { message?: string } | null): Response | null {
  if (!rpcErr) return null
  const msg = String(rpcErr.message || '')
  /* T4-D: passregeln i RPC:n (BEHORIGHETSMATRIS §4). */
  if (msg.includes('forbidden:not_assigned')) return json({ error: 'forbidden', reason: 'not_assigned' }, 403)
  if (/(^|\W)forbidden(\W|$)/.test(msg))      return json({ error: 'forbidden' }, 403)
  if (msg.includes('pass_completed'))     return json({ error: 'pass_completed' }, 409)
  if (msg.includes('invalid_status'))     return json({ error: 'invalid_status' }, 400)
  if (msg.includes('category_not_found')) return json({ error: 'category_not_found' }, 404)
  if (msg.includes('point_not_found'))    return json({ error: 'point_not_found' }, 404)
  if (msg.includes('not_found'))          return json({ error: 'not_found' }, 404)
  console.error('[rondering-pass-write] RPC-fel:', msg)
  return json({ error: 'update_failed' }, 500)
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

  /* T4-D: första lager — ao_view_all eller rondering_utfor; passkontrollen görs i RPC:n under lås. */
  const ledning = hasPerm(perms, 'ao_view_all')
  if (!ledning && !perms.includes('rondering_utfor')) {
    return json({ error: 'forbidden' }, 403)
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const sm = staffMember as Record<string, unknown>
  const callerStaffId = String(sm?.id ?? '')
  const action = String(body.action ?? '')

  if (action === 'pointPatch' || action === 'pointReset') {
    const passId     = String(body.passId ?? '').trim()
    const categoryId = String(body.categoryId ?? '').trim()
    const pointId    = String(body.pointId ?? '').trim()
    if (!passId || !categoryId || !pointId) return json({ error: 'missing_fields' }, 400)

    const isReset = action === 'pointReset'
    let status  = ''
    let comment = ''
    let deviationId: string | null = null
    let workOrderId: string | null = null

    if (!isReset) {
      status = String(body.status ?? '')
      if (!VALID_STATUSES.has(status)) return json({ error: 'invalid_status' }, 400)
      comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 4000) : ''
      deviationId = typeof body.deviationId === 'string' && body.deviationId ? body.deviationId : null
      workOrderId = typeof body.workOrderId === 'string' && body.workOrderId ? body.workOrderId : null
    }

    const { data, error } = await supabase.rpc('rondering_point_patch', {
      p_pass_id: passId, p_category_id: categoryId, p_point_id: pointId,
      p_status: isReset ? null : status,
      p_comment: isReset ? null : comment,
      p_deviation_id: deviationId,
      p_work_order_id: workOrderId,
      p_caller_staff_id: callerStaffId,
      p_is_reset: isReset,
      p_caller_perms: perms
    })
    const errResp = mapRpcError(error)
    if (errResp) return errResp
    const d = (data || {}) as Record<string, unknown>
    return json(Object.assign({ pass: d.pass, serverSignature: d.serverSignature }, d.ignoredFields ? { ignoredFields: d.ignoredFields } : {}))
  }

  if (action === 'saveNote') {
    const passId = String(body.passId ?? '').trim()
    if (!passId) return json({ error: 'missing_fields' }, 400)
    const note = typeof body.note === 'string' ? body.note.slice(0, 10_000) : ''
    const { data, error } = await supabase.rpc('rondering_pass_save_note', { p_pass_id: passId, p_note: note, p_caller_staff_id: callerStaffId, p_caller_perms: perms })
    const errResp = mapRpcError(error)
    if (errResp) return errResp
    return json({ pass: (data || {}).pass, serverSignature: (data || {}).serverSignature })
  }

  if (action === 'autoStart') {
    const passId = String(body.passId ?? '').trim()
    if (!passId) return json({ error: 'missing_fields' }, 400)
    const { data, error } = await supabase.rpc('rondering_pass_auto_start', { p_pass_id: passId, p_caller_staff_id: callerStaffId, p_caller_perms: perms })
    const errResp = mapRpcError(error)
    if (errResp) return errResp
    return json({ pass: (data || {}).pass, serverSignature: (data || {}).serverSignature })
  }

  if (action === 'complete') {
    const passId = String(body.passId ?? '').trim()
    if (!passId) return json({ error: 'missing_fields' }, 400)
    const { data, error } = await supabase.rpc('rondering_pass_complete', {
      p_pass_id: passId, p_caller_staff_id: callerStaffId, p_caller_perms: perms
    })
    const errResp = mapRpcError(error)
    if (errResp) return errResp
    return json({ pass: (data || {}).pass, serverSignature: (data || {}).serverSignature })
  }

  if (action === 'create') {
    if (!ledning) return json({ error: 'forbidden' }, 403) // T4-D: skapa pass/massskapande kräver ao_view_all
    const passTemplate = body.passTemplate
    if (!passTemplate || typeof passTemplate !== 'object') return json({ error: 'missing_fields' }, 400)
    const { data, error } = await supabase.rpc('rondering_pass_create', { p_pass_template: passTemplate })
    const errResp = mapRpcError(error)
    if (errResp) return errResp
    return json({ pass: (data || {}).pass, serverSignature: (data || {}).serverSignature })
  }

  if (action === 'migrateLegacy') {
    if (!ledning) return json({ error: 'forbidden' }, 403) // T4-D: skapa pass/massskapande kräver ao_view_all
    const pass = body.pass
    if (!pass || typeof pass !== 'object') return json({ error: 'missing_fields' }, 400)
    const { data, error } = await supabase.rpc('rondering_pass_migrate_legacy', { p_pass: pass })
    const errResp = mapRpcError(error)
    if (errResp) return errResp
    return json({ pass: (data || {}).pass, created: (data || {}).created })
  }

  if (action === 'bulkCreate') {
    if (!ledning) return json({ error: 'forbidden' }, 403) // T4-D: skapa pass/massskapande kräver ao_view_all
    const ronderingId = String(body.ronderingId ?? '').trim()
    const candidates = body.candidates
    if (!ronderingId || !Array.isArray(candidates)) return json({ error: 'missing_fields' }, 400)
    const { data, error } = await supabase.rpc('rondering_passes_bulk_create', {
      p_rondering_id: ronderingId, p_candidates: candidates
    })
    const errResp = mapRpcError(error)
    if (errResp) return errResp
    return json({
      created: (data || {}).created, createdCount: (data || {}).createdCount,
      skippedCount: (data || {}).skippedCount, serverSignature: (data || {}).serverSignature
    })
  }

  return json({ error: 'unknown_action' }, 400)
})
