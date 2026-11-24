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
const { createRecovery, assertNoOpenLocks } = require('./recovery');

const env = L.guard(2);
const { pw, emails } = L.accounts(['admin', 'falt', 'chef', 'ekonomi', 'begransad'], ['falt2']);
const { req, login } = L.client(env);
const DRY = L.arg('torrkorning') === true;
const CLEAN_ONLY = typeof L.arg('stada') === 'string' ? L.arg('stada') : null;
if (CLEAN_ONLY && !/^E2E-AUTHZ-\d{14}-[0-9a-f]{6}$/.test(CLEAN_ONLY)) L.refuse('--stada=<runId> måste vara ett runId av formen E2E-AUTHZ-ååååmmddttmmss-xxxxxx.');
const runId = CLEAN_ONLY || L.newRunId();
const rep = L.reporter(CLEAN_ONLY ? 'authz-stadning' : 'authz-mutation', runId);
assertNoOpenLocks(L, rep.dir, CLEAN_ONLY); // ostädad tidigare körning blockerar (före första anropet)

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
/* Klientens regel per register (vilken behörighet som krävs för att skriva).
   EXPECT ovan gäller planens standardroller; vid körning räknas förväntan om
   från testkontots faktiska roll i STAGING (se nedan), så att en avvikande
   rolluppsättning inte ger falska avvikelser. null = alla inloggade. */
const KEY_PERM = {
  vift_customers: 'customer_manage', vift_properties: 'customer_manage', vift_contracts: 'customer_manage',
  vift_offers: 'offer_manage', vift_salesOpps: 'sales_manage',
  vift_roles: 'admin_manage', vift_settings: 'admin_manage', vift_staff: 'staff_manage',
  vift_articles: 'article_manage', vift_priceGroups: 'article_manage',
  /* Testposten saknar createdBy/assignedTo (inte egen uppgift). Både
     installerad store-key-write v3 (admin_manage för hela registret) och
     per-post-regeln i activities-policy.ts tillåter den då bara med
     admin_manage eller arbetsledarbehörighet (ao_edit + ao_view_all). */
  vift_activities: (p) => p.includes('all') || p.includes('admin_manage') || (p.includes('ao_edit') && p.includes('ao_view_all')),
};
const KEYS = Object.keys(EXPECT);
const G13_ROLES = ['falt', 'chef', 'ekonomi', 'begransad'];

/* ── Återhämtning (gemensam modul, se recovery.js) ───────────────────── */
const tok = {};
const ids = {};
const R = createRecovery({ L, req, admin: () => tok.admin, runId, dir: rep.dir, ref: env.ref, keys: KEYS, loginFor: (k) => login(emails[k], pw) });
const { note, saveJournal, loadJournal, snapshot, trySnapshot, cleanupByScan, leftovers, isTest } = R;
const journalFile = R.journalFile;
let exitCode = L.EXIT.OK;
async function finish(before, aborted) {
  const res = await R.finish(rep, before, aborted);
  exitCode = res.exitCode;
  const f = rep.save({ niva: 2, projekt: env.ref, journal: journalFile, kvar: res.left, efterkontroll: !!res.after });
  console.log('\nRapport: ' + f + '\nJournal: ' + journalFile);
}

function testElement(id) {
  const label = '[E2E-TEST] behörighetsprov ' + runId + ' — tas bort automatiskt';
  return { id, e2eTest: runId, name: label, title: label, text: label, label, firstName: '[E2E-TEST]', lastName: runId, active: false, deleted: true, permissions: [] };
}

