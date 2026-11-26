'use strict';
/*
 * T3-E (2026-11-28): testgruppen `standard_roles` (SAKERHETSPROVNING-TESTPLAN §3.3, §6 T3-E):
 * hela SEC-CUST-01..23 och SEC-* per standardroll mot repliken med de fem standardrollerna
 * installerade med det manuella skriptet (B_installera.sql), ett syntetiskt testkonto per
 * standardroll (D-26) och egna roller som saknar (eller har tillagd) en enskild behörighet.
 *
 * Varje negativt fall: exakt status, error och reason (BEHORIGHETSMATRIS §4) OCH oförändrad
 * kontrollsumma (expectReject). Positiva fall verifieras mot målmatrisen och märks med beslutet.
 *
 * Ej verkställda behörigheter (tillägget i BESLUT-2026-11-28): för varje behörighet i
 * _vift_ej_verkstallda() visas att den är VERKNINGSLÖS — samma användare får exakt samma
 * effektiva åtkomst (EF-läsningar, REST och 23 skrivande anrop) med och utan den, på tomma och
 * begränsade roller och på standardrollerna. Fyndet i T3-D-koden (begransad + en ej verkställd
 * behörighet blev "intern" och fick kollegornas arbetskontakt) bevisas som BASLINJE mot
 * kedjan utan 20261128000008 och är rättat. SEC-CUST-rader vars behörighet verkställs i T4
 * prövas som "verkningslös nu", inte som godkänd målregel.
 *
 * Säkerhetsbeslut på rollnamn: grep över serverkoden (EF och SQL-migrationer) — inga jämförelser
 * mot standardrollernas id. (Klienten kontrolleras i VIFT-CRM tests/rollnamn_guard.test.js.)
 * Lokalt verifierat; inget är prövat i STAGING.
 */
const path = require('path');
const fs = require('fs');
const { ok, krav, avsluta } = require('./local/lib/test');
krav({ tsc: true });
const { byggReplik, serverRot } = require('./local/lib/replik');
const { laddaEf } = require('./local/lib/ef');
const { psql, val, jlit, lit, q, asUser, rpc } = require('./local/lib/db');
const { expectReject, expectAccept, ksTa, ksDiff } = require('./local/lib/kontroll');
const T = require('./local/lib/t3e');

const EF = ['ao-time-write', 'work-orders-list', 'store-key-write', 'time-entries-list', 'invoice-write', 'work-order-checklist-resolve', 'work-order-log-write', 'get-sensitive-fields'];
const KS = { keys: ['vift_workOrders', 'vift_timeEntries', 'vift_invoices', 'vift_roles', 'vift_staff', 'vift_activities', 'vift_activityLog', 'vift_customers', 'vift_articles', 'vift_settings'], tables: ['op_idempotency', 'stamp_status', 'app_users'] };
const FORB = { status: 403, error: 'forbidden', reason: null };
const nyckel = (() => { let i = 0; return () => 't3e-sr-' + (++i) + '-' + Math.random().toString(36).slice(2, 7); })();
const ids = (l) => (Array.isArray(l) ? l : []).map((a) => a.id).sort().join(',');

