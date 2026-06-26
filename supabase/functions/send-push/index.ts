/**
 * send-push — Supabase Edge Function
 *
 * Skickar Web Push-notis till en användares registrerade enheter.
 *
 * Anropas med Bearer-token (användarens JWT).
 * Kräver Supabase-secrets:
 *   VAPID_PUBLIC_KEY   — public key (börjar med "B...")
 *   VAPID_PRIVATE_KEY  — private key (börjar med "H..." eller liknande)
 *   VAPID_EMAIL        — t.ex. "mailto:admin@viftfast.se"
 *
 * Body (JSON):
 *   title   string   — Notisrubrik
 *   body    string   — Notistext
 *   url     string   — URL att öppna vid klick (default "/")
 *   userId  string?  — Skicka till annan user (kräver admin-roll)
 *
 * Svar:
 *   { sent: number, revoked: number }
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @deno-types="npm:@types/web-push@3.6.3"
import webpush from 'npm:web-push@3.6.7'

/* ── CORS ─────────────────────────────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

/* ── VAPID-konfiguration ─────────────────────────────────── */
const VAPID_EMAIL       = Deno.env.get('VAPID_EMAIL')       || 'mailto:admin@viftfast.se'
const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')  || ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || ''

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

/* ── Handler ─────────────────────────────────────────────── */
serve(async (req: Request) => {
  /* Preflight */
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    /* Validera VAPID-konfiguration */
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return json({ error: 'VAPID-nycklar saknas i Supabase Secrets' }, 500)
    }

    /* Autentisera anroparen */
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Authorization header saknas' }, 401)
    }
    const jwt = authHeader.slice(7)

    /* Supabase-klient med service role (kringgår RLS för att läsa subscriptions) */
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')              ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    )

    /* Verifiera JWT → hämta anroparens user */
    const { data: { user: caller }, error: authErr } = await supabase.auth.getUser(jwt)
    if (authErr || !caller) {
      return json({ error: 'Ogiltigt token' }, 401)
    }

    /* Läs request body */
    const body = await req.json().catch(() => ({}))
    const title     = (body.title  || 'VIFT CRM').slice(0, 100)
    const text      = (body.body   || '').slice(0, 300)
    const url       = (body.url    || '/').slice(0, 500)
    const broadcast = body.broadcast === true

    /* Hämta subscriptions: broadcast → alla aktiva, annars target user */
    let subsQuery = supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
      .is('revoked_at', null)

    if (!broadcast) {
      const targetUserId: string = body.userId || caller.id
      subsQuery = subsQuery.eq('user_id', targetUserId)
    }

    const { data: subs, error: subsErr } = await subsQuery

    if (subsErr) throw subsErr

    if (!subs || subs.length === 0) {
      return json({ sent: 0, revoked: 0, message: broadcast ? 'Inga aktiva subscriptions' : 'Inga aktiva subscriptions för användaren' })
    }

    const payload = JSON.stringify({ title, body: text, url })
    const revokedIds: string[] = []
    let sent = 0

    /* Skicka till alla enheter parallellt */
    await Promise.allSettled(
      subs.map(async (sub: { id: string; endpoint: string; p256dh: string; auth_key: string }) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth_key }
            },
            payload
          )
          sent++
        } catch (err: unknown) {
          const status = (err as { statusCode?: number }).statusCode
          /* 410 = endpoint ogiltig (enhet avinstallerat/revokerat) */
          if (status === 410 || status === 404) {
            revokedIds.push(sub.id)
          } else {
            console.error('[send-push] fel för endpoint:', sub.endpoint, err)
          }
        }
      })
    )

    /* Markera ogiltiga subscriptions som revokade */
    if (revokedIds.length > 0) {
      await supabase
        .from('push_subscriptions')
        .update({ revoked_at: new Date().toISOString() })
        .in('id', revokedIds)
    }

    return json({ sent, revoked: revokedIds.length })

  } catch (err: unknown) {
    console.error('[send-push] oväntat fel:', err)
    return json({ error: (err as Error).message || 'Internt fel' }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}
