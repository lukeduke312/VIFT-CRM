/**
 * work-order-image-url — Supabase Edge Function
 *
 * Genererar signerade URL:er för arbetsorderbilder i Supabase Storage-
 * bucketen `workorder-images`, EFTER en server-sidig kontroll att
 * anroparen faktiskt har behörighet att se den specifika arbetsorder
 * bilderna tillhör. Ersätter den tidigare, felaktiga designen i
 * WorkOrderImageService.js (FÖRSLAG, EJ INSTALLERAD) där en bucket-bred
 * `TO authenticated`-policy gav VARJE inloggad användare signerade URL:er
 * för VILKEN arbetsorders bilder som helst, oavsett ao_view_own/
 * ao_view_all. Behörigheten kontrollerades tidigare bara i frontend.
 *
 * Mönster: samma autentiserings-/behörighetsstruktur som redan
 * etablerad av offer-attachment-url/offer-attachment-upload i denna
 * kodbas (checkViftAuth() + hasPerm()). Synlighetsregeln är den REDAN
 * ETABLERADE, källverifierade AO-regeln (WorkOrdersPage/Dashboard.js
 * samt den atomiska work_order_checklist_resolve()-RPC:n använder ALLA
 * samma regel):
 *   canViewAll = ao_view_all ELLER 'all'
 *   annars: ao_view_own OCH (anroparens staff-id finns i ao.staff[]
 *           ELLER ao.status === 'pool')
 *
 * POST /functions/v1/work-order-image-url
 * Headers: Authorization: Bearer <JWT>
 * Body: { aoId: string, paths: string[] }
 * Svar 200: { urls: { [path]: signedUrl } }  (paths som inte kunde
 *            signeras/var ogiltiga utelämnas tyst — samma "osynlig,
 *            ofarlig"-hantering som redan används i denna kodbas för
 *            orphaned Storage-referenser)
 * Svar 400: { error: 'missing_fields' | 'invalid_path' }
 * Svar 403: { error: 'forbidden' }
 * Svar 404: { error: 'not_found' }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, canViewWorkOrderContent, isPathUnderAo } from '../_shared/vift-auth.ts'

const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BUCKET                 = 'workorder-images'
const SIGNED_URL_TTL_SECONDS = 3600 /* 1h — matchar WorkOrderImageService's tidigare egna TTL/cache-antagande */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  /* apikey + x-client-info: klienten (WorkOrderImageService._h, Storage._authFetch) skickar alltid apikey —
     utan den i listan stoppar webbläsarens preflight anropet (samma rättning som offer-attachment-upload R1.1.2). */
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control':                'no-store, no-cache',
  'Referrer-Policy':              'no-referrer',
  'X-Content-Type-Options':       'nosniff',
  'X-Frame-Options':              'DENY',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
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

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const aoId = String(body.aoId ?? '').trim()
  const requestedPaths = Array.isArray(body.paths) ? (body.paths as unknown[]).map(String) : []
  if (!aoId || !requestedPaths.length) return json({ error: 'missing_fields' }, 400)

  for (const p of requestedPaths) {
    if (!isPathUnderAo(p, aoId)) return json({ error: 'invalid_path' }, 400)
  }

  const { data: woRow } = await supabase
    .from('store').select('value').eq('key', 'vift_workOrders').maybeSingle()
  const workOrders: Record<string, unknown>[] =
    Array.isArray(woRow?.value) ? (woRow.value as Record<string, unknown>[]) : []
  const ao = workOrders.find((o) => o.id === aoId)
  if (!ao) return json({ error: 'not_found' }, 404)

  const callerStaffId = String((staffMember as Record<string, unknown>)?.id ?? '')
  /* T3-B (K-03, Q3): öppen pool lämnas ut utan bilder; bild-URL kräver tilldelning
     eller ao_view_all. */
  if (!canViewWorkOrderContent(ao, perms, callerStaffId)) {
    return json({ error: 'forbidden', reason: 'not_assigned' }, 403)
  }

  const { data: items, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(requestedPaths, SIGNED_URL_TTL_SECONDS)

  if (signErr) {
    console.error('[work-order-image-url] signering misslyckades:', signErr.message)
    return json({ error: 'storage_error' }, 500)
  }

  const urls: Record<string, string> = {}
  ;((items as Array<{ error: unknown; path: string | null; signedUrl: string }>) || []).forEach((item) => {
    if (!item.error && item.signedUrl && item.path) urls[item.path] = item.signedUrl
  })

  return json({ urls })
})
