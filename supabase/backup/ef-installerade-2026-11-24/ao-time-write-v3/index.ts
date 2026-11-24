/**
 * ao-time-write — Supabase Edge Function
 * (P0 AO/TID DATA-INTEGRITY FIX — Atomic Work-Order + Time-Entry Writes)
 *
 * Single narrowly-scoped write path for the six AO/time mutations that
 * previously went through the generic, race-prone "read whole array,
 * mutate, write whole array" persist() path (state.js _doPersist()):
 *   create_ao, patch_ao, delete_ao, create_time, patch_time, delete_time
 *
 * Reuses the SAME established pattern as work-order-checklist-resolve /
 * project-document-upload:
 *   authenticated client -> this Edge Function -> service-role RPC
 * (see supabase/migrations/20261017000001_ao_time_atomic_rpc.sql).
 *
 * Nothing security-relevant is trusted from the client body: permission
 * checks and the caller's own staff identity are derived server-side via
 * checkViftAuth(), exactly like every other authenticated EF in this repo.
 *
 * Idempotency (§E/§F in the P0 mandate): every mutating action REQUIRES a
 * client-generated `idempotencyKey` (UUID). A retried request (e.g. after
 * a network failure AFTER the server already committed but BEFORE the
 * client saw the response) with the SAME key returns the ORIGINAL result
 * again, without mutating anything a second time — enforced inside the
 * RPC itself (public.op_idempotency), not just in this function, so it
 * holds even across retries that hit a different EF instance/region.
 *
 * POST /functions/v1/ao-time-write
 * body: { action: 'create_ao'|'patch_ao'|'delete_ao'
 *               |'create_time'|'patch_time'|'delete_time',
 *         idempotencyKey: string (required, client-generated UUID),
 *         ...action-specific fields, see per-branch validation below }
 * 200: { ...RPC result fields, action echoed back }
 * 400/403/404/409/500: { error: '...' }
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

/* Fält en klient ALDRIG själv får sätta direkt via create/patch-payloaden
   — identiska listor som redan gäller för den generiska vägen
   (WorkOrderService/TimeService), upprätthållna HÄR eftersom detta nu är
   den enda skrivvägen för dessa nycklar. */
const AO_SERVER_OWNED_FIELDS = ['id', 'createdAt', 'updatedAt', 'deleted', 'deletedAt']
/* P0-FIX (samlad slutgranskning, "patch_ao / ao_complete"): de ENDA
   fälten en anropare med ao_complete (men inte ao_edit/all) får sätta
   via patch_ao — exakt de fält WorkOrderService.setStatus()/
   markComplete() genererar för övergången till 'klar', inga fler. Se
   patch_ao-grenen nedan för hur `status` själv dessutom begränsas till
   värdet 'klar' specifikt (inte bara att nyckeln 'status' är tillåten). */
const AO_COMPLETE_ONLY_FIELDS = ['status', 'completedAt', 'completedBy', 'updatedAt']
const TIME_OWNERSHIP_FIELDS  = ['staffId', 'staffName', 'registeredById', 'registeredByName']
const TIME_ATTEST_FIELDS     = ['attested', 'attestedAt', 'attestedBy']
const TIME_SERVER_OWNED_FIELDS = ['id', 'createdAt']
/* SÄKERHETSBLOCKER-FIX (2026-10-28): create_time strippade tidigare bara
   TIME_SERVER_OWNED_FIELDS — ägarskaps- och attestfälten gick igenom
   OFILTRERADE så länge anroparen råkade skicka SITT EGET staffId (vilket
   alltid passerade "inte-för-annan"-kontrollen nedan). Alla dessa fält
   strippas nu ALLTID från klientens entry, och härleds i stället helt
   server-sidigt nedan — se create_time-grenen. */
const TIME_CREATE_CLIENT_STRIPPED_FIELDS = TIME_SERVER_OWNED_FIELDS.concat(TIME_OWNERSHIP_FIELDS, TIME_ATTEST_FIELDS)

