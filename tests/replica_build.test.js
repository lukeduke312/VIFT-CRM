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
const { byggReplik, serverRot } = require('./local/lib/replik');
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
const t4 = require('./local/t4-andringar.json').objekt;
/* T4-A: T3-registret prövas på kedjan UTAN T4 (läget efter T3-E); hela kedjan prövas nedan. */
const T4_FILER = fs.readFileSync(path.join(serverRot(), 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/))
  .filter((p) => /^\d{14}$/.test(p[0]) && /_t4[a-z]_/.test(p[1] || '')).map((p) => p[1]);
const rt = byggReplik({ data: false, utelamna: T4_FILER });
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

// ── T4-A: hela repokedjan = STAGING-facit + T3-registret + exakt de registrerade T4-ändringarna
//    (tests/local/t4-andringar.json, md5-kontrollerade, relativt läget efter T3-E). ──
const rt4 = byggReplik({ data: false });
try {
  const nya = rt4.steg.filter((x) => x.ny).map((x) => x.rel);
  /* T4-A, tilläggsdel notiser: 20261128000010 direkt efter T4-A (samma serveromgång). T4-B: 20261128000011 direkt efter. */
  ok(nya.length === 11 && /^migrations\/20261128000009_t4a_/.test(nya[8]) && /^migrations\/20261128000010_t4a_notiser/.test(nya[9]) && /^migrations\/20261128000011_t4b_/.test(nya[10]),
    'repokedjan: T4-A-migrationen (20261128000009) efter T3-E, notisdelen (20261128000010) efter T4-A och T4-B (20261128000011) sist i samma serveromgång (' + nya.slice(8).join(', ') + ')');
  ok(rt4.rapport.oforklarade === 0, `hela repokedjan (T3-B–T3-E + T4-A + notiser + T4-B) mot STAGING-facit: ${rt4.rapport.identiska} identiska, ${rt4.rapport.forklarade} förklarade, 0 oförklarade`);
  const t4Forklarade = (rt4.rapport.rapport || []).filter((x) => x.kategori === 'FÖRKLARAD' && /^T4-(A(-notiser)?|B) /.test(x.forklaring)).map((x) => x.typ + ':' + x.key).sort();
  ok(JSON.stringify(t4Forklarade) === JSON.stringify(Object.keys(t4).sort()), `varje T4-A-, notis- och T4-B-objekt (${Object.keys(t4).length}) syns i kedjan med registrerad md5, och inga andra avvikelser`, t4Forklarade.length);
  ok(Object.values(t4).filter((v) => v.paket === 'T4-A-notiser').length === 7,
    'notisdelen: 7 objekt med notisdelen som senaste paket (4 nya funktioner, _store_direct_write_guard och de två vitlistepolicyerna ändrade efter T3-C); vift_store_full_access och vift_store_project ändras igen av T4-B (md5_t4an)');
  /* T4-B: 24 nya funktioner (20 regelfunktioner _vift_t4b_*, 3 material-RPC:er, time_entry_correct) och 10 ersatta med samma
     signatur; de som T4-A/notisdelen redan ändrat bär md5_t4an (läget före T4-B) och md5_t4a (T4-A-läget). */
  const t4b = Object.values(t4).filter((v) => v.paket === 'T4-B');
  ok(t4b.length === 34 && t4b.filter((v) => v.andring === 'NY').length === 24 && Object.values(t4).filter((v) => v.md5_t4an).length === 4,
    'T4-B: 34 registrerade objekt (24 nya, 10 ersatta med samma signatur; work_order_patch, _vift_ej_verkstallda, vift_store_full_access och vift_store_project bär md5_t4an)', [t4b.length, Object.values(t4).filter((v) => v.md5_t4an).length]);
  const t3Kvar = (rt4.rapport.rapport || []).filter((x) => x.kategori === 'FÖRKLARAD' && /^T3-[BCDE] /.test(x.forklaring)).map((x) => x.typ + ':' + x.key).sort();
  const t3Ovrigt = Object.keys(t3).filter((k) => !t4[k]).sort();
  ok(JSON.stringify(t3Kvar) === JSON.stringify(t3Ovrigt), `T3-objekt som T4-A och notisdelen inte rör (${t3Ovrigt.length}) har oförändrad T3-md5 i hela kedjan; ${Object.keys(t3).length - t3Ovrigt.length} ändras av T4`, t3Kvar.length);
  const t4sec = q(rt4.db, `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like '\\_vift\\_t4a\\_%' or p.proname like '\\_vift\\_notis\\_%' or p.proname like '\\_vift\\_t4b\\_%' or p.proname in ('work_order_material_add','work_order_material_update','work_order_material_remove','time_entry_correct','time_entry_create','time_entry_patch','time_entry_soft_delete','store_write_stamp_status','invoice_append_checked','invoice_set_status','vift_store_project','store_business_key_write','store_business_key_merge_write','work_order_patch','_vift_role_perms','_vift_auth_staff','_vift_ej_verkstallda','notification_append','notifications_mark_read','_store_direct_write_guard')) and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
  ok(t4sec.length === 0, 'T4-A, notisdelen och T4-B: inga nya eller ändrade funktioner körbara för anon eller authenticated (bara service_role; RLS-hjälparna vift_store_full_access och vift_caller_perms som förut)', t4sec);
  const hj = q(rt4.db, `select p.proname as name from pg_proc p where p.proname in ('vift_store_full_access','vift_caller_perms') and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')`);
  ok(hj.length === 2, 'T4-A: RLS-hjälparna vift_store_full_access och vift_caller_perms körbara för authenticated (inte anon), som före T4-A');
} finally { rt4.stang(); }
avsluta();
