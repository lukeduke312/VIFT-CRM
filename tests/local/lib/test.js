'use strict';
/* Gemensam liten testram för T3-sviterna (inga npm-beroenden). */
const { pgAvailable } = require('./db');
const { tscFinns } = require('./ef');
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m + (d ? '\n        ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } return !!c; };
function krav(opts) {
  opts = opts || {};
  if (!process.env.PGHOST) process.env.PGHOST = '/var/tmp/vift-localpg';
  if (!process.env.PGUSER) process.env.PGUSER = 'postgres';
  if (!pgAvailable()) { console.log('RESULT: 0 passed, 0 failed (HOPPAS ÖVER — ingen lokal PostgreSQL; INTE godkänt, inte kört)'); process.exit(0); }
  if (opts.tsc && !tscFinns()) { console.log('RESULT: 0 passed, 1 failed (tsc saknas — EF-körning krävs, INTE godkänt)'); process.exit(1); }
}
function avsluta(extra) { console.log(`RESULT: ${pass} passed, ${fail} failed${extra ? ' ' + extra : ''}`); process.exit(fail ? 1 : 0); }
const rakna = () => ({ pass, fail });
module.exports = { ok, krav, avsluta, rakna };
