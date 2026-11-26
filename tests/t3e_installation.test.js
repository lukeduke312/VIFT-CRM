'use strict';
/*
 * T3-E (2026-11-28): standardrollerna som data — det manuella installationsskriptet och
 * införandeplanen per STAGING-roll, lokalt mot repliken. Inget körs mot Supabase.
 *
 *  1. Repliken (hela kedjan inklusive 20261128000008) med ett rollregister som är en exakt kopia
 *     av STAGING:s (7 roller, läst med SELECT 2026-11-28: id och behörigheter) och personal med
 *     samma antal per roll-id som STAGING (9 aktiva, syntetiska).
 *  2. A (läsande plan), B (installera): STOP-fall (platshållare, fel hash, id-krock även för
 *     admin, dubbla id, aktiv personal med roll-id som skulle läggas till) — inget ändras och
 *     ingen journalrad; lyckad installation lägger BARA till de fyra saknade rollerna, admin
 *     (identisk) och alla egna roller orörda, personalregistret orört; idempotent.
 *  3. Införandeplanen: effektiv åtkomst (EF-läsningar, REST och 23 skrivande anrop med exakt
 *     utfall) per STAGING-roll före och efter steg 1 (B), steg 2 (D: övergångsregeln uttrycklig
 *     för e2e_falt och v7_sakerhetstest) och steg 3 (övergångsregeln borttagen, simulerat i SQL):
 *     identisk för alla sju roller. Efter steg 2 är regeln verkningslös för alla roller (SQL och TS).
 *  4. Rollback (C) med expectedHash: STOP vid nyare ändring, vid personal på en tillagd roll och
 *     vid dubbel rollback; omvänd ordning ger exakt förevärdet; installera → rollback → installera.
 *  5. Valfritt steg 4 (D-26, separat GO): testkontona flyttas från e2e_*-rollerna till
 *     standardrollerna. Varje skillnad i effektiv åtkomst är en BESLUTAD ny behörighet (D-xx);
 *     ingen oavsiktlig breddning.
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const { ok, krav, avsluta } = require('./local/lib/test');
krav({ tsc: true });
const { byggReplik } = require('./local/lib/replik');
const { laddaEf, transpilera } = require('./local/lib/ef');
const { psql, val, jlit, lit, q } = require('./local/lib/db');
const { ksTa, ksDiff } = require('./local/lib/kontroll');
const T = require('./local/lib/t3e');

const EF = ['ao-time-write', 'work-orders-list', 'store-key-write', 'time-entries-list', 'invoice-write', 'work-order-checklist-resolve', 'work-order-log-write', 'get-sensitive-fields'];
const KSR = { keys: ['vift_roles', 'vift_staff'], tables: ['app_users'] };
const sorterad = (a) => Array.from(new Set(a || [])).sort().join(',');

(async () => {
  // ════════════════ 0. Skripten och definitionen ════════════════
  let g = '';
  try { g = execFileSync('node', [path.join(__dirname, 'local', 't3e-skript.js')], { encoding: 'utf8' }); } catch (e) { g = String(e.stdout || '') + 'FEL'; }
  ok(!/FAIL|FEL/.test(g) && (g.match(/PASS/g) || []).length === 4, 'de fyra manuella skripten (A–D) är genererade ur standardroller.json och aktuella (en enda källa för definitionen)', g);
  const DEF = T.standard();
  ok(DEF.roller.map((r) => r.id).join(',') === 'admin,chef,ekonomi,personal,begransad' && DEF.roller.every((r) => r.isBuiltin && r.active && Array.isArray(r.permissions) && r.permissions.length === new Set(r.permissions).size),
    'definitionen har exakt de fem standardrollerna (D-02: admin, chef, ekonomi, personal, begransad), utan dubbla behörigheter');

  const r = byggReplik({});
  const { db, U } = r;
  ok(r.steg.some((s) => s.rel.includes('20261128000008')) && r.rapport.oforklarade === 0, `kedjan innehåller T3-E-migrationen 20261128000008; schemajämförelse 0 oförklarade (${r.rapport.identiska} identiska, ${r.rapport.forklarade} förklarade)`);
  const ejV = psql(db, `select array_to_string(public._vift_ej_verkstallda(), ',')`).split(',').sort().join(',');
  ok(ejV === Object.keys(DEF.ejVerkstallda).sort().join(','), 'standardroller.json ejVerkstallda = _vift_ej_verkstallda() i servern (samma lista)', ejV);
  ok(q(db, `select 1 from information_schema.schemata where schema_name = 'vift_t3e_journal'`).length === 0, 'kedjan skapar ingen journal och ändrar inte rollregistret (dataändringen är ett manuellt skript, inte en migration)');

  // ════════════════ 1. STAGING-lik värld ════════════════
  psql(db, `update public.store set value = ${jlit(T.STAGING_ROLLER)} where key = 'vift_roles'`);
  const KARTA = { admin: 'admin', adminhanterare: 'admin', chef: 'e2e_arbetsledare', ekonomi: 'e2e_ekonomi', falt: 'e2e_falt', falt2: 'e2e_falt', begransad: 'e2e_begransad', saljare: 'qa_p2_avgransad', chef_utan_faktura: 'v7_sakerhetstest' };
  const staff = val(db, 'vift_staff').filter((s) => Object.keys(KARTA).some((a) => U[a].staffId === s.id)).map((s) => Object.assign(s, { role: KARTA[Object.keys(KARTA).find((a) => U[a].staffId === s.id)] }));
  psql(db, `update public.store set value = ${jlit(staff)} where key = 'vift_staff'`);
  // Egna AO för de tre rollerna med ao_view_own (fält, begränsad, v7): AO-A1 (planerad) och AO-A2 (pågående).
  const wo = val(db, 'vift_workOrders').map((a) => ['AO-A1', 'AO-A2'].includes(a.id) ? Object.assign(a, { staff: [U.falt.staffId, U.begransad.staffId, U.chef_utan_faktura.staffId] }) : a);
  psql(db, `update public.store set value = ${jlit(wo)} where key = 'vift_workOrders'`);
  psql(db, `insert into public.store(key, value) values ('vift_priceGroups', ${jlit([{ id: 'PG-R1', name: 'Ordinarie', hourRate: 650 }])}) on conflict (key) do update set value = excluded.value`);
  const ANV = { admin: U.admin, e2e_arbetsledare: U.chef, e2e_ekonomi: U.ekonomi, e2e_falt: U.falt, e2e_begransad: U.begransad, qa_p2_avgransad: U.saljare, v7_sakerhetstest: U.chef_utan_faktura };
  const ROLLER7 = Object.keys(ANV);
  const ursprung = val(db, 'vift_roles');
  const hash0 = T.rollHash(db);

  let x = T.korSkriptN(db, 'A_las_och_plan.sql');
  const rader = x.ut.split('\n');
  const antal = Object.fromEntries(rader.filter((l) => /^[a-z0-9_]+\|\d+\|\d+$/.test(l)).map((l) => l.split('|')).map(([id, a]) => [id, Number(a)]));
  ok(x.ok && T.kanon(antal) === T.kanon(T.STAGING_ANTAL), 'A5 (läsande): aktiv personal per roll-id = STAGING (admin 2, e2e_arbetsledare 1, e2e_begransad 1, e2e_ekonomi 1, e2e_falt 2, qa_p2_avgransad 1, v7_sakerhetstest 1; 0 inaktiva)', antal);
  ok(['admin|IDENTISK', 'begransad|LAGGS_TILL', 'chef|LAGGS_TILL', 'ekonomi|LAGGS_TILL', 'personal|LAGGS_TILL'].every((l) => rader.includes(l)), 'A4 (läsande plan): admin IDENTISK (finns med [all]), chef/ekonomi/personal/begransad LAGGS_TILL');
  ok(rader.includes('e2e_falt|2') && rader.includes('v7_sakerhetstest|1') && rader.filter((l) => /^(e2e_|qa_|v7_|admin)[a-z0-9_]*\|\d+$/.test(l)).length === 2,
    'A6 (läsande): exakt två roller beror på övergångsregeln — e2e_falt (2 aktiva) och v7_sakerhetstest (1 aktiv)');
  ok(rader.some((l) => l.startsWith(hash0)) && T.rollHash(db) === hash0, 'A2 visar rollregistrets hash (samma som store-key-write readWithHash); A ändrar ingenting');

  // ════════════════ Profiler före ════════════════
  const ef = await laddaEf(db, EF);
  const ctx = { ef, db };
  const FORE = {};
  for (const id of ROLLER7) FORE[id] = await T.profil(ctx, ANV[id]);
  ok(FORE.e2e_falt['anrop:ta_pool'].startsWith('200') && FORE.v7_sakerhetstest['anrop:klar_egen'].startsWith('200') && FORE.e2e_begransad['anrop:ta_pool'].startsWith('403'),
    'före: övergångsregeln verkar (e2e_falt tar ur poolen, v7 klarmarkerar egen) och e2e_begransad har ingen pool', [FORE.e2e_falt['anrop:ta_pool'], FORE.v7_sakerhetstest['anrop:klar_egen'], FORE.e2e_begransad['anrop:ta_pool']]);

  // ════════════════ 2. B: STOP-fallen ════════════════
  const stopp = (namn, fn, re) => {
    const fore = ksTa(db, KSR); const j0 = T.journal(db).length;
    const y = fn();
    const andrat = ksDiff(fore, ksTa(db, KSR));
    ok(!y.ok && re.test(y.fel || '') && andrat.length === 0 && T.journal(db).length === j0, namn, [y.fel, andrat]);
  };
  stopp('B STOP: platshållaren för hashen kvar → inget ändrat, ingen journal', () => T.korSkriptN(db, 'B_installera.sql'), /T3-E STOP: förväntad hash saknas/);
  stopp('B STOP: fel hash (rollregistret ändrat efter A) → inget ändrat', () => T.korSkriptN(db, 'B_installera.sql', { t3e_forvantad_hash: '0'.repeat(64) }), /T3-E STOP: rollregistret har ändrats sedan del A/);
  const medRoller = (roller, fn) => { psql(db, `update public.store set value = ${jlit(roller)} where key = 'vift_roles'`); try { return fn(); } finally { psql(db, `update public.store set value = ${jlit(ursprung)} where key = 'vift_roles'`); } };
  medRoller(T.STAGING_ROLLER.map((y) => y.id === 'admin' ? Object.assign({}, y, { permissions: ['all', 'dashboard_view'] }) : y), () =>
    stopp('B STOP: id-krock för admin (befintlig roll med id admin men andra behörigheter) → rapport, ingen tyst överskrivning', () => T.korSkriptN(db, 'B_installera.sql', { t3e_forvantad_hash: T.rollHash(db) }), /T3-E STOP: id-krock.*admin: befintlig \[all,dashboard_view\], standard \[all\]/));
  medRoller(T.STAGING_ROLLER.concat([{ id: 'chef', label: 'Egen chef', permissions: ['ao_view_all', 'dashboard_view'] }]), () =>
    stopp('B STOP: id-krock för chef (egen roll med samma id) → egna roller skrivs aldrig över', () => T.korSkriptN(db, 'B_installera.sql', { t3e_forvantad_hash: T.rollHash(db) }), /T3-E STOP: id-krock.*chef: befintlig \[ao_view_all,dashboard_view\]/));
  const beg = DEF.roller.find((y) => y.id === 'begransad');
  medRoller(T.STAGING_ROLLER.concat([beg, beg]), () =>
    stopp('B STOP: dubbla id (två roller begransad) → inget ändrat', () => T.korSkriptN(db, 'B_installera.sql', { t3e_forvantad_hash: T.rollHash(db) }), /T3-E STOP: id-krock.*begransad: dubbla id/));
  medRoller(T.STAGING_ROLLER.concat([beg]), () => {
    // begransad finns redan identisk: den hoppas över, de andra tre läggs till — men här provas bara att den räknas som identisk (A4).
    const a = T.korSkriptN(db, 'A_las_och_plan.sql');
    ok(a.ut.split('\n').includes('begransad|IDENTISK'), 'A4: en befintlig roll med exakt standardbehörigheterna (i annan ordning tillåten) räknas som IDENTISK');
  });
  const staffMed = (extra, fn) => { const s0 = val(db, 'vift_staff'); psql(db, `update public.store set value = ${jlit(s0.concat(extra))} where key = 'vift_staff'`); try { return fn(); } finally { psql(db, `update public.store set value = ${jlit(s0)} where key = 'vift_staff'`); } };
  staffMed([{ id: 'ST-T3E1', firstName: 'Test', lastName: 'Gammal', email: 'gammal@example.test', role: 'personal', active: true }], () =>
    stopp('B STOP: aktiv personal har redan roll-id personal (rollen skulle ge åtkomst direkt) → inget ändrat', () => T.korSkriptN(db, 'B_installera.sql', { t3e_forvantad_hash: T.rollHash(db) }), /T3-E STOP: aktiv personal har redan roll-id.*personal \(1 aktiva\)/));

  // ════════════════ 2b. B: installation ════════════════
  const lc0 = val(db, 'vift_lastChanged');
  const fore = ksTa(db, { keys: ['vift_staff', 'vift_workOrders', 'vift_customers'], tables: ['app_users'] });
  x = T.korSkriptN(db, 'B_installera.sql', { t3e_forvantad_hash: hash0 });
  const efter1 = val(db, 'vift_roles');
  const hash1 = T.rollHash(db);
  ok(x.ok && efter1.length === 11 && JSON.stringify(efter1.slice(0, 7)) === JSON.stringify(ursprung) && efter1.slice(7).map((y) => y.id).join(',') === 'chef,ekonomi,personal,begransad',
    'B: lägger BARA till chef, ekonomi, personal och begransad sist; de sju befintliga rollerna (även admin och alla egna) är byte för byte oförändrade och i samma ordning', x.fel || efter1.map((y) => y.id));
  ok(efter1.slice(7).every((y) => T.kanon(y) === T.kanon((({ id, label, isBuiltin, active, description, permissions }) => ({ id, label, isBuiltin, active, description, permissions }))(DEF.roller.find((d) => d.id === y.id)))),
    'B: de tillagda rollerna har exakt definitionens behörigheter (matrisen §2)');
  ok(ksDiff(fore, ksTa(db, { keys: ['vift_staff', 'vift_workOrders', 'vift_customers'], tables: ['app_users'] })).filter((k) => k !== 'store:vift_lastChanged').length === 0, 'B: personalregistret, app_users och övriga data oförändrade (D-02: ingen personalpost migreras)');
  const j = T.journal(db);
  ok(j.length === 1 && j[0].steg === 'installera' && j[0].fore_hash === hash0 && j[0].efter_hash === hash1 && sorterad(j[0].tillagda_roller) === 'begransad,chef,ekonomi,personal' && sorterad(j[0].identiska_roller) === 'admin'
    && JSON.stringify(j[0].fore_varde) === JSON.stringify(ursprung), 'B: journalrad med förevärde, eftervärde, båda hasharna, tillagda och identiska roller', j[0] && j[0].steg);
  ok(x.notiser.some((n) => /journalrad 1/.test(n)), 'B: rapporterar journalraden och den nya hashen', x.notiser);
  ok(val(db, 'vift_lastChanged') !== lc0, 'B: vift_lastChanged flyttas (befintlig trigger), så öppna klienter läser in registret vid nästa synk');
  // Idempotent.
  let ks1 = ksTa(db, KSR);
  x = T.korSkriptN(db, 'B_installera.sql', { t3e_forvantad_hash: hash1 });
  ok(x.ok && x.notiser.some((n) => /inget att göra/.test(n)) && ksDiff(ks1, ksTa(db, KSR)).length === 0 && T.journal(db).length === 1, 'B idempotent: en andra körning ändrar ingenting och skriver ingen journalrad', x.notiser);
  stopp('B STOP: omkörning med den gamla hashen (A måste läsas om) → inget ändrat', () => T.korSkriptN(db, 'B_installera.sql', { t3e_forvantad_hash: hash0 }), /T3-E STOP: rollregistret har ändrats/);

  const jamfor = async (steg) => {
    const skillnad = {};
    for (const id of ROLLER7) { const p = await T.profil(ctx, ANV[id]); const d = T.jamforProfil(FORE[id], p); if (d.length) skillnad[id] = d; }
    ok(Object.keys(skillnad).length === 0, `${steg}: effektiv åtkomst identisk för alla sju STAGING-roller (läsningar i EF och REST, 23 skrivande anrop med status/error/reason/ändrade resurser)`, skillnad);
    return skillnad;
  };
  await jamfor('efter steg 1 (B: standardrollerna tillagda, ingen tilldelad)');

  // ════════════════ 3. Steg 2: övergångsregeln uttrycklig (D) ════════════════
  const effSql = (perms) => sorterad(JSON.parse(psql(db, `select to_jsonb(public._vift_ao_eff_perms(${perms.length ? 'array[' + perms.map(lit).join(',') + ']' : "'{}'"}::text[]))`)));
  const dir = transpilera(require('./local/lib/replik').serverRot(), EF);
  const vaTs = await import(pathToFileURL(path.join(dir, 'js', 'functions', '_shared', 'vift-auth.js')).href);
  const regelVerkar = () => val(db, 'vift_roles').filter((y) => Array.isArray(y.permissions) && (effSql(y.permissions) !== sorterad(y.permissions) || sorterad(vaTs.effectiveAoPerms(y.permissions)) !== sorterad(y.permissions))).map((y) => y.id).sort().join(',');
  ok(regelVerkar() === 'e2e_falt,v7_sakerhetstest', 'före steg 2: övergångsregeln verkar för exakt e2e_falt och v7_sakerhetstest (SQL _vift_ao_eff_perms och TS effectiveAoPerms)', regelVerkar());
  stopp('D STOP: regeln gäller inte e2e_ekonomi → inget ändrat', () => T.korSkriptN(db, 'D_overgangsregel_uttrycklig.sql', { t3e_roll: 'e2e_ekonomi', t3e_forvantad_hash: T.rollHash(db) }), /T3-E STOP: övergångsregeln gäller inte rollen e2e_ekonomi/);
  stopp('D STOP: regeln gäller inte e2e_arbetsledare (ao_view_all/ao_edit) → inget ändrat', () => T.korSkriptN(db, 'D_overgangsregel_uttrycklig.sql', { t3e_roll: 'e2e_arbetsledare', t3e_forvantad_hash: T.rollHash(db) }), /T3-E STOP: övergångsregeln gäller inte/);
  stopp('D STOP: rollen finns inte → inget ändrat', () => T.korSkriptN(db, 'D_overgangsregel_uttrycklig.sql', { t3e_roll: 'finns_inte', t3e_forvantad_hash: T.rollHash(db) }), /T3-E STOP: rollen finns_inte finns 0 gånger/);
  stopp('D STOP: fel hash → inget ändrat', () => T.korSkriptN(db, 'D_overgangsregel_uttrycklig.sql', { t3e_roll: 'e2e_falt', t3e_forvantad_hash: hash0 }), /T3-E STOP: rollregistrets hash/);
  const fFore = val(db, 'vift_roles').find((y) => y.id === 'e2e_falt');
  x = T.korSkriptN(db, 'D_overgangsregel_uttrycklig.sql', { t3e_roll: 'e2e_falt', t3e_forvantad_hash: T.rollHash(db) });
  const fEfter = val(db, 'vift_roles').find((y) => y.id === 'e2e_falt');
  ok(x.ok && JSON.stringify(fEfter.permissions) === JSON.stringify(fFore.permissions.concat(['ao_start_own', 'ao_complete_own', 'ao_pool_take'])) && JSON.stringify(Object.assign({}, fEfter, { permissions: null })) === JSON.stringify(Object.assign({}, fFore, { permissions: null })),
    'D e2e_falt: exakt ao_start_own, ao_complete_own och ao_pool_take tillagda; inga andra fält eller behörigheter ändrade', x.fel);
  x = T.korSkriptN(db, 'D_overgangsregel_uttrycklig.sql', { t3e_roll: 'v7_sakerhetstest', t3e_forvantad_hash: T.rollHash(db) });
  ok(x.ok && T.journal(db).map((y) => y.steg).join(',') === 'installera,overgang:e2e_falt,overgang:v7_sakerhetstest', 'D v7_sakerhetstest: klar; journalen har tre rader (installera, två övergångar)', x.fel);
  stopp('D STOP: andra körningen för e2e_falt (har redan de nya behörigheterna) → inget ändrat', () => T.korSkriptN(db, 'D_overgangsregel_uttrycklig.sql', { t3e_roll: 'e2e_falt', t3e_forvantad_hash: T.rollHash(db) }), /T3-E STOP: övergångsregeln gäller inte rollen e2e_falt/);
  ok(JSON.stringify(val(db, 'vift_roles').filter((y) => !['e2e_falt', 'v7_sakerhetstest'].includes(y.id))) === JSON.stringify(efter1.filter((y) => !['e2e_falt', 'v7_sakerhetstest'].includes(y.id))), 'D: alla andra roller (även standardrollerna) orörda');
  ok(regelVerkar() === '', 'efter steg 2: övergångsregeln är verkningslös för ALLA roller i registret (effektiva AO-behörigheter = rollens egna, i SQL och TS) — regeln kan tas bort utan att någon roll påverkas', regelVerkar());
  await jamfor('efter steg 2 (D: e2e_falt och v7_sakerhetstest uttryckliga)');

  // ════════════════ Steg 3: övergångsregeln borttagen (simulerat i SQL) ════════════════
  const regelDef = psql(db, `select pg_get_functiondef('public._vift_ao_eff_perms(text[])'::regprocedure)`);
  psql(db, `create or replace function public._vift_ao_eff_perms(p_perms text[]) returns text[] language sql immutable set search_path = public as $$ select coalesce(p_perms, '{}'::text[]) $$;`);
  await jamfor('efter steg 3 (övergångsregeln borttagen ur SQL-reglerna, simulerat)');
  psql(db, regelDef);
  ok(effSql(['ao_complete', 'ao_view_own']) === 'ao_complete,ao_complete_own,ao_pool_take,ao_start_own,ao_view_own', 'simuleringen återställd (övergångsregeln finns kvar i koden; den tas bort i ett senare serverpaket)');

  // ════════════════ 4. Rollback (C) med expectedHash ════════════════
  stopp('C STOP: platshållaren för journalraden kvar', () => T.korSkriptN(db, 'C_rollback.sql'), /T3-E STOP: journalradens id saknas/);
  stopp('C STOP: journalrad som inte finns', () => T.korSkriptN(db, 'C_rollback.sql', { t3e_journal_id: '99' }), /T3-E STOP: journalrad 99 finns inte/);
  stopp('C STOP: rollback av installationen (rad 1) när rad 2 och 3 ändrat registret efteråt → nyare ändringar skrivs aldrig över', () => T.korSkriptN(db, 'C_rollback.sql', { t3e_journal_id: '1' }), /T3-E STOP: rollregistret har ändrats efter journalrad 1.*skrivs aldrig över/);
  // En nyare ändring via den vanliga vägen (admin ändrar etiketten på en egen roll i rolleditorn).
  const r3 = val(db, 'vift_roles').find((y) => y.id === 'qa_p2_avgransad');
  let s = await ef.anropa('store-key-write', { user: U.admin, body: { action: 'writeMerge', key: 'vift_roles', upserts: [{ id: r3.id, previous: r3, data: Object.assign({}, r3, { label: 'Ny etikett' }) }], removals: [] } });
  ok(s.status === 200, 'en nyare ändring av rollregistret via store-key-write (admin)', s.body);
  stopp('C STOP: rollback av rad 3 efter en nyare ändring i rolleditorn → inget skrivs över', () => T.korSkriptN(db, 'C_rollback.sql', { t3e_journal_id: '3' }), /T3-E STOP: rollregistret har ändrats efter journalrad 3/);
  s = await ef.anropa('store-key-write', { user: U.admin, body: { action: 'writeMerge', key: 'vift_roles', upserts: [{ id: r3.id, previous: Object.assign({}, r3, { label: 'Ny etikett' }), data: r3 }], removals: [] } });
  ok(s.status === 200 && T.rollHash(db) === T.journal(db)[2].efter_hash, 'ändringen backad via samma väg (hash = journalrad 3:s eftervärde igen)');
  x = T.korSkriptN(db, 'C_rollback.sql', { t3e_journal_id: '3' });
  ok(x.ok, 'C rad 3 (v7_sakerhetstest)', x.fel);
  x = T.korSkriptN(db, 'C_rollback.sql', { t3e_journal_id: '2' });
  ok(x.ok && JSON.stringify(val(db, 'vift_roles')) === JSON.stringify(efter1), 'C rad 2 (e2e_falt): registret = läget efter installationen', x.fel);
  stopp('C STOP: dubbel rollback av rad 2', () => T.korSkriptN(db, 'C_rollback.sql', { t3e_journal_id: '2' }), /T3-E STOP: journalrad 2 är redan återställd/);
  staffMed([{ id: 'ST-T3E2', firstName: 'Test', lastName: 'Ny', email: 'ny@example.test', role: 'personal', active: false }], () =>
    stopp('C STOP: personal (även inaktiv) har tilldelats en roll som rollbacken skulle ta bort → inget ändrat', () => T.korSkriptN(db, 'C_rollback.sql', { t3e_journal_id: '1' }), /T3-E STOP: personal har tilldelats roll som rollbacken skulle ta bort \(personal\)/));
  x = T.korSkriptN(db, 'C_rollback.sql', { t3e_journal_id: '1' });
  ok(x.ok && T.rollHash(db) === hash0 && JSON.stringify(val(db, 'vift_roles')) === JSON.stringify(ursprung), 'C rad 1 (installationen): rollregistret exakt som före (hash = förevärdets hash)', x.fel);
  ok(T.journal(db).map((y) => y.steg).join(',') === 'installera,overgang:e2e_falt,overgang:v7_sakerhetstest,rollback:3,rollback:2,rollback:1', 'C: varje rollback journalförd');
  await jamfor('efter rollback (C ×3)');
  x = T.korSkriptN(db, 'B_installera.sql', { t3e_forvantad_hash: T.rollHash(db) });
  ok(x.ok && JSON.stringify(val(db, 'vift_roles')) === JSON.stringify(efter1) && T.rollHash(db) === hash1, 'installera → rollback → installera: samma resultat som första installationen (samma hash)', x.fel);

  // ════════════════ 5. Valfritt steg 4 (D-26): testkontona till standardrollerna ════════════════
  /* Varje skillnad mot e2e-rollen måste förklaras av en beslutad behörighet i standardrollen. */
  const BESLUTAT = {
    admin: {},
    e2e_arbetsledare: {
      'las:vift_customers': 'objects_sensitive (D-05): kundens portkod/nyckelinformation', 'las:vift_properties': 'objects_sensitive (D-05)', 'las:vift_propertyObjects': 'objects_sensitive (D-05)',
      'rest:vift_customers': 'objects_sensitive (D-05): REST-läsning av register med portkoder', 'rest:vift_properties': 'objects_sensitive (D-05)', 'rest:vift_propertyObjects': 'objects_sensitive (D-05)',
      'las:vift_recurringOrders': 'objects_sensitive (D-05): accessCode', 'rest:vift_recurringOrders': 'objects_sensitive (D-05): REST-läsning av återkommande ärenden med accessCode', 'wol': 'objects_sensitive (D-05): AO:ns accessCode; cost_view (D-01, T4-A): materialradernas inköpspris', 'anrop:portkod_objekt': 'objects_sensitive (D-05): get-sensitive-fields',
      'las:vift_invoices': 'invoice_view (D-07)', 'rest:vift_invoices': 'invoice_view (D-07)', 'las:vift_contracts': 'invoice_view (D-07)', 'rest:vift_contracts': 'invoice_view (D-07)',
      'anrop:faktura_rad': 'invoice_create (D-07)', 'las:vift_offers': 'invoice_view (D-07): offerter till fakturering', 'las:vift_activityLog': 'invoice_view (D-07)',
      /* T4-A (2026-11-28): cost_view verkställd (D-01) — intern timkostnad, artiklarnas inköpspris/påslag
         och materialradernas inköpspris (work-orders-list, därför även 'wol'). */
      'las:vift_settings': 'cost_view (D-01, T4-A): intern timkostnad', 'rest:vift_settings': 'cost_view (D-01, T4-A): REST-läsning av inställningar med intern timkostnad',
      'las:vift_articles': 'cost_view (D-01, T4-A): inköpspris och påslag', 'rest:vift_articles': 'cost_view (D-01, T4-A): REST-läsning av artiklar med inköpspris',
      'anrop:material_egen': 'cost_view/cost_edit (D-01, T4-A): profilens materialanrop skickar hela listan med lagrade inköpspriser (T3-klientens form); utan cost_view 403 field_protected (oläsbart fält), med standardrollen 200 — T4-klienten skickar raderna utan inköpspris',
      /* T4-B (2026-11-28): time_view_all verkställd (K-01). */
      'tel': 'time_view_all (K-01, T4-B): all personals arbetstid, utan attest och löneuppgifter',
    },
    e2e_ekonomi: { /* T4-A: personal_data_view (D-13) och cost_view (D-01) verkställda. */
      'las:vift_customers': 'personal_data_view (D-13, T4-A): personnummer och privatpersoners org.nr (ROT/RUT)', 'las:vift_settings': 'cost_view (D-01, T4-A): intern timkostnad',
      'rest:vift_settings': 'cost_view (D-01, T4-A)', 'las:vift_articles': 'cost_view (D-01, T4-A): inköpspris och påslag', 'rest:vift_articles': 'cost_view (D-01, T4-A)',
      'wol': 'cost_view (D-01, T4-A): materialradernas inköpspris',
      'tel': 'payroll_view (D-08): alla tidposter', 'anrop:tid_egen': 'payroll_manage (D-08): fortfarande 403 forbidden, men orsaken blir not_assigned (lönehandläggaren passerar behörighetssteget, tilldelningen nekar) — ingen breddning', 'anrop:tid_pool': 'payroll_manage (D-08): som tid_egen, 403 not_assigned', 'anrop:attest': 'payroll_manage (D-08): attest', 'las:vift_timeEntries': 'payroll_view (D-08)', 'rest:vift_timeEntries': 'payroll_view (D-08)' },
    e2e_falt: {},
    e2e_begransad: {},
  };
  const STD = { admin: 'admin', e2e_arbetsledare: 'chef', e2e_ekonomi: 'ekonomi', e2e_falt: 'personal', e2e_begransad: 'begransad' };
  const steg4 = {};
  for (const [e2e, std] of Object.entries(STD)) {
    const anv = ANV[e2e];
    const s0 = val(db, 'vift_staff');
    psql(db, `update public.store set value = ${jlit(s0.map((y) => y.id === anv.staffId ? Object.assign({}, y, { role: std }) : y))} where key = 'vift_staff'`);
    const p = await T.profil(ctx, anv);
    psql(db, `update public.store set value = ${jlit(s0)} where key = 'vift_staff'`);
    const d = T.jamforProfil(FORE[e2e], p).filter((k) => !(k === 'las:vift_staff' || k === 'las:vift_roles')); // den egna personalposten (roll-id) och den egna rollen ändras av själva flytten
    const oforklarad = d.filter((k) => !BESLUTAT[e2e][k]);
    steg4[e2e] = d;
    ok(oforklarad.length === 0, `steg 4: ${e2e} → ${std}: ${d.length ? 'skillnaderna är beslutade nya behörigheter (' + d.map((k) => k + ' = ' + BESLUTAT[e2e][k]).join('; ') + ')' : 'identisk effektiv åtkomst'} — ingen oavsiktlig breddning`, oforklarad.map((k) => k + ': ' + String(FORE[e2e][k]).slice(0, 120) + ' → ' + String(p[k]).slice(0, 120)));
  }
  ok(steg4.e2e_falt.length === 0 && steg4.e2e_begransad.length === 0 && steg4.admin.length === 0, 'steg 4: fält, begränsad och admin får exakt samma effektiva åtkomst med standardrollen (ej verkställda behörigheter verkningslösa)');
  console.log('T3E-STEG4 ' + JSON.stringify(steg4));
  r.stang();
  avsluta();
})().catch((e) => { console.log('FAIL krasch: ' + (e && e.stack || e)); process.exit(1); });
