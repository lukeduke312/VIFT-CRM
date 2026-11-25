'use strict';
/* Dashboardkartan: flera AO på samma plats (Vasaplatsen 8, Göteborg). Mapbox
   ersätts av en stubbe som registrerar markörer och popup-innehåll — inga
   externa anrop. */
const STUB = () => {
  window.__markers = [];
  window.VIFT_CONFIG = Object.assign({}, window.VIFT_CONFIG || {}, { mapboxToken: 'pk.e2e-stub' });
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

module.exports = [
  {
    id: 'MAP-01', module: 'Dashboard', name: 'Karta: två AO på Vasaplatsen 8 → en markör med "2", popup listar båda med status och Akut; olika adress med samma koordinat grupperas inte ihop; räknaren skiljer jobb/platser/ej placerade',
    async run(t) {
      const aos = t.fake.get('workOrders');
      const base = { customerId: 'K-002', staff: ['ST-001'], log: [], materials: [], checklist: [], status: 'planerad', scheduledDate: new Date().toISOString().slice(0, 10), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      aos.push(Object.assign({}, base, { id: 'AO-VP1', title: 'Byte ventil Vasaplatsen', address: 'Vasaplatsen 8', zip: '411 34', city: 'Göteborg', lat: 57.6990, lng: 11.9700 }));
      aos.push(Object.assign({}, base, { id: 'AO-VP2', title: 'Läcka Vasaplatsen', address: 'Vasaplatsen 8', zip: '411 34', city: 'Göteborg', lat: 57.6990, lng: 11.9700, priority: 'akut', status: 'pågående' }));
      aos.push(Object.assign({}, base, { id: 'AO-VP3', title: 'Granne Vasaplatsen 10', address: 'Vasaplatsen 10', zip: '411 34', city: 'Göteborg', lat: 57.6990, lng: 11.9700 }));
      t.fake.set('workOrders', aos);
      const s = await t.world.session({ viewport: 'desktop' });
      await s.page.addInitScript(STUB);
      await s.login('admin');
      await s.go('pg-dash');
      await s.page.waitForFunction(() => (window.__markers || []).length > 0, null, { timeout: 15000 });
      await s.settle(800);
      const m = await s.eval(() => window.__markers.map((x) => ({ count: x.el.dataset.count, ids: x.el.dataset.aoIds, html: x.popup ? x.popup.html : '', ll: x.ll })));
      const vp = m.find((x) => (x.ids || '').includes('AO-VP1'));
      t.assert(vp && vp.count === '2' && vp.ids.includes('AO-VP2'), 'en markör med 2 AO för Vasaplatsen 8: ' + JSON.stringify(vp && { c: vp.count, ids: vp.ids }));
      t.assert(/Byte ventil Vasaplatsen/.test(vp.html) && /Läcka Vasaplatsen/.test(vp.html) && /Akut/.test(vp.html), 'popupen listar båda och visar Akut');
      t.assert((vp.html.match(/Öppna/g) || []).length === 2, 'varje AO kan öppnas separat');
      const n10 = m.find((x) => (x.ids || '') === 'AO-VP3');
      t.assert(n10 && n10.count === '1', 'Vasaplatsen 10 har egen markör trots samma koordinat');
      t.assert(n10.ll[0] !== vp.ll[0] || n10.ll[1] !== vp.ll[1], 'de två platserna ligger inte exakt ovanpå varandra');
      const cnt = await s.text('#dash-ops-map-count');
      t.note('räknare: ' + cnt);
      t.assert(/platser på kartan/.test(cnt), 'räknaren visar antal platser');
      const el = await s.eval(() => { const x = window.__markers.find((k) => k.el.dataset.count === '2'); return x && x.el.className; });
      t.assert(/dash-map-cluster/.test(el) && /akut/.test(el), 'gruppmarkören är röd när en AO är akut');
      const list = await s.text('#pg-dash');
      t.assert(/Byte ventil Vasaplatsen/.test(list) && /Läcka Vasaplatsen/.test(list), 'listan bredvid kartan visar fortfarande båda');
    },
  },
  {
    id: 'CAL-02', module: 'Kalender', name: 'Kalender (veckovy): överlappande arbetsordrar ritas sida vid sida — ingen döljer den andra',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-calendar');
      await s.eval(() => CalendarPage.setView('vecka'));
      await s.settle(400);
      const boxes = await s.eval(() => Array.from(document.querySelectorAll('.page.active .cal-timed-evt')).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 30), x: Math.round(r.left), w: Math.round(r.width), y: Math.round(r.top), h: Math.round(r.height) }; }));
      const overlaps = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ix > 2 && iy > 2) overlaps.push(a.t + ' / ' + b.t);
      }
      t.note('händelser: ' + boxes.length);
      t.assert(boxes.length >= 2, 'testdata har minst två tidsatta händelser i veckan');
      t.assert(overlaps.length === 0, 'inga händelser ritas ovanpå varandra: ' + overlaps.join('; '));
    },
  },
  {
    id: 'UI-KV-01', module: 'Designstandard', name: 'Etikett/värde (kv): på dator står värdet nära etiketten; på mobil står etikett och värde kvar på samma rad (staplade rader gjorde säljkorten ~20 % högre)',
    async run(t) {
      const measure = () => [...document.querySelectorAll('#pg-sales .kv .dr')].filter((r) => r.offsetParent && r.querySelector('.dv')).slice(0, 6).map((r) => {
        const l = r.firstElementChild.getBoundingClientRect(); const v = r.querySelector('.dv').getBoundingClientRect();
        return { sameRow: Math.abs(l.top - v.top) < 8, gap: Math.round(v.left - l.right) };
      });
      const d = await t.world.session({ viewport: 'laptop' });
      await d.login('admin'); await d.go('pg-sales'); await d.settle(400);
      const dm = await d.eval(measure);
      t.assert(dm.length >= 3, 'säljkorten har etikett/värde-rader (laptop): ' + dm.length);
      t.assert(dm.every((x) => x.sameRow && x.gap < 200), 'laptop: värdet på samma rad och nära etiketten ' + JSON.stringify(dm));
      const m = await t.world.session({ viewport: 'iphone' });
      await m.login('admin'); await m.go('pg-sales'); await m.settle(400);
      const mm = await m.eval(measure);
      t.assert(mm.length >= 3, 'säljkorten har etikett/värde-rader (iPhone): ' + mm.length);
      t.assert(mm.filter((x) => x.sameRow).length >= mm.length - 1, 'iPhone: etikett och värde på samma rad (högst en lång text får brytas) ' + JSON.stringify(mm));
    },
  },
  {
    /* 2026-11-26 (V3 övriga sidor, F-10): sidhuvudet är nu det gemensamma
       detaljhuvudet (.mx-dh) med namnet som rubrik på alla bredder. Den
       tidigare mobilregeln "bara numret i åtgärdsraden, namnet står i
       kortet" ersätts av: namnet står i rubriken, kapas inte, numret syns
       intill — och namnet upprepas inte längre i snabbrad och kort
       (tidigare tre gånger på mobil). */
    id: 'UI-PROP-01', module: 'Designstandard', name: 'Fastighetskortets huvud: namnet är rubrik och kapas inte på dator eller mobil, numret syns, och namnet upprepas inte i sidan',
    async run(t) {
      const probe = () => {
        const el = document.querySelector('#pg-obj-detail .mx-dh-title'); if (!el) return null;
        const sub = document.querySelector('#pg-obj-detail .mx-dh-sub');
        const p = getObj(PropertyDetailPage.propId);
        const vis = [...document.querySelectorAll('#pg-obj-detail-content *')].filter((e) => e.offsetParent && e.children.length === 0 && (e.textContent || '').trim() === p.name);
        return { text: el.innerText, name: p.name, num: displayNumberOf(p), sub: sub ? sub.innerText : '', clipped: el.scrollWidth > el.clientWidth + 1, nameCount: vis.length };
      };
      for (const vp of ['laptop', 'iphone']) {
        const s = await t.world.session({ viewport: vp });
        await s.login('admin');
        const pid = await s.eval(() => state.properties[0].id);
        await s.go('pg-obj-detail', { propId: pid });
        await s.settle(300);
        const r = await s.eval(probe);
        t.note(vp + ': ' + JSON.stringify(r));
        t.assert(r, vp + ': huvudet har en rubrik');
        t.assert(r.text === r.name, vp + ': rubriken är fastighetens namn (' + r.text + ')');
        t.assert(!r.clipped, vp + ': rubriken kapas inte (' + r.text + ')');
        t.assert(r.sub.includes(r.num), vp + ': numret visas under rubriken (' + r.sub + ')');
        t.assert(r.nameCount === 1, vp + ': namnet visas en gång i sidan (' + r.nameCount + ')');
      }
    },
  },
  {
    id: 'UI-BDG-01', module: 'Designstandard', name: 'AO-listan: "Redo fakturering" är ett ljust statusmärke som övriga, inte ett fyllt marinblått filterchip',
    async run(t) {
      for (const vp of ['laptop', 'iphone']) {
        const s = await t.world.session({ viewport: vp });
        await s.login('admin');
        await s.go('pg-ao');
        await s.settle(400);
        const r = await s.eval(() => {
          const el = [...document.querySelectorAll('#pg-ao span')].find((x) => x.children.length <= 1 && /Redo fakturering/.test(x.textContent) && x.offsetParent && !x.closest('.qf-row, .filter-panel, .ao-tabs-row, [class*="quick"]') && x.getBoundingClientRect().top > 150);
          if (!el) return null;
          const m = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number);
          return { cls: el.className, lum: Math.round(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) };
        });
        t.note(vp + ': ' + JSON.stringify(r));
        t.assert(r, vp + ': listan har minst en AO som är redo för fakturering');
        t.assert(r.lum > 180, vp + ': märket har ljus bakgrund (luminans ' + r.lum + ')');
      }
    },
  },
];
