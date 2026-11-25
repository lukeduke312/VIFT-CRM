/**
 * work-order-log-write — Supabase Edge Function (G5, 2026-11-24)
 *
 * Atomisk loggpost på en arbetsorder: lägg till / ta bort EN post under
 * radlås, i stället för att skicka hela log-arrayen via ao-time-write
 * patch_ao (där två samtidiga enheter kunde skriva över varandra).
 * Samma mönster som work-order-checklist-resolve:
 *   inloggad klient -> denna EF (checkViftAuth) -> service_role-RPC
 * (supabase/migrations/20261124000002_work_order_log_ops.sql).
 * ao-time-write ändras inte (källa saknas, G4).
 *
 * Behörighet (härledd ur verifierad JWT, aldrig ur anropet):
 *   - append: någon AO-skrivbehörighet (ao_edit, ao_checklist, ao_time,
 *     ao_material, ao_complete, ao_create) — samma krets som får lägga
 *     loggposter i klienten; synlighet kontrolleras i RPC:n.
 *   - remove: som append, och därtill postens egen staffId eller ao_edit.
 * Servern stämplar staffId (anroparen) på nya poster; klientens staffId
 * ignoreras. Inga andra AO-fält än log/updatedAt kan ändras.
 *
 * POST /functions/v1/work-order-log-write
 *   { action: 'append_log', aoId, entry: {id, …} , idempotencyKey? }
 *   { action: 'remove_log', aoId, entryId, idempotencyKey? }
 * 200 { workOrder, noop }   400/403/404/409/500 { error }
 */
import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm, aoRuleError } from '../_shared/vift-auth.ts'

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
const AO_WRITE = ['ao_edit', 'ao_checklist', 'ao_time', 'ao_material', 'ao_complete', 'ao_create']
const MAX_ENTRY_BYTES = 64 * 1024 // bilder ska ligga i Storage (imagePath), inte inbäddade

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
  if (!AO_WRITE.some((p) => hasPerm(perms, p))) return json({ error: 'forbidden' }, 403)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }
  const action = String(body.action ?? '')
  const aoId = String(body.aoId ?? '').trim()
  const sm = staffMember as Record<string, unknown>
  const callerStaffId = String(sm?.id ?? '')
  const canViewAll = hasPerm(perms, 'ao_view_all') || hasPerm(perms, 'all')

  let rpc: { data: unknown; error: { message?: string } | null }
  if (action === 'append_log') {
    const entry = body.entry as Record<string, unknown> | null
    if (!aoId || !entry || typeof entry !== 'object' || Array.isArray(entry) || !String(entry.id ?? '')) return json({ error: 'missing_fields' }, 400)
    if (JSON.stringify(entry).length > MAX_ENTRY_BYTES) return json({ error: 'entry_too_large' }, 400)
    const stamped = { ...entry, staffId: callerStaffId }
    rpc = await supabase.rpc('work_order_log_append', { p_ao_id: aoId, p_entry: stamped, p_caller_staff_id: callerStaffId, p_caller_can_view_all: canViewAll })
  } else if (action === 'remove_log') {
    const entryId = String(body.entryId ?? '').trim()
    if (!aoId || !entryId) return json({ error: 'missing_fields' }, 400)
    rpc = await supabase.rpc('work_order_log_remove', { p_ao_id: aoId, p_entry_id: entryId, p_caller_staff_id: callerStaffId, p_caller_can_view_all: canViewAll, p_caller_can_edit: hasPerm(perms, 'ao_edit') })
  } else {
    return json({ error: 'unknown_action' }, 400)
  }
  if (rpc.error) {
    const msg = String(rpc.error.message || '')
    if (msg.includes('forbidden_other')) return json({ error: 'forbidden_other' }, 403)
    // T3-B: 403 forbidden/not_assigned (öppen pool ger ingen skrivrätt, Q3), 409 ao_locked.
    const regel = aoRuleError(msg)
    if (regel) return json(regel.body, regel.status)
    if (msg.includes('forbidden'))       return json({ error: 'forbidden' }, 403)
    if (msg.includes('id_collision'))    return json({ error: 'id_collision' }, 409)
    if (msg.includes('not_found'))       return json({ error: 'not_found' }, 404)
    if (msg.includes('missing_fields'))  return json({ error: 'missing_fields' }, 400)
    console.error('[work-order-log-write] RPC-fel:', msg)
    return json({ error: 'update_failed' }, 500)
  }
  const r = (rpc.data || {}) as Record<string, unknown>
  return json({ workOrder: r.workOrder, noop: r.noop === true })
})
