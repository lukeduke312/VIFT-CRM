'use strict';
/*
 * GO-7 verifiering mot STAGING: work-order-log-write (G5). Skapar en märkt
 * test-AO (admin), testar tillägg, samtidiga tillägg, omsändning,
 * id-kollision, åtkomst, borttagning och att inga andra AO-fält ändras.
 * Test-AO:n tas bort (delete_ao + permanent_delete_ao) och efterkontrolleras.
 *   node tests/staging/go7-ao-log.js --jag-har-go --mutationstest --bekrafta-projekt=<ref>
 */
const L = require('./lib');
const env = L.guard(2);
const { pw, emails } = L.accounts(['admin', 'falt', 'falt2', 'chef', 'begransad'], []);
const { req, login } = L.client(env);
const runId = L.newRunId().replace('E2E-AUTHZ', 'E2E-GO7');
const rep = L.reporter('go7', runId);
(async () => {
  const tok = {}; for (const [r, e] of Object.entries(emails)) tok[r] = await login(e, pw);
  const st = await req('/rest/v1/store?select=value&key=eq.vift_staff', { method: 'GET', token: tok.admin });
  const staff = (st.body && st.body[0] && st.body[0].value) || [];
  const id = {}; for (const [r, e] of Object.entries(emails)) id[r] = String((staff.find((s) => String(s.email).toLowerCase() === e) || {}).id || '');
  const LW = (who, body) => req('/functions/v1/work-order-log-write', { token: tok[who], body });
  const getAO = async (aoId) => { const r = await req('/functions/v1/work-orders-list', { method: 'GET', token: tok.admin }); return ((r.body && r.body.workOrders) || []).find((a) => a.id === aoId); };
  const now = new Date().toISOString();
  const aoId = runId + '-AO';
  let created = false;
  try {
    const c = await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'create_ao', ao: { id: aoId, title: '[E2E-TEST] ' + runId, status: 'planerad', priority: 'normal', staff: [id.falt], customerId: '', description: 'G5-prov — tas bort efter körningen.', log: [], materials: [], checklist: [], createdAt: now, updatedAt: now, e2eTest: runId }, idempotencyKey: runId + '-create-ao' } });
    if (c.status !== 200) throw new Error('kunde inte skapa test-AO (HTTP ' + c.status + ' ' + (c.body.error || '') + ')');
    created = true;
    const before = await getAO(aoId);
    const ent = (n, extra) => Object.assign({ id: runId + '-L' + n, type: 'note', text: '[E2E-TEST] logg ' + n, at: now }, extra || {});
    // Tillägg; servern stämplar staffId (klientens förfalskade ignoreras).
    let r = await LW('falt', { action: 'append_log', aoId, entry: ent(1, { staffId: 'FÖRFALSKAD' }) });
    let ao = await getAO(aoId);
    let e1 = ((ao && ao.log) || []).find((x) => x.id === runId + '-L1');
    rep.add('LOGG tillägg (fält, tilldelad)', r.status === 200 && !!e1 && e1.staffId === id.falt, 'HTTP ' + r.status + '; staffId ' + (e1 && e1.staffId));
    // G5: samtidiga tillägg från två konton — båda ska finnas kvar.
    const [a, b] = await Promise.all([LW('falt', { action: 'append_log', aoId, entry: ent(2) }), LW('chef', { action: 'append_log', aoId, entry: ent(3) })]);
    ao = await getAO(aoId);
    const ids2 = ((ao && ao.log) || []).map((x) => x.id);
    rep.add('G5 samtidiga tillägg från två enheter', a.status === 200 && b.status === 200 && ids2.includes(runId + '-L2') && ids2.includes(runId + '-L3') && ids2.includes(runId + '-L1'), 'HTTP ' + a.status + '/' + b.status + '; poster: ' + ids2.length);
    // Omsändning (samma id + innehåll) = noop; samma id + annat innehåll = 409.
    e1 = ((ao && ao.log) || []).find((x) => x.id === runId + '-L1');
    const resend = Object.assign({}, e1); delete resend.staffId;
    r = await LW('falt', { action: 'append_log', aoId, entry: resend });
    rep.add('LOGG omsändning samma post', r.status === 200 && r.body.noop === true, 'HTTP ' + r.status + ' noop=' + r.body.noop);
    r = await LW('falt', { action: 'append_log', aoId, entry: ent(1, { text: 'annat innehåll' }) });
    rep.add('LOGG samma id, annat innehåll', r.status === 409 && r.body.error === 'id_collision', 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    // Åtkomst: ej tilldelad fältarbetare och roll utan AO-skrivrätt nekas.
    r = await LW('falt2', { action: 'append_log', aoId, entry: ent(9) });
    rep.add('LOGG ej tilldelad fältarbetare', r.status === 403 && r.body.error === 'forbidden', 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    r = await LW('begransad', { action: 'append_log', aoId, entry: ent(8) });
    rep.add('LOGG roll utan AO-skrivbehörighet', r.status === 403, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    // Borttagning: fält får inte ta bort arbetsledarens post, men sin egen; ao_edit får ta bort annans.
    r = await LW('falt', { action: 'remove_log', aoId, entryId: runId + '-L3' });
    rep.add('LOGG fält tar bort annans post', r.status === 403 && r.body.error === 'forbidden_other', 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    r = await LW('falt', { action: 'remove_log', aoId, entryId: runId + '-L1' });
    const r2 = await LW('chef', { action: 'remove_log', aoId, entryId: runId + '-L2' });
    const r3 = await LW('falt', { action: 'remove_log', aoId, entryId: runId + '-L1' });
    ao = await getAO(aoId);
    const ids3 = ((ao && ao.log) || []).map((x) => x.id);
    rep.add('LOGG borttagning egen + ao_edit annans + omsänd borttagning', r.status === 200 && r2.status === 200 && r3.status === 200 && r3.body.noop === true && ids3.length === 1 && ids3[0] === runId + '-L3', 'HTTP ' + r.status + '/' + r2.status + '/' + r3.status + ' (noop ' + r3.body.noop + '); kvar: ' + ids3.join(','));
    // Inga andra AO-fält ändrade.
    const same = ['title', 'status', 'priority', 'description', 'customerId'].every((k) => JSON.stringify(ao[k]) === JSON.stringify(before[k])) && JSON.stringify(ao.staff) === JSON.stringify(before.staff) && JSON.stringify(ao.checklist) === JSON.stringify(before.checklist) && JSON.stringify(ao.materials) === JSON.stringify(before.materials);
    rep.add('LOGG inga andra AO-fält ändrade', same, same ? 'titel, status, prioritet, personal, checklista och material oförändrade' : 'AVVIKER');
    // Historik: kvarvarande post har arbetsledarens staffId.
    rep.add('LOGG historik (vem)', (ao.log[0] || {}).staffId === id.chef, 'kvarvarande post staffId ' + (ao.log[0] || {}).staffId);
  } catch (err) { rep.add('KÖRNING', false, 'avbröts: ' + err.message); }
  if (created) {
    await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'delete_ao', aoId, idempotencyKey: runId + '-stada-d' } });
    await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'permanent_delete_ao', aoId, idempotencyKey: runId + '-stada-p' } });
    const left = await getAO(aoId);
    rep.add('STÄDNING test-AO', !left, left ? 'test-AO finns kvar: ' + aoId : 'test-AO borttagen permanent');
  }
  const f = rep.save({ projekt: env.ref });
  const bad = rep.results.filter((x) => x.ok === false).length;
  console.log('\n' + rep.results.filter((x) => x.ok === true).length + ' OK, ' + bad + ' avvikelser. Rapport: ' + f);
  process.exit(bad ? 1 : 0);
})();
