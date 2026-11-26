'use strict';
/*
 * T3-E (2026-11-28, M9): de fem standardrollerna i klienten mot den simulerade servern.
 * Seedens roller är exakt standardroller.json (vift-v2 supabase/manual/t3e_standardroller/,
 * BEHORIGHETSMATRIS §2); testkontona motsvarar standardrollerna (D-26).
 *
 *  T3E-01..05  meny, sidor och de viktigaste flödena per standardroll (admin, chef, ekonomi,
 *              personal, begransad); förväntan ur matrisen, inte ur rollnamnet.
 *  T3E-06      ej verkställda behörigheter (export_data m.fl.; time_view_all verkställd i T4-B) ger ingen
 *              meny, sida, knapp eller data: begransad med och utan dem är identisk i klienten;
 *              rolleditorn märker dem "verkställs i <paket>" och tappar inga okända behörigheter.
 *  T3E-07      indragen behörighet med standardrollen personal: admin tar bort ao_pool_take — den
 *              redan inloggade fliken (och en andra flik) nekas vid nästa serveranrop, poolen
 *              försvinner och den lokala cachen innehåller inga poolposter efter nästa läsning.
 *
 * Nivå: lokalt verifierad mot fake-backend.js. Inget här är verifierat i STAGING.
 */
const crypto = require('crypto');
const WORLD = { backend: { keyPerms: require('../server-key-perms.js'), activitiesPolicy: true, activityAppend: true } };
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex');

