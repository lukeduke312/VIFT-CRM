'use strict';
/* QA 2026-11-26 — Serviceintervall (pg-service-intervals).
   Fel i STAGING: sökfältets placeholder innehöll ic()-SVG inne i attributet,
   vilket bröt input-taggen så att attribut och SVG syntes som text; sökningen
   renderade om hela sidan vid varje tangent (fokus förlorades); kort blev
   mörka med mörk text i mörkt OS-läge (@media prefers-color-scheme utan tema).
   Seed-datan saknar serviceintervall — testet lägger in egna. Simulerad server. */
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const SI = (id, title, extra) => Object.assign({ id, title, category: 'filterbyte', intervalType: 'quarterly', intervalValue: 1, lastDone: day(-80), nextDue: day(10), responsibleStaffId: '', supplier: '', active: true, autoCreateAO: false, reminderDays: 14, history: [] }, extra || {});

function seed(t) {
  const props = t.fake.get('properties');
  props[0].serviceIntervals = [
    SI('SI-A', 'Filterbyte aggregat 1', { nextDue: day(-3), supplier: 'Ventilationsbolaget' }),
    SI('SI-B', 'OVK besiktning', { category: 'ovk', intervalType: 'biennial', nextDue: day(4), history: [{ id: 'H1', date: day(-700), by: 'Test', comment: 'OK' }] }),
  ];
  props[1].serviceIntervals = [
    SI('SI-C', 'Brandkontroll trapphus', { category: 'brandkontroll', nextDue: day(60) }),
    SI('SI-D', 'Pausad kontroll', { active: false, nextDue: day(30) }),
  ];
  t.fake.set('properties', props);
}

function lum(c) { const m = c.match(/\d+(\.\d+)?/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); }
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

