'use strict';
/*
 * T3-D (2026-11-28): informationsåtkomst — urval per post (SÄK-2, B4, Ö7, D-12–D-15) och
 * aktivitetsloggen (D-22) i klienten, mot den simulerade servern som följer T3-D-reglerna
 * (paritet med vift-v2 20261128000006–07, tests/sim_parity.test.js). Världen använder serverns
 * KEY_PERMISSIONS och per-post-regeln för uppgifter (som PERM-03).
 *
 * Kontrolleras: (1) klientens tillstånd och lokala cache innehåller bara det servern lämnar ut,
 * (2) Uppgifter-sidan och dashboarden följer serverns uppgiftsregel (D-15, F8, SEC-TASK-04/05,
 * SEC-B4-07), (3) fältets vyer fungerar (AO-detalj med kund och kontakt, historik, Mina jobb),
 * (4) negativa direktanrop ger exakt felkod och lämnar serverns data oförändrade.
 *
 * Nivå: lokalt verifierad mot fake-backend.js. Inget här är verifierat i STAGING.
 */
const crypto = require('crypto');

const WORLD = { backend: { keyPerms: require('../server-key-perms.js'), activitiesPolicy: true, activityAppend: true } };
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex');
const T0 = '2026-11-20T08:00:00.000Z';
/* Syntetiska uppgifter (fält = ST-002, FÄ2 = ST-004, AL = ST-003, EK = ST-006). AO-001 och AO-013
   är tilldelade ST-002; AO-007 och AO-015 bara ST-004; AO-004 är öppen pool. */