(async () => {
  console.log('Nivå 2 — MUTATIONSTEST mot det godkända STAGING-projektet' + (DRY ? ' (TORRKÖRNING: inga skrivningar)' : CLEAN_ONLY ? ' (STÄDNING av ' + CLEAN_ONLY + ')' : '') + '. runId ' + runId + '\n');
  for (const [r, e] of Object.entries(emails)) tok[r] = await login(e, pw);

  if (CLEAN_ONLY) {
    const nj = loadJournal();
    rep.add('JOURNAL', null, nj ? nj + ' poster lästa från ' + journalFile : 'ingen journal hittad — städar utifrån sökning efter runId');
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
  const rl = await req('/rest/v1/store?select=value&key=eq.vift_roles', { method: 'GET', token: tok.admin });
  const roles = (rl.body && rl.body[0] && rl.body[0].value) || [];
  if (roles.length) {
    for (const r of G13_ROLES) {
      const s = staff.find((x) => String(x.id) === ids[r]);
      const role = s && roles.find((x) => x.id === s.role);
      const perms = (role && role.permissions) || [];
      for (const k of KEYS) EXPECT[k][r] = typeof KEY_PERM[k] === 'function' ? KEY_PERM[k](perms) : (perms.includes('all') || perms.includes(KEY_PERM[k]));
      rep.add('ROLL ' + r, null, (s ? s.role : '?') + (role ? ' [' + perms.join(', ') + ']' : ' (rollen finns inte — inga behörigheter)'));
    }
  } else rep.add('ROLL', null, 'rollerna kunde inte läsas — planens standardförväntan används');
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
        const denied = r.status === 401 || r.status === 403 || (r.status === 400 && (r.body || {}).error === 'key_not_allowlisted');
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
      // Arbetsledaren (ao_edit) återställer fältets åtgärd; utan arbetsledarkonto används admin.
      const editor = tok.chef ? 'chef' : 'admin';
      const ed = await ck(tok[editor], { itemId: it, action: 'reset' });
      const fin = await getAO();
      const item = ((fin && fin.checklist) || []).find((x) => x.id === it);
      const hist = item ? (item.history || []) : [];
      const histIds = hist.map((h) => h.byId).join(',');
      const wantIds = [ids.admin, ids.falt, ids.falt, ids.falt, ids[editor]].join(',');
      rep.add('CHK ao_edit (' + editor + ') återställer annans + historik', d.status === 200 && ed.status === 200 && hist.map((h) => h.a).join(',') === 'add,start,reset,done,reset' && histIds === wantIds, 'HTTP ' + d.status + '/' + ed.status + '; historik: ' + hist.map((h) => h.a).join(',') + '; vem: ' + (histIds === wantIds ? 'rätt personal-id per steg' : histIds));
      // Avvikelse kräver kommentar; fält2 får inte skriva över fältets avvikelse; utan ao_checklist nekas.
      const nc = await ck(tok.falt, { itemId: it, action: 'avvikelse' });
      const av = await ck(tok.falt, { itemId: it, action: 'avvikelse', avvikelseComment: '[E2E-TEST] avvikelse' });
      rep.add('CHK avvikelse kräver kommentar', nc.status === 400 && nc.body.error === 'comment_required' && av.status === 200, 'utan kommentar HTTP ' + nc.status + ' ' + (nc.body.error || '') + '; med kommentar HTTP ' + av.status);
      if (tok.falt2) {
        const ow = await ck(tok.falt2, { itemId: it, action: 'done' });
        rep.add('CHK skriva över annans avvikelse (fält2)', ow.status === 403 && ow.body.error === 'forbidden_other', 'HTTP ' + ow.status + ' ' + (ow.body.error || ''));
      }
      if (tok.begransad) {
        const nb = await ck(tok.begransad, { itemId: it, action: 'start' });
        rep.add('CHK utan ao_checklist (begränsad)', nb.status === 403, 'HTTP ' + nb.status + ' ' + (nb.body.error || ''));
      }
      const fin2 = await getAO();
      rep.add('CHK AO-status oförändrad efter alla checklisteåtgärder', !!fin2 && fin2.status === (ao1 && ao1.status), 'status: ' + (fin2 && fin2.status));
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
  if (R.journal.length && tok.admin) { try { await finish(null, true); } catch (e2) {} }
  process.exit(L.EXIT.STADNING_MISSLYCKADES);
});
