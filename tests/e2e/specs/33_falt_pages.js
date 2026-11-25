'use strict';
/* Fältsidorna (QA 2026-11-26): Mina jobb, Tid & stämpla, Dagens drift och
   Återkommande. Funktionella regressionstester för omarbetningen —
   gruppering, stämplingens tillstånd, valideringar, nyckeltal mot data,
   svenska format, F-12 (singular/plural) och layout 360–1920 med
   realistiskt innehåll (många jobb samma dag, långa adresser, pausade
   jobb, pågående stämpling). Simulerad server. */

const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => ymd(new Date());
const plusDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
const F2 = 'falt2@example.test';

/* Realistiskt innehåll i den simulerade servern (före inloggning). */
function richData(fake) {
  const t = today();
  const d = (n) => plusDays(t, n);
  const LONG = 'Kungsholmsgatan 123 B, uppgång 4, lägenhet 1402 – gårdshuset, källardörren till vänster om tvättstugan';
  const base = (o) => Object.assign({
    description: '', customerId: 'K-001', propertyId: '', address: 'Solvägen 1A', contactPerson: '', phone: '',
    status: 'planerad', priority: 'normal', category: 'underhall', priceType: 'timpris', fixedPrice: 0, priceGroupId: 'PG-001',
    staff: ['ST-004'], scheduledDate: '', scheduledStart: '', scheduledEnd: '', estimatedHours: 0,
    checklist: [], materials: [], notes: [], timeEntries: [], invoiceId: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }, o);
  const wos = fake.get('workOrders');
  const add = [];
  const times = ['07:00', '07:30', '08:15', '09:00', '10:30', '11:45', '13:00', '14:30', '15:15', '16:00'];
  times.forEach((st, i) => add.push(base({
    id: 'AO-R' + (100 + i), title: i === 2 ? 'Byte av samtliga termostatventiler i trapphus A–D samt injustering av värmesystemet efter klagomål från flera hyresgäster' : 'Fältjobb ' + (i + 1) + ' – ' + ['Läckande blandare', 'Byte lysrör', 'Stopp i avlopp', 'Kontroll brandlarm', 'Dörrstängare', 'Ventilationsdon'][i % 6],
    address: i % 3 === 0 ? LONG : 'Granitvägen ' + (i + 2), customerId: ['K-001', 'K-002', 'K-004', 'K-006'][i % 4],
    phone: i % 2 ? '070-123 45 6' + i : '', status: i === 3 ? 'pågående' : (i === 5 ? 'nytt' : 'planerad'),
    substatus: i === 4 ? 'pausad' : (i === 6 ? 'inväntar_material' : ''), priority: i === 1 ? 'hög' : 'normal',
    category: ['underhall', 'felanmalan', 'teknisk'][i % 3], scheduledDate: t, scheduledStart: st, scheduledEnd: '', estimatedHours: 1.5,
    checklist: i % 2 ? [{ id: 'c1', text: 'Kontroll', done: true }, { id: 'c2', text: 'Åtgärd', done: false }] : [],
  })));
  [1, 2, 3].forEach((n) => add.push(base({ id: 'AO-R2' + n, title: 'Försenat jobb ' + n, scheduledDate: d(-n), scheduledStart: '09:00', status: n === 2 ? 'pågående' : 'planerad' })));
  [1, 2, 3, 4, 5].forEach((n) => add.push(base({ id: 'AO-R3' + n, title: 'Kommande jobb ' + n, scheduledDate: d(n), scheduledStart: '08:00', address: n === 1 ? LONG : 'Björkvägen ' + n })));
  [1, 2].forEach((n) => add.push(base({ id: 'AO-R4' + n, title: 'Tilldelat utan datum ' + n, scheduledDate: '' })));
  [1, 2, 3, 4, 5, 6].forEach((n) => add.push(base({ id: 'AO-R5' + n, title: 'Pooljobb ' + n + (n === 1 ? ' – fasadtvätt och klotterborttagning på hela gavelfasaden mot parkeringen' : ''), staff: [], status: 'pool', priority: n === 2 ? 'akut' : 'normal', address: n === 1 ? LONG : 'Poolgatan ' + n })));
  // Andra tekniker (Dagens drift): ST-002 har sex jobb idag, två otilldelade jobb idag, en akut.
  [1, 2, 3, 4, 5, 6].forEach((n) => add.push(base({ id: 'AO-R6' + n, title: 'Eriks jobb ' + n, staff: ['ST-002'], scheduledDate: t, scheduledStart: String(6 + n).padStart(2, '0') + ':00', status: n === 1 ? 'pågående' : 'planerad' })));
  [1, 2].forEach((n) => add.push(base({ id: 'AO-R7' + n, title: 'Otilldelat idag ' + n, staff: [], status: 'nytt', scheduledDate: t, priority: n === 1 ? 'akut' : 'normal' })));
  fake.set('workOrders', wos.concat(add));
  // Tidposter för Jonas (ST-004) över tolv dagar, varav två attesterade.
  const te = fake.get('timeEntries');
  for (let i = 0; i < 24; i++) {
    const day = d(-Math.floor(i / 2));
    const am = i % 2 === 0;
    te.push({ id: 'TE-R' + i, aoId: 'AO-R' + (100 + (i % 10)), customerId: 'K-001', staffId: 'ST-004', staffName: 'Jonas Pettersson', date: day,
      startStr: am ? '07:30' : '12:30', endStr: am ? '11:45' : '16:00', minutes: am ? 255 : 210, comment: am ? 'Felsökning och åtgärd' : '',
      priceGroupId: 'PG-001', priceGroupName: 'Standard', hourRate: 695, billable: i % 5 !== 0, internal: false, attested: i > 20, createdAt: new Date().toISOString() });
  }
  fake.set('timeEntries', te);
  // Återkommande: blandade statusar och datum (idag, om 1 dag, förfallen, pausad, avslutad).
  const ro = fake.get('recurringOrders');
  const R = (id, title, nextDate, status, interval) => ({ id, title, customerId: 'K-002', propertyId: '', address: LONG, description: '', priority: 'normal', priceType: 'fastpris', priceGroupId: '', fixedPrice: 0,
    staff: ['ST-002', 'ST-004'], interval: interval || 'månadsvis', intervalDays: 30, startDate: '2025-01-01', nextDate, tillsvidare: true, endDate: '', checklist: [{ text: 'Kontroll' }], status, lastCreatedDate: d(-30), createdAt: '2025-01-01', updatedAt: d(-30) });
  ro.push(R('REC-R1', 'Förfallen kontroll av takavvattning och hängrännor på samtliga byggnader i området', d(-2), 'aktiv'));
  ro.push(R('REC-R2', 'Idag: veckostädning soprum', t, 'aktiv', 'veckovis'));
  ro.push(R('REC-R3', 'Imorgon: filterbyte', d(1), 'aktiv'));
  ro.push(R('REC-R4', 'Pausad: snöröjning', d(4), 'pausad', 'veckovis'));
  ro.push(R('REC-R5', 'Avslutad: sommarbevattning', d(20), 'avslutad'));
  for (let i = 0; i < 10; i++) ro.push(R('REC-RX' + i, 'Löpande service ' + (i + 1), d(5 + i * 3), 'aktiv', 'kvartalsvis'));
  fake.set('recurringOrders', ro);
}

