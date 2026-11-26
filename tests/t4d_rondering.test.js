'use strict';
/*
 * T4-D (2026-11-28; testgruppen `rondering`, SAKERHETSPROVNING-TESTPLAN §6 T4-D, BEHORIGHETSMATRIS §5.10
 * SEC-ROND-01..05 och SEC-B5-07): rondering per pass (rondering_utfor, Ö3, SÄK-14/F19). GODKÄNDA
 * SÄKERHETSTESTER efter rättning och BASLINJE-fynden i oförändrad kod (T4-C, commit 3a23521,
 * utläst med git archive) på samma data.
 *
 * Mot den lokala STAGING-replikan med hela repokedjan och de ändrade Edge Functions körda i Node. Varje
 * negativt fall kontrollerar exakt status, error och reason (BEHORIGHETSMATRIS §4) OCH oförändrad
 * kontrollsumma (vift_ronderingspass m.fl.). Samtidighet: parallella EF-anrop och egna anslutningar;
 * radlåset i RPC:n avgör. Lokalt verifierat; inget är prövat i STAGING.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ok, krav, avsluta } = require('./local/lib/test');
krav({ tsc: true });
const { byggReplik, serverRot, franOchMed } = require('./local/lib/replik');
const { laddaEf } = require('./local/lib/ef');
const { val, q, psql, psqlFile, psqlAsync, lit, jlit, asUser } = require('./local/lib/db');
const { expectReject, ksTa, ksDiff, parallellt } = require('./local/lib/kontroll');
const { data } = require('./local/lib/data');
const { STAGING_ROLLER, profil, jamforProfil } = require('./local/lib/t3e');

const FORE_COMMIT = '3a23521'; // T4-C (läget före T4-D)
const T4D_MIG = 'migrations/20261128000013_t4d_rondering.sql';
const EF = ['rondering-pass-write', 'get-sensitive-fields', 'store-key-write', 'work-orders-list', 'time-entries-list', 'ao-time-write',
  'work-order-checklist-resolve', 'work-order-log-write', 'invoice-write'];
const T0 = '2026-11-01T08:00:00.000Z';
const EXTRA = [
  { alias: 'faltutanr', staffId: 'ST-T50', role: 'personal_utan_ru', authId: '00000000-0000-4000-8000-000000000750' },
];
const kat = (id, n) => ({ id, name: 'Kategori ' + id, points: Array.from({ length: n }, (_, i) => ({ id: id + '-P' + (i + 1), title: 'Punkt ' + (i + 1), status: '' })) });
const pass = (id, ron, staff, status, extra) => Object.assign({ id, ronderingId: ron, mallId: 'MALL-D1', propertyId: 'PROP-R1', customerId: 'CU-R1', sequenceNumber: 1,
  scheduledDate: '2026-11-30', staffIds: staff, status, categories: [kat('K1', 3), kat('K2', 30)], summary: { total: 33, ok: 0, anmärkningar: 0, ejKontrollerad: 0, ejAktuell: 0 },
  internalNote: '', createdAt: T0, updatedAt: T0 }, extra || {});

function laddaVarld(db, U) {
  const d = data();
  const F = U.falt.staffId, F2 = U.falt2.staffId;
  const personal = d.store.vift_roles.find((r) => r.id === 'personal');
  const roller = d.store.vift_roles.map((r) => (r.id === 'personal' ? Object.assign({}, r, { permissions: r.permissions.concat(['objects_access_assigned', 'rondering_utfor']) }) : r)).concat([
    { id: 'personal_utan_ru', label: 'Personal utan rondering_utfor (egen)', active: true, permissions: personal.permissions.concat(['objects_access_assigned']) },
  ]);
  const staff = d.store.vift_staff.concat(EXTRA.map((u) => ({ id: u.staffId, firstName: 'T4D', lastName: u.alias, email: u.alias + '@example.test', role: u.role, active: true, phone: '070-000 07 50' })));
  const ronderingar = [
    { id: 'RON-D1', name: 'Rondering Testgatan', templateId: 'MALL-D1', customerId: 'CU-R1', propertyId: 'PROP-R1', description: 'Månadsrondering', internalNote: 'INTERN-RON-D1',
      categories: [kat('K1', 3)], occasions: [{ id: 'O1', date: '2026-11-30', staffId: F2, staffName: 'Frida Fält' }], recurringSetups: [], pricingType: 'tim', priceGroupId: 'PG-1', priceGroupName: 'Standard',
      hourRate: 650, fixedPrice: 0, debiterbar: true, status: 'planerad', performedBy: F, images: [{ name: 'bild.jpg' }], createdAt: T0, updatedAt: T0 },
    { id: 'RON-D2', name: 'Rondering Låtsasgatan', customerId: 'CU-R3', propertyId: 'PROP-R2', internalNote: 'INTERN-RON-D2', categories: [], pricingType: 'fast', fixedPrice: 9000, status: 'planerad', createdAt: T0, updatedAt: T0 },
  ];
  const mallar = [{ id: 'MALL-D1', name: 'Mall D1', categories: [kat('K1', 3)], createdAt: T0 }];
  const pass_ = [
    pass('PASS-D1', 'RON-D1', [F], 'planerat'),
    pass('PASS-D2', 'RON-D2', [F2], 'planerat', { propertyId: 'PROP-R2', customerId: 'CU-R3' }),
    pass('PASS-D3', 'RON-D1', [F], 'slutfört', { completedAt: T0, completedBy: F }),
    pass('PASS-D4', 'RON-D1', [F, F2], 'pågående'),
    pass('PASS-D5', 'RON-D1', ['ST-T50'], 'planerat'),
  ];
  const logg = (d.store.vift_activityLog || []).concat([
    { id: 'ACT-D1', type: 'rondering_started', ronderingId: 'RON-D1', userId: U.chef.staffId, description: 'Rondering startad', timestamp: T0 },
    { id: 'ACT-D2', type: 'rondering_started', ronderingId: 'RON-D2', userId: U.chef.staffId, description: 'Rondering startad', timestamp: T0 },
  ]);
  const store = Object.assign({}, d.store, { vift_roles: roller, vift_staff: staff, vift_ronderingar: ronderingar, vift_ronderingsmallar: mallar, vift_ronderingspass: pass_, vift_activityLog: logg });
  const sql = ['begin;'];
  for (const u of EXTRA) {
    sql.push(`insert into auth.users(id, email) values (${lit(u.authId)}, ${lit(u.alias + '@example.test')}) on conflict do nothing;`);
    sql.push(`insert into public.app_users(user_id, staff_id, role_id, active, is_admin) select ${lit(u.authId)}, ${lit(u.staffId)}, ${lit(u.role)}, true, false where not exists (select 1 from public.app_users where user_id = ${lit(u.authId)});`);
    U[u.alias] = { alias: u.alias, staffId: u.staffId, role: u.role, email: u.alias + '@example.test', authId: u.authId };
  }
  for (const [k, v] of Object.entries(store)) sql.push(`insert into public.store(key, value, updated_at) values (${lit(k)}, ${jlit(v)}, '2026-11-01T08:00:00Z') on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;`);
  sql.push(`insert into public.property_sensitive_access(property_id, object_id, door_code, updated_by) values ('PROP-R1', null, 'TEST-FAST-D', 'syntetisk'), ('PROP-R2', null, 'TEST-FAST-E', 'syntetisk');`);
  sql.push('commit;');
  psql(db, sql.join('\n'));
  return store;
}

const KS = { keys: ['vift_ronderingspass', 'vift_ronderingar', 'vift_ronderingsmallar', 'vift_activityLog', 'vift_avvikelser', 'vift_workOrders'], tables: ['op_idempotency'] };
const passAv = (db, id) => (val(db, 'vift_ronderingspass') || []).find((p) => p.id === id);
const ids = (l) => (Array.isArray(l) ? l : []).map((x) => x && x.id).sort().join(',');

(async () => {
  const HIST = fs.mkdtempSync(path.join(os.tmpdir(), 'vift-t4d-'));
  process.on('exit', () => { try { fs.rmSync(HIST, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
  execFileSync('tar', ['-x', '-C', HIST], { input: execFileSync('git', ['-C', path.join(__dirname, '..'), 'archive', FORE_COMMIT, 'supabase'], { maxBuffer: 512 * 1024 * 1024 }) });
  const rotFore = path.join(HIST, 'supabase');
  ok(!fs.existsSync(path.join(rotFore, T4D_MIG)) && fs.existsSync(path.join(rotFore, 'migrations', '20261128000012_t4c_atkomstinformation.sql')), 'jämförelsekoden (före) = T4-C ' + FORE_COMMIT + ' (utan T4-D-migrationen)');

  const r = byggReplik({ utelamna: franOchMed(T4D_MIG).filter((x) => x !== T4D_MIG) });
  const { db, U } = r;
  ok(r.steg[r.steg.length - 1].rel === T4D_MIG, 'kedjan innehåller T4-D-migrationen 20261128000013 sist (efter T4-C)');
  ok(r.rapport.oforklarade === 0, `schemajämförelse: 0 oförklarade (T4-D:s objekt förklarade via t4-andringar.json): ${r.rapport.identiska} identiska, ${r.rapport.forklarade} förklarade`);
  laddaVarld(db, U);
  psql(db, `create table public._t4d_bas as select * from public.store; create table public._t4d_idem as select * from public.op_idempotency;`);
  const aterstall = () => psql(db, `begin; delete from public.store; insert into public.store select * from public._t4d_bas; delete from public.op_idempotency; insert into public.op_idempotency select * from public._t4d_idem; delete from public.stamp_status; commit;`);
  const ef = await laddaEf(db, EF);

  const rf = byggReplik({ rot: rotFore, schemakontroll: false });
  const Uf = rf.U;
  laddaVarld(rf.db, Uf);
  psql(rf.db, `create table public._t4d_bas as select * from public.store;`);
  const aterstallFore = () => psql(rf.db, `begin; delete from public.store; insert into public.store select * from public._t4d_bas; delete from public.stamp_status; commit;`);
  const efFore = await laddaEf(rf.db, EF, { root: rotFore });

  const RPW = (e, user, body) => e.anropa('rondering-pass-write', { user, body });
  const SK = (e, user, body) => e.anropa('store-key-write', { user, body });
  const lasR = async (e, user) => { const s = await SK(e, user, { action: 'readAllWithHashes', keys: ['vift_ronderingspass', 'vift_ronderingar', 'vift_ronderingsmallar', 'vift_activityLog'] }); return (s.body && s.body.data) || {}; };
  const F = U.falt.staffId, F2 = U.falt2.staffId;
  const NEJ = async (namn, anrop, forvantat) => { const x = await expectReject(db, anrop, forvantat, KS); ok(x.ok, namn, x.fel.concat([JSON.stringify(x.svar && x.svar.body).slice(0, 200)])); return x; };
  const PP = (passId, pt, extra) => Object.assign({ action: 'pointPatch', passId, categoryId: 'K1', pointId: pt || 'K1-P1', status: 'ok', comment: 'ok' }, extra || {});

  // ════════════════ BASLINJE (oförändrad kod, T4-C): bristerna bevisas på samma data ════════════════
  {
    let s = await RPW(efFore, Uf.falt, PP('PASS-D1'));
    ok(s.status === 403 && s.body.error === 'forbidden' && !s.body.reason, 'BASLINJE (Ö3, SÄK-14/F19): fältet (personal med rondering_utfor) kan INTE utföra sitt eget pass — rondering-pass-write kräver ao_view_all för allt, ingen kontroll per pass', s.body);
    const d = await lasR(efFore, Uf.falt);
    ok(ids(d.ronderingspass).split(',').length === 5 && JSON.stringify(d.ronderingar).includes('INTERN-RON-D2') && JSON.stringify(d.ronderingar).includes('"hourRate":650') && (d.ronderingsmallar || []).length === 1,
      'BASLINJE (SÄK-14, R52/R53): fältet läser ALLA pass (även FÄ2:s), alla ronderingar med pris och intern anteckning, och mallarna via readAllWithHashes', [ids(d.ronderingspass), (d.ronderingar || []).length]);
    const rr = asUser(rf.db, Uf.begransad, `select coalesce(string_agg(key, ','), '') k from public.store where key in ('vift_ronderingspass','vift_ronderingar','vift_ronderingsmallar')`);
    ok(rr.ok && String(rr.rows[0].k).split(',').length === 3, 'BASLINJE: även begränsad läser pass, ronderingar och mallar direkt via REST (3 rader)', rr);
    s = await RPW(efFore, Uf.chef, PP('PASS-D2'));
    ok(s.status === 200, 'BASLINJE (arbetsledarens flöde, referens): ao_view_all utför vilket pass som helst', s.status);
    s = await SK(efFore, Uf.falt, { action: 'appendActivity', entry: { id: 'ACT-BAS-000001', type: 'point_ok', description: 'x', ronderingId: 'RON-D1' } });
    ok(s.status === 403 && s.body.reason === 'type_not_allowed', 'BASLINJE (T3-D beslut 5): ronderingshändelser kräver ao_view_all — fältet kan inte rapportera dem för sitt eget pass', s.body);
    aterstallFore();
  }

  // ════════════════ SEC-ROND-01: eget pass — läsa och utföra ════════════════
  {
    aterstall();
    const d = await lasR(ef, U.falt);
    ok(ids(d.ronderingspass) === 'PASS-D1,PASS-D3,PASS-D4', 'SEC-ROND-01 (läsa): fältet ser bara sina egna pass (D1, D3 slutfört, D4 delat)', ids(d.ronderingspass));
    const ron = (d.ronderingar || [])[0] || {};
    ok(ids(d.ronderingar) === 'RON-D1' && !['internalNote', 'hourRate', 'fixedPrice', 'pricingType', 'priceGroupId', 'priceGroupName', 'debiterbar', 'occasions', 'recurringSetups', 'images'].some((k) => k in ron) && ron.name && Array.isArray(ron.categories),
      'SEC-ROND-01 (läsa): ronderingen för egna pass utan pris, intern anteckning, bilder och schemats personal; inga andra ronderingar', ron);
    ok(Array.isArray(d.ronderingsmallar) && d.ronderingsmallar.length === 0, 'R53: fältet får inga mallar');
    let s = await RPW(ef, U.falt, { action: 'autoStart', passId: 'PASS-D1' });
    ok(s.status === 200 && passAv(db, 'PASS-D1').status === 'pågående', 'SEC-ROND-01: autoStart på eget pass → pågående', s.body);
    s = await RPW(ef, U.falt, PP('PASS-D1'));
    const pt = passAv(db, 'PASS-D1').categories[0].points[0];
    ok(s.status === 200 && pt.status === 'ok' && pt.checkedBy === F && passAv(db, 'PASS-D1').summary.ok === 1, 'SEC-ROND-01: rondering_point_patch på eget pass → 200, checkedBy = fältets personal-id (servern), summary omräknad', s.body);
    s = await RPW(ef, U.falt, PP('PASS-D1', 'K1-P2', { status: 'anmärkning', deviationId: 'AVV-X', workOrderId: 'AO-X' }));
    const pt2 = passAv(db, 'PASS-D1').categories[0].points[1];
    ok(s.status === 200 && pt2.status === 'anmärkning' && !pt2.deviationId && !pt2.workOrderId && JSON.stringify(s.body.ignoredFields) === JSON.stringify(['deviationId', 'workOrderId']),
      'R53: fältets avvikelse-/AO-referens ignoreras och redovisas (ignoredFields) — fältet skapar inte avvikelser eller AO via passet', s.body);
    s = await RPW(ef, U.falt, { action: 'pointReset', passId: 'PASS-D1', categoryId: 'K1', pointId: 'K1-P2' });
    ok(s.status === 200 && passAv(db, 'PASS-D1').categories[0].points[1].status === '', 'SEC-ROND-01: ångra punkt (pointReset) på eget pass', s.status);
    s = await RPW(ef, U.falt, { action: 'saveNote', passId: 'PASS-D1', note: 'Anteckning fält' });
    ok(s.status === 200 && passAv(db, 'PASS-D1').internalNote === 'Anteckning fält', 'SEC-ROND-01: rondering_pass_save_note på eget pass', s.status);
    s = await RPW(ef, U.falt, { action: 'complete', passId: 'PASS-D1' });
    ok(s.status === 200 && passAv(db, 'PASS-D1').status === 'slutfört' && passAv(db, 'PASS-D1').completedBy === F, 'SEC-ROND-01: rondering_pass_complete på eget pass → slutfört, completedBy = fältet (servern)', s.body);
    // Avslutat pass: fältet ändrar inte (409 pass_completed); autoStart är en no-op.
    await NEJ('pass_completed: fältet ändrar en punkt på sitt avslutade pass → 409 pass_completed', () => RPW(ef, U.falt, PP('PASS-D3')), { status: 409, error: 'pass_completed' });
    await NEJ('pass_completed: anteckning på avslutat pass → 409', () => RPW(ef, U.falt, { action: 'saveNote', passId: 'PASS-D3', note: 'x' }), { status: 409, error: 'pass_completed' });
    await NEJ('pass_completed: slutföra igen → 409', () => RPW(ef, U.falt, { action: 'complete', passId: 'PASS-D3' }), { status: 409, error: 'pass_completed' });
    const ks0 = ksTa(db, KS); s = await RPW(ef, U.falt, { action: 'autoStart', passId: 'PASS-D3' });
    ok(s.status === 200 && ksDiff(ks0, ksTa(db, KS)).length === 0, 'autoStart på eget avslutat pass: 200 utan ändring (idempotent no-op, som förut)', s.status);
  }

  // ════════════════ SEC-ROND-02/03/04/05: annans pass, skapa, utan behörighet, REST ════════════════
  {
    aterstall();
    const NA = { status: 403, error: 'forbidden', reason: 'not_assigned' };
    await NEJ('SEC-ROND-02: pointPatch på FÄ2:s pass → 403 forbidden/not_assigned, pass-KS oförändrad', () => RPW(ef, U.falt, PP('PASS-D2')), NA);
    await NEJ('SEC-ROND-02: pointReset på FÄ2:s pass → 403 not_assigned', () => RPW(ef, U.falt, { action: 'pointReset', passId: 'PASS-D2', categoryId: 'K1', pointId: 'K1-P1' }), NA);
    await NEJ('SEC-ROND-02: saveNote på FÄ2:s pass → 403 not_assigned', () => RPW(ef, U.falt, { action: 'saveNote', passId: 'PASS-D2', note: 'kapad' }), NA);
    await NEJ('SEC-ROND-02: autoStart på FÄ2:s pass → 403 not_assigned', () => RPW(ef, U.falt, { action: 'autoStart', passId: 'PASS-D2' }), NA);
    await NEJ('SEC-ROND-02: complete på FÄ2:s pass → 403 not_assigned', () => RPW(ef, U.falt, { action: 'complete', passId: 'PASS-D2' }), NA);
    await NEJ('SEC-ROND-02: okänt pass-id → 403 not_assigned (inget orakel för fältet)', () => RPW(ef, U.falt, PP('PASS-FINNS-INTE')), NA);
    const FB = { status: 403, error: 'forbidden', reason: null };
    await NEJ('SEC-ROND-03: fältet skapar pass (create) → 403 forbidden', () => RPW(ef, U.falt, { action: 'create', passTemplate: { ronderingId: 'RON-D1', staffIds: [F], categories: [] } }), FB);
    await NEJ('SEC-ROND-03: massskapande (bulkCreate) → 403 forbidden', () => RPW(ef, U.falt, { action: 'bulkCreate', ronderingId: 'RON-D1', candidates: [{ scheduledDate: '2026-12-01', staffIds: [F] }] }), FB);
    await NEJ('SEC-ROND-03: migrateLegacy → 403 forbidden', () => RPW(ef, U.falt, { action: 'migrateLegacy', pass: { id: 'PASS-MIG-X', ronderingId: 'RON-D1' } }), FB);
    await NEJ('SEC-ROND-03: mall via store-key-write (writeMerge vift_ronderingsmallar) → 403 forbidden', () => SK(ef, U.falt, { action: 'writeMerge', key: 'vift_ronderingsmallar', upserts: [{ id: 'MALL-X', data: { id: 'MALL-X', name: 'x' }, previous: null }], removals: [] }), FB);
    await NEJ('SEC-ROND-03: rondering via store-key-write (writeMerge vift_ronderingar) → 403 forbidden', () => SK(ef, U.falt, { action: 'writeMerge', key: 'vift_ronderingar', upserts: [{ id: 'RON-X', data: { id: 'RON-X', name: 'x' }, previous: null }], removals: [] }), FB);
    await NEJ('SEC-ROND-04: begränsad på ett pass → 403 forbidden', () => RPW(ef, U.begransad, PP('PASS-D1')), FB);
    await NEJ('SEC-ROND-04: egen roll "personal utan rondering_utfor" på EGET tilldelat pass (PASS-D5) → 403 forbidden', () => RPW(ef, U.faltutanr, PP('PASS-D5')), FB);
    await NEJ('SEC-ROND-04: tom behörighetslista → 403 forbidden', () => RPW(ef, U.tom, PP('PASS-D1')), FB);
    await NEJ('SEC-ROND-04: egen roll utan ao_view_all och utan rondering_utfor (personalansvarig) → 403 forbidden', () => RPW(ef, U.personalansvarig, PP('PASS-D1')), FB);
    for (const anv of ['begransad', 'faltutanr', 'tom']) {
      const d = await lasR(ef, U[anv]);
      ok((d.ronderingspass || []).length === 0 && (d.ronderingar || []).length === 0 && (d.ronderingsmallar || []).length === 0, `SEC-ROND-04 (läsa, ${anv}): inga pass, ronderingar eller mallar`, [ids(d.ronderingspass), ids(d.ronderingar)]);
    }
    for (const anv of ['falt', 'begransad']) {
      const w = asUser(db, U[anv], `insert into public.store(key, value) values ('vift_ronderingspass', '[]'::jsonb) on conflict (key) do update set value = excluded.value`);
      ok(!w.ok && w.code === '42501', `SEC-ROND-05 (${anv}): REST-skrivning av vift_ronderingspass → 42501`, w);
      const rr = asUser(db, U[anv], `select coalesce(string_agg(key, ','), '') k from public.store where key in ('vift_ronderingspass','vift_ronderingar','vift_ronderingsmallar')`);
      ok(rr.ok && rr.rows[0].k === '', `R52/R53 (${anv}): REST-läsning av pass, ronderingar och mallar ger 0 rader (bara via readAllWithHashes, projicerat)`, rr);
    }
    const rr = asUser(db, U.chef, `select coalesce(string_agg(key, ','), '') k from public.store where key in ('vift_ronderingspass','vift_ronderingar','vift_ronderingsmallar')`);
    ok(rr.ok && String(rr.rows[0].k).split(',').length === 3, 'arbetsledaren (ao_view_all) läser fortfarande hela pass, ronderingar och mallar via REST (LiveSync oförändrad)', rr);
    const g = asUser(db, U.falt, `select public.rondering_point_patch('PASS-D1','K1','K1-P1','ok','',null,null,${lit(F)},false,array['all'])`);
    ok(!g.ok && g.code === '42501', 'grants: passåtgärderna kan inte anropas direkt av authenticated (42501; perms kan inte förfalskas)', g);
    const acl = psql(db, `select string_agg(p.oid::regprocedure::text || '=' || coalesce(p.proacl::text, 'NULL'), ' ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like '\\_vift\\_t4d\\_%' or p.proname in ('rondering_point_patch','rondering_pass_save_note','rondering_pass_auto_start','rondering_pass_complete'))`);
    ok(!/authenticated|anon|NULL/.test(acl) && (acl.match(/service_role=X/g) || []).length === 7, 'grants: T4-D:s sju funktioner bara service_role', acl);
    ok(q(db, `select count(*) n from pg_proc where proname in ('rondering_point_patch','rondering_pass_save_note','rondering_pass_auto_start','rondering_pass_complete')`)[0].n === 4,
      'de gamla signaturerna (utan behörigheter) är borttagna — en äldre EF kan inte kringgå kontrollen');
  }

  // ════════════════ Arbetsledarens flöden oförändrade (jämfört med T4-C-koden) ════════════════
  {
    aterstall(); aterstallFore();
    const rensa = (b) => JSON.parse(JSON.stringify(b || {}), (k, v) => (['updatedAt', 'checkedAt', 'startedAt', 'completedAt', 'serverSignature', 'createdAt', 'id'].includes(k) && typeof v === 'string' && k !== 'id' ? 'T' : v));
    const steg = [PP('PASS-D2'), PP('PASS-D3', 'K1-P2', { status: 'anmärkning', deviationId: 'AVV-1' }), { action: 'pointReset', passId: 'PASS-D2', categoryId: 'K1', pointId: 'K1-P1' },
      { action: 'saveNote', passId: 'PASS-D2', note: 'AL' }, { action: 'autoStart', passId: 'PASS-D2' }, { action: 'complete', passId: 'PASS-D2' }, PP('PASS-FINNS-INTE'),
      { action: 'create', passTemplate: { ronderingId: 'RON-D1', staffIds: [F], categories: [kat('K1', 1)], scheduledDate: '2026-12-05' } },
      { action: 'bulkCreate', ronderingId: 'RON-D1', candidates: [{ scheduledDate: '2026-12-06', staffIds: [F2] }] }];
    const fel = [];
    for (const b of steg) {
      const nu = await RPW(ef, U.chef, b); const fo = await RPW(efFore, Uf.chef, b);
      if (nu.status !== fo.status || JSON.stringify(rensa(nu.body)) !== JSON.stringify(rensa(fo.body))) fel.push(b.action + ' ' + nu.status + '/' + fo.status);
    }
    const pa = val(db, 'vift_ronderingspass').map((p) => [p.id, p.status, JSON.stringify(p.summary), p.internalNote].join('|')).sort();
    const pf = val(rf.db, 'vift_ronderingspass').map((p) => [p.id, p.status, JSON.stringify(p.summary), p.internalNote].join('|')).sort();
    ok(fel.length === 0 && JSON.stringify(pa) === JSON.stringify(pf), 'arbetsledaren (ao_view_all): alla passåtgärder, även på avslutat pass och annans pass, skapa och massskapa ger samma status, svar och resultat som före T4-D (404 not_found för okänt pass som förut)', fel);
    aterstall(); aterstallFore();
  }

  // ════════════════ Ronderingshändelser (T3-D beslut 5) och SEC-B5-07 (T4-C:s gren aktiverad) ════════════════
  {
    aterstall();
    const KSL = { keys: ['vift_activityLog'] };
    let s = await SK(ef, U.falt, { action: 'appendActivity', entry: { id: 'ACT-T4D-000001', type: 'point_ok', description: 'Punkt godkänd', ronderingId: 'RON-D1' } });
    ok(s.status === 200 && val(db, 'vift_activityLog').some((e) => e.id === 'ACT-T4D-000001' && e.userId === F), 'T3-D beslut 5: fältet rapporterar point_ok för en rondering där det har ett eget pass (servern sätter aktören)', s.body);
    let x = await expectReject(db, () => SK(ef, U.falt, { action: 'appendActivity', entry: { id: 'ACT-T4D-000002', type: 'rondering_started', description: 'x', ronderingId: 'RON-D2' } }), { status: 403, error: 'forbidden', reason: 'ref_not_visible' }, KSL);
    ok(x.ok, 'T3-D beslut 5: händelse för en rondering UTAN eget pass → 403 forbidden/ref_not_visible', x.fel);
    x = await expectReject(db, () => SK(ef, U.falt, { action: 'appendActivity', entry: { id: 'ACT-T4D-000003', type: 'deviation_created', description: 'x', ronderingId: 'RON-D1' } }), { status: 403, error: 'forbidden', reason: 'type_not_allowed' }, KSL);
    ok(x.ok, 'avvikelsehändelser kräver fortsatt ao_view_all (R53) → 403 type_not_allowed', x.fel);
    x = await expectReject(db, () => SK(ef, U.faltutanr, { action: 'appendActivity', entry: { id: 'ACT-T4D-000004', type: 'point_ok', description: 'x', ronderingId: 'RON-D1' } }), { status: 403, error: 'forbidden', reason: 'type_not_allowed' }, KSL);
    ok(x.ok, 'utan rondering_utfor → 403 type_not_allowed', x.fel);
    const d = await lasR(ef, U.falt);
    const typer = (d.activityLog || []).filter((e) => e.ronderingId).map((e) => e.id).sort().join(',');
    ok(typer === 'ACT-D1,ACT-T4D-000001', 'aktivitetsloggen: fältet läser ronderingshändelser för ronderingar med eget pass (RON-D1), inte andras (RON-D2)', typer);
    const d2 = await lasR(ef, U.faltutanr);
    ok(!(d2.activityLog || []).some((e) => e.ronderingId), 'utan rondering_utfor: inga ronderingshändelser', d2.activityLog);
    // SEC-B5-07: T4-C:s ronderingsgren är nu aktiv (rondering_utfor verkställd).
    const GSF = (user, body) => ef.anropa('get-sensitive-fields', { user, body });
    s = await GSF(U.falt, { propertyId: 'PROP-R1', passId: 'PASS-D1' });
    ok(s.status === 200 && s.body.doorCode === 'TEST-FAST-D' && /^pass:PASS-D1$/.test(psql(db, `select detail from public.sensitive_access_audit order by ts desc limit 1`)),
      'SEC-B5-07 (aktiverad i T4-D): fältet får fastighetens åtkomstinformation för sitt eget aktiva pass, en allowed-rad (pass:PASS-D1) utan värden', s.body);
    const KSA = { keys: ['vift_ronderingspass'], tables: ['property_sensitive_access'] };
    for (const [namn, body, anv] of [['annans pass (PASS-D2)', { propertyId: 'PROP-R2', passId: 'PASS-D2' }, 'falt'], ['eget AVSLUTAT pass (PASS-D3)', { propertyId: 'PROP-R1', passId: 'PASS-D3' }, 'falt'],
      ['objektnivå via pass', { objectId: 'OBJ-R1', passId: 'PASS-D1' }, 'falt'], ['personal utan rondering_utfor, eget pass (PASS-D5)', { propertyId: 'PROP-R1', passId: 'PASS-D5' }, 'faltutanr']]) {
      const a0 = Number(psql(db, `select count(*) from public.sensitive_access_audit`));
      x = await expectReject(db, () => GSF(U[anv], body), { status: 403, error: 'forbidden', reason: 'not_assigned' }, KSA);
      ok(x.ok && Number(psql(db, `select count(*) from public.sensitive_access_audit`)) === a0 + 1, 'SEC-B5-07/08: ' + namn + ' → 403 not_assigned, en denied-rad', x.fel);
    }
    aterstall();
  }

  // ════════════════ Samtidighet (egna anslutningar) ════════════════
  {
    // ×20: FÄ och FÄ2 (båda tilldelade PASS-D4) kryssar olika punkter samtidigt → båda bevaras.
    const felA = [];
    for (let i = 0; i < 20; i++) {
      aterstall();
      const [a, b] = await Promise.all([RPW(ef, U.falt, PP('PASS-D4', 'K1-P1')), RPW(ef, U.falt2, PP('PASS-D4', 'K1-P2', { status: 'ej_aktuell' }))]);
      const p = passAv(db, 'PASS-D4').categories[0].points;
      if (a.status !== 200 || b.status !== 200 || p[0].status !== 'ok' || p[0].checkedBy !== F || p[1].status !== 'ej_aktuell' || p[1].checkedBy !== F2) felA.push([a.status, b.status, p[0].status, p[1].status]);
    }
    ok(felA.length === 0, 'samtidighet ×20: två tilldelade kryssar olika punkter på samma pass samtidigt — båda ändringarna bevaras (radlåset), rätt checkedBy', felA.slice(0, 3));
    // ×20 TOCTOU: arbetsledaren tar bort fältet ur passet i en transaktion som håller låset; fältets åtgärd väntar och nekas.
    const felB = [];
    for (let i = 0; i < 20; i++) {
      aterstall();
      const tag = 't4d_las_' + i;
      const p = psqlAsync(db, `begin; update public.store set value = (select jsonb_agg(case when e->>'id' = 'PASS-D1' then e || '{"staffIds":["ST-R05"]}'::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_ronderingspass';
        select pg_sleep(0.4) /* ${tag} */; commit;`);
      for (let k = 0; k < 200 && psql(db, `select count(*) from pg_stat_activity where query like ${lit('%' + tag + '%')} and state = 'active' and pid <> pg_backend_pid()`) !== '1'; k++) await new Promise((res) => setTimeout(res, 10));
      const s = await RPW(ef, U.falt, PP('PASS-D1'));
      const pr = await p;
      const pt = passAv(db, 'PASS-D1').categories[0].points[0];
      if (!pr.ok || s.status !== 403 || s.body.reason !== 'not_assigned' || pt.status !== '') felB.push([pr.ok, s.status, s.body.reason, pt.status]);
    }
    ok(felB.length === 0, 'samtidighet ×20 (TOCTOU): tilldelningen tas bort i en annan transaktion som håller låset — fältets åtgärd väntar och nekas (403 not_assigned); passet orört', felB.slice(0, 3));
    // ×20: slutföra och kryssa samtidigt (fältet, eget pass) — aldrig en punktändring efter slutförandet.
    const felC = []; let fore = 0, efter = 0;
    for (let i = 0; i < 20; i++) {
      aterstall();
      const [c, pp] = await Promise.all([RPW(ef, U.falt, { action: 'complete', passId: 'PASS-D4' }), RPW(ef, U.falt2, PP('PASS-D4', 'K1-P3'))]);
      const ps = passAv(db, 'PASS-D4');
      const p3 = ps.categories[0].points[2];
      if (c.status !== 200) felC.push('complete ' + c.status);
      else if (pp.status === 200) { fore++; if (!(p3.status === 'ok' && p3.checkedAt <= ps.completedAt && ps.summary.ok === 1)) felC.push('patch efter complete'); }
      else if (pp.status === 409 && pp.body.error === 'pass_completed') { efter++; if (p3.status !== '') felC.push('patch trots 409'); }
      else felC.push('oväntat ' + pp.status);
    }
    ok(felC.length === 0 && fore + efter === 20, `samtidighet ×20: slutföra och kryssa samtidigt — antingen före (${fore}, med i summeringen) eller nekad efter (${efter}, 409 pass_completed); aldrig en ändring efter slutförandet`, felC.slice(0, 3));
    aterstall();
  }

  // ════════════════ Verkställande och speglingar ════════════════
  {
    const ejv = psql(db, `select array_to_string(public._vift_ej_verkstallda(), ',')`).split(',').sort();
    const std = JSON.parse(fs.readFileSync(path.join(serverRot(), 'manual', 't3e_standardroller', 'standardroller.json'), 'utf8'));
    const fake = require('./e2e/t4d-regler.js').EJ_VERKSTALLDA.slice().sort();
    ok(!ejv.includes('rondering_utfor') && ejv.join() === Object.keys(std.ejVerkstallda).sort().join() && ejv.join() === fake.join() && std.version === 't4d-2026-11-28',
      'rondering_utfor verkställd: borttagen ur _vift_ej_verkstallda(), standardroller.json (t4d-2026-11-28) och fake-backendens lista', [ejv, Object.keys(std.ejVerkstallda), fake]);
    ok(psql(db, `select public._vift_staff_external(array['dashboard_view','ao_view_own','rondering_utfor'])`) === 't' && psql(db, `select public._vift_t4a_kontakt(array['dashboard_view','ao_view_own','rondering_utfor'])`) === 'f',
      'verkställandet ändrar inte extern/intern-indelningen (rondering_utfor står i D-04:s fasta tilläggslista)');
    const alog = fs.readFileSync(path.join(serverRot(), 'functions', 'store-key-write', 'activity-log.ts'), 'utf8');
    ok(/point_ok: \['ao_view_all', 'rondering_utfor'\]/.test(alog) && psql(db, `select array_to_string(public._vift_activity_type_perms('point_ok'), ',')`) === 'ao_view_all,rondering_utfor',
      'spegling: activity-log.ts TYPE_PERMS = _vift_activity_type_perms för ronderingshändelserna');
  }

  // ════════════════ Ingen oavsiktlig breddning ════════════════
  {
    /* Profil (lib/t3e.js) med T4-C-koden (före) och T4-D-koden (efter) på samma data. Beslutade skillnader:
       (a) las:vift_ronderingar och rest:vift_ronderingar — urval per pass för roller utan ao_view_all (avsmalning;
       fältet med rondering_utfor behåller ronderingen för sina egna pass, utan pris och intern anteckning);
       (b) las:vift_activityLog för fält med rondering_utfor: ronderingshändelser för egna pass (T3-D beslut 5). */
    const BAS = ['admin', 'chef', 'ekonomi', 'falt', 'falt2', 'begransad', 'personalansvarig', 'adminhanterare', 'chef_utan_faktura', 'saljare', 'tom', 'faltutanr'];
    const forklara = (anv, k, fore, efter, perms) => {
      const ao = perms.includes('all') || perms.includes('ao_view_all');
      if (ao) return null;
      if (k === 'rest:vift_ronderingar') return fore === '1' && efter === '0' ? 'a' : null;
      if (k === 'las:vift_ronderingar') {
        try { const a = JSON.parse(fore) || [], b = JSON.parse(efter) || []; return b.every((x) => { const y = a.find((z) => z.id === x.id); return y && Object.keys(x).every((kk) => JSON.stringify(x[kk]) === JSON.stringify(y[kk])); }) && b.length <= a.length ? 'a' : null; } catch (e) { return null; }
      }
      if (k === 'las:vift_activityLog' && perms.includes('rondering_utfor')) {
        const egna = (val(db, 'vift_ronderingspass') || []).filter((x) => (x.staffIds || []).includes(U[anv] ? U[anv].staffId : U.falt.staffId)).map((x) => x.ronderingId);
        try { const a = JSON.parse(fore) || [], b = JSON.parse(efter) || []; const ny = b.filter((x) => !a.some((y) => y.id === x.id)); return a.every((x) => b.some((y) => y.id === x.id)) && ny.length > 0 && ny.every((x) => egna.includes(x.ronderingId) && /^rondering_|^point_/.test(x.type)) ? 'b' : null; } catch (e) { return null; }
      }
      return null;
    };
    const permsAv = (dbx, anv) => { const st = val(dbx, 'vift_staff').find((s) => s.id === U[anv].staffId); const ro = val(dbx, 'vift_roles').find((x) => x.id === (st && st.role)); return (ro && ro.permissions) || []; };
    const oforkl = []; const beslutade = {}; let jamforda = 0;
    for (const anv of BAS) {
      aterstall(); aterstallFore();
      const pe = await profil({ ef, db }, U[anv], { aoEgen: 'AO-A1', aoEgenPag: 'AO-A2' });
      const pf = await profil({ ef: efFore, db: rf.db }, Uf[anv], { aoEgen: 'AO-A1', aoEgenPag: 'AO-A2' });
      jamforda += Object.keys(pe).length;
      for (const k of jamforProfil(pf, pe)) { const f = forklara(anv, k, pf[k], pe[k], permsAv(db, anv)); if (!f) oforkl.push(anv + ' ' + k + ': ' + String(pf[k]).slice(0, 80) + ' → ' + String(pe[k]).slice(0, 80)); else beslutade[anv] = (beslutade[anv] || '') + f; }
    }
    ok(oforkl.length === 0 && jamforda > 500, `ingen breddning (testplanen §4.5): för ${BAS.length} användare och ${jamforda} nycklar/svar är varje skillnad mellan T4-C-koden och T4-D beslutad (ronderingar per pass för roller utan ao_view_all, ronderingshändelser för egna pass) — ${JSON.stringify(beslutade)}`, oforkl.slice(0, 8));
    const oforklS = []; const utfall = {};
    for (const roll of STAGING_ROLLER) {
      for (const [dbx, Ux] of [[db, U], [rf.db, Uf]]) {
        const rr = val(dbx, 'vift_roles').filter((x) => x.id !== roll.id).concat([roll]);
        psql(dbx, `update public.store set value = ${jlit(rr)} where key = 'vift_roles'; update public.store set value = (select jsonb_agg(case when e->>'id' = ${lit(Ux.falt.staffId)} then e || ${jlit({ role: roll.id })} else e end) from jsonb_array_elements(value) e) where key = 'vift_staff';`);
      }
      const pe = await profil({ ef, db }, U.falt, { aoEgen: 'AO-A1', aoEgenPag: 'AO-A2' });
      const pf = await profil({ ef: efFore, db: rf.db }, Uf.falt, { aoEgen: 'AO-A1', aoEgenPag: 'AO-A2' });
      const sk = jamforProfil(pf, pe);
      utfall[roll.id] = sk.map((k) => forklara(roll.id, k, pf[k], pe[k], roll.permissions || []) || '?').join('') || '0';
      for (const k of sk) if (!forklara(roll.id, k, pf[k], pe[k], roll.permissions || [])) oforklS.push(roll.id + ' ' + k);
      aterstall(); aterstallFore();
    }
    ok(oforklS.length === 0, 'införandeanalys (läsande, ingen ändring i STAGING): för STAGING:s sju roller är varje skillnad en beslutad avsmalning (ronderingar per pass för roller utan ao_view_all); ingen roll får mer — ' + JSON.stringify(utfall), oforklS.slice(0, 8));
  }

  // ════════════════ Gammal klient och installationsfönstret ════════════════
  {
    aterstall();
    // Fönstret: T4-C:s EF (gammal signatur) mot T4-D-databasen → RPC:n finns inte; fail closed (500 update_failed), inget ändras.
    const efGammal = await laddaEf(db, ['rondering-pass-write'], { root: rotFore });
    let x = await expectReject(db, () => RPW(efGammal, U.chef, PP('PASS-D2')), { status: 500, error: 'update_failed' }, KS);
    ok(x.svar.status === 500 && x.andrat.length === 0, 'installationsfönstret (gammal EF, ny databas): arbetsledarens passåtgärd misslyckas utan ändring (500 update_failed, fail closed) tills EF:en installerats — fönstret ska vara minuter', x.svar.body);
    // Fel ordning: ny EF mot T4-C-databasen → RPC med nya argument finns inte → fail closed.
    const efNy = await laddaEf(rf.db, ['rondering-pass-write']);
    const k0 = ksTa(rf.db, KS);
    const s = await RPW(efNy, Uf.falt, PP('PASS-D1'));
    ok(s.status === 500 && ksDiff(k0, ksTa(rf.db, KS)).length === 0, 'fel installationsordning (ny EF före databasen): 500 utan ändring (fail closed)', s.body);
    // v3.4/T3/T4-klient (arbetsledare): samma anropsform som förut; fältets gamla klient når inte sidan (ao_view_all) och läser inga andras pass.
    const d = await lasR(ef, U.falt);
    ok(ids(d.ronderingspass) === 'PASS-D1,PASS-D3,PASS-D4', 'gammal klient (fält): readAllWithHashes ger bara egna pass — skyddet ligger i servern oberoende av klientversion');
  }

  // ════════════════ Rollback (installera → rollback → installera), STOP och omvänd ordning ════════════════
  {
    const rb = byggReplik({ utelamna: franOchMed(T4D_MIG).filter((x) => x !== T4D_MIG), schemakontroll: false });
    laddaVarld(rb.db, rb.U);
    const efRb = await laddaEf(rb.db, ['rondering-pass-write']);
    let s = await RPW(efRb, rb.U.falt, PP('PASS-D1'));
    ok(s.status === 200, 'T4-D-koden skapar data (fältets punkt på eget pass)', s.body);
    const KSR = { keys: ['vift_ronderingspass', 'vift_ronderingar', 'vift_ronderingsmallar', 'vift_activityLog', 'vift_roles', 'vift_staff'], tables: ['property_sensitive_access', 'sensitive_access_audit', 'app_users', 'op_idempotency'] };
    const fore = ksTa(rb.db, KSR);
    const jamfor = (env) => { try { return execFileSync('node', [path.join(__dirname, 'local', 'jamfor-schema.js'), rb.db], { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) }); } catch (e) { return String(e.stdout || ''); } };
    const ofo = (t) => Number((/(\d+) oförklarade/.exec(t) || [])[1]);
    psqlFile(rb.db, path.join(serverRot(), 'rollback', 'T4-D', 'rollback_t4d.sql'));
    let ut = jamfor({ T4_LAGE: 'T4-C' });
    ok(ofo(ut) === 0 && /OBS: T4-ändringar som inte syns.*_vift_t4d_pass_regel/.test(ut), 'rollback T4-D: schemat = läget efter T4-C (T4_LAGE=T4-C, 0 oförklarade; T4-D:s funktioner borta, de gamla signaturerna tillbaka)', ut.split('\n').filter((l) => /OFÖRKLARAD|oförklarade/.test(l)).slice(0, 5));
    ok(ksDiff(fore, ksTa(rb.db, KSR)).length === 0, 'rollback T4-D: INGEN data ändrad (pass med fältets ändringar ligger kvar)');
    ok(ofo(jamfor({})) > 0, 'utan T4_LAGE godtas inte läget före T4-D (jämförelsen är strikt)');
    const efRbFore = await laddaEf(rb.db, ['rondering-pass-write'], { root: rotFore });
    s = await RPW(efRbFore, rb.U.chef, PP('PASS-D1', 'K1-P2'));
    ok(s.status === 200, 'efter rollback fungerar T4-C:s EF (arbetsledaren) på data skapad av T4-D', s.body);
    let fel = null;
    try { psqlFile(rb.db, path.join(serverRot(), T4D_MIG)); } catch (e) { fel = e.message; }
    ut = jamfor();
    ok(!fel && ofo(ut) === 0 && !/OBS: T4-ändringar som inte syns/.test(ut), 'ny installation efter rollback: STOP-kontrollen godtar T4-C-versionerna; schemat = alla registrerade ändringar', fel || ut.split('\n').filter((l) => /OFÖRKLARAD|OBS/.test(l)).slice(0, 5));
    let stop = null;
    try { psqlFile(rb.db, path.join(serverRot(), T4D_MIG)); } catch (e) { stop = e.message; }
    ok(stop && /T4-D STOP: _vift_t4d_pass_regel finns redan/.test(stop), 'STOP-kontroll: en andra körning av 20261128000013 avbryts', stop);
    const fore2 = ksTa(rb.db, KSR);
    for (const p of ['T4-D/rollback_t4d.sql', 'T4-C/rollback_t4c.sql', 'T4-B/rollback_t4b.sql', 'T4-A-notiser/rollback_t4a_notiser.sql', 'T4-A/rollback_t4a.sql', 'T3-E/rollback_t3e.sql', 'T3-D/rollback_t3d.sql', 'T3-C/rollback_t3c.sql', 'T3-B/rollback_t3b.sql']) psqlFile(rb.db, path.join(serverRot(), 'rollback', p));
    ut = jamfor({ T3_IGNORERA: '1' });
    ok(ofo(ut) === 0, 'rollback T4-D + T4-C + T4-B + notiser + T4-A + T3-E + T3-D + T3-C + T3-B (omvänd installationsordning): schemat = STAGING-facit', ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
    ok(ksDiff(fore2, ksTa(rb.db, KSR)).length === 0, 'rollback hela vägen: ingen data ändrad');
    rb.stang();
    const rs = byggReplik({ utelamna: franOchMed('migrations/20261128000012_t4c_atkomstinformation.sql'), data: false, schemakontroll: false });
    stop = null;
    try { psqlFile(rs.db, path.join(serverRot(), T4D_MIG)); } catch (e) { stop = e.message; }
    ok(stop && /T4-D STOP: T4-C \(20261128000012\) måste vara installerad först/.test(stop), 'STOP-kontroll: T4-D utan T4-C avbryts', stop);
    rs.stang();
    const rd = byggReplik({ utelamna: franOchMed(T4D_MIG), data: false, schemakontroll: false });
    psql(rd.db, `create or replace function public.rondering_pass_auto_start(p_pass_id text) returns jsonb language sql as $$ select '{}'::jsonb $$;`);
    stop = null;
    try { psqlFile(rd.db, path.join(serverRot(), T4D_MIG)); } catch (e) { stop = e.message; }
    ok(stop && /T4-D STOP: public\.rondering_pass_auto_start\(text\) avviker/.test(stop), 'STOP-kontroll: en ersatt funktion som avviker från föregående version (drift) avbryter installationen', stop);
    rd.stang();
  }

  r.stang(); rf.stang();
  avsluta();
})().catch((e) => { console.error(e); process.exit(1); });
