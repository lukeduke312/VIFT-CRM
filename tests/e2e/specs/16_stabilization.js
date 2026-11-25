'use strict';
/* Etapp A (2026-11-23): döda dialogknappar, bilagornas metadata, G12-sparvägar. */

function seedAttachment(fake) {
  const list = fake.get('offerAttachments') || [];
  list.push({ id: 'ATT-E2E-1', offerId: 'OFF-001', originalFileName: 'ritning.pdf', displayName: 'Ritning', description: '', mimeType: 'application/pdf', sizeBytes: 1000, includeInPublicView: true, includeInCombinedPdf: false, active: true, uploadedAt: new Date().toISOString() });
  fake.set('offerAttachments', list);
}

module.exports = [
  {
    id: 'MODAL-01', module: 'Inställningar och administration', name: 'Dialoger som använder okLabel/ok har en Spara-knapp: nytt avtal och ny e-postmall kan skapas och sparas på servern',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-contracts');
      await s.page.locator('.page.active button', { hasText: 'Nytt avtal' }).click();
      await s.page.waitForSelector('.modal-overlay.open #co-title');
      const btns = await s.page.locator('.modal-overlay.open .modal-footer button').allTextContents();
      t.assert(btns.some((b) => /Skapa avtal/.test(b)), 'avtalsdialogen har knappen "Skapa avtal" (fanns: ' + btns.join('|') + ')');
      await s.page.fill('#co-title', 'Serviceavtal E2E');
      await s.clickModalButton(/Skapa avtal/);
      await s.waitToast(/Avtal skapat/, 6000);
      await s.settle(800);
      t.assert((t.fake.get('contracts') || []).some((c) => c.title === 'Serviceavtal E2E'), 'avtalet på servern');
      await s.go('pg-admin');
      await s.eval(() => { AdminPage._tab = 'epost'; AdminPage.render(); });
      await s.eval(() => AdminPage.openEditEmailTemplate(null));
      await s.page.waitForSelector('.modal-overlay.open #et-name');
      await s.page.fill('#et-name', 'E2E-mall');
      await s.page.fill('#et-subj', 'Hej {{firstName}}');
      await s.page.fill('#et-body', 'Text');
      await s.clickModalButton(/Skapa mall/);
      await s.waitToast(/Mall skapad/, 6000);
      await s.settle(800);
      t.assert((t.fake.get('emailTemplates') || []).some((x) => x.name === 'E2E-mall'), 'e-postmallen på servern');
    },
  },
  {
    id: 'ATT-01', module: 'Offertmodulen', name: 'Redigera offertbilaga: med serverstöd sparas "synlig i kundvy" på servern; utan (driftsatt EF i dag) tydligt fel och ingen lokal ändring',
    async run(t) {
      seedAttachment(t.fake);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-offer-detail', { offerId: 'OFF-001' });
      const edit = async () => {
        await s.eval(() => OfferDetailPage._editAttachment('ATT-E2E-1', 'OFF-001'));
        await s.page.waitForSelector('.modal-overlay.open #att-edit-pub');
        await s.page.uncheck('#att-edit-pub');
        await s.clickModalButton(/Spara/);
      };
      await edit();
      await s.waitToast(/kunde inte sparas/, 6000);
      t.assert(t.fake.get('offerAttachments').find((a) => a.id === 'ATT-E2E-1').includeInPublicView === true, 'servern oförändrad');
      t.assert(await s.eval(() => state.offerAttachments.find((a) => a.id === 'ATT-E2E-1').includeInPublicView === true), 'ingen lokal ändring som ser sparad ut');
      t.assert(await s.modalOpen(), 'dialogen ligger kvar efter felet så användaren kan försöka igen eller avbryta');
      await s.clickModalButton(/Avbryt/);
      await s.settle(300);
      t.fake.opts.attachmentPatch = true;
      await s.clearToasts();
      await edit();
      await s.waitToast(/Bilaga uppdaterad/, 6000);
      t.assert(t.fake.get('offerAttachments').find((a) => a.id === 'ATT-E2E-1').includeInPublicView === false, 'dold för kund på servern');
      t.assert(!(await s.modalOpen()), 'dialogen stängd efter bekräftad sparning');
    },
  },
  {
    id: 'G12-01', module: 'Kundregister', name: 'G12: sparvägar som tidigare sa "Sparat" före serverns svar — vid serverfel inget framgångsbesked och lokal återställning; när servern svarar sparas ändringen',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      const cases = [
        { name: 'kontaktperson på kund', ok: /Kontaktperson sparad/, key: 'customers', id: 'K-002',
          act: async () => { await s.go('pg-crm-detail', { customerId: 'K-002' }); await s.eval(() => { CustomerDetailPage.customerId = 'K-002'; }); await s.eval(() => { const m = document.createElement('div'); m.innerHTML = '<input id="cc-name" value="Kontakt E2E"><input id="cc-role"><input id="cc-phone"><input id="cc-email"><input type="checkbox" id="cc-primary">'; document.body.appendChild(m); CustomerDetailPage._saveContact(); m.remove(); }); },
          changed: (srv) => (srv.contacts || []).some((c) => c.name === 'Kontakt E2E') },
        { name: 'anteckning på fastighet', ok: /Anteckning sparad/, key: 'properties', id: 'OBJ-001',
          act: async () => { await s.go('pg-obj-detail', { propId: 'OBJ-001' }); await s.eval(() => { const m = document.createElement('div'); m.innerHTML = '<textarea id="prop-note-text">Not E2E</textarea>'; document.body.appendChild(m); PropertyDetailPage._saveNote(); m.remove(); }); },
          changed: (srv) => (srv.notes || []).some((n) => n.text === 'Not E2E') },
        { name: 'offertstatus', ok: /^Status:/, key: 'offers', id: 'OFF-001',
          act: async () => { await s.go('pg-offer-detail', { offerId: 'OFF-001' }); await s.eval(() => OfferDetailPage.setStatus('väntar')); },
          changed: (srv) => srv.status === 'väntar' },
        { name: 'artikel', ok: /Artikel uppdaterad/, key: 'articles', id: null,
          act: async () => { await s.go('pg-articles'); await s.eval(() => { const a = state.articles[0]; ArticlesPage.openEdit(a.id); }); await s.page.waitForSelector('.modal-overlay.open #art-name'); await s.page.fill('#art-name', 'Artikel E2E'); await s.clickModalButton(/Spara/); },
          changed: (srv) => srv.name === 'Artikel E2E' },
        { name: 'återkommande ärende', ok: /Ärende uppdaterat/, key: 'recurringOrders', id: null,
          act: async () => { await s.go('pg-recurring'); await s.eval(() => RecurringPage._openForm(state.recurringOrders[0].id)); await s.page.waitForSelector('.modal-overlay.open #ro-title'); await s.page.fill('#ro-title', 'Ärende E2E'); await s.clickModalButton(/Spara ändringar/); },
          changed: (srv) => srv.title === 'Ärende E2E' },
      ];
      for (const c of cases) {
        if (c.id === null) c.id = (t.fake.get(c.key) || [])[0].id;
        const srvOf = () => (t.fake.get(c.key) || []).find((x) => x.id === c.id) || {};
        t.fake.addFault({ match: /store-key-write:writeMerge/, mode: 'fail', status: 503, error: 'http_503', times: 100 });
        await s.clearToasts();
        await c.act();
        await s.settle(2500);
        const toasts = await s.toasts();
        t.assert(!toasts.some((m) => c.ok.test(m)), c.name + ': inget framgångsbesked vid serverfel (' + toasts.join(' / ') + ')');
        t.assert(toasts.some((m) => /kunde inte/.test(m)), c.name + ': tydligt fel');
        t.assert(!c.changed(srvOf()), c.name + ': servern oförändrad');
        const local = await s.eval(([k, id]) => (state[k === 'salesOpps' ? 'salesOpportunities' : k] || []).find((x) => String(x.id) === id), [c.key, c.id]);
        t.assert(!c.changed(local || {}), c.name + ': klienten återställd');
        // kasta den osparade ändringen och gör om den med fungerande server
        t.fake.clearFaults();
        await s.eval(() => { (state._vfHeldUnsaved || []).forEach((it) => discardHeldPersist(it.key, it.id)); });
        await s.clearToasts();
        await c.act();
        await s.waitToast(c.ok, 6000);
        await s.settle(600);
        t.assert(c.changed(srvOf()), c.name + ': sparad på servern när den fungerar');
      }
    },
  },
  {
    id: 'ATT-02', module: 'Offertmodulen', name: 'Ta bort offertbilaga: Bekräfta tar faktiskt bort bilagan på servern (await Modal.confirm gav tidigare undefined)',
    async run(t) {
      seedAttachment(t.fake);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-offer-detail', { offerId: 'OFF-001' });
      await s.eval(() => { OfferDetailPage._deleteAttachment('ATT-E2E-1', 'OFF-001'); });
      await s.clickModalButton(/Bekräfta/);
      await s.settle(1200);
      t.assert(t.fake.get('offerAttachments').find((a) => a.id === 'ATT-E2E-1').active === false, 'bilagan borttagen på servern');
    },
  },
  {
    id: 'G10-01', kind: 'workflow', module: 'Fakturering och fakturaunderlag', name: 'G10: godkänd offert med ROT → AO → fakturautkast: varning, "skickad" spärras tills avdraget lagts in (förifyllt från offerten) eller "utan avdrag" bekräftats',
    async run(t) {
      const offers = t.fake.get('offers');
      offers.push({ id: 'OFF-ROT', title: 'Badrum ROT E2E', customerId: 'K-003', status: 'godkänd', lines: [{ id: 'L1', type: 'fixed', description: 'Arbete badrum', qty: 1, unitPrice: 10000, vatRate: 25, reductionType: 'rot', reductionBaseExVat: 10000, rutAmount: 3750, billingType: 'onetime' }], extras: [], discount: { type: 'percent', value: 0 }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), timeline: [] });
      t.fake.set('offers', offers);
      const aos = t.fake.get('workOrders');
      aos.push({ id: 'AO-ROT', title: 'Badrum ROT E2E', customerId: 'K-003', offerId: 'OFF-ROT', priceType: 'fastpris', fixedPrice: 10000, status: 'klar', staff: [], log: [], materials: [], checklist: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      t.fake.set('workOrders', aos);
      const e = await t.world.session({ viewport: 'desktop' });
      await e.login('admin');
      await e.go('pg-invoices');
      await e.eval(() => InvoicesPage._setView && InvoicesPage._setView('queue'));
      await e.settle(400);
      const cands = await e.eval(() => BillingQueueService.getCandidates().filter((c) => c.workOrderId === 'AO-ROT').map((c) => c.id));
      t.assert(cands.length >= 1, 'AO:n finns i faktureringskön');
      // V3 6A: kön är ihopfälld som standard — fäll ut alla rader och kryssa underlagen som en användare.
      await e.page.locator('#bq-expand-all').click(); await e.settle(300);
      for (const c of cands) await e.page.locator('#bq-list input._sel-cb[data-sel-id="' + c + '"]').check();
      await e.eval((ids) => InvoicesPage._openCreateConfirm(ids), cands);
      await e.clickModalButton(/Skapa fakturautkast/);
      await e.settle(1500);
      const inv = t.fake.get('invoices').find((i) => (i.lines || []).some((l) => (l.sourceRefs || []).some((r) => r.workOrderId === 'AO-ROT')));
      t.assert(inv, 'fakturautkast skapat');
      await e.go('pg-inv-detail', { invoiceId: inv.id });
      t.assert(/Offerten angav ROT-avdrag/.test(await e.text('.page.active')), 'varning om offertens ROT visas');
      const blocked = await e.eval((id) => InvoiceService.setStatus(id, 'skickad'), inv.id);
      t.assert(blocked.ok === false && blocked.code === 'tax_reduction_review', 'skickad spärras: ' + JSON.stringify(blocked).slice(0, 160));
      await e.page.locator('.page.active button', { hasText: 'Lägg till avdrag från offerten' }).click();
      await e.page.waitForSelector('.modal-overlay.open #tr-type');
      const pre = await e.eval(() => ({ type: document.getElementById('tr-type').value, amount: Number(document.getElementById('tr-amount').value) }));
      t.assert(pre.type === 'rot' && pre.amount === 3750, 'förifyllt från offerten: ' + JSON.stringify(pre));
      await e.clickModalButton(/^Spara$/);
      await e.settle(1200);
      const srv = t.fake.get('invoices').find((i) => i.id === inv.id);
      t.assert(srv.taxReduction && srv.taxReduction.type === 'rot' && Number(srv.taxReduction.amount) === 3750, 'ROT på servern');
      const ok = await e.eval((id) => InvoiceService.setStatus(id, 'skickad'), inv.id);
      t.assert(ok.ok === true, 'nu kan fakturan markeras skickad: ' + JSON.stringify(ok).slice(0, 120));
      const sum = await e.eval((id) => InvoiceService.calcSummary(getInv(id)), inv.id);
      t.assert(sum.customerPays === 12500 - 3750, 'kunden betalar samma som offerten (8 750 kr): ' + sum.customerPays);
    },
  },
  {
    id: 'G8-01', module: 'Offertmodulen', name: 'G8: RUT-avdrag större än totalen (efter rabatt) — offerten kan inte sparas; kundsidan visar inget negativt belopp och tillåter inte godkännande',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-offer');
      await s.page.locator('.page.active button', { hasText: 'Ny offert' }).first().click();
      await s.page.waitForSelector('#off-title', { state: 'visible' });
      await s.page.fill('#off-title', 'RUT-fel E2E');
      await s.eval(() => { const e = document.getElementById('off-cu'); e.value = 'K-003'; e.dispatchEvent(new Event('change', { bubbles: true })); });
      await s.page.locator('button:visible', { hasText: /Nästa: Tjänster/ }).click();
      await s.page.locator('button:visible', { hasText: /Löpande rad/ }).click();
      await s.page.locator('#off-lines .off-wiz-line-field-desc').nth(0).fill('Städning');
      const p = s.page.locator('#off-lines .off-money-input').nth(0); await p.fill('10000'); await p.dispatchEvent('change');
      await s.eval(() => { const l = OffersPage._editLines[0]; l.reductionType = 'rut'; l.reductionBaseExVat = 10000; l.rutAmount = OffersPage._calcLineRutAmount(l); OffersPage._discount = { type: 'percent', value: 70 }; OffersPage._refreshTotals(); });
      await s.page.locator('button:visible', { hasText: /Nästa: Villkor/ }).click();
      await s.page.locator('button:visible', { hasText: /Nästa: Granska/ }).click(); // QA 2026-11-26: granskningssteg före Spara
      await s.page.locator('button:visible', { hasText: /Spara offert/ }).click();
      await s.settle(1200);
      t.assert((await s.toasts()).some((m) => /RUT\/ROT-avdraget .* större än/.test(m)), 'tydligt besked');
      t.assert(!t.fake.get('offers').some((o) => o.title === 'RUT-fel E2E'), 'ingen offert sparad');
      // Äldre offert med samma fel på kundsidan
      const offers = t.fake.get('offers');
      offers.push({ id: 'OFF-NEG', title: 'Negativ E2E', customerId: 'K-003', status: 'skickad', publicToken: 'neg'.repeat(12), tokenExpiresAt: new Date(Date.now() + 86400000 * 10).toISOString(), lockedSnapshotJSON: '', lines: [{ id: 'L1', type: 'fixed', description: 'Städning', qty: 1, unitPrice: 10000, vatRate: 25, reductionType: 'rut', reductionBaseExVat: 10000, rutAmount: 6250, billingType: 'onetime' }], extras: [], discount: { type: 'percent', value: 70 } });
      t.fake.set('offers', offers);
      const c = await t.world.session({ viewport: 'iphone' });
      await c.page.goto(require('../lib').baseUrl + '/public-offer.html?t=' + 'neg'.repeat(12), { waitUntil: 'load' });
      await c.settle(2000);
      const txt = await c.eval(() => document.body.innerText);
      t.assert(!/−\s?\d[\d\s]*\s?kr\s*$/m.test(txt.split('Totalt att betala')[1] || '') && !/Totalt att betala\s*\n?\s*-/.test(txt), 'inget negativt att betala');
      t.assert(/behöver kontrolleras/.test(txt) && !/Godkänn offert/.test(txt), 'varning och ingen Godkänn-knapp');
    },
  },
];
