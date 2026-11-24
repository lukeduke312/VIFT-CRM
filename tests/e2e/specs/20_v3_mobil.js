'use strict';
/* V3 slutpolering: snabbåtgärdsraden i arbetsorderdetaljen (mobil/surfplatta)
   och den kompakta mobildashboarden. Simulerad server. */

// offsetParent är null för position:fixed (bottenmenyn), så synlighet mäts med storlek och display.
const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); if (r.height === 0 || getComputedStyle(e).display === 'none') return null; return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; };

module.exports = [
  {
    id: 'QBAR-01', module: 'Arbetsorder (mobil)', name: 'Snabbåtgärdsraden täcker aldrig innehåll: ovanför bottenmenyn, fritt vid sidans slut, under dialoger, dold när ett fält har fokus; finns inte på dator',
    async run(t) {
      for (const vp of ['android', 'iphone', 'w768', 'w1024']) {
        const s = await t.world.session({ viewport: vp });
        await s.login('falt2');
        await s.go('pg-ao-detail', { aoId: 'AO-015' });
        await s.settle(500);
        const r = await s.eval((rectSrc) => {
          const rect = eval(rectSrc);
          const bar = rect('.page.active .aod-qbar');
          const nav = rect('#mobile-bottom-nav');
          return { bar, nav, vh: window.innerHeight, stampCard: !!rect('.page.active .aod-stamp .ao-stamp-btn') };
        }, rect.toString());
        if (vp === 'w1024') {
          t.assert(!r.bar, vp + ': ingen snabbåtgärdsrad på dator (stämpling finns i sidan)');
          t.assert(r.stampCard, vp + ': stämplingskortet syns på dator');
          continue;
        }
        t.assert(r.bar, vp + ': snabbåtgärdsraden syns');
        t.assert(r.bar.bottom <= r.vh + 1 && r.bar.top >= 0, vp + ': raden ligger inom skärmen utan att rulla');
        t.assert(r.nav && r.bar.bottom <= r.nav.top + 1, vp + ': raden ligger ovanför bottenmenyn (rad ' + Math.round(r.bar.bottom) + ', meny ' + Math.round(r.nav.top) + ')');
        // Sidans slut: sista innehållet ska ligga ovanför raden, inte under den.
        const end = await s.eval(() => {
          const sc = document.getElementById('content-scroll'); sc.scrollTop = sc.scrollHeight;
          const bar = document.querySelector('.page.active .aod-qbar').getBoundingClientRect();
          const items = [...document.querySelectorAll('.page.active .aod > *:not(.aod-qbar), .page.active .aod-grid *')].filter((e) => e.offsetParent && e.getBoundingClientRect().height > 0 && !e.closest('.aod-qbar'));
          const lowest = items.reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);
          const btns = [...document.querySelectorAll('.page.active button, .page.active a.btn')].filter((b) => b.offsetParent && !b.closest('.aod-qbar'));
          const covered = btns.filter((b) => { const r = b.getBoundingClientRect(); return r.bottom > bar.top + 1 && r.top < bar.bottom - 1 && r.right > bar.left && r.left < bar.right; }).map((b) => b.textContent.trim().slice(0, 20));
          return { lowest, barTop: bar.top, covered };
        });
        t.assert(end.lowest <= end.barTop + 1, vp + ': vid sidans slut ligger allt innehåll ovanför raden (' + Math.round(end.lowest) + ' ≤ ' + Math.round(end.barTop) + ')');
        t.assert(end.covered.length === 0, vp + ': inga knappar under raden vid sidans slut ' + JSON.stringify(end.covered));
        // Dialog ovanpå raden.
        await s.eval(() => WorkOrderDetailPage.openAddLog());
        await s.settle(300);
        const onTop = await s.eval(() => { const b = document.querySelector('.page.active .aod-qbar').getBoundingClientRect(); const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!(el && el.closest('.modal-overlay')); });
        t.assert(onTop, vp + ': öppen dialog ligger ovanpå snabbåtgärdsraden');
        await s.eval(() => Modal.close());
        // Fält i sidan med fokus → raden döljs.
        const hidden = await s.eval(() => { const i = document.createElement('input'); i.id = 'qbar-test'; document.querySelector('.page.active .aod-mission .card-body').appendChild(i); i.focus(); const v = getComputedStyle(document.querySelector('.page.active .aod-qbar')).display; i.remove(); return v; });
        t.assert(hidden === 'none', vp + ': raden döljs när ett fält har fokus (tangentbord)');
        // Instämplad: statusraden för stämpling visas ovanför bottenmenyn; snabbåtgärdsraden ska ligga ovanför den.
        await s.eval(() => document.getElementById('content-scroll').scrollTop = 0);
        // Stämplingen följer personen på servern: efter första bredden är falt2 redan instämplad.
        const first = await s.eval(() => document.querySelector('.page.active .aod-qbar button').textContent.trim());
        if (first === 'Stämpla in') { await s.page.locator('.page.active .aod-qbar button').first().click(); await s.settle(400); }
        const ci = await s.eval((rectSrc) => { const rect = eval(rectSrc); return { bar: rect('.page.active .aod-qbar'), clock: rect('#mobile-clock-status.show'), nav: rect('#mobile-bottom-nav'), label: (document.querySelector('.page.active .aod-qbar button') || {}).textContent }; }, rect.toString());
        t.assert(/Stämpla ut/.test(ci.label || ''), vp + ': instämplad efter tryck på Stämpla in (' + (ci.label || '').trim() + ')');
        t.assert(ci.clock || ci.nav, vp + ': stämplingsraden eller bottenmenyn syns ' + JSON.stringify(ci));
        const floor = ci.clock ? ci.clock.top : ci.nav ? ci.nav.top : 0;
        t.assert(ci.bar && ci.bar.bottom <= floor + 1, vp + ': instämplad — raden ligger ovanför stämplingsraden och bottenmenyn (rad ' + Math.round(ci.bar ? ci.bar.bottom : -1) + ', golv ' + Math.round(floor) + ')');
      }
    },
  },
  {
    id: 'ECO-V3-01', module: 'Ekonomi (V3)', name: 'Offertdetalj utan upprepning av kund/status/belopp; fakturaunderlagets statusväljare får plats på mobil och tillbakaknappen syns',
    async run(t) {
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('admin');
      await s.go('pg-offer-detail', { offerId: 'OFF-001' });
      await s.settle(500);
      const o = await s.eval(() => {
        const pg = document.querySelector('.page.active');
        const vis = (e) => e && e.getBoundingClientRect().height > 0 && getComputedStyle(e).display !== 'none';
        const text = pg.innerText;
        const count = (re) => (text.match(re) || []).length;
        return {
          quick: [...pg.querySelectorAll('.off-mobile-quick')].filter(vis).length,
          status: [...pg.querySelectorAll('.bdg.st, .sbdg, .off-status-btn')].filter(vis).length,
          giltig: count(/Giltig (t\.o\.m\.|till)/g),
          totalt: count(/^Totalt inkl\. moms$/gim),
          belopp: count(/43 125 kr/g),
        };
      });
      t.assert(o.quick === 0, 'mobilens extra rad med kund, status och belopp är borta');
      t.assert(o.giltig === 1, 'giltighetsdatum visas en gång (' + o.giltig + ')');
      t.assert(o.totalt <= 2, '"Totalt inkl. moms" visas i huvudet och som slutrad, inte tre gånger (' + o.totalt + ')');
      t.assert(o.belopp <= 2, 'totalbeloppet visas i huvudet och i summeringen, inte fler gånger (' + o.belopp + ')');
      for (const vp of ['android', 'iphone', 'w768', 'laptop']) {
        const d = await t.world.session({ viewport: vp });
        await d.login('admin');
        await d.go('pg-inv-detail', { invoiceId: 'INV-003' });
        await d.settle(500);
        const r = await d.eval(() => {
          const sel = document.querySelector('.page.active .doc-status-sel');
          const cs = getComputedStyle(sel);
          const c = document.createElement('canvas').getContext('2d'); c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
          const sr = sel.getBoundingClientRect();
          const head = document.querySelector('.page.active .doc-head').getBoundingClientRect();
          const back = document.querySelector('.page.active .doc-head .ao-back-btn');
          return { text: c.measureText(sel.options[sel.selectedIndex].text).width, inner: sr.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), right: sr.right, headRight: head.right, topH: document.querySelector('.page.active .doc-top').getBoundingClientRect().height, backColor: getComputedStyle(back).color, backW: back.getBoundingClientRect().width, label: sel.options[sel.selectedIndex].text };
        });
        t.assert(r.text <= r.inner + 0.5, vp + ': statusväljarens text får plats (' + Math.round(r.text) + ' ≤ ' + Math.round(r.inner) + ')');
        t.assert(r.right <= r.headRight, vp + ': statusväljaren ligger inom huvudet');
        t.assert(r.topH <= 48, vp + ': nummer, status och väljare på en rad (' + Math.round(r.topH) + ' px)');
        t.assert(r.backW > 0 && r.backColor !== 'rgb(255, 255, 255)', vp + ': tillbakaknappen syns på det ljusa huvudet (' + r.backColor + ')');
        t.assert(r.label === 'Byt status', vp + ': väljaren heter "Byt status" utan punkter som ser avklippta ut');
      }
    },
  },
  {
    id: 'ECO-V3-02', module: 'Ekonomi (V3)', name: 'Fakturakön: samma urvalslogik för kund/fastighet/AO/rad som förut; delvis markerade grupper visas; varje AO samlar sina rader',
    async run(t) {
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('admin');
      await s.go('pg-invoices');
      await s.eval(() => InvoicesPage._setView && InvoicesPage._setView('queue'));
      await s.settle(500);
      // Första kunden med minst två underlag, så att "delvis markerad" kan uppstå.
      const gi = await s.eval(() => [...document.querySelectorAll('.bq-cust-group')].findIndex((g) => g.querySelectorAll('.bq-source-row').length >= 2));
      t.assert(gi >= 0, 'det finns en kund med minst två underlag i kön');
      const grp = () => s.page.locator('.bq-cust-group').nth(gi);
      const st = () => s.eval((gi) => {
        const cust = document.querySelectorAll('.bq-cust-group')[gi];
        const ids = cust.querySelector('.bq-cust-header .bq-group-cb').getAttribute('data-group-ids').split('|');
        const cb = (sel) => { const e = cust.querySelector(sel); return { c: e.checked, i: e.indeterminate }; };
        return { n: ids.length, sel: ids.filter((id) => SelectionModel.isSelected(id)).length, total: SelectionModel.count(), cust: cb('.bq-cust-header .bq-group-cb'), prop: cb('.bq-prop-header .bq-group-cb'), ao: cb('.bq-ao-header .bq-group-cb') };
      }, gi);
      // Struktur: varje rad ligger i sin AO-grupp och indraget följer nivån.
      const lay = await s.eval(() => {
        const rows = [...document.querySelectorAll('#bq-list .bq-source-row')];
        const x = (sel) => { const e = document.querySelector('#bq-list ' + sel); return e ? e.getBoundingClientRect().left : null; };
        return { rows: rows.length, inAo: rows.filter((r) => r.parentElement.classList.contains('bq-ao-group')).length, cx: x('.bq-cust-header input'), ax: x('.bq-ao-header input'), rx: x('.bq-source-row input'), labels: [...document.querySelectorAll('#bq-list .bq-group-cb')].slice(0, 3).map((e) => e.getAttribute('aria-label')) };
      });
      t.assert(lay.rows > 0 && lay.inAo === lay.rows, 'alla underlagsrader ligger i sin arbetsorders kort (' + lay.inAo + '/' + lay.rows + ')');
      t.assert(lay.cx < lay.ax && lay.ax < lay.rx, 'indraget följer nivån: kund < AO < rad (' + [lay.cx, lay.ax, lay.rx].map(Math.round).join(' < ') + ')');
      t.assert(lay.labels.every((l) => /^Markera alla underlag för /.test(l)), 'gruppernas kryssrutor har beskrivande etiketter ' + JSON.stringify(lay.labels));
      // 1. Kundens kryssruta markerar alla kundens underlag (oförändrad logik).
      await grp().locator('.bq-cust-header input').check();
      await s.settle(200);
      let a = await st();
      t.assert(a.sel === a.n && a.total === a.n && a.cust.c && a.prop.c && a.ao.c, 'kund markerad → alla ' + a.n + ' underlag markerade och underliggande grupper markerade ' + JSON.stringify(a));
      // 2. Avmarkera en rad → kund/fastighet/AO delvis markerade, ett underlag mindre.
      await grp().locator('.bq-source-row input').first().uncheck();
      await s.settle(200);
      a = await st();
      t.assert(a.sel === a.n - 1, 'en rad avmarkerad → ' + (a.n - 1) + ' markerade (' + a.sel + ')');
      t.assert(!a.cust.c && a.cust.i && !a.prop.c && a.prop.i, 'kund och fastighet visas delvis markerade ' + JSON.stringify(a));
      // 3. Klick på delvis markerad grupp markerar alla igen (samma beteende som förut).
      await grp().locator('.bq-cust-header input').click();
      await s.settle(200);
      a = await st();
      t.assert(a.sel === a.n && a.cust.c && !a.cust.i, 'klick på delvis markerad kund markerar alla igen ' + JSON.stringify(a));
      // 4. Välj alla / Avmarkera via markeringsfältet → gruppernas kryssrutor följer med.
      await s.page.locator('#bq-list ._sel-all-cb').click();
      await s.settle(300);
      const all = await s.eval(() => ({ groups: [...document.querySelectorAll('#bq-list .bq-group-cb')].every((e) => e.checked), n: SelectionModel.count(), rows: document.querySelectorAll('#bq-list .bq-source-row').length }));
      t.assert(all.n === all.rows && all.groups, 'Välj alla markerar alla underlag och alla grupper visas markerade ' + JSON.stringify(all));
      await s.page.locator('#bq-list ._sel-all-cb').click();
      await s.settle(300);
      const none = await s.eval(() => ({ groups: [...document.querySelectorAll('#bq-list .bq-group-cb')].every((e) => !e.checked && !e.indeterminate), n: SelectionModel.count() }));
      t.assert(none.n === 0 && none.groups, 'Välj alla igen avmarkerar allt och grupperna följer med ' + JSON.stringify(none));
    },
  },
  {
    id: 'DASH-M-01', module: 'Dashboard (mobil)', name: 'Mobildashboard: Kräver åtgärd direkt efter nyckeltalen, personal högt upp, långa listor med Visa fler, kartan bakom Visa karta — inget försvinner',
    async run(t) {
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('admin');
      await s.go('pg-dash');
      await s.settle(600);
      const o = await s.eval(() => {
        const y = (sel, text) => { const e = [...document.querySelectorAll(sel)].find((x) => x.offsetParent && (!text || text.test(x.textContent))); return e ? Math.round(e.getBoundingClientRect().top) : null; };
        return { tiles: y('.dt-tiles'), krav: y('.page.active h3', /Kräver åtgärd/), schema: y('.page.active h3', /Dagens schema/), personal: y('.page.active h3', /Personal idag/), karta: y('.page.active h3', /Aktiva jobb/), more: [...document.querySelectorAll('.dm-more')].filter((b) => b.offsetParent).length, mapBtn: !!document.querySelector('.dm-map-btn'), hiddenRows: document.querySelectorAll('.dm-hidden').length };
      });
      t.assert(o.tiles !== null && o.krav !== null && o.tiles < o.krav && o.krav < o.schema, 'ordning: nyckeltal → Kräver åtgärd → Dagens schema ' + JSON.stringify(o));
      t.assert(o.personal !== null && o.personal < o.karta, 'personal idag ligger före övriga widgetar');
      t.assert(o.more >= 3 && o.hiddenRows > 0, 'långa listor har Visa fler (' + o.more + ' knappar, ' + o.hiddenRows + ' dolda rader)');
      t.assert(o.mapBtn, 'kartan nås via Visa karta');
      const before = await s.eval(() => document.querySelectorAll('.dm-hidden').length);
      await s.page.locator('.dm-more').first().click();
      const after = await s.eval(() => document.querySelectorAll('.dm-hidden').length);
      t.assert(after < before, 'Visa fler visar de dolda raderna (' + before + ' → ' + after + ')');
      await s.page.locator('.dm-map-btn').click();
      t.assert(await s.eval(() => !document.querySelector('.dm-map-hidden')), 'Visa karta visar kartan');
      const d = await t.world.session({ viewport: 'laptop' });
      await d.login('admin');
      await d.go('pg-dash');
      await d.settle(500);
      t.assert(await d.eval(() => !document.querySelector('.dm-more, .dm-map-btn, .dm-hidden')), 'dator: inga Visa fler-knappar, allt visas som tidigare');
    },
  },
];
