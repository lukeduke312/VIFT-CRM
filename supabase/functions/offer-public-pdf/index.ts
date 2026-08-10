/**
 * offer-public-pdf — Supabase Edge Function (v4)
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

/* ── VIFT Logotyp (PNG, base64 — assets/vift-logo-black.png) ─ */
const LOGO_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAyAAAAFcCAYAAAAwD9r7AAAI/0lEQVR42u3XUQ2AIBiF0b+ASehCJev57ChAEsjgxlDh3O0UgAf44ki5AQAAzBAOAQAAECAAAIAAAQAAECAAAIAAAQAAECAAAIAAAQAABAgAAIAAAQAABAgAAIAAAQAABAgAACBAAAAABAgAACBAAAAABAgAACBAAAAAAQIAACBAAAAAAQIAACBAAAAAAQIAAAgQAAAAAQIAAAgQAAAAAQIAAAgQAABAgDgIAABAgAAAAAJkiHSWx1wYAAAIEAECAAAIEAAAQIAIEAAAECACBAAAECACBAAABIgAAQAABAgAACBABAgAAAgQAQIAAAgQAQIAAAJEgAAAAAIEAAAQIAIEAAAQIAAAgAARIAAAIEAECAAAIEAAAAABIkAAAAABAgAACBABAgAAAkSAAAAAAgQAABAgAgQAABAgAACAABEgAAAgQAQIAAAgQAAAAAEiQAAAAAECAAAIEAECAAACRIAAAAACRIAAAIAAESAAAIAAAQAABIgAAQAAASJAAAAAASJAAABAgAgQAABAgAAAAAJEgAAAAAIEAAAQIAIEAAAEiAABAAAECAAAIEAECAAAIEAAAAABIkAAAECACBAAAECAAAAAAuTbAWJmZuPmIQVAgAgQMzMBAoAAESBmZgIEAASImZkJEAAEiAAxMxMgAAgQAWJmZgIEAAEiQMzMBAgAAkSAmJkJEAAQIGZmJkAAECACxMxMgAAgQASImZkJEAAEiAAxMxMgAAgQAWJmJkAAQID4LZiZCRAABIgAMTMTIAAIEAFiZmYCBAABIkDMzAQIAAJEgJiZCRAAECACxMxMgAAgQASImZkAAUCACBAzMxMgAAgQAWJmJkAAECACxMxMgACAABEgZmYCBAABIkDMzAQIAAJEgJiZmQABQIAIEDMzAQKAABEgZmYCBAAEiAAxMxMgAAgQAWJmJkAAECACxMzMBAgAAkSAmJkJEAAEiAAxMzMBAoAAESBmZgIEAAEiQMzMBAgACBAzMxMgAAgQAWJmJkAAECACxMzMBAgAAkSAmJkJEAAEiAAxMxMgACBAzMxMgAAgQASImZkAAUCACBAzMxMgAAgQAWJmJkAAECACxMxMgACAABEgZmYCBAABIkDMzAQIAAJEgJiZmQABQIAIEDMzAQKAABEgZmYCBAAEiAAxMxMgAAgQAWJmJkAAECACxMzMBAgAAkSAmJkJEAAEiAAxMxMgACBABIiZmQABQIAIEDMzAQKAABEgZmYmQAAQIALEzEyAACBABIiZmQkQAASIADEzEyAACBABYmYmQABAgJiZmQABQIAIEDMzAQKAABEgZmYmQAAQIALEzEyAACBABIiZmQABAAFiZmYCBAABIkDMzAQIAAJEgJiZmQABQIAIEDMzAQKAABEgZmYCBAAEiAAxMxMgAAgQAWJmJkAAECACxMzMBAgAAkSAmJkJEAAEiAAxMxMgACBABIiZmQABQIAIEDMzAQKAABEgZmYmQAAQIALEzEyAACBABIiZmQABAAEiQMzMBAgAAkSAmJkJEAAEiAAxMzMBAoAAESBmZgIEAAEiQMzMzEMKgAARIGZmAgQAASJAzMwECAAIEDMzEyAACBABYmYmQAAQIALEzMwECAACRICYmQkQAASIADEzEyAAIEDMzEyAACBABIiZmQABQIAIEDMzEyAACBABYmYmQAAQIALEzEyAAIAA8VswMxMgAAgQAWJmJkAAECACxMzMBAgAAkSAmJkJEAAEiAAxMxMgACBABIiZmQABQIAIEDMzAQKAABEgZmYmQAAQIALEzEyAACBABIiZmQABAAEiQMzMBAgAAkSAmJkJEAAEiAAxMzMBAoAAESBmZgIEAAEiQMzMBAgACBABYmYmQAAQIALEzEyAACBABIiZmQkQAASIADEzEyAACBABYmZmAgQAASJAzMwECAACRICYmQkQANg0QAAAAAEiQAAAQIAIEAAAQIAAAAACRIAAAAACBAAAECACBAAABIgAAQAABIgLAwAAASJAAAAAAQIAAAgQAQIAAAJEgAAAAAJEgAAAgAARIAAAgAABAAAEiAABAAABIkAAAAABIkAAAECA/DpArrsCwJJ8bAABIkAAQIAACBAAECAAAkSAAIAAAQSIAAEAAQIgQAQIAAgQQIAIEAAQIAACRIAAIEAABIgAAQABAggQAQIAAgRAgAgQABAggAARIAAgQAAEiAABQIAACBABAgACBBAgAgQABAiAABEgACBAAAEiQABAgAAIEAECgAABECACBAAECCBABAgACBAAASJAAECAAAJEgACAAAEQIAIEAAECIEAECAAIEECACBAAECAAAkSAAIAAAQSIAAEAAQIgQAQIAAIEQIAIEAAQIAACBAAECIAAESAAIEAAASJAAECAAAgQAQIAAgQQIAIEAAQIgADxQAEgQAAEiAABAAECCBABAgACBECACBAAECCAABEgACBAAASIAAFAgAAIEAECAAIEECALBwgAACBABAgAAAgQAQIAAAgQAABAgAgQAABAgAAAAAJEgAAAgAARIAAAgABxYQAAIEAECAAAIEAAAAABIkAAAECACBAAAECACBAAABAgAgQAABAgAACAABEgAAAgQAQIAAAgQAQIAAAIEAECAAAIEAAAQIAIEAAAQIAAAAACRIAAAIAAESAAAIAAAQAABIgAAQAABAgAACBABAgAAAgQAQIAAAgQAABAgAgQAABAgAAAAAJEgAAAgAARIAAAgAABAAAEiAABAAAECAAAIEAECAAACBABAgAACBABAgAAAkSAAAAAAgQAABAgAgQAAASIAAEAAASIAAEAAAEiQAAAAAECAAAIEAECAAAIEAAAQIAIEAAAECACBAAAECAAAIAAESAAAIAAAQAABIgAAQAAASJAAAAAAQIAAAgQAAAAAQIAAAgQAABAgAAAAAgQAABAgAAAAAgQAABAgAAAAAIEAABAgAAAAAIEAABAgAAAAAIEAAAQIAAAAAIEAAAQIAAAAAIEAAAQIAAAgABxCAAAgAABAAAECAAAgAABAAAECAAAgAABAAAECAAAIEAAAAAECAAAIEAAAAAECAAA8J4OC3e1HyEO4FsAAAAASUVORK5CYII='

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf
}

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/* ── CORS ─────────────────────────────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control':                'no-store, no-cache',
  'Referrer-Policy':              'no-referrer',
  'X-Content-Type-Options':       'nosniff',
  'X-Frame-Options':              'DENY',
}

/* ── Rate-limit ───────────────────────────────────────────── */
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

