'use strict';
/* Klientens beteende mot STAGING:s faktiska skrivregler per nyckel
   (store-key-write v3, KEY_PERMISSIONS — källa i STAGING-repots
   _staging_integration/server/candidate/20261117/store-key-write/index.ts,
   installerad 2026-11-17 enligt DEPLOY_RESULT_20261117.md). */
const STAGING_KEY_PERMS = require('../staging-key-perms.js');
module.exports = [
  {
    id: 'STG-01', world: { backend: { keyPerms: STAGING_KEY_PERMS } }, module: 'Sparning och synk', name: 'STAGING-regler: fältarbetarens aktivitetsloggpost nekas av servern (admin_manage) — ingen återkommande falsk varning; en nekad ändring av användarens egna data varnar fortfarande',
    async run(t) {
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('falt2');
      await s.go('pg-myjobs');
      await s.settle(500);
      const toasts = () => s.eval(() => { const el = document.getElementById('toast'); return el && el.classList.contains('show') ? el.textContent : ''; });
      // Tre vanliga åtgärder som loggas i aktivitetsloggen.
      const seen = [];
      for (let i = 0; i < 3; i++) {
        await s.eval((n) => ActivityService.log('work_order_updated', 'E2E-åtgärd ' + n, { workOrderId: 'AO-015' }), i);
        await s.settle(1200);
        seen.push(await toasts());
        await s.settle(5200);
      }
      const rejected = t.fake.calls.filter((c) => c.key === 'vift_activityLog' && c.status === 403).length;
      t.note('aktivitetslogg-skrivningar nekade av servern: ' + rejected + '; toasts: ' + JSON.stringify(seen));
      t.assert(rejected >= 1, 'servern nekar fältarbetarens aktivitetslogg (som STAGING v3)');
      t.assert(seen.every((x) => !/aktivitetslogg/i.test(x)), 'ingen varning om aktivitetsloggen till fältarbetaren');
      // Negativ kontroll: en nekad ändring av egna data (kund) ska fortfarande varna.
      await s.eval(() => { state.customers[0].notes = 'E2E-otillåten'; persist(); });
      await s.settle(1500);
      const w = await toasts();
      t.assert(/kunder/.test(w), 'nekad kundändring varnar fortfarande: "' + w + '"');
    },
    timeout: 120000,
  },
  {
    id: 'TASK-02', world: { backend: { keyPerms: STAGING_KEY_PERMS, activitiesPolicy: true, activityAppend: true } }, module: 'Att göra', name: 'TASK-01-rättningen (per-post-regel): fältarbetaren klarmarkerar sin tilldelade uppgift mot STAGING-regler; direktanrop mot annans uppgift, förfalskad ny uppgift åt annan och radering av annans uppgift nekas av servern',
    async run(t) {
      const acts = t.fake.get('activities') || [];
      const base = { type: 'task', dueDate: new Date().toISOString().slice(0, 10), status: 'open', createdAt: new Date().toISOString(), completedAt: null, completedBy: null };
      acts.push(Object.assign({ id: 'ACT-E2E-MINE', title: 'Min uppgift E2E', assignedTo: 'ST-004', createdBy: 'ST-001' }, base));
      acts.push(Object.assign({ id: 'ACT-E2E-OTHER', title: 'Annans uppgift E2E', assignedTo: 'ST-002', createdBy: 'ST-001' }, base));
      t.fake.set('activities', acts);
      const f = await t.world.session({ viewport: 'iphone' });
      await f.login('falt2');
      await f.go('pg-activities');
      await f.settle(500);
      await f.eval(() => ActivitiesPage.toggleComplete('ACT-E2E-MINE'));
      await f.settle(1500);
      const mine = t.fake.get('activities').find((x) => x.id === 'ACT-E2E-MINE');
      t.assert(mine.status === 'done' && mine.completedBy === 'ST-004', 'egen tilldelad uppgift klarmarkerad på servern');
      const res = await f.eval(async () => {
        const call = (body) => fetch(SUPABASE_URL + '/functions/v1/store-key-write', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
        const other = state.activities.find((a) => a.id === 'ACT-E2E-OTHER');
        return {
          complete_other: await call({ action: 'writeMerge', key: 'vift_activities', upserts: [{ id: other.id, previous: other, data: Object.assign({}, other, { status: 'done', completedBy: 'ST-004' }) }], removals: [] }),
          forge_new: await call({ action: 'writeMerge', key: 'vift_activities', upserts: [{ id: 'ACT-E2E-FORGED', previous: null, data: { id: 'ACT-E2E-FORGED', title: 'X', assignedTo: 'ST-002', createdBy: 'ST-004', status: 'open' } }], removals: [] }),
          delete_other: await call({ action: 'writeMerge', key: 'vift_activities', upserts: [], removals: [{ id: other.id, previous: other }] }),
          full_write: await call({ action: 'write', key: 'vift_activities', value: [], expectedHash: null }),
        };
      });
      t.note('direktanrop: ' + JSON.stringify(res));
      t.assert(Object.values(res).every((x) => x === 403), 'servern nekar alla fyra direktanrop (403)');
      const other = t.fake.get('activities').find((x) => x.id === 'ACT-E2E-OTHER');
      t.assert(other && other.status === 'open' && !t.fake.get('activities').some((x) => x.id === 'ACT-E2E-FORGED'), 'annans uppgift orörd, ingen förfalskad post');
    },
  },
  {
    id: 'ACT-01', world: { backend: { keyPerms: STAGING_KEY_PERMS, activityAppend: true } }, module: 'Aktivitetslogg', name: 'Serverstyrd aktivitetslogg: fältarbetarens händelser sparas en och en (appendActivity) med servern som källa för användare och tid; hela listan skickas aldrig; generisk skrivning av loggen nekas (append-only)',
    async run(t) {
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('falt2');
      await s.go('pg-myjobs');
      await s.settle(500);
      await s.eval(() => { ActivityService.log('work_order_updated', 'E2E händelse 1', { workOrderId: 'AO-015' }); ActivityService.log('time_entry_created', 'E2E händelse 2', { workOrderId: 'AO-015' }); });
      await s.settle(2000);
      const log = t.fake.get('activityLog') || [];
      const mine = log.filter((e) => /E2E händelse/.test(e.description));
      t.note('poster: ' + JSON.stringify(mine.map((e) => [e.type, e.userId, e.serverVerified])));
      t.assert(mine.length === 2 && mine.every((e) => e.userId === 'ST-004' && e.serverVerified === true), 'båda händelserna sparade med serverns userId');
      t.assert(!t.fake.calls.some((c) => c.key === 'vift_activityLog' && /writeMerge|write/.test(c.action || '')), 'hela aktivitetsloggen skickas aldrig');
      const forged = await s.eval(async () => (await fetch(SUPABASE_URL + '/functions/v1/store-key-write', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'appendActivity', entry: { id: 'ACT-1795000000000-forged01', type: 'påhittad_typ', description: 'x' } }) })).json());
      t.assert(forged.error === 'invalid_type', 'okänd händelsetyp nekas: ' + JSON.stringify(forged));
      const a = await t.world.session(); await a.login('admin'); await a.settle(500);
      const st = await a.eval(async () => (await fetch(SUPABASE_URL + '/functions/v1/store-key-write', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'writeMerge', key: 'vift_activityLog', upserts: [], removals: [] }) })).status);
      t.assert(st === 403, 'även admin nekas generisk skrivning av aktivitetsloggen (append-only): ' + st);
    },
  },
  {
    id: 'AO-07D', world: { backend: { logOps: true } }, module: 'Arbetsorderloggar', name: 'work-order-log-write: servern stämplar staffId; annans loggpost kan inte tas bort utan ao_edit (direktanrop); egen kan; ingen hel-array-patch',
    async run(t) {
      const a = await t.world.session(); await a.login('falt2');
      await a.go('pg-ao-detail', { aoId: 'AO-007' });
      await a.page.waitForFunction(() => WorkOrderDetailPage.aoId === 'AO-007', null, { timeout: 8000 });
      await a.eval(() => WorkOrderDetailPage.openAddLog());
      await a.page.waitForSelector('.modal-overlay.open #log-text');
      await a.page.fill('#log-text', 'E2E egen post');
      await a.clickModalButton(/Spara/);
      await a.waitToast(/Loggpost sparad/, 8000);
      const log = t.fake.get('workOrders').find((x) => x.id === 'AO-007').log;
      const mine = log.find((l) => l.text === 'E2E egen post');
      t.assert(mine && mine.staffId === 'ST-004', 'servern stämplade staffId');
      t.assert(!t.fake.calls.some((c) => c.action === 'ao-time-write:patch_ao' && c.hasLog), 'ingen patch_ao med hel logg');
      const legacy = log.find((l) => !l.staffId);
      const r = await a.eval(async (id) => (await fetch(SUPABASE_URL + '/functions/v1/work-order-log-write', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove_log', aoId: 'AO-007', entryId: id }) })).json(), legacy && legacy.id);
      t.assert(!legacy || r.error === 'forbidden_other', 'äldre/annans post: borttagning nekas för fältarbetare: ' + JSON.stringify(r));
      await a.eval((id) => WorkOrderDetailPage.deleteLogEntry(id), mine.id);
      await a.clickModalButton(/Bekräfta/);
      await a.waitToast(/Loggpost borttagen/, 8000);
      t.assert(!t.fake.get('workOrders').find((x) => x.id === 'AO-007').log.some((l) => l.id === mine.id), 'egen post borttagen');
    },
  },
];
