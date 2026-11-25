'use strict';
/*
 * T3-0: paritet faktisk server (lokal replik + EF i Node) ↔ simulerad server
 * (klientrepots tests/e2e/fake-backend.js), SEC-SIM-01 / SÄK-17.
 *
 *   const { korParitet, SCENARIER } = require('.../paritet')
 *   const res = await korParitet({ fakeBackend: '/home/user/VIFT-CRM/tests/e2e/fake-backend.js' })
 *   res = [{ id, beskrivning, replik: {status, error, extra}, fake: {...}, lika }]
 *
 * Varje scenario körs mot ett NYTT utgångsläge i båda (samma syntetiska data, lib/data.js):
 * replikan återställs (store, op_idempotency, stamp_status) och fake-backenden skapas på nytt.
 * Jämförs: HTTP-status, `error`, `reason` och ett scenariospecifikt utfall (t.ex. AO-id i en
 * lista eller AO:ns status efteråt). Den här modulen ändrar varken servern eller fake-backenden;
 * den kända avvikelselistan förs i klientrepot (tests/e2e/paritet-kanda-avvikelser.json).
 */
const { byggReplik } = require('./replik');
const { laddaEf } = require('./ef');
const { psql, val } = require('./db');
const { data } = require('./data');

const clone = (v) => JSON.parse(JSON.stringify(v));
const take = (aos, aoId, staffId) => { const a = aos.find((x) => x.id === aoId); return { staff: (a.staff || []).concat([staffId]), status: 'planerad', log: (a.log || []).concat([{ id: 'TAKE-' + staffId, type: 'taken_from_pool', text: 'Tog jobbet', timestamp: '2026-11-28T08:00:00.000Z' }]) }; };

/* Scenarier ur BEHORIGHETSMATRIS (SEC-AO, SEC-POOL, SEC-TASK, SEC-TID). `utfall(las)` får en
   funktion som läser ett store-värde i respektive backend efter anropet. */
