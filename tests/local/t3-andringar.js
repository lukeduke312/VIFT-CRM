'use strict';
/*
 * T3-B (2026-11-28): facit för de NYA, ännu inte installerade migrationerna (T3-B, T3-C, T3-D, T3-E).
 *
 *   node tests/local/t3-andringar.js           verifierar tests/local/t3-andringar.json
 *   node tests/local/t3-andringar.js --skriv   skriver om filen från en ny lokal kedja
 *
 * Bygger repokedjan (alla filer i MIGRATIONSORDNING.txt, även de nya) och jämför mot
 * STAGING-facit utan T3-filen. Varje objekt som avviker ska stå i t3-andringar.json med
 * paket, typ av ändring (NY/ÄNDRAD/BORTTAGEN), md5 för definitionen + ACL och en
 * beskrivning. jamfor-schema.js räknar dem som förklarade bara när md5 stämmer.
 * Ingen trafik till Supabase.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { byggReplik } = require('./lib/replik');
const { q } = require('./lib/db');

if (!process.env.PGHOST) process.env.PGHOST = '/var/tmp/vift-localpg';
if (!process.env.PGUSER) process.env.PGUSER = 'postgres';
const FIL = path.join(__dirname, 't3-andringar.json');
const md5 = (x) => crypto.createHash('md5').update(String(x == null ? '' : x)).digest('hex');
const aclSet = (a) => (a == null || a === 'NULL') ? 'DEFAULT' : String(a).replace(/^\{|\}$/g, '').split(',').filter(Boolean)
  .map((x) => x.replace(/^"|"$/g, '').replace(/=([a-zA-Z*]+)\//, (m, p) => '=' + p.replace(/m/g, '') + '/')).sort().join(',');

const BESKRIVNING = {
  _vift_has: 'Hjälpfunktion: behörighet eller all.',
  _vift_ao_eff_perms: 'Effektiva AO-behörigheter inkl. övergångsregeln (ao_complete utan ao_view_all/ao_edit i en äldre roll = ao_start_own + ao_complete_own + ao_pool_take).',
  _vift_ao_staff: 'Hjälpfunktion: AO:ns personal som jsonb-array.',
  _vift_ao_assigned: 'Hjälpfunktion: anroparen finns i AO:ns staff.',
  _vift_ao_locked: 'Låst AO (fakturerad/avbruten/arkiverad/borttagen/invoiceId) → 409 ao_locked.',
  _vift_ao_open_pool: 'Öppen pool (AP-A): status pool, poolOpen ≠ false, ingen personal, inte arkiverad/borttagen.',
  _vift_idem_lookup: 'Idempotens bunden till aktör + operation + innehåll (SÄK-12/F17).',
  _vift_staff_name: 'Hjälpfunktion: personalens namn.',
  _vift_staff_active: 'Hjälpfunktion: aktiv personalpost.',
  _vift_ao_take: 'Atomisk tagningsregel ur öppen pool (används under radlås).',
  _vift_ao_material_merge: 'Fältets materialpatch: bara egna rader får ändras/tas bort (D-19 delvis).',
  _vift_ao_billing_touched: 'Faktureringsfält i patch_ao (D-07/F21).',
  _vift_auth_staff: 'Personal och behörigheter för ett auth-id (samma regel som checkViftAuth).',
  _vift_ao_number_text: 'AO-nummer i visningsform, aldrig avkortat (punkt 245).',
  work_order_patch: 'Regelkontroll per anropare under radlås (SÄK-5, F21, SÄK-12, AP-G, tagning i v3.4-form).',
  work_order_pool_take: 'Ny: "Ta jobbet" atomiskt, exakt en vinner, 409 already_assigned (SÄK-4, AP-F).',
  work_order_billing_set: 'Ny: enda vägen att sätta/backa AO:s faktureringsstatus (D-07, punkt 269/G9).',
  work_order_checklist_set_state: 'Poolgrenen borttagen (öppen pool ger ingen skrivrätt), not_assigned, ao_locked.',
  work_order_log_append: 'Poolgrenen borttagen, not_assigned, ao_locked.',
  work_order_log_remove: 'Poolgrenen borttagen, not_assigned, ao_locked.',
  time_entry_create: 'Tilldelning under lås, ao_locked, serverpris från prisgrupp, legitim utstämpling, idempotens med fingeravtryck (SÄK-11, AP-B).',
  time_entry_patch: 'Byte av aoId kräver tilldelning och olåst AO.',
  store_write_stamp_status: 'Instämpling med aoId kräver tilldelning (eller ao_edit) och olåst AO (F23).',
  work_order_create: 'AO-nummer unikt även vid samtidighet, ingen avkortning, ingen unik index (punkt 245); pool + personal → poolOpen=false.',
};
/* T3-C (2026-11-28): roller och superadmin (SÄK-8, D-25, D-21, D-14) och F18 (SÄK-13). */
const T3C = {
  _vift_rec_active: 'Hjälpfunktion: personalpost aktiv (samma tolkning som vift_caller_perms).',
  _vift_role_perms: 'Rollens behörigheter: första rollen med id:t, bara om permissions är en lista (som checkViftAuth).',
  _vift_identity_perms: 'Behörigheter per aktiv inloggningsidentitet (app_users.active, e-post → första aktiva personalpost → roll).',
  _vift_superadmin_count: 'Antal aktiva användare med all (invarianten D-25).',
  _vift_superadmin_lock: 'Gemensamt lås för vift_staff + vift_roles + app_users i fast ordning (rådgivande lås, roles, staff).',
  _vift_reg_bad_count: 'Hjälpfunktion: element utan id eller med dubbla id i personal-/rollregistret.',
  _vift_reg_get: 'Hjälpfunktion: första elementet med id:t.',
  _vift_perms_beyond: 'Hjälpfunktion: behörigheter utöver tidigare och anroparens.',
  _vift_authz_check: 'Eskaleringsregeln (privilege_escalation, superadmin_required) och invarianten last_superadmin under låset (SÄK-8, D-25).',
  store_business_key_write: 'vift_staff/vift_roles: gemensamt lås + _vift_authz_check på slutvärdet (samma signatur).',
  store_business_key_merge_write: 'vift_staff/vift_roles: gemensamt lås + _vift_authz_check på det sammanslagna värdet (samma signatur).',
  deactivate_vift_user: 'Gemensamt lås och invarianten minst en aktiv superadmin (409 last_superadmin).',
  provision_vift_user: 'Gemensamt lås och invarianten minst en aktiv superadmin.',
  vift_store_full_access: 'vift_staff bara staff_manage/admin_manage, vift_roles bara admin_manage (REST-läsning stängd för övriga, D-21).',
  vift_store_project: 'Ny parameter p_caller_staff_id: egen roll ur vift_roles, andras permissions/role bort ur vift_staff (D-21, D-14). Den gamla 3-argumentsversionen ersatt.',
  store_read_all_with_hashes_projected: 'Ny parameter p_caller_staff_id som skickas till vift_store_project. Den gamla 2-argumentsversionen ersatt.',
  _store_direct_write_guard: 'F18: direkt REST-skrivning bara för vitlistan (vift_notifications, vift_lastChanged med servervärde); DELETE nekas; 42501 direct_write_blocked.',
  'public.store.store_direct_write_allowlist_insert': 'F18: RESTRICTIVE INSERT, vitlista i RLS.',
  'public.store.store_direct_write_allowlist_update': 'F18: RESTRICTIVE UPDATE, vitlista i RLS (WITH CHECK).',
  'store.protect_direct_write_allowlist': 'F18: trigger som verkställer vitlistan för authenticated/anon (BEFORE INSERT/UPDATE/DELETE).',
};
/* T3-D (2026-11-28): urval per post (SÄK-2, B4, Ö7, D-12–D-15) och aktivitetsloggen (D-22).
   Objekt som T3-C redan ändrat och T3-D ändrar igen registreras med paket T3-D (slutläget). */
