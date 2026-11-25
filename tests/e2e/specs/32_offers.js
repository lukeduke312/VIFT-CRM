'use strict';
/* QA 2026-11-26 — Offerter: offertdetalj (V3) och offertguiden (4 steg).
   Realistiskt innehåll: många rader av alla typer (tjänst/kalkyl, fastpris,
   löpande, fritext, rörligt à-pris, tillval), blandad moms, RUT/ROT, långa
   villkor, bilagor och kundsvar — i alla statusar. Simulerad server; inga
   utskick lämnar maskinen. Fixturerna exporteras även (module.exports.fixtures)
   för före/efter-skärmbilderna. */
const OfferCalc = require('../../../src/shared/OfferCalc.js');

const iso = (d) => new Date(Date.now() + d * 86400000).toISOString();
const LONG_TERMS = [
  'Priser anges exklusive moms om inget annat anges. Eventuella tillkommande arbeten debiteras enligt löpande räkning efter godkännande av beställaren.',
  'VIFT reserverar sig för dolda fel och förutsättningar som ej kunnat bedömas vid offerttillfället, t.ex. fukt, asbest eller bristande underlag.',
  'Beställaren ansvarar för att arbetsområdet är tillgängligt, att el och vatten finns på plats samt att boende informeras senast fem arbetsdagar innan arbetet startar.',
  'Betalning sker mot faktura 30 dagar netto. Vid försenad betalning debiteras dröjsmålsränta enligt räntelagen samt påminnelseavgift.',
  'Avbeställning senare än 48 timmar före avtalad start debiteras med 25 % av ordervärdet, dock lägst 1 500 kr exkl. moms.',
  'Garantitid enligt ABT 06 där inget annat avtalats. Reklamation ska ske skriftligen inom skälig tid efter att felet upptäckts.'
].join('\n\n');

/* Rader i realistisk mängd. mixed: en rad med 6 % moms (blandad moms).
   privat: RUT på tjänsten och ROT-underlag på en löpande rad. */
function richLines(opts) {
  opts = opts || {};
  const L = [
    { id: 'S1', type: 'service', templateId: 'altan', templateName: 'Altantvätt', description: 'Altantvätt inkl. rengöring, avfettning och behandling.', exVat: 4800, vatRate: 25, rutAmount: 0, reductionType: 'ingen', total: 4800, subLines: [{ desc: 'Altantvätt 40 m² (Måttlig)', qty: 40, unit: 'm²', price: 120 }], calculationNote: '20–50 m²' },
    { id: 'F1', type: 'fixed', description: 'Fasadtvätt puts, gavlar och entréparti — fastpris', unitPrice: 18500, vatRate: 25, billingType: 'onetime', reductionType: 'ingen', reductionBaseExVat: 0, rutAmount: 0, unit: '' },
    { id: 'T1', type: 'text', blockTitle: 'Förutsättningar', text: 'Vatten och el tillhandahålls av beställaren. Arbetet utförs vardagar 07–16.\nBoende informeras via anslag i trapphus.' },
    { id: 'M1', type: 'manual', description: 'Extra arbete vid behov', qty: 4, unit: 'tim', unitPrice: 595, vatRate: 25, billingType: 'onetime', reductionType: 'ingen', reductionBaseExVat: 0, rutAmount: 0, total: 2380 },
    { id: 'M2', type: 'manual', description: 'Skyddstäckning fönster och dörrar', qty: 24, unit: 'st', unitPrice: 89, vatRate: 25, billingType: 'onetime', reductionType: 'ingen', reductionBaseExVat: 0, rutAmount: 0, total: 2136 },
    { id: 'M3', type: 'manual', description: 'Skylift inkl. transport', qty: 2, unit: 'st', unitPrice: 1450, vatRate: 25, billingType: 'onetime', reductionType: 'ingen', reductionBaseExVat: 0, rutAmount: 0, total: 2900 },
    { id: 'M4', type: 'manual', description: 'Container för bortforsling (6 m³)', qty: 1, unit: 'st', unitPrice: 2900, vatRate: 25, billingType: 'onetime', reductionType: 'ingen', reductionBaseExVat: 0, rutAmount: 0, total: 2900 },
    { id: 'T2', type: 'text', blockTitle: 'Tidplan', text: 'Start vecka 18, beräknad tid två veckor beroende på väder.' },
    { id: 'M5', type: 'manual', description: 'Slutstädning av gård och entréer', qty: 6, unit: 'tim', unitPrice: 495, vatRate: 25, billingType: 'onetime', reductionType: 'ingen', reductionBaseExVat: 0, rutAmount: 0, total: 2970 },
    { id: 'R1', type: 'fixed', description: 'Tillkommande arbete utöver offert', unitPrice: 595, vatRate: 25, billingType: 'rate', reductionType: 'ingen', reductionBaseExVat: 0, rutAmount: 0, unit: 'tim' },
  ];
  if (opts.mixed) L.push({ id: 'M6', type: 'manual', description: 'Informationsblad till boende (trycksak)', qty: 120, unit: 'st', unitPrice: 12, vatRate: 6, billingType: 'onetime', reductionType: 'ingen', reductionBaseExVat: 0, rutAmount: 0, total: 1440 });
  if (opts.privat) {
    L[0] = Object.assign({}, L[0], { reductionType: 'rut', rutAmount: Math.round((4800 + 1200) * 0.5) });
    L[3] = Object.assign({}, L[3], { reductionType: 'rot', reductionBaseExVat: 2380, rutAmount: Math.round((2380 + 595) * 0.3) });
  }
  return L;
}
const richExtras = () => [
  { id: 'E1', description: 'Impregnering altan', qty: 40, unit: 'm²', unitPrice: 18, vatRate: 25, includedInTotal: false },
  { id: 'E2', description: 'Fönsterputs trapphus (alla plan)', qty: 1, unit: 'st', unitPrice: 3500, vatRate: 25, includedInTotal: true },
];
function richOffer(id, status, extra) {
  const o = Object.assign({
    id, title: 'Fasadtvätt och underhåll – Solgläntan 2', customerId: 'K-001', propertyId: '', address: 'Solgläntan 2, Sundbyberg',
    status, versionNumber: 1, parentOfferId: '', createdAt: iso(-6), updatedAt: iso(-2), validUntil: iso(24).slice(0, 10),
    summary: 'Tvätt av fasad och altan samt kompletterande arbeten under en tvåveckorsperiod.',
    scope: 'Högtryckstvätt av fasad (puts) och altan.\n- Behandling mot alger\n- Skyddstäckning av fönster',
    includes: '- Allt material\n- Bortforsling', excludes: '- Målning\n- Reparation av puts',
    paymentTerms: '30 dagar netto', validityText: '30 dagar', generalTerms: LONG_TERMS,
    internalNote: 'Kontaktperson: ordförande. Nyckel hämtas på kontoret.',
    lines: richLines({ mixed: true }), extras: richExtras(), discount: { type: 'percent', value: 0 },
    timeline: [{ ts: iso(-6), type: 'create', text: 'Offert skapad', user: 'Admin VIFT' }, { ts: iso(-5), type: 'comment', text: 'Ring ordföranden & stäm av <tider>', user: 'Admin VIFT' }],
    workOrderId: '', publicToken: '', tokenRevokedAt: '', sentAt: '', answeredAt: ''
  }, extra || {});
  return o;
}
const tok = (c) => c.repeat(40);
function fixtureOffers() {
  const only25 = richLines();
  return [
    richOffer('OFF-201', 'utkast'),
    richOffer('OFF-202', 'skickad', { customerId: 'K-006', title: 'Fasadtvätt BRF Parkgatan', sentAt: iso(-3), reminderSentAt: iso(-1), publicToken: tok('a'), tokenCreatedAt: iso(-3), tokenExpiresAt: iso(27), openCount: 2, openedAt: iso(-2) }),
    richOffer('OFF-203', 'godkänd', { customerId: 'K-002', title: 'Fasadrenovering Granitgatan 5', lines: only25, sentAt: iso(-5), answeredAt: iso(-1), publicToken: tok('b'), tokenCreatedAt: iso(-5), tokenExpiresAt: iso(25),
      customerApproval: { token: tok('b'), approvedAt: iso(-1), approvedByName: 'Peter Granit', approvedByEmail: 'peter@granit.se', approvedByPosition: 'Förvaltare', comment: 'Start gärna vecka 18.' } }),
    richOffer('OFF-204', 'godkänd', { customerId: 'K-001', title: 'Läckage balkong – åtgärder', lines: richLines(), workOrderId: 'AO-001', answeredAt: iso(-4), manualApproval: { method: 'Telefon', comment: 'Ordföranden godkände muntligt', registeredAt: iso(-4), registeredBy: 'Admin VIFT' } }),
    richOffer('OFF-205', 'nekad', { sentAt: iso(-9), answeredAt: iso(-2), declineReason: 'Pris', publicToken: tok('c'), tokenCreatedAt: iso(-9), tokenExpiresAt: iso(21) }),
    richOffer('OFF-206', 'ändring-begärd', { customerId: 'K-004', title: 'Fasadtvätt BRF Björkdalen', versionNumber: 2, parentOfferId: 'OFF-205', sentAt: iso(-4), answeredAt: iso(-1), publicToken: tok('d'), tokenCreatedAt: iso(-4), tokenExpiresAt: iso(26), openCount: 3, openedAt: iso(-3) }),
    richOffer('OFF-207', 'utgången', { sentAt: iso(-45), validUntil: iso(-5).slice(0, 10) }),
    richOffer('OFF-208', 'skickad', { customerId: 'K-003', title: 'Altantvätt och trädgård – Johansson', lines: richLines({ privat: true }), extras: [richExtras()[0]], sentAt: iso(-2), publicToken: tok('e'), tokenCreatedAt: iso(-2), tokenExpiresAt: iso(28) }),
  ];
}
function fixtureEvents() {
  return [
    { id: 'OE-1', offerId: 'OFF-205', type: 'declined', ts: iso(-2), byCustomer: 'Anna Ordförande', byEmail: 'styrelsen@solglantanbrf.se', comment: 'För dyrt i år, återkom till hösten.' },
    { id: 'OE-2', offerId: 'OFF-206', type: 'change_requested', ts: iso(-1), byCustomer: 'Lena Björk', byEmail: 'info@bjorkdalen.se', comment: 'Kan ni ta bort containern och lägga till fönsterputs?' },
    { id: 'OE-3', offerId: 'OFF-202', type: 'opened', ts: iso(-2) },
  ];
}
function fixtureAttachments() {
  const a = (id, offerId, name, mime, kb, i) => ({ id, offerId, displayName: name, originalFileName: name, mimeType: mime, sizeBytes: kb * 1024, active: true, sortOrder: i, includeInPublicView: true, includeInCombinedPdf: i === 0, storagePath: offerId + '/' + id });
  return [
    a('ATT-1', 'OFF-202', 'Ritning fasad.pdf', 'application/pdf', 820, 0),
    a('ATT-2', 'OFF-202', 'Foto entré.jpg', 'image/jpeg', 2300, 1),
    a('ATT-3', 'OFF-203', 'Besiktningsprotokoll.pdf', 'application/pdf', 410, 0),
  ];
}
function seedFixtures(fake) {
  fake.set('offers', fake.get('offers').concat(fixtureOffers()));
  fake.set('offerEvents', (fake.get('offerEvents') || []).concat(fixtureEvents()));
  fake.set('offerAttachments', (fake.get('offerAttachments') || []).concat(fixtureAttachments()));
}

