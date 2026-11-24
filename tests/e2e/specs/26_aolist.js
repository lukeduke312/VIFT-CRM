'use strict';
/* AO-listan V3.2 (2026-11-26): begränsad lista med tydlig sidfot och "Visa
   fler/Visa alla", filterhierarki (Status / Snabbval) med "Rensa filter",
   massmarkering som aldrig tyst omfattar rader som filtret döljer, sortering
   via kolumnrubriker, otvetydiga AO-nummer vid dubbletter, prestanda vid
   1000 AO och layout 360–1920. Simulerad server (ingen STAGING-trafik). */
const crypto = require('crypto');

const STATUSES = ['nytt', 'pool', 'planerad', 'pågående', 'klar'];
const localDay = (offset) => { const d = new Date(); d.setDate(d.getDate() + (offset || 0)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/* Syntetiska AO (påhittade titlar, befintliga demokunder och demopersonal). */
function synth(fake, n, f) {
  const cus = fake.get('customers');
  const out = [];
  for (let i = 0; i < n; i++) {
    const base = {
      id: 'AO-' + crypto.randomUUID(), displayNumber: 'AO-' + (1000 + i), title: 'Synt arbetsorder ' + i,
      customerId: cus[i % cus.length].id, status: STATUSES[i % 5], priority: 'normal', scheduledDate: '', staff: [],
      log: [], checklist: [], materials: [], createdAt: new Date(Date.now() - i * 60000).toISOString(), updatedAt: new Date().toISOString(),
    };
    out.push(Object.assign(base, f ? f(i, base) : {}));
  }
  return out;
}

/* Realistiskt innehåll: alla statusar (även avbruten, fakturerad, arkiv,
   papperskorg), långa titlar och kundnamn, saknade fält, 0–4 personer,
   kategorier, ett par med samma synliga AO-nummer (som AO-001 i STAGING). */
const LONG_TITLE = 'Ventilationsrensning av samtliga trapphus, fläktrum och frånluftskanaler inklusive OVK-protokoll och åtgärdslista för styrelsen';
function realistic(fake, n) {
  const cus = fake.get('customers');
  if (!cus.some((c) => c.id === 'K-LONG')) {
    cus.push({ id: 'K-LONG', name: 'Bostadsrättsföreningen Långa Namnets Fastigheter i Norra Stockholm ekonomisk förening', type: 'foretag', email: 'lang@example.test', contacts: [] });
    fake.set('customers', cus);
  }
  const ST = ['nytt', 'pool', 'planerad', 'pågående', 'klar', 'avbruten', 'fakturerad'];
  const staffSets = [['ST-002'], ['ST-003', 'ST-004'], [], ['ST-002', 'ST-003', 'ST-004', 'ST-005'], ['ST-004'], ['ST-002', 'ST-005', 'ST-003']];
  const cats = ['felanmalan', 'underhall', 'besiktning', 'teknisk', 'utemiljo', ''];
  const aos = synth(fake, n, (i, b) => {
    const o = {
      status: ST[i % 7], priority: ['normal', 'hög', 'normal', 'akut', 'låg'][i % 5], staff: staffSets[i % 6],
      scheduledDate: i % 4 ? localDay((i % 15) - 7) : '', scheduledStart: i % 3 ? String(7 + (i % 9)).padStart(2, '0') + ':00' : '',
      category: cats[i % 6], title: i % 10 === 3 ? LONG_TITLE + ' (' + i + ')' : 'Arbetsorder ' + i + ' – ' + ['läckage', 'service', 'besiktning', 'byte av lås', 'snöröjning'][i % 5],
      address: 'Storgatan ' + (i % 90 + 1), city: ['Stockholm', 'Uppsala', 'Västerås'][i % 3],
    };
    if (i % 13 === 5) o.customerId = 'K-LONG';
    if (i % 17 === 8) Object.assign(o, { title: '', customerId: '', priority: undefined, scheduledDate: '', scheduledStart: '', staff: undefined, category: '', address: '', city: '', displayNumber: undefined });
    if (i % 4 === 1) o.checklist = [{ id: 'c1', text: 'a', done: true }, { id: 'c2', text: 'b', done: false }, { id: 'c3', text: 'c', done: false }];
    if (i % 50 === 7) Object.assign(o, { archived: true, archivedAt: new Date().toISOString() });
    if (i % 60 === 11) Object.assign(o, { deleted: true, deletedAt: new Date().toISOString() });
    return o;
  });
  aos.push({ id: 'AO-001', displayNumber: 'AO-001', title: 'GTE', customerId: cus[0].id, status: 'pool', priority: 'normal', staff: [], log: [], checklist: [], materials: [], createdAt: '2026-07-23T08:00:00.000Z', updatedAt: new Date().toISOString() });
  aos.push({ id: 'AO-bfc37f77-4793-4c59-b46b-34209a9fa954', displayNumber: 'AO-001', title: 'TEST-R9B – Kontroll av arbetsorder', customerId: cus[1].id, status: 'klar', priority: 'akut', staff: ['ST-001'], log: [], checklist: [], materials: [], createdAt: '2026-10-22T08:00:00.000Z', updatedAt: new Date().toISOString() });
  return aos;
}

async function openList(s, mode) {
  await s.eval((m) => {
    try { localStorage.setItem('view-ao', m); } catch (e) {}
    WorkOrdersPage.viewMode = m; WorkOrdersPage.filter = 'alla'; WorkOrdersPage.q = ''; WorkOrdersPage._pickMode = false;
    WorkOrdersPage._f = WorkOrdersPage._defaultFilters(false);
    SelectionModel.clearAll();
  }, mode || 'list');
  await s.go('pg-ao');
  await s.settle(250);
}
const rowIds = (s) => s.eval(() => [...document.querySelectorAll('#ao-list [data-sel-row-id]')].map((e) => e.getAttribute('data-sel-row-id')));
const countText = async (s) => (await s.text('#ao-list .aol-count-txt')).replace(/\s+/g, ' ').trim();
const selbarText = (s) => s.eval(() => { const e = document.querySelector('#_selbar .selbar-count'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; });
const modal = (s) => s.eval(() => { const o = [...document.querySelectorAll('.modal-overlay.open')].pop(); if (!o) return null; return { title: (o.querySelector('.modal-title') || {}).textContent || '', body: (o.querySelector('.modal-body') || {}).innerText || '', buttons: [...o.querySelectorAll('.modal-footer button')].map((b) => b.textContent.trim()) }; });
async function waitModal(s, re) {
  await s.page.waitForFunction((src) => { const o = [...document.querySelectorAll('.modal-overlay.open')].pop(); return !!o && new RegExp(src).test((o.querySelector('.modal-title') || {}).textContent || ''); }, re.source, { timeout: 5000 });
  return modal(s);
}
async function check(s, id) { await s.page.locator('#ao-list input._sel-cb[data-sel-id="' + id + '"]').check(); await s.settle(80); }

module.exports = [
  {
    id: 'AOL-01', module: 'Arbetsordrar', name: 'Begränsad lista: antal i rubrik och sidfot ("Visar 150 av 800"), Visa 300 till och Visa alla når varje AO; Välj alla gäller de som visas, Markera alla N som matchar gäller hela urvalet',
    async run(t) {
      const aos = synth(t.fake, 800, (i) => ({ title: 'Synt arbetsorder ' + i + (i % 7 === 0 ? ' zebra' : '') }));
      synth(t.fake, 6, () => ({ status: 'fakturerad' })).forEach((a) => aos.push(a));
      synth(t.fake, 3, () => ({ archived: true, archivedAt: new Date().toISOString() })).forEach((a) => aos.push(a));
      t.fake.set('workOrders', aos);
      const active = aos.filter((a) => !a.archived && a.status !== 'fakturerad').map((a) => a.id);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openList(s, 'list');
      t.assert((await countText(s)) === 'Visar 150 av 800 aktiva arbetsordrar', 'rubriken visar hela urvalet och att listan är begränsad: "' + (await countText(s)) + '"');
      t.assert((await rowIds(s)).length === 150, '150 rader ritade');
      const foot = async () => s.eval(() => { const f = document.querySelector('#ao-list .aol-foot'); return f ? { txt: f.querySelector('.aol-foot-txt').textContent.replace(/\s+/g, ' ').trim(), btns: [...f.querySelectorAll('button')].map((b) => b.textContent.trim()) } : null; });
      let ft = await foot();
      t.assert(ft && ft.txt === 'Visar 150 av 800 arbetsordrar', 'sidfoten säger hur många som visas av hur många: ' + JSON.stringify(ft));
      t.assert(ft.btns.join('|') === 'Visa 300 till|Visa alla 800', 'sidfoten har Visa 300 till och Visa alla 800: ' + ft.btns.join('|'));
      // Välj alla = de som visas; Markera alla som matchar = hela urvalet.
      const selLabel = (await s.text('#ao-list .aol-selall')).trim();
      t.assert(selLabel === 'Välj de 150 som visas', 'markera-alla-rutan säger att den gäller de som visas: "' + selLabel + '"');
      await s.page.locator('#ao-list ._sel-all-cb').check();
      await s.settle(150);
      let sel = await s.eval(() => SelectionModel.getSelected());
      const shown = await rowIds(s);
      t.assert(sel.length === 150 && sel.every((id) => shown.includes(id)), 'Välj de 150 som visas markerar exakt de 150 utritade (' + sel.length + ')');
      t.assert(/^150 arbetsordrar markerade/.test(await selbarText(s)), 'bulk-baren: 150 markerade');
      await s.page.locator('#ao-list .aol-selmatch', { hasText: 'Markera alla 800 som matchar' }).click();
      await s.settle(150);
      sel = await s.eval(() => SelectionModel.getSelected());
      t.assert(sel.length === 800 && sel.every((id) => active.includes(id)), 'Markera alla 800 som matchar markerar hela urvalet, inga fakturerade/arkiverade (' + sel.length + ')');
      const bar = await selbarText(s);
      t.assert(/^800 arbetsordrar markerade · 650 ej utritade i listan$/.test(bar), 'bulk-baren säger att 650 av de markerade inte är utritade: "' + bar + '"');
      await s.eval(() => SelectionModel.clearAll());
      // Visa fler → 450, Visa alla → 800; alla aktiva AO nåbara.
      await s.page.locator('#ao-list .aol-foot button', { hasText: 'Visa 300 till' }).click();
      await s.settle(250);
      t.assert((await rowIds(s)).length === 450, 'Visa 300 till → 450 rader');
      ft = await foot();
      t.assert(ft.txt === 'Visar 450 av 800 arbetsordrar', 'sidfoten uppdateras: ' + ft.txt);
      await s.page.locator('#ao-list .aol-foot button', { hasText: 'Visa alla 800' }).click();
      await s.settle(300);
      const all = await rowIds(s);
      t.assert(all.length === 800 && new Set(all).size === 800 && active.every((id) => all.includes(id)), 'Visa alla → varje aktiv AO finns i listan (' + all.length + ')');
      ft = await foot();
      t.assert(ft.txt === 'Visar alla 800 arbetsordrar' && ft.btns.length === 0, 'sidfoten: Visar alla 800, inga fler knappar ' + JSON.stringify(ft));
      t.assert((await countText(s)) === 'Visar alla 800 aktiva arbetsordrar', 'rubriken när allt visas: ' + (await countText(s)));
      // Sökning som matchar fler än som ritas: "Visar 150 av 800 som matchar (av 800 aktiva …)"
      await openList(s, 'list');
      await s.page.fill('#ao-search', 'Synt'); await s.settle(350);
      t.assert((await countText(s)) === 'Visar 150 av 800 som matchar (av 800 aktiva arbetsordrar)', 'sökning + begränsning: ' + (await countText(s)));
      await s.page.fill('#ao-search', 'zebra'); await s.settle(350);
      t.assert((await countText(s)) === 'Visar 115 av 800 aktiva arbetsordrar' && (await rowIds(s)).length === 115, 'sökning utan begränsning: ' + (await countText(s)));
      // Litet urval: ingen sidfot, Välj alla (6).
      await s.eval(() => WorkOrdersPage.clearSearch()); await s.settle(200);
      await s.page.locator('#pg-ao .ao-status-tabs .ft', { hasText: 'Fakturerad' }).click();
      await s.settle(250);
      t.assert((await countText(s)) === 'Visar alla 6 arbetsordrar med status Fakturerad', 'statusurvalet räknas: ' + (await countText(s)));
      t.assert(await s.eval(() => !document.querySelector('#ao-list .aol-foot') && !document.querySelector('#ao-list .aol-selmatch')), 'ingen sidfot och ingen "Markera alla som matchar" när allt visas');
      t.assert((await s.text('#ao-list .aol-selall')).trim() === 'Välj alla (6)', 'Välj alla (6)');
    },
  },
  {
    id: 'AOL-02', module: 'Arbetsordrar', name: 'Filterhierarki: Status och Snabbval är skilda kontroller; status + snabbval + sökning ger rätt antal, varje filter kan tas bort i sammanfattningen och Rensa filter återställer allt',
    async run(t) {
      const today = localDay(0);
      const aos = synth(t.fake, 90, (i) => ({
        priority: i % 4 === 0 ? 'akut' : 'normal',
        staff: i % 7 === 0 ? [] : i % 3 === 0 ? ['ST-001'] : ['ST-002'],
        title: (i % 2 === 0 ? 'Zeta ' : 'Omega ') + i,
        scheduledDate: i % 5 === 0 ? today : '',
      }));
      t.fake.set('workOrders', aos);
      const live = aos.filter((a) => a.status !== 'fakturerad' && !a.archived);
      const plan = live.filter((a) => a.status === 'planerad');
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openList(s, 'list');
      // Hierarki: två rader med egna etiketter; statusflikar i statusraden, snabbval-chips i snabbvalsraden.
      const h = await s.eval(() => ({
        labels: [...document.querySelectorAll('#pg-ao .aol-flabel')].map((e) => e.textContent.trim()),
        tabsInStatus: document.querySelectorAll('#pg-ao .aol-frow-status .ao-status-tabs .ft').length,
        chipsInQuick: document.querySelectorAll('#pg-ao .aol-frow-quick .ao-quick .chip').length,
        tabsElsewhere: document.querySelectorAll('#pg-ao .aol-frow-quick .ft').length,
        sep: !!document.querySelector('#pg-ao .ao-status-tabs .aol-tab-sep'),
      }));
      t.assert(h.labels.join('|') === 'Status|Snabbval', 'etiketterna Status och Snabbval ' + JSON.stringify(h));
      t.assert(h.tabsInStatus === 9 && h.chipsInQuick === 6 && h.tabsElsewhere === 0 && h.sep, 'statusflikar (7 + Arkiv/Papperskorg avskilda) och 6 snabbval i var sin rad ' + JSON.stringify(h));
      t.assert((await countText(s)) === 'Visar alla ' + live.length + ' aktiva arbetsordrar', 'utan filter: alla aktiva');
      // Status Planerad + Akuta + sökning "zeta"
      await s.page.locator('#pg-ao .ao-status-tabs .ft', { hasText: 'Planerad' }).click(); await s.settle(200);
      await s.page.locator('#pg-ao .ao-quick .chip', { hasText: 'Akuta' }).click(); await s.settle(200);
      await s.page.fill('#ao-search', 'zeta'); await s.settle(300);
      let exp = plan.filter((a) => a.priority === 'akut' && /zeta/i.test(a.title));
      t.assert(exp.length > 0, 'testdata ger träffar');
      let ids = await rowIds(s);
      t.assert(ids.length === exp.length && exp.every((a) => ids.includes(a.id)), 'Planerad + Akuta + "zeta": ' + exp.length + ' rader (' + ids.length + ')');
      t.assert((await countText(s)) === 'Visar ' + exp.length + ' av ' + plan.length + ' arbetsordrar med status Planerad', 'rubriken: ' + (await countText(s)));
      const chips = () => s.eval(() => [...document.querySelectorAll('#ao-active-filters .aol-fchip > span')].map((e) => e.textContent.trim()));
      t.assert((await chips()).join('|') === 'Status: Planerad|Akuta|Sök: “zeta”', 'sammanfattningen visar varje filter: ' + (await chips()).join('|'));
      t.assert(await s.eval(() => document.querySelector('#pg-ao .ao-status-tabs .ft.on').textContent.startsWith('Planerad') && document.querySelector('#pg-ao .ao-quick .chip.on').getAttribute('aria-pressed') === 'true'), 'aktiv status och aktivt snabbval är markerade');
      // Ta bort Akuta i sammanfattningen
      await s.page.locator('#ao-active-filters .aol-fchip', { hasText: 'Akuta' }).locator('button').click(); await s.settle(250);
      exp = plan.filter((a) => /zeta/i.test(a.title));
      ids = await rowIds(s);
      t.assert(ids.length === exp.length && (await chips()).join('|') === 'Status: Planerad|Sök: “zeta”', 'utan Akuta: ' + exp.length + ' rader (' + ids.length + ')');
      // Mina (ST-001), sedan Otilldelade (utesluter Mina — samma regel som förut)
      await s.page.locator('#pg-ao .ao-quick .chip', { hasText: 'Mina' }).click(); await s.settle(250);
      exp = plan.filter((a) => /zeta/i.test(a.title) && a.staff.includes('ST-001'));
      ids = await rowIds(s);
      t.assert(ids.length === exp.length && exp.every((a) => ids.includes(a.id)), 'Planerad + Mina + "zeta": ' + exp.length + ' (' + ids.length + ')');
      await s.page.locator('#pg-ao .ao-quick .chip', { hasText: 'Otilldelade' }).click(); await s.settle(250);
      exp = plan.filter((a) => /zeta/i.test(a.title) && !a.staff.length);
      ids = await rowIds(s);
      t.assert(ids.length === exp.length && (await chips()).join('|') === 'Status: Planerad|Otilldelade|Sök: “zeta”', 'Otilldelade ersätter Mina: ' + exp.length + ' (' + ids.length + ') ' + (await chips()).join('|'));
      // Idag i kombination med status Aktiva och sökning
      await s.page.locator('#ao-active-filters .aol-fchip', { hasText: 'Status: Planerad' }).locator('button').click(); await s.settle(250);
      exp = live.filter((a) => /zeta/i.test(a.title) && !a.staff.length);
      t.assert((await rowIds(s)).length === exp.length, 'Aktiva + Otilldelade + "zeta": ' + exp.length);
      // Rensa filter
      await s.page.locator('#ao-active-filters .aol-reset').click(); await s.settle(300);
      const r = await s.eval(() => ({ filter: WorkOrdersPage.filter, q: WorkOrdersPage.q, input: document.getElementById('ao-search').value, on: document.querySelectorAll('#pg-ao .ao-quick .chip.on').length, summary: document.querySelectorAll('#ao-active-filters .aol-summary').length, tab: document.querySelector('#pg-ao .ao-status-tabs .ft.on').textContent }));
      t.assert(r.filter === 'alla' && r.q === '' && r.input === '' && r.on === 0 && r.summary === 0 && /^Aktiva/.test(r.tab), 'Rensa filter: Aktiva, inga snabbval, ingen sökning, ingen sammanfattning ' + JSON.stringify(r));
      t.assert((await rowIds(s)).length === live.length && (await countText(s)) === 'Visar alla ' + live.length + ' aktiva arbetsordrar', 'alla aktiva visas igen');
      // Dashboardlänk med filter (oförändrat beteende): akut
      await s.go('pg-ao', { filter: 'akut' });
      exp = live.filter((a) => a.priority === 'akut');
      t.assert((await rowIds(s)).length === exp.length && (await chips()).join('|') === 'Akuta', 'navigering med filter=akut ger Aktiva + Akuta (' + exp.length + ')');
    },
  },
  {
    id: 'AOL-03', kind: 'workflow', module: 'Arbetsordrar', name: 'Massändring: markerade som filtret döljer ingår aldrig — bulk-baren och dialogerna räknar upp dem, bekräftelsen säger exakt hur många som ändras och servern får bara de synliga',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openList(s, 'list');
      await check(s, 'AO-003'); await check(s, 'AO-006'); await check(s, 'AO-007');
      t.assert(/^3 arbetsordrar markerade$/.test(await selbarText(s)), 'tre markerade i Aktiva');
      await s.page.locator('#pg-ao .ao-status-tabs .ft', { hasText: 'Nytt' }).click(); await s.settle(250);
      t.assert((await selbarText(s)) === '3 arbetsordrar markerade · 1 dold av filtret ingår inte', 'bulk-baren säger att en markerad döljs och inte ingår: ' + (await selbarText(s)));
      await s.page.locator('#_selbar .selbar-actions button[data-action-id="status"]').click();
      let m = await waitModal(s, /^Ändra status på/);
      t.assert(m.title === 'Ändra status på 2 arbetsordrar', 'statusdialogen gäller 2: ' + m.title);
      t.assert(/Gäller 2 arbetsordrar: AO-003, AO-006/.test(m.body), 'dialogen säger vilka: ' + m.body.split('\n')[0]);
      t.assert(/1 markerad döljs av nuvarande filter och ingår inte: AO-007/.test(m.body), 'dialogen säger vilka som döljs');
      await s.page.locator('.modal-overlay.open .crow', { hasText: 'Pågående' }).click();
      m = await waitModal(s, /^Ändra status på 2/);
      t.assert(m.buttons[0] === 'Ändra status på 2' && /Ändras \(2\): AO-003, AO-006/.test(m.body), 'bekräftelsen: exakt 2 och vilka ' + JSON.stringify(m));
      t.assert(/1 markerad som döljs av nuvarande filter ingår inte/.test(m.body), 'bekräftelsen nämner de dolda');
      await s.clearToasts();
      await s.clickModalButton(/^Ändra status på 2$/);
      await s.waitToast(/^2 arbetsorder uppdaterade till "Pågående"\.$/);
      await s.page.waitForFunction(() => !AOTimeSyncService._busy && SelectionModel.count() === 0, null, { timeout: 8000 }).catch(() => {});
      await s.settle(800);
      const srv = Object.fromEntries(t.fake.get('workOrders').map((a) => [a.id, a.status]));
      t.assert(srv['AO-003'] === 'pågående' && srv['AO-006'] === 'pågående', 'servern: de två synliga ändrade ' + srv['AO-003'] + '/' + srv['AO-006']);
      t.assert(srv['AO-007'] === 'planerad' && srv['AO-015'] === 'nytt', 'servern: dold markerad (AO-007) och omarkerad (AO-015) orörda');
      // Plan med "har redan statusen": AO-001 och AO-008 är pågående, AO-013 planerad
      await openList(s, 'list');
      await check(s, 'AO-001'); await check(s, 'AO-008'); await check(s, 'AO-013');
      await s.page.locator('#_selbar .selbar-actions button[data-action-id="status"]').click();
      await waitModal(s, /^Ändra status på 3/);
      await s.page.locator('.modal-overlay.open .crow', { hasText: 'Pågående' }).click();
      m = await waitModal(s, /^Ändra status på 1 arbetsorder$/);
      t.assert(m.buttons[0] === 'Ändra status på 1' && /2 har redan status "Pågående" och ändras inte: AO-001, AO-008/.test(m.body), 'bekräftelsen räknar bara den som faktiskt ändras ' + JSON.stringify(m));
      await s.clearToasts();
      await s.clickModalButton(/^Ändra status på 1$/);
      await s.waitToast(/^1 arbetsorder uppdaterade till "Pågående"\. 2 redan hade den statusen\.$/);
      // Alla markerade dolda → inget ändras, ingen dialog
      await openList(s, 'list');
      await check(s, 'AO-004');
      await s.page.fill('#ao-search', 'Rörinspektion'); await s.settle(250);
      await s.clearToasts();
      await s.page.locator('#_selbar .selbar-actions button[data-action-id="status"]').click();
      await s.waitToast(/Ingen av de markerade arbetsordrarna syns med nuvarande filter/);
      t.assert(!(await s.modalOpen()), 'ingen dialog när alla markerade döljs');
      // Lägg till personal: AO-004 och AO-009 markerade, sökningen döljer AO-009
      await openList(s, 'list');
      await check(s, 'AO-004'); await check(s, 'AO-009');
      await s.page.fill('#ao-search', 'Fasadtvätt'); await s.settle(250);
      t.assert((await selbarText(s)) === '2 arbetsordrar markerade · 1 dold av filtret ingår inte', 'sökning döljer en markerad: ' + (await selbarText(s)));
      const scope = await s.eval(() => WorkOrdersPage._exportScope(state.workOrders.filter((a) => ['AO-004', 'AO-009'].includes(a.id))).map((a) => a.id));
      t.assert(scope.join(',') === 'AO-004', 'export gäller bara den synliga markerade: ' + scope.join(','));
      await s.page.locator('#_selbar .selbar-actions button[data-action-id="assign"]').click();
      m = await waitModal(s, /^Lägg till personal på/);
      t.assert(m.title === 'Lägg till personal på 1 arbetsorder' && /Gäller 1 arbetsorder: AO-004/.test(m.body) && /1 markerad döljs av nuvarande filter och ingår inte: AO-009/.test(m.body), 'personaldialogen: 1 och vilken som döljs ' + JSON.stringify(m));
      await s.page.locator('.modal-overlay.open #bulkassign-ST-003').check();
      await s.clickModalButton(/^Lägg till på 1 arbetsorder$/);
      await s.waitToast(/^1 arbetsorder uppdaterade\.$/);
      await s.settle(800);
      const w = Object.fromEntries(t.fake.get('workOrders').map((a) => [a.id, a.staff || []]));
      t.assert(w['AO-004'].includes('ST-003') && !w['AO-009'].includes('ST-003'), 'servern: bara AO-004 fick personal ' + JSON.stringify([w['AO-004'], w['AO-009']]));
    },
  },
  {
    id: 'AOL-04', module: 'Arbetsordrar', name: 'Sortering: kolumnrubrikerna sorterar och vänder ordningen med synlig pil och aria-sort; sorteringsväljaren följer med; utan datum hamnar sist i båda riktningarna',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openList(s, 'list');
      const st = () => s.eval(() => {
        const rows = [...document.querySelectorAll('#ao-list tr.aol-row')].map((tr) => getAO(tr.getAttribute('data-sel-row-id')));
        return {
          sorted: [...document.querySelectorAll('#pg-ao th.is-sorted')].map((th) => th.textContent.trim() + ':' + th.getAttribute('aria-sort')),
          arrow: !!document.querySelector('#pg-ao th.is-sorted .aol-th-ind svg'),
          sel: document.getElementById('ao-sort').value,
          dates: rows.map((a) => a.scheduledDate || ''), nums: rows.map((a) => WorkOrderService.displayNumberOrPending(a)),
          cust: rows.map((a) => { const c = getCu(a.customerId); return c ? CustomerService.displayName(c) : ''; }), status: rows.map((a) => a.status),
        };
      });
      let r = await st();
      t.assert(r.sorted.length === 0 && r.sel === 'default', 'standard: ingen kolumn markerad som sorterad');
      const head = (txt) => s.page.locator('#pg-ao th .aol-th-btn', { hasText: txt }).click().then(() => s.settle(200));
      await head('Planerat');
      r = await st();
      const withDate = r.dates.filter(Boolean);
      t.assert(r.sorted.join() === 'Planerat:ascending' && r.arrow && r.sel === 'scheduled', 'Planerat stigande med pil ' + JSON.stringify(r.sorted));
      t.assert(withDate.every((d, i) => i === 0 || withDate[i - 1] <= d) && r.dates.indexOf('') === withDate.length, 'datum stigande, utan datum sist ' + r.dates.join(','));
      await head('Planerat');
      r = await st();
      const withDate2 = r.dates.filter(Boolean);
      t.assert(r.sorted.join() === 'Planerat:descending' && r.sel === 'scheduled:desc', 'andra klicket vänder ordningen ' + JSON.stringify(r.sorted) + ' ' + r.sel);
      t.assert(withDate2.every((d, i) => i === 0 || withDate2[i - 1] >= d) && r.dates.indexOf('') === withDate2.length, 'datum fallande, utan datum fortfarande sist ' + r.dates.join(','));
      await head('Uppdrag');
      r = await st();
      const n = r.nums.map((x) => Number(x.replace(/\D/g, '')));
      t.assert(r.sorted.join() === 'Uppdrag:ascending' && n.every((x, i) => i === 0 || n[i - 1] < x), 'AO-nummer stigande (numeriskt) ' + r.nums.join(','));
      await head('Uppdrag');
      r = await st();
      const n2 = r.nums.map((x) => Number(x.replace(/\D/g, '')));
      t.assert(r.sel === 'number:desc' && n2.every((x, i) => i === 0 || n2[i - 1] > x), 'AO-nummer fallande ' + r.nums.join(','));
      await s.page.selectOption('#ao-sort', 'customer');
      await s.settle(200);
      r = await st();
      const coll = new Intl.Collator('sv', { numeric: true, sensitivity: 'base' });
      t.assert(r.sorted.join() === 'Kund och plats:ascending' && r.cust.every((c, i) => i === 0 || coll.compare(r.cust[i - 1], c) <= 0), 'väljaren Kund A–Ö markerar kolumnen och sorterar ' + r.cust.join(','));
      await head('Status');
      r = await st();
      const ord = { nytt: 0, pool: 1, planerad: 2, pågående: 3, klar: 4, avbruten: 5, fakturerad: 6 };
      t.assert(r.sorted.join() === 'Status:ascending' && r.status.every((x, i) => i === 0 || ord[r.status[i - 1]] <= ord[x]), 'status i arbetsflödesordning ' + r.status.join(','));
      await head('Status');
      r = await st();
      t.assert(r.sel === 'status:desc' && await s.eval(() => [...document.getElementById('ao-sort').options].some((o) => o.value === 'status:desc' && /omvänd/.test(o.textContent))), 'omvänd status finns som val i väljaren');
      await s.page.selectOption('#ao-sort', 'default');
      await s.settle(200);
      t.assert((await st()).sorted.length === 0, 'tillbaka till standard');
    },
  },
  {
    id: 'AOL-05', module: 'Arbetsordrar', name: 'Dubblerade AO-nummer: två olika AO med samma synliga nummer (som AO-001 i STAGING) skiljs åt med kort id i lista, kort och mobil — inget lagrat nummer ändras',
    async run(t) {
      const aos = t.fake.get('workOrders');
      aos.find((a) => a.id === 'AO-001').displayNumber = 'AO-001';
      aos.push({ id: 'AO-bfc37f77-4793-4c59-b46b-34209a9fa954', displayNumber: 'AO-001', title: 'E2E Dubblettnummer', customerId: 'K-002', status: 'klar', priority: 'normal', staff: [], log: [], checklist: [], materials: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      aos.push({ id: 'AO-abcdef12-1111-4111-8111-111111111111', displayNumber: 'AO-777', title: 'E2E Samma prefix A', customerId: 'K-001', status: 'nytt', priority: 'normal', staff: [], log: [], checklist: [], materials: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      aos.push({ id: 'AO-abcdef12-2222-4222-8222-222222222222', displayNumber: 'AO-777', title: 'E2E Samma prefix B', customerId: 'K-001', status: 'nytt', priority: 'normal', staff: [], log: [], checklist: [], materials: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      t.fake.set('workOrders', aos);
      const before = JSON.stringify(t.fake.get('workOrders').map((a) => [a.id, a.displayNumber || null]));
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openList(s, 'list');
      const labels = (sel) => s.eval((q) => Object.fromEntries([...document.querySelectorAll('#ao-list [data-sel-row-id]')].map((r) => {
        const no = r.querySelector(q); const tag = no && no.parentElement.querySelector('.aol-dupid');
        return [r.getAttribute('data-sel-row-id'), (no ? no.textContent : '') + (tag ? ' ' + tag.textContent : '')];
      })), sel);
      let L = await labels('.aol-line2 .aol-no');
      t.assert(L['AO-001'] === 'AO-001 id AO-001' && L['AO-bfc37f77-4793-4c59-b46b-34209a9fa954'] === 'AO-001 id bfc37f', 'AO-001-paret skiljs åt: ' + L['AO-001'] + ' / ' + L['AO-bfc37f77-4793-4c59-b46b-34209a9fa954']);
      t.assert(L['AO-abcdef12-1111-4111-8111-111111111111'] === 'AO-777 id abcdef1211' && L['AO-abcdef12-2222-4222-8222-222222222222'] === 'AO-777 id abcdef1222', 'samma 6 första tecken → längre kort-id: ' + L['AO-abcdef12-1111-4111-8111-111111111111'] + ' / ' + L['AO-abcdef12-2222-4222-8222-222222222222']);
      const visible = Object.values(L);
      t.assert(new Set(visible).size === visible.length, 'varje synlig etikett i listan är unik');
      t.assert(L['AO-008'] === 'AO-008', 'nummer utan dubblett visas som förut (inget kort-id)');
      const info = await s.eval(() => { const i = WorkOrdersPage.labelInfo(getAO('AO-bfc37f77-4793-4c59-b46b-34209a9fa954')); return i.label + '|' + (i.tag && i.tag.text) + '|' + (i.tag && i.tag.title); });
      t.assert(/^AO-001\|id bfc37f\|2 arbetsordrar visas som AO-001\. Internt id: AO-bfc37f77/.test(info), 'labelInfo() för andra vyer: ' + info);
      // Sökning på kort-id hittar rätt post
      await s.page.fill('#ao-search', 'bfc37f'); await s.settle(250);
      const ids = await rowIds(s);
      t.assert(ids.length === 1 && ids[0] === 'AO-bfc37f77-4793-4c59-b46b-34209a9fa954', 'sökning på kort-id ger exakt den posten');
      // Kortvy och mobil
      await openList(s, 'grid');
      L = await labels('.aol-card-no .aol-no');
      t.assert(L['AO-001'] === 'AO-001 id AO-001' && L['AO-bfc37f77-4793-4c59-b46b-34209a9fa954'] === 'AO-001 id bfc37f', 'kortvyn visar kort-id');
      const m = await t.world.session({ viewport: 'iphone' });
      await m.login('admin');
      await openList(m, 'list');
      const mob = await m.eval(() => { const r = document.querySelector('#ao-list [data-sel-row-id="AO-bfc37f77-4793-4c59-b46b-34209a9fa954"] .aol-m-no'); return r && r.offsetParent ? r.textContent.replace(/\s+/g, ' ').trim() : null; });
      t.assert(mob === 'AO-001id bfc37f' || mob === 'AO-001 id bfc37f', 'mobilen visar kort-id i datumraden: ' + mob);
      await m.eval(() => WorkOrdersPage.setFilter('klar'));
      await m.settle(200);
      t.assert((await m.layoutIssues()).length === 0, 'mobil: kort-id ger ingen sidledsrullning');
      // Inget lagrat nummer ändrat
      const after = JSON.stringify(t.fake.get('workOrders').map((a) => [a.id, a.displayNumber || null]));
      t.assert(before === after, 'serverns displayNumber och id oförändrade');
      t.assert(!t.fake.calls.some((c) => /ao-time-write:(patch_ao|create_ao)/.test(c.action)), 'inga skrivningar av AO');
    },
  },
  {
    id: 'AOL-06', module: 'Arbetsordrar', name: 'Prestanda 10/100/1000 AO: första rendering, statusbyte, snabbval, sökning (med väntan på paus i skrivandet) och Visa alla — budget vid 1000: rendering < 1500 ms, sökning < 300 ms',
    async run(t) {
      const out = {};
      for (const n of [10, 100, 1000]) {
        const aos = synth(t.fake, n, (i) => ({
          title: 'Perf arbetsorder ' + i + (i % 3 ? ' ventil' : ' tak'), priority: ['normal', 'normal', 'hög', 'låg', 'akut'][i % 5],
          status: ['nytt', 'pool', 'planerad', 'pågående', 'klar', 'fakturerad'][i % 6],
          staff: [['ST-002'], ['ST-003', 'ST-004'], [], ['ST-002', 'ST-003', 'ST-004', 'ST-005'], ['ST-004']][i % 5],
          scheduledDate: i % 7 ? localDay((i % 21) - 10) : '', checklist: i % 4 ? [] : [{ id: 'c1', text: 'a', done: true }, { id: 'c2', text: 'b', done: false }],
        }));
        t.fake.set('workOrders', aos);
        const expSearch = aos.filter((a) => a.status !== 'fakturerad' && / ventil$/.test(a.title)).length;
        const s = await t.world.session({ viewport: 'laptop' });
        await s.login('admin');
        await s.eval(() => { try { localStorage.setItem('view-ao', 'list'); } catch (e) {} WorkOrdersPage.viewMode = 'list'; WorkOrdersPage.filter = 'alla'; WorkOrdersPage.q = ''; WorkOrdersPage._f = WorkOrdersPage._defaultFilters(false); });
        const m = await s.eval(async (expN) => {
          const r = {};
          const frame = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
          const time = async (k, fn) => { const a = performance.now(); await fn(); await frame(); r[k] = Math.round(performance.now() - a); };
          await time('rendering_ms', () => Router.showPage('pg-ao', {}));
          r.rader = document.querySelectorAll('#ao-list [data-sel-row-id]').length;
          await time('statusbyte_ms', () => WorkOrdersPage.setFilter('planerad'));
          await time('statusbyte_tillbaka_ms', () => WorkOrdersPage.setFilter('alla'));
          await time('snabbval_ms', () => WorkOrdersPage.toggleQuick('akut'));
          await time('snabbval_av_ms', () => WorkOrdersPage.toggleQuick('akut'));
          // Skriv "ventil" tecken för tecken; mät till listan visar rätt antal efter sista tecknet.
          const inp = document.getElementById('ao-search');
          let renders = 0; const orig = WorkOrdersPage.renderList; WorkOrdersPage.renderList = function () { renders++; return orig.apply(this, arguments); };
          const a = performance.now();
          for (const ch of 'ventil') { inp.value += ch; inp.dispatchEvent(new Event('input', { bubbles: true })); }
          const done = () => { const c = document.querySelector('#ao-list .aol-count-txt'); return WorkOrdersPage._qTimer === null && WorkOrdersPage._matchIds.length === expN && !!c && [...c.querySelectorAll('strong')].some((x) => Number(x.textContent) === expN); };
          while (!done() && performance.now() - a < 3000) await new Promise((res) => setTimeout(res, 4));
          await frame();
          r.sokning_ms = Math.round(performance.now() - a);
          r.sokning_renderingar = renders;
          WorkOrdersPage.renderList = orig;
          await time('sokning_enbart_rendering_ms', () => WorkOrdersPage.renderList());
          WorkOrdersPage.clearSearch(); await frame();
          await time('visa_alla_ms', () => WorkOrdersPage.showAll());
          r.rader_visa_alla = document.querySelectorAll('#ao-list [data-sel-row-id]').length;
          return r;
        }, expSearch);
        out[n] = m;
        Object.entries(m).forEach(([k, v]) => t.metric(n + ' AO: ' + k, v));
        await s.context.close();
      }
      t.note('mätvärden (ms, lokal headless Chromium, simulerad server): ' + JSON.stringify(out));
      const big = out[1000];
      t.assert(big.rader === 150 && big.rader_visa_alla === 834, '1000 AO: 150 rader först, 834 aktiva efter Visa alla (' + big.rader + '/' + big.rader_visa_alla + ')');
      t.assert(big.rendering_ms < 1500, '1000 AO: första rendering < 1500 ms (' + big.rendering_ms + ')');
      t.assert(big.sokning_ms < 300, '1000 AO: sökning klar < 300 ms efter sista tecknet (' + big.sokning_ms + ')');
      t.assert(big.sokning_renderingar <= 2, '1000 AO: sökningen ritar inte om listan per tangent (' + big.sokning_renderingar + ' renderingar för 6 tecken)');
      t.assert(out[10].sokning_renderingar <= 2 && out[100].sokning_renderingar <= 2 && out[100].sokning_ms < 300, 'även små listor: en rendering efter pausen, inte en per tangent');
    },
  },
  {
    id: 'AOL-07', module: 'Arbetsordrar', name: 'Layout 360–1920: ingen sidledsrullning i lista, kortvy, med filter och i markeringsläge; vy-växlaren syns överallt; avatarer överlappar inte (F-22); mobilens kryssrutor ≥ 40 px',
    async run(t) {
      // Realistiskt innehåll (100 AO, alla statusar, långa namn, saknade fält, dubblettnummer) + demodatan.
      t.fake.set('workOrders', t.fake.get('workOrders').filter((a) => a.id !== 'AO-001').concat(realistic(t.fake, 100)));
      const problems = [];
      for (const vp of ['android', 'iphone', 'w768', 'w1024', 'laptop', 'desktop']) {
        const s = await t.world.session({ viewport: vp });
        await s.login('admin');
        for (const mode of ['list', 'grid']) {
          await openList(s, mode);
          const li = await s.layoutIssues();
          if (li.length) problems.push(vp + ' ' + mode + ': ' + li.join('; '));
          const v = await s.eval(() => { const e = document.querySelector('#ao-list .aol-viewseg'); const r = e && e.getBoundingClientRect(); return !!(r && r.width > 0 && getComputedStyle(e).display !== 'none'); });
          if (!v) problems.push(vp + ' ' + mode + ': vy-växlaren syns inte');
          const ov = await s.eval(() => {
            const bad = [];
            document.querySelectorAll('#ao-list .aol-staff .av-stack').forEach((st) => {
              const av = [...st.querySelectorAll('.av')].map((a) => a.getBoundingClientRect()).filter((r) => r.width > 0);
              for (let i = 1; i < av.length; i++) if (av[i].left < av[i - 1].right - 0.5) bad.push(Math.round(av[i - 1].right - av[i].left));
            });
            return bad;
          });
          if (ov.length) problems.push(vp + ' ' + mode + ': avatarer överlappar ' + ov.join(','));
        }
        // Filter aktiva (sammanfattningsraden) i listvy
        await openList(s, 'list');
        await s.eval(() => { WorkOrdersPage.filter = 'klar'; WorkOrdersPage._f.quick = 'readyForInvoice'; WorkOrdersPage.q = 'a'; WorkOrdersPage.render(); });
        await s.settle(200);
        let li = await s.layoutIssues();
        if (li.length) problems.push(vp + ' filter: ' + li.join('; '));
        // Arkiv och papperskorg (återställ-/radera-knappar på raderna)
        for (const k of ['arkiverade', 'papperskorg']) {
          await s.eval((x) => { WorkOrdersPage.q = ''; WorkOrdersPage.setFilter(x); }, k); await s.settle(200);
          li = await s.layoutIssues();
          const nBtn = await s.eval(() => document.querySelectorAll('#ao-list .aol-row-actions button, #ao-list .aol-card-actions button').length);
          if (li.length) problems.push(vp + ' ' + k + ': ' + li.join('; '));
          if (!nBtn) problems.push(vp + ' ' + k + ': inga återställ-knappar');
        }
        // Saknade fält: "Utan titel" och "—" i stället för tomt
        await openList(s, 'list');
        const empty = await s.eval(() => { const r = document.querySelector('#ao-list .aol-title.is-empty'); return r ? r.textContent.trim() : null; });
        if (empty !== 'Utan titel') problems.push(vp + ': AO utan titel visas inte som "Utan titel" (' + empty + ')');
        const mobile = ['android', 'iphone', 'w768'].includes(vp);
        // Markeringsläge
        await openList(s, 'list');
        const pick = await s.eval(() => { const b = document.querySelector('#ao-list .aol-pickbtn'); return !!(b && b.getBoundingClientRect().width > 0 && getComputedStyle(b).display !== 'none'); });
        if (pick !== mobile) problems.push(vp + ': Markera-knappen ' + (mobile ? 'saknas på mobil' : 'syns på dator i listvy'));
        if (mobile) {
          await s.page.locator('#ao-list .aol-pickbtn').click(); await s.settle(200);
          const cb = await s.eval(() => [...document.querySelectorAll('#ao-list .aol-c-sel .sel-cb-wrap')].map((w) => w.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => [Math.round(r.width), Math.round(r.height)]));
          if (!cb.length || cb.some(([w, h]) => w < 40 || h < 40)) problems.push(vp + ': kryssrutornas tryckyta < 40 px ' + JSON.stringify(cb.slice(0, 3)));
          // Tryck på en rad i markeringsläget markerar (öppnar inte)
          await s.page.locator('#ao-list tr.aol-row').first().click({ position: { x: 120, y: 12 } }); await s.settle(200);
          const st = await s.eval(() => ({ page: Router.currentPage, n: SelectionModel.count(), selall: (() => { const e = document.querySelector('#ao-list .ao-selall-cell'); return !!e && e.getBoundingClientRect().width > 0; })() }));
          if (st.page !== 'pg-ao' || st.n !== 1 || !st.selall) problems.push(vp + ': tryck i markeringsläge ' + JSON.stringify(st));
          li = await s.layoutIssues();
          if (li.length) problems.push(vp + ' markeringsläge: ' + li.join('; '));
          // Avatarer får inte täckas av kryssrutan
          const cover = await s.eval(() => { const r = document.querySelector('#ao-list tr.aol-row.selected'); if (!r) return null; const c = r.querySelector('.aol-c-sel').getBoundingClientRect(); const a = r.querySelector('.aol-c-staff').getBoundingClientRect(); return c.right <= a.left || c.left >= a.right || c.bottom <= a.top || c.top >= a.bottom; });
          if (cover === false) problems.push(vp + ': kryssrutan ligger ovanpå personalavatarerna');
          await s.eval(() => SelectionModel.clearAll());
        }
        await s.context.close();
      }
      t.assert(problems.length === 0, problems.join(' ;; '));
    },
  },
  {
    id: 'AOL-08', module: 'Arbetsordrar', name: 'Snabb öppning från listan: klick och Enter öppnar AO-detaljen direkt; mellanslag markerar raden; Tillbaka ger samma filter och sökning',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openList(s, 'list');
      await s.page.locator('#pg-ao .ao-status-tabs .ft', { hasText: 'Planerad' }).click(); await s.settle(200);
      await s.page.fill('#ao-search', 'Rör'); await s.settle(200);
      const t0 = Date.now();
      await s.page.locator('#ao-list tr[data-sel-row-id="AO-007"] .aol-title').click();
      await s.page.waitForFunction(() => Router.currentPage === 'pg-ao-detail' && WorkOrderDetailPage.aoId === 'AO-007', null, { timeout: 4000 });
      t.metric('klick → AO-detalj (ms)', Date.now() - t0);
      await s.eval(() => Router.back()); await s.settle(400);
      const back = await s.eval(() => ({ page: Router.currentPage, filter: WorkOrdersPage.filter, q: document.getElementById('ao-search').value, rows: [...document.querySelectorAll('#ao-list [data-sel-row-id]')].map((e) => e.getAttribute('data-sel-row-id')) }));
      t.assert(back.page === 'pg-ao' && back.filter === 'planerad' && back.q === 'Rör' && back.rows.join() === 'AO-007', 'tillbaka: samma status och sökning ' + JSON.stringify(back));
      await s.page.locator('#ao-list tr[data-sel-row-id="AO-007"]').focus();
      await s.page.keyboard.press(' ');
      await s.settle(150);
      t.assert(await s.eval(() => SelectionModel.isSelected('AO-007') && document.querySelector('#ao-list tr[data-sel-row-id="AO-007"]').classList.contains('selected')), 'mellanslag markerar raden');
      await s.page.keyboard.press(' ');
      await s.settle(150);
      t.assert(await s.eval(() => SelectionModel.count() === 0), 'mellanslag igen avmarkerar');
      await s.page.keyboard.press('Enter');
      await s.page.waitForFunction(() => Router.currentPage === 'pg-ao-detail' && WorkOrderDetailPage.aoId === 'AO-007', null, { timeout: 4000 });
    },
  },
  {
    id: 'AOL-09', kind: 'workflow', module: 'Arbetsordrar', name: 'Mobil 390/360 med 100 realistiska AO: hitta sitt jobb (Mina + sök), filtrera (statusväljare + snabbval), öppna AO, massval och massändring — inget klipps och inget hamnar utanför skärmen',
    async run(t) {
      t.fake.set('workOrders', realistic(t.fake, 100));
      const inView = (s, sel) => s.eval((q) => [...document.querySelectorAll(q)].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || '').trim().slice(0, 40), ok: r.left >= -0.5 && r.right <= window.innerWidth + 0.5, clip: e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' }; }), sel);
      for (const vp of ['iphone', 'android']) {
        const s = await t.world.session({ viewport: vp });
        await s.login('chef'); // arbetsledare, ST-003
        await openList(s, 'list');
        // 1. Hitta sitt jobb: Mina + sökning
        await s.page.locator('#pg-ao .ao-quick .chip', { hasText: 'Mina' }).click(); await s.settle(250);
        const mine = await s.eval(() => [...document.querySelectorAll('#ao-list [data-sel-row-id]')].map((e) => getAO(e.getAttribute('data-sel-row-id'))));
        t.assert(mine.length > 0 && mine.every((a) => (a.staff || []).includes('ST-003')), vp + ': Mina visar bara arbetsledarens AO (' + mine.length + ')');
        const target = mine.find((a) => a.title && /snöröjning/.test(a.title)) || mine[0];
        const word = String(target.title).split(' ').pop();
        await s.page.fill('#ao-search', word); await s.settle(350);
        const hit = await s.eval((id) => !!document.querySelector('#ao-list [data-sel-row-id="' + id + '"]'), target.id);
        t.assert(hit, vp + ': sökningen hittar jobbet');
        // 2. Öppna AO
        await s.page.locator('#ao-list [data-sel-row-id="' + target.id + '"] .aol-title').click();
        await s.page.waitForFunction((id) => Router.currentPage === 'pg-ao-detail' && WorkOrderDetailPage.aoId === id, target.id, { timeout: 4000 });
        await s.eval(() => Router.back()); await s.settle(400);
        t.assert(await s.eval(() => Router.currentPage === 'pg-ao' && WorkOrdersPage._f.mine === true && !!WorkOrdersPage.q), vp + ': tillbaka med Mina och sökningen kvar');
        // 3. Filtrera med statusväljaren (select på mobil) + snabbval
        await s.page.locator('#ao-active-filters .aol-reset').click(); await s.settle(250);
        await s.page.selectOption('#pg-ao .aol-status-sel select', 'planerad'); await s.settle(250);
        await s.page.locator('#pg-ao .ao-quick .chip', { hasText: 'Idag' }).click(); await s.settle(250);
        const f = await s.eval(() => ({ rows: [...document.querySelectorAll('#ao-list [data-sel-row-id]')].map((e) => getAO(e.getAttribute('data-sel-row-id'))), txt: document.querySelector('#ao-list .aol-count-txt').textContent.replace(/\s+/g, ' ').trim(), today: tdy() }));
        t.assert(f.rows.every((a) => a.status === 'planerad' && a.scheduledDate === f.today) && /^Visar \d+ av \d+ arbetsordrar med status Planerad$/.test(f.txt), vp + ': Planerad + Idag ' + f.txt);
        let li = await s.layoutIssues();
        t.assert(li.length === 0, vp + ': filtrerad vy utan sidledsrullning ' + li.join('; '));
        const chips = await inView(s, '#pg-ao .ao-quick .chip, #ao-active-filters .aol-fchip, #ao-active-filters .aol-reset, #pg-ao .aol-status-sel select');
        t.assert(chips.every((c) => c.ok), vp + ': filterkontrollerna ligger inom skärmen ' + JSON.stringify(chips.filter((c) => !c.ok)));
        // 4. Massval: Markera → tre rader → dölj en med filter → Ändra status via Åtgärder
        await s.page.locator('#ao-active-filters .aol-reset').click(); await s.settle(250);
        await s.page.locator('#ao-list .aol-pickbtn').click(); await s.settle(200);
        // En AO per status (nytt, pool, planerad) — filtret Nytt döljer sedan två av dem.
        const picks = await s.eval(() => { const rows = [...document.querySelectorAll('#ao-list tr.aol-row')].map((r) => getAO(r.getAttribute('data-sel-row-id'))); return ['nytt', 'pool', 'planerad'].map((st) => rows.find((a) => a.status === st).id); });
        for (const id of picks) { await s.page.locator('#ao-list tr[data-sel-row-id="' + id + '"] .aol-title').click(); await s.settle(120); }
        t.assert((await s.eval(() => SelectionModel.count())) === 3, vp + ': tre markerade med tryck i markeringsläget');
        const firstStatus = await s.eval((id) => getAO(id).status, picks[0]);
        await s.page.selectOption('#pg-ao .aol-status-sel select', firstStatus); await s.settle(300);
        const bar = await s.eval(() => { const b = document.getElementById('_selbar'); const c = b.querySelector('.selbar-count'); const r = b.getBoundingClientRect(); return { txt: c.textContent.trim(), clipped: c.scrollWidth > c.clientWidth + 1, left: r.left, right: r.right, vw: window.innerWidth, btns: [...b.querySelectorAll('button')].filter((x) => x.getBoundingClientRect().width > 0).map((x) => { const q = x.getBoundingClientRect(); return q.left >= 0 && q.right <= window.innerWidth; }) }; });
        t.assert(/^3 arbetsordrar markerade · \d+ dolda? av filtret ingår inte$/.test(bar.txt) && !bar.clipped, vp + ': bulk-baren visar dolda utan att klippa texten ' + JSON.stringify(bar));
        t.assert(bar.left >= 0 && bar.right <= bar.vw && bar.btns.every(Boolean), vp + ': bulk-baren och dess knappar inom skärmen');
        await s.page.locator('#_selbar-ovf-btn').click(); await s.settle(150);
        const menu = await inView(s, '#_selbar-ovf-menu .selbar-overflow-item');
        t.assert(menu.length === 3 && menu.every((m) => m.ok), vp + ': Åtgärder-menyn inom skärmen ' + JSON.stringify(menu));
        await s.page.locator('#_selbar-ovf-menu .selbar-overflow-item', { hasText: 'Ändra status' }).click();
        const m = await waitModal(s, /^Ändra status på/);
        const visibleSel = await s.eval(() => SelectionModel.getSelected().filter((id) => WorkOrdersPage._matchSet.has(id)).length);
        t.assert(m.title === 'Ändra status på ' + visibleSel + ' ' + (visibleSel === 1 ? 'arbetsorder' : 'arbetsordrar') && /markerade? döljs av nuvarande filter och ingår inte/.test(m.body), vp + ': dialogen gäller de synliga och nämner de dolda ' + m.title);
        const dlg = await s.eval(() => { const o = [...document.querySelectorAll('.modal-overlay.open .modal-sheet')].pop().getBoundingClientRect(); return { l: o.left, r: o.right, vw: window.innerWidth }; });
        t.assert(dlg.l >= 0 && dlg.r <= dlg.vw, vp + ': dialogen ryms på skärmen');
        await s.page.locator('.modal-overlay.open .crow', { hasText: 'Avbruten' }).click();
        const c = await waitModal(s, /^Ändra status på \d/);
        const btn = await s.eval(() => { const b = [...document.querySelectorAll('.modal-overlay.open .modal-footer button')]; return b.map((x) => { const r = x.getBoundingClientRect(); return { t: x.textContent.trim(), ok: r.left >= 0 && r.right <= window.innerWidth && x.scrollWidth <= x.clientWidth + 1, h: Math.round(r.height) }; }); });
        t.assert(btn.every((b) => b.ok && b.h >= 40), vp + ': bekräftelsens knappar hela och ≥ 40 px ' + JSON.stringify(btn));
        await s.clearToasts();
        await s.clickModalButton(/^Ändra status på \d+$/);
        const n = Number(/^Ändra status på (\d+)/.exec(c.title)[1]);
        await s.waitToast(new RegExp('^' + n + ' arbetsorder uppdaterade till "Avbruten"'));
        await s.settle(700);
        const srv = t.fake.get('workOrders');
        const changed = picks.filter((id) => srv.find((a) => a.id === id).status === 'avbruten');
        t.assert(changed.length === n && changed.length === visibleSel, vp + ': servern ändrade exakt de ' + n + ' synliga, inte de dolda');
        await s.context.close();
        t.fake.set('workOrders', realistic(t.fake, 100));
      }
    },
  },
];
