'use strict';
/*
 * T4-A, tilläggsdel NOTISER (2026-11-28; testgruppen `notifications_write`, T4-RESULTAT T4-A §9):
 * säker skrivväg (appendNotification/markNotificationsRead under radlås), projektion per mottagare
 * i alla läsvägar, REST-vitlistan avvecklad (punkt 275), äldre klienters notisväg nekad utan att
 * andra flöden bryts. GODKÄNDA SÄKERHETSTESTER efter rättning och BASLINJE-fynden i oförändrad kod
 * (T4-A, commit 0d8cea9, utläst med git archive) på samma data.
 *
 * Mot den lokala STAGING-replikan med hela repokedjan (20261128000001–10) och de ändrade Edge
 * Functions körda i Node. Varje negativt fall kontrollerar exakt status, error och reason
 * (BEHORIGHETSMATRIS §4) OCH oförändrad kontrollsumma (vift_notifications, vift_lastChanged,
 * op_idempotency m.fl.). Samtidighet: parallella EF-anrop med barriär (radlåset i RPC:n avgör),
 * varje RPC-anrop i en egen anslutning. Lokalt verifierat; inget är prövat i STAGING.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ok, krav, avsluta } = require('./local/lib/test');
krav({ tsc: true });
const { byggReplik, serverRot, franOchMed } = require('./local/lib/replik');
const { laddaEf } = require('./local/lib/ef');
const { val, q, psql, psqlFile, lit, jlit, asUser, asUserAsync, rpc, rpcAsync } = require('./local/lib/db');
const { expectReject, expectAccept, ksTa, ksDiff, parallellt } = require('./local/lib/kontroll');
const { data } = require('./local/lib/data');
const { STAGING_ROLLER } = require('./local/lib/t3e');

const FORE_COMMIT = '0d8cea9'; // T4-A (läget före tilläggsdelen)
const EF = ['store-key-write', 'ao-time-write', 'work-orders-list'];
const NOTIS_MIG = path.join('migrations', '20261128000010_t4a_notiser.sql');
const T0 = '2026-11-01T08:00:00.000Z';
const clone = (v) => JSON.parse(JSON.stringify(v));
const idn = (l) => (Array.isArray(l) ? l : []).map((x) => x && x.id).sort();

/* ── Testvärlden: STAGING-likt register + notiser till flera mottagare och äldre poster ── */
function laddaVarld(db, U) {
  const d = data();
  const F = U.falt.staffId, F2 = U.falt2.staffId, C = U.chef.staffId, A = U.admin.staffId, T = U.tom.staffId;
  const roller = d.store.vift_roles.concat([
    { id: 'ao_edit_egen', label: 'AO-redigering, egna AO (egen)', active: true, permissions: ['dashboard_view', 'ao_view_own', 'ao_edit'] },
  ]);
  const nya = [{ alias: 'egen_red', staffId: 'ST-T20', role: 'ao_edit_egen', authId: '00000000-0000-4000-8000-000000000620' }];
  const staff = d.store.vift_staff.concat(nya.map((u) => ({ id: u.staffId, firstName: 'T4N', lastName: u.alias, email: u.alias + '@example.test', role: u.role, active: true, phone: '070-000 06 20' })));
  const aos = d.store.vift_workOrders.map((a) => (a.id === 'AO-A1' ? Object.assign({}, a, { staff: [F, 'ST-T20'] }) : a));
  const n = (id, userId, extra) => Object.assign({ id, userId, type: 'ao_assigned', message: 'Du har tilldelats ' + id, aoId: '', offerId: '', read: false, createdAt: T0 }, extra || {});
  const notiser = [
    n('N-F-1', F, { aoId: 'AO-A1', message: 'Du har tilldelats AO-A1: Testuppdrag AO-A1' }),
    n('N-F2-1', F2, { aoId: 'AO-A8', message: 'Du har tilldelats AO-A8: ring Kalle Kund 070-000 00 00 (känslig)' }),
    n('N-C-1', C, { type: 'offer_approved', offerId: 'OFF-R1', message: 'Testoffert skickad (OFF-R1) godkänd av Kalle Kund – kund: Kalle Kund' }),
    n('N-A-1', A, { type: 'service_done', message: 'Admins egen påminnelse' }),
    n('N-T-1', T, { type: 'service_overdue', message: 'Provkontots påminnelse' }),
    { id: 'N-OLD-1', type: 'info', message: 'Äldre notis utan mottagarfält', read: false, createdAt: T0 },
    { id: 'N-NUM-1', userId: 4, type: 'info', message: 'Äldre notis med numeriskt mottagarfält', read: false, createdAt: T0 },
  ];
  const store = Object.assign({}, d.store, { vift_roles: roller, vift_staff: staff, vift_workOrders: aos, vift_notifications: notiser });
  const sql = ['begin;'];
  for (const u of nya) {
    sql.push(`insert into auth.users(id, email) values (${lit(u.authId)}, ${lit(u.alias + '@example.test')});`);
    sql.push(`insert into public.app_users(user_id, staff_id, role_id, active, is_admin) values (${lit(u.authId)}, ${lit(u.staffId)}, ${lit(u.role)}, true, false);`);
    U[u.alias] = { alias: u.alias, staffId: u.staffId, role: u.role, email: u.alias + '@example.test', authId: u.authId };
  }
  for (const [k, v] of Object.entries(store)) sql.push(`insert into public.store(key, value, updated_at) values (${lit(k)}, ${jlit(v)}, '2026-11-01T08:00:00Z') on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;`);
  sql.push('commit;');
  psql(db, sql.join('\n'));
  return store;
}

/* v3.4-, T3- och T4-A-klientens persistNotifs: REST-läsning av listan, sedan EN upsert av
   [vift_notifications, vift_lastChanged] (Storage.setRemoteStrict, Prefer: merge-duplicates). */
const restLasNotiser = (db, user) => asUser(db, user, `select value from public.store where key = 'vift_notifications'`);
const restUpsert = (rows) => `insert into public.store(key, value) values ${rows.map(([k, v]) => `(${lit(k)}, ${jlit(v)})`).join(', ')} on conflict (key) do update set value = excluded.value`;


/* T4-B (2026-11-28): denna svit prövar T4-A-paketet SÅ SOM DET LEVERERADES — kedjan utan T4-B-migrationen
   (20261128000011, schemajämförelse med T4_LAGE=T4-A-notiser) och Edge Functions ur T4-A-commiten (2060b8f).
   T4-B:s ändringar av samma vägar prövas i t4b_material_priser.test.js (även hela kedjan och samspelet). */
const T4A_COMMIT = '2060b8f';
const T4B_MIG = 'migrations/20261128000011_t4b_material_priser_tid.sql';
const T4REG = JSON.parse(fs.readFileSync(path.join(__dirname, 'local', 't4-andringar.json'), 'utf8')).objekt;
/* T4-C: även senare paket (T4-C, T4-D …) saknas i T4-A-läget. */
const EJ_T4B = Object.keys(T4REG).filter((k) => !/^T4-[B-Z]$/.test(T4REG[k].paket));
/* OBS-raden får bara nämna T4-B:s objekt (som inte är installerade i T4-A-läget). */
const obsBaraT4b = (ut) => { const m = /OBS: T4-ändringar som inte syns[^\n]*/.exec(ut); return !m || EJ_T4B.every((k) => !m[0].includes(k)); };
function t4aKalla() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vift-t4a-kod-'));
  process.on('exit', () => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
  execFileSync('tar', ['-x', '-C', d], { input: execFileSync('git', ['-C', path.join(__dirname, '..'), 'archive', T4A_COMMIT, 'supabase'], { maxBuffer: 512 * 1024 * 1024 }) });
  return path.join(d, 'supabase');
}

