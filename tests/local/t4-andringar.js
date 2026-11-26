'use strict';
/*
 * T4-A (2026-11-28): facit för T4:s nya, ännu inte installerade migrationer (version efter
 * 20261128000008), RELATIVT läget efter T3-E. T3-registret (t3-andringar.json) är oförändrat.
 *
 *   node tests/local/t4-andringar.js           verifierar tests/local/t4-andringar.json
 *   node tests/local/t4-andringar.js --skriv   skriver om filen från en ny lokal kedja
 *
 * Bygger hela repokedjan och jämför mot STAGING-facit med T3-registret men UTAN T4-registret
 * (T4_IGNORERA=1): de objekt som då är oförklarade är exakt T4:s ändringar. Varje sådant objekt
 * står i t4-andringar.json med paket, ändring (NY/ÄNDRAD/BORTTAGEN), md5 för definition + ACL och
 * en beskrivning. jamfor-schema.js räknar dem som förklarade bara när md5 stämmer.
 *
 * T4-B (20261128000011): kedjan byggs också UTAN T4-B (läget T4-A + notiser). Objekt som skiljer sig
 * får paket 'T4-B' och md5_t4an (versionen i T4-A-notisläget, godtas med T4_LAGE=T4-A-notiser) när
 * de fanns där; md5_t4a är versionen i T4-A-läget (T4_LAGE=T4-A) för objekt som ett senare paket ändrat.
 *
 * T4-A, tilläggsdel notiser (20261128000010): kedjan byggs också UTAN notismigrationen. Objekt som
 * bara finns eller skiljer sig i den fulla kedjan får paket 'T4-A-notiser'; objekt som T4-A ändrade
 * och notisdelen ändrar igen får dessutom md5_t4a (T4-A-versionen), som jamfor-schema.js godtar när
 * T4_LAGE=T4-A anges (före notisdelen eller efter dess rollback). Policyer och triggers registreras
 * med samma md5 som jamfor-schema.js räknar.
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
const FIL = path.join(__dirname, 't4-andringar.json');
const md5 = (x) => crypto.createHash('md5').update(String(x == null ? '' : x)).digest('hex');
const aclSet = (a) => (a == null || a === 'NULL') ? 'DEFAULT' : String(a).replace(/^\{|\}$/g, '').split(',').filter(Boolean)
  .map((x) => x.replace(/^"|"$/g, '').replace(/=([a-zA-Z*]+)\//, (m, p) => '=' + p.replace(/m/g, '') + '/')).sort().join(',');

const T4A = {
  _vift_t4a_roll_aktiv: 'Inaktiverad roll (active false/0) ger inga behörigheter (beslutets punkt 7).',
  _vift_t4a_giltig: 'Minst en verkställd behörighet ur katalogen; annars inga verksamhetsdata (tom, okänd, inaktiverad roll).',
  _vift_t4a_legacy: 'Övergångsregel: roll utan staff_contacts_view och activity_log_view_all behandlas som före T4.',
  _vift_t4a_kontakt: 'Arbetskontakt till kollegor: staff_contacts_view (övergång: T3-E:s härledning med fast lista).',
  _vift_t4a_logg_full: 'Hela aktivitetsloggen: activity_log_view_all (övergång: ao_view_all/admin_manage som T3-D).',
  _vift_t4a_privat: 'Hjälpfunktion: kunden är privatperson.',
  _vift_t4a_tom: 'Hjälpfunktion: tomt värde (null eller tom sträng).',
  _vift_t4a_falt: 'Katalogen över skyddade fält per nyckel (portkod, personnummer, inköpspris, intern timkostnad, bankgiro).',
  _vift_t4a_kan_lasa: 'Läsrätt per skyddat fält (objects_sensitive, personal_data_view, cost_view, interna roller för bankgiro).',
  _vift_t4a_kan_skriva: 'Skrivrätt per skyddat fält (objects_sensitive, personal_data_view, cost_edit, bankgiro_edit).',
  _vift_t4a_alla_lasbara: 'Hela värdet bara om alla skyddade fält i nyckeln får läsas (C-5 regel 1 ersatt).',
  _vift_t4a_projicera_elem: 'Elementet utan de fält anroparen inte får läsa.',
  _vift_t4a_sammanfoga: 'Fältvis sammanslagning av ett element: saknat skyddat fält bevaras, skickat nekas (field_protected).',
  _vift_t4a_sammanfoga_lista: 'Fältvis sammanslagning av hela listan (store_business_key_write).',
  _vift_t4a_aktor_perms: 'Anroparens behörigheter lästa i RPC:ns transaktion (samma regel som checkViftAuth).',
  _vift_t4a_roller_bevara: 'Äldre klient utan katalogmarkör tappar inga behörigheter utanför v3.4-katalogen.',
  _vift_t4a_ao_patch: 'Fältvis kontroll i work_order_patch: accessCode och materials[].buyPrice under radlås.',
  _vift_t4a_ao_ref: 'AO-referenser (återkommande, projekt, avvikelser) för AO som anroparen ser med innehåll.',
  _vift_role_perms: 'T3-C + T4-A: inaktiverad roll ger inga behörigheter.',
  _vift_auth_staff: 'T3-B + T4-A: inaktiverad roll ger inga behörigheter (stämpling).',
  vift_caller_perms: 'T4-A: inaktiverad roll ger inga behörigheter (RLS).',
  _vift_ej_verkstallda: 'T3-E + T4-A: cost_view, cost_edit, personal_data_view, bankgiro_edit verkställda och borttagna ur registret.',
  vift_store_full_access: 'T3-D + T4-A: hela värdet bara med läsrätt till alla skyddade fält (även skrivare), giltig behörighet, activity_log_view_all, urval per post för återkommande/projekt/avvikelser/inspektioner.',
  vift_store_project: 'T3-D + T4-A: skyddade fält projiceras även för skrivare; staff_contacts_view; aktivitetslogg utan activity_log_view_all; urval per post för återkommande/projekt/avvikelser/inspektioner; inga data utan giltig behörighet.',
  work_order_patch: 'T3-B + T4-A: accessCode och materials[].buyPrice prövas fältvis under radlåset (field_protected, ignoredFields).',
  store_business_key_write: 'T4-A: ny parameter p_klient; fältvis sammanslagning av skyddade fält och bevarade behörigheter för äldre klient. 5-parametersversionen ersatt.',
  store_business_key_merge_write: 'T4-A: ny parameter p_klient; projicerad jämförelse av previous, fältvis sammanslagning, vift_settings fält för fält (D-17), bevarade behörigheter. 5-parametersversionen ersatt.',
};
/* T4-A, tilläggsdel notiser (20261128000010). */
const NOTISER = {
  _vift_notis_kategori: 'Notiser: typ per behörighet (ao_assigned kräver ao_edit; egna påminnelser bara till sig själv; övriga typer nekas).',
  _vift_notis_projicera: 'Notiser: projektion per mottagare (userId = anroparen); poster utan mottagarfält lämnas inte ut.',
  notification_append: 'Notiser: säker skrivväg under radlås — servern sätter avsändare/tid/id, mottagaren aktiv personal, referensen prövas för avsändaren (_vift_ref_visible), tilldelad mottagare, idempotens bunden till innehåll, storleksgräns.',
  notifications_mark_read: 'Notiser: markera bara egna notiser lästa under radlås (inget orakel för andras id).',
  vift_store_full_access: 'T3-D + T4-A + notiser: hela värdet bara med läsrätt till alla skyddade fält (även skrivare), giltig behörighet, activity_log_view_all, urval per post för återkommande/projekt/avvikelser/inspektioner; vift_notifications aldrig hela listan (REST-läsning stängd).',
  vift_store_project: 'T3-D + T4-A + notiser: skyddade fält projiceras även för skrivare; staff_contacts_view; aktivitetslogg utan activity_log_view_all; urval per post; inga data utan giltig behörighet; vift_notifications per mottagare.',
  _store_direct_write_guard: 'T3-C + notiser (punkt 275): REST-vitlistan avvecklad — all direkt skrivning från authenticated/anon nekas (42501 direct_write_blocked).',
  store_direct_write_allowlist_insert: 'T3-C + notiser (punkt 275): RESTRICTIVE INSERT med WITH CHECK (false) — vitlistan tom.',
  store_direct_write_allowlist_update: 'T3-C + notiser (punkt 275): RESTRICTIVE UPDATE med WITH CHECK (false) — vitlistan tom.',
};
const NOTIS_FIL = 'migrations/20261128000010_t4a_notiser.sql';
/* T4-B (20261128000011): material, priser och tid. */
const T4B = {
  _vift_t4b_pris_las: 'T4-B: prisläsrätt (försäljningspris, timpris) — roller som hanterar AO, fakturerar, har cost_view, artiklar eller offerter; aldrig fältroller (D-09, D-11).',
  _vift_t4b_pris_satta: 'T4-B: sätta/komplettera försäljningspris och moms (invoice_create eller cost_edit).',
  _vift_t4b_inkop_satta: 'T4-B: sätta/komplettera inköpspris (cost_view + cost_edit).',
  _vift_t4b_tillagg_satta: 'T4-B: markera material som tillägg på fastpris-AO (ao_edit eller invoice_create, R21).',
  _vift_t4b_kontor: 'T4-B: valfri befintlig prisgrupp vid tidregistrering (ao_edit, invoice_create, payroll_manage).',
  _vift_t4b_tal: 'T4-B: tal ur JSON, annars null (okänt är aldrig 0).',
  _vift_t4b_idag: 'T4-B: dagens datum i Europe/Stockholm (standard för utförandedatum).',
  _vift_t4b_datum_ok: 'T4-B: giltigt datum ÅÅÅÅ-MM-DD (utförandedatum, VK-1).',
  _vift_t4b_tid_last: 'T4-B: normal tidregistrering låst på klar och låst AO (T3-B beslut 1).',
  _vift_t4b_lage: 'T4-B: AO:ns debiteringsläge (fixed, hourly, unit, unknown).',
  _vift_t4b_pris: 'T4-B (VK-1): gemensam prisupplösning generell → kund → fastighet → avtal (vift_priceAgreements, giltighet per utförandedatum).',
  _vift_t4b_kalla_status: 'T4-B (VK-1): fakturastatus per källrad (ofakturerad/utkast/fakturerad) ur fakturornas sourceRefs.',
  _vift_t4b_anspraak: 'T4-B: alla källnycklar som en icke makulerad faktura gör anspråk på.',
  _vift_t4b_rad_kant: 'T4-B: pris känt för en lagrad rad (uttryckligen okänt, saknat eller äldre 0 = okänt).',
  _vift_t4b_kallrad: 'T4-B (VK-1): gemensamt radformat per källrad (material, tid, fastpris, framtida insats).',
  _vift_t4b_faktura_kallor: 'T4-B: fakturavägens källkontroll (price_unknown, included_in_fixed_price, source_not_billable, source_not_found, price_mismatch).',
  _vift_t4b_faktura_pris_kontroll: 'T4-B: okänt försäljningspris stoppar utskick (price_unknown).',
  _vift_t4b_ny_rad: 'T4-B: ny materialrad med serverpris (artikel → ögonblicksbild; fritext → okänt pris).',
  _vift_t4b_material_lista: 'T4-B: arbetsledarens hela materiallista — serverpris för nya rader, skyddade fält, fakturerade källrader låsta.',
  _vift_t4b_rad_kontroll: 'T4-B: behörighets- och låskontroll för en materialrad (not_own_row, ao_locked, invoiced_locked).',
  work_order_material_add: 'T4-B (D-19): radvis ny materialrad under lås; servern sätter id, addedBy och pris.',
  work_order_material_update: 'T4-B (D-19): radvis ändring av materialrad under lås (egen/annans, priser med rätt, radversion).',
  work_order_material_remove: 'T4-B (D-19): radvis borttagning av materialrad under lås.',
  time_entry_correct: 'T4-B (T3-B beslut 1, punkt 276): behörig (payroll_manage), loggad rättning/komplettering av tid på klar AO.',
  work_order_patch: 'T3-B + T4-A + T4-B: fältets hela materiallista nekas (row_path_required); arbetsledarens lista prissätts av servern, fakturerade källrader låsta.',
  _vift_ej_verkstallda: 'T3-E + T4-A + T4-B: time_view_all verkställd och borttagen ur registret.',
  time_entry_create: 'T3-B + T4-B: tillåten prisgrupp (price_group_not_allowed), okänt timpris = null, låst på klar AO.',
  time_entry_patch: 'T3-B + T4-B: fakturerad tidpost låst (invoiced_locked), tid på klar/låst AO låst.',
  time_entry_soft_delete: 'T4-B: fakturerad tidpost låst (invoiced_locked), tid på klar/låst AO låst.',
  store_write_stamp_status: 'T3-B + T4-B: instämpling låst på klar AO (utstämpling alltid möjlig).',
  invoice_append_checked: 'T4-B: källraderna prövas mot sina källor under lås (okänt pris, fastpris, ej debiterbar, serverpris).',
  invoice_set_status: 'T4-B: okänt försäljningspris stoppar utskick (price_unknown).',
  vift_store_full_access: 'T3-D + T4-A + notiser + T4-B: … ; artiklar och prisgrupper i sin helhet bara med prisläsrätt.',
  vift_store_project: 'T3-D + T4-A + notiser + T4-B: … ; artiklarnas försäljningspris och prisgruppernas timpris bara med prisläsrätt (bara aktiva grupper, namn och typ).',
};
const T4B_FIL = 'migrations/20261128000011_t4b_material_priser_tid.sql';

