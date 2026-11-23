'use strict';
/* Robusthet: nätverksavbrott och återanslutning, omladdning mitt i sparning,
   timeout, utloggning/användarbyte med osparad generisk ändring. */

async function openAO(s, id) {
  await s.go('pg-ao-detail', { aoId: id });
  await s.page.waitForFunction((x) => document.getElementById('ao-timeline') && WorkOrderDetailPage.aoId === x, id, { timeout: 8000 });
}
async function addLog(s, text) {
  await s.eval(() => WorkOrderDetailPage.openAddLog());
  await s.page.waitForSelector('.modal-overlay.open #log-text');
  await s.page.fill('#log-text', text);
  await s.clickModalButton(/^Spara$/);
}
const logCount = (t, ao, text) => ((t.fake.get('workOrders').find((a) => a.id === ao) || {}).log || []).filter((l) => l.text === text).length;

module.exports = [
  {
    id: 'RES-01', module: 'Robusthet', name: 'Mobilen tappar nätet: loggpost köas; när nätet kommer tillbaka skickas den automatiskt (utan omladdning) exakt en gång',
    async run(t) {
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('falt2');
      await openAO(s, 'AO-007');
      s.offline = true;
      await s.context.setOffline(true);
      await addLog(s, 'E2E tappat nät');
      await s.settle(1500);
      t.assert(!(await s.toasts()).some((m) => /Loggpost sparad/.test(m)), 'ingen "sparad" utan nät');
      t.assert(await s.eval(() => AOTimeSyncService.pendingCount()) >= 1, 'posten ligger i kön');
      s.offline = false;
      await s.context.setOffline(false);
      await s.waitToast(/Loggpost sparad/, 15000).catch(() => {});
      const n = logCount(t, 'AO-007', 'E2E tappat nät');
      t.assert(n === 1, 'skickad automatiskt efter återanslutning, exakt en gång (' + n + ' på servern)');
    },
  },
  {
    id: 'RES-02', module: 'Robusthet', name: 'Omladdning mitt i sparning (AO-logg och kundändring): båda hamnar på servern exakt en gång efter omladdning',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await openAO(s, 'AO-007');
      t.fake.addFault({ match: /ao-time-write:patch_ao/, mode: 'hang', times: 1 });
      await addLog(s, 'E2E omladdning');
      await s.settle(400);
      const cid = await s.eval(() => state.customers[0].id);
      t.fake.addFault({ match: /store-key-write:writeMerge/, mode: 'hang', times: 1 });
      await s.eval((id) => { const c = state.customers.find((x) => x.id === id); c.phone = '070-111 22 33'; persist({ keys: ['customers'] }); }, cid);
      await s.settle(300);
      await s.page.reload({ waitUntil: 'load' });
      await s.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id === 'ST-003', null, { timeout: 15000 });
      await s.settle(3000);
      t.assert(logCount(t, 'AO-007', 'E2E omladdning') === 1, 'loggposten på servern exakt en gång (' + logCount(t, 'AO-007', 'E2E omladdning') + ')');
      t.assert(t.fake.get('customers').find((c) => c.id === cid).phone === '070-111 22 33', 'kundändringen på servern efter omladdning');
    },
  },
  {
    id: 'RES-03', module: 'Robusthet', name: 'Servern svarar inte på kundändring (timeout): inget "uppdaterad", tydligt besked inom rimlig tid',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await s.eval(() => { Storage.WRITE_TIMEOUT_MS = 3000; }); // förkortad för testet; produktionen 20 s
      const cid = await s.eval(() => state.customers[0].id);
      await s.go('pg-crm-detail', { customerId: cid });
      await s.page.locator('.page.active button', { hasText: 'Redigera' }).first().click();
      await s.page.waitForSelector('.modal-overlay.open #cu-phone');
      await s.page.fill('#cu-phone', '070-555 00 00');
      t.fake.addFault({ match: /store-key-write:(writeMerge|readWithHash)/, mode: 'hang', times: 3 });
      const t0 = Date.now();
      await s.clickModalButton(/Spara/);
      await s.page.waitForFunction(() => window.__toasts.some((x) => /kunde inte|INTE|osparad|bekräftade inte/i.test(x.m)), null, { timeout: 15000 });
      t.metric('feedback_ms', Date.now() - t0);
      const toasts = await s.toasts();
      t.note('besked efter ' + (Date.now() - t0) + ' ms: ' + toasts.join(' / '));
      t.assert(!toasts.some((m) => /^Kund uppdaterad/.test(m)), 'inget "Kund uppdaterad"');
    },
  },
  {
    id: 'RES-04', module: 'Robusthet', name: 'Utloggning med osparad kundändring: nästa användare skickar den inte i sitt namn; när ägaren loggar in igen skickas den',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      const cid = await s.eval(() => state.customers[1].id);
      const before = t.fake.get('customers').find((c) => c.id === cid).phone;
      t.fake.addFault({ match: /store-key-write:writeMerge/, mode: 'fail', status: 503, error: 'http_503', times: 100 });
      await s.eval((id) => { const c = state.customers.find((x) => x.id === id); c.phone = '070-444 44 44'; persist(); }, cid);
      await s.settle(1500);
      await s.eval(() => Auth.logout());
      await s.page.waitForSelector('#login-user', { state: 'visible' });
      t.fake.clearFaults();
      await s.login('admin');
      await s.settle(2500);
      const writesByAdmin = t.fake.calls.filter((c) => c.action === 'store-key-write:writeMerge' && c.user === 'admin@example.test' && /customers/.test(c.key || ''));
      t.assert(t.fake.get('customers').find((c) => c.id === cid).phone === before, 'admins inloggning skickade inte chefens osparade ändring (' + writesByAdmin.length + ' skrivningar)');
      await s.eval(() => Auth.logout());
      await s.page.waitForSelector('#login-user', { state: 'visible' });
      await s.login('chef');
      await s.settle(2500);
      const after = t.fake.get('customers').find((c) => c.id === cid).phone;
      t.assert(after === '070-444 44 44', 'chefens obekräftade ändring skickas när chefen loggar in igen (' + after + ')');
    },
  },
  {
    id: 'SW-01', module: 'Robusthet', name: 'Service Worker: ny driftsättning (ny ?v=) hämtas vid omladdning — ingen gammal cachad fil; offline-start visar appen från cache',
    async run(t) {
      const lib = require('../lib');
      const s = await t.world.session({ viewport: 'laptop', serviceWorkers: 'allow' });
      try {
        await s.open();
        await s.page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller === null ? false : true, null, { timeout: 3000 }).catch(() => {});
        await s.page.reload({ waitUntil: 'load' });
        await s.page.waitForFunction(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller), null, { timeout: 10000 });
        await s.login('admin');
        const v = await s.eval(() => (document.querySelector('script[src*="src/pages/Router.js?v="]') || {}).src.match(/v=(\d+)/)[1]);
        // "Driftsätt" en ny Router.js: ny ?v= i index.html och nytt innehåll i filen
        lib.setOverride('/index.html', (html) => html.replace('src/pages/Router.js?v=' + v, 'src/pages/Router.js?v=' + v + '9'));
        lib.setOverride('/src/pages/Router.js', (js, url) => /v=\d+9\b/.test(url) ? js + '\n;window.__e2eDeploy = true;' : js);
        await s.page.reload({ waitUntil: 'load' });
        await s.page.waitForFunction(() => typeof Router !== 'undefined', null, { timeout: 10000 });
        t.assert(await s.eval(() => window.__e2eDeploy === true), 'den nya Router.js laddades efter omladdning (ingen gammal cachad fil)');
        lib.clearOverrides();
        // Offline-start: appskalet ska komma från cachen
        await s.context.setOffline(true);
        s.offline = true;
        await s.page.reload({ waitUntil: 'load' }).catch(() => {});
        const shell = await s.eval(() => ({ hasLogin: !!document.getElementById('login-user'), hasApp: !!document.getElementById('app'), router: typeof Router !== 'undefined' })).catch(() => ({}));
        t.note('offline-start: ' + JSON.stringify(shell));
        t.assert(shell.hasApp && shell.router, 'appskalet och skripten laddas offline från Service Worker-cachen');
      } finally {
        lib.clearOverrides();
        s.offline = false;
        await s.context.setOffline(false).catch(() => {});
      }
    },
  },
];
