'use strict';
/*
 * T3-B (2026-11-28): installation → rollback → ny installation, lokalt (testplanen T3-B,
 * "Rollback prövad lokalt: installera, återställ, installera").
 *
 *  1. Repliken med hela repokedjan (STAGING + T3-B) och syntetiska data, plus data som
 *     T3-B-koden skapar (tagning, poolOpen, ignoredFields, '_fp' i op_idempotency,
 *     framflyttad AO-nummersekvens) och en historisk dubblett AO-001.
 *  2. supabase/rollback/T3-B/rollback_t3b.sql: schemat blir EXAKT STAGING-facit igen
 *     (0 oförklarade utan T3-filen) och INGEN data ändras (kontrollsumma på store,
 *     op_idempotency och stamp_status, samt sekvensen).
 *  3. Den äldre koden fungerar på data skapad av T3-B (patch via 4-argumentsfunktionen).
 *  4. Ny installation av de tre migrationerna (STOP-kontrollerna godtar STAGING-versionen)
 *     trots den historiska dubbletten AO-001 → schemat = STAGING + registrerade T3-ändringar.
 * Inget körs mot Supabase.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { ok, krav, avsluta } = require('./local/lib/test');
krav();
const { byggReplik, serverRot } = require('./local/lib/replik');
const { psql, psqlFile, q, val, jlit } = require('./local/lib/db');
const { ksTa, ksDiff } = require('./local/lib/kontroll');

const rot = serverRot();
const jamfor = (db, ignorera) => {
  try { return { kod: 0, ut: execFileSync('node', [path.join(__dirname, 'local', 'jamfor-schema.js'), db], { encoding: 'utf8', env: Object.assign({}, process.env, ignorera ? { T3_IGNORERA: '1' } : {}) }) }; }
  catch (e) { return { kod: e.status || 1, ut: String(e.stdout || '') }; }
};
const oforklarade = (r) => Number((/(\d+) oförklarade/.exec(r.ut) || [])[1]);

// T3-C (2026-11-28) installeras efter T3-B och rullas tillbaka före den (omvänd ordning, se
// tests/t3c_rollback.test.js). Här prövas T3-B för sig: kedjan utan T3-C-migrationerna.
// T3-D och T3-E (2026-11-28) installeras efter T3-C och rullas tillbaka före den; utesluts också.
const T3C = fs.readFileSync(path.join(rot, 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => /^\d{14}$/.test(p[0]) && /_t3[cde]_/.test(p[1] || '')).map((p) => p[1]);
const r = byggReplik({ utelamna: T3C });
const db = r.db;
try {
  const F = r.U.falt.staffId;
  // 1. Data som T3-B-koden skapar.
  let x = psql(db, `select public.work_order_pool_take('AO-P1', '${F}', array['ao_view_own','ao_complete'], 'rb-take', '')::text`);
  ok(/taken_from_pool/.test(x), 'T3-B-kod skapar data: tagning av P1 (poolOpen=false, loggpost, _fp i op_idempotency)');
  x = psql(db, `select public.work_order_patch('AO-A2', '{"status":"klar","completedBy":"x"}'::jsonb, 'rb-klar', null, '${F}', array['ao_view_own','ao_complete'])::text`);
  ok(/ignoredFields/.test(x), 'T3-B-kod skapar data: klarmarkering med ignoredFields');
  psql(db, `update public.store set value = value || ${jlit([{ id: 'HIST-1', title: 'historisk', displayNumber: 'AO-001', staff: [] }, { id: 'HIST-2', title: 'historisk dubblett', displayNumber: 'AO-001', staff: [] }])} where key = 'vift_workOrders'`);
  x = psql(db, `select public.work_order_create('{"title":"ny","status":"nytt","staff":[]}'::jsonb, 'rb-create', 'UUID-RB')::text`);
  ok(/"displayNumber": "AO-0\d\d"/.test(x) && !/"displayNumber": "AO-001"/.test(x), 'T3-B-kod: nytt AO-nummer trots historisk dubblett AO-001');
  const seqFore = psql(db, `select last_value from public.ao_display_number_seq`);
  const KS = { keys: ['vift_workOrders', 'vift_timeEntries', 'vift_invoices', 'vift_staff', 'vift_roles'], tables: ['op_idempotency', 'stamp_status'] };
  const fore = ksTa(db, KS);

  // 2. Rollback.
  psqlFile(db, path.join(rot, 'rollback', 'T3-B', 'rollback_t3b.sql'));
  const efterRb = jamfor(db, true);
  ok(oforklarade(efterRb) === 0, 'rollback: schemat = STAGING-facit (0 oförklarade utan T3-ändringar)', efterRb.ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
  ok(q(db, `select proname from pg_proc where proname in ('work_order_pool_take','work_order_billing_set') or proname like '\\_vift\\_%'`).length === 0, 'rollback: T3-B:s nya funktioner borttagna');
  ok(ksDiff(fore, ksTa(db, KS)).length === 0, 'rollback: INGEN data ändrad (store, op_idempotency, stamp_status) — data skapad efter installationen finns kvar');
  ok(psql(db, `select last_value from public.ao_display_number_seq`) === seqFore, 'rollback: AO-nummersekvensen orörd (framflyttad, inga dubbletter)');
  // 3. Äldre kod på T3-B-data.
  x = psql(db, `select public.work_order_patch('AO-P1', '{"title":"efter rollback"}'::jsonb, 'rb-gammal', null)::text`);
  ok(/efter rollback/.test(x) && val(db, 'vift_workOrders').find((a) => a.id === 'AO-P1').poolOpen === false, 'äldre work_order_patch (4 argument) fungerar på T3-B-data; poolOpen ligger kvar som okänt fält');

  // 4. Ny installation ovanpå, med den historiska dubbletten kvar.
  const nya = fs.readFileSync(path.join(rot, 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => /^\d{14}$/.test(p[0]) && p[0] > '20261124211128' && /_t3b_/.test(p[1] || '')).map((p) => p[1]);
  let fel = null;
  try { nya.forEach((rel) => psqlFile(db, path.join(rot, rel))); } catch (e) { fel = e.message; }
  ok(!fel && nya.length === 3, 'ny installation efter rollback: de 3 T3-B-migrationerna går igenom (STOP-kontrollerna godtar STAGING-versionen), trots historisk dubblett AO-001', fel);
  const efterNy = jamfor(db, false);
  ok(oforklarade(efterNy) === 0, 'ny installation: schemat = STAGING + registrerade T3-B-ändringar (0 oförklarade)');
  ok(val(db, 'vift_workOrders').filter((a) => a.displayNumber === 'AO-001').length === 2, 'den historiska dubbletten AO-001 är orörd (ingen omnumrering, ingen unik index)');
  let stop = null;
  try { psqlFile(db, path.join(rot, nya[0])); } catch (e) { stop = e.message; }
  ok(stop && /T3-B STOP/.test(stop), 'STOP-kontroll: en andra körning av 20261128000001 avbryts (kör aldrig installerad SQL igen)', stop);
} finally { r.stang(); }
avsluta();
