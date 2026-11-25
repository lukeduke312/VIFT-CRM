'use strict';
/*
 * T3-A klientskydd (SÄK-9/F6 och SÄK-10/F7) — webbläsartester mot den
 * simulerade servern. Matrisens testfall: SEC-CACHE-01..03, SEC-ROLL-10,
 * SEC-CUST-23 (BEHORIGHETSMATRIS.md §5) samt T3-A-uppdragets fall: nätavbrott,
 * utgången session, kontobyte i samma flik och i flera flikar, utkorg vid
 * kontobyte, gamla (v3.4) utkorgsnycklar och indragen behörighet.
 *
 * Varje negativt fall kontrollerar (1) att den simulerade serverns data är
 * oförändrade (kontrollsumma, md5 över store/stämpling/känsliga fält/
 * idempotens) och (2) det förväntade klientbeteendet.
 *
 * Nivå: lokalt verifierad mot fake-backend.js. Inget här är verifierat i STAGING.
 */
const crypto = require('crypto');
const { PASSWORD } = require('../lib');

/* Kontrollsumma över hela den simulerade serverns data (eller ett urval av nycklar). */
function ks(fake, keys) {
  const st = [...fake.store.entries()].filter(([k]) => !keys || keys.includes(k.replace(/^vift_/, ''))).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const extra = keys ? [] : [[...fake.stamp.entries()].sort(), [...fake.sensitive.entries()].sort(), [...fake.idem.keys()].sort()];
  return crypto.createHash('md5').update(JSON.stringify([st, extra])).digest('hex');
}
/* Skrivande anrop (läsningar och sonderingar räknas inte). */
function isWrite(c) {
  if (c.method === 'GET' || c.method === 'OPTIONS') return false;
  const a = c.action || '';
  if (/^store-key-write:/.test(a)) return /:(write|writeMerge|setStampStatus|appendActivity)$/.test(a);
  if (a === 'store' || a.startsWith('push_subscriptions')) return true;
  if (/^(ao-time-write|work-order-log-write)/.test(a)) return !/__probe__/.test(a);
  return /^(invoice-write|rondering-pass-write|set-sensitive-fields|work-order-checklist|work-order-image-(upload|delete)|offer-attachment-upload)/.test(a);
}
const writesSince = (fake, n, email) => fake.calls.slice(n).filter((c) => isWrite(c) && (!email || c.user === email));

/* Tillåtna vift_-nycklar efter utloggning (uttrycklig lista, allt annat är
   användarspecifik cache): sessionsnyckeln (borttagen vid utloggning),
   utkorgar och journaler (ägarnycklade, rensas aldrig tyst), väntande
   stämplingsrensning, företagslogotyp, UI-inställningar per användar-id och
   cachens ägarmarkör. */
const KEEP_RE = /^vift_(auth_v2$|outbox|settleIntents|persistJournal|activityOutbox|pendingStampClear|logo_light$|logo_dark$|prefs_|push_onboarding_dismissed_|cacheOwner$)/;
const bizKeys = (s) => s.eval((re) => Object.keys(localStorage).filter((k) => k.startsWith('vift_') && !new RegExp(re).test(k)).sort(), KEEP_RE.source);

