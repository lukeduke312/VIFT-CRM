'use strict';
/* Register: kunder, kontaktpersoner, fastigheter, objekt, personal, roller, artiklar, prisgrupper. */

async function openCreate(s, page, btnText) {
  await s.go(page);
  await s.page.locator('.page.active button', { hasText: btnText }).first().click();
  await s.page.waitForSelector('.modal-overlay.open', { timeout: 5000 });
}

module.exports = [
  {
    id: 'CUS-01', module: 'Kundregister', name: 'Ny kund via formulär sparas på servern, syns i listan och hittas med sökning',
    async run(t) {
      const s = await t.world.session();
      await s.login('chef');
      await openCreate(s, 'pg-crm', 'Ny kund');
      await s.page.fill('#cu-name', 'E2E Testkund AB');
      await s.page.fill('#cu-phone', '070-000 11 22');
      await s.page.fill('#cu-email', 'kund@example.test');
      await s.page.fill('#cu-city', 'Göteborg');
      const t0 = Date.now();
      await s.clickModalButton(/Skapa kund/);
      await s.page.waitForFunction(() => !document.querySelector('.modal-overlay.open'), null, { timeout: 8000 });
      await s.page.waitForFunction(() => window.__toasts.some((x) => /skapad|sparad/i.test(x.m)), null, { timeout: 8000 }).catch(() => {});
      t.metric('spara ny kund → bekräftelse (ms)', Date.now() - t0);
      await s.settle(600);
      const srv = t.fake.get('customers').find((c) => c.name === 'E2E Testkund AB');
      t.assert(srv && srv.email === 'kund@example.test', 'kunden finns på servern med e-post');
      const toasts = await s.toasts();
      t.note('besked: ' + toasts.join(' / '));
      await s.go('pg-crm');
      const search = s.page.locator('.page.active input[type="search"]').first();
      await search.fill('E2E Testkund');
      await s.settle(400);
      t.assert(/E2E Testkund AB/.test(await s.text('#pg-crm')), 'sökningen visar kunden');
      await search.fill('zzzz-finns-inte');
      await s.settle(400);
      t.assert(!/E2E Testkund AB/.test(await s.text('#pg-crm')), 'sökning utan träff visar inte kunden');
    },
  },
  {
    id: 'CUS-02', module: 'Kundregister', name: 'Tomt kundnamn nekas med begripligt besked, inget sparas',
    async run(t) {
      const s = await t.world.session();
      await s.login('chef');
      const before = t.fake.get('customers').length;
      await openCreate(s, 'pg-crm', 'Ny kund');
      await s.clickModalButton(/Skapa kund/);
      await s.settle(500);
      const toasts = await s.toasts();
      t.assert(toasts.some((m) => /namn/i.test(m)), 'besked om namn: ' + toasts.join(' / '));
      t.assert(t.fake.get('customers').length === before, 'inget nytt på servern');
      t.assert(await s.modalOpen(), 'formuläret är kvar öppet');
    },
  },
  {
    id: 'CUS-03', module: 'Kundregister', name: 'Redigera kund (telefon) sparas på servern',
    async run(t) {
      const s = await t.world.session();
      await s.login('chef');
      const cid = await s.eval(() => state.customers[0].id);
      await s.go('pg-crm-detail', { customerId: cid });
      await s.page.locator('.page.active button', { hasText: 'Redigera' }).first().click();
      await s.page.waitForSelector('.modal-overlay.open #cu-phone');
      await s.page.fill('#cu-phone', '070-999 88 77');
      await s.clickModalButton(/Spara/);
      await s.page.waitForFunction((id) => true, cid);
      await s.settle(900);
      const srv = t.fake.get('customers').find((c) => c.id === cid);
      t.assert(srv.phone === '070-999 88 77', 'telefon uppdaterad på servern (' + srv.phone + ')');
    },
  },
  {
    id: 'CON-01', module: 'Kontaktpersoner', name: 'Kontaktperson på fastighet läggs till och sparas på servern',
    async run(t) {
      const s = await t.world.session();
      await s.login('chef');
      const pid = await s.eval(() => state.properties[0].id);
      await s.go('pg-obj-detail', { propId: pid });
      await s.eval(() => PropertyDetailPage.openAddContact());
      await s.page.waitForSelector('.modal-overlay.open #pc-name');
      await s.page.fill('#pc-name', 'Kontakt E2E');
      await s.page.fill('#pc-phone', '070-123 45 67');
      await s.page.fill('#pc-email', 'kontakt@example.test');
      await s.clickModalButton(/Lägg till/);
      await s.settle(900);
      const prop = t.fake.get('properties').find((p) => p.id === pid);
      const has = JSON.stringify(prop).includes('Kontakt E2E');
      t.assert(has, 'kontakten finns i fastigheten på servern');
    },
  },
  {
    id: 'PROP-01', module: 'Fastighetsregister', name: 'Ny fastighet utan objects_sensitive: portkodsfält visas inte, ingen portkod i registret',
    async run(t) {
      const s = await t.world.session();
      await s.login('chef');
      await openCreate(s, 'pg-objects', 'Ny fastighet');
      t.assert(!(await s.page.locator('.modal-overlay.open #prop-access').count()), 'portkodsfältet visas inte för chef');
      await s.page.fill('#prop-name', 'E2E Fastighet Chef');
      await s.page.fill('#prop-city', 'Borås');
      await s.clickModalButton(/Skapa/);
      await s.waitToast(/skapad/i, 8000);
      const p = t.fake.get('properties').find((x) => x.name === 'E2E Fastighet Chef');
      t.assert(p, 'fastigheten finns på servern');
      t.assert(!('accessCode' in p), 'ingen accessCode i delade registret');
    },
  },
  {
    id: 'PROP-02', module: 'Fastighetsregister', name: 'Portkod vid ny fastighet (admin) sparas skyddat — aldrig i delade registret; fältarbetare kan inte läsa den',
    async run(t) {
      const s = await t.world.session();
      await s.login('admin');
      await openCreate(s, 'pg-objects', 'Ny fastighet');
      await s.page.fill('#prop-name', 'E2E Fastighet Kod');
      await s.page.fill('#prop-access', '4711#');
      await s.clickModalButton(/Skapa/);
      await s.waitToast(/skapad/i, 8000);
      const p = t.fake.get('properties').find((x) => x.name === 'E2E Fastighet Kod');
      t.assert(p && !JSON.stringify(p).includes('4711'), 'portkoden finns INTE i vift_properties');
      t.assert((t.fake.sensitive.get(p.id) || {}).accessCode === '4711#', 'portkoden finns i skyddad lagring');
      const f = await t.world.session();
      await f.login('falt');
      const leak = await f.eval(() => JSON.stringify(state.properties).includes('4711'));
      t.assert(!leak, 'fältarbetaren har inte portkoden i sitt state');
      const r = await f.eval(async (pid) => { const res = await fetch(SUPABASE_URL + '/functions/v1/get-sensitive-fields', { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId: pid }) }); return res.status; }, p.id);
      t.assert(r === 403, 'direktanrop get-sensitive-fields som fältarbetare → 403 (fick ' + r + ')');
    },
  },
  {
    id: 'PROP-03', module: 'Fastighetsregister', name: 'Fastighetskortets alla flikar öppnas utan fel',
    async run(t) {
      const s = await t.world.session();
      await s.login('admin');
      const pid = await s.eval(() => state.properties[0].id);
      await s.go('pg-obj-detail', { propId: pid });
      for (const tab of ['overview', 'contact', 'ansvariga', 'tech', 'service', 'ao', 'recurring', 'rondering', 'objects', 'images', 'notes']) {
        await s.eval((x) => PropertyDetailPage.switchTab(x), tab);
        await s.settle(150);
        const vis = await s.eval((x) => { const el = document.getElementById('prop-tab-' + x); return el && el.style.display !== 'none' && el.innerText.trim().length > 0; }, tab);
        t.assert(vis, 'fliken ' + tab + ' visas med innehåll');
      }
    },
  },
  {
    id: 'OBJ-01', module: 'Objekt och lägenheter', name: 'Lägg till objekt på fastighet och öppna objektkortet',
    async run(t) {
      const s = await t.world.session();
      await s.login('admin');
      const pid = await s.eval(() => state.properties[0].id);
      await s.go('pg-obj-detail', { propId: pid });
      await s.eval((x) => PropertyDetailPage.openAddObject(x), pid);
      await s.page.waitForSelector('.modal-overlay.open', { timeout: 5000 });
      const fields = await s.eval(() => Array.from(document.querySelectorAll('.modal-overlay.open input, .modal-overlay.open select')).map((e) => e.id).filter(Boolean));
      t.note('objektformulär: ' + fields.join(', '));
      const nameField = fields.find((f) => /name|number|nr|beteck|label/i.test(f));
      t.assert(nameField, 'objektformulär har ett namn/nummerfält');
      await s.page.fill('#' + nameField, 'Lgh 1101 E2E');
      await s.clickModalButton(/Lägg till|Skapa|Spara/);
      await s.settle(900);
      const objs = t.fake.get('propertyObjects');
      const o = objs.find((x) => JSON.stringify(x).includes('Lgh 1101 E2E'));
      t.assert(o, 'objektet finns på servern');
      await s.go('pg-propobj-detail', { objId: o.id });
      t.assert(/1101/.test(await s.text('#pg-propobj-detail')), 'objektkortet visar objektet');
    },
  },
  {
    id: 'STAFF-01', module: 'Personalregister', name: 'Ny personal via formulär sparas; listan visar personen',
    async run(t) {
      const s = await t.world.session();
      await s.login('admin');
      await openCreate(s, 'pg-staff', 'Ny personal');
      await s.page.fill('#sf-first', 'Testa');
      await s.page.fill('#sf-last', 'Personsson');
      await s.page.fill('#sf-email', 'testa@example.test');
      await s.page.fill('#sf-uname', 'testa');
      await s.clickModalButton(/Skapa/);
      await s.settle(1000);
      const st = t.fake.get('staff').find((x) => x.lastName === 'Personsson');
      t.assert(st, 'personen finns på servern');
      t.assert(!('password' in st), 'inget lösenord i personalregistret');
      t.assert(/Personsson/.test(await s.text('#pg-staff')), 'listan visar personen');
    },
  },
  {
    id: 'ROLE-01', module: 'Användarroller och behörigheter', name: 'Menyn visar bara sidor rollen får se; direktnavigering till otillåten sida nekas',
    async run(t) {
      const expect = {
        falt: { see: ['pg-myjobs', 'pg-tid'], deny: ['pg-admin', 'pg-payroll', 'pg-invoices', 'pg-staff', 'pg-crm'] },
        chef: { see: ['pg-crm', 'pg-ao', 'pg-offer'], deny: ['pg-admin', 'pg-payroll', 'pg-articles'] },
        ekonomi: { see: ['pg-payroll', 'pg-invoices'], deny: ['pg-admin', 'pg-crm', 'pg-staff'] },
        begransad: { see: ['pg-ao'], deny: ['pg-tid', 'pg-crm', 'pg-payroll', 'pg-rondering'] },
      };
      for (const [alias, e] of Object.entries(expect)) {
        const s = await t.world.session();
        await s.login(alias);
        const navVisible = await s.eval(() => Array.from(document.querySelectorAll('[id^="nav-pg-"]')).filter((b) => b.offsetParent !== null).map((b) => b.id.replace('nav-', '')));
        e.see.forEach((p) => t.assert(navVisible.includes(p), alias + ' ska se ' + p + ' i menyn'));
        e.deny.forEach((p) => t.assert(!navVisible.includes(p), alias + ' ska INTE se ' + p + ' i menyn'));
        for (const p of e.deny) {
          await s.clearToasts();
          await s.go(p);
          const cur = await s.eval(() => ({ dash: document.getElementById('pg-dash').classList.contains('active') }));
          const toasts = await s.toasts();
          t.assert(cur.dash && toasts.some((m) => /behörighet/i.test(m)), alias + ' nekas ' + p);
        }
      }
    },
  },
  {
    id: 'ART-01', module: 'Prisgrupper och artiklar', name: 'Ny artikel och ny prisgrupp sparas; utan article_manage nekar servern direktskrivning',
    async run(t) {
      const s = await t.world.session();
      await s.login('admin');
      await openCreate(s, 'pg-articles', 'Ny artikel');
      await s.page.fill('#art-num', 'E2E-9001');
      await s.page.fill('#art-name', 'E2E Testartikel');
      await s.page.fill('#art-buy', '80');
      await s.page.fill('#art-sell', '120');
      await s.clickModalButton(/Skapa/);
      await s.settle(900);
      const a = t.fake.get('articles').find((x) => x.name === 'E2E Testartikel');
      t.assert(a, 'artikeln finns på servern');
      await openCreate(s, 'pg-pricegroups', 'Ny prisgrupp');
      await s.page.fill('#pg-name', 'E2E Prisgrupp');
      await s.page.fill('#pg-rate', '655');
      await s.clickModalButton(/Skapa/);
      await s.settle(900);
      t.assert(t.fake.get('priceGroups').some((x) => x.name === 'E2E Prisgrupp' && Number(x.hourRate) === 655), 'prisgruppen finns på servern med timpris 655');
      const c = await t.world.session();
      await c.login('chef');
      const res = await c.eval(async () => {
        const r = await Storage.writeBusinessKeyMerge('vift_articles', [{ id: 'HACK', data: { id: 'HACK', name: 'x' }, previous: null }], []);
        return r;
      });
      t.assert(res.ok === false && /forbidden/.test(res.error), 'chef (utan article_manage) nekas skrivning via direktanrop: ' + JSON.stringify(res));
      t.note('serverkontrollen är modellerad — måste upprepas mot riktig STAGING');
    },
  },
];
