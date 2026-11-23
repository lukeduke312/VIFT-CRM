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
];
