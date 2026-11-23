'use strict';
/*
 * tdy()/_ds() ska ge LOKALT datum (svensk tid), inte UTC. Körs med
 * TZ=Europe/Stockholm i en egen process; klockan låses till tidpunkter
 * strax efter midnatt där UTC-datumet fortfarande är gårdagen.
 */
const { execFileSync } = require('child_process');
if (process.env.VIFT_TZ_CHILD !== '1') {
  const out = execFileSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TZ: 'Europe/Stockholm', VIFT_TZ_CHILD: '1' }), encoding: 'utf8' });
  process.stdout.write(out);
  process.exit(/RESULT: \d+ passed, 0 failed/.test(out) ? 0 : 1);
}
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const src = fs.readFileSync(path.join(__dirname, '..', 'src/data/state.js'), 'utf8');
const a = src.indexOf('function _localYmd(d) {');
const b = src.indexOf('function fmt(n) {');
const code = src.slice(a, b);
const run = (iso) => {
  const RealDate = Date;
  const fixed = new RealDate(iso).getTime();
  class FakeDate extends RealDate { constructor(...x) { if (x.length) super(...x); else super(fixed); } static now() { return fixed; } }
  const ctx = { Date: FakeDate, String };
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.r = { t: tdy(), y: _ds(-1), m: _ds(1), w: _ds(7) };', ctx);
  return ctx.r;
};
let r = run('2026-11-25T23:30:00Z'); // 00:30 svensk vintertid 26 nov
ok(r.t === '2026-11-26', 'vintertid 00:30 → idag 2026-11-26 (UTC säger 25) [' + r.t + ']');
ok(r.y === '2026-11-25' && r.m === '2026-11-27' && r.w === '2026-12-03', '_ds(-1/+1/+7) räknas från lokalt datum [' + [r.y, r.m, r.w] + ']');
r = run('2026-06-30T22:30:00Z'); // 00:30 svensk sommartid 1 jul
ok(r.t === '2026-07-01', 'sommartid 00:30 → idag 2026-07-01 över månadsskifte [' + r.t + ']');
r = run('2026-12-31T23:15:00Z'); // 00:15 1 jan
ok(r.t === '2027-01-01' && r.y === '2026-12-31', 'årsskifte: idag 2027-01-01, igår 2026-12-31 [' + r.t + ', ' + r.y + ']');
r = run('2026-11-25T12:00:00Z');
ok(r.t === '2026-11-25', 'mitt på dagen: oförändrat');
r = run('2026-03-29T00:30:00Z'); // natten då sommartid börjar (02→03)
ok(r.t === '2026-03-29' && r.m === '2026-03-30', 'sommartidsövergång: _ds(+1) hoppar inte över/dubblar en dag [' + r.t + ', ' + r.m + ']');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
