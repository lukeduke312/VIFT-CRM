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