const SCENARIER = [
  { id: 'AO-01', sec: 'SEC-AO-01/SEC-POOL-01', anv: 'falt', ef: 'work-orders-list', body: {}, utfall: (las, svar) => ((svar.body && svar.body.workOrders) || []).map((a) => a.id).sort().join(',') },
  { id: 'AO-02', sec: 'SEC-AO-02/SEC-POOL-03', anv: 'begransad', ef: 'work-orders-list', body: {}, utfall: (las, svar) => ((svar.body && svar.body.workOrders) || []).map((a) => a.id).sort().join(',') },
  { id: 'AO-04', sec: 'SEC-AO-04', anv: 'ekonomi', ef: 'work-orders-list', body: {}, utfall: (las, svar) => ((svar.body && svar.body.workOrders) || []).length + ' AO, accessCode ' + (((svar.body && svar.body.workOrders) || []).some((a) => 'accessCode' in a) ? 'med' : 'utan') },
  { id: 'AO-05', sec: 'SEC-AO-05 (SÄK-5)', anv: 'falt', ef: 'ao-time-write', body: { action: 'patch_ao', aoId: 'AO-A8', idempotencyKey: 'par-ao05', patch: { status: 'klar' } }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A8').status },
  { id: 'AO-06', sec: 'SEC-AO-06 (SÄK-5)', anv: 'falt', ef: 'ao-time-write', body: { action: 'patch_ao', aoId: 'AO-A9', idempotencyKey: 'par-ao06', patch: { status: 'klar' } }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A9').status },
  { id: 'AO-13', sec: 'SEC-AO-13', anv: 'falt', ef: 'ao-time-write', body: { action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-ao13', patch: { status: 'pågående', title: 'x' } }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A1').title },
  { id: 'AO-15', sec: 'SEC-AO-15 (SÄK-15)', anv: 'chef', ef: 'ao-time-write', body: { action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-ao15', patch: { status: 'fakturerad', invoiceId: 'INV-X' } }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A1').status },
  { id: 'AO-19', sec: 'SEC-AO-19', anv: 'falt', ef: 'ao-time-write', body: { action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-ao19', patch: { fixedPrice: 1 } }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A1').fixedPrice },
  { id: 'AO-17', sec: 'SEC-AO-17', anv: 'falt', ef: 'ao-time-write', body: { action: 'delete_ao', aoId: 'AO-A1', idempotencyKey: 'par-ao17' }, utfall: (las) => !!las('vift_workOrders').find((a) => a.id === 'AO-A1').deleted },
  { id: 'AO-10', sec: 'SEC-AO-10', anv: 'falt', ef: 'ao-time-write', body: { action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-ao10', patch: { status: 'pågående' } }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A1').status },
  { id: 'POOL-05', sec: 'SEC-POOL-05', anv: 'falt', ef: 'ao-time-write', body: (d) => ({ action: 'patch_ao', aoId: 'AO-P1', idempotencyKey: 'par-p05', patch: take(d.store.vift_workOrders, 'AO-P1', d.U.falt.staffId) }), utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-P1').staff.join(',') },
  { id: 'POOL-06', sec: 'SEC-POOL-06 (SÄK-4)', anv: 'falt', ef: 'ao-time-write', body: (d) => ({ action: 'patch_ao', aoId: 'AO-P2', idempotencyKey: 'par-p06', patch: take(d.store.vift_workOrders, 'AO-P2', d.U.falt.staffId) }), utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-P2').staff.join(',') },
  { id: 'POOL-10', sec: 'SEC-POOL-10', anv: 'begransad', ef: 'ao-time-write', body: (d) => ({ action: 'patch_ao', aoId: 'AO-P1', idempotencyKey: 'par-p10', patch: take(d.store.vift_workOrders, 'AO-P1', d.U.begransad.staffId) }), utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-P1').staff.join(',') },
  { id: 'POOL-11c', sec: 'SEC-POOL-11 checklista', anv: 'falt', ef: 'work-order-checklist-resolve', body: { aoId: 'AO-P1', itemId: 'AO-P1-C1', action: 'done' }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-P1').status },
  { id: 'POOL-11l', sec: 'SEC-POOL-11 logg', anv: 'falt', ef: 'work-order-log-write', body: { action: 'append_log', aoId: 'AO-P1', entry: { id: 'PAR-LOG-1', type: 'note', text: 'x' } }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-P1').log.length },
  { id: 'CHK-START', sec: 'SÄK-17 (checklistan startar AO)', anv: 'falt', ef: 'work-order-checklist-resolve', body: { aoId: 'AO-A1', itemId: 'AO-A1-C1', action: 'done' }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A1').status },
  { id: 'CHK-LEGACY', sec: 'SÄK-17 (checklistan startar AO, äldre kontrakt)', anv: 'falt', ef: 'work-order-checklist-resolve', fakeOpts: { checklistLegacy: true }, body: { aoId: 'AO-A1', itemId: 'AO-A1-C1', avvikelse: 'ok' }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A1').status },
  { id: 'TID-01', sec: 'SEC-TID (SÄK-11)', anv: 'falt', ef: 'ao-time-write', body: { action: 'create_time', idempotencyKey: 'par-t01', entry: { id: 'TE-PAR-1', aoId: 'AO-A8', date: '2026-11-24', hours: 1 } }, utfall: (las) => !!las('vift_timeEntries').find((t) => t.id === 'TE-PAR-1') },
  { id: 'TID-02', sec: 'SEC-TID-01', anv: 'begransad', ef: 'ao-time-write', body: { action: 'create_time', idempotencyKey: 'par-t02', entry: { id: 'TE-PAR-2', aoId: 'AO-A1', date: '2026-11-24', hours: 1 } }, utfall: (las) => !!las('vift_timeEntries').find((t) => t.id === 'TE-PAR-2') },
  { id: 'TID-LIST', sec: 'SEC-TID', anv: 'falt', ef: 'time-entries-list', body: {}, utfall: (las, svar) => ((svar.body && svar.body.timeEntries) || []).map((t) => t.id).sort().join(',') },
  { id: 'STAMP-01', sec: 'SEC-POOL-11 stämpling (SÄK-11)', anv: 'falt', ef: 'store-key-write', body: { action: 'setStampStatus', active: true, ts: 1764000000000, aoId: 'AO-A8', expectedRevision: 0 }, utfall: (las, svar) => (svar.body && svar.body.active) === true },
  { id: 'TASK-01', sec: 'SEC-TASK (SÄK-2)', anv: 'falt', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_activities'] }, utfall: (las, svar) => ((svar.body && svar.body.data && svar.body.data.activities) || []).map((t) => t.id).sort().join(',') },
  { id: 'KEY-01', sec: 'SEC-AO-03', anv: 'falt', ef: 'store-key-write', body: { action: 'readWithHash', key: 'vift_workOrders' }, utfall: () => '' },
  { id: 'ROLL-01', sec: 'SEC-ROLL-01 (SÄK-8)', anv: 'personalansvarig', ef: 'store-key-write', body: (d) => { const el = d.store.vift_staff.find((x) => x.id === d.U.personalansvarig.staffId); return { action: 'writeMerge', key: 'vift_staff', upserts: [{ id: el.id, data: Object.assign({}, el, { role: 'admin' }), previous: el }], removals: [] }; }, utfall: (las, svar, d) => las('vift_staff').find((x) => x.id === d.U.personalansvarig.staffId).role },
  { id: 'IDEM-01', sec: 'SEC-AO-20 (SÄK-12)', anv: 'chef', ef: 'ao-time-write', fore: { action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-idem', patch: { title: 'Första' } }, body: { action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-idem', patch: { title: 'Annan' } }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A1').title },
  { id: 'FAKT-01', sec: 'SEC-FAKT (stale)', anv: 'chef', ef: 'invoice-write', body: { action: 'lineAdd', invoiceId: 'INV-R2', expectedRevision: 5, line: { id: 'PL1', description: 'x', qty: 1, unitPrice: 1, vatRate: 25 } }, utfall: (las) => las('vift_invoices').find((i) => i.id === 'INV-R2').lines.length },
  { id: 'FAKT-02', sec: 'SEC-CUST-04', anv: 'chef_utan_faktura', ef: 'invoice-write', body: { action: 'lineAdd', invoiceId: 'INV-R2', expectedRevision: 0, line: { id: 'PL2', description: 'x', qty: 1, unitPrice: 1, vatRate: 25 } }, utfall: (las) => las('vift_invoices').find((i) => i.id === 'INV-R2').lines.length },
  { id: 'AUTH-01', sec: 'SEC-CUST-23', anv: 'okandroll', ef: 'work-orders-list', body: {}, utfall: (las, svar) => ((svar.body && svar.body.workOrders) || []).length },
  { id: 'AUTH-02', sec: 'inaktiv personal', anv: 'inaktivpersonal', ef: 'work-orders-list', body: {}, utfall: () => '' },
];
/* Samma världsinställning som tests/staging_e2e_real.test.js (STAGING-lik simulerad server). */
const FAKE_STD = { logOps: true, activityAppend: true, activitiesPolicy: true };
const EF_LISTA = ['work-orders-list', 'ao-time-write', 'work-order-checklist-resolve', 'work-order-log-write', 'time-entries-list', 'store-key-write', 'invoice-write'];

function svarAv(s) { const b = s.body || {}; return { status: s.status, error: b.error === undefined ? null : b.error, reason: b.reason === undefined ? null : b.reason }; }

async function korParitet(opts) {
  opts = opts || {};
  const Fake = require(opts.fakeBackend);
  const FakeSupabase = Fake.FakeSupabase || Fake;
  const r = byggReplik({ schemakontroll: false });
  const ut = [];
  try {
    psql(r.db, `create table public._paritet_bas as select * from public.store; create table public._paritet_idem as select * from public.op_idempotency;`);
    const ef = await laddaEf(r.db, EF_LISTA, opts);
    const aterstall = () => psql(r.db, `begin; delete from public.store; insert into public.store select * from public._paritet_bas; delete from public.op_idempotency; insert into public.op_idempotency select * from public._paritet_idem; delete from public.stamp_status; commit;`);
    for (const sc of SCENARIER) {
      const d = data();
      const body = typeof sc.body === 'function' ? sc.body(d) : sc.body;
      // ── replik ──
      aterstall();
      if (sc.fore) await ef.anropa(sc.ef, { user: d.U[sc.anv], body: sc.fore });
      const rs = await ef.anropa(sc.ef, { user: d.U[sc.anv], body });
      const rUtfall = sc.utfall((k) => val(r.db, k), rs, d);
      // ── fake ──
      const fake = new FakeSupabase(Object.assign({}, FAKE_STD, sc.fakeOpts || {}));
      fake.store = new Map(Object.entries(clone(d.store)));
      fake.users = {};
      d.anvandare.forEach((u) => { fake.users[u.email] = { id: u.authId, email: u.email, password: 'replik', alias: u.alias, active: u.appActive }; });
      const tok = fake.issue(fake.users[d.U[sc.anv].email]).access_token;
      const anropaFake = async (b) => { const x = await fake.handle('POST', 'http://fake.lokal/functions/v1/' + sc.ef, { authorization: 'Bearer ' + tok }, JSON.stringify(b)); return { status: x.status, body: x.body }; };
      if (sc.fore) await anropaFake(sc.fore);
      const fs_ = await anropaFake(body);
      let fUtfall; try { fUtfall = sc.utfall((k) => clone(fake.store.get(k)), fs_, d); } catch (e) { fUtfall = 'fel: ' + e.message; }
      const R = Object.assign(svarAv(rs), { utfall: rUtfall }), F = Object.assign(svarAv(fs_), { utfall: fUtfall });
      ut.push({ id: sc.id, sec: sc.sec, anv: sc.anv, ef: sc.ef, replik: R, fake: F, lika: JSON.stringify(R) === JSON.stringify(F) });
    }
  } finally { r.stang(); }
  return ut;
}

module.exports = { korParitet, SCENARIER, FAKE_STD };
