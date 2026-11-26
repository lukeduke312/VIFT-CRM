'use strict';
/*
 * T3-C (2026-11-28): roller och superadmin (SÄK-8, D-25), rollregistrets projektion (D-21,
 * D-14), direkt REST-skrivning (F18) och indragna behörigheter i befintliga sessioner —
 * webbläsartester mot den simulerade servern, som följer T3-C-reglerna (paritet med
 * vift-v2 20261128000004–05, tests/sim_parity.test.js).
 *
 * Varje negativt fall kontrollerar (1) serverns svar (status, error, reason) eller klientens
 * begripliga meddelande och (2) att den simulerade serverns personal- och rollregister är
 * oförändrade (kontrollsumma).
 *
 * Nivå: lokalt verifierad mot fake-backend.js. Inget här är verifierat i STAGING.
 */
const crypto = require('crypto');
const { PASSWORD } = require('../lib');

const ks = (fake) => crypto.createHash('md5').update(JSON.stringify([fake.get('staff'), fake.get('roles')])).digest('hex');
/* Lägg till en egen roll och en inloggning i den simulerade världen. */
function nyAnvandare(fake, alias, staffId, role) {
  const email = alias + '@example.test';
  const staff = fake.get('staff');
  staff.push({ id: staffId, firstName: 'Test', lastName: alias, email, username: alias, role, active: true, title: 'Testtitel', phone: '070-000 00 77' });
  fake.set('staff', staff);
  fake.users[email] = { id: 'uid-' + alias, email, password: PASSWORD, alias, active: true };
  return email;
}
function nyRoll(fake, id, perms) {
  const roles = fake.get('roles');
  roles.push({ id, label: 'Egen ' + id, isBuiltin: false, active: true, permissions: perms });
  fake.set('roles', roles);
}
const direkt = (s, body) => s.eval(async (b) => {
  const r = await fetch(SUPABASE_URL + '/functions/v1/store-key-write', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  let d = {}; try { d = await r.json(); } catch (e) {}
  return { status: r.status, error: d.error, reason: d.reason };
}, body);
const merge = (s, key, id, patch) => s.eval(async ([k, i, p]) => {
  const cur = (k === 'vift_staff' ? state.staff : state.roles).find((x) => x.id === i);
  const r = await fetch(SUPABASE_URL + '/functions/v1/store-key-write', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'writeMerge', key: k, upserts: [{ id: i, previous: cur, data: Object.assign({}, cur, p) }], removals: [] }) });
  let d = {}; try { d = await r.json(); } catch (e) {}
  return { status: r.status, error: d.error, reason: d.reason };
}, [key, id, patch]);

