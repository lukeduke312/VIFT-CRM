'use strict';
/*
 * QA-P0-1 regressionstest mot STAGING: ao-time-write patch_ao för
 * materialrader från fältroll (ao_material utan ao_edit). Skapar två märkta
 * test-AO (admin; en tilldelad fält 1, en tilldelad fält 2), provar
 * behörighetsgränserna och idempotensen, och tar bort test-AO:erna
 * permanent. Rör inga befintliga poster.
 *   node tests/staging/qa-ao-material.js --jag-har-go --mutationstest --bekrafta-projekt=<ref>
 */
const L = require('./lib');
const env = L.guard(2);
const { pw, emails } = L.accounts(['admin', 'falt', 'falt2', 'chef', 'begransad', 'ekonomi'], []);
const { req, login } = L.client(env);
const runId = L.newRunId().replace('E2E-AUTHZ', 'E2E-QAMAT');
const rep = L.reporter('qa-ao-material', runId);
(async () => {
  const tok = {}; for (const [r, e] of Object.entries(emails)) tok[r] = await login(e, pw);
  const st = await req('/rest/v1/store?select=value&key=eq.vift_staff', { method: 'GET', token: tok.admin });
  const staff = (st.body && st.body[0] && st.body[0].value) || [];
  const id = {}; for (const [r, e] of Object.entries(emails)) id[r] = String((staff.find((s) => String(s.email).toLowerCase() === e) || {}).id || '');
  const W = (who, body) => req('/functions/v1/ao-time-write', { token: tok[who], body });
  const getAO = async (aoId) => { const r = await req('/functions/v1/work-orders-list', { method: 'GET', token: tok.admin }); return ((r.body && r.body.workOrders) || []).find((a) => a.id === aoId); };
  const now = new Date().toISOString();
  const ao1 = runId + '-AO1', ao2 = runId + '-AO2';
  const created = [];
  const mat = (n, extra) => Object.assign({ id: runId + '-M' + n, name: '[E2E-TEST] material ' + n, qty: 2, unit: 'st', buyPrice: 90, sellPrice: 150, vatRate: 25, addedAt: now }, extra || {});
  try {
    for (const [aoId, who] of [[ao1, 'falt'], [ao2, 'falt2']]) {
      const c = await W('admin', { action: 'create_ao', ao: { id: aoId, title: '[E2E-TEST] ' + runId, status: 'planerad', priority: 'normal', staff: [id[who]], customerId: '', description: 'QA-P0-1 materialprov — tas bort efter körningen.', log: [], materials: [], checklist: [], createdAt: now, updatedAt: now, e2eTest: runId }, idempotencyKey: runId + '-c-' + aoId });
      if (c.status !== 200) throw new Error('kunde inte skapa test-AO (HTTP ' + c.status + ' ' + (c.body.error || '') + ')');
      created.push(aoId);
    }
    // 1. Fält 1 lägger till material på egen AO (klientens exakta patchform).
    let r = await W('falt', { action: 'patch_ao', aoId: ao1, patch: { materials: [mat(1)], updatedAt: now }, idempotencyKey: runId + '-p1' });
    let a = await getAO(ao1);
    rep.add('MAT fält lägger till material på tilldelad AO', r.status === 200 && (a.materials || []).length === 1 && a.materials[0].id === runId + '-M1', 'HTTP ' + r.status + ' ' + (r.body.error || '') + '; serverns rader: ' + (a.materials || []).length);
    // 2. Omsändning med samma idempotensnyckel ger ingen dubblett.
    r = await W('falt', { action: 'patch_ao', aoId: ao1, patch: { materials: [mat(1)], updatedAt: now }, idempotencyKey: runId + '-p1' });
    a = await getAO(ao1);
    rep.add('MAT omsändning samma nyckel → ingen dubblett', r.status === 200 && (a.materials || []).length === 1, 'HTTP ' + r.status + '; rader: ' + (a.materials || []).length);
    // 3. Ändra och ta bort egen rad (updateMaterial/deleteMaterial skickar hela arrayen).
    r = await W('falt', { action: 'patch_ao', aoId: ao1, patch: { materials: [mat(1, { qty: 3 }), mat(2)] }, idempotencyKey: runId + '-p3' });
    a = await getAO(ao1);
    const okUpd = r.status === 200 && (a.materials || []).length === 2 && a.materials[0].qty === 3;
    rep.add('MAT fält ändrar antal + lägger till rad 2', okUpd, 'HTTP ' + r.status + '; rader ' + (a.materials || []).length + ', antal rad 1: ' + (a.materials[0] || {}).qty);
    // 4. Blandad patch (material + kund) nekas i sin helhet.
    r = await W('falt', { action: 'patch_ao', aoId: ao1, patch: { materials: [mat(9)], customerId: 'K-FEL' }, idempotencyKey: runId + '-p4' });
    a = await getAO(ao1);
    rep.add('MAT blandad patch (material + kund) nekas', r.status === 403 && (a.customerId || '') === '' && (a.materials || []).length === 2, 'HTTP ' + r.status + ' ' + (r.body.error || '') + '; kund oförändrad: ' + ((a.customerId || '') === ''));
    // 5. Material + status 'pagaende' nekas (ingen ny statusrätt via materialvägen).
    r = await W('falt', { action: 'patch_ao', aoId: ao1, patch: { materials: [mat(9)], status: 'pagaende' }, idempotencyKey: runId + '-p5' });
    rep.add('MAT material + statusändring nekas', r.status === 403, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    // 6. Fält 1 på fält 2:s AO nekas.
    r = await W('falt', { action: 'patch_ao', aoId: ao2, patch: { materials: [mat(7)] }, idempotencyKey: runId + '-p6' });
    a = await getAO(ao2);
    rep.add('MAT fält 1 på fält 2:s AO nekas', r.status === 403 && (a.materials || []).length === 0, 'HTTP ' + r.status + ' ' + (r.body.error || '') + '; rader på AO2: ' + (a.materials || []).length);
    // 7. Roller utan ao_material nekas.
    for (const who of ['begransad', 'ekonomi']) {
      r = await W(who, { action: 'patch_ao', aoId: ao1, patch: { materials: [] }, idempotencyKey: runId + '-p7-' + who });
      rep.add('MAT roll utan ao_material (' + who + ') nekas', r.status === 403, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    }
    // 8. Ogiltig form nekas.
    r = await W('falt', { action: 'patch_ao', aoId: ao1, patch: { materials: ['x'] }, idempotencyKey: runId + '-p8' });
    rep.add('MAT ogiltig materialform nekas', r.status === 400, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    // 9. QA-P1-2: Starta (pågående) på egen AO tillåts, men inte på annans; annan status nekas fortfarande.
    r = await W('falt', { action: 'patch_ao', aoId: ao2, patch: { status: 'pågående' }, idempotencyKey: runId + '-p9x' });
    const r9a = await W('falt', { action: 'patch_ao', aoId: ao1, patch: { status: 'pågående', updatedAt: now }, idempotencyKey: runId + '-p9a' });
    const r9p = await W('falt', { action: 'patch_ao', aoId: ao1, patch: { status: 'pausad' }, idempotencyKey: runId + '-p9p' });
    const r9c = await W('falt', { action: 'patch_ao', aoId: ao1, patch: { status: 'pågående', title: 'x' }, idempotencyKey: runId + '-p9c' });
    a = await getAO(ao1);
    rep.add('START fält startar egen AO; annans/annan status/blandat nekas', r.status === 403 && r9a.status === 200 && a.status === 'pågående' && r9p.status === 403 && r9c.status === 403, 'annans ' + r.status + ', egen ' + r9a.status + ' (status ' + a.status + '), pausad ' + r9p.status + ', blandat ' + r9c.status);
    const r9b = await W('falt', { action: 'patch_ao', aoId: ao1, patch: { status: 'klar', completedAt: now }, idempotencyKey: runId + '-p9b' });
    rep.add('KLAR fält klarmarkerar (oförändrat)', r9b.status === 200, 'HTTP ' + r9b.status);
    // 10. Fakturerad AO: fält får inte ändra materialet.
    const r10a = await W('admin', { action: 'patch_ao', aoId: ao1, patch: { status: 'fakturerad', invoiceId: runId + '-FAKE' }, idempotencyKey: runId + '-p10a' });
    r = await W('falt', { action: 'patch_ao', aoId: ao1, patch: { materials: [] }, idempotencyKey: runId + '-p10b' });
    a = await getAO(ao1);
    rep.add('MAT fakturerad AO låst för fält', r10a.status === 200 && r.status === 403 && (a.materials || []).length === 2, 'HTTP ' + r10a.status + '/' + r.status + '; rader kvar: ' + (a.materials || []).length);
    // 11. Arbetsledare (ao_edit) oförändrat.
    r = await W('chef', { action: 'patch_ao', aoId: ao2, patch: { materials: [mat(5)], title: '[E2E-TEST] ' + runId + ' (chef)' }, idempotencyKey: runId + '-p11' });
    rep.add('MAT arbetsledare (ao_edit) oförändrad', r.status === 200, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    // 12. QA-P1-2: Ta jobb från poolen (falt2 tar AO3 i poolen), inklusive skydd mot loggförlust.
    const ao3 = runId + '-AO3';
    const c3 = await W('admin', { action: 'create_ao', ao: { id: ao3, title: '[E2E-TEST] ' + runId + ' pool', status: 'pool', priority: 'normal', staff: [], customerId: '', log: [{ id: runId + '-L0', type: 'note', text: '[E2E-TEST] befintlig', timestamp: now }], materials: [], checklist: [], createdAt: now, updatedAt: now, e2eTest: runId }, idempotencyKey: runId + '-c-ao3' });
    if (c3.status === 200) created.push(ao3);
    const take = (who, staffArr, log, key) => W(who, { action: 'patch_ao', aoId: ao3, patch: { staff: staffArr, status: 'planerad', log, updatedAt: now }, idempotencyKey: runId + key });
    const tEntry = { id: runId + '-LT', type: 'taken_from_pool', text: '[E2E-TEST] tog jobbet', timestamp: now };
    const bad1 = await take('falt2', [id.falt2], [tEntry], '-t1');               // tappar befintlig loggpost
    const bad2 = await take('falt2', [id.falt2, id.falt], [{ id: runId + '-L0', type: 'note', text: '[E2E-TEST] befintlig', timestamp: now }, tEntry], '-t2'); // lägger till annan person
    const bad3 = await take('begransad', [id.begransad], [{ id: runId + '-L0', type: 'note', text: '[E2E-TEST] befintlig', timestamp: now }, tEntry], '-t3');
    const ok1 = await take('falt2', [id.falt2], [{ id: runId + '-L0', type: 'note', text: '[E2E-TEST] befintlig', timestamp: now }, tEntry], '-t4');
    a = await getAO(ao3);
    const bad4 = await take('falt', [id.falt2, id.falt], (a && a.log) || [], '-t5'); // redan tagen
    rep.add('POOL fält tar jobb; loggförlust/annan person/obehörig/redan tagen nekas', bad1.status === 403 && bad2.status === 403 && bad3.status === 403 && ok1.status === 200 && a && a.status === 'planerad' && JSON.stringify(a.staff) === JSON.stringify([id.falt2]) && (a.log || []).length === 2 && bad4.status === 403,
      'tappar logg ' + bad1.status + ', annan person ' + bad2.status + ', begränsad ' + bad3.status + ', korrekt ' + ok1.status + ' (status ' + (a && a.status) + ', logg ' + ((a && a.log) || []).length + '), redan tagen ' + bad4.status);
  } catch (err) { rep.add('KÖRNING', false, 'avbröts: ' + err.message); }
  for (const aoId of created) {
    await W('admin', { action: 'delete_ao', aoId, idempotencyKey: runId + '-stada-d-' + aoId });
    await W('admin', { action: 'permanent_delete_ao', aoId, idempotencyKey: runId + '-stada-p-' + aoId });
    const left = await getAO(aoId);
    rep.add('STÄDNING ' + aoId.slice(-3), !left, left ? 'test-AO finns kvar: ' + aoId : 'borttagen permanent');
  }
  const f = rep.save({ projekt: env.ref });
  const bad = rep.results.filter((x) => x.ok === false).length;
  console.log('\n' + rep.results.filter((x) => x.ok === true).length + ' OK, ' + bad + ' avvikelser. Rapport: ' + f);
  process.exit(bad ? 1 : 0);
})();
