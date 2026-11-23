'use strict';
/*
 * NIVÅ 2 — autentiserade mutationstester (se tests/staging/lib.js).
 *
 * Skriver i databasen. Rör ALDRIG befintliga poster: alla skrivningar görs
 * mot egna, märkta testposter (id börjar med körningens runId
 * "E2E-AUTHZ-<tid>-<slump>", rubrik/kommentar "[E2E-TEST]"), som tas bort.
 *
 * Spärrar (före första anropet): --jag-har-go, --mutationstest,
 * --bekrafta-projekt=<ref> lika med projektet i adressen, projektet måste
 * vara VIFT CRM:s GODKÄNDA STAGING-projekt (hashlås i lib.js), LIVE nekas,
 * VIFT_MILJO=staging, testkontomönster.
 *
 * Återställning (2026-11-23, förstärkt):
 *  - Journal (rapport/<runId>.journal.json) skrivs FÖRE varje mutation,
 *    med exakt vad som skrivs. Städningen utgår från JOURNALEN — den
 *    behöver ingen fungerande ögonblicksbild — och kompletteras med en
 *    sökning efter runId när ögonblicksbilden går att läsa.
 *  - Varje städåtgärd har ett begränsat antal försök (3, med paus).
 *  - "Återställt" påstås bara efter en lyckad EFTERKONTROLL (ny
 *    ögonblicksbild). Misslyckas den: kod 3 + uppmaning att köra
 *    --stada=<runId>, som läser journalen och gör om städning + kontroll.
 *  - Rapporten sparas alltid, även vid avbrott.
 *
 * Vad som återställs och vad som inte gör det (redovisas i rapporten):
 *  - AFFÄRSPOSTER: testposterna tas bort; befintliga register-element, AO
 *    (inklusive updatedAt) och tidposter jämförs med ögonblicksbilden.
 *  - INTE återställt (metadata): vift_lastChanged och store.updated_at;
 *    serverns idempotensposter för ao-time-write-anropen (op_idempotency);
 *    eventuella aktivitetsloggposter som servern skriver (källa saknas, G4
 *    — jämförs om aktivitetsloggen går att läsa); inloggningar i
 *    auth-schemat; Edge Function-loggar; WAL. Databasen är alltså INTE
 *    bitidentisk efteråt, även när alla affärsposter är återställda.
 *
 * G13-täckning (delvis, inte heltäckande): skrivrätt per ARRAY-register
 * och roll via writeMerge av en ny testpost. INTE prövat: objektformade
 * register (t.ex. inställningar), per-post-regler (egna/andras poster,
 * t.ex. uppgifter i vift_activities), ändring/borttagning av befintliga
 * poster, fältnivå och hel-nyckel-skrivning ('write').
 *
 *   ... node tests/staging/authz-mutation.js --jag-har-go --mutationstest --bekrafta-projekt=<ref> [--torrkorning]
 *   ... node tests/staging/authz-mutation.js --jag-har-go --mutationstest --bekrafta-projekt=<ref> --stada=<runId>
 *
 * Konton (miljö): VIFT_USER_ADMIN (ao_create + ao_edit + ao_view_all +
 * tidadmin), VIFT_USER_FALT, VIFT_USER_CHEF, VIFT_USER_EKONOMI,
 * VIFT_USER_BEGRANSAD, valfritt VIFT_USER_FALT2 (checklistans ägarkontroll).
 *
 * Utgångskoder: 0 OK · 1 säkerhetsavvikelse · 2 spärr · 3 testposter kvar
 * ELLER efterkontrollen kunde inte göras (kör --stada) · 4 osäkert
 * (befintlig post ändrad under körningen) · 5 körningen avbröts (städning
 * efterkontrollerad, men testerna är ofullständiga).
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
const PAUSE_MS = Number(process.env.VIFT_STADA_PAUS_MS || 1500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/* ── Journal ─────────────────────────────────────────────────────────── */
const journalFile = path.join(rep.dir, runId + '.journal.json');
let journal = [];
function saveJournal() {
  fs.mkdirSync(rep.dir, { recursive: true });
  fs.writeFileSync(journalFile, JSON.stringify({ runId, projekt: env.ref, journal }, null, 2));
}
function note(entry) { journal.push(Object.assign({ t: new Date().toISOString(), status: 'avsedd' }, entry)); saveJournal(); return journal[journal.length - 1]; }
function loadJournal() {
  try { const j = JSON.parse(fs.readFileSync(journalFile, 'utf8')); if (j.runId === runId) journal = j.journal || []; } catch (e) {}
}

