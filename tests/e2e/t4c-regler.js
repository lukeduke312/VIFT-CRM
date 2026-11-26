'use strict';
/*
 * T4-C (2026-11-28): den simulerade serverns kopia av T4-C:s regler (SÄK-17, SEC-SIM-01).
 * Speglar exakt vift-v2 supabase/migrations/20261128000012_t4c_atkomstinformation.sql
 * (sensitive_fields_read, _vift_t4c_*, triggern _vift_t4c_kanslig_radering och _vift_ej_verkstallda) och
 * supabase/functions/get-sensitive-fields/index.ts. Ändras en regel på servern ska den ändras här i samma
 * ändring; paritetstesterna (tests/sim_parity.test.js och vift-v2 tests/paritet_fake_kopia.test.js)
 * jämför utfallen. Samma fil finns i vift-v2/tests/e2e/.
 */
const T4B = require('./t4b-regler');

const P = (p) => (Array.isArray(p) ? p : []);
const obj = (e) => !!e && typeof e === 'object' && !Array.isArray(e);
const isTrue = (v) => v === true || v === 'true';

/* _vift_ej_verkstallda() efter T4-C (objects_access_assigned verkställd). */
const EJ_VERKSTALLDA = T4B.EJ_VERKSTALLDA.filter((x) => x !== 'objects_access_assigned');

/* _vift_ao_locked (T3-B). */
const aoLast = (ao) => isTrue(ao.deleted) || isTrue(ao.archived) || ['fakturerad', 'avbruten'].includes(String(ao.status || '')) || !!ao.invoiceId;
/* _vift_t4c_ao_aktiv: nytt/planerad/pågående och inte låst. */
const aoAktiv = (ao) => obj(ao) && ['nytt', 'planerad', 'pågående'].includes(String(ao.status || '')) && !aoLast(ao);
/* _vift_t4c_pass_aktiv: planerat/pågående. */
const passAktiv = (p) => obj(p) && ['planerat', 'pågående'].includes(String(p.status || ''));
const passTilldelad = (p, me) => !!me && Array.isArray(p.staffIds) && p.staffIds.map(String).includes(String(me));
/* _vift_t4c_rondering_aktiv: rondering_utfor och verkställd (inte i ejVerkstallda). */
const ronderingAktiv = (perms, ejV) => P(perms).includes('rondering_utfor') && !P(ejV || EJ_VERKSTALLDA).includes('rondering_utfor');

const id = (v) => (typeof v === 'string' && v.trim() && v.trim().length <= 200 ? v.trim() : null);

/* sensitive_fields_read: { ok, reason?, via? } — samma ordning och samma utfall som RPC:n. */
function atkomst(body, perms, me, aos, passes, ejV) {
  const b = obj(body) ? body : {};
  const objId = id(b.objectId), propId = objId ? null : id(b.propertyId), aoId = id(b.workOrderId), passId = id(b.passId);
  if (!objId && !propId) return { status: 400, error: 'missing_fields' };
  const p = P(perms);
  if (p.includes('all') || p.includes('objects_sensitive')) return { ok: true, via: 'objects_sensitive', objId, propId };
  if (!p.includes('objects_access_assigned') || !me) return { ok: false, reason: 'forbidden', objId, propId };
  const ao = passId ? null : (Array.isArray(aos) ? aos : []).find((a) => obj(a) && (!aoId || String(a.id) === aoId)
    && (Array.isArray(a.staff) && a.staff.map(String).includes(String(me))) && aoAktiv(a)
    && (objId ? String(a.objectId || '') === objId : String(a.propertyId || '') === propId));
  if (ao) return { ok: true, via: 'ao:' + ao.id, objId, propId };
  if (!objId && !aoId && ronderingAktiv(p, ejV)) {
    const ps = (Array.isArray(passes) ? passes : []).find((x) => obj(x) && (!passId || String(x.id) === passId)
      && passTilldelad(x, me) && passAktiv(x) && String(x.propertyId || '') === propId);
    if (ps) return { ok: true, via: 'pass:' + ps.id, objId, propId };
  }
  return { ok: false, reason: 'not_assigned', objId, propId };
}

/* Svarets fält: objects_sensitive alla sex; tilldelad väg utan nyckelkvittensen. */
const FALT = ['doorCode', 'keyInformation', 'keyReceipt', 'alarmInformation', 'accessInformation', 'accessCode'];
function svar(rad, via) {
  const r = obj(rad) ? rad : {};
  const ut = {};
  FALT.forEach((f) => { ut[f] = (f === 'keyReceipt' && via !== 'objects_sensitive') ? null : (r[f] === undefined || r[f] === '' ? null : r[f]); });
  return ut;
}

/* D-23: id som försvunnit ur listan (permanent radering) för vift_propertyObjects/vift_properties. */
function borttagna(fore, efter) {
  const ids = (l) => new Set((Array.isArray(l) ? l : []).filter((e) => obj(e) && e.id != null && String(e.id) !== '').map((e) => String(e.id)));
  const a = ids(fore), b = ids(efter);
  return Array.from(a).filter((x) => !b.has(x)).sort();
}

module.exports = { EJ_VERKSTALLDA, aoAktiv, passAktiv, passTilldelad, ronderingAktiv, atkomst, svar, borttagna, FALT };
