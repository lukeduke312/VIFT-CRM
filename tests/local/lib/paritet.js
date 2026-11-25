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
  { id: 'MAT-01', sec: 'SEC-B1-05 (annans rad)', anv: 'falt', ef: 'ao-time-write', body: (d) => ({ action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-mat1', patch: { materials: [Object.assign({}, d.store.vift_workOrders.find((a) => a.id === 'AO-A1').materials[0], { qty: 9 })] } }), utfall: (las) => las('vift_workOrders').find((a) => a.id === 'AO-A1').materials[0].qty },
  { id: 'MAT-02', sec: 'SEC-B1-01 (egen rad)', anv: 'falt', ef: 'ao-time-write', body: (d) => ({ action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'par-mat2', patch: { materials: d.store.vift_workOrders.find((a) => a.id === 'AO-A1').materials.concat([{ id: 'M-PAR', name: 'x', qty: 1 }]) } }), utfall: (las) => { const m = las('vift_workOrders').find((a) => a.id === 'AO-A1').materials.find((x) => x.id === 'M-PAR'); return m ? m.addedBy : null; } },
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
  { id: 'KEY-03', sec: 'BLOCKER-2/PERM-03 (arbetsledare skriver kunder)', anv: 'chef', ef: 'store-key-write', fakeOpts: () => ({ keyPerms: serverKeyPerms() }), body: (d) => ({ action: 'writeMerge', key: 'vift_customers', upserts: [{ id: d.store.vift_customers[0].id, data: Object.assign({}, d.store.vift_customers[0], { name: 'x' }), previous: d.store.vift_customers[0] }], removals: [] }), utfall: (las) => las('vift_customers')[0].name },
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
/* Samma världsinställning som tests/staging_e2e_real.test.js (STAGING-lik simulerad server). */
const FAKE_STD = { logOps: true, activityAppend: true, activitiesPolicy: true };
const EF_LISTA = ['work-orders-list', 'ao-time-write', 'work-order-checklist-resolve', 'work-order-log-write', 'time-entries-list', 'store-key-write', 'invoice-write'];

function svarAv(s) { const b = s.body || {}; return { status: s.status, error: b.error === undefined ? null : b.error, reason: b.reason === undefined ? null : b.reason }; }
/* T3-C: REST-scenarier (POST /rest/v1/store med Prefer: resolution=merge-duplicates, som
   Storage.setRemoteStrict). Jämförs: status, PostgreSQL-kod och om felet är direct_write_blocked. */
function restSvarReplik(x) { return x.ok ? { status: 201, error: null, reason: null } : { status: x.status, error: x.code, reason: /direct_write_blocked/.test(x.message) ? 'direct_write_blocked' : null }; }
function restSvarFake(x) { const b = x.body || {}; if (x.status < 300) return { status: 201, error: null, reason: null }; return { status: x.status, error: b.code || null, reason: /direct_write_blocked/.test(JSON.stringify(b)) ? 'direct_write_blocked' : null }; }

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
      if (sc.fore) await ef.anropa(sc.ef, { user: d.U[sc.foreAnv || sc.anv], body: sc.fore });
      const rs = sc.rest
        ? restSvarReplik(asUser(r.db, d.U[sc.anv], `insert into public.store(key, value) values (${lit(sc.rest.key)}, ${jlit(sc.rest.value)}) on conflict (key) do update set value = excluded.value`))
        : await ef.anropa(sc.ef, { user: d.U[sc.anv], body });
      const rUtfall = sc.utfall((k) => val(r.db, k), rs, d);
      // ── fake ──
      const fake = new FakeSupabase(Object.assign({}, FAKE_STD, (typeof sc.fakeOpts === 'function' ? sc.fakeOpts() : sc.fakeOpts) || {}));
      fake.store = new Map(Object.entries(clone(d.store)));
      fake.users = {};
      d.anvandare.forEach((u) => { fake.users[u.email] = { id: u.authId, email: u.email, password: 'replik', alias: u.alias, active: u.appActive }; });
      const tokFor = (alias) => fake.issue(fake.users[d.U[alias].email]).access_token;
      const tok = tokFor(sc.anv);
      const anropaFake = async (b, t) => { const x = await fake.handle('POST', 'http://fake.lokal/functions/v1/' + sc.ef, { authorization: 'Bearer ' + (t || tok) }, JSON.stringify(b)); return { status: x.status, body: x.body }; };
      if (sc.fore) await anropaFake(sc.fore, tokFor(sc.foreAnv || sc.anv));
      const fs_ = sc.rest
        ? restSvarFake(await fake.handle('POST', 'http://fake.lokal/rest/v1/store', { authorization: 'Bearer ' + tok, prefer: 'resolution=merge-duplicates' }, JSON.stringify([{ key: sc.rest.key, value: sc.rest.value }])))
        : await anropaFake(body);
      let fUtfall; try { fUtfall = sc.utfall((k) => { const v = fake.store.get(k); return v === undefined ? null : clone(v); }, fs_, d); } catch (e) { fUtfall = 'fel: ' + e.message; }
      const R = Object.assign(sc.rest ? rs : svarAv(rs), { utfall: rUtfall }), F = Object.assign(sc.rest ? fs_ : svarAv(fs_), { utfall: fUtfall });
      ut.push({ id: sc.id, sec: sc.sec, anv: sc.anv, ef: sc.ef || 'rest/v1/store', replik: R, fake: F, lika: JSON.stringify(R) === JSON.stringify(F) });
    }
  } finally { r.stang(); }
  return ut;
}

module.exports = { korParitet, SCENARIER, FAKE_STD };
