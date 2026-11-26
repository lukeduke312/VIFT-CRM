'use strict';
/*
 * T4-D (2026-11-28): den simulerade serverns kopia av T4-D:s regler (SÄK-17, SEC-SIM-01).
 * Speglar exakt vift-v2 supabase/migrations/20261128000013_t4d_rondering.sql (_vift_t4d_pass_regel,
 * passåtgärderna, projektionen per pass, _vift_post_refs 'ronderingar', _vift_ref_visible) och
 * supabase/functions/rondering-pass-write/index.ts. Ändras en regel på servern ska den ändras här i samma
 * ändring; paritetstesterna (tests/sim_parity.test.js och vift-v2 tests/paritet_fake_kopia.test.js) jämför
 * utfallen. Samma fil finns i vift-v2/tests/e2e/.
 */
const T4C = require('./t4c-regler');

const P = (p) => (Array.isArray(p) ? p : []);
const obj = (e) => !!e && typeof e === 'object' && !Array.isArray(e);

/* _vift_ej_verkstallda() efter T4-D (rondering_utfor verkställd). */
const EJ_VERKSTALLDA = T4C.EJ_VERKSTALLDA.filter((x) => x !== 'rondering_utfor');
const KEYS = ['vift_ronderingspass', 'vift_ronderingar', 'vift_ronderingsmallar'];
const ledning = (p) => P(p).includes('all') || P(p).includes('ao_view_all');
const aktiv = (p) => T4C.ronderingAktiv(p, EJ_VERKSTALLDA);

/* _vift_t4d_pass_regel: null = tillåtet; annars felkoden ('forbidden', 'forbidden:not_assigned', 'pass_completed', 'not_found'). */
function passRegel(pass, me, perms) {
  if (ledning(perms)) return pass ? null : 'not_found';
  if (!aktiv(perms) || !me) return 'forbidden';
  if (!pass || !T4C.passTilldelad(pass, me)) return 'forbidden:not_assigned';
  if (['slutfört', 'har_avvikelser'].includes(String(pass.status || ''))) return 'pass_completed';
  return null;
}
/* EF + RPC: { ok } eller { status, error, reason }. mutera=false (autoStart) släpper igenom avslutat pass. */
function prova(pass, me, perms, mutera) {
  if (!ledning(perms) && !aktiv(perms)) return { status: 403, error: 'forbidden' };
  let r = passRegel(pass, me, perms);
  if (r === 'pass_completed' && !mutera) r = null;
  if (!r) return { ok: true };
  if (r === 'forbidden:not_assigned') return { status: 403, error: 'forbidden', reason: 'not_assigned' };
  if (r === 'forbidden') return { status: 403, error: 'forbidden' };
  if (r === 'pass_completed') return { status: 409, error: 'pass_completed' };
  return { status: 404, error: 'not_found' };
}

const egnaRonderingar = (passes, me) => [...new Set((Array.isArray(passes) ? passes : []).filter((x) => obj(x) && x.ronderingId && T4C.passTilldelad(x, me)).map((x) => String(x.ronderingId)))];
const RON_FALT = ['id', 'name', 'templateId', 'templateName', 'customerId', 'propertyId', 'description', 'categories', 'status',
  'isDraft', 'performedBy', 'performedByName', 'startedAt', 'completedAt', 'results', 'deviationIds', 'createdAt', 'updatedAt'];
/* vift_store_project för de tre nycklarna (utan ao_view_all). */
function projicera(key, value, perms, me, passes) {
  if (!Array.isArray(value)) return value;
  if (!me || key === 'vift_ronderingsmallar' || !aktiv(perms)) return [];
  if (key === 'vift_ronderingspass') return value.filter((e) => obj(e) && T4C.passTilldelad(e, me));
  const ids = egnaRonderingar(passes, me);
  return value.filter((e) => obj(e) && ids.includes(String(e.id || ''))).map((e) => Object.fromEntries(Object.entries(e).filter(([k]) => RON_FALT.includes(k))));
}
const RON_HANDELSER = ['rondering_started', 'rondering_completed', 'point_ok', 'point_ej_aktuell'];

module.exports = { EJ_VERKSTALLDA, KEYS, ledning, aktiv, passRegel, prova, egnaRonderingar, projicera, RON_FALT, RON_HANDELSER };
