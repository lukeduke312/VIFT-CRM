#!/usr/bin/env node
/*
 * Skrivvägarnas timeout (storage.js _authFetch opts.timeoutMs) och hur ett
 * avbrutet anrop hanteras av de verkliga anroparna:
 *   - Storage.writeBusinessKeyMerge (persist()-vägen) → network_error,
 *     som state.js klassar som 'uncertain' (aldrig "sparat").
 *   - AOTimeSyncService (AO/tid via ao-time-write) → transient: posten
 *     ligger kvar i outboxen med samma idempotensnyckel för återförsök.
 * Kör riktiga src/data/storage.js + src/services/AOTimeSyncService.js i vm.
 * fetch mockas: detta bevisar klientlogiken, inte serverns beteende.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, section, done } = require('./lib/harness');

const ROOT = path.join(__dirname, '..');
const STORAGE = fs.readFileSync(path.join(ROOT, 'src/data/storage.js'), 'utf8');
const AOTS = fs.readFileSync(path.join(ROOT, 'src/services/AOTimeSyncService.js'), 'utf8');

function memLocalStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; },
    key: (i) => Object.keys(m)[i], get length() { return Object.keys(m).length; }, _m: m };
}

/* Beter sig som riktig fetch: avvisar med AbortError när signalen avbryts. */
function hangingFetch(calls) {
  return (url, opts) => { calls.push({ url, body: opts && opts.body }); return new Promise((resolve, reject) => {
    if (opts && opts.signal) opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  }); };
}

function load(fetchImpl) {
  const ls = memLocalStorage();
  const sb = { console, JSON, Date, Math, Promise, setTimeout, clearTimeout, AbortController, localStorage: ls, fetch: fetchImpl, crypto: { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2) } };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(STORAGE + '\n' + AOTS + '\n;globalThis.__S = Storage; globalThis.__A = AOTimeSyncService;', sb);
  sb.__S.WRITE_TIMEOUT_MS = 300;
  return { S: sb.__S, A: sb.__A, ls };
}

(async () => {
  section('_authFetch: timeout är opt-in');
  {
    const calls = []; const { S } = load(hangingFetch(calls));
    const t0 = Date.now(); let err = null;
    try { await S._authFetch('https://x.test/a', { body: '{}', timeoutMs: 200 }); } catch (e) { err = e; }
    check('hängande anrop avbryts inom ~gränsen', Date.now() - t0 < 1500);
    check('felet är markerat isTimeout', !!(err && err.isTimeout));
    let settled = false;
    S._authFetch('https://x.test/b').then(() => { settled = true; }, () => { settled = true; });
    await new Promise((r) => setTimeout(r, 600));
    check('utan timeoutMs: oförändrat beteende (ingen egen avbrytning)', settled === false);
  }

  section('Skrivmetoder skickar timeout');
  {
    const src = STORAGE;
    for (const m of ['setAll', 'setRemoteStrict', 'setStampStatus', 'writeBusinessKey', 'writeBusinessKeyMerge']) {
      const start = src.indexOf('  async ' + m + '(');
      const body = src.slice(start, src.indexOf('\n  },', start));
      check(m + ' använder WRITE_TIMEOUT_MS', /timeoutMs:\s*this\.WRITE_TIMEOUT_MS/.test(body));
    }
    check('AOTimeSyncService._call använder WRITE_TIMEOUT_MS', /timeoutMs:\s*Storage\.WRITE_TIMEOUT_MS/.test(AOTS));
    check('läsningar (getAll) har ingen påtvingad timeout', !/getAll\(\)\s*\{[^}]*timeoutMs/.test(src));
  }

  section('persist-vägen: merge-skrivning som tar timeout');
  {
    const { S } = load(hangingFetch([]));
    const r = await S.writeBusinessKeyMerge('vift_customers', [{ id: 'C1', data: { id: 'C1' }, previous: null }], []);
    check('returnerar ok:false', r.ok === false);
    check("error = 'network_error' (state.js klassar som 'uncertain')", r.error === 'network_error');
    const stateSrc = fs.readFileSync(path.join(ROOT, 'src/data/state.js'), 'utf8');
    check("_vfClassifyWriteFailure: network_error → 'uncertain'", /r\.error === 'network_error'[^\n]*return 'uncertain'/.test(stateSrc));
  }

  section('AO/tid-vägen: timeout är transient, inte "sparat" och inte borttaget');
  {
    const calls = []; const { A, ls } = load(hangingFetch(calls));
    const r = await A.patchAO('AO-1', { title: 'Ny titel' }, null);
    check('enqueue resolvar med ok:false', r.ok === false);
    check('final:false (transient, ska återförsökas)', r.final === false);
    const box = JSON.parse(ls.getItem('vift_outbox') || '[]');
    check('posten ligger kvar i outboxen', box.length === 1 && box[0].localRefId === 'AO-1');
    check('isUnsynced skyddar läsvägar', A.isUnsynced('ao', 'AO-1') === true);
    const key1 = box[0].payload.idempotencyKey;
    let ok2 = null;
    const fetchOk = (url, opts) => { calls.push({ url, body: opts.body }); return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) }); };
    const sb2 = load(fetchOk); sb2.ls._m.vift_outbox = ls.getItem('vift_outbox');
    ok2 = await sb2.A.retryOne(key1);
    const resent = JSON.parse(calls[calls.length - 1].body);
    check('återförsök skickar SAMMA idempotensnyckel', resent.idempotencyKey === key1);
    check('efter serverns ACK: ok:true och outboxen tom', ok2.ok === true && JSON.parse(sb2.ls.getItem('vift_outbox')).length === 0);
  }

  section('AO/tid-vägen: definitivt avslag tas bort och rapporteras');
  {
    const f = () => Promise.resolve({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) });
    const { A, ls } = load(f);
    const r = await A.createTime({ id: 'T-1', staffId: 'S1', minutes: 30 });
    check('ok:false, final:true', r.ok === false && r.final === true);
    check("error = 'forbidden' (UI får aldrig visa Sparat)", r.error === 'forbidden');
    check('outboxen tömd (inget evigt återförsök)', JSON.parse(ls.getItem('vift_outbox')).length === 0);
  }

  done();
})();
