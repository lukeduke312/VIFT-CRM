/**
 * vift-auth — Delad autentiserings- och behörighetskontroll
 *
 * Kontrollerar tre lager:
 *  1. Giltig Supabase JWT (anroparen måste ha verifierat detta via gateway eller getUser)
 *  2. Aktiv VIFT-användare (app_users.active = true)
 *  3. Personalpost och rolltillhörighet (vift_staff + vift_roles)
 *
 * Returnerar ViftAuthOk vid godkänt, ViftAuthFail med färdig Response vid nekad.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface ViftAuthOk {
  ok: true
  user: { id: string; email?: string }
  userEmail: string
  staffMember: Record<string, unknown>
  perms: string[]
}

export interface ViftAuthFail {
  ok: false
  response: Response
}

export type ViftAuthResult = ViftAuthOk | ViftAuthFail

function jsonErr(msg: string, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/**
 * Verifierar JWT, app_users.active och hämtar personal + rollbehörigheter.
 *
 * @param supabase   Service-role-klient
 * @param jwt        Bearer-token extraherat ur Authorization-headern
 * @param cors       CORS-headers för felresponser
 */
export async function checkViftAuth(
  supabase: SupabaseClient,
  jwt: string,
  cors: Record<string, string>
): Promise<ViftAuthResult> {
  if (!jwt) {
    return { ok: false, response: jsonErr('Unauthorized', 401, cors) }
  }

  const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt)
  if (authErr || !user) {
    return { ok: false, response: jsonErr('Unauthorized', 401, cors) }
  }

  const { data: appUser } = await supabase
    .from('app_users')
    .select('active')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!appUser?.active) {
    return { ok: false, response: jsonErr('Forbidden', 403, cors) }
  }

  const userEmail = user.email?.toLowerCase()
  if (!userEmail) {
    return { ok: false, response: jsonErr('Forbidden', 403, cors) }
  }

  const { data: staffRow } = await supabase
    .from('store')
    .select('value')
    .eq('key', 'vift_staff')
    .maybeSingle()

  const staffList: Record<string, unknown>[] =
    Array.isArray(staffRow?.value) ? (staffRow.value as Record<string, unknown>[]) : []

  const staffMember = staffList.find(
    (s) => s.email && String(s.email).toLowerCase() === userEmail && s.active
  )
  if (!staffMember) {
    return { ok: false, response: jsonErr('Forbidden', 403, cors) }
  }

  const { data: rolesRow } = await supabase
    .from('store')
    .select('value')
    .eq('key', 'vift_roles')
    .maybeSingle()

  const roles: Record<string, unknown>[] =
    Array.isArray(rolesRow?.value) ? (rolesRow.value as Record<string, unknown>[]) : []

  const role = roles.find((r) => r.id === staffMember.role)
  /* T4-A (2026-11-28, beslutets punkt 7): en inaktiverad roll (active uttryckligen false/0) ger
     inga behörigheter — samma regel som _vift_role_perms/vift_caller_perms/_vift_auth_staff. */
  const perms: string[] = Array.isArray(role?.permissions) && isRoleActive(role)
    ? (role!.permissions as string[])
    : []

  return { ok: true, user, userEmail, staffMember, perms }
}

/** T4-A: rollen är aktiv om active inte uttryckligen är false/'false'/0/'0' (saknat fält = aktiv). */
export function isRoleActive(role: Record<string, unknown> | null | undefined): boolean {
  if (!role) return false
  const a = role.active
  return !(a === false || a === 0 || a === 'false' || a === '0')
}

/** Returnerar true om perms innehåller 'all' eller den angivna behörigheten. */
export function hasPerm(perms: string[], perm: string): boolean {
  return perms.includes('all') || perms.includes(perm)
}

/* ── T3-B (2026-11-28): AO- och poolregler ──────────────────────────────
   Samma regler som SQL-funktionerna _vift_* i
   supabase/migrations/20261128000001_t3b_ao_regler_och_pool.sql. EF-kontrollerna
   är ett snabbt första lager; de samtidighetskritiska kontrollerna görs i RPC:n
   under radlås. Ändras en regel här ska den ändras i SQL (och i
   VIFT-CRM/tests/e2e/fake-backend.js) samtidigt. */

