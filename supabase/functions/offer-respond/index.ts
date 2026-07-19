/**
 * offer-respond — Supabase Edge Function (Leverans E, Del E4)
 *
 * Tar emot kundsvar på digital offert (godkänn / ändring begärd / neka).
 * Validerar token + version, sparar auditlogg, uppdaterar status.
 *
 * SÄKERHETSREGLER:
 * - Kunden kan ALDRIG manipulera offertbelopp eller status via frontendkod
 * - All validering och statussättning sker server-side här
 * - Inga interna fält returneras till kunden
 * - Rate-limit: max 5 svar / minut per IP (svar är sällsynta)
 *
 * Anrop: POST /functions/v1/offer-respond
 * Body: {
 *   token: string            — publik offerttoken
 *   action: 'approve' | 'change_request' | 'decline'
 *   offerVersion: number     — vilken version kunden svarar på
 *   name: string             — kundens namn
 *   email: string            — kundens e-post
 *   comment?: string
 *   changeCategory?: string  — vid change_request
 *   declineReason?: string   — vid decline
 *   phone?: string
 *   company?: string
 *   position?: string
 *   agreedToTerms?: boolean  — krävs vid approve
 * }
 *
 * Svar 200: { ok: true, action, offerId, newStatus }
 * Svar 400: { error: 'invalid_action' | 'terms_required' | 'name_required' | 'version_mismatch' }
 * Svar 403: { error: 'revoked' }
 * Svar 410: { error: 'expired' | 'already_answered' }
 * Svar 429: { error: 'rate_limited' }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const VAPID_EMAIL      = Deno.env.get('VAPID_EMAIL')               ?? 'mailto:admin@viftfast.se'
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')          ?? ''
const VAPID_PRIVATE_KEY= Deno.env.get('VAPID_PRIVATE_KEY')         ?? ''

/* ── CORS ─────────────────────────────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

/* ── Rate-limit ───────────────────────────────────────────── */
const _rateMap = new Map<string, { count: number; windowStart: number }>()
const RATE_WINDOW_MS  = 60_000
const RATE_MAX_PER_IP = 5

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

/* ── VAPID (för push-notis till VIFT-personal) ────────────── */
let webpush: { setVapidDetails: (...args: unknown[]) => void; sendNotification: (...args: unknown[]) => Promise<unknown> } | null = null
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  const wp = await import('npm:web-push@3.6.7')
  webpush = wp.default as typeof webpush
  webpush!.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

/* ── Tillåtna actions ─────────────────────────────────────── */
const VALID_ACTIONS = ['approve', 'change_request', 'decline'] as const
type Action = typeof VALID_ACTIONS[number]

const STATUS_FOR_ACTION: Record<Action, string> = {
  approve:        'godkänd',
  change_request: 'ändring-begärd',
  decline:        'nekad'
}

/* ── Handler ─────────────────────────────────────────────── */
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) {
    return json({ error: 'rate_limited' }, 429)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const token          = String(body.token ?? '').trim()
  const action         = String(body.action ?? '').trim() as Action
  const offerVersion   = Number(body.offerVersion ?? 1)
  const name           = String(body.name ?? '').trim()
  const email          = String(body.email ?? '').trim()
  const comment        = String(body.comment ?? '').trim().slice(0, 2000)
  const changeCategory = String(body.changeCategory ?? '').trim()
  const declineReason  = String(body.declineReason  ?? '').trim()
  const agreedToTerms  = body.agreedToTerms === true

  /* Validera input */
  if (!token || token.length < 32)             return json({ error: 'invalid_token' }, 400)
  if (!VALID_ACTIONS.includes(action as Action)) return json({ error: 'invalid_action' }, 400)
  if (!name)                                   return json({ error: 'name_required' }, 400)
  if (!email || !email.includes('@'))          return json({ error: 'email_required' }, 400)
  if (action === 'approve' && !agreedToTerms)  return json({ error: 'terms_required' }, 400)

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })

    /* Hämta offers-blob */
    const { data: storeRow, error: storeErr } = await supabase
      .from('store')
      .select('value')
      .eq('key', 'vift_offers')
      .maybeSingle()

    if (storeErr) throw new Error('store-läsfel: ' + storeErr.message)

    const offers: Record<string, unknown>[] = Array.isArray(storeRow?.value)
      ? storeRow.value as Record<string, unknown>[]
      : []

    const off = offers.find(o => o.publicToken === token)

    if (!off)                  return json({ error: 'not_found' }, 404)
    if (off.tokenRevokedAt)    return json({ error: 'revoked' }, 403)
    if (off.tokenExpiresAt) {
      const exp = new Date(off.tokenExpiresAt as string).getTime()
      if (Date.now() > exp)    return json({ error: 'expired' }, 410)
    }

    /* Kontrollera att version matchar */
    if (Number(off.versionNumber) !== offerVersion) {
      return json({
        error: 'version_mismatch',
        currentVersion: Number(off.versionNumber)
      }, 400)
    }

    /* Förhindra alla svar efter att offerten redan fått ett slutgiltigt svar */
    const alreadyAnswered = off.status === 'godkänd' || off.status === 'nekad'
    if (alreadyAnswered) {
      return json({ error: 'already_answered', status: off.status }, 410)
    }

    const now = new Date().toISOString()
    const newStatus = STATUS_FOR_ACTION[action]

    /* Uppdatera offert-status och godkännandedata */
    off.status    = newStatus
    off.answeredAt = now
    off.updatedAt  = now

    if (action === 'approve') {
      off.customerApproval = {
        token:           token,
        approvedAt:      now,
        approvedByName:  name,
        approvedByEmail: email,
        ip:              ip,
        comment:         comment
      }
    }

    if (action === 'decline') {
      off.declineReason = declineReason || 'annat'
    }

    /* Skriv tillbaka */
    const { error: writeErr } = await supabase
      .from('store')
      .upsert({ key: 'vift_offers', value: offers }, { onConflict: 'key' })

    if (writeErr) throw new Error('store-skrivfel: ' + writeErr.message)

    /* Händelselogg */
    const eventType = action === 'approve' ? 'approved'
                    : action === 'change_request' ? 'change_requested'
                    : 'declined'
    await appendOfferEvent(supabase, {
      offerId:               off.id as string,
      offerVersion:          Number(off.versionNumber) || 1,
      type:                  eventType,
      ts:                    now,
      byCustomer:            name,
      byEmail:               email,
      ip,
      comment,
      changeRequestCategory: changeCategory,
      declineReason
    })

    /* Push-notis till VIFT-personal */
    await sendPushToVift(supabase, {
      action,
      offerId:      off.id as string,
      customerName: name,
      offerTitle:   (off.title as string) || (off.id as string)
    })

    return json({
      ok:        true,
      action,
      offerId:   off.id,
      newStatus
    })

  } catch (err: unknown) {
    console.error('[offer-respond] fel:', err)
    return json({ error: 'internal_error' }, 500)
  }
})

