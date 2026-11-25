'use strict';
/* V3 nattkörning 2026-11-26 — arbetsblock "misc" (övriga sidor):
   Projekt, Projektkort, Kontrakt, Importera, Importlogg, Exportcenter,
   Kalender, Fastighetskort, Objekt, Kundkort, Rondering (lista, guide,
   utförande). Simulerad server, syntetisk demodata. */

const ld = (n) => { const d = new Date(); d.setDate(d.getDate() + (n || 0)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/* Syntetiska projekt, avtal, objekt och importlogg (demodatan saknar dem). */
function seedMisc(fake) {
  const now = new Date().toISOString();
  const prj = (id, name, cu, prop, status, resp, s, e, extra) => Object.assign({ id, name, customerId: cu, propertyId: prop, allowMultiProperty: false, status, responsibleUserId: resp, startDate: s, endDate: e, description: '', note: '', archived: false, createdAt: now, updatedAt: now, createdBy: 'ST-001' }, extra || {});
  fake.set('projects', [
    prj('PRJ-001', 'Stambyte Solgläntan hus A', 'K-001', 'OBJ-001', 'pågående', 'ST-003', ld(-20), ld(40), { description: 'Byte av stammar och badrum i hus A, trapphus 1–3.' }),
    prj('PRJ-002', 'Takrenovering Granitgatan', 'K-002', 'OBJ-002', 'planerad', 'ST-001', ld(10), ld(60)),
    prj('PRJ-003', 'Fönsterbyte etapp 1', 'K-004', 'OBJ-003', 'pausad', '', ld(-60), ''),
    prj('PRJ-004', 'Hissmodernisering Parkgatan', 'K-006', 'OBJ-004', 'klar', 'ST-003', ld(-120), ld(-10)),
    prj('PRJ-005', 'Fasadtvätt 2025', 'K-001', '', 'avslutad', '', ld(-400), ld(-380), { archived: true }),
  ]);
  const con = (id, title, cu, type, status, amount, period, extra) => Object.assign({ id, customerId: cu, propertyId: '', title, type, description: '', startDate: ld(-200), endDate: '', tillsvidare: true, noticePeriod: 3, autoRenew: false, amount, period, services: [], status, note: '', createdAt: now, updatedAt: now }, extra || {});
  fake.set('contracts', [
    con('KON-001', 'Serviceavtal gemensamma utrymmen', 'K-001', 'service', 'aktiv', 12500, 'månad'),
    con('KON-002', 'Rondering kvartalsvis', 'K-002', 'rondering', 'aktiv', 8000, 'kvartal'),
    con('KON-003', 'Trappstädning', 'K-004', 'städ', 'utkast', 3400, 'månad'),
    con('KON-004', 'Snöröjning 2024/25', 'K-006', 'övrigt', 'avslutad', 45000, 'år', { tillsvidare: false, endDate: ld(-30) }),
  ]);
  fake.set('propertyObjects', [{ id: 'POBJ-E2E-1', customerId: 'K-001', propertyId: 'OBJ-001', objectNumber: '1001', type: 'lagenhet', name: 'Lgh 1001', address: 'Solvägen 1', postalCode: '123 45', city: 'Stockholm', entrance: 'A', stairwell: '1', floor: '2', apartmentNumber: '1001', area: 74, status: 'aktiv', description: '', primaryContactId: '', accessInformation: '', doorCode: '', keyInformation: '', documents: [], images: [], contacts: [], technicalSystems: {}, equipment: [], createdAt: now, updatedAt: now }]);
  fake.set('importLogs', [{ id: 'IMP-001', type: 'customer', filename: 'kunder-november.csv', createdAt: now, performedBy: 'ST-001', createdCount: 12, updatedCount: 3, skippedCount: 1, errorCount: 0, errors: [], undone: false, createdIds: [], updatedSnapshots: [] }]);
}

/* Realistisk mängd (granskning och test med innehåll, inte tomläge):
   120 projekt i alla faser (långa namn, försenade, arkiverade), 110 avtal,
   14 importer, en fastighet med långt namn, 9 AO samma dag i kalendern
   (överlappande, långa titlar) och tre AO kopplade till PRJ-001. */
const LONG = 'Byte av samtliga radiatorventiler i trapphus A–C inklusive injustering av värmesystemet och protokoll till styrelsen';
function seedRealistic(fake) {
  seedMisc(fake);
  const now = new Date().toISOString();
  const cus = ['K-001', 'K-002', 'K-003', 'K-004', 'K-005', 'K-006', 'K-007'];
  const props = { 'K-001': 'OBJ-001', 'K-002': 'OBJ-002', 'K-004': 'OBJ-003', 'K-006': 'OBJ-004' };
  const sts = ['planerad', 'pågående', 'pausad', 'klar', 'avslutad'];
  const resp = ['ST-001', 'ST-003', 'ST-002', ''];
  const names = ['Stambyte', 'Takrenovering', 'Fönsterbyte etapp', 'Hissmodernisering', 'Fasadrenovering', 'Energieffektivisering och byte av ventilationsaggregat', 'Laddplatser garage', 'Tvättstuga', 'Relining avlopp', 'Balkongrenovering'];
  const projects = fake.get('projects');
  for (let i = 6; i <= 125; i++) {
    const cu = cus[i % cus.length];
    projects.push({ id: 'PRJ-' + String(i).padStart(3, '0'), name: names[i % names.length] + ' ' + (i % 3 === 0 ? 'hus ' + 'ABC'[i % 3] + ', trapphus 1–4 med tillhörande gemensamma utrymmen' : 'nr ' + i), customerId: cu, propertyId: props[cu] || '', allowMultiProperty: false,
      status: sts[i % 5], responsibleUserId: resp[i % 4], startDate: ld(-200 + i), endDate: i % 7 === 0 ? '' : ld(-90 + i * 2), description: '', note: '', archived: i % 11 === 0,
      createdAt: now, updatedAt: new Date(Date.now() - i * 3600000).toISOString(), createdBy: 'ST-001' });
  }
  fake.set('projects', projects);
  const types = ['service', 'rondering', 'städ', 'övrigt'];
  const cst = ['aktiv', 'aktiv', 'utkast', 'pausad', 'avslutad'];
  const per = ['månad', 'kvartal', 'år', 'månad'];
  const contracts = fake.get('contracts');
  for (let i = 5; i <= 114; i++) {
    contracts.push({ id: 'KON-' + String(i).padStart(3, '0'), customerId: cus[i % cus.length], propertyId: '', title: (i % 4 === 0 ? 'Serviceavtal gemensamma utrymmen, tvättstugor och undercentraler – ' : 'Avtal ') + i, type: types[i % 4], description: '',
      startDate: ld(-400 + i), endDate: i % 3 === 0 ? ld(30 + i) : '', tillsvidare: i % 3 !== 0, noticePeriod: 3, autoRenew: i % 2 === 0, amount: 1500 + (i * 731) % 40000, period: per[i % 4], services: [], status: cst[i % 5], note: '',
      createdAt: new Date(Date.now() - i * 86400000).toISOString(), updatedAt: now });
  }
  fake.set('contracts', contracts);
  const logs = fake.get('importLogs');
  for (let i = 2; i <= 15; i++) {
    logs.push({ id: 'IMP-' + String(i).padStart(3, '0'), type: ['customer', 'property', 'article', 'staff'][i % 4], filename: (i % 5 === 0 ? 'export-från-gamla-systemet-med-mycket-långt-filnamn-' : 'import-') + i + '.csv', createdAt: new Date(Date.now() - i * 86400000 * 3).toISOString(),
      performedBy: i % 2 ? 'ST-001' : 'ST-003', createdCount: (i * 7) % 130, updatedCount: i % 4, skippedCount: i % 3, errorCount: i % 6 === 0 ? 2 : 0,
      errors: i % 6 === 0 ? [{ row: 4, field: 'orgNr', message: 'Ogiltigt organisationsnummer' }, { row: 9, field: 'name', message: 'Namn saknas' }] : [], undone: i % 7 === 0, createdIds: [], updatedSnapshots: [] });
  }
  fake.set('importLogs', logs);
  const properties = fake.get('properties');
  properties.push(Object.assign({}, properties[0], { id: 'OBJ-LONG', name: 'Bostadsrättsföreningen Kungsholmens Strand Hus C – Västra gaveln med garage', address: 'Kungsholms Strand 147', serviceIntervals: [], contacts: [], notes: [] }));
  fake.set('properties', properties);
  const aos = fake.get('workOrders');
  const base = aos.find((a) => a.id === 'AO-001');
  const times = [['07:00', '09:00'], ['07:30', '10:00'], ['08:00', '12:00'], ['09:00', '11:30'], ['10:00', '14:00'], ['12:30', '13:30'], ['13:00', '16:00'], ['14:00', '15:00'], ['', '']];
  times.forEach(([s, e], k) => aos.push(Object.assign(JSON.parse(JSON.stringify(base)), { id: 'AO-D' + (k + 1), title: (k % 3 === 0 ? LONG : 'Felanmälan lägenhet ' + (1100 + k)), status: k % 4 === 0 ? 'planerad' : 'pågående',
    scheduledDate: ld(0), scheduledStart: s, scheduledEnd: e, staff: [['ST-002'], ['ST-003'], ['ST-004'], ['ST-002', 'ST-004']][k % 4], timeEntries: [], invoiceId: '' })));
  ['AO-001', 'AO-002', 'AO-004'].forEach((id) => { const a = aos.find((x) => x.id === id); if (a) a.projectId = 'PRJ-001'; });
  fake.set('workOrders', aos);
}

/* Mätbredder (skala 1). Läggs till i harnessens VIEWPORTS bara för denna fil. */
const lib = require('../lib');
lib.VIEWPORTS.mx360 = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
lib.VIEWPORTS.mx390 = { viewport: { width: 390, height: 664 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
lib.VIEWPORTS.mx1366 = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 };
lib.VIEWPORTS.mx1920 = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };

async function open(t, vp, user, page, params) {
  if (!t.__seeded) { (t.__seedFn || seedMisc)(t.fake); t.__seeded = true; }
  const s = await t.world.session({ viewport: vp });
  await s.login(user || 'admin');
  if (page) { await s.go(page, params || {}); await s.settle(300); }
  return s;
}

/* Sidans bredd: inget horisontellt sidöverflöd och inget element i aktiv
   sida som sticker ut till höger utanför en rullbar behållare. */
function overflowProbe() {
  const vw = document.documentElement.clientWidth;
  const out = { page: document.documentElement.scrollWidth - vw, wide: [] };
  const pg = document.querySelector('.page.active');
  if (!pg) return out;
  pg.querySelectorAll('*').forEach((e) => {
    if (!e.offsetParent) return;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.right <= vw + 1) return;
    let p = e.parentElement, scroller = false;
    while (p && p !== pg) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') { scroller = true; break; } p = p.parentElement; }
    if (!scroller) out.wide.push((e.className && typeof e.className === 'string' ? e.className.split(' ')[0] : e.tagName) + ':' + Math.round(r.right));
  });
  out.wide = out.wide.slice(0, 6);
  return out;
}

/* Detaljhuvudet (F-10): höjd, tillbaka + rubrik på samma rad, primär åtgärd synlig. */
function headProbe(pageId) {
  const h = document.querySelector('#' + pageId + ' .mx-dh');
  if (!h) return null;
  const r = (sel) => { const e = h.querySelector(sel); if (!e || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height }; };
  const hb = h.getBoundingClientRect();
  return { h: Math.round(hb.height), back: r('.mx-dh-back'), title: r('.mx-dh-title'), primary: r('.mx-dh-primary'), more: r('.mx-dh-more'), vw: innerWidth, vh: innerHeight };
}

/* Synlig text och attribut som visar markup/attribut som text. */
function leakProbe(rootSel) {
  const root = document.querySelector(rootSel);
  const hits = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    if (!el || !el.offsetParent || el.closest('script,style,textarea')) continue;
    if (/="|oninput=|onclick=|value=|<svg|<\/?(span|div|button)\b/i.test(n.nodeValue)) hits.push(n.nodeValue.trim().slice(0, 60));
  }
  root.querySelectorAll('[placeholder]').forEach((e) => { if (/[<>]|="/.test(e.getAttribute('placeholder'))) hits.push('placeholder: ' + e.getAttribute('placeholder').slice(0, 60)); });
  return hits;
}

/* Kontrast (WCAG) mellan beräknad textfärg och närmaste ogenomskinliga
   bakgrund; opacitet längs vägen blandas in. */
function contrastProbe(sel) {
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return { r: 0, g: 0, b: 0, a: 0 }; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  return [...document.querySelectorAll(sel)].filter((el) => el.offsetParent && (el.textContent || '').trim()).map((el) => {
    let fg = parse(getComputedStyle(el).color);
    let e = el, bg = null, op = 1;
    for (let x = el; x; x = x.parentElement) op *= +getComputedStyle(x).opacity;
    while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a >= 0.99) { bg = c; break; } e = e.parentElement; }
    bg = bg || { r: 255, g: 255, b: 255, a: 1 };
    const a = fg.a * op;
    if (a < 1) fg = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
    const L1 = lum(fg), L2 = lum(bg);
    const cs = getComputedStyle(el);
    const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && +cs.fontWeight >= 700);
    return { t: el.textContent.trim().slice(0, 30), ratio: Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100, large };
  });
}

/* F-02: en ikon (svg) med display:block i ett element som inte är flex/grid
   och som också har text hamnar på egen rad ovanför texten. */
function iconLineProbe(rootSel) {
  const root = document.querySelector(rootSel);
  const hits = [];
  root.querySelectorAll('svg').forEach((svg) => {
    if (!svg.getBoundingClientRect().width || !svg.parentElement || !svg.parentElement.offsetParent) return;
    const p = svg.parentElement; const pd = getComputedStyle(p).display;
    if (/flex|grid/.test(pd)) return;
    const txt = [...p.childNodes].some((n) => (n.nodeType === 3 && n.nodeValue.trim()) || (n.nodeType === 1 && n !== svg && (n.textContent || '').trim()));
    if (!txt) return;
    // Textrader (textnoder i föräldern): ligger någon på samma höjd som ikonen?
    const sr = svg.getBoundingClientRect();
    const textRects = [];
    [...p.childNodes].forEach((n) => { if (n.nodeType === 3 && n.nodeValue.trim()) { const r = document.createRange(); r.selectNodeContents(n); textRects.push(...[...r.getClientRects()].filter((x) => x.width > 0)); } });
    const ownLine = textRects.length > 0 && !textRects.some((r) => r.top < sr.bottom - 1 && r.bottom > sr.top + 1);
    if (getComputedStyle(svg).display === 'block' || ownLine) hits.push((p.className || p.tagName).toString().split(' ')[0] + ': ' + (p.textContent || '').trim().slice(0, 30));
  });
  return hits.slice(0, 8);
}

const tests = [
  {
    id: 'MISC-IMP-01', module: 'Import och export', name: 'Importera (F-03/F-11): guiden ryms i 360/390/1366 utan att klippas, stegen syns, inaktiv Nästa ser ut som en knapp och aktiveras när fil valts',
    async run(t) {
      for (const vp of ['mx360', 'mx390', 'mx1366']) {
        const s = await open(t, vp, 'admin', 'pg-import-wizard', { type: 'customer' });
        const r = await s.eval(() => {
          const w = document.querySelector('#pg-import-wizard .imp-wizard').getBoundingClientRect();
          const vis = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent && e.getBoundingClientRect().width > 0);
          const steps = vis('#pg-import-wizard .mx-step, #pg-import-wizard .mx-steps-m');
          const stepsRight = Math.max(0, ...steps.map((e) => e.getBoundingClientRect().right));
          const next = document.getElementById('imp-btn-next');
          const cs = getComputedStyle(next);
          return { w: Math.round(w.width), right: Math.round(w.right), vw: document.documentElement.clientWidth, stepsRight: Math.round(stepsRight), nSteps: steps.length,
            disabled: next.disabled, bg: cs.backgroundColor, border: cs.borderTopWidth, nextH: next.getBoundingClientRect().height, op: +cs.opacity, hint: (document.getElementById('imp-next-hint') || {}).textContent };
        });
        const ov = await s.eval(overflowProbe);
        t.note(vp + ' ' + JSON.stringify(r));
        t.assert(r.w <= r.vw && r.right <= r.vw + 1, vp + ': guiden är högst fönstrets bredd (' + r.w + ' / ' + r.vw + ')');
        t.assert(r.nSteps >= 1 && r.stepsRight <= r.vw + 1, vp + ': stegindikatorn ryms (' + r.stepsRight + ')');
        t.assert(ov.page <= 1 && ov.wide.length === 0, vp + ': inget klipps till höger ' + JSON.stringify(ov));
        t.assert(r.disabled && r.bg !== 'rgba(0, 0, 0, 0)' && r.bg !== 'transparent' && r.nextH >= 34 && r.op >= 0.4 && r.op < 1, vp + ': inaktiv Nästa har knappform (fylld, ' + r.bg + ', opacitet ' + r.op + ')');
        t.assert(/Välj en fil/.test(r.hint || ''), vp + ': hjälptext förklarar varför Nästa är inaktiv');
        await s.page.setInputFiles('#imp-file-input', { name: 'k.csv', mimeType: 'text/csv', buffer: Buffer.from('Kundtyp;Namn\r\nFöretag;Test AB', 'utf8') });
        await s.settle(200);
        const after = await s.eval(() => ({ disabled: document.getElementById('imp-btn-next').disabled, op: +getComputedStyle(document.getElementById('imp-btn-next')).opacity }));
        t.assert(!after.disabled && after.op === 1, vp + ': Nästa blir aktiv när en fil valts');
      }
    },
  },
  {
    id: 'MISC-PROP-01', module: 'Fastighetsregister', name: 'Fastighetskortet (F-06): alla flikar syns och nås på 360/390/1366/1920, aktiv flik markeras, varje flik visar sitt innehåll; äldre flikgrupper fungerar',
    async run(t) {
      for (const vp of ['mx360', 'mx390', 'mx1366', 'mx1920']) {
        const s = await open(t, vp, 'admin', 'pg-obj-detail', { propId: 'OBJ-001' });
        const r = await s.eval(() => {
          const bar = document.getElementById('prop-tabs');
          const br = bar.getBoundingClientRect();
          const tabs = [...bar.querySelectorAll('.ft')].map((b) => { const x = b.getBoundingClientRect(); return { k: b.dataset.tab, l: x.left, r: x.right, t: x.top, b: x.bottom, w: x.width, clip: b.scrollWidth > b.clientWidth + 1 }; });
          return { vw: document.documentElement.clientWidth, barL: br.left, barR: br.right, scroll: bar.scrollWidth - bar.clientWidth, tabs };
        });
        t.assert(r.tabs.length === 8, vp + ': åtta flikgrupper (' + r.tabs.length + ')');
        t.assert(r.scroll <= 1, vp + ': flikraden rullar inte i sidled (dolda flikar) ' + r.scroll);
        const out = r.tabs.filter((x) => x.l < r.barL - 1 || x.r > r.barR + 1 || x.r > r.vw || x.w < 30 || x.clip);
        t.assert(out.length === 0, vp + ': varje flik syns helt inom flikraden ' + JSON.stringify(out));
        const ov = await s.eval(overflowProbe);
        t.assert(ov.page <= 1 && ov.wide.length === 0, vp + ': inget sidöverflöd ' + JSON.stringify(ov));
        if (vp !== 'mx1366' && vp !== 'mx390') continue;
        // Klick på varje flik: aktiv markering + rätt paneler synliga med innehåll.
        const groups = { overview: ['overview'], contact: ['contact', 'ansvariga'], tech: ['tech'], service: ['service'], ao: ['ao', 'recurring'], rondering: ['rondering'], objects: ['objects'], images: ['images', 'notes'] };
        for (const [g, panels] of Object.entries(groups)) {
          await s.page.locator('#prop-tabs .ft[data-tab="' + g + '"]').click();
          await s.settle(200);
          const st = await s.eval(([g, panels]) => {
            const on = [...document.querySelectorAll('#prop-tabs .ft.on')].map((b) => b.dataset.tab);
            const sel = document.querySelector('#prop-tabs .ft[data-tab="' + g + '"]').getAttribute('aria-selected');
            const all = ['overview','contact','ansvariga','tech','service','ao','recurring','rondering','objects','images','notes'];
            const shown = all.filter((p) => { const e = document.getElementById('prop-tab-' + p); return e && e.style.display !== 'none' && e.offsetParent; });
            const empty = panels.filter((p) => !(document.getElementById('prop-tab-' + p).innerText.trim().length > 0));
            const onBg = getComputedStyle(document.querySelector('#prop-tabs .ft.on')).backgroundColor;
            const offBg = getComputedStyle(document.querySelector('#prop-tabs .ft:not(.on)')).backgroundColor;
            return { on, sel, shown, empty, onBg, offBg };
          }, [g, panels]);
          t.assert(st.on.length === 1 && st.on[0] === g && st.sel === 'true', vp + ' ' + g + ': fliken är markerad aktiv ' + JSON.stringify(st.on));
          t.assert(JSON.stringify(st.shown) === JSON.stringify(panels), vp + ' ' + g + ': visar ' + panels.join('+') + ' (visades ' + st.shown.join('+') + ')');
          t.assert(st.empty.length === 0, vp + ' ' + g + ': panelerna har innehåll ' + st.empty.join(','));
          t.assert(st.onBg !== st.offBg, vp + ': aktiv flik skiljer sig visuellt från övriga');
        }
        for (const [old, g] of [['ansvariga', 'contact'], ['recurring', 'ao'], ['notes', 'images']]) {
          await s.eval((x) => PropertyDetailPage.switchTab(x), old);
          const on = await s.eval(() => document.querySelector('#prop-tabs .ft.on').dataset.tab);
          const vis = await s.eval((x) => document.getElementById('prop-tab-' + x).style.display !== 'none', old);
          t.assert(on === g && vis, vp + ': äldre fliknyckel ' + old + ' öppnar gruppen ' + g);
        }
      }
    },
  },
  {
    id: 'MISC-PROP-02', module: 'Fastighetsregister', name: 'Fastighetskortet: ingen markup/attribut som text i någon flik (sökfältets placeholder var trasig), placeholder utan "<"; sökning tappar inte fokus',
    async run(t) {
      for (const vp of ['mx390', 'mx1366']) {
        const s = await open(t, vp, 'admin', 'pg-obj-detail', { propId: 'OBJ-001' });
        // Serviceintervall finns inte i demodatan för OBJ-001 — skapa två via tjänsten så att filterraden med sökfält visas.
        await s.eval(() => { const p = getObj('OBJ-001'); p.serviceIntervals = [{ id: 'SI-E2E-1', title: 'Filterbyte ventilation', category: 'ventilation', intervalType: 'biannual', nextDue: '2026-12-15', active: true, history: [] }, { id: 'SI-E2E-2', title: 'Hisskontroll', category: 'hiss', intervalType: 'annual', nextDue: '2027-03-01', active: true, history: [] }]; PropertyDetailPage.render({ propId: 'OBJ-001' }); });
        const hits = [];
        for (const g of ['overview', 'contact', 'tech', 'service', 'ao', 'rondering', 'objects', 'images']) {
          await s.eval((x) => PropertyDetailPage.switchTab(x), g);
          await s.settle(250);
          const h = await s.eval(leakProbe, '#pg-obj-detail-content');
          h.forEach((x) => hits.push(g + ': ' + x));
        }
        t.assert(hits.length === 0, vp + ': markup/attribut visas som text: ' + JSON.stringify(hits));
        await s.eval(() => PropertyDetailPage.switchTab('service'));
        const ph = await s.eval(() => { const i = document.getElementById('prop-si-search'); return i ? { ph: i.getAttribute('placeholder'), icon: !!i.closest('.mx-isearch').querySelector('svg') } : null; });
        t.assert(ph && ph.ph === 'Sök…' && ph.icon, vp + ': sökfältet har ren platshållartext och ikonen bredvid ' + JSON.stringify(ph));
        await s.page.locator('#prop-si-search').click();
        await s.page.keyboard.type('Hiss', { delay: 30 });
        await s.settle(200);
        const f = await s.eval(() => ({ id: document.activeElement && document.activeElement.id, v: document.getElementById('prop-si-search').value, n: document.querySelectorAll('#si-list-body .si-card').length }));
        t.assert(f.id === 'prop-si-search' && f.v === 'Hiss', vp + ': fokus och text kvar efter flera tecken ' + JSON.stringify(f));
        t.assert(f.n === 1, vp + ': sökningen filtrerar (1 träff, fick ' + f.n + ')');
      }
    },
  },
  {
    id: 'MISC-PROP-03', module: 'Fastighetsregister', name: 'Fastighetskortet: portkod/nyckelinfo visas för admin (objects_sensitive), aldrig för arbetsledare utan behörighet; fältarbetare nekas sidan',
    async run(t) {
      const a = await open(t, 'mx1366', 'admin', 'pg-obj-detail', { propId: 'OBJ-001' });
      await a.eval(() => PropertyDetailPage._saveSensitiveFields({ propertyId: 'OBJ-001', accessCode: '4711', keyInformation: 'Nyckel i tub E2E' }));
      await a.settle(400);
      await a.eval(() => PropertyDetailPage.switchTab('contact'));
      await a.page.waitForFunction(() => /4711/.test((document.getElementById('sensitive-prop-OBJ-001') || {}).innerText || ''), null, { timeout: 5000 }).catch(() => {});
      const adm = await a.eval(() => (document.getElementById('sensitive-prop-OBJ-001') || {}).innerText || '');
      t.assert(/4711/.test(adm) && /Nyckel i tub E2E/.test(adm), 'admin ser portkod och nyckelinformation i Åtkomst & nycklar (' + adm.slice(0, 60) + ')');
      const c = await open(t, 'mx390', 'chef', 'pg-obj-detail', { propId: 'OBJ-001' });
      await c.eval(() => PropertyDetailPage.switchTab('contact'));
      await c.settle(500);
      const ch = await c.eval(() => ({ txt: document.getElementById('prop-tab-contact').innerText, html: document.getElementById('pg-obj-detail-content').innerHTML, sens: !!document.querySelector('[id^="sensitive-prop-"]') }));
      const calls = c.requests.filter((r) => /get-sensitive-fields/.test(r.url)).length;
      t.assert(/saknar behörighet/i.test(ch.txt), 'arbetsledaren får beskedet att behörighet saknas');
      t.assert(!/4711|Nyckel i tub E2E/.test(ch.html) && !ch.sens && calls === 0, 'arbetsledaren får ingen portkod i sidan och inget anrop till get-sensitive-fields (' + calls + ')');
      const f = await open(t, 'mx390', 'falt');
      await f.eval(() => Router.showPage('pg-obj-detail', { propId: 'OBJ-001' }));
      await f.settle(400);
      const fp = await f.eval(() => ({ cur: Router.currentPage, html: (document.getElementById('pg-obj-detail-content') || {}).innerHTML || '' }));
      t.assert(fp.cur !== 'pg-obj-detail' && !/4711/.test(fp.html), 'fältarbetaren kommer inte in på fastighetskortet (' + fp.cur + ')');
    },
  },
  {
    id: 'MISC-HEAD-01', module: 'Designstandard', name: 'Detaljhuvuden (F-10) på 390: tillbaka + rubrik på en rad, låg höjd, primär åtgärd synlig, övriga i ⋮-menyn som öppnas — Fastighetskort, Objekt, Kundkort, Projektkort',
    async run(t) {
      const pages = [
        ['pg-obj-detail', { propId: 'OBJ-001' }, /Redigera/],
        ['pg-propobj-detail', { objId: 'POBJ-E2E-1' }, /Redigera/],
        ['pg-crm-detail', { customerId: 'K-001' }, /Redigera/],
        ['pg-project-detail', { projectId: 'PRJ-001' }, /Redigera/],
      ];
      for (const vp of ['mx390', 'mx1366']) {
        const s = await open(t, vp, 'admin');
        for (const [pg, prm, menuRe] of pages) {
          await s.go(pg, prm);
          await s.settle(300);
          const h = await s.eval(headProbe, pg);
          t.note(vp + ' ' + pg + ' ' + JSON.stringify(h && { h: h.h }));
          t.assert(h, vp + ' ' + pg + ': sidan har det gemensamma detaljhuvudet');
          t.assert(h.back && h.title && Math.abs(h.back.top + h.back.h / 2 - (h.title.top + h.title.h / 2)) < 14, vp + ' ' + pg + ': tillbaka och rubrik på samma rad');
          t.assert(h.h <= (vp === 'mx390' ? 132 : 96), vp + ' ' + pg + ': huvudet är kompakt (' + h.h + ' px)');
          t.assert(h.primary && h.primary.right <= h.vw && h.primary.bottom <= h.vh, vp + ' ' + pg + ': primär åtgärd synlig utan att rulla');
          if (vp === 'mx390') {
            t.assert(h.more, vp + ' ' + pg + ': ⋮-knappen finns');
            await s.page.locator('#' + pg + ' .mx-dh-more').click();
            await s.settle(150);
            const items = await s.eval((p) => [...document.querySelectorAll('#' + p + ' .mx-dh .ao-overflow-menu.open .ao-overflow-menu-item')].filter((b) => b.offsetParent).map((b) => b.textContent.trim()), pg);
            t.assert(items.some((x) => menuRe.test(x)), vp + ' ' + pg + ': menyn öppnas och innehåller ' + menuRe + ' ' + JSON.stringify(items));
            await s.page.keyboard.press('Escape');
          }
        }
      }
    },
  },
  {
    id: 'MISC-CAL-01', module: 'Kalender', name: 'Kalender veckovy (F-08): på 360/390 en läsbar dagslista (7 dagar, titlar inte bokstav för bokstav, vyväljaren på en rad, långtryck flyttar AO); på dator oförändrat rutnät',
    async run(t) {
      for (const vp of ['mx360', 'mx390']) {
        const s = await open(t, vp, 'admin', 'pg-calendar');
        await s.eval(() => CalendarPage.setView('vecka'));
        await s.settle(300);
        const r = await s.eval(() => {
          const vis = (e) => e && e.offsetParent && e.getBoundingClientRect().height > 0;
          const grid = document.querySelector('#pg-calendar .cal-wk-grid');
          const days = [...document.querySelectorAll('#pg-calendar .cal-wk-list .cal-wl-day')].filter(vis);
          const titles = [...document.querySelectorAll('#pg-calendar .cal-wk-list .cal-ag-title')].filter(vis).map((e) => {
            const b = e.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(e).lineHeight) || 16;
            return { t: e.textContent.trim().slice(0, 30), w: Math.round(b.width), lines: Math.round(b.height / lh) };
          });
          const tabs = [...document.querySelectorAll('#pg-calendar .cal-view-tabs .ft')].map((b) => Math.round(b.getBoundingClientRect().top));
          return { gridShown: vis(grid), days: days.length, titles, tabsTops: [...new Set(tabs)], rows: document.querySelectorAll('#pg-calendar .cal-wk-list [data-aoid]').length };
        });
        const ov = await s.eval(overflowProbe);
        t.note(vp + ' ' + JSON.stringify({ days: r.days, n: r.titles.length, minW: Math.min(...r.titles.map((x) => x.w)) }));
        t.assert(!r.gridShown && r.days === 7, vp + ': sju dagar som lista i stället för sju smala kolumner');
        t.assert(r.titles.length >= 2, vp + ': veckan har händelser i testdatan (' + r.titles.length + ')');
        t.assert(r.titles.every((x) => x.w >= 150 && x.lines <= 3), vp + ': titlarna är läsbara (minst 150 px breda, högst 3 rader) ' + JSON.stringify(r.titles.filter((x) => x.w < 150 || x.lines > 3)));
        t.assert(r.tabsTops.length === 1, vp + ': Dag/Vecka/Månad/Agenda på en rad');
        t.assert(ov.page <= 1 && ov.wide.length === 0, vp + ': inget sidöverflöd ' + JSON.stringify(ov));
        t.assert(r.rows > 0, vp + ': AO-rader går att långtrycka (data-aoid)');
        // Långtryck på första AO-raden öppnar "Flytta till…"
        const box = await s.page.locator('#pg-calendar .cal-wk-list [data-aoid]').first().boundingBox();
        await s.page.mouse.move(box.x + 20, box.y + 10);
        await s.page.mouse.down();
        await s.page.waitForTimeout(650);
        await s.page.mouse.up();
        const modal = await s.eval(() => !!document.querySelector('.modal-overlay.open #touch-move-date'));
        t.assert(modal, vp + ': långtryck öppnar Flytta till-dialogen');
        await s.eval(() => Modal.close());
      }
      const d = await open(t, 'mx1366', 'admin', 'pg-calendar');
      await d.eval(() => CalendarPage.setView('vecka'));
      await d.settle(300);
      const dr = await d.eval(() => ({ grid: !!document.querySelector('#pg-calendar .cal-wk-grid').offsetParent, list: !!(document.querySelector('#pg-calendar .cal-wk-list') || {}).offsetParent, cols: document.querySelectorAll('#pg-calendar .cal-wk-col').length }));
      t.assert(dr.grid && !dr.list && dr.cols === 7, 'dator: veckorutnätet med sju kolumner visas, listan inte ' + JSON.stringify(dr));
    },
  },
  {
    id: 'MISC-RON-01', module: 'Rondering', name: 'Rondering (F-09): stegetiketter, statusrad, punktstatus (Godkänd/Anmärkning/Ej aktuell) och "Klar" har kontrast ≥ 4,5:1 beräknat från faktiska färger; stegetiketterna kapas inte',
    async run(t) {
      const fails = [];
      const check = (where, list, min) => list.forEach((x) => { if (x.ratio < (x.large ? 3 : min)) fails.push(where + ' "' + x.t + '" ' + x.ratio + ':1'); });
      for (const vp of ['mx390', 'mx1366']) {
        const s = await open(t, vp, 'admin', 'pg-rondering-wizard', { reset: true });
        const w1 = await s.eval(contrastProbe, '#pg-rondering-wizard .rw-step-l');
        t.assert(w1.length === 4, vp + ': fyra stegetiketter (' + w1.length + ')');
        check(vp + ' guide steg 1', w1, 4.5);
        const clip = await s.eval(() => [...document.querySelectorAll('#pg-rondering-wizard .rw-step-l')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
        t.assert(clip.length === 0, vp + ': stegetiketterna kapas inte ' + JSON.stringify(clip));
        // Gå till steg 2 så att ett klart steg (grönt) också mäts.
        await s.page.fill('#wiz-name', 'Kontrast E2E');
        await s.pickCustom('wiz-cu', 'K-001');
        await s.page.locator('.page.active button', { hasText: 'Nästa' }).click();
        await s.settle(300);
        check(vp + ' guide steg 2', await s.eval(contrastProbe, '#pg-rondering-wizard .rw-step-l'), 4.5);
        await s.go('pg-rondering-utfor', { passId: 'PASS-001' });
        await s.settle(300);
        const st = await s.eval(contrastProbe, '#pg-rondering-utfor .ru-st, #pg-rondering-utfor .ru-staff, #pg-rondering-utfor .ru-pt-st, #pg-rondering-utfor .roncat-head-cnt, #pg-rondering-utfor .ronpt-name, #pg-rondering-utfor .ronpt-desc');
        const texts = st.map((x) => x.t).join('|');
        t.assert(/godkända/.test(texts) && /Godkänd/.test(texts) && /Anmärkning/.test(texts) && /Ej aktuell/.test(texts) && /Klar/.test(texts), vp + ': mätningen omfattar statusrad, Godkänd, Anmärkning, Ej aktuell och Klar');
        check(vp + ' utför', st, 4.5);
        await s.go('pg-rondering');
        check(vp + ' lista', await s.eval(contrastProbe, '#pg-rondering .item-title, #pg-rondering .item-sub, #pg-rondering .ft, #pg-rondering .bdg'), 4.5);
      }
      t.assert(fails.length === 0, 'text under 4,5:1: ' + fails.join(' ; '));
    },
  },
  {
    id: 'MISC-ICON-01', module: 'Designstandard', name: 'Ikoner på samma rad som texten (F-02) i blockets sidor: Projekt, Projektkort, Kontrakt, Importera, Importlogg, Exportcenter, Fastighetskort, Objekt, Kundkort, Kalender, Rondering',
    async run(t) {
      const views = [
        ['pg-projects', {}], ['pg-project-detail', { projectId: 'PRJ-001' }], ['pg-contracts', {}], ['pg-import-wizard', { type: 'customer' }],
        ['pg-import-log', {}], ['pg-export-center', {}], ['pg-obj-detail', { propId: 'OBJ-001' }], ['pg-propobj-detail', { objId: 'POBJ-E2E-1' }],
        ['pg-crm-detail', { customerId: 'K-001' }], ['pg-calendar', {}], ['pg-rondering', {}], ['pg-rondering-utfor', { passId: 'PASS-001' }], ['pg-rondering-wizard', { reset: true }],
      ];
      const hits = [];
      for (const vp of ['mx390', 'mx1366']) {
        const s = await open(t, vp, 'admin');
        for (const [pg, prm] of views) {
          await s.go(pg, prm);
          await s.settle(250);
          (await s.eval(iconLineProbe, '#' + pg)).forEach((h) => hits.push(vp + ' ' + pg + ' → ' + h));
        }
      }
      t.assert(hits.length === 0, 'ikon på egen rad: ' + hits.join(' ; '));
    },
  },
  {
    id: 'MISC-DATA-01', module: 'Projekt', name: 'Projekt med 120 projekt: statuschips filtrerar och räknar rätt, sök behåller fokus och visar "Visar X av Y", Rensa filter; ingen sidscroll 360–1920 och rader högst ~1320 px breda på 1920',
    async run(t) {
      t.__seedFn = seedRealistic;
      for (const vp of ['mx360', 'mx390', 'mx1366', 'mx1920']) {
        const s = await open(t, vp, 'admin', 'pg-projects');
        const r = await s.eval(() => ({ rows: document.querySelectorAll('#prj-results .mx-li').length, count: document.querySelector('#prj-results .mx-count').innerText, w: Math.round(Math.max(...[...document.querySelectorAll('#prj-results .mx-li')].map((e) => e.getBoundingClientRect().width))) }));
        const ov = await s.eval(overflowProbe);
        t.note(vp + ' ' + JSON.stringify(r));
        t.assert(r.rows >= 100 && new RegExp('Visar ' + r.rows + ' av ' + r.rows).test(r.count), vp + ': alla aktiva projekt listas och antalet visas (' + r.count + ')');
        t.assert(ov.page <= 1 && ov.wide.length === 0, vp + ': inget sidöverflöd ' + JSON.stringify(ov));
        if (vp === 'mx1920') t.assert(r.w <= 1330, '1920: raderna är högst ~1320 px breda (' + r.w + ')');
        if (vp !== 'mx390' && vp !== 'mx1366') continue;
        // Statuschip "Pågående": bara pågående rader, antal = chippets siffra.
        const chip = s.page.locator('#prj-chips .chip', { hasText: 'Pågående' });
        const n = +(await chip.locator('.chip-n').innerText());
        await chip.click();
        await s.settle(250);
        const f = await s.eval(() => ({ rows: [...document.querySelectorAll('#prj-results .mx-li')].map((e) => e.querySelector('.bdg.st').innerText.trim()), on: [...document.querySelectorAll('#prj-chips .chip.on')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()), clear: !!document.querySelector('#prj-clear button') }));
        t.assert(f.rows.length === n && f.rows.every((x) => x === 'Pågående'), vp + ': chippet Pågående visar ' + n + ' pågående projekt (fick ' + f.rows.length + ')');
        t.assert(f.on.length === 1 && /Pågående/.test(f.on[0]) && f.clear, vp + ': chippet är markerat och Rensa filter visas');
        // Sök: fokus kvar, färre träffar, antal uppdateras.
        await s.page.locator('#prj-search').click();
        await s.page.keyboard.type('Stambyte', { delay: 20 });
        await s.settle(400);
        const q = await s.eval(() => ({ focus: document.activeElement && document.activeElement.id, v: document.getElementById('prj-search').value, rows: [...document.querySelectorAll('#prj-results .mx-li-title')].map((e) => e.innerText), count: document.querySelector('#prj-results .mx-count').innerText }));
        t.assert(q.focus === 'prj-search' && q.v === 'Stambyte', vp + ': sökfältet behåller fokus och text');
        t.assert(q.rows.length > 0 && q.rows.every((x) => /Stambyte/.test(x)) && new RegExp('Visar ' + q.rows.length + ' av').test(q.count), vp + ': sökningen filtrerar och antalet uppdateras (' + q.count + ')');
        await s.page.locator('#prj-clear button').click();
        await s.settle(250);
        const c = await s.eval(() => ({ rows: document.querySelectorAll('#prj-results .mx-li').length, v: document.getElementById('prj-search').value }));
        t.assert(c.rows === r.rows && c.v === '', vp + ': Rensa filter återställer listan och sökfältet');
      }
    },
  },
  {
    id: 'MISC-DATA-02', module: 'Kundregister', name: 'Kontrakt (114 avtal) och Importlogg (15 importer): tabell på dator, kort per rad på 360/390, statuschip filtrerar med rätt antal, ingen sidscroll, begränsad bredd på 1920',
    async run(t) {
      t.__seedFn = seedRealistic;
      for (const vp of ['mx360', 'mx390', 'mx1366', 'mx1920']) {
        const s = await open(t, vp, 'admin', 'pg-contracts');
        const r = await s.eval(() => {
          const rows = [...document.querySelectorAll('#con-results .mx-ctr')];
          const head = document.querySelector('#con-results thead');
          return { rows: rows.length, rowDisplay: rows[0] && getComputedStyle(rows[0]).display, headShown: !!(head && head.offsetParent && head.getBoundingClientRect().height > 0), w: Math.round(document.querySelector('#con-results .dt-wrap').getBoundingClientRect().width), count: document.querySelector('#con-results .mx-count').innerText };
        });
        const ov = await s.eval(overflowProbe);
        t.note(vp + ' ' + JSON.stringify(r));
        t.assert(r.rows === 114 && /Visar 114 av 114/.test(r.count), vp + ': alla 114 avtal listas (' + r.count + ')');
        t.assert(ov.page <= 1 && ov.wide.length === 0, vp + ': inget sidöverflöd ' + JSON.stringify(ov));
        if (vp === 'mx360' || vp === 'mx390') t.assert(!r.headShown && r.rowDisplay === 'grid', vp + ': kort per rad (ingen tabellrubrik)');
        else t.assert(r.headShown && r.rowDisplay === 'table-row', vp + ': tabell med rubrikrad');
        if (vp === 'mx1920') t.assert(r.w <= 1330, '1920: tabellen är begränsad (' + r.w + ' px)');
        if (vp === 'mx390' || vp === 'mx1366') {
          const chip = s.page.locator('#con-chips .chip', { hasText: 'Aktiv' });
          const n = +(await chip.locator('.chip-n').innerText());
          await chip.click();
          await s.settle(250);
          const st = await s.eval(() => [...document.querySelectorAll('#con-results .mx-ctr .bdg.st')].map((b) => b.innerText.trim()));
          t.assert(st.length === n && st.every((x) => x === 'Aktiv'), vp + ': chippet Aktiv visar ' + n + ' aktiva avtal (fick ' + st.length + ')');
          await s.page.locator('#con-search').click();
          await s.page.keyboard.type('Serviceavtal', { delay: 15 });
          await s.settle(400);
          const q = await s.eval(() => ({ focus: document.activeElement && document.activeElement.id, n: document.querySelectorAll('#con-results .mx-ctr').length }));
          t.assert(q.focus === 'con-search' && q.n > 0 && q.n < n, vp + ': sök i kombination med status behåller fokus och filtrerar (' + q.n + ')');
        }
        await s.go('pg-import-log');
        const l = await s.eval(() => ({ rows: document.querySelectorAll('#pg-import-log .imp-log-row').length, w: Math.round(document.querySelector('#pg-import-log .mx-page').getBoundingClientRect().width), undo: document.querySelectorAll('#pg-import-log .imp-log-row .btn.bd').length }));
        const ov2 = await s.eval(overflowProbe);
        t.assert(l.rows === 15 && l.undo > 0, vp + ': importloggen listar 15 importer med Ångra');
        t.assert(ov2.page <= 1 && ov2.wide.length === 0, vp + ': importlogg utan sidöverflöd ' + JSON.stringify(ov2));
        if (vp === 'mx1920') t.assert(l.w <= 1330, '1920: importloggen är begränsad (' + l.w + ' px)');
        await s.go('pg-export-center', { type: 'customer' });
        const ov3 = await s.eval(overflowProbe);
        t.assert(ov3.page <= 1 && ov3.wide.length === 0, vp + ': exportcenter utan sidöverflöd ' + JSON.stringify(ov3));
      }
    },
  },
  {
    id: 'MISC-TASK-01', module: 'Projekt', name: 'Projektkort på 360/390 (uppgifter): status och ekonomi syns, AO under projektet, Ladda upp dokument nås och öppnar dialogen; inga åtgärder avklippta',
    async run(t) {
      t.__seedFn = seedRealistic;
      for (const vp of ['mx360', 'mx390']) {
        const s = await open(t, vp, 'admin', 'pg-project-detail', { projectId: 'PRJ-001' });
        const h = await s.eval(() => ({ st: (document.querySelector('#pg-project-detail .mx-dh .bdg.st') || {}).innerText }));
        t.assert(/Pågående/.test(h.st || ''), vp + ': status syns i huvudet (' + h.st + ')');
        await s.page.locator('#pd-tabs .ft', { hasText: 'Ekonomi' }).click();
        await s.settle(250);
        const eco = await s.eval(() => document.getElementById('pd-tab-economy').innerText);
        t.assert(/kr/.test(eco), vp + ': Ekonomi-fliken visar belopp');
        await s.page.locator('#pd-tabs .ft', { hasText: 'Arbetsorder' }).click();
        await s.settle(250);
        const ao = await s.eval(() => document.getElementById('pd-tab-ao').innerText);
        t.assert(/AO-001/.test(ao) && /AO-002/.test(ao), vp + ': arbetsordrarna under projektet syns');
        await s.page.locator('#pd-tabs .ft', { hasText: 'Dokument' }).click();
        await s.settle(250);
        const b = await s.eval(() => { const x = [...document.querySelectorAll('#pd-tab-documents button')].find((e) => /Ladda upp dokument/.test(e.textContent)); const r = x.getBoundingClientRect(); return { right: r.right, w: r.width, vw: document.documentElement.clientWidth, clip: x.scrollWidth > x.clientWidth + 1 }; });
        t.assert(b.w > 0 && b.right <= b.vw && !b.clip, vp + ': Ladda upp dokument syns och är inte avklippt');
        await s.page.locator('#pd-tab-documents button', { hasText: 'Ladda upp dokument' }).click();
        await s.page.waitForSelector('.modal-overlay.open #doc-file', { timeout: 4000 });
        t.assert(await s.eval(() => !!document.querySelector('.modal-overlay.open #doc-file')), vp + ': uppladdningsdialogen öppnas med filfält');
        await s.eval(() => Modal.close());
        const tabs = await s.eval(() => { const bar = document.getElementById('pd-tabs'); return { scroll: bar.scrollWidth - bar.clientWidth, out: [...bar.querySelectorAll('.ft')].filter((b) => b.getBoundingClientRect().right > document.documentElement.clientWidth || b.scrollWidth > b.clientWidth + 1).length }; });
        t.assert(tabs.scroll <= 1 && tabs.out === 0, vp + ': alla projektflikar syns');
        const ov = await s.eval(overflowProbe);
        t.assert(ov.page <= 1 && ov.wide.length === 0, vp + ': inget sidöverflöd ' + JSON.stringify(ov));
      }
    },
  },
  {
    id: 'MISC-TASK-02', module: 'Kalender', name: 'Kalender på 360/390 med nio jobb samma dag: dagens och veckans jobb syns läsbart, ett jobb öppnas, Skapa AO öppnar formuläret',
    async run(t) {
      t.__seedFn = seedRealistic;
      for (const vp of ['mx360', 'mx390']) {
        const s = await open(t, vp, 'admin', 'pg-calendar');
        await s.eval(() => CalendarPage.setView('vecka'));
        await s.settle(300);
        const r = await s.eval(() => {
          const day = document.querySelector('#pg-calendar .cal-wl-day.is-today');
          const rows = [...day.querySelectorAll('.cal-ag-row')];
          const titles = rows.map((x) => { const e = x.querySelector('.cal-ag-title'); const b = e.getBoundingClientRect(); return { w: b.width, h: b.height, lh: parseFloat(getComputedStyle(e).lineHeight) || 17 }; });
          return { n: rows.length, minW: Math.min(...titles.map((x) => x.w)), maxLines: Math.max(...titles.map((x) => Math.round(x.h / x.lh))) };
        });
        t.assert(r.n >= 9, vp + ': idag visas alla jobb (' + r.n + ')');
        t.assert(r.minW >= 150 && r.maxLines <= 4, vp + ': även långa titlar är läsbara (' + Math.round(r.minW) + ' px, ' + r.maxLines + ' rader)');
        await s.eval(() => CalendarPage.setView('dag'));
        await s.settle(300);
        const dag = await s.eval(() => ({ rows: [...document.querySelectorAll('#pg-calendar .cal-day-list .cal-ag-row')].filter((e) => e.offsetParent).length, grid: !!(document.querySelector('#pg-calendar .cal-day-wrap') || {}).offsetParent,
          minW: Math.min(...[...document.querySelectorAll('#pg-calendar .cal-day-list .cal-ag-title')].map((e) => e.getBoundingClientRect().width)) }));
        t.assert(dag.rows >= 9 && !dag.grid && dag.minW >= 150, vp + ': dagvyn visar dagens jobb som läsbar lista (' + JSON.stringify(dag) + ')');
        const ov = await s.eval(overflowProbe);
        t.assert(ov.page <= 1 && ov.wide.length === 0, vp + ': dagvyn utan sidöverflöd ' + JSON.stringify(ov));
        await s.eval(() => CalendarPage.setView('vecka'));
        await s.settle(300);
        const btn = await s.eval(() => { const b = [...document.querySelectorAll('#pg-calendar .cal-toolbar-right .btn')].find((x) => /Skapa AO/.test(x.textContent)); const r = b.getBoundingClientRect(); return { right: r.right, vw: document.documentElement.clientWidth, h: r.height }; });
        t.assert(btn.right <= btn.vw && btn.h >= 38, vp + ': Skapa AO syns med tryckvänlig höjd');
        await s.page.locator('#pg-calendar .cal-toolbar-right .btn', { hasText: 'Skapa AO' }).click();
        await s.settle(500);
        t.assert(await s.modalOpen(), vp + ': Skapa AO öppnar arbetsorderformuläret');
        await s.eval(() => Modal.close());
        await s.settle(200);
        await s.page.locator('#pg-calendar .cal-wl-day.is-today .cal-ag-row').first().click();
        await s.settle(400);
        t.assert(await s.eval(() => Router.currentPage === 'pg-ao-detail'), vp + ': tryck på ett jobb öppnar arbetsordern');
      }
    },
  },
  {
    id: 'MISC-TASK-03', module: 'Fastighetsregister', name: 'Fastighetskort på 360/390 (uppgifter): adress, portkod (admin), Ny AO, Lägg till objekt och serviceintervall nås utan avklippta knappar; långt namn kapas inte bort',
    async run(t) {
      t.__seedFn = seedRealistic;
      for (const vp of ['mx360', 'mx390']) {
        const s = await open(t, vp, 'admin', 'pg-obj-detail', { propId: 'OBJ-001' });
        await s.eval(() => PropertyDetailPage._saveSensitiveFields({ propertyId: 'OBJ-001', accessCode: '2580', keyInformation: 'Nyckelskåp vid entré' }));
        const addr = await s.eval(() => (document.querySelector('#pg-obj-detail .mx-pf-addr') || {}).innerText || '');
        t.assert(/Solvägen/.test(addr), vp + ': adressen syns i faktaraden (' + addr + ')');
        const visBtn = (sel, re) => s.eval(([q, src]) => { const b = [...document.querySelectorAll(q)].find((x) => x.offsetParent && new RegExp(src).test(x.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return { right: r.right, left: r.left, vw: document.documentElement.clientWidth, clip: b.scrollWidth > b.clientWidth + 1, h: r.height }; }, [sel, re]);
        const ny = await visBtn('#pg-obj-detail .mx-dh button', 'Ny AO');
        t.assert(ny && ny.right <= ny.vw && !ny.clip && ny.h >= 38, vp + ': Ny AO syns i huvudet');
        await s.page.locator('#prop-tabs .ft[data-tab="contact"]').click();
        await s.page.waitForFunction(() => /2580/.test((document.getElementById('sensitive-prop-OBJ-001') || {}).innerText || ''), null, { timeout: 5000 }).catch(() => {});
        t.assert(await s.eval(() => /2580/.test(document.getElementById('sensitive-prop-OBJ-001').innerText)), vp + ': portkoden visas för admin under Kontakter & åtkomst');
        await s.page.locator('#prop-tabs .ft[data-tab="objects"]').click();
        const ob = await visBtn('#prop-tab-objects button', 'Lägg till objekt');
        t.assert(ob && ob.right <= ob.vw && !ob.clip, vp + ': Lägg till objekt syns');
        await s.page.locator('#prop-tab-objects button', { hasText: 'Lägg till objekt' }).first().click();
        await s.settle(300);
        t.assert(await s.modalOpen(), vp + ': objektformuläret öppnas');
        await s.eval(() => Modal.close());
        await s.page.locator('#prop-tabs .ft[data-tab="service"]').click();
        const si = await visBtn('#prop-tab-service button', 'Lägg till');
        t.assert(si && si.right <= si.vw && !si.clip, vp + ': Lägg till serviceintervall syns');
        await s.page.locator('#prop-tab-service button', { hasText: 'Lägg till' }).first().click();
        await s.settle(300);
        t.assert(await s.modalOpen(), vp + ': serviceintervallformuläret öppnas');
        await s.eval(() => Modal.close());
        await s.page.locator('#pg-obj-detail .mx-dh .mx-dh-primary').click();
        await s.settle(700);
        t.assert(await s.modalOpen(), vp + ': Ny AO öppnar arbetsorderformuläret');
        await s.eval(() => Modal.close());
        // Långt namn: rubriken på en rad med ellips, title-attribut saknas inte i DOM-texten och sidan svämmar inte över.
        await s.go('pg-obj-detail', { propId: 'OBJ-LONG' });
        const lg = await s.eval(() => { const e = document.querySelector('#pg-obj-detail .mx-dh-title'); const h = document.querySelector('#pg-obj-detail .mx-dh').getBoundingClientRect(); return { text: e.textContent, w: e.getBoundingClientRect().width, right: e.getBoundingClientRect().right, hr: h.right, hh: h.height }; });
        const ov = await s.eval(overflowProbe);
        t.assert(/Kungsholmens Strand/.test(lg.text) && lg.right <= lg.hr && lg.hh <= 156, vp + ': långt namn ryms i huvudet (högst två rader) (' + Math.round(lg.hh) + ' px)');
        t.assert(ov.page <= 1 && ov.wide.length === 0, vp + ': inget sidöverflöd med långt namn ' + JSON.stringify(ov));
      }
    },
  },
  {
    /* QA 2026-11-26 (tillägg 2, mobilflöden efter uppgift): från kundkortet ska
       man kunna ringa och maila kontakten med ett tryck. Simulerad server. */
    id: 'MISC-CUS-REACH-01', module: 'Kundregister', kind: 'ui',
    name: 'Kundkortet på mobil (390 px): telefon och e-post för kunden och kontaktpersoner är tel:/mailto:-länkar, minst 40 px höga; text escapas',
    async run(t) {
      const cus = t.fake.get('customers');
      cus[0].phone = '070-123 45 67'; cus[0].email = 'kund@example.test';
      cus[0].contacts = [{ id: 'CC-1', name: 'Kontakt <b>Test</b>', role: 'Ordförande', phone: '08-765 43 21', email: 'kontakt@example.test', primary: true }];
      t.fake.set('customers', cus);
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('admin');
      await s.go('pg-crm-detail', { customerId: cus[0].id }); await s.settle(500);
      const r = await s.eval(() => [...document.querySelectorAll('.page.active a.cu-reach')].filter((a) => a.offsetParent).map((a) => ({ href: a.getAttribute('href'), h: Math.round(a.getBoundingClientRect().height) })));
      const hrefs = r.map((x) => x.href);
      t.assert(hrefs.includes('tel:0701234567'), 'kundens telefon är tel:-länk (' + hrefs.join(', ') + ')');
      t.assert(hrefs.includes('mailto:kund@example.test'), 'kundens e-post är mailto:-länk');
      t.assert(hrefs.includes('tel:087654321') && hrefs.includes('mailto:kontakt@example.test'), 'kontaktpersonens telefon och e-post är länkar (' + hrefs.join(', ') + ')');
      t.assert(r.every((x) => x.h >= 40), 'tryckytor ≥ 40 px (' + r.map((x) => x.h).join(',') + ')');
      const txt = await s.eval(() => document.querySelector('.page.active').innerText);
      t.assert(txt.includes('Kontakt <b>Test</b>'), 'kontaktnamnet visas som text, inte markup');
      t.assert((await s.layoutIssues()).length === 0, 'inget klipps på 390 px');
    },
  },
];
module.exports = tests;
module.exports.seedMisc = seedMisc;
module.exports.seedRealistic = seedRealistic;
