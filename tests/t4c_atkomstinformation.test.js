'use strict';
/*
 * T4-C (2026-11-28; testgruppen `access_info`, SAKERHETSPROVNING-TESTPLAN §6 T4-C, BEHORIGHETSMATRIS §5.9
 * SEC-B5-06..13): åtkomstinformation till tilldelad personal (SÄK-7 tilldelningsvägen, D-05),
 * D-16 (läsande jämförelse) och D-23 (permanent radering tar bort den känsliga raden).
 * GODKÄNDA SÄKERHETSTESTER efter rättning och BASLINJE-fynden i oförändrad kod (T4-B, commit 3bb0874,
 * utläst med git archive) på samma data.
 *
 * Mot den lokala STAGING-replikan med hela repokedjan och de ändrade Edge Functions körda i Node. Varje
 * negativt fall kontrollerar exakt status, error och reason (BEHORIGHETSMATRIS §4) OCH oförändrad
 * kontrollsumma (store-nycklar, property_sensitive_access), och att EXAKT en revisionsrad (denied, utan
 * värden) tillkommit. Samtidighet: parallella EF-anrop, varje RPC-anrop i en egen anslutning; låsen i
 * RPC:n avgör. Lokalt verifierat; inget är prövat i STAGING.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ok, krav, avsluta } = require('./local/lib/test');
krav({ tsc: true });
const { byggReplik, serverRot, franOchMed } = require('./local/lib/replik');
const { laddaEf } = require('./local/lib/ef');
const { val, q, psql, psqlFile, lit, jlit, asUser, rpc } = require('./local/lib/db');
const { expectReject, ksTa, ksDiff, parallellt } = require('./local/lib/kontroll');
const { data } = require('./local/lib/data');
const { STAGING_ROLLER, profil, jamforProfil } = require('./local/lib/t3e');

const FORE_COMMIT = '3bb0874'; // T4-B (läget före T4-C)
const T4C_MIG = 'migrations/20261128000012_t4c_atkomstinformation.sql';
const EF = ['get-sensitive-fields', 'set-sensitive-fields', 'store-key-write', 'work-orders-list', 'time-entries-list', 'ao-time-write',
  'work-order-checklist-resolve', 'work-order-log-write', 'invoice-write'];
const T0 = '2026-11-01T08:00:00.000Z';
/* T4-D (2026-11-28): denna svit prövar T4-C-paketet SÅ SOM DET LEVERERADES — kedjan utan T4-D och senare
   (schemajämförelse med T4_LAGE=T4-C) och Edge Functions ur T4-C-commiten (3a23521). T4-D:s ändringar
   (ronderingsgrenen aktiverad, rondering per pass) prövas i t4d_rondering.test.js. */
const T4C_COMMIT = '3a23521';
const T4REG = JSON.parse(fs.readFileSync(path.join(__dirname, 'local', 't4-andringar.json'), 'utf8')).objekt;
const SENARE = Object.keys(T4REG).filter((k) => /^T4-[D-Z]$/.test(T4REG[k].paket) && !(T4REG[k].md5_t4c));
const obsBaraSenare = (ut) => { const m = /OBS: T4-ändringar som inte syns[^\n]*/.exec(ut); return !m || Object.keys(T4REG).filter((k) => !SENARE.includes(k)).every((k) => !m[0].includes(k)); };
function t4cKalla() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vift-t4c-kod-'));
  process.on('exit', () => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
  execFileSync('tar', ['-x', '-C', d], { input: execFileSync('git', ['-C', path.join(__dirname, '..'), 'archive', T4C_COMMIT, 'supabase'], { maxBuffer: 512 * 1024 * 1024 }) });
  return path.join(d, 'supabase');
}
const VARDEN = ['TEST-1001', 'TEST-2002', 'TEST-FAST-1', 'TEST-FAST-2', 'Nyckel i testskåp A', 'Nyckelbricka B', 'Ring på', 'LARM-TEST-9', 'KVITTO-TEST-7'];
/* Testvärldens standardroll "personal" har objects_access_assigned och rondering_utfor (som
   standardroller.json); egna roller prövar SEC-B5-09/10. */
const EXTRA = [
  { alias: 'faltutan', staffId: 'ST-T40', role: 'personal_utan_oaa', authId: '00000000-0000-4000-8000-000000000740' },
  { alias: 'chefutan', staffId: 'ST-T41', role: 'chef_utan_os', authId: '00000000-0000-4000-8000-000000000741' },
];

function laddaVarld(db, U) {
  const d = data();
  const F = U.falt.staffId, F2 = U.falt2.staffId;
  const personal = d.store.vift_roles.find((r) => r.id === 'personal');
  const chef = d.store.vift_roles.find((r) => r.id === 'chef');
  const roller = d.store.vift_roles.map((r) => (r.id === 'personal' ? Object.assign({}, r, { permissions: r.permissions.concat(['objects_access_assigned', 'rondering_utfor']) }) : r)).concat([
    { id: 'personal_utan_oaa', label: 'Personal utan objects_access_assigned (egen)', active: true, permissions: personal.permissions.slice() },
    { id: 'chef_utan_os', label: 'Arbetsledare utan objects_sensitive (egen)', active: true, permissions: chef.permissions.filter((p) => p !== 'objects_sensitive') },
  ]);
  const staff = d.store.vift_staff.concat(EXTRA.map((u) => ({ id: u.staffId, firstName: 'T4C', lastName: u.alias, email: u.alias + '@example.test', role: u.role, active: true, phone: '070-000 07 40' })));
  const aos = d.store.vift_workOrders.map((a) => (a.id === 'AO-A1' ? Object.assign({}, a, { staff: [F, 'ST-T40', U.begransad.staffId] }) : a)).concat([
    Object.assign({}, d.store.vift_workOrders.find((a) => a.id === 'AO-A8'), { id: 'AO-C1', title: 'Annans AO på OBJ-R2', objectId: 'OBJ-R2', propertyId: 'PROP-R2', staff: [F2] }),
    Object.assign({}, d.store.vift_workOrders.find((a) => a.id === 'AO-A1'), { id: 'AO-C2', title: 'Egen AO på fastigheten utan objekt', objectId: '', propertyId: 'PROP-R2', staff: [F], status: 'pågående' }),
  ]);
  const pass = [
    { id: 'PASS-C1', ronderingId: 'RON-C1', propertyId: 'PROP-R1', customerId: 'CU-R1', staffIds: [F], status: 'planerat', categories: [], summary: {}, createdAt: T0, updatedAt: T0 },
    { id: 'PASS-C2', ronderingId: 'RON-C1', propertyId: 'PROP-R1', customerId: 'CU-R1', staffIds: [F2], status: 'planerat', categories: [], summary: {}, createdAt: T0, updatedAt: T0 },
  ];
  const store = Object.assign({}, d.store, { vift_roles: roller, vift_staff: staff, vift_workOrders: aos, vift_ronderingspass: pass });
  const sql = ['begin;'];
  for (const u of EXTRA) {
    // (U är samma objekt för båda replikerna — lib/data.js — så kontot läggs in i varje databas.)
    sql.push(`insert into auth.users(id, email) values (${lit(u.authId)}, ${lit(u.alias + '@example.test')}) on conflict do nothing;`);
    sql.push(`insert into public.app_users(user_id, staff_id, role_id, active, is_admin) select ${lit(u.authId)}, ${lit(u.staffId)}, ${lit(u.role)}, true, false where not exists (select 1 from public.app_users where user_id = ${lit(u.authId)});`);
    U[u.alias] = { alias: u.alias, staffId: u.staffId, role: u.role, email: u.alias + '@example.test', authId: u.authId };
  }
  for (const [k, v] of Object.entries(store)) sql.push(`insert into public.store(key, value, updated_at) values (${lit(k)}, ${jlit(v)}, '2026-11-01T08:00:00Z') on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;`);
  // Fastighetsnivå (object_id null) och larm/kvittens på OBJ-R1.
  sql.push(`update public.property_sensitive_access set alarm_information = 'LARM-TEST-9', key_receipt = 'KVITTO-TEST-7' where object_id = 'OBJ-R1';`);
  sql.push(`insert into public.property_sensitive_access(property_id, object_id, door_code, access_code, updated_by) values ('PROP-R1', null, 'TEST-FAST-1', 'TEST-FAST-1', 'syntetisk'), ('PROP-R2', null, 'TEST-FAST-2', null, 'syntetisk');`);
  sql.push('commit;');
  psql(db, sql.join('\n'));
  return store;
}