module.exports = [
  {
    id: 'T3C-01', module: 'Säkerhet', name: 'SÄK-8/SEC-ROLL-01/02 (klient): personalansvarig (bara staff_manage) erbjuds bara roller inom egna behörigheter, kan inte ändra egen roll eller superadministratören; serverns avslag visas begripligt och ändras tillbaka',
    async run(t) {
      nyRoll(t.fake, 'personalansvarig', ['dashboard_view', 'staff_view', 'staff_manage']);
      nyRoll(t.fake, 'tom', []);
      const email = nyAnvandare(t.fake, 'pa', 'ST-090', 'personalansvarig');
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login(email);
      await s.go('pg-staff');
      await s.settle(800);
      const form = async (id) => { const v = await s.eval((sid) => {
        Modal.closeAll(); StaffPage.openEdit(sid);
        const m = Array.from(document.querySelectorAll('.modal-sheet')).pop();
        return { ids: Array.from(m.querySelectorAll('[id^="sf-role-opt-"]')).map((x) => x.id.replace('sf-role-opt-', '')), email: m.querySelector('#sf-email').disabled,
          las: (m.querySelector('#sf-role-lock') || {}).textContent || '', inaktivera: Array.from(m.querySelectorAll('.modal-footer button')).some((b) => /Inaktivera|Aktivera/.test(b.textContent)) };
      }, id); await s.eval(() => Modal.closeAll()); return v; };
      const fa = await form('ST-002');
      const egen = await form('ST-090');
      const adm = await form('ST-001');
      const nytt = await s.eval(() => { Modal.closeAll(); StaffPage.openCreate(); const m = Array.from(document.querySelectorAll('.modal-sheet')).pop(); const ids = Array.from(m.querySelectorAll('[id^="sf-role-opt-"]')).map((x) => x.id.replace('sf-role-opt-', '')); const def = m.querySelector('#sf-role').value; Modal.closeAll(); return { ids, def }; });
      t.note(JSON.stringify({ fa, egen, adm, nytt }));
      t.assert(nytt.ids.slice().sort().join() === 'personalansvarig,tom' && nytt.ids.includes(nytt.def), 'ny personal: bara roller inom egna behörigheter (tom, personalansvarig), aldrig admin eller chef; förval bland dem: ' + JSON.stringify(nytt));
      t.assert(fa.ids.join() === 'personal' && fa.email === true && /utanför dina behörigheter/.test(fa.las) && !fa.inaktivera, 'fältarbetarens post (rollen personal syns inte, D-21): roll, e-post och status låsta med förklaring');
      t.assert(egen.ids.join() === 'personalansvarig' && /egen roll/.test(egen.las) && !egen.inaktivera, 'egen post: rollen låst med förklaring, ingen inaktivering');
      t.assert(adm.ids.join() === 'admin' && adm.email === true && !adm.inaktivera, 'superadministratörens post: låst, ingen Inaktivera-knapp');
      // Förbi gränssnittet: servern nekar och klienten visar begripligt besked och rullar tillbaka.
      const k0 = ks(t.fake);
      let r = await merge(s, 'vift_staff', 'ST-090', { role: 'admin' });
      t.assert(r.status === 403 && r.error === 'forbidden' && r.reason === 'privilege_escalation', 'direktanrop: egen roll → admin ger 403 privilege_escalation: ' + JSON.stringify(r));
      r = await merge(s, 'vift_staff', 'ST-002', { role: 'admin' });
      t.assert(r.status === 403 && r.error === 'forbidden' && r.reason === 'superadmin_required', 'direktanrop: annan får admin ger 403 superadmin_required: ' + JSON.stringify(r));
      r = await merge(s, 'vift_staff', 'ST-002', { role: 'chef' });
      t.assert(r.status === 403 && r.reason === 'privilege_escalation', 'direktanrop: annan får chef ger 403 privilege_escalation');
      await s.clearToasts();
      const res = await s.eval(() => commitElementChange('staff', 'ST-002', () => { const i = state.staff.findIndex((x) => x.id === 'ST-002'); state.staff[i] = Object.assign({}, state.staff[i], { role: 'chef' }); }, { ok: 'Sparat', fail: 'Kunde inte sparas' }));
      await s.settle(600);
      const toasts = (await s.toasts()).join(' | ');
      t.assert(res && res.ok === false && /behörigheter som du inte själv har/.test(toasts), 'klienten visar meddelandet för privilege_escalation: ' + toasts);
      t.assert(await s.eval(() => state.staff.find((x) => x.id === 'ST-002').role === 'personal'), 'ändringen rullas tillbaka lokalt');
      t.assert(ks(t.fake) === k0, 'personal- och rollregistret oförändrade på servern');
      r = await merge(s, 'vift_staff', 'ST-002', { role: 'tom' });
      t.assert(r.status === 200 && t.fake.get('staff').find((x) => x.id === 'ST-002').role === 'tom', 'tillåtet: tilldela rollen tom (inom egna behörigheter) → 200');
    },
  },
  {
    id: 'T3C-02', module: 'Säkerhet', name: 'SEC-ROLL-03/SEC-CUST-19 (klient): egen roll med bara admin_manage — rolleditorn erbjuder inte "Alla behörigheter", inte behörigheter man saknar och låser egen roll och superadminrollen; serverns superadmin_required visas begripligt',
    async run(t) {
      nyRoll(t.fake, 'adminhanterare', ['dashboard_view', 'admin_manage']);
      nyRoll(t.fake, 'tom', []);
      const email = nyAnvandare(t.fake, 'ah', 'ST-091', 'adminhanterare');
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login(email);
      await s.go('pg-admin');
      await s.settle(800);
      const v = await s.eval(() => {
        const top = () => Array.from(document.querySelectorAll('.modal-sheet')).pop();
        const cb = () => Object.fromEntries(Array.from(top().querySelectorAll('input[name="role-perm"]')).map((x) => [x.value, x.disabled]));
        const spara = () => Array.from(top().querySelectorAll('.modal-footer button')).some((b) => b.textContent.trim() === 'Spara');
        Modal.closeAll(); AdminPage.openEditRole('tom'); const tom = cb(); const tomSpara = spara(); Modal.closeAll();
        AdminPage.openEditRole('admin'); const adm = cb(); const admSpara = spara(); Modal.closeAll();
        AdminPage.openEditRole('adminhanterare'); const egen = cb(); Modal.closeAll();
        return { tom, tomSpara, adm, admSpara, egen, superA: Auth.isSuperadmin(), rollerAntal: state.roles.length };
      });
      t.assert(!v.superA, 'admin_manage är inte superadmin');
      t.assert(v.rollerAntal > 3, 'admin_manage ser hela rollregistret (SEC-B3-06)');
      t.assert(v.tom.all === true && v.tom.ao_view_all === true && v.tom.dashboard_view === false && v.tom.admin_manage === false && v.tomSpara, 'roll tom: "Alla behörigheter" och ao_view_all spärrade; egna behörigheter valbara');
      t.assert(Object.values(v.adm).every((d) => d === true) && !v.admSpara, 'roll admin (har all): helt låst, ingen Spara-knapp');
      t.assert(Object.values(v.egen).every((d) => d === true), 'egen roll: behörigheterna låsta');
      const k0 = ks(t.fake);
      const r = await merge(s, 'vift_roles', 'tom', { permissions: ['all'] });
      t.assert(r.status === 403 && r.error === 'forbidden' && r.reason === 'superadmin_required', 'direktanrop: all i rollen tom → 403 superadmin_required: ' + JSON.stringify(r));
      await s.clearToasts();
      await s.eval(() => commitElementChange('roles', 'tom', () => { const i = state.roles.findIndex((x) => x.id === 'tom'); state.roles[i] = Object.assign({}, state.roles[i], { permissions: ['all'] }); }, { ok: 'Sparat', fail: 'Kunde inte sparas' }));
      await s.settle(600);
      const toasts = (await s.toasts()).join(' | ');
      t.assert(/bara en superadministratör får tilldela/.test(toasts), 'klienten visar meddelandet för superadmin_required: ' + toasts);
      t.assert(ks(t.fake) === k0, 'rollregistret oförändrat på servern');
    },
  },
  {
    id: 'T3C-03', module: 'Säkerhet', name: 'SEC-ROLL-04 (klient): den enda superadministratören inaktiverar sig själv eller tar bort "Alla behörigheter" ur sin roll → servern svarar 409 last_superadmin, klienten förklarar och ingenting ändras',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-staff');
      await s.settle(800);
      const k0 = ks(t.fake);
      await s.clearToasts();
      await s.eval(() => StaffPage._toggleActive('ST-001'));
      await s.settle(1200);
      let toasts = (await s.toasts()).join(' | ');
      t.assert(/minst en aktiv superadministratör/.test(toasts), 'inaktivera sig själv: meddelandet för last_superadmin: ' + toasts);
      t.assert(await s.eval(() => state.staff.find((x) => x.id === 'ST-001').active === true), 'personalposten är fortfarande aktiv lokalt (tillbakarullad)');
      const r = await merge(s, 'vift_roles', 'admin', { permissions: ['admin_manage'] });
      t.assert(r.status === 409 && r.error === 'last_superadmin' && r.reason === undefined, 'direktanrop: all ur rollen admin → 409 last_superadmin: ' + JSON.stringify(r));
      t.assert(ks(t.fake) === k0, 'personal- och rollregistret oförändrade');
      t.assert(await s.eval(() => Auth.isSuperadmin() && Auth.canViewPage('pg-admin')), 'superadministratören har kvar sin åtkomst');
    },
  },
  {
    id: 'T3C-04', module: 'Säkerhet', name: 'D-21/D-14 (SEC-B3-02/03/05): fältarbetaren får bara sin egen roll och inte andras role/permissions — inloggning, Auth.can och menyn fungerar; arbetsledaren ser andras roll men inte rollregistret; direkt REST-läsning döljer registren',
    async run(t) {
      const f = await t.world.session({ viewport: 'iphone' });
      await f.login('falt');
      await f.settle(800);
      const v = await f.eval(async () => {
        const r = await fetch(SUPABASE_URL + '/rest/v1/store?select=key,value', { headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY } });
        const rest = (await r.json()).map((x) => x.key);
        return { roller: state.roles.map((x) => x.id), andraRole: state.staff.filter((x) => x.id !== 'ST-002').some((x) => 'role' in x || 'permissions' in x),
          egen: state.staff.find((x) => x.id === 'ST-002'), can: Auth.can('ao_time'), access: Auth.accessState(), meny: document.querySelectorAll('.nav-item, .mb-nav a, .sb-item').length,
          restStaff: rest.includes('vift_staff'), restRoles: rest.includes('vift_roles') };
      });
      t.note(JSON.stringify({ roller: v.roller, andraRole: v.andraRole, meny: v.meny }));
      t.assert(v.roller.length === 1 && v.roller[0] === 'personal', 'bara den egna effektiva rollen: ' + v.roller);
      t.assert(!v.andraRole, 'andras role och permissions saknas');
      t.assert(v.egen && v.egen.role === 'personal' && v.access === 'ok' && v.can === true, 'egen post med roll, åtkomst ok och Auth.can fungerar');
      t.assert(!v.restStaff && !v.restRoles, 'direkt REST-läsning: vift_staff och vift_roles döljs');
      const c = await t.world.session({ viewport: 'laptop' });
      await c.login('chef');
      await c.go('pg-staff');
      await c.settle(800);
      const w = await c.eval(() => ({ roller: state.roles.map((x) => x.id), role: state.staff.filter((x) => x.id !== 'ST-003').every((x) => 'role' in x && !('permissions' in x)), sida: Router.currentPage, fel: document.querySelectorAll('.page.active .empty').length }));
      t.assert(w.roller.length === 1 && w.roller[0] === 'chef' && w.role, 'arbetsledaren (staff_view): andras role men inte permissions, och bara sin egen roll');
      t.assert(w.sida === 'pg-staff', 'personalsidan fungerar för arbetsledaren');
      await c.go('pg-operations');
      await c.settle(600);
      t.assert(await c.eval(() => Router.currentPage === 'pg-operations' && !!document.getElementById('ops2-main')), 'Dagens drift fungerar med projicerat rollregister');
      const a = await t.world.session({ viewport: 'laptop' });
      await a.login('admin');
      await a.go('pg-admin');
      await a.settle(600);
      t.assert(await a.eval(() => state.roles.length >= 4 && state.staff.every((x) => 'role' in x)), 'superadministratören ser hela roll- och personalregistret');
    },
  },
  {
    id: 'T3C-05', module: 'Säkerhet', name: 'SEC-ROLL-08/09 (klient): egen superadminroll med annat id fungerar; roll med id "admin" UTAN "Alla behörigheter" ger inga superadminval',
    async run(t) {
      nyRoll(t.fake, 'superadmin2', ['all']);
      const staff = t.fake.get('staff'); staff.find((x) => x.id === 'ST-004').role = 'superadmin2'; t.fake.set('staff', staff);
      const roles = t.fake.get('roles'); roles.find((x) => x.id === 'admin').permissions = ['dashboard_view', 'admin_manage', 'staff_manage', 'staff_view']; t.fake.set('roles', roles);
      const s2 = await t.world.session({ viewport: 'laptop' });
      await s2.login('falt2');
      await s2.go('pg-admin');
      await s2.settle(600);
      const v2 = await s2.eval(() => { Modal.closeAll(); AdminPage.openEditRole('chef'); const all = Array.from(document.querySelectorAll('.modal-sheet')).pop().querySelector('input[name="role-perm"][value="all"]'); const d = all && all.disabled; Modal.closeAll(); return { superA: Auth.isSuperadmin(), allDisabled: d, admin: Auth.canViewPage('pg-admin') }; });
      t.assert(v2.superA && v2.admin && v2.allDisabled === false, 'SEC-ROLL-08: rollen superadmin2 (annat id) är superadmin och kan välja "Alla behörigheter"');
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-admin');
      await s.settle(600);
      const v = await s.eval(() => { Modal.closeAll(); AdminPage.openEditRole('chef'); const all = Array.from(document.querySelectorAll('.modal-sheet')).pop().querySelector('input[name="role-perm"][value="all"]'); const d = all && all.disabled; Modal.closeAll(); return { superA: Auth.isSuperadmin(), allDisabled: d, assignAdmin: Auth.canAssignRole('superadmin2') }; });
      t.assert(!v.superA && v.allDisabled === true && v.assignAdmin === false, 'SEC-ROLL-09: rollen admin utan all är inte superadmin; inga superadminval');
      const k0 = ks(t.fake);
      const r = await merge(s, 'vift_roles', 'chef', { permissions: ['all'] });
      t.assert(r.status === 403 && r.reason === 'superadmin_required' && ks(t.fake) === k0, 'SEC-ROLL-09: servern nekar (403 superadmin_required), ingen mutation');
    },
  },
  {
    id: 'T3C-06', world: { backend: { keyPerms: require('../server-key-perms.js'), activitiesPolicy: true, activityAppend: true } }, module: 'Säkerhet', name: 'Indragen behörighet (tillägget i BESLUT-2026-11-28): admin drar in en behörighet i rolleditorn — den redan inloggade fliken nekas vid nästa serveranrop och lämnar den otillåtna sidan',
    async run(t) {
      const c = await t.world.session({ viewport: 'laptop' });
      await c.login('chef');
      await c.go('pg-crm');
      await c.settle(800);
      await c.eval(() => DataSync.stop()); // den inloggade fliken får INTE upptäcka ändringen via synk — bara via serverns svar
      const a = await t.world.session({ viewport: 'laptop' });
      await a.login('admin');
      await a.go('pg-admin');
      await a.settle(600);
      await a.eval(() => { Modal.closeAll(); AdminPage.openEditRole('chef'); });
      await a.eval(() => { const cb = Array.from(document.querySelectorAll('.modal-sheet')).pop().querySelector('input[name="role-perm"][value="customer_manage"]'); cb.checked = false; });
      await a.eval(() => AdminPage._saveEditRole('chef'));
      await a.settle(1200);
      t.assert(!t.fake.get('roles').find((x) => x.id === 'chef').permissions.includes('customer_manage'), 'admin sparade indragningen via rolleditorn (servern bekräftade)');
      const kunder0 = JSON.stringify(t.fake.get('customers'));
      t.assert(await c.eval(() => Router.currentPage === 'pg-crm'), 'arbetsledarens flik står kvar på kundsidan före nästa serveranrop');
      // Nästa serveranrop görs av klienten själv (sparning av en kund via Storage → store-key-write).
      const n0 = t.fake.calls.length;
      await c.eval(() => { const id = state.customers[0].id; commitElementChange('customers', id, () => { const i = state.customers.findIndex((x) => x.id === id); state.customers[i] = Object.assign({}, state.customers[i], { name: 'Efter indragning' }); }, { ok: 'Sparat', fail: 'Kunde inte sparas' }); });
      await c.settle(800);
      const svar = t.fake.calls.slice(n0).filter((x) => x.action === 'store-key-write:writeMerge' && x.key === 'vift_customers').map((x) => x.status);
      t.assert(svar.length >= 1 && svar.every((x) => x === 403), 'nästa serveranrop från den inloggade fliken nekas med 403 (servern läser behörigheterna vid varje anrop): ' + svar);
      await c.page.waitForFunction(() => Router.currentPage !== 'pg-crm' && !Auth.can('customer_manage'), null, { timeout: 8000 });
      t.assert(JSON.stringify(t.fake.get('customers')) === kunder0, 'kundregistret oförändrat');
    },
  },
  {
    id: 'T3C-07', module: 'Säkerhet', name: 'F18 (SEC-REST-01/02, klient): direkt REST-skrivning av affärsnycklar och okända nycklar nekas med 42501 direct_write_blocked; T4-A notiser: vitlistan avvecklad (notiser + lastChanged nekas), notisvägen går via servern',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('falt');
      await s.settle(800);
      const k0 = JSON.stringify([t.fake.get('customers'), t.fake.get('staff')]);
      const r = await s.eval(async () => {
        const post = async (rows) => { const x = await fetch(SUPABASE_URL + '/rest/v1/store', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(rows) }); let d = {}; try { d = await x.json(); } catch (e) {} return { status: x.status, code: d.code, error: d.error }; };
        const del = async (key) => { const x = await fetch(SUPABASE_URL + '/rest/v1/store?key=eq.' + key, { method: 'DELETE', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY } }); let d = {}; try { d = await x.json(); } catch (e) {} return { status: x.status, code: d.code }; };
        return { kunder: await post([{ key: 'vift_customers', value: [] }]), personal: await post([{ key: 'vift_staff', value: [] }]), okand: await post([{ key: 'vift_e2e_t3c', value: { x: 1 } }]), radera: await del('vift_lastChanged') };
      });
      t.note(JSON.stringify(r));
      t.assert(['kunder', 'personal', 'okand', 'radera'].every((k) => r[k].status === 403 && r[k].code === '42501'), 'alla nekas med 403 42501 (direct_write_blocked)');
      t.assert(JSON.stringify([t.fake.get('customers'), t.fake.get('staff')]) === k0 && t.fake.get('e2e_t3c') === undefined, 'inga data ändrade, ingen ny nyckel');
      /* T4-A notiser (punkt 275): REST-vitlistan är avvecklad. Notiser går via store-key-write och en
         notis åt annan med okänd typ nekas av servern (NOTIF-02–06 prövar den säkra vägen). */
      const n0 = JSON.stringify(t.fake.get('notifications'));
      const rn = await s.eval(async () => { const x = await fetch(SUPABASE_URL + '/rest/v1/store', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify([{ key: 'vift_notifications', value: [] }, { key: 'vift_lastChanged', value: 'x' }]) }); let d = {}; try { d = await x.json(); } catch (e) {} return { status: x.status, code: d.code }; });
      t.assert(rn.status === 403 && rn.code === '42501', 'REST-skrivning av vift_notifications + vift_lastChanged nekas (403 42501, vitlistan avvecklad)');
      const a = await s.eval(() => NotificationsService.push('ST-004', 'info', 'T3C-07 syntetisk notis'));
      await s.settle(800);
      t.assert(a && a.ok === false && a.reason === 'type_not_allowed' && JSON.stringify(t.fake.get('notifications')) === n0, 'klientens notisväg går via servern: notis åt annan med okänd typ nekas (type_not_allowed), inget sparat');
    },
  },
];
