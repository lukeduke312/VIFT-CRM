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

/* Mapbox via Playwright-route (ingen riktig trafik): mapbox-gl.js ersätts
   av en stubbe som registrerar markörer (styleError = HTTP-status som
   kartbakgrunden "svarar" med), CSS:en är tom och geokodningen svarar
   'hits' (träff, utom för adresser med "Finnsinte"), 'none' (inga
   träffar) eller '403'. gl:false = biblioteket nås inte. */
const GL_STUB = (styleError) => {
  window.__markers = [];
  function Popup() { this.html = ''; } Popup.prototype.setHTML = function (h) { this.html = h; return this; };
  function Marker(o) { this.opts = o || {}; this.el = (o && o.element) || document.createElement('div'); }
  Marker.prototype.setLngLat = function (ll) { this.ll = ll; return this; };
  Marker.prototype.setPopup = function (p) { this.popup = p; return this; };
  Marker.prototype.addTo = function () { window.__markers.push(this); return this; };
  Marker.prototype.getElement = function () { return this.el; };
  function Map() {}
  Map.prototype.on = function (ev, cb) { if (ev === 'error' && styleError) setTimeout(() => cb({ error: { status: styleError } }), 20); return this; };
  Map.prototype.fitBounds = function () {}; Map.prototype.remove = function () {};
  function LngLatBounds() {} LngLatBounds.prototype.extend = function () { return this; };
  window.mapboxgl = { Map, Marker, Popup, LngLatBounds, accessToken: '' };
};
async function mapboxRoutes(s, o) {
  o = Object.assign({ gl: true, geo: 'hits', styleError: 0 }, o || {});
  const calls = { geo: 0 };
  await s.page.route('https://api.mapbox.com/**', (route) => {
    const url = route.request().url();
    if (/mapbox-gl\.js/.test(url)) return o.gl ? route.fulfill({ status: 200, contentType: 'application/javascript', body: '(' + GL_STUB.toString() + ')(' + Number(o.styleError) + ');' }) : route.abort('blockedbyclient');
    if (/mapbox-gl\.css/.test(url)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (/\/geocoding\//.test(url)) {
      calls.geo++;
      const h = { 'access-control-allow-origin': '*' };
      if (o.geo === '403') return route.fulfill({ status: 403, headers: h, contentType: 'application/json', body: '{"message":"Forbidden"}' });
      const q = decodeURIComponent(url.split('mapbox.places/')[1].split('.json')[0]);
      const miss = o.geo === 'none' || /Finnsinte/i.test(q);
      let n = 0; for (const ch of q) n = (n * 31 + ch.charCodeAt(0)) % 997;
      const body = { features: miss ? [] : [{ center: [11.9 + n / 10000, 57.65 + n / 20000], text: 'Testgatan', address: '1', place_name: q, context: [], relevance: 1 }] };
      return route.fulfill({ status: 200, headers: h, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return route.abort('blockedbyclient');
  });
  return calls;
}

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
    id: 'DASH-E-06', module: 'Dashboard (mobil)', name: 'Mobil 390: Flytta upp/Flytta ned med tryck (inget dra-handtag, inget storleksval), tryckytor ≥ 40 px, inget sidledes överspill; sparas',
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
          small: btns.filter((b) => b.getBoundingClientRect().height < 40).map((b) => b.textContent.trim().slice(0, 20)),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          barBtnsInside: [...document.querySelectorAll('.dash-edit-bar button')].every((b) => b.getBoundingClientRect().right <= window.innerWidth + 1),
        };
      });
      t.assert(!ui.handle && !ui.size, 'mobil: inget dra-handtag och inget storleksval (alla widgets är fullbreda på telefon) ' + JSON.stringify(ui));
      t.assert(ui.up && ui.down && ui.upDisabled, 'mobil: Flytta upp/Flytta ned synliga, upp inaktiv på första');
      t.assert(ui.small.length === 0, 'tryckytor minst 40 px (V3-standard): ' + ui.small.join(', '));
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
    id: 'DASH-E-08', module: 'Dashboard', name: 'Kartan — kartfel skiljs från geokodning och adress: Mapbox GL blockerat → "Kartan kunde inte laddas" med alla tal; GL laddat men geokodningen svarar 403 → "geokodning misslyckades" + admintext om kartnyckeln; kartbakgrunden nekas → rad ovanpå kartan, markörer kvar',
    async run(t) {
      // A. Mapbox blockerat (harnessens route-abort): GL laddas inte
      const s = await t.world.session({ viewport: 'desktop' });
      await s.login('admin');
      await openDash(s);
      await s.page.waitForSelector('.dash-ops-map-empty', { timeout: 15000 });
      const a = await s.eval(() => {
        const g = document.getElementById('dash-ops-geo');
        return {
          n: Dashboard._opsMapJobs.length,
          count: document.getElementById('dash-ops-map-count').textContent,
          kind: document.querySelector('.dash-ops-map-empty').dataset.kind,
          empty: document.querySelector('.dash-ops-map-empty').innerText,
          geo: g.innerText, d: Object.assign({}, g.dataset),
        };
      });
      t.note('A (GL blockerat): ' + a.count + ' | ' + a.empty.replace(/\s+/g, ' ') + ' | ' + a.geo.replace(/\s+/g, ' ').slice(0, 200));
      t.assert(a.n > 0 && a.count === a.n + ' aktiva jobb · 0 med koordinater · ' + a.n + ' saknar koordinater', 'räknaren visar alla tal: ' + a.count);
      t.assert(a.kind === 'nolib' && /Kartan kunde inte laddas/.test(a.empty) && /Mapbox GL/.test(a.empty) && new RegExp('0 av ' + a.n + ' jobb har koordinater').test(a.empty), 'kartfel: "Kartan kunde inte laddas" med förklaring och tal');
      t.assert(new RegExp(a.n + ' av ' + a.n + ' aktiva jobb visas inte på kartan').test(a.geo), 'sammanfattningen: N av N visas inte på kartan');
      t.assert(+a.d.notyet > 0 && +a.d.nocity > 0 && +a.d.notyet + +a.d.nocity + +a.d.noaddr + +a.d.notfound + +a.d.error === a.n, 'orsakerna summerar till alla jobb ' + JSON.stringify(a.d));
      t.assert(new RegExp(a.d.notyet + ' inte geokodade ännu').test(a.geo.replace(/\s+/g, ' ')) && new RegExp(a.d.nocity + ' adress saknar ort/postnummer').test(a.geo.replace(/\s+/g, ' ')), 'geokodning saknas och adress utan ort redovisas var för sig med antal');
      await s.page.locator('.dash-ops-geo-sum').click();
      await s.settle(200);
      const list = await s.eval(() => ({
        open: !document.getElementById('dash-ops-geo-list').hidden,
        expanded: document.querySelector('.dash-ops-geo-sum').getAttribute('aria-expanded'),
        groups: [...document.querySelectorAll('.dash-ops-geo-group')].map((g) => ({ r: g.dataset.reason, n: +g.querySelector('h4 .bdg').textContent, rows: g.querySelectorAll('.dash-ops-geo-row').length, hint: g.querySelector('.dash-ops-geo-hint').textContent })),
      }));
      t.assert(list.open && list.expanded === 'true', '"Visa vilka" fäller ut listan');
      t.assert(list.groups.map((g) => g.r).join(',') === 'nogeo,badaddr' && list.groups.reduce((x, g) => x + g.n, 0) === a.n && list.groups.every((g) => g.rows === g.n && g.hint.length > 40), 'listan: "Geokodning saknas" och "Adressen behöver kompletteras" med förklaring ' + JSON.stringify(list.groups.map((g) => g.r + ':' + g.n)));
      const firstId = await s.eval(() => document.querySelector('.dash-ops-geo-row').dataset.ao);
      await s.page.locator('.dash-ops-geo-row').first().click();
      await s.settle(400);
      t.assert(await s.eval((id) => Router.currentPage === 'pg-ao-detail' && Router.currentParams.aoId === id, firstId), 'en rad öppnar arbetsordern');

      // B. GL laddat (route-stubbe) men geokodningen svarar 403
      const b = await t.world.session({ viewport: 'desktop' });
      const calls = await mapboxRoutes(b, { geo: '403' });
      await b.login('admin');
      await openDash(b);
      await b.page.waitForSelector('.dash-ops-map-empty[data-kind="none"]', { timeout: 15000 });
      await b.settle(300);
      const r = await b.eval(() => { const g = document.getElementById('dash-ops-geo'); return { n: Dashboard._opsMapJobs.length, empty: document.querySelector('.dash-ops-map-empty').innerText, geo: g.innerText, d: Object.assign({}, g.dataset), admin: (g.querySelector('.dash-ops-geo-admin') || {}).textContent || '', markers: window.__markers.length, page: document.getElementById('pg-dash').innerText }; });
      t.note('B (GL ok, geokodning 403): ' + r.empty.replace(/\s+/g, ' ') + ' | sökningar: ' + calls.geo);
      t.assert(r.markers === 0 && !/Kartan kunde inte laddas/.test(r.page), 'kartan laddades — inget "Kartan kunde inte laddas" när bara geokodningen nekas');
      t.assert(new RegExp('Inga av de ' + r.n + ' aktiva jobben har koordinater').test(r.empty) && /geokodning misslyckades/.test(r.empty) && /Adresserna behöver geokodas/.test(r.empty), 'tomläget räknar upp orsakerna: ' + r.empty.replace(/\s+/g, ' '));
      t.assert(+r.d.error >= 1 && +r.d.error + +r.d.notyet === +a.d.notyet && calls.geo >= 1 && calls.geo <= 2, 'en misslyckad sökning stoppar fler (inget hamrande): ' + JSON.stringify(r.d) + ' sökningar ' + calls.geo);
      t.assert(/Kartnyckeln nekas för den här domänen/.test(r.admin), 'admin ser att kartnyckeln nekas (401/403)');

      // C. Kartbakgrunden nekas efter att GL laddats; jobb med sparade koordinater
      const aos = t.fake.get('workOrders');
      aos.push({ id: 'AO-KOORD1', title: 'Har koordinater', customerId: 'K-002', staff: ['ST-001'], log: [], materials: [], checklist: [], status: 'planerad', scheduledDate: new Date().toISOString().slice(0, 10), address: 'Testgatan 1', zip: '411 34', city: 'Göteborg', lat: 57.7012, lng: 11.9681, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      t.fake.set('workOrders', aos);
      const c = await t.world.session({ viewport: 'desktop' });
      await mapboxRoutes(c, { geo: 'none', styleError: 403 });
      await c.login('admin');
      await openDash(c);
      await c.page.waitForSelector('.dash-ops-map-alert', { timeout: 15000 });
      const m = await c.eval(() => ({ alert: document.querySelector('.dash-ops-map-alert').textContent, ids: [...new Set(window.__markers.map((x) => x.el.dataset.aoIds))].join(','), empty: !!document.querySelector('.dash-ops-map-empty'), count: document.getElementById('dash-ops-map-count').textContent }));
      t.note('C (bakgrund nekas): ' + m.alert + ' | ' + m.count);
      t.assert(/kartnyckeln nekas/.test(m.alert) && !m.empty, 'kartbakgrunden nekas: en rad ovanpå kartan, kartan ersätts inte');
      t.assert(m.ids === 'AO-KOORD1' && /1 på kartan/.test(m.count), 'jobbet med sparade koordinater har en markör: ' + m.ids + ' | ' + m.count);
    },
  },
  {
    id: 'DASH-E-10', module: 'Dashboard', name: 'Kartan — geokodningen svarar med träffar: över 20 jobb utan koordinater → högst 20 sökningar per visning, resten "inte geokodade ännu"; adress som inte hittas, adress utan ort och jobb utan adress redovisas var för sig; koordinater som text placeras',
    async run(t) {
      const aos = t.fake.get('workOrders');
      const today = new Date().toISOString().slice(0, 10);
      const base = { customerId: 'K-002', staff: ['ST-001'], log: [], materials: [], checklist: [], status: 'planerad', scheduledDate: today, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      for (let i = 1; i <= 41; i++) aos.push(Object.assign({}, base, { id: 'AO-G' + i, title: 'Geokoda ' + i, address: 'Lastgatan ' + i, zip: '411 ' + String(10 + i), city: 'Göteborg' }));
      aos.push(Object.assign({}, base, { id: 'AO-NF1', title: 'Adress finns inte', priority: 'akut', address: 'Finnsintegatan 99', zip: '999 99', city: 'Ingenstans' }));
      aos.push(Object.assign({}, base, { id: 'AO-NA1', title: 'Utan adress', customerId: null, address: '' }));
      aos.push(Object.assign({}, base, { id: 'AO-NC1', title: 'Utan ort', address: 'Ensamgatan 3' }));
      aos.push(Object.assign({}, base, { id: 'AO-STR1', title: 'Koordinater som text', address: 'Testgatan 1', zip: '411 34', city: 'Göteborg', lat: '57.7012', lng: '11.9681' }));
      t.fake.set('workOrders', aos);
      const s = await t.world.session({ viewport: 'desktop' });
      const calls = await mapboxRoutes(s, { geo: 'hits' });
      await s.login('admin');
      await openDash(s);
      await s.page.waitForFunction(() => (window.__markers || []).length > 20, null, { timeout: 20000 });
      await s.settle(800);
      const r = await s.eval(() => {
        const g = document.getElementById('dash-ops-geo');
        const st = {}; (Dashboard._opsMapDiag || []).forEach((d) => { st[d.status] = (st[d.status] || 0) + 1; });
        const byId = {}; (Dashboard._opsMapDiag || []).forEach((d) => { byId[d.ao.id] = d.status; });
        return { n: Dashboard._opsMapJobs.length, st, byId: { NF: byId['AO-NF1'], NA: byId['AO-NA1'], NC: byId['AO-NC1'], STR: byId['AO-STR1'] }, d: Object.assign({}, g.dataset), geo: g.innerText.replace(/\s+/g, ' '), count: document.getElementById('dash-ops-map-count').textContent, ids: new Set(window.__markers.map((x) => x.el.dataset.aoIds)).size, str: window.__markers.some((x) => x.el.dataset.aoIds === 'AO-STR1'), empty: !!document.querySelector('.dash-ops-map-empty'), page: document.getElementById('pg-dash').innerText };
      });
      t.note('status: ' + JSON.stringify(r.st) + ' sökningar: ' + calls.geo + ' | ' + r.count + ' | ' + r.geo.slice(0, 220));
      t.assert(!r.empty && !/Kartan kunde inte laddas/.test(r.page), 'kartan visas');
      t.assert(r.byId.STR === 'coords' && r.str, 'koordinater sparade som text placeras utan sökning');
      t.assert(r.byId.NF === 'notfound' && r.byId.NA === 'noaddr' && r.byId.NC === 'nocity', 'orsak per jobb: hittades inte / saknar adress / saknar ort ' + JSON.stringify(r.byId));
      t.assert((r.st.geocoded || 0) >= 19 && +r.d.notyet >= 1 && calls.geo <= 40, 'högst 20 sökningar per visning, resten väntar: ' + JSON.stringify(r.st) + ' sökningar ' + calls.geo);
      t.assert(new RegExp(r.d.notyet + ' inte geokodade ännu').test(r.geo) && /1 adress saknar ort\/postnummer|\d+ adress saknar ort\/postnummer/.test(r.geo) && /1 saknar adress/.test(r.geo) && /1 adressen hittades inte/.test(r.geo), 'sammanfattningen räknar varje orsak separat: ' + r.geo.slice(0, 260));
      t.assert(+r.d.missing + (r.st.coords || 0) + (r.st.geocoded || 0) === r.n, 'placerade + saknade = alla aktiva jobb');
      t.assert(/på kartan/.test(r.count) && new RegExp(r.d.missing + ' saknar koordinater').test(r.count), 'räknaren: ' + r.count);
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
  {
    id: 'DASH-E-11', module: 'Dashboard', name: 'Realistiskt innehåll (V3-standard §12): 40 försenade aktiviteter, 30 jobb i poolen, 150 aktiva jobb och långa titlar → korten visar de viktigaste först och "Visa …", titlar kortas av, inget sidledes överspill vid 390/1366; tomlägen utan NaN/undefined',
    async run(t) {
      const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
      const LONG = 'Byte av samtliga termostatventiler och injustering av värmesystemet i trapphus B, C och D inklusive besiktningsprotokoll och slutdokumentation';
      t.fake.set('activities', Array.from({ length: 40 }, (_, i) => ({ id: 'ACT-R' + i, type: i % 2 ? 'call' : 'followup', title: LONG + ' (' + (i + 1) + ')', status: 'open', dueDate: ago(2 + i).slice(0, 10), assignedTo: 'ST-001', createdBy: 'ST-001', createdAt: ago(60) })));
      const aos = t.fake.get('workOrders');
      const base = { customerId: 'K-002', log: [], materials: [], checklist: [], updatedAt: ago(0) };
      const prios = ['låg', 'normal', 'hög', 'akut'];
      for (let i = 0; i < 30; i++) aos.push(Object.assign({}, base, { id: 'AO-RP' + i, title: LONG + ' — pool ' + i, status: 'pool', staff: [], priority: prios[i % 4], createdAt: ago(1 + i) }));
      for (let i = 0; i < 150; i++) aos.push(Object.assign({}, base, { id: 'AO-RA' + i, title: LONG + ' — jobb ' + i, status: 'planerad', staff: ['ST-001'], scheduledDate: ago(-1 - (i % 20)).slice(0, 10), address: 'Långa vägen ' + (i + 1), createdAt: ago(10) }));
      t.fake.set('workOrders', aos);
      const problems = [];
      for (const vp of ['d25_390', 'd25_1366']) {
        const s = await t.world.session({ viewport: vp });
        await s.login('admin');
        await openDash(s);
        await s.settle(400);
        const r = await s.eval(() => {
          const vis = (e) => !!e && e.offsetParent !== null && e.getBoundingClientRect().height > 0;
          const od = document.querySelector('[data-w="overdue_alert"]');
          const pool = document.querySelector('[data-w="pool"]');
          const mapRows = [...document.querySelectorAll('.dash-ops-map-list .dash-job-row')];
          const titles = [...document.querySelectorAll('.dash-layout .dwr-t, .dash-layout .crow-title, .dash-job-row-title')].filter(vis);
          return {
            odRows: od ? od.querySelectorAll('.dwr').length : -1, odCount: od && (od.querySelector('.dw-count') || {}).textContent, odH: od ? Math.round(od.getBoundingClientRect().height) : 0,
            odGo: !!(od && od.querySelector('.dw-go')),
            poolVis: pool ? [...pool.querySelectorAll('.crow')].filter(vis).length : -1, poolFirst: pool && (pool.querySelector('.crow .bdg') || {}).textContent, poolMore: pool ? [...pool.querySelectorAll('button')].some((b) => vis(b) && /Visa (alla|fler)/.test(b.textContent)) : false,
            poolCount: pool && (pool.querySelector('.dw-count') || {}).textContent,
            mapRows: mapRows.length, mapMore: (document.querySelector('.dash-ops-more') || {}).textContent || '',
            wrapped: titles.filter((e) => e.getBoundingClientRect().height > 40).length, truncated: titles.filter((e) => e.scrollWidth > e.clientWidth + 1).length,
            bad: /NaN|undefined|\[object Object\]/.test(document.getElementById('pg-dash').innerText),
          };
        });
        t.note(vp + ': ' + JSON.stringify(r));
        if (r.odRows !== 3 || r.odCount !== '40' || !r.odGo) problems.push(vp + ' Försenade aktiviteter: ' + JSON.stringify([r.odRows, r.odCount, r.odGo]));
        if (r.odH > 420) problems.push(vp + ' Försenade aktiviteter för högt: ' + r.odH);
        if (r.poolVis > 4 || r.poolVis < 1 || !r.poolMore) problems.push(vp + ' Arbetspool visar ' + r.poolVis + ' rader, Visa-knapp ' + r.poolMore);
        if (!/Akut/.test(r.poolFirst || '')) problems.push(vp + ' Arbetspool: akut inte först (' + r.poolFirst + ')');
        if (!/^3\d väntar$/.test((r.poolCount || '').trim())) problems.push(vp + ' Arbetspool antal: ' + r.poolCount);
        if (r.mapRows > 25) problems.push(vp + ' kartlistan renderar ' + r.mapRows + ' rader');
        if (vp === 'd25_1366' && !/Visa alla 1\d\d aktiva jobb/.test(r.mapMore)) problems.push(vp + ' kartlistan saknar "Visa alla N aktiva jobb" (' + r.mapMore + ')');
        if (r.wrapped > 0) problems.push(vp + ' ' + r.wrapped + ' titlar bryts på flera rader i stället för att kortas av');
        if (r.truncated < 3) problems.push(vp + ' långa titlar kortas inte av (' + r.truncated + ')');
        if (r.bad) problems.push(vp + ' NaN/undefined i texten');
        (await s.layoutIssues()).forEach((x) => problems.push(vp + ': ' + x));
        await s.context.close();
      }
      // Tomlägen: användare med få/inga egna jobb
      const e = await t.world.session({ viewport: 'd25_390' });
      await e.login('begransad');
      await openDash(e);
      await e.settle(400);
      const em = await e.eval(() => ({ txt: document.getElementById('pg-dash').innerText, empties: [...document.querySelectorAll('#pg-dash .empty, #pg-dash .dt-empty')].filter((x) => x.offsetParent).map((x) => x.innerText.trim()).filter(Boolean) }));
      t.note('begränsad: tomlägen ' + JSON.stringify(em.empties.slice(0, 5)));
      if (/NaN|undefined|\[object Object\]/.test(em.txt)) problems.push('begränsad: NaN/undefined');
      (await e.layoutIssues()).forEach((x) => problems.push('begränsad: ' + x));
      t.assert(problems.length === 0, problems.join(' ; '));
    },
  },
];
