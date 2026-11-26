'use strict';
/*
 * T3-B (2026-11-28): AO-kärnan och arbetspoolen, GODKÄNDA SÄKERHETSTESTER efter rättning.
 * Vänder baslinjefynden SÄK-3, -4, -5, -11, -12, -15, -16 (tests/baslinje_sakerhet.test.js,
 * som nu körs mot den historiska källan fb71f26) till tester av den rättade koden.
 *
 * Mot den lokala STAGING-replikan med HELA repokedjan (inklusive de nya migrationerna
 * 20261128000001–03) och de ändrade Edge Functions körda i Node. Varje negativt fall
 * kontrollerar exakt status, error och reason (BEHORIGHETSMATRIS §4) OCH oförändrad
 * kontrollsumma (store-nycklar + op_idempotency + stamp_status). Samtidighetsfall körs
 * med egna anslutningar (barriär i EF-harnessen eller parallella psql-processer).
 *
 * Lokalt verifierat (PostgreSQL 16, EF i Node). Inget är prövat i STAGING.
 */
const fs = require('fs');
const path = require('path');
const { ok, krav, avsluta } = require('./local/lib/test');
krav({ tsc: true });
const { byggReplik } = require('./local/lib/replik');
const { laddaEf, jwtFor } = require('./local/lib/ef');
const { val, q, psql, rpc, rpcAsync, lit, jlit } = require('./local/lib/db');
const { expectReject, expectAccept, ksTa, ksDiff } = require('./local/lib/kontroll');

const EF = ['ao-time-write', 'work-orders-list', 'store-key-write', 'work-order-checklist-resolve', 'work-order-log-write',
  'work-order-image-upload', 'work-order-image-delete', 'work-order-image-url', 'invoice-write', 'time-entries-list', 'service-monitor'];
const KS = { keys: ['vift_workOrders', 'vift_timeEntries', 'vift_invoices'], tables: ['op_idempotency', 'stamp_status'] };
const nyckel = (() => { let i = 0; return (p) => (p || 't3b') + '-' + (++i) + '-' + Math.random().toString(36).slice(2, 8); })();

