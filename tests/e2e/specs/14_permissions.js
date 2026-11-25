'use strict';
/*
 * Behörigheter vid direkta serveranrop (inte bara dolda knappar).
 * kind 'contract': kontrollerar den SIMULERADE serverns modell av EF-
 * kontrakten. Modellen bygger på klientens dokumenterade kontrakt; de
 * riktiga EF-källorna (ao-time-write, store-key-write m.fl.) finns inte i
 * repot (gap G4). Samtliga måste upprepas mot STAGING med testkonton.
 */
async function call(s, fn, body) {
  return s.eval(async ([f, b]) => {
    const r = await fetch(SUPABASE_URL + '/functions/v1/' + f, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_AKEY, Authorization: 'Bearer ' + Auth.getAccessToken() }, body: JSON.stringify(b) });
    let d = {}; try { d = await r.json(); } catch (e) {}
    return { status: r.status, error: d && d.error, reason: d && d.reason, aos: Array.isArray(d.workOrders) ? d.workOrders : null, n: Array.isArray(d.workOrders) ? d.workOrders.length : (Array.isArray(d.timeEntries) ? d.timeEntries.length : null), ids: Array.isArray(d.workOrders) ? d.workOrders.map((a) => a.id) : null, staff: Array.isArray(d.timeEntries) ? [...new Set(d.timeEntries.map((e) => e.staffId))] : null };
  }, [fn, body]);
}
const key = () => 'perm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