/* Fyll den lokala cachen som en vanlig synk gör (DataSync skriver alla nycklar). */
async function fillCache(s, t) {
  t.fake.touch();
  await s.eval(async () => { DataSync._lastSig = 'e2e-stale'; await DataSync._poll(); });
  const n = await s.eval(() => (localStorage.getItem('vift_customers') ? 1 : 0) + (localStorage.getItem('vift_staff') ? 1 : 0));
  t.assert(n === 2, 'förutsättning: cachen fylld (vift_customers + vift_staff)');
}
async function waitLogin(s, ms) {
  await s.page.waitForSelector('#login-user', { state: 'visible', timeout: ms || 10000 });
}
/* Inloggning via formuläret utan att vänta på appen (för fall där appen inte ska visas). */
async function submitLogin(s, email) {
  if (!s.page.url().includes('127.0.0.1')) await s.open();
  await waitLogin(s, 15000);
  await s.page.fill('#login-user', email);
  await s.page.fill('#login-pass', PASSWORD);
  await s.page.click('#lp-login button.btn.bp');
}
async function noAccessShown(s, ms) {
  await s.page.waitForFunction(() => { const el = document.getElementById('noaccess-screen'); return !!el && getComputedStyle(el).display !== 'none'; }, null, { timeout: ms || 15000 });
}
const memEmpty = (s) => s.eval(() => ({
  user: state.currentUser, cus: state.customers.length, staff: state.staff.length, roles: state.roles.length,
  offers: state.offers.length, ao: state.workOrders.length, te: state.timeEntries.length, inv: (state.invoices || []).length,
}));
const isEmpty = (m) => m.user === null && m.cus === 0 && m.staff === 0 && m.roles === 0 && m.offers === 0 && m.ao === 0 && m.te === 0 && m.inv === 0;
function addAuthUser(t, alias, email) {
  t.fake.users[email] = { id: 'uid-' + alias, email, password: PASSWORD, alias, active: true };
}

