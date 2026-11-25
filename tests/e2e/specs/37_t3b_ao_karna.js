'use strict';
/* T3-B (2026-11-28): AO-kärnan och arbetspoolen i klienten mot den simulerade servern,
   som följer T3-B-reglerna (paritet: tests/sim_parity.test.js).
   - AP-FEL-1/AP-G: personaldialogen ändrar bara personal och ansvarig; ingen poolruta;
     notis/push bara för faktiskt tillagd personal och först efter serverbekräftelse.
   - "Ta bort datum" och "Släpp till öppen pool" som separata, uttryckliga åtgärder.
   - "Ta jobbet" via take_from_pool; 409 already_assigned ger begripligt besked, ingen
     lokal mutation och omläst lista.
   - D-07/F21: faktureringsstatus kan inte sättas via patch_ao (klienten backar och säger det).
   - AP-B: instämplingslistan visar bara egna tilldelade AO. */

const STAFF = { admin: 'ST-001', chef: 'ST-003', falt: 'ST-002', falt2: 'ST-004' };

function seed(t) {
  const aos = t.fake.get('workOrders').filter((a) => !/^AO-T3B/.test(a.id));
  const base = aos.find((a) => a.id === 'AO-007');
  const mk = (id, x) => Object.assign(JSON.parse(JSON.stringify(base)), {
    id, displayNumber: id, log: [{ id: id + '-L0', type: 'note', text: 'start', timestamp: '2026-11-01T08:00:00.000Z' }], materials: [], invoiceId: '',
    archived: false, deleted: false, substatus: '', offerId: '', recurringOrderId: '', responsibleStaffId: '',
  }, x);
  aos.push(
    mk('AO-T3B-POOL', { status: 'pool', staff: [], scheduledDate: '2026-12-15', title: 'T3B öppen pool' }),
    mk('AO-T3B-PLAN', { status: 'planerad', staff: [STAFF.falt], responsibleStaffId: STAFF.falt, scheduledDate: '2026-12-01', scheduledStart: '08:00', title: 'T3B planerad' }),
    mk('AO-T3B-TA', { status: 'pool', staff: [], scheduledDate: '', title: 'T3B ta jobbet' }),
    mk('AO-T3B-ANNAN', { status: 'planerad', staff: [STAFF.falt2], scheduledDate: '2026-12-02', title: 'T3B annans' }),
  );
  t.fake.set('workOrders', aos);
}
const srv = (t, id) => t.fake.get('workOrders').find((a) => a.id === id);
async function waitSrv(s, t, id, pred) {
  for (let i = 0; i < 60; i++) { const a = srv(t, id); if (a && pred(a)) return a; await s.settle(100); }
  return srv(t, id);
}
async function openAO(s, id) {
  await s.go('pg-ao-detail', { aoId: id });
  await s.page.waitForFunction((x) => WorkOrderDetailPage.aoId === x && document.querySelector('.page.active .aod-actbar'), id, { timeout: 8000 });
}

