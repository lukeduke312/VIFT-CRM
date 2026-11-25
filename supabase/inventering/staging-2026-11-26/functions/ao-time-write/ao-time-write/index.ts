/**
 * ao-time-write — Supabase Edge Function (v5, QA 2026-11-24: QA-P0-1 material, QA-P1-2 starta/ta från pool).
 * Kommenterad källa: supabase/functions/ao-time-write/index.ts i repot. Installerad v3 sparad under
 * supabase/backup/ef-installerade-2026-11-24/ao-time-write-v3/ (återställningsväg).
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm, canViewWorkOrder } from '../_shared/vift-auth.ts'

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

const AO_SERVER_OWNED_FIELDS = ['id', 'createdAt', 'updatedAt', 'deleted', 'deletedAt']
const AO_COMPLETE_ONLY_FIELDS = ['status', 'completedAt', 'completedBy', 'updatedAt']
const TIME_OWNERSHIP_FIELDS  = ['staffId', 'staffName', 'registeredById', 'registeredByName']
const TIME_ATTEST_FIELDS     = ['attested', 'attestedAt', 'attestedBy']
const TIME_SERVER_OWNED_FIELDS = ['id', 'createdAt']
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
    if (msg.includes('forbidden'))        return json({ error: 'forbidden' }, 403)
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
      if (!hasPerm(perms, 'ao_edit') && !hasPerm(perms, 'ao_complete') && !hasPerm(perms, 'ao_material') && !hasPerm(perms, 'all')) {
        return json({ error: 'forbidden' }, 403)
      }
      const aoId = String(body.aoId ?? '').trim()
      const patch = body.patch
      if (!aoId || !patch || typeof patch !== 'object') return json({ error: 'missing_fields' }, 400)
      const safePatch = stripFields(patch as Record<string, unknown>, AO_SERVER_OWNED_FIELDS)

      const callerHasEdit = hasPerm(perms, 'ao_edit') || hasPerm(perms, 'all')
      const isMaterialOnlyPatch = Object.keys(safePatch).length > 0 &&
        Object.keys(safePatch).every(k => k === 'materials' || k === 'updatedAt') && 'materials' in safePatch
      if (!callerHasEdit && isMaterialOnlyPatch && hasPerm(perms, 'ao_material')) {
        if (!Array.isArray(safePatch.materials) || (safePatch.materials as unknown[]).length > 500 ||
            (safePatch.materials as unknown[]).some(m => !m || typeof m !== 'object' || Array.isArray(m))) {
          return json({ error: 'missing_fields' }, 400)
        }
        const { data: woRow } = await supabase.from('store').select('value').eq('key', 'vift_workOrders').maybeSingle()
        const wos = Array.isArray(woRow?.value) ? woRow!.value as Record<string, unknown>[] : []
        const target = wos.find(w => w.id === aoId)
        if (!target) return json({ error: 'not_found' }, 404)
        if (!canViewWorkOrder(target, perms, callerStaffId)) return json({ error: 'forbidden' }, 403)
        if (target.deleted || target.archived || target.invoiceId || target.status === 'fakturerad') {
          return json({ error: 'forbidden' }, 403)
        }
      } else if (!callerHasEdit && !hasPerm(perms, 'ao_complete')) {
        return json({ error: 'forbidden' }, 403)
      } else if (!callerHasEdit && (safePatch.status === 'pågående' || (safePatch.status === 'planerad' && 'staff' in safePatch))) {
        const { data: woRow } = await supabase.from('store').select('value').eq('key', 'vift_workOrders').maybeSingle()
        const wos = Array.isArray(woRow?.value) ? woRow!.value as Record<string, unknown>[] : []
        const target = wos.find(w => w.id === aoId)
        if (!target) return json({ error: 'not_found' }, 404)
        if (target.deleted || target.archived || !callerStaffId) return json({ error: 'forbidden' }, 403)
        const keys = Object.keys(safePatch)
        const curStaff = Array.isArray(target.staff) ? (target.staff as unknown[]).map(String) : []
        if (safePatch.status === 'pågående') {
          const okA = keys.every(k => k === 'status') && curStaff.includes(callerStaffId) &&
            (target.status === 'nytt' || target.status === 'planerad' || target.status === 'pool')
          if (!okA) return json({ error: 'forbidden' }, 403)
        } else {
          const newStaff = Array.isArray(safePatch.staff) ? (safePatch.staff as unknown[]).map(String) : null
          const expStaff = curStaff.includes(callerStaffId) ? curStaff : curStaff.concat([callerStaffId])
          const sameStaff = !!newStaff && newStaff.length === expStaff.length && expStaff.every(s => newStaff.includes(s))
          const curLog = Array.isArray(target.log) ? target.log as Record<string, unknown>[] : []
          const newLog = Array.isArray(safePatch.log) ? safePatch.log as Record<string, unknown>[] : null
          let logOk = !('log' in safePatch)
          if (newLog) {
            const newIds = new Set(newLog.map(e => String(e && e.id)))
            const keepsAll = curLog.every(e => newIds.has(String(e && e.id)))
            const curIds = new Set(curLog.map(e => String(e && e.id)))
            const added = newLog.filter(e => !curIds.has(String(e && e.id)))
            logOk = keepsAll && added.length <= 1 && added.every(e => e && typeof e === 'object' && e.type === 'taken_from_pool')
          }
          const okB = keys.every(k => k === 'staff' || k === 'status' || k === 'log') &&
            target.status === 'pool' && sameStaff && logOk && canViewWorkOrder(target, perms, callerStaffId)
          if (!okB) return json({ error: 'forbidden' }, 403)
        }
      } else if (!callerHasEdit) {
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

      const rawEntry = entry as Record<string, unknown>
      const requestedStaffId = typeof rawEntry.staffId === 'string' ? (rawEntry.staffId as string).trim() : ''
      const isForOther = requestedStaffId !== '' && requestedStaffId !== callerStaffId
      if (isForOther && !canPayroll) return json({ error: 'forbidden' }, 403)

      const safeEntry = stripFields(rawEntry, TIME_CREATE_CLIENT_STRIPPED_FIELDS)
      const callerName = [sm?.firstName, sm?.lastName].filter(Boolean).join(' ').trim()

      if (isForOther) {
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
      safePatch = stripFields(safePatch, TIME_ATTEST_FIELDS)
      const touchesOwnership = TIME_OWNERSHIP_FIELDS.some(f => Object.prototype.hasOwnProperty.call(safePatch, f))
      if (touchesOwnership && !canPayroll) return json({ error: 'forbidden' }, 403)
      if (!canOwnTime && !canPayroll) return json({ error: 'forbidden' }, 403)
      const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null
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
      const { data, error } = await supabase.rpc('time_entry_soft_delete', {
        p_entry_id: entryId, p_idempotency_key: idempotencyKey,
        p_caller_staff_id: callerStaffId, p_caller_can_manage_others: canPayroll
      })
      if (error) return rpcErrorToResponse(error)
      return json({ action, ...(data as Record<string, unknown>) })
    }

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
