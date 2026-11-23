'use strict';
/*
 * Enhetstest av de RIKTIGA TypeScript-modulerna i store-key-write:
 *  - activities-policy.ts (TASK-01: per-post-regel för vift_activities)
 *  - activity-log.ts (appendActivity: servern bygger posten)
 * Källan transpileras med tsc till en temporär katalog och körs i Node.
 * Samma falltabell används av den simulerade servern (fake-backend), som
 * importerar den transpilerade policyn — så E2E och enhetstest prövar
 * samma regel.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vift-policy-'));
const SRC = path.join(__dirname, '..', 'supabase', 'functions', 'store-key-write');
try {
  execFileSync('tsc', ['--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--strict', '--skipLibCheck', path.join(SRC, 'activities-policy.ts'), path.join(SRC, 'activity-log.ts')], { stdio: 'pipe' });
} catch (e) { console.log('FAIL tsc: ' + String(e.stdout || e.message)); console.log('RESULT: 0 passed, 1 failed'); process.exit(1); }
const P = require(path.join(out, 'activities-policy.js'));
const A = require(path.join(out, 'activity-log.js'));

const FALT = ['ao_view_own', 'ao_time', 'ao_checklist'];
const CHEF = ['ao_view_all', 'ao_edit', 'staff_view'];
const ADMIN = ['all'];
const task = (o) => Object.assign({ id: 'ACT-1', type: 'task', title: 'Byt filter', assignedTo: 'ST-4', createdBy: 'ST-1', createdAt: '2026-11-20T08:00:00Z', status: 'open', completedAt: null, completedBy: null, dueDate: '2026-11-25' }, o);
const up = (prev, data) => [{ id: (data || prev).id, previous: prev, data }];
const allow = (u, r, perms, me) => P.activitiesWriteAllowed(u, r || [], perms, me);

// Fältarbetare = ansvarig, inte skapare
const t = task();
ok(allow(up(t, task({ status: 'done', completedAt: 'x', completedBy: 'ST-4' })), [], FALT, 'ST-4').ok, 'ansvarig fältarbetare klarmarkerar egen tilldelad uppgift');
ok(allow(up(task({ status: 'done', completedAt: 'x', completedBy: 'ST-4' }), task()), [], FALT, 'ST-4').ok, 'ansvarig öppnar uppgiften igen');
ok(allow(up(t, task({ dueDate: '2026-11-27', status: 'open' })), [], FALT, 'ST-4').ok, 'ansvarig flyttar datum');
ok(!allow(up(t, task({ title: 'Annat' })), [], FALT, 'ST-4').ok, 'ansvarig får inte ändra rubrik');
ok(!allow(up(t, task({ assignedTo: 'ST-2' })), [], FALT, 'ST-4').ok, 'ansvarig får inte flytta uppgiften till någon annan');
ok(!allow(up(t, task({ status: 'done', completedBy: 'ST-2' })), [], FALT, 'ST-4').ok, 'completedBy får inte vara någon annan');
ok(!allow(up(t, task({ status: 'done' })), [], FALT, 'ST-2').ok, 'annan fältarbetare får inte klarmarka annans uppgift');
ok(!allow([], [{ id: 'ACT-1', previous: t }], FALT, 'ST-4').ok, 'ansvarig får inte radera uppgift som någon annan skapat');
// Egen uppgift
const own = task({ id: 'ACT-2', createdBy: 'ST-4', assignedTo: 'ST-4' });
ok(allow([{ id: 'ACT-2', previous: null, data: own }], [], FALT, 'ST-4').ok, 'fältarbetare skapar egen uppgift');
ok(!allow([{ id: 'ACT-3', previous: null, data: task({ id: 'ACT-3', createdBy: 'ST-4', assignedTo: 'ST-2' }) }], [], FALT, 'ST-4').ok, 'fältarbetare får inte skapa uppgift åt annan');
ok(!allow([{ id: 'ACT-3', previous: null, data: task({ id: 'ACT-3', createdBy: 'ST-1', assignedTo: 'ST-4' }) }], [], FALT, 'ST-4').ok, 'fältarbetare får inte förfalska createdBy');
ok(allow(up(own, Object.assign({}, own, { title: 'Nytt' })), [], FALT, 'ST-4').ok, 'skapare ändrar egen uppgift');
ok(!allow(up(own, Object.assign({}, own, { createdBy: 'ST-1' })), [], FALT, 'ST-4').ok, 'createdBy kan inte ändras');
ok(allow([], [{ id: 'ACT-2', previous: own }], FALT, 'ST-4').ok, 'egen uppgift får raderas');
ok(!allow([{ id: 'X', previous: null, data: Object.assign({}, own, { id: 'Y' }) }], [], FALT, 'ST-4').ok, 'id i data måste matcha');
// Blandat anrop: en otillåten post nekar hela anropet
ok(!allow(up(t, task({ status: 'done', completedBy: 'ST-4' })).concat(up(task({ id: 'ACT-9', assignedTo: 'ST-2' }), task({ id: 'ACT-9', assignedTo: 'ST-2', status: 'done' }))), [], FALT, 'ST-4').ok, 'en otillåten post nekar hela anropet');
// Fullständig åtkomst
ok(allow(up(t, task({ assignedTo: 'ST-2', title: 'X' })), [], CHEF, 'ST-3').ok, 'arbetsledare (ao_edit + ao_view_all) får ändra/fördela');
ok(allow([], [{ id: 'ACT-1', previous: t }], ADMIN, 'ST-1').ok, 'admin får radera');
ok(!allow(up(t, task({ title: 'X' })), [], ['ao_edit'], 'ST-3').ok, 'ao_edit utan ao_view_all räcker inte');
ok(!allow(up(t, task({ status: 'done' })), [], FALT, '').ok, 'utan identitet: nekas');

// activity-log.ts
const now = '2026-11-24T10:00:00.000Z';
let b = A.buildActivityEntry({ id: 'ACT-1795000000000-abcd1234', type: 'work_order_updated', description: 'x', userId: 'ST-1', timestamp: '1999-01-01', workOrderId: 'AO-1' }, 'ST-4', now);
ok(b.ok && b.entry.userId === 'ST-4' && b.entry.timestamp === now && b.entry.serverVerified === true, 'servern sätter userId och tid (klientens värden ignoreras)');
ok(b.ok && b.entry.workOrderId === 'AO-1' && b.entry.customerId === '', 'referensfält behålls/normaliseras');
ok(!A.buildActivityEntry({ id: 'ACT-1795000000000-abcd', type: 'godtycklig_typ' }, 'ST-4', now).ok, 'okänd händelsetyp nekas');
ok(!A.buildActivityEntry({ id: 'x', type: 'note' }, 'ST-4', now).ok, 'ogiltigt id nekas');
ok(!A.buildActivityEntry({ id: 'ACT-1795000000000-abcd', type: 'note' }, '', now).ok, 'utan identitet nekas');
ok(A.buildActivityEntry({ id: 'ACT-1795000000000-abcd', type: 'note', description: 'a'.repeat(2000) }, 'ST-4', now).entry.description.length === 500, 'beskrivning kapas till 500 tecken');

fs.rmSync(out, { recursive: true, force: true });
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
