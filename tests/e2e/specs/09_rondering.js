'use strict';
/* Rondering och avvikelser: guide → tillfälle → utförande på mobil →
   anmärkning med AO → slutför → rapport → AO klar → avvikelse åtgärdad. */

const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

async function createRonderingViaWizard(s, { name, customerId, propertyId, points, staffId }) {
  await s.go('pg-rondering-wizard', { reset: true });
  await s.page.fill('#wiz-name', name);
  await s.pickCustom('wiz-cu', customerId);
  await s.pickCustom('wiz-prop', propertyId);
  await s.page.locator('.page.active button', { hasText: 'Nästa' }).click();
  await s.page.locator('.page.active button', { hasText: 'Lägg till grupp' }).click();
  await s.page.fill('#cat-name-0', 'Trapphus');
  for (let i = 0; i < points.length; i++) {
    if (!(await s.page.locator('#pt-title-0-' + i).count())) await s.eval(() => RonderingWizardPage._addPoint(0));
    await s.page.fill('#pt-title-0-' + i, points[i]);
  }
  await s.page.locator('.page.active button', { hasText: 'Nästa' }).click();
  await s.page.fill('#occ-date', today());
  if (staffId) await s.pickCustom('occ-staff', staffId);
  await s.page.locator('.page.active button', { hasText: 'Lägg till tillfälle' }).click();
  await s.page.locator('.page.active button', { hasText: 'Nästa' }).click();
  await s.page.locator('.page.active button', { hasText: 'Spara rondering' }).click();
}

