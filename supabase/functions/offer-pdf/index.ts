/**
 * offer-pdf — Supabase Edge Function (Leverans E, Del E2b-4)
 *
 * Genererar en samlad PDF för en offert:
 *   1. Offertens textinnehåll (fakta, rader, totaler, villkor)
 *   2. Valda PDF-bilagor (infogas sida för sida med pdf-lib)
 *   3. Bilder konverteras till PDF-sidor (JPEG/PNG via pdf-lib embed)
 *
 * FORMAT SOM KAN INFOGAS:
 *   - application/pdf          → kopieras in sida för sida
 *   - image/jpeg, image/png    → inbäddas som helsidesbilder
 *
 * FORMAT SOM INTE KAN INFOGAS (anges i svaret):
 *   - .docx, .xlsx, .pptx, .doc, .xls, .txt, .csv, .zip, .dwg etc.
 *   Dessa listas separat i svaret. Kräver konvertering som EJ görs här.
 *
 * SÄKERHET:
 *   - Kräver giltig JWT (Authorization: Bearer) — intern CRM-användare
 *   - Läser bara bilagor med includeInCombinedPdf=true och active=true
 *   - offerId valideras mot store — okänt offerId → 404
 *   - Signerade nedladdnings-URL:er (1 timme) används för att hämta bilagorna
 *
 * POST /functions/v1/offer-pdf
 * Body: { offerId: string, includeAttachments?: boolean }
 * Svar 200: application/pdf (binär)
 * Svar 404: { error: 'not_found' }
 * Svar 403: { error: 'forbidden' }
 */

import { serve }        from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1'
import { checkViftAuth, hasPerm } from '../_shared/vift-auth.ts'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STORAGE_BUCKET   = 'offer-attachments'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
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
  slot.count++; return slot.count <= 10
}

