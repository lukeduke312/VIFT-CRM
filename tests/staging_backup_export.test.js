'use strict';
/*
 * tools/staging-backup-export.js — lokalt prov (riktig PostgreSQL, påhittad
 * data, ingen trafik mot Supabase). Ett backupschema med svåra tecken
 * exporteras som CSV på samma sätt som SQL Editor gör, verifieras och
 * återställs i en tom databas. En kapad export ska avvisas.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const psql = (db, a) => execFileSync('psql', ['-d', db, '-qAt', '-v', 'ON_ERROR_STOP=1'].concat(a), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }).trim();
try { psql('postgres', ['-c', 'select 1']); } catch (e) { console.log('RESULT: 0 passed, 0 failed (HOPPAS ÖVER — ingen lokal PostgreSQL; INTE godkänt, inte kört)'); process.exit(0); }
const TOOL = path.join(__dirname, '..', 'tools', 'staging-backup-export.js');
const S = 'vift_staging_backup_20261124';
const DB = 'vift_bx_' + process.pid;
psql('postgres', ['-c', 'create database ' + DB]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vift-bx-'));
process.on('exit', () => { try { psql('postgres', ['-c', 'drop database if exists ' + DB + ' with (force)']); } catch (e) {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} });

const big = Array.from({ length: 3000 }, (_, i) => ({ id: 'AO-' + i, title: "Kund's \"tak\" — åäö $vift$ \\n rad\nny", n: i * 1.5 }));
psql(DB, ['-c', `create schema ${S};
  create table ${S}.store(key text, value jsonb, updated_at timestamptz);
  create table ${S}.op_idempotency(fn_name text, idem_key text, result jsonb, created_at timestamptz);
  create table ${S}.function_definitions(proname name, args text, definition text);`]);
const ins = (k, v) => { const f = path.join(tmp, 'ins.sql'); fs.writeFileSync(f, `insert into ${S}.store values ('${k}', $q$${JSON.stringify(v)}$q$::jsonb, '2026-11-23 21:45:56.869959+00');`); psql(DB, ['-f', f]); };
ins('vift_workOrders', big); ins('vift_settings', { a: 1, 'ö': 'x,y', e: '' }); ins('vift_lastChanged', '2026-11-23T21:45:56.869Z'); ins('vift_contracts', []);
psql(DB, ['-c', `insert into ${S}.op_idempotency select 'work_order_patch', 'k' || g, jsonb_build_object('ok', true, 'g', g), now() from generate_series(1, 600) g`]);
psql(DB, ['-c', `insert into ${S}.function_definitions values ('f1', 'p text', E'CREATE OR REPLACE FUNCTION public.f1(p text)\\n RETURNS text\\n LANGUAGE sql\\nAS $function$ select p $function$\\n')`]);

const csv = (q, f) => fs.writeFileSync(path.join(tmp, 'csv', f), execFileSync('psql', ['-d', DB, '--csv', '-c', q], { encoding: 'utf8', maxBuffer: 64 << 20 }));
fs.mkdirSync(path.join(tmp, 'csv'));
const qs = execFileSync(process.execPath, [TOOL, '--visa-fragor'], { encoding: 'utf8' }).split(';\n').map((s) => s.replace(/^(--[^\n]*\n)+/, '').trim()).filter(Boolean);
ok(qs.length === 4, 'verktyget visar fyra SQL Editor-frågor');
csv(qs[0], 'store.csv'); csv(qs[1], 'op_idempotency_delar.csv'); csv(qs[2], 'function_definitions.csv');
const sum = JSON.parse(execFileSync('psql', ['-d', DB, '-qAt', '-c', `select row_to_json(t) from (${qs[3]}) t`], { encoding: 'utf8' }));
fs.writeFileSync(path.join(tmp, 'csv', 'summary.json'), JSON.stringify(sum));

let r = spawnSync(process.execPath, [TOOL, '--fran-csv=' + path.join(tmp, 'csv'), '--ut=' + path.join(tmp, 'ut'), '--provata-lokalt'], { encoding: 'utf8' });
ok(r.status === 0, 'export från CSV godkänd (kod ' + r.status + ') ' + (r.stderr || '').slice(0, 200));
ok(/Summor jämförda med databasen: JA, identiska/.test(r.stdout), 'summor identiska med databasen');
ok(/Lokal återställningsprov: OK — 4 nycklar med identisk md5, 600 idempotensposter/.test(r.stdout), 'återställnings-SQL:en ger identiska värden i en tom databas');
const man = fs.readFileSync(path.join(tmp, 'ut', 'MANIFEST.txt'), 'utf8');
ok(['aterstall_store.sql', 'aterstall_funktioner.sql', 'store.json', 'op_idempotency.json', 'function_definitions.json'].every((f) => man.includes('  ' + f)), 'manifest med SHA-256 för alla filer');
const fsql = fs.readFileSync(path.join(tmp, 'ut', 'aterstall_funktioner.sql'), 'utf8');
psql(DB, ['-f', path.join(tmp, 'ut', 'aterstall_funktioner.sql')]);
ok(psql(DB, ['-c', "select public.f1('x')"]) === 'x' && /^begin;/m.test(fsql), 'funktions-SQL:en återskapar funktionen');

// Kapad export (SQL Editor kan korta långa celler) → ska avvisas.
const st = fs.readFileSync(path.join(tmp, 'csv', 'store.csv'), 'utf8');
fs.mkdirSync(path.join(tmp, 'kapad')); for (const f of ['op_idempotency_delar.csv', 'function_definitions.csv', 'summary.json']) fs.copyFileSync(path.join(tmp, 'csv', f), path.join(tmp, 'kapad', f));
fs.writeFileSync(path.join(tmp, 'kapad', 'store.csv'), st.replace('"AO-2999"', '"AO-29"'));
r = spawnSync(process.execPath, [TOOL, '--fran-csv=' + path.join(tmp, 'kapad'), '--ut=' + path.join(tmp, 'ut2')], { encoding: 'utf8' });
ok(r.status === 1 && /md5 stämmer inte för vift_workOrders/.test(r.stderr) && /räknas INTE som kopia/.test(r.stderr), 'ändrad/kapad export avvisas');
fs.writeFileSync(path.join(tmp, 'kapad', 'store.csv'), st.split('\n').filter((l) => !l.startsWith('vift_contracts')).join('\n'));
r = spawnSync(process.execPath, [TOOL, '--fran-csv=' + path.join(tmp, 'kapad'), '--ut=' + path.join(tmp, 'ut3')], { encoding: 'utf8' });
ok(r.status === 1 && /summering store_n/.test(r.stderr), 'saknad rad avvisas mot databasens summering');

// En kapad del av idempotensposterna → avvisas.
fs.copyFileSync(path.join(tmp, 'csv', 'store.csv'), path.join(tmp, 'kapad', 'store.csv'));
const dl = fs.readFileSync(path.join(tmp, 'csv', 'op_idempotency_delar.csv'), 'utf8');
ok((dl.match(/\n\d+,250,/g) || []).length === 2 && /\n2,100,/.test(dl), 'idempotensposterna packas i delar om 250 (600 → 250+250+100)');
fs.writeFileSync(path.join(tmp, 'kapad', 'op_idempotency_delar.csv'), dl.replace('work_order_patch', 'work_order_patcX'));
r = spawnSync(process.execPath, [TOOL, '--fran-csv=' + path.join(tmp, 'kapad'), '--ut=' + path.join(tmp, 'ut4')], { encoding: 'utf8' });
ok(r.status === 1 && /op_idempotency_delar: md5 stämmer inte/.test(r.stderr), 'ändrad idempotensdel avvisas');
r = spawnSync(process.execPath, [TOOL, '--fran-api', '--projekt=hjplzjsbbowiyoyhdghc', '--ut=' + path.join(tmp, 'x')], { encoding: 'utf8' });
ok(r.status === 2 && /LIVE/.test(r.stderr), 'LIVE nekas alltid');
r = spawnSync(process.execPath, [TOOL, '--fran-api', '--projekt=abcdefghijklmnopqrst', '--ut=' + path.join(tmp, 'x')], { encoding: 'utf8' });
ok(r.status === 2 && /STAGING-låset/.test(r.stderr), 'okänt projekt nekas');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
