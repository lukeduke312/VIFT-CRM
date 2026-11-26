'use strict';
/*
 * T4-A (2026-11-28): den simulerade serverns kopia av T4-A:s regler (SÄK-17, SEC-SIM-01).
 * Speglar exakt vift-v2 supabase/migrations/20261128000009_t4a_skyddade_falt.sql
 * (_vift_t4a_*) och supabase/functions/_shared/vift-auth.ts (projectWorkOrder). Ändras en regel
 * på servern ska den ändras här i samma ändring; paritetstesterna (tests/sim_parity.test.js och
 * vift-v2 tests/paritet_fake_kopia.test.js) jämför utfallen. Samma fil finns i vift-v2/tests/e2e/.
 */

const SENS = ['doorCode', 'keyInformation', 'accessInformation', 'keyReceipt', 'alarmInformation', 'accessCode', 'keyInfo'];
const SENS_KEYS = ['vift_customers', 'vift_properties', 'vift_propertyObjects', 'vift_propertyContacts', 'vift_recurringOrders', 'vift_workOrders'];
const INTERN = ['admin_manage', 'invoice_view', 'invoice_create', 'reports_view', 'offer_manage', 'ao_view_all', 'ao_edit'];
const BANK = ['bankgiro', 'plusgiro', 'iban', 'bic', 'swish'];
const KUND_LAS = ['all', 'customer_manage', 'invoice_view', 'invoice_create', 'offer_manage', 'sales_manage', 'ao_view_all', 'ao_create', 'recurring_manage', 'reports_view'];
/* Katalogen över verkställda behörigheter (_vift_t4a_giltig). */
const KATALOG = ['all', 'dashboard_view', 'ao_view_all', 'ao_view_own', 'ao_create', 'ao_edit', 'ao_complete', 'ao_time', 'ao_material', 'ao_checklist',
  'ao_start_own', 'ao_complete_own', 'ao_pool_take', 'customer_manage', 'customer_view', 'offer_manage', 'invoice_view', 'invoice_create',
  'staff_view', 'staff_manage', 'staff_contacts_view', 'admin_manage', 'article_manage', 'recurring_manage', 'sales_manage', 'reports_view',
  'payroll_view', 'payroll_manage', 'objects_sensitive', 'cost_view', 'cost_edit', 'personal_data_view', 'bankgiro_edit', 'activity_log_view_all'];
/* T3-E:s fasta lista (D-04:s tillägg + de tio då ej verkställda) för övergångsregeln (_vift_t4a_kontakt). */
const T3E_FAST = ['dashboard_view', 'ao_view_own', 'ao_time', 'ao_checklist', 'ao_start_own', 'ao_complete_own', 'objects_access_assigned', 'rondering_utfor',
  'ao_plan_own', 'cost_view', 'cost_edit', 'time_view_all', 'bankgiro_edit', 'personal_data_view', 'export_data', 'export_personal_data'];
/* v3.4-rolleditorns katalog (_vift_t4a_roller_bevara). */
const V34_KATALOG = ['all', 'dashboard_view', 'ao_view_all', 'ao_view_own', 'ao_create', 'ao_edit', 'ao_complete', 'ao_time', 'ao_material', 'ao_checklist',
  'customer_manage', 'offer_manage', 'invoice_view', 'invoice_create', 'staff_view', 'staff_manage', 'admin_manage', 'article_manage', 'payroll_view',
  'payroll_manage', 'recurring_manage', 'sales_manage', 'reports_view', 'objects_sensitive'];
/* _vift_ej_verkstallda() efter T4-A. */
const EJ_VERKSTALLDA = ['ao_plan_own', 'time_view_all', 'objects_access_assigned', 'rondering_utfor', 'export_data', 'export_personal_data'];

