'use strict';
/*
 * T3-E (2026-11-28): migrationen 20261128000008 — installation → rollback → ny installation,
 * lokalt. Data och rollregistret rörs inte av migrationen (standardrollerna är ett manuellt
 * skript med egen rollback, se tests/t3e_installation.test.js).
 *
 *  1. Repliken med hela kedjan (STAGING + T3-B–T3-E) och data.
 *  2. supabase/rollback/T3-E/rollback_t3e.sql: schemat = STAGING + T3-B–T3-D (0 oförklarade med
 *     T3_LAGE=T3-D; strikt utan läget: 1 oförklarad), _vift_ej_verkstallda borta, INGEN data ändrad.
 *  3. Den äldre koden (T3-D) fungerar: begransad + ej verkställd behörighet räknas åter som intern
 *     (T3-D:s beteende, fyndet som T3-E rättar).
 *  4. Ny installation (STOP-kontrollen godtar T3-D-versionen) → 0 oförklarade; en andra körning stoppas.
 *  5. Rollback i omvänd ordning (T3-E, T3-D, T3-C, T3-B) ger exakt STAGING-facit utan dataändring.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { ok, krav, avsluta } = require('./local/lib/test');
krav();
const { byggReplik, serverRot } = require('./local/lib/replik');
const { psql, psqlFile, q, val, jlit } = require('./local/lib/db');
const { ksTa, ksDiff } = require('./local/lib/kontroll');
const t3eRb = require('./local/t3e-rollback');

const rot = serverRot();
const jamfor = (db, env) => {
  try { return { kod: 0, ut: execFileSync('node', [path.join(__dirname, 'local', 'jamfor-schema.js'), db], { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) }) }; }
  catch (e) { return { kod: e.status || 1, ut: String(e.stdout || '') }; }
};
const oforklarade = (r) => Number((/(\d+) oförklarade/.exec(r.ut) || [])[1]);
const registret = JSON.parse(fs.readFileSync(path.join(__dirname, 'local', 't3-andringar.json'), 'utf8')).objekt;
const t3eEgna = Object.entries(registret).filter(([, v]) => v.paket === 'T3-E').map(([k]) => k);
const extern = (db, perms) => psql(db, `select public._vift_staff_external(array[${perms.map((p) => "'" + p + "'").join(',')}]::text[])`);

ok(fs.readFileSync(t3eRb.UT, 'utf8') === t3eRb.sql(), 'rollback_t3e.sql är aktuell (genererad ur kedjan utan T3-E av tests/local/t3e-rollback.js)');
ok(t3eEgna.length === 2 && t3eEgna.includes('funktion:_vift_ej_verkstallda()') && registret['funktion:_vift_staff_external(p_perms text[])'].aven === 'T3-D',
  't3-andringar.json: två T3-E-objekt (_vift_ej_verkstallda ny, _vift_staff_external ändrad igen med T3-D-läget registrerat)', t3eEgna);
/* T4-A: T3-rollbacken prövas på kedjan utan T4 (T4-A installeras ovanpå T3-E och rullas tillbaka
   först, se t4a_skyddade_falt.test.js som prövar hela den omvända ordningen). */
