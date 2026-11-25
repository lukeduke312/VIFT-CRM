'use strict';
/*
 * T3-E (2026-11-28): gemensamma verktyg för standardrollerna (testgruppen `standard_roles`,
 * installationsskriptet och införandeplanen).
 *
 *   STAGING_ROLLER        rollregistret i STAGING (läst med SELECT 2026-11-28, bara id och
 *                         behörigheter; etiketterna här är påhittade)
 *   STAGING_ANTAL         aktiv personal per roll-id i STAGING (läst 2026-11-28, bara antal)
 *   standard()            standardroller.json (definitionen som skripten installerar)
 *   korSkript(db, fil, installningar)   kör ett manuellt skript med platshållarna ersatta
 *   rollHash(db)          rollregistrets hash (samma som store-key-write readWithHash)
 *   nyttKonto(db, U, {alias, staffId, role, ...})   syntetiskt konto (auth.users, app_users, vift_staff)
 *   satsRoll(db, id, perms)                        ändrar/lägger till en roll direkt (bara lokalt)
 *   profil(ctx, user)     effektiv åtkomst för en användare: läsningar (EF, REST) och utfallet
 *                         av en uppsättning skrivande anrop (status, error, reason, ändrade
 *                         resurser), varje anrop följt av återställning.
 *   jamforProfil(a, b)    nycklar där profilerna skiljer sig.
 * Allt är lokalt (replik); inget körs mot Supabase.
 */
const fs = require('fs');
const path = require('path');
const { psql, psqlFile, lit, jlit, val, asUser } = require('./db');
const { ksDiff } = require('./kontroll');
/* Kontrollsumma i ett enda anrop (samma innehåll som kontroll.ksTa: md5 + updated_at per nyckel,
   antal + md5 per tabell) — profilerna gör hundratals anrop. */
function ksTa(db, spec) {
  const keys = ['vift_lastChanged'].concat(spec.keys || []);
  const delar = keys.map((k) => `select 'store:' || ${lit(k)}, coalesce((select md5(value::text) || ':' || coalesce(updated_at::text, '-') from public.store where key = ${lit(k)}), 'saknas')`)
    .concat((spec.tables || []).map((t) => `select 'tabell:' || ${lit(t)}, (select count(*) || ':' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') from ${t} x)`));
  const out = {};
  psql(db, delar.join(' union all ')).split('\n').filter(Boolean).forEach((r) => { const i = r.indexOf('|'); out[r.slice(0, i)] = r.slice(i + 1); });
  return out;
}

const ROT = path.resolve(__dirname, '..', '..', '..', 'supabase');
const SKRIPT = path.join(ROT, 'manual', 't3e_standardroller');
const standard = () => JSON.parse(fs.readFileSync(path.join(SKRIPT, 'standardroller.json'), 'utf8'));

const STAGING_ROLLER = [
  { id: 'admin', label: 'Admin', isBuiltin: true, active: true, permissions: ['all'] },
  { id: 'e2e_arbetsledare', label: 'E2E arbetsledare', isBuiltin: false, active: true, permissions: ['ao_checklist', 'ao_complete', 'ao_create', 'ao_edit', 'ao_material', 'ao_time', 'ao_view_all', 'customer_manage', 'dashboard_view', 'offer_manage', 'sales_manage', 'staff_view'] },
  { id: 'e2e_begransad', label: 'E2E begränsad', isBuiltin: false, active: true, permissions: ['ao_view_own', 'dashboard_view'] },
  { id: 'e2e_ekonomi', label: 'E2E ekonomi', isBuiltin: false, active: true, permissions: ['ao_view_all', 'dashboard_view', 'invoice_create', 'invoice_view', 'reports_view'] },
  { id: 'e2e_falt', label: 'E2E fält', isBuiltin: false, active: true, permissions: ['ao_checklist', 'ao_complete', 'ao_material', 'ao_time', 'ao_view_own', 'dashboard_view'] },
  { id: 'qa_p2_avgransad', label: 'QA avgränsad', isBuiltin: false, active: true, permissions: ['customer_manage', 'invoice_create', 'offer_manage'] },
  { id: 'v7_sakerhetstest', label: 'V7 säkerhetstest', isBuiltin: false, active: true, permissions: ['ao_complete', 'ao_time', 'ao_view_own', 'customer_view', 'dashboard_view', 'invoice_view'] },
];
const STAGING_ANTAL = { admin: 2, e2e_arbetsledare: 1, e2e_begransad: 1, e2e_ekonomi: 1, e2e_falt: 2, qa_p2_avgransad: 1, v7_sakerhetstest: 1 };