export const NEW_AO_PERMS = ['ao_start_own', 'ao_complete_own', 'ao_pool_take']

/** Effektiva AO-behörigheter med ÖVERGÅNGSREGELN (testplanen §4.6): en äldre roll
 *  (ingen av NEW_AO_PERMS) med ao_complete men utan ao_view_all/ao_edit behandlas som
 *  ao_start_own + ao_complete_own + ao_pool_take. Tas bort när standardrollerna har
 *  de nya behörigheterna (T3-E). */
export function effectiveAoPerms(perms: string[]): string[] {
  const p = Array.isArray(perms) ? perms.slice() : []
  if (p.includes('all')) return p
  const legacy = !NEW_AO_PERMS.some((x) => p.includes(x))
  if (legacy && p.includes('ao_complete') && !p.includes('ao_view_all') && !p.includes('ao_edit')) {
    return p.concat(NEW_AO_PERMS)
  }
  return p
}

const isTrue = (v: unknown) => v === true || v === 'true'

export function aoStaff(ao: { staff?: unknown } | null | undefined): string[] {
  return ao && Array.isArray(ao.staff) ? (ao.staff as unknown[]).map(String) : []
}

export function isAssigned(ao: { staff?: unknown } | null | undefined, staffId: string): boolean {
  return !!staffId && aoStaff(ao).includes(staffId)
}

/** Öppen pool (AP-A): status pool, poolOpen inte false, ingen personal, inte arkiverad/borttagen. */
export function isOpenPool(ao: Record<string, unknown> | null | undefined): boolean {
  if (!ao) return false
  return ao.status === 'pool' && ao.poolOpen !== false && String(ao.poolOpen) !== 'false' &&
    aoStaff(ao).length === 0 && !isTrue(ao.deleted) && !isTrue(ao.archived)
}

/** Låst AO (409 ao_locked): fakturerad, avbruten, arkiverad, borttagen eller kopplad till faktura. */
export function isLockedWorkOrder(ao: Record<string, unknown> | null | undefined): boolean {
  if (!ao) return false
  return isTrue(ao.deleted) || isTrue(ao.archived) || ao.status === 'fakturerad' || ao.status === 'avbruten' || !!ao.invoiceId
}

/**
 * AO-synlighet (läsning), T3-B:
 *   ao_view_all ELLER 'all' -> ser allt.
 *   annars ao_view_own och (inte arkiverad/borttagen) och
 *     (tilldelad ELLER (ao_pool_take och öppen pool)).
 * Strikt delmängd av den tidigare regeln (tilldelad eller status pool), se
 * ARBETSPOOL-UTREDNING §5.4. En öppen pool-AO lämnas bara ut projicerad (poolProjection).
 * Fail-closed: tom callerStaffId ger aldrig åtkomst.
 */
export function canViewWorkOrder(
  ao: Record<string, unknown> | undefined | null,
  perms: string[],
  callerStaffId: string
): boolean {
  if (!ao) return false
  if (hasPerm(perms, 'ao_view_all') || hasPerm(perms, 'all')) return true
  if (!hasPerm(perms, 'ao_view_own') || !callerStaffId) return false
  if (isTrue(ao.deleted) || isTrue(ao.archived)) return false
  if (isAssigned(ao, callerStaffId)) return true
  return hasPerm(effectiveAoPerms(perms), 'ao_pool_take') && isOpenPool(ao)
}

/** Full läsning av AO-innehåll (bilder, logg): tilldelad eller ao_view_all. Öppen pool ger det inte (K-03, Q3). */
export function canViewWorkOrderContent(ao: Record<string, unknown> | undefined | null, perms: string[], callerStaffId: string): boolean {
  if (!ao) return false
  if (hasPerm(perms, 'ao_view_all') || hasPerm(perms, 'all')) return true
  if (!hasPerm(perms, 'ao_view_own')) return false
  if (isTrue(ao.deleted) || isTrue(ao.archived)) return false
  return isAssigned(ao, callerStaffId)
}

/** Skrivrätt till AO-innehåll (bilder, checklista, logg): tilldelad eller ao_view_all (arbetsledare).
 *  Öppen pool ger ingen skrivrätt före tilldelning (AP-B). */
