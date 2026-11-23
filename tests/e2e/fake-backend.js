'use strict';
/*
 * Simulerad Supabase-backend för E2E-tester (körs i testprocessen, svarar via
 * Playwrights page.route). Modellerar det klienten faktiskt anropar:
 *   auth (token/refresh/user/logout/recover), rest/v1/store, push_subscriptions,
 *   store-key-write, ao-time-write, work-orders-list, time-entries-list,
 *   invoice-write, rondering-pass-write, work-order-checklist-resolve,
 *   work-order-image-*, offer-*, get/set-sensitive-fields, send-push,
 *   project-document-*.
 *
 * VIKTIGT: kontrakten är härledda ur klientkoden och — där källan finns i
 * repot — ur Edge Function-källan. Behörighetsreglerna är en MODELL (samma
 * regler som klienten och repots EF:er använder). Ett grönt test här visar
 * att klienten beter sig rätt mot modellen, inte att den riktiga STAGING-
 * servern gör det. Ej modellerade endpoints svarar 501 och loggas.
 *
 * Inga utskick sker: e-post, push och PDF registreras bara i `outbox`.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v === undefined ? null : v)).digest('hex').slice(0, 32);

/* Läser den riktiga SeedData (syntetisk demodata i repot). */
function loadSeed() {
  const sb = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/data/schema.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(ROOT, 'src/data/seedData.js'), 'utf8') + '\n;globalThis.__S = SeedData;', sb);
  return clone(sb.__S);
}

/* Testkonton (syntetiska, @example.test). Lösenord finns bara i testprocessen. */
const TEST_USERS = {
  admin:      { staffId: 'ST-001', email: 'admin@example.test',   role: 'admin' },
  chef:       { staffId: 'ST-003', email: 'arbetsledare@example.test', role: 'chef' },
  falt:       { staffId: 'ST-002', email: 'falt1@example.test',   role: 'personal' },
  falt2:      { staffId: 'ST-004', email: 'falt2@example.test',   role: 'personal' },
  ekonomi:    { staffId: 'ST-006', email: 'ekonomi@example.test', role: 'ekonomi' },
  begransad:  { staffId: 'ST-005', email: 'begransad@example.test', role: 'begransad' },
};
const PASSWORD = 'e2e-test-password';

const DEFINITE = (status, error, extra) => ({ status, body: Object.assign({ error }, extra || {}) });

/* Serverns egna TypeScript-moduler (store-key-write) transpileras en gång
   per process och används här — samma regel i E2E som i enhetstesterna. */
let _edgeMods = null;
function edgeModules() {
  if (_edgeMods) return _edgeMods;
  const os = require('os');
  const { execFileSync } = require('child_process');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vift-fake-edge-'));
  const src = path.join(ROOT, 'supabase', 'functions', 'store-key-write');
  execFileSync('tsc', ['--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck', path.join(src, 'activities-policy.ts'), path.join(src, 'activity-log.ts')], { stdio: 'pipe' });
  _edgeMods = { policy: require(path.join(out, 'activities-policy.js')), activityLog: require(path.join(out, 'activity-log.js')) };
  return _edgeMods;
}

class FakeSupabase {
  constructor(opts) {
    opts = opts || {};
    this.opts = opts;
    const seed = loadSeed();
    this.store = new Map();
    const put = (k, v) => this.store.set('vift_' + k, clone(v));
    // Personal: syntetiska e-postadresser för testkontona
    seed.staff.forEach((s) => {
      const u = Object.values(TEST_USERS).find((t) => t.staffId === s.id);
      if (u) { s.email = u.email; s.role = u.role; s.active = true; }
    });
    seed.roles.push({ id: 'begransad', label: 'Begränsad', isBuiltin: false, active: true, description: 'Endast egna AO, utan tid/material/checklista (E2E-testroll).', permissions: ['dashboard_view', 'ao_view_own'] });
    const keys = ['settings', 'staff', 'customers', 'properties', 'priceGroups', 'priceProfiles', 'emailTemplates', 'offers',
      'recurringOrders', 'invoices', 'activityLog', 'contracts', 'inspections', 'ronderingsmallar', 'ronderingar',
      'avvikelser', 'ronderingspass', 'titles', 'roles', 'articles', 'serviceTemplates', 'propertyCategories'];
    keys.forEach((k) => put(k, seed[k] !== undefined ? seed[k] : []));
    put('salesOpps', seed.salesOpportunities || []);
    ['activities', 'propertyObjects', 'importLogs', 'propertyRoles', 'propertyContacts', 'deviationCategories',
      'projects', 'offerEvents', 'offerAttachments', 'notifications', 'projectDocuments', 'serviceMonitorLog']
      .forEach((k) => { if (!this.store.has('vift_' + k)) put(k, []); });
    put('workOrders', seed.workOrders || []);
    put('timeEntries', seed.timeEntries || []);
    put('lastChanged', new Date().toISOString());
    // Invoices: revision 0 för äldre
    this.users = {};
    Object.entries(TEST_USERS).forEach(([alias, u]) => {
      this.users[u.email] = { id: 'uid-' + alias, email: u.email, password: PASSWORD, alias, active: true };
    });
    this.tokens = new Map();
    this.idem = new Map();
    this.stamp = new Map();
    this.files = new Map();
    this.sensitive = new Map();
    this.pushSubs = [];
    this.outbox = [];       // e-post/push/pdf som skulle ha skickats
    this.calls = [];        // alla anrop
    this.unmodeled = [];    // endpoints som saknar modell
    this.faults = [];       // { match: RegExp|fn, mode: 'fail'|'hang'|'delay'|'drop-response', status, error, times, ms }
    this.aoSeq = 2000;
    this.invSeq = 9000;
    this.latencyMs = opts.latencyMs || 0;
  }

  /* ── Hjälpare ─────────────────────────────────────────────── */
  get(k) { return clone(this.store.get('vift_' + k)); }
  set(k, v) { this.store.set('vift_' + k, clone(v)); }
  touch() { this.store.set('vift_lastChanged', new Date().toISOString() + '#' + crypto.randomBytes(3).toString('hex')); }
  staffFor(email) {
    return (this.get('staff') || []).find((s) => s.email && s.email.toLowerCase() === String(email).toLowerCase() && s.active) || null;
  }
  permsFor(email) {
    const st = this.staffFor(email);
    if (!st) return [];
    const r = (this.get('roles') || []).find((x) => x.id === st.role);
    return r && Array.isArray(r.permissions) ? r.permissions : [];
  }
  has(perms, p) { return perms.includes('all') || perms.includes(p); }
  canViewAO(ao, perms, staffId) {
    if (!ao) return false;
    if (this.has(perms, 'ao_view_all')) return true;
    if (!this.has(perms, 'ao_view_own') || !staffId) return false;
    return (Array.isArray(ao.staff) ? ao.staff.map(String) : []).includes(staffId) || ao.status === 'pool';
  }
  /* Fel-injektion: första matchande regel som har kvarvarande gånger. */
  fault(action) {
    const f = this.faults.find((x) => (typeof x.match === 'function' ? x.match(action) : x.match.test(action)) && (x.times == null || x.times > 0));
    if (f && f.times != null) f.times--;
    return f || null;
  }
  addFault(f) { this.faults.push(f); }
  clearFaults() { this.faults = []; }