module.exports = [
  {
    id: 'PERM-01', kind: 'contract', module: 'Användarroller och behörigheter', name: 'Fältarbetare: direktanrop mot annans AO, faktura, roller, portkod och andras tid nekas av servern',
    async run(t) {
      const s = await t.world.session();
      await s.login('falt'); // ST-002
      const others = await call(s, 'ao-time-write', { action: 'patch_ao', aoId: 'AO-007', patch: { title: 'kapad' }, idempotencyKey: key() });
      t.assert(others.status === 403, 'patch på annans AO (AO-007) nekas: ' + JSON.stringify(others));
      t.assert(t.fake.get('workOrders').find((a) => a.id === 'AO-007').title !== 'kapad', 'AO-007 oförändrad');
      const list = await call(s, 'work-orders-list', {});
      t.assert(list.ids && !list.ids.includes('AO-007') && list.ids.includes('AO-001'), 'AO-listan innehåller bara egna (' + (list.ids || []).join(',') + ')');
      const inv = await call(s, 'invoice-write', { action: 'lineAdd', invoiceId: 'INV-003', line: { description: 'x', qty: 1, unitPrice: -5000, vatRate: 25 } });
      t.assert(inv.status === 403, 'fakturarad nekas: ' + JSON.stringify(inv));
      const esc = await call(s, 'store-key-write', { action: 'writeMerge', key: 'vift_roles', upserts: [{ id: 'personal', data: { id: 'personal', label: 'x', permissions: ['all'] }, previous: t.fake.get('roles').find((r) => r.id === 'personal') }] });
      t.assert(esc.status === 403, 'självupphöjning via roller nekas: ' + JSON.stringify(esc));
      const sens = await call(s, 'get-sensitive-fields', { propertyId: 'OBJ-001' });
      t.assert(sens.status === 403, 'portkod nekas: ' + JSON.stringify(sens));
      const te = await call(s, 'time-entries-list', {});
      t.assert(te.staff && te.staff.every((x) => x === 'ST-002'), 'bara egna tidposter: ' + JSON.stringify(te.staff));
      const att = await call(s, 'ao-time-write', { action: 'attest_time', entryId: t.fake.get('timeEntries')[0].id, attested: true, idempotencyKey: key() });
      t.assert(att.status === 403, 'attestering nekas: ' + JSON.stringify(att));
    },
  },
  {
    id: 'PERM-02', kind: 'contract', module: 'Användarroller och behörigheter', name: 'Arbetsledare (utan lön/portkod) och begränsad AO-användare: servern nekar det rollen saknar',
    async run(t) {
      const c = await t.world.session();
      await c.login('chef'); // ST-003, saknar payroll_view och objects_sensitive
      const te = await call(c, 'time-entries-list', {});
      t.assert(te.staff && te.staff.every((x) => x === 'ST-003'), 'arbetsledaren får bara egna tidposter (ingen lönebehörighet): ' + JSON.stringify(te.staff));
      const sens = await call(c, 'get-sensitive-fields', { propertyId: 'OBJ-001' });
      t.assert(sens.status === 403, 'arbetsledaren nekas portkod: ' + JSON.stringify(sens));
      const b = await t.world.session();
      await b.login('begransad'); // ST-005: dashboard_view, ao_view_own
      const ct = await call(b, 'ao-time-write', { action: 'create_time', entry: { id: 'TE-PERM-1', aoId: 'AO-014', staffId: 'ST-005', date: '2026-11-20', minutes: 60 }, idempotencyKey: key() });
      t.assert(ct.status === 403, 'begränsad användare kan inte registrera tid: ' + JSON.stringify(ct));
      const ca = await call(b, 'ao-time-write', { action: 'create_ao', ao: { id: 'AO-PERM-1', title: 'x' }, idempotencyKey: key() });
      t.assert(ca.status === 403, 'begränsad användare kan inte skapa AO: ' + JSON.stringify(ca));
      const list = await call(b, 'work-orders-list', {});
      /* T3-B (SÄK-3, D-04, SEC-POOL-03): bara ao_view_own ger egna tilldelade AO — INTE
         öppen pool (kräver ao_pool_take) och aldrig pool med annans personal. Skärpt från
         den tidigare regeln "egna AO och poolen". */
      const allAo = t.fake.get('workOrders');
      const leaked = (list.ids || []).filter((id) => { const a = allAo.find((x) => x.id === id); return !(a.staff || []).includes('ST-005'); });
      t.assert(list.ids && list.ids.includes('AO-014') && leaked.length === 0, 'begränsad ser bara egna AO, ingen öppen pool (läckta: ' + leaked.join(',') + ')');
      // Fältet (ao_pool_take): öppen pool i begränsad projektion; pool med annans personal, arkiverad och borttagen pool syns inte.
      const aos = t.fake.get('workOrders');
      aos.push({ id: 'AO-PERM-P2', title: 'Pool med annans personal', status: 'pool', staff: ['ST-004'], phone: '070-1', log: [] },
        { id: 'AO-PERM-P5', title: 'Arkiverad pool', status: 'pool', staff: [], archived: true, log: [] },
        { id: 'AO-PERM-P6', title: 'Borttagen pool', status: 'pool', staff: [], deleted: true, log: [] },
        { id: 'AO-PERM-P1', title: 'Öppen pool', status: 'pool', staff: [], phone: '070-2', contactEmail: 'k@example.test', accessCode: '1234', fixedPrice: 999, log: [{ id: 'L1', text: 'hemlig' }], description: 'Arbete' });
      t.fake.set('workOrders', aos);
      const f = await t.world.session();
      await f.login('falt'); // ST-002, personal (ao_pool_take)
      const fl = await call(f, 'work-orders-list', {});
      const fIds = fl.ids || [];
      t.assert(!fIds.includes('AO-PERM-P2') && !fIds.includes('AO-PERM-P5') && !fIds.includes('AO-PERM-P6'), 'SEC-POOL-02: fältet ser inte pool med annans personal, arkiverad eller borttagen pool (' + fIds.filter((x) => /PERM-P/.test(x)).join(',') + ')');
      const p1 = (fl.aos || []).find((a) => a.id === 'AO-PERM-P1');
      t.assert(!!p1 && p1.poolProjection === true && !('phone' in p1) && !('contactEmail' in p1) && !('accessCode' in p1) && !('fixedPrice' in p1) && p1.log.length === 0, 'SEC-POOL-04 (K-03): öppen pool i begränsad projektion: ' + JSON.stringify(p1 && Object.keys(p1)));
      const tp = await call(b, 'ao-time-write', { action: 'take_from_pool', aoId: 'AO-PERM-P1', idempotencyKey: key() });
      t.assert(tp.status === 403 && tp.error === 'forbidden', 'SEC-POOL-10: begränsad kan inte ta jobb: ' + JSON.stringify(tp));
      const t2 = await call(f, 'ao-time-write', { action: 'take_from_pool', aoId: 'AO-PERM-P2', idempotencyKey: key() });
      t.assert(t2.status === 409 && t2.error === 'already_assigned' && JSON.stringify(t.fake.get('workOrders').find((a) => a.id === 'AO-PERM-P2').staff) === '["ST-004"]', 'SEC-POOL-06: tagning av pool med personal → 409 already_assigned, ingen mutation: ' + JSON.stringify(t2));
      const e = await t.world.session();
      await e.login('ekonomi');
      const eao = await call(e, 'ao-time-write', { action: 'create_ao', ao: { id: 'AO-PERM-2', title: 'x' }, idempotencyKey: key() });
      t.assert(eao.status === 403, 'ekonomi (utan ao_create) kan inte skapa AO: ' + JSON.stringify(eao));
    },
  },
  {
    id: 'PERM-03', kind: 'contract', module: 'Användarroller och behörigheter',
    name: 'Generiska nycklar (kunder, offerter, säljchanser, att göra) per roll vid direktanrop mot store-key-write',
    blocked: 'Kan inte verifieras mot simulerad backend: store-key-write:s per-nyckel-behörighet för generiska nycklar är okänd (källan finns inte i repot, G4; BLOCKER-2 i PROJECT_STATUS). Den simulerade servern tillåter alla inloggade här — det vore att testa en antagen modell. Måste köras mot STAGING: fältarbetare försöker writeMerge på vift_offers (prisändring), vift_customers och vift_activities (annans uppgift).',
  },
  {
    id: 'PERM-04', module: 'Användarroller och behörigheter', name: 'Sidåtkomst per roll (6 roller × alla sidor): otillåten sida nekas med besked, tillåten sida öppnas utan fel',
    async run(t) {
      const roles = { admin: null, chef: null, falt: null, ekonomi: null, begransad: null, falt2: null };
      for (const alias of Object.keys(roles)) {
        const s = await t.world.session({ viewport: 'laptop' });
        await s.login(alias);
        const res = await s.eval(async () => {
          const out = { ok: [], denied: [], broken: [] };
          const pages = Object.keys(Auth.PAGE_PERMISSIONS || {}).filter((p) => !/detail|utfor|rapport|wizard|propobj/.test(p));
          for (const p of pages) {
            window.__toasts = [];
            const allowed = Auth.canViewPage(p);
            try { Router.showPage(p, {}); } catch (e) { out.broken.push(p + ': ' + e.message); continue; }
            await new Promise((r) => setTimeout(r, 60));
            const active = document.querySelector('.page.active');
            const onPage = active && active.id === p;
            if (allowed && !onPage) out.broken.push(p + ' tillåten men visades inte');
            else if (!allowed && onPage) out.broken.push(p + ' otillåten men visades');
            else (allowed ? out.ok : out.denied).push(p);
          }
          return out;
        });
        t.note(alias + ': ' + res.ok.length + ' tillåtna, ' + res.denied.length + ' nekade');
        t.assert(res.broken.length === 0, alias + ': ' + res.broken.join('; '));
      }
    },
  },
];
