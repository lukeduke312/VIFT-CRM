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
 *   aoId        string?  — V42 §9: vidarebefordras oförändrat i push-payloaden
 *                          (max 64 tecken) så service worker kan navigera
 *                          direkt till AO:t vid klick när appen redan är öppen
 *   testEndpoint string? — V44 §3: riktar sändningen mot EXAKT en enskild,
 *                          anroparens EGEN, icke-revokerade endpoint (diagnostik).
 *                          Ignorerar propertyId/broadcast/userId helt. Om endpointen
 *                          inte hör till caller.id → 403, ingen fallback.
 *
 * Svar (normalflöde):
 *   { sent: number, revoked: number }
 * Svar (testEndpoint-flöde):
 *   { sent: number, revoked: number, diagnostics: { statusCode, apnsId, provider, endpointSuffix, body } }
 *   — diagnostics avslöjar ALDRIG p256dh/auth_key/JWT/VAPID-nycklar eller
 *   hela endpointen (bara de sista 10 tecknen).
 *
 * V43: push-payloaden som skickas till webpush.sendNotification() är nu
 * Declarative Web Push-kompatibel (Apple/WebKit, iOS/iPadOS 18.4+):
 *   { web_push: 8030, notification: { title, body, navigate, silent }, aoId }
 * `notification.navigate` är alltid en ABSOLUT URL på VIFT CRM-produktionsorigin
 * (https://crm.viftfast.se) — byggd från den redan relativpath-validerade `url`,
 * aldrig från en extern/klienttillhandahållen origin. Äldre browsers/webkit utan
 * stöd för declarative push hanterar samma JSON i service-worker.js:s push-handler
 * (backward-compat, se där).
 *
 * V44: sendNotification() anropas nu med { TTL: 60, urgency: 'high' } (verifierat
 * stöd i web-push@3.6.7 enligt uppdragets §5) — gäller både testEndpoint-vägen
 * och normala VIFT-notiser. Ingen ändring av VAPID-nycklar/secrets.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @deno-types="npm:@types/web-push@3.6.3"
import webpush from 'npm:web-push@3.6.7'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'

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

/* V43: produktionsorigin för `notification.navigate` — ALDRIG klienttillhandahållen.
 * `url` (se nedan) är redan validerad till en relativ sökväg (startar med '/' eller
 * tom sträng) innan den når hit, så konkatenering här kan inte producera en extern
 * redirect eller en javascript:-URL. */
const CRM_ORIGIN = 'https://crm.viftfast.se'

/* V44-HELPERS-START — extraheras ordagrant av testsviten.
 * V44 §4/§7: diagnostikhjälpare för den riktade testvägen. Läser ALDRIG ut
 * eller loggar p256dh/auth_key/JWT/VAPID-nycklar/hela endpoints — bara ett
 * proveniens-gissat providernamn, värdhostnamn (indirekt via provider) och
 * de sista tecknen av endpointen som identifierare. */
function detectProvider(endpoint: string): string {
  try {
    const host = new URL(endpoint).hostname
    if (host.includes('web.push.apple.com'))                                  return 'apple'
    if (host.includes('fcm.googleapis.com') || host.includes('android.googleapis.com')) return 'google'
    if (host.includes('push.services.mozilla.com') || host.includes('mozilla.com'))      return 'mozilla'
    return host
  } catch { return 'unknown' }
}

function endpointSuffix(endpoint: string): string {
  return typeof endpoint === 'string' ? endpoint.slice(-10) : ''
}

/* Case-insensitiv header-läsning — web-push@3.6.7s sendNotification()-resultat
 * (och fel-objekt vid kastade exceptions) kan ha headers som ett vanligt
 * objekt; Apple/APNs skickar tillbaka `apns-id`, ibland med annan casing. */
function extractApnsId(headers: unknown): string | null {
  if (!headers || typeof headers !== 'object') return null
  const h = headers as Record<string, unknown>
  for (const k of Object.keys(h)) {
    if (k.toLowerCase() === 'apns-id') {
      const v = h[k]
      return typeof v === 'string' ? v : (v != null ? String(v) : null)
    }
  }
  return null
}

/* Trunkerar provider-svarskroppen säkert innan den skickas till klienten —
 * det här är push-providerns EGET textsvar (t.ex. "BadDeviceToken" från
 * APNs), aldrig subscription-nycklar eller annan känslig data. */
function safeTruncate(s: string, max: number): string {
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}
/* V44-HELPERS-END */

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

    /* Kontrollera aktiv VIFT-användare + personal + roll */
    const auth = await checkViftAuth(supabase, jwt, CORS)
    if (!auth.ok) return auth.response
    const { user: caller, userEmail: callerEmail, perms } = auth

    /* Läs request body */
    /* V43-URLBLOCK-START — extraheras ordagrant av testsviten (run-tests-v43.js)
       för att köra DEN FAKTISKA valideringen, inte en omskriven kopia. */
    const body      = await req.json().catch(() => ({}))
    const title     = (body.title      || 'VIFT CRM').slice(0, 100)
    const text      = (body.body       || '').slice(0, 300)
    const rawUrl    = String(body.url || '/').slice(0, 500)
    /* Tillåt bara relativa sökvägar eller samma origin — blockera javascript: och externa adresser */
    const url       = rawUrl.startsWith('/') || rawUrl === '' ? rawUrl : '/'
    /* V43-URLBLOCK-END */
    const propertyId: string | null = body.propertyId || null
    const broadcast = body.broadcast === true
    /* V42 §9: vidarebefordra aoId till service workerns push-payload så
       att ett klick på notisen kan navigera till rätt AO när CRM redan är
       öppet (service-worker.js läser payload.aoId och postMessage:ar
       OPEN_AO — se index.html:641). Endast bunden, redan validerad
       stränglängd vidarebefordras; ingen ny behörighetslogik. */
    /* V43-AOIDBLOCK-START */
    const aoIdRaw = body.aoId
    const aoId: string | null = (typeof aoIdRaw === 'string' && aoIdRaw.length > 0 && aoIdRaw.length <= 64) ? aoIdRaw : null
    /* V43-AOIDBLOCK-END */

    /* V43-PAYLOAD-BLOCK-START — extraheras ordagrant av testsviten.
     * Declarative Web Push-format (RFC 8030 / WebKit iOS 18.4+).
     * `navigate` är ALLTID absolut på CRM_ORIGIN — `url` kan här bara vara en
     * redan validerad relativ sökväg eller tom sträng (se valideringen ovan),
     * så det finns ingen möjlighet till extern redirect eller javascript:-injektion.
     * `notification.title` kan aldrig vara tom — `title` har redan fallback 'VIFT CRM'. */
    const navigateUrl = CRM_ORIGIN + (url || '/')
    const payload = JSON.stringify({
      web_push: 8030,
      notification: {
        title,
        body: text,
        navigate: navigateUrl,
        silent: false
      },
      /* Bakåtkompatibel/VIFT-specifik metadata — läses av service-worker.js:s
         legacy-fallback och av notificationclick → OPEN_AO (oförändrat sedan V42). */
      aoId
    })
    /* V43-PAYLOAD-BLOCK-END */

    /* V44 §3: riktad endpoint för diagnostik-testväg (Admin → Notiser →
       "Skicka testnotis" riktar sig nu mot EXAKT den aktuella browserns
       endpoint, se PushService.sendTest()). Flyttad hit — direkt efter
       payload-konstruktionen — så att testEndpoint-grenen nedan kan
       returnera tidigt UTAN att någonsin nå broadcast/propertyId/userId-
       resolutionen. */
    /* V44-TESTENDPOINT-START */
    const testEndpointRaw = body.testEndpoint
    const testEndpoint: string | null = (typeof testEndpointRaw === 'string' && testEndpointRaw.length > 0 && testEndpointRaw.length <= 2000) ? testEndpointRaw : null
    /* V44-TESTENDPOINT-END */

    /* V44-TESTENDPOINT-FLOW-START — extraheras ordagrant av testsviten
       (run-tests-v44.js) och körs mot mockad supabase/webpush för att
       verifiera DEN FAKTISKA säkerhets- och diagnostiklogiken. */
    if (testEndpoint) {
      /* SÄKERHETSKRAV (V44 §3): endast anroparens EGEN, icke-revokerade
       * endpoint accepteras. Ingen fallback till broadcast eller till en
       * annan användares subscription — om exakt denna endpoint inte finns
       * för exakt denna user_id, avvisas hela anropet med 403. Denna gren
       * läser eller använder ALDRIG body.propertyId/body.broadcast/body.userId. */
      const { data: ownSub, error: ownSubErr } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth_key')
        .eq('endpoint', testEndpoint)
        .eq('user_id', caller.id)
        .is('revoked_at', null)
        .maybeSingle()

      if (ownSubErr) throw ownSubErr
      if (!ownSub) {
        return json({ error: 'Okänd eller ej tillgänglig endpoint för denna användare.' }, 403)
      }

      /* V44 §4/§5: fångar den råa svarskroppen från push-providern och
       * applicerar TTL/urgency (nu verifierat stödda av web-push@3.6.7 enligt
       * uppdragets §5 — ingen ändring av VAPID-nycklar/secrets). */
      const diagnostics: { statusCode: number | null; apnsId: string | null; provider: string; endpointSuffix: string; body: string } = {
        statusCode: null,
        apnsId: null,
        provider: detectProvider(ownSub.endpoint),
        endpointSuffix: endpointSuffix(ownSub.endpoint),
        body: ''
      }
      let sentCount = 0
      let revokedCount = 0

      try {
        const result = await webpush.sendNotification(
          { endpoint: ownSub.endpoint, keys: { p256dh: ownSub.p256dh, auth: ownSub.auth_key } },
          payload,
          { TTL: 60, urgency: 'high' }
        )
        sentCount = 1
        const r = result as { statusCode?: number; headers?: unknown; body?: unknown }
        diagnostics.statusCode = typeof r?.statusCode === 'number' ? r.statusCode : 201
        diagnostics.apnsId = extractApnsId(r?.headers)
        diagnostics.body = safeTruncate(String(r?.body ?? ''), 200)
      } catch (err: unknown) {
        const e = err as { statusCode?: number; headers?: unknown; body?: unknown; message?: string }
        diagnostics.statusCode = typeof e?.statusCode === 'number' ? e.statusCode : null
        diagnostics.apnsId = extractApnsId(e?.headers)
        diagnostics.body = safeTruncate(String(e?.body ?? e?.message ?? ''), 200)
        if (e?.statusCode === 410 || e?.statusCode === 404) {
          revokedCount = 1
          await supabase.from('push_subscriptions').update({ revoked_at: new Date().toISOString() }).eq('id', ownSub.id)
        } else {
          console.error('[send-push] diagnostik-fel för endpoint (suffix):', endpointSuffix(ownSub.endpoint), err)
        }
      }

      return json({ sent: sentCount, revoked: revokedCount, diagnostics })
    }
    /* V44-TESTENDPOINT-FLOW-END */

    /* Roll-kontroll: broadcast kräver 'all'-behörighet */
    if (broadcast && !hasPerm(perms, 'all')) {
      return json({ error: 'Broadcast kräver admin-behörighet' }, 403)
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
      /* body.userId får bara peka på en annan användare om anroparen har 'all' (admin).
       * Annars begränsas till egna enheter för att förhindra IDOR. */
      const requestedId: string | undefined = body.userId
      const targetUserId: string = (requestedId && requestedId !== caller.id && hasPerm(perms, 'all'))
        ? requestedId
        : caller.id
      subsQuery = subsQuery.eq('user_id', targetUserId)
    }

    const { data: subs, error: subsErr } = await subsQuery

    if (subsErr) throw subsErr

    if (!subs || subs.length === 0) {
      const ctx = propertyId ? 'fastigheten' : broadcast ? 'broadcast' : 'användaren'
      return json({ sent: 0, revoked: 0, message: 'Inga aktiva subscriptions för ' + ctx })
    }

    /* `payload` byggd tidigare (se V43-PAYLOAD-BLOCK ovan, flyttad i V44 så
       att testEndpoint-grenen kan använda samma payload och returnera innan
       den här mottagarlistan ens hämtas). */
    const revokedIds: string[] = []
    let sent = 0

    /* V44 §5: TTL/urgency NU VERIFIERAT stödda av web-push@3.6.7 (uppdragets
     * egen bekräftelse — se rapportens §5/§11). Appliceras här på ALLA VIFT-
     * notiser (inte bara diagnostik-testvägen), ingen ändring av VAPID-
     * nycklar/secrets. */
    const SEND_OPTIONS = { TTL: 60, urgency: 'high' as const }

    /* Skicka till alla enheter parallellt */
    await Promise.allSettled(
      subs.map(async (sub: { id: string; endpoint: string; p256dh: string; auth_key: string }) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth_key }
            },
            payload,
            SEND_OPTIONS
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
