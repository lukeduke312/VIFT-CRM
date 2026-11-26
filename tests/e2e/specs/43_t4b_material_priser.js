'use strict';
/*
 * T4-B (2026-11-28): material, priser och tid i klienten mot den simulerade servern
 * (tests/e2e/t4b-regler.js = vift-v2 20261128000011, paritet i tests/sim_parity.test.js).
 *
 *  T4B-01  D-09/D-19/F13: fältet lägger till material via formuläret — artikelväljaren och formuläret
 *          visar inga belopp och har inga prisfält; raden sparas radvis (add_material) och servern sätter
 *          pris från artikeln; tillståndet och skärmen saknar belopp.
 *  T4B-02  D-19 + gammal klient: fältets hela lista (v3.4/T3/T4-A-vägen) nekas (row_path_required) och
 *          inget ändras; fältet ser inga redigera/ta bort-knappar på andras rader.
 *  T4B-03  D-10 (R20/R21): fritext utan pris är OKÄND (aldrig 0 kr) och visas som "Pris saknas" i
 *          faktureringskön; arbetsledaren kompletterar priset; material på en fastpris-AO ingår i
 *          fastpriset (ingen egen källa); servern stoppar ett underlag med okänt pris (price_unknown).
 *  T4B-04  D-11/F13: stämpla ut och Tid-sidan visar prisgrupp utan belopp och bara AO:ns grupp; servern
 *          nekar en annan grupp (price_group_not_allowed); time-entries-list saknar timpris för fältet.
 *  T4B-05  punkt 247/G12: aktivera/inaktivera prisgrupp — besked först efter serverbekräftelse; vid
 *          avslag rullas ändringen tillbaka.
 *  T4B-06  K-01/D-08: arbetsledaren (time_view_all) ser all personals tid utan attest; ekonomi med attest.
 *  T4B-07  T3-B beslut 1: tid på klar AO nekas (ao_locked); ekonomi rättar i efterhand (correct_time) med
 *          orsak och revisionsrad; fältet får inte rätta.
 *  T4B-08  F13: lönsamheten visar "Saknas" när intern timkostnad saknas (inget påhittat 250 kr/h) och TB
 *          markeras ofullständigt.
 *
 * Nivå: lokalt verifierad mot fake-backend.js. Inget här är verifierat i STAGING.
 */
