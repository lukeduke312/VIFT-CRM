/**
 * Per-post-regel för `vift_activities` (Att göra) — TASK-01 (2026-11-24).
 *
 * Problem: KEY_PERMISSIONS kräver admin_manage för hela registret, så en
 * fältarbetare kan inte klarmarka sin egen uppgift. Att öppna admin_manage
 * eller hela registret är inte acceptabelt.
 *
 * Regel (bedöms på klientens `previous`, som RPC:n
 * store_business_key_merge_write kontrollerar mot serverns AKTUELLA
 * element under radlås — ett felaktigt `previous` ger konflikt, aldrig en
 * skrivning, och en ny post skrivs bara om id:t inte redan finns):
 *
 *   FULL     admin_manage/all (befintlig regel) eller arbetsledare
 *            (ao_edit OCH ao_view_all) — samma kombination som krävs för
 *            att arkivera/radera arbetsordrar.
 *   SKAPARE  previous.createdBy === anroparen: får ändra allt utom id,
 *            createdBy, createdAt; ansvarig måste vara anroparen själv.
 *   ANSVARIG previous.assignedTo === anroparen (inte skapare): får bara
 *            ändra status, completedAt, completedBy, dueDate, dueTime,
 *            updatedAt. completedBy får bara vara anroparen eller null.
 *   NY POST  createdBy === assignedTo === anroparen (egen uppgift).
 *   RADERA   bara egen uppgift (createdBy === assignedTo === anroparen).
 *   Allt annat nekas — även en enda otillåten post i ett anrop nekar hela
 *   anropet (inget delvis tillämpat).
 */

export const ASSIGNEE_FIELDS = ['status', 'completedAt', 'completedBy', 'dueDate', 'dueTime', 'updatedAt']
const IMMUTABLE_FIELDS = ['id', 'createdBy', 'createdAt']

type Obj = Record<string, unknown>
const has = (perms: string[], p: string) => perms.includes('all') || perms.includes(p)
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b)

export function activitiesFullAccess(perms: string[]): boolean {
  return has(perms, 'admin_manage') || (has(perms, 'ao_edit') && has(perms, 'ao_view_all'))
}

export function activitiesWriteAllowed(
  upserts: unknown[], removals: unknown[], perms: string[], callerStaffId: string
): { ok: boolean; reason?: string } {
  if (activitiesFullAccess(perms)) return { ok: true }
  const me = String(callerStaffId || '')
  if (!me) return { ok: false, reason: 'no_identity' }
  if (!Array.isArray(upserts) || !Array.isArray(removals)) return { ok: false, reason: 'invalid' }

  for (const u of upserts) {
    if (!isObj(u)) return { ok: false, reason: 'invalid' }
    const id = String(u.id ?? '')
    const data = u.data
    const prev = u.previous === undefined ? null : u.previous
    if (!id || !isObj(data) || String(data.id ?? '') !== id) return { ok: false, reason: 'invalid_element' }
    if (prev === null) {
      if (data.createdBy !== me || data.assignedTo !== me) return { ok: false, reason: 'new_not_own' }
      continue
    }
    if (!isObj(prev)) return { ok: false, reason: 'invalid_previous' }
    for (const f of IMMUTABLE_FIELDS) if (!same(prev[f], data[f])) return { ok: false, reason: 'immutable_' + f }
    if (prev.createdBy === me) {
      if (data.assignedTo !== me) return { ok: false, reason: 'assign_other' }
      continue
    }
    if (prev.assignedTo === me) {
      const keys = new Set([...Object.keys(prev), ...Object.keys(data)])
      for (const k of keys) if (!ASSIGNEE_FIELDS.includes(k) && !same(prev[k], data[k])) return { ok: false, reason: 'field_' + k }
      if (data.completedBy != null && data.completedBy !== me) return { ok: false, reason: 'completed_by_other' }
      continue
    }
    return { ok: false, reason: 'not_own' }
  }
  for (const r of removals) {
    if (!isObj(r) || !isObj(r.previous)) return { ok: false, reason: 'invalid_removal' }
    if (r.previous.createdBy !== me || r.previous.assignedTo !== me) return { ok: false, reason: 'remove_not_own' }
  }
  return { ok: true }
}

/* T3-D (2026-11-28, D-15, BEHORIGHETSMATRIS §4): avslagsorsaken som returneras till klienten.
   En uppgift som varken är egen eller tilldelad (även en ny uppgift åt någon annan, att lämna
   bort sin egen uppgift och att radera någon annans) → 'not_own'. Fältregler behåller sin orsak
   (t.ex. 'field_title', SEC-TASK-03). Ogiltig indata och saknad identitet ger ingen orsak
   (RPC:n nekar med 403 forbidden utan reason). */
const NOT_OWN = ['not_own', 'new_not_own', 'assign_other', 'remove_not_own']
export function activitiesRefusal(reason?: string): string | null {
  const r = String(reason || '')
  if (NOT_OWN.includes(r)) return 'not_own'
  if (r.startsWith('field_') || r.startsWith('immutable_') || r === 'completed_by_other') return r
  return null
}
