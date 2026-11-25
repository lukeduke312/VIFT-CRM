'use strict';
/*
 * offer-attachment-upload: PATCH utan regression mot den INSTALLERADE
 * STAGING-versionen v12 (supabase/backup/staging-ef-fore-installation/ i den
 * auktoritativa serverkällan vift-v2/supabase, KÄLLA-1).
 *
 * Del 1 (statisk): varje rad i v12 finns kvar, i samma ordning, i repots
 *   källa. Enda tillåtna ändring av en befintlig rad är CORS-metoderna
 *   (PATCH tillagd). Inga direkta skrivningar mot store.
 * Del 2 (riktig lokal PostgreSQL): de installerade RPC:erna (fixtur, md5
 *   kontrollerad mot STAGING) + migrationen 20261125000001. Vitlistning,
 *   not_found, behörighet och samtidighet med offer_attachment_append.
 * Del 3 (EF-källan körd i Node): TypeScript-källan transpileras, Deno-
 *   importerna ersätts med stubbar och varje rpc()/select går mot samma
 *   lokala PostgreSQL. Uppladdning, PATCH, DELETE och CORS provas.
 * Lokalt test — INTE ett STAGING-bevis.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };

const ROOT = path.join(__dirname, '..');
const { serverPath } = require('./lib/serverkalla'); // KÄLLA-1: vift-v2/supabase
const V12 = serverPath('backup/staging-ef-fore-installation/offer-attachment-upload-v12/functions/offer-attachment-upload/index.ts');
const SRC = serverPath('functions/offer-attachment-upload/index.ts');
const MIG = serverPath('migrations/20261125000001_offer_attachment_patch.sql');
const FIX = path.join(__dirname, 'fixtures/staging_offer_rpcs_installed.sql');

// ── Del 1: statisk jämförelse mot v12 ───────────────────────────────
const v12 = fs.readFileSync(V12, 'utf8').split('\n');
const src = fs.readFileSync(SRC, 'utf8');
const srcLines = src.split('\n');
const ALLOWED_CHANGED = new Map([["  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS'", "  'Access-Control-Allow-Methods': 'POST, PATCH, DELETE, OPTIONS'"]]);
let at = 0; const missing = [];
for (const line of v12) {
  const want = ALLOWED_CHANGED.has(line) ? ALLOWED_CHANGED.get(line) : line;
  let i = at; while (i < srcLines.length && srcLines[i] !== want) i++;
  if (i === srcLines.length) missing.push(line); else at = i + 1;
}
ok(missing.length === 0, 'alla ' + v12.length + ' rader i installerade v12 finns kvar i ordning' + (missing.length ? ' — saknas: ' + JSON.stringify(missing.slice(0, 3)) : ''));
for (const rpc of ['offer_attachment_append', 'offer_attachment_soft_delete', 'offer_events_append', 'offer_attachment_patch']) {
  ok(src.includes("rpc('" + rpc + "'"), 'använder ' + rpc);
}
ok(!/\.upsert\(/.test(src) && !/\.update\(/.test(src) && !/\.insert\(/.test(src), 'inga direkta skrivningar mot store (upsert/update/insert)');
ok(/'Access-Control-Allow-Headers': 'content-type, authorization, apikey'/.test(src), 'CORS tillåter apikey (som v12)');
ok(/'Access-Control-Allow-Methods': 'POST, PATCH, DELETE, OPTIONS'/.test(src), 'CORS tillåter PATCH');

// ── Del 2: riktig PostgreSQL ────────────────────────────────────────
const psql = (db, sql) => execFileSync('psql', ['-d', db, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try { psql('postgres', 'select 1'); } catch (e) { console.log(`RESULT: ${pass} passed, ${fail} failed (DEL 2–3 HOPPAS ÖVER — ingen lokal PostgreSQL; INTE godkänt, inte kört)`); process.exit(fail ? 1 : 0); }
const DB = 'vift_oau_' + process.pid;
psql('postgres', 'create database ' + DB);
const cleanup = () => { try { psql('postgres', 'drop database if exists ' + DB + ' with (force)'); } catch (e) {} };
process.on('exit', cleanup);
psql(DB, `do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$; create table public.store(key text primary key, value jsonb not null, updated_at timestamptz default now());`);
const file = (f) => execFileSync('psql', ['-d', DB, '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', f], { stdio: ['ignore', 'pipe', 'pipe'] });
file(FIX);
const INSTALLED_MD5 = { offer_attachment_append: 'dd461992be7814e111e0ec6070e8a823', offer_attachment_soft_delete: 'c2490c7bfd6c9751bf80d754eaa3f9e9', offer_events_append: '4b6cbe2d1ac006f29f4b5167cdc50c81' };
for (const [fn, md5] of Object.entries(INSTALLED_MD5)) {
  ok(psql(DB, `select md5(pg_get_functiondef('public.${fn}'::regproc))`) === md5, 'fixturen ' + fn + ' = installerad STAGING-definition (md5)');
}
file(MIG);

const q = (s) => s == null ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";
const j = (o) => q(JSON.stringify(o)) + '::jsonb';
const run = (sql) => { try { return { ok: true, r: JSON.parse(psql(DB, sql)) }; } catch (e) { return { ok: false, err: String(e.stderr || e.message) }; } };
const val = (k) => JSON.parse(psql(DB, `select value::text from store where key=${q(k)}`) || 'null');
const att = (id) => (val('vift_offerAttachments') || []).find((a) => a.id === id);

const A1 = { id: 'att-1', offerId: 'OFF-1', offerVersionId: 'v1', storagePath: 'offer-attachments/OFF-1/att-1/a.pdf', originalFileName: 'a.pdf', displayName: 'A', description: 'd', includeInPublicView: true, includeInCombinedPdf: false, active: true, lockedInVersion: 'v1', checksum: 'x' };
const A2 = { id: 'att-2', offerId: 'OFF-1', originalFileName: 'b.pdf', displayName: 'B', active: true };
const A3 = { id: 'att-3', offerId: 'OFF-1', originalFileName: 'c.pdf', displayName: 'C', active: false };
psql(DB, `insert into store values ('vift_offerAttachments', ${j([A1, A2, A3])})`);
const patch = (id, p) => run(`select offer_attachment_patch(${q(id)}, ${j(p)})::text`);

let r = patch('att-1', { displayName: '  Ny  ', description: 'ny', includeInPublicView: false, includeInCombinedPdf: true, storagePath: 'x/../y', active: false, lockedInVersion: '', offerId: 'OFF-9' });
const a1 = att('att-1');
ok(r.ok && a1.displayName === 'Ny' && a1.description === 'ny' && a1.includeInPublicView === false && a1.includeInCombinedPdf === true, 'PATCH ändrar de fyra fälten');
ok(a1.storagePath === A1.storagePath && a1.active === true && a1.lockedInVersion === 'v1' && a1.offerId === 'OFF-1' && a1.checksum === 'x', 'övriga fält (sökväg, aktiv, låst version, offert) orörda');
ok(/^\d{4}-\d\d-\d\dT/.test(a1.updatedAt) && r.r.attachment.updatedAt === a1.updatedAt, 'updatedAt sätts och returneras');
const canon = (o) => JSON.stringify(o, Object.keys(o).sort());
ok(canon(att('att-2')) === canon(A2) && canon(att('att-3')) === canon(A3), 'andra bilagor oförändrade');
ok(/^"\d{4}-/.test(psql(DB, "select value::text from store where key='vift_lastChanged'")), 'vift_lastChanged uppdateras');
r = patch('att-1', { displayName: '   ' });
ok(r.ok && att('att-1').displayName === 'a.pdf', 'tomt namn → originalfilnamnet');
r = patch('att-1', { includeInPublicView: 'true' });
ok(r.ok && att('att-1').includeInPublicView === false, 'icke-boolean "true" tolkas som false (strikt)');
r = patch('att-1', { description: 'x'.repeat(1500) });
ok(r.ok && att('att-1').description.length === 1000, 'beskrivning kapas till 1000 tecken');
r = patch('att-9', { displayName: 'X' });
ok(!r.ok && /not_found/.test(r.err), 'okänd bilaga → not_found');
r = patch('att-3', { displayName: 'X' });
ok(!r.ok && /not_found/.test(r.err) && att('att-3').displayName === 'C', 'borttagen bilaga → not_found, inget ändras');
r = run(`select offer_attachment_patch('att-1', '[]'::jsonb)::text`);
ok(!r.ok && /invalid_patch/.test(r.err), 'patch som inte är ett objekt nekas');
ok(psql(DB, "select has_function_privilege('authenticated','public.offer_attachment_patch(text,jsonb)','execute')") === 'f'
  && psql(DB, "select has_function_privilege('anon','public.offer_attachment_patch(text,jsonb)','execute')") === 'f'
  && psql(DB, "select has_function_privilege('service_role','public.offer_attachment_patch(text,jsonb)','execute')") === 't', 'bara service_role får köra offer_attachment_patch');
ok(psql(DB, "select prosecdef from pg_proc where proname='offer_attachment_patch'") === 't', 'SECURITY DEFINER som de installerade RPC:erna');

// Samtidighet: PATCH håller låset medan en uppladdning väntar (och omvänt).
const bg = (sql) => new Promise((resolve) => { const p = spawn('psql', ['-d', DB, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql]); let e = ''; p.stderr.on('data', (d) => { e += d; }); p.on('close', (c) => resolve({ code: c, err: e })); });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

(async () => {
  const pA = bg(`begin; select offer_attachment_patch('att-2', ${j({ displayName: 'B-ändrad' })}); select pg_sleep(0.8); commit;`);
  await sleep(250);
  const pB = bg(`select offer_attachment_append(${j({ id: 'att-4', offerId: 'OFF-1', originalFileName: 'd.pdf', displayName: 'D', active: true })});`);
  const [ra, rb] = await Promise.all([pA, pB]);
  ok(ra.code === 0 && rb.code === 0 && att('att-2').displayName === 'B-ändrad' && !!att('att-4'), 'samtidig PATCH + uppladdning: båda ändringarna finns kvar');
  const pC = bg(`begin; select offer_attachment_append(${j({ id: 'att-5', offerId: 'OFF-1', originalFileName: 'e.pdf', displayName: 'E', active: true })}); select pg_sleep(0.8); commit;`);
  await sleep(250);
  const pD = bg(`select offer_attachment_patch('att-4', ${j({ description: 'efter' })});`);
  const pE = bg(`select offer_attachment_soft_delete('att-1');`);
  const [rc, rd, re] = await Promise.all([pC, pD, pE]);
  ok(rc.code === 0 && rd.code === 0 && re.code === 0 && !!att('att-5') && att('att-4').description === 'efter' && att('att-1').active === false, 'samtidig uppladdning + PATCH + borttagning: inget tappas');
  ok(val('vift_offerAttachments').length === 5, 'exakt 5 bilagor (inga dubbletter, inga förluster)');

  // ── Del 3: EF-källan körd i Node mot samma databas ─────────────────
  let tscOk = true;
  try { execFileSync('tsc', ['--version'], { stdio: 'pipe' }); } catch (e) { tscOk = false; }
  if (!tscOk) { console.log('INFO del 3 hoppas över — tsc saknas (INTE godkänt)'); fail++; return finish(); }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vift-oau-'));
  const ts = src
    .replace("from 'https://deno.land/std@0.208.0/http/server.ts'", "from './stub-server'")
    .replace("from 'https://esm.sh/@supabase/supabase-js@2'", "from './stub-supabase'")
    .replace("from '../_shared/vift-auth.ts'", "from './stub-auth'");
  ok(ts !== src && !/https:\/\//.test(ts.split('\n').filter((l) => /^import /.test(l)).join('\n')), 'Deno-importer ersatta med stubbar');
  fs.writeFileSync(path.join(out, 'index.ts'), 'declare const Deno: any;\n' + ts);
  fs.writeFileSync(path.join(out, 'stub-server.ts'), 'export function serve(h: any) { (globalThis as any).__handler = h }\n');
  fs.writeFileSync(path.join(out, 'stub-supabase.ts'), 'export function createClient(..._a: any[]): any { return (globalThis as any).__client }\nexport type SupabaseClient = any\n');
  fs.writeFileSync(path.join(out, 'stub-auth.ts'), 'export async function checkViftAuth(_s: any, jwt: string, cors: any): Promise<any> { return (globalThis as any).__auth(jwt, cors) }\nexport function hasPerm(p: string[], x: string) { return p.includes("all") || p.includes(x) }\n');
  try {
    execFileSync('tsc', ['--outDir', path.join(out, 'js'), '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck', '--lib', 'es2020,dom', path.join(out, 'index.ts')], { stdio: 'pipe' });
  } catch (e) { /* typfel (Deno-typer) hindrar inte utdata */ }
  ok(fs.existsSync(path.join(out, 'js', 'index.js')), 'EF-källan transpilerad');

  const writes = [];
  globalThis.Deno = { env: { get: () => '' } };
  globalThis.__auth = (jwt, cors) => {
    const U = { admin: { perms: ['all'], id: 'ST-1' }, saljare: { perms: ['offer_manage'], id: 'ST-2' }, falt: { perms: ['ao_view_own'], id: 'ST-3' } }[jwt];
    if (!U) return { ok: false, response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors }) };
    return { ok: true, user: { id: 'u-' + U.id }, userEmail: U.id + '@example.test', staffMember: { id: U.id }, perms: U.perms };
  };
  globalThis.__client = {
    rpc: async (fn, args) => {
      const list = Object.entries(args).map(([k, v]) => k + ' => ' + (v !== null && typeof v === 'object' ? j(v) : q(v))).join(', ');
      try { return { data: JSON.parse(psql(DB, `select ${fn}(${list})::text`)), error: null }; }
      catch (e) { return { data: null, error: { message: String(e.stderr || e.message) } }; }
    },
    from: (t) => ({
      select: () => ({ eq: (_c, k) => ({ maybeSingle: async () => ({ data: { value: val(k) }, error: null }) }) }),
      upsert: () => { writes.push(t); throw new Error('direkt store-skrivning'); },
      update: () => { writes.push(t); throw new Error('direkt store-skrivning'); },
      insert: () => { writes.push(t); throw new Error('direkt store-skrivning'); },
    }),
    storage: { from: (b) => ({ upload: async (p) => { writes.push('storage:' + b + ':' + p); return { error: null }; } }) },
  };
  require(path.join(out, 'js', 'index.js'));
  const H = globalThis.__handler;
  const call = async (method, who, body, extra) => {
    const init = { method, headers: Object.assign(who ? { authorization: 'Bearer ' + who } : {}, extra || {}) };
    if (body instanceof FormData) init.body = body; else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
    const res = await H(new Request('http://localhost/functions/v1/offer-attachment-upload', init));
    let b = null; try { b = await res.clone().json(); } catch (e) {}
    return { status: res.status, body: b, headers: res.headers };
  };
  psql(DB, `insert into store values ('vift_offers', ${j([{ id: 'OFF-1' }])})`);
  const events = () => (val('vift_offerEvents') || []);

  let res = await call('OPTIONS');
  ok(res.status === 200 && /PATCH/.test(res.headers.get('access-control-allow-methods')) && /apikey/.test(res.headers.get('access-control-allow-headers')), 'OPTIONS: PATCH och apikey tillåts (preflight för klientens anrop)');
  const fd = new FormData();
  fd.append('file', new File([Buffer.from('%PDF-1.4\nx')], 'offert.pdf', { type: 'application/pdf' }));
  fd.append('offerId', 'OFF-1'); fd.append('offerVersionId', 'v1'); fd.append('uploadedBy', 'ST-2');
  res = await call('POST', 'saljare', fd);
  const newId = res.body && res.body.attachment && res.body.attachment.id;
  ok(res.status === 200 && !!newId && !!att(newId) && val('vift_offerAttachments').length === 6, 'uppladdning: atomisk append (v12-vägen) fungerar');
  ok(events().some((e) => e.type === 'attachment_added'), 'uppladdning loggas via offer_events_append');
  res = await call('PATCH', 'saljare', { attachmentId: newId, displayName: 'Ritning', includeInPublicView: false, storagePath: 'hack' });
  ok(res.status === 200 && res.body.ok === true && res.body.attachment.displayName === 'Ritning' && att(newId).displayName === 'Ritning' && att(newId).includeInPublicView === false, 'PATCH sparas och returnerar bilagan');
  ok(att(newId).storagePath.startsWith('offer-attachments/OFF-1/' + newId + '/'), 'PATCH kan inte ändra sökvägen');
  const ev = events().find((e) => e.type === 'attachment_updated');
  ok(!!ev && ev.byUser === 'ST-2' && ev.offerId === 'OFF-1', 'PATCH loggas som attachment_updated med verifierad personal-id');
  res = await call('PATCH', 'saljare', { attachmentId: 'finns-inte', displayName: 'x' });
  ok(res.status === 404 && res.body.error === 'not_found', 'PATCH okänd bilaga → 404');
  res = await call('PATCH', 'saljare', { displayName: 'x' });
  ok(res.status === 400 && res.body.error === 'missing_fields', 'PATCH utan attachmentId → 400');
  res = await call('PATCH', 'falt', { attachmentId: newId, displayName: 'x' });
  ok(res.status === 403 && att(newId).displayName === 'Ritning', 'PATCH utan offer_manage → 403, inget ändras');
  res = await call('PATCH', null, { attachmentId: newId, displayName: 'x' });
  ok(res.status === 403, 'PATCH utan inloggning → 403');
  res = await call('DELETE', 'saljare', { attachmentId: newId });
  ok(res.status === 200 && att(newId).active === false && events().some((e) => e.type === 'attachment_removed'), 'DELETE: atomisk soft delete (v12-vägen) + händelse');
  res = await call('PATCH', 'saljare', { attachmentId: newId, displayName: 'x' });
  ok(res.status === 404, 'PATCH på borttagen bilaga → 404');
  res = await call('PUT', 'saljare', { attachmentId: newId });
  ok(res.status === 405, 'andra metoder → 405 (som v12)');
  ok(writes.every((w) => w.startsWith('storage:offer-attachments:OFF-1/')), 'inga direkta store-skrivningar från EF:en (bara Storage-uppladdning)');
  try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) {}
  finish();
})().catch((e) => { fail++; console.log('FAIL krasch: ' + e.stack); finish(); });

function finish() { console.log(`RESULT: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
