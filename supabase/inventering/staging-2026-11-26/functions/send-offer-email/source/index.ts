/**
 * send-offer-email — Supabase Edge Function (v5, FÖRSLAG v8 -- EJ INSTALLERAT)
 *
 * Skickar offert-e-post via Resend API.
 * Sparar händelselogg (offerEvents) i Supabase.
 *
 * SÄKERHETSREGLER:
 * - Resend API-nyckel ALDRIG i frontend — lives only here
 * - Kräver giltigt Supabase-JWT + aktiv VIFT-användare + offer_manage
 * - sentBy härleds från verifierad staffMember.id — klientvärde ignoreras
 * - offerToken hanteras helt server-side — klientvärde ignoreras
 * - offerVersion härleds från targetOffer.versionNumber — klientvärde ignoreras
 * - Offert-länk byggs alltid till public-offer.html?t=<token>
 * - Idempotens kontrolleras INNAN token/snapshot/bilagor sparas
 * - Rate-limit: max 10 sändningar / minut per user
 * - Bilagor valideras INNAN någon DB-skrivning sker
 *
 * Token-logik (tre fall):
 *   A. Aktiv token + giltigt snapshot → återanvänd
 *   B. Aktiv token men snapshot saknas/ogiltigt/ofullständigt → skapa snapshot + lås bilagor
 *   C. Ingen aktiv token               → ny token + snapshot + bilagelås
 *
 * ÄNDRAT i detta FÖRSLAG (jämfört med STAGING:s driftsatta v5): själva
 * BESLUTET om vilket av de tre fallen som gäller, OCH skrivningen av det
 * beslutet, görs i EN ENDA atomisk databasoperation:
 * `public.offer_email_prepare_commit(offerId)` (se
 * 003_offer_email_prepare_commit_v3.sql). RPC:n tar radlås FÖRE den gör
 * sitt A/B/C-beslut, mot den nu garanterat aktuella raden — exakt samma
 * disciplin som redan etablerad för offer_respond_commit i detta uppdrag.
 *
 * ÄNDRAT IGEN (v2 av denna fil, efter den externa acceptansgranskningen
 * 2026-11-20, fynd 4): v1 lät EF:en SJÄLV läsa kundnamn och publika
 * bilage-ID:n INNAN RPC:ns lås togs -- en verklig felkopplingsrisk om
 * offertens customerId eller en bilagas synlighet hann ändras i det
 * fönstret. v1 lämnade också lockOfferAttachments() kvar som en EGEN,
 * olåst whole-array-upsert av vift_offerAttachments.
 *
 * RPC:n (v2) gör nu BÅDA dessa saker SJÄLV, atomiskt, i EN konsekvent
 * låsordning (vift_offers FÖRE vift_offerAttachments, alltid i den
 * ordningen): härleder customerId/kundnamn från den LÅSTA offert-raden,
 * beräknar publicAttachmentIds mot den LÅSTA attachments-raden, och låser
 * (sätter lockedInVersion på) ännu olåsta, aktiva bilagor i samma
 * transaktion som vift_offers-skrivningen. Signaturen är därför förenklad
 * till enbart `p_offer_id` -- `p_customer_name`/`p_locked_attachment_ids`
 * behövs inte längre som indata. `lockOfferAttachments()` och den tidiga,
 * olåsta kund-/bilage-läsningen är BORTA från denna fil helt (inte bara
 * skyddade) -- se 003_offer_email_prepare_commit_v3.sql för den fullständiga
 * motiveringen och SEND_OFFER_EMAIL_FIX_V3.md för vad som är bevisat.
 *
 * ÄNDRAT IGEN (v3 av denna fil, avgränsad dataintegritetsfråga,
 * 2026-11-20): `resolvedVersion` (offertens versionsnummer) läses OLÅST,
 * FÖRE RPC-anropet, för idempotenskontrollen och för händelseloggens
 * `offerVersion`-fält. Om offertens version hann ändras mellan den
 * läsningen och RPC:ns lås skulle händelseloggen tyst kunna registrera FEL
 * version jämfört med det snapshot som faktiskt byggdes/skickades. RPC:n
 * returnerar nu sitt EGET, faktiska `offerVersion` (från den rad den
 * låste); denna fil jämför det mot `resolvedVersion` OMEDELBART efter
 * RPC-anropet, FÖRE allt annat (offertlänk, e-postinnehåll, Resend-anrop),
 * och avbryter explicit med `offer_version_changed` (409) vid avvikelse --
 * se den kommentaren vid jämförelsen för den fullständiga motiveringen.
 * Inget annat i filen är ändrat i v3.
 *
 * Anrop: POST /functions/v1/send-offer-email
 * Headers: Authorization: Bearer <supabase-jwt>
 * Body: {
 *   offerId:        string
 *   recipients:     (string | { email, name? })[]
 *   cc?:            string[]
 *   bcc?:           string[]
 *   subject:        string
 *   bodyHtml:       string
 *   templateId?:    string
 *   attachmentIds?: string[]
 * }
 *
 * Svar 200: {
 *   ok, messageId, sentAt, offerToken, tokenExpiresAt, offerLink,
 *   offerPatch: { publicToken, tokenCreatedAt, tokenExpiresAt, tokenRevokedAt,
 *                 openCount, openedAt, lockedSnapshotJSON, updatedAt },
 *   attachmentPatches: [{ id, lockedInVersion }],
 *   emailEvent: { ...hela den sparade händelseposten... }
 * }
 * Svar 400: { error: 'missing_fields' | 'invalid_recipient' | 'attachment_validation_failed', detail }
 * Svar 401: { error: 'unauthorized' }
 * Svar 403: { error: 'forbidden' }
 * Svar 404: { error: 'offer_not_found' }
 * Svar 409: { error: 'already_sent', detail } | { error: 'offer_version_changed', detail, checkedVersion, currentVersion }
 * Svar 429: { error: 'rate_limited' }
 * Svar 500: { error: 'send_failed' | 'token_save_failed', detail,
 *             offerPatch, attachmentPatches, emailEvent, offerToken, tokenExpiresAt, offerLink }
 *   OBS (v2): 'attachment_lock_failed' finns inte längre som ett EGET fel --
 *   en misslyckad bilagelåsning är nu en del av offer_email_prepare_commit()s
 *   enda transaktion och ger, om den av någon anledning misslyckas, samma
 *   generiska 'token_save_failed' som alla andra fel i den transaktionen
 *   (atomicitet: allt eller inget, se RPC:n).
 *
 * checkViftAuth() → ViftAuthOk: { ok: true, user, userEmail, staffMember, perms }
 *   staffMember garanterat definierat när ok === true (saknat staffMember → { ok: false })
 *   staffMember.id = business-ID (t.ex. 'ST-001'), används som sentBy
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY')            ?? ''
const FROM_EMAIL       = Deno.env.get('FROM_EMAIL')                ?? 'offert@viftfast.se'
const FROM_NAME        = Deno.env.get('FROM_NAME')                 ?? 'VIFT Fastighetsservice'
const PUBLIC_BASE_URL  = Deno.env.get('PUBLIC_BASE_URL')           ?? 'https://staging-crm.viftfast.se'

/* ── STAGING fail-closed-spärr mot verkliga externa utskick ──────
   Miljöidentifiering sker ENDAST via SUPABASE_URL — den enda
   miljövariabel som Supabase själv injicerar per projekt och som en
   utvecklare inte normalt skriver över. Medvetet INTE baserat på:
   Origin-header, mottagaradress, eller PUBLIC_BASE_URL (en separat,
   manuellt satt variabel som redan har ett STAGING-liknande
   default-värde i denna fil och därför INTE är ett tillförlitligt
   miljösignal). Allowlist, inte denylist: ENDAST produktionens kända
   projekt-ref tillåter faktiska utskick — varje annat värde (STAGING:s
   egna ref, ett okänt/felkonfigurerat projekt, eller ett tomt
   SUPABASE_URL) blockerar som standard. Detta rör INTE LIVE: samma
   kod tillåter LIVE:s utskick precis som idag, eftersom LIVE:s
   SUPABASE_URL matchar allowlisten. */
