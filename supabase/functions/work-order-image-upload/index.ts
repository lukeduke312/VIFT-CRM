/**
 * work-order-image-upload — Supabase Edge Function
 *
 * Tar emot en (redan klient-sidigt komprimerad, se WorkOrderImageService.
 * _resizeImage()) bild som multipart/form-data, kontrollerar server-
 * sidigt att anroparen faktiskt får redigera/logga på den angivna
 * arbetsordern, och laddar ENDAST DÅ upp till Supabase Storage-bucketen
 * `workorder-images`. Ersätter den tidigare, felaktiga designen i
 * WorkOrderImageService.js (FÖRSLAG, EJ INSTALLERAD) där en bucket-bred
 * `TO authenticated`-INSERT-policy lät VARJE inloggad användare ladda
 * upp till VILKEN arbetsorders mapp som helst.
 *
 * Behörighet: samma kombination `work-order-checklist-resolve` redan
 * kräver för att mutera AO-innehåll (ao_checklist ELLER ao_edit), PLUS
 * den vanliga AO-synlighetsregeln (ao_view_all, eller ao_view_own och
 * tilldelad/pool) — en användare ska inte kunna skriva till en
 * arbetsorder de inte ens får SE.
 *
 * POST /functions/v1/work-order-image-upload
 * Content-Type: multipart/form-data
 * Headers: Authorization: Bearer <JWT>
 * Form fields: file (Blob/File, redan komprimerad JPEG), aoId (string)
 * Svar 200: { path: string }
 * Svar 400: { error: 'missing_fields' | 'invalid_file_type' | 'file_too_large' | 'empty_file' }
 * Svar 403: { error: 'forbidden' }
 * Svar 404: { error: 'not_found' }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm, canViewWorkOrder } from '../_shared/vift-auth.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BUCKET           = 'workorder-images'
/* Klienten komprimerar redan till max 900px/JPEG 0.75 -- denna gräns är
   en grov, generös baksäkring (inte den egentliga storlekskontrollen),
   samma mönster som work-order-checklist-resolve redan använder för
   avvikelseImage (~12 MB). */
const MAX_BYTES = 10 * 1024 * 1024

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  /* apikey + x-client-info: klienten (WorkOrderImageService._h, Storage._authFetch) skickar alltid apikey —
     utan den i listan stoppar webbläsarens preflight anropet (samma rättning som offer-attachment-upload R1.1.2). */
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

/* Magic-bytes-sniffning för de typer klienten faktiskt kan producera
   (canvas.toDataURL('image/jpeg', ...) ger alltid JPEG; PNG/WebP
   accepteras ändå ifall _resizeImage()s img.onerror-fallback returnerar
   originalfilens egen, okomprimerade MIME-typ). */
function sniffMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'image/webp' /* RIFF....WEBP */
  return null
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

  /* Samma narrowa behörighetskombination som work-order-checklist-resolve
     redan kräver för att mutera AO-innehåll. */
  if (!hasPerm(perms, 'ao_checklist') && !hasPerm(perms, 'ao_edit')) {
    return json({ error: 'forbidden' }, 403)
  }

  let formData: FormData
  try { formData = await req.formData() } catch (e) { return json({ error: 'invalid_form', detail: String(e) }, 400) }

  const aoId      = String(formData.get('aoId') ?? '').trim()
  const fileField = formData.get('file')
  if (!aoId) return json({ error: 'missing_fields', field: 'aoId' }, 400)
  if (!fileField || !(fileField instanceof File)) return json({ error: 'missing_fields', field: 'file' }, 400)

  const { data: woRow } = await supabase
    .from('store').select('value').eq('key', 'vift_workOrders').maybeSingle()
  const workOrders: Record<string, unknown>[] =
    Array.isArray(woRow?.value) ? (woRow.value as Record<string, unknown>[]) : []
  const ao = workOrders.find((o) => o.id === aoId)
  if (!ao) return json({ error: 'not_found' }, 404)

  const callerStaffId = String((staffMember as Record<string, unknown>)?.id ?? '')
  /* Skrivbehörighet ovan är NÖDVÄNDIG men inte TILLRÄCKLIG -- anroparen
     måste även få SE denna specifika arbetsorder (ao_view_all, eller
     ao_view_own + tilldelad/pool). Samma funktion som work-order-image-
     url redan använder för läsvägen, tillämpad här för skrivvägen. */
  if (!canViewWorkOrder(ao as { staff?: unknown; status?: unknown }, perms, callerStaffId)) {
    return json({ error: 'forbidden' }, 403)
  }

  const file = fileField as File
  if (file.size === 0) return json({ error: 'empty_file' }, 400)
  if (file.size > MAX_BYTES) return json({ error: 'file_too_large', maxBytes: MAX_BYTES }, 400)

  const arrayBuffer = await file.arrayBuffer()
  const uint8 = new Uint8Array(arrayBuffer)
  const sniffed = sniffMime(uint8)
  /* RÄTTAT (acceptansgranskning, 2026-11-22): tidigare föll koden tillbaka
     på den klient-DEKLARERADE Content-Type:n (`file.type`, trivialt
     förfalskningsbar i en FormData-request) när sniffMime() inte kände
     igen filens faktiska magic bytes — det gjorde hela sniffningen
     verkningslös, eftersom en anropare bara behövde sätta
     Content-Type: image/jpeg på en GODTYCKLIG fil för att passera
     kontrollen. `sniffed` är nu ENSAM auktoritativ: filens innehåll
     MÅSTE matcha en känd bildsignatur, annars avvisas uppladdningen —
     den deklarerade typen används bara i felsvaret, för felsökning. */
  if (!sniffed || !ALLOWED_MIME.has(sniffed)) {
    const claimed = (file.type || '').toLowerCase().split(';')[0].trim()
    return json({ error: 'invalid_file_type', type: claimed || 'unknown' }, 400)
  }
  const effectiveMime = sniffed

  const path = `${aoId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, uint8, { contentType: effectiveMime, cacheControl: '3600', upsert: false })

  if (upErr) {
    console.error('[work-order-image-upload] storage upload fel:', upErr.message)
    return json({ error: 'storage_error' }, 500)
  }

  return json({ path })
})
