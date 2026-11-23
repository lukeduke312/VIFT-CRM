'use strict';
/*
 * NIVÅ 2 — webbläsartest mot RIKTIG STAGING (2026-11-24). Kräver GO.
 *
 * Återanvänder E2E-bibliotekets sessioner (tests/e2e/lib.js) i "riktigt
 * läge": sidan hämtas från den publicerade webbplatsen och Supabase-anropen
 * går till den riktiga STAGING-servern. Inget går mot LIVE:
 *   - samma spärrar som authz-mutation (lib.guard(2)): --jag-har-go,
 *     --mutationstest, --bekrafta-projekt=<ref>, GODKÄNT STAGING-projekt
 *     (hashlås), VIFT_MILJO=staging, testkontomönster;
 *   - webbplatsen måste vara https://staging-crm.viftfast.se;
 *   - lib.js vägrar riktigt läge om inte denna fil satt sin spärrnyckel, och
 *     underkänner varje anrop till ett annat Supabase-projekt.
 *
 * Även inloggning kan ge automatiska skrivningar (t.ex. serviceintervallens
 * dagliga kontroll som skapar uppgifter). Därför: ögonblicksbild före och
 * efter (adminkontot), journal före varje egen mutation, städning alltid,
 * och redovisning av automatiska ändringar separat.
 *
 * Flöden (alla på egna testposter märkta [E2E-TEST]):
 *   R0  Sidor per roll: alla sidor rollen får se öppnas utan JS-fel.
 *   F2  Checklista: påbörja → utförd på mobil; AO-status oförändrad.
 *   F3  Stämpling: in på mobil, syns på dator, ut på dator → exakt EN tidpost.
 *   F4  Två användare lägger loggpost samtidigt på samma AO → båda finns.
 *   F5  Nätavbrott under loggpost → aldrig "sparad" offline; skickas en gång.
 *   (F6 behörighet: tests/staging/authz-mutation.js. Ekonomikedjan kund →
 *   offert → kundlänk → AO → faktura: manuella testfall i installationsplanen.)
 *
 *   ... node tests/staging/e2e-real.js --jag-har-go --mutationstest --bekrafta-projekt=<ref> [--flode=R0,F2,...] [--torrkorning]
 * Lokal provning (ingen nätverkstrafik ut): VIFT_LOKALT_TESTLAGE=1 med
 *   VIFT_SUPABASE_URL=http://127.0.0.1:<port> och --paket=<katalog>.
 */
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const env = L.guard(2);
const { pw, emails } = L.accounts(['admin', 'falt', 'chef', 'ekonomi', 'begransad'], ['falt2']);
const SITE = 'https://staging-crm.viftfast.se';
const STAGING_SUPA = 'https://yyzljlqyzzcbxmcdbual.supabase.co';
const paket = typeof L.arg('paket') === 'string' ? path.resolve(L.arg('paket')) : null;
if (env.local && !paket) L.refuse('lokal provning kräver --paket=<katalog med publiceringspaketet>.');
if (!env.local && paket) L.refuse('--paket används bara vid lokal provning.');
const FLOWS = (typeof L.arg('flode') === 'string' ? L.arg('flode') : 'R0,F2,F3,F4,F5').split(',');
const DRY = L.arg('torrkorning') === true;

process.env.VIFT_E2E_REAL = '1';
process.env.VIFT_E2E_REAL_GUARD = 'godkand-av-e2e-real';
process.env.VIFT_E2E_SUPA = STAGING_SUPA;
if (env.local) { process.env.VIFT_E2E_ROOT = paket; process.env.VIFT_E2E_FORWARD = env.sb; }
else process.env.VIFT_E2E_BASEURL = SITE;
const E = require('../e2e/lib.js');
const { req, login } = L.client(env);
const runId = L.newRunId().replace('E2E-AUTHZ', 'E2E-AUTHZ');
const rep = L.reporter('e2e-real', runId);
const journalFile = path.join(rep.dir, runId + '.journal.json');
const journal = [];
const note = (e) => { journal.push(Object.assign({ t: new Date().toISOString() }, e)); fs.mkdirSync(rep.dir, { recursive: true }); fs.writeFileSync(journalFile, JSON.stringify({ runId, journal }, null, 2)); };
const tok = {};
const ids = {};
const today = () => new Date().toISOString().slice(0, 10);