const KS = { keys: ['vift_workOrders', 'vift_propertyObjects', 'vift_properties', 'vift_ronderingspass', 'vift_roles', 'vift_staff'], tables: ['property_sensitive_access', 'op_idempotency'] };
const auditN = (db) => Number(psql(db, `select count(*) from public.sensitive_access_audit`));
const sistaAudit = (db) => q(db, `select status, action, object_id, property_id, fields, detail, user_email from public.sensitive_access_audit order by ts desc, id desc limit 1`)[0] || {};
const vardenIAudit = (db) => Number(psql(db, `select count(*) from public.sensitive_access_audit a where ${VARDEN.map((v) => `a::text like ${lit('%' + v + '%')}`).join(' or ')}`));

(async () => {
  const HIST = fs.mkdtempSync(path.join(os.tmpdir(), 'vift-t4c-'));
  process.on('exit', () => { try { fs.rmSync(HIST, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
  execFileSync('tar', ['-x', '-C', HIST], { input: execFileSync('git', ['-C', path.join(__dirname, '..'), 'archive', FORE_COMMIT, 'supabase'], { maxBuffer: 512 * 1024 * 1024 }) });
  const rotFore = path.join(HIST, 'supabase');
  ok(!fs.existsSync(path.join(rotFore, T4C_MIG)) && fs.existsSync(path.join(rotFore, 'migrations', '20261128000011_t4b_material_priser_tid.sql')), 'jämförelsekoden (före) = T4-B ' + FORE_COMMIT + ' (utan T4-C-migrationen)');

  process.env.T4_LAGE = 'T4-C';
  const rotT4c = t4cKalla();
  const r = byggReplik({ utelamna: franOchMed(T4C_MIG).filter((x) => x !== T4C_MIG) });
  const { db, U } = r;
  ok(r.steg[r.steg.length - 1].rel === T4C_MIG, 'kedjan innehåller T4-C-migrationen 20261128000012 sist (efter T4-B)');
  ok(r.rapport.oforklarade === 0, `schemajämförelse: 0 oförklarade (T4-C:s objekt förklarade via t4-andringar.json): ${r.rapport.identiska} identiska, ${r.rapport.forklarade} förklarade`, r.rapport.text && r.rapport.text.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
  laddaVarld(db, U);
  psql(db, `create table public._t4c_bas as select * from public.store; create table public._t4c_psa as select * from public.property_sensitive_access; create table public._t4c_idem as select * from public.op_idempotency;`);
  const aterstall = () => psql(db, `begin; delete from public.store; insert into public.store select * from public._t4c_bas; delete from public.property_sensitive_access; insert into public.property_sensitive_access select * from public._t4c_psa;
    delete from public.op_idempotency; insert into public.op_idempotency select * from public._t4c_idem; delete from public.stamp_status; commit;`);
  const ef = await laddaEf(db, EF, { root: rotT4c });

  const rf = byggReplik({ rot: rotFore, schemakontroll: false });
  const Uf = rf.U;
  laddaVarld(rf.db, Uf);
  psql(rf.db, `create table public._t4c_bas as select * from public.store; create table public._t4c_psa as select * from public.property_sensitive_access;`);
  const aterstallFore = () => psql(rf.db, `begin; delete from public.store; insert into public.store select * from public._t4c_bas; delete from public.property_sensitive_access; insert into public.property_sensitive_access select * from public._t4c_psa; delete from public.stamp_status; commit;`);
  const efFore = await laddaEf(rf.db, EF, { root: rotFore });

  const GSF = (e, user, body) => e.anropa('get-sensitive-fields', { user, body });
  const SSF = (e, user, body) => e.anropa('set-sensitive-fields', { user, body });
  const SK = (e, user, body) => e.anropa('store-key-write', { user, body });
  const el = (dbx, k, id) => (val(dbx, k) || []).find((x) => x.id === id);
  const merge = (e, dbx, user, key, upd, rem) => SK(e, user, { action: 'writeMerge', key,
    upserts: (upd || []).map((x) => ({ id: x.id, data: x, previous: el(dbx, key, x.id) || null })),
    removals: (rem || []).map((id) => ({ id, previous: el(dbx, key, id) })) });
  const psaRad = (dbx, where) => q(dbx, `select property_id, object_id from public.property_sensitive_access where ${where}`);
  const F = U.falt.staffId;
  /* Negativt fall: exakt status/error/reason, KS oförändrad och exakt EN ny revisionsrad (denied, utan värden). */
  const NEJ = async (namn, anrop, forvantat) => {
    const a0 = auditN(db);
    const x = await expectReject(db, anrop, forvantat, KS);
    const s = sistaAudit(db);
    const fel = x.fel.slice();
    if (auditN(db) !== a0 + 1) fel.push('revisionsrader ' + (auditN(db) - a0) + ' ≠ 1');
    else if (s.status !== 'denied' || s.action !== 'read' || (s.fields || []).length) fel.push('revisionsraden ' + JSON.stringify(s));
    ok(fel.length === 0, namn, fel.concat([JSON.stringify(x.svar && x.svar.body).slice(0, 200)]));
    return x;
  };

  // ════════════════ BASLINJE (oförändrad kod, T4-B): bristerna bevisas på samma data ════════════════
  {
    let s = await GSF(efFore, Uf.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A1' });
    ok(s.status === 403 && /objects_sensitive/.test(s.body.error || ''), 'BASLINJE (SÄK-7 tilldelningsvägen, D-05): fältet (personal med objects_access_assigned) får INTE portkoden för sin egen tilldelade aktiva AO — vägen saknas (403 för alla utan objects_sensitive)', s.body);
    const ejv = psql(rf.db, `select array_to_string(public._vift_ej_verkstallda(), ',')`);
    ok(/objects_access_assigned/.test(ejv), 'BASLINJE: objects_access_assigned står i _vift_ej_verkstallda() (verkningslös)', ejv);
    const x = await merge(efFore, rf.db, Uf.admin, 'vift_propertyObjects', [], ['OBJ-R2']);
    ok(x.status === 200 && !el(rf.db, 'vift_propertyObjects', 'OBJ-R2') && psaRad(rf.db, `object_id = 'OBJ-R2'`).length === 1,
      'BASLINJE (D-23): permanent radering av objektet OBJ-R2 lämnar den känsliga raden (portkod, nyckel) kvar i property_sensitive_access', x.body);
    aterstallFore();
  }

  // ════════════════ SEC-B5-06: egen tilldelad aktiv AO → 200, exakt en revisionsrad allowed utan värden ════════════════
  {
    const a0 = auditN(db); const fore = ksTa(db, KS);
    const s = await GSF(ef, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A1' });
    const rad = sistaAudit(db);
    ok(s.status === 200 && s.body.doorCode === 'TEST-1001' && s.body.keyInformation === 'Nyckel i testskåp A' && s.body.accessInformation === 'Ring på'
      && s.body.alarmInformation === 'LARM-TEST-9' && s.body.accessCode === 'TEST-1001' && s.body.keyReceipt === null,
    'SEC-B5-06: fältet får åtkomstinformationen (portkod, nyckel, tillträde, larm, kod — inte nyckelkvittensen) för objektet på sin egen tilldelade aktiva AO', s.body);
    ok(auditN(db) === a0 + 1 && rad.status === 'allowed' && rad.action === 'read' && rad.object_id === 'OBJ-R1' && rad.detail === 'ao:AO-A1'
      && JSON.stringify(rad.fields) === JSON.stringify(['doorCode', 'keyInformation', 'alarmInformation', 'accessInformation', 'accessCode']) && rad.user_email === U.falt.email,
    'SEC-B5-06: exakt en revisionsrad allowed (fältnamn, väg ao:AO-A1, anroparen) — inga värden', rad);
    ok(ksDiff(fore, ksTa(db, KS)).length === 0, 'SEC-B5-06: läsningen ändrar inga data (store, property_sensitive_access)');
    let s2 = await GSF(ef, U.falt, { objectId: 'OBJ-R1' });
    const egnaAktiva = val(db, 'vift_workOrders').filter((a) => (a.staff || []).includes(F) && ['nytt', 'planerad', 'pågående'].includes(a.status) && !a.archived && !a.deleted && !a.invoiceId && a.objectId === 'OBJ-R1').map((a) => 'ao:' + a.id);
    ok(s2.status === 200 && s2.body.doorCode === 'TEST-1001' && egnaAktiva.includes(sistaAudit(db).detail), 'SEC-B5-06: utan AO-referens prövas fältets egna aktiva AO på objektet (' + egnaAktiva.join(', ') + ')', [s2.body, sistaAudit(db).detail]);
    s2 = await GSF(ef, U.falt, { propertyId: 'PROP-R1', workOrderId: 'AO-A1' });
    ok(s2.status === 200 && s2.body.doorCode === 'TEST-FAST-1' && sistaAudit(db).property_id === 'PROP-R1' && sistaAudit(db).object_id === null,
      'SEC-B5-06: fastighetsnivån (entréns portkod) för fastigheten på den egna aktiva AO:n', s2.body);
    s2 = await GSF(ef, U.falt, { propertyId: 'PROP-R2', workOrderId: 'AO-C2' });
    ok(s2.status === 200 && s2.body.doorCode === 'TEST-FAST-2', 'SEC-B5-06: egen pågående AO på en fastighet utan objekt ger fastighetens åtkomstinformation', s2.body);
    s2 = await GSF(ef, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A2' });
    ok(s2.status === 200 && sistaAudit(db).detail === 'ao:AO-A2', 'SEC-B5-06: pågående AO godtas (AO-A2)', s2.body);
    s2 = await GSF(ef, U.chef, { objectId: 'OBJ-R1' });
    ok(s2.status === 200 && s2.body.keyReceipt === 'KVITTO-TEST-7' && sistaAudit(db).detail === 'objects_sensitive', 'objects_sensitive (arbetsledaren) oförändrad: alla sex fält, även nyckelkvittensen, loggat', s2.body);
    ok(vardenIAudit(db) === 0, 'inga portkoder, nyckel- eller tillträdesuppgifter i någon revisionsrad');
  }

  // ════════════════ SEC-B5-07: tilldelat ronderingspass — grenen förberedd, avstängd tills T4-D ════════════════
  {
    ok(psql(db, `select public._vift_t4c_rondering_aktiv(array['objects_access_assigned','rondering_utfor'])`) === 'f' && psql(db, `select 'rondering_utfor' = any(public._vift_ej_verkstallda())`) === 't',
      'SEC-B5-07 (förberedelse): ronderingsgrenen är AVSTÄNGD så länge rondering_utfor inte är verkställd (aktiveras av T4-D:s borttagning ur _vift_ej_verkstallda)');
    await NEJ('SEC-B5-07 (före T4-D): eget tilldelat pass på PROP-R1 → 403 forbidden/not_assigned (grenen avstängd), en denied-rad', () => GSF(ef, U.falt, { propertyId: 'PROP-R1', passId: 'PASS-C1' }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
    /* Grenen själv (som T4-D aktiverar): med en ej-verkställd-lista utan rondering_utfor (i en transaktion
       som rullas tillbaka) släpps exakt det egna aktiva passets fastighet. */
    const arg = (o, pr, pa, perms) => `public.sensitive_fields_read(${lit(o)}, ${lit(pr)}, null, ${lit(pa)}, ${lit(F)}, array[${perms.map(lit).join(',')}]::text[], ${lit(U.falt.authId)}, ${lit(U.falt.email)})`;
    const a0g = auditN(db);
    const g = JSON.parse(psql(db, `begin;
      create or replace function public._vift_ej_verkstallda() returns text[] language sql immutable set search_path = public as $$ select array['ao_plan_own','export_data','export_personal_data'] $$;
      select json_build_object('a', ${arg(null, 'PROP-R1', 'PASS-C1', ['objects_access_assigned', 'rondering_utfor'])}, 'b', ${arg(null, 'PROP-R1', 'PASS-C2', ['objects_access_assigned', 'rondering_utfor'])},
        'c', ${arg('OBJ-R1', null, 'PASS-C1', ['objects_access_assigned', 'rondering_utfor'])}, 'd', ${arg(null, 'PROP-R1', 'PASS-C1', ['objects_access_assigned'])},
        'e', ${arg(null, 'PROP-R1', null, ['objects_access_assigned', 'rondering_utfor'])})::text;
      rollback;`).trim().split('\n').pop());
    g.av = g.a.via; g.e2 = g.e.via; g.a = String(g.a.ok); g.b = g.b.reason; g.c = g.c.reason; g.d = g.d.reason;
    ok(g.a === 'true' && g.av === 'pass:PASS-C1' && g.b === 'not_assigned' && g.c === 'not_assigned' && g.d === 'not_assigned' && /^(ao|pass):/.test(g.e2 || '') && auditN(db) === a0g,
      'SEC-B5-07 (grenen, prövad med rondering_utfor verkställd i en transaktion som rullas tillbaka): eget aktivt pass ger fastighetens åtkomstinformation; annans pass, objektnivå via pass och utan rondering_utfor nekas', g);
    const ejv = psql(db, `select md5(pg_get_functiondef('public._vift_ej_verkstallda()'::regprocedure))`);
    const reg = JSON.parse(fs.readFileSync(path.join(__dirname, 'local', 't4-andringar.json'), 'utf8')).objekt['funktion:_vift_ej_verkstallda()'];
    ok(reg && (reg.md5_t4c || reg.md5).startsWith(ejv), '_vift_ej_verkstallda() oförändrad efter grenprovet (md5 = registrets T4-C-version)', ejv);
  }

  // ════════════════ SEC-B5-08: annans AO, öppen pool, klar AO m.fl. → 403 not_assigned, en denied-rad ════════════════
  {
    const FB = { status: 403, error: 'forbidden', reason: 'not_assigned' };
    await NEJ('SEC-B5-08: objekt på ANNANS AO (AO-A8, FÄ2)', () => GSF(ef, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A8' }), FB);
    await NEJ('SEC-B5-08: objekt på annans AO utan referens (OBJ-R2 har bara FÄ2:s AO-C1)', () => GSF(ef, U.falt, { objectId: 'OBJ-R2' }), FB);
    await NEJ('SEC-B5-08: öppen pool (AO-P1)', () => GSF(ef, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-P1' }), FB);
    await NEJ('SEC-B5-08: KLAR egen AO (AO-A3)', () => GSF(ef, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A3' }), FB);
    await NEJ('SEC-B5-08: fakturerad egen AO (AO-A9)', () => GSF(ef, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A9' }), FB);
    await NEJ('SEC-B5-08: avbruten egen AO (AO-A5)', () => GSF(ef, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A5' }), FB);
    await NEJ('SEC-B5-08: arkiverad egen AO (AO-A6)', () => GSF(ef, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A6' }), FB);
    await NEJ('SEC-B5-08: borttagen egen AO (AO-A7)', () => GSF(ef, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A7' }), FB);
    await NEJ('SEC-B5-08: egen aktiv AO men ett ANNAT objekt (AO-A1 ligger på OBJ-R1, frågar OBJ-R2)', () => GSF(ef, U.falt, { objectId: 'OBJ-R2', workOrderId: 'AO-A1' }), FB);
    await NEJ('SEC-B5-08: egen aktiv AO men en ANNAN fastighet (AO-A1 på PROP-R1, frågar PROP-R2)', () => GSF(ef, U.falt, { propertyId: 'PROP-R2', workOrderId: 'AO-A1' }), FB);
    await NEJ('SEC-B5-08: AO-id som inte finns', () => GSF(ef, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-FINNS-INTE' }), FB);
    await NEJ('SEC-B5-08: pass-referens på objektnivå (pass ger aldrig objektets kod)', () => GSF(ef, U.falt, { objectId: 'OBJ-R1', passId: 'PASS-C1' }), FB);
    await NEJ('SEC-B5-08: FÄ2 på AO-A1 (inte tilldelad)', () => GSF(ef, U.falt2, { objectId: 'OBJ-R1', workOrderId: 'AO-A1' }), FB);
    const svar = await GSF(ef, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A8' });
    ok(!JSON.stringify(svar.body).includes('TEST-') && Object.keys(svar.body).sort().join(',') === 'error,reason', 'SEC-B5-08: nekat svar innehåller inga värden och inget orakel (bara error/reason)', svar.body);
  }

  // ════════════════ SEC-B5-09 / SEC-B5-10 / SEC-B5-11 ════════════════
  {
    const FB = { status: 403, error: 'forbidden', reason: null };
    await NEJ('SEC-B5-09: begränsad (utan objects_access_assigned) på EGEN AO (AO-A1 → 403 forbidden, en denied-rad)', async () => {
      // begränsad tilldelas AO-A1 för provet (egen AO); återställs efteråt
      return GSF(ef, U.begransad, { objectId: 'OBJ-R1', workOrderId: 'AO-A1' });
    }, FB);
    await NEJ('SEC-B5-09: egen roll "personal utan objects_access_assigned" på EGEN tilldelad aktiv AO (AO-A1) → 403 forbidden', () => GSF(ef, U.faltutan, { objectId: 'OBJ-R1', workOrderId: 'AO-A1' }), FB);
    await NEJ('SEC-B5-09: tom behörighetslista → 403 forbidden', () => GSF(ef, U.tom, { objectId: 'OBJ-R1' }), FB);
    await NEJ('SEC-B5-09: arbetsledare utan objects_sensitive (egen roll) → 403 forbidden', () => GSF(ef, U.chefutan, { objectId: 'OBJ-R1' }), FB);
    let a0 = auditN(db);
    let x = await expectReject(db, () => GSF(ef, U.inaktivpersonal, { objectId: 'OBJ-R1' }), { status: 403, error: 'Forbidden' }, KS);
    ok(x.ok && auditN(db) === a0, 'inaktiv personalpost: 403 Forbidden (checkViftAuth) före all läsning — ingen revisionsrad, inget ändrat', x.fel);
    x = await expectReject(db, () => GSF(ef, U.falt, { workOrderId: 'AO-A1' }), { status: 400, error: 'missing_fields' }, KS);
    ok(x.ok && auditN(db) === a0, 'indata: varken objectId eller propertyId → 400 missing_fields (inget uttag, ingen revisionsrad)', x.fel);
    // SEC-B5-10: set-sensitive-fields utan objects_sensitive (oförändrad EF): 403, en denied-rad, tabellen orörd.
    for (const anv of ['chefutan', 'ekonomi', 'falt']) {
      a0 = auditN(db);
      x = await expectReject(db, () => SSF(ef, U[anv], { objectId: 'OBJ-R1', doorCode: 'NY-0000' }), { status: 403, error: 'Forbidden' }, KS);
      const s = sistaAudit(db);
      ok(x.ok && auditN(db) === a0 + 1 && s.status === 'denied' && s.action === 'write', `SEC-B5-10 (${anv}): set-sensitive-fields → 403, exakt en denied-rad (write), property_sensitive_access oförändrad`, x.fel.concat([JSON.stringify(s)]));
    }
    // SEC-B5-11: direkt REST.
    let rr = asUser(db, U.falt, `select count(*) from public.property_sensitive_access`);
    ok(!rr.ok && rr.code === '42501', 'SEC-B5-11: REST-läsning av property_sensitive_access nekas (42501)', rr);
    rr = asUser(db, U.chef, `select count(*) from public.property_sensitive_access`);
    ok(!rr.ok && rr.code === '42501', 'SEC-B5-11: även objects_sensitive-rollen nekas direkt REST (bara via EF)', rr);
    const fore = ksTa(db, { tables: ['sensitive_access_audit'] });
    rr = asUser(db, U.falt, `update public.sensitive_access_audit set detail = 'x'`);
    const rr2 = asUser(db, U.admin, `delete from public.sensitive_access_audit`);
    const rr3 = asUser(db, U.falt, `insert into public.sensitive_access_audit(action, status) values ('read', 'allowed')`);
    ok(!rr.ok && rr.code === '42501' && !rr2.ok && rr2.code === '42501' && !rr3.ok && rr3.code === '42501' && ksDiff(fore, ksTa(db, { tables: ['sensitive_access_audit'] })).length === 0,
      'SEC-B5-11: revisionsloggen kan inte ändras, raderas eller fyllas på via REST (42501), oförändrad', [rr, rr2, rr3]);
    rr = asUser(db, U.falt, `select count(*) n from public.sensitive_access_audit`);
    const egna = Number(psql(db, `select count(*) from public.sensitive_access_audit where user_id = ${lit(U.falt.authId)}`));
    ok(rr.ok && Number(rr.rows[0].n) === egna, 'SEC-B5-11: en användare ser bara sina egna revisionsrader via REST (RLS, oförändrat)', [rr, egna]);
    const g = asUser(db, U.falt, `select public.sensitive_fields_read('OBJ-R1', null, 'AO-A1', null, ${lit(F)}, array['objects_access_assigned'], ${lit(U.falt.authId)}, ${lit(U.falt.email)})`);
    ok(!g.ok && g.code === '42501', 'grants: sensitive_fields_read kan inte anropas av authenticated (42501) — bara service_role (EF)', g);
    const acl = psql(db, `select string_agg(p.proname || '=' || coalesce(p.proacl::text, 'NULL'), ' ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '%t4c%'`);
    ok(!/authenticated|anon|=X\/|NULL/.test(acl.replace(/service_role=X\/postgres|postgres=X\/postgres/g, '')), 'grants: T4-C:s hjälpfunktioner bara service_role (triggerfunktionen ingen)', acl);
  }

  // ════════════════ SEC-B5-12 (D-23): permanent radering tar bort raden atomiskt; arkivering behåller ════════════════
  {
    aterstall();
    const KSD = { keys: ['vift_workOrders'], tables: ['op_idempotency'] };
    // Arkivering/inaktivering (elementet finns kvar) behåller raden.
    let x = await merge(ef, db, U.admin, 'vift_propertyObjects', [Object.assign({}, el(db, 'vift_propertyObjects', 'OBJ-R2'), { status: 'inaktiv', archived: true })]);
    ok(x.status === 200 && psaRad(db, `object_id = 'OBJ-R2'`).length === 1 && el(db, 'vift_propertyObjects', 'OBJ-R2').status === 'inaktiv', 'D-23: arkivering/inaktivering av objektet behåller den känsliga raden', x.body);
    // Misslyckad radering (inaktuell previous → konflikt) tar inte bort raden.
    let a0 = auditN(db);
    x = await SK(ef, U.admin, { action: 'writeMerge', key: 'vift_propertyObjects', upserts: [], removals: [{ id: 'OBJ-R2', previous: { id: 'OBJ-R2', name: 'inaktuell' } }] });
    ok(el(db, 'vift_propertyObjects', 'OBJ-R2') && psaRad(db, `object_id = 'OBJ-R2'`).length === 1 && auditN(db) === a0, 'D-23: en radering som servern avvisar (konflikt) tar inte bort raden och ger ingen revisionsrad', x.body);
    // Rullad transaktion (atomiskt): raderingen i store rullas tillbaka → raden finns kvar.
    psql(db, `begin; update public.store set value = (select jsonb_agg(e) from jsonb_array_elements(value) e where e->>'id' <> 'OBJ-R2') where key = 'vift_propertyObjects'; rollback;`);
    ok(psaRad(db, `object_id = 'OBJ-R2'`).length === 1 && auditN(db) === a0, 'D-23 (atomiskt): en store-skrivning som rullas tillbaka tar inte bort den känsliga raden');
    // Permanent radering → raden borta i samma transaktion, revisionsrad utan värden.
    const fore = ksTa(db, KSD);
    x = await merge(ef, db, U.admin, 'vift_propertyObjects', [], ['OBJ-R2']);
    let s = sistaAudit(db);
    ok(x.status === 200 && !el(db, 'vift_propertyObjects', 'OBJ-R2') && psaRad(db, `object_id = 'OBJ-R2'`).length === 0 && psaRad(db, `object_id = 'OBJ-R1'`).length === 1
      && auditN(db) === a0 + 1 && s.status === 'allowed' && s.action === 'write' && s.object_id === 'OBJ-R2' && s.property_id === 'PROP-R2' && s.user_email === U.admin.email
      && /permanent_delete/.test(s.detail) && JSON.stringify(s.fields) === JSON.stringify(['doorCode', 'keyInformation', 'accessCode']),
    'SEC-B5-12 (D-23): permanent radering av objektet tar bort raden i samma transaktion; en revisionsrad (write, permanent_delete, fältnamn, aktören) utan värden; andra objekts rader orörda', [x.body, s]);
    ok(ksDiff(fore, ksTa(db, KSD)).filter((k) => k !== 'store:vift_lastChanged').length === 0 && vardenIAudit(db) === 0, 'D-23: inget annat ändrat (utöver synksignalen); inga värden i revisionsloggen', [ksDiff(fore, ksTa(db, KSD)), vardenIAudit(db)]);
    // Fastighet: permanent radering tar bort fastighetsnivåns rad (object_id null), inte objektens.
    aterstall(); a0 = auditN(db);
    x = await merge(ef, db, U.admin, 'vift_properties', [], ['PROP-R2']);
    s = sistaAudit(db);
    ok(x.status === 200 && psaRad(db, `property_id = 'PROP-R2' and object_id is null`).length === 0 && psaRad(db, `object_id = 'OBJ-R2'`).length === 1 && auditN(db) === a0 + 1 && s.property_id === 'PROP-R2' && s.object_id === null,
      'D-23: permanent radering av fastigheten tar bort fastighetsnivåns rad (objektens rader följer sina objekt)', [x.body, s]);
    // Hela värdet via write (v3.4:s väg) → samma regel.
    aterstall(); a0 = auditN(db);
    const hash = psql(db, `select encode(sha256(convert_to(value::text, 'UTF8')), 'hex') from public.store where key = 'vift_propertyObjects'`);
    x = await SK(ef, U.admin, { action: 'write', key: 'vift_propertyObjects', value: val(db, 'vift_propertyObjects').filter((o) => o.id !== 'OBJ-R2'), expectedHash: hash });
    ok(x.status === 200 && psaRad(db, `object_id = 'OBJ-R2'`).length === 0 && auditN(db) === a0 + 1, 'D-23: samma regel för hela värdet (write, v3.4-klientens väg)', x.body);
    // Utan rad (objekt utan känsliga uppgifter): ingen revisionsrad.
    aterstall(); psql(db, `delete from public.property_sensitive_access where object_id = 'OBJ-R2'`); a0 = auditN(db);
    x = await merge(ef, db, U.admin, 'vift_propertyObjects', [], ['OBJ-R2']);
    ok(x.status === 200 && auditN(db) === a0, 'D-23: objekt utan känslig rad raderas utan revisionsrad (inget togs bort)', x.body);
    // Samtidighet ×20: radering av OBJ-R2 och samtidiga läsningar (objects_sensitive) — läsningen ser antingen raden eller ingen; aldrig fel.
    let felS = [];
    for (let i = 0; i < 20; i++) {
      aterstall();
      const [w, g] = await Promise.all([merge(ef, db, U.admin, 'vift_propertyObjects', [], ['OBJ-R2']), GSF(ef, U.chef, { objectId: 'OBJ-R2' })]);
      if (w.status !== 200 || g.status !== 200 || !(g.body.doorCode === 'TEST-2002' || g.body.doorCode === null) || psaRad(db, `object_id = 'OBJ-R2'`).length !== 0) felS.push([w.status, g.status, g.body.doorCode]);
    }
    ok(felS.length === 0, 'D-23 samtidighet ×20 (egna anslutningar): permanent radering och samtidig läsning — raden alltid borttagen, läsningen ser antingen hela raden eller ingen, inga fel', felS.slice(0, 3));
    aterstall();
  }

  // ════════════════ SEC-B5-13 (D-16): läsande jämförelserapport, bara antal ════════════════
  {
    aterstall();
    const KSA = { keys: ['vift_workOrders', 'vift_propertyObjects', 'vift_properties', 'vift_recurringOrders'], tables: ['property_sensitive_access', 'sensitive_access_audit'] };
    const fore = ksTa(db, KSA);
    const ut = execFileSync('psql', ['-d', db, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', path.join(serverRot(), 'manual', 't4c_d16_jamforelse', 'jamforelse.sql')], { encoding: 'utf8' });
    const rap = JSON.parse(ut.trim());
    ok(rap.objekt && rap.objekt.olika === 2 && rap.fastigheter.saknas_i_blob === 2 && rap.tabellrader_totalt === 4 && rap.tabellrader_utan_post_i_blob === 0
      && rap.ogonblicksbilder.vift_workOrders.med_kod === 20 && rap.ogonblicksbilder.vift_workOrders.olika_tabell === 20 && rap.ogonblicksbilder.vift_recurringOrders.olika_tabell === 1,
    'SEC-B5-13 (D-16): jämförelserapporten ger antal per kategori (objekt: lika/olika, fastigheter: saknas i blob, AO- och återkommande ögonblicksbilder)', rap);
    ok(!VARDEN.some((v) => ut.includes(v)) && !/TEST-PORT/.test(ut), 'SEC-B5-13: rapporten innehåller inga värden (bara antal)');
    ok(ksDiff(fore, ksTa(db, KSA)).length === 0, 'SEC-B5-13: ingen ändring (READ ONLY, rullas tillbaka) — ingen migrering, ingen borttagning (D-16)');
    let skriv = null;
    try { psql(db, `begin transaction read only; update public.property_sensitive_access set door_code = null; commit;`); } catch (e) { skriv = e.message; }
    ok(skriv && /read-only/.test(skriv), 'SEC-B5-13: rapportens transaktionsläge (read only) nekar varje skrivning', skriv);
  }

  // ════════════════ Samtidighet ×20 (egna anslutningar) ════════════════
  {
    aterstall();
    let a0 = auditN(db);
    const res = await parallellt(20, () => GSF(ef, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A1' }));
    ok(res.every((x) => x.status === 200 && x.body.doorCode === 'TEST-1001') && auditN(db) === a0 + 20 && Number(psql(db, `select count(*) from (select * from public.sensitive_access_audit order by ts desc limit 20) x where status = 'allowed'`)) === 20,
      'samtidighet ×20: 20 parallella uttag → 20 svar och exakt 20 revisionsrader (varje uttag loggat)', res.map((x) => x.status));
    a0 = auditN(db);
    const nej = await parallellt(20, () => GSF(ef, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A8' }));
    ok(nej.every((x) => x.status === 403 && x.body.reason === 'not_assigned') && auditN(db) === a0 + 20, 'samtidighet ×20: 20 parallella nekade uttag → 20 denied-rader, inga värden', nej.map((x) => x.status));
    /* TOCTOU: en annan transaktion tar bort fältets tilldelning och håller låset på vift_workOrders när
       uttaget görs. Kontrollen i RPC:n väntar på låset (FOR SHARE) och prövar den SENASTE tilldelningen —
       uttaget nekas, aldrig ett uttag på en tilldelning som just tagits bort (×20, egna anslutningar). */
    const { psqlAsync } = require('./local/lib/db');
    const felR = [];
    for (let i = 0; i < 20; i++) {
      aterstall();
      const tag = 't4c_las_' + i;
      const p = psqlAsync(db, `begin; update public.store set value = (select jsonb_agg(case when e->>'id' = 'AO-A1' then e || '{"staff":["ST-T40"]}'::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_workOrders';
        select pg_sleep(0.4) /* ${tag} */; commit;`);
      for (let k = 0; k < 100 && psql(db, `select count(*) from pg_stat_activity where query like ${lit('%' + tag + '%')} and state = 'active' and pid <> pg_backend_pid()`) !== '1'; k++) await new Promise((res) => setTimeout(res, 10));
      const g = await GSF(ef, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A1' });
      const pr = await p;
      const rad = sistaAudit(db);
      if (!pr.ok || g.status !== 403 || g.body.reason !== 'not_assigned' || rad.status !== 'denied') felR.push([pr.ok, g.status, g.body.reason, rad.status]);
    }
    ok(felR.length === 0, 'samtidighet ×20 (TOCTOU): tilldelningen tas bort i en annan transaktion som håller låset — uttaget väntar och nekas (403 not_assigned, denied-rad); inget uttag på en borttagen tilldelning', felR.slice(0, 3));
    aterstall();
  }

  // ════════════════ Verkställande och speglingar ════════════════
  {
    const ejv = psql(db, `select array_to_string(public._vift_ej_verkstallda(), ',')`).split(',').sort();
    const std = JSON.parse(fs.readFileSync(path.join(serverRot(), 'manual', 't3e_standardroller', 'standardroller.json'), 'utf8'));
    const fake = require('./e2e/t4c-regler.js').EJ_VERKSTALLDA.slice().sort();
    /* standardroller.json speglar det senaste paketet; i T4-C-läget är rondering_utfor ännu inte verkställd (T4-D). */
    const senareV = ['rondering_utfor'].filter((x) => !Object.keys(std.ejVerkstallda).includes(x));
    ok(!ejv.includes('objects_access_assigned') && ejv.join() === Object.keys(std.ejVerkstallda).concat(senareV).sort().join() && ejv.join() === fake.join() && /^t4[c-z]-2026-11-28$/.test(std.version),
      'objects_access_assigned verkställd: borttagen ur _vift_ej_verkstallda(), standardroller.json (t4c-2026-11-28) och fake-backendens lista (samma lista)', [ejv, Object.keys(std.ejVerkstallda), fake]);
    ok(psql(db, `select public._vift_staff_external(array['dashboard_view','ao_view_own','objects_access_assigned'])`) === 't' && psql(db, `select public._vift_t4a_kontakt(array['dashboard_view','ao_view_own','objects_access_assigned'])`) === 'f',
      'verkställandet ändrar inte extern/intern-indelningen (objects_access_assigned står i D-04:s fasta tilläggslista)');
  }

  // ════════════════ Ingen oavsiktlig breddning: effektiv åtkomst före/efter per roll och STAGING-roll ════════════════
  {
    /* Profil (lib/t3e.js): läsningar (work-orders-list, time-entries-list, readAllWithHashes, REST) och de
       skrivande anropen, med T4-B-koden (före) och T4-C-koden (efter) på samma data. Beslutade skillnader:
       (a) anrop:portkod_objekt för roller med objects_access_assigned och egen aktiv AO på OBJ-R1: 200 (D-05);
       (b) felkoden för nekad get-sensitive-fields normaliserad: "Forbidden: objects_sensitive required" →
       "forbidden" (samma status 403, samma revisionsrad). Allt annat ska vara identiskt. */
    const BAS = ['admin', 'chef', 'ekonomi', 'falt', 'falt2', 'begransad', 'personalansvarig', 'adminhanterare', 'chef_utan_faktura', 'saljare', 'tom', 'faltutan', 'chefutan'];
    const forklara = (anv, nyckel, fore, efter, perms) => {
      if (nyckel !== 'anrop:portkod_objekt') return null;
      if (/^403\|Forbidden: objects_sensitive required\|\|/.test(fore) && /^403\|forbidden\|\|/.test(efter) && fore.split('|')[3] === efter.split('|')[3]) return 'b';
      if (/^403\|Forbidden: objects_sensitive required\|\|/.test(fore) && /^200\|\|\|/.test(efter) && perms.includes('objects_access_assigned')) return 'a';
      if (/^403\|Forbidden: objects_sensitive required\|\|/.test(fore) && /^403\|forbidden\|not_assigned\|/.test(efter) && perms.includes('objects_access_assigned')) return 'a';
      return null;
    };
    const permsAv = (dbx, anv) => { const st = val(dbx, 'vift_staff').find((s) => s.id === U[anv].staffId); const ro = val(dbx, 'vift_roles').find((x) => x.id === (st && st.role)); return (ro && ro.permissions) || []; };
    const oforkl = []; const beslutade = {};
    let jamforda = 0;
    for (const anv of BAS) {
      aterstall(); aterstallFore();
      const pe = await profil({ ef, db }, U[anv], { aoEgen: 'AO-A1', aoEgenPag: 'AO-A2' });
      const pf = await profil({ ef: efFore, db: rf.db }, Uf[anv], { aoEgen: 'AO-A1', aoEgenPag: 'AO-A2' });
      jamforda += Object.keys(pe).length;
      for (const k of jamforProfil(pf, pe)) {
        const f = forklara(anv, k, pf[k], pe[k], permsAv(db, anv));
        if (!f) oforkl.push(anv + ' ' + k + ': ' + String(pf[k]).slice(0, 80) + ' → ' + String(pe[k]).slice(0, 80)); else beslutade[anv] = f + ':' + String(pe[k]).slice(0, 30);
      }
    }
    ok(oforkl.length === 0 && jamforda > 500 && /^a:200/.test(beslutade.falt || '') && !/^a/.test(beslutade.faltutan || '') && !/^a/.test(beslutade.begransad || ''),
      `ingen breddning (testplanen §4.5): för ${BAS.length} användare och ${jamforda} nycklar/svar är varje skillnad mellan T4-B-koden (${FORE_COMMIT}) och T4-C beslutad — bara get-sensitive-fields: personal med objects_access_assigned når sin egen aktiva AO:s objekt; nekade får "forbidden" i stället för "Forbidden: objects_sensitive required" — utfall ${JSON.stringify(beslutade)}`, oforkl.slice(0, 8));
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
      for (const k of sk) if (!forklara(roll.id, k, pf[k], pe[k], roll.permissions || []) || forklara(roll.id, k, pf[k], pe[k], roll.permissions || []) === 'a') oforklS.push(roll.id + ' ' + k);
      aterstall(); aterstallFore();
    }
    ok(oforklS.length === 0, 'införandeanalys (läsande, ingen ändring i STAGING): ingen av STAGING:s sju roller har objects_access_assigned — ingen roll får ny åtkomst; enda skillnaden är felkodens form för nekad get-sensitive-fields (b) — ' + JSON.stringify(utfall), oforklS.slice(0, 8));
  }

  // ════════════════ Gammal klient (v3.4, T3, T4-A/B i Service Worker-cache) och installationsfönstret ════════════════
  {
    aterstall(); aterstallFore();
    for (const anv of ['chef', 'admin']) {
      const nu = await GSF(ef, U[anv], { objectId: 'OBJ-R1' });
      const fo = await GSF(efFore, Uf[anv], { objectId: 'OBJ-R1' });
      ok(nu.status === 200 && JSON.stringify(nu.body) === JSON.stringify(fo.body), `gammal klient (${anv}, objects_sensitive): samma svar (fält och värden) som före T4-C — v3.4/T3/T4-klientens objekt- och AO-formulär fungerar oförändrat`, [nu.body, fo.body]);
      const nuP = await GSF(ef, U[anv], { propertyId: 'PROP-R1' });
      const foP = await GSF(efFore, Uf[anv], { propertyId: 'PROP-R1' });
      ok(nuP.status === 200 && JSON.stringify(nuP.body) === JSON.stringify(foP.body), `gammal klient (${anv}): fastighetsnivån oförändrad`, [nuP.body, foP.body]);
    }
    // Fönstret: T4-B:s EF mot T4-C-databasen (databasen installerad, EF inte ännu) — som före; fältet nekas.
    const efGammal = await laddaEf(db, ['get-sensitive-fields'], { root: rotFore });
    let s = await GSF(efGammal, U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A1' });
    ok(s.status === 403 && /objects_sensitive/.test(s.body.error), 'installationsfönstret (gammal EF, ny databas): fältet nekas som före (403); ingen ny väg förrän EF:en installerats', s.body);
    s = await GSF(efGammal, U.chef, { objectId: 'OBJ-R1' });
    ok(s.status === 200 && s.body.doorCode === 'TEST-1001', 'installationsfönstret: objects_sensitive fungerar med den gamla EF:en', s.body);
    // Fel ordning: ny EF mot T4-B-databasen (RPC:n saknas) → 500 audit_unavailable, inga värden (fail closed).
    const efNyPaGammal = await laddaEf(rf.db, ['get-sensitive-fields'], { root: rotT4c });
    s = await GSF(efNyPaGammal, Uf.chef, { objectId: 'OBJ-R1' });
    ok(s.status === 500 && s.body.error === 'audit_unavailable' && !JSON.stringify(s.body).includes('TEST-'), 'fel installationsordning (ny EF före databasen): 500 audit_unavailable utan värden (fail closed)', s.body);
    // v3.4-klientens radering av objekt (writeMerge) → D-23 i servern oberoende av klient.
    const x = await merge(ef, db, U.admin, 'vift_propertyObjects', [], ['OBJ-R2']);
    ok(x.status === 200 && psaRad(db, `object_id = 'OBJ-R2'`).length === 0, 'gammal klient: v3.4:s radering av objekt (writeMerge) tar bort den känsliga raden — skyddet ligger i servern', x.body);
    aterstall();
  }

  // ════════════════ Rollback (installera → rollback → installera), STOP och omvänd ordning ════════════════
  {
    const rb = byggReplik({ utelamna: franOchMed(T4C_MIG).filter((x) => x !== T4C_MIG), schemakontroll: false });
    laddaVarld(rb.db, rb.U);
    const efRb = await laddaEf(rb.db, ['get-sensitive-fields', 'store-key-write'], { root: rotT4c });
    let s = await GSF(efRb, rb.U.falt, { objectId: 'OBJ-R1', workOrderId: 'AO-A1' });
    const x = await SK(efRb, rb.U.admin, { action: 'writeMerge', key: 'vift_propertyObjects', upserts: [], removals: [{ id: 'OBJ-R2', previous: el(rb.db, 'vift_propertyObjects', 'OBJ-R2') }] });
    ok(s.status === 200 && x.status === 200, 'T4-C-koden skapar data (uttag med revisionsrad, permanent radering med revisionsrad)');
    const KSR = { keys: ['vift_workOrders', 'vift_propertyObjects', 'vift_properties', 'vift_roles', 'vift_staff'], tables: ['property_sensitive_access', 'sensitive_access_audit', 'app_users', 'op_idempotency'] };
    const fore = ksTa(rb.db, KSR);
    const jamfor = (env) => { try { return execFileSync('node', [path.join(__dirname, 'local', 'jamfor-schema.js'), rb.db], { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) }); } catch (e) { return String(e.stdout || ''); } };
    const ofo = (t) => Number((/(\d+) oförklarade/.exec(t) || [])[1]);
    psqlFile(rb.db, path.join(serverRot(), 'rollback', 'T4-C', 'rollback_t4c.sql'));
    let ut = jamfor({ T4_LAGE: 'T4-B' });
    ok(ofo(ut) === 0 && /OBS: T4-ändringar som inte syns.*sensitive_fields_read/.test(ut), 'rollback T4-C: schemat = läget efter T4-B (T4_LAGE=T4-B, 0 oförklarade; T4-C:s funktioner och trigger borta)', ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
    ok(ksDiff(fore, ksTa(rb.db, KSR)).length === 0, 'rollback T4-C: INGEN data ändrad (revisionsrader och känsliga rader ligger kvar)');
    ok(ofo(jamfor({})) > 0, 'utan T4_LAGE godtas inte läget före T4-C (jämförelsen är strikt)');
    const efRbFore = await laddaEf(rb.db, ['get-sensitive-fields'], { root: rotFore });
    s = await GSF(efRbFore, rb.U.chef, { objectId: 'OBJ-R1' });
    ok(s.status === 200 && s.body.doorCode === 'TEST-1001', 'efter rollback fungerar T4-B:s EF (objects_sensitive) på data skapad av T4-C', s.body);
    let fel = null;
    try { psqlFile(rb.db, path.join(serverRot(), T4C_MIG)); } catch (e) { fel = e.message; }
    ut = jamfor();
    ok(!fel && ofo(ut) === 0 && obsBaraSenare(ut), 'ny installation efter rollback: STOP-kontrollen godtar T4-B-versionerna; schemat = alla registrerade T4-A–T4-C-ändringar (senare T4-paket inte installerade)', fel || ut.split('\n').filter((l) => /OFÖRKLARAD|OBS/.test(l)).slice(0, 5));
    let stop = null;
    try { psqlFile(rb.db, path.join(serverRot(), T4C_MIG)); } catch (e) { stop = e.message; }
    ok(stop && /T4-C STOP: sensitive_fields_read finns redan/.test(stop), 'STOP-kontroll: en andra körning av 20261128000012 avbryts', stop);
    const fore2 = ksTa(rb.db, KSR);
    for (const p of ['T4-C/rollback_t4c.sql', 'T4-B/rollback_t4b.sql', 'T4-A-notiser/rollback_t4a_notiser.sql', 'T4-A/rollback_t4a.sql', 'T3-E/rollback_t3e.sql', 'T3-D/rollback_t3d.sql', 'T3-C/rollback_t3c.sql', 'T3-B/rollback_t3b.sql']) psqlFile(rb.db, path.join(serverRot(), 'rollback', p));
    ut = jamfor({ T3_IGNORERA: '1' });
    ok(ofo(ut) === 0, 'rollback T4-C + T4-B + notiser + T4-A + T3-E + T3-D + T3-C + T3-B (omvänd installationsordning): schemat = STAGING-facit', ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
    ok(ksDiff(fore2, ksTa(rb.db, KSR)).length === 0, 'rollback hela vägen: ingen data ändrad');
    rb.stang();
    const rs = byggReplik({ utelamna: franOchMed('migrations/20261128000011_t4b_material_priser_tid.sql'), data: false, schemakontroll: false });
    stop = null;
    try { psqlFile(rs.db, path.join(serverRot(), T4C_MIG)); } catch (e) { stop = e.message; }
    ok(stop && /T4-C STOP: T4-B \(20261128000011\) måste vara installerad först/.test(stop), 'STOP-kontroll: T4-C utan T4-B avbryts', stop);
    rs.stang();
    const rd = byggReplik({ utelamna: franOchMed(T4C_MIG), data: false, schemakontroll: false });
    psql(rd.db, `create or replace function public._vift_ej_verkstallda() returns text[] language sql immutable set search_path = public as $$ select array['drift'] $$;`);
    stop = null;
    try { psqlFile(rd.db, path.join(serverRot(), T4C_MIG)); } catch (e) { stop = e.message; }
    ok(stop && /T4-C STOP: public\._vift_ej_verkstallda\(\) avviker/.test(stop), 'STOP-kontroll: en ersatt funktion som avviker från föregående version (drift) avbryter installationen', stop);
    rd.stang();
  }

  r.stang(); rf.stang();
  avsluta();
})().catch((e) => { console.error(e); process.exit(1); });
