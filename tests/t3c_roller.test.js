'use strict';
/*
 * T3-C (2026-11-28): roller och superadmin (SÄK-8, D-25, D-21, D-14) och direkt REST-skrivning
 * (F18 / SÄK-13). GODKÄNDA SÄKERHETSTESTER efter rättning. Vänder baslinjefynden SÄK-8 och
 * SÄK-13 (tests/baslinje_sakerhet.test.js, som körs mot den historiska källan fb71f26).
 * Testgruppen `roles_superadmin` (SAKERHETSPROVNING-TESTPLAN §3.3): SEC-ROLL-01–09,
 * SEC-B3-01/02/03/05/06, SEC-REST-01–04, SEC-CUST-18/19/22/23 och egna roller (D-26).
 *
 * Mot den lokala STAGING-replikan med HELA repokedjan (inklusive 20261128000004–05) och den
 * ändrade store-key-write körd i Node. Varje negativt fall kontrollerar exakt status, error
 * och reason (BEHORIGHETSMATRIS §4) OCH oförändrad kontrollsumma för vift_staff, vift_roles
 * och tabellen app_users. Samtidighet (SEC-ROLL-05/06) med egna anslutningar, 50 upprepningar.
 *
 * Bara lokalt (rollregistret är destruktivt). Lokalt verifierat; inget är prövat i STAGING.
 */
const crypto = require('crypto');
const { ok, krav, avsluta } = require('./local/lib/test');
krav({ tsc: true });
const { byggReplik } = require('./local/lib/replik');
const { laddaEf } = require('./local/lib/ef');
const { val, q, psql, psqlAsync, rpc, rpcAsync, lit, jlit, asUser, asUserAsync } = require('./local/lib/db');
const { expectReject, expectAccept, ksTa, ksDiff } = require('./local/lib/kontroll');

const KS = { keys: ['vift_staff', 'vift_roles'], tables: ['app_users'] };
const EF = ['store-key-write', 'work-orders-list', 'time-entries-list', 'ao-time-write', 'invoice-write'];
const clone = (v) => JSON.parse(JSON.stringify(v));

