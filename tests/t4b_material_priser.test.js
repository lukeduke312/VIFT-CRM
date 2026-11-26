'use strict';
/*
 * T4-B (2026-11-28; testgruppen `material_pricing`, SAKERHETSPROVNING-TESTPLAN §3.3 och §6 T4-B):
 * radvisa materialoperationer, serverbaserad prissättning (okänt ≠ 0, ögonblicksbild, fastpris utan
 * dubbeldebitering), fakturavägen (okänt pris stoppas, fakturerade källrader låsta), tid
 * (tillåten prisgrupp, time_view_all utan lön, tidlås på klar AO, behörig och loggad rättning),
 * projektion av priser för fält, VK-1-arkitekturen (prisupplösning generell → kund → fastighet →
 * avtal, gemensamt radformat, grupperad rad, delfakturering), samtidighet, gamla klienter,
 * affärsflöden, ingen breddning per roll och STAGING-roll, rollback.
 *
 * GODKÄNDA SÄKERHETSTESTER efter rättning och BASLINJE-fynden i oförändrad kod (T4-A + notisdelen,
 * commit 2060b8f, utläst med git archive) på samma data. Mot den lokala STAGING-replikan med hela
 * repokedjan (… 20261128000011) och de ändrade Edge Functions körda i Node. Varje negativt fall
 * kontrollerar exakt status, error och reason (BEHORIGHETSMATRIS §4) OCH oförändrad kontrollsumma.
 * Lokalt verifierat; inget är prövat i STAGING.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ok, krav, avsluta } = require('./local/lib/test');
krav({ tsc: true });
const { byggReplik, serverRot } = require('./local/lib/replik');
const { laddaEf } = require('./local/lib/ef');
const { val, q, psql, psqlFile, lit, jlit, asUser, rpc, rpcAsync } = require('./local/lib/db');
const { expectReject, expectAccept, ksTa, ksDiff, parallellt } = require('./local/lib/kontroll');
const { data } = require('./local/lib/data');
const { STAGING_ROLLER, standard, profil, jamforProfil } = require('./local/lib/t3e');

const FORE_COMMIT = '2060b8f'; // T4-A + notisdelen (läget före T4-B)
const T4B_MIG = path.join('migrations', '20261128000011_t4b_material_priser_tid.sql');
const EF = ['ao-time-write', 'invoice-write', 'time-entries-list', 'work-orders-list', 'store-key-write', 'work-order-checklist-resolve', 'work-order-log-write', 'get-sensitive-fields'];
const T0 = '2026-11-01T08:00:00.000Z';
const clone = (v) => JSON.parse(JSON.stringify(v));
let _n = 0;
const nyckel = () => 't4b-' + (++_n) + '-' + Math.random().toString(36).slice(2, 8);
const iv = () => 'vift-v2:' + require('crypto').randomUUID();

/* ── Testvärlden: standardrollerna (T3-E/T4-A), egna roller, artiklar, prisgrupper, AO per prismodell ── */
function laddaVarld(db, U) {
  const d = data();
  const F = U.falt.staffId, F2 = U.falt2.staffId;
  const std = standard().roller.map((r) => Object.assign({ isBuiltin: ['admin', 'chef', 'ekonomi', 'personal'].includes(r.id), active: true }, { id: r.id, label: r.label || r.id, permissions: r.permissions }));
  const roller = std.concat(d.store.vift_roles.filter((r) => !std.some((s) => s.id === r.id))).concat([
    { id: 'tidsansvarig', label: 'Tidsansvarig (egen)', active: true, permissions: ['dashboard_view', 'time_view_all'] },
    { id: 'chef_utan_kostnad', label: 'Arbetsledare utan cost_* och faktura (egen)', active: true, permissions: ['dashboard_view', 'ao_view_all', 'ao_view_own', 'ao_create', 'ao_edit', 'ao_material', 'ao_time', 'customer_manage'] },
    { id: 'artikelansvarig', label: 'Artiklar och prisgrupper (egen)', active: true, permissions: ['dashboard_view', 'article_manage'] },
  ]);
  const nya = [
    { alias: 'tidsans', staffId: 'ST-T41', role: 'tidsansvarig', authId: '00000000-0000-4000-8000-000000000741' },
    { alias: 'egenchef', staffId: 'ST-T42', role: 'chef_utan_kostnad', authId: '00000000-0000-4000-8000-000000000742' },
    { alias: 'artikel', staffId: 'ST-T43', role: 'artikelansvarig', authId: '00000000-0000-4000-8000-000000000743' },
  ];
  const staff = d.store.vift_staff.concat(nya.map((u) => ({ id: u.staffId, firstName: 'T4B', lastName: u.alias, email: u.alias + '@example.test', role: u.role, active: true, phone: '070-000 07 ' + u.staffId.slice(-2), hourlyRate: 650 })));
  const tim = { priceType: 'timpris', priceGroupId: 'PG-1', fixedPrice: 0 };
  const aos = d.store.vift_workOrders.map((a) => {
    if (['AO-A1', 'AO-A2', 'AO-A3', 'AO-A5'].includes(a.id)) return Object.assign({}, a, tim);
    if (a.id === 'AO-A8') return Object.assign({}, a, { priceType: 'fastpris', fixedPrice: 4500 });
    return a;
  }).concat([
    Object.assign(clone(d.store.vift_workOrders.find((a) => a.id === 'AO-A3')), { id: 'AO-F1', title: 'Fastpris klar', status: 'klar', staff: [F], priceType: 'fastpris', fixedPrice: 3000, priceGroupId: '',
      materials: [{ id: 'AO-F1-M1', articleId: 'ART-R1', name: 'Testartikel', qty: 2, unit: 'st', buyPrice: 50, sellPrice: 100, vatRate: 25, addedBy: F, addedAt: T0 }] }),
    Object.assign(clone(d.store.vift_workOrders.find((a) => a.id === 'AO-A3')), { id: 'AO-K1', title: 'Klar timpris', status: 'klar', staff: [F], priceType: 'timpris', priceGroupId: 'PG-1', fixedPrice: 0,
      materials: [{ id: 'AO-K1-M1', articleId: '', name: 'Fritext okänt pris', qty: 1, unit: 'st', sellPrice: 0, buyPrice: 0, addedBy: F, addedAt: T0 }] }),
  ]);
  const tes = [
    { id: 'TE-R1', aoId: 'AO-A2', staffId: F, staffName: 'Filip Fält', date: '2026-11-21', minutes: 120, priceGroupId: 'PG-1', priceGroupName: 'Standard', hourRate: 650, billable: true, attested: false, createdAt: T0, updatedAt: T0 },
    { id: 'TE-R2', aoId: 'AO-A8', staffId: F2, staffName: 'Frida Fält', date: '2026-11-21', minutes: 180, priceGroupId: 'PG-1', priceGroupName: 'Standard', hourRate: 650, billable: true, attested: false, createdAt: T0, updatedAt: T0 },
    { id: 'TE-R3', aoId: 'AO-A3', staffId: F, staffName: 'Filip Fält', date: '2026-11-22', minutes: 90, priceGroupId: 'PG-1', priceGroupName: 'Standard', hourRate: 650, billable: true, attested: true, attestedAt: T0, attestedBy: U.ekonomi.staffId, createdAt: T0, updatedAt: T0 },
    { id: 'TE-K1', aoId: 'AO-K1', staffId: F, staffName: 'Filip Fält', date: '2026-11-22', minutes: 60, priceGroupId: 'PG-1', priceGroupName: 'Standard', hourRate: 650, billable: true, attested: false, createdAt: T0, updatedAt: T0 },
    { id: 'TE-C1', aoId: 'AO-A2', staffId: U.chef.staffId, staffName: 'Cecilia Chef', date: '2026-11-21', minutes: 30, priceGroupId: 'PG-2', priceGroupName: 'Akut', hourRate: 800, billable: true, attested: true, attestedAt: T0, attestedBy: U.ekonomi.staffId, createdAt: T0, updatedAt: T0 },
  ];
  const store = Object.assign({}, d.store, {
    vift_roles: roller, vift_staff: staff, vift_workOrders: aos, vift_timeEntries: tes,
    vift_articles: [
      { id: 'ART-R1', articleNumber: 'R1', name: 'Testartikel', unit: 'st', buyPrice: 50, sellPrice: 100, markup: 100, vatRate: 25, active: true },
      { id: 'ART-R2', articleNumber: 'R2', name: 'Artikel utan pris', unit: 'm', buyPrice: 0, sellPrice: 0, markup: 0, vatRate: 25, active: true },
      { id: 'ART-R3', articleNumber: 'R3', name: 'Livsmedel 12 %', unit: 'st', buyPrice: 10, sellPrice: 20, markup: 100, vatRate: 12, active: true },
    ],
    vift_priceGroups: [
      { id: 'PG-1', name: 'Standard', hourRate: 650, billingType: 'hourly', description: 'Normal nivå 650 kr', active: true },
      { id: 'PG-2', name: 'Akut', hourRate: 800, billingType: 'hourly', description: 'Akut 800 kr', active: true },
      { id: 'PG-X', name: 'Inaktiv', hourRate: 500, billingType: 'hourly', description: '', active: false },
      { id: 'PG-M', name: 'Månadsavtal', hourRate: 0, billingType: 'monthly', description: 'pris sätts per avtal', active: true },
    ],
  });
  const sql = ['begin;'];
  for (const u of nya) {
    sql.push(`insert into auth.users(id, email) values (${lit(u.authId)}, ${lit(u.alias + '@example.test')});`);
    sql.push(`insert into public.app_users(user_id, staff_id, role_id, active, is_admin) values (${lit(u.authId)}, ${lit(u.staffId)}, ${lit(u.role)}, true, false);`);
    U[u.alias] = { alias: u.alias, staffId: u.staffId, role: u.role, email: u.alias + '@example.test', authId: u.authId };
  }
  for (const [k, v] of Object.entries(store)) sql.push(`insert into public.store(key, value, updated_at) values (${lit(k)}, ${jlit(v)}, '2026-11-01T08:00:00Z') on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;`);
  sql.push('commit;');
  psql(db, sql.join('\n'));
  return store;
}

const KS = { keys: ['vift_workOrders', 'vift_timeEntries', 'vift_invoices', 'vift_articles', 'vift_priceGroups', 'vift_activityLog'], tables: ['op_idempotency', 'stamp_status'] };

