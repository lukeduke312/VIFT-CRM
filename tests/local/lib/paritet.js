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
const { psql, val, asUser, lit, jlit } = require('./db');
const { data } = require('./data');

const clone = (v) => JSON.parse(JSON.stringify(v));
const utan = (e, f) => Object.fromEntries(Object.entries(e).filter(([k]) => !f.includes(k)));
/* JSON med sorterade nycklar (jsonb sorterar, fake behåller insättningsordningen). */
const kanon = (v) => JSON.stringify(v === undefined ? null : v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x));
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
  // ── T3-B (2026-11-28): nya regler, samma utfall krävs i replik och fake ──
  { id: 'POOL-T1', sec: 'SEC-POOL-05 (take_from_pool)', anv: 'falt', ef: 'ao-time-write', body: { action: 'take_from_pool', aoId: 'AO-P1', idempotencyKey: 'par-t1' }, utfall: (las) => { const a = las('vift_workOrders').find((x) => x.id === 'AO-P1'); return [a.staff.join(','), a.status, a.poolOpen, a.log.filter((l) => l.type === 'taken_from_pool').length].join('|'); } },
  { id: 'POOL-T2', sec: 'SEC-POOL-06 (take_from_pool)', anv: 'falt', ef: 'ao-time-write', body: { action: 'take_from_pool', aoId: 'AO-P2', idempotencyKey: 'par-t2' }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-P2').staff.join(',') },
  { id: 'POOL-T3', sec: 'SEC-POOL-07 (N2)', anv: 'falt', ef: 'ao-time-write', body: { action: 'take_from_pool', aoId: 'AO-N2', idempotencyKey: 'par-t3' }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-N2').staff.join(',') },
  { id: 'POOL-T4', sec: 'SEC-POOL-07 (P5 arkiverad)', anv: 'falt', ef: 'ao-time-write', body: { action: 'take_from_pool', aoId: 'AO-P5', idempotencyKey: 'par-t4' }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-P5').staff.join(',') },
  { id: 'POOL-T5', sec: 'SEC-POOL-10 (begränsad)', anv: 'begransad', ef: 'ao-time-write', body: { action: 'take_from_pool', aoId: 'AO-P1', idempotencyKey: 'par-t5' }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-P1').staff.join(',') },
  { id: 'POOL-PROJ', sec: 'SEC-POOL-04 (K-03)', anv: 'falt', ef: 'work-orders-list', body: {}, utfall: (las, svar) => { const a = ((svar.body && svar.body.workOrders) || []).find((x) => x.id === 'AO-P1') || {}; return Object.keys(a).sort().join(',') + '|' + a.dueDate; } },
  { id: 'AO-07', sec: 'SEC-AO-07 (avbruten)', anv: 'falt', ef: 'ao-time-write', body: { action: 'patch_ao', aoId: 'AO-A5', idempotencyKey: 'par-ao07', patch: { status: 'klar' } }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A5').status },
  { id: 'AO-08', sec: 'SEC-AO-08/09', anv: 'falt', ef: 'ao-time-write', body: { action: 'patch_ao', aoId: 'AO-A2', idempotencyKey: 'par-ao08', patch: { status: 'klar', completedBy: 'ST-R05', completedAt: '2000-01-01T00:00:00.000Z' } }, utfall: (las, svar) => { const a = las('vift_workOrders').find((x) => x.id === 'AO-A2'); return [a.status, a.completedBy, String(a.completedAt).slice(0, 2), JSON.stringify((svar.body || {}).ignoredFields)].join('|'); } },
  { id: 'AO-12', sec: 'SEC-AO-12', anv: 'falt', ef: 'ao-time-write', body: { action: 'patch_ao', aoId: 'AO-A3', idempotencyKey: 'par-ao12', patch: { status: 'pågående' } }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A3').status },
  { id: 'AO-15b', sec: 'SEC-AO-15 (backa fakturerad)', anv: 'admin', ef: 'ao-time-write', body: { action: 'patch_ao', aoId: 'AO-A9', idempotencyKey: 'par-ao15b', patch: { status: 'klar' } }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A9').status },
  /* T4-A: MAT-01/02 skickar raderna så som fältet läser dem (utan inköpspris, projicerat); den äldre
     formen med inköpspris prövas i T4-MAT-GAMMAL nedan. */
  { id: 'MAT-01', sec: 'SEC-B1-05 (annans rad)', anv: 'falt', ef: 'ao-time-write', body: (d) => ({ action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-mat1', patch: { materials: [Object.assign(utan(d.store.vift_workOrders.find((a) => a.id === 'AO-A1').materials[0], ['buyPrice']), { qty: 9 })] } }), utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A1').materials[0].qty },
  { id: 'MAT-02', sec: 'SEC-B1-01 (egen rad)', anv: 'falt', ef: 'ao-time-write', body: (d) => ({ action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-mat2', patch: { materials: d.store.vift_workOrders.find((a) => a.id === 'AO-A1').materials.map((m) => utan(m, ['buyPrice'])).concat([{ id: 'M-PAR', name: 'x', qty: 1 }]) } }), utfall: (las) => { const m = las('vift_workOrders').find((a) => a.id === 'AO-A1').materials.find((x) => x.id === 'M-PAR'); return m ? m.addedBy : null; } },
  { id: 'TID-03', sec: 'SEC-TID (ao_locked)', anv: 'falt', ef: 'ao-time-write', body: { action: 'create_time', idempotencyKey: 'par-t03', entry: { id: 'TE-PAR-3', aoId: 'AO-A9', date: '2026-11-24', minutes: 60 } }, utfall: (las) => !!las('vift_timeEntries').find((t) => t.id === 'TE-PAR-3') },
  { id: 'TID-04', sec: 'SEC-TID-02 (påhittat aoId)', anv: 'falt', ef: 'ao-time-write', body: { action: 'create_time', idempotencyKey: 'par-t04', entry: { id: 'TE-PAR-4', aoId: 'AO-FINNS-INTE', date: '2026-11-24', minutes: 60 } }, utfall: (las) => !!las('vift_timeEntries').find((t) => t.id === 'TE-PAR-4') },
  { id: 'TID-05', sec: 'SEC-B2-03 (hourRate)', anv: 'falt', ef: 'ao-time-write', body: { action: 'create_time', idempotencyKey: 'par-t05', entry: { id: 'TE-PAR-5', aoId: 'AO-A1', date: '2026-11-24', minutes: 60, hourRate: 9999 } }, utfall: (las, svar) => { const t = las('vift_timeEntries').find((x) => x.id === 'TE-PAR-5'); return [t && t.hourRate, JSON.stringify((svar.body || {}).ignoredFields), las('vift_workOrders').find((a) => a.id === 'AO-A1').timeEntries.includes('TE-PAR-5')].join('|'); } },
  { id: 'STAMP-02', sec: 'SEC-TID-03 (aoId finns inte)', anv: 'falt', ef: 'store-key-write', body: { action: 'setStampStatus', active: true, ts: 1764000000000, aoId: 'AO-FINNS-INTE', expectedRevision: 0 }, utfall: () => '' },
  { id: 'STAMP-03', sec: 'stämpling på egen låst AO', anv: 'falt', ef: 'store-key-write', body: { action: 'setStampStatus', active: true, ts: 1764000000000, aoId: 'AO-A9', expectedRevision: 0 }, utfall: () => '' },
  { id: 'STAMP-04', sec: 'stämpling på egen AO', anv: 'falt', ef: 'store-key-write', body: { action: 'setStampStatus', active: true, ts: 1764000000000, aoId: 'AO-A1', expectedRevision: 0 }, utfall: (las, svar) => [svar.body && svar.body.active, svar.body && svar.body.aoId].join('|') },
  { id: 'CHK-P2', sec: 'SEC-POOL-12 checklista', anv: 'falt', ef: 'work-order-checklist-resolve', body: { aoId: 'AO-P2', itemId: 'AO-P2-C1', action: 'done' }, utfall: (las) => !!las('vift_workOrders').find((a) => a.id === 'AO-P2').checklist[0].done },
  { id: 'CHK-A9', sec: 'checklista på egen låst AO', anv: 'falt', ef: 'work-order-checklist-resolve', body: { aoId: 'AO-A9', itemId: 'AO-A9-C1', action: 'done' }, utfall: (las) => !!las('vift_workOrders').find((a) => a.id === 'AO-A9').checklist[0].done },
  { id: 'LOG-A9', sec: 'logg på egen låst AO', anv: 'falt', ef: 'work-order-log-write', body: { action: 'append_log', aoId: 'AO-A9', entry: { id: 'PAR-LOG-9', type: 'note', text: 'x' } }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A9').log.length },
  { id: 'IDEM-02', sec: 'SÄK-12 (annan aktör)', anv: 'admin', ef: 'ao-time-write', foreAnv: 'chef', fore: { action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-idem2', patch: { title: 'Första' } }, body: { action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-idem2', patch: { title: 'Första' } }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A1').title },
  { id: 'BILL-01', sec: 'D-07 (underlag hänvisar inte till AO)', anv: 'chef', ef: 'invoice-write', body: { action: 'aoBilling', aoId: 'AO-A1', invoiceId: 'INV-R1', mode: 'invoiced' }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A1').status },
  { id: 'BILL-02', sec: 'D-07 (restore av äldre fakturerad)', anv: 'chef', ef: 'invoice-write', body: { action: 'aoBilling', aoId: 'AO-A9', mode: 'restore' }, utfall: (las, svar) => las('vift_workOrders').find((a) => a.id === 'AO-A9').status + '|' + (svar.body && svar.body.noop) },
  { id: 'BILL-03', sec: 'D-07 (fält)', anv: 'falt', ef: 'invoice-write', body: { action: 'aoBilling', aoId: 'AO-A3', invoiceId: 'INV-R1', mode: 'invoiced' }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A3').status },
  { id: 'AUTH-01', sec: 'SEC-CUST-23', anv: 'okandroll', ef: 'work-orders-list', body: {}, utfall: (las, svar) => ((svar.body && svar.body.workOrders) || []).length },
  { id: 'AUTH-02', sec: 'inaktiv personal', anv: 'inaktivpersonal', ef: 'work-orders-list', body: {}, utfall: () => '' },
  // ── T3-C (2026-11-28): roller och superadmin (SÄK-8, D-25), projektion (D-21, D-14), F18 ──
  { id: 'ROLL-02a', sec: 'SEC-ROLL-02 (all)', anv: 'personalansvarig', ef: 'store-key-write', body: (d) => mergeStaff(d, d.U.falt.staffId, { role: 'admin' }), utfall: (las, svar, d) => las('vift_staff').find((x) => x.id === d.U.falt.staffId).role },
  { id: 'ROLL-02b', sec: 'SEC-ROLL-02 (utöver anroparen)', anv: 'personalansvarig', ef: 'store-key-write', body: (d) => mergeStaff(d, d.U.falt.staffId, { role: 'chef' }), utfall: (las, svar, d) => las('vift_staff').find((x) => x.id === d.U.falt.staffId).role },
  { id: 'ROLL-02c', sec: 'SEC-CUST-18 (+)', anv: 'personalansvarig', ef: 'store-key-write', body: (d) => mergeStaff(d, d.U.falt.staffId, { role: 'tom' }), utfall: (las, svar, d) => las('vift_staff').find((x) => x.id === d.U.falt.staffId).role },
  { id: 'ROLL-02d', sec: 'SEC-ROLL-02 (inaktivera superadmin)', anv: 'personalansvarig', ef: 'store-key-write', body: (d) => mergeStaff(d, d.U.admin.staffId, { active: false }), utfall: (las, svar, d) => las('vift_staff').find((x) => x.id === d.U.admin.staffId).active },
  { id: 'ROLL-03a', sec: 'SEC-ROLL-03 (all i roll)', anv: 'adminhanterare', ef: 'store-key-write', body: (d) => mergeRole(d, 'tom', ['all']), utfall: (las) => las('vift_roles').find((x) => x.id === 'tom').permissions.join(',') },
  { id: 'ROLL-03b', sec: 'SEC-ROLL-03 (egen roll)', anv: 'adminhanterare', ef: 'store-key-write', body: (d) => mergeRole(d, 'adminhanterare', ['dashboard_view', 'admin_manage', 'staff_manage']), utfall: (las) => las('vift_roles').find((x) => x.id === 'adminhanterare').permissions.join(',') },
  { id: 'ROLL-03c', sec: 'SEC-ROLL-03 (utöver anroparen)', anv: 'adminhanterare', ef: 'store-key-write', body: (d) => mergeRole(d, 'tom', ['ao_view_all']), utfall: (las) => las('vift_roles').find((x) => x.id === 'tom').permissions.join(',') },
  { id: 'ROLL-03d', sec: 'SEC-CUST-19 (+)', anv: 'adminhanterare', ef: 'store-key-write', body: (d) => mergeRole(d, 'tom', ['dashboard_view']), utfall: (las) => las('vift_roles').find((x) => x.id === 'tom').permissions.join(',') },
  { id: 'ROLL-03e', sec: 'D-25 (admin_manage skriver personal)', anv: 'adminhanterare', ef: 'store-key-write', body: (d) => mergeStaff(d, d.U.falt.staffId, { role: 'tom' }), utfall: (las, svar, d) => las('vift_staff').find((x) => x.id === d.U.falt.staffId).role },
  { id: 'ROLL-04a', sec: 'SEC-ROLL-04 (inaktivera sig själv)', anv: 'admin', ef: 'store-key-write', body: (d) => mergeStaff(d, d.U.admin.staffId, { active: false }), utfall: (las, svar, d) => las('vift_staff').find((x) => x.id === d.U.admin.staffId).active },
  { id: 'ROLL-04b', sec: 'SEC-ROLL-04 (all ur rollen)', anv: 'admin', ef: 'store-key-write', body: (d) => mergeRole(d, 'admin', ['admin_manage']), utfall: (las) => las('vift_roles').find((x) => x.id === 'admin').permissions.join(',') },
  { id: 'ROLL-04c', sec: 'SEC-ROLL-04 (radera rollen)', anv: 'admin', ef: 'store-key-write', body: (d) => ({ action: 'writeMerge', key: 'vift_roles', upserts: [], removals: [{ id: 'admin', previous: d.store.vift_roles.find((x) => x.id === 'admin') }] }), utfall: (las) => las('vift_roles').length },
  { id: 'ROLL-07', sec: 'SEC-ROLL-07 (+, superadmin ger roll)', anv: 'admin', ef: 'store-key-write', body: (d) => mergeStaff(d, d.U.falt.staffId, { role: 'chef' }), utfall: (las, svar, d) => las('vift_staff').find((x) => x.id === d.U.falt.staffId).role },
  { id: 'B3-03', sec: 'SEC-B3-03 (fält)', anv: 'falt', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_staff'] }, utfall: (las, svar, d) => projStaff(svar, d.U.falt.staffId) },
  { id: 'B3-03e', sec: 'SEC-B3-03 (ekonomi)', anv: 'ekonomi', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_staff'] }, utfall: (las, svar, d) => projStaff(svar, d.U.ekonomi.staffId) },
  { id: 'B3-03c', sec: 'R40 (staff_view)', anv: 'chef', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_staff'] }, utfall: (las, svar, d) => projStaff(svar, d.U.chef.staffId) },
  { id: 'B3-05', sec: 'SEC-B3-05 (fält)', anv: 'falt', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_roles'] }, utfall: (las, svar) => rollIds(svar) },
  { id: 'B3-05c', sec: 'SEC-B3-05 (arbetsledare)', anv: 'chef', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_roles'] }, utfall: (las, svar) => rollIds(svar) },
  { id: 'B3-05p', sec: 'D-21 (staff_manage: tilldelningsbara roller)', anv: 'personalansvarig', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_roles'] }, utfall: (las, svar) => rollIds(svar) },
  { id: 'B3-05r', sec: 'SEC-B3-05 (readWithHash)', anv: 'falt', ef: 'store-key-write', body: { action: 'readWithHash', key: 'vift_roles' }, utfall: (las, svar) => ((svar.body && svar.body.value) || []).map((x) => x.id).join(',') },
  { id: 'B3-06', sec: 'SEC-B3-06 (admin_manage)', anv: 'adminhanterare', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_roles'] }, utfall: (las, svar) => rollIds(svar) },
  { id: 'CUST-22', sec: 'SEC-CUST-22 (tom roll)', anv: 'tom', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_roles', 'vift_staff'] }, utfall: (las, svar, d) => rollIds(svar) + '|' + projStaff(svar, d.U.tom.staffId) },
  { id: 'CUST-23', sec: 'SEC-CUST-23 (okänd roll)', anv: 'okandroll', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_roles'] }, utfall: (las, svar) => rollIds(svar) },
  // BLOCKER-2 (per-nyckel-skrivrätt för generiska nycklar): fake med serverns KEY_PERMISSIONS ur källan.
  { id: 'KEY-02', sec: 'BLOCKER-2/PERM-03 (fält skriver kunder)', anv: 'falt', ef: 'store-key-write', fakeOpts: () => ({ keyPerms: serverKeyPerms() }), body: (d) => ({ action: 'writeMerge', key: 'vift_customers', upserts: [{ id: d.store.vift_customers[0].id, data: Object.assign({}, d.store.vift_customers[0], { name: 'x' }), previous: d.store.vift_customers[0] }], removals: [] }), utfall: (las, svar, d) => las('vift_customers')[0].name },
  /* T4-A: arbetsledaren (utan personal_data_view) skickar kunden så som den läser den (utan personnummer). */
  { id: 'KEY-03', sec: 'BLOCKER-2/PERM-03 (arbetsledare skriver kunder)', anv: 'chef', ef: 'store-key-write', fakeOpts: () => ({ keyPerms: serverKeyPerms() }), body: (d) => { const v = utan(d.store.vift_customers[0], ['personnr', 'orgNr']); return { action: 'writeMerge', key: 'vift_customers', upserts: [{ id: v.id, data: Object.assign({}, v, { name: 'x' }), previous: v }], removals: [] }; }, utfall: (las) => las('vift_customers')[0].name + '|' + las('vift_customers')[0].personnr },
  { id: 'KEY-04', sec: 'BLOCKER-2/PERM-03 (ekonomi skapar säljchans)', anv: 'ekonomi', ef: 'store-key-write', fakeOpts: () => ({ keyPerms: serverKeyPerms() }), body: (d) => ({ action: 'writeMerge', key: 'vift_salesOpps', upserts: [{ id: 'SO-PAR', data: { id: 'SO-PAR', title: 'x' }, previous: null }], removals: [] }), utfall: (las) => (las('vift_salesOpps') || []).length },
  { id: 'REST-01', sec: 'SEC-REST-01 (affärsnyckel)', anv: 'falt', rest: { key: 'vift_customers', value: [] }, utfall: (las) => las('vift_customers').length },
  { id: 'REST-01b', sec: 'SEC-REST-01 (personal)', anv: 'admin', rest: { key: 'vift_staff', value: [] }, utfall: (las) => las('vift_staff').length },
  { id: 'REST-02', sec: 'SEC-REST-02 (okänd nyckel)', anv: 'begransad', rest: { key: 'vift_e2e_paritet', value: { x: 1 } }, utfall: (las) => las('vift_e2e_paritet') === null || las('vift_e2e_paritet') === undefined },
  { id: 'REST-02b', sec: 'F18 (vift_lastChanged: servervärde)', anv: 'begransad', rest: { key: 'vift_lastChanged', value: '1999-01-01T00:00:00.000Z' }, utfall: (las) => String(las('vift_lastChanged')).startsWith('1999') },
  { id: 'REST-02c', sec: 'F18 (+ notiser)', anv: 'falt', rest: { key: 'vift_notifications', value: [{ id: 'N-PAR', createdAt: '2026-11-28T08:00:00.000Z', message: 'x', read: false }] }, utfall: (las) => (las('vift_notifications') || []).map((n) => n.id).join(',') },
];
/* KEY_PERMISSIONS ur den faktiska store-key-write-källan (ingen kopia). */
function serverKeyPerms() {
  const src = require('fs').readFileSync(require('path').join(process.env.VIFT_SERVER_ROOT || require('path').resolve(__dirname, '..', '..', '..', 'supabase'), 'functions', 'store-key-write', 'index.ts'), 'utf8');
  const m = /const KEY_PERMISSIONS: Record<string, string> = \{([\s\S]*?)\n\}/.exec(src); const t = {};
  m[1].replace(/^\s*(vift_\w+)\s*:\s*'([a-z_]+)'/gm, (_, k, v) => { t[k] = v; return ''; });
  return t;
}
/* T3-C-hjälpare: writeMerge som klienten gör (previous = serverns element). */
function mergeStaff(d, id, patch) { const el = d.store.vift_staff.find((x) => x.id === id); return { action: 'writeMerge', key: 'vift_staff', upserts: [{ id, data: Object.assign({}, el, patch), previous: el }], removals: [] }; }
function mergeRole(d, id, perms) { const el = d.store.vift_roles.find((x) => x.id === id); return { action: 'writeMerge', key: 'vift_roles', upserts: [{ id, data: Object.assign({}, el, { permissions: perms }), previous: el }], removals: [] }; }
function rollIds(svar) { return (((svar.body || {}).data || {}).roles || []).map((x) => x.id).sort().join(','); }
function projStaff(svar, egen) {
  const l = (((svar.body || {}).data || {}).staff || []);
  const andra = l.filter((x) => x.id !== egen);
  return [l.length, 'egen:' + Object.keys(l.find((x) => x.id === egen) || {}).includes('role'), 'andraRole:' + andra.some((x) => 'role' in x), 'andraPerms:' + andra.some((x) => 'permissions' in x)].join('|');
}
/* ── T3-D (2026-11-28): urval per post och aktivitetsloggen. Körs i T3-D-världen (lib/t3d-data.js)
   med serverns KEY_PERMISSIONS i den simulerade servern (som PERM-03). ── */
const { t3dVarld } = require('./t3d-data');
const T3D_OPTS = () => ({ keyPerms: serverKeyPerms() });
const lasT3d = (key) => ({ action: 'readAllWithHashes', keys: ['vift_' + key] });
const idsAv = (svar, key) => ((((svar.body || {}).data || {})[key]) || []).map((x) => x.id).sort().join(',');
const faltAv = (svar, key) => [...new Set(((((svar.body || {}).data || {})[key]) || []).flatMap((x) => Object.keys(x)))].sort().join(',');
const app = (id, type, refs) => ({ action: 'appendActivity', entry: Object.assign({ id: 'ACT-PAR-' + id, type, description: 'paritet' }, refs || {}) });
const taskMW = (d, upd, rem) => ({ action: 'writeMerge', key: 'vift_activities',
  upserts: (upd || []).map((x) => ({ id: x.id, data: x, previous: d.store.vift_activities.find((e) => e.id === x.id) || null })),
  removals: (rem || []).map((id) => ({ id, previous: d.store.vift_activities.find((e) => e.id === id) })) });
const taskMed = (d, id, patch) => Object.assign({}, d.store.vift_activities.find((e) => e.id === id), patch);
const T3D_SCEN = [
  ...['falt', 'falt2', 'begransad', 'ekonomi', 'chef', 'saljare', 'tom'].flatMap((anv) => [
    { id: 'B4-' + anv, sec: 'SEC-B4-01/02/03 (' + anv + ')', anv, ef: 'store-key-write', body: lasT3d('activityLog'), utfall: (las, svar) => idsAv(svar, 'activityLog') },
    { id: 'TASK-' + anv, sec: 'SEC-TASK-04 / D-15 (' + anv + ')', anv, ef: 'store-key-write', body: lasT3d('activities'), utfall: (las, svar) => idsAv(svar, 'activities') },
    { id: 'KUND-' + anv, sec: 'SEC-KUND-01 (' + anv + ')', anv, ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_customers', 'vift_properties', 'vift_propertyObjects', 'vift_propertyContacts'] },
      utfall: (las, svar) => ['customers', 'properties', 'propertyObjects', 'propertyContacts'].map((k) => idsAv(svar, k) + '/' + faltAv(svar, k).split(',').filter((f) => /accessCode|keyInfo|doorCode|keyInformation|personnr|keyReceipt|alarmInformation|accessInformation/.test(f)).join('+')).join('|') },
    { id: 'B3-' + anv, sec: 'SEC-B3-01..04 (' + anv + ')', anv, ef: 'store-key-write', body: lasT3d('staff'), utfall: (las, svar, d) => idsAv(svar, 'staff').split(',').length + '|' + [...new Set((((svar.body || {}).data || {}).staff || []).filter((x) => x.id !== d.U[anv].staffId).flatMap((x) => Object.keys(x)))].sort().join(',') },
  ]),
  ...['falt', 'begransad'].map((anv) => ({ id: 'OFF-' + anv, sec: 'SEC-OFF-01/02 (' + anv + ')', anv, ef: 'store-key-write', body: lasT3d('offers'), utfall: (las, svar) => idsAv(svar, 'offers') + '|' + faltAv(svar, 'offers') })),
  { id: 'B4-05', sec: 'SEC-B4-05 (type_not_allowed)', anv: 'falt', ef: 'store-key-write', body: app('000005', 'invoice_created', { workOrderId: 'AO-A1' }), utfall: (las) => (las('vift_activityLog') || []).length },
  { id: 'B4-06', sec: 'SEC-B4-06 (ref_not_visible)', anv: 'falt', ef: 'store-key-write', body: app('000006', 'work_order_status', { workOrderId: 'AO-A8' }), utfall: (las) => (las('vift_activityLog') || []).length },
  { id: 'B4-06p', sec: 'SEC-B4-06 / Q3 (öppen pool)', anv: 'falt', ef: 'store-key-write', body: app('000007', 'work_order_status', { workOrderId: 'AO-P1' }), utfall: (las) => (las('vift_activityLog') || []).length },
  { id: 'B4-06k', sec: 'D-22 (annans kund)', anv: 'falt', ef: 'store-key-write', body: app('000008', 'work_order_status', { workOrderId: 'AO-A1', customerId: 'CU-R3' }), utfall: (las) => (las('vift_activityLog') || []).length },
  { id: 'B4-OK', sec: 'D-22 (+, egen AO)', anv: 'falt', ef: 'store-key-write', body: app('000009', 'work_order_status', { workOrderId: 'AO-A1', customerId: 'CU-R1', offerId: 'OFF-R1' }), utfall: (las, svar, d) => { const e = (las('vift_activityLog') || [])[0] || {}; return [e.id, e.userId === d.U.falt.staffId, e.source].join('|'); } },
  { id: 'B4-EK', sec: 'D-22 (ekonomi, kundtyp)', anv: 'ekonomi', ef: 'store-key-write', body: app('000010', 'customer_updated', { customerId: 'CU-R1' }), utfall: (las) => (las('vift_activityLog') || []).length },
  { id: 'B4-04', sec: 'SEC-B4-04 (append_only)', anv: 'admin', ef: 'store-key-write', body: { action: 'writeMerge', key: 'vift_activityLog', upserts: [], removals: [] }, utfall: (las) => (las('vift_activityLog') || []).length },
  { id: 'TASK-01', sec: 'SEC-TASK-01 (+, egen uppgift)', anv: 'falt', ef: 'store-key-write', body: (d) => taskMW(d, [{ id: 'ACT-PAR-EGEN', title: 'Egen', status: 'open', createdBy: d.U.falt.staffId, assignedTo: d.U.falt.staffId }]), utfall: (las, svar) => idsAv({ body: { data: { a: (svar.body || {}).current } } }, 'a') },
  { id: 'TASK-02', sec: 'SEC-TASK-02 (not_own)', anv: 'falt', ef: 'store-key-write', body: (d) => taskMW(d, [{ id: 'ACT-PAR-ANNAN', title: 'Till Frida', status: 'open', createdBy: d.U.falt.staffId, assignedTo: d.U.falt2.staffId }]), utfall: (las) => (las('vift_activities') || []).length },
  { id: 'TASK-03', sec: 'SEC-TASK-03 (field_title)', anv: 'falt', ef: 'store-key-write', body: (d) => taskMW(d, [taskMed(d, 'TASK-R1', { title: 'Ny' })]), utfall: (las) => (las('vift_activities') || []).find((t) => t.id === 'TASK-R1').title },
  { id: 'TASK-03b', sec: 'D-15 (synlig via AO, inte egen)', anv: 'falt', ef: 'store-key-write', body: (d) => taskMW(d, [taskMed(d, 'TASK-D1', { status: 'done' })]), utfall: (las) => (las('vift_activities') || []).find((t) => t.id === 'TASK-D1').status },
  { id: 'TASK-05', sec: 'SEC-TASK-05 / SEC-CUST-21 (ekonomi, not_own)', anv: 'ekonomi', ef: 'store-key-write', body: (d) => taskMW(d, [taskMed(d, 'TASK-R1', { title: 'x' })]), utfall: (las) => (las('vift_activities') || []).find((t) => t.id === 'TASK-R1').title },
  { id: 'TASK-06', sec: 'SEC-TASK-06 (+, arbetsledare)', anv: 'chef', ef: 'store-key-write', body: (d) => taskMW(d, [taskMed(d, 'TASK-R1', { title: 'Ändrad av AL' })]), utfall: (las) => (las('vift_activities') || []).find((t) => t.id === 'TASK-R1').title },
  { id: 'TASK-DEL', sec: 'D-15 (radera annans)', anv: 'falt', ef: 'store-key-write', body: (d) => taskMW(d, [], ['TASK-R1']), utfall: (las) => (las('vift_activities') || []).length },
  ...['vift_activities', 'vift_activityLog', 'vift_customers', 'vift_properties', 'vift_propertyContacts', 'vift_offers'].flatMap((key) => ['falt', 'ekonomi'].map((anv) => (
    { id: 'REST-' + anv + '-' + key.slice(5), sec: 'SEC-KUND-02 / SEC-B4-02 (R, ' + anv + ')', anv, restLas: key, utfall: (las, svar) => svar.rader }))),
].map((sc) => Object.assign({ varld: t3dVarld, fakeOpts: T3D_OPTS }, sc));
SCENARIER.push(...T3D_SCEN);

/* ── T3-E (2026-11-28): ej verkställda behörigheter är verkningslösa (20261128000008). En roll som
   får dem ska få exakt samma urval som utan dem — även i den simulerade servern. ── */
const T3E_EJV = ['ao_plan_own', 'cost_view', 'cost_edit', 'time_view_all', 'bankgiro_edit', 'personal_data_view', 'objects_access_assigned', 'rondering_utfor', 'export_data', 'export_personal_data'];
const t3eVarld = (store, d) => { t3dVarld(store, d); store.vift_roles = store.vift_roles.map((x) => (['begransad', 'tom'].includes(x.id) ? Object.assign({}, x, { permissions: x.permissions.concat(T3E_EJV) }) : x)); return store; };
const T3E_SCEN = ['begransad', 'tom'].flatMap((anv) => [
  { id: 'E-B3-' + anv, sec: 'T3-E ej verkställda (' + anv + ' + alla): personal', anv, ef: 'store-key-write', body: lasT3d('staff'), utfall: (las, svar, d) => idsAv(svar, 'staff').split(',').length + '|' + [...new Set((((svar.body || {}).data || {}).staff || []).filter((x) => x.id !== d.U[anv].staffId).flatMap((x) => Object.keys(x)))].sort().join(',') },
  { id: 'E-KUND-' + anv, sec: 'T3-E ej verkställda (' + anv + ' + alla): kunder', anv, ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_customers', 'vift_properties', 'vift_propertyObjects'] }, utfall: (las, svar) => ['customers', 'properties', 'propertyObjects'].map((k) => idsAv(svar, k)).join('|') },
  { id: 'E-WOL-' + anv, sec: 'T3-E ej verkställda (' + anv + ' + alla): work-orders-list', anv, ef: 'work-orders-list', body: {}, utfall: (las, svar) => (((svar.body || {}).workOrders) || []).map((x) => x.id).sort().join(',') },
]).map((sc) => Object.assign({ varld: t3eVarld, fakeOpts: T3D_OPTS }, sc));
SCENARIER.push(...T3E_SCEN);

/* ── T4-A (2026-11-28): skyddade fält även för skrivare, fältvis sammanslagning, inställningar fält
   för fält, inga data utan giltig behörighet, äldre klients rollskrivning. Samma utfall krävs. ── */
const ksk = (d, id) => d.store.vift_customers.find((x) => x.id === id);
const obj1 = (d) => d.store.vift_propertyObjects.find((x) => x.id === 'OBJ-R1');
const SENSF = ['doorCode', 'keyInformation', 'accessInformation', 'keyReceipt', 'alarmInformation', 'accessCode', 'keyInfo'];
const t4aVarld = (store) => { store.vift_roles = store.vift_roles.map((x) => (x.id === 'personal' ? Object.assign({}, x, { permissions: x.permissions.concat(['customer_view']) }) : x)); return store; };
const T4A_SCEN = [
  { id: 'T4-KUND-01', sec: 'SEC-KUND-05 (utan personnr, bevaras)', anv: 'chef', ef: 'store-key-write', body: (d) => { const v = utan(ksk(d, 'CU-R1'), ['personnr', 'orgNr']); return { action: 'writeMerge', key: 'vift_customers', upserts: [{ id: v.id, data: Object.assign({}, v, { phone: '111' }), previous: v }], removals: [] }; }, utfall: (las) => { const c = las('vift_customers').find((x) => x.id === 'CU-R1'); return [c.phone, c.personnr].join('|'); } },
  { id: 'T4-KUND-02', sec: 'SEC-KUND-06 (personnr skickas)', anv: 'chef', ef: 'store-key-write', body: (d) => { const v = utan(ksk(d, 'CU-R1'), ['personnr', 'orgNr']); return { action: 'writeMerge', key: 'vift_customers', upserts: [{ id: v.id, data: Object.assign({}, v, { personnr: 'X' }), previous: v }], removals: [] }; }, utfall: (las) => las('vift_customers').find((x) => x.id === 'CU-R1').personnr },
  { id: 'T4-KUND-03', sec: 'äldre klient: hela kundposten som previous', anv: 'chef', ef: 'store-key-write', body: (d) => ({ action: 'writeMerge', key: 'vift_customers', upserts: [{ id: 'CU-R1', data: Object.assign({}, ksk(d, 'CU-R1'), { phone: '222' }), previous: ksk(d, 'CU-R1') }], removals: [] }), utfall: (las, svar) => [las('vift_customers').find((x) => x.id === 'CU-R1').phone, ((svar.body || {}).conflicts || []).length, JSON.stringify(svar.body || {}).includes('19800101') ? 'läcker' : 'ingen läcka'].join('|') },
  { id: 'T4-KUND-LAS', sec: 'SEC-KUND-03 (chef: personnr, portkod)', anv: 'chef', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_customers', 'vift_propertyObjects'] }, utfall: (las, svar) => JSON.stringify(((svar.body || {}).data || {}).customers || []).includes('19800101') + '|' + JSON.stringify(((svar.body || {}).data || {}).propertyObjects || []).includes('TEST-1001') },
  { id: 'T4-OBJ-01', sec: 'SEC-B5-02 (chef utan objects_sensitive sparar objekt)', anv: 'chef_utan_faktura', ef: 'store-key-write', body: (d) => { const v = utan(obj1(d), SENSF); return { action: 'writeMerge', key: 'vift_propertyObjects', upserts: [{ id: v.id, data: Object.assign({}, v, { name: 'Ny' }), previous: v }], removals: [] }; }, utfall: (las) => { const o = las('vift_propertyObjects').find((x) => x.id === 'OBJ-R1'); return [o.name, o.doorCode, o.keyInformation].join('|'); } },
  { id: 'T4-OBJ-02', sec: 'SEC-B5-03 (doorCode skickas)', anv: 'chef_utan_faktura', ef: 'store-key-write', body: (d) => { const v = utan(obj1(d), SENSF); return { action: 'writeMerge', key: 'vift_propertyObjects', upserts: [{ id: v.id, data: Object.assign({}, v, { doorCode: '' }), previous: v }], removals: [] }; }, utfall: (las) => las('vift_propertyObjects').find((x) => x.id === 'OBJ-R1').doorCode },
  { id: 'T4-OBJ-LAS', sec: 'SEC-B5-01 (skrivare utan objects_sensitive)', anv: 'chef_utan_faktura', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_propertyObjects', 'vift_customers', 'vift_properties'] }, utfall: (las, svar) => JSON.stringify((svar.body || {}).data || {}).match(/TEST-[0-9A-Z-]+/g) },
  { id: 'T4-WOL-01', sec: 'SÄK-7 (ao_edit utan objects_sensitive, work-orders-list)', anv: 'chef_utan_faktura', ef: 'work-orders-list', body: {}, utfall: (las, svar) => (((svar.body || {}).workOrders) || []).filter((a) => 'accessCode' in a).length + '|' + (((svar.body || {}).workOrders) || []).filter((a) => (a.materials || []).some((m) => 'buyPrice' in m)).length },
  { id: 'T4-WOL-02', sec: 'D-06 (fält, work-orders-list)', anv: 'falt', ef: 'work-orders-list', body: {}, utfall: (las, svar) => (((svar.body || {}).workOrders) || []).map((a) => ['fixedPrice' in a, 'accessCode' in a, (a.materials || []).some((m) => 'buyPrice' in m), 'priceType' in a].join('')).sort().join(',') },
  { id: 'T4-AO-01', sec: 'SÄK-7 (portkod i AO-patch utan objects_sensitive)', anv: 'chef_utan_faktura', ef: 'ao-time-write', body: { action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-t4ao1', patch: { accessCode: '9999' } }, utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A1').accessCode },
  { id: 'T4-AO-02', sec: 'AO-patch utan portkod bevarar den', anv: 'chef_utan_faktura', ef: 'ao-time-write', body: { action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-t4ao2', patch: { title: 'Ny titel' } }, utfall: (las, svar) => [las('vift_workOrders').find((a) => a.id === 'AO-A1').accessCode, 'accessCode' in (((svar.body || {}).workOrder) || {})].join('|') },
  { id: 'T4-MAT-GAMMAL', sec: 'äldre klient: annans rad med inköpspris', anv: 'falt', ef: 'ao-time-write', body: (d) => ({ action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-t4m', patch: { materials: d.store.vift_workOrders.find((a) => a.id === 'AO-A1').materials.concat([{ id: 'M-PAR2', name: 'x', qty: 1, buyPrice: 5 }]) } }), utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A1').materials.length },
  { id: 'T4-MAT-NY', sec: 'ny rad med inköpspris utan cost_edit (ignoredFields)', anv: 'falt', ef: 'ao-time-write', body: (d) => ({ action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-t4m2', patch: { materials: d.store.vift_workOrders.find((a) => a.id === 'AO-A1').materials.map((m) => utan(m, ['buyPrice'])).concat([{ id: 'M-PAR3', name: 'x', qty: 1, buyPrice: 5 }]) } }), utfall: (las, svar) => { const a = las('vift_workOrders').find((x) => x.id === 'AO-A1'); return [a.materials[0].buyPrice, 'buyPrice' in (a.materials.find((m) => m.id === 'M-PAR3') || {}), JSON.stringify((svar.body || {}).ignoredFields)].join('|'); } },
  { id: 'T4-INST-01', sec: 'SEC-INST-03 (bankgiro utan bankgiro_edit)', anv: 'adminhanterare', ef: 'store-key-write', body: { action: 'writeMerge', key: 'vift_settings', upserts: [{ id: 'bankgiro', data: '111-1111', previous: '000-0000' }], removals: [] }, utfall: (las) => las('vift_settings').bankgiro },
  { id: 'T4-INST-02', sec: 'SEC-INST-04 (annat fält, bankgiro oförändrat)', anv: 'adminhanterare', ef: 'store-key-write', body: { action: 'writeMerge', key: 'vift_settings', upserts: [{ id: 'companyName', data: 'Nytt namn', previous: 'Testföretaget (syntetiskt)' }], removals: [] }, utfall: (las, svar) => [las('vift_settings').companyName, las('vift_settings').bankgiro, las('vift_settings').internalHourlyCost, kanon(((svar.body || {}).current) || {})].join('|') },
  { id: 'T4-INST-03', sec: 'SEC-B2-06 (intern timkostnad utan cost_view)', anv: 'adminhanterare', ef: 'store-key-write', body: { action: 'writeMerge', key: 'vift_settings', upserts: [{ id: 'internalHourlyCost', data: 1, previous: null }], removals: [] }, utfall: (las) => las('vift_settings').internalHourlyCost },
  { id: 'T4-INST-04', sec: 'D-17 (konflikt på samma fält)', anv: 'adminhanterare', ef: 'store-key-write', body: { action: 'writeMerge', key: 'vift_settings', upserts: [{ id: 'companyName', data: 'B', previous: 'Gammalt namn' }], removals: [] }, utfall: (las, svar) => [las('vift_settings').companyName, ((svar.body || {}).conflicts || []).map((c) => c.id).join(',')].join('|') },
  { id: 'T4-ART-01', sec: 'SEC-B1-09 (fält: artiklarnas inköpspris)', anv: 'falt', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_articles', 'vift_settings'] }, utfall: (las, svar) => kanon(((svar.body || {}).data || {}).articles) + '|' + kanon(((svar.body || {}).data || {}).settings) },
  { id: 'T4-TOM-01', sec: 'punkt 7 (tom roll: inställningar, återkommande, artiklar)', anv: 'tom', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_settings', 'vift_recurringOrders', 'vift_articles', 'vift_staff'] }, utfall: (las, svar) => { const x = (svar.body || {}).data || {}; return [kanon(x.settings), kanon(x.recurringOrders), kanon(x.articles), (x.staff || []).length].join('|'); } },
  { id: 'T4-OKAND-01', sec: 'punkt 7 (okänd roll)', anv: 'okandroll', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_settings', 'vift_recurringOrders', 'vift_customers'] }, utfall: (las, svar) => kanon((svar.body || {}).data || {}) },
  { id: 'T4-REC-falt', sec: 'punkt 7 (återkommande per post, fält)', anv: 'falt', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_recurringOrders'] }, utfall: (las, svar) => kanon((((svar.body || {}).data || {}).recurringOrders) || []) },
  { id: 'T4-REST-art', sec: 'SEC-B1-09 (R, fält)', anv: 'falt', restLas: 'vift_articles', utfall: (las, svar) => svar.rader },
  { id: 'T4-REST-cust-chef', sec: 'SEC-KUND-03 (R, chef utan personal_data_view)', anv: 'chef', restLas: 'vift_customers', utfall: (las, svar) => svar.rader },
  { id: 'T4-ROLL-v34', sec: 'T3-E-beslutet (äldre klient tappar inte customer_view)', anv: 'admin', ef: 'store-key-write', varld: t4aVarld, body: (d) => { const el = d.store.vift_roles.find((x) => x.id === 'personal'); return { action: 'writeMerge', key: 'vift_roles', upserts: [{ id: 'personal', data: Object.assign({}, el, { permissions: el.permissions.filter((x) => x !== 'customer_view' && x !== 'ao_checklist') }), previous: el }], removals: [] }; }, utfall: (las) => las('vift_roles').find((x) => x.id === 'personal').permissions.slice().sort().join(',') },
  { id: 'T4-ROLL-t4', sec: 'T4-klient med katalogmarkör tar bort customer_view', anv: 'admin', ef: 'store-key-write', varld: t4aVarld, body: (d) => { const el = d.store.vift_roles.find((x) => x.id === 'personal'); return { action: 'writeMerge', key: 'vift_roles', klient: { behorighetskatalog: 4 }, upserts: [{ id: 'personal', data: Object.assign({}, el, { permissions: el.permissions.filter((x) => x !== 'customer_view') }), previous: el }], removals: [] }; }, utfall: (las) => las('vift_roles').find((x) => x.id === 'personal').permissions.slice().sort().join(',') },
];
SCENARIER.push(...T4A_SCEN);

/* ── T4-A, tilläggsdel notiser (20261128000010): projektion per mottagare, säker skrivväg och
   avvecklad REST-vitlista. Id:n skapas olika (md5/sha) och jämförs därför inte. ── */
const T4N_T0 = '2026-11-01T08:00:00.000Z';
const t4nVarld = (store, d) => {
  const F = d.U.falt.staffId, F2 = d.U.falt2.staffId, C = d.U.chef.staffId;
  store.vift_notifications = [
    { id: 'N-F-1', userId: F, type: 'ao_assigned', message: 'Du har tilldelats AO-A1', aoId: 'AO-A1', offerId: '', read: false, createdAt: T4N_T0 },
    { id: 'N-F2-1', userId: F2, type: 'ao_assigned', message: 'Du har tilldelats AO-A8 (Kalle Kund)', aoId: 'AO-A8', offerId: '', read: false, createdAt: T4N_T0 },
    { id: 'N-C-1', userId: C, type: 'offer_approved', message: 'Offert godkänd', aoId: '', offerId: 'OFF-R1', read: false, createdAt: T4N_T0 },
    { id: 'N-OLD-1', type: 'info', message: 'Äldre utan mottagare', read: false, createdAt: T4N_T0 },
  ];
  return store;
};
const t4nRefVarld = (store, d) => { t4nVarld(store, d); store.vift_roles = store.vift_roles.map((x) => (x.id === 'begransad' ? Object.assign({}, x, { permissions: x.permissions.concat(['ao_edit']) }) : x)); return store; };
const notisIds = (svar) => ((((svar.body || {}).data || {}).notifications) || []).map((n) => n.id).sort().join(',');
const notisUt = (las, fn) => (las('vift_notifications') || []).filter(fn).map((n) => [n.userId, n.type, n.aoId, n.message, n.read, n.createdBy || '', n.source || ''].join('/')).sort().join(';');
const NA = (notification, requestId) => ({ action: 'appendNotification', requestId: requestId || 'par-n', notification });
const T4N_SCEN = [
  { id: 'N-LAS-falt', sec: 'punkt 7 (läsning per mottagare, fält)', anv: 'falt', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_notifications'] }, utfall: (las, svar) => notisIds(svar) },
  { id: 'N-LAS-admin', sec: "punkt 7 (läsning per mottagare, 'all')", anv: 'admin', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_notifications'] }, utfall: (las, svar) => notisIds(svar) },
  { id: 'N-LAS-chef', sec: 'punkt 7 (läsning per mottagare, chef)', anv: 'chef', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_notifications'] }, utfall: (las, svar) => notisIds(svar) },
  { id: 'N-REST-LAS', sec: 'punkt 7 (R, notiser)', anv: 'falt', restLas: 'vift_notifications', utfall: (las, svar) => svar.rader },
  { id: 'N-REST-LAS-admin', sec: "punkt 7 (R, notiser, 'all')", anv: 'admin', restLas: 'vift_notifications', utfall: (las, svar) => svar.rader },
  { id: 'N-REST-SKRIV', sec: 'punkt 275 (REST-skrivning av notiser)', anv: 'falt', rest: { key: 'vift_notifications', value: [{ id: 'N-PAR', userId: 'ST-R05', createdAt: T4N_T0, message: 'x', read: false }] }, utfall: (las) => (las('vift_notifications') || []).map((n) => n.id).join(',') },
  { id: 'N-REST-LC', sec: 'punkt 275 (vift_lastChanged)', anv: 'begransad', rest: { key: 'vift_lastChanged', value: '1999-01-01T00:00:00.000Z' }, utfall: (las) => String(las('vift_lastChanged')).startsWith('1999') },
  { id: 'N-APP-chef', sec: 'tilldelningsnotis (chef → FÄ2, AO-A8)', anv: 'chef', ef: 'store-key-write', body: (d) => NA({ userId: d.U.falt2.staffId, type: 'ao_assigned', aoId: 'AO-A8', message: 'klienttext' }), utfall: (las, svar, d) => notisUt(las, (n) => n.createdBy === d.U.chef.staffId) },
  { id: 'N-APP-dup', sec: 'AP-D (oläst tilldelningsnotis finns)', anv: 'chef', ef: 'store-key-write', body: (d) => NA({ userId: d.U.falt.staffId, type: 'ao_assigned', aoId: 'AO-A1' }), utfall: (las, svar) => [(las('vift_notifications') || []).length, (svar.body || {}).duplicate, (svar.body || {}).id].join('|') },
  { id: 'N-APP-falt', sec: 'punkt 7 (fält åt annan)', anv: 'falt', ef: 'store-key-write', body: (d) => NA({ userId: d.U.falt2.staffId, type: 'ao_assigned', aoId: 'AO-A1' }), utfall: (las) => (las('vift_notifications') || []).length },
  { id: 'N-APP-typ', sec: 'punkt 7 (typ offer_approved)', anv: 'chef', ef: 'store-key-write', body: (d) => NA({ userId: d.U.falt.staffId, type: 'offer_approved', message: 'x' }), utfall: (las) => (las('vift_notifications') || []).length },
  { id: 'N-APP-inaktiv', sec: 'punkt 7 (inaktiv mottagare)', anv: 'chef', ef: 'store-key-write', body: NA({ userId: 'ST-R13', type: 'ao_assigned', aoId: 'AO-A1' }), utfall: (las) => (las('vift_notifications') || []).length },
  { id: 'N-APP-ejtilld', sec: 'AP-D (mottagaren inte tilldelad)', anv: 'chef', ef: 'store-key-write', body: (d) => NA({ userId: d.U.falt2.staffId, type: 'ao_assigned', aoId: 'AO-A1' }), utfall: (las) => (las('vift_notifications') || []).length },
  { id: 'N-APP-ref', sec: 'punkt 7 (referens avsändaren inte ser)', anv: 'begransad', ef: 'store-key-write', varld: t4nRefVarld, body: (d) => NA({ userId: d.U.falt2.staffId, type: 'ao_assigned', aoId: 'AO-A8' }), utfall: (las) => (las('vift_notifications') || []).length },
  { id: 'N-APP-egen', sec: 'egen påminnelse till sig själv', anv: 'falt', ef: 'store-key-write', body: (d) => NA({ userId: d.U.falt.staffId, type: 'service_overdue', message: 'Hiss förfallen' }), utfall: (las, svar, d) => notisUt(las, (n) => n.createdBy === d.U.falt.staffId) + '|' + !!(svar.body || {}).notification },
  { id: 'N-APP-egen-annan', sec: 'egen påminnelse åt annan', anv: 'falt', ef: 'store-key-write', body: (d) => NA({ userId: d.U.falt2.staffId, type: 'service_overdue', message: 'x' }), utfall: (las) => (las('vift_notifications') || []).length },
  { id: 'N-APP-tom', sec: 'punkt 7 (tom roll)', anv: 'tom', ef: 'store-key-write', body: (d) => NA({ userId: d.U.tom.staffId, type: 'service_done', message: 'x' }), utfall: (las) => (las('vift_notifications') || []).length },
  { id: 'N-APP-lang', sec: 'storleksgräns (text > 500)', anv: 'chef', ef: 'store-key-write', body: (d) => NA({ userId: d.U.chef.staffId, type: 'service_done', message: 'x'.repeat(501) }), utfall: (las) => (las('vift_notifications') || []).length },
  { id: 'N-APP-idem', sec: 'idempotens bunden till innehåll', anv: 'chef', ef: 'store-key-write', fore: NA({ userId: 'ST-R04', type: 'service_done', message: 'x' }, 'par-idem-n'), body: NA({ userId: 'ST-R02', type: 'service_done', message: 'y' }, 'par-idem-n'), utfall: (las) => (las('vift_notifications') || []).length },
  { id: 'N-MARK-egen', sec: 'egen markering', anv: 'falt', ef: 'store-key-write', body: { action: 'markNotificationsRead', ids: ['N-F-1'] }, utfall: (las, svar) => (las('vift_notifications') || []).map((n) => n.id + ':' + n.read + ':' + (typeof n.readAt === 'string')).join(',') + '|' + (svar.body || {}).marked + '|' + (svar.body || {}).ignored },
  { id: 'N-MARK-annan', sec: 'markering av annans notis', anv: 'falt', ef: 'store-key-write', body: { action: 'markNotificationsRead', ids: ['N-F2-1', 'N-C-1', 'N-OLD-1', 'N-X'] }, utfall: (las, svar) => (las('vift_notifications') || []).map((n) => n.id + ':' + n.read).join(',') + '|' + (svar.body || {}).marked + '|' + (svar.body || {}).ignored },
  { id: 'N-MARK-alla', sec: 'markera alla (bara egna)', anv: 'falt2', ef: 'store-key-write', body: { action: 'markNotificationsRead', all: true }, utfall: (las, svar) => (las('vift_notifications') || []).map((n) => n.id + ':' + n.read).join(',') + '|' + (svar.body || {}).marked },
].map((sc) => Object.assign({ varld: t4nVarld, fakeOpts: T3D_OPTS }, sc));
SCENARIER.push(...T4N_SCEN);

/* ── T4-B (20261128000011): material, priser och tid. Serverns id (md5) och fakens (slump) jämförs inte. ── */
const t4bVarld = (store, d) => {
  const F = d.U.falt.staffId;
  store.vift_priceGroups = [
    { id: 'PG-1', name: 'Standard', hourRate: 650, billingType: 'hourly', description: 'Normal 650 kr', active: true },
    { id: 'PG-2', name: 'Akut', hourRate: 800, billingType: 'hourly', description: '', active: true },
    { id: 'PG-X', name: 'Inaktiv', hourRate: 500, billingType: 'hourly', description: '', active: false },
  ];
  store.vift_articles = store.vift_articles.concat([{ id: 'ART-R2', articleNumber: 'R2', name: 'Utan pris', unit: 'm', buyPrice: 0, sellPrice: 0, vatRate: 25, active: true }]);
  store.vift_workOrders = store.vift_workOrders.map((a) => {
    if (!['AO-A1', 'AO-A2', 'AO-A3'].includes(a.id)) return a;
    const b = Object.assign({}, a, { priceType: 'timpris', priceGroupId: 'PG-1' });
    if (a.id === 'AO-A1') b.materials = a.materials.concat([{ id: 'M-FA', name: 'Fältets fritext', qty: 1, unit: 'st', addedBy: F, addedAt: T4N_T0, sellPrice: null, sellPriceUnknown: true, buyPrice: null, buyPriceUnknown: true }]);
    return b;
  });
  return store;
};
const t4bFaktVarld = (store, d) => {
  t4bVarld(store, d);
  store.vift_invoices = store.vift_invoices.concat([
    { id: 'INV-T4B', status: 'utkast', customerId: 'CU-R1', sourceAware: true, revision: 1, lines: [{ id: 'L1', description: 'x', qty: 1, unitPrice: 100, vatRate: 25, sourceRefs: [{ sourceKey: 'material:AO-A1:AO-A1-M1', sourceType: 'material', sourceId: 'AO-A1-M1', workOrderId: 'AO-A1' }] }], createdAt: T4N_T0, updatedAt: T4N_T0 },
    { id: 'INV-T4B-M', status: 'utkast', customerId: 'CU-R2', revision: 1, lines: [{ id: 'L1', description: 'Manuell utan pris', qty: 1, vatRate: 25 }], createdAt: T4N_T0, updatedAt: T4N_T0 },
  ]);
  return store;
};
const t4bTidVarld = (store, d) => { t4bVarld(store, d); store.vift_roles = store.vift_roles.map((x) => (x.id === 'begransad' ? Object.assign({}, x, { permissions: x.permissions.concat(['time_view_all']) }) : x)); return store; };
const mat = (las, aoId, fn) => (las('vift_workOrders').find((a) => a.id === aoId).materials || []).filter(fn);
const sista = (las, aoId) => { const l = las('vift_workOrders').find((a) => a.id === aoId).materials; return l[l.length - 1]; };
const radUt = (m) => (m ? [m.name, m.qty, m.unit, m.sellPrice, m.sellPriceUnknown, m.buyPrice, m.buyPriceUnknown, m.vatRate, m.priceSource, m.addedBy, m.extra].join('/') : null);
const ign = (svar) => JSON.stringify(((svar.body || {}).ignoredFields || []).slice().sort());
const faktLin = (key, typ, src, ao, pris) => ({ id: 'L1', description: 'x', qty: 1, unit: 'st', unitPrice: pris, vatRate: 25, sourceRefs: [{ sourceKey: key, sourceType: typ, sourceId: src, workOrderId: ao }] });
const FAKT = (lines) => ({ action: 'appendChecked', idempotencyKey: 'vift-v2:par-t4b', invoice: { title: 'x', customerId: 'CU-R1', sourceAware: true, lines } });
const tidUt = (las, id) => { const t = las('vift_timeEntries').find((x) => x.id === id); return t ? [t.hourRate, t.hourRateUnknown, t.priceGroupId, t.priceGroupName].join('/') : null; };
const T4B_SCEN = [
  { id: 'B-ADD-art', sec: 'SEC-B1-01/03 (artikelrad, serverpris)', anv: 'falt', ef: 'ao-time-write', body: { action: 'add_material', idempotencyKey: 'par-b1', aoId: 'AO-A1', row: { articleId: 'ART-R1', qty: 2, sellPrice: 1, buyPrice: 1 } }, utfall: (las, svar) => radUt(sista(las, 'AO-A1')) + '|' + ign(svar) + '|' + ('sellPrice' in ((svar.body || {}).row || {})) },
  { id: 'B-ADD-fri', sec: 'SEC-B1-02 (fritext = okänt pris)', anv: 'falt', ef: 'ao-time-write', body: { action: 'add_material', idempotencyKey: 'par-b2', aoId: 'AO-A1', row: { name: 'Kabel', qty: 3.5, unit: 'lm', sellPrice: 0 } }, utfall: (las, svar) => radUt(sista(las, 'AO-A1')) + '|' + ign(svar) },
  { id: 'B-ADD-art0', sec: 'okänt ≠ 0 (artikel med pris 0)', anv: 'falt', ef: 'ao-time-write', body: { action: 'add_material', idempotencyKey: 'par-b3', aoId: 'AO-A1', row: { articleId: 'ART-R2', qty: 1 } }, utfall: (las) => radUt(sista(las, 'AO-A1')) },
  { id: 'B-ADD-ejtilld', sec: 'D-19 (ej tilldelad)', anv: 'falt2', ef: 'ao-time-write', body: { action: 'add_material', idempotencyKey: 'par-b4', aoId: 'AO-A1', row: { name: 'x', qty: 1 } }, utfall: (las) => mat(las, 'AO-A1', () => true).length },
  { id: 'B-ADD-last', sec: 'SEC-B1-08 (fakturerad AO)', anv: 'falt', ef: 'ao-time-write', body: { action: 'add_material', idempotencyKey: 'par-b5', aoId: 'AO-A9', row: { name: 'x', qty: 1 } }, utfall: (las) => mat(las, 'AO-A9', () => true).length },
  { id: 'B-ADD-ogiltig', sec: 'indata (antal 0)', anv: 'falt', ef: 'ao-time-write', body: { action: 'add_material', idempotencyKey: 'par-b6', aoId: 'AO-A1', row: { name: 'x', qty: 0 } }, utfall: (las) => mat(las, 'AO-A1', () => true).length },
  { id: 'B-UPD-annan', sec: 'SEC-B1-05 (annans rad)', anv: 'falt', ef: 'ao-time-write', body: { action: 'update_material', idempotencyKey: 'par-b7', aoId: 'AO-A1', rowId: 'AO-A1-M1', patch: { qty: 9 } }, utfall: (las) => mat(las, 'AO-A1', (m) => m.id === 'AO-A1-M1')[0].qty },
  { id: 'B-UPD-egen', sec: 'SEC-B1-04 (egen rad)', anv: 'falt', ef: 'ao-time-write', body: { action: 'update_material', idempotencyKey: 'par-b8', aoId: 'AO-A1', rowId: 'M-FA', patch: { qty: 4, note: 'ny' } }, utfall: (las) => radUt(mat(las, 'AO-A1', (m) => m.id === 'M-FA')[0]) },
  { id: 'B-UPD-pris-falt', sec: 'SEC-B1-14 (fältet sätter pris)', anv: 'falt', ef: 'ao-time-write', body: { action: 'update_material', idempotencyKey: 'par-b9', aoId: 'AO-A1', rowId: 'M-FA', patch: { sellPrice: 5 } }, utfall: (las) => radUt(mat(las, 'AO-A1', (m) => m.id === 'M-FA')[0]) },
  { id: 'B-UPD-pris-chef', sec: 'SEC-B1-13 (arbetsledaren kompletterar)', anv: 'chef', ef: 'ao-time-write', body: { action: 'update_material', idempotencyKey: 'par-b10', aoId: 'AO-A1', rowId: 'M-FA', patch: { sellPrice: 45 } }, utfall: (las) => { const a = las('vift_workOrders').find((x) => x.id === 'AO-A1'); return radUt(a.materials.find((m) => m.id === 'M-FA')) + '|' + a.log[a.log.length - 1].type; } },
  { id: 'B-RM-egen', sec: 'SEC-B1-04 (ta bort egen)', anv: 'falt', ef: 'ao-time-write', body: { action: 'remove_material', idempotencyKey: 'par-b11', aoId: 'AO-A1', rowId: 'M-FA' }, utfall: (las, svar) => mat(las, 'AO-A1', () => true).length + '|' + (svar.body || {}).removedId },
  { id: 'B-PATCH-falt', sec: 'SEC-B1-06 (hela listan, fält)', anv: 'falt', ef: 'ao-time-write', body: (d) => ({ action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-b12', patch: { materials: d.store.vift_workOrders.find((a) => a.id === 'AO-A1').materials.map((m) => utan(m, ['buyPrice'])).concat([{ id: 'M-NY', name: 'x', qty: 1, sellPrice: 0 }]) } }), utfall: (las) => mat(las, 'AO-A1', () => true).length },
  { id: 'B-PATCH-chef', sec: 'gammal klient (arbetsledare, hela listan)', anv: 'chef', ef: 'ao-time-write', body: (d) => ({ action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-b13', patch: { materials: d.store.vift_workOrders.find((a) => a.id === 'AO-A1').materials.map((m) => utan(m, ['buyPrice'])).map((m) => (m.id === 'M-FA' ? Object.assign({}, m, { sellPrice: 0 }) : m)).concat([{ id: 'M-NY', articleId: 'ART-R1', name: 'x', qty: 1, sellPrice: 1 }]) } }), utfall: (las, svar) => radUt(mat(las, 'AO-A1', (m) => m.id === 'M-NY')[0]) + '|' + radUt(mat(las, 'AO-A1', (m) => m.id === 'M-FA')[0]) + '|' + ign(svar) },
  { id: 'B-TID-grupp', sec: 'SEC-B2-03 (hourRate från grupp)', anv: 'falt', ef: 'ao-time-write', body: { action: 'create_time', idempotencyKey: 'par-b14', entry: { id: 'TE-B14', aoId: 'AO-A1', date: '2026-11-24', minutes: 60, priceGroupId: 'PG-1', hourRate: 9999 } }, utfall: (las, svar) => tidUt(las, 'TE-B14') + '|' + ign(svar) + '|' + ('hourRate' in ((svar.body || {}).timeEntry || {})) },
  { id: 'B-TID-inaktiv', sec: 'SEC-B2-04 (inaktiv grupp)', anv: 'falt', ef: 'ao-time-write', body: { action: 'create_time', idempotencyKey: 'par-b15', entry: { id: 'TE-B15', aoId: 'AO-A1', date: '2026-11-24', minutes: 60, priceGroupId: 'PG-X' } }, utfall: (las) => tidUt(las, 'TE-B15') },
  { id: 'B-TID-annan', sec: 'SEC-B2-04 (annan grupp än AO:ns)', anv: 'falt', ef: 'ao-time-write', body: { action: 'create_time', idempotencyKey: 'par-b16', entry: { id: 'TE-B16', aoId: 'AO-A1', date: '2026-11-24', minutes: 60, priceGroupId: 'PG-2' } }, utfall: (las) => tidUt(las, 'TE-B16') },
  { id: 'B-TID-chef', sec: 'R22 (kontorsroll väljer annan grupp)', anv: 'chef', ef: 'ao-time-write', body: { action: 'create_time', idempotencyKey: 'par-b17', entry: { id: 'TE-B17', aoId: 'AO-A1', date: '2026-11-24', minutes: 60, priceGroupId: 'PG-2' } }, utfall: (las) => tidUt(las, 'TE-B17') },
  { id: 'B-TID-utan', sec: 'okänt timpris ≠ 0', anv: 'falt', ef: 'ao-time-write', body: { action: 'create_time', idempotencyKey: 'par-b18', entry: { id: 'TE-B18', aoId: 'AO-A1', date: '2026-11-24', minutes: 60, hourRate: 0 } }, utfall: (las, svar) => tidUt(las, 'TE-B18') + '|' + ign(svar) },
  { id: 'B-TID-klar', sec: 'T3-B beslut 1 (klar AO)', anv: 'falt', ef: 'ao-time-write', body: { action: 'create_time', idempotencyKey: 'par-b19', entry: { id: 'TE-B19', aoId: 'AO-A3', date: '2026-11-24', minutes: 60, priceGroupId: 'PG-1' } }, utfall: (las) => tidUt(las, 'TE-B19') },
  { id: 'B-STAMP-klar', sec: 'T3-B beslut 1 (instämpling klar AO)', anv: 'falt', ef: 'store-key-write', body: { action: 'setStampStatus', active: true, ts: 1764000000000, aoId: 'AO-A3', expectedRevision: 0 }, utfall: () => '' },
  { id: 'B-TEL-falt', sec: 'SEC-B2-01/SEC-TID-09 (fält)', anv: 'falt', ef: 'time-entries-list', body: {}, utfall: (las, svar) => ((svar.body && svar.body.timeEntries) || []).map((t) => t.id + ':' + ('hourRate' in t)).sort().join(',') },
  { id: 'B-TEL-ekonomi', sec: 'D-08 (payroll_view)', anv: 'ekonomi', ef: 'time-entries-list', body: {}, utfall: (las, svar) => ((svar.body && svar.body.timeEntries) || []).map((t) => t.id + ':' + t.hourRate + ':' + ('attested' in t)).sort().join(',') },
  { id: 'B-TEL-tva', sec: 'K-01 (time_view_all utan lön)', anv: 'begransad', ef: 'time-entries-list', body: {}, varld: t4bTidVarld, utfall: (las, svar) => ((svar.body && svar.body.timeEntries) || []).map((t) => t.id + ':' + Object.keys(t).sort().join('+')).sort().join(',') },
  { id: 'B-PG-falt', sec: 'R22/SEC-B2-01 (prisgrupper, fält)', anv: 'falt', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_priceGroups', 'vift_articles'] }, utfall: (las, svar) => kanon(((svar.body || {}).data || {}).priceGroups) + '|' + kanon(((svar.body || {}).data || {}).articles) },
  { id: 'B-PG-chef', sec: 'R23 (prisgrupper, arbetsledare)', anv: 'chef', ef: 'store-key-write', body: { action: 'readAllWithHashes', keys: ['vift_priceGroups'] }, utfall: (las, svar) => kanon(((svar.body || {}).data || {}).priceGroups) },
  { id: 'B-REST-pg', sec: 'SEC-B2-01 (R, fält)', anv: 'falt', restLas: 'vift_priceGroups', utfall: (las, svar) => svar.rader },
  { id: 'B-WOL-falt', sec: 'D-09 (AO:ns materialrader, fält)', anv: 'falt', ef: 'work-orders-list', body: {}, utfall: (las, svar) => (((svar.body || {}).workOrders) || []).filter((a) => (a.materials || []).some((m) => 'sellPrice' in m)).length },
  { id: 'B-FAKT-okand', sec: 'SEC-B1-15 (okänt pris)', anv: 'ekonomi', ef: 'invoice-write', body: FAKT([faktLin('material:AO-A1:M-FA', 'material', 'M-FA', 'AO-A1', 0)]), utfall: (las) => las('vift_invoices').length },
  { id: 'B-FAKT-fast', sec: 'SEC-B1-16 (fastpris)', anv: 'ekonomi', ef: 'invoice-write', body: FAKT([faktLin('material:AO-A8:AO-A8-M1', 'material', 'AO-A8-M1', 'AO-A8', 100)]), utfall: (las) => las('vift_invoices').length },
  { id: 'B-FAKT-pris', sec: 'serverpris (price_mismatch)', anv: 'ekonomi', ef: 'invoice-write', body: FAKT([faktLin('material:AO-A1:AO-A1-M1', 'material', 'AO-A1-M1', 'AO-A1', 1)]), utfall: (las) => las('vift_invoices').length },
  { id: 'B-FAKT-saknas', sec: 'source_not_found', anv: 'ekonomi', ef: 'invoice-write', body: FAKT([faktLin('material:AO-A1:FINNS-INTE', 'material', 'FINNS-INTE', 'AO-A1', 100)]), utfall: (las) => las('vift_invoices').length },
  { id: 'B-FAKT-ok', sec: 'källrad med serverpris', anv: 'ekonomi', ef: 'invoice-write', body: FAKT([faktLin('material:AO-A1:AO-A1-M1', 'material', 'AO-A1-M1', 'AO-A1', 100)]), utfall: (las) => las('vift_invoices').length },
  { id: 'B-FAKT-tidfast', sec: 'D-10 (tid på fastpris-AO)', anv: 'ekonomi', ef: 'invoice-write', body: FAKT([faktLin('time:TE-R2', 'time', 'TE-R2', 'AO-A8', 650)]), utfall: (las) => las('vift_invoices').length },
  { id: 'B-INVLOCK', sec: 'T3-B beslut 2 (rad i utkast låst)', anv: 'chef', ef: 'ao-time-write', varld: t4bFaktVarld, body: { action: 'update_material', idempotencyKey: 'par-b30', aoId: 'AO-A1', rowId: 'AO-A1-M1', patch: { qty: 5 } }, utfall: (las) => mat(las, 'AO-A1', (m) => m.id === 'AO-A1-M1')[0].qty },
  { id: 'B-INVLOCK-lista', sec: 'T3-B beslut 2 (hela listan)', anv: 'chef', ef: 'ao-time-write', varld: t4bFaktVarld, body: (d) => ({ action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-b31', patch: { materials: [] } }), utfall: (las) => mat(las, 'AO-A1', () => true).length },
  { id: 'B-SEND-okand', sec: 'SEC-B1-15 (utskick med okänt pris)', anv: 'ekonomi', ef: 'invoice-write', varld: t4bFaktVarld, body: { action: 'setStatus', invoiceId: 'INV-T4B-M', status: 'skickad', expectedRevision: 1 }, utfall: (las) => las('vift_invoices').find((i) => i.id === 'INV-T4B-M').status },
  { id: 'B-KORR', sec: 'punkt 276 (komplettering av glömd tid)', anv: 'ekonomi', ef: 'ao-time-write', body: (d) => ({ action: 'correct_time', idempotencyKey: 'par-b33', entry: { aoId: 'AO-A3', staffId: d.U.falt.staffId, date: '2026-11-22', minutes: 30, priceGroupId: 'PG-1' }, reason: 'Glömd tid' }), utfall: (las) => { const t = las('vift_timeEntries').find((x) => (x.corrections || []).length); const a = las('vift_workOrders').find((x) => x.id === 'AO-A3'); return t ? [t.hourRate, t.corrections[0].reason, t.corrections[0].type, a.log[a.log.length - 1].type].join('/') : null; } },
  { id: 'B-KORR-falt', sec: 'punkt 276 (utan payroll_manage)', anv: 'falt', ef: 'ao-time-write', body: (d) => ({ action: 'correct_time', idempotencyKey: 'par-b34', entry: { aoId: 'AO-A3', staffId: d.U.falt.staffId, date: '2026-11-22', minutes: 30 }, reason: 'Glömd tid' }), utfall: (las) => las('vift_timeEntries').length },
  { id: 'B-KORR-orsak', sec: 'punkt 276 (orsak krävs)', anv: 'ekonomi', ef: 'ao-time-write', body: (d) => ({ action: 'correct_time', idempotencyKey: 'par-b35', entry: { aoId: 'AO-A3', staffId: d.U.falt.staffId, date: '2026-11-22', minutes: 30 }, reason: 'x' }), utfall: (las) => las('vift_timeEntries').length },
].map((sc) => Object.assign({ varld: t4bVarld, fakeOpts: T3D_OPTS }, sc));
SCENARIER.push(...T4B_SCEN);

/* ── T4-C (2026-11-28): åtkomstinformation (get-sensitive-fields, objects_access_assigned) ──
   Världen: personalrollen har objects_access_assigned (som standardrollen personal) och rondering_utfor;
   ett pass på PROP-R1 tilldelat fältet. Utfall: de fält som lämnas ut (namn, inga värden). */
const t4cVarld = (store, d) => {
  t4bVarld(store, d);
  store.vift_roles = store.vift_roles.map((r) => (r.id === 'personal' ? Object.assign({}, r, { permissions: r.permissions.concat(['objects_access_assigned', 'rondering_utfor']) }) : r));
  store.vift_ronderingspass = [{ id: 'PASS-C1', ronderingId: 'RON-C1', propertyId: 'PROP-R1', customerId: 'CU-R1', staffIds: [d.U.falt.staffId], status: 'planerat', categories: [], summary: {} }];
};
const GSF = (b) => b;
const gsfUt = (las, svar) => Object.keys(svar.body || {}).filter((k) => (svar.body || {})[k] != null && !['error', 'reason'].includes(k)).sort().join(',');
const T4C_SCEN = [
  { id: 'C-AO-egen', sec: 'SEC-B5-06 (egen tilldelad aktiv AO)', anv: 'falt', ef: 'get-sensitive-fields', body: GSF({ objectId: 'OBJ-R1', workOrderId: 'AO-A1' }), utfall: gsfUt },
  { id: 'C-AO-utanref', sec: 'SEC-B5-06 (utan AO-referens)', anv: 'falt', ef: 'get-sensitive-fields', body: GSF({ objectId: 'OBJ-R1' }), utfall: gsfUt },
  { id: 'C-AO-annans', sec: 'SEC-B5-08 (annans AO)', anv: 'falt', ef: 'get-sensitive-fields', body: GSF({ objectId: 'OBJ-R1', workOrderId: 'AO-A8' }), utfall: gsfUt },
  { id: 'C-AO-klar', sec: 'SEC-B5-08 (klar AO)', anv: 'falt', ef: 'get-sensitive-fields', body: GSF({ objectId: 'OBJ-R1', workOrderId: 'AO-A3' }), utfall: gsfUt },
  { id: 'C-AO-pool', sec: 'SEC-B5-08 (öppen pool)', anv: 'falt', ef: 'get-sensitive-fields', body: GSF({ objectId: 'OBJ-R1', workOrderId: 'AO-P1' }), utfall: gsfUt },
  { id: 'C-OBJ-annat', sec: 'SEC-B5-08 (objekt utan egen AO)', anv: 'falt', ef: 'get-sensitive-fields', body: GSF({ objectId: 'OBJ-R2' }), utfall: gsfUt },
  { id: 'C-BE', sec: 'SEC-B5-09 (begränsad, egen AO)', anv: 'begransad', ef: 'get-sensitive-fields', body: GSF({ objectId: 'OBJ-R1' }), utfall: gsfUt },
  { id: 'C-AL', sec: 'objects_sensitive (oförändrat)', anv: 'chef', ef: 'get-sensitive-fields', body: GSF({ objectId: 'OBJ-R1' }), utfall: gsfUt },
  { id: 'C-FAST', sec: 'SEC-B5-06 (fastighetsnivå)', anv: 'falt', ef: 'get-sensitive-fields', body: GSF({ propertyId: 'PROP-R1' }), utfall: gsfUt },
  { id: 'C-PASS', sec: 'SEC-B5-07 (pass, före T4-D avstängt)', anv: 'falt', ef: 'get-sensitive-fields', body: GSF({ propertyId: 'PROP-R1', passId: 'PASS-C1' }), utfall: gsfUt },
  { id: 'C-INDATA', sec: 'missing_fields', anv: 'falt', ef: 'get-sensitive-fields', body: GSF({ workOrderId: 'AO-A1' }), utfall: gsfUt },
].map((sc) => Object.assign({ varld: t4cVarld, fakeOpts: T3D_OPTS }, sc));
SCENARIER.push(...T4C_SCEN);

/* Samma världsinställning som tests/staging_e2e_real.test.js (STAGING-lik simulerad server). */
const FAKE_STD = { logOps: true, activityAppend: true, activitiesPolicy: true };
const EF_LISTA = ['work-orders-list', 'ao-time-write', 'work-order-checklist-resolve', 'work-order-log-write', 'time-entries-list', 'store-key-write', 'invoice-write', 'get-sensitive-fields'];

function svarAv(s) { const b = s.body || {}; return { status: s.status, error: b.error === undefined ? null : b.error, reason: b.reason === undefined ? null : b.reason }; }
/* T3-C: REST-scenarier (POST /rest/v1/store med Prefer: resolution=merge-duplicates, som
   Storage.setRemoteStrict). Jämförs: status, PostgreSQL-kod och om felet är direct_write_blocked. */
function restSvarReplik(x) { return x.ok ? { status: 201, error: null, reason: null } : { status: x.status, error: x.code, reason: /direct_write_blocked/.test(x.message) ? 'direct_write_blocked' : null }; }
function restSvarFake(x) { const b = x.body || {}; if (x.status < 300) return { status: 201, error: null, reason: null }; return { status: x.status, error: b.code || null, reason: /direct_write_blocked/.test(JSON.stringify(b)) ? 'direct_write_blocked' : null }; }

/* T3-D: REST-läsning (GET /rest/v1/store?key=eq.X). Jämförs: status och antal rader (RLS döljer raden). */
function restLasReplik(x) { return x.ok ? { status: 200, error: null, reason: null, rader: x.rows.length } : { status: x.status, error: x.code, reason: null, rader: 0 }; }
function restLasFake(x) { return x.status === 200 ? { status: 200, error: null, reason: null, rader: Array.isArray(x.body) ? x.body.length : 0 } : { status: x.status, error: (x.body || {}).error || null, reason: null, rader: 0 }; }
const omitRader = (x) => { const o = Object.assign({}, x); delete o.rader; return o; };

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
      if (sc.varld) sc.varld(d.store, d);
      const body = typeof sc.body === 'function' ? sc.body(d) : sc.body;
      // ── replik ──
      aterstall();
      if (sc.varld) psql(r.db, Object.entries(d.store).map(([k, v]) => `insert into public.store(key, value) values (${lit(k)}, ${jlit(v)}) on conflict (key) do update set value = excluded.value;`).join('\n'));
      if (sc.fore) await ef.anropa(sc.ef, { user: d.U[sc.foreAnv || sc.anv], body: sc.fore });
      const rs = sc.rest
        ? restSvarReplik(asUser(r.db, d.U[sc.anv], `insert into public.store(key, value) values (${lit(sc.rest.key)}, ${jlit(sc.rest.value)}) on conflict (key) do update set value = excluded.value`))
        : sc.restLas ? restLasReplik(asUser(r.db, d.U[sc.anv], `select key, value from public.store where key = ${lit(sc.restLas)}`))
          : await ef.anropa(sc.ef, { user: d.U[sc.anv], body });
      const rUtfall = sc.utfall((k) => val(r.db, k), rs, d);
      // ── fake ──
      const fake = new FakeSupabase(Object.assign({}, FAKE_STD, (typeof sc.fakeOpts === 'function' ? sc.fakeOpts() : sc.fakeOpts) || {}));
      fake.store = new Map(Object.entries(clone(d.store)));
      /* T4-C: samma känsliga rader som replikan (property_sensitive_access), nyckel = objekt-id (annars fastighet). */
      (d.kansliga || []).forEach((k) => fake.sensitive.set(k.object_id || k.property_id, { doorCode: k.door_code || '', keyInformation: k.key_information || '', keyReceipt: k.key_receipt || '', alarmInformation: k.alarm_information || '', accessInformation: k.access_information || '', accessCode: k.access_code || '' }));
      fake.users = {};
      d.anvandare.forEach((u) => { fake.users[u.email] = { id: u.authId, email: u.email, password: 'replik', alias: u.alias, active: u.appActive }; });
      const tokFor = (alias) => fake.issue(fake.users[d.U[alias].email]).access_token;
      const tok = tokFor(sc.anv);
      const anropaFake = async (b, t) => { const x = await fake.handle('POST', 'http://fake.lokal/functions/v1/' + sc.ef, { authorization: 'Bearer ' + (t || tok) }, JSON.stringify(b)); return { status: x.status, body: x.body }; };
      if (sc.fore) await anropaFake(sc.fore, tokFor(sc.foreAnv || sc.anv));
      const fs_ = sc.rest
        ? restSvarFake(await fake.handle('POST', 'http://fake.lokal/rest/v1/store', { authorization: 'Bearer ' + tok, prefer: 'resolution=merge-duplicates' }, JSON.stringify([{ key: sc.rest.key, value: sc.rest.value }])))
        : sc.restLas ? restLasFake(await fake.handle('GET', 'http://fake.lokal/rest/v1/store?key=eq.' + encodeURIComponent(sc.restLas) + '&select=value', { authorization: 'Bearer ' + tok }, ''))
          : await anropaFake(body);
      let fUtfall; try { fUtfall = sc.utfall((k) => { const v = fake.store.get(k); return v === undefined ? null : clone(v); }, fs_, d); } catch (e) { fUtfall = 'fel: ' + e.message; }
      const R = Object.assign(sc.rest || sc.restLas ? omitRader(rs) : svarAv(rs), { utfall: rUtfall }), F = Object.assign(sc.rest || sc.restLas ? omitRader(fs_) : svarAv(fs_), { utfall: fUtfall });
      ut.push({ id: sc.id, sec: sc.sec, anv: sc.anv, ef: sc.ef || (sc.restLas ? 'rest/v1/store (GET)' : 'rest/v1/store'), replik: R, fake: F, lika: JSON.stringify(R) === JSON.stringify(F) });
    }
  } finally { r.stang(); }
  return ut;
}

module.exports = { korParitet, SCENARIER, FAKE_STD };
