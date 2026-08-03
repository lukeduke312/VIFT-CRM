/**
 * offer-token-validate — Supabase Edge Function (Leverans E, Del E2, v6)
 *
 * Validerar en publik offerttoken och returnerar offertens publika data.
 * Uppdaterar öppningsräknare och openedAt vid första besök.
 *
 * v2: när lockedSnapshotJSON finns används det för offertinnehållet (priser,
 *     rader, villkor, kundnamn). Dynamiska metadata (status, tokenExpiresAt,
 *     openCount, openedAt) hämtas alltid från live-offerten.
 * v3: strikt snapshot — inget nullish-fallback till live-offert för innehållsfält;
 *     bilagor filtreras via snapshot.publicAttachmentIds om tillgängligt (låst vid utskick).
 * v4: (se v3 — samma version, namnbump i produktionskommit)
 * v5: kontaktuppgifter förifylls från vift_customers med korrekt prioritetsordning.
 *     Ingen kunddata utöver contactName/contactEmail exponeras publikt.
 *     contactName: off.contactName → primary contact → contacts[0] → contactPerson
 *       → privat firstName+lastName → ''
 *     contactEmail: off.contactEmail → primary contact → contacts[0] → cust.email → ''
 *
 * SÄKERHETSREGLER:
 * - Interna fält exponeras ALDRIG (inköpspris, marginal, TB, internalNote,
 *   personaldata, annan kundinformation, customerApproval.token, m.fl.)
 * - lockedSnapshotJSON parsas säkert — ogiltig JSON faller tillbaka på live-offert
 * - Tokenkontroll, giltighetstid och återkallning kontrolleras server-side
 * - Rate-limit: max 30 req / minut per IP
 * - Inga kundfält utöver contactName/contactEmail returneras publikt
 *
 * Anrop: GET /functions/v1/offer-token-validate?t={token}
 *        ingen Authorization krävs — publik endpoint
 *
 * Svar 200: { offer: PublicOfferData, status: 'ok' }
 * Svar 404: { error: 'not_found' }
 * Svar 410: { error: 'expired' }
 * Svar 403: { error: 'revoked' }
 * Svar 429: { error: 'rate_limited' }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/* ── CORS + HTTP-säkerhetsrubriker ────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control':                'no-store, no-cache',
  'Referrer-Policy':              'no-referrer',
  'X-Content-Type-Options':       'nosniff',
  'X-Frame-Options':              'DENY',
}

/* ── Enkel in-memory rate-limit (per Edge Function instans) ── */
const _rateMap = new Map<string, { count: number; windowStart: number }>()
const RATE_WINDOW_MS  = 60_000
const RATE_MAX_PER_IP = 30

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


