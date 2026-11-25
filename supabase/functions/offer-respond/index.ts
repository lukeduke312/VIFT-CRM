/*
 * REPO-SYNK 2026-11-27 (G1/G4 del 2): denna fil är STAGING-versionen v10 (installerad
 * 2026-11-20, källa supabase/inventering/staging-2026-11-26/functions/offer-respond/index.ts)
 * plus beteenden från repots tidigare version (8ce588b, V48B3B0) som saknades i STAGING.
 * De är märkta "REPO-BEVARAT" nedan:
 *   1. Status 'ersatt' ger 410 { error: 'replaced' } (förkontroll före RPC:n).
 *   2. Ett giltigt lockedSnapshotJSON krävs (409 snapshot_unavailable), och kundens
 *      offerVersion jämförs mot snapshotens versionNumber (400 version_mismatch).
 *   3. In-app-notiser (vift_notifications) till aktiv personal med offer_manage/all när en
 *      offert godkänns. Skrivs nu med jämför-och-byt på updated_at (max 3 försök) i stället
 *      för repots ovillkorliga upsert av hela arrayen.
 * EJ bevarat (kräver ändring i RPC:n offer_respond_commit, alltså en ny migration):
 *   - approvedByPhone/approvedByPosition i customerApproval (RPC:n sparar dem inte),
 *   - repots regel att 'ändring-begärd' också räknas som redan besvarad (RPC:n spärrar
 *     bara 'godkänd'/'nekad'). En förkontroll i EF:n skulle bryta requestId-reprisen.
 * Förkontrollerna är olåsta läsningar; RPC:n gör sin egen låsta kontroll av allt annat.
 * Ändringarna är inte verifierade i STAGING. Se supabase/inventering/G1-G4-DEL2-RESULTAT.md.
 */
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
 * ÄNDRAT (samtidighetsrättning, FÖRSLAG v2, EJ INSTALLERAT):
 * Den tidigare direkta read→upsert av HELA vift_offers-arrayen (ingen
 * låsning, ingen CAS) är ersatt med ETT anrop till den nya, radlåsta
 * SECURITY DEFINER-funktionen public.offer_respond_commit() (se
 * 001_offer_respond_commit_v2.sql). Den funktionen gör HELA
 * läs-lås-validera-ändra-skriv-OCH-händelselogg-cykeln atomiskt i en
 * databastransaktion. Denna fil anropar bara RPC:n och mappar dess fel
 * till exakt samma HTTP-status/felkoder som tidigare. Push-notisen till
 * personalen rörs INTE av rättningen -- den är redan fire-and-forget,
 * body/CORS/rate-limit är oförändrade.
 *
 * ÄNDRAT IGEN (FÖRSLAG v3, EJ INSTALLERAT -- superseder v2:s fil):
 * Ett valfritt `requestId`-fält i body skickas nu vidare till RPC:n som
 * `p_request_id`, om det finns. Detta är en REN TILLÄGGSFUNKTION:
 * - Skickas inget `requestId` (fältet saknas, är tomt, eller inte en
 *   sträng) skickas `null` till RPC:n och beteendet är BYTE-FÖR-BYTE
 *   identiskt med v2 -- ingen ny gren körs någonstans.
 * - Den REDAN DRIFTSATTA, riktiga `offer-respond/index.ts` skickar INTE
 *   detta fält idag (bekräftat genom direkt läsning av den riktiga,
 *   aktuella källfilen, inte en rekonstruktion) -- denna ändring är alltså
 *   bakåtkompatibel med ALLA klienter som finns i produktion just nu.
 *   Den publika offertsidan (`public-offer.html`) måste uppdateras separat
 *   (utanför denna ändrings omfattning, väntar på riktig källa) för att
 *   faktiskt BÖRJA skicka ett `requestId` och få idempotensskyddet.
 * - RPC-svaret kan nu innehålla `isReplay: true` om anropet var en
 *   upprepning av ett redan genomfört svar med samma `requestId` -- denna
 *   fil mappar det till ett extra `replay: true`-fält i 200-svaret (själva
 *   statuskoden och övriga fält är oförändrade, så en klient som ignorerar
 *   fältet fungerar precis som idag).
 *
 * ÄNDRAT IGEN (FÖRSLAG v5, EJ INSTALLERAT -- superseder v3:s fil; v4 fick
 * ALDRIG en egen EF-fil byggd -- se KONSOLIDERAD_SLUTLEVERANS-rättningens
 * fynd 1, 2026-11-20, för bakgrunden):
 * - Två NYA fel som 001_offer_respond_commit_v5.sql (och den oförändrade
 *   logiken i v4) kan kasta mappas nu uttryckligen, istället för att falla
 *   igenom till den generiska 500 `internal_error`:
 *     `idempotency_key_conflict` -> 409 (samma requestId återanvänt med
 *       ANDRA parametrar -- klienten måste skicka ett NYTT requestId för
 *       detta genuint nya försök, inte samma som senast)
 *     `invalid_request_id` -> 400 (requestId längre än 128 tecken)
 * - EF:n gör nu SJÄLV samma 128-teckenskontroll FÖRE RPC-anropet (identisk
 *   gräns som SQL-funktionens egen, oberoende kontroll -- försvar i två
 *   lager, samma princip som redan används för övrig indatavalidering i
 *   denna fil). Det sparar en databasrunda för ett anrop som ändå skulle
 *   avvisas, och tar bort v3:s egen, nu inkonsekventa `.slice(0, 200)`-
 *   trunkering (som bara klippte värden längre än 200 tecken -- ett värde
 *   på 129-200 tecken slank igenom EF:n oförändrat och avvisades ändå av
 *   SQL-funktionens 128-gräns, men ett värde över 200 tecken hade tystats
 *   ned till 200 FÖRE SQL-kontrollen ens såg det -- förvirrande, nu rättat
 *   så att EF:n avvisar exakt samma gräns den SKICKAR vidare, ingen tyst
 *   trunkering någonstans).
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
 *   requestId?: string       — valfritt: stabilt klient-ID för att
 *                              deduplicera nätverksåterförsök av SAMMA
 *                              inskick. Skickas oförändrat vid en äkta
 *                              retry av samma försök; ett NYTT, avsiktligt
 *                              svar ska få ett NYTT requestId (eller inget).
 *                              Max 128 tecken. OBS (se slutrapportens
 *                              GO/NO-GO-avsnitt): fältnamnet `requestId` är
 *                              ett ANTAGANDE baserat på denna kodbas egen
 *                              camelCase-konvention -- den riktiga publika
 *                              klienten (`public-offer.html`) har INTE
 *                              kunnat hämtas (HTTP 401) och skickar enligt
 *                              bekräftad, oberoende läsning av den gamla
 *                              LIVE-filen INGET requestId-fält alls idag.
 *                              Detta fält måste alltså betraktas som EJ
 *                              VERIFIERAT mot en verklig klient tills
 *                              public-offer.html kan läsas.
 * }
 *
 * Svar 200: { ok: true, action, offerId, newStatus, replay?: true }
 * Svar 400: { error: 'invalid_action' | 'terms_required' | 'name_required' | 'version_mismatch' | 'invalid_request_id' }
 * Svar 403: { error: 'revoked' }
 * Svar 409: { error: 'idempotency_key_conflict' }
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