/* Menyn och sidorna som klienten faktiskt visar (Sidebar + Auth.canViewPage). */
const meny = (s) => s.eval(() => ({
  nav: Array.from(document.querySelectorAll('[id^="nav-pg-"]')).map((b) => b.id.replace('nav-', '')).sort(),
  sidor: Object.keys(Auth.PAGE_PERMISSIONS).filter((p) => Auth.canViewPage(p)).sort(),
}));
const har = (lista, sidor) => sidor.filter((p) => !lista.includes(p));
const saknar = (lista, sidor) => sidor.filter((p) => lista.includes(p));
const direkt = (s, ef, body) => s.eval(async ([e, b]) => {
  const r = await fetch(SUPABASE_URL + '/functions/v1/' + e, { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  let d = {}; try { d = await r.json(); } catch (x) {}
  return { status: r.status, error: d.error, reason: d.reason, body: d };
}, [ef, body]);

module.exports = [
  {
    id: 'T3E-01', world: WORLD, module: 'Säkerhet', name: 'Standardrollen admin (all): hela menyn inklusive admin och löner; rolleditorn visar alla behörigheter och märker de ej verkställda "verkställs i T4"',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.settle(800);
      const m = await meny(s);
      t.assert(har(m.sidor, ['pg-admin', 'pg-staff', 'pg-payroll', 'pg-reports', 'pg-invoices', 'pg-crm', 'pg-ao', 'pg-tid', 'pg-rondering']).length === 0, 'admin når alla sidor: ' + m.sidor.length);
      await s.go('pg-admin');
      await s.settle(600);
      const ed = await s.eval(() => {
        Modal.closeAll(); AdminPage.openEditRole('chef');
        const m2 = Array.from(document.querySelectorAll('.modal-sheet')).pop();
        const r = { rutor: Array.from(m2.querySelectorAll('input[name="role-perm"]')).map((x) => x.value), ikryssade: Array.from(m2.querySelectorAll('input[name="role-perm"]:checked')).map((x) => x.value).sort(),
          markta: Array.from(m2.querySelectorAll('[data-ej-verkstalld]')).map((x) => x.getAttribute('data-ej-verkstalld') + '=' + x.textContent.trim()).sort() };
        Modal.closeAll(); return r;
      });
      t.note(JSON.stringify(ed.markta));
      t.assert(ed.ikryssade.join() === (await s.eval(() => state.roles.find((r) => r.id === 'chef').permissions.slice().sort().join())), 'rolleditorn kryssar exakt standardrollen chefs behörigheter');
      /* T4-A (2026-11-28): cost_view, cost_edit, personal_data_view och bankgiro_edit är verkställda och inte längre märkta. */
      /* T4-B (2026-11-28): time_view_all är verkställd (K-01) och inte längre märkt. */
      t.assert(['export_data=verkställs i T4-F', 'ao_plan_own=verkställs i AO-etappen', 'rondering_utfor=verkställs i T4-D', 'objects_access_assigned=verkställs i T4-C', 'export_personal_data=verkställs i T4-F'].every((x) => ed.markta.includes(x)) && ed.markta.length === 5
        && !ed.markta.some((x) => /^(cost_view|cost_edit|personal_data_view|bankgiro_edit|time_view_all)=/.test(x)),
        'de fem ej verkställda behörigheterna är märkta med paketet (cost_view, cost_edit, personal_data_view och bankgiro_edit verkställda i T4-A, time_view_all i T4-B): ' + ed.markta.join(', '));
      t.assert(['customer_view', 'personal_data_view', 'bankgiro_edit', 'export_personal_data', 'objects_access_assigned', 'staff_contacts_view', 'activity_log_view_all'].every((p) => ed.rutor.includes(p)), 'katalogen innehåller även customer_view, personal_data_view, bankgiro_edit, export_personal_data, objects_access_assigned och (T4-A) staff_contacts_view och activity_log_view_all');
      // En roll med en behörighet som inte finns i katalogen: visas och sparas utan förlust.
      const roles = t.fake.get('roles'); roles.push({ id: 'egen_okand', label: 'Egen med okänd', isBuiltin: false, active: true, permissions: ['dashboard_view', 'framtida_behorighet'] }); t.fake.set('roles', roles);
      await s.eval(() => Auth.refreshAuthorization && Auth.refreshAuthorization());
      await s.settle(800);
      await s.eval(() => { Modal.closeAll(); AdminPage.openEditRole('egen_okand'); });
      const okand = await s.eval(() => { const m2 = Array.from(document.querySelectorAll('.modal-sheet')).pop(); const cb = m2.querySelector('input[name="role-perm"][value="framtida_behorighet"]'); return !!cb && cb.checked; });
      t.assert(okand, 'en behörighet som saknas i katalogen visas ikryssad i gruppen "Övriga behörigheter i rollen"');
      await s.eval(() => { document.getElementById('role-edit-desc').value = 'ändrad beskrivning'; return AdminPage._saveEditRole('egen_okand'); });
      await s.settle(1200);
      const sparad = t.fake.get('roles').find((r) => r.id === 'egen_okand');
      t.assert(sparad.description === 'ändrad beskrivning' && sparad.permissions.slice().sort().join() === 'dashboard_view,framtida_behorighet', 'Spara behåller den okända behörigheten (tidigare tappades behörigheter utanför katalogen tyst): ' + sparad.permissions.join(','));
    },
  },
  {
    id: 'T3E-02', world: WORLD, module: 'Säkerhet', name: 'Standardrollen chef (Arbetsledare): arbetsorder, kunder, offerter, fakturaunderlag (D-07), personal (läsa), rapporter (T3-E 5), inte löner eller admin; ser alla AO och lägger rad i fakturaunderlag',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await s.settle(800);
      const m = await meny(s);
      t.note(m.sidor.join(','));
      t.assert(har(m.sidor, ['pg-ao', 'pg-crm', 'pg-offer', 'pg-invoices', 'pg-sales', 'pg-recurring', 'pg-staff', 'pg-tid', 'pg-rondering', 'pg-calendar', 'pg-reports']).length === 0, 'chef når arbetsorder, kunder, offerter, fakturaunderlag, säljchanser, återkommande, personal, tid, rondering, kalender och (matrisändring T3-E 5, T4-A) rapporter');
      t.assert(saknar(m.sidor, ['pg-payroll', 'pg-admin', 'pg-articles']).length === 0, 'chef når inte löner (payroll_view), admin eller artiklar');
      t.assert(m.nav.every((p) => m.sidor.includes(p)), 'menyn visar bara sidor som chef får se');
      await s.go('pg-ao');
      await s.settle(600);
      const n = await s.eval(() => state.workOrders.length);
      t.assert(n === t.fake.get('workOrders').length, 'ao_view_all: alla arbetsorder i klienten (' + n + ')');
      const inv = t.fake.get('invoices').find((i) => i.status === 'utkast');
      const r = await direkt(s, 'invoice-write', { action: 'lineAdd', invoiceId: inv.id, expectedRevision: inv.revision || 0, line: { id: 'L-T3E-02', description: 'T3E', qty: 1, unitPrice: 1, vatRate: 25 } });
      t.assert(r.status === 200 && (t.fake.get('invoices').find((i) => i.id === inv.id).lines || []).some((l) => l.id === 'L-T3E-02'),
        'D-07 (beslutad ny behörighet för arbetsledaren): chef lägger en rad i ett utkast till fakturaunderlag via invoice-write: ' + JSON.stringify([r.status, r.error]));
    },
  },
  {
    id: 'T3E-03', world: WORLD, module: 'Säkerhet', name: 'Standardrollen ekonomi: fakturaunderlag, löner, rapporter och kunder (läsa); inte personal, admin eller tidregistrering; attest fungerar, kundändring nekas',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('ekonomi');
      await s.settle(800);
      const m = await meny(s);
      t.note(m.sidor.join(','));
      t.assert(har(m.sidor, ['pg-invoices', 'pg-payroll', 'pg-reports', 'pg-crm', 'pg-ao']).length === 0, 'ekonomi når fakturaunderlag, löner, rapporter, kunder (customer_view) och arbetsorder (ao_view_all)');
      t.assert(saknar(m.sidor, ['pg-admin', 'pg-staff', 'pg-tid', 'pg-offer', 'pg-objects']).length === 0, 'ekonomi når inte admin, personal, tid (ao_time), offerter eller objekt');
      await s.go('pg-payroll');
      await s.settle(800);
      t.assert(await s.eval(() => Router.currentPage === 'pg-payroll'), 'löneunderlaget öppnas');
      const k0 = md5(t.fake.get('customers'));
      const c = t.fake.get('customers')[0];
      const r = await direkt(s, 'store-key-write', { action: 'writeMerge', key: 'vift_customers', upserts: [{ id: c.id, previous: c, data: Object.assign({}, c, { name: 'x' }) }], removals: [] });
      t.assert(r.status === 403 && r.error === 'forbidden' && md5(t.fake.get('customers')) === k0, 'customer_view är läsning: kundändring → 403 forbidden, kundregistret oförändrat: ' + JSON.stringify([r.status, r.error]));
      const te = t.fake.get('timeEntries').find((x) => !x.attested);
      const ra = await direkt(s, 'ao-time-write', { action: 'attest_time', entryId: te.id, attested: true, idempotencyKey: 't3e-03-' + Date.now() });
      t.assert(ra.status === 200 && t.fake.get('timeEntries').find((x) => x.id === te.id).attested === true, 'D-08 (payroll_manage): ekonomi attesterar en tidpost: ' + JSON.stringify([ra.status, ra.error]));
    },
  },
  {
    id: 'T3E-04', world: WORLD, module: 'Säkerhet', name: 'Standardrollen personal: Mina jobb med öppen pool, tid och egna AO; inga kunder, fakturor eller admin; "Ta jobbet" bekräftas av servern; annans AO nekas med not_assigned',
    async run(t) {
      const s = await t.world.session({ viewport: 'mobile' });
      await s.login('falt');
      await s.settle(800);
      const m = await meny(s);
      t.note(m.sidor.join(','));
      t.assert(har(m.sidor, ['pg-myjobs', 'pg-tid', 'pg-ao', 'pg-dash']).length === 0, 'personal når Mina jobb, Tid, arbetsorder och dashboard');
      t.assert(saknar(m.sidor, ['pg-crm', 'pg-invoices', 'pg-offer', 'pg-admin', 'pg-staff', 'pg-payroll', 'pg-reports', 'pg-rondering']).length === 0, 'personal når inte kunder, fakturor, offerter, admin, personal, löner, rapporter eller rondering (rondering_utfor verkställs i T4-D)');
      await s.go('pg-myjobs');
      await s.settle(800);
      const pool = await s.eval(() => state.workOrders.filter((a) => WorkOrderService.isOpenPool(a)).map((a) => a.id));
      t.assert(pool.length > 0, 'öppen pool syns (ao_pool_take): ' + pool.join(','));
      const id = pool[0];
      await s.eval((x) => MyJobsPage.takeFromPool(x), id);
      await s.settle(1500);
      const a = t.fake.get('workOrders').find((y) => y.id === id);
      t.assert(JSON.stringify(a.staff) === JSON.stringify(['ST-002']), 'servern: jobbet taget av personal (ST-002): ' + JSON.stringify(a.staff));
      const annan = t.fake.get('workOrders').find((y) => (y.staff || []).length && !(y.staff || []).includes('ST-002') && !['klar', 'fakturerad', 'avbruten'].includes(y.status) && !y.archived && !y.deleted);
      const k0 = md5(t.fake.get('workOrders'));
      const r = await direkt(s, 'ao-time-write', { action: 'patch_ao', aoId: annan.id, patch: { status: 'klar' }, idempotencyKey: 't3e-04-' + Date.now() });
      t.assert(r.status === 403 && r.error === 'forbidden' && r.reason === 'not_assigned' && md5(t.fake.get('workOrders')) === k0, 'klarmarkering av annans AO → 403 forbidden/not_assigned, inga AO ändrade: ' + JSON.stringify([r.status, r.error, r.reason]));
    },
  },
  {
    id: 'T3E-05', world: WORLD, module: 'Säkerhet', name: 'Standardrollen begransad (D-04): bara egna tilldelade AO; ingen öppen pool, tid, kunder eller ekonomi; tagning och tid nekas av servern',
    async run(t) {
      const wo = t.fake.get('workOrders');
      const egen = wo.find((y) => (y.staff || []).length && !['klar', 'fakturerad', 'avbruten'].includes(y.status) && !y.archived && !y.deleted);
      egen.staff = (egen.staff || []).concat(['ST-005']);
      t.fake.set('workOrders', wo);
      const s = await t.world.session({ viewport: 'mobile' });
      await s.login('begransad');
      await s.settle(800);
      const m = await meny(s);
      t.note(m.sidor.join(','));
      t.assert(saknar(m.sidor, ['pg-tid', 'pg-crm', 'pg-invoices', 'pg-admin', 'pg-staff', 'pg-payroll', 'pg-reports', 'pg-offer', 'pg-rondering']).length === 0, 'begransad når inte tid, kunder, fakturor, admin, personal, löner, rapporter, offerter eller rondering');
      const ao = await s.eval(() => state.workOrders.map((a) => a.id).sort());
      const egna = t.fake.get('workOrders').filter((y) => (y.staff || []).includes('ST-005') && !y.archived && !y.deleted).map((y) => y.id).sort();
      t.assert(ao.join() === egna.join() && ao.includes(egen.id), 'klienten har exakt de egna tilldelade AO:na (' + egna.join(',') + '), ingen öppen pool och inga andras: ' + ao.join(','));
      const pool = wo.find((y) => y.status === 'pool' && !(y.staff || []).length);
      const k0 = md5(t.fake.get('workOrders'));
      let r = await direkt(s, 'ao-time-write', { action: 'take_from_pool', aoId: pool.id, idempotencyKey: 't3e-05a-' + Date.now() });
      t.assert(r.status === 403 && r.error === 'forbidden' && r.reason === undefined, 'tagning ur öppen pool → 403 forbidden: ' + JSON.stringify([r.status, r.error, r.reason]));
      r = await direkt(s, 'ao-time-write', { action: 'create_time', entry: { id: 'TE-T3E-05', aoId: egen.id, date: '2026-11-24', minutes: 30 }, idempotencyKey: 't3e-05b-' + Date.now() });
      t.assert(r.status === 403 && r.error === 'forbidden', 'tid på egen AO utan ao_time → 403 forbidden (kan tilldelas separat, D-04): ' + JSON.stringify([r.status, r.error]));
      t.assert(md5(t.fake.get('workOrders')) === k0, 'inga AO ändrade');
    },
  },
  {
    id: 'T3E-06', world: WORLD, module: 'Säkerhet', name: 'Ej verkställda behörigheter (tillägget i BESLUT-2026-11-28): begransad med de ej verkställda (export_data, objects_access_assigned m.fl.; T4-B: time_view_all verkställd och borttagen ur listan) får exakt samma meny, sidor, AO, personaluppgifter och lokala cache som utan dem',
    async run(t) {
      const ejv = require('../fake-backend.js').T3E_EJ_VERKSTALLDA;
      const fanga = async () => {
        const s = await t.world.session({ viewport: 'laptop' });
        await s.login('begransad');
        await s.settle(1000);
        const m = await meny(s);
        const v = await s.eval(() => ({ ao: state.workOrders.map((a) => a.id).sort(), staff: state.staff.map((x) => Object.keys(x).sort().join('+')).sort(), kunder: (state.customers || []).length,
          cache: Object.keys(localStorage).filter((k) => /vift_/.test(k)).sort(), exportKnapp: !!document.querySelector('[onclick*="showExportMenu"], [onclick*="ExportCenter"]') }));
        await s.eval(() => Auth.logout && Auth.logout());
        await s.settle(400);
        return Object.assign(m, v);
      };
      const utan = await fanga();
      const roles = t.fake.get('roles');
      const b = roles.find((r) => r.id === 'begransad');
      b.permissions = b.permissions.concat(ejv);
      t.fake.set('roles', roles);
      const med = await fanga();
      t.note(JSON.stringify({ utan: utan.sidor, med: med.sidor }));
      t.assert(JSON.stringify(med.sidor) === JSON.stringify(utan.sidor) && JSON.stringify(med.nav) === JSON.stringify(utan.nav), 'samma meny och sidor med och utan de ej verkställda behörigheterna (ingen exportsida, inga löner, ingen tid)');
      t.assert(JSON.stringify(med.ao) === JSON.stringify(utan.ao) && med.kunder === utan.kunder, 'samma arbetsorder och kunder');
      t.assert(JSON.stringify(med.staff) === JSON.stringify(utan.staff), 'samma personaluppgifter (servern räknar inte ej verkställda behörigheter: begransad förblir extern och får inga kollegors kontaktuppgifter)');
      t.assert(med.exportKnapp === utan.exportKnapp, 'ingen exportknapp tillkommer (export_data verkställs i T4-F)');
    },
  },
  {
    id: 'T3E-07', world: WORLD, module: 'Säkerhet', name: 'Indragen behörighet med standardrollen personal: admin tar bort ao_pool_take i rolleditorn — den inloggade fliken och en andra flik nekas vid nästa serveranrop, poolen försvinner ur tillståndet och cachen efter nästa läsning; ingen AO ändras',
    async run(t) {
      const f = await t.world.session({ viewport: 'mobile' });
      await f.login('falt');
      await f.go('pg-myjobs');
      await f.settle(1000);
      const pool0 = await f.eval(() => state.workOrders.filter((a) => WorkOrderService.isOpenPool(a)).map((a) => a.id));
      t.assert(pool0.length > 0, 'före: öppen pool synlig för personal: ' + pool0.join(','));
      await f.eval(() => DataSync.stop());
      // En andra flik för samma användare (samma webbläsarkontext: delad localStorage och session).
      const f2 = await t.world.tab(f);
      await f2.open();
      await f2.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id === 'ST-002', null, { timeout: 20000 });
      await f2.settle(800);
      await f2.eval(() => DataSync.stop());
      const a = await t.world.session({ viewport: 'laptop' });
      await a.login('admin');
      await a.go('pg-admin');
      await a.settle(600);
      await a.eval(() => { Modal.closeAll(); AdminPage.openEditRole('personal'); });
      await a.eval(() => { const cb = Array.from(document.querySelectorAll('.modal-sheet')).pop().querySelector('input[name="role-perm"][value="ao_pool_take"]'); cb.checked = false; });
      await a.eval(() => AdminPage._saveEditRole('personal'));
      await a.settle(1200);
      t.assert(!t.fake.get('roles').find((r) => r.id === 'personal').permissions.includes('ao_pool_take'), 'admin drog in ao_pool_take från standardrollen personal (servern bekräftade)');
      const k0 = md5(t.fake.get('workOrders'));
      const r = await direkt(f, 'ao-time-write', { action: 'take_from_pool', aoId: pool0[0], idempotencyKey: 't3e-07-' + Date.now() });
      t.assert(r.status === 403 && r.error === 'forbidden', 'nästa serveranrop från den redan inloggade fliken nekas (servern läser behörigheterna vid varje anrop): ' + JSON.stringify([r.status, r.error]));
      t.assert(md5(t.fake.get('workOrders')) === k0, 'inga AO ändrade');
      const r2 = await direkt(f2, 'ao-time-write', { action: 'take_from_pool', aoId: pool0[0], idempotencyKey: 't3e-07b-' + Date.now() });
      t.assert(r2.status === 403 && r2.error === 'forbidden' && md5(t.fake.get('workOrders')) === k0, 'samma i en andra flik: 403 forbidden, inga AO ändrade: ' + JSON.stringify([r2.status, r2.error]));
      // Nästa läsning (synk/omladdning av behörigheterna) tar bort poolen ur tillståndet och cachen.
      await f.eval(() => (Auth.refreshAuthorization ? Auth.refreshAuthorization() : null));
      await f.eval(() => (typeof DataSync !== 'undefined' && DataSync._poll ? DataSync._poll() : null));
      await f.settle(1500);
      const efter = await f.eval((POOL) => ({ pool: state.workOrders.filter((a) => WorkOrderService.isOpenPool(a)).map((a) => a.id), kan: Auth.can('ao_pool_take'),
        cache: (() => { const ut = []; for (const k of Object.keys(localStorage)) { const v = localStorage.getItem(k) || ''; if (/vift_/.test(k)) ut.push(...POOL.filter((id) => v.includes('"' + id + '"')).map((id) => k + ':' + id)); } return ut; })() }), pool0);
      t.note(JSON.stringify(efter));
      t.assert(!efter.kan && efter.pool.length === 0, 'efter nästa läsning: Auth.can(ao_pool_take) = false och ingen öppen pool i tillståndet');
      t.assert(efter.cache.length === 0, 'den lokala cachen (localStorage) innehåller inte längre de öppna poolposterna: ' + efter.cache.join(','));
    },
  },
];