/* T4-C (20261128000012): åtkomstinformation (objects_access_assigned), D-23. */
const T4C = {
  _vift_t4c_ao_aktiv: 'T4-C (D-05): aktiv AO för åtkomstinformation (nytt/planerad/pågående, inte låst, inte pool).',
  _vift_t4c_pass_aktiv: 'T4-C: aktivt ronderingspass (planerat/pågående).',
  _vift_t4c_pass_tilldelad: 'T4-C: anroparen står i passets staffIds.',
  _vift_t4c_rondering_aktiv: 'T4-C: ronderingsgrenen gäller först när rondering_utfor är verkställd (T4-D).',
  sensitive_fields_read: 'T4-C (SÄK-7 vägen, D-05): get-sensitive-fields — kontroll (objects_sensitive eller objects_access_assigned på egen tilldelad aktiv AO/pass), läsning och revisionsrad utan värden i EN transaktion under delade lås.',
  _vift_t4c_kanslig_radering: 'T4-C (D-23): permanent radering av objekt/fastighet tar bort den känsliga raden i samma transaktion, med revisionsrad utan värden.',
  vift_t4c_kanslig_radering: 'T4-C (D-23): AFTER UPDATE-trigger på store för vift_propertyObjects och vift_properties.',
  _vift_ej_verkstallda: 'T3-E + T4-A + T4-B + T4-C: objects_access_assigned verkställd och borttagen ur registret.',
  store_business_key_write: 'T4-A + T4-C: aktören sätts (set_config vift.aktor) för D-23:s revisionsrad; annars oförändrad.',
  store_business_key_merge_write: 'T4-A + T4-C: aktören sätts (set_config vift.aktor) för D-23:s revisionsrad; annars oförändrad.',
};
const T4C_FIL = 'migrations/20261128000012_t4c_atkomstinformation.sql';
/* T4-D (20261128000013): rondering per pass (rondering_utfor, SÄK-14). */
const T4D = {
  _vift_t4d_egna_ronderingar: 'T4-D: ronderingar där anroparen har ett eget tilldelat pass.',
  _vift_t4d_pass_regel: 'T4-D (SÄK-14, Ö3): passregeln — ao_view_all alla pass; rondering_utfor bara egna, ej avslutade (not_assigned, pass_completed).',
  _vift_t4d_las_pass: 'T4-D: låser vift_ronderingspass (FOR UPDATE) och prövar passregeln i samma transaktion som åtgärden.',
  rondering_point_patch: 'T4-D: ny signatur med p_caller_perms; tilldelningskontroll under radlåset; fältets avvikelse-/AO-referens ignoreras. Föregående signatur borttagen.',
  rondering_pass_save_note: 'T4-D: ny signatur med anroparen; tilldelningskontroll under radlåset. Föregående signatur borttagen.',
  rondering_pass_auto_start: 'T4-D: ny signatur med anroparen; tilldelningskontroll under radlåset (no-op på avslutat pass). Föregående signatur borttagen.',
  rondering_pass_complete: 'T4-D: ny signatur med p_caller_perms; tilldelningskontroll under radlåset. Föregående signatur borttagen.',
  _vift_ej_verkstallda: 'T3-E + T4-A + T4-B + T4-C + T4-D: rondering_utfor verkställd och borttagen ur registret.',
  vift_store_full_access: 'T3-D + T4-A + notiser + T4-B + T4-D: … ; pass, ronderingar och mallar i sin helhet bara för ao_view_all.',
  vift_store_project: 'T3-D + T4-A + notiser + T4-B + T4-D: … ; rondering per pass (egna pass, ronderingen utan pris och intern anteckning, inga mallar); ronderingshändelser för egna pass i aktivitetsloggen.',
  _vift_post_refs: 'T3-D + T4-D: urvalet får ronderingar med eget tilldelat pass (verkställd rondering_utfor).',
  _vift_ref_visible: 'T3-D + T4-D: ronderingId synlig även via eget pass.',
  _vift_activity_type_perms: 'T3-D + T4-D: ronderingshändelserna (start, slutförd, punkt) även för rondering_utfor (T3-D beslut 5).',
};
const T4D_FIL = 'migrations/20261128000013_t4d_rondering.sql';

