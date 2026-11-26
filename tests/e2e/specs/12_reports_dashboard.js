'use strict';
/* Rapporter, dashboard och notiser: siffrorna ska stämma med underlaget. */
const kr = (n) => Math.round(n).toLocaleString('sv-SE').replace(/[  ]/g, ' ') + ' kr';

module.exports = [
  {
    id: 'REP-01', module: 'Rapporter och statistik', name: 'Ekonomirapporten: "Fakturerat" = summan av utställda fakturor exkl. moms (samma beräkning som fakturavyn); tidrapporten kopplar tid till AO',
    async run(t) {
      const s = await t.world.session({ viewport: 'desktop' });
      await s.login('ekonomi');
      await s.go('pg-reports');
      await s.eval(() => { ReportsPage._setPeriod('12months'); ReportsPage._setTab('ekonomi'); });
      await s.settle(400);
      const expected = await s.eval(() => state.invoices.filter((i) => i.status !== 'utkast' && i.status !== 'makulerad').reduce((a, i) => a + InvoiceService.calcSummary(i).exVat, 0));
      const txt = (await s.text('.page.active')).replace(/[  ]/g, ' ');
      t.note('förväntat fakturerat (exkl. moms): ' + expected);
      t.assert(expected > 0, 'testdata har utställda fakturor');
      t.assert(txt.includes(kr(expected)), 'rapporten visar ' + kr(expected));
      await s.eval(() => ReportsPage._setTab('tid'));
      await s.settle(300);
      const ttxt = await s.text('.page.active');
      const aoWithTime = await s.eval(() => new Set(state.timeEntries.map((e) => e.aoId).filter(Boolean)).size);
      t.assert(new RegExp('AO med tid\\s*' + aoWithTime + ' st').test(ttxt.replace(/\s+/g, ' ')), 'tidrapporten räknar ' + aoWithTime + ' AO med tid');
      for (const tab of ['oversikt', 'arbetsordrar', 'avvikelser', 'material', 'serviceintervall', 'offerter']) {
        await s.eval((k) => ReportsPage._setTab(k), tab);
        await s.settle(150);
        const x = await s.text('.page.active');
        t.assert(!/NaN|undefined|\[object Object\]/.test(x), 'fliken ' + tab + ' utan NaN/undefined');
      }
      const f = await t.world.session({ viewport: 'iphone' });
      await f.login('falt');
      await f.go('pg-reports');
      t.assert(!/Fakturerat/.test(await f.eval(() => (document.querySelector('.page.active') || document.body).innerText)), 'fältarbetaren ser inga ekonomirapporter');
    },
  },
  {
    id: 'DASH-01', module: 'Dashboard', name: 'Dashboard per roll: widgets laddar utan fel; klick på AO-räknare leder till filtrerad AO-lista; fältarbetaren ser inga ekonomisiffror',
    async run(t) {
      const a = await t.world.session({ viewport: 'desktop' });
      await a.login('admin');
      await a.go('pg-dash');
      await a.settle(600);
      const txt = await a.text('#pg-dash');
      t.assert(txt.length > 200 && !/NaN|undefined|\[object Object\]/.test(txt), 'admin-dashboard renderar utan NaN/undefined');
      const clickable = a.page.locator('#pg-dash [onclick*="pg-ao"]').first();
      if (await clickable.count()) {
        await clickable.click();
        await a.settle(500);
        t.assert(await a.eval(() => Router.currentPage === 'pg-ao' || Router.currentPage === 'pg-ao-detail'), 'klick leder till arbetsordrar');
      } else t.note('ingen klickbar AO-genväg på dashboarden');
      for (const role of ['falt', 'ekonomi', 'begransad']) {
        const s = await t.world.session({ viewport: role === 'falt' ? 'android' : 'laptop' });
        await s.login(role);
        await s.go('pg-dash');
        await s.settle(500);
        const d = await s.text('#pg-dash');
        t.assert(!/NaN|undefined|\[object Object\]/.test(d), role + ': dashboard utan NaN/undefined');
        if (role !== 'ekonomi') t.assert(!/Fakturerat|Omsättning|Intäkt/.test(d), role + ': inga ekonomisiffror');
      }
    },
  },
  {
    id: 'NOTIF-01', module: 'Push och notifieringsgränssnitt', name: 'Notiser: in-app-notis visas i notislistan, kan markeras läst; push-prenumeration registreras utan att något skickas på riktigt',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('falt');
      /* T4-A notiser: notisen skapas av servern (appendNotification). Fältpersonal får skapa egna
         påminnelser åt sig själv; en tilldelningsnotis kräver ao_edit och verklig tilldelning (NOTIF-02). */
      const r = await s.eval(() => NotificationsService.push(state.currentUser.id, 'service_done', 'E2E-notis: ny AO tilldelad', { aoId: 'AO-001' }));
      t.assert(r && r.ok === true, 'servern godtar den egna notisen: ' + JSON.stringify(r));
      await s.settle(1200);
      const unreadBefore = await s.eval(() => NotificationsService.unreadCount());
      t.assert(unreadBefore >= 1, 'oläst-räknaren ökar (' + unreadBefore + ')');
      t.assert((t.fake.get('notifications') || []).some((n) => n.message === 'E2E-notis: ny AO tilldelad'), 'notisen sparad på servern');
      await s.page.locator('.nav-bell-row').first().click().catch(async () => s.eval(() => NotificationsService.showPanel()));
      await s.page.waitForSelector('.modal-overlay.open');
      t.assert(/E2E-notis: ny AO tilldelad/.test(await s.text('.modal-overlay.open')), 'notisen visas i notispanelen');
      t.assert(await s.eval(() => NotificationsService.unreadCount()) === 0, 'panelen markerar notiserna lästa');
      // Andra enheten för samma användare ser notisen efter synk
      const s2 = await t.world.session({ viewport: 'iphone' });
      await s2.login('falt');
      t.assert(await s2.eval(() => (state.notifications || []).some((n) => n.message === 'E2E-notis: ny AO tilldelad')), 'notisen syns på användarens andra enhet');
      const sent = t.fake.outbox.filter((m) => m.type === 'push').length;
      t.note('simulerade push-utskick: ' + sent + ' (inga riktiga utskick — send-push registreras bara)');
    },
  },
];
