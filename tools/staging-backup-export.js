#!/usr/bin/env node
'use strict';
/*
 * Kopia UTANFÖR Supabase av backupschemat vift_staging_backup_20261124
 * (STAGING), med verifiering och färdig återställnings-SQL.
 *
 * Två sätt att hämta datan (bara läsning, inga skrivningar i Supabase):
 *   --fran-api            Supabase Management API (POST /v1/projects/<ref>/database/query).
 *                         Åtkomsttoken läggs in av miljöns proxy (aldrig i kod eller chatt).
 *   --fran-csv=<katalog>  tre CSV-filer nedladdade från SQL Editor (se --visa-fragor).
 *
 * Varje rad bär databasens egen md5. Verktyget räknar om md5 lokalt — en
 * kapad eller ändrad export avvisas. Utdata i --ut=<katalog>:
 *   store.json, op_idempotency.json, function_definitions.json (rådata)
 *   aterstall_store.sql            (begin … commit, kräver GO för att köras)
 *   aterstall_funktioner.sql       (CREATE OR REPLACE för alla 50 funktioner)
 *   MANIFEST.txt                   (antal, md5-summor, SHA-256 per fil)
 * --provata-lokalt laddar återställnings-SQL:en i en tillfällig lokal
 * PostgreSQL-databas och kontrollerar att varje nyckel får exakt samma md5.
 *
 * Kör ALDRIG mot LIVE: projektet måste matcha STAGING-låset (SHA-256).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const LIVE_REF = 'hjplzjsbbowiyoyhdghc';
const APPROVED_STAGING_REF_SHA256 = 'd110681c6650e44156f27451224675731facb7f37a805f0c2636acb9ef62cd43';
const SCHEMA = 'vift_staging_backup_20261124';
const md5 = (s) => crypto.createHash('md5').update(Buffer.from(s, 'utf8')).digest('hex');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const arg = (n) => { const a = process.argv.find((x) => x === '--' + n || x.startsWith('--' + n + '=')); return a === undefined ? undefined : (a.includes('=') ? a.slice(a.indexOf('=') + 1) : true); };
const die = (m, code) => { console.error('STOPP: ' + m); process.exit(code || 2); };

const Q = {
  store: `select key, md5(value::text) as md5, length(value::text) as tecken, value::text as v, updated_at::text as updated_at from ${SCHEMA}.store order by key collate "C"`,
  op_idempotency: `select fn_name, idem_key, md5(result::text) as md5, result::text as v, created_at::text as created_at from ${SCHEMA}.op_idempotency order by fn_name collate "C", idem_key collate "C"`,
  // SQL Editor kapar vid 100 rader: idempotensposterna packas i delar om 250
  // (varje post behåller sin egen md5 och sitt råa result::text).
  op_idempotency_delar: `select del, n, md5(v) as md5, v from (select (rn - 1) / 250 as del, count(*) as n, jsonb_agg(o order by rn)::text as v from (select row_number() over (order by fn_name collate "C", idem_key collate "C") as rn, jsonb_build_object('fn_name', fn_name, 'idem_key', idem_key, 'md5', md5(result::text), 'v', result::text, 'created_at', created_at::text) as o from ${SCHEMA}.op_idempotency) s group by 1) t order by del`,
  function_definitions: `select proname::text as proname, args, md5(definition) as md5, definition as v from ${SCHEMA}.function_definitions order by proname collate "C", args collate "C"`,
  summary: `select (select count(*) from ${SCHEMA}.store) as store_n, (select count(*) from ${SCHEMA}.op_idempotency) as idem_n, (select count(*) from ${SCHEMA}.function_definitions) as func_n,
    (select md5(string_agg(key || ':' || md5(value::text), '|' order by key collate "C")) from ${SCHEMA}.store) as store_sum,
    (select md5(string_agg(fn_name || ':' || idem_key || ':' || md5(result::text), '|' order by fn_name collate "C", idem_key collate "C")) from ${SCHEMA}.op_idempotency) as idem_sum,
    (select md5(string_agg(proname || '(' || args || '):' || md5(definition), '|' order by proname collate "C", args collate "C")) from ${SCHEMA}.function_definitions) as func_sum`,
};

if (arg('visa-fragor')) {
  console.log('-- Kör var för sig i SQL Editor och ladda ner resultatet som CSV:');
  console.log('-- store.csv\n' + Q.store + ';\n-- op_idempotency_delar.csv (högst 250 poster per rad, ryms under SQL Editors 100-radersgräns)\n' + Q.op_idempotency_delar + ';\n-- function_definitions.csv\n' + Q.function_definitions + ';\n-- summering (anteckna eller skärmbild)\n' + Q.summary + ';');
  process.exit(0);
}

// ── CSV (RFC 4180, citattecken) ─────────────────────────────────────
function parseCsv(text) {
  const rows = []; let row = [], f = '', i = 0, inq = false;
  if (text.charCodeAt(0) === 0xFEFF) i = 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inq) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else inq = false; } else f += c;
    } else if (c === '"') inq = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length > 1 || r[0] !== '').map((r) => Object.fromEntries(head.map((h, k) => [h, r[k]])));
}

async function fromApi(ref) {
  const call = async (query) => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (process.env.SUPABASE_ACCESS_TOKEN || 'proxy-injicerad') },
      body: JSON.stringify({ query, read_only: true }),
    });
    const t = await res.text();
    if (!res.ok) die('Management API svarade ' + res.status + ': ' + t.slice(0, 200), 3);
    return JSON.parse(t);
  };
  const out = {};
  for (const k of ['store', 'op_idempotency', 'function_definitions', 'summary']) out[k] = await call(Q[k]);
  out.summary = out.summary[0];
  return out;
}

function fromCsv(dir) {
  const out = {};
  const delar = path.join(dir, 'op_idempotency_delar.csv');
  for (const k of ['store', 'op_idempotency', 'function_definitions']) {
    if (k === 'op_idempotency' && fs.existsSync(delar)) {
      out[k] = [];
      for (const p of parseCsv(fs.readFileSync(delar, 'utf8'))) {
        if (md5(p.v) !== p.md5) die('op_idempotency_delar: md5 stämmer inte för del ' + p.del + ' (kapad eller ändrad export)', 1);
        const rows = JSON.parse(p.v);
        if (rows.length !== Number(p.n)) die('op_idempotency_delar: del ' + p.del + ' har ' + rows.length + ' poster, väntat ' + p.n, 1);
        out[k].push(...rows);
      }
      continue;
    }
    const f = path.join(dir, k + '.csv');
    if (!fs.existsSync(f)) die('saknar ' + f);
    out[k] = parseCsv(fs.readFileSync(f, 'utf8'));
  }
  const s = path.join(dir, 'summary.json');
  out.summary = fs.existsSync(s) ? JSON.parse(fs.readFileSync(s, 'utf8')) : null;
  return out;
}

function verify(d) {
  const errs = [];
  for (const k of ['store', 'op_idempotency', 'function_definitions']) {
    for (const r of d[k]) {
      if (typeof r.v !== 'string') { errs.push(k + ': värde saknas (' + (r.key || r.idem_key || r.proname) + ')'); continue; }
      if (md5(r.v) !== r.md5) errs.push(k + ': md5 stämmer inte för ' + (r.key || (r.fn_name + '/' + r.idem_key) || r.proname) + ' (kapad eller ändrad export)');
    }
  }
  d.store.forEach((r) => { if (Number(r.tecken) !== [...r.v].length) errs.push('store: längd stämmer inte för ' + r.key); });
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const sums = {
    store_n: d.store.length, idem_n: d.op_idempotency.length, func_n: d.function_definitions.length,
    store_sum: md5(d.store.slice().sort((a, b) => cmp(a.key, b.key)).map((r) => r.key + ':' + r.md5).join('|')),
    idem_sum: md5(d.op_idempotency.slice().sort((a, b) => cmp(a.fn_name, b.fn_name) || cmp(a.idem_key, b.idem_key)).map((r) => r.fn_name + ':' + r.idem_key + ':' + r.md5).join('|')),
    func_sum: md5(d.function_definitions.slice().sort((a, b) => cmp(a.proname, b.proname) || cmp(a.args, b.args)).map((r) => r.proname + '(' + r.args + '):' + r.md5).join('|')),
  };
  if (d.summary) for (const [k, v] of Object.entries(sums)) if (String(d.summary[k]) !== String(v)) errs.push('summering ' + k + ': databasen ' + d.summary[k] + ' ≠ export ' + v);
  return { errs, sums };
}

const dq = (s) => { let t = 'vift'; let n = 0; while (s.includes('$' + t + '$')) t = 'vift' + (++n); return '$' + t + '$' + s + '$' + t + '$'; };
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function restoreSql(d) {
  const store = ['-- Återställer public.store till exakt backupens innehåll (40 nycklar).',
    '-- Körs som postgres (SQL Editor) och KRÄVER GO. Nycklar som tillkommit efter backupen listas men raderas inte.',
    'begin;'];
  for (const r of d.store) {
    store.push(`insert into public.store(key, value, updated_at) values (${lit(r.key)}, ${dq(r.v)}::jsonb, ${r.updated_at ? lit(r.updated_at) + '::timestamptz' : 'now()'})\n  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;`);
  }
  store.push(`select key as tillkommen_efter_backup from public.store where key not in (${d.store.map((r) => lit(r.key)).join(', ')});`);
  store.push('-- op_idempotency: saknade rader läggs tillbaka, befintliga lämnas orörda.');
  for (const r of d.op_idempotency) store.push(`insert into public.op_idempotency(fn_name, idem_key, result, created_at) values (${lit(r.fn_name)}, ${lit(r.idem_key)}, ${dq(r.v)}::jsonb, ${lit(r.created_at)}::timestamptz) on conflict do nothing;`);
  store.push('commit;');
  const funcs = ['-- Återskapar alla public-funktioner exakt som vid backupen (CREATE OR REPLACE). KRÄVER GO.',
    '-- Funktioner som skapats EFTER backupen tas inte bort här — se installationsplanens rollback per steg.', 'begin;'];
  for (const r of d.function_definitions) funcs.push(r.v.replace(/\s+$/, '') + ';');
  funcs.push('commit;');
  return { store: store.join('\n') + '\n', funcs: funcs.join('\n') + '\n' };
}

function proveLocally(files, d) {
  const psql = (db, a) => execFileSync('psql', ['-d', db, '-qAt', '-v', 'ON_ERROR_STOP=1'].concat(a), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 }).trim();
  try { psql('postgres', ['-c', 'select 1']); } catch (e) { return 'HOPPAS ÖVER (ingen lokal PostgreSQL)'; }
  const db = 'vift_restore_' + process.pid;
  psql('postgres', ['-c', 'create database ' + db]);
  try {
    psql(db, ['-c', "create table public.store(key text primary key, value jsonb not null default 'null'::jsonb, updated_at timestamptz default now()); create table public.op_idempotency(fn_name text not null, idem_key text not null, result jsonb not null, created_at timestamptz not null default now(), primary key (fn_name, idem_key));"]);
    psql(db, ['-f', files.store]);
    const got = Object.fromEntries(psql(db, ['-c', "select key || ' ' || md5(value::text) from public.store"]).split('\n').map((l) => l.split(' ')));
    const bad = d.store.filter((r) => got[r.key] !== r.md5).map((r) => r.key);
    const idem = Number(psql(db, ['-c', 'select count(*) from public.op_idempotency']));
    const idemSum = psql(db, ['-c', `select md5(string_agg(fn_name || ':' || idem_key || ':' || md5(result::text), '|' order by fn_name collate "C", idem_key collate "C")) from public.op_idempotency`]);
    if (bad.length) return 'AVVIKER för ' + bad.join(', ');
    if (idem !== d.op_idempotency.length) return 'AVVIKER: op_idempotency ' + idem + ' rader';
    return `OK — ${d.store.length} nycklar med identisk md5, ${idem} idempotensposter (summa ${idemSum})`;
  } finally { try { psql('postgres', ['-c', 'drop database if exists ' + db + ' with (force)']); } catch (e) {} }
}

(async () => {
  const ut = arg('ut'); if (!ut || ut === true) die('ange --ut=<katalog>');
  let d;
  if (arg('fran-api')) {
    const ref = arg('projekt');
    if (!ref || ref === true) die('ange --projekt=<STAGING-ref>');
    if (ref === LIVE_REF) die('projektet är LIVE. Nekas alltid.');
    if (sha256(ref) !== APPROVED_STAGING_REF_SHA256) die('projektet matchar inte STAGING-låset.');
    d = await fromApi(ref);
  } else if (arg('fran-csv')) d = fromCsv(arg('fran-csv'));
  else die('ange --fran-api --projekt=<ref> eller --fran-csv=<katalog> (eller --visa-fragor)');

  const { errs, sums } = verify(d);
  fs.mkdirSync(ut, { recursive: true });
  if (errs.length) { errs.slice(0, 20).forEach((e) => console.error('AVVIK ' + e)); die(errs.length + ' avvikelser — exporten räknas INTE som kopia.', 1); }
  const files = { store: path.join(ut, 'aterstall_store.sql'), funcs: path.join(ut, 'aterstall_funktioner.sql') };
  for (const k of ['store', 'op_idempotency', 'function_definitions']) fs.writeFileSync(path.join(ut, k + '.json'), JSON.stringify(d[k]));
  const sql = restoreSql(d);
  fs.writeFileSync(files.store, sql.store);
  fs.writeFileSync(files.funcs, sql.funcs);
  const proof = arg('provata-lokalt') ? proveLocally(files, d) : 'inte körd (--provata-lokalt)';
  const man = ['VIFT CRM STAGING — kopia av ' + SCHEMA + ' utanför Supabase', 'Skapad: ' + new Date().toISOString(),
    'Källa: ' + (arg('fran-api') ? 'Management API (bara läsning)' : 'CSV från SQL Editor'),
    `store: ${sums.store_n} nycklar, summa ${sums.store_sum}`, `op_idempotency: ${sums.idem_n} rader, summa ${sums.idem_sum}`,
    `function_definitions: ${sums.func_n} funktioner, summa ${sums.func_sum}`,
    'Summor jämförda med databasen: ' + (d.summary ? 'JA, identiska' : 'NEJ (summary.json saknas)'),
    'Lokal återställningsprov: ' + proof, '', 'SHA-256:'];
  for (const f of fs.readdirSync(ut).filter((f) => f !== 'MANIFEST.txt').sort()) man.push(sha256(fs.readFileSync(path.join(ut, f))) + '  ' + f);
  fs.writeFileSync(path.join(ut, 'MANIFEST.txt'), man.join('\n') + '\n');
  console.log(man.join('\n'));
  if (!d.summary || !/^OK/.test(proof)) process.exit(arg('provata-lokalt') && !/^OK|HOPPAS/.test(proof) ? 1 : 0);
})().catch((e) => die(e.stack || String(e), 1));
