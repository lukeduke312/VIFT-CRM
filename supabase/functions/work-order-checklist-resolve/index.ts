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
 * body: { aoId: string, itemId: string, avvikelse: 'ok'|'avvikelse'|null,
 *         avvikelseComment?: string, avvikelseImage?: string (data-URL) }
 * 200: { workOrder: <updated AO>, activityLog: <canonical activityLog>,
 *        serverSignature: string (metadata only — never use to advance
 *        DataSync._lastSig; the client has not received a full snapshot) }
 * 400/403/404/500: { error: '...' }
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
  const avvikelseRaw = body.avvikelse
  const avvikelse: string | null =
    avvikelseRaw === 'ok' || avvikelseRaw === 'avvikelse' ? avvikelseRaw
    : (avvikelseRaw === null || avvikelseRaw === undefined || avvikelseRaw === '') ? null
    : undefined as unknown as string | null

  if (!aoId || !itemId) return json({ error: 'missing_fields' }, 400)
  if (avvikelse === undefined) return json({ error: 'invalid_avvikelse' }, 400)

  const avvikelseComment = typeof body.avvikelseComment === 'string' ? body.avvikelseComment.trim().slice(0, 2000) : ''
  if (avvikelse === 'avvikelse' && !avvikelseComment) {
    return json({ error: 'comment_required' }, 400)
  }

  /* Valfri avvikelsebild (data-URL) — samma optionella fält som R1/R1.1
     redan skickade via den generiska vägen. En grov storleksgräns
     (~12 MB base64) skyddar mot uppenbart felaktiga/överdimensionerade
     payloads; ingen ny bildbehandling/lagring införs — bilden lagras,
     precis som tidigare, direkt i checklistpunktens JSON-fält. */
  const avvikelseImageRaw = typeof body.avvikelseImage === 'string' ? body.avvikelseImage : ''
  if (avvikelseImageRaw.length > 12 * 1024 * 1024) {
    return json({ error: 'image_too_large' }, 400)
  }
  const avvikelseImage = avvikelse === 'avvikelse' ? avvikelseImageRaw : ''

  /* Aldrig från klienten: aktörens namn (för avvikelseBy/aktivitetstexten)
     härleds UTESLUTANDE från den redan verifierade JWT-identiteten —
     samma princip som project-document-upload redan etablerat för
     `uploadedBy` (§Blockerare 7 där). */
  const sm = staffMember as Record<string, unknown>
  const actorName = [sm?.firstName, sm?.lastName].filter(Boolean).join(' ').trim() || 'Okänd användare'
  const callerStaffId = String(sm?.id ?? '')
  const callerCanViewAll = hasPerm(perms, 'ao_view_all') || hasPerm(perms, 'all')

  const { data: rpcResult, error: rpcErr } = await supabase.rpc('work_order_checklist_resolve', {
    p_ao_id: aoId,
    p_item_id: itemId,
    p_avvikelse: avvikelse,
    p_avvikelse_comment: avvikelseComment,
    p_actor_name: actorName,
    p_caller_can_view_all: callerCanViewAll,
    p_caller_staff_id: callerStaffId,
    p_avvikelse_image: avvikelseImage || null
  })

  if (rpcErr) {
    const msg = String(rpcErr.message || '')
    if (msg.includes('forbidden'))       return json({ error: 'forbidden' }, 403)
    if (msg.includes('not_found'))       return json({ error: 'not_found' }, 404)
    if (msg.includes('item_not_found'))  return json({ error: 'item_not_found' }, 404)
    if (msg.includes('comment_required'))return json({ error: 'comment_required' }, 400)
    if (msg.includes('invalid_avvikelse')) return json({ error: 'invalid_avvikelse' }, 400)
    console.error('[work-order-checklist-resolve] RPC fel:', msg)
    return json({ error: 'update_failed' }, 500)
  }

  /* R1.3 BLOCKERARE 2: RPC:n returnerar nu {workOrder, activityLog,
     serverSignature} istället för bara AO:n (se migrationen) — så att
     anroparen (WorkOrderService.resolveChecklistItemAtomic()) kan
     synkronisera BÅDE AO:n och den faktiska kanoniska aktivitetsloggen
     lokalt, utan att vänta på nästa DataSync-poll. `serverSignature`
     är ren metadata — klienten instrueras (se frontend) att ALDRIG
     använda den för att avancera DataSync._lastSig. */
  const r = (rpcResult || {}) as Record<string, unknown>
  return json({ workOrder: r.workOrder, activityLog: r.activityLog, serverSignature: r.serverSignature })
})
