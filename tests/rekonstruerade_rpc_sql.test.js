'use strict';
/*
 * SQL-integrationstest mot riktig lokal PostgreSQL för de funktioner och policyer som
 * rekonstruerades 2026-11-27 ur STAGING-schemat (G1/G4 del 2):
 *   20261024000001_rekonstruerad_faktura_revisionskontroll.sql
 *   20261127000001_rekonstruerad_store_skyddstrigger.sql
 *   20261127000002_rekonstruerad_time_entry_rpc.sql
 *   20261127000003_rekonstruerad_store_restrictive_policyer.sql
 *   20261127000004_rekonstruerad_grants_och_store_policy.sql
 * Databasen byggs med HELA kedjan i supabase/MIGRATIONSORDNING.txt ovanpå
 * tests/local/supabase-stubbar.sql. Inte STAGING, inte LIVE.
 * Saknas lokal PostgreSQL hoppas testet över (redovisas, inte godkänt).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m + (d ? '\n        ' + String(d).slice(0, 300) : '')); } };
const psql = (db, sql) => execFileSync('psql', ['-d', db, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try { psql('postgres', 'select 1'); } catch (e) { console.log('RESULT: 0 passed, 0 failed (HOPPAS ÖVER — ingen lokal PostgreSQL; INTE godkänt, inte kört)'); process.exit(0); }

const ROOT = path.join(__dirname, '..');
const DB = 'vift_rekon_' + process.pid;
psql('postgres', 'create database ' + DB);
process.on('exit', () => { try { psql('postgres', 'drop database if exists ' + DB + ' with (force)'); } catch (e) { /* ignore */ } });
execFileSync('psql', ['-d', DB, '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', path.join(ROOT, 'tests/local/supabase-stubbar.sql')], { stdio: ['ignore', 'pipe', 'pipe'] });
psql('postgres', `alter database ${DB} set search_path = "$user", public, extensions`);
const order = fs.readFileSync(path.join(ROOT, 'supabase/MIGRATIONSORDNING.txt'), 'utf8').split('\n')
  .filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.trim().split(/\s+/)[1]);
for (const rel of order) execFileSync('psql', ['-d', DB, '-qAt', '-v', 'ON_ERROR_STOP=1', '-f', path.join(ROOT, 'supabase', rel)], { stdio: ['ignore', 'pipe', 'pipe'] });
ok(true, `hela kedjan (${order.length} filer) kördes utan fel`);

const q = (s) => s == null ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";
const j = (o) => q(JSON.stringify(o)) + '::jsonb';
const run = (sql) => { try { return { ok: true, r: JSON.parse(psql(DB, sql) || 'null') }; } catch (e) { return { ok: false, err: String(e.stderr || e.message) }; } };
const val = (k) => JSON.parse(psql(DB, `select value::text from store where key=${q(k)}`) || 'null');
const setv = (k, v) => psql(DB, `insert into store(key, value) values (${q(k)}, ${j(v)}) on conflict (key) do update set value = excluded.value`);