(async () => {
  const r = byggReplik({});
  const { db, U } = r;
  ok(r.steg.some((s) => s.rel.includes('20261128000004')) && r.steg.some((s) => s.rel.includes('20261128000005')), 'kedjan innehåller T3-C-migrationerna 20261128000004–05');
  ok(r.rapport.oforklarade === 0, `schemajämförelse: 0 oförklarade (T3-C-objekten förklarade via t3-andringar.json): ${r.rapport.identiska} identiska, ${r.rapport.forklarade} förklarade`);

  // ── Extra testdata ────────────────────────────────────────────────────
  // ADM2 med EGEN superadminroll (annat id än 'admin', SEC-ROLL-08) och egna roller (D-26).
  const roller0 = val(db, 'vift_roles');
  const chefPerms = roller0.find((x) => x.id === 'chef').permissions;
  const extraRoller = [
    { id: 'superadmin2', label: 'Egen superadmin (annat id)', permissions: ['all'] },
    { id: 'chef_personal', label: 'Arbetsledare + staff_manage (egen)', permissions: chefPerms.concat(['staff_manage']) },
    { id: 'chef_utan_staffview', label: 'chef − staff_view (egen)', permissions: chefPerms.filter((p) => p !== 'staff_view') },
  ].map((x) => Object.assign({ isBuiltin: false, active: true }, x));
  const nyaAnv = [['admin2', 'ST-R31', 'superadmin2'], ['chefpersonal', 'ST-R32', 'chef_personal'], ['chefutanstaffview', 'ST-R33', 'chef_utan_staffview']]
    .map(([alias, staffId, role], i) => ({ alias, staffId, role, email: alias + '@example.test', authId: '00000000-0000-4000-8000-0000000003' + String(i + 1).padStart(2, '0'), firstName: 'Test', lastName: alias }));
  const sqlU = ['begin;'];
  for (const u of nyaAnv) {
    U[u.alias] = u;
    sqlU.push(`insert into auth.users(id, email) values (${lit(u.authId)}, ${lit(u.email)});`);
    sqlU.push(`insert into public.app_users(user_id, staff_id, role_id, active, is_admin) values (${lit(u.authId)}, ${lit(u.staffId)}, ${lit(u.role)}, true, ${u.role === 'superadmin2'});`);
  }
  // Ett äldre fält 'permissions' i personalposterna (finns i verkliga data) för projektionstesterna.
  const staff0 = val(db, 'vift_staff').map((s) => Object.assign({}, s, { permissions: s.role === 'admin' ? ['all'] : [] }))
    .concat(nyaAnv.map((u) => ({ id: u.staffId, firstName: u.firstName, lastName: u.lastName, email: u.email, role: u.role, active: true, title: 'Testtitel', phone: '070-000 00 99', permissions: [] })));
  sqlU.push(`update public.store set value = ${jlit(staff0)} where key = 'vift_staff';`);
  sqlU.push(`update public.store set value = ${jlit(roller0.concat(extraRoller))} where key = 'vift_roles';`);
  sqlU.push('commit;');
  psql(db, sqlU.join('\n'));
  psql(db, `create table public._t3c_bas as select * from public.store; create table public._t3c_app as select * from public.app_users;`);
  const aterstall = () => psql(db, `begin; delete from public.store; insert into public.store select * from public._t3c_bas;
    update public.app_users a set active = b.active, disabled_at = b.disabled_at, is_admin = b.is_admin, staff_id = b.staff_id, role_id = b.role_id from public._t3c_app b where a.user_id = b.user_id; commit;`);
  const ef = await laddaEf(db, EF);

  const staff = () => val(db, 'vift_staff');
  const roles = () => val(db, 'vift_roles');
  const st = (id) => staff().find((x) => x.id === id);
  const ro = (id) => roles().find((x) => x.id === id);
  const antalSuper = () => Number(psql(db, `select public._vift_superadmin_count((select value from store where key='vift_staff'), (select value from store where key='vift_roles'))`));
  const hashAv = (key) => psql(db, `select encode(sha256(convert_to(value::text, 'UTF8')), 'hex') from public.store where key = ${lit(key)}`);
  /* writeMerge som klienten gör: previous = elementet som servern har just nu. */
  const MW = (user, key, upd, rem) => {
    const cur = val(db, key) || [];
    const upserts = (upd || []).map((d) => ({ id: d.id, data: d, previous: cur.find((e) => e.id === d.id) || null }));
    const removals = (rem || []).map((id) => ({ id, previous: cur.find((e) => e.id === id) }));
    return ef.anropa('store-key-write', { user, body: { action: 'writeMerge', key, upserts, removals } });
  };
  const W = (user, key, value) => ef.anropa('store-key-write', { user, body: { action: 'write', key, value, expectedHash: hashAv(key) } });
  const med = (el, patch) => Object.assign(clone(el), patch);
  const roll = (id, perms) => med(ro(id), { permissions: perms });
  const NEJ = async (namn, anrop, forv, ks) => { const x = await expectReject(db, anrop, forv, ks || KS); ok(x.ok, namn, x.fel.concat([JSON.stringify(x.svar.body).slice(0, 300)])); return x; };
  const JA = async (namn, anrop, skaAndras, ks) => { const x = await expectAccept(db, anrop, { status: 200 }, ks || KS, skaAndras); ok(x.ok, namn, x.fel.concat([JSON.stringify(x.svar.body).slice(0, 300)])); return x; };
  const ESK = { status: 403, error: 'forbidden', reason: 'privilege_escalation' };
  const SUP = { status: 403, error: 'forbidden', reason: 'superadmin_required' };
  const SIST = { status: 409, error: 'last_superadmin', reason: null };
  const FORB = { status: 403, error: 'forbidden', reason: null };
  const STAFF = ['store:vift_staff'], ROLES = ['store:vift_roles'], APP = ['tabell:app_users'];
  const F = U.falt.staffId, PA = U.personalansvarig.staffId, A = U.admin.staffId, A2 = U.admin2.staffId;

  aterstall();
  ok(antalSuper() === 2, 'utgångsläge: två aktiva superadmins (ADM med rollen admin, ADM2 med den egna rollen superadmin2)');

  // ════════════════ SÄK-8 / SEC-ROLL-01, SEC-CUST-18: staff_manage höjer sig själv ════════════════
  await NEJ('SEC-ROLL-01 (E): egen roll med bara staff_manage sätter egen role:"admin" → 403 privilege_escalation, ingen mutation',
    () => MW(U.personalansvarig, 'vift_staff', [med(st(PA), { role: 'admin' })]), ESK);
  await NEJ('SEC-ROLL-01 (E): egen roll → "tom" (lägre) räknas också som ändrad egen roll → 403 privilege_escalation',
    () => MW(U.personalansvarig, 'vift_staff', [med(st(PA), { role: 'tom' })]), ESK);
  await NEJ('SEC-ROLL-01 (E, write): hela registret med egen role:"admin" → 403 privilege_escalation',
    () => W(U.personalansvarig, 'vift_staff', staff().map((s) => (s.id === PA ? med(s, { role: 'admin' }) : s))), ESK);
  let x = rpc(db, 'store_business_key_merge_write', { p_key: 'vift_staff', p_upserts: [{ id: PA, data: med(st(PA), { role: 'admin' }), previous: st(PA) }], p_removals: [], p_caller_authorized: true, p_actor_id: PA });
  ok(x.error && /forbidden:privilege_escalation/.test(x.error.message) && st(PA).role === 'personalansvarig', 'SEC-ROLL-01 (P): RPC direkt med p_caller_authorized=true → forbidden:privilege_escalation (regeln ligger i RPC:n, inte i EF)', x.error);
  let s = await ef.anropa('work-orders-list', { user: U.personalansvarig });
  ok(s.status === 200 && (s.body.workOrders || []).length === 0, 'baslinjefyndet vänt: personalansvarig ser fortfarande inga AO efter försöket (fick aldrig admin)', s.status);

  // ════════════════ SEC-ROLL-02: ge annan roll med 'all' eller utöver anroparen ════════════════
  await NEJ('SEC-ROLL-02 (E): staff_manage ger FÄ rollen admin (har all) → 403 superadmin_required', () => MW(U.personalansvarig, 'vift_staff', [med(st(F), { role: 'admin' })]), SUP);
  await NEJ('SEC-ROLL-02 (E): staff_manage ger FÄ rollen superadmin2 (all, annat id) → 403 superadmin_required', () => MW(U.personalansvarig, 'vift_staff', [med(st(F), { role: 'superadmin2' })]), SUP);
  await NEJ('SEC-ROLL-02 (E): staff_manage ger FÄ rollen chef (behörigheter utöver anroparens) → 403 privilege_escalation', () => MW(U.personalansvarig, 'vift_staff', [med(st(F), { role: 'chef' })]), ESK);
  await NEJ('SEC-ROLL-02 (E): staff_manage skapar ny aktiv personal med rollen chef → 403 privilege_escalation',
    () => MW(U.personalansvarig, 'vift_staff', [{ id: 'ST-NY1', firstName: 'Ny', lastName: 'Chef', email: 'nychef@example.test', role: 'chef', active: true }]), ESK);
  await NEJ('SEC-ROLL-02 (E): staff_manage skapar ny personal med rollen admin (även inaktiv) → 403 superadmin_required',
    () => MW(U.personalansvarig, 'vift_staff', [{ id: 'ST-NY2', firstName: 'Ny', lastName: 'Admin', email: 'nyadmin@example.test', role: 'admin', active: false }]), SUP);
  await NEJ('SEC-ROLL-02 (E): staff_manage inaktiverar superadminens personalpost → 403 superadmin_required', () => MW(U.personalansvarig, 'vift_staff', [med(st(A), { active: false })]), SUP);
  await NEJ('SEC-ROLL-02 (E): staff_manage byter superadminens e-post → 403 superadmin_required', () => MW(U.personalansvarig, 'vift_staff', [med(st(A), { email: 'kapad@example.test' })]), SUP);
  await NEJ('SEC-ROLL-02 (E): staff_manage tar bort superadminens personalpost → 403 superadmin_required', () => MW(U.personalansvarig, 'vift_staff', [], [A]), SUP);
  await NEJ('e-postkapning: staff_manage pekar om en chef-post till sin egen inloggning (e-post) → 403 privilege_escalation',
    () => MW(U.personalansvarig, 'vift_staff', [med(st(U.chef.staffId), { email: U.personalansvarig.email })]), ESK);
  await NEJ('e-postkapning (write): en tom-post med superadminens e-post FÖRST i registret (demoterar inloggningen) → 403 superadmin_required',
    () => W(U.personalansvarig, 'vift_staff', [{ id: 'ST-NY3', firstName: 'X', lastName: 'Y', email: U.admin.email, role: 'tom', active: true }].concat(staff())), SUP);
  await NEJ('dubbla id (write) i personalregistret → 400 invalid_element', () => W(U.personalansvarig, 'vift_staff', staff().concat([med(st(F), { firstName: 'Dubblett' })])), { status: 400, error: 'invalid_element', reason: null });
  await JA('SEC-CUST-18 (+): staff_manage ger FÄ rollen tom (inom egna behörigheter) → 200', () => MW(U.personalansvarig, 'vift_staff', [med(st(F), { role: 'tom' })]), STAFF);
  aterstall();
  await JA('staff_manage ändrar FÄ:s telefon (ingen behörighetsändring, trots att FÄ:s roll är bredare) → 200', () => MW(U.personalansvarig, 'vift_staff', [med(st(F), { phone: '070-111 11 11' })]), STAFF);
  await JA('staff_manage inaktiverar FÄ (minskar åtkomst, ingen höjning) → 200', () => MW(U.personalansvarig, 'vift_staff', [med(st(F), { active: false })]), STAFF);
  await NEJ('staff_manage återaktiverar FÄ (rollen personal ligger utöver anroparens) → 403 privilege_escalation', () => MW(U.personalansvarig, 'vift_staff', [med(st(F), { active: true })]), ESK);
  await JA('staff_manage ändrar superadminens telefon (inte roll/e-post/aktiv) → 200', () => MW(U.personalansvarig, 'vift_staff', [med(st(A), { phone: '070-222 22 22' })]), STAFF);
  aterstall();
  // Egen roll (D-26): arbetsledare + staff_manage.
  await JA('D-26 (+): chef_personal ger FÄ rollen personal (inom egna) → 200', () => MW(U.chefpersonal, 'vift_staff', [med(st(U.begransad.staffId), { role: 'personal' })]), STAFF);
  await NEJ('D-26: chef_personal ger FÄ rollen ekonomi (payroll_* saknas hos anroparen) → 403 privilege_escalation', () => MW(U.chefpersonal, 'vift_staff', [med(st(F), { role: 'ekonomi' })]), ESK);
  await NEJ('D-26: chef_personal ger FÄ rollen admin → 403 superadmin_required', () => MW(U.chefpersonal, 'vift_staff', [med(st(F), { role: 'admin' })]), SUP);
  await NEJ('D-26: chef (utan staff_manage) skriver personalregistret → 403 forbidden', () => MW(U.chef, 'vift_staff', [med(st(F), { phone: '1' })]), FORB);
  await NEJ('SEC-CUST-19 / D-25: admin_manage är inte superadmin och inte staff_manage: adminhanterare skriver personalregistret → 403 forbidden',
    () => MW(U.adminhanterare, 'vift_staff', [med(st(F), { role: 'tom' })]), FORB);

  // ════════════════ SEC-ROLL-03, SEC-CUST-19: admin_manage i rollregistret ════════════════
  aterstall();
  await NEJ('SEC-ROLL-03 (E): admin_manage lägger till all i rollen tom → 403 superadmin_required', () => MW(U.adminhanterare, 'vift_roles', [roll('tom', ['all'])]), SUP);
  await NEJ('SEC-ROLL-03 (E): admin_manage skapar ny roll med all → 403 superadmin_required', () => MW(U.adminhanterare, 'vift_roles', [{ id: 'ny_super', label: 'Ny', permissions: ['all'] }]), SUP);
  await NEJ('SEC-ROLL-03 (E): admin_manage ändrar etiketten på rollen admin (har all) → 403 superadmin_required', () => MW(U.adminhanterare, 'vift_roles', [med(ro('admin'), { label: 'X' })]), SUP);
  await NEJ('SEC-ROLL-03 (E): admin_manage tar bort all ur rollen superadmin2 → 403 superadmin_required', () => MW(U.adminhanterare, 'vift_roles', [roll('superadmin2', ['dashboard_view'])]), SUP);
  await NEJ('SEC-ROLL-03 (E): admin_manage raderar rollen admin → 403 superadmin_required', () => MW(U.adminhanterare, 'vift_roles', [], ['admin']), SUP);
  await NEJ('SEC-ROLL-03 (E): admin_manage lägger till behörighet i egen roll → 403 privilege_escalation', () => MW(U.adminhanterare, 'vift_roles', [roll('adminhanterare', ro('adminhanterare').permissions.concat(['staff_manage']))]), ESK);
  await NEJ('SEC-ROLL-03 (E): admin_manage tar bort behörighet ur egen roll (ändrar egen roll) → 403 privilege_escalation', () => MW(U.adminhanterare, 'vift_roles', [roll('adminhanterare', ['admin_manage'])]), ESK);
  await NEJ('SEC-ROLL-03 (E): admin_manage ger rollen tom ao_view_all (utöver anroparens) → 403 privilege_escalation', () => MW(U.adminhanterare, 'vift_roles', [roll('tom', ['ao_view_all'])]), ESK);
  await NEJ('SEC-CUST-19: admin_manage ger en roll bankgiro_edit (utöver anroparens) → 403 privilege_escalation', () => MW(U.adminhanterare, 'vift_roles', [roll('tom', ['bankgiro_edit'])]), ESK);
  await NEJ('SEC-ROLL-03 (E, write): hela rollregistret med all i rollen tom → 403 superadmin_required', () => W(U.adminhanterare, 'vift_roles', roles().map((x) => (x.id === 'tom' ? med(x, { permissions: ['all'] }) : x))), SUP);
  x = rpc(db, 'store_business_key_merge_write', { p_key: 'vift_roles', p_upserts: [{ id: 'tom', data: roll('tom', ['all']), previous: ro('tom') }], p_removals: [], p_caller_authorized: true, p_actor_id: U.adminhanterare.staffId });
  ok(x.error && /forbidden:superadmin_required/.test(x.error.message), 'SEC-ROLL-03 (P): RPC direkt → forbidden:superadmin_required', x.error);
  await JA('SEC-CUST-19 (+): admin_manage ger rollen tom dashboard_view (inom egna) → 200', () => MW(U.adminhanterare, 'vift_roles', [roll('tom', ['dashboard_view'])]), ROLES);
  await JA('admin_manage tar bort ao_view_all ur rollen saljare (minskning) → 200', () => MW(U.adminhanterare, 'vift_roles', [roll('saljare', ['dashboard_view', 'sales_manage'])]), ROLES);
  await JA('admin_manage skapar en ny roll med admin_manage (inom egna) → 200', () => MW(U.adminhanterare, 'vift_roles', [{ id: 'ny_admin', label: 'Ny', isBuiltin: false, active: true, permissions: ['admin_manage'] }]), ROLES);
  await NEJ('personalansvarig (utan admin_manage) skriver rollregistret → 403 forbidden', () => MW(U.personalansvarig, 'vift_roles', [roll('tom', [])]), FORB);

  // ════════════════ SEC-ROLL-04: den enda aktiva superadminen ════════════════
  aterstall();
  await JA('SEC-ROLL-07 (+): ADM inaktiverar ADM2 när ADM finns kvar → 200', () => MW(U.admin, 'vift_staff', [med(st(A2), { active: false })]), STAFF);
  ok(antalSuper() === 1, 'efter SEC-ROLL-07: en aktiv superadmin');
  await NEJ('SEC-ROLL-04 (E): ensam ADM inaktiverar sig själv → 409 last_superadmin', () => MW(U.admin, 'vift_staff', [med(st(A), { active: false })]), SIST);
  await NEJ('SEC-ROLL-04 (E): ensam ADM byter egen roll till chef → 409 last_superadmin', () => MW(U.admin, 'vift_staff', [med(st(A), { role: 'chef' })]), SIST);
  await NEJ('SEC-ROLL-04 (E): ensam ADM byter egen e-post (inloggningen tappar posten) → 409 last_superadmin', () => MW(U.admin, 'vift_staff', [med(st(A), { email: 'ny@example.test' })]), SIST);
  await NEJ('SEC-ROLL-04 (E): ensam ADM tar bort all ur rollen admin → 409 last_superadmin', () => MW(U.admin, 'vift_roles', [roll('admin', ['admin_manage', 'staff_manage'])]), SIST);
  await NEJ('SEC-ROLL-04 (E): ensam ADM raderar rollen admin → 409 last_superadmin', () => MW(U.admin, 'vift_roles', [], ['admin']), SIST);
  await NEJ('SEC-ROLL-04 (E, write): ensam ADM skriver rollregistret utan all → 409 last_superadmin', () => W(U.admin, 'vift_roles', roles().map((y) => (y.id === 'admin' ? med(y, { permissions: ['admin_manage'] }) : y))), SIST);
  x = rpc(db, 'deactivate_vift_user', { p_user_id: U.admin.authId });
  ok(x.error && /last_superadmin/.test(x.error.message) && one1(db, U.admin.authId), 'SEC-ROLL-04 (P): deactivate_vift_user på ensam superadmin → last_superadmin, app_users oförändrad', x.error);
  x = rpc(db, 'store_business_key_merge_write', { p_key: 'vift_staff', p_upserts: [{ id: A, data: med(st(A), { active: false }), previous: st(A) }], p_removals: [], p_caller_authorized: true, p_actor_id: A });
  ok(x.error && /last_superadmin/.test(x.error.message), 'SEC-ROLL-04 (P): RPC direkt → last_superadmin', x.error);
  await JA('ADM ger FÄ rollen superadmin2 (superadmin får tilldela all) → 200', () => MW(U.admin, 'vift_staff', [med(st(F), { role: 'superadmin2' })]), STAFF);
  ok(antalSuper() === 2, 'nu två aktiva superadmins (ADM och FÄ)');
  await JA('därefter: ADM byter egen roll till chef (FÄ finns kvar) → 200', () => MW(U.admin, 'vift_staff', [med(st(A), { role: 'chef' })]), STAFF);
  ok(antalSuper() === 1, 'invarianten: exakt en aktiv superadmin kvar');

  // ════════════════ SEC-ROLL-08: egen superadminroll med annat id ════════════════
  aterstall();
  await JA('SEC-ROLL-08: ADM2 (rollen superadmin2) lägger till all i rollen tom → 200', () => MW(U.admin2, 'vift_roles', [roll('tom', ['all'])]), ROLES);
  await JA('SEC-ROLL-08: ADM2 ger FÄ rollen admin → 200', () => MW(U.admin2, 'vift_staff', [med(st(F), { role: 'admin' })]), STAFF);
  aterstall();
  await JA('SEC-ROLL-08: ADM2 byter ADM:s roll till chef → 200 (ADM2 räknas som superadmin via all, inte via roll-id)', () => MW(U.admin2, 'vift_staff', [med(st(A), { role: 'chef' })]), STAFF);
  await NEJ('SEC-ROLL-08: ADM2 nu ensam tar bort all ur sin egen roll → 409 last_superadmin', () => MW(U.admin2, 'vift_roles', [roll('superadmin2', ['admin_manage'])]), SIST);
  s = await ef.anropa('store-key-write', { user: U.admin2, body: { action: 'readAllWithHashes', keys: ['vift_roles', 'vift_staff'] } });
  ok(s.status === 200 && s.body.data.roles.length === roles().length && s.body.data.staff.every((y) => 'role' in y), 'SEC-ROLL-08: ADM2 läser hela roll- och personalregistret', s.status);

  // ════════════════ SEC-ROLL-09: roll med id 'admin' UTAN all ════════════════
  aterstall();
  psql(db, `update public.store set value = (select jsonb_agg(case when e->>'id' = 'admin' then e || '{"permissions":["dashboard_view","admin_manage","staff_manage","staff_view"]}'::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_roles'`);
  psql(db, `drop table public._t3c_bas; create table public._t3c_bas as select * from public.store;`);
  ok(antalSuper() === 1, 'SEC-ROLL-09: rollen admin saknar all; bara ADM2 (superadmin2) är superadmin');
  await NEJ('SEC-ROLL-09 (E): "admin" utan all lägger till all i rollen tom → 403 superadmin_required', () => MW(U.admin, 'vift_roles', [roll('tom', ['all'])]), SUP);
  await NEJ('SEC-ROLL-09 (E): "admin" utan all ger FÄ rollen superadmin2 → 403 superadmin_required', () => MW(U.admin, 'vift_staff', [med(st(F), { role: 'superadmin2' })]), SUP);
  await NEJ('SEC-ROLL-09 (E): "admin" utan all inaktiverar ADM2 → 403 superadmin_required', () => MW(U.admin, 'vift_staff', [med(st(A2), { active: false })]), SUP);
  await NEJ('SEC-ROLL-09 (E): "admin" utan all lägger till all i sin egen roll admin → 403 privilege_escalation (egen roll)', () => MW(U.admin, 'vift_roles', [roll('admin', ['all'])]), ESK);
  s = await ef.anropa('work-orders-list', { user: U.admin });
  ok(s.status === 200 && (s.body.workOrders || []).length === 0, 'SEC-ROLL-09: rollen admin utan all ger ingen superadminåtkomst (inga AO)', s.status);
  // Tillbaka till standardbasen.
  psql(db, `begin; delete from public.store; insert into public.store select * from public._t3c_bas; update public.store set value = (select jsonb_agg(case when e->>'id' = 'admin' then e || '{"permissions":["all"]}'::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_roles'; drop table public._t3c_bas; create table public._t3c_bas as select * from public.store; commit;`);
  ok(antalSuper() === 2, 'standardbasen återställd (två superadmins)');

  // ════════════════ Invarianten i deactivate_vift_user / provision_vift_user ════════════════
  aterstall();
  const appKs = () => ksTa(db, { tables: ['app_users'] });
  x = rpc(db, 'deactivate_vift_user', { p_user_id: U.admin2.authId });
  ok(!x.error && antalSuper() === 1, 'deactivate_vift_user(ADM2) när ADM finns kvar → ok, en superadmin kvar', x.error);
  let k0 = appKs();
  x = rpc(db, 'deactivate_vift_user', { p_user_id: U.admin.authId });
  ok(x.error && /last_superadmin/.test(x.error.message) && ksDiff(k0, appKs()).length === 0, 'deactivate_vift_user(sista) → last_superadmin, app_users oförändrad (KS)', x.error);
  x = rpc(db, 'deactivate_vift_user', { p_user_id: U.falt.authId });
  ok(!x.error, 'deactivate_vift_user på en vanlig användare påverkas inte', x.error);
  x = rpc(db, 'provision_vift_user', { p_user_id: U.admin2.authId, p_staff_id: A2, p_role_id: 'superadmin2', p_is_admin: true });
  ok(!x.error && antalSuper() === 2, 'provision_vift_user återaktiverar ADM2 under samma lås → två superadmins', x.error);
  x = rpc(db, 'provision_vift_user', { p_user_id: U.falt.authId, p_staff_id: F, p_role_id: 'personal', p_is_admin: false });
  ok(!x.error && one1(db, U.falt.authId), 'provision_vift_user för vanlig användare fungerar som tidigare', x.error);
  ok(['deactivate_vift_user', 'provision_vift_user'].every((f) => q(db, `select has_function_privilege('authenticated', p.oid, 'EXECUTE') a, has_function_privilege('anon', p.oid, 'EXECUTE') b from pg_proc p where proname = ${lit(f)}`).every((y) => !y.a && !y.b)),
    'deactivate/provision: fortfarande bara service_role (R-E)');

  // ════════════════ Samtidighet SEC-ROLL-05 och SEC-ROLL-06 (50 upprepningar, egna anslutningar) ════════════════
  const N = 50;
  let fel = [];
  for (let i = 0; i < N; i++) {
    aterstall();
    const [r1, r2] = await Promise.all([rpcAsync(db, 'deactivate_vift_user', { p_user_id: U.admin.authId }), rpcAsync(db, 'deactivate_vift_user', { p_user_id: U.admin2.authId })]);
    const okN = [r1, r2].filter((y) => !y.error).length, sist = [r1, r2].filter((y) => y.error && /last_superadmin/.test(y.error.message)).length;
    if (okN !== 1 || sist !== 1 || antalSuper() !== 1) fel.push([okN, sist, antalSuper()]);
  }
  ok(fel.length === 0, `SEC-ROLL-05 (P): ADM och ADM2 inaktiverar varandra samtidigt med deactivate_vift_user (${N} upprepningar, egna anslutningar): exakt en lyckas, den andra får last_superadmin, aldrig 0 superadmins`, fel);
  fel = [];
  for (let i = 0; i < N; i++) {
    aterstall();
    const bar = ef.barriar('store_business_key_merge_write', 2);
    const [r1, r2] = await Promise.all([MW(U.admin, 'vift_staff', [med(st(A2), { active: false })]), MW(U.admin2, 'vift_staff', [med(st(A), { active: false })])]);
    const vinn = [r1, r2].filter((y) => y.status === 200).length;
    const forl = [r1, r2].find((y) => y.status !== 200);
    const forlOk = forl && ((forl.status === 403 && forl.body.error === 'forbidden' && forl.body.reason === undefined) || (forl.status === 409 && forl.body.error === 'last_superadmin'));
    if (vinn !== 1 || !forlOk || bar.kvar !== 0 || antalSuper() !== 1) fel.push([r1.status, r2.status, forl && forl.body, antalSuper()]);
  }
  ok(fel.length === 0, `SEC-ROLL-05 (E): ADM och ADM2 inaktiverar varandras personalpost samtidigt via store-key-write (${N} upprepningar, barriär före RPC:n): exakt en 200; förloraren nekas (den inaktiverade anroparen: 403 forbidden), aldrig 0 superadmins`, fel);
  fel = [];
  for (let i = 0; i < N; i++) {
    aterstall();
    const bar = ef.barriar('store_business_key_merge_write', 2);
    const [r1, r2] = await Promise.all([MW(U.admin, 'vift_roles', [roll('superadmin2', ['dashboard_view'])]), MW(U.admin2, 'vift_staff', [med(st(A), { role: 'chef' })])]);
    const vinn = [r1, r2].filter((y) => y.status === 200).length;
    const forl = [r1, r2].find((y) => y.status !== 200);
    const forlOk = forl && ((forl.status === 403 && forl.body.error === 'forbidden') || (forl.status === 409 && forl.body.error === 'last_superadmin'));
    if (vinn !== 1 || !forlOk || bar.kvar !== 0 || antalSuper() !== 1) fel.push([r1.status, r2.status, forl && forl.body, antalSuper()]);
  }
  ok(fel.length === 0, `SEC-ROLL-06 (E): samtidigt ändrar ADM rollens behörigheter (superadmin2 utan all) och ADM2 byter roll på ADM (${N} upprepningar): exakt en 200, invarianten håller (gemensamt lås för vift_staff + vift_roles)`, fel);
  fel = [];
  for (let i = 0; i < N; i++) {
    aterstall();
    const [r1, r2] = await Promise.all([
      rpcAsync(db, 'store_business_key_merge_write', { p_key: 'vift_roles', p_upserts: [{ id: 'superadmin2', data: roll('superadmin2', ['admin_manage']), previous: ro('superadmin2') }], p_removals: [], p_caller_authorized: true, p_actor_id: A }),
      rpcAsync(db, 'deactivate_vift_user', { p_user_id: U.admin.authId })]);
    const okN = [r1, r2].filter((y) => !y.error).length;
    const nek = [r1, r2].filter((y) => y.error && /last_superadmin|forbidden/.test(y.error.message)).length;
    if (okN !== 1 || nek !== 1 || antalSuper() !== 1) fel.push([okN, nek, r1.error && r1.error.message, r2.error && r2.error.message, antalSuper()]);
  }
  ok(fel.length === 0, `SEC-ROLL-06 (P): rollregistret (ADM tar all från superadmin2) samtidigt med deactivate_vift_user(ADM) (${N} upprepningar, egna anslutningar): exakt en lyckas, aldrig 0 superadmins`, fel);

  // Låsordning mot T3-B: AO-/tidskrivningar samtidigt med personal-/rollskrivningar ger aldrig deadlock.
  fel = [];
  for (let i = 0; i < 10; i++) {
    aterstall();
    const res = await Promise.all([
      rpcAsync(db, 'work_order_pool_take', { p_ao_id: 'AO-P1', p_caller_staff_id: F, p_caller_perms: ['ao_view_own', 'ao_complete'], p_idempotency_key: 'lk-' + i, p_entry_id: '' }),
      rpcAsync(db, 'store_business_key_merge_write', { p_key: 'vift_staff', p_upserts: [{ id: F, data: med(st(F), { phone: 'lk' + i }), previous: st(F) }], p_removals: [], p_caller_authorized: true, p_actor_id: A }),
      rpcAsync(db, 'time_entry_create', { p_entry: { id: 'TE-LK-' + i, aoId: 'AO-A1', date: '2026-11-24', minutes: 30, staffId: F }, p_idempotency_key: 'lkt-' + i, p_client_id: '', p_caller_staff_id: F, p_caller_auth_id: U.falt.authId, p_caller_perms: ['ao_view_own', 'ao_complete', 'ao_time'] }),
      rpcAsync(db, 'store_business_key_merge_write', { p_key: 'vift_roles', p_upserts: [{ id: 'tom', data: roll('tom', ['dashboard_view']), previous: ro('tom') }], p_removals: [], p_caller_authorized: true, p_actor_id: A }),
      rpcAsync(db, 'deactivate_vift_user', { p_user_id: U.falt2.authId }),
    ]);
    const dead = res.filter((y) => y.error && /deadlock|40P01/.test(y.error.message + y.error.code));
    if (dead.length || res.some((y) => y.error)) fel.push(res.map((y) => y.error && y.error.message.slice(0, 80)));
  }
  ok(fel.length === 0, 'låsordning: T3-B (tagning, tid) och T3-C (personal, roller, deactivate) samtidigt, 10 upprepningar: alla lyckas, ingen deadlock', fel);

  // ════════════════ Behörigheter läses om vid varje anrop (tillägget i BESLUT-2026-11-28) ════════════════
  aterstall();
  s = await ef.anropa('work-orders-list', { user: U.falt });
  const fore = (s.body.workOrders || []).length;
  await JA('ADM drar in ao_view_own ur rollen personal → 200', () => MW(U.admin, 'vift_roles', [roll('personal', ro('personal').permissions.filter((p) => p !== 'ao_view_own'))]), ROLES);
  s = await ef.anropa('work-orders-list', { user: U.falt });
  ok(fore > 0 && s.status === 200 && (s.body.workOrders || []).length === 0, 'servern läser behörigheterna vid varje anrop: samma JWT (befintlig session) ser inga AO direkt efter indragningen', [fore, s.status]);
  s = await ef.anropa('store-key-write', { user: U.falt, body: { action: 'readAllWithHashes', keys: ['vift_roles'] } });
  ok(s.status === 200 && s.body.data.roles.length === 1 && !s.body.data.roles[0].permissions.includes('ao_view_own'), 'klienten får den indragna rollen vid nästa DataSync (egen effektiv roll utan ao_view_own)', s.body.data && s.body.data.roles);
  await JA('ADM inaktiverar FÄ:s personalpost → 200', () => MW(U.admin, 'vift_staff', [med(st(F), { active: false })]), STAFF);
  s = await ef.anropa('store-key-write', { user: U.falt, body: { action: 'readAllWithHashes', keys: ['vift_roles'] } });
  ok(s.status === 403 && s.body.error === 'Forbidden', 'inaktiverad personalpost: samma JWT nekas direkt (403 Forbidden)', s);
  aterstall();
  psql(db, `update public.store set value = (select jsonb_agg(case when e->>'id' = 'personalansvarig' then e || '{"permissions":["dashboard_view","staff_view"]}'::jsonb else e end) from jsonb_array_elements(value) e) where key = 'vift_roles'`);
  k0 = ksTa(db, KS);
  x = rpc(db, 'store_business_key_merge_write', { p_key: 'vift_staff', p_upserts: [{ id: F, data: med(st(F), { phone: 'x' }), previous: st(F) }], p_removals: [], p_caller_authorized: true, p_actor_id: PA });
  ok(x.error && x.error.message.includes('forbidden') && !/forbidden:/.test(x.error.message) && ksDiff(k0, ksTa(db, KS)).length === 0,
    'RPC:n läser om anroparens behörigheter under låset: staff_manage indragen efter EF-kontrollen (p_caller_authorized=true) → forbidden, ingen mutation', x.error);

  // ════════════════ Projektion D-21/D-14 (SEC-B3-01/02/03/05/06) ════════════════
  aterstall();
  const las = async (user, keys) => (await ef.anropa('store-key-write', { user, body: { action: 'readAllWithHashes', keys } })).body;
  let d = await las(U.falt, ['vift_staff', 'vift_roles']);
  const egen = d.data.staff.find((y) => y.id === F);
  const andra = d.data.staff.filter((y) => y.id !== F);
  ok(egen && egen.role === 'personal' && egen.email === U.falt.email, 'SEC-B3-02: FÄ får sin egen post med roll och e-post (inloggningen löser rätt användare)', egen);
  ok(andra.length > 5 && andra.every((y) => !('role' in y) && !('permissions' in y)), 'SEC-B3-03 (E): FÄ får inte andras role eller permissions', andra[0]);
  ok(andra.every((y) => y.firstName && y.lastName && 'phone' in y && 'email' in y) && andra.some((y) => y.title === 'Testtitel'), 'SEC-B3-01: FÄ får kollegornas namn, titel och arbetskontakt (D-14)');
  ok(d.data.roles.length === 1 && d.data.roles[0].id === 'personal' && Array.isArray(d.data.roles[0].permissions), 'SEC-B3-05 (E): FÄ får bara sin egen effektiva roll ur vift_roles', d.data.roles.map((y) => y.id));
  ok(d.hashes.vift_roles === hashAv('vift_roles') && d.hashes.vift_staff === hashAv('vift_staff'), 'hash avser det fullständiga servervärdet (som C-5), inte projektionen');
  // Samma regel som klientens Auth._resolveUser: rätt egen roll trots projektionen.
  const res = (dd, email) => { const p = dd.data.staff.find((y) => y.active && y.email && y.email.toLowerCase() === email); const rr = p && dd.data.roles.find((y) => y.id === p.role); return rr ? rr.permissions : null; };
  ok(JSON.stringify(res(d, U.falt.email)) === JSON.stringify(ro('personal').permissions), 'klientens upplösning (Auth._resolveUser) ger samma behörigheter som servern med projektionen');
  d = await las(U.ekonomi, ['vift_staff', 'vift_roles']);
  ok(d.data.staff.filter((y) => y.id !== U.ekonomi.staffId).every((y) => !('role' in y) && !('permissions' in y)) && d.data.roles.map((y) => y.id).join() === 'ekonomi', 'SEC-B3-03/05 (E): ekonomi får varken andras role/permissions eller andras roller');
  d = await las(U.chef, ['vift_staff', 'vift_roles']);
  ok(d.data.staff.filter((y) => y.id !== U.chef.staffId).every((y) => 'role' in y && !('permissions' in y)) && d.data.roles.map((y) => y.id).join() === 'chef', 'R40/SEC-B3-05: arbetsledare (staff_view) ser andras role men inte permissions, och bara sin egen roll');
  d = await las(U.chefutanstaffview, ['vift_staff']);
  ok(d.data.staff.filter((y) => y.id !== U.chefutanstaffview.staffId).every((y) => !('role' in y)), 'D-26: chef − staff_view ser inte andras role');
  d = await las(U.personalansvarig, ['vift_staff', 'vift_roles']);
  ok(d.data.staff.every((y) => 'role' in y && 'permissions' in y) && d.data.roles.map((y) => y.id).sort().join() === 'personalansvarig,tom',
    'staff_manage: hela personalregistret, och ur rollregistret bara egen roll + roller som får tilldelas (inom egna, utan all)', d.data.roles.map((y) => y.id));
  d = await las(U.adminhanterare, ['vift_staff', 'vift_roles']);
  ok(d.data.roles.length === roles().length && d.data.staff.every((y) => 'role' in y && 'permissions' in y), 'SEC-B3-06 (E): egen roll med admin_manage får alla roller (och hela personalregistret)');
  s = await ef.anropa('store-key-write', { user: U.falt, body: { action: 'readWithHash', key: 'vift_roles' } });
  ok(s.status === 200 && s.body.value.length === 1 && s.body.value[0].id === 'personal' && s.body.hash === hashAv('vift_roles'), 'SEC-B3-05 (E, readWithHash): samma projektion', s.body);
  s = await ef.anropa('store-key-write', { user: U.falt, body: { action: 'readWithHash', key: 'vift_staff' } });
  ok(s.status === 200 && s.body.value.filter((y) => y.id !== F).every((y) => !('role' in y)), 'SEC-B3-03 (E, readWithHash): samma projektion');
  // REST (R): raden döljs för den som inte hanterar registret.
  const restLas = (user, key) => asUser(db, user, `select key, value from public.store where key = ${lit(key)}`);
  ok(restLas(U.falt, 'vift_staff').rows.length === 0 && restLas(U.ekonomi, 'vift_staff').rows.length === 0 && restLas(U.chef, 'vift_staff').rows.length === 0, 'SEC-B3-03 (R): REST-läsning av vift_staff ger tom lista för FÄ, EK och AL');
  ok(restLas(U.falt, 'vift_roles').rows.length === 0 && restLas(U.chef, 'vift_roles').rows.length === 0 && restLas(U.personalansvarig, 'vift_roles').rows.length === 0, 'SEC-B3-05 (R): REST-läsning av vift_roles ger tom lista utan admin_manage');
  ok(restLas(U.adminhanterare, 'vift_roles').rows.length === 1 && restLas(U.personalansvarig, 'vift_staff').rows.length === 1 && restLas(U.admin, 'vift_staff').rows.length === 1, 'SEC-B3-06 (R): admin_manage läser vift_roles, staff_manage och superadmin läser vift_staff');
  x = rpc(db, 'store_read_all_with_hashes_projected', { p_business_keys: ['vift_staff', 'vift_roles'], p_perms: ro('personal').permissions });
  ok(!x.error && x.data.data.vift_roles.length === roles().length && x.data.data.vift_staff.every((y) => !('permissions' in y) && 'role' in y),
    'ÖVERGÅNG (äldre store-key-write utan identitet): rollregistret oförändrat och permissions borttaget, så att inloggningen fungerar under installationsfönstret', x.error);

  // ════════════════ SEC-CUST-22/23: tom behörighetslista och okänd roll ════════════════
  for (const [alias, sec] of [['tom', 'SEC-CUST-22'], ['okandroll', 'SEC-CUST-23']]) {
    const u = U[alias];
    d = await las(u, ['vift_staff', 'vift_roles', 'vift_customers', 'vift_settings']);
    ok(d.data.roles.length === (alias === 'tom' ? 1 : 0) && d.data.staff.filter((y) => y.id !== u.staffId).every((y) => !('role' in y)) && d.data.customers.every((y) => !('personnr' in y)),
      `${sec}: store-key-write → 200 med egen roll (${alias === 'tom' ? 'tom lista' : 'ingen'}), utan andras roller/role (kundurvalet per post är T3-D; personnummer saknas redan, C-5)`, d.data.roles);
    s = await ef.anropa('work-orders-list', { user: u });
    ok(s.status === 200 && s.body.workOrders.length === 0, `${sec}: work-orders-list → 200 med tom lista`, s.status);
    s = await ef.anropa('time-entries-list', { user: u });
    ok((s.status === 200 && (s.body.timeEntries || []).length === 0) || s.status === 403, `${sec}: time-entries-list → ingen data`, [s.status]);
    await NEJ(`${sec}: ao-time-write create_ao → 403 forbidden`, () => ef.anropa('ao-time-write', { user: u, body: { action: 'create_ao', idempotencyKey: 'c22-' + alias, ao: { title: 'x', status: 'nytt', staff: [] } } }), FORB, { keys: ['vift_workOrders'], tables: ['op_idempotency'] });
    await NEJ(`${sec}: invoice-write → 403 forbidden`, () => ef.anropa('invoice-write', { user: u, body: { action: 'lineAdd', invoiceId: 'INV-R2', expectedRevision: 0, line: { id: 'L22', description: 'x', qty: 1, unitPrice: 1, vatRate: 25 } } }), FORB, { keys: ['vift_invoices'] });
    await NEJ(`${sec}: skriva personalregistret → 403 forbidden`, () => MW(u, 'vift_staff', [med(st(u.staffId), { role: 'admin' })]), FORB);
  }

  // ════════════════ F18 / SÄK-13: direkt REST-skrivning (SEC-REST-01/02) ════════════════
  aterstall();
  const AFFAR = ['customers', 'properties', 'propertyContacts', 'propertyRoles', 'propertyCategories', 'propertyObjects', 'deviationCategories', 'inspections',
    'contracts', 'offers', 'salesOpps', 'recurringOrders', 'ronderingar', 'ronderingsmallar', 'avvikelser', 'staff', 'roles', 'settings', 'titles', 'articles',
    'priceGroups', 'priceProfiles', 'serviceTemplates', 'emailTemplates', 'activities', 'activityLog', 'importLogs', 'projects'].map((k) => 'vift_' + k);
  ok(AFFAR.length === 28, '28 affärsnycklar (_staging_business_key_required_perm)');
  const OVRIGA = ['vift_workOrders', 'vift_timeEntries', 'vift_invoices', 'vift_offerAttachments', 'vift_ronderingspass', 'vift_projectDocuments'];
  psql(db, `insert into public.store(key, value) select k, '[]'::jsonb from unnest(array[${AFFAR.concat(OVRIGA).map(lit).join(',')}]::text[]) k on conflict (key) do nothing`);
  psql(db, `drop table public._t3c_bas; create table public._t3c_bas as select * from public.store;`);
  const allaKs = { keys: AFFAR.concat(OVRIGA, ['vift_notifications', 'vift_e2e_t3c']) };
  const k1 = ksTa(db, allaKs);
  const ut = { ins: {}, upd: {}, del: {} };
  for (const k of AFFAR.concat(OVRIGA)) {
    const i = asUser(db, U.falt, `insert into public.store(key, value) values (${lit(k)}, '[{"id":"X"}]'::jsonb) on conflict (key) do update set value = excluded.value`);
    ut.ins[k] = i.ok ? 'ok:' + i.count : i.status + ':' + i.code + ':' + (/direct_write_blocked/.test(i.message) ? 'direct_write_blocked' : i.message.slice(0, 60));
    const u2 = asUser(db, U.falt, `update public.store set value = '[]'::jsonb where key = ${lit(k)}`);
    ut.upd[k] = u2.ok ? 'rader:' + u2.count : u2.status + ':' + u2.code;
    const d2 = asUser(db, U.falt, `delete from public.store where key = ${lit(k)}`);
    ut.del[k] = d2.ok ? 'rader:' + d2.count : d2.status + ':' + d2.code;
  }
  const insFel = Object.entries(ut.ins).filter(([k, v]) => !(['vift_workOrders', 'vift_timeEntries', 'vift_invoices'].includes(k) ? v === '400:P0001:direct_write_blocked' : v === '403:42501:direct_write_blocked'));
  ok(insFel.length === 0, 'SEC-REST-01: REST-upsert (INSERT … ON CONFLICT, som Storage.setAll/setRemoteStrict) av alla 28 affärsnycklar och AO/tid/fakturor/offerAttachments/ronderingspass/projectDocuments → 42501 direct_write_blocked (AO/tid/fakturor: P0001 direct_write_blocked från den befintliga triggern)', insFel);
  const updFel = Object.entries(ut.upd).filter(([, v]) => v !== 'rader:0');
  const delFel = Object.entries(ut.del).filter(([, v]) => v !== 'rader:0');
  ok(updFel.length === 0 && delFel.length === 0, 'SEC-REST-01: REST-UPDATE/DELETE av samma nycklar → 0 rader (befintliga RESTRICTIVE-policyer döljer raderna; PostgreSQL rapporterar inget fel för dolda rader)', updFel.concat(delFel));
  ok(ksDiff(k1, ksTa(db, allaKs)).length === 0, 'SEC-REST-01: kontrollsumman för alla nycklar är oförändrad efter 102 nekade REST-skrivningar');
  // SEC-REST-02
  const runId = 'vift_e2e_t3c';
  let rr = asUser(db, U.begransad, `insert into public.store(key, value) values (${lit(runId)}, '{"x":1}'::jsonb)`);
  ok(!rr.ok && rr.status === 403 && rr.code === '42501' && /direct_write_blocked/.test(rr.message) && val(db, runId) === null, 'SEC-REST-02 / SÄK-13 vänt: begränsad skapar okänd nyckel vift_e2e_<runId> → 403 42501 direct_write_blocked, ingen rad', rr);
  psql(db, `insert into public.store(key, value) values (${lit(runId)}, '{"x":1}'::jsonb)`);
  const k2 = ksTa(db, { keys: [runId] });
  rr = asUser(db, U.begransad, `delete from public.store where key = ${lit(runId)}`);
  ok(!rr.ok && rr.status === 403 && rr.code === '42501' && ksDiff(k2, ksTa(db, { keys: [runId] })).length === 0, 'SEC-REST-02 / SÄK-13 vänt: begränsad raderar en okänd nyckel (synlig rad) → 403 42501, raden finns kvar', rr);
  rr = asUser(db, U.begransad, `update public.store set value = '{"x":2}'::jsonb where key = ${lit(runId)}`);
  ok(!rr.ok && rr.status === 403 && rr.code === '42501' && ksDiff(k2, ksTa(db, { keys: [runId] })).length === 0, 'F18: UPDATE av okänd nyckel (synlig rad) → 403 42501 direct_write_blocked (uttryckligt fel, inte 0 rader)', rr);
  /* T4-A, tilläggsdel notiser (20261128000010, punkt 275) avvecklar vitlistan avsiktligt. Med den
     installerad (hela repokedjan) prövas samma fall med de strängare utfallen; utan den (T3-C-läget)
     som tidigare. Inget negativt fall tas bort. Den säkra notisvägen prövas i t4a_notiser.test.js. */
  const NOTISDEL = q(db, `select to_regprocedure('public.notification_append(text,jsonb,text,integer)') is not null as x`)[0].x;
  const notis = { id: 'N-T3C-1', createdAt: '2026-11-28T08:00:00.000Z', type: 'info', message: 'Syntetisk notis', userId: U.falt2.staffId, read: false };
  if (!NOTISDEL) {
    rr = asUser(db, U.begransad, `update public.store set key = 'vift_notifications_x' where key = 'vift_notifications'`);
    ok(!rr.ok && rr.status === 403 && rr.code === '42501', 'F18: nyckelbyte via REST → 42501', rr);
    const lcFore = val(db, 'vift_lastChanged');
    rr = asUser(db, U.begransad, `update public.store set value = '"1999-01-01T00:00:00.000Z"'::jsonb where key = 'vift_lastChanged'`);
    const lcEfter = val(db, 'vift_lastChanged');
    ok(rr.ok && rr.count === 1 && lcEfter !== '1999-01-01T00:00:00.000Z' && lcEfter > lcFore && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(lcEfter),
      'SEC-REST-02 / F18 (vitlista, se Beslut som behövs): UPDATE av vift_lastChanged godtas men VÄRDET SÄTTS AV SERVERN — klientens 1999-värde sparas aldrig, signalen kan inte vridas bakåt', [lcFore, lcEfter]);
    rr = asUser(db, U.begransad, `update public.store set value = '{"smuggel":"data"}'::jsonb where key = 'vift_lastChanged'`);
    ok(rr.ok && typeof val(db, 'vift_lastChanged') === 'string', 'F18: inget data kan lagras i vift_lastChanged (servervärdet ersätter alltid)');
    rr = asUser(db, U.begransad, `delete from public.store where key = 'vift_lastChanged'`);
    ok(!rr.ok && rr.status === 403 && rr.code === '42501' && val(db, 'vift_lastChanged') !== null, 'F18: DELETE av vift_lastChanged → 403 42501', rr);
    // Klientens faktiska väg (persistNotifs) fungerar.
    rr = asUser(db, U.falt, `insert into public.store(key, value) values ('vift_notifications', ${jlit([notis])}), ('vift_lastChanged', '"2026-11-28T08:00:00.000Z"'::jsonb) on conflict (key) do update set value = excluded.value`);
    ok(rr.ok && val(db, 'vift_notifications').some((n) => n.id === 'N-T3C-1'), 'F18 (+): klientens persistNotifs-upsert (notiser + lastChanged i ett anrop) fungerar som tidigare', rr);
    rr = asUser(db, U.falt2, `update public.store set value = ${jlit([Object.assign({}, notis, { read: true })])} where key = 'vift_notifications'`);
    ok(rr.ok && val(db, 'vift_notifications')[0].read === true, 'F18 (+): lästmarkering av notis fungerar');
    rr = asUser(db, U.falt2, `update public.store set value = ${jlit([Object.assign({}, notis, { message: 'ändrad' })])} where key = 'vift_notifications'`);
    ok(!rr.ok && rr.code === '42501' && val(db, 'vift_notifications')[0].message === 'Syntetisk notis', 'befintligt innehållsskydd för notiser gäller fortfarande (meddelandet kan inte ändras)', rr);
  } else {
    const kN = ksTa(db, { keys: ['vift_notifications'] });
    rr = asUser(db, U.begransad, `update public.store set key = 'vift_notifications_x' where key = 'vift_notifications'`);
    ok(rr.ok && rr.count === 0 && ksDiff(kN, ksTa(db, { keys: ['vift_notifications'] })).length === 0, 'F18 + notisdelen: nyckelbyte av vift_notifications via REST → 0 rader (raden är dold för REST), inget ändrat', rr);
    rr = asUser(db, U.begransad, `update public.store set key = 'vift_lastChanged_x' where key = 'vift_lastChanged'`);
    ok(!rr.ok && rr.status === 403 && rr.code === '42501', 'F18: nyckelbyte via REST (synlig rad vift_lastChanged) → 42501', rr);
    const lcFore = val(db, 'vift_lastChanged');
    rr = asUser(db, U.begransad, `update public.store set value = '"1999-01-01T00:00:00.000Z"'::jsonb where key = 'vift_lastChanged'`);
    ok(!rr.ok && rr.status === 403 && rr.code === '42501' && val(db, 'vift_lastChanged') === lcFore, 'SEC-REST-02 / F18 + punkt 275: UPDATE av vift_lastChanged → 403 42501 (vitlistan avvecklad), värdet oförändrat', rr);
    rr = asUser(db, U.begransad, `update public.store set value = '{"smuggel":"data"}'::jsonb where key = 'vift_lastChanged'`);
    ok(!rr.ok && rr.code === '42501' && val(db, 'vift_lastChanged') === lcFore, 'F18 + punkt 275: inget data kan lagras i vift_lastChanged (42501)', rr);
    rr = asUser(db, U.begransad, `delete from public.store where key = 'vift_lastChanged'`);
    ok(!rr.ok && rr.status === 403 && rr.code === '42501' && val(db, 'vift_lastChanged') !== null, 'F18: DELETE av vift_lastChanged → 403 42501', rr);
    rr = asUser(db, U.falt, `insert into public.store(key, value) values ('vift_notifications', ${jlit([notis])}), ('vift_lastChanged', '"2026-11-28T08:00:00.000Z"'::jsonb) on conflict (key) do update set value = excluded.value`);
    ok(!rr.ok && rr.status === 403 && rr.code === '42501' && ksDiff(kN, ksTa(db, { keys: ['vift_notifications'] })).length === 0, 'F18 + punkt 275: v3.4/T3/T4-A-klientens persistNotifs-upsert (notiser + lastChanged) → 403 42501, inget ändrat (notiser via appendNotification)', rr);
    rr = asUser(db, U.falt2, `update public.store set value = ${jlit([Object.assign({}, notis, { message: 'ändrad' })])} where key = 'vift_notifications'`);
    ok(rr.ok && rr.count === 0 && ksDiff(kN, ksTa(db, { keys: ['vift_notifications'] })).length === 0, 'F18 + notisdelen: direkt ändring av notiser → 0 rader (dold), inget ändrat', rr);
  }
  rr = asUser(db, U.admin, `insert into public.store(key, value) values ('vift_staff', '[]'::jsonb) on conflict (key) do update set value = excluded.value`);
  ok(!rr.ok && rr.code === '42501' && st(A), 'F18: även superadmin (app_users.is_admin) nekas direkt REST-skrivning av vift_staff (store_admin_write_protected kan inte längre användas)', rr);
  rr = asUser(db, null, `insert into public.store(key, value) values ('vift_lastChanged', '"x"'::jsonb) on conflict (key) do update set value = excluded.value`);
  ok(!rr.ok && rr.status === 401 && rr.code === '42501', 'F18: anon nekas (401 42501)', rr);
  x = rpc(db, 'store_business_key_merge_write', { p_key: 'vift_customers', p_upserts: [{ id: 'CU-T3C', data: { id: 'CU-T3C', name: 'Syntetisk' }, previous: null }], p_removals: [], p_caller_authorized: true, p_actor_id: A });
  ok(!x.error && val(db, 'vift_customers').some((c) => c.id === 'CU-T3C'), 'F18: RPC-vägen (SECURITY DEFINER) och därmed alla Edge Functions skriver som tidigare', x.error);

  // ════════════════ SEC-REST-03/04: RPC-grants (inklusive T3-B:s nya signaturer) ════════════════
  const RPC_EF = ['work_order_patch(text,jsonb,text,text,text,text[])', /* T4-A: signaturerna har p_klient */ 'store_business_key_write(text,jsonb,text,boolean,text,jsonb)', 'store_business_key_merge_write(text,jsonb,jsonb,boolean,text,jsonb)',
    'sensitive_fields_write(text,text,jsonb,uuid,text)', 'time_entry_create(jsonb,text,text,text,uuid,text[])', 'work_order_pool_take(text,text,text[],text,text)', 'work_order_billing_set(text,text,text,text)',
    'deactivate_vift_user(uuid)', 'provision_vift_user(uuid,text,text,boolean)', 'vift_store_project(text,jsonb,text[],text)', 'store_read_all_with_hashes_projected(text[],text[],text)', '_vift_authz_check(text,jsonb,jsonb,jsonb,jsonb,text)', '_vift_superadmin_lock()'];
  const grantFel = RPC_EF.filter((f) => { const y = q(db, `select has_function_privilege('authenticated', 'public.${f}', 'EXECUTE') a, has_function_privilege('anon', 'public.${f}', 'EXECUTE') b, has_function_privilege('service_role', 'public.${f}', 'EXECUTE') c`)[0]; return y.a || y.b || !y.c; });
  ok(grantFel.length === 0, 'SEC-REST-03: work_order_patch, store_business_key_write/_merge_write, sensitive_fields_write, time_entry_create (T3-B:s nya signaturer) m.fl. har EXECUTE bara för service_role', grantFel);
  const definer = q(db, `select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))`).map((y) => y.f).sort();
  ok(JSON.stringify(definer) === JSON.stringify(['vift_caller_perms()', 'vift_store_full_access(text,text[])']), 'SEC-REST-03: bara de två RLS-hjälparna (SECURITY DEFINER) är körbara för authenticated, inga för anon', definer);
  const k3 = ksTa(db, KS);
  x = rpc(db, 'store_business_key_merge_write', { p_key: 'vift_staff', p_upserts: [{ id: F, data: med(st(F), { role: 'admin' }), previous: st(F) }], p_removals: [], p_caller_authorized: true, p_actor_id: F }, { as: 'authenticated', user: U.falt });
  ok(x.error && x.error.code === '42501' && ksDiff(k3, ksTa(db, KS)).length === 0, 'SEC-REST-03 (R): FÄ anropar rpc/store_business_key_merge_write direkt → 42501 (EXECUTE saknas), ingen mutation', x.error);
  x = rpc(db, 'work_order_patch', { p_ao_id: 'AO-A1', p_patch: { status: 'klar' }, p_idempotency_key: 'r3', p_expected_updated_at: null, p_caller_staff_id: F, p_caller_perms: ['all'] }, { as: 'authenticated', user: U.falt });
  ok(x.error && x.error.code === '42501', 'SEC-REST-03 (R): FÄ anropar rpc/work_order_patch (ny signatur) → 42501', x.error);
  x = rpc(db, 'time_entry_create', { p_entry: { id: 'TE-R3', aoId: 'AO-A8', minutes: 1 }, p_idempotency_key: 'r3t', p_client_id: '', p_caller_staff_id: F, p_caller_auth_id: U.falt.authId, p_caller_perms: ['all'] }, { as: 'authenticated', user: U.falt });
  ok(x.error && x.error.code === '42501', 'SEC-REST-03 (R): FÄ anropar rpc/time_entry_create (ny signatur) → 42501', x.error);
  x = rpc(db, 'sensitive_fields_write', { p_object_id: 'OBJ-R1', p_property_id: 'PROP-R1', p_fields: { doorCode: '1' }, p_user_id: U.falt.authId, p_user_email: U.falt.email }, { as: 'authenticated', user: U.falt });
  ok(x.error && x.error.code === '42501', 'SEC-REST-03 (R): FÄ anropar rpc/sensitive_fields_write → 42501', x.error);
  x = rpc(db, 'vift_caller_perms', {}, { as: 'authenticated', user: U.falt });
  ok(!x.error && JSON.stringify(x.data) === JSON.stringify(ro('personal').permissions), 'SEC-REST-04 (+): FÄ anropar rpc/vift_caller_perms → bara egna behörigheter', x);
  x = rpc(db, 'vift_caller_perms', {}, { as: 'anon' });
  ok(x.error && x.error.code === '42501', 'SEC-REST-04: anon får inte anropa vift_caller_perms', x.error);

  // ════════════════ Affärsflöden: admin hanterar personal och roller som tidigare ════════════════
  aterstall();
  await JA('flöde: superadmin skapar ny personal med rollen personal → 200', () => MW(U.admin, 'vift_staff', [{ id: 'ST-NY9', firstName: 'Ny', lastName: 'Person', email: 'ny9@example.test', role: 'personal', active: true, permissions: [] }]), STAFF);
  await JA('flöde: superadmin lägger till en behörighet i rollen chef → 200', () => MW(U.admin, 'vift_roles', [roll('chef', ro('chef').permissions.concat(['payroll_view']))]), ROLES);
  await JA('flöde: superadmin skapar och tar bort en egen roll → 200', async () => { await MW(U.admin, 'vift_roles', [{ id: 'tmp', label: 'Tmp', permissions: [] }]); return MW(U.admin, 'vift_roles', [], ['tmp']); }, ROLES);
  await JA('flöde: superadmin ändrar settings (annan nyckel, ingen T3-C-regel) → 200', () => W(U.admin, 'vift_settings', Object.assign({}, val(db, 'vift_settings'), { companyName: 'Syntetiskt AB' })), ['store:vift_settings'], { keys: ['vift_settings'] });

  r.stang();
  avsluta();
/* T4-A: en krasch räknas som fel (tidigare skrevs bara "FAIL krasch" och testet avslutades med 0 fel). */
})().catch((e) => { ok(false, 'krasch: ' + (e && e.stack || e)); avsluta(); });

/* app_users-raden är aktiv (hjälp). */
function one1(db, authId) { return q(db, `select active from public.app_users where user_id = ${lit(authId)}`)[0].active === true; }