const T4_FILER = fs.readFileSync(path.join(rot, 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => /^\d{14}$/.test(p[0]) && /_t4[a-z]_/.test(p[1] || '')).map((p) => p[1]);
const r = byggReplik({ utelamna: T4_FILER });
const db = r.db;
try {
  ok(r.rapport.oforklarade === 0, 'hela kedjan (STAGING + T3-B–T3-E): 0 oförklarade');
  ok(extern(db, ['dashboard_view', 'ao_view_own', 'cost_view']) === 't' && extern(db, ['dashboard_view', 'ao_view_own', 'ao_material']) === 'f', 'T3-E: ej verkställd behörighet gör inte en extern användare intern; en verkställd (ao_material) gör det');
  const KS = { keys: ['vift_roles', 'vift_staff', 'vift_workOrders', 'vift_customers', 'vift_activities'], tables: ['app_users', 'property_sensitive_access', 'op_idempotency'] };
  const fore = ksTa(db, KS);
  // 2. Rollback T3-E.
  psqlFile(db, path.join(rot, 'rollback', 'T3-E', 'rollback_t3e.sql'));
  const efterRb = jamfor(db, { T3_LAGE: 'T3-D' });
  ok(oforklarade(efterRb) === 0, 'rollback T3-E: schemat = STAGING + T3-B–T3-D (0 oförklarade i T3-D-läget)', efterRb.ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
  ok(oforklarade(jamfor(db, {})) === 1, 'utan T3_LAGE godtas inte T3-D-läget för _vift_staff_external (jämförelsen är strikt: 1 oförklarad)');
  ok(q(db, `select 1 from pg_proc where proname = '_vift_ej_verkstallda'`).length === 0, 'rollback T3-E: _vift_ej_verkstallda borttagen');
  ok(ksDiff(fore, ksTa(db, KS)).length === 0, 'rollback T3-E: INGEN data ändrad (store inklusive rollregistret, app_users, property_sensitive_access, op_idempotency)');
  // 3. Äldre kod.
  ok(extern(db, ['dashboard_view', 'ao_view_own', 'cost_view']) === 'f', 'efter rollback: T3-D:s regel gäller igen (en ej verkställd behörighet gör användaren intern — fyndet som T3-E rättar)');
  // 4. Ny installation.
  const nya = fs.readFileSync(path.join(rot, 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => /^\d{14}$/.test(p[0]) && /_t3e_/.test(p[1] || '')).map((p) => p[1]);
  let fel = null;
  try { nya.forEach((rel) => psqlFile(db, path.join(rot, rel))); } catch (e) { fel = e.message; }
  ok(!fel && nya.length === 1, 'ny installation efter rollback: 20261128000008 går igenom (STOP-kontrollen godtar T3-D-versionen)', fel);
  ok(oforklarade(jamfor(db, {})) === 0, 'ny installation: schemat = STAGING + alla registrerade T3-ändringar (0 oförklarade)');
  let stop = null;
  try { psqlFile(db, path.join(rot, nya[0])); } catch (e) { stop = e.message; }
  ok(stop && /T3-E STOP: _vift_ej_verkstallda\(\) finns redan/.test(stop), 'STOP-kontroll: en andra körning av 20261128000008 avbryts', stop);
  // Ändrad T3-D-funktion (någon annan har ändrat den) → STOP.
  psqlFile(db, path.join(rot, 'rollback', 'T3-E', 'rollback_t3e.sql'));
  psql(db, `create or replace function public._vift_staff_external(p_perms text[]) returns boolean language sql immutable set search_path = public as $$ select false $$;`);
  stop = null;
  try { psqlFile(db, path.join(rot, nya[0])); } catch (e) { stop = e.message; }
  ok(stop && /T3-E STOP: _vift_staff_external avviker från T3-D-versionen/.test(stop) && q(db, `select 1 from pg_proc where proname = '_vift_ej_verkstallda'`).length === 0, 'STOP-kontroll: en _vift_staff_external som avviker från T3-D-versionen stoppar installationen (inget ändrat)', stop);
} catch (e) { ok(false, 'oväntat fel: ' + e.message); }
// 5. Omvänd ordning i en ny replik → exakt STAGING.
const r2 = byggReplik({ utelamna: T4_FILER, schemakontroll: false });
try {
  const KS2 = { keys: ['vift_roles', 'vift_staff', 'vift_workOrders'], tables: ['app_users'] };
  const fore2 = ksTa(r2.db, KS2);
  for (const p of ['T3-E', 'T3-D', 'T3-C', 'T3-B']) psqlFile(r2.db, path.join(rot, 'rollback', p, 'rollback_' + p.toLowerCase().replace('-', '') + '.sql'));
  const staging = jamfor(r2.db, { T3_IGNORERA: '1' });
  ok(oforklarade(staging) === 0, 'rollback T3-E + T3-D + T3-C + T3-B (omvänd installationsordning): schemat = STAGING-facit', staging.ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
  ok(ksDiff(fore2, ksTa(r2.db, KS2)).length === 0, 'rollback T3-E–T3-B: ingen data ändrad');
} finally { r2.stang(); r.stang(); }
avsluta();
