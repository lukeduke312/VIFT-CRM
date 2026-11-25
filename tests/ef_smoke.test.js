'use strict';
/*
 * T3-0: körbara EF-tester (inte bara syntax). Positiva flöden (smoke) för åtta Edge
 * Functions, transpilerade med tsc och körda i Node mot den lokala STAGING-replikan
 * (migrationskedjan + syntetiska data). Riktig vift-auth (checkViftAuth), riktiga RPC:er
 * och RLS/triggers i lokal PostgreSQL 16. Ingen Deno (se T3-RESULTAT, PG17/Deno).
 * Lokalt verifierat — inte ett STAGING-bevis. Grund för T3-B–D.
 */
const { ok, krav, avsluta } = require('./local/lib/test');
krav({ tsc: true });
const { byggReplik } = require('./local/lib/replik');
const { laddaEf } = require('./local/lib/ef');
const { val, q, psql } = require('./local/lib/db');
const { expectAccept } = require('./local/lib/kontroll');

const EF = ['ao-time-write', 'work-orders-list', 'store-key-write', 'time-entries-list', 'work-order-checklist-resolve', 'work-order-log-write', 'invoice-write', 'offer-respond'];

(async () => {
  const r = byggReplik({});
  // T3-B: hela repokedjan inklusive de nya migrationerna; deras objekt är förklarade via
  // tests/local/t3-andringar.json (md5-kontrollerade). STAGING-baslinjen: replica_build.test.js.
  const t3n = Object.keys(require('./local/t3-andringar.json').objekt).length;
  // T3-C: vift_store_project(3 argument), tidigare "samma kod" bland de 7 kända, ersätts av en
  // registrerad T3-C-signatur → 6 kända + T3-objekten (samma −1 som i T3-B).
  ok(r.rapport.oforklarade === 0 && r.rapport.forklarade === 6 + t3n - 1, 'replikan byggd (repokedjan med T3-B och T3-C): ' + r.rapport.identiska + ' identiska, ' + r.rapport.forklarade + ' förklarade (6 kända + T3-B/T3-C), 0 oförklarade mot STAGING-facit');
  const U = r.U, db = r.db;
  const ef = await laddaEf(db, EF);
  ok(EF.every((s) => typeof ef.handlers[s] === 'function'), 'alla ' + EF.length + ' EF transpilerade och laddade (riktig källa ur supabase/functions)');
  const aoIds = () => (val(db, 'vift_workOrders') || []).map((a) => a.id);
  const aoById = (id) => (val(db, 'vift_workOrders') || []).find((a) => a.id === id);

  // ── work-orders-list ──
  let s = await ef.anropa('work-orders-list', { user: U.admin });
  ok(s.status === 200 && s.body.workOrders.length === aoIds().length && s.body.workOrders.some((a) => a.accessCode), 'work-orders-list admin: alla AO, med accessCode (ao_edit/all)');
  s = await ef.anropa('work-orders-list', { user: U.ekonomi });
  ok(s.status === 200 && s.body.workOrders.length === aoIds().length && s.body.workOrders.every((a) => !('accessCode' in a)), 'work-orders-list ekonomi: alla AO, accessCode borttagen (C-5)');
  s = await ef.anropa('work-orders-list', { user: U.falt });
  ok(s.status === 200 && ['AO-N1', 'AO-A1', 'AO-A2'].every((id) => s.body.workOrders.some((a) => a.id === id)) && !s.body.workOrders.some((a) => a.id === 'AO-A8'), 'work-orders-list fält: egna AO med, annans tilldelade (AO-A8) inte');
  s = await ef.anropa('work-orders-list', { user: U.tom });
  ok(s.status === 200 && s.body.workOrders.length === 0, 'work-orders-list tom roll: tom lista');
  s = await ef.anropa('work-orders-list', { user: U.avstangd });
  ok(s.status === 403 && s.body.error === 'Forbidden', 'work-orders-list avstängd (app_users.active=false): 403 Forbidden');

  // ── time-entries-list ──
  s = await ef.anropa('time-entries-list', { user: U.ekonomi });
  ok(s.status === 200 && s.body.timeEntries.length === 3, 'time-entries-list ekonomi (payroll_view): alla 3');
  s = await ef.anropa('time-entries-list', { user: U.falt });
  ok(s.status === 200 && s.body.timeEntries.length === 2 && s.body.timeEntries.every((t) => t.staffId === U.falt.staffId), 'time-entries-list fält: bara egna (2)');

  // ── ao-time-write ──
  let a = await expectAccept(db, () => ef.anropa('ao-time-write', { user: U.chef, body: { action: 'create_ao', idempotencyKey: 'smoke-create-1', ao: { title: 'Smoke-AO', status: 'nytt', staff: [], customerId: 'CU-R2' } } }), { status: 200 }, { keys: ['vift_workOrders', 'vift_timeEntries'], tables: ['op_idempotency'] }, ['store:vift_workOrders', 'tabell:op_idempotency']);
  const nyId = a.svar.body && a.svar.body.workOrder && a.svar.body.workOrder.id;
  ok(a.ok && nyId && aoIds().includes(nyId), 'ao-time-write create_ao (chef): 200, AO skapad, bara vift_workOrders/op_idempotency ändrade', a.fel);
  s = await ef.anropa('ao-time-write', { user: U.chef, body: { action: 'create_ao', idempotencyKey: 'smoke-create-1', ao: { title: 'Smoke-AO', status: 'nytt', staff: [], customerId: 'CU-R2' } } });
  ok(s.status === 200 && s.body.workOrder.id === nyId && aoIds().filter((x) => x === nyId).length === 1, 'create_ao repris med samma idempotensnyckel: samma AO, ingen dubblett');
  s = await ef.anropa('ao-time-write', { user: U.chef, body: { action: 'patch_ao', aoId: nyId, idempotencyKey: 'smoke-patch-1', patch: { title: 'Smoke-AO ändrad', staff: [U.falt.staffId], status: 'planerad' } } });
  ok(s.status === 200 && aoById(nyId).title === 'Smoke-AO ändrad' && aoById(nyId).staff[0] === U.falt.staffId, 'patch_ao (chef, ao_edit): titel, personal och status sparade');
  s = await ef.anropa('ao-time-write', { user: U.falt, body: { action: 'patch_ao', aoId: nyId, idempotencyKey: 'smoke-start-1', patch: { status: 'pågående' } } });
  ok(s.status === 200 && aoById(nyId).status === 'pågående', 'patch_ao (fält) starta egen planerad AO: 200, pågående');
  a = await expectAccept(db, () => ef.anropa('ao-time-write', { user: U.falt, body: { action: 'create_time', idempotencyKey: 'smoke-time-1', entry: { id: 'TE-SMOKE-1', aoId: nyId, date: '2026-11-24', hours: 1.25 } } }), { status: 200 }, { keys: ['vift_workOrders', 'vift_timeEntries'] }, ['store:vift_workOrders', 'store:vift_timeEntries']);
  const te = (val(db, 'vift_timeEntries') || []).find((t) => t.id === 'TE-SMOKE-1');
  ok(a.ok && te && te.staffId === U.falt.staffId && te.staffName === 'Filip Fält' && aoById(nyId).timeEntries.includes('TE-SMOKE-1'), 'create_time (fält, egen AO): tidpost med serverhärledd identitet, länkad i AO:n', a.fel);
  s = await ef.anropa('ao-time-write', { user: U.falt, body: { action: 'patch_time', entryId: 'TE-SMOKE-1', idempotencyKey: 'smoke-ptime-1', patch: { hours: 2 } } });
  ok(s.status === 200 && (val(db, 'vift_timeEntries') || []).find((t) => t.id === 'TE-SMOKE-1').hours === 2, 'patch_time (egen post): 200');
  s = await ef.anropa('ao-time-write', { user: U.ekonomi, body: { action: 'attest_time', entryId: 'TE-SMOKE-1', attested: true, idempotencyKey: 'smoke-att-1' } });
  ok(s.status === 200 && (val(db, 'vift_timeEntries') || []).find((t) => t.id === 'TE-SMOKE-1').attested === true, 'attest_time (ekonomi, payroll_manage): 200, attesterad');
  s = await ef.anropa('ao-time-write', { user: U.falt, body: { action: 'patch_ao', aoId: nyId, idempotencyKey: 'smoke-klar-1', patch: { status: 'klar', completedBy: U.falt.staffId } } });
  ok(s.status === 200 && aoById(nyId).status === 'klar', 'patch_ao (fält, ao_complete) klarmarkera egen pågående AO: 200');
  s = await ef.anropa('ao-time-write', { user: U.chef, body: { action: 'delete_ao', aoId: nyId, idempotencyKey: 'smoke-del-1' } });
  ok(s.status === 200 && aoById(nyId).deleted === true, 'delete_ao (chef): mjuk borttagning');

  // ── store-key-write ──
  s = await ef.anropa('store-key-write', { user: U.falt, body: { action: 'readAllWithHashes', keys: ['vift_customers', 'vift_staff', 'vift_settings', 'vift_offers'] } });
  ok(s.status === 200 && Array.isArray(s.body.data.staff) && s.body.data.customers.map((c) => c.id).join() === 'CU-R1' && s.body.data.customers.every((c) => !('personnr' in c)) && !('orgNr' in s.body.data.customers.find((c) => c.type === 'privat'))
    && !('bankgiro' in s.body.data.settings) && !('internalHourlyCost' in s.body.data.settings) && s.body.data.offers.every((o) => !('publicToken' in o) && !('lines' in o)), 'readAllWithHashes (fält): projicerat enligt C-5 och T3-D — bara kunden för egna AO (D-13), utan personnr, inget bankgiro/internt timpris, offerter bara som referens', JSON.stringify(s.body.data.customers).slice(0, 300));
  s = await ef.anropa('store-key-write', { user: U.chef, body: { action: 'readWithHash', key: 'vift_customers' } });
  ok(s.status === 200 && s.body.value.length === 3 && typeof s.body.hash === 'string', 'readWithHash vift_customers (chef, customer_manage): fullt värde + hash');
  const ny = { id: 'CU-SMOKE', type: 'foretag', name: 'Smoke AB', orgNr: '556000-0001', active: true };
  a = await expectAccept(db, () => ef.anropa('store-key-write', { user: U.chef, body: { action: 'writeMerge', key: 'vift_customers', upserts: [{ id: 'CU-SMOKE', data: ny, previous: null }], removals: [] } }), { status: 200 }, { keys: ['vift_customers', 'vift_workOrders'] }, ['store:vift_customers']);
  ok(a.ok && val(db, 'vift_customers').some((c) => c.id === 'CU-SMOKE'), 'writeMerge vift_customers (chef): ny kund, bara vift_customers ändrad', a.fel);
  s = await ef.anropa('store-key-write', { user: U.falt, body: { action: 'appendActivity', entry: { id: 'ACT-smoke-0001', type: 'work_order_status', workOrderId: 'AO-A1', description: 'Status ändrad' } } });
  ok(s.status === 200 && (val(db, 'vift_activityLog') || []).length === 3, 'appendActivity (fält): en post tillagd i vift_activityLog', s.body);
  s = await ef.anropa('store-key-write', { user: U.falt, body: { action: 'getStampStatus' } });
  ok(s.status === 200 && s.body.hasRow === false && s.body.revision === 0, 'getStampStatus: ingen rad ännu');
  s = await ef.anropa('store-key-write', { user: U.falt, body: { action: 'setStampStatus', active: true, ts: 1764000000000, aoId: 'AO-A2', expectedRevision: 0 } });
  ok(s.status === 200 && s.body.active === true && s.body.revision === 1 && q(db, 'select * from stamp_status').length === 1, 'setStampStatus (fält, egen AO): instämplad, revision 1');
  s = await ef.anropa('store-key-write', { user: U.falt, body: { action: 'setStampStatus', active: false, expectedRevision: 1 } });
  ok(s.status === 200 && s.body.active === false && s.body.revision === 2, 'setStampStatus utstämpling: revision 2');

  // ── work-order-checklist-resolve ──
  s = await ef.anropa('work-order-checklist-resolve', { user: U.falt, body: { aoId: 'AO-A2', itemId: 'AO-A2-C1', action: 'done' } });
  const ci = aoById('AO-A2').checklist.find((c) => c.id === 'AO-A2-C1');
  ok(s.status === 200 && s.body.protocol === 2 && ci && (ci.state === 'done' || ci.done === true), 'checklist-resolve done (fält, egen AO): 200, punkten klar', s.body);
  s = await ef.anropa('work-order-checklist-resolve', { user: U.falt, body: { aoId: 'AO-A2', itemId: 'NY-PUNKT-1', action: 'add', text: 'Extra kontroll' } });
  ok(s.status === 200 && aoById('AO-A2').checklist.some((c) => c.id === 'NY-PUNKT-1'), 'checklist-resolve add (fält): ny punkt', s.body);

  // ── work-order-log-write ──
  s = await ef.anropa('work-order-log-write', { user: U.falt, body: { action: 'append_log', aoId: 'AO-A2', entry: { id: 'LOGG-SMOKE-1', type: 'note', text: 'Smoke-logg', timestamp: new Date().toISOString() } } });
  const le = aoById('AO-A2').log.find((e) => e.id === 'LOGG-SMOKE-1');
  ok(s.status === 200 && le && le.staffId === U.falt.staffId, 'log-write append_log (fält, egen AO): posten sparad med serverns staffId', s.body);
  s = await ef.anropa('work-order-log-write', { user: U.falt, body: { action: 'remove_log', aoId: 'AO-A2', entryId: 'LOGG-SMOKE-1' } });
  ok(s.status === 200 && !aoById('AO-A2').log.some((e) => e.id === 'LOGG-SMOKE-1'), 'log-write remove_log (egen post): borttagen');

  // ── invoice-write ──
  const inv = () => val(db, 'vift_invoices').find((i) => i.id === 'INV-R2');
  s = await ef.anropa('invoice-write', { user: U.chef, body: { action: 'lineAdd', invoiceId: 'INV-R2', expectedRevision: 0, line: { id: 'SL1', description: 'Smoke-rad', qty: 2, unit: 'h', unitPrice: 500, vatRate: 25 } } });
  ok(s.status === 200 && inv().lines.length === 1 && inv().revision === 1, 'invoice-write lineAdd (chef): rad tillagd, revision 0→1', s.body);
  s = await ef.anropa('invoice-write', { user: U.chef, body: { action: 'metaUpdate', invoiceId: 'INV-R2', expectedRevision: 1, patch: { customerReference: 'Ref-smoke' } } });
  ok(s.status === 200 && inv().customerReference === 'Ref-smoke' && inv().revision === 2, 'invoice-write metaUpdate: 200, revision 2', s.body);
  s = await ef.anropa('invoice-write', { user: U.chef, body: { action: 'lineAdd', invoiceId: 'INV-R2', expectedRevision: 1, line: { id: 'SL2', description: 'x', qty: 1, unitPrice: 1, vatRate: 25 } } });
  ok(s.status === 409 && s.body.error === 'stale_write' && inv().lines.length === 1, 'invoice-write inaktuell revision: 409 stale_write, inget ändrat');
  s = await ef.anropa('invoice-write', { user: U.chef, body: { action: 'draftDelete', invoiceId: 'INV-R2', expectedRevision: 2 } });
  ok(s.status === 200 && !val(db, 'vift_invoices').some((i) => i.id === 'INV-R2'), 'invoice-write draftDelete: utkastet borttaget', s.body);

  // ── offer-respond (publik) ──
  const off = (id) => val(db, 'vift_offers').find((o) => o.id === id);
  s = await ef.anropa('offer-respond', { headers: { 'x-forwarded-for': '198.51.100.1' }, body: { token: off('OFF-R1').publicToken, action: 'approve', offerVersion: 1, name: 'Kalle Kund', email: 'kalle.kund@example.test', agreedToTerms: true, requestId: 'smoke-req-1' } });
  ok(s.status === 200 && s.body.ok === true && /godk/.test(off('OFF-R1').status), 'offer-respond approve: 200, offerten godkänd', s.body);
  ok((val(db, 'vift_offerEvents') || []).some((e) => e.offerId === 'OFF-R1'), 'offer-respond: händelse i vift_offerEvents');
  ok((val(db, 'vift_notifications') || []).some((n) => String(n.id || '').includes('OFF-R1') || JSON.stringify(n).includes('OFF-R1')), 'offer-respond: in-app-notis till offer_manage/all (REPO-BEVARAT 3)');
  const evAntal = (val(db, 'vift_offerEvents') || []).length;
  s = await ef.anropa('offer-respond', { headers: { 'x-forwarded-for': '198.51.100.1' }, body: { token: off('OFF-R1').publicToken, action: 'approve', offerVersion: 1, name: 'Kalle Kund', email: 'kalle.kund@example.test', agreedToTerms: true, requestId: 'smoke-req-1' } });
  ok(s.status === 200 && s.body.replay === true && (val(db, 'vift_offerEvents') || []).length === evAntal, 'offer-respond repris (samma requestId): replay, inga nya händelser');
  s = await ef.anropa('offer-respond', { headers: { 'x-forwarded-for': '198.51.100.2' }, body: { token: off('OFF-R3').publicToken, action: 'change_request', offerVersion: 1, name: 'Brf Styrelse', email: 'styrelse@example.test', comment: 'Ändra tidplan', changeCategory: 'tidplan', requestId: 'smoke-req-2' } });
  ok(s.status === 200 && s.body.ok === true, 'offer-respond change_request: 200', s.body);

  // Inga direkta store-skrivningar mot skyddade nycklar från EF:erna (bara via RPC).
  const direkt = ef.sqlLogg.filter((x) => /^(insert|update|delete)/.test(x) && /vift_(workOrders|timeEntries|invoices)/.test(x));
  ok(direkt.length === 0, 'inga direkta skrivningar mot vift_workOrders/timeEntries/invoices utanför RPC', direkt);
  r.stang();
  avsluta();
})().catch((e) => { ok(false, 'krasch: ' + (e.stack || e)); avsluta(); });