const T3D = {
  _vift_ao_visible: 'T3-B:s poolregel i SQL (canViewWorkOrder): ao_view_all, eller ao_view_own + tilldelad / öppen pool med ao_pool_take.',
  _vift_ao_content_visible: 'Innehåll (historik, logg, kund/fastighet/kontakt, offertreferens): synlig och inte via öppen pool (Q3, K-03).',
  _vift_post_refs: 'Urvalsmängden per anropare: AO med innehåll och refererade kunder, fastigheter, objekt, offerter och personal.',
  _vift_kund_las: 'Roller som får läsa hela kund-/fastighetsregistret (skyddade fält borttagna); övriga urval per uppdrag (D-13).',
  _vift_staff_external: 'Extern användare (bara D-04:s tilläggsbehörigheter): bara namn och titel för personal på egna AO (D-14, SEC-B3-04).',
  _vift_task_ao: 'Uppgiftens AO-koppling (relatedType workOrder + relatedId, annars workOrderId).',
  _vift_activity_ao_type: 'AO-händelser i aktivitetsloggen som fältet får läsa för egna AO (B4).',
  _vift_activity_type_perms: 'Händelsetyper per behörighet i appendActivity (D-22, speglas i activity-log.ts TYPE_PERMS).',
  _vift_ref_visible: 'Referens i appendActivity måste gå att se för anroparen (D-22, ref_not_visible).',
  vift_store_full_access: 'T3-C + T3-D: vift_activityLog bara ao_view_all/admin_manage, vift_activities bara admin_manage eller ao_edit+ao_view_all (D-15), vift_properties kräver objects_sensitive, vift_propertyContacts som kunder (REST-läsning stängd för övriga).',
  vift_store_project: 'T3-C + T3-D: urval per post för aktivitetslogg, uppgifter, offertreferens, kunder/fastigheter/objekt/kontakter och personalens kontaktuppgifter; portkoder och nyckelinformation aldrig (D-12–D-15, B4, K-04).',
  activity_log_append: 'T3-D: ny signatur med anroparens id och behörigheter; typ (type_not_allowed) och referenser (ref_not_visible) under lås; servern sätter aktör och tid (D-22). Den gamla 2-argumentsversionen ersatt.',
};
/* T3-E (2026-11-28): ej verkställda behörigheter är verkningslösa (tillägget i BESLUT-2026-11-28).
   _vift_staff_external ändrades av T3-D och ändras igen av T3-E: registreras som T3-E (slutläget)
   med aven:'T3-D' och md5_t3d (T3-D-läget). */