(async () => {
  const HIST = fs.mkdtempSync(path.join(os.tmpdir(), 'vift-t4b-'));
  process.on('exit', () => { try { fs.rmSync(HIST, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
  execFileSync('tar', ['-x', '-C', HIST], { input: execFileSync('git', ['-C', path.join(__dirname, '..'), 'archive', FORE_COMMIT, 'supabase'], { maxBuffer: 512 * 1024 * 1024 }) });
  const rotFore = path.join(HIST, 'supabase');
  ok(!fs.existsSync(path.join(rotFore, T4B_MIG)) && fs.existsSync(path.join(rotFore, 'migrations', '20261128000010_t4a_notiser.sql')), 'jämförelsekoden (före) = T4-A + notisdelen ' + FORE_COMMIT + ' (utan T4-B-migrationen)');

  const r = byggReplik({});
  const { db, U } = r;
  ok(r.steg[r.steg.length - 1].rel === T4B_MIG, 'kedjan innehåller T4-B-migrationen 20261128000011 sist (efter notisdelen)');
  ok(r.rapport.oforklarade === 0, `schemajämförelse: 0 oförklarade (T4-B:s objekt förklarade via t4-andringar.json): ${r.rapport.identiska} identiska, ${r.rapport.forklarade} förklarade`);
  laddaVarld(db, U);
  psql(db, `create table public._t4b_bas as select * from public.store; create table public._t4b_idem as select * from public.op_idempotency;`);
  const aterstall = () => psql(db, `begin; delete from public.store; insert into public.store select * from public._t4b_bas; delete from public.op_idempotency; insert into public.op_idempotency select * from public._t4b_idem; delete from public.stamp_status; commit;`);
  const ef = await laddaEf(db, EF);

  const rf = byggReplik({ rot: rotFore, schemakontroll: false });
  const Uf = rf.U;
  laddaVarld(rf.db, Uf);
  const efFore = await laddaEf(rf.db, EF, { root: rotFore });
  psql(rf.db, `create table public._t4b_bas as select * from public.store;`);
  const aterstallFore = () => psql(rf.db, `begin; delete from public.store; insert into public.store select * from public._t4b_bas; commit;`);

  const AW = (e, user, body) => e.anropa('ao-time-write', { user, body: Object.assign({ idempotencyKey: nyckel() }, body) });
  const IW = (e, user, body) => e.anropa('invoice-write', { user, body });
  const SK = (e, user, body) => e.anropa('store-key-write', { user, body });
  const ao = (id, dbx) => (val(dbx || db, 'vift_workOrders') || []).find((a) => a.id === id);
  const te = (id, dbx) => (val(dbx || db, 'vift_timeEntries') || []).find((t) => t.id === id);
  const rad = (aoId, rid, dbx) => ((ao(aoId, dbx) || {}).materials || []).find((m) => m.id === rid);
  const NEJ = async (namn, anrop, forvantat, ks) => { const x = await expectReject(db, anrop, forvantat, ks || KS); ok(x.ok, namn, x.fel.concat([JSON.stringify(x.svar && x.svar.body).slice(0, 300)])); return x; };
  const F = U.falt.staffId, F2 = U.falt2.staffId, C = U.chef.staffId;
  const fakt = (lines, extra) => Object.assign({ title: 'T4-B test', customerId: 'CU-R1', propertyId: 'PROP-R1', sourceAware: true, workOrderIds: [], lines }, extra || {});
  const lin = (id, key, typ, srcId, aoId, unitPrice, qty) => ({ id, description: 'rad ' + id, qty: qty == null ? 1 : qty, unit: 'st', unitPrice, vatRate: 25, source: typ, sourceId: srcId, sourceRefs: [{ sourceKey: key, sourceType: typ, sourceId: srcId, workOrderId: aoId }] });

  // ════════════════ BASLINJE (oförändrad kod, T4-A + notisdelen): bristerna bevisas på samma data ════════════════
  {
    let x = await AW(efFore, Uf.falt, { action: 'patch_ao', aoId: 'AO-A1', patch: { materials: ao('AO-A1', rf.db).materials.map((m) => { const c = clone(m); delete c.buyPrice; return c; }).concat([{ id: 'M-BAS-1', articleId: 'ART-R1', name: 'Testartikel', qty: 1, unit: 'st', sellPrice: 1, buyPrice: 1 }]) } });
    ok(x.status === 200 && rad('AO-A1', 'M-BAS-1', rf.db) && rad('AO-A1', 'M-BAS-1', rf.db).sellPrice === 1,
      'BASLINJE (SÄK-6, P1): fältet sätter försäljningspriset själv (1 kr i stället för artikelns 100 kr) genom att skriva hela materiallistan', x.body);
    x = await AW(efFore, Uf.falt, { action: 'patch_ao', aoId: 'AO-A2', patch: { materials: ao('AO-A2', rf.db).materials.map((m) => { const c = clone(m); delete c.buyPrice; return c; }).concat([{ id: 'M-BAS-2', name: 'Fritext', qty: 1, unit: 'st', sellPrice: 0 }]) } });
    const inv0 = await IW(efFore, Uf.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'material:AO-A2:M-BAS-2', 'material', 'M-BAS-2', 'AO-A2', 0)]) });
    ok(x.status === 200 && inv0.status === 200 && inv0.body.invoice.lines[0].unitPrice === 0,
      'BASLINJE (D-10, SEC-B1-02/15): fritext utan pris lagras som 0 kr och faktureras som en 0-kronorsrad (okänt = 0)', [x.body, inv0.body]);
    x = await IW(efFore, Uf.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'fixed:AO-F1', 'fixed', 'AO-F1', 'AO-F1', 3000), lin('L2', 'material:AO-F1:AO-F1-M1', 'material', 'AO-F1-M1', 'AO-F1', 100, 2)]) });
    ok(x.status === 200, 'BASLINJE (D-10, SEC-B1-16): fastpris-AO faktureras med fastpriset OCH fältmaterialet separat (dubbeldebitering)', x.body);
    const ra = await SK(efFore, Uf.falt, { action: 'readAllWithHashes', keys: ['vift_articles', 'vift_priceGroups'] });
    const wol = await efFore.anropa('work-orders-list', { user: Uf.falt });
    const tel = await efFore.anropa('time-entries-list', { user: Uf.falt });
    ok(ra.body.data.articles.some((a) => a.sellPrice === 100) && ra.body.data.priceGroups.some((g) => g.hourRate === 650)
      && wol.body.workOrders.some((a) => (a.materials || []).some((m) => m.sellPrice === 100)) && tel.body.timeEntries.some((t) => t.hourRate === 650),
      'BASLINJE (D-09, D-11, SEC-B1-09/10, SEC-B2-01): fältet läser försäljningspris (artiklar, AO:ns materialrader) och timpris (prisgrupper, egna tidposter)');
    x = await AW(efFore, Uf.falt, { action: 'create_time', entry: { aoId: 'AO-K1', date: '2026-11-24', minutes: 60, priceGroupId: 'PG-X', hourRate: 9999 } });
    ok(x.status === 200 && te(x.body.timeEntry.id, rf.db).hourRate === 500,
      'BASLINJE (T3-B beslut 1, D-11, SEC-B2-04): fältet registrerar normal tid på en KLAR AO och väljer en inaktiv prisgrupp (ingen kontroll av tillåten grupp)', x.body);
    aterstallFore();
    const dr = await IW(efFore, Uf.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'material:AO-A2:AO-A2-M1', 'material', 'AO-A2-M1', 'AO-A2', 100)]) });
    const mats = ao('AO-A2', rf.db).materials.map((m) => (m.id === 'AO-A2-M1' ? Object.assign(clone(m), { qty: 7 }) : clone(m)));
    x = await AW(efFore, Uf.chef, { action: 'patch_ao', aoId: 'AO-A2', patch: { materials: mats } });
    ok(dr.status === 200 && x.status === 200 && rad('AO-A2', 'AO-A2-M1', rf.db).qty === 7,
      'BASLINJE (T3-B beslut 2): en materialrad som redan tagits in i ett fakturautkast kan ändras (utkastet blir inaktuellt)', x.body);
    const tc = await efFore.anropa('time-entries-list', { user: Uf.chef });
    ok(tc.status === 200 && tc.body.timeEntries.every((t) => t.staffId === Uf.chef.staffId), 'BASLINJE (K-01, funktion): time_view_all är inte verkställd — chef ser bara egen tid');
    aterstallFore();
  }

  // ════════════════ Radvisa materialoperationer (R13–R15, D-19; SEC-B1-01..08) ════════════════
  let mF; // FÄ:s artikelrad på AO-A1
  {
    let x = await expectAccept(db, () => AW(ef, U.falt, { action: 'add_material', aoId: 'AO-A1', row: { articleId: 'ART-R1', qty: 2, sellPrice: 1, buyPrice: 1, addedBy: 'ST-R01', id: 'KLIENT-ID' } }), { status: 200 }, KS, ['store:vift_workOrders', 'tabell:op_idempotency']);
    mF = x.svar.body.row && rad('AO-A1', x.svar.body.row.id);
    ok(x.ok && mF && mF.sellPrice === 100 && mF.buyPrice === 50 && mF.vatRate === 25 && mF.addedBy === F && mF.priceSource === 'general' && mF.id !== 'KLIENT-ID'
      && JSON.stringify((x.svar.body.ignoredFields || []).slice().sort()) === JSON.stringify(['addedBy', 'buyPrice', 'id', 'sellPrice']),
      'SEC-B1-01/03 (E, P): FÄ lägger till artikelrad — servern sätter id, addedBy, försäljnings- och inköpspris och moms från artikeln; klientens priser, id och addedBy ignoreras och redovisas (ignoredFields)', [x.fel, x.svar.body.ignoredFields, mF]);
    ok(!('sellPrice' in x.svar.body.row) && !('buyPrice' in x.svar.body.row) && !JSON.stringify(x.svar.body.workOrder.materials).includes('"sellPrice"'),
      'D-09: svaret till fältet saknar försäljnings- och inköpspris (raden och AO:ns materialrader projicerade)');
    x = await AW(ef, U.falt, { action: 'add_material', aoId: 'AO-A1', row: { name: 'Fritext kabel', qty: 3.5, unit: 'lm', note: 'Bytt vid el-central', sellPrice: 0, buyPrice: 0 } });
    const fr = rad('AO-A1', x.body.row.id);
    ok(x.status === 200 && fr.sellPrice === null && fr.sellPriceUnknown === true && fr.buyPrice === null && fr.buyPriceUnknown === true && fr.unit === 'lm' && fr.note === 'Bytt vid el-central' && fr.performedDate,
      'SEC-B1-02 (E, P): fritextrad med benämning, mängd, enhet och dokumentation — okänt försäljnings- och inköpspris (null + *Unknown), ALDRIG 0', fr);
    await NEJ('SEC-B1-05 (E, P): FÄ ändrar AL:s (äldre) rad på egen AO → 403 not_own_row, AO-KS oförändrad', () => AW(ef, U.falt, { action: 'update_material', aoId: 'AO-A1', rowId: 'AO-A1-M1', patch: { qty: 9 } }), { status: 403, error: 'forbidden', reason: 'not_own_row' });
    await NEJ('SEC-B1-05 (E, P): FÄ tar bort annans rad → 403 not_own_row', () => AW(ef, U.falt, { action: 'remove_material', aoId: 'AO-A1', rowId: 'AO-A1-M1' }), { status: 403, error: 'forbidden', reason: 'not_own_row' });
    await NEJ('D-19: FÄ2 (inte tilldelad AO-A1) lägger till rad → 403 not_assigned', () => AW(ef, U.falt2, { action: 'add_material', aoId: 'AO-A1', row: { name: 'x', qty: 1 } }), { status: 403, error: 'forbidden', reason: 'not_assigned' });
    await NEJ('R13: begränsad (utan ao_material) lägger till rad → 403 forbidden (ingen reason)', () => AW(ef, U.begransad, { action: 'add_material', aoId: 'AO-A1', row: { name: 'x', qty: 1 } }), { status: 403, error: 'forbidden', reason: null });
    await NEJ('R13: ekonomi (utan ao_material/ao_edit) lägger till rad → 403 forbidden', () => AW(ef, U.ekonomi, { action: 'add_material', aoId: 'AO-A1', row: { name: 'x', qty: 1 } }), { status: 403, error: 'forbidden', reason: null });
    await NEJ('SEC-B1-14 (E, P): FÄ kompletterar försäljningspris på egen rad → 403 field_protected', () => AW(ef, U.falt, { action: 'update_material', aoId: 'AO-A1', rowId: fr.id, patch: { sellPrice: 120 } }), { status: 403, error: 'forbidden', reason: 'field_protected' });
    await NEJ('SEC-B1-14: FÄ sätter inköpspris på egen rad → 403 field_protected', () => AW(ef, U.falt, { action: 'update_material', aoId: 'AO-A1', rowId: fr.id, patch: { buyPrice: 40 } }), { status: 403, error: 'forbidden', reason: 'field_protected' });
    await NEJ('SEC-B1-14: egen roll "chef utan cost_edit/invoice_create" kompletterar försäljningspris → 403 field_protected', () => AW(ef, U.egenchef, { action: 'update_material', aoId: 'AO-A1', rowId: fr.id, patch: { sellPrice: 120 } }), { status: 403, error: 'forbidden', reason: 'field_protected' });
    await NEJ('R21: FÄ markerar sin rad som tillägg på fastpris → 403 field_protected', () => AW(ef, U.falt, { action: 'update_material', aoId: 'AO-A1', rowId: fr.id, patch: { extra: true } }), { status: 403, error: 'forbidden', reason: 'field_protected' });
    await NEJ('indata: antal 0 → 400 invalid_row', () => AW(ef, U.falt, { action: 'add_material', aoId: 'AO-A1', row: { name: 'x', qty: 0 } }), { status: 400, error: 'invalid_row' });
    await NEJ('indata: fritext utan benämning → 400 invalid_row', () => AW(ef, U.falt, { action: 'add_material', aoId: 'AO-A1', row: { qty: 1 } }), { status: 400, error: 'invalid_row' });
    await NEJ('indata: okänd artikel → 400 invalid_reference', () => AW(ef, U.falt, { action: 'add_material', aoId: 'AO-A1', row: { articleId: 'ART-FINNS-INTE', qty: 1 } }), { status: 400, error: 'invalid_reference' });
    await NEJ('indata: utförandedatum i framtiden → 400 invalid_row', () => AW(ef, U.falt, { action: 'add_material', aoId: 'AO-A1', row: { name: 'x', qty: 1, performedDate: '2099-01-01' } }), { status: 400, error: 'invalid_row' });
    await NEJ('påhittad AO → 404 not_found', () => AW(ef, U.falt, { action: 'add_material', aoId: 'AO-FINNS-INTE', row: { name: 'x', qty: 1 } }), { status: 404, error: 'not_found' });
    for (const [aoId, namn] of [['AO-A9', 'fakturerad'], ['AO-A6', 'arkiverad'], ['AO-A7', 'borttagen']]) {
      await NEJ(`SEC-B1-08 (E, P): rad på ${namn} AO → 409 ao_locked`, () => AW(ef, U.falt, { action: 'add_material', aoId, row: { name: 'x', qty: 1 } }), { status: 409, error: 'ao_locked' });
    }
    x = await AW(ef, U.falt, { action: 'update_material', aoId: 'AO-A1', rowId: fr.id, patch: { qty: 4, note: 'ändrad', sellPrice: undefined } });
    const fr2 = rad('AO-A1', fr.id);
    ok(x.status === 200 && fr2.qty === 4 && fr2.note === 'ändrad' && fr2.updatedBy === F && fr2.sellPriceUnknown === true, 'SEC-B1-04 (E, P): FÄ ändrar egen rad (mängd, dokumentation); priset förblir okänt', fr2);
    await NEJ('radversion: ändring med inaktuell expectedUpdatedAt → 409 stale_write', () => AW(ef, U.falt, { action: 'update_material', aoId: 'AO-A1', rowId: fr.id, patch: { qty: 5 }, expectedUpdatedAt: fr.updatedAt }), { status: 409, error: 'stale_write' });
    // Arbetsledaren (chef: ao_edit, invoice_create, cost_edit) kompletterar okänt pris (SEC-B1-13, R17, R20).
    const logFore = (ao('AO-A1').log || []).length;
    x = await AW(ef, U.chef, { action: 'update_material', aoId: 'AO-A1', rowId: fr.id, patch: { sellPrice: 45, buyPrice: 30 }, expectedUpdatedAt: fr2.updatedAt });
    const fr3 = rad('AO-A1', fr.id);
    const nyLogg = (ao('AO-A1').log || []).slice(logFore);
    ok(x.status === 200 && fr3.sellPrice === 45 && fr3.sellPriceUnknown === false && fr3.buyPrice === 30 && fr3.buyPriceUnknown === false && fr3.priceSource === 'manual'
      && nyLogg.length === 1 && nyLogg[0].type === 'material_price_completed' && !/45|30/.test(nyLogg[0].text),
      'SEC-B1-13 (E, P): arbetsledaren kompletterar okänt försäljnings- och inköpspris — flaggorna tas bort och kompletteringen loggas i AO:ns logg (utan belopp)', [fr3, nyLogg]);
    x = await AW(ef, U.chef, { action: 'update_material', aoId: 'AO-A1', rowId: mF.id, patch: { qty: 1 } });
    ok(x.status === 200 && rad('AO-A1', mF.id).qty === 1, 'R15: arbetsledaren (ao_edit) ändrar annans (FÄ:s) rad');
    x = await AW(ef, U.falt, { action: 'remove_material', aoId: 'AO-A1', rowId: mF.id });
    ok(x.status === 200 && !rad('AO-A1', mF.id) && x.body.removedId === mF.id, 'SEC-B1-04: FÄ tar bort egen rad');
    // Material på KLAR men ej fakturerad AO är tillåtet (T3-B beslut 2).
    x = await AW(ef, U.falt, { action: 'add_material', aoId: 'AO-K1', row: { name: 'Glömd skruv', qty: 10 } });
    ok(x.status === 200, 'T3-B beslut 2: FÄ lägger till material på klar men ej fakturerad AO');
    // Artikel med pris 0 (schemats standard) = okänt pris; momssats från artikeln.
    x = await AW(ef, U.falt, { action: 'add_material', aoId: 'AO-A1', row: { articleId: 'ART-R2', qty: 2 } });
    const r2 = rad('AO-A1', x.body.row.id);
    ok(x.status === 200 && r2.sellPrice === null && r2.sellPriceUnknown === true && r2.unit === 'm', 'okänt ≠ 0: artikel med försäljningspris 0 ger okänt pris på raden', r2);
    x = await AW(ef, U.falt, { action: 'add_material', aoId: 'AO-A1', row: { articleId: 'ART-R3', qty: 1 } });
    ok(x.status === 200 && rad('AO-A1', x.body.row.id).vatRate === 12, 'momssats ur artikeln (12 %) i ögonblicksbilden');
    // Idempotens: samma nyckel och samma innehåll → samma svar utan ny rad; annat innehåll → 409.
    const k = nyckel();
    const a1 = await ef.anropa('ao-time-write', { user: U.falt, body: { action: 'add_material', idempotencyKey: k, aoId: 'AO-A1', row: { name: 'Idem', qty: 1 } } });
    const antal = ao('AO-A1').materials.length;
    const a2 = await ef.anropa('ao-time-write', { user: U.falt, body: { action: 'add_material', idempotencyKey: k, aoId: 'AO-A1', row: { name: 'Idem', qty: 1 } } });
    ok(a1.status === 200 && a2.status === 200 && a2.body.row.id === a1.body.row.id && ao('AO-A1').materials.length === antal, 'idempotens: omförsök med samma nyckel ger samma rad, ingen dubblett');
    await NEJ('idempotens: samma nyckel med annat innehåll → 409 idempotency_key_conflict', () => ef.anropa('ao-time-write', { user: U.falt, body: { action: 'add_material', idempotencyKey: k, aoId: 'AO-A1', row: { name: 'Annat', qty: 2 } } }), { status: 409, error: 'idempotency_key_conflict' });
    aterstall();
  }

  // ════════════════ Hela listan: fältet nekas, arbetsledaren prissätts av servern (SEC-B1-06, gammal klient) ════════════════
  {
    const fältvy = (aoId) => ao(aoId).materials.map((m) => { const c = clone(m); delete c.buyPrice; delete c.sellPrice; return c; });
    await NEJ('SEC-B1-06 (E): fältets gamla väg patch_ao {materials:[…]} (hel lista, v3.4/T3/T4-A-klient) → 403 forbidden/row_path_required, ingen rad skapas', () => AW(ef, U.falt, { action: 'patch_ao', aoId: 'AO-A1', patch: { materials: fältvy('AO-A1').concat([{ id: 'M-GAMMAL', name: 'Fritext', qty: 1, unit: 'st', sellPrice: 0, buyPrice: 0 }]) } }), { status: 403, error: 'forbidden', reason: 'row_path_required' });
    await NEJ('SEC-B1-06: även en hel lista med oförändrade rader nekas för fältet (D-19: hela listan nekas)', () => AW(ef, U.falt, { action: 'patch_ao', aoId: 'AO-A1', patch: { materials: fältvy('AO-A1') } }), { status: 403, error: 'forbidden', reason: 'row_path_required' });
    // Arbetsledaren (v3.4-klientens materialformulär skickar "|| 0" för pris) — ny rad och okänd rad.
    const lista = clone(ao('AO-K1').materials).concat([{ id: 'M' + Date.now(), articleId: 'ART-R1', name: 'Testartikel', qty: 1, unit: 'st', buyPrice: 0, sellPrice: 1, vatRate: 25, addedAt: new Date().toISOString() },
      { id: 'M-NOLL', articleId: '', name: 'Fritext noll', qty: 1, unit: 'st', buyPrice: 0, sellPrice: 0, vatRate: 25 }]);
    let x = await AW(ef, U.chef, { action: 'patch_ao', aoId: 'AO-K1', patch: { materials: lista } });
    const k1 = rad('AO-K1', 'AO-K1-M1'), ny = ao('AO-K1').materials.find((m) => m.articleId === 'ART-R1'), noll = rad('AO-K1', 'M-NOLL');
    ok(x.status === 200 && ny.sellPrice === 100 && ny.priceSource === 'general' && ny.addedBy === C && noll.sellPrice === null && noll.sellPriceUnknown === true
      && k1.sellPrice === 0 && (x.body.ignoredFields || []).includes('materials[].sellPrice'),
      'gammal klient (v3.4/T3/T4-A, arbetsledare): hela listan godtas, men nya rader prissätts av servern (artikel 100 kr, inte klientens 1 kr; fritext 0 → OKÄNT) och en befintlig rad med okänt pris förblir okänd (klientens 0 ignoreras) — ingen 0-kronorsrad', [x.body.ignoredFields, ny, noll, k1]);
    x = await AW(ef, U.chef, { action: 'patch_ao', aoId: 'AO-K1', patch: { materials: ao('AO-K1').materials.map((m) => (['M-NOLL', 'AO-K1-M1'].includes(m.id) ? Object.assign(clone(m), { sellPrice: 0, buyPrice: 0 }) : clone(m))) } });
    ok(x.status === 200 && rad('AO-K1', 'M-NOLL').sellPrice === null && rad('AO-K1', 'M-NOLL').sellPriceUnknown === true && rad('AO-K1', 'M-NOLL').buyPrice === null
      && (x.body.ignoredFields || []).includes('materials[].sellPrice') && (x.body.ignoredFields || []).includes('materials[].buyPrice'),
      'gammal klient (arbetsledarens redigeringsformulär "|| 0"): 0 kr skickat för en rad med OKÄNT pris ignoreras — raden förblir okänd (ingen 0-kronorsrad)', [x.body.ignoredFields, rad('AO-K1', 'M-NOLL')]);
    x = await AW(ef, U.chef, { action: 'patch_ao', aoId: 'AO-K1', patch: { materials: ao('AO-K1').materials.map((m) => (m.id === 'M-NOLL' ? Object.assign(clone(m), { sellPrice: 75 }) : clone(m))) } });
    ok(x.status === 200 && rad('AO-K1', 'M-NOLL').sellPrice === 75 && rad('AO-K1', 'M-NOLL').sellPriceUnknown === false && rad('AO-K1', 'M-NOLL').priceSource === 'manual',
      'arbetsledaren med prissättningsrätt (invoice_create/cost_edit) kompletterar ett okänt pris även i hela listan (pris > 0)');
    await NEJ('egen roll "chef utan cost_edit/invoice_create": ändrat försäljningspris i hela listan → 403 field_protected', () => AW(ef, U.egenchef, { action: 'patch_ao', aoId: 'AO-K1', patch: { materials: ao('AO-K1').materials.map((m) => { const c = clone(m); delete c.buyPrice; if (c.id === 'M-NOLL') c.sellPrice = 80; return c; }) } }), { status: 403, error: 'forbidden', reason: 'field_protected' });
    x = await AW(ef, U.egenchef, { action: 'patch_ao', aoId: 'AO-K1', patch: { materials: ao('AO-K1').materials.map((m) => { const c = clone(m); delete c.buyPrice; delete c.addedBy; c.addedAt = '2000-01-01T00:00:00.000Z'; if (c.id === 'M-NOLL') c.qty = 3; return c; }) } });
    ok(x.status === 200 && rad('AO-K1', 'M-NOLL').qty === 3 && rad('AO-K1', 'M-NOLL').addedBy === C && rad('AO-K1', 'M-NOLL').addedAt !== '2000-01-01T00:00:00.000Z' && rad('AO-K1', 'M-NOLL').buyPrice === null,
      'hela listan: serverägda fält (addedBy, addedAt) och oläsbart inköpspris behåller serverns värde; mängden ändras', rad('AO-K1', 'M-NOLL'));
    aterstall();
  }

  // ════════════════ Projektion av priser (D-09, D-11; SEC-B1-09/10, SEC-B2-01, SEC-TID-06/09) ════════════════
  {
    const LAS = ['vift_articles', 'vift_priceGroups'];
    const harPris = (o) => /"(sellPrice|hourRate)":\s*[0-9]/.test(JSON.stringify(o || null));
    const utan = ['falt', 'falt2', 'begransad', 'tom', 'personalansvarig', 'adminhanterare', 'tidsans'];
    const med = ['admin', 'chef', 'ekonomi', 'egenchef', 'artikel', 'chef_utan_faktura', 'saljare'];
    const fel = [];
    for (const a of utan.concat(med)) {
      const ra = await SK(ef, U[a], { action: 'readAllWithHashes', keys: LAS });
      const wol = await ef.anropa('work-orders-list', { user: U[a] });
      const tel = await ef.anropa('time-entries-list', { user: U[a] });
      const rest = asUser(db, U[a], `select coalesce(string_agg(key, ','), '') as k from public.store where key in ('vift_articles','vift_priceGroups')`);
      const syns = harPris(ra.body && ra.body.data) || harPris(wol.body) || harPris(tel.body) || /vift_(articles|priceGroups)/.test(JSON.stringify(rest.rows || []));
      if (utan.includes(a) === syns) fel.push(a + (syns ? ' ser pris' : ' ser inte pris'));
    }
    ok(fel.length === 0, `SEC-B1-09/10, SEC-B2-01 (E, R): försäljningspris och timpris lämnas inte ut till ${utan.length} roller utan prisläsrätt (fält, begränsad, tom, egna roller, time_view_all) i readAllWithHashes, work-orders-list, time-entries-list eller REST — men till ${med.length} med (admin, chef, ekonomi, ao_edit, article_manage, invoice_view)`, fel);
    const ra = await SK(ef, U.falt, { action: 'readAllWithHashes', keys: LAS });
    const g = ra.body.data.priceGroups;
    ok(JSON.stringify(g.map((x) => x.id)) === JSON.stringify(['PG-1', 'PG-2', 'PG-M']) && g.every((x) => x.name && !('hourRate' in x) && !('description' in x)) && ra.body.data.articles.every((a) => a.name && !('sellPrice' in a) && !('buyPrice' in a)),
      'R22 (D-11): fältet får prisgruppernas namn (bara aktiva, valbara grupper) utan timpris och beskrivning, och artiklarnas namn utan priser', [g, ra.body.data.articles]);
    const tel = await ef.anropa('time-entries-list', { user: U.falt });
    ok(tel.body.timeEntries.length > 0 && tel.body.timeEntries.every((t) => t.staffId === F && !('hourRate' in t) && t.priceGroupName), 'SEC-TID-09, SEC-B2-01: fältet ser bara egna tidposter, med prisgruppens namn men utan timpris');
    const tb = await ef.anropa('time-entries-list', { user: U.begransad });
    ok(tb.status === 200 && tb.body.timeEntries.length === 0, 'SEC-TID-09: begränsad ser inga andras tidposter');
  }

  // ════════════════ time_view_all (K-01, D-08; SEC-TID-06/07/08) ════════════════
  {
    const alla = val(db, 'vift_timeEntries').length;
    let x = await ef.anropa('time-entries-list', { user: U.chef });
    const andras = x.body.timeEntries.filter((t) => t.staffId !== C);
    ok(x.status === 200 && x.body.timeEntries.length === alla && andras.length > 0 && andras.every((t) => !('attested' in t) && !('attestedBy' in t) && !('attestedAt' in t) && !('corrections' in t)) && andras.some((t) => t.hourRate === 650),
      'SEC-TID-06 (K-01): arbetsledaren (time_view_all) ser ALL personals tidposter — utan attest och andra löneuppgifter; timpris med prisläsrätt (cost_view)', andras.slice(0, 2));
    const egen = x.body.timeEntries.find((t) => t.id === 'TE-C1');
    ok(egen && egen.attested === true, 'egna tidposter oförändrade (egen attestmarkering syns)');
    x = await ef.anropa('time-entries-list', { user: U.tidsans });
    ok(x.status === 200 && x.body.timeEntries.length === alla && x.body.timeEntries.every((t) => !('hourRate' in t) && !('attested' in t)),
      'K-01: en roll med bara time_view_all ser all arbetstid utan belopp (inget timpris) och utan attest — inget mer');
    const LASK = ['vift_workOrders', 'vift_customers', 'vift_articles', 'vift_priceGroups', 'vift_staff', 'vift_settings', 'vift_invoices', 'vift_offers', 'vift_activityLog'];
    const ra1 = await SK(ef, U.tidsans, { action: 'readAllWithHashes', keys: LASK });
    const rr = val(db, 'vift_roles');
    psql(db, `update public.store set value = ${jlit(rr.map((y) => (y.id === 'tidsansvarig' ? Object.assign({}, y, { permissions: ['dashboard_view'] }) : y)))} where key = 'vift_roles'`);
    const ra0 = await SK(ef, U.tidsans, { action: 'readAllWithHashes', keys: LASK });
    psql(db, `update public.store set value = ${jlit(rr)} where key = 'vift_roles'`);
    const utanLc = (b) => { const d = Object.assign({}, (b && b.data) || {}); delete d.lastChanged; return JSON.stringify(d); };
    ok(ra1.status === 200 && utanLc(ra1.body) === utanLc(ra0.body), 'K-01: time_view_all ger ingen annan verksamhetsdata — readAllWithHashes identiskt med samma roll utan time_view_all (bara dashboard_view)', [utanLc(ra1.body).slice(0, 200)]);
    const wol = await ef.anropa('work-orders-list', { user: U.tidsans });
    ok(wol.status === 200 && (wol.body.workOrders || []).length === 0, 'K-01: time_view_all ger inte AO-läsning');
    x = await ef.anropa('time-entries-list', { user: U.ekonomi });
    ok(x.body.timeEntries.some((t) => t.staffId !== U.ekonomi.staffId && 'attested' in t && t.hourRate === 650), 'D-08: payroll_view (ekonomi) ser all tid med attest och timpris (oförändrat)');
    await NEJ('SEC-TID-07: arbetsledaren attesterar → 403 forbidden (payroll_manage saknas)', () => AW(ef, U.chef, { action: 'attest_time', entryId: 'TE-R1', attested: true }), { status: 403, error: 'forbidden' });
    ok(!val(db, 'vift_roles').find((r) => r.id === 'chef').permissions.includes('payroll_view'), 'SEC-TID-08: standardrollen chef har inte payroll_view (löneunderlaget kräver den; klientsidan prövas i e2e)');
    const ej = rpc(db, '_vift_ej_verkstallda', {});
    ok(!ej.error && Array.isArray(ej.data) && !ej.data.includes('time_view_all') && JSON.stringify(ej.data) === JSON.stringify(['ao_plan_own', 'objects_access_assigned', 'rondering_utfor', 'export_data', 'export_personal_data']),
      'registret: time_view_all borttagen ur _vift_ej_verkstallda() (verkställd)', ej);
    const sj = standard();
    ok(!Object.keys(sj.ejVerkstallda || {}).includes('time_view_all'), 'spegling: standardroller.json ejVerkstallda saknar time_view_all');
  }

  // ════════════════ Tid: prisgrupp (D-11; SEC-B2-03..05), tidlås på klar AO (T3-B beslut 1), stämpling ════════════════
  {
    let x = await expectAccept(db, () => AW(ef, U.falt, { action: 'create_time', entry: { aoId: 'AO-A1', date: '2026-11-24', minutes: 60, priceGroupId: 'PG-1', hourRate: 9999 } }), { status: 200 }, KS, ['store:vift_timeEntries', 'store:vift_workOrders', 'tabell:op_idempotency']);
    ok(x.ok && te(x.svar.body.timeEntry.id).hourRate === 650 && (x.svar.body.ignoredFields || []).includes('hourRate') && !('hourRate' in x.svar.body.timeEntry),
      'SEC-B2-03 (E, P): create_time med hourRate 9999 → 200 ignoredFields hourRate; lagrat = prisgruppens timpris; svaret till fältet utan timpris', x.svar.body);
    await NEJ('SEC-B2-04 (E, P): inaktiv prisgrupp för fältet → 403 price_group_not_allowed', () => AW(ef, U.falt, { action: 'create_time', entry: { aoId: 'AO-A1', date: '2026-11-24', minutes: 60, priceGroupId: 'PG-X' } }), { status: 403, error: 'forbidden', reason: 'price_group_not_allowed' });
    await NEJ('SEC-B2-04: annan grupp än AO:ns (AO-A1 = PG-1) för fältet → 403 price_group_not_allowed', () => AW(ef, U.falt, { action: 'create_time', entry: { aoId: 'AO-A1', date: '2026-11-24', minutes: 60, priceGroupId: 'PG-2' } }), { status: 403, error: 'forbidden', reason: 'price_group_not_allowed' });
    await NEJ('SEC-B2-04: okänd prisgrupp → 403 price_group_not_allowed (även arbetsledaren)', () => AW(ef, U.chef, { action: 'create_time', entry: { aoId: 'AO-A1', date: '2026-11-24', minutes: 60, priceGroupId: 'PG-FINNS-INTE' } }), { status: 403, error: 'forbidden', reason: 'price_group_not_allowed' });
    x = await AW(ef, U.chef, { action: 'create_time', entry: { aoId: 'AO-A1', date: '2026-11-24', minutes: 30, priceGroupId: 'PG-2' } });
    ok(x.status === 200 && te(x.body.timeEntry.id).hourRate === 800, 'R22: arbetsledaren (kontorsroll) får välja en annan befintlig grupp (800 kr)');
    x = await AW(ef, U.falt, { action: 'create_time', entry: { aoId: 'AO-A1', date: '2026-11-24', minutes: 30, hourRate: 0 } });
    const okand = te(x.body.timeEntry.id);
    ok(x.status === 200 && okand.hourRate === null && okand.hourRateUnknown === true, 'okänt ≠ 0: tid utan prisgrupp får okänt timpris (null + hourRateUnknown), aldrig 0', okand);
    // SEC-B2-05: prisgruppens timpris ändras efter registrerad tid → befintliga tidposters hourRate oförändrat.
    const pg = val(db, 'vift_priceGroups');
    const hash = psql(db, `select encode(sha256(convert_to(value::text, 'UTF8')), 'hex') from public.store where key = 'vift_priceGroups'`);
    const w = await SK(ef, U.admin, { action: 'write', key: 'vift_priceGroups', value: pg.map((g) => (g.id === 'PG-1' ? Object.assign({}, g, { hourRate: 700 }) : g)), expectedHash: hash });
    ok(w.status === 200 && te('TE-R1').hourRate === 650 && te('TE-K1').hourRate === 650, 'SEC-B2-05 (R24): ändrat timpris i prisgruppen ändrar inte befintliga tidposters timpris (historiska priser)', w.body);
    // Materialradernas ögonblicksbild: ändrat artikelpris ändrar inte gamla rader.
    const a = await AW(ef, U.falt, { action: 'add_material', aoId: 'AO-A2', row: { articleId: 'ART-R1', qty: 1 } });
    const arts = val(db, 'vift_articles');
    const ah = psql(db, `select encode(sha256(convert_to(value::text, 'UTF8')), 'hex') from public.store where key = 'vift_articles'`);
    const w2 = await SK(ef, U.admin, { action: 'write', key: 'vift_articles', value: arts.map((y) => (y.id === 'ART-R1' ? Object.assign({}, y, { sellPrice: 150 }) : y)), expectedHash: ah });
    const b = await AW(ef, U.falt, { action: 'add_material', aoId: 'AO-A2', row: { articleId: 'ART-R1', qty: 1 } });
    ok(w2.status === 200 && rad('AO-A2', a.body.row.id).sellPrice === 100 && rad('AO-A2', b.body.row.id).sellPrice === 150, 'R24: historiska priser — en ändrad artikel ändrar inte befintliga materialrader (ögonblicksbild); nya rader får det nya priset');
    aterstall();

    // T3-B beslut 1: normal tid låst på klar och fakturerad AO; legitim utstämpling alltid möjlig.
    await NEJ('T3-B beslut 1: fältet registrerar tid på KLAR AO → 409 ao_locked', () => AW(ef, U.falt, { action: 'create_time', entry: { aoId: 'AO-K1', date: '2026-11-24', minutes: 60, priceGroupId: 'PG-1' } }), { status: 409, error: 'ao_locked' });
    await NEJ('T3-B beslut 1: även arbetsledaren (ao_edit) → 409 ao_locked på klar AO', () => AW(ef, U.chef, { action: 'create_time', entry: { aoId: 'AO-K1', date: '2026-11-24', minutes: 60, priceGroupId: 'PG-1' } }), { status: 409, error: 'ao_locked' });
    await NEJ('T3-B beslut 1: tid på fakturerad AO → 409 ao_locked', () => AW(ef, U.falt, { action: 'create_time', entry: { aoId: 'AO-A9', date: '2026-11-24', minutes: 60 } }), { status: 409, error: 'ao_locked' });
    await NEJ('T3-B beslut 1: ändring av egen tidpost på klar AO → 409 ao_locked', () => AW(ef, U.falt, { action: 'patch_time', entryId: 'TE-K1', patch: { minutes: 90 } }), { status: 409, error: 'ao_locked' });
    await NEJ('T3-B beslut 1: borttagning av egen tidpost på klar AO → 409 ao_locked', () => AW(ef, U.falt, { action: 'delete_time', entryId: 'TE-K1' }), { status: 409, error: 'ao_locked' });
    await NEJ('T3-B beslut 1: flytt av tidpost till klar AO → 409 ao_locked', () => AW(ef, U.falt, { action: 'patch_time', entryId: 'TE-R1', patch: { aoId: 'AO-K1' } }), { status: 409, error: 'ao_locked' });
    await NEJ('T3-B beslut 1: instämpling på klar AO → 409 ao_locked', () => SK(ef, U.falt, { action: 'setStampStatus', active: true, ts: Date.parse('2026-11-24T08:00:00.000Z'), aoId: 'AO-K1', expectedRevision: 0 }), { status: 409, error: 'ao_locked' });
    // Legitim utstämpling: instämplad på pågående AO-A2 strax före midnatt (sommartid → vintertid passeras inte här, men dygnsskiftet), AO:n blir klar under passet.
    const ts = Date.parse('2026-10-24T21:50:00.000Z');
    let s = await SK(ef, U.falt, { action: 'setStampStatus', active: true, ts, aoId: 'AO-A2', expectedRevision: 0 });
    psql(db, `update public.store set value = (select jsonb_agg(case when e->>'id' = 'AO-A2' then e || '{"status":"klar"}'::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_workOrders'`);
    x = await AW(ef, U.falt, { action: 'create_time', entry: { aoId: 'AO-A2', date: '2026-10-24', startStr: '23:50', endStr: '02:10', minutes: 200, startTs: ts, priceGroupId: 'PG-2' } });
    ok(s.status === 200 && x.status === 200 && te(x.body.timeEntry.id).hourRate === 650 && (x.body.ignoredFields || []).includes('priceGroupId'),
      'T3-B beslut 1: legitim utstämpling på en AO som blivit klar under passet (över midnatt och sommartidsskiftet 25/10) slutförs alltid; en otillåten prisgrupp fäller den inte (AO:ns grupp används, valet redovisas)', x.body);
    s = await SK(ef, U.falt, { action: 'setStampStatus', active: false, ts: null, aoId: null, expectedRevision: 1 });
    ok(s.status === 200, 'utstämpling (stamp_status inaktiv) prövas aldrig mot AO:n');
    aterstall();
    // Checklista, logg och material på klar men ej fakturerad AO (T3-B beslut 2) fungerar.
    const c = await ef.anropa('work-order-checklist-resolve', { user: U.falt, body: { aoId: 'AO-K1', itemId: 'AO-A3-C1', action: 'done' } });
    const l = await ef.anropa('work-order-log-write', { user: U.falt, body: { action: 'append_log', aoId: 'AO-K1', entry: { id: 'L-T4B-1', type: 'note', text: 'Dokumentation efter klar' } } });
    ok([200].includes(c.status) && l.status === 200, 'T3-B beslut 2: checklista och logg/dokumentation på klar men ej fakturerad AO tillåts', [c.status, c.body, l.status]);
    aterstall();
  }

  // ════════════════ Behörig, loggad rättning av tid (T3-B beslut 1, punkt 276) ════════════════
  {
    let x = await expectAccept(db, () => AW(ef, U.ekonomi, { action: 'correct_time', entry: { aoId: 'AO-K1', staffId: F, date: '2026-11-22', minutes: 45, priceGroupId: 'PG-1', hourRate: 1 }, reason: 'Glömd tid vid slutbesiktning' }),
      { status: 200 }, KS, ['store:vift_timeEntries', 'store:vift_workOrders', 'tabell:op_idempotency']);
    const ny = x.svar.body.timeEntry && te(x.svar.body.timeEntry.id);
    const logg = (ao('AO-K1').log || []).slice(-1)[0];
    ok(x.ok && ny && ny.staffId === F && ny.hourRate === 650 && ny.registeredById === U.ekonomi.staffId && ny.corrections.length === 1 && ny.corrections[0].reason === 'Glömd tid vid slutbesiktning'
      && ny.corrections[0].by === U.ekonomi.staffId && logg.type === 'time_corrected' && /Glömd tid/.test(logg.text) && !/650/.test(logg.text) && ao('AO-K1').timeEntries.includes(ny.id),
      'punkt 276: ekonomi (payroll_manage) kompletterar glömd tid på klar AO — servern sätter timpris (klientens ignoreras), revisionsrad (vem, när, orsak) och en loggpost i AO:n utan belopp', [x.fel, ny, logg]);
    x = await AW(ef, U.ekonomi, { action: 'correct_time', entryId: 'TE-K1', entry: { minutes: 75 }, reason: 'Fel sluttid', expectedUpdatedAt: T0 });
    const k1 = te('TE-K1');
    ok(x.status === 200 && k1.minutes === 75 && k1.corrections[0].before.minutes === 60 && k1.corrections[0].after.minutes === 75, 'punkt 276: rättning av befintlig tidpost på klar AO med före/efter i revisionsraden', k1.corrections);
    await NEJ('rättning utan orsak → 400 reason_required', () => AW(ef, U.ekonomi, { action: 'correct_time', entryId: 'TE-K1', entry: { minutes: 80 }, reason: 'x' }), { status: 400, error: 'reason_required' });
    await NEJ('rättning av fältet (utan payroll_manage) → 403 forbidden', () => AW(ef, U.falt, { action: 'correct_time', entryId: 'TE-K1', entry: { minutes: 80 }, reason: 'Jag glömde' }), { status: 403, error: 'forbidden' });
    await NEJ('rättning av arbetsledaren (ao_edit, utan payroll_manage) → 403 forbidden (beslut som behövs)', () => AW(ef, U.chef, { action: 'correct_time', entryId: 'TE-K1', entry: { minutes: 80 }, reason: 'Jag glömde' }), { status: 403, error: 'forbidden' });
    await NEJ('attesterad tidpost ändras inte utan korrigeringsflöde för attest → 409 attested_locked', () => AW(ef, U.ekonomi, { action: 'correct_time', entryId: 'TE-R3', entry: { minutes: 10 }, reason: 'Rättning av attesterad' }), { status: 409, error: 'attested_locked' });
    await NEJ('rättning på fakturerad AO → 409 ao_locked (kräver fakturans korrigeringsflöde)', () => AW(ef, U.ekonomi, { action: 'correct_time', entry: { aoId: 'AO-A9', staffId: F, date: '2026-11-22', minutes: 30 }, reason: 'Komplettering fakturerad' }), { status: 409, error: 'ao_locked' });
    await NEJ('rättning med inaktuell radversion → 409 stale_write', () => AW(ef, U.ekonomi, { action: 'correct_time', entryId: 'TE-K1', entry: { minutes: 80 }, reason: 'Ny rättning', expectedUpdatedAt: T0 }), { status: 409, error: 'stale_write' });
    aterstall();
  }

  // ════════════════ Fakturavägen: okänt pris, fastpris, serverpris, fakturerade källrader låsta ════════════════
  {
    const KSI = KS;
    await NEJ('SEC-B1-15 (P, E): fakturaunderlag med okänt försäljningspris (fritext utan pris, äldre 0-rad) → 409 price_unknown, ingen faktura', () => IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'material:AO-K1:AO-K1-M1', 'material', 'AO-K1-M1', 'AO-K1', 0)]) }), { status: 409, error: 'price_unknown' }, KSI);
    await NEJ('SEC-B1-16 (D-10): fältmaterial på fastpris-AO (inte markerat som tillägg) → 409 included_in_fixed_price (ingen dubbeldebitering)', () => IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'fixed:AO-F1', 'fixed', 'AO-F1', 'AO-F1', 3000), lin('L2', 'material:AO-F1:AO-F1-M1', 'material', 'AO-F1-M1', 'AO-F1', 100, 2)]) }), { status: 409, error: 'included_in_fixed_price' }, KSI);
    await NEJ('D-10: tid på fastpris-AO som egen rad → 409 included_in_fixed_price', () => IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'time:TE-R2', 'time', 'TE-R2', 'AO-A8', 650, 3)]) }), { status: 409, error: 'included_in_fixed_price' }, KSI);
    await NEJ('serverpris: klientens à-pris avviker från källans (100 kr) → 409 price_mismatch', () => IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'material:AO-A2:AO-A2-M1', 'material', 'AO-A2-M1', 'AO-A2', 1)]) }), { status: 409, error: 'price_mismatch' }, KSI);
    await NEJ('påhittad källa → 409 source_not_found', () => IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'material:AO-A2:FINNS-INTE', 'material', 'FINNS-INTE', 'AO-A2', 100)]) }), { status: 409, error: 'source_not_found' }, KSI);
    await NEJ('fastpris-rad på löpande AO → 409 source_not_billable', () => IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'fixed:AO-A2', 'fixed', 'AO-A2', 'AO-A2', 1)]) }), { status: 409, error: 'source_not_billable' }, KSI);
    await NEJ('källreferens med fel AO → 400 invalid_source_ref', () => IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([Object.assign(lin('L1', 'material:AO-A2:AO-A2-M1', 'material', 'AO-A2-M1', 'AO-A1', 100))]) }), { status: 400, error: 'invalid_source_ref' }, KSI);
    // Tillägg på fastpris (R21): arbetsledaren markerar raden → debiteras separat.
    let x = await AW(ef, U.chef, { action: 'update_material', aoId: 'AO-F1', rowId: 'AO-F1-M1', patch: { extra: true } });
    const f1 = await IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'fixed:AO-F1', 'fixed', 'AO-F1', 'AO-F1', 3000), lin('L2', 'material:AO-F1:AO-F1-M1', 'material', 'AO-F1-M1', 'AO-F1', 100, 2)], { workOrderIds: ['AO-F1'] }) });
    ok(x.status === 200 && f1.status === 200 && f1.body.invoice.lines.length === 2, 'R21 (D-10): material uttryckligen markerat som tillägg (ao_edit/invoice_create) debiteras separat på fastpris-AO', [x.body, f1.body]);
    // Fakturerade källrader är låsta (T3-B beslut 2) — även i utkast.
    await NEJ('T3-B beslut 2: materialrad i ett fakturautkast ändras inte (radvis) → 409 invoiced_locked', () => AW(ef, U.chef, { action: 'update_material', aoId: 'AO-F1', rowId: 'AO-F1-M1', patch: { qty: 5 } }), { status: 409, error: 'invoiced_locked' });
    await NEJ('T3-B beslut 2: … och tas inte bort → 409 invoiced_locked', () => AW(ef, U.falt, { action: 'remove_material', aoId: 'AO-F1', rowId: 'AO-F1-M1' }), { status: 409, error: 'invoiced_locked' });
    await NEJ('T3-B beslut 2: … inte heller via arbetsledarens hela lista (v3.4-klient) → 409 invoiced_locked', () => AW(ef, U.chef, { action: 'patch_ao', aoId: 'AO-F1', patch: { materials: ao('AO-F1').materials.map((m) => Object.assign(clone(m), { qty: 9 })) } }), { status: 409, error: 'invoiced_locked' });
    await NEJ('T3-B beslut 2: … och raden kan inte tas bort ur hela listan → 409 invoiced_locked', () => AW(ef, U.chef, { action: 'patch_ao', aoId: 'AO-F1', patch: { materials: [] } }), { status: 409, error: 'invoiced_locked' });
    x = await AW(ef, U.falt, { action: 'add_material', aoId: 'AO-F1', row: { name: 'Ny efter utkast', qty: 1 } });
    ok(x.status === 200, 'T3-B beslut 2: nya rader på klar AO med utkast tillåts (blir nya källor i kön, utkastet ändras inte)');
    const inv = val(db, 'vift_invoices').find((i) => i.id === f1.body.invoice.id);
    x = await IW(ef, U.ekonomi, { action: 'lineDelete', invoiceId: inv.id, lineId: 'L2', expectedRevision: inv.revision });
    const y = await AW(ef, U.chef, { action: 'update_material', aoId: 'AO-F1', rowId: 'AO-F1-M1', patch: { qty: 3 } });
    ok(x.status === 200 && y.status === 200, 'T3-B beslut 2: när raden tagits bort ur utkastet släpps anspråket och raden kan ändras igen');
    // Tid: fakturerad tidpost låst.
    const t1 = await IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'time:TE-R1', 'time', 'TE-R1', 'AO-A2', 650, 2)]) });
    ok(t1.status === 200, 'tidpost på löpande AO faktureras med serverpriset (650 kr)', t1.body);
    await NEJ('fakturerad (utkast) tidpost ändras inte → 409 invoiced_locked', () => AW(ef, U.falt, { action: 'patch_time', entryId: 'TE-R1', patch: { minutes: 30 } }), { status: 409, error: 'invoiced_locked' });
    await NEJ('fakturerad tidpost tas inte bort → 409 invoiced_locked', () => AW(ef, U.ekonomi, { action: 'delete_time', entryId: 'TE-R1' }), { status: 409, error: 'invoiced_locked' });
    await NEJ('fakturerad tidpost rättas inte via time_entry_correct → 409 invoiced_locked', () => AW(ef, U.ekonomi, { action: 'correct_time', entryId: 'TE-R1', entry: { minutes: 30 }, reason: 'Rättning efter fakturering' }), { status: 409, error: 'invoiced_locked' });
    // Utskick stoppas vid okänt pris (rad utan à-pris i ett manuellt utkast).
    const man = await IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: { title: 'Manuell', customerId: 'CU-R2', lines: [{ id: 'M1', description: 'Manuell utan pris', qty: 1, unit: 'st', vatRate: 25 }] } });
    await NEJ('SEC-B1-15 (R20): underlag med rad utan à-pris skickas inte → 409 price_unknown', () => IW(ef, U.ekonomi, { action: 'setStatus', invoiceId: man.body.invoice.id, status: 'skickad', expectedRevision: man.body.invoice.revision }), { status: 409, error: 'price_unknown' }, KSI);
    const u2 = await IW(ef, U.ekonomi, { action: 'lineUpdate', invoiceId: man.body.invoice.id, lineId: 'M1', patch: { unitPrice: 250 }, expectedRevision: man.body.invoice.revision });
    const s2 = await IW(ef, U.ekonomi, { action: 'setStatus', invoiceId: man.body.invoice.id, status: 'skickad', expectedRevision: u2.body.invoice.revision });
    ok(man.status === 200 && u2.status === 200 && s2.status === 200, 'R20: när ekonomi kompletterat priset kan underlaget skickas (flagga och komplettera)', [man.body, u2.body, s2.body]);
    aterstall();
  }

  // ════════════════ VK-1-arkitekturen: prisupplösning, gemensamt radformat, grupperad rad, delfakturering ════════════════
  {
    const ctx = (o) => Object.assign({ customerId: 'CU-R1', propertyId: 'PROP-R1', contractId: 'K-1', date: '2026-11-20' }, o || {});
    const pris = (typ, ref, c) => { const y = rpc(db, '_vift_t4b_pris', { p_typ: typ, p_ref: ref, p_ctx: c }); if (y.error) console.log('rpc-fel', y.error.message); return y.data; };
    psql(db, `insert into public.store(key, value) values ('vift_priceAgreements', ${jlit([
      { id: 'PA-K', active: true, scope: 'customer', scopeId: 'CU-R1', type: 'article', ref: 'ART-R1', unitPrice: 90 },
      { id: 'PA-F', active: true, scope: 'property', scopeId: 'PROP-R1', type: 'article', ref: 'ART-R1', unitPrice: 85, validFrom: '2026-11-01', validTo: '2026-11-30' },
      { id: 'PA-A', active: true, scope: 'contract', scopeId: 'K-1', type: 'article', ref: 'ART-R1', unitPrice: 80, vatRate: 12, validFrom: '2026-12-01' },
      { id: 'PA-S', active: true, scope: 'customer', scopeId: 'CU-R1', type: 'service', ref: 'SNOW-MASKIN', unitPrice: 1403, unit: 'tillfälle' },
      { id: 'PA-I', active: false, scope: 'contract', scopeId: 'K-1', type: 'priceGroup', ref: 'PG-1', unitPrice: 1 },
    ])}) on conflict (key) do update set value = excluded.value`);
    const p1 = pris('article', 'ART-R1', ctx({ customerId: 'CU-X', propertyId: 'PROP-X', contractId: '' }));
    const p2 = pris('article', 'ART-R1', ctx({ propertyId: 'PROP-X', contractId: '' }));
    const p3 = pris('article', 'ART-R1', ctx());
    const p4 = pris('article', 'ART-R1', ctx({ date: '2026-12-05' }));
    const p5 = pris('service', 'SNOW-MASKIN', ctx());
    const p6 = pris('service', 'SNOW-MASKIN', ctx({ customerId: 'CU-X' }));
    const p7 = pris('priceGroup', 'PG-1', ctx());
    ok(p1.unitPrice === 100 && p1.priceSource === 'general' && p2.unitPrice === 90 && p2.priceSource === 'customer' && p3.unitPrice === 85 && p3.priceSource === 'property'
      && p4.unitPrice === 80 && p4.priceSource === 'contract' && p4.vatRate === 12 && p5.unitPrice === 1403 && p5.unit === 'tillfälle' && p6.priceKnown === false && p6.unitPrice === null && p7.unitPrice === 650,
      'VK-1 (punkt 272): gemensam prisupplösning generell → kund → fastighet → avtal med giltighet per utförandedatum och momssats; tjänst utan överenskommelse = okänt pris (inte 0); inaktiv överenskommelse ignoreras', [p1, p2, p3, p4, p5, p6, p7]);
    const x = await AW(ef, U.falt, { action: 'add_material', aoId: 'AO-A1', row: { articleId: 'ART-R1', qty: 1, performedDate: '2026-11-20' } });
    const m = rad('AO-A1', x.body.row.id);
    ok(x.status === 200 && m.sellPrice === 85 && m.priceSource === 'property' && m.priceSourceId === 'PA-F', 'VK-1: materialvägen använder samma prisupplösning (fastighetspris 85 kr på utförandedatumet, källan spårbar på raden)', m);
    // Gemensamt radformat och framtida insatser (VK-1): registreringar läggs direkt i databasen (ingen skrivväg byggs nu).
    psql(db, `update public.store set value = (select jsonb_agg(case when e->>'id' = 'AO-A1' then e || ${jlit({ insatser: [
      { id: 'I-1', serviceId: 'SNOW-MASKIN', name: 'Maskinskottning', qty: 1, unit: 'tillfälle', unitPrice: 1403, vatRate: 25, performedDate: '2026-11-20', performedBy: F },
      { id: 'I-2', serviceId: 'SNOW-MASKIN', name: 'Maskinskottning', qty: 1, unit: 'tillfälle', unitPrice: 1403, vatRate: 25, performedDate: '2026-11-21', performedBy: F },
      { id: 'I-3', serviceId: 'SNOW-HAND', name: 'Handskottning', qty: 1, unit: 'tillfälle', unitPrice: 1250, vatRate: 25, performedDate: '2026-11-21', performedBy: F },
      { id: 'I-4', serviceId: 'SALT', name: 'Saltning', qty: 1, unit: 'tillfälle', unitPriceUnknown: true, vatRate: 25, performedDate: '2026-11-22' },
      { id: 'I-5', serviceId: 'SALT', name: 'Saltning', qty: 1, unit: 'tillfälle', unitPrice: 980, vatRate: 25 },
    ] })} else e end) from jsonb_array_elements(value) e) where key = 'vift_workOrders'`);
    const kr = rpc(db, '_vift_t4b_kallrad', { p_key: 'insats:AO-A1:I-1', p_wos: val(db, 'vift_workOrders'), p_tes: val(db, 'vift_timeEntries') }).data;
    const krT = rpc(db, '_vift_t4b_kallrad', { p_key: 'time:TE-R1', p_wos: val(db, 'vift_workOrders'), p_tes: val(db, 'vift_timeEntries') }).data;
    const krM = rpc(db, '_vift_t4b_kallrad', { p_key: 'material:AO-A1:' + m.id, p_wos: val(db, 'vift_workOrders'), p_tes: val(db, 'vift_timeEntries') }).data;
    const nycklar = (o) => Object.keys(o).sort().join(',');
    ok(kr && kr.unitPrice === 1403 && kr.unit === 'tillfälle' && kr.performedDate === '2026-11-20' && kr.billable === true && nycklar(kr) === nycklar(krT) && nycklar(kr) === nycklar(krM),
      'VK-1: gemensamt radformat per källrad (material, tid, insats) med enhet, à-pris, moms, utförandedatum och debiterbarhet', [kr, krT]);
    // Grupperad rad (per tjänst och period) med spårbarhet till varje registrering + delfakturering utan att AO:n avslutas.
    const grupp = { id: 'G1', description: 'Maskinskottning 20–21 nov', qty: 2, unit: 'tillfälle', unitPrice: 1403, vatRate: 25, source: 'Insats',
      sourceRefs: [{ sourceKey: 'insats:AO-A1:I-1', sourceType: 'insats', sourceId: 'I-1', workOrderId: 'AO-A1' }, { sourceKey: 'insats:AO-A1:I-2', sourceType: 'insats', sourceId: 'I-2', workOrderId: 'AO-A1' }] };
    const g = await IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([grupp]) });
    ok(g.status === 200 && ao('AO-A1').status === 'planerad', 'VK-1: grupperad fakturarad (två registreringar av samma insats) med spårbarhet till varje registrering; delfakturering utan att AO:n avslutas', g.body);
    await NEJ('VK-1: samma registrering kan inte faktureras två gånger (atomiskt anspråk per registrering) → 409 source_collision', () => IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'insats:AO-A1:I-2', 'insats', 'I-2', 'AO-A1', 1403)]) }), { status: 409, error: 'source_collision' });
    await NEJ('VK-1: grupperad rad med olika à-priser (1 403 och 1 250) → 409 price_mismatch', () => IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([Object.assign({}, grupp, { id: 'G2', sourceRefs: [{ sourceKey: 'insats:AO-A1:I-3', sourceType: 'insats', sourceId: 'I-3', workOrderId: 'AO-A1' }, { sourceKey: 'material:AO-A1:' + m.id, sourceType: 'material', sourceId: m.id, workOrderId: 'AO-A1' }] })]) }), { status: 409, error: 'price_mismatch' });
    await NEJ('VK-1: insats med okänt pris → 409 price_unknown', () => IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'insats:AO-A1:I-4', 'insats', 'I-4', 'AO-A1', 0)]) }), { status: 409, error: 'price_unknown' });
    await NEJ('VK-1: insats utan utförandedatum (obligatoriskt) → 409 performed_date_required', () => IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'insats:AO-A1:I-5', 'insats', 'I-5', 'AO-A1', 980)]) }), { status: 409, error: 'performed_date_required' });
    // Tid för intern uppföljning utan dubbeldebitering: i framtida insatsläge (unit) debiteras inte tiden.
    psql(db, `update public.store set value = (select jsonb_agg(case when e->>'id' = 'AO-A2' then e || '{"priceType":"insats"}'::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_workOrders'`);
    await NEJ('VK-1: tid på en AO i insatsläge är intern uppföljning (debiteras inte) → 409 source_not_billable', () => IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'time:TE-R1', 'time', 'TE-R1', 'AO-A2', 650, 2)]) }), { status: 409, error: 'source_not_billable' });
    const ws = rpc(db, 'work_order_material_add', { p_ao_id: 'AO-A1', p_row: { name: 'x', qty: 1 }, p_idempotency_key: 'x', p_caller_staff_id: '', p_caller_perms: ['all'] });
    ok(ws.error && /forbidden/.test(ws.error.message), 'RPC utan anroparens identitet → forbidden');
    const k = asUser(db, U.falt, `select public.work_order_material_add('AO-A1', '{"name":"x","qty":1}'::jsonb, 'rest', '${F}', array['all'])`);
    ok(!k.ok && k.code === '42501', 'SEC-REST-03 (R): authenticated får inte anropa material-RPC:erna direkt (42501)', k);
    const priv = q(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like '\\_vift\\_t4b\\_%' or p.proname in ('work_order_material_add','work_order_material_update','work_order_material_remove','time_entry_correct'))
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))`);
    ok(priv.length === 0, 'SEC-REST-03: T4-B:s funktioner körbara bara för service_role', priv);
    aterstall();
  }

  // ════════════════ Samtidighet ×20 (egna anslutningar; radlåset i RPC:n avgör) ════════════════
  {
    let fel = [];
    for (let i = 0; i < 20; i++) {
      const extra = rpc(db, 'work_order_material_add', { p_ao_id: 'AO-A1', p_row: { name: 'Chefens rad ' + i, qty: 1 }, p_idempotency_key: 'c-' + i, p_caller_staff_id: C, p_caller_perms: val(db, 'vift_roles').find((r) => r.id === 'chef').permissions });
      const rid = extra.data.row.id;
      const [a, b] = await Promise.all([
        rpcAsync(db, 'work_order_material_add', { p_ao_id: 'AO-A1', p_row: { name: 'FÄ rad ' + i, qty: 2 }, p_idempotency_key: 'f-' + i, p_caller_staff_id: F, p_caller_perms: ['ao_view_own', 'ao_material', 'ao_time'] }, { as: 'service_role' }),
        rpcAsync(db, 'work_order_material_remove', { p_ao_id: 'AO-A1', p_row_id: rid, p_expected_updated_at: null, p_idempotency_key: 'r-' + i, p_caller_staff_id: C, p_caller_perms: ['ao_edit', 'ao_view_all'] }, { as: 'service_role' }),
      ]);
      const mats = ao('AO-A1').materials;
      if (a.error || b.error || !mats.some((m) => m.id === a.data.row.id) || mats.some((m) => m.id === rid)) fel.push(i);
    }
    ok(fel.length === 0, 'SEC-B1-07 ×20 (P): FÄ lägger till samtidigt som AL tar bort en annan rad — båda ändringarna finns kvar, ingen rad försvinner tyst', fel);
    aterstall();
    fel = [];
    const fr = rpc(db, 'work_order_material_add', { p_ao_id: 'AO-A2', p_row: { name: 'Delad rad', qty: 1 }, p_idempotency_key: 'd-0', p_caller_staff_id: F, p_caller_perms: ['ao_view_own', 'ao_material'] }).data.row;
    let ver = fr.updatedAt;
    for (let i = 0; i < 20; i++) {
      const svar = await Promise.all([0, 1].map((k) => rpcAsync(db, 'work_order_material_update', { p_ao_id: 'AO-A2', p_row_id: fr.id, p_patch: { qty: 10 + k + i * 2 }, p_expected_updated_at: ver, p_idempotency_key: 'u-' + i + '-' + k, p_caller_staff_id: F, p_caller_perms: ['ao_view_own', 'ao_material'] }, { as: 'service_role' })));
      const vinn = svar.filter((s) => !s.error), forl = svar.filter((s) => s.error);
      if (vinn.length !== 1 || forl.length !== 1 || !/stale_write/.test(forl[0].error.message) || rad('AO-A2', fr.id).qty !== vinn[0].data.row.qty) fel.push(i);
      ver = rad('AO-A2', fr.id).updatedAt;
    }
    ok(fel.length === 0, 'radversion ×20 (P): två samtidiga ändringar av samma rad med samma expectedUpdatedAt — exakt en vinner, den andra får stale_write, inget skrivs över', fel);
    aterstall();
    fel = [];
    const chefP = val(db, 'vift_roles').find((r) => r.id === 'chef').permissions;
    for (let i = 0; i < 20; i++) {
      aterstall();
      const nyr = rpc(db, 'work_order_material_add', { p_ao_id: 'AO-A2', p_row: { articleId: 'ART-R1', qty: 1 }, p_idempotency_key: 'p-' + i, p_caller_staff_id: C, p_caller_perms: chefP }).data.row;
      const inv = fakt([lin('L1', 'material:AO-A2:' + nyr.id, 'material', nyr.id, 'AO-A2', 100)]);
      const [u, f] = await Promise.all([
        rpcAsync(db, 'work_order_material_update', { p_ao_id: 'AO-A2', p_row_id: nyr.id, p_patch: { sellPrice: 120 }, p_expected_updated_at: null, p_idempotency_key: 'pu-' + i, p_caller_staff_id: C, p_caller_perms: chefP }, { as: 'service_role' }),
        rpcAsync(db, 'invoice_append_checked', { p_invoice: inv, p_idempotency_key: iv() }, { as: 'service_role' }),
      ]);
      const ok1 = !u.error && f.error && /price_mismatch/.test(f.error.message) && rad('AO-A2', nyr.id).sellPrice === 120;
      const ok2 = u.error && /invoiced_locked/.test(u.error.message) && !f.error && rad('AO-A2', nyr.id).sellPrice === 100;
      if (!(ok1 || ok2)) fel.push(i + ':' + (u.error && u.error.message) + '/' + (f.error && f.error.message));
    }
    ok(fel.length === 0, 'T3-B beslut 2 ×20 (P): prisändring av en rad samtidigt som den tas in i ett fakturaunderlag — exakt en vinner (antingen nytt pris och faktura nekad price_mismatch, eller faktura med 100 kr och ändringen nekad invoiced_locked); utkastet blir aldrig inaktuellt', fel);
    aterstall();
    const svar = await parallellt(20, (i) => rpcAsync(db, 'work_order_material_add', { p_ao_id: 'AO-A2', p_row: { name: 'Parallell ' + i, qty: 1 }, p_idempotency_key: 'par-' + i, p_caller_staff_id: F, p_caller_perms: ['ao_view_own', 'ao_material'] }, { as: 'service_role' }));
    const namn = ao('AO-A2').materials.map((m) => m.name);
    ok(svar.every((s) => !s.error) && Array.from({ length: 20 }, (_, i) => 'Parallell ' + i).every((n) => namn.includes(n)), '20 samtidiga anslutningar lägger till rader på samma AO — alla 20 sparas (inget tappas)');
    aterstall();
    fel = [];
    for (let i = 0; i < 20; i++) {
      aterstall();
      const [t, k] = await Promise.all([
        rpcAsync(db, 'time_entry_correct', { p_entry_id: 'TE-K1', p_entry: { minutes: 61 + i }, p_reason: 'Samtidig rättning', p_idempotency_key: 'tc-' + i, p_expected_updated_at: T0, p_caller_staff_id: U.ekonomi.staffId, p_caller_perms: ['payroll_manage'] }, { as: 'service_role' }),
        rpcAsync(db, 'time_entry_correct', { p_entry_id: 'TE-K1', p_entry: { minutes: 99 }, p_reason: 'Samtidig rättning 2', p_idempotency_key: 'tc2-' + i, p_expected_updated_at: T0, p_caller_staff_id: U.ekonomi.staffId, p_caller_perms: ['payroll_manage'] }, { as: 'service_role' }),
      ]);
      const v = [t, k].filter((s) => !s.error);
      if (v.length !== 1 || te('TE-K1').corrections.length !== 1) fel.push(i);
    }
    ok(fel.length === 0, 'rättning ×20 (P): två samtidiga rättningar av samma tidpost med samma radversion — exakt en vinner, en revisionsrad', fel);
    aterstall();
  }

  // ════════════════ Gamla klienter (v3.4, T3, T4-A i Service Worker-cache) mot ny server ════════════════
  {
    // v3.4/T3/T4-A-fältklientens materialformulär: hela listan med "|| 0"-priser.
    await NEJ('gammal klient (fält): ny materialrad via hela listan med sellPrice 0 → 403 row_path_required, ingen 0-kronorsrad', () => AW(ef, U.falt, { action: 'patch_ao', aoId: 'AO-A2', patch: { materials: ao('AO-A2').materials.map((m) => { const c = clone(m); delete c.buyPrice; delete c.sellPrice; return c; }).concat([{ id: 'M' + Date.now(), name: 'Fritext', qty: 1, unit: 'st', buyPrice: 0, sellPrice: 0, vatRate: 25 }]) } }), { status: 403, error: 'forbidden', reason: 'row_path_required' });
    // Gammal klient skickar hourRate i create_time (TimeService: pg.hourRate eller 0).
    let x = await AW(ef, U.falt, { action: 'create_time', entry: { aoId: 'AO-A1', date: '2026-11-24', minutes: 60, priceGroupId: 'PG-1', priceGroupName: 'Fel namn', hourRate: 0 } });
    ok(x.status === 200 && te(x.body.timeEntry.id).hourRate === 650 && te(x.body.timeEntry.id).priceGroupName === 'Standard', 'gammal klient: klientens hourRate (0) och gruppnamn ignoreras — servern sätter 650 kr och namnet', x.body);
    // Gammal klients patch_time med hourRate från fältet.
    x = await AW(ef, U.falt, { action: 'patch_time', entryId: 'TE-R1', patch: { hourRate: 1, comment: 'ändrad' } });
    ok(x.status === 200 && te('TE-R1').hourRate === 650 && (x.body.ignoredFields || []).includes('hourRate'), 'gammal klient: fältets hourRate i patch_time ignoreras (historiskt pris oförändrat)');
    // Gammal faktureringskö: material med okänt pris (äldre klient räknar 0) → stoppas.
    await NEJ('gammal klient (ekonomi): fakturakö med 0-kronorsrad för okänt pris → 409 price_unknown', () => IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'material:AO-K1:AO-K1-M1', 'material', 'AO-K1-M1', 'AO-K1', 0)]) }), { status: 409, error: 'price_unknown' });
    // Gammal klient (v3.4) med fastpris + material (gammal regel "fastpris → fastprisrad + material").
    await NEJ('gammal klient: fastpris + fältmaterial (v3.4:s regel) → 409 included_in_fixed_price, ingen faktura', () => IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'fixed:AO-F1', 'fixed', 'AO-F1', 'AO-F1', 3000), lin('L2', 'material:AO-F1:AO-F1-M1', 'material', 'AO-F1-M1', 'AO-F1', 100, 2)]) }), { status: 409, error: 'included_in_fixed_price' });
    // Installationsfönstret: T4-A:s EF mot T4-B-databasen.
    const efGammal = await laddaEf(db, ['ao-time-write', 'time-entries-list'], { root: rotFore });
    x = await AW(efGammal, U.falt, { action: 'add_material', aoId: 'AO-A1', row: { name: 'x', qty: 1 } });
    const y = await AW(efGammal, U.falt, { action: 'patch_ao', aoId: 'AO-A1', patch: { materials: [] } });
    ok(x.status === 400 && x.body.error === 'unknown_action' && y.status === 403 && y.body.reason === 'row_path_required',
      'installationsfönstret (T4-A:s ao-time-write mot T4-B-databasen): add_material okänd (400 unknown_action), fältets hela lista nekas redan i RPC:n (403 row_path_required)', [x.body, y.body]);
    const t = await efGammal.anropa('time-entries-list', { user: U.falt });
    ok(t.status === 200 && t.body.timeEntries.some((e) => 'hourRate' in e), 'installationsfönstret: T4-A:s time-entries-list lämnar fortfarande ut timpris till fältet (projektionen ligger i EF:en) — fönstret ska vara minuter (installationsplanen)');
    aterstall();
  }

  // ════════════════ Affärsflöden ════════════════
  {
    const ekP = val(db, 'vift_roles').find((r) => r.id === 'ekonomi').permissions;
    // Offert → AO (arbetsledaren skapar AO med offertens materialrader och priser).
    let x = await AW(ef, U.chef, { action: 'create_ao', ao: { id: 'AO-OFF-1', title: 'Från offert', status: 'nytt', staff: [], customerId: 'CU-R1', propertyId: 'PROP-R1', offerId: 'OFF-R1', priceType: 'timpris', priceGroupId: 'PG-1',
      materials: [{ id: 'OM-1', articleId: 'ART-R1', name: 'Från offert', qty: 2, unit: 'st', sellPrice: 95, buyPrice: 50, vatRate: 25 }, { id: 'OM-2', name: 'Offertrad utan pris', qty: 1, unit: 'st', sellPrice: 0 }] } });
    const o1 = rad('AO-OFF-1', 'OM-1'), o2 = rad('AO-OFF-1', 'OM-2');
    ok(x.status === 200 && o1.sellPrice === 95 && o1.sellPriceUnknown === false && o2.sellPrice === null && o2.sellPriceUnknown === true, 'affärsflöde offert → AO: offertens avtalade materialpris följer med (arbetsledaren får sätta pris); en rad utan pris blir okänd, inte 0', [o1, o2]);
    x = await AW(ef, U.egenchef, { action: 'create_ao', ao: { id: 'AO-OFF-2', title: 'Utan prisrätt', status: 'nytt', staff: [], customerId: 'CU-R1', materials: [{ id: 'OM-3', name: 'Rad', qty: 1, unit: 'st', sellPrice: 95 }] } });
    ok(x.status === 200 && rad('AO-OFF-2', 'OM-3').sellPrice === null && (x.body.ignoredFields || []).includes('materials[].sellPrice'), 'create_ao: en roll utan prissättningsrätt kan inte sätta materialpris (okänt + ignoredFields)');
    // Fakturakö → underlag → status → backning (atomiska vägen, D-07/G9 bevaras).
    const inv = await IW(ef, U.ekonomi, { action: 'appendChecked', idempotencyKey: iv(), invoice: fakt([lin('L1', 'time:TE-R1', 'time', 'TE-R1', 'AO-A2', 650, 2), lin('L2', 'material:AO-A2:AO-A2-M1', 'material', 'AO-A2-M1', 'AO-A2', 100)], { workOrderIds: ['AO-A2'] }) });
    const b1 = await IW(ef, U.ekonomi, { action: 'aoBilling', aoId: 'AO-A2', mode: 'invoiced', invoiceId: inv.body.invoice.id });
    const s1 = await IW(ef, U.ekonomi, { action: 'setStatus', invoiceId: inv.body.invoice.id, status: 'skickad', expectedRevision: inv.body.invoice.revision });
    const s2 = await IW(ef, U.ekonomi, { action: 'setStatus', invoiceId: inv.body.invoice.id, status: 'makulerad', expectedRevision: s1.body.invoice.revision });
    const b2 = await IW(ef, U.ekonomi, { action: 'aoBilling', aoId: 'AO-A2', mode: 'restore' });
    ok(inv.status === 200 && b1.status === 200 && b1.body.workOrder.status === 'fakturerad' && s1.status === 200 && s2.status === 200 && b2.status === 200 && b2.body.workOrder.status === 'pågående',
      'affärsflöde fakturakö → underlag (tid + material med serverpris) → AO fakturerad → skickad → makulerad → AO backad (atomiska vägen, D-07/G9)', [inv.body, b1.body, s1.body, s2.body, b2.body]);
    x = await AW(ef, U.falt, { action: 'add_material', aoId: 'AO-A2', row: { name: 'Efter makulering', qty: 1 } });
    ok(x.status === 200, 'efter makulering och backning är AO:n och källraderna öppna igen');
    // Import (create_ao i bulk via admin) och återkommande ärenden (create_ao) fungerar som förut.
    x = await AW(ef, U.admin, { action: 'create_ao', ao: { id: 'AO-IMP-1', title: 'Importerad', status: 'nytt', staff: [], customerId: 'CU-R2', recurringOrderId: 'REC-R1', materials: [] } });
    ok(x.status === 200, 'affärsflöde import/återkommande: create_ao utan material oförändrat');
    // Stämpling in → ut på tilldelad pågående AO (tid med serverpris).
    const ts = Date.parse('2026-11-24T06:00:00.000Z');
    const si = await SK(ef, U.falt, { action: 'setStampStatus', active: true, ts, aoId: 'AO-A2', expectedRevision: 0 });
    x = await AW(ef, U.falt, { action: 'create_time', entry: { aoId: 'AO-A2', date: '2026-11-24', startStr: '07:00', endStr: '09:00', minutes: 120, startTs: ts, priceGroupId: 'PG-1' } });
    const so = await SK(ef, U.falt, { action: 'setStampStatus', active: false, ts: null, aoId: null, expectedRevision: 1 });
    ok(si.status === 200 && x.status === 200 && so.status === 200 && te(x.body.timeEntry.id).hourRate === 650, 'affärsflöde stämpling in → ut → tidpost med serverns timpris');
    // Checklista och klarmarkering.
    const c = await ef.anropa('work-order-checklist-resolve', { user: U.falt, body: { aoId: 'AO-A2', itemId: 'AO-A2-C1', action: 'done' } });
    const k = await AW(ef, U.falt, { action: 'patch_ao', aoId: 'AO-A2', patch: { status: 'klar' } });
    ok(c.status === 200 && k.status === 200, 'affärsflöde checklista och klarmarkering (fält) oförändrade', [c.body, k.body]);
    // Lönsamhet: ekonomi läser AO med inköps- och försäljningspris (TB), fältet inte.
    const we = await ef.anropa('work-orders-list', { user: U.ekonomi });
    const a2 = we.body.workOrders.find((a) => a.id === 'AO-A2');
    ok(a2.materials.some((m) => m.sellPrice === 100 && m.buyPrice === 50), 'affärsflöde lönsamhet: ekonomi (cost_view) ser försäljnings- och inköpspris för TB');
    void ekP;
    aterstall();
  }

  // ════════════════ Ingen oavsiktlig breddning: effektiv åtkomst före/efter per roll och STAGING-roll ════════════════
  {
    /* Profil (lib/t3e.js profil): läsningar (work-orders-list, time-entries-list, readAllWithHashes, REST)
       och 25 skrivande anrop, med T4-A-koden (före) och T4-B-koden (efter) på samma data. Efter T4-B ska
       varje skillnad vara en BESLUTAD skillnad: (a) avsmalning — försäljningspris/timpris borttagna för
       roller utan prisläsrätt, prisgrupper utan inaktiva; (b) fältets hela materiallista nekas
       (material_egen: 403 row_path_required); (c) time_view_all ger all tid utan lön (chef);
       (d) tid låst på klar AO (inga i profilen). Allt annat ska vara identiskt. */
    const BAS = ['admin', 'chef', 'ekonomi', 'falt', 'begransad', 'personalansvarig', 'adminhanterare', 'chef_utan_faktura', 'saljare', 'tom', 'egenchef', 'artikel', 'tidsans'];
    const utanPris = (v) => JSON.parse(v, (k, x) => (k === 'sellPrice' || k === 'hourRate' || k === 'description' ? undefined : x));
    const forklara = (anv, nyckel, fore, efter) => {
      if (nyckel === 'anrop:material_egen') return /^403\|forbidden\|row_path_required\|$/.test(efter) && /^(200\||403\|forbidden\|field_protected\|$)/.test(fore) ? 'b' : null;
      if (/^rest:vift_(articles|priceGroups)$/.test(nyckel)) return fore === '1' && efter === '0' ? 'a' : null;
      if (nyckel === 'tel' && ['chef', 'tidsans'].includes(anv)) return /^200 /.test(efter) && /^200 /.test(fore) ? 'c' : null;
      const fs2 = fore.replace(/^\d+ /, ''), es2 = efter.replace(/^\d+ /, '');
      try {
        const a = utanPris(fs2), b = utanPris(es2);
        if (nyckel === 'las:vift_priceGroups' && Array.isArray(a) && Array.isArray(b)) {
          const ids = b.map((g) => g.id);
          return a.filter((g) => ids.includes(g.id)).every((g) => JSON.stringify(Object.keys(b.find((y) => y.id === g.id)).filter((x) => !(x in g))) === '[]') ? 'a' : null;
        }
        return JSON.stringify(a) === JSON.stringify(b) ? 'a' : null;
      } catch (e) { return null; }
    };
    const oforkl = [];
    let jamforda = 0;
    for (const anv of BAS) {
      aterstall(); aterstallFore();
      const pe = await profil({ ef, db }, U[anv], { aoEgen: 'AO-A1', aoEgenPag: 'AO-A2' });
      const pf = await profil({ ef: efFore, db: rf.db }, Uf[anv], { aoEgen: 'AO-A1', aoEgenPag: 'AO-A2' });
      jamforda += Object.keys(pe).length;
      for (const k of jamforProfil(pf, pe)) if (!forklara(anv, k, pf[k], pe[k])) oforkl.push(anv + ' ' + k + ': ' + String(pf[k]).slice(0, 80) + ' → ' + String(pe[k]).slice(0, 80));
    }
    ok(oforkl.length === 0 && jamforda > 500, `ingen breddning (testplanen §4.5): för ${BAS.length} användare (standardroller och egna roller) och ${jamforda} nycklar/svar är varje skillnad mellan T4-A-koden (${FORE_COMMIT}) och T4-B en beslutad avsmalning (priser för roller utan prisläsrätt, inaktiva prisgrupper), fältets hela materiallista nekad eller time_view_all (chef, egen tidsroll)`, oforkl.slice(0, 8));
    // STAGING:s sju roller (läsande införandeanalys): ett provkonto byter roll i båda replikerna.
    const oforklS = []; const utfall = {};
    for (const roll of STAGING_ROLLER) {
      for (const [dbx, Ux] of [[db, U], [rf.db, Uf]]) {
        const rr = val(dbx, 'vift_roles').filter((x) => x.id !== roll.id).concat([roll]);
        psql(dbx, `update public.store set value = ${jlit(rr)} where key = 'vift_roles'; update public.store set value = (select jsonb_agg(case when e->>'id' = ${lit(Ux.falt.staffId)} then e || ${jlit({ role: roll.id })} else e end) from jsonb_array_elements(value) e) where key = 'vift_staff';`);
      }
      const pe = await profil({ ef, db }, U.falt, { aoEgen: 'AO-A1', aoEgenPag: 'AO-A2' });
      const pf = await profil({ ef: efFore, db: rf.db }, Uf.falt, { aoEgen: 'AO-A1', aoEgenPag: 'AO-A2' });
      const sk = jamforProfil(pf, pe);
      utfall[roll.id] = sk.length;
      for (const k of sk) if (!forklara(roll.id, k, pf[k], pe[k])) oforklS.push(roll.id + ' ' + k);
      aterstall(); aterstallFore();
    }
    ok(oforklS.length === 0, 'införandeanalys (läsande, ingen ändring i STAGING): för STAGING:s sju roller är varje skillnad efter T4-B beslutad (priser borttagna för e2e_falt/e2e_begransad/v7_sakerhetstest m.fl., fältets hela materiallista nekad); ingen roll får mer — antal skillnader per roll: ' + JSON.stringify(utfall), oforklS.slice(0, 8));
  }

  // ════════════════ Rollback (installera → rollback → installera), STOP och omvänd ordning ════════════════
  {
    const rb = byggReplik({ schemakontroll: false });
    laddaVarld(rb.db, rb.U);
    const KSR = { keys: ['vift_workOrders', 'vift_timeEntries', 'vift_invoices', 'vift_articles', 'vift_priceGroups', 'vift_roles', 'vift_staff', 'vift_notifications'], tables: ['app_users', 'op_idempotency'] };
    const efRb = await laddaEf(rb.db, ['ao-time-write']);
    let x = await AW(efRb, rb.U.falt, { action: 'add_material', aoId: 'AO-A1', row: { name: 'Rad före rollback', qty: 1 } });
    const y = await AW(efRb, rb.U.ekonomi, { action: 'correct_time', entry: { aoId: 'AO-K1', staffId: rb.U.falt.staffId, date: '2026-11-22', minutes: 30 }, reason: 'Före rollback' });
    ok(x.status === 200 && y.status === 200, 'T4-B-koden skapar data (materialrad med okänt pris, rättad tidpost)');
    const fore = ksTa(rb.db, KSR);
    const jamfor = (env) => { try { return execFileSync('node', [path.join(__dirname, 'local', 'jamfor-schema.js'), rb.db], { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) }); } catch (e) { return String(e.stdout || ''); } };
    const ofo = (t) => Number((/(\d+) oförklarade/.exec(t) || [])[1]);
    psqlFile(rb.db, path.join(serverRot(), 'rollback', 'T4-B', 'rollback_t4b.sql'));
    let ut = jamfor({ T4_LAGE: 'T4-A-notiser' });
    ok(ofo(ut) === 0 && /OBS: T4-ändringar som inte syns.*work_order_material_add/.test(ut), 'rollback T4-B: schemat = läget efter T4-A + notisdelen (T4_LAGE=T4-A-notiser, 0 oförklarade; T4-B:s funktioner borta)', ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
    ok(ksDiff(fore, ksTa(rb.db, KSR)).length === 0, 'rollback T4-B: INGEN data ändrad (rader och tidposter skapade efter installationen ligger kvar)');
    ok(oforkl0(jamfor({})) > 0, 'utan T4_LAGE godtas inte läget före T4-B (jämförelsen är strikt)');
    const efT4a = await laddaEf(rb.db, ['ao-time-write'], { root: rotFore });
    x = await AW(efT4a, rb.U.falt, { action: 'patch_ao', aoId: 'AO-A1', patch: { materials: ao('AO-A1', rb.db).materials.map((m) => { const c = clone(m); delete c.buyPrice; return c; }) } });
    ok(x.status === 200, 'efter rollback fungerar T4-A-klientens väg (fältets hela lista) på data skapad av T4-B (nya fält och null-priser godtas)', x.body);
    let fel = null;
    try { psqlFile(rb.db, path.join(serverRot(), T4B_MIG)); } catch (e) { fel = e.message; }
    ut = jamfor();
    ok(!fel && ofo(ut) === 0 && !/OBS: T4-ändringar som inte syns/.test(ut), 'ny installation efter rollback: STOP-kontrollen godtar T4-A-notisversionerna; schemat = alla registrerade ändringar', fel || ut.split('\n').filter((l) => /OFÖRKLARAD|OBS/.test(l)).slice(0, 5));
    let stop = null;
    try { psqlFile(rb.db, path.join(serverRot(), T4B_MIG)); } catch (e) { stop = e.message; }
    ok(stop && /T4-B STOP: _vift_t4b_pris_las finns redan/.test(stop), 'STOP-kontroll: en andra körning av 20261128000011 avbryts', stop);
    const fore2 = ksTa(rb.db, KSR);
    for (const p of ['T4-B/rollback_t4b.sql', 'T4-A-notiser/rollback_t4a_notiser.sql', 'T4-A/rollback_t4a.sql', 'T3-E/rollback_t3e.sql', 'T3-D/rollback_t3d.sql', 'T3-C/rollback_t3c.sql', 'T3-B/rollback_t3b.sql']) psqlFile(rb.db, path.join(serverRot(), 'rollback', p));
    ut = jamfor({ T3_IGNORERA: '1' });
    ok(ofo(ut) === 0, 'rollback T4-B + notiser + T4-A + T3-E + T3-D + T3-C + T3-B (omvänd installationsordning): schemat = STAGING-facit', ut.split('\n').filter((l) => /OFÖRKLARAD/.test(l)).slice(0, 5));
    ok(ksDiff(fore2, ksTa(rb.db, KSR)).length === 0, 'rollback hela vägen: ingen data ändrad');
    rb.stang();
    // STOP: T4-B-migrationen på en kedja utan notisdelen, och med en ändrad funktion.
    const rs = byggReplik({ utelamna: ['migrations/20261128000010_t4a_notiser.sql', T4B_MIG], data: false, schemakontroll: false });
    stop = null;
    try { psqlFile(rs.db, path.join(serverRot(), T4B_MIG)); } catch (e) { stop = e.message; }
    ok(stop && /T4-B STOP: T4-A \(20261128000009\) och notisdelen \(20261128000010\) måste vara installerade först/.test(stop), 'STOP-kontroll: T4-B utan notisdelen avbryts', stop);
    rs.stang();
    const rd = byggReplik({ utelamna: [T4B_MIG], data: false, schemakontroll: false });
    psql(rd.db, `create or replace function public._vift_ej_verkstallda() returns text[] language sql immutable set search_path = public as $$ select array['drift'] $$;`);
    stop = null;
    try { psqlFile(rd.db, path.join(serverRot(), T4B_MIG)); } catch (e) { stop = e.message; }
    ok(stop && /T4-B STOP: public\._vift_ej_verkstallda\(\) avviker/.test(stop), 'STOP-kontroll: en ersatt funktion som avviker från föregående version (drift) avbryter installationen', stop);
    rd.stang();
  }

  r.stang(); rf.stang();
  avsluta();
})().catch((e) => { console.error(e); process.exit(1); });

function oforkl0(t) { return Number((/(\d+) oförklarade/.exec(t) || [])[1]); }