function testElement(id) {
  const label = '[E2E-TEST] behörighetsprov ' + runId + ' — tas bort automatiskt';
  return { id, e2eTest: runId, name: label, title: label, text: label, label, firstName: '[E2E-TEST]', lastName: runId, active: false, deleted: true, permissions: [] };
}

const tok = {};
const ids = {};

/* Ögonblicksbild. Kastar vid fel — anroparen avgör vad det betyder. */
async function snapshot() {
  const ra = await req('/functions/v1/store-key-write', { token: tok.admin, body: { action: 'readAllWithHashes', keys: KEYS.concat(['vift_activityLog']) } });
  const wl = await req('/functions/v1/work-orders-list', { method: 'GET', token: tok.admin });
  const tl = await req('/functions/v1/time-entries-list', { method: 'GET', token: tok.admin });
  if (ra.status !== 200 || wl.status !== 200 || tl.status !== 200) throw new Error('ögonblicksbild misslyckades (HTTP ' + [ra.status, wl.status, tl.status].join('/') + ')');
  const d = ra.body.data || {};
  const pick = (k) => { const short = k.replace(/^vift_/, ''); return Object.prototype.hasOwnProperty.call(d, short) ? d[short] : d[k]; };
  const data = {};
  KEYS.forEach((k) => { data[k] = pick(k); });
  return { data, hashes: ra.body.hashes || {}, activityLog: pick('vift_activityLog'), aos: wl.body.workOrders || [], tes: tl.body.timeEntries || [] };
}
async function trySnapshot() { try { return { snap: await snapshot() }; } catch (e) { return { err: e.message }; } }
const byId = (arr) => new Map((arr || []).filter((x) => x && x.id != null).map((x) => [String(x.id), L.stable(x)]));

/* Ett anrop med begränsade försök. ok(r) avgör om svaret är slutgiltigt bra. */
async function attempt(fn, ok, tries) {
  let last = null;
  for (let i = 0; i < (tries || 3); i++) {
    try { last = await fn(); if (ok(last)) return { ok: true, r: last }; } catch (e) { last = { status: 0, body: { error: 'nätverk: ' + e.message } }; }
    if (i < (tries || 3) - 1) await sleep(PAUSE_MS * (i + 1));
  }
  return { ok: false, r: last };
}

/* Städning utifrån JOURNALEN (kräver ingen ögonblicksbild). */
async function cleanupFromJournal() {
  const failed = [];
  const order = { tidpost: 0, element: 1, checkpunkt: 2, ao: 3 };
  // 'nekad' = servern avvisade skapandet (403) — inget att ta bort; efterkontrollen fångar en post som ändå skulle finnas.
  const entries = journal.filter((e) => e.status !== 'borttagen' && e.status !== 'nekad').sort((a, b) => order[a.typ] - order[b.typ]);
  for (const e of entries) {
    let res = { ok: true };
    if (e.typ === 'element') {
      res = await attempt(() => req('/functions/v1/store-key-write', { token: tok.admin, body: { action: 'writeMerge', key: e.key, upserts: [], removals: [{ id: e.id, previous: e.data }] } }),
        (r) => r.status === 200 && !(r.body.conflicts || []).length);
      // Konflikt = elementet finns men ser annorlunda ut. Ta bort det bara om det fortfarande är vår testpost.
      const conf = !res.ok && res.r && res.r.status === 200 && (res.r.body.conflicts || [])[0];
      if (conf && conf.current && conf.current.e2eTest === runId) {
        res = await attempt(() => req('/functions/v1/store-key-write', { token: tok.admin, body: { action: 'writeMerge', key: e.key, upserts: [], removals: [{ id: e.id, previous: conf.current }] } }),
          (r) => r.status === 200 && !(r.body.conflicts || []).length);
      }
    } else if (e.typ === 'tidpost') {
      res = await attempt(() => req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'delete_time', entryId: e.id, idempotencyKey: runId + '-stada-t-' + e.id + '-' + Date.now() } }),
        (r) => r.status === 200 || r.status === 404);
    } else if (e.typ === 'ao') {
      await attempt(() => req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'delete_ao', aoId: e.id, idempotencyKey: runId + '-stada-d-' + e.id + '-' + Date.now() } }), (r) => r.status === 200 || r.status === 404, 1);
      res = await attempt(() => req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'permanent_delete_ao', aoId: e.id, idempotencyKey: runId + '-stada-p-' + e.id + '-' + Date.now() } }),
        (r) => r.status === 200 || r.status === 404);
    } else if (e.typ === 'checkpunkt') {
      res = { ok: true }; // försvinner med test-AO:n
    }
    e.status = res.ok ? 'borttagen' : 'osäker';
    if (!res.ok) failed.push(e.typ + ' ' + (e.key ? e.key + ':' : '') + e.id + ' (' + (res.r ? 'HTTP ' + res.r.status + ' ' + (res.r.body.error || '') : 'inget svar') + ')');
    saveJournal();
  }
  return failed;
}

