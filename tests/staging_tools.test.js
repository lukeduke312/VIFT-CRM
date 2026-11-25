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

const fake = new FakeSupabase({ logOps: true });
/* T3-B: fältkontona får en STAGING-lik fältroll (ao_complete, som i tests/local/lib/data.js),
   så att övergångsregeln ger ao_pool_take/ao_start_own/ao_complete_own och tagning, start
   och klarmarkering prövas av nivå 2. Demoseedens 'personal' i denna kopia saknar ao_complete. */
{ const roller = fake.get('roles'); const p = roller.find((x) => x.id === 'personal'); if (p && !p.permissions.includes('ao_complete')) p.permissions.push('ao_complete'); fake.set('roles', roller); }
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
      HTTPS_PROXY: '', https_proxy: '', VIFT_STADA_PAUS_MS: '10',
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
      ['tests/staging/authz-read.js', ['--jag-har-go', '--bekrafta-projekt=abcdefghijklmnopqrst'], { VIFT_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' }, 'nivå 1 mot ett godtyckligt (bekräftat) projekt som inte är det godkända STAGING'],
      ['tests/staging/authz-mutation.js', ['--jag-har-go', '--mutationstest', '--bekrafta-projekt=abcdefghijklmnopqrst'], { VIFT_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' }, 'nivå 2 mot ett godtyckligt (bekräftat) projekt som inte är det godkända STAGING'],
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
    ok(!fake.calls.slice(c0).some((c) => /work-order-checklist-resolve/.test(c.path)), 'nivå 1: skickar ingen checklist-sondering (flyttad till nivå 2)');

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
    ok(r.code === 1 && /AVVIK +G13 vift_offers falt — servern TILLÄT ny testpost/.test(r.out), 'nivå 2: upptäcker en server som tillåter otillåtna skrivningar (kod 1, G13-avvikelse redovisad)');
        ok(/OK +ÅTERSTÄLLNING — efterkontrollerat: inga testposter kvar/.test(r.out), 'nivå 2: inga testposter kvar (efterkontrollerat)');
    ok(/INFO +DATABASIDENTITET — INTE fullständig/.test(r.out) && /idempotensposter/.test(r.out), 'nivå 2: redovisar att databasen inte är bitidentisk (metadata kvar)');
    ok(/INFO +G13 TÄCKNING — DELVIS/.test(r.out) && /G13 vift_settings — objektformat register — INTE prövat/.test(r.out), 'nivå 2: G13 redovisas som delvis; objektformade register markerade som inte prövade');
    ok(/INFO +CHK serverstöd — servern stöder tre lägen/.test(r.out), 'nivå 2: checklistans sondering görs här (på test-AO:n)');
    ok(/OK +AFFÄRSPOSTER — befintliga register-element/.test(r.out), 'nivå 2: befintliga affärsposter identiska före/efter (verktygets egen kontroll)');
    ok(JSON.stringify(fake.get('workOrders')) === aosBefore, 'nivå 2: alla befintliga AO oförändrade, inklusive updatedAt (ingen no-op-patch på skarp AO)');
    ok(JSON.stringify(fake.get('timeEntries')) === tesBefore, 'nivå 2: tidposter oförändrade');
    ok(dump() === snap, 'nivå 2: alla register bitidentiska efter städning (bara vift_lastChanged ändrad)');
    // T3-B: fler patch_ao/take_from_pool (G9 skärpt, start/klar, tagning) — alla mot märkta test-AO.
    const aoCalls = fake.calls.filter((c) => /ao-time-write:(patch_ao|take_from_pool)/.test(c.action));
    ok(aoCalls.length >= 2 && aoCalls.every((c) => String(c.aoId || '').startsWith('E2E-AUTHZ-')), 'nivå 2: alla patch_ao/take_from_pool (' + aoCalls.length + ') mot märkta test-AO, ingen mot befintliga AO');
    ok(/OK +G9\/SEC-AO-15 admin → fakturerad \+ invoiceId via patch_ao \(test-AO\) — HTTP 403 forbidden\/invoice_path_required/.test(r.out), 'nivå 2 (T3-B): G9 kontrollerar status, error, reason och oförändrad test-AO');
    ok(/OK +SEC-POOL-05 fält tar öppen pool/.test(r.out) && /OK +SEC-POOL-06\/14 fält2 tar den redan tagna test-AO:n — HTTP 409 already_assigned/.test(r.out), 'nivå 2 (T3-B): tagning och 409 already_assigned prövade');
    ok(/OK +SEC-POOL-11 tid på öppen pool före tagning \(fält\) — HTTP 403 forbidden\/not_assigned/.test(r.out) && /OK +SEC-TID-03 instämpling/.test(r.out), 'nivå 2 (T3-B): tid och stämpling utan tilldelning nekas med not_assigned');
    ok(/OK +SEC-AO-08\/09/.test(r.out) && /OK +SÄK-12 samma tagningsnyckel med annan aktör/.test(r.out), 'nivå 2 (T3-B): servern sätter completedBy, idempotens bunden till aktör');
    ok(/G6 dubbel create_time samma nyckel — svar \d+\/\d+, tidposter på servern: 1/.test(r.out), 'nivå 2: G6 kördes på test-AO:n');
    ok(/CHK återställ annans \(fält2, ao_checklist\)/.test(r.out) && /OK +CHK ao_edit \((chef|admin)\) återställer annans \+ historik/.test(r.out), 'nivå 2: checklistans ägarkontroll prövad');
    const rapport = rid && path.join(ROOT, 'tests/staging/rapport/authz-mutation-' + rid + '.json');
    ok(rapport && fs.existsSync(rapport) && fs.existsSync(path.join(ROOT, 'tests/staging/rapport/' + rid + '.journal.json')), 'nivå 2: rapport och journal skrivna');

    // ── Misslyckad städning → kod 3, poster listade; --stada tar bort ─
    snap = dump();
    fake.addFault({ match: /ao-time-write:permanent_delete_ao/, mode: 'fail', status: 503, error: 'unavailable' });
    r = await run('tests/staging/authz-mutation.js', MUT);
    const rid2 = (r.out.match(/runId (E2E-AUTHZ-\d{14}-[0-9a-f]{6})/) || [])[1];
    ok(r.code === 3 && /TESTPOSTER KVAR efter efterkontroll: AO /.test(r.out) && r.out.includes('--stada=' + rid2), 'städfel: kod 3, kvarvarande AO listad och städkommando angivet');
    // Nästa körning vägrar starta medan testposter ligger kvar.
    c0 = fake.calls.length;
    const n1 = reqCount;
    r = await run('tests/staging/authz-mutation.js', MUT);
    ok(r.code === 2 && new RegExp('ostädad tidigare körning: .*' + rid2).test(r.out) && reqCount === n1, 'ostädad körning (spärrfil): ny körning vägrar FÖRE första anropet (anrop: ' + (reqCount - n1) + ')');
    fake.clearFaults();
    r = await run('tests/staging/authz-mutation.js', MUT.concat(['--stada=' + rid2]));
    ok(r.code === 0 && /OK +ÅTERSTÄLLNING — efterkontrollerat: inga testposter kvar/.test(r.out) && /JOURNAL — \d+ poster lästa/.test(r.out), '--stada: läser journalen, tar bort kvarvarande testposter (kod ' + r.code + ')');
    ok(dump() === snap, '--stada: registren bitidentiska med före körningen');
    ok(!fake.get('workOrders').some((a) => String(a.id).startsWith('E2E-AUTHZ-')), '--stada: ingen test-AO kvar');

    // ── Nätverk/ögonblicksbild fallerar EFTER mutationer ──────────────
    // Alla AO-läsningar efter den första misslyckas: körningen avbryts mitt
    // i, efterkontrollen kan inte göras. Städningen ska ändå ske utifrån
    // journalen, och verktyget får INTE påstå att allt är återställt.
    snap = dump();
    let wlCount = 0;
    fake.addFault({ match: (act) => /^work-orders-list/.test(act) && ++wlCount > 1, mode: 'fail', status: 503, error: 'unavailable' });
    r = await run('tests/staging/authz-mutation.js', MUT);
    const rid3 = (r.out.match(/runId (E2E-AUTHZ-\d{14}-[0-9a-f]{6})/) || [])[1];
    ok(r.code === 3 && /EFTERKONTROLLEN KUNDE INTE GÖRAS/.test(r.out) && !/efterkontrollerat: inga testposter kvar/.test(r.out), 'nätfel efter mutation: kod 3, efterkontroll saknas, inget påstås återställt (kod ' + r.code + ')');
    ok(/KÖRNING — avbröts/.test(r.out) && r.out.includes('--stada=' + rid3), 'nätfel: avbrottet redovisas och återupptagen städning erbjuds');
    ok(!fake.get('workOrders').some((a) => String(a.id).startsWith(rid3)) && dump() === snap, 'nätfel: städningen från journalen tog ändå bort testposterna (registren bitidentiska)');
    fake.clearFaults();
    r = await run('tests/staging/authz-mutation.js', MUT.concat(['--stada=' + rid3]));
    ok(r.code === 0 && /OK +ÅTERSTÄLLNING — efterkontrollerat/.test(r.out), 'återupptagen städning: efterkontroll nu möjlig, kod 0');
  } catch (e) {
    fail++; console.log('FAIL krasch:', e.stack);
  }
  // Rapporter från lokala körningar sparas inte.
  try { fs.rmSync(path.join(ROOT, 'tests/staging/rapport'), { recursive: true, force: true }); } catch (e) {}
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
});
