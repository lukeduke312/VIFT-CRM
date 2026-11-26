'use strict';
/*
 * T4-A: genererar supabase/rollback/T4-A/rollback_t4a.sql.
 *
 *   node tests/local/t4a-rollback.js           verifierar att filen är aktuell
 *   node tests/local/t4a-rollback.js --skriv   skriver filen
 *
 * "Föregående" definition är läget EFTER T3-E (T4-A installeras ovanpå T3-E). Den läses ur en lokal
 * kedja UTAN T4-A-migrationen (pg_get_functiondef + EXECUTE-rättigheter). Rollbacken:
 *   1. tar bort store_business_key_write/_merge_write med T4-A:s extra parameter p_klient och
 *      återskapar T3-C-versionerna (5 parametrar) exakt;
 *   2. återställer de ersatta funktionerna med samma signatur exakt;
 *   3. tar bort T4-A:s nya hjälpfunktioner.
 * Den rör ingen data. Körs EFTER T4-B:s rollback (omvänd installationsordning) och FÖRE T3-E:s.
 * Föregående EF-versioner (store-key-write, work-orders-list, ao-time-write, work-order-image-delete)
 * installeras FÖRST: den äldre store-key-write anropar 5-parametersversionen med namngivna argument.
 */
const fs = require('fs');
const path = require('path');
const UT = path.resolve(__dirname, '..', '..', 'supabase', 'rollback', 'T4-A', 'rollback_t4a.sql');
const SIGNATURBYTE = [
  { ny: 'store_business_key_write(text,jsonb,text,boolean,text,jsonb)', gammal: 'store_business_key_write(text,jsonb,text,boolean,text)' },
  { ny: 'store_business_key_merge_write(text,jsonb,jsonb,boolean,text,jsonb)', gammal: 'store_business_key_merge_write(text,jsonb,jsonb,boolean,text)' },
];
const ERSATTA = ['vift_store_full_access(text,text[])', 'vift_store_project(text,jsonb,text[],text)', 'work_order_patch(text,jsonb,text,text,text,text[])',
  '_vift_ej_verkstallda()', '_vift_role_perms(jsonb,text)', 'vift_caller_perms()', '_vift_auth_staff(uuid)'];
const NYA = ['_vift_t4a_roll_aktiv(jsonb)', '_vift_t4a_giltig(text[])', '_vift_t4a_legacy(text[])', '_vift_t4a_kontakt(text[])', '_vift_t4a_logg_full(text[])',
  '_vift_t4a_privat(jsonb)', '_vift_t4a_tom(jsonb)', '_vift_t4a_falt(text)', '_vift_t4a_kan_lasa(text,text,jsonb,text[])',
  '_vift_t4a_kan_skriva(text,text,jsonb,text[])', '_vift_t4a_alla_lasbara(text,text[])', '_vift_t4a_projicera_elem(text,jsonb,text[])',
  '_vift_t4a_sammanfoga(text,jsonb,jsonb,text[])', '_vift_t4a_sammanfoga_lista(text,jsonb,jsonb,text[])', '_vift_t4a_aktor_perms(text)',
  '_vift_t4a_roller_bevara(jsonb,jsonb,jsonb)', '_vift_t4a_ao_patch(jsonb,jsonb,text[])', '_vift_t4a_ao_ref(text[],text,text)'];

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
  const r = byggReplik({ utelamna: paketFiler(serverRot(), /_t4[a-z]_/), data: false, schemakontroll: false });
  try {
    const ut = {};
    for (const sig of ERSATTA.concat(SIGNATURBYTE.map((s) => s.gammal))) {
      ut[sig] = q(r.db, `select pg_get_functiondef('public.${sig}'::regprocedure) as def, coalesce((select proacl::text from pg_proc where oid = 'public.${sig}'::regprocedure), 'NULL') as acl`)[0];
    }
    return ut;
  } finally { r.stang(); }
}

function sql(fore) {
  fore = fore || lasForeDefinitioner();
  const d = ['-- ============================================================',
    '-- ROLLBACK T4-A (genererad av tests/local/t4a-rollback.js ur en lokal kedja utan T4-A,',
    '-- dvs. läget efter T3-E).',
    '-- Återställer store_business_key_write/_merge_write (5 parametrar), vift_store_full_access,',
    '-- vift_store_project, work_order_patch, _vift_ej_verkstallda, _vift_role_perms, vift_caller_perms och',
    '-- _vift_auth_staff EXAKT och tar bort T4-A:s hjälpfunktioner. Rör INGEN data.',
    '-- Ordning vid rollback: 1) T4-B:s rollback (om installerad), 2) föregående EF-versioner',
    '--   (store-key-write, work-orders-list, ao-time-write, work-order-image-delete), 3) denna fil,',
    '--   4) föregående klientpaket, 5) vid behov T3-E-, T3-D-, T3-C- och T3-B-rollbacken (omvänd ordning).',
    '-- ============================================================', 'begin;', ''];
  d.push('-- 1. Signaturbyte tillbaka: T4-A:s versioner (med p_klient) bort, T3-C-versionerna tillbaka.');
  for (const s of SIGNATURBYTE) {
    d.push(`drop function if exists public.${s.ny};`, `-- ${s.gammal}`, fore[s.gammal].def.replace(/\s*$/, '') + ';', ...grants(s.gammal, fore[s.gammal].acl), '');
  }
  d.push('-- 2. Ersatta funktioner (samma signatur) tillbaka till definitionen före T4-A.');
  for (const sig of ERSATTA) d.push(`-- ${sig}`, fore[sig].def.replace(/\s*$/, '') + ';', ...grants(sig, fore[sig].acl), '');
  d.push('-- 3. T4-A:s nya hjälpfunktioner bort (efter att inget längre anropar dem).');
  NYA.forEach((f) => d.push(`drop function if exists public.${f};`));
  d.push('', 'commit;', '');
  return d.join('\n');
}

if (require.main === module) {
  const s = sql();
  if (process.argv.includes('--skriv')) { fs.mkdirSync(path.dirname(UT), { recursive: true }); fs.writeFileSync(UT, s); console.log('Skrev ' + UT); }
  else {
    const ok = fs.existsSync(UT) && fs.readFileSync(UT, 'utf8') === s;
    console.log((ok ? 'PASS' : 'FAIL') + ' rollback_t4a.sql är aktuell mot kedjan utan T4-A');
    if (!ok) process.exitCode = 1;
  }
}
module.exports = { sql, UT, paketFiler, NYA, ERSATTA, SIGNATURBYTE };