// ── Fakturor: revisionskontroll (20261024000001) och A3a-versionen av set_status ──
setv('vift_workOrders', []);
let r = run(`select invoice_append_checked(${j({ customerId: 'K-1', lines: [] })}, 'idem-1')::text`);
ok(!r.ok && /legacy_idempotency_key_retired/.test(r.err), 'invoice_append_checked avvisar nyckel utan prefixet vift-v2: (N2)');
r = run(`select invoice_append_checked(${j({ customerId: 'K-1', lines: [{ id: 'L1', description: 'Arbete', qty: 2, unitPrice: 100, vatRate: 25 }] })}, 'vift-v2:7f1c0b9e-0000-4000-8000-000000000001')::text`);
ok(r.ok && r.r.invoice.revision === 1 && r.r.invoice.status === 'utkast', 'invoice_append_checked skapar utkast med revision 1', r.err);
const INV = r.ok ? r.r.invoice.id : 'F-001';
r = run(`select invoice_line_add(${q(INV)}, ${j({ id: 'L2', description: 'Material', qty: 1, unitPrice: 50, vatRate: 25 })}, 1)::text`);
ok(r.ok && r.r.invoice.revision === 2 && r.r.invoice.lines.length === 2, 'invoice_line_add med rätt revision lägger till raden och höjer revisionen', r.err);
r = run(`select invoice_line_add(${q(INV)}, ${j({ id: 'L3', qty: 1, unitPrice: 1 })}, 1)::text`);
ok(!r.ok && /stale_write/.test(r.err) && val('vift_invoices')[0].lines.length === 2, 'invoice_line_add med gammal revision: stale_write, ingen ändring');
r = run(`select invoice_line_add(${q(INV)}, ${j({ id: 'L2', qty: 1, unitPrice: 1 })}, 2)::text`);
ok(!r.ok && /duplicate_line_id/.test(r.err), 'invoice_line_add med befintligt rad-id: duplicate_line_id');
r = run(`select invoice_line_add(${q(INV)}, ${j({ id: 'L4', qty: -1, unitPrice: 1 })}, 2)::text`);
ok(!r.ok && /invalid_qty/.test(r.err), 'invoice_line_add med negativt antal: invalid_qty');
r = run(`select invoice_line_add(${q(INV)}, ${j({ id: 'L5', qty: 1, unitPrice: 1 })}, null)::text`);
ok(!r.ok && /stale_write/.test(r.err), 'saknad revision (NULL) avvisas fail-closed');
r = run(`select invoice_line_update(${q(INV)}, 'L2', ${j({ qty: 3 })}, 2)::text`);
ok(r.ok && r.r.invoice.lines.find((l) => l.id === 'L2').qty === 3 && r.r.invoice.revision === 3, 'invoice_line_update ändrar raden', r.err);
r = run(`select invoice_line_update(${q(INV)}, 'L2', ${j({ id: 'X' })}, 3)::text`);
ok(!r.ok && /forbidden_field/.test(r.err), 'invoice_line_update får inte ändra rad-id: forbidden_field', r.err);
const rev = () => val('vift_invoices')[0].revision;
r = run(`select invoice_line_delete(${q(INV)}, 'NOPE', 3)::text`);
ok(r.ok && r.r.invoice.lines.length === 2 && r.r.invoice.revision === 4, 'invoice_line_delete på okänd rad: inga rader tas bort (idempotent), revisionen höjs', r.err);
r = run(`select invoice_line_delete(${q(INV)}, 'L2', ${rev()})::text`);
ok(r.ok && r.r.invoice.lines.length === 1 && r.r.invoice.revision === 5, 'invoice_line_delete tar bort raden', r.err);
r = run(`select invoice_discount_set(${q(INV)}, ${j({ type: 'fixed', value: 10.005 })}, ${rev()})::text`);
ok(!r.ok && /invalid_discount_value/.test(r.err), 'invoice_discount_set med tre decimaler: invalid_discount_value', r.err);
r = run(`select invoice_discount_set(${q(INV)}, ${j({ type: 'percent', value: 10 })}, ${rev()})::text`);
ok(r.ok && r.r.invoice.discount.value === 10 && r.r.invoice.revision === 6, 'invoice_discount_set sparar rabatten', r.err);
r = run(`select invoice_tax_reduction_set(${q(INV)}, ${j({ type: 'okand' })}, ${rev()})::text`);
ok(!r.ok && /invalid_tax_type/.test(r.err), 'invoice_tax_reduction_set med okänd typ: invalid_tax_type', r.err);
r = run(`select invoice_meta_update(${q(INV)}, ${j({ status: 'betald', revision: 99, note: 'Intern anteckning' })}, ${rev()})::text`);
ok(r.ok && r.r.invoice.status === 'utkast' && r.r.invoice.revision === 7 && r.r.invoice.note === 'Intern anteckning',
  'invoice_meta_update sparar bara vitlistade fält (note); status och revision i patchen ignoreras', r.err);
r = run(`select invoice_set_status(${q(INV)}, 'skickad', ${rev()}, 'ST-1')::text`);
ok(r.ok && r.r.invoice.status === 'skickad', 'invoice_set_status (A3a-version) utkast → skickad', r.err);
r = run(`select invoice_set_status(${q(INV)}, 'utkast', ${rev()}, 'ST-1')::text`);
ok(!r.ok && /invalid_transition/.test(r.err), 'invoice_set_status skickad → utkast: invalid_transition', r.err);
const calc = run(`select _invoice_calc_financial(${j({ lines: [{ qty: 2, unitPrice: 100, vatRate: 25 }] })})::text`);
ok(calc.ok && calc.r && typeof calc.r === 'object', '_invoice_calc_financial returnerar en beräkning', calc.err);

// ── Skyddstriggern (20261127000001) ──
r = run(`set role service_role; update store set value = '[]'::jsonb where key = 'vift_workOrders' returning 1;`);
ok(!r.ok && /direct_write_blocked/.test(r.err), 'service_role kan inte skriva vift_workOrders direkt (trigger)', r.err);
r = run(`set role service_role; insert into store(key, value) values ('vift_customers', '[]'::jsonb) on conflict (key) do update set value = excluded.value returning 1;`);
ok(r.ok, 'service_role kan skriva en oskyddad nyckel', r.err);
r = run(`update store set value = '[]'::jsonb where key = 'vift_workOrders' returning 1;`);
ok(r.ok, 'postgres (migrationer/RPC-ägare) kan skriva vift_workOrders');

