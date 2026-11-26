'use strict';
/*
 * T4-A, tilläggsdel notiser: genererar supabase/rollback/T4-A-notiser/rollback_t4a_notiser.sql.
 *
 *   node tests/local/t4a-notiser-rollback.js           verifierar att filen är aktuell
 *   node tests/local/t4a-notiser-rollback.js --skriv   skriver filen
 *
 * "Föregående" definition är läget EFTER T4-A (20261128000009). Den läses ur en lokal kedja UTAN
 * notismigrationen (pg_get_functiondef + EXECUTE-rättigheter, pg_policies). Rollbacken:
 *   1. återställer vift_store_full_access, vift_store_project och _store_direct_write_guard exakt;
 *   2. återställer T3-C:s vitlistepolicyer (USING/WITH CHECK) exakt;
 *   3. tar bort notification_append, notifications_mark_read och hjälpfunktionerna.
 * Den rör ingen data (notiser som skapats via den nya vägen ligger kvar och är giltiga för den äldre
 * koden). Körs FÖRE T4-A:s rollback (omvänd installationsordning) och EFTER att föregående
 * store-key-write (utan appendNotification) och föregående klientpaket har installerats.
 */
const fs = require('fs');
const path = require('path');
const UT = path.resolve(__dirname, '..', '..', 'supabase', 'rollback', 'T4-A-notiser', 'rollback_t4a_notiser.sql');
const ERSATTA = ['vift_store_full_access(text,text[])', 'vift_store_project(text,jsonb,text[],text)', '_store_direct_write_guard()'];
const POLICYER = ['store_direct_write_allowlist_insert', 'store_direct_write_allowlist_update'];
const NYA = ['notification_append(text,jsonb,text,integer)', 'notifications_mark_read(text,jsonb,boolean)',
  '_vift_notis_projicera(jsonb,text)', '_vift_notis_kategori(text)'];
const FIL = 'migrations/20261128000010_t4a_notiser.sql';

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
    const ut = { f: {}, p: {} };
    for (const sig of ERSATTA) {
      ut.f[sig] = q(r.db, `select pg_get_functiondef('public.${sig}'::regprocedure) as def, coalesce((select proacl::text from pg_proc where oid = 'public.${sig}'::regprocedure), 'NULL') as acl`)[0];
    }
    for (const p of POLICYER) ut.p[p] = q(r.db, `select qual, with_check from pg_policies where schemaname = 'public' and tablename = 'store' and policyname = '${p}'`)[0];
    return ut;
  } finally { r.stang(); }
}

function sql(fore) {
  fore = fore || lasForeDefinitioner();
  const d = ['-- ============================================================',
    '-- ROLLBACK T4-A, tilläggsdel NOTISER (genererad av tests/local/t4a-notiser-rollback.js ur en lokal',
    '-- kedja utan 20261128000010, dvs. läget efter T4-A).',
    '-- Återställer vift_store_full_access, vift_store_project, _store_direct_write_guard och T3-C:s',
    '-- vitlistepolicyer EXAKT och tar bort notification_append, notifications_mark_read och',
    '-- hjälpfunktionerna. Rör INGEN data (notiser skapade efter installationen ligger kvar).',
    '-- Ordning vid rollback: 1) T4-B:s rollback (om installerad), 2) föregående store-key-write',
    '--   (utan appendNotification) och föregående klientpaket (persistNotifs via REST), 3) denna fil,',
    '--   4) T4-A:s rollback, 5) vid behov T3-E-, T3-D-, T3-C- och T3-B-rollbacken (omvänd ordning).',
    '-- ============================================================', 'begin;', ''];
  d.push('-- 1. Ersatta funktioner (samma signatur) tillbaka till definitionen efter T4-A.');
  for (const sig of ERSATTA) d.push(`-- ${sig}`, fore.f[sig].def.replace(/\s*$/, '') + ';', ...grants(sig, fore.f[sig].acl), '');
  d.push('-- 2. T3-C:s vitlista för direkt REST-skrivning tillbaka (vift_notifications, vift_lastChanged).');
  for (const p of POLICYER) {
    const x = fore.p[p];
    d.push(`alter policy "${p}" on public.store${x.qual ? ' using (' + x.qual + ')' : ''} with check (${x.with_check});`);
  }
  d.push('', '-- 3. Tilläggsdelens nya funktioner bort (efter att inget längre anropar dem).');
  NYA.forEach((f) => d.push(`drop function if exists public.${f};`));
  d.push('', 'commit;', '');
  return d.join('\n');
}

if (require.main === module) {
  const s = sql();
  if (process.argv.includes('--skriv')) { fs.mkdirSync(path.dirname(UT), { recursive: true }); fs.writeFileSync(UT, s); console.log('Skrev ' + UT); }
  else {
    const ok = fs.existsSync(UT) && fs.readFileSync(UT, 'utf8') === s;
    console.log((ok ? 'PASS' : 'FAIL') + ' rollback_t4a_notiser.sql är aktuell mot kedjan utan notismigrationen');
    if (!ok) process.exitCode = 1;
  }
}
module.exports = { sql, UT, ERSATTA, POLICYER, NYA, FIL };
