'use strict';
/*
 * T3-0 testverktyg: kör Edge Functions (TypeScript-källan i supabase/functions/) i Node
 * mot en lokal databas (replikan). Ingen Deno finns i miljön (nätpolicyn nekar deno.land),
 * så källan transpileras med lokal `tsc` till ES-moduler och körs med:
 *   - Deno-shim: Deno.env.get() (SUPABASE_URL = lokal adress, inga riktiga hemligheter)
 *     och Deno.serve/std serve -> registrerad hanterare per funktion;
 *   - supabase-js-adapter: from()/select/eq/in/is/filter/maybeSingle/single/insert/update/
 *     upsert/delete och rpc() översätts till SQL mot den lokala databasen som service_role
 *     (samma som EF:ens service-role-klient), auth.getUser(jwt) slår upp auth.users;
 *   - JWT-simulering per användare: jwtFor(user) ger en token som bara adaptern godtar.
 * Källan ändras inte; bara importsökvägarna skrivs om i en temporär kopia.
 *
 *   const ef = await laddaEf(db, ['ao-time-write', 'work-orders-list'], { root })
 *   const svar = await ef.anropa('ao-time-write', { user, body: {...} })  // {status, body, headers}
 *   ef.barriar('work_order_patch', 2)   // de två nästa RPC-anropen väntar på varandra (samtidighet)
 *   ef.rpcLogg                          // alla RPC-anrop (namn + argument)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const { psqlAsync, lit, jlit, rpcAsync, q } = require('./db');

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..', '..', 'supabase');

function tscFinns() { try { execFileSync('tsc', ['--version'], { stdio: 'pipe' }); return true; } catch (e) { return false; } }

function skrivOm(src, depth) {
  const up = '../'.repeat(depth);
  return src
    .replace(/'https:\/\/deno\.land\/std@[^']*\/http\/server\.ts'/g, `'${up}stubs/server.js'`)
    .replace(/'https:\/\/esm\.sh\/@supabase\/supabase-js@[^']*'/g, `'${up}stubs/supabase.js'`)
    .replace(/'npm:web-push@[^']*'/g, `'${up}stubs/webpush.js'`)
    .replace(/from '(\.{1,2}\/[^']+)\.ts'/g, "from '$1.js'");
}

/* Transpilerar de angivna funktionerna (+ _shared) en gång per process. */
let _cache = null;
function transpilera(root, slugs) {
  const nyckel = root + '|' + slugs.slice().sort().join(',');
  if (_cache && _cache.nyckel === nyckel) return _cache.dir;
  if (!tscFinns()) throw new Error('tsc saknas — EF-körning i Node kräver lokal TypeScript (inte godkänt, inte kört)');
  const ut = fs.mkdtempSync(path.join(os.tmpdir(), 'vift-ef-'));
  const src = path.join(ut, 'src');
  const filer = [];
  const kopiera = (rel) => {
    const abs = path.join(root, 'functions', rel);
    for (const f of fs.readdirSync(abs)) {
      if (!f.endsWith('.ts')) continue;
      const mal = path.join(src, 'functions', rel, f);
      fs.mkdirSync(path.dirname(mal), { recursive: true });
      fs.writeFileSync(mal, 'declare const Deno: any;\n' + skrivOm(fs.readFileSync(path.join(abs, f), 'utf8'), 2));
      filer.push(mal);
    }
  };
  kopiera('_shared');
  slugs.forEach(kopiera);
  fs.mkdirSync(path.join(src, 'stubs'), { recursive: true });
  fs.writeFileSync(path.join(src, 'stubs', 'server.ts'), 'export function serve(h: any, ..._r: any[]) { (globalThis as any).__viftServe(h) }\n');
  fs.writeFileSync(path.join(src, 'stubs', 'supabase.ts'), 'export function createClient(...a: any[]): any { return (globalThis as any).__viftCreateClient(...a) }\nexport type SupabaseClient = any\n');
  // T3-B: service-monitor importerar npm:web-push; i Node ersätts den av en stubbe (inga utskick).
  fs.writeFileSync(path.join(src, 'stubs', 'webpush.ts'), 'const w: any = { setVapidDetails(..._a: any[]) {}, async sendNotification(..._a: any[]) { ((globalThis as any).__viftPush = (globalThis as any).__viftPush || []).push(_a); return {} } }\nexport default w\n');
  filer.push(path.join(src, 'stubs', 'server.ts'), path.join(src, 'stubs', 'supabase.ts'), path.join(src, 'stubs', 'webpush.ts'));
  try {
    execFileSync('tsc', ['--outDir', path.join(ut, 'js'), '--rootDir', src, '--module', 'es2022', '--target', 'es2022', '--moduleResolution', 'bundler',
      '--skipLibCheck', '--lib', 'es2022,dom', '--noEmitOnError', 'false', '--allowImportingTsExtensions', 'false'].concat(filer), { stdio: 'pipe' });
  } catch (e) { /* typfel (Deno-/supabase-typer saknas) hindrar inte utdata */ }
  fs.writeFileSync(path.join(ut, 'js', 'package.json'), '{"type":"module"}\n');
  for (const s of slugs) if (!fs.existsSync(path.join(ut, 'js', 'functions', s, 'index.js'))) throw new Error('transpilering misslyckades för ' + s);
  _cache = { nyckel, dir: ut };
  process.on('exit', () => { try { fs.rmSync(ut, { recursive: true, force: true }); } catch (e) { /* ignore */ } });
  return ut;
}

/* ── JWT-simulering ─────────────────────────────────────────── */
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwtFor(user, opts) {
  opts = opts || {};
  return 'replik.' + b64({ sub: user.authId, email: user.email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + (opts.expired ? -60 : 3600) }) + '.' + (opts.badSig ? 'fel' : 'replik-signatur');
}
function lasJwt(jwt) {
  const m = /^replik\.([A-Za-z0-9_-]+)\.(.+)$/.exec(String(jwt || ''));
  if (!m || m[2] !== 'replik-signatur') return null;
  try { const c = JSON.parse(Buffer.from(m[1], 'base64url').toString()); return c.exp * 1000 > Date.now() ? c : null; } catch (e) { return null; }
}

/* ── supabase-js-adapter (service_role mot lokal databas) ───── */
function skapaKlient(db, h) {
  const kolumntyper = {};
  const typer = (t) => {
    if (!kolumntyper[t]) {
      kolumntyper[t] = {};
      q(db, `select column_name as c, data_type as d from information_schema.columns where table_schema = 'public' and table_name = ${lit(t)}`).forEach((r) => { kolumntyper[t][r.c] = r.d; });
    }
    return kolumntyper[t];
  };
  const varde = (t, kol, v) => {
    const d = typer(t)[kol];
    if (d === 'jsonb' || d === 'json') return jlit(v);
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean' || typeof v === 'number') return String(v);
    /* T3-E: text[]-kolumner (t.ex. sensitive_access_audit.fields) med en JS-lista — tidigare blev
       en tom lista '' (ogiltig literal), så nekade läsningar i get-sensitive-fields fick ingen revisionsrad. */
    if (d === 'ARRAY' && Array.isArray(v)) return 'array[' + v.map((x) => lit(x)).join(',') + ']::text[]';
    return lit(v) + (d ? '::' + (d === 'timestamp with time zone' ? 'timestamptz' : d === 'ARRAY' ? 'text[]' : d) : '');
  };
  const pgErr = (e) => ({ message: e.message, code: e.code, details: e.detail, hint: e.hint });

  function fraga(tabell) {
    const st = { op: 'select', kol: '*', filter: [], retur: null, enda: null, ordning: [], grans: null, varden: null, konflikt: null };
    const villkor = () => st.filter.length ? ' where ' + st.filter.join(' and ') : '';
    const op = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };
    const b = {
      select(kol) { if (st.op === 'select') st.kol = kol || '*'; else st.retur = kol || '*'; return b; },
      eq(c, v) { st.filter.push(`${c} = ${varde(tabell, c, v)}`); return b; },
      neq(c, v) { st.filter.push(`${c} <> ${varde(tabell, c, v)}`); return b; },
      gt(c, v) { st.filter.push(`${c} > ${varde(tabell, c, v)}`); return b; },
      gte(c, v) { st.filter.push(`${c} >= ${varde(tabell, c, v)}`); return b; },
      lt(c, v) { st.filter.push(`${c} < ${varde(tabell, c, v)}`); return b; },
      lte(c, v) { st.filter.push(`${c} <= ${varde(tabell, c, v)}`); return b; },
      is(c, v) { st.filter.push(`${c} is ${v === null ? 'null' : v ? 'true' : 'false'}`); return b; },
      in(c, arr) { st.filter.push(arr.length ? `${c} in (${arr.map((x) => varde(tabell, c, x)).join(',')})` : 'false'); return b; },
      filter(c, o, v) { if (o === 'is') return b.is(c, v); if (o === 'in') return b.in(c, String(v).replace(/^\(|\)$/g, '').split(',')); st.filter.push(`${c} ${op[o] || o} ${varde(tabell, c, v)}`); return b; },
      order(c, o) { st.ordning.push(c + (o && o.ascending === false ? ' desc' : '')); return b; },
      limit(n) { st.grans = n; return b; },
      maybeSingle() { st.enda = 'maybe'; return b; },
      single() { st.enda = 'single'; return b; },
      insert(v) { st.op = 'insert'; st.varden = Array.isArray(v) ? v : [v]; return b; },
      upsert(v, o) { st.op = 'upsert'; st.varden = Array.isArray(v) ? v : [v]; st.konflikt = o && o.onConflict; return b; },
      update(v) { st.op = 'update'; st.varden = v; return b; },
      delete() { st.op = 'delete'; return b; },
      then(res, rej) { return kor().then(res, rej); },
    };
    async function kor() {
      let sql;
      const ret = st.retur ? ` returning ${st.retur === '*' ? '*' : st.retur}` : '';
      if (st.op === 'select') {
        sql = `select ${st.kol} from public.${tabell}${villkor()}${st.ordning.length ? ' order by ' + st.ordning.join(',') : ''}${st.grans ? ' limit ' + st.grans : ''}`;
      } else if (st.op === 'insert' || st.op === 'upsert') {
        const kol = Array.from(new Set(st.varden.flatMap((r) => Object.keys(r))));
        const rader = st.varden.map((r) => '(' + kol.map((c) => (c in r ? varde(tabell, c, r[c]) : 'default')).join(',') + ')').join(',');
        let pk = st.konflikt;
        if (st.op === 'upsert' && !pk) pk = q(db, `select a.attname as c from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = 'public.${tabell}'::regclass and i.indisprimary`).map((r) => r.c).join(',');
        sql = `insert into public.${tabell} (${kol.join(',')}) values ${rader}` + (st.op === 'upsert' ? ` on conflict (${pk}) do update set ${kol.filter((c) => !pk.split(',').includes(c)).map((c) => `${c} = excluded.${c}`).join(', ')}` : '') + ret;
      } else if (st.op === 'update') {
        sql = `update public.${tabell} set ${Object.entries(st.varden).map(([c, v]) => `${c} = ${varde(tabell, c, v)}`).join(', ')}${villkor()}${ret}`;
      } else {
        sql = `delete from public.${tabell}${villkor()}${ret}`;
      }
      const harRader = st.op === 'select' || !!st.retur;
      const full = harRader ? (st.op === 'select' ? `begin; set local role service_role; select coalesce(json_agg(t), '[]')::text from (${sql}) t; commit;`
        : `begin; set local role service_role; with w as (${sql}) select coalesce(json_agg(w), '[]')::text from w; commit;`)
        : `begin; set local role service_role; ${sql}; commit;`;
      h.sqlLogg.push(sql);
      const r = await psqlAsync(db, full);
      if (!r.ok) return { data: null, error: pgErr(r.error), status: 400 };
      if (!harRader) return { data: null, error: null, status: 204 };
      // json_agg skriver radbrytning mellan elementen: läs från första raden som börjar med '['.
      const alla = r.out.split('\n');
      const forsta = alla.findIndex((l) => l.startsWith('['));
      const rows = JSON.parse(forsta < 0 ? '[]' : alla.slice(forsta).join('\n'));
      if (st.enda === 'maybe') return rows.length > 1 ? { data: null, error: { message: 'multiple rows', code: 'PGRST116' } } : { data: rows[0] || null, error: null };
      if (st.enda === 'single') return rows.length !== 1 ? { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } } : { data: rows[0], error: null };
      return { data: rows, error: null };
    }
    return b;
  }

  return {
    from: fraga,
    async rpc(fn, args) {
      h.rpcLogg.push({ fn, args });
      const bar = h._barriarer.find((x) => x.fn === fn && x.kvar > 0);
      if (bar) {
        bar.kvar--; bar.vantar.push(null);
        if (bar.kvar === 0) bar.slapp(); else await bar.lofte;
      }
      if (h.rpcFel[fn]) { const f = h.rpcFel[fn]; delete h.rpcFel[fn]; return { data: null, error: f }; }
      return rpcAsync(db, fn, args, { as: 'service_role' });
    },
    auth: {
      admin: {
        async listUsers() {
          return { data: { users: q(db, 'select id::text as id, email from auth.users') }, error: null };
        },
      },
      async getUser(jwt) {
        const c = lasJwt(jwt);
        if (!c) return { data: { user: null }, error: { message: 'invalid JWT', status: 401 } };
        const r = q(db, `select id::text as id, email from auth.users where id::text = ${lit(c.sub)}`)[0];
        if (!r) return { data: { user: null }, error: { message: 'User not found', status: 404 } };
        return { data: { user: { id: r.id, email: r.email } }, error: null };
      },
    },
    storage: {
      from(bucket) {
        const k = (p) => bucket + '/' + p;
        return {
          async upload(p, data) { h.filer.set(k(p), data); return { data: { path: p }, error: null }; },
          async remove(ps) { const d = ps.filter((p) => h.filer.delete(k(p))).map((p) => ({ name: p })); return { data: d, error: null }; },
          async list(prefix) { return { data: [...h.filer.keys()].filter((x) => x.startsWith(k(prefix) + '/')).map((x) => ({ name: x.slice(k(prefix).length + 1) })), error: null }; },
          async createSignedUrl(p) { return h.filer.has(k(p)) ? { data: { signedUrl: 'https://replik.invalid/' + encodeURIComponent(k(p)) }, error: null } : { data: null, error: { message: 'Object not found' } }; },
        };
      },
    },
  };
}

