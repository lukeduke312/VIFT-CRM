'use strict';
/*
 * SQL-integrationstest mot RIKTIG lokal PostgreSQL för migrationerna
 * 20261124000001_activity_log_append.sql och
 * 20261124000002_work_order_log_ops.sql (inte STAGING/LIVE).
 * Saknas lokal PostgreSQL hoppas testet över (redovisas, inte godkänt).
 */
const { execFileSync, spawn } = require('child_process');
const path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const psql = (db, sql) => execFileSync('psql', ['-d', db, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try { psql('postgres', 'select 1'); } catch (e) { console.log('RESULT: 0 passed, 0 failed (HOPPAS ÖVER — ingen lokal PostgreSQL; INTE godkänt, inte kört)'); process.exit(0); }

const DB = 'vift_rpc_' + process.pid;
psql('postgres', 'create database ' + DB);
const cleanup = () => { try { psql('postgres', 'drop database if exists ' + DB + ' with (force)'); } catch (e) {} };
process.on('exit', cleanup);
const MIG = require('./lib/serverkalla').serverPath('migrations'); // KÄLLA-1: vift-v2/supabase
psql(DB, `do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$; create table public.store(key text primary key, value jsonb not null, updated_at timestamptz default now());`);
for (const f of ['20261124000001_activity_log_append.sql', '20261124000002_work_order_log_ops.sql']) execFileSync('psql', ['-d', DB, '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', path.join(MIG, f)], { stdio: ['ignore', 'pipe', 'pipe'] });

const q = (s) => s == null ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";
const j = (o) => q(JSON.stringify(o)) + '::jsonb';
const run = (sql) => { try { return { ok: true, r: JSON.parse(psql(DB, sql)) }; } catch (e) { return { ok: false, err: String(e.stderr || e.message) }; } };
const val = (k) => JSON.parse(psql(DB, `select value::text from store where key=${q(k)}`) || 'null');

// ── activity_log_append ─────────────────────────────────────────────
psql(DB, `insert into store values ('vift_activityLog', ${j([{ id: 'ACT-old-1', type: 'note' }])})`);
let r = run(`select activity_log_append(${j({ id: 'ACT-new-000001', type: 'work_order_updated', userId: 'ST-4' })})::text`);
ok(r.ok && r.r.duplicate === false && val('vift_activityLog')[0].id === 'ACT-new-000001', 'aktivitet läggs först i loggen');
r = run(`select activity_log_append(${j({ id: 'ACT-new-000001', type: 'work_order_updated', userId: 'ST-4' })})::text`);
ok(r.ok && r.r.duplicate === true && val('vift_activityLog').length === 2, 'omsändning av samma id: ingen dubblett');
for (let i = 0; i < 8; i++) run(`select activity_log_append(${j({ id: 'ACT-cap-00000' + i, type: 'note' })}, 5)::text`);
ok(val('vift_activityLog').length === 5 && val('vift_activityLog')[0].id === 'ACT-cap-000007', 'kapas till p_max, nyaste först');
r = run(`select activity_log_append(${j({ type: 'note' })})::text`);
ok(!r.ok && /invalid_entry/.test(r.err), 'post utan id nekas');
ok(/^"\d{4}-/.test(psql(DB, "select value::text from store where key='vift_lastChanged'")), 'vift_lastChanged uppdateras');

// ── work_order_log_append / remove ──────────────────────────────────
const AO = { id: 'AO-1', title: 'T', status: 'planerad', staff: ['ST-1'], price: 100, log: [{ id: 'L-old', text: 'äldre', userName: 'X' }] };
psql(DB, `insert into store values ('vift_workOrders', ${j([AO, { id: 'AO-2', status: 'nytt', staff: [], log: [] }])}) on conflict (key) do update set value=excluded.value`);
const ao = (id) => val('vift_workOrders').find((a) => a.id === (id || 'AO-1'));
const app = (entry, who, all) => run(`select work_order_log_append('AO-1', ${j(entry)}, ${q(who)}, ${all ? 'true' : 'false'})::text`);
const rem = (eid, who, all, edit, aoId) => run(`select work_order_log_remove(${q(aoId || 'AO-1')}, ${q(eid)}, ${q(who)}, ${all ? 'true' : 'false'}, ${edit ? 'true' : 'false'})::text`);

r = app({ id: 'L-a', text: 'A', staffId: 'ST-1' }, 'ST-1', false);
ok(r.ok && ao().log.map((l) => l.id).join(',') === 'L-old,L-a', 'append lägger till posten sist');
ok(ao().price === 100 && ao().title === 'T' && ao().status === 'planerad', 'inga andra AO-fält ändras');
r = app({ id: 'L-a', text: 'A', staffId: 'ST-1' }, 'ST-1', false);
ok(r.ok && r.r.noop === true && ao().log.length === 2, 'omsändning (samma id + innehåll): ingen ändring');
r = app({ id: 'L-a', text: 'ANNAN', staffId: 'ST-1' }, 'ST-1', false);
ok(!r.ok && /id_collision/.test(r.err) && ao().log.find((l) => l.id === 'L-a').text === 'A', 'samma id med annat innehåll: id_collision, inget skrivs över');
r = run(`select work_order_log_append('AO-2', ${j({ id: 'L-x', staffId: 'ST-9' })}, 'ST-9', false)::text`);
ok(!r.ok && /forbidden/.test(r.err), 'ej tilldelad och ej pool: nekas');
r = rem('L-old', 'ST-1', false, false);
ok(!r.ok && /forbidden_other/.test(r.err) && ao().log.length === 2, 'äldre post utan staffId: borttagning kräver ao_edit');
r = rem('L-a', 'ST-2', true, false);
ok(!r.ok && /forbidden_other/.test(r.err), 'annans post: nekas utan ao_edit');
r = rem('L-a', 'ST-1', false, false);
ok(r.ok && !ao().log.some((l) => l.id === 'L-a'), 'egen post: tas bort');
const before = psql(DB, "select value::text from store where key='vift_lastChanged'");
r = rem('L-a', 'ST-1', false, false);
ok(r.ok && r.r.noop === true && psql(DB, "select value::text from store where key='vift_lastChanged'") === before, 'borttagning av saknad post: ingen skrivning');
r = rem('L-old', 'ST-9', true, true);
ok(r.ok && ao().log.length === 0, 'ao_edit tar bort äldre post');

// Samtidighet: två sessioner lägger till olika poster samtidigt → båda finns kvar.
const slow = `begin; select work_order_log_append('AO-1', '{"id":"L-s1","staffId":"ST-1"}'::jsonb, 'ST-1', false); select pg_sleep(1.0); commit;`;
const fast = `select pg_sleep(0.3); select work_order_log_append('AO-1', '{"id":"L-s2","staffId":"ST-2"}'::jsonb, 'ST-2', true);`;
const go = (sql) => new Promise((res) => { const p = spawn('psql', ['-d', DB, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql]); p.on('close', res); });
Promise.all([go(slow), go(fast)]).then((codes) => {
  const ids = ao().log.map((l) => l.id).sort().join(',');
  ok(codes.every((c) => c === 0) && ids === 'L-s1,L-s2', 'två samtidiga append (radlås): båda posterna finns kvar (' + ids + ')');
  const g = psql(DB, `select string_agg(distinct grantee, ',') from information_schema.routine_privileges where routine_name in ('work_order_log_append','work_order_log_remove','activity_log_append') and privilege_type='EXECUTE'`);
  ok(!/authenticated|anon/.test(g), 'EXECUTE inte för anon/authenticated (' + g + ')');
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  cleanup(); process.exit(fail ? 1 : 0);
});
