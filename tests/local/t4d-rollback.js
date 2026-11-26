'use strict';
/*
 * T4-D: genererar supabase/rollback/T4-D/rollback_t4d.sql.
 *
 *   node tests/local/t4d-rollback.js           verifierar att filen är aktuell
 *   node tests/local/t4d-rollback.js --skriv   skriver filen
 *
 * "Föregående" definition är läget EFTER T4-C (20261128000012), läst ur en lokal kedja UTAN T4-D (och senare
 * T4-paket). Rollbacken:
 *   1. tar bort de fyra passåtgärderna med T4-D:s signatur (p_caller_perms) och återskapar de fyra
 *      föregående exakt (samma definition och EXECUTE-rättigheter);
 *   2. återställer de sex ersatta funktionerna (samma signatur) exakt;
 *   3. tar bort T4-D:s hjälpfunktioner (_vift_t4d_*).
 * Den rör ingen data: pass som fältet ändrat ligger kvar och är giltiga för den äldre koden. Körs EFTER att
 * föregående EF-versioner (rondering-pass-write, store-key-write) och föregående klientpaket installerats,
 * och FÖRE T4-C:s rollback.
 */
const fs = require('fs');
const path = require('path');
const UT = path.resolve(__dirname, '..', '..', 'supabase', 'rollback', 'T4-D', 'rollback_t4d.sql');
const ERSATTA = ['_vift_ej_verkstallda()', 'vift_store_full_access(text,text[])', 'vift_store_project(text,jsonb,text[],text)',
  '_vift_post_refs(text[],text)', '_vift_ref_visible(text,text,text[],jsonb)', '_vift_activity_type_perms(text)'];
const ATERSKAPADE = ['rondering_point_patch(text,text,text,text,text,text,text,text,boolean)', 'rondering_pass_save_note(text,text)',
  'rondering_pass_auto_start(text)', 'rondering_pass_complete(text,text)'];
const NYA_SIGNATURER = ['rondering_point_patch(text,text,text,text,text,text,text,text,boolean,text[])', 'rondering_pass_save_note(text,text,text,text[])',
  'rondering_pass_auto_start(text,text,text[])', 'rondering_pass_complete(text,text,text[])'];
const NYA = ['_vift_t4d_las_pass(text,text,text[],boolean)', '_vift_t4d_pass_regel(jsonb,text,text[])', '_vift_t4d_egna_ronderingar(text)'];
const FIL = 'migrations/20261128000013_t4d_rondering.sql';

function grants(sig, acl) {
  const roller = String(acl || '').replace(/^\{|\}$/g, '').split(',').map((x) => x.split('=')[0]).filter((r) => r && r !== 'postgres');
  return [`revoke all on function public.${sig} from public, anon, authenticated, service_role;`]
    .concat(roller.map((r) => `grant execute on function public.${sig} to ${r};`));
}

function lasForeDefinitioner() {
  if (!process.env.PGHOST) process.env.PGHOST = '/var/tmp/vift-localpg';
  if (!process.env.PGUSER) process.env.PGUSER = 'postgres';
  const { byggReplik, franOchMed } = require('./lib/replik');
  const { q } = require('./lib/db');
  const r = byggReplik({ utelamna: franOchMed(FIL), data: false, schemakontroll: false });
  try {
    const ut = {};
    for (const sig of ERSATTA.concat(ATERSKAPADE)) {
      ut[sig] = q(r.db, `select pg_get_functiondef('public.${sig}'::regprocedure) as def, coalesce((select proacl::text from pg_proc where oid = 'public.${sig}'::regprocedure), 'NULL') as acl`)[0];
    }
    return ut;
  } finally { r.stang(); }
}

function sql(fore) {
  fore = fore || lasForeDefinitioner();
  const d = ['-- ============================================================',
    '-- ROLLBACK T4-D (genererad av tests/local/t4d-rollback.js ur en lokal kedja utan',
    '-- 20261128000013 och senare T4-paket, dvs. läget efter T4-C).',
    '-- Tar bort passåtgärdernas T4-D-signaturer och återskapar de föregående exakt, återställer de sex',
    '-- ersatta funktionerna exakt och tar bort T4-D:s hjälpfunktioner. Rör INGEN data.',
    '-- Ordning vid rollback: 1) föregående EF-versioner (rondering-pass-write, store-key-write) och föregående',
    '--   klientpaket, 2) denna fil, 3) T4-C:s rollback, 4) T4-B:s, 5) notisdelens, 6) T4-A:s, 7) vid behov',
    '--   T3-E-, T3-D-, T3-C- och T3-B-rollbacken (omvänd ordning).',
    '-- ============================================================', 'begin;', ''];
  d.push('-- 1. Passåtgärderna: T4-D-signaturerna bort, de föregående tillbaka.');
  NYA_SIGNATURER.forEach((f) => d.push(`drop function if exists public.${f};`));
  d.push('');
  for (const sig of ATERSKAPADE) d.push(`-- ${sig}`, fore[sig].def.replace(/\s*$/, '') + ';', ...grants(sig, fore[sig].acl), '');
  d.push('-- 2. Ersatta funktioner (samma signatur) tillbaka till definitionen efter T4-C.');
  for (const sig of ERSATTA) d.push(`-- ${sig}`, fore[sig].def.replace(/\s*$/, '') + ';', ...grants(sig, fore[sig].acl), '');
  d.push('-- 3. T4-D:s hjälpfunktioner bort.');
  NYA.forEach((f) => d.push(`drop function if exists public.${f};`));
  d.push('', 'commit;', '');
  return d.join('\n');
}

if (require.main === module) {
  const s = sql();
  if (process.argv.includes('--skriv')) { fs.mkdirSync(path.dirname(UT), { recursive: true }); fs.writeFileSync(UT, s); console.log('Skrev ' + UT); }
  else {
    const ok = fs.existsSync(UT) && fs.readFileSync(UT, 'utf8') === s;
    console.log((ok ? 'PASS' : 'FAIL') + ' rollback_t4d.sql är aktuell mot kedjan utan T4-D');
    if (!ok) process.exitCode = 1;
  }
}
module.exports = { sql, UT, ERSATTA, ATERSKAPADE, NYA_SIGNATURER, NYA, FIL };
