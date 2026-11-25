/**
 * work-orders-list — Supabase Edge Function
 * (SÄKERHETSFYND V7 — läckage av vift_workOrders via direkt REST-läsning)
 *
 * Den ENDA läsvägen för `vift_workOrders` (direkt authenticated SELECT på
 * nyckeln blockeras av 20261030000001_workorders_read_lockdown.sql).
 *   ao_view_all / all  -> alla AO
 *   ao_view_own        -> egna tilldelade AO (inte arkiverade/borttagna) och, med
 *                         ao_pool_take (övergångsregel: äldre roll med ao_complete),
 *                         öppen pool i BEGRÄNSAD projektion (K-03)
 *   annars             -> tom lista (fail-closed)
 *
 * T3-B (2026-11-28, SÄK-3, SÄK-16, AP-A, K-03): tidigare lämnades varje AO med
 * status 'pool' ut fullständigt till alla med ao_view_own, även tilldelade,
 * arkiverade och borttagna. Nu: canViewWorkOrder() i _shared/vift-auth.ts (strikt
 * delmängd av den gamla regeln, ARBETSPOOL-UTREDNING §5.4) och poolProjection()
 * för öppen pool som anroparen inte är tilldelad.
 *
 * C-5 (2026-11-25): portkod (accessCode) lämnas bara ut till roller med
 * objects_sensitive (samma regel som klientens visning) eller ao_edit (som kan
 * redigera AO och därför måste få hela posten för att inte skriva tillbaka
 * den utan fältet). Övriga (t.ex. fältpersonal utan objects_sensitive,
 * ekonomi, begränsad) får AO utan accessCode — även för pool-AO.
 *
 * Källa: installerad STAGING v2 (backup i supabase/backup/ef-installerade-2026-11-25/)
 * + C-5-blocket nedan.
 *
 * GET/POST /functions/v1/work-orders-list
 * 200: { workOrders: [...] }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm, canViewWorkOrder, isAssigned, isOpenPool, poolProjection } from '../_shared/vift-auth.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control':                'no-store, no-cache',
  'Referrer-Policy':              'no-referrer',
  'X-Content-Type-Options':       'nosniff',
  'X-Frame-Options':              'DENY'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

/* C-5 (2026-11-25) */
const SENSITIVE_AO_FIELDS = ['accessCode']
function redact(list: Record<string, unknown>[], perms: string[]): Record<string, unknown>[] {
  if (hasPerm(perms, 'objects_sensitive') || hasPerm(perms, 'ao_edit')) return list
  return list.map((ao) => {
    if (!ao || typeof ao !== 'object') return ao
    const out = { ...ao }
    for (const f of SENSITIVE_AO_FIELDS) delete out[f]
    return out
  })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return json({ error: 'forbidden' }, 403)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const auth = await checkViftAuth(supabase, jwt, CORS)
  if (!auth.ok) return auth.response
  const { perms, staffMember } = auth

  const { data: row, error } = await supabase.from('store').select('value').eq('key', 'vift_workOrders').maybeSingle()
  if (error) {
    console.error('[work-orders-list] store-läsfel:', error.message)
    return json({ error: 'read_failed' }, 500)
  }
  const all: Record<string, unknown>[] = Array.isArray(row?.value) ? row!.value as Record<string, unknown>[] : []

  if (hasPerm(perms, 'ao_view_all') || hasPerm(perms, 'all')) {
    return json({ workOrders: redact(all, perms) })
  }

  if (!hasPerm(perms, 'ao_view_own')) {
    return json({ workOrders: [] })
  }

  const sm = staffMember as Record<string, unknown>
  const myStaffId = String(sm?.id ?? '')
  const out: Record<string, unknown>[] = []
  for (const ao of all) {
    if (!ao || typeof ao !== 'object' || !canViewWorkOrder(ao, perms, myStaffId)) continue
    out.push(!isAssigned(ao, myStaffId) && isOpenPool(ao) ? poolProjection(ao) : ao)
  }

  return json({ workOrders: redact(out, perms) })
})