export function canWriteWorkOrder(ao: Record<string, unknown> | undefined | null, perms: string[], callerStaffId: string): boolean {
  if (!ao) return false
  if (hasPerm(perms, 'ao_view_all') || hasPerm(perms, 'all')) return true
  return isAssigned(ao, callerStaffId)
}

/** Begränsad poolprojektion (K-03): titel, arbetsbeskrivning (separat poolDescription om den
 *  finns), kategori, prioritet, adress, ort, förfallodatum och tidsåtgång. Inga kontakter,
 *  portkoder, priser, historik, bilder eller loggar. */
const POOL_FIELDS = ['id', 'displayNumber', 'title', 'category', 'type', 'priority', 'address', 'zip', 'city',
  'estimatedHours', 'status', 'poolOpen', 'createdAt', 'updatedAt']
export function poolProjection(ao: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of POOL_FIELDS) if (f in ao) out[f] = ao[f]
  const pd = typeof ao.poolDescription === 'string' ? ao.poolDescription.trim() : ''
  out.description = pd || (typeof ao.description === 'string' ? ao.description : '')
  // På en pool-AO är scheduledDate ett förfallodatum (Q1, utredningen §5.1).
  const due = (typeof ao.dueDate === 'string' && ao.dueDate) || (typeof ao.scheduledDate === 'string' ? ao.scheduledDate : '')
  out.dueDate = due
  out.scheduledDate = typeof ao.scheduledDate === 'string' ? ao.scheduledDate : ''
  out.staff = []
  out.checklist = []
  out.materials = []
  out.log = []
  out.timeEntries = []
  out.poolProjection = true
  return out
}

/** Tolkar T3-B:s regelfel från RPC:erna (RAISE 'forbidden:<reason>', 'ao_locked' m.fl.)
 *  enligt felkodskatalogen (BEHORIGHETSMATRIS §4). null = inte ett regelfel. */
export function aoRuleError(message: string | undefined | null): { status: number; body: Record<string, unknown> } | null {
  const msg = String(message || '')
  const m = /\bforbidden:([a-z_]+)/.exec(msg)
  if (m) return { status: 403, body: { error: 'forbidden', reason: m[1] } }
  for (const code of ['already_assigned', 'ao_locked', 'invalid_source_status', 'idempotency_key_conflict', 'invoiced_locked']) {
    if (msg.includes(code)) return { status: 409, body: { error: code } }
  }
  return null
}

/**
 * Säkerställer att en Storage-path verkligen ligger under den angivna
 * arbetsorderns eget "<aoId>/"-prefix — förhindrar att en anropare som är
 * behörig för EN arbetsorder skickar in en ANNAN arbetsorders path under
 * täckmantel av den förstnämndas aoId.
 */
export function isPathUnderAo(path: string, aoId: string): boolean {
  if (!path || typeof path !== 'string') return false
  if (path.includes('..') || path.includes('//') || path.startsWith('/')) return false
  return path.startsWith(aoId + '/')
}

/* ── T4-A (2026-11-28): skyddade AO-fält (B5, B1, D-06, D-01) ─────────────────────
   Samma regler som _vift_t4a_kan_lasa i supabase/migrations/20261128000009_t4a_skyddade_falt.sql
   (och fake-backend.js). Används av work-orders-list och av ao-time-write för AO i skrivsvaren,
   så att en skrivning aldrig lämnar ut mer än en läsning.
     accessCode m.fl. portkodsfält      objects_sensitive (C-5 gav även ao_edit — SÄK-7: inte längre)
     materials[].buyPrice              cost_view
     AO-ekonomi (fixedPrice, amount)   D-06: bara roller som hanterar AO, fakturerar eller har cost_view;
                                       fältet får debiteringskategorin (priceType, priceGroupId) utan belopp.
   T4-B: materials[].sellPrice (och framtida insatser[].unitPrice) bara med prisläsrätt (canReadPrices, D-09). */
