'use strict';
/* Arbetsordrar, checklistor, loggar, bilder, material — riktiga formulär, svar från simulerad server. */

async function createAO(s, title, opts) {
  opts = opts || {};
  await s.go('pg-ao');
  await s.page.locator('.page.active button', { hasText: 'Ny order' }).click();
  await s.page.waitForSelector('.modal-overlay.open #wiz-title');
  await s.page.fill('#wiz-title', title);
  const cu = opts.customerId || await s.eval(() => state.customers[0].id);
  await s.eval((c) => { const e = document.getElementById('wiz-customer'); e.value = c; e.dispatchEvent(new Event('change', { bubbles: true })); }, cu);
  await s.clickModalButton(/Nästa/); await s.settle(200);
  await s.clickModalButton(/Nästa/); await s.settle(200);
  const btn = s.page.locator('.modal-overlay.open .modal-footer button', { hasText: 'Skapa order' });
  if (opts.doubleClick) await btn.dblclick(); else await btn.click();
}

async function openAO(s, id) {
  await s.go('pg-ao-detail', { aoId: id });
  await s.page.waitForFunction((x) => document.getElementById('ao-timeline') && WorkOrderDetailPage.aoId === x, id, { timeout: 8000 });
}

async function addLog(s, text, file) {
  await s.eval(() => WorkOrderDetailPage.openAddLog());
  await s.page.waitForSelector('.modal-overlay.open #log-text');
  await s.page.fill('#log-text', text);
  if (file) await s.page.setInputFiles('#log-img', file);
  await s.clickModalButton(/^Spara$/);
}

/* "Loggpost sparad" får aldrig visas före första lyckade (200) patch_ao
   efter felet, och posten ska finnas exakt en gång på servern. */
async function assertSavedAfterAck(t, s, text) {
  const toastAt = await s.eval(() => (window.__toasts.find((x) => /Loggpost sparad/.test(x.m)) || {}).t);
  const failIdx = t.fake.calls.findIndex((c) => c.action === 'ao-time-write:patch_ao' && c.status !== 200);
  const ack = t.fake.calls.slice(failIdx + 1).find((c) => c.action === 'ao-time-write:patch_ao' && c.status === 200);
  t.assert(ack && toastAt >= ack.t, '"sparad" (' + toastAt + ') efter första bekräftelse (' + (ack && ack.t) + ')');
  const n = (t.fake.get('workOrders').find((a) => a.id === 'AO-007').log || []).filter((l) => l.text === text).length;
  t.assert(n === 1, 'exakt en på servern (' + n + ')');
}

