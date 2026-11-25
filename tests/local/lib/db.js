'use strict';
/*
 * T3-0 testverktyg: lokal PostgreSQL (bara unix-socket, aldrig STAGING/LIVE).
 *
 *   psql(db, sql)            synkront, kastar PgError {code, message, detail, hint}
 *   psqlAsync(db, sql)       egen anslutning (egen process) — för samtidighet
 *   q(db, sql) / one(db,sql) rader som JSON
 *   lit(v), jlit(o)          SQL-literaler (text / jsonb)
 *   createDb/dropDb          egna databaser med unika namn
 *   asUser(db, user, sql)    REST/RLS-vägen: SET LOCAL ROLE authenticated (eller anon)
 *                            + request.jwt.claims, som PostgREST gör per JWT
 *   rpc(db, fn, args, {as})  RPC-anrop med namngivna argument (standard service_role)
 *
 * Miljö: PGHOST måste vara en lokal socketkatalog (t.ex. /var/tmp/vift-localpg).
 */
const { execFileSync, spawn } = require('child_process');

function assertLocal() {
  const h = process.env.PGHOST || '';
  if (!h.startsWith('/')) throw new Error('PGHOST måste vara en lokal unix-socketkatalog (t.ex. /var/tmp/vift-localpg), inte "' + h + '". Testverktygen kör aldrig mot STAGING eller LIVE.');
  if (/supabase\.co|yyzljlqyzzcbxmcdbual|hjplzjsbbowiyoyhdghc/.test(JSON.stringify(process.env.PGHOST + (process.env.PGHOSTADDR || '') + (process.env.DATABASE_URL || '')))) throw new Error('Supabase-adress i miljön — avbryter');
}

class PgError extends Error {
  constructor(stderr) {
    const s = String(stderr || '');
    const m = /ERROR:\s+(?:([0-9A-Z]{5}):\s+)?([^\n]*)/.exec(s);
    super(m ? m[2] : s.trim());
    this.code = m && m[1] ? m[1] : null;
    const d = /DETAIL:\s+([^\n]*)/.exec(s); const h = /HINT:\s+([^\n]*)/.exec(s);
    this.detail = d ? d[1] : null; this.hint = h ? h[1] : null; this.stderr = s;
  }
}

const ARGS = (db) => ['-d', db, '-qAt', '-X', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];