const crypto = require('crypto');
const WORLD = { backend: { keyPerms: require('../server-key-perms.js'), activitiesPolicy: true, activityAppend: true } };
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v === undefined ? null : v)).digest('hex');
const direkt = (s, ef, body) => s.eval(async ([e, b]) => {
  const r = await fetch(SUPABASE_URL + '/functions/v1/' + e, { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  let d = {}; try { d = await r.json(); } catch (x) {}
  return { status: r.status, error: d.error, reason: d.reason, body: d };
}, [ef, body]);
const nyckel = () => 'e2e-t4b-' + crypto.randomBytes(6).toString('hex');
const ao = (t, id) => (t.fake.get('workOrders') || []).find((a) => a.id === id);
const harBelopp = (html) => /\d[\d\s]*(,\d+)?\s*kr\b/.test(String(html || '').replace(/<[^>]+>/g, ' '));

module.exports = [
  {
    id: 'T4B-01', world: WORLD, module: 'Säkerhet', name: 'D-09/D-19/F13: fältet lägger till material utan belopp i väljare och formulär; raden sparas radvis och servern sätter artikelpriset',
    async run(t) {
      const s = await t.world.session({ viewport: 'mobile' });
      await s.login('falt');
      await s.settle(800);
      await s.go('pg-ao-detail', { aoId: 'AO-001' });
      await s.settle(800);
      await s.eval(() => WorkOrderDetailPage.openAddMaterial());
      await s.settle(400);
      const modal = await s.eval(() => (document.querySelector('.modal-overlay.open') || {}).innerHTML || '');
      t.assert(!/id="mat-sell"|id="mat-buy"|id="mat-calc"/.test(modal), 'formuläret har inga prisfält och ingen beloppsberäkning för fältet');
      t.assert(!/Ink:|Pris:|kr exkl\. moms/.test(modal), 'artikelväljaren visar inga belopp (inköp eller försäljning)');
      t.assert(/id="mat-note"/.test(modal), 'formuläret har ett dokumentationsfält');
      const radFore = (ao(t, 'AO-001').materials || []).length;
      await s.eval(() => { const el = document.querySelector('#art-list .art-row[data-id="ART-001"]'); WorkOrderDetailPage._matSelectArticle(el); document.getElementById('mat-qty').value = '2'; document.getElementById('mat-note').value = 'Fogat badrum'; return WorkOrderDetailPage._saveMaterial(null); });
      await s.settle(1500);
      const rader = ao(t, 'AO-001').materials;
      const ny = rader[rader.length - 1];
      t.assert(rader.length === radFore + 1 && ny.articleId === 'ART-001' && ny.sellPrice === 145 && ny.buyPrice === 75 && ny.addedBy === 'ST-002' && ny.note === 'Fogat badrum' && /^M-/.test(ny.id),
        'servern sparade raden med artikelns pris (145/75 kr), addedBy = fältet och serverns id: ' + JSON.stringify(ny));
      const v = await s.eval(() => ({ mats: (getAO('AO-001') || {}).materials, html: (document.getElementById('ao-materials') || document.body).innerHTML }));
      t.assert(v.mats.every((m) => !('sellPrice' in m) && !('buyPrice' in m)) && !v.mats.some((m) => /^pending-/.test(m.id)), 'tillståndet har serverns (projicerade) rader utan försäljnings- och inköpspris');
      const sek = await s.eval(() => WorkOrderDetailPage._renderMaterials(getAO('AO-001')));
      t.assert(!harBelopp(sek), 'materialsektionen visar inga belopp för fältet');
    },
  },
  {
    id: 'T4B-02', world: WORLD, module: 'Säkerhet', name: 'D-19: fältets hela materiallista (äldre klient) nekas utan ändring; inga redigera/ta bort-knappar på andras rader',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('falt');
      await s.settle(800);
      const k0 = md5(t.fake.get('workOrders'));
      const mats = await s.eval(() => getAO('AO-001').materials);
      const d = await direkt(s, 'ao-time-write', { action: 'patch_ao', idempotencyKey: nyckel(), aoId: 'AO-001', patch: { materials: mats.concat([{ id: 'M' + Date.now(), name: 'Fritext', qty: 1, unit: 'st', buyPrice: 0, sellPrice: 0, vatRate: 25 }]) } });
      t.assert(d.status === 403 && d.error === 'forbidden' && d.reason === 'row_path_required' && md5(t.fake.get('workOrders')) === k0, 'SEC-B1-06: 403 forbidden/row_path_required, inga rader ändrade (ingen 0-kronorsrad)');
      const html = await s.eval(() => WorkOrderDetailPage._renderMaterials(getAO('AO-001')));
      const andras = (ao(t, 'AO-001').materials || []).filter((m) => m.addedBy !== 'ST-002');
      t.assert(andras.length > 0 && andras.every((m) => !html.includes('data-id="' + m.id + '" title="Redigera material"')), 'fältet ser inga redigera/ta bort-knappar på andras (eller äldre) rader');
      const e = await direkt(s, 'ao-time-write', { action: 'update_material', idempotencyKey: nyckel(), aoId: 'AO-001', rowId: andras[0].id, patch: { qty: 9 } });
      t.assert(e.status === 403 && e.reason === 'not_own_row' && md5(t.fake.get('workOrders')) === k0, 'SEC-B1-05: annans rad → 403 not_own_row, oförändrat');
    },
  },
  {
    id: 'T4B-03', world: WORLD, module: 'Fakturering', name: 'D-10: fritext utan pris är okänd (Pris saknas, aldrig 0 kr), arbetsledaren kompletterar, fastpris-material ingår, servern stoppar okänt pris',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('falt');
      await s.settle(800);
      const a = await direkt(s, 'ao-time-write', { action: 'add_material', idempotencyKey: nyckel(), aoId: 'AO-012', row: { name: 'Fritext utan pris', qty: 2, unit: 'st', sellPrice: 0 } });
      const rad = (ao(t, 'AO-012').materials || []).find((m) => m.name === 'Fritext utan pris');
      t.assert(a.status === 200 && rad && rad.sellPrice === null && rad.sellPriceUnknown === true && (a.body.ignoredFields || []).includes('sellPrice'), 'fritext på klar AO (T3-B beslut 2): okänt pris (null), klientens 0 ignorerat');
      // Fastpris-AO med fältmaterial: ingen egen källa i kön.
      const f = await direkt(s, 'ao-time-write', { action: 'add_material', idempotencyKey: nyckel(), aoId: 'AO-005', row: { articleId: 'ART-001', qty: 1 } });
      t.assert(f.status === 200, 'fältet lägger material på sin fastpris-AO');
      const e = await t.world.session({ viewport: 'laptop' });
      await e.login('ekonomi');
      await e.settle(1000);
      const k = await e.eval((radId) => { const c = BillingQueueService.getCandidates(); return { okand: c.find((x) => x.sourceId === radId), fast: c.filter((x) => x.workOrderId === 'AO-005' && x.sourceType === 'material'), kr: InvoicesPage._kr(null) }; }, rad.id);
      t.assert(k.okand && !k.okand.selectable && k.okand.issues.includes('Saknar försäljningspris') && k.okand.amount === null && k.kr === 'Pris saknas', 'kön: raden med okänt pris kräver åtgärd, beloppet är okänt (visas "Pris saknas", inte 0,00 kr)');
      t.assert(k.fast.length === 0, 'R21/D-10: material på fastpris-AO (inte markerat som tillägg) är ingen egen fakturakälla');
      const k0 = md5(t.fake.get('invoices'));
      const inv = { title: 'x', customerId: ao(t, 'AO-012').customerId, sourceAware: true, lines: [{ id: 'L1', description: 'x', qty: 2, unit: 'st', unitPrice: 0, vatRate: 25, sourceRefs: [{ sourceKey: 'material:AO-012:' + rad.id, sourceType: 'material', sourceId: rad.id, workOrderId: 'AO-012' }] }] };
      const x = await direkt(e, 'invoice-write', { action: 'appendChecked', idempotencyKey: 'vift-v2:' + crypto.randomUUID(), invoice: inv });
      t.assert(x.status === 409 && x.error === 'price_unknown' && md5(t.fake.get('invoices')) === k0, 'SEC-B1-15: underlag med okänt pris → 409 price_unknown, inget skapat');
      const c = await t.world.session({ viewport: 'laptop' });
      await c.login('chef');
      await c.settle(1000);
      const u = await direkt(c, 'ao-time-write', { action: 'update_material', idempotencyKey: nyckel(), aoId: 'AO-012', rowId: rad.id, patch: { sellPrice: 60 } });
      const r2 = (ao(t, 'AO-012').materials || []).find((m) => m.id === rad.id);
      t.assert(u.status === 200 && r2.sellPrice === 60 && r2.sellPriceUnknown === false && ao(t, 'AO-012').log.some((l) => l.type === 'material_price_completed'), 'SEC-B1-13: arbetsledaren kompletterar priset; flaggan tas bort och kompletteringen loggas');
    },
  },
  {
    id: 'T4B-04', world: WORLD, module: 'Tid', name: 'D-11/F13: stämpla ut och Tid visar prisgrupp utan belopp, bara AO:ns grupp; annan grupp nekas; inget timpris i tidposterna',
    async run(t) {
      const s = await t.world.session({ viewport: 'mobile' });
      await s.login('falt');
      await s.settle(800);
      const opts = await s.eval(() => TimeService.priceGroupOptions('PG-001', 'AO-001'));
      t.assert(/Fastighetsservice avtal/.test(opts) && !/kr\/tim/.test(opts) && (opts.match(/<option/g) || []).length === 1, 'R22: fältet ser bara AO:ns prisgrupp, namnet utan belopp: ' + opts);
      const pg = await s.eval(() => state.priceGroups);
      t.assert(Array.isArray(pg) && pg.length > 0 && pg.every((g) => !('hourRate' in g)), 'SEC-B2-01: prisgrupperna i tillståndet saknar timpris');
      const k0 = md5(t.fake.get('timeEntries'));
      const d = await direkt(s, 'ao-time-write', { action: 'create_time', idempotencyKey: nyckel(), entry: { id: 'TE-T4B-1', aoId: 'AO-001', date: '2026-11-24', minutes: 30, priceGroupId: 'PG-004', hourRate: 9999 } });
      t.assert(d.status === 403 && d.reason === 'price_group_not_allowed' && md5(t.fake.get('timeEntries')) === k0, 'SEC-B2-04: annan grupp än AO:ns → 403 price_group_not_allowed, inget sparat');
      const ok = await direkt(s, 'ao-time-write', { action: 'create_time', idempotencyKey: nyckel(), entry: { id: 'TE-T4B-2', aoId: 'AO-001', date: '2026-11-24', minutes: 30, priceGroupId: 'PG-001', hourRate: 9999 } });
      const lagrad = t.fake.get('timeEntries').find((x) => x.id === 'TE-T4B-2');
      t.assert(ok.status === 200 && lagrad.hourRate === 392 && (ok.body.ignoredFields || []).includes('hourRate') && !('hourRate' in ok.body.timeEntry), 'SEC-B2-03: servern sätter grupps timpris (392), klientens 9999 ignoreras; svaret saknar timpris');
      await s.go('pg-tid');
      await s.settle(1200);
      const tid = await s.eval(() => ({ te: state.timeEntries, html: document.body.innerText }));
      t.assert(tid.te.every((x) => !('hourRate' in x)) && !/kr\/tim/.test(tid.html), 'Tid-sidan och tillståndet visar inga timpriser för fältet');
    },
  },
  {
    id: 'T4B-05', world: WORLD, module: 'Administration', name: 'punkt 247/G12: aktivera/inaktivera prisgrupp — besked efter serverbekräftelse, avslag rullas tillbaka',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.settle(1000);
      await s.go('pg-pricegroups');
      await s.settle(600);
      t.fake.addFault({ match: /^store-key-write:(writeMerge|write)$/, mode: 'fail', status: 403, error: 'forbidden', times: 6 });
      await s.clearToasts();
      await s.eval(() => PriceGroupsPage.openEdit('PG-003'));
      await s.settle(300);
      await s.clickModalButton(/Inaktivera/);
      await s.settle(2500);
      const v1 = await s.eval(() => (state.priceGroups.find((g) => g.id === 'PG-003') || {}).active);
      const toasts1 = await s.toasts();
      t.assert(v1 === true && t.fake.get('priceGroups').find((g) => g.id === 'PG-003').active === true && toasts1.some((m) => /kunde inte|avvisade|behörighet/.test(m)) && !toasts1.includes('Inaktiverad'),
        'avslag: ingen "Inaktiverad", prisgruppen återställd till aktiv i klienten och på servern: ' + JSON.stringify(toasts1));
      t.fake.clearFaults();
      await s.clearToasts();
      await s.eval(() => PriceGroupsPage.openEdit('PG-003'));
      await s.settle(300);
      await s.clickModalButton(/Inaktivera/);
      await s.settle(2000);
      const toasts2 = await s.toasts();
      t.assert(t.fake.get('priceGroups').find((g) => g.id === 'PG-003').active === false && toasts2.includes('Inaktiverad'), 'bekräftat: servern har inaktiverat gruppen och beskedet visas först därefter: ' + JSON.stringify(toasts2));
    },
  },
  {
    id: 'T4B-06', world: WORLD, module: 'Tid', name: 'K-01/D-08: arbetsledaren (time_view_all) ser all personals tid utan attest; ekonomi (payroll_view) med attest',
    async run(t) {
      const te = t.fake.get('timeEntries');
      te.push({ id: 'TE-T4B-ATT', aoId: 'AO-001', staffId: 'ST-002', staffName: 'Fält Ett', date: '2026-11-20', minutes: 60, priceGroupId: 'PG-001', priceGroupName: 'Fastighetsservice avtal', hourRate: 392, attested: true, attestedAt: '2026-11-21T08:00:00.000Z', attestedBy: 'ST-006', createdAt: '2026-11-20T08:00:00.000Z' });
      t.fake.set('timeEntries', te);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await s.settle(1200);
      const c = await s.eval(() => (state.timeEntries || []).find((x) => x.id === 'TE-T4B-ATT'));
      t.assert(c && c.minutes === 60 && !('attested' in c) && !('attestedBy' in c) && c.hourRate === 392, 'arbetsledaren ser fältets tidpost (arbetad tid, timpris med prisläsrätt) men inga attestuppgifter: ' + JSON.stringify(c));
      const e = await t.world.session({ viewport: 'laptop' });
      await e.login('ekonomi');
      await e.settle(1200);
      const ek = await e.eval(() => (state.timeEntries || []).find((x) => x.id === 'TE-T4B-ATT'));
      t.assert(ek && ek.attested === true && ek.attestedBy === 'ST-006', 'ekonomi (payroll_view) ser attesten');
      const f = await t.world.session({ viewport: 'laptop' });
      await f.login('falt2');
      await f.settle(1000);
      const f2 = await f.eval(() => (state.timeEntries || []).filter((x) => x.staffId !== 'ST-004').length);
      t.assert(f2 === 0, 'SEC-TID-09: fältet ser inga andras tidposter');
    },
  },
  {
    id: 'T4B-07', world: WORLD, module: 'Tid', name: 'T3-B beslut 1: tid på klar AO nekas; ekonomi kompletterar i efterhand med orsak och revisionsrad; fältet får inte rätta',
    async run(t) {
      const s = await t.world.session({ viewport: 'mobile' });
      await s.login('falt');
      await s.settle(800);
      const k0 = md5(t.fake.get('timeEntries'));
      const d = await direkt(s, 'ao-time-write', { action: 'create_time', idempotencyKey: nyckel(), entry: { id: 'TE-T4B-K', aoId: 'AO-005', date: '2026-11-24', minutes: 30 } });
      t.assert(d.status === 409 && d.error === 'ao_locked' && md5(t.fake.get('timeEntries')) === k0, 'normal tid på klar AO → 409 ao_locked, inget sparat');
      const r = await direkt(s, 'ao-time-write', { action: 'correct_time', idempotencyKey: nyckel(), entry: { aoId: 'AO-005', staffId: 'ST-002', date: '2026-11-24', minutes: 30 }, reason: 'Jag glömde' });
      t.assert(r.status === 403 && r.error === 'forbidden', 'fältet får inte rätta i efterhand (payroll_manage krävs)');
      const e = await t.world.session({ viewport: 'laptop' });
      await e.login('ekonomi');
      await e.settle(1000);
      const x = await direkt(e, 'ao-time-write', { action: 'correct_time', idempotencyKey: nyckel(), entry: { aoId: 'AO-005', staffId: 'ST-002', date: '2026-11-22', minutes: 45, priceGroupId: 'PG-002' }, reason: 'Glömd tid vid slutbesiktning' });
      const ny = t.fake.get('timeEntries').find((q) => (q.corrections || []).some((c) => c.reason === 'Glömd tid vid slutbesiktning'));
      t.assert(x.status === 200 && ny && ny.hourRate === 430 && ny.corrections[0].by === 'ST-006' && ao(t, 'AO-005').log.some((l) => l.type === 'time_corrected'), 'punkt 276: kompletteringen sparas med serverns timpris, revisionsrad och loggpost i AO:n');
    },
  },
  {
    id: 'T4B-08', world: WORLD, module: 'Arbetsorder', name: 'F13: lönsamheten visar intern timkostnad som saknad (inget påhittat 250 kr/h) och TB som ofullständigt',
    async run(t) {
      const st = t.fake.get('settings') || {};
      delete st.internalHourlyCost;
      t.fake.set('settings', st);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.settle(1000);
      const v = await s.eval(() => { const tb = ProfitabilityService.calcTB(getAO('AO-001')); return { rate: ProfitabilityService.internalRate(), tb, html: WorkOrderDetailPage._tbBlock(getAO('AO-001')) }; });
      t.assert(v.rate === null && v.tb.incomplete === true && v.tb.tbPct === null && v.tb.saknas.includes('intern timkostnad'), 'internalRate() = null (inte 250), TB ofullständigt utan procenttal: ' + JSON.stringify(v.tb.saknas));
      t.assert(/Saknas/.test(v.html) && !/250 kr\/h/.test(v.html) && /Ofullständig/.test(v.html), 'lönsamhetskortet visar "Saknas" och "Ofullständig", aldrig 250 kr/h');
    },
  },
];
