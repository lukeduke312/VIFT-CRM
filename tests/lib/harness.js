'use strict';
/* Minimal testharness utan npm-beroenden (projektet har ingen byggpipeline). */
let failed = 0;
let passed = 0;

function section(title) {
  console.log('\n=== ' + title + ' ===');
}

function check(label, cond, detail) {
  if (cond) { passed++; console.log('PASS — ' + label); }
  else { failed++; console.log('FAIL — ' + label + (detail ? ' [' + detail + ']' : '')); }
  return !!cond;
}

function done() {
  console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

module.exports = { section, check, done };
