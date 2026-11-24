'use strict';
/* Serviceintervall: skapa → nästa förfallodatum → bevakning (Att göra) →
   markera utförd med AO-koppling → historik; dubbelklick och serverfel. */

const iso = (d) => d.toISOString().slice(0, 10);
const daysFrom = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return iso(d); };
const PROP = 'OBJ-002';

async function openServiceTab(s, propId) {
  await s.go('pg-obj-detail', { propId });
  await s.eval(() => PropertyDetailPage.switchTab('service'));
  await s.settle(300);
}
async function addIntervalViaUi(s, { title, type, value, lastDone }) {
  await s.page.locator('#prop-tab-service button', { hasText: 'Lägg till' }).first().click();
  await s.page.waitForSelector('.modal-overlay.open #si-title');
  await s.page.fill('#si-title', title);
  await s.page.selectOption('#si-interval-type', type);
  if (value != null) await s.page.fill('#si-custom-val', String(value));
  await s.page.fill('#si-last-done', lastDone);
  await s.clickModalButton(/^Spara$/);
}
const siOnServer = (t, title) => {
  const p = t.fake.get('properties').find((x) => x.id === PROP);
  return (p.serviceIntervals || []).find((x) => x.title === title);
};

module.exports = [
  {
    id: 'SVC-01', kind: 'workflow', module: 'Serviceintervall', name: 'Flöde: skapa intervall → förfallodatum → Att göra vid uppstart → markera utförd med AO och kommentar → historik, uppgift stängd',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openServiceTab(s, PROP);
      const lastDone = daysFrom(-35);
      await addIntervalViaUi(s, { title: 'Filterbyte E2E', type: 'custom_days', value: 30, lastDone });
      await s.waitToast(/Serviceintervall tillagt/, 6000);
      await s.settle(1200);
      let si = siOnServer(t, 'Filterbyte E2E');
      t.assert(si, 'intervallet finns på servern');
      t.assert(si.nextDue === daysFrom(-5), 'nästa förfall = senast utfört + 30 dagar = ' + daysFrom(-5) + ' (fick ' + si.nextDue + ')');
      const badge = await s.text('#prop-tab-service');
      t.assert(/Förfallen med 5 dagar/.test(badge), 'kortet visar "Förfallen med 5 dagar"');
      // Ny inloggning = uppstart → bevakningen skapar en Att göra-post
      await s.page.reload({ waitUntil: 'load' });
      await s.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id === 'ST-001', null, { timeout: 15000 }).catch(() => {});
      await s.settle(2500);
      let acts = (t.fake.get('activities') || []).filter((a) => a.relatedId === si.id);
      t.assert(acts.length === 1 && acts[0].status !== 'done', 'en öppen Att göra-post för perioden på servern (' + acts.length + ')');
      await s.page.reload({ waitUntil: 'load' });
      await s.settle(2500);
      acts = (t.fake.get('activities') || []).filter((a) => a.relatedId === si.id);
      t.assert(acts.length === 1, 'andra uppstarten skapar ingen dubblett (' + acts.length + ')');
      // Markera utförd via Serviceintervall-översikten
      await s.go('pg-service-intervals');
      const card = s.page.locator('.page.active .si2-card', { hasText: 'Filterbyte E2E' });
      await card.locator('button', { hasText: 'Markera utförd' }).click();
      await s.page.waitForSelector('.modal-overlay.open #si-done-ao');
      const aoOpt = await s.eval(() => Array.from(document.querySelectorAll('#si-done-ao option')).map((o) => o.value).find(Boolean));
      t.assert(aoOpt, 'fastighetens AO kan väljas');
      await s.page.selectOption('#si-done-ao', aoOpt);
      await s.page.fill('#si-done-comment', 'Bytt filter F7');
      await s.page.locator('.modal-overlay.open .modal-footer button', { hasText: 'Markera utförd' }).dblclick();
      await s.waitToast(/Markerat som utförd/, 6000);
      await s.settle(1500);
      si = siOnServer(t, 'Filterbyte E2E');
      t.assert((si.history || []).length === 1, 'dubbelklick ger exakt en historikpost (' + (si.history || []).length + ')');
      t.assert(si.lastDone === daysFrom(0) && si.nextDue === daysFrom(30), 'senast utfört idag, nästa förfall +30 dagar (' + si.lastDone + ' → ' + si.nextDue + ')');
      t.assert(si.history[0].aoId === aoOpt && si.history[0].comment === 'Bytt filter F7' && si.history[0].previousNextDue === daysFrom(-5), 'historiken har AO, kommentar och avslutad period');
      acts = (t.fake.get('activities') || []).filter((a) => a.relatedId === si.id);
      t.assert(acts.length === 1 && acts[0].status === 'done', 'Att göra-posten stängd på servern (' + acts.map((a) => a.status) + ')');
      // Historik → AO-länk
      await s.page.locator('.page.active .si2-card', { hasText: 'Filterbyte E2E' }).locator('button', { hasText: 'Historik' }).click();
      await s.page.waitForSelector('.modal-overlay.open .si-hist-row');
      await s.page.locator('.modal-overlay.open .si-hist-row a', { hasText: aoOpt }).click();
      await s.settle(600);
      t.assert(await s.eval((id) => Router.currentPage === 'pg-ao-detail' || location.hash.includes(id), aoOpt), 'historikens AO-länk öppnar arbetsordern');
    },
  },
  {
    id: 'SVC-02', module: 'Serviceintervall', name: 'Serverfel vid "Markera utförd" ger inget definitivt "utfört"-besked och ingen tyst förlust',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openServiceTab(s, PROP);
      await addIntervalViaUi(s, { title: 'OVK E2E', type: 'annual', lastDone: daysFrom(-400) });
      await s.waitToast(/Serviceintervall tillagt/, 6000);
      await s.settle(1200);
      t.assert(siOnServer(t, 'OVK E2E'), 'intervallet sparat');
      await s.clearToasts();
      t.fake.addFault({ match: /store-key-write:writeMerge/, mode: 'fail', status: 503, error: 'http_503', times: 3 });
      await s.go('pg-service-intervals');
      await s.page.locator('.page.active .si2-card', { hasText: 'OVK E2E' }).locator('button', { hasText: 'Markera utförd' }).click();
      await s.page.waitForSelector('.modal-overlay.open #si-done-date');
      await s.clickModalButton(/Markera utförd/);
      await s.settle(2500);
      const toasts = await s.toasts();
      t.note('toasts: ' + toasts.join(' / '));
      t.assert(!toasts.some((m) => /^Markerat som utförd/.test(m)), 'inget "Markerat som utförd" när servern nekat');
      t.assert(toasts.some((m) => /inte|INTE|misslyck|fel/i.test(m)), 'tydligt felbesked');
      t.assert((siOnServer(t, 'OVK E2E').history || []).length === 0, 'servern har ingen historikpost');
      const local = await s.eval(() => { const p = state.properties.find((x) => x.id === 'OBJ-002'); const si = p.serviceIntervals.find((x) => x.title === 'OVK E2E'); return { h: (si.history || []).length, next: si.nextDue }; });
      t.assert(local.h === 0 && local.next === siOnServer(t, 'OVK E2E').nextDue, 'klienten rullade tillbaka till serverns läge (' + JSON.stringify(local) + ')');
      t.fake.clearFaults();
      await s.clearToasts();
      await s.page.locator('.page.active .si2-card', { hasText: 'OVK E2E' }).locator('button', { hasText: 'Markera utförd' }).click();
      await s.page.waitForSelector('.modal-overlay.open #si-done-date');
      await s.clickModalButton(/Markera utförd/);
      await s.waitToast(/Markerat som utförd/, 6000);
      t.assert((siOnServer(t, 'OVK E2E').history || []).length === 1, 'nytt försök efter felet sparas exakt en gång');
    },
  },
  {
    id: 'SVC-03', module: 'Serviceintervall', name: 'Översikten: filter, sök och paus/återuppta sparas på servern; fältarbetare utan customer_manage nekas sidan',
    async run(t) {
      const s = await t.world.session({ viewport: 'tablet' });
      await s.login('admin');
      await openServiceTab(s, PROP);
      await addIntervalViaUi(s, { title: 'Brandkontroll E2E', type: 'annual', lastDone: daysFrom(-30) });
      await s.waitToast(/tillagt/, 6000);
      await s.settle(1000);
      await s.go('pg-service-intervals');
      // 2026-11-26: sökfältet heter #si2-q (renderas om bara listan, 150 ms fördröjning); paus-knappen har synlig text.
      await s.page.fill('#si2-q', 'Brand');
      await s.settle(400);
      t.assert((await s.page.locator('.page.active .si2-card').count()) === 1, 'sök filtrerar till ett kort');
      await s.page.locator('.page.active .si2-card', { hasText: 'Brandkontroll E2E' }).locator('button', { hasText: /^\s*Pausa\s*$/ }).click();
      await s.settle(1200);
      t.assert(siOnServer(t, 'Brandkontroll E2E').active === false, 'pausad på servern');
      await s.page.locator('.page.active .si2-chips .chip', { hasText: 'Pausade' }).click();
      t.assert(/Brandkontroll E2E/.test(await s.text('#si-overview-list')), 'filtret Pausade visar intervallet');
      const f = await t.world.session({ viewport: 'iphone' });
      await f.login('falt');
      await f.go('pg-service-intervals');
      const txt = await f.eval(() => (document.querySelector('.page.active') || document.body).innerText);
      t.assert(!/Brandkontroll E2E/.test(txt), 'fältarbetaren ser inte intervallen');
    },
  },
];
