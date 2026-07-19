/**
 * offer-token-validate — Supabase Edge Function (Leverans E, Del E2)
 *
 * Validerar en publik offerttoken och returnerar offertens publika data.
 * Uppdaterar öppningsräknare och openedAt vid första besök.
 *
 * SÄKERHETSREGLER:
 * - Interna fält exponeras ALDRIG (inköpspris, marginal, TB, internalNote,
 *   personaldata, annan kundinformation, customerApproval.token, m.fl.)
 * - Tokenkontroll, giltighetstid och återkallning kontrolleras server-side
 * - Rate-limit: max 30 req / minut per IP
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

/* ── CORS ─────────────────────────────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
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

    /* Bygg publik offertdata — INGA interna fält */
    const publicOffer = buildPublicOffer(off)

    /* Hämta kundsynliga bilagor — exkludera interna (includeInPublicView=false) */
    const { data: attRow } = await supabase
      .from('store')
      .select('value')
      .eq('key', 'vift_offerAttachments')
      .maybeSingle()

    const allAtts: Record<string, unknown>[] =
      Array.isArray(attRow?.value) ? attRow.value as Record<string, unknown>[] : []

    const publicAtts = allAtts
      .filter(a =>
        a.offerId === off.id &&
        a.active  !== false  &&
        a.includeInPublicView === true
      )
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
function buildPublicOffer(off: Record<string, unknown>): Record<string, unknown> {
  return {
    id:             off.id,
    title:          off.title,
    versionNumber:  off.versionNumber,
    status:         off.status,
    /* Kundinfo (ej andra kunder, ej intern kunddata) */
    customerName:   off.customerName   ?? '',   // snapshot
    contactName:    off.contactName    ?? '',
    contactEmail:   off.contactEmail   ?? '',
    /* Offertinnehåll */
    lines:          filterPublicLines(off.lines),
    extras:         filterPublicLines(off.extras),
    discount:       off.discount       ?? null,
    taxType:        off.taxType        ?? 'moms',
    rotRutAmount:   off.rotRutAmount   ?? 0,
    /* Datum & villkor */
    date:           off.date           ?? off.createdAt ?? '',
    validUntil:     off.validUntil     ?? '',
    paymentTerms:   off.paymentTerms   ?? '',
    validityText:   off.validityText   ?? '',
    terms:          off.terms          ?? '',
    includes:       off.includes       ?? '',
    excludes:       off.excludes       ?? '',
    scope:          off.scope          ?? '',
    summary:        off.summary        ?? '',
    generalTerms:   off.generalTerms   ?? '',
    /* Fastighetsreferens */
    address:        off.address        ?? '',
    propertyId:     off.propertyId     ?? '',
    /* Tokeninfo */
    tokenExpiresAt: off.tokenExpiresAt ?? '',
    openCount:      off.openCount      ?? 0,
    openedAt:       off.openedAt       ?? '',
    /* Offert-snapshot (om den finns — används som fallback för gamla versioner) */
    lockedSnapshotJSON: off.lockedSnapshotJSON ?? ''
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
