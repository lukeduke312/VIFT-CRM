'use strict';
/*
 * T4-A, tilläggsdel NOTISER (2026-11-28; punkt 275, beslutets punkt 7, AP-D) i klienten mot den
 * simulerade servern (fake-backend.js = vift-v2 20261128000010 + store-key-write
 * appendNotification/markNotificationsRead; paritet i tests/sim_parity.test.js).
 *
 *  NOTIF-02  Tilldelningsnotis: arbetsledaren lägger till fältpersonal i personaldialogen och i
 *            bulkåtgärden — notisen skapas av servern först efter serverbekräftad tilldelning
 *            (avsändare och tid satta av servern, text ur AO:n) och syns bara för mottagaren.
 *  NOTIF-03  Egen markering: "markera lästa" ändrar bara de egna notiserna på servern; andras
 *            notiser är orörda; användarens andra enhet ser dem lästa.
 *  NOTIF-04  Nekad notis åt annan: fältpersonal (utan ao_edit) kan inte skapa en notis åt en kollega
 *            (403 type_not_allowed), inte heller en egen påminnelse åt annan (recipient_not_allowed)
 *            eller via den gamla REST-vägen (42501); inget ändras.
 *  NOTIF-05  Andras notiser når inte klienten: tillståndet, den lokala cachen och REST-läsningen
 *            innehåller bara egna notiser — även för superadmin; äldre poster utan mottagare syns inte.
 *  NOTIF-06  Gammal klient (v3.4/T3/T4-A persistNotifs i Service Worker-cache): REST-upserten av
 *            notiser + lastChanged nekas utan dataförlust, och tilldelning, uppgifter och AO
 *            fungerar ändå.
 *
 * Nivå: lokalt verifierad mot fake-backend.js. Inget här är verifierat i STAGING.
 */
const crypto = require('crypto');
const WORLD = { backend: { keyPerms: require('../server-key-perms.js'), activitiesPolicy: true, activityAppend: true } };
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v === undefined ? null : v)).digest('hex');
const STAFF = { admin: 'ST-001', chef: 'ST-003', falt: 'ST-002', falt2: 'ST-004' };
const T0 = '2026-11-20T08:00:00.000Z';
const N = (id, userId, extra) => Object.assign({ id, userId, type: 'ao_assigned', message: 'Seed ' + id, aoId: '', offerId: '', read: false, createdAt: T0 }, extra || {});
function seedNotiser(t) {
  t.fake.set('notifications', [
    N('N-E2E-F', STAFF.falt, { aoId: 'AO-001', message: 'Du har tilldelats AO-001: Läckage balkong vån 3' }),
    N('N-E2E-F2', STAFF.falt2, { aoId: 'AO-015', message: 'HEMLIG-F2: ring kunden 070-000 00 00' }),
    N('N-E2E-C', STAFF.chef, { type: 'offer_approved', offerId: 'OFF-001', message: 'HEMLIG-CHEF: offert godkänd av kunden' }),
    N('N-E2E-A', STAFF.admin, { type: 'service_done', message: 'HEMLIG-ADMIN: egen påminnelse' }),
    { id: 'N-E2E-OLD', type: 'info', message: 'HEMLIG-OLD: äldre notis utan mottagare', read: false, createdAt: T0 },
  ]);
}
const direkt = (s, body) => s.eval(async (b) => {
  const r = await fetch(SUPABASE_URL + '/functions/v1/store-key-write', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  let d = {}; try { d = await r.json(); } catch (x) {}
  return { status: r.status, error: d.error, reason: d.reason, body: d };
}, body);
/* v3.4/T3/T4-A-klientens persistNotifs: en direkt REST-upsert av [notiser, lastChanged]. */
const gammalPersist = (s, lista) => s.eval(async (l) => {
  const r = await fetch(SUPABASE_URL + '/rest/v1/store', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ key: 'vift_notifications', value: l }, { key: 'vift_lastChanged', value: new Date().toISOString() }]) });
  let d = {}; try { d = await r.json(); } catch (x) {}
  return { status: r.status, code: d.code };
}, lista);
async function vanta(t, pred, ms) { const slut = Date.now() + (ms || 8000); while (Date.now() < slut) { if (pred()) return true; await new Promise((r) => setTimeout(r, 150)); } return pred(); }
async function openAO(s, id) {
  await s.go('pg-ao-detail', { aoId: id });
  await s.page.waitForFunction((x) => WorkOrderDetailPage.aoId === x && document.querySelector('.page.active .aod-actbar'), id, { timeout: 8000 });
}