async function snapshot() {
  const keys = ['vift_customers', 'vift_offers', 'vift_activities', 'vift_properties', 'vift_contracts'];
  const ra = await req('/functions/v1/store-key-write', { token: tok.admin, body: { action: 'readAllWithHashes', keys } });
  const wl = await req('/functions/v1/work-orders-list', { method: 'GET', token: tok.admin });
  const tl = await req('/functions/v1/time-entries-list', { method: 'GET', token: tok.admin });
  if (ra.status !== 200 || wl.status !== 200 || tl.status !== 200) throw new Error('ögonblicksbild misslyckades (' + [ra.status, wl.status, tl.status].join('/') + ')');
  return { data: ra.body.data || {}, aos: wl.body.workOrders || [], tes: tl.body.timeEntries || [] };
}
const listAO = async () => ((await req('/functions/v1/work-orders-list', { method: 'GET', token: tok.admin })).body.workOrders || []);
const listTE = async () => ((await req('/functions/v1/time-entries-list', { method: 'GET', token: tok.admin })).body.timeEntries || []);

async function createTestAO(suffix, extra) {
  const id = runId + '-' + suffix;
  const ao = Object.assign({ id, title: '[E2E-TEST] ' + suffix + ' ' + runId, status: 'planerad', priority: 'normal', staff: [ids.falt].concat(ids.falt2 ? [ids.falt2] : []), customerId: '', scheduledDate: today(), log: [], materials: [], checklist: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), e2eTest: runId }, extra || {});
  note({ typ: 'ao', id });
  const r = await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'create_ao', ao, idempotencyKey: runId + '-c-' + suffix } });
  if (r.status !== 200) throw new Error('kunde inte skapa test-AO ' + suffix + ' (HTTP ' + r.status + ' ' + (r.body.error || '') + ')');
  const real = (r.body.workOrder && r.body.workOrder.id) || id;
  if (real !== id) note({ typ: 'ao', id: real });
  return real;
}