/* ── CORS + HTTP-säkerhetsrubriker ────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control':                'no-store, no-cache',
  'Referrer-Policy':              'no-referrer',
  'X-Content-Type-Options':       'nosniff',
  'X-Frame-Options':              'DENY',
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

  /* Valfritt idempotensnyckel-fält. Saknas det, eller är det inte en
     icke-tom sträng, blir det `null` -- och `null` till RPC:n innebär att
     INGEN idempotenslogik alls körs där (se SQL-filens egen motivering).
     ÄNDRAT (v5): ingen tyst `.slice()`-trunkering längre -- värdet skickas
     oförändrat vidare, och avvisas EXPLICIT nedan (och, oberoende, även av
     SQL-funktionens egen 128-gräns) om det är för långt. Se header-
     kommentaren för varför v3:s `.slice(0, 200)` var inkonsekvent. */
  const requestIdRaw = typeof body.requestId === 'string' ? body.requestId.trim() : ''
  const requestId: string | null = requestIdRaw ? requestIdRaw : null

  /* Validera input — OFÖRÄNDRAT från v2/v3 */
  if (!token || token.length < 32)             return json({ error: 'invalid_token' }, 400)
  if (!VALID_ACTIONS.includes(action as Action)) return json({ error: 'invalid_action' }, 400)
  if (!name)                                   return json({ error: 'name_required' }, 400)
  if (!email || !email.includes('@'))          return json({ error: 'email_required' }, 400)
  if (action === 'approve' && !agreedToTerms)  return json({ error: 'terms_required' }, 400)
  /* NYTT (v5): samma 128-teckensgräns som SQL-funktionen kontrollerar
     oberoende själv -- avvisas här FÖRE databasanropet, så ett redan dömt
     anrop inte ens behöver vänta ut ett eventuellt radlås i onödan. */
  if (requestId !== null && requestId.length > 128) {
    return json({ error: 'invalid_request_id' }, 400)
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })

    /* ÄNDRAT (v2): ett enda atomiskt RPC-anrop ersätter den tidigare
       read→validera→ändra→upsert→(separat)händelselogg-sekvensen.
       ÄNDRAT IGEN (v3): `p_request_id` skickas med -- `null` om klienten
       inte angav något, vilket är exakt v2:s beteende. */
    /* REPO-BEVARAT (1, 2): olåst förkontroll av ersatt offert och låst kundversion. */
    const { data: preRow, error: preErr } = await supabase
      .from('store').select('value').eq('key', 'vift_offers').maybeSingle()
    if (preErr) throw new Error('store-läsfel: ' + preErr.message)
    const preOffers: Record<string, unknown>[] = Array.isArray(preRow?.value) ? preRow.value as Record<string, unknown>[] : []
    const pre = preOffers.find(o => o.publicToken === token)
    let preSnapshot: Record<string, unknown> | null = null
    if (pre) {
      if (pre.status === 'ersatt') return json({ error: 'replaced' }, 410)
      preSnapshot = parseLockedSnapshot(pre.lockedSnapshotJSON, String(pre.id ?? ''))
      if (preSnapshot === null) return json({ error: 'snapshot_unavailable' }, 409)
      const lockedVersion = Number(preSnapshot.versionNumber) || 1
      if (lockedVersion !== (Number(body.offerVersion) || 1)) {
        return json({ error: 'version_mismatch', currentVersion: lockedVersion }, 400)
      }
    }

    const { data: rpcResult, error: rpcErr } = await supabase.rpc('offer_respond_commit', {
      p_token:          token,
      p_offer_version:  offerVersion,
      p_action:         action,
      p_name:           name,
      p_email:          email,
      p_comment:        comment,
      p_decline_reason: declineReason,
      p_ip:             ip,
      p_change_category: changeCategory,
      p_request_id:     requestId
    })

    if (rpcErr) {
      const msg = rpcErr.message || ''
      if (msg.includes('not_found'))        return json({ error: 'not_found' }, 404)
      if (msg.includes('revoked'))          return json({ error: 'revoked' }, 403)
      if (msg.includes('expired'))          return json({ error: 'expired' }, 410)
      if (msg.includes('already_answered')) {
        const statusPart = msg.split(':')[1]
        return json({ error: 'already_answered', status: statusPart }, 410)
      }
      if (msg.includes('version_mismatch')) {
        const currentVersionPart = msg.split(':')[1]
        return json({
          error: 'version_mismatch',
          currentVersion: currentVersionPart ? Number(currentVersionPart) : undefined
        }, 400)
      }
      if (msg.includes('invalid_action'))   return json({ error: 'invalid_action' }, 400)
      if (msg.includes('name_required'))    return json({ error: 'name_required' }, 400)
      if (msg.includes('invalid_token'))    return json({ error: 'invalid_token' }, 400)
      /* NYTT (v5): de två nya felen från 001_offer_respond_commit_v5.sql
         (v4:s fingeravtrycks-/längdlogik, oförändrad här). 409 för
         idempotency_key_conflict: klienten återanvände ett requestId med
         ANDRA parametrar än originalanropet -- den riktiga orsaken är ett
         klientfel (fel/återanvänt ID), inte en serverkonflikt med
         offertens eget tillstånd (det är redan 410 already_answered).
         400 för invalid_request_id: borde i praktiken aldrig nås här
         eftersom EF:n redan avvisar samma gräns ovan FÖRE detta anrop --
         kvar som ett andra skyddslager om SQL-funktionens gräns någon gång
         ändras utan att EF:ens egen hinner följa med. */
      if (msg.includes('idempotency_key_conflict')) return json({ error: 'idempotency_key_conflict' }, 409)
      if (msg.includes('invalid_request_id'))        return json({ error: 'invalid_request_id' }, 400)
      throw new Error('offer_respond_commit-fel: ' + msg)
    }

    const offerId    = rpcResult?.offerId as string
    const newStatus  = rpcResult?.newStatus as string
    const offerTitle = (rpcResult?.offerTitle as string) || offerId
    const isReplay   = rpcResult?.isReplay === true

    /* NYTT (v3): vid en äkta repris (samma requestId som redan committats)
       är statusändringen och händelseloggen redan gjorda sedan tidigare --
       en ny push-notis till personalen skulle bara vara brus (personalen
       har redan notifierats en gång för detta svar). Skicka INTE push på
       en repris. Vid ett genuint nytt svar (isReplay === false, exakt v2:s
       enda fall när requestId saknas) är detta oförändrat. */
    if (!isReplay) {
      await sendPushToVift(supabase, {
        action,
        offerId,
        customerName: name,
        offerTitle
      })
      /* REPO-BEVARAT (3): in-app-notis vid godkännande. */
      if (action === 'approve') {
        await sendInAppNotifications(supabase, {
          offerId,
          offerTitle: String(preSnapshot?.title || '') || offerTitle,
          customerId: String(pre?.customerId || ''),
          customerName: String(preSnapshot?.customerName || pre?.customerName || ''),
          version: Number(rpcResult?.offerVersion) || 1,
          approvedBy: name,
          now: String(rpcResult?.answeredAt || new Date().toISOString())
        })
      }
    }

    return json({
      ok:        true,
      action,
      offerId,
      newStatus,
      ...(isReplay ? { replay: true } : {})
    })

  } catch (err: unknown) {
    console.error('[offer-respond] fel:', err)
    return json({ error: 'internal_error' }, 500)
  }
})