/* ── Validera versionssnapshot ───────────────────────────── */
function parseValidSnapshot(raw: unknown, offerId: string): Record<string, unknown> | null {
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

/* ── Handler ─────────────────────────────────────────────── */
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  /* Rate-limit */
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) {
    return json({ error: 'rate_limited' }, 429)
  }

  try {
    /* Hämta token från query param */
    const url   = new URL(req.url)
    const token = (url.searchParams.get('t') || '').trim()
    if (!token || token.length < 32) {
      return json({ error: 'not_found' }, 404)
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })

    /* Hämta alla offerter och hitta den med matchande token */
    const { data: storeRow, error: storeErr } = await supabase
      .from('store')
      .select('value')
      .eq('key', 'vift_offers')
      .maybeSingle()

    if (storeErr) throw new Error('store-läsfel: ' + storeErr.message)

    const offers: Record<string, unknown>[] = Array.isArray(storeRow?.value) ? storeRow.value as Record<string, unknown>[] : []
    const off = offers.find(o => o.publicToken === token)

    if (!off) {
      return json({ error: 'not_found' }, 404)
    }

    /* Kontrollera återkallning */
    if (off.tokenRevokedAt) {
      return json({ error: 'revoked' }, 403)
    }

    /* Kontrollera giltighetstid */
    if (off.tokenExpiresAt) {
      const exp = new Date(off.tokenExpiresAt as string).getTime()
      if (Date.now() > exp) {
        return json({ error: 'expired', expiredAt: off.tokenExpiresAt }, 410)
      }
    }

    /* Uppdatera öppningsstatistik */
    const isFirstOpen = !off.openedAt
    const now = new Date().toISOString()
    off.openCount = (Number(off.openCount) || 0) + 1
    if (isFirstOpen) {
      off.openedAt = now
    }
    off.updatedAt = now

    /* Skriv tillbaka offers-blob */
    await supabase
      .from('store')
      .upsert({ key: 'vift_offers', value: offers }, { onConflict: 'key' })

    /* Logga öppningshändelse (bara första gången) */
    if (isFirstOpen) {
      await appendOfferEvent(supabase, {
        offerId: off.id as string,
        offerVersion: Number(off.versionNumber) || 1,
        type: 'opened',
        ts:   now,
        ip
      })
    }

    /* Giltigt snapshot är auktoritativt; ogiltigt/ofullständigt snapshot behandlas som legacy */
    const snapshot = parseValidSnapshot(off.lockedSnapshotJSON, String(off.id ?? ''))

    /* Lös kontaktuppgifter för förifyllning av signeringsformuläret.
       Prioritetsordning contactName:
         1. off.contactName (manuellt satt på offerten)
         2. contacts.find(primary)?.name
         3. contacts[0]?.name
         4. cust.contactPerson
         5. privat: firstName + lastName
         6. '' (tom sträng)
       Prioritetsordning contactEmail:
         1. off.contactEmail (manuellt satt på offerten)
         2. contacts.find(primary)?.email
         3. contacts[0]?.email
         4. cust.email
         5. '' (tom sträng)
       Inga andra kundfält exponeras publikt. */
    let resolvedContactName  = String(off.contactName  ?? '')
    let resolvedContactEmail = String(off.contactEmail ?? '')

    if (!resolvedContactName || !resolvedContactEmail) {
      try {
        const { data: custRow, error: custErr } = await supabase
          .from('store')
          .select('value')
          .eq('key', 'vift_customers')
          .maybeSingle()

        if (custErr) {
          console.warn('[offer-token-validate] kund-läsfel:', custErr.message)
        } else {
          const customers: Record<string, unknown>[] = Array.isArray(custRow?.value)
            ? custRow.value as Record<string, unknown>[]
            : []
          const cust = customers.find(c => c.id === off.customerId) as Record<string, unknown> | undefined

          if (cust) {
            const contacts: Record<string, unknown>[] = Array.isArray(cust.contacts)
              ? cust.contacts as Record<string, unknown>[]
              : []
            const primaryContact = contacts.find(c => c.primary === true) as Record<string, unknown> | undefined
            const firstContact   = contacts[0] as Record<string, unknown> | undefined

            if (!resolvedContactName) {
              resolvedContactName =
                String(primaryContact?.name ?? '') ||
                String(firstContact?.name   ?? '') ||
                String(cust.contactPerson   ?? '')
              if (!resolvedContactName && cust.type === 'privat') {
                resolvedContactName = [cust.firstName, cust.lastName]
                  .filter(Boolean)
                  .join(' ')
              }
            }

            if (!resolvedContactEmail) {
              resolvedContactEmail =
                String(primaryContact?.email ?? '') ||
                String(firstContact?.email   ?? '') ||
                String(cust.email            ?? '')
            }
          }
        }
      } catch (e) {
        console.warn('[offer-token-validate] kund-lookup fel:', e)
      }
    }

    /* Bygg publik offertdata — INGA interna fält */
    const publicOffer = buildPublicOffer(off, snapshot, resolvedContactName, resolvedContactEmail)

    /* Hämta kundsynliga bilagor — filtreras via snapshot.publicAttachmentIds om tillgängligt */
    const { data: attRow } = await supabase
      .from('store')
      .select('value')
      .eq('key', 'vift_offerAttachments')
      .maybeSingle()

    const allAtts: Record<string, unknown>[] =
      Array.isArray(attRow?.value) ? attRow.value as Record<string, unknown>[] : []

    const publicAttachmentIds = snapshot
      ? (snapshot.publicAttachmentIds as unknown[]).map(id => String(id))
      : null

    const publicAtts = allAtts
      .filter(a => {
        if (a.offerId !== off.id || a.active === false) return false
        /* Om snapshot har publicAttachmentIds — använd dem (låsta vid utskick) */
        if (publicAttachmentIds !== null) {
          return publicAttachmentIds.includes(String(a.id))
        }
        /* Legacy: inget snapshot → använd aktuellt includeInPublicView */
        return a.includeInPublicView === true
      })
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0))
      .map(a => ({
        id:             a.id,
        displayName:    a.displayName    || a.originalFileName || 'Bilaga',
        description:    a.description   ?? '',
        mimeType:       a.mimeType       ?? '',
        sizeBytes:      a.sizeBytes      ?? 0,
        sortOrder:      a.sortOrder      ?? 0,
        includeInCombinedPdf: a.includeInCombinedPdf ?? false
        /* storagePath och interna fält exponeras ALDRIG */
      }))

    return json({ offer: publicOffer, attachments: publicAtts, status: 'ok' })

  } catch (err: unknown) {
    console.error('[offer-token-validate] fel:', err)
    return json({ error: 'internal_error' }, 500)
  }
})

