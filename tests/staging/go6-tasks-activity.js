'use strict';
/*
 * GO-6 verifiering mot STAGING: per-post-regel för uppgifter (vift_activities)
 * och append-only aktivitetsflöde (appendActivity). Skriver bara egna märkta
 * testposter (id innehåller runId) och tar bort uppgifterna efteråt.
 * Aktivitetsflödets testposter kan inte tas bort via API (append-only); de
 * listas i rapporten och städas separat av operatören.
 *   node tests/staging/go6-tasks-activity.js --jag-har-go --mutationstest --bekrafta-projekt=<ref>
 */
const L = require('./lib');
const env = L.guard(2);
const { pw, emails } = L.accounts(['admin', 'falt', 'falt2', 'chef', 'begransad'], []);
const { req, login } = L.client(env);
const runId = L.newRunId().replace('E2E-AUTHZ', 'E2E-GO6');
const rep = L.reporter('go6', runId);
const W = (tok, body) => req('/functions/v1/store-key-write', { token: tok, body });
(async () => {
  const tok = {}; for (const [r, e] of Object.entries(emails)) tok[r] = await login(e, pw);
  const st = await req('/rest/v1/store?select=value&key=eq.vift_staff', { method: 'GET', token: tok.admin });
  const staff = (st.body && st.body[0] && st.body[0].value) || [];
  const id = {}; for (const [r, e] of Object.entries(emails)) id[r] = String((staff.find((s) => String(s.email).toLowerCase() === e) || {}).id || '');
  const now = new Date().toISOString();
  const task = (tid, createdBy, assignedTo, extra) => Object.assign({ id: tid, title: '[E2E-TEST] ' + runId, status: 'open', createdBy, assignedTo, createdAt: now, e2eTest: runId }, extra || {});
  const cur = async (tid) => { const r = await W(tok.admin, { action: 'readWithHash', key: 'vift_activities' }); return ((r.body && r.body.value) || []).find((x) => x.id === tid) || null; };
  const ok = (r) => r.status === 200 && !(r.body.conflicts || []).length;
  const made = [];
  const up = async (who, el, prev) => { const r = await W(tok[who], { action: 'writeMerge', key: 'vift_activities', upserts: [{ id: el.id, data: el, previous: prev }], removals: [] }); if (ok(r) && !prev) made.push(el.id); return r; };
  try {
    // Egen ny uppgift (fält) tillåts; ny uppgift åt annan nekas.
    const T1 = runId + '-T1', T2 = runId + '-T2', T3 = runId + '-T3', T4 = runId + '-T4';
    let r = await up('falt', task(T1, id.falt, id.falt), null);
    rep.add('UPP fält skapar egen uppgift', ok(r), 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    r = await up('falt', task(T2, id.falt, id.falt2), null);
    rep.add('UPP fält skapar uppgift åt annan', r.status === 403, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    r = await up('falt', task(T4, id.falt2, id.falt2), null);
    rep.add('UPP fält skapar uppgift i annans namn (createdBy)', r.status === 403, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    // Arbetsledare skapar uppgift åt fält (full åtkomst).
    r = await up('chef', task(T3, id.chef, id.falt), null);
    rep.add('UPP arbetsledare skapar uppgift åt fält', ok(r), 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    // Ansvarig (fält) får klarmarkera, inte ändra rubrik eller ange annan som utförare.
    let p = await cur(T3);
    r = await up('falt', Object.assign({}, p, { title: '[E2E-TEST] ändrad ' + runId }), p);
    rep.add('UPP ansvarig ändrar rubrik', r.status === 403, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    r = await up('falt', Object.assign({}, p, { status: 'done', completedAt: now, completedBy: id.falt2 }), p);
    rep.add('UPP ansvarig anger annan som utförare', r.status === 403, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    r = await up('falt2', Object.assign({}, p, { status: 'done', completedAt: now, completedBy: id.falt2 }), p);
    rep.add('UPP annan fältarbetare klarmarkerar andras uppgift', r.status === 403, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    r = await up('falt', Object.assign({}, p, { status: 'done', completedAt: now, completedBy: id.falt }), p);
    p = await cur(T3);
    rep.add('UPP ansvarig klarmarkerar egen tilldelad uppgift', ok(r) && p && p.status === 'done' && p.completedBy === id.falt, 'HTTP ' + r.status + '; status ' + (p && p.status));
    // Falskt previous ger konflikt, ingen skrivning.
    const fake = Object.assign({}, p, { status: 'open' });
    r = await up('falt', Object.assign({}, p, { status: 'open' }), fake);
    const p2 = await cur(T3);
    rep.add('UPP falskt previous', !ok(r) && p2 && p2.status === 'done', 'HTTP ' + r.status + ' konflikter ' + ((r.body.conflicts || []).length) + '; status kvar ' + (p2 && p2.status));
    // Radering: fält får inte radera arbetsledarens uppgift, men sin egen.
    r = await W(tok.falt, { action: 'writeMerge', key: 'vift_activities', upserts: [], removals: [{ id: T3, previous: p2 }] });
    rep.add('UPP fält raderar uppgift skapad av annan', r.status === 403, 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    const p1 = await cur(T1);
    r = await W(tok.falt, { action: 'writeMerge', key: 'vift_activities', upserts: [], removals: [{ id: T1, previous: p1 }] });
    rep.add('UPP fält raderar egen uppgift', ok(r) && !(await cur(T1)), 'HTTP ' + r.status);
    // Aktivitetsflöde.
    const aid = 'ACT-' + runId.replace(/[^A-Za-z0-9-]/g, '') ;
    r = await W(tok.falt, { action: 'appendActivity', entry: { id: aid, type: 'note', description: '[E2E-TEST] ' + runId, userId: 'FÖRFALSKAD', timestamp: '2000-01-01T00:00:00Z', workOrderId: '' } });
    const lg = await W(tok.admin, { action: 'readWithHash', key: 'vift_activityLog' });
    const e = ((lg.body && lg.body.value) || []).find((x) => x.id === aid);
    rep.add('LOGG appendActivity (fält)', r.status === 200 && !!e && e.userId === id.falt && e.source === 'klientrapport' && e.timestamp !== '2000-01-01T00:00:00Z', 'HTTP ' + r.status + '; userId ' + (e && e.userId) + ' (förfalskat värde ignorerat: ' + (e && e.userId !== 'FÖRFALSKAD') + '), källa ' + (e && e.source));
    r = await W(tok.falt, { action: 'appendActivity', entry: { id: aid, type: 'note', description: 'igen' } });
    rep.add('LOGG omsändning samma id', r.status === 200 && r.body.duplicate === true, 'HTTP ' + r.status + ' duplicate=' + r.body.duplicate);
    r = await W(tok.falt, { action: 'appendActivity', entry: { id: aid + '-X', type: 'hackad_typ' } });
    rep.add('LOGG okänd typ nekas', r.status === 400 && r.body.error === 'invalid_type', 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    r = await W(tok.falt, { action: 'appendActivity', entry: { id: aid + '-Y', type: 'note', workOrderId: "x'; drop table" } });
    rep.add('LOGG ogiltig referens nekas', r.status === 400 && r.body.error === 'invalid_reference', 'HTTP ' + r.status + ' ' + (r.body.error || ''));
    for (const who of ['falt', 'admin']) {
      const wm = await W(tok[who], { action: 'writeMerge', key: 'vift_activityLog', upserts: [], removals: [{ id: aid, previous: e }] });
      rep.add('LOGG append-only writeMerge (' + who + ')', wm.status === 403 && wm.body.error === 'append_only', 'HTTP ' + wm.status + ' ' + (wm.body.error || ''));
    }
    const wr = await W(tok.admin, { action: 'write', key: 'vift_activityLog', value: [], expectedHash: lg.body.hash });
    rep.add('LOGG append-only write (admin)', wr.status === 403 && wr.body.error === 'append_only', 'HTTP ' + wr.status + ' ' + (wr.body.error || ''));
    rep.add('LOGG testposter kvar (append-only)', null, 'id ' + aid + ' — städas av operatören (postgres), se rapport');
  } catch (err) { rep.add('KÖRNING', false, 'avbröts: ' + err.message); }
  // Städning av uppgifter (arbetsledare har full åtkomst).
  for (const tid of made) { const p = await cur(tid); if (p) await W(tok.chef, { action: 'writeMerge', key: 'vift_activities', upserts: [], removals: [{ id: tid, previous: p }] }); }
  const left = []; for (const tid of made) if (await cur(tid)) left.push(tid);
  rep.add('STÄDNING uppgifter', left.length === 0, left.length ? 'kvar: ' + left.join(', ') : made.length + ' testuppgifter borttagna');
  const f = rep.save({ projekt: env.ref });
  const bad = rep.results.filter((x) => x.ok === false).length;
  console.log('\n' + rep.results.filter((x) => x.ok === true).length + ' OK, ' + bad + ' avvikelser. Rapport: ' + f);
  process.exit(bad ? 1 : 0);
})();