function stripFields(obj: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out = { ...obj }
  fields.forEach(f => { delete out[f] })
  return out
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
  const sm = staffMember as Record<string, unknown>
  const callerStaffId   = String(sm?.id ?? '')
  const callerCanViewAll = hasPerm(perms, 'ao_view_all') || hasPerm(perms, 'all')
  const canPayroll       = hasPerm(perms, 'payroll_manage') || hasPerm(perms, 'all')
  const canOwnTime       = hasPerm(perms, 'ao_time') || hasPerm(perms, 'all')

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const action = String(body.action ?? '')
  const idempotencyKey = String(body.idempotencyKey ?? '').trim()
  if (!idempotencyKey) return json({ error: 'idempotency_key_required' }, 400)

  function rpcErrorToResponse(rpcErr: { message?: string } | null) {
    const msg = String(rpcErr?.message || '')
    if (msg.includes('not_found'))        return json({ error: 'not_found' }, 404)
    if (msg.includes('stale_write'))      return json({ error: 'stale_write' }, 409)
    if (msg.includes('attested_locked'))  return json({ error: 'attested_locked' }, 409)
    if (msg.includes('idempotency_key_required')) return json({ error: 'idempotency_key_required' }, 400)
    /* SÄKERHETSBLOCKER-FIX (2026-10-28): den nya server-sidiga
       ägarskapskontrollen i time_entry_patch/time_entry_soft_delete/
       time_entry_set_attested signalerar avslag via RAISE EXCEPTION
       'forbidden' — måste mappas till 403, annars föll den tidigare
       igenom till den generiska 500 'write_failed' nedan. */
    if (msg.includes('forbidden'))        return json({ error: 'forbidden' }, 403)
    /* V6-FIX (samlad slutgranskning, fynd A/B): time_entry_set_attested
       nekar nu explicit ett NULL p_attested via 'missing_fields' (en
       ogiltig/odefinierad begäran, inte ett klientfel som redan fångas
       innan RPC-anropet) — måste mappas till 400, samma kod som EF:ens
       EGNA tidigare missing_fields-kontroller, aldrig den generiska 500.
       idempotency_key_conflict (fynd B): en SENARE begäran som
       återanvänder en idempotensnyckel men med ANNAN payload — en
       databaskonflikt, inte en serverkrasch, mappas till 409 (samma
       statuskod-familj som stale_write/attested_locked, inte 500). */
    if (msg.includes('missing_fields'))   return json({ error: 'missing_fields' }, 400)
    if (msg.includes('idempotency_key_conflict')) return json({ error: 'idempotency_key_conflict' }, 409)
    if (msg.includes('staff_not_found'))  return json({ error: 'staff_not_found' }, 400)
    console.error('[ao-time-write] RPC fel (' + action + '):', msg)
    return json({ error: 'write_failed' }, 500)
  }

  switch (action) {
    case 'create_ao': {
      if (!hasPerm(perms, 'ao_create') && !hasPerm(perms, 'all')) return json({ error: 'forbidden' }, 403)
      const ao = body.ao
      if (!ao || typeof ao !== 'object') return json({ error: 'missing_fields' }, 400)
      /* R2 (2026-10-18): the client may legitimately pre-assign its own id
         (existing WorkOrderService.create()/import-wizard contract — see
         migration 20261017000001 R2 comment for why). It is forwarded as
         p_client_id BEFORE being stripped as a server-owned field from the
         merge payload itself; the RPC alone decides collision/acceptance
         under its row lock — this function never re-derives or trusts any
         other identity for it. */
      const clientId = typeof (ao as Record<string, unknown>).id === 'string' ? (ao as Record<string, unknown>).id as string : null
      const safeAo = stripFields(ao as Record<string, unknown>, AO_SERVER_OWNED_FIELDS)
      const { data, error } = await supabase.rpc('work_order_create', { p_ao: safeAo, p_idempotency_key: idempotencyKey, p_client_id: clientId })
      if (error) {
        if (String(error.message || '').includes('id_collision')) return json({ error: 'id_collision' }, 409)
        return rpcErrorToResponse(error)
      }
      return json({ action, ...(data as Record<string, unknown>) })
    }

    case 'patch_ao': {
      if (!hasPerm(perms, 'ao_edit') && !hasPerm(perms, 'ao_complete') && !hasPerm(perms, 'all')) {
        return json({ error: 'forbidden' }, 403)
      }
      const aoId = String(body.aoId ?? '').trim()
      const patch = body.patch
      if (!aoId || !patch || typeof patch !== 'object') return json({ error: 'missing_fields' }, 400)
      const safePatch = stripFields(patch as Record<string, unknown>, AO_SERVER_OWNED_FIELDS)

      /* P0-FIX (samlad slutgranskning, 2026-10-28, "patch_ao / ao_complete"):
         en anropare med ENDAST `ao_complete` (ingen `ao_edit`/`all`) kunde
         tidigare patcha GODTYCKLIGT fält på en AO — kund, pris, personal,
         m.m. — eftersom behörighetskontrollen ovan bara avgjorde OM
         anropet fick ske alls, aldrig VILKA fält patchen fick röra.
         `ao_complete` är klient-sidigt (se WorkOrderDetailPage.markComplete()
         /WorkOrderService.setStatus()/markComplete()) ENDAST använt för att
         sätta `status:'klar'` (plus de fält den övergången genererar:
         `completedAt`/`completedBy`/`updatedAt`) — ALDRIG för någon annan
         statusövergång eller något administrativt fält. Begränsas nu HÄR,
         server-sidigt, till exakt det: en anropare UTAN `ao_edit`/`all`
         får ENDAST skicka fält ur `AO_COMPLETE_ONLY_FIELDS`, och om
         `status` ingår måste det vara exakt `'klar'`. En BLANDAD patch
         (ett tillåtet fält + ett otillåtet) nekas i sin HELHET — ingen
         tyst delvis-strippning som skulle kunna dölja för klienten att
         något inte sparades. `ao_edit`/`all`-innehavare är helt
         opåverkade (oförändrat beteende, samma som innan denna fix). */
      const callerHasEdit = hasPerm(perms, 'ao_edit') || hasPerm(perms, 'all')
      if (!callerHasEdit) {
        const patchKeys = Object.keys(safePatch)
        const hasDisallowedField = patchKeys.some(k => !AO_COMPLETE_ONLY_FIELDS.includes(k))
        const statusIsCompleteOnly = !('status' in safePatch) || safePatch.status === 'klar'
        if (hasDisallowedField || !statusIsCompleteOnly) {
          return json({ error: 'forbidden' }, 403)
        }
      }

      const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null
      const { data, error } = await supabase.rpc('work_order_patch', {
        p_ao_id: aoId, p_patch: safePatch, p_idempotency_key: idempotencyKey, p_expected_updated_at: expectedUpdatedAt
      })
      if (error) return rpcErrorToResponse(error)
      return json({ action, ...(data as Record<string, unknown>) })
    }

    case 'delete_ao': {
      if (!hasPerm(perms, 'ao_edit') && !hasPerm(perms, 'all')) return json({ error: 'forbidden' }, 403)
      const aoId = String(body.aoId ?? '').trim()
      if (!aoId) return json({ error: 'missing_fields' }, 400)
      const { data, error } = await supabase.rpc('work_order_soft_delete', { p_ao_id: aoId, p_idempotency_key: idempotencyKey })
      if (error) return rpcErrorToResponse(error)
      return json({ action, ...(data as Record<string, unknown>) })
    }

    /* permanent_delete_ao — real array removal (WorkOrderService.permanentDelete(),
       trash/papperskorg "radera permanent"). Separate action from delete_ao
       (soft/flag-based) on purpose: distinct, destructive operation. Gated
       on the SAME permission (ao_edit or all) as the sibling "Arkivera"/
       "Ta bort" menu items in WorkOrderDetailPage.js (see _menuItems()) —
       deliberately NOT narrowed to 'all' only here, since the existing
       client-side menu already shows "Radera permanent" to any ao_edit
       holder once ao.deleted is true, and narrowing it here would silently
       break that existing, already-shipped access for non-superadmins
       (CLAUDE.md: never remove existing functionality without approval). */
    case 'permanent_delete_ao': {
      if (!hasPerm(perms, 'ao_edit') && !hasPerm(perms, 'all')) return json({ error: 'forbidden' }, 403)
      const aoId = String(body.aoId ?? '').trim()
      if (!aoId) return json({ error: 'missing_fields' }, 400)
      const { data, error } = await supabase.rpc('work_order_permanent_delete', { p_ao_id: aoId, p_idempotency_key: idempotencyKey })
      if (error) return rpcErrorToResponse(error)
      return json({ action, ...(data as Record<string, unknown>) })
    }

    case 'create_time': {
      if (!canOwnTime && !canPayroll) return json({ error: 'forbidden' }, 403)
      const entry = body.entry
      if (!entry || typeof entry !== 'object') return json({ error: 'missing_fields' }, 400)
      const clientEntryId = typeof (entry as Record<string, unknown>).id === 'string' ? (entry as Record<string, unknown>).id as string : null

      /* SÄKERHETSBLOCKER-FIX (2026-10-28, bekräftad brist 3): den gamla
         koden strippade bara TIME_SERVER_OWNED_FIELDS — om anroparen
         skickade SITT EGET staffId (vilket alltid passerar
         "inte-för-annan"-kontrollen nedan) gick staffName/registeredById/
         registeredByName/attested/attestedAt/attestedBy igenom RAKT
         IGENOM, obetrodda. Läs önskat staffId från den OSTRIPPADE entryn
         FÖRST (för att avgöra ägarskapsintentionen), strippa sedan ALLA
         identitets- och attestfält ovillkorligt, och härled dem ALLTID
         på nytt server-sidigt nedan — en vanlig klient skickar redan
         exakt dessa värden (se TimeService.js), så detta ändrar inget
         för legitima anrop. */
      const rawEntry = entry as Record<string, unknown>
      const requestedStaffId = typeof rawEntry.staffId === 'string' ? (rawEntry.staffId as string).trim() : ''
      const isForOther = requestedStaffId !== '' && requestedStaffId !== callerStaffId
      if (isForOther && !canPayroll) return json({ error: 'forbidden' }, 403)

      const safeEntry = stripFields(rawEntry, TIME_CREATE_CLIENT_STRIPPED_FIELDS)
      const callerName = [sm?.firstName, sm?.lastName].filter(Boolean).join(' ').trim()

      if (isForOther) {
        /* Löneansvarig registrerar åt en annan medarbetare — slå upp
           MÅLETS namn server-sidigt (samma mönster som
           checkViftAuth()s egen vift_staff-läsning), lita aldrig på ett
           klient-skickat namn även i detta redan behörighetsstyrda fall. */
        const { data: staffRow } = await supabase.from('store').select('value').eq('key', 'vift_staff').maybeSingle()
        const staffList = Array.isArray(staffRow?.value) ? (staffRow!.value as Record<string, unknown>[]) : []
        const target = staffList.find(s => s.id === requestedStaffId)
        if (!target) return json({ error: 'staff_not_found' }, 400)
        safeEntry.staffId   = requestedStaffId
        safeEntry.staffName = [target.firstName, target.lastName].filter(Boolean).join(' ').trim()
        safeEntry.registeredById   = callerStaffId
        safeEntry.registeredByName = callerName
      } else {
        safeEntry.staffId   = callerStaffId
        safeEntry.staffName = callerName
        safeEntry.registeredById   = ''
        safeEntry.registeredByName = ''
      }

      const { data, error } = await supabase.rpc('time_entry_create', { p_entry: safeEntry, p_idempotency_key: idempotencyKey, p_client_id: clientEntryId })
      if (error) {
        if (String(error.message || '').includes('id_collision')) return json({ error: 'id_collision' }, 409)
        return rpcErrorToResponse(error)
      }
      return json({ action, ...(data as Record<string, unknown>) })
    }

    case 'patch_time': {
      const entryId = String(body.entryId ?? '').trim()
      const patch = body.patch
      if (!entryId || !patch || typeof patch !== 'object') return json({ error: 'missing_fields' }, 400)
      let safePatch = stripFields(patch as Record<string, unknown>, TIME_SERVER_OWNED_FIELDS)
      safePatch = stripFields(safePatch, TIME_ATTEST_FIELDS) /* attest ENDAST via PayrollPage-flödet, aldrig denna generiska väg */
      const touchesOwnership = TIME_OWNERSHIP_FIELDS.some(f => Object.prototype.hasOwnProperty.call(safePatch, f))
      if (touchesOwnership && !canPayroll) return json({ error: 'forbidden' }, 403)
      if (!canOwnTime && !canPayroll) return json({ error: 'forbidden' }, 403)
      const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null
      /* SÄKERHETSBLOCKER-FIX (2026-10-28, bekräftade brister 1/2):
         p_caller_staff_id/p_caller_can_manage_others skickas nu ALLTID
         med — satta HÄR, server-sidigt, från checkViftAuth()s
         verifierade identitet. Den faktiska ägarskapskontrollen (gäller
         VILKEN post som patchas, inte bara vilka FÄLT patchen rör) görs
         nu av time_entry_patch() självt — den gamla EF-enda kontrollen
         (`touchesOwnership`) ovan kvarstår som ett snabbt, tidigt
         förstalager, men är inte längre den enda spärren. */
      const { data, error } = await supabase.rpc('time_entry_patch', {
        p_entry_id: entryId, p_patch: safePatch, p_idempotency_key: idempotencyKey, p_expected_updated_at: expectedUpdatedAt,
        p_caller_staff_id: callerStaffId, p_caller_can_manage_others: canPayroll
      })
      if (error) return rpcErrorToResponse(error)
      return json({ action, ...(data as Record<string, unknown>) })
    }

    case 'delete_time': {
      if (!canOwnTime && !canPayroll) return json({ error: 'forbidden' }, 403)
      const entryId = String(body.entryId ?? '').trim()
      if (!entryId) return json({ error: 'missing_fields' }, 400)
      /* SÄKERHETSBLOCKER-FIX (2026-10-28, bekräftad brist 2): se motsvarande
         kommentar i patch_time ovan — identiskt mönster. */
      const { data, error } = await supabase.rpc('time_entry_soft_delete', {
        p_entry_id: entryId, p_idempotency_key: idempotencyKey,
        p_caller_staff_id: callerStaffId, p_caller_can_manage_others: canPayroll
      })
      if (error) return rpcErrorToResponse(error)
      return json({ action, ...(data as Record<string, unknown>) })
    }

    /* SÄKERHETSBLOCKER-FIX (2026-10-28, bekräftad brist 4 + det
       oberoende fyndet att PayrollPage.js:s attestflöde redan var trasigt
       mot den generiska skrivvägen, se migrationens filhuvud): enda vägen
       att sätta/ta bort attestering. Kräver payroll_manage/all — ingen
       ägarskapsbegränsning (en löneansvarig attesterar per definition
       andras tid). Ersätter PayrollPage.js:s direkta state-mutation +
       persist(). */
    case 'attest_time': {
      if (!canPayroll) return json({ error: 'forbidden' }, 403)
      const entryId = String(body.entryId ?? '').trim()
      if (!entryId || typeof body.attested !== 'boolean') return json({ error: 'missing_fields' }, 400)
      const { data, error } = await supabase.rpc('time_entry_set_attested', {
        p_entry_id: entryId, p_attested: body.attested, p_idempotency_key: idempotencyKey,
        p_caller_staff_id: callerStaffId, p_caller_can_attest: canPayroll
      })
      if (error) return rpcErrorToResponse(error)
      return json({ action, ...(data as Record<string, unknown>) })
    }

    default:
      return json({ error: 'unknown_action' }, 400)
  }
})
