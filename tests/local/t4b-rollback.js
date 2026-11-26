'use strict';
/*
 * T4-B: genererar supabase/rollback/T4-B/rollback_t4b.sql.
 *
 *   node tests/local/t4b-rollback.js           verifierar att filen är aktuell
 *   node tests/local/t4b-rollback.js --skriv   skriver filen
 *
 * "Föregående" definition är läget EFTER T4-A + notisdelen (20261128000010). Den läses ur en lokal
 * kedja UTAN T4-B-migrationen (pg_get_functiondef + EXECUTE-rättigheter). Rollbacken:
 *   1. återställer de tio ersatta funktionerna exakt (samma signatur);
 *   2. tar bort T4-B:s nya funktioner (radvisa material-RPC:er, time_entry_correct, _vift_t4b_*).
 * Den rör ingen data: materialrader med de nya fälten (sellPriceUnknown, buyPriceUnknown, priceSource,
 * performedDate, extra, updatedBy) och tidposter med hourRate null/hourRateUnknown/corrections ligger
 * kvar och är giltiga för den äldre koden (extra fält ignoreras; ett okänt pris (null) tolkas av den
 * äldre klienten som "saknar pris", aldrig som ett belopp). Körs FÖRST av T4-rollbackerna (före
 * notisdelens och T4-A:s), och EFTER att föregående EF-versioner (ao-time-write, time-entries-list,
 * invoice-write, work-orders-list, _shared/vift-auth.ts) och föregående klientpaket installerats.
 */
const fs = require('fs');
const path = require('path');
const UT = path.resolve(__dirname, '..', '..', 'supabase', 'rollback', 'T4-B', 'rollback_t4b.sql');
const ERSATTA = ['vift_store_full_access(text,text[])', 'vift_store_project(text,jsonb,text[],text)', 'work_order_patch(text,jsonb,text,text,text,text[])',
  '_vift_ej_verkstallda()', 'time_entry_create(jsonb,text,text,text,uuid,text[])', 'time_entry_patch(text,jsonb,text,text,text,boolean)',
  'time_entry_soft_delete(text,text,text,boolean)', 'store_write_stamp_status(uuid,boolean,bigint,text,bigint)',
  'invoice_append_checked(jsonb,text)', 'invoice_set_status(text,text,bigint,text)'];
const NYA = ['work_order_material_add(text,jsonb,text,text,text[])', 'work_order_material_update(text,text,jsonb,text,text,text,text[])',
  'work_order_material_remove(text,text,text,text,text,text[])', 'time_entry_correct(text,jsonb,text,text,text,text,text[])',
  '_vift_t4b_rad_kontroll(jsonb,jsonb,text[],text,jsonb)', '_vift_t4b_material_lista(jsonb,jsonb,text[],text,text,jsonb)',
  '_vift_t4b_ny_rad(jsonb,jsonb,text[],text,text,text)', '_vift_t4b_faktura_pris_kontroll(jsonb)', '_vift_t4b_faktura_kallor(jsonb,jsonb,jsonb,jsonb)',
  '_vift_t4b_kallrad(text,jsonb,jsonb)', '_vift_t4b_rad_kant(jsonb,text,text)', '_vift_t4b_anspraak(jsonb)', '_vift_t4b_kalla_status(jsonb,text)',
  '_vift_t4b_pris(text,text,jsonb)', '_vift_t4b_lage(jsonb)', '_vift_t4b_tid_last(jsonb)', '_vift_t4b_datum_ok(text)', '_vift_t4b_idag()',
  '_vift_t4b_tal(jsonb)', '_vift_t4b_kontor(text[])', '_vift_t4b_tillagg_satta(text[])', '_vift_t4b_inkop_satta(text[])',
  '_vift_t4b_pris_satta(text[])', '_vift_t4b_pris_las(text[])'];
const FIL = 'migrations/20261128000011_t4b_material_priser_tid.sql';

function grants(sig, acl) {
  const roller = String(acl || '').replace(/^\{|\}$/g, '').split(',').map((x) => x.split('=')[0]).filter((r) => r && r !== 'postgres');
  return [`revoke all on function public.${sig} from public, anon, authenticated, service_role;`]
    .concat(roller.map((r) => `grant execute on function public.${sig} to ${r};`));
}

function lasForeDefinitioner() {
  if (!process.env.PGHOST) process.env.PGHOST = '/var/tmp/vift-localpg';
  if (!process.env.PGUSER) process.env.PGUSER = 'postgres';
  const { byggReplik } = require('./lib/replik');
  const { q } = require('./lib/db');
  const r = byggReplik({ utelamna: [FIL], data: false, schemakontroll: false });
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
    '-- ROLLBACK T4-B (genererad av tests/local/t4b-rollback.js ur en lokal kedja utan',
    '-- 20261128000011, dvs. läget efter T4-A + notisdelen).',
    '-- Återställer de tio ersatta funktionerna EXAKT och tar bort T4-B:s nya funktioner',
    '-- (work_order_material_*, time_entry_correct, _vift_t4b_*). Rör INGEN data: materialrader och',
    '-- tidposter skrivna med den nya vägen ligger kvar och är giltiga för den äldre koden.',
    '-- Ordning vid rollback: 1) föregående EF-versioner (ao-time-write, time-entries-list, invoice-write,',
    '--   work-orders-list, _shared/vift-auth.ts) och föregående klientpaket, 2) denna fil, 3) notisdelens',
    '--   rollback, 4) T4-A:s rollback, 5) vid behov T3-E-, T3-D-, T3-C- och T3-B-rollbacken (omvänd ordning).',
    '-- ============================================================', 'begin;', ''];
  d.push('-- 1. Ersatta funktioner (samma signatur) tillbaka till definitionen efter T4-A + notisdelen.');
  for (const sig of ERSATTA) d.push(`-- ${sig}`, fore[sig].def.replace(/\s*$/, '') + ';', ...grants(sig, fore[sig].acl), '');
  d.push('-- 2. T4-B:s nya funktioner bort (efter att inget längre anropar dem).');
  NYA.forEach((f) => d.push(`drop function if exists public.${f};`));
  d.push('', 'commit;', '');
  return d.join('\n');
}

if (require.main === module) {
  const s = sql();
  if (process.argv.includes('--skriv')) { fs.mkdirSync(path.dirname(UT), { recursive: true }); fs.writeFileSync(UT, s); console.log('Skrev ' + UT); }
  else {
    const ok = fs.existsSync(UT) && fs.readFileSync(UT, 'utf8') === s;
    console.log((ok ? 'PASS' : 'FAIL') + ' rollback_t4b.sql är aktuell mot kedjan utan T4-B-migrationen');
    if (!ok) process.exitCode = 1;
  }
}
module.exports = { sql, UT, ERSATTA, NYA, FIL };
