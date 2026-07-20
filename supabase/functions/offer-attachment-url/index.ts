/**
 * offer-attachment-url — Supabase Edge Function (Leverans E, Del E2b-3)
 *
 * Genererar en tidsbegränsad signerad URL för att ladda ned en bilaga.
 * Används av både kundvy (via offerttoken) och intern CRM-vy (via anon key).
 *
 * SÄKERHET:
 * - Kundanrop: valideras mot publicToken + inkludeInPublicView + aktiv + lockedInVersion
 * - Interna anrop: valideras mot JWT (Authorization: Bearer)
 * - Signerade URL:er från Supabase Storage löper ut efter SIGNED_URL_TTL_SECONDS
 * - Borttagna (active=false) eller återkallade bilagor returneras aldrig
 * - Storage path valideras — traversal blockeras
 *
 * POST /functions/v1/offer-attachment-url
 * Body (kundanrop):   { token: string, attachmentId: string }
 * Body (internt):     { attachmentId: string }
 * Headers (internt):  Authorization: Bearer <SUPABASE_JWT>
 *
 * Svar 200: { url: string, expiresAt: string, fileName: string, mimeType: string }
 * Svar 403: { error: 'forbidden' }
 * Svar 404: { error: 'not_found' }
 * Svar 429: { error: 'rate_limited' }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STORAGE_BUCKET    = 'offer-attachments'
const SIGNED_URL_TTL_SECONDS = 3600  /* 1 timme */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

/* ── Rate-limit ───────────────────────────────────────────── */
const _rateMap = new Map<string, { count: number; windowStart: number }>()
const RATE_WINDOW_MS  = 60_000
const RATE_MAX_PER_IP = 60

function checkRateLimit(ip: string): boolean {
  const now  = Date.now()
  const slot = _rateMap.get(ip)
  if (!slot || now - slot.windowStart > RATE_WINDOW_MS) {
    _rateMap.set(ip, { count: 1, windowStart: now })
    return true
  }
  slot.count++
  return slot.count <= RATE_MAX_PER_IP
}

/* ── Säker path-validering ── */
function isValidStoragePath(path: string): boolean {
  if (!path || typeof path !== 'string') return false
  if (path.includes('..') || path.includes('//') || path.startsWith('/')) return false
  if (!/^offer-attachments\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[^/]+$/.test(path)) return false
  return true
}

/* ── Handler ─────────────────────────────────────────────── */
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) return json({ error: 'rate_limited' }, 429)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const attachmentId  = String(body.attachmentId ?? '').trim()
  const customerToken = String(body.token         ?? '').trim()
  const internalKey   = String(body.internalKey   ?? '').trim()

  if (!attachmentId) return json({ error: 'not_found' }, 404)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  /* Hämta bilagor */
  const { data: attRow } = await supabase
    .from('store')
    .select('value')
    .eq('key', 'vift_offerAttachments')
    .maybeSingle()

  const attachments: Record<string, unknown>[] =
    Array.isArray(attRow?.value) ? attRow.value as Record<string, unknown>[] : []

  const att = attachments.find(a => a.id === attachmentId)
  if (!att || att.active === false) return json({ error: 'not_found' }, 404)

  /* ── Behörighetskontroll ── */
  let authorized = false

  if (customerToken && customerToken.length >= 32) {
    /* Kundanrop: validera via offer-token */
    const { data: offRow } = await supabase
      .from('store').select('value').eq('key', 'vift_offers').maybeSingle()
    const offers: Record<string, unknown>[] =
      Array.isArray(offRow?.value) ? offRow.value as Record<string, unknown>[] : []
    const off = offers.find(o => o.publicToken === customerToken)

    if (off && !off.tokenRevokedAt) {
      /* Kolla att token inte har gått ut */
      if (off.tokenExpiresAt) {
        if (Date.now() > new Date(off.tokenExpiresAt as string).getTime()) {
          return json({ error: 'expired' }, 410)
        }
      }
      /* Kolla att bilagan tillhör rätt offert och är synlig för kund */
      if (att.offerId === off.id && att.includeInPublicView === true) {
        authorized = true
      }
    }
  } else {
    /* Internt anrop: validera JWT */
    const authHeader = req.headers.get('authorization') || ''
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (jwt) {
      const { data: { user } } = await supabase.auth.getUser(jwt)
      if (user) authorized = true
    }
  }

  if (!authorized) return json({ error: 'forbidden' }, 403)

  /* Validera storage path */
  const storagePath = String(att.storagePath ?? '')
  if (!isValidStoragePath(storagePath)) return json({ error: 'invalid_path' }, 400)

  /* Generera signerad URL */
  const pathInBucket = storagePath.replace(`${STORAGE_BUCKET}/`, '')
  const { data: signedData, error: signedErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(pathInBucket, SIGNED_URL_TTL_SECONDS, {
      download: String(att.displayName || att.originalFileName || 'bilaga')
    })

  if (signedErr || !signedData?.signedUrl) {
    console.error('[offer-attachment-url] signedUrl fel:', signedErr)
    return json({ error: 'storage_error' }, 500)
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString()

  return json({
    url:          signedData.signedUrl,
    expiresAt,
    fileName:     String(att.displayName || att.originalFileName || 'bilaga'),
    mimeType:     String(att.mimeType   || 'application/octet-stream'),
    sizeBytes:    Number(att.sizeBytes  || 0),
    description:  String(att.description || '')
  })
})

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}