(async () => {
  const HIST = fs.mkdtempSync(path.join(os.tmpdir(), 'vift-t4n-'));
  process.on('exit', () => { try { fs.rmSync(HIST, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
  execFileSync('tar', ['-x', '-C', HIST], { input: execFileSync('git', ['-C', path.join(__dirname, '..'), 'archive', FORE_COMMIT, 'supabase'], { maxBuffer: 512 * 1024 * 1024 }) });
  const rotFore = path.join(HIST, 'supabase');
  ok(!fs.existsSync(path.join(rotFore, NOTIS_MIG)) && fs.existsSync(path.join(rotFore, 'migrations', '20261128000009_t4a_skyddade_falt.sql')), 'jämförelsekoden (före) = T4-A ' + FORE_COMMIT + ' (utan notismigrationen)');

  process.env.T4_LAGE = 'T4-A-notiser';
  const rotT4a = t4aKalla();
  const r = byggReplik({ utelamna: franOchMed(T4B_MIG) });
  const { db, U } = r;
  ok(r.steg.some((s) => s.rel === NOTIS_MIG) && r.steg[r.steg.length - 1].rel === NOTIS_MIG, 'kedjan innehåller notismigrationen 20261128000010 sist (efter T4-A)');
  ok(r.rapport.oforklarade === 0, `schemajämförelse: 0 oförklarade (notisdelens objekt förklarade via t4-andringar.json): ${r.rapport.identiska} identiska, ${r.rapport.forklarade} förklarade`);
  laddaVarld(db, U);
  psql(db, `create table public._t4n_bas as select * from public.store; create table public._t4n_idem as select * from public.op_idempotency;`);
  const aterstall = () => psql(db, `begin; delete from public.store; insert into public.store select * from public._t4n_bas; delete from public.op_idempotency; insert into public.op_idempotency select * from public._t4n_idem; commit;`);
  const ef = await laddaEf(db, EF, { root: rotT4a });

  const rf = byggReplik({ rot: rotFore, schemakontroll: false });
  const Uf = rf.U;
  laddaVarld(rf.db, Uf);
  ok(!rf.steg.some((s) => /_t4a_notiser/.test(s.rel)) && rf.steg.some((s) => /_t4a_skyddade_falt/.test(s.rel)), 'jämförelsekedjan (före) = STAGING + T3-B–T3-E + T4-A, utan notisdelen');
  const efFore = await laddaEf(rf.db, ['store-key-write'], { root: rotFore });
  psql(rf.db, `create table public._t4n_bas as select * from public.store;`);
  const aterstallFore = () => psql(rf.db, `begin; delete from public.store; insert into public.store select * from public._t4n_bas; commit;`);

  const SK = (e, user, body) => e.anropa('store-key-write', { user, body });
  const lasAlla = (e, user, keys) => SK(e, user, { action: 'readAllWithHashes', keys });
  const app = (user, notification, requestId) => SK(ef, user, { action: 'appendNotification', requestId: requestId || ('req-' + Math.random().toString(36).slice(2)), notification });
  const markera = (user, b) => SK(ef, user, Object.assign({ action: 'markNotificationsRead' }, b));
  const KS_N = { keys: ['vift_notifications', 'vift_workOrders', 'vift_staff', 'vift_activityLog'], tables: ['op_idempotency'] };
  const NEJ = async (namn, anrop, forvantat, ks) => { const x = await expectReject(db, anrop, forvantat, ks || KS_N); ok(x.ok, namn, x.fel.concat([JSON.stringify(x.svar && x.svar.body).slice(0, 300)])); return x; };
  const F = U.falt.staffId, F2 = U.falt2.staffId, C = U.chef.staffId, A = U.admin.staffId;
  const notiser = (dbx) => val(dbx || db, 'vift_notifications');

  // ════════════════ BASLINJE (oförändrad kod, T4-A): bristerna bevisas på samma data ════════════════
  let s = await lasAlla(efFore, Uf.falt, ['vift_notifications']);
  ok(s.status === 200 && idn(s.body.data.notifications).includes('N-F2-1') && /Kalle Kund/.test(JSON.stringify(s.body.data.notifications)),
    'BASLINJE (punkt 7, läsning): fältet får ANDRAS notiser via readAllWithHashes (FÄ2:s tilldelning med kunduppgifter, chefens offertnotis)', idn(s.body.data.notifications));
  let rr = restLasNotiser(rf.db, Uf.begransad);
  ok(rr.ok && rr.rows.length === 1 && rr.rows[0].value.length === 7, 'BASLINJE (punkt 7, REST): begränsad läser hela vift_notifications direkt via REST (alla mottagares notiser, även poster utan mottagare)');
  {
    const lista = rr.rows[0].value.concat([{ id: 'N-FALSK-1', userId: Uf.falt2.staffId, type: 'offer_approved', message: 'Logga in på http://example.invalid för att godkänna', aoId: '', offerId: 'OFF-R1', read: false, createdAt: '2020-01-01T00:00:00.000Z', createdBy: Uf.chef.staffId }]);
    const w = asUser(rf.db, Uf.falt, restUpsert([['vift_notifications', lista], ['vift_lastChanged', 'x']]));
    const efter = notiser(rf.db);
    ok(w.ok && efter.some((x) => x.id === 'N-FALSK-1' && x.createdBy === Uf.chef.staffId && x.createdAt === '2020-01-01T00:00:00.000Z'),
      'BASLINJE (punkt 7, skrivning): fältet (utan ao_edit) skapar via REST en notis ÅT FÄ2 med valfri typ (offer_approved), text, påhittad avsändare och tid — ingen kontroll av aktör, mottagare eller referens', w);
    const w2 = asUser(rf.db, Uf.begransad, restUpsert([['vift_lastChanged', 'x']]));
    ok(w2.ok, 'BASLINJE (punkt 275): vift_lastChanged står kvar på REST-vitlistan (T3-C:s övergångsväg)', w2);
    aterstallFore();
  }

  // ════════════════ Läsning: projektion per mottagare (E och R) ════════════════
  const ALLA = ['admin', 'chef', 'ekonomi', 'falt', 'falt2', 'begransad', 'personalansvarig', 'adminhanterare', 'chef_utan_faktura', 'saljare', 'tom', 'egen_red'];
  {
    const fel = []; const levererat = new Set();
    for (const a of ALLA) {
      const x = await lasAlla(ef, U[a], ['vift_notifications']);
      const l = (x.body && x.body.data && x.body.data.notifications) || [];
      l.forEach((e) => levererat.add(e.id));
      if (x.status !== 200 || l.some((e) => e.userId !== U[a].staffId)) fel.push(a);
      // Utan giltig behörighet (tom lista) inga verksamhetsdata, inte heller notiser (T4-A punkt 7).
      const egna = a === 'tom' ? [] : notiser().filter((e) => e.userId === U[a].staffId).map((e) => e.id).sort();
      if (JSON.stringify(idn(l)) !== JSON.stringify(egna)) fel.push(a + ':' + idn(l).join(','));
    }
    ok(fel.length === 0, `projektion per mottagare (E, readAllWithHashes): för ${ALLA.length} användare (alla standard- och egna roller, även superadmin 'all') levereras exakt de egna notiserna — inga andras (tom behörighetslista: inga)`, fel);
    ok(!levererat.has('N-OLD-1') && !levererat.has('N-NUM-1'), 'äldre poster utan mottagarfält (eller med numeriskt userId) lämnas inte ut till någon (restriktivt; ingen datamigrering)');
    { const kanon = (o) => JSON.stringify(Object.keys(o || {}).sort().map((k) => [k, o[k]]));
      ok(kanon(notiser().find((e) => e.id === 'N-OLD-1')) === kanon({ id: 'N-OLD-1', type: 'info', message: 'Äldre notis utan mottagarfält', read: false, createdAt: T0 }), 'historiska poster skrivs inte om (N-OLD-1 orörd i lagret)'); }
    const rfel = ALLA.filter((a) => { const x = restLasNotiser(db, U[a]); return !x.ok || x.rows.length !== 0; });
    ok(rfel.length === 0, 'REST-läsning (R): vift_notifications ger 0 rader för alla, även superadmin (vift_store_full_access är falskt för nyckeln)', rfel);
    const lc = asUser(db, U.falt, `select value from public.store where key = 'vift_lastChanged'`);
    ok(lc.ok && lc.rows.length === 1, 'REST-läsning av vift_lastChanged (klientens pollsignal) fungerar oförändrat');
    s = await SK(ef, U.falt, { action: 'readWithHash', key: 'vift_notifications' });
    ok(s.status === 400 && s.body.error === 'key_not_allowlisted', 'readWithHash av vift_notifications nekas som tidigare (400 key_not_allowlisted; ingen ny läsväg)');
  }

  // ════════════════ Skrivning: tilldelningsnotis (positiva fall) ════════════════
  aterstall();
  {
    // N-F-1 finns redan oläst för (F, AO-A1): dubblettskyddet ger samma id och ingen ny post.
    const x = await expectAccept(db, () => app(U.chef, { userId: F, type: 'ao_assigned', aoId: 'AO-A1', message: 'klientens text ignoreras' }, 'req-pos-1'), { status: 200 }, KS_N, ['tabell:op_idempotency']);
    ok(x.ok && x.svar.body.ok === true && x.svar.body.duplicate === true && x.svar.body.id === 'N-F-1' && !('notification' in x.svar.body) && notiser().length === 7,
      'ingen dubblett av oläst tilldelningsnotis (AP-D): chefen → ao_assigned till FÄ för AO-A1 där en oläst redan finns → 200 duplicate med befintligt id; listan orörd (bara idempotensen sparas)', [x.fel, x.svar.body]);
  }
  aterstall();
  psql(db, `update public.store set value = (select jsonb_agg(case when e->>'id' = 'N-F-1' then e || '{"read": true}'::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_notifications'`);
  {
    s = await app(U.chef, { userId: F, type: 'ao_assigned', aoId: 'AO-A1', message: 'phishing http://example.invalid' }, 'req-pos-2');
    const e = notiser().find((y) => y.id === s.body.id);
    ok(s.status === 200 && s.body.duplicate === false && e && e.userId === F && e.createdBy === C && e.source === 'server' && e.read === false && e.offerId === '' && e.aoId === 'AO-A1'
      && e.message === 'Du har tilldelats AO-A1: Testuppdrag AO-A1' && Math.abs(Date.parse(e.createdAt) - Date.now()) < 120000,
      'servern sätter avsändare (createdBy), tid (createdAt = serverns klocka), id, read=false, source; texten byggs ur AO:n (klientens text används inte)', e);
    const fx = (await lasAlla(ef, U.falt, ['vift_notifications'])).body.data.notifications;
    const cx = (await lasAlla(ef, U.chef, ['vift_notifications'])).body.data.notifications;
    ok(idn(fx).includes(s.body.id) && !idn(cx).includes(s.body.id), 'mottagaren läser den nya notisen; avsändaren (chefen) ser den inte');
    // Idempotens bunden till innehållet.
    const fore = ksTa(db, KS_N);
    const s2 = await app(U.chef, { userId: F, type: 'ao_assigned', aoId: 'AO-A1', message: 'phishing http://example.invalid' }, 'req-pos-2');
    ok(s2.status === 200 && s2.body.id === s.body.id && s2.body.replay === true && ksDiff(fore, ksTa(db, KS_N)).length === 0, 'idempotens: samma requestId och samma innehåll → samma svar, ingen ny post, KS oförändrad', s2.body);
    await NEJ('idempotens: samma requestId med ANNAT innehåll (annan mottagare) → 409 idempotency_key_conflict', () => app(U.chef, { userId: 'ST-T20', type: 'ao_assigned', aoId: 'AO-A1' }, 'req-pos-2'), { status: 409, error: 'idempotency_key_conflict', reason: null });
    s = await app(U.admin, { userId: 'ST-T20', type: 'ao_assigned', aoId: 'AO-A1' }, 'req-pos-3');
    ok(s.status === 200 && s.body.duplicate === false, "superadmin ('all') → ao_assigned till tilldelad egen_red: 200");
    s = await app(U.chef, { userId: C, type: 'service_done', message: 'Fönstertvätt markerat som utfört — nästa: 2027-01-01' }, 'req-egen-1');
    ok(s.status === 200 && s.body.notification && s.body.notification.userId === C && s.body.notification.message === 'Fönstertvätt markerat som utfört — nästa: 2027-01-01', 'egen påminnelse (service_done) till sig själv: 200, svaret innehåller den egna notisen (klienten lägger in den direkt)');
    s = await app(U.falt, { userId: F, type: 'service_overdue', message: '⚠️ Hiss — förfallen' }, 'req-egen-2');
    ok(s.status === 200, 'fältet: egen påminnelse till sig själv (runDailyCheck) → 200');
  }

  // ════════════════ Skrivning: nekade fall (exakt status, error, reason, KS oförändrad) ════════════════
  aterstall();
  await NEJ('fält (personal, utan ao_edit) → ao_assigned åt FÄ2 → 403 forbidden/type_not_allowed', () => app(U.falt, { userId: F2, type: 'ao_assigned', aoId: 'AO-A1' }), { status: 403, error: 'forbidden', reason: 'type_not_allowed' });
  await NEJ('begränsad → ao_assigned åt fältet → 403 type_not_allowed', () => app(U.begransad, { userId: F, type: 'ao_assigned', aoId: 'AO-A1' }), { status: 403, error: 'forbidden', reason: 'type_not_allowed' });
  await NEJ("chef → typ 'offer_approved' (bara offer-respond, service_role) → 403 type_not_allowed", () => app(U.chef, { userId: F, type: 'offer_approved', message: 'x' }), { status: 403, error: 'forbidden', reason: 'type_not_allowed' });
  await NEJ("chef → okänd typ 'info' åt fältet → 403 type_not_allowed", () => app(U.chef, { userId: F, type: 'info', message: 'x' }), { status: 403, error: 'forbidden', reason: 'type_not_allowed' });
  await NEJ("superadmin → typ 'ao_pool' → 403 type_not_allowed (inga godtyckliga typer ens för 'all')", () => app(U.admin, { userId: F, type: 'ao_pool', aoId: 'AO-P1' }), { status: 403, error: 'forbidden', reason: 'type_not_allowed' });
  await NEJ('chef → ao_assigned till INAKTIV personal (ST-R13) → 403 recipient_not_allowed', () => app(U.chef, { userId: 'ST-R13', type: 'ao_assigned', aoId: 'AO-A1' }), { status: 403, error: 'forbidden', reason: 'recipient_not_allowed' });
  await NEJ('chef → ao_assigned till okänt personal-id → 403 recipient_not_allowed', () => app(U.chef, { userId: 'ST-FINNS-INTE', type: 'ao_assigned', aoId: 'AO-A1' }), { status: 403, error: 'forbidden', reason: 'recipient_not_allowed' });
  await NEJ('fält → egen påminnelse (service_done) ÅT FÄ2 → 403 recipient_not_allowed', () => app(U.falt, { userId: F2, type: 'service_done', message: 'x' }), { status: 403, error: 'forbidden', reason: 'recipient_not_allowed' });
  await NEJ('superadmin → egen påminnelse åt annan → 403 recipient_not_allowed', () => app(U.admin, { userId: F, type: 'service_overdue', message: 'x' }), { status: 403, error: 'forbidden', reason: 'recipient_not_allowed' });
  await NEJ('chef → ao_assigned åt FÄ2 för AO-A1 där FÄ2 INTE är tilldelad → 403 recipient_not_assigned (ingen falsk tilldelningsnotis, AP-D)', () => app(U.chef, { userId: F2, type: 'ao_assigned', aoId: 'AO-A1' }), { status: 403, error: 'forbidden', reason: 'recipient_not_assigned' });
  await NEJ('egen_red (ao_edit, bara egna AO) → ao_assigned åt FÄ2 för AO-A8 som avsändaren inte ser → 403 ref_not_visible', () => app(U.egen_red, { userId: F2, type: 'ao_assigned', aoId: 'AO-A8' }), { status: 403, error: 'forbidden', reason: 'ref_not_visible' });
  await NEJ('chef (ao_view_all) → ao_assigned för AO som inte finns → 403 ref_not_visible', () => app(U.chef, { userId: F, type: 'ao_assigned', aoId: 'AO-FINNS-INTE' }), { status: 403, error: 'forbidden', reason: 'ref_not_visible' });
  await NEJ('fält → egen påminnelse med AO-referens som fältet inte ser (AO-A8) → 403 ref_not_visible', () => app(U.falt, { userId: F, type: 'service_done', aoId: 'AO-A8', message: 'x' }), { status: 403, error: 'forbidden', reason: 'ref_not_visible' });
  await NEJ('tom behörighetslista → 403 forbidden (ingen giltig behörighet)', () => app(U.tom, { userId: U.tom.staffId, type: 'service_done', message: 'x' }), { status: 403, error: 'forbidden', reason: null });
  await NEJ('okänd roll → 403 forbidden', () => app(U.okandroll, { userId: U.okandroll.staffId, type: 'service_done', message: 'x' }), { status: 403, error: 'forbidden', reason: null });
  await NEJ('avstängd användare (app_users.active=false) → 403 Forbidden (checkViftAuth, oförändrad felkod)', () => app(U.avstangd, { userId: U.avstangd.staffId, type: 'service_done', message: 'x' }), { status: 403, error: 'Forbidden', reason: null });
  await NEJ('ogiltig indata: text över 500 tecken → 400 invalid_entry', () => app(U.chef, { userId: C, type: 'service_done', message: 'x'.repeat(501) }), { status: 400, error: 'invalid_entry', reason: null });
  await NEJ('ogiltig indata: tom text i egen påminnelse → 400 invalid_entry', () => app(U.chef, { userId: C, type: 'service_done', message: '   ' }), { status: 400, error: 'invalid_entry', reason: null });
  await NEJ('ogiltig indata: requestId saknas → 400 invalid_entry', () => SK(ef, U.chef, { action: 'appendNotification', notification: { userId: F, type: 'ao_assigned', aoId: 'AO-A1' } }), { status: 400, error: 'invalid_entry', reason: null });
  await NEJ('ogiltig indata: requestId över 100 tecken → 400 invalid_entry', () => app(U.chef, { userId: F, type: 'ao_assigned', aoId: 'AO-A1' }, 'r'.repeat(101)), { status: 400, error: 'invalid_entry', reason: null });
  await NEJ('ogiltig indata: userId som tal → 400 invalid_entry', () => app(U.chef, { userId: 4, type: 'ao_assigned', aoId: 'AO-A1' }), { status: 400, error: 'invalid_entry', reason: null });
  await NEJ('ao_assigned utan aoId → 400 invalid_entry', () => app(U.chef, { userId: F, type: 'ao_assigned' }), { status: 400, error: 'invalid_entry', reason: null });
  {
    s = await app(U.chef, { userId: F, type: 'ao_assigned', aoId: 'AO-A1', createdBy: A, createdAt: '2020-01-01T00:00:00.000Z', read: true, offerId: 'OFF-R1', id: 'N-EGET-ID', source: 'klient' }, 'req-falt');
    const e = notiser().find((y) => y.id === s.body.id) || notiser().find((y) => y.id === 'N-F-1');
    ok(s.status === 200 && !notiser().some((y) => y.id === 'N-EGET-ID' || y.createdBy === A || y.createdAt === '2020-01-01T00:00:00.000Z'), 'klientens id, avsändare, tid, läsläge, offerId och source ignoreras (servern sätter dem)', e);
    aterstall();
  }

  // ════════════════ Markering: bara egna ════════════════
  aterstall();
  {
    const x = await expectAccept(db, () => markera(U.falt, { ids: ['N-F-1'] }), { status: 200 }, KS_N, ['store:vift_notifications']);
    const e = notiser().find((y) => y.id === 'N-F-1');
    ok(x.ok && x.svar.body.marked === 1 && x.svar.body.ignored === 0 && e.read === true && typeof e.readAt === 'string', 'egen markering: fältet markerar sin notis läst → 200 marked 1', x.svar.body);
    const ks = ksTa(db, KS_N);
    s = await markera(U.falt, { ids: ['N-F2-1', 'N-C-1', 'N-OLD-1', 'N-FINNS-INTE'] });
    ok(s.status === 200 && s.body.marked === 0 && s.body.ignored === 4 && ksDiff(ks, ksTa(db, KS_N)).length === 0 && notiser().find((y) => y.id === 'N-F2-1').read === false,
      'andras notiser (FÄ2, chefen), poster utan mottagare och okända id: 200 marked 0, ignored 4 (andras och okända räknas lika — inget orakel), KS oförändrad', s.body);
    s = await markera(U.admin, { ids: ['N-F2-1'] });
    ok(s.status === 200 && s.body.marked === 0 && notiser().find((y) => y.id === 'N-F2-1').read === false, "superadmin ('all') kan inte markera andras notiser");
    const ks2 = ksTa(db, KS_N);
    s = await markera(U.falt2, { all: true });
    const l = notiser();
    ok(s.status === 200 && s.body.marked === 1 && l.find((y) => y.id === 'N-F2-1').read === true && l.find((y) => y.id === 'N-C-1').read === false && l.find((y) => y.id === 'N-OLD-1').read === false
      && ksDiff(ks2, ksTa(db, KS_N)).every((k) => ['store:vift_notifications', 'store:vift_lastChanged'].includes(k)), 'markera alla: bara FÄ2:s egna markeras (chefens och äldre poster orörda)', s.body);
    await NEJ('markering: ingen lista och inte all → 400 invalid_entry', () => markera(U.falt, {}), { status: 400, error: 'invalid_entry', reason: null });
    await NEJ('markering: fler än 500 id → 400 invalid_entry', () => markera(U.falt, { ids: Array.from({ length: 501 }, (_, i) => 'N-' + i) }), { status: 400, error: 'invalid_entry', reason: null });
    await NEJ('markering: tom behörighetslista → 403 forbidden', () => markera(U.tom, { all: true }), { status: 403, error: 'forbidden', reason: null });
    const ks3 = ksTa(db, KS_N);
    s = await markera(U.falt, { all: true });
    ok(s.status === 200 && s.body.marked === 0 && ksDiff(ks3, ksTa(db, KS_N)).length === 0, 'inget att markera → ingen skrivning (KS och vift_lastChanged oförändrade)');
  }

  // ════════════════ REST-vitlistan avvecklad (punkt 275) ════════════════
  aterstall();
  {
    const KS_R = { keys: ['vift_notifications', 'vift_lastChanged', 'vift_customers'] };
    const rest = async (namn, user, sql) => { const fore = ksTa(db, KS_R); const x = asUser(db, user, sql); const d = ksDiff(fore, ksTa(db, KS_R));
      ok(!x.ok && x.status === 403 && x.code === '42501' && /direct_write_blocked|row-level security/.test(x.message) && d.length === 0, namn, [x, d]); };
    await rest('REST: v3.4/T3/T4-A-klientens upsert [vift_notifications, vift_lastChanged] → 403 42501 direct_write_blocked, KS oförändrad', U.falt, restUpsert([['vift_notifications', [{ id: 'N-X', userId: F2, type: 'info', message: 'x', read: false, createdAt: T0 }]], ['vift_lastChanged', 'x']]));
    await rest('REST: superadmin skriver vift_notifications direkt → 403 42501', U.admin, restUpsert([['vift_notifications', []]]));
    await rest('REST: vift_lastChanged ensam (övergångsvägen, punkt 275) → 403 42501', U.begransad, restUpsert([['vift_lastChanged', 'x']]));
    { const fore = ksTa(db, KS_R); const x = asUser(db, U.falt, `update public.store set value = '[]'::jsonb where key = 'vift_notifications'`);
      ok(x.ok && x.count === 0 && ksDiff(fore, ksTa(db, KS_R)).length === 0, 'REST: UPDATE av vift_notifications (markera läst/töm direkt) → 0 rader (raden är dold för REST-läsning, som T3-C:s dolda nycklar), KS oförändrad', x); }
    await rest('REST: DELETE av vift_lastChanged → 403 42501 (som T3-C)', U.falt, `delete from public.store where key = 'vift_lastChanged'`);
    await rest('REST: okänd nyckel → 403 42501 (som T3-C, SEC-REST-02)', U.begransad, restUpsert([['vift_okand', {}]]));
    const pol = q(db, `select policyname, with_check from pg_policies where tablename = 'store' and policyname like 'store_direct_write_allowlist_%' order by 1`);
    ok(pol.length === 2 && pol.every((p) => p.with_check === 'false'), 'vitlistepolicyerna har WITH CHECK (false): vitlistan är tom', pol);
  }

  // ════════════════ Gammal klient (v3.4, T3, T4-A i Service Worker-cache) mot ny server ════════════════
  aterstall();
  {
    // persistNotifs: REST-läsning ger inga rader (found:false) → klienten skriver sin lokala lista som startvärde → nekas.
    const l0 = restLasNotiser(db, U.chef);
    ok(l0.ok && l0.rows.length === 0, 'gammal klient: persistNotifs REST-läsning → 0 rader (found:false); den kan inte läsa andras notiser');
    const fore = ksTa(db, KS_N);
    const w = asUser(db, U.chef, restUpsert([['vift_notifications', [{ id: 'N-GAMMAL', userId: F, type: 'ao_assigned', message: 'Du har tilldelats AO-A1', aoId: 'AO-A1', read: false, createdAt: T0 }]], ['vift_lastChanged', 'x']]));
    ok(!w.ok && w.status === 403 && ksDiff(fore, ksTa(db, KS_N)).length === 0 && notiser().length === 7, 'gammal klient: notisskrivningen (hela listan + lastChanged) nekas 403 — inga notiser åt andra, och INGEN dataförlust (listan med 7 poster orörd, inte ersatt av klientens lokala lista)', w);
    const e = await lasAlla(ef, U.chef, ['vift_notifications', 'vift_workOrders']);
    ok(idn(e.body.data.notifications).join() === 'N-C-1', 'gammal klient: readAllWithHashes (samma EF-väg i v3.4) ger bara egna notiser');
    // Övriga flöden fungerar efter det nekade notisanropet (tilldelning, uppgifter, aktivitetslogg).
    const aw = await ef.anropa('ao-time-write', { user: U.chef, body: { action: 'patch_ao', aoId: 'AO-A8', idempotencyKey: 'gammal-1', patch: { staff: [F2, F] } } });
    ok(aw.status === 200 && val(db, 'vift_workOrders').find((a) => a.id === 'AO-A8').staff.includes(F), 'gammal klient: tilldelningen (patch_ao) fungerar oberoende av den nekade notisen');
    const t = (await SK(ef, U.chef, { action: 'readWithHash', key: 'vift_activities' })).body.value.find((x) => x.id === 'TASK-R3');
    s = await SK(ef, U.chef, { action: 'writeMerge', key: 'vift_activities', upserts: [{ id: 'TASK-R3', data: Object.assign({}, t, { status: 'done' }), previous: t }], removals: [] });
    ok(s.status === 200, 'gammal klient: uppgifter (writeMerge vift_activities) fungerar');
    s = await SK(ef, U.chef, { action: 'appendActivity', entry: { id: 'ACT-GAMMAL-0001', type: 'staff_assigned', text: 'Personal tilldelad', workOrderId: 'AO-A8' } });
    ok(s.status === 200, 'gammal klient: aktivitetsloggen (appendActivity) fungerar');
    s = await SK(ef, U.chef, { action: 'appendNotification', requestId: 'efter-gammal', notification: { userId: F, type: 'ao_assigned', aoId: 'AO-A8' } });
    ok(s.status === 200, 'ny klient (efter omladdning): tilldelningsnotisen för AO-A8 skapas via EF-vägen när mottagaren faktiskt är tilldelad');
    aterstall();
  }

  // ════════════════ Installationsfönstret: T4-A:s store-key-write mot den nya databasen ════════════════
  {
    const efGammal = await laddaEf(db, ['store-key-write'], { root: rotFore });
    const x = await lasAlla(efGammal, U.falt, ['vift_notifications']);
    ok(x.status === 200 && idn(x.body.data.notifications).join() === 'N-F-1', 'fönstret (databas före EF): T4-A:s store-key-write ger redan projicerade notiser (regeln ligger i RPC:n)');
    await NEJ('fönstret: T4-A:s store-key-write känner inte appendNotification → 400 unknown_action (ingen skrivning)', () => SK(efGammal, U.chef, { action: 'appendNotification', requestId: 'f', notification: { userId: F, type: 'ao_assigned', aoId: 'AO-A1' } }), { status: 400, error: 'unknown_action', reason: null });
  }

  // ════════════════ Storleksgräns ════════════════
  aterstall();
  {
    const mang = Array.from({ length: 5000 }, (_, i) => ({ id: 'N-MASS-' + i, userId: F, type: 'service_done', message: 'm' + i, read: true, createdAt: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 1000).toISOString() }));
    psql(db, `update public.store set value = ${jlit(mang)} where key = 'vift_notifications'`);
    s = await app(U.chef, { userId: C, type: 'service_done', message: 'ny' }, 'req-mass');
    const l = notiser();
    ok(s.status === 200 && l.length === 5000 && l[0].id === s.body.id && !l.some((e) => e.id === 'N-MASS-0') && l.some((e) => e.id === 'N-MASS-1'), 'storleksgräns 5000: den nya posten läggs först och den ÄLDSTA tas bort (aldrig den nya)', [l.length, l[0] && l[0].id]);
    aterstall();
  }

  // ════════════════ Samtidighet (egna anslutningar, barriär; radlåset avgör) ════════════════
  aterstall();
  psql(db, `update public.store set value = (select jsonb_agg(case when e->>'id' = 'N-F-1' then e || '{"read": true}'::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_notifications'`);
  psql(db, `drop table if exists public._t4n_bas2; create table public._t4n_bas2 as select * from public.store;`);
  const aterstall2 = () => psql(db, `begin; delete from public.store; insert into public.store select * from public._t4n_bas2; delete from public.op_idempotency; insert into public.op_idempotency select * from public._t4n_idem; commit;`);
  {
    // 1. ×20: samma requestId och innehåll, två samtidiga anrop per upprepning → exakt en skapar posten.
    const fel = [];
    for (let i = 0; i < 20; i++) {
      aterstall2();
      ef.barriar('notification_append', 2);
      const svar = await parallellt(2, () => app(U.chef, { userId: F, type: 'ao_assigned', aoId: 'AO-A1' }, 'req-par-' + i));
      const nya = notiser().filter((e) => e.createdBy === C);
      const skapade = svar.filter((x) => x.status === 200 && x.body.duplicate === false && !x.body.replay).length;
      if (!(svar.every((x) => x.status === 200) && skapade === 1 && nya.length === 1 && svar[0].body.id === svar[1].body.id)) fel.push([i, svar.map((x) => [x.status, x.body]), nya.length]);
    }
    ok(fel.length === 0, 'samtidighet ×20 (idempotens): samma requestId i två samtidiga anrop — exakt en skapar posten, den andra får samma svar', fel.slice(0, 2));
    // 2. ×20: samma (mottagare, AO) men olika requestId → exakt en ny oläst post (dubblettskyddet under låset).
    const fel2 = [];
    for (let i = 0; i < 20; i++) {
      aterstall2();
      ef.barriar('notification_append', 2);
      const svar = await parallellt(2, (k) => app(k ? U.admin : U.chef, { userId: F, type: 'ao_assigned', aoId: 'AO-A1' }, 'req-dup-' + i + '-' + k));
      const nya = notiser().filter((e) => e.userId === F && e.aoId === 'AO-A1' && !e.read);
      if (!(svar.every((x) => x.status === 200) && svar.filter((x) => x.body.duplicate === false).length === 1 && nya.length === 1)) fel2.push([i, svar.map((x) => x.body)]);
    }
    ok(fel2.length === 0, 'samtidighet ×20 (dubblettskydd): två avsändare samtidigt för samma mottagare och AO — exakt en ny oläst notis', fel2.slice(0, 2));
    // 3. 20 samtidiga anslutningar med olika notiser → inga förlorade uppdateringar.
    aterstall2();
    ef.barriar('notification_append', 20);
    const svar = await parallellt(20, (i) => app(U.chef, { userId: C, type: 'service_done', message: 'parallell ' + i }, 'req-20-' + i));
    const l = notiser();
    ok(svar.every((x) => x.status === 200 && x.body.duplicate === false) && Array.from({ length: 20 }, (_, i) => 'parallell ' + i).every((m) => l.some((e) => e.message === m)) && l.length === 27,
      '20 samtidiga anslutningar med olika notiser: alla 20 sparas (inga förlorade uppdateringar), listan = 7 + 20', [svar.map((x) => x.status).join(','), l.length]);
    // 4. ×20: ny notis till FÄ samtidigt som FÄ markerar alla lästa → båda effekterna består.
    const fel4 = [];
    for (let i = 0; i < 20; i++) {
      aterstall2();
      psql(db, `update public.store set value = (select jsonb_agg(case when e->>'id' = 'N-F-1' then e || '{"read": false}'::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_notifications'`);
      // AO-A2 (FÄ tilldelad) har ingen oläst tilldelningsnotis: den nya posten skapas alltid.
      const [b1, m2] = await Promise.all([app(U.chef, { userId: F, type: 'ao_assigned', aoId: 'AO-A2' }, 'req-mix2-' + i), markera(U.falt, { all: true })]);
      const l3 = notiser();
      const ny = l3.find((e) => e.id === b1.body.id);
      if (b1.status !== 200 || b1.body.duplicate !== false || m2.status !== 200 || !ny || l3.find((e) => e.id === 'N-F-1').read !== true || l3.length !== 8) fel4.push([i, b1.status, b1.body, m2.body, !!ny]);
    }
    ok(fel4.length === 0, 'samtidighet ×20: ny notis till FÄ samtidigt som FÄ markerar alla lästa — den nya posten tappas aldrig och den gamla förblir läst (radlåset serialiserar)', fel4.slice(0, 2));
    // 5. Låsordning: tilldelning (work_order_patch, vift_workOrders FOR UPDATE), notis (FOR SHARE → notiser) och
    //    aktivitetslogg (FOR SHARE → logg) samtidigt, 10 upprepningar — inga deadlocks, alla klara.
    const fel5 = [];
    for (let i = 0; i < 10; i++) {
      aterstall2();
      const res = await Promise.all([
        ef.anropa('ao-time-write', { user: U.chef, body: { action: 'patch_ao', aoId: 'AO-A8', idempotencyKey: 'lock-' + i, patch: { staff: [F2, F] } } }),
        app(U.chef, { userId: F2, type: 'ao_assigned', aoId: 'AO-A8' }, 'lock-n-' + i),
        SK(ef, U.chef, { action: 'appendActivity', entry: { id: 'ACT-LOCK-' + String(i).padStart(4, '0'), type: 'staff_assigned', text: 'x', workOrderId: 'AO-A8' } }),
        markera(U.falt2, { all: true }),
      ]);
      if (res.some((x) => x.status !== 200)) fel5.push([i, res.map((x) => [x.status, x.body && x.body.error])]);
    }
    ok(fel5.length === 0, 'låsordning (AO → notiser → lastChanged): tilldelning, notis, aktivitetslogg och markering samtidigt ×10 — alla 200, inga deadlocks eller serverfel', fel5.slice(0, 2));
    aterstall();
  }

  // ════════════════ Ingen breddning: effektiv åtkomst före (T4-A) och efter per roll ════════════════
  aterstall(); aterstallFore();
  const ALLA_NYCKLAR = ['vift_activities', 'vift_activityLog', 'vift_offers', 'vift_customers', 'vift_properties', 'vift_propertyObjects', 'vift_propertyContacts', 'vift_staff', 'vift_roles',
    'vift_invoices', 'vift_settings', 'vift_recurringOrders', 'vift_salesOpps', 'vift_contracts', 'vift_articles', 'vift_offerEvents', 'vift_offerAttachments', 'vift_notifications',
    'vift_inspections', 'vift_ronderingar', 'vift_avvikelser', 'vift_projects', 'vift_priceGroups', 'vift_settings'];
  const REST_NYCKLAR = ['vift_notifications', 'vift_lastChanged', 'vift_customers', 'vift_settings', 'vift_offers', 'vift_staff', 'vift_activityLog'];
  const jamforRoll = async (namn, user, userF) => {
    const fel = [];
    const fo = await lasAlla(efFore, userF, ALLA_NYCKLAR), ny = await lasAlla(ef, user, ALLA_NYCKLAR);
    const a = (fo.body || {}).data || {}, b = (ny.body || {}).data || {};
    for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) {
      if (k === 'lastChanged') continue;
      if (k === 'notifications') {
        const fore = (a[k] || []), efter = (b[k] || []);
        if (!efter.every((e) => fore.some((f) => JSON.stringify(f) === JSON.stringify(e))) || efter.some((e) => e.userId !== user.staffId)) fel.push(namn + ':notifications');
      } else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) fel.push(namn + ':' + k);
    }
    for (const k of REST_NYCKLAR) {
      const rf2 = asUser(rf.db, userF, `select key, value from public.store where key = ${lit(k)}`), rn = asUser(db, user, `select key, value from public.store where key = ${lit(k)}`);
      if (k === 'vift_notifications') { if (!rn.ok || rn.rows.length !== 0) fel.push(namn + ':REST:' + k); }
      else if (k === 'vift_lastChanged') { if (rf2.rows.length !== rn.rows.length) fel.push(namn + ':REST:' + k); } // värdet är en tidsstämpel som skiljer mellan replikerna
      else if (JSON.stringify(rf2.rows) !== JSON.stringify(rn.rows)) fel.push(namn + ':REST:' + k);
    }
    // Skrivning: före godtog REST-vägen en notis åt annan; efter nekas den (och EF-vägen kräver ao_edit + tilldelning).
    const wf = asUser(rf.db, userF, restUpsert([['vift_notifications', notiser(rf.db).concat([{ id: 'N-PROBE', userId: F2, type: 'info', message: 'p', read: false, createdAt: T0 }])]]));
    const wn = asUser(db, user, restUpsert([['vift_notifications', []]]));
    aterstallFore();
    return { fel, skrivFore: wf.ok ? 201 : wf.status, skrivEfter: wn.ok ? 201 : wn.status };
  };
  {
    const fel = []; const tabell = {};
    for (const a of ALLA) {
      const x = await jamforRoll(a, U[a], Uf[a] || U[a]);
      fel.push(...x.fel); tabell[a] = x.skrivFore + '→' + x.skrivEfter;
      if (x.skrivEfter !== 403) fel.push(a + ':REST-skrivning efter');
    }
    console.log('T4N-SKRIV-REST (före→efter) ' + JSON.stringify(tabell));
    ok(fel.length === 0, `ingen breddning (standard- och egna roller, ${ALLA.length} användare): alla nycklar utom notiserna är IDENTISKA före/efter (EF och REST); notiserna är en delmängd = de egna; REST-skrivningen nekas för alla`, fel);
    // STAGING:s sju roller (läsande underlag, ingen ändring i STAGING): provkontot 'tom' byter roll i båda replikerna.
    const sattRoll = (dbx, rid) => {
      const rr2 = val(dbx, 'vift_roles').filter((x) => !STAGING_ROLLER.some((y) => y.id === x.id) || x.id === 'admin').concat(STAGING_ROLLER.filter((y) => y.id !== 'admin'));
      psql(dbx, `update public.store set value = ${jlit(rr2)} where key = 'vift_roles'; update public.store set value = (select jsonb_agg(case when e->>'id' = 'ST-R11' then e || ${jlit({ role: rid })}::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_staff';`);
    };
    const fel2 = []; const tab2 = {};
    for (const roll of STAGING_ROLLER.filter((x) => x.id !== 'admin')) {
      sattRoll(db, roll.id); sattRoll(rf.db, roll.id); psql(rf.db, `drop table public._t4n_bas; create table public._t4n_bas as select * from public.store;`);
      const x = await jamforRoll(roll.id, U.tom, Uf.tom);
      fel2.push(...x.fel); tab2[roll.id] = x.skrivFore + '→' + x.skrivEfter;
      const egna = ((await lasAlla(ef, U.tom, ['vift_notifications'])).body.data.notifications || []);
      if (idn(egna).join() !== 'N-T-1') fel2.push(roll.id + ':egna');
    }
    console.log('T4N-STAGINGROLLER (REST-skrivning före→efter) ' + JSON.stringify(tab2));
    ok(fel2.length === 0, 'införandeanalys per STAGING-roll (6 roller utöver admin, läsande): allt utom notiserna identiskt före/efter; varje roll får exakt sina egna notiser; REST-skrivningen av notiser nekas', fel2);
    aterstall();
  }

  // ════════════════ Affärsflöden (regression i berörda vägar) ════════════════
  aterstall();
  {
    // Tilldelning via AO-detaljens personaldialog: patch_ao (staff) → serverbekräftelse → notis.
    let x = await ef.anropa('ao-time-write', { user: U.chef, body: { action: 'patch_ao', aoId: 'AO-A1', idempotencyKey: 'flode-1', patch: { staff: [F, 'ST-T20', F2] } } });
    s = await app(U.chef, { userId: F2, type: 'ao_assigned', aoId: 'AO-A1' }, 'flode-n-1');
    ok(x.status === 200 && s.status === 200 && (await lasAlla(ef, U.falt2, ['vift_notifications'])).body.data.notifications.some((e) => e.id === s.body.id), 'tilldelning → notis: FÄ2 tilldelas AO-A1 och får tilldelningsnotisen');
    // Ny AO från offert med personal.
    x = await ef.anropa('ao-time-write', { user: U.chef, body: { action: 'create_ao', ao: { id: 'AO-T4N-1', title: 'Från offert', status: 'planerad', staff: [F], offerId: 'OFF-R1' }, idempotencyKey: 'flode-2' } });
    s = await app(U.chef, { userId: F, type: 'ao_assigned', aoId: 'AO-T4N-1' }, 'flode-n-2');
    ok(x.status === 200 && s.status === 200 && notiser().find((e) => e.id === s.body.id).message === 'Du har tilldelats AO-T4N-1: Från offert', 'offert → AO med personal → tilldelningsnotis med serverns text');
    // Uppgifter och aktivitetslogg opåverkade.
    const t = (await SK(ef, U.falt, { action: 'readWithHash', key: 'vift_activities' })).body.value.find((y) => y.id === 'TASK-R1');
    s = await SK(ef, U.falt, { action: 'writeMerge', key: 'vift_activities', upserts: [{ id: 'TASK-R1', data: Object.assign({}, t, { status: 'done' }), previous: t }], removals: [] });
    ok(s.status === 200, 'uppgifter: fältet klarmarkerar sin uppgift (writeMerge) → 200');
    s = await ef.anropa('work-orders-list', { user: U.falt });
    ok(s.status === 200 && (s.body.workOrders || []).some((a) => a.id === 'AO-A1'), 'AO-listan oförändrad tillgänglig');
    aterstall();
  }

  // ════════════════ Grants ════════════════
  {
    const g = q(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and p.proname in ('notification_append', 'notifications_mark_read', '_vift_notis_kategori', '_vift_notis_projicera', 'vift_store_project', '_store_direct_write_guard')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
    ok(g.length === 0, 'SEC-REST-03: notisdelens funktioner körbara bara för service_role', g);
    const x = asUser(db, U.chef, `select public.notification_append('${C}', '{"userId":"${F}","type":"ao_assigned","aoId":"AO-A1"}'::jsonb, 'rest', 5000)`);
    ok(!x.ok && x.code === '42501', 'SEC-REST-03 (R): authenticated får inte anropa notification_append direkt (42501)', x);
    const y = rpc(db, 'notification_append', { p_caller_staff_id: '', p_entry: { userId: F, type: 'ao_assigned', aoId: 'AO-A1' }, p_request_id: 'x' });
    ok(y.error && /forbidden/.test(y.error.message), 'RPC utan anroparens identitet → forbidden');
  }

  // ════════════════ Rollback (installera → rollback → installera) och STOP ════════════════
  {
    const rb = byggReplik({ utelamna: franOchMed(T4B_MIG), schemakontroll: false });
    laddaVarld(rb.db, rb.U);
    const KS = { keys: ['vift_notifications', 'vift_customers', 'vift_settings', 'vift_roles', 'vift_staff', 'vift_workOrders'], tables: ['app_users', 'op_idempotency'] };
    const efRb = await laddaEf(rb.db, ['store-key-write']);
    let x = await SK(efRb, rb.U.chef, { action: 'appendNotification', requestId: 'rb-1', notification: { userId: rb.U.falt.staffId, type: 'ao_assigned', aoId: 'AO-A1' } });
    await SK(efRb, rb.U.falt2, { action: 'markNotificationsRead', all: true });
    ok(x.status === 200, 'notisdelens kod skapar data (ny notis, markering)');
    const fore = ksTa(rb.db, KS);
    const jamfor = (env) => { try { return execFileSync('node', [path.join(__dirname, 'local', 'jamfor-schema.js'), rb.db], { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) }); } catch (e) { return String(e.stdout || ''); } };
    const ofo = (t) => Number((/(\d+) oförklarade/.exec(t) || [])[1]);
    psqlFile(rb.db, path.join(serverRot(), 'rollback', 'T4-A-notiser', 'rollback_t4a_notiser.sql'));
    let ut = jamfor({ T4_LAGE: 'T4-A' });
    ok(ofo(ut) === 0 && /OBS: T4-ändringar som inte syns.*notification_append/.test(ut), 'rollback notisdelen: schemat = läget efter T4-A (T4_LAGE=T4-A, 0 oförklarade; notisfunktionerna borta)', ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
    ok(ksDiff(fore, ksTa(rb.db, KS)).length === 0, 'rollback notisdelen: INGEN data ändrad (notiser skapade efter installationen ligger kvar)');
    const rl = asUser(rb.db, rb.U.falt, `select value from public.store where key = 'vift_notifications'`);
    const rw = asUser(rb.db, rb.U.falt, restUpsert([['vift_notifications', rl.rows[0].value], ['vift_lastChanged', 'x']]));
    ok(rl.ok && rl.rows.length === 1 && rw.ok, 'efter rollback fungerar T4-A-klientens REST-väg igen (läsning och upsert av notiser + lastChanged)', rw);
    let fel = null;
    try { psqlFile(rb.db, path.join(serverRot(), NOTIS_MIG)); } catch (e) { fel = e.message; }
    ut = jamfor({ T4_LAGE: 'T4-A-notiser' });
    ok(!fel && ofo(ut) === 0 && obsBaraT4b(ut), 'ny installation efter rollback: STOP-kontrollen godtar T4-A-versionerna; schemat = alla registrerade T4-A- och notisändringar (T4-B inte installerad)', fel || ut.split('\n').filter((l) => /OFÖRKLARAD|OBS/.test(l)).slice(0, 5));
    let stop = null;
    try { psqlFile(rb.db, path.join(serverRot(), NOTIS_MIG)); } catch (e) { stop = e.message; }
    ok(stop && /T4-A-notiser STOP: notification_append finns redan/.test(stop), 'STOP-kontroll: en andra körning av 20261128000010 avbryts', stop);
    const fore2 = ksTa(rb.db, KS);
    for (const p of ['T4-A-notiser/rollback_t4a_notiser.sql', 'T4-A/rollback_t4a.sql', 'T3-E/rollback_t3e.sql', 'T3-D/rollback_t3d.sql', 'T3-C/rollback_t3c.sql', 'T3-B/rollback_t3b.sql']) psqlFile(rb.db, path.join(serverRot(), 'rollback', p));
    ut = jamfor({ T3_IGNORERA: '1' });
    ok(ofo(ut) === 0, 'rollback notiser + T4-A + T3-E + T3-D + T3-C + T3-B (omvänd installationsordning): schemat = STAGING-facit', ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
    ok(ksDiff(fore2, ksTa(rb.db, KS)).length === 0, 'rollback hela vägen: ingen data ändrad');
    rb.stang();
    // STOP: notismigrationen på en kedja utan T4-A.
    const rs = byggReplik({ utelamna: franOchMed('migrations/20261128000009_t4a_skyddade_falt.sql'), data: false, schemakontroll: false });
    stop = null;
    try { psqlFile(rs.db, path.join(serverRot(), NOTIS_MIG)); } catch (e) { stop = e.message; }
    ok(stop && /T4-A-notiser STOP: T4-A \(20261128000009\) måste vara installerad först/.test(stop), 'STOP-kontroll: notismigrationen utan T4-A avbryts', stop);
    rs.stang();
  }

  r.stang(); rf.stang();
  avsluta();
})().catch((e) => { console.error(e); process.exit(1); });
