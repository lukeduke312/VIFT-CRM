/**
 * offer-public-pdf — Supabase Edge Function (v7)
 *
 * Genererar och returnerar en PDF av en offert via publik token.
 * Kräver ingen JWT — autentiseras enbart via publicToken.
 *
 * SÄKERHETSREGLER:
 * - Interna fält (inköpspris, marginal, TB, internalNote) exponeras ALDRIG i PDF
 * - Tokenkontroll, giltighetstid och återkallning kontrolleras server-side
 * - Rate-limit: max 10 req / minut per IP
 * - Inga kundfält utöver customerName exponeras
 *
 * Anrop: GET /functions/v1/offer-public-pdf?t={token}
 *        ingen Authorization krävs — publik endpoint
 *
 * Svar 200: application/pdf (inline PDF-fil)
 * Svar 404: { error: 'not_found' }
 * Svar 410: { error: 'expired' }
 * Svar 403: { error: 'revoked' }
 * Svar 429: { error: 'rate_limited' }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb, PageSizes } from 'https://esm.sh/pdf-lib@1.17.1'

/* ── VIFT Logotyp (2026-11-24) ────────────────────────────────
   Tidigare inbäddad som base64 i källan (~47 KB). Ligger nu oförändrad
   (SHA-256 34eb4481d351b496…, 29 723 byte) i den PRIVATA bucketen
   vift-branding och läses med service role. Lyckad läsning cachas per
   instans; vid fel används den befintliga textlogotypen (oförändrat). */
const LOGO_BUCKET = 'vift-branding'
const LOGO_PATH   = 'vift-logo-black.png'
let _logoCache: Uint8Array | null = null
async function getLogoBytes(sb: ReturnType<typeof createClient>): Promise<Uint8Array | null> {
  if (_logoCache) return _logoCache
  try {
    const { data, error } = await sb.storage.from(LOGO_BUCKET).download(LOGO_PATH)
    if (error || !data) return null
    _logoCache = new Uint8Array(await data.arrayBuffer())
    return _logoCache
  } catch { return null }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf
}

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/* ── CORS ───────────────────────────────────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control':                'no-store, no-cache',
  'Referrer-Policy':              'no-referrer',
  'X-Content-Type-Options':       'nosniff',
  'X-Frame-Options':              'DENY',
}

/* ── Rate-limit ─────────────────────────────────────────────── */
const _rateMap = new Map<string, { count: number; windowStart: number }>()
const RATE_WINDOW_MS  = 60_000
const RATE_MAX_PER_IP = 10

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

/* ── Validera snapshot ─────────────────────────────────────── */
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

/* ── Formattera tal ───────────────────────────────────────── */
function fmtNum(n: unknown): string {
  const v = Number(n) || 0
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(v)
}

function fmtDate(d: unknown): string {
  if (!d) return '-'
  const s = String(d).slice(0, 10)
  try {
    return new Date(s + 'T12:00:00').toLocaleDateString('sv-SE', {
      year: 'numeric', month: 'long', day: 'numeric'
    })
  } catch { return s }
}
/* ── WinAnsi-säker text ──────────────────────────────────────── */
function pdfSafeText(v: unknown): string {
  const R: Record<string, string> = {
    ' ': ' ',    // NBSP
    '−': '-',    // MINUS SIGN
    '–': '-',    // EN DASH
    '—': '-',    // EM DASH
    '‘': "'",    // LEFT SINGLE QUOTATION MARK
    '’': "'",    // RIGHT SINGLE QUOTATION MARK
    '“': '"',    // LEFT DOUBLE QUOTATION MARK
    '”': '"',    // RIGHT DOUBLE QUOTATION MARK
    '…': '...', // HORIZONTAL ELLIPSIS
    '•': '*',    // BULLET
  }
  // Replace NBSP and any code point above U+00FF with mapped value or '?'
  return String(v ?? '').replace(/[ Ā-￿]/g, ch => R[ch] ?? '?')
}