/* Kompletterande städning: allt med runId i en lyckad ögonblicksbild. */
async function cleanupByScan(snap, prefix) {
  const extra = [];
  KEYS.forEach((k) => (Array.isArray(snap.data[k]) ? snap.data[k] : []).filter((x) => isTest(x, prefix)).forEach((x) => extra.push({ typ: 'element', key: k, id: x.id, data: x })));
  snap.tes.filter((x) => isTest(x, prefix)).forEach((x) => extra.push({ typ: 'tidpost', id: x.id }));
  snap.aos.filter((x) => isTest(x, prefix)).forEach((x) => extra.push({ typ: 'ao', id: x.id }));
  const known = new Set(journal.map((e) => e.typ + '|' + e.id));
  extra.filter((e) => !known.has(e.typ + '|' + e.id) || journal.find((j) => j.typ + '|' + j.id === e.typ + '|' + e.id && j.status !== 'borttagen'))
    .forEach((e) => { journal = journal.filter((j) => j.typ + '|' + j.id !== e.typ + '|' + e.id); note(Object.assign(e, { anm: 'hittad vid sökning efter runId' })); });
  return cleanupFromJournal();
}

function leftovers(snap, prefix) {
  const out = [];
  KEYS.forEach((k) => (Array.isArray(snap.data[k]) ? snap.data[k] : []).filter((x) => isTest(x, prefix)).forEach((x) => out.push(k + ':' + x.id)));
  snap.aos.filter((x) => isTest(x, prefix)).forEach((x) => out.push('AO ' + x.id));
  snap.tes.filter((x) => isTest(x, prefix)).forEach((x) => out.push('tidpost ' + x.id));
  return out;
}

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

/* Metadata som INTE återställs. Aktivitetsloggen jämförs om den gick att läsa. */
function metadataReport(before, after) {
  const items = ['vift_lastChanged och store.updated_at för berörda nycklar (ändras vid varje skrivning, även borttagning)',
    'idempotensposter på servern för ao-time-write-anropen (create_ao, patch_ao, create_time, delete_time, delete_ao, permanent_delete_ao)',
    'inloggningsposter i auth-schemat (session, refresh-token, last_sign_in_at) och Edge Function-loggar',
    'WAL/backup-historik som innehåller testposterna'];
  if (before && after && Array.isArray(before.activityLog) && Array.isArray(after.activityLog)) {
    const old = new Set(before.activityLog.map((a) => a && a.id));
    const added = after.activityLog.filter((a) => a && !old.has(a.id));
    const ours = added.filter((a) => JSON.stringify(a).includes(runId));
    items.push('aktivitetslogg: ' + ours.length + ' nya poster som nämner testkörningen' + (added.length > ours.length ? ', ' + (added.length - ours.length) + ' andra nya poster (troligen andra användare)' : '') + ' — tas inte bort (loggen är historik)');
  } else items.push('aktivitetslogg: kunde inte jämföras (ej läsbar för kontot eller efterkontroll saknas) — servern kan ha skrivit poster om testkörningen (källa saknas, G4)');
  return items;
}

