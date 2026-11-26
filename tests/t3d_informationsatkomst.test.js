'use strict';
/*
 * T3-D (2026-11-28): informationsåtkomst — urval per post (SÄK-2, B4, Ö7, D-12–D-15) och
 * aktivitetsloggen (D-22). GODKÄNDA SÄKERHETSTESTER efter rättning. Vänder baslinjefynden
 * SÄK-2 (tests/baslinje_sakerhet.test.js, som körs mot den historiska källan fb71f26).
 * Testgruppen `projection_per_post` (SAKERHETSPROVNING-TESTPLAN §3.3): SEC-B4-01..07,
 * SEC-TASK-01..06, SEC-OFF-01/02, SEC-KUND-01/02, SEC-B3-01..04, SEC-CUST-21, egna roller (D-26).
 *
 * Mot den lokala STAGING-replikan med HELA repokedjan (inklusive 20261128000006–07) och de
 * ändrade Edge Functions körda i Node, på den syntetiska T3-D-världen (lib/t3d-data.js).
 * Varje negativt fall kontrollerar exakt status, error och reason (BEHORIGHETSMATRIS §4) OCH
 * oförändrad kontrollsumma. Läsfallen kontrollerar exakt vilka id och fält som lämnas ut per
 * roll, även för egna roller. "Ingen breddning" bevisas mot T3-C-koden (commit f0e7e44, utläst
 * med git archive) på samma data: för varje användare och nyckel är utlämningen efter T3-D en
 * delmängd av utlämningen före. Samtidighet: referenskontrollen i activity_log_append sker under
 * lås (en pågående omfördelning hinner inte förbi), 20 upprepningar.
 *
 * SEC-B4-05/06 (append-only, appendActivity) körs bara lokalt. Lokalt verifierat; inget är
 * prövat i STAGING.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ok, krav, avsluta } = require('./local/lib/test');
krav({ tsc: true });
const { byggReplik } = require('./local/lib/replik');
const { laddaEf, transpilera } = require('./local/lib/ef');
const { val, q, psql, psqlAsync, rpc, lit, jlit, asUser } = require('./local/lib/db');
const { expectReject, expectAccept, ksTa, ksDiff } = require('./local/lib/kontroll');
const { data, ROLLER } = require('./local/lib/data');
const { t3dVarld, FORVANTAT } = require('./local/lib/t3d-data');

const T3C_COMMIT = 'f0e7e44';
const EF = ['store-key-write', 'work-orders-list', 'invoice-write', 'time-entries-list'];
const LAS_NYCKLAR = ['vift_activities', 'vift_activityLog', 'vift_offers', 'vift_customers', 'vift_properties', 'vift_propertyObjects', 'vift_propertyContacts',
  'vift_staff', 'vift_roles', 'vift_invoices', 'vift_settings', 'vift_recurringOrders', 'vift_salesOpps', 'vift_contracts', 'vift_articles', 'vift_offerEvents',
  'vift_offerAttachments', 'vift_notifications', 'vift_inspections', 'vift_ronderingar', 'vift_avvikelser', 'vift_projects'];
const PORTKODER = ['TEST-PROP-PORT', 'TEST-PROP-NYCKEL', 'TEST-CU-PORT', 'TEST-CU-NYCKEL', 'TEST-1001', 'TEST-2002', 'Nyckel i testskåp A', 'Nyckelbricka B', 'TEST-KVITTO', 'TEST-LARM', 'TEST-OBJ-PORT', 'TEST-REC-1', 'TEST-PORT-'];
const INV_NOTE = 'Intern anteckning (potentiellt intern, K-05)';
const ids = (l) => (Array.isArray(l) ? l : []).map((x) => x && x.id).sort().join(',');
const clone = (v) => JSON.parse(JSON.stringify(v));

/* Laddar T3-D-världen (lib/t3d-data.js) i en replik och lägger till en egen roll med bara
   fakturering (EF-svar från invoice-write). */
function laddaVarld(r) {
  const d = data(); t3dVarld(d.store, d);
  const fakt = { id: 'fakturerare', label: 'Endast fakturering (egen)', isBuiltin: false, active: true, permissions: ['dashboard_view', 'invoice_view', 'invoice_create'] };
  d.store.vift_roles.push(fakt);
  const u = { alias: 'fakturerare', staffId: 'ST-R41', role: 'fakturerare', email: 'fakturerare@example.test', authId: '00000000-0000-4000-8000-000000000401', firstName: 'Fia', lastName: 'Faktura' };
  d.store.vift_staff.push({ id: u.staffId, firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, active: true, title: 'Fakturering', phone: '070-000 00 41', hourlyRate: 650 });
  const sql = ['begin;', `insert into auth.users(id, email) values (${lit(u.authId)}, ${lit(u.email)});`,
    `insert into public.app_users(user_id, staff_id, role_id, active, is_admin) values (${lit(u.authId)}, ${lit(u.staffId)}, ${lit(u.role)}, true, false);`];
  for (const [k, v] of Object.entries(d.store)) sql.push(`insert into public.store(key, value, updated_at) values (${lit(k)}, ${jlit(v)}, '2026-11-01T08:00:00Z') on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;`);
  sql.push('commit;');
  psql(r.db, sql.join('\n'));
  r.U.fakturerare = u;
  return d;
}