/* Simulera att ett pass startade för `min` minuter sedan (klient + server) — som 05_time. */
async function backdate(t, s, email, min) {
  const ts = Date.now() - min * 60000;
  const row = t.fake.stamp.get(email); row.ts = ts;
  await s.eval((x) => { state.stampTimestamp = x; }, ts);
  return ts;
}
const visibleButtons = (s, re) => s.eval((src) => {
  const r = new RegExp(src);
  return [...document.querySelectorAll('.page.active button, .page.active a.btn')].filter((b) => b.offsetParent && r.test((b.textContent || '').trim())).length;
}, re.source);
const clickText = async (s, sel, text) => { await s.page.locator('.page.active ' + sel, { hasText: text }).first().click(); await s.settle(300); };

/* Synlig text på aktiv sida + öppna dialoger (utan fältvärden). */
const visibleText = (s) => s.eval(() => {
  const roots = [document.querySelector('.page.active'), ...document.querySelectorAll('.modal-overlay.open')].filter(Boolean);
  const out = [];
  for (const root of roots) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) {
      const el = n.parentElement;
      if (!el || !el.offsetParent || el.closest('script,style,textarea,select,option,input')) continue;
      const v = n.nodeValue.trim(); if (v) out.push(v);
    }
  }
  return out.join(' | ');
});

