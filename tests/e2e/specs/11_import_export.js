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
];
