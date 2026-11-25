'use strict';
/* V3 register 2026-11-26 (arbetsblock "register"): Kunder, Fastigheter,
   Artiklar, Prisgrupper, Personal, Offerttjänster och Uppgifter följer
   docs/V3-KOMPONENTSTANDARD.md — verktygsrad (sök + "⋮" + EN primär
   åtgärd), .ftabs för status/vy, .chip för typ/kategori/snabbval,
   "Visar X av Y", tabell på dator och ett kort per rad på mobil,
   begränsad bredd på 1920 (F-23), åtgärder i radmeny (F-19/F-20),
   inga ikoner på egen rad (F-02).
   Realistiskt innehåll i den simulerade servern: 100+ poster per register,
   långa namn, saknade fält, inaktiva poster och flera roller.
   Simulerad server — ingen trafik till STAGING eller LIVE. */

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const LONG = 'Bostadsrättsföreningen Kvarteret Långa Namnets Gemensamma Förvaltning i Upplands Väsby';

/* Fyller den simulerade servern med realistiskt innehåll (samma i varje test). */
function seed(fake) {
  const now = new Date().toISOString();
  const types = ['foretag', 'brf', 'fastighetsagare', 'privat', 'company'];
  const cus = fake.get('customers');
  for (let i = 1; i <= 140; i++) {
    const t = types[i % types.length];
    const c = { id: 'KR-' + String(i).padStart(3, '0'), type: t, createdAt: now, contacts: [] };
    if (t === 'privat') { c.firstName = 'Förnamn' + i; c.lastName = i % 7 === 0 ? 'Efternamnsson-Långdubbelnamn' : 'Svensson'; c.name = c.lastName; }
    else c.name = (i % 9 === 0 ? LONG + ' ' + i : 'Registerkund ' + i + ' AB');
    if (i % 3) c.phone = '070-' + String(100000 + i).slice(0, 3) + ' ' + String(i).padStart(2, '0') + ' 00';
    if (i % 4) c.city = i % 11 === 0 ? 'Upplands Väsby med ett mycket långt ortsnamn' : 'Stockholm';
    if (i % 5 === 0) c.email = 'kontakt' + i + '@en-mycket-lang-doman-for-test.example';
    if (t !== 'privat' && i % 2) c.orgNr = '556' + String(100 + i).slice(-3) + '-' + String(1000 + i * 7).slice(-4);
    if (i % 6 === 0) c.contactPerson = 'Kontaktperson Med Långt Namn ' + i;
    if (i % 12 === 0) c.inactive = true;
    cus.push(c);
  }
  fake.set('customers', cus);
  const props = fake.get('properties');
  for (let i = 1; i <= 120; i++) {
    const p = { id: 'OR-' + String(i).padStart(3, '0'), name: i % 10 === 0 ? 'Fastigheten ' + LONG + ' hus ' + i : 'Registerfastighet ' + i, status: i % 15 === 0 ? 'inaktiv' : 'aktiv', createdAt: now };
    if (i % 4) { p.address = 'Registervägen ' + i; p.zip = '123 ' + String(i).padStart(2, '0'); p.city = 'Solna'; }
    if (i % 3) p.customerId = 'KR-' + String((i % 140) + 1).padStart(3, '0');
    if (i % 2) { p.type = 'Flerbostadshus'; p.area = 1000 + i * 10; }
    props.push(p);
  }
  fake.set('properties', props);
  const arts = fake.get('articles');
  const cats = ['kemikalier', 'material', 'forbruk', 'arbete', 'kostnad'];
  for (let i = 1; i <= 110; i++) {
    arts.push({ id: 'AR-' + String(i).padStart(3, '0'), articleNumber: String(9000 + i), name: i % 8 === 0 ? 'Artikel med en mycket lång benämning som inte får trycka ut kolumnerna ' + i : 'Registerartikel ' + i,
      category: cats[i % cats.length], unit: i % 2 ? 'st' : 'förp.', buyPrice: i % 5 ? 50 + i : 0, sellPrice: 100 + i * 2, vatRate: 25, active: i % 13 !== 0 });
  }
  fake.set('articles', arts);
  const staff = fake.get('staff');
  for (let i = 1; i <= 30; i++) {
    staff.push({ id: 'SR-' + String(i).padStart(3, '0'), firstName: i % 6 === 0 ? 'Maximilian-Alexander' : 'Person' + i, lastName: i % 6 === 0 ? 'Johansson-Långström' : 'Registersson',
      title: i % 3 ? 'Fastighetstekniker' : '', phone: i % 4 ? '073-' + (200 + i) + ' 11 22' : '', email: i % 2 ? 'p' + i + '@example.test' : '', username: 'reg' + i, role: ['personal', 'chef', 'ekonomi'][i % 3], active: i % 9 !== 0, permissions: [] });
  }
  fake.set('staff', staff);
  const acts = fake.get('activities') || [];
  const base = { type: 'task', createdAt: now, createdBy: 'ST-001', completedAt: null, completedBy: null };
  for (let i = 1; i <= 40; i++) {
    acts.push(Object.assign({}, base, { id: 'ACT-R' + i, title: i % 7 === 0 ? 'Uppgift med en riktigt lång titel som ska radbrytas snyggt på mobilen ' + i : 'Registeruppgift ' + i,
      status: i % 5 === 0 ? 'done' : 'open', completedAt: i % 5 === 0 ? now : null, assignedTo: ['ST-001', 'ST-002', 'ST-003', null][i % 4], dueDate: i % 6 === 0 ? null : day((i % 9) - 4),
      priority: i % 8 === 0 ? 'hög' : 'normal', customerId: i % 3 === 0 ? 'K-001' : undefined }));
  }
  fake.set('activities', acts);
}

