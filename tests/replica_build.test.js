'use strict';
/*
 * T3-0 `replica_build` (SAKERHETSPROVNING-TESTPLAN §3.2–3.3, SEC-REST-03/04):
 * den lokala STAGING-replikan byggs från repots migrationskedja och jämförs mot
 * STAGING-facit (inventeringen 2026-11-25/26): funktionsdefinitioner (md5 av
 * pg_get_functiondef) och EXECUTE-ACL, policylistan, triggers, tabeller, buckets.
 * Dessutom: inga SECURITY DEFINER-funktioner körbara för anon, och för authenticated
 * bara de två RLS-hjälparna; syntetiska data laddade; inga STAGING-/LIVE-adresser.
 * Lokalt verifierat (PostgreSQL 16). STAGING kör 17.6 — PG17-körning är releasevillkor.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ok, krav, avsluta } = require('./local/lib/test');
krav();
const { byggReplik } = require('./local/lib/replik');
const { q, val, asUser } = require('./local/lib/db');
const facit = require('./local/staging-schema-facit-2026-11-25.json');
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

// STAGING-baslinjen: kedjan utan de nya (ej installerade) T3-migrationerna. Hela repokedjan
// med T3-B kontrolleras sist i filen mot tests/local/t3-andringar.json.
const r = byggReplik({ stagingBaslinje: true });
const db = r.db;
ok(r.steg.length === 45, 'STAGING-kedjan i MIGRATIONSORDNING.txt: 45 filer körda utan fel (utan nya T3-migrationer)');
ok(r.rapport.kod === 0 && r.rapport.oforklarade === 0, `schemajämförelse mot STAGING-facit: ${r.rapport.identiska} identiska, ${r.rapport.forklarade} förklarade, ${r.rapport.oforklarade} oförklarade`);

// Funktioner: md5 per definition mot facit
const lok = q(db, `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, md5(pg_get_functiondef(p.oid)) as md5, p.prosecdef as secdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f','p')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
const lokMap = new Map(lok.map((f) => [f.name + '(' + f.args + ')', f]));
let exakt = 0, sammaKod = [], saknas = [];
const kanda = require('./local/kanda-avvikelser.json');
for (const f of facit.functions) {
  const l = lokMap.get(f.name + '(' + f.args + ')');
  if (!l) { saknas.push(f.name); continue; }
  if (l.md5 === md5(f.def)) exakt++; else sammaKod.push(f.name);
}
ok(facit.functions.length === 64, 'facit har 64 funktioner');
ok(exakt === 58 && sammaKod.length === 5 && saknas.length === 1 && saknas[0] === 'e2e_purge_offer_artifacts', `md5 exakt för ${exakt}/64; ${sammaKod.length} samma kod med andra kommentarer (${sammaKod.join(', ')}); saknas: ${saknas.join(', ')} (STAGING-only)`);
ok(lok.length === 63 && lok.every((f) => facit.functions.some((x) => x.name === f.name && x.args === f.args)), 'inga extra funktioner lokalt (63 = 64 − STAGING-only)');

// Variant med STAGING-only-migrationerna på sin plats: 64/64
const rs = byggReplik({ stagingOnly: true, stagingBaslinje: true, data: false });
const lok2 = q(rs.db, `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, md5(pg_get_functiondef(p.oid)) as md5 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f','p') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
const e2e = facit.functions.find((f) => f.name === 'e2e_purge_offer_artifacts');
ok(rs.steg.length === 47 && lok2.length === 64 && lok2.some((f) => f.name === e2e.name && f.md5 === md5(e2e.def)), 'STAGING-variant (med 2 STAGING-only-migrationer, 47 steg): 64 funktioner, e2e_purge_offer_artifacts md5-exakt');
ok(q(rs.db, `select 1 from pg_namespace where nspname = 'vift_staging_backup_20261117'`).length === 1, 'STAGING-variant: backupschemat vift_staging_backup_20261117 skapas (STAGING-only, aldrig LIVE)');
rs.stang();

// Policyer
const pol = q(db, `select schemaname || '.' || tablename || '.' || policyname as id, permissive from pg_policies where schemaname in ('public','storage')`);
const facitPol = facit.policies.map((p) => p.schemaname + '.' + p.tablename + '.' + p.policyname).sort();
ok(JSON.stringify(pol.map((p) => p.id).sort()) === JSON.stringify(facitPol), `policylistan = inventeringen (${facitPol.length} policyer)`);
const restr = (lista) => lista.filter((p) => p.permissive === 'RESTRICTIVE' && p.id.startsWith('public.store.')).map((p) => p.id).sort();
const facitRestr = restr(facit.policies.map((p) => ({ id: p.schemaname + '.' + p.tablename + '.' + p.policyname, permissive: p.permissive })));
ok(facitRestr.length === 21 && JSON.stringify(restr(pol)) === JSON.stringify(facitRestr), 'RESTRICTIVE-policyer på public.store = STAGING (21 st., varav 14 ur R-D)');
// Triggers
const trg = q(db, `select c.relname || '.' || t.tgname as id from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname = 'public'`).map((x) => x.id).sort();
ok(JSON.stringify(trg) === JSON.stringify(facit.triggers.map((t) => t.table + '.' + t.name).sort()), 'triggers i public = inventeringen (' + trg.join(', ') + ')');

// Grants (SEC-REST-03/04)
const exe = q(db, `select p.proname as name, p.prosecdef as secdef, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`);
const secAnon = exe.filter((f) => f.secdef && f.anon).map((f) => f.name);
const secAuth = exe.filter((f) => f.secdef && f.auth).map((f) => f.name).sort();
ok(secAnon.length === 0, 'inga SECURITY DEFINER-funktioner körbara för anon', secAnon);
ok(JSON.stringify(secAuth) === JSON.stringify(['vift_caller_perms', 'vift_store_full_access']), 'authenticated får köra exakt de två RLS-hjälparna bland SECURITY DEFINER-funktionerna', secAuth);
const ickeSec = exe.filter((f) => !f.secdef && (f.anon || f.auth)).map((f) => f.name).sort();
ok(JSON.stringify(ickeSec) === JSON.stringify(['_invoice_calc_financial', '_invoice_financial_check', '_protect_critical_store_keys', '_protect_notifications_and_legacy_keys', '_rondering_recompute_summary', '_staging_business_key_required_perm']),
  'hjälpfunktioner utan SECURITY DEFINER med EXECUTE för anon/authenticated = som i STAGING (Supabase default privileges)', ickeSec);
ok(['provision_vift_user', 'deactivate_vift_user', 'check_app_users_health'].every((n) => !exe.find((f) => f.name === n).anon && !exe.find((f) => f.name === n).auth), 'R-E: anon/authenticated saknar EXECUTE på provision_vift_user, deactivate_vift_user, check_app_users_health');
const rls = q(db, `select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`).map((x) => x.relname);
ok(rls.length === 0, 'RLS påslaget på alla tabeller i public', rls);
ok(asUser(db, null, 'select key from public.store').status === 401, 'anon: ingen åtkomst till store (42501)');

// Syntetiska data
const d = r.data;
ok(q(db, 'select count(*)::int as n from auth.users')[0].n === d.anvandare.length + 2 && q(db, 'select count(*)::int as n from app_users')[0].n === d.anvandare.length + 1, `auth.users (${d.anvandare.length + 2}) och app_users (${d.anvandare.length + 1}) laddade`);
ok(val(db, 'vift_roles').length === 10 && ['admin', 'chef', 'ekonomi', 'personal', 'begransad'].every((id) => val(db, 'vift_roles').some((x) => x.id === id)), 'roller: fem standardroller + fem egna');
const wos = val(db, 'vift_workOrders');
ok(['pool', 'nytt', 'planerad', 'pågående', 'klar', 'fakturerad', 'avbruten'].every((st) => wos.some((a) => a.status === st)) && wos.some((a) => a.archived) && wos.some((a) => a.deleted), 'AO i alla statusar inkl. arkiverade och borttagna');
ok(['AO-P1', 'AO-P2', 'AO-P3', 'AO-P4', 'AO-P5', 'AO-N1', 'AO-N2', 'AO-SI1'].every((id) => wos.some((a) => a.id === id)), 'pooltestdata P1–P5, N1, N2, SI1 (BEHORIGHETSMATRIS §5.3)');
ok(val(db, 'vift_customers').some((c) => c.type === 'privat' && /^\d{8}-\d{4}$/.test(c.personnr)), 'privatkund med (påhittat) personnummer');
ok(val(db, 'vift_propertyObjects').every((o) => o.doorCode) && q(db, 'select count(*)::int as n from property_sensitive_access')[0].n === 2, 'portkoder både i blob och i property_sensitive_access');
ok(val(db, 'vift_offers').some((o) => o.publicToken && o.publicToken.length === 64), 'offert med publik token');
ok(['vift_timeEntries', 'vift_activities', 'vift_activityLog', 'vift_invoices'].every((k) => (val(db, k) || []).length > 0), 'tidposter, uppgifter, aktivitetslogg och fakturaunderlag finns');

// Inga STAGING-/LIVE-adresser eller hemligheter i replikans källfiler
const lib = path.join(__dirname, 'local', 'lib');
const txt = fs.readdirSync(lib).map((f) => fs.readFileSync(path.join(lib, f), 'utf8')).join('\n');
ok(!/hjplzjsbbowiyoyhdghc\.supabase\.co|yyzljlqyzzcbxmcdbual\.supabase\.co|staging-crm\.viftfast|crm\.viftfast\.se|eyJhbGci|sk_live|service_role_key\s*[:=]\s*['"][A-Za-z0-9]/.test(txt), 'testverktygen innehåller inga STAGING/LIVE-adresser, JWT:er eller nycklar');
ok(!/@(?!example\.test)[a-z0-9.-]+\.(se|com|nu)\b/i.test(JSON.stringify(d.store)), 'syntetiska data använder bara @example.test-adresser');

r.stang();

// ── T3-B/T3-C/T3-D: hela repokedjan (STAGING + nya migrationer) = STAGING-facit + exakt de
//    registrerade T3-ändringarna (tests/local/t3-andringar.json, md5-kontrollerade). ──
const t3 = require('./local/t3-andringar.json').objekt;
const rt = byggReplik({ data: false });
try {
  const nya = rt.steg.filter((x) => x.ny).map((x) => x.rel);
  ok(nya.length === 8 && nya.slice(0, 3).every((x) => /^migrations\/20261128\d{6}_t3b_/.test(x)) && nya.slice(3, 5).every((x) => /^migrations\/20261128\d{6}_t3c_/.test(x))
    && nya.slice(5, 7).every((x) => /^migrations\/20261128\d{6}_t3d_/.test(x)) && /^migrations\/20261128000008_t3e_/.test(nya[7]),
    'repokedjan: 3 nya T3-B-, 2 nya T3-C-, 2 nya T3-D- och 1 ny T3-E-migration efter STAGING:s senaste version, i den ordningen (' + nya.join(', ') + ')');
  ok(rt.rapport.oforklarade === 0, `repokedjan med T3-B och T3-C mot STAGING-facit: ${rt.rapport.identiska} identiska, ${rt.rapport.forklarade} förklarade, 0 oförklarade`);
  const t3Forklarade = (rt.rapport.rapport || []).filter((x) => x.kategori === 'FÖRKLARAD' && /^T3-[BCDE] /.test(x.forklaring)).map((x) => x.typ + ':' + x.key).sort();
  ok(JSON.stringify(t3Forklarade) === JSON.stringify(Object.keys(t3).sort()), `varje T3-B/T3-C/T3-D/T3-E-objekt (${Object.keys(t3).length}) syns i kedjan med registrerad md5 (funktioner, policyer och triggers), och inga andra avvikelser`, t3Forklarade.length);
  ok(Object.values(t3).filter((v) => v.paket === 'T3-C' || v.aven === 'T3-C').length === 22, 'T3-C: 22 registrerade objekt (19 funktioner varav 2 ersatta signaturer, 2 policyer, 1 trigger; 2 av dem ändras igen av T3-D)');
  ok(Object.values(t3).filter((v) => v.paket === 'T3-D' || v.aven === 'T3-D').length === 13 && Object.values(t3).filter((v) => v.aven === 'T3-C').length === 2,
    'T3-D: 13 registrerade objekt (9 nya hjälpfunktioner, activity_log_append ersatt av ny signatur, vift_store_full_access och vift_store_project ändrade igen; _vift_staff_external ändras igen av T3-E)');
  ok(Object.values(t3).filter((v) => v.paket === 'T3-E').length === 2 && t3['funktion:_vift_ej_verkstallda()'] && t3['funktion:_vift_staff_external(p_perms text[])'].aven === 'T3-D',
    'T3-E: 2 registrerade objekt (_vift_ej_verkstallda ny, _vift_staff_external ändrad igen; inga data, rollregistret orört)');
  const t3sec = q(rt.db, `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like '\\_vift\\_%' or p.proname in ('work_order_pool_take','work_order_billing_set','_store_direct_write_guard','vift_store_project','store_read_all_with_hashes_projected','store_business_key_write','store_business_key_merge_write','deactivate_vift_user','provision_vift_user','activity_log_append')) and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
  ok(t3sec.length === 0, 'T3-B/T3-C/T3-D/T3-E: inga nya eller ändrade funktioner körbara för anon eller authenticated (bara service_role)', t3sec);
} finally { rt.stang(); }
avsluta();
