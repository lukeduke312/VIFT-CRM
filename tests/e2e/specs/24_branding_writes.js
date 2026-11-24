'use strict';
/* QA 2026-11-25: färgväljaren i Admin → Företag sparade hela vift_settings vid
   varje input-händelse (23 skrivningar på 15 s observerade i STAGING). Nu:
   förhandsvisning utan skrivning medan man drar, exakt EN sparning vid change,
   ingen sparning om värdet är oförändrat. Simulerad server. */
module.exports = [{
  id: 'BRAND-01', module: 'Administration', kind: 'ui',
  name: 'Färgväljaren: drag (input) skriver inget till servern, valt värde (change) sparas exakt en gång, oförändrat värde sparas inte',
  async run(t) {
    const s = await t.world.session({ viewport: 'laptop' });
    await s.login('admin');
    await s.go('pg-admin'); await s.settle(300);
    await s.eval(() => { AdminPage._tab = 'foretag'; AdminPage.render(); }); await s.settle(300);
    const writes = () => t.fake.calls.filter((c) => c.method === 'POST' && /store-key-write:write/.test(c.action || '') && c.key === 'vift_settings').length;
    const w0 = writes();
    await s.eval(() => {
      const el = document.querySelector('.page.active input[type=color]');
      ['#112233', '#223344', '#334455', '#445566', '#556677', '#667788', '#778899', '#8899aa', '#99aabb', '#aabbcc'].forEach((c) => { el.value = c; el.dispatchEvent(new Event('input', { bubbles: true })); });
    });
    await s.settle(800);
    const preview = await s.eval(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim());
    const wDrag = writes() - w0;
    await s.eval(() => { const el = document.querySelector('.page.active input[type=color]'); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await s.settle(1200);
    const wChange = writes() - w0;
    await s.eval(() => { const el = document.querySelector('.page.active input[type=color]'); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await s.settle(800);
    const wSame = writes() - w0;
    const saved = (t.fake.get('settings') || {}).primaryColor;
    t.note('skrivningar: drag ' + wDrag + ', efter change ' + wChange + ', efter oförändrad change ' + wSame + '; förhandsvisning ' + preview + '; sparat ' + saved);
    t.assert(wDrag === 0, 'drag ska inte skriva (fick ' + wDrag + ')');
    t.assert(preview.toLowerCase() === '#aabbcc', 'förhandsvisning under drag (fick ' + preview + ')');
    t.assert(wChange === 1 && saved === '#aabbcc', 'exakt en sparning med valt värde (fick ' + wChange + ', ' + saved + ')');
    t.assert(wSame === 1, 'oförändrat värde sparas inte igen (fick ' + wSame + ')');
  }
}];