const rows = (s, list) => s.eval((sel) => document.querySelectorAll(sel + ' tr.rg-row').length, list);
const countText = (s) => s.eval(() => (document.querySelector('.page.active .rg-count-t') || {}).textContent || '');
async function typeSearch(s, sel, text) {
  await s.page.fill(sel, text);
  await s.settle(450); // sökningen har 150 ms fördröjning
}
async function clickChip(s, label) {
  await s.page.locator('.page.active .rg-chips .chip', { hasText: label }).first().click();
  await s.settle(200);
}
async function clickTab(s, label) {
  await s.page.locator('.page.active .rg-filters .ft', { hasText: label }).first().click();
  await s.settle(200);
}
/* Öppnar en ⋮-meny och returnerar menyposternas texter (och kontrollerar att menyn syns helt i fönstret). */
async function openMenu(s, btnLocator) {
  await btnLocator.click();
  await s.settle(150);
  return s.eval(() => {
    const m = document.querySelector('.ao-overflow-menu.open');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { items: [...m.querySelectorAll('[role=menuitem]')].map((b) => b.textContent.trim()), inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  });
}

const MARKUP = /<\/?(svg|path|span|div|button|br|img|small|p|b|strong)\b[^>]*>|&(lt|gt|amp|quot|#39|nbsp);|\bundefined\b|\bNaN\b|\[object Object\]/i;

/* Layoutkontroller i aktiv sida (V3-KOMPONENTSTANDARD §1, §2, §7; F-02, F-23). */
function layoutProbe(markupSrc) {
  const re = new RegExp(markupSrc, 'i');
  const vw = document.documentElement.clientWidth;
  const pg = document.querySelector('.page.active');
  const rg = pg.querySelector('.rg');
  const out = { overflow: document.documentElement.scrollWidth > vw + 1, clipped: [], offscreen: [], noName: [], svgBlock: 0, markup: [], rgW: rg ? Math.round(rg.getBoundingClientRect().width) : -1, rowDisplay: null, h: [] };
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  pg.querySelectorAll('button, a.btn, .chip, .ft, .bdg').forEach((b) => {
    if (!vis(b)) return;
    const r = b.getBoundingClientRect();
    const t = (b.textContent || '').trim();
    if (b.scrollWidth > b.clientWidth + 1) out.clipped.push(t.slice(0, 30));
    if (r.right > vw + 1 || r.left < -1) out.offscreen.push(t.slice(0, 30) || b.getAttribute('aria-label'));
    if (/^(BUTTON|A)$/.test(b.tagName) && !t && !(b.getAttribute('aria-label') || b.getAttribute('title'))) out.noName.push(b.outerHTML.slice(0, 80));
  });
  /* F-02 (samma definition som UI-UX-inventeringen): synlig svg med display:block
     i ett element som inte är flex/grid och som också innehåller text. */
  if (rg) rg.querySelectorAll('svg').forEach((svg) => {
    const p = svg.parentElement;
    if (!vis(svg) || !p || getComputedStyle(svg).display !== 'block') return;
    if (/flex|grid/.test(getComputedStyle(p).display)) return;
    if ((p.textContent || '').trim()) out.svgBlock++;
  });
  const walker = document.createTreeWalker(pg, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode())) { const el = n.parentElement; if (el && el.offsetParent && re.test(n.nodeValue)) out.markup.push(n.nodeValue.trim().slice(0, 50)); }
  pg.querySelectorAll('[title],[placeholder],[aria-label]').forEach((e) => ['title', 'placeholder', 'aria-label'].forEach((a) => { const v = e.getAttribute(a); if (v && (re.test(v) || v.includes('<'))) out.markup.push(a + ': ' + v.slice(0, 50)); }));
  const row = pg.querySelector('tr.rg-row');
  if (row) out.rowDisplay = getComputedStyle(row).display;
  pg.querySelectorAll('h1, h2').forEach((h) => { if (vis(h)) out.h.push(h.textContent.trim()); });
  return out;
}

const PAGES = ['pg-crm', 'pg-objects', 'pg-articles', 'pg-pricegroups', 'pg-staff', 'pg-service-templates', 'pg-activities'];
async function layoutAt(t, widths) {
  const lib = require('../lib');
  for (const w of widths) {
    const key = 'reg' + w;
    lib.VIEWPORTS[key] = w < 640 ? { viewport: { width: w, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } : { viewport: { width: w, height: 900 }, deviceScaleFactor: 1 };
    const s = await t.world.session({ viewport: key });
    await s.login('admin');
    for (const pg of PAGES) {
      await s.go(pg);
      await s.settle(150);
      const r = await s.eval(layoutProbe, MARKUP.source);
      const where = w + ' px ' + pg;
      t.assert(!r.overflow, where + ': ingen vågrät sidrullning');
      t.assert(r.clipped.length === 0, where + ': ingen avklippt knapp-, flik- eller märkestext ' + JSON.stringify(r.clipped.slice(0, 4)));
      t.assert(r.offscreen.length === 0, where + ': inga knappar utanför skärmen ' + JSON.stringify(r.offscreen.slice(0, 4)));
      t.assert(r.noName.length === 0, where + ': ikonknappar har aria-label/title ' + JSON.stringify(r.noName.slice(0, 2)));
      t.assert(r.svgBlock === 0, where + ': inga ikoner på egen rad (F-02), ' + r.svgBlock + ' st');
      t.assert(r.markup.length === 0, where + ': ingen markup som text ' + JSON.stringify(r.markup.slice(0, 3)));
      t.assert(r.h.length === 0, where + ': sidrubriken upprepas inte som h1/h2 i sidan (S-03) ' + JSON.stringify(r.h));
      if (w >= 1920) t.assert(r.rgW <= 1440 && r.rgW >= 1200, where + ': innehållsbredd begränsad till 1 200–1 440 px (F-23), är ' + r.rgW);
      /* Kort per rad när innehållet (inte fönstret) är smalare än 640 px — container query. */
      if (r.rowDisplay) t.assert(r.rgW < 640 ? r.rowDisplay === 'grid' : r.rowDisplay === 'table-row', where + ': ' + (r.rgW < 640 ? 'kort per rad' : 'tabellrad') + ' vid ' + r.rgW + ' px innehåll (' + r.rowDisplay + ')');
      if (w <= 390) t.assert(r.rowDisplay === 'grid', where + ': kort per rad på mobil');
      // Radmenyer (Personal, Offerttjänster) öppnas helt inom fönstret.
      const more = s.page.locator('.page.active tr.rg-row .rg-more');
      if (await more.count()) {
        const m = await openMenu(s, more.first());
        t.assert(m && m.items.length >= 2 && m.inView, where + ': radmenyn öppnas och syns helt ' + JSON.stringify(m));
        await s.eval(() => aoCloseOverflow());
      }
    }
    t.note(w + ' px: ' + PAGES.length + ' sidor kontrollerade');
    await s.context.close();
  }
}

module.exports = [
  {
    id: 'REG-UI-01', module: 'Register (V3)', name: 'Kunder: 150 kunder — sök och typfilter räknar rätt ("Visar X av Y"), status är egen flikgrupp, Rensa filter, sökfältet behåller fokus, ⋮ har Importera/Exportera, "Ny kund" öppnar formuläret',
    async run(t) {
      seed(t.fake);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-crm');
      const exp = await s.eval(() => {
        const act = state.customers.filter((c) => !c.inactive);
        return { act: act.length, inact: state.customers.length - act.length, brf: act.filter((c) => CustomerService.normalizeType(c.type) === 'brf').length,
          foretag: act.filter((c) => CustomerService.normalizeType(c.type) === 'foretag').length,
          long: act.filter((c) => CustomerService.displayName(c).includes('Långa Namnets')).length };
      });
      t.assert(exp.act >= 100, 'realistisk mängd: ' + exp.act + ' aktiva kunder');
      t.assert(await rows(s, '#crm-list') === exp.act, 'alla aktiva kunder visas (' + exp.act + ')');
      t.assert((await countText(s)) === exp.act + ' kunder', 'räknaren: ' + (await countText(s)));
      const heads = await s.eval(() => [...document.querySelectorAll('#crm-list th')].map((h) => h.textContent.trim()));
      ['Org.nr', 'Kontakt', 'Fastigheter', 'Öppna AO'].forEach((h) => t.assert(heads.includes(h), 'kolumnen ' + h + ' finns: ' + heads.join('|')));
      // Typfilter (chips) — legacy-typen "company" räknas som Företag.
      await clickChip(s, 'BRF');
      t.assert(await rows(s, '#crm-list') === exp.brf, 'BRF-filtret: ' + exp.brf + ' rader');
      t.assert((await countText(s)) === 'Visar ' + exp.brf + ' av ' + exp.act + ' kunder', 'räknaren vid filter: ' + (await countText(s)));
      t.assert(await s.eval(() => document.querySelector('.page.active .chip.on').getAttribute('aria-pressed') === 'true'), 'aktivt chip har aria-pressed');
      await clickChip(s, 'Företag');
      t.assert(await rows(s, '#crm-list') === exp.foretag, 'Företag-filtret inkl. legacy-typ: ' + exp.foretag);
      await clickChip(s, 'Alla typer');
      // Sök: bara listan renderas om — fältet behåller fokus.
      await s.page.click('#crm-search');
      await s.page.keyboard.type('Långa Namnets', { delay: 15 });
      await s.settle(450);
      t.assert(await s.eval(() => document.activeElement && document.activeElement.id === 'crm-search'), 'sökfältet har kvar fokus under skrivning');
      t.assert(await rows(s, '#crm-list') === exp.long, 'sökningen ger ' + exp.long + ' träffar');
      t.assert((await countText(s)) === 'Visar ' + exp.long + ' av ' + exp.act + ' kunder', 'räknaren vid sök: ' + (await countText(s)));
      await s.page.locator('.page.active .rg-clear').click();
      await s.settle(200);
      t.assert(await rows(s, '#crm-list') === exp.act && (await s.eval(() => document.getElementById('crm-search').value)) === '', 'Rensa filter återställer sök och typ');
      await clickTab(s, 'Inaktiva');
      t.assert(await rows(s, '#crm-list') === exp.inact, 'Inaktiva visar ' + exp.inact + ' kunder');
      await clickChip(s, 'Privat');
      t.assert(await s.eval(() => [...document.querySelectorAll('#crm-list tr.rg-row .rg-sub')].every((e) => /Privatperson/.test(e.textContent) && /Inaktiv/.test(e.textContent))), 'Inaktiva + Privat kan kombineras');
      // Äldre anrop med _typeFilter='inaktiva' tolkas som statusen Inaktiva.
      await s.eval(() => { CustomersPage._typeFilter = 'inaktiva'; CustomersPage._status = 'aktiva'; CustomersPage.render(); });
      t.assert(await rows(s, '#crm-list') === exp.inact, 'bakåtkompatibelt _typeFilter=inaktiva');
      await s.eval(() => { CustomersPage._status = 'aktiva'; CustomersPage._typeFilter = 'alla'; CustomersPage.render(); });
      const menu = await openMenu(s, s.page.locator('.page.active .rg-bar-more .rg-more'));
      t.assert(menu && menu.items.includes('Importera') && menu.items.includes('Exportera') && menu.inView, '⋮ innehåller Importera och Exportera: ' + JSON.stringify(menu));
      await s.eval(() => aoCloseOverflow());
      t.assert(await s.eval(() => document.querySelectorAll('.page.active .btn.bp').length === 1), 'en primär åtgärd i vyn');
      await s.page.locator('.page.active .rg-new', { hasText: 'Ny kund' }).click();
      await s.page.waitForSelector('.modal-overlay.open #cu-name', { timeout: 5000 });
      t.assert(true, '"Ny kund" öppnar kundformuläret');
    },
  },
  {
    id: 'REG-UI-02', module: 'Register (V3)', name: 'Fastigheter: 120+ fastigheter — sök på adress räknar rätt, Arkiverade, kolumner adress/kund/objekt, tangentbord (Enter) öppnar fastighetskortet, "Ny fastighet" öppnar formuläret',
    async run(t) {
      seed(t.fake);
      const s = await t.world.session({ viewport: 'desktop' });
      await s.login('admin');
      await s.go('pg-objects');
      const exp = await s.eval(() => {
        const act = state.properties.filter((p) => p.status !== 'inaktiv');
        return { act: act.length, arch: state.properties.length - act.length, solna: act.filter((p) => /solna/i.test(p.city || '')).length };
      });
      t.assert(await rows(s, '#prop-list') === exp.act && (await countText(s)) === exp.act + ' fastigheter', 'aktiva fastigheter: ' + exp.act);
      const heads = await s.eval(() => [...document.querySelectorAll('#prop-list th')].map((h) => h.textContent.trim()));
      ['Adress', 'Kund', 'Objekt', 'Öppna AO'].forEach((h) => t.assert(heads.includes(h), 'kolumnen ' + h + ': ' + heads.join('|')));
      await typeSearch(s, '#prop-search', 'solna');
      t.assert(await rows(s, '#prop-list') === exp.solna, 'sök på ort: ' + exp.solna);
      t.assert((await countText(s)) === 'Visar ' + exp.solna + ' av ' + exp.act + ' fastigheter', 'räknaren: ' + (await countText(s)));
      await typeSearch(s, '#prop-search', 'finns-inte-xyz');
      t.assert(await s.eval(() => !!document.querySelector('#prop-list .empty h3') && /Inga träffar/.test(document.querySelector('#prop-list .empty').textContent)), 'tomläge med "Inga träffar"');
      await s.page.locator('#prop-list .empty button', { hasText: 'Rensa sökning' }).click();
      await s.settle(200);
      await clickTab(s, 'Arkiverade');
      t.assert(await rows(s, '#prop-list') === exp.arch, 'Arkiverade: ' + exp.arch);
      await clickTab(s, 'Aktiva');
      await s.page.locator('#prop-list tr.rg-row').first().focus();
      await s.page.keyboard.press('Enter');
      await s.settle(500);
      t.assert(await s.eval(() => Router.currentPage === 'pg-obj-detail'), 'Enter på en rad öppnar fastighetskortet');
      await s.go('pg-objects');
      // Markering (bulkåtgärder) fungerar som förut i tabellen: kryssruta → markeringsläge → radklick markerar.
      await s.page.locator('#prop-list tr.rg-row ._sel-cb').first().check();
      await s.settle(200);
      await s.page.locator('#prop-list tr.rg-row .rg-title').nth(1).click();
      await s.settle(200);
      const sel = await s.eval(() => ({ n: SelectionModel.count(), rows: document.querySelectorAll('#prop-list tr.rg-row.selected').length, page: Router.currentPage }));
      t.assert(sel.n === 2 && sel.rows === 2 && sel.page === 'pg-objects', 'två rader markerade utan att sidan byttes: ' + JSON.stringify(sel));
      await s.page.locator('#prop-list .rg-selall input').check();
      await s.settle(200);
      t.assert(await s.eval(() => SelectionModel.count()) === exp.act, '"Välj alla" markerar alla ' + exp.act + ' synliga');
      await s.eval(() => { SelectionModel.clearAll(); PropertiesPage.renderList(); });
      await s.page.locator('.page.active .rg-new', { hasText: 'Ny fastighet' }).click();
      await s.page.waitForSelector('.modal-overlay.open #prop-name', { timeout: 5000 });
    },
  },
  {
    id: 'REG-UI-03', module: 'Register (V3)', name: 'Artiklar: 130+ artiklar — status (Alla/Aktiva/Inaktiva) och kategori kombineras, sök på art.nr, pris visas exkl. moms (aldrig "inkl"), rad och "Ny artikel" öppnar formuläret',
    async run(t) {
      seed(t.fake);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-articles');
      const exp = await s.eval(() => {
        const a = state.articles;
        return { all: a.length, inact: a.filter((x) => x.active === false).length, kemInact: a.filter((x) => x.active === false && x.category === 'kemikalier').length, nr: a.filter((x) => String(x.articleNumber || '').includes('901')).length };
      });
      t.assert(exp.all >= 100 && (await rows(s, '#art-list')) === exp.all, 'alla artiklar visas som standard (' + exp.all + ')');
      const txt = await s.text('#art-list');
      t.assert(/exkl\. moms/i.test(await s.eval(() => document.querySelector('#art-list thead').textContent)) && !/inkl/i.test(txt), 'priset är märkt exkl. moms, inget "inkl"');
      await clickTab(s, 'Inaktiva');
      t.assert(await rows(s, '#art-list') === exp.inact, 'Inaktiva: ' + exp.inact);
      await clickChip(s, 'Kemikalier');
      t.assert(await rows(s, '#art-list') === exp.kemInact, 'Inaktiva + Kemikalier: ' + exp.kemInact);
      await clickTab(s, 'Alla');
      await clickChip(s, 'Alla kategorier');
      await typeSearch(s, '#art-search', '901');
      t.assert(await rows(s, '#art-list') === exp.nr, 'sök på art.nr: ' + exp.nr);
      await s.page.locator('.page.active .rg-clear').click(); await s.settle(200);
      const first = await s.eval(() => { const r = document.querySelector('#art-list tr.rg-row'); return { id: r.getAttribute('data-sel-row-id') }; });
      await s.page.locator('#art-list tr.rg-row .rg-title').first().click();
      await s.page.waitForSelector('.modal-overlay.open #art-name', { timeout: 5000 });
      t.assert(await s.eval((id) => document.getElementById('art-name').value === state.articles.find((a) => a.id === id).name, first.id), 'radklick öppnar artikeln');
      await s.eval(() => Modal.close()); await s.settle(300);
      await s.page.locator('.page.active .rg-new', { hasText: 'Ny artikel' }).click();
      await s.page.waitForSelector('.modal-overlay.open #art-name', { timeout: 5000 });
    },
  },
  {
    id: 'REG-UI-04', module: 'Register (V3)', name: 'Personal (F-19): ingen "Inaktivera"-knapp i raderna; Inaktivera/Aktivera nås via radens ⋮ (med bekräftelse) och sparas på servern; namn bryts inte på 390 px; arbetsledare (staff_view) får ingen meny eller primär åtgärd och nekas direktanrop',
    async run(t) {
      seed(t.fake);
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('admin');
      await s.go('pg-staff');
      const r0 = await s.eval(() => ({
        rowBtns: [...document.querySelectorAll('#staff-list tr.rg-row button')].filter((b) => b.offsetParent && /Inaktivera|Aktivera/.test(b.textContent)).length,
        names: [...document.querySelectorAll('#staff-list tr.rg-row .rg-title')].slice(0, 6).map((e) => ({ t: e.textContent, h: Math.round(e.getBoundingClientRect().height) })),
      }));
      t.assert(r0.rowBtns === 0, 'ingen synlig Inaktivera/Aktivera-knapp i listraderna');
      t.assert(r0.names.every((n) => n.h <= 24), 'namnen ryms på en rad på 390 px: ' + JSON.stringify(r0.names));
      const row = s.page.locator('#staff-list tr.rg-row', { hasText: 'Erik Andersson' });
      const label = await row.locator('.rg-more').getAttribute('aria-label');
      t.assert(label === 'Fler åtgärder för Erik Andersson', 'radmenyn har tillgängligt namn: ' + label);
      const m = await openMenu(s, row.locator('.rg-more'));
      t.assert(m && m.items.join('|') === 'Redigera|Inaktivera' && m.inView, 'menyn: Redigera, Inaktivera (sist): ' + JSON.stringify(m));
      await s.page.locator('.ao-overflow-menu.open [role=menuitem]', { hasText: 'Inaktivera' }).click();
      await s.page.waitForSelector('.modal-overlay.open', { timeout: 5000 });
      t.assert(t.fake.get('staff').find((x) => x.id === 'ST-002').active !== false, 'inget ändras före bekräftelse');
      await s.clickModalButton(/Inaktivera/);
      await s.settle(1500);
      t.assert(t.fake.get('staff').find((x) => x.id === 'ST-002').active === false, 'inaktiverad på servern efter bekräftelse');
      t.assert((await s.toasts()).some((x) => /Erik Andersson inaktiverad/.test(x)), 'besked med namn');
      await clickTab(s, 'Inaktiva');
      const row2 = s.page.locator('#staff-list tr.rg-row', { hasText: 'Erik Andersson' });
      const m2 = await openMenu(s, row2.locator('.rg-more'));
      t.assert(m2 && m2.items.includes('Aktivera'), 'Aktivera i menyn för inaktiv person');
      await s.page.locator('.ao-overflow-menu.open [role=menuitem]', { hasText: 'Aktivera' }).click();
      await s.settle(1500);
      t.assert(t.fake.get('staff').find((x) => x.id === 'ST-002').active === true, 'aktiverad igen på servern');
      // Arbetsledare: staff_view men inte staff_manage.
      const c = await t.world.session({ viewport: 'laptop' });
      await c.login('chef');
      await c.go('pg-staff');
      const cr = await c.eval(() => ({ menus: document.querySelectorAll('#staff-list .rg-more').length, primary: document.querySelectorAll('.page.active .btn.bp').length, rows: document.querySelectorAll('#staff-list tr.rg-row').length }));
      t.assert(cr.rows > 30 && cr.menus === 0 && cr.primary === 0, 'arbetsledaren ser listan utan radmenyer och utan "Ny personal": ' + JSON.stringify(cr));
      const cm = await openMenu(c, c.page.locator('.page.active .rg-bar-more .rg-more'));
      t.assert(cm && cm.items.join('|') === 'Exportera', 'arbetsledarens ⋮ har bara Exportera: ' + JSON.stringify(cm));
      await c.eval(() => aoCloseOverflow());
      await c.clearToasts();
      await c.eval(() => StaffPage._toggleActive('ST-005'));
      await c.settle(800);
      t.assert(t.fake.get('staff').find((x) => x.id === 'ST-005').active === true, 'direktanrop utan staff_manage ändrar inget');
      t.assert((await c.toasts()).some((x) => /behörighet/i.test(x)), 'besked om behörighet');
    },
  },
  {
    id: 'REG-UI-05', module: 'Register (V3)', name: 'Prisgrupper: flikarna Prisgrupper/Prisprofiler (.ftabs), primär åtgärd följer fliken, sök räknar rätt, timpris exkl. moms, profilrad öppnar redigering, ⋮ (Importera/Exportera) bara för prisgrupper',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-pricegroups');
      const n = await s.eval(() => ({ g: state.priceGroups.length, p: state.priceProfiles.length, akut: state.priceGroups.filter((g) => /akut/i.test(g.name + ' ' + (g.description || ''))).length }));
      t.assert(await rows(s, '#pg-pricegroups-tab-body') === n.g, 'alla prisgrupper');
      t.assert(/Timpris exkl\. moms/i.test(await s.eval(() => document.querySelector('#pg-pricegroups-tab-body thead').textContent)), 'timpris märkt exkl. moms');
      t.assert(await s.eval(() => document.querySelector('.page.active .rg-new').textContent.trim() === 'Ny prisgrupp'), 'primär: Ny prisgrupp');
      await typeSearch(s, '#pg-search', 'akut');
      t.assert(await rows(s, '#pg-pricegroups-tab-body') === n.akut && (await countText(s)) === 'Visar ' + n.akut + ' av ' + n.g + ' prisgrupper', 'sök: ' + (await countText(s)));
      await typeSearch(s, '#pg-search', '');
      const m = await openMenu(s, s.page.locator('.page.active .rg-bar-more .rg-more'));
      t.assert(m && m.items.join('|') === 'Importera|Exportera', '⋮ för prisgrupper: ' + JSON.stringify(m));
      await s.eval(() => aoCloseOverflow());
      await clickTab(s, 'Prisprofiler');
      t.assert(await s.eval(() => document.querySelector('.page.active .rg-new').textContent.trim() === 'Ny prisprofil' && !document.querySelector('.page.active .rg-bar-more')), 'profiler: primär "Ny prisprofil", ingen ⋮');
      t.assert(await rows(s, '#pg-pricegroups-tab-body') === n.p, 'alla prisprofiler');
      await s.page.locator('#pg-pricegroups-tab-body tr.rg-row').first().click();
      await s.page.waitForSelector('.modal-overlay.open #pp-name', { timeout: 5000 });
      t.assert(true, 'radklick öppnar prisprofilen');
    },
  },
  {
    id: 'REG-UI-06', module: 'Register (V3)', name: 'Offerttjänster (F-20): en ⋮ per rad på mobil i stället för fyra ikonknappar; Testkalkyl/Duplicera/Inaktivera nås i menyn (Inaktivera med bekräftelse); sök behåller fokus och räknar rätt',
    async run(t) {
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('admin');
      await s.go('pg-service-templates');
      const r = await s.eval(() => [...document.querySelectorAll('#svc-list tr.rg-row')].map((tr) => {
        const btns = [...tr.querySelectorAll('button')].filter((b) => b.offsetParent && !(b.textContent || '').trim());
        return { n: btns.length, names: btns.map((b) => b.getAttribute('aria-label')) };
      }));
      t.assert(r.length >= 7 && r.every((x) => x.n === 1 && /^Fler åtgärder för /.test(x.names[0])), 'en ikonknapp (⋮) med namn per rad: ' + JSON.stringify(r.slice(0, 2)));
      const before = await s.eval(() => state.serviceTemplates.length);
      const row = s.page.locator('#svc-list tr.rg-row', { hasText: 'Altantvätt' }).first();
      const m = await openMenu(s, row.locator('.rg-more'));
      t.assert(m && m.items.join('|') === 'Redigera|Testkalkyl|Duplicera|Inaktivera' && m.inView, 'menyn: ' + JSON.stringify(m));
      await s.page.locator('.ao-overflow-menu.open [role=menuitem]', { hasText: 'Duplicera' }).click();
      await s.settle(400);
      t.assert(await s.eval(() => state.serviceTemplates.length) === before + 1, 'Duplicera skapar en kopia');
      await openMenu(s, s.page.locator('#svc-list tr.rg-row', { hasText: 'Stentvätt' }).first().locator('.rg-more'));
      await s.page.locator('.ao-overflow-menu.open [role=menuitem]', { hasText: 'Testkalkyl' }).click();
      await s.settle(400);
      t.assert(await s.modalOpen(), 'Testkalkyl öppnas');
      await s.eval(() => Modal.close()); await s.settle(300);
      await openMenu(s, s.page.locator('#svc-list tr.rg-row', { hasText: 'Häckklippning' }).first().locator('.rg-more'));
      await s.page.locator('.ao-overflow-menu.open [role=menuitem]', { hasText: 'Inaktivera' }).click();
      await s.page.waitForSelector('.modal-overlay.open', { timeout: 5000 });
      t.assert(await s.eval(() => state.serviceTemplates.find((x) => x.name === 'Häckklippning').active !== false), 'inget ändras före bekräftelse');
      await s.clickModalButton(/Inaktivera/);
      await s.settle(400);
      t.assert(await s.eval(() => state.serviceTemplates.find((x) => x.name === 'Häckklippning').active === false), 'inaktiverad efter bekräftelse');
      await s.page.click('#svc-search');
      await s.page.keyboard.type('tvätt', { delay: 20 });
      await s.settle(450);
      const exp = await s.eval(() => state.serviceTemplates.filter((x) => /tvätt/i.test(x.name + ' ' + (x.category || ''))).length);
      t.assert(await s.eval(() => document.activeElement && document.activeElement.id === 'svc-search'), 'sökfältet har kvar fokus (förut renderades hela sidan om)');
      t.assert(await rows(s, '#svc-list') === exp, 'sök "tvätt": ' + exp + ' träffar');
      t.assert(!(await s.eval(() => [...document.querySelectorAll('.page.active h1, .page.active h2, .page.active .card-header h3')].some((h) => /Offerttjänster/.test(h.textContent)))), 'ingen upprepad sidrubrik');
    },
  },
  {
    id: 'REG-UI-07', module: 'Register (V3)', name: 'Uppgifter: ingen upprepad rubrik, V3-chips (inte mörka piller) i två grupper räknar rätt, sök + Rensa filter; per-post-regeln: fältarbetaren kan klarmarkera sin egen men inte annans uppgift',
    async run(t) {
      seed(t.fake);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.go('pg-activities');
      const exp = await s.eval(() => {
        const today = tdy(); const open = state.activities.filter((a) => a.status === 'open');
        return { open: open.length, over: open.filter((a) => a.dueDate && a.dueDate < today).length, done: state.activities.filter((a) => a.status === 'done').length, long: open.filter((a) => /riktigt lång titel/.test(a.title)).length };
      });
      const r0 = await s.eval(() => ({ pills: document.querySelectorAll('.page.active .filter-panel-chip').length, groups: document.querySelectorAll('#act-filters .rg-chips').length, h: [...document.querySelectorAll('.page.active h1, .page.active h2')].map((h) => h.textContent) }));
      t.assert(r0.pills === 0 && r0.groups === 2 && r0.h.length === 0, 'V3-chips i två grupper, ingen egen rubrik: ' + JSON.stringify(r0));
      t.assert(await rows(s, '#act-list') === exp.open, 'Alla öppna: ' + exp.open);
      await clickChip(s, 'Försenade');
      t.assert(await rows(s, '#act-list') === exp.over, 'Försenade: ' + exp.over);
      await clickChip(s, 'Klart');
      t.assert(await rows(s, '#act-list') === exp.done, 'Klart: ' + exp.done);
      await clickChip(s, 'Alla öppna');
      await typeSearch(s, '#act-search', 'riktigt lång titel');
      t.assert(await rows(s, '#act-list') === exp.long && (await countText(s)) === 'Visar ' + exp.long + ' av ' + exp.open + ' uppgifter', 'sök: ' + (await countText(s)));
      await s.page.locator('.page.active .rg-clear').click(); await s.settle(200);
      t.assert(await rows(s, '#act-list') === exp.open, 'Rensa filter');
      await s.page.locator('.page.active .rg-new', { hasText: 'Ny uppgift' }).click();
      await s.page.waitForSelector('.modal-overlay.open #act-title', { timeout: 5000 });
      // Fältarbetare (ST-002): egen uppgift kan klarmarkeras, annans inte (knappen inaktiverad, inget anrop).
      const f = await t.world.session({ viewport: 'iphone' });
      await f.login('falt');
      await f.go('pg-activities');
      const ids = await f.eval(() => {
        const open = state.activities.filter((a) => a.status === 'open');
        return { mine: open.find((a) => a.assignedTo === 'ST-002').id, other: open.find((a) => a.assignedTo === 'ST-003').id };
      });
      const st = await f.eval((x) => {
        const btn = (id) => [...document.querySelectorAll('#act-list tr.rg-row')].map((tr) => tr.querySelector('.rg-check')).find((b) => b && (b.getAttribute('onclick') || '').includes('("' + id + '")'));
        const other = [...document.querySelectorAll('#act-list .rg-check:disabled')];
        return { mine: !!btn(x.mine) && !btn(x.mine).disabled, disabled: other.length };
      }, ids);
      t.assert(st.mine && st.disabled > 0, 'egen uppgift klickbar, andras inaktiverade: ' + JSON.stringify(st));
      await f.page.locator('#act-list .rg-check:disabled').first().click({ force: true }).catch(() => {});
      await f.settle(500);
      t.assert(t.fake.get('activities').find((a) => a.id === ids.other).status === 'open', 'annans uppgift orörd');
      await f.page.locator('#act-list .rg-check[onclick*=\'("' + ids.mine + '")\']').click();
      await f.settle(1500);
      t.assert(t.fake.get('activities').find((a) => a.id === ids.mine).status === 'done', 'egen uppgift klarmarkerad på servern');
    },
  },
  {
    id: 'REG-UI-08', module: 'Register (V3)', name: 'Registerlayout 360/390/768 px med 100+ poster: ingen sidrullning i sidled, ingen avklippt text, knappar inom skärmen, ikonknappar har namn, inga ikoner på egen rad, ingen markup som text, kort per rad på mobil, radmenyer syns helt',
    async run(t) { seed(t.fake); await layoutAt(t, [360, 390, 768]); },
  },
  {
    id: 'REG-UI-09', module: 'Register (V3)', name: 'Registerlayout 1024/1366/1920 px med 100+ poster: samma kontroller som REG-UI-08, tabellrader på dator och innehållsbredd högst 1 440 px på 1920 (F-23)',
    async run(t) { seed(t.fake); await layoutAt(t, [1024, 1366, 1920]); },
  },
  {
    id: 'REG-UI-10', module: 'Register (V3)', name: 'Mobil (390 px) utifrån uppgifter: hitta kunden i registret och öppna kundkortet, hitta fastigheten och se adress, portkod (endast med behörighet), "Ny AO", objekt och serviceintervall — inga dolda flikar eller avklippta åtgärder',
    async run(t) {
      t.fake.sensitive.set('OBJ-001', { accessCode: '4711#' });
      const probe = () => {
        const pg = document.querySelector('.page.active'); const vw = document.documentElement.clientWidth;
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const bad = [...pg.querySelectorAll('button, a.btn')].filter(vis).map((b) => { const r = b.getBoundingClientRect(); return { t: (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 24), out: r.right > vw + 1 || r.left < -1 }; }).filter((x) => x.out);
        const tabs = [...pg.querySelectorAll('.ftabs .ft, [role=tab]')].filter(vis);
        const hidden = tabs.filter((b) => { const r = b.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; }).map((b) => b.textContent.trim());
        return { bad, hidden, nTabs: tabs.length, overflow: document.documentElement.scrollWidth > vw + 1, tel: pg.querySelectorAll('a[href^="tel:"]').length, mail: pg.querySelectorAll('a[href^="mailto:"]').length, text: pg.innerText };
      };
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('admin');
      await s.go('pg-crm');
      await typeSearch(s, '#crm-search', 'Solgläntan');
      t.assert(await rows(s, '#crm-list') === 1, 'kunden hittas med sökning');
      await s.page.locator('#crm-list tr.rg-row').first().click();
      await s.settle(600);
      t.assert(await s.eval(() => Router.currentPage === 'pg-crm-detail'), 'raden öppnar kundkortet');
      const cu = await s.eval(probe);
      t.assert(!cu.overflow && cu.bad.length === 0 && cu.hidden.length === 0, 'kundkortet: inga åtgärder eller flikar utanför skärmen ' + JSON.stringify({ bad: cu.bad, hidden: cu.hidden }));
      t.assert(/08-123 45 67/.test(cu.text) && /styrelsen@solglantanbrf\.se/.test(cu.text), 'kundens telefon och e-post syns');
      if (!cu.tel || !cu.mail) t.note('OBS (kundkortet, annat arbetsblock): telefon/e-post är inte tel:/mailto:-länkar — det går inte att ringa eller maila med ett tryck (tel ' + cu.tel + ', mailto ' + cu.mail + ')');
      await s.go('pg-objects');
      await typeSearch(s, '#prop-search', 'Solvägen 1A');
      t.assert(await rows(s, '#prop-list') === 1, 'fastigheten hittas på adress');
      await s.page.locator('#prop-list tr.rg-row').first().click();
      await s.settle(700);
      t.assert(await s.eval(() => Router.currentPage === 'pg-obj-detail'), 'raden öppnar fastighetskortet');
      const pr = await s.eval(probe);
      t.assert(!pr.overflow && pr.bad.length === 0 && pr.hidden.length === 0, 'fastighetskortet: inga åtgärder eller flikar utanför skärmen ' + JSON.stringify({ bad: pr.bad, hidden: pr.hidden }));
      t.assert(/Solvägen 1A/.test(pr.text), 'adressen syns');
      t.assert(await s.eval(() => [...document.querySelectorAll('.page.active button')].some((b) => b.offsetParent && /Ny AO|Ny arbetsorder/.test(b.textContent))), '"Ny AO" finns synlig på fastighetskortet');
      await s.eval(() => PropertyDetailPage.switchTab('contact'));
      await s.settle(900);
      t.assert(/Portkod/.test(await s.text('.page.active')) && /4711#/.test(await s.text('.page.active')), 'admin (objects_sensitive) ser portkoden under Kontakt');
      for (const tab of ['objects', 'service']) {
        await s.eval((x) => PropertyDetailPage.switchTab(x), tab);
        await s.settle(250);
        t.assert(await s.eval((x) => { const el = document.getElementById('prop-tab-' + x); return !!el && el.style.display !== 'none' && el.innerText.trim().length > 0; }, tab), 'fliken ' + tab + ' visas');
      }
      const c = await t.world.session({ viewport: 'iphone' });
      await c.login('chef');
      await c.go('pg-obj-detail', { propId: 'OBJ-001' });
      await c.eval(() => PropertyDetailPage.switchTab('contact'));
      await c.settle(900);
      t.assert(!/4711#/.test(await c.text('.page.active')), 'arbetsledaren (utan objects_sensitive) ser inte portkoden');
    },
  },
  {
    id: 'REG-UI-11', module: 'Register (V3)', name: 'Varje flik- och filterläge i registren (390 och 1366 px, 100+ poster): ingen markup som text, ingen avklippt text, inga ikoner på egen rad, ingen sidrullning i sidled',
    async run(t) {
      seed(t.fake);
      let states = 0;
      for (const vp of ['iphone', 'laptop']) {
        const s = await t.world.session({ viewport: vp });
        await s.login('admin');
        for (const pg of PAGES) {
          await s.go(pg);
          const n = await s.eval(() => document.querySelectorAll('.page.active .rg-filters .ft, .page.active .rg-filters .chip').length);
          for (let i = 0; i < n; i++) {
            const label = await s.eval((k) => { const b = document.querySelectorAll('.page.active .rg-filters .ft, .page.active .rg-filters .chip')[k]; if (!b) return null; b.click(); return b.textContent.trim(); }, i);
            if (label === null) continue;
            await s.settle(120);
            const r = await s.eval(layoutProbe, MARKUP.source);
            const where = vp + ' ' + pg + ' "' + label + '"';
            t.assert(r.markup.length === 0, where + ': ingen markup som text ' + JSON.stringify(r.markup.slice(0, 3)));
            t.assert(r.clipped.length === 0 && r.offscreen.length === 0, where + ': inget avklippt/utanför ' + JSON.stringify(r.clipped.concat(r.offscreen).slice(0, 3)));
            t.assert(r.svgBlock === 0 && !r.overflow, where + ': inga ikoner på egen rad, ingen sidrullning');
            states++;
          }
        }
        await s.context.close();
      }
      t.note(states + ' flik-/filterlägen kontrollerade');
    },
  },
];
module.exports.seed = seed; // används av skärmbildsskript (före/efter) med samma realistiska data