let exitCode = L.EXIT.OK;
async function finish(before, aborted) {
  // 1) Städning från journalen — fungerar även när ögonblicksbilden inte gör det.
  const jFailed = await cleanupFromJournal();
  // 2) Efterkontroll; vid behov kompletterande sökning och ny kontroll.
  let post = await trySnapshot();
  if (post.snap && leftovers(post.snap, runId).length) { await cleanupByScan(post.snap, runId); post = await trySnapshot(); }
  const after = post.snap || null;
  const left = after ? leftovers(after, runId) : null;
  const uncertain = journal.filter((e) => e.status !== 'borttagen' && e.status !== 'nekad').map((e) => e.typ + ' ' + (e.key ? e.key + ':' : '') + e.id);

  if (!after) {
    rep.add('ÅTERSTÄLLNING', null, 'EFTERKONTROLLEN KUNDE INTE GÖRAS (' + post.err + '). Städning från journalen: ' + (jFailed.length ? 'osäker för ' + jFailed.join(', ') : 'alla journalposter fick bekräftande svar') + '. Inget påstås vara återställt. Kör: --stada=' + runId);
    exitCode = L.EXIT.STADNING_MISSLYCKADES;
  } else if (left.length) {
    rep.add('ÅTERSTÄLLNING', false, 'TESTPOSTER KVAR efter efterkontroll: ' + left.join(', ') + '. Kör: --stada=' + runId);
    exitCode = L.EXIT.STADNING_MISSLYCKADES;
  } else {
    rep.add('ÅTERSTÄLLNING', true, 'efterkontrollerat: inga testposter kvar' + (uncertain.length ? ' (journalposter utan bekräftande svar men frånvarande i efterkontrollen: ' + uncertain.join(', ') + ')' : ''));
  }
  if (after && before) {
    const changed = compare(before, after);
    rep.add('AFFÄRSPOSTER', changed.length === 0 ? true : null, changed.length ? 'befintliga poster ändrade under körningen (testet rör dem inte — troligen annan användare; granska): ' + changed.slice(0, 20).join(', ') : 'befintliga register-element, AO (inkl. updatedAt) och tidposter identiska med ögonblicksbilden före');
    if (changed.length && exitCode === L.EXIT.OK) exitCode = L.EXIT.OSAKER;
  } else if (before) rep.add('AFFÄRSPOSTER', null, 'kunde inte jämföras — efterkontroll saknas');
  rep.add('DATABASIDENTITET', null, 'INTE fullständig (förväntat). Kvar som metadata: ' + metadataReport(before, after).join(' · '));
  if (aborted && exitCode === L.EXIT.OK) exitCode = L.EXIT.AVBRUTEN;
  if (exitCode === L.EXIT.OK && rep.results.some((r) => r.ok === false)) exitCode = L.EXIT.AVVIKELSE;
  const f = rep.save({ niva: 2, projekt: env.ref, journal: journalFile, kvar: left, efterkontroll: !!after });
  console.log('\nRapport: ' + f + '\nJournal: ' + journalFile);
}

