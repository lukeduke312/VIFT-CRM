'use strict';
/*
 * Lokal provning av tests/staging/e2e-real.js (webbläsartest för riktig
 * STAGING). Verktyget körs som process i lokalt testläge: sidan kommer från
 * publiceringspaketet (VIFT_E2E_PAKET, standard /home/user/staging-release),
 * och Supabase-anropen vidarebefordras till en simulerad server bakom en
 * lokal HTTP-server — ingen trafik lämnar maskinen. Bevisar verktygets
 * flöden, städning och spärrar, INTE den riktiga serverns beteende.
 * Hoppar över (redovisas) om paketet eller Playwright saknas.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const F = require('./e2e/fake-backend.js');
const FakeSupabase = F.FakeSupabase || F;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const PAKET = process.env.VIFT_E2E_PAKET || '/home/user/staging-release';
if (!fs.existsSync(path.join(PAKET, 'index.html'))) { console.log('RESULT: 0 passed, 0 failed (HOPPAS ÖVER — publiceringspaketet saknas; INTE godkänt, inte kört)'); process.exit(0); }
try { require.resolve('playwright'); } catch (e) { console.log('RESULT: 0 passed, 0 failed (HOPPAS ÖVER — Playwright saknas; INTE godkänt, inte kört)'); process.exit(0); }

const fake = new FakeSupabase({ logOps: true, activityAppend: true, activitiesPolicy: true });
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', async () => {
    const hdr = {}; Object.entries(req.headers).forEach(([k, v]) => { hdr[k.toLowerCase()] = v; });
    if (req.method === 'OPTIONS') { res.writeHead(200, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); return res.end('ok'); }
    const r = await fake.handle(req.method, 'http://127.0.0.1' + req.url, hdr, body);
    if (r.drop || r.hang) { req.socket.destroy(); return; }
    res.writeHead(r.status, Object.assign({ 'Content-Type': 'application/json', 'access-control-allow-origin': '*' }, r.headers || {}));
    res.end(r.raw ? r.raw : (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)));
  });
});
const run = (args, extra) => new Promise((resolve) => {
  const env = Object.assign({}, process.env, {
    VIFT_SUPABASE_URL: 'http://127.0.0.1:' + server.address().port, VIFT_SUPABASE_ANON: 'lokal-anon', VIFT_LOKALT_TESTLAGE: '1', VIFT_MILJO: 'staging',
    VIFT_PW: 'e2e-test-password', VIFT_TESTKONTO_MONSTER: '@example\\.test$', HTTPS_PROXY: '', https_proxy: '',
    VIFT_USER_ADMIN: 'admin@example.test', VIFT_USER_CHEF: 'arbetsledare@example.test', VIFT_USER_FALT: 'falt2@example.test',
    VIFT_USER_FALT2: 'falt1@example.test', VIFT_USER_EKONOMI: 'ekonomi@example.test', VIFT_USER_BEGRANSAD: 'begransad@example.test',
  }, extra || {});
  const p = spawn(process.execPath, [path.join(__dirname, 'staging', 'e2e-real.js')].concat(args), { env });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out }));
});

const RAPPORT = path.join(__dirname, 'staging', 'rapport');
const locks = () => { try { return fs.readdirSync(RAPPORT).filter((f) => /^OSTADAT-.*\.lock$/.test(f)); } catch (e) { return []; } };
let reqCount = 0;
const origHandle = fake.handle.bind(fake);
fake.handle = (...a) => { reqCount++; return origHandle(...a); };
const ridOf = (out) => (out.match(/runId (E2E-AUTHZ-\d{14}-[0-9a-f]{6})/) || [])[1];
const testAOs = () => fake.get('workOrders').filter((a) => String(a.id).startsWith('E2E-AUTHZ-'));

server.listen(0, '127.0.0.1', async () => {
  try { fs.rmSync(RAPPORT, { recursive: true, force: true }); } catch (e) {}
  try {
    const base = ['--jag-har-go', '--mutationstest', '--bekrafta-projekt=lokaltest', '--paket=' + PAKET];
    let r = await run(base.slice(0, 3).concat(['--paket=' + PAKET]).filter((x) => x !== '--mutationstest'));
    ok(r.code === 2, 'spärr: utan --mutationstest → kod 2');
    r = await run(base.filter((x) => !x.startsWith('--paket')));
    ok(r.code === 2 && /kräver --paket/.test(r.out), 'spärr: lokal provning utan paket → kod 2');
    const aosBefore = JSON.stringify(fake.get('workOrders'));
    const tesBefore = JSON.stringify(fake.get('timeEntries'));
    r = await run(base);
    console.log(r.out.split('\n').filter((l) => /^(OK|AVVIK|INFO)/.test(l)).map((l) => '    ' + l).join('\n'));
    for (const id of ['R0 admin', 'R0 falt', 'R0 begransad', 'F2 checklista', 'F3 stämpling två enheter', 'F4 samtidiga loggposter', 'F5 nätavbrott', 'MILJÖ', 'ÅTERSTÄLLNING', 'AFFÄRSPOSTER']) {
      ok(new RegExp('^OK +' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ', 'm').test(r.out), 'flöde godkänt: ' + id);
    }
    ok(r.code === 0, 'kod 0 (' + r.code + ')');
    ok(!fake.get('workOrders').some((a) => String(a.id).startsWith('E2E-AUTHZ-')) && JSON.stringify(fake.get('timeEntries')) === tesBefore, 'inga test-AO eller tidposter kvar');
    ok(JSON.parse(aosBefore).every((a) => JSON.stringify(a) === JSON.stringify(fake.get('workOrders').find((x) => x.id === a.id))), 'befintliga AO oförändrade');
    ok(!(fake.stamp.get('falt2@example.test') || {}).active, 'ingen kvarvarande instämpling');
    ok(locks().length === 0, 'ingen spärrfil efter lyckad körning');

    const F2 = base.concat(['--flode=F2']);
    // ── A. Nätfel: AO-listan svarar inte efter första läsningen → efterkontroll omöjlig.
    let wl = 0;
    fake.addFault({ match: (act) => /^work-orders-list/.test(act) && ++wl > 1, mode: 'fail', status: 503, error: 'unavailable' });
    r = await run(F2, { VIFT_STADA_PAUS_MS: '10' });
    const ridA = ridOf(r.out);
    ok(r.code === 3 && /EFTERKONTROLLEN KUNDE INTE GÖRAS/.test(r.out) && !/efterkontrollerat: inga testposter kvar/.test(r.out), 'A: nätfel → kod 3, inget påstås återställt (kod ' + r.code + ')');
    ok(locks().some((f) => f.includes(ridA)), 'A: spärrfil skriven');
    ok(testAOs().length === 0, 'A: journalen städade ändå bort test-AO:n');
    const n0 = reqCount;
    r = await run(F2);
    ok(r.code === 2 && /ostädad tidigare körning/.test(r.out) && reqCount === n0, 'A: ny körning blockeras före första anropet (kod ' + r.code + ', anrop ' + (reqCount - n0) + ')');
    fake.clearFaults();
    r = await run(base.concat(['--stada=' + ridA]));
    ok(r.code === 0 && /OK +ÅTERSTÄLLNING — efterkontrollerat/.test(r.out) && /JOURNAL — \d+ poster lästa/.test(r.out) && !locks().length, 'A: --stada efterkontrollerar, kod 0, spärrfilen borttagen');

    // ── B. Borttagningen misslyckas → testposter kvar.
    fake.addFault({ match: /ao-time-write:permanent_delete_ao/, mode: 'fail', status: 503, error: 'unavailable' });
    r = await run(F2, { VIFT_STADA_PAUS_MS: '10' });
    const ridB = ridOf(r.out);
    ok(r.code === 3 && /TESTPOSTER KVAR efter efterkontroll: AO /.test(r.out) && r.out.includes('--stada=' + ridB) && locks().length === 1, 'B: misslyckad städning → kod 3, poster listade, spärrfil');
    fake.clearFaults();
    r = await run(base.concat(['--stada=' + ridB]));
    ok(r.code === 0 && testAOs().length === 0 && !locks().length, 'B: --stada tar bort test-AO:n, kod 0');

    // ── C. En befintlig post ändras under körningen (annan användare/automatik) → aldrig godkänt.
    let changed = false;
    fake.addFault({ match: (act) => { if (act === 'ao-time-write:create_ao' && !changed) { changed = true; const aos = fake.get('workOrders'); aos[0].title = aos[0].title + ' (ändrad av annan)'; fake.set('workOrders', aos); } return false; } });
    r = await run(F2);
    fake.clearFaults();
    ok(r.code === 4 && /AVVIK +AFFÄRSPOSTER — EJ GODKÄNT/.test(r.out) && testAOs().length === 0 && !locks().length, 'C: ändrad befintlig post → kod 4 (inte godkänt), testposter ändå borta (kod ' + r.code + ')');

    // ── D. Flödet avbryts (servern nekar att skapa test-AO).
    fake.addFault({ match: /ao-time-write:create_ao/, mode: 'fail', status: 500, error: 'boom', times: 1 });
    r = await run(F2);
    fake.clearFaults();
    ok([1, 5].includes(r.code) && /AVVIK +F2 — avbröts/.test(r.out) && /OK +ÅTERSTÄLLNING/.test(r.out) && !locks().length, 'D: avbrott → kod ' + r.code + ' (inte 0), städning efterkontrollerad');
  } catch (e) { fail++; console.log('FAIL krasch: ' + e.stack); }
  try { fs.rmSync(path.join(__dirname, 'staging', 'rapport'), { recursive: true, force: true }); } catch (e) {}
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  server.close(); process.exit(fail ? 1 : 0);
});
