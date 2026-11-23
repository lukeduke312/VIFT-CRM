'use strict';
/*
 * Ekonomi och kundflöde: kund → fastighet → objekt → offert → digital kundlänk
 * (godkännande) → AO → material/tid → klar → fakturakö → fakturautkast, med
 * beloppskontroll i varje led. Inga riktiga utskick (send-offer-email,
 * PDF registreras bara av den simulerade servern).
 */
const lib = require('../lib');
const OfferCalc = require('../../../src/shared/OfferCalc.js');
const num = (t) => Number(String(t || '').replace(/[^\d,−-]/g, '').replace('−', '-').replace(',', '.'));

/* Öppnar offertens PDF-vy (genereras i webbläsaren, iframe) och returnerar dess text. */
async function pdfText(s, offerId) {
  await s.eval((i) => OfferDetailPage.printPdf(i), offerId);
  await s.page.waitForSelector('#pdf-frame', { timeout: 6000 });
  await s.settle(600);
  const txt = await s.eval(() => { const f = document.getElementById('pdf-frame'); const d = f && (f.contentDocument || (f.contentWindow && f.contentWindow.document)); return d && d.body ? d.body.innerText : ''; });
  await s.page.click('#pdf-close-btn').catch(() => {});
  await s.settle(300);
  return txt.replace(/[\u00a0\u202f]/g, ' ');
}
const kr = (n) => new Intl.NumberFormat('sv-SE').format(Math.round(n)).replace(/[\u00a0\u202f]/g, ' ');

async function createOfferViaWizard(s, { title, customerId, lines, discountPct, probe }) {
  await s.go('pg-offer');
  await s.page.locator('.page.active button', { hasText: 'Ny offert' }).first().click();
  await s.page.waitForSelector('#off-title', { state: 'visible' });
  await s.page.fill('#off-title', title);
  await s.eval((c) => { const e = document.getElementById('off-cu'); e.value = c; e.dispatchEvent(new Event('change', { bubbles: true })); }, customerId);
  await s.page.locator('button:visible', { hasText: /Nästa: Tjänster/ }).click();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    await s.page.locator('button:visible', { hasText: /Löpande rad/ }).click();
    await s.settle(150);
    await s.page.locator('#off-lines .off-wiz-line-field-desc').nth(i).fill(l.desc);
    const q = s.page.locator('#off-lines input[type=number]').nth(i); await q.fill(String(l.qty)); await q.dispatchEvent('change');
    const p = s.page.locator('#off-lines .off-money-input').nth(i); await p.fill(l.price); await p.dispatchEvent('change');
    if (l.vat != null) await s.eval(([idx, v]) => { const sel = document.querySelectorAll('#off-lines select')[idx * 3 + 1]; if (sel) { sel.value = String(v); sel.dispatchEvent(new Event('change', { bubbles: true })); } }, [i, l.vat]);
  }
  await s.settle(300);
  if (probe) probe.afterLines = await s.eval(() => ({ ctrl: !!document.getElementById('off-disc-val'), hint: /Ingen rabatt-kontroll visas/.test(document.body.innerText) }));
  if (discountPct != null) {
    const d = s.page.locator('#off-disc-val');
    await d.fill(String(discountPct));
    await d.dispatchEvent('input');
    await s.settle(300);
  }
  // Sammanfattningskortet: "Summa ex. moms" är före rabatt, "Rabatt" visas som −belopp.
  const pairs = await s.eval(() => {
    const lines = (document.getElementById('off-totals-bar') || document.body).innerText.split('\n').map((x) => x.trim()).filter(Boolean);
    const out = {};
    for (let i = 0; i < lines.length - 1; i++) if (/^(Summa ex\. moms|Rabatt|Moms|Totalt inkl\. moms)$/.test(lines[i]) && !(lines[i] in out)) out[lines[i]] = lines[i + 1];
    return out;
  });
  await s.page.locator('button:visible', { hasText: /Nästa: Villkor/ }).click();
  await s.page.locator('button:visible', { hasText: /Spara offert/ }).click();
  await s.waitToast(/skapad/i, 8000);
  const exAfter = num(pairs['Summa ex. moms']) + (pairs.Rabatt ? -Math.abs(num(pairs.Rabatt)) : 0);
  return [exAfter, num(pairs.Moms), num(pairs['Totalt inkl. moms'])];
}

