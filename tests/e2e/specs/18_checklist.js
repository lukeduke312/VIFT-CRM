'use strict';
/* Checklistans tre statuslägen (2026-11-23): Ej påbörjad / Pågående / Utförd.
   Beslut: checklistan startar/stoppar aldrig AO:n; egen åtgärd återställs
   med ao_checklist, någon annans (eller äldre punkt utan "vem") kräver
   ao_edit — kontrollerat på servern. Den simulerade servern följer
   migrationen 20261123000002 (SQL-logiken prövas mot riktig PostgreSQL i
   tests/checklist_progress_sql.test.js). */

const AO_ID = 'AO-CHK';
function seedAO(t, extra) {
  const aos = t.fake.get('workOrders').filter((a) => a.id !== AO_ID);
  aos.push(Object.assign({
    id: AO_ID, title: 'Checklista E2E', customerId: 'K-002', status: 'planerad', priority: 'normal',
    staff: ['ST-004', 'ST-002'], log: [], materials: [], scheduledDate: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    checklist: [
      { id: 'k1', text: 'Stäng av vattnet', done: false, avvikelse: null },
      { id: 'k2', text: 'Byt packning', done: false, avvikelse: null },
      { id: 'k3', text: 'Provtryck', done: false, avvikelse: null },
      { id: 'k4', text: 'Äldre utförd punkt', done: true, avvikelse: 'ok' },
    ],
  }, extra || {}));
  t.fake.set('workOrders', aos);
}
const srvItem = (t, id) => t.fake.get('workOrders').find((a) => a.id === AO_ID).checklist.find((c) => c.id === id);
async function open(s) {
  await s.go('pg-ao-detail', { aoId: AO_ID });
  await s.page.waitForFunction((x) => WorkOrderDetailPage.aoId === x && document.querySelector('#ao-checklist .chk-row'), AO_ID, { timeout: 8000 });
}
const row = (id) => `#ao-checklist .chk-row[data-id="${id}"]`;
const rowState = (s, id) => s.eval((sel) => { const r = document.querySelector(sel); return r ? { st: r.dataset.status, txt: r.innerText, busy: r.classList.contains('chk-busy'), btns: [...r.querySelectorAll('.chk-btn')].map((b) => b.title) } : null; }, row(id));

