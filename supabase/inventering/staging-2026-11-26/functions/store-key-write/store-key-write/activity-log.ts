export const TYPES = new Set([
  'ao_from_deviation', 'customer_created', 'customer_deleted', 'customer_updated',
  'deviation_created', 'deviation_status', 'invoice_created', 'invoice_stale_override_approved',
  'material_added', 'material_removed', 'point_ej_aktuell', 'point_ok',
  'property_object_created', 'property_object_deleted', 'property_object_updated',
  'recurring_order_created', 'rondering_completed', 'rondering_created', 'rondering_started',
  'sales_opportunity_lost', 'sales_opportunity_won', 'staff_assigned', 'time_entry_created',
  'work_order_archived', 'work_order_assigned', 'work_order_created', 'work_order_deleted',
  'work_order_permanent_delete', 'work_order_restored', 'work_order_status', 'work_order_updated',
  'offer_created', 'offer_sent', 'offer_status', 'contract_created', 'project_created', 'note',
])
export const REF_FIELDS = ['customerId', 'propertyId', 'workOrderId', 'offerId', 'invoiceId',
  'salesOpportunityId', 'inspectionId', 'ronderingId', 'deviationId']
export const MAX_ENTRIES = 500
export const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/
export const RATE_PER_MINUTE = 60

const _rate = new Map<string, { n: number; t: number }>()
export function rateLimited(staffId: string, nowMs: number): boolean {
  const s = _rate.get(staffId)
  if (!s || nowMs - s.t > 60000) { _rate.set(staffId, { n: 1, t: nowMs }); return false }
  s.n++
  return s.n > RATE_PER_MINUTE
}

type Obj = Record<string, unknown>

export function buildActivityEntry(input: unknown, callerStaffId: string, nowIso: string): { ok: true; entry: Obj } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_entry' }
  const e = input as Obj
  const id = String(e.id ?? '')
  if (!/^ACT-[A-Za-z0-9-]{6,80}$/.test(id)) return { ok: false, error: 'invalid_id' }
  const type = String(e.type ?? '')
  if (!TYPES.has(type)) return { ok: false, error: 'invalid_type' }
  if (!callerStaffId) return { ok: false, error: 'no_identity' }
  const entry: Obj = {
    id, type,
    description: String(e.description ?? '').slice(0, 500),
    timestamp: nowIso,
    userId: callerStaffId,
    source: 'klientrapport',
    verifiedFields: ['userId', 'timestamp'],
  }
  for (const f of REF_FIELDS) {
    const v = e[f]
    if (v === undefined || v === null || v === '') { entry[f] = ''; continue }
    if (typeof v !== 'string' || !REF_PATTERN.test(v)) return { ok: false, error: 'invalid_reference' }
    entry[f] = v
  }
  return { ok: true, entry }
}
