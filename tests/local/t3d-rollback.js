'use strict';
/*
 * T3-D: genererar supabase/rollback/T3-D/rollback_t3d.sql.
 *
 *   node tests/local/t3d-rollback.js           verifierar att filen är aktuell
 *   node tests/local/t3d-rollback.js --skriv   skriver filen
 *
 * "Föregående" definitioner är läget EFTER T3-C (T3-D installeras ovanpå T3-C). De finns inte
 * i STAGING-facit (vift_store_project och vift_store_full_access är T3-C:s versioner), så de
 * läses ur en lokal kedja UTAN T3-D-migrationerna (pg_get_functiondef + EXECUTE-rättigheter).
 * activity_log_append(jsonb,integer) är oförändrad STAGING-version (md5 kontrolleras mot facit).
 *
 * Rollbacken återställer de ersatta funktionerna exakt, återskapar den gamla signaturen för
 * activity_log_append och tar bort T3-D:s nya hjälpfunktioner. Den rör ingen data. Körs FÖRE
 * T3-C-rollbacken (omvänd installationsordning) och EFTER att store-key-write och invoice-write
 * återställts till T3-C-versionerna (den nya store-key-write anropar 4-argumentssignaturen).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const UT = path.resolve(__dirname, '..', '..', 'supabase', 'rollback', 'T3-D', 'rollback_t3d.sql');

/* Ersatta med samma signatur: återställs med CREATE OR REPLACE. */
const ERSATTA = ['vift_store_full_access(text,text[])', 'vift_store_project(text,jsonb,text[],text)'];
/* Ersatt av en ny signatur: den nya tas bort och den gamla återskapas. */
const NY_SIGNATUR = [['activity_log_append(jsonb,integer)', 'public.activity_log_append(jsonb,integer,text,text[])']];
const NYA = ['public._vift_ref_visible(text,text,text[],jsonb)', 'public._vift_activity_type_perms(text)', 'public._vift_post_refs(text[],text)',
  'public._vift_kund_las(text[])', 'public._vift_staff_external(text[])', 'public._vift_task_ao(jsonb)', 'public._vift_activity_ao_type(text)',
  'public._vift_ao_content_visible(jsonb,text[],text)', 'public._vift_ao_visible(jsonb,text[],text)'];

function grants(sig, acl) {
  const roller = String(acl || '').replace(/^\{|\}$/g, '').split(',').map((x) => x.split('=')[0]).filter((r) => r && r !== 'postgres');
  return [`revoke all on function public.${sig} from public, anon, authenticated, service_role;`]
    .concat(roller.map((r) => `grant execute on function public.${sig} to ${r};`));
}

function lasForeDefinitioner() {
  if (!process.env.PGHOST) process.env.PGHOST = '/var/tmp/vift-localpg';
  if (!process.env.PGUSER) process.env.PGUSER = 'postgres';
  const { byggReplik, serverRot } = require('./lib/replik');
  const { q } = require('./lib/db');
  const rot = serverRot();
  const t3d = fs.readFileSync(path.join(rot, 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/))
    .filter((p) => /^\d{14}$/.test(p[0]) && /_t3d_/.test(p[1] || '')).map((p) => p[1]);
  const r = byggReplik({ utelamna: t3d, data: false, schemakontroll: false });
  try {
    const ut = {};
    for (const sig of ERSATTA.concat(NY_SIGNATUR.map((x) => x[0]))) {
      const row = q(r.db, `select pg_get_functiondef('public.${sig}'::regprocedure) as def, coalesce((select proacl::text from pg_proc where oid = 'public.${sig}'::regprocedure), 'NULL') as acl`)[0];
      ut[sig] = row;
    }
    return ut;
  } finally { r.stang(); }
}

function sql(fore) {
  fore = fore || lasForeDefinitioner();
  const facit = require('./staging-schema-facit-2026-11-25.json');
  const st = facit.functions.find((x) => x.name === 'activity_log_append' && x.args === 'p_entry jsonb, p_max integer');
  const md5 = (x) => crypto.createHash('md5').update(x).digest('hex');
  if (!st || md5(st.def) !== md5(fore['activity_log_append(jsonb,integer)'].def)) throw new Error('activity_log_append före T3-D avviker från STAGING-facit');
  const d = ['-- ============================================================',
    '-- ROLLBACK T3-D (genererad av tests/local/t3d-rollback.js ur en lokal kedja utan T3-D,',
    '-- dvs. läget efter T3-C; activity_log_append(jsonb,integer) = STAGING-facit).',
    '-- Återställer de funktioner som T3-D ersatte EXAKT till T3-C-versionen, återskapar den gamla',
    '-- signaturen för activity_log_append och tar bort T3-D:s nya hjälpfunktioner.',
    '-- Rör INGEN data (store, app_users, property_sensitive_access). Körs i en transaktion.',
    '-- Ordning vid rollback: 1) store-key-write och invoice-write till T3-C-versionerna (EF-backup),',
    '--   2) denna fil, 3) föregående klientpaket, 4) vid behov T3-C- och T3-B-rollbacken (omvänd ordning).',
    '-- ============================================================', 'begin;', ''];
  d.push('-- 1. activity_log_append: den nya signaturen bort, STAGING-signaturen tillbaka (exakt text).');
  for (const [gammal, ny] of NY_SIGNATUR) {
    d.push(`drop function if exists ${ny};`);
    d.push(`-- ${gammal}`, fore[gammal].def.replace(/\s*$/, '') + ';', ...grants(gammal, fore[gammal].acl), '');
  }
  d.push('-- 2. Ersatta funktioner (samma signatur) tillbaka till T3-C-definitionen.');
  for (const sig of ERSATTA) d.push(`-- ${sig}`, fore[sig].def.replace(/\s*$/, '') + ';', ...grants(sig, fore[sig].acl), '');
  d.push('-- 3. T3-D:s nya hjälpfunktioner bort (efter att inget längre anropar dem).');
  NYA.forEach((f) => d.push(`drop function if exists ${f};`));
  d.push('', 'commit;', '');
  return d.join('\n');
}

if (require.main === module) {
  const s = sql();
  if (process.argv.includes('--skriv')) { fs.mkdirSync(path.dirname(UT), { recursive: true }); fs.writeFileSync(UT, s); console.log('Skrev ' + UT); }
  else {
    const ok = fs.existsSync(UT) && fs.readFileSync(UT, 'utf8') === s;
    console.log((ok ? 'PASS' : 'FAIL') + ' rollback_t3d.sql är aktuell mot kedjan utan T3-D');
    if (!ok) process.exitCode = 1;
  }
}
module.exports = { sql, UT };
