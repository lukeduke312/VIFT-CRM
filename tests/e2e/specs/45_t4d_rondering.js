'use strict';
/*
 * T4-D (2026-11-28): rondering per pass (rondering_utfor, Ö3, SÄK-14) i klienten mot den simulerade servern
 * (tests/e2e/t4d-regler.js = vift-v2 20261128000013, paritet i tests/sim_parity.test.js).
 *
 *  T4D-01  SEC-ROND-01: fältet (standardrollen personal) öppnar sitt eget pass via länken, kryssar punkter
 *          och slutför; servern sätter checkedBy/completedBy; tillståndet innehåller bara egna pass och
 *          ronderingen utan pris och intern anteckning.
 *  T4D-02  SEC-ROND-02/03/04: annans pass syns inte och nekas vid direktanrop (403 not_assigned); skapa pass
 *          nekas (403 forbidden); begränsad når inte utförandesidan och nekas av servern.
 *  T4D-03  R53: fältets anmärkning sparas på punkten utan avvikelse eller AO (servern skulle neka dem);
 *          ingen "Skapa AO" i dialogen.
 *  T4D-04  Arbetsledarens flöde oförändrat: chef utför fältets pass och ser alla pass.
 *
 * Nivå: lokalt verifierad mot fake-backend.js. Inget här är verifierat i STAGING.
 */