const T3E = {
  _vift_ej_verkstallda: 'Register över behörigheter vars serverkontroller ännu inte finns (T4/AO-etappen); de räknas inte i någon regel.',
  _vift_staff_external: 'T3-D + T3-E: extern användare (bara D-04:s tilläggsbehörigheter); ej verkställda behörigheter räknas inte (ingen breddning, T3-E).',
};
const T3E_AVEN_T3D = new Set(['_vift_staff_external(p_perms text[])']);
/* Den gamla 3-argumentsversionen av vift_store_project togs bort av T3-C (inte T3-D). */
const T3D_EJ = new Set(['vift_store_project(p_key text, p_value jsonb, p_perms text[])']);
/* Objekt som T3-C ändrade och T3-D ändrar igen: registreras som T3-D (md5 = slutläget) med
   aven:'T3-C', så att T3-C:s rollbacktest räknar dem till T3-C:s objekt. */
const T3D_AVEN_T3C = new Set(['vift_store_full_access(p_key text, p_perms text[])', 'vift_store_project(p_key text, p_value jsonb, p_perms text[], p_caller_staff_id text)']);
const ws = (x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim();

/* T4-A: T3-registret beskriver läget efter T3-E; T4:s migrationer (som kräver T3-E) utesluts här och
   registreras i t4-andringar.json (tests/local/t4-andringar.js). */
const T4_FILER = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/))
  .filter((p) => /^\d{14}$/.test(p[0]) && /_t4[a-z]_/.test(p[1] || '')).map((p) => p[1]);