/* RENDER-01-kontrollen (betrodd markup får aldrig synas som text). */
const MARKUP = /<\/?(svg|path|span|div|i|b|strong|em|a|button|br|img|small|p|ul|li|table|td|tr|label|input|select|option|dl|dt|dd|h3|h4|section|article)\b[^>]*>|&(lt|gt|amp|quot|#39|nbsp);/i;
const BROKEN = /\b(on[a-z]+|value|placeholder|class|style|href|xmlns|viewBox|stroke-width|data-[a-z]+)=["']|<svg\b|<path\b/i;
async function markupHits(s, where, hits) {
  const r = await s.eval(([src, bsrc]) => {
    const re = new RegExp(src, 'i'); const broken = new RegExp(bsrc, 'i'); const out = [];
    const roots = [document.querySelector('.page.active'), ...document.querySelectorAll('.modal-overlay.open')].filter(Boolean);
    for (const root of roots) {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n; while ((n = w.nextNode())) {
        const el = n.parentElement;
        if (!el || el.closest('script,style,textarea,code,pre') || !el.offsetParent) continue;
        const m = n.nodeValue.match(re) || n.nodeValue.match(broken);
        if (m) out.push((el.className ? String(el.className).split(' ')[0] : el.tagName) + ': "' + n.nodeValue.trim().slice(0, 60) + '"');
      }
      root.querySelectorAll('[title],[placeholder],[aria-label]').forEach((e) => ['title', 'placeholder', 'aria-label'].forEach((a) => { const v = e.getAttribute(a); if (v && (re.test(v) || v.includes('<'))) out.push(a + ': "' + v.slice(0, 60) + '"'); }));
    }
    return out.slice(0, 5);
  }, [MARKUP.source, BROKEN.source]);
  if (r.length) hits.push(where + ' → ' + r.join(' | '));
}

/* Layout: ingen sidledsrullning, inga knappar utanför skärmen eller med
   avklippt text, och (mobil) tryckytor >= 40 px. */
async function layoutProblems(s, mobile) {
  const base = await s.layoutIssues();
  const extra = await s.eval((mob) => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    const root = document.querySelector('.page.active');
    if (!root) return ['ingen aktiv sida'];
    if (root.scrollWidth > root.clientWidth + 2) out.push('sidan bredare än skärmen: ' + root.scrollWidth + ' > ' + root.clientWidth);
    root.querySelectorAll('button, a.btn, .chip, select').forEach((b) => {
      if (!b.offsetParent || getComputedStyle(b).visibility === 'hidden') return;
      const r = b.getBoundingClientRect();
      if (r.width === 0) return;
      const label = (b.textContent || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      if (r.left < -1 || r.right > vw + 1) out.push('utanför skärmen: "' + label + '"');
      if (b.tagName !== 'SELECT' && b.scrollWidth > b.clientWidth + 2) out.push('avklippt: "' + label + '" ' + b.scrollWidth + '>' + b.clientWidth);
      if (mob && r.height < 39.5 && !b.closest('.rc-title')) out.push('för liten tryckyta (' + Math.round(r.height) + ' px): "' + label + '"');
    });
    return out;
  }, !!mobile);
  return [...new Set(base.concat(extra))].slice(0, 8);
}

module.exports = [
  {
    id: 'FALT-01', kind: 'workflow', module: 'Mina jobb', name: 'Mina jobb med många jobb: Idag (nästa jobb, försenade, resten av dagen, utan datum), Kommande per dag och Arbetspool — rätt gruppering, inga dubbletter, bara egna jobb; Ta jobbet tilldelar på servern',
    async run(t) {
      richData(t.fake);
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('falt2');
      await s.go('pg-myjobs');
      const exp = await s.eval(() => {
        const me = state.currentUser.id, t0 = tdy();
        const all = state.workOrders.filter((a) => !a.archived && !a.deleted);
        const mine = (a) => (a.staff || []).includes(me);
        const alive = (a) => !['klar', 'fakturerad', 'avbruten'].includes(a.status);
        const today = all.filter((a) => mine(a) && a.scheduledDate === t0 && alive(a));
        const overdue = all.filter((a) => mine(a) && a.scheduledDate && a.scheduledDate < t0 && alive(a));
        const ongoing = all.filter((a) => mine(a) && a.status === 'pågående' && a.scheduledDate !== t0 && !(a.scheduledDate && a.scheduledDate < t0));
        const uns = all.filter((a) => mine(a) && !a.scheduledDate && alive(a) && a.status !== 'pågående');
        const upcoming = all.filter((a) => mine(a) && a.scheduledDate > t0 && alive(a) && a.status !== 'pågående');
        // T3-B (AP-A): fliken Arbetspool = ÖPPEN pool (status pool, poolOpen ≠ false, ingen personal), aldrig egna.
        const open = (a) => a.status === 'pool' && a.poolOpen !== false && !(a.staff || []).length;
        const pool = all.filter((a) => open(a) && !mine(a));
        return { idag: new Set([...today, ...overdue, ...ongoing, ...uns].map((a) => a.id)).size, today: today.length, overdue: overdue.length, uns: uns.length,
          upcoming: upcoming.length, pool: pool.length, poolIds: pool.map((a) => a.id), others: all.filter((a) => !mine(a) && !open(a)).map((a) => a.id) };
      });
      const tabs = await s.eval(() => [...document.querySelectorAll('.mj-views .ft')].map((b) => ({ t: b.textContent.replace(/\d+/g, '').trim(), n: +b.querySelector('.ft-n').textContent, on: b.classList.contains('on') })));
      t.assert(tabs.length === 3 && tabs[0].on && tabs[0].t === 'Idag' && tabs[1].t === 'Kommande' && tabs[2].t === 'Arbetspool', 'tre vyer, Idag vald: ' + JSON.stringify(tabs));
      t.assert(tabs[0].n === exp.idag && tabs[1].n === exp.upcoming && tabs[2].n === exp.pool, 'antal i flikarna = data (' + JSON.stringify(tabs.map((x) => x.n)) + ' / ' + JSON.stringify([exp.idag, exp.upcoming, exp.pool]) + ')');
      const idag = await s.eval(() => ({
        hero: (document.querySelector('.mj-hero') || {}).dataset ? document.querySelector('.mj-hero').dataset.ao : null,
        heroLabel: (document.querySelector('.mj-hero .mj-label') || {}).textContent || '',
        heroPrimary: [...document.querySelectorAll('.mj-hero .btn.bp')].map((b) => b.textContent.trim()),
        primaries: document.querySelectorAll('.page.active .btn.bp').length,
        cards: [...document.querySelectorAll('.page.active .mj-card')].map((c) => c.dataset.ao),
        secs: [...document.querySelectorAll('.mj-sec-h h3')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()),
      }));
      t.assert(idag.hero === 'AO-R103' && /Nästa jobb/.test(idag.heroLabel), 'nästa jobb = dagens pågående (AO-R103): ' + idag.hero + ' ' + idag.heroLabel);
      t.assert(idag.heroPrimary.length === 1 && /Stämpla in/.test(idag.heroPrimary[0]) && idag.primaries === 1, 'en primärknapp i vyn, Stämpla in på nästa jobb: ' + JSON.stringify(idag.heroPrimary) + ' / ' + idag.primaries);
      t.assert(idag.cards.length === exp.idag && new Set(idag.cards).size === idag.cards.length, 'alla Idag-jobb exakt en gång (' + idag.cards.length + ' kort, ' + new Set(idag.cards).size + ' unika, väntat ' + exp.idag + ')');
      t.assert(idag.secs.some((x) => /^Försenade \d+$/.test(x) && +x.match(/\d+/)[0] === exp.overdue), 'Försenade med rätt antal: ' + idag.secs.join(' / '));
      t.assert(idag.secs.some((x) => x.startsWith('Resten av dagen ' + (exp.today - 1))), 'Resten av dagen = dagens jobb utom nästa: ' + idag.secs.join(' / '));
      t.assert(idag.secs.some((x) => x.startsWith('Tilldelade utan datum ' + exp.uns)), 'utan datum: ' + idag.secs.join(' / '));
      t.assert(!idag.cards.some((id) => exp.others.includes(id)), 'inga andras jobb i Mina jobb');
      // Kommande: per dag, första dagen Imorgon
      await clickText(s, '.mj-views .ft', 'Kommande');
      const up = await s.eval(() => ({ heads: [...document.querySelectorAll('.mj-sec-h h3')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()), cards: document.querySelectorAll('.page.active .mj-card').length, stamp: document.querySelectorAll('.page.active .mj-card button').length }));
      t.assert(up.cards === exp.upcoming && /^Imorgon \d/.test(up.heads[0] || ''), 'Kommande per dag, Imorgon först: ' + up.heads.join(' / '));
      // Arbetspool
      await clickText(s, '.mj-views .ft', 'Arbetspool');
      const pool = await s.eval(() => ({ ids: [...document.querySelectorAll('.page.active .mj-card')].map((c) => c.dataset.ao), take: [...document.querySelectorAll('.page.active .mj-card button')].filter((b) => /Ta jobbet/.test(b.textContent)).length, stamp: [...document.querySelectorAll('.page.active button')].filter((b) => /Stämpla/.test(b.textContent)).length }));
      t.assert(pool.ids.length === exp.pool && pool.take === exp.pool && pool.stamp === 0, 'poolen: ' + pool.ids.length + ' kort, ' + pool.take + ' Ta jobbet, ingen stämpling');
      const takeId = pool.ids[0];
      await s.page.locator('.page.active .mj-card[data-ao="' + takeId + '"] button', { hasText: 'Ta jobbet' }).click();
      await s.waitToast(/Du är nu tilldelad/, 6000);
      for (let i = 0; i < 40; i++) { const a = t.fake.get('workOrders').find((x) => x.id === takeId); if (a && a.status === 'planerad') break; await s.settle(100); }
      const srv = t.fake.get('workOrders').find((x) => x.id === takeId);
      t.assert(srv && srv.status === 'planerad' && JSON.stringify(srv.staff) === '["ST-004"]' && srv.poolOpen === false && (srv.log || []).filter((l) => l.type === 'taken_from_pool').length === 1,
        'tagen från poolen på servern (T3-B take_from_pool): ' + JSON.stringify(srv && { st: srv.status, staff: srv.staff, poolOpen: srv.poolOpen }));
      t.assert(t.fake.calls.some((c) => c.action === 'ao-time-write:take_from_pool' && c.aoId === takeId) && !t.fake.calls.some((c) => c.action === 'ao-time-write:patch_ao' && c.aoId === takeId),
        'SÄK-4: tagningen gick via take_from_pool (atomisk RPC), inte via patch_ao');
      t.assert(!(await s.eval((id) => !!document.querySelector('.page.active .mj-card[data-ao="' + id + '"]'), takeId)), 'jobbet försvann ur poolvyn');
    },
  },
  {
    id: 'FALT-02', kind: 'workflow', module: 'Tidregistrering och instämpling', name: 'Mina jobb: Stämpla in → exakt en aktiv markering och en Stämpla ut, statusen oförändrad; Stämpla ut → exakt en tidpost på servern och markeringen borta',
    async run(t) {
      const s = await t.world.session({ viewport: 'android' });
      await s.login('falt2');
      await s.go('pg-myjobs');
      t.assert((await visibleButtons(s, /^Stämpla in$/)) >= 1 && (await visibleButtons(s, /^Stämpla ut$/)) === 0, 'före: Stämpla in finns, ingen Stämpla ut');
      t.assert((await s.eval(() => document.querySelectorAll('.mj-stamp, .mj-card.is-on').length)) === 0, 'före: ingen aktiv markering');
      const before = t.fake.get('timeEntries').filter((e) => e.staffId === 'ST-004').length;
      await s.page.locator('.mj-hero button', { hasText: 'Stämpla in' }).click();
      await s.waitToast(/Instämplad/, 6000);
      const on = await s.eval(() => ({ bar: document.querySelectorAll('.page.active .mj-stamp').length, cards: [...document.querySelectorAll('.page.active .mj-card.is-on')].map((c) => c.dataset.ao), label: (document.querySelector('.mj-hero .mj-label') || {}).textContent || '', barTxt: (document.querySelector('.mj-stamp') || {}).textContent || '' }));
      t.assert(on.bar === 1 && on.cards.length === 1 && on.cards[0] === 'AO-015', 'en stämplingsstatus och ett aktivt kort (AO-015): ' + JSON.stringify(on));
      t.assert(/Pågår nu/.test(on.label) && /Instämplad/.test(on.barTxt) && /AO-015/.test(on.barTxt) && /Sedan \d{2}:\d{2}/.test(on.barTxt), 'status visar jobb och klockslag: ' + on.barTxt.replace(/\s+/g, ' ').trim());
      t.assert((await visibleButtons(s, /^Stämpla in$/)) === 0 && (await visibleButtons(s, /^Stämpla ut$/)) === 1, 'instämplad: ingen Stämpla in, exakt en Stämpla ut');
      const row = t.fake.stamp.get(F2);
      t.assert(row && row.active && row.aoId === 'AO-015', 'serverns stämpling aktiv på AO-015');
      t.assert(t.fake.get('workOrders').find((a) => a.id === 'AO-015').status === 'nytt', 'Stämpla in ändrar inte AO:ns status');
      await backdate(t, s, F2, 45);
      await s.page.locator('.page.active .mj-stamp button', { hasText: 'Stämpla ut' }).click();
      await s.waitToast(/Utstämplad — tid sparad/, 8000);
      const mine = t.fake.get('timeEntries').filter((e) => e.staffId === 'ST-004');
      const added = mine.filter((e) => e.aoId === 'AO-015');
      t.assert(mine.length === before + 1 && added.length === 1 && added[0].minutes === 45, 'exakt en ny tidpost, 45 min på AO-015: ' + JSON.stringify(added.map((e) => e.minutes)));
      await s.go('pg-myjobs');
      t.assert((await s.eval(() => document.querySelectorAll('.page.active .mj-stamp, .page.active .mj-card.is-on').length)) === 0 && (await visibleButtons(s, /^Stämpla ut$/)) === 0, 'efter: ingen aktiv markering');
      await s.go('pg-tid');
      t.assert(/Inte instämplad/.test(await s.text('#pg-tid .tp-now')), 'Tid & stämpla visar Inte instämplad');
    },
  },
  {
    id: 'FALT-03', module: 'Mina jobb', name: '"Starta jobb" ändrar bara status (pågående på servern) — ingen tidpost och ingen stämpling skapas',
    async run(t) {
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('falt2');
      await s.go('pg-myjobs');
      const before = t.fake.get('timeEntries').length;
      const btn = s.page.locator('.mj-hero button', { hasText: 'Starta jobb' });
      t.assert((await btn.count()) === 1, 'Starta jobb finns på nästa jobb');
      const titles = await s.eval(() => [...document.querySelectorAll('.mj-hero button')].map((b) => (b.textContent.trim() + ' = ' + (b.title || ''))));
      t.assert(titles.some((x) => /^Stämpla in = .*tid/i.test(x)) && titles.some((x) => /^Starta jobb = .*status.*ingen tid/i.test(x)), 'knapparna förklarar skillnaden: ' + titles.join(' | '));
      await btn.click();
      await s.waitToast(/Status: Pågående/, 6000);
      t.assert(t.fake.get('workOrders').find((a) => a.id === 'AO-015').status === 'pågående', 'status pågående på servern');
      t.assert(t.fake.get('timeEntries').length === before, 'ingen tidpost skapad');
      t.assert(!(t.fake.stamp.get(F2) || {}).active && !(await s.eval(() => state.stampActive)), 'ingen stämpling');
    },
  },
  {
    id: 'FALT-04', module: 'Tidregistrering och instämpling', name: 'Manuell tid: fel visas vid fälten och i en sammanfattning, inget skickas; giltigt pass visar svensk sammanfattning, Sparar… tills servern svarat, och hamnar under rätt dag; redigering med sluttid före starttid nekas',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('falt2');
      await s.go('pg-tid');
      const calls = () => t.fake.calls.filter((c) => c.action === 'ao-time-write:create_time').length;
      const c0 = calls();
      await s.page.fill('#mt-date', '');
      await s.page.fill('#mt-start', '10:00');
      await s.page.fill('#mt-end', '09:00');
      await s.page.locator('#mt-save').click();
      await s.settle(300);
      const v1 = await s.eval(() => ({ d: document.getElementById('mt-date-err').textContent, e: document.getElementById('mt-end-err').textContent, inv: document.getElementById('mt-end').getAttribute('aria-invalid'), st: document.getElementById('mt-status').textContent, cls: document.getElementById('mt-status').className }));
      t.assert(v1.d === 'Välj datum.' && /^Sluttid måste vara efter starttid\./.test(v1.e) && /midnatt/.test(v1.e) && v1.inv === 'true', 'fel vid fälten: ' + JSON.stringify(v1));
      t.assert(/is-err/.test(v1.cls) && /Kontrollera 2 fält/.test(v1.st), 'sammanfattning vid sparning: ' + v1.st);
      await s.page.fill('#mt-start', '');
      await s.page.locator('#mt-save').click();
      await s.settle(200);
      t.assert((await s.text('#mt-start-err')) === 'Ange starttid.', 'Ange starttid.');
      t.assert(calls() === c0, 'inget skickat till servern vid fel');
      // Rättat: felen försvinner direkt, svensk sammanfattning
      await s.page.fill('#mt-date', '2026-11-20');
      await s.page.fill('#mt-start', '08:00');
      await s.page.fill('#mt-end', '09:30');
      await s.settle(150);
      const v2 = await s.eval(() => ({ errs: [...document.querySelectorAll('#pg-tid .tp-ferr')].map((e) => e.textContent).join(''), sum: document.getElementById('mt-sum').textContent }));
      t.assert(v2.errs === '', 'felen borta när fälten är rätt: ' + v2.errs);
      t.assert(v2.sum.trim() === 'Fredag 20 nov. 2026 · 08:00–09:30 · 1,5 h', 'svensk sammanfattning: "' + v2.sum.trim() + '"');
      t.fake.addFault({ match: /ao-time-write:create_time/, mode: 'delay', ms: 1200, times: 1 });
      await s.page.locator('#mt-save').click();
      await s.settle(250);
      const busy = await s.eval(() => ({ dis: document.getElementById('mt-save').disabled, txt: document.getElementById('mt-save').textContent.trim(), st: document.getElementById('mt-status').textContent }));
      t.assert(busy.dis && busy.txt === 'Sparar…' && /Sparar/.test(busy.st) && !(await s.toasts()).includes('Tid sparad'), 'före serverns svar: ' + JSON.stringify(busy));
      await s.waitToast(/^Tid sparad$/, 6000);
      const done = await s.eval(() => ({ dis: document.getElementById('mt-save').disabled, st: document.getElementById('mt-status').textContent.trim() }));
      t.assert(!done.dis && /^Sparad: Fre 20 nov\. 2026 08:00–09:30 \(1,5 h\)$/.test(done.st), 'efter ACK: ' + JSON.stringify(done));
      const e = t.fake.get('timeEntries').find((x) => x.staffId === 'ST-004' && x.date === '2026-11-20' && x.startStr === '08:00');
      t.assert(e && e.minutes === 90, '90 min på servern');
      const day = await s.eval((id) => { const r = [...document.querySelectorAll('#time-list .tp-day')].find((d) => /20 nov\. 2026/.test(d.querySelector('.tp-day-h').textContent)); return r ? { h: [...r.querySelectorAll('.tp-day-h > span')].map((x) => x.textContent.trim()).join(' | '), rows: r.querySelectorAll('.tp-row').length } : null; }, e.id);
      t.assert(day && /^Fredag 20 nov\. 2026 \| [\d,]+ h$/.test(day.h) && day.rows >= 1, 'posten under rätt dag med dagssumma: ' + JSON.stringify(day));
      // Redigera: sluttid före starttid nekas i dialogen
      await s.eval((id) => TimePage.openEditEntry(id), e.id);
      await s.page.waitForSelector('.modal-overlay.open #et-end');
      await s.page.fill('#et-end', '07:00');
      const u0 = t.fake.calls.filter((c) => /update_time/.test(c.action || '')).length;
      await s.clickModalButton(/Spara/);
      await s.settle(300);
      t.assert(/^Sluttid måste vara efter starttid/.test(await s.text('#et-end-err')) && (await s.modalOpen()), 'fel vid sluttid, dialogen kvar');
      t.assert(t.fake.calls.filter((c) => /update_time/.test(c.action || '')).length === u0 && t.fake.get('timeEntries').find((x) => x.id === e.id).minutes === 90, 'inget skickat, posten oförändrad');
    },
  },
  {
    id: 'FALT-05', module: 'Dashboard', name: 'Dagens drift (arbetsledare, många jobb): nyckeltalen = underliggande data, och varje ruta visar exakt så många rader; personal idag visar vem som arbetar med vad',
    async run(t) {
      richData(t.fake);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await s.go('pg-operations');
      const exp = await s.eval(() => {
        const t0 = tdy();
        const all = state.workOrders.filter((a) => !a.archived && !a.deleted);
        const alive = (a) => !['klar', 'fakturerad', 'avbruten'].includes(a.status);
        return {
          today: all.filter((a) => a.scheduledDate === t0 && alive(a)).length,
          ongoing: all.filter((a) => a.status === 'pågående').length,
          overdue: all.filter((a) => alive(a) && a.status !== 'pool' && a.scheduledDate && a.scheduledDate < t0).length,
          urgent: all.filter((a) => a.priority === 'akut' && alive(a)).length,
          noStaff: all.filter((a) => !(a.staff || []).length && alive(a) && a.status !== 'pool').length,
          bill: all.filter((a) => a.status === 'klar' && !a.invoiceId).length,
          notes: all.filter((a) => alive(a) && (a.notes || []).length).length,
        };
      });
      const tiles = await s.eval(() => Object.fromEntries([...document.querySelectorAll('.ops2-tile')].map((b) => [b.dataset.k, +b.querySelector('.dt-tile-n').textContent])));
      t.note('väntat ' + JSON.stringify(exp) + ' visat ' + JSON.stringify(tiles));
      for (const k of ['today', 'ongoing', 'overdue', 'urgent', 'noStaff', 'bill']) t.assert(tiles[k] === exp[k], 'ruta ' + k + ': ' + tiles[k] + ' = ' + exp[k]);
      t.assert(exp.today > 15 && exp.overdue >= 3 && exp.noStaff >= 2, 'realistiskt innehåll i testet');
      for (const k of ['today', 'ongoing', 'overdue', 'urgent', 'noStaff', 'bill']) {
        await s.page.locator('.ops2-tile[data-k="' + k + '"]').click();
        await s.settle(200);
        const r = await s.eval(() => ({ rows: document.querySelectorAll('#ops2-list .ops2-row').length, n: +document.getElementById('ops2-main-n').textContent, on: (document.querySelector('.ops2-tile.is-on') || {}).dataset.k }));
        t.assert(r.on === k && r.rows === exp[k] && r.n === exp[k], 'lista ' + k + ': ' + JSON.stringify(r) + ' väntat ' + exp[k]);
      }
      await s.page.locator('.page.active .chip', { hasText: 'Med anteckningar' }).click();
      await s.settle(200);
      t.assert((await s.eval(() => document.querySelectorAll('#ops2-list .ops2-row').length)) === exp.notes, 'Med anteckningar = data');
      // Idag: grupperat per status, summan av grupperna = Jobb idag
      await s.page.locator('.ops2-tile[data-k="today"]').click(); await s.settle(200);
      const grp = await s.eval(() => [...document.querySelectorAll('#ops2-list .ops2-grp')].map((g) => ({ st: g.dataset.status, n: g.querySelectorAll('.ops2-row').length })));
      t.assert(grp.length >= 3 && grp[0].st === 'pågående' && grp.reduce((a, g) => a + g.n, 0) === exp.today, 'dagens jobb per status: ' + JSON.stringify(grp));
      const staff = await s.eval(() => [...document.querySelectorAll('.ops2-p')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
      const jonas = staff.find((x) => /Jonas Pettersson/.test(x)) || '';
      const erik = staff.find((x) => /Erik Andersson/.test(x)) || '';
      t.assert(/Arbetar med AO-R103/.test(jonas) && /11 idag/.test(jonas) && /3 försenade/.test(jonas), 'Jonas: ' + jonas);
      t.assert(/Arbetar med/.test(erik) && /idag/.test(erik), 'Erik: ' + erik);
      const inl = await s.eval(() => [...document.querySelectorAll('#pg-operations [style]')].filter((e) => !e.matches('.av, .ops2-cat-bar i, .cat-sw')).map((e) => e.className || e.tagName));
      t.assert(inl.length === 0, 'inga inline-stilar i Dagens drift utom avatarfärg och stapelbredd: ' + inl.slice(0, 5).join(', '));
    },
  },
  {
    id: 'FALT-06', kind: 'workflow', module: 'Återkommande AO', name: 'Återkommande: "Om 1 dag"/"Om 2 dagar"/"Förfallen sedan 2 dagar" (F-12), sök behåller fokus, snabbval och statusfilter räknar rätt, pausa/aktivera bekräftas av servern och redigering återaktiverar inte ett pausat ärende',
    async run(t) {
      richData(t.fake);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('chef');
      await s.go('pg-recurring');
      const rel = await s.eval(() => Object.fromEntries([...document.querySelectorAll('.rc-item')].map((a) => [a.dataset.ro, (a.querySelector('.rc-rel') || {}).textContent || ''])));
      t.assert(rel['REC-002'] === 'Om 1 dag' && rel['REC-003'] === 'Om 2 dagar' && rel['REC-R1'] === 'Förfallen sedan 2 dagar' && rel['REC-R2'] === 'Idag', 'singular/plural: ' + JSON.stringify({ a: rel['REC-002'], b: rel['REC-003'], c: rel['REC-R1'], d: rel['REC-R2'] }));
      t.assert(/Pausad – skapar inga arbetsorder/.test(rel['REC-R4']), 'pausat ärende tydligt: ' + rel['REC-R4']);
      const fn = await s.eval(() => [RecurringPage._daysText(1), RecurringPage._daysText(5), RecurringPage._daysText(-1), RecurringPage._daysText(0)]);
      t.assert(JSON.stringify(fn) === JSON.stringify(['Om 1 dag', 'Om 5 dagar', 'Förfallen sedan 1 dag', 'Idag']), '_daysText: ' + fn.join(' / '));
      t.assert(!/(^|[^\d])1 dagar/.test(await s.text('#pg-recurring')), 'aldrig "1 dagar"');
      const createBtns = await s.eval(() => [...document.querySelectorAll('.rc-item')].filter((a) => [...a.querySelectorAll('button')].some((b) => /Skapa AO nu/.test(b.textContent))).map((a) => a.dataset.ro).sort());
      t.assert(JSON.stringify(createBtns) === JSON.stringify(['REC-R1', 'REC-R2']), 'Skapa AO nu i listan bara där det är dags: ' + createBtns.join(','));
      t.assert(/inte|när du väljer/.test(await s.text('.rc-note')) && !/automatiskt arbetsorder/.test(await s.text('#pg-recurring')), 'infotexten lovar inte automatisk skapning');
      // Snabbval och statusfilter
      const count = () => s.eval(() => document.querySelectorAll('.rc-item').length);
      const total = await count();
      await clickText(s, '.chip', 'Dags att skapa');
      t.assert((await count()) === 2 && /Visar 2 av/.test(await s.text('#rc-count')), 'Dags att skapa = 2');
      await clickText(s, '.chip', 'Pausade');
      t.assert((await count()) === 0, 'Dags att skapa + Pausade = 0');
      await clickText(s, 'button', 'Rensa filter');
      t.assert((await count()) === total, 'Rensa filter visar alla');
      await clickText(s, '.chip', 'Pausade');
      t.assert((await count()) === 1, 'Pausade = 1');
      await clickText(s, '.chip', 'Alla');
      // Sök: bara listan ritas om, fältet behåller fokus
      await s.page.click('#rc-q');
      await s.page.keyboard.type('filterbyte');
      await s.settle(400);
      const q = await s.eval(() => ({ n: document.querySelectorAll('.rc-item').length, focus: document.activeElement && document.activeElement.id, v: document.getElementById('rc-q').value }));
      t.assert(q.n === 1 && q.focus === 'rc-q' && q.v === 'filterbyte', 'sök: ' + JSON.stringify(q));
      await clickText(s, 'button', 'Rensa filter');
      // Pausa via detaljen → serverbekräftat besked
      await s.eval(() => RecurringPage.openDetail('REC-001'));
      await s.page.waitForSelector('.modal-overlay.open .rc-d');
      await s.page.locator('.modal-overlay.open .rc-d-acts button', { hasText: 'Pausa' }).click();
      await s.waitToast(/Ärendet är pausat/, 6000);
      t.assert(t.fake.get('recurringOrders').find((r) => r.id === 'REC-001').status === 'pausad', 'pausad på servern');
      // Redigera det pausade ärendet → status behålls
      await s.eval(() => RecurringPage._openForm('REC-001'));
      await s.page.waitForSelector('.modal-overlay.open #ro-title');
      await s.page.fill('#ro-title', 'Månadsservice VVS – Solgläntan (E2E)');
      await s.clickModalButton(/Spara ändringar/);
      await s.waitToast(/Ärende uppdaterat/, 6000);
      const r1 = t.fake.get('recurringOrders').find((r) => r.id === 'REC-001');
      t.assert(r1.title.endsWith('(E2E)') && r1.status === 'pausad', 'redigering sparad och ärendet fortfarande pausat: ' + r1.status);
      // Pausat ärende: ingen Skapa AO nu i dialogen; Aktivera
      await s.eval(() => RecurringPage.openDetail('REC-001'));
      await s.page.waitForSelector('.modal-overlay.open .rc-d');
      const btns = await s.eval(() => [...document.querySelectorAll('.modal-overlay.open button')].map((b) => b.textContent.trim()));
      t.assert(!btns.some((x) => /Skapa AO nu/.test(x)) && btns.some((x) => /Aktivera/.test(x)) && /Inga arbetsorder skapas/.test(await s.text('.modal-overlay.open .rc-d-next')), 'pausat: ' + btns.join(' | '));
      await s.page.locator('.modal-overlay.open .rc-d-acts button', { hasText: 'Aktivera' }).click();
      await s.waitToast(/Ärendet är aktiverat/, 6000);
      t.assert(t.fake.get('recurringOrders').find((r) => r.id === 'REC-001').status === 'aktiv', 'aktiv på servern');
    },
  },
  {
    id: 'FALT-07', module: 'Mina jobb', name: 'Svenska format på fältsidorna: datum ("24 nov. 2026"), klockslag 08:00, timmar med decimalkomma — inga ISO-datum, AM/PM, m/d/y eller engelska dag-/månadsnamn i det som visas',
    async run(t) {
      richData(t.fake);
      const BAD = [[/\b\d{4}-\d{2}-\d{2}\b/, 'ISO-datum'], [/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, 'm/d/y'], [/\b(AM|PM)\b/, 'AM/PM'],
        [/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|June|July|August|September|October|November|December)\b/, 'engelska namn'],
        [/\b\d+\.\d+ ?h\b/, 'decimalpunkt i timmar'], [/(^|[^\d:])\d:\d{2}\b/, 'ensiffrig timme'], [/\b1 dagar\b/, '"1 dagar"']];
      const bad = [];
      const check = async (s, where) => { const txt = await visibleText(s); BAD.forEach(([re, l]) => { const m = txt.match(re); if (m) bad.push(where + ': ' + l + ' "' + txt.slice(Math.max(0, m.index - 30), m.index + 30) + '"'); }); return txt; };
      const f = await t.world.session({ viewport: 'laptop' });
      await f.login('falt2');
      await f.go('pg-myjobs');
      for (const v of ['idag', 'kommande', 'pool']) { await f.eval((x) => MyJobsPage.setView(x), v); await f.settle(150); await check(f, 'Mina jobb/' + v); }
      await f.eval(() => MyJobsPage.clockIn('AO-R100')); await f.settle(600);
      const mj = await check(f, 'Mina jobb instämplad');
      t.assert(/Sedan \d{2}:\d{2}/.test(mj), 'klockslag i stämplingsstatus');
      await f.go('pg-tid');
      const tid = await check(f, 'Tid');
      t.assert(/Idag · [a-zåäö]+dag \d{1,2} [a-zåäö]+\.? \d{4}/.test(tid) && /\d+,\d+ h/.test(tid) && /\d{2}:\d{2}–\d{2}:\d{2}/.test(tid), 'Tid: dagrubrik, decimalkomma och klockslag');
      await f.eval(() => TimePage.openClockOut()); await f.settle(300); await check(f, 'Tid/Stämpla ut'); await f.eval(() => Modal.close());
      const c = await t.world.session({ viewport: 'laptop' });
      await c.login('chef');
      await c.go('pg-operations');
      for (const k of ['today', 'overdue', 'bill']) { await c.eval((x) => OperationsPage.setFocus(x), k); await c.settle(150); await check(c, 'Drift/' + k); }
      const drift = await visibleText(c);
      t.assert(/\d{1,2} [a-zåäö]+\.? \d{4}/.test(drift), 'Drift visar datum som "25 nov. 2026"');
      await c.go('pg-recurring');
      const rec = await check(c, 'Återkommande');
      t.assert(/\d{1,2} (jan|feb|mars|apr|maj|juni|juli|aug|sep|okt|nov|dec)\.? \d{4}/.test(rec), 'Återkommande: datum på svenska');
      await c.eval(() => RecurringPage.openDetail('REC-001')); await c.settle(300); await check(c, 'Återkommande/detalj');
      t.assert(bad.length === 0, bad.join(' ; '));
    },
  },
  {
    id: 'FALT-08', module: 'Mina jobb', name: 'Fältsidorna 360–1920 px med många jobb, långa adresser och pågående stämpling: ingen sidledsrullning, inga knappar utanför skärmen eller avklippta, tryckytor >= 40 px på mobil',
    async run(t) {
      richData(t.fake);
      const probs = [];
      for (const vp of ['android', 'iphone', 'w768', 'w1024', 'laptop', 'desktop']) {
        const mobile = ['android', 'iphone'].includes(vp);
        const f = await t.world.session({ viewport: vp });
        await f.login('falt2');
        await f.go('pg-myjobs');
        await f.eval(() => MyJobsPage.clockIn('AO-R103')); await f.settle(500);
        for (const v of ['idag', 'kommande', 'pool']) {
          await f.eval((x) => MyJobsPage.setView(x), v); await f.settle(150);
          (await layoutProblems(f, mobile)).forEach((p) => probs.push(vp + ' Mina jobb/' + v + ': ' + p));
        }
        await f.go('pg-tid');
        (await layoutProblems(f, mobile)).forEach((p) => probs.push(vp + ' Tid: ' + p));
        await f.context.close();
        const c = await t.world.session({ viewport: vp });
        await c.login('chef');
        for (const p of ['pg-operations', 'pg-recurring']) {
          await c.go(p);
          (await layoutProblems(c, mobile)).forEach((x) => probs.push(vp + ' ' + p + ': ' + x));
        }
        await c.eval(() => OperationsPage.setFocus('bill'));
        await c.go('pg-operations');
        (await layoutProblems(c, mobile)).forEach((x) => probs.push(vp + ' drift/fakturera: ' + x));
        await c.context.close();
      }
      t.assert(probs.length === 0, probs.slice(0, 12).join(' ; '));
    },
  },
  {
    id: 'FALT-09', module: 'Säkerhet', kind: 'ui', name: 'Fältsidorna: ingen betrodd markup visas som text (RENDER-01-kontrollen) i alla vyer, filter och dialoger — med realistiskt innehåll',
    async run(t) {
      richData(t.fake);
      const hits = [];
      const f = await t.world.session({ viewport: 'iphone' });
      await f.login('falt2');
      await f.go('pg-myjobs');
      for (const v of ['idag', 'kommande', 'pool']) { await f.eval((x) => MyJobsPage.setView(x), v); await f.settle(150); await markupHits(f, 'Mina jobb/' + v, hits); }
      await f.eval(() => { MyJobsPage.setView('idag'); MyJobsPage.setCatFilter('underhall'); }); await f.settle(150); await markupHits(f, 'Mina jobb/kategori', hits);
      await f.eval(() => MyJobsPage.clockIn('AO-R103')); await f.settle(400); await markupHits(f, 'Mina jobb/instämplad', hits);
      await f.go('pg-tid'); await markupHits(f, 'Tid', hits);
      for (const fn of ['openClockOut', 'openManual']) { await f.eval((x) => TimePage[x]({}), fn); await f.settle(250); await markupHits(f, 'Tid/' + fn, hits); await f.eval(() => Modal.close()); await f.settle(150); }
      await f.eval(() => TimePage.openEditEntry('TE-R0')); await f.settle(250); await markupHits(f, 'Tid/redigera', hits); await f.eval(() => Modal.close());
      await f.eval(() => { document.getElementById('mt-date').value = ''; TimePage.saveManual(); }); await f.settle(200); await markupHits(f, 'Tid/valideringsfel', hits);
      const c = await t.world.session({ viewport: 'laptop' });
      await c.login('chef');
      await c.go('pg-operations');
      for (const k of ['today', 'ongoing', 'overdue', 'urgent', 'noStaff', 'bill', 'notes']) { await c.eval((x) => OperationsPage.setFocus(x), k); await c.settle(120); await markupHits(c, 'Drift/' + k, hits); }
      await c.go('pg-recurring'); await markupHits(c, 'Återkommande', hits);
      await c.eval(() => RecurringPage.toggleDue()); await c.settle(150); await markupHits(c, 'Återkommande/dags', hits);
      for (const id of ['REC-001', 'REC-R4', 'REC-R5']) { await c.eval((x) => RecurringPage.openDetail(x), id); await c.settle(250); await markupHits(c, 'Återkommande/detalj ' + id, hits); await c.eval(() => Modal.close()); await c.settle(120); }
      await c.eval(() => RecurringPage._openForm('REC-001')); await c.settle(300); await markupHits(c, 'Återkommande/formulär', hits);
      t.assert(hits.length === 0, 'markup som text: ' + hits.join(' ;; '));
    },
  },
  {
    id: 'FALT-10', kind: 'workflow', module: 'Mina jobb', name: 'Fältpersonalens dag på 360 px: dagens jobb syns direkt med nästa jobb överst, Karta öppnar vägbeskrivning, stämpla in och ut utan att något klipps',
    async run(t) {
      richData(t.fake);
      const s = await t.world.session({ viewport: 'android' });
      await s.login('falt2');
      await s.go('pg-myjobs');
      const first = await s.eval(() => {
        const h = document.querySelector('.mj-hero'); const r = h.getBoundingClientRect();
        const btn = [...h.querySelectorAll('button')].find((b) => /Stämpla in/.test(b.textContent));
        const map = h.querySelector('a.btn[href*="google.com/maps/dir"]');
        return { top: Math.round(r.top), vh: window.innerHeight, btnBottom: btn ? Math.round(btn.getBoundingClientRect().bottom) : null, map: map ? map.getAttribute('href') : null, target: map ? map.getAttribute('target') : null };
      });
      t.assert(first.top < 260 && first.btnBottom !== null, 'nästa jobb högt upp på skärmen: ' + JSON.stringify(first));
      t.assert(first.map && /destination=Kungsholmsgatan/.test(first.map) && first.target === '_blank', 'Karta = vägbeskrivning till arbetsadressen');
      let probs = await layoutProblems(s, true);
      await s.page.locator('.mj-hero button', { hasText: 'Stämpla in' }).click();
      await s.waitToast(/Instämplad/, 6000);
      probs = probs.concat(await layoutProblems(s, true));
      const bar = await s.eval(() => { const b = document.querySelector('.mj-stamp'); const r = b.getBoundingClientRect(); return { top: Math.round(r.top), w: Math.round(r.width), vw: document.documentElement.clientWidth }; });
      t.assert(bar.top < 200 && bar.w <= bar.vw, 'stämplingsstatus överst och inom skärmen: ' + JSON.stringify(bar));
      await backdate(t, s, F2, 20);
      await s.page.locator('.page.active .mj-stamp button', { hasText: 'Stämpla ut' }).click();
      await s.waitToast(/Utstämplad — tid sparad/, 8000);
      t.assert(t.fake.get('timeEntries').filter((e) => e.staffId === 'ST-004' && e.aoId === 'AO-R103' && e.minutes === 20).length === 1, 'tidposten sparad');
      await s.go('pg-tid');
      probs = probs.concat(await layoutProblems(s, true));
      t.assert(probs.length === 0, probs.join(' ; '));
    },
  },
];
module.exports.richData = richData;
