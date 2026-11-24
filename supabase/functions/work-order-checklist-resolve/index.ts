/**
 * work-order-checklist-resolve — Supabase Edge Function
 * (AO CHECKLIST AUTO-START R1.2 — Atomic Multi-User Checklist Mutation)
 *
 * Narrowly-scoped write path for exactly one operation: resolving a
 * single AO checklist item (OK / deviation / reopen) and, when
 * applicable, atomically auto-starting the AO — reusing the SAME
 * established pattern as project-document-upload:
 *   authenticated client -> this Edge Function -> service-role RPC
 * (see supabase/migrations/20260917000001_work_order_checklist_atomic_rpc.sql).
 *
 * This function does NOT accept or trust any client-supplied permission
 * claim, actor name, or "am I allowed" flag. Everything security-
 * relevant is derived server-side from the verified JWT via the shared
 * `checkViftAuth()` (same as every other authenticated EF in this repo):
 *
 *   - `perms`       -> must include ao_checklist OR ao_edit (else 403).
 *   - `staffMember` -> supplies the actor's OWN id (for the ownership
 *                      check passed into the RPC) and OWN display name
 *                      (for avvikelseBy/the activity log text) — never
 *                      read from the request body.
 *
 * The actual atomic mutation, row-locking, and auto-start decision all
 * happen inside `work_order_checklist_resolve()` (SECURITY DEFINER,
 * service_role-only) — this function only authenticates, authorizes at
 * the permission level, and forwards a narrow, validated payload.
 *
 * POST /functions/v1/work-order-checklist-resolve
 * body (2026-11-23): { aoId, itemId, action: 'start'|'done'|'avvikelse'|'reset'|'add'|'remove',
 *         avvikelse: 'v2:<action>' (spärr mot äldre EF), avvikelseComment?, avvikelseImage?,
 *         text?, description? (add) }
 * body (äldre, oförändrat): { aoId, itemId, avvikelse: 'ok'|'avvikelse'|null, ... }
 * AO:ns status ändras ALDRIG (beslut 2026-11-23: ingen autostart).
 * 200: { workOrder: <updated AO>, activityLog: <canonical activityLog>,
 *        serverSignature: string (metadata only — never use to advance
 *        DataSync._lastSig; the client has not received a full snapshot) }
 * 400/403/404/500: { error: '...' }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'  // samma låsning som installerad v1 (2026-11-12)
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

  /* Samma narrowa behörighet som klienten redan kräver (R1.1): den som
     får resolva en checklistpunkt (ao_checklist) ELLER redan har
     ao_edit får trigga den automatiska start-sidoeffekten. INGEN annan
     status-skrivbehörighet ges — "Byt status" (manuell, godtycklig)
     förblir en helt separat, ao_edit-only kodväg som denna funktion
     aldrig exponerar. */
  if (!hasPerm(perms, 'ao_checklist') && !hasPerm(perms, 'ao_edit')) {
    return json({ error: 'forbidden' }, 403)
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const aoId      = String(body.aoId ?? '').trim()
  const itemId    = String(body.itemId ?? '').trim()

  /* 2026-11-23 — tre statuslägen (se migrationen
     20261123000002_work_order_checklist_progress.sql). Nytt fält `action`:
     start | done | avvikelse | reset | add | remove. Utan `action` gäller
     det äldre kontraktet (avvikelse: 'ok'|'avvikelse'|null) och mappas
     till samma RPC. Klienten skickar alltid avvikelse:'v2:<action>' för
     åtgärder som bara finns i det nya kontraktet — en ÄLDRE deployad EF
     avvisar då med invalid_avvikelse utan att något ändras. */
  const ACTIONS = ['start', 'done', 'avvikelse', 'reset', 'add', 'remove']
  const avvikelseRaw = body.avvikelse
  let action: string
  if (typeof body.action === 'string' && body.action !== '') {
    if (!ACTIONS.includes(body.action)) return json({ error: 'invalid_action' }, 400)
    action = body.action
  } else {
    if (avvikelseRaw === 'ok') action = 'done'
    else if (avvikelseRaw === 'avvikelse') action = 'avvikelse'
    else if (avvikelseRaw === null || avvikelseRaw === undefined || avvikelseRaw === '') action = 'reset'
    else return json({ error: 'invalid_avvikelse' }, 400)
  }

  if (!aoId || !itemId) return json({ error: 'missing_fields' }, 400)

  const comment = typeof body.avvikelseComment === 'string' ? body.avvikelseComment.trim().slice(0, 2000) : ''
  if (action === 'avvikelse' && !comment) return json({ error: 'comment_required' }, 400)

  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 300) : ''
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : ''
  if (action === 'add' && !text) return json({ error: 'text_required' }, 400)

  /* Valfri avvikelsebild (data-URL) — oförändrad storleksgräns. */
  const avvikelseImageRaw = typeof body.avvikelseImage === 'string' ? body.avvikelseImage : ''
  if (avvikelseImageRaw.length > 12 * 1024 * 1024) {
    return json({ error: 'image_too_large' }, 400)
  }
  const avvikelseImage = action === 'avvikelse' ? avvikelseImageRaw : ''

  /* Aldrig från klienten: aktörens namn/id och behörigheter härleds
     UTESLUTANDE ur den verifierade JWT-identiteten. ao_edit avgör om
     anroparen får ändra/återställa NÅGON ANNANS åtgärd — själva
     kontrollen görs i RPC:n mot den låsta raden (beslut 2026-11-23). */
  const sm = staffMember as Record<string, unknown>
  const actorName = [sm?.firstName, sm?.lastName].filter(Boolean).join(' ').trim() || 'Okänd användare'
  const callerStaffId = String(sm?.id ?? '')
  const callerCanViewAll = hasPerm(perms, 'ao_view_all') || hasPerm(perms, 'all')
  const callerCanEdit = hasPerm(perms, 'ao_edit') || hasPerm(perms, 'all')

  const { data: rpcResult, error: rpcErr } = await supabase.rpc('work_order_checklist_set_state', {
    p_ao_id: aoId,
    p_item_id: itemId,
    p_action: action,
    p_text: text || null,
    p_description: description || null,
    p_comment: comment || null,
    p_image: avvikelseImage || null,
    p_actor_name: actorName,
    p_caller_staff_id: callerStaffId,
    p_caller_can_view_all: callerCanViewAll,
    p_caller_can_edit: callerCanEdit
  })

  if (rpcErr) {
    const msg = String(rpcErr.message || '')
    // Ordning: specifika koder före de generella delsträngarna.
    if (msg.includes('forbidden_other'))  return json({ error: 'forbidden_other' }, 403)
    if (msg.includes('forbidden'))        return json({ error: 'forbidden' }, 403)
    if (msg.includes('item_not_found'))   return json({ error: 'item_not_found' }, 404)
    if (msg.includes('not_found'))        return json({ error: 'not_found' }, 404)
    if (msg.includes('already_resolved')) return json({ error: 'already_resolved' }, 409)
    if (msg.includes('id_collision'))     return json({ error: 'id_collision' }, 409)
    if (msg.includes('comment_required')) return json({ error: 'comment_required' }, 400)
    if (msg.includes('text_required'))    return json({ error: 'text_required' }, 400)
    if (msg.includes('invalid_action'))   return json({ error: 'invalid_action' }, 400)
    if (msg.includes('missing_fields'))   return json({ error: 'missing_fields' }, 400)
    console.error('[work-order-checklist-resolve] RPC fel:', msg)
    return json({ error: 'update_failed' }, 500)
  }

  const r = (rpcResult || {}) as Record<string, unknown>
  return json({ workOrder: r.workOrder, noop: r.noop === true, serverSignature: r.serverSignature, protocol: 2 })
})
