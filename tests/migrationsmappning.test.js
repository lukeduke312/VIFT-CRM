'use strict';
/*
 * MIG-1: kör tests/local/migrationsmappning.js (verifieringsläge). Bevisar mappningen
 * STAGING-version ↔ repo-fil mot filerna (md5) och mot lokal kedja (objektjämförelse), och
 * att supabase/migrationsmappning.json och MIGRATIONSMAPPNING.md är aktuella.
 * Saknas lokal PostgreSQL hoppas testet över (redovisas, inte godkänt).
 */
const { spawnSync } = require('child_process');
const path = require('path');
const env = Object.assign({ PGHOST: '/var/tmp/vift-localpg', PGUSER: 'postgres' }, process.env);
const r = spawnSync('node', [path.join(__dirname, 'local', 'migrationsmappning.js')], { encoding: 'utf8', env });
process.stdout.write((r.stdout || '') + (r.stderr || ''));
if (r.status !== 0 && !/RESULT:/.test(r.stdout || '')) console.log('RESULT: 0 passed, 1 failed (krasch)');
process.exit(r.status === 0 ? 0 : 1);
