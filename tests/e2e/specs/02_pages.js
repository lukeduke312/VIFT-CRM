'use strict';
/*
 * Sidsvep: varje registrerad sida öppnas, renderas utan JS-fel, visar
 * innehåll utan "undefined"/"NaN"/"[object Object]", och tillbaka-navigering
 * fungerar. Körs som admin. Mäter renderingstid per sida.
 */
const PAGES = ['pg-dash', 'pg-ao', 'pg-ao-detail', 'pg-crm', 'pg-crm-detail', 'pg-objects', 'pg-service-intervals', 'pg-obj-detail',
  'pg-offer', 'pg-offer-detail', 'pg-invoices', 'pg-inv-detail', 'pg-tid', 'pg-calendar', 'pg-contracts', 'pg-projects',
  'pg-project-detail', 'pg-rondering', 'pg-rondering-wizard', 'pg-rondering-utfor', 'pg-rondering-rapport', 'pg-payroll',
  'pg-reports', 'pg-articles', 'pg-pricegroups', 'pg-staff', 'pg-admin', 'pg-recurring', 'pg-sales', 'pg-activities',
  'pg-service-templates', 'pg-myjobs', 'pg-operations', 'pg-propobj-detail', 'pg-import-wizard', 'pg-import-log', 'pg-export-center'];

async function sampleParams(s) {
  return s.eval(() => {
    const first = (a) => (Array.isArray(a) && a.length ? a[0].id : null);
    return {
      'pg-ao-detail': { aoId: first(state.workOrders) },
      'pg-crm-detail': { customerId: first(state.customers) },
      'pg-obj-detail': { propId: first(state.properties) },
      'pg-offer-detail': { offerId: first(state.offers) },
      'pg-inv-detail': { invoiceId: first(state.invoices) },
      'pg-project-detail': { projectId: first(state.projects) },
      'pg-rondering-utfor': { passId: first(state.ronderingspass) },
      'pg-rondering-rapport': { passId: first(state.ronderingspass) },
      'pg-propobj-detail': { objId: first(state.propertyObjects) },
    };
  });
}

async function sweep(t, s, label, viewportChecks) {
  const params = await sampleParams(s);
  const problems = [];
  const times = [];
  for (const id of PAGES) {
    const prm = params[id] || {};
    if (Object.values(prm).some((v) => v === null)) { t.note(id + ': ingen testdata (' + Object.keys(prm).join() + ') — tomt läge'); }
    const errBefore = s.pageErrors.length;
    const t0 = Date.now();
    await s.go(id, prm);
    times.push(Date.now() - t0);
    const info = await s.eval((pid) => {
      const el = document.getElementById(pid);
      const active = !!(el && el.classList.contains('active'));
      const txt = el ? el.innerText : '';
      const bad = (txt.match(/\b(undefined|NaN|\[object Object\])\b/g) || []).slice(0, 3);
      return { active, len: txt.trim().length, bad, dashActive: document.getElementById('pg-dash').classList.contains('active') };
    }, id);
    if (s.pageErrors.length > errBefore) problems.push(id + ': JS-fel ' + s.pageErrors.slice(errBefore).join(' / ').slice(0, 160));
    if (!info.active) problems.push(id + ': sidan aktiverades inte' + (info.dashActive ? ' (skickades till dashboard)' : ''));
    else if (info.len < 15) problems.push(id + ': tom sida');
    if (info.bad.length) problems.push(id + ': visar "' + info.bad.join('", "') + '"');
    if (viewportChecks) {
      const li = await s.layoutIssues();
      if (li.length) problems.push(id + ' [' + label + ']: ' + li.join('; '));
    }
  }
  return { problems, times };
}

const tests = [
  {
    id: 'PAGES-01', module: 'Navigering och menyer', name: 'Alla 37 registrerade sidor öppnas utan JS-fel och utan "undefined/NaN" (admin, laptop)',
    async run(t) {
      const s = await t.world.session();
      await s.login('admin');
      const r = await sweep(t, s, 'laptop', false);
      t.metric('medel renderingstid per sida (ms)', Math.round(r.times.reduce((a, b) => a + b, 0) / r.times.length));
      t.metric('långsammaste sida (ms)', Math.max(...r.times));
      t.assert(r.problems.length === 0, r.problems.join(' || '));
    },
  },
  {
    id: 'PAGES-02', module: 'Navigering och menyer', name: 'Sidomenyn: varje synligt menyval öppnar sin sida; tillbaka-knappen fungerar',
    async run(t) {
      const s = await t.world.session();
      await s.login('admin');
      const navIds = await s.eval(() => Array.from(document.querySelectorAll('[id^="nav-pg-"]')).filter((b) => b.offsetParent !== null).map((b) => b.id));
      t.assert(navIds.length >= 15, 'minst 15 menyval (' + navIds.length + ')');
      const fails = [];
      for (const nid of navIds) {
        await s.page.click('#' + nid);
        await s.settle(250);
        const pid = nid.replace(/^nav-/, '');
        const ok = await s.eval((p) => document.getElementById(p) && document.getElementById(p).classList.contains('active'), pid);
        if (!ok) fails.push(nid);
      }
      await s.go('pg-crm'); await s.go('pg-objects');
      await s.eval(() => Router.back()); await s.settle(400);
      const back = await s.eval(() => Router.currentPage);
      t.assert(fails.length === 0, 'menyval som inte öppnade sin sida: ' + fails.join(', '));
      t.assert(back === 'pg-crm', 'tillbaka gick till pg-crm (fick ' + back + ')');
      t.note(navIds.length + ' menyval klickade');
    },
  },
];

['desktop', 'laptop', 'tablet', 'iphone', 'android'].forEach((vp) => {
  tests.push({
    id: 'RESP-' + vp.toUpperCase(), module: 'Responsiv layout', name: 'Alla sidor i ' + vp + ': ingen horisontell scroll, inga knappar utanför skärmen',
    async run(t) {
      const s = await t.world.session({ viewport: vp });
      await s.login('admin');
      const r = await sweep(t, s, vp, true);
      t.metric('medel renderingstid (' + vp + ', ms)', Math.round(r.times.reduce((a, b) => a + b, 0) / r.times.length));
      t.assert(r.problems.length === 0, r.problems.join(' || '));
    },
  });
});

module.exports = tests;