const JPEG = { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64') };

module.exports = [
  {
    id: 'AO-01', module: 'Arbetsordrar', name: 'Ny AO via guiden (3 steg) skapas på servern via ao-time-write och får AO-nummer',
    async run(t) {
      const s = await t.world.session();
      await s.login('chef');
      const t0 = Date.now();
      await createAO(s, 'E2E Läckande kran');
      await s.page.waitForFunction(() => window.__toasts.length > 0, null, { timeout: 8000 });
      await s.page.waitForFunction(() => state.workOrders.some((a) => a.title === 'E2E Läckande kran' && !a._pendingSync), null, { timeout: 10000 });
      t.metric('skapa AO → serverbekräftad (ms)', Date.now() - t0);
      const srv = t.fake.get('workOrders').find((a) => a.title === 'E2E Läckande kran');
      t.assert(srv && srv.displayNumber, 'AO finns på servern med displayNumber');
      t.assert(t.fake.calls.some((c) => c.action === 'ao-time-write:create_ao'), 'skapad via create_ao');
      t.assert(!t.fake.calls.some((c) => /rest\/v1\/store/.test(c.path) && c.method === 'POST'), 'ingen direkt REST-skrivning av AO');
      t.note('besked: ' + (await s.toasts()).join(' / '));
    },
  },
  {
    id: 'AO-02', module: 'Arbetsordrar', name: 'Dubbelklick på "Skapa order" ger exakt en AO',
    async run(t) {
      const s = await t.world.session();
      await s.login('chef');
      const before = t.fake.get('workOrders').length;
      await createAO(s, 'E2E Dubbelklick', { doubleClick: true });
      await s.settle(2000);
      const n = t.fake.get('workOrders').filter((a) => a.title === 'E2E Dubbelklick').length;
      t.assert(n === 1, 'antal skapade AO: ' + n);
      t.assert(t.fake.get('workOrders').length === before + 1, 'exakt en ny AO på servern');
    },
  },
  {
    id: 'LOG-01', module: 'Arbetsorderloggar', name: 'Loggpost (fältarbetare på egen AO): "Sparar…" och sedan "sparad" först efter serverns ACK',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt2');
      await openAO(s, 'AO-007');
      t.fake.addFault({ match: /ao-time-write:patch_ao/, mode: 'delay', ms: 1200, times: 1 });
      await addLog(s, 'E2E kontrollerat ventil');
      await s.settle(300);
      const early = await s.toasts();
      t.assert(early.some((m) => /Sparar loggpost/.test(m)) && !early.some((m) => /Loggpost sparad/.test(m)), 'före ACK: bara "Sparar…" (' + early.join(' / ') + ')');
      await s.waitToast(/Loggpost sparad/, 6000);
      const ao = t.fake.get('workOrders').find((a) => a.id === 'AO-007');
      t.assert((ao.log || []).some((l) => l.text === 'E2E kontrollerat ventil'), 'loggposten finns på servern');
      t.assert(/E2E kontrollerat ventil/.test(await s.text('#ao-timeline')), 'tidslinjen visar posten');
    },
  },
  {
    id: 'LOG-02', module: 'Arbetsorderloggar', name: 'Servern nekar loggpost: aldrig "sparad", posten försvinner och fel visas',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt2');
      await openAO(s, 'AO-007');
      t.fake.addFault({ match: /ao-time-write:patch_ao/, mode: 'fail', status: 403, error: 'forbidden', times: 1 });
      await addLog(s, 'E2E ska nekas');
      await s.waitToast(/kunde inte sparas/i, 6000);
      const toasts = await s.toasts();
      t.assert(!toasts.some((m) => /Loggpost sparad/.test(m)), 'ingen "sparad"');
      t.assert(!/E2E ska nekas/.test(await s.text('#ao-timeline')), 'posten borttagen ur tidslinjen');
      t.assert(!JSON.stringify(t.fake.get('workOrders')).includes('E2E ska nekas'), 'inte på servern');
    },
  },
  {
    id: 'LOG-03', module: 'Arbetsorderloggar', name: 'Avbrott mitt i sparning: ingen bekräftelse; efter återanslutning skickas posten exakt en gång',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt2');
      await openAO(s, 'AO-007');
      s.offline = true;
      await addLog(s, 'E2E offline-post');
      await s.settle(1500);
      t.assert(!(await s.toasts()).some((m) => /Loggpost sparad/.test(m)), 'ingen "sparad" offline');
      const pending = await s.eval(() => AOTimeSyncService.pendingCount());
      t.assert(pending >= 1, 'ligger i outboxen (' + pending + ')');
      s.offline = false;
      await s.eval(() => AOTimeSyncService.resumePending());
      await s.waitToast(/Loggpost sparad/, 8000);
      const n = (t.fake.get('workOrders').find((a) => a.id === 'AO-007').log || []).filter((l) => l.text === 'E2E offline-post').length;
      t.assert(n === 1, 'exakt en gång på servern (' + n + ')');
    },
  },
  {
    id: 'LOG-04', module: 'Arbetsorderloggar', name: 'Servern svarar inte (timeout): "sparad" visas aldrig före serverns bekräftelse; exakt en post',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt2');
      await openAO(s, 'AO-007');
      await s.eval(() => { Storage.WRITE_TIMEOUT_MS = 1500; });
      t.fake.addFault({ match: /ao-time-write:patch_ao/, mode: 'hang', times: 1 });
      await addLog(s, 'E2E timeout-post');
      await s.settle(2500);
      await s.eval(() => AOTimeSyncService.resumePending());
      await s.waitToast(/Loggpost sparad/, 8000);
      await assertSavedAfterAck(t, s, 'E2E timeout-post');
    },
  },
  {
    id: 'LOG-05', module: 'Arbetsorderloggar', name: 'Osäkert utfall (servern sparade, svaret tappades): "sparad" först efter bekräftelse, ingen dubblett vid återförsök',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt2');
      await openAO(s, 'AO-007');
      t.fake.addFault({ match: /ao-time-write:patch_ao/, mode: 'drop-response', times: 1 });
      await addLog(s, 'E2E tappat svar');
      await s.settle(1200);
      t.assert(t.fake.calls.some((c) => c.committedButDropped), 'servern hann spara men svaret tappades');
      await s.eval(() => AOTimeSyncService.resumePending());
      await s.waitToast(/Loggpost sparad/, 8000);
      await assertSavedAfterAck(t, s, 'E2E tappat svar');
    },
  },
  {
    id: 'CHK-01', module: 'Arbetsorderchecklistor', name: 'Admin lägger till kontrollpunkt; fältarbetare bockar av — båda på servern',
    async run(t) {
      const c = await t.world.session();
      await c.login('admin');
      await openAO(c, 'AO-007');
      await c.eval(() => WorkOrderDetailPage.openAddChecklist());
      await c.page.waitForSelector('.modal-overlay.open #cl-text');
      await c.page.fill('#cl-text', 'E2E Kontrollera tätning');
      await c.clickModalButton(/Lägg till/);
      await c.settle(1500);
      const ao1 = t.fake.get('workOrders').find((a) => a.id === 'AO-007');
      const item = (ao1.checklist || []).find((x) => x.text === 'E2E Kontrollera tätning');
      t.assert(item, 'kontrollpunkten på servern');
      const f = await t.world.session();
      await f.login('falt2');
      await openAO(f, 'AO-007');
      const idx = await f.eval(() => getAO('AO-007').checklist.findIndex((x) => x.text === 'E2E Kontrollera tätning'));
      t.assert(idx >= 0, 'fältarbetaren ser punkten');
      await f.eval((i) => WorkOrderDetailPage.toggleCheck(i), idx);
      await f.settle(1500);
      const ao2 = t.fake.get('workOrders').find((a) => a.id === 'AO-007');
      t.assert(ao2.checklist.find((x) => x.text === 'E2E Kontrollera tätning').done === true, 'avbockad på servern');
    },
  },
  {
    id: 'MAT-01', module: 'Materialregistrering', name: 'Material läggs till på AO med antal, pris och moms; servern får raden',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt2');
      await openAO(s, 'AO-007');
      await s.eval(() => WorkOrderDetailPage.openAddMaterial());
      await s.page.waitForSelector('.modal-overlay.open #mat-name');
      await s.page.fill('#mat-name', 'E2E Packning');
      await s.page.fill('#mat-qty', '3');
      await s.page.fill('#mat-sell', '45.50');
      await s.clickModalButton(/Lägg till/);
      await s.settle(1500);
      const m = (t.fake.get('workOrders').find((a) => a.id === 'AO-007').materials || []).find((x) => x.name === 'E2E Packning');
      t.assert(m && Number(m.qty) === 3 && Number(m.sellPrice) === 45.5, 'materialraden på servern: ' + JSON.stringify(m));
    },
  },
  {
    id: 'AO-03', module: 'Arbetsordrar', name: 'Starta arbete ändrar status på servern',
    async run(t) {
      const s = await t.world.session();
      await s.login('chef');
      await openAO(s, 'AO-007');
      await s.page.locator('.page.active button', { hasText: 'Starta arbete' }).first().click();
      await s.settle(1500);
      const st = t.fake.get('workOrders').find((a) => a.id === 'AO-007').status;
      t.assert(/pågå/.test(st), 'status på servern: ' + st);
    },
  },
  {
    id: 'AO-04', module: 'Arbetsordrar', name: 'Arkivera med bekräftelse → servern arkiverad; besked först efter ACK; återställ fungerar',
    async run(t) {
      const s = await t.world.session();
      await s.login('admin');
      await openAO(s, 'AO-007');
      await s.eval(() => WorkOrderDetailPage.openArchiveModal());
      await s.page.waitForSelector('.modal-overlay.open');
      await s.clickModalButton(/Arkivera/);
      await s.waitToast(/arkiverad/i, 6000);
      t.assert(t.fake.get('workOrders').find((a) => a.id === 'AO-007').archived === true, 'arkiverad på servern');
      await s.eval(() => WorkOrderDetailPage._restoreFromArchive('AO-007'));
      await s.waitToast(/Återställd från arkiv/, 6000);
      t.assert(t.fake.get('workOrders').find((a) => a.id === 'AO-007').archived === false, 'återställd på servern');
    },
  },
  {
    id: 'AO-05', module: 'Arbetsordrar', name: 'Arkivering som servern nekar: AO:n återställs lokalt, inget "arkiverad"',
    async run(t) {
      const s = await t.world.session();
      await s.login('admin');
      await openAO(s, 'AO-007');
      t.fake.addFault({ match: /ao-time-write:patch_ao/, mode: 'fail', status: 403, error: 'forbidden', times: 1 });
      await s.eval(() => WorkOrderDetailPage.openArchiveModal());
      await s.page.waitForSelector('.modal-overlay.open');
      await s.clickModalButton(/Arkivera/);
      await s.waitToast(/nekades/i, 6000);
      t.assert(await s.eval(() => getAO('AO-007').archived !== true), 'lokalt återställd');
      t.assert(!(await s.toasts()).some((m) => /^Arbetsorder arkiverad$/.test(m)), 'inget "arkiverad"');
    },
  },
  {
    id: 'AO-06', module: 'Arbetsordrar', name: 'Två användare redigerar samma AO samtidigt (olika fält): båda ändringarna finns kvar på servern',
    async run(t) {
      const a = await t.world.session(); await a.login('chef');
      const b = await t.world.session(); await b.login('admin');
      await Promise.all([
        a.eval(() => WorkOrderService.update('AO-007', { description: 'E2E beskrivning från A' })),
        b.eval(() => WorkOrderService.update('AO-007', { priority: 'hög' })),
      ]);
      await a.settle(1500);
      const ao = t.fake.get('workOrders').find((x) => x.id === 'AO-007');
      t.assert(ao.description === 'E2E beskrivning från A' && ao.priority === 'hög', 'båda fälten kvar: ' + ao.description + ' / ' + ao.priority);
    },
  },
  {
    id: 'AO-07', knownIssue: 'G5', module: 'Arbetsordrar', name: 'Samtidiga loggposter från två enheter på samma AO (känt gap G5)',
    async run(t) {
      const a = await t.world.session(); await a.login('falt2');
      const b = await t.world.session(); await b.login('falt2');
      await openAO(a, 'AO-007'); await openAO(b, 'AO-007');
      await addLog(a, 'E2E från enhet A');
      await addLog(b, 'E2E från enhet B');
      await a.settle(2000);
      const log = t.fake.get('workOrders').find((x) => x.id === 'AO-007').log || [];
      const hasA = log.some((l) => l.text === 'E2E från enhet A'), hasB = log.some((l) => l.text === 'E2E från enhet B');
      t.note('A kvar: ' + hasA + ', B kvar: ' + hasB);
      t.assert(hasA && hasB, 'båda loggposterna borde finnas kvar — loggen skickas som hel array (G5)');
    },
  },
  {
    id: 'AO-09', module: 'Arbetsordrar', name: 'En AO-ändring = en serverskrivning (ingen extra geokodnings-patch när adressen inte kan geokodas)',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt2');
      await openAO(s, 'AO-007');
      await addLog(s, 'E2E första');
      await s.waitToast(/Loggpost sparad/, 6000);
      await s.settle(500);
      const before = t.fake.calls.filter((c) => c.action === 'ao-time-write:patch_ao').length;
      await s.clearToasts();
      await addLog(s, 'E2E andra');
      await s.waitToast(/Loggpost sparad/, 6000);
      await s.settle(800);
      const n = t.fake.calls.filter((c) => c.action === 'ao-time-write:patch_ao').length - before;
      t.metric('patch_ao per loggpost', n);
      t.assert(n === 1, 'exakt en patch_ao för andra loggposten (fick ' + n + ')');
    },
  },
  {
    id: 'IMG-01', module: 'Bilder och dokument', name: 'Foto i AO-logg laddas upp via EF (bara imagePath i AO), visas via signerad URL',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt2');
      await openAO(s, 'AO-007');
      await addLog(s, 'E2E med foto', JPEG);
      await s.waitToast(/Loggpost sparad/, 10000);
      const entry = (t.fake.get('workOrders').find((a) => a.id === 'AO-007').log || []).find((l) => l.text === 'E2E med foto');
      t.assert(entry && entry.imagePath && entry.imagePath.startsWith('AO-007/'), 'imagePath på servern: ' + (entry && entry.imagePath));
      t.assert(!entry.imageData, 'inga bildbytes i AO');
      t.assert(t.fake.files.has(entry.imagePath), 'filen finns i lagringen');
      await s.settle(600);
      const src = await s.eval((p) => { const i = document.querySelector('img[data-imgpath="' + p + '"]'); return i ? i.getAttribute('src') : null; }, entry.imagePath);
      t.assert(src && src.includes('e2e-storage.invalid'), 'bilden fick signerad URL: ' + src);
    },
  },
  {
    id: 'IMG-02', module: 'Bilder och dokument', name: 'Fil som inte är en bild nekas av servern; loggposten sparas inte',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt2');
      await openAO(s, 'AO-007');
      const fake = { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('<html>inte en bild</html>') };
      await addLog(s, 'E2E falsk bild', fake);
      await s.waitToast(/kunde inte laddas upp/i, 10000);
      t.assert(!JSON.stringify(t.fake.get('workOrders')).includes('E2E falsk bild'), 'ingen loggpost på servern');
    },
  },
  {
    id: 'IMG-03', module: 'Bilder och dokument', name: 'Radera loggpost med foto: filen raderas först efter serverbekräftad radering',
    async run(t) {
      const s = await t.world.session();
      await s.login('admin');
      await openAO(s, 'AO-007');
      await addLog(s, 'E2E radera foto', JPEG);
      await s.waitToast(/Loggpost sparad/, 10000);
      const entry = t.fake.get('workOrders').find((a) => a.id === 'AO-007').log.find((l) => l.text === 'E2E radera foto');
      t.fake.addFault({ match: /ao-time-write:patch_ao/, mode: 'fail', status: 403, error: 'forbidden', times: 1 });
      await s.eval((id) => WorkOrderDetailPage.deleteLogEntry(id), entry.id);
      await s.clickModalButton(/Bekräfta/);
      await s.waitToast(/nekades|kunde inte/i, 6000);
      t.assert(t.fake.files.has(entry.imagePath), 'nekad radering → filen kvar');
      await s.eval((id) => WorkOrderDetailPage.deleteLogEntry(id), entry.id);
      await s.clickModalButton(/Bekräfta/);
      await s.waitToast(/Loggpost borttagen/, 6000);
      await s.settle(500);
      t.assert(!t.fake.files.has(entry.imagePath), 'bekräftad radering → filen borta');
    },
  },
  {
    id: 'AO-08', module: 'Användarroller och behörigheter', name: 'Begränsad användare: servern levererar bara egna/pool-AO; direkt patch av annan AO → 403',
    async run(t) {
      const s = await t.world.session();
      await s.login('begransad');
      const ids = await s.eval(() => state.workOrders.map((a) => ({ id: a.id, staff: a.staff, status: a.status })));
      const bad = ids.filter((a) => !(a.staff || []).includes('ST-005') && a.status !== 'pool');
      t.assert(bad.length === 0, 'inga andras AO i klientens data (' + bad.map((a) => a.id).join() + ')');
      const r = await s.eval(() => AOTimeSyncService._call({ action: 'patch_ao', aoId: 'AO-007', patch: { title: 'HACK' }, idempotencyKey: 'x-' + Date.now() }));
      t.assert(r.ok === false && r.httpStatus === 403, 'direktanrop nekas: ' + JSON.stringify(r));
      t.assert(t.fake.get('workOrders').find((a) => a.id === 'AO-007').title !== 'HACK', 'servern oförändrad');
    },
  },
];
