'use strict';
/*
 * NIVÅ 2 — autentiserade mutationstester (se tests/staging/lib.js).
 *
 * Skriver i databasen. Rör ALDRIG befintliga poster: alla skrivningar görs
 * mot egna, märkta testposter (id börjar med körningens runId
 * "E2E-AUTHZ-<tid>-<slump>", rubrik/kommentar "[E2E-TEST]"), som tas bort
 * igen. Även en tillåten skrivning utan innehållsändring uppdaterar
 * store.updated_at och vift_lastChanged (verifierat mot installerade
 * STAGING-RPC:er) — det är en känd, oundviklig sidoeffekt som redovisas.
 *
 * Spärrar (före första anropet): --jag-har-go, --mutationstest,
 * --bekrafta-projekt=<ref> lika med projektet i adressen, VIFT_MILJO=staging,
 * LIVE-projektet nekas alltid, testkontonas e-post måste matcha
 * testkontomönstret (standard: "e2e" i lokaldelen).
 *
 * Före: läser ögonblicksbild av berörda register, alla AO och alla
 * tidposter (adminkontot); avbryter om testposter från en tidigare körning
 * finns kvar. Under: journal (rapport/<runId>.journal.json) skrivs FÖRE
 * varje mutation. Efter: städning (även vid fel), sedan verifiering att
 * inga testposter finns kvar och att ALLA befintliga poster är oförändrade
 * (inklusive AO:s updatedAt).
 *
 *   ... node tests/staging/authz-mutation.js --jag-har-go --mutationstest --bekrafta-projekt=<ref> [--torrkorning]
 *   ... node tests/staging/authz-mutation.js --jag-har-go --mutationstest --bekrafta-projekt=<ref> --stada=<runId>
 *
 * Konton (miljö): VIFT_USER_ADMIN (ao_create + ao_edit + ao_view_all +
 * tidadmin), VIFT_USER_FALT, VIFT_USER_CHEF, VIFT_USER_EKONOMI,
 * VIFT_USER_BEGRANSAD, valfritt VIFT_USER_FALT2 (checklistans ägarkontroll).
 *
 * Utgångskoder: 0 OK · 1 säkerhetsavvikelse · 2 spärr · 3 städning
 * misslyckades (testposter kvar, se rapporten) · 4 osäkert (befintlig post
 * ändrad under körningen — troligen annan användare, granska).
 */
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const env = L.guard(2);
const { pw, emails } = L.accounts(['admin', 'falt', 'chef', 'ekonomi', 'begransad'], ['falt2']);
const { req, login } = L.client(env);
const DRY = L.arg('torrkorning') === true;
const CLEAN_ONLY = typeof L.arg('stada') === 'string' ? L.arg('stada') : null;
if (CLEAN_ONLY && !/^E2E-AUTHZ-\d{14}-[0-9a-f]{6}$/.test(CLEAN_ONLY)) L.refuse('--stada=<runId> måste vara ett runId av formen E2E-AUTHZ-ååååmmddttmmss-xxxxxx.');
const runId = CLEAN_ONLY || L.newRunId();
const rep = L.reporter(CLEAN_ONLY ? 'authz-stadning' : 'authz-mutation', runId);
const TEST_PREFIX = 'E2E-AUTHZ-';
const isTest = (x, id) => !!x && (String(x.id || '').startsWith(id || TEST_PREFIX) || String(x.title || x.comment || x.name || '').includes(id || TEST_PREFIX));

/* Förväntad skrivbehörighet per register (klientens regler). */
const EXPECT = {
  vift_customers:   { falt: false, chef: true,  ekonomi: false, begransad: false },
  vift_properties:  { falt: false, chef: true,  ekonomi: false, begransad: false },
  vift_offers:      { falt: false, chef: true,  ekonomi: false, begransad: false },
  vift_salesOpps:   { falt: false, chef: true,  ekonomi: false, begransad: false },
  vift_roles:       { falt: false, chef: false, ekonomi: false, begransad: false },
  vift_staff:       { falt: false, chef: false, ekonomi: false, begransad: false },
  vift_settings:    { falt: false, chef: false, ekonomi: false, begransad: false },
  vift_articles:    { falt: false, chef: false, ekonomi: false, begransad: false },
  vift_priceGroups: { falt: false, chef: false, ekonomi: false, begransad: false },
  vift_contracts:   { falt: false, chef: true,  ekonomi: false, begransad: false },
  vift_activities:  { falt: true,  chef: true,  ekonomi: true,  begransad: true },
};
const KEYS = Object.keys(EXPECT);
const G13_ROLES = ['falt', 'chef', 'ekonomi', 'begransad'];

