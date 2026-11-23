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
];