(async () => {
  console.log('Nivå 2 — MUTATIONSTEST mot det godkända STAGING-projektet' + (DRY ? ' (TORRKÖRNING: inga skrivningar)' : CLEAN_ONLY ? ' (STÄDNING av ' + CLEAN_ONLY + ')' : '') + '. runId ' + runId + '\n');
  for (const [r, e] of Object.entries(emails)) tok[r] = await login(e, pw);

  if (CLEAN_ONLY) {
    loadJournal();
    rep.add('JOURNAL', null, journal.length ? journal.length + ' poster lästa från ' + journalFile : 'ingen journal hittad — städar utifrån sökning efter runId');
    const pre = await trySnapshot();
    if (pre.snap) await cleanupByScan(pre.snap, runId);
    await finish(null, false);
    process.exit(exitCode);
  }

  let before;
  try { before = await snapshot(); } catch (e) { console.error('Ögonblicksbild före kunde inte tas: ' + e.message + ' — inga mutationer gjorda.'); process.exit(L.EXIT.AVVIKELSE); }
  const st = await req('/rest/v1/store?select=value&key=eq.vift_staff', { method: 'GET', token: tok.admin });
  const staff = (st.body && st.body[0] && st.body[0].value) || [];
  for (const [r, e] of Object.entries(emails)) {
    const s = staff.find((x) => String(x.email || '').toLowerCase() === e.toLowerCase());
    if (!s) L.refuse('testkontot för ' + r + ' saknar personalpost.');
    ids[r] = String(s.id);
  }
  const old = leftovers(before);
  if (old.length) L.refuse('testposter från en tidigare körning finns kvar (' + old.slice(0, 5).join(', ') + (old.length > 5 ? ' …' : '') + '). Kör --stada=<runId> först.');

  const arrayKeys = KEYS.filter((k) => Array.isArray(before.data[k]));
  const plan = [
    'G13 (delvis): ' + arrayKeys.length + ' array-register × ' + G13_ROLES.length + ' roller — ny märkt testpost, tas bort direkt. Prövas INTE: objektformade register (' + KEYS.filter((k) => !arrayKeys.includes(k)).join(', ') + '), per-post-regler, ändring/borttagning av befintliga poster, fältnivå, hel-nyckel-skrivning',
    'Test-AO ' + runId + '-AO skapas (admin), tilldelas fältkontot/-kontona',
    'G9: ekonomi försöker sätta test-AO:n till "fakturerad"',
    'G6: två samtidiga create_time med samma idempotensnyckel (fält) på test-AO:n',
    'Checklista: sondering av serverstöd (på test-AO:n) + tre lägen och ägarkontroll om stödet finns' + (emails.falt2 ? '' : ' (ägarkontroll mellan två fältkonton kräver VIFT_USER_FALT2)'),
    'Städning utifrån journalen (alltid) + efterkontroll; befintliga poster jämförs med ögonblicksbilden',
  ];
  plan.forEach((p) => console.log('  • ' + p));
  console.log('  Återställs INTE (metadata): vift_lastChanged/store.updated_at, idempotensposter, ev. aktivitetslogg, auth-inloggningar, loggar.\n');
  if (DRY) { rep.add('TORRKÖRNING', null, 'spärrar, inloggning och ögonblicksbild OK — inga skrivningar gjorda'); rep.save({ niva: 2, projekt: env.ref, lage: 'torrkorning', plan }); process.exit(L.EXIT.OK); }

  let aborted = false;
  try {
    // ── G13 (delvis): ny testpost per array-register och roll ─────────
    for (const key of KEYS) {
      if (!arrayKeys.includes(key)) { rep.add('G13 ' + key, null, 'objektformat register — INTE prövat (ingen skrivning)'); continue; }
      for (const role of G13_ROLES) {
        const id = runId + '-' + key.replace(/^vift_/, '') + '-' + role;
        const el = testElement(id);
        const j = note({ typ: 'element', key, id, roll: role, data: el });
        const r = await req('/functions/v1/store-key-write', { token: tok[role], body: { action: 'writeMerge', key, upserts: [{ id, data: el, previous: null }], removals: [] } });
        const allowed = r.status === 200 && !(r.body.conflicts || []).length;
        const denied = r.status === 401 || r.status === 403;
        if (denied) { j.status = 'nekad'; saveJournal(); }
        if (allowed) {
          const rm = await req('/functions/v1/store-key-write', { token: tok[role], body: { action: 'writeMerge', key, upserts: [], removals: [{ id, previous: el }] } });
          if (rm.status === 200 && !(rm.body.conflicts || []).length) { j.status = 'borttagen'; saveJournal(); }
        }
        if (!allowed && !denied) { rep.add('G13 ' + key + ' ' + role, null, 'oväntat svar HTTP ' + r.status + ' ' + (r.body.error || '')); continue; }
        rep.add('G13 ' + key + ' ' + role, allowed === EXPECT[key][role], (allowed ? 'servern TILLÄT ny testpost' : 'servern nekade ny testpost') + ' (förväntat: ' + (EXPECT[key][role] ? 'tillåten' : 'nekad') + ')' + (key === 'vift_activities' ? ' — per-post-regeln (egna/andras uppgifter) prövas inte' : ''));
      }
    }

    // ── Test-AO ─────────────────────────────────────────────────────
    const now = new Date().toISOString();
    const staffIds = [ids.falt].concat(ids.falt2 ? [ids.falt2] : []);
    const aoIn = { id: runId + '-AO', title: '[E2E-TEST] ' + runId, status: 'klar', priority: 'normal', staff: staffIds, customerId: '', description: 'Automatiskt behörighetsprov — tas bort efter körningen.', log: [], materials: [], checklist: [], createdAt: now, updatedAt: now, e2eTest: runId };
    note({ typ: 'ao', id: aoIn.id });
    const c = await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'create_ao', ao: aoIn, idempotencyKey: runId + '-create-ao' } });
    if (c.status !== 200 || !c.body.workOrder) throw new Error('kunde inte skapa test-AO (HTTP ' + c.status + ' ' + (c.body.error || '') + ')');
    const aoId = c.body.workOrder.id;
    if (aoId !== aoIn.id) note({ typ: 'ao', id: aoId, anm: 'servern gav eget id' });
    const getAO = async () => { const r = await req('/functions/v1/work-orders-list', { method: 'GET', token: tok.admin }); if (r.status !== 200) throw new Error('work-orders-list HTTP ' + r.status); return (r.body.workOrders || []).find((a) => a.id === aoId); };

    // ── G9 ──────────────────────────────────────────────────────────
    const ao0 = await getAO();
    const g9 = await req('/functions/v1/ao-time-write', { token: tok.ekonomi, body: { action: 'patch_ao', aoId, patch: { status: 'fakturerad' }, expectedUpdatedAt: ao0 ? ao0.updatedAt : null, idempotencyKey: runId + '-g9' } });
    const ao1 = await getAO();
    rep.add('G9 ekonomi → fakturerad (test-AO)', null, 'HTTP ' + g9.status + ' ' + (g9.body.error || 'ok') + '; status efteråt: ' + (ao1 && ao1.status) + ' — underlag för beslut');

    // ── G6 ──────────────────────────────────────────────────────────
    const tId = runId + '-T1';
    const entry = { id: tId, aoId, staffId: ids.falt, date: now.slice(0, 10), startStr: '08:00', endStr: '08:30', minutes: 30, comment: '[E2E-TEST] ' + runId };
    note({ typ: 'tidpost', id: tId });
    const [a, b] = await Promise.all([1, 2].map(() => req('/functions/v1/ao-time-write', { token: tok.falt, body: { action: 'create_time', entry, idempotencyKey: runId + '-g6' } })));
    const tl = await req('/functions/v1/time-entries-list', { method: 'GET', token: tok.admin });
    if (tl.status !== 200) throw new Error('time-entries-list HTTP ' + tl.status);
    const n = ((tl.body && tl.body.timeEntries) || []).filter((e) => isTest(e, runId)).length;
    rep.add('G6 dubbel create_time samma nyckel', n === 1, 'svar ' + a.status + '/' + b.status + ', tidposter på servern: ' + n);

    // ── Checklista: sondering (flyttad hit från nivå 1) + tre lägen ─
    const ck = (token, body) => req('/functions/v1/work-order-checklist-resolve', { token, body: Object.assign({ aoId, avvikelse: 'v2:' + body.action }, body) });
    const probe = await ck(tok.falt, { itemId: '__vift_probe__', action: 'start' });
    if (probe.body.error !== 'item_not_found') rep.add('CHK serverstöd', null, 'servern stöder inte tre lägen ännu (svar ' + (probe.body.error || probe.status) + ') — hoppas över');
    else {
      rep.add('CHK serverstöd', null, 'servern stöder tre lägen (migration 20261123000002 installerad)');
      const it = runId + '-K1';
      note({ typ: 'checkpunkt', aoId, id: it });
      const add = await ck(tok.admin, { itemId: it, action: 'add', text: '[E2E-TEST] punkt' });
      const s1 = await ck(tok.falt, { itemId: it, action: 'start' });
      const after1 = await getAO();
      rep.add('CHK påbörja (fält)', add.status === 200 && s1.status === 200 && !!after1 && after1.status === (ao1 && ao1.status), 'HTTP ' + add.status + '/' + s1.status + '; AO-status oförändrad: ' + (!!after1 && after1.status === (ao1 && ao1.status)));
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
      rep.add('CHK ao_edit återställer annans + historik', d.status === 200 && ed.status === 200 && !!item && (item.history || []).map((h) => h.a).join(',') === 'add,start,reset,done,reset', 'HTTP ' + d.status + '/' + ed.status + '; historik: ' + (item ? (item.history || []).map((h) => h.a).join(',') : '—'));
    }
    rep.add('G13 TÄCKNING', null, 'DELVIS: skrivrätt för ny post per array-register och roll. Inte prövat: objektformade register, per-post-regler (egna/andras), ändring/borttagning av befintliga poster, fältnivå, hel-nyckel-skrivning. Ett grönt G13 betyder inte att BLOCKER-2 är löst i sin helhet.');
  } catch (e) {
    aborted = true;
    rep.add('KÖRNING', false, 'avbröts: ' + e.message + ' — städar utifrån journalen');
  }
  await finish(before, aborted);
  process.exit(exitCode);
})().catch(async (e) => {
  console.error('Fel: ' + e.message);
  // Sista skyddsnät: försök städa från journalen om något hann skrivas.
  if (journal.length && tok.admin) { try { await finish(null, true); } catch (e2) {} }
  process.exit(L.EXIT.STADNING_MISSLYCKADES);
});
