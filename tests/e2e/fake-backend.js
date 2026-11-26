'use strict';
/*
 * Simulerad Supabase-backend för E2E-tester (körs i testprocessen, svarar via
 * Playwrights page.route). Modellerar det klienten faktiskt anropar:
 *   auth (token/refresh/user/logout/recover), rest/v1/store, push_subscriptions,
 *   store-key-write, ao-time-write, work-orders-list, time-entries-list,
 *   invoice-write, rondering-pass-write, work-order-checklist-resolve,
 *   work-order-image-*, offer-*, get/set-sensitive-fields, send-push,
 *   project-document-*, e2e-test-cleanup (STAGING-only testverktyg).
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
/* T4-A (2026-11-28): skyddade fält, projektion även för skrivare, staff_contacts_view,
   activity_log_view_all, inaktiverad roll, åtkomst per post (t4a-regler.js = serverns regler). */
const T4A = require('./t4a-regler');
const T4B = require('./t4b-regler'); // T4-B (2026-11-28): material, priser och tid
const T4C = require('./t4c-regler'); // T4-C (2026-11-28): åtkomstinformation (objects_access_assigned), D-23
const T4D = require('./t4d-regler'); // T4-D (2026-11-28): rondering per pass (rondering_utfor)

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

/* ── T3-B (2026-11-28): AO- och poolregler — PARITET med den faktiska servern ──
   Speglar vift-v2 supabase/migrations/20261128000001–03 (work_order_patch,
   work_order_pool_take, work_order_billing_set, time_entry_create,
   store_write_stamp_status, checklista/logg) och _shared/vift-auth.ts
   (canViewWorkOrder, poolProjection). Ändras en regel i servern ska den ändras här
   i samma ändring (SEC-SIM-01, tests/sim_parity.test.js). */
const NEW_AO_PERMS = ['ao_start_own', 'ao_complete_own', 'ao_pool_take'];
function effAoPerms(perms) {
  const p = Array.isArray(perms) ? perms.slice() : [];
  if (p.includes('all')) return p;
  if (!NEW_AO_PERMS.some((x) => p.includes(x)) && p.includes('ao_complete') && !p.includes('ao_view_all') && !p.includes('ao_edit')) return p.concat(NEW_AO_PERMS);
  return p;
}
const isTrue = (v) => v === true || v === 'true';
const aoStaffOf = (ao) => (ao && Array.isArray(ao.staff) ? ao.staff.map(String) : []);
const isAssigned = (ao, id) => !!id && aoStaffOf(ao).includes(id);
const isOpenPool = (ao) => !!ao && ao.status === 'pool' && ao.poolOpen !== false && String(ao.poolOpen) !== 'false' && aoStaffOf(ao).length === 0 && !isTrue(ao.deleted) && !isTrue(ao.archived);
const isLockedAO = (ao) => !!ao && (isTrue(ao.deleted) || isTrue(ao.archived) || ao.status === 'fakturerad' || ao.status === 'avbruten' || !!ao.invoiceId);
const POOL_FIELDS = ['id', 'displayNumber', 'title', 'category', 'type', 'priority', 'address', 'zip', 'city', 'estimatedHours', 'status', 'poolOpen', 'createdAt', 'updatedAt'];
function poolProjection(ao) {
  const out = {};
  POOL_FIELDS.forEach((f) => { if (f in ao) out[f] = ao[f]; });
  const pd = typeof ao.poolDescription === 'string' ? ao.poolDescription.trim() : '';
  out.description = pd || (typeof ao.description === 'string' ? ao.description : '');
  out.dueDate = (typeof ao.dueDate === 'string' && ao.dueDate) || (typeof ao.scheduledDate === 'string' ? ao.scheduledDate : '');
  out.scheduledDate = typeof ao.scheduledDate === 'string' ? ao.scheduledDate : '';
  Object.assign(out, { staff: [], checklist: [], materials: [], log: [], timeEntries: [], poolProjection: true });
  return out;
}
const norm = (v) => (v === undefined || v === null ? null : v);
function billingTouched(ao, patch) {
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);
  return (has('status') && patch.status === 'fakturerad' && ao.status !== 'fakturerad')
    || (has('status') && ao.status === 'fakturerad' && patch.status !== 'fakturerad')
    || (has('invoiceId') && String(patch.invoiceId || '') !== String(ao.invoiceId || ''))
    || (has('invoicedAt') && String(patch.invoicedAt || '') !== String(ao.invoicedAt || ''))
    || (has('billingPreviousStatus') && JSON.stringify(norm(patch.billingPreviousStatus)) !== JSON.stringify(norm(ao.billingPreviousStatus)));
}
const REGEL = (status, error, reason) => DEFINITE(status, error, reason ? { reason } : undefined);
const nowText = () => new Date().toISOString();

/* ── T3-C (2026-11-28): roller och superadmin — PARITET med den faktiska servern ──
   Speglar vift-v2 supabase/migrations/20261128000004 (_vift_authz_check, projektionen i
   vift_store_project) och 20261128000005 (vitlista för direkt REST-skrivning, F18).
   "Superadmin" = behörigheten 'all', aldrig roll-id. Ändras en regel i servern ska den
   ändras här i samma ändring (SEC-SIM-01, tests/sim_parity.test.js). */
const recActive = (e) => !!e && typeof e === 'object' && !['false', '0', '', 'null', 'undefined'].includes(String(e.active));
function rolePerms(roles, id) {
  const r = (Array.isArray(roles) ? roles : []).find((x) => x && typeof x === 'object' && x.id === id);
  return r && Array.isArray(r.permissions) ? r.permissions.map(String) : [];
}
const regGet = (arr, id) => (Array.isArray(arr) ? arr : []).find((e) => e && typeof e === 'object' && String(e.id) === String(id)) || null;
const lc = (v) => String(v == null ? '' : v).toLowerCase();
const jsonEq = (a, b) => { const n = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x)); return n(a) === n(b); };
function regBad(arr) {
  const a = Array.isArray(arr) ? arr : [];
  const ids = a.filter((e) => e && typeof e === 'object' && e.id != null && String(e.id) !== '').map((e) => String(e.id));
  return a.filter((e) => !e || typeof e !== 'object' || e.id == null || String(e.id) === '').length + (ids.length - new Set(ids).size);
}
/* identiteter = aktiva inloggningar (app_users.active) → första aktiva personalposten med e-posten → roll. */
function identityPerms(staff, roles, users) {
  const out = {};
  Object.values(users || {}).filter((u) => u && u.active && u.email).forEach((u) => {
    const st = (Array.isArray(staff) ? staff : []).find((e) => recActive(e) && e.email && lc(e.email) === lc(u.email));
    out[u.email] = st ? rolePerms(roles, st.role) : [];
  });
  return out;
}
const superCount = (staff, roles, users) => Object.values(identityPerms(staff, roles, users)).filter((p) => p.includes('all')).length;
const beyond = (nw, old, caller) => (nw || []).some((x) => !(old || []).includes(x) && !(caller || []).includes(x));
/* Returnerar null (godkänt) eller ett felsvar enligt felkodskatalogen. */
function t3cAuthzCheck(key, s0, r0, s1, r1, actorId, users) {
  if (key !== 'vift_staff' && key !== 'vift_roles') return null;
  const actor = (Array.isArray(s0) ? s0 : []).find((e) => recActive(e) && String(e.id) === String(actorId));
  if (!actor || !Object.values(users || {}).some((u) => u && u.active && lc(u.email) === lc(actor.email))) return DEFINITE(403, 'forbidden');
  const P = rolePerms(r0, actor.role);
  if (!(P.includes('all') || P.includes(key === 'vift_staff' ? 'staff_manage' : 'admin_manage'))) return DEFINITE(403, 'forbidden');
  if (key === 'vift_staff' && regBad(s1) > regBad(s0)) return DEFINITE(400, 'invalid_element');
  if (key === 'vift_roles' && regBad(r1) > regBad(r0)) return DEFINITE(400, 'invalid_element');
  if (!P.includes('all')) {
    if (key === 'vift_staff') {
      const n = regGet(s1, actorId);
      if (!n || n.role !== actor.role) return REGEL(403, 'forbidden', 'privilege_escalation');
    } else {
      const o = regGet(r0, actor.role), n = regGet(r1, actor.role);
      if (!o !== !n || (o && JSON.stringify(rolePerms(r0, actor.role).slice().sort()) !== JSON.stringify(rolePerms(r1, actor.role).slice().sort()))) return REGEL(403, 'forbidden', 'privilege_escalation');
    }
    const ids = (a, b) => [...new Set([].concat(a || [], b || []).filter((e) => e && typeof e === 'object' && e.id != null && String(e.id) !== '').map((e) => String(e.id)))];
    if (key === 'vift_roles') {
      for (const id of ids(r0, r1)) {
        const o = regGet(r0, id), n = regGet(r1, id);
        if (jsonEq(o, n)) continue;
        const op = o ? rolePerms(r0, id) : [], np = n ? rolePerms(r1, id) : [];
        if (op.includes('all') || np.includes('all')) return REGEL(403, 'forbidden', 'superadmin_required');
        if (beyond(np, op, P)) return REGEL(403, 'forbidden', 'privilege_escalation');
      }
    } else {
      for (const id of ids(s0, s1)) {
        const o = regGet(s0, id), n = regGet(s1, id);
        if (jsonEq(o, n)) continue;
        const auth = !o || !n || o.role !== n.role || lc(o.email) !== lc(n.email) || recActive(o) !== recActive(n);
        if (!auth) continue;
        const op = o ? rolePerms(r1, o.role) : [], np = n ? rolePerms(r1, n.role) : [];
        if (op.includes('all') || np.includes('all')) return REGEL(403, 'forbidden', 'superadmin_required');
        const grant = !!n && recActive(n) && (!o || !recActive(o) || o.role !== n.role || lc(o.email) !== lc(n.email));
        if (grant && beyond(np, [], P)) return REGEL(403, 'forbidden', 'privilege_escalation');
      }
    }
    const i0 = identityPerms(s0, r0, users), i1 = identityPerms(s1, r1, users);
    for (const e of Object.keys(i0)) {
      if (i0[e].includes('all') !== (i1[e] || []).includes('all')) return REGEL(403, 'forbidden', 'superadmin_required');
      if (beyond(i1[e] || [], i0[e], P)) return REGEL(403, 'forbidden', 'privilege_escalation');
    }
  }
  if (superCount(s0, r0, users) >= 1 && superCount(s1, r1, users) === 0) return DEFINITE(409, 'last_superadmin');
  return null;
}
/* Projektion (D-21, D-14): samma regel som vift_store_full_access + vift_store_project. */
function projectStaffRoles(key, value, perms, me, staffNow) {
  const p = Array.isArray(perms) ? perms : [];
  const has = (x) => p.includes('all') || p.includes(x);
  if (!Array.isArray(value)) return value;
  if (key === 'vift_staff') {
    if (has('staff_manage') || has('admin_manage')) return value;
    return value.map((e) => {
      if (!e || typeof e !== 'object') return e;
      if (me && String(e.id) === String(me.id)) return e;
      const c = Object.assign({}, e); delete c.permissions;
      if (!p.includes('staff_view')) delete c.role;
      return c;
    });
  }
  if (key === 'vift_roles') {
    if (has('admin_manage')) return value;
    const own = me ? ((staffNow || []).find((e) => recActive(e) && String(e.id) === String(me.id)) || {}).role : null;
    return value.filter((e) => e && typeof e === 'object' && ((own != null && e.id === own)
      || (p.includes('staff_manage') && Array.isArray(e.permissions) && !e.permissions.includes('all') && e.permissions.every((x) => p.includes(x)))));
  }
  return value;
}
/* ── T3-D (2026-11-28): urval per post — PARITET med den faktiska servern ──
   Speglar vift-v2 supabase/migrations/20261128000006 (vift_store_full_access, vift_store_project,
   _vift_post_refs m.fl.) och 20261128000007 (activity_log_append: typ och referens per behörighet).
   Gäller nycklarna som T3-C/T3-D projicerar (personal, roller, aktivitetslogg, uppgifter, offerter,
   kunder, fastigheter, objekt, kontakter). Övriga nycklar lämnas som tidigare (C-5 för t.ex.
   inställningar och fakturor är inte modellerat i den simulerade servern). Ändras en regel i
   servern ska den ändras här i samma ändring (SEC-SIM-01, tests/sim_parity.test.js). */
