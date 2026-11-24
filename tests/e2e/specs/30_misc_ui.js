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

/* Mätbredder (skala 1). Läggs till i harnessens VIEWPORTS bara för denna fil. */
const lib = require('../lib');
lib.VIEWPORTS.mx360 = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
lib.VIEWPORTS.mx390 = { viewport: { width: 390, height: 664 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
lib.VIEWPORTS.mx1366 = { viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 };
lib.VIEWPORTS.mx1920 = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };

async function open(t, vp, user, page, params) {
  if (!t.__seeded) { seedMisc(t.fake); t.__seeded = true; }
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
];
module.exports = tests;
module.exports.seedMisc = seedMisc;
