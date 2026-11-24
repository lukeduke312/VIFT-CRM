'use strict';
/*
 * V3 2026-11-26 (6A/6B) — faktureringskön och fakturaunderlagets detalj.
 * Simulerad server (fake-backend). Kontrollerar att den kompakta kön visar
 * samma antal och belopp som BillingQueueService, att markering med tre
 * lägen och "Välj alla" följer filtret uttryckligen, att "Kräver åtgärd"
 * visar exakt de ej valbara kandidaterna, att summeringen av valt underlag
 * (ex moms/moms/inkl. moms) är exakt de utkast som skapas — utan
 * dubbelfakturering — och att detaljvyns rader (ex moms) stämmer mot
 * summorna vid blandad moms 25/12/0 %. Plus renderingsbudget för 10/100/1000
 * kandidater och ingen horisontell överbredd 360–1920 px.
 */
const lib = require('../lib');

const num = (t) => Number(String(t || '').replace(/[  \s]/g, '').replace(/kr/g, '').replace('−', '-').replace(/[^\d,.-]/g, '').replace(',', '.'));
const r2 = (v) => Math.round(v * 100) / 100;

/* QA-data: två poster som kräver åtgärd (material utan pris, tid på AO utan
   prismodell) + två fakturaunderlag med blandad moms (med och utan rabatt). */
function seedQa(fake) {
  const now = new Date().toISOString();
  const aos = fake.get('workOrders');
  const ao1 = aos.find((a) => a.id === 'AO-001');
  ao1.materials = (ao1.materials || []).concat([{ id: 'M-QA-1', name: 'Rör utan pris', qty: 2, unit: 'st', buyPrice: 40, sellPrice: 0 }]);
  aos.push({ id: 'AO-QA-1', title: 'Jourutryckning utan prismodell', customerId: 'K-002', propertyId: 'OBJ-002', priceType: '', fixedPrice: 0, status: 'klar', staff: ['ST-002'], log: [], materials: [], checklist: [], notes: [], timeEntries: ['TE-QA-1'], invoiceId: '', createdAt: now, updatedAt: now });
  fake.set('workOrders', aos);
  const tes = fake.get('timeEntries');
  tes.push({ id: 'TE-QA-1', aoId: 'AO-QA-1', staffId: 'ST-002', staffName: 'Erik Andersson', date: now.slice(0, 10), startStr: '07:00', endStr: '08:30', minutes: 90, hourRate: 650, billable: true, internal: false, createdAt: now });
  fake.set('timeEntries', tes);
  const lines = [
    { id: 'q1', description: 'Arbetstid', qty: 2, unit: 'tim', unitPrice: 430, vatRate: 25, source: 'Tid' },
    { id: 'q2', description: 'Livsmedel till personalrum', qty: 1, unit: 'st', unitPrice: 500, vatRate: 12, source: 'Material' },
    { id: 'q3', description: 'Avgift utan moms', qty: 1, unit: 'st', unitPrice: 300, vatRate: 0, source: 'Övrigt' },
  ];
  const base = { customerId: 'K-001', propertyId: 'OBJ-001', workOrderId: 'AO-001', workOrderIds: ['AO-001'], offerId: '', status: 'utkast', dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), paymentTerms: 30, note: '', sentAt: '', paidAt: '', createdAt: now, updatedAt: now };
  const invs = fake.get('invoices');
  invs.push(Object.assign({}, base, { id: 'INV-QA-MIX', title: 'Blandad moms (QA)', lines: lines.map((l) => Object.assign({}, l)) }));
  invs.push(Object.assign({}, base, { id: 'INV-QA-DISC', title: 'Blandad moms med rabatt (QA)', lines: lines.map((l) => Object.assign({}, l)), discount: { type: 'percent', value: 10 } }));
  fake.set('invoices', invs);
}

/* Syntetisk kö: n tidposter (1 h à 650 kr) fördelade på kunder × AO. */
function seedBulk(fake, n) {
  const now = new Date().toISOString();
  const perAo = 5;
  const aoCount = Math.ceil(n / perAo);
  const aosPerCust = n >= 1000 ? 2 : 1;
  const custs = fake.get('customers');
  const aos = fake.get('workOrders');
  const tes = fake.get('timeEntries');
  for (let a = 0; a < aoCount; a++) {
    const ci = Math.floor(a / aosPerCust);
    const cid = 'K-P' + String(ci).padStart(4, '0');
    if (!custs.some((c) => c.id === cid)) custs.push({ id: cid, type: 'brf', name: 'Prestanda BRF ' + ci, address: 'Testgatan ' + ci });
    const aoId = 'AO-P' + String(a).padStart(4, '0');
    aos.push({ id: aoId, title: 'Prestanda-AO ' + a, customerId: cid, propertyId: '', priceType: 'timpris', fixedPrice: 0, status: 'klar', staff: ['ST-002'], log: [], materials: [], checklist: [], notes: [], timeEntries: [], invoiceId: '', createdAt: now, updatedAt: now });
    for (let k = 0; k < perAo && a * perAo + k < n; k++) {
      const d = new Date(Date.now() - (k + a % 20) * 86400000).toISOString().slice(0, 10);
      tes.push({ id: 'TE-P' + a + '-' + k, aoId, staffId: 'ST-002', staffName: 'Erik Andersson', date: d, startStr: '08:00', endStr: '09:00', minutes: 60, hourRate: 650, billable: true, internal: false, createdAt: now });
    }
  }
  fake.set('customers', custs); fake.set('workOrders', aos); fake.set('timeEntries', tes);
}

