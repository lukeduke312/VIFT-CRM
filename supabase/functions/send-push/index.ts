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
 *   title       string   — Notisrubrik
 *   body        string   — Notistext
 *   url         string   — URL att öppna vid klick (default "/")
 *   propertyId  string?  — Punkt 92: löser ut ansvarig staff via propertyContacts
 *                          (prio: primär → alla aktiva → fallback broadcast/userId)
 *   userId      string?  — Skicka till specifik user (om propertyId ej satt)
 *   broadcast   bool?    — Skicka till ALLA om varken propertyId/userId satt
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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

/* ── Rate-limit ───────────────────────────────────────────── */
const _rateMap = new Map<string, { count: number; windowStart: number }>()
function checkRateLimit(ip: string): boolean {
  const now  = Date.now()
  const slot = _rateMap.get(ip)
  if (!slot || now - slot.windowStart > 60_000) {
    _rateMap.set(ip, { count: 1, windowStart: now }); return true
  }
  slot.count++; return slot.count <= 30
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

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) return json({ error: 'rate_limited' }, 429)

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
    const body      = await req.json().catch(() => ({}))
    const title     = (body.title      || 'VIFT CRM').slice(0, 100)
    const text      = (body.body       || '').slice(0, 300)
    const rawUrl    = String(body.url || '/').slice(0, 500)
    /* Tillåt bara relativa sökvägar eller samma origin — blockera javascript: och externa adresser */
    const url       = rawUrl.startsWith('/') || rawUrl === '' ? rawUrl : '/'
    const propertyId: string | null = body.propertyId || null
    const broadcast = body.broadcast === true

    /* Roll-kontroll: broadcast kräver admin eller förvaltare */
    if (broadcast) {
      const { data: staffRow } = await supabase
        .from('store').select('value').eq('key', 'vift_staff').maybeSingle()
      const staffList: Record<string, unknown>[] =
        Array.isArray(staffRow?.value) ? staffRow.value as Record<string, unknown>[] : []
      const callerStaff = staffList.find(s =>
        String(s.email ?? '').toLowerCase() === (caller.email ?? '').toLowerCase()
      )
      const callerRole = String(callerStaff?.role ?? '')
      if (!['admin', 'förvaltare'].includes(callerRole)) {
        return json({ error: 'Broadcast kräver admin eller förvaltare-roll' }, 403)
      }
    }

    /* ── Punkt 92: propertyId-baserad mottagarresolution ─────
     * Prioritet:
     *   1. Primärkontakt (staff, isPrimary=true, active, giltig)
     *   2. Alla aktiva staff-kontakter för fastigheten
     *   3. Fallback: broadcast / specificerad user                */
    let targetUserIds: string[] | null = null

    if (propertyId) {
      const { data: storeRow } = await supabase
        .from('store')
        .select('value')
        .eq('key', 'vift_propertyContacts')
        .maybeSingle()

      const allContacts: Record<string, unknown>[] =
        Array.isArray(storeRow?.value) ? storeRow.value as Record<string, unknown>[] : []

      const today = new Date().toISOString().slice(0, 10)
      const propContacts = allContacts.filter(c =>
        c.propertyId === propertyId &&
        c.active     !== false      &&
        c.personType === 'staff'    &&
        (!c.validFrom || (c.validFrom as string) <= today) &&
        (!c.validTo   || (c.validTo   as string) >= today)
      )

      /* Hämta staff-lista för att mappa personId → email */
      const { data: staffRow } = await supabase
        .from('store')
        .select('value')
        .eq('key', 'vift_staff')
        .maybeSingle()

      const staffList: Record<string, unknown>[] =
        Array.isArray(staffRow?.value) ? staffRow.value as Record<string, unknown>[] : []

      /* email → auth user_id via auth.users */
      const primaryContacts = propContacts.filter(c => c.isPrimary)
      const candidates = (primaryContacts.length > 0 ? primaryContacts : propContacts)

      if (candidates.length > 0) {
        const emails: string[] = candidates
          .map(c => {
            const s = staffList.find(x => x.id === c.personId)
            return (s?.email as string | undefined)?.toLowerCase() || ''
          })
          .filter(Boolean)

        if (emails.length > 0) {
          /* Hämta auth user_id:n för dessa e-postadresser (paginerat) */
          const authMap: Record<string, string> = {}
          let page = 1
          let hasMore = true
          while (hasMore) {
            const { data: authUsers } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
            for (const u of authUsers?.users ?? []) {
              if (u.email) authMap[u.email.toLowerCase()] = u.id
            }
            hasMore = (authUsers?.users?.length ?? 0) === 1000
            page++
          }
          const ids = emails.map(e => authMap[e]).filter(Boolean) as string[]
          if (ids.length > 0) targetUserIds = ids
        }
      }
    }

    /* Hämta subscriptions baserat på resolverade mottagare */
    let subsQuery = supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
      .is('revoked_at', null)

    if (targetUserIds) {
      subsQuery = subsQuery.in('user_id', targetUserIds)
    } else if (!broadcast) {
      const targetUserId: string = body.userId || caller.id
      subsQuery = subsQuery.eq('user_id', targetUserId)
    }

    const { data: subs, error: subsErr } = await subsQuery

    if (subsErr) throw subsErr

    if (!subs || subs.length === 0) {
      const ctx = propertyId ? 'fastigheten' : broadcast ? 'broadcast' : 'användaren'
      return json({ sent: 0, revoked: 0, message: 'Inga aktiva subscriptions för ' + ctx })
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
