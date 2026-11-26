'use strict';
/*
 * T4-A (2026-11-28): skyddade fält och projektion även för skrivare (testgruppen `merge_protected`,
 * SAKERHETSPROVNING-TESTPLAN §6 T4-A), staff_contacts_view, activity_log_view_all, inaktiverade/
 * okända/tomma roller, åtkomst per post, ägarkontroll vid bildradering och äldre klienters
 * rollskrivning. GODKÄNDA SÄKERHETSTESTER efter rättning, och BASLINJE-fynden i oförändrad kod
 * (T3-E, commit bd9553e, utläst med git archive) på samma data.
 *
 * Mot den lokala STAGING-replikan med hela repokedjan (20261128000001–09) och de ändrade Edge
 * Functions körda i Node. Varje negativt fall kontrollerar exakt status, error och reason
 * (BEHORIGHETSMATRIS §4) OCH oförändrad kontrollsumma. Samtidighet: parallella anrop genom EF:en med
 * barriär (radlåset i RPC:n avgör), 20 upprepningar. Lokalt verifierat; inget är prövat i STAGING.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ok, krav, avsluta } = require('./local/lib/test');
krav({ tsc: true });
const { byggReplik, serverRot, franOchMed } = require('./local/lib/replik');
const { laddaEf } = require('./local/lib/ef');
const { val, q, psql, psqlFile, rpc, lit, jlit, asUser } = require('./local/lib/db');
const { expectReject, expectAccept, ksTa, ksDiff, upprepa } = require('./local/lib/kontroll');
const { data } = require('./local/lib/data');

const FORE_COMMIT = 'bd9553e'; // T3-E (läget före T4-A)
const EF = ['store-key-write', 'work-orders-list', 'ao-time-write', 'work-order-log-write', 'work-order-checklist-resolve', 'work-order-image-delete', 'invoice-write', 'time-entries-list'];
const STD = JSON.parse(fs.readFileSync(path.join(serverRot(), 'manual', 't3e_standardroller', 'standardroller.json'), 'utf8'));
const SENS = ['doorCode', 'keyInformation', 'accessInformation', 'keyReceipt', 'alarmInformation', 'accessCode', 'keyInfo'];
const clone = (v) => JSON.parse(JSON.stringify(v));
const utan = (e, f) => Object.fromEntries(Object.entries(e).filter(([k]) => !f.includes(k)));
const ids = (l) => (Array.isArray(l) ? l : []).map((x) => x && x.id).sort().join(',');
const harNagot = (v, re) => re.test(JSON.stringify(v === undefined ? null : v));
const PORT_RE = /TEST-(1001|2002|PROP-|CU-|OBJ-|REC-|PORT-)|Nyckel i testskåp|Nyckelbricka|TEST-KVITTO|TEST-LARM/;
const PNR_RE = /19800101-0000|19700101-1111/;

/* ── Testvärlden: STAGING-likt register (lib/data.js) + standardrollerna (std_*) och egna roller (D-26) ── */
function laddaVarld(db, U) {
  const d = data();
  const F = U.falt.staffId, F2 = U.falt2.staffId;
  const chefPerms = d.store.vift_roles.find((r) => r.id === 'chef').permissions;
  const roller = d.store.vift_roles.concat(STD.roller.map((r) => Object.assign({}, r, { id: 'std_' + r.id, isBuiltin: false })), [
    { id: 'artikel_roll', label: 'Artiklar (egen)', active: true, permissions: ['dashboard_view', 'article_manage'] },
    { id: 'bankgiro_roll', label: 'Inställningar + bankgiro (egen)', active: true, permissions: ['dashboard_view', 'admin_manage', 'bankgiro_edit'] },
    { id: 'kostnad_roll', label: 'Inställningar + cost_view (egen)', active: true, permissions: ['dashboard_view', 'admin_manage', 'cost_view'] },
    { id: 'inaktiv_roll', label: 'Inaktiverad (egen)', active: false, permissions: chefPerms.slice() },
    { id: 'ny_chef', label: 'Arbetsledare + staff_contacts_view (egen)', active: true, permissions: chefPerms.concat(['staff_contacts_view']) },
    { id: 'ny_utan_kontakt', label: 'Arbetsledare + activity_log_view_all (egen)', active: true, permissions: chefPerms.concat(['activity_log_view_all']) },
    { id: 'begr_kontakt', label: 'Begränsad + staff_contacts_view (egen)', active: true, permissions: ['dashboard_view', 'ao_view_own', 'staff_contacts_view'] },
    { id: 'ejv_roll', label: 'Bara ej verkställda (egen)', active: true, permissions: ['ao_plan_own', 'export_data'] },
    { id: 'pdv_roll', label: 'Kundregister + personal_data_view (egen)', active: true, permissions: ['dashboard_view', 'customer_manage', 'personal_data_view'] },
  ]);
  const nya = [['std_chef', 'ST-T01', 'std_chef'], ['std_ekonomi', 'ST-T02', 'std_ekonomi'], ['std_personal', 'ST-T03', 'std_personal'], ['std_begransad', 'ST-T04', 'std_begransad'],
    ['artikel', 'ST-T05', 'artikel_roll'], ['bankgiro', 'ST-T06', 'bankgiro_roll'], ['kostnad', 'ST-T07', 'kostnad_roll'], ['inaktiv', 'ST-T08', 'inaktiv_roll'],
    ['admin2', 'ST-T09', 'admin'], ['ny_chef', 'ST-T10', 'ny_chef'], ['ny_utan_kontakt', 'ST-T11', 'ny_utan_kontakt'], ['begr_kontakt', 'ST-T12', 'begr_kontakt'],
    ['ejv', 'ST-T13', 'ejv_roll'], ['pdv', 'ST-T14', 'pdv_roll']]
    .map(([alias, staffId, role], i) => ({ alias, staffId, role, firstName: 'T4', lastName: alias, email: alias + '@example.test', authId: '00000000-0000-4000-8000-0000000005' + String(i + 10).padStart(2, '0') }));
  const staff = d.store.vift_staff.concat(nya.map((u) => ({ id: u.staffId, firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, active: true, title: 'Titel ' + u.alias, phone: '070-000 05 ' + u.staffId.slice(-2), hourlyRate: 650 })));
  // std_personal och std_begransad är tilldelade AO-A1 (som fältet), så att urvalet per post prövas.
  const aos = d.store.vift_workOrders.map((a) => {
    if (a.id === 'AO-A1') return Object.assign({}, a, { staff: [F, 'ST-T03', 'ST-T04'], recurringOrderId: 'REC-R1', projectId: 'PRJ-1',
      log: a.log.concat([{ id: 'L-IMG-F', type: 'note', text: 'bild', staffId: F, imagePath: 'AO-A1/egen.jpg', timestamp: '2026-11-02T08:00:00.000Z' },
        { id: 'L-IMG-F2', type: 'note', text: 'bild', staffId: F2, imagePath: 'AO-A1/annans.jpg', timestamp: '2026-11-02T08:00:00.000Z' }]),
      checklist: a.checklist.concat([{ id: 'AO-A1-C9', text: 'Avvikelse', done: true, avvikelseImage: 'AO-A1/avvikelse.jpg' }]) });
    if (a.id === 'AO-A8') return Object.assign({}, a, { projectId: 'PRJ-2' });
    return a;
  });
  const store = Object.assign({}, d.store, {
    vift_roles: roller, vift_staff: staff, vift_workOrders: aos,
    vift_customers: d.store.vift_customers.concat([{ id: 'CU-R4', type: 'privat', firstName: 'Lisa', lastName: 'Legacy', name: 'Lisa Legacy', personnr: '', orgNr: '19700101-1111', active: true, createdAt: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-01T08:00:00.000Z' }]),
    vift_recurringOrders: d.store.vift_recurringOrders.concat([{ id: 'REC-R2', title: 'Återkommande utan AO', propertyId: 'PROP-R2', accessCode: 'TEST-REC-2', active: true }]),
    vift_projects: [{ id: 'PRJ-1', name: 'Projekt 1', customerId: 'CU-R1' }, { id: 'PRJ-2', name: 'Projekt 2', customerId: 'CU-R1' }, { id: 'PRJ-3', name: 'Projekt 3', customerId: 'CU-R2' }],
    vift_avvikelser: [{ id: 'AVV-1', title: 'Avvikelse 1', workOrderId: 'AO-A1', status: 'öppen' }, { id: 'AVV-2', title: 'Avvikelse 2', workOrderId: 'AO-A8', status: 'öppen' }, { id: 'AVV-3', title: 'Utan AO', workOrderId: '', status: 'öppen' }],
    vift_inspections: [{ id: 'INSP-1', propertyId: 'PROP-R1', title: 'Besiktning' }],
    vift_articles: d.store.vift_articles.map((a) => Object.assign({}, a, { markup: 100 })),
  });
  const sql = ['begin;'];
  for (const u of nya) {
    sql.push(`insert into auth.users(id, email) values (${lit(u.authId)}, ${lit(u.email)});`);
    sql.push(`insert into public.app_users(user_id, staff_id, role_id, active, is_admin) values (${lit(u.authId)}, ${lit(u.staffId)}, ${lit(u.role)}, true, ${u.role === 'admin'});`);
    U[u.alias] = u;
  }
  for (const [k, v] of Object.entries(store)) sql.push(`insert into public.store(key, value, updated_at) values (${lit(k)}, ${jlit(v)}, '2026-11-01T08:00:00Z') on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;`);
  sql.push('commit;');
  psql(db, sql.join('\n'));
  return store;
}


/* T4-B (2026-11-28): denna svit prövar T4-A-paketet SÅ SOM DET LEVERERADES — kedjan utan T4-B-migrationen
   (20261128000011, schemajämförelse med T4_LAGE=T4-A-notiser) och Edge Functions ur T4-A-commiten (2060b8f).
   T4-B:s ändringar av samma vägar prövas i t4b_material_priser.test.js (även hela kedjan och samspelet). */
const T4A_COMMIT = '2060b8f';
const T4B_MIG = 'migrations/20261128000011_t4b_material_priser_tid.sql';
const T4REG = JSON.parse(fs.readFileSync(path.join(__dirname, 'local', 't4-andringar.json'), 'utf8')).objekt;
/* T4-C: även senare paket (T4-C, T4-D …) saknas i T4-A-läget. */
const EJ_T4B = Object.keys(T4REG).filter((k) => !/^T4-[B-Z]$/.test(T4REG[k].paket));
/* OBS-raden får bara nämna T4-B:s objekt (som inte är installerade i T4-A-läget). */
const obsBaraT4b = (ut) => { const m = /OBS: T4-ändringar som inte syns[^\n]*/.exec(ut); return !m || EJ_T4B.every((k) => !m[0].includes(k)); };
function t4aKalla() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vift-t4a-kod-'));
  process.on('exit', () => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
  execFileSync('tar', ['-x', '-C', d], { input: execFileSync('git', ['-C', path.join(__dirname, '..'), 'archive', T4A_COMMIT, 'supabase'], { maxBuffer: 512 * 1024 * 1024 }) });
  return path.join(d, 'supabase');
}

(async () => {
  const HIST = fs.mkdtempSync(path.join(os.tmpdir(), 'vift-t3e-'));
  process.on('exit', () => { try { fs.rmSync(HIST, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
  execFileSync('tar', ['-x', '-C', HIST], { input: execFileSync('git', ['-C', path.join(__dirname, '..'), 'archive', FORE_COMMIT, 'supabase'], { maxBuffer: 512 * 1024 * 1024 }) });
  const rotFore = path.join(HIST, 'supabase');

  process.env.T4_LAGE = 'T4-A-notiser';
  const rotT4a = t4aKalla();
  const r = byggReplik({ utelamna: franOchMed(T4B_MIG) });
  const { db, U } = r;
  ok(r.steg.some((s) => /20261128000009_t4a_/.test(s.rel)), 'kedjan innehåller T4-A-migrationen 20261128000009');
  ok(r.rapport.oforklarade === 0, `schemajämförelse: 0 oförklarade (T4-A-objekten förklarade via t4-andringar.json): ${r.rapport.identiska} identiska, ${r.rapport.forklarade} förklarade`);
  laddaVarld(db, U);
  psql(db, `create table public._t4a_bas as select * from public.store; create table public._t4a_idem as select * from public.op_idempotency;`);
  const aterstall = () => psql(db, `begin; delete from public.store; insert into public.store select * from public._t4a_bas; delete from public.op_idempotency; insert into public.op_idempotency select * from public._t4a_idem; commit;`);
  const ef = await laddaEf(db, EF, { root: rotT4a });

  const rf = byggReplik({ rot: rotFore, schemakontroll: false });
  const Uf = rf.U;
  laddaVarld(rf.db, Uf);
  ok(!rf.steg.some((s) => /_t4a_/.test(s.rel)) && rf.steg.some((s) => /_t3e_/.test(s.rel)), 'jämförelsekedjan (före) = T3-E-koden ' + FORE_COMMIT + ' (STAGING + T3-B–T3-E, utan T4-A)');
  const efFore = await laddaEf(rf.db, EF, { root: rotFore });
  psql(rf.db, `create table public._t4a_bas as select * from public.store;`);
  const aterstallFore = () => psql(rf.db, `begin; delete from public.store; insert into public.store select * from public._t4a_bas; commit;`);

  const SK = (e, user, body) => e.anropa('store-key-write', { user, body });
  const lasAlla = (e, user, keys) => SK(e, user, { action: 'readAllWithHashes', keys });
  const las1 = async (e, user, key) => ((await SK(e, user, { action: 'readWithHash', key })).body || {});
  const elem = async (e, user, key, id) => ((await las1(e, user, key)).value || []).find((x) => x && x.id === id);
  const merge = (user, key, upserts, removals, klient) => SK(ef, user, Object.assign({ action: 'writeMerge', key, upserts, removals: removals || [] }, klient ? { klient } : {}));
  const KS_REG = { keys: ['vift_customers', 'vift_properties', 'vift_propertyObjects', 'vift_settings', 'vift_articles', 'vift_roles', 'vift_staff', 'vift_workOrders', 'vift_recurringOrders'], tables: ['op_idempotency'] };
  const NEJ = async (namn, anrop, forvantat, ks) => { const x = await expectReject(db, anrop, forvantat, ks || KS_REG); ok(x.ok, namn, x.fel.concat([JSON.stringify(x.svar && x.svar.body).slice(0, 300)])); return x; };
  const JA = async (namn, anrop, andras, ks) => { const x = await expectAccept(db, anrop, { status: 200 }, ks || KS_REG, andras); ok(x.ok, namn, x.fel); return x; };
  const F = U.falt.staffId;

  // ════════════════ BASLINJE (oförändrad kod, T3-E): bristerna bevisas på samma data ════════════════
  let s = await lasAlla(efFore, Uf.chef_utan_faktura, ['vift_propertyObjects', 'vift_customers']);
  ok(harNagot(s.body.data.propertyObjects, PORT_RE), 'BASLINJE SÄK-7 (P1): skrivaren customer_manage utan objects_sensitive får portkoder och nyckelinformation i objektregistret (C-5 regel 1: skrivare får hela värdet)');
  s = await lasAlla(efFore, Uf.saljare, ['vift_customers']);
  ok(harNagot(s.body.data.customers, PNR_RE), 'BASLINJE D-13 (SEC-KUND-03): roll med ao_view_all + sales_manage utan personal_data_view får personnummer');
  s = await lasAlla(efFore, Uf.falt, ['vift_articles', 'vift_settings']);
  ok((s.body.data.articles || [])[0] && 'buyPrice' in s.body.data.articles[0], 'BASLINJE D-01 (SEC-B1-09): fältet får artiklarnas inköpspris');
  s = await lasAlla(efFore, Uf.adminhanterare, ['vift_settings']);
  ok(s.body.data.settings && 'internalHourlyCost' in s.body.data.settings, 'BASLINJE D-01 (SEC-B2-06): admin_manage utan cost_view får intern timkostnad');
  s = await lasAlla(efFore, Uf.tom, ['vift_settings', 'vift_recurringOrders', 'vift_priceGroups']);
  ok(s.body.data.settings && s.body.data.settings.companyName && (s.body.data.recurringOrders || []).length > 0, 'BASLINJE punkt 7: tom behörighetslista får inställningar och återkommande ärenden (C-5)');
  s = await efFore.anropa('work-orders-list', { user: Uf.inaktiv });
  ok((s.body.workOrders || []).length > 10, 'BASLINJE punkt 7: användare med inaktiverad roll får alla AO (rollens active ignoreras)');
  s = await efFore.anropa('work-orders-list', { user: Uf.chef_utan_faktura });
  ok((s.body.workOrders || []).some((a) => a.accessCode), 'BASLINJE SÄK-7 (AO): ao_edit utan objects_sensitive får AO:ns portkod i work-orders-list (C-5-undantaget för ao_edit)');
  s = await efFore.anropa('work-order-log-write', { user: Uf.falt, body: { action: 'append_log', aoId: 'AO-A1', entry: { id: 'L-BAS-1', type: 'note', text: 'x' } } });
  ok(s.status === 200 && s.body.workOrder && s.body.workOrder.accessCode && s.body.workOrder.materials[0].buyPrice !== undefined,
    'BASLINJE (nytt fynd T4-A): fältet får portkod och inköpspris i svaret från work-order-log-write (skrivsvaret projicerades inte)');
  { // v3.4-rolleditorn tappar okända behörigheter
    psql(rf.db, `update public.store set value = (select jsonb_agg(case when e->>'id' = 'personal' then e || '{"permissions":["dashboard_view","ao_view_own","ao_complete","ao_time","ao_material","ao_checklist","customer_view"]}'::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_roles'`);
    const el = (await elem(efFore, Uf.admin, 'vift_roles', 'personal'));
    s = await SK(efFore, Uf.admin, { action: 'writeMerge', key: 'vift_roles', upserts: [{ id: 'personal', data: Object.assign({}, el, { permissions: el.permissions.filter((x) => x !== 'customer_view') }), previous: el }], removals: [] });
    ok(s.status === 200 && !val(rf.db, 'vift_roles').find((x) => x.id === 'personal').permissions.includes('customer_view'),
      'BASLINJE T3-E-beslutet: en rollskrivning med v3.4-katalogen (utan customer_view) tar bort behörigheten');
  }
  s = await efFore.anropa('work-order-image-delete', { user: Uf.falt, body: { aoId: 'AO-A1', path: 'AO-A1/annans.jpg' } });
  ok(s.status === 200, 'BASLINJE punkt 7 (bildradering): fältet raderar en bild som FÄ2:s loggpost refererar');
  aterstallFore();

  // ════════════════ Projektion efter T4-A (E): skyddade fält per behörighet, även för skrivare ════════════════
  const KEYS = ['vift_customers', 'vift_properties', 'vift_propertyObjects', 'vift_propertyContacts', 'vift_recurringOrders', 'vift_settings', 'vift_articles', 'vift_projects', 'vift_avvikelser', 'vift_inspections', 'vift_activityLog', 'vift_staff'];
  const L = {};
  for (const a of ['admin', 'chef', 'ekonomi', 'falt', 'begransad', 'chef_utan_faktura', 'saljare', 'adminhanterare', 'tom', 'okandroll', 'std_chef', 'std_ekonomi', 'std_personal', 'std_begransad',
    'artikel', 'bankgiro', 'kostnad', 'inaktiv', 'ny_chef', 'ny_utan_kontakt', 'begr_kontakt', 'ejv', 'pdv']) {
    L[a] = ((await lasAlla(ef, U[a], KEYS)).body || {}).data || {};
  }
  const port = (a) => harNagot([L[a].customers, L[a].properties, L[a].propertyObjects, L[a].propertyContacts, L[a].recurringOrders], PORT_RE);
  const pnr = (a) => harNagot(L[a].customers, PNR_RE);
  ok(!port('chef_utan_faktura') && (L.chef_utan_faktura.propertyObjects || []).length === 2, 'SÄK-7 / SEC-B5-01 / SEC-CUST-03 (E): skrivaren customer_manage utan objects_sensitive får objektregistret utan portkoder och nyckelinformation — baslinjefyndet vänt');
  ok(port('chef') && port('std_chef') && port('admin'), 'SEC-B5 (E): objects_sensitive (arbetsledare, standardrollen chef, admin) får portkoderna');
  ok(!pnr('saljare') && !pnr('chef') && !pnr('std_chef') && !pnr('chef_utan_faktura') && !pnr('ekonomi'), 'D-13 / SEC-KUND-03 (E): personnummer och privatpersoners org.nr saknas utan personal_data_view (säljare, arbetsledare (K-02), skrivaren customer_manage, ekonomi utan behörigheten) — baslinjefyndet vänt');
  ok(pnr('std_ekonomi') && pnr('pdv') && pnr('admin'), 'SEC-KUND-04 (E): personal_data_view (standardrollen ekonomi, egen roll, admin) får personnummer och privatpersoners org.nr');
  ok((L.chef.customers || []).find((c) => c.id === 'CU-R2').orgNr === '556000-0000', 'D-13: företagets org.nr är inte skyddat (bara privatpersoners)');
  ok(!('buyPrice' in (L.falt.articles || [{}])[0]) && !('markup' in L.falt.articles[0]) && L.falt.articles[0].sellPrice === 100 && !('buyPrice' in L.artikel.articles[0]),
    'D-01 / SEC-B1-09 (E): artiklarnas inköpspris och påslag saknas utan cost_view, även för skrivaren article_manage (försäljningspriset för fält: T4-B)');
  ok(L.std_chef.articles[0].buyPrice === 50 && L.std_ekonomi.articles[0].markup === 100, 'SEC-B1-11 (E): cost_view (standardrollerna chef och ekonomi) får inköpspris och påslag');
  ok(!('internalHourlyCost' in L.adminhanterare.settings) && L.adminhanterare.settings.bankgiro === '000-0000' && L.kostnad.settings.internalHourlyCost === 400,
    'D-01 / SEC-B2-06 (E): intern timkostnad bara med cost_view, även för skrivaren admin_manage; bankgiro för interna roller (D-17)');
  ok(!('bankgiro' in L.falt.settings) && !('internalHourlyCost' in L.falt.settings) && L.falt.settings.companyName && !('bankgiro' in L.begransad.settings),
    'SEC-INST-01 (E): fält och begränsad får inställningarna utan bankgiro och intern timkostnad');
  ok(L.ekonomi.settings.bankgiro === '000-0000' && L.chef.settings.bankgiro === '000-0000', 'SEC-INST-02 (E): arbetsledare och ekonomi läser bankgiro');
  for (const a of ['tom', 'okandroll', 'inaktiv', 'ejv']) {
    const tomt = KEYS.filter((k) => k !== 'vift_staff').every((k) => { const v = L[a][k.slice(5)]; return v === undefined || (Array.isArray(v) ? v.length === 0 : (v && typeof v === 'object' ? Object.keys(v).length === 0 : v === null)); });
    ok(tomt && (L[a].staff || []).length <= 1, `punkt 7 (E): ${a} (${U[a].role}) får inga verksamhetsdata (inställningar, återkommande, artiklar, kunder …), bara den egna personalposten — baslinjefyndet vänt`, Object.keys(L[a]).filter((k) => JSON.stringify(L[a][k]).length > 2));
  }
  ok(ids(L.falt.recurringOrders) === 'REC-R1' && !harNagot(L.falt.recurringOrders, /TEST-REC/) && ids(L.chef.recurringOrders) === 'REC-R1,REC-R2',
    'punkt 7 (åtkomst per post): fältet får bara det återkommande ärende som hör till egen AO, utan portkod; arbetsledaren alla');
  ok(ids(L.falt.projects) === 'PRJ-1' && ids(L.falt.avvikelser) === 'AVV-1' && (L.falt.inspections || []).length === 0 && ids(L.chef.projects) === 'PRJ-1,PRJ-2,PRJ-3' && ids(L.chef.avvikelser) === 'AVV-1,AVV-2,AVV-3',
    'punkt 7 (åtkomst per post): projekt och avvikelser bara för egna AO, inga inspektioner för fältet; kundregistrets läsare alla');
  ok(ids(L.begransad.projects) === '' && ids(L.std_begransad.projects) === 'PRJ-1', 'punkt 7: begränsad ser bara poster för AO där den är tilldelad');

  // staff_contacts_view (T3-D 2, T3-E 4) och activity_log_view_all (T3-D 6)
  const kontakter = (a) => (L[a].staff || []).filter((x) => x.id !== U[a].staffId && ('phone' in x || 'email' in x)).length;
  ok(kontakter('chef') > 10 && kontakter('ekonomi') > 10 && kontakter('falt') > 10, 'staff_contacts_view (övergång): äldre roller utan T4:s nya behörigheter behåller T3-E:s härledning (interna kollegor får arbetskontakt)');
  ok(kontakter('std_chef') > 10 && kontakter('std_ekonomi') > 10 && kontakter('std_personal') > 10 && kontakter('ny_chef') > 10, 'staff_contacts_view: standardrollerna chef, ekonomi och personal (och egen roll med behörigheten) får arbetskontakt');
  ok(kontakter('std_begransad') === 0 && kontakter('begransad') === 0, 'staff_contacts_view: begransad saknar den (standard), ingen arbetskontakt');
  ok(kontakter('ny_utan_kontakt') === 0 && kontakter('begr_kontakt') > 10, 'staff_contacts_view uttrycklig: en ny roll utan behörigheten får ingen arbetskontakt även med ao_view_all m.fl.; begränsad + behörigheten får den');
  const LOGG_ALLA = ids(val(db, 'vift_activityLog'));
  ok(ids(L.chef.activityLog) === LOGG_ALLA && ids(L.ekonomi.activityLog) === LOGG_ALLA && ids(L.std_chef.activityLog) === LOGG_ALLA && ids(L.std_ekonomi.activityLog) === LOGG_ALLA && ids(L.ny_utan_kontakt.activityLog) === LOGG_ALLA,
    'activity_log_view_all: hela loggen för standardrollerna chef och ekonomi, egen roll med behörigheten, och (övergång) äldre roller med ao_view_all');
  ok(ids(L.ny_chef.activityLog) !== LOGG_ALLA && (L.ny_chef.activityLog || []).every((e) => e.workOrderId), 'activity_log_view_all: en ny roll med ao_view_all men utan behörigheten får inte hela loggen (bara AO-händelser för AO där den är tilldelad)');
  // REST (R)
  const rest = (a, key) => { const x = asUser(db, U[a], `select key from public.store where key = ${lit(key)}`); return x.ok ? x.rows.length : 'fel'; };
  ok(rest('chef_utan_faktura', 'vift_propertyObjects') === 0 && rest('chef', 'vift_customers') === 0 && rest('falt', 'vift_articles') === 0 && rest('adminhanterare', 'vift_settings') === 0 && rest('tom', 'vift_settings') === 0 && rest('inaktiv', 'vift_workOrders') === 0,
    'REST (R): hela värdet bara med läsrätt till alla skyddade fält — skrivare utan objects_sensitive (objekt), utan personal_data_view (kunder), utan cost_view (artiklar, inställningar), tom och inaktiverad roll får tom lista');
  ok(rest('admin', 'vift_customers') === 1 && rest('std_chef', 'vift_articles') === 1 && rest('kostnad', 'vift_settings') === 1 && rest('chef', 'vift_propertyObjects') === 1, 'REST (R): med alla läsrättigheter syns raden som förut');

  // work-orders-list och skrivsvar (E): projectWorkOrder
  s = await ef.anropa('work-orders-list', { user: U.chef_utan_faktura });
  ok(s.status === 200 && (s.body.workOrders || []).length > 10 && !(s.body.workOrders || []).some((a) => 'accessCode' in a || (a.materials || []).some((m) => 'buyPrice' in m)) && s.body.workOrders.every((a) => 'fixedPrice' in a),
    'SÄK-7 / SEC-AO-18 (E): work-orders-list till ao_edit utan objects_sensitive och cost_view: ingen portkod, inget inköpspris, AO-ekonomin finns (D-06) — baslinjefyndet vänt');
  s = await ef.anropa('work-orders-list', { user: U.falt });
  ok(!(s.body.workOrders || []).some((a) => 'fixedPrice' in a || 'accessCode' in a || (a.materials || []).some((m) => 'buyPrice' in m)) && (s.body.workOrders || []).every((a) => a.poolProjection || 'priceType' in a),
    'D-06 (E): fältet får AO utan fastpris, portkod och inköpspris men med debiteringskategorin');
  s = await ef.anropa('work-orders-list', { user: U.std_chef });
  ok((s.body.workOrders || []).some((a) => a.accessCode) && (s.body.workOrders || []).some((a) => (a.materials || []).some((m) => m.buyPrice === 50)), 'SEC-B1-11 (E): standardrollen chef (objects_sensitive, cost_view) får portkod och inköpspris');
  s = await ef.anropa('work-orders-list', { user: U.inaktiv });
  ok(s.status === 200 && (s.body.workOrders || []).length === 0, 'punkt 7 (E): inaktiverad roll får inga AO — baslinjefyndet vänt');
  aterstall();
  s = await ef.anropa('work-order-log-write', { user: U.falt, body: { action: 'append_log', aoId: 'AO-A1', entry: { id: 'L-T4-1', type: 'note', text: 'x' } } });
  ok(s.status === 200 && s.body.workOrder && !('accessCode' in s.body.workOrder) && !s.body.workOrder.materials.some((m) => 'buyPrice' in m) && !('fixedPrice' in s.body.workOrder),
    'SÄK-7 (E): svaret från work-order-log-write projiceras (ingen portkod, inget inköpspris, ingen AO-ekonomi till fältet) — baslinjefyndet vänt');
  s = await ef.anropa('work-order-checklist-resolve', { user: U.falt, body: { aoId: 'AO-A1', itemId: 'AO-A1-C1', action: 'done' } });
  ok(s.status === 200 && s.body.workOrder && !('accessCode' in s.body.workOrder), 'SÄK-7 (E): svaret från work-order-checklist-resolve projiceras');
  aterstall();

  // ════════════════ Skrivning: fältvis sammanslagning (E, P) ════════════════
  // SEC-B5-02/03: skrivaren utan objects_sensitive
  let o1 = await elem(ef, U.chef_utan_faktura, 'vift_propertyObjects', 'OBJ-R1');
  ok(o1 && !SENS.some((f) => f in o1), 'skrivaren läser objektet utan skyddade fält');
  await JA('SEC-B5-02 (E): spara objekt utan skyddade fält → 200', () => merge(U.chef_utan_faktura, 'vift_propertyObjects', [{ id: 'OBJ-R1', data: Object.assign({}, o1, { name: 'Lgh 1001 B' }), previous: o1 }]), ['store:vift_propertyObjects']);
  let lagrat = val(db, 'vift_propertyObjects').find((x) => x.id === 'OBJ-R1');
  ok(lagrat.name === 'Lgh 1001 B' && lagrat.doorCode === 'TEST-1001' && lagrat.keyInformation === 'Nyckel i testskåp A' && lagrat.accessInformation === 'Ring på', 'SEC-B5-02: portkod, nyckel- och tillträdesinformation oförändrade (projicerat värde raderar inget)');
  o1 = await elem(ef, U.chef_utan_faktura, 'vift_propertyObjects', 'OBJ-R1');
  await NEJ('SEC-B5-03 (E): doorCode:\'\' → 403 field_protected', () => merge(U.chef_utan_faktura, 'vift_propertyObjects', [{ id: 'OBJ-R1', data: Object.assign({}, o1, { doorCode: '' }), previous: o1 }]), { status: 403, error: 'forbidden', reason: 'field_protected' });
  await NEJ('SEC-B5-03 (E): doorCode:\'1234\' → 403 field_protected', () => merge(U.chef_utan_faktura, 'vift_propertyObjects', [{ id: 'OBJ-R1', data: Object.assign({}, o1, { doorCode: '1234' }), previous: o1 }]), { status: 403, error: 'forbidden', reason: 'field_protected' });
  await NEJ('SEC-B5-03 (E): samma portkod som lagrad (oläsbart fält) → 403 field_protected (inget orakel)', () => merge(U.chef_utan_faktura, 'vift_propertyObjects', [{ id: 'OBJ-R1', data: Object.assign({}, o1, { doorCode: 'TEST-1001' }), previous: o1 }]), { status: 403, error: 'forbidden', reason: 'field_protected' });
  await NEJ('SEC-B5-03 (E): ny post med portkod → 403 field_protected', () => merge(U.chef_utan_faktura, 'vift_propertyObjects', [{ id: 'OBJ-NY', data: { id: 'OBJ-NY', propertyId: 'PROP-R1', name: 'Ny', doorCode: '9999' }, previous: null }]), { status: 403, error: 'forbidden', reason: 'field_protected' });
  await JA('ny post med tom portkod ur klientens schema → 200', () => merge(U.chef_utan_faktura, 'vift_propertyObjects', [{ id: 'OBJ-NY', data: { id: 'OBJ-NY', propertyId: 'PROP-R1', name: 'Ny', doorCode: '', keyInformation: '' }, previous: null }]), ['store:vift_propertyObjects']);
  { /* Konflikt i writeMerge skriver tillbaka samma värde (updated_at flyttas, som T3-D dokumenterat):
       här jämförs värdets md5. */
    const full = val(db, 'vift_propertyObjects').find((x) => x.id === 'OBJ-R1');
    const v0 = JSON.stringify(val(db, 'vift_propertyObjects'));
    const x = await merge(U.chef_utan_faktura, 'vift_propertyObjects', [{ id: 'OBJ-R1', data: Object.assign({}, full, { name: 'X' }), previous: full }]);
    ok(x.status === 200 && (x.body.conflicts || []).length === 1 && (x.body.applied || []).length === 0 && !harNagot(x.body, PORT_RE) && JSON.stringify(val(db, 'vift_propertyObjects')) === v0,
      'äldre klient: hela objektet (med portkod) som previous → konflikt, inget skrivs (värdet oförändrat) och svaret lämnar inte ut portkoden', x.body);
  }
  await JA('SEC-B5 (P, RPC direkt): skrivningen av hela listan (store_business_key_write) bevarar portkoderna', async () => {
    const proj = val(db, 'vift_propertyObjects').map((x) => utan(x, SENS));
    const h = q(db, `select encode(sha256(convert_to(value::text, 'UTF8')), 'hex') as h from public.store where key = 'vift_propertyObjects'`)[0].h;
    const x = rpc(db, 'store_business_key_write', { p_key: 'vift_propertyObjects', p_new_value: proj.map((e) => (e.id === 'OBJ-R2' ? Object.assign({}, e, { name: 'Lokal 1B' }) : e)), p_expected_hash: h, p_caller_authorized: true, p_actor_id: U.chef_utan_faktura.staffId });
    return { status: x.error ? 500 : 200, body: x.error };
  }, ['store:vift_propertyObjects']);
  lagrat = val(db, 'vift_propertyObjects').find((x) => x.id === 'OBJ-R2');
  ok(lagrat.name === 'Lokal 1B' && lagrat.doorCode === 'TEST-2002' && lagrat.keyInformation === 'Nyckelbricka B', 'SEC-B5 (P): portkoden finns kvar efter skrivning av hela listan med projicerat värde');
  { const x = rpc(db, 'store_business_key_write', { p_key: 'vift_propertyObjects', p_new_value: val(db, 'vift_propertyObjects').map((e) => (e.id === 'OBJ-R2' ? Object.assign({}, e, { doorCode: 'X' }) : e)),
      p_expected_hash: q(db, `select encode(sha256(convert_to(value::text, 'UTF8')), 'hex') as h from public.store where key = 'vift_propertyObjects'`)[0].h, p_caller_authorized: true, p_actor_id: U.chef_utan_faktura.staffId });
    ok(x.error && /forbidden:field_protected/.test(x.error.message), 'SEC-B5-03 (P, RPC direkt): ändrad portkod i hela listan → forbidden:field_protected', x.error); }
  aterstall();

  // SEC-KUND-05/06 (personal_data_view)
  let k1 = await elem(ef, U.chef, 'vift_customers', 'CU-R1');
  ok(k1 && !('personnr' in k1) && !('orgNr' in k1) && k1.type === 'privat', 'arbetsledaren (utan personal_data_view) läser privatkunden utan personnummer och org.nr');
  await JA('SEC-KUND-05 (E): spara testkund utan personnr → 200', () => merge(U.chef, 'vift_customers', [{ id: 'CU-R1', data: Object.assign({}, k1, { phone: '070-111 11 11' }), previous: k1 }]), ['store:vift_customers']);
  lagrat = val(db, 'vift_customers').find((x) => x.id === 'CU-R1');
  ok(lagrat.personnr === '19800101-0000' && lagrat.phone === '070-111 11 11', 'SEC-KUND-05: lagrat personnr oförändrat (fältvis sammanslagning)');
  k1 = await elem(ef, U.chef, 'vift_customers', 'CU-R1');
  await NEJ('SEC-KUND-06 (E): spara testkund med personnr:\'X\' → 403 field_protected', () => merge(U.chef, 'vift_customers', [{ id: 'CU-R1', data: Object.assign({}, k1, { personnr: 'X' }), previous: k1 }]), { status: 403, error: 'forbidden', reason: 'field_protected' });
  await NEJ('SEC-KUND-06 (E): tömma personnr → 403 field_protected', () => merge(U.chef, 'vift_customers', [{ id: 'CU-R1', data: Object.assign({}, k1, { personnr: '' }), previous: k1 }]), { status: 403, error: 'forbidden', reason: 'field_protected' });
  const k4 = await elem(ef, U.chef, 'vift_customers', 'CU-R4');
  await NEJ('D-13: typbyte privatperson → företag utan personal_data_view när ett org.nr (äldre personnummer) är lagrat → 403 field_protected', () => merge(U.chef, 'vift_customers', [{ id: 'CU-R4', data: Object.assign({}, k4, { type: 'foretag', name: 'Bolag' }), previous: k4 }]), { status: 403, error: 'forbidden', reason: 'field_protected' });
  const k2 = await elem(ef, U.chef, 'vift_customers', 'CU-R2');
  await JA('D-13: företagskundens org.nr får ändras utan personal_data_view → 200', () => merge(U.chef, 'vift_customers', [{ id: 'CU-R2', data: Object.assign({}, k2, { orgNr: '556000-0001' }), previous: k2 }]), ['store:vift_customers']);
  const kp = await elem(ef, U.pdv, 'vift_customers', 'CU-R1');
  await JA('SEC-KUND-04 (E): personal_data_view får ändra personnummer → 200', () => merge(U.pdv, 'vift_customers', [{ id: 'CU-R1', data: Object.assign({}, kp, { personnr: '19800101-0001' }), previous: kp }]), ['store:vift_customers']);
  ok(val(db, 'vift_customers').find((x) => x.id === 'CU-R1').personnr === '19800101-0001', 'SEC-KUND-04: personnumret ändrat');
  aterstall();

  // Inställningar (SEC-INST-01..07, D-17), bara lokalt
  const st0 = (await las1(ef, U.adminhanterare, 'vift_settings'));
  await NEJ('SEC-INST-03 (E, writeMerge): admin_manage utan bankgiro_edit ändrar bankgiro → 403 field_protected', () => merge(U.adminhanterare, 'vift_settings', [{ id: 'bankgiro', data: '111-1111', previous: '000-0000' }]), { status: 403, error: 'forbidden', reason: 'field_protected' });
  await NEJ('SEC-INST-03 (E, write): hela värdet med ändrat bankgiro → 403 field_protected', () => SK(ef, U.adminhanterare, { action: 'write', key: 'vift_settings', value: Object.assign({}, st0.value, { bankgiro: '111-1111' }), expectedHash: st0.hash }), { status: 403, error: 'forbidden', reason: 'field_protected' });
  await NEJ('SEC-B2-06 (E): intern timkostnad utan cost_view (previous null) → 403 field_protected', () => merge(U.adminhanterare, 'vift_settings', [{ id: 'internalHourlyCost', data: 1, previous: null }]), { status: 403, error: 'forbidden', reason: 'field_protected' });
  await NEJ('cost_view utan cost_edit: ändra intern timkostnad → 403 field_protected', () => merge(U.kostnad, 'vift_settings', [{ id: 'internalHourlyCost', data: 1, previous: 400 }]), { status: 403, error: 'forbidden', reason: 'field_protected' });
  await JA('SEC-INST-04 (E, write): spara annan inställning med projicerat värde utan intern timkostnad → 200', () => SK(ef, U.adminhanterare, { action: 'write', key: 'vift_settings', value: Object.assign({}, st0.value, { companyName: 'Nytt namn' }), expectedHash: st0.hash }), ['store:vift_settings']);
  lagrat = val(db, 'vift_settings');
  ok(lagrat.companyName === 'Nytt namn' && lagrat.bankgiro === '000-0000' && lagrat.internalHourlyCost === 400, 'SEC-INST-04: bankgiro och intern timkostnad oförändrade');
  await JA('SEC-INST-04 (E, writeMerge): annat fält fält för fält → 200', () => merge(U.adminhanterare, 'vift_settings', [{ id: 'slogan', data: 'Ny slogan', previous: null }]), ['store:vift_settings']);
  ok(val(db, 'vift_settings').internalHourlyCost === 400 && val(db, 'vift_settings').slogan === 'Ny slogan', 'D-17: fältvis sammanslagning lägger till fältet och rör inget annat');
  await JA('D-17 (E): bankgiro_edit ändrar bankgiro → 200', () => merge(U.bankgiro, 'vift_settings', [{ id: 'bankgiro', data: '222-2222', previous: '000-0000' }]), ['store:vift_settings']);
  ok(val(db, 'vift_settings').bankgiro === '222-2222', 'D-17: bankgiro ändrat av bankgiro_edit');
  await NEJ('SEC-INST-06 (E): standardrollen ekonomi write vift_settings → 403 forbidden', () => SK(ef, U.std_ekonomi, { action: 'writeMerge', key: 'vift_settings', upserts: [{ id: 'slogan', data: 'x', previous: 'Ny slogan' }], removals: [] }), { status: 403, error: 'forbidden', reason: null });
  await NEJ('SEC-INST-06 (E): fältet write vift_settings → 403 forbidden', () => SK(ef, U.falt, { action: 'write', key: 'vift_settings', value: {}, expectedHash: 'x' }), { status: 403, error: 'forbidden', reason: null });
  await NEJ('SEC-INST-07 (E): write utan hash → 409 missing_expected_hash', () => SK(ef, U.admin, { action: 'write', key: 'vift_settings', value: { companyName: 'x' } }), { status: 409, error: 'missing_expected_hash' });
  await NEJ('SEC-INST-07 (E): write med inaktuell hash → 409 stale_write', () => SK(ef, U.admin, { action: 'write', key: 'vift_settings', value: { companyName: 'x' }, expectedHash: st0.hash }), { status: 409, error: 'stale_write' });
  aterstall();

  // Artiklar (cost_edit)
  const a1 = await elem(ef, U.artikel, 'vift_articles', 'ART-R1');
  ok(a1 && !('buyPrice' in a1), 'article_manage utan cost_view läser artikeln utan inköpspris');
  await JA('artikel (E): article_manage utan cost_edit sparar artikelns namn → 200, inköpspriset bevaras', () => merge(U.artikel, 'vift_articles', [{ id: 'ART-R1', data: Object.assign({}, a1, { name: 'Ny' }), previous: a1 }]), ['store:vift_articles']);
  ok(val(db, 'vift_articles')[0].buyPrice === 50 && val(db, 'vift_articles')[0].markup === 100, 'inköpspris och påslag oförändrade');
  const a1b = await elem(ef, U.artikel, 'vift_articles', 'ART-R1');
  await NEJ('SEC-B1-14 / SEC-CUST-02 (E): sätta inköpspris utan cost_edit → 403 field_protected', () => merge(U.artikel, 'vift_articles', [{ id: 'ART-R1', data: Object.assign({}, a1b, { buyPrice: 1 }), previous: a1b }]), { status: 403, error: 'forbidden', reason: 'field_protected' });
  await NEJ('SEC-B1-17 (E): fältet writeMerge vift_articles → 403 forbidden', () => merge(U.falt, 'vift_articles', [{ id: 'ART-R1', data: Object.assign({}, a1b, { name: 'x' }), previous: a1b }]), { status: 403, error: 'forbidden', reason: null });
  const a1a = await elem(ef, U.admin, 'vift_articles', 'ART-R1');
  await JA('SEC-B1-13 (E): cost_edit (admin) kompletterar inköpspris → 200', () => merge(U.admin, 'vift_articles', [{ id: 'ART-R1', data: Object.assign({}, a1a, { buyPrice: 55 }), previous: a1a }]), ['store:vift_articles']);
  aterstall();

  // work_order_patch och create_ao (AO)
  const KS_AO = { keys: ['vift_workOrders'], tables: ['op_idempotency'] };
  const patch = (user, aoId, p, key) => ef.anropa('ao-time-write', { user, body: { action: 'patch_ao', aoId, patch: p, idempotencyKey: key } });
  await NEJ('SÄK-7 (E): ao_edit utan objects_sensitive sätter AO:ns portkod → 403 field_protected', () => patch(U.chef_utan_faktura, 'AO-A1', { accessCode: '9999' }, 't4a-ao1'), { status: 403, error: 'forbidden', reason: 'field_protected' }, KS_AO);
  await NEJ('SÄK-7 (E): ao_edit utan objects_sensitive tömmer AO:ns portkod → 403 field_protected', () => patch(U.chef_utan_faktura, 'AO-A1', { accessCode: '' }, 't4a-ao2'), { status: 403, error: 'forbidden', reason: 'field_protected' }, KS_AO);
  s = await patch(U.chef_utan_faktura, 'AO-A1', { title: 'Ny titel' }, 't4a-ao3');
  ok(s.status === 200 && !('accessCode' in s.body.workOrder) && val(db, 'vift_workOrders').find((a) => a.id === 'AO-A1').accessCode === 'TEST-PORT-AO-A1', 'SÄK-7 (E): patch utan portkod bevarar den lagrade; svaret saknar portkoden');
  const mats = val(db, 'vift_workOrders').find((a) => a.id === 'AO-A1').materials.map((m) => utan(m, ['buyPrice']));
  s = await patch(U.chef_utan_faktura, 'AO-A1', { materials: mats.map((m) => Object.assign({}, m, { qty: 4 })).concat([{ id: 'M-NY1', name: 'Ny', qty: 1, buyPrice: 77 }]) }, 't4a-ao4');
  const efterM = val(db, 'vift_workOrders').find((a) => a.id === 'AO-A1').materials;
  ok(s.status === 200 && efterM[0].buyPrice === 50 && efterM[0].qty === 4 && !('buyPrice' in efterM.find((m) => m.id === 'M-NY1')) && JSON.stringify(s.body.ignoredFields) === '["materials[].buyPrice"]',
    'B1 (E): materiallistan utan inköpspris (projicerad) bevarar det lagrade; ny rad med inköpspris utan cost_edit ignoreras (ignoredFields, serverpris i T4-B)');
  await NEJ('SEC-B1-14 (E): ändrat inköpspris på befintlig rad utan cost_edit → 403 field_protected', () => patch(U.chef_utan_faktura, 'AO-A1', { materials: efterM.map((m) => utan(m, ['buyPrice'])).map((m, i) => (i === 0 ? Object.assign({}, m, { buyPrice: 1 }) : m)) }, 't4a-ao5'), { status: 403, error: 'forbidden', reason: 'field_protected' }, KS_AO);
  await NEJ('äldre fältklient: annans rad med inköpspris → 403 field_protected (inget orakel), inget ändrat', () => patch(U.falt, 'AO-A1', { materials: val(db, 'vift_workOrders').find((a) => a.id === 'AO-A1').materials.concat([{ id: 'M-F', name: 'x', qty: 1 }]) }, 't4a-ao6'), { status: 403, error: 'forbidden', reason: 'field_protected' }, KS_AO);
  s = await patch(U.falt, 'AO-A1', { materials: val(db, 'vift_workOrders').find((a) => a.id === 'AO-A1').materials.map((m) => utan(m, ['buyPrice'])).concat([{ id: 'M-F', name: 'x', qty: 1 }]) }, 't4a-ao7');
  ok(s.status === 200 && val(db, 'vift_workOrders').find((a) => a.id === 'AO-A1').materials[0].buyPrice === 50 && !s.body.workOrder.materials.some((m) => 'buyPrice' in m), 'fältet lägger till egen rad i sin vy (utan inköpspris): 200, andras inköpspris bevaras, svaret utan inköpspris');
  s = await patch(U.std_chef, 'AO-A1', { materials: val(db, 'vift_workOrders').find((a) => a.id === 'AO-A1').materials.map((m, i) => (i === 0 ? Object.assign({}, m, { buyPrice: 60 }) : m)) }, 't4a-ao8');
  ok(s.status === 200 && val(db, 'vift_workOrders').find((a) => a.id === 'AO-A1').materials[0].buyPrice === 60, 'cost_edit (standardrollen chef) ändrar inköpspriset → 200');
  const nyAo = { id: 'AO-T4A-1', title: 'Ny', status: 'nytt', staff: [], accessCode: '1234', materials: [] };
  await NEJ('SÄK-7 (E): create_ao med portkod utan objects_sensitive → 403 field_protected', () => ef.anropa('ao-time-write', { user: U.chef_utan_faktura, body: { action: 'create_ao', ao: nyAo, idempotencyKey: 't4a-c1' } }), { status: 403, error: 'forbidden', reason: 'field_protected' }, KS_AO);
  s = await ef.anropa('ao-time-write', { user: U.chef_utan_faktura, body: { action: 'create_ao', ao: Object.assign({}, nyAo, { accessCode: '', materials: [{ id: 'M1', name: 'x', qty: 1, buyPrice: 9 }] }), idempotencyKey: 't4a-c2' } });
  ok(s.status === 200 && JSON.stringify(s.body.ignoredFields) === '["materials[].buyPrice"]' && !('buyPrice' in val(db, 'vift_workOrders').find((a) => a.id === 'AO-T4A-1').materials[0]), 'create_ao med tom portkod → 200; inköpspris i ny rad utan cost_edit ignoreras');
  aterstall();

  // ════════════════ Samtidighet under radlås (SEC-B5-04/05, SEC-INST-05) ════════════════
  { // SEC-B5-05: arbetsledare med inaktuell läsning sparar namn efter ADM:s portkodsändring
    const fore = await elem(ef, U.chef_utan_faktura, 'vift_propertyObjects', 'OBJ-R1');
    const full = await elem(ef, U.admin, 'vift_propertyObjects', 'OBJ-R1');
    let x = await merge(U.admin, 'vift_propertyObjects', [{ id: 'OBJ-R1', data: Object.assign({}, full, { doorCode: 'NY-ADM' }), previous: full }]);
    ok(x.status === 200 && x.body.conflicts.length === 0, 'SEC-B5-05: ADM ändrar portkoden');
    x = await merge(U.chef_utan_faktura, 'vift_propertyObjects', [{ id: 'OBJ-R1', data: Object.assign({}, fore, { name: 'Namn AL' }), previous: fore }]);
    const o = val(db, 'vift_propertyObjects').find((e) => e.id === 'OBJ-R1');
    ok(x.status === 200 && x.body.conflicts.length === 0 && o.doorCode === 'NY-ADM' && o.name === 'Namn AL', 'SEC-B5-05 (P under radlås): AL:s sparning med inaktuell läsning gäller; portkoden är ADM:s nya värde');
    aterstall();
  }
  { // SEC-B5-04: ×20 samtidigt, ADM ändrar portkod och AL ändrar namn, med barriär
    let fel = 0, alla200 = 0, konflikter = 0;
    await upprepa(20, async (i) => {
      aterstall();
      const fore = await elem(ef, U.chef_utan_faktura, 'vift_propertyObjects', 'OBJ-R1');
      const full = await elem(ef, U.admin, 'vift_propertyObjects', 'OBJ-R1');
      ef.barriar('store_business_key_merge_write', 2);
      const [a, b] = await Promise.all([
        merge(U.admin, 'vift_propertyObjects', [{ id: 'OBJ-R1', data: Object.assign({}, full, { doorCode: 'P-' + i }), previous: full }]),
        merge(U.chef_utan_faktura, 'vift_propertyObjects', [{ id: 'OBJ-R1', data: Object.assign({}, fore, { name: 'N-' + i }), previous: fore }]),
      ]);
      const o = val(db, 'vift_propertyObjects').find((e) => e.id === 'OBJ-R1');
      const aOk = a.status === 200 && a.body.conflicts.length === 0, bOk = b.status === 200 && b.body.conflicts.length === 0;
      if (aOk && bOk) alla200++;
      if (!aOk || !bOk) konflikter++;
      // Ingen ändring förloras tyst: varje bekräftad ändring finns i slutvärdet, och en konflikt ändrar inget.
      if ((aOk && o.doorCode !== 'P-' + i) || (bOk && o.name !== 'N-' + i) || (!aOk && o.doorCode !== 'TEST-1001') || (!bOk && o.name !== 'Lgh 1001')) fel++;
      if (!o.doorCode || !o.keyInformation) fel++;
    });
    ok(fel === 0 && alla200 + konflikter === 20 && alla200 > 0, `SEC-B5-04 (×20, parallella anrop, radlås): ingen bekräftad ändring förlorad och portkoden aldrig raderad; båda ändringarna kvar i ${alla200} körningar, i övriga nekades ADM:s inaktuella element som konflikt utan mutation`, { fel, alla200, konflikter });
  }
  { // SEC-INST-05: två administratörer ändrar olika fält samtidigt ×20
    let fel = 0;
    await upprepa(20, async (i) => {
      aterstall();
      ef.barriar('store_business_key_merge_write', 2);
      const [a, b] = await Promise.all([
        merge(U.admin, 'vift_settings', [{ id: 'companyName', data: 'A-' + i, previous: 'Testföretaget (syntetiskt)' }]),
        merge(U.admin2, 'vift_settings', [{ id: 'slogan', data: 'B-' + i, previous: null }]),
      ]);
      const v = val(db, 'vift_settings');
      if (a.status !== 200 || b.status !== 200 || a.body.conflicts.length || b.body.conflicts.length || v.companyName !== 'A-' + i || v.slogan !== 'B-' + i || v.bankgiro !== '000-0000' || v.internalHourlyCost !== 400) fel++;
    });
    ok(fel === 0, 'SEC-INST-05 (×20, parallella anrop, radlås): två administratörer ändrar olika fält samtidigt — båda finns kvar, inget annat ändrat', fel);
    let vinnare = 0, fel2 = 0;
    await upprepa(20, async (i) => {
      aterstall();
      ef.barriar('store_business_key_merge_write', 2);
      const [a, b] = await Promise.all([
        merge(U.admin, 'vift_settings', [{ id: 'companyName', data: 'A-' + i, previous: 'Testföretaget (syntetiskt)' }]),
        merge(U.admin2, 'vift_settings', [{ id: 'companyName', data: 'B-' + i, previous: 'Testföretaget (syntetiskt)' }]),
      ]);
      const ap = a.body.applied || [], bp = b.body.applied || [];
      const n = (ap.length ? 1 : 0) + (bp.length ? 1 : 0);
      if (n === 1) vinnare++; else fel2++;
      const v = val(db, 'vift_settings').companyName;
      if (!((ap.length && v === 'A-' + i) || (bp.length && v === 'B-' + i))) fel2++;
    });
    ok(vinnare === 20 && fel2 === 0, 'D-17 (×20): samma fält samtidigt — exakt en vinner, den andra får konflikt (inget skrivs över tyst)', { vinnare, fel2 });
    aterstall();
  }

  // ════════════════ Rollskrivning: äldre klient tappar inga behörigheter (T3-E-beslutet) ════════════════
  const satsPersonal = (perms) => psql(db, `update public.store set value = (select jsonb_agg(case when e->>'id' = 'personal' then e || ${jlit({ permissions: perms })}::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_roles'`);
  satsPersonal(['dashboard_view', 'ao_view_own', 'ao_complete', 'ao_time', 'ao_material', 'ao_checklist', 'customer_view', 'cost_view', 'staff_contacts_view']);
  let pr = await elem(ef, U.admin, 'vift_roles', 'personal');
  s = await merge(U.admin, 'vift_roles', [{ id: 'personal', data: Object.assign({}, pr, { permissions: ['dashboard_view', 'ao_view_own', 'ao_complete', 'ao_time', 'ao_material'] }), previous: pr }]);
  let perms = val(db, 'vift_roles').find((x) => x.id === 'personal').permissions;
  ok(s.status === 200 && !perms.includes('ao_checklist') && ['customer_view', 'cost_view', 'staff_contacts_view'].every((x) => perms.includes(x)),
    'T3-E-beslutet (v3.4-klient, utan katalogmarkör): behörigheter utanför v3.4-katalogen (customer_view, cost_view, staff_contacts_view) bevaras; en borttagen behörighet ur katalogen (ao_checklist) tas bort — baslinjefyndet vänt', perms);
  pr = await elem(ef, U.admin, 'vift_roles', 'personal');
  s = await merge(U.admin, 'vift_roles', [{ id: 'personal', data: Object.assign({}, pr, { permissions: pr.permissions.filter((x) => x !== 'cost_view') }), previous: pr }]);
  ok(s.status === 200 && val(db, 'vift_roles').find((x) => x.id === 'personal').permissions.includes('cost_view'), 'T3-klient (katalog med cost_view men utan markör): cost_view bevaras (ingen förlust; T4-klienten krävs för att ta bort den)');
  pr = await elem(ef, U.admin, 'vift_roles', 'personal');
  s = await merge(U.admin, 'vift_roles', [{ id: 'personal', data: Object.assign({}, pr, { permissions: pr.permissions.filter((x) => x !== 'cost_view') }), previous: pr }], [], { behorighetskatalog: 4 });
  ok(s.status === 200 && !val(db, 'vift_roles').find((x) => x.id === 'personal').permissions.includes('cost_view'), 'T4-klient (behorighetskatalog 4): borttagningen av cost_view gäller');
  { const r0 = val(db, 'vift_roles'); const h = q(db, `select encode(sha256(convert_to(value::text, 'UTF8')), 'hex') as h from public.store where key = 'vift_roles'`)[0].h;
    s = await SK(ef, U.admin, { action: 'write', key: 'vift_roles', value: r0.map((x) => (x.id === 'personal' ? Object.assign({}, x, { permissions: ['dashboard_view'] }) : x)), expectedHash: h });
    perms = val(db, 'vift_roles').find((x) => x.id === 'personal').permissions;
    ok(s.status === 200 && perms.includes('customer_view') && perms.includes('staff_contacts_view') && !perms.includes('ao_time'), 'samma skydd i skrivning av hela rollregistret (write)', perms); }
  { const el = val(db, 'vift_roles').find((x) => x.id === 'admin');
    await NEJ('invarianten (D-25, T4-A): den enda superadministratörens roll inaktiveras → 409 last_superadmin', () => merge(U.admin, 'vift_roles', [{ id: 'admin', data: Object.assign({}, el, { active: false }), previous: el }]), { status: 409, error: 'last_superadmin' }, { keys: ['vift_roles', 'vift_staff'] }); }
  aterstall();

  // ════════════════ Ägarkontroll vid bildradering (punkt 7) ════════════════
  const bild = (user, p) => ef.anropa('work-order-image-delete', { user, body: { aoId: 'AO-A1', path: p } });
  await NEJ('bildradering (E): fältet raderar bild som FÄ2:s loggpost refererar → 403 not_own', () => bild(U.falt, 'AO-A1/annans.jpg'), { status: 403, error: 'forbidden', reason: 'not_own' }, KS_AO);
  await NEJ('bildradering (E): fältet raderar checklistans avvikelsebild → 403 not_own', () => bild(U.falt, 'AO-A1/avvikelse.jpg'), { status: 403, error: 'forbidden', reason: 'not_own' }, KS_AO);
  s = await bild(U.falt, 'AO-A1/egen.jpg'); ok(s.status === 200, 'bildradering (E): egen loggposts bild → 200');
  s = await bild(U.falt, 'AO-A1/ingen-refererar.jpg'); ok(s.status === 200, 'bildradering (E): bild som ingen post refererar (borttagen egen post, avbruten uppladdning) → 200');
  s = await bild(U.chef, 'AO-A1/annans.jpg'); ok(s.status === 200, 'bildradering (E): ao_edit (arbetsledare) raderar annans bild → 200');

  // ════════════════ Ej verkställda behörigheter (T3-E-registret) ════════════════
  const ejv = q(db, `select unnest(public._vift_ej_verkstallda()) as x`).map((x) => x.x).sort();
  /* T4-A-läget: time_view_all och objects_access_assigned är ännu inte verkställda (T4-B respektive T4-C tar bort dem
     ur registret och ur standardroller.json; filen speglar det senaste paketet). */
  const senareVerkstallda = ['time_view_all', 'objects_access_assigned', 'rondering_utfor'].filter((x) => !Object.keys(STD.ejVerkstallda).includes(x));
  ok(JSON.stringify(ejv) === JSON.stringify(Object.keys(STD.ejVerkstallda).concat(senareVerkstallda).sort()) && ejv.length === 6 && !ejv.some((x) => ['cost_view', 'cost_edit', 'personal_data_view', 'bankgiro_edit'].includes(x)),
    '_vift_ej_verkstallda(): cost_view, cost_edit, personal_data_view och bankgiro_edit borttagna (verkställda i T4-A); registret = standardroller.json ejVerkstallda (6)', ejv);
  ok(['ao_plan_own', 'time_view_all', 'objects_access_assigned', 'rondering_utfor', 'export_data', 'export_personal_data'].every((x) => ejv.includes(x)), 'kvar som ej verkställda: ao_plan_own (AO-etappen), time_view_all (T4-B), objects_access_assigned (T4-C), rondering_utfor (T4-D), export_data och export_personal_data (T4-F)');
  { // varje nyverkställd behörighet ger exakt den beslutade åtkomsten, och inget mer
    const prof = async (perms) => { psql(db, `update public.store set value = (select jsonb_agg(case when e->>'id' = 'tom' then e || ${jlit({ permissions: perms })}::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_roles'`);
      const x = ((await lasAlla(ef, U.tom, ['vift_customers', 'vift_articles', 'vift_settings', 'vift_propertyObjects', 'vift_staff'])).body || {}).data || {};
      const w = (await ef.anropa('work-orders-list', { user: U.tom })).body.workOrders || [];
      return { x, w }; };
    const bas = await prof(['dashboard_view', 'customer_manage', 'admin_manage', 'ao_view_all']);
    const skill = (a, b) => ['customers', 'articles', 'settings', 'propertyObjects', 'staff'].filter((k) => JSON.stringify(a.x[k]) !== JSON.stringify(b.x[k])).concat(JSON.stringify(a.w) !== JSON.stringify(b.w) ? ['work-orders-list'] : []);
    const ute = { cost_view: ['articles', 'settings', 'work-orders-list'], cost_edit: [], personal_data_view: ['customers'], bankgiro_edit: [] };
    for (const [p, forv] of Object.entries(ute)) {
      const d = skill(bas, await prof(['dashboard_view', 'customer_manage', 'admin_manage', 'ao_view_all', p]));
      ok(JSON.stringify(d) === JSON.stringify(forv), `${p} verkställd: ger exakt den beslutade läsåtkomsten (${forv.join(', ') || 'ingen ny läsning; bara skrivning'}) och inget mer`, d);
    }
    aterstall();
  }

  // ════════════════ Ingen oavsiktligt utökad informationsåtkomst: före (T3-E) jämfört med efter ════════════════
  const delmangd = (efter, fore) => {
    if (efter === null || efter === undefined) return true;
    if (Array.isArray(efter)) {
      if (!Array.isArray(fore)) return efter.length === 0;
      return efter.every((e) => {
        if (!e || typeof e !== 'object') return fore.some((x) => JSON.stringify(x) === JSON.stringify(e));
        const f = fore.find((x) => x && typeof x === 'object' && x.id === e.id);
        return !!f && Object.keys(e).every((k) => (k === 'materials' && Array.isArray(e[k])) ? delmangd(e[k], f[k]) : JSON.stringify(e[k]) === JSON.stringify(f[k]));
      });
    }
    if (typeof efter === 'object') return !!fore && typeof fore === 'object' && Object.keys(efter).every((k) => JSON.stringify(efter[k]) === JSON.stringify(fore[k]));
    return JSON.stringify(efter) === JSON.stringify(fore);
  };
  const ALLA_NYCKLAR = ['vift_activities', 'vift_activityLog', 'vift_offers', 'vift_customers', 'vift_properties', 'vift_propertyObjects', 'vift_propertyContacts', 'vift_staff', 'vift_roles',
    'vift_invoices', 'vift_settings', 'vift_recurringOrders', 'vift_salesOpps', 'vift_contracts', 'vift_articles', 'vift_offerEvents', 'vift_offerAttachments', 'vift_notifications',
    'vift_inspections', 'vift_ronderingar', 'vift_avvikelser', 'vift_projects', 'vift_priceGroups'];
  /* Roller utan T4:s nya behörigheter (alla STAGING-lika och egna roller): utlämningen efter T4-A är en delmängd av före. */
  const AELDRE = ['admin', 'chef', 'ekonomi', 'falt', 'falt2', 'begransad', 'personalansvarig', 'adminhanterare', 'chef_utan_faktura', 'saljare', 'tom', 'okandroll', 'inaktiv', 'artikel', 'ejv'];
  const bredare = []; let jamforda = 0;
  for (const a of AELDRE) {
    const fo = await lasAlla(efFore, Uf[a], ALLA_NYCKLAR), ef_ = await lasAlla(ef, U[a], ALLA_NYCKLAR);
    for (const k of Object.keys((ef_.body || {}).data || {})) { if (k === 'lastChanged') continue; jamforda++; if (!delmangd(ef_.body.data[k], ((fo.body || {}).data || {})[k])) bredare.push(a + ':' + k); }
    const wF = await efFore.anropa('work-orders-list', { user: Uf[a] }), wE = await ef.anropa('work-orders-list', { user: U[a] });
    jamforda++; if (!delmangd(wE.body.workOrders || [], wF.body.workOrders || [])) bredare.push(a + ':work-orders-list');
  }
  ok(bredare.length === 0 && jamforda > 250, `ingen breddning (AP-A, testplanen §4.5): för ${AELDRE.length} användare utan T4:s nya behörigheter och ${jamforda} nycklar/svar är utlämningen efter T4-A en delmängd av utlämningen med T3-E-koden (${FORE_COMMIT}) på samma data`, bredare);
  /* Standardroller och egna roller MED nya behörigheter: varje skillnad mot T3-E förklaras av en beslutad behörighet. */
  const forklarat = { std_chef: ['customers', 'propertyObjects', 'properties', 'propertyContacts', 'articles', 'settings', 'activityLog', 'recurringOrders', 'staff'], std_ekonomi: ['customers', 'articles', 'settings', 'activityLog', 'staff'],
    std_personal: ['staff', 'activityLog'], std_begransad: [], ny_chef: ['staff', 'activityLog'], ny_utan_kontakt: ['staff', 'activityLog'], begr_kontakt: ['staff'], pdv: ['customers'], bankgiro: [], kostnad: ['settings'] };
  const oforklarat = [];
  for (const [a, tillatna] of Object.entries(forklarat)) {
    const fo = await lasAlla(efFore, Uf[a], ALLA_NYCKLAR), ef_ = await lasAlla(ef, U[a], ALLA_NYCKLAR);
    for (const k of Object.keys((ef_.body || {}).data || {})) if (k !== 'lastChanged' && !delmangd(ef_.body.data[k], ((fo.body || {}).data || {})[k]) && !tillatna.includes(k)) oforklarat.push(a + ':' + k);
  }
  ok(oforklarat.length === 0, 'roller med T4:s nya eller nyverkställda behörigheter: varje utökning mot T3-E förklaras av en beslutad behörighet (objects_sensitive/personal_data_view/cost_view för skyddade fält, staff_contacts_view, activity_log_view_all)', oforklarat);

  // ════════════════ Läsande införandeanalys per STAGING-roll (inga ändringar i STAGING) ════════════════
  /* De sju rollerna i STAGING:s rollregister (läst med SELECT 2026-11-28, tests/local/lib/t3e.js) läggs in i
     båda replikerna; ett provkonto byter roll. Efter T4-A ska utlämningen vara en delmängd av före, och
     varje avsmalning ska vara en beslutad T4-A-regel (skyddade fält). Resultatet är underlaget för
     införandeplanen i T4-RESULTAT.md. */
  { aterstall(); aterstallFore();
    const { STAGING_ROLLER } = require('./local/lib/t3e');
    const sattRoll = (dbx, rid) => {
      const rr = val(dbx, 'vift_roles').filter((x) => !STAGING_ROLLER.some((y) => y.id === x.id) || x.id === 'admin').concat(STAGING_ROLLER.filter((y) => y.id !== 'admin'));
      psql(dbx, `update public.store set value = ${jlit(rr)} where key = 'vift_roles'; update public.store set value = (select jsonb_agg(case when e->>'id' = 'ST-R11' then e || ${jlit({ role: rid })}::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_staff';`);
    };
    const analys = {}; const fel = [];
    for (const roll of STAGING_ROLLER.filter((x) => x.id !== 'admin')) {
      sattRoll(db, roll.id); sattRoll(rf.db, roll.id);
      const fo = await lasAlla(efFore, Uf.tom, ALLA_NYCKLAR), ef_ = await lasAlla(ef, U.tom, ALLA_NYCKLAR);
      const smalare = [];
      for (const k of Object.keys((ef_.body || {}).data || {})) {
        if (k === 'lastChanged') continue;
        const a = ef_.body.data[k], b = ((fo.body || {}).data || {})[k];
        if (!delmangd(a, b)) fel.push(roll.id + ':' + k);
        else if (JSON.stringify(a) !== JSON.stringify(b)) smalare.push(k);
      }
      const wF = await efFore.anropa('work-orders-list', { user: Uf.tom }), wE = await ef.anropa('work-orders-list', { user: U.tom });
      if (!delmangd(wE.body.workOrders || [], wF.body.workOrders || [])) fel.push(roll.id + ':work-orders-list');
      else if (JSON.stringify(wE.body.workOrders) !== JSON.stringify(wF.body.workOrders)) smalare.push('work-orders-list');
      analys[roll.id] = smalare.sort();
    }
    console.log('T4A-STAGINGROLLER ' + JSON.stringify(analys));
    const tillatet = ['customers', 'properties', 'propertyObjects', 'propertyContacts', 'recurringOrders', 'settings', 'articles', 'work-orders-list', 'projects', 'avvikelser', 'inspections'];
    const oforkl = Object.entries(analys).flatMap(([rid, l]) => l.filter((k) => !tillatet.includes(k)).map((k) => rid + ':' + k));
    ok(fel.length === 0 && oforkl.length === 0, 'införandeanalys (läsande, ingen ändring i STAGING): för var och en av STAGING:s sex roller utöver admin är utlämningen efter T4-A en delmängd av före; avsmalningarna gäller bara skyddade fält och urval per post (portkod, personnummer, intern ekonomi, återkommande/projekt/avvikelser) — kollegornas arbetskontakt och aktivitetsloggen är oförändrade (övergångsregeln)', fel.concat(oforkl));
    ok(!(analys.e2e_arbetsledare || []).includes('staff') && !(analys.e2e_ekonomi || []).includes('activityLog') && !(analys.e2e_falt || []).includes('staff'), 'övergångsregeln: ingen STAGING-roll tappar kollegors arbetskontakt eller aktivitetsloggen vid installationen');
    aterstall(); aterstallFore(); }

  // ════════════════ Äldre EF (T3-E:s store-key-write) mot T4-A-databasen (installationsfönstret) ════════════════
  { aterstall();
    const efGammal = await laddaEf(db, ['store-key-write'], { root: rotFore });
    const k = await elem(efGammal, U.chef, 'vift_customers', 'CU-R1');
    const x = await expectReject(db, () => SK(efGammal, U.chef, { action: 'writeMerge', key: 'vift_customers', upserts: [{ id: 'CU-R1', data: Object.assign({}, k, { personnr: 'X' }), previous: k }], removals: [] }), { status: 403, error: 'forbidden', reason: 'field_protected' }, KS_REG);
    ok(x.ok && !('personnr' in k), 'installationsfönstret: T3-E:s store-key-write mot T4-A-databasen (5 namngivna argument, p_klient default null) — projektionen och fältskyddet gäller i RPC:n (403 forbidden/field_protected via T3-C:s regex)', x.fel);
    const y = await SK(efGammal, U.chef, { action: 'writeMerge', key: 'vift_customers', upserts: [{ id: 'CU-R1', data: Object.assign({}, k, { phone: '1' }), previous: k }], removals: [] });
    ok(y.status === 200 && val(db, 'vift_customers').find((e) => e.id === 'CU-R1').personnr === '19800101-0000', 'installationsfönstret: äldre EF sparar kunden, personnumret bevaras');
    aterstall(); }

  // ════════════════ Affärsflöden (regression i berörda vägar) ════════════════
  { aterstall();
    const adm = await elem(ef, U.admin, 'vift_customers', 'CU-R1');
    s = await merge(U.admin, 'vift_customers', [{ id: 'CU-R1', data: Object.assign({}, adm, { personnr: '19800101-0002', doorCode: 'A' }), previous: adm }]);
    ok(s.status === 200 && val(db, 'vift_customers').find((e) => e.id === 'CU-R1').personnr === '19800101-0002', 'kundregister: superadmin ändrar personnummer och portkod → 200');
    s = await merge(U.chef, 'vift_customers', [{ id: 'CU-NY', data: { id: 'CU-NY', type: 'privat', firstName: 'Ny', lastName: 'Kund', personnr: '' }, previous: null }]);
    ok(s.status === 200 && val(db, 'vift_customers').some((e) => e.id === 'CU-NY'), 'kundregister: arbetsledaren (utan personal_data_view) skapar ny kund med tomt personnummerfält ur schemat → 200');
    const rec = await elem(ef, U.chef_utan_faktura, 'vift_recurringOrders', 'REC-R1');
    s = await SK(ef, U.chef, { action: 'writeMerge', key: 'vift_recurringOrders', upserts: [{ id: 'REC-R1', data: Object.assign({}, await elem(ef, U.chef, 'vift_recurringOrders', 'REC-R1'), { title: 'Ny titel' }), previous: await elem(ef, U.chef, 'vift_recurringOrders', 'REC-R1') }], removals: [] });
    ok(s.status === 200 && val(db, 'vift_recurringOrders').find((e) => e.id === 'REC-R1').accessCode === 'TEST-REC-1' && !('accessCode' in rec), 'återkommande ärenden: redigering bevarar portkoden; läsaren utan objects_sensitive får den inte');
    s = await ef.anropa('ao-time-write', { user: U.chef, body: { action: 'create_ao', ao: { id: 'AO-T4A-F', title: 'Från offert', status: 'nytt', staff: [], accessCode: 'TEST-OFF', fixedPrice: 1000, materials: [{ id: 'M1', name: 'x', qty: 1, sellPrice: 10 }] }, idempotencyKey: 't4a-flode' } });
    ok(s.status === 200 && s.body.workOrder.accessCode === 'TEST-OFF', 'offert → AO: arbetsledaren (objects_sensitive) skapar AO med portkod och fastpris → 200');
    s = await ef.anropa('time-entries-list', { user: U.falt });
    ok(s.status === 200, 'tid: time-entries-list oförändrat tillgänglig (T4-B ändrar den)');
    aterstall(); }

  // ════════════════ Rollback (installera → rollback → installera) ════════════════
  { const rb = byggReplik({ utelamna: franOchMed(T4B_MIG), schemakontroll: false });
    const KS = { keys: ['vift_customers', 'vift_settings', 'vift_roles', 'vift_staff', 'vift_workOrders', 'vift_propertyObjects', 'vift_articles'], tables: ['app_users', 'op_idempotency', 'property_sensitive_access'] };
    // data som T4-A-koden skapar
    let x = rpc(rb.db, 'store_business_key_merge_write', { p_key: 'vift_settings', p_upserts: [{ id: 'slogan', data: 'T4', previous: null }], p_removals: [], p_caller_authorized: true, p_actor_id: rb.U.admin.staffId });
    ok(!x.error && val(rb.db, 'vift_settings').slogan === 'T4', 'T4-A-kod skapar data: vift_settings fält för fält', x.error);
    const fore = ksTa(rb.db, KS);
    const jamfor = (env) => { try { return execFileSync('node', [path.join(__dirname, 'local', 'jamfor-schema.js'), rb.db], { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) }); } catch (e) { return String(e.stdout || ''); } };
    const ofo = (t) => Number((/(\d+) oförklarade/.exec(t) || [])[1]);
    /* Notisdelen (20261128000010) installeras efter T4-A och rullas därför tillbaka först (t4a_notiser.test.js prövar den). */
    psqlFile(rb.db, path.join(serverRot(), 'rollback', 'T4-A-notiser', 'rollback_t4a_notiser.sql'));
    psqlFile(rb.db, path.join(serverRot(), 'rollback', 'T4-A', 'rollback_t4a.sql'));
    let ut = jamfor({ T4_LAGE: 'T4-A-notiser' });
    ok(ofo(ut) === 0 && /OBS: T4-ändringar som inte syns/.test(ut), 'rollback notiser + T4-A: schemat = läget efter T3-E (0 oförklarade; T4-A:s och notisdelens objekt borta)', ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
    ok(q(rb.db, `select 1 from pg_proc where proname like '\\_vift\\_t4a\\_%'`).length === 0 && q(rb.db, `select 1 from pg_proc where oid = to_regprocedure('public.store_business_key_write(text,jsonb,text,boolean,text)')`).length === 1,
      'rollback T4-A: hjälpfunktionerna borta, store_business_key_write med 5 parametrar tillbaka');
    ok(ksDiff(fore, ksTa(rb.db, KS)).length === 0, 'rollback T4-A: INGEN data ändrad (data skapad efter installationen finns kvar)');
    x = rpc(rb.db, 'store_business_key_merge_write', { p_key: 'vift_customers', p_upserts: [], p_removals: [], p_caller_authorized: true, p_actor_id: rb.U.admin.staffId });
    ok(!x.error, 'äldre RPC (5 parametrar) fungerar på T4-A-data efter rollback', x.error);
    let fel = null;
    try { psqlFile(rb.db, path.join(serverRot(), 'migrations', '20261128000009_t4a_skyddade_falt.sql')); psqlFile(rb.db, path.join(serverRot(), 'migrations', '20261128000010_t4a_notiser.sql')); } catch (e) { fel = e.message; }
    ut = jamfor({ T4_LAGE: 'T4-A-notiser' });
    ok(!fel && ofo(ut) === 0 && obsBaraT4b(ut), 'ny installation efter rollback (0009, därefter notisdelen 0010): STOP-kontrollen godtar T3-E-versionerna; schemat = alla registrerade T4-A- och notisändringar (T4-B inte installerad)', fel || ut.split('\n').filter((l) => /OFÖRKLARAD|OBS/.test(l)).slice(0, 5));
    let stop = null;
    try { psqlFile(rb.db, path.join(serverRot(), 'migrations', '20261128000009_t4a_skyddade_falt.sql')); } catch (e) { stop = e.message; }
    ok(stop && /T4-A STOP/.test(stop), 'STOP-kontroll: en andra körning av 20261128000009 avbryts', stop);
    const fore2 = ksTa(rb.db, KS);
    for (const p of ['T4-A-notiser/rollback_t4a_notiser.sql', 'T4-A/rollback_t4a.sql', 'T3-E/rollback_t3e.sql', 'T3-D/rollback_t3d.sql', 'T3-C/rollback_t3c.sql', 'T3-B/rollback_t3b.sql']) psqlFile(rb.db, path.join(serverRot(), 'rollback', p));
    ut = jamfor({ T3_IGNORERA: '1' });
    ok(ofo(ut) === 0, 'rollback notiser + T4-A + T3-E + T3-D + T3-C + T3-B (omvänd installationsordning): schemat = STAGING-facit', ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
    ok(ksDiff(fore2, ksTa(rb.db, KS)).length === 0, 'rollback hela vägen: ingen data ändrad');
    rb.stang(); }

  // ════════════════ Grants ════════════════
  const g = q(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '\\_vift\\_t4a\\_%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
  ok(g.length === 0, 'SEC-REST-03: T4-A:s funktioner körbara bara för service_role', g);
  const rr = asUser(db, U.falt, `select public.store_business_key_merge_write('vift_settings', '[]'::jsonb, '[]'::jsonb, true, '${F}')`);
  ok(!rr.ok && rr.code === '42501', 'SEC-REST-03 (R): authenticated får inte anropa store_business_key_merge_write direkt (42501)', rr);

  r.stang(); rf.stang();
  avsluta();
})().catch((e) => { console.error(e); process.exit(1); });
