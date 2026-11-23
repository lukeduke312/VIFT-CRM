'use strict';
/*
 * Visuell granskning och visuell regression.
 *
 *   node tests/e2e/visual.js capture <katalog>         # skärmbilder av alla vyer
 *   node tests/e2e/visual.js compare <före> <efter>    # pixeljämförelse → report.json + diff-bilder
 *
 * Mot simulerad backend (samma som E2E-sviten). Webbläsarens klocka låses
 * till samma tidpunkt så att datumberoende vyer blir jämförbara inom en dag;
 * demodata genereras utifrån dagens datum, så en baslinje från en annan dag
 * ska tas om (det är data, inte layout, som ändrats).
 */
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const VIEWS = [
  { id: '01-dashboard', page: 'pg-dash' },
  { id: '02-kundregister', page: 'pg-crm' },
  { id: '03-kundkort', page: 'pg-crm-detail', params: { customerId: 'K-001' } },
  { id: '04-fastigheter', page: 'pg-objects' },
  { id: '05-fastighetskort', page: 'pg-obj-detail', params: { propId: 'OBJ-001' } },
  { id: '06-objektkort', page: 'pg-obj-detail', params: { propId: 'OBJ-001' }, after: (s) => s.eval(() => PropertyDetailPage.switchTab('objects')) },
  { id: '07-arbetsorderlista', page: 'pg-ao' },
  { id: '08-arbetsorderdetalj', page: 'pg-ao-detail', params: { aoId: 'AO-007' } },
  { id: '09-arbetsorderguide', page: 'pg-ao', after: (s) => s.eval(() => WorkOrdersPage.openCreate()) },
  { id: '10-mina-jobb', page: 'pg-myjobs', user: 'falt2' },
  { id: '11-tidregistrering', page: 'pg-tid', user: 'falt2' },
  { id: '12-personal', page: 'pg-staff' },
  { id: '13-offerter', page: 'pg-offer' },
  { id: '14-offertguide', page: 'pg-offer', after: async (s) => { await s.page.locator('.page.active button', { hasText: 'Ny offert' }).first().click(); } },
  { id: '15-fakturering', page: 'pg-invoices' },
  { id: '16-fakturako', page: 'pg-invoices', after: (s) => s.eval(() => InvoicesPage._setView && InvoicesPage._setView('queue')) },
  { id: '17-projekt', page: 'pg-projects' },
  { id: '18-rondering', page: 'pg-rondering' },
  { id: '19-avvikelser', page: 'pg-reports', after: (s) => s.eval(() => ReportsPage._setTab('avvikelser')) },
  { id: '20-serviceintervall', page: 'pg-service-intervals' },
  { id: '21-kalender', page: 'pg-calendar' },
  { id: '22-att-gora', page: 'pg-activities' },
  { id: '23-saljchanser', page: 'pg-sales' },
  { id: '24-rapporter', page: 'pg-reports' },
  { id: '25-import-export', page: 'pg-export-center' },
  { id: '26-admin', page: 'pg-admin' },
  { id: '27-modal-ny-kund', page: 'pg-crm', after: async (s) => { await s.page.locator('.page.active button', { hasText: 'Ny kund' }).first().click(); } },
  { id: '28-modal-ny-tid', page: 'pg-tid', user: 'falt2', after: (s) => s.eval(() => TimePage.openManual && TimePage.openManual({})) },
  { id: '29-fakturadetalj', page: 'pg-inv-detail', params: { invoiceId: 'INV-003' } },
  { id: '30-offertdetalj', page: 'pg-offer-detail', params: { offerId: 'OFF-001' } },
];
/* Standard: laptop + mobil. VIFT_VISUAL_SIZES=alla → 1920, 1366, 1024, 768, 390, 360.
   VIFT_VISUAL_ONLY=<regex> begränsar till vissa vy-id:n. */
const ALL_SIZES = { w1920: 'desktop', w1366: 'laptop', w1024: 'w1024', w768: 'w768', w390: 'iphone', w360: 'android' };
const SIZES = process.env.VIFT_VISUAL_SIZES === 'alla' ? ALL_SIZES
  : process.env.VIFT_VISUAL_SIZES ? Object.fromEntries(process.env.VIFT_VISUAL_SIZES.split(',').map((k) => [k, ALL_SIZES[k] || k]))
  : { laptop: 'laptop', mobil: 'iphone' };
const ONLY = process.env.VIFT_VISUAL_ONLY ? new RegExp(process.env.VIFT_VISUAL_ONLY) : null;
const FIXED_TIME = new Date();