export const AO_SENS_FIELDS = ['doorCode', 'keyInformation', 'accessInformation', 'keyReceipt', 'alarmInformation', 'accessCode', 'keyInfo']
export const AO_ECONOMY_FIELDS = ['fixedPrice', 'amount']
export const AO_ECONOMY_PERMS = ['ao_edit', 'ao_view_all', 'invoice_view', 'invoice_create', 'cost_view']

export function projectWorkOrder(ao: Record<string, unknown>, perms: string[]): Record<string, unknown> {
  if (!ao || typeof ao !== 'object' || Array.isArray(ao) || hasPerm(perms, 'all')) return ao
  const out: Record<string, unknown> = { ...ao }
  if (!hasPerm(perms, 'objects_sensitive')) for (const f of AO_SENS_FIELDS) delete out[f]
  if (!AO_ECONOMY_PERMS.some((p) => hasPerm(perms, p))) for (const f of AO_ECONOMY_FIELDS) delete out[f]
  const prices = canReadPrices(perms)
  if ((!hasPerm(perms, 'cost_view') || !prices) && Array.isArray(out.materials)) {
    out.materials = (out.materials as unknown[]).map((m) => {
      if (!m || typeof m !== 'object' || Array.isArray(m)) return m
      const r = { ...(m as Record<string, unknown>) }
      if (!hasPerm(perms, 'cost_view')) delete r.buyPrice
      if (!prices) delete r.sellPrice
      return r
    })
  }
  /* T4-B (VK-1, framtida insatser): à-priset följer samma regel som materialets försäljningspris. */
  if (!prices && Array.isArray(out.insatser)) {
    out.insatser = (out.insatser as unknown[]).map((m) => {
      if (!m || typeof m !== 'object' || Array.isArray(m)) return m
      const r = { ...(m as Record<string, unknown>) }
      delete r.unitPrice
      return r
    })
  }
  return out
}

/* ── T4-B (2026-11-28): priser och tid (D-08, D-09, D-11, K-01) ─────────────────────────
   Samma regler som _vift_t4b_pris_las i supabase/migrations/20261128000011_t4b_material_priser_tid.sql
   (och tests/e2e/t4b-regler.js). Försäljningspris (materials[].sellPrice, articles.sellPrice) och
   timpris (timeEntries.hourRate, priceGroups.hourRate) läses bara av roller som hanterar AO,
   fakturerar, har kostnadsrätt, sköter artiklar/prisgrupper eller offerter — aldrig av fältroller. */
export const PRICE_READ_PERMS = ['ao_edit', 'ao_view_all', 'invoice_view', 'invoice_create', 'cost_view', 'article_manage', 'offer_manage']
export function canReadPrices(perms: string[]): boolean {
  return hasPerm(perms, 'all') || PRICE_READ_PERMS.some((p) => (perms || []).includes(p))
}

/* Fält i en ANNAN persons tidpost som lämnas ut med time_view_all utan payroll_view (K-01, D-08):
   arbetad och registrerad tid — inga löneuppgifter (attest, lön, belopp per person). */
export const TIME_VIEW_ALL_FIELDS = ['id', 'aoId', 'staffId', 'staffName', 'date', 'startStr', 'endStr', 'minutes', 'hours', 'comment',
  'priceGroupId', 'priceGroupName', 'billable', 'internal', 'deleted', 'createdAt', 'updatedAt', 'startTs']

/** Tidpost för anroparen: hourRate (och hourRateUnknown-flaggan är ofarlig) bara med prisläsrätt;
 *  en annans post via time_view_all (utan payroll_view) bara med fälten ovan. */
export function projectTimeEntry(e: Record<string, unknown>, perms: string[], callerStaffId: string): Record<string, unknown> {
  if (!e || typeof e !== 'object' || Array.isArray(e) || hasPerm(perms, 'all')) return e
  let out: Record<string, unknown> = { ...e }
  const own = String(e.staffId ?? '') === callerStaffId
  if (!own && !hasPerm(perms, 'payroll_view')) {
    out = {}
    for (const f of TIME_VIEW_ALL_FIELDS) if (f in e) out[f] = e[f]
    if (canReadPrices(perms) && 'hourRate' in e) out.hourRate = e.hourRate
  }
  if (!canReadPrices(perms)) delete out.hourRate
  return out
}