/* ── Hjälpfunktioner ─────────────────────────────────────────────── */
const num = (t) => Number(String(t == null ? '' : t).replace(/[^\d−-]/g, '').replace('−', '-'));
const MARKUP = /<\/?(svg|path|span|div|i|b|strong|em|a|button|br|img|small|p|ul|li|table|td|tr|label|input|select|option)\b[^>]*>|&(lt|gt|amp|quot|#39|nbsp);/i;
const BROKEN = /\b(on[a-z]+|value|placeholder|class|style|href|xmlns|viewBox|stroke-width)=["']|<svg\b|<path\b/i;

async function openWizard(s) {
  await s.go('pg-offer');
  await s.page.locator('.page.active button', { hasText: 'Ny offert' }).first().click();
  await s.page.waitForSelector('#off-title', { state: 'visible' });
}
async function pickCustomer(s, id) {
  await s.eval((c) => { const e = document.getElementById('off-cu'); e.value = c; e.dispatchEvent(new Event('change', { bubbles: true })); }, id);
  await s.settle(100);
}
const row = (s, i) => s.page.locator('#off-lines .off-line-reorder-row').nth(i);
async function clickAdd(s, title) {
  const mobile = await s.eval(() => innerWidth < 1024);
  if (mobile) {
    await s.page.locator('.off-add-work-btn').click();
    await s.page.locator('.off-addwork-option', { hasText: title }).click();
  } else {
    await s.page.locator('.off-action-card:visible', { hasText: title }).click();
  }
  await s.settle(150);
}
async function addService(s, reduction) {
  await clickAdd(s, 'Tjänst / kalkyl');
  await s.page.waitForSelector('#off-svc-overlay .off-svc-menu-item');
  await s.page.locator('#off-svc-overlay .off-svc-menu-item', { hasText: 'Altantvätt' }).first().click();
  await s.page.waitForSelector('#svc-f-area');
  await s.page.fill('#svc-f-area', '40');
  await s.page.click('#svc-red-' + reduction);
  await s.page.click('#off-svc-overlay .off-svc-add-btn');
  await s.page.waitForSelector('#off-svc-overlay', { state: 'detached' });
}
async function addFixed(s, i, name, price, vat) {
  await clickAdd(s, 'Fastpris');
  const r = row(s, i);
  await r.locator('.off-fixed-name').fill(name);
  await r.locator('.off-money-input').first().fill(price);
  if (vat != null) await r.locator('select').nth(0).selectOption(String(vat));
}
async function addManual(s, i, name, qty, price, vat) {
  await clickAdd(s, 'Löpande rad');
  const r = row(s, i);
  await r.locator('.off-wiz-line-field-desc').fill(name);
  await r.locator('input[type=number]').first().fill(String(qty));
  await r.locator('.off-money-input').first().fill(price);
  if (vat != null) await r.locator('select').nth(1).selectOption(String(vat));
}
async function addText(s, i, title, text) {
  await clickAdd(s, 'Fritext');
  const r = row(s, i);
  await r.locator('.off-wiz-line-field-title').fill(title);
  await r.locator('textarea').fill(text);
}
async function addExtra(s, k, name, qty, price, included) {
  await clickAdd(s, 'Tillval');
  const x = s.page.locator('#off-extras .off-extra-row').nth(k);
  await x.locator('.off-extra-desc').fill(name);
  await x.locator('.off-extra-qty').fill(String(qty));
  await x.locator('.off-extra-price').fill(String(price));
  const cb = x.locator('.off-extra-included input');
  if ((await cb.isChecked()) !== !!included) { await cb.click(); }
  await s.settle(100);
}
/* Summeringsrader [{l, v}] ur en .offd-totals-behållare. */
async function totalsRows(s, sel) {
  return s.eval((q) => [...document.querySelectorAll(q + ' .offd-tr')].filter((e) => e.offsetParent).map((e) => ({ l: e.querySelector('.offd-tr-l').textContent.trim(), v: e.querySelector('.offd-tr-v').textContent.trim() })), sel);
}
function checkRows(t, rows, tot, where) {
  const get = (re) => { const r = rows.find((x) => re.test(x.l)); return r ? num(r.v) : null; };
  t.assert(get(/^Summa exkl\. moms$/) === tot.rawExVat, where + ': Summa exkl. moms ' + get(/^Summa exkl\. moms$/) + ' = OfferCalc ' + tot.rawExVat);
  t.assert(get(/^Moms$/) === tot.vatAmount, where + ': Moms ' + get(/^Moms$/) + ' = OfferCalc ' + tot.vatAmount);
  t.assert(get(/^Totalt inkl\. moms$/) === tot.totalInclVat, where + ': Totalt inkl. moms ' + get(/^Totalt inkl\. moms$/) + ' = OfferCalc ' + tot.totalInclVat);
  if (tot.discountAmount) t.assert(get(/^Rabatt$/) === -tot.discountAmount, where + ': Rabatt');
  if (tot.rutRotAmount) {
    t.assert(get(/^RUT\/ROT-avdrag/) === -tot.rutRotAmount, where + ': RUT/ROT ' + get(/^RUT\/ROT-avdrag/) + ' = −' + tot.rutRotAmount);
    t.assert(get(/^Kund betalar inkl\. moms$/) === tot.customerPays, where + ': Kund betalar ' + get(/^Kund betalar inkl\. moms$/) + ' = ' + tot.customerPays);
  }
  const parts = rows.filter((x) => /^varav moms /.test(x.l));
  if (parts.length) t.assert(parts.reduce((a, x) => a + num(x.v), 0) === tot.vatAmount, where + ': moms per sats summerar till Moms (' + parts.map((x) => x.l + ' ' + x.v).join(', ') + ')');
  return parts;
}
async function visibleMarkup(s) {
  return s.eval(([src, bsrc]) => {
    const re = new RegExp(src, 'i'); const broken = new RegExp(bsrc, 'i'); const out = [];
    const roots = [document.querySelector('.page.active'), ...document.querySelectorAll('.modal-overlay.open')].filter(Boolean);
    for (const root of roots) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { const el = n.parentElement; if (!el || el.closest('script,style,textarea') || !el.offsetParent) continue; const m = n.nodeValue.match(re) || n.nodeValue.match(broken); if (m) out.push(String(el.className).split(' ')[0] + ': ' + n.nodeValue.trim().slice(0, 60)); }
      root.querySelectorAll('[title],[placeholder],[aria-label]').forEach((e) => ['title', 'placeholder', 'aria-label'].forEach((a) => { const v = e.getAttribute(a); if (v && (re.test(v) || v.includes('<'))) out.push(a + ': ' + v.slice(0, 60)); }));
    }
    return out.slice(0, 6);
  }, [MARKUP.source, BROKEN.source]);
}
async function overflow(s) {
  const issues = await s.layoutIssues();
  const extra = await s.eval(() => {
    const vw = document.documentElement.clientWidth; const out = [];
    const sc = document.getElementById('content-scroll');
    if (sc && sc.scrollWidth > sc.clientWidth + 2) out.push('innehållet scrollar horisontellt: ' + sc.scrollWidth + ' > ' + sc.clientWidth);
    document.querySelectorAll('.page.active .offd-actions .btn, .page.active .offw-ftr .btn, .page.active .offw-step').forEach((b) => {
      const r = b.getBoundingClientRect(); if (r.width && (r.right > vw + 1 || r.left < -1)) out.push('klippt: ' + b.textContent.trim().slice(0, 24));
    });
    return out;
  });
  return issues.concat(extra);
}

/* Förväntad primär åtgärd och åtgärder som måste gå att nå per status
   (inventerade från den tidigare vyn, se OfferDetailPage._actionModel). */
const STATUS_CASES = [
  { id: 'OFF-201', st: 'utkast', primary: /OfferDetailPage\.showSendModal\('OFF-201'\)/, label: /Skicka offert/,
    reach: ['generateDigitalLink', "OffersPage.openEdit('OFF-201')", 'printPdf', 'createNewVersion', 'duplicate', 'archiveOffer', 'deleteOffer'] },
  { id: 'OFF-202', st: 'skickad', primary: /_quickAction\('OFF-202','followup'\)/, label: /Boka uppföljning/,
    reach: ['showReminderModal', 'openApprovalModal', "setStatus('nekad')", "setStatus('väntar')", "setStatus('utgången')", 'openEdit', 'printPdf', 'createNewVersion', 'duplicate', 'archiveOffer', 'deleteOffer', 'revokeDigitalLink', 'extendDigitalLink', 'generateDigitalLink', '_copyLink', "_quickAction('OFF-202','ring')", '_addComment'] },
  { id: 'OFF-206', st: 'ändring-begärd', primary: /createNewVersion\('OFF-206'\)/, label: /Skapa ny version/,
    reach: ['openEdit', 'printPdf', 'duplicate', 'archiveOffer', 'deleteOffer', 'revokeDigitalLink'] },
  { id: 'OFF-203', st: 'godkänd', primary: /^OfferDetailPage\.createAO\(\)$/, label: /^Skapa arbetsorder$/,
    reach: ['openEdit', 'printPdf', 'createNewVersion', 'duplicate', 'archiveOffer', 'deleteOffer'] },
  { id: 'OFF-204', st: 'godkänd (AO finns)', primary: /pg-ao-detail.*AO-001/, label: /Öppna arbetsorder/,
    reach: ['printPdf', 'createNewVersion', 'duplicate', 'archiveOffer', 'deleteOffer'] },
  { id: 'OFF-205', st: 'nekad', primary: /createNewVersion\('OFF-205'\)/, label: /Skapa ny version/,
    reach: ['openApprovalModal', "setStatus('väntar')", 'openEdit', 'printPdf', 'duplicate', 'archiveOffer', 'deleteOffer'] },
  { id: 'OFF-207', st: 'utgången', primary: /duplicate\('OFF-207'\)/, label: /Förnya offert/,
    reach: ["setStatus('väntar')", 'openEdit', 'printPdf', 'createNewVersion', 'archiveOffer', 'deleteOffer'] },
  { id: 'OFF-209', st: 'arkiverad', primary: /restoreOffer\('OFF-209'\)/, label: /Återställ offert/, reach: ['printPdf', 'createNewVersion', 'duplicate'], absent: ['archiveOffer', 'deleteOffer', 'openApprovalModal'] },
  { id: 'OFF-210', st: 'borttagen', primary: /restoreOffer\('OFF-210'\)/, label: /Återställ offert/, reach: ['printPdf', 'permanentDeleteOffer'], absent: ['archiveOffer', 'deleteOffer', 'createNewVersion'] },
];

module.exports = [
  {
    id: 'OFFW-01', kind: 'workflow', module: 'Offertmodulen',
    name: 'Offertguiden (BRF): stegvalidering, alla radtyper via guiden (tjänst/kalkyl, fastpris, löpande, fritext, tillval i/utanför summan), blandad moms — livesummering, granskning och sparad offert = OfferCalc; detaljvyn visar samma innehåll och belopp',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openWizard(s);
      // Stegvalidering: utan kund går det inte vidare (besked vid knappen, kvar på steg 1)
      await s.page.locator('button:visible', { hasText: /Nästa: Tjänster/ }).click();
      t.assert(await s.eval(() => OffersPage._wizardStep) === 1, 'utan kund: kvar på steg 1');
      t.assert(/Välj en kund/.test(await s.text('#offw-msg')), 'utan kund: besked i guiden (' + (await s.text('#offw-msg')) + ')');
      // Stegvisaren: hopp till "Granska" utan kund stoppas också
      await s.page.locator('.offw-steps--hdr .offw-step', { hasText: 'Granska & spara' }).click();
      t.assert(await s.eval(() => OffersPage._wizardStep) === 1, 'stegvisaren hoppar inte förbi valideringen');
      await s.page.fill('#off-title', 'Fasadtvätt BRF E2E');
      await pickCustomer(s, 'K-001');
      t.assert(/BRF Solgläntan/.test(await s.text('#offw-cu-info')) && /BRF/.test(await s.text('#offw-cu-info .offd-cutype')), 'vald kund visas med kundtyp BRF');
      t.assert(await s.eval(() => document.getElementById('offw-msg').hidden), 'beskedet försvinner när kund valts');
      await s.page.locator('button:visible', { hasText: /Nästa: Tjänster/ }).click();
      t.assert(await s.eval(() => OffersPage._wizardStep) === 2, 'steg 2');
      // Steg 2 utan prisrader: besked
      await s.page.locator('button:visible', { hasText: /Nästa: Villkor/ }).click();
      t.assert(await s.eval(() => OffersPage._wizardStep) === 2 && /minst en prisrad/.test(await s.text('#offw-msg')), 'utan prisrad: kvar på steg 2 med besked');
      // Alla radtyper genom gränssnittet
      await addService(s, 'ingen');
      await addFixed(s, 1, 'Fasadtvätt puts — fastpris', '18 500');
      await addText(s, 2, 'Förutsättningar', 'Vatten och el tillhandahålls av beställaren.');
      await addManual(s, 3, 'Extra arbete', 4, '595');
      await addManual(s, 4, 'Informationsblad (trycksak)', 120, '12', 6);
      await addExtra(s, 0, 'Impregnering altan', 40, 18, false);
      await addExtra(s, 1, 'Fönsterputs trapphus', 1, 3500, true);
      await s.settle(400);
      // Livesummering = OfferCalc (räknat här i testprocessen på guidens data)
      const draft = await s.eval(() => ({ lines: OffersPage._editLines, extras: OffersPage._editExtras, discount: OffersPage._discount }));
      t.assert(draft.lines.length === 5 && draft.lines.map((l) => l.type).join(',') === 'service,fixed,text,manual,manual', 'fem rader i rätt ordning: ' + draft.lines.map((l) => l.type).join(','));
      let tot = OfferCalc.totals(draft);
      let rows = await totalsRows(s, '#off-totals-bar');
      const parts = checkRows(t, rows, tot, 'livesummering');
      t.assert(parts.length === 2 && /25 %/.test(parts[0].l) && /6 %/.test(parts[1].l), 'moms per sats visas för blandad moms (25 % och 6 %)');
      t.assert(OfferCalc.vatRatesInTotal(draft).join(',') === '25,6', 'OfferCalc ser samma momssatser');
      // Ändring slår igenom direkt i summeringen (antal 4 → 6 på löpande rad)
      await row(s, 3).locator('input[type=number]').first().fill('6');
      await s.settle(250);
      const draft2 = await s.eval(() => ({ lines: OffersPage._editLines, extras: OffersPage._editExtras, discount: OffersPage._discount }));
      tot = OfferCalc.totals(draft2);
      t.assert(tot.rawExVat === OfferCalc.totals(draft).rawExVat + 2 * 595, 'antalet ändrat i datat');
      checkRows(t, await totalsRows(s, '#off-totals-bar'), tot, 'livesummering efter ändring');
      // Benämning uppdateras i summeringens radlista
      t.assert(/Informationsblad \(trycksak\)/.test(await s.text('#off-totals-bar .offw-sum-lines')), 'radlistan i summeringen visar benämningarna');
      await s.page.locator('button:visible', { hasText: /Nästa: Villkor/ }).click();
      await s.page.fill('#off-payment', '20 dagar netto');
      await s.page.locator('button:visible', { hasText: /Nästa: Granska/ }).click();
      t.assert(await s.eval(() => OffersPage._wizardStep) === 4, 'steg 4 Granska');
      // Granskning: alla rader och tillval, samma belopp, info om momsspärr
      const rv = await s.eval(() => ({ text: document.querySelector('.offw-review').innerText, rows: document.querySelectorAll('.offw-review .offd-lt-row, .offw-review .offd-lt-text').length }));
      for (const n of ['Altantvätt', 'Fasadtvätt puts — fastpris', 'Förutsättningar', 'Extra arbete', 'Informationsblad (trycksak)', 'Impregnering altan', 'Fönsterputs trapphus', '20 dagar netto', 'Fasadtvätt BRF E2E']) t.assert(rv.text.includes(n), 'granskningen visar "' + n + '"');
      t.assert(rv.rows === 7, 'granskningen har 5 rader + 2 tillval (' + rv.rows + ')');
      t.assert(/blandade momssatser/.test(rv.text) && /inte göras om till arbetsorder automatiskt/.test(rv.text), 'granskningen upplyser om momsspärren vid blandad moms');
      checkRows(t, await totalsRows(s, '.offw-review'), tot, 'granskning');
      t.assert((await visibleMarkup(s)).length === 0, 'ingen markup som text i granskningen');
      // Spara
      await s.page.locator('button:visible', { hasText: /Spara offert/ }).click();
      await s.waitToast(/skapad/i, 8000);
      const off = t.fake.get('offers').find((o) => o.title === 'Fasadtvätt BRF E2E');
      t.assert(off && off.status === 'utkast' && off.customerId === 'K-001' && off.paymentTerms === '20 dagar netto', 'offerten sparad på servern');
      const saved = OfferCalc.totals(off);
      t.assert(JSON.stringify(saved) === JSON.stringify(tot), 'sparade beloppen = guidens (' + saved.totalInclVat + ' / ' + tot.totalInclVat + ')');
      t.assert(off.lines.length === 5 && off.extras.length === 2 && off.extras.filter((e) => e.includedInTotal === false).length === 1, 'alla rader och tillval sparade (ett utanför summan)');
      // Detaljvyn: samma belopp i huvud och summering, alla rader
      await s.go('pg-offer-detail', { offerId: off.id }); await s.settle(400);
      const head = await s.eval(() => Object.fromEntries([...document.querySelectorAll('.offd-amt')].map((e) => [e.querySelector('dt').textContent.trim(), e.querySelector('dd').textContent.trim()])));
      t.assert(num(head['Exkl. moms']) === saved.exVatAfterDiscount && num(head.Moms) === saved.vatAmount && num(head['Totalt inkl. moms']) === saved.totalInclVat, 'detaljhuvudet = OfferCalc: ' + JSON.stringify(head));
      checkRows(t, await totalsRows(s, '.offd-content'), saved, 'detaljsummering');
      const dt = await s.eval(() => document.querySelector('.offd-content').innerText);
      for (const n of ['Altantvätt', 'Fasadtvätt puts — fastpris', 'Förutsättningar', 'Extra arbete', 'Informationsblad (trycksak)', 'Impregnering altan', 'Fönsterputs trapphus']) t.assert(dt.includes(n), 'detaljen visar "' + n + '"');
      // Öppna i guiden igen: oförändrade summor
      await s.eval((id) => OffersPage.openEdit(id), off.id); await s.settle(300);
      await s.eval(() => OffersPage._goStep(4)); await s.settle(300);
      checkRows(t, await totalsRows(s, '.offw-review'), saved, 'återöppnad i guiden');
      await s.eval(() => OffersPage._wizardClose());
    },
  },
  {
    id: 'OFFW-02', kind: 'workflow', module: 'Offertmodulen',
    name: 'Offertguiden på mobil (390 px, privatkund): tjänst med RUT, fastpris, löpande, fritext och tillval via "Lägg till arbete" — inget klipps eller scrollar i sidled i något steg; summering med RUT = OfferCalc; sparad offert öppnas i detaljvyn',
    async run(t) {
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('admin');
      await openWizard(s);
      const issues = [];
      const check = async (where) => { const r = await overflow(s); if (r.length) issues.push(where + ': ' + r.join('; ')); };
      await check('steg 1 tomt');
      await s.page.fill('#off-title', 'Altantvätt Johansson E2E');
      await pickCustomer(s, 'K-003');
      t.assert(/Privatperson/.test(await s.text('#offw-cu-info')), 'privatkund visas som Privatperson');
      await check('steg 1 ifyllt');
      // Stegvisaren på mobil: fyra knappar med tryckyta >= 40 px
      const steps = await s.eval(() => [...document.querySelectorAll('.offw-steps--inline .offw-step')].map((b) => Math.round(b.getBoundingClientRect().height)));
      t.assert(steps.length === 4 && steps.every((h) => h >= 40), 'mobilens stegvisare: 4 knappar >= 40 px (' + steps.join(',') + ')');
      await s.page.locator('button:visible', { hasText: /Nästa: Tjänster/ }).click();
      await addService(s, 'rut');
      await addFixed(s, 1, 'Trädgårdsstädning fastpris', '3 200');
      await addManual(s, 2, 'Bortforsling', 2, '450');
      await addText(s, 3, 'Information', 'Vi kommer tisdag förmiddag.');
      await addExtra(s, 0, 'Impregnering', 20, 18, false);
      await s.settle(300);
      await check('steg 2 med rader');
      // Mobilens summeringsrad: huvudbelopp = kund betalar (RUT) och detaljer = OfferCalc
      const draft = await s.eval(() => ({ lines: OffersPage._editLines, extras: OffersPage._editExtras, discount: OffersPage._discount }));
      const tot = OfferCalc.totals(draft);
      t.assert(tot.rutRotAmount > 0, 'tjänsten har RUT-avdrag');
      const mb = await s.eval(() => ({ lbl: document.querySelector('#off-mobile-totals .off-wiz-mobile-totals-lbl').textContent, val: document.querySelector('#off-mobile-totals .off-wiz-mobile-totals-val').textContent }));
      t.assert(/Kund betalar inkl\. moms/.test(mb.lbl) && num(mb.val) === tot.customerPays, 'mobilens summeringsrad: ' + mb.lbl + ' ' + mb.val + ' = ' + tot.customerPays);
      await s.page.click('#off-mobile-totals .off-wiz-mobile-totals-toggle'); await s.settle(150);
      checkRows(t, await totalsRows(s, '#off-mobile-totals'), tot, 'mobilens utfällda summering');
      await check('steg 2 summering utfälld');
      await s.page.locator('button:visible', { hasText: /Nästa: Villkor/ }).click(); await check('steg 3');
      await s.page.locator('button:visible', { hasText: /Nästa: Granska/ }).click(); await check('steg 4');
      const rv = await s.eval(() => document.querySelector('.offw-review').innerText);
      t.assert(!/registrerad som/.test(rv), 'ingen RUT-varning för privatperson');
      checkRows(t, await totalsRows(s, '.offw-review'), tot, 'granskning mobil');
      await s.page.locator('button:visible', { hasText: /Spara offert/ }).click();
      await s.waitToast(/skapad/i, 8000);
      const off = t.fake.get('offers').find((o) => o.title === 'Altantvätt Johansson E2E');
      t.assert(off && JSON.stringify(OfferCalc.totals(off)) === JSON.stringify(tot), 'sparad offert = guidens belopp');
      await s.go('pg-offer-detail', { offerId: off.id }); await s.settle(400);
      await check('detalj');
      const head = await s.eval(() => Object.fromEntries([...document.querySelectorAll('.offd-amt')].map((e) => [e.querySelector('dt').textContent.trim(), e.querySelector('dd').textContent.trim()])));
      t.assert(num(head['Kund betalar inkl. moms']) === tot.customerPays && num(head['Totalt inkl. moms']) === tot.totalInclVat, 'detaljhuvudet visar kund betalar och totalt: ' + JSON.stringify(head));
      const primary = await s.eval(() => { const b = document.querySelector('.offd-actions .btn.bp'); const r = b.getBoundingClientRect(); return { h: r.height, w: r.width, vw: innerWidth, t: b.textContent.trim() }; });
      t.assert(primary.h >= 44 && primary.w > primary.vw * 0.8 && /Skicka offert/.test(primary.t), 'mobil: primär åtgärd "Skicka offert" i full bredd, >= 44 px (' + JSON.stringify(primary) + ')');
      t.assert(issues.length === 0, 'klippning/sidscroll: ' + issues.join(' | '));
    },
  },
  {
    id: 'OFFD-01', module: 'Offertmodulen',
    name: 'Offertdetalj per status (utkast, skickad, ändring begärd, godkänd, godkänd med AO, nekad, utgången, arkiverad, borttagen): rätt primär åtgärd (en enda), alla tidigare åtgärder går att nå (knapp, "⋮"-meny eller statusmeny); menyn öppnas, är inom skärmen och stängs med Escape',
    async run(t) {
      require('./32_offers.js').fixtures.seedFixtures(t.fake);
      const offers = t.fake.get('offers');
      offers.push(Object.assign(require('./32_offers.js').fixtures.richOffer('OFF-209', 'skickad', { archived: true })));
      offers.push(Object.assign(require('./32_offers.js').fixtures.richOffer('OFF-210', 'utkast', { deleted: true })));
      t.fake.set('offers', offers);
      for (const vp of ['laptop', 'iphone']) {
        const s = await t.world.session({ viewport: vp });
        await s.login('admin');
        for (const c of STATUS_CASES) {
          await s.go('pg-offer-detail', { offerId: c.id }); await s.settle(250);
          // Hopfällda kort (Bilagor, Säljtips, Historik) öppnas — deras åtgärder ska också finnas
          for (let k = 0; k < 4; k++) {
            const closed = s.page.locator('.page.active .offd-ch-toggle[aria-expanded="false"]');
            if (!(await closed.count())) break;
            await closed.first().click(); await s.settle(120);
          }
          const r = await s.eval(() => {
            const pg = document.querySelector('.page.active');
            const prim = [...pg.querySelectorAll('.offd-actions > .btn.bp')];
            const first = pg.querySelector('.offd-actions > .btn');
            return {
              nPrimary: prim.length,
              primaryFn: first ? first.getAttribute('onclick') : '', primaryText: first ? first.textContent.trim() : '',
              fns: [...pg.querySelectorAll('[onclick]')].map((e) => e.getAttribute('onclick')),
              menuItems: pg.querySelectorAll('#offd-more-menu .ao-overflow-menu-item').length,
            };
          });
          t.assert(r.nPrimary <= 1, vp + ' ' + c.st + ': högst en primär knapp (' + r.nPrimary + ')');
          t.assert(c.primary.test(r.primaryFn) && c.label.test(r.primaryText), vp + ' ' + c.st + ': primär åtgärd "' + r.primaryText + '" → ' + r.primaryFn);
          const all = r.fns.join('\n');
          const missing = c.reach.filter((f) => !all.includes(f));
          t.assert(missing.length === 0, vp + ' ' + c.st + ': åtgärder som inte går att nå: ' + missing.join(', '));
          const present = (c.absent || []).filter((f) => all.includes(f));
          t.assert(present.length === 0, vp + ' ' + c.st + ': åtgärder som inte ska finnas: ' + present.join(', '));
          // Menyn: öppna, kontrollera synlighet, stäng med Escape
          if (r.menuItems) {
            await s.page.click('#offd-more-btn'); await s.settle(150);
            const m = await s.eval(() => { const el = document.getElementById('offd-more-menu'); const rr = el.getBoundingClientRect(); const items = [...el.querySelectorAll('.ao-overflow-menu-item')]; return { open: el.classList.contains('open'), inView: rr.left >= 0 && rr.right <= innerWidth + 1 && rr.top >= 0, focus: el.contains(document.activeElement), labels: items.map((i) => i.textContent.trim()), last: items.length ? items[items.length - 1].className : '' }; });
            t.assert(m.open && m.inView, vp + ' ' + c.st + ': "⋮"-menyn öppnas inom skärmen');
            t.assert(m.focus, vp + ' ' + c.st + ': fokus flyttas in i menyn');
            if (!/arkiverad/.test(c.st)) t.assert(/--red/.test(m.last), vp + ' ' + c.st + ': destruktiv åtgärd sist i menyn (' + m.labels.join(' | ') + ')');
            await s.page.keyboard.press('Escape'); await s.settle(100);
            t.assert(await s.eval(() => !document.getElementById('offd-more-menu').classList.contains('open')), vp + ' ' + c.st + ': Escape stänger menyn');
          }
          if (vp === 'laptop') t.note(c.st + ': ' + r.primaryText + ' + ' + r.menuItems + ' menyposter');
        }
        await s.context.close();
      }
    },
  },
  {
    id: 'OFFD-02', module: 'Offertmodulen',
    name: 'Offertdetalj: belopp i huvud, rader och summering = OfferCalc för alla offerter (seed + realistiska fixturer: blandad moms, RUT/ROT, rabatt, återkommande och rörliga rader, tillval i/utanför summan); moms per sats summerar till momsen; alltid "exkl./inkl. moms"; ingen markup som text; historikens text visas oförändrad (ingen dubbel escapning)',
    async run(t) {
      const F = require('./32_offers.js').fixtures;
      F.seedFixtures(t.fake);
      const offers = t.fake.get('offers');
      offers.push(F.richOffer('OFF-211', 'skickad', { discount: { type: 'percent', value: 12 }, title: 'Rabatterad offert' }));
      offers.push(F.richOffer('OFF-212', 'utkast', { title: 'Avtal med fast månadskostnad', lines: [{ id: 'R1', type: 'fixed', description: 'Fastighetsskötsel', unitPrice: 8000, vatRate: 25, billingType: 'recurring', unit: 'mån' }, { id: 'F1', type: 'fixed', description: 'Uppstart', unitPrice: 2500, vatRate: 25, billingType: 'onetime' }], extras: [] }));
      t.fake.set('offers', offers);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      const ids = t.fake.get('offers').map((o) => o.id);
      const hits = [];
      for (const id of ids) {
        const off = t.fake.get('offers').find((o) => o.id === id);
        const tot = OfferCalc.totals(off);
        await s.go('pg-offer-detail', { offerId: id }); await s.settle(200);
        const d = await s.eval(() => ({
          head: Object.fromEntries([...document.querySelectorAll('.offd-amt')].map((e) => [e.querySelector('dt').textContent.trim(), e.querySelector('dd').textContent.trim()])),
          sums: [...document.querySelectorAll('.offd-content .offd-lt-row:not(.is-extra) .offd-lt-sum')].map((e) => e.textContent.trim()),
        }));
        if (tot.rawExVat > 0) {
          checkRows(t, await totalsRows(s, '.offd-content'), tot, id);
          const ex = d.head['Exkl. moms'] || d.head['Engångsbelopp exkl. moms'];
          const inc = d.head['Totalt inkl. moms'] || d.head['Engångsbelopp inkl. moms'];
          if (num(ex) !== tot.exVatAfterDiscount || num(d.head.Moms) !== tot.vatAmount || num(inc) !== tot.totalInclVat) hits.push(id + ' huvud ' + JSON.stringify(d.head));
          if (tot.rutRotAmount && num(d.head['Kund betalar inkl. moms']) !== tot.customerPays) hits.push(id + ' kund betalar');
        }
        if (tot.recurringMonthlyExVat && num(d.head['Fast kostnad per månad']) !== tot.recurringMonthlyExVat) hits.push(id + ' månadskostnad ' + JSON.stringify(d.head));
        // Varje radbelopp = OfferCalc.lineExVat
        const priced = (off.lines || []).filter((l) => l.type !== 'text');
        priced.forEach((l, i) => { const exp = (l.billingType === 'rate') ? null : OfferCalc.lineExVat(l); if (exp !== null && num(d.sums[i]) !== exp) hits.push(id + ' rad ' + i + ': ' + d.sums[i] + ' ≠ ' + exp); });
        Object.keys(d.head).forEach((k) => { if (/moms/i.test(k) && !/exkl\. moms|inkl\. moms|^Moms$/i.test(k)) hits.push(id + ' otydlig etikett: ' + k); });
        const mk = await visibleMarkup(s);
        if (mk.length) hits.push(id + ' markup: ' + mk.join(' | '));
      }
      // Historik: "&" och "<tider>" visas som skrivet (tidigare dubbel-escapat)
      await s.go('pg-offer-detail', { offerId: 'OFF-201' }); await s.settle(200);
      await s.page.locator('.offd-tl .offd-ch-toggle').click(); await s.settle(200);
      const tl = await s.text('.offd-tl');
      t.assert(tl.includes('Ring ordföranden & stäm av <tider>') && !/&amp;|&lt;/.test(tl), 'historiken visar texten oförändrad');
      t.note(ids.length + ' offerter kontrollerade');
      t.assert(hits.length === 0, hits.join(' ; '));
    },
  },
  {
    id: 'OFFD-03', kind: 'workflow', module: 'Digitala offertlänkar och kundsvar',
    name: 'Offertdetalj: generera länk via bekräftelsedialog (utkast), registrera godkännande via statusmenyn, momsspärr vid blandad moms (ingen AO), Skapa arbetsorder skapar exakt en AO och primärknappen blir "Öppna arbetsorder"; kundens svar (nekad/ändring) visas',
    async run(t) {
      require('./32_offers.js').fixtures.seedFixtures(t.fake);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      // 1. Generera länk (utkast) — sekundärknappen i huvudet, bekräftelsedialog
      await s.go('pg-offer-detail', { offerId: 'OFF-201' }); await s.settle(300);
      await s.page.locator('.offd-actions .btn', { hasText: 'Generera länk' }).click();
      t.assert(/Generera digital offertlänk/.test(await s.text('.modal-overlay.open')), 'bekräftelsedialog visas');
      await s.page.selectOption('#link-days', '14');
      await s.clickModalButton(/Generera länk/);
      await s.waitToast(/Länk genererad — giltig i 14 dagar/, 6000);
      const tok = (t.fake.get('offers').find((o) => o.id === 'OFF-201') || {}).publicToken;
      t.assert(tok && tok.length >= 32, 'token sparad på servern');
      t.assert((await s.eval(() => document.getElementById('off-pub-link').value)).includes(tok) && /Aktiv/.test(await s.text('.offd-link')), 'länkkortet visar aktiv länk');
      t.assert(!(await s.eval(() => [...document.querySelectorAll('.offd-actions .btn')].some((b) => /Generera länk/.test(b.textContent)))), '"Generera länk" försvinner ur huvudet när länk finns');
      // 2. Registrera godkännande (skickad, blandad moms) via statusmenyn
      await s.go('pg-offer-detail', { offerId: 'OFF-202' }); await s.settle(300);
      await s.page.click('#offd-status-btn');
      await s.page.locator('#offd-status-popover .off-status-popover-item', { hasText: 'Registrera godkännande' }).click();
      await s.page.selectOption('#appr-method', 'E-post');
      await s.clickModalButton(/Bekräfta godkännande/);
      await s.waitToast(/Godkännande registrerat/, 6000);
      t.assert((t.fake.get('offers').find((o) => o.id === 'OFF-202') || {}).status === 'godkänd', 'godkänd på servern');
      const blocked = await s.eval(() => { const b = document.querySelector('.offd-actions > .btn'); return { t: b.textContent.trim(), title: b.getAttribute('title') || '', cls: b.className }; });
      t.assert(/offd-btn--blocked/.test(blocked.cls) && blocked.title.length > 10, 'blandad moms: spärrad primärknapp med förklaring (' + blocked.t + ')');
      t.assert(/Godkännande registrerat/.test(await s.text('.offd-resp')) && /E-post/.test(await s.text('.offd-resp')), 'kortet "Godkännande registrerat" visar metod');
      await s.page.locator('.offd-actions > .btn').first().click(); await s.settle(300);
      t.assert(/Kan inte skapa arbetsorder/.test(await s.text('.modal-overlay.open')), 'momsspärren förklaras i dialog');
      await s.eval(() => Modal.close());
      t.assert(!t.fake.get('workOrders').some((a) => a.offerId === 'OFF-202'), 'ingen AO för blandad moms');
      // 3. Skapa arbetsorder (25 %) — exakt en
      await s.go('pg-offer-detail', { offerId: 'OFF-203' }); await s.settle(300);
      t.assert(/Godkänd av kunden/.test(await s.text('.offd-resp')) && /Peter Granit/.test(await s.text('.offd-resp')), 'kundens digitala godkännande visas');
      await s.page.locator('.offd-actions > .btn.bp', { hasText: 'Skapa arbetsorder' }).click();
      await s.page.waitForFunction(() => state.workOrders.some((a) => a.offerId === 'OFF-203' && !a._pendingSync), null, { timeout: 10000 });
      await s.settle(1200);
      await s.eval(() => OfferDetailPage.createAO()); await s.settle(600);
      const aos = t.fake.get('workOrders').filter((a) => a.offerId === 'OFF-203');
      t.assert(aos.length === 1, 'exakt en AO på servern (' + aos.length + ')');
      await s.go('pg-offer-detail', { offerId: 'OFF-203' }); await s.settle(300);
      const p = await s.eval(() => { const b = document.querySelector('.offd-actions > .btn'); return { t: b.textContent.trim(), fn: b.getAttribute('onclick') }; });
      t.assert(/Öppna arbetsorder/.test(p.t) && p.fn.includes(aos[0].id), 'primärknappen öppnar den skapade AO:n (' + p.t + ')');
      t.assert(await s.eval(() => !!document.querySelector('.offd-ao .offd-linkrow')), 'kortet Arbetsorder länkar till AO:n');
      // 4. Kundens svar: nekad och ändring begärd
      await s.go('pg-offer-detail', { offerId: 'OFF-205' }); await s.settle(250);
      t.assert(/Kunden nekade offerten/.test(await s.text('.offd-resp')) && /återkom till hösten/.test(await s.text('.offd-resp')), 'nekande med kundens kommentar visas');
      await s.go('pg-offer-detail', { offerId: 'OFF-206' }); await s.settle(250);
      t.assert(/Kunden vill ha ändringar/.test(await s.text('.offd-resp')) && /fönsterputs/.test(await s.text('.offd-resp')), 'ändringsbegäran visas');
      t.assert(/Ersätter OFF-205/.test(await s.text('.offd-meta')) && /Version 2/.test(await s.text('.offd-head')), 'version och föregående offert visas');
      // 5. Utgången: Förnya skapar en kopia i utkast
      await s.go('pg-offer-detail', { offerId: 'OFF-207' }); await s.settle(250);
      const before = t.fake.get('offers').length;
      await s.page.locator('.offd-actions > .btn.bp', { hasText: 'Förnya offert' }).click();
      await s.waitToast(/Kopia OFF-\d+ skapad/, 6000);
      t.assert(t.fake.get('offers').length === before + 1 && t.fake.get('offers').some((o) => o.status === 'utkast' && /\(kopia\)/.test(o.title || '')), 'förnyad offert skapad som utkast');
    },
  },
  {
    id: 'OFFD-04', module: 'Säkerhet',
    name: 'Offerter: HTML i titel, beskrivningar, rader, tillval, villkor, intern anteckning, kundsvar och bilagenamn körs aldrig (detalj, guidens fyra steg, granskning) och visas som text',
    async run(t) {
      const F = require('./32_offers.js').fixtures;
      F.seedFixtures(t.fake);
      const P = (f) => `<img src=x onerror="(window.__xss=window.__xss||[]).push('${f}')">"'><svg onload="(window.__xss=window.__xss||[]).push('${f}+')">`;
      const offers = t.fake.get('offers');
      const o = F.richOffer('OFF-299', 'ändring-begärd', {
        title: 'Titel ' + P('title'), summary: P('summary'), scope: P('scope'), includes: P('includes'), excludes: P('excludes'),
        paymentTerms: P('payment'), validityText: P('validity'), generalTerms: P('terms'), internalNote: P('note'), declineReason: P('decline'), address: P('address'),
        publicToken: 'x'.repeat(40), tokenExpiresAt: new Date(Date.now() + 864e5 * 9).toISOString(),
        timeline: [{ ts: new Date().toISOString(), type: 'comment', text: P('timeline'), user: P('user') }],
      });
      o.lines = o.lines.map((l, i) => Object.assign({}, l, { description: P('line' + i), blockTitle: l.blockTitle ? P('bt' + i) : undefined, text: l.text ? P('tx' + i) : undefined, templateName: l.templateName ? P('tpl') : undefined, unit: l.unit ? 'st' : l.unit, calculationNote: l.calculationNote ? P('calc') : undefined, subLines: l.subLines ? [{ desc: P('sub'), qty: 1, unit: 'st', price: 10 }] : undefined }));
      o.extras = o.extras.map((e, i) => Object.assign({}, e, { description: P('extra' + i) }));
      offers.push(o);
      t.fake.set('offers', offers);
      t.fake.set('offerEvents', t.fake.get('offerEvents').concat([{ id: 'OE-X', offerId: 'OFF-299', type: 'change_requested', ts: new Date().toISOString(), byCustomer: P('byCustomer'), byEmail: 'a@example.test', comment: P('comment') }]));
      t.fake.set('offerAttachments', t.fake.get('offerAttachments').concat([{ id: 'ATT-X', offerId: 'OFF-299', displayName: P('att'), originalFileName: 'a.' + P('ext'), mimeType: 'application/pdf', sizeBytes: 1000, active: true, sortOrder: 0 }]));
      const s = await t.world.session({ viewport: 'laptop' });
      let dialogs = 0; s.page.on('dialog', (d) => { dialogs++; d.dismiss().catch(() => {}); });
      await s.login('admin');
      await s.eval(() => { window.__xss = []; });
      await s.go('pg-offer-detail', { offerId: 'OFF-299' }); await s.settle(400);
      for (const key of ['attachments', 'salesAssistant', 'timeline']) {
        const has = await s.eval((k) => !!document.querySelector('.offd-ch-toggle[onclick*="' + k + '"]'), key);
        if (has) { await s.page.click('.offd-ch-toggle[onclick*="' + key + '"]'); await s.settle(200); }
      }
      await s.page.click('#offd-more-btn'); await s.settle(150); await s.page.keyboard.press('Escape');
      t.assert(/Titel <img src=x/.test(await s.text('.offd-title')), 'titeln visas som text');
      await s.eval(() => OffersPage.openEdit('OFF-299')); await s.settle(300);
      for (const n of [2, 3, 4]) { await s.eval((k) => OffersPage._goStep(k), n); await s.settle(300); }
      await s.eval(() => OffersPage._goStep(1)); await s.settle(200);
      const got = await s.eval(() => window.__xss || []);
      t.assert(got.length === 0 && dialogs === 0, 'inget skript kördes: ' + [...new Set(got)].join(', '));
    },
  },
  {
    id: 'OFFD-05', module: 'Offertmodulen',
    name: 'Offertdetalj och guidens steg utan sidscroll eller klippta knappar på 360, 390, 768, 1024, 1366 och 1920 px; ingen betrodd markup som text i någon status',
    async run(t) {
      const F = require('./32_offers.js').fixtures;
      F.seedFixtures(t.fake);
      const hits = [];
      for (const vp of ['android', 'iphone', 'w768', 'w1024', 'laptop', 'desktop']) {
        const s = await t.world.session({ viewport: vp });
        await s.login('admin');
        for (const id of ['OFF-201', 'OFF-202', 'OFF-203', 'OFF-205', 'OFF-206', 'OFF-207', 'OFF-208']) {
          await s.go('pg-offer-detail', { offerId: id }); await s.settle(200);
          const r = await overflow(s);
          if (r.length) hits.push(vp + ' ' + id + ': ' + r.join('; '));
          if (vp === 'iphone' || vp === 'laptop') { const m = await visibleMarkup(s); if (m.length) hits.push(vp + ' ' + id + ' markup: ' + m.join(' | ')); }
        }
        await s.eval((id) => OffersPage.openEdit(id), 'OFF-202'); await s.settle(300);
        for (const n of [1, 2, 3, 4]) {
          await s.eval((k) => OffersPage._goStep(k), n); await s.settle(250);
          const r = await overflow(s);
          if (r.length) hits.push(vp + ' guide steg ' + n + ': ' + r.join('; '));
          if (vp === 'iphone' || vp === 'laptop') { const m = await visibleMarkup(s); if (m.length) hits.push(vp + ' guide steg ' + n + ' markup: ' + m.join(' | ')); }
        }
        await s.eval(() => OffersPage._wizardClose());
        await s.context.close();
      }
      t.assert(hits.length === 0, hits.join(' ;; '));
    },
  },
  {
    id: 'OFFW-03', module: 'Offertmodulen',
    name: 'Offertguiden: utkast återställs i rätt steg (även steg 4), granskningen varnar för RUT/ROT på BRF-kund och kund utan e-post, och sparknappen visar "Sparar…" tills servern svarat',
    async run(t) {
      const cus = t.fake.get('customers'); cus.find((c) => c.id === 'K-005').email = ''; t.fake.set('customers', cus);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openWizard(s);
      await s.page.fill('#off-title', 'Utkast E2E');
      await pickCustomer(s, 'K-001');
      await s.page.locator('button:visible', { hasText: /Nästa: Tjänster/ }).click();
      await addService(s, 'rut');
      await s.page.locator('button:visible', { hasText: /Nästa: Villkor/ }).click();
      await s.page.locator('button:visible', { hasText: /Nästa: Granska/ }).click();
      const rv = await s.eval(() => document.querySelector('.offw-issues') ? document.querySelector('.offw-issues').innerText : '');
      t.assert(/RUT\/ROT-avdrag men kunden är registrerad som BRF/.test(rv), 'varning: RUT/ROT på BRF (' + rv.slice(0, 120) + ')');
      // Stäng och behåll utkast → öppna igen: återställ i steg 4
      await s.page.locator('.off-wiz-hdr-close--desktop').click();
      await s.clickModalButton(/Stäng och behåll utkast/);
      await s.settle(300);
      await s.page.locator('.page.active button', { hasText: 'Ny offert' }).first().click(); await s.settle(300);
      t.assert(await s.modalOpen(), 'frågan om att återställa utkastet visas');
      await s.clickModalButton(/Återställ|Fortsätt/);
      await s.settle(400);
      t.assert(await s.eval(() => OffersPage._wizardStep) === 4 && (await s.eval(() => OffersPage._editLines.length)) === 1, 'utkastet återställt i steg 4 med raden kvar');
      // Kund utan e-post
      t.assert(await s.eval(() => !(getCu('K-005') || {}).email), 'förutsättning: kunden K-005 saknar e-post');
      await s.page.locator('.offw-steps--hdr .offw-step', { hasText: 'Kund & uppdrag' }).click(); await s.settle(200);
      await pickCustomer(s, 'K-005');
      await s.page.locator('.offw-steps--hdr .offw-step', { hasText: 'Granska & spara' }).click(); await s.settle(300);
      t.assert(/Kunden saknar e-postadress/.test(await s.text('.offw-issues')), 'varning: kund utan e-post');
      // "Sparar…" medan servern svarar
      t.fake.addFault({ match: /store-key-write/, mode: 'delay', ms: 1500, times: 1 });
      await s.page.locator('button:visible', { hasText: /Spara offert/ }).click();
      await s.settle(250);
      const busy = await s.eval(() => { const b = document.getElementById('offw-save-btn'); return b ? { t: b.textContent.trim(), d: b.disabled } : null; });
      t.note('under sparning: ' + JSON.stringify(busy));
      await s.waitToast(/skapad/i, 10000);
      t.assert(!!busy && /Sparar…/.test(busy.t) && busy.d, 'knappen visar "Sparar…" och är inaktiv under sparningen (' + JSON.stringify(busy) + ')');
      t.assert(t.fake.get('offers').some((o) => o.title === 'Utkast E2E' && o.customerId === 'K-005'), 'sparad');
    },
  },
];
module.exports.fixtures = { richOffer, richLines, richExtras, fixtureOffers, fixtureEvents, fixtureAttachments, seedFixtures, LONG_TERMS };