/* REPO-BEVARAT (2): samma snapshotkrav som offer-token-validate/offer-public-pdf. */
function parseLockedSnapshot(raw: unknown, offerId: string): Record<string, unknown> | null {
  try {
    if (!raw) return null
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const snap = parsed as Record<string, unknown>
    if (String(snap.id ?? '') !== offerId) return null
    if (!Array.isArray(snap.lines) || !Array.isArray(snap.extras) || !Array.isArray(snap.publicAttachmentIds)) return null
    return snap
  } catch { return null }
}

/* REPO-BEVARAT (3): in-app-notiser till personal med offer_manage/all. Mottagare,
   meddelandetext och idempotenta notis-id är oförändrade från repots version (V48B3B0).
   Skrivningen är ändrad till jämför-och-byt på store.updated_at, så att en samtidig
   skrivning (t.ex. en användare som markerar en notis som läst) inte skrivs över.
   Fel loggas och stoppar aldrig kundens svar. */
async function sendInAppNotifications(
  supabase: ReturnType<typeof createClient>,
  opts: { offerId: string; offerTitle: string; customerId: string; customerName: string; version: number; approvedBy: string; now: string }
): Promise<void> {
  try {
    const [staffRow, rolesRow, custRow] = await Promise.all([
      supabase.from('store').select('value').eq('key', 'vift_staff').maybeSingle(),
      supabase.from('store').select('value').eq('key', 'vift_roles').maybeSingle(),
      supabase.from('store').select('value').eq('key', 'vift_customers').maybeSingle()
    ])
    if (staffRow.error) { console.error('[offer-respond] staff-läsfel:', staffRow.error.message); return }
    if (rolesRow.error) { console.error('[offer-respond] roles-läsfel:', rolesRow.error.message); return }
    if (custRow.error) console.warn('[offer-respond] kund-läsfel:', custRow.error.message)

    const staff: Record<string, unknown>[] = Array.isArray(staffRow.data?.value) ? staffRow.data.value as Record<string, unknown>[] : []
    const roles: Record<string, unknown>[] = Array.isArray(rolesRow.data?.value) ? rolesRow.data.value as Record<string, unknown>[] : []
    const rolePerms = new Map<string, string[]>()
    for (const r of roles) if (r.id && Array.isArray(r.permissions)) rolePerms.set(r.id as string, r.permissions as string[])
    const eligible = staff.filter(s => {
      if (s.active === false || s.deleted) return false
      const perms = rolePerms.get(s.role as string) ?? []
      return perms.includes('offer_manage') || perms.includes('all')
    })
    if (eligible.length === 0) return

    let customerName = opts.customerName
    if (!customerName && opts.customerId) {
      const customers: Record<string, unknown>[] = Array.isArray(custRow.data?.value) ? custRow.data.value as Record<string, unknown>[] : []
      const cust = customers.find(c => c.id === opts.customerId)
      if (cust) {
        if (cust.type === 'privat') customerName = [cust.firstName, cust.lastName].filter(Boolean).join(' ')
        if (!customerName) customerName = String(cust.name || '')
      }
    }
    const dateLabel = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Stockholm', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(new Date(opts.now))
    const titlePart    = opts.offerTitle !== opts.offerId ? `${opts.offerTitle} (${opts.offerId})` : opts.offerId
    const customerPart = customerName ? ` – kund: ${customerName}` : ''
    const message      = `${titlePart} godkänd av ${opts.approvedBy}${customerPart} · ${dateLabel}`

    for (let attempt = 1; attempt <= 3; attempt++) {
      const { data: notifRow, error: notifErr } = await supabase
        .from('store').select('value, updated_at').eq('key', 'vift_notifications').maybeSingle()
      if (notifErr) { console.error('[offer-respond] notif-läsfel — avbryter utan skrivning:', notifErr.message); return }
      if (notifRow !== null && !Array.isArray(notifRow?.value)) { console.error('[offer-respond] notisdata har ogiltigt format — avbryter utan skrivning'); return }
      const existing: Record<string, unknown>[] = Array.isArray(notifRow?.value) ? notifRow!.value as Record<string, unknown>[] : []
      const existingIds = new Set(existing.map(n => n.id as string))
      const newNotifs: Record<string, unknown>[] = []
      for (const s of eligible) {
        const notifId = `N-offer-approved-${opts.offerId}-v${opts.version}-${String(s.id)}`
        if (existingIds.has(notifId)) continue
        newNotifs.push({ id: notifId, userId: s.id, type: 'offer_approved', message, aoId: '', offerId: opts.offerId, read: false, createdAt: opts.now })
      }
      if (newNotifs.length === 0) return
      const next = [...newNotifs, ...existing].slice(0, 5_000)
      if (notifRow === null) {
        const { error } = await supabase.from('store').insert({ key: 'vift_notifications', value: next })
        if (!error) return
      } else {
        let q = supabase.from('store').update({ value: next, updated_at: new Date().toISOString() }).eq('key', 'vift_notifications')
        q = notifRow.updated_at === null ? q.is('updated_at', null) : q.eq('updated_at', notifRow.updated_at)
        const { data, error } = await q.select('key')
        if (!error && Array.isArray(data) && data.length === 1) return
        if (error) console.warn('[offer-respond] notisskrivfel, försök', attempt, ':', error.message)
      }
    }
    console.error('[offer-respond] in-app-notis kunde inte sparas efter 3 försök (samtidiga skrivningar)')
  } catch (e) {
    console.warn('[offer-respond] sendInAppNotifications fel:', e)
  }
}

/* ── Pushnotis till VIFT-personal — OFÖRÄNDRAT ────────────── */
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}