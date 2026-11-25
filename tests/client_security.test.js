#!/usr/bin/env node
/*
 * T3-A klientskydd (SÄK-9/F6, SÄK-10/F7) — enhetstester av den riktiga
 * klientkoden i vm-sandlådor (src/data/storage.js, src/services/AuthService.js,
 * src/services/AOTimeSyncService.js). fetch mockas: detta bevisar
 * klientlogiken, inte serverns beteende. Webbläsarfallen (flikar, DOM,
 * flöden) finns i tests/e2e/specs/36_client_security.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, section, done } = require('./lib/harness');

const ROOT = path.join(__dirname, '..');
const SRC = ['src/data/storage.js', 'src/services/AuthService.js', 'src/services/AOTimeSyncService.js']
  .map((p) => fs.readFileSync(path.join(ROOT, p), 'utf8')).join('\n;\n');

function memStorage(init) {
  const m = Object.assign({}, init || {});
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; },
    key: (i) => Object.keys(m)[i], get length() { return Object.keys(m).length; }, clear: () => { Object.keys(m).forEach((k) => delete m[k]); }, _m: m };
}

function load(opts) {
  opts = opts || {};
  const ls = memStorage(opts.ls);
  const ss = memStorage({ x: '1' });
  const calls = [];
  const sb = {
    console: { log() {}, warn() {}, error() {} }, JSON, Date, Math, Promise, setTimeout, clearTimeout, AbortController, Object, Array, String, Number, RegExp,
    localStorage: ls, sessionStorage: ss,
    crypto: { randomUUID: () => 'u-' + Math.random().toString(36).slice(2, 10) },
    state: Object.assign({ staff: [], roles: [], currentUser: null }, opts.state || {}),
    showToast: () => {},
    fetch: async (url, o) => { calls.push({ url, body: o && o.body, auth: o && o.headers && o.headers.Authorization }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; },
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(SRC + '\n;globalThis.__X = { Storage, Auth, AOTimeSyncService };', sb);
  return Object.assign(sb.__X, { sb, ls, ss, calls });
}
const sess = (email, extra) => Object.assign({ access_token: 'tok-' + email, refresh_token: 'ref-' + email, expires_at: Date.now() + 3600e3, user_email: email }, extra || {});

(async () => {
  section('Miljö och ägare härleds ur SUPABASE_URL och sessionen');
  {
    const X = load();
    check('envRef = projektets ref ur SUPABASE_URL (ingen hårdkodad ref)', /^[a-z0-9]{20}$/.test(X.Storage.envRef()));
    X.Auth._adoptSession(sess('Anna@Example.test'));
    check('ownerKey = <miljö>|<e-post i gemener>', X.Auth.ownerKey() === X.Storage.envRef() + '|anna@example.test');
  }

  section('SÄK-9: rensning av användarspecifik cache (uttrycklig behållningslista)');
  {
    const keep = ['vift_auth_v2', 'vift_outbox', 'vift_outbox::ref::a@x', 'vift_settleIntents::ref::a@x', 'vift_persistJournal::ref::a@x',
      'vift_persistJournal:a@x', 'vift_activityOutbox::ref::a@x', 'vift_pendingStampClear_a@x', 'vift_logo_light', 'vift_logo_dark',
      'vift_prefs_ST-001', 'vift_push_onboarding_dismissed_ST-001', 'dashLayoutV2_ST-001', 'offerDraft_v1_new_ST-001', 'view-ao'];
    const drop = ['vift_customers', 'vift_staff', 'vift_roles', 'vift_lastChanged', 'vift_timeEntries', 'vift_workOrders', 'vift_invoices',
      'vift_gsearch_history_v1_ST-001', 'vift_stampActive_a@x', 'vift_nyNyckelFranFramtiden', 'vift_logo_lightX'];
    const init = {}; keep.concat(drop).forEach((k) => { init[k] = '1'; }); init.vift_cacheOwner = 'ref|a@x';
    const X = load({ ls: init });
    X.Storage.purgeUserCache();
    check('alla användarspecifika vift_-nycklar borta (även okända/framtida)', drop.every((k) => X.ls.getItem(k) === null));
    check('utkorgar, journaler, intents, logotyp, UI-val och sessionen behålls', keep.every((k) => X.ls.getItem(k) === '1'));
    check('ägarmarkören borttagen', X.ls.getItem('vift_cacheOwner') === null);
    check('sessionStorage tömt', X.ss.length === 0);
  }

  section('SÄK-9: cachen läses och skrivs bara av sin ägare');
  {
    const X = load({ ls: { vift_customers: JSON.stringify([{ id: 'K-A' }]), vift_cacheOwner: 'x|a@example.test' } });
    X.Auth._adoptSession(sess('b@example.test'));
    check('annan ägare: _localAll() ger ingenting', Object.keys(X.Storage._localAll()).length === 0);
    check('annan ägare: _writeCache nekas', X.Storage._writeCache('vift_customers', '[]') === false && /K-A/.test(X.ls.getItem('vift_customers')));
    X.Storage.claimCache(X.Auth.ownerKey());
    check('claimCache: främmande cache rensad och ny ägare satt', X.ls.getItem('vift_customers') === null && X.ls.getItem('vift_cacheOwner') === X.Auth.ownerKey());
    X.Storage.setLocal('customers', [{ id: 'K-B' }]);
    check('egen ägare: skrivning och degraderad läsning fungerar', JSON.stringify(X.Storage._localAll().customers) === '[{"id":"K-B"}]');
    X.Storage.claimCache(X.Auth.ownerKey());
    check('samma ägare igen: egen cache behålls', !!X.ls.getItem('vift_customers'));
    const Y = load({ ls: { vift_customers: '[1]' } });
    Y.Auth._adoptSession(sess('c@example.test'));
    Y.Storage.claimCache(Y.Auth.ownerKey());
    check('cache utan ägare (v3.4) rensas vid första inloggningen', Y.ls.getItem('vift_customers') === null);
  }

  section('SÄK-10: ingen reservroll, inga beslut på rollnamn, fail-closed');
  {
    const roles = [{ id: 'personal', permissions: ['ao_view_own', 'ao_time'] }, { id: 'admin', permissions: ['all'] }];
    const mk = (staff, src) => { const X = load({ state: { staff, roles, _authzSource: src || 'server' } }); X.Auth._adoptSession(sess('u@example.test')); X.Auth._resolveUser(); return X; };
    let X = mk([]);
    check('omatchad användare: no_staff, currentUser null', X.Auth.accessState() === 'no_staff' && X.sb.state.currentUser === null);
    check('omatchad användare: inga behörigheter, inga sidor', !X.Auth.can('ao_view_own') && !X.Auth.can('all') && !X.Auth.canViewPage('pg-dash') && !X.Auth.canAny([]));
    X = mk([{ id: 'S1', email: 'u@example.test', role: 'personal', active: false }]);
    check('inaktiv personalpost: no_staff', X.Auth.accessState() === 'no_staff' && !X.Auth.can('ao_time'));
    X = mk([{ id: 'S1', email: 'U@example.test', role: 'saknas', active: true }]);
    check('okänt roll-id: no_role, inga behörigheter', X.Auth.accessState() === 'no_role' && !X.Auth.can('ao_time') && X.sb.state.currentUser === null);
    X = mk([{ id: 'S1', email: 'u@example.test', role: 'personal', active: true, permissions: ['all'] }]);
    check('giltig roll: behörigheter BARA från rollregistret (personalpostens egna ignoreras)', X.Auth.accessState() === 'ok' && X.Auth.can('ao_time') && !X.Auth.can('all'));
    check('okänd sida i PAGE_PERMISSIONS nekas (fail-closed)', X.Auth.canViewPage('pg-finns-inte') === false && X.Auth.canViewPage('pg-myjobs') === true);
    X = mk([{ id: 'S1', email: 'u@example.test', role: 'admin', active: true }], 'seed');
    check('personal/roller bara från SeedData: unverified, ingen åtkomst', X.Auth.accessState() === 'unverified' && !X.Auth.can('all'));
    X = mk([{ id: 'S1', email: 'u@example.test', role: 'admin', active: true }]);
    X.sb.state._loadForbidden = true; X.Auth._resolveUser();
    check('servern nekade (403): no_staff även om cachad personal matchar', X.Auth.accessState() === 'no_staff');
  }

  section('SÄK-9: delad session byts i annan flik → ingen sändning med gammal identitet');
  {
    const X = load();
    X.Auth._adoptSession(sess('a@example.test'));
    check('samma delade session: aktuell', X.Auth.assertSessionCurrent() === true);
    X.ls.setItem('vift_auth_v2', JSON.stringify(sess('a@example.test', { access_token: 'tok-ny', refresh_token: 'ref-ny' })));
    check('samma användare, roterade token: antas', X.Auth.assertSessionCurrent() === true && X.Auth._session.access_token === 'tok-ny');
    X.ls.setItem('vift_auth_v2', JSON.stringify(sess('b@example.test')));
    let err = null;
    try { await X.Storage._authFetch('https://x.test/functions/v1/ao-time-write', { body: '{}' }); } catch (e) { err = e; }
    check('annan användare i den delade sessionen: _authFetch kastar AUTH_EXPIRED före fetch', !!(err && err.isAuthExpired) && X.calls.length === 0);
    check('fliken har släppt sessionen och rör inte den delade', X.Auth._session === null && JSON.parse(X.ls.getItem('vift_auth_v2')).user_email === 'b@example.test');
    let err2 = null;
    try { await X.Storage._authFetch('https://x.test/rest/v1/store', { body: '{}' }); } catch (e) { err2 = e; }
    check('utan session: inget anrop och den delade sessionen rörs inte', !!(err2 && err2.isAuthExpired) && X.calls.length === 0 && !!X.ls.getItem('vift_auth_v2'));
  }

  section('Utkorg: per ägare och miljö; sändning kräver ägarens aktuella session');
  {
    const X = load();
    X.Auth._adoptSession(sess('a@example.test'));
    X.sb.state.currentUser = { id: 'S1' }; X.Auth._access = { state: 'ok' };
    const f = X.sb.fetch;
    X.sb.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'http_503' }) });
    await X.AOTimeSyncService.createTime({ id: 'T-A', staffId: 'S1', minutes: 5 });
    const keyA = 'vift_outbox::' + X.Storage.envRef() + '::a@example.test';
    const boxA = JSON.parse(X.ls.getItem(keyA) || '[]');
    check('posten ligger under A:s ägarnyckel med owner/env', boxA.length === 1 && boxA[0].owner === 'a@example.test' && boxA[0].env === X.Storage.envRef());
    X.sb.fetch = f;
    X.Auth._clearSession({ explicit: true });
    X.Auth._adoptSession(sess('b@example.test'));
    X.sb.state.currentUser = { id: 'S2' }; X.Auth._access = { state: 'ok' };
    check('B ser inte A:s post', X.AOTimeSyncService.pendingCount() === 0);
    await X.AOTimeSyncService.resumePending();
    check('B:s resumePending skickar inte A:s post', X.calls.filter((c) => /ao-time-write/.test(c.url)).length === 0);
    const r = await X.AOTimeSyncService._sendOne(boxA[0]);
    check('direkt _sendOne av A:s post under B: owner_mismatch, ingen fetch', r.ok === false && r.error === 'owner_mismatch' && X.calls.length === 0);
    check('A:s post finns kvar orörd', JSON.parse(X.ls.getItem(keyA)).length === 1);
    X.Auth._clearSession({ explicit: true });
    const q = await X.AOTimeSyncService.patchAO('AO-1', { title: 'x' });
    check('utan session: inget köas och inget skickas', q.ok === false && q.error === 'auth_expired' && X.calls.length === 0);
    X.Auth._adoptSession(sess('a@example.test'));
    X.sb.state.currentUser = { id: 'S1' }; X.Auth._access = { state: 'ok' };
    await X.AOTimeSyncService.resumePending();
    check('ägaren A skickar sin post när A är inloggad', X.calls.filter((c) => /ao-time-write/.test(c.url)).length === 1 && X.AOTimeSyncService.pendingCount() === 0);
  }

  section('Uppgradering från v3.4: gammal gemensam utkorg migreras utan förlust');
  {
    const legacy = [
      { id: 'L1', entityType: 'time', localRefId: 'T1', owner: 'a@example.test', payload: { action: 'create_time', idempotencyKey: 'L1', entry: { id: 'T1' } } },
      { id: 'L2', entityType: 'time', localRefId: 'T2', owner: 'b@example.test', payload: { action: 'create_time', idempotencyKey: 'L2', entry: { id: 'T2' } } },
      { id: 'L3', entityType: 'time', localRefId: 'T3', payload: { action: 'create_time', idempotencyKey: 'L3', entry: { id: 'T3' } } },
    ];
    const intents = [{ idemKey: 'L1', intent: { kind: 'k', refId: 'x' }, settled: false, applied: false }, { idemKey: 'ZZ', intent: { kind: 'k', refId: 'y' }, settled: true, applied: false }];
    const X = load({ ls: { vift_outbox: JSON.stringify(legacy), vift_settleIntents: JSON.stringify(intents) } });
    X.Auth._adoptSession(sess('a@example.test'));
    const env = X.Storage.envRef();
    check('A ser bara sin egen migrerade post', X.AOTimeSyncService.pendingCount() === 1 && X.AOTimeSyncService._readOutbox()[0].id === 'L1');
    check('B:s post flyttad till B:s ägarnyckel', JSON.parse(X.ls.getItem('vift_outbox::' + env + '::b@example.test')).map((e) => e.id).join() === 'L2');
    check('post utan ägare ligger kvar i den gamla nyckeln', JSON.parse(X.ls.getItem('vift_outbox')).map((e) => e.id).join() === 'L3');
    check('intent följer sin posts ägare; intent utan känd ägare behålls', X.AOTimeSyncService._readIntents().map((i) => i.idemKey).join() === 'L1' && JSON.parse(X.ls.getItem('vift_settleIntents')).map((i) => i.idemKey).join() === 'ZZ');
    check('varningsräknaren: 1 post + 1 intent utan ägare', X.AOTimeSyncService.legacyUnownedCount() === 2);
    const total = ['vift_outbox', 'vift_outbox::' + env + '::a@example.test', 'vift_outbox::' + env + '::b@example.test'].reduce((n, k) => n + JSON.parse(X.ls.getItem(k) || '[]').length, 0);
    check('ingen post förlorad (3 före, 3 efter)', total === 3);
  }

  done();
})();