async function openQueue(s) {
  await s.go('pg-invoices');
  await s.eval(() => { InvoicesPage._qShow = 'alla'; InvoicesPage._qSort = 'amount'; InvoicesPage._setView('queue'); });
  await s.settle(400);
}

module.exports = [
  {
    id: 'BILL-01', module: 'Fakturering och fakturaunderlag', name: 'Fakturakön (kompakt): kundgruppernas antal och belopp = BillingQueueService; Tid+Material+Fastpris = totalen; filtrerad summa märkt och skild från köns total',
    async run(t) {
      seedQa(t.fake);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('ekonomi');
      await openQueue(s);
      const r = await s.eval(() => {
        const all = BillingQueueService.getCandidates();
        const sum = BillingQueueService.getSummary(all);
        const head = document.getElementById('bq-head');
        const groups = [...document.querySelectorAll('#bq-list .bqv-cust')].map((g) => ({
          key: g.getAttribute('data-key'),
          amount: g.querySelector('.bqv-cust-row .bqv-amt b').textContent,
          meta: g.querySelector('.bqv-cust-row .bqv-meta').textContent.replace(/\s+/g, ' '),
          open: g.classList.contains('is-open'), rows: g.querySelectorAll('.bqv-src').length,
        }));
        const byCust = {};
        all.forEach((c) => { const k = 'c:' + (c.customerId || '—'); const b = byCust[k] = byCust[k] || { n: 0, sel: 0, iss: 0, aos: new Set() }; b.n++; b.aos.add(c.workOrderId || '—'); if (c.selectable) b.sel += c.amount; else b.iss++; });
        Object.values(byCust).forEach((b) => { b.aos = b.aos.size; b.sel = Math.round(b.sel * 100) / 100; });
        return { sum, byCust, groups, headTotal: head.querySelector('[data-total]').getAttribute('data-total'), headText: head.innerText,
          parts: ['time', 'material', 'fixed'].map((k) => head.querySelector('[data-part="' + k + '"]').textContent), all: all.length,
          issues: all.filter((c) => !c.selectable).length };
      });
      t.note('kö: ' + r.all + ' kandidater, ' + r.issues + ' kräver åtgärd, total ' + r.sum.totalAmount + ' kr ex moms');
      const parts = r.parts.map(num);
      t.assert(num(r.headTotal) === r.sum.totalAmount, 'huvudets total = getSummary().totalAmount (' + r.headTotal + ')');
      t.assert(r2(parts[0] + parts[1] + parts[2]) === r.sum.totalAmount, 'Tid + Material + Fastpris = totalen (' + parts.join(' + ') + ' = ' + r.sum.totalAmount + ')');
      t.assert(parts[0] === r.sum.timeAmount && parts[1] === r.sum.materialAmount && parts[2] === r.sum.fixedAmount, 'delsummorna visas med öre och stämmer mot getSummary()');
      t.assert(/Hela kön/i.test(r.headText) && /ex moms/i.test(r.headText), 'huvudet är märkt "Hela kön" och "ex moms"');
      t.assert(new RegExp(r.issues + ' poster kräver åtgärd').test(r.headText) && /ingår inte i summan/.test(r.headText), 'åtgärdsräkningen visas och sägs inte ingå i summan');
      t.assert(r.groups.length === Object.keys(r.byCust).length, 'en kundrad per kund (' + r.groups.length + ')');
      t.assert(r.groups.every((g) => !g.open && g.rows === 0), 'standardläget är kompakt: inga underlagsrader utfällda');
      let groupSum = 0;
      for (const g of r.groups) {
        const b = r.byCust[g.key];
        groupSum += num(g.amount);
        t.assert(b && num(g.amount) === b.sel, g.key + ': belopp ' + g.amount + ' = summan av valbara underlag ' + (b && b.sel));
        t.assert(g.meta.includes(b.aos + ' AO') && g.meta.includes(b.n + ' underlag'), g.key + ': antal AO/underlag i raden (' + g.meta + ') = ' + b.aos + ' AO, ' + b.n + ' underlag');
        if (b.iss) t.assert(g.meta.includes(b.iss + ' kräver åtgärd'), g.key + ': visar ' + b.iss + ' kräver åtgärd');
      }
      t.assert(r2(groupSum) === r.sum.totalAmount, 'kundradernas belopp summerar till köns total (' + r2(groupSum) + ')');
      // Fäll ut kunden med åtgärdsposten: posten visas med orsak och utan kryssruta.
      await s.page.locator('#bq-list .bqv-cust[data-key="c:K-001"] .bqv-cust-row .bqv-tog').click();
      await s.settle(250);
      await s.page.locator('#bq-list .bqv-ao[data-key="a:K-001|AO-001"] .bqv-ao-row .bqv-tog').click();
      await s.settle(250);
      const issRow = await s.eval(() => { const e = document.querySelector('#bq-list .bqv-src.is-issue[data-issue-key="material:AO-001:M-QA-1"]'); return e ? { text: e.innerText, cb: !!e.querySelector('input') } : null; });
      t.assert(issRow && /Saknar försäljningspris/.test(issRow.text) && !issRow.cb, 'utfälld AO visar åtgärdsposten med orsak och utan kryssruta');
      // Filter: Typ = Tid → summa för filtrerat urval, köns total oförändrad.
      await s.page.selectOption('#bq-f-type', 'time');
      await s.settle(300);
      const f = await s.eval(() => {
        const all = BillingQueueService.getCandidates();
        const exp = Math.round(all.filter((c) => c.selectable && c.sourceType === 'time').reduce((a, c) => a + c.amount, 0) * 100) / 100;
        const el = document.querySelector('#bq-list [data-filtered-sum]');
        return { exp, shown: el && el.getAttribute('data-filtered-sum'), text: document.querySelector('#bq-list .bqv-result').innerText, head: document.querySelector('#bq-head [data-total]').getAttribute('data-total') };
      });
      t.assert(/Summa för filtrerat urval/.test(f.text) && /ex moms/.test(f.text), 'filtrerad summa är märkt "Summa för filtrerat urval … ex moms": ' + f.text.replace(/\s+/g, ' '));
      t.assert(num(f.shown) === f.exp, 'filtrerad summa = summan av valbara tidunderlag (' + f.shown + ' = ' + f.exp + ')');
      t.assert(num(f.head) === r.sum.totalAmount, 'köns total i huvudet påverkas inte av filtret');
    },
  },
  {
    id: 'BILL-02', module: 'Fakturering och fakturaunderlag', name: 'Fakturakön: kryssruta med tre lägen och "x av y valda"; Välj alla gäller uttryckligen de N som matchar filtret; valda som döljs av filtret sägs ut och kan avmarkeras; tangentbord fäller ut',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('ekonomi');
      await openQueue(s);
      const cust = '#bq-list .bqv-cust[data-key="c:K-001"]';
      // Tangentbord: fokus på pilknappen + Enter fäller ut och fokus stannar kvar.
      await s.page.locator(cust + ' .bqv-cust-row .bqv-tog').focus();
      await s.page.keyboard.press('Enter');
      await s.settle(250);
      const kb = await s.eval(() => ({ open: document.querySelector('#bq-list .bqv-cust[data-key="c:K-001"]').classList.contains('is-open'), focus: document.activeElement && document.activeElement.getAttribute('data-key'), exp: document.activeElement && document.activeElement.getAttribute('aria-expanded') }));
      t.assert(kb.open && kb.focus === 'c:K-001' && kb.exp === 'true', 'Enter på pilknappen fäller ut kunden och fokus står kvar på knappen ' + JSON.stringify(kb));
      const n = await s.eval(() => document.querySelector('#bq-list .bqv-cust[data-key="c:K-001"] .bqv-cust-row .bqv-cb').getAttribute('data-group-ids').split('|').length);
      t.assert(n >= 3, 'kunden har minst tre valbara underlag (' + n + ')');
      await s.page.locator(cust + ' .bqv-cust-row input.bqv-cb').check();
      await s.settle(200);
      const st = () => s.eval(() => {
        const c = document.querySelector('#bq-list .bqv-cust[data-key="c:K-001"]');
        const cb = c.querySelector('.bqv-cust-row .bqv-cb');
        const ao = c.querySelector('.bqv-ao[data-key="a:K-001|AO-001"] .bqv-ao-row .bqv-cb');
        return { c: cb.checked, i: cb.indeterminate, info: c.querySelector('.bqv-cust-row .bqv-selinfo').textContent, aoC: ao.checked, aoI: ao.indeterminate,
          aoInfo: c.querySelector('.bqv-ao[data-key="a:K-001|AO-001"] .bqv-ao-row .bqv-selinfo').textContent, count: SelectionModel.count(),
          sum: (document.querySelector('#bq-selsum .bqv-sel-count') || {}).innerText || '' };
      });
      let a = await st();
      t.assert(a.c && !a.i && a.info === n + ' av ' + n + ' valda' && a.count === n, 'kund markerad: alla ' + n + ' valda ' + JSON.stringify(a));
      t.assert(new RegExp('^' + n + ' underlag valda').test(a.sum), 'klistrad summering visar antalet valda (' + a.sum + ')');
      // Fäll ut AO-001 och avmarkera en rad → delvis markerad kund och AO.
      await s.page.locator(cust + ' .bqv-ao[data-key="a:K-001|AO-001"] .bqv-ao-row .bqv-tog').click();
      await s.settle(250);
      await s.page.locator(cust + ' .bqv-ao[data-key="a:K-001|AO-001"] .bqv-src input._sel-cb').first().uncheck();
      await s.settle(200);
      a = await st();
      t.assert(!a.c && a.i && a.info === (n - 1) + ' av ' + n + ' valda', 'en rad avmarkerad: kunden delvis markerad, "' + (n - 1) + ' av ' + n + ' valda" ' + JSON.stringify(a));
      t.assert(!a.aoC && a.aoI && /^\d+ av \d+ valda$/.test(a.aoInfo), 'AO:n visas också delvis markerad (' + a.aoInfo + ')');
      // Filtrerad "Välj alla": bara de N som matchar, uttryckligt antal.
      await s.page.locator('#bq-selsum [data-act="clear-sel"]').click();
      await s.settle(200);
      await s.page.fill('#bq-search', 'Granit');
      await s.settle(350);
      const g = await s.eval(() => {
        const match = BillingQueueService.getCandidates().filter((c) => c.selectable && /Granit/i.test([c.customerName, c.propertyName, c.workOrderNumber, c.workOrderTitle, c.staffName, c.description].join(' ')));
        return { n: match.length, ids: match.map((c) => c.id), label: document.querySelector('#bq-list .bqv-selall').innerText.replace(/\s+/g, ' ') };
      });
      t.assert(g.n > 0 && g.label === 'Välj alla ' + g.n + ' som matchar filtret', 'etiketten säger exakt hur många som väljs: "' + g.label + '" (N=' + g.n + ')');
      await s.page.locator('#bq-list ._sel-all-cb').check();
      await s.settle(250);
      const sel = await s.eval(() => SelectionModel.getSelected());
      t.assert(sel.length === g.n && sel.every((id) => g.ids.includes(id)), 'Välj alla markerar exakt de ' + g.n + ' som matchar filtret (fick ' + sel.length + ')');
      // Rensa filtret: inget annat har markerats, kryssrutan blir delvis markerad.
      await s.page.fill('#bq-search', '');
      await s.settle(350);
      const after = await s.eval(() => ({ n: SelectionModel.count(), ind: document.querySelector('#bq-list ._sel-all-cb').indeterminate, notes: (document.querySelector('#bq-selsum .bqv-sel-notes') || {}).innerText || '' }));
      t.assert(after.n === g.n && after.ind && after.notes === '', 'utan filter: fortfarande ' + g.n + ' valda, "Välj alla" delvis markerad, inga dolda ' + JSON.stringify(after));
      // Markera en rad hos en annan kund och filtrera bort den → sägs ut i summeringen.
      await s.page.locator('#bq-list .bqv-cust[data-key="c:K-004"] .bqv-cust-row input.bqv-cb').check();
      await s.settle(200);
      await s.page.fill('#bq-search', 'Granit');
      await s.settle(350);
      const hid = await s.eval(() => ({ notes: (document.querySelector('#bq-selsum .bqv-sel-notes') || {}).innerText || '', n: SelectionModel.count() }));
      t.assert(/1 av de valda syns inte med nuvarande filter/.test(hid.notes), 'valt underlag som döljs av filtret sägs ut: "' + hid.notes.replace(/\s+/g, ' ') + '"');
      await s.page.locator('#bq-selsum [data-act="desel-hidden"]').click();
      await s.settle(250);
      const fin = await s.eval(() => SelectionModel.getSelected());
      t.assert(fin.length === g.n && fin.every((id) => g.ids.includes(id)), '"Avmarkera dolda" tar bort just de dolda (' + fin.length + ' kvar)');
    },
  },
  {
    id: 'BILL-03', module: 'Fakturering och fakturaunderlag', name: 'Kräver åtgärd: ett klick filtrerar; exakt de ej valbara kandidaterna med orsak och förklaring; direkta åtgärder följer behörighet (admin: Ändra materialpris öppnar AO:ns materialdialog)',
    async run(t) {
      seedQa(t.fake);
      for (const role of ['ekonomi', 'admin']) {
        const s = await t.world.session({ viewport: 'laptop' });
        await s.login(role);
        await openQueue(s);
        await s.page.locator('#bq-head [data-act="show"][data-show="atgard"]').click();
        await s.settle(300);
        const r = await s.eval(() => {
          const exp = BillingQueueService.getCandidates().filter((c) => !c.selectable);
          const cards = [...document.querySelectorAll('#bq-list .bqv-issue')].map((e) => ({ id: e.getAttribute('data-issue-key'), text: e.innerText, acts: [...e.querySelectorAll('.bqv-issue-acts button')].map((b) => b.textContent.trim()) }));
          return { exp: exp.map((c) => ({ id: c.id, issues: c.issues })), cards, chip: document.querySelector('#bq-chips .chip.on').textContent.replace(/\s+/g, ' '), rows: document.querySelectorAll('#bq-list .bqv-src, #bq-list .bqv-cust').length, selAll: !!document.querySelector('#bq-list ._sel-all-cb') };
        });
        t.assert(/Kräver åtgärd/.test(r.chip), role + ': flikchipet "Kräver åtgärd" är valt (' + r.chip + ')');
        t.assert(r.cards.length === r.exp.length && r.exp.length >= 2, role + ': ' + r.cards.length + ' kort = ' + r.exp.length + ' ej valbara kandidater');
        t.assert(r.exp.every((c) => r.cards.some((k) => k.id === c.id && c.issues.every((i) => k.text.includes(i)))), role + ': varje kort har sin kandidat och alla dess orsaker');
        t.assert(r.rows === 0 && !r.selAll, role + ': inga valbara rader eller Välj alla i åtgärdsvyn');
        const mat = r.cards.find((k) => k.id === 'material:AO-001:M-QA-1');
        const tid = r.cards.find((k) => k.id === 'time:TE-QA-1');
        t.assert(/Materialraden saknar försäljningspris/.test(mat.text) && /AO saknar prismodell/.test(tid.text) && /saknar prismodell \(löpande timpris eller fast pris\)/.test(tid.text), role + ': förklaringstexter visas');
        t.assert(tid.acts.some((x) => /Sätt prissättning/.test(x)) && tid.acts.some((x) => /Öppna AO-QA-1/.test(x)), role + ': tidposten har Sätt prissättning + Öppna AO (' + tid.acts.join(', ') + ')');
        if (role === 'ekonomi') {
          t.assert(!mat.acts.some((x) => /materialpris/.test(x)) && mat.acts.some((x) => /Öppna AO-001/.test(x)), 'ekonomi (utan ao_material): ingen "Ändra materialpris", bara Öppna AO (' + mat.acts.join(', ') + ')');
        } else {
          t.assert(mat.acts.some((x) => /Ändra materialpris/.test(x)), 'admin: "Ändra materialpris" finns');
          await s.page.locator('#bq-list .bqv-issue[data-issue-key="material:AO-001:M-QA-1"] [data-act="edit-mat"]').click();
          await s.page.waitForSelector('.modal-overlay.open #mat-name', { timeout: 5000 });
          const m = await s.eval(() => ({ page: Router.currentPage, ao: WorkOrderDetailPage.aoId, name: document.getElementById('mat-name').value }));
          t.assert(m.ao === 'AO-001' && m.name === 'Rör utan pris', 'Ändra materialpris öppnar AO-001 och materialdialogen för raden ' + JSON.stringify(m));
        }
        await s.context.close();
      }
    },
  },
  {
    id: 'BILL-04', kind: 'workflow', module: 'Fakturering och fakturaunderlag', name: 'Delvis urval → fakturautkast: summeringen (ex moms/moms/inkl.) = skapade utkast, exakt de valda raderna, de försvinner ur kön och kan inte faktureras igen',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('ekonomi');
      await openQueue(s);
      const before = await s.eval(() => BillingQueueService.getCandidates().filter((c) => c.selectable).map((c) => ({ id: c.id, customerId: c.customerId, workOrderId: c.workOrderId, q: c.quantity, p: c.unitPrice, v: c.vatRate, amount: c.amount, type: c.sourceType })));
      const k1 = before.filter((c) => c.customerId === 'K-001');
      const k2 = before.filter((c) => c.customerId === 'K-002');
      t.assert(k1.length >= 3 && k2.length >= 2, 'förutsättning: två kunder med flera underlag');
      const pick = [k1.find((c) => c.type === 'time'), k1.find((c) => c.type === 'material'), k2[0]].filter(Boolean);
      t.assert(pick.length === 3, 'tre underlag valda ur två kunder');
      const ids = pick.map((c) => c.id);
      await s.page.locator('#bq-expand-all').click();
      await s.settle(300);
      for (const id of ids) await s.page.locator('#bq-list input._sel-cb[data-sel-id="' + id + '"]').check();
      await s.settle(250);
      // Oberoende förväntan: ett utkast per kund, rad = antal × à-pris, moms per rad, avrundat per faktura.
      const per = {};
      pick.forEach((c) => { const b = per[c.customerId] = per[c.customerId] || { ex: 0, vat: 0 }; b.ex += c.q * c.p; b.vat += c.q * c.p * c.v / 100; });
      const exp = Object.values(per).reduce((a, b) => ({ ex: a.ex + r2(b.ex), vat: a.vat + r2(b.vat) }), { ex: 0, vat: 0 });
      exp.ex = r2(exp.ex); exp.vat = r2(exp.vat); exp.total = r2(exp.ex + exp.vat);
      const shown = await s.eval(() => { const q = (a) => document.querySelector('#bq-selsum [' + a + ']'); return { n: q('data-sel-count').getAttribute('data-sel-count'), ex: q('data-sel-ex').getAttribute('data-sel-ex'), vat: q('data-sel-vat').getAttribute('data-sel-vat'), total: q('data-sel-total').getAttribute('data-sel-total'), text: document.getElementById('bq-selsum').innerText.replace(/\s+/g, ' ') }; });
      t.note('valt: ' + shown.text);
      t.assert(Number(shown.n) === 3 && /3 underlag valda · 2 kunder/.test(shown.text), 'summeringen: 3 underlag, 2 kunder');
      t.assert(/Ex moms/i.test(shown.text) && /\bMoms\b/i.test(shown.text) && /Inkl\. moms/i.test(shown.text), 'ex moms, moms och inkl. moms är märkta');
      t.assert(Number(shown.ex) === exp.ex && Number(shown.vat) === exp.vat && Number(shown.total) === exp.total, 'summering ' + [shown.ex, shown.vat, shown.total].join('/') + ' = förväntat ' + [exp.ex, exp.vat, exp.total].join('/'));
      const invBefore = new Set(t.fake.get('invoices').map((i) => i.id));
      const headBefore = await s.eval(() => BillingQueueService.getSummary().totalAmount);
      await s.page.locator('#bq-selsum [data-act="create"]').click();
      await s.page.waitForSelector('.modal-overlay.open .bqv-cf-sums', { timeout: 5000 });
      const modal = await s.eval(() => document.querySelector('.modal-overlay.open').innerText.replace(/\s+/g, ' '));
      t.assert(/Skapa 2 fakturautkast/.test(modal) && modal.includes(new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2 }).format(exp.total).replace(/[  ]/g, ' ')), 'bekräftelsen visar 2 utkast och samma totalbelopp');
      await s.clickModalButton(/Skapa 2 fakturautkast/);
      await s.settle(1500);
      const created = t.fake.get('invoices').filter((i) => !invBefore.has(i.id));
      const keys = created.flatMap((i) => (i.lines || []).flatMap((l) => (l.sourceRefs || []).map((r) => r.sourceKey)));
      t.assert(created.length === 2, 'två fakturautkast på servern (ett per kund): ' + created.map((i) => i.id).join(', '));
      t.assert(keys.length === 3 && ids.every((id) => keys.includes(id)), 'utkasten innehåller exakt de valda raderna: ' + keys.join(', '));
      const sums = await s.eval((invs) => invs.map((i) => InvoiceService.calcSummary(i)), created);
      const got = sums.reduce((a, x) => ({ ex: a.ex + x.exVat, vat: a.vat + x.vat, total: a.total + x.totalInclVat }), { ex: 0, vat: 0, total: 0 });
      t.assert(r2(got.ex) === exp.ex && r2(got.vat) === exp.vat && r2(got.total) === exp.total, 'utkastens calcSummary = summeringen i kön (' + [r2(got.ex), r2(got.vat), r2(got.total)].join('/') + ')');
      await openQueue(s);
      const q = await s.eval((ids) => { const all = BillingQueueService.getCandidates(); return { left: ids.filter((id) => all.some((c) => c.id === id)), rest: all.filter((c) => c.customerId === 'K-001' && c.selectable).length, total: BillingQueueService.getSummary(all).totalAmount, sel: SelectionModel.count(), dom: ids.filter((id) => document.querySelector('#bq-list [data-sel-id="' + id + '"]')).length }; }, ids);
      t.assert(q.left.length === 0 && q.dom === 0, 'de fakturerade raderna finns inte längre i kön');
      t.assert(q.rest === k1.length - 2, 'K-001:s övriga ' + (k1.length - 2) + ' underlag ligger kvar (' + q.rest + ')');
      t.assert(r2(headBefore - q.total) === exp.ex, 'köns total minskade med exakt ex moms-summan (' + r2(headBefore - q.total) + ')');
      // Ingen dubbelfakturering: samma urval igen nekas och skapar inget.
      const again = await s.eval((ids) => BillingQueueService.createInvoicesFromSourceKeys(ids), ids);
      t.assert(again.ok === false, 'samma underlag igen nekas: ' + String(again.error).slice(0, 100));
      t.assert(t.fake.get('invoices').length === invBefore.size + 2, 'inga fler fakturor på servern');
    },
  },
  {
    id: 'BILL-05', module: 'Fakturering och fakturaunderlag', name: 'Fakturaunderlagets detalj: rader visas ex moms med momssats i egen kolumn och stämmer mot summa ex moms, moms per sats och totalt inkl. moms (blandad 25/12/0 %, med och utan rabatt); statushjälp',
    async run(t) {
      seedQa(t.fake);
      for (const [vp, inv] of [['laptop', 'INV-QA-MIX'], ['laptop', 'INV-QA-DISC'], ['android', 'INV-QA-MIX']]) {
        const s = await t.world.session({ viewport: vp });
        await s.login('ekonomi');
        await s.go('pg-inv-detail', { invoiceId: inv });
        await s.settle(400);
        const r = await s.eval((id) => {
          const pg = document.querySelector('.page.active');
          const tv = (k) => { const e = pg.querySelector('#inv-totals [data-t="' + k + '"]'); return e ? { label: e.children[0].textContent.trim(), value: e.children[1].textContent } : null; };
          return {
            head: [...pg.querySelectorAll('.invl-head span')].map((e) => e.textContent.trim()),
            rows: [...pg.querySelectorAll('.invl-row')].map((e) => ({ amt: e.querySelector('.invl-amt-v').textContent, label: e.querySelector('.invl-amt .invl-k').textContent, vat: e.querySelector('.invl-vat span:last-child').textContent, qty: e.querySelector('.invl-qty span:last-child').textContent.replace(/\s+/g, ' '), price: e.querySelector('.invl-price span:last-child').textContent })),
            lines: tv('lines'), disc: tv('disc'), ex: tv('ex'), vat: tv('vat'), total: tv('total'),
            parts: [...pg.querySelectorAll('#inv-totals [data-t="vat-part"]')].map((e) => ({ rate: e.getAttribute('data-rate'), label: e.children[0].textContent, value: e.children[1].textContent })),
            calc: InvoiceService.calcSummary(getInv(id)), help: (pg.querySelector('[data-status-help]') || {}).innerText || '',
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        }, inv);
        const tag = vp + ' ' + inv + ': ';
        if (vp !== 'android') t.assert(r.head.includes('Belopp ex moms') && r.head.includes('Moms') && r.head.includes('À-pris ex moms'), tag + 'kolumnrubriker: ' + r.head.join(' | '));
        t.assert(r.rows.every((x) => x.label === 'Belopp ex moms'), tag + 'varje radbelopp är märkt "Belopp ex moms"');
        const first = r.rows[0];
        t.assert(/2 tim/.test(first.qty) && num(first.price) === 430 && num(first.amt) === 860 && /25 %/.test(first.vat), tag + '2 tim × 430 kr visas som 860,00 kr ex moms med 25 % moms (inte 1 075 kr) ' + JSON.stringify(first));
        const rowSum = r2(r.rows.reduce((a, x) => a + num(x.amt), 0));
        const partsSum = r2(r.parts.reduce((a, x) => a + num(x.value), 0));
        t.assert(r.parts.length === 3 && ['25', '12', '0'].every((k) => r.parts.some((p) => p.rate === k)), tag + 'moms per sats 25/12/0 visas');
        t.assert(num(r.vat.value) === r.calc.vat && partsSum === r.calc.vat, tag + 'moms ' + r.vat.value + ' = calcSummary ' + r.calc.vat + ' = summan per sats ' + partsSum);
        t.assert(num(r.total.value) === r.calc.totalInclVat && r2(num(r.ex.value) + num(r.vat.value)) === num(r.total.value), tag + 'ex + moms = totalt inkl. moms (' + r.total.value + ')');
        if (inv === 'INV-QA-DISC') {
          t.assert(r.lines && num(r.lines.value) === rowSum && rowSum === r.calc.linesEx, tag + 'Summa rader ex moms ' + (r.lines && r.lines.value) + ' = radernas summa ' + rowSum);
          t.assert(r2(num(r.lines.value) - num(r.disc.value.replace('−', ''))) === num(r.ex.value) && num(r.ex.value) === r.calc.exVat, tag + 'rader − rabatt = ex moms efter rabatt (' + r.ex.value + ')');
          t.assert(r.parts.every((p) => /efter rabatt/.test(p.label)), tag + 'moms per sats märkt "efter rabatt"');
          t.note(inv + ': rader ' + rowSum + ' − rabatt ' + r.calc.discAmt + ' = ' + r.calc.exVat + ', moms ' + r.calc.vat + ', totalt ' + r.calc.totalInclVat);
        } else {
          t.assert(num(r.ex.value) === rowSum && rowSum === r.calc.exVat, tag + 'radernas summa ' + rowSum + ' = Summa ex moms ' + r.ex.value);
          t.note(inv + ' (' + vp + '): rader ' + rowSum + ' = ex ' + r.calc.exVat + ', moms ' + r.calc.vat + ' (' + r.parts.map((p) => p.rate + '%:' + num(p.value)).join(', ') + '), totalt ' + r.calc.totalInclVat);
        }
        t.assert(/Utkast/.test(r.help) && /VIFT skickar ingenting/.test(r.help), tag + 'statushjälpen förklarar utkast: ' + r.help.slice(0, 80));
        t.assert(r.overflow <= 2, tag + 'ingen horisontell överbredd (' + r.overflow + ')');
        await s.context.close();
      }
    },
  },
  {
    id: 'BILL-06', module: 'Fakturering och fakturaunderlag', kind: 'ui', name: 'Fakturakön: renderingstid för 10/100/1000 simulerade kandidater (kompakt vy, Välj alla, Visa alla rader) inom budget; progressiv rendering',
    async run(t) {
      const out = {};
      for (const n of [10, 100, 1000]) {
        const w = new lib.World();
        try {
          seedBulk(w.fake, n);
          const s = await w.session({ viewport: 'laptop' });
          await s.login('admin');
          await openQueue(s);
          const m = await s.eval(async () => {
            const times = [];
            for (let i = 0; i < 3; i++) { InvoicesPage._renderQueueList(); times.push(InvoicesPage._lastRenderMs); }
            times.sort((a, b) => a - b);
            const cands = BillingQueueService.getCandidates().length;
            const groups = document.querySelectorAll('#bq-list .bqv-cust').length;
            const more = !!document.querySelector('#bq-list [data-act="more"]');
            let t0 = performance.now();
            document.querySelector('#bq-list ._sel-all-cb').click();
            await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
            const selMs = performance.now() - t0;
            const selected = SelectionModel.count();
            t0 = performance.now();
            document.querySelector('#bq-list ._sel-all-cb').click();
            await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
            const deselMs = performance.now() - t0;
            t0 = performance.now();
            InvoicesPage._expandAll();
            const expMs = performance.now() - t0;
            const rowsShown = document.querySelectorAll('#bq-list .bqv-src').length;
            return { cands, median: times[1], groups, more, selMs: Math.round(selMs), deselMs: Math.round(deselMs), selected, expMs: Math.round(expMs), rowsShown, after: SelectionModel.count() };
          });
          out[n] = m;
          t.metric(n + ' kandidater: kompakt rendering (median ms)', m.median);
          t.metric(n + ' kandidater: Välj alla / avmarkera (ms)', m.selMs + ' / ' + m.deselMs);
          t.metric(n + ' kandidater: Visa alla rader (ms, ' + m.rowsShown + ' rader)', m.expMs);
          t.note(n + ': ' + JSON.stringify(m));
          t.assert(m.cands >= n, n + ': kön har minst ' + n + ' kandidater (' + m.cands + ')');
          t.assert(m.selected >= n && m.after === 0, n + ': Välj alla markerade ' + m.selected + ' och avmarkerade alla');
          t.assert(m.groups <= 30, n + ': högst 30 kundgrupper ritas åt gången (' + m.groups + ')');
          if (n === 1000) t.assert(m.more, '1000: "Visa fler kunder" finns (progressiv rendering)');
        } finally { await w.close(); }
      }
      // Budget (lokal maskin, simulerad backend): kompakt vy ≤ 400 ms, markering/utfällning ≤ 1500 ms vid 1000 kandidater.
      t.assert(out[1000].median <= 400, '1000 kandidater: kompakt rendering ' + out[1000].median + ' ms ≤ 400 ms');
      t.assert(out[1000].selMs <= 1500 && out[1000].deselMs <= 1500 && out[1000].expMs <= 1500, '1000 kandidater: Välj alla/avmarkera/Visa alla rader ≤ 1500 ms (' + [out[1000].selMs, out[1000].deselMs, out[1000].expMs].join(' / ') + ')');
    },
  },
  {
    id: 'BILL-07', module: 'Fakturering och fakturaunderlag', kind: 'ui', name: 'Fakturakön och fakturadetaljen utan horisontell överbredd 360–1920 px; klistrad summering ovanför bottenmenyn på mobil; mål ≥ 40 px',
    async run(t) {
      seedQa(t.fake);
      const issues = [];
      const check = async (s, where) => {
        const li = await s.layoutIssues();
        const extra = await s.eval(() => {
          const vw = document.documentElement.clientWidth;
          const bad = [];
          const cs = document.getElementById('content-scroll');
          if (cs && cs.scrollWidth > cs.clientWidth + 2) bad.push('innehållet bredare än skrollytan (' + cs.scrollWidth + ' > ' + cs.clientWidth + ')');
          const right = cs ? cs.getBoundingClientRect().right : vw;
          // Allt som sticker ut till höger om innehållsytan (även om en förälder klipper det) är fel,
          // utom i en avsiktligt skrollbar behållare inne på sidan.
          document.querySelectorAll('.page.active .bqv *, .page.active .invl *, .page.active .invt *, .page.active .doc-head *, .page.active .inv-right *').forEach((e) => {
            const r = e.getBoundingClientRect();
            if (!(r.width > 0 && r.right > right + 1) || getComputedStyle(e).position === 'fixed') return;
            let p = e.parentElement, sc = false;
            while (p && p !== cs && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') { sc = true; break; } p = p.parentElement; }
            if (!sc) bad.push(((e.className && String(e.className).split(' ')[0]) || e.tagName) + ' (' + Math.round(r.right) + ' > ' + Math.round(right) + ')');
          });
          return [...new Set(bad)].slice(0, 5);
        });
        li.concat(extra.map((x) => 'utanför: ' + x)).forEach((m) => issues.push(where + ': ' + m));
      };
      const sizes = [['android', 360], ['iphone', 390], ['desktop', 768], ['desktop', 1024], ['desktop', 1366], ['desktop', 1920]];
      let desk = null;
      for (const [vp, w] of sizes) {
        let s;
        if (vp === 'desktop') { if (!desk) { desk = await t.world.session({ viewport: 'desktop' }); await desk.login('admin'); } s = desk; await s.page.setViewportSize({ width: w, height: 900 }); await s.settle(300); }
        else { s = await t.world.session({ viewport: vp }); await s.login('admin'); }
        await s.eval(() => { try { SelectionModel.clearAll(); } catch (e) {} });
        await openQueue(s);
        await check(s, w + ' kö kompakt');
        if (w <= 767) { await s.page.locator('.bqv-ftoggle').click(); await s.settle(200); }
        await s.page.locator('#bq-expand-all').click(); await s.settle(300);
        await s.page.locator('#bq-list .bqv-cust-row input.bqv-cb').first().check(); await s.settle(250);
        await check(s, w + ' kö utfälld + markerad');
        const m = await s.eval(() => {
          const sel = document.querySelector('#bq-selsum .bqv-sel');
          const nav = document.getElementById('mobile-bottom-nav');
          const navTop = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : window.innerHeight;
          const small = [...document.querySelectorAll('.page.active .bqv-cbw, .page.active .bqv-tog, .page.active .bqv-sel-acts .btn, .page.active .bqv-chips .chip')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).length;
          return { selBottom: sel ? sel.getBoundingClientRect().bottom : null, navTop, small, sticky: sel ? getComputedStyle(sel.parentElement).position : '' };
        });
        t.assert(m.sticky === 'sticky' && m.selBottom !== null && m.selBottom <= m.navTop + 1, w + ': klistrad summering ovanför bottenmenyn (' + Math.round(m.selBottom) + ' ≤ ' + Math.round(m.navTop) + ')');
        if (w <= 767) t.assert(m.small === 0, w + ': kryssrutor, pilar, chips och knappar i summeringen är minst 40 px höga (' + m.small + ' för små)');
        await s.page.locator('#bq-head [data-act="show"][data-show="atgard"]').click(); await s.settle(250);
        await check(s, w + ' Kräver åtgärd');
        await s.go('pg-inv-detail', { invoiceId: 'INV-QA-DISC' }); await s.settle(300);
        await check(s, w + ' detalj');
        if (vp !== 'desktop') await s.context.close();
      }
      t.assert(issues.length === 0, 'layoutfel: ' + issues.join(' ; '));
    },
  },
  {
    id: 'BILL-08', module: 'Säkerhet', kind: 'ui', name: 'Fakturakön utfälld och Kräver åtgärd samt fakturadetaljen: HTML i kund-, AO-, material-, tid- och radtexter körs aldrig och visas som text',
    async run(t) {
      seedQa(t.fake);
      const X = (f) => `<img src=x onerror="(window.__xss=window.__xss||[]).push('${f}')">"'><b>${f}</b>`;
      const cu = t.fake.get('customers'); cu.find((c) => c.id === 'K-001').name += X('kund'); t.fake.set('customers', cu);
      const pr = t.fake.get('properties'); (pr.find((p) => p.id === 'OBJ-001') || pr[0]).name += X('fastighet'); t.fake.set('properties', pr);
      const aos = t.fake.get('workOrders'); const a1 = aos.find((a) => a.id === 'AO-001'); a1.title += X('ao');
      a1.materials.forEach((m) => { m.name += X('material'); m.unit = (m.unit || 'st') + X('enhet'); }); t.fake.set('workOrders', aos);
      const tes = t.fake.get('timeEntries'); tes.forEach((x) => { x.comment = (x.comment || '') + X('tid'); x.staffName += X('personal'); }); t.fake.set('timeEntries', tes);
      const inv = t.fake.get('invoices'); const q = inv.find((i) => i.id === 'INV-QA-MIX'); q.lines[0].description += X('rad'); q.lines[1].unit += X('radenhet'); q.title += X('titel'); q.note = X('anteckning'); t.fake.set('invoices', inv);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await s.eval(() => { window.__xss = []; });
      await openQueue(s);
      await s.page.locator('#bq-expand-all').click(); await s.settle(300);
      await s.page.locator('#bq-list .bqv-cust[data-key="c:K-001"] .bqv-cust-row input.bqv-cb').check(); await s.settle(200);
      const txt1 = await s.eval(() => document.querySelector('.page.active').innerText);
      await s.page.locator('#bq-head [data-act="show"][data-show="atgard"]').click(); await s.settle(300);
      const txt2 = await s.eval(() => document.querySelector('.page.active').innerText);
      await s.eval(() => InvoicesPage._openCreateConfirm(SelectionModel.getSelected())); await s.settle(300);
      const txt3 = await s.eval(() => (document.querySelector('.modal-overlay.open') || {}).innerText || '');
      await s.eval(() => Modal.close());
      await s.go('pg-inv-detail', { invoiceId: 'INV-QA-MIX' }); await s.settle(300);
      const txt4 = await s.eval(() => document.querySelector('.page.active').innerText);
      const xss = await s.eval(() => window.__xss || []);
      t.assert(xss.length === 0, 'inget injicerat skript kördes: ' + xss.join(', '));
      t.assert(/<img src=x/.test(txt1) && /<b>material<\/b>/.test(txt1), 'utfälld kö visar datat som text');
      t.assert(/<b>material<\/b>/.test(txt2), 'Kräver åtgärd visar datat som text');
      t.assert(/<b>kund<\/b>/.test(txt3), 'bekräftelsedialogen visar kundnamnet som text');
      t.assert(/<b>rad<\/b>/.test(txt4) && /<b>anteckning<\/b>/.test(txt4), 'fakturadetaljen visar rad och anteckning som text');
    },
  },
];