const WORLD = { backend: { keyPerms: require('../server-key-perms.js'), activitiesPolicy: true, activityAppend: true } };
const direkt = (s, ef, body) => s.eval(async ([e, b]) => {
  const r = await fetch(SUPABASE_URL + '/functions/v1/' + e, { method: 'POST', headers: { Authorization: 'Bearer ' + Auth.getAccessToken(), apikey: SUPABASE_AKEY, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  let d = {}; try { d = await r.json(); } catch (x) {}
  return { status: r.status, error: d.error, reason: d.reason, body: d };
}, [ef, body]);
const pass = (t, id) => (t.fake.get('ronderingspass') || []).find((p) => p.id === id);
/* Ett pass för FÄ2 (ST-004) och prissatt rondering med intern anteckning. */
const varld = (t) => {
  const ps = t.fake.get('ronderingspass');
  const p2 = JSON.parse(JSON.stringify(ps.find((p) => p.id === 'PASS-002')));
  t.fake.set('ronderingspass', ps.concat([Object.assign(p2, { id: 'PASS-T4D-ANNAN', staffIds: ['ST-004'], sequenceNumber: 9 })]));
  t.fake.set('ronderingar', t.fake.get('ronderingar').map((r) => Object.assign({}, r, { internalNote: 'INTERN-T4D', hourRate: 650 })));
};

module.exports = [
  {
    id: 'T4D-01', world: WORLD, module: 'Säkerhet', name: 'SEC-ROND-01: fältet utför och slutför sitt eget pass; servern sätter utförare; tillståndet har bara egna pass utan pris och intern anteckning',
    async run(t) {
      varld(t);
      const s = await t.world.session({ viewport: 'mobile' });
      await s.login('falt');
      await s.settle(1000);
      const st = await s.eval(() => ({ pass: (state.ronderingspass || []).map((p) => p.id).sort(), ron: state.ronderingar || [], mallar: (state.ronderingsmallar || []).length, kan: Auth.canViewPage('pg-rondering-utfor'), lista: Auth.canViewPage('pg-rondering') }));
      t.assert(st.pass.join() === 'PASS-001,PASS-002' && st.mallar === 0, 'tillståndet innehåller bara fältets egna pass och inga mallar: ' + st.pass.join());
      t.assert(st.ron.length > 0 && !JSON.stringify(st.ron).includes('INTERN-T4D') && !st.ron.some((r) => 'hourRate' in r), 'ronderingen för egna pass utan pris och intern anteckning');
      t.assert(st.kan === true && st.lista === false, 'utförandesidan öppnas med rondering_utfor (listan/guiden kräver fortfarande ao_view_all)');
      await s.go('pg-rondering-utfor', { passId: 'PASS-002' });
      await s.settle(1200);
      const p0 = pass(t, 'PASS-002');
      const cat = p0.categories[0];
      for (const pt of cat.points.slice(0, 2)) {
        await s.page.locator(`button[onclick="RonderingUtforandePage.markOk('PASS-002','${cat.id}','${pt.id}')"]`).click();
        await s.settle(500);
      }
      const p1 = pass(t, 'PASS-002');
      t.assert(p1.status === 'pågående' && p1.categories[0].points.slice(0, 2).every((x) => x.status === 'ok' && x.checkedBy === 'ST-002'), 'punkterna sparade på servern med checkedBy = fältet; passet startat');
      await s.eval(() => RonderingUtforandePage.complete());
      await s.settle(1200);
      const p2 = pass(t, 'PASS-002');
      t.assert(['slutfört', 'har_avvikelser'].includes(p2.status) && p2.completedBy === 'ST-002', 'passet slutfört av servern, completedBy = fältet: ' + p2.status);
      const d = await direkt(s, 'rondering-pass-write', { action: 'pointPatch', passId: 'PASS-002', categoryId: cat.id, pointId: cat.points[3].id, status: 'ok' });
      t.assert(d.status === 409 && d.error === 'pass_completed', 'fältet ändrar inte sitt avslutade pass (409 pass_completed)');
    },
  },
  {
    id: 'T4D-02', world: WORLD, module: 'Säkerhet', name: 'SEC-ROND-02/03/04: annans pass syns inte och nekas (not_assigned); skapa pass nekas; begränsad nekas',
    async run(t) {
      varld(t);
      const s = await t.world.session({ viewport: 'mobile' });
      await s.login('falt');
      await s.settle(1000);
      await s.go('pg-rondering-utfor', { passId: 'PASS-T4D-ANNAN' });
      await s.settle(800);
      const txt = await s.eval(() => (document.getElementById('pg-rondering-utfor-content') || document.body).innerText);
      t.assert(/hittades inte/i.test(txt), 'annans pass finns inte i fältets tillstånd — sidan visar "Tillfälle hittades inte"');
      const fore = JSON.stringify(pass(t, 'PASS-T4D-ANNAN'));
      let d = await direkt(s, 'rondering-pass-write', { action: 'pointPatch', passId: 'PASS-T4D-ANNAN', categoryId: 'cat-1', pointId: 'pt-1-1', status: 'ok' });
      t.assert(d.status === 403 && d.error === 'forbidden' && d.reason === 'not_assigned' && JSON.stringify(pass(t, 'PASS-T4D-ANNAN')) === fore, 'SEC-ROND-02: annans pass → 403 forbidden/not_assigned, passet oförändrat');
      d = await direkt(s, 'rondering-pass-write', { action: 'create', passTemplate: { ronderingId: 'RON-002', categories: [] } });
      t.assert(d.status === 403 && d.error === 'forbidden' && !d.reason, 'SEC-ROND-03: skapa pass → 403 forbidden');
      const b = await t.world.session({ viewport: 'mobile' });
      await b.login('begransad');
      await b.settle(800);
      t.assert(await b.eval(() => !Auth.canViewPage('pg-rondering-utfor') && (state.ronderingspass || []).length === 0), 'begränsad: ingen utförandesida och inga pass');
      d = await direkt(b, 'rondering-pass-write', { action: 'pointPatch', passId: 'PASS-002', categoryId: 'cat-1', pointId: 'pt-1-1', status: 'ok' });
      t.assert(d.status === 403 && d.error === 'forbidden', 'SEC-ROND-04: begränsad → 403 forbidden');
    },
  },
  {
    id: 'T4D-03', world: WORLD, module: 'Säkerhet', name: 'R53: fältets anmärkning sparas på punkten utan avvikelse eller AO; ingen "Skapa AO" i dialogen',
    async run(t) {
      const s = await t.world.session({ viewport: 'mobile' });
      await s.login('falt');
      await s.settle(1000);
      await s.go('pg-rondering-utfor', { passId: 'PASS-002' });
      await s.settle(1000);
      const p0 = pass(t, 'PASS-002');
      const cat = p0.categories[0], pt = cat.points[0];
      const avv0 = (t.fake.get('avvikelser') || []).length, ao0 = (t.fake.get('workOrders') || []).length;
      await s.eval(([c, p]) => RonderingUtforandePage.openAvvModal('PASS-002', c, p), [cat.id, pt.id]);
      await s.settle(400);
      const modal = await s.eval(() => (document.querySelector('.modal-overlay.open') || document.body).innerHTML);
      t.assert(!/avv-create-ao/.test(modal), 'dialogen saknar "Skapa AO" för fältet');
      await s.eval(() => { document.getElementById('avv-title').value = 'Trasig lampa'; const c = document.getElementById('avv-comment'); if (c) c.value = 'Trapphus B'; });
      await s.eval(([c, p]) => RonderingUtforandePage._saveAvv('PASS-002', c, p, false), [cat.id, pt.id]);
      await s.settle(1000);
      const q = pass(t, 'PASS-002').categories[0].points[0];
      t.assert(q.status === 'anmärkning' && /Trasig lampa/.test(q.comment) && !q.deviationId && q.checkedBy === 'ST-002', 'punkten sparad som anmärkning med rubrik och kommentar, utan avvikelsereferens: ' + JSON.stringify(q));
      t.assert((t.fake.get('avvikelser') || []).length === avv0 && (t.fake.get('workOrders') || []).length === ao0, 'ingen avvikelse och ingen AO skapad');
    },
  },
  {
    id: 'T4D-04', world: WORLD, module: 'Säkerhet', name: 'Arbetsledarens flöde oförändrat: chef ser alla pass och utför fältets pass',
    async run(t) {
      varld(t);
      const c = await t.world.session({ viewport: 'laptop' });
      await c.login('chef');
      await c.settle(1000);
      const st = await c.eval(() => ({ pass: (state.ronderingspass || []).map((p) => p.id).sort(), mallar: (state.ronderingsmallar || []).length, ron: JSON.stringify(state.ronderingar || []) }));
      t.assert(st.pass.join() === 'PASS-001,PASS-002,PASS-T4D-ANNAN' && st.mallar > 0 && st.ron.includes('INTERN-T4D'), 'arbetsledaren ser alla pass, mallar och hela ronderingen');
      const d = await direkt(c, 'rondering-pass-write', { action: 'pointPatch', passId: 'PASS-002', categoryId: 'cat-1', pointId: 'pt-1-1', status: 'ok' });
      t.assert(d.status === 200 && pass(t, 'PASS-002').categories[0].points[0].checkedBy === 'ST-003', 'arbetsledaren utför fältets pass (200)');
      const e = await direkt(c, 'rondering-pass-write', { action: 'pointPatch', passId: 'PASS-001', categoryId: 'cat-1', pointId: 'pt-1-1', status: 'ok' });
      t.assert(e.status === 200, 'arbetsledaren ändrar även ett avslutat pass (oförändrat beteende, som servern)');
    },
  },
];
