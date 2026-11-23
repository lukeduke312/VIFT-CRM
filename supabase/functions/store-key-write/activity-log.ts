/**
 * Klientrapporterat AKTIVITETSFLÖDE — `appendActivity` (2026-11-24,
 * avgränsat 2026-11-25).
 *
 * VIKTIGT — detta är INTE en verifierad revisionslogg. Servern verifierar
 * bara VEM som rapporterar (userId ur JWT) och NÄR (servertid). Själva
 * händelsen — typ, beskrivning och objektreferenser — är klientens egen
 * rapport och har inte kontrollerats mot affärsdata. Posterna märks därför
 * `source: 'klientrapport'` och `verifiedFields: ['userId', 'timestamp']`.
 * En verifierad revisionslogg kräver att de skrivande RPC:erna själva
 * (ao-time-write, invoice-write, …) skriver händelsen i samma transaktion
 * som affärsändringen — dokumenterat som kvarstående gap (masterplan 200).
 *
 * Begränsningar som gör flödet svårare att missbruka: typ-allowlist,
 * referenser bara i id-format, längdgränser, högst RATE_PER_MINUTE poster
 * per användare och minut (per EF-instans), append-only (ingen kan ändra
 * eller radera befintliga poster via klienten).
 *
 * Tidigare skrev klienten HELA vift_activityLog via writeMerge/write, vilket
 * (a) kräver admin_manage i STAGING (fältarbetares händelser gick förlorade)
 * och (b) skulle låta vem som helst med skrivrätt formulera godtycklig
 * "historik". Nu: klienten föreslår EN händelse; servern
 *   - godtar bara kända händelsetyper (TYPES),
 *   - sätter tidpunkt och användare själv (userId = anroparens staff-id
 *     ur verifierad JWT; klientens värden ignoreras),
 *   - begränsar textlängd och referensfält,
 *   - lägger till posten atomiskt först i listan och kapar till 500
 *     (RPC activity_log_append, radlås), idempotent på id.
 * Generiska skrivningar (write/writeMerge) av vift_activityLog nekas helt
 * (append-only) — ingen kan ändra eller radera historik via klienten.
 */

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

/* Enkel gräns per användare och minut (in-memory per EF-instans, som
   rate-limit i time-entries-list) — skydd mot översvämning, inte mot
   en bestämd angripare över flera instanser. */
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