/* ── Handler ─────────────────────────────────────────────── */
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!checkRateLimit(ip)) return json({ error: 'rate_limited' }, 429)

  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) return json({ error: 'forbidden' }, 403)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const auth = await checkViftAuth(supabase, jwt, CORS)
  if (!auth.ok) return auth.response
  const { perms } = auth

  if (!hasPerm(perms, 'offer_manage')) {
    return json({ error: 'forbidden' }, 403)
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return json({ error: 'invalid_json' }, 400) }

  const offerId           = String(body.offerId ?? '').trim()
  const includeAtts       = body.includeAttachments !== false

  if (!offerId) return json({ error: 'missing_offerId' }, 400)

  /* Hämta offert */
  const { data: offRow } = await supabase
    .from('store').select('value').eq('key', 'vift_offers').maybeSingle()
  const offers: Record<string, unknown>[] =
    Array.isArray(offRow?.value) ? offRow.value as Record<string, unknown>[] : []
  const off = offers.find(o => o.id === offerId)
  if (!off) return json({ error: 'not_found' }, 404)

  /* Hämta bilagor */
  const embeddableAtts: Record<string, unknown>[] = []
  const skippedAtts: Record<string, unknown>[]    = []

  if (includeAtts) {
    const { data: attRow } = await supabase
      .from('store').select('value').eq('key', 'vift_offerAttachments').maybeSingle()
    const allAtts: Record<string, unknown>[] =
      Array.isArray(attRow?.value) ? attRow.value as Record<string, unknown>[] : []

    allAtts
      .filter(a => a.offerId === offerId && a.active !== false && a.includeInCombinedPdf === true)
      .sort((a, b) => (Number(a.sortOrder)||0) - (Number(b.sortOrder)||0))
      .forEach(a => {
        const mime = String(a.mimeType || '')
        if (mime === 'application/pdf' || mime.startsWith('image/jpeg') ||
            mime.startsWith('image/png') || mime === 'image/jpg') {
          embeddableAtts.push(a)
        } else {
          skippedAtts.push(a)
        }
      })
  }

  /* Skapa PDF */
  const pdfDoc  = await PDFDocument.create()
  const font    = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontB   = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const PAGE_W  = 595  /* A4 punkter */
  const PAGE_H  = 842
  const MARGIN  = 56
  const COL_W   = PAGE_W - MARGIN * 2

  /* ── Hjälpfunktioner för textsättning ─────────────────── */
  type PageCtx = { page: ReturnType<typeof pdfDoc.addPage>, y: number }

  function newPage(): PageCtx {
    const page = pdfDoc.addPage([PAGE_W, PAGE_H])
    return { page, y: PAGE_H - MARGIN }
  }

  function drawText(ctx: PageCtx, text: string, opts: {
    size?: number; bold?: boolean; color?: [number,number,number]; indent?: number; lineH?: number
  } = {}): PageCtx {
    const size  = opts.size   ?? 10
    const f     = opts.bold   ? fontB : font
    const col   = opts.color  ? rgb(opts.color[0]/255, opts.color[1]/255, opts.color[2]/255) : rgb(0.1, 0.1, 0.1)
    const x     = MARGIN + (opts.indent ?? 0)
    const lh    = opts.lineH ?? (size * 1.5)

    /* Automatisk radbrytning */
    const words = String(text || '').split(' ')
    const lineW = COL_W - (opts.indent ?? 0)
    let   line  = ''

    const flush = (l: string) => {
      if (ctx.y < MARGIN + 40) {
        ctx = newPage()
      }
      ctx.page.drawText(l, { x, y: ctx.y, size, font: f, color: col })
      ctx.y -= lh
    }

    for (const word of words) {
      const test  = line ? line + ' ' + word : word
      const tw    = f.widthOfTextAtSize(test, size)
      if (tw > lineW && line) {
        flush(line)
        line = word
      } else {
        line = test
      }
    }
    if (line) flush(line)
    return ctx
  }

  function drawHRule(ctx: PageCtx, color = [200, 200, 200]): PageCtx {
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y },
      end:   { x: PAGE_W - MARGIN, y: ctx.y },
      thickness: 0.5,
      color: rgb(color[0]/255, color[1]/255, color[2]/255)
    })
    ctx.y -= 8
    return ctx
  }

  /* ── Offertinnehåll ───────────────────────────────────── */
  let ctx = newPage()

  /* Rubrik */
  ctx.y -= 8
  ctx = drawText(ctx, String(off.title || ('Offert ' + off.id)), { size: 20, bold: true, color: [30,64,175] })
  ctx.y -= 4
  ctx = drawText(ctx, 'Version ' + (Number(off.versionNumber)||1) + ' · ' + String(off.id), { size: 9, color: [120,120,120] })
  ctx.y -= 6
  ctx = drawHRule(ctx, [180, 200, 240])

  /* Kundinfo */
  const cuName = String(off.customerName || '')
  const coName = String(off.contactName  || '')
  const coMail = String(off.contactEmail || '')
  const addr   = String(off.address      || '')
  const date   = String((off.date || off.createdAt || '').slice(0,10))
  const until  = String((off.validUntil  || '').slice(0,10))

  const facts: [string,string][] = [
    ['Kund',        cuName || '–'],
    ['Kontakt',     coName ? (coName + (coMail ? ', ' + coMail : '')) : coMail || '–'],
    ['Fastighet',   addr || '–'],
    ['Offertdatum', date || '–'],
  ]
  if (until) facts.push(['Giltig till', until])

  ctx.y -= 8
  for (const [k, v] of facts) {
    const rowY = ctx.y
    ctx.page.drawText(k + ':', { x: MARGIN, y: rowY, size: 9, font: fontB, color: rgb(0.3,0.3,0.3) })
    ctx.page.drawText(v,        { x: MARGIN + 90, y: rowY, size: 9, font: font, color: rgb(0.1,0.1,0.1) })
    ctx.y -= 14
  }
  ctx.y -= 8

  /* V48B5 R2 §1: den gamla, ovillkorliga pris-tabell-rubriken som stod
     HÄR (mellan kundfakta och V39-CALC-BLOCK) togs bort — den ritades
     ALLTID, oavsett sectionOrder, och skapade en dubblett/särkopplad
     rubrik utöver renderPricingBlock()'s egen rubrikrad nedan. Nu
     ritas EXAKT en pris-tabell-rubrik, och bara när/om "pricing" faktiskt
     ingår i den lösta sectionOrder-sekvensen — se blockRenderers-loopen
     längre ner. */

  const fmt = (n: number) => n.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  /* V39-CALC-BLOCK-START — se run-tests-v39.js: denna sentinel avgränsar
     exakt den ekonomiska beräkningen som V39-testsviten extraherar och
     kör direkt (transpilerad via TypeScript-kompilatorn) för att
     verifiera parity med CRM/public-offer/offer-public-pdf mot den
     riktiga koden, inte en omskriven pseudokod-kopia. Ändra inte denna
     kommentar utan att uppdatera testsviten i samma leverans. */
  /* V38 §6 / V39 §4: kanonisk 0-safe momsnormalisering — samma semantik
     som InvoiceService.normalizeVatRate/PageShells._normVat (V35-V39).
     null/undefined/tomsträng (inkl. whitespace-only) = inget värde satt
     -> fallback 25; explicit 0 = 0 % (behålls exakt); giltigt 0-100
     behålls exakt; NaN/Infinity/negativt/>100 -> fallback. */
  const normVat = (value: unknown, fallback = 25): number => {
    if (value === null || value === undefined) return fallback
    if (typeof value === 'string' && value.trim() === '') return fallback
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0 || n > 100) return fallback
    return n
  }
  /* V39 §4: ex-moms för en prisrad — samma fallback-kedja som
     PageShells._lineExVat(): service-rader använder sitt förkalkylerade
     exVat, övriga radtyper använder total (med säker fallback till
     qty × unitPrice). */
  const lineExVat = (l: Record<string, unknown>): number => {
    if (l.type === 'service') return Number(l.exVat) || 0
    const qty = (l.qty !== null && l.qty !== undefined && l.qty !== '') ? Number(l.qty) : 1
    return Number(l.total) || Math.round(qty * (Number(l.unitPrice) || 0))
  }
  const allLines = [...(Array.isArray(off.lines)?off.lines as Record<string,unknown>[]:[])]
  const prLines  = allLines.filter(l => l.type !== 'text')
  const extras   = Array.isArray(off.extras) ? off.extras as Record<string,unknown>[] : []

  /* Totaler — V39 §4: speglar exakt PageShells._offerCalcTotals() /
     public-offer.html / offer-public-pdf. Ingen Number(off.discount)
     (legacy platt-tal-antagande) kvar — off.discount är alltid
     { type:'none'|'percent'|'fixed', value:number }. RUT/ROT summeras
     från service-radernas egna rutAmount, inte off.rotRutAmount/taxType.
     Beräknas HÄR (innan sidan ritas) så att både radlistan och
     totalsummeringen använder exakt samma härledda tal. */
  const rawExVat = prLines.reduce((s,l) => s + lineExVat(l), 0)
    + extras.reduce((s,e) => s + Math.round((Number(e.qty)||1) * (Number(e.unitPrice)||0)), 0)
  const rawVat = prLines.reduce((s,l) => s + Math.round(lineExVat(l) * normVat(l.vatRate) / 100), 0)
    + extras.reduce((s,e) => {
        const eEx = Math.round((Number(e.qty)||1) * (Number(e.unitPrice)||0))
        return s + Math.round(eEx * normVat(e.vatRate) / 100)
      }, 0)

  const discRaw = off.discount as Record<string, unknown> | null | undefined
  const disc: Record<string, unknown> = (discRaw && typeof discRaw === 'object' && !Array.isArray(discRaw))
    ? discRaw
    : { type: 'none', value: 0 }
  const discValue = Number(disc.value) || 0
  let discountAmount = 0
  if (discValue > 0) {
    if (disc.type === 'percent') discountAmount = Math.round(rawExVat * Math.min(discValue, 100) / 100)
    else if (disc.type === 'fixed') discountAmount = Math.min(Math.round(discValue), rawExVat)
  }

  const exVatAfterDiscount = rawExVat - discountAmount
  const vatRatio    = rawExVat > 0 ? (exVatAfterDiscount / rawExVat) : 1
  const vatAmount   = Math.round(rawVat * vatRatio)
  const totalInclVat = exVatAfterDiscount + vatAmount
  const rutRotAmount = Math.round(prLines
    .reduce((s,l) => s + (Number(l.rutAmount) || 0), 0))
  const customerPays = totalInclVat - rutRotAmount

  /* V39 §5: vatLabel baseras på ALLA prissatta poster (lines + extras) —
     tidigare räknade den bara lines, vilket kunde ge en missvisande
     "(25%)" när en tom lines-array men prissatta extras med annan sats
     fanns (every() på [] är alltid true). */
  const allPricedItems = [...prLines, ...extras]
  const vatLabel = allPricedItems.length > 0 && allPricedItems.every(item => normVat(item.vatRate) === 25)
    ? 'Moms (25%)' : 'Moms'
  /* V39-CALC-BLOCK-END */

  /* V48B5 R1 (blocker-korrigering): innehållet ritas nu som FYRA
     narrow block-render-funktioner (description/pricing/
     commercialTerms/generalTerms), anropade i off.sectionOrder-ordning
     — inte längre en fast litterär sekvens. Varje funktion tar/returnerar
     ctx (samma checkY/newPage-mekanik som innan) och rör ALDRIG
     ekonomin (V39-CALC-BLOCK ovan är oförändrat — pricing-blocket bara
     RITAR redan beräknade tal). "description" renderar nu FAKTISKT
     summary/scope/includes/excludes (fanns tidigare inte alls på denna
     yta — ett krav i denna korrigering, se RAPPORT §16), så att
     fyra-block-modellens löfte om samma innehållsstruktur som övriga
     ytor faktiskt stämmer. */

  function renderDescriptionBlock(c: PageCtx): PageCtx {
    const fields: [string, unknown][] = [
      ['Sammanfattning', off!.summary],
      ['Omfattning', off!.scope],
      ['Ingår', off!.includes],
      ['Ingår ej', off!.excludes],
    ]
    const present = fields.filter(([,v]) => v && String(v).trim())
    if (!present.length) return c
    c = drawHRule(c)
    c.y -= 4
    for (const [k, v] of present) {
      c = drawText(c, k + ':', { size: 8, bold: true, color: [90,90,90] })
      c = drawText(c, String(v), { size: 9, color: [30,30,30], indent: 4 })
      c.y -= 4
    }
    return c
  }

  function renderPricingBlock(c: PageCtx): PageCtx {
    if (c.y < MARGIN + 40) c = newPage()
    c = drawHRule(c)
    c.page.drawText('Beskrivning',   { x: MARGIN,     y: c.y, size: 9, font: fontB, color: rgb(0.3,0.3,0.3) })
    c.page.drawText('Antal',         { x: MARGIN + 270, y: c.y, size: 9, font: fontB, color: rgb(0.3,0.3,0.3) })
    c.page.drawText('À-pris',        { x: MARGIN + 320, y: c.y, size: 9, font: fontB, color: rgb(0.3,0.3,0.3) })
    c.page.drawText('Summa',         { x: PAGE_W - MARGIN - 60, y: c.y, size: 9, font: fontB, color: rgb(0.3,0.3,0.3) })
    c.y -= 6
    c = drawHRule(c)

    for (const l of allLines) {
      if (l.type === 'text') {
        /* V48B5 R4 §6/§8: en kundsynlig textrad består av blockTitle +
           text — blockTitle saknades tidigare helt här. Ritas bara om
           satt (ingen tom rubrik). */
        const blockTitle = String(l.blockTitle || '').trim()
        if (blockTitle) {
          c = drawText(c, blockTitle, { size: 9, bold: true, color: [50,50,50], indent: 0 })
        }
        const bodyText = String(l.text || (blockTitle ? '' : l.description) || '')
        if (bodyText) {
          c = drawText(c, bodyText, { size: 9, color: [80,80,80], indent: 0 })
        }
        c.y -= 2
        continue
      }
      if (c.y < MARGIN + 40) c = newPage()
      const desc = String(l.description || l.templateName || '')
      const qty  = Number(l.qty || 0)
      const up   = Number(l.unitPrice || 0)
      const tot  = lineExVat(l)
      c.page.drawText(desc.slice(0,55), { x: MARGIN,    y: c.y, size: 9, font, color: rgb(0.1,0.1,0.1) })
      c.page.drawText(qty + ' ' + String(l.unit||'st'), { x: MARGIN+270, y: c.y, size: 9, font, color: rgb(0.2,0.2,0.2) })
      c.page.drawText(fmt(up) + ' kr', { x: MARGIN+320, y: c.y, size: 9, font, color: rgb(0.2,0.2,0.2) })
      c.page.drawText(fmt(tot) + ' kr',{ x: PAGE_W-MARGIN-60, y: c.y, size: 9, font, color: rgb(0.1,0.1,0.1) })
      c.y -= 14
    }

    /* V39 §4: extras saknades tidigare helt ur den ekonomiska summeringen
       — de listas nu som egna rader (samma sätt som lines) så PDF:en
       faktiskt redovisar dem, inte bara CRM/public-offer. */
    if (extras.length) {
      if (c.y < MARGIN + 40) c = newPage()
      c.page.drawText('Tillägg', { x: MARGIN, y: c.y, size: 8, font: fontB, color: rgb(0.4,0.4,0.4) })
      c.y -= 12
      for (const e of extras) {
        if (c.y < MARGIN + 40) c = newPage()
        const desc = String(e.description || '')
        const qty  = Number(e.qty || 1)
        const up   = Number(e.unitPrice || 0)
        const tot  = Math.round(qty * up)
        c.page.drawText(desc.slice(0,55), { x: MARGIN,    y: c.y, size: 9, font, color: rgb(0.1,0.1,0.1) })
        c.page.drawText(qty + ' ' + String(e.unit||'st'), { x: MARGIN+270, y: c.y, size: 9, font, color: rgb(0.2,0.2,0.2) })
        c.page.drawText(fmt(up) + ' kr', { x: MARGIN+320, y: c.y, size: 9, font, color: rgb(0.2,0.2,0.2) })
        c.page.drawText(fmt(tot) + ' kr',{ x: PAGE_W-MARGIN-60, y: c.y, size: 9, font, color: rgb(0.1,0.1,0.1) })
        c.y -= 14
      }
    }

    c.y -= 4
    c = drawHRule(c)

    const totRows: [string, string, boolean][] = [
      ['Summa exkl. moms', fmt(rawExVat) + ' kr', false],
    ]
    if (discountAmount > 0) {
      const discLabel = disc.type === 'percent' ? `Rabatt (${fmt(discValue)}%)` : 'Rabatt'
      totRows.push([discLabel, '-' + fmt(discountAmount) + ' kr', false])
      totRows.push(['Summa exkl. moms efter rabatt', fmt(exVatAfterDiscount) + ' kr', false])
    }
    totRows.push([vatLabel, fmt(vatAmount) + ' kr', false])
    totRows.push(['Totalt inkl. moms', fmt(totalInclVat) + ' kr', true])
    if (rutRotAmount > 0) {
      totRows.push(['ROT/RUT-avdrag', '-' + fmt(rutRotAmount) + ' kr', false])
      totRows.push(['Kundpris', fmt(customerPays) + ' kr', true])
    }

    for (const [k,v,bold] of totRows) {
      if (c.y < MARGIN+40) c = newPage()
      c.page.drawText(k+':',       { x: MARGIN+270,       y: c.y, size: bold?10:9, font: bold?fontB:font, color: rgb(0.1,0.1,0.1) })
      c.page.drawText(v,           { x: PAGE_W-MARGIN-80, y: c.y, size: bold?10:9, font: bold?fontB:font, color: rgb(0.1,0.1,0.1) })
      c.y -= bold?16:13
    }
    c.y -= 8
    return c
  }

  function renderCommercialTermsBlock(c: PageCtx): PageCtx {
    const fields: [string, unknown][] = [
      ['Betalningsvillkor', off!.paymentTerms],
      ['Giltighetsbetingelse', off!.validityText],
    ]
    const present = fields.filter(([,v]) => v && String(v).trim())
    if (!present.length) return c
    c = drawHRule(c)
    c.y -= 4
    for (const [k,v] of present) {
      c = drawText(c, k + ': ' + String(v), { size: 8, color: [80,80,80] })
      c.y -= 2
    }
    return c
  }

  function renderGeneralTermsBlock(c: PageCtx): PageCtx {
    if (!off!.generalTerms) return c
    c = drawHRule(c)
    c.y -= 4
    c = drawText(c, 'Allmänna villkor: ' + String(off!.generalTerms), { size: 8, color: [80,80,80] })
    c.y -= 2
    return c
  }

  const sectionOrderRaw = Array.isArray(off!.sectionOrder)
    ? (off.sectionOrder as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  const sectionKnownIds = ['description', 'pricing', 'commercialTerms', 'generalTerms']
  const sectionSeen: Record<string, boolean> = {}
  const sectionResolved: string[] = []
  for (const id of sectionOrderRaw) {
    if (sectionKnownIds.indexOf(id) !== -1 && !sectionSeen[id]) { sectionSeen[id] = true; sectionResolved.push(id) }
  }
  for (const id of sectionKnownIds) { if (!sectionSeen[id]) { sectionSeen[id] = true; sectionResolved.push(id) } }

  const blockRenderers: Record<string, (c: PageCtx) => PageCtx> = {
    description: renderDescriptionBlock,
    pricing: renderPricingBlock,
    commercialTerms: renderCommercialTermsBlock,
    generalTerms: renderGeneralTermsBlock,
  }
  for (const id of sectionResolved) {
    ctx = blockRenderers[id](ctx)
  }

  /* ── Bilagor — infoga PDF/bilder ─────────────────────── */
  for (const a of embeddableAtts) {
    const mime = String(a.mimeType || '')
    const path = String(a.storagePath || '')
    const pathInBucket = path.replace(`${STORAGE_BUCKET}/`, '')

    /* Hämta fil från Supabase Storage via signerad URL */
    let fileBytes: Uint8Array | null = null
    try {
      const { data: urlData } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(pathInBucket, 300)
      if (urlData?.signedUrl) {
        const r = await fetch(urlData.signedUrl)
        if (r.ok) fileBytes = new Uint8Array(await r.arrayBuffer())
      }
    } catch(e) {
      console.error('[offer-pdf] fetch attachment:', e)
    }

    if (!fileBytes) continue

    /* Sidavskiljare */
    const sepPage = pdfDoc.addPage([PAGE_W, PAGE_H])
    const attName = String(a.displayName || a.originalFileName || 'Bilaga')
    sepPage.drawText(`Bilaga: ${attName}`, {
      x: MARGIN, y: PAGE_H / 2,
      size: 14, font: fontB, color: rgb(0.2,0.3,0.6)
    })
    if (a.description) {
      sepPage.drawText(String(a.description), {
        x: MARGIN, y: PAGE_H/2 - 22,
        size: 10, font, color: rgb(0.4,0.4,0.4)
      })
    }

    if (mime === 'application/pdf') {
      /* Kopiera PDF-sidor */
      try {
        const donorPdf = await PDFDocument.load(fileBytes)
        const pageIdxs = donorPdf.getPageIndices()
        const copied   = await pdfDoc.copyPages(donorPdf, pageIdxs)
        for (const pg of copied) pdfDoc.addPage(pg)
      } catch(e) {
        console.error('[offer-pdf] PDF embed:', e)
      }
    } else if (mime === 'image/jpeg' || mime === 'image/jpg') {
      try {
        const img  = await pdfDoc.embedJpg(fileBytes)
        const pg   = pdfDoc.addPage([PAGE_W, PAGE_H])
        const dims = img.scaleToFit(COL_W, PAGE_H - MARGIN*2)
        pg.drawImage(img, {
          x: MARGIN, y: MARGIN + (PAGE_H - MARGIN*2 - dims.height)/2,
          width: dims.width, height: dims.height
        })
      } catch(e) {
        console.error('[offer-pdf] JPEG embed:', e)
      }
    } else if (mime === 'image/png') {
      try {
        const img  = await pdfDoc.embedPng(fileBytes)
        const pg   = pdfDoc.addPage([PAGE_W, PAGE_H])
        const dims = img.scaleToFit(COL_W, PAGE_H - MARGIN*2)
        pg.drawImage(img, {
          x: MARGIN, y: MARGIN + (PAGE_H - MARGIN*2 - dims.height)/2,
          width: dims.width, height: dims.height
        })
      } catch(e) {
        console.error('[offer-pdf] PNG embed:', e)
      }
    }
  }

  /* Sista sida — skippade format */
  if (skippedAtts.length) {
    const lastPage = pdfDoc.addPage([PAGE_W, PAGE_H])
    let ly = PAGE_H - MARGIN
    lastPage.drawText('Separata bilagor (kan ej infogas i PDF):', {
      x: MARGIN, y: ly, size: 11, font: fontB, color: rgb(0.3,0.3,0.3)
    })
    ly -= 20
    for (const a of skippedAtts) {
      lastPage.drawText('• ' + String(a.displayName || a.originalFileName || 'Bilaga') + '  (' + String(a.mimeType||'') + ')', {
        x: MARGIN, y: ly, size: 9, font, color: rgb(0.3,0.3,0.3)
      })
      ly -= 14
    }
  }

  /* Sidnumrering */
  const pageCount = pdfDoc.getPageCount()
  for (let i = 0; i < pageCount; i++) {
    const pg = pdfDoc.getPage(i)
    pg.drawText(`${i+1} / ${pageCount}`, {
      x: PAGE_W - MARGIN - 30, y: MARGIN/2,
      size: 8, font, color: rgb(0.6,0.6,0.6)
    })
  }

  const pdfBytes = await pdfDoc.save()

  return new Response(pdfBytes, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="offert-${offerId}.pdf"`,
      'Content-Length':      String(pdfBytes.byteLength)
    }
  })
})

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}
