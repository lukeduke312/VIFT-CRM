'use strict';
/*
 * V3: delad presentationslogik — UiKit (avatarer, relativa datum, chips) och
 * WorkOrderService.isOverdue/nextStep. Körs i en vm-sandlåda med appens
 * riktiga källfiler (ingen webbläsare).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };

const ROOT = path.join(__dirname, '..');
const ctx = { console, Date, Math, JSON, crypto: undefined, window: {}, document: undefined };
ctx.state = { staff: [{ id: 'ST-1', firstName: 'Jonas', lastName: 'Pettersson' }, { id: 'ST-2', firstName: 'Eva', lastName: 'Ahl' }], workOrders: [] };
ctx.esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
ctx.ic = (n) => `<svg data-i="${n}"></svg>`;
ctx.getStaff = (id) => ctx.state.staff.find((s) => s.id === id) || null;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/components/UiKit.js'), 'utf8') + '\nthis.UiKit = UiKit;', ctx);
const UiKit = ctx.UiKit;

// ── dayLabel ────────────────────────────────────────────────────────
const T = '2026-11-25'; // onsdag
ok(UiKit.dayLabel('2026-11-25', T) === 'Idag', 'idag');
ok(UiKit.dayLabel('2026-11-26', T) === 'Imorgon', 'imorgon');
ok(UiKit.dayLabel('2026-11-24', T) === 'Igår', 'igår');
ok(UiKit.dayLabel('2026-11-28', T) === 'lör 28 nov', 'inom en vecka: veckodag + datum (' + UiKit.dayLabel('2026-11-28', T) + ')');
ok(UiKit.dayLabel('2026-11-19', T) === 'tor 19 nov', 'sex dagar bakåt: veckodag');
ok(UiKit.dayLabel('2026-11-18', T) === '18 nov', 'sju dagar bakåt: bara datum');
ok(UiKit.dayLabel('2026-12-20', T) === '20 dec', 'längre fram: datum utan år');
ok(UiKit.dayLabel('2027-03-03', T) === '3 mar 2027', 'annat år: år med');
ok(UiKit.dayLabel('2026-12-01', '2026-11-30') === 'Imorgon', 'över månadsskifte');
ok(UiKit.dayLabel('', T) === '' && UiKit.dayLabel('nonsens', T) === '', 'tomt/ogiltigt → tom sträng');
// localDate är lokal tid, inte UTC (00:30 lokal tid ska vara samma dag)
const lateNight = new Date(2026, 10, 25, 0, 30);
ok(UiKit.localDate(lateNight) === '2026-11-25', 'localDate använder lokal tid');

// ── avatarer ────────────────────────────────────────────────────────
const a = UiKit.avatarStack(['ST-1', 'ST-2']);
ok(/>JP</.test(a) && />EA</.test(a), 'avatarstapel visar initialer');
ok(/aria-label="Jonas Pettersson, Eva Ahl"/.test(a), 'avatarstapel har tillgängligt namn');
ok(/av-none/.test(UiKit.avatarStack([])), 'ingen personal → streckad ring');
ok(/\+2</.test(UiKit.avatarStack(['ST-1', 'ST-2', 'ST-1', 'ST-2', 'ST-1'], 3)), 'fler än max → +N');
ok(UiKit.avatar({ id: 'ST-1', firstName: 'A', lastName: 'B' }) === UiKit.avatar({ id: 'ST-1', firstName: 'A', lastName: 'B' }), 'stabil färg per person');
ok(/<script/.test(UiKit.avatar({ id: 'x', firstName: '<script>', lastName: '' })) === false, 'namn escapas');

// ── chip ────────────────────────────────────────────────────────────
const c = UiKit.chip('Idag', "X.toggle('idag')", { on: true, n: 3, icon: 'calendar' });
ok(/class="chip on"/.test(c) && /aria-pressed="true"/.test(c) && /chip-n">3</.test(c), 'chip: aktiv, aria-pressed och antal');

// ── WorkOrderService.isOverdue / nextStep ───────────────────────────
const src = fs.readFileSync(path.join(ROOT, 'src/services/WorkOrderService.js'), 'utf8');
const start = src.indexOf('  isAlive(ao) {');
const end = src.indexOf('  checklistOwnerId(c) {');
const methods = src.slice(start, end);
vm.runInContext('this.W = {' + methods + '};', ctx);
ctx.tdy = () => T;
const W = ctx.W;
const ao = (o) => Object.assign({ id: 'AO-1', status: 'planerad', staff: ['ST-1'], scheduledDate: '2026-11-20', checklist: [] }, o);
ok(W.isOverdue(ao({}), T) === true, 'planerad med passerat datum är försenad');
ok(W.isOverdue(ao({ status: 'klar' }), T) === false, 'klar med passerat datum är INTE försenad (tidigare fel i AO-listans snabbfilter)');
ok(W.isOverdue(ao({ status: 'fakturerad' }), T) === false && W.isOverdue(ao({ status: 'avbruten' }), T) === false, 'fakturerad/avbruten är inte försenade');
ok(W.isOverdue(ao({ status: 'pool' }), T) === false, 'pool räknas inte som försenad (samma som dashboard)');
ok(W.isOverdue(ao({ archived: true }), T) === false && W.isOverdue(ao({ deleted: true }), T) === false, 'arkiverad/borttagen är inte försenad');
ok(W.isOverdue(ao({ scheduledDate: T }), T) === false, 'idag är inte försenad');

ok(W.nextStep(ao({ priority: 'akut', staff: [] }), T).tone === 'danger', 'akut utan personal → röd uppmaning');
ok(W.nextStep(ao({ staff: [] }), T).action === 'assign', 'ingen personal → tilldela');
ok(W.nextStep(ao({ scheduledDate: '' }), T).action === 'plan', 'ej planerad → planera');
ok(/Försenad/.test(W.nextStep(ao({}), T).text), 'försenad → säger det');
ok(W.nextStep(ao({ status: 'klar' }), T).action === 'invoice', 'klar utan underlag → skapa fakturaunderlag');
ok(W.nextStep(ao({ status: 'klar', invoiceId: 'INV-1' }), T).tone === 'ok', 'klar med underlag → klart');
ok(W.nextStep(ao({ status: 'pågående', checklist: [{ done: true }, { avvikelse: 'ok' }] }), T).action === 'complete', 'pågående med klar checklista → markera klar');
ok(/1 av 2/.test(W.nextStep(ao({ status: 'pågående', checklist: [{ done: true }, {}] }), T).text), 'pågående → visar checklistans framsteg');
ok(W.nextStep(ao({ scheduledDate: T }), T).action === 'start', 'planerad idag → starta');
ok(/Pågår/.test(W.nextStep(ao({ status: 'pågående' }), T).text), 'pågående med passerat datum → pågår, inte försenad');
ok(W.nextStep(ao({ status: 'pool', staff: [] }), T).action === 'take', 'pool → väntar på att någon tar uppdraget');

console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