const P = (p) => (Array.isArray(p) ? p : []);
const any = (p, l) => l.some((x) => P(p).includes(x));
const obj = (e) => !!e && typeof e === 'object' && !Array.isArray(e);
const kanon = (v) => JSON.stringify(v, (k, x) => (obj(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x));
const lika = (a, b) => kanon(a === undefined ? null : a) === kanon(b === undefined ? null : b);

const rollAktiv = (r) => obj(r) && !['false', '0'].includes(String(r.active === undefined ? 'true' : r.active));
const giltig = (p) => any(p, KATALOG);
const legacy = (p) => !any(p, ['all', 'staff_contacts_view', 'activity_log_view_all']);
const kontakt = (p) => any(p, ['all', 'staff_contacts_view']) || (legacy(p) && P(p).some((x) => !T3E_FAST.includes(x)));
const loggFull = (p) => any(p, ['all', 'activity_log_view_all']) || (legacy(p) && any(p, ['ao_view_all', 'admin_manage']));
const kundLas = (p) => any(p, KUND_LAS);
const privat = (e) => obj(e) && ['privat', 'private', 'privatperson'].includes(String(e.type || '').toLowerCase());
const tom = (v) => v === undefined || v === null || v === '';

function falt(key) {
  if (key === 'vift_customers') return SENS.concat(['personnr', 'orgNr']);
  if (SENS_KEYS.includes(key)) return SENS.slice();
  if (key === 'vift_articles') return ['buyPrice', 'markup'];
  if (key === 'vift_settings') return ['internalHourlyCost'].concat(BANK);
  return [];
}
function kanLasa(key, f, e, p) {
  p = P(p);
  if (p.includes('all')) return true;
  if (SENS.includes(f) && SENS_KEYS.includes(key)) return p.includes('objects_sensitive');
  if (key === 'vift_customers' && f === 'personnr') return p.includes('personal_data_view');
  if (key === 'vift_customers' && f === 'orgNr') return !privat(e) || p.includes('personal_data_view');
  if (key === 'vift_articles' && (f === 'buyPrice' || f === 'markup')) return p.includes('cost_view');
  if (key === 'vift_settings' && f === 'internalHourlyCost') return p.includes('cost_view');
  if (key === 'vift_settings' && BANK.includes(f)) return any(p, INTERN.concat(['bankgiro_edit']));
  return true;
}
function kanSkriva(key, f, e, p) {
  p = P(p);
  if (!kanLasa(key, f, e, p)) return false;
  if (p.includes('all')) return true;
  if (SENS.includes(f) && SENS_KEYS.includes(key)) return p.includes('objects_sensitive');
  if (key === 'vift_customers' && f === 'personnr') return p.includes('personal_data_view');
  if (key === 'vift_customers' && f === 'orgNr') return !privat(e) || p.includes('personal_data_view');
  if (key === 'vift_articles' && (f === 'buyPrice' || f === 'markup')) return p.includes('cost_edit');
  if (key === 'vift_settings' && f === 'internalHourlyCost') return p.includes('cost_edit');
  if (key === 'vift_settings' && BANK.includes(f)) return p.includes('bankgiro_edit');
  return true;
}
function allaLasbara(key, p) {
  p = P(p);
  if (p.includes('all')) return true;
  if (key === 'vift_customers') return p.includes('objects_sensitive') && p.includes('personal_data_view');
  if (['vift_properties', 'vift_propertyObjects', 'vift_propertyContacts', 'vift_recurringOrders'].includes(key)) return p.includes('objects_sensitive');
  if (key === 'vift_articles') return p.includes('cost_view');
  if (key === 'vift_settings') return p.includes('cost_view') && any(p, INTERN.concat(['bankgiro_edit']));
  return true;
}
function proj(key, e, p) {
  if (!obj(e)) return e;
  const bort = falt(key).filter((f) => f in e && !kanLasa(key, f, e, p));
  if (!bort.length) return e;
  const out = Object.assign({}, e); bort.forEach((f) => { delete out[f]; }); return out;
}
/* _vift_t4a_sammanfoga: {ok:true, value} eller {ok:false, reason:'field_protected'}. */
function sammanfoga(key, old, neu, p) {
  if (!obj(neu)) return { ok: true, value: neu };
  if (!obj(old)) old = null;
  const ref = key === 'vift_customers' && (privat(neu) || (privat(old) && !tom(old.orgNr))) ? { type: 'privat' } : {};
  if (key === 'vift_customers' && privat(old) && !privat(neu) && !kanSkriva(key, 'orgNr', ref, p) && !tom(old.orgNr)) return { ok: false, reason: 'field_protected' };
  const out = Object.assign({}, neu);
  for (const f of falt(key)) {
    if (kanSkriva(key, f, ref, p)) continue;
    if (!(f in neu)) { if (old && f in old) out[f] = old[f]; }
    else if (tom(neu[f]) && (!old || !(f in old) || tom(old[f]))) { /* tomt mot tomt */ }
    else if (old && f in old && kanLasa(key, f, ref, p) && lika(neu[f], old[f])) { /* oförändrat läsbart */ }
    else return { ok: false, reason: 'field_protected' };
  }
  return { ok: true, value: out };
}
function sammanfogaLista(key, oldArr, neuArr, p) {
  if (!Array.isArray(neuArr)) return { ok: true, value: neuArr };
  const old = Array.isArray(oldArr) ? oldArr : [];
  const out = [];
  for (const n of neuArr) {
    if (!obj(n)) { out.push(n); continue; }
    const o = n.id != null && n.id !== '' ? old.find((x) => obj(x) && String(x.id) === String(n.id)) || null : null;
    const r = sammanfoga(key, o, n, p);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: true, value: out };
}
function rollerBevara(old, neu, klient) {
  const kat = klient && typeof klient === 'object' ? klient.behorighetskatalog : null;
  if (Number.isInteger(kat) && kat >= 4) return neu;
  if (!obj(old) || !obj(neu) || !Array.isArray(old.permissions) || !Array.isArray(neu.permissions)) return neu;
  const kept = old.permissions.filter((x) => typeof x === 'string' && !neu.permissions.includes(x) && !V34_KATALOG.includes(x));
  return kept.length ? Object.assign({}, neu, { permissions: neu.permissions.concat(kept) }) : neu;
}
/* _vift_t4a_ao_patch: {ok, patch, ignored} eller {ok:false, reason}. */
function aoPatch(ao, patch, p) {
  p = P(p);
  const pt = Object.assign({}, patch);
  for (const f of falt('vift_workOrders')) {
    if (f in pt && !kanSkriva('vift_workOrders', f, ao, p)) {
      if (tom(pt[f]) && tom(ao && ao[f])) delete pt[f];
      else return { ok: false, reason: 'field_protected' };
    }
  }
  const ignored = [];
  const skriv = p.includes('all') || (p.includes('cost_view') && p.includes('cost_edit'));
  const las = p.includes('all') || p.includes('cost_view');
  if (skriv || !Array.isArray(pt.materials)) return { ok: true, patch: pt, ignored };
  const gamla = Array.isArray(ao && ao.materials) ? ao.materials : [];
  const rader = [];
  for (const n0 of pt.materials) {
    if (!obj(n0)) { rader.push(n0); continue; }
    let n = Object.assign({}, n0);
    const o = n.id != null && n.id !== '' ? gamla.find((x) => obj(x) && String(x.id) === String(n.id)) || null : null;
    if (o) {
      if (!('buyPrice' in n)) { if ('buyPrice' in o) n.buyPrice = o.buyPrice; }
      else if (tom(n.buyPrice) && (!('buyPrice' in o) || tom(o.buyPrice))) { /* tomt */ }
      else if (las && 'buyPrice' in o && lika(n.buyPrice, o.buyPrice)) { /* oförändrat */ }
      else return { ok: false, reason: 'field_protected' };
    } else if ('buyPrice' in n && !tom(n.buyPrice)) {
      delete n.buyPrice;
      if (!ignored.includes('materials[].buyPrice')) ignored.push('materials[].buyPrice');
    }
    rader.push(n);
  }
  pt.materials = rader;
  return { ok: true, patch: pt, ignored };
}
/* projectWorkOrder (_shared/vift-auth.ts). */
const AO_ECONOMY_FIELDS = ['fixedPrice', 'amount'];
const AO_ECONOMY_PERMS = ['ao_edit', 'ao_view_all', 'invoice_view', 'invoice_create', 'cost_view'];
function projectWorkOrder(ao, perms) {
  const p = P(perms);
  if (!obj(ao) || p.includes('all')) return ao;
  const out = Object.assign({}, ao);
  if (!p.includes('objects_sensitive')) SENS.forEach((f) => { delete out[f]; });
  if (!any(p, AO_ECONOMY_PERMS)) AO_ECONOMY_FIELDS.forEach((f) => { delete out[f]; });
  if (!p.includes('cost_view') && Array.isArray(out.materials)) {
    out.materials = out.materials.map((m) => { if (!obj(m)) return m; const r = Object.assign({}, m); delete r.buyPrice; return r; });
  }
  return out;
}
/* Bildradering (work-order-image-delete, T4-A): refereras bilden av annans post? */
function bildAnnans(ao, path, me) {
  const refs = (e) => ['imagePath', 'image', 'avvikelseImage', 'storagePath'].some((k) => e[k] === path)
    || (Array.isArray(e.images) && e.images.some((x) => x === path || (obj(x) && Object.values(x).includes(path))));
  for (const k of ['log', 'notes']) {
    const l = Array.isArray(ao && ao[k]) ? ao[k] : [];
    if (l.some((e) => obj(e) && refs(e) && String(e.staffId == null ? '' : e.staffId) !== String(me || ''))) return true;
  }
  const cl = Array.isArray(ao && ao.checklist) ? ao.checklist : [];
  return cl.some((e) => obj(e) && refs(e));
}

module.exports = {
  SENS, KATALOG, V34_KATALOG, EJ_VERKSTALLDA, rollAktiv, giltig, legacy, kontakt, loggFull, kundLas, privat, tom, falt, kanLasa, kanSkriva,
  allaLasbara, proj, sammanfoga, sammanfogaLista, rollerBevara, aoPatch, projectWorkOrder, bildAnnans, lika,
};