const T3D_KUND = ['customer_manage', 'invoice_view', 'invoice_create', 'offer_manage', 'sales_manage', 'ao_view_all'];
const T3D_KUND_LAS = T3D_KUND.concat(['ao_create', 'recurring_manage', 'reports_view']);
const T3D_OFFER_INTERN = ['customer_manage', 'sales_manage', 'invoice_view', 'invoice_create', 'reports_view', 'ao_view_all', 'ao_edit', 'ao_create'];
const T3D_SENS = ['doorCode', 'keyInformation', 'accessInformation', 'keyReceipt', 'alarmInformation', 'accessCode', 'keyInfo'];
const T3D_STAFF_FIELDS = ['id', 'firstName', 'lastName', 'name', 'title', 'active', 'color', 'initials'];
const T3D_OFFER_REF = ['id', 'title', 'status', 'workOrderId'];
/* T3-E (20261128000008): ej verkställda behörigheter (= _vift_ej_verkstallda()) räknas inte när
   servern avgör intern/extern — de ger ingen åtkomst förrän T4. */
const T3E_EJ_VERKSTALLDA = T4D.EJ_VERKSTALLDA.slice(); // T4-A: cost_view, cost_edit, personal_data_view, bankgiro_edit verkställda; T4-B: time_view_all; T4-C: objects_access_assigned; T4-D: rondering_utfor
const T3D_EXTERN_OK = ['dashboard_view', 'ao_view_own', 'ao_time', 'ao_checklist', 'ao_start_own', 'ao_complete_own', 'objects_access_assigned', 'rondering_utfor'].concat(T3E_EJ_VERKSTALLDA);
const T3D_AO_LOG = ['work_order_created', 'work_order_updated', 'work_order_status', 'work_order_assigned', 'work_order_archived', 'work_order_restored',
  'work_order_deleted', 'work_order_permanent_delete', 'staff_assigned', 'material_added', 'material_removed', 'time_entry_created', 'note'];
const T3D_KEYS = ['vift_staff', 'vift_roles', 'vift_activityLog', 'vift_activities', 'vift_offers', 'vift_customers', 'vift_properties', 'vift_propertyObjects', 'vift_propertyContacts',
  /* T4-A: inställningar, artiklar och urval per post för återkommande, projekt, avvikelser, inspektioner. */
  'vift_settings', 'vift_articles', 'vift_recurringOrders', 'vift_projects', 'vift_avvikelser', 'vift_inspections',
  /* T4-B: prisgrupper (timpris bara med prisläsrätt, annars bara aktiva grupper utan belopp). */
  'vift_priceGroups',
  /* T4-D: pass, ronderingar och mallar (hela bara för ao_view_all, annars urval per pass). */
  'vift_ronderingspass', 'vift_ronderingar', 'vift_ronderingsmallar'];
const anyOf = (p, list) => list.some((x) => p.includes(x));
const pick = (e, keys) => Object.fromEntries(Object.entries(e).filter(([k]) => keys.includes(k)));
const omit = (e, keys) => Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k)));
const taskAo = (t) => (t && t.relatedType === 'workOrder' && t.relatedId ? String(t.relatedId) : (t && t.workOrderId ? String(t.workOrderId) : ''));
/* vift_store_full_access (T3-C + T3-D). keyPerms = serverns KEY_PERMISSIONS (skrivrätt = hela värdet). */
function t3dFull(key, perms, keyPerms) {
  const p = Array.isArray(perms) ? perms : [];
  if (p.includes('all')) return true;
  /* T4-A: giltig behörighet, activity_log_view_all, läsrätt till alla skyddade fält (även skrivare),
     urval per post för återkommande/projekt/inspektioner/avvikelser. */
  if (!T4A.giltig(p)) return false;
  if (key === 'vift_activityLog') return T4A.loggFull(p);
  if (!T4A.allaLasbara(key, p)) return false;
  if (['vift_recurringOrders', 'vift_projects', 'vift_inspections', 'vift_avvikelser'].includes(key)) return T4A.kundLas(p);
  /* T4-B (D-09, D-11): artiklar och prisgrupper i sin helhet bara med prisläsrätt. */
  if (['vift_articles', 'vift_priceGroups'].includes(key) && !T4B.prisLas(p)) return false;
  /* T4-D (SÄK-14, R52/R53): pass, ronderingar och mallar i sin helhet bara för ao_view_all. */
  if (T4D.KEYS.includes(key)) return T4D.ledning(p);
  const wp = keyPerms[key]; if (wp && p.includes(wp)) return true;
  switch (key) {
    case 'vift_offers': case 'vift_offerEvents': case 'vift_offerAttachments': return p.includes('offer_manage');
    case 'vift_invoices': return anyOf(p, ['invoice_view', 'invoice_create', 'reports_view', 'ao_view_all', 'ao_edit']);
    case 'vift_salesOpps': return anyOf(p, ['sales_manage', 'reports_view']);
    case 'vift_contracts': return anyOf(p, ['customer_manage', 'invoice_view', 'invoice_create', 'reports_view']);
    case 'vift_customers': return anyOf(p, T3D_KUND) && p.includes('objects_sensitive');
    case 'vift_propertyObjects': return p.includes('objects_sensitive');
    case 'vift_settings': return anyOf(p, ['admin_manage', 'invoice_view', 'invoice_create', 'reports_view', 'offer_manage', 'ao_view_all', 'ao_edit']);
    case 'vift_staff': return anyOf(p, ['staff_manage', 'admin_manage']);
    case 'vift_roles': return false;
    case 'vift_activities': return p.includes('ao_edit') && p.includes('ao_view_all');
    case 'vift_properties': return p.includes('objects_sensitive') && anyOf(p, T3D_KUND);
    case 'vift_propertyContacts': return anyOf(p, T3D_KUND);
    default: return true;
  }
}
/* T4-A, tilläggsdel notiser (punkt 275, vift-v2 20261128000010): REST-vitlistan är avvecklad —
   ingen nyckel kan skrivas direkt via REST (tidigare vift_notifications och vift_lastChanged). */
const REST_ALLOW = [];
const directBlocked = (key) => DEFINITE(403, 'direct_write_blocked', { code: '42501', message: 'direct_write_blocked', key });

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
  /* T3-D: serverns KEY_PERMISSIONS (skrivrätt = hela värdet i projektionen), utläst ur källan. */
  const m = /const KEY_PERMISSIONS: Record<string, string> = \{([\s\S]*?)\n\}/.exec(fs.readFileSync(path.join(src, 'index.ts'), 'utf8'));
  _edgeMods.keyPerms = {};
  if (m) m[1].replace(/^\s*(vift_\w+)\s*:\s*'([a-z_]+)'/gm, (_, k, v) => { _edgeMods.keyPerms[k] = v; return ''; });
  return _edgeMods;
}