/* ── Validera snapshot ────────────────────────────────────── */
function parseValidSnapshot(raw: unknown, offerId: string): Record<string, unknown> | null {
  try {
    if (!raw) return null
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const snap = parsed as Record<string, unknown>
    if (String(snap.id ?? '') !== offerId) return null
    if (!Array.isArray(snap.lines) || !Array.isArray(snap.extras)) return null
    return snap
  } catch { return null }
}

/* ── Formattera tal ───────────────────────────────────────── */
function fmtNum(n: unknown): string {
  const v = Number(n) || 0
  return new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(v)
}

function fmtDate(d: unknown): string {
  if (!d) return '—'
  const s = String(d).slice(0, 10)
  try {
    return new Date(s + 'T12:00:00').toLocaleDateString('sv-SE', {
      year: 'numeric', month: 'long', day: 'numeric'
    })
  } catch { return s }
}

/* ── Handler ─────────────────────────────────────────────── */
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
    const ALLOWED_LINE_FIELDS = new Set([
      'id','type','description','templateName','qty','unit','unitPrice',
      'discount','total','vatRate','exVat','rutAmount','reductionType','subLines','text'
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
    const prLines  = lines.filter((l: Record<string, unknown>) => l.type !== 'text')

    let rawEx = 0
    for (const l of prLines) {
      if (l.type === 'service') {
        rawEx += Number(l.exVat) || 0
      } else {
        rawEx += Number(l.total) || Math.round((Number(l.qty) || 1) * (Number(l.unitPrice) || 0))
      }
    }
    for (const e of extras) {
      if (e.type === 'text') continue
      rawEx += Math.round((Number(e.qty) || 1) * (Number(e.unitPrice) || 0))
    }

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
    const vatAmt      = Math.round(exVatTotal * 0.25)
    const incVatTotal = exVatTotal + vatAmt
    const rutTotal    = prLines
      .filter((l: Record<string, unknown>) => l.type === 'service')
      .reduce((acc: number, l: Record<string, unknown>) => acc + (Number(l.rutAmount) || 0), 0)
    const customerPrice = incVatTotal - rutTotal

    /* ── PDF-generation ─────────────────────────────────────── */
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
      const logoImg = await pdfDoc.embedPng(b64ToBytes(LOGO_PNG_B64))
      const dims    = logoImg.scaleToFit(LOGO_H, LOGO_H)
      page.drawImage(logoImg, { x: ML, y: H - MT - LOGO_H, width: dims.width, height: dims.height })
    } catch (_logoErr) {
      /* Fallback: text-baserad logga */
      page.drawText('VIFT', { x: ML, y: H - MT - 20, size: 22, font: fontBold, color: navy })
      page.drawText('Fastighetsservice', { x: ML + 57, y: H - MT - 20, size: 11, font: fontReg, color: blue })
    }
    const offerLblW = fontBold.widthOfTextAtSize('OFFERT', 18)
    page.drawText('OFFERT', { x: W - MR - offerLblW, y: H - MT - 20, size: 18, font: fontBold, color: navy })
    page.drawText('Digital offert — säker länk', { x: ML, y: H - MT - LOGO_H - 8, size: 8, font: fontReg, color: muted })
    hline(H - MT - LOGO_H - 14)

    y = H - MT - LOGO_H - 28

    /* ── Offertinfo-rad ── */
    const offId  = String(off.id ?? '')
    const title  = String(s('title') ?? '')
    const custNm = String(s('customerName') ?? off.contactName ?? '')
    const dateStr    = String(s('date') ?? off.createdAt ?? '').slice(0, 10)
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
    const dateLabel = 'Datum: ' + fmtDate(dateStr)
    const dateLabelW = fontReg.widthOfTextAtSize(dateLabel, 9)
    page.drawText(dateLabel, { x: W - MR - dateLabelW, y: y + 16, size: 9, font: fontReg, color: muted })
    if (validUntil) {
      const vlLabel = 'Giltig t.o.m.: ' + fmtDate(validUntil)
      const vlLabelW = fontReg.widthOfTextAtSize(vlLabel, 9)
      page.drawText(vlLabel, { x: W - MR - vlLabelW, y: y + 4, size: 9, font: fontReg, color: muted })
    }
    y -= 10
    hline(y); y -= 12

    /* Kund */
    if (custNm) {
      drawText('Kund: ' + custNm, ML, y, { size: 10, font: fontBold })
      y -= 16
    }
    if (versionNo > 1) {
      drawText('Version: ' + versionNo, ML, y, { size: 9, color: muted })
      y -= 14
    }

    const status = String(off.status ?? '')
    if (status) {
      const statusLabels: Record<string, string> = {
        utkast: 'Utkast', skickad: 'Skickad', godkänd: 'Godkänd', nekad: 'Nekad',
        väntar: 'Väntar svar', påmind: 'Påmind', utgången: 'Utgången', ersatt: 'Ersatt'
      }
      drawText('Status: ' + (statusLabels[status] ?? status), ML, y, { size: 9, color: muted })
      y -= 14
    }

    y -= 8

    /* ── Radtabell — rubrikrad ── */
    const COL_DESC  = ML
    const COL_QTY   = W - MR - 200
    const COL_PRICE = W - MR - 130
    const COL_DISC  = W - MR - 65
    const COL_TOTAL = W - MR - 0

    function drawTableRow(
      desc: string, qty: string, price: string, disc: string, total: string,
      opts: { bold?: boolean; bg?: boolean; size?: number } = {}
    ): void {
      const sz   = opts.size ?? 9
      const font = opts.bold ? fontBold : fontReg
      if (opts.bg) {
        page.drawRectangle({ x: ML - 5, y: y - 3, width: W - ML - MR + 10, height: sz + 6, color: lightBg })
      }
      const maxDescW = COL_QTY - COL_DESC - 8
      drawText(desc, COL_DESC, y, { size: sz, font, maxWidth: maxDescW })
      page.drawText(qty,   { x: COL_QTY,   y, size: sz, font, color: opts.bold ? black : muted })
      page.drawText(price, { x: COL_PRICE, y, size: sz, font, color: opts.bold ? black : muted })
      page.drawText(disc,  { x: COL_DISC,  y, size: sz, font, color: opts.bold ? black : muted })
      const totalW = font.widthOfTextAtSize(total, sz)
      page.drawText(total, { x: COL_TOTAL - totalW, y, size: sz, font })
      y -= sz + 5
    }

    checkY(30)
    drawTableRow('Beskrivning', 'Antal', 'Á-pris', 'Rabatt', 'Summa (exkl.)', { bold: true, bg: true })
    hline(y + 2)
    y -= 4

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
          if (l.text) {
            checkY(16)
            drawText(String(l.text), ML + 4, y, { size: 8, color: muted, maxWidth: W - ML - MR - 8 })
            y -= 12
          }
          continue
        }
        hasLines = true
        const desc     = String(l.description || l.templateName || '')
        const qty      = l.qty != null ? String(l.qty) + (l.unit ? ' ' + l.unit : '') : ''
        const unitP    = l.unitPrice != null ? fmtNum(l.unitPrice) : ''
        const discNum  = (typeof l.discount === 'number' && l.discount > 0) ? l.discount : 0
        const discTxt  = discNum > 0 ? fmtNum(discNum) + ' %' : ''
        const exVatVal = Number(l.exVat) || (Number(l.total) || 0)
        const tot      = fmtNum(exVatVal) + ' kr'

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

    renderLines(lines)
    if (extras.length > 0) renderLines(extras, 'Tillägg')

    hline(y + 2)
    y -= 10

    /* ── Totaler ── */
    if (!hasLines) {
      checkY(14)
      drawText('(Inga rader)', ML, y, { size: 9, color: muted })
      y -= 14
    }

    function totalRow(label: string, amount: string, bold = false): void {
      checkY(14)
      const font = bold ? fontBold : fontReg
      const sz   = bold ? 10 : 9
      drawText(label, COL_DISC - 120, y, { size: sz, font })
      const w = font.widthOfTextAtSize(amount, sz)
      page.drawText(amount, { x: COL_TOTAL - w, y, size: sz, font })
      y -= sz + 5
    }

    if (discAmt > 0) {
      totalRow('Delsumma:', fmtNum(rawEx) + ' kr')
      const discLabel = disc.type === 'percent'
        ? 'Rabatt (' + fmtNum(discValue) + ' %)'
        : 'Rabatt (fast)'
      totalRow(discLabel, '−' + fmtNum(discAmt) + ' kr')
    }
    totalRow('Totalt exkl. moms:', fmtNum(exVatTotal) + ' kr')
    totalRow('Moms (25 %):', fmtNum(vatAmt) + ' kr')
    if (rutTotal > 0) {
      totalRow('RUT/ROT-avdrag:', '−' + fmtNum(rutTotal) + ' kr')
    }
    y -= 2
    hline(y + 2)
    y -= 8
    totalRow('Totalt att betala:', fmtNum(customerPrice) + ' kr', true)

    y -= 14

    /* ── Villkor och beskrivning ── */
    const textSections: Array<{ label: string; value: string }> = []
    const textFields: Array<[string, string]> = [
      ['Sammanfattning', String(s('summary') ?? '')],
      ['Omfattning',     String(s('scope') ?? '')],
      ['Ingår',          String(s('includes') ?? '')],
      ['Ingår ej',       String(s('excludes') ?? '')],
      ['Villkor',        String(s('terms') ?? '')],
      ['Betalningsvillkor', String(s('paymentTerms') ?? '')],
      ['Giltighetsbetingelse', String(s('validityText') ?? '')],
      ['Allmänna villkor', String(s('generalTerms') ?? '')],
    ]
    for (const [label, val] of textFields) {
      if (val.trim()) textSections.push({ label, value: val.trim() })
    }

    if (textSections.length > 0) {
      checkY(20)
      hline(y); y -= 14
      drawText('Villkor och information', ML, y, { size: 11, font: fontBold })
      y -= 14

      for (const sec of textSections) {
        checkY(24)
        drawText(sec.label, ML, y, { size: 9, font: fontBold })
        y -= 12
        /* Multirad-text */
        const words = sec.value.split(/\s+/)
        let   line  = ''
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
    }

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