module.exports = [{
  id: 'SVC-UI-01', module: 'Serviceintervall', kind: 'ui',
  name: 'Serviceintervall: sökfältet renderas korrekt (ingen markup/attribut som text), sökning behåller fokus och filtrerar, statusfilter räknar rätt, åtgärder med text, läsbart även i mörkt OS-läge, mobil utan överflöd',
  async run(t) {
    seed(t);
    for (const [vp, scheme] of [['laptop', 'light'], ['iphone', 'dark'], ['android', 'light']]) {
      const s = await t.world.session({ viewport: vp });
      await s.page.emulateMedia({ colorScheme: scheme });
      await s.login('admin');
      await s.go('pg-service-intervals'); await s.settle(400);
      const r = await s.eval(() => {
        const pg = document.querySelector('.page.active');
        const txt = pg.innerText;
        const inp = pg.querySelector('#si2-q');
        return {
          broken: /\b(on[a-z]+|value|placeholder|xmlns|viewBox)=["']|<svg|<path/i.test(txt),
          placeholder: inp ? inp.getAttribute('placeholder') : null,
          cards: pg.querySelectorAll('.si2-card').length,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          actions: [...pg.querySelectorAll('.si2-card')[0].querySelectorAll('.si2-actions button')].map((b) => b.textContent.trim()),
        };
      });
      t.assert(!r.broken, vp + ': ingen markup eller attributfragment som synlig text');
      t.assert(r.placeholder && !r.placeholder.includes('<'), vp + ': placeholder är ren text (' + r.placeholder + ')');
      t.assert(r.cards === 4, vp + ': fyra kort (fick ' + r.cards + ')');
      t.assert(!r.overflow, vp + ': inget horisontellt överflöd');
      t.assert(r.actions.every((x) => x.length > 0) && r.actions.some((x) => /Markera utförd/.test(x)) && r.actions.some((x) => /Redigera/.test(x)), vp + ': åtgärder har text (' + r.actions.join(' | ') + ')');
      // Kontrast kort: text mot bakgrund, även i mörkt OS-läge
      const cc = await s.eval(() => { const c = document.querySelector('.si2-card'); const t = c.querySelector('.si2-title'); return { bg: getComputedStyle(c).backgroundColor, fg: getComputedStyle(t).color }; });
      const ratio = contrast(cc.fg, cc.bg);
      t.assert(ratio >= 4.5, vp + '/' + scheme + ': korttitelns kontrast ' + ratio.toFixed(1) + ':1 (' + cc.fg + ' på ' + cc.bg + ')');
      if (vp === 'laptop') {
        // Sökning: skriv tecken för tecken — fokus kvar, listan filtreras, fältet behåller värdet
        await s.page.click('#si2-q');
        await s.page.keyboard.type('brand', { delay: 40 });
        await s.settle(400);
        const q = await s.eval(() => ({ focus: document.activeElement && document.activeElement.id, val: document.getElementById('si2-q').value, cards: document.querySelectorAll('.si2-card').length, count: (document.querySelector('.si2-count') || {}).textContent }));
        t.assert(q.focus === 'si2-q' && q.val === 'brand', 'sökfältet behåller fokus och hela värdet (' + q.focus + ', "' + q.val + '")');
        t.assert(q.cards === 1 && /Visar 1 av 4/.test(q.count || ''), 'sökning filtrerar till 1 av 4 (' + q.cards + ', ' + q.count + ')');
        await s.page.fill('#si2-q', ''); await s.page.keyboard.type('x'); await s.page.keyboard.press('Backspace'); await s.settle(400);
        // Statusfilter: Förfallna = 1, Pausade = 1
        await s.eval(() => ServiceIntervalsPage._fApply({ status: 'overdue' })); await s.settle(200);
        const od = await s.eval(() => [...document.querySelectorAll('.si2-card .si2-title')].map((e) => e.textContent));
        t.assert(od.length === 1 && od[0] === 'Filterbyte aggregat 1', 'Förfallna visar bara det förfallna (' + od.join(',') + ')');
        await s.eval(() => ServiceIntervalsPage._fApply({ status: 'paused' })); await s.settle(200);
        const pa = await s.eval(() => ({ n: document.querySelectorAll('.si2-card').length, btn: [...document.querySelectorAll('.si2-card .si2-actions button')].map((b) => b.textContent.trim()) }));
        t.assert(pa.n === 1 && pa.btn.some((x) => /Återuppta/.test(x)) && !pa.btn.some((x) => /Markera utförd/.test(x)), 'Pausad: "Återuppta" finns, "Markera utförd" inte (' + pa.btn.join(' | ') + ')');
        await s.eval(() => ServiceIntervalsPage._fApply({ status: 'all' })); await s.settle(200);
        // Markera utförd öppnar dialogen; Redigera öppnar dialogen; Historik öppnar dialogen
        for (const [fn, re] of [['markDone', /utförd/i], ['editInterval', /Redigera|intervall/i]]) {
          await s.eval((f) => ServiceIntervalsPage[f](getObj(state.properties[0].id) ? state.properties[0].id : '', 'SI-A'), fn);
          await s.settle(300);
          const m = await s.eval(() => (document.querySelector('.modal-overlay.open') || {}).innerText || '');
          t.assert(re.test(m), fn + ' öppnar dialog (' + m.slice(0, 60).replace(/\s+/g, ' ') + ')');
          await s.eval(() => Modal.close()); await s.settle(150);
        }
        // Pausa/återuppta påverkar bara status (historiken orörd)
        const h0 = await s.eval(() => JSON.stringify((state.properties[0].serviceIntervals || []).find((x) => x.id === 'SI-B').history));
        await s.eval(() => ServiceIntervalsPage.togglePaused(state.properties[0].id, 'SI-B')); await s.settle(300);
        await s.eval(() => ServiceIntervalsPage.togglePaused(state.properties[0].id, 'SI-B')); await s.settle(300);
        const h1 = await s.eval(() => { const x = (state.properties[0].serviceIntervals || []).find((y) => y.id === 'SI-B'); return { h: JSON.stringify(x.history), active: x.active }; });
        t.assert(h1.h === h0 && h1.active === true, 'pausa + återuppta: aktiv igen, historik oförändrad');
      }
      await s.context.close();
    }
  }
}];
