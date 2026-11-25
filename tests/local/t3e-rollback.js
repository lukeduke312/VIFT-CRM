'use strict';
/*
 * T3-E: genererar supabase/rollback/T3-E/rollback_t3e.sql.
 *
 *   node tests/local/t3e-rollback.js           verifierar att filen är aktuell
 *   node tests/local/t3e-rollback.js --skriv   skriver filen
 *
 * "Föregående" definition är läget EFTER T3-D (T3-E installeras ovanpå T3-D). Den läses ur en
 * lokal kedja UTAN T3-E-migrationen (pg_get_functiondef + EXECUTE-rättigheter). Rollbacken
 * återställer _vift_staff_external exakt och tar bort _vift_ej_verkstallda(). Den rör ingen data
 * och inte rollregistret (det manuella skriptet har egen rollback, C_rollback.sql, med
 * expectedHash). Körs FÖRE T3-D-rollbacken (omvänd installationsordning).
 */
const fs = require('fs');
const path = require('path');
const UT = path.resolve(__dirname, '..', '..', 'supabase', 'rollback', 'T3-E', 'rollback_t3e.sql');
const ERSATTA = ['_vift_staff_external(text[])'];
const NYA = ['public._vift_ej_verkstallda()'];

function grants(sig, acl) {
  const roller = String(acl || '').replace(/^\{|\}$/g, '').split(',').map((x) => x.split('=')[0]).filter((r) => r && r !== 'postgres');
  return [`revoke all on function public.${sig} from public, anon, authenticated, service_role;`]
    .concat(roller.map((r) => `grant execute on function public.${sig} to ${r};`));
}
const paketFiler = (rot, re) => fs.readFileSync(path.join(rot, 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/))
  .filter((p) => /^\d{14}$/.test(p[0]) && re.test(p[1] || '')).map((p) => p[1]);

function lasForeDefinitioner() {
  if (!process.env.PGHOST) process.env.PGHOST = '/var/tmp/vift-localpg';
  if (!process.env.PGUSER) process.env.PGUSER = 'postgres';
  const { byggReplik, serverRot } = require('./lib/replik');
  const { q } = require('./lib/db');
  const r = byggReplik({ utelamna: paketFiler(serverRot(), /_t3e_/), data: false, schemakontroll: false });
  try {
    const ut = {};
    for (const sig of ERSATTA) ut[sig] = q(r.db, `select pg_get_functiondef('public.${sig}'::regprocedure) as def, coalesce((select proacl::text from pg_proc where oid = 'public.${sig}'::regprocedure), 'NULL') as acl`)[0];
    return ut;
  } finally { r.stang(); }
}

function sql(fore) {
  fore = fore || lasForeDefinitioner();
  const d = ['-- ============================================================',
    '-- ROLLBACK T3-E (genererad av tests/local/t3e-rollback.js ur en lokal kedja utan T3-E,',
    '-- dvs. läget efter T3-D).',
    '-- Återställer _vift_staff_external EXAKT till T3-D-versionen och tar bort _vift_ej_verkstallda().',
    '-- Rör INGEN data och INTE rollregistret. Standardrollerna (manuellt skript) rullas tillbaka',
    '-- separat med supabase/manual/t3e_standardroller/C_rollback.sql (expectedHash, journal).',
    '-- Ordning vid rollback: 1) C_rollback.sql vid behov, 2) denna fil, 3) föregående klientpaket,',
    '--   4) vid behov T3-D-, T3-C- och T3-B-rollbacken (omvänd ordning).',
    '-- ============================================================', 'begin;', ''];
  d.push('-- 1. Ersatt funktion (samma signatur) tillbaka till T3-D-definitionen.');
  for (const sig of ERSATTA) d.push(`-- ${sig}`, fore[sig].def.replace(/\s*$/, '') + ';', ...grants(sig, fore[sig].acl), '');
  d.push('-- 2. T3-E:s nya registerfunktion bort (efter att inget längre anropar den).');
  NYA.forEach((f) => d.push(`drop function if exists ${f};`));
  d.push('', 'commit;', '');
  return d.join('\n');
}

if (require.main === module) {
  const s = sql();
  if (process.argv.includes('--skriv')) { fs.mkdirSync(path.dirname(UT), { recursive: true }); fs.writeFileSync(UT, s); console.log('Skrev ' + UT); }
  else {
    const ok = fs.existsSync(UT) && fs.readFileSync(UT, 'utf8') === s;
    console.log((ok ? 'PASS' : 'FAIL') + ' rollback_t3e.sql är aktuell mot kedjan utan T3-E');
    if (!ok) process.exitCode = 1;
  }
}
module.exports = { sql, UT, paketFiler };