/* ── Publika fält — EXKLUDERAR alla interna fält ─────────── */
function buildPublicOffer(
  off: Record<string, unknown>,
  snap: Record<string, unknown> | null,
  resolvedContactName  = String(off.contactName  ?? ''),
  resolvedContactEmail = String(off.contactEmail ?? '')
): Record<string, unknown> {
  /* Giltigt snapshot är strikt auktoritativt för innehållsfält. */
  const s = (key: string): unknown => snap !== null ? snap[key] : off[key]

  return {
    id:             off.id,
    /* Innehållsfält — från snapshot om tillgängligt */
    title:          s('title'),
    versionNumber:  s('versionNumber'),
    customerName:   s('customerName')  ?? '',
    lines:          filterPublicLines(s('lines')),
    extras:         filterPublicLines(s('extras')),
    discount:       s('discount')      ?? null,
    taxType:        s('taxType')       ?? 'moms',
    rotRutAmount:   s('rotRutAmount')  ?? 0,
    date:           snap !== null ? (s('date') ?? '') : (off.date ?? off.createdAt ?? ''),
    validUntil:     s('validUntil')    ?? '',
    paymentTerms:   s('paymentTerms')  ?? '',
    validityText:   s('validityText')  ?? '',
    terms:          s('terms')         ?? '',
    includes:       s('includes')      ?? '',
    excludes:       s('excludes')      ?? '',
    scope:          s('scope')         ?? '',
    summary:        s('summary')       ?? '',
    generalTerms:   s('generalTerms')  ?? '',
    address:        s('address')       ?? '',
    /* Dynamiska metadata — alltid från live-offerten */
    status:         off.status,
    contactName:    resolvedContactName,
    contactEmail:   resolvedContactEmail,
    propertyId:     off.propertyId     ?? '',
    tokenExpiresAt: off.tokenExpiresAt ?? '',
    openCount:      off.openCount      ?? 0,
    openedAt:       off.openedAt       ?? '',
  }
}

/* Filtrera bort interna fält från rader (inköpspris, marginal, kalkyl) */
function filterPublicLines(lines: unknown): unknown[] {
  if (!Array.isArray(lines)) return []
  return lines.map((l: Record<string, unknown>) => {
    if (!l || typeof l !== 'object') return l
    const pub: Record<string, unknown> = {}
    const allowed = ['id','type','description','templateName','qty','unit',
                     'unitPrice','discount','total','vatRate','exVat','rutAmount',
                     'subLines','text']
    for (const k of allowed) {
      if (k in l) pub[k] = l[k]
    }
    return pub
  })
}

/* Lägg till offerEvent i vift_offerEvents */
async function appendOfferEvent(
  supabase: ReturnType<typeof createClient>,
  ev: Partial<{ offerId: string; offerVersion: number; type: string; ts: string; ip: string }>
): Promise<void> {
  try {
    const { data: row } = await supabase
      .from('store')
      .select('value')
      .eq('key', 'vift_offerEvents')
      .maybeSingle()

    const events: unknown[] = Array.isArray(row?.value) ? row.value as unknown[] : []
    events.push({
      id:           'oe-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      offerId:      ev.offerId     ?? '',
      offerVersion: ev.offerVersion ?? 1,
      type:         ev.type        ?? '',
      ts:           ev.ts          ?? new Date().toISOString(),
      ip:           ev.ip          ?? '',
      byCustomer:   '',
      byEmail:      '',
      comment:      ''
    })
    /* Håll logg rimlig — max 10 000 händelser */
    if (events.length > 10_000) events.splice(0, events.length - 10_000)

    await supabase
      .from('store')
      .upsert({ key: 'vift_offerEvents', value: events }, { onConflict: 'key' })
  } catch (e) {
    console.error('[offer-token-validate] appendOfferEvent fel:', e)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}