(async () => {
  const DEF = T.standard();
  const std = (id) => DEF.roller.find((r) => r.id === id).permissions.slice();
  const EJV = Object.keys(DEF.ejVerkstallda);

  // ════════════════ BASLINJE: T3-D-koden (utan 20261128000008) ════════════════
  const t3e = fs.readFileSync(path.join(serverRot(), 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => /^\d{14}$/.test(p[0]) && /_t3e_|_t4[a-z]_/.test(p[1] || '')).map((p) => p[1]);
  {
    const rb = byggReplik({ utelamna: t3e, schemakontroll: false });
    const efB = await laddaEf(rb.db, ['store-key-write']);
    const kolleger = async (perms) => { T.satsRoll(rb.db, 'begransad', perms); const s = await efB.anropa('store-key-write', { user: rb.U.begransad, body: { action: 'readAllWithHashes', keys: ['vift_staff'] } }); return (s.body.data.staff || []).filter((x) => x.id !== rb.U.begransad.staffId); };
    const utan = await kolleger(['dashboard_view', 'ao_view_own']);
    const med = await kolleger(['dashboard_view', 'ao_view_own', 'cost_view']);
    ok(utan.length === 0 && med.length === 13 && med.every((x) => 'phone' in x && 'email' in x),
      'BASLINJE (T3-D-kod, före 20261128000008): begränsad + en ej verkställd behörighet (cost_view) räknas som intern och får alla 13 kollegors arbetstelefon och arbets-e-post — bredare åtkomst än utan behörigheten (fyndet bevisat)', [utan.length, med.length]);
    rb.stang();
  }

  // ════════════════ Världen: STAGING-register + installerade standardroller + D-26-konton ════════════════
  const r = byggReplik({});
  const { db, U } = r;
  ok(r.rapport.oforklarade === 0, 'repliken med hela kedjan (inklusive 20261128000008): 0 oförklarade');
  // Rollregistret som i STAGING; replikens användare med standard-id väntar (B stoppar annars).
  psql(db, `update public.store set value = ${jlit(T.STAGING_ROLLER)} where key = 'vift_roles'`);
  const STDKONTO = { admin: 'admin', chef: 'chef', ekonomi: 'ekonomi', falt: 'personal', falt2: 'personal', begransad: 'begransad' };
  let staff = val(db, 'vift_staff').map((s) => (['chef', 'ekonomi', 'personal', 'begransad'].includes(s.role) ? Object.assign(s, { role: '_vantar_' }) : s));
  psql(db, `update public.store set value = ${jlit(staff)} where key = 'vift_staff'`);
  let x = T.korSkriptN(db, 'B_installera.sql', { t3e_forvantad_hash: T.rollHash(db) });
  ok(x.ok && ['admin', 'chef', 'ekonomi', 'personal', 'begransad'].every((id) => T.kanon(val(db, 'vift_roles').find((y) => y.id === id).permissions.slice().sort()) === T.kanon(std(id).sort())),
    'standardrollerna installerade med B_installera.sql (admin identisk, fyra tillagda) med exakt matrisens behörigheter', x.fel);
  // D-26: ett syntetiskt konto per standardroll (lokalt; i STAGING först efter separat GO).
  staff = val(db, 'vift_staff').map((s) => { const a = Object.keys(STDKONTO).find((k) => U[k].staffId === s.id); return a ? Object.assign(s, { role: STDKONTO[a] }) : s; });
  psql(db, `update public.store set value = ${jlit(staff)} where key = 'vift_staff'`);
  // Egna roller (D-26, matrisen §5.13): standardroll minus/plus en behörighet.
  const minus = (id, p) => std(id).filter((y) => y !== p);
  const EGNA = {
    c01: minus('chef', 'cost_view'), c02: minus('chef', 'cost_edit'), c03: minus('chef', 'objects_sensitive'), c04: minus('chef', 'invoice_create'),
    c05: minus('chef', 'time_view_all'), c06: minus('chef', 'export_data'), c07: minus('ekonomi', 'payroll_manage'), c08: minus('ekonomi', 'personal_data_view'),
    c09: minus('personal', 'ao_pool_take'), c10: minus('personal', 'ao_complete_own'), c11: minus('personal', 'ao_start_own'), c12: minus('personal', 'ao_time'),
    c13: minus('personal', 'ao_material'), c14: minus('personal', 'objects_access_assigned'), c15: minus('personal', 'rondering_utfor'),
    c16: std('begransad').concat(['ao_time']), c17: std('begransad').concat(['objects_access_assigned']), c18: ['staff_manage'], c19: ['admin_manage'],
    c20: ['ao_view_all', 'sales_manage'], c21: ['dashboard_view', 'ao_view_all'], c22: [],
  };
  Object.entries(EGNA).forEach(([id, p]) => T.satsRoll(db, 'sec_cust_' + id.slice(1), p));
  const konto = (alias, nr, role) => T.nyttKonto(db, U, { alias, staffId: 'ST-E' + nr, role, authId: '00000000-0000-4000-8000-0000000005' + nr });
  Object.keys(EGNA).forEach((id) => konto('cust' + id.slice(1), id.slice(1), 'sec_cust_' + id.slice(1)));
  konto('cust23', '23', 'roll_finns_inte'); // SEC-CUST-23
  konto('prov', '90', 'prov_roll'); // provkonto för jämförelser med/utan en behörighet
  // Egna AO: AO-A1 (planerad) och AO-A2 (pågående) för fält, begränsad och alla fält-/begränsade varianter.
  const tilldelade = [U.falt, U.begransad, U.prov].concat(['09', '10', '11', '12', '13', '14', '15', '16', '17'].map((n) => U['cust' + n])).map((u) => u.staffId);
  psql(db, `update public.store set value = ${jlit(val(db, 'vift_workOrders').map((a) => ['AO-A1', 'AO-A2'].includes(a.id) ? Object.assign(a, { staff: tilldelade }) : a))} where key = 'vift_workOrders'`);
  psql(db, `insert into public.store(key, value) values ('vift_priceGroups', ${jlit([{ id: 'PG-R1', name: 'Ordinarie', hourRate: 650 }])}) on conflict (key) do update set value = excluded.value`);
  T.snapshot(db);
  psql(db, `drop table if exists public._t3e_varld; create table public._t3e_varld as select * from public.store;`);
  const nollstall = () => psql(db, `begin; delete from public.store; insert into public.store select * from public._t3e_varld; delete from public.op_idempotency; delete from public.stamp_status; commit;`);
  const ef = await laddaEf(db, EF);
  const ctx = { ef, db };
  const AW = (user, body) => ef.anropa('ao-time-write', { user, body: Object.assign({ idempotencyKey: nyckel() }, body) });
  const SK = (user, body) => ef.anropa('store-key-write', { user, body });
  const NEJ = async (namn, anrop, forv, ks) => { const y = await expectReject(db, anrop, forv, ks || KS); ok(y.ok, namn, y.fel.concat([JSON.stringify(y.svar.body).slice(0, 300)])); nollstall(); return y; };
  const JA = async (namn, anrop, skaAndras, ks) => { const y = await expectAccept(db, anrop, { status: 200 }, ks || KS, skaAndras); ok(y.ok, namn, y.fel.concat([JSON.stringify(y.svar.body).slice(0, 300)])); nollstall(); return y; };
  const lista = async (u) => ((await ef.anropa('work-orders-list', { user: u })).body.workOrders || []);
  const lasAlla = async (u, keys) => (await SK(u, { action: 'readAllWithHashes', keys })).body.data || {};
  const audit = () => Number(psql(db, `select count(*) from public.sensitive_access_audit`));

  // ════════════════ Ej verkställda behörigheter: verkningslösa (tillägget) ════════════════
  const cache = new Map();
  const P = async (perms) => {
    const k = perms.slice().sort().join(',');
    if (!cache.has(k)) { nollstall(); T.satsRoll(db, 'prov_roll', perms); cache.set(k, await T.profil(ctx, U.prov)); nollstall(); }
    return cache.get(k);
  };
  const skillnad = (a, b) => T.jamforProfil(a, b).filter((k) => k !== 'las:vift_roles'); // egna rollens innehåll är inte åtkomst
  const BASER = { tom: [], begransad: std('begransad'), personal_ej: std('personal').filter((p) => !EJV.includes(p)) };
  const neutral = [];
  for (const [bn, bas] of Object.entries(BASER)) {
    const p0 = await P(bas);
    for (const e of (bn === 'personal_ej' ? [] : EJV)) { // var och en på tom och begransad; för personal alla tillsammans
      if (bas.includes(e)) continue;
      const d = skillnad(p0, await P(bas.concat([e])));
      if (d.length) neutral.push(bn + '+' + e + ': ' + d.join(','));
    }
    const d = skillnad(p0, await P(bas.concat(EJV)));
    if (d.length) neutral.push(bn + '+alla: ' + d.join(','));
  }
  for (const id of ['chef', 'ekonomi', 'personal']) {
    const d = skillnad(await P(std(id)), await P(std(id).filter((p) => !EJV.includes(p))));
    if (d.length) neutral.push(id + ' utan ej verkställda: ' + d.join(','));
  }
  ok(neutral.length === 0, `ej verkställda behörigheter (${EJV.join(', ')}) är verkningslösa: varje enskild behörighet (och alla tillsammans) lagd till en tom roll, begransad och personal ger EXAKT samma effektiva åtkomst (EF-läsningar av 25 nycklar, work-orders-list, time-entries-list, REST, 23 skrivande anrop med status/error/reason/ändrade resurser); chef, ekonomi och personal med och utan dem är identiska — ingen roll får bredare åtkomst av en ej verkställd behörighet (rättat i 20261128000008)`, neutral);
  ok(psql(db, `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f', 'p') and p.proname not in ('_vift_ej_verkstallda', '_vift_t4a_kontakt') and (${EJV.map((e) => `(case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end) like ${lit("%'" + e + "'%")}`).join(' or ')}) and p.proname <> '_vift_staff_external'`) === '0',
    'ingen SQL-funktion i servern läser en ej verkställd behörighet (utom registret _vift_ej_verkstallda och _vift_staff_external/_vift_t4a_kontakt, som räknar bort dem i övergångsregeln)');
  const tsTraff = [];
  const fdir = path.join(serverRot(), 'functions');
  const gaIgenom = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((f) => { const p = path.join(d, f.name); if (f.isDirectory()) gaIgenom(p); else if (/\.ts$/.test(f.name)) { const t = fs.readFileSync(p, 'utf8'); EJV.forEach((e) => { if (t.includes("'" + e + "'") || t.includes('"' + e + '"')) tsTraff.push(path.relative(fdir, p) + ':' + e); }); } });
  gaIgenom(fdir);
  ok(tsTraff.length === 0, 'ingen Edge Function läser en ej verkställd behörighet (grep över supabase/functions)', tsTraff);

  // ════════════════ SEC-CUST-01..23 ════════════════
  const lika = async (namn, a, b, beskr) => { const d = skillnad(await P(a), await P(b)); ok(d.length === 0, namn + ' — ' + beskr, d); };
  /* T4-A (2026-11-28): en verkställd behörighet ska ge EXAKT de beslutade skillnaderna och inget mer. */
  const exakt = async (namn, a, b, forv, beskr) => { const d = skillnad(await P(a), await P(b)).sort(); ok(JSON.stringify(d) === JSON.stringify(forv.slice().sort()), namn + ' — ' + beskr, d); };
  /* T4-A (2026-11-28): cost_view, cost_edit, personal_data_view och bankgiro_edit är verkställda; raderna prövar
     nu den beslutade åtkomsten exakt (tidigare "verkningslös nu"). */
  await exakt('SEC-CUST-01 / SEC-B1-12 (chef − cost_view)', std('chef'), EGNA.c01, ['anrop:material_egen', 'las:vift_articles', 'las:vift_settings', 'rest:vift_articles', 'rest:vift_settings', 'wol'],
    'VERKSTÄLLD (T4-A): utan cost_view saknas artiklarnas inköpspris/påslag, intern timkostnad och materialradernas inköpspris (E), och REST-raderna för artiklar och inställningar; profilens materialanrop (hela listan med lagrade inköpspriser, T3-klientens form) nekas med 403 field_protected (oläsbart fält skickat) — inget annat skiljer');
  await lika('SEC-CUST-02 (chef − cost_edit)', std('chef'), EGNA.c02, 'VERKSTÄLLD (T4-A) för skyddade fält: chef saknar article_manage, så artikelns inköpspris nekas med och utan (403 forbidden); nya materialraders inköpspris ignoreras utan cost_edit (svarets ignoredFields) — prövat i t4a_skyddade_falt (SEC-B1-14)');
  // SEC-CUST-03: objects_sensitive verkställs i get-sensitive-fields och i projektionen för läsare (T3-D); skrivardelen är T4-A (SÄK-7).
  let a0 = audit();
  await NEJ('SEC-CUST-03 (chef − objects_sensitive): get-sensitive-fields → 403 "Forbidden: objects_sensitive required"', () => ef.anropa('get-sensitive-fields', { user: U.cust03, body: { objectId: 'OBJ-R1' } }), { status: 403, error: 'Forbidden: objects_sensitive required' }, { keys: ['vift_propertyObjects'] });
  ok(audit() === a0 + 1 && psql(db, `select status || '|' || coalesce(array_to_string(fields, ','), '') from public.sensitive_access_audit order by ts desc limit 1`) === 'denied|', 'SEC-CUST-03: exakt en revisionsrad status=denied utan värden');
  a0 = audit();
  let s = await ef.anropa('get-sensitive-fields', { user: U.chef, body: { objectId: 'OBJ-R1' } });
  ok(s.status === 200 && audit() === a0 + 1, 'SEC-CUST-03 (+, D-05): standardrollen chef (objects_sensitive) får åtkomstinformationen, en revisionsrad allowed', s.body);
  const kunder03 = await lasAlla(U.cust03, ['vift_propertyObjects', 'vift_customers', 'vift_properties', 'vift_recurringOrders']);
  ok((kunder03.propertyObjects || []).length > 0 && !JSON.stringify(kunder03).match(/doorCode|keyInformation|accessInformation|keyReceipt|alarmInformation|"accessCode"|keyInfo/),
    'SEC-CUST-03 (T4-A, SÄK-7 stängd): chef − objects_sensitive är skrivare (customer_manage) men får INTE portkod eller nyckelinformation i registret (projektion även för skrivare, fältvis sammanslagning vid skrivning)');
  await NEJ('SEC-CUST-04 (chef − invoice_create): invoice-write → 403 forbidden', () => ef.anropa('invoice-write', { user: U.cust04, body: { action: 'lineAdd', invoiceId: 'INV-R2', expectedRevision: 0, line: { id: 'L-C4', description: 'x', qty: 1, unitPrice: 1, vatRate: 25 } } }), FORB);
  await JA('SEC-CUST-04 (+, D-07): standardrollen chef (invoice_create) lägger till en rad i fakturaunderlaget', () => ef.anropa('invoice-write', { user: U.chef, body: { action: 'lineAdd', invoiceId: 'INV-R2', expectedRevision: 0, line: { id: 'L-C4', description: 'x', qty: 1, unitPrice: 1, vatRate: 25 } } }), ['store:vift_invoices']);
  /* T4-B (2026-11-28): time_view_all är verkställd (K-01); raden prövar nu den beslutade åtkomsten exakt (tidigare "verkningslös nu"). */
  await exakt('SEC-CUST-05 (chef − time_view_all)', std('chef'), EGNA.c05, ['tel'],
    'VERKSTÄLLD (T4-B, K-01): med time_view_all ger time-entries-list all personals arbetstid (utan löneuppgifter); utan den bara egna — inget annat skiljer');
  await lika('SEC-CUST-06 (chef − export_data)', std('chef'), EGNA.c06, 'VERKNINGSLÖS NU på servern: export_data verkställs i T4-F (ingen serverexport finns; klientens export spärras inte av den, se VIFT-CRM)');
  await NEJ('SEC-CUST-07 (ekonomi − payroll_manage): attest_time → 403 forbidden', () => AW(U.cust07, { action: 'attest_time', entryId: 'TE-R2', attested: true }), FORB);
  await JA('SEC-CUST-07 (+, D-08): standardrollen ekonomi attesterar', () => AW(U.ekonomi, { action: 'attest_time', entryId: 'TE-R2', attested: true }), ['store:vift_timeEntries', 'tabell:op_idempotency']);
  await exakt('SEC-CUST-08 (ekonomi − personal_data_view)', std('ekonomi'), EGNA.c08, ['las:vift_customers'], 'VERKSTÄLLD (T4-A, D-13): utan personal_data_view saknas personnummer och privatpersoners org.nr i kundregistret — inget annat skiljer');
  ok(!(await lista(U.cust09)).some((a) => a.status === 'pool'), 'SEC-CUST-09 (personal − ao_pool_take): ingen öppen pool i work-orders-list');
  await NEJ('SEC-CUST-09: personal − ao_pool_take tar P1 → 403 forbidden', () => AW(U.cust09, { action: 'take_from_pool', aoId: 'AO-P1' }), FORB);
  await NEJ('SEC-CUST-10 (personal − ao_complete_own): klarmarkera egen pågående AO-A2 → 403 forbidden', () => AW(U.cust10, { action: 'patch_ao', aoId: 'AO-A2', patch: { status: 'klar' } }), FORB);
  await NEJ('SEC-CUST-11 (personal − ao_start_own): starta egen AO-A1 → 403 forbidden', () => AW(U.cust11, { action: 'patch_ao', aoId: 'AO-A1', patch: { status: 'pågående' } }), FORB);
  await NEJ('SEC-CUST-12 (personal − ao_time): create_time på egen AO → 403 forbidden', () => AW(U.cust12, { action: 'create_time', entry: { id: 'TE-C12', aoId: 'AO-A1', date: '2026-11-24', minutes: 60 } }), FORB);
  await NEJ('SEC-CUST-12: personal − ao_time stämplar in på egen AO → 403 forbidden', () => SK(U.cust12, { action: 'setStampStatus', active: true, ts: Date.parse('2026-11-24T08:00:00Z'), aoId: 'AO-A1', expectedRevision: 0 }), FORB);
  await NEJ('SEC-CUST-13 (personal − ao_material): materialrad på egen AO → 403 forbidden (behörighet saknas, ingen reason)', () => AW(U.cust13, { action: 'patch_ao', aoId: 'AO-A1', patch: { materials: val(db, 'vift_workOrders').find((a) => a.id === 'AO-A1').materials.concat([{ id: 'M-C13', name: 'x', qty: 1 }]) } }), FORB);
  await lika('SEC-CUST-14 (personal − objects_access_assigned)', std('personal'), EGNA.c14, 'VERKNINGSLÖS NU: objects_access_assigned verkställs i T4-C; get-sensitive-fields ger 403 + en denied-rad med och utan den');
  a0 = audit();
  await NEJ('SEC-CUST-14: personal (med objects_access_assigned, T4-C) → get-sensitive-fields 403 i dag', () => ef.anropa('get-sensitive-fields', { user: U.falt, body: { objectId: 'OBJ-R1' } }), { status: 403, error: 'Forbidden: objects_sensitive required' }, { keys: ['vift_propertyObjects'] });
  ok(audit() === a0 + 1, 'SEC-CUST-14: en denied-rad (samma som utan behörigheten)');
  await lika('SEC-CUST-15 (personal − rondering_utfor)', std('personal'), EGNA.c15, 'VERKNINGSLÖS NU: rondering_utfor verkställs i T4-D (rondering-pass-write kräver i dag ao_view_all för allt)');
  await JA('SEC-CUST-16 (begransad + ao_time, D-04): tid på egen AO → 200', () => AW(U.cust16, { action: 'create_time', entry: { id: 'TE-C16', aoId: 'AO-A1', date: '2026-11-24', minutes: 60 } }), ['store:vift_timeEntries', 'store:vift_workOrders', 'tabell:op_idempotency']);
  await NEJ('SEC-CUST-16: begransad + ao_time på öppen pool → 403 forbidden/not_assigned', () => AW(U.cust16, { action: 'create_time', entry: { id: 'TE-C16b', aoId: 'AO-P1', date: '2026-11-24', minutes: 60 } }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
  await lika('SEC-CUST-17 (begransad + objects_access_assigned)', std('begransad'), EGNA.c17, 'VERKNINGSLÖS NU: verkställs i T4-C (då 200 + allowed-rad för egen aktiv AO); i dag ger den varken åtkomstinformation eller kollegornas kontaktuppgifter');
  const MW = (u, key, el, prev) => SK(u, { action: 'writeMerge', key, upserts: [{ id: el.id, previous: prev === undefined ? (val(db, key).find((y) => y.id === el.id) || null) : prev, data: el }], removals: [] });
  const stEl = (id, p) => Object.assign({}, val(db, 'vift_staff').find((y) => y.id === id), p);
  const roEl = (id, p) => Object.assign({}, val(db, 'vift_roles').find((y) => y.id === id), p);
  await NEJ('SEC-CUST-18 (endast staff_manage): ge FÄ standardrollen chef → 403 privilege_escalation', () => MW(U.cust18, 'vift_staff', stEl(U.falt.staffId, { role: 'chef' })), { status: 403, error: 'forbidden', reason: 'privilege_escalation' });
  await NEJ('SEC-CUST-18: ge FÄ standardrollen begransad (dashboard_view, ao_view_own utöver anroparens) → 403 privilege_escalation', () => MW(U.cust18, 'vift_staff', stEl(U.falt.staffId, { role: 'begransad' })), { status: 403, error: 'forbidden', reason: 'privilege_escalation' });
  await NEJ('SEC-CUST-18: ge FÄ standardrollen admin → 403 superadmin_required', () => MW(U.cust18, 'vift_staff', stEl(U.falt.staffId, { role: 'admin' })), { status: 403, error: 'forbidden', reason: 'superadmin_required' });
  await NEJ('SEC-CUST-19 (endast admin_manage): lägga till all i standardrollen chef → 403 superadmin_required', () => MW(U.cust19, 'vift_roles', roEl('chef', { permissions: std('chef').concat(['all']) })), { status: 403, error: 'forbidden', reason: 'superadmin_required' });
  await NEJ('SEC-CUST-19: lägga till bankgiro_edit (som anroparen saknar) i begransad → 403 privilege_escalation', () => MW(U.cust19, 'vift_roles', roEl('begransad', { permissions: std('begransad').concat(['bankgiro_edit']) })), { status: 403, error: 'forbidden', reason: 'privilege_escalation' });
  await NEJ('SEC-CUST-19: ändra standardrollen admin (har all) → 403 superadmin_required', () => MW(U.cust19, 'vift_roles', roEl('admin', { label: 'x' })), { status: 403, error: 'forbidden', reason: 'superadmin_required' });
  await exakt('SEC-CUST-20 (ao_view_all + sales_manage, utan personal_data_view)', EGNA.c20, EGNA.c20.concat(['personal_data_view']), ['las:vift_customers'], 'VERKSTÄLLD (T4-A, D-13): bara kundregistrets personnummer skiljer');
  const k20 = await lasAlla(U.cust20, ['vift_customers']);
  ok((k20.customers || []).length > 0 && !(k20.customers || []).some((c) => c.personnr) && !(k20.customers || []).some((c) => ['privat', 'private', 'privatperson'].includes(String(c.type).toLowerCase()) && 'orgNr' in c),
    'SEC-CUST-20 / SEC-KUND-03 (T4-A): kundregistrets läsare utan personal_data_view får inte personnummer eller privatpersoners org.nr');
  const t3 = val(db, 'vift_activities').find((y) => y.id === 'TASK-R3');
  await NEJ('SEC-CUST-21 (ao_view_all utan ao_edit): ändra annans uppgift → 403 forbidden/not_own', () => MW(U.cust21, 'vift_activities', Object.assign({}, t3, { title: 'x' }), t3), { status: 403, error: 'forbidden', reason: 'not_own' });
  for (const [n, u] of [['22 (tom behörighetslista)', U.cust22], ['23 (roll som saknas i registret)', U.cust23]]) {
    const w = await ef.anropa('work-orders-list', { user: u });
    const tl = await ef.anropa('time-entries-list', { user: u });
    const ra = await SK(u, { action: 'readAllWithHashes', keys: T.LAS });
    /* T4-A (punkt 7): de tidigare kända C-5-utlämningarna (inställningar, prisgrupper med timpris,
       återkommande ärenden) till en roll utan giltiga behörigheter är stängda — inga undantag kvar. */
    const KANDA = [];
    const d22 = ra.body.data || {};
    const tomt = Object.entries(d22).filter(([k, v]) => !['staff', 'roles', 'lastChanged'].concat(KANDA).includes(k) && (Array.isArray(v) ? v.length : v && Object.keys(v).length));
    ok(w.status === 200 && (w.body.workOrders || []).length === 0 && [200, 403].includes(tl.status) && ((tl.body.entries || tl.body.timeEntries || []).length === 0) && ra.status === 200 && tomt.length === 0 && ids(d22.staff) === u.staffId,
      `SEC-CUST-${n}: work-orders-list, time-entries-list och readAllWithHashes ger tomma listor (bara den egna personalposten) — fail-closed, utom de kända C-5-nycklarna`, [w.status, tl.status, tomt.map((y) => y[0])]);
    ok(Object.keys(d22.settings || {}).length === 0 && (d22.recurringOrders || []).length === 0 && (d22.priceGroups || []).length === 0 && (d22.articles || []).length === 0,
      `SEC-CUST-${n} (T4-A, punkt 7 stängd): inga inställningar, återkommande ärenden, prisgrupper eller artiklar till en roll utan giltiga behörigheter`, Object.keys(d22).filter((k) => JSON.stringify(d22[k]).length > 2));
    await NEJ(`SEC-CUST-${n}: ao-time-write patch → 403 forbidden`, () => AW(u, { action: 'patch_ao', aoId: 'AO-A1', patch: { status: 'klar' } }), FORB);
    await NEJ(`SEC-CUST-${n}: invoice-write → 403 forbidden`, () => ef.anropa('invoice-write', { user: u, body: { action: 'lineAdd', invoiceId: 'INV-R2', expectedRevision: 0, line: { id: 'L-22', description: 'x', qty: 1, unitPrice: 1, vatRate: 25 } } }), FORB);
  }

  // ════════════════ SEC-* per standardroll (matrisen §3, §5) ════════════════
  const L = { admin: await lista(U.admin), chef: await lista(U.chef), ekonomi: await lista(U.ekonomi), falt: await lista(U.falt), begransad: await lista(U.begransad) };
  ok(L.admin.length === 18 && L.chef.length === 18 && L.ekonomi.length === 18, 'SEC-AO-04 (admin, chef, ekonomi; ao_view_all): alla 18 AO', [L.admin.length, L.chef.length, L.ekonomi.length]);
  ok(ids(L.falt) === 'AO-A1,AO-A2,AO-A3,AO-A5,AO-A9,AO-N1,AO-P1,AO-P4,AO-SI1' && L.falt.filter((a) => a.poolProjection).map((a) => a.id).sort().join() === 'AO-P1,AO-P4,AO-SI1',
    'SEC-AO-01/SEC-POOL-01/02 (personal): egna AO + öppen pool (P1, P4, SI1) i poolprojektion; inte P2/P3 (annans), P5/P6, N2 eller andras AO', ids(L.falt));
  ok(ids(L.begransad) === 'AO-A1,AO-A2', 'SEC-AO-02/SEC-POOL-03 (begransad): bara egna tilldelade AO, ingen öppen pool (D-04)', ids(L.begransad));
  await JA('SEC-POOL-05 (personal, ao_pool_take): tar P1', () => AW(U.falt, { action: 'take_from_pool', aoId: 'AO-P1' }), ['store:vift_workOrders', 'tabell:op_idempotency']);
  await NEJ('SEC-POOL-10 (ekonomi): tar P1 → 403 forbidden', () => AW(U.ekonomi, { action: 'take_from_pool', aoId: 'AO-P1' }), FORB);
  await NEJ('SEC-POOL-10 (begransad): tar P1 → 403 forbidden', () => AW(U.begransad, { action: 'take_from_pool', aoId: 'AO-P1' }), FORB);
  await NEJ('SEC-AO-05 (personal): klar på ej tilldelad AO-A8 → 403 forbidden/not_assigned', () => AW(U.falt, { action: 'patch_ao', aoId: 'AO-A8', patch: { status: 'klar' } }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
  await JA('SEC-AO-09 (personal, ao_complete_own): klarmarkerar egen pågående AO-A2', () => AW(U.falt, { action: 'patch_ao', aoId: 'AO-A2', patch: { status: 'klar' } }), ['store:vift_workOrders', 'tabell:op_idempotency']);
  await JA('SEC-AO-10 (personal, ao_start_own): startar egen planerad AO-A1', () => AW(U.falt, { action: 'patch_ao', aoId: 'AO-A1', patch: { status: 'pågående' } }), ['store:vift_workOrders', 'tabell:op_idempotency']);
  await NEJ('SEC-AO-11 (begransad): starta egen AO (ao_start_own saknas, D-04) → 403 forbidden', () => AW(U.begransad, { action: 'patch_ao', aoId: 'AO-A1', patch: { status: 'pågående' } }), FORB);
  for (const u of ['chef', 'admin']) await NEJ(`SEC-AO-15 (${u}): patch_ao status fakturerad → 403 forbidden/invoice_path_required`, () => AW(U[u], { action: 'patch_ao', aoId: 'AO-A1', patch: { status: 'fakturerad' } }), { status: 403, error: 'forbidden', reason: 'invoice_path_required' });
  for (const u of ['falt', 'begransad', 'ekonomi']) await NEJ(`SEC-AO-17 (${u}): delete_ao → 403 forbidden`, () => AW(U[u], { action: 'delete_ao', aoId: 'AO-N2' }), FORB);
  await JA('SEC-AO-16-lik (chef, D-07 + ao_edit): ändrar en AO', () => AW(U.chef, { action: 'patch_ao', aoId: 'AO-A8', patch: { title: 'Ny titel' } }), ['store:vift_workOrders', 'tabell:op_idempotency']);
  await JA('SEC-TID-01 (personal): create_time på egen AO', () => AW(U.falt, { action: 'create_time', entry: { id: 'TE-S1', aoId: 'AO-A1', date: '2026-11-24', minutes: 60 } }), ['store:vift_timeEntries', 'store:vift_workOrders', 'tabell:op_idempotency']);
  await NEJ('SEC-TID-02 (personal): create_time på ej tilldelad AO-A8 → 403 not_assigned', () => AW(U.falt, { action: 'create_time', entry: { id: 'TE-S2', aoId: 'AO-A8', date: '2026-11-24', minutes: 60 } }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
  await NEJ('SEC-TID-04 (personal): create_time med annans staffId → 403 forbidden', () => AW(U.falt, { action: 'create_time', entry: { id: 'TE-S3', aoId: 'AO-A1', staffId: U.falt2.staffId, date: '2026-11-24', minutes: 60 } }), FORB);
  await NEJ('SEC-TID-07 (chef, utan payroll_manage): attest_time → 403 forbidden', () => AW(U.chef, { action: 'attest_time', entryId: 'TE-R2', attested: true }), FORB);
  await NEJ('SEC-TID-02-lik (begransad, utan ao_time): create_time på egen AO → 403 forbidden', () => AW(U.begransad, { action: 'create_time', entry: { id: 'TE-S4', aoId: 'AO-A1', date: '2026-11-24', minutes: 60 } }), FORB);
  const tel = async (u) => { const t = await ef.anropa('time-entries-list', { user: u }); return t.body.entries || t.body.timeEntries || []; };
  ok((await tel(U.falt)).every((t) => t.staffId === U.falt.staffId) && (await tel(U.begransad)).length === 0, 'SEC-TID-09 (personal, begransad): time-entries-list bara egna');
  { const tc = await tel(U.chef); const andras = tc.filter((t) => t.staffId !== U.chef.staffId);
    ok(tc.length === 3 && andras.length > 0 && andras.every((t) => !('attested' in t) && !('attestedBy' in t) && !('attestedAt' in t)),
      'SEC-TID-06 (chef, T4-B): time_view_all — all personals tidposter, utan attest och andra löneuppgifter (K-01, D-08)', tc); }
  ok((await tel(U.ekonomi)).length === 3, 'D-08 (ekonomi, payroll_view): alla tidposter');
  for (const u of ['falt', 'begransad']) {
    const d = await lasAlla(U[u], ['vift_invoices']);
    const rest = asUser(db, U[u], `select key from public.store where key = 'vift_invoices'`);
    ok(!(d.invoices || []).length && rest.ok && rest.rows.length === 0, `SEC-FAKT-01 (${u}): fakturor saknas i EF och REST`);
  }
  for (const u of ['chef', 'ekonomi']) ok(((await lasAlla(U[u], ['vift_invoices'])).invoices || []).length === 2, `SEC-FAKT-02 (${u}, invoice_view; chef enligt D-07): fakturaunderlagen finns`);
  await NEJ('SEC-FAKT-03 (personal): invoice-write → 403 forbidden', () => ef.anropa('invoice-write', { user: U.falt, body: { action: 'lineAdd', invoiceId: 'INV-R2', expectedRevision: 0, line: { id: 'L-F3', description: 'x', qty: 1, unitPrice: 1, vatRate: 25 } } }), FORB);
  const st = { falt: (await lasAlla(U.falt, ['vift_staff', 'vift_roles'])), chef: (await lasAlla(U.chef, ['vift_staff', 'vift_roles'])), ekonomi: (await lasAlla(U.ekonomi, ['vift_staff', 'vift_roles'])), admin: (await lasAlla(U.admin, ['vift_roles'])) };
  ok(['falt', 'ekonomi'].every((u) => st[u].staff.filter((y) => y.id !== U[u].staffId).every((y) => !('permissions' in y) && !('role' in y))), 'SEC-B3-03 (personal, ekonomi): andras roll och behörigheter saknas');
  ok(st.chef.staff.filter((y) => y.id !== U.chef.staffId).every((y) => 'role' in y && !('permissions' in y)), 'R40 (chef, staff_view): andras roll men inte behörigheter');
  ok(ids(st.falt.roles) === 'personal' && ids(st.chef.roles) === 'chef' && ids(st.ekonomi.roles) === 'ekonomi', 'SEC-B3-05 (D-21): personal, chef och ekonomi ser bara sin egen standardroll i rollregistret', [ids(st.falt.roles), ids(st.chef.roles)]);
  ok(st.admin.roles.length === val(db, 'vift_roles').length, 'SEC-B3-06 (admin): hela rollregistret');
  const lg = { falt: (await lasAlla(U.falt, ['vift_activityLog'])).activityLog || [], chef: (await lasAlla(U.chef, ['vift_activityLog'])).activityLog || [] };
  ok(lg.chef.length === val(db, 'vift_activityLog').length && lg.falt.every((l) => ['AO-A1', 'AO-A2', 'AO-A3', 'AO-A5', 'AO-A9', 'AO-N1'].includes(l.workOrderId || l.refId)), 'SEC-B4-01/02: chef hela aktivitetsloggen; personal bara händelser för egna AO');
  const kf = await lasAlla(U.falt, ['vift_customers', 'vift_offers']);
  ok(ids(kf.customers) === 'CU-R1' && !kf.customers.some((c) => 'personnr' in c) && (kf.offers || []).every((o) => Object.keys(o).every((k) => ['id', 'title', 'status', 'workOrderId'].includes(k))),
    'SEC-KUND-01/SEC-OFF-01 (personal): bara kunden för egna AO utan personnummer; offertreferenser utan belopp och token', ids(kf.customers));
  ok(asUser(db, U.falt, `select key from public.store where key in ('vift_customers', 'vift_offers', 'vift_activities')`).rows.length === 0, 'SEC-KUND-02 (personal): REST tom lista');
  x = asUser(db, U.falt, `select public.work_order_patch(null, null, null, null, null, null) as x`);
  ok(!x.ok && x.code === '42501', 'SEC-REST-03 (personal): REST rpc/work_order_patch → 42501 (EXECUTE saknas)', x);
  x = asUser(db, U.falt, `select public.vift_caller_perms() as p`);
  ok(x.ok && T.kanon((x.rows[0].p || []).slice().sort()) === T.kanon(std('personal').sort()), 'SEC-REST-04 (personal): vift_caller_perms = exakt standardrollens behörigheter', x.rows && x.rows[0]);
  a0 = audit();
  await NEJ('SEC-B5-09 (begransad): get-sensitive-fields för egen AO:s objekt → 403', () => ef.anropa('get-sensitive-fields', { user: U.begransad, body: { objectId: 'OBJ-R1' } }), { status: 403, error: 'Forbidden: objects_sensitive required' }, { keys: ['vift_propertyObjects'] });
  ok(audit() === a0 + 1, 'SEC-B5-09: en denied-rad');
  // Matrisen §2 mot effektiv åtkomst: admin = allt; begransad = bara egna AO utan pool, tid, start eller ekonomi.
  const pb = await T.profil(ctx, U.begransad);
  ok(['ta_pool', 'starta_egen', 'klar_egen', 'tid_egen', 'material_egen', 'stampla_egen', 'faktura_rad', 'attest', 'kund_andra'].every((n) => pb['anrop:' + n].startsWith('403')) && pb['anrop:checklista_egen'].startsWith('403'),
    'begransad (D-04): 403 för pool, start, klar, tid, material, stämpling, checklista, faktura, attest och kunder', Object.entries(pb).filter(([k]) => k.startsWith('anrop:')).map(([k, v]) => k + '=' + v));
  const pa = await T.profil(ctx, U.admin);
  ok(['ta_pool', 'redigera_ao', 'faktura_rad', 'attest', 'kund_andra', 'installning_bankgiro', 'roll_ny', 'portkod_objekt'].every((n) => pa['anrop:' + n].startsWith('200')), 'admin (all): allt godtas, även bankgiro och rollregistret', Object.entries(pa).filter(([k]) => k.startsWith('anrop:')).map(([k, v]) => k + '=' + v));

  // ════════════════ Inga säkerhetsbeslut på rollnamn (servern) ════════════════
  const NAMN = ['admin', 'chef', 'ekonomi', 'personal', 'begransad', 'e2e_falt', 'e2e_arbetsledare', 'e2e_ekonomi', 'e2e_begransad'];
  const re = new RegExp(`(role(_id|Id)?|\\.role|->>'role'|role\\s*\\))\\s*(===|!==|==|!=|=|<>)\\s*['"](${NAMN.join('|')})['"]|['"](${NAMN.join('|')})['"]\\s*(===|!==|==|!=|=|<>)\\s*[a-z_.]*role`, 'i');
  const traff = [];
  const sok = (d, filter) => fs.readdirSync(d, { withFileTypes: true }).forEach((f) => { const p = path.join(d, f.name); if (f.isDirectory()) sok(p, filter); else if (filter.test(f.name)) fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (re.test(l) && !/^\s*(--|\/\/|\*)/.test(l)) traff.push(path.relative(serverRot(), p) + ':' + (i + 1) + ': ' + l.trim().slice(0, 120)); }); });
  sok(path.join(serverRot(), 'functions'), /\.ts$/);
  const nyaMig = fs.readFileSync(path.join(serverRot(), 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => /^\d{14}$/.test(p[0]) && p[0] > '20261124211128').map((p) => path.join(serverRot(), p[1]));
  nyaMig.forEach((f) => fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (re.test(l) && !/^\s*--/.test(l)) traff.push(path.relative(serverRot(), f) + ':' + (i + 1) + ': ' + l.trim().slice(0, 120)); }));
  ok(traff.length === 0, 'inga säkerhetsbeslut på rollnamn i servern: Edge Functions och T3-migrationerna jämför aldrig roll-id med admin/chef/ekonomi/personal/begransad (eller e2e-rollerna); behörigheten avgör', traff);
  const sqlTraff = q(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f', 'p') and pg_get_functiondef(p.oid) ~* '(role|role_id)''?\\s*(=|<>)\\s*''(admin|chef|ekonomi|personal|begransad)'''`).map((y) => y.proname);
  ok(sqlTraff.length === 0, 'inga SQL-funktioner i hela repliken (alla migrationer) jämför roll-id med ett standardrollnamn', sqlTraff);
  r.stang();
  avsluta();
})().catch((e) => { console.log('FAIL krasch: ' + (e && e.stack || e)); process.exit(1); });