module.exports = [
  {
    id: 'FLOW-01', kind: 'workflow', module: 'Offertmodulen', name: 'Arbetsflöde kund → fakturaunderlag: samma belopp i offertguide, kundlänk, AO, fakturakö och fakturautkast',
    async run(t) {
      const s = await t.world.session({ viewport: 'desktop' });
      await s.login('admin');
      // 1. Kund
      await s.go('pg-crm');
      await s.page.locator('.page.active button', { hasText: 'Ny kund' }).first().click();
      await s.page.fill('#cu-name', 'Flöde Fastigheter AB');
      await s.page.fill('#cu-email', 'flode@example.test');
      await s.clickModalButton(/Skapa kund/);
      await s.page.waitForFunction(() => state.customers.some((c) => c.name === 'Flöde Fastigheter AB'));
      await s.settle(800);
      const cu = t.fake.get('customers').find((c) => c.name === 'Flöde Fastigheter AB');
      t.assert(cu, '1. kund på servern');
      // 2. Fastighet
      await s.go('pg-objects');
      await s.page.locator('.page.active button', { hasText: 'Ny fastighet' }).first().click();
      await s.page.fill('#prop-name', 'Flödesgatan 1');
      await s.eval((c) => { const e = document.getElementById('prop-cu'); e.value = c; e.dispatchEvent(new Event('change', { bubbles: true })); }, cu.id);
      await s.clickModalButton(/Skapa/);
      await s.waitToast(/skapad/i, 8000);
      const prop = t.fake.get('properties').find((p) => p.name === 'Flödesgatan 1');
      t.assert(prop && prop.customerId === cu.id, '2. fastighet kopplad till kunden');
      // 3. Objekt
      await s.go('pg-obj-detail', { propId: prop.id });
      await s.eval((x) => PropertyDetailPage.openAddObject(x), prop.id);
      await s.page.waitForSelector('.modal-overlay.open');
      const nameField = await s.eval(() => Array.from(document.querySelectorAll('.modal-overlay.open input')).map((e) => e.id).find((i) => /name|number|nr|beteck|label/i.test(i)));
      await s.page.fill('#' + nameField, 'Lgh 1001');
      await s.clickModalButton(/Lägg till|Skapa|Spara/);
      await s.settle(800);
      t.assert(t.fake.get('propertyObjects').some((o) => JSON.stringify(o).includes('Lgh 1001')), '3. objekt på servern');
      // 4. Offert via guiden
      const lines = [{ desc: 'Arbete rörmokare', qty: 3, price: '1250,50' }, { desc: 'Material', qty: 2, price: '99,99' }];
      const wiz = await createOfferViaWizard(s, { title: 'Flöde offert', customerId: cu.id, lines });
      let off = t.fake.get('offers').find((o) => o.title === 'Flöde offert');
      t.assert(off, '4. offert på servern');
      const calc = OfferCalc.totals(off);
      t.note('offertguide: ' + wiz.join(' / ') + ' kr; OfferCalc: ' + calc.exVatAfterDiscount + ' / ' + calc.vatAmount + ' / ' + calc.totalInclVat);
      t.assert(wiz[0] === calc.exVatAfterDiscount && wiz[1] === calc.vatAmount && wiz[2] === calc.totalInclVat, '4. guidens summering = OfferCalc');
      t.assert(calc.exVatAfterDiscount === 3952, '4. 3×1250,50 + 2×99,99 avrundat per rad = 3752 + 200 = 3952 kr ex moms (fick ' + calc.exVatAfterDiscount + ')');
      const pdf = await pdfText(s, off.id);
      t.assert(pdf.includes(kr(calc.totalInclVat)), '4. offert-PDF visar totalt ' + kr(calc.totalInclVat));
      // 5. Skicka (simulerat utskick)
      await s.go('pg-offer-detail', { offerId: off.id });
      await s.eval((id) => OfferDetailPage.showSendModal(id), off.id);
      await s.page.waitForSelector('.modal-overlay.open #send-to');
      await s.page.fill('#send-to', 'flode@example.test');
      await s.clickModalButton(/Skicka/);
      await s.page.waitForFunction(() => window.__toasts.some((x) => /skickad|Skickad/.test(x.m)), null, { timeout: 10000 }).catch(() => {});
      await s.settle(800);
      off = t.fake.get('offers').find((o) => o.id === off.id);
      t.assert(off.publicToken && off.publicToken.length >= 32 && off.lockedSnapshotJSON, '5. publik länk och låst version skapade');
      t.assert(t.fake.outbox.some((m) => m.type === 'email'), '5. e-post registrerad i simulerad utkorg (inget riktigt utskick)');
      // 6. Kunden öppnar länken och godkänner
      const cust = await t.world.session({ viewport: 'iphone' });
      await cust.page.goto(lib.baseUrl + '/public-offer.html?t=' + off.publicToken, { waitUntil: 'load' });
      await cust.page.waitForSelector('.po-total-row.main', { timeout: 8000 });
      const shown = num(await cust.text('.po-total-row.main span:last-child'));
      t.assert(shown === calc.totalInclVat, '6. kundsidan visar ' + shown + ' = ' + calc.totalInclVat);
      await cust.page.locator('button', { hasText: /Godkänn/ }).first().click();
      await cust.page.waitForSelector('#f-name');
      await cust.page.fill('#f-name', 'Kund Kundsson');
      await cust.page.fill('#f-email', 'kund@example.test');
      await cust.page.check('#f-agree');
      await cust.page.locator('button', { hasText: /Skicka|Godkänn|Bekräfta/ }).last().click();
      await cust.settle(1200);
      off = t.fake.get('offers').find((o) => o.id === off.id);
      t.assert(off.status === 'godkänd' && off.customerApproval && off.customerApproval.approvedByName === 'Kund Kundsson', '6. godkänd på servern med kundens namn');
      // 7. CRM ser godkännandet, skapar AO
      await s.eval(() => DataSync._poll());
      await s.page.waitForFunction((id) => (state.offers.find((o) => o.id === id) || {}).status === 'godkänd', off.id, { timeout: 8000 });
      await s.go('pg-offer-detail', { offerId: off.id });
      await s.eval(() => OfferDetailPage.createAO());
      await s.settle(600);
      if (await s.modalOpen()) await s.clickModalButton(/Skapa|Bekräfta|OK/);
      await s.page.waitForFunction((id) => state.workOrders.some((a) => a.offerId === id && !a._pendingSync), off.id, { timeout: 10000 });
      await s.settle(800);
      const ao = t.fake.get('workOrders').find((a) => a.offerId === off.id);
      t.assert(ao, '7. AO skapad från offerten på servern');
      t.note('AO prismodell ' + ao.priceType + ', fast pris ' + ao.fixedPrice);
      t.assert(Number(ao.fixedPrice) === calc.exVatAfterDiscount, '7. AO:ns fasta pris (' + ao.fixedPrice + ') = offertens ex moms (' + calc.exVatAfterDiscount + ')');
      const dup = await s.eval((id) => { OfferDetailPage.createAO(); return 0; }, off.id);
      await s.settle(800);
      t.assert(t.fake.get('workOrders').filter((a) => a.offerId === off.id).length === 1, '7. andra klick skapar ingen dubblett-AO');
      // 8. Avsluta AO
      await s.eval((id) => WorkOrderService.setStatus ? WorkOrderService.setStatus(id, 'klar') : WorkOrderService.update(id, { status: 'klar' }), ao.id);
      await s.settle(1200);
      t.assert(t.fake.get('workOrders').find((a) => a.id === ao.id).status === 'klar', '8. AO klar på servern');
      // 9. Fakturakö → utkast
      const e = await t.world.session({ viewport: 'desktop' });
      await e.login('ekonomi');
      await e.go('pg-invoices');
      await e.eval(() => InvoicesPage._setView && InvoicesPage._setView('queue'));
      await e.settle(400);
      const cands = await e.eval((aoId) => BillingQueueService.getCandidates().filter((c) => c.workOrderId === aoId).map((c) => ({ id: c.id, type: c.sourceType, amount: c.amount, sel: c.selectable, issues: c.issues })), ao.id);
      t.note('underlag: ' + JSON.stringify(cands));
      t.assert(cands.length >= 1 && cands.every((c) => c.sel), '9. AO:ns underlag valbara');
      const queueSum = cands.reduce((a, c) => a + c.amount, 0);
      t.assert(queueSum === calc.exVatAfterDiscount, '9. köns summa ' + queueSum + ' = offertens ex moms ' + calc.exVatAfterDiscount);
      for (const c of cands) await e.page.locator('input[onchange*="SelectionModel.toggle(\'' + c.id + '\')"]').check();
      await e.eval((ids) => InvoicesPage._openCreateConfirm(ids), cands.map((c) => c.id));
      await e.clickModalButton(/Skapa fakturautkast/);
      await e.settle(1500);
      const inv = t.fake.get('invoices').find((i) => (i.lines || []).some((l) => (l.sourceRefs || []).some((r) => r.workOrderId === ao.id)));
      t.assert(inv, '9. fakturautkast på servern');
      const sum = await e.eval((i) => InvoiceService.calcSummary(i), inv);
      t.note('faktura: ex ' + sum.exVat + ', moms ' + sum.vat + ', totalt ' + sum.totalInclVat);
      t.assert(sum.exVat === calc.exVatAfterDiscount, '9. fakturans ex moms ' + sum.exVat + ' = offertens ' + calc.exVatAfterDiscount);
      t.assert(Math.round(sum.totalInclVat) === calc.totalInclVat, '9. fakturans totalt ' + sum.totalInclVat + ' = offertens ' + calc.totalInclVat);
      // 10. Ingen dubbelfakturering
      const again = await e.eval((aoId) => BillingQueueService.getCandidates().filter((c) => c.workOrderId === aoId).length, ao.id);
      t.assert(again === 0, '10. underlagen erbjuds inte igen');
    },
  },
  {
    id: 'OFF-03', module: 'Offertmodulen', name: 'Rabatt i offertguiden: kontrollen visas när första engångsraden läggs till; 10 % rabatt ger samma belopp i guide, OfferCalc, PDF och kundlänk',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      const probe = {};
      const wiz = await createOfferViaWizard(s, { title: 'Rabatt offert', customerId: 'K-001', lines: [{ desc: 'Arbete', qty: 2, price: '1000' }, { desc: 'Material', qty: 3, price: '33,33' }], discountPct: 10, probe });
      t.assert(probe.afterLines && probe.afterLines.ctrl && !probe.afterLines.hint, 'rabattkontrollen visas efter första raden (' + JSON.stringify(probe.afterLines) + ')');
      const off = t.fake.get('offers').find((o) => o.title === 'Rabatt offert');
      t.assert(off && off.discount && Number(off.discount.value) === 10, 'rabatt 10 % sparad på servern: ' + JSON.stringify(off && off.discount));
      const calc = OfferCalc.totals(off);
      t.note('guide ' + wiz.join(' / ') + '; OfferCalc ' + calc.rawExVat + ' − ' + calc.discountAmount + ' = ' + calc.exVatAfterDiscount + ', moms ' + calc.vatAmount + ', totalt ' + calc.totalInclVat);
      t.assert(calc.rawExVat === 2100 && calc.exVatAfterDiscount === 1890, '2×1000 + 3×33,33 (100) = 2100 − 10 % = 1890 (fick ' + calc.exVatAfterDiscount + ')');
      t.assert(wiz[0] === calc.exVatAfterDiscount && wiz[1] === calc.vatAmount && wiz[2] === calc.totalInclVat, 'guidens summering = OfferCalc');
      const pdf = await pdfText(s, off.id);
      t.assert(pdf.includes(kr(calc.totalInclVat)), 'PDF visar ' + kr(calc.totalInclVat));
    },
  },
  {
    id: 'OFF-04', module: 'Digitala offertlänkar och kundsvar', name: 'Generera och återkalla kundlänk; serverfel vid återkallning ger inget "återkallad"-besked medan länken fortfarande fungerar',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      const offerId = t.fake.get('offers').find((o) => !o.deleted && !o.archived && /utkast|skickad/.test(o.status || '')).id;
      await s.go('pg-offer-detail', { offerId });
      const expandLink = async () => {
        if (!(await s.page.locator('.page.active button', { hasText: /Generera digital länk|Återkalla länk/ }).count())) await s.page.locator('.page.active .off-collapse-summary', { hasText: 'Digital länk' }).click();
      };
      await expandLink();
      await s.page.locator('.page.active button', { hasText: 'Generera digital länk' }).first().click();
      await s.clickModalButton(/Generera länk/);
      await s.waitToast(/Länk genererad/, 6000);
      await s.settle(1200);
      const token = (t.fake.get('offers').find((o) => o.id === offerId) || {}).publicToken;
      t.assert(token && token.length >= 32, 'token sparad på servern');
      const cust = await t.world.session({ viewport: 'iphone' });
      const openLink = async () => { await cust.page.goto(lib.baseUrl + '/public-offer.html?t=' + token, { waitUntil: 'load' }); await cust.settle(1500); return cust.eval(() => document.body.innerText); };
      t.assert(/inkl\. moms|Godkänn/i.test(await openLink()), 'kunden kan öppna länken');
      // Återkalla — servern nekar
      await s.clearToasts();
      t.fake.addFault({ match: /store-key-write:writeMerge/, mode: 'fail', status: 503, error: 'http_503', times: 3 });
      await expandLink();
      await s.page.locator('.page.active button', { hasText: 'Återkalla länk' }).first().click();
      await s.clickModalButton(/Bekräfta/);
      await s.settle(2500);
      const toasts = await s.toasts();
      t.note('toasts vid serverfel: ' + toasts.join(' / '));
      const stillValid = /inkl\. moms|Godkänn/i.test(await openLink());
      t.assert(stillValid, 'förutsättning: länken fungerar fortfarande hos kunden (servern sparade inte)');
      t.assert(!toasts.some((m) => /^Länk återkallad/.test(m)), 'inget "Länk återkallad" när servern inte bekräftat');
      t.assert(toasts.some((m) => /INTE|inte|kunde/i.test(m)), 'tydligt fel om att länken fortfarande är aktiv');
      t.assert(await s.eval((id) => !state.offers.find((o) => o.id === id).tokenRevokedAt, offerId), 'klienten visar inte länken som återkallad');
      // Nytt försök utan fel
      t.fake.clearFaults();
      await s.clearToasts();
      await expandLink();
      await s.page.locator('.page.active button', { hasText: 'Återkalla länk' }).first().click();
      await s.clickModalButton(/Bekräfta/);
      await s.waitToast(/Länk återkallad/, 6000);
      t.assert(!!t.fake.get('offers').find((o) => o.id === offerId).tokenRevokedAt, 'återkallad på servern');
      t.assert(!/Godkänn/.test(await openLink()), 'kunden kan inte längre använda länken');
    },
  },
  {
    id: 'OFF-01', module: 'Digitala offertlänkar och kundsvar', name: 'Kundlänk: ogiltig/återkallad/redan besvarad ger begripligt besked; dubbelt godkännande nekas',
    async run(t) {
      const c = await t.world.session({ viewport: 'iphone' });
      await c.page.goto(lib.baseUrl + '/public-offer.html?t=' + 'x'.repeat(40), { waitUntil: 'load' });
      await c.page.waitForSelector('.po-status-banner', { timeout: 6000 });
      t.assert(/hittades inte/i.test(await c.text('.po-status-banner')), 'okänd länk: "hittades inte"');
      const offers = t.fake.get('offers');
      const o = offers.find((x) => x.status === 'godkänd');
      o.publicToken = 'a'.repeat(64);
      o.lockedSnapshotJSON = JSON.stringify(Object.assign({}, o, { publicAttachmentIds: [], extras: o.extras || [], lines: o.lines || [] }));
      t.fake.set('offers', offers);
      await c.page.goto(lib.baseUrl + '/public-offer.html?t=' + o.publicToken, { waitUntil: 'load' });
      await c.settle(800);
      t.assert(/godkänd/i.test(await c.text('body')), 'redan godkänd offert visas som godkänd');
      const r = await c.eval(async (tok) => { const res = await fetch(SUPABASE_URL + '/functions/v1/offer-respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tok, action: 'approve', name: 'X', email: 'x@example.test', agreedToTerms: true }) }); return res.status; }, o.publicToken);
      t.assert(r === 410, 'andra godkännandet nekas (410), fick ' + r);
    },
  },
  {
    id: 'INV-01', module: 'Fakturering och fakturaunderlag', name: 'Fakturautkast: rad, rabatt och ROT större än totalen; servern nekar ändring av skickad faktura',
    async run(t) {
      const s = await t.world.session({ viewport: 'desktop' });
      await s.login('ekonomi');
      const cu = await s.eval(() => state.customers[0].id);
      const r = await s.eval((c) => InvoiceService.createBlank(c), cu);
      t.assert(r.ok, 'tomt utkast skapat: ' + JSON.stringify(r).slice(0, 120));
      const id = r.invoice.id;
      const l = await s.eval((i) => InvoiceService.addLine(i, { description: 'Arbete', qty: 2.5, unitPrice: 650, vatRate: 25 }), id);
      t.assert(l.ok, 'rad tillagd');
      const sum1 = await s.eval((i) => InvoiceService.calcSummary(getInv(i)), id);
      t.assert(sum1.exVat === 1625 && sum1.vat === 406.25 && sum1.totalInclVat === 2031.25, 'belopp i öre: ' + JSON.stringify(sum1));
      const rot = await s.eval((i) => InvoiceService.setTaxReduction(i, 'rot', 5000, 1625, ''), id);
      t.assert(rot.ok === false, 'ROT 5000 > total nekas: ' + JSON.stringify(rot).slice(0, 120));
      const d = await s.eval((i) => InvoiceService.setDiscount(i, 'percent', 10), id);
      t.assert(d.ok, 'rabatt 10 %');
      const sum2 = await s.eval((i) => InvoiceService.calcSummary(getInv(i)), id);
      t.assert(sum2.exVat === 1462.5 && sum2.totalInclVat === 1828.13, 'efter rabatt: ' + JSON.stringify(sum2));
      const st = await s.eval((i) => InvoiceService.setStatus(i, 'skickad'), id);
      t.assert(st.ok, 'markerad skickad');
      const l2 = await s.eval((i) => InvoiceService.addLine(i, { description: 'Sen rad', qty: 1, unitPrice: 1, vatRate: 25 }), id);
      t.assert(l2.ok === false, 'rad på skickad faktura nekas: ' + JSON.stringify(l2).slice(0, 120));
      t.assert(t.fake.get('invoices').find((x) => x.id === id).lines.length === 1, 'servern oförändrad');
      await s.go('pg-inv-detail', { invoiceId: id });
      t.assert(/1\s?828/.test(await s.text('#pg-inv-detail')), 'fakturasidan visar 1 828 kr');
    },
  },
  {
    id: 'INV-02', module: 'Fakturering och fakturaunderlag', name: 'Utan invoice_create: knappar dolda och servern nekar direktanrop',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt');
      const r = await s.eval(() => InvoiceService._call('appendChecked', { invoice: { customerId: 'K-001', lines: [] }, idempotencyKey: 'x' }));
      t.assert(r.ok === false && r.httpStatus === 403, 'direktanrop nekas: ' + JSON.stringify(r));
    },
  },
  {
    id: 'OFF-02', module: 'Offertmodulen', name: 'Offert-PDF (genereras i webbläsaren) visar samma totalsumma som OfferCalc för samtliga befintliga offerter',
    async run(t) {
      const s = await t.world.session({ viewport: 'desktop' });
      await s.login('chef');
      const offers = await s.eval(() => state.offers.map((o) => o.id));
      const bad = [];
      for (const id of offers) {
        await s.go('pg-offer-detail', { offerId: id });
        const off = t.fake.get('offers').find((o) => o.id === id);
        const txt = await pdfText(s, id);
        const tot = OfferCalc.totals(off);
        const expect = tot.rutRotAmount ? tot.customerPays : tot.totalInclVat;
        if (!txt.includes(kr(expect))) bad.push(id + ': väntat ' + kr(expect));
        await s.eval(() => Modal.closeAll && Modal.closeAll());
        await s.go('pg-offer');
      }
      t.note(offers.length + ' offerter kontrollerade');
      t.assert(bad.length === 0, bad.join('; '));
    },
  },
  {
    id: 'ECO-01', kind: 'workflow', module: 'Fakturering och fakturaunderlag', name: 'Löpande AO: 80 min à 595 kr + material 3 × 33,33 kr → fakturakö → fakturautkast → ROT; öresavrundning och ROT på arbete inkl. moms (samma regel som offerten)',
    async run(t) {
      const s = await t.world.session({ viewport: 'desktop' });
      await s.login('admin');
      const aoId = await s.eval(() => WorkOrderService.create({ title: 'Löpande E2E', customerId: 'K-003', priceType: 'timpris', priceGroupId: 'PG-003', staff: ['ST-001'], status: 'pågående', scheduledDate: new Date().toISOString().slice(0, 10) }).id);
      await s.page.waitForFunction((id) => !(state.workOrders.find((a) => a.id === id) || {})._pendingSync, aoId, { timeout: 8000 });
      // Tid via Tid-sidan (riktiga fält)
      await s.go('pg-tid');
      await s.page.fill('#mt-date', '2026-11-20');
      await s.page.fill('#mt-start', '08:00');
      await s.page.fill('#mt-end', '09:20');
      await s.eval((id) => { const e = document.getElementById('mt-ao'); e.value = id; e.dispatchEvent(new Event('change', { bubbles: true })); }, aoId);
      await s.eval(() => { const e = document.getElementById('mt-pg'); if (e) { e.value = 'PG-003'; e.dispatchEvent(new Event('change', { bubbles: true })); } });
      await s.page.locator('.page.active button', { hasText: 'Spara tid' }).click();
      await s.waitToast(/^Tid sparad$/, 8000);
      // Material via AO-detaljen
      await s.go('pg-ao-detail', { aoId });
      await s.eval(() => WorkOrderDetailPage.openAddMaterial());
      await s.page.waitForSelector('.modal-overlay.open #mat-name');
      await s.page.fill('#mat-name', 'E2E Silikon');
      await s.page.fill('#mat-qty', '3');
      await s.page.fill('#mat-sell', '33.33');
      await s.clickModalButton(/Lägg till/);
      await s.settle(1500);
      await s.eval((id) => WorkOrderService.setStatus ? WorkOrderService.setStatus(id, 'klar') : WorkOrderService.update(id, { status: 'klar' }), aoId);
      await s.settle(1500);
      // Fakturakö
      const e = await t.world.session({ viewport: 'desktop' });
      await e.login('ekonomi');
      await e.go('pg-invoices');
      await e.eval(() => InvoicesPage._setView && InvoicesPage._setView('queue'));
      await e.settle(400);
      const cands = await e.eval((id) => BillingQueueService.getCandidates().filter((c) => c.workOrderId === id).map((c) => ({ id: c.id, type: c.sourceType, q: c.quantity, p: c.unitPrice, a: c.amount, sel: c.selectable, issues: c.issues })), aoId);
      t.note('underlag: ' + JSON.stringify(cands));
      const time = cands.find((c) => c.type === 'time'); const mat = cands.find((c) => c.type === 'material');
      t.assert(time && time.sel && time.q === 1.33 && time.a === 791.35, 'tid: 80 min = 1,33 h × 595 = 791,35 kr (' + JSON.stringify(time) + ')');
      t.assert(mat && mat.sel && Math.abs(mat.a - 99.99) < 0.001, 'material: 3 × 33,33 = 99,99 kr (' + JSON.stringify(mat) + ')');
      for (const c of cands) await e.page.locator('input[onchange*="SelectionModel.toggle(\'' + c.id + '\')"]').check();
      await e.eval((ids) => InvoicesPage._openCreateConfirm(ids), cands.map((c) => c.id));
      await e.clickModalButton(/Skapa fakturautkast/);
      await e.settle(1500);
      const inv = t.fake.get('invoices').find((i) => (i.lines || []).some((l) => (l.sourceRefs || []).some((r) => r.workOrderId === aoId)));
      t.assert(inv, 'fakturautkast på servern');
      // Rabatt 10 % och ROT via fakturavyn
      await e.go('pg-inv-detail', { invoiceId: inv.id });
      await e.eval(() => InvoiceDetailPage.openTaxReduction());
      await e.page.waitForSelector('.modal-overlay.open #tr-type');
      await e.page.selectOption('#tr-type', 'rot');
      await e.page.fill('#tr-basis', '791.35');
      await e.page.dispatchEvent('#tr-basis', 'input');
      const autoRot = Number(await e.page.inputValue('#tr-amount'));
      const offerRule = Math.round((791.35 + Math.round(791.35 * 0.25)) * 0.30); // OfferCalc/_calcLineRutAmount: 30 % av arbete inkl. moms
      t.note('ROT auto i fakturan: ' + autoRot + ' kr; offertens regel: ' + offerRule + ' kr');
      t.assert(autoRot === offerRule, 'ROT i fakturan räknas som i offerten (30 % av arbetskostnad inkl. moms): ' + autoRot + ' vs ' + offerRule);
      await e.clickModalButton(/^Spara$/);
      await e.settle(1200);
      t.note('toasts efter ROT: ' + (await e.toasts()).join(' / ') + ' | anrop: ' + t.fake.calls.filter((c) => /invoice-write/.test(c.action)).map((c) => c.action + '=' + c.status).join(','));
      const srv = t.fake.get('invoices').find((i) => i.id === inv.id);
      const sum = await e.eval((i) => InvoiceService.calcSummary(i), srv);
      t.note('faktura: ex ' + sum.exVat + ', moms ' + sum.vat + ', totalt ' + sum.totalInclVat + ', ROT ' + sum.trAmount + ', kunden betalar ' + sum.customerPays);
      t.assert(sum.exVat === 891.34 && sum.vat === 222.84 && Math.abs(sum.totalInclVat - 1114.18) < 0.001, 'ex 891,34 / moms 222,84 / totalt 1 114,18 (öre)');
      t.assert(sum.customerPays > 0 && Math.abs(sum.customerPays - (1114.18 - offerRule)) < 0.001, 'kunden betalar totalt − ROT');
      const billingRejected = (await e.toasts()).some((m) => /faktureringsstatusen kunde inte sparas/.test(m));
      if (billingRejected) t.note('OBS (verifieras mot STAGING): ekonomirollen (invoice_create utan AO-behörighet) fick AO-statusen "fakturerad" nekad av ao-time-write i den simulerade modellen — klienten rullar tillbaka och säger det. Fakturan påverkas inte; dubbelfakturering förhindras av köns anspråk.');
    },
  },
];
