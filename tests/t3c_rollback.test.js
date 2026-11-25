'use strict';
/*
 * T3-C (2026-11-28): installation → rollback → ny installation, lokalt (testplanen T3-C,
 * "Rollback: föregående funktionsdefinitioner och policyer. Data ändras inte av paketet.").
 *
 *  1. Repliken med repokedjan utan T3-D (STAGING + T3-B + T3-C) och syntetiska data, plus data som
 *     T3-C-koden skapar (personal- och rollskrivningar under låset, en inaktiverad användare,
 *     en notis och ett servervärde i vift_lastChanged via REST).
 *  2. supabase/rollback/T3-C/rollback_t3c.sql: schemat blir STAGING + registrerade T3-B-ändringar
 *     (0 oförklarade, T3-C-objekten borta) och INGEN data ändras (kontrollsumma på store och
 *     app_users).
 *  3. Den äldre koden fungerar på data skapad av T3-C (äldre merge_write, äldre projektion med
 *     två argument, STAGING:s REST-regler).
 *  4. Ny installation av de två T3-C-migrationerna (STOP-kontrollerna godtar STAGING-versionen)
 *     → schemat = STAGING + registrerade T3-ändringar; en andra körning stoppas.
 *  5. Rollback i omvänd ordning (T3-D, T3-C, sedan T3-B) ger exakt STAGING-facit.
 * Inget körs mot Supabase.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { ok, krav, avsluta } = require('./local/lib/test');
krav();
const { byggReplik, serverRot } = require('./local/lib/replik');
const { psql, psqlFile, q, val, jlit, rpc, asUser } = require('./local/lib/db');
const { ksTa, ksDiff } = require('./local/lib/kontroll');
const t3cRb = require('./local/t3c-rollback');

const rot = serverRot();
const jamfor = (db, ignorera) => {
  try { return { kod: 0, ut: execFileSync('node', [path.join(__dirname, 'local', 'jamfor-schema.js'), db], { encoding: 'utf8', env: Object.assign({}, process.env, ignorera ? { T3_IGNORERA: '1' } : {}) }) }; }
  catch (e) { return { kod: e.status || 1, ut: String(e.stdout || '') }; }
};
const oforklarade = (r) => Number((/(\d+) oförklarade/.exec(r.ut) || [])[1]);
const t3c = Object.entries(JSON.parse(fs.readFileSync(path.join(__dirname, 'local', 't3-andringar.json'), 'utf8')).objekt).filter(([, v]) => v.paket === 'T3-C' || v.aven === 'T3-C').map(([k]) => k);
// T3-D (2026-11-28) installeras efter T3-C och rullas tillbaka före den (tests/t3d_rollback.test.js).
// Här prövas T3-C för sig: kedjan utan T3-D-migrationerna. Steg 4 installerar T3-D igen ovanpå,
// så att schemat kan jämföras med alla registrerade T3-ändringar (T3-D ändrar två T3-C-objekt).
const T3D = fs.readFileSync(path.join(rot, 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => /^\d{14}$/.test(p[0]) && /_t3d_/.test(p[1] || '')).map((p) => p[1]);

ok(fs.readFileSync(t3cRb.UT, 'utf8') === t3cRb.sql(), 'rollback_t3c.sql är aktuell (genererad ur STAGING-facit av tests/local/t3c-rollback.js)');
const r = byggReplik({ utelamna: T3D, schemakontroll: false });
const db = r.db;
const U = r.U;
try {
  const staff = () => val(db, 'vift_staff');
  const F = U.falt.staffId, A = U.admin.staffId;
  // 1. Data som T3-C-koden skapar.
  const el = staff().find((s) => s.id === F);
  let x = rpc(db, 'store_business_key_merge_write', { p_key: 'vift_staff', p_upserts: [{ id: F, data: Object.assign({}, el, { role: 'tom' }), previous: el }], p_removals: [], p_caller_authorized: true, p_actor_id: A });
  ok(!x.error && staff().find((s) => s.id === F).role === 'tom', 'T3-C-kod skapar data: superadmin byter roll på FÄ under låset', x.error);
  x = rpc(db, 'deactivate_vift_user', { p_user_id: U.falt2.authId });
  ok(!x.error, 'T3-C-kod: deactivate_vift_user under låset', x.error);
  x = asUser(db, U.chef, `insert into public.store(key, value) values ('vift_notifications', ${jlit([{ id: 'N-RB', createdAt: '2026-11-28T08:00:00.000Z', message: 'x', read: false }])}), ('vift_lastChanged', '"1999-01-01T00:00:00.000Z"'::jsonb) on conflict (key) do update set value = excluded.value`);
  ok(x.ok && val(db, 'vift_lastChanged') !== '1999-01-01T00:00:00.000Z', 'T3-C-kod: REST-notis och servervärde i vift_lastChanged', x);
  const KS = { keys: ['vift_staff', 'vift_roles', 'vift_notifications', 'vift_customers', 'vift_workOrders', 'vift_settings'], tables: ['app_users', 'op_idempotency'] };
  const fore = ksTa(db, KS);

  // 2. Rollback T3-C.
  psqlFile(db, path.join(rot, 'rollback', 'T3-C', 'rollback_t3c.sql'));
  const efterRb = jamfor(db, false);
  ok(oforklarade(efterRb) === 0, 'rollback T3-C: schemat = STAGING + registrerade T3-B-ändringar (0 oförklarade)', efterRb.ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
  const obs = (efterRb.ut.split('OBS: T3-ändringar som inte syns')[1] || '').split('\n')[0];
  const kvar = t3c.filter((k) => !obs.includes(k));
  ok(t3c.length === 22 && kvar.length === 0, 'rollback T3-C: alla 22 registrerade T3-C-objekt är borta eller återställda exakt till STAGING-definitionen', kvar.slice(0, 3));
  ok(q(db, `select proname from pg_proc where proname in ('_vift_authz_check','_vift_superadmin_lock','_store_direct_write_guard')`).length === 0, 'rollback T3-C: T3-C:s nya funktioner borttagna');
  ok(q(db, `select 1 from pg_trigger where tgname = 'protect_direct_write_allowlist'`).length === 0 && q(db, `select 1 from pg_policies where policyname like 'store_direct_write_allowlist%'`).length === 0, 'rollback T3-C: F18-triggern och vitlistepolicyerna borttagna');
  ok(ksDiff(fore, ksTa(db, KS)).length === 0, 'rollback T3-C: INGEN data ändrad (store, app_users, op_idempotency) — data skapad efter installationen finns kvar');
  // 3. Äldre kod på T3-C-data.
  const el2 = staff().find((s) => s.id === F);
  x = rpc(db, 'store_business_key_merge_write', { p_key: 'vift_staff', p_upserts: [{ id: F, data: Object.assign({}, el2, { phone: 'efter rollback' }), previous: el2 }], p_removals: [], p_caller_authorized: true, p_actor_id: A });
  ok(!x.error && staff().find((s) => s.id === F).phone === 'efter rollback', 'äldre store_business_key_merge_write fungerar på T3-C-data', x.error);
  x = rpc(db, 'store_read_all_with_hashes_projected', { p_business_keys: ['vift_staff', 'vift_roles'], p_perms: ['dashboard_view'] });
  ok(!x.error && x.data.data.vift_roles.length > 1, 'äldre projektion (2 argument, som föregående store-key-write anropar) finns och fungerar', x.error);
  x = asUser(db, U.chef, `select key from public.store where key = 'vift_roles'`);
  ok(x.ok && x.rows.length === 1, 'STAGING:s REST-läsregel gäller igen (rollregistret läsbart)');

  // 4. Ny installation ovanpå.
  const nya = fs.readFileSync(path.join(rot, 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => /^\d{14}$/.test(p[0]) && /_t3c_/.test(p[1] || '')).map((p) => p[1]);
  let fel = null;
  try { nya.forEach((rel) => psqlFile(db, path.join(rot, rel))); } catch (e) { fel = e.message; }
  ok(!fel && nya.length === 2, 'ny installation efter rollback: de 2 T3-C-migrationerna går igenom (STOP-kontrollerna godtar STAGING-versionen)', fel);
  try { T3D.forEach((rel) => psqlFile(db, path.join(rot, rel))); } catch (e) { fel = e.message; }
  ok(!fel && T3D.length === 2, 'T3-D (installeras efter T3-C) går igenom ovanpå den nya T3-C-installationen', fel);
  const efterNy = jamfor(db, false);
  ok(oforklarade(efterNy) === 0 && !/OBS: T3-ändringar som inte syns/.test(efterNy.ut), 'ny installation: schemat = STAGING + alla registrerade T3-ändringar (0 oförklarade)');
  let stop = null;
  try { psqlFile(db, path.join(rot, nya[0])); } catch (e) { stop = e.message; }
  ok(stop && /T3-C STOP/.test(stop), 'STOP-kontroll: en andra körning av 20261128000004 avbryts', stop);
  stop = null;
  try { psqlFile(db, path.join(rot, nya[1])); } catch (e) { stop = e.message; }
  ok(stop && /T3-C STOP/.test(stop), 'STOP-kontroll: en andra körning av 20261128000005 avbryts', stop);

  // 5. Omvänd ordning: T3-D, T3-C och sedan T3-B → exakt STAGING.
  const fore2 = ksTa(db, KS);
  psqlFile(db, path.join(rot, 'rollback', 'T3-D', 'rollback_t3d.sql'));
  psqlFile(db, path.join(rot, 'rollback', 'T3-C', 'rollback_t3c.sql'));
  psqlFile(db, path.join(rot, 'rollback', 'T3-B', 'rollback_t3b.sql'));
  const staging = jamfor(db, true);
  ok(oforklarade(staging) === 0, 'rollback T3-D + T3-C + T3-B (omvänd installationsordning): schemat = STAGING-facit (0 oförklarade utan T3-ändringar)', staging.ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
  ok(ksDiff(fore2, ksTa(db, KS)).length === 0, 'rollback T3-D + T3-C + T3-B: ingen data ändrad');
} finally { r.stang(); }
avsluta();
