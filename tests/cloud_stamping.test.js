#!/usr/bin/env node
/*
 * Molnbaserad stämpling — två "enheter" (separata vm-sandlådor med egen
 * localStorage och eget state) mot EN gemensam falsk server som efterliknar:
 *   - stamp_status per användare med serverägd revision (store-key-write:
 *     getStampStatus / setStampStatus → stale vid fel expectedRevision)
 *   - create_time med op_idempotency (samma nyckel → ursprungligt svar)
 * Kör riktiga storage.js, AOTimeSyncService.js och TimeService.js.
 *
 * OBS: servern är en modell byggd från klientkodens dokumenterade kontrakt
 * (storage.js/AOTimeSyncService.js). Att den riktiga ao-time-write och
 * store-key-write beter sig likadant måste verifieras i STAGING.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, section, done } = require('./lib/harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SRC = ['src/data/storage.js', 'src/services/AOTimeSyncService.js', 'src/services/TimeService.js'].map(read).join('\n;\n');
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

function makeServer(opts) {
  opts = opts || {};
  const srv = { stamp: null, revision: 0, entries: {}, idem: {}, mode: 'ok', calls: [] };
  srv.handle = async (url, body) => {
    srv.calls.push(body.action);
    if (srv.mode === 'down') return { status: 503, body: { error: 'http_503' } };
    if (/store-key-write$/.test(url)) {
      if (body.action === 'getStampStatus') {
        return { status: 200, body: { hasRow: !!srv.stamp, active: !!(srv.stamp && srv.stamp.active), ts: srv.stamp ? srv.stamp.ts : null, aoId: srv.stamp ? srv.stamp.aoId : null, revision: srv.revision } };
      }
      if (body.action === 'setStampStatus') {
        if (body.expectedRevision !== srv.revision) {
          return { status: 200, body: { stale: true, active: !!(srv.stamp && srv.stamp.active), ts: srv.stamp && srv.stamp.ts, aoId: srv.stamp && srv.stamp.aoId, revision: srv.revision } };
        }
        srv.stamp = { active: !!body.active, ts: body.active ? body.ts : null, aoId: body.active ? (body.aoId || null) : null };
        srv.revision++;
        return { status: 200, body: { active: srv.stamp.active, ts: srv.stamp.ts, aoId: srv.stamp.aoId, revision: srv.revision } };
      }
    }
    if (/ao-time-write$/.test(url) && body.action === 'create_time') {
      if (srv.mode === 'createDown') return { status: 503, body: { error: 'http_503' } };
      if (!opts.noIdempotency && srv.idem[body.idempotencyKey]) return srv.idem[body.idempotencyKey];
      if (srv.entries[body.entry.id]) return { status: 409, body: { error: 'id_collision' } };
      srv.entries[body.entry.id] = body.entry;
      const res = { status: 200, body: { entry: body.entry } };
      srv.idem[body.idempotencyKey] = res;
      return res;
    }
    return { status: 400, body: { error: 'unknown_action' } };
  };
  return srv;
}

function device(server, sharedLs) {
  const m = sharedLs || {};
  const toastLog = [];
  const sb = {
    console: { log() {}, warn() {}, error() {} }, JSON, Date, Math, Promise, setTimeout, clearTimeout, setInterval, AbortController, Object, Array, String, Number,
    localStorage: { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } },
    crypto: { randomUUID: () => 'u-' + Math.random().toString(36).slice(2, 10) },
    state: { workOrders: [], timeEntries: [], staff: [], priceGroups: [], stampActive: false, stampTimestamp: null, stampAoId: null, currentUser: { id: 'S1', firstName: 'Ann', lastName: 'A' } },
    persist: () => Promise.resolve(true),
    showToast: (t) => toastLog.push(t),
    ActivityService: { log() {} },
    MobileShell: { onClockChange() {} },
    Auth: { can: () => true, getAccessToken: () => 'jwt', getUserEmail: () => 'ann@example.test' },
    fetch: async (url, o) => {
      const r = await server.handle(url, JSON.parse(o.body));
      return { ok: r.status === 200, status: r.status, json: async () => r.body };
    },
  };
  sb.getAO = (id) => sb.state.workOrders.find((a) => a.id === id) || null;
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(SRC + '\n;globalThis.__X = { Storage, AOTimeSyncService, TimeService };', sb);
  sb.__X.Storage.WRITE_TIMEOUT_MS = 200;
  return Object.assign(sb.__X, { sb, ls: m, toastLog });
}

(async () => {
  section('Instämpling på mobilen syns på datorn');
  {
    const srv = makeServer();
    const mobile = device(srv); const desktop = device(srv);
    await desktop.TimeService.refreshStampFromServer();
    check('datorn: ej instämplad från början', desktop.sb.state.stampActive === false);
    await mobile.Storage.getStampStatus();
    mobile.TimeService.clockIn('AO-1');
    await tick(20);
    check('servern: aktiv, kopplad till AO-1', srv.stamp.active === true && srv.stamp.aoId === 'AO-1');
    await desktop.TimeService.refreshStampFromServer();
    check('datorn: visar instämplad med samma starttid/AO', desktop.sb.state.stampActive === true && desktop.sb.state.stampTimestamp === srv.stamp.ts && desktop.sb.state.stampAoId === 'AO-1');

    section('Utstämpling på datorn av pass startat på mobilen');
    let settled = null;
    const e = desktop.TimeService.clockOut({ onSettled: (r) => { settled = r; } });
    await tick(30);
    check('en tidpost skapad på servern', Object.keys(srv.entries).length === 1);
    check('tidpostens id härleds ur passet', e.id === 'TID-S1-' + mobile.sb.state.stampTimestamp);
    check('serverns stämpling rensad efter bekräftad tidpost', srv.stamp.active === false);
    check('onSettled ok', settled && settled.ok === true);
    await mobile.TimeService.refreshStampFromServer();
    check('mobilen: visar utstämplad efter uppdatering', mobile.sb.state.stampActive === false);
  }

  section('Två aktiva pass kan inte uppstå');
  {
    const srv = makeServer();
    const a = device(srv); const b = device(srv);
    await a.Storage.getStampStatus(); await b.Storage.getStampStatus();
    a.TimeService.clockIn('AO-A');
    await tick(20);
    b.TimeService.clockIn('AO-B');
    await tick(20);
    check('servern behåller första passet', srv.stamp.aoId === 'AO-A');
    check('enhet B rättas till serverns pass (stale)', b.sb.state.stampActive === true && b.sb.state.stampAoId === 'AO-A' && b.sb.state.stampTimestamp === srv.stamp.ts);
  }

  section('Dubbel utstämpling från två enheter → exakt en tidpost');
  for (const variant of ['idempotens', 'id_collision']) {
    const srv = makeServer({ noIdempotency: variant === 'id_collision' });
    const a = device(srv); const b = device(srv);
    await a.Storage.getStampStatus();
    a.TimeService.clockIn('AO-1');
    await tick(20);
    await b.TimeService.refreshStampFromServer();
    let ra = null, rb = null;
    a.TimeService.clockOut({ onSettled: (r) => { ra = r; } });
    b.TimeService.clockOut({ onSettled: (r) => { rb = r; } });
    await tick(60);
    check('[' + variant + '] exakt en tidpost på servern', Object.keys(srv.entries).length === 1);
    check('[' + variant + '] båda enheterna får ok (ingen falsk "fortfarande instämplad")', ra && ra.ok && rb && rb.ok);
    check('[' + variant + '] ingen enhet visar instämplad', !a.sb.state.stampActive && !b.sb.state.stampActive);
    check('[' + variant + '] serverns stämpling rensad', srv.stamp.active === false);
  }

  section('Omladdning medan tidposten väntar (servern svarar inte)');
  {
    const srv = makeServer();
    const ls = {};
    const a = device(srv, ls);
    await a.Storage.getStampStatus();
    a.TimeService.clockIn('AO-9');
    await tick(20);
    const ts = srv.stamp.ts;
    srv.mode = 'createDown';
    a.TimeService.clockOut();
    await tick(30);
    check('tidposten ligger kvar i outboxen', a.AOTimeSyncService.pendingCount() === 1);
    check('servern visar fortfarande passet aktivt', srv.stamp.active === true);
    // "Omladdning": ny sandlåda, samma localStorage, nytt minne
    const a2 = device(srv, ls);
    a2.TimeService.registerStampIntentHandler();
    check('efter omladdning: utstämplingen känns igen som väntande', !!a2.TimeService._pendingClockOutFor(ts));
    a2.sb.state.stampActive = false;
    await a2.TimeService.refreshStampFromServer();
    check('uppdatering vänder INTE tillbaka till instämplad', a2.sb.state.stampActive === false);
    srv.mode = 'ok';
    await a2.AOTimeSyncService.resumePending();
    await tick(40);
    check('tidposten skapas när servern svarar', Object.keys(srv.entries).length === 1);
    check('fortsättningen rensar serverns stämpling utan den ursprungliga fliken', srv.stamp.active === false);
  }

  section('Fortsättningen rör aldrig ett nytt pass');
  {
    const srv = makeServer();
    const a = device(srv);
    a.TimeService.registerStampIntentHandler();
    srv.stamp = { active: true, ts: 222, aoId: null }; srv.revision = 5;
    const handler = a.AOTimeSyncService._intentHandlers.clockout_stamp_clear;
    const r = await handler({ kind: 'clockout_stamp_clear', ts: 111 }, { ok: true });
    check('gammalt pass (ts 111) → nytt pass (ts 222) lämnas aktivt', r.ok === true && srv.stamp.active === true && srv.stamp.ts === 222);
    const r2 = await handler({ kind: 'clockout_stamp_clear', ts: 222 }, { ok: false, final: true });
    check('tidpost nekad → ingen rensning', r2.ok === true && srv.stamp.active === true);
  }

  section('Egen skrivning pågår → uppdatering skriver inte över');
  {
    const srv = makeServer();
    const a = device(srv);
    a.TimeService._stampWritesInFlight = 1;
    srv.stamp = { active: true, ts: 5, aoId: null };
    const changed = await a.TimeService.refreshStampFromServer();
    check('hoppar över medan egen stämplingsskrivning pågår', changed === false && a.sb.state.stampActive === false);
  }

  section('Lokal cache är per konto');
  {
    const src = read('src/data/storage.js');
    check('stämplingscachen namnges med inloggad e-post', /_stampLocalKey\(name\)\s*\{[\s\S]*?getUserEmail[\s\S]*?this\.prefix \+ name \+ \(email \? '_' \+ email : ''\)/.test(src));
  }

  done();
})();
