'use strict';
/*
 * T3-C: genererar supabase/rollback/T3-C/rollback_t3c.sql ur STAGING-facit
 * (tests/local/staging-schema-facit-2026-11-25.json, exakta STAGING-definitioner).
 *
 *   node tests/local/t3c-rollback.js           verifierar att filen är aktuell
 *   node tests/local/t3c-rollback.js --skriv   skriver filen
 *
 * Rollbacken tar bort F18-vitlistan (trigger, policyer, triggerfunktion), återställer de
 * ersatta funktionerna EXAKT till STAGING-versionen (med samma rättigheter), återskapar de
 * gamla signaturerna för projektionen och tar bort T3-C:s nya hjälpfunktioner. Den rör ingen
 * data: personal- och rollregistret, app_users och store är oförändrade. Körs FÖRE en
 * eventuell T3-B-rollback (omvänd installationsordning) och EFTER att store-key-write
 * återställts till föregående version (den nya EF:en anropar 3-argumentssignaturen).
 */
const fs = require('fs');
const path = require('path');
const facit = require('./staging-schema-facit-2026-11-25.json');
const UT = path.resolve(__dirname, '..', '..', 'supabase', 'rollback', 'T3-C', 'rollback_t3c.sql');

/* [namn, args (som i facit), typer] — återställs med CREATE OR REPLACE (samma signatur). */
const ERSATTA = [
  ['store_business_key_write', 'p_key text, p_new_value jsonb, p_expected_hash text, p_caller_authorized boolean, p_actor_id text', 'text,jsonb,text,boolean,text'],
  ['store_business_key_merge_write', 'p_key text, p_upserts jsonb, p_removals jsonb, p_caller_authorized boolean, p_actor_id text', 'text,jsonb,jsonb,boolean,text'],
  ['deactivate_vift_user', 'p_user_id uuid', 'uuid'],
  ['provision_vift_user', 'p_user_id uuid, p_staff_id text, p_role_id text, p_is_admin boolean', 'uuid,text,text,boolean'],
  ['vift_store_full_access', 'p_key text, p_perms text[]', 'text,text[]'],
];
/* Ersatta av en ny signatur: den nya tas bort och den gamla återskapas exakt. */
const NY_SIGNATUR = [
  ['vift_store_project', 'p_key text, p_value jsonb, p_perms text[]', 'text,jsonb,text[]', 'public.vift_store_project(text,jsonb,text[],text)'],
  ['store_read_all_with_hashes_projected', 'p_business_keys text[], p_perms text[]', 'text[],text[]', 'public.store_read_all_with_hashes_projected(text[],text[],text)'],
];
const NYA = ['public._vift_authz_check(text,jsonb,jsonb,jsonb,jsonb,text)', 'public._vift_superadmin_lock()', 'public._vift_superadmin_count(jsonb,jsonb)',
  'public._vift_identity_perms(jsonb,jsonb)', 'public._vift_role_perms(jsonb,text)', 'public._vift_rec_active(jsonb)', 'public._vift_reg_bad_count(jsonb)',
  'public._vift_reg_get(jsonb,text)', 'public._vift_perms_beyond(text[],text[],text[])'];

/* EXECUTE-rättigheter ur facit (proacl), t.ex. {postgres=X/postgres,service_role=X/postgres}. */
function grants(f, typer) {
  const roller = String(f.acl || '').replace(/^\{|\}$/g, '').split(',').map((x) => x.split('=')[0]).filter((r) => r && r !== 'postgres');
  return [`revoke all on function public.${f.name}(${typer}) from public, anon, authenticated, service_role;`]
    .concat(roller.map((r) => `grant execute on function public.${f.name}(${typer}) to ${r};`));
}
function hitta(namn, args) {
  const f = facit.functions.find((x) => x.name === namn && x.args === args);
  if (!f) throw new Error('saknas i facit: ' + namn + '(' + args + ')');
  return f;
}

function sql() {
  const d = ['-- ============================================================',
    '-- ROLLBACK T3-C (genererad av tests/local/t3c-rollback.js ur STAGING-facit 2026-11-25).',
    '-- Tar bort F18-vitlistan (trigger, policyer, triggerfunktion), återställer de funktioner som',
    '-- T3-C ersatte EXAKT till STAGING-versionen och tar bort T3-C:s nya funktioner.',
    '-- Rör INGEN data (store, app_users). Körs i en transaktion. Ordning vid rollback:',
    '--   1) store-key-write till föregående version (EF-backup), 2) denna fil,',
    '--   3) föregående klientpaket, 4) vid behov T3-B-rollbacken (omvänd installationsordning).',
    '-- ============================================================', 'begin;', ''];
  d.push('-- 1. F18: vitlistan för direkt REST-skrivning bort (STAGING:s tidigare policyer gäller igen).');
  d.push('drop trigger if exists protect_direct_write_allowlist on public.store;');
  d.push('drop policy if exists "store_direct_write_allowlist_insert" on public.store;');
  d.push('drop policy if exists "store_direct_write_allowlist_update" on public.store;');
  d.push('drop function if exists public._store_direct_write_guard();', '');
  d.push('-- 2. Projektionen: nya signaturer bort, STAGING-signaturerna tillbaka (exakt text ur facit).');
  for (const [, , , ny] of NY_SIGNATUR) d.push(`drop function if exists ${ny};`);
  for (const [namn, args, typer] of NY_SIGNATUR) {
    const f = hitta(namn, args);
    d.push(`-- ${namn}(${typer})`, f.def.replace(/\s*$/, '') + ';', ...grants(f, typer), '');
  }
  d.push('-- 3. Ersatta funktioner (samma signatur) tillbaka till STAGING-definitionen.');
  for (const [namn, args, typer] of ERSATTA) {
    const f = hitta(namn, args);
    d.push(`-- ${namn}(${typer})`, f.def.replace(/\s*$/, '') + ';', ...grants(f, typer), '');
  }
  d.push('-- 4. T3-C:s nya hjälpfunktioner bort (efter att inget längre anropar dem).');
  NYA.forEach((f) => d.push(`drop function if exists ${f};`));
  d.push('', 'commit;', '');
  return d.join('\n');
}

const s = sql();
if (require.main === module) {
  if (process.argv.includes('--skriv')) { fs.mkdirSync(path.dirname(UT), { recursive: true }); fs.writeFileSync(UT, s); console.log('Skrev ' + UT); }
  else {
    const ok = fs.existsSync(UT) && fs.readFileSync(UT, 'utf8') === s;
    console.log((ok ? 'PASS' : 'FAIL') + ' rollback_t3c.sql är aktuell mot facit');
    if (!ok) process.exitCode = 1;
  }
}
module.exports = { sql, UT };