/* ── Pushnotis till VIFT-personal ─────────────────────────── */
async function sendPushToVift(
  supabase: ReturnType<typeof createClient>,
  opts: { action: string; offerId: string; customerName: string; offerTitle: string }
): Promise<void> {
  if (!webpush) return

  const titleMap: Record<string, string> = {
    approve:        'Offert godkänd',
    change_request: 'Ändring begärd',
    decline:        'Offert nekad'
  }
  const title   = titleMap[opts.action]  || 'Kundsvar på offert'
  const body    = `${opts.customerName} har ${opts.action === 'approve' ? 'godkänt' : opts.action === 'decline' ? 'nekat' : 'begärt ändring av'} offert ${opts.offerTitle}.`
  const url     = `/#/offerter/${opts.offerId}`
  const payload = JSON.stringify({ title, body, url })

  try {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
      .is('revoked_at', null)

    if (!subs || subs.length === 0) return

    const revokedIds: string[] = []
    await Promise.allSettled(
      subs.map(async (sub: { id: string; endpoint: string; p256dh: string; auth_key: string }) => {
        try {
          await webpush!.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            payload
          )
        } catch (err: unknown) {
          const status = (err as { statusCode?: number }).statusCode
          if (status === 410 || status === 404) revokedIds.push(sub.id)
        }
      })
    )

    if (revokedIds.length > 0) {
      await supabase
        .from('push_subscriptions')
        .update({ revoked_at: new Date().toISOString() })
        .in('id', revokedIds)
    }
  } catch (e) {
    console.warn('[offer-respond] sendPushToVift fel:', e)
  }
}

/* ── Händelselogg ─────────────────────────────────────────── */
async function appendOfferEvent(
  supabase: ReturnType<typeof createClient>,
  ev: Partial<{
    offerId: string; offerVersion: number; type: string; ts: string
    byCustomer: string; byEmail: string; ip: string; comment: string
    changeRequestCategory: string; declineReason: string
  }>
): Promise<void> {
  try {
    const { data: row } = await supabase
      .from('store')
      .select('value')
      .eq('key', 'vift_offerEvents')
      .maybeSingle()

    const events: unknown[] = Array.isArray(row?.value) ? row.value as unknown[] : []
    events.push({
      id:                     'oe-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      offerId:                ev.offerId                ?? '',
      offerVersion:           ev.offerVersion           ?? 1,
      type:                   ev.type                   ?? '',
      ts:                     ev.ts                     ?? new Date().toISOString(),
      byUser:                 '',
      byCustomer:             ev.byCustomer             ?? '',
      byEmail:                ev.byEmail                ?? '',
      ip:                     ev.ip                     ?? '',
      comment:                ev.comment                ?? '',
      changeRequestCategory:  ev.changeRequestCategory  ?? '',
      declineReason:          ev.declineReason          ?? ''
    })
    if (events.length > 10_000) events.splice(0, events.length - 10_000)

    await supabase
      .from('store')
      .upsert({ key: 'vift_offerEvents', value: events }, { onConflict: 'key' })
  } catch (e) {
    console.error('[offer-respond] appendOfferEvent fel:', e)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}
