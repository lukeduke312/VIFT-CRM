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
];