function psql(db, sql) {
  assertLocal();
  try {
    return execFileSync('psql', ARGS(db), { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).replace(/\n$/, '');
  } catch (e) { throw new PgError(e.stderr || e.message); }
}
function psqlFile(db, file) {
  assertLocal();
  try { return execFileSync('psql', ARGS(db).concat(['-f', file]), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { throw new PgError(e.stderr || e.message); }
}
function psqlAsync(db, sql) {
  assertLocal();
  return new Promise((resolve) => {
    const p = spawn('psql', ARGS(db), { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve(code === 0 ? { ok: true, out: out.replace(/\n$/, '') } : { ok: false, error: new PgError(err) }));
    p.stdin.end(sql);
  });
}

const lit = (v) => (v === null || v === undefined) ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const jlit = (o) => lit(JSON.stringify(o === undefined ? null : o)) + '::jsonb';
const wrapJson = (sql) => `select coalesce(json_agg(t), '[]')::text from (${sql}) t`;
const q = (db, sql) => JSON.parse(psql(db, wrapJson(sql)) || '[]');
const one = (db, sql) => q(db, sql)[0] || null;
const val = (db, key) => { const r = psql(db, `select value::text from public.store where key = ${lit(key)}`); return r ? JSON.parse(r) : null; };

function pgAvailable() { try { psql('postgres', 'select 1'); return true; } catch (e) { return false; } }
function createDb(name, template) {
  psql('postgres', `drop database if exists ${name} with (force)`);
  psql('postgres', `create database ${name}${template ? ' template ' + template : ''}`);
  return name;
}
function dropDb(name) { try { psql('postgres', `drop database if exists ${name} with (force)`); } catch (e) { /* ignore */ } }

/* JWT-claims som PostgREST sätter per anrop. user = {authId, email} eller null (anon). */
function claimsFor(user) {
  return user ? { sub: user.authId, email: user.email, role: 'authenticated', aud: 'authenticated' } : { role: 'anon' };
}
function rolePrelude(user) {
  const role = user ? 'authenticated' : 'anon';
  return `set local role ${role}; select set_config('request.jwt.claims', ${lit(JSON.stringify(claimsFor(user)))}, true);`;
}
/* REST/RLS-vägen. sql är EN sats (select/insert/update/delete). Svar som PostgREST:
   {ok:true, rows} eller {ok:false, status, code, message}. 42501 → 403 (authenticated) / 401 (anon). */
function asUserSql(user, sql) {
  if (/^\s*select/i.test(sql)) return `begin;\n${rolePrelude(user)}\n${wrapJson(sql)};\ncommit;`;
  // Skrivning utan RETURNING (som PostgREST med Prefer: return=minimal); antal rader via psql:s ROW_COUNT.
  return `begin;\n${rolePrelude(user)}\n${sql.replace(/;\s*$/, '')};\n\\echo RADER :ROW_COUNT\ncommit;`;
}
function parseAsUser(user, r) {
  const m = /RADER (\d+)/.exec(String(r));
  if (m) return { ok: true, status: 201, count: Number(m[1]) };
  const lines = String(r).split('\n').filter((l) => l.startsWith('['));
  return { ok: true, status: 200, rows: JSON.parse(lines[lines.length - 1] || '[]') };
}
function restError(user, e) {
  const status = e.code === '42501' ? (user ? 403 : 401) : (e.code === 'P0001' ? 400 : 500);
  return { ok: false, status, code: e.code, message: e.message };
}
function asUser(db, user, sql) {
  try { return parseAsUser(user, psql(db, asUserSql(user, sql))); } catch (e) { return restError(user, e); }
}
async function asUserAsync(db, user, sql) {
  const r = await psqlAsync(db, asUserSql(user, sql));
  return r.ok ? parseAsUser(user, r.out) : restError(user, r.error);
}

/* RPC med namngivna argument, typade efter funktionens signatur (som PostgREST gör).
   as: 'service_role' (standard) | 'authenticated' (då krävs user) | 'anon'. */
const _sig = {};
function signatur(db, fn, namn) {
  const k = db + '|' + fn;
  if (!_sig[k]) {
    const out = execFileSync('psql', ARGS(db), { input: `select coalesce(json_agg(json_build_object('n', coalesce(p.proargnames, '{}'), 't', array(select format_type(t, null) from unnest(p.proargtypes) t))), '[]')::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = ${lit(fn)}`, encoding: 'utf8' });
    _sig[k] = JSON.parse(out.trim() || '[]');
  }
  const kand = _sig[k].find((x) => namn.every((a) => x.n.includes(a))) || _sig[k][0];
  const typer = {};
  if (kand) kand.n.forEach((a, i) => { typer[a] = kand.t[i]; });
  return typer;
}
function typLit(v, typ) {
  if (v === null || v === undefined) return 'null' + (typ ? '::' + typ : '');
  if (typ === 'jsonb' || typ === 'json') return jlit(v);
  if (typ && typ.endsWith('[]')) return (Array.isArray(v) ? 'array[' + v.map((x) => lit(x)).join(',') + ']' : lit(v)) + '::' + typ;
  if (typ) return lit(typeof v === 'object' ? JSON.stringify(v) : v) + '::' + typ;
  return argLit(v);
}
function rpcSql(db, fn, args, opts) {
  opts = opts || {};
  const typer = signatur(db, fn, Object.keys(args || {}));
  const list = Object.entries(args || {}).map(([k, v]) => k + ' => ' + typLit(v, typer[k])).join(', ');
  const call = `select coalesce(to_jsonb(r), 'null'::jsonb)::text from (select public.${fn}(${list}) as r) s`;
  const as = opts.as || 'service_role';
  const pre = as === 'service_role' ? 'set local role service_role;' : rolePrelude(as === 'anon' ? null : opts.user);
  return `begin;\n${pre}\n${call};\ncommit;`;
}
function argLit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string')) return 'array[' + v.map(lit).join(',') + ']::text[]';
  if (typeof v === 'object') return jlit(v);
  return lit(v);
}
function parseRpc(out) { const lines = String(out).split('\n').filter(Boolean); return JSON.parse(lines[lines.length - 1]); }
function rpc(db, fn, args, opts) {
  try { return { data: parseRpc(psql(db, rpcSql(db, fn, args, opts))), error: null }; }
  catch (e) { return { data: null, error: { message: e.message, code: e.code, details: e.detail, hint: e.hint } }; }
}
async function rpcAsync(db, fn, args, opts) {
  const r = await psqlAsync(db, rpcSql(db, fn, args, opts));
  return r.ok ? { data: parseRpc(r.out), error: null } : { data: null, error: { message: r.error.message, code: r.error.code, details: r.error.detail, hint: r.error.hint } };
}

module.exports = { assertLocal, PgError, psql, psqlFile, psqlAsync, lit, jlit, q, one, val, pgAvailable, createDb, dropDb, claimsFor, asUser, asUserAsync, rpc, rpcAsync, argLit };