/* Oförklarade objekt (utan T4-registret) i en kedja, med md5 som jamfor-schema.js räknar. */
function las(opts) {
  const r = byggReplik(Object.assign({ data: false, schemakontroll: false }, opts));
  try {
    const ut = path.join(os.tmpdir(), 't4-andringar-' + process.pid + '-' + Date.now() + '.json');
    try { execFileSync('node', [path.join(__dirname, 'jamfor-schema.js'), r.db, ut], { env: Object.assign({}, process.env, { T4_IGNORERA: '1' }), stdio: 'pipe' }); } catch (e) { /* avvikelser ger exit 1 */ }
    const rap = JSON.parse(fs.readFileSync(ut, 'utf8')); fs.unlinkSync(ut);
    const lok = q(r.db, `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def, coalesce(p.proacl::text,'NULL') as acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')`);
    const pol = q(r.db, `select schemaname, tablename, policyname, permissive, roles::text as roles, cmd, qual, with_check from pg_policies where schemaname in ('public','storage')`);
    const trg = q(r.db, `select c.relname as "table", t.tgname as name, t.tgenabled as enabled, pg_get_triggerdef(t.oid) as def
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public'`);
    const ws = (x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
    const def = (typ, key) => {
      if (typ === 'funktion') { const f = lok.find((y) => y.name + '(' + y.args + ')' === key); return f ? md5(f.def) + '|' + aclSet(f.acl) : 'saknas'; }
      if (typ === 'policy') { const p = pol.find((x) => x.schemaname + '.' + x.tablename + '.' + x.policyname === key); return p ? md5([p.permissive, p.roles, p.cmd, ws(p.qual), ws(p.with_check)].join('|')) : 'saknas'; }
      if (typ === 'trigger') { const t = trg.find((x) => x.table + '.' + x.name === key); return t ? md5(t.def + '|' + t.enabled) : 'saknas'; }
      return null;
    };
    const ut2 = {};
    for (const x of rap.filter((y) => y.kategori === 'OFÖRKLARAD')) ut2[x.typ + ':' + x.key] = { x, md5: def(x.typ, x.key) };
    /* T4-D: alla funktioner i läget (för objekt som ett senare paket tar bort, t.ex. en ersatt signatur). */
    Object.defineProperty(ut2, '_alla', { value: new Set(lok.map((f) => 'funktion:' + f.name + '(' + f.args + ')')), enumerable: false });
    return ut2;
  } finally { r.stang(); }
}

{
  const { franOchMed } = require('./lib/replik');
  const full = las({});
  /* Lägen före varje senare paket (kedjan utan paketet och allt efter det), nyast först.
     md5-nyckeln är versionen i det läget, för objekt som ett senare paket ändrat igen. */
  const LAGER = [
    { paket: 'T4-D', md5: 'md5_t4c', fore: 'T4-C', las: las({ utelamna: franOchMed(T4D_FIL) }), besk: T4D },
    { paket: 'T4-C', md5: 'md5_t4b', fore: 'T4-B', las: las({ utelamna: franOchMed(T4C_FIL) }), besk: T4C },
    { paket: 'T4-B', md5: 'md5_t4an', fore: 'T4-A-notiser', las: las({ utelamna: franOchMed(T4B_FIL) }), besk: T4B },
    { paket: 'T4-A-notiser', md5: 'md5_t4a', fore: 'T4-A', las: las({ utelamna: franOchMed(NOTIS_FIL) }), besk: NOTISER },
  ];
  const t3reg = JSON.parse(fs.readFileSync(path.join(__dirname, 't3-andringar.json'), 'utf8')).objekt;
  const objekt = {};
  for (const [k, { x, md5: m }] of Object.entries(full)) {
    const namn = x.key.replace(/\(.*$/, '').replace(/^public\.store\./, '').replace(/^store\./, '');
    /* Paketet = det senaste lager där objektet skiljer sig från läget före lagret. */
    let i = LAGER.findIndex((L, n) => { const fore = L.las[k]; const efter = n === 0 ? { md5: m } : LAGER[n - 1].las[k]; return (efter ? efter.md5 : 'saknas') !== (fore ? fore.md5 : 'saknas'); });
    /* Borttagen funktion som var identisk med STAGING före borttagningen: paketet är lagret där den fanns före men inte efter. */
    if (i < 0 && x.status === 'SAKNAS LOKALT') i = LAGER.findIndex((L, n) => L.las._alla.has(k) && (n === 0 ? true : !LAGER[n - 1].las._alla.has(k)));
    const L = i >= 0 ? LAGER[i] : null;
    /* Föregående paket som ändrade objektet (för "ÄNDRAD (efter …)"). */
    let fore = null;
    if (L && L.las[k]) {
      const m0 = L.las[k].md5;
      const j = LAGER.slice(i + 1).findIndex((L2) => !L2.las[k] || L2.las[k].md5 !== m0);
      fore = j < 0 ? 'T4-A' : LAGER[i + 1 + j].paket;
    }
    objekt[k] = {
      paket: L ? L.paket : 'T4-A',
      andring: fore ? 'ÄNDRAD (efter ' + fore + ')'
        : t3reg[k] && x.status !== 'SAKNAS LOKALT' ? 'ÄNDRAD (efter ' + t3reg[k].paket + ')'
        : x.status === 'EXTRA LOKALT' ? 'NY' : x.status === 'SAKNAS LOKALT' ? 'BORTTAGEN (ersatt av ny signatur)' : 'ÄNDRAD',
      md5: m,
      beskrivning: ((L ? L.besk : T4A)[namn]) || '(beskrivning saknas)',
    };
    /* Versionen i varje äldre läge där den skiljer sig från den installerade. */
    for (const L2 of LAGER) if (L2.las[k] && L2.las[k].md5 !== m) objekt[k][L2.md5] = L2.las[k].md5;
  }
  const sorterat = Object.fromEntries(Object.keys(objekt).sort().map((k) => [k, objekt[k]]));
  if (process.argv.includes('--skriv')) {
    fs.writeFileSync(FIL, JSON.stringify({ beskrivning: 'T4 (2026-11-28): objekt som T4:s nya migrationer (version efter 20261128000008) lägger till, ändrar eller ersätter, relativt läget efter T3-E (paket T4-A, T4-A-notiser, T4-B, T4-C och T4-D; md5_t4a = versionen i T4-A-läget, md5_t4an = i läget T4-A + notisdelen, md5_t4b = i läget efter T4-B och md5_t4c = i läget efter T4-C, för objekt som ett senare T4-paket ändrar igen). Ej installerade i STAGING. Genereras av tests/local/t4-andringar.js --skriv.', objekt: sorterat }, null, 1) + '\n');
    console.log('Skrev ' + FIL + ': ' + Object.keys(sorterat).length + ' objekt');
    const utan = Object.entries(sorterat).filter(([, v]) => v.beskrivning === '(beskrivning saknas)' || v.md5 === null);
    if (utan.length) { console.log('FAIL beskrivning eller md5 saknas: ' + utan.map(([k]) => k).join(', ')); process.exitCode = 1; }
  } else {
    const fil = JSON.parse(fs.readFileSync(FIL, 'utf8')).objekt;
    const lika = JSON.stringify(fil) === JSON.stringify(sorterat);
    console.log((lika ? 'PASS' : 'FAIL') + ' t4-andringar.json stämmer med kedjan (' + Object.keys(sorterat).length + ' objekt)');
    if (!lika) process.exitCode = 1;
  }
}