const r = byggReplik({ data: false, schemakontroll: false, utelamna: T4_FILER });
try {
  const ut = path.join(os.tmpdir(), 't3-andringar-' + process.pid + '.json');
  try { execFileSync('node', [path.join(__dirname, 'jamfor-schema.js'), r.db, ut], { env: Object.assign({}, process.env, { T3_IGNORERA: '1' }), stdio: 'pipe' }); } catch (e) { /* avvikelser ger exit 1 */ }
  const rap = JSON.parse(fs.readFileSync(ut, 'utf8')); fs.unlinkSync(ut);
  const lok = q(r.db, `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def, coalesce(p.proacl::text,'NULL') as acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')`);
  const pol = q(r.db, `select schemaname, tablename, policyname, permissive, roles::text as roles, cmd, qual, with_check from pg_policies where schemaname in ('public','storage')`);
  const trg = q(r.db, `select c.relname as "table", t.tgname as name, t.tgenabled as enabled, pg_get_triggerdef(t.oid) as def
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public'`);
  const defMd5 = (typ, key) => {
    if (typ === 'funktion') { const f = lok.find((y) => y.name + '(' + y.args + ')' === key); return f ? md5(f.def) + '|' + aclSet(f.acl) : 'saknas'; }
    if (typ === 'policy') { const p = pol.find((y) => y.schemaname + '.' + y.tablename + '.' + y.policyname === key); return p ? md5([p.permissive, p.roles, p.cmd, ws(p.qual), ws(p.with_check)].join('|')) : 'saknas'; }
    if (typ === 'trigger') { const t = trg.find((y) => y.table + '.' + y.name === key); return t ? md5(t.def + '|' + t.enabled) : 'saknas'; }
    return null;
  };
  const objekt = {};
  for (const x of rap.filter((y) => y.kategori === 'OFÖRKLARAD')) {
    const k = x.typ + ':' + x.key;
    const namn = x.key.replace(/\(.*$/, '');
    const ee = T3E[namn] || T3E[x.key];
    const dd = ee ? null : T3D_EJ.has(x.key) ? null : (T3D[namn] || T3D[x.key]);
    const c = T3C[namn] || T3C[x.key];
    objekt[k] = {
      paket: ee ? 'T3-E' : dd ? 'T3-D' : c ? 'T3-C' : 'T3-B',
      andring: x.status === 'EXTRA LOKALT' ? 'NY' : x.status === 'SAKNAS LOKALT' ? 'BORTTAGEN (ersatt av ny signatur)' : 'ÄNDRAD',
      md5: defMd5(x.typ, x.key),
      beskrivning: ee || dd || c || BESKRIVNING[namn] || '(beskrivning saknas)',
    };
    if (dd && T3D_AVEN_T3C.has(x.key)) objekt[k].aven = 'T3-C';
    if (ee && T3E_AVEN_T3D.has(x.key)) objekt[k].aven = 'T3-D';
  }
  /* T3-D: md5 i T3-C-läget (kedjan utan T3-D och T3-E) för objekt som båda paketen ändrar. */
  const paketRel = (re) => fs.readFileSync(path.join(r.rot, 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/))
    .filter((p) => /^\d{14}$/.test(p[0]) && re.test(p[1] || '')).map((p) => p[1]);
  /* T3-E: md5 i T3-D-läget (kedjan utan T3-E) för objekt som T3-D och T3-E båda ändrar. */
  const avenD = Object.keys(objekt).filter((k) => objekt[k].aven === 'T3-D');
  if (avenD.length) {
    const rd = byggReplik({ data: false, schemakontroll: false, utelamna: paketRel(/_t3e_|_t4[a-z]_/) });
    try {
      const lokD = q(rd.db, `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def, coalesce(p.proacl::text,'NULL') as acl
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')`);
      for (const k of avenD) {
        const key = k.replace(/^funktion:/, '');
        const f = lokD.find((y) => y.name + '(' + y.args + ')' === key);
        objekt[k].md5_t3d = f ? md5(f.def) + '|' + aclSet(f.acl) : 'saknas';
      }
    } finally { rd.stang(); }
  }
  const aven = Object.keys(objekt).filter((k) => objekt[k].aven === 'T3-C');
  if (aven.length) {
    const t3dRel = paketRel(/_t3[de]_|_t4[a-z]_/);
    const rc = byggReplik({ data: false, schemakontroll: false, utelamna: t3dRel });
    try {
      const lokC = q(rc.db, `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def, coalesce(p.proacl::text,'NULL') as acl
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')`);
      for (const k of aven) {
        const key = k.replace(/^funktion:/, '');
        const f = lokC.find((y) => y.name + '(' + y.args + ')' === key);
        objekt[k].md5_t3c = f ? md5(f.def) + '|' + aclSet(f.acl) : 'saknas';
      }
    } finally { rc.stang(); }
  }
  const sorterat = Object.fromEntries(Object.keys(objekt).sort().map((k) => [k, objekt[k]]));
  if (process.argv.includes('--skriv')) {
    fs.writeFileSync(FIL, JSON.stringify({ beskrivning: 'T3-B, T3-C, T3-D och T3-E (2026-11-28): objekt som de nya migrationerna (version efter 20261124211128) lägger till, ändrar eller ersätter. Ej installerade i STAGING. Genereras av tests/local/t3-andringar.js --skriv.', objekt: sorterat }, null, 1) + '\n');
    console.log('Skrev ' + FIL + ': ' + Object.keys(sorterat).length + ' objekt');
    const utan = Object.entries(sorterat).filter(([, v]) => v.beskrivning === '(beskrivning saknas)');
    if (utan.length) { console.log('FAIL beskrivning saknas: ' + utan.map(([k]) => k).join(', ')); process.exitCode = 1; }
  } else {
    const fil = JSON.parse(fs.readFileSync(FIL, 'utf8')).objekt;
    const lika = JSON.stringify(fil) === JSON.stringify(sorterat);
    console.log((lika ? 'PASS' : 'FAIL') + ' t3-andringar.json stämmer med kedjan (' + Object.keys(sorterat).length + ' objekt)');
    if (!lika) process.exitCode = 1;
  }
} finally { r.stang(); }
