'use strict';
/*
 * Kör tests/local/migrationskedja.sh (hela migrationskedjan mot tom lokal PostgreSQL,
 * både i STAGING-ordning och i filnamnsordning, plus jämförelse mot STAGING-facit).
 * Saknas lokal PostgreSQL hoppas testet över (redovisas, inte godkänt).
 */
const { spawnSync } = require('child_process');
const path = require('path');
const r = spawnSync('bash', [path.join(__dirname, 'local', 'migrationskedja.sh'), 'bada'], { encoding: 'utf8', env: process.env });
const out = (r.stdout || '') + (r.stderr || '');
process.stdout.write(out.split('\n').filter((l) => !/^NOTICE/.test(l)).join('\n') + '\n');
if (/HOPPAS ÖVER/.test(out)) process.exit(0);
const passes = (out.match(/^PASS /gm) || []).length;
const fails = (out.match(/^FAIL /gm) || []).length + (r.status === 0 ? 0 : 1);
console.log(`RESULT: ${passes} passed, ${fails} failed`);
process.exit(r.status === 0 ? 0 : 1);