const rollHash = (db) => psql(db, `select encode(sha256(convert_to(value::text, 'UTF8')), 'hex') from public.store where key = 'vift_roles'`);
const journal = (db) => {
  try { return JSON.parse(psql(db, `select coalesce(json_agg(j order by id), '[]')::text from vift_t3e_journal.rollregister j`) || '[]'); } catch (e) { return []; }
};

/* Kör ett manuellt skript: platshållarna i set_config-raderna ersätts. Returnerar
   { ok, fel, notiser } (notiser = RAISE NOTICE-rader). */
function korSkript(db, fil, inst) {
  let sql = fs.readFileSync(path.join(SKRIPT, fil), 'utf8');
  for (const [k, v] of Object.entries(inst || {})) {
    const re = new RegExp(`set_config\\('vift\\.${k}', '[^']*', false\\)`);
    if (!re.test(sql)) throw new Error('platshållaren för ' + k + ' saknas i ' + fil);
    sql = sql.replace(re, `set_config('vift.${k}', ${lit(v)}, false)`);
  }
  const { execFileSync } = require('child_process');
  try {
    const ut = execFileSync('psql', ['-d', db, '-qAt', '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, fel: null, ut, notiser: [] };
  } catch (e) {
    const s = String(e.stderr || e.message);
    return { ok: false, fel: (/ERROR:\s+([^\n]*)/.exec(s) || [])[1] || s, ut: String(e.stdout || '') };
  }
}
/* Som korSkript men returnerar även NOTICE-raderna (stderr) vid lyckad körning. */
function korSkriptN(db, fil, inst) {
  let sql = fs.readFileSync(path.join(SKRIPT, fil), 'utf8');
  for (const [k, v] of Object.entries(inst || {})) sql = sql.replace(new RegExp(`set_config\\('vift\\.${k}', '[^']*', false\\)`), `set_config('vift.${k}', ${lit(v)}, false)`);
  const { spawnSync } = require('child_process');
  const p = spawnSync('psql', ['-d', db, '-qAt', '-X', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  const notiser = String(p.stderr || '').split('\n').filter((l) => /NOTICE:/.test(l)).map((l) => l.replace(/^.*NOTICE:\s*/, ''));
  const fel = p.status === 0 ? null : ((/ERROR:\s+([^\n]*)/.exec(p.stderr || '') || [])[1] || p.stderr);
  return { ok: p.status === 0, fel, ut: p.stdout, notiser };
}

function nyttKonto(db, U, k) {
  const u = Object.assign({ firstName: 'Test', lastName: k.alias, email: k.alias + '@example.test', active: true }, k);
  const sql = ['begin;', `insert into auth.users(id, email) values (${lit(u.authId)}, ${lit(u.email)}) on conflict do nothing;`,
    `insert into public.app_users(user_id, staff_id, role_id, active, is_admin) values (${lit(u.authId)}, ${lit(u.staffId)}, ${lit(u.role)}, true, false) on conflict do nothing;`,
    `update public.store set value = value || ${jlit([{ id: u.staffId, firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, active: u.active, title: 'Titel ' + u.staffId, phone: '070-000 01 ' + u.staffId.slice(-2), hourlyRate: 650 }])} where key = 'vift_staff';`, 'commit;'];
  psql(db, sql.join('\n'));
  U[u.alias] = u;
  return u;
}
function satsRoll(db, id, perms, extra) {
  const roller = val(db, 'vift_roles').filter((r) => r.id !== id).concat([Object.assign({ id, label: 'Egen ' + id, isBuiltin: false, active: true, permissions: perms }, extra || {})]);
  psql(db, `update public.store set value = ${jlit(roller)} where key = 'vift_roles';`);
}

/* ── Effektiv åtkomst ───────────────────────────────────────── */
const LAS = ['vift_workOrders', 'vift_timeEntries', 'vift_activities', 'vift_activityLog', 'vift_offers', 'vift_customers', 'vift_properties', 'vift_propertyObjects',
  'vift_propertyContacts', 'vift_staff', 'vift_roles', 'vift_invoices', 'vift_settings', 'vift_recurringOrders', 'vift_salesOpps', 'vift_contracts', 'vift_articles',
  'vift_offerEvents', 'vift_offerAttachments', 'vift_notifications', 'vift_inspections', 'vift_ronderingar', 'vift_avvikelser', 'vift_projects', 'vift_priceGroups'];
const kanon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x);
const KS = { keys: ['vift_workOrders', 'vift_timeEntries', 'vift_invoices', 'vift_customers', 'vift_activities', 'vift_activityLog', 'vift_roles', 'vift_staff', 'vift_settings', 'vift_articles'],
  tables: ['op_idempotency', 'stamp_status', 'sensitive_access_audit', 'app_users'] };

/* Ögonblicksbild för återställning efter varje skrivande anrop. */
function snapshot(db) {
  psql(db, `drop table if exists public._t3e_bas, public._t3e_idem, public._t3e_audit;
    create table public._t3e_bas as select * from public.store; create table public._t3e_idem as select * from public.op_idempotency;
    create table public._t3e_audit as select * from public.sensitive_access_audit;`);
}
function aterstall(db) {
  psql(db, `begin; delete from public.store; insert into public.store select * from public._t3e_bas; delete from public.op_idempotency; insert into public.op_idempotency select * from public._t3e_idem;
    delete from public.stamp_status; delete from public.sensitive_access_audit; insert into public.sensitive_access_audit select * from public._t3e_audit; commit;`);
}

let _n = 0;
const nyckel = () => 't3e-' + (++_n) + '-' + Math.random().toString(36).slice(2, 8);
/* Skrivande anrop (alla mot syntetiska poster). aoEgen = en AO där användaren är tilldelad. */
function anrop(ef, db, user, o) {
  const AW = (body) => ef.anropa('ao-time-write', { user, body: Object.assign({ idempotencyKey: nyckel() }, body) });
  const SK = (body) => ef.anropa('store-key-write', { user, body });
  const ao = (id) => (val(db, 'vift_workOrders') || []).find((a) => a.id === id) || {};
  const el = (k, id) => (val(db, k) || []).find((x) => x.id === id);
  const egen = o.aoEgen, pag = o.aoEgenPag;
  return {
    ta_pool: () => AW({ action: 'take_from_pool', aoId: 'AO-P1' }),
    starta_egen: () => AW({ action: 'patch_ao', aoId: egen, patch: { status: 'pågående' } }),
    klar_egen: () => AW({ action: 'patch_ao', aoId: pag, patch: { status: 'klar' } }),
    klar_annans: () => AW({ action: 'patch_ao', aoId: 'AO-A8', patch: { status: 'klar' } }),
    redigera_ao: () => AW({ action: 'patch_ao', aoId: egen, patch: { title: 'T3-E ändrad titel' } }),
    material_egen: () => AW({ action: 'patch_ao', aoId: egen, patch: { materials: (ao(egen).materials || []).concat([{ id: 'M-T3E', name: 'Fritext T3-E', qty: 1, unit: 'st' }]) } }),
    radera_ao: () => AW({ action: 'delete_ao', aoId: 'AO-N2' }),
    skapa_ao: () => AW({ action: 'create_ao', workOrder: { id: 'AO-T3E-NY', title: 'Ny T3-E', status: 'nytt', staff: [], customerId: 'CU-R1' } }),
    tid_egen: () => AW({ action: 'create_time', entry: { id: 'TE-T3E', aoId: egen, date: '2026-11-24', minutes: 60 } }),
    tid_pool: () => AW({ action: 'create_time', entry: { id: 'TE-T3E2', aoId: 'AO-P1', date: '2026-11-24', minutes: 60 } }),
    attest: () => AW({ action: 'attest_time', entryId: 'TE-R2', attested: true }),
    stampla_egen: () => SK({ action: 'setStampStatus', active: true, ts: Date.parse('2026-11-24T08:00:00.000Z'), aoId: egen, expectedRevision: 0 }),
    checklista_egen: () => ef.anropa('work-order-checklist-resolve', { user, body: { aoId: egen, itemId: egen + '-C1', action: 'done' } }),
    logg_egen: () => ef.anropa('work-order-log-write', { user, body: { action: 'append_log', aoId: egen, entry: { id: 'L-T3E', type: 'note', text: 'anteckning' } } }),
    kund_andra: () => { const c = el('vift_customers', 'CU-R2') || { id: 'CU-R2' }; return SK({ action: 'writeMerge', key: 'vift_customers', upserts: [{ id: 'CU-R2', previous: c, data: Object.assign({}, c, { name: 'T3-E ändrad' }) }], removals: [] }); },
    artikel_inkopspris: () => { const a = el('vift_articles', 'ART-R1') || { id: 'ART-R1' }; return SK({ action: 'writeMerge', key: 'vift_articles', upserts: [{ id: 'ART-R1', previous: a, data: Object.assign({}, a, { buyPrice: 51 }) }], removals: [] }); },
    installning_bankgiro: () => SK({ action: 'write', key: 'vift_settings', value: Object.assign({}, val(db, 'vift_settings'), { bankgiro: '999-9999' }), expectedHash: psql(db, `select encode(sha256(convert_to(value::text, 'UTF8')), 'hex') from public.store where key = 'vift_settings'`) }),
    faktura_rad: () => ef.anropa('invoice-write', { user, body: { action: 'lineAdd', invoiceId: 'INV-R2', expectedRevision: 0, line: { id: 'L-T3E', description: 'x', qty: 1, unitPrice: 1, vatRate: 25 } } }),
    uppgift_egen: () => SK({ action: 'writeMerge', key: 'vift_activities', upserts: [{ id: 'TASK-T3E-' + user.staffId, previous: null, data: { id: 'TASK-T3E-' + user.staffId, title: 'Egen', type: 'todo', status: 'open', assignedTo: user.staffId, createdBy: user.staffId, createdAt: '2026-11-24T08:00:00.000Z' } }], removals: [] }),
    uppgift_annans: () => { const t = el('vift_activities', 'TASK-R3') || { id: 'TASK-R3' }; return SK({ action: 'writeMerge', key: 'vift_activities', upserts: [{ id: 'TASK-R3', previous: t, data: Object.assign({}, t, { title: 'T3-E' }) }], removals: [] }); },
    handelse_egen: () => SK({ action: 'appendActivity', entry: { id: 'ACT-T3E-000001', type: 'work_order_status', description: 'x', workOrderId: egen } }),
    portkod_objekt: () => ef.anropa('get-sensitive-fields', { user, body: { objectId: 'OBJ-R1' } }),
    roll_ny: () => { const r = val(db, 'vift_roles'); return SK({ action: 'writeMerge', key: 'vift_roles', upserts: [{ id: 'roll_t3e', previous: null, data: { id: 'roll_t3e', label: 'x', active: true, permissions: ['dashboard_view'] } }], removals: [] }); },
  };
}
const ANROP_NAMN = Object.keys(anrop({ anropa: () => null }, null, {}, {}));

/* Profil = vad användaren faktiskt når. Läsningar jämförs som kanoniskt JSON (utan hash och
   tidsstämpel för vift_lastChanged); rollregistret som "ALLA" eller listan av synliga id
   (egna rollens innehåll ändras av själva planstegen och är inte åtkomst). */
async function profil(ctx, user, o) {
  const { ef, db } = ctx;
  o = Object.assign({ aoEgen: 'AO-A1', aoEgenPag: 'AO-A2', anrop: true }, o || {});
  const P = {};
  const wol = await ef.anropa('work-orders-list', { user });
  P.wol = wol.status + ' ' + kanon(wol.body && wol.body.workOrders);
  const tel = await ef.anropa('time-entries-list', { user });
  P.tel = tel.status + ' ' + kanon(tel.body && (tel.body.entries || tel.body.timeEntries || tel.body));
  const ra = await ef.anropa('store-key-write', { user, body: { action: 'readAllWithHashes', keys: LAS } });
  P.ra_status = String(ra.status) + ' ' + (ra.body && ra.body.error || '');
  const data = (ra.body && ra.body.data) || {};
  const allaRoller = (val(db, 'vift_roles') || []).map((r) => r.id).sort().join(',');
  for (const k of LAS) {
    const kk = k.slice(5);
    if (k === 'vift_roles') {
      const ids = (data[kk] || []).map((r) => r.id).sort().join(',');
      P['las:' + k] = ids === allaRoller ? 'ALLA' : ids;
    } else P['las:' + k] = kanon(data[kk] === undefined ? null : data[kk]);
  }
  // En rad (json_agg delar flera rader på flera textrader, som parseAsUser inte läser).
  const rx = asUser(db, user, `select coalesce(string_agg(key, ','), '') as k from public.store where key = any(array[${LAS.map(lit).join(',')}])`);
  const synliga = rx.ok ? String((rx.rows[0] || {}).k || '').split(',') : null;
  for (const k of LAS) P['rest:' + k] = synliga ? String(synliga.filter((y) => y === k).length) : 'fel ' + rx.code;
  if (o.anrop) {
    snapshot(db); // återställningen efter varje anrop går till exakt läget före profilen
    const A = anrop(ef, db, user, o);
    for (const namn of (o.urval || ANROP_NAMN)) {
      const fore = ksTa(db, KS);
      const s = await A[namn]();
      const andrat = ksDiff(fore, ksTa(db, KS)).filter((x) => x !== 'store:vift_lastChanged').sort();
      const b = (s && s.body) || {};
      P['anrop:' + namn] = [s.status, b.error || '', b.reason || '', andrat.join('+')].join('|');
      aterstall(db);
    }
  }
  return P;
}
const jamforProfil = (a, b) => Object.keys(Object.assign({}, a, b)).filter((k) => a[k] !== b[k]);

module.exports = { STAGING_ROLLER, STAGING_ANTAL, standard, korSkript, korSkriptN, rollHash, journal, nyttKonto, satsRoll, snapshot, aterstall, profil, jamforProfil, ANROP_NAMN, LAS, KS, kanon, SKRIPT };