module.exports = [
  {
    id: 'NOTIF-02', kind: 'workflow', world: WORLD, module: 'Notiser', name: 'Tilldelningsnotis: personaldialogen och bulkåtgärden — servern skapar notisen efter bekräftad tilldelning (avsändare, tid och text satta av servern) och bara mottagaren ser den',
    async run(t) {
      seedNotiser(t);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await openAO(s, 'AO-006');
      await s.eval(() => WorkOrderDetailPage.manageStaff('AO-006'));
      await s.page.waitForSelector('.modal-overlay.open #sm-resp');
      await s.page.check('#smcb-' + STAFF.falt);
      await s.clickModalButton(/^Spara$/);
      await s.waitToast(/Personal uppdaterad/, 8000);
      const finns = () => (t.fake.get('notifications') || []).find((n) => n.userId === STAFF.falt && n.aoId === 'AO-006');
      t.assert(await vanta(t, () => !!finns()), 'servern har skapat tilldelningsnotisen för AO-006');
      const n = finns();
      t.assert(n.createdBy === STAFF.chef && n.source === 'server' && n.read === false && /^Du har tilldelats AO-006: /.test(n.message) && (t.fake.get('workOrders').find((a) => a.id === 'AO-006').staff || []).includes(STAFF.falt),
        'avsändare (chefen), källa, läsläge och text satta av servern; fältet är faktiskt tilldelat: ' + JSON.stringify(n));
      t.assert(!(await s.eval(() => (state.notifications || []).some((x) => x.userId !== state.currentUser.id))), 'chefens klient håller inga andras notiser (inte heller den nyss skapade)');
      // Bulkåtgärden: notis först efter bulkPatch → succeeded.
      await s.go('pg-ao');
      const r = await s.eval(() => WorkOrdersPage._bulkAddStaff(['AO-003'], ['ST-004']));
      t.assert(r.ok && r.updated === 1, 'bulk: AO-003 fick ny personal');
      const bulk = () => (t.fake.get('notifications') || []).find((x) => x.userId === STAFF.falt2 && x.aoId === 'AO-003');
      t.assert(await vanta(t, () => !!bulk()), 'bulk: tilldelningsnotisen skapad efter serverbekräftelsen');
      t.assert((t.fake.get('workOrders').find((a) => a.id === 'AO-003').staff || []).includes(STAFF.falt2) && bulk().createdBy === STAFF.chef, 'bulk: notisen hör till en faktisk tilldelning');
      // Mottagaren ser notisen; ingen annan.
      const f = await t.world.session({ viewport: 'iphone' });
      await f.login('falt');
      const fn = await f.eval(() => ({ ids: (state.notifications || []).map((x) => x.id), olasta: NotificationsService.unreadCount() }));
      t.assert(fn.ids.includes(n.id) && fn.olasta >= 2 && !fn.ids.includes(bulk().id), 'fältet ser sin nya notis (och inte FÄ2:s från bulkåtgärden): ' + JSON.stringify(fn));
      await f.context.close(); await s.context.close();
    },
  },
  {
    id: 'NOTIF-03', kind: 'workflow', world: WORLD, module: 'Notiser', name: 'Egen markering: notispanelen markerar bara de egna notiserna lästa på servern; andras är orörda; andra enheten ser dem lästa',
    async run(t) {
      seedNotiser(t);
      const andras0 = md5((t.fake.get('notifications') || []).filter((n) => n.userId !== STAFF.falt));
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('falt');
      t.assert(await s.eval(() => NotificationsService.unreadCount()) === 1, 'en oläst egen notis');
      await s.page.locator('.nav-bell-row').first().click().catch(async () => s.eval(() => NotificationsService.showPanel()));
      await s.page.waitForSelector('.modal-overlay.open');
      t.assert(/Du har tilldelats AO-001/.test(await s.text('.modal-overlay.open')) && !/HEMLIG/.test(await s.text('.modal-overlay.open')), 'panelen visar den egna notisen och inga andras');
      t.assert(await vanta(t, () => (t.fake.get('notifications') || []).find((n) => n.id === 'N-E2E-F').read === true), 'servern: den egna notisen markerad läst');
      t.assert(md5((t.fake.get('notifications') || []).filter((n) => n.userId !== STAFF.falt)) === andras0, 'servern: andras notiser (FÄ2, chef, admin, äldre) oförändrade');
      const d = await direkt(s, { action: 'markNotificationsRead', ids: ['N-E2E-F2', 'N-E2E-C', 'N-E2E-OLD'] });
      t.assert(d.status === 200 && d.body.marked === 0 && d.body.ignored === 3 && md5((t.fake.get('notifications') || []).filter((n) => n.userId !== STAFF.falt)) === andras0, 'direkt försök att markera andras id: 200 marked 0, ignored 3, inget ändrat');
      const s2 = await t.world.session({ viewport: 'iphone' });
      await s2.login('falt');
      t.assert(await s2.eval(() => NotificationsService.unreadCount()) === 0, 'andra enheten: notisen är läst');
      await s2.context.close(); await s.context.close();
    },
  },
  {
    id: 'NOTIF-04', kind: 'security', world: WORLD, module: 'Notiser', name: 'Nekad notis åt annan: fältpersonal kan inte skapa notiser åt kollegor (type_not_allowed), inte egna påminnelser åt annan (recipient_not_allowed) och inte via REST (42501); inget ändras och appen fungerar vidare',
    async run(t) {
      seedNotiser(t);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('falt');
      await s.settle(600);
      const k0 = md5(t.fake.get('notifications'));
      const a = await s.eval(() => NotificationsService.push('ST-004', 'ao_assigned', 'Falsk tilldelning', { aoId: 'AO-001' }));
      t.assert(a && a.ok === false && a.error === 'forbidden' && a.reason === 'type_not_allowed' && md5(t.fake.get('notifications')) === k0, 'NotificationsService.push åt kollega: 403 forbidden/type_not_allowed, inget sparat: ' + JSON.stringify(a));
      const b = await direkt(s, { action: 'appendNotification', requestId: 'e2e-n4', notification: { userId: 'ST-004', type: 'service_done', message: 'Påminnelse åt annan' } });
      t.assert(b.status === 403 && b.error === 'forbidden' && b.reason === 'recipient_not_allowed' && md5(t.fake.get('notifications')) === k0, 'egen påminnelse åt annan: 403 forbidden/recipient_not_allowed, inget sparat');
      const c = await direkt(s, { action: 'appendNotification', requestId: 'e2e-n4b', notification: { userId: 'ST-004', type: 'offer_approved', message: 'Logga in här' } });
      t.assert(c.status === 403 && c.reason === 'type_not_allowed' && md5(t.fake.get('notifications')) === k0, 'typ offer_approved: 403 type_not_allowed');
      const r = await gammalPersist(s, [{ id: 'N-FALSK', userId: 'ST-004', type: 'offer_approved', message: 'Falsk', read: false, createdAt: T0 }]);
      t.assert(r.status === 403 && r.code === '42501' && md5(t.fake.get('notifications')) === k0, 'REST-vägen (notiser + lastChanged): 403 42501, inget sparat');
      const egen = await s.eval(() => NotificationsService.push(state.currentUser.id, 'service_done', 'E2E-påminnelse till mig själv'));
      t.assert(egen && egen.ok === true && await s.eval(() => (state.notifications || []).some((x) => x.message === 'E2E-påminnelse till mig själv')), 'en egen påminnelse fungerar och läggs in efter serverbekräftelse');
      await s.go('pg-myjobs').catch(() => {});
      await s.settle(400);
      t.assert(await s.eval(() => !!state.currentUser && (state.workOrders || []).some((a) => a.id === 'AO-001')), 'appen fungerar vidare (inloggad, AO-001 i tillståndet)');
      await s.context.close();
    },
  },
  {
    id: 'NOTIF-05', kind: 'security', world: WORLD, module: 'Notiser', name: 'Andras notiser når inte klienten: tillstånd, lokal cache och REST innehåller bara egna notiser — även för superadmin; äldre poster utan mottagare syns inte',
    async run(t) {
      seedNotiser(t);
      for (const [alias, egna] of [['falt', ['N-E2E-F']], ['admin', ['N-E2E-A']], ['falt2', ['N-E2E-F2']]]) {
        const s = await t.world.session({ viewport: 'laptop' });
        await s.login(alias);
        await s.settle(600);
        const v = await s.eval(() => ({ ids: (state.notifications || []).map((x) => x.id).sort(), cache: Object.keys(localStorage).filter((k) => /^vift_/.test(k)).map((k) => localStorage.getItem(k)).join('|') }));
        t.assert(JSON.stringify(v.ids) === JSON.stringify(egna), alias + ': tillståndet har exakt de egna notiserna ' + JSON.stringify(v.ids));
        const hemliga = ['HEMLIG-F2', 'HEMLIG-CHEF', 'HEMLIG-ADMIN', 'HEMLIG-OLD'].filter((x) => !(alias === 'falt2' && x === 'HEMLIG-F2') && !(alias === 'admin' && x === 'HEMLIG-ADMIN'));
        t.assert(!hemliga.some((x) => v.cache.includes(x)), alias + ': den lokala cachen innehåller inga andras notiser');
        const rest = await s.eval(async () => { const r = await fetch(SUPABASE_URL + '/rest/v1/store?key=eq.vift_notifications&select=value', { headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY } }); return { status: r.status, rows: await r.json() }; });
        t.assert(rest.status === 200 && Array.isArray(rest.rows) && rest.rows.length === 0, alias + ': REST-läsning av vift_notifications ger inga rader');
        await s.context.close();
      }
    },
  },
  {
    id: 'NOTIF-06', kind: 'workflow', world: WORLD, module: 'Notiser', name: 'Gammal klient (v3.4/T3/T4-A persistNotifs): REST-upserten nekas utan dataförlust och utan att tilldelning, uppgifter och AO bryts',
    async run(t) {
      seedNotiser(t);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await s.settle(600);
      const k0 = md5(t.fake.get('notifications'));
      // Den gamla klientens flöde: läs listan via REST (0 rader → "finns inte") och skriv den lokala listan som startvärde.
      const las = await s.eval(async () => { const r = await fetch(SUPABASE_URL + '/rest/v1/store?key=eq.vift_notifications&select=value', { headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY } }); return (await r.json()).length; });
      const lokal = await s.eval(() => (state.notifications || []).concat([{ id: 'N-GAMMAL', userId: 'ST-002', type: 'ao_assigned', message: 'Du har tilldelats AO-006', aoId: 'AO-006', read: false, createdAt: new Date().toISOString() }]));
      const w = await gammalPersist(s, lokal);
      t.assert(las === 0 && w.status === 403 && w.code === '42501', 'gammal klient: REST-läsning 0 rader, upserten nekas 403 42501');
      t.assert(md5(t.fake.get('notifications')) === k0 && (t.fake.get('notifications') || []).length === 5, 'ingen dataförlust: alla fem notiser (även andras och äldre) finns kvar oförändrade');
      // Tilldelning fungerar vidare (den nya klientens notis skapas av servern).
      await openAO(s, 'AO-006');
      await s.eval(() => WorkOrderDetailPage.manageStaff('AO-006'));
      await s.page.waitForSelector('.modal-overlay.open #sm-resp');
      await s.page.check('#smcb-' + STAFF.falt2);
      await s.clickModalButton(/^Spara$/);
      await s.waitToast(/Personal uppdaterad/, 8000);
      t.assert(await vanta(t, () => (t.fake.get('workOrders').find((a) => a.id === 'AO-006').staff || []).includes(STAFF.falt2)), 'tilldelningen sparad på servern');
      t.assert(await vanta(t, () => (t.fake.get('notifications') || []).some((n) => n.userId === STAFF.falt2 && n.aoId === 'AO-006')), 'tilldelningsnotisen skapad via den säkra vägen');
      // Uppgifter fungerar.
      const ny = await s.eval(async () => { const a = ActivitiesService.create({ title: 'E2E NOTIF-06 uppgift', type: 'task', assignedTo: state.currentUser.id }); return a && a.id; });
      t.assert(await vanta(t, () => (t.fake.get('activities') || []).some((a) => a.id === ny)), 'uppgiften sparad på servern');
      await s.context.close();
    },
  },
];
