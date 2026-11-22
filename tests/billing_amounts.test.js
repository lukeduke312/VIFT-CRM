#!/usr/bin/env node
/*
 * Fakturabelopp — kör riktiga src/services/InvoiceService.js och
 * BillingQueueService.js i vm (endast globala uppslag stubbas).
 * Täcker: moms 25/12/0 per rad, öresavrundning, rabatt % och fast (tak),
 * ROT/RUT större än totalen nekas, NaN/negativa värden nekas, tidpost →
 * fakturaunderlag (minuter/timmar, timpris saknas, prismodell), dubbel-
 * fakturering (claimad källa), väntande serverbekräftelse ej valbar, och
 * att köns belopp är exakt det som faktureras.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, section, done } = require('./lib/harness');

const ROOT = path.join(__dirname, '..');
const SRC = ['src/services/InvoiceService.js', 'src/services/BillingQueueService.js']
  .map((p) => fs.readFileSync(path.join(ROOT, p), 'utf8')).join('\n;\n');

function load(st, opts) {
  opts = opts || {};
  const sb = {
    console: { log() {}, warn() {}, error() {} }, JSON, Date, Math, Promise, Set, Object, Array, Number, String,
    state: Object.assign({ workOrders: [], timeEntries: [], invoices: [], customers: [{ id: 'C1', name: 'Kund AB' }], properties: [] }, st),
    persist: () => Promise.resolve(true),
    CustomerService: { displayName: (c) => c.name },
    Auth: { can: () => true },
    AOTimeSyncService: { isUnsynced: (t, id) => (opts.pending || []).includes(t + ':' + id) },
    crypto: { randomUUID: () => 'u-' + Math.random().toString(36).slice(2) },
  };
  sb.getAO = (id) => sb.state.workOrders.find((a) => a.id === id) || null;
  sb.getCu = (id) => sb.state.customers.find((c) => c.id === id) || null;
  sb.getObj = () => null;
  vm.createContext(sb);
  vm.runInContext(SRC + '\n;globalThis.__I = InvoiceService; globalThis.__B = BillingQueueService;', sb);
  return { I: sb.__I, B: sb.__B, sb };
}

section('InvoiceService.calcSummary — moms, avrundning, rabatt');
{
  const { I } = load({});
  const s = I.calcSummary({ lines: [
    { qty: 1, unitPrice: 1000, vatRate: 25 },
    { qty: 2, unitPrice: 333.33, vatRate: 12 },
    { qty: 1, unitPrice: 500, vatRate: 0 },
  ] });
  check('exkl. moms = 2166,66', s.exVat === 2166.66);
  check('moms per rad: 250 + 79,9992 + 0 → 330,00', s.vat === 330);
  check('totalt inkl. moms = 2496,66', Math.abs(s.totalInclVat - 2496.66) < 1e-9);
  const d = I.calcSummary({ lines: [{ qty: 1, unitPrice: 1000, vatRate: 25 }], discount: { type: 'percent', value: 10 } });
  check('10 % rabatt: 900 + 225 = 1125', d.exVat === 900 && d.vat === 225 && d.totalInclVat === 1125);
  const f = I.calcSummary({ lines: [{ qty: 1, unitPrice: 1000, vatRate: 25 }], discount: { type: 'fixed', value: 5000 } });
  check('fast rabatt större än delsumma kapas → 0 kr, aldrig negativt', f.exVat === 0 && f.totalInclVat === 0);
  check("moms null/'' → 25 %, '0' → 0 %", I.normalizeVatRate(null) === 25 && I.normalizeVatRate('') === 25 && I.normalizeVatRate('0') === 0);
  check('moms 150/NaN → fallback, aldrig 150 %', I.normalizeVatRate(150) === 25 && I.normalizeVatRate('abc') === 25);
}

section('InvoiceService — ogiltiga belopp nekas');
{
  const { I } = load({});
  check('ROT/RUT större än totalen nekas', I.validateFinancialState({ lines: [{ qty: 1, unitPrice: 100, vatRate: 25 }], taxReduction: { type: 'rut', amount: 200 } }).ok === false);
  check('ROT/RUT NaN nekas (maskeras inte till 0)', I.validateFinancialState({ lines: [{ qty: 1, unitPrice: 100, vatRate: 25 }], taxReduction: { type: 'rut', amount: 'abc' } }).ok === false);
  check('giltig ROT ≤ total godkänns', I.validateFinancialState({ lines: [{ qty: 1, unitPrice: 1000, vatRate: 25 }], taxReduction: { type: 'rot', amount: 300 } }).ok === true);
  check('negativt antal nekas', I._validateLineData({ qty: -1 }).ok === false);
  check('Infinity-pris nekas', I._validateLineData({ unitPrice: Infinity }).ok === false);
  check('moms 250 % nekas vid radinmatning', I._validateLineData({ vatRate: 250 }).ok === false);
}

section('Tidpost → fakturaunderlag');
const ao = { id: 'AO-1', customerId: 'C1', priceType: 'timpris', title: 'Service' };
{
  const { B } = load({ workOrders: [ao], timeEntries: [
    { id: 'T1', aoId: 'AO-1', minutes: 50, hourRate: 650, date: '2026-11-20' },
    { id: 'T2', aoId: 'AO-1', minutes: 90, hourRate: 650 },
    { id: 'T3', aoId: 'AO-1', minutes: 60, hourRate: 0 },
    { id: 'T4', aoId: 'AO-1', minutes: 60, hourRate: 650, billable: false },
  ] });
  const c = B.getCandidates();
  const byId = (id) => c.find((x) => x.sourceId === id);
  check('50 min → 0,83 tim (minuter tolkas aldrig som timmar)', byId('T1').quantity === 0.83);
  check('köns belopp = det som faktureras (0,83 × 650 = 539,50)', byId('T1').amount === 539.5 && byId('T1').amount === Math.round(byId('T1').quantity * byId('T1').unitPrice * 100) / 100);
  check('90 min à 650 = 975 kr', byId('T2').amount === 975);
  check('timpris saknas → inte valbar, synlig åtgärd', byId('T3').selectable === false && byId('T3').issues.includes('Saknar timpris'));
  check('ej debiterbar tid kommer aldrig med', !byId('T4'));
}
{
  const { B } = load({ workOrders: [Object.assign({}, ao, { priceType: 'fastpris', fixedPrice: 5000 })], timeEntries: [{ id: 'T1', aoId: 'AO-1', minutes: 60, hourRate: 650 }] });
  check('fastpris-AO: tiden blir aldrig en egen fakturarad', !B.getCandidates().some((x) => x.sourceType === 'time'));
}
{
  const { B } = load({ workOrders: [ao], timeEntries: [{ id: 'T1', aoId: 'AO-1', minutes: 60, hourRate: 650 }],
    invoices: [{ id: 'INV-1', status: 'utkast', sourceAware: true, lines: [{ sourceRefs: [{ sourceKey: 'time:T1' }] }] }] });
  check('redan claimad tidpost erbjuds inte igen (ingen dubbelfakturering)', !B.getCandidates().some((x) => x.sourceId === 'T1'));
}
{
  const { B } = load({ workOrders: [ao], timeEntries: [{ id: 'T1', aoId: 'AO-1', minutes: 60, hourRate: 650 }] }, { pending: ['time:T1'] });
  const t = B.getCandidates().find((x) => x.sourceId === 'T1');
  check('tid som väntar på serverbekräftelse syns men är inte valbar', t && t.selectable === false && t.issues.includes('Väntar på serverbekräftelse'));
}

section('Underlag → faktura: samma belopp hela vägen');
{
  const { I, B } = load({ workOrders: [ao], timeEntries: [
    { id: 'T1', aoId: 'AO-1', minutes: 50, hourRate: 650 }, { id: 'T2', aoId: 'AO-1', minutes: 20, hourRate: 720 }, { id: 'T3', aoId: 'AO-1', minutes: 135, hourRate: 595 },
  ] });
  const c = B.getCandidates().filter((x) => x.selectable);
  const queueSum = Math.round(c.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  const lines = c.map((x) => ({ qty: x.quantity, unitPrice: x.unitPrice, vatRate: x.vatRate }));
  const inv = I.calcSummary({ lines });
  check('summa i kön = fakturans summa exkl. moms (' + queueSum + ')', Math.abs(queueSum - inv.exVat) < 0.005);
  check('ingen orimlig storleksordning (< 10 000 kr för 3,4 timmar)', inv.totalInclVat < 10000 && inv.totalInclVat > 1000);
}

done();
