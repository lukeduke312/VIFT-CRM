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

const r = byggReplik({ data: false, schemakontroll: false });
try {
  const ut = path.join(os.tmpdir(), 't4-andringar-' + process.pid + '.json');
  try { execFileSync('node', [path.join(__dirname, 'jamfor-schema.js'), r.db, ut], { env: Object.assign({}, process.env, { T4_IGNORERA: '1' }), stdio: 'pipe' }); } catch (e) { /* avvikelser ger exit 1 */ }
  const rap = JSON.parse(fs.readFileSync(ut, 'utf8')); fs.unlinkSync(ut);
  const lok = q(r.db, `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def, coalesce(p.proacl::text,'NULL') as acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')`);
  const t3reg = JSON.parse(fs.readFileSync(path.join(__dirname, 't3-andringar.json'), 'utf8')).objekt;
  const objekt = {};
  for (const x of rap.filter((y) => y.kategori === 'OFÖRKLARAD')) {
    const k = x.typ + ':' + x.key;
    const namn = x.key.replace(/\(.*$/, '');
    let m = null;
    if (x.typ === 'funktion') { const f = lok.find((y) => y.name + '(' + y.args + ')' === x.key); m = f ? md5(f.def) + '|' + aclSet(f.acl) : 'saknas'; }
    objekt[k] = {
      paket: 'T4-A',
      andring: t3reg[k] && x.status !== 'SAKNAS LOKALT' ? 'ÄNDRAD (efter ' + t3reg[k].paket + ')'
        : x.status === 'EXTRA LOKALT' ? 'NY' : x.status === 'SAKNAS LOKALT' ? 'BORTTAGEN (ersatt av ny signatur)' : 'ÄNDRAD',
      md5: m,
      beskrivning: T4A[namn] || '(beskrivning saknas)',
    };
  }
  const sorterat = Object.fromEntries(Object.keys(objekt).sort().map((k) => [k, objekt[k]]));
  if (process.argv.includes('--skriv')) {
    fs.writeFileSync(FIL, JSON.stringify({ beskrivning: 'T4-A (2026-11-28): objekt som T4:s nya migrationer (version efter 20261128000008) lägger till, ändrar eller ersätter, relativt läget efter T3-E. Ej installerade i STAGING. Genereras av tests/local/t4-andringar.js --skriv.', objekt: sorterat }, null, 1) + '\n');
    console.log('Skrev ' + FIL + ': ' + Object.keys(sorterat).length + ' objekt');
    const utan = Object.entries(sorterat).filter(([, v]) => v.beskrivning === '(beskrivning saknas)' || v.md5 === null);
    if (utan.length) { console.log('FAIL beskrivning eller md5 saknas: ' + utan.map(([k]) => k).join(', ')); process.exitCode = 1; }
  } else {
    const fil = JSON.parse(fs.readFileSync(FIL, 'utf8')).objekt;
    const lika = JSON.stringify(fil) === JSON.stringify(sorterat);
    console.log((lika ? 'PASS' : 'FAIL') + ' t4-andringar.json stämmer med kedjan (' + Object.keys(sorterat).length + ' objekt)');
    if (!lika) process.exitCode = 1;
  }
} finally { r.stang(); }