/* Journal: skrivs före varje mutation så att städningen hittar allt. */
const journalFile = path.join(rep.dir, runId + '.journal.json');
const journal = [];
function note(entry) {
  journal.push(Object.assign({ t: new Date().toISOString() }, entry));
  fs.mkdirSync(rep.dir, { recursive: true });
  fs.writeFileSync(journalFile, JSON.stringify({ runId, projekt: env.ref, journal }, null, 2));
}

/* Testpost för array-register: neutral, inaktiv och märkt. */
function testElement(id) {
  const label = '[E2E-TEST] behörighetsprov ' + runId + ' — tas bort automatiskt';
  return { id, e2eTest: runId, name: label, title: label, text: label, label, firstName: '[E2E-TEST]', lastName: runId, active: false, deleted: true, permissions: [] };
}

let tok = {};
const ids = {};
async function snapshot() {
  const ra = await req('/functions/v1/store-key-write', { token: tok.admin, body: { action: 'readAllWithHashes', keys: KEYS } });
  const wl = await req('/functions/v1/work-orders-list', { method: 'GET', token: tok.admin });
  const tl = await req('/functions/v1/time-entries-list', { method: 'GET', token: tok.admin });
  if (ra.status !== 200 || wl.status !== 200 || tl.status !== 200) throw new Error('ögonblicksbild misslyckades (HTTP ' + [ra.status, wl.status, tl.status].join('/') + ') — adminkontot måste kunna läsa register, alla AO och alla tidposter');
  const data = {};
  const d = ra.body.data || {};
  KEYS.forEach((k) => { const short = k.replace(/^vift_/, ''); data[k] = Object.prototype.hasOwnProperty.call(d, short) ? d[short] : d[k]; });
  return { data, hashes: ra.body.hashes || {}, aos: wl.body.workOrders || [], tes: tl.body.timeEntries || [] };
}
const byId = (arr) => new Map((arr || []).filter((x) => x && x.id != null).map((x) => [String(x.id), L.stable(x)]));

async function cleanup(prefix, snap) {
  let failed = [];
  // Register-element
  for (const k of KEYS) {
    const arr = snap.data[k];
    if (!Array.isArray(arr)) continue;
    for (const el of arr.filter((x) => isTest(x, prefix))) {
      const r = await req('/functions/v1/store-key-write', { token: tok.admin, body: { action: 'writeMerge', key: k, upserts: [], removals: [{ id: el.id, previous: el }] } });
      if (r.status !== 200 || (r.body.conflicts || []).length) failed.push(k + ':' + el.id + ' (HTTP ' + r.status + ')');
    }
  }
  // Tidposter
  for (const te of snap.tes.filter((x) => isTest(x, prefix))) {
    const r = await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'delete_time', entryId: te.id, idempotencyKey: prefix + '-cleanup-' + te.id } });
    if (r.status !== 200 && r.status !== 404) failed.push('tidpost ' + te.id + ' (HTTP ' + r.status + ' ' + (r.body.error || '') + ')');
  }
  // Test-AO
  for (const ao of snap.aos.filter((x) => isTest(x, prefix))) {
    if (!ao.deleted) await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'delete_ao', aoId: ao.id, idempotencyKey: prefix + '-del-' + ao.id } });
    const r = await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'permanent_delete_ao', aoId: ao.id, idempotencyKey: prefix + '-pdel-' + ao.id } });
    if (r.status !== 200 && r.status !== 404) failed.push('AO ' + ao.id + ' (HTTP ' + r.status + ' ' + (r.body.error || '') + ')');
  }
  return failed;
}

function leftovers(snap, prefix) {
  const out = [];
  KEYS.forEach((k) => (Array.isArray(snap.data[k]) ? snap.data[k] : []).filter((x) => isTest(x, prefix)).forEach((x) => out.push(k + ':' + x.id)));
  snap.aos.filter((x) => isTest(x, prefix)).forEach((x) => out.push('AO ' + x.id));
  snap.tes.filter((x) => isTest(x, prefix)).forEach((x) => out.push('tidpost ' + x.id));
  return out;
}

