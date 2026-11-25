'use strict';
/*
 * Behörigheter vid direkta serveranrop (inte bara dolda knappar).
 * kind 'contract': kontrollerar den SIMULERADE serverns EF-kontrakt. Efter KÄLLA-1 finns
 * EF-källorna i vift-v2/supabase; fake-backend följer dem (paritet, tests/sim_parity.test.js).
 * PERM-03 läser per-nyckel-regeln direkt ur store-key-write-källan. Samtliga ska ändå
 * upprepas mot STAGING med testkonton (D-26, efter separat GO).
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
    /* T3-C (2026-11-28, BLOCKER-2/G4): avblockerat. Per-nyckel-regeln läses ur den FAKTISKA
       serverkällan (KÄLLA-1: vift-v2 store-key-write/index.ts, KEY_PERMISSIONS, via
       tests/e2e/server-key-perms.js) — ingen antagen modell — och uppgiftsregeln är serverns
       egen activities-policy.ts (transpilerad). Felkoden är serverns: hasPerm saknas →
       RPC 'forbidden' → 403 {error:'forbidden'} utan reason. */
    world: { backend: { keyPerms: require('../server-key-perms.js'), activitiesPolicy: true, activityAppend: true } },
    name: 'Generiska nycklar (kunder, offerter, säljchanser, inställningar, att göra) per roll vid direktanrop mot store-key-write: serverns KEY_PERMISSIONS, exakt felkod och oförändrad data',
    async run(t) {
      const acts = t.fake.get('activities') || [];
      acts.push({ id: 'ACT-PERM03', type: 'task', title: 'Annans uppgift', assignedTo: 'ST-004', createdBy: 'ST-001', status: 'open', dueDate: new Date().toISOString().slice(0, 10), createdAt: new Date().toISOString() });
      t.fake.set('activities', acts);
      const NYCKLAR = ['offers', 'customers', 'activities', 'salesOpps', 'settings', 'articles'];
      const ks = () => JSON.stringify(NYCKLAR.map((k) => t.fake.get(k)));
      /* T3-D (2026-11-28): fält och ekonomi får inte längre andras uppgifter eller offerter i
         läsningen (urval per post), så direktanropen använder serverns faktiska poster — som en
         angripare som känner värdet. Nekandet prövas alltså lika hårt som förut. */
      const srv = () => ({ offers: (t.fake.get('offers') || [])[0], customers: (t.fake.get('customers') || [])[0], salesOpps: (t.fake.get('salesOpps') || [])[0],
        articles: (t.fake.get('articles') || [])[0], annan: (t.fake.get('activities') || []).find((a) => a.id === 'ACT-PERM03') });
      const direkt = (s) => s.eval(async (SRV) => {
        const call = async (body) => {
          const r = await fetch(SUPABASE_URL + '/functions/v1/store-key-write', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          let d = {}; try { d = await r.json(); } catch (e) {}
          return { status: r.status, error: d.error, reason: d.reason };
        };
        const las = async (key) => { const r = await fetch(SUPABASE_URL + '/functions/v1/store-key-write', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'readWithHash', key }) }); return r.json(); };
        const merge = async (key, patch) => { const el = SRV[key.slice(5)]; return call({ action: 'writeMerge', key, upserts: [{ id: el.id, previous: el, data: Object.assign({}, el, patch) }], removals: [] }); };
        const annan = SRV.annan;
        const inst = await las('vift_settings');
        return {
          offers_price: await merge('vift_offers', { total: 1, lines: [] }),
          customers: await merge('vift_customers', { name: 'Ändrad via direktanrop' }),
          activities_other: annan ? await call({ action: 'writeMerge', key: 'vift_activities', upserts: [{ id: annan.id, previous: annan, data: Object.assign({}, annan, { status: 'done' }) }], removals: [] }) : { status: 0 },
          salesOpps: await merge('vift_salesOpps', { title: 'Ändrad' }),
          settings_write: await call({ action: 'write', key: 'vift_settings', value: Object.assign({}, inst.value, { companyName: 'Kapat AB' }), expectedHash: inst.hash }),
          articles: await merge('vift_articles', { sellPrice: 1 }),
        };
      }, srv());
      const NEKAT = (r) => r.status === 403 && r.error === 'forbidden' && r.reason === undefined;
      // Fältarbetare (personal): saknar alla nycklarnas skrivbehörighet.
      const f = await t.world.session({ viewport: 'laptop' });
      await f.login('falt');
      let fore = ks();
      let res = await direkt(f);
      t.note('fält: ' + JSON.stringify(res));
      /* T3-D (D-15, felkodskatalogen): annans uppgift nekas nu med orsaken not_own; övriga nycklar
         saknar behörighet helt (403 forbidden utan reason). */
      const NOT_OWN = (r) => r.status === 403 && r.error === 'forbidden' && r.reason === 'not_own';
      const nekadeUtomUppgift = (r) => Object.entries(r).every(([k, v]) => (k === 'activities_other' ? NOT_OWN(v) : NEKAT(v)));
      t.assert(nekadeUtomUppgift(res), 'fält: alla sex direktanrop nekas med exakt 403 forbidden (utan reason; annans uppgift med reason not_own, T3-D), som serverns hasPerm/KEY_PERMISSIONS och activities-policy.ts: ' + JSON.stringify(res));
      t.assert(ks() === fore, 'fält: offerter, kunder, uppgifter, säljchanser, inställningar och artiklar är oförändrade (kontrollsumma)');
      t.assert(!(await f.eval(() => (state.activities || []).some((a) => a.id === 'ACT-PERM03'))), 'T3-D (SÄK-2): fältets klient har inte fått annans uppgift (urval per post)');
      // Ekonomi: inte customer_manage/offer_manage/sales_manage/admin_manage/article_manage.
      const e = await t.world.session({ viewport: 'laptop' });
      await e.login('ekonomi');
      fore = ks();
      res = await direkt(e);
      t.assert(nekadeUtomUppgift(res) && ks() === fore, 'ekonomi: samma sex direktanrop nekas med 403 forbidden (annans uppgift: not_own, D-15/SEC-CUST-21), ingen mutation: ' + JSON.stringify(res));
      // Arbetsledare (chef): customer_manage, offer_manage, sales_manage men inte admin_manage/article_manage.
      const c = await t.world.session({ viewport: 'laptop' });
      await c.login('chef');
      const forSettings = JSON.stringify(t.fake.get('settings')), forArticles = JSON.stringify(t.fake.get('articles'));
      res = await direkt(c);
      t.note('arbetsledare: ' + JSON.stringify(res));
      t.assert(res.customers.status === 200 && res.offers_price.status === 200 && res.salesOpps.status === 200, 'arbetsledare: kunder, offerter och säljchanser godtas (customer_manage, offer_manage, sales_manage)');
      t.assert(NEKAT(res.settings_write) && NEKAT(res.articles), 'arbetsledare: inställningar (admin_manage) och artiklar (article_manage) nekas med 403 forbidden');
      t.assert(res.activities_other.status === 200, 'arbetsledare: annans uppgift godtas — serverns activities-policy.ts ger ao_edit + ao_view_all full rätt (activitiesFullAccess)');
      t.assert(JSON.stringify(t.fake.get('settings')) === forSettings && JSON.stringify(t.fake.get('articles')) === forArticles, 'arbetsledare: inställningar och artiklar oförändrade');
      t.assert((t.fake.get('customers') || [])[0].name === 'Ändrad via direktanrop', 'arbetsledarens kundändring sparad på servern');
    },
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
