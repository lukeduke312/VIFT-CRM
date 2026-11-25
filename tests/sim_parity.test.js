'use strict';
/*
 * T3-0 paritetsramverk (SEC-SIM-01, SÄK-17): samma scenarier körs mot
 *   (a) den lokala STAGING-replikan med den FAKTISKA serverkoden (vift-v2/supabase:
 *       migrationskedjan + Edge Functions transpilerade och körda i Node), och
 *   (b) den simulerade servern tests/e2e/fake-backend.js,
 * och status, error, reason och utfall jämförs. Kända avvikelser står i
 * tests/e2e/paritet-kanda-avvikelser.json. Testet underkänns av en NY avvikelse och av en
 * känd avvikelse som ändrats eller försvunnit (listan ska då uppdateras, inte testet).
 * Ramverket (scenarier och körning) ligger i serverkällan:
 *   $VIFT_SERVER_ROOT/../tests/local/lib/paritet.js
 * Kräver lokal PostgreSQL och tsc. Saknas PostgreSQL hoppas testet över (inte godkänt).
 */
const fs = require('fs');
const path = require('path');
const { serverRoot } = require('./lib/serverkalla');
const ROT = serverRoot();
process.env.VIFT_SERVER_ROOT = ROT;
if (!process.env.PGHOST) process.env.PGHOST = '/var/tmp/vift-localpg';
if (!process.env.PGUSER) process.env.PGUSER = 'postgres';
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m + (d ? '\n        ' + JSON.stringify(d).slice(0, 600) : '')); } };
const lib = path.join(ROT, '..', 'tests', 'local', 'lib');
if (!fs.existsSync(path.join(lib, 'paritet.js'))) { console.log('FAIL paritetsramverket saknas i serverkällan: ' + lib); console.log('RESULT: 0 passed, 1 failed'); process.exit(1); }
const { pgAvailable } = require(path.join(lib, 'db.js'));
if (!pgAvailable()) { console.log('RESULT: 0 passed, 0 failed (HOPPAS ÖVER — ingen lokal PostgreSQL; INTE godkänt, inte kört)'); process.exit(0); }
const { korParitet } = require(path.join(lib, 'paritet.js'));
const kanda = JSON.parse(fs.readFileSync(path.join(__dirname, 'e2e', 'paritet-kanda-avvikelser.json'), 'utf8')).avvikelser;

korParitet({ fakeBackend: path.join(__dirname, 'e2e', 'fake-backend.js'), root: ROT }).then((res) => {
  for (const x of res) {
    const k = kanda.find((y) => y.id === x.id);
    if (x.lika) ok(!k, `${x.id} (${x.sec}, ${x.anv} → ${x.ef}): samma utfall i replik och fake (${x.replik.status}${x.replik.error ? ' ' + x.replik.error : ''})`, k ? 'listad som känd avvikelse men är nu lika — ta bort den ur listan' : null);
    else if (k) ok(JSON.stringify(k.replik) === JSON.stringify(x.replik) && JSON.stringify(k.fake) === JSON.stringify(x.fake), `${x.id}: KÄND AVVIKELSE (${x.sec}) — replik ${x.replik.status}/${x.replik.error}, fake ${x.fake.status}/${x.fake.error}`, { observerat: { replik: x.replik, fake: x.fake }, listat: { replik: k.replik, fake: k.fake } });
    else ok(false, `${x.id} (${x.sec}): NY avvikelse mellan faktisk server och fake-backend`, { replik: x.replik, fake: x.fake });
  }
  ok(kanda.every((k) => res.some((x) => x.id === k.id)), 'alla kända avvikelser har ett scenario');
  console.log(`\nParitet: ${res.filter((x) => x.lika).length}/${res.length} scenarier lika, ${res.filter((x) => !x.lika).length} kända avvikelser (SÄK-17).`);
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.log('FAIL krasch: ' + (e.stack || e)); console.log(`RESULT: ${pass} passed, ${fail + 1} failed`); process.exit(1); });
