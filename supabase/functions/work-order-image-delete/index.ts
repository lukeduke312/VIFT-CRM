/**
 * work-order-image-delete — Supabase Edge Function
 *
 * Stänger den sista, kvarstående, dokumenterade restrisken i
 * WorkOrderImageService.js's filhuvud ("Radering: authenticated users
 * (Storage-nivå, DELETE-ENDAST policy) — KVARSTÅENDE, MEDVETET AVGRÄNSAT
 * RESTRISK"): den tidigare föreslagna `wo_images_storage_delete`-policyn
 * tillät VARJE inloggad användare DELETE på HELA bucketen, oavsett om de
 * hade ao_view_all/ao_view_own/ao_edit för den specifika arbetsordern
 * bilden tillhörde. Samma princip som redan gäller för -url/-upload:
 * behörighet kontrolleras ALDRIG enbart i frontend för en Storage-
 * operation — en anropare som skickar sitt eget giltiga JWT direkt mot
 * Storage-API:et kringgår annars helt UI-gatingen i
 * WorkOrderDetailPage.deleteLogEntry().
 *
 * Behörighet: EXAKT samma kombination som work-order-image-upload redan
 * kräver för att mutera AO-innehåll (ao_checklist ELLER ao_edit), PLUS
 * den vanliga AO-synlighetsregeln (canViewWorkOrder) — att få radera en
 * bild kräver minst samma rättighet som att ha fått ladda upp den.
 *
 * POST /functions/v1/work-order-image-delete
 * Headers: Authorization: Bearer <JWT>
 * Body: { aoId: string, path: string }
 * Svar 200: { ok: true }
 * Svar 400: { error: 'missing_fields' | 'invalid_path' }
 * Svar 403: { error: 'forbidden' }
 * Svar 404: { error: 'not_found' }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm, canViewWorkOrder, isPathUnderAo } from '../_shared/vift-auth.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BUCKET           = 'workorder-images'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
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
  const path = String(body.path ?? '').trim()
  if (!aoId || !path) return json({ error: 'missing_fields' }, 400)
  if (!isPathUnderAo(path, aoId)) return json({ error: 'invalid_path' }, 400)

  /* Samma narrowa behörighetskombination som work-order-image-upload
     redan kräver för att mutera AO-innehåll. */
  if (!hasPerm(perms, 'ao_checklist') && !hasPerm(perms, 'ao_edit')) {
    return json({ error: 'forbidden' }, 403)
  }

  const { data: woRow } = await supabase
    .from('store').select('value').eq('key', 'vift_workOrders').maybeSingle()
  const workOrders: Record<string, unknown>[] =
    Array.isArray(woRow?.value) ? (woRow.value as Record<string, unknown>[]) : []
  const ao = workOrders.find((o) => o.id === aoId)
  if (!ao) return json({ error: 'not_found' }, 404)

  const callerStaffId = String((staffMember as Record<string, unknown>)?.id ?? '')
  if (!canViewWorkOrder(ao as { staff?: unknown; status?: unknown }, perms, callerStaffId)) {
    return json({ error: 'forbidden' }, 403)
  }

  const { error: delErr } = await supabase.storage.from(BUCKET).remove([path])
  if (delErr) {
    console.error('[work-order-image-delete] storage-radering fel:', delErr.message)
    return json({ error: 'storage_error' }, 500)
  }

  return json({ ok: true })
})