/* Befintliga (icke-test) poster: identiska före och efter? */
function compare(before, after) {
  const changed = [];
  const cmp = (label, a, b) => {
    const A = byId((a || []).filter((x) => !isTest(x))), B = byId((b || []).filter((x) => !isTest(x)));
    for (const [id, v] of A) if (B.get(id) !== v) changed.push(label + ' ' + id + (B.has(id) ? ' ändrad' : ' borta'));
    for (const id of B.keys()) if (!A.has(id)) changed.push(label + ' ' + id + ' ny');
  };
  KEYS.forEach((k) => { if (Array.isArray(before.data[k])) cmp(k, before.data[k], after.data[k]); else if (L.stable(before.data[k]) !== L.stable(after.data[k])) changed.push(k + ' (objekt) ändrad'); });
  cmp('AO', before.aos, after.aos);
  cmp('tidpost', before.tes, after.tes);
  return changed;
}

(async () => {
  console.log('Nivå 2 — MUTATIONSTEST mot projekt ' + env.ref + (DRY ? ' (TORRKÖRNING: inga skrivningar)' : CLEAN_ONLY ? ' (STÄDNING av ' + CLEAN_ONLY + ')' : '') + '. runId ' + runId + '\n');
  for (const [r, e] of Object.entries(emails)) tok[r] = await login(e, pw);
  const before = await snapshot();

  // Personalposter för testkontona (för tilldelning och ägarkontroll).
  const st = await req('/rest/v1/store?select=value&key=eq.vift_staff', { method: 'GET', token: tok.admin });
  const staff = (st.body && st.body[0] && st.body[0].value) || [];
  for (const [r, e] of Object.entries(emails)) {
    const s = staff.find((x) => String(x.email || '').toLowerCase() === e.toLowerCase());
    if (!s) L.refuse('testkontot för ' + r + ' saknar personalpost.');
    ids[r] = String(s.id);
  }

  if (CLEAN_ONLY) {
    const failed = await cleanup(CLEAN_ONLY, before);
    const after = await snapshot();
    const left = leftovers(after, CLEAN_ONLY);
    rep.add('STÄDNING', left.length === 0 && failed.length === 0, left.length ? 'kvar: ' + left.join(', ') : 'inga testposter kvar för ' + CLEAN_ONLY);
    rep.save({ niva: 2, projekt: env.ref, lage: 'stadning', kvar: left });
    process.exit(left.length ? L.EXIT.STADNING_MISSLYCKADES : L.EXIT.OK);
  }

  const old = leftovers(before);
  if (old.length) L.refuse('testposter från en tidigare körning finns kvar (' + old.slice(0, 5).join(', ') + (old.length > 5 ? ' …' : '') + '). Kör --stada=<runId> först.');

  const plan = [
    'G13: ' + KEYS.filter((k) => Array.isArray(before.data[k])).length + ' array-register × ' + G13_ROLES.length + ' roller — märkt testpost upsert, tas bort direkt (icke-array-register prövas inte)',
    'Test-AO ' + runId + '-AO skapas (admin), tilldelas fältkontot/-kontona',
    'G9: ekonomi försöker sätta test-AO:n till "fakturerad"',
    'G6: två samtidiga create_time med samma idempotensnyckel (fält) på test-AO:n',
    'Checklista: tre lägen + ägarkontroll på test-AO:n (om servern stöder det' + (emails.falt2 ? '' : '; ägarkontroll mellan två fältkonton kräver VIFT_USER_FALT2') + ')',
    'Städning: alla poster med ' + runId + ' tas bort; verifiering att befintliga poster är oförändrade',
  ];
  plan.forEach((p) => console.log('  • ' + p));
  console.log('  Kända sidoeffekter: vift_lastChanged och store.updated_at för berörda nycklar ändras; inloggningsposter i auth-schemat.\n');
  if (DRY) { rep.add('TORRKÖRNING', null, 'spärrar, inloggning och ögonblicksbild OK — inga skrivningar gjorda'); rep.save({ niva: 2, projekt: env.ref, lage: 'torrkorning', plan }); process.exit(L.EXIT.OK); }

  let aoId = null;
  try {
    // ── G13: per register och roll, märkt testpost ──────────────────
    for (const key of KEYS) {
      if (!Array.isArray(before.data[key])) { rep.add('G13 ' + key, null, 'inte ett array-register — prövas inte med testpost (ingen skrivning)'); continue; }
      for (const role of G13_ROLES) {
        const id = runId + '-' + key.replace(/^vift_/, '') + '-' + role;
        const el = testElement(id);
        note({ typ: 'element', key, id, roll: role });
        const r = await req('/functions/v1/store-key-write', { token: tok[role], body: { action: 'writeMerge', key, upserts: [{ id, data: el, previous: null }], removals: [] } });
        const allowed = r.status === 200 && !(r.body.conflicts || []).length;
        const denied = r.status === 401 || r.status === 403;
        if (allowed) {
          const rm = await req('/functions/v1/store-key-write', { token: tok[role], body: { action: 'writeMerge', key, upserts: [], removals: [{ id, previous: el }] } });
          if (rm.status !== 200) await req('/functions/v1/store-key-write', { token: tok.admin, body: { action: 'writeMerge', key, upserts: [], removals: [{ id, previous: el }] } });
        }
        if (!allowed && !denied) { rep.add('G13 ' + key + ' ' + role, null, 'oväntat svar HTTP ' + r.status + ' ' + (r.body.error || '')); continue; }
        rep.add('G13 ' + key + ' ' + role, allowed === EXPECT[key][role], (allowed ? 'servern TILLÄT skrivning av testpost' : 'servern nekade') + ' (förväntat: ' + (EXPECT[key][role] ? 'tillåten' : 'nekad') + ')');
      }
    }

    // ── Test-AO ─────────────────────────────────────────────────────
    const now = new Date().toISOString();
    const staffIds = [ids.falt].concat(ids.falt2 ? [ids.falt2] : []);
    const aoIn = { id: runId + '-AO', title: '[E2E-TEST] ' + runId, status: 'klar', priority: 'normal', staff: staffIds, customerId: '', description: 'Automatiskt behörighetsprov — tas bort efter körningen.', log: [], materials: [], checklist: [], createdAt: now, updatedAt: now, e2eTest: runId };
    note({ typ: 'ao', id: aoIn.id });
    const c = await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'create_ao', ao: aoIn, idempotencyKey: runId + '-create-ao' } });
    if (c.status !== 200 || !c.body.workOrder) throw new Error('kunde inte skapa test-AO (HTTP ' + c.status + ' ' + (c.body.error || '') + ')');
    aoId = c.body.workOrder.id;
    if (aoId !== aoIn.id) note({ typ: 'ao', id: aoId, anm: 'servern gav eget id' });
    const getAO = async () => ((await req('/functions/v1/work-orders-list', { method: 'GET', token: tok.admin })).body.workOrders || []).find((a) => a.id === aoId);

    // ── G9: ekonomi sätter test-AO:n till "fakturerad" ──────────────
    const ao0 = await getAO();
    const g9 = await req('/functions/v1/ao-time-write', { token: tok.ekonomi, body: { action: 'patch_ao', aoId, patch: { status: 'fakturerad' }, expectedUpdatedAt: ao0 ? ao0.updatedAt : null, idempotencyKey: runId + '-g9' } });
    const ao1 = await getAO();
    rep.add('G9 ekonomi → fakturerad (test-AO)', null, 'HTTP ' + g9.status + ' ' + (g9.body.error || 'ok') + '; status efteråt: ' + (ao1 && ao1.status) + ' — beslut om behörigheten tas av Lucas utifrån detta');

    // ── G6: dubbel create_time med samma nyckel ─────────────────────
    const tId = runId + '-T1';
    const entry = { id: tId, aoId, staffId: ids.falt, date: now.slice(0, 10), startStr: '08:00', endStr: '08:30', minutes: 30, comment: '[E2E-TEST] ' + runId };
    note({ typ: 'tidpost', id: tId });
    const [a, b] = await Promise.all([1, 2].map(() => req('/functions/v1/ao-time-write', { token: tok.falt, body: { action: 'create_time', entry, idempotencyKey: runId + '-g6' } })));
    const tl = await req('/functions/v1/time-entries-list', { method: 'GET', token: tok.admin });
    const n = ((tl.body && tl.body.timeEntries) || []).filter((e) => isTest(e, runId)).length;
    rep.add('G6 dubbel create_time samma nyckel', n === 1, 'svar ' + a.status + '/' + b.status + ', tidposter på servern: ' + n);

    // ── Checklista (om servern stöder tre lägen) ────────────────────
    const ck = (token, body) => req('/functions/v1/work-order-checklist-resolve', { token, body: Object.assign({ aoId, avvikelse: 'v2:' + body.action }, body) });
    const probe = await ck(tok.falt, { itemId: '__vift_probe__', action: 'start' });
    if (probe.body.error !== 'item_not_found') rep.add('CHK', null, 'servern stöder inte tre lägen ännu (svar ' + (probe.body.error || probe.status) + ') — hoppas över');
    else {
      const it = runId + '-K1';
      note({ typ: 'checkpunkt', aoId, id: it });
      const add = await ck(tok.admin, { itemId: it, action: 'add', text: '[E2E-TEST] punkt' });
      const s1 = await ck(tok.falt, { itemId: it, action: 'start' });
      const after1 = await getAO();
      rep.add('CHK påbörja (fält)', add.status === 200 && s1.status === 200 && after1.status === (ao1 && ao1.status), 'HTTP ' + add.status + '/' + s1.status + '; AO-status oförändrad: ' + (after1.status === (ao1 && ao1.status)));
      if (tok.falt2) {
        const other = await ck(tok.falt2, { itemId: it, action: 'reset' });
        rep.add('CHK återställ annans (fält2, ao_checklist)', other.status === 403 && other.body.error === 'forbidden_other', 'HTTP ' + other.status + ' ' + (other.body.error || ''));
      } else rep.add('CHK återställ annans', null, 'VIFT_USER_FALT2 saknas — hoppas över');
      const own = await ck(tok.falt, { itemId: it, action: 'reset' });
      rep.add('CHK återställ egen (fält)', own.status === 200, 'HTTP ' + own.status);
      const d = await ck(tok.falt, { itemId: it, action: 'done' });
      const ed = await ck(tok.admin, { itemId: it, action: 'reset' });
      const fin = await getAO();
      const item = ((fin && fin.checklist) || []).find((x) => x.id === it);
      rep.add('CHK ao_edit återställer annans + historik', d.status === 200 && ed.status === 200 && item && (item.history || []).map((h) => h.a).join(',') === 'add,start,reset,done,reset', 'HTTP ' + d.status + '/' + ed.status + '; historik: ' + (item ? (item.history || []).map((h) => h.a).join(',') : '—'));
    }
  } catch (e) {
    rep.add('KÖRNING', false, 'avbröts: ' + e.message + ' — städar ändå');
  }

  // ── Städning (alltid) och efterkontroll ───────────────────────────
  const mid = await snapshot();
  const failedCleanup = await cleanup(runId, mid);
  const after = await snapshot();
  const left = leftovers(after, runId);
  rep.add('STÄDNING', left.length === 0, left.length ? 'TESTPOSTER KVAR: ' + left.join(', ') + ' — kör --stada=' + runId : 'inga testposter kvar' + (failedCleanup.length ? ' (efter omförsök: ' + failedCleanup.join(', ') + ')' : ''));
  const changed = compare(before, after);
  rep.add('BEFINTLIGA POSTER', changed.length === 0 ? true : null, changed.length ? 'ändrade under körningen (granska — testet rör inte befintliga poster, troligen annan användare): ' + changed.slice(0, 20).join(', ') : 'alla befintliga register-element, AO (inkl. updatedAt) och tidposter identiska före och efter');
  const sameHash = KEYS.filter((k) => before.hashes[k] && before.hashes[k] === after.hashes[k]).length;
  rep.add('SIDOEFFEKTER', null, sameHash + '/' + KEYS.length + ' registers innehåll bitidentiskt efter städning; vift_lastChanged/store.updated_at har ändrats (förväntat)');

  const f = rep.save({ niva: 2, projekt: env.ref, journal: journalFile, kvar: left, andradeBefintliga: changed });
  const bad = rep.results.filter((r) => r.ok === false && r.id !== 'STÄDNING').length;
  console.log('\nRapport: ' + f);
  process.exit(left.length ? L.EXIT.STADNING_MISSLYCKADES : bad ? L.EXIT.AVVIKELSE : changed.length ? L.EXIT.OSAKER : L.EXIT.OK);
})().catch((e) => { console.error('Fel:', e.message); process.exit(L.EXIT.AVVIKELSE); });
