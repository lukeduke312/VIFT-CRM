'use strict';
/* Import/export: syntetiska kunder (CSV) → dubblett → uppdatera → kontroll
   → ångra; export utan portkoder/nyckelinformation. Inga riktiga
   kunduppgifter — alla rader är påhittade (example.test). */
const fs = require('fs');

const CSV = [
  'Kundtyp;Namn;Organisationsnummer;E-post;Telefon;Ort',
  'Företag;Testbolaget Ett AB;559900-0001;ett@example.test;010-000 00 01;Uppsala',
  'Företag;Testbolaget Två AB;559900-0002;tva@example.test;010-000 00 02;Västerås',
  'Företag;Fastighets AB Granit;556123-4567;peter@granit.se;010-999 99 99;Stockholm',
].join('\r\n');

async function runCustomerImport(s, csvText, onDuplicates) {
  await s.go('pg-import-wizard', { type: 'customer' });
  await s.page.setInputFiles('#imp-file-input', { name: 'kunder-e2e.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + csvText, 'utf8') });
  await s.page.waitForSelector('#imp-btn-next:not([disabled])', { timeout: 5000 });
  await s.page.click('#imp-btn-next');
  await s.settle(400);
  await s.page.locator('#imp-footer .btn-primary').click(); // steg 2 → 3
  await s.settle(300);
  await s.page.locator('#imp-footer .btn-primary').click(); // validera
  await s.settle(500);
  const err = await s.eval(() => { const e = document.querySelector('#imp-body .ibox, #imp-body .imp-error, #imp-map-error'); return e && e.offsetParent ? e.textContent.trim() : ''; });
  if (err && /kräver|saknas|obligatorisk/i.test(err)) throw new Error('Importguiden stoppade vid validering: ' + err.slice(0, 200));
  if (onDuplicates) await onDuplicates();
  await s.page.locator('#imp-footer .btn-primary').click(); // gå vidare
  await s.settle(300);
  await s.page.locator('#imp-footer .btn-primary').click(); // importera
}

module.exports = [
  {
    id: 'IMP-01', kind: 'workflow', module: 'Import och export', name: 'Flöde: importera 3 syntetiska kunder (1 dubblett) → dubbletten uppdateras → serverkontroll → ångra import → servern återställd',
    async run(t) {
      const s = await t.world.session({ viewport: 'desktop' });
      await s.login('admin');
      const before = t.fake.get('customers').length;
      let dupCount = 0;
      await runCustomerImport(s, CSV, async () => {
        dupCount = await s.page.locator('.imp-conflict-sel').count();
        if (dupCount) await s.page.selectOption('.imp-conflict-sel', 'update');
      });
      await s.page.waitForSelector('.imp-result', { timeout: 8000 });
      await s.settle(1500);
      t.assert(dupCount === 1, 'en dubblett upptäckt (' + dupCount + ')');
      const after = t.fake.get('customers');
      t.assert(after.length === before + 2, 'två nya kunder på servern (' + (after.length - before) + ')');
      t.assert(after.find((c) => c.id === 'K-002').phone === '010-999 99 99', 'dubbletten uppdaterad på servern');
      const res = await s.text('.imp-result');
      t.assert(/2\s*Skapade/.test(res.replace(/\n/g, ' ')) && /1\s*Uppdaterade/.test(res.replace(/\n/g, ' ')), 'resultatet visar 2 skapade, 1 uppdaterad');
      t.assert((t.fake.get('importLogs') || []).length >= 1, 'importloggen sparad på servern');
      // Ångra
      await s.page.locator('.imp-result button', { hasText: 'Ångra import' }).click();
      await s.page.locator('#imp-undo-overlay button', { hasText: 'Ångra importen' }).click();
      await s.settle(2000);
      const undone = t.fake.get('customers');
      t.assert(undone.length === before, 'de skapade kunderna borttagna på servern (' + undone.length + ' vs ' + before + ')');
      t.assert(undone.find((c) => c.id === 'K-002').phone === '08-987 65 43', 'dubbletten återställd på servern');
    },
  },
  {
    id: 'IMP-02', module: 'Import och export', name: 'Import när servern nekar: inget "Import slutförd" utan förbehåll; ogiltig fil ger begripligt fel',
    async run(t) {
      const s = await t.world.session({ viewport: 'laptop' });
      await s.login('admin');
      t.fake.addFault({ match: /store-key-write:writeMerge/, mode: 'fail', status: 503, error: 'http_503', times: 100 });
      await runCustomerImport(s, CSV.split('\r\n').slice(0, 2).join('\r\n'));
      await s.settle(3000);
      const body = await s.text('#pg-import-wizard-content');
      const toasts = await s.toasts();
      t.note('toasts: ' + toasts.join(' / '));
      t.assert(!/Import slutförd!/.test(body), 'resultatsidan säger inte "Import slutförd!" när servern nekat');
      t.assert(/INTE bekräftad av servern/.test(body), 'resultatsidan säger att importen inte är bekräftad');
      t.assert(!t.fake.get('customers').some((c) => c.email === 'ett@example.test'), 'servern har inte kunden');
      t.fake.clearFaults();
      await s.go('pg-import-wizard', { type: 'customer' });
      await s.page.setInputFiles('#imp-file-input', { name: 'trasig.csv', mimeType: 'text/csv', buffer: Buffer.from('', 'utf8') });
      await s.settle(400);
      const nextDisabled = await s.eval(() => { const b = document.getElementById('imp-btn-next'); return !b || b.disabled; });
      if (!nextDisabled) { await s.page.click('#imp-btn-next'); await s.settle(400); }
      const txt = await s.text('#pg-import-wizard-content');
      t.assert(nextDisabled || /tom|fel|kunde inte|saknar|rubrik/i.test(txt), 'tom fil ger begripligt besked');
    },
  },
  {
    id: 'EXP-01', module: 'Import och export', name: 'Export av fastigheter och objekt innehåller aldrig portkod/nyckelinformation; kunder exporteras som CSV',
    async run(t) {
      const s = await t.world.session({ viewport: 'desktop' });
      await s.login('admin');
      // Lägg en portkod i den skyddade tabellen och se att den inte följer med exporten
      await s.eval(() => PropertyDetailPage._saveSensitiveFields({ propertyId: 'OBJ-001', accessCode: '4711', keyInformation: 'Nyckel i tub' }));
      const objId = await s.eval(() => { const o = PropertyObjectService.create({ propertyId: 'OBJ-001', name: 'Lgh 1101 E2E', type: 'lagenhet' }); return o && (o.id || (o.object && o.object.id)); });
      await s.settle(1200);
      t.assert(objId, 'objekt skapat');
      await s.eval((id) => PropertyDetailPage._saveSensitiveFields({ objectId: id, accessCode: '4712', keyInformation: 'Bricka 7' }), objId);
      const out = {};
      for (const type of ['property', 'propertyObject', 'customer']) {
        await s.go('pg-export-center', { type });
        await s.settle(400);
        await s.page.locator('input[name="exc-fmt"][value="csv"]').check();
        await s.eval(() => ExportCenterPage._selectAll(true));
        const dl = s.page.waitForEvent('download', { timeout: 8000 });
        await s.page.locator('button[onclick="ExportCenterPage._doExport()"]').click();
        const d = await dl.catch((e) => { throw new Error('ingen nedladdning för ' + type + ': ' + e.message.split('\n')[0]); });
        const p = await d.path();
        out[type] = fs.readFileSync(p).toString('utf8');
        t.note(type + ': ' + out[type].split('\n')[0].slice(0, 160));
      }
      for (const type of ['property', 'propertyObject']) {
        t.assert(!/4711|4712|Nyckel i tub|Bricka 7|portkod|nyckelinfo/i.test(out[type]), type + '-exporten saknar portkod och nyckelinformation');
      }
      t.assert(/BRF Solgläntan/.test(out.customer), 'kundexporten innehåller kunderna');
    },
  },
  {
    /* QA 2026-11-26: newId() läste alla siffror i ett id som ett tal. Fanns ett
       AO med UUID-id fick varje importerad AO samma id ("AO-3.77…e+21") —
       riktiga id-dubbletter. Rättat: importen använder samma kollisionssäkra
       id som appen (WorkOrderService._newAoId). Simulerad server. */
    id: 'IMP-03', module: 'Import och export', name: 'AO-import när ett AO med UUID-id finns: varje importerad AO får ett eget, giltigt id (inga dubbletter)',
    async run(t) {
      const aos = t.fake.get('workOrders');
      aos.push(Object.assign({}, aos[0], { id: 'AO-3f2a1b4c-9e21-4d7a-8b1e-77aa00112233', displayNumber: 'AO-900', title: 'Befintlig AO med UUID-id' }));
      t.fake.set('workOrders', aos);
      const s = await t.world.session({ viewport: 'desktop' });
      await s.login('admin');
      const before = await s.eval(() => state.workOrders.map((a) => a.id));
      const csv = ['Titel;Beskrivning;Status', 'Import-AO ett;Test;nytt', 'Import-AO två;Test;nytt', 'Import-AO tre;Test;nytt'].join('\r\n');
      await s.go('pg-import-wizard', { type: 'workOrder' });
      await s.page.setInputFiles('#imp-file-input', { name: 'ao-e2e.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + csv, 'utf8') });
      await s.page.waitForSelector('#imp-btn-next:not([disabled])', { timeout: 5000 });
      await s.page.click('#imp-btn-next'); await s.settle(400);
      for (let i = 0; i < 4; i++) {
        if (await s.eval(() => !!document.querySelector('.imp-result'))) break;
        await s.page.locator('#imp-footer .btn-primary').click(); await s.settle(500);
      }
      await s.page.waitForSelector('.imp-result', { timeout: 8000 });
      const created = await s.eval((b) => state.workOrders.filter((a) => !b.includes(a.id)).map((a) => ({ id: a.id, title: a.title })), before);
      const ids = created.map((c) => c.id);
      t.note('skapade: ' + ids.join(', '));
      t.assert(created.length === 3, 'tre AO skapade (' + created.length + ')');
      t.assert(new Set(ids).size === 3, 'alla id unika (' + ids.join(', ') + ')');
      t.assert(ids.every((x) => /^AO-[0-9a-z-]{8,}$/i.test(x) && !/e\+/i.test(x)), 'giltiga id utan exponentform (' + ids.join(', ') + ')');
      t.assert(ids.every((x) => !before.includes(x)), 'inga krockar med befintliga AO');
    },
  },
];