module.exports = [
  {
    id: 'SEC-NORM-01', module: 'Säkerhet', kind: 'workflow', name: 'Normalläge: inloggning, sparad ändring, utloggning utan osynkat (ingen varning), ny inloggning fungerar',
    async run(t) {
      const s = await t.world.session();
      await s.login('chef');
      const cid = await s.eval(() => state.customers[0].id);
      const ok = await s.eval(async (id) => { const c = state.customers.find((x) => x.id === id); c.phone = '070-123 45 67'; return persist({ keys: ['customers'] }); }, cid);
      t.assert(ok === true, 'ändringen sparad');
      t.assert(t.fake.get('customers').find((c) => c.id === cid).phone === '070-123 45 67', 'på servern');
      await s.eval(() => Auth.requestLogout());
      await waitLogin(s);
      t.assert(!(await s.modalOpen()), 'ingen varningsdialog när inget är osynkat');
      t.assert((await bizKeys(s)).length === 0, 'ingen användarspecifik cache kvar: ' + (await bizKeys(s)).join(','));
      await s.login('chef');
      t.assert(await s.eval(() => state.customers.length > 0 && Auth.can('customer_manage')), 'ny inloggning laddar data och behörigheter');
    },
  },
  {
    id: 'SEC-CACHE-01', module: 'Säkerhet', name: 'SÄK-9: ADM → utloggning → FÄ på samma profil: inga vift_*-affärsnycklar, inget sessionStorage, tomt minne',
    async run(t) {
      const s = await t.world.session();
      await s.login('admin');
      await fillCache(s, t);
      await s.eval(() => { localStorage.setItem('vift_gsearch_history_v1_ST-001', JSON.stringify({ version: 1, items: ['Hemlig kund'] })); sessionStorage.setItem('vift_e2e_tab', 'x'); });
      await s.settle(1500);
      const k0 = ks(t.fake); const c0 = t.fake.calls.length;
      await s.eval(() => Auth.logout());
      await waitLogin(s);
      const left = await bizKeys(s);
      t.assert(left.length === 0, 'inga användarspecifika vift_*-nycklar kvar efter utloggning: ' + left.join(','));
      t.assert(await s.eval(() => sessionStorage.length) === 0, 'sessionStorage tömt');
      const mem = await memEmpty(s);
      t.assert(isEmpty(mem), 'minnet tömt: ' + JSON.stringify(mem));
      t.assert(await s.eval(() => document.getElementById('dash-content').innerHTML.trim() === '' && document.getElementById('bottom-nav').innerHTML.trim() === ''), 'appens innehåll och meny borttagna ur DOM');
      t.assert(ks(t.fake) === k0 && writesSince(t.fake, c0).length === 0, 'servern oförändrad (kontrollsumma) och inga skrivanrop vid utloggningen');
      await s.login('falt');
      const fa = await s.eval(() => ({ hist: localStorage.getItem('vift_gsearch_history_v1_ST-001'), owner: localStorage.getItem('vift_cacheOwner') }));
      t.assert(!fa.hist, 'ADM:s sökhistorik finns inte för FÄ');
      t.assert(!fa.owner || /falt1@example\.test/.test(fa.owner), 'cachens ägare är FÄ eller ingen: ' + fa.owner);
    },
  },
  {
    id: 'SEC-CACHE-02', module: 'Säkerhet', name: 'SÄK-9: nätavbrott vid inläsning efter kontobyte — degraderad inläsning visar aldrig föregående användares cache',
    async run(t) {
      const s = await t.world.session();
      await s.login('admin');
      await fillCache(s, t);
      await s.eval(() => Auth.logout());
      await waitLogin(s);
      /* Främmande cache som en äldre klient (v3.4) kan ha lämnat kvar — skrivs
         in direkt, med ADM som ägare, medan ingen är inloggad. */
      await s.eval(() => {
        localStorage.setItem('vift_customers', JSON.stringify([{ id: 'K-FRAMMANDE', name: 'Främmande kund (ADM-cache)' }]));
        localStorage.setItem('vift_staff', JSON.stringify([{ id: 'ST-001', email: 'admin@example.test', role: 'admin', active: true }, { id: 'ST-002', email: 'falt1@example.test', role: 'admin', active: true }]));
        localStorage.setItem('vift_roles', JSON.stringify([{ id: 'admin', permissions: ['all'] }]));
      });
      t.fake.addFault({ match: /store-key-write:readAllWithHashes/, mode: 'fail', status: 503, error: 'http_503', times: 50 });
      const k0 = ks(t.fake); const c0 = t.fake.calls.length;
      await submitLogin(s, 'falt1@example.test');
      await s.page.waitForFunction(() => typeof state !== 'undefined' && state._degradedLoad === true && !document.querySelector('#lp-login button.btn.bp').disabled, null, { timeout: 20000 });
      await s.settle(800);
      const v = await s.eval(() => ({ cus: state.customers.map((c) => c.id), user: state.currentUser && state.currentUser.id, all: Auth.can('all'), appShown: getComputedStyle(document.getElementById('app')).display !== 'none', ls: localStorage.getItem('vift_customers') }));
      t.assert(!v.cus.includes('K-FRAMMANDE'), 'ADM:s cachade kund visas inte för FÄ: ' + JSON.stringify(v.cus));
      t.assert(!v.ls || !/FRAMMANDE/.test(v.ls), 'den främmande cachen är rensad');
      t.assert(v.all === false, 'främmande cachad roll ger ingen behörighet (FÄ fick inte admin via cachen)');
      t.assert(!v.appShown || v.user === 'ST-002', 'appen visas bara om identiteten kunde fastställas: ' + JSON.stringify(v));
      t.assert(ks(t.fake) === k0 && writesSince(t.fake, c0).length === 0, 'servern oförändrad och inga skrivanrop under degraderad inläsning');
      t.note('FÄ vid nätfel: ' + JSON.stringify({ user: v.user, app: v.appShown, cus: v.cus.length }));
    },
  },
  {
    id: 'SEC-CACHE-04', module: 'Säkerhet', name: 'SÄK-9 (positivt): samma användare vid nätfel efter omladdning får sin egen cache; inga skrivningar tillåts',
    async run(t) {
      const s = await t.world.session();
      await s.login('admin');
      await fillCache(s, t);
      await s.settle(1500);
      t.fake.addFault({ match: /store-key-write:readAllWithHashes/, mode: 'fail', status: 503, error: 'http_503', times: 50 });
      const k0 = ks(t.fake); const c0 = t.fake.calls.length;
      await s.page.reload({ waitUntil: 'load' });
      await s.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id === 'ST-001', null, { timeout: 20000 });
      const v = await s.eval(async () => ({ degraded: state._degradedLoad, cus: state.customers.length, saved: await persist() }));
      t.assert(v.degraded === true && v.cus > 0, 'egen cache används vid nätfel: ' + JSON.stringify(v));
      t.assert(v.saved === false, 'skrivning blockeras vid degraderad inläsning');
      t.assert(ks(t.fake) === k0 && writesSince(t.fake, c0).length === 0, 'servern oförändrad');
    },
  },
  {
    id: 'SEC-CACHE-03', module: 'Säkerhet', name: 'SÄK-9: utloggning och kontobyte i annan flik slår igenom — fliken tömmer minnet, visar inloggning och kan inte skriva',
    async run(t) {
      const a = await t.world.session();
      await a.login('admin');
      const b = await t.world.tab(a);
      await b.open();
      await b.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id === 'ST-001', null, { timeout: 20000 });
      await b.go('pg-crm');
      await fillCache(a, t);
      await a.settle(1000);
      const k0 = ks(t.fake); const c0 = t.fake.calls.length;
      await a.eval(() => Auth.logout());
      await waitLogin(a);
      await b.page.waitForFunction(() => getComputedStyle(document.getElementById('login-screen')).display !== 'none' && state.currentUser === null, null, { timeout: 5000 });
      const mb = await memEmpty(b);
      t.assert(isEmpty(mb), 'andra fliken har tömt minnet: ' + JSON.stringify(mb));
      t.assert(await b.eval(() => document.getElementById('pg-crm-content').innerHTML.trim() === ''), 'andra flikens kundlista borttagen ur DOM');
      const tried = await b.eval(async () => {
        state.customers.push({ id: 'K-GAMMAL-FLIK', name: 'skriven med gammal identitet' });
        const p = await persist();
        const q = await AOTimeSyncService.patchAO('AO-001', { title: 'kapad från gammal flik' });
        return { p, q: { ok: q.ok, error: q.error } };
      });
      t.assert(tried.p === false && tried.q.ok === false, 'skrivning från andra fliken nekas lokalt: ' + JSON.stringify(tried));
      t.assert(ks(t.fake) === k0 && writesSince(t.fake, c0).length === 0, 'servern oförändrad, inga skrivanrop');
      // Kontobyte: första fliken loggar in som FÄ; andra fliken antar inte identiteten
      await a.login('falt');
      await b.settle(800);
      t.assert(await b.eval(() => state.currentUser === null && getComputedStyle(document.getElementById('app')).display === 'none'), 'andra fliken förblir utloggad');
      t.assert(await b.eval(() => AOTimeSyncService.pendingCount()) === 0 && await a.eval(() => AOTimeSyncService.pendingCount()) === 0, 'den nekade utkorgsposten syns inte för FÄ');
    },
  },
  {
    id: 'SEC-TAB-02', module: 'Säkerhet', name: 'SÄK-9: kontobyte i annan flik innan storage-händelsen hunnit fram — skrivningen med gammal identitet stoppas ändå',
    async run(t) {
      const a = await t.world.session();
      await a.login('chef');
      const b = await t.world.tab(a);
      await b.open();
      await b.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id === 'ST-003', null, { timeout: 20000 });
      await b.settle(1500);
      const cid = await b.eval(() => state.customers[0].id);
      const k0 = ks(t.fake); const c0 = t.fake.calls.length;
      /* Den delade sessionen byts till en annan användare UTAN att den här
         fliken får någon storage-händelse (skrivs från fliken själv). */
      const r = await b.eval(async (id) => {
        const cur = JSON.parse(localStorage.getItem('vift_auth_v2'));
        localStorage.setItem('vift_auth_v2', JSON.stringify(Object.assign({}, cur, { user_email: 'falt1@example.test', user_id: 'uid-falt', access_token: 'tok-annan', refresh_token: 'ref-annan' })));
        const tok = Auth.getAccessToken(); // direkta fetch-anrop (bilder, rondering, fakturor) får ingen token
        const c = state.customers.find((x) => x.id === id); if (c) c.phone = '070-999 99 99';
        const p = await persist();
        const q = await AOTimeSyncService.patchAO('AO-001', { title: 'kapad efter kontobyte' });
        return { p, tok, q: { ok: q.ok, error: q.error } };
      }, cid);
      t.assert(r.tok === null, 'ingen token lämnas ut efter kontobytet (direkta fetch-anrop)');
      t.assert(r.p === false && r.q.ok === false, 'skrivningarna stoppas: ' + JSON.stringify(r));
      t.assert(ks(t.fake) === k0 && writesSince(t.fake, c0).length === 0, 'servern oförändrad och inga skrivanrop med chefens token');
      await b.page.waitForFunction(() => state.currentUser === null, null, { timeout: 5000 });
      await a.page.waitForFunction(() => state.currentUser === null, null, { timeout: 5000 });
    },
  },
  {
    id: 'SEC-SESS-01', module: 'Säkerhet', name: 'SÄK-9: sessionen upphör (JWT ogiltig, förnyelse nekas) — fail-closed, data skyddas, osparad ändring finns kvar för ägaren',
    async run(t) {
      const s = await t.world.session();
      await s.login('chef');
      await s.settle(1500);
      const cid = await s.eval(() => state.customers[1].id);
      const before = t.fake.get('customers').find((c) => c.id === cid).phone;
      for (const sess of t.fake.tokens.values()) { sess.exp = 0; sess.refresh = 'revoked-' + Math.random(); }
      const k0 = ks(t.fake);
      const ok = await s.eval(async (id) => { const c = state.customers.find((x) => x.id === id); c.phone = '070-777 77 77'; return persist({ keys: ['customers'] }); }, cid);
      t.assert(ok === false, 'sparningen rapporteras inte som lyckad');
      await waitLogin(s, 8000);
      const mem = await memEmpty(s);
      t.assert(isEmpty(mem), 'minnet tömt när sessionen upphör: ' + JSON.stringify(mem));
      t.assert((await bizKeys(s)).length === 0, 'ingen användarspecifik cache kvar: ' + (await bizKeys(s)).join(','));
      t.assert(ks(t.fake) === k0, 'servern oförändrad');
      t.assert(t.fake.get('customers').find((c) => c.id === cid).phone === before, 'ändringen nådde inte servern');
      const c1 = t.fake.calls.length;
      const after = await s.eval(async () => { const q = await AOTimeSyncService.patchAO('AO-001', { title: 'efter utgången session' }); return { ok: q.ok, error: q.error, pending: AOTimeSyncService.pendingCount() }; });
      t.assert(after.ok === false && writesSince(t.fake, c1).length === 0, 'ingen skrivning med utgången identitet: ' + JSON.stringify(after));
      const journal = await s.eval(() => Object.keys(localStorage).filter((k) => /^vift_persistJournal/.test(k)).map((k) => k + '=' + localStorage.getItem(k)).join(' '));
      t.assert(new RegExp(cid).test(journal) && /arbetsledare@example\.test/.test(journal), 'osparad ändring ligger kvar i chefens journal');
      await s.login('chef');
      await s.settle(2500);
      t.assert(t.fake.get('customers').find((c) => c.id === cid).phone === '070-777 77 77', 'ändringen skickas när ägaren loggar in igen');
    },
  },
  {
    id: 'SEC-OUTBOX-01', module: 'Säkerhet', kind: 'workflow', name: 'SÄK-9: utloggning med osynkad utkorg varnar (Synka nu / Logga ut ändå / Avbryt); nästa användare skickar inte och ser inte posten; ägaren får den skickad',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt2');
      await s.settle(1500);
      t.fake.addFault({ match: /ao-time-write|work-order-log-write/, mode: 'fail', status: 503, error: 'http_503', times: 500 });
      const pend = await s.eval(async () => { const r = await AOTimeSyncService.createTime({ id: 'TE-SEC-OB-1', aoId: 'AO-007', staffId: 'ST-004', date: '2026-11-20', minutes: 37, note: 'E2E utkorg' }); return { ok: r.ok, n: AOTimeSyncService.pendingCount() }; });
      t.assert(pend.ok === false && pend.n === 1, 'posten ligger i utkorgen: ' + JSON.stringify(pend));
      await s.eval(() => Auth.requestLogout());
      await s.page.waitForSelector('.modal-overlay.open', { timeout: 5000 });
      const body = await s.text('.modal-overlay.open .modal-body');
      t.assert(/osynkad/i.test(body), 'varningen nämner osynkade ändringar: ' + body.slice(0, 160));
      const labels = await s.page.locator('.modal-overlay.open .modal-footer button').allTextContents();
      t.assert(labels.some((l) => /Synka nu/.test(l)) && labels.some((l) => /Logga ut ändå/.test(l)) && labels.some((l) => /Avbryt/.test(l)), 'knapparna finns: ' + labels.join(' | '));
      await s.clickModalButton(/Avbryt/);
      await s.settle(400);
      t.assert(await s.eval(() => !!state.currentUser && state.currentUser.id === 'ST-004'), 'Avbryt: fortfarande inloggad');
      await s.eval(() => Auth.requestLogout());
      await s.page.waitForSelector('.modal-overlay.open', { timeout: 5000 });
      await s.clickModalButton(/Synka nu/);
      await s.settle(1500);
      t.assert(await s.eval(() => !!state.currentUser) && (await s.eval(() => AOTimeSyncService.pendingCount())) === 1, 'Synka nu misslyckas (servern nere): kvar inloggad, posten kvar');
      await s.page.waitForSelector('.modal-overlay.open', { timeout: 5000 }).catch(() => {});
      if (await s.modalOpen()) await s.clickModalButton(/Logga ut ändå/);
      else { await s.eval(() => Auth.requestLogout()); await s.page.waitForSelector('.modal-overlay.open'); await s.clickModalButton(/Logga ut ändå/); }
      await waitLogin(s);
      t.fake.clearFaults();
      const k0 = ks(t.fake, ['timeEntries', 'workOrders']); const c0 = t.fake.calls.length;
      await s.login('falt');
      await s.settle(3000);
      const otherSent = t.fake.calls.slice(c0).filter((c) => /ao-time-write/.test(c.action) && c.user === 'falt1@example.test');
      t.assert(otherSent.length === 0, 'falt2:s post skickades inte med falt1:s session (' + otherSent.length + ')');
      t.assert(ks(t.fake, ['timeEntries', 'workOrders']) === k0, 'tidposter och AO oförändrade på servern');
      t.assert(await s.eval(() => AOTimeSyncService.pendingCount()) === 0, 'falt1 ser inte falt2:s väntande post');
      await s.eval(() => Auth.logout());
      await waitLogin(s);
      await s.login('falt2');
      await s.page.waitForFunction(() => AOTimeSyncService.pendingCount() === 0, null, { timeout: 15000 });
      const n = t.fake.get('timeEntries').filter((e) => e.id === 'TE-SEC-OB-1').length;
      t.assert(n === 1, 'falt2:s post sparad exakt en gång när falt2 loggar in igen (' + n + ')');
    },
  },
  {
    id: 'SEC-OUTBOX-02', module: 'Säkerhet', name: 'Uppgradering från v3.4: gamla utkorgsnycklar migreras till ägarnycklad form; post utan känd ägare behålls, varnas och skickas aldrig automatiskt',
    async run(t) {
      const s = await t.world.session();
      await s.open();
      await waitLogin(s);
      await s.eval(() => {
        const mk = (id, minutes, owner) => Object.assign({ id, entityType: 'time', localRefId: 'TE-' + id, attempts: 0, createdAt: new Date().toISOString(),
          payload: { action: 'create_time', idempotencyKey: id, entry: { id: 'TE-' + id, aoId: 'AO-007', staffId: 'ST-004', date: '2026-11-20', minutes } } }, owner ? { owner } : {});
        localStorage.setItem('vift_outbox', JSON.stringify([mk('LEG-AGARE', 41, 'falt2@example.test'), mk('LEG-UTAN', 42, null)]));
        localStorage.setItem('vift_settleIntents', JSON.stringify([{ idemKey: 'LEG-AGARE', intent: { kind: 'e2e_okand', refId: 'x' }, settled: false, applied: false }]));
      });
      const k0 = ks(t.fake, ['timeEntries']); const c0 = t.fake.calls.length;
      await s.login('falt');
      await s.settle(3000);
      t.assert(t.fake.calls.slice(c0).filter((c) => /ao-time-write:create_time/.test(c.action)).length === 0, 'inget av de gamla posterna skickas under falt1');
      t.assert(ks(t.fake, ['timeEntries']) === k0, 'tidposter oförändrade');
      const warned = (await s.toasts()).concat([await s.eval(() => (document.getElementById('legacy-outbox-banner') || {}).textContent || '')]).join(' ');
      t.assert(/äldre version/i.test(warned), 'varning om osynkade ändringar utan känd ägare: ' + warned.slice(0, 200));
      await s.eval(() => Auth.logout());
      await waitLogin(s);
      await s.login('falt2');
      await s.page.waitForFunction(() => AOTimeSyncService.pendingCount() === 0, null, { timeout: 15000 });
      const te = t.fake.get('timeEntries');
      t.assert(te.filter((e) => e.id === 'TE-LEG-AGARE').length === 1, 'posten med känd ägare skickas exakt en gång för ägaren');
      t.assert(te.filter((e) => e.id === 'TE-LEG-UTAN').length === 0, 'posten utan känd ägare skickas inte automatiskt');
      const legacy = await s.eval(() => JSON.parse(localStorage.getItem('vift_outbox') || '[]').map((e) => e.id));
      t.assert(legacy.length === 1 && legacy[0] === 'LEG-UTAN', 'posten utan ägare finns kvar (ingen förlust): ' + JSON.stringify(legacy));
    },
  },
  {
    id: 'SEC-ROLL-10', module: 'Säkerhet', name: 'SÄK-10: inloggning utan personalpost ger ingen reservroll — sidan "Ditt konto saknar behörighet", ingen meny, inga sidor, ingen data',
    async run(t) {
      addAuthUser(t, 'okand', 'okand@example.test');
      const s = await t.world.session();
      await s.open();
      const k0 = ks(t.fake); const c0 = t.fake.calls.length;
      await submitLogin(s, 'okand@example.test');
      await noAccessShown(s);
      const v = await s.eval(() => ({
        text: document.getElementById('noaccess-screen').textContent,
        app: getComputedStyle(document.getElementById('app')).display,
        nav: document.getElementById('bottom-nav').innerHTML.trim(),
        can: ['all', 'dashboard_view', 'ao_view_own', 'ao_time'].some((p) => Auth.can(p)),
        page: ['pg-dash', 'pg-myjobs', 'pg-crm'].some((p) => Auth.canViewPage(p)),
        role: Auth.accessState(),
      }));
      t.assert(/Ditt konto saknar behörighet i VIFT/.test(v.text) && /kontakta administratören/.test(v.text), 'tydlig sida: ' + v.text.trim().slice(0, 120));
      t.assert(v.app === 'none' && v.nav === '', 'ingen app och ingen meny');
      t.assert(!v.can && !v.page, 'inga behörigheter och inga sidor (fail-closed)');
      const mem = await memEmpty(s);
      t.assert(isEmpty(mem), 'ingen data i minnet: ' + JSON.stringify(mem));
      await s.eval(() => Router.showPage('pg-crm'));
      t.assert(await s.eval(() => getComputedStyle(document.getElementById('app')).display === 'none'), 'direktnavigering visar ingen sida');
      t.assert((await bizKeys(s)).length === 0, 'ingen data i lokal cache: ' + (await bizKeys(s)).join(','));
      t.assert(ks(t.fake) === k0 && writesSince(t.fake, c0).length === 0, 'servern oförändrad, inga skrivanrop');
      await s.page.locator('#noaccess-screen button', { hasText: 'Logga ut' }).click();
      await waitLogin(s);
      t.note('accessState=' + v.role);
    },
  },
  {
    id: 'SEC-CUST-23', module: 'Säkerhet', name: 'SÄK-10: personalpost med okänt roll-id ger inga behörigheter (fail-closed), ingen app och ingen data',
    async run(t) {
      const staff = t.fake.get('staff');
      staff.push({ id: 'ST-099', firstName: 'Spök', lastName: 'Roll', email: 'spok@example.test', role: 'roll-som-inte-finns', active: true });
      t.fake.set('staff', staff);
      addAuthUser(t, 'spok', 'spok@example.test');
      const s = await t.world.session();
      await s.open();
      const k0 = ks(t.fake); const c0 = t.fake.calls.length;
      await submitLogin(s, 'spok@example.test');
      await noAccessShown(s);
      const v = await s.eval(() => ({ can: Auth.can('dashboard_view') || Auth.can('all'), page: Auth.canViewPage('pg-dash'), app: getComputedStyle(document.getElementById('app')).display }));
      t.assert(!v.can && !v.page && v.app === 'none', 'inga behörigheter, ingen app: ' + JSON.stringify(v));
      const mem = await memEmpty(s);
      t.assert(isEmpty(mem), 'ingen data i minnet: ' + JSON.stringify(mem));
      t.assert((await bizKeys(s)).length === 0, 'ingen data i lokal cache');
      t.assert(ks(t.fake) === k0 && writesSince(t.fake, c0).length === 0, 'servern oförändrad, inga skrivanrop');
    },
  },
  {
    id: 'SEC-PERM-01', module: 'Säkerhet', name: 'Indragen behörighet slår igenom i öppen session (synk) och i annan flik utan egen synk: otillåten sida lämnas',
    async run(t) {
      const a = await t.world.session();
      await a.login('chef');
      const b = await t.world.tab(a);
      await b.open();
      await b.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id === 'ST-003', null, { timeout: 20000 });
      await a.go('pg-crm'); await b.go('pg-crm');
      await b.eval(() => DataSync.stop()); // andra fliken får INTE upptäcka ändringen själv
      const roles = t.fake.get('roles');
      const chef = roles.find((r) => r.id === 'chef');
      chef.permissions = chef.permissions.filter((p) => p !== 'customer_manage' && p !== 'customer_view');
      t.fake.set('roles', roles); t.fake.touch();
      const k0 = ks(t.fake); const c0 = t.fake.calls.length;
      await a.eval(async () => { DataSync._lastSig = 'e2e-stale'; await DataSync._poll(); });
      await a.page.waitForFunction(() => Router.currentPage !== 'pg-crm', null, { timeout: 5000 });
      t.assert(await a.eval(() => Auth.can('customer_manage') === false && !Auth.canViewPage('pg-crm')), 'behörigheten borta i den öppna sessionen');
      await b.page.waitForFunction(() => Router.currentPage !== 'pg-crm' && !Auth.can('customer_manage'), null, { timeout: 6000 });
      t.assert(ks(t.fake) === k0 && writesSince(t.fake, c0).length === 0, 'servern oförändrad');
    },
  },
  {
    id: 'SEC-PERM-02', module: 'Säkerhet', name: 'Personalpost inaktiveras under pågående session: servern svarar 403 → klienten tar bort åtkomsten direkt (sidan "saknar behörighet")',
    async run(t) {
      const s = await t.world.session();
      await s.login('chef');
      await s.go('pg-crm');
      await s.settle(1200);
      const staff = t.fake.get('staff');
      staff.find((x) => x.id === 'ST-003').active = false;
      t.fake.set('staff', staff); t.fake.touch();
      const k0 = ks(t.fake); const c0 = t.fake.calls.length;
      await s.eval(async () => { DataSync._lastSig = 'e2e-stale'; await DataSync._poll(); });
      await noAccessShown(s, 8000);
      const mem = await memEmpty(s);
      t.assert(isEmpty(mem), 'data borttagen ur minnet: ' + JSON.stringify(mem));
      t.assert(await s.eval(() => getComputedStyle(document.getElementById('app')).display === 'none'), 'appen dold');
      t.assert(ks(t.fake) === k0 && writesSince(t.fake, c0).length === 0, 'servern oförändrad');
    },
  },
];
