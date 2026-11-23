'use strict';
/*
 * Lokala tester av STAGING-testverktygen (tests/staging/*). Verktygen körs
 * som riktiga processer mot den simulerade servern (tests/e2e/fake-backend)
 * bakom en lokal HTTP-server på 127.0.0.1 — aldrig mot STAGING/LIVE.
 *
 * Bevisar: spärrar stoppar FÖRE första anropet; nivå 1 skickar inga
 * skrivåtgärder och lämnar databasen bitidentisk; nivå 2 rör inga
 * befintliga poster (inkl. AO:s updatedAt), städar sina testposter, och
 * redovisar + kan städa upp efter en misslyckad städning.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const F = require('./e2e/fake-backend.js');
const FakeSupabase = F.FakeSupabase || F;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };

const fake = new FakeSupabase();
let reqCount = 0;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', async () => {
    reqCount++;
    const hdr = {}; Object.entries(req.headers).forEach(([k, v]) => { hdr[k.toLowerCase()] = v; });
    const r = await fake.handle(req.method, 'http://127.0.0.1' + req.url, hdr, body);
    if (r.drop || r.hang) { req.socket.destroy(); return; }
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
  });
});

const ROOT = path.join(__dirname, '..');
function run(script, args, envExtra) {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, {
      VIFT_SUPABASE_URL: 'http://127.0.0.1:' + server.address().port,
      VIFT_SUPABASE_ANON: 'lokal-anon', VIFT_LOKALT_TESTLAGE: '1', VIFT_MILJO: 'staging',
      VIFT_PW: 'e2e-test-password', VIFT_TESTKONTO_MONSTER: '@example\\.test$',
      VIFT_USER_ADMIN: 'admin@example.test', VIFT_USER_CHEF: 'arbetsledare@example.test',
      VIFT_USER_FALT: 'falt1@example.test', VIFT_USER_FALT2: 'falt2@example.test',
      VIFT_USER_EKONOMI: 'ekonomi@example.test', VIFT_USER_BEGRANSAD: 'begransad@example.test',
      HTTPS_PROXY: '', https_proxy: '',
    }, envExtra || {});
    Object.keys(env).forEach((k) => { if (env[k] === null) delete env[k]; });
    const p = spawn(process.execPath, [path.join(ROOT, script)].concat(args), { env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}
const BASE = ['--jag-har-go', '--bekrafta-projekt=lokaltest'];
const MUT = BASE.concat(['--mutationstest']);
const dump = () => JSON.stringify([...fake.store.entries()].filter(([k]) => k !== 'vift_lastChanged').sort());
const dumpAll = () => JSON.stringify([...fake.store.entries()].sort());
const mutCalls = (from) => fake.calls.slice(from).filter((c) => !c.path.startsWith('/auth/') && c.method !== 'GET' && !['readWithHash', 'readHashes', 'readAllWithHashes', 'store-key-write'].includes(c.action) && !/:(readWithHash|readHashes|readAllWithHashes)$/.test(c.action) && !/work-order-checklist-resolve:start$/.test(c.action));

server.listen(0, '127.0.0.1', async () => {
  try {
    // ── Spärrar: stoppar före första anropet ──────────────────────────
    const cases = [
      ['tests/staging/authz-read.js', ['--bekrafta-projekt=lokaltest'], {}, 'nivå 1 utan --jag-har-go'],
      ['tests/staging/authz-read.js', ['--jag-har-go', '--bekrafta-projekt=fel'], {}, 'nivå 1 med fel --bekrafta-projekt'],
      ['tests/staging/authz-read.js', BASE, { VIFT_SUPABASE_URL: 'https://hjplzjsbbowiyoyhdghc.supabase.co' }, 'LIVE-adress'],
      ['tests/staging/authz-read.js', BASE, { VIFT_TESTKONTO_MONSTER: null }, 'konton som inte ser ut som testkonton'],
      ['tests/staging/authz-mutation.js', BASE, {}, 'nivå 2 utan --mutationstest'],
      ['tests/staging/authz-mutation.js', MUT, { VIFT_MILJO: 'live' }, 'nivå 2 utan VIFT_MILJO=staging'],
      ['tests/staging/authz-mutation.js', MUT.concat(['--stada=nagot-annat']), {}, 'städning med ogiltigt runId'],
      ['tests/e2e/staging-authz.js', ['--jag-har-go'], {}, 'det ersatta verktyget'],
    ];
    for (const [s, a, e, label] of cases) {
      const n0 = reqCount;
      const r = await run(s, a, e);
      ok(r.code === 2 && reqCount === n0, 'spärr: ' + label + ' → kod 2, 0 anrop (kod ' + r.code + ', anrop ' + (reqCount - n0) + ')');
    }

    // ── Nivå 1: inga skrivåtgärder, databasen bitidentisk ─────────────
    let snap = dumpAll(); let c0 = fake.calls.length;
    let r = await run('tests/staging/authz-read.js', BASE);
    ok(r.code === 0, 'nivå 1 kör klart utan avvikelser (kod ' + r.code + ')' + (r.code ? '\n' + r.out.slice(-800) : ''));
    ok(/SJÄLVKONTROLL — inga skrivåtgärder/.test(r.out), 'nivå 1: självkontrollen rapporterar inga skrivåtgärder');
    ok(mutCalls(c0).length === 0, 'nivå 1: servern fick inga skrivåtgärder (' + mutCalls(c0).map((c) => c.action).join(',') + ')');
    ok(dumpAll() === snap, 'nivå 1: hela databasen bitidentisk, även vift_lastChanged');

    // ── Nivå 2 torrkörning ───────────────────────────────────────────
    snap = dumpAll(); c0 = fake.calls.length;
    r = await run('tests/staging/authz-mutation.js', MUT.concat(['--torrkorning']));
    ok(r.code === 0 && /TORRKÖRNING/.test(r.out), 'torrkörning: kod 0 och plan utskriven');
    ok(mutCalls(c0).length === 0 && dumpAll() === snap, 'torrkörning: inga skrivningar, databasen bitidentisk');

    // ── Nivå 2 fullständig körning ────────────────────────────────────
    const aosBefore = JSON.stringify(fake.get('workOrders'));
    const tesBefore = JSON.stringify(fake.get('timeEntries'));
    snap = dump();
    r = await run('tests/staging/authz-mutation.js', MUT);
    const rid = (r.out.match(/runId (E2E-AUTHZ-\d{14}-[0-9a-f]{6})/) || [])[1];
    ok(!!rid, 'nivå 2: runId utskrivet');
    // Den simulerade servern låter alla inloggade skriva register (G13 okänd) —
    // verktyget ska då rapportera BLOCKER-2-avvikelser OCH ändå städa.
    ok(r.code === 1 && /AVVIK +G13 vift_offers falt — servern TILLÄT skrivning/.test(r.out), 'nivå 2: upptäcker en server som tillåter otillåtna skrivningar (kod 1, G13-avvikelse redovisad)');
        ok(/OK +STÄDNING — inga testposter kvar/.test(r.out), 'nivå 2: inga testposter kvar');
    ok(/OK +BEFINTLIGA POSTER — alla befintliga/.test(r.out), 'nivå 2: befintliga poster identiska före/efter (verktygets egen kontroll)');
    ok(JSON.stringify(fake.get('workOrders')) === aosBefore, 'nivå 2: alla befintliga AO oförändrade, inklusive updatedAt (ingen no-op-patch på skarp AO)');
    ok(JSON.stringify(fake.get('timeEntries')) === tesBefore, 'nivå 2: tidposter oförändrade');
    ok(dump() === snap, 'nivå 2: alla register bitidentiska efter städning (bara vift_lastChanged ändrad)');
    const patchedExisting = fake.calls.filter((c) => /ao-time-write:patch_ao/.test(c.action)).length;
    ok(patchedExisting === 1, 'nivå 2: exakt en patch_ao (G9 på test-AO:n), ingen mot befintliga AO');
    ok(/G6 dubbel create_time samma nyckel — svar \d+\/\d+, tidposter på servern: 1/.test(r.out), 'nivå 2: G6 kördes på test-AO:n');
    ok(/CHK återställ annans \(fält2, ao_checklist\)/.test(r.out) && /OK +CHK ao_edit återställer annans \+ historik/.test(r.out), 'nivå 2: checklistans ägarkontroll prövad');
    const rapport = rid && path.join(ROOT, 'tests/staging/rapport/authz-mutation-' + rid + '.json');
    ok(rapport && fs.existsSync(rapport) && fs.existsSync(path.join(ROOT, 'tests/staging/rapport/' + rid + '.journal.json')), 'nivå 2: rapport och journal skrivna');

    // ── Misslyckad städning → kod 3, poster listade; --stada tar bort ─
    snap = dump();
    fake.addFault({ match: /ao-time-write:permanent_delete_ao/, mode: 'fail', status: 503, error: 'unavailable' });
    r = await run('tests/staging/authz-mutation.js', MUT);
    const rid2 = (r.out.match(/runId (E2E-AUTHZ-\d{14}-[0-9a-f]{6})/) || [])[1];
    ok(r.code === 3 && /TESTPOSTER KVAR: AO /.test(r.out) && r.out.includes('--stada=' + rid2), 'städfel: kod 3, kvarvarande AO listad och städkommando angivet');
    // Nästa körning vägrar starta medan testposter ligger kvar.
    c0 = fake.calls.length;
    r = await run('tests/staging/authz-mutation.js', MUT);
    ok(r.code === 2 && /testposter från en tidigare körning/.test(r.out) && mutCalls(c0).length === 0, 'kvarvarande testposter: ny körning vägrar, inga skrivningar');
    fake.clearFaults();
    r = await run('tests/staging/authz-mutation.js', MUT.concat(['--stada=' + rid2]));
    ok(r.code === 0 && /OK +STÄDNING — inga testposter kvar/.test(r.out), '--stada: tar bort kvarvarande testposter (kod ' + r.code + ')');
    ok(dump() === snap, '--stada: registren bitidentiska med före körningen');
    ok(!fake.get('workOrders').some((a) => String(a.id).startsWith('E2E-AUTHZ-')), '--stada: ingen test-AO kvar');
  } catch (e) {
    fail++; console.log('FAIL krasch:', e.stack);
  }
  // Rapporter från lokala körningar sparas inte.
  try { fs.rmSync(path.join(ROOT, 'tests/staging/rapport'), { recursive: true, force: true }); } catch (e) {}
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
});
