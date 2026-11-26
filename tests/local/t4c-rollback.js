'use strict';
/*
 * T4-C: genererar supabase/rollback/T4-C/rollback_t4c.sql.
 *
 *   node tests/local/t4c-rollback.js           verifierar att filen är aktuell
 *   node tests/local/t4c-rollback.js --skriv   skriver filen
 *
 * "Föregående" definition är läget EFTER T4-B (20261128000011). Den läses ur en lokal kedja UTAN
 * T4-C (och senare T4-paket) (pg_get_functiondef + EXECUTE-rättigheter). Rollbacken:
 *   1. tar bort D-23-triggern (först, så att ingen radering sker under rollbacken);
 *   2. återställer de tre ersatta funktionerna exakt (samma signatur);
 *   3. tar bort T4-C:s nya funktioner (sensitive_fields_read, _vift_t4c_*).
 * Den rör ingen data: property_sensitive_access och sensitive_access_audit (även T4-C:s revisionsrader)
 * ligger kvar orörda. Körs EFTER att föregående EF-version av get-sensitive-fields (och föregående
 * klientpaket) installerats, och FÖRE T4-B:s rollback. Är T4-D installerad körs T4-D:s rollback först.
 */
const fs = require('fs');
const path = require('path');
const UT = path.resolve(__dirname, '..', '..', 'supabase', 'rollback', 'T4-C', 'rollback_t4c.sql');
const ERSATTA = ['_vift_ej_verkstallda()', 'store_business_key_write(text,jsonb,text,boolean,text,jsonb)',
  'store_business_key_merge_write(text,jsonb,jsonb,boolean,text,jsonb)'];
const NYA = ['sensitive_fields_read(text,text,text,text,text,text[],uuid,text)', '_vift_t4c_kanslig_radering()',
  '_vift_t4c_rondering_aktiv(text[])', '_vift_t4c_pass_tilldelad(jsonb,text)', '_vift_t4c_pass_aktiv(jsonb)', '_vift_t4c_ao_aktiv(jsonb)'];
const FIL = 'migrations/20261128000012_t4c_atkomstinformation.sql';
/* Kedjan före T4-C: utan T4-C och alla senare T4-paket (T4-D …). */
const SENARE = /_t4[c-z]_/;
const paketFiler = (rot, re) => fs.readFileSync(path.join(rot, 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/))
  .filter((x) => /^\d{14}$/.test(x[0]) && re.test(x[1] || '')).map((x) => x[1]);

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
  const r = byggReplik({ utelamna: paketFiler(serverRot(), SENARE), data: false, schemakontroll: false });
  try {
    const ut = {};
    for (const sig of ERSATTA) {
      ut[sig] = q(r.db, `select pg_get_functiondef('public.${sig}'::regprocedure) as def, coalesce((select proacl::text from pg_proc where oid = 'public.${sig}'::regprocedure), 'NULL') as acl`)[0];
    }
    return ut;
  } finally { r.stang(); }
}

function sql(fore) {
  fore = fore || lasForeDefinitioner();
  const d = ['-- ============================================================',
    '-- ROLLBACK T4-C (genererad av tests/local/t4c-rollback.js ur en lokal kedja utan',
    '-- 20261128000012 och senare T4-paket, dvs. läget efter T4-B).',
    '-- Tar bort D-23-triggern, återställer de tre ersatta funktionerna EXAKT och tar bort T4-C:s nya',
    '-- funktioner (sensitive_fields_read, _vift_t4c_*). Rör INGEN data: property_sensitive_access och',
    '-- sensitive_access_audit (även T4-C:s revisionsrader) ligger kvar.',
    '-- Ordning vid rollback: 1) föregående EF-version av get-sensitive-fields och föregående klientpaket,',
    '--   2) (om T4-D är installerad) T4-D:s rollback, 3) denna fil, 4) T4-B:s rollback, 5) notisdelens,',
    '--   6) T4-A:s, 7) vid behov T3-E-, T3-D-, T3-C- och T3-B-rollbacken (omvänd ordning).',
    '-- ============================================================', 'begin;', ''];
  d.push('-- 1. D-23-triggern bort.', 'drop trigger if exists vift_t4c_kanslig_radering on public.store;', '');
  d.push('-- 2. Ersatta funktioner (samma signatur) tillbaka till definitionen efter T4-B.');
  for (const sig of ERSATTA) d.push(`-- ${sig}`, fore[sig].def.replace(/\s*$/, '') + ';', ...grants(sig, fore[sig].acl), '');
  d.push('-- 3. T4-C:s nya funktioner bort (efter att inget längre anropar dem).');
  NYA.forEach((f) => d.push(`drop function if exists public.${f};`));
  d.push('', 'commit;', '');
  return d.join('\n');
}

if (require.main === module) {
  const s = sql();
  if (process.argv.includes('--skriv')) { fs.mkdirSync(path.dirname(UT), { recursive: true }); fs.writeFileSync(UT, s); console.log('Skrev ' + UT); }
  else {
    const ok = fs.existsSync(UT) && fs.readFileSync(UT, 'utf8') === s;
    console.log((ok ? 'PASS' : 'FAIL') + ' rollback_t4c.sql är aktuell mot kedjan utan T4-C');
    if (!ok) process.exitCode = 1;
  }
}
module.exports = { sql, UT, ERSATTA, NYA, FIL, paketFiler, SENARE };