(async () => {
  const r = byggReplik({});
  const { db, U } = r;
  ok(r.steg.some((s) => s.rel.includes('20261128000001')) && r.steg.some((s) => s.rel.includes('20261128000003')), 'kedjan innehåller T3-B-migrationerna 20261128000001–03');
  ok(r.rapport.oforklarade === 0, `schemajämförelse: 0 oförklarade (T3-B-objekten förklarade via t3-andringar.json): ${r.rapport.identiska} identiska, ${r.rapport.forklarade} förklarade`);

  // ── Extra testdata: egna roller (D-26) och prisgrupper ───────────────
  const roller = val(db, 'vift_roles');
  const faltNy = ['dashboard_view', 'ao_view_own', 'ao_start_own', 'ao_complete_own', 'ao_pool_take', 'ao_time', 'ao_material', 'ao_checklist'];
  const extraRoller = [
    { id: 'falt_ny', label: 'Fält med nya behörigheter (egen)', permissions: faltNy },
    { id: 'falt_utan_pool', label: 'personal − ao_pool_take (egen)', permissions: faltNy.filter((p) => p !== 'ao_pool_take') },
    { id: 'falt_utan_klar', label: 'personal − ao_complete_own (egen)', permissions: faltNy.filter((p) => p !== 'ao_complete_own') },
    { id: 'falt_utan_start', label: 'personal − ao_start_own (egen)', permissions: faltNy.filter((p) => p !== 'ao_start_own') },
    { id: 'begransad_tid', label: 'begransad + ao_time (egen)', permissions: ['dashboard_view', 'ao_view_own', 'ao_time'] },
  ].map((x) => Object.assign({ isBuiltin: false, active: true }, x));
  const nyaAnv = [['faltny', 'ST-R21', 'falt_ny'], ['faltutanpool', 'ST-R22', 'falt_utan_pool'], ['faltutanklar', 'ST-R23', 'falt_utan_klar'],
    ['faltutanstart', 'ST-R24', 'falt_utan_start'], ['begransadtid', 'ST-R25', 'begransad_tid']].map(([alias, staffId, role], i) => ({
    alias, staffId, role, email: alias + '@example.test', authId: '00000000-0000-4000-8000-0000000002' + String(i + 1).padStart(2, '0'), firstName: 'Test', lastName: alias }));
  const sqlU = ['begin;'];
  for (const u of nyaAnv) {
    U[u.alias] = u;
    sqlU.push(`insert into auth.users(id, email) values (${lit(u.authId)}, ${lit(u.email)});`);
    sqlU.push(`insert into public.app_users(user_id, staff_id, role_id, active, is_admin) values (${lit(u.authId)}, ${lit(u.staffId)}, ${lit(u.role)}, true, false);`);
  }
  const staff = val(db, 'vift_staff').concat(nyaAnv.map((u) => ({ id: u.staffId, firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, active: true })));
  sqlU.push(`update public.store set value = ${jlit(staff)} where key = 'vift_staff';`);
  sqlU.push(`update public.store set value = ${jlit(roller.concat(extraRoller))} where key = 'vift_roles';`);
  sqlU.push(`insert into public.store(key, value) values ('vift_priceGroups', ${jlit([{ id: 'PG-R1', name: 'Ordinarie', hourRate: 650 }, { id: 'PG-R2', name: 'Jour', hourRate: 975 }])}) on conflict (key) do update set value = excluded.value;`);
  sqlU.push('commit;');
  psql(db, sqlU.join('\n'));
  psql(db, `create table public._t3b_bas as select * from public.store; create table public._t3b_idem as select * from public.op_idempotency;`);
  const aterstall = () => psql(db, `begin; delete from public.store; insert into public.store select * from public._t3b_bas; delete from public.op_idempotency; insert into public.op_idempotency select * from public._t3b_idem; delete from public.stamp_status; commit;`);
  const ef = await laddaEf(db, EF, { env: { SERVICE_MONITOR_SECRET: 'lokal-monitor-test' } });
  const ao = (id) => (val(db, 'vift_workOrders') || []).find((a) => a.id === id);
  const te = (id) => (val(db, 'vift_timeEntries') || []).find((t) => t.id === id);
  const F = U.falt.staffId, F2 = U.falt2.staffId;
  const AW = (user, body) => ef.anropa('ao-time-write', { user, body: Object.assign({ idempotencyKey: nyckel() }, body) });
  const NEJ = async (namn, anrop, forv, ks) => { const x = await expectReject(db, anrop, forv, ks || KS); ok(x.ok, namn, x.fel.concat([JSON.stringify(x.svar.body).slice(0, 300)])); return x; };
  const JA = async (namn, anrop, skaAndras, ks) => { const x = await expectAccept(db, anrop, { status: 200 }, ks || KS, skaAndras); ok(x.ok, namn, x.fel.concat([JSON.stringify(x.svar.body).slice(0, 300)])); return x; };

  // ════════════════ SÄK-3 / SÄK-16: utlämning och poolprojektion ════════════════
  const lista = async (user) => { const s = await ef.anropa('work-orders-list', { user }); return (s.body.workOrders || []); };
  let L = await lista(U.falt);
  const ids = (l) => l.map((a) => a.id).sort().join(',');
  ok(ids(L) === ['AO-A1', 'AO-A2', 'AO-A3', 'AO-A5', 'AO-A9', 'AO-N1', 'AO-P1', 'AO-P4', 'AO-SI1'].join(','), 'SEC-POOL-01/SEC-AO-01: fält (äldre roll, övergångsregel) ser egna (utom arkiverade/borttagna) + öppen pool P1, P4, SI1', ids(L));
  ok(!L.some((a) => ['AO-P2', 'AO-P3', 'AO-P5', 'AO-P6', 'AO-N2', 'AO-A4', 'AO-A8', 'AO-A6', 'AO-A7'].includes(a.id)), 'SÄK-3/SÄK-16 rättad: P2/P3 (annans personal), P5/P6 (arkiverad/borttagen), N2, andras AO och egna arkiverade/borttagna lämnas inte ut');
  const p1 = L.find((a) => a.id === 'AO-P1');
  const forbjudna = ['phone', 'contactEmail', 'contactPerson', 'accessCode', 'customerName', 'customerId', 'propertyName', 'objectName', 'fixedPrice', 'priceType'];
  ok(p1 && p1.poolProjection === true && forbjudna.every((f) => !(f in p1)) && p1.log.length === 0 && p1.materials.length === 0 && p1.checklist.length === 0,
    'SEC-POOL-04 (K-03): öppen pool lämnas ut projicerad — inga kontakter, portkod, kund, priser, logg, material eller checklista', p1 && Object.keys(p1));
  ok(p1 && p1.title && p1.description && p1.address && p1.city && p1.priority && p1.category && 'estimatedHours' in p1, 'K-03: titel, beskrivning, adress, ort, prioritet, kategori och tidsåtgång finns i projektionen');
  ok(L.find((a) => a.id === 'AO-SI1').dueDate === '2026-12-15' && L.find((a) => a.id === 'AO-P4').dueDate === '2026-12-02', 'K-03/Q1: förfallodatum (dueDate, annars scheduledDate på pool-AO) finns i projektionen');
  ok(L.find((a) => a.id === 'AO-A1').phone && !('poolProjection' in L.find((a) => a.id === 'AO-A1')), 'egna tilldelade AO lämnas ut fullständigt (ingen projektion)');
  L = await lista(U.falt2);
  ok(['AO-P2', 'AO-P3', 'AO-A4', 'AO-A8'].every((id) => L.some((a) => a.id === id && !a.poolProjection)), 'FÄ2 ser sina tilldelade pool-AO (P2, P3) fullständigt');
  ok((await lista(U.begransad)).length === 0, 'SEC-POOL-03/SEC-AO-02: begränsad (bara ao_view_own) ser ingen öppen pool');
  ok(!(await lista(U.faltutanpool)).some((a) => a.status === 'pool'), 'SEC-POOL-03/SEC-CUST-09: egen roll personal − ao_pool_take ser ingen öppen pool');
  ok(ids(await lista(U.faltny)) === 'AO-P1,AO-P4,AO-SI1', 'egen roll med uttryckligt ao_pool_take (inga tilldelningar) ser exakt öppen pool');
  ok((await lista(U.chef)).length === 18 && (await lista(U.ekonomi)).length === 18, 'SEC-AO-04: arbetsledare och ekonomi (ao_view_all) ser alla 18 AO');
  // Ingen breddning (ARBETSPOOL-UTREDNING §5.4): för varje användare och AO gäller ny ⊆ gammal regel.
  const allaAO = val(db, 'vift_workOrders');
  let bredd = [];
  for (const anv of Object.values(U)) {
    if (!anv.authId) continue;
    const s = await ef.anropa('work-orders-list', { user: anv });
    if (s.status !== 200) continue;
    const perms = (val(db, 'vift_roles').find((x) => x.id === val(db, 'vift_staff').find((y) => y.id === anv.staffId).role) || { permissions: [] }).permissions;
    const allt = perms.includes('all') || perms.includes('ao_view_all');
    for (const a of s.body.workOrders) {
      const g = allaAO.find((x) => x.id === a.id);
      const gammal = allt || (perms.includes('ao_view_own') && ((g.staff || []).includes(anv.staffId) || g.status === 'pool'));
      if (!gammal) bredd.push(anv.alias + ':' + a.id);
    }
  }
  ok(bredd.length === 0, 'L6/AP-A: ingen breddning — varje utlämnad AO, för varje användare, lämnades ut även av den gamla regeln', bredd);
  let s = await ef.anropa('work-order-image-url', { user: U.falt, body: { aoId: 'AO-P1', paths: ['AO-P1/a.jpg'] } });
  ok(s.status === 403 && s.body.error === 'forbidden' && s.body.reason === 'not_assigned', 'L7/K-03: bild-URL för öppen pool kräver tilldelning (403 forbidden/not_assigned)', s);
  s = await ef.anropa('work-order-image-url', { user: U.falt, body: { aoId: 'AO-P2', paths: ['AO-P2/a.jpg'] } });
  ok(s.status === 403 && s.body.reason === 'not_assigned', 'L7: bild-URL för annans pool-AO (P2) nekas', s);

  // ════════════════ SÄK-4: "Ta jobbet" (work_order_pool_take) ════════════════
  const ta = (user, aoId, extra) => AW(user, Object.assign({ action: 'take_from_pool', aoId }, extra || {}));
  await NEJ('SEC-POOL-06/T2: ta P2 (har personal) → 409 already_assigned, ingen mutation', () => ta(U.falt, 'AO-P2'), { status: 409, error: 'already_assigned', reason: null });
  await NEJ('SEC-POOL-07/T3: ta N2 (inte tillgängliggjord) → 403 forbidden/pool_not_open', () => ta(U.falt, 'AO-N2'), { status: 403, error: 'forbidden', reason: 'pool_not_open' });
  await NEJ('SEC-POOL-07/T4: ta arkiverad P5 → 403 forbidden/pool_not_open', () => ta(U.falt, 'AO-P5'), { status: 403, error: 'forbidden', reason: 'pool_not_open' });
  await NEJ('T4: ta borttagen P6 → 403 forbidden/pool_not_open', () => ta(U.falt, 'AO-P6'), { status: 403, error: 'forbidden', reason: 'pool_not_open' });
  await NEJ('ta egen planerad A1 (har personal) → 409 already_assigned', () => ta(U.falt, 'AO-A1'), { status: 409, error: 'already_assigned', reason: null });
  await NEJ('ta AO som inte finns → 404 not_found', () => ta(U.falt, 'AO-FINNS-INTE'), { status: 404, error: 'not_found', reason: null });
  await NEJ('SEC-POOL-10/T5: begränsad tar P1 → 403 forbidden', () => ta(U.begransad, 'AO-P1'), { status: 403, error: 'forbidden', reason: null });
  await NEJ('SEC-POOL-10: ekonomi tar P1 → 403 forbidden', () => ta(U.ekonomi, 'AO-P1'), { status: 403, error: 'forbidden', reason: null });
  await NEJ('SEC-CUST-09/T6: personal − ao_pool_take tar P1 → 403 forbidden (ingen koppling till ao_complete/ao_time)', () => ta(U.faltutanpool, 'AO-P1'), { status: 403, error: 'forbidden', reason: null });
  const p1Fore = ao('AO-P1');
  let x = await JA('SEC-POOL-05/T1: fält tar P1 → 200', () => ta(U.falt, 'AO-P1', { staff: [F2], status: 'klar' }), ['store:vift_workOrders', 'tabell:op_idempotency']);
  let a = ao('AO-P1');
  ok(JSON.stringify(a.staff) === JSON.stringify([F]) && a.poolOpen === false && a.status === 'planerad', 'T1: servern sätter staff=[FÄ], poolOpen=false, status planerad (AP-G övergång)', a);
  ok(a.log.length === p1Fore.log.length + 1 && JSON.stringify(a.log.slice(0, -1)) === JSON.stringify(p1Fore.log) && a.log[a.log.length - 1].type === 'taken_from_pool' && a.log[a.log.length - 1].staffId === F,
    'T1: exakt en taken_from_pool-post tillagd sist (servern sätter aktör och tid), övriga loggposter orörda');
  ok(JSON.stringify(x.svar.body.ignoredFields) === JSON.stringify(['staff', 'status']), 'T9: klientens staff/status i kroppen ignoreras och redovisas (ignoredFields)', x.svar.body);
  L = await lista(U.falt2);
  ok(!L.some((b) => b.id === 'AO-P1'), 'SEC-POOL-05: P1 försvinner ur FÄ2:s pool efter tagningen');
  await NEJ('SEC-POOL-14: FÄ2 tar P1 som just tagits (inaktuell klient) → 409 already_assigned', () => ta(U.falt2, 'AO-P1'), { status: 409, error: 'already_assigned', reason: null });
  // Idempotens: samma nyckel och samma aktör återspelas; samma nyckel, annan aktör → 409.
  aterstall();
  const kTa = nyckel('ta');
  const t1 = await AW(U.falt, { action: 'take_from_pool', aoId: 'AO-P4', idempotencyKey: kTa });
  const ks1 = ksTa(db, KS);
  const t2 = await AW(U.falt, { action: 'take_from_pool', aoId: 'AO-P4', idempotencyKey: kTa });
  ok(t1.status === 200 && t2.status === 200 && JSON.stringify(t1.body.workOrder) === JSON.stringify(t2.body.workOrder) && ksDiff(ks1, ksTa(db, KS)).length === 0 && ao('AO-P4').log.filter((l) => l.type === 'taken_from_pool').length === 1,
    'T8: samma anrop med samma idempotensnyckel ger samma svar, ingen dubbel loggpost, KS oförändrad');
  await NEJ('SÄK-12: samma tagningsnyckel från annan aktör → 409 idempotency_key_conflict', () => AW(U.falt2, { action: 'take_from_pool', aoId: 'AO-P4', idempotencyKey: kTa }), { status: 409, error: 'idempotency_key_conflict', reason: null });
  // v3.4-klientens form ("Ta jobbet" som patch_ao) går genom samma atomiska regel.
  aterstall();
  const v34 = (user, id) => { const b = ao(id); return AW(user, { action: 'patch_ao', aoId: id, patch: { staff: (b.staff || []).concat([user.staffId]), status: 'planerad', log: (b.log || []).concat([{ id: 'V34-' + user.staffId, type: 'taken_from_pool', text: 'x', timestamp: '2026-11-28T08:00:00.000Z' }]) } }); };
  await NEJ('v3.4-form: ta P2 via patch_ao → 409 already_assigned', () => v34(U.falt, 'AO-P2'), { status: 409, error: 'already_assigned', reason: null });
  await JA('v3.4-form: ta P1 via patch_ao → 200 (samma regel under lås)', () => v34(U.falt, 'AO-P1'), ['store:vift_workOrders', 'tabell:op_idempotency']);
  ok(JSON.stringify(ao('AO-P1').staff) === JSON.stringify([F]) && ao('AO-P1').log.slice(-1)[0].id === 'V34-' + F && ao('AO-P1').poolOpen === false, 'v3.4-form: loggpostens id från klienten behålls, servern sätter resten');
  // Samtidighet: SEC-POOL-09 (20 upprepningar, FÄ + FÄ2 via EF, barriär före RPC:n).
  let fel09 = [];
  for (let i = 0; i < 20; i++) {
    aterstall();
    const bar = ef.barriar('work_order_pool_take', 2);
    const [r1, r2] = await Promise.all([ta(U.falt, 'AO-P1'), ta(U.falt2, 'AO-P1')]);
    const st = [r1.status, r2.status].sort().join(',');
    const b = ao('AO-P1');
    if (st !== '200,409' || bar.kvar !== 0 || [r1, r2].find((y) => y.status === 409).body.error !== 'already_assigned' || b.staff.length !== 1 || b.log.filter((l) => l.type === 'taken_from_pool').length !== 1) fel09.push([st, b.staff]);
  }
  ok(fel09.length === 0, 'SEC-POOL-09/T7: samtidig tagning (N=2, 20 upprepningar): exakt en 200 och en 409 already_assigned, en person och en loggpost', fel09);
  // N=10 parallella RPC-anrop (egna anslutningar) från fem olika aktiva fältanvändare.
  let fel10 = [];
  const tagare = [U.falt, U.falt2, U.faltny, U.faltutanklar, U.faltutanstart];
  const permsAv = (anv) => val(db, 'vift_roles').find((y) => y.id === anv.role).permissions;
  for (let i = 0; i < 5; i++) {
    aterstall();
    const res = await Promise.all(Array.from({ length: 10 }, (_, j) => rpcAsync(db, 'work_order_pool_take', { p_ao_id: 'AO-SI1', p_caller_staff_id: tagare[j % 5].staffId, p_caller_perms: permsAv(tagare[j % 5]), p_idempotency_key: 'n10-' + i + '-' + j, p_entry_id: '' })));
    const okN = res.filter((y) => !y.error).length, konf = res.filter((y) => y.error && /already_assigned/.test(y.error.message)).length;
    const b = ao('AO-SI1');
    if (okN !== 1 || konf !== 9 || b.staff.length !== 1 || b.log.filter((l) => l.type === 'taken_from_pool').length !== 1) fel10.push([okN, konf, b.staff]);
  }
  ok(fel10.length === 0, 'T7: N=10 parallella anslutningar (5 upprepningar): exakt en lyckas, 9 får already_assigned', fel10);

  // ════════════════ SÄK-5 / D-03: start och klarmarkering ════════════════
  aterstall();
  const patch = (user, aoId, p, extra) => AW(user, Object.assign({ action: 'patch_ao', aoId, patch: p }, extra || {}));
  await NEJ('SEC-AO-05: fält klarmarkerar ej tilldelad AO-A8 → 403 forbidden/not_assigned', () => patch(U.falt, 'AO-A8', { status: 'klar' }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
  await NEJ('SEC-AO-05: fält klarmarkerar FAKTURERAD ej tilldelad AO-A4 → 403 not_assigned (baslinjen: 200)', () => patch(U.falt, 'AO-A4', { status: 'klar' }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
  await NEJ('SEC-AO-06: fält klarmarkerar egen FAKTURERAD AO-A9 → 409 ao_locked', () => patch(U.falt, 'AO-A9', { status: 'klar' }), { status: 409, error: 'ao_locked', reason: null });
  await NEJ('SEC-AO-07: egen AVBRUTEN AO-A5 → 409 ao_locked', () => patch(U.falt, 'AO-A5', { status: 'klar' }), { status: 409, error: 'ao_locked', reason: null });
  await NEJ('SEC-AO-07: egen ARKIVERAD AO-A6 → 409 ao_locked', () => patch(U.falt, 'AO-A6', { status: 'klar' }), { status: 409, error: 'ao_locked', reason: null });
  await NEJ('SEC-AO-07: egen BORTTAGEN AO-A7 → 409 ao_locked', () => patch(U.falt, 'AO-A7', { status: 'klar' }), { status: 409, error: 'ao_locked', reason: null });
  await NEJ('SEC-AO-05: klarmarkera öppen pool P1 (ej tilldelad) → 403 not_assigned', () => patch(U.falt, 'AO-P1', { status: 'klar' }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
  await NEJ('egen redan klar AO-A3 → 409 invalid_source_status', () => patch(U.falt, 'AO-A3', { status: 'klar' }), { status: 409, error: 'invalid_source_status', reason: null });
  x = await JA('SEC-AO-08/09: fält klarmarkerar egen pågående AO-A2 med påhittat completedBy/At → 200', () => patch(U.falt, 'AO-A2', { status: 'klar', completedBy: F2, completedAt: '2000-01-01T00:00:00.000Z' }), ['store:vift_workOrders', 'tabell:op_idempotency']);
  a = ao('AO-A2');
  ok(a.status === 'klar' && a.completedBy === F && a.completedAt.startsWith('202') && JSON.stringify(x.svar.body.ignoredFields) === JSON.stringify(['completedAt', 'completedBy']),
    'SEC-AO-08: servern sätter completedBy = FÄ och servertid; klientens värden redovisas i ignoredFields', [a.completedBy, a.completedAt, x.svar.body.ignoredFields]);
  await NEJ('SEC-AO-11: starta ej tilldelad AO-A8 → 403 not_assigned', () => patch(U.falt, 'AO-A8', { status: 'pågående' }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
  await NEJ('SEC-AO-12: starta egen klar AO-A3 → 409 invalid_source_status', () => patch(U.falt, 'AO-A3', { status: 'pågående' }), { status: 409, error: 'invalid_source_status', reason: null });
  await NEJ('starta egen fakturerad AO-A9 → 409 ao_locked', () => patch(U.falt, 'AO-A9', { status: 'pågående' }), { status: 409, error: 'ao_locked', reason: null });
  await NEJ('SEC-AO-13: {status:pågående, title} → 403 forbidden/field_not_allowed', () => patch(U.falt, 'AO-A1', { status: 'pågående', title: 'x' }), { status: 403, error: 'forbidden', reason: 'field_not_allowed' });
  await NEJ('SEC-AO-19: fält sätter fixedPrice → 403 forbidden/field_not_allowed', () => patch(U.falt, 'AO-A1', { fixedPrice: 1 }), { status: 403, error: 'forbidden', reason: 'field_not_allowed' });
  await NEJ('fält ändrar staff på egen AO → 403 field_not_allowed', () => patch(U.falt, 'AO-A1', { staff: [F, F2] }), { status: 403, error: 'forbidden', reason: 'field_not_allowed' });
  await NEJ('SEC-CUST-10: personal − ao_complete_own klarmarkerar → 403 forbidden', () => patch(U.faltutanklar, 'AO-A1', { status: 'klar' }), { status: 403, error: 'forbidden', reason: null });
  await NEJ('SEC-CUST-11: personal − ao_start_own startar → 403 forbidden', () => patch(U.faltutanstart, 'AO-A1', { status: 'pågående' }), { status: 403, error: 'forbidden', reason: null });
  await NEJ('SEC-AO-17: fält delete_ao → 403 forbidden', () => AW(U.falt, { action: 'delete_ao', aoId: 'AO-A1' }), { status: 403, error: 'forbidden', reason: null });
  await NEJ('begränsad (bara ao_view_own) patch_ao → 403 forbidden', () => patch(U.begransad, 'AO-A1', { status: 'klar' }), { status: 403, error: 'forbidden', reason: null });
  await JA('SEC-AO-10: fält startar egen planerad AO-A1 → 200 pågående', () => patch(U.falt, 'AO-A1', { status: 'pågående' }), ['store:vift_workOrders', 'tabell:op_idempotency']);
  ok(ao('AO-A1').status === 'pågående' && ao('AO-A1').startedBy === F, 'SEC-AO-10: status pågående, startedBy satt av servern');
  // RPC direkt (P-vägen): samma regel, utan EF.
  aterstall();
  let rr = rpc(db, 'work_order_patch', { p_ao_id: 'AO-A8', p_patch: { status: 'klar' }, p_idempotency_key: nyckel(), p_expected_updated_at: null, p_caller_staff_id: F, p_caller_perms: permsAv(U.falt) });
  ok(rr.error && /forbidden:not_assigned/.test(rr.error.message), 'SEC-AO-05 (P): RPC work_order_patch nekar själv (forbidden:not_assigned)', rr);
  rr = rpc(db, 'work_order_patch', { p_ao_id: 'AO-A8', p_patch: { staff: [F2, F] }, p_idempotency_key: nyckel(), p_expected_updated_at: null, p_caller_staff_id: F, p_caller_perms: permsAv(U.falt) });
  ok(rr.error && /forbidden:field_not_allowed/.test(rr.error.message), 'SÄK-4 (baslinje vänd): RPC:n tar inte längre en icke-pool-AO åt fältet', rr);
  ok(q(db, `select 1 from pg_proc where proname = 'work_order_patch' and pronargs = 4`).length === 0, 'den gamla work_order_patch(4 argument) utan anroparprofil finns inte kvar');
  // SEC-AO-14: AL tar bort FÄ samtidigt som FÄ klarmarkerar (20 upprepningar).
  let fel14 = [], utfall14 = {};
  for (let i = 0; i < 20; i++) {
    aterstall();
    const bar = ef.barriar('work_order_patch', 2);
    const [rf, rc] = await Promise.all([patch(U.falt, 'AO-A1', { status: 'klar' }), patch(U.chef, 'AO-A1', { staff: [] })]);
    const b = ao('AO-A1');
    utfall14[rf.status] = (utfall14[rf.status] || 0) + 1;
    if (bar.kvar !== 0 || rc.status !== 200) fel14.push(['barriär/chef', bar.kvar, rc.status]);
    else if (rf.status === 200 && !(b.status === 'klar' && b.completedBy === F)) fel14.push(['200 men', b.status, b.completedBy]);
    else if (rf.status === 403 && !(rf.body.reason === 'not_assigned' && b.status === 'planerad')) fel14.push(['403 men', rf.body, b.status]);
    else if (rf.status !== 200 && rf.status !== 403) fel14.push(['status', rf.status]);
  }
  ok(fel14.length === 0, 'SEC-AO-14: samtidig borttagning och klarmarkering (20 upprepningar) — aldrig "klar" av någon som inte var tilldelad vid låset; förloraren får 403 not_assigned utan mutation ' + JSON.stringify(utfall14), fel14);

  // ════════════════ SÄK-15 / D-07: faktureringsfält bara via faktureringsvägen ════════════════
  aterstall();
  await NEJ('SEC-AO-15: arbetsledare sätter status fakturerad + invoiceId → 403 forbidden/invoice_path_required', () => patch(U.chef, 'AO-A1', { status: 'fakturerad', invoiceId: 'INV-FALSK' }), { status: 403, error: 'forbidden', reason: 'invoice_path_required' });
  await NEJ('SEC-AO-15: admin (all) sätter invoiceId → 403 invoice_path_required', () => patch(U.admin, 'AO-A3', { invoiceId: 'INV-R1' }), { status: 403, error: 'forbidden', reason: 'invoice_path_required' });
  await NEJ('SEC-AO-15: admin backar fakturerad AO-A9 till klar via patch → 403 invoice_path_required', () => patch(U.admin, 'AO-A9', { status: 'klar' }), { status: 403, error: 'forbidden', reason: 'invoice_path_required' });
  await NEJ('arbetsledare rensar invoiceId på fakturerad AO-A9 → 403 invoice_path_required', () => patch(U.chef, 'AO-A9', { invoiceId: '' }), { status: 403, error: 'forbidden', reason: 'invoice_path_required' });
  await NEJ('arbetsledare sätter billingPreviousStatus → 403 invoice_path_required', () => patch(U.chef, 'AO-A3', { billingPreviousStatus: 'planerad' }), { status: 403, error: 'forbidden', reason: 'invoice_path_required' });
  await JA('arbetsledare ändrar titel på fakturerad AO (inte faktureringsfält) → 200, och skickar oförändrad status/invoiceId', () => patch(U.chef, 'AO-A9', { title: 'Ny titel', status: 'fakturerad', invoiceId: 'INV-R1' }), ['store:vift_workOrders', 'tabell:op_idempotency']);
  // Fakturaflödet: kö → underlag (invoice-write appendChecked) → status (aoBilling) → makulering/borttagning backar.
  aterstall();
  const IW = (user, body) => ef.anropa('invoice-write', { user, body });
  /* T4-B (D-10, SÄK-6): källraden prövas mot sin källa. AO-A3 är en fastpris-AO (tiden ingår i fastpriset),
     så flödet fakturerar fastpriset (fixed:AO-A3, 4 500 kr = AO:ns fixedPrice) i stället för tidposten. */
  const underlag = (aoId, sk) => ({ customerId: 'CU-R1', sourceAware: true, workOrderIds: [aoId], lines: [{ id: 'L-' + sk, description: 'Arbete', qty: 1, unit: 'st', unitPrice: 4500, vatRate: 25, sourceRefs: [{ sourceKey: sk, workOrderId: aoId, type: 'fixed' }] }] });
  s = await IW(U.chef, { action: 'appendChecked', idempotencyKey: 'vift-v2:' + nyckel(), invoice: underlag('AO-A3', 'fixed:AO-A3') });
  ok(s.status === 200 && s.body.invoice && s.body.invoice.id, 'flöde: arbetsledare skapar fakturaunderlag ur kön (appendChecked, atomisk väg)', s.body);
  const invId = s.body.invoice && s.body.invoice.id;
  await NEJ('aoBilling utan invoice_create (egen roll chef − invoice_create) → 403 forbidden', () => IW(U.chef_utan_faktura, { action: 'aoBilling', aoId: 'AO-A3', invoiceId: invId, mode: 'invoiced' }), { status: 403, error: 'forbidden', reason: null });
  await NEJ('aoBilling av fält → 403 forbidden', () => IW(U.falt, { action: 'aoBilling', aoId: 'AO-A3', invoiceId: invId, mode: 'invoiced' }), { status: 403, error: 'forbidden', reason: null });
  await NEJ('aoBilling med underlag som inte hänvisar till AO:n → 403 forbidden/invoice_not_linked', () => IW(U.chef, { action: 'aoBilling', aoId: 'AO-A1', invoiceId: invId, mode: 'invoiced' }), { status: 403, error: 'forbidden', reason: 'invoice_not_linked' });
  await NEJ('aoBilling med underlag som inte finns → 404 not_found', () => IW(U.chef, { action: 'aoBilling', aoId: 'AO-A3', invoiceId: 'F-999', mode: 'invoiced' }), { status: 404, error: 'not_found', reason: null });
  await JA('SEC-AO-16: aoBilling (invoice-write) markerar AO-A3 fakturerad → 200', () => IW(U.chef, { action: 'aoBilling', aoId: 'AO-A3', invoiceId: invId, mode: 'invoiced' }), ['store:vift_workOrders']);
  a = ao('AO-A3');
  ok(a.status === 'fakturerad' && a.invoiceId === invId && a.billingPreviousStatus === 'klar', 'flöde: status fakturerad, invoiceId och billingPreviousStatus=klar satta av servern', a);
  const inv0 = val(db, 'vift_invoices').find((i) => i.id === invId);
  s = await IW(U.chef, { action: 'draftDelete', invoiceId: invId, expectedRevision: inv0.revision });
  ok(s.status === 200, 'flöde: utkastet tas bort (draftDelete)', s.body);
  await JA('flöde: aoBilling restore efter borttaget utkast → AO tillbaka till klar', () => IW(U.chef, { action: 'aoBilling', aoId: 'AO-A3', mode: 'restore' }), ['store:vift_workOrders']);
  a = ao('AO-A3');
  ok(a.status === 'klar' && a.invoiceId === '' && a.billingPreviousStatus === null, 'flöde: status klar, invoiceId tom, billingPreviousStatus null', a);
  // Makulering backar också.
  s = await IW(U.chef, { action: 'appendChecked', idempotencyKey: 'vift-v2:' + nyckel(), invoice: underlag('AO-A3', 'fixed:AO-A3') });
  const inv2 = s.body.invoice;
  await IW(U.chef, { action: 'aoBilling', aoId: 'AO-A3', invoiceId: inv2.id, mode: 'invoiced' });
  s = await IW(U.chef, { action: 'setStatus', invoiceId: inv2.id, status: 'makulerad', expectedRevision: inv2.revision });
  ok(s.status === 200 && s.body.invoice.status === 'makulerad', 'flöde: underlaget makuleras (setStatus)', s.body);
  await NEJ('aoBilling invoiced mot makulerat underlag → 409 invalid_transition', () => IW(U.chef, { action: 'aoBilling', aoId: 'AO-A1', invoiceId: inv2.id, mode: 'invoiced' }), { status: 409, error: 'invalid_transition', reason: null });
  await JA('flöde: restore efter makulering → AO tillbaka till klar', () => IW(U.chef, { action: 'aoBilling', aoId: 'AO-A3', mode: 'restore' }), ['store:vift_workOrders']);
  ok(ao('AO-A3').status === 'klar', 'flöde: makulering återställer AO korrekt');
  s = await IW(U.chef, { action: 'aoBilling', aoId: 'AO-A9', mode: 'restore' });
  ok(s.status === 200 && s.body.noop === true && ao('AO-A9').status === 'fakturerad', 'äldre/manuellt fakturerad AO (utan billingPreviousStatus) rörs aldrig av restore');

  // ════════════════ SÄK-12 / F17: idempotens bunden till aktör + innehåll ════════════════
  aterstall();
  const k12 = nyckel('idem');
  s = await patch(U.chef, 'AO-A1', { title: 'Första' }, { idempotencyKey: k12 });
  ok(s.status === 200 && ao('AO-A1').title === 'Första', 'SEC-AO-20: första patchen med nyckeln sparas');
  await NEJ('SEC-AO-20: samma nyckel med ANNAN patch → 409 idempotency_key_conflict, ingen mutation', () => patch(U.chef, 'AO-A1', { title: 'Annan' }, { idempotencyKey: k12 }), { status: 409, error: 'idempotency_key_conflict', reason: null });
  await NEJ('SÄK-12: samma nyckel och patch från ANNAN aktör → 409 idempotency_key_conflict', () => patch(U.admin, 'AO-A1', { title: 'Första' }, { idempotencyKey: k12 }), { status: 409, error: 'idempotency_key_conflict', reason: null });
  const ks12 = ksTa(db, KS);
  const s12 = await patch(U.chef, 'AO-A1', { title: 'Första' }, { idempotencyKey: k12 });
  ok(s12.status === 200 && s12.body.workOrder.title === 'Första' && ksDiff(ks12, ksTa(db, KS)).length === 0 && !('_fp' in s12.body), 'nätavbrott/omförsök: samma nyckel + samma innehåll återspelas (200), ingen ny mutation, inget internt fingeravtryck i svaret');
  rr = rpc(db, 'work_order_patch', { p_ao_id: 'AO-A1', p_patch: { title: 'RPC-annan' }, p_idempotency_key: k12, p_expected_updated_at: null, p_caller_staff_id: U.chef.staffId, p_caller_perms: permsAv(U.chef) });
  ok(rr.error && /idempotency_key_conflict/.test(rr.error.message), 'SÄK-12 (P): RPC:n själv avvisar återanvänd nyckel med annat innehåll');

  // ════════════════ SÄK-11 / AP-B: tid och stämpling ════════════════
  aterstall();
  const tid = (user, entry, extra) => AW(user, Object.assign({ action: 'create_time', entry }, extra || {}));
  await NEJ('SEC-TID-02/W6: create_time på ej tilldelad AO-A8 → 403 not_assigned, varken tidpost eller länk i AO', () => tid(U.falt, { id: 'TE-T1', aoId: 'AO-A8', date: '2026-11-24', minutes: 60 }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
  await NEJ('SEC-POOL-11: create_time på öppen pool P1 före tagning → 403 not_assigned', () => tid(U.falt, { id: 'TE-T2', aoId: 'AO-P1', date: '2026-11-24', minutes: 60 }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
  await NEJ('SEC-TID-02: create_time på påhittat aoId → 404 not_found', () => tid(U.falt, { id: 'TE-T3', aoId: 'AO-FINNS-INTE', date: '2026-11-24', minutes: 60 }), { status: 404, error: 'not_found', reason: null });
  await NEJ('create_time på egen FAKTURERAD AO-A9 → 409 ao_locked', () => tid(U.falt, { id: 'TE-T4', aoId: 'AO-A9', date: '2026-11-24', minutes: 60 }), { status: 409, error: 'ao_locked', reason: null });
  await NEJ('SEC-TID-04: create_time med annans staffId utan payroll_manage → 403 forbidden', () => tid(U.falt, { id: 'TE-T5', aoId: 'AO-A1', staffId: F2, date: '2026-11-24', minutes: 60 }), { status: 403, error: 'forbidden', reason: null });
  await NEJ('SEC-CUST-16: begränsad + ao_time på öppen pool → 403 not_assigned', () => tid(U.begransadtid, { id: 'TE-T6', aoId: 'AO-P4', date: '2026-11-24', minutes: 60 }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
  x = await JA('SEC-TID-01/SEC-B2-03: create_time på egen AO-A1 med hourRate 9999 → 200, länkad', () => tid(U.falt, { id: 'TE-T7', aoId: 'AO-A1', date: '2026-11-24', minutes: 60, priceGroupId: 'PG-R1', priceGroupName: 'Falskt namn', hourRate: 9999 }), ['store:vift_timeEntries', 'store:vift_workOrders', 'tabell:op_idempotency']);
  ok(te('TE-T7').hourRate === 650 && te('TE-T7').priceGroupName === 'Ordinarie' && te('TE-T7').staffId === F && ao('AO-A1').timeEntries.includes('TE-T7')
    && JSON.stringify(x.svar.body.ignoredFields) === JSON.stringify(['hourRate', 'priceGroupName']), 'D-11: timpris och prisgruppsnamn sätts av servern ur prisgruppen; klientens värden ignoreras och redovisas', [te('TE-T7'), x.svar.body.ignoredFields]);
  await JA('arbetsledare (ao_edit) registrerar egen tid på ej tilldelad AO-A8 → 200', () => tid(U.chef, { id: 'TE-T8', aoId: 'AO-A8', date: '2026-11-24', minutes: 30 }), ['store:vift_timeEntries', 'store:vift_workOrders', 'tabell:op_idempotency']);
  await JA('ekonomi (payroll_manage) registrerar åt FÄ på AO-A8 → 200 (för annans räkning)', () => tid(U.ekonomi, { id: 'TE-T9', aoId: 'AO-A8', staffId: F, date: '2026-11-24', minutes: 30 }), ['store:vift_timeEntries', 'store:vift_workOrders', 'tabell:op_idempotency']);
  ok(te('TE-T9').staffId === F && te('TE-T9').registeredById === U.ekonomi.staffId, 'registrering åt annan: servern sätter staffId och registeredById');
  await JA('create_time utan aoId ("Utan arbetsorder") fungerar som förut', () => tid(U.falt, { id: 'TE-T10', aoId: '', date: '2026-11-24', minutes: 15 }), ['store:vift_timeEntries', 'tabell:op_idempotency']);
  // Historiska priser: befintliga poster ändras inte när prisgruppen ändras.
  psql(db, `update public.store set value = jsonb_set(value, '{0,hourRate}', '700') where key = 'vift_priceGroups'`);
  ok(te('TE-T7').hourRate === 650 && te('TE-R1').hourRate === 650, 'SEC-B2-05/D-11: ändrat timpris i prisgruppen ändrar inte befintliga tidposter');
  // patch_time
  await NEJ('patch_time: flytta egen tidpost till ej tilldelad AO-A8 → 403 not_assigned', () => AW(U.falt, { action: 'patch_time', entryId: 'TE-T7', patch: { aoId: 'AO-A8' } }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
  x = await JA('patch_time: fält försöker sätta hourRate → ignoreras', () => AW(U.falt, { action: 'patch_time', entryId: 'TE-T7', patch: { hourRate: 1, comment: 'ok' } }), ['store:vift_timeEntries', 'tabell:op_idempotency']);
  ok(te('TE-T7').hourRate === 650 && te('TE-T7').comment === 'ok' && JSON.stringify(x.svar.body.ignoredFields) === JSON.stringify(['hourRate']), 'patch_time: fältets hourRate ignoreras och redovisas, övriga fält sparas');
  await JA('patch_time: fält byter prisgrupp → servern sätter priset från gruppen', () => AW(U.falt, { action: 'patch_time', entryId: 'TE-T7', patch: { priceGroupId: 'PG-R2' } }), ['store:vift_timeEntries', 'tabell:op_idempotency']);
  ok(te('TE-T7').hourRate === 975 && te('TE-T7').priceGroupName === 'Jour', 'patch_time: byte av prisgrupp ger serverns timpris (975, Jour)');
  // Stämpling (F23)
  aterstall();
  const KST = { keys: ['vift_workOrders', 'vift_timeEntries'], tables: ['stamp_status'] };
  const stampa = (user, active, aoId, ts, rev) => ef.anropa('store-key-write', { user, body: { action: 'setStampStatus', active, ts, aoId, expectedRevision: rev || 0 } });
  await NEJ('SEC-TID-03/W7: instämpling på ej tilldelad AO-A8 → 403 not_assigned, stamp_status oförändrad', () => stampa(U.falt, true, 'AO-A8', 1764000000000), { status: 403, error: 'forbidden', reason: 'not_assigned' }, KST);
  await NEJ('SEC-POOL-11: instämpling på öppen pool P1 → 403 not_assigned (ingen automatisk tagning)', () => stampa(U.falt, true, 'AO-P1', 1764000000000), { status: 403, error: 'forbidden', reason: 'not_assigned' }, KST);
  await NEJ('instämpling på aoId som inte finns → 404 not_found', () => stampa(U.falt2, true, 'AO-FINNS-INTE', 1764000000000), { status: 404, error: 'not_found', reason: null }, KST);
  await NEJ('instämpling på egen fakturerad AO-A9 → 409 ao_locked', () => stampa(U.falt, true, 'AO-A9', 1764000000000), { status: 409, error: 'ao_locked', reason: null }, KST);
  await JA('instämpling utan AO fungerar som förut', () => stampa(U.falt2, true, null, 1764000000000), ['tabell:stamp_status'], KST);
  // Legitim pågående stämpling som omfördelas, klarmarkeras eller faktureras: utstämplingen tillåts.
  const T0 = Date.parse('2026-11-27T07:00:00.000Z');
  s = await stampa(U.falt, true, 'AO-A1', T0);
  ok(s.status === 200 && s.body.active === true, 'instämpling på egen tilldelad AO-A1 → 200');
  await patch(U.chef, 'AO-A1', { staff: [F2] });
  await NEJ('ny instämpling efter omfördelning (annat pass) → 403 not_assigned', () => stampa(U.falt, true, 'AO-A1', T0 + 1000, 1), { status: 403, error: 'forbidden', reason: 'not_assigned' }, KST);
  await NEJ('tidpost på omfördelad AO som INTE motsvarar pågående stämpling → 403 not_assigned', () => tid(U.falt, { id: 'TE-S0', aoId: 'AO-A1', date: '2026-11-27', startTs: T0 + 5, endTs: T0 + 3600000, minutes: 60 }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
  const utEntry = { id: 'TID-' + F + '-' + T0, aoId: 'AO-A1', date: '2026-11-27', startTs: T0, endTs: T0 + 2 * 3600000, minutes: 120, startStr: '08:00', endStr: '10:00' };
  x = await JA('utstämpling av legitim pågående stämpling på OMFÖRDELAD AO → 200, arbetet försvinner inte', () => tid(U.falt, utEntry, { idempotencyKey: 'clockout-' + utEntry.id }), ['store:vift_timeEntries', 'store:vift_workOrders', 'tabell:op_idempotency']);
  ok(ao('AO-A1').timeEntries.includes(utEntry.id) && te(utEntry.id).minutes === 120, 'utstämplingen länkas till AO:n med oförändrade minuter');
  // Nätavbrott: samma utstämpling skickas igen (samma nyckel och innehåll) → en post.
  const ksU = ksTa(db, KS);
  s = await tid(U.falt, utEntry, { idempotencyKey: 'clockout-' + utEntry.id });
  ok(s.status === 200 && ksDiff(ksU, ksTa(db, KS)).length === 0 && val(db, 'vift_timeEntries').filter((t) => t.id === utEntry.id).length === 1, 'nätavbrott: omsänd utstämpling (samma nyckel) återspelas, ingen dubbel tidpost');
  await NEJ('andra enheten stämplar ut samma pass med annan sluttid → 409 idempotency_key_conflict, en tidpost', () => tid(U.falt, Object.assign({}, utEntry, { endTs: T0 + 3 * 3600000, minutes: 180 }), { idempotencyKey: 'clockout-' + utEntry.id }), { status: 409, error: 'idempotency_key_conflict', reason: null });
  // Klarmarkerad och fakturerad under pågående stämpling.
  aterstall();
  const T1 = Date.parse('2026-11-27T12:00:00.000Z');
  await stampa(U.falt, true, 'AO-A2', T1);
  await patch(U.falt, 'AO-A2', { status: 'klar' });
  await JA('utstämpling efter att AO:n klarmarkerats under passet → 200', () => tid(U.falt, { id: 'TID-K', aoId: 'AO-A2', date: '2026-11-27', startTs: T1, endTs: T1 + 1800000, minutes: 30 }), ['store:vift_timeEntries', 'store:vift_workOrders', 'tabell:op_idempotency']);
  aterstall();
  /* T4-B (T3-B beslut 1): instämpling på en KLAR AO är normal tidregistrering och låst; passet startas därför
     medan AO-A3 är pågående (som i verksamheten), varefter den faktureras under passet. */
  psql(db, `update public.store set value = (select jsonb_agg(case when e->>'id' = 'AO-A3' then e || '{"status":"pågående"}'::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_workOrders'`);
  await stampa(U.falt, true, 'AO-A3', T1);
  s = await IW(U.chef, { action: 'appendChecked', idempotencyKey: 'vift-v2:' + nyckel(), invoice: underlag('AO-A3', 'fixed:AO-A3') });
  await IW(U.chef, { action: 'aoBilling', aoId: 'AO-A3', invoiceId: s.body.invoice.id, mode: 'invoiced' });
  ok(ao('AO-A3').status === 'fakturerad', 'AO-A3 fakturerad medan FÄ är instämplad');
  await NEJ('ny tid på den fakturerade AO:n utan stämpling → 409 ao_locked', () => tid(U.falt, { id: 'TID-F0', aoId: 'AO-A3', date: '2026-11-27', minutes: 10 }), { status: 409, error: 'ao_locked', reason: null });
  await JA('utstämpling av passet som startades före faktureringen → 200 (utfört arbete bevaras)', () => tid(U.falt, { id: 'TID-F', aoId: 'AO-A3', date: '2026-11-27', startTs: T1, endTs: T1 + 1800000, minutes: 30 }), ['store:vift_timeEntries', 'store:vift_workOrders', 'tabell:op_idempotency']);
  // Sommartid (punkt 261) och tid över midnatt: servern bevarar klientens tidsstämplar, datum och minuter.
  aterstall();
  const dst = { id: 'TE-DST', aoId: 'AO-A1', date: '2026-03-29', startTs: Date.parse('2026-03-29T00:30:00.000Z'), endTs: Date.parse('2026-03-29T01:30:00.000Z'), startStr: '01:30', endStr: '03:30', minutes: 60 };
  s = await tid(U.falt, dst);
  ok(s.status === 200 && te('TE-DST').minutes === 60 && te('TE-DST').date === '2026-03-29' && te('TE-DST').startStr === '01:30' && te('TE-DST').endStr === '03:30', 'punkt 261: pass över sommartidsomställningen (01:30–03:30 lokal tid = 60 min) lagras oförändrat');
  const natt = { id: 'TE-NATT', aoId: 'AO-A1', date: '2026-11-27', startTs: Date.parse('2026-11-27T21:30:00.000Z'), endTs: Date.parse('2026-11-28T00:00:00.000Z'), startStr: '22:30', endStr: '01:00', minutes: 150 };
  s = await tid(U.falt, natt);
  ok(s.status === 200 && te('TE-NATT').minutes === 150 && te('TE-NATT').date === '2026-11-27', 'tid över midnatt: datum = startdatum, minuter oförändrade');
  // Samtidiga stämplingsförsök: två enheter stämplar in samtidigt med samma förväntade revision.
  let felS = [];
  for (let i = 0; i < 10; i++) {
    aterstall();
    const res = await Promise.all([1, 2].map((j) => rpcAsync(db, 'store_write_stamp_status', { p_auth_user_id: U.falt.authId, p_active: true, p_ts: 1764000000000 + j, p_ao_id: 'AO-A1', p_expected_revision: 0 })));
    const stale = res.filter((y) => y.data && y.data.stale).length, lyckad = res.filter((y) => y.data && !y.data.stale).length;
    const rad = q(db, `select revision, ts from public.stamp_status where user_id = ${lit(U.falt.authId)}`)[0];
    if (lyckad !== 1 || stale !== 1 || rad.revision !== 1) felS.push([lyckad, stale, rad]);
  }
  ok(felS.length === 0, 'samtidiga stämplingsförsök (10 upprepningar): exakt ett lyckas, det andra får stale med serverns läge, revision 1', felS);
  let felU = [];
  for (let i = 0; i < 10; i++) {
    aterstall();
    const e = { id: 'TID-PAR', aoId: 'AO-A1', date: '2026-11-27', minutes: 60 };
    const bar = ef.barriar('time_entry_create', 2);
    const res = await Promise.all([tid(U.falt, e, { idempotencyKey: 'clockout-par' }), tid(U.falt, Object.assign({}, e, { minutes: 61 }), { idempotencyKey: 'clockout-par' })]);
    const n = val(db, 'vift_timeEntries').filter((t) => t.id === 'TID-PAR').length;
    const st = res.map((y) => y.status).sort().join(',');
    if (n !== 1 || st !== '200,409' || bar.kvar !== 0) felU.push([n, st]);
  }
  ok(felU.length === 0, 'samtidig utstämpling av samma pass från två enheter (10 upprepningar): exakt en tidpost, den andra 409 idempotency_key_conflict', felU);

  // ════════════════ Checklista, AO-logg, material och bilder (SEC-POOL-11..13) ════════════════
  aterstall();
  const chk = (user, aoId, itemId, action) => ef.anropa('work-order-checklist-resolve', { user, body: { aoId, itemId, action } });
  const logg = (user, aoId, id) => ef.anropa('work-order-log-write', { user, body: { action: 'append_log', aoId, entry: { id, type: 'note', text: 'anteckning' } } });
  const mat = (user, aoId, materials) => patch(user, aoId, { materials });
  /* T4-B (D-19, 2026-11-28): fältet skriver aldrig hela materiallistan (403 forbidden/row_path_required, prövas
     nedan och i t4b_material_priser.test.js). T3-B:s regler för fältets materialrader (tilldelning, låst AO,
     egna rader) prövas därför via de radvisa åtgärderna, med samma förväntade avslag. */
  const matAdd = (user, aoId, row) => AW(user, { action: 'add_material', aoId, row });
  const matUpd = (user, aoId, rowId, p) => AW(user, { action: 'update_material', aoId, rowId, patch: p });
  const matDel = (user, aoId, rowId) => AW(user, { action: 'remove_material', aoId, rowId });
  const bild = async (user, aoId) => {
    const fd = new FormData();
    fd.append('aoId', aoId);
    fd.append('file', new File([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4])], 'a.jpg', { type: 'image/jpeg' }));
    const res = await ef.handlers['work-order-image-upload'](new Request('http://replik.lokal/functions/v1/work-order-image-upload', { method: 'POST', headers: { authorization: 'Bearer ' + jwtFor(user) }, body: fd }));
    let b = await res.text(); try { b = JSON.parse(b); } catch (e) { /* text */ }
    return { status: res.status, body: b };
  };
  for (const [id, nm] of [['AO-P1', 'öppen pool P1 före tagning'], ['AO-P2', 'annans pool-AO P2']]) {
    await NEJ(`W4/SEC-POOL-11/12: checklista på ${nm} → 403 not_assigned`, () => chk(U.falt, id, id + '-C1', 'done'), { status: 403, error: 'forbidden', reason: 'not_assigned' });
    await NEJ(`W5: loggpost på ${nm} → 403 not_assigned`, () => logg(U.falt, id, 'LOG-' + id), { status: 403, error: 'forbidden', reason: 'not_assigned' });
    await NEJ(`W1: materialrad på ${nm} → 403 not_assigned`, () => matAdd(U.falt, id, { name: 'x', qty: 1 }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
    await NEJ(`W1: fältets hela materiallista på ${nm} (äldre klient) → 403 row_path_required`, () => mat(U.falt, id, ao(id).materials.concat([{ id: 'M-NY', name: 'x', qty: 1 }])), { status: 403, error: 'forbidden', reason: 'row_path_required' });
    const filerFore = ef.filer.size;
    await NEJ(`W2: bilduppladdning på ${nm} → 403 not_assigned`, () => bild(U.falt, id), { status: 403, error: 'forbidden', reason: 'not_assigned' });
    ok(ef.filer.size === filerFore, `W2: ingen fil skapad (${nm})`);
  }
  ef.filer.set('workorder-images/AO-P1/befintlig.jpg', Buffer.from('x'));
  s = await ef.anropa('work-order-image-delete', { user: U.falt, body: { aoId: 'AO-P1', path: 'AO-P1/befintlig.jpg' } });
  ok(s.status === 403 && s.body.reason === 'not_assigned' && ef.filer.has('workorder-images/AO-P1/befintlig.jpg'), 'W3: bildradering på öppen pool före tagning → 403 not_assigned, filen finns kvar', s);
  await ta(U.falt, 'AO-P1');
  await JA('SEC-POOL-13: efter tagning — checklista → 200', () => chk(U.falt, 'AO-P1', 'AO-P1-C1', 'done'), ['store:vift_workOrders']);
  await JA('SEC-POOL-13: efter tagning — loggpost → 200', () => logg(U.falt, 'AO-P1', 'LOG-EFTER'), ['store:vift_workOrders']);
  s = await bild(U.falt, 'AO-P1');
  ok(s.status === 200 && s.body.path && s.body.path.startsWith('AO-P1/'), 'SEC-POOL-13: efter tagning — bilduppladdning → 200', s);
  await NEJ('checklista på egen FAKTURERAD AO-A9 → 409 ao_locked', () => chk(U.falt, 'AO-A9', 'AO-A9-C1', 'done'), { status: 409, error: 'ao_locked', reason: null });
  await NEJ('loggpost på egen FAKTURERAD AO-A9 → 409 ao_locked', () => logg(U.falt, 'AO-A9', 'LOG-A9'), { status: 409, error: 'ao_locked', reason: null });
  await NEJ('SEC-B1-08: materialrad på egen fakturerad AO-A9 → 409 ao_locked', () => matAdd(U.falt, 'AO-A9', { name: 'x', qty: 1 }), { status: 409, error: 'ao_locked', reason: null });
  await NEJ('bilduppladdning på egen fakturerad AO-A9 → 409 ao_locked', () => bild(U.falt, 'AO-A9'), { status: 409, error: 'ao_locked', reason: null });
  await JA('arbetsledare (ao_view_all) bockar av checklista på valfri AO → 200', () => chk(U.chef, 'AO-A8', 'AO-A8-C1', 'done'), ['store:vift_workOrders']);
  // Materialrader: fältet ändrar inte andras rader (D-19 delvis).
  /* T4-A (2026-11-28): fältet läser materialraderna utan inköpspris (cost_view saknas) och T4-klienten skickar
     dem så; raderna skickas därför i fältets vy (fv). Den äldre formen med inköpspris prövas i
     t4a_skyddade_falt.test.js (403 field_protected; inköpspriset bevaras). */
  const fv = (l) => l.map((m) => { const x = Object.assign({}, m); delete x.buyPrice; return x; });
  const m1 = fv(ao('AO-A1').materials);
  await NEJ('SEC-B1-05: ändra annans/äldre rad (A1-M1) → 403 forbidden/not_own_row', () => matUpd(U.falt, 'AO-A1', m1[0].id, { qty: 99 }), { status: 403, error: 'forbidden', reason: 'not_own_row' });
  await NEJ('SEC-B1-05: ta bort annans/äldre rad → 403 not_own_row', () => matDel(U.falt, 'AO-A1', m1[0].id), { status: 403, error: 'forbidden', reason: 'not_own_row' });
  await NEJ('D-19 (T4-B): fältets hela lista med en ny rad (T3-klientens väg) → 403 row_path_required', () => mat(U.falt, 'AO-A1', m1.concat([{ id: 'M-EGEN', name: 'Fritext', qty: 2, unit: 'st' }])), { status: 403, error: 'forbidden', reason: 'row_path_required' });
  s = await matAdd(U.falt, 'AO-A1', { name: 'Fritext', qty: 2, unit: 'st' });
  ok(s.status === 200, 'SEC-B1-01: lägg till egen rad (befintliga orörda) → 200', s.body);
  const egenId = s.body.row && s.body.row.id;
  const egen = ao('AO-A1').materials.find((m) => m.id === egenId);
  ok(egen && egen.addedBy === F && egen.addedAt && ao('AO-A1').materials.find((m) => m.id === m1[0].id), 'servern sätter addedBy/addedAt på den nya raden; den äldre raden orörd');
  await JA('SEC-B1-04: ändra egen rad → 200', () => matUpd(U.falt, 'AO-A1', egenId, { qty: 3 }), ['store:vift_workOrders', 'tabell:op_idempotency']);
  await JA('SEC-B1-04: ta bort egen rad → 200', () => matDel(U.falt, 'AO-A1', egenId), ['store:vift_workOrders', 'tabell:op_idempotency']);
  psql(db, `update public.store set value = (select jsonb_agg(case when e->>'id' = 'AO-A1' then e || '{"staff":["${F}","${F2}"]}'::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_workOrders'`);
  s = await matAdd(U.falt, 'AO-A1', { name: 'Fs rad', qty: 1 });
  const faId = s.body.row && s.body.row.id;
  await NEJ('FÄ2 ändrar FÄ:s rad på gemensam AO → 403 not_own_row', () => matUpd(U.falt2, 'AO-A1', faId, { qty: 5 }), { status: 403, error: 'forbidden', reason: 'not_own_row' });
  s = await matAdd(U.falt2, 'AO-A1', { name: 'F2:s rad', qty: 1 });
  ok(s.status === 200 && ao('AO-A1').materials.find((m) => m.id === faId).qty === 1, 'FÄ2 lägger till egen rad på gemensam AO och lämnar FÄ:s rad orörd → 200');

  // ════════════════ Punkt 245: AO-nummer ════════════════
  aterstall();
  const wos = val(db, 'vift_workOrders').map((w, i) => Object.assign({}, w, { displayNumber: i < 2 ? 'AO-001' : 'AO-' + String(i + 1).padStart(3, '0') }));
  psql(db, `update public.store set value = ${jlit(wos)} where key = 'vift_workOrders'; select setval('public.ao_display_number_seq', 1, false);`);
  const skapa = (k) => rpcAsync(db, 'work_order_create', { p_ao: { title: 'Ny ' + k, status: 'nytt', staff: [] }, p_idempotency_key: 'nr-' + k, p_client_id: 'UUID-' + k });
  let cr = await skapa('a');
  ok(!cr.error && cr.data.workOrder.displayNumber === 'AO-019', 'punkt 245: trots off-by-one-läget i sekvensen (last_value 1) ges max+1 = AO-019, aldrig en dubblett av AO-001', cr);
  ok(val(db, 'vift_workOrders').filter((w) => w.displayNumber === 'AO-001').length === 2, 'punkt 245: den historiska dubbletten AO-001 är orörd (ingen omnumrering)');
  const par = await Promise.all(Array.from({ length: 10 }, (_, i) => skapa('p' + i)));
  const nr = par.map((y) => y.data && y.data.workOrder.displayNumber);
  const allaNr = val(db, 'vift_workOrders').map((w) => w.displayNumber);
  ok(par.every((y) => !y.error) && new Set(nr).size === 10 && nr.every((n) => allaNr.filter((m) => m === n).length === 1), 'punkt 245: 10 samtidiga skapanden (egna anslutningar) ger 10 unika nummer, inget krockar med befintliga', nr);
  psql(db, `update public.store set value = value || ${jlit([{ id: 'X-999', title: 'hög', displayNumber: 'AO-999', staff: [] }])} where key = 'vift_workOrders'`);
  cr = await skapa('b');
  ok(cr.data && cr.data.workOrder.displayNumber === 'AO-1000', 'punkt 245: efter AO-999 kommer AO-1000 (lpad kortar inte längre numret)', cr.data && cr.data.workOrder.displayNumber);
  const rep = await skapa('b');
  ok(rep.data && rep.data.workOrder.id === cr.data.workOrder.id && val(db, 'vift_workOrders').filter((w) => w.id === 'UUID-b').length === 1, 'import/omförsök: samma nyckel ger samma AO (idempotent), ingen dubblett');
  cr = await rpcAsync(db, 'work_order_create', { p_ao: { title: 'Pool med personal', status: 'pool', staff: [F] }, p_idempotency_key: 'nr-pool', p_client_id: 'UUID-pool' });
  ok(cr.data && cr.data.workOrder.poolOpen === false, 'AP-A: ny AO med status pool och personal skapas som tilldelad pool (poolOpen=false)');

  // ════════════════ Affärsflöden (server): offert → AO, import, återkommande, serviceintervall ════════════════
  aterstall();
  s = await AW(U.chef, { action: 'create_ao', ao: { id: 'UUID-OFF', title: 'Från offert OFF-R1', offerId: 'OFF-R1', customerId: 'CU-R1', status: 'nytt', staff: [], priceType: 'fastpris', fixedPrice: 1000 } });
  ok(s.status === 200 && s.body.workOrder.offerId === 'OFF-R1' && /^AO-\d{3,}$/.test(s.body.workOrder.displayNumber), 'flöde offert → AO: create_ao med offerId (arbetsledare) → 200 med servertilldelat AO-nummer', s.body);
  ok(!(await lista(U.falt)).some((b) => b.id === 'UUID-OFF'), 'AP-A: ny AO med status nytt utan personal exponeras inte för fältet');
  s = await AW(U.chef, { action: 'create_ao', idempotencyKey: 'import-rad-1', ao: { id: 'UUID-IMP', title: 'Importerad', status: 'planerad', staff: [F], scheduledDate: '2026-12-03' } });
  const s2 = await AW(U.chef, { action: 'create_ao', idempotencyKey: 'import-rad-1', ao: { id: 'UUID-IMP', title: 'Importerad', status: 'planerad', staff: [F], scheduledDate: '2026-12-03' } });
  ok(s.status === 200 && s2.status === 200 && val(db, 'vift_workOrders').filter((w) => w.id === 'UUID-IMP').length === 1, 'flöde import: deterministisk nyckel per rad, omkörning ger ingen dubblett');
  s = await AW(U.chef, { action: 'create_ao', ao: { id: 'UUID-REC', title: 'Återkommande', status: 'nytt', staff: [F], scheduledDate: '2026-12-10', dueDate: '2026-12-10', recurringOrderId: 'REC-R1' } });
  ok(s.status === 200 && s.body.workOrder.scheduledDate === '2026-12-10' && s.body.workOrder.dueDate === '2026-12-10', 'flöde återkommande: utförandedatum behålls (Q2) och dueDate sparas');
  // service-monitor (punkt 250): ny AO via atomisk work_order_create med dueDate.
  const props = val(db, 'vift_properties');
  const idag = new Date(); const om = (d) => new Date(idag.getTime() + d * 86400000).toISOString().slice(0, 10);
  props[0].serviceIntervals = [
    { id: 'SI-T1', title: 'Filterbyte', active: true, nextDue: om(3), autoCreateAO: true, aoCreateDaysBefore: 7, aoStaff: [] },
    { id: 'SI-T2', title: 'OVK', active: true, nextDue: om(4), autoCreateAO: true, aoCreateDaysBefore: 7, aoStaff: [F] },
  ];
  psql(db, `update public.store set value = ${jlit(props)} where key = 'vift_properties'`);
  s = await ef.anropa('service-monitor', { headers: { 'X-Monitor-Secret': 'lokal-monitor-test' }, body: {} });
  const si1 = val(db, 'vift_workOrders').find((w) => w.sourceIntervalId === 'SI-T1'), si2 = val(db, 'vift_workOrders').find((w) => w.sourceIntervalId === 'SI-T2');
  ok(s.status === 200 && si1 && si2, 'flöde serviceintervall: service-monitor skapar AO via work_order_create', [s.status, s.body]);
  ok(si1 && si1.status === 'pool' && si1.dueDate === om(3) && si1.scheduledDate === om(3) && si1.poolOpen === undefined && /^AO-/.test(si1.displayNumber), 'punkt 250/Q1: utan personal → öppen pool med dueDate (och scheduledDate som förfallodag för v3.4-kalendern)', si1);
  ok(si2 && si2.status === 'pool' && si2.dueDate === om(4) && si2.scheduledDate === '' && si2.poolOpen === false, 'punkt 250/Q1: med personal → tilldelad pool, dueDate, INGEN scheduledDate (inte felaktigt bokad), poolOpen=false', si2);
  L = await lista(U.falt2);
  ok(L.some((b) => b.id === si1.id && b.poolProjection) && !L.some((b) => b.id === si2.id), 'serviceintervall-AO: öppen hos andra fältanvändare bara utan personal');
  s = await ef.anropa('service-monitor', { headers: { 'X-Monitor-Secret': 'lokal-monitor-test' }, body: {} });
  ok(val(db, 'vift_workOrders').filter((w) => w.sourceIntervalId === 'SI-T1').length === 1, 'service-monitor: omkörning samma dag skapar ingen dubblett');
  s = await ef.anropa('service-monitor', { headers: { 'X-Monitor-Secret': 'fel' }, body: {} });
  ok(s.status === 401, 'service-monitor: fel X-Monitor-Secret → 401');

  r.stang();
  avsluta();
})().catch((e) => { ok(false, 'krasch: ' + (e.stack || e)); avsluta(); });
