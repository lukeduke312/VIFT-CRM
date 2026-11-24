'use strict';
/* Dashboard 2026-11-26: "Anpassa dashboard" som ett separat redigeringsläge
   (Spara/Avbryt/Återställ standard, Flytta med dra-och-släpp eller
   tangentbord, Flytta upp/ned på mobil, storlek Liten/Halv/Hel, Dolda
   widgets), personlig layout per användare och enhet (localStorage,
   bakåtkompatibel med äldre sparade layouter), widgetöversyn och kartans
   ärliga tomvy när jobben saknar koordinater. Simulerad server; Mapbox är
   blockerat (eller ersatt av en stubbe som i MAP-01). */
const lib = require('../lib');

Object.assign(lib.VIEWPORTS, {
  d25_360: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
  d25_390: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  d25_768: { viewport: { width: 768, height: 1024 }, hasTouch: true },
  d25_1024: { viewport: { width: 1024, height: 768 } },
  d25_1366: { viewport: { width: 1366, height: 768 } },
  d25_1920: { viewport: { width: 1920, height: 1080 } },
});

/* Samma Mapbox-stubbe som MAP-01: kartbiblioteket "laddas", markörer
   registreras — adressökningen (fetch mot api.mapbox.com) är blockerad. */
const STUB = () => {
  window.__markers = [];
  Object.defineProperty(window, 'VIFT_CONFIG', { configurable: true, get() { return Object.assign({}, this.__vc || {}, { mapboxToken: 'pk.e2e-stub' }); }, set(v) { this.__vc = v; } });
  function Popup() { this.html = ''; } Popup.prototype.setHTML = function (h) { this.html = h; return this; };
  function Marker(o) { this.opts = o || {}; this.el = (o && o.element) || document.createElement('div'); }
  Marker.prototype.setLngLat = function (ll) { this.ll = ll; return this; };
  Marker.prototype.setPopup = function (p) { this.popup = p; return this; };
  Marker.prototype.addTo = function () { window.__markers.push(this); return this; };
  Marker.prototype.getElement = function () { return this.el; };
  function Map() {} Map.prototype.fitBounds = function () {}; Map.prototype.remove = function () {};
  function LngLatBounds() {} LngLatBounds.prototype.extend = function () { return this; };
  window.mapboxgl = { Map, Marker, Popup, LngLatBounds, accessToken: '' };
};

const normalOrder = () => [...document.querySelectorAll('#dash-content .dash-layout > [data-w]')].map((e) => e.dataset.w);
const editOrder = () => [...document.querySelectorAll('.dash-edit-card')].map((e) => e.dataset.widgetId);
const layoutKeys = () => Object.keys(localStorage).filter((k) => /^dashLayout/.test(k)).sort().map((k) => k + '=' + localStorage.getItem(k));

async function openDash(s) { await s.go('pg-dash'); await s.settle(500); }
async function enterEdit(s, tap) {
  const b = s.page.locator('#pg-dash .dash-customize-btn').first();
  if (tap) await b.tap(); else await b.click();
  await s.page.waitForSelector('.dash-edit-bar', { timeout: 5000 });
  await s.settle(150);
}
async function barClick(s, cls) { await s.page.locator('.dash-edit-bar .' + cls).click(); await s.settle(250); }
async function relogin(s, alias) {
  await s.eval(() => Auth.logout());
  await s.page.waitForSelector('#login-user', { state: 'visible', timeout: 10000 });
  await s.login(alias);
}