class FakeSupabase {
  constructor(opts) {
    opts = Object.assign({}, opts || {});
    /* T3-B (2026-11-28): work-order-log-write är installerad i STAGING (20261124150357)
       och ingår i T3-B-paketet. Utan den kan fältpersonal inte skriva loggposter alls:
       både den installerade servern och T3-B-servern nekar patch_ao {log} för roller utan
       ao_edit (T3-B: 403 forbidden/field_not_allowed). Standardvärlden har därför logOps;
       ett test som uttryckligen anger logOps:false prövar fortfarande den gamla vägen. */
    if (opts.logOps === undefined) opts.logOps = true;
    this.opts = opts;
    const seed = loadSeed();
    this.store = new Map();
    const put = (k, v) => this.store.set('vift_' + k, clone(v));
    // Personal: syntetiska e-postadresser för testkontona
    seed.staff.forEach((s) => {
      const u = Object.values(TEST_USERS).find((t) => t.staffId === s.id);
      if (u) { s.email = u.email; s.role = u.role; s.active = true; }
    });
    /* T3-E: seedens roller är de fem standardrollerna (inklusive begransad), exakt som
       vift-v2 supabase/manual/t3e_standardroller/standardroller.json (D-26: testkontona = standardrollerna). */
    /* En äldre seed (vift-v2:s klientkopia) saknar begransad: lägg då till standarddefinitionen. */
    if (!seed.roles.some((r) => r.id === 'begransad')) seed.roles.push({ id: 'begransad', label: 'Begränsad', isBuiltin: false, active: true, description: 'Endast egna AO, utan tid/material/checklista (E2E-testroll).', permissions: ['dashboard_view', 'ao_view_own'] });
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
    this.idemG = new Map(); // T3-B: nyckel → {fp, res} (aktör + innehåll)
    this.stamp = new Map();
    this.files = new Map();
    this.sensitive = new Map();
    this.sensitiveAudit = []; // T4-C: sensitive_access_audit (status, fält, väg; aldrig värden)
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
    /* T4-A: inaktiverad roll ger inga behörigheter (checkViftAuth, _vift_role_perms). */
    return r && Array.isArray(r.permissions) && T4A.rollAktiv(r) ? r.permissions : [];
  }
  has(perms, p) { return perms.includes('all') || perms.includes(p); }
  /* T3-B: läsning = ao_view_all, annars ao_view_own och (inte arkiverad/borttagen) och
     (tilldelad eller (ao_pool_take och öppen pool)). Öppen pool lämnas ut projicerad. */
  canViewAO(ao, perms, staffId) {
    if (!ao) return false;
    if (this.has(perms, 'ao_view_all')) return true;
    if (!this.has(perms, 'ao_view_own') || !staffId) return false;
    if (isTrue(ao.deleted) || isTrue(ao.archived)) return false;
    if (isAssigned(ao, staffId)) return true;
    return this.has(effAoPerms(perms), 'ao_pool_take') && isOpenPool(ao);
  }
  /* Innehåll (bilder) och skrivning: tilldelad eller ao_view_all. Öppen pool ger inget. */
  canViewAOContent(ao, perms, staffId) {
    if (!ao) return false;
    if (this.has(perms, 'ao_view_all')) return true;
    return this.has(perms, 'ao_view_own') && !isTrue(ao.deleted) && !isTrue(ao.archived) && isAssigned(ao, staffId);
  }
  canWriteAO(ao, perms, staffId) { return !!ao && (this.has(perms, 'ao_view_all') || isAssigned(ao, staffId)); }
  /* T3-D: _vift_post_refs — AO som anroparen ser med innehåll (inte öppen pool, Q3) och vad de refererar. */
  t3dRefs(perms, staffId) {
    const aos = (this.get('workOrders') || []).filter((a) => a && a.id && this.canViewAOContent(a, perms, staffId));
    const uniq = (l) => [...new Set(l.filter((x) => x != null && String(x) !== '').map(String))];
    const aoIds = uniq(aos.map((a) => a.id));
    return {
      ao: aoIds,
      customers: uniq(aos.map((a) => a.customerId)), properties: uniq(aos.map((a) => a.propertyId)), objects: uniq(aos.map((a) => a.objectId)),
      offers: uniq(aos.map((a) => a.offerId).concat((this.get('offers') || []).filter((o) => o && o.id && aoIds.includes(String(o.workOrderId || ''))).map((o) => o.id))),
      staff: uniq(aos.flatMap((a) => aoStaffOf(a).concat([a.responsibleStaffId]))),
      /* T4-D: ronderingar med eget tilldelat pass (verkställd rondering_utfor). */
      ronderingar: T4D.aktiv(perms) ? T4D.egnaRonderingar(this.get('ronderingspass'), staffId) : [],
    };
  }
  /* T3-D: vift_store_project för nycklarna i T3D_KEYS (T3-C:s regel för roller oförändrad). */
  t3dProject(key, value, perms, me) {
    const p = Array.isArray(perms) ? perms : [];
    if (value === null || value === undefined) return value;
    /* T4-A (punkt 7): utan giltig behörighet inga verksamhetsdata — bara egen personalpost och roll. */
    if (!p.includes('all') && !T4A.giltig(p) && key !== 'vift_staff' && key !== 'vift_roles' && key.startsWith('vift_')) {
      return Array.isArray(value) ? [] : (value && typeof value === 'object' ? {} : null);
    }
    /* T4-A notiser: bara anroparens egna notiser (userId = personal-id som sträng); poster utan
       mottagarfält lämnas inte ut (_vift_notis_projicera). */
    if (key === 'vift_notifications') {
      const mid = me && me.id ? String(me.id) : '';
      return Array.isArray(value) && mid ? value.filter((e) => e && typeof e === 'object' && !Array.isArray(e) && typeof e.userId === 'string' && e.userId === mid) : [];
    }
    if (!T3D_KEYS.includes(key)) return value;
    if (key === 'vift_roles') return projectStaffRoles(key, value, perms, me, this.get('staff'));
    if (t3dFull(key, p, edgeModules().keyPerms)) return value;
    /* T4-A (D-17, D-01): inställningar utan bankgiro (icke-interna) och utan intern timkostnad (utan cost_view). */
    if (key === 'vift_settings') return value && typeof value === 'object' && !Array.isArray(value) ? T4A.proj(key, value, p) : value;
    if (!Array.isArray(value)) return value;
    const id = me && me.id ? String(me.id) : '';
    if (T4D.KEYS.includes(key)) return T4D.projicera(key, value, p, id, this.get('ronderingspass')); // T4-D: urval per pass
    const obj = (e) => e && typeof e === 'object' && !Array.isArray(e);
    const refs = () => this.t3dRefs(p, id);
    if (key === 'vift_articles') return value.map((e) => T4B.artikel(T4A.proj(key, e, p), p)); // T4-B: försäljningspris bara med prisläsrätt
    if (key === 'vift_priceGroups') return T4B.prisgrupper(value, p); // T4-B (D-11, R22)
    if (key === 'vift_staff') {
      /* T4-A: arbetskontakt till kollegor = staff_contacts_view (övergång: T3-E:s härledning). */
      const ext = !T4A.kontakt(p);
      const sv = p.includes('staff_view');
      const r = ext && !sv ? refs() : { staff: [] };
      return value.filter((e) => obj(e) && (String(e.id) === id || !ext || sv || r.staff.includes(String(e.id))))
        .map((e) => (String(e.id) === id ? e : pick(e, T3D_STAFF_FIELDS.concat(sv ? ['role'] : [], ext ? [] : ['phone', 'email']))));
    }
    if (!id) return [];
    if (key === 'vift_offers') {
      if (anyOf(p, T3D_OFFER_INTERN)) return value; // C-5:s interna projektion är inte modellerad (oförändrat)
      const r = refs();
      return value.filter((e) => obj(e) && r.offers.includes(String(e.id || ''))).map((e) => pick(e, T3D_OFFER_REF));
    }
    if (['vift_customers', 'vift_properties', 'vift_propertyObjects', 'vift_propertyContacts'].includes(key)) {
      const las = anyOf(p, T3D_KUND_LAS);
      const r = las ? null : refs();
      const syns = (e) => !r || (key === 'vift_customers' ? r.customers.includes(String(e.id || ''))
        : key === 'vift_properties' ? r.properties.includes(String(e.id || ''))
          : key === 'vift_propertyObjects' ? r.objects.includes(String(e.id || ''))
            : r.properties.includes(String(e.propertyId || '')) && (!e.objectId || r.objects.includes(String(e.objectId))));
      /* T4-A (SÄK-7, D-13): skyddade fält projiceras även för skrivaren; urval per uppdrag utan portkoder. */
      return value.filter((e) => obj(e) && syns(e)).map((e) => (r ? omit(T4A.proj(key, e, p), T3D_SENS) : T4A.proj(key, e, p)));
    }
    /* T4-A (punkt 7): återkommande, projekt, avvikelser, inspektioner per post. */
    if (['vift_recurringOrders', 'vift_projects', 'vift_avvikelser', 'vift_inspections'].includes(key)) {
      if (T4A.kundLas(p)) return value.map((e) => T4A.proj(key, e, p));
      if (key === 'vift_inspections') return [];
      const aos = (this.get('workOrders') || []).filter((a) => a && a.id && this.canViewAOContent(a, p, id));
      if (key === 'vift_avvikelser') { const ids = aos.map((a) => String(a.id)); return value.filter((e) => obj(e) && ids.includes(String(e.workOrderId || ''))); }
      const fld = key === 'vift_recurringOrders' ? 'recurringOrderId' : 'projectId';
      const ids = aos.map((a) => a[fld]).filter((x) => x != null && x !== '').map(String);
      return value.filter((e) => obj(e) && ids.includes(String(e.id || ''))).map((e) => omit(T4A.proj(key, e, p), T3D_SENS));
    }
    if (key === 'vift_activityLog') {
      /* T4-A (T3-D 6): utan activity_log_view_all bara AO där anroparen är tilldelad (eller ser med innehåll utan ao_view_all). */
      const p2 = p.includes('ao_view_all') ? p.filter((x) => x !== 'ao_view_all').concat(['ao_view_own']) : p;
      const r = this.t3dRefs(p2, id);
      /* T4-D (T3-D beslut 5): ronderingshändelser för ronderingar med eget pass. */
      return value.filter((e) => obj(e) && ((T3D_AO_LOG.includes(e.type) && r.ao.includes(String(e.workOrderId || '')))
        || (T4D.RON_HANDELSER.includes(e.type) && !e.workOrderId && r.ronderingar.includes(String(e.ronderingId || ''))))
        && !e.offerId && !e.invoiceId && !e.salesOpportunityId);
    }
    if (key === 'vift_activities') {
      const r = (p.includes('ao_view_own') || p.includes('ao_view_all')) ? this.t3dRefs(['ao_view_own'], id) : { ao: [] };
      return value.filter((e) => obj(e) && (String(e.createdBy || '') === id || String(e.assignedTo || '') === id || r.ao.includes(taskAo(e))));
    }
    return value;
  }
  /* T4-A, tilläggsdel notiser: = store-key-write appendNotification + RPC notification_append
     (vift-v2 20261128000010). Samma ordning: indata → giltig behörighet → typ → idempotens →
     mottagare → referens för AVSÄNDAREN → dubblettskydd → servern sätter id, avsändare och tid. */
  notisAppend(body, perms, me) {
    const n = body && body.notification;
    const rid = body && typeof body.requestId === 'string' ? body.requestId : '';
    const str = (v) => v === undefined || v === null || typeof v === 'string';
    if (!n || typeof n !== 'object' || Array.isArray(n) || !rid || rid.length > 100) return DEFINITE(400, 'invalid_entry');
    if (typeof n.userId !== 'string' || typeof n.type !== 'string' || !str(n.aoId) || !str(n.message)) return DEFINITE(400, 'invalid_entry');
    const mott = n.userId, typ = n.type, aoId = n.aoId || '';
    let msg = String(n.message || '').trim();
    if (!mott || mott.length > 100 || typ.length > 50 || aoId.length > 100) return DEFINITE(400, 'invalid_entry');
    const meId = me && me.id ? String(me.id) : '';
    if (!meId || !T4A.giltig(perms)) return DEFINITE(403, 'forbidden');
    const kat = typ === 'ao_assigned' ? 'tilldelning' : ['service_done', 'service_overdue', 'service_approaching'].includes(typ) ? 'egen' : null;
    if (!kat || (kat === 'tilldelning' && !this.has(effAoPerms(perms), 'ao_edit'))) return REGEL(403, 'forbidden', 'type_not_allowed');
    if (kat === 'tilldelning' && !aoId) return DEFINITE(400, 'invalid_entry');
    if (kat === 'egen' && (!msg || msg.length > 500)) return DEFINITE(400, 'invalid_entry');
    if (!this.notisIdem) this.notisIdem = new Map();
    const ikey = meId + ':' + rid, fp = sha(['notification_append', meId, mott, typ, aoId, msg]);
    const tidigare = this.notisIdem.get(ikey);
    if (tidigare) return tidigare.fp !== fp ? DEFINITE(409, 'idempotency_key_conflict') : { status: 200, body: Object.assign({}, tidigare.res, { replay: true }) };
    const aktiv = (this.get('staff') || []).some((x) => x && x.id === mott && x.active && !['false', '0', ''].includes(String(x.active)));
    if (!aktiv || (kat === 'egen' && mott !== meId)) return REGEL(403, 'forbidden', 'recipient_not_allowed');
    if (aoId) {
      if (!this.t3dRefVisible('workOrderId', aoId, perms, this.t3dRefs(perms, meId))) return REGEL(403, 'forbidden', 'ref_not_visible');
      const ao = (this.get('workOrders') || []).find((a) => a && a.id === aoId);
      if (!ao) return REGEL(403, 'forbidden', 'ref_not_visible');
      if (kat === 'tilldelning') {
        if (!isAssigned(ao, mott)) return REGEL(403, 'forbidden', 'recipient_not_assigned');
        msg = 'Du har tilldelats ' + aoId + ': ' + (String(ao.title || '').trim() || aoId);
      }
    }
    const list = this.get('notifications') || [];
    const dup = list.find((e) => e && e.userId === mott && e.type === typ && String(e.read) !== 'true' && (kat === 'tilldelning' ? String(e.aoId || '') === aoId : String(e.message || '') === msg));
    if (dup) { const res = { ok: true, id: dup.id, duplicate: true }; this.notisIdem.set(ikey, { fp, res }); return { status: 200, body: res }; }
    const now = new Date().toISOString();
    const entry = { id: 'N-' + sha(ikey + '|' + fp).slice(0, 24), userId: mott, type: typ, message: msg, aoId, offerId: '', read: false, createdAt: now, createdBy: meId, source: 'server' };
    list.unshift(entry);
    while (list.length > 5000) {
      let j = 1; for (let k = 2; k < list.length; k++) if (String(list[k].createdAt || '') <= String(list[j].createdAt || '')) j = k;
      list.splice(j, 1);
    }
    this.set('notifications', list); this.touch();
    const res = Object.assign({ ok: true, id: entry.id, duplicate: false, serverSignature: now }, mott === meId ? { notification: entry } : {});
    this.notisIdem.set(ikey, { fp, res });
    return { status: 200, body: res };
  }
  /* T4-A notiser: = RPC notifications_mark_read — bara egna; andras och okända id räknas lika. */
  notisMarkera(body, perms, me) {
    const all = !!body && body.all === true, ids = body && body.ids;
    if (!all && (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some((x) => typeof x !== 'string' || !x || x.length > 100))) return DEFINITE(400, 'invalid_entry');
    const meId = me && me.id ? String(me.id) : '';
    if (!meId || !T4A.giltig(perms)) return DEFINITE(403, 'forbidden');
    const list = this.get('notifications') || [];
    const uniq = all ? [] : [...new Set(ids)];
    const egen = (e) => e && typeof e === 'object' && typeof e.userId === 'string' && e.userId === meId;
    const now = new Date().toISOString();
    let marked = 0;
    const ny = list.map((e) => { if (egen(e) && String(e.read) !== 'true' && (all || uniq.includes(e.id))) { marked++; return Object.assign({}, e, { read: true, readAt: now }); } return e; });
    const ignored = uniq.filter((i) => !list.some((e) => egen(e) && e.id === i)).length;
    if (marked) { this.set('notifications', ny); this.touch(); }
    return { status: 200, body: Object.assign({ ok: true, marked, ignored }, marked ? { serverSignature: now } : {}) };
  }
  /* T3-D: _vift_ref_visible (appendActivity, D-22). */
  t3dRefVisible(field, refId, perms, r) {
    const p = Array.isArray(perms) ? perms : [];
    if (p.includes('all')) return true;
    const kp = edgeModules().keyPerms;
    switch (field) {
      case 'workOrderId': return p.includes('ao_view_all') || r.ao.includes(refId);
      case 'customerId': return anyOf(p, T3D_KUND_LAS) || r.customers.includes(refId);
      case 'propertyId': return anyOf(p, T3D_KUND_LAS) || r.properties.includes(refId);
      case 'offerId': return anyOf(p, ['offer_manage'].concat(T3D_OFFER_INTERN)) || r.offers.includes(refId);
      case 'invoiceId': return t3dFull('vift_invoices', p, kp);
      case 'salesOpportunityId': return t3dFull('vift_salesOpps', p, kp);
      case 'inspectionId': return t3dFull('vift_inspections', p, kp);
      case 'ronderingId': return t3dFull('vift_ronderingar', p, kp) || (r.ronderingar || []).includes(refId); // T4-D
      case 'deviationId': return t3dFull('vift_avvikelser', p, kp);
      default: return false;
    }
  }
  /* T4-A: AO i ett skrivsvar projiceras som en läsning (ao-time-write, log/checklist-EF:erna, invoice-write). */
  _t4aAoSvar(res, perms, me) {
    if (res && res.body && typeof res.body === 'object' && res.body.workOrder && typeof res.body.workOrder === 'object') {
      res = Object.assign({}, res, { body: Object.assign({}, res.body, { workOrder: T4B.projectWorkOrder(clone(res.body.workOrder), perms) }) });
    }
    /* T4-B: materialraden och tidposten i svaret projiceras som en läsning (pris/timpris bara med prisläsrätt). */
    if (res && res.body && typeof res.body === 'object' && res.body.row && typeof res.body.row === 'object') {
      res = Object.assign({}, res, { body: Object.assign({}, res.body, { row: T4B.projectWorkOrder({ materials: [clone(res.body.row)] }, perms).materials[0] }) });
    }
    for (const f of ['timeEntry', 'entry']) {
      if (res && res.body && typeof res.body === 'object' && res.body[f] && typeof res.body[f] === 'object') {
        res = Object.assign({}, res, { body: Object.assign({}, res.body, { [f]: T4B.projectTimeEntry(clone(res.body[f]), perms, me && me.id) }) });
      }
    }
    return res;
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
    const call = { t: Date.now(), method, path: p, action, user: session ? session.email : null, key: body && body.key, aoId: body && body.aoId, hasLog: !!(body && body.patch && body.patch.log) };
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
        /* T3-C (D-21): vift_staff bara för staff_manage/admin_manage, vift_roles bara för admin_manage (RLS store_read_by_role). */
        const rp = this.permsFor(session.email);
        /* T3-D: även aktivitetslogg, uppgifter, offerter, kunder, fastigheter, objekt och kontakter
           döljs för roller utan full åtkomst (store_read_by_role → vift_store_full_access). */
        /* T4-A notiser: vift_notifications läses aldrig via REST (vift_store_full_access falskt för alla). */
        const restHidden = (k) => LOCKED.includes(k) || k === 'vift_notifications' || (T3D_KEYS.includes(k) && !t3dFull(k, rp, edgeModules().keyPerms));
        if (key) return { status: 200, body: restHidden(key) || !this.store.has(key) ? [] : [{ value: clone(this.store.get(key)) }] };
        return { status: 200, body: [...this.store.entries()].filter(([k]) => !restHidden(k)).map(([k, v]) => ({ key: k, value: clone(v) })) };
      }
      /* Direkt skrivning (Storage.setRemoteStrict m.fl.). T3-C (F18) + T4-A notiser (punkt 275):
         vitlistan är tom — all direkt skrivning, även vift_notifications och vift_lastChanged som
         v3.4/T3/T4-A-klientens persistNotifs skickar, nekas med 42501 direct_write_blocked
         (vift-v2 20261128000005 + 20261128000010). */
      if (method === 'DELETE') return directBlocked((u.searchParams.get('key') || '').replace(/^eq\./, ''));
      const rows = Array.isArray(body) ? body : [body];
      const blocked = rows.filter((r) => !r || !REST_ALLOW.includes(r.key));
      if (blocked.length) return directBlocked(blocked.map((r) => r && r.key).join(','));
      rows.forEach((r) => {
        if (r.key === 'vift_lastChanged') this.touch();
        else this.store.set(r.key, clone(r.value));
      });
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
        case 'ao-time-write': return this._t4aAoSvar(this.aoTimeWrite(body, perms, me, { email }), perms, me);
        case 'work-orders-list': {
          // T3-B: poolregel + poolprojektion (K-03); T4-A: projectWorkOrder (portkod bara med objects_sensitive,
          // även för ao_edit; inköpspris bara med cost_view; AO-ekonomi inte till fältroller, D-06).
          const full = this.has(perms, 'ao_view_all');
          const list = (this.get('workOrders') || []).filter((a) => this.canViewAO(a, perms, me.id))
            .map((a) => (!full && !isAssigned(a, me.id) && isOpenPool(a) ? poolProjection(a) : a))
            .map((a) => T4B.projectWorkOrder(a, perms)); // T4-B: även materialradernas försäljningspris (D-09)
          return { status: 200, body: { workOrders: list } };
        }
        case 'time-entries-list': {
          const all = this.get('timeEntries') || [];
          /* T4-B (K-01, D-08, D-11): time_view_all = all personals tid utan löneuppgifter; timpris bara med prisläsrätt. */
          const allaTid = this.has(perms, 'payroll_view') || this.has(perms, 'time_view_all');
          return { status: 200, body: { timeEntries: (allaTid ? all : all.filter((t) => t.staffId === me.id)).map((t) => T4B.projectTimeEntry(t, perms, me.id)) } };
        }
        case 'invoice-write': return this._t4aAoSvar(this.invoiceWrite(body, perms, me), perms);
        case 'rondering-pass-write': return this.ronderingWrite(body, perms, me);
        case 'work-order-checklist-resolve': return this._t4aAoSvar(this.checklistResolve(body, perms, me), perms);
        case 'work-order-log-write': return this._t4aAoSvar(this.logWrite(body, perms, me), perms);
        case 'work-order-image-upload': return this.imageUpload(body, perms, me, headers);
        case 'work-order-image-url': return this.imageUrl(body, perms, me);
        case 'work-order-image-delete': return this.imageDelete(body, perms, me);
        // STAGING-only testverktyg (supabase/staging-only/functions/e2e-test-cleanup), modellerat
        // så att e2e-real.js städsteg kan provas lokalt. Finns aldrig i LIVE.
        case 'e2e-test-cleanup': return this.e2eTestCleanup(body, perms);
        case 'get-sensitive-fields': {
          /* T4-C: sensitive_fields_read — objects_sensitive, eller objects_access_assigned på egen
             tilldelad aktiv AO (och pass när rondering_utfor är verkställd); varje uttag en revisionsrad. */
          const a = T4C.atkomst(body, perms, me && me.id, this.get('workOrders') || [], this.get('ronderingspass') || [], T3E_EJ_VERKSTALLDA);
          if (a.status === 400) return DEFINITE(400, 'missing_fields');
          const mal = { objectId: a.objId, propertyId: a.objId ? null : a.propId };
          if (!a.ok) {
            this.sensitiveAudit.push(Object.assign({ status: 'denied', staffId: me && me.id, fields: [], detail: a.reason }, mal));
            return a.reason === 'not_assigned' ? REGEL(403, 'forbidden', 'not_assigned') : DEFINITE(403, 'forbidden');
          }
          const ut = T4C.svar(this.sensitive.get(a.objId || a.propId) || {}, a.via);
          this.sensitiveAudit.push(Object.assign({ status: 'allowed', staffId: me && me.id, fields: T4C.FALT.filter((f) => ut[f]), detail: a.via }, mal));
          return { status: 200, body: ut };
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
    if (k === 'staff') return this.has(perms, 'staff_manage'); // T3-C: som servern (KEY_PERMISSIONS), admin_manage räcker inte
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
          data[fk.replace(/^vift_/, '')] = this.t3dProject(fk, v, perms, me); hashes[fk] = sha(v);
        });
        return { status: 200, body: { data, hashes } };
      }
      case 'readWithHash': {
        if (READ_LOCKED.includes(body.key)) return DEFINITE(403, 'forbidden');
        const v = clone(this.store.get(body.key)); return { status: 200, body: { value: this.t3dProject(body.key, v, perms, me), hash: sha(v) } };
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
        /* T4-A: konfliktsvaret lämnar bara ut den projicerade bilden (som en läsning). */
        if (body.expectedHash != null && body.expectedHash !== sha(cur)) return { status: 409, body: { error: 'conflict', current: this.t3dProject(body.key, clone(cur), perms, me), hash: sha(cur) } };
        /* T4-A (B5, D-13, D-17, D-01): fältvis sammanslagning av skyddade fält (som store_business_key_write). */
        let value = clone(body.value);
        if (T4A.falt(body.key).length) {
          const r = value && typeof value === 'object' && !Array.isArray(value) ? T4A.sammanfoga(body.key, clone(cur), value, perms) : T4A.sammanfogaLista(body.key, clone(cur), value, perms);
          if (!r.ok) return REGEL(403, 'forbidden', r.reason);
          value = r.value;
        }
        if (body.key === 'vift_roles' && Array.isArray(value)) value = value.map((n) => T4A.rollerBevara(regGet(cur, n && n.id), n, body.klient));
        {
          const s0 = this.get('staff'), r0 = this.get('roles');
          const deny = t3cAuthzCheck(body.key, s0, r0, body.key === 'vift_staff' ? value : s0, body.key === 'vift_roles' ? value : r0, me && me.id, this.users);
          if (deny) return deny;
        }
        this._t4cRadering(body.key, cur, value, me);
        this.store.set(body.key, clone(value)); this.touch();
        return { status: 200, body: { ok: true, hash: sha(value), current: this.t3dProject(body.key, clone(value), perms, me) } };
      }
      case 'appendNotification': return this.notisAppend(body, perms, me);
      case 'markNotificationsRead': return this.notisMarkera(body, perms, me);
      case 'appendActivity': {
        if (!this.opts.activityAppend) return DEFINITE(400, 'unknown_action');
        const built = edgeModules().activityLog.buildActivityEntry(body.entry, me.id, new Date().toISOString());
        if (!built.ok) return DEFINITE(400, built.error);
        /* T3-D (D-22): typen per behörighet och referenserna mot det anroparen får se. */
        if (!edgeModules().activityLog.typeAllowed(built.entry.type, perms)) return REGEL(403, 'forbidden', 'type_not_allowed');
        {
          const r = this.t3dRefs(perms, me.id);
          for (const f of edgeModules().activityLog.REF_FIELDS) {
            if (built.entry[f] && !this.t3dRefVisible(f, String(built.entry[f]), perms, r)) return REGEL(403, 'forbidden', 'ref_not_visible');
          }
        }
        const log = this.get('activityLog') || [];
        if (!log.some((e) => e && e.id === built.entry.id)) { log.unshift(built.entry); this.set('activityLog', log.slice(0, 500)); this.touch(); }
        return { status: 200, body: { ok: true, id: built.entry.id } };
      }
      case 'writeMerge': {
        if (!this.isBusinessKey(body.key)) return DEFINITE(403, 'key_not_allowed');
        if (this.opts.activityAppend && body.key === 'vift_activityLog') return DEFINITE(403, 'append_only');
        const pol = this.opts.activitiesPolicy && body.key === 'vift_activities'
          ? edgeModules().policy.activitiesWriteAllowed(body.upserts || [], body.removals || [], perms.includes('all') ? ['all'] : perms, me.id) : null;
        const policyOk = !!(pol && pol.ok);
        if (!policyOk && !this.canWriteKey(body.key, perms)) {
          /* T3-D (D-15): orsaken enligt felkodskatalogen (not_own, field_<fält> …). */
          const reason = pol ? edgeModules().policy.activitiesRefusal(pol.reason) : null;
          return reason ? REGEL(403, 'forbidden', reason) : DEFINITE(403, 'forbidden');
        }
        /* T4-A (D-17): vift_settings fält för fält (som store_business_key_merge_write). */
        if (body.key === 'vift_settings') {
          let cur = clone(this.store.get(body.key)) || {};
          const vy = T4A.proj(body.key, cur, perms);
          const conflicts = [];
          for (const u of (body.upserts || [])) {
            if (!u || !u.id || u.data === undefined) return DEFINITE(400, 'invalid_element');
            if (!T4A.lika(u.previous === undefined ? null : u.previous, vy[u.id] === undefined ? null : vy[u.id])) { conflicts.push({ id: u.id, reason: 'changed_by_other_session' }); continue; }
            const r = T4A.sammanfoga(body.key, cur, Object.assign({}, T4A.proj(body.key, cur, perms), { [u.id]: u.data }), perms);
            if (!r.ok) return REGEL(403, 'forbidden', r.reason);
            cur = r.value;
          }
          for (const rm of (body.removals || [])) {
            if (!rm || !rm.id) return DEFINITE(400, 'invalid_element');
            if (!(rm.id in cur)) continue;
            if (!T4A.lika(rm.previous === undefined ? null : rm.previous, vy[rm.id] === undefined ? null : vy[rm.id])) { conflicts.push({ id: rm.id, reason: 'changed_by_other_session' }); continue; }
            if (!T4A.kanSkriva(body.key, rm.id, cur, perms)) return REGEL(403, 'forbidden', 'field_protected');
            delete cur[rm.id];
          }
          this.store.set(body.key, cur); this.touch();
          return { status: 200, body: { current: this.t3dProject(body.key, clone(cur), perms, me), conflicts, hash: sha(cur) } };
        }
        const arr = clone(this.store.get(body.key)) || [];
        const ids = arr.map((e) => e && e.id).filter((x) => x != null);
        if (new Set(ids).size !== ids.length) return DEFINITE(409, 'duplicate_id_in_store');
        const conflicts = [];
        const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
        /* T4-A: previous jämförs med elementet så som anroparen får se det; skyddade fält sammanfogas. */
        const skyddad = T4A.falt(body.key).length > 0;
        const vy = (e) => (skyddad && e ? T4A.proj(body.key, e, perms) : e);
        let avslag = null;
        (body.upserts || []).forEach((u) => {
          if (avslag) return;
          const i = arr.findIndex((e) => e && String(e.id) === String(u.id));
          const cur = i >= 0 ? arr[i] : null;
          if (!(cur ? T4A.lika(vy(cur), u.previous) : same(cur, u.previous))) { conflicts.push({ id: u.id, current: clone(cur) }); return; }
          let data = clone(u.data);
          if (skyddad) { const r = T4A.sammanfoga(body.key, cur, data, perms); if (!r.ok) { avslag = r.reason; return; } data = r.value; }
          if (body.key === 'vift_roles' && cur) data = T4A.rollerBevara(cur, data, body.klient);
          if (i >= 0) arr[i] = data; else arr.push(data);
        });
        if (avslag) return REGEL(403, 'forbidden', avslag);
        (body.removals || []).forEach((r) => {
          const i = arr.findIndex((e) => e && String(e.id) === String(r.id));
          if (i < 0) return;
          if (!T4A.lika(vy(arr[i]), r.previous)) { conflicts.push({ id: r.id, current: clone(arr[i]) }); return; }
          arr.splice(i, 1);
        });
        {
          const s0 = this.get('staff'), r0 = this.get('roles');
          const deny = t3cAuthzCheck(body.key, s0, r0, body.key === 'vift_staff' ? arr : s0, body.key === 'vift_roles' ? arr : r0, me && me.id, this.users);
          if (deny) return deny;
        }
        this._t4cRadering(body.key, this.store.get(body.key), arr, me);
        this.store.set(body.key, arr); this.touch();
        /* T3-D: svaret projiceras som en läsning; en konflikt mot en post som anroparen inte får se
           lämnar inte ut serverns värde. */
        const synliga = this.t3dProject(body.key, clone(arr), perms, me);
        const synligaId = new Map((Array.isArray(synliga) ? synliga : []).filter((e) => e && e.id != null).map((e) => [String(e.id), e]));
        const konf = conflicts.map((c) => (c.current == null ? c : Object.assign({}, c, { current: synligaId.has(String(c.id)) ? synligaId.get(String(c.id)) : null })));
        return { status: 200, body: { current: synliga, conflicts: konf, hash: sha(arr) } };
      }
      case 'getStampStatus': {
        const s = this.stamp.get(email);
        return { status: 200, body: s ? { hasRow: true, active: s.active, ts: s.ts, aoId: s.aoId, revision: s.revision } : { hasRow: false, active: false, ts: null, aoId: null, revision: 0 } };
      }
      case 'setStampStatus': {
        if (!this.has(perms, 'ao_time')) return DEFINITE(403, 'forbidden');
        const s = this.stamp.get(email) || { active: false, ts: null, aoId: null, revision: 0 };
        if (body.expectedRevision !== s.revision) return { status: 200, body: { stale: true, active: s.active, ts: s.ts, aoId: s.aoId, revision: s.revision } };
        // T3-B (AP-B, F23): instämpling med aoId kräver tilldelning (eller ao_edit) och olåst AO.
        if (body.active && body.aoId) {
          const ao = (this.get('workOrders') || []).find((a) => a.id === body.aoId);
          if (!ao) return DEFINITE(404, 'not_found');
          if (!(isAssigned(ao, me && me.id) || this.has(effAoPerms(perms), 'ao_edit'))) return REGEL(403, 'forbidden', 'not_assigned');
          if (T4B.tidLast(ao)) return REGEL(409, 'ao_locked'); // T4-B: instämpling låst även på klar AO
        }
        const n = { active: !!body.active, ts: body.active ? body.ts : null, aoId: body.active ? (body.aoId || null) : null, revision: s.revision + 1 };
        this.stamp.set(email, n);
        return { status: 200, body: n };
      }
      default: return DEFINITE(400, 'unknown_action');
    }
  }

  /* ── ao-time-write (efter vift-v2 supabase/functions/ao-time-write + T3-B-RPC:erna) ──
     T3-B: idempotens för patch_ao, take_from_pool och create_time är bunden till aktör och
     innehåll (samma nyckel + annat innehåll eller annan aktör → 409 idempotency_key_conflict,
     som work_order_patch/_vift_idem_lookup). Övriga åtgärder återspelas per användare. */
  aoTimeWrite(body, perms, me, ctx) {
    if (body.action === '__probe__') return DEFINITE(400, 'unknown_action');
    const key = body.idempotencyKey;
    const BUNDEN = ['patch_ao', 'take_from_pool', 'create_time', 'add_material', 'update_material', 'remove_material', 'correct_time'];
    if (key && BUNDEN.includes(body.action)) {
      const rest = Object.assign({}, body); delete rest.idempotencyKey;
      const fp = JSON.stringify([body.action, me.id, rest]);
      const g = this.idemG.get(body.action + '|' + key);
      if (g) return g.fp === fp ? clone(g.res) : DEFINITE(409, 'idempotency_key_conflict');
      const res = this._aoTime(body, perms, me, ctx || {});
      if (res.status === 200) this.idemG.set(body.action + '|' + key, { fp, res: clone(res) });
      return res;
    }
    if (key && this.idem.has(me.id + '|' + key)) return clone(this.idem.get(me.id + '|' + key));
    const res = this._aoTime(body, perms, me, ctx || {});
    if (key && res.status === 200) this.idem.set(me.id + '|' + key, clone(res));
    return res;
  }
  /* Tagning ur öppen pool (work_order_pool_take/_vift_ao_take). Returnerar AO eller ett avslag. */
  _take(ao, me, entryId) {
    if (isTrue(ao.deleted) || isTrue(ao.archived)) return REGEL(403, 'forbidden', 'pool_not_open');
    if (aoStaffOf(ao).length > 0) return REGEL(409, 'already_assigned');
    if (!isOpenPool(ao)) return REGEL(403, 'forbidden', 'pool_not_open');
    const name = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.id;
    const log = Array.isArray(ao.log) ? ao.log : [];
    const id = entryId && !log.some((l) => l.id === entryId) ? entryId : 'L-TAKE-' + crypto.randomBytes(6).toString('hex');
    const t = nowText();
    Object.assign(ao, { staff: [me.id], poolOpen: false, status: 'planerad', updatedAt: t,
      log: log.concat([{ id, type: 'taken_from_pool', text: name + ' tog jobbet från arbetspoolen', userName: name, staffId: me.id, timestamp: t }]) });
    return null;
  }
  /* Fältets materialrader (_vift_ao_material_merge): bara egna rader får ändras/tas bort. */
  _materialMerge(old, neu, meId) {
    old = Array.isArray(old) ? old : []; neu = Array.isArray(neu) ? neu : [];
    const same = (a, b) => jsonEq(a, b); // T4-A: som jsonb-jämförelsen (nyckelordning spelar ingen roll)
    for (const o of old) {
      if (o && o.addedBy === meId) continue;
      if (o && o.id) { const n = neu.find((x) => x && x.id === o.id); if (!n || !same(n, o)) return null; }
      else if (!neu.some((x) => same(x, o))) return null;
    }
    const oldIds = old.filter((o) => o && o.id).map((o) => o.id);
    return neu.map((n) => ((n && n.id && oldIds.includes(n.id)) || (!(n && n.id) && old.some((x) => same(x, n))) ? n : Object.assign({}, n, { addedBy: meId, addedAt: nowText() })));
  }
  /* T4-B: regelfel ur t4b-regler.js (kastade { t4b: [status, error, reason] }) blir svar. */
  _aoTime(b, perms, me, ctx) {
    try { return this._aoTimeInner(b, perms, me, ctx); } catch (e) { if (e && e.t4b) return REGEL(e.t4b[0], e.t4b[1], e.t4b[2]); throw e; }
  }
  _aoTimeInner(b, perms, me, ctx) {
    const aos = this.get('workOrders') || [];
    const tes = this.get('timeEntries') || [];
    const now = new Date().toISOString();
    const save = () => { this.set('workOrders', aos); this.set('timeEntries', tes); this.touch(); };
    const eff = effAoPerms(perms);
    switch (b.action) {
      case 'create_ao': {
        if (!this.has(perms, 'ao_create')) return DEFINITE(403, 'forbidden');
        const ao = clone(b.ao);
        /* T4-A: portkod kräver objects_sensitive; inköpspris i nya rader utan cost_edit ignoreras. */
        if (!this.has(perms, 'objects_sensitive') && T4A.SENS.some((f) => !T4A.tom(ao[f]))) return REGEL(403, 'forbidden', 'field_protected');
        const ignoredCreate = [];
        if (!(this.has(perms, 'cost_view') && this.has(perms, 'cost_edit')) && Array.isArray(ao.materials)) {
          ao.materials = ao.materials.map((m) => { if (m && typeof m === 'object' && !T4A.tom(m.buyPrice)) { m = Object.assign({}, m); delete m.buyPrice; if (!ignoredCreate.length) ignoredCreate.push('materials[].buyPrice'); } return m; });
        }
        /* T4-B (D-09, D-10): försäljningspris i nya rader bara från en roll som får sätta pris och > 0; annars okänt. */
        if (Array.isArray(ao.materials)) {
          const satta = T4B.prisSatta(perms);
          ao.materials = ao.materials.map((m) => {
            if (!m || typeof m !== 'object' || Array.isArray(m)) return m;
            const r = Object.assign({}, m); const sp = Number(r.sellPrice); const given = !T4A.tom(r.sellPrice) && r.sellPrice !== undefined;
            if (satta && given && Number.isFinite(sp) && sp > 0) { r.sellPrice = sp; r.sellPriceUnknown = false; if (!r.priceSource) r.priceSource = 'manual'; }
            else { if (given && !ignoredCreate.includes('materials[].sellPrice')) ignoredCreate.push('materials[].sellPrice'); r.sellPrice = null; r.sellPriceUnknown = true; r.priceSource = 'unknown'; }
            if (T4A.tom(r.buyPrice) || r.buyPrice === undefined || !(Number(r.buyPrice) > 0)) { delete r.buyPrice; r.buyPriceUnknown = true; }
            return r;
          });
        }
        if (ao.id && aos.some((a) => a.id === ao.id)) return DEFINITE(409, 'id_collision');
        if (!ao.id) ao.id = 'AO-' + (++this.aoSeq);
        // T3-B punkt 245: nästa nummer = max(befintliga AO-nummer) + 1, aldrig avkortat.
        const nums = aos.flatMap((a) => [a.displayNumber, a.id]).map((x) => /^AO-(\d{1,18})$/.exec(String(x || ''))).filter(Boolean).map((m) => Number(m[1]));
        let n = Math.max(this.aoSeq, nums.length ? Math.max(...nums) : 0) + 1;
        const fmt = (k) => 'AO-' + (String(k).length >= 3 ? String(k) : String(k).padStart(3, '0'));
        while (aos.some((a) => a.displayNumber === fmt(n) || a.id === fmt(n))) n++;
        this.aoSeq = n; ao.displayNumber = fmt(n);
        if (ao.status === 'pool' && aoStaffOf(ao).length > 0) ao.poolOpen = false;
        ao.createdAt = now; ao.updatedAt = now; aos.push(ao); save();
        return { status: 200, body: Object.assign({ workOrder: ao }, ignoredCreate.length ? { ignoredFields: ignoredCreate } : {}) };
      }
      case 'patch_ao': {
        if (!['ao_edit', 'ao_complete', 'ao_material', 'ao_start_own', 'ao_complete_own', 'ao_pool_take'].some((x) => this.has(eff, x))) return DEFINITE(403, 'forbidden');
        if (!b.aoId || !b.patch || typeof b.patch !== 'object' || Array.isArray(b.patch)) return DEFINITE(400, 'missing_fields');
        const i = aos.findIndex((a) => a.id === b.aoId);
        if (i < 0) return DEFINITE(404, 'not_found');
        const ao = aos[i];
        if (b.expectedUpdatedAt && ao.updatedAt && b.expectedUpdatedAt !== ao.updatedAt) return DEFINITE(409, 'stale_write');
        let pt = clone(b.patch); ['id', 'createdAt', 'updatedAt', 'deleted', 'deletedAt'].forEach((k) => delete pt[k]);
        const keys = Object.keys(pt);
        const only = (arr) => keys.every((k) => arr.includes(k));
        let ignored = [];
        /* T4-A (B5, B1): skyddade fält prövas efter behörighetskontrollen i grenen (work_order_patch). */
        const t4 = () => { const r = T4A.aoPatch(ao, pt, perms); if (r.ok) { pt = r.patch; ignored = ignored.concat(r.ignored); } return r; };
        if (this.has(eff, 'ao_edit')) {
          if (billingTouched(ao, pt)) return REGEL(403, 'forbidden', 'invoice_path_required');
          { const r = t4(); if (!r.ok) return REGEL(403, 'forbidden', r.reason); }
          /* T4-B: hela materiallistan — serverpris för nya rader, skyddade fält, fakturerade källrader låsta. */
          if ('materials' in pt) {
            const r = T4B.materialLista(ao, pt.materials, perms, me.id, now, this.get('invoices') || [], (k) => this.get(k.replace(/^vift_/, '')));
            pt.materials = r.rows; ignored = ignored.concat(r.ignored);
          }
          const hadStaff = aoStaffOf(ao).length > 0;
          Object.assign(ao, pt);
          if ('staff' in pt && !('poolOpen' in pt) && ao.status === 'pool' && aoStaffOf(ao).length > 0 && !hadStaff) ao.poolOpen = false;
        } else if (keys.length === 1 && keys[0] === 'materials') {
          /* T4-B (D-19, SEC-B1-06): fältet skriver aldrig hela listan — radvisa åtgärder. */
          if (!this.has(eff, 'ao_material')) return DEFINITE(403, 'forbidden');
          return REGEL(403, 'forbidden', 'row_path_required');
        } else if (pt.status === 'pågående' && only(['status'])) {
          if (!this.has(eff, 'ao_start_own')) return DEFINITE(403, 'forbidden');
          if (!isAssigned(ao, me.id)) return REGEL(403, 'forbidden', 'not_assigned');
          if (isLockedAO(ao)) return REGEL(409, 'ao_locked');
          if (!['nytt', 'planerad', 'pool'].includes(ao.status)) return REGEL(409, 'invalid_source_status');
          Object.assign(ao, { status: 'pågående', startedAt: ao.startedAt || now, startedBy: ao.startedBy || me.id });
        } else if (pt.status === 'klar' && only(['status', 'completedAt', 'completedBy'])) {
          if (this.has(eff, 'ao_complete') && this.has(eff, 'ao_view_all')) { /* valfri synlig */ }
          else if (this.has(eff, 'ao_complete_own')) { if (!isAssigned(ao, me.id)) return REGEL(403, 'forbidden', 'not_assigned'); }
          else return DEFINITE(403, 'forbidden');
          if (isLockedAO(ao)) return REGEL(409, 'ao_locked');
          if (!['nytt', 'planerad', 'pool', 'pågående'].includes(ao.status)) return REGEL(409, 'invalid_source_status');
          ignored = ignored.concat(['completedAt', 'completedBy'].filter((k) => k in pt));
          Object.assign(ao, { status: 'klar', completedAt: now, completedBy: me.id });
        } else if (pt.status === 'planerad' && 'staff' in pt && only(['staff', 'status', 'log'])) {
          // "Ta jobbet" i v3.4-klientens form: samma atomiska regel som take_from_pool.
          if (!this.has(eff, 'ao_pool_take')) return DEFINITE(403, 'forbidden');
          const exp = aoStaffOf(ao).concat([me.id]);
          if (JSON.stringify((pt.staff || []).map(String)) !== JSON.stringify(exp)) return aoStaffOf(ao).length ? REGEL(409, 'already_assigned') : REGEL(403, 'forbidden', 'field_not_allowed');
          const oldIds = (ao.log || []).map((l) => l.id);
          const added = (Array.isArray(pt.log) ? pt.log : []).find((l) => l && l.type === 'taken_from_pool' && !oldIds.includes(l.id));
          const rej = this._take(ao, me, added && added.id); if (rej) return rej;
        } else {
          return REGEL(403, 'forbidden', 'field_not_allowed');
        }
        ao.updatedAt = now; save();
        return { status: 200, body: Object.assign({ workOrder: ao }, ignored.length ? { ignoredFields: ignored } : {}) };
      }
      case 'take_from_pool': {
        if (!(this.has(eff, 'ao_pool_take') || this.has(eff, 'ao_edit')) || !(this.has(eff, 'ao_view_own') || this.has(eff, 'ao_view_all'))) return DEFINITE(403, 'forbidden');
        if (!b.aoId) return DEFINITE(400, 'missing_fields');
        const ao = aos.find((a) => a.id === b.aoId);
        if (!ao) return DEFINITE(404, 'not_found');
        const rej = this._take(ao, me, typeof b.entryId === 'string' ? b.entryId : ''); if (rej) return rej;
        save();
        const ignored = Object.keys(b).filter((k) => !['action', 'aoId', 'idempotencyKey', 'entryId'].includes(k));
        return { status: 200, body: Object.assign({ action: 'take_from_pool', workOrder: ao, takenBy: me.id }, ignored.length ? { ignoredFields: ignored } : {}) };
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
        const e = clone(b.entry || {});
        ['attested', 'attestedAt', 'attestedBy'].forEach((k) => delete e[k]);
        const forOther = e.staffId && e.staffId !== me.id;
        if (forOther ? !this.has(perms, 'payroll_manage') : !(this.has(perms, 'ao_time') || this.has(perms, 'payroll_manage'))) return DEFINITE(403, 'forbidden');
        if (!forOther) e.staffId = me.id;
        // T3-B (AP-B): tilldelning, låst AO och legitim utstämpling (time_entry_create).
        let ao = null;
        if (e.aoId) {
          ao = aos.find((a) => a.id === e.aoId) || null;
          const st = this.stamp.get(ctx.email || '');
          const stampOk = !forOther && st && st.active && st.aoId === e.aoId && Number(st.ts) === Number(e.startTs);
          if (!stampOk) {
            if (!ao) return DEFINITE(404, 'not_found');
            if (!(forOther || isAssigned(ao, me.id) || this.has(perms, 'ao_edit'))) return REGEL(403, 'forbidden', 'not_assigned');
            if (T4B.tidLast(ao)) return REGEL(409, 'ao_locked'); // T4-B: låst även på klar AO
          }
          var t4bStampOk = stampOk; // eslint-disable-line no-var
        }
        if (tes.some((t) => t.id === e.id)) return DEFINITE(409, 'id_collision');
        // D-11 (T4-B): timpriset från en TILLÅTEN prisgrupp; okänt (null) utan grupp, aldrig 0.
        const get = (k) => this.get(k.replace(/^vift_/, ''));
        const ctxP = { customerId: ao && ao.customerId, propertyId: ao && ao.propertyId, contractId: ao && ao.contractId, date: e.date };
        const ignored = [];
        let pg = null;
        if (e.priceGroupId) {
          pg = T4B.pris('priceGroup', e.priceGroupId, ctxP, get);
          const kontor = forOther || T4B.kontor(effAoPerms(perms));
          if (!pg || (!kontor && (pg.active === false || (ao && ao.priceGroupId && ao.priceGroupId !== e.priceGroupId)))) {
            if (!(typeof t4bStampOk !== 'undefined' && t4bStampOk)) return REGEL(403, 'forbidden', 'price_group_not_allowed');
            ignored.push('priceGroupId');
            pg = ao && ao.priceGroupId ? T4B.pris('priceGroup', ao.priceGroupId, ctxP, get) : null;
            e.priceGroupId = pg ? pg.ref : '';
          }
        }
        const rate = pg && pg.priceKnown ? pg.unitPrice : null;
        if ('hourRate' in e && T4B.tal(e.hourRate) !== rate) ignored.push('hourRate');
        delete e.hourRateUnknown; e.hourRate = rate; e.hourRateUnknown = rate === null;
        if (pg) { if ('priceGroupName' in e && e.priceGroupName !== (pg.name || '')) ignored.push('priceGroupName'); e.priceGroupName = pg.name || ''; }
        else if (e.priceGroupName) { ignored.push('priceGroupName'); e.priceGroupName = ''; }
        e.createdAt = now;
        tes.unshift(e);
        if (ao && !(ao.timeEntries || []).includes(e.id)) ao.timeEntries = (ao.timeEntries || []).concat([e.id]);
        save();
        return { status: 200, body: Object.assign({ timeEntry: e, entry: e }, ignored.length ? { ignoredFields: ignored } : {}) };
      }
      case 'patch_time': case 'delete_time': {
        const i = tes.findIndex((t) => t.id === b.entryId);
        if (i < 0) return DEFINITE(404, 'not_found');
        const own = tes[i].staffId === me.id;
        const pt = clone(b.patch || {});
        const ignored = [];
        /* T4-B: fältets prisgruppsbyte prövas i EF:en (aktiv grupp, AO:ns grupp) före RPC:n. */
        if (b.action === 'patch_time' && !(this.has(perms, 'payroll_manage') || this.has(perms, 'invoice_create') || this.has(perms, 'ao_edit'))) {
          ['hourRate', 'priceGroupName'].forEach((k) => { if (k in pt) { ignored.push(k); delete pt[k]; } });
          if (pt.priceGroupId) {
            const pg = (this.get('priceGroups') || []).find((x) => x.id === pt.priceGroupId);
            const aoT = aos.find((a) => a.id === (pt.aoId || tes[i].aoId));
            if (!pg || ['false', '0'].includes(String(pg.active)) || (aoT && aoT.priceGroupId && aoT.priceGroupId !== pt.priceGroupId)) return REGEL(403, 'forbidden', 'price_group_not_allowed');
            const r = T4B.tal(pg.hourRate); pt.hourRate = r !== null && r >= 0 ? r : null; pt.hourRateUnknown = pt.hourRate === null; pt.priceGroupName = pg.name || '';
          }
        }
        if (!(this.has(perms, 'payroll_manage') || (own && this.has(perms, 'ao_time')))) return DEFINITE(403, 'forbidden');
        if (tes[i].attested && !this.has(perms, 'all')) return DEFINITE(409, 'attested_locked');
        /* T4-B: fakturerad tidpost låst; tid på klar eller låst AO bara via correct_time. */
        if (T4B.kallaStatus(this.get('invoices') || [], 'time:' + tes[i].id).status !== 'ofakturerad') return REGEL(409, 'invoiced_locked');
        const curAo = tes[i].aoId ? aos.find((a) => a.id === tes[i].aoId) : null;
        if (curAo && T4B.tidLast(curAo)) return REGEL(409, 'ao_locked');
        if (b.action === 'delete_time') { tes.splice(i, 1); save(); return { status: 200, body: { ok: true } }; }
        if (pt.aoId && pt.aoId !== tes[i].aoId) {
          const nyAo = aos.find((a) => a.id === pt.aoId);
          if (!nyAo) return DEFINITE(404, 'not_found');
          if (!this.has(perms, 'payroll_manage') && !isAssigned(nyAo, me.id)) return REGEL(403, 'forbidden', 'not_assigned');
          if (T4B.tidLast(nyAo)) return REGEL(409, 'ao_locked');
        }
        Object.assign(tes[i], pt); tes[i].updatedAt = now;
        save(); return { status: 200, body: Object.assign({ ok: true, timeEntry: tes[i] }, ignored.length ? { ignoredFields: ignored } : {}) };
      }
      case 'attest_time': {
        if (!this.has(perms, 'payroll_manage')) return DEFINITE(403, 'forbidden');
        const t = tes.find((x) => x.id === b.entryId); if (!t) return DEFINITE(404, 'not_found');
        t.attested = !!b.attested; t.attestedAt = b.attested ? now : ''; t.attestedBy = b.attested ? me.id : '';
        save(); return { status: 200, body: { action: 'attest_time', timeEntry: t } }; // som riktiga ao-time-write (time_entry_set_attested → { timeEntry, serverSignature })
      }
      /* T4-B (D-19, R13–R15): radvisa materialåtgärder (work_order_material_add/update/remove). */
      case 'add_material': case 'update_material': case 'remove_material': {
        if (!this.has(eff, 'ao_material') && !this.has(eff, 'ao_edit')) return DEFINITE(403, 'forbidden');
        const invs = this.get('invoices') || [];
        const get = (k) => this.get(k.replace(/^vift_/, ''));
        if (!b.aoId || (b.action === 'add_material' ? !(b.row && typeof b.row === 'object' && !Array.isArray(b.row)) : !b.rowId) || (b.action === 'update_material' && !(b.patch && typeof b.patch === 'object' && !Array.isArray(b.patch)))) return DEFINITE(400, 'missing_fields');
        const ao = aos.find((a) => a.id === b.aoId); if (!ao) return DEFINITE(404, 'not_found');
        const rows = Array.isArray(ao.materials) ? ao.materials : (ao.materials = []);
        if (b.action === 'add_material') {
          if (!(this.has(eff, 'ao_edit') || isAssigned(ao, me.id) || this.has(eff, 'ao_view_all'))) return REGEL(403, 'forbidden', 'not_assigned');
          if (T4B.aoLast(ao)) return REGEL(409, 'ao_locked');
          if (rows.length >= 500) return DEFINITE(400, 'invalid_row');
          const inn = clone(b.row); const ign = [];
          ['id', 'addedBy', 'addedAt', 'priceSource', 'priceSourceId', 'sellPriceUnknown', 'buyPriceUnknown', 'updatedAt', 'updatedBy'].forEach((f) => { if (f in inn) { ign.push(f); delete inn[f]; } });
          const r = T4B.nyRad(ao, inn, perms, me.id, now, 'M-' + crypto.randomBytes(8).toString('hex'), get);
          rows.push(r.row); ao.updatedAt = now; save();
          const ig = ign.concat(r.ignored);
          return { status: 200, body: Object.assign({ action: b.action, workOrder: ao, row: r.row }, ig.length ? { ignoredFields: ig } : {}) };
        }
        const ri = rows.findIndex((m) => m && m.id === b.rowId); if (ri < 0) return DEFINITE(404, 'not_found');
        T4B.radKontroll(ao, rows[ri], eff, me.id, invs, (p, x) => this.has(p, x));
        if (b.expectedUpdatedAt != null && (rows[ri].updatedAt || rows[ri].addedAt || '') !== b.expectedUpdatedAt) return DEFINITE(409, 'stale_write');
        if (b.action === 'remove_material') { rows.splice(ri, 1); ao.updatedAt = now; save(); return { status: 200, body: { action: b.action, workOrder: ao, removedId: b.rowId } }; }
        const u = T4B.radUppdatera(rows[ri], b.patch, perms, me.id, now);
        rows[ri] = u.row;
        if (u.kompletterad) {
          const namn = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.id;
          ao.log = (Array.isArray(ao.log) ? ao.log : []).concat([{ id: 'L-PRIS-' + crypto.randomBytes(6).toString('hex'), type: 'material_price_completed', text: namn + ' kompletterade priset för materialraden "' + (u.row.name || '') + '"', userName: namn, staffId: me.id, timestamp: now, visibility: 'internal' }]);
        }
        ao.updatedAt = now; save();
        return { status: 200, body: Object.assign({ action: b.action, workOrder: ao, row: u.row }, u.ignored.length ? { ignoredFields: u.ignored } : {}) };
      }
      /* T4-B (T3-B beslut 1, punkt 276): behörig, loggad rättning/komplettering av tid (time_entry_correct). */
      case 'correct_time': {
        if (!this.has(perms, 'payroll_manage')) return DEFINITE(403, 'forbidden');
        const reason = String(b.reason || '').trim();
        if (!b.entry || typeof b.entry !== 'object' || Array.isArray(b.entry)) return DEFINITE(400, 'missing_fields');
        if (reason.length < 5 || reason.length > 500) return DEFINITE(400, 'reason_required');
        const inn = clone(b.entry);
        ['id', 'createdAt', 'updatedAt', 'attested', 'attestedAt', 'attestedBy', 'hourRate', 'hourRateUnknown', 'priceGroupName', 'corrections', 'registeredById', 'registeredByName'].forEach((f) => delete inn[f]);
        const invs = this.get('invoices') || [];
        let ny, typ, fore = {}, efter = {}, gamlaAo = null, idx = -1;
        if (b.entryId) {
          typ = 'rattning';
          idx = tes.findIndex((t) => t.id === b.entryId); if (idx < 0) return DEFINITE(404, 'not_found');
          const t = tes[idx];
          if (t.attested === true || t.attested === 'true') return DEFINITE(409, 'attested_locked');
          if (T4B.kallaStatus(invs, 'time:' + t.id).status !== 'ofakturerad') return REGEL(409, 'invoiced_locked');
          if (b.expectedUpdatedAt != null && (t.updatedAt || t.createdAt || '') !== b.expectedUpdatedAt) return DEFINITE(409, 'stale_write');
          gamlaAo = aos.find((a) => a.id === t.aoId) || null;
          if (gamlaAo && T4B.aoLast(gamlaAo)) return REGEL(409, 'ao_locked');
          ny = clone(t);
          for (const f of Object.keys(inn)) {
            if (!['date', 'startStr', 'endStr', 'minutes', 'comment', 'priceGroupId', 'billable', 'aoId', 'internal'].includes(f) || T4A.lika(inn[f], t[f])) continue;
            fore[f] = f in t ? t[f] : null; efter[f] = inn[f]; ny[f] = inn[f];
          }
          if (!Object.keys(efter).length) return DEFINITE(400, 'missing_fields');
        } else {
          typ = 'komplettering';
          const st = (this.get('staff') || []).find((x) => x.id === inn.staffId && recActive(x));
          if (!inn.aoId || !inn.staffId || !st) return DEFINITE(400, 'missing_fields');
          ny = Object.assign({}, inn, { registeredById: me.id, registeredByName: [me.firstName, me.lastName].filter(Boolean).join(' ') || me.id, staffName: [st.firstName, st.lastName].filter(Boolean).join(' ') || st.id });
          delete ny.deleted; efter = clone(inn);
        }
        const malAo = aos.find((a) => a.id === ny.aoId); if (!malAo) return DEFINITE(404, 'not_found');
        if (T4B.aoLast(malAo)) return REGEL(409, 'ao_locked');
        const min = T4B.tal(ny.minutes);
        if (min === null || min <= 0 || min > 1440 * 7 || !T4B.datumOk(ny.date)) return DEFINITE(400, 'missing_fields');
        let pg = null;
        if (ny.priceGroupId) { pg = T4B.pris('priceGroup', ny.priceGroupId, { customerId: malAo.customerId, propertyId: malAo.propertyId, contractId: malAo.contractId, date: ny.date }, (k) => this.get(k.replace(/^vift_/, ''))); if (!pg) return REGEL(403, 'forbidden', 'price_group_not_allowed'); }
        if (typ === 'komplettering' || 'priceGroupId' in efter) { const r = pg && pg.priceKnown ? pg.unitPrice : null; Object.assign(ny, { hourRate: r, hourRateUnknown: r === null, priceGroupName: pg ? pg.name : '' }); }
        ny.updatedAt = now;
        ny.corrections = (Array.isArray(ny.corrections) ? ny.corrections : []).concat([{ at: now, by: me.id, type: typ, reason, before: fore, after: efter }]);
        if (typ === 'komplettering') { ny.id = 'TID-K-' + crypto.randomBytes(6).toString('hex'); ny.createdAt = now; tes.unshift(ny); } else tes[idx] = ny;
        if (gamlaAo && gamlaAo.id !== malAo.id) gamlaAo.timeEntries = (gamlaAo.timeEntries || []).filter((x) => x !== ny.id);
        if (!(malAo.timeEntries || []).includes(ny.id)) malAo.timeEntries = (malAo.timeEntries || []).concat([ny.id]);
        const namn = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.id;
        malAo.log = (Array.isArray(malAo.log) ? malAo.log : []).concat([{ id: 'L-TIDR-' + crypto.randomBytes(6).toString('hex'), type: 'time_corrected', text: namn + (typ === 'komplettering' ? ' kompletterade tid i efterhand (' : ' rättade tid i efterhand (') + ny.id + '): ' + reason, userName: namn, staffId: me.id, timestamp: now, visibility: 'internal' }]);
        malAo.updatedAt = now;
        save();
        return { status: 200, body: { action: 'correct_time', timeEntry: ny, correction: typ } };
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
    /* T3-B (D-07): den enda vägen att sätta/backa AO:s faktureringsstatus (work_order_billing_set). */
    if (b.action === 'aoBilling') {
      if (!b.aoId || !['invoiced', 'restore'].includes(b.mode) || (b.mode === 'invoiced' && !b.invoiceId)) return DEFINITE(400, 'missing_fields');
      const aos = this.get('workOrders') || [];
      const ao = aos.find((a) => a.id === b.aoId); if (!ao) return DEFINITE(404, 'not_found');
      const t = nowText();
      if (b.mode === 'invoiced') {
        const inv = find();
        if (!inv || isTrue(inv.deleted)) return DEFINITE(404, 'not_found');
        if (inv.status === 'makulerad') return DEFINITE(409, 'invalid_transition');
        const linked = (inv.workOrderIds || []).includes(b.aoId) || inv.workOrderId === b.aoId ||
          (inv.lines || []).some((l) => l.sourceId === b.aoId || (l.sourceRefs || []).some((r) => r.workOrderId === b.aoId));
        if (!linked) return REGEL(403, 'forbidden', 'invoice_not_linked');
        if (isTrue(ao.deleted)) return REGEL(409, 'ao_locked');
        if (ao.status === 'fakturerad' && ao.invoiceId === b.invoiceId) return { status: 200, body: { workOrder: ao, noop: true } };
        if (ao.invoiceId && ao.invoiceId !== b.invoiceId) return REGEL(409, 'ao_locked');
        if ((ao.billingPreviousStatus === undefined || ao.billingPreviousStatus === null) && ao.status !== 'fakturerad') ao.billingPreviousStatus = ao.status || 'klar';
        Object.assign(ao, { status: 'fakturerad', invoiceId: b.invoiceId, updatedAt: t });
      } else {
        if (ao.status !== 'fakturerad' || ao.billingPreviousStatus === undefined || ao.billingPreviousStatus === null) return { status: 200, body: { workOrder: ao, noop: true } };
        Object.assign(ao, { status: ao.billingPreviousStatus, invoiceId: '', billingPreviousStatus: null, updatedAt: t });
      }
      this.set('workOrders', aos); this.touch();
      return { status: 200, body: { workOrder: ao, noop: false } };
    }
    if (b.action === 'appendChecked') {
      const inv = clone(b.invoice);
      const claimed = new Set();
      invs.filter((i) => ACTIVE.includes(i.status)).forEach((i) => (i.lines || []).forEach((l) => (l.sourceRefs || []).forEach((r) => claimed.add(r.sourceKey))));
      if ((inv.lines || []).some((l) => (l.sourceRefs || []).some((r) => claimed.has(r.sourceKey)))) return DEFINITE(409, 'source_collision');
      /* T4-B (D-10, R20, R21, VK-1): källraderna prövas mot sina källor (invoice_append_checked). */
      if (inv.sourceAware === true || inv.sourceAware === 'true') {
        try { T4B.fakturaKallor(inv, invs, this.get('workOrders') || [], this.get('timeEntries') || []); } catch (e) { if (e && e.t4b) return DEFINITE(e.t4b[0], e.t4b[1]); throw e; }
      }
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
      case 'setStatus': {
        /* T4-B (D-10, SEC-B1-15): okänt försäljningspris stoppar utskick (invoice_set_status). */
        if (b.status === 'skickad' && inv.status !== 'skickad') { try { T4B.prisKontroll(inv); } catch (e) { if (e && e.t4b) return DEFINITE(e.t4b[0], e.t4b[1]); throw e; } }
        inv.status = b.status; break;
      }
      case 'draftDelete': { const i = invs.indexOf(inv); invs.splice(i, 1); save(); return { status: 200, body: { ok: true, activityLog: this.t3dProject('vift_activityLog', this.get('activityLog'), perms, me) } }; }
      default: return DEFINITE(400, 'unknown_action');
    }
    bump(); save();
    return { status: 200, body: { invoice: inv, activityLog: this.t3dProject('vift_activityLog', this.get('activityLog'), perms, me), changed: true } };
  }

  /* ── rondering-pass-write (MODELL) ───────────────────────────
     Efter klientens dokumenterade kontrakt (RonderingSyncService +
     kommentarerna i RonderingUtforandePage): servern tilldelar id och
     status 'planerat', pointPatch är radlåst och räknar om summary samt
     auto-startar ('pågående'), complete beslutar själv slutstatus
     ('har_avvikelser' om någon punkt har anmärkning, annars 'slutfört')
     och sätter completedBy. bulkCreate skapar flera och returnerar
     created[]. SQL-källan finns inte i repot — se E2E-rapporten. */
  /* T4-C (D-23): permanent radering (elementet borta ur listan) tar bort den känsliga raden i samma
     skrivning, med en revisionsrad utan värden. Arkivering/inaktivering behåller den. */
  _t4cRadering(key, fore, efter, me) {
    if (key !== 'vift_propertyObjects' && key !== 'vift_properties') return;
    T4C.borttagna(fore, efter).forEach((id) => {
      if (!this.sensitive.has(id)) return;
      const rad = this.sensitive.get(id) || {};
      this.sensitive.delete(id);
      this.sensitiveAudit.push({ status: 'allowed', action: 'write', staffId: me && me.id, objectId: key === 'vift_propertyObjects' ? id : null,
        propertyId: key === 'vift_properties' ? id : null, fields: T4C.FALT.filter((f) => rad[f]), detail: 'permanent_delete (' + key + ', D-23)' });
    });
  }

  ronderingWrite(b, perms, me) {
    /* T4-D: ao_view_all (alla pass, oförändrat) eller rondering_utfor (bara egna pass) — rondering-pass-write + RPC. */
    const led = T4D.ledning(perms);
    if (!led && !perms.includes('rondering_utfor')) return DEFINITE(403, 'forbidden');
    if (!led && ['create', 'bulkCreate', 'migrateLegacy'].includes(b.action)) return DEFINITE(403, 'forbidden');
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
    if (!['pointPatch', 'pointReset', 'saveNote', 'autoStart', 'complete'].includes(b.action)) return DEFINITE(400, 'unknown_action');
    if (!b.passId) return DEFINITE(400, 'missing_fields');
    const pass = passes.find((x) => x.id === b.passId) || null;
    /* T4-D: passregeln under låset (_vift_t4d_pass_regel): ledningen alla pass (även avslutade, som servern);
       fältet bara egna, ej avslutade (autoStart är en no-op på avslutat pass). */
    const regel = T4D.prova(pass, me && me.id, perms, b.action !== 'autoStart');
    if (!regel.ok) return REGEL(regel.status, regel.error, regel.reason);
    const ign = [];
    const point = () => { const c = (pass.categories || []).find((x) => x.id === b.categoryId); return c && (c.points || []).find((x) => x.id === b.pointId); };
    switch (b.action) {
      case 'pointPatch': {
        const pt = point(); if (!pt) return DEFINITE(404, 'point_not_found');
        if (!['ok', 'anmärkning', 'ej_aktuell', 'ej_kontrollerad'].includes(b.status)) return DEFINITE(400, 'invalid_status');
        let dev = b.deviationId || null, wo = b.workOrderId || null;
        if (!led) { if (dev) { ign.push('deviationId'); dev = null; } if (wo) { ign.push('workOrderId'); wo = null; } } // T4-D (R53)
        Object.assign(pt, { status: b.status, comment: b.comment || '', deviationId: dev || pt.deviationId || null, workOrderId: wo || pt.workOrderId || null, checkedAt: new Date().toISOString(), checkedBy: me.id });
        if (!pass.status || pass.status === 'planerat') { pass.status = 'pågående'; pass.startedAt = new Date().toISOString(); }
        recompute(pass); break;
      }
      case 'pointReset': { const pt = point(); if (!pt) return DEFINITE(404, 'point_not_found'); Object.assign(pt, { status: '', comment: '', deviationId: null, checkedAt: null, checkedBy: null }); recompute(pass); break; }
      case 'saveNote': pass.internalNote = b.note; break;
      case 'autoStart': if (!pass.status || pass.status === 'planerat') { pass.status = 'pågående'; pass.startedAt = new Date().toISOString(); } else return { status: 200, body: { pass } }; break;
      case 'complete': recompute(pass); pass.status = pass.summary.anmärkningar > 0 ? 'har_avvikelser' : 'slutfört'; pass.completedAt = new Date().toISOString(); pass.completedBy = me.id; break;
      default: return DEFINITE(400, 'unknown_action');
    }
    save(); return { status: 200, body: Object.assign({ pass }, ign.length ? { ignoredFields: ign } : {}) };
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
    // T3-B: skrivrätt = tilldelad eller ao_view_all; öppen pool ger ingen; låst AO för icke-ledare.
    if (!this.canWriteAO(ao, perms, me.id)) return REGEL(403, 'forbidden', 'not_assigned');
    if (!this.has(perms, 'ao_view_all') && isLockedAO(ao)) return REGEL(409, 'ao_locked');
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
      // T3-B (SÄK-17, CHK-LEGACY): ingen autostart av AO:n — den installerade
      // work_order_checklist_set_state rör aldrig AO:ns status, inte heller i det äldre kontraktet.
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
    // T3-B (Q3): öppen pool ger varken logg eller skrivrätt; låst AO för icke-ledare.
    if (!this.canWriteAO(aos[i], perms, me.id)) return REGEL(403, 'forbidden', 'not_assigned');
    if (!this.has(perms, 'ao_view_all') && isLockedAO(aos[i])) return REGEL(409, 'ao_locked');
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
    if (!this.canWriteAO(ao, perms, me.id)) return REGEL(403, 'forbidden', 'not_assigned');
    if (!this.has(perms, 'ao_view_all') && isLockedAO(ao)) return REGEL(409, 'ao_locked');
    const bytes = Buffer.from(b.fileBase64 || '', 'base64');
    const sniff = bytes[0] === 0xFF && bytes[1] === 0xD8 ? 'image/jpeg' : (bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : (bytes.slice(0, 4).toString() === 'RIFF' ? 'image/webp' : null));
    if (!sniff) return DEFINITE(400, 'invalid_file_type');
    const pth = b.aoId + '/' + Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '.jpg';
    this.files.set(pth, { bytes, mime: sniff });
    return { status: 200, body: { path: pth } };
  }
  imageUrl(b, perms, me) {
    const ao = (this.get('workOrders') || []).find((a) => a.id === b.aoId); if (!ao) return DEFINITE(404, 'not_found');
    if (!this.canViewAOContent(ao, perms, me.id)) return REGEL(403, 'forbidden', 'not_assigned');
    if ((b.paths || []).some((x) => !String(x).startsWith(b.aoId + '/'))) return DEFINITE(400, 'invalid_path');
    const urls = {};
    (b.paths || []).forEach((x) => { if (this.files.has(x)) urls[x] = 'https://e2e-storage.invalid/' + encodeURIComponent(x); });
    return { status: 200, body: { urls } };
  }
  imageDelete(b, perms, me) {
    if (!this.has(perms, 'ao_checklist') && !this.has(perms, 'ao_edit')) return DEFINITE(403, 'forbidden');
    const ao = (this.get('workOrders') || []).find((a) => a.id === b.aoId); if (!ao) return DEFINITE(404, 'not_found');
    if (!this.canWriteAO(ao, perms, me.id)) return REGEL(403, 'forbidden', 'not_assigned');
    if (!this.has(perms, 'ao_view_all') && isLockedAO(ao)) return REGEL(409, 'ao_locked');
    if (!String(b.path).startsWith(b.aoId + '/')) return DEFINITE(400, 'invalid_path');
    /* T4-A: ägarkontroll — bild som annans post refererar raderas bara med ao_edit. */
    if (!this.has(perms, 'ao_edit') && T4A.bildAnnans(ao, String(b.path), me && me.id)) return REGEL(403, 'forbidden', 'not_own');
    this.files.delete(b.path);
    return { status: 200, body: { ok: true } };
  }

  /* ── e2e-test-cleanup (STAGING-only, T3-0 2026-11-28) ──────────
     Modell av vift-v2 supabase/staging-only/functions/e2e-test-cleanup/index.ts och
     RPC:n e2e_purge_offer_artifacts: kräver 'all'; offerten/AO:n måste finnas och ha
     en titel som börjar med "[E2E-TEST]" (annars 403 not_test_offer/not_test_ao utan
     ändring); bara poster och filer under just den offertens/AO:ns egen mapp rörs.
     Spärren "bara i STAGING-projektet" (410 utanför) modelleras inte: den simulerade
     servern är alltid en testmiljö. */
  e2eTestCleanup(b, perms) {
    if (!this.has(perms, 'all')) return DEFINITE(403, 'forbidden');
    b = b || {};
    const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,120}$/;
    if (b.action === 'purgeOffer') {
      const offerId = String(b.offerId == null ? '' : b.offerId);
      if (!ID.test(offerId)) return DEFINITE(400, 'invalid_id');
      const off = (this.get('offers') || []).find((o) => o.id === offerId);
      if (!off || !String(off.title || '').startsWith('[E2E-TEST]')) return DEFINITE(403, 'not_test_offer');
      const atts = this.get('offerAttachments') || [];
      const evts = this.get('offerEvents') || [];
      const mine = atts.filter((a) => a.offerId === offerId);
      const prefix = 'offer-attachments/' + offerId + '/';
      let filesRemoved = 0;
      mine.forEach((a) => { const p = String(a.storagePath || ''); if (p.startsWith(prefix) && !p.includes('..') && this.files.delete(p)) filesRemoved++; });
      const nEvt = evts.filter((e) => e.offerId === offerId).length;
      if (mine.length) this.set('offerAttachments', atts.filter((a) => a.offerId !== offerId));
      if (nEvt) this.set('offerEvents', evts.filter((e) => e.offerId !== offerId));
      if (mine.length || nEvt) this.touch();
      return { status: 200, body: { ok: true, attachments: mine.length, events: nEvt, filesRemoved } };
    }
    if (b.action === 'purgeAoImages') {
      const aoId = String(b.aoId == null ? '' : b.aoId);
      if (!ID.test(aoId)) return DEFINITE(400, 'invalid_id');
      const ao = (this.get('workOrders') || []).find((a) => a.id === aoId);
      if (!ao || !String(ao.title || '').startsWith('[E2E-TEST]')) return DEFINITE(403, 'not_test_ao');
      const paths = [...this.files.keys()].filter((p) => p.startsWith(aoId + '/'));
      paths.forEach((p) => this.files.delete(p));
      return { status: 200, body: { ok: true, filesRemoved: paths.length } };
    }
    return DEFINITE(400, 'unknown_action');
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

module.exports = { FakeSupabase, TEST_USERS, PASSWORD, T3E_EJ_VERKSTALLDA };