module.exports = [
  {
    id: 'CHK-02', kind: 'workflow', module: 'Arbetsorderchecklistor', name: 'Påbörja → "Sparar…" tills servern svarat → Pågår med vem/när; AO:ns status oförändrad; Utförd registrerar vem/när',
    async run(t) {
      seedAO(t);
      const s = await t.world.session({ viewport: 'iphone' });
      await s.login('falt2');
      await open(s);
      await s.page.waitForSelector(row('k1') + ' .chk-btn-start', { timeout: 8000 });
      t.fake.addFault({ match: /work-order-checklist-resolve:start/, mode: 'delay', ms: 1500, times: 1 });
      await s.page.click(row('k1') + ' .chk-btn-start');
      await s.settle(300);
      const mid = await rowState(s, 'k1');
      t.assert(mid.busy && /Sparar/.test(mid.txt) && mid.st === 'ej_paborjad', 'före serverns svar: "Sparar…", inte visad som pågående: ' + JSON.stringify(mid));
      await s.waitToast(/Påbörjad/, 6000);
      const after = await rowState(s, 'k1');
      const who = srvItem(t, 'k1').startedBy;
      t.assert(after.st === 'pagaende' && /Pågår/.test(after.txt) && who && after.txt.includes(who), 'efter ACK: Pågår + vem (' + who + '): ' + after.txt.replace(/\n/g, ' | '));
      const it = srvItem(t, 'k1');
      t.assert(it.startedById === 'ST-004' && it.startedAt, 'servern har startedById/startedAt');
      t.assert(t.fake.get('workOrders').find((a) => a.id === AO_ID).status === 'planerad', 'AO:ns status oförändrad (ingen autostart)');
      await s.page.click(row('k1') + ' .chk-btn[title="Markera utförd"]');
      await s.waitToast(/Utförd/, 6000);
      const done = srvItem(t, 'k1');
      t.assert(done.done === true && done.doneById === 'ST-004' && done.startedById === 'ST-004', 'Utförd: vem/när sparat, påbörjad-uppgiften kvar');
      t.assert(t.fake.get('workOrders').find((a) => a.id === AO_ID).status === 'planerad', 'AO:ns status fortfarande oförändrad efter Utförd');
      const badge = await s.text('#ao-chk-counter');
      t.note('badge: ' + badge);
      /* V3 2026-11-26: indikatorn visar "N av 4 klara" + "N utförda" (tidigare "N/4 utförda"). */
      t.assert(/[12] av 4 klara/.test(badge) && /[12] utförda/.test(badge), 'framstegsindikatorn räknar utförda');
    },
  },
  {
    id: 'CHK-03', kind: 'workflow', module: 'Arbetsorderchecklistor', name: 'Två användare/enheter: flera punkter pågående samtidigt, inget skrivs över; synkas till den andra enheten; indikatorn skiljer pågående från utförda',
    async run(t) {
      seedAO(t);
      const a = await t.world.session({ viewport: 'iphone' });
      const b = await t.world.session({ viewport: 'laptop' });
      await a.login('falt2'); await b.login('falt');
      await open(a); await open(b);
      await a.page.waitForSelector(row('k1') + ' .chk-btn-start'); await b.page.waitForSelector(row('k2') + ' .chk-btn-start');
      // Båda klickar nästan samtidigt, utan att ha sett varandras ändring.
      await Promise.all([a.page.click(row('k1') + ' .chk-btn-start'), b.page.click(row('k2') + ' .chk-btn-start')]);
      await a.waitToast(/Påbörjad/, 6000); await b.waitToast(/Påbörjad/, 6000);
      t.assert(srvItem(t, 'k1').startedById === 'ST-004' && srvItem(t, 'k2').startedById === 'ST-002', 'servern: båda punkterna pågående, ingen ändring överskriven');
      // Den andra enheten får den andras ändring via ordinarie synk.
      await a.eval(() => DataSync._poll());
      await a.settle(600);
      const k2OnA = await rowState(a, 'k2');
      t.assert(k2OnA && k2OnA.st === 'pagaende', 'enhet A visar B:s pågående punkt efter synk');
      const badge = await a.text('#ao-chk-counter');
      t.note('badge A: ' + badge);
      t.assert(/2 pågår/.test(badge), 'indikatorn visar "2 pågår" separat från utförda');
      await b.go('pg-ao', {}); await b.settle(500);
      const seg = await b.eval((id) => { const card = [...document.querySelectorAll('#pg-ao [onclick]')].find((x) => (x.getAttribute('onclick') || '').includes(id)); return card ? !!card.querySelector('.ao-chk-seg-prog') : null; }, AO_ID);
      t.assert(seg === true, 'AO-listans stapel har ett eget segment för pågående');
    },
  },
  {
    id: 'CHK-04', kind: 'workflow', module: 'Arbetsorderchecklistor', name: 'Återställ: egen åtgärd med ao_checklist; annans och äldre punkt kräver ao_edit — nekas på servern även vid direktanrop',
    async run(t) {
      seedAO(t);
      const f = await t.world.session();
      await f.login('falt2');
      await open(f);
      await f.page.waitForSelector(row('k1') + ' .chk-btn-start');
      await f.page.click(row('k1') + ' .chk-btn-start'); await f.waitToast(/Påbörjad/, 6000);
      const own = await rowState(f, 'k1');
      t.assert(own.btns.includes('Återställ till ej påbörjad'), 'egen pågående punkt: Återställ visas');
      const old = await rowState(f, 'k4');
      t.assert(!old.btns.includes('Återställ till ej påbörjad') && /uppgift om vem saknas/.test(old.txt), 'äldre punkt utan "vem": Återställ visas inte för ao_checklist; raden säger att uppgiften saknas');
      // Direktanrop förbi gränssnittet → servern nekar och inget ändras.
      const r = await f.eval(() => WorkOrderService.checklistAction('AO-CHK', 'k4', 'reset'));
      t.assert(!r.ok && r.code === 'forbidden_other' && srvItem(t, 'k4').done === true, 'direktanrop: servern nekar återställning av äldre punkt (forbidden_other)');
      // Annan fältarbetare påbörjar k2 → falt2 får inte återställa den.
      const o = await t.world.session(); await o.login('falt'); await open(o);
      await o.page.waitForSelector(row('k2') + ' .chk-btn-start');
      await o.page.click(row('k2') + ' .chk-btn-start'); await o.waitToast(/Påbörjad/, 6000);
      const r2 = await f.eval(() => WorkOrderService.checklistAction('AO-CHK', 'k2', 'reset'));
      t.assert(!r2.ok && r2.code === 'forbidden_other' && srvItem(t, 'k2').startedById === 'ST-002', 'annans pågående punkt: servern nekar ao_checklist');
      // Egen återställning fungerar.
      await f.page.click(row('k1') + ' .chk-btn[title="Återställ till ej påbörjad"]'); await f.waitToast(/Återställd/, 6000);
      t.assert(!srvItem(t, 'k1').startedAt && srvItem(t, 'k1').history.map((h) => h.a).join(',') === 'start,reset', 'egen återställning sparad med historik start → reset');
      // Arbetsledare (ao_edit) får återställa annans och äldre.
      const ad = await t.world.session(); await ad.login('admin'); await open(ad);
      const r3 = await ad.eval(() => WorkOrderService.checklistAction('AO-CHK', 'k2', 'reset'));
      const r4 = await ad.eval(() => WorkOrderService.checklistAction('AO-CHK', 'k4', 'reset'));
      t.assert(r3.ok && r4.ok && !srvItem(t, 'k2').startedAt && srvItem(t, 'k4').done === false, 'ao_edit återställer annans och äldre punkt');
    },
  },
  {
    id: 'CHK-05', kind: 'workflow', module: 'Arbetsorderchecklistor', name: 'Serverfel/timeout: aldrig "Pågår"/"Utförd" utan ACK; tydligt fel; raden tillbaka',
    async run(t) {
      seedAO(t);
      const s = await t.world.session();
      await s.login('falt2');
      await open(s);
      await s.page.waitForSelector(row('k3') + ' .chk-btn-start');
      t.fake.addFault({ match: /work-order-checklist-resolve:start/, mode: 'fail', status: 500, error: 'update_failed', times: 1 });
      await s.page.click(row('k3') + ' .chk-btn-start');
      await s.waitToast(/Inget sparades|kunde inte/i, 6000);
      const r = await rowState(s, 'k3');
      t.assert(r.st === 'ej_paborjad' && !r.busy && !/Pågår/.test(r.txt), 'efter serverfel: fortfarande ej påbörjad, inte "Sparar…"');
      t.assert(!srvItem(t, 'k3').startedAt, 'servern oförändrad');
      t.fake.addFault({ match: /work-order-checklist-resolve:done/, mode: 'drop-response', times: 1 });
      await s.page.click(row('k3') + ' .chk-btn[title="Markera utförd"]');
      await s.waitToast(/Kunde inte nå servern|Inget sparades/i, 25000);
      const r2 = await rowState(s, 'k3');
      t.assert(r2.st !== 'utford', 'svar som aldrig kom: visas inte som utförd (osäkert utfall)');
      // Synken hoppas medvetet över medan en skrivning pågår (R1) — som appens
      // återkommande cykel: synka om tills serverns läge syns (högst ~10 s).
      for (let i = 0; i < 10; i++) {
        await s.eval(() => DataSync._poll());
        const done = await s.page.waitForFunction((sel) => { const r = document.querySelector(sel); return r && r.dataset.status !== 'ej_paborjad'; }, row('k3'), { timeout: 1000 }).then(() => true).catch(() => false);
        if (done) break;
      }
      const r3 = await rowState(s, 'k3');
      t.note('efter synk: ' + r3.st + ' (servern: ' + (srvItem(t, 'k3').done ? 'utförd' : 'ej') + ')');
      t.assert(r3.st === (srvItem(t, 'k3').done ? 'utford' : 'ej_paborjad'), 'efter synk visar raden serverns faktiska läge');
    },
    timeout: 120000,
  },
  {
    id: 'CHK-06', kind: 'contract', module: 'Arbetsorderchecklistor', name: 'Äldre server (före migrationen): ingen Påbörja-knapp, befintlig OK/avvikelse fungerar som förut, inget tolkas som "återställ"',
    async run(t) {
      t.fake.opts.checklistLegacy = true;
      try {
        seedAO(t);
        const s = await t.world.session();
        await s.login('falt2');
        await open(s);
        await s.settle(800);
        const r = await rowState(s, 'k1');
        t.assert(!r.btns.includes('Påbörja punkten') && r.btns.includes('Markera utförd'), 'ingen Påbörja mot äldre server; Utförd finns: ' + r.btns.join(', '));
        const probe = t.fake.calls.filter((c) => /checklist-resolve:start/.test(c.action));
        t.assert(probe.length === 1 && probe[0].status === 400, 'en sondering, avvisad av äldre server utan ändring');
        t.assert(t.fake.get('workOrders').find((a) => a.id === AO_ID).checklist.every((c) => !c.startedAt), 'sonderingen ändrade ingenting');
        await s.page.click(row('k1') + ' .chk-btn[title="Markera utförd"]');
        await s.waitToast(/Utförd/, 6000);
        t.assert(srvItem(t, 'k1').done === true, 'Utförd sparas via det äldre kontraktet');
        // En v2-åtgärd mot äldre server: avvisas, aldrig "återställ".
        const before = JSON.stringify(srvItem(t, 'k1'));
        const x = await s.eval(() => { WorkOrderService._chkV2 = true; return WorkOrderService.checklistAction('AO-CHK', 'k1', 'start'); });
        t.assert(!x.ok && x.code === 'invalid_avvikelse' && JSON.stringify(srvItem(t, 'k1')) === before, 'v2-åtgärd mot äldre server: avvisad, punkten orörd');
      } finally { t.fake.opts.checklistLegacy = false; }
    },
  },
  {
    id: 'CHK-07', module: 'Arbetsorderchecklistor', name: 'Mobil: kompakt checklista — knappar under texten, tryckyta ≥ 36 px, ingen horisontell scroll; dator: knappar till höger',
    async run(t) {
      seedAO(t, { checklist: [
        { id: 'k1', text: 'Stäng av vattnet', description: 'Huvudkranen i källaren', done: false, avvikelse: null },
        { id: 'k2', text: 'Byt packning i köksblandaren', done: false, avvikelse: null, startedAt: new Date().toISOString(), startedBy: 'Fält Två', startedById: 'ST-004' },
        { id: 'k3', text: 'Provtryck', done: true, avvikelse: 'ok', doneAt: new Date().toISOString(), doneBy: 'Fält Ett', doneById: 'ST-002' },
        { id: 'k4', text: 'Kontrollera golvbrunn', done: false, avvikelse: 'avvikelse', avvikelseComment: 'Sprucken klämring', avvikelseBy: 'Fält Två', avvikelseById: 'ST-004', avvikelseAt: new Date().toISOString() },
      ] });
      for (const vp of ['iphone', 'laptop']) {
        const s = await t.world.session({ viewport: vp });
        await s.login('falt2');
        await open(s);
        await s.page.waitForSelector(row('k1') + ' .chk-btn-start', { timeout: 8000 });
        const m = await s.eval(() => {
          const rows = [...document.querySelectorAll('#ao-checklist .chk-row')];
          return {
            scroll: document.documentElement.scrollWidth > window.innerWidth + 1,
            minBtn: Math.min(...[...document.querySelectorAll('#ao-checklist .chk-btn')].map((b) => b.getBoundingClientRect().height)),
            below: rows.every((r) => { const a = r.querySelector('.chk-acts'), x = r.querySelector('.chk-main'); return !a || a.getBoundingClientRect().top >= x.getBoundingClientRect().top + 10; }),
            right: rows.every((r) => { const a = r.querySelector('.chk-acts'), x = r.querySelector('.chk-main'); return !a || a.getBoundingClientRect().left >= x.getBoundingClientRect().right - 1; }),
            states: rows.map((r) => r.dataset.status).join(','),
          };
        });
        t.note(vp + ': ' + JSON.stringify(m));
        t.assert(!m.scroll, vp + ': ingen horisontell scroll');
        t.assert(m.states === 'ej_paborjad,pagaende,utford,avvikelse', vp + ': fyra lägen renderas');
        if (vp === 'iphone') { t.assert(m.minBtn >= 36, 'iPhone: tryckyta ≥ 36 px (' + m.minBtn + ')'); t.assert(m.below, 'iPhone: knapparna under texten'); }
        else t.assert(m.right, 'laptop: knapparna till höger om texten');
      }
    },
  },
  {
    id: 'SYNC-AO-01', kind: 'workflow', module: 'Arbetsorderchecklistor', name: 'Synk mellan enheter: en annan enhets AO-ändring syns utan ny åtgärd även när AO-hämtningen blir klar efter omritningen',
    async run(t) {
      seedAO(t);
      const s = await t.world.session();
      await s.login('falt2');
      await open(s);
      // Annan enhet (direkt på servern): k2 påbörjad av falt1.
      const aos = t.fake.get('workOrders');
      const it = aos.find((a) => a.id === AO_ID).checklist.find((c) => c.id === 'k2');
      Object.assign(it, { startedAt: new Date().toISOString(), startedBy: 'Annan Enhet', startedById: 'ST-002' });
      t.fake.set('workOrders', aos); t.fake.touch();
      // Gör AO-hämtningen långsam så att den blir klar EFTER sidans omritning.
      t.fake.addFault({ match: /work-orders-list/, mode: 'delay', ms: 1200, times: 1 });
      await s.eval(() => DataSync._poll());
      const shown = await s.page.waitForFunction((sel) => { const r = document.querySelector(sel); return r && r.dataset.status === 'pagaende'; }, row('k2'), { timeout: 6000 }).then(() => true).catch(() => false);
      t.assert(shown, 'den andra enhetens pågående punkt syns utan ny åtgärd (före rättningen: först vid nästa omritning)');
    },
  },
];