const FLOW = {
  async R0(W) {
    for (const role of Object.keys(emails)) {
      const s = await W.session({ viewport: role === 'falt' ? 'iphone' : 'laptop' });
      await s.login(role);
      const pages = await s.eval(() => Object.keys(Auth.PAGE_PERMISSIONS || {}).filter((p) => Auth.canViewPage(p)));
      const bad = [];
      for (const p of pages) {
        const before = s.pageErrors.length;
        await s.eval((x) => { try { Router.showPage(x, {}); } catch (e) { throw new Error(x + ': ' + e.message); } }, p).catch((e) => bad.push(String(e.message).slice(0, 120)));
        await s.settle(700);
        if (s.pageErrors.length > before) bad.push(p + ': ' + s.pageErrors.slice(before).join(' | ').slice(0, 160));
      }
      rep.add('R0 ' + role, bad.length === 0, pages.length + ' sidor öppnade' + (bad.length ? '; fel: ' + bad.join(' ; ') : ', inga JS-fel'));
      await s.context.close();
    }
  },
  async F2(W) {
    const aoId = await createTestAO('CHK', { checklist: [{ id: runId + '-k1', text: '[E2E-TEST] punkt 1', done: false, avvikelse: null }] });
    const s = await W.session({ viewport: 'iphone' });
    await s.login('falt');
    await s.go('pg-ao-detail', { aoId });
    await s.page.waitForSelector('#ao-checklist .chk-row', { timeout: 15000 });
    const hasStart = await s.page.waitForSelector('#ao-checklist .chk-btn-start', { timeout: 8000 }).then(() => true).catch(() => false);
    if (hasStart) {
      await s.page.click('#ao-checklist .chk-btn-start');
      await s.waitToast(/Påbörjad/, 15000);
    }
    await s.page.click('#ao-checklist .chk-btn[title="Markera utförd"]');
    await s.waitToast(/Utförd/, 15000);
    const ao = (await listAO()).find((a) => a.id === aoId);
    const it = ao && (ao.checklist || [])[0];
    rep.add('F2 checklista', !!it && it.done === true && ao.status === 'planerad' && (!hasStart || !!it.startedAt), (hasStart ? 'tre lägen (serverstöd finns)' : 'serverstöd för tre lägen saknas — bara Utförd prövad') + '; AO-status ' + (ao && ao.status) + '; punkt utförd: ' + !!(it && it.done));
    await s.context.close();
  },
  async F3(W) {
    const aoId = await createTestAO('STAMP');
    const m = await W.session({ viewport: 'iphone' }); await m.login('falt');
    const d = await W.session({ viewport: 'laptop' }); await d.login('falt');
    await m.go('pg-myjobs');
    const card = m.page.locator('.page.active', { hasText: runId }).first();
    await m.eval((id) => MyJobsPage.clockIn ? MyJobsPage.clockIn(id) : null, aoId);
    await m.waitToast(/Instämplad/, 15000);
    note({ typ: 'stampling', konto: 'falt' });
    await d.page.bringToFront(); await d.eval(() => window.dispatchEvent(new Event('focus'))); await d.settle(4000);
    const seen = await d.eval(() => !!state.stampActive);
    await d.go('pg-myjobs');
    await d.eval(() => MyJobsPage.clockOut());
    await d.waitToast(/Utstämplad/, 20000);
    await d.settle(3000);
    const tes = (await listTE()).filter((t) => t.aoId === aoId);
    tes.forEach((t) => note({ typ: 'tidpost', id: t.id }));
    rep.add('F3 stämpling två enheter', seen && tes.length === 1, 'datorn såg instämpling: ' + seen + '; tidposter för test-AO: ' + tes.length);
    void card;
    await m.context.close(); await d.context.close();
  },
  async F4(W) {
    const aoId = await createTestAO('LOG2');
    const a = await W.session(); await a.login('falt');
    const b = await W.session({ viewport: 'iphone' }); await b.login(emails.falt2 ? 'falt2' : 'falt');
    for (const s of [a, b]) await s.go('pg-ao-detail', { aoId });
    const add = async (s, text) => { await s.eval(() => WorkOrderDetailPage.openAddLog()); await s.page.waitForSelector('.modal-overlay.open #log-text'); await s.page.fill('#log-text', text); await s.clickModalButton(/^Spara$/); };
    await Promise.all([add(a, '[E2E-TEST] enhet A'), add(b, '[E2E-TEST] enhet B')]);
    await a.waitToast(/Loggpost sparad/, 20000); await b.waitToast(/Loggpost sparad/, 20000);
    await a.settle(1500);
    const log = (((await listAO()).find((x) => x.id === aoId)) || {}).log || [];
    const both = log.some((l) => /enhet A/.test(l.text)) && log.some((l) => /enhet B/.test(l.text));
    const atomic = await a.eval(() => AOTimeSyncService._logOps === true);
    rep.add('F4 samtidiga loggposter', both ? true : (atomic ? false : null), (both ? 'båda posterna finns' : 'en post saknas') + ' (atomisk väg ' + (atomic ? 'aktiv' : 'INTE installerad — känt gap G5') + ')');
    await a.context.close(); await b.context.close();
  },
  async F5(W) {
    const aoId = await createTestAO('OFFLINE');
    const s = await W.session(); await s.login('falt');
    await s.go('pg-ao-detail', { aoId });
    await s.clearToasts();
    s.offline = true; await s.context.setOffline(true);
    await s.eval(() => WorkOrderDetailPage.openAddLog()); await s.page.waitForSelector('.modal-overlay.open #log-text');
    await s.page.fill('#log-text', '[E2E-TEST] offline'); await s.clickModalButton(/^Spara$/);
    await s.settle(5000);
    const falseOk = (await s.toasts()).some((m) => /Loggpost sparad/.test(m));
    s.offline = false; await s.context.setOffline(false);
    await s.eval(() => window.dispatchEvent(new Event('online')));
    await s.waitToast(/Loggpost sparad/, 45000).catch(() => {});
    await s.settle(2000);
    const n = ((((await listAO()).find((x) => x.id === aoId)) || {}).log || []).filter((l) => /offline/.test(l.text)).length;
    rep.add('F5 nätavbrott', !falseOk && n === 1, 'falskt "sparad" offline: ' + falseOk + '; poster på servern efter återanslutning: ' + n);
    await s.context.close();
  },
};

async function cleanup() {
  const failed = [];
  for (const e of journal.slice().reverse()) {
    let ok = true;
    if (e.typ === 'tidpost') { const r = await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'delete_time', entryId: e.id, idempotencyKey: runId + '-dt-' + e.id } }); ok = r.status === 200 || r.status === 404; }
    if (e.typ === 'ao') { await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'delete_ao', aoId: e.id, idempotencyKey: runId + '-d-' + e.id } }); const r = await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'permanent_delete_ao', aoId: e.id, idempotencyKey: runId + '-p-' + e.id } }); ok = r.status === 200 || r.status === 404; }
    if (e.typ === 'stampling') {
      const t = await login(emails[e.konto], pw);
      const st = await req('/functions/v1/store-key-write', { token: t, body: { action: 'getStampStatus' } });
      if (st.body && st.body.active) { const r = await req('/functions/v1/store-key-write', { token: t, body: { action: 'setStampStatus', active: false, expectedRevision: st.body.revision } }); ok = r.status === 200; }
    }
    if (!ok) failed.push(e.typ + ' ' + (e.id || e.konto));
  }
  // Tidposter på test-AO:er som inte hann journalföras.
  for (const t of (await listTE()).filter((x) => String(x.aoId || '').startsWith(runId))) {
    await req('/functions/v1/ao-time-write', { token: tok.admin, body: { action: 'delete_time', entryId: t.id, idempotencyKey: runId + '-dt2-' + t.id } });
  }
  return failed;
}