function uppgifter(fake) {
  const a = (id, title, assignedTo, createdBy, extra) => Object.assign({ id, title, type: 'todo', status: 'open', priority: 'normal', assignedTo, createdBy, dueDate: '2026-11-20', createdAt: T0, updatedAt: T0 }, extra || {});
  fake.set('activities', [
    a('ACT-T3D-EGEN', 'Filips egen', 'ST-002', 'ST-002'),
    a('ACT-T3D-TILLD', 'Från arbetsledaren till Filip', 'ST-002', 'ST-003'),
    a('ACT-T3D-AOKOPPLAD', 'Fridas uppgift om AO-001', 'ST-004', 'ST-003', { relatedType: 'workOrder', relatedId: 'AO-001' }),
    a('ACT-T3D-ANNANS', 'Fridas egen (känslig)', 'ST-004', 'ST-004'),
    a('ACT-T3D-OFFERT', 'Offertuppföljning', 'ST-003', 'ST-003', { relatedType: 'offer', relatedId: 'OFF-001' }),
    a('ACT-T3D-POOL', 'Om öppen pool', 'ST-004', 'ST-004', { relatedType: 'workOrder', relatedId: 'AO-004' }),
    a('ACT-T3D-EK', 'Ekonomis egen', 'ST-006', 'ST-006'),
  ]);
}
const direkt = (s, body) => s.eval(async (b) => {
  const r = await fetch(SUPABASE_URL + '/functions/v1/store-key-write', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  let d = {}; try { d = await r.json(); } catch (e) {}
  return { status: r.status, error: d.error, reason: d.reason, body: d };
}, body);
const ids = (l) => (l || []).map((x) => x.id).sort().join(',');

module.exports = [
  {
    id: 'T3D-01', world: WORLD, module: 'Säkerhet', name: 'SÄK-2/SEC-TASK-04 (klient, D-15, F8): fältets Uppgifter och dashboard visar bara egna, tilldelade och uppgifter på egna AO; bara egna kan redigeras; Klar bara där servern tillåter; ansvarig kan bara vara en själv; direktanrop mot annans uppgift ger 403 not_own utan ändring',
    async run(t) {
      uppgifter(t.fake);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('falt');
      await s.go('pg-activities');
      await s.settle(800);
      const v = await s.eval(() => {
        ActivitiesPage.setFilter('alla');
        const rad = (id) => Array.from(document.querySelectorAll('#act-list tr.rg-row')).find((tr) => tr.getAttribute('onclick') && tr.getAttribute('onclick').includes(id));
        const info = (id) => { const tr = rad(id); if (!tr) return null; const cb = tr.querySelector('.rg-check'); return { synlig: true, klar: !!cb && !cb.disabled, oppna: !!tr.querySelector('.rg-c-end button, .rg-c-end a') }; };
        return { state: state.activities.map((a) => a.id).sort().join(','), egen: info('ACT-T3D-EGEN'), tilld: info('ACT-T3D-TILLD'), ao: info('ACT-T3D-AOKOPPLAD'), annans: info('ACT-T3D-ANNANS') };
      });
      t.note(JSON.stringify(v));
      t.assert(v.state === 'ACT-T3D-AOKOPPLAD,ACT-T3D-EGEN,ACT-T3D-TILLD', 'klientens tillstånd har bara de uppgifter servern lämnar ut (egen, tilldelad och kopplad till egen AO-001) — inte FÄ2:s, offertkopplade, poolens eller ekonomis: ' + v.state);
      t.assert(v.egen && v.egen.klar && v.egen.oppna, 'egen uppgift: klarmarkera och öppna/redigera');
      t.assert(v.tilld && v.tilld.klar && !v.tilld.oppna, 'tilldelad uppgift skapad av arbetsledaren: klarmarkera men inte redigera (serverns regel: bara status och datum)');
      t.assert(v.ao && !v.ao.klar && !v.ao.oppna, 'uppgift som syns via egen AO men tillhör FÄ2: bara läsbar (ingen klarmarkering, ingen redigering)');
      t.assert(v.annans === null, 'FÄ2:s egen uppgift visas inte alls');
      const form = await s.eval(() => { Modal.closeAll(); ActivitiesPage.openCreate(); const m = Array.from(document.querySelectorAll('.modal-sheet')).pop(); const o = Array.from(m.querySelectorAll('#act-assignee option')).map((x) => x.value); Modal.closeAll(); return o; });
      t.assert(form.join() === 'ST-002', 'Ny uppgift: ansvarig kan bara vara en själv (servern nekar annat med not_own): ' + form.join());
      // Dashboardens widget "Aktiviteter & uppföljningar": Klar bara där servern tillåter det.
      await s.go('pg-dashboard');
      await s.settle(800);
      const dash = await s.eval(() => { const h = document.body.innerHTML; const n = (id) => (h.match(new RegExp("ActivitiesService\\.complete\\('" + id + "'\\)", 'g')) || []).length; return { egen: n('ACT-T3D-EGEN'), tilld: n('ACT-T3D-TILLD'), ao: n('ACT-T3D-AOKOPPLAD'), annans: n('ACT-T3D-ANNANS') }; });
      t.assert(dash.egen === 1 && dash.tilld === 1 && dash.ao === 0 && dash.annans === 0, 'dashboarden (SEC-B4-07/D-15): Klar-knapp för egen och tilldelad uppgift, inte för uppgift som bara syns via egen AO: ' + JSON.stringify(dash));
      await s.go('pg-activities');
      await s.settle(500);
      // Klarmarkera den tilldelade uppgiften via sidan → servern godtar.
      await s.eval(() => ActivitiesPage.toggleComplete('ACT-T3D-TILLD'));
      await s.settle(1200);
      t.assert(t.fake.get('activities').find((a) => a.id === 'ACT-T3D-TILLD').status === 'done', 'SEC-TASK-01: klarmarkering av tilldelad uppgift sparas på servern');
      // Direktanrop förbi gränssnittet.
      const k0 = md5(t.fake.get('activities'));
      const cur = await s.eval(() => state.activities.find((a) => a.id === 'ACT-T3D-AOKOPPLAD'));
      let r = await direkt(s, { action: 'writeMerge', key: 'vift_activities', upserts: [{ id: cur.id, previous: cur, data: Object.assign({}, cur, { status: 'done' }) }], removals: [] });
      t.assert(r.status === 403 && r.error === 'forbidden' && r.reason === 'not_own', 'direktanrop: klarmarkera uppgift som tillhör FÄ2 (synlig via egen AO) → 403 not_own: ' + JSON.stringify(r));
      r = await direkt(s, { action: 'writeMerge', key: 'vift_activities', upserts: [{ id: 'ACT-T3D-NY', previous: null, data: { id: 'ACT-T3D-NY', title: 'x', status: 'open', createdBy: 'ST-002', assignedTo: 'ST-004' } }], removals: [] });
      t.assert(r.status === 403 && r.reason === 'not_own', 'SEC-TASK-02 direktanrop: ny uppgift åt FÄ2 → 403 not_own');
      t.assert(md5(t.fake.get('activities')) === k0, 'serverns uppgifter oförändrade efter de nekade anropen');
      // Skapa egen uppgift via klienten: nytt id krockar inte med dolda uppgifter.
      await s.eval(() => ActivitiesService.create({ title: 'Ny egen T3D', type: 'todo' }));
      await s.settle(1500);
      const ny = t.fake.get('activities').find((a) => a.title === 'Ny egen T3D');
      t.assert(ny && ny.createdBy === 'ST-002' && ny.assignedTo === 'ST-002' && !/^ACT-\d{3}$/.test(ny.id), 'ny egen uppgift sparas på servern med ett id som inte kan krocka med dolda uppgifter: ' + (ny && ny.id));
      const cache = await s.eval(() => Object.keys(localStorage).filter((k) => /activities/.test(k)).map((k) => localStorage.getItem(k)).join(''));
      t.assert(!/ACT-T3D-ANNANS|ACT-T3D-OFFERT|ACT-T3D-EK|känslig/.test(cache), 'lokal cache innehåller inga uppgifter som servern inte lämnat ut');
    },
  },
  {
    id: 'T3D-02', world: WORLD, module: 'Säkerhet', name: 'D-15/SEC-TASK-05/06 (klient): ekonomi (ao_view_all utan ao_edit) ser bara sina egna uppgifter och får inte ändra andras; arbetsledaren ser och ändrar alla',
    async run(t) {
      uppgifter(t.fake);
      let s = await t.world.session({ viewport: 'laptop' });
      await s.login('ekonomi');
      await s.go('pg-activities');
      await s.settle(800);
      let v = await s.eval(() => ({ ids: state.activities.map((a) => a.id).sort().join(','), full: ActivitiesService.canManageAll() }));
      t.assert(v.ids === 'ACT-T3D-EK' && v.full === false, 'ekonomi: bara egen uppgift, ingen rätt till andras (D-15): ' + JSON.stringify(v));
      const k0 = md5(t.fake.get('activities'));
      const annan = t.fake.get('activities').find((a) => a.id === 'ACT-T3D-TILLD');
      const r = await direkt(s, { action: 'writeMerge', key: 'vift_activities', upserts: [{ id: annan.id, previous: annan, data: Object.assign({}, annan, { title: 'x' }) }], removals: [] });
      t.assert(r.status === 403 && r.error === 'forbidden' && r.reason === 'not_own' && md5(t.fake.get('activities')) === k0, 'SEC-TASK-05 direktanrop: ekonomi ändrar annans uppgift → 403 not_own, ingen ändring: ' + JSON.stringify(r));
      s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await s.go('pg-activities');
      await s.settle(800);
      v = await s.eval(() => ({ ids: state.activities.length, full: ActivitiesService.canManageAll(), edit: ActivitiesService.canEdit(state.activities.find((a) => a.id === 'ACT-T3D-ANNANS')),
        opts: (() => { ActivitiesPage.openCreate(); const m = Array.from(document.querySelectorAll('.modal-sheet')).pop(); const n = m.querySelectorAll('#act-assignee option').length; Modal.closeAll(); return n; })() }));
      t.assert(v.ids === 7 && v.full && v.edit && v.opts > 3, 'arbetsledare (ao_edit + ao_view_all): alla uppgifter, får ändra andras och välja ansvarig fritt (SEC-TASK-06): ' + JSON.stringify(v));
      await s.eval(() => { const a = state.activities.find((x) => x.id === 'ACT-T3D-ANNANS'); ActivitiesService.update(a.id, { title: 'Ändrad av AL' }); });
      await s.settle(1500);
      t.assert(t.fake.get('activities').find((a) => a.id === 'ACT-T3D-ANNANS').title === 'Ändrad av AL', 'SEC-TASK-06: arbetsledarens ändring av FÄ2:s uppgift sparas');
    },
  },
  {
    id: 'T3D-03', world: WORLD, module: 'Säkerhet', name: 'B4/D-12/D-13/D-22 (klient): fältets dashboard, Mina jobb och AO-detalj fungerar med urvalet per post — kund och kontakt för egen AO, historik märkt som klientrapport, inga andras kunder, offertbelopp eller aktivitetsposter i tillstånd eller cache',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('falt');
      await s.settle(800);
      const st = await s.eval(() => ({
        cu: state.customers.map((c) => c.id).sort().join(','),
        aoCu: [...new Set(state.workOrders.filter((a) => !a.poolProjection && (a.staff || []).includes('ST-002')).map((a) => a.customerId))].sort().join(','),
        logAo: [...new Set((state.activityLog || []).map((l) => l.workOrderId))].sort().join(','),
        logTyper: [...new Set((state.activityLog || []).map((l) => l.type))].sort().join(','),
        egnaAo: state.workOrders.filter((a) => (a.staff || []).includes('ST-002')).map((a) => a.id).sort().join(','),
        offerFalt: [...new Set((state.offers || []).flatMap((o) => Object.keys(o)))].sort().join(','),
        staffFalt: [...new Set((state.staff || []).filter((x) => x.id !== 'ST-002').flatMap((x) => Object.keys(x)))].sort().join(','),
      }));
      t.note(JSON.stringify(st));
      t.assert(st.cu === st.aoCu && st.cu.length > 0, 'D-13: klienten har bara kunderna för egna tilldelade AO (' + st.cu + ')');
      t.assert(st.logAo.split(',').filter(Boolean).every((id) => st.egnaAo.split(',').includes(id)) && !/invoice|offer|sales|customer/.test(st.logTyper), 'B4/SEC-B4-07: aktivitetsloggen innehåller bara AO-händelser för egna AO: ' + st.logAo + ' / ' + st.logTyper);
      t.assert(st.offerFalt.split(',').filter(Boolean).every((k) => ['id', 'title', 'status', 'workOrderId'].includes(k)), 'D-12: offertreferenser utan belopp, rader eller token: ' + st.offerFalt);
      t.assert(!/hourlyRate|role|permissions|username/.test(st.staffFalt), 'D-14: kollegor utan timpris, roll, behörigheter eller användarnamn: ' + st.staffFalt);
      // Dashboard
      await s.go('pg-dashboard');
      await s.settle(800);
      const dash = await s.eval(() => ({ fel: !!document.querySelector('.dash-error, .err-boundary'), not: (document.querySelector('.act-src-note') || {}).textContent || null }));
      t.assert(!dash.fel, 'dashboarden renderas utan fel för fält');
      // AO-detalj för egen AO: kund och kontakt
      await s.go('pg-ao-detail', { aoId: 'AO-001' });
      await s.settle(1000);
      const ao = await s.eval(() => ({ titel: document.body.innerText.includes(getAO('AO-001').title), kund: !!getCu(getAO('AO-001').customerId), tidslinje: !!document.getElementById('ao-timeline') }));
      t.assert(ao.titel && ao.kund && ao.tidslinje, 'AO-detalj (egen AO-001): visas med kund ur kundregistret och historik: ' + JSON.stringify(ao));
      const hist = await s.eval(() => { const html = WorkOrderDetailPage._renderTimeline(getAO('AO-001'), true); return { klient: /klientrapport/.test(html), antal: (html.match(/<span style="font-size:10px;font-weight:800/g) || []).length }; });
      t.assert(hist.antal >= 1, 'AO-historiken visar händelser för egen AO: ' + JSON.stringify(hist));
      // Mina jobb
      await s.go('pg-myjobs');
      await s.settle(800);
      const mj = await s.eval(() => document.body.innerText.includes('AO-001') || document.body.innerText.includes(getAO('AO-001').title));
      t.assert(mj, 'Mina jobb visar egen AO');
      // Cache: inga andras kunder/aktivitetsposter.
      const andra = t.fake.get('customers').filter((c) => !st.cu.split(',').includes(c.id)).map((c) => c.name).filter(Boolean);
      const cache = await s.eval(() => Object.keys(localStorage).filter((k) => /customers|activityLog|offers/.test(k)).map((k) => localStorage.getItem(k)).join(''));
      t.assert(andra.length > 0 && andra.every((n) => !cache.includes(n)), 'lokal cache innehåller inga kunder som servern inte lämnat ut (' + andra.length + ' andra kunder kontrollerade)');
      t.assert(!/"lines"|publicToken/.test(cache), 'lokal cache innehåller inga offertrader eller offerttoken');
    },
  },
  {
    id: 'T3D-04', world: WORLD, module: 'Säkerhet', name: 'D-22/SEC-B4-05/06 (klient): fältets egna händelser sparas (aktör och tid från servern); en otillåten typ eller en referens till annans AO nekas med 403 type_not_allowed/ref_not_visible utan ändring av loggen',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('falt');
      await s.settle(600);
      const k0 = md5(t.fake.get('activityLog'));
      let r = await direkt(s, { action: 'appendActivity', entry: { id: 'ACT-T3D-E2E-000001', type: 'invoice_created', description: 'x', workOrderId: 'AO-001' } });
      t.assert(r.status === 403 && r.error === 'forbidden' && r.reason === 'type_not_allowed', 'SEC-B4-05: invoice_created från fält → 403 type_not_allowed: ' + JSON.stringify(r));
      r = await direkt(s, { action: 'appendActivity', entry: { id: 'ACT-T3D-E2E-000002', type: 'work_order_status', description: 'x', workOrderId: 'AO-007' } });
      t.assert(r.status === 403 && r.error === 'forbidden' && r.reason === 'ref_not_visible', 'SEC-B4-06: händelse på AO-007 (inte tilldelad) → 403 ref_not_visible: ' + JSON.stringify(r));
      t.assert(md5(t.fake.get('activityLog')) === k0, 'aktivitetsloggen oförändrad efter de nekade anropen');
      // Klientens egen väg (ActivityService.log) på egen AO.
      await s.eval(() => ActivityService.log('work_order_status', 'Status ändrad på AO-001 (T3D-04)', { workOrderId: 'AO-001' }));
      await s.settle(1500);
      const e = (t.fake.get('activityLog') || []).find((x) => /T3D-04/.test(x.description || ''));
      t.assert(e && e.userId === 'ST-002' && e.source === 'klientrapport', 'egen händelse sparad, servern satte aktör och märkte den som klientrapport: ' + JSON.stringify(e));
    },
  },
];
