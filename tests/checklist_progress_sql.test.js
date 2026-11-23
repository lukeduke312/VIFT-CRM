'use strict';
/*
 * Checklistans tre statuslägen — SQL-integrationstest mot en RIKTIG lokal
 * PostgreSQL (inte STAGING/LIVE). Kör båda migrationerna i kedjeordning
 * (20260917000001 → 20261123000002) i en temporär databas och prövar
 * RPC:n work_order_checklist_set_state + den delegerande äldre
 * work_order_checklist_resolve.
 *
 * Saknas lokal PostgreSQL hoppas testet över (redovisas i RESULT-raden) —
 * det är då INTE godkänt, bara inte kört.
 */
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };

function psql(db, sql, opts) {
  return execFileSync('psql', ['-d', db, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, opts || {})).trim();
}
function psqlFile(db, file) {
  return execFileSync('psql', ['-d', db, '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

try { psql('postgres', 'select 1'); } catch (e) {
  console.log('RESULT: 0 passed, 0 failed (HOPPAS ÖVER — ingen lokal PostgreSQL; INTE godkänt, inte kört)');
  process.exit(0);
}

const DB = 'vift_chk_' + process.pid;
psql('postgres', 'create database ' + DB);
const cleanup = () => { try { psql('postgres', 'drop database if exists ' + DB + ' with (force)'); } catch (e) {} };
process.on('exit', cleanup);

const MIG = path.join(__dirname, '..', 'supabase', 'migrations');
psql(DB, `do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create table public.store(key text primary key, value jsonb not null, updated_at timestamptz default now());`);
psqlFile(DB, path.join(MIG, '20260917000001_work_order_checklist_atomic_rpc.sql'));
psqlFile(DB, path.join(MIG, '20261123000002_work_order_checklist_progress.sql'));

const seed = [
  { id: 'AO-1', status: 'planerad', staff: ['ST-1'], updatedAt: 'x', checklist: [
    { id: 'c1', text: 'Stäng av vatten', done: false, avvikelse: null },
    { id: 'c2', text: 'Historisk utförd', done: true, avvikelse: 'ok' },
    { id: 'c3', text: 'Byt packning', done: false, avvikelse: null },
    { id: 'c4', text: 'Historik-tak', done: false, avvikelse: null },
  ] },
  { id: 'AO-2', status: 'nytt', staff: [], checklist: [{ id: 'd1', text: 'X', done: false, avvikelse: null }] },
];
psql(DB, `insert into store values ('vift_workOrders', '${JSON.stringify(seed).replace(/'/g, "''")}'::jsonb), ('vift_activityLog', '[]'::jsonb)`);
const actBefore = psql(DB, "select value::text from store where key='vift_activityLog'");

const q = (s) => s == null ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";
function call(action, itemId, who, o) {
  o = o || {};
  const sql = `select public.work_order_checklist_set_state(${q(o.ao || 'AO-1')}, ${q(itemId)}, ${q(action)}, ${q(o.text)}, ${q(o.desc)}, ${q(o.comment)}, ${q(o.image)}, ${q(who.name)}, ${q(who.id)}, ${who.viewAll ? 'true' : 'false'}, ${who.edit ? 'true' : 'false'})::text`;
  try { return { ok: true, r: JSON.parse(psql(DB, sql)) }; } catch (e) { return { ok: false, err: String(e.stderr || e.message) }; }
}
const legacy = (itemId, avv, who, comment) => {
  const sql = `select public.work_order_checklist_resolve('AO-1', ${q(itemId)}, ${q(avv)}, ${q(comment || '')}, ${q(who.name)}, ${who.viewAll ? 'true' : 'false'}, ${q(who.id)}, null)::text`;
  try { return { ok: true, r: JSON.parse(psql(DB, sql)) }; } catch (e) { return { ok: false, err: String(e.stderr || e.message) }; }
};
const ao = (id) => JSON.parse(psql(DB, `select (select e from jsonb_array_elements(value) e where e->>'id'=${q(id || 'AO-1')})::text from store where key='vift_workOrders'`));
const item = (id, aoId) => ao(aoId).checklist.find((c) => c.id === id);

const ANNA = { id: 'ST-1', name: 'Anna Fält', viewAll: false, edit: false };   // tilldelad, ao_checklist
const BO = { id: 'ST-2', name: 'Bo Fält', viewAll: true, edit: false };        // ser alla, ao_checklist
const LEDARE = { id: 'ST-9', name: 'Lea Ledare', viewAll: true, edit: true };  // ao_edit
const UTOM = { id: 'ST-3', name: 'Utan Tilldelning', viewAll: false, edit: false };

// 1. Påbörja — ingen autostart av AO:n
let r = call('start', 'c1', ANNA);
ok(r.ok && item('c1').startedById === 'ST-1' && item('c1').startedBy === 'Anna Fält' && /^\d{4}-\d\d-\d\dT/.test(item('c1').startedAt), 'Påbörja registrerar vem (namn + id) och när');
ok(ao().status === 'planerad', 'AO:ns status oförändrad efter Påbörja (ingen autostart)');
ok(item('c1').history.length === 1 && item('c1').history[0].a === 'start' && item('c1').history[0].from === 'ej_paborjad', 'historik: start från ej påbörjad');

// 2. Flera samtidigt pågående
r = call('start', 'c3', BO);
ok(r.ok && item('c1').startedAt && item('c3').startedAt, 'två punkter pågående samtidigt');

// 3. Påbörja igen av annan = idempotent, ursprunglig startare behålls
r = call('start', 'c1', BO);
ok(r.ok && r.r.noop === true && item('c1').startedById === 'ST-1' && item('c1').history.length === 1, 'Påbörja på redan pågående: ingen ändring (noop)');

// 4. Utförd av annan (framsteg) tillåts; startinfo bevaras
r = call('done', 'c1', BO);
ok(r.ok && item('c1').done === true && item('c1').avvikelse === 'ok' && item('c1').doneById === 'ST-2' && item('c1').startedById === 'ST-1', 'Utförd registrerar vem/när och behåller vem som påbörjade');
ok(ao().status === 'planerad', 'AO:ns status oförändrad efter Utförd');

// 5. Återställ annans åtgärd utan ao_edit → nekas på servern
r = call('reset', 'c1', ANNA);
ok(!r.ok && /forbidden_other/.test(r.err) && item('c1').done === true, 'Återställ annans utförda punkt utan ao_edit nekas; punkten orörd');
// 6. Egen åtgärd → tillåts
r = call('reset', 'c1', BO);
ok(r.ok && item('c1').done === false && !item('c1').startedAt && !item('c1').doneById && item('c1').avvikelse === null, 'Återställ egen åtgärd med ao_checklist: tillbaka till ej påbörjad');
ok(item('c1').history.map((h) => h.a).join(',') === 'start,done,reset', 'historiken behåller hela kedjan start → done → reset');

// 7. Äldre punkt utan uppgift om vem → kräver ao_edit
r = call('reset', 'c2', BO);
ok(!r.ok && /forbidden_other/.test(r.err) && item('c2').done === true, 'äldre utförd punkt utan doneById: återställning utan ao_edit nekas');
r = call('reset', 'c2', LEDARE);
ok(r.ok && item('c2').done === false, 'äldre punkt: ao_edit får återställa');

// 8. Avvikelse kräver kommentar; påbörja på avslutad punkt nekas
r = call('avvikelse', 'c3', BO, { comment: '' });
ok(!r.ok && /comment_required/.test(r.err), 'avvikelse utan kommentar nekas');
r = call('avvikelse', 'c3', BO, { comment: 'Läcker vid koppling' });
ok(r.ok && item('c3').avvikelse === 'avvikelse' && item('c3').avvikelseById === 'ST-2' && item('c3').startedById === 'ST-2', 'avvikelse med kommentar sparas med vem');
r = call('start', 'c3', BO);
ok(!r.ok && /already_resolved/.test(r.err), 'Påbörja på redan avslutad punkt nekas');
r = call('done', 'c3', ANNA);
ok(!r.ok && /forbidden_other/.test(r.err), 'skriva över annans avvikelse med Utförd kräver ao_edit');

// 9. Synlighet (samma regel som R1.2)
r = call('start', 'd1', UTOM, { ao: 'AO-2' });
ok(!r.ok && /forbidden/.test(r.err), 'ej tilldelad och ej pool: nekas');

// 10. Lägg till / ta bort (atomiskt, idempotent omsändning)
r = call('add', 'c9', ANNA, { text: 'Ny punkt', desc: 'Beskr' });
ok(r.ok && item('c9') && item('c9').text === 'Ny punkt' && item('c9').history[0].a === 'add', 'lägg till punkt');
r = call('add', 'c9', ANNA, { text: 'Ny punkt' });
ok(r.ok && r.r.noop === true && ao().checklist.filter((c) => c.id === 'c9').length === 1, 'omsändning av samma tillägg: ingen dubblett');
r = call('add', 'c9', ANNA, { text: 'Annan text' });
ok(!r.ok && /id_collision/.test(r.err), 'samma id med annan rubrik: id_collision');
r = call('remove', 'c3', ANNA);
ok(!r.ok && /forbidden_other/.test(r.err) && item('c3'), 'ta bort annans behandlade punkt utan ao_edit nekas');
r = call('remove', 'c9', ANNA);
ok(r.ok && !item('c9'), 'ta bort orörd punkt med ao_checklist');
r = call('remove', 'c9', ANNA);
ok(r.ok && r.r.noop === true, 'ta bort redan borttagen: noop');

// 11. Äldre RPC delegerar: ingen autostart, fail-closed för annans åtgärd
psql(DB, `update store set value = jsonb_set(value, '{1,status}', '"pool"') where key='vift_workOrders'`);
const aoBefore = ao('AO-2').status;
r = (() => { const sql = `select public.work_order_checklist_resolve('AO-2', 'd1', 'ok', '', 'Anna Fält', false, 'ST-1', null)::text`; try { return { ok: true, r: JSON.parse(psql(DB, sql)) }; } catch (e) { return { ok: false, err: String(e.stderr) }; } })();
ok(r.ok && item('d1', 'AO-2').done === true && ao('AO-2').status === aoBefore, 'äldre RPC (OK) på pool-AO: punkten utförd, AO:ns status oförändrad (autostart borttagen)');
ok(item('d1', 'AO-2').doneById === 'ST-1', 'äldre RPC registrerar också vem som utförde');
r = legacy('c3', null, LEDARE);
ok(!r.ok && /forbidden/.test(r.err) && item('c3').avvikelse === 'avvikelse', 'äldre RPC: återställning av annans åtgärd nekas (fail-closed tills ny EF)');
r = legacy('c1', 'v2:start', ANNA);
ok(!r.ok && /invalid_avvikelse/.test(r.err) && !item('c1').startedAt, 'spärren: v2-åtgärd mot äldre kontrakt avvisas utan ändring');

// 12. Historiken kapas vid 20
for (let i = 0; i < 12; i++) { call('start', 'c4', ANNA); call('reset', 'c4', ANNA); }
ok(item('c4').history.length === 20 && item('c4').history[19].a === 'reset', 'historiken behåller de 20 senaste händelserna');

// 13. Aktivitetsloggen rörs inte (WAL-kostnad), lastChanged uppdateras
ok(psql(DB, "select value::text from store where key='vift_activityLog'") === actBefore, 'aktivitetsloggen skrivs inte vid checklisthändelser');
ok(/^"\d{4}-/.test(psql(DB, "select value::text from store where key='vift_lastChanged'")), 'vift_lastChanged uppdateras (DataSync upptäcker ändringen)');

// 14. Samtidighet: två sessioner påbörjar OLIKA punkter samtidigt → båda finns kvar
call('reset', 'c1', LEDARE); call('reset', 'c4', LEDARE);
const slow = `begin; select public.work_order_checklist_set_state('AO-1','c1','start',null,null,null,null,'Anna Fält','ST-1',false,false); select pg_sleep(1.0); commit;`;
const fast = `select pg_sleep(0.3); select public.work_order_checklist_set_state('AO-1','c4','start',null,null,null,null,'Bo Fält','ST-2',true,false);`;
const run = (sql) => new Promise((res) => { const p = spawn('psql', ['-d', DB, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql]); p.on('close', res); });
Promise.all([run(slow), run(fast)]).then((codes) => {
  ok(codes.every((c) => c === 0) && item('c1').startedById === 'ST-1' && item('c4').startedById === 'ST-2', 'samtidiga Påbörja på olika punkter (radlås): ingen förlorad ändring');
  // Grants: bara service_role får köra RPC:n
  const g = psql(DB, `select string_agg(grantee, ',' order by grantee) from information_schema.routine_privileges where routine_name='work_order_checklist_set_state' and privilege_type='EXECUTE'`);
  ok(!/authenticated|anon/.test(g) && /service_role/.test(g), 'EXECUTE bara för service_role (' + g + ')');
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  cleanup();
  process.exit(fail ? 1 : 0);
});
