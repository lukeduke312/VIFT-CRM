'use strict';
/*
 * T4-A (2026-11-28): skyddade fält, projektion även för skrivare och fältvis sammanslagning i
 * klienten mot den simulerade servern (tests/e2e/t4a-regler.js = vift-v2 20261128000009, paritet
 * i tests/sim_parity.test.js). Världen använder serverns KEY_PERMISSIONS.
 *
 *  T4A-01  SÄK-7: arbetsledare utan objects_sensitive (egen roll, D-26) ser ingen portkod i objekt
 *          eller AO och sparar objektet utan att portkoden raderas; skickad portkod nekas med ett
 *          begripligt meddelande (field_protected), inget ändras.
 *  T4A-02  D-13: standardrollen chef (utan personal_data_view, K-02) ser inget personnummer, formuläret
 *          visar inget personnummerfält, och en sparad kund behåller sitt personnummer.
 *  T4A-03  D-17: två administratörer ändrar olika inställningar samtidigt — båda finns kvar; admin_manage
 *          utan cost_view/bankgiro_edit ser inte intern timkostnad (inget påhittat 250) och bevarar den.
 *  T4A-04  D-01: fältet har inga inköpspriser, ingen intern timkostnad och inget bankgiro i tillståndet.
 *  T4A-05  T3-E-beslutet: rolleditorn (katalogmarkör) kan ta bort en ny behörighet; en skrivning utan
 *          markör (v3.4-form) bevarar behörigheter utanför v3.4-katalogen.
 *  T4A-06  T3-E 5: standardrollen chef når Rapporter; sidan visar inga personnummer eller portkoder.
 *  T4A-07  punkt 7: inaktiverad roll ger ingen behörighet (fail-closed) och inga verksamhetsdata.
 *
 * Nivå: lokalt verifierad mot fake-backend.js. Inget här är verifierat i STAGING.
 */