module.exports = [
  {
    id: 'RON-01', kind: 'workflow', module: 'Rondering', name: 'Flöde: skapa rondering i guiden → tillfälle → utför på mobil (OK, anmärkning med AO, ej aktuell) → slutför → rapport → AO klar → avvikelse åtgärdad',
    async run(t) {
      const a = await t.world.session({ viewport: 'laptop' });
      await a.login('admin');
      await createRonderingViaWizard(a, { name: 'Månadsrondering E2E', customerId: 'K-002', propertyId: 'OBJ-002', points: ['Belysning', 'Brandsläckare', 'Hiss'], staffId: 'ST-003' });
      await a.waitToast(/Rondering skapad · 1 tillfällen schemalagda/, 8000);
      await a.settle(1200);
      const ron = t.fake.get('ronderingar').find((r) => r.name === 'Månadsrondering E2E');
      t.assert(ron && ron.propertyId === 'OBJ-002' && (ron.categories[0].points || []).length === 3, 'ronderingen med 3 punkter sparad på servern');
      let pass = (t.fake.get('ronderingspass') || []).find((p) => p.ronderingId === ron.id);
      t.assert(pass && pass.status === 'planerat' && (pass.staffIds || []).includes('ST-003'), 'tillfället skapat på servern och tilldelat arbetsledaren');
      // Arbetsledaren utför på mobilen
      const m = await t.world.session({ viewport: 'iphone' });
      await m.login('chef');
      await m.go('pg-rondering-utfor', { passId: pass.id });
      const pts = pass.categories[0].points;
      await m.page.locator(`button[onclick="RonderingUtforandePage.markOk('${pass.id}','${pass.categories[0].id}','${pts[0].id}')"]`).click();
      await m.settle(600);
      await m.page.locator(`button[onclick="RonderingUtforandePage.openAvvModal('${pass.id}','${pass.categories[0].id}','${pts[1].id}')"]`).click();
      await m.page.waitForSelector('.modal-overlay.open #avv-title');
      await m.page.fill('#avv-title', 'Brandsläckare saknas plan 3');
      await m.page.selectOption('#avv-severity', 'hög');
      await m.page.fill('#avv-comment', 'Hållaren tom');
      await m.page.check('#avv-create-ao');
      await m.clickModalButton(/Spara anmärkning/);
      await m.waitToast(/AO skapad/, 8000);
      await m.settle(800);
      await m.page.locator(`button[onclick="RonderingUtforandePage.openEjAktuell('${pass.id}','${pass.categories[0].id}','${pts[2].id}')"]`).click();
      await m.page.waitForSelector('.modal-overlay.open #ej-comment');
      await m.page.fill('#ej-comment', 'Hissen avställd');
      await m.clickModalButton(/Bekräfta/);
      await m.settle(800);
      const avv = t.fake.get('avvikelser').find((x) => x.title === 'Brandsläckare saknas plan 3');
      t.assert(avv && avv.passId === pass.id && avv.severity === 'hög' && avv.status === 'öppen', 'avvikelsen sparad på servern (öppen, hög)');
      t.assert(avv.workOrderId, 'avvikelsen kopplad till en AO');
      const ao = t.fake.get('workOrders').find((x) => x.id === avv.workOrderId);
      t.assert(ao && ao.propertyId === 'OBJ-002', 'AO:n finns på servern för fastigheten');
      pass = t.fake.get('ronderingspass').find((p) => p.id === pass.id);
      const p2 = pass.categories[0].points[1];
      t.assert(pass.status === 'pågående' && p2.status === 'anmärkning' && p2.deviationId === avv.id && p2.workOrderId === ao.id, 'punkten har anmärkning, avvikelse- och AO-länk på servern');
      t.assert(pass.summary.ok === 1 && pass.summary.anmärkningar === 1 && pass.summary.ejAktuell === 1, 'serverns summering: ' + JSON.stringify(pass.summary));
      // Slutför
      await m.page.locator('.page.active button', { hasText: /Slutför/ }).first().click();
      if (await m.modalOpen()) await m.clickModalButton(/Slutför|Bekräfta/);
      await m.waitToast(/Rondering slutförd/, 8000);
      await m.settle(800);
      pass = t.fake.get('ronderingspass').find((p) => p.id === pass.id);
      t.assert(pass.status === 'har_avvikelser' && pass.completedBy === 'ST-003', 'servern satte slutstatus har_avvikelser');
      const rapport = await m.eval(() => (document.querySelector('.page.active') || document.body).innerText);
      t.assert(/Brandsläckare saknas plan 3/.test(rapport) && rapport.includes(ao.id), 'rapporten visar avvikelsen och AO:n');
      // Åtgärda: AO klar → avvikelsen åtgärdad
      await a.eval(() => DataSync._poll());
      await a.settle(800);
      await a.eval((id) => WorkOrderService.setStatus ? WorkOrderService.setStatus(id, 'klar') : WorkOrderService.update(id, { status: 'klar' }), ao.id);
      await a.settle(2000);
      t.assert(t.fake.get('workOrders').find((x) => x.id === ao.id).status === 'klar', 'AO klar på servern');
      const avv2 = t.fake.get('avvikelser').find((x) => x.id === avv.id);
      t.assert(avv2.status === 'åtgärdad' && avv2.resolvedByWorkOrderId === ao.id, 'avvikelsen åtgärdad via AO:n på servern (status ' + avv2.status + ')');
      // Historik på fastigheten
      await a.go('pg-obj-detail', { propId: 'OBJ-002' });
      await a.eval(() => PropertyDetailPage.switchTab('rondering'));
      await a.settle(400);
      const hist = await a.text('.page.active');
      t.assert(/Månadsrondering E2E/.test(hist), 'fastighetens ronderingsflik visar ronderingen');
    },
  },
  {
    id: 'RON-02', module: 'Avvikelser', name: 'Fältarbetare utan ao_view_all nekas rondering i UI och vid direktanrop; serverfel vid punkt ger tydligt fel och ingen lokal ändring',
    async run(t) {
      const f = await t.world.session({ viewport: 'android' });
      await f.login('falt');
      await f.go('pg-rondering');
      const txt = await f.eval(() => (document.querySelector('.page.active') || document.body).innerText);
      t.assert(!/Månadsrondering|RON-00/.test(txt), 'fältarbetaren ser inga ronderingar');
      const direct = await f.eval(() => RonderingSyncService._call({ action: 'create', passTemplate: { ronderingId: 'RON-002', categories: [] } }));
      t.assert(direct.ok === false && /forbidden|403/.test(direct.error), 'direktanrop nekas: ' + JSON.stringify(direct));
      const c = await t.world.session({ viewport: 'iphone' });
      await c.login('chef');
      const pass = await c.eval(async () => RonderingService.createPassFromRondering('RON-002', { scheduledDate: new Date().toISOString().slice(0, 10), staffIds: ['ST-003'] }));
      t.assert(pass && pass.id, 'tillfälle skapat');
      await c.go('pg-rondering-utfor', { passId: pass.id });
      const cat = pass.categories[0], pt = cat.points[0];
      t.fake.addFault({ match: /rondering-pass-write:pointPatch/, mode: 'fail', status: 503, error: 'http_503', times: 1 });
      await c.page.locator(`button[onclick="RonderingUtforandePage.markOk('${pass.id}','${cat.id}','${pt.id}')"]`).click();
      await c.settle(800);
      t.assert((await c.toasts()).some((m) => /Kunde inte spara/.test(m)), 'tydligt fel');
      t.assert(await c.eval(([p, ci, pi]) => { const ps = state.ronderingspass.find((x) => x.id === p); return !ps.categories.find((x) => x.id === ci).points.find((x) => x.id === pi).status; }, [pass.id, cat.id, pt.id]), 'punkten inte markerad lokalt');
      await c.page.locator(`button[onclick="RonderingUtforandePage.markOk('${pass.id}','${cat.id}','${pt.id}')"]`).click();
      await c.settle(800);
      t.assert(t.fake.get('ronderingspass').find((x) => x.id === pass.id).categories[0].points[0].status === 'ok', 'nytt försök sparat på servern');
    },
  },
  {
    id: 'RON-03', module: 'Rondering', name: 'Serverfel när ronderingen sparas: inget "Rondering skapad", inga tillfällen skapas för en rondering servern saknar',
    async run(t) {
      const a = await t.world.session({ viewport: 'laptop' });
      await a.login('admin');
      t.fake.addFault({ match: /store-key-write:writeMerge/, mode: 'fail', status: 503, error: 'http_503', times: 100 });
      await createRonderingViaWizard(a, { name: 'Felrondering E2E', customerId: 'K-002', propertyId: 'OBJ-002', points: ['Belysning'], staffId: 'ST-003' });
      await a.settle(3000);
      const toasts = await a.toasts();
      t.note('toasts: ' + toasts.join(' / '));
      t.assert(!toasts.some((m) => /^Rondering skapad/.test(m)), 'inget "Rondering skapad"');
      t.assert(toasts.some((m) => /kunde inte skapas/.test(m)), 'tydligt fel');
      t.assert(!t.fake.get('ronderingar').some((r) => r.name === 'Felrondering E2E'), 'ingen rondering på servern');
      t.assert(!(t.fake.get('ronderingspass') || []).some((p) => !t.fake.get('ronderingar').some((r) => r.id === p.ronderingId)), 'inga föräldralösa tillfällen på servern');
      t.assert(await a.eval(() => !state.ronderingar.some((r) => r.name === 'Felrondering E2E')), 'klienten visar ingen osparad rondering som sparad');
    },
  },
];