/* ── Handler ───────────────────────────────────────────────────── */
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) {
    return jsonErr({ error: 'rate_limited' }, 429)
  }

  try {
    const url   = new URL(req.url)
    const token = (url.searchParams.get('t') || '').trim()
    if (!token || token.length < 32) {
      return jsonErr({ error: 'not_found' }, 404)
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })

    /* Hämta offert */
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

    if (!off)              return jsonErr({ error: 'not_found' }, 404)
    if (off.tokenRevokedAt) return jsonErr({ error: 'revoked' }, 403)
    if (off.tokenExpiresAt) {
      const exp = new Date(off.tokenExpiresAt as string).getTime()
      if (Date.now() > exp) return jsonErr({ error: 'expired' }, 410)
    }

    /* Snapshot är OBLIGATORISKT — returnera 409 om det saknas */
    const snap = parseValidSnapshot(off.lockedSnapshotJSON, String(off.id ?? ''))
    if (snap === null) return jsonErr({ error: 'snapshot_unavailable' }, 409)
    const s    = (key: string): unknown => snap[key]

    /* Filtrera bort interna fält (inköpspris, marginal, TB, internalNote exponeras aldrig).
       Bevara alla fält som krävs för korrekt visning och beräkning. */
    /* OFFER CORE R1.1 — BLOCKER 3 (motbevis-granskad): 'billingType' och
       'includedInTotal' tillagda — utan detta skulle DENNA funktions
       EGNA (redundanta, försvars-i-djup) omfiltrering av det redan
       fält-vitlistade snapshotet tyst STRIPPA bort fälten igen även om
       PageShells.js:s snapshot-generering (se dess egen whitelist)
       redan inkluderar dem korrekt — två oberoende whitelists måste
       båda uppdateras. Samma set används för både lines och extras
       (extras har aldrig haft 'type', men har alla andra relevanta
       fält, plus nu 'includedInTotal'). */
    const ALLOWED_LINE_FIELDS = new Set([
      'id','type','description','templateName','qty','unit','unitPrice',
      'discount','total','vatRate','exVat','rutAmount','reductionType','reductionBaseExVat','subLines','text','blockTitle',
      'billingType','includedInTotal'
    ])
    function filterLines(linesRaw: unknown): Record<string, unknown>[] {
      if (!Array.isArray(linesRaw)) return []
      return linesRaw.map((l: unknown) => {
        if (!l || typeof l !== 'object' || Array.isArray(l)) return {}
        const pub: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(l as Record<string, unknown>)) {
          if (ALLOWED_LINE_FIELDS.has(k)) pub[k] = v
        }
        return pub
      })
    }

    const lines  = filterLines(s('lines'))
    const extras = filterLines(s('extras'))

    /* ── Beräkna totaler — exakt samma logik som renderOffer() i public-offer.html ──
     *
     * discount: { type: 'percent'|'fixed'|'none', value: number }
     * vatRate:  25 = 25 % (heltal, INTE 0.25)
     * rutAmount: på service-rader
     */
    /* OFFER CORE R1.1 — BLOCKER 2/3: 'recurring'/'rate'-rader exkluderas
       nu ur den klassiska engångs-bucketen — exakt samma uteslutning
       som _offRawExVat()/_offRawVat() i PageShells.js / renderOffer()
       i public-offer.html. Utan detta skulle en Södra Heden-offert
       (bara 'recurring'-rader) räkna in 8000 kr/mån som ett
       engångsbelopp i DEN NEDLADDADE PDF:en, medan CRM/public-offer
       korrekt exkluderar det — exakt den ekonomiska kanal-avvikelse
       uppdraget varnar för. */
    const prLines  = lines.filter((l: Record<string, unknown>) => l.type !== 'text' && l.billingType !== 'recurring' && l.billingType !== 'rate')
    const recurringLines = lines.filter((l: Record<string, unknown>) => l.billingType === 'recurring')
    const rateLines       = lines.filter((l: Record<string, unknown>) => l.billingType === 'rate')
    const extraIncludedInTotal = (e: Record<string, unknown>): boolean => e.includedInTotal !== false
    const optionalExtras = extras.filter((e: Record<string, unknown>) => e.type !== 'text' && !extraIncludedInTotal(e))

    /* V38 §7: kanonisk 0-safe momsnormalisering — samma semantik som
       InvoiceService.normalizeVatRate/PageShells._normVat/public-offer.html
       _poNormVat (V35-V38). null/undefined/tomsträng (inkl. whitespace-
       only) = inget värde satt -> fallback 25; explicit 0 = 0 % (behålls
       exakt); giltigt 0-100 behålls exakt; NaN/Infinity/negativt/>100 ->
       fallback. */
    function normVat(value: unknown, fallback = 25): number {
      if (value === null || value === undefined) return fallback
      if (typeof value === 'string' && value.trim() === '') return fallback
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0 || n > 100) return fallback
      return n
    }

    /* BLOCKER 3 (motbevis-granskad): `Number(l.total) || Math.round(...)`
       har samma "riktigt sparat total:0 misstolkas som ej satt"-bugg som
       redan hittades/fixades i PageShells.js/public-offer.html/
       offer-pdf — en rate-rads legitima total:0 räknades här om till ett
       felaktigt icke-noll belopp. lineExVat() nedan är samma dispatch
       (rate→0 alltid, oavsett qty/unitPrice) som _lineExVat()/_poLineExVat(). */
    function lineExVat(l: Record<string, unknown>): number {
      if (l.type === 'text') return 0
      if (l.billingType === 'rate') return 0
      if (l.type === 'service') return Number(l.exVat) || 0
      const qty = (l.qty !== null && l.qty !== undefined && l.qty !== '') ? Number(l.qty) : 1
      const comp = Math.round(qty * (Number(l.unitPrice) || 0))
      if (comp === 0 && l.total) return Number(l.total)
      return comp
    }
    let rawEx = 0
    let rawVat = 0
    for (const l of prLines) {
      const lEx = lineExVat(l)
      rawEx  += lEx
      rawVat += Math.round(lEx * normVat(l.vatRate) / 100)
    }
    /* BLOCKER 1: extras med includedInTotal===false är EXPLICIT ej
       committade — exkluderade från rawEx/rawVat, precis som
       _offRawExVat()/_offRawVat() i PageShells.js. Frånvarande fält
       (all historisk data) = "included", oförändrad summa. */
    for (const e of extras) {
      if (e.type === 'text') continue
      if (!extraIncludedInTotal(e)) continue
      const eEx = Math.round((Number(e.qty) || 1) * (Number(e.unitPrice) || 0))
      rawEx  += eEx
      rawVat += Math.round(eEx * normVat(e.vatRate) / 100)
    }

    /* BLOCKER 2: additiv återkommande-summering, ALDRIG blandad in i
       rawEx/rawVat ovan. =0 för varje offert utan 'recurring'-rader
       (all historisk data), harmless att alltid beräkna. */
    const recurringMonthlyEx = Math.round(recurringLines.reduce((s: number, l: Record<string, unknown>) => s + lineExVat(l), 0))
    const recurringMonthlyVat = Math.round(recurringLines.reduce((s: number, l: Record<string, unknown>) => s + Math.round(lineExVat(l) * normVat(l.vatRate) / 100), 0))
    const recurringMonthlyInc = recurringMonthlyEx + recurringMonthlyVat
    const recurringAnnualEx  = recurringMonthlyEx * 12
    const recurringAnnualInc = recurringMonthlyInc * 12

    const discRaw   = s('discount') as Record<string, unknown> | null | undefined
    const disc: Record<string, unknown> =
      (discRaw && typeof discRaw === 'object' && !Array.isArray(discRaw))
        ? discRaw as Record<string, unknown>
        : { type: 'none', value: 0 }
    const discValue = Number(disc.value) || 0
    let discAmt = 0
    if (discValue > 0) {
      if (disc.type === 'percent') {
        discAmt = Math.round(rawEx * Math.min(discValue, 100) / 100)
      } else if (disc.type === 'fixed') {
        discAmt = Math.min(Math.round(discValue), rawEx)
      }
    }

    const exVatTotal  = rawEx - discAmt
    /* Momsens rabatteffekt fördelas proportionellt mot fördelningen FÖRE
       rabatt — samma metod som _offerCalcTotals (PageShells.js) och
       InvoiceService.calcSummary (V35) — istället för ett generellt
       * 0.25 som antog att HELA offerten alltid hade 25 % moms. */
    const vatRatio    = rawEx > 0 ? (exVatTotal / rawEx) : 1
    const vatAmt      = Math.round(rawVat * vatRatio)
    const incVatTotal = exVatTotal + vatAmt
    const rutTotal    = prLines
      .reduce((acc: number, l: Record<string, unknown>) => acc + (Number(l.rutAmount) || 0), 0)
    const customerPrice = incVatTotal - rutTotal

    /* ── PDF-generation ───────────────────────────────────────── */
    const pdfDoc = await PDFDocument.create()
    const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica)
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

    const [W, H] = PageSizes.A4   /* 595.28 x 841.89 */
    const ML = 50, MR = 50, MT = 50

    /* Färger */
    const navy    = rgb(0.04, 0.09, 0.16)
    const blue    = rgb(0.12, 0.37, 0.68)
    const black   = rgb(0.07, 0.07, 0.10)
    const muted   = rgb(0.42, 0.44, 0.50)
    const white   = rgb(1, 1, 1)
    const lightBg = rgb(0.97, 0.97, 0.98)
    const line_c  = rgb(0.90, 0.91, 0.93)

    /* ── Sidbrytning-hjälp ── */
    let page = pdfDoc.addPage([W, H])
    let y = H - MT

    function checkY(needed: number): void {
      if (y - needed < 50) {
        page = pdfDoc.addPage([W, H])
        y = H - MT
      }
    }

    function drawText(
      text: string, x: number, yPos: number,
      opts: { size?: number; font?: typeof fontReg; color?: ReturnType<typeof rgb>; maxWidth?: number } = {}
    ): void {
      text = pdfSafeText(text)
      const size  = opts.size  ?? 10
      const font  = opts.font  ?? fontReg
      const color = opts.color ?? black
      const maxW  = opts.maxWidth ?? (W - ML - MR)

      /* Enkel radbrytning */
      if (font.widthOfTextAtSize(text, size) <= maxW) {
        page.drawText(text, { x, y: yPos, size, font, color })
        return
      }
      const words  = text.split(' ')
      let   line   = ''
      let   curY   = yPos
      for (const word of words) {
        const candidate = line ? line + ' ' + word : word
        if (font.widthOfTextAtSize(candidate, size) > maxW && line) {
          page.drawText(line, { x, y: curY, size, font, color })
          curY -= size + 3
          line = word
        } else {
          line = candidate
        }
      }
      if (line) page.drawText(line, { x, y: curY, size, font, color })
    }

    function hline(yPos: number, color = line_c): void {
      page.drawLine({ start: { x: ML, y: yPos }, end: { x: W - MR, y: yPos }, thickness: 0.5, color })
    }

    /* ── Header-block: VIFT-logga på vit yta ── */
    const LOGO_H = 40
    try {
      const logoBytes = await getLogoBytes(supabase)
      if (!logoBytes) throw new Error('logo_unavailable')
      const logoImg = await pdfDoc.embedPng(logoBytes)
      const dims    = logoImg.scaleToFit(150, LOGO_H)
      page.drawImage(logoImg, { x: ML, y: H - MT - LOGO_H, width: dims.width, height: dims.height })
    } catch (_logoErr) {
      /* Fallback: text-baserad logga */
      page.drawText('VIFT', { x: ML, y: H - MT - 20, size: 22, font: fontBold, color: navy })
      page.drawText('Fastighetsservice', { x: ML + 57, y: H - MT - 20, size: 11, font: fontReg, color: blue })
    }
    const offerLblW = fontBold.widthOfTextAtSize('OFFERT', 18)
    page.drawText('OFFERT', { x: W - MR - offerLblW, y: H - MT - 20, size: 18, font: fontBold, color: navy })
    page.drawText('Digital offert - säker länk', { x: ML, y: H - MT - LOGO_H - 8, size: 8, font: fontReg, color: muted })
    hline(H - MT - LOGO_H - 14)

    y = H - MT - LOGO_H - 28

    /* ── Offertinfo-rad ── */
    const offId  = String(off.id ?? '')
    const title  = String(s('title') ?? '')
    const custNm = String(s('customerName') ?? '')
    const dateStr    = String(s('date') ?? '').slice(0, 10)
    const validUntil = String(s('validUntil') ?? '')
    const versionNo  = Number(s('versionNumber') ?? 1)

    checkY(60)
    /* Offert-ID */
    drawText(offId, ML, y, { size: 16, font: fontBold })
    if (title && title !== offId) {
      drawText(title, ML, y - 18, { size: 10, color: muted, maxWidth: W - ML - MR - 120 })
      y -= 18
    }
    /* Datum, höger */
    const dateLabel = pdfSafeText('Datum: ' + fmtDate(dateStr))
    const dateLabelW = fontReg.widthOfTextAtSize(dateLabel, 9)
    page.drawText(dateLabel, { x: W - MR - dateLabelW, y: y + 16, size: 9, font: fontReg, color: muted })
    if (validUntil) {
      const vlLabel = pdfSafeText('Giltig t.o.m.: ' + fmtDate(validUntil))
      const vlLabelW = fontReg.widthOfTextAtSize(vlLabel, 9)
      page.drawText(vlLabel, { x: W - MR - vlLabelW, y: y + 4, size: 9, font: fontReg, color: muted })
    }
    y -= 10
    hline(y); y -= 12

    /* Kund och fastighet */
    const address = String(s('address') ?? '')
    if (custNm) {
      drawText('Kund: ' + custNm, ML, y, { size: 10, font: fontBold })
      y -= 16
    }
    if (address) {
      drawText('Fastighet: ' + address, ML, y, { size: 9, color: muted })
      y -= 14
    }
    if (versionNo > 1) {
      drawText('Version: ' + versionNo, ML, y, { size: 9, color: muted })
      y -= 14
    }


    y -= 8

    /* ── Radtabell — rubrikrad ── */
    /* Kolumnankare — RIGHT EDGES för alla numeriska kolumner,
       garanterar inga överlapp oavsett taletlängd */
    const COL_DESC_L  = ML              // Beskrivning: vänsterkant
    const COL_QTY_R   = W - MR - 195   // Antal: högerkant  (350 pt)
    const COL_PRICE_R = W - MR - 130   // À-pris: högerkant (415 pt)
    const COL_DISC_R  = W - MR - 65    // Rabatt: högerkant (480 pt)
    const COL_TOTAL_R = W - MR         // Summa: högerkant  (545 pt)

    function drawTableRow(
      desc: string, qty: string, price: string, disc: string, total: string,
      opts: { bold?: boolean; bg?: boolean; size?: number } = {}
    ): void {
      qty = pdfSafeText(qty); price = pdfSafeText(price)
      disc = pdfSafeText(disc); total = pdfSafeText(total)
      const sz   = opts.size ?? 9
      const font = opts.bold ? fontBold : fontReg
      if (opts.bg) {
        page.drawRectangle({ x: ML - 5, y: y - 3, width: W - ML - MR + 10, height: sz + 6, color: lightBg })
      }
      /* Alla numeriska kolumner högerjusteras mot sin RIGHT EDGE */
      const maxDescW = COL_QTY_R - COL_DESC_L - 12
      drawText(desc, COL_DESC_L, y, { size: sz, font, maxWidth: maxDescW })
      const qtyW   = font.widthOfTextAtSize(qty,   sz)
      const priceW = font.widthOfTextAtSize(price, sz)
      const discW  = font.widthOfTextAtSize(disc,  sz)
      const totalW = font.widthOfTextAtSize(total, sz)
      page.drawText(qty,   { x: COL_QTY_R   - qtyW,   y, size: sz, font, color: opts.bold ? black : muted })
      page.drawText(price, { x: COL_PRICE_R - priceW, y, size: sz, font, color: opts.bold ? black : muted })
      page.drawText(disc,  { x: COL_DISC_R  - discW,  y, size: sz, font, color: opts.bold ? black : muted })
      page.drawText(total, { x: COL_TOTAL_R - totalW, y, size: sz, font })
      y -= sz + 5
    }

    let hasLines = false

    function renderLines(lineArr: Record<string, unknown>[], sectionLabel?: string): void {
      if (!lineArr || lineArr.length === 0) return
      if (sectionLabel) {
        checkY(20)
        hline(y + 2, blue)
        y -= 2
        drawText(sectionLabel, ML, y, { size: 8, font: fontBold, color: blue })
        y -= 10
      }
      for (const l of lineArr) {
        if (l.type === 'text') {
          /* V48B5 R4 §7/§8: en kundsynlig textrad består av blockTitle +
             text — blockTitle saknades tidigare helt här. Ritas bara om
             satt (ingen tom rubrik). */
          const blockTitle = String(l.blockTitle || '').trim()
          if (blockTitle) {
            checkY(14)
            drawText(blockTitle, ML + 4, y, { size: 8, font: fontBold, maxWidth: W - ML - MR - 8 })
            y -= 12
          }
          if (l.text) {
            checkY(16)
            drawText(String(l.text), ML + 4, y, { size: 8, color: muted, maxWidth: W - ML - MR - 8 })
            y -= 12
          }
          continue
        }
        hasLines = true
        const bt       = String(l.billingType || 'onetime')
        const notIncluded = l.includedInTotal === false
        const desc     = String(l.description || l.templateName || '')
          + (bt === 'recurring' ? ' (återkommande)' : bt === 'rate' ? ' (rörligt à-pris, ingår ej i totalsumman)' : '')
          + (notIncluded ? ' (ingår ej i totalsumman)' : '')
        const qty      = l.qty != null ? String(l.qty) + (l.unit ? ' ' + l.unit : '') : ''
        const unitP    = l.unitPrice != null ? fmtNum(l.unitPrice) : ''
        const discNum  = (typeof l.discount === 'number' && l.discount > 0) ? l.discount : 0
        const discTxt  = discNum > 0 ? fmtNum(discNum) + ' %' : ''
        /* BLOCKER 3/6 (motbevis-granskad): en rate-rad visar sitt rena
           ex-moms-à-pris (l.unitPrice), ALDRIG l.exVat/l.total — dessa
           är, korrekt, 0 för en rate-rad (se _lineExVat i PageShells.js/
           denna funktions egen lineExVat ovan). En recurring-rad visar
           sitt verkliga ex-moms-månadsbelopp + "/mån"-suffix. */
        const exVatVal = bt === 'rate' ? (Number(l.unitPrice) || 0) : (Number(l.exVat) || (Number(l.total) || 0))
        const tot      = fmtNum(exVatVal) + ' kr' + (bt === 'recurring' ? '/mån' : '')

        checkY(16)
        drawTableRow(desc, qty, unitP, discTxt, tot)

        /* Subrader */
        if (Array.isArray(l.subLines) && l.subLines.length > 0) {
          for (const sub of l.subLines as Record<string, unknown>[]) {
            if (!sub || typeof sub !== 'object') continue
            checkY(14)
            const subDesc  = '  · ' + String(sub.desc || sub.description || '')
            const subQtyN  = Number.isFinite(Number(sub.qty)) ? Number(sub.qty) : 1
            const subQtyS  = sub.qty != null ? String(sub.qty) + (sub.unit ? ' ' + sub.unit : '') : ''
            const subPrice = Number(sub.price ?? sub.unitPrice ?? 0)
            const subTotal = Math.round(subQtyN * subPrice)
            const subTot   = fmtNum(subTotal) + ' kr'
            drawTableRow(subDesc, subQtyS, fmtNum(subPrice), '', subTot, { size: 8 })
          }
        }
      }
    }

    function totalRow(label: string, amount: string, bold = false): void {
      checkY(14)
      amount = pdfSafeText(amount)
      const font = bold ? fontBold : fontReg
      const sz   = bold ? 10 : 9
      drawText(label, COL_DISC_R - 120, y, { size: sz, font })
      const w = font.widthOfTextAtSize(amount, sz)
      page.drawText(amount, { x: COL_TOTAL_R - w, y, size: sz, font })
      y -= sz + 5
    }

    /* V38 §7: fler momssatser kan förekomma på samma offert -> neutral
       etikett istället för en hårdkodad "(25 %)". */
    const vatLabel = prLines.every((l: Record<string, unknown>) => normVat(l.vatRate) === 25) ? 'Moms (25 %):' : 'Moms:'

    function drawWrappedField(label: string, value: string): void {
      checkY(24)
      drawText(label, ML, y, { size: 9, font: fontBold })
      y -= 12
      const safeVal = pdfSafeText(value)
      const words = safeVal.split(/\s+/)
      let line = ''
      for (const w of words) {
        const cand = line ? line + ' ' + w : w
        if (fontReg.widthOfTextAtSize(cand, 8) > W - ML - MR && line) {
          checkY(11)
          drawText(line, ML + 6, y, { size: 8, color: muted })
          y -= 11
          line = w
        } else {
          line = cand
        }
      }
      if (line) {
        checkY(11)
        drawText(line, ML + 6, y, { size: 8, color: muted })
        y -= 11
      }
      y -= 8
    }

    /* V48B5 R1 (blocker-korrigering): innehållet ritas nu som FYRA
       narrow block-render-funktioner (description/pricing/
       commercialTerms/generalTerms), anropade i off.sectionOrder-
       ordning — "pricing" flyttar nu FYSISKT rad-tabellen/tillägg/
       totalerna som EN enhet, precis som på övriga ytor (tidigare låg
       den alltid fast; det var en HARD-STOP-överträdelse mot B5-
       kontraktet, åtgärdad här). */
    function renderPricingBlock(): void {
      checkY(30)
      drawTableRow('Beskrivning', 'Antal', 'À-pris', 'Rabatt', 'Summa exkl.', { bold: true, bg: true })
      y -= 4
      renderLines(lines)
      if (extras.length > 0) renderLines(extras, 'Tillägg')
      hline(y + 2)
      y -= 10
      if (!hasLines) {
        checkY(14)
        drawText('(Inga rader)', ML, y, { size: 9, color: muted })
        y -= 14
      }
      /* BLOCKER 2/6 (motbevis-granskad): additiv återkommande-summering
         FÖRE den klassiska engångshinken, ex-moms primärt (det citerade
         kontraktsvärdet), inkl.-moms som tydligt märkt sekundär rad. En
         ren Södra Heden-offert (bara 'recurring'-rader) visar alltså
         ALDRIG "0 kr" som sin första/enda totalrad i den nedladdade
         PDF:en. */
      if (recurringMonthlyEx > 0) {
        totalRow('Fast kostnad per månad (exkl. moms):', fmtNum(recurringMonthlyEx) + ' kr', true)
        totalRow('  (inkl. moms):', fmtNum(recurringMonthlyInc) + ' kr')
        totalRow('Fast kostnad per år, härledd (exkl. moms):', fmtNum(recurringAnnualEx) + ' kr', true)
        totalRow('  (inkl. moms):', fmtNum(recurringAnnualInc) + ' kr')
        y -= 4
      }
      if (discAmt > 0) {
        totalRow('Delsumma:', fmtNum(rawEx) + ' kr')
        const discLabel = disc.type === 'percent'
          ? 'Rabatt (' + fmtNum(discValue) + ' %)'
          : 'Rabatt (fast)'
        totalRow(discLabel, '-' + fmtNum(discAmt) + ' kr')
      }
      totalRow(recurringMonthlyEx > 0 ? 'Engångsbelopp exkl. moms:' : 'Totalt exkl. moms:', fmtNum(exVatTotal) + ' kr')
      if (rawEx > 0) {
        totalRow(vatLabel, fmtNum(vatAmt) + ' kr')
      }
      if (rateLines.length > 0 || optionalExtras.length > 0) {
        totalRow('Rörliga à-priser / tillval (ingår ej ovan):', '')
        for (const rl of rateLines) {
          totalRow('  ' + String(rl.description || 'Rörligt pris'), fmtNum(Number(rl.unitPrice) || 0) + ' kr' + (rl.unit ? '/' + String(rl.unit) : '') + ' exkl. moms')
        }
        for (const oe of optionalExtras) {
          totalRow('  ' + String(oe.description || 'Tillval'), fmtNum(Math.round((Number(oe.qty)||1)*(Number(oe.unitPrice)||0))) + ' kr exkl. moms')
        }
      }
      if (rutTotal > 0) {
        totalRow('RUT/ROT-avdrag:', '-' + fmtNum(rutTotal) + ' kr')
      }
      if (rawEx > 0) {
        y -= 2
        hline(y + 2)
        y -= 8
        totalRow(recurringMonthlyEx > 0 ? 'Engångsbelopp att betala:' : 'Totalt att betala:', fmtNum(customerPrice) + ' kr', true)
      }
      y -= 14
    }

    function renderDescriptionBlock(): void {
      const fields: [string, string][] = [
        ['Sammanfattning', String(s('summary') ?? '')],
        ['Omfattning', String(s('scope') ?? '')],
        ['Ingår', String(s('includes') ?? '')],
        ['Ingår ej', String(s('excludes') ?? '')],
        ['Villkor', String(s('terms') ?? '')],
      ].filter(([, v]) => v.trim()) as [string, string][]
      if (!fields.length) return
      checkY(20)
      hline(y); y -= 14
      for (const [label, value] of fields) drawWrappedField(label, value)
    }

    function renderCommercialTermsBlock(): void {
      const fields: [string, string][] = [
        ['Betalningsvillkor', String(s('paymentTerms') ?? '')],
        ['Giltighetsbetingelse', String(s('validityText') ?? '')],
      ].filter(([, v]) => v.trim()) as [string, string][]
      if (!fields.length) return
      checkY(20)
      hline(y); y -= 14
      for (const [label, value] of fields) drawWrappedField(label, value)
    }

    function renderGeneralTermsBlock(): void {
      const value = String(s('generalTerms') ?? '')
      if (!value.trim()) return
      checkY(20)
      hline(y); y -= 14
      drawWrappedField('Allmänna villkor', value)
    }

    const sectionOrderRaw = Array.isArray((s('sectionOrder') as unknown))
      ? (s('sectionOrder') as unknown[]).filter((id): id is string => typeof id === 'string')
      : []
    const sectionKnownIds = ['description', 'pricing', 'commercialTerms', 'generalTerms']
    const sectionSeen: Record<string, boolean> = {}
    const sectionResolved: string[] = []
    for (const id of sectionOrderRaw) {
      if (sectionKnownIds.indexOf(id) !== -1 && !sectionSeen[id]) { sectionSeen[id] = true; sectionResolved.push(id) }
    }
    for (const id of sectionKnownIds) { if (!sectionSeen[id]) { sectionSeen[id] = true; sectionResolved.push(id) } }

    const blockRenderers: Record<string, () => void> = {
      description: renderDescriptionBlock,
      pricing: renderPricingBlock,
      commercialTerms: renderCommercialTermsBlock,
      generalTerms: renderGeneralTermsBlock,
    }
    for (const id of sectionResolved) blockRenderers[id]()

    /* ── Footer på sista sidan ── */
    const pageCount = pdfDoc.getPageCount()
    for (let i = 0; i < pageCount; i++) {
      const pg = pdfDoc.getPage(i)
      const pgW = pg.getWidth()
      pg.drawLine({
        start: { x: ML, y: 40 }, end: { x: pgW - MR, y: 40 },
        thickness: 0.5, color: line_c
      })
      const footLeft  = 'VIFT Fastighetsservice  ·  viftfast.se'
      const footRight = `Sida ${i + 1} av ${pageCount}`
      pg.drawText(footLeft,  { x: ML,     y: 28, size: 7, font: fontReg, color: muted })
      const frW = fontReg.widthOfTextAtSize(footRight, 7)
      pg.drawText(footRight, { x: pgW - MR - frW, y: 28, size: 7, font: fontReg, color: muted })
    }

    const pdfBytes = await pdfDoc.save()

    const fileName = `Offert-${String(off.id ?? 'VIFT')}.pdf`
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...CORS,
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length':      String(pdfBytes.length),
      }
    })

  } catch (err: unknown) {
    console.error('[offer-public-pdf] fel:', err)
    return jsonErr({ error: 'internal_error' }, 500)
  }
})

function jsonErr(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}
