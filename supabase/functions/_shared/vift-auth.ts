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
  const perms: string[] = Array.isArray(role?.permissions)
    ? (role.permissions as string[])
    : []

  return { ok: true, user, userEmail, staffMember, perms }
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
  for (const code of ['already_assigned', 'ao_locked', 'invalid_source_status', 'idempotency_key_conflict']) {
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
