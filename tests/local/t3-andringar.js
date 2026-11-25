'use strict';
/*
 * T3-B (2026-11-28): facit för de NYA, ännu inte installerade migrationerna.
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

const r = byggReplik({ data: false, schemakontroll: false });
try {
  const ut = path.join(os.tmpdir(), 't3-andringar-' + process.pid + '.json');
  try { execFileSync('node', [path.join(__dirname, 'jamfor-schema.js'), r.db, ut], { env: Object.assign({}, process.env, { T3_IGNORERA: '1' }), stdio: 'pipe' }); } catch (e) { /* avvikelser ger exit 1 */ }
  const rap = JSON.parse(fs.readFileSync(ut, 'utf8')); fs.unlinkSync(ut);
  const lok = q(r.db, `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def, coalesce(p.proacl::text,'NULL') as acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')`);
  const objekt = {};
  for (const x of rap.filter((y) => y.kategori === 'OFÖRKLARAD')) {
    const k = x.typ + ':' + x.key;
    const namn = x.key.replace(/\(.*$/, '');
    const f = lok.find((y) => y.name + '(' + y.args + ')' === x.key);
    objekt[k] = {
      paket: 'T3-B',
      andring: x.status === 'EXTRA LOKALT' ? 'NY' : x.status === 'SAKNAS LOKALT' ? 'BORTTAGEN (ersatt av ny signatur)' : 'ÄNDRAD',
      md5: x.typ === 'funktion' ? (f ? md5(f.def) + '|' + aclSet(f.acl) : 'saknas') : null,
      beskrivning: BESKRIVNING[namn] || '(beskrivning saknas)',
    };
  }
  const sorterat = Object.fromEntries(Object.keys(objekt).sort().map((k) => [k, objekt[k]]));
  if (process.argv.includes('--skriv')) {
    fs.writeFileSync(FIL, JSON.stringify({ beskrivning: 'T3-B (2026-11-28): objekt som de nya migrationerna (version efter 20261124211128) lägger till, ändrar eller ersätter. Ej installerade i STAGING. Genereras av tests/local/t3-andringar.js --skriv.', objekt: sorterat }, null, 1) + '\n');
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
