'use strict';
/* QA 2026-11-24 (fynd QA-P0-3, lagrad XSS): varje fritextfält som användare
   kan skriva i (kunder, fastigheter, kontakter, AO, logg, material, offerter,
   fakturor, personal, artiklar, aktiviteter, säljchanser, återkommande,
   projekt) fylls med HTML-/attribututbrytningar. Alla sidor rollen får se
   och detaljsidorna öppnas; ett test underkänns om NÅGOT skript körs.
   Simulerad server (ingen STAGING-trafik). */

/* Varje träff rapporterar fältet och var i DOM:en det landade (förälderns klass/id) — för att hitta sänkan. */
const WHERE = "(this.parentElement?((this.parentElement.id?'#'+this.parentElement.id:'')+'.'+String(this.parentElement.className).split(' ')[0]):'')";
const TAG = (f) => `<img src=x onerror="(window.__xss=window.__xss||[]).push('${f}@'+${WHERE})">"'><svg onload="(window.__xss=window.__xss||[]).push('${f}+a@'+${WHERE})">`;
const TEXT_FIELDS = ['name', 'firstName', 'lastName', 'companyName', 'title', 'description', 'address', 'city', 'note', 'notes', 'comment',
  'text', 'internalNote', 'contactName', 'reference', 'role', 'label', 'subject', 'message', 'propertyDesignation', 'objectName',
  'customerNote', 'workDescription', 'publicNote', 'unit', 'category', 'articleNumber', 'phone', 'email'];
const KEEP = new Set(['id', 'status', 'type', 'priority', 'role', 'unit', 'category', 'email', 'phone']); // strukturella fält som styr logik
const SKIP_KEYS = new Set(['roles', 'settings', 'titles', 'lastChanged']);

function poison(v, path) {
  if (Array.isArray(v)) return v.map((x, i) => poison(x, path + '[' + i + ']'));
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'string' && TEXT_FIELDS.includes(k) && !KEEP.has(k) && x.length < 400) out[k] = x + ' ' + TAG(path.split('[')[0] + '.' + k);
    else if (x && typeof x === 'object') out[k] = poison(x, path + '.' + k);
    else out[k] = x;
  }
  return out;
}

module.exports = [
  {
    id: 'XSS-01', module: 'Säkerhet', kind: 'ui', name: 'Lagrad XSS: inget skript körs när fritextfält innehåller HTML — alla sidor och detaljsidor för admin, arbetsledare (falt2 som fält), ekonomi',
    async run(t) {
      const fake = t.fake;
      for (const k of [...fake.store.keys()]) {
        const short = k.replace(/^vift_/, '');
        if (SKIP_KEYS.has(short)) continue;
        const v = fake.get(short);
        if (Array.isArray(v)) fake.set(short, poison(v, short));
      }
      const hits = [];
      for (const role of ['admin', 'falt', 'ekonomi']) {
        const s = await t.world.session({ viewport: role === 'falt' ? 'iphone' : 'laptop' });
        let dialogs = 0; s.page.on('dialog', (d) => { dialogs++; d.dismiss().catch(() => {}); });
        await s.login(role);
        const pages = await s.eval(() => Object.keys(Auth.PAGE_PERMISSIONS || {}).filter((p) => Auth.canViewPage(p)));
        const ids = await s.eval(() => ({
          ao: (state.workOrders || []).slice(0, 3).map((a) => a.id),
          cu: (state.customers || []).slice(0, 2).map((c) => c.id),
          off: (state.offers || []).slice(0, 2).map((o) => o.id),
          inv: (state.invoices || []).slice(0, 2).map((i) => i.id),
          prop: (state.properties || []).slice(0, 2).map((p) => p.id)
        }));
        const visits = pages.map((p) => [p, {}]);
        ids.ao.forEach((id) => visits.push(['pg-ao-detail', { aoId: id }]));
        ids.cu.forEach((id) => visits.push(['pg-crm-detail', { customerId: id }]));
        ids.off.forEach((id) => visits.push(['pg-offer-detail', { offerId: id }]));
        ids.inv.forEach((id) => visits.push(['pg-inv-detail', { invoiceId: id }]));
        ids.prop.forEach((id) => visits.push(['pg-obj-detail', { propId: id }]));
        for (const [p, params] of visits) {
          if (!(await s.eval((x) => Auth.canViewPage(x), p))) continue;
          await s.eval(() => { window.__xss = []; });
          await s.eval(([x, prm]) => { try { Router.showPage(x, prm); } catch (e) {} }, [p, params]);
          await s.settle(350);
          const got = await s.eval(() => window.__xss || []);
          if (got.length) hits.push(role + ' ' + p + (params && Object.values(params)[0] ? '(' + Object.values(params)[0] + ')' : '') + ': ' + [...new Set(got)].slice(0, 6).join(', '));
        }
        if (dialogs) hits.push(role + ': ' + dialogs + ' dialogrutor öppnades av injicerat skript');
        t.note(role + ': ' + visits.length + ' sidvisningar');
        await s.context.close();
      }
      t.assert(hits.length === 0, 'skript kördes från lagrad data: ' + hits.join(' ; '));
    }
  }
];