module.exports = [
  {
    id: 'T3B-01', kind: 'workflow', module: 'Arbetsordrar', name: 'AP-FEL-1: personaldialogen på en pool-AO — ingen poolruta; bara personal och ansvarig ändras; status och datum oförändrade; notis bara till faktiskt tillagd personal efter serverbekräftelse; borttagning ger ingen notis och AO:n återvänder inte till öppen pool',
    async run(t) {
      seed(t);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await openAO(s, 'AO-T3B-POOL');
      await s.eval(() => { window.__t3bPush = []; const o = NotificationsService.push; NotificationsService.push = function (id) { window.__t3bPush.push(id); return o.apply(this, arguments); }; });
      await s.eval(() => WorkOrderDetailPage.manageStaff('AO-T3B-POOL'));
      await s.page.waitForSelector('.modal-overlay.open #sm-resp');
      t.assert(!(await s.eval(() => !!document.getElementById('sm-pool'))), 'ingen ruta "Flytta till arbetspool" i personaldialogen');
      await s.page.check('#smcb-' + STAFF.falt);
      await s.clickModalButton(/^Spara$/);
      await s.waitToast(/Personal uppdaterad/, 8000);
      const a = await waitSrv(s, t, 'AO-T3B-POOL', (x) => (x.staff || []).length === 1);
      t.assert(JSON.stringify(a.staff) === JSON.stringify([STAFF.falt]) && a.status === 'pool' && a.scheduledDate === '2026-12-15' && a.poolOpen === false,
        'servern: staff=[fält], status och datum oförändrade, poolOpen=false: ' + JSON.stringify({ staff: a.staff, st: a.status, d: a.scheduledDate, po: a.poolOpen }));
      await s.settle(300);
      t.assert(JSON.stringify(await s.eval(() => window.__t3bPush)) === JSON.stringify([STAFF.falt]), 'exakt en tilldelningsnotis, till den tillagda: ' + JSON.stringify(await s.eval(() => window.__t3bPush)));
      t.assert((a.log || []).some((l) => l.type === 'staff_added') && !(a.log || []).some((l) => l.type === 'staff_changed'), 'loggposten staff_added (inte "flyttade till arbetspoolen")');
      // Ta bort personalen igen: ingen notis, och AO:n är inte öppen pool (poolOpen=false).
      await s.eval(() => { window.__t3bPush = []; });
      await s.eval(() => WorkOrderDetailPage.manageStaff('AO-T3B-POOL'));
      await s.page.waitForSelector('.modal-overlay.open #sm-resp');
      await s.page.uncheck('#smcb-' + STAFF.falt);
      await s.clickModalButton(/^Spara$/);
      await s.waitToast(/Personal uppdaterad/, 8000);
      const b = await waitSrv(s, t, 'AO-T3B-POOL', (x) => !(x.staff || []).length);
      t.assert(!(b.staff || []).length && b.status === 'pool' && b.poolOpen === false && b.scheduledDate === '2026-12-15', 'borttagen personal: status/datum oförändrade, poolOpen kvar false');
      t.assert((await s.eval(() => window.__t3bPush)).length === 0, 'ingen notis vid borttagning');
      const f = await t.world.session({ viewport: 'iphone' });
      await f.login('falt2');
      const ids = await f.eval(() => state.workOrders.map((x) => x.id));
      t.assert(!ids.includes('AO-T3B-POOL'), 'AO:n återvände inte till öppen pool (fält2 ser den inte)');
      await f.context.close(); await s.context.close();
    },
  },
  {
    id: 'T3B-02', kind: 'workflow', module: 'Arbetsordrar', name: 'AP-G: "Ta bort datum" rensar bara datumet; "Släpp till öppen pool" kräver bekräftelse, tar bort personal och datum och sätter öppen pool',
    async run(t) {
      seed(t);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await openAO(s, 'AO-T3B-PLAN');
      const acts = await s.eval(() => [...document.querySelectorAll('.page.active [data-act]')].map((e) => e.dataset.act));
      t.assert(acts.includes('remove-date') && acts.includes('release-pool'), 'åtgärderna finns i menyn: ' + acts.join(','));
      await s.eval(() => WorkOrderDetailPage.removeSchedule());
      await s.clickModalButton(/Bekräfta/);
      await s.waitToast(/Datumet borttaget/, 8000);
      const a = await waitSrv(s, t, 'AO-T3B-PLAN', (x) => !x.scheduledDate);
      t.assert(!a.scheduledDate && !a.scheduledStart && JSON.stringify(a.staff) === JSON.stringify([STAFF.falt]) && a.responsibleStaffId === STAFF.falt && a.status === 'planerad',
        'Ta bort datum: bara datumfälten rensade, personal/ansvarig/status oförändrade: ' + JSON.stringify({ d: a.scheduledDate, staff: a.staff, r: a.responsibleStaffId, st: a.status }));
      t.assert((a.log || []).some((l) => l.type === 'schedule_removed'), 'loggposten schedule_removed');
      await s.settle(400);
      await s.eval(() => WorkOrderDetailPage.releaseToPool());
      await s.page.waitForSelector('.modal-overlay.open', { timeout: 5000 });
      const txt = await s.eval(() => (document.querySelector('.modal-overlay.open') || {}).textContent || '');
      t.assert(/öppen pool/.test(txt) && /Personal som tas bort/.test(txt), 'bekräftelsen namnger personalen: ' + txt.slice(0, 160));
      await s.clickModalButton(/Bekräfta/);
      await s.waitToast(/Släppt till öppen pool/, 8000);
      const b = await waitSrv(s, t, 'AO-T3B-PLAN', (x) => x.status === 'pool');
      t.assert(b.status === 'pool' && b.poolOpen === true && !(b.staff || []).length && !b.responsibleStaffId && !b.scheduledDate, 'Släpp till öppen pool: status pool, poolOpen=true, ingen personal eller datum');
      t.assert((b.log || []).some((l) => l.type === 'released_to_pool') && (b.log || []).some((l) => l.type === 'staff_removed'), 'loggposterna released_to_pool och staff_removed');
      await s.context.close();
    },
  },
  {
    id: 'T3B-03', kind: 'workflow', module: 'Mina jobb', name: 'SÄK-4: "Ta jobbet" när någon annan hunnit först → besked "redan tagits", ingen lokal tilldelning, servern orörd, listan omläst',
    async run(t) {
      seed(t);
      const f = await t.world.session({ viewport: 'iphone' });
      await f.login('falt');
      await f.go('pg-myjobs');
      await f.eval(() => MyJobsPage.setView('pool'));
      await f.settle(300);
      t.assert(await f.eval(() => !!document.querySelector('.page.active .mj-card[data-ao="AO-T3B-TA"]')), 'jobbet syns i Arbetspool');
      // Fält2 tar jobbet på servern (annan enhet) innan fält klickar.
      const aos = t.fake.get('workOrders'); const x = aos.find((a) => a.id === 'AO-T3B-TA');
      Object.assign(x, { staff: [STAFF.falt2], status: 'planerad', poolOpen: false }); t.fake.set('workOrders', aos);
      const fore = JSON.stringify(srv(t, 'AO-T3B-TA'));
      await f.page.locator('.page.active .mj-card[data-ao="AO-T3B-TA"] button', { hasText: 'Ta jobbet' }).click();
      await f.waitToast(/redan tagits/, 8000);
      t.assert(JSON.stringify(srv(t, 'AO-T3B-TA')) === fore, 'servern oförändrad (409 already_assigned, ingen mutation)');
      const call = t.fake.calls.filter((c) => c.action === 'ao-time-write:take_from_pool' && c.aoId === 'AO-T3B-TA').pop();
      t.assert(call && call.status === 409, 'take_from_pool svarade 409: ' + JSON.stringify(call && call.status));
      await f.settle(500);
      const lok = await f.eval(() => { const a = getAO('AO-T3B-TA'); return a ? { staff: a.staff } : null; });
      t.assert(!lok || !(lok.staff || []).includes(STAFF.falt), 'ingen lokal tilldelning till fält: ' + JSON.stringify(lok));
      t.assert(!(await f.eval(() => !!document.querySelector('.page.active .mj-card[data-ao="AO-T3B-TA"]'))), 'jobbet borta ur poolvyn efter omläsning');
      await f.context.close();
    },
  },
  {
    id: 'T3B-04', kind: 'contract', module: 'Användarroller och behörigheter', name: 'D-07/F21: arbetsledare kan inte sätta status fakturerad via AO-ändring — servern nekar (invoice_path_required) och klienten backar och säger det',
    async run(t) {
      seed(t);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await openAO(s, 'AO-T3B-ANNAN');
      const fore = JSON.stringify(srv(t, 'AO-T3B-ANNAN'));
      const r = await s.eval(() => AOTimeSyncService._call({ action: 'patch_ao', aoId: 'AO-T3B-ANNAN', patch: { status: 'fakturerad', invoiceId: 'FU-FALSK' }, idempotencyKey: 'f21-' + Date.now() }));
      t.assert(r.ok === false && r.httpStatus === 403 && r.error === 'forbidden' && r.reason === 'invoice_path_required', 'patch_ao nekas med forbidden/invoice_path_required: ' + JSON.stringify(r));
      t.assert(JSON.stringify(srv(t, 'AO-T3B-ANNAN')) === fore, 'servern oförändrad');
      t.assert(await s.eval(() => WorkOrderService.serverErrorText('forbidden', 'invoice_path_required')) === 'Faktureringsstatus ändras bara via fakturaunderlaget.', 'begripligt felbesked för reason');
      await s.context.close();
    },
  },
  {
    id: 'T3B-05', kind: 'workflow', module: 'Tidregistrering och instämpling', name: 'AP-B: instämplingslistan visar bara egna tilldelade AO; instämpling på annans AO nekas av servern med not_assigned och ingen stämpling sparas',
    async run(t) {
      seed(t);
      const f = await t.world.session({ viewport: 'iphone' });
      await f.login('falt');
      await f.go('pg-tid');
      await f.eval(() => TimePage.openClockIn());
      await f.page.waitForSelector('.modal-overlay.open #ci-ao');
      const opts = await f.eval(() => [...document.querySelectorAll('#ci-ao option')].map((o) => o.value).filter(Boolean));
      const alla = await f.eval((o) => o.every((id) => { const a = getAO(id); return a && (a.staff || []).includes('ST-002'); }), opts);
      t.assert(opts.length > 0 && alla && !opts.includes('AO-T3B-ANNAN') && !opts.includes('AO-T3B-TA'), 'bara egna tilldelade AO i listan: ' + opts.join(','));
      await f.page.keyboard.press('Escape').catch(() => {});
      const r = await f.eval(() => fetch(SUPABASE_URL + '/functions/v1/store-key-write', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_AKEY, Authorization: 'Bearer ' + Auth.getAccessToken() }, body: JSON.stringify({ action: 'setStampStatus', active: true, ts: Date.now(), aoId: 'AO-T3B-ANNAN', expectedRevision: 0 }) }).then(async (x) => ({ status: x.status, body: await x.json() })));
      t.assert(r.status === 403 && r.body.error === 'forbidden' && r.body.reason === 'not_assigned', 'servern nekar instämpling på annans AO: ' + JSON.stringify(r));
      t.assert(!(t.fake.stamp.get('falt1@example.test') || {}).active, 'ingen stämpling sparad');
      await f.context.close();
    },
  },
];
