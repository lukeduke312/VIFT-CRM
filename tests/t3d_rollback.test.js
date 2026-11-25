'use strict';
/*
 * T3-D (2026-11-28): installation → rollback → ny installation, lokalt (testplanen T3-D,
 * "Rollback: föregående vift_store_project/vift_store_full_access/store_read_all_with_hashes_projected
 * och store-key-write"). Data ändras inte av paketet.
 *
 *  1. Repliken med hela repokedjan (STAGING + T3-B + T3-C + T3-D), T3-D-världen och data som
 *     T3-D-koden skapar (aktivitetsposter via den nya activity_log_append, en uppgift via
 *     merge-skrivningen).
 *  2. supabase/rollback/T3-D/rollback_t3d.sql: schemat blir STAGING + T3-B + T3-C (0 oförklarade
 *     med T3_LAGE=T3-C; T3-D:s egna objekt borta) och INGEN data ändras (kontrollsumma).
 *  3. Den äldre koden fungerar på data skapad av T3-D (äldre activity_log_append med två
 *     argument, T3-C:s projektion).
 *  4. Ny installation av de två T3-D-migrationerna (STOP-kontrollerna godtar T3-C-versionen)
 *     → schemat = STAGING + alla registrerade T3-ändringar; en andra körning stoppas.
 *  5. Rollback i omvänd ordning (T3-D, T3-C, T3-B) ger exakt STAGING-facit.
 * Inget körs mot Supabase.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { ok, krav, avsluta } = require('./local/lib/test');
krav();
const { byggReplik, serverRot } = require('./local/lib/replik');
const { psql, psqlFile, q, val, jlit, lit, rpc } = require('./local/lib/db');
const { ksTa, ksDiff } = require('./local/lib/kontroll');
const { data, ROLLER } = require('./local/lib/data');
const { t3dVarld } = require('./local/lib/t3d-data');
const t3dRb = require('./local/t3d-rollback');

const rot = serverRot();
const jamfor = (db, env) => {
  try { return { kod: 0, ut: execFileSync('node', [path.join(__dirname, 'local', 'jamfor-schema.js'), db], { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) }) }; }
  catch (e) { return { kod: e.status || 1, ut: String(e.stdout || '') }; }
};
const oforklarade = (r) => Number((/(\d+) oförklarade/.exec(r.ut) || [])[1]);
const registret = JSON.parse(fs.readFileSync(path.join(__dirname, 'local', 't3-andringar.json'), 'utf8')).objekt;
// T3-E ändrar _vift_staff_external igen (paket T3-E, aven T3-D); den räknas fortfarande till T3-D:s objekt.
const t3dEgna = Object.entries(registret).filter(([, v]) => (v.paket === 'T3-D' && !v.aven) || v.aven === 'T3-D').map(([k]) => k);

ok(fs.readFileSync(t3dRb.UT, 'utf8') === t3dRb.sql(), 'rollback_t3d.sql är aktuell (genererad ur kedjan utan T3-D av tests/local/t3d-rollback.js)');
const r = byggReplik({});
const db = r.db;
const U = r.U;
try {
  const d = data(); t3dVarld(d.store, d);
  psql(db, Object.entries(d.store).map(([k, v]) => `insert into public.store(key, value) values (${lit(k)}, ${jlit(v)}) on conflict (key) do update set value = excluded.value;`).join('\n'));
  const F = U.falt.staffId;
  const pPerms = ROLLER.find((x) => x.id === 'personal').permissions;
  // 1. Data som T3-D-koden skapar.
  let x = rpc(db, 'activity_log_append', { p_entry: { id: 'ACT-RB-000001', type: 'work_order_status', description: 'x', workOrderId: 'AO-A1' }, p_max: 500, p_caller_staff_id: F, p_caller_perms: pPerms });
  ok(!x.error && val(db, 'vift_activityLog')[0].id === 'ACT-RB-000001' && val(db, 'vift_activityLog')[0].userId === F, 'T3-D-kod skapar data: aktivitetspost via activity_log_append (4 argument, aktör satt av servern)', x.error);
  const t0 = val(db, 'vift_activities').find((t) => t.id === 'TASK-D2');
  x = rpc(db, 'store_business_key_merge_write', { p_key: 'vift_activities', p_upserts: [{ id: 'TASK-D2', data: Object.assign({}, t0, { status: 'done' }), previous: t0 }], p_removals: [], p_caller_authorized: true, p_actor_id: F });
  ok(!x.error, 'T3-D-kod: uppgift klarmarkerad via merge-skrivningen', x.error);
  const KS = { keys: ['vift_activityLog', 'vift_activities', 'vift_customers', 'vift_properties', 'vift_propertyContacts', 'vift_offers', 'vift_staff', 'vift_workOrders'], tables: ['app_users', 'property_sensitive_access', 'op_idempotency'] };
  const fore = ksTa(db, KS);

  // 2. Rollback T3-D (i omvänd installationsordning: T3-E först, den bygger på T3-D).
  psqlFile(db, path.join(rot, 'rollback', 'T3-E', 'rollback_t3e.sql'));
  psqlFile(db, path.join(rot, 'rollback', 'T3-D', 'rollback_t3d.sql'));
  const efterRb = jamfor(db, { T3_LAGE: 'T3-C' });
  ok(oforklarade(efterRb) === 0, 'rollback T3-D: schemat = STAGING + registrerade T3-B- och T3-C-ändringar (0 oförklarade, T3-C-läget)', efterRb.ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
  const obs = (efterRb.ut.split('OBS: T3-ändringar som inte syns')[1] || '').split('\n')[0];
  const kvar = t3dEgna.filter((k) => !obs.includes(k));
  ok(t3dEgna.length === 11 && kvar.length === 0, 'rollback T3-D: alla 11 egna T3-D-objekt är borta (activity_log_append med 4 argument och 9 hjälpfunktioner; den gamla signaturen är tillbaka)', kvar.slice(0, 3));
  const utanLage = jamfor(db, {});
  ok(oforklarade(utanLage) === 2, 'utan T3_LAGE godtas inte T3-C-läget för de två objekt som T3-D ändrar (jämförelsen är strikt: 2 oförklarade)', oforklarade(utanLage));
  ok(q(db, `select proname from pg_proc where proname in ('_vift_post_refs','_vift_ref_visible','_vift_activity_type_perms')`).length === 0, 'rollback T3-D: T3-D:s nya funktioner borttagna');
  ok(q(db, `select 1 from pg_proc where oid = to_regprocedure('public.activity_log_append(jsonb,integer)')`).length === 1, 'rollback T3-D: activity_log_append(jsonb, integer) (STAGING-versionen) finns igen');
  ok(ksDiff(fore, ksTa(db, KS)).length === 0, 'rollback T3-D: INGEN data ändrad (store, app_users, property_sensitive_access, op_idempotency) — data skapad efter installationen finns kvar');
  // 3. Äldre kod på T3-D-data.
  x = rpc(db, 'activity_log_append', { p_entry: { id: 'ACT-RB-000002', type: 'note', description: 'efter rollback', userId: F, timestamp: '2026-11-28T08:00:00.000Z' }, p_max: 500 });
  ok(!x.error && val(db, 'vift_activityLog')[0].id === 'ACT-RB-000002' && val(db, 'vift_activityLog').some((l) => l.id === 'ACT-RB-000001'), 'äldre activity_log_append (2 argument, som T3-C:s store-key-write anropar) fungerar på T3-D-data', x.error);
  x = rpc(db, 'store_read_all_with_hashes_projected', { p_business_keys: ['vift_activities', 'vift_customers'], p_perms: pPerms, p_caller_staff_id: F });
  ok(!x.error && x.data.data.vift_activities.length === val(db, 'vift_activities').length && x.data.data.vift_customers.length === 3, 'T3-C:s projektion gäller igen (inget urval per post: fält får alla uppgifter och kunder, som före T3-D)', x.error);

  // 4. Ny installation ovanpå.
  const nya = fs.readFileSync(path.join(rot, 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => /^\d{14}$/.test(p[0]) && /_t3[de]_/.test(p[1] || '')).map((p) => p[1]);
  let fel = null;
  try { nya.forEach((rel) => psqlFile(db, path.join(rot, rel))); } catch (e) { fel = e.message; }
  ok(!fel && nya.length === 3, 'ny installation efter rollback: de 2 T3-D-migrationerna och T3-E-migrationen går igenom (STOP-kontrollerna godtar T3-C- respektive T3-D-versionen)', fel);
  const efterNy = jamfor(db, {});
  ok(oforklarade(efterNy) === 0 && !/OBS: T3-ändringar som inte syns/.test(efterNy.ut), 'ny installation: schemat = STAGING + alla registrerade T3-ändringar (0 oförklarade)');
  for (const rel of nya) {
    let stop = null;
    try { psqlFile(db, path.join(rot, rel)); } catch (e) { stop = e.message; }
    ok(stop && /T3-[DE] STOP/.test(stop), 'STOP-kontroll: en andra körning av ' + path.basename(rel) + ' avbryts', stop);
  }
  x = rpc(db, 'store_read_all_with_hashes_projected', { p_business_keys: ['vift_activities'], p_perms: pPerms, p_caller_staff_id: F });
  ok(!x.error && x.data.data.vift_activities.map((t) => t.id).sort().join() === 'TASK-D1,TASK-D2,TASK-R1', 'efter ny installation: urvalet per post gäller igen', x.error || x.data.data.vift_activities.map((t) => t.id));

  // 5. Omvänd ordning: T3-D, T3-C och T3-B → exakt STAGING.
  const fore2 = ksTa(db, KS);
  psqlFile(db, path.join(rot, 'rollback', 'T3-E', 'rollback_t3e.sql'));
  psqlFile(db, path.join(rot, 'rollback', 'T3-D', 'rollback_t3d.sql'));
  psqlFile(db, path.join(rot, 'rollback', 'T3-C', 'rollback_t3c.sql'));
  psqlFile(db, path.join(rot, 'rollback', 'T3-B', 'rollback_t3b.sql'));
  const staging = jamfor(db, { T3_IGNORERA: '1' });
  ok(oforklarade(staging) === 0, 'rollback T3-E + T3-D + T3-C + T3-B (omvänd installationsordning): schemat = STAGING-facit (0 oförklarade utan T3-ändringar)', staging.ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
  ok(ksDiff(fore2, ksTa(db, KS)).length === 0, 'rollback T3-D + T3-C + T3-B: ingen data ändrad');
} finally { r.stang(); }
avsluta();