const PRODUCTION_SUPABASE_HOST = 'hjplzjsbbowiyoyhdghc.supabase.co'

function isProductionEnvironment(): boolean {
  try {
    return new URL(SUPABASE_URL).host === PRODUCTION_SUPABASE_HOST
  } catch {
    return false
  }
}

function stagingBlockedResponse() {
  return err({ error: 'blocked_in_staging' }, 403)
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/* ── Rate-limit ─────────────────────────────────────────── */
const _rateMap = new Map<string, { count: number; windowStart: number }>()
const RATE_WINDOW_MS = 60_000
const RATE_MAX       = 10

function checkRate(key: string): boolean {
  const now  = Date.now()
  const slot = _rateMap.get(key)
  if (!slot || now - slot.windowStart > RATE_WINDOW_MS) {
    _rateMap.set(key, { count: 1, windowStart: now })
    return true
  }
  if (slot.count >= RATE_MAX) return false
  slot.count++
  return true
}

/* ── JSON responses ─────────────────────────────────────── */
function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
function err(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/* ── Validera e-post ────────────────────────────────────── */
function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function normalizeRecipient(r: string | { email: string; name?: string }) {
  if (typeof r === 'string') return { email: r.trim(), name: undefined }
  return { email: (r.email || '').trim(), name: r.name }
}

/* displayCustomerName() BORTTAGEN (v2) -- kundnamnet härleds nu av
   offer_email_prepare_commit() själv, i SQL, mot den LÅSTA customerId som
   kommer ur den LÅSTA offert-raden. Se 003_offer_email_prepare_commit_v3.sql. */

/* ── Förbered valda mejlbilagor — körs INNAN DB-skrivningar ── */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function prepareAttachmentsForEmail(
  allAtts:       Record<string, unknown>[],
  attachmentIds: string[],
  offerId:       string,
  supabase:      ReturnType<typeof createClient>
): Promise<
  { valid: true; attachments: Array<{ filename: string; content: string }> } |
  { valid: false; detail: string }
> {
  const attachments: Array<{ filename: string; content: string }> = []

  for (const id of attachmentIds) {
    const att = allAtts.find(a => String(a.id ?? '') === id) as Record<string, unknown> | undefined
    if (!att) return { valid: false, detail: `Bilaga ${id} hittades inte` }
    if (String(att.offerId ?? '') !== offerId) return { valid: false, detail: `Bilaga ${id} tillhör inte offert ${offerId}` }
    if (att.active === false) return { valid: false, detail: `Bilaga ${id} är inaktiv` }

    const storagePath = String(att.storagePath ?? '')
    if (!storagePath.startsWith('offer-attachments/') || storagePath.includes('..') || storagePath.includes('//')) {
      return { valid: false, detail: `Bilaga ${id} har ogiltig storagePath` }
    }
    const pathInBucket = storagePath.slice('offer-attachments/'.length)
    if (!pathInBucket) return { valid: false, detail: `Bilaga ${id} saknar storagePath` }

    const { data: signedData, error: signedError } = await supabase.storage
      .from('offer-attachments')
      .createSignedUrl(pathInBucket, 60)
    if (signedError || !signedData?.signedUrl) {
      return { valid: false, detail: `Bilaga ${id} går inte att signera i storage` }
    }

    try {
      const fileRes = await fetch(signedData.signedUrl)
      if (!fileRes.ok) {
        return { valid: false, detail: `Bilaga ${id} går inte att hämta från storage (HTTP ${fileRes.status})` }
      }
      const buf = await fileRes.arrayBuffer()
      attachments.push({
        filename: String(att.originalFileName ?? att.displayName ?? id),
        content: arrayBufferToBase64(buf),
      })
    } catch (e) {
      return { valid: false, detail: `Bilaga ${id} går inte att hämta från storage: ${String(e)}` }
    }
  }

  return { valid: true, attachments }
}

/* lockOfferAttachments() BORTTAGEN (v2) -- bilagelåsningen görs nu av
   offer_email_prepare_commit() själv, atomiskt, i samma transaktion/lås
   som vift_offers-skrivningen. Se 003_offer_email_prepare_commit_v3.sql. */

/* ── Huvudhanterare ─────────────────────────────────────── */
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return err({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return err({ error: 'unauthorized' }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  /* checkViftAuth() garanterar staffMember när ok === true */
  const viftAuth = await checkViftAuth(supabase, jwt, CORS)
  if (!viftAuth.ok) return viftAuth.response
  const { user, staffMember, perms } = viftAuth

  if (!hasPerm(perms, 'offer_manage')) return err({ error: 'forbidden' }, 403)
  if (!checkRate(user.id))             return err({ error: 'rate_limited' }, 429)

  /* ── STAGING-spärr ────────────────────────────────────────
     Placerad EFTER auth/behörighet/rate-limit (bevarade oförändrade,
     krav 6) men INNAN allt annat i detta anrop: body-parsning,
     tokenändringar, snapshot-sparning, bilagelåsning,
     händelseloggning och Resend-anropet (krav 3). Ingen av dessa
     körs någonsin om miljön inte är produktion — därmed sker heller
     ingen affärsdatabasskrivning och inget Resend-anrop (krav 9). */
  if (!isProductionEnvironment()) return stagingBlockedResponse()

  /* sentBy = staffMember.id (business-ID, t.ex. 'ST-001') — aldrig klientvärde */
  const sentBy = String(staffMember.id ?? user.id)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return err({ error: 'invalid_json' }, 400) }

  const {
    offerId, recipients, cc, bcc,
    subject, bodyHtml, attachmentIds, templateId
  } = body as {
    offerId:        string
    recipients:     (string | { email: string; name?: string })[]
    cc?:            string[]
    bcc?:           string[]
    subject:        string
    bodyHtml:       string
    attachmentIds?: string[]
    templateId?:    string
  }

  /* offerVersion ignoreras från klienten — härleds server-side ur targetOffer.versionNumber */

  if (!offerId || !subject || !bodyHtml) {
    return err({ error: 'missing_fields', detail: 'offerId, subject, bodyHtml krävs' }, 400)
  }
  if (!Array.isArray(recipients) || !recipients.length) {
    return err({ error: 'missing_fields', detail: 'Minst en mottagare krävs' }, 400)
  }
  if (cc !== undefined && !Array.isArray(cc)) return err({ error: 'invalid_cc' }, 400)
  if (bcc !== undefined && !Array.isArray(bcc)) return err({ error: 'invalid_bcc' }, 400)
  if (attachmentIds !== undefined && !Array.isArray(attachmentIds)) {
    return err({ error: 'invalid_attachment_ids' }, 400)
  }
  if (String(subject).length > 200)      return err({ error: 'subject_too_long' }, 400)
  if (String(bodyHtml).length > 200_000) return err({ error: 'body_too_large' }, 400)

  const attachmentIdList = Array.from(new Set(
    (attachmentIds ?? []).map(id => String(id).trim()).filter(Boolean)
  ))
  const normalizedTo = recipients.map(normalizeRecipient)
  for (const r of normalizedTo) {
    if (!isValidEmail(r.email)) {
      return err({ error: 'invalid_recipient', detail: `Ogiltig e-postadress: ${r.email}` }, 400)
    }
  }

  if (!RESEND_API_KEY) return err({ error: 'provider_not_configured' }, 500)

  /* Offerten självt läses här EN gång, OLÅST, ENDAST för att slå upp
     resolvedVersion (för idempotenskontrollen nedan och det slutliga
     emailEvent-fältet) och för en snabb 404 om offerten inte finns alls --
     INTE för att fatta några A/B/C- eller kundnamnsbeslut (det gör
     offer_email_prepare_commit() själv, mot sin EGEN LÅSTA läsning, se
     RPC-anropet nedan). Denna enda, smala användning av en tidig läsning
     är OFÖRÄNDRAD från originalkoden (och från v1) -- det var aldrig
     källan till den race som rättats; se filens header-kommentar. */
  const { data: offStoreRowForVersion } = await supabase
    .from('store').select('value').eq('key', 'vift_offers').maybeSingle()
  const allOffersForVersionLookup: Record<string, unknown>[] =
    Array.isArray(offStoreRowForVersion?.value) ? offStoreRowForVersion.value as Record<string, unknown>[] : []
  const offerForVersionLookup = allOffersForVersionLookup.find(o => o.id === offerId)
  if (!offerForVersionLookup) return err({ error: 'offer_not_found' }, 404)
  const resolvedVersion = Number(offerForVersionLookup.versionNumber ?? 1) || 1

  /* Hämta vift_offerAttachments EN gång — används ENDAST för att validera/
     signera de BILAGOR SOM FAKTISKT SKA BIFOGAS I MEJLET (attachmentIdList,
     ett annat begrepp än "publikt synliga på offertsidan"). Detta MÅSTE
     ske olåst och FÖRE RPC-anropet, eftersom det innebär riktiga,
     potentiellt långsamma externa HTTP-anrop till Storage för att signera
     och hämta filerna -- att hålla ett databaslås öppet under det hade
     varit ett eget, nytt och allvarligt problem (blockerar alla andra
     skribenter i onödan). offer_email_prepare_commit() gör sin EGEN,
     separata läsning av samma nyckel UNDER sitt lås för att beräkna
     publicAttachmentIds och utföra bilagelåsningen -- de två användningarna
     av vift_offerAttachments är oberoende av varandra. */
  const { data: attStoreRow } = await supabase
    .from('store').select('value').eq('key', 'vift_offerAttachments').maybeSingle()
  const allAtts: Record<string, unknown>[] =
    Array.isArray(attStoreRow?.value) ? attStoreRow.value as Record<string, unknown>[] : []

  /* Validera, signera och hämta valda bilagor INNAN någon DB-skrivning */
  const preparedAttachments = await prepareAttachmentsForEmail(allAtts, attachmentIdList, offerId, supabase)
  if (!preparedAttachments.valid) {
    return err({ error: 'attachment_validation_failed', detail: preparedAttachments.detail }, 400)
  }
  const emailAtts = preparedAttachments.attachments

  /* ── Idempotens: INNAN token/snapshot sparas ───────────── */
  try {
    const { data: evRow } = await supabase
      .from('store').select('value').eq('key', 'vift_offerEvents').maybeSingle()
    const recentEvents: Record<string, unknown>[] =
      Array.isArray(evRow?.value) ? evRow.value as Record<string, unknown>[] : []
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const duplicate = recentEvents.find(e =>
      e.offerId === offerId &&
      Number(e.offerVersion) === resolvedVersion &&
      e.type === 'email_sent' &&
      e.status === 'sent' &&
      String(e.sentAt ?? '') > fiveMinAgo
    )
    if (duplicate) {
      return err({ error: 'already_sent', detail: 'Offerten skickades redan inom de senaste 5 minuterna' }, 409)
    }
  } catch { /* gå vidare om kontrollen misslyckas */ }

  /* ── Token-logik: ETT atomiskt RPC-anrop avgör OCH skriver A/B/C, OCH
     kundnamn OCH bilagelåsning ──────────────────────────────────────────
     Ersätter den tidigare, olåsta tre-vägs if/else-grenen. offer_email_
     prepare_commit() tar nu SJÄLV, i EN konsekvent ordning, radlås på BÅDA
     vift_offers och vift_offerAttachments INNAN den härleder kundnamn,
     beräknar publicAttachmentIds och fattar sitt A/B/C-beslut -- se
     003_offer_email_prepare_commit_v3.sql för den fullständiga
     motiveringen (särskilt fynd 4 i acceptansgranskningen 2026-11-20).
     Enda indata som behövs nu är offerId. Ett eventuellt
     'attachment_lock_failed'-fel kan inte längre uppstå HÄR som ett eget
     steg -- en misslyckad bilagelåsning är nu en del av SAMMA transaktion
     som token/snapshot-skrivningen och ger antingen allt-eller-inget
     (samma atomicitetsgaranti som redan gäller för resten av RPC:n). */
  const { data: rpcResult, error: rpcError } = await supabase
    .rpc('offer_email_prepare_commit', { p_offer_id: offerId })

  if (rpcError) {
    const msg = rpcError.message || ''
    if (msg.includes('offer_not_found')) return err({ error: 'offer_not_found' }, 404)
    console.error('[send-offer-email] offer_email_prepare_commit-fel:', rpcError)
    return err({ error: 'token_save_failed', detail: msg }, 500)
  }

  const offerToken        = String(rpcResult.offerToken ?? '')
  const tokenExpiresAt     = String(rpcResult.tokenExpiresAt ?? '')
  const offerPatch         = rpcResult.offerPatch as Record<string, unknown>
  const attachmentPatches = (Array.isArray(rpcResult.attachmentPatches)
    ? rpcResult.attachmentPatches
    : []) as Array<{ id: string; lockedInVersion: string }>

  /* NYTT (v3, avgränsad dataintegritetsrättning): `resolvedVersion` ovan
     lästes OLÅST, FÖRE detta RPC-anrop (och FÖRE bilagevalidering/signering
     och idempotenskontrollen, som båda kan ta sekunder). RPC:n returnerar nu
     `offerVersion` -- det FAKTISKA versionsnumret från den rad den själv
     LÅSTE och agerade på. Om offertens version hann ändras i det fönstret
     skulle snapshotet/utskicket redan ha byggts mot den NYA versionen
     (korrekt -- RPC:n agerar alltid på den aktuella, låsta raden), men
     händelseloggen (`emailEvent.offerVersion` nedan) och idempotens-
     kontrollen ovan skulle tyst registrera den GAMLA, inaktuella versionen
     -- en felkoppling mellan vad som faktiskt skickades och vad som
     bokfördes. Avbryt EXPLICIT istället för att tyst fortsätta: ingen
     e-post skickas via Resend när detta inträffar (kontrollen görs INNAN
     Resend-anropet nedan), och RPC:ns egen skrivning (redan committad, och
     ofarlig att lämna -- nästa försök återanvänder den precis som Fall A
     redan är byggt för) rullas INTE tillbaka, bara det externa utskicket
     och händelseloggningen uteblir. En omedelbar ny begäran från klienten
     löser detta av sig själv, eftersom den då läser samma, nu konsekventa,
     version i båda stegen. */
  const rpcOfferVersion = Number(rpcResult.offerVersion ?? 1) || 1
  if (rpcOfferVersion !== resolvedVersion) {
    console.error('[send-offer-email] Offertversion ändrades mellan idempotenskontroll och förberedelse:', resolvedVersion, '->', rpcOfferVersion)
    return err({
      error: 'offer_version_changed',
      detail: 'Offerten ändrades medan utskicket förbereddes -- försök igen.',
      checkedVersion: resolvedVersion,
      currentVersion: rpcOfferVersion,
    }, 409)
  }

  /* Bygg rätt offertlänk */
  const offerLink = `${PUBLIC_BASE_URL}/public-offer.html?t=${encodeURIComponent(offerToken)}`

  /* Lägg till logotyp-header (vit e-postbakgrund → svart logotyp) */
  const logoHeader = `<div style="text-align:left;padding:24px 0 16px 0;border-bottom:1px solid #e5e7eb;margin-bottom:24px;"><img src="${PUBLIC_BASE_URL}/assets/vift-logo-black.png" alt="VIFT" style="height:40px;width:auto;" /></div>`
  const bodyWithLogo = logoHeader + bodyHtml

  /* Injicera offertlänk om platshållare finns, annars lägg till sist */
  const finalHtml = bodyWithLogo.includes('{{OFFER_LINK}}')
    ? bodyWithLogo.replace(/\{\{OFFER_LINK\}\}/g, offerLink)
    : bodyWithLogo + `\n<p><a href="${offerLink}">Visa offert online</a></p>`

  /* Bygg Resend payload */
  const resendTo = normalizedTo.map(r => r.name ? `${r.name} <${r.email}>` : r.email)
  const resendPayload: Record<string, unknown> = {
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to:   resendTo,
    subject,
    html: finalHtml,
  }
  if (cc?.length)           resendPayload.cc          = cc.filter(isValidEmail)
  if (bcc?.length)          resendPayload.bcc         = bcc.filter(isValidEmail)
  if (emailAtts.length > 0) resendPayload.attachments = emailAtts

  /* Skicka via Resend */
  let messageId  = ''
  let sendStatus = 'sent'
  let sendError  = ''

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(resendPayload),
    })
    const resendJson = await resendRes.json().catch(() => ({})) as { id?: string; message?: string }
    if (!resendRes.ok) {
      sendStatus = 'failed'
      sendError  = resendJson.message ?? `HTTP ${resendRes.status}`
      console.error('[send-offer-email] Resend error:', sendError)
    } else {
      messageId = resendJson.id ?? ''
    }
  } catch (e) {
    sendStatus = 'failed'
    sendError  = String(e)
    console.error('[send-offer-email] Network error:', e)
  }

  const sentAt  = new Date().toISOString()
  /* OEV-prefix bibehålls för läsbarhet/bakåtkompatibilitet, men id:t är inte
     längre bara en millisekunds-timestamp (två händelser inom samma ms skulle
     annars kollidera). Hela crypto.randomUUID() ger full kollisionssäker
     entropi (ingen annan plats i koden läser/parsar id:ts längd eller format,
     verifierat separat); samma primitiv (crypto.*) används redan ovan i
     RPC-anropet (gen_random_bytes i databasen) för offerToken. */
  const eventId = `OEV-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID()}`

  /* Bygg emailEvent — returneras till frontend och sparas i store */
  const emailEvent: Record<string, unknown> = {
    id:              eventId,
    type:            'email_sent',
    offerId,
    /* rpcOfferVersion, inte resolvedVersion -- vid denna punkt är de alltid
       lika (annars hade vi redan avbrutit ovan), men rpcOfferVersion är den
       som verkligen härstammar från den rad RPC:n låste och agerade på. */
    offerVersion:    rpcOfferVersion,
    ts:              sentAt,
    sentAt,
    sentBy,
    recipients:      normalizedTo.map(r => r.email),
    cc:              (cc  ?? []).filter(isValidEmail),
    bcc:             (bcc ?? []).filter(isValidEmail),
    subject,
    templateId:      templateId ?? null,
    messageId,
    status:          sendStatus,
    error:           sendError  || null,
    attachmentCount: attachmentIdList.length,
  }

  /* Spara emailEvent via offer_events_append() RPC — atomisk, radlåst
     read-modify-write + dedup (by id, och by messageId när status='sent')
     i databasen, istället för en osäker klient-side read→push→upsert av
     hela arrayen. Misslyckad loggning stoppar inte svaret.
     OFÖRÄNDRAD i detta förslag -- redan atomisk, ingen rörs. */
  let logWarning: string | undefined
  try {
    const { error: eventSaveError } = await supabase
      .rpc('offer_events_append', { p_event: emailEvent })
    if (eventSaveError) {
      console.error('[send-offer-email] Händelseloggning misslyckades:', eventSaveError)
      logWarning = sendStatus === 'sent'
        ? 'Mejlet skickades men händelseloggning misslyckades'
        : 'Det misslyckade utskicket kunde inte sparas i händelseloggen'
    }
  } catch (logErr) {
    console.error('[send-offer-email] Händelseloggning misslyckades:', logErr)
    logWarning = sendStatus === 'sent'
      ? 'Mejlet skickades men händelseloggning misslyckades'
      : 'Det misslyckade utskicket kunde inte sparas i händelseloggen'
  }

  if (sendStatus === 'failed') {
    return err({
      error: 'send_failed',
      detail: sendError,
      offerPatch,
      attachmentPatches,
      emailEvent,
      offerToken,
      tokenExpiresAt,
      offerLink,
      ...(logWarning ? { logWarning } : {}),
    }, 500)
  }

  return ok({
    ok: true,
    messageId,
    sentAt,
    offerToken,
    tokenExpiresAt,
    offerLink,
    offerPatch,
    attachmentPatches,
    emailEvent,
    ...(logWarning ? { logWarning } : {}),
  })
})