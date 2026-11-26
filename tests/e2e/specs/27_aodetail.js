'use strict';
/* V3 2026-11-26 — arbetsorderdetaljen (AO-detalj): primär åtgärd per status
   och roll, inga förlorade åtgärder (jämfört med den tidigare åtgärdsraden),
   checklistan i "Uppdrag & utförande", kompakt stämpling (Starta arbete ≠
   Stämpla in), prissättningskortet per roll och ingen horisontell
   överbredd 360–1920. Simulerad server. */

const STAFF = { admin: 'ST-001', chef: 'ST-003', falt: 'ST-002', falt2: 'ST-004', ekonomi: 'ST-006', begransad: 'ST-005' };
const EMAIL = { admin: 'admin@example.test', falt2: 'falt2@example.test' };

/* Testordrar (kopior av AO-007) i varje läge, tilldelade fält, fält2 och arbetsledare. */
function seed(t, extra) {
  const aos = t.fake.get('workOrders').filter((a) => !/^AO-T/.test(a.id));
  const base = aos.find((a) => a.id === 'AO-007');
  const mk = (id, x) => Object.assign(JSON.parse(JSON.stringify(base)), {
    id, displayNumber: id, staff: ['ST-002', 'ST-004', 'ST-003'], log: [], materials: [], invoiceId: '',
    archived: false, deleted: false, substatus: '', offerId: '', recurringOrderId: '',
  }, x);
  aos.push(
    mk('AO-T1', { status: 'planerad', title: 'Test planerad' }),
    mk('AO-T2', { status: 'pågående', title: 'Test pågående' }),
    mk('AO-T3', { status: 'klar', title: 'Test klar' }),
  );
  (extra || []).forEach((e) => aos.push(mk(e.id, e)));
  t.fake.set('workOrders', aos);
}

async function openAO(s, id) {
  await s.go('pg-ao-detail', { aoId: id });
  await s.page.waitForFunction((x) => WorkOrderDetailPage.aoId === x && document.querySelector('.page.active .aod-actbar'), id, { timeout: 8000 });
  await s.settle(200);
}

/* ── Realistiskt innehåll (komponentstandarden §12) ────────────────────
   Små riktiga PNG-bilder (data-URL som klarar isSafeImageDataUrl), 22
   checkpunkter i blandade lägen, sex materialrader, fem tidposter (olika
   personer, ej debiterbar, attesterad, annat sparat timpris), foton,
   anteckningar och uppföljning, långa texter — samt en order med saknade fält. */
function pngDataUrl(r, g, b) {
  const zlib = require('zlib');
  const W = 8, H = 6;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = Math.min(255, r + x * 8); raw[o + 1] = Math.min(255, g + y * 10); raw[o + 2] = b; } }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcT[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}

const RICH_TEXTS = ['Stäng av huvudkranen i källaren och informera boende i trapphus A', 'Fotografera skadan före åtgärd', 'Kontrollera fuktnivå i bjälklaget med fuktmätare (minst tre punkter)', 'Demontera golvbrunnens klämring', 'Rensa golvbrunn och vattenlås', 'Kontrollera tätskiktets anslutning mot brunnen', 'Byt klämring (rostfri, 110 mm)', 'Montera ny tätmanschett', 'Provtryck tappvatten 10 bar i 30 minuter', 'Kontrollera avloppets fall med vattenpass', 'Fogning runt rörgenomföringar', 'Kontrollera golvvärmekretsen', 'Mät spänning på golvvärmetermostaten', 'Byt silikonfog vid badkar', 'Rengör ventilationsdon i badrummet', 'Kontrollera frånluftsflödet', 'Montera tillbaka golvbrunnslocket', 'Torka upp och ställ ut avfuktare', 'Informera kunden om torktid (minst 72 timmar)', 'Fotografera efter åtgärd', 'Städa arbetsplatsen och trapphuset', 'Lämna nyckel till fastighetsskötaren'];

/* status: 'nytt'|'planerad'|'pågående'|'pausad'|'klar'|'fakturerad'|'avbruten'. */
function richAO(id, status) {
  const now = Date.now();
  const iso = (min) => new Date(now - min * 60000).toISOString();
  const st = status === 'pausad' ? 'pågående' : status;
  const done = { nytt: 0, planerad: 0, 'pågående': 9, pausad: 7, klar: 20, fakturerad: 20, avbruten: 4 }[status];
  const avv = { nytt: 0, planerad: 0, 'pågående': 2, pausad: 1, klar: 2, fakturerad: 2, avbruten: 0 }[status];
  const prog = { nytt: 0, planerad: 0, 'pågående': 3, pausad: 2, klar: 0, fakturerad: 0, avbruten: 1 }[status];
  const who = [['Jonas Pettersson', 'ST-004'], ['Erik Andersson', 'ST-002']];
  const checklist = RICH_TEXTS.map((text, i) => {
    const c = { id: 'r' + (i + 1), text, done: false, avvikelse: null };
    if (i === 2) c.description = 'Mät vid brunnen, vid dörren och under handfatet. Notera värdena i loggen.';
    const [n, sid] = who[i % 2];
    if (i < done) Object.assign(c, { done: true, avvikelse: 'ok', doneAt: iso(300 - i), doneBy: n, doneById: sid, startedAt: iso(320 - i), startedBy: n, startedById: sid });
    else if (i < done + avv) Object.assign(c, { avvikelse: 'avvikelse', avvikelseComment: i % 2 ? 'Sprucken klämring, nytt material beställt — leverans torsdag.' : 'Fukt 22 % i bjälklaget nära dörren, behöver torkas innan fogning.', avvikelseImage: pngDataUrl(200, 60, 40), avvikelseBy: n, avvikelseById: sid, avvikelseAt: iso(200 - i) });
    else if (i < done + avv + prog) Object.assign(c, { startedAt: iso(60 - i), startedBy: 'Jonas Pettersson', startedById: 'ST-004' });
    return c;
  });
  const materials = [
    ['Golvbrunn plastrens 110 mm med klämring och tätmanschett (Purus)', 1, 'st', 110, 220], ['Rostfri klämring 110 mm', 2, 'st', 48, 95],
    ['Fogmassa Sikaflex 291i', 3, 'st', 75, 145], ['Silikon sanitet vit 300 ml', 2, 'st', 45, 89], ['Tätskiktsmassa Wetroom 1 l', 1.5, 'l', 160, 320], ['Avfuktare hyra', 3, 'dygn', 0, 250],
  ].map(([name, qty, unit, buy, sell], i) => ({ id: 'rm' + (i + 1), name, qty, unit, buyPrice: buy, sellPrice: sell, vatRate: 25, addedAt: iso(240 - i * 10) }));
  const log = [
    { id: 'rl1', type: 'photo', text: 'Skadan före åtgärd — vatten vid brunnen', imageData: pngDataUrl(40, 90, 160), userName: 'Jonas Pettersson', timestamp: iso(310) },
    { id: 'rl2', type: 'photo', text: 'Fuktmätning vid dörren', imageData: pngDataUrl(60, 140, 90), userName: 'Erik Andersson', timestamp: iso(290) },
    { id: 'rl3', type: 'log', text: 'Ankomst 07:45. Boende informerade, vatten avstängt kl. 07:55. Källardörren var låst — nyckel hämtad hos fastighetsskötaren.', userName: 'Jonas Pettersson', timestamp: iso(305) },
    { id: 'rl4', type: 'photo', text: 'Ny klämring monterad', imageData: pngDataUrl(150, 150, 60), userName: 'Jonas Pettersson', timestamp: iso(120) },
    { id: 'rl5', type: 'photo', text: '', imageData: pngDataUrl(90, 60, 150), userName: 'Erik Andersson', timestamp: iso(100) },
    { id: 'rl6', type: 'uppföljning', text: 'Kontrollera arbete: torktid och fuktnivå efter 72 timmar', followUpDate: new Date(now + 3 * 864e5).toISOString().slice(0, 10), userName: 'Maria Karlsson', timestamp: iso(90) },
  ];
  return {
    id, displayNumber: id, status: st, substatus: status === 'pausad' ? 'pausad' : '', priority: 'hög', category: 'felanmalan',
    title: 'Vattenläckage vid golvbrunn i badrum, lägenhet 1102 — byte av klämring och tätning',
    description: 'Boende i lgh 1102 rapporterar vatten på badrumsgolvet vid golvbrunnen efter dusch. Misstänkt otät klämring eller skadat tätskikt vid brunnen. Undersök orsaken, åtgärda läckaget och dokumentera med foton före och efter.\n\nObs! Boende har husdjur (katt) — håll badrumsdörren stängd. Parkering på gården är tillåten för servicebil.',
    internalNote: 'Kunden har tidigare klagat på lång handläggningstid — ring kontaktpersonen när arbetet startar och när det är klart. Nyckel finns i nyckelskåpet, kod lämnas av arbetsledaren.',
    customerId: 'K-002', propertyId: '', address: 'Parkgatan 8', zip: '411 38', city: 'Göteborg', floor: '11', apartmentNumber: '1102', entrance: 'B',
    contactPerson: 'Mikael Strand', phone: '070-400 50 60', contactEmail: 'mikael.strand@example.test',
    staff: ['ST-004', 'ST-002', 'ST-003'], responsibleStaffId: 'ST-003',
    scheduledDate: new Date(now).toISOString().slice(0, 10), scheduledStart: '07:30', scheduledEnd: '15:00', estimatedHours: 6,
    priceType: 'timpris', priceGroupId: 'PG-002', fixedPrice: 0,
    checklist, materials, log, notes: [], invoiceId: status === 'fakturerad' ? 'INV-003' : '', offerId: '', recurringOrderId: '',
    archived: false, deleted: false, createdAt: iso(3000), updatedAt: iso(30),
    completedAt: ['klar', 'fakturerad'].includes(status) ? iso(20) : '', completedBy: ['klar', 'fakturerad'].includes(status) ? 'Maria Karlsson' : '',
  };
}
function richTime(aoId) {
  const d = new Date().toISOString().slice(0, 10);
  const mk = (i, staffId, staffName, start, end, extra) => Object.assign({ id: 'RT-' + aoId + '-' + i, aoId, staffId, staffName, date: d, startStr: start, endStr: end,
    minutes: (Number(end.slice(0, 2)) * 60 + Number(end.slice(3))) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3))), comment: 'Felsökning och åtgärd vid golvbrunn', priceGroupId: 'PG-002', priceGroupName: 'Fastighetsservice standard', hourRate: 430, billable: true, internal: false, createdAt: new Date().toISOString() }, extra || {});
  return [mk(1, 'ST-004', 'Jonas Pettersson', '07:30', '10:00'), mk(2, 'ST-002', 'Erik Andersson', '07:30', '09:15'), mk(3, 'ST-004', 'Jonas Pettersson', '10:30', '12:00', { billable: false, comment: 'Hämtade material på grossisten' }),
    mk(4, 'ST-003', 'Maria Karlsson', '13:00', '13:30', { attested: true, comment: 'Platsbesök arbetsledare' }), mk(5, 'ST-004', 'Jonas Pettersson', '12:30', '14:45', { priceGroupId: 'PG-004', priceGroupName: 'Akut / kväll / helg', hourRate: 695 })];
}
const RICH_STATUSES = ['nytt', 'planerad', 'pågående', 'pausad', 'klar', 'fakturerad', 'avbruten'];
const RICH_IDS = { nytt: 'AO-R1', planerad: 'AO-R2', 'pågående': 'AO-R3', pausad: 'AO-R4', klar: 'AO-R5', fakturerad: 'AO-R6', avbruten: 'AO-R7' };
/* Order med saknade fält: ingen beskrivning, adress, kontakt, datum, kategori, prismodell eller checklista. */
function missingAO(id) {
  return { id, displayNumber: id, status: 'planerad', substatus: '', priority: 'normal', category: '', title: 'Okänd felanmälan', description: '', internalNote: '',
    customerId: '', propertyId: '', address: '', zip: '', city: '', contactPerson: '', phone: '', staff: ['ST-004'], responsibleStaffId: '',
    scheduledDate: '', scheduledStart: '', scheduledEnd: '', priceType: 'ej_satt', priceGroupId: '', fixedPrice: 0,
    checklist: [], materials: [], log: [], notes: [], invoiceId: '', offerId: '', archived: false, deleted: false, createdAt: new Date().toISOString(), updatedAt: '' };
}
function seedRich(t) {
  const aos = t.fake.get('workOrders').filter((a) => !/^AO-R/.test(a.id));
  const tes = t.fake.get('timeEntries').filter((e) => !/^RT-/.test(e.id));
  RICH_STATUSES.forEach((st) => { aos.push(richAO(RICH_IDS[st], st)); if (st !== 'nytt' && st !== 'planerad') tes.push(...richTime(RICH_IDS[st])); });
  aos.push(missingAO('AO-RM'));
  aos.push(Object.assign(richAO('AO-RF', 'planerad'), { title: 'Fältflöde: byte av blandare i tvättstuga' }));
  t.fake.set('workOrders', aos);
  t.fake.set('timeEntries', tes);
}

/* Förväntad primär åtgärd per roll och status (befintliga funktioner och behörigheter). */
const RICH_PRIMARY = {
  /* T3-B (D-03): standardrollen personal har ao_complete_own → Klarmarkera på egen pågående/pausad AO. */
  falt2:   { nytt: 'own', planerad: 'own', 'pågående': 'complete', pausad: 'complete', klar: null, fakturerad: null, avbruten: null, saknas: 'own' },
  chef:    { nytt: 'start', planerad: 'start', 'pågående': 'complete', pausad: 'complete', klar: 'invoice', fakturerad: null, avbruten: 'reactivate', saknas: 'start' },
  ekonomi: { nytt: null, planerad: null, 'pågående': null, pausad: null, klar: 'invoice', fakturerad: null, avbruten: null, saknas: null },
  admin:   { nytt: 'start', planerad: 'start', 'pågående': 'complete', pausad: 'complete', klar: 'invoice', fakturerad: null, avbruten: 'reactivate', saknas: 'start' },
};
const RICH_HANDLED = { nytt: 0, planerad: 0, 'pågående': 11, pausad: 8, klar: 22, fakturerad: 22, avbruten: 4 };
const RICH_TIME_ROWS = { falt2: 3, chef: 5, ekonomi: 5, admin: 5 }; // time-entries-list: egna, eller alla med payroll_view; T4-B (K-01): chef har time_view_all → alla (utan löneuppgifter)

async function richMatrix(t, vp) {
  seedRich(t);
  const problems = [];
  const P = (c, m) => { if (!c) problems.push(m); };
  for (const role of ['falt2', 'chef', 'ekonomi', 'admin']) {
    const s = await t.world.session({ viewport: vp });
    await s.login(role);
    const price = await s.eval(() => Auth.canAny(['invoice_view', 'invoice_create', 'reports_view']));
    const timeP = await s.eval(() => Auth.can('ao_time'));
    for (const st of RICH_STATUSES.concat(['saknas'])) {
      const id = st === 'saknas' ? 'AO-RM' : RICH_IDS[st];
      const tag = vp + ' ' + role + ' ' + st + ' (' + id + ')';
      await openAO(s, id);
      const li = await s.layoutIssues();
      P(li.length === 0, tag + ': layout ' + JSON.stringify(li));
      const r = await s.eval(() => {
        const pg = document.querySelector('.page.active');
        const prim = pg.querySelector('.' + (window.innerWidth < 768 ? 'ao-acts-mobile' : 'ao-acts-desktop') + ' .aod-primary');
        const stamp = pg.querySelector('.aod-stamp');
        return {
          txt: pg.innerText, prim: prim ? { act: prim.dataset.act, fn: prim.getAttribute('onclick'), vis: prim.getBoundingClientRect().width > 0 } : null,
          chk: (document.getElementById('ao-chk-counter') || {}).innerText || '', rows: pg.querySelectorAll('#ao-checklist .chk-row').length,
          rowsVis: [...pg.querySelectorAll('#ao-checklist .chk-row')].filter((x) => x.getBoundingClientRect().height > 0).length,
          mats: pg.querySelectorAll('#ao-materials .aod-mrow').length, sums: [...pg.querySelectorAll('#ao-materials .aod-row-sum')].map((x) => x.innerText.replace(/\s+/g, ' ')),
          times: pg.querySelectorAll('#ao-timeentries .aod-trow').length, photos: pg.querySelectorAll('#ao-photos .aod-ph img[src^="data:image/png"]').length,
          priceCard: (pg.querySelector('.aod-price') || {}).innerText || null,
          stampVis: !!stamp && getComputedStyle(stamp).display !== 'none' && stamp.getBoundingClientRect().height > 0,
          empties: [...pg.querySelectorAll('.empty.aod-empty h3')].map((x) => x.textContent),
          clipped: [...pg.querySelectorAll('.aod *')].filter((e) => e.offsetParent && !e.closest('.ao-overflow-menu')).filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > document.documentElement.clientWidth + 1; }).length,
        };
      });
      P(!/\b(undefined|NaN|\[object Object\])\b/.test(r.txt), tag + ': visar undefined/NaN');
      P(r.clipped === 0, tag + ': ' + r.clipped + ' element utanför skärmen');
      const want = RICH_PRIMARY[role][st];
      const fn = { own: 'WorkOrderDetailPage.startOwnJob()', start: "WorkOrderDetailPage.setStatus('pågående')", complete: 'WorkOrderDetailPage.markComplete()', invoice: "InvoicesPage.createFromAO('" + id + "')", reactivate: 'WorkOrderDetailPage.openReactivateModal()' }[want];
      P(want ? (r.prim && r.prim.vis && r.prim.fn === fn) : !r.prim, tag + ': primär ' + (want || 'ingen') + ' (fick ' + JSON.stringify(r.prim) + ')');
      if (st === 'saknas') {
        P(/Ingen beskrivning angiven/.test(r.txt) && /Ej planerad/.test(r.txt), tag + ': saknade fält visas som "Ingen beskrivning angiven" / "Ej planerad"');
        P(['Ingen checklista', 'Inget material', 'Inga bilder ännu'].every((h) => r.empties.includes(h)), tag + ': tomlägen med rubrik ' + JSON.stringify(r.empties));
        if (price) P(r.priceCard && /Ej satt/.test(r.priceCard) && /Fakturaunderlag kan inte skapas/.test(r.priceCard), tag + ': prissättning "Ej satt" med varning');
      } else {
        P(r.rows === 22 && r.rowsVis === 22, tag + ': 22 checkpunkter synliga (' + r.rowsVis + '/' + r.rows + ')');
        P(new RegExp('\\b' + RICH_HANDLED[st] + ' av 22 klara').test(r.chk), tag + ': framsteg ' + RICH_HANDLED[st] + ' av 22 (' + r.chk.replace(/\s+/g, ' ') + ')');
        P(r.mats === 6, tag + ': 6 materialrader (' + r.mats + ')');
        P(price ? (r.sums.length === 6 && r.sums.every((x) => /kr inkl\. moms/.test(x))) : r.sums.length === 0, tag + ': materialpriser ' + (price ? 'med inkl. moms' : 'dolda') + ' ' + JSON.stringify(r.sums.slice(0, 2)));
        P(r.photos === 4, tag + ': 4 bilder i Bilder (' + r.photos + ')');
        const expT = ['nytt', 'planerad'].includes(st) ? 0 : RICH_TIME_ROWS[role];
        P(r.times === expT, tag + ': ' + expT + ' tidposter (' + r.times + ')');
        if (price) P(r.priceCard && /Löpande timpris/.test(r.priceCard) && /430 kr\/tim/.test(r.priceCard) && /exkl\. moms/.test(r.priceCard), tag + ': prissättning med timpris exkl. moms');
        if (price && expT >= 5) P(/Akut \/ kväll \/ helg – 695 kr\/tim/.test(r.priceCard) && /annat timpris/.test(r.priceCard), tag + ': tidposternas sparade timpris och skillnadsnotis');
      }
      if (!price) P(r.priceCard === null && !/Prissättning|Inköp|Påslag|Tid mot plan|Intern lönsamhet/.test(r.txt), tag + ': ingen prissättning/ekonomi för rollen');
      const closed = ['klar', 'fakturerad', 'avbruten'].includes(st);
      if (vp === 'laptop') P(r.stampVis === (timeP && !closed), tag + ': Din arbetstid ' + (timeP && !closed ? 'visas' : 'visas inte') + ' (' + r.stampVis + ')');
      else P(!r.stampVis, tag + ': mobil — Din arbetstid bara när man är instämplad');
    }
    await s.context.close();
  }
  t.note(vp + ': 4 roller × 8 ordrar granskade');
  t.assert(problems.length === 0, problems.length + ' fel: ' + problems.slice(0, 12).join(' ;; '));
}

/* Den TIDIGARE åtgärdsraden (WorkOrderDetailPage före 2026-11-26:
   _primaryActionBtns + _secondaryActions), avskriven villkor för villkor.
   Varje [etikett, anrop] här måste fortfarande nås i den nya raden/menyn. */
function oldActions(ao, p) {
  const out = [];
  const id = ao.id;
  if (p.ao_edit && ['nytt', 'pool', 'planerad'].includes(ao.status)) out.push(['Starta arbete', "WorkOrderDetailPage.setStatus('pågående')"]);
  if (ao.status === 'pågående' && p.ao_complete) out.push(['Klarmarkera', 'WorkOrderDetailPage.markComplete()']);
  if (ao.status === 'pågående' && p.ao_edit && ao.substatus) out.push(['SUBSTATUS', 'WorkOrderDetailPage.setSubstatus(this.value);this.blur();']);
  if (ao.status === 'klar' && !ao.invoiceId && p.invoice_create) out.push(['Skapa fakturaunderlag', `InvoicesPage.createFromAO('${id}')`]);
  if (p.ao_edit && ao.status === 'avbruten' && !ao.archived && !ao.deleted) out.push(['Återaktivera', 'WorkOrderDetailPage.openReactivateModal()']);
  if (ao.deleted) out.push(['Återställ', `WorkOrderDetailPage._restoreFromTrash('${id}')`]);
  if (p.ao_edit && !['klar', 'fakturerad', 'avbruten'].includes(ao.status) && !ao.archived && !ao.deleted) out.push(['Byt status', 'WorkOrderDetailPage.openStatusModal()']);
  out.push(['Kontakt', 'WorkOrderDetailPage.openContact()']);
  if (p.activities) out.push(['Ny uppgift', `ActivitiesPage.openCreate({customerId:'${ao.customerId || ''}',propertyId:'${ao.propertyId || ''}',relatedType:'workOrder',relatedId:'${id}'})`]);
  if (p.ao_edit && ['nytt', 'pool'].includes(ao.status)) out.push(['Planera', "WorkOrderDetailPage.setStatus('planerad')"]);
  if (p.ao_edit && ao.status === 'nytt') out.push(['Till pool', "WorkOrderDetailPage.setStatus('pool')"]);
  if (p.ao_edit && ao.status === 'planerad') out.push(['Omplanera', 'WorkOrderDetailPage.openReschedule()']);
  if (p.ao_edit && ao.status === 'pågående') out.push(['Pausa', "WorkOrderDetailPage.setStatus('planerad')"]);
  if (ao.status === 'klar' && ao.invoiceId) out.push(['Visa fakturaunderlag', `Router.showPage('pg-inv-detail',{invoiceId:'${ao.invoiceId}'})`]);
  if (p.ao_edit) { out.push(['Redigera', 'WorkOrderDetailPage.openEdit()']); out.push(['Personal', `WorkOrderDetailPage.manageStaff('${id}')`]); }
  if (p.ao_edit || p.invoice_create) out.push(['Ändra prissättning', 'WorkOrderDetailPage.openPricingModal()']);
  if (p.ao_edit && !ao.archived && !ao.deleted) { out.push(['Arkivera', 'WorkOrderDetailPage.openArchiveModal()']); out.push(['Ta bort', 'WorkOrderDetailPage.openDeleteModal()']); }
  if (ao.archived && !ao.deleted) out.push(['Återställ från arkiv', `WorkOrderDetailPage._restoreFromArchive('${id}')`]);
  if (ao.deleted) out.push(['Radera permanent', `WorkOrderDetailPage._confirmPermanentDelete('${id}')`]);
  return out;
}

/* Den nya åtgärdsraden: alla [data-act] i dator- resp. mobilvarianten. */
const collectActs = (s) => s.eval(() => {
  const norm = (f) => String(f || '').replace(/^aoCloseOverflow\(\);/, '').trim();
  const pick = (root) => !root ? [] : [...root.querySelectorAll('[data-act]')].map((e) => ({
    act: e.dataset.act, label: e.tagName === 'SELECT' ? 'SUBSTATUS' : e.textContent.replace(/\s+/g, ' ').trim(),
    fn: norm(e.getAttribute(e.tagName === 'SELECT' ? 'onchange' : 'onclick')), menu: !!e.closest('.ao-overflow-menu'), primary: e.classList.contains('aod-primary'),
  }));
  return { d: pick(document.querySelector('.page.active .ao-acts-desktop')), m: pick(document.querySelector('.page.active .ao-acts-mobile')) };
});
const perms = (s) => s.eval(() => ({ ao_edit: Auth.can('ao_edit'), ao_complete: Auth.can('ao_complete'), ao_complete_own: WorkOrderService.aoCan('ao_complete_own'), ao_start_own: WorkOrderService.aoCan('ao_start_own'), invoice_create: Auth.can('invoice_create'), activities: Auth.canViewPage('pg-activities'), myjobs: Auth.canViewPage('pg-myjobs') }));
const primaryOf = (s) => s.eval(() => {
  const d = document.querySelectorAll('.page.active .ao-acts-desktop .aod-primary');
  const m = document.querySelectorAll('.page.active .ao-acts-mobile .aod-primary');
  const one = (e) => e ? { act: e.dataset.act, label: e.textContent.trim(), fn: e.getAttribute('onclick') } : null;
  return { nD: d.length, nM: m.length, d: one(d[0]), m: one(m[0]) };
});

/* Öppna menyn i den synliga varianten och kontrollera att varje post syns inom fönstret. */
async function menuReachable(s) {
  const btn = s.page.locator('.page.active .aod-actbar .aod-more-btn:visible').first();
  if (!(await btn.count())) return { items: [], outside: [] };
  await btn.click();
  await s.settle(200);
  const r = await s.eval(() => {
    const menu = document.querySelector('.page.active .aod-menu.open');
    if (!menu) return { open: false };
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const mr = menu.getBoundingClientRect();
    const items = [...menu.querySelectorAll('[role=menuitem]')];
    const outside = [];
    items.forEach((it) => {
      it.scrollIntoView({ block: 'nearest' });
      const r = it.getBoundingClientRect();
      if (r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1 || r.height < 30) outside.push(it.textContent.trim() + ' ' + JSON.stringify([Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]));
    });
    return { open: true, items: items.map((i) => i.textContent.trim()), outside, menu: [Math.round(mr.left), Math.round(mr.top), Math.round(mr.right), Math.round(mr.bottom)], vw, vh };
  });
  await s.eval(() => aoCloseOverflow());
  return r;
}

module.exports = [
  {
    id: 'AOD-01', module: 'Arbetsordrar', name: 'AO-detalj: EN primär åtgärd per status och roll (planerad → Starta arbete, pågående → Klarmarkera, klar → Skapa fakturaunderlag) med befintlig funktion och behörighet; Starta arbete skapar ingen tidpost',
    async run(t) {
      seed(t);
      const expect = {
        admin:   { 'AO-T1': ['start', "WorkOrderDetailPage.setStatus('pågående')"], 'AO-T2': ['complete', 'WorkOrderDetailPage.markComplete()'], 'AO-T3': ['invoice', "InvoicesPage.createFromAO('AO-T3')"] },
        chef:    { 'AO-T1': ['start', "WorkOrderDetailPage.setStatus('pågående')"], 'AO-T2': ['complete', 'WorkOrderDetailPage.markComplete()'], 'AO-T3': ['invoice', "InvoicesPage.createFromAO('AO-T3')"] },
        ekonomi: { 'AO-T1': null, 'AO-T2': null, 'AO-T3': ['invoice', "InvoicesPage.createFromAO('AO-T3')"] },
        /* Fält saknar ao_edit/ao_complete: på sin egen planerade order får hen samma
           Starta som Mina jobb (MyJobsPage.startJob-vägen, kräver ao_start_own). T3-B (D-03):
           med ao_complete_own får hen Klarmarkera på sin egen pågående order. Inget annat. */
        falt2:   { 'AO-T1': ['start', 'WorkOrderDetailPage.startOwnJob()'], 'AO-T2': ['complete', 'WorkOrderDetailPage.markComplete()'], 'AO-T3': null },
      };
      // Stämplingsraden: bara med ao_time och bara på ej avslutade ordrar.
      /* T3-E: standardrollen chef har ao_time (BEHORIGHETSMATRIS §2) och får därför stämplingsraden
         på ej avslutade ordrar; ekonomi saknar ao_time och får den inte. */
      const stamp = { admin: [true, true, false], chef: [true, true, false], ekonomi: [false, false, false], falt2: [true, true, false] };
      for (const role of Object.keys(expect)) {
        const s = await t.world.session({ viewport: 'laptop' });
        await s.login(role);
        const ids = ['AO-T1', 'AO-T2', 'AO-T3'];
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          await openAO(s, id);
          const p = await primaryOf(s);
          const exp = expect[role][id];
          t.assert(p.nD <= 1 && p.nM <= 1, role + ' ' + id + ': högst en primär åtgärd per variant (' + p.nD + '/' + p.nM + ')');
          if (!exp) t.assert(!p.d && !p.m, role + ' ' + id + ': ingen primär åtgärd utan behörighet (' + JSON.stringify(p.d) + ')');
          else {
            t.assert(p.d && p.d.act === exp[0] && p.d.fn === exp[1], role + ' ' + id + ': primär = ' + exp[0] + ' → ' + exp[1] + ' (' + JSON.stringify(p.d) + ')');
            t.assert(p.m && p.m.fn === p.d.fn, role + ' ' + id + ': samma primära åtgärd på mobil');
          }
          const st = await s.eval(() => { const e = document.querySelector('.page.active .aod-stamp'); return e ? { visible: !!e.offsetParent, btn: !!e.querySelector('.ao-stamp-btn'), txt: e.textContent } : null; });
          t.assert(!!(st && st.visible) === stamp[role][i], role + ' ' + id + ': stämplingsraden ' + (stamp[role][i] ? 'visas' : 'visas inte') + ' (' + JSON.stringify(st && st.visible) + ')');
          if (st && st.visible) t.assert(/Din arbetstid/.test(st.txt) && /Stämpla in/.test(st.txt) && !/Starta arbete/.test(st.txt), role + ' ' + id + ': stämplingsraden heter Din arbetstid / Stämpla in, inte Starta arbete');
        }
        await s.context.close();
      }
      // Funktion: arbetsledaren trycker på primärknappen → status på servern, ingen tidpost, ingen stämpling.
      const before = t.fake.get('timeEntries').filter((e) => e.aoId === 'AO-T1').length;
      const c = await t.world.session({ viewport: 'laptop' });
      await c.login('chef');
      await openAO(c, 'AO-T1');
      await c.page.locator('.page.active .ao-acts-desktop .aod-primary').click();
      await c.waitToast(/Status: Pågående/, 8000);
      t.assert(t.fake.get('workOrders').find((a) => a.id === 'AO-T1').status === 'pågående', 'Starta arbete: servern visar pågående');
      t.assert(t.fake.get('timeEntries').filter((e) => e.aoId === 'AO-T1').length === before, 'Starta arbete skapar ingen tidpost');
      t.assert(await c.eval(() => !state.stampActive), 'Starta arbete stämplar inte in');
      const p2 = await primaryOf(c);
      t.assert(p2.d && p2.d.act === 'complete', 'efter start: primär åtgärd blir Klarmarkera (' + JSON.stringify(p2.d) + ')');
    },
  },
  {
    id: 'AOD-02', module: 'Arbetsordrar', name: 'AO-detalj: ingen förlorad åtgärd — varje åtgärd i den tidigare raden (samma etikett och anrop) nås i nya raden eller menyn, på dator och mobil, i alla lägen (nytt, pool, planerad, pågående+substatus, klar, klar+faktura, avbruten, arkiverad, papperskorg) och roller',
    async run(t) {
      seed(t, [
        { id: 'AO-T4', status: 'pågående', substatus: 'inväntar_material', title: 'Test substatus' },
        { id: 'AO-T5', status: 'klar', invoiceId: 'INV-003', title: 'Test fakturerad klar' },
        { id: 'AO-T6', status: 'avbruten', title: 'Test avbruten' },
        { id: 'AO-T7', status: 'planerad', archived: true, title: 'Test arkiverad' },
        { id: 'AO-T8', status: 'planerad', deleted: true, deleteAfter: new Date(Date.now() + 7 * 864e5).toISOString(), title: 'Test papperskorg' },
        { id: 'AO-T9', status: 'nytt', title: 'Test nytt' },
        { id: 'AO-TA', status: 'pool', staff: [], title: 'Test pool' },
      ]);
      const plan = [
        ['admin', 'laptop', ['AO-T1', 'AO-T2', 'AO-T3', 'AO-T4', 'AO-T5', 'AO-T6', 'AO-T7', 'AO-T8', 'AO-T9', 'AO-TA']],
        ['admin', 'iphone', ['AO-T1', 'AO-T4', 'AO-T8']],
        ['chef', 'laptop', ['AO-T2', 'AO-T3']],
        ['ekonomi', 'laptop', ['AO-T3', 'AO-T5']],
        ['falt2', 'iphone', ['AO-T1', 'AO-T2']],
        ['begransad', 'laptop', ['AO-008']],
      ];
      let checked = 0;
      for (const [role, vp, ids] of plan) {
        const s = await t.world.session({ viewport: vp });
        await s.login(role);
        const p = await perms(s);
        for (const id of ids) {
          const ao = await s.eval((x) => { const a = getAO(x); return a ? JSON.parse(JSON.stringify(a)) : null; }, id);
          t.assert(ao, role + ': ' + id + ' finns i klienten');
          await openAO(s, id);
          const old = oldActions(ao, p);
          const now = await collectActs(s);
          for (const [label, fn] of old) {
            const inD = now.d.some((x) => x.label === label && x.fn === fn);
            const inM = now.m.some((x) => x.label === label && x.fn === fn);
            t.assert(inD && inM, role + ' ' + id + ': "' + label + '" (' + fn + ') finns kvar — dator ' + inD + ', mobil ' + inM);
            checked++;
          }
          // Inga nya statusövergångar: varje setStatus-anrop i nya raden fanns i den gamla.
          const oldFns = new Set(old.map((x) => x[1]));
          const extra = now.d.concat(now.m).filter((x) => /setStatus|markComplete|_restoreFrom|createFromAO|openReactivateModal|startOwnJob/.test(x.fn) && !oldFns.has(x.fn));
          /* Tillägg: Starta för den som är tilldelad utan ao_edit — samma villkor som Mina jobb visar Starta
             (T3-B: kräver ao_start_own) — och, enligt D-03 (T3-B), Klarmarkera för den som har
             ao_complete_own och är tilldelad en pågående AO. Inga andra nya status-/faktureringsanrop. */
          const mine = (ao.staff || []).includes(STAFF[role]);
          const okOwn = (x) => (x.fn === 'WorkOrderDetailPage.startOwnJob()' && !p.ao_edit && p.ao_start_own && p.myjobs && mine && !ao.archived && !ao.deleted && ['nytt', 'pool', 'planerad'].includes(ao.status))
            || (x.fn === 'WorkOrderDetailPage.markComplete()' && !p.ao_complete && p.ao_complete_own && mine && ao.status === 'pågående');
          t.assert(extra.every(okOwn), role + ' ' + id + ': inga nya status-/faktureringsanrop utöver Mina jobb-starten ' + JSON.stringify(extra.filter((x) => !okOwn(x))));
          // Nåbart på skärmen: synliga knappar inom fönstret, menyposterna inom fönstret.
          const vis = await s.eval(() => {
            const vw = document.documentElement.clientWidth;
            return [...document.querySelectorAll('.page.active .aod-actbar [data-act]')].filter((e) => e.offsetParent && !e.closest('.ao-overflow-menu')).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 24), ok: r.left >= -1 && r.right <= vw + 1 && r.width > 0, h: Math.round(r.height) }; });
          });
          t.assert(vis.every((v) => v.ok), role + ' ' + id + ' ' + vp + ': synliga knappar inom skärmen ' + JSON.stringify(vis));
          if (vp === 'iphone') t.assert(vis.every((v) => v.h >= 40), role + ' ' + id + ': tryckyta ≥ 40 px på mobil ' + JSON.stringify(vis));
          const m = await menuReachable(s);
          if (m.open !== undefined || (m.items && m.items.length)) t.assert(m.open && m.outside.length === 0, role + ' ' + id + ' ' + vp + ': menyn öppnas och alla poster ligger inom fönstret ' + JSON.stringify(m));
        }
        await s.context.close();
      }
      t.note(checked + ' tidigare åtgärder kontrollerade');
      // En menypost utför sitt anrop: Redigera och Ändra prissättning öppnar sina dialoger.
      const a = await t.world.session({ viewport: 'laptop' });
      await a.login('admin');
      await openAO(a, 'AO-T1');
      for (const [act, title] of [['edit', /Redigera order/], ['pricing', /Ändra prissättning/], ['staff', /Hantera personal/]]) {
        const inMenu = await a.eval((k) => !!document.querySelector('.page.active .ao-acts-desktop .aod-menu [data-act="' + k + '"]'), act);
        if (inMenu) await a.page.locator('.page.active .ao-acts-desktop .aod-more-btn').click();
        await a.page.locator('.page.active .ao-acts-desktop [data-act="' + act + '"]').click();
        await a.page.waitForSelector('.modal-overlay.open .modal-title', { timeout: 4000 });
        const tt = await a.text('.modal-overlay.open .modal-title');
        t.assert(title.test(tt), 'menyposten ' + act + ' öppnar "' + tt + '"');
        await a.eval(() => Modal.close()); await a.settle(250);
      }
    },
  },
  {
    id: 'AOD-03', kind: 'workflow', module: 'Arbetsorderchecklistor', name: 'AO-detalj: checklistan ligger i Uppdrag & utförande (aldrig hopfälld) med "N av M klara", stapel, kvar och avvikelser; tre lägen och återställningsregler fungerar som förut',
    async run(t) {
      const now = new Date().toISOString();
      seed(t, [{ id: 'AO-TC', status: 'pågående', title: 'Checklista i uppdraget', staff: ['ST-004', 'ST-002'], checklist: [
        { id: 'q1', text: 'Stäng av vattnet', done: true, avvikelse: 'ok', doneAt: now, doneBy: 'Jonas Pettersson', doneById: 'ST-004' },
        { id: 'q2', text: 'Byt packning', done: true, avvikelse: 'ok', doneAt: now, doneBy: 'Erik Andersson', doneById: 'ST-002' },
        { id: 'q3', text: 'Kontrollera golvbrunn', done: false, avvikelse: 'avvikelse', avvikelseComment: 'Sprucken klämring', avvikelseBy: 'Jonas Pettersson', avvikelseById: 'ST-004', avvikelseAt: now },
        { id: 'q4', text: 'Provtryck', done: false, avvikelse: null, startedAt: now, startedBy: 'Jonas Pettersson', startedById: 'ST-004' },
        { id: 'q5', text: 'Städa arbetsplatsen', done: false, avvikelse: null },
      ] }]);
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('falt2');
      await openAO(s, 'AO-TC');
      const row = (id) => '#ao-checklist .chk-row[data-id="' + id + '"]';
      const read = () => s.eval(() => {
        const c = document.getElementById('ao-chk-counter');
        const bar = c && c.querySelector('[role=progressbar]');
        return {
          inMission: !!document.querySelector('.page.active .aod-mission #ao-checklist') && !!document.querySelector('.page.active .aod-mission #ao-chk-counter'),
          collapsible: !!document.getElementById('ao-checklist').closest('details'),
          rowsVisible: [...document.querySelectorAll('#ao-checklist .chk-row')].every((r) => r.offsetParent && r.getBoundingClientRect().height > 0),
          text: c ? c.innerText.replace(/\s+/g, ' ') : '', now: bar && bar.getAttribute('aria-valuenow'), max: bar && bar.getAttribute('aria-valuemax'),
          avv: (document.getElementById('ao-chk-avv') || {}).innerText || '', q: (document.getElementById('ao-qbar-chk') || {}).textContent || '',
          states: [...document.querySelectorAll('#ao-checklist .chk-row')].map((r) => r.dataset.status).join(','),
        };
      });
      let r = await read();
      t.assert(r.inMission && !r.collapsible && r.rowsVisible, 'checklistan och framsteget ligger i Uppdrag & utförande, inte i en hopfällbar sektion ' + JSON.stringify(r));
      t.assert(r.states === 'utford,utford,avvikelse,pagaende,ej_paborjad', 'tre lägen + avvikelse renderas: ' + r.states);
      t.assert(/3 av 5 klara/.test(r.text) && /2 kvar/.test(r.text) && r.now === '3' && r.max === '5', 'framsteg 3 av 5 klara, 2 kvar: ' + r.text + ' (' + r.now + '/' + r.max + ')');
      t.assert(/2 utförda/.test(r.text) && /1 pågår/.test(r.text) && /1 avvikelse/.test(r.text) && /1 ej påbörjad/.test(r.text), 'teckenförklaring per läge: ' + r.text);
      t.assert(/1 avvikelse rapporterad/.test(r.avv) && /Kontrollera golvbrunn/.test(r.avv) && /Sprucken klämring/.test(r.avv), 'avvikelser samlade under listan: ' + r.avv);
      t.assert(/Checklista 3\/5/.test(r.q), 'snabbåtgärdsraden visar 3/5: ' + r.q);
      // Återställningsregler (oförändrade): egen punkt → Återställ; annans (q2, Erik) → ingen Återställ för ao_checklist.
      const btns = (id) => s.eval((sel) => [...document.querySelectorAll(sel + ' .chk-btn')].map((b) => b.title), row(id));
      t.assert((await btns('q1')).includes('Återställ till ej påbörjad'), 'egen utförd punkt: Återställ visas');
      t.assert(!(await btns('q2')).includes('Återställ till ej påbörjad'), 'annans utförd punkt: ingen Återställ (ao_edit krävs)');
      const deny = await s.eval(() => WorkOrderService.checklistAction('AO-TC', 'q2', 'reset'));
      t.assert(!deny.ok && deny.code === 'forbidden_other', 'servern nekar återställning av annans punkt (' + JSON.stringify(deny) + ')');
      // Ej påbörjad → Pågående → Utförd, och framsteget följer med utan omladdning.
      await s.page.click(row('q5') + ' .chk-btn-start');
      await s.waitToast(/Påbörjad/, 6000);
      r = await read();
      t.assert(/3 av 5 klara/.test(r.text) && /2 pågår/.test(r.text), 'efter Påbörja: fortfarande 3 klara, 2 pågår: ' + r.text);
      await s.page.click(row('q5') + ' .chk-btn[title="Markera utförd"]');
      await s.waitToast(/Utförd/, 6000);
      r = await read();
      t.assert(/4 av 5 klara/.test(r.text) && /1 kvar/.test(r.text) && r.now === '4', 'efter Utförd: 4 av 5 klara, 1 kvar: ' + r.text);
      t.assert(/Checklista 4\/5/.test(r.q), 'snabbåtgärdsraden uppdateras utan omladdning: ' + r.q);
      const srv = t.fake.get('workOrders').find((a) => a.id === 'AO-TC');
      const q5 = srv.checklist.find((c) => c.id === 'q5');
      t.assert(q5.done === true && q5.doneById === 'ST-004' && q5.startedById === 'ST-004', 'servern: q5 utförd av falt2 med påbörjad-uppgift');
      t.assert(srv.status === 'pågående', 'checklistan ändrar inte AO:ns status');
      // Egen återställning → tillbaka till ej påbörjad, framsteget räknas ner.
      await s.page.click(row('q5') + ' .chk-btn[title="Återställ till ej påbörjad"]');
      await s.waitToast(/Återställd/, 6000);
      r = await read();
      t.assert(/3 av 5 klara/.test(r.text) && /1 ej påbörjad/.test(r.text), 'efter egen återställning: 3 av 5 klara: ' + r.text);
      // Snabbåtgärden Checklista leder till checklistan.
      await s.eval(() => { document.getElementById('content-scroll').scrollTop = document.getElementById('content-scroll').scrollHeight; });
      await s.page.locator('.page.active .aod-qbar .aod-q-chk').click();
      await s.settle(700);
      const inView = await s.eval(() => { const r = document.getElementById('ao-chk-sec').getBoundingClientRect(); return r.top >= -2 && r.top < window.innerHeight * 0.6; });
      t.assert(inView, 'snabbåtgärden Checklista rullar till checklistan');
    },
  },
  {
    id: 'AOD-04', kind: 'workflow', module: 'Tidregistrering och instämpling', name: 'AO-detalj: Starta arbete (status) och Stämpla in (tid) är skilda; stämpling via den kompakta raden ger levande tidräknare och exakt EN tidpost; ingen dubbelstämpling på annan AO',
    async run(t) {
      seed(t);
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      await openAO(s, 'AO-T1');
      const entries = () => t.fake.get('timeEntries').filter((e) => e.aoId === 'AO-T1');
      const n0 = entries().length;
      // 1. Starta arbete: status, ingen tid, ingen stämpling.
      await s.page.locator('.page.active .ao-acts-desktop [data-act="start"]').click();
      await s.waitToast(/Status: Pågående/, 8000);
      t.assert(t.fake.get('workOrders').find((a) => a.id === 'AO-T1').status === 'pågående', 'status pågående på servern');
      t.assert(entries().length === n0 && !(t.fake.stamp.get(EMAIL.admin) || {}).active && !(await s.eval(() => state.stampActive)), 'Starta arbete: ingen tidpost och ingen stämpling');
      const row0 = await s.eval(() => document.querySelector('.page.active .aod-stamp').innerText);
      t.assert(/Inte instämplad/.test(row0) && /AO-T1/.test(row0), 'stämplingsraden: inte instämplad, knuten till AO-T1 (' + row0.replace(/\n/g, ' ') + ')');
      // 2. Stämpla in via den kompakta raden: stämpling, ingen statusändring, ingen tidpost än.
      await s.page.locator('.page.active .aod-stamp .ao-stamp-btn').click();
      await s.page.waitForFunction(() => state.stampActive && state.stampAoId === 'AO-T1', null, { timeout: 5000 });
      await s.settle(600);
      t.assert((t.fake.stamp.get(EMAIL.admin) || {}).active === true, 'servern: stämpling aktiv');
      t.assert(t.fake.get('workOrders').find((a) => a.id === 'AO-T1').status === 'pågående' && entries().length === n0, 'Stämpla in ändrar inte status och skapar ingen tidpost');
      const c1 = await s.text('#ao-stamp-clock');
      await s.settle(1300);
      const c2 = await s.text('#ao-stamp-clock');
      t.assert(/^\d+:\d\d:\d\d$/.test(c1) && c1 !== c2, 'levande tidräknare: ' + c1 + ' → ' + c2);
      t.assert(await s.eval(() => document.querySelector('.page.active .aod-stamp').classList.contains('is-active')), 'raden visar aktiv stämpling');
      // 3. Dubbelstämpling: på en annan AO visas var man är instämplad, ingen Stämpla in-knapp.
      await openAO(s, 'AO-T2');
      const other = await s.eval(() => { const e = document.querySelector('.page.active .aod-stamp'); return { cls: e.className, txt: e.innerText, btn: !!e.querySelector('.ao-stamp-btn') }; });
      t.assert(/is-other/.test(other.cls) && /AO-T1/.test(other.txt) && !other.btn, 'annan AO: "instämplad på AO-T1", ingen stämpelknapp ' + JSON.stringify(other));
      await s.eval(() => WorkOrderDetailPage.toggleStamp());
      await s.waitToast(/annat jobb/, 4000);
      t.assert(await s.eval(() => state.stampAoId === 'AO-T1'), 'försök att stämpla in på annan AO ändrar inget');
      // 4. Stämpla ut (30 min) → exakt EN tidpost.
      const ts = Date.now() - 30 * 60000;
      t.fake.stamp.get(EMAIL.admin).ts = ts;
      await s.eval((x) => { state.stampTimestamp = x; }, ts);
      await openAO(s, 'AO-T1');
      await s.page.locator('.page.active .aod-stamp .ao-stamp-btn', { hasText: 'Stämpla ut' }).click();
      await s.page.waitForSelector('.modal-overlay.open #co-comment');
      await s.page.fill('#co-comment', 'E2E kompakt stämpling');
      await s.clickModalButton(/^Stämpla ut$/);
      await s.waitToast(/Utloggad — tid sparad/, 8000);
      await s.settle(800);
      const made = entries();
      t.assert(made.length === n0 + 1, 'exakt en ny tidpost (' + (made.length - n0) + ')');
      const e = made.find((x) => x.comment === 'E2E kompakt stämpling');
      t.assert(e && e.staffId === STAFF.admin && e.minutes >= 29 && e.minutes <= 31, 'tidposten: admin, ~30 min ' + JSON.stringify(e && { s: e.staffId, m: e.minutes }));
      t.assert(t.fake.get('workOrders').find((a) => a.id === 'AO-T1').status === 'pågående', 'Stämpla ut klarmarkerar inte ordern');
      t.assert(await s.eval(() => !state.stampActive && /Inte instämplad/.test(document.querySelector('.page.active .aod-stamp').innerText)), 'raden visar utstämplad');
      // 5. Mobil: aktiv stämpling syns som rad med tidräknare även på mobil (knappen finns i snabbåtgärdsraden).
      const m = await t.world.session({ viewport: 'iphone' });
      await m.login('falt2');
      await openAO(m, 'AO-T2');
      const hiddenWhenIdle = await m.eval(() => { const e = document.querySelector('.page.active .aod-stamp'); return !e || getComputedStyle(e).display === 'none'; });
      t.assert(hiddenWhenIdle, 'mobil: ingen stämplingsrad när man inte är instämplad (Stämpla in finns i snabbåtgärdsraden)');
      await m.page.locator('.page.active .aod-qbar button', { hasText: 'Stämpla in' }).click();
      await m.page.waitForFunction(() => state.stampActive && state.stampAoId === 'AO-T2', null, { timeout: 5000 });
      await m.settle(400);
      const mob = await m.eval(() => { const e = document.querySelector('.page.active .aod-stamp.is-active'); return e ? { vis: getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0, clock: !!e.querySelector('#ao-stamp-clock'), q: document.querySelector('.page.active .aod-qbar button').textContent.trim() } : null; });
      t.assert(mob && mob.vis && mob.clock && /Stämpla ut/.test(mob.q), 'mobil: instämplad → rad med tidräknare och Stämpla ut i snabbåtgärdsraden ' + JSON.stringify(mob));
    },
  },
  {
    id: 'AOD-05', module: 'Användarroller och behörigheter', name: 'AO-detalj: prissättningskortet syns för admin/arbetsledare/ekonomi med rätt modell (fastpris / löpande timpris + prisgrupp och timpris) och placering; fält och begränsad ser inget pris, inköp eller påslag',
    async run(t) {
      seed(t);
      const aos = t.fake.get('workOrders');
      const a15 = aos.find((a) => a.id === 'AO-015');
      a15.materials = [{ id: 'm-e2e', name: 'E2E Kulventil', qty: 2, unit: 'st', buyPrice: 95, sellPrice: 195, vatRate: 25, addedAt: new Date().toISOString() }];
      t.fake.set('workOrders', aos);
      const card = (s) => s.eval(() => {
        const c = document.querySelector('.page.active .aod-price');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { type: c.dataset.priceType, txt: c.innerText.replace(/\s+/g, ' '), top: Math.round(r.top), vh: window.innerHeight, edit: !!c.querySelector('[data-act="pricing-card"]'), vis: !!c.offsetParent };
      });
      const cases = [
        ['admin', 'AO-007', 'fastpris', [/Fastpris/, /Avtalat pris/, /3 800 kr/, /Satt på arbetsordern/]],
        ['chef', 'AO-001', 'timpris', [/Löpande timpris/, /Prisgrupp Fastighetsservice avtal/, /392 kr\/tim/, /prisregistret/]],
        ['ekonomi', 'AO-015', 'timpris', [/Löpande timpris/, /Fastighetsservice standard/, /430 kr\/tim/, /Inköp/, /Påslag/]],
      ];
      for (const [role, id, type, res] of cases) {
        const s = await t.world.session({ viewport: 'laptop' });
        await s.login(role);
        await openAO(s, id);
        const c = await card(s);
        t.assert(c && c.vis && c.type === type, role + ' ' + id + ': prissättningskortet visas med modell ' + type + ' (' + JSON.stringify(c && c.type) + ')');
        res.forEach((re) => t.assert(re.test(c.txt), role + ' ' + id + ': ' + re + ' i "' + c.txt.slice(0, 200) + '"'));
        t.assert(c.top < c.vh, role + ' ' + id + ': kortet syns i första skärmbilden på 1366×768 (överkant ' + c.top + ')');
        t.assert(c.edit, role + ' ' + id + ': Ändra finns (ao_edit eller invoice_create, som förut)');
        const det = await s.eval(() => (document.querySelector('.page.active .aod-details') || {}).innerText || '');
        t.assert(!/kr\/tim|Fastpris/.test(det), role + ': Detaljer innehåller bara metadata, inte pris (' + det.replace(/\s+/g, ' ').slice(0, 120) + ')');
        await s.context.close();
      }
      // Ekonomi på mobil: kortet finns (efter arbetstiden).
      const em = await t.world.session({ viewport: 'iphone' });
      await em.login('ekonomi');
      await openAO(em, 'AO-015');
      const cm = await card(em);
      t.assert(cm && cm.vis && /430 kr\/tim/.test(cm.txt), 'ekonomi mobil: prissättningskortet visas');
      // Fält och begränsad: inget prissättningskort, inga priser i material, ingen intern ekonomi.
      for (const [role, id] of [['falt2', 'AO-015'], ['begransad', 'AO-008']]) {
        for (const vp of ['laptop', 'iphone']) {
          const s = await t.world.session({ viewport: vp });
          await s.login(role);
          await openAO(s, id);
          const r = await s.eval(() => {
            const pg = document.querySelector('.page.active');
            return { card: !!pg.querySelector('.aod-price'), txt: pg.innerText, sums: pg.querySelectorAll('.aod-row-sum').length, lon: !!pg.querySelector('#ao-lonsam details'), plan: !!pg.querySelector('.aod-planbox'),
              menu: [...pg.querySelectorAll('.aod-actbar [data-act]')].map((e) => e.dataset.act) };
          });
          t.assert(!r.card, role + ' ' + vp + ': inget prissättningskort');
          t.assert(!/Prissättning|Fastpris|Löpande timpris|Inköp|Påslag|Avtalat pris|Intern lönsamhet|Tid mot plan/.test(r.txt), role + ' ' + vp + ': ingen pris- eller ekonomitext');
          t.assert(r.sums === 0 && !r.lon && !r.plan, role + ' ' + vp + ': inga materialpriser, ingen lönsamhet, ingen tid mot plan');
          t.assert(!r.menu.includes('pricing'), role + ' ' + vp + ': Ändra prissättning finns inte i menyn (saknar ao_edit/invoice_create)');
          if (role === 'falt2') t.assert(/E2E Kulventil/.test(r.txt) && /2 st/.test(r.txt) && !/195 kr|95 kr/.test(r.txt), role + ': materialraden visas utan pris');
          await s.context.close();
        }
      }
    },
  },
  {
    id: 'AOD-06', module: 'Arbetsordrar', name: 'AO-detalj: ingen horisontell överbredd eller knapp utanför skärmen 360–1920 px (admin, arbetsledare med substatus, fält), menyn ryms i fönstret',
    async run(t) {
      seed(t, [{ id: 'AO-T4', status: 'pågående', substatus: 'behöver_återbesök', title: 'Ett ganska långt rubrikexempel för att pröva radbrytning i sidhuvudet på smala skärmar' }]);
      const issues = [];
      for (const vp of ['android', 'iphone', 'w768', 'w1024', 'laptop', 'desktop']) {
        for (const [role, id] of [['admin', 'AO-001'], ['chef', 'AO-T4'], ['falt2', 'AO-015']]) {
          const s = await t.world.session({ viewport: vp });
          await s.login(role);
          await openAO(s, id);
          const li = await s.layoutIssues();
          if (li.length) issues.push(vp + ' ' + role + ' ' + id + ': ' + li.join('; '));
          const wide = await s.eval(() => {
            const vw = document.documentElement.clientWidth;
            return [...document.querySelectorAll('.page.active .aod *')].filter((e) => e.offsetParent && !e.closest('.ao-overflow-menu')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1; }).slice(0, 3).map((e) => e.tagName + '.' + String(e.className).slice(0, 30));
          });
          if (wide.length) issues.push(vp + ' ' + role + ' ' + id + ': element utanför skärmen ' + wide.join(', '));
          const m = await menuReachable(s);
          if (m.open === false || (m.outside && m.outside.length)) issues.push(vp + ' ' + role + ' ' + id + ': menyn ' + JSON.stringify(m));
          await s.context.close();
        }
      }
      t.assert(issues.length === 0, 'layoutfel: ' + issues.join(' ;; '));
    },
  },
  {
    id: 'AOD-07', module: 'Arbetsordrar', name: 'AO-detalj med realistiskt innehåll, mobil 390 px: alla statusar (ny, planerad, pågår, pausad, klar, fakturerad, avbruten) + saknade fält × fält, arbetsledare, ekonomi, admin — rätt primär åtgärd, 22 checkpunkter, material, tid, bilder, pris per roll, inget klipps',
    async run(t) { await richMatrix(t, 'iphone'); },
  },
  {
    id: 'AOD-08', module: 'Arbetsordrar', name: 'AO-detalj med realistiskt innehåll, dator 1366 px: alla statusar + saknade fält × fält, arbetsledare, ekonomi, admin (samma kontroller som AOD-07)',
    async run(t) { await richMatrix(t, 'laptop'); },
  },
  {
    id: 'AOD-09', kind: 'workflow', module: 'Arbetsordrar', name: 'Fältflöde på mobil 390 px utan att något klipps: öppna jobbet från Mina jobb → Starta arbete → Stämpla in → bocka av checklista → lägg till material och bild → Stämpla ut → Klarmarkera (ao_complete_own, D-03; utan den ingen Klarmarkera)',
    async run(t) {
      seedRich(t);
      const AO = 'AO-RF';
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('falt2');
      const noClip = async (step) => { const li = await s.layoutIssues(); t.assert(li.length === 0, step + ': inget klipps / ingen sidledsrullning ' + JSON.stringify(li)); };
      // 1. Öppna jobbet från Mina jobb.
      await s.go('pg-myjobs');
      /* Mina jobb i V3 (fältsidorna): korten heter .mj-title och ligger under
         flikarna Idag/Kommande/Arbetspool — leta i den flik där jobbet finns. */
      const card = s.page.locator('.page.active .mj-title', { hasText: 'Fältflöde' }).first();
      if (!(await card.isVisible().catch(() => false))) {
        for (const tab of ['Kommande', 'Arbetspool', 'Idag']) {
          const b = s.page.locator('.page.active [role=tab], .page.active .ft', { hasText: tab }).first();
          if (await b.isVisible().catch(() => false)) { await b.click(); await s.settle(250); }
          if (await card.isVisible().catch(() => false)) break;
        }
      }
      await card.click();
      await s.page.waitForFunction((x) => Router.currentPage === 'pg-ao-detail' && WorkOrderDetailPage.aoId === x, AO, { timeout: 8000 });
      await s.settle(400);
      await noClip('öppna');
      // 2. Starta arbete (status) — samma väg som Mina jobb; ingen tid, ingen stämpling.
      const n0 = t.fake.get('timeEntries').filter((e) => e.aoId === AO).length;
      const start = s.page.locator('.page.active .ao-acts-mobile .aod-primary');
      t.assert(/Starta arbete/.test(await start.textContent()), 'mobil: primär åtgärd Starta arbete för fältarbetaren på egen planerad order');
      await start.click();
      await s.waitToast(/Status: Pågående/, 8000);
      t.assert(t.fake.get('workOrders').find((a) => a.id === AO).status === 'pågående', 'servern: pågående');
      t.assert(t.fake.get('timeEntries').filter((e) => e.aoId === AO).length === n0 && !(await s.eval(() => state.stampActive)), 'Starta arbete: ingen tidpost och ingen stämpling');
      await noClip('starta');
      // 3. Stämpla in via snabbåtgärdsraden.
      await s.page.locator('.page.active .aod-qbar button', { hasText: 'Stämpla in' }).click();
      await s.page.waitForFunction((x) => state.stampActive && state.stampAoId === x, AO, { timeout: 5000 });
      await s.settle(400);
      t.assert(await s.eval(() => { const e = document.querySelector('.page.active .aod-stamp.is-active'); return !!e && e.getBoundingClientRect().height > 0 && !!e.querySelector('#ao-stamp-clock'); }), 'instämplad: raden Din arbetstid med tidräknare syns');
      await noClip('stämpla in');
      // 4. Bocka av checklistan (Checklista i snabbåtgärdsraden leder dit).
      await s.page.locator('.page.active .aod-qbar .aod-q-chk').click();
      await s.settle(600);
      const firstOpen = await s.eval(() => (document.querySelector('#ao-checklist .chk-row[data-status="ej_paborjad"]') || {}).dataset.id);
      await s.page.click('#ao-checklist .chk-row[data-id="' + firstOpen + '"] .chk-btn[title="Markera utförd"]');
      await s.waitToast(/Utförd/, 6000);
      const it = t.fake.get('workOrders').find((a) => a.id === AO).checklist.find((c) => c.id === firstOpen);
      t.assert(it.done === true && it.doneById === 'ST-004', 'servern: punkten utförd av fältarbetaren');
      t.assert(/1 av 22 klara/.test(await s.text('#ao-chk-counter')) && /1\/22/.test(await s.text('#ao-qbar-chk')), 'framsteg 1 av 22 och snabbåtgärden 1/22');
      await noClip('checklista');
      // 5a. Material via snabbåtgärdsraden.
      await s.page.locator('.page.active .aod-qbar button', { hasText: 'Material' }).click();
      await s.page.waitForSelector('.modal-overlay.open #mat-name');
      await s.page.fill('#mat-name', 'E2E Blandare tvättstuga');
      await s.page.fill('#mat-qty', '1');
      await s.clickModalButton(/Lägg till/);
      await s.waitToast(/Material tillagt/, 8000);
      t.assert((t.fake.get('workOrders').find((a) => a.id === AO).materials || []).some((m) => m.name === 'E2E Blandare tvättstuga'), 'servern: materialraden finns');
      t.assert(await s.eval(() => [...document.querySelectorAll('#ao-materials .aod-mrow')].some((r) => /E2E Blandare/.test(r.textContent))), 'materialraden syns direkt');
      // 5b. Bild via snabbåtgärdsraden.
      const JPEG = { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64') };
      const photos0 = await s.eval(() => document.querySelectorAll('#ao-photos .aod-ph').length);
      await s.page.locator('.page.active .aod-qbar button', { hasText: 'Foto' }).click();
      await s.page.waitForSelector('.modal-overlay.open #log-text');
      await s.page.fill('#log-text', 'E2E ny blandare monterad');
      await s.page.setInputFiles('#log-img', JPEG);
      await s.clickModalButton(/^Spara$/);
      await s.waitToast(/Loggpost sparad/, 10000);
      const lg = (t.fake.get('workOrders').find((a) => a.id === AO).log || []).find((l) => l.text === 'E2E ny blandare monterad');
      t.assert(lg && lg.imagePath, 'servern: loggposten har bild (imagePath)');
      t.assert(await s.eval(() => document.querySelectorAll('#ao-photos .aod-ph').length) === photos0 + 1, 'bilden syns i kortet Bilder');
      await noClip('material och bild');
      // 6. Stämpla ut → exakt en tidpost.
      await s.eval(() => { document.getElementById('content-scroll').scrollTop = 0; });
      await s.page.locator('.page.active .aod-qbar button', { hasText: 'Stämpla ut' }).click();
      await s.page.waitForSelector('.modal-overlay.open #co-comment');
      await s.page.fill('#co-comment', 'E2E fältflöde klart');
      await s.clickModalButton(/^Stämpla ut$/);
      await s.waitToast(/Utloggad — tid sparad/, 8000);
      await s.settle(600);
      t.assert(t.fake.get('timeEntries').filter((e) => e.aoId === AO).length === n0 + 1, 'exakt en ny tidpost efter utstämpling');
      // 7. Slutför (T3-B, D-03): standardrollen personal har ao_complete_own → Klarmarkera på egen pågående AO.
      t.assert(await s.eval(() => !!document.querySelector('.page.active [data-act="complete"]')), 'med ao_complete_own: Klarmarkera finns på egen pågående AO');
      // Egen roll utan ao_complete_own (SEC-CUST-10): ingen Klarmarkera — rollen styr, inte sidan.
      const roles = t.fake.get('roles'); const pers = roles.find((r) => r.id === 'personal'); const orig = pers.permissions.slice();
      pers.permissions = orig.filter((x) => x !== 'ao_complete_own'); t.fake.set('roles', roles);
      const s3 = await t.world.session({ viewport: 'iphone' });
      await s3.login('falt2');
      await openAO(s3, AO);
      t.assert(!(await s3.eval(() => !!document.querySelector('.page.active [data-act="complete"]'))), 'utan ao_complete_own: ingen Klarmarkera');
      await s3.context.close();
      pers.permissions = orig; t.fake.set('roles', roles);
      const s2 = await t.world.session({ viewport: 'iphone' });
      await s2.login('falt2');
      await openAO(s2, AO);
      const done = s2.page.locator('.page.active .ao-acts-mobile .aod-primary');
      t.assert(/Klarmarkera/.test(await done.textContent()), 'med ao_complete: primär åtgärd Klarmarkera');
      await done.click();
      await s2.clickModalButton(/Klarmarkera ändå|Ja|OK|Bekräfta/);
      await s2.waitToast(/Order markerad klar/, 8000);
      const klarAo = t.fake.get('workOrders').find((a) => a.id === AO);
      t.assert(klarAo.status === 'klar' && klarAo.completedBy === 'ST-004', 'servern: klar, completedBy satt av servern till fält2 (D-03): ' + klarAo.completedBy);
      const li2 = await s2.layoutIssues();
      t.assert(li2.length === 0, 'klar: inget klipps ' + JSON.stringify(li2));
    },
  },
];
/* Hjälpare för granskningsskärmbilder (docs/qa-2026-11-26/AO-DETALJ.md). */
module.exports.helpers = { seedRich, RICH_IDS, RICH_STATUSES };