(async () => {
  // ════════════════ Före (T3-C, f0e7e44) och efter (T3-D) på samma data ════════════════
  const HIST = fs.mkdtempSync(path.join(os.tmpdir(), 'vift-t3c-'));
  process.on('exit', () => { try { fs.rmSync(HIST, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
  execFileSync('tar', ['-x', '-C', HIST], { input: execFileSync('git', ['-C', path.join(__dirname, '..'), 'archive', T3C_COMMIT, 'supabase'], { maxBuffer: 512 * 1024 * 1024 }) });
  const rotFore = path.join(HIST, 'supabase');

  const r = byggReplik({});
  const { db, U } = r;
  ok(r.steg.some((s) => s.rel.includes('20261128000006')) && r.steg.some((s) => s.rel.includes('20261128000007')), 'kedjan innehåller T3-D-migrationerna 20261128000006–07');
  ok(r.rapport.oforklarade === 0, `schemajämförelse: 0 oförklarade (T3-D-objekten förklarade via t3-andringar.json): ${r.rapport.identiska} identiska, ${r.rapport.forklarade} förklarade`);
  const d = laddaVarld(r);
  psql(db, `create table public._t3d_bas as select * from public.store;`);
  const aterstall = () => psql(db, `begin; delete from public.store; insert into public.store select * from public._t3d_bas; commit;`);
  const ef = await laddaEf(db, EF);

  const rf = byggReplik({ rot: rotFore, schemakontroll: false });
  laddaVarld(rf);
  ok(!rf.steg.some((s) => /_t3d_/.test(s.rel)) && rf.steg.some((s) => /_t3c_/.test(s.rel)), 'jämförelsekedjan (före) = T3-C-koden ' + T3C_COMMIT + ' (STAGING + T3-B + T3-C, utan T3-D)');
  const efFore = await laddaEf(rf.db, ['store-key-write', 'work-orders-list'], { root: rotFore });

  const lasAlla = async (e, user, keys) => (await e.anropa('store-key-write', { user, body: { action: 'readAllWithHashes', keys: keys || LAS_NYCKLAR } }));
  const F = U.falt.staffId, F2 = U.falt2.staffId, BE = U.begransad.staffId, C = U.chef.staffId, EK = U.ekonomi.staffId;
  const ANV = d.anvandare.filter((u) => u.staffActive && u.appActive).map((u) => u.alias).concat(['fakturerare']);

  // ════════════════ Baslinjefynden SÄK-2 vända (SEC-TASK-04, SEC-B4-02) ════════════════
  let s = await lasAlla(ef, U.falt, ['vift_activities', 'vift_activityLog']);
  const tasksF = s.body.data.activities || [];
  ok(s.status === 200 && !tasksF.some((t) => ['TASK-R2', 'TASK-R3', 'TASK-D3', 'TASK-D4'].includes(t.id)),
    'SÄK-2 / SEC-TASK-04 (E): fält får inte andras uppgifter (TASK-R2 till FÄ2, TASK-R3 chefens, TASK-D3 offertkopplad, TASK-D4 ekonomis) — baslinjefyndet vänt', ids(tasksF));
  ok(!(s.body.data.activityLog || []).some((l) => l.refId === 'AO-A8' || l.workOrderId === 'AO-A8'), 'SÄK-2 / SEC-B4-02 (E): fält får inte aktivitetsloggen för andras AO (LOG-R2, LOG-D2 om AO-A8) — baslinjefyndet vänt');
  let rest = asUser(db, U.falt, `select key, value from public.store where key in ('vift_activities', 'vift_activityLog')`);
  ok(rest.ok && rest.rows.length === 0, 'SÄK-2 / SEC-TASK-04 / SEC-B4-02 (R): REST-läsning av vift_activities och vift_activityLog ger tom lista för fält — baslinjefyndet vänt', rest.rows);

  // ════════════════ projection_per_post: exakt urval per användare (E) ════════════════
  const NYCKLAR7 = ['activities', 'activityLog', 'offers', 'customers', 'properties', 'propertyObjects', 'propertyContacts'];
  const ALLA = { activities: 'TASK-D1,TASK-D2,TASK-D3,TASK-D4,TASK-D5,TASK-D6,TASK-R1,TASK-R2,TASK-R3', activityLog: 'LOG-D1,LOG-D10,LOG-D11,LOG-D2,LOG-D3,LOG-D4,LOG-D5,LOG-D6,LOG-D7,LOG-D8,LOG-D9,LOG-R1,LOG-R2',
    offers: 'OFF-R1,OFF-R2,OFF-R3', customers: 'CU-R1,CU-R2,CU-R3', properties: 'PROP-R1,PROP-R2', propertyObjects: 'OBJ-R1,OBJ-R2', propertyContacts: 'PC-1,PC-2,PC-3,PC-4' };
  const T = (o) => Object.fromEntries(NYCKLAR7.map((k) => [k, o[k] === 'ALLA' ? ALLA[k] : (Array.isArray(o[k]) ? o[k].slice().sort().join(',') : (o[k] || ''))]));
  const fl = (a) => T(Object.fromEntries(NYCKLAR7.map((k) => [k, FORVANTAT[a][k]])));
  /* Förväntat per användare (standardroller och egna roller, D-26). 'ALLA' = hela registret. */
  const URVAL = {
    admin: T({ activities: 'ALLA', activityLog: 'ALLA', offers: 'ALLA', customers: 'ALLA', properties: 'ALLA', propertyObjects: 'ALLA', propertyContacts: 'ALLA' }),
    chef: T({ activities: 'ALLA', activityLog: 'ALLA', offers: 'ALLA', customers: 'ALLA', properties: 'ALLA', propertyObjects: 'ALLA', propertyContacts: 'ALLA' }),
    chef_utan_faktura: T({ activities: 'ALLA', activityLog: 'ALLA', offers: 'ALLA', customers: 'ALLA', properties: 'ALLA', propertyObjects: 'ALLA', propertyContacts: 'ALLA' }),
    ekonomi: T({ activities: ['TASK-D4'], activityLog: 'ALLA', offers: 'ALLA', customers: 'ALLA', properties: 'ALLA', propertyObjects: 'ALLA', propertyContacts: 'ALLA' }),
    saljare: T({ activities: [], activityLog: 'ALLA', offers: 'ALLA', customers: 'ALLA', properties: 'ALLA', propertyObjects: 'ALLA', propertyContacts: 'ALLA' }),
    fakturerare: T({ activities: [], activityLog: [], offers: 'ALLA', customers: 'ALLA', properties: 'ALLA', propertyObjects: 'ALLA', propertyContacts: 'ALLA' }),
    adminhanterare: T({ activities: 'ALLA', activityLog: 'ALLA', offers: [], customers: [], properties: [], propertyObjects: [], propertyContacts: [] }),
    personalansvarig: T({}), tom: T({}), okandroll: T({}),
    falt: fl('falt'), falt2: fl('falt2'), begransad: fl('begransad'),
  };
  const utfall = {};
  for (const a of ANV) {
    s = await lasAlla(ef, U[a]);
    utfall[a] = s;
    const got = Object.fromEntries(NYCKLAR7.map((k) => [k, ids(s.body.data && s.body.data[k])]));
    const fel = NYCKLAR7.filter((k) => got[k] !== URVAL[a][k]).map((k) => k + ': ' + got[k] + ' ≠ ' + URVAL[a][k]);
    ok(s.status === 200 && fel.length === 0, `urval per post (E) för ${a} (roll ${(U[a] || {}).role}): exakt rätt id i aktivitetslogg, uppgifter, offerter, kunder, fastigheter, objekt och kontakter`, fel);
  }
  // readWithHash ger samma projektion som readAllWithHashes (konflikt- och omsynksvägen).
  for (const k of ['vift_activities', 'vift_activityLog', 'vift_offers', 'vift_customers', 'vift_propertyContacts']) {
    s = await ef.anropa('store-key-write', { user: U.falt, body: { action: 'readWithHash', key: k } });
    ok(s.status === 200 && ids(s.body.value) === URVAL.falt[k.slice(5)] && s.body.hash === psql(db, `select encode(sha256(convert_to(value::text, 'UTF8')), 'hex') from public.store where key = ${lit(k)}`),
      `readWithHash ${k} (fält): samma urval som readAllWithHashes; hash avser hela servervärdet`, ids(s.body.value));
  }

  // ════════════════ Fält per post: exakta fält ════════════════
  const dF = utfall.falt.body.data;
  ok(dF.offers.every((o) => Object.keys(o).every((k) => ['id', 'title', 'status', 'workOrderId'].includes(k))) && dF.offers.find((o) => o.id === 'OFF-R1').title === 'Testoffert skickad',
    'SEC-OFF-01/02 (D-12): fältets offertreferens har bara id, titel, status och workOrderId — inga rader, belopp, token eller interna fält', dF.offers);
  ok(utfall.begransad.body.data.offers.length === 0 && utfall.falt2.body.data.offers.length === 0, 'SEC-OFF-01: begränsad och FÄ2 (inga offerter på sina AO) får inga offertreferenser — F9 (stubbar för alla offerter) vänt');
  ok(dF.customers.length === 1 && !('personnr' in dF.customers[0]) && !('orgNr' in dF.customers[0]) && !('accessCode' in dF.customers[0]) && !('keyInfo' in dF.customers[0]) && dF.customers[0].phone === '070-000 00 00',
    'SEC-KUND-01 (D-13): fält får kunden för egen AO med kontaktuppgifter men utan personnummer, org.nr (privat), portkod eller nyckelinformation', dF.customers[0]);
  ok(!('accessCode' in dF.properties[0]) && !('keyInfo' in dF.properties[0]) && dF.properties[0].address === 'Testgatan 1',
    'SEC-KUND-01 / K-04: fastigheten för egen AO utan portkod och nyckelinformation', dF.properties[0]);
  const SENS = ['doorCode', 'keyInformation', 'accessInformation', 'keyReceipt', 'alarmInformation', 'accessCode', 'keyInfo'];
  ok(!SENS.some((f) => f in dF.propertyObjects[0]) && dF.propertyObjects[0].name === 'Lgh 1001', 'SEC-KUND-01 / D-05: objektet för egen AO utan någon av de skyddade åtkomstuppgifterna', dF.propertyObjects[0]);
  const stF = dF.staff.filter((x) => x.id !== F);
  ok(stF.length === 14 && stF.every((x) => Object.keys(x).every((k) => ['id', 'firstName', 'lastName', 'name', 'title', 'active', 'color', 'initials', 'phone', 'email'].includes(k))) && stF.every((x) => x.title && 'phone' in x && 'email' in x),
    'SEC-B3-01 (D-14): fält får kollegornas namn, titel och arbetskontakt — inte timpris, personnummer, användarnamn, roll eller behörigheter', [...new Set(stF.flatMap((x) => Object.keys(x)))]);
  const egenF = dF.staff.find((x) => x.id === F);
  ok(egenF && egenF.email === U.falt.email && egenF.role === 'personal' && egenF.hourlyRate === 650, 'SEC-B3-02: den egna personalposten oförändrad (inloggningen löser rätt användare)', egenF);
  const dBE = utfall.begransad.body.data;
  ok(ids(dBE.staff) === [BE, F2].sort().join(',') && dBE.staff.find((x) => x.id === F2).firstName === 'Frida' && Object.keys(dBE.staff.find((x) => x.id === F2)).sort().join() === 'active,firstName,id,lastName,title',
    'SEC-B3-04 (D-14, R38): begränsad (extern) får bara namn och titel för personal på egna AO (FÄ2 på AO-B1) — inga kontaktuppgifter, och FÄ (inte på egna AO) saknas', dBE.staff);
  ok(utfall.chef.body.data.staff.filter((x) => x.id !== C).every((x) => 'role' in x && !('permissions' in x) && !('hourlyRate' in x) && !('personnr' in x)),
    'R40 (D-14): arbetsledare (staff_view) ser andras roll men inte behörigheter eller skyddade personaluppgifter (timpris, personnummer)');
  ok(utfall.ekonomi.body.data.staff.filter((x) => x.id !== EK).every((x) => !('role' in x) && !('hourlyRate' in x) && 'phone' in x),
    'D-14: ekonomi (intern, utan staff_view) får arbetskontakt men varken roll eller timpris');
  ok(utfall.personalansvarig.body.data.staff.every((x) => 'role' in x) && utfall.personalansvarig.body.data.staff.some((x) => 'hourlyRate' in x),
    'staff_manage (personalansvarig): hela personalregistret som tidigare (T3-C, den som hanterar registret)');
  ok(ids(utfall.tom.body.data.staff) === U.tom.staffId && ids(utfall.okandroll.body.data.staff) === U.okandroll.staffId,
    'SEC-CUST-22/23 (D-26): tom behörighetslista och okänd roll får bara sin egen personalpost (inloggningen fungerar, ingen kollegainformation)');
  const dEK = utfall.ekonomi.body.data;
  ok(dEK.properties.every((p) => !('accessCode' in p) && !('keyInfo' in p)) && dEK.propertyObjects.every((o) => !SENS.some((f) => f in o)),
    'K-04: ekonomi (läser hela registret, saknar objects_sensitive) får fastigheter och objekt utan portkoder och nyckelinformation');
  ok(utfall.chef.body.data.properties.find((p) => p.id === 'PROP-R1').accessCode === 'TEST-PROP-PORT', 'skrivaren (chef: customer_manage + objects_sensitive) får hela fastighetsposten (oförändrat; annars skulle skrivningen tappa fält)');

  // ════════════════ SEC-B4-01/02/03 och Q3 ════════════════
  ok(['chef', 'ekonomi', 'admin'].every((a) => ids(utfall[a].body.data.activityLog) === ALLA.activityLog), 'SEC-B4-01: arbetsledare, ekonomi och admin får alla poster i aktivitetsloggen');
  const logF = dF.activityLog;
  ok(logF.every((l) => ['AO-A1', 'AO-A2'].includes(l.workOrderId) && !l.invoiceId && !l.offerId) && !logF.some((l) => l.id === 'LOG-D3' || l.id === 'LOG-D4' || l.id === 'LOG-D6'),
    'SEC-B4-02 (E): fält får bara AO-händelser för egna AO — inga faktura- (LOG-D3), kund- (LOG-D4) eller offertposter (LOG-D6)', logF.map((l) => l.id));
  ok(!logF.some((l) => l.id === 'LOG-D8'), 'SEC-B4-03: poster om AO i tilldelad pool för FÄ2 (AO-P2) saknas för FÄ');
  ok(!logF.some((l) => l.id === 'LOG-D5') && !dF.activities.some((t) => t.id === 'TASK-D5'), 'Q3: öppen pool (AO-P1) ger ingen aktivitetslogg och inga kopplade uppgifter, trots att FÄ får ta jobb ur poolen');
  ok(!logF.some((l) => l.id === 'LOG-D9'), 'egen men arkiverad AO (AO-A6): ingen historik för fält (samma regel som work-orders-list)');
  s = await ef.anropa('work-orders-list', { user: U.falt });
  const p1 = (s.body.workOrders || []).find((a) => a.id === 'AO-P1');
  ok(p1 && p1.poolProjection === true && p1.log.length === 0 && !('contactPerson' in p1) && !('phone' in p1), 'Q3/K-03: öppen pool i work-orders-list utan historik och kontaktuppgifter (T3-B-projektionen oförändrad)');

  // ════════════════ REST (R): RLS döljer raderna för roller utan full åtkomst ════════════════
  const restRader = (user, key) => { const x = asUser(db, user, `select key from public.store where key = ${lit(key)}`); return x.ok ? x.rows.length : 'fel ' + x.code; };
  const RK = ['vift_activities', 'vift_activityLog', 'vift_properties', 'vift_propertyContacts', 'vift_customers', 'vift_propertyObjects', 'vift_offers', 'vift_staff', 'vift_invoices'];
  const restTab = Object.fromEntries(['falt', 'begransad', 'ekonomi', 'chef', 'saljare', 'tom'].map((a) => [a, RK.map((k) => restRader(U[a], k)).join('')]));
  ok(restTab.falt === '000000000' && restTab.begransad === '000000000' && restTab.tom === '000000000',
    'SEC-KUND-02 / SEC-B4-02 / SEC-TASK-04 (R): REST-läsning ger tom lista för fält, begränsad och tom roll för alla nio nycklarna', restTab);
  // Ordning: activities, activityLog, properties, propertyContacts, customers, propertyObjects, offers, staff, invoices.
  /* T4-A (2026-11-28): hela värdet (och REST) bara med läsrätt till alla skyddade fält: kontakter kräver
     objects_sensitive (de kan bära portkod) och kunder dessutom personal_data_view (D-13) — även för
     skrivaren customer_manage. Ekonomi och säljare tappar därför REST-läsningen av kontakter och
     arbetsledaren (utan personal_data_view) av kunder; projektionen via store-key-write är oförändrad
     för fälten de får läsa. Tidigare förväntan: ekonomi/säljare '010100001', arbetsledaren '111111101'. */
  ok(restTab.ekonomi === '010000001' && restTab.saljare === '010000001' && restTab.chef === '111101101',
    'REST (R): ekonomi och säljare (ao_view_all, utan objects_sensitive) läser loggen och fakturor men inte andras uppgifter, kontakter eller register med portkoder (kunder, fastigheter, objekt) eller personalregistret; arbetsledaren allt utom kunder (personal_data_view saknas, T4-A) och personalregistret (staff_view räcker inte, T3-C)', restTab);

  // ════════════════ Ingen breddning: före (T3-C) jämfört med efter (T3-D) per roll ════════════════
  const delmangd = (efter, fore) => {
    if (efter === null || efter === undefined) return true;
    if (Array.isArray(efter)) {
      if (!Array.isArray(fore)) return efter.length === 0;
      return efter.every((e) => {
        if (!e || typeof e !== 'object') return fore.some((x) => JSON.stringify(x) === JSON.stringify(e));
        const f = fore.find((x) => x && typeof x === 'object' && x.id === e.id);
        return !!f && Object.keys(e).every((k) => JSON.stringify(e[k]) === JSON.stringify(f[k]));
      });
    }
    if (typeof efter === 'object') return !!fore && typeof fore === 'object' && Object.keys(efter).every((k) => JSON.stringify(efter[k]) === JSON.stringify(fore[k]));
    return JSON.stringify(efter) === JSON.stringify(fore);
  };
  const bredare = [];
  let jamforda = 0;
  for (const a of ANV) {
    const fore = await lasAlla(efFore, U[a]);
    const efter = utfall[a];
    if (fore.status !== efter.status) { bredare.push(a + ': status ' + fore.status + '→' + efter.status); continue; }
    for (const k of Object.keys(efter.body.data || {})) {
      jamforda++;
      if (!delmangd(efter.body.data[k], (fore.body.data || {})[k])) bredare.push(a + ':' + k);
    }
    const wF = await efFore.anropa('work-orders-list', { user: U[a] }), wE = await ef.anropa('work-orders-list', { user: U[a] });
    jamforda++;
    /* T4-A (2026-11-28): work-orders-list smalnar av (portkod bara med objects_sensitive även för ao_edit,
       inköpspris bara med cost_view, AO-ekonomi inte till fält). Samma AO lämnas ut; varje AO är en
       delmängd av den tidigare (tidigare krävdes identiskt svar). */
    const aoDel = (e, f) => !!f && Object.keys(e).every((k) => (k === 'materials' && Array.isArray(e[k]))
      ? e[k].every((m) => !m || typeof m !== 'object' || delmangd([m], f[k] || []))
      : JSON.stringify(e[k]) === JSON.stringify(f[k]));
    if (JSON.stringify((wF.body.workOrders || []).map((x) => x.id)) !== JSON.stringify((wE.body.workOrders || []).map((x) => x.id))
        || !(wE.body.workOrders || []).every((x) => aoDel(x, (wF.body.workOrders || []).find((y) => y.id === x.id))))
      bredare.push(a + ':work-orders-list');
  }
  ok(bredare.length === 0 && jamforda > 150, `ingen breddning (L6, AP-A): för ${ANV.length} användare (alla standardroller och egna roller) och ${jamforda} nycklar/svar är utlämningen efter T3-D (och T4-A) en delmängd av utlämningen med T3-C-koden (${T3C_COMMIT}) på samma data; work-orders-list samma AO, varje AO och materialrad en delmängd`, bredare);
  const smalare = ANV.filter((a) => ['falt', 'falt2', 'begransad', 'ekonomi'].includes(a));
  ok(smalare.length === 4, 'jämförelsen omfattar fältet, begränsad och ekonomi (där T3-D smalnar av)');

  // ════════════════ Känsliga fält (K-04, K-05, D-05) i alla vägar ════════════════
  const lacka = [];
  for (const a of ANV) {
    const perms = (ROLLER.concat([{ id: 'fakturerare', permissions: ['invoice_view', 'invoice_create'] }]).find((x) => x.id === (U[a] || {}).role) || { permissions: [] }).permissions;
    const sens = perms.includes('all') || perms.includes('objects_sensitive') || perms.includes('customer_manage');
    const txt = JSON.stringify(utfall[a].body);
    if (!sens) PORTKODER.forEach((p) => { if (txt.includes(p)) lacka.push(a + ':' + p); });
    const inv = perms.some((p) => ['all', 'invoice_view', 'invoice_create', 'reports_view', 'ao_view_all', 'ao_edit'].includes(p));
    if (!inv && txt.includes(INV_NOTE)) lacka.push(a + ':inv.note');
  }
  ok(lacka.length === 0, 'K-04/D-05: ingen portkod eller nyckelinformation i store-projektionen för roller utan objects_sensitive (eller skrivrätt till registret, SÄK-7/T4-A); K-05: inv.note aldrig till roller utan fakturaläsning', lacka);
  for (const a of ['falt', 'falt2', 'begransad']) {
    const w = JSON.stringify((await ef.anropa('work-orders-list', { user: U[a] })).body) + JSON.stringify((await ef.anropa('time-entries-list', { user: U[a] })).body);
    ok(!w.includes(INV_NOTE) && !w.includes('TEST-PROP-PORT') && !w.includes('TEST-1001'), `K-05/K-04: work-orders-list och time-entries-list för ${a} innehåller varken inv.note eller fastighetens/objektets portkod`);
  }
  rest = asUser(db, U.falt, `select count(*) from public.property_sensitive_access`);
  ok(!rest.ok || Number((rest.rows[0] || {}).count) === 0, 'D-16: property_sensitive_access går inte att läsa via REST för fält', rest);

  // ════════════════ appendActivity (D-22, SEC-B4-04/05/06) ════════════════
  const KSL = { keys: ['vift_activityLog'] };
  const APP = (user, entry) => ef.anropa('store-key-write', { user, body: { action: 'appendActivity', entry } });
  let nr = 100;
  const E = (type, refs) => Object.assign({ id: 'ACT-T3D-' + String(nr++).padStart(6, '0'), type, description: 'T3-D ' + type }, refs || {});
  const NEJ = async (namn, anrop, forv, ks) => { const x = await expectReject(db, anrop, forv, ks || KSL); ok(x.ok, namn, x.fel.concat([JSON.stringify(x.svar.body).slice(0, 300)])); return x; };
  const JA = async (namn, anrop, skaAndras, ks) => { const x = await expectAccept(db, anrop, { status: 200 }, ks || KSL, skaAndras); ok(x.ok, namn, x.fel.concat([JSON.stringify(x.svar.body).slice(0, 300)])); return x; };
  const TYP = { status: 403, error: 'forbidden', reason: 'type_not_allowed' };
  const REF = { status: 403, error: 'forbidden', reason: 'ref_not_visible' };
  const LOG = ['store:vift_activityLog'];
  aterstall();
  await NEJ('SEC-B4-05: fält rapporterar invoice_created → 403 type_not_allowed, loggens KS oförändrad', () => APP(U.falt, E('invoice_created', { workOrderId: 'AO-A1' })), TYP);
  await NEJ('D-22: fält rapporterar customer_updated → 403 type_not_allowed', () => APP(U.falt, E('customer_updated', { customerId: 'CU-R1' })), TYP);
  await NEJ('D-22: fält rapporterar work_order_archived (kräver ao_edit) → 403 type_not_allowed', () => APP(U.falt, E('work_order_archived', { workOrderId: 'AO-A1' })), TYP);
  await NEJ('D-22: fält rapporterar rondering_started (kräver ao_view_all) → 403 type_not_allowed', () => APP(U.falt, E('rondering_started', {})), TYP);
  await NEJ('D-22 / SEC-CUST-22: tom roll rapporterar work_order_status → 403 type_not_allowed', () => APP(U.tom, E('work_order_status', {})), TYP);
  await NEJ('D-22: ekonomi rapporterar customer_updated (saknar customer_manage) → 403 type_not_allowed', () => APP(U.ekonomi, E('customer_updated', { customerId: 'CU-R1' })), TYP);
  await NEJ('SEC-B4-06: fält rapporterar på AO-A8 (inte tilldelad) → 403 ref_not_visible', () => APP(U.falt, E('work_order_status', { workOrderId: 'AO-A8' })), REF);
  await NEJ('SEC-B4-06 / Q3: fält rapporterar på öppen pool AO-P1 (före tagning) → 403 ref_not_visible', () => APP(U.falt, E('work_order_status', { workOrderId: 'AO-P1' })), REF);
  await NEJ('SEC-B4-06: fält rapporterar på AO-P2 (FÄ2:s tilldelade pool) → 403 ref_not_visible', () => APP(U.falt, E('work_order_status', { workOrderId: 'AO-P2' })), REF);
  await NEJ('SEC-B4-06: fält rapporterar på egen arkiverad AO-A6 → 403 ref_not_visible', () => APP(U.falt, E('material_added', { workOrderId: 'AO-A6' })), REF);
  await NEJ('SEC-B4-06: fält rapporterar på påhittat AO-id → 403 ref_not_visible', () => APP(U.falt, E('work_order_status', { workOrderId: 'AO-FINNS-INTE' })), REF);
  await NEJ('D-22: egen AO men annans kund (CU-R3) → 403 ref_not_visible', () => APP(U.falt, E('work_order_status', { workOrderId: 'AO-A1', customerId: 'CU-R3' })), REF);
  await NEJ('D-22: egen AO men faktura (INV-R1) → 403 ref_not_visible', () => APP(U.falt, E('work_order_status', { workOrderId: 'AO-A1', invoiceId: 'INV-R1' })), REF);
  await NEJ('D-22: egen AO men ovidkommande offert (OFF-R2) → 403 ref_not_visible', () => APP(U.falt, E('work_order_status', { workOrderId: 'AO-A1', offerId: 'OFF-R2' })), REF);
  await NEJ('D-22: säljchans (fält saknar sales_manage) → 403 ref_not_visible', () => APP(U.falt, E('work_order_status', { workOrderId: 'AO-A1', salesOpportunityId: 'SO-1' })), REF);
  await NEJ('D-22: begränsad på AO-A1 (inte tilldelad) → 403 ref_not_visible', () => APP(U.begransad, E('work_order_status', { workOrderId: 'AO-A1' })), REF);
  await NEJ('ogiltig typ → 400 invalid_type (oförändrat)', () => APP(U.falt, E('finns_inte', {})), { status: 400, error: 'invalid_type', reason: null });
  await NEJ('ogiltig referens → 400 invalid_reference (oförändrat)', () => APP(U.falt, E('work_order_status', { workOrderId: 'AO A1 ; drop' })), { status: 400, error: 'invalid_reference', reason: null });
  let x = await JA('D-22 (+): fält rapporterar status på egen AO-A1 med egen kund och AO:ns offert → 200', () => APP(U.falt, Object.assign(E('work_order_status', { workOrderId: 'AO-A1', customerId: 'CU-R1', offerId: 'OFF-R1', propertyId: 'PROP-R1' }), { userId: U.admin.staffId, timestamp: '2000-01-01T00:00:00.000Z' })), LOG);
  const ny = val(db, 'vift_activityLog')[0];
  ok(ny.id === x.svar.body.id && ny.userId === F && ny.timestamp > '2026' && ny.source === 'klientrapport' && JSON.stringify(ny.verifiedFields) === '["userId","timestamp"]',
    'D-22: servern sätter aktör (anroparens id, inte klientens ST-R01) och tid (inte klientens 2000-01-01); posten märks som klientrapport', ny);
  await JA('D-22 (+): fält rapporterar material på egen AO-A2 → 200', () => APP(U.falt, E('material_added', { workOrderId: 'AO-A2' })), LOG);
  await JA('D-22 (+): begränsad rapporterar status på egen AO-B1 → 200', () => APP(U.begransad, E('work_order_status', { workOrderId: 'AO-B1', customerId: 'CU-R2' })), LOG);
  await JA('D-22 (+): ekonomi rapporterar invoice_created med faktura och kund → 200', () => APP(U.ekonomi, E('invoice_created', { invoiceId: 'INV-R1', customerId: 'CU-R1', workOrderId: 'AO-A4' })), LOG);
  await JA('D-22 (+): arbetsledare rapporterar customer_updated och offer_sent → 200', () => APP(U.chef, E('customer_updated', { customerId: 'CU-R2' })), LOG);
  await JA('D-22 (+): arbetsledare rapporterar work_order_created för en AO som ännu inte finns på servern (ao_view_all ser alla AO) → 200', () => APP(U.chef, E('work_order_created', { workOrderId: 'AO-NY-1' })), LOG);
  await JA('D-22 (+): superadmin får alla typer → 200', () => APP(U.admin, E('rondering_completed', { ronderingId: 'RON-1' })), LOG);
  const dupl = E('work_order_status', { workOrderId: 'AO-A1' });
  await JA('append idempotent på id (första) → 200', () => APP(U.falt, dupl), LOG);
  x = await expectReject(db, () => APP(U.falt, dupl), { status: 200 }, KSL);
  ok(x.svar.status === 200 && x.svar.body.duplicate === true && x.andrat.length === 0, 'append idempotent på id (samma post igen): duplicate, ingen ändring');
  await NEJ('SEC-B4-04: write vift_activityLog (även admin) → 403 append_only', () => ef.anropa('store-key-write', { user: U.admin, body: { action: 'write', key: 'vift_activityLog', value: [], expectedHash: null } }), { status: 403, error: 'append_only', reason: null });
  await NEJ('SEC-B4-04: writeMerge vift_activityLog (fält) → 403 append_only', () => ef.anropa('store-key-write', { user: U.falt, body: { action: 'writeMerge', key: 'vift_activityLog', upserts: [], removals: [] } }), { status: 403, error: 'append_only', reason: null });
  x = asUser(db, U.chef, `update public.store set value = '[]'::jsonb where key = 'vift_activityLog'`);
  ok((!x.ok && x.status === 403) || (x.ok && x.count === 0), 'SEC-B4-04 (R): direkt REST-uppdatering av vift_activityLog nekas (F18-vitlistan) — loggen är append-only i alla vägar', x);
  // RPC (P): kontrollerna ligger i RPC:n, inte bara i EF.
  const k0 = ksTa(db, KSL);
  x = rpc(db, 'activity_log_append', { p_entry: E('invoice_created', {}), p_max: 500, p_caller_staff_id: F, p_caller_perms: ROLLER.find((y) => y.id === 'personal').permissions });
  ok(x.error && /forbidden:type_not_allowed/.test(x.error.message) && ksDiff(k0, ksTa(db, KSL)).length === 0, 'D-22 (P): RPC:n själv nekar fel typ (forbidden:type_not_allowed), ingen mutation', x.error);
  x = rpc(db, 'activity_log_append', { p_entry: E('work_order_status', { workOrderId: 'AO-A8' }), p_max: 500, p_caller_staff_id: F, p_caller_perms: ROLLER.find((y) => y.id === 'personal').permissions });
  ok(x.error && /forbidden:ref_not_visible/.test(x.error.message) && ksDiff(k0, ksTa(db, KSL)).length === 0, 'D-22 (P): RPC:n själv nekar ej synlig referens (forbidden:ref_not_visible), ingen mutation', x.error);
  x = rpc(db, 'activity_log_append', { p_entry: E('work_order_status', {}), p_max: 500, p_caller_staff_id: null, p_caller_perms: ['all'] });
  ok(x.error && /forbidden/.test(x.error.message) && ksDiff(k0, ksTa(db, KSL)).length === 0, 'D-22 (P): utan identitet nekas allt (fail-closed)', x.error);
  x = q(db, `select to_regprocedure('public.activity_log_append(jsonb,integer)') is null as borta`)[0];
  ok(x.borta, 'den gamla 2-argumentsversionen av activity_log_append finns inte (en äldre EF får 500 append_failed och klientens utkorg sänder om)');
  // TYPE_PERMS (EF och simulerad server) = _vift_activity_type_perms (RPC).
  const dir = transpilera(path.join(__dirname, '..', 'supabase'), ['store-key-write']);
  const alog = await import(require('url').pathToFileURL(path.join(dir, 'js', 'functions', 'store-key-write', 'activity-log.js')).href);
  const avvik = [...alog.TYPES].filter((t) => JSON.stringify((alog.TYPE_PERMS[t] || []).slice().sort()) !== JSON.stringify((q(db, `select coalesce(public._vift_activity_type_perms(${lit(t)}), '{}') p`)[0].p || []).slice().sort()));
  ok(avvik.length === 0 && [...alog.TYPES].every((t) => (alog.TYPE_PERMS[t] || []).length > 0), `TYPE_PERMS i activity-log.ts = _vift_activity_type_perms i SQL för alla ${alog.TYPES.size} typer, och varje typ har en behörighet`, avvik);

  // Samtidighet: referenskontrollen sker under lås. En pågående omfördelning (FÄ tas bort från
  // AO-A1, transaktionen håller AO-raden) hinner aldrig förbi: appendActivity väntar och nekas.
  let raceFel = 0;
  for (let i = 0; i < 20; i++) {
    aterstall();
    const utanF = val(db, 'vift_workOrders').map((a) => (a.id === 'AO-A1' ? Object.assign({}, a, { staff: [F2] }) : a));
    const omf = psqlAsync(db, `begin; select 1 from public.store where key = 'vift_workOrders' for update; select pg_sleep(0.4); update public.store set value = ${jlit(utanF)} where key = 'vift_workOrders'; commit;`);
    await new Promise((res) => setTimeout(res, 120));
    const fore = ksTa(db, KSL);
    const svar = await APP(U.falt, E('work_order_status', { workOrderId: 'AO-A1' }));
    await omf;
    if (!(svar.status === 403 && svar.body.reason === 'ref_not_visible' && ksDiff(fore, ksTa(db, KSL)).length === 0)) raceFel++;
  }
  ok(raceFel === 0, 'samtidighet ×20: appendActivity under en pågående omfördelning av AO-A1 väntar på AO-raden och nekas med ref_not_visible (ingen läsning utanför låset)', raceFel);
  aterstall();

  // ════════════════ Uppgifter (D-15, F8, SEC-TASK-01..06, SEC-CUST-21) ════════════════
  const KST = { keys: ['vift_activities'] };
  const TASK = ['store:vift_activities'];
  const acts = () => val(db, 'vift_activities');
  const ta = (id) => acts().find((t) => t.id === id);
  const MW = (user, upd, rem) => {
    const cur = acts();
    return ef.anropa('store-key-write', { user, body: { action: 'writeMerge', key: 'vift_activities',
      upserts: (upd || []).map((dd) => ({ id: dd.id, data: dd, previous: cur.find((e) => e.id === dd.id) || null })),
      removals: (rem || []).map((id) => ({ id, previous: cur.find((e) => e.id === id) })) } });
  };
  const med = (id, patch) => Object.assign(clone(ta(id)), patch);
  const NOT_OWN = { status: 403, error: 'forbidden', reason: 'not_own' };
  x = await JA('SEC-TASK-01 (+): fält skapar egen uppgift → 200', () => MW(U.falt, [{ id: 'ACT-T3D-EGEN', title: 'Egen', status: 'open', createdBy: F, assignedTo: F, createdAt: '2026-11-28T08:00:00.000Z' }]), TASK, KST);
  ok(ids(x.svar.body.current) === ['ACT-T3D-EGEN'].concat(FORVANTAT.falt.activities).sort().join(','), 'EF-svar (T3-D): writeMerge-svarets current är projicerat — fältet får bara sina synliga uppgifter tillbaka, aldrig hela registret', ids(x.svar.body.current));
  await JA('SEC-TASK-01 (+): fält klarmarkerar tilldelad TASK-R1 (skapad av AL) → 200', () => MW(U.falt, [med('TASK-R1', { status: 'done', completedAt: '2026-11-28T08:00:00.000Z', completedBy: F })]), TASK, KST);
  await JA('SEC-TASK-01 (+): fält raderar egen uppgift TASK-D2 → 200', () => MW(U.falt, [], ['TASK-D2']), TASK, KST);
  aterstall();
  await NEJ('SEC-TASK-02: fält skapar uppgift tilldelad FÄ2 → 403 not_own, KS oförändrad', () => MW(U.falt, [{ id: 'ACT-T3D-ANNAN', title: 'Till Frida', status: 'open', createdBy: F, assignedTo: F2 }]), NOT_OWN, KST);
  await NEJ('SEC-TASK-03: fält ändrar titel på tilldelad uppgift skapad av AL → 403 field_title', () => MW(U.falt, [med('TASK-R1', { title: 'Ny titel' })]), { status: 403, error: 'forbidden', reason: 'field_title' }, KST);
  await NEJ('D-15: fält klarmarkerar TASK-D1 (synlig via egen AO, men tilldelad FÄ2) → 403 not_own', () => MW(U.falt, [med('TASK-D1', { status: 'done' })]), NOT_OWN, KST);
  await NEJ('D-15: fält raderar tilldelad TASK-R1 (skapad av AL) → 403 not_own', () => MW(U.falt, [], ['TASK-R1']), NOT_OWN, KST);
  await NEJ('D-15: fält lämnar bort sin egen uppgift till FÄ2 → 403 not_own', () => MW(U.falt, [med('TASK-D2', { assignedTo: F2 })]), NOT_OWN, KST);
  await NEJ('SEC-TASK-05 / SEC-CUST-21: ekonomi (ao_view_all utan ao_edit) ändrar annans uppgift → 403 not_own', () => MW(U.ekonomi, [med('TASK-R1', { title: 'x' })]), NOT_OWN, KST);
  await NEJ('SEC-TASK-05: ekonomi klarmarkerar annans uppgift → 403 not_own', () => MW(U.ekonomi, [med('TASK-R3', { status: 'done' })]), NOT_OWN, KST);
  await NEJ('D-15 / D-26: säljare (ao_view_all + sales_manage) ändrar annans uppgift → 403 not_own', () => MW(U.saljare, [med('TASK-R1', { title: 'x' })]), NOT_OWN, KST);
  await NEJ('D-15: begränsad ändrar TASK-D6 (synlig via egen AO-B1) → 403 not_own', () => MW(U.begransad, [med('TASK-D6', { status: 'done' })]), NOT_OWN, KST);
  await JA('SEC-TASK-06 (+): arbetsledare (ao_edit + ao_view_all) ändrar FÄ:s uppgift → 200 (TASK-01-regeln följer D-15)', () => MW(U.chef, [med('TASK-R1', { title: 'Ändrad av AL' })]), TASK, KST);
  await JA('D-15 / D-26 (+): egen roll chef_utan_faktura (ao_edit + ao_view_all) ändrar annans uppgift → 200', () => MW(U.chef_utan_faktura, [med('TASK-R2', { title: 'Ändrad' })]), TASK, KST);
  await JA('D-15 (+): ekonomi ändrar sin egen uppgift → 200', () => MW(U.ekonomi, [med('TASK-D4', { title: 'Egen ändrad' })]), TASK, KST);
  aterstall();
  // En gissad dold id (TASK-R3) som "ny" post: RPC:n ger konflikt; konfliktens serverValue lämnas inte ut.
  // (RPC:n skriver tillbaka samma värde och flyttar updated_at även när allt är konflikter —
  // befintligt beteende; därför jämförs värdets md5.)
  const md5Akt = () => psql(db, `select md5(value::text) from public.store where key = 'vift_activities'`);
  const m0 = md5Akt();
  x = { svar: await ef.anropa('store-key-write', { user: U.falt, body: { action: 'writeMerge', key: 'vift_activities',
    upserts: [{ id: 'TASK-R3', data: { id: 'TASK-R3', title: 'gissning', status: 'open', createdBy: F, assignedTo: F }, previous: null }], removals: [] } }) };
  x.andrat = m0 === md5Akt() ? [] : ['vift_activities'];
  const konf = (x.svar.body.conflicts || [])[0] || {};
  ok(x.svar.status === 200 && x.andrat.length === 0 && konf.id === 'TASK-R3' && konf.serverValue === null && !JSON.stringify(x.svar.body).includes('Chefens egen uppgift'),
    'EF-svar (T3-D): en konflikt mot en uppgift som anroparen inte får se lämnar inte ut serverns värde (serverValue null), ingen mutation', x.svar.body);

  // ════════════════ EF-svar: invoice-write projicerar aktivitetsloggen ════════════════
  aterstall();
  s = await ef.anropa('invoice-write', { user: U.fakturerare, body: { action: 'setStatus', invoiceId: 'INV-R2', status: 'makulerad', expectedRevision: 0 } });
  ok(s.status === 200 && Array.isArray(s.body.activityLog) && s.body.activityLog.length === 0 && val(db, 'vift_activityLog').length > 10,
    'EF-svar (B4): invoice-write (egen roll med bara fakturering) får aktivitetsloggen projicerad — inte hela loggen', [s.status, (s.body.activityLog || []).length]);
  aterstall();
  s = await ef.anropa('invoice-write', { user: U.chef, body: { action: 'setStatus', invoiceId: 'INV-R2', status: 'makulerad', expectedRevision: 0 } });
  ok(s.status === 200 && (s.body.activityLog || []).length === val(db, 'vift_activityLog').length, 'invoice-write (arbetsledare, ao_view_all): hela aktivitetsloggen som tidigare (faktureringsflödet oförändrat)', [s.status, (s.body.activityLog || []).length]);
  aterstall();

  // ════════════════ Grants ════════════════
  const exe = q(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('_vift_ao_visible','_vift_ao_content_visible','_vift_post_refs','_vift_kund_las','_vift_staff_external','_vift_task_ao','_vift_activity_ao_type','_vift_activity_type_perms','_vift_ref_visible','activity_log_append','vift_store_project') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
  ok(exe.length === 0, 'T3-D: inga nya eller ändrade funktioner körbara för anon eller authenticated (bara service_role)', exe);
  x = q(db, `select has_function_privilege('authenticated', 'public.vift_store_full_access(text,text[])', 'execute') a, has_function_privilege('anon', 'public.vift_store_full_access(text,text[])', 'execute') b`)[0];
  ok(x.a && !x.b, 'vift_store_full_access: authenticated kan köra den (RLS-hjälpen), anon inte — som tidigare');

  rf.stang();
  r.stang();
})().then(() => avsluta(), (e) => { ok(false, 'krasch: ' + (e && e.stack || e)); avsluta(); });
