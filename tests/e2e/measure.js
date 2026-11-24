'use strict';
/*
 * Mätning av informationstäthet och scrollavstånd (simulerad server, samma
 * demodata som visual.js). Skriver JSON till stdout.
 *
 *   node tests/e2e/measure.js [utfil.json]
 *
 * Per vy och bredd: sidans höjd (CSS-px), synlig höjd (fönster minus fast
 * bottenmeny), antal arbetsordrar som syns helt utan att scrolla och var
 * viktiga åtgärder ligger (y i CSS-px från sidans topp; "synlig" = inom
 * första skärmen utan scroll).
 */
const fs = require('fs');
const lib = require('./lib');

const SIZES = { w1920: 'desktop', w1366: 'laptop', w1024: 'w1024', w768: 'w768', w390: 'iphone', w360: 'android' };
const PROBES = {
  ao_lista: { page: 'pg-ao' },
  ao_detalj: { page: 'pg-ao-detail', params: { aoId: 'AO-007' } },
  dashboard: { page: 'pg-dash' },
  mina_jobb: { page: 'pg-myjobs', user: 'falt2' },
  ao_detalj_falt: { page: 'pg-ao-detail', params: { aoId: 'AO-015' }, user: 'falt2' },
};

function probeInPage() {
  const vh = window.innerHeight;
  const nav = document.getElementById('mobile-bottom-nav');
  const navH = nav && nav.offsetParent !== null ? nav.getBoundingClientRect().height : 0;
  const visibleH = vh - navH;
  const sc = document.getElementById('content-scroll');
  const page = document.querySelector('.page.active');
  const top0 = sc ? sc.getBoundingClientRect().top : 0;
  const scrollTop = sc ? sc.scrollTop : 0;
  const absY = (el) => Math.round(el.getBoundingClientRect().top - top0 + scrollTop + top0);
  const vis = (el) => !!el && el.offsetParent !== null && el.getBoundingClientRect().height > 0;
  const firstVisible = (sel, text) => [...document.querySelectorAll(sel)].find((e) => vis(e) && (!text || text.test((e.textContent || '').trim())));
  const out = { pageH: Math.round(page ? page.scrollHeight : 0), viewportH: vh, visibleH: Math.round(visibleH) };
  const rows = [...document.querySelectorAll('#ao-list [data-sel-row-id]')].filter(vis);
  if (rows.length) {
    out.aoRows = rows.length;
    out.firstRowY = absY(rows[0]);
    out.rowsFullyVisible = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= visibleH; }).length;
    out.avgRowH = Math.round(rows.reduce((a, r) => a + r.getBoundingClientRect().height, 0) / rows.length);
  }
  const mark = (name, el) => {
    if (!el) { out[name] = null; return; }
    const b = el.getBoundingClientRect();
    const sticky = getComputedStyle(el.closest('.aod-qbar') || el).position === 'sticky';
    out[name] = { y: absY(el), synlig: b.top >= 0 && b.bottom <= visibleH, fast: sticky };
  };
  mark('stampla', firstVisible('.page.active button', /^Stämpla (in|ut)$/));
  const chk = document.getElementById('ao-checklist');
  mark('checklista', chk ? (chk.closest('details') || chk) : null);
  mark('checklista_snabb', firstVisible('.page.active .aod-q', /^Checklista/));
  mark('material_snabb', firstVisible('.page.active .aod-q', /^Material/));
  const mat = document.getElementById('ao-materials');
  mark('material', mat ? (mat.closest('details') || mat) : null);
  const log = document.getElementById('ao-timeline');
  mark('logg', log ? (log.closest('.card') || log) : null);
  mark('starta_arbete', firstVisible('.page.active button', /^Starta( arbete)?$/));
  mark('vagbeskrivning', firstVisible('.page.active a', /Vägbeskrivning/));
  mark('krav_atgard', firstVisible('.page.active h3', /Kräver åtgärd/));
  return out;
}

(async () => {
  await lib.start();
  const res = {};
  for (const [label, vp] of Object.entries(SIZES)) {
    const world = new lib.World();
    const sessions = {};
    const get = async (user) => {
      if (sessions[user]) return sessions[user];
      const s = await world.session({ viewport: vp });
      await s.login(user);
      await s.page.addStyleTag({ content: '*{animation:none!important;transition:none!important} #toast{display:none!important}' });
      sessions[user] = s; return s;
    };
    for (const [id, p] of Object.entries(PROBES)) {
      try {
        const s = await get(p.user || 'admin');
        await s.eval(() => { try { Modal.close(); } catch (e) {} });
        await s.go(p.page, p.params || {});
        await s.settle(500);
        await s.eval(() => { const sc = document.getElementById('content-scroll'); if (sc) sc.scrollTop = 0; });
        (res[id] = res[id] || {})[label] = await s.eval(probeInPage);
      } catch (e) { (res[id] = res[id] || {})[label] = { fel: e.message.split('\n')[0] }; }
    }
    await world.close();
  }
  await lib.stop();
  const json = JSON.stringify(res, null, 1);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], json); else console.log(json);
})().catch((e) => { console.error(e); process.exit(1); });
