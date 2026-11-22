#!/usr/bin/env node
/*
 * AO/tid-skrivvägar — kör riktiga src/data/storage.js,
 * src/services/AOTimeSyncService.js, WorkOrderService.js och TimeService.js i
 * en vm-sandlåda. ao-time-write ersätts av en skriptbar falsk server (fetch-
 * mock) som kan svara ACK, definitivt avslag eller inte svara alls.
 *
 * Bevisar klientens kontrakt: inget "sparat" före ACK, återställning vid
 * definitivt avslag, idempotensnyckel bevaras vid återförsök, ordning per
 * post, centralt besked vid avslag utan egen hanterare. Bevisar INTE att den
 * riktiga ao-time-write/RPC:erna beter sig så — det kräver STAGING-test.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, section, done } = require('./lib/harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SRC = ['src/data/storage.js', 'src/services/AOTimeSyncService.js', 'src/services/WorkOrderService.js', 'src/services/TimeService.js'].map(read).join('\n;\n');
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

function world(serverFn, opts) {
  opts = opts || {};
  const ls = {}; const toasts = []; const sent = []; const refreshes = []; let refetches = 0;
  const sb = {
    console: { log() {}, warn() {}, error() {} }, JSON, Date, Math, Promise, setTimeout, clearTimeout, AbortController, Object, Array, String, Number,
    localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } },
    crypto: { randomUUID: () => 'u-' + Math.random().toString(36).slice(2, 10) },
    state: { workOrders: [], timeEntries: [], staff: [], priceGroups: [], currentUser: { id: 'S1', firstName: 'Ann', lastName: 'A' } },
    persist: () => Promise.resolve(true),
    showToast: (m) => toasts.push(m),
    ActivityService: { log() {} },
    Sidebar: { updateBadges() {} },
    Auth: { can: (p) => (opts.perms || ['ao_time', 'ao_edit']).includes(p) },
    Router: { refreshCurrent: () => refreshes.push(1) },
    WorkOrdersReadService: { fetchAndApply: async () => { refetches++; return true; } },
    TimeEntriesReadService: { fetchAndApply: async () => { refetches++; return true; } },
    document: { body: { classList: { contains: (c) => c === 'modal-open' && !!opts.modalOpen } }, activeElement: null },
    fetch: async (url, o) => {
      const body = JSON.parse(o.body); sent.push(body);
      const r = await serverFn(body, sent.length);
      if (r === 'hang') return new Promise((res, rej) => o.signal && o.signal.addEventListener('abort', () => { const e = new Error('a'); e.name = 'AbortError'; rej(e); }));
      return { ok: r.status === 200, status: r.status, json: async () => r.body || {} };
    },
  };
  sb.getAO = (id) => sb.state.workOrders.find((a) => a.id === id) || null;
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(SRC + '\n;globalThis.__X = { Storage, AOTimeSyncService, WorkOrderService, TimeService };', sb);
  const X = sb.__X;
  X.Storage.WRITE_TIMEOUT_MS = 200;
  X.WorkOrderService.geocodeAddressIfNeeded = async () => {};
  return Object.assign(X, { sb, ls, toasts, sent, refreshes, refetches: () => refetches });
}
const ACK = { status: 200, body: { ok: true } };
const REJECT = (e) => ({ status: 403, body: { error: e || 'forbidden' } });

(async () => {
  section('Manuell tid: ACK, avslag, ingen hanterare');
  {
    const w = world(() => ACK);
    w.sb.state.workOrders.push({ id: 'AO-1', timeEntries: [] });
    let settled = null;
    const r = w.TimeService.saveManual({ date: '2026-11-23', startStr: '08:00', endStr: '09:30', aoId: 'AO-1' }, { onSettled: (x) => { settled = x; } });
    check('saveManual returnerar ok direkt (optimistiskt)', r.ok === true);
    check('ingen bekräftelse innan servern svarat', settled === null);
    await tick(20);
    check('efter ACK: onSettled ok', settled && settled.ok === true);
    check('create_time skickades med posten', w.sent[0].action === 'create_time' && w.sent[0].entry.minutes === 90);
  }
  {
    const w = world(() => REJECT('forbidden'));
    w.sb.state.workOrders.push({ id: 'AO-1', timeEntries: [] });
    let settled = null;
    const r = w.TimeService.saveManual({ date: '2026-11-23', startStr: '08:00', endStr: '09:00', aoId: 'AO-1' }, { onSettled: (x) => { settled = x; } });
    await tick(20);
    check('avslag: onSettled ok:false, rolledBack', settled && settled.ok === false && settled.rolledBack === true);
    check('avslag: posten borta ur state.timeEntries', w.sb.state.timeEntries.length === 0);
    check('avslag: AO:ns timeEntries-referens borta', w.sb.state.workOrders[0].timeEntries.length === 0);
    check('avslag med egen hanterare: inget dubbelt centralt besked', w.toasts.length === 0);
  }
  {
    const w = world(() => REJECT('forbidden'));
    w.TimeService.saveManual({ date: '2026-11-23', startStr: '08:00', endStr: '09:00' });
    await tick(400);
    check('avslag UTAN hanterare: centralt besked visas', w.toasts.some((m) => /sparades inte/.test(m)));
    check('…och serverns läge läses om', w.refetches() >= 1);
  }

  section('Radering av tidpost');
  {
    const w = world(() => REJECT('attested_locked'));
    w.sb.state.timeEntries = [{ id: 'T1', staffId: 'S1' }, { id: 'T2', staffId: 'S1', date: '2026-11-20' }, { id: 'T3', staffId: 'S1' }];
    let settled = null;
    w.TimeService.delete('T2', { onSettled: (x) => { settled = x; } });
    check('borttagen lokalt direkt', !w.sb.state.timeEntries.some((t) => t.id === 'T2'));
    await tick(20);
    check('servern nekar (attesterad) → posten tillbaka på samma plats', w.sb.state.timeEntries.map((t) => t.id).join() === 'T1,T2,T3');
    check('onSettled ok:false med felkod', settled && settled.ok === false && settled.error === 'attested_locked');
  }
  {
    const w = world(() => ACK);
    w.sb.state.timeEntries = [{ id: 'T1', staffId: 'S1' }];
    let settled = null;
    w.TimeService.delete('T1', { onSettled: (x) => { settled = x; } });
    await tick(20);
    check('ACK → förblir borttagen', w.sb.state.timeEntries.length === 0 && settled.ok === true);
  }
  {
    const w = world(() => ACK, { perms: ['ao_time'] });
    w.sb.state.timeEntries = [{ id: 'T9', staffId: 'S1', attested: true }];
    const r = w.TimeService.delete('T9');
    check('attesterad post: klienten nekar innan något skickas', r.ok === false && w.sent.length === 0);
  }

  section('AO: arkiv/papperskorg/permanent radering');
  {
    const w = world(() => REJECT('forbidden'));
    w.sb.state.workOrders.push({ id: 'AO-1', archived: false, updatedAt: 'x' });
    let settled = null;
    w.WorkOrderService.archive('AO-1', { onSettled: (x) => { settled = x; } });
    check('arkiverad lokalt direkt', w.sb.state.workOrders[0].archived === true);
    await tick(20);
    check('avslag → archived återställt', w.sb.state.workOrders[0].archived === false && w.sb.state.workOrders[0].updatedAt === 'x');
    check('onSettled rolledBack', settled && settled.rolledBack === true);
  }
  {
    const w = world(() => ACK);
    w.sb.state.workOrders.push({ id: 'AO-1' });
    let settled = null;
    w.WorkOrderService.softDelete('AO-1', { onSettled: (x) => { settled = x; } });
    await tick(20);
    check('ACK → deleted kvar, deleteAfter satt', w.sb.state.workOrders[0].deleted === true && !!w.sb.state.workOrders[0].deleteAfter && settled.ok);
    check('patch_ao skickades', w.sent[0].action === 'patch_ao' && w.sent[0].patch.deleted === true);
  }
  {
    const w = world(() => REJECT('forbidden'));
    w.sb.state.workOrders.push({ id: 'A' }, { id: 'B' }, { id: 'C' });
    w.WorkOrderService.permanentDelete('B', { onSettled() {} });
    check('permanent: borta lokalt direkt', w.sb.state.workOrders.length === 2);
    await tick(20);
    check('avslag → AO tillbaka på samma plats', w.sb.state.workOrders.map((a) => a.id).join() === 'A,B,C');
  }

  section('AO-patch utan egen hanterare (fire-and-forget)');
  {
    const w = world(() => REJECT('stale_write'));
    w.sb.state.workOrders.push({ id: 'AO-7', displayNumber: 'AO-0007', title: 'x' });
    w.WorkOrderService.update('AO-7', { title: 'y' });
    w.WorkOrderService.update('AO-7', { title: 'z' });
    await tick(400);
    check('två avslag → ETT samlat besked', w.toasts.filter((m) => /sparades inte/.test(m)).length === 1);
    check('beskedet nämner AO-numret', w.toasts.some((m) => /AO-0007|2 ändringar/.test(m)));
    check('serverns läge läses om', w.refetches() >= 1);
    check('vyn ritas om (ingen modal öppen)', w.refreshes.length === 1);
  }
  {
    const w = world(() => REJECT('forbidden'), { modalOpen: true });
    w.sb.state.workOrders.push({ id: 'AO-8' });
    w.WorkOrderService.update('AO-8', { title: 'y' });
    await tick(400);
    check('modal öppen → ingen omritning (inget formulär tappas)', w.refreshes.length === 0 && w.toasts.length === 1);
  }

  section('Osäkert nätverksutfall: idempotens och ordning');
  {
    let n = 0;
    const w = world(() => (++n === 1 ? 'hang' : ACK));
    w.sb.state.workOrders.push({ id: 'AO-3' });
    const first = await w.AOTimeSyncService.patchAO('AO-3', { title: 'a' });
    check('första försöket tar timeout → transient, kvar i outbox', first.ok === false && first.final === false && w.AOTimeSyncService.pendingCount() === 1);
    const key = w.sent[0].idempotencyKey;
    const r2 = await w.AOTimeSyncService.retryOne(key);
    check('återförsök använder samma idempotensnyckel', w.sent[1].idempotencyKey === key && r2.ok === true);
    check('outbox tom efter ACK', w.AOTimeSyncService.pendingCount() === 0);
  }
  {
    let n = 0;
    const w = world(() => (++n === 1 ? { status: 503, body: { error: 'http_503' } } : ACK));
    const first = await w.AOTimeSyncService.patchAO('AO-4', { title: 'old' });
    check('äldre patch: 503 → transient, kvar', first.ok === false && first.final === false);
    const second = await w.AOTimeSyncService.patchAO('AO-4', { title: 'new' });
    const titles = w.sent.map((b) => b.patch.title);
    check('ny patch dränerar äldre först: old(503), old(ACK), new(ACK)', titles.join() === 'old,old,new');
    check('servern får aldrig nyare före äldre (slutvärde = new)', second.ok === true && w.AOTimeSyncService.pendingCount() === 0);
  }
  {
    let n = 0;
    const w = world(() => { n++; return n <= 2 ? { status: 503, body: { error: 'http_503' } } : ACK; });
    await w.AOTimeSyncService.patchAO('AO-5', { title: 'old' });
    const second = await w.AOTimeSyncService.patchAO('AO-5', { title: 'new' });
    check('äldre fortfarande transient → nyare blockeras (skickas inte förbi)', second.ok === false && !!second.blockedBy && !w.sent.some((b) => b.patch.title === 'new'));
  }

  done();
})();