module.exports = [
  {
    id: 'DASH-E-01', module: 'Dashboard', name: 'Anpassa: separat läge med sticky verktygsrad (Spara primär, Avbryt, Återställ standard), Flytta-handtag, storlek Liten/Halv/Hel, Dölj och Dolda widgets; inget sparas under redigering; Avbryt återställer exakt',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openDash(s);
      const before = await s.eval(([o, k]) => ({ order: eval(o)(), keys: eval(k)() }), [normalOrder.toString(), layoutKeys.toString()]);
      t.assert(before.order.length >= 5, 'dashboarden visar widgets (' + before.order.join(',') + ')');
      await enterEdit(s);
      const ui = await s.eval(() => {
        const bar = document.querySelector('.dash-edit-bar');
        const btn = (re) => [...bar.querySelectorAll('button')].find((b) => re.test(b.textContent));
        const cards = [...document.querySelectorAll('.dash-edit-card')];
        return {
          save: !!btn(/Spara/), cancel: !!btn(/Avbryt/), reset: !!btn(/Återställ standard/),
          saveIsPrimary: !!btn(/Spara/) && btn(/Spara/).classList.contains('bp'),
          state: bar.querySelector('.dash-edit-state').textContent.trim(),
          cards: cards.length,
          handles: cards.filter((c) => { const h = c.querySelector('.dash-edit-handle'); return h && /Flytta/.test(h.textContent) && h.getAttribute('draggable') === 'true' && h.offsetParent; }).length,
          hides: cards.filter((c) => { const h = c.querySelector('.dash-edit-hide'); return h && /Dölj/.test(h.textContent) && h.offsetParent; }).length,
          sizes: cards.map((c) => ({ id: c.dataset.widgetId, labels: [...c.querySelectorAll('.dash-size-btn')].map((b) => b.textContent.trim()), pressed: c.querySelectorAll('.dash-size-btn[aria-pressed="true"]').length })),
          hidden: [...document.querySelectorAll('#dash-edit-hidden .dash-edit-hidden-item')].map((li) => ({ id: li.dataset.widgetId, btn: (li.querySelector('.dash-edit-show') || {}).textContent || '', desc: (li.querySelector('.dash-edit-hidden-d') || {}).textContent || '' })),
          jump: (document.querySelector('.dash-edit-jump') || {}).textContent || '',
          previewInert: cards.every((c) => c.querySelector('.dash-edit-preview').hasAttribute('inert')),
          board: !!document.querySelector('#dash-content .dt'),
        };
      });
      t.assert(ui.save && ui.cancel && ui.reset && ui.saveIsPrimary, 'verktygsraden har Spara (primär), Avbryt och Återställ standard ' + JSON.stringify(ui));
      t.assert(ui.state === 'Inga ändringar ännu', 'status utan ändringar: ' + ui.state);
      t.assert(ui.cards > 3 && ui.handles === ui.cards && ui.hides === ui.cards, 'varje widget har ett synligt Flytta-handtag (dragbart) och Dölj (' + ui.handles + '/' + ui.hides + '/' + ui.cards + ')');
      t.assert(ui.previewInert, 'förhandsvisningen är inert (inga klick/fokus inuti under redigering)');
      t.assert(!ui.board, 'redigeringsläget är separat från vanliga vyn (dagens tavla visas inte)');
      const allowed = new Set(['Liten', 'Halv', 'Bred', 'Hel']);
      const bad = ui.sizes.filter((x) => x.labels.length > 1 && (x.pressed !== 1 || x.labels.some((l) => !allowed.has(l))));
      t.assert(bad.length === 0, 'storleksval med begripliga namn och exakt ett valt: ' + JSON.stringify(bad));
      const map = ui.sizes.find((x) => x.id === 'ops_map');
      t.assert(map && !map.labels.includes('Liten') && map.labels.includes('Hel'), 'kartan erbjuds bara relevanta storlekar (ingen Liten): ' + JSON.stringify(map));
      t.assert(ui.hidden.some((h) => h.id === 'kpi' && /Visa/.test(h.btn) && h.desc.length > 10), 'Dolda widgets listar Nyckeltal med beskrivning och Visa ' + JSON.stringify(ui.hidden));
      t.assert(new RegExp('Dolda widgets \\(' + ui.hidden.length + '\\)').test(ui.jump), 'genvägen visar antal dolda (' + ui.jump + ')');
      // Sticky verktygsrad
      await s.eval(() => { document.getElementById('content-scroll').scrollTop = 1200; });
      await s.settle(200);
      const barTop = await s.eval(() => document.querySelector('.dash-edit-bar').getBoundingClientRect().top);
      t.assert(barTop >= 0 && barTop < 140, 'verktygsraden ligger kvar överst vid rullning (top ' + Math.round(barTop) + ')');
      await s.eval(() => { document.getElementById('content-scroll').scrollTop = 0; });
      // Ändringar: dölj, storlek, flytta med tangentbord
      const editBefore = await s.eval(editOrder);
      await s.page.locator('.dash-edit-card[data-widget-id="pool"] .dash-edit-hide').click();
      await s.settle(200);
      await s.page.locator('.dash-edit-card[data-widget-id="my_tasks"] .dash-size-btn', { hasText: 'Liten' }).click();
      await s.settle(200);
      await s.page.locator('.dash-edit-card[data-widget-id="rondering"] .dash-edit-handle').focus();
      await s.page.keyboard.press('ArrowUp');
      await s.settle(250);
      const mid = await s.eval(([eo, lk]) => ({
        state: document.querySelector('.dash-edit-state').textContent.trim(),
        keys: eval(lk)(), order: eval(eo)(),
        poolHidden: !!document.querySelector('#dash-edit-hidden [data-widget-id="pool"]'),
        myTasksCls: document.querySelector('.dash-edit-card[data-widget-id="my_tasks"]').className,
        myTasksPressed: (document.querySelector('.dash-edit-card[data-widget-id="my_tasks"] .dash-size-btn[aria-pressed="true"]') || {}).textContent,
        focus: !!(document.activeElement && document.activeElement.classList.contains('dash-edit-handle') && document.activeElement.closest('[data-widget-id="rondering"]')),
        live: (document.getElementById('dash-live') || {}).textContent || '',
        msg: (document.getElementById('dash-edit-status-msg') || {}).textContent || '',
      }), [editOrder.toString(), layoutKeys.toString()]);
      t.assert(mid.state === 'Osparade ändringar', 'status visar osparade ändringar (' + mid.state + ')');
      t.assert(JSON.stringify(mid.keys) === JSON.stringify(before.keys), 'inget sparas under redigering (localStorage oförändrat)');
      t.assert(mid.poolHidden && !mid.order.includes('pool'), 'Arbetspool flyttad till Dolda widgets');
      t.assert(/\bdgw-3\b/.test(mid.myTasksCls) && mid.myTasksPressed === 'Liten', 'storlek Liten förhandsvisas direkt (' + mid.myTasksCls + ')');
      const rb = editBefore.filter((x) => x !== 'pool');
      const exp = rb.slice(); const ri = exp.indexOf('rondering'); [exp[ri - 1], exp[ri]] = [exp[ri], exp[ri - 1]];
      t.assert(JSON.stringify(mid.order) === JSON.stringify(exp), 'pil upp på Flytta flyttar Rondering ett steg: ' + mid.order.join(','));
      t.assert(mid.focus, 'fokus stannar på den flyttade widgetens Flytta-handtag');
      t.assert(/Rondering flyttad till plats \d+ av \d+/.test(mid.live) && /flyttad/.test(mid.msg), 'återkoppling i aria-live och statusraden: ' + mid.live);
      // Avbryt → exakt som innan
      await s.clearToasts();
      await barClick(s, 'dash-edit-cancel');
      await s.waitToast(/kastades/);
      const after = await s.eval(([o, k]) => ({ order: eval(o)(), keys: eval(k)(), edit: !!document.querySelector('.dash-edit') }), [normalOrder.toString(), layoutKeys.toString()]);
      t.assert(!after.edit, 'redigeringsläget stängt');
      t.assert(JSON.stringify(after.order) === JSON.stringify(before.order), 'Avbryt återställer exakt samma layout: ' + after.order.join(','));
      t.assert(JSON.stringify(after.keys) === JSON.stringify(before.keys), 'Avbryt skriver ingenting');
    },
  },
  {
    id: 'DASH-E-02', module: 'Dashboard', name: 'Dra och släpp (dator) med släppmarkering + "lägg sist"; storleksändring; Spara → samma layout efter omladdning',
    async run(t) {
      const s = await t.world.session({ viewport: 'desktop' });
      await s.login('admin');
      await openDash(s);
      await enterEdit(s);
      const ids = await s.eval(editOrder);
      t.assert(ids.indexOf('my_tasks') === ids.indexOf('pool') + 1, 'standard: Mina uppgifter direkt efter Arbetspool (' + ids.join(',') + ')');
      // 1. Manuell dragning: Mina uppgifter över vänstra halvan av Arbetspool → markering före, släpp
      const src = s.page.locator('.dash-edit-card[data-widget-id="my_tasks"] .dash-edit-handle');
      const dst = s.page.locator('.dash-edit-card[data-widget-id="pool"]');
      await dst.scrollIntoViewIfNeeded();
      const sb = await src.boundingBox(); const db = await dst.boundingBox();
      await s.page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
      await s.page.mouse.down();
      await s.page.mouse.move(sb.x + sb.width / 2 + 30, sb.y + sb.height / 2 + 10, { steps: 4 });
      await s.page.mouse.move(db.x + 24, db.y + db.height / 2, { steps: 10 });
      await s.settle(100);
      await s.page.mouse.move(db.x + 28, db.y + db.height / 2, { steps: 2 });
      await s.settle(150);
      const mark = await s.eval(() => ({ dragging: document.body.classList.contains('dash-dragging'), before: !!document.querySelector('.dash-edit-card[data-widget-id="pool"].is-drop-before'), x: !!document.querySelector('.dash-edit-card[data-widget-id="pool"].drop-x'), dropend: getComputedStyle(document.querySelector('.dash-edit-dropend')).display }));
      await s.page.mouse.up();
      await s.settle(300);
      t.assert(mark.dragging && mark.before && mark.x, 'under dragningen markeras platsen (linje före Arbetspool) ' + JSON.stringify(mark));
      t.assert(mark.dropend !== 'none', 'under dragningen visas "Släpp här för att lägga widgeten sist"');
      let now = await s.eval(editOrder);
      t.assert(now.indexOf('my_tasks') === now.indexOf('pool') - 1, 'Mina uppgifter släppt före Arbetspool: ' + now.join(','));
      t.assert(await s.eval(() => !document.body.classList.contains('dash-dragging') && !document.querySelector('.is-drop-before,.is-drop-after,.is-dragging')), 'dragmarkeringar städas bort efter släpp');
      // 2. Dra näst sista widgeten till "lägg sist" (släppytan visas bara under dragning)
      await s.eval(() => { const c = document.querySelectorAll('.dash-edit-card'); c[c.length - 1].scrollIntoView({ block: 'center' }); });
      await s.settle(200);
      const lastTwo = await s.eval(() => { const ids = [...document.querySelectorAll('.dash-edit-card')].map((e) => e.dataset.widgetId); return [ids[ids.length - 2], ids[ids.length - 1]]; });
      const src2 = s.page.locator('.dash-edit-card[data-widget-id="' + lastTwo[0] + '"] .dash-edit-handle');
      const b2 = await src2.boundingBox();
      t.assert(b2, 'näst sista widgetens Flytta syns');
      await s.page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
      await s.page.mouse.down();
      await s.page.mouse.move(b2.x + b2.width / 2 + 20, b2.y + b2.height / 2 + 20, { steps: 5 });
      await s.page.waitForFunction(() => document.body.classList.contains('dash-dragging'), null, { timeout: 3000 });
      // Mitt i fönstret — nära kanten rullar webbläsaren automatiskt under dragning.
      await s.eval(() => document.querySelector('.dash-edit-dropend').scrollIntoView({ block: 'center' }));
      await s.settle(150);
      const de = await s.page.locator('.dash-edit-dropend').boundingBox();
      t.assert(de && de.y > 100 && de.y + de.height < 980, 'släppytan syns under dragningen ' + JSON.stringify(de));
      await s.page.mouse.move(de.x + de.width / 2, de.y + de.height / 2, { steps: 8 });
      await s.settle(100);
      await s.page.mouse.move(de.x + de.width / 2 + 4, de.y + de.height / 2, { steps: 2 }); // webbläsaren skickar dragover först vid nästa rörelse
      await s.settle(100);
      const over = await s.eval(() => document.querySelector('.dash-edit-dropend').classList.contains('is-over'));
      await s.page.mouse.up();
      await s.settle(300);
      now = await s.eval(editOrder);
      t.assert(over, 'släppytan markeras när widgeten är över den');
      t.assert(now[now.length - 1] === lastTwo[0] && now[now.length - 2] === lastTwo[1], 'widgeten lagd sist via släppytan: ' + now.join(','));
      // 3. Storlek: Arbetspool → Liten
      await s.page.locator('.dash-edit-card[data-widget-id="pool"] .dash-size-btn', { hasText: 'Liten' }).click();
      await s.settle(200);
      await s.clearToasts();
      await barClick(s, 'dash-edit-save');
      await s.waitToast(/sparad/);
      const saved = await s.eval(([o]) => ({ order: eval(o)(), poolCls: (document.querySelector('[data-w="pool"]') || {}).className, key: localStorage.getItem('dashLayoutV2_ST-001') }), [normalOrder.toString()]);
      t.assert(saved.key, 'layouten sparad under användarens egen nyckel');
      const vis = (arr) => arr.filter((id) => saved.order.includes(id));
      t.assert(JSON.stringify(saved.order) === JSON.stringify(vis(now)), 'vanliga vyn följer den sparade ordningen: ' + saved.order.join(','));
      t.assert(/\bdgw-3\b/.test(saved.poolCls), 'Arbetspool visas Liten (' + saved.poolCls + ')');
      // 4. Omladdning
      await s.page.reload({ waitUntil: 'load' });
      await s.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id === 'ST-001', null, { timeout: 15000 });
      await s.settle(600);
      await openDash(s);
      const re = await s.eval(([o]) => ({ order: eval(o)(), poolCls: (document.querySelector('[data-w="pool"]') || {}).className }), [normalOrder.toString()]);
      t.assert(JSON.stringify(re.order) === JSON.stringify(saved.order), 'samma ordning efter omladdning: ' + re.order.join(','));
      t.assert(/\bdgw-3\b/.test(re.poolCls), 'samma storlek efter omladdning');
    },
  },
  {
    id: 'DASH-E-03', module: 'Dashboard', name: 'Dölj och visa dold widget; Återställ standard frågar först, ändrar bara utkastet och sparas vid Spara (rollstandard med sektionsrubriker tillbaka)',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openDash(s);
      await enterEdit(s);
      const n0 = await s.eval(() => document.querySelectorAll('#dash-edit-hidden .dash-edit-hidden-item').length);
      await s.clearToasts();
      await s.page.locator('.dash-edit-card[data-widget-id="rondering"] .dash-edit-hide').click();
      await s.waitToast(/Rondering är dold/);
      let st = await s.eval(() => ({ hidden: [...document.querySelectorAll('#dash-edit-hidden .dash-edit-hidden-item')].map((x) => x.dataset.widgetId), jump: document.querySelector('.dash-edit-jump').textContent, card: !!document.querySelector('.dash-edit-card[data-widget-id="rondering"]') }));
      t.assert(!st.card && st.hidden.includes('rondering') && st.hidden.length === n0 + 1, 'Rondering ligger under Dolda widgets ' + JSON.stringify(st));
      t.assert(new RegExp('\\(' + (n0 + 1) + '\\)').test(st.jump), 'antal dolda uppdateras (' + st.jump + ')');
      await s.page.locator('#dash-edit-hidden .dash-edit-hidden-item[data-widget-id="kpi"] .dash-edit-show').click();
      await s.waitToast(/Nyckeltal visas igen/);
      st = await s.eval(([eo]) => ({ order: eval(eo)(), inHidden: !!document.querySelector('#dash-edit-hidden [data-widget-id="kpi"]'), focus: !!(document.activeElement && document.activeElement.closest('[data-widget-id="kpi"]')) }), [editOrder.toString()]);
      t.assert(st.order[st.order.length - 1] === 'kpi' && !st.inHidden, 'Nyckeltal tillbaka, längst ned: ' + st.order.join(','));
      t.assert(st.focus, 'fokus flyttas till den återställda widgeten');
      await barClick(s, 'dash-edit-save');
      const saved = await s.eval(([o]) => ({ order: eval(o)(), key: localStorage.getItem('dashLayoutV2_ST-001') }), [normalOrder.toString()]);
      t.assert(!saved.order.includes('rondering') && saved.order.includes('kpi'), 'sparat: Rondering dold, Nyckeltal synlig ' + saved.order.join(','));
      // Återställ standard: fråga, avböj
      await enterEdit(s);
      await barClick(s, 'dash-edit-reset');
      t.assert(await s.modalOpen(), 'Återställ standard öppnar en bekräftelse');
      t.assert(/Återställ standardlayout\?/.test(await s.text('.modal-overlay.open')), 'bekräftelsen förklarar vad som händer');
      await s.clickModalButton(/Behåll nuvarande/);
      await s.settle(300);
      t.assert(await s.eval(() => !!document.querySelector('#dash-edit-hidden [data-widget-id="rondering"]') && document.querySelector('.dash-edit-state').textContent.trim() === 'Inga ändringar ännu'), 'Behåll nuvarande ändrar ingenting');
      // Återställ standard: bekräfta → bara utkastet
      await barClick(s, 'dash-edit-reset');
      await s.clickModalButton(/Återställ standard/);
      await s.settle(300);
      st = await s.eval(([eo]) => ({ order: eval(eo)(), state: document.querySelector('.dash-edit-state').textContent.trim(), key: localStorage.getItem('dashLayoutV2_ST-001'), def: DashboardConfig.getDefaultLayout('admin').filter((e) => e.visible).map((e) => e.id) }), [editOrder.toString()]);
      t.assert(JSON.stringify(st.order) === JSON.stringify(st.def.filter((id) => st.order.includes(id))) && st.order.includes('rondering') && !st.order.includes('kpi'), 'utkastet är rollens standard: ' + st.order.join(','));
      t.assert(st.state === 'Osparade ändringar' && st.key === saved.key, 'återställningen är inte sparad ännu');
      await s.clearToasts();
      await barClick(s, 'dash-edit-save');
      await s.waitToast(/Standardlayouten är sparad/);
      const fin = await s.eval(([o]) => ({ order: eval(o)(), keys: Object.keys(localStorage).filter((k) => /^dashLayout/.test(k)), heads: [...document.querySelectorAll('#dash-content .dash-sec-label')].map((e) => e.textContent.trim()) }), [normalOrder.toString()]);
      t.assert(fin.keys.length === 0, 'Spara efter återställning tar bort den personliga layouten (' + fin.keys.join(',') + ')');
      t.assert(fin.order.includes('rondering') && !fin.order.includes('kpi'), 'standardlayouten visas');
      t.assert(fin.heads.includes('Idag & drift') && !fin.heads.includes('Kräver åtgärd'), 'rollstandardens sektionsrubriker är tillbaka (utan dubblerad "Kräver åtgärd"): ' + fin.heads.join(','));
    },
  },
  {
    id: 'DASH-E-04', module: 'Dashboard', name: 'Personlig layout per användare och enhet: admins layout påverkar inte arbetsledarens (samma webbläsare); ny enhet = standard; ett osparat utkast följer aldrig med till nästa användare',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openDash(s);
      await enterEdit(s);
      await s.page.locator('.dash-edit-card[data-widget-id="pool"] .dash-edit-hide').click();
      await barClick(s, 'dash-edit-save');
      t.assert(!(await s.eval(normalOrder)).includes('pool'), 'admin: Arbetspool dold och sparad');
      // Arbetsledaren på samma webbläsare
      await relogin(s, 'chef');
      await openDash(s);
      let c = await s.eval(([o]) => ({ order: eval(o)(), mine: localStorage.getItem('dashLayoutV2_ST-003'), admin: localStorage.getItem('dashLayoutV2_ST-001') }), [normalOrder.toString()]);
      t.assert(c.order.includes('pool') && !c.mine && c.admin, 'arbetsledaren ser sin standard med Arbetspool; admins layout finns kvar under admins nyckel');
      await enterEdit(s);
      await s.page.locator('.dash-edit-card[data-widget-id="ops_map"] .dash-edit-hide').click();
      await barClick(s, 'dash-edit-save');
      c = await s.eval(([o]) => ({ order: eval(o)(), mine: localStorage.getItem('dashLayoutV2_ST-003') }), [normalOrder.toString()]);
      t.assert(!c.order.includes('ops_map') && c.order.includes('pool') && c.mine, 'arbetsledarens egen layout sparad (karta dold, pool kvar)');
      // Osparat utkast hos arbetsledaren följer inte med till admin
      await enterEdit(s);
      await s.page.locator('.dash-edit-card[data-widget-id="pool"] .dash-edit-hide').click();
      await relogin(s, 'admin');
      await openDash(s);
      const a = await s.eval(([o]) => ({ order: eval(o)(), edit: !!document.querySelector('.dash-edit'), draft: Dashboard._editDraft, chef: localStorage.getItem('dashLayoutV2_ST-003') }), [normalOrder.toString()]);
      t.assert(!a.edit && !a.draft, 'nästa användare hamnar inte i föregåendes redigeringsläge');
      t.assert(!a.order.includes('pool') && a.order.includes('ops_map'), 'admin ser sin egen sparade layout (pool dold, karta synlig): ' + a.order.join(','));
      t.assert(JSON.stringify(JSON.parse(a.chef).filter((e) => e.id === 'pool')[0].visible) === 'true', 'arbetsledarens osparade ändring sparades aldrig');
      // Ny enhet (egen webbläsarkontext) för samma admin → standard
      const d = await t.world.session({ viewport: 'laptop' });
      await d.login('admin');
      await openDash(d);
      const other = await d.eval(([o]) => ({ order: eval(o)(), key: localStorage.getItem('dashLayoutV2_ST-001') }), [normalOrder.toString()]);
      t.assert(other.order.includes('pool') && !other.key, 'annan enhet: standardlayout (layouten är personlig per enhet, sparas inte på servern)');
    },
  },
  {
    id: 'DASH-E-05', module: 'Dashboard', name: 'Bakåtkompatibilitet: äldre sparad layout (v1 med size-strängar, okänd widget) visas; ¾-bredd behålls som "Bred" och bevaras vid Spara; v1-nyckeln skrivs aldrig över',
    async run(t) {
      const s = await t.world.session({ viewport: 'desktop' });
      await s.open();
      const V1 = JSON.stringify([{ id: 'ops_map', visible: true, size: 'twothird' }, { id: 'pool', visible: true, size: 'third' }, { id: 'sales', visible: false, size: 'half' }, { id: 'borttagen_widget', visible: true, size: 'full' }]);
      await s.eval((v) => localStorage.setItem('dashLayout_ST-001', v), V1);
      await s.login('admin');
      await openDash(s);
      const r = await s.eval(([o]) => ({ order: eval(o)(), map: (document.querySelector('[data-w="ops_map"]') || {}).className, pool: (document.querySelector('[data-w="pool"]') || {}).className }), [normalOrder.toString()]);
      t.assert(/\bdgw-9\b/.test(r.map) && /\bdgw-3\b/.test(r.pool), 'v1-layoutens bredder visas (karta ¾, pool ¼): ' + r.map + ' / ' + r.pool);
      t.assert(!r.order.includes('sales') && !r.order.includes('borttagen_widget'), 'dold widget och okänd widget visas inte');
      await enterEdit(s);
      const sz = await s.eval(() => [...document.querySelectorAll('.dash-edit-card[data-widget-id="ops_map"] .dash-size-btn')].map((b) => b.textContent.trim() + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')));
      t.assert(sz.includes('Bred*'), 'den sparade ¾-bredden visas som vald "Bred": ' + sz.join(','));
      await s.page.locator('.dash-edit-card[data-widget-id="pool"] .dash-edit-hide').click();
      await barClick(s, 'dash-edit-save');
      const k = await s.eval(() => ({ v1: localStorage.getItem('dashLayout_ST-001'), v2: JSON.parse(localStorage.getItem('dashLayoutV2_ST-001') || '[]') }));
      t.assert(k.v1 === V1, 'v1-nyckeln är orörd');
      const m = k.v2.find((e) => e.id === 'ops_map');
      t.assert(m && m.span === 9 && m.visible, 'kartans ¾-bredd bevarad i den nya layouten ' + JSON.stringify(m));
      t.assert(!k.v2.some((e) => e.id === 'borttagen_widget'), 'okänd widget sparas inte vidare');
      await s.page.reload({ waitUntil: 'load' });
      await s.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id === 'ST-001', null, { timeout: 15000 });
      await s.settle(500);
      await openDash(s);
      const r2 = await s.eval(([o]) => ({ order: eval(o)(), map: (document.querySelector('[data-w="ops_map"]') || {}).className }), [normalOrder.toString()]);
      t.assert(/\bdgw-9\b/.test(r2.map) && !r2.order.includes('pool'), 'efter omladdning: karta ¾, pool dold');
    },
  },
  {
    id: 'DASH-E-06', module: 'Dashboard (mobil)', name: 'Mobil 390: Flytta upp/Flytta ned med tryck (inget dra-handtag, inget storleksval), stora tryckytor, inget sidledes överspill; sparas',
    async run(t) {
      const s = await t.world.session({ viewport: 'd25_390' });
      await s.login('admin');
      await openDash(s);
      await enterEdit(s, true);
      const ui = await s.eval(() => {
        const vis = (e) => !!e && e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none';
        const first = document.querySelector('.dash-edit-card');
        const btns = [...document.querySelectorAll('.dash-edit-bar button, .dash-edit-card .dash-move-up, .dash-edit-card .dash-move-down, .dash-edit-card .dash-edit-hide, .dash-edit-show')].filter(vis);
        return {
          handle: vis(first.querySelector('.dash-edit-handle')), size: vis(first.querySelector('.dash-edit-size')),
          up: vis(first.querySelector('.dash-move-up')), down: vis(first.querySelector('.dash-move-down')),
          upDisabled: first.querySelector('.dash-move-up').disabled,
          small: btns.filter((b) => b.getBoundingClientRect().height < 38).map((b) => b.textContent.trim().slice(0, 20)),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          barBtnsInside: [...document.querySelectorAll('.dash-edit-bar button')].every((b) => b.getBoundingClientRect().right <= window.innerWidth + 1),
        };
      });
      t.assert(!ui.handle && !ui.size, 'mobil: inget dra-handtag och inget storleksval (alla widgets är fullbreda på telefon) ' + JSON.stringify(ui));
      t.assert(ui.up && ui.down && ui.upDisabled, 'mobil: Flytta upp/Flytta ned synliga, upp inaktiv på första');
      t.assert(ui.small.length === 0, 'tryckytor minst 38 px: ' + ui.small.join(', '));
      t.assert(ui.overflow <= 1 && ui.barBtnsInside, 'inget sidledes överspill i redigeringsläget (' + ui.overflow + ')');
      const ids = await s.eval(editOrder);
      await s.page.locator('.dash-edit-card').nth(0).locator('.dash-move-down').tap();
      await s.settle(300);
      let now = await s.eval(editOrder);
      t.assert(now[0] === ids[1] && now[1] === ids[0], 'Flytta ned byter plats med nästa: ' + now.slice(0, 3).join(','));
      const pos = await s.eval((id) => ({ pos: document.querySelector('.dash-edit-card[data-widget-id="' + id + '"] .dash-edit-pos').textContent, focus: !!(document.activeElement && document.activeElement.closest('[data-widget-id="' + id + '"]')) }), ids[0]);
      t.assert(/^Plats 2 av \d+$/.test(pos.pos) && pos.focus, 'platsen visas ("' + pos.pos + '") och fokus följer med widgeten');
      await s.page.locator('.dash-edit-card').nth(3).locator('.dash-move-up').tap();
      await s.settle(300);
      now = await s.eval(editOrder);
      const exp = [ids[1], ids[0], ids[3], ids[2]];
      t.assert(JSON.stringify(now.slice(0, 4)) === JSON.stringify(exp), 'Flytta upp byter plats med föregående: ' + now.slice(0, 4).join(','));
      await s.page.locator('.dash-edit-bar .dash-edit-save').tap();
      await s.settle(400);
      const saved = await s.eval(([o]) => ({ order: eval(o)(), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }), [normalOrder.toString()]);
      t.assert(JSON.stringify(saved.order) === JSON.stringify(now.filter((id) => saved.order.includes(id))), 'sparad ordning gäller i vanliga vyn: ' + saved.order.join(','));
      t.assert(saved.overflow <= 1, 'inget sidledes överspill efter sparning');
    },
  },
  {
    id: 'DASH-E-07', module: 'Dashboard', name: 'Inget sidledes överspill eller knappar utanför skärmen: dashboard, Anpassa-läget och listan "jobb utan plats" vid 360/390/768/1024/1366/1920',
    async run(t) {
      const problems = [];
      for (const vp of ['d25_360', 'd25_390', 'd25_768', 'd25_1024', 'd25_1366', 'd25_1920']) {
        const s = await t.world.session({ viewport: vp });
        await s.login('admin');
        await openDash(s);
        await s.settle(400);
        (await s.layoutIssues()).forEach((x) => problems.push(vp + ' dashboard: ' + x));
        await s.eval(() => Dashboard._toggleGeoList(true));
        await s.settle(200);
        (await s.layoutIssues()).forEach((x) => problems.push(vp + ' jobb utan plats: ' + x));
        await s.eval(() => Dashboard.enterEditMode());
        await s.settle(400);
        (await s.layoutIssues()).forEach((x) => problems.push(vp + ' anpassa: ' + x));
        const clip = await s.eval(() => [...document.querySelectorAll('.dash-edit-bar button, .dash-edit-chrome button, .dash-edit-move button')].filter((b) => b.offsetParent && b.scrollWidth > b.clientWidth + 2).map((b) => b.textContent.trim().slice(0, 20)));
        clip.forEach((x) => problems.push(vp + ' avklippt knapptext: ' + x));
        await s.context.close();
      }
      t.assert(problems.length === 0, problems.join(' ; '));
    },
  },
  {
    id: 'DASH-E-08', module: 'Dashboard', name: 'Kartan när jobben saknar koordinater: talen visas, ärlig förklaring per orsak (saknar postnummer/ort, behöver geokodas, kartsökningen svarade inte), lista "Visa vilka" som öppnar AO; koordinater som text placeras',
    async run(t) {
      // A. Kartbiblioteket blockerat (som i harnessen): synkron klassning syns ändå
      const s = await t.world.session({ viewport: 'desktop' });
      await s.login('admin');
      await openDash(s);
      await s.page.waitForSelector('.dash-ops-map-empty', { timeout: 15000 });
      const a = await s.eval(() => ({
        n: Dashboard._opsMapJobs.length,
        count: document.getElementById('dash-ops-map-count').textContent,
        kind: document.querySelector('.dash-ops-map-empty').dataset.kind,
        empty: document.querySelector('.dash-ops-map-empty').innerText,
        geo: document.getElementById('dash-ops-geo').innerText,
        missing: +document.getElementById('dash-ops-geo').dataset.missing,
      }));
      t.note('A: ' + a.count + ' | ' + a.empty.replace(/\s+/g, ' '));
      t.assert(a.n > 0 && a.count === a.n + ' aktiva jobb · 0 med koordinater · ' + a.n + ' saknar koordinater', 'räknaren visar alla tal: ' + a.count);
      t.assert(a.kind === 'nolib' && /Kartan kunde inte laddas/.test(a.empty) && new RegExp('0 av ' + a.n + ' jobb har koordinater').test(a.empty), 'kartytan förklarar att kartan inte kunde laddas, med tal');
      t.assert(a.missing === a.n && new RegExp(a.n + ' av ' + a.n + ' jobb saknar koordinater').test(a.geo) && /adresserna behöver geokodas/.test(a.geo), 'sammanfattning: N av N saknar koordinater — behöver geokodas');
      t.assert(/saknar postnummer\/ort/.test(a.geo), 'orsaken "saknar postnummer/ort" redovisas med antal');
      await s.page.locator('.dash-ops-geo-sum').click();
      await s.settle(200);
      const list = await s.eval(() => ({
        open: !document.getElementById('dash-ops-geo-list').hidden,
        expanded: document.querySelector('.dash-ops-geo-sum').getAttribute('aria-expanded'),
        groups: [...document.querySelectorAll('.dash-ops-geo-group')].map((g) => ({ r: g.dataset.reason, n: +g.querySelector('h4 .bdg').textContent, rows: g.querySelectorAll('.dash-ops-geo-row').length, hint: g.querySelector('.dash-ops-geo-hint').textContent })),
      }));
      t.assert(list.open && list.expanded === 'true', '"Visa vilka" fäller ut listan');
      t.assert(list.groups.reduce((x, g) => x + g.n, 0) === a.n && list.groups.every((g) => g.rows === g.n && g.hint.length > 20), 'listan grupperar alla jobb per orsak med förklaring ' + JSON.stringify(list.groups.map((g) => g.r + ':' + g.n)));
      const firstId = await s.eval(() => document.querySelector('.dash-ops-geo-row').dataset.ao);
      await s.page.locator('.dash-ops-geo-row').first().click();
      await s.settle(400);
      t.assert(await s.eval((id) => Router.currentPage === 'pg-ao-detail' && Router.currentParams.aoId === id, firstId), 'en rad öppnar arbetsordern');
      // B. Kartbiblioteket laddat (stubbe) men adressökningen svarar inte → tomvy med orsak
      const b = await t.world.session({ viewport: 'desktop' });
      await b.page.addInitScript(STUB);
      await b.login('admin');
      await openDash(b);
      await b.page.waitForSelector('.dash-ops-map-empty[data-kind="none"]', { timeout: 15000 });
      const r = await b.eval(() => ({ n: Dashboard._opsMapJobs.length, empty: document.querySelector('.dash-ops-map-empty').innerText, geo: document.getElementById('dash-ops-geo').innerText, count: document.getElementById('dash-ops-map-count').textContent, markers: window.__markers.length, btn: (document.querySelector('.dash-ops-map-empty .btn') || {}).textContent || '' }));
      t.note('B: ' + r.count + ' | ' + r.empty.replace(/\s+/g, ' '));
      t.assert(r.markers === 0, 'inga markörer');
      t.assert(new RegExp('Inga av de ' + r.n + ' aktiva jobben har koordinater').test(r.empty) && /Adresserna behöver geokodas/.test(r.empty) && /har bara gatuadress utan postnummer\/ort/.test(r.empty), 'tomvyn säger hur många och varför: ' + r.empty.replace(/\s+/g, ' '));
      t.assert(/kartsökningen svarade inte/.test(r.geo) && /saknar postnummer\/ort/.test(r.geo), 'orsakerna skiljs åt (kartsökningen svarade inte / saknar postnummer/ort): ' + r.geo.replace(/\s+/g, ' '));
      t.assert(new RegExp('Visa jobb utan plats \\(' + r.n + '\\)').test(r.btn), 'tomvyn har en väg till listan (' + r.btn.trim() + ')');
      t.assert(r.count === r.n + ' aktiva jobb · 0 med koordinater · ' + r.n + ' saknar koordinater', 'räknaren döljer inga tal: ' + r.count);
      await b.page.locator('.dash-ops-map-empty .btn').click();
      await b.settle(200);
      t.assert(await b.eval(() => !document.getElementById('dash-ops-geo-list').hidden), 'knappen i tomvyn öppnar listan');
      // C. Koordinater sparade som text (t.ex. från import) placeras på kartan
      const aos = t.fake.get('workOrders');
      aos.push({ id: 'AO-STR1', title: 'Koordinater som text', customerId: 'K-002', staff: ['ST-001'], log: [], materials: [], checklist: [], status: 'planerad', scheduledDate: new Date().toISOString().slice(0, 10), address: 'Testgatan 1', zip: '411 34', city: 'Göteborg', lat: '57.7012', lng: '11.9681', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      t.fake.set('workOrders', aos);
      const c = await t.world.session({ viewport: 'desktop' });
      await c.page.addInitScript(STUB);
      await c.login('admin');
      await openDash(c);
      await c.page.waitForFunction(() => (window.__markers || []).length > 0, null, { timeout: 15000 });
      await c.settle(300);
      const m = await c.eval(() => ({ n: Dashboard._opsMapJobs.length, ids: [...new Set(window.__markers.map((x) => x.el.dataset.aoIds))].join(','), /* stubben behåller markörer från tidigare ritningar */ count: document.getElementById('dash-ops-map-count').textContent, empty: !!document.querySelector('.dash-ops-map-empty') }));
      t.assert(m.ids === 'AO-STR1' && !m.empty, 'AO med koordinater som text får en markör: ' + m.ids);
      t.assert(m.count === m.n + ' aktiva jobb · 1 på kartan · ' + (m.n - 1) + ' saknar koordinater', 'räknaren: ' + m.count);
    },
  },
  {
    id: 'DASH-E-09', module: 'Dashboard', name: 'Widgetar: Försenade aktiviteter visar de äldsta med dagar sen och leder till listan; Arbetspool sorterar akut först och visar väntetid; Kräver åtgärd utan dubblerad rubrik, raderna är knappar',
    async run(t) {
      const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
      const day = (d) => ago(d).slice(0, 10);
      const aos = t.fake.get('workOrders');
      const base = { customerId: 'K-002', staff: [], log: [], materials: [], checklist: [], status: 'pool', updatedAt: ago(0) };
      aos.push(Object.assign({}, base, { id: 'AO-PL9', title: 'Pool låg gammal', priority: 'låg', createdAt: ago(20) }));
      aos.push(Object.assign({}, base, { id: 'AO-PA9', title: 'Pool akut ny', priority: 'akut', createdAt: ago(2) }));
      t.fake.set('workOrders', aos);
      t.fake.set('activities', [
        { id: 'ACT-E91', type: 'call', title: 'Ring styrelsen om offerten', status: 'open', dueDate: day(5), assignedTo: 'ST-001', createdBy: 'ST-001', createdAt: ago(9) },
        { id: 'ACT-E92', type: 'followup', title: 'Följ upp besiktningen', status: 'open', dueDate: day(1), assignedTo: 'ST-001', createdBy: 'ST-001', createdAt: ago(9) },
      ]);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openDash(s);
      const w = await s.eval(() => {
        const od = document.querySelector('[data-w="overdue_alert"]');
        const pool = document.querySelector('[data-w="pool"]');
        const todos = document.querySelector('[data-w="todos"]');
        return {
          od: !!od, odCount: od && (od.querySelector('.dw-count') || {}).textContent, odText: od ? od.innerText : '', odGo: od && (od.querySelector('.dw-go') || {}).textContent,
          poolFirst: pool && (pool.querySelector('.crow-title') || {}).textContent, poolLead: pool && (pool.querySelector('.dw-lead--danger') || {}).textContent, poolCount: pool && (pool.querySelector('.dw-count') || {}).textContent, poolText: pool ? pool.innerText : '',
          todoBtns: todos ? todos.querySelectorAll('button.dash-action-item').length : 0,
          heads: [...document.querySelectorAll('#dash-content .dash-sec-label')].map((e) => e.textContent.trim()),
          order: [...document.querySelectorAll('#dash-content .dash-layout > [data-w]')].map((e) => e.dataset.w),
          goCounts: [...document.querySelectorAll('#dash-content .dash-layout [data-w] .card-header')].map((h) => h.querySelectorAll('.dw-go').length),
        };
      });
      t.assert(w.od && w.odCount === '2' && /5 dagar sen/.test(w.odText) && /Ring styrelsen om offerten/.test(w.odText), 'Försenade aktiviteter: antal och de äldsta med dagar sen ' + JSON.stringify({ c: w.odCount, t: w.odText.slice(0, 160) }));
      t.assert(/Visa försenade/.test(w.odGo || ''), 'en tydlig väg vidare: Visa försenade');
      t.assert(w.poolFirst === 'Pool akut ny', 'Arbetspool: akut jobb först (' + w.poolFirst + ')');
      t.assert(/akut/.test(w.poolLead || '') && /väntar/.test(w.poolCount || '') && /väntat 20 d/.test(w.poolText), 'Arbetspool: akut-markering, antal som väntar och väntetid');
      t.assert(w.todoBtns >= 1, 'Kräver åtgärd: raderna är knappar (' + w.todoBtns + ')');
      t.assert(!w.heads.includes('Kräver åtgärd') && w.heads.includes('Idag & drift'), 'ingen dubblerad sektionsrubrik "Kräver åtgärd": ' + w.heads.join(','));
      t.assert(w.order.indexOf('overdue_alert') < w.order.indexOf('ops_map') && w.order.indexOf('todos') < w.order.indexOf('ops_map'), 'brådskande överst: ' + w.order.join(','));
      t.assert(w.goCounts.every((n) => n <= 1), 'varje widget har högst en "Visa alla"-länk i rubriken');
      // Tangentbord: Kräver åtgärd-raden kan öppnas med Enter
      await s.page.locator('[data-w="todos"] button.dash-action-item').first().focus();
      await s.page.keyboard.press('Enter');
      await s.settle(400);
      t.assert(await s.eval(() => Router.currentPage !== 'pg-dash'), 'Enter på en rad i Kräver åtgärd öppnar listan');
      await openDash(s);
      await s.page.locator('[data-w="overdue_alert"] .dw-go').click();
      await s.settle(400);
      t.assert(await s.eval(() => Router.currentPage === 'pg-activities'), 'Visa försenade öppnar Aktiviteter');
    },
  },
];