  /* ── Huvudingång: returnerar {status, headers, body} ───────── */
  async handle(method, url, headers, bodyText) {
    const u = new URL(url);
    const p = u.pathname;
    let body = null;
    try { body = bodyText ? JSON.parse(bodyText) : null; } catch (e) { body = bodyText; }
    const action = p.replace(/^\/(functions|rest|auth)\/v1\//, '') + (body && body.action ? ':' + body.action : '') + (u.searchParams.get('grant_type') ? ':' + u.searchParams.get('grant_type') : '');
    const auth = (headers.authorization || '').replace(/^Bearer /, '');
    const session = this.tokens.get(auth) || null;
    const call = { t: Date.now(), method, path: p, action, user: session ? session.email : null, key: body && body.key, hasLog: !!(body && body.patch && body.patch.log) };
    this.calls.push(call);
    if (method === 'OPTIONS') return { status: 200, body: 'ok' };
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    const f = this.fault(action);
    let res;
    if (f && f.mode === 'hang') return { hang: true };
    if (f && f.mode === 'fail') res = DEFINITE(f.status || 503, f.error || 'http_' + (f.status || 503));
    else {
      try { res = await this.route(method, u, p, body, session, headers); } catch (e) { res = DEFINITE(500, 'fake_backend_exception: ' + e.message); }
    }
    if (f && f.mode === 'delay') await new Promise((r) => setTimeout(r, f.ms || 1000));
    if (f && f.mode === 'drop-response') { call.committedButDropped = true; return { drop: true }; }
    call.status = res.status;
    return res;
  }

  requireSession(session) {
    if (!session) return DEFINITE(401, 'unauthorized');
    if (session.exp < Date.now()) return DEFINITE(401, 'jwt_expired');
    const st = this.staffFor(session.email);
    const user = this.users[session.email];
    if (!st || !user || !user.active) return DEFINITE(403, 'forbidden');
    return null;
  }

  async route(method, u, p, body, session, headers) {
    // ── Auth ──
    if (p === '/auth/v1/token') {
      const gt = u.searchParams.get('grant_type');
      if (gt === 'password') {
        const user = this.users[String(body.email || '').toLowerCase()];
        if (!user || user.password !== body.password || !user.active) return DEFINITE(400, 'invalid_grant', { error_description: 'Invalid login credentials' });
        return { status: 200, body: this.issue(user) };
      }
      if (gt === 'refresh_token') {
        const old = [...this.tokens.entries()].find(([, s]) => s.refresh === body.refresh_token);
        if (!old) return DEFINITE(400, 'invalid_grant');
        return { status: 200, body: this.issue(this.users[old[1].email]) };
      }
      return DEFINITE(400, 'unsupported_grant_type');
    }
    if (p === '/auth/v1/user') {
      if (!session) return DEFINITE(401, 'unauthorized');
      return { status: 200, body: { id: this.users[session.email].id, email: session.email } };
    }
    if (p === '/auth/v1/logout') { if (session) this.tokens.delete(headers.authorization.replace(/^Bearer /, '')); return { status: 204, body: '' }; }
    if (p === '/auth/v1/recover') { this.outbox.push({ type: 'password_reset', to: body && body.email }); return { status: 200, body: {} }; }

    // ── Publika offert-EF:er (ingen inloggning) ──
    if (p === '/functions/v1/offer-token-validate') return this.offerValidate(u.searchParams.get('t'));
    if (p === '/functions/v1/offer-respond') return this.offerRespond(body);
    if (p === '/functions/v1/offer-public-pdf') { this.outbox.push({ type: 'pdf', token: u.searchParams.get('t') }); return { status: 200, headers: { 'content-type': 'application/pdf' }, raw: Buffer.from('%PDF-1.4\n% e2e\n') }; }

    // ── REST store ──
    if (p === '/rest/v1/store') {
      const deny = this.requireSession(session); if (deny) return deny;
      if (method === 'GET') {
        const key = (u.searchParams.get('key') || '').replace(/^eq\./, '');
        const LOCKED = ['vift_workOrders', 'vift_timeEntries'];
        if (key) return { status: 200, body: LOCKED.includes(key) || !this.store.has(key) ? [] : [{ value: clone(this.store.get(key)) }] };
        return { status: 200, body: [...this.store.entries()].filter(([k]) => !LOCKED.includes(k)).map(([k, v]) => ({ key: k, value: clone(v) })) };
      }
      // Direkt skrivning (Storage.set/setAll/setRemoteStrict). STAGING blockerar
      // affärsnycklar och AO/tid (RESTRICTIVE); andra nycklar tillåts.
      const rows = Array.isArray(body) ? body : [body];
      const blocked = rows.filter((r) => ['vift_workOrders', 'vift_timeEntries'].includes(r.key) || this.isBusinessKey(r.key));
      if (blocked.length) return DEFINITE(403, 'new row violates row-level security policy', { code: '42501', keys: blocked.map((r) => r.key) });
      rows.forEach((r) => this.store.set(r.key, clone(r.value)));
      return { status: 201, body: '' };
    }
    if (p === '/rest/v1/push_subscriptions') {
      const deny = this.requireSession(session); if (deny) return deny;
      if (method === 'POST') { this.pushSubs.push(Object.assign({}, body, { user: session.email })); return { status: 201, body: '' }; }
      if (method === 'DELETE') return { status: 204, body: '' };
      return { status: 200, body: this.pushSubs.filter((s) => s.user === session.email) };
    }

    // ── Inloggade EF:er ──
    if (p.startsWith('/functions/v1/')) {
      const fn = p.slice('/functions/v1/'.length);
      const deny = this.requireSession(session); if (deny) return deny;
      const email = session.email;
      const perms = this.permsFor(email);
      const me = this.staffFor(email);
      switch (fn) {
        case 'store-key-write': return this.storeKeyWrite(body, email, perms, me);
        case 'ao-time-write': return this.aoTimeWrite(body, perms, me);
        case 'work-orders-list': return { status: 200, body: { workOrders: (this.get('workOrders') || []).filter((a) => this.canViewAO(a, perms, me.id)) } };
        case 'time-entries-list': {
          const all = this.get('timeEntries') || [];
          return { status: 200, body: { timeEntries: this.has(perms, 'payroll_view') ? all : all.filter((t) => t.staffId === me.id) } };
        }
        case 'invoice-write': return this.invoiceWrite(body, perms, me);
        case 'rondering-pass-write': return this.ronderingWrite(body, perms, me);
        case 'work-order-checklist-resolve': return this.checklistResolve(body, perms, me);
        case 'work-order-log-write': return this.logWrite(body, perms, me);
        case 'work-order-image-upload': return this.imageUpload(body, perms, me, headers);
        case 'work-order-image-url': return this.imageUrl(body, perms, me);
        case 'work-order-image-delete': return this.imageDelete(body, perms, me);
        case 'get-sensitive-fields': {
          if (!this.has(perms, 'objects_sensitive')) return DEFINITE(403, 'forbidden');
          return { status: 200, body: Object.assign({ accessCode: '', keyInformation: '', accessInformation: '' }, this.sensitive.get((body && (body.objectId || body.propertyId))) || {}) };
        }
        case 'set-sensitive-fields': {
          if (!this.has(perms, 'objects_sensitive')) return DEFINITE(403, 'forbidden');
          const sk = body.objectId || body.propertyId;
          const cur = Object.assign({}, this.sensitive.get(sk) || {});
          ['accessCode', 'keyInformation', 'accessInformation'].forEach((f) => { if (f in body) cur[f] = String(body[f] || ''); });
          this.sensitive.set(sk, cur);
          return { status: 200, body: { ok: true } };
        }
        case 'send-push': this.outbox.push({ type: 'push', body }); return { status: 200, body: { sent: 0, simulated: true } };
        case 'offer-pdf': this.outbox.push({ type: 'pdf', body }); return { status: 200, headers: { 'content-type': 'application/pdf' }, raw: Buffer.from('%PDF-1.4\n% e2e\n') };
        case 'send-offer-email': this.outbox.push({ type: 'email', body }); return { status: 200, body: { ok: true, simulated: true } };
        case 'offer-attachment-url': return { status: 200, body: { urls: {} } };
        case 'offer-attachment-upload': {
          // Repots EF (2026-11-23) har PATCH; den driftsatta i STAGING har det inte
          // ännu → 405 som där. Världen kan slå på { attachmentPatch: true }.
          if (!this.has(perms, 'offer_manage')) return DEFINITE(403, 'forbidden');
          if (method === 'DELETE') { // finns i driftsatt EF
            const dl = this.get('offerAttachments') || [];
            const da = dl.find((a) => a.id === body.attachmentId); if (!da) return DEFINITE(404, 'not_found');
            da.active = false; da.deletedAt = new Date().toISOString(); this.set('offerAttachments', dl); this.touch();
            return { status: 200, body: { ok: true } };
          }
          if (method !== 'PATCH' || !this.opts.attachmentPatch) return DEFINITE(405, 'method_not_allowed');
          const list = this.get('offerAttachments') || [];
          const att = list.find((a) => a.id === body.attachmentId);
          if (!att || att.active === false) return DEFINITE(404, 'not_found');
          if ('displayName' in body) att.displayName = String(body.displayName || '').trim() || att.originalFileName;
          if ('description' in body) att.description = String(body.description || '');
          if ('includeInPublicView' in body) att.includeInPublicView = body.includeInPublicView === true;
          if ('includeInCombinedPdf' in body) att.includeInCombinedPdf = body.includeInCombinedPdf === true;
          this.set('offerAttachments', list); this.touch();
          return { status: 200, body: { ok: true, attachment: att } };
        }
        default:
          this.unmodeled.push(fn + (body && body.action ? ':' + body.action : ''));
          return DEFINITE(501, 'not_modeled_in_fake_backend');
      }
    }
    this.unmodeled.push(method + ' ' + p);
    return DEFINITE(501, 'not_modeled_in_fake_backend');
  }

  issue(user) {
    const token = 'tok-' + crypto.randomBytes(12).toString('hex');
    const refresh = 'ref-' + crypto.randomBytes(12).toString('hex');
    this.tokens.set(token, { email: user.email, exp: Date.now() + 3600 * 1000, refresh });
    return { access_token: token, refresh_token: refresh, expires_in: 3600, token_type: 'bearer', user: { id: user.id, email: user.email } };
  }

  /* ── store-key-write ─────────────────────────────────────── */
  isBusinessKey(fullKey) {
    return ['customers', 'offers', 'staff', 'properties', 'priceGroups', 'priceProfiles', 'salesOpps', 'activityLog', 'settings',
      'contracts', 'articles', 'titles', 'roles', 'recurringOrders', 'ronderingsmallar', 'ronderingar', 'avvikelser',
      'activities', 'serviceTemplates', 'emailTemplates', 'propertyCategories', 'propertyObjects', 'importLogs',
      'propertyRoles', 'propertyContacts', 'deviationCategories', 'inspections', 'projects'].map((k) => 'vift_' + k).includes(fullKey);
  }
  /* MODELL för skrivbehörighet per nyckel (store-key-write-källan saknas i repot). */
  canWriteKey(fullKey, perms) {
    /* opts.keyPerms: exakt behörighetstabell per nyckel, t.ex. STAGING:s
       store-key-write v3 (KEY_PERMISSIONS i _staging_integration/server/
       candidate/20261117/store-key-write/index.ts). Nyckel utan post nekas. */
    if (this.opts.keyPerms) { const req = this.opts.keyPerms[fullKey]; return !!req && this.has(perms, req); }
    const k = fullKey.replace(/^vift_/, '');
    if (k === 'roles' || k === 'settings') return this.has(perms, 'admin_manage');
    if (k === 'staff') return this.has(perms, 'staff_manage') || this.has(perms, 'admin_manage');
    if (k === 'articles' || k === 'priceGroups' || k === 'priceProfiles') return this.has(perms, 'article_manage') || this.has(perms, 'admin_manage');
    return true;
  }
  storeKeyWrite(body, email, perms, me) {
    const READ_LOCKED = ['vift_workOrders', 'vift_timeEntries'];
    switch (body.action) {
      case 'readAllWithHashes': {
        const data = {}; const hashes = {};
        (body.keys || []).concat(['vift_lastChanged']).forEach((fk) => {
          if (READ_LOCKED.includes(fk) || !this.store.has(fk)) return;
          const v = clone(this.store.get(fk));
          data[fk.replace(/^vift_/, '')] = v; hashes[fk] = sha(v);
        });
        return { status: 200, body: { data, hashes } };
      }
      case 'readWithHash': {
        if (READ_LOCKED.includes(body.key)) return DEFINITE(403, 'forbidden');
        const v = clone(this.store.get(body.key)); return { status: 200, body: { value: v, hash: sha(v) } };
      }
      case 'readHashes': {
        const hashes = {}; (body.keys || []).forEach((fk) => { if (!READ_LOCKED.includes(fk)) hashes[fk] = sha(this.store.get(fk)); });
        return { status: 200, body: { hashes } };
      }
      case 'write': {
        if (!this.isBusinessKey(body.key)) return DEFINITE(403, 'key_not_allowed');
        if (this.opts.activityAppend && body.key === 'vift_activityLog') return DEFINITE(403, 'append_only');
        if (!this.canWriteKey(body.key, perms)) return DEFINITE(403, 'forbidden');
        const cur = this.store.get(body.key);
        if (body.expectedHash != null && body.expectedHash !== sha(cur)) return { status: 409, body: { error: 'conflict', current: clone(cur), hash: sha(cur) } };
        this.store.set(body.key, clone(body.value)); this.touch();
        return { status: 200, body: { ok: true, hash: sha(body.value), current: clone(body.value) } };
      }
      case 'appendActivity': {
        if (!this.opts.activityAppend) return DEFINITE(400, 'unknown_action');
        const built = edgeModules().activityLog.buildActivityEntry(body.entry, me.id, new Date().toISOString());
        if (!built.ok) return DEFINITE(400, built.error);
        const log = this.get('activityLog') || [];
        if (!log.some((e) => e && e.id === built.entry.id)) { log.unshift(built.entry); this.set('activityLog', log.slice(0, 500)); this.touch(); }
        return { status: 200, body: { ok: true, id: built.entry.id } };
      }
      case 'writeMerge': {
        if (!this.isBusinessKey(body.key)) return DEFINITE(403, 'key_not_allowed');
        if (this.opts.activityAppend && body.key === 'vift_activityLog') return DEFINITE(403, 'append_only');
        const policyOk = this.opts.activitiesPolicy && body.key === 'vift_activities'
          && edgeModules().policy.activitiesWriteAllowed(body.upserts || [], body.removals || [], perms.includes('all') ? ['all'] : perms, me.id).ok;
        if (!policyOk && !this.canWriteKey(body.key, perms)) return DEFINITE(403, 'forbidden');
        const arr = clone(this.store.get(body.key)) || [];
        const ids = arr.map((e) => e && e.id).filter((x) => x != null);
        if (new Set(ids).size !== ids.length) return DEFINITE(409, 'duplicate_id_in_store');
        const conflicts = [];
        const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
        (body.upserts || []).forEach((u) => {
          const i = arr.findIndex((e) => e && String(e.id) === String(u.id));
          const cur = i >= 0 ? arr[i] : null;
          if (!same(cur, u.previous)) { conflicts.push({ id: u.id, current: clone(cur) }); return; }
          if (i >= 0) arr[i] = clone(u.data); else arr.push(clone(u.data));
        });
        (body.removals || []).forEach((r) => {
          const i = arr.findIndex((e) => e && String(e.id) === String(r.id));
          if (i < 0) return;
          if (!same(arr[i], r.previous)) { conflicts.push({ id: r.id, current: clone(arr[i]) }); return; }
          arr.splice(i, 1);
        });
        this.store.set(body.key, arr); this.touch();
        return { status: 200, body: { current: clone(arr), conflicts, hash: sha(arr) } };
      }
      case 'getStampStatus': {
        const s = this.stamp.get(email);
        return { status: 200, body: s ? { hasRow: true, active: s.active, ts: s.ts, aoId: s.aoId, revision: s.revision } : { hasRow: false, active: false, ts: null, aoId: null, revision: 0 } };
      }
      case 'setStampStatus': {
        const s = this.stamp.get(email) || { active: false, ts: null, aoId: null, revision: 0 };
        if (body.expectedRevision !== s.revision) return { status: 200, body: { stale: true, active: s.active, ts: s.ts, aoId: s.aoId, revision: s.revision } };
        const n = { active: !!body.active, ts: body.active ? body.ts : null, aoId: body.active ? (body.aoId || null) : null, revision: s.revision + 1 };
        this.stamp.set(email, n);
        return { status: 200, body: n };
      }
      default: return DEFINITE(400, 'unknown_action');
    }
  }

  /* ── ao-time-write (MODELL; källan saknas i repot) ────────── */
  aoTimeWrite(body, perms, me) {
    if (body.action === '__probe__') return DEFINITE(400, 'unknown_action');
    const key = body.idempotencyKey;
    if (key && this.idem.has(me.id + '|' + key)) return clone(this.idem.get(me.id + '|' + key));
    const res = this._aoTime(body, perms, me);
    if (key && res.status === 200) this.idem.set(me.id + '|' + key, clone(res));
    return res;
  }
  _aoTime(b, perms, me) {
    const aos = this.get('workOrders') || [];
    const tes = this.get('timeEntries') || [];
    const now = new Date().toISOString();
    const save = () => { this.set('workOrders', aos); this.set('timeEntries', tes); this.touch(); };
    const aoMut = ['ao_edit', 'ao_checklist', 'ao_time', 'ao_material', 'ao_complete', 'ao_create'].some((p) => this.has(perms, p));
    switch (b.action) {
      case 'create_ao': {
        if (!this.has(perms, 'ao_create')) return DEFINITE(403, 'forbidden');
        const ao = clone(b.ao);
        if (ao.id && aos.some((a) => a.id === ao.id)) return DEFINITE(409, 'id_collision');
        if (!ao.id) ao.id = 'AO-' + (++this.aoSeq);
        ao.displayNumber = ao.displayNumber || 'AO-' + (++this.aoSeq);
        ao.updatedAt = now; aos.push(ao); save();
        return { status: 200, body: { workOrder: ao } };
      }
      case 'patch_ao': {
        const i = aos.findIndex((a) => a.id === b.aoId);
        if (i < 0) return DEFINITE(404, 'not_found');
        if (!aoMut || !this.canViewAO(aos[i], perms, me.id)) return DEFINITE(403, 'forbidden');
        if (b.expectedUpdatedAt && aos[i].updatedAt && b.expectedUpdatedAt !== aos[i].updatedAt) return DEFINITE(409, 'stale_write');
        Object.assign(aos[i], clone(b.patch)); save();
        return { status: 200, body: { workOrder: aos[i] } };
      }
      /* G5-förslaget (docs/G5-APPEND-LOG.md). Finns bara när världen skapas
         med { backend: { logOps: true } } — STAGING saknar åtgärden i dag,
         och då svarar servern unknown_action som för alla okända åtgärder. */
      case 'append_log': case 'remove_log': {
        /* Riktiga ao-time-write har inte åtgärden (G5 löses i work-order-log-write). */
        return DEFINITE(400, 'unknown_action');
        if (!b.aoId || (b.action === 'append_log' ? !(b.entry && b.entry.id) : !b.entryId)) return DEFINITE(400, 'missing_fields');
        const i = aos.findIndex((a) => a.id === b.aoId);
        if (i < 0) return DEFINITE(404, 'not_found');
        if (!aoMut || !this.canViewAO(aos[i], perms, me.id)) return DEFINITE(403, 'forbidden');
        const log = Array.isArray(aos[i].log) ? aos[i].log : [];
        if (b.action === 'append_log') { if (!log.some((l) => l.id === b.entry.id)) log.push(clone(b.entry)); }
        else { const k = log.findIndex((l) => l.id === b.entryId); if (k >= 0) log.splice(k, 1); }
        aos[i].log = log; aos[i].updatedAt = now; save();
        return { status: 200, body: { workOrder: aos[i] } };
      }
      case 'delete_ao': case 'permanent_delete_ao': {
        const i = aos.findIndex((a) => a.id === b.aoId);
        if (i < 0) return b.action === 'permanent_delete_ao' ? { status: 200, body: { ok: true, alreadyGone: true } } : DEFINITE(404, 'not_found');
        if (!(this.has(perms, 'ao_edit') && this.has(perms, 'ao_view_all'))) return DEFINITE(403, 'forbidden');
        if (b.action === 'permanent_delete_ao') aos.splice(i, 1); else Object.assign(aos[i], { deleted: true, deletedAt: now });
        save(); return { status: 200, body: { ok: true } };
      }
      case 'create_time': {
        const e = clone(b.entry);
        const forOther = e.staffId && e.staffId !== me.id;
        if (forOther ? !this.has(perms, 'payroll_manage') : !(this.has(perms, 'ao_time') || this.has(perms, 'payroll_manage'))) return DEFINITE(403, 'forbidden');
        if (tes.some((t) => t.id === e.id)) return DEFINITE(409, 'id_collision');
        tes.unshift(e); save();
        return { status: 200, body: { entry: e } };
      }
      case 'patch_time': case 'delete_time': {
        const i = tes.findIndex((t) => t.id === b.entryId);
        if (i < 0) return DEFINITE(404, 'not_found');
        const own = tes[i].staffId === me.id;
        if (!(this.has(perms, 'payroll_manage') || (own && this.has(perms, 'ao_time')))) return DEFINITE(403, 'forbidden');
        if (tes[i].attested && !this.has(perms, 'all')) return DEFINITE(409, 'attested_locked');
        if (b.action === 'delete_time') tes.splice(i, 1); else Object.assign(tes[i], clone(b.patch));
        save(); return { status: 200, body: { ok: true } };
      }
      case 'attest_time': {
        if (!this.has(perms, 'payroll_manage')) return DEFINITE(403, 'forbidden');
        const t = tes.find((x) => x.id === b.entryId); if (!t) return DEFINITE(404, 'not_found');
        t.attested = !!b.attested; t.attestedAt = b.attested ? now : ''; t.attestedBy = b.attested ? me.id : '';
        save(); return { status: 200, body: { entry: t } };
      }
      default: return DEFINITE(400, 'unknown_action');
    }
  }

  /* ── invoice-write (MODELL; källan saknas i repot) ────────── */
  invoiceWrite(b, perms, me) {
    if (!this.has(perms, 'invoice_create')) return DEFINITE(403, 'forbidden');
    const invs = this.get('invoices') || [];
    const save = () => { this.set('invoices', invs); this.touch(); };
    const ACTIVE = ['utkast', 'skickad', 'betald', 'förfallen'];
    const find = () => invs.find((i) => i.id === b.invoiceId);
    if (b.action === 'appendChecked') {
      const inv = clone(b.invoice);
      const claimed = new Set();
      invs.filter((i) => ACTIVE.includes(i.status)).forEach((i) => (i.lines || []).forEach((l) => (l.sourceRefs || []).forEach((r) => claimed.add(r.sourceKey))));
      if ((inv.lines || []).some((l) => (l.sourceRefs || []).some((r) => claimed.has(r.sourceKey)))) return DEFINITE(409, 'source_collision');
      inv.id = inv.id || ('FU-' + (++this.invSeq)); inv.revision = 0; inv.status = inv.status || 'utkast';
      invs.unshift(inv); save(); return { status: 200, body: { invoice: inv } };
    }
    const inv = find(); if (!inv) return DEFINITE(404, 'not_found');
    if ((inv.revision || 0) !== b.expectedRevision) return DEFINITE(409, 'stale_write');
    const draftOnly = ['lineAdd', 'lineUpdate', 'lineDelete', 'draftDelete', 'discountSet', 'taxReductionSet'];
    if (draftOnly.includes(b.action) && inv.status !== 'utkast') return DEFINITE(409, 'not_draft');
    const bump = () => { inv.revision = (inv.revision || 0) + 1; inv.updatedAt = new Date().toISOString(); };
    switch (b.action) {
      case 'lineAdd': inv.lines = (inv.lines || []).concat([clone(b.line)]); break;
      case 'lineUpdate': { const l = (inv.lines || []).find((x) => x.id === b.lineId); if (!l) return DEFINITE(404, 'line_not_found'); Object.assign(l, clone(b.patch)); break; }
      case 'lineDelete': inv.lines = (inv.lines || []).filter((x) => x.id !== b.lineId); break;
      case 'discountSet': inv.discount = clone(b.discount); break;
      case 'taxReductionSet': { const tr = b.taxReduction || b; inv.taxReduction = { type: tr.type, amount: tr.amount, basis: tr.basis, note: tr.note }; break; }
      case 'metaUpdate': Object.assign(inv, clone(b.patch)); break;
      case 'setStatus': inv.status = b.status; break;
      case 'draftDelete': { const i = invs.indexOf(inv); invs.splice(i, 1); save(); return { status: 200, body: { ok: true, activityLog: this.get('activityLog') } }; }
      default: return DEFINITE(400, 'unknown_action');
    }
    bump(); save();
    return { status: 200, body: { invoice: inv, activityLog: this.get('activityLog'), changed: true } };
  }

  /* ── rondering-pass-write (MODELL) ───────────────────────────
     Efter klientens dokumenterade kontrakt (RonderingSyncService +
     kommentarerna i RonderingUtforandePage): servern tilldelar id och
     status 'planerat', pointPatch är radlåst och räknar om summary samt
     auto-startar ('pågående'), complete beslutar själv slutstatus
     ('har_avvikelser' om någon punkt har anmärkning, annars 'slutfört')
     och sätter completedBy. bulkCreate skapar flera och returnerar
     created[]. SQL-källan finns inte i repot — se E2E-rapporten. */
  ronderingWrite(b, perms, me) {
    if (!this.has(perms, 'ao_view_all')) return DEFINITE(403, 'forbidden');
    const passes = this.get('ronderingspass') || [];
    const save = () => { this.set('ronderingspass', passes); this.touch(); };
    const fresh = (tpl) => {
      const pass = clone(tpl);
      pass.id = 'RP-' + crypto.randomBytes(4).toString('hex');
      pass.status = 'planerat';
      pass.createdAt = new Date().toISOString(); pass.createdBy = me.id;
      recompute(pass);
      return pass;
    };
    const recompute = (pass) => {
      const sm = { total: 0, ok: 0, anmärkningar: 0, ejKontrollerad: 0, ejAktuell: 0 };
      (pass.categories || []).forEach((c) => (c.points || []).forEach((pt) => {
        sm.total++;
        if (pt.status === 'ok') sm.ok++; else if (pt.status === 'anmärkning') sm.anmärkningar++;
        else if (pt.status === 'ej_aktuell') sm.ejAktuell++; else sm.ejKontrollerad++;
      }));
      pass.summary = sm;
    };
    if (b.action === 'create') { const pass = fresh(b.passTemplate || {}); passes.push(pass); save(); return { status: 200, body: { pass } }; }
    if (b.action === 'bulkCreate') {
      const created = (b.candidates || []).map((c) => fresh(Object.assign({ ronderingId: b.ronderingId }, c)));
      created.forEach((p) => passes.push(p)); save();
      return { status: 200, body: { created, createdCount: created.length } };
    }
    if (b.action === 'migrateLegacy') {
      const pass = clone(b.pass);
      if (passes.some((x) => x.id === pass.id)) return { status: 200, body: { pass: passes.find((x) => x.id === pass.id) } };
      recompute(pass); passes.push(pass); save(); return { status: 200, body: { pass } };
    }
    const pass = passes.find((x) => x.id === b.passId); if (!pass) return DEFINITE(404, 'not_found');
    if ((pass.status === 'slutfört' || pass.status === 'har_avvikelser') && b.action !== 'saveNote') return DEFINITE(409, 'pass_completed');
    const point = () => { const c = (pass.categories || []).find((x) => x.id === b.categoryId); return c && (c.points || []).find((x) => x.id === b.pointId); };
    switch (b.action) {
      case 'pointPatch': {
        const pt = point(); if (!pt) return DEFINITE(404, 'point_not_found');
        Object.assign(pt, { status: b.status, comment: b.comment || '', deviationId: b.deviationId || pt.deviationId || null, workOrderId: b.workOrderId || pt.workOrderId || null, checkedAt: new Date().toISOString(), checkedBy: me.id });
        if (!pass.status || pass.status === 'planerat') { pass.status = 'pågående'; pass.startedAt = new Date().toISOString(); }
        recompute(pass); break;
      }
      case 'pointReset': { const pt = point(); if (!pt) return DEFINITE(404, 'point_not_found'); Object.assign(pt, { status: '', comment: '', deviationId: null, checkedAt: null, checkedBy: null }); recompute(pass); break; }
      case 'saveNote': pass.internalNote = b.note; break;
      case 'autoStart': if (!pass.status || pass.status === 'planerat') { pass.status = 'pågående'; pass.startedAt = new Date().toISOString(); } break;
      case 'complete': recompute(pass); pass.status = pass.summary.anmärkningar > 0 ? 'har_avvikelser' : 'slutfört'; pass.completedAt = new Date().toISOString(); pass.completedBy = me.id; break;
      default: return DEFINITE(400, 'unknown_action');
    }
    save(); return { status: 200, body: { pass } };
  }

  /* ── work-order-checklist-resolve ──────────────────────────
     Standard: efter repots EF + migration 20261123000002 (action-kontrakt,
     tre statuslägen, ingen autostart, ägarkontroll, historik).
     opts.checklistLegacy: som den i dag deployade versionen
     (20260917000001: bara avvikelse ok/avvikelse/null, autostart). */
  checklistResolve(b, perms, me) {
    if (!this.has(perms, 'ao_checklist') && !this.has(perms, 'ao_edit')) return DEFINITE(403, 'forbidden');
    const aos = this.get('workOrders') || [];
    const ao = aos.find((a) => a.id === b.aoId);
    const legacy = !!this.opts.checklistLegacy;
    let action;
    if (!legacy && typeof b.action === 'string' && b.action) {
      if (!['start', 'done', 'avvikelse', 'reset', 'add', 'remove'].includes(b.action)) return DEFINITE(400, 'invalid_action');
      action = b.action;
    } else {
      if (b.avvikelse === 'ok') action = 'done';
      else if (b.avvikelse === 'avvikelse') action = 'avvikelse';
      else if (b.avvikelse === null || b.avvikelse === undefined || b.avvikelse === '') action = 'reset';
      else return DEFINITE(400, 'invalid_avvikelse');
    }
    if (!b.aoId || !b.itemId) return DEFINITE(400, 'missing_fields');
    const comment = String(b.avvikelseComment || '').trim();
    if (action === 'avvikelse' && !comment) return DEFINITE(400, 'comment_required');
    if (!ao) return DEFINITE(404, 'not_found');
    if (!this.canViewAO(ao, perms, me.id)) return DEFINITE(403, 'forbidden');
    ao.checklist = ao.checklist || [];
    const now = new Date().toISOString();
    const name = [me.firstName, me.lastName].filter(Boolean).join(' ') || 'Okänd användare';
    const canEdit = this.has(perms, 'ao_edit');
    const idx = ao.checklist.findIndex((c) => c.id === b.itemId);
    const item = ao.checklist[idx];
    const reply = (noop) => { if (!noop) { ao.updatedAt = now; this.set('workOrders', aos); this.touch(); } return { status: 200, body: Object.assign({ workOrder: ao, noop: !!noop, serverSignature: now }, legacy ? { activityLog: this.get('activityLog') } : { protocol: 2 }) }; };

    if (legacy) {
      if (!item) return DEFINITE(404, 'item_not_found');
      if (action === 'done') Object.assign(item, { avvikelse: 'ok', done: true, avvikelseComment: '', avvikelseAt: '', avvikelseBy: '' });
      else if (action === 'avvikelse') Object.assign(item, { avvikelse: 'avvikelse', done: false, avvikelseComment: comment, avvikelseAt: now, avvikelseBy: name }, b.avvikelseImage ? { avvikelseImage: b.avvikelseImage } : {});
      else Object.assign(item, { avvikelse: null, done: false, avvikelseComment: '', avvikelseAt: '', avvikelseBy: '' });
      if (action !== 'reset' && ['nytt', 'pool', 'planerad'].includes(ao.status)) ao.status = 'pågående';
      return reply(false);
    }

    const entry = { a: action, by: name, byId: me.id, at: now };
    if (action === 'add') {
      const text = String(b.text || '').trim();
      if (!text) return DEFINITE(400, 'text_required');
      if (item) { if (item.text === text) return reply(true); return DEFINITE(409, 'id_collision'); }
      ao.checklist.push({ id: b.itemId, text: text.slice(0, 300), description: String(b.description || '').trim(), done: false, avvikelse: null, history: [entry] });
      return reply(false);
    }
    if (!item) return action === 'remove' ? reply(true) : DEFINITE(404, 'item_not_found');
    const st = item.avvikelse === 'avvikelse' ? 'avvikelse' : (item.done === true || item.avvikelse === 'ok') ? 'utford' : item.startedAt ? 'pagaende' : 'ej_paborjad';
    const owner = st === 'avvikelse' ? item.avvikelseById : st === 'utford' ? item.doneById : st === 'pagaende' ? item.startedById : '';
    const own = !!owner && owner === me.id;
    if (!canEdit && !own && ((['reset', 'remove'].includes(action) && st !== 'ej_paborjad') || (['done', 'avvikelse'].includes(action) && ['utford', 'avvikelse'].includes(st)))) return DEFINITE(403, 'forbidden_other');
    if (action === 'remove') { ao.checklist.splice(idx, 1); return reply(false); }
    entry.from = st;
    if (action === 'start') {
      if (st === 'utford' || st === 'avvikelse') return DEFINITE(409, 'already_resolved');
      if (st === 'pagaende') return reply(true);
      Object.assign(item, { startedAt: now, startedBy: name, startedById: me.id });
    } else if (action === 'done') {
      if (st === 'utford') return reply(true);
      Object.assign(item, { avvikelse: 'ok', done: true, avvikelseComment: '', avvikelseAt: '', avvikelseBy: '', avvikelseById: '', doneAt: now, doneBy: name, doneById: me.id });
    } else if (action === 'avvikelse') {
      Object.assign(item, { avvikelse: 'avvikelse', done: false, avvikelseComment: comment, avvikelseAt: now, avvikelseBy: name, avvikelseById: me.id, doneAt: '', doneBy: '', doneById: '' }, b.avvikelseImage ? { avvikelseImage: b.avvikelseImage } : {});
    } else if (action === 'reset') {
      if (st === 'ej_paborjad') return reply(true);
      Object.assign(item, { done: false, avvikelse: null, avvikelseComment: '', avvikelseAt: '', avvikelseBy: '', avvikelseById: '', startedAt: '', startedBy: '', startedById: '', doneAt: '', doneBy: '', doneById: '' });
    }
    item.history = (item.history || []).concat([entry]).slice(-20);
    return reply(false);
  }

  /* ── work-order-log-write (efter repots EF + migration 20261124000002) ──
     Finns bara när världen skapas med { backend: { logOps: true } }; annars
     svarar "servern" 404 som när funktionen inte är deployad. */
  logWrite(b, perms, me) {
    if (!this.opts.logOps) return DEFINITE(404, 'NOT_FOUND');
    const AO_WRITE = ['ao_edit', 'ao_checklist', 'ao_time', 'ao_material', 'ao_complete', 'ao_create'];
    if (!AO_WRITE.some((p) => this.has(perms, p))) return DEFINITE(403, 'forbidden');
    if (!['append_log', 'remove_log'].includes(b.action)) return DEFINITE(400, 'unknown_action');
    if (!b.aoId || (b.action === 'append_log' ? !(b.entry && b.entry.id) : !b.entryId)) return DEFINITE(400, 'missing_fields');
    const aos = this.get('workOrders') || [];
    const i = aos.findIndex((a) => a.id === b.aoId);
    if (i < 0) return DEFINITE(404, 'not_found');
    if (!this.canViewAO(aos[i], perms, me.id)) return DEFINITE(403, 'forbidden');
    const log = Array.isArray(aos[i].log) ? aos[i].log : [];
    if (b.action === 'append_log') {
      const entry = Object.assign({}, clone(b.entry), { staffId: me.id });
      const ex = log.find((l) => l.id === entry.id);
      if (ex) { if (JSON.stringify(ex) === JSON.stringify(entry)) return { status: 200, body: { workOrder: aos[i], noop: true } }; return DEFINITE(409, 'id_collision'); }
      log.push(entry);
    } else {
      const k = log.findIndex((l) => l.id === b.entryId);
      if (k < 0) return { status: 200, body: { workOrder: aos[i], noop: true } };
      if (!this.has(perms, 'ao_edit') && log[k].staffId !== me.id) return DEFINITE(403, 'forbidden_other');
      log.splice(k, 1);
    }
    aos[i].log = log; aos[i].updatedAt = new Date().toISOString();
    this.set('workOrders', aos); this.touch();
    return { status: 200, body: { workOrder: aos[i], noop: false } };
  }

  /* ── Bild-EF:er (efter repots EF:er) ─────────────────────── */
  imageUpload(b, perms, me, headers) {
    // Multipart tolkas av testlagret (page.route) till { aoId, fileBytes, contentType }.
    if (!this.has(perms, 'ao_checklist') && !this.has(perms, 'ao_edit')) return DEFINITE(403, 'forbidden');
    const ao = (this.get('workOrders') || []).find((a) => a.id === b.aoId); if (!ao) return DEFINITE(404, 'not_found');
    if (!this.canViewAO(ao, perms, me.id)) return DEFINITE(403, 'forbidden');
    const bytes = Buffer.from(b.fileBase64 || '', 'base64');
    const sniff = bytes[0] === 0xFF && bytes[1] === 0xD8 ? 'image/jpeg' : (bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : (bytes.slice(0, 4).toString() === 'RIFF' ? 'image/webp' : null));
    if (!sniff) return DEFINITE(400, 'invalid_file_type');
    const pth = b.aoId + '/' + Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '.jpg';
    this.files.set(pth, { bytes, mime: sniff });
    return { status: 200, body: { path: pth } };
  }
  imageUrl(b, perms, me) {
    const ao = (this.get('workOrders') || []).find((a) => a.id === b.aoId); if (!ao) return DEFINITE(404, 'not_found');
    if (!this.canViewAO(ao, perms, me.id)) return DEFINITE(403, 'forbidden');
    if ((b.paths || []).some((x) => !String(x).startsWith(b.aoId + '/'))) return DEFINITE(400, 'invalid_path');
    const urls = {};
    (b.paths || []).forEach((x) => { if (this.files.has(x)) urls[x] = 'https://e2e-storage.invalid/' + encodeURIComponent(x); });
    return { status: 200, body: { urls } };
  }
  imageDelete(b, perms, me) {
    if (!this.has(perms, 'ao_checklist') && !this.has(perms, 'ao_edit')) return DEFINITE(403, 'forbidden');
    const ao = (this.get('workOrders') || []).find((a) => a.id === b.aoId); if (!ao) return DEFINITE(404, 'not_found');
    if (!this.canViewAO(ao, perms, me.id)) return DEFINITE(403, 'forbidden');
    if (!String(b.path).startsWith(b.aoId + '/')) return DEFINITE(400, 'invalid_path');
    this.files.delete(b.path);
    return { status: 200, body: { ok: true } };
  }

  /* ── Publika offerter (efter repots EF:er) ───────────────── */
  offerValidate(t) {
    const off = (this.get('offers') || []).find((o) => o.publicToken && o.publicToken === t);
    if (!off) return DEFINITE(404, 'not_found');
    if (off.tokenRevokedAt) return DEFINITE(403, 'revoked');
    if (off.tokenExpiresAt && Date.now() > new Date(off.tokenExpiresAt).getTime()) return DEFINITE(410, 'expired');
    if (off.status === 'ersatt') return DEFINITE(410, 'replaced');
    let pub = off;
    if (off.lockedSnapshotJSON) { try { pub = Object.assign({}, JSON.parse(off.lockedSnapshotJSON), { status: off.status, publicToken: off.publicToken, tokenExpiresAt: off.tokenExpiresAt }); } catch (e) {} }
    return { status: 200, body: { offer: pub, attachments: [], status: 'ok' } };
  }
  offerRespond(b) {
    if (!b || !b.token || b.token.length < 32) return DEFINITE(400, 'invalid_token');
    if (!['approve', 'decline', 'change_request'].includes(b.action)) return DEFINITE(400, 'invalid_action');
    if (!String(b.name || '').trim()) return DEFINITE(400, 'name_required');
    if (!String(b.email || '').includes('@')) return DEFINITE(400, 'email_required');
    if (b.action === 'approve' && !b.agreedToTerms) return DEFINITE(400, 'terms_required');
    const offers = this.get('offers') || [];
    const off = offers.find((o) => o.publicToken === b.token);
    if (!off) return DEFINITE(404, 'not_found');
    if (off.tokenRevokedAt) return DEFINITE(403, 'revoked');
    if (['godkänd', 'nekad', 'ändring-begärd'].includes(off.status)) return DEFINITE(410, 'already_answered', { status: off.status });
    let snap = null; try { snap = JSON.parse(off.lockedSnapshotJSON); } catch (e) {}
    if (!snap) return DEFINITE(409, 'snapshot_unavailable');
    const lockedVersion = Number(snap.versionNumber) || 1;
    if (lockedVersion !== (Number(b.offerVersion) || 1)) return DEFINITE(400, 'version_mismatch', { currentVersion: lockedVersion });
    const now = new Date().toISOString();
    off.status = { approve: 'godkänd', decline: 'nekad', change_request: 'ändring-begärd' }[b.action];
    off.answeredAt = now; off.updatedAt = now;
    if (b.action === 'approve') off.customerApproval = { token: b.token, approvedAt: now, approvedByName: b.name, approvedByEmail: b.email, comment: b.comment || '' };
    if (b.action === 'decline') off.declineReason = b.declineReason || 'annat';
    this.set('offers', offers);
    const ev = this.get('offerEvents') || [];
    ev.push({ id: 'OE-' + crypto.randomBytes(4).toString('hex'), offerId: off.id, type: { approve: 'approved', decline: 'declined', change_request: 'change_requested' }[b.action], ts: now, byCustomer: b.name, byEmail: b.email, comment: b.comment || '' });
    this.set('offerEvents', ev); this.touch();
    return { status: 200, body: { ok: true, status: off.status } };
  }
}

module.exports = { FakeSupabase, TEST_USERS, PASSWORD };