async function capture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  await lib.start();
  for (const [label, vp] of Object.entries(SIZES)) {
    const world = new lib.World();
    if (process.env.VIFT_VISUAL_EMPTY) {
      // Tomma lägen: inga affärsregister (personal, roller och inställningar finns kvar för inloggning).
      ['customers', 'properties', 'propertyObjects', 'workOrders', 'timeEntries', 'offers', 'invoices', 'salesOpps', 'activities', 'recurringOrders', 'ronderingar', 'ronderingspass', 'avvikelser', 'contracts', 'projects', 'notifications', 'activityLog'].forEach((k) => world.fake.set(k, []));
    }
    const sessions = {};
    const get = async (user) => {
      if (sessions[user]) return sessions[user];
      const s = await world.session({ viewport: vp });
      await s.context.clock.setFixedTime(FIXED_TIME);
      await s.login(user);
      await s.page.addStyleTag({ content: '*{animation:none!important;transition:none!important;caret-color:transparent!important} #toast{display:none!important}' });
      sessions[user] = s; return s;
    };
    for (const v of VIEWS) {
      if (ONLY && !ONLY.test(v.id)) continue;
      const s = await get(v.user || 'admin');
      try {
        await s.eval(() => { try { Modal.close(); } catch (e) {} });
        await s.go(v.page, v.params || {});
        if (v.after) { await v.after(s); }
        await s.settle(500);
        // Appen scrollar i en egen behållare — förläng fönstret till innehållets höjd.
        const base = s.page.viewportSize();
        const h = await s.eval(() => { const els = [document.querySelector('.page.active'), document.querySelector('.main-content'), document.querySelector('main'), document.scrollingElement]; return Math.max.apply(null, els.filter(Boolean).map((e) => e.scrollHeight + (e.getBoundingClientRect ? e.getBoundingClientRect().top : 0))); });
        const modal = await s.modalOpen();
        if (!modal) await s.page.setViewportSize({ width: base.width, height: Math.min(Math.max(base.height, Math.ceil(h) + 40), 5000) });
        await s.settle(200);
        await s.page.screenshot({ path: path.join(dir, label + '-' + v.id + '.png') });
        await s.page.setViewportSize(base);
        process.stdout.write('.');
      } catch (e) { console.log('\n' + label + ' ' + v.id + ': ' + e.message.split('\n')[0]); }
    }
    await world.close();
  }
  await lib.stop();
  console.log('\nSkärmbilder: ' + dir);
}

async function compare(a, b) {
  const files = fs.readdirSync(a).filter((f) => f.endsWith('.png') && fs.existsSync(path.join(b, f)));
  const outDir = path.join(b, 'diff'); fs.mkdirSync(outDir, { recursive: true });
  const { browser } = await lib.start();
  const page = await browser.newPage();
  const res = [];
  for (const f of files) {
    const toUrl = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');
    const r = await page.evaluate(async ([ua, ub]) => {
      const load = (u) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = u; });
      const [ia, ib] = await Promise.all([load(ua), load(ub)]);
      const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
      const ca = document.createElement('canvas'); ca.width = w; ca.height = h; const xa = ca.getContext('2d'); xa.fillStyle = '#fff'; xa.fillRect(0, 0, w, h); xa.drawImage(ia, 0, 0);
      const cb = document.createElement('canvas'); cb.width = w; cb.height = h; const xb = cb.getContext('2d'); xb.fillStyle = '#fff'; xb.fillRect(0, 0, w, h); xb.drawImage(ib, 0, 0);
      const da = xa.getImageData(0, 0, w, h).data, db = xb.getImageData(0, 0, w, h);
      const out = xb.createImageData(w, h); let diff = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.abs(da[i] - db.data[i]) + Math.abs(da[i + 1] - db.data[i + 1]) + Math.abs(da[i + 2] - db.data[i + 2]);
        if (d > 30) { diff++; out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0; out.data[i + 3] = 255; }
        else { const g = (db.data[i] + db.data[i + 1] + db.data[i + 2]) / 3; out.data[i] = out.data[i + 1] = out.data[i + 2] = 200 + g / 5; out.data[i + 3] = 255; }
      }
      xb.putImageData(out, 0, 0);
      return { pct: Math.round(diff / (w * h) * 10000) / 100, sizeA: ia.width + 'x' + ia.height, sizeB: ib.width + 'x' + ib.height, png: cb.toDataURL('image/png') };
    }, [toUrl(path.join(a, f)), toUrl(path.join(b, f))]);
    if (r.pct > 0) fs.writeFileSync(path.join(outDir, f), Buffer.from(r.png.split(',')[1], 'base64'));
    res.push({ file: f, changedPct: r.pct, before: r.sizeA, after: r.sizeB });
    console.log((r.pct > 0 ? 'ÄNDRAD ' : 'samma  ') + f + (r.pct > 0 ? ' — ' + r.pct + ' % av pixlarna (' + r.sizeA + ' → ' + r.sizeB + ')' : ''));
  }
  fs.writeFileSync(path.join(b, 'compare.json'), JSON.stringify(res, null, 2));
  await lib.stop();
}

/* Kontaktark för visuell granskning: n bilder per ark, nedskalade, med
   rubrik. Översiktsläge — detaljer granskas i fullstor bild. */
async function sheet(dir, filter, out, perSheet) {
  perSheet = Number(perSheet || 6);
  const re = new RegExp(filter || '.');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png') && re.test(f)).sort();
  const { browser } = await lib.start();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  for (let k = 0; k < files.length; k += perSheet) {
    const chunk = files.slice(k, k + perSheet);
    const html = '<html><body style="margin:0;font:12px sans-serif;background:#ddd;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px">' +
      chunk.map((f) => '<div style="background:#fff"><div style="padding:3px 6px;font-weight:700">' + f + '</div><img style="width:100%;display:block" src="data:image/png;base64,' + fs.readFileSync(path.join(dir, f)).toString('base64') + '"></div>').join('') + '</body></html>';
    await page.setContent(html);
    await page.waitForTimeout(200);
    const file = out + '-' + String(k / perSheet + 1).padStart(2, '0') + '.png';
    await page.screenshot({ path: file, fullPage: true });
    console.log(file);
  }
  await lib.stop();
}

const [cmd, x, y, z, w] = process.argv.slice(2);
(cmd === 'capture' ? capture(x) : cmd === 'compare' ? compare(x, y) : cmd === 'sheet' ? sheet(x, y, z, w) : Promise.reject(new Error('användning: capture <katalog> | compare <före> <efter>')))
  .catch((e) => { console.error(e.message); process.exit(1); });