(async () => {
  console.log('Nivå 2 — WEBBLÄSARTEST mot ' + (env.local ? 'LOKAL provning (paket ' + paket + ')' : 'riktig STAGING ' + SITE) + '. runId ' + runId + '. Flöden: ' + FLOWS.join(', ') + '\n');
  for (const [r, e] of Object.entries(emails)) tok[r] = await login(e, pw);
  const before = await snapshot();
  const st = await req('/rest/v1/store?select=value&key=eq.vift_staff', { method: 'GET', token: tok.admin });
  const staff = (st.body && st.body[0] && st.body[0].value) || [];
  for (const [r, e] of Object.entries(emails)) { const s = staff.find((x) => String(x.email || '').toLowerCase() === e.toLowerCase()); if (!s) L.refuse('testkontot för ' + r + ' saknar personalpost.'); ids[r] = String(s.id); }
  if (before.aos.some((a) => String(a.id).startsWith('E2E-AUTHZ-'))) L.refuse('test-AO från en tidigare körning finns kvar — kör authz-mutation.js --stada=<runId> först.');
  if (DRY) { rep.add('TORRKÖRNING', null, 'spärrar, inloggning och ögonblicksbild OK'); rep.save({ niva: 2 }); process.exit(0); }

  await E.start();
  const W = new E.World();
  for (const f of FLOWS) {
    if (!FLOW[f]) { rep.add(f, null, 'okänt flöde'); continue; }
    try { await FLOW[f](W); } catch (e) { rep.add(f, false, 'avbröts: ' + String(e.message).slice(0, 300)); }
  }
  const jsErr = W.sessions.flatMap((s) => s.pageErrors).filter((m) => /OTILLÅTEN SUPABASE/.test(m));
  rep.add('MILJÖ', jsErr.length === 0, jsErr.length ? 'anrop till annat Supabase-projekt: ' + jsErr.join(', ') : 'inga anrop till andra Supabase-projekt');
  await W.close(); await E.stop();

  const failed = await cleanup();
  const after = await snapshot();
  const left = after.aos.filter((a) => String(a.id).startsWith(runId)).map((a) => a.id).concat(after.tes.filter((t) => String(t.aoId || '').startsWith(runId)).map((t) => t.id));
  rep.add('STÄDNING', left.length === 0 && failed.length === 0, left.length || failed.length ? 'KVAR: ' + left.concat(failed).join(', ') : 'efterkontrollerat: inga testposter kvar');
  const auto = [];
  const cmp = (label, a, b) => { const A = new Map((a || []).map((x) => [String(x.id), JSON.stringify(x)])); for (const x of (b || [])) { if (String(x.id).startsWith(runId)) continue; const v = A.get(String(x.id)); if (v !== JSON.stringify(x)) auto.push(label + ' ' + x.id + (v ? ' ändrad' : ' ny')); } };
  for (const k of Object.keys(after.data)) if (Array.isArray(after.data[k])) cmp(k, before.data[k], after.data[k]);
  cmp('AO', before.aos, after.aos); cmp('tidpost', before.tes, after.tes);
  rep.add('AUTOMATISKA ÄNDRINGAR', auto.length ? null : true, auto.length ? 'ändrade under körningen (automatik vid inloggning eller annan användare — granska): ' + auto.slice(0, 15).join(', ') : 'inga ändringar i befintliga poster');
  const f = rep.save({ niva: 2, projekt: env.ref, journal: journalFile });
  console.log('\nRapport: ' + f);
  process.exit(left.length || failed.length ? L.EXIT.STADNING_MISSLYCKADES : rep.results.some((r) => r.ok === false) ? L.EXIT.AVVIKELSE : L.EXIT.OK);
})().catch(async (e) => { console.error('Fel: ' + e.message); try { await cleanup(); } catch (e2) {} process.exit(L.EXIT.STADNING_MISSLYCKADES); });