// ── time_entry_* (20261127000002) ──
setv('vift_staff', [{ id: 'ST-1', firstName: 'A' }, { id: 'ST-2', firstName: 'B' }]);
setv('vift_workOrders', [{ id: 'AO-1', status: 'planerad', staff: ['ST-1'] }]);
r = run(`select time_entry_create(${j({ staffId: 'ST-1', aoId: 'AO-1', hours: 2, attested: true })}, 'te-1', 'TE-1')::text`);
ok(r.ok && r.r.timeEntry.id === 'TE-1' && r.r.timeEntry.attested === undefined, 'time_entry_create skapar posten och tar bort klientens attest-fält', r.err);
ok((val('vift_workOrders')[0].timeEntries || []).includes('TE-1'), 'time_entry_create kopplar posten till AO:n');
r = run(`select time_entry_create(${j({ staffId: 'ST-1', hours: 9 })}, 'te-1', 'TE-1')::text`);
ok(r.ok && r.r.timeEntry.hours === 2 && val('vift_timeEntries').length === 1, 'samma idempotensnyckel: samma resultat, ingen dubblett', r.err);
r = run(`select time_entry_create(${j({ staffId: 'ST-1' })}, 'te-2', 'TE-1')::text`);
ok(!r.ok && /id_collision/.test(r.err), 'nytt anrop med befintligt id: id_collision');
r = run(`select time_entry_patch('TE-1', ${j({ hours: 3 })}, 'tp-1', null, 'ST-2', false)::text`);
ok(!r.ok && /forbidden/.test(r.err) && val('vift_timeEntries')[0].hours === 2, 'time_entry_patch på annans post utan behörighet: forbidden, ingen ändring', r.err);
r = run(`select time_entry_patch('TE-1', ${j({ hours: 3 })}, 'tp-2', null, 'ST-1', false)::text`);
ok(r.ok && val('vift_timeEntries')[0].hours === 3, 'time_entry_patch på egen post', r.err);
r = run(`select time_entry_set_attested('TE-1', true, 'ta-1', 'ST-2', false)::text`);
ok(!r.ok && /forbidden/.test(r.err), 'time_entry_set_attested utan attestbehörighet: forbidden', r.err);
r = run(`select time_entry_set_attested('TE-1', true, 'ta-2', 'ST-9', true)::text`);
ok(!r.ok && /forbidden/.test(r.err), 'time_entry_set_attested med okänd anropare: forbidden', r.err);
r = run(`select time_entry_set_attested('TE-1', true, 'ta-3', 'ST-2', true)::text`);
ok(r.ok && val('vift_timeEntries')[0].attested === true && val('vift_timeEntries')[0].attestedBy === 'ST-2', 'time_entry_set_attested sätter attest med serverns aktör', r.err);
r = run(`select time_entry_set_attested('TE-1', false, 'ta-3', 'ST-2', true)::text`);
ok(!r.ok && /idempotency_key_conflict/.test(r.err), 'samma attestnyckel med andra parametrar: idempotency_key_conflict', r.err);
r = run(`select time_entry_patch('TE-1', ${j({ hours: 5 })}, 'tp-3', null, 'ST-1', false)::text`);
ok(!r.ok && /attested_locked/.test(r.err) && val('vift_timeEntries')[0].hours === 3, 'attesterad post kan inte ändras: attested_locked', r.err);
r = run(`select time_entry_soft_delete('TE-1', 'td-1', 'ST-1', false)::text`);
ok(!r.ok && /attested_locked/.test(r.err), 'attesterad post kan inte tas bort: attested_locked', r.err);

// ── RESTRICTIVE-policyer (20261127000003) och grants (20261127000004) ──
psql(DB, `insert into auth.users(id, email) values ('00000000-0000-0000-0000-000000000001', 'a@exempel.invalid') on conflict do nothing;
  insert into app_users(user_id, active) values ('00000000-0000-0000-0000-000000000001', true) on conflict do nothing;`);
const asUser = (sql) => run(`begin; set local role authenticated; set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; ${sql}; commit;`);
r = asUser(`select count(*) from store where key in ('vift_workOrders','vift_timeEntries')`);
ok(r.ok && Number(r.r) === 0, 'authenticated kan inte läsa vift_workOrders/vift_timeEntries direkt', r.err);
r = asUser(`update store set value = '[]'::jsonb where key = 'vift_invoices'`);
ok(r.ok && (val('vift_invoices') || []).length === 1, 'authenticated kan inte skriva vift_invoices direkt (0 rader)', r.err);
r = asUser(`insert into store(key, value) values ('vift_offerEvents', '[]'::jsonb)`);
ok(!r.ok && /row-level security|policy/.test(r.err), 'authenticated kan inte skriva vift_offerEvents (store_active_write_safe)', r.err);
for (const fn of ['provision_vift_user(uuid, text, text, boolean)', 'deactivate_vift_user(uuid)', 'check_app_users_health()']) {
  const g = psql(DB, `select has_function_privilege('anon', 'public.${fn}', 'execute')::text || ',' || has_function_privilege('authenticated', 'public.${fn}', 'execute')::text || ',' || has_function_privilege('service_role', 'public.${fn}', 'execute')::text`);
  ok(g === 'false,false,true', `${fn}: bara service_role har EXECUTE`, g);
}

console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
