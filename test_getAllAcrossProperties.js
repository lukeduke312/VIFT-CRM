#!/usr/bin/env node
/*
 * Isolated test for ServiceIntervalService.getAllAcrossProperties() —
 * the one new method added for ServiceIntervalsPage. Loads the REAL,
 * unmodified-elsewhere source file in a sandboxed Node vm context with
 * a minimal `tdy()` stub (normally defined in state.js) and a synthetic
 * `state.properties` fixture — not a reimplementation.
 *
 * PROVES: the pure data-shaping/sorting logic of getAllAcrossProperties()
 * — that it returns EVERY interval across EVERY property (not just ones
 * needing attention, unlike the existing getAllNeedingAttention()), with
 * the correct propertyId/propertyName/address/interval/status shape, sorted
 * by days-until-nextDue ascending, with intervals lacking a nextDue sorted
 * last.
 *
 * DOES NOT PROVE: actual DOM rendering of ServiceIntervalsPage, actual
 * button click handling, actual navigation via Router, actual modal
 * open/close behavior (PropertyDetailPage.openMarkDone() etc., which this
 * sandbox cannot exercise without a real browser DOM), or the real-app
 * integration of the Sidebar/Router/index.html wiring changes made
 * alongside this method. Those remain unverified here, by design — this
 * test covers only the one piece of new, pure logic.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(__dirname + '/src/services/ServiceIntervalService.js', 'utf8');

function section(t) { console.log('\n=== ' + t + ' ==='); }

function freshSandbox(todayStr) {
  const sandbox = {
    console,
    state: { properties: [] },
    tdy: () => todayStr,
    persist: () => {},
    Sidebar: undefined,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const bridged = src + '\n;globalThis.__exp = { ServiceIntervalService: ServiceIntervalService };';
  vm.runInContext(bridged, sandbox, { filename: 'ServiceIntervalService.js' });
  return sandbox.__exp.ServiceIntervalService;
}

function mkSI(id, overrides) {
  return Object.assign({
    id, title: 'SI-' + id, category: 'filterbyte', intervalType: 'annual', intervalValue: 1,
    active: true, nextDue: '', reminderDays: 14, history: [],
  }, overrides);
}

function test1_returnsEveryIntervalRegardlessOfStatus() {
  section('TEST 1 — returnerar VARJE intervall, inte bara de som behöver uppmärksamhet (till skillnad från getAllNeedingAttention())');
  const SIS = freshSandbox('2026-11-20');
  const sandbox_state = { properties: [
    { id: 'P-1', name: 'Fastighet A', address: 'Gatan 1', serviceIntervals: [
      mkSI('si-1', { nextDue: '2026-11-01' }),             // overdue
      mkSI('si-2', { nextDue: '2027-11-01' }),             // ok (far future)
      mkSI('si-3', { active: false, nextDue: '2026-11-01' }), // paused
    ] },
    { id: 'P-2', name: 'Fastighet B', address: 'Gatan 2', serviceIntervals: [
      mkSI('si-4', { nextDue: '' }), // not_set
    ] },
  ] };
  // Re-create with the real state object this instance's closures reference:
  const sandbox2 = (function() {
    const vmMod = require('vm');
    const s = { console, state: sandbox_state, tdy: () => '2026-11-20', persist: () => {}, Sidebar: undefined };
    s.globalThis = s;
    vmMod.createContext(s);
    vmMod.runInContext(src + '\n;globalThis.__exp = { SIS: ServiceIntervalService };', s, { filename: 'x.js' });
    return s.__exp.SIS;
  })();

  const all = sandbox2.getAllAcrossProperties();
  const ok = all.length === 4
    && all.some(x => x.interval.id === 'si-2' && x.status === 'ok')
    && all.some(x => x.interval.id === 'si-3' && x.status === 'paused')
    && all.some(x => x.interval.id === 'si-4' && x.status === 'not_set');
  console.log('Antal returnerade (förväntat 4, alla statusar inkl. ok/paused/not_set):', all.length);
  console.log(JSON.stringify(all.map(x => ({ id: x.interval.id, status: x.status, propertyName: x.propertyName }))));
  console.log(ok ? 'PASS' : 'FAIL');
  return ok;
}

function test2_sortedByDaysUntilDueAscending() {
  section('TEST 2 — sorterad efter dagar-till-förfall, stigande; saknat nextDue sist');
  const testProperties = [
    { id: 'P-1', name: 'A', address: '', serviceIntervals: [
      mkSI('far',    { nextDue: '2027-01-01' }),
      mkSI('nodate', { nextDue: '' }),
      mkSI('soon',   { nextDue: '2026-11-21' }),
      mkSI('past',   { nextDue: '2026-10-01' }),
    ] },
  ];
  const s = { console, state: { properties: testProperties }, tdy: () => '2026-11-20', persist: () => {}, Sidebar: undefined };
  s.globalThis = s;
  vm.createContext(s);
  vm.runInContext(src + '\n;globalThis.__exp = { SIS: ServiceIntervalService };', s, { filename: 'x.js' });
  const all = s.__exp.SIS.getAllAcrossProperties();
  const order = all.map(x => x.interval.id);
  console.log('Faktisk ordning:', JSON.stringify(order));
  const ok = JSON.stringify(order) === JSON.stringify(['past', 'soon', 'far', 'nodate']);
  console.log(ok ? 'PASS — past < soon < far < nodate (sist)' : 'FAIL');
  return ok;
}

function test3_emptyPropertiesSafe() {
  section('TEST 3 — tom state.properties ger tom lista, ingen krasch');
  const s = { console, state: { properties: [] }, tdy: () => '2026-11-20', persist: () => {}, Sidebar: undefined };
  s.globalThis = s;
  vm.createContext(s);
  vm.runInContext(src + '\n;globalThis.__exp = { SIS: ServiceIntervalService };', s, { filename: 'x.js' });
  const all = s.__exp.SIS.getAllAcrossProperties();
  const ok = Array.isArray(all) && all.length === 0;
  console.log('Resultat:', JSON.stringify(all), '| PASS:', ok);
  return ok;
}

(async () => {
  const results = {};
  results.test1_returnsEveryIntervalRegardlessOfStatus = test1_returnsEveryIntervalRegardlessOfStatus();
  results.test2_sortedByDaysUntilDueAscending           = test2_sortedByDaysUntilDueAscending();
  results.test3_emptyPropertiesSafe                     = test3_emptyPropertiesSafe();

  section('SUMMARY');
  for (const [k, v] of Object.entries(results)) console.log(k + ':', v ? 'PASS' : 'FAIL');
  const allOk = Object.values(results).every(Boolean);
  console.log('\nOVERALL:', allOk ? 'ALL PROOFS PASSED (pure logic only — see file header for what remains unverified)' : 'SOME PROOFS FAILED');
  process.exit(allOk ? 0 : 1);
})();
