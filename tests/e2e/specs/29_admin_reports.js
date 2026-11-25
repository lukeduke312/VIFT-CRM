'use strict';
/* V3 2026-11-26 — Admin, Rapporter och Löneunderlag (arbetsblock admin).
   Regressionstester för omarbetningen: alla admin-avsnitt nåbara på
   360/390/1366, färgkedjan (förval, egen HEX, förhandsvisning, sparning,
   omladdning, ny inloggning, övriga inställningar orörda, exakt en skrivning
   per ändring), periodväljarens kontrast, tabeller som ryms på mobil, svenska
   talformat i löneunderlaget och inget sidöverflöd 360–1920 / ingen markup
   som text. Simulerad server (fake-backend). */

const ADMIN_KEYS = ['foretag', 'ekonomi', 'priser', 'personal', 'fastighetskort', 'ansvariga', 'avvikelse', 'notiser', 'epost', 'system', 'teknik'];

/* Realistiskt löneunderlag (V3-komponentstandard §12): fem personer, ett
   långt namn, fyra veckor, fyra prisgrupper (392/430/595/695 kr/h), udda
   minuter, attesterade och ej attesterade rader, långa kommentarer.
   Läggs i månaden (år, månad 1–12) i den simulerade servern före inloggning. */
const PG = { 'PG-001': ['Fastighetsservice avtal', 392], 'PG-002': ['Fastighetsservice standard', 430], 'PG-003': ['Engångsjobb / privat', 595], 'PG-004': ['Akut / kväll / helg', 695] };
function seedPayroll(fake, year, month) {
  const staff = fake.get('staff');
  const st3 = staff.find((x) => x.id === 'ST-003'); st3.firstName = 'Ann-Charlotte'; st3.lastName = 'Wennerström-Bergqvist';
  fake.set('staff', staff);
  const who = [['ST-002', 'Erik Andersson'], ['ST-003', 'Ann-Charlotte Wennerström-Bergqvist'], ['ST-004', 'Jonas Pettersson'], ['ST-005', 'Sofia Lindgren'], ['ST-001', 'Admin VIFT']];
  const aos = ['AO-001', 'AO-008', 'AO-011', 'AO-012', 'AO-015', 'AO-007', 'AO-013', 'AO-014'];
  const pgs = ['PG-002', 'PG-004', 'PG-001', 'PG-003'];
  const mins = [240, 95, 300, 210, 480, 135, 60, 330];
  const notes = ['Tätning av läckor och slutkontroll', 'Felsökning av cirkulationspump i undercentralen, byte av packning och provtryckning av hela systemet efter åtgärd', '', 'Kabeldragning', 'Akut jour: vattenläcka i källarförråd, avstängning och uppsamling', 'Rondering', '', 'Material hämtat hos grossist'];
  const days = [2, 4, 8, 11, 15, 18, 22, 25];
  const out = [];
  let n = 0;
  who.forEach(([sid, name], wi) => {
    days.forEach((d, di) => {
      if ((wi + di) % 3 === 2) return;
      const m = mins[(wi + di) % mins.length], pg = pgs[(wi + di) % pgs.length];
      const sh = 7 + (di % 3), eh = sh + Math.floor(m / 60), em = m % 60;
      out.push({
        id: 'TE-S' + String(++n).padStart(3, '0'), aoId: aos[(wi * 2 + di) % aos.length], staffId: sid, staffName: name,
        date: year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0'),
        startStr: String(sh).padStart(2, '0') + ':00', endStr: String(eh).padStart(2, '0') + ':' + String(em).padStart(2, '0'), minutes: m,
        comment: notes[(wi + di) % notes.length], priceGroupId: pg, priceGroupName: PG[pg][0], hourRate: PG[pg][1],
        billable: true, internal: false, attested: di < 3 && wi !== 4, createdAt: new Date().toISOString(),
      });
    });
  });
  fake.set('timeEntries', (fake.get('timeEntries') || []).concat(out));
  return out;
}
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return { year: d.getFullYear(), month: d.getMonth() + 1 }; };
const REPORT_TABS = ['oversikt', 'arbetsordrar', 'tid', 'avvikelser', 'ekonomi', 'material', 'serviceintervall', 'offerter'];
const MARKUP = /<\/?(svg|path|span|div|i|b|strong|em|a|button|br|img|small|p|ul|li|table|td|tr|label|input|select|option)\b[^>]*>|&(lt|gt|amp|quot|#39|nbsp);/i;
/* Skiftlägeskänslig och ordavgränsad: "annan" får inte räknas som NaN. */
const JUNK = /\bundefined\b|\bNaN\b|\[object Object\]/;

/* Kontrast mellan text och närmaste ogenomskinliga bakgrund (WCAG). */
const CONTRAST_FN = `(function(el){
  const parse = (c) => { const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  let bg = null, n = el;
  while (n && n.nodeType === 1) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0.99) { bg = c; break; } n = n.parentElement; }
  bg = bg || [255, 255, 255, 1];
  const fg = parse(getComputedStyle(el).color);
  const a = lum(fg), b = lum(bg);
  return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), fg: getComputedStyle(el).color, bg: 'rgb(' + bg.slice(0, 3).join(', ') + ')' };
})`;

/* Sidöverflöd + element utanför fönstret (utom inne i avsiktliga rullytor) + markup som text. */
async function layoutAndMarkup(s, where, hits) {
  const r = await s.eval(([src, junkSrc]) => {
    const re = new RegExp(src, 'i'), junk = new RegExp(junkSrc);
    const vw = document.documentElement.clientWidth;
    const out = [];
    if (document.documentElement.scrollWidth > vw + 1) out.push('sidöverflöd ' + document.documentElement.scrollWidth + ' > ' + vw);
    const root = document.querySelector('.page.active');
    if (!root) return ['ingen aktiv sida'];
    root.querySelectorAll('*').forEach((el) => {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
      const rc = el.getBoundingClientRect();
      if (rc.width === 0 || rc.right <= vw + 1) return;
      let p = el.parentElement, scroller = false;
      while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.id !== 'content-scroll') { scroller = true; break; } p = p.parentElement; }
      if (!scroller) out.push('utanför fönstret: ' + el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' right=' + Math.round(rc.right));
    });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = walker.nextNode())) {
      const el = n.parentElement; if (!el || el.closest('script,style,textarea,code') || !el.offsetParent) continue;
      if (re.test(n.nodeValue) || junk.test(n.nodeValue)) out.push('text: "' + n.nodeValue.trim().slice(0, 50) + '"');
    }
    root.querySelectorAll('[title],[placeholder],[aria-label]').forEach((e) => ['title', 'placeholder', 'aria-label'].forEach((a) => { const v = e.getAttribute(a); if (v && re.test(v)) out.push(a + ': "' + v.slice(0, 50) + '"'); }));
    root.querySelectorAll('option').forEach((o) => { if (re.test(o.textContent)) out.push('option: "' + o.textContent.slice(0, 40) + '"'); });
    return out.slice(0, 4);
  }, [MARKUP.source, JUNK.source]);
  if (r.length) hits.push(where + ' → ' + r.join(' | '));
}

