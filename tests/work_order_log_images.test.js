#!/usr/bin/env node
/*
 * AO-loggposter med bild — kör riktiga WorkOrderDetailPage._saveLog() /
 * deleteLogEntry() och den riktiga isSafeImageDataUrl() (från state.js) i vm.
 * WorkOrderService.update() och WorkOrderImageService stubbas så testet kan
 * styra serverns svar (ACK / definitivt avslag / ingen respons ännu).
 * Bevisar klientens ordning och felhantering — inte EF:ernas serverbeteende.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, section, done } = require('./lib/harness');

const ROOT = path.join(__dirname, '..');
const WODP = fs.readFileSync(path.join(ROOT, 'src/pages/WorkOrderDetailPage.js'), 'utf8');
const STATE = fs.readFileSync(path.join(ROOT, 'src/data/state.js'), 'utf8');
const extractFn = (src, name) => { const i = src.indexOf('function ' + name + '('); return src.slice(i, src.indexOf('\n}\n', i) + 2); };

function setup(opts) {
  opts = opts || {};
  const toasts = [], updates = [], uploads = [], removes = [];
  const ao = { id: 'AO-1', log: opts.log ? JSON.parse(JSON.stringify(opts.log)) : [] };
  const form = { text: opts.text || '', file: opts.file || null };
  const sb = {
    console, JSON, Date, Math, Promise, setTimeout, Array, Set, Object,
    state: { currentUser: { firstName: 'Test', lastName: 'Person' } },
    getAO: (id) => (id === ao.id ? ao : null),
    showToast: (m) => toasts.push(m),
    Modal: { close: () => {}, confirm: (msg, cb) => cb() },
    document: {
      getElementById: (id) => {
        if (id === 'log-text') return { value: form.text };
        if (id === 'log-img') return { files: form.file ? [form.file] : [] };
        return null;
      },
    },
    /* G5: sidan anropar appendLogEntry/removeLogEntry; utan serverstöd går
       de till update() med hela loggen — stubben speglar den vägen. */
    WorkOrderService: {
      update: (id, data, o) => { updates.push({ id, log: JSON.parse(JSON.stringify(data.log)), onSettled: o && o.onSettled }); return ao; },
      appendLogEntry(id, entry, o) { return this.update(id, { log: ao.log }, o); },
      removeLogEntry(id, entryId, o) { return this.update(id, { log: ao.log }, o); },
    },
    WorkOrderImageService: {
      upload: async (aoId, f) => { uploads.push(aoId); if (opts.uploadFails) throw new Error('forbidden'); return { path: aoId + '/123-abc.jpg' }; },
      remove: async (aoId, p) => { removes.push({ aoId, p }); return true; },
    },
    AOTimeSyncService: { hasPendingEntry: () => !!opts.otherPending },
  };
  vm.createContext(sb);
  vm.runInContext(extractFn(STATE, 'esc') + '\n' + extractFn(STATE, 'isSafeImageDataUrl') + '\n' + WODP + '\n;globalThis.__P = WorkOrderDetailPage;', sb);
  const P = sb.__P;
  P.aoId = 'AO-1';
  P._rerenderTimeline = () => {};
  return { P, sb, ao, toasts, updates, uploads, removes };
}

(async () => {
  section('Ny loggpost med bild');
  {
    const t = setup({ text: 'Bytt filter', file: { name: 'x.jpg' } });
    await t.P._saveLog();
    check('bilden laddas upp FÖRE databasskrivningen', t.uploads.length === 1 && t.updates.length === 1);
    const e = t.updates[0].log[0];
    check('posten har imagePath, inga bildbytes', e.imagePath === 'AO-1/123-abc.jpg' && e.imageData === '');
    check('ingen "sparad"-bekräftelse före serverns svar', !t.toasts.some((m) => /sparad/i.test(m)));
    t.updates[0].onSettled({ ok: true });
    check('efter ACK: "Loggpost sparad"', t.toasts.includes('Loggpost sparad'));
  }
  {
    const t = setup({ text: '', file: { name: 'x.jpg' }, uploadFails: true });
    await t.P._saveLog();
    check('misslyckad uppladdning → ingen loggpost skickas', t.updates.length === 0 && t.ao.log.length === 0);
    check('användaren informeras', t.toasts.some((m) => /kunde inte laddas upp/i.test(m)));
  }
  {
    const t = setup({ text: 'a', file: { name: 'x.jpg' } });
    await t.P._saveLog();
    t.updates[0].onSettled({ ok: false, final: true, error: 'forbidden' });
    check('definitivt avslag → posten tas bort lokalt', t.ao.log.length === 0);
    check('…och den nu oreferade bilden städas bort', t.removes.length === 1 && t.removes[0].p === 'AO-1/123-abc.jpg');
    check('…och felet visas (aldrig "sparad")', t.toasts.some((m) => /kunde inte sparas/i.test(m)) && !t.toasts.includes('Loggpost sparad'));
  }
  {
    const t = setup({ text: 'a', file: { name: 'x.jpg' }, otherPending: true });
    await t.P._saveLog();
    t.updates[0].onSettled({ ok: false, final: true, error: 'stale_write' });
    check('avslag men annan skrivning väntar för samma AO → bilden raderas INTE', t.removes.length === 0);
  }
  {
    const t = setup({ text: 'a', file: { name: 'x.jpg' } });
    const p1 = t.P._saveLog(); const p2 = t.P._saveLog(); await Promise.all([p1, p2]);
    check('dubbelklick under pågående uppladdning → en uppladdning, en skrivning', t.uploads.length === 1 && t.updates.length === 1);
  }

  section('Borttagning av loggpost med bild');
  const existing = [{ id: 'L1', text: 'x' }, { id: 'L2', text: 'bild', imagePath: 'AO-1/old.jpg' }, { id: 'L3', text: 'y' }];
  {
    const t = setup({ log: existing });
    t.P.deleteLogEntry('L2');
    check('posten tas bort lokalt och skickas', t.updates.length === 1 && !t.updates[0].log.some((l) => l.id === 'L2'));
    check('bilden raderas INTE innan servern bekräftat', t.removes.length === 0);
    t.updates[0].onSettled({ ok: true });
    check('efter ACK raderas bilden', t.removes.length === 1 && t.removes[0].p === 'AO-1/old.jpg');
  }
  {
    const t = setup({ log: existing });
    t.P.deleteLogEntry('L2');
    t.updates[0].onSettled({ ok: false, final: true, error: 'forbidden' });
    check('avslag → bilden raderas aldrig', t.removes.length === 0);
    check('avslag → posten läggs tillbaka på samma plats', t.ao.log.map((l) => l.id).join() === 'L1,L2,L3');
  }
  {
    const t = setup({ log: existing });
    t.P.deleteLogEntry('L2');
    check('ingen respons ännu (transient i outboxen) → bilden orörd', t.removes.length === 0);
  }

  section('isSafeImageDataUrl (riktig funktion ur state.js)');
  {
    const { sb } = setup();
    const f = (v) => vm.runInContext('isSafeImageDataUrl(' + JSON.stringify(v) + ')', sb);
    check('godkänner äkta JPEG-data-URL', f('data:image/jpeg;base64,/9j/4AAQSkZJRg==') === true);
    check('avvisar attribututbrytning', f('data:image/png;base64,AA" onerror="alert(1)') === false);
    check('avvisar javascript:-URL', f('javascript:alert(1)') === false);
    check('avvisar SVG (kan innehålla skript)', f('data:image/svg+xml;base64,PHN2Zz4=') === false);
    check('avvisar tomt/icke-sträng', f('') === false && f(null) === false);
  }

  done();
})();