async function laddaEf(db, slugs, opts) {
  opts = opts || {};
  const root = opts.root || process.env.VIFT_SERVER_ROOT || DEFAULT_ROOT;
  const dir = transpilera(root, slugs);
  const h = { handlers: {}, rpcLogg: [], sqlLogg: [], filer: new Map(), rpcFel: {}, _barriarer: [], env: Object.assign({ SUPABASE_URL: 'http://replik.lokal', SUPABASE_SERVICE_ROLE_KEY: 'lokal-dummy-service-role' }, opts.env || {}) };
  globalThis.Deno = { env: { get: (k) => (k in h.env ? h.env[k] : undefined) }, serve: (a, b) => globalThis.__viftServe(typeof a === 'function' ? a : b) };
  const fabrik = () => skapaKlient(db, h);
  globalThis.__viftCreateClient = fabrik;
  for (const s of slugs) {
    let reg = null;
    globalThis.__viftServe = (fn) => { reg = fn; };
    await import(pathToFileURL(path.join(dir, 'js', 'functions', s, 'index.js')).href + '?db=' + db);
    if (!reg) throw new Error('EF ' + s + ' registrerade ingen hanterare');
    h.handlers[s] = reg;
  }
  h.anropa = async (slug, o) => {
    o = o || {};
    const headers = Object.assign({}, o.headers || {});
    if (o.user) headers.authorization = 'Bearer ' + jwtFor(o.user, o.jwtOpts);
    else if (o.jwt !== undefined) headers.authorization = 'Bearer ' + o.jwt;
    const init = { method: o.method || 'POST', headers };
    if (o.body !== undefined) { init.body = typeof o.body === 'string' ? o.body : JSON.stringify(o.body); headers['content-type'] = 'application/json'; }
    // Flera replikor i samma process: klientfabriken pekas om per anrop. Samtidiga anrop mot
    // OLIKA replikor i samma process stöds inte (createClient kan ske efter en await).
    globalThis.__viftCreateClient = fabrik;
    const res = await h.handlers[slug](new Request('http://replik.lokal/functions/v1/' + slug + (o.query || ''), init));
    const text = await res.text();
    let body = text; try { body = JSON.parse(text); } catch (e) { /* text */ }
    return { status: res.status, body, headers: res.headers };
  };
  h.barriar = (fn, n) => {
    const b = { fn, kvar: n, vantar: [] };
    b.lofte = new Promise((r) => { b.slapp = r; });
    h._barriarer.push(b);
    return b;
  };
  h.felVidRpc = (fn, fel) => { h.rpcFel[fn] = fel; };
  return h;
}

module.exports = { laddaEf, jwtFor, lasJwt, tscFinns, transpilera, DEFAULT_ROOT };
