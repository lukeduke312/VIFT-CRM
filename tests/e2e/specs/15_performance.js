'use strict';
/*
 * Prestanda med stor syntetisk datamängd. Mätningarna görs i headless
 * Chromium i testcontainern mot den simulerade backenden i samma process —
 * nätverkslatens saknas alltså nästan helt. Siffrorna visar klientens egen
 * kostnad (parsning, rendering, beräkning) och antal anrop, inte svarstider
 * mot riktig Supabase. Gränserna är generösa larmgränser, inte mål.
 */
function scaleUp(fake, n) {
  const pad = (x, w) => String(x).padStart(w, '0');
  const cus = fake.get('customers'); const props = fake.get('properties'); const aos = fake.get('workOrders'); const te = fake.get('timeEntries');
  const statuses = ['nytt', 'pool', 'planerad', 'pågående', 'klar', 'fakturerad'];
  for (let i = 0; i < n.customers; i++) cus.push({ id: 'KP-' + pad(i, 5), name: 'Synt Kund ' + i + ' AB', type: 'foretag', email: 'kund' + i + '@example.test', city: ['Uppsala', 'Västerås', 'Örebro'][i % 3], contacts: [] });
  for (let i = 0; i < n.properties; i++) props.push({ id: 'PP-' + pad(i, 5), name: 'Syntgatan ' + i, customerId: 'KP-' + pad(i % n.customers, 5), address: 'Syntgatan ' + i, city: 'Uppsala', serviceIntervals: [] });
  for (let i = 0; i < n.workOrders; i++) {
    const d = new Date(Date.now() - (i % 120) * 86400000).toISOString().slice(0, 10);
    aos.push({ id: 'AOP-' + pad(i, 5), title: 'Synt arbetsorder ' + i, customerId: 'KP-' + pad(i % n.customers, 5), propertyId: 'PP-' + pad(i % n.properties, 5), status: statuses[i % statuses.length], scheduledDate: d, staff: ['ST-002'], log: [{ id: 'L' + i, text: 'Start', ts: new Date().toISOString() }], material: [], checklist: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  for (let i = 0; i < n.timeEntries; i++) {
    const d = new Date(Date.now() - (i % 180) * 86400000).toISOString().slice(0, 10);
    te.push({ id: 'TEP-' + pad(i, 6), aoId: 'AOP-' + pad(i % n.workOrders, 5), staffId: ['ST-002', 'ST-003', 'ST-004'][i % 3], date: d, startStr: '08:00', endStr: '10:00', minutes: 120, billable: true, createdAt: new Date().toISOString() });
  }
  fake.set('customers', cus); fake.set('properties', props); fake.set('workOrders', aos); fake.set('timeEntries', te);
}

module.exports = [
  {
    id: 'PERF-01', module: 'Prestanda', name: 'Stor datamängd (2 000 kunder, 3 000 fastigheter, 3 000 AO, 20 000 tidposter): inloggning, AO-lista, AO-detalj, kundsökning, sparning — uppmätta tider och anrop',
    async run(t) {
      scaleUp(t.fake, { customers: 2000, properties: 3000, workOrders: 3000, timeEntries: 20000 });
      const s = await t.world.session({ viewport: 'laptop' });
      await s.open();
      await s.page.waitForSelector('#login-user', { state: 'visible' });
      const t0 = Date.now();
      await s.login('admin');
      const loginMs = Date.now() - t0;
      const startupCalls = s.requests.length;
      t.metric('inloggning_till_klar_ms', loginMs);
      t.metric('anrop_vid_start', startupCalls);
      const m = await s.eval(async () => {
        const out = {};
        const time = async (k, fn) => { const a = performance.now(); await fn(); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); out[k] = Math.round(performance.now() - a); };
        await time('ao_lista_ms', () => Router.showPage('pg-ao', {}));
        out.ao_rader = document.querySelectorAll('#pg-ao .ao-card, #pg-ao tr, #pg-ao .crow').length;
        await time('ao_detalj_ms', () => Router.showPage('pg-ao-detail', { aoId: 'AOP-01500' }));
        await time('kundlista_ms', () => Router.showPage('pg-crm', {}));
        await time('dashboard_ms', () => Router.showPage('pg-dash', {}));
        await time('rapport_tid_ms', () => { Router.showPage('pg-reports', {}); ReportsPage._setTab('tid'); });
        await time('loneunderlag_ms', () => Router.showPage('pg-payroll', {}));
        await time('kalender_ms', () => Router.showPage('pg-calendar', {}));
        return out;
      });
      Object.entries(m).forEach(([k, v]) => t.metric(k, v));
      // Kundsökning via fältet
      await s.go('pg-crm');
      const search = s.page.locator('#pg-crm input[type="search"], #pg-crm input[placeholder*="Sök"]').first();
      const ts = Date.now();
      await search.fill('Synt Kund 1999');
      await s.page.waitForFunction(() => /Synt Kund 1999/.test(document.getElementById('pg-crm').innerText), null, { timeout: 10000 });
      t.metric('kundsokning_ms', Date.now() - ts);
      // Sparning (kund) till serverns bekräftelse
      const tsv = Date.now();
      const ok = await s.eval(async () => { const c = state.customers.find((x) => x.id === 'KP-00010'); c.phone = '010-123'; return persist({ keys: ['customers'] }); });
      t.metric('sparning_kund_till_ack_ms', Date.now() - tsv);
      t.assert(ok === true, 'sparningen bekräftad');
      // Anrop i vila under 35 s. OBS: DataSync pausar medan fokus står i ett
      // inmatningsfält (även sökfält) — därför fokus bort först.
      const focusedPause = await s.eval(() => { const ae = document.activeElement; const r = !!ae && /INPUT|TEXTAREA/.test(ae.tagName); if (ae && ae.blur) ae.blur(); return r; });
      if (focusedPause) t.note('observation: pollningen var pausad så länge sökfältet hade fokus');
      const before = s.requests.length;
      await s.settle(35000);
      t.metric('anrop_i_vila_35s', s.requests.length - before);
      const heap = await s.eval(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
      if (heap) t.metric('js_heap_mb', heap);
      t.note('mätvärden: ' + JSON.stringify(Object.assign({ inloggning_till_klar_ms: loginMs, anrop_vid_start: startupCalls }, m)));
      t.assert(loginMs < 20000, 'inloggning under 20 s (' + loginMs + ' ms)');
      t.assert(m.ao_lista_ms < 5000 && m.ao_detalj_ms < 3000, 'AO-lista < 5 s och AO-detalj < 3 s');
    },
  },
];