const settingsWrites = (t) => t.fake.calls.filter((c) => c.method === 'POST' && /store-key-write:write/.test(c.action || '') && c.key === 'vift_settings').length;

module.exports = [
  {
    id: 'ARP-01', module: 'Inställningar och administration', kind: 'ui',
    name: 'Admin: alla elva avsnitt nås på 360, 390 och 1366 — grupperad meny på dator, rullista på mobil, inget avsnitt dolt utanför skärmen; Teknik & underhåll ligger sist',
    async run(t) {
      /* Dator: tio knappar i sidomenyn, alla helt synliga och klickbara. */
      const d = await t.world.session({ viewport: 'laptop' });
      await d.login('admin');
      await d.go('pg-admin');
      const nav = await d.eval(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('.page.active .admin-tab')].map((b) => {
          const r = b.getBoundingClientRect();
          let clipped = false, p = b.parentElement;
          while (p && p !== document.body) { const cs = getComputedStyle(p); if (cs.overflowX !== 'visible' && p.id !== 'content-scroll') { const pr = p.getBoundingClientRect(); if (r.left < pr.left - 1 || r.right > pr.right + 1) clipped = true; } p = p.parentElement; }
          const key = ((b.getAttribute('onclick') || '').match(/_tab='([^']+)'/) || [])[1];
          return { key, vis: !!b.offsetParent && r.width > 0, inside: r.left >= 0 && r.right <= vw + 1 && r.top >= 0, clipped, text: b.textContent.trim() };
        });
      });
      t.assert(nav.length === ADMIN_KEYS.length, ADMIN_KEYS.length + ' avsnittsknappar på dator (fick ' + nav.length + ')');
      t.assert(ADMIN_KEYS.every((k) => nav.some((n) => n.key === k)), 'alla nycklar finns: ' + nav.map((n) => n.key).join(','));
      const bad = nav.filter((n) => !n.vis || !n.inside || n.clipped);
      t.assert(bad.length === 0, '1366: alla avsnitt synliga utan att rulla eller klippas: ' + JSON.stringify(bad));
      t.assert(nav.every((n) => !/[<>]/.test(n.text)), 'etiketterna innehåller ingen markup');
      t.assert(nav[nav.length - 1].key === 'teknik', 'Teknik & underhåll är sista avsnittet (' + nav[nav.length - 1].key + ')');
      for (let i = 0; i < nav.length; i++) {
        await d.page.locator('.page.active .admin-tab').nth(i).click();
        await d.settle(120);
        const st = await d.eval(() => ({ tab: AdminPage._tab, main: (document.querySelector('#adm-main') || {}).dataset ? document.querySelector('#adm-main').dataset.tab : null, h2: (document.querySelector('#adm-main .adm-head h2') || {}).textContent, cur: (document.querySelector('.admin-tab[aria-current="page"]') || {}).textContent }));
        t.assert(st.tab === nav[i].key && st.main === nav[i].key, '1366: klick på "' + nav[i].text + '" öppnar ' + nav[i].key + ' (fick ' + st.tab + '/' + st.main + ')');
        t.assert(st.h2 && st.cur && st.cur.trim() === nav[i].text, '1366: rubrik och markerat menyval för ' + nav[i].key);
      }
      /* Titelsökningen ritar bara om listan: fokus kvar, "Visar X av Y" (V3-komponentstandard §5). */
      await d.eval(() => { AdminPage._tab = 'personal'; AdminPage._titleQ = ''; AdminPage.render(); });
      await d.page.locator('.page.active .adm-search input[type=search]').click();
      await d.page.keyboard.type('tekn', { delay: 40 });
      await d.settle(400);
      const srch = await d.eval(() => { const i = document.querySelector('.page.active .adm-search input'); return { focus: document.activeElement === i, val: i.value, count: document.getElementById('adm-title-count').textContent, rows: [...document.querySelectorAll('#adm-title-list .adm-row-n')].map((e) => e.textContent), all: (state.titles || []).length }; });
      t.assert(srch.focus && srch.val === 'tekn', 'sökfältet behåller fokus och hela texten (' + JSON.stringify({ f: srch.focus, v: srch.val }) + ')');
      t.assert(srch.rows.length > 0 && srch.rows.every((n) => /tekn/i.test(n)) && srch.count === 'Visar ' + srch.rows.length + ' av ' + srch.all, 'listan filtreras och antal visas: ' + srch.count + ' ' + srch.rows.join(', '));
      await d.eval(() => { AdminPage._titleQ = ''; });
      /* Mobil 390 och 360: rullista med alla avsnitt, inga dolda flikknappar. */
      for (const vp of ['iphone', 'android']) {
        const m = await t.world.session({ viewport: vp });
        await m.login('admin');
        await m.go('pg-admin');
        const sel = await m.eval(() => {
          const s = document.querySelector('.page.active #adm-nav-select');
          const r = s ? s.getBoundingClientRect() : null;
          const vw = document.documentElement.clientWidth;
          const offTabs = [...document.querySelectorAll('.page.active .admin-tab')].filter((b) => { const q = b.getBoundingClientRect(); return b.offsetParent && q.width > 0 && (q.left < 0 || q.right > vw + 1); }).length;
          return { ok: !!s && !!s.offsetParent, inside: r && r.left >= 0 && r.right <= vw + 1, h: r && r.height, opts: s ? [...s.options].map((o) => o.value) : [], groups: s ? s.querySelectorAll('optgroup').length : 0, offTabs, vw };
        });
        t.assert(sel.ok && sel.inside, vp + ' (' + sel.vw + ' px): avsnittsväljaren syns inom skärmen');
        t.assert(sel.h >= 40, vp + ': väljaren är fingervänlig (' + sel.h + ' px)');
        t.assert(ADMIN_KEYS.every((k) => sel.opts.includes(k)) && sel.opts.length === ADMIN_KEYS.length, vp + ': väljaren har alla ' + ADMIN_KEYS.length + ' avsnitt (' + sel.opts.join(',') + ')');
        t.assert(sel.groups >= 5, vp + ': avsnitten är grupperade (' + sel.groups + ' grupper)');
        t.assert(sel.offTabs === 0, vp + ': inga flikknappar ligger utanför skärmen');
        for (const k of ADMIN_KEYS) {
          await m.page.selectOption('.page.active #adm-nav-select', k);
          await m.settle(120);
          const st = await m.eval(() => ({ tab: AdminPage._tab, main: document.querySelector('#adm-main') && document.querySelector('#adm-main').dataset.tab, val: document.querySelector('.page.active #adm-nav-select').value, sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
          t.assert(st.tab === k && st.main === k && st.val === k, vp + ': rullistan öppnar ' + k + ' (fick ' + JSON.stringify(st) + ')');
          t.assert(st.sw <= st.vw + 1, vp + ' ' + k + ': inget sidöverflöd (' + st.sw + ' > ' + st.vw + ')');
        }
      }
    },
  },
  {
    id: 'ARP-02', module: 'Inställningar och administration', kind: 'ui',
    name: 'Färgkedjan: förval, egen HEX och Standard förhandsvisas utan skrivning, sparas exakt en gång per ändring, övriga inställningar orörda, samma färg i sidomeny/knappar/märken efter omladdning, ny inloggning och på en annan enhet',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-admin');
      await s.eval(() => { AdminPage._tab = 'foretag'; AdminPage.render(); });
      await s.settle(200);
      const before = t.fake.get('settings');
      const w0 = settingsWrites(t);
      const applied = async (sess) => sess.eval(() => {
        const bg = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).backgroundColor : null; };
        return {
          v: getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim().toLowerCase(),
          side: bg('#bottom-nav'),
          btn: bg('.page.active .btn.bp'),
          chip: bg('.page.active .chip.on'),
          badge: bg('.page.active .aol-badge'),
        };
      });
      const rgb = (hex) => 'rgb(' + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')';
      const expectApplied = (a, hex, where) => {
        t.assert(a.v === hex, where + ': --brand-primary = ' + hex + ' (fick ' + a.v + ')');
        t.assert(a.side === rgb(hex), where + ': sidomenyn har färgen (' + a.side + ')');
        t.assert(a.btn === rgb(hex), where + ': primärknapp har färgen (' + a.btn + ')');
        t.assert(a.chip === rgb(hex), where + ': aktivt filter har färgen (' + a.chip + ')');
        t.assert(a.badge === rgb(hex), where + ': räknarmärket har färgen (' + a.badge + ')');
      };

      /* 1. Förvald färg (Skogsgrön) */
      await s.page.locator('#adm-color-primaryColor .adm-preset[data-hex="#14532d"]').click();
      await s.settle(900);
      t.assert(settingsWrites(t) - w0 === 1, 'förval: exakt en skrivning (fick ' + (settingsWrites(t) - w0) + ')');
      t.assert(t.fake.get('settings').primaryColor === '#14532d', 'förval sparat på servern');
      expectApplied(await applied(s), '#14532d', 'förval');
      t.assert(await s.eval(() => document.querySelector('#adm-color-primaryColor .adm-preset[data-hex="#14532d"]').getAttribute('aria-pressed') === 'true'), 'förvalet markeras som valt');
      t.assert(await s.eval(() => document.querySelector('#adm-color-primaryColor .adm-hex').value === '#14532d'), 'HEX-fältet visar förvalet');

      /* 2. Egen HEX: skrivande förhandsvisar utan skrivning, Enter sparar en gång. */
      const hex = s.page.locator('#adm-color-primaryColor .adm-hex');
      await hex.fill('');
      await hex.type('#7A1F3D', { delay: 20 });
      await s.settle(500);
      const prev = await applied(s);
      t.assert(prev.v === '#7a1f3d', 'egen HEX förhandsvisas medan man skriver (' + prev.v + ')');
      t.assert(settingsWrites(t) - w0 === 1, 'ingen skrivning medan man skriver (fick ' + (settingsWrites(t) - w0) + ')');
      await hex.press('Enter');
      await s.settle(900);
      t.assert(settingsWrites(t) - w0 === 2, 'egen HEX: exakt en skrivning till (fick ' + (settingsWrites(t) - w0) + ')');
      t.assert(t.fake.get('settings').primaryColor === '#7a1f3d', 'egen HEX sparad normaliserad (' + t.fake.get('settings').primaryColor + ')');
      t.assert(await s.eval(() => document.querySelector('#adm-color-primaryColor .adm-color-in').value === '#7a1f3d'), 'färgrutan följer HEX-fältet');

      /* 3. Ogiltig HEX: felmarkering, sparad färg återställs, ingen skrivning. */
      await hex.fill('zz12');
      await hex.press('Enter');
      await s.settle(500);
      const inv = await s.eval(() => ({ bad: document.querySelector('#adm-color-primaryColor .adm-hex').classList.contains('is-bad'), v: getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim().toLowerCase(), msg: document.getElementById('adm-color-msg-primaryColor').textContent }));
      t.assert(inv.bad && /Ogiltig/.test(inv.msg), 'ogiltig kod markeras: ' + JSON.stringify(inv));
      t.assert(inv.v === '#7a1f3d', 'ogiltig kod: sparad färg gäller fortfarande (' + inv.v + ')');
      t.assert(settingsWrites(t) - w0 === 2, 'ogiltig kod skriver inget');

      /* 4. Låg kontrast rapporteras (ingen automatik). */
      await hex.fill('#f0f0a0');
      await s.settle(300);
      const warn = await s.eval(() => document.getElementById('adm-color-msg-primaryColor').textContent);
      t.assert(/Låg kontrast/.test(warn), 'ljus färg ger kontrastvarning: ' + warn);
      t.assert(settingsWrites(t) - w0 === 2, 'varningen skriver inget');
      await hex.fill('#7a1f3d'); // tillbaka till sparad färg — oförändrat värde sparas inte igen
      await hex.press('Enter');
      await s.settle(500);
      t.assert(settingsWrites(t) - w0 === 2, 'oförändrat värde skriver inget (' + (settingsWrites(t) - w0) + ')');
      t.assert(await s.eval(() => getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim().toLowerCase() === '#7a1f3d'), 'förhandsvisningen tillbaka på sparad färg');

      /* 5. Övriga inställningar orörda (företagsnamn, bankgiro, sekundärfärg …). */
      const after = t.fake.get('settings');
      const changed = Object.keys(Object.assign({}, before, after)).filter((k) => k !== 'primaryColor' && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      t.assert(changed.length === 0, 'inga andra inställningar ändrade: ' + changed.join(', '));
      t.assert(after.companyName === before.companyName && after.bankgiro === before.bankgiro && after.secondaryColor === before.secondaryColor, 'companyName/bankgiro/sekundärfärg intakta');

      /* 6. Omladdning */
      const wBeforeReload = settingsWrites(t);
      await s.page.reload({ waitUntil: 'load' });
      await s.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id === 'ST-001', null, { timeout: 15000 });
      await s.settle(600);
      await s.go('pg-admin');
      await s.eval(() => { AdminPage._tab = 'foretag'; AdminPage.render(); });
      await s.settle(200);
      expectApplied(await applied(s), '#7a1f3d', 'efter omladdning');
      t.assert(await s.eval(() => document.querySelector('#adm-color-primaryColor .adm-hex').value === '#7a1f3d'), 'efter omladdning: HEX-fältet visar sparad färg');

      /* 7. Utloggning + inloggning */
      await s.eval(() => Auth.logout());
      await s.page.waitForSelector('#login-user', { state: 'visible', timeout: 10000 });
      await s.login('admin');
      await s.go('pg-admin');
      await s.eval(() => { AdminPage._tab = 'foretag'; AdminPage.render(); });
      await s.settle(200);
      expectApplied(await applied(s), '#7a1f3d', 'efter ny inloggning');

      /* 8. Annan enhet */
      const o = await t.world.session({ viewport: 'iphone' });
      await o.login('admin');
      await o.go('pg-admin');
      await o.eval(() => { AdminPage._tab = 'foretag'; AdminPage.render(); });
      await o.settle(200);
      const oa = await applied(o);
      t.assert(oa.v === '#7a1f3d' && oa.btn === rgb('#7a1f3d'), 'annan enhet: samma färg (' + JSON.stringify(oa) + ')');
      t.assert(settingsWrites(t) === wBeforeReload, 'omladdning och inloggningar skriver inte inställningarna (' + (settingsWrites(t) - wBeforeReload) + ')');

      /* 9. Standard: en skrivning, tillbaka till VIFT marinblå. */
      await s.page.locator('#adm-color-primaryColor .adm-color-reset').click();
      await s.settle(900);
      t.assert(settingsWrites(t) - w0 === 3, 'Standard: exakt en skrivning (totalt ' + (settingsWrites(t) - w0) + ' för tre ändringar)');
      t.assert(t.fake.get('settings').primaryColor === '#0f3763', 'standardfärgen sparad');
      expectApplied(await applied(s), '#0f3763', 'standard');
      t.assert(await s.eval(() => document.querySelector('#adm-color-primaryColor .adm-color-reset').hidden), 'Standard-knappen döljs när standardfärgen är vald');
      t.note('skrivningar av vift_settings: ' + (settingsWrites(t) - w0) + ' för 3 sparade ändringar');
    },
  },
  {
    id: 'ARP-03', module: 'Rapporter och statistik', kind: 'ui',
    name: 'Rapporter: vald period syns (kontrast ≥ 4,5:1, aria-pressed), svensk periodetikett, läsbara statusnamn, enhetliga nyckeltal och svenska tal; flikarna nås via rullista på mobil',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-reports');
      await s.eval(() => { ReportsPage._setTab('oversikt'); ReportsPage._setPeriod('month'); });
      await s.settle(200);
      const labels = ['Denna månad', 'Förra månaden', 'Kvartal', 'I år', '12 månader', 'Eget'];
      for (const lb of labels) {
        await s.page.locator('.page.active .rep-seg .ar-seg-b', { hasText: lb }).first().click();
        await s.settle(150);
        const r = await s.eval(([src, label]) => {
          const contrast = eval(src);
          const btns = [...document.querySelectorAll('.page.active .rep-seg .ar-seg-b')];
          const on = btns.filter((b) => b.getAttribute('aria-pressed') === 'true');
          const off = btns.find((b) => b.getAttribute('aria-pressed') !== 'true');
          const c = on[0] ? contrast(on[0]) : null;
          const cOff = off ? contrast(off) : null;
          return { n: on.length, text: on[0] && on[0].textContent.trim(), c, cOff, onBg: on[0] && getComputedStyle(on[0]).backgroundColor, offBg: off && getComputedStyle(off).backgroundColor, onCol: on[0] && getComputedStyle(on[0]).color, offCol: off && getComputedStyle(off).color };
        }, [CONTRAST_FN, lb]);
        t.assert(r.n === 1 && r.text === lb, 'en vald period: ' + lb + ' (fick ' + r.n + ' "' + r.text + '")');
        t.assert(r.c.ratio >= 4.5, lb + ': vald knapp har kontrast ' + r.c.ratio.toFixed(2) + ':1 (' + r.c.fg + ' på ' + r.c.bg + ')');
        t.assert(r.cOff.ratio >= 4.5, lb + ': ovald knapp läsbar ' + r.cOff.ratio.toFixed(2) + ':1');
        t.assert(r.onBg !== r.offBg || r.onCol !== r.offCol, lb + ': vald och ovald skiljer sig visuellt');
      }
      await s.eval(() => ReportsPage._setPeriod('month'));
      await s.settle(150);
      const p = await s.eval(() => {
        const pg = document.querySelector('.page.active');
        const range = pg.querySelector('.rep-range').textContent.replace(/\s+/g, ' ');
        const bars = [...pg.querySelectorAll('.rep-bar-l')].map((e) => ({ t: e.textContent.trim(), deco: getComputedStyle(e).textDecorationLine }));
        const kpis = [...pg.querySelectorAll('.ar-kpi')].map((k) => ({ order: [...k.children].map((c) => c.className.replace('ar-kpi-', '')).join(','), align: getComputedStyle(k.querySelector('.ar-kpi-l')).textAlign, n: k.querySelector('.ar-kpi-n').textContent.trim() }));
        return { range, bars, kpis, text: pg.innerText };
      });
      t.assert(/Visar (januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december) \d{4}/.test(p.range), 'periodetikett i svensk form: ' + p.range);
      t.assert(!/\b(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec) \d{2} \d{4}\b/.test(p.text), 'inga "nov 26 2026"-etiketter kvar');
      t.assert(['Arbetspool', 'Planerad', 'Pågående', 'Klar'].every((n) => p.bars.some((b) => b.t === n)), 'statusnamn läsbara: ' + p.bars.map((b) => b.t).join(', '));
      t.assert(p.bars.every((b) => b.deco === 'none'), 'statusnamn är inte understrukna i vila');
      t.assert(p.kpis.length >= 8 && p.kpis.every((k) => /^ico,l,n(,s)?$/.test(k.order) && (k.align === 'left' || k.align === 'start')), 'nyckeltal har samma struktur och vänsterställd etikett: ' + JSON.stringify(p.kpis.slice(0, 2)));
      const money = p.kpis.map((k) => k.n.replace(/[\u00a0\u202f]/g, ' ')).filter((n) => /kr/.test(n));
      t.assert(money.every((n) => /^\d{1,3}( \d{3})* kr(\/mån)?$/.test(n)), 'belopp i svensk form: ' + money.join(' | '));
      const hours = p.kpis.map((k) => k.n).filter((n) => / h$/.test(n));
      t.assert(hours.length && hours.every((n) => /^\d+(,\d)? h$/.test(n)), 'timmar med decimalkomma: ' + hours.join(' | '));
      for (const tab of ['tid', 'ekonomi', 'material', 'offerter']) {
        await s.eval((k) => { ReportsPage._setPeriod('12months'); ReportsPage._setTab(k); }, tab);
        await s.settle(150);
        const txt = await s.eval(() => [...document.querySelectorAll('.page.active .ar-kpi-n, .page.active .rep-bar-v')].map((e) => e.textContent).join(' | '));
        t.assert(!/\d\.\d/.test(txt), tab + ': inga decimalpunkter i nyckeltal/staplar: ' + txt.slice(0, 160));
      }
      /* Mobil: flikarna nås via rullista, ingen flikrad dold. */
      const m = await t.world.session({ viewport: 'android' });
      await m.login('admin');
      await m.go('pg-reports');
      const ms = await m.eval(() => { const sel = document.querySelector('.page.active .rep-view-sel select'); return { vis: !!(sel && sel.offsetParent), opts: sel ? [...sel.options].map((o) => o.value) : [], tabsVisible: !!(document.querySelector('.page.active .rep-views') || {}).offsetParent }; });
      t.assert(ms.vis && REPORT_TABS.every((k) => ms.opts.includes(k)), '360: rapportväljaren har alla åtta rapporter');
      t.assert(!ms.tabsVisible, '360: ingen flikrad som kan klippas');
      await m.page.selectOption('.page.active .rep-view-sel select', 'offerter');
      await m.settle(200);
      t.assert(await m.eval(() => /Topp kunder/.test(document.querySelector('.page.active').innerText)), '360: rullistan byter till Offerter');
    },
  },
  {
    id: 'ARP-04', module: 'Rapporter och statistik', kind: 'ui',
    name: 'Tabeller ryms i sina kort på 360 och 390 med realistiskt löneunderlag (Rapporter → Offerter, Löneunderlag: fem personer, fyra veckor, långa namn) och har rubrikrad, cellutfyllnad, zebra och fast rubrik på dator',
    async run(t) {
      const pm = prevMonth();
      seedPayroll(t.fake, pm.year, pm.month);
      const check = async (sess, where) => sess.eval((w) => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('.page.active table')].map((tb) => {
          const card = tb.closest('.ar-card') || tb.parentElement;
          const r = tb.getBoundingClientRect(), c = card.getBoundingClientRect();
          return { where: w, w: Math.round(r.width), cw: Math.round(c.width), right: Math.round(r.right), vw, sw: tb.scrollWidth, cl: tb.clientWidth || Math.round(r.width) };
        });
      }, where);
      for (const vp of ['iphone', 'android']) {
        const s = await t.world.session({ viewport: vp });
        await s.login('admin');
        await s.go('pg-reports');
        await s.eval(() => { ReportsPage._setPeriod('12months'); ReportsPage._setTab('offerter'); });
        await s.settle(250);
        const rep = await check(s, vp + ' rapporter/offerter');
        t.assert(rep.length >= 1, vp + ': Topp kunder-tabellen finns');
        await s.go('pg-payroll');
        await s.eval((p) => PayrollPage._navMonth(p.year, p.month), pm);
        await s.settle(250);
        const pay = await check(s, vp + ' löneunderlag');
        t.assert(pay.length >= 5, vp + ': en tabell per person (' + pay.length + ')');
        const bad = rep.concat(pay).filter((x) => x.w > x.cw + 1 || x.right > x.vw + 1 || x.sw > x.cl + 2);
        t.assert(bad.length === 0, vp + ': ingen tabell bredare än sitt kort/fönstret: ' + JSON.stringify(bad));
        const card = await s.eval(() => { const tr = document.querySelector('.page.active .pay-tbl tbody tr'); const th = document.querySelector('.page.active .pay-tbl thead'); return { disp: getComputedStyle(tr).display, head: getComputedStyle(th).display }; });
        t.assert(card.disp === 'grid' && card.head === 'none', vp + ': löneraderna visas som kort på mobil');
        const longName = await s.eval(() => { const h = [...document.querySelectorAll('.page.active .pay-who-t h3')].find((x) => /Wennerström/.test(x.textContent)); if (!h) return null; const r = h.getBoundingClientRect(); return { right: Math.round(r.right), vw: document.documentElement.clientWidth }; });
        t.assert(longName && longName.right <= longName.vw, vp + ': långt namn ryms (' + JSON.stringify(longName) + ')');
      }
      const d = await t.world.session({ viewport: 'laptop' });
      await d.login('ekonomi');
      await d.go('pg-payroll');
      await d.eval((p) => PayrollPage._navMonth(p.year, p.month), pm);
      await d.settle(250);
      const st = await d.eval(() => {
        const td = document.querySelector('.page.active .pay-tbl tbody td');
        const th = document.querySelector('.page.active .pay-tbl thead th');
        const rows = [...document.querySelectorAll('.page.active .pay-tbl tbody tr')];
        const bg = rows.slice(0, 2).map((r) => getComputedStyle(r.querySelector('td')).backgroundColor);
        /* Värde och kommentar får inte flyta ihop (F-04): mellanrum mellan cellernas text. */
        const cost = document.querySelector('.page.active .pay-tbl tbody td.c-cost'), note = document.querySelector('.page.active .pay-tbl tbody td.c-note');
        const range = document.createRange(); range.selectNodeContents(cost); const cr = range.getBoundingClientRect();
        range.selectNodeContents(note); const nr = range.getBoundingClientRect();
        return { padL: parseFloat(getComputedStyle(td).paddingLeft), padR: parseFloat(getComputedStyle(td).paddingRight), padT: parseFloat(getComputedStyle(td).paddingTop), sticky: getComputedStyle(th).position, upper: getComputedStyle(th).textTransform, zebra: bg[0] !== bg[1], gap: Math.round(nr.left - cr.right), h1: document.querySelectorAll('#pg-payroll-content h1, #pg-payroll-content h2').length, numAlign: getComputedStyle(document.querySelector('.page.active .pay-tbl td.c-hrs')).textAlign };
      });
      t.assert(st.padL >= 12 && st.padR >= 12 && st.padT >= 8, 'dator: cellutfyllnad minst 8 × 12 px (' + st.padT + '/' + st.padL + ')');
      t.assert(st.sticky === 'sticky' && st.upper === 'uppercase', 'dator: fast rubrikrad i versaler (' + st.sticky + ', ' + st.upper + ')');
      t.assert(st.zebra, 'dator: varannan rad har egen bakgrund');
      t.assert(st.numAlign === 'right', 'dator: timmar högerställda');
      t.assert(st.gap >= 16, 'dator: värde och kommentar har luft emellan (' + st.gap + ' px)');
      t.assert(st.h1 === 0, 'löneunderlaget upprepar inte sidrubriken (toppraden har den)');
    },
  },
  {
    id: 'ARP-05', module: 'Tidregistrering och instämpling', kind: 'ui',
    name: 'Löneunderlag låser nuvarande beräkning: "Debiterbart värde" = timmar × tidpostens prisgruppspris (inte lönekostnad), "Intern kostnad (uppskattad)" = timmar × internalHourlyCost och döljs när värdet saknas; timmar i svensk form; attestering via kryssruta och "Attestera alla" går till servern',
    async run(t) {
      const pm = prevMonth();
      const seeded = seedPayroll(t.fake, pm.year, pm.month);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('ekonomi');
      await s.go('pg-payroll');
      await s.eval((p) => PayrollPage._navMonth(p.year, p.month), pm);
      await s.settle(300);
      const minutesBefore = JSON.stringify((t.fake.get('timeEntries') || []).map((e) => [e.id, e.minutes, e.hourRate]));
      const ym = pm.year + '-' + String(pm.month).padStart(2, '0');
      const inMonth = (t.fake.get('timeEntries') || []).filter((e) => (e.date || '').slice(0, 7) === ym);
      const kr = (n) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 }).format(n).replace(/[  ]/g, ' ');
      const hfmt = (m) => new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(m / 60) + ' h';
      const totMin = inMonth.reduce((a, e) => a + e.minutes, 0);
      const totVal = inMonth.reduce((a, e) => a + e.minutes / 60 * e.hourRate, 0);
      const ihc = t.fake.get('settings').internalHourlyCost;
      const r = await s.eval(() => {
        const pg = document.querySelector('#pg-payroll-content');
        const kpis = {};
        pg.querySelectorAll('.ar-kpi').forEach((k) => { kpis[k.querySelector('.ar-kpi-l').textContent.trim()] = k.querySelector('.ar-kpi-n').textContent.replace(/[  ]/g, ' ').trim(); });
        const rows = [...pg.querySelectorAll('.pay-tbl tbody tr')].map((tr) => ({ id: tr.querySelector('input[data-id]').dataset.id, hrs: tr.querySelector('td.c-hrs').textContent.trim(), val: tr.querySelector('.pay-val').textContent.replace(/[  ]/g, ' ').trim(), rate: tr.querySelector('.pay-rate').textContent.replace(/[  ]/g, ' ').trim() }));
        return { kpis, rows, heads: [...pg.querySelectorAll('.pay-tbl thead th')].map((h) => h.textContent.trim()), text: pg.innerText, all: pg.textContent, summary: (pg.querySelector('.pay-def summary') || {}).textContent || '' };
      });
      t.note('nyckeltal: ' + JSON.stringify(r.kpis));
      t.assert(seeded.every((x) => inMonth.some((e) => e.id === x.id)) && r.rows.length === inMonth.length, 'alla ' + inMonth.length + ' poster i månaden visas (' + r.rows.length + ')');
      t.assert(r.kpis['Totalt'] === hfmt(totMin), 'Totalt = summan av lagrade minuter (' + r.kpis['Totalt'] + ' = ' + hfmt(totMin) + ')');
      t.assert(r.kpis['Debiterbart värde'] === kr(totVal), 'Debiterbart värde = Σ timmar × hourRate (' + r.kpis['Debiterbart värde'] + ' = ' + kr(totVal) + ')');
      t.assert(r.kpis['Intern kostnad (uppskattad)'] === kr(totMin / 60 * ihc), 'Intern kostnad = timmar × ' + ihc + ' kr/h (' + r.kpis['Intern kostnad (uppskattad)'] + ')');
      t.assert(!Object.keys(r.kpis).some((k) => /lönekostnad/i.test(k)), 'inget nyckeltal kallas lönekostnad: ' + Object.keys(r.kpis).join(', '));
      t.assert(r.heads.includes('Debiterbart värde') && !r.heads.some((h) => /^Kostnad$/i.test(h)), 'kolumnen heter Debiterbart värde: ' + r.heads.join(', '));
      for (const row of r.rows) {
        const e = inMonth.find((x) => x.id === row.id);
        t.assert(row.val === kr(e.minutes / 60 * e.hourRate), row.id + ': värde = ' + e.minutes + ' min × ' + e.hourRate + ' kr/h (' + row.val + ')');
        t.assert(row.hrs === hfmt(e.minutes) && /^\d+(,\d{1,2})? h$/.test(row.hrs), row.id + ': timmar i svensk form (' + row.hrs + ')');
        t.assert(row.rate === new Intl.NumberFormat('sv-SE').format(e.hourRate).replace(/[  ]/g, ' ') + ' kr/h', row.id + ': prisgruppens timpris visas (' + row.rate + ')');
      }
      t.assert(/lönekostnad finns inte/.test(r.summary) && /inte lönekostnad/.test(r.text) && /saknar lönedata/.test(r.all), 'synlig förklaring: värdet är inte lönekostnad och lönedata saknas (' + r.summary + ')');
      t.assert(!/\d+\.\d{2}\b/.test(r.text), 'inga "26.50"-tal kvar i vyn');
      /* Saknas internalHourlyCost (t.ex. roll utan läsrätt) visas ingen intern kostnad. */
      const noIhc = await s.eval(() => { const keep = state.settings.internalHourlyCost; delete state.settings.internalHourlyCost; PayrollPage.render(); const has = /Intern kostnad/.test(document.querySelector('#pg-payroll-content').innerText); state.settings.internalHourlyCost = keep; PayrollPage.render(); return has; });
      t.assert(!noIhc, 'utan internalHourlyCost visas ingen intern kostnad (inget påhittat standardvärde)');
      t.assert(JSON.stringify((t.fake.get('timeEntries') || []).map((e) => [e.id, e.minutes, e.hourRate])) === minutesBefore, 'lagrade minuter och timpriser oförändrade');
      /* Kryssruta → server */
      const id = await s.eval(() => document.querySelector('.page.active .pay-tbl tbody input[type=checkbox]:not(:checked)').dataset.id);
      await s.page.locator('.page.active .pay-tbl tbody input[data-id="' + id + '"]').check();
      for (let i = 0; i < 40 && !((t.fake.get('timeEntries') || []).find((e) => e.id === id) || {}).attested; i++) await s.settle(100);
      t.assert(t.fake.get('timeEntries').find((e) => e.id === id).attested === true, 'kryssrutan attesterar på servern');
      await s.settle(300);
      t.assert(await s.eval((x) => { const i = document.querySelector('.page.active .pay-tbl input[data-id="' + x + '"]'); return i.checked && /Attesterad/.test(i.closest('label').textContent); }, id), 'raden visar Attesterad efter serverns svar');
      /* Attestera alla för första personen som har oattesterade poster */
      const sid = await s.eval(() => document.querySelector('.page.active .pay-card [data-id][onclick*="_attestAll"]').dataset.id);
      await s.clearToasts();
      await s.page.locator('.page.active .pay-card button[onclick*="_attestAll"]').first().click();
      await s.waitToast(/attesterade/i, 8000);
      const toastsNow = await s.toasts();
      t.assert(toastsNow.some((m) => /^Alla poster attesterade/.test(m)) && !toastsNow.some((m) => /misslyckades/.test(m)), 'besked utan falska misslyckanden: ' + toastsNow.join(' / '));
      const left = (t.fake.get('timeEntries') || []).filter((e) => e.staffId === sid && !e.attested && (e.date || '').slice(0, 7) === ym);
      t.assert(left.length === 0, '"Attestera alla" attesterar personens poster på servern (kvar: ' + left.length + ')');
      /* Arbetsledaren saknar löneunderlag helt (behörighet oförändrad). */
      const c = await t.world.session({ viewport: 'laptop' });
      await c.login('chef');
      t.assert(await c.eval(() => !Auth.canViewPage('pg-payroll')), 'arbetsledaren nekas löneunderlaget');
    },
  },
  {
    id: 'ARP-06', module: 'Säkerhet', kind: 'ui',
    name: 'Admin, Rapporter och Löneunderlag: inget sidöverflöd och inget utanför fönstret 360–1920; ingen markup (t.ex. "<svg") eller undefined/NaN som text i någon flik; push-diagnostiken ligger i Teknik & underhåll',
    async run(t) {
      const pm = prevMonth();
      seedPayroll(t.fake, pm.year, pm.month);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      const hits = [];
      for (const w of [360, 390, 768, 1024, 1366, 1920]) {
        await s.page.setViewportSize({ width: w, height: w < 500 ? 780 : 900 });
        await s.settle(150);
        const full = w === 360 || w === 1366;
        for (const k of (full ? ADMIN_KEYS : ['foretag', 'personal', 'notiser', 'teknik'])) {
          await s.eval((x) => { try { Modal.close(); } catch (e) {} Router.showPage('pg-admin', {}); AdminPage._tab = x; AdminPage.render(); }, k);
          await s.settle(k === 'notiser' || k === 'teknik' ? 400 : 120);
          await layoutAndMarkup(s, w + ' admin/' + k, hits);
        }
        for (const k of (full ? REPORT_TABS : ['oversikt', 'offerter'])) {
          await s.eval((x) => { Router.showPage('pg-reports', {}); ReportsPage._setPeriod('12months'); ReportsPage._setTab(x); }, k);
          await s.settle(120);
          await layoutAndMarkup(s, w + ' rapporter/' + k, hits);
        }
        await s.eval((p) => { Router.showPage('pg-payroll', {}); PayrollPage._navMonth(p.year, p.month); }, pm);
        await s.settle(200);
        await layoutAndMarkup(s, w + ' löneunderlag', hits);
      }
      /* F-21 + QA-tillägg: diagnostiken visas inte i Notiser utan i Teknik & underhåll. */
      await s.page.setViewportSize({ width: 1366, height: 768 });
      await s.eval(() => { Router.showPage('pg-admin', {}); AdminPage._tab = 'notiser'; AdminPage.render(); });
      await s.settle(500);
      const noti = await s.eval(() => ({ diag: !!document.getElementById('push-diag-box'), perm: /Notification\.permission/.test(document.querySelector('.page.active').innerText), det: !!document.querySelector('.page.active details.adm-test-det:not([open])') }));
      t.assert(!noti.diag && !noti.perm && noti.det, 'Notiser visar ingen teknisk diagnostik; testdetaljer ihopfällda: ' + JSON.stringify(noti));
      await s.eval(() => { AdminPage._tab = 'teknik'; AdminPage.render(); });
      await s.settle(600);
      const tech = await s.eval(() => { const box = document.getElementById('push-diag-box'); const txt = box ? box.textContent : ''; return { box: !!box, hasDiag: /Notification\.permission/.test(txt), h2: (document.querySelector('#adm-main .adm-head h2') || {}).textContent, noSecret: !/eyJ|BEGIN|private|https?:\/\/[^\s]*\/push\//i.test(txt) }; });
      t.assert(tech.box && tech.hasDiag && /Teknisk information och underhåll/.test(tech.h2 || ''), 'diagnostiken finns i Teknik & underhåll: ' + JSON.stringify(tech));
      t.assert(tech.noSecret, 'diagnostiken visar inga JWT/nycklar/hela endpoint-URL:er');
      t.assert(hits.length === 0, 'layout/markup-fel: ' + hits.slice(0, 8).join(' ;; '));
    },
  },
  {
    id: 'ARP-07', module: 'Inställningar och administration', kind: 'ui',
    name: '"Rensa lokal cache på den här enheten": tydlig text (servern påverkas inte, du förblir inloggad), osparade ändringar kräver två bekräftelser med antal, rensning behåller inloggning och logotyper och rör inte serverns data; bara admin',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-admin');
      await s.eval(() => { AdminPage._tab = 'teknik'; AdminPage.render(); });
      await s.settle(300);
      const ui = await s.eval(() => { const m = document.querySelector('#adm-main'); return { text: m.innerText, btn: [...m.querySelectorAll('button.bd')].map((b) => b.textContent.trim()) }; });
      t.assert(ui.btn.includes('Rensa lokal cache på den här enheten'), 'knappen heter "Rensa lokal cache på den här enheten": ' + ui.btn.join(' | '));
      t.assert(/Serverns data påverkas inte/.test(ui.text) && /förblir inloggad/.test(ui.text), 'texten säger att serverns data inte påverkas och att man förblir inloggad');
      t.assert(!/demodata/i.test(ui.text), 'den missvisande "demodata"-texten är borta');
      /* Spärr: osparade ändringar i kön → två bekräftelser med antal; nej = inget rensas. */
      const writesBefore = t.fake.calls.filter((c) => c.method === 'POST').length;
      const serverBefore = JSON.stringify({ c: t.fake.get('customers'), s: t.fake.get('settings'), a: t.fake.get('workOrders') });
      const r1 = await s.eval(() => {
        localStorage.setItem('vift_e2e_marker', '1');
        window.__msgs = []; window.__answers = [false];
        window.confirm = (m) => { window.__msgs.push(m); return window.__answers.length ? window.__answers.shift() : false; };
        AOTimeSyncService.__pc = AOTimeSyncService.pendingCount; AOTimeSyncService.pendingCount = () => 2;
        AdminPage.render();
        const note = document.getElementById('adm-unsynced').innerText;
        AdminPage._clearLocalCache();
        const first = { msgs: window.__msgs.slice(), marker: localStorage.getItem('vift_e2e_marker'), note };
        window.__msgs = []; window.__answers = [true, false];
        AdminPage._clearLocalCache();
        return { first, second: { msgs: window.__msgs.slice(), marker: localStorage.getItem('vift_e2e_marker') } };
      });
      t.assert(/2 ändringar på den här enheten är inte sparade/.test(r1.first.note), 'avsnittet visar antalet osparade ändringar: ' + r1.first.note);
      t.assert(r1.first.msgs.length === 1 && /2 ändringar/.test(r1.first.msgs[0]) && r1.first.marker === '1', 'första bekräftelsen visar antalet; nej rensar inget');
      t.assert(r1.second.msgs.length === 2 && /Bekräfta igen/.test(r1.second.msgs[1]) && r1.second.marker === '1', 'andra bekräftelsen krävs; nej rensar inget');
      /* Inga osparade ändringar: en bekräftelse, rensning, omladdning — fortfarande inloggad. */
      await s.eval(() => { AOTimeSyncService.pendingCount = AOTimeSyncService.__pc; window.__msgs = []; window.__answers = [true]; localStorage.setItem('vift_logo_light', 'data:image/png;base64,iVBORw0KGgo='); });
      await Promise.all([s.page.waitForNavigation({ waitUntil: 'load' }), s.eval(() => AdminPage._clearLocalCache())]);
      await s.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id === 'ST-001', null, { timeout: 15000 });
      const after = await s.eval(() => ({ marker: localStorage.getItem('vift_e2e_marker'), session: !!localStorage.getItem('vift_auth_v2'), logo: localStorage.getItem('vift_logo_light') }));
      t.assert(after.marker === null, 'lokala data rensade');
      t.assert(after.session, 'inloggningen behålls');
      t.assert(after.logo === 'data:image/png;base64,iVBORw0KGgo=', 'uppladdad logotyp (finns bara lokalt) behålls');
      t.assert(JSON.stringify({ c: t.fake.get('customers'), s: t.fake.get('settings'), a: t.fake.get('workOrders') }) === serverBefore, 'serverns data oförändrad');
      const deletes = t.fake.calls.slice(writesBefore).filter((c) => /delete/i.test(c.action || ''));
      t.assert(deletes.length === 0, 'inga raderingsanrop till servern');
      /* Bara admin_manage: fältarbetaren kan inte köra rensningen. */
      const f = await t.world.session({ viewport: 'iphone' });
      await f.login('falt');
      const fr = await f.eval(() => { localStorage.setItem('vift_e2e_marker', '1'); window.confirm = () => true; AdminPage._clearLocalCache(); return localStorage.getItem('vift_e2e_marker'); });
      t.assert(fr === '1', 'fältarbetaren kan inte rensa (kräver admin_manage)');
    },
  },
];

module.exports.seedPayroll = seedPayroll;
module.exports.prevMonth = prevMonth;