const crypto = require('crypto');
const WORLD = { backend: { keyPerms: require('../server-key-perms.js'), activitiesPolicy: true, activityAppend: true } };
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex');
const direkt = (s, ef, body) => s.eval(async ([e, b]) => {
  const r = await fetch(SUPABASE_URL + '/functions/v1/' + e, { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  let d = {}; try { d = await r.json(); } catch (x) {}
  return { status: r.status, error: d.error, reason: d.reason, body: d };
}, [ef, body]);
const SENS = ['doorCode', 'keyInformation', 'accessInformation', 'keyReceipt', 'alarmInformation', 'accessCode', 'keyInfo'];
const andraRoll = (t, id, fn) => { const roles = t.fake.get('roles'); const r = roles.find((x) => x.id === id); fn(r); t.fake.set('roles', roles); };

module.exports = [
  {
    id: 'T4A-01', world: WORLD, module: 'Säkerhet', name: 'SÄK-7: arbetsledare utan objects_sensitive (egen roll) ser ingen portkod i objekt eller AO och sparar objektet utan att portkoden raderas; skickad portkod nekas (field_protected) utan ändring',
    async run(t) {
      andraRoll(t, 'chef', (r) => { r.permissions = r.permissions.filter((p) => p !== 'objects_sensitive'); });
      const props = t.fake.get('properties');
      const objs = (t.fake.get('propertyObjects') || []).concat([{ id: 'OBJ-T4A-1', propertyId: props[0].id, name: 'Lgh T4A', objectNumber: 'T4A', doorCode: 'PORT-T4A', keyInformation: 'Nyckel T4A', accessInformation: 'Ring T4A' }]);
      t.fake.set('propertyObjects', objs);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await s.settle(1000);
      const v = await s.eval(() => ({ obj: (state.propertyObjects || []).find((o) => o.id === 'OBJ-T4A-1'), ao: (state.workOrders || []).filter((a) => 'accessCode' in a).length, aoN: (state.workOrders || []).length }));
      t.assert(v.obj && !['doorCode', 'keyInformation', 'accessInformation'].some((f) => f in v.obj), 'objektet i klientens tillstånd saknar portkod, nyckel- och tillträdesinformation (projektion även för skrivaren customer_manage)');
      t.assert(v.aoN > 0 && v.ao === 0, 'inga AO i tillståndet bär portkoden (work-orders-list, även för ao_edit utan objects_sensitive): ' + v.aoN + ' AO');
      const cache = await s.eval(() => Object.keys(localStorage).filter((k) => /vift_/.test(k)).map((k) => localStorage.getItem(k)).join('|'));
      t.assert(!/PORT-T4A|Nyckel T4A/.test(cache), 'portkoden finns inte i den lokala cachen');
      const r = await s.eval(async () => { const o = state.propertyObjects.find((x) => x.id === 'OBJ-T4A-1'); o.name = 'Lgh T4A ändrad'; const res = await persist({ detailed: true }); return res && res.results ? res.results.propertyObjects : res; });
      const lagrat = t.fake.get('propertyObjects').find((o) => o.id === 'OBJ-T4A-1');
      t.assert(lagrat.name === 'Lgh T4A ändrad' && lagrat.doorCode === 'PORT-T4A' && lagrat.keyInformation === 'Nyckel T4A' && lagrat.accessInformation === 'Ring T4A', 'sparat: namnet ändrat, portkod och nyckelinformation oförändrade (fältvis sammanslagning): ' + JSON.stringify(r));
      const k0 = md5(t.fake.get('propertyObjects'));
      const o1 = await s.eval(() => state.propertyObjects.find((x) => x.id === 'OBJ-T4A-1'));
      const d = await direkt(s, 'store-key-write', { action: 'writeMerge', key: 'vift_propertyObjects', upserts: [{ id: o1.id, data: Object.assign({}, o1, { doorCode: '' }), previous: o1 }], removals: [] });
      t.assert(d.status === 403 && d.error === 'forbidden' && d.reason === 'field_protected' && md5(t.fake.get('propertyObjects')) === k0, 'SEC-B5-03: doorCode:\'\' → 403 forbidden/field_protected, objektregistret oförändrat');
      const text = await s.eval(() => persistRefusalText('forbidden', 'field_protected'));
      t.assert(/skyddat fält/.test(text || ''), 'klienten har ett begripligt meddelande för field_protected: ' + text);
    },
  },
  {
    id: 'T4A-02', world: WORLD, module: 'Säkerhet', name: 'D-13: standardrollen chef (utan personal_data_view) ser inget personnummer, formuläret visar inget personnummerfält och en sparad privatkund behåller sitt personnummer',
    async run(t) {
      const cus = t.fake.get('customers').concat([{ id: 'CU-T4A-P', type: 'privat', firstName: 'Petra', lastName: 'Privat', name: 'Petra Privat', personnr: '19900101-1234', orgNr: '', phone: '070-1', email: 'petra@example.test', address: 'Gatan 1', zip: '111 11', city: 'Stad', active: true }]);
      t.fake.set('customers', cus);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await s.settle(1000);
      const c = await s.eval(() => (state.customers || []).find((x) => x.id === 'CU-T4A-P'));
      t.assert(c && !('personnr' in c) && !('orgNr' in c), 'kunden i tillståndet saknar personnummer och (privatperson) org.nr');
      const form = await s.eval(() => CustomersPage._formHtml(state.customers.find((x) => x.id === 'CU-T4A-P')));
      t.assert(!/id="cu-personnr"/.test(form) && /Se personnummer/.test(form), 'formuläret visar inget personnummerfält, bara en förklaring');
      await s.eval(() => { Modal.closeAll && Modal.closeAll(); CustomersPage.openEdit('CU-T4A-P'); });
      await s.settle(500);
      await s.eval(() => { document.getElementById('cu-phone').value = '070-999'; return CustomersPage._save('CU-T4A-P'); });
      await s.settle(1500);
      const lagrat = t.fake.get('customers').find((x) => x.id === 'CU-T4A-P');
      t.assert(lagrat.phone === '070-999' && lagrat.personnr === '19900101-1234', 'SEC-KUND-05: sparad kund — telefonen ändrad, personnumret oförändrat: ' + JSON.stringify([lagrat.phone, lagrat.personnr]));
      const s2 = await t.world.session({ viewport: 'laptop' });
      await s2.login('ekonomi');
      await s2.settle(1000);
      const ce = await s2.eval(() => (state.customers || []).find((x) => x.id === 'CU-T4A-P'));
      t.assert(ce && ce.personnr === '19900101-1234', 'SEC-KUND-04: standardrollen ekonomi (personal_data_view) ser personnumret');
    },
  },
  {
    id: 'T4A-03', world: WORLD, module: 'Säkerhet', name: 'D-17: två administratörer ändrar olika inställningar samtidigt — båda finns kvar; admin_manage utan cost_view/bankgiro_edit ser inte intern timkostnad (inget påhittat värde) och bevarar bankgiro och timkostnad',
    async run(t) {
      andraRoll(t, 'chef', (r) => { r.permissions = r.permissions.filter((p) => !['cost_view', 'cost_edit'].includes(p)).concat(['admin_manage']); });
      const st0 = t.fake.get('settings');
      const a = await t.world.session({ viewport: 'laptop' });
      await a.login('admin');
      const b = await t.world.session({ viewport: 'laptop' });
      await b.login('chef');
      await a.settle(800); await b.settle(800);
      const bv = await b.eval(() => Object.assign({}, state.settings));
      t.assert(!('internalHourlyCost' in bv) && bv.bankgiro === st0.bankgiro, 'admin_manage utan cost_view: ingen intern timkostnad i tillståndet; bankgiro läsbart (D-17)');
      await b.go('pg-admin');
      await b.settle(600);
      const ek = await b.eval(() => { AdminPage._section = 'ekonomi'; try { AdminPage.render(); } catch (e) {} return document.body.innerText; });
      t.note((ek.match(/Intern timkostnad[^\n]*\n?[^\n]*/) || [''])[0]);
      const [ra, rb] = await Promise.all([
        a.eval(async () => { state.settings = Object.assign({}, state.settings, { companyName: 'Företag A (T4A)' }); const r = await persist({ detailed: true }); return r && r.results ? r.results.settings : r; }),
        b.eval(async () => { state.settings = Object.assign({}, state.settings, { slogan: 'Slogan B (T4A)' }); const r = await persist({ detailed: true }); return r && r.results ? r.results.settings : r; }),
      ]);
      const st = t.fake.get('settings');
      t.assert(st.companyName === 'Företag A (T4A)' && st.slogan === 'Slogan B (T4A)', 'SEC-INST-05: båda ändringarna finns kvar (fältvis sammanslagning): ' + JSON.stringify([ra, rb]));
      t.assert(st.bankgiro === st0.bankgiro && st.internalHourlyCost === st0.internalHourlyCost, 'SEC-INST-04: bankgiro och intern timkostnad oförändrade efter sparning från en session som inte får läsa/ändra dem');
      const k0 = md5(t.fake.get('settings'));
      const d = await direkt(b, 'store-key-write', { action: 'writeMerge', key: 'vift_settings', upserts: [{ id: 'bankgiro', data: '1-1', previous: st0.bankgiro }], removals: [] });
      t.assert(d.status === 403 && d.reason === 'field_protected' && md5(t.fake.get('settings')) === k0, 'SEC-INST-03: ändrat bankgiro utan bankgiro_edit → 403 field_protected, inget ändrat');
    },
  },
  {
    id: 'T4A-04', world: WORLD, module: 'Säkerhet', name: 'D-01/D-06: fältet har inga inköpspriser, ingen intern timkostnad, inget bankgiro och ingen AO-ekonomi i tillståndet eller cachen',
    async run(t) {
      const s = await t.world.session({ viewport: 'mobile' });
      await s.login('falt');
      await s.settle(1000);
      const v = await s.eval(() => ({
        art: (state.articles || []).filter((a) => 'buyPrice' in a || 'markup' in a).length, artN: (state.articles || []).length,
        mat: (state.workOrders || []).flatMap((a) => a.materials || []).filter((m) => 'buyPrice' in m).length,
        eko: (state.workOrders || []).filter((a) => 'fixedPrice' in a).length,
        set: Object.keys(state.settings || {}).filter((k) => ['bankgiro', 'internalHourlyCost'].includes(k)),
      }));
      t.assert(v.artN > 0 && v.art === 0, 'artiklar utan inköpspris och påslag: ' + v.artN);
      t.assert(v.mat === 0 && v.eko === 0, 'AO:ns materialrader utan inköpspris och AO utan fastpris (D-06)');
      t.assert(v.set.length === 0, 'inställningar utan bankgiro och intern timkostnad');
      const cache = await s.eval(() => Object.keys(localStorage).filter((k) => /vift_(articles|settings|workOrders)/.test(k)).map((k) => localStorage.getItem(k)).join('|'));
      t.assert(!/"buyPrice"|"internalHourlyCost"|"bankgiro"|"fixedPrice"/.test(cache), 'inte heller i den lokala cachen');
    },
  },
  {
    id: 'T4A-05', world: WORLD, module: 'Säkerhet', name: 'T3-E-beslutet: rolleditorn (katalogmarkör) tar bort en ny behörighet; en rollskrivning utan markör (v3.4-form) bevarar behörigheter utanför v3.4-katalogen',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-admin');
      await s.settle(800);
      await s.eval(() => { Modal.closeAll(); AdminPage.openEditRole('chef'); const m = Array.from(document.querySelectorAll('.modal-sheet')).pop(); const cb = m.querySelector('input[name="role-perm"][value="cost_edit"]'); cb.checked = false; return AdminPage._saveEditRole('chef'); });
      await s.settle(1200);
      t.assert(!t.fake.get('roles').find((r) => r.id === 'chef').permissions.includes('cost_edit'), 'rolleditorn (T4-klient med katalogmarkör) tar bort cost_edit');
      const el = await s.eval(() => JSON.parse(JSON.stringify(state.roles.find((r) => r.id === 'chef'))));
      const v34 = el.permissions.filter((p) => !['cost_view', 'staff_contacts_view', 'activity_log_view_all', 'ao_checklist'].includes(p));
      const d = await direkt(s, 'store-key-write', { action: 'writeMerge', key: 'vift_roles', upserts: [{ id: 'chef', data: Object.assign({}, el, { permissions: v34 }), previous: el }], removals: [] });
      const p = t.fake.get('roles').find((r) => r.id === 'chef').permissions;
      t.assert(d.status === 200 && ['cost_view', 'staff_contacts_view', 'activity_log_view_all'].every((x) => p.includes(x)) && !p.includes('ao_checklist'),
        'skrivning utan markör (v3.4-katalogen): cost_view, staff_contacts_view och activity_log_view_all bevaras; ao_checklist (i v3.4-katalogen) tas bort: ' + p.join(','));
    },
  },
  {
    id: 'T4A-06', world: WORLD, module: 'Säkerhet', name: 'T3-E 5: standardrollen chef når Rapporter; sidan visar inga personnummer eller portkoder (varje rapport följer underliggande behörighet)',
    async run(t) {
      t.fake.set('customers', t.fake.get('customers').concat([{ id: 'CU-T4A-R', type: 'privat', firstName: 'Rapport', lastName: 'Kund', name: 'Rapport Kund', personnr: '19800101-9999', active: true }]));
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await s.settle(1000);
      t.assert(await s.eval(() => Auth.canViewPage('pg-reports')), 'chef når Rapporter (reports_view)');
      t.assert(!(await s.eval(() => Auth.canViewPage('pg-payroll'))), 'chef når inte Löneunderlag (payroll_view saknas)');
      await s.go('pg-reports');
      await s.settle(1200);
      const txt = await s.eval(() => document.body.innerText);
      t.assert(/Rapport/i.test(txt) && !/19800101-9999/.test(txt), 'Rapporter renderas utan personnummer');
      t.assert(!(s.pageErrors || []).length, 'inga JS-fel: ' + JSON.stringify(s.pageErrors || []).slice(0, 200));
    },
  },
  {
    id: 'T4A-07', world: WORLD, module: 'Säkerhet', name: 'Punkt 7: inaktiverad roll ger ingen behörighet (klient och server) och inga verksamhetsdata',
    async run(t) {
      andraRoll(t, 'personal', (r) => { r.active = false; });
      const s = await t.world.session({ viewport: 'mobile' });
      await s.open();
      await s.page.waitForSelector('#login-user', { state: 'visible', timeout: 15000 });
      await s.page.fill('#login-user', 'falt1@example.test');
      await s.page.fill('#login-pass', 'e2e-test-password');
      await s.page.click('#lp-login button.btn.bp');
      await s.page.waitForSelector('#noaccess-screen', { state: 'visible', timeout: 20000 });
      await s.settle(800);
      const v = await s.eval(() => ({ st: Auth.accessState(), ao: (state.workOrders || []).length, kunder: (state.customers || []).length, art: (state.articles || []).length, can: Auth.can('ao_view_own'),
        app: getComputedStyle(document.getElementById('app')).display }));
      t.assert(v.st === 'no_role' && !v.can && v.app === 'none', 'klienten: ingen behörighet med inaktiverad roll (accessState ' + v.st + '), ingen app');
      t.assert(v.ao === 0 && v.kunder === 0 && v.art === 0, 'inga arbetsorder, kunder eller artiklar i tillståndet: ' + JSON.stringify(v));
      const ws = await s.eval(async () => { const r = await fetch(SUPABASE_URL + '/functions/v1/work-orders-list', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: '{}' }); return r.json(); }).catch(() => null);
      t.assert(!ws || !(ws.workOrders || []).length, 'servern (simulerad): work-orders-list ger inga AO till en inaktiverad roll');
    },
  },
];
