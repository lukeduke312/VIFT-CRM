#!/usr/bin/env node
/*
 * Serviceintervall — kör den riktiga src/services/ServiceIntervalService.js
 * i en Node vm-sandlåda (endast globala beroenden stubbas).
 * Täcker: datumgränser (månadsskifte, skottår, årsintervall), status,
 * pausning, separata idempotensnycklar klient/server, övergång från den
 * gamla delade nyckeln, markDone-historik och getAllAcrossProperties().
 */
'use strict';
process.env.TZ = 'Europe/Stockholm';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, section, done } = require('./lib/harness');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src/services/ServiceIntervalService.js'), 'utf8');

function sandbox(today, extra) {
  const created = [], notified = [];
  let persistCalls = 0;
  const sb = {
    console, Date, Math, JSON,
    state: Object.assign({ properties: [], activities: [], currentUser: { id: 'ST-1' } }, extra || {}),
    tdy: () => today,
    fmtDate: (d) => d,
    persist: () => { persistCalls++; return Promise.resolve(true); },
    ActivitiesService: {
      create: (a) => { const rec = Object.assign({ id: 'A' + (created.length + 1), status: 'open' }, a); created.push(rec); sb.state.activities.push(rec); return rec; },
      update: () => {}, complete: (id) => { const a = sb.state.activities.find((x) => x.id === id); if (a) a.status = 'done'; },
    },
    NotificationsService: { push: (...a) => notified.push(a) },
  };
  vm.createContext(sb);
  vm.runInContext(SRC + '\n;globalThis.__SIS = ServiceIntervalService;', sb);
  return { SIS: sb.__SIS, sb, created, notified, persistCalls: () => persistCalls };
}

const si = (o) => Object.assign({ id: 'SI-1', title: 'Filterbyte', active: true, intervalType: 'quarterly', reminderDays: 14,
  lastNotificationSentForDueDate: '', lastActivityNotifiedForDueDate: '', history: [] }, o);

section('calcNextDue — kalendergränser');
{
  const { SIS } = sandbox('2026-01-01');
  check('31 jan + 1 mån = 28 feb (ej skottår)', SIS.calcNextDue('2027-01-31', 'monthly') === '2027-02-28');
  check('31 jan + 1 mån = 29 feb (skottår 2028)', SIS.calcNextDue('2028-01-31', 'monthly') === '2028-02-29');
  check('30 nov + 3 mån = 28 feb över årsskifte', SIS.calcNextDue('2026-11-30', 'quarterly') === '2027-02-28');
  check('15 dec + 1 mån = 15 jan nästa år', SIS.calcNextDue('2026-12-15', 'monthly') === '2027-01-15');
  check('29 feb + 1 år = 28 feb', SIS.calcNextDue('2028-02-29', 'annual') === '2029-02-28');
  check('custom 10 dagar över månadsskifte', SIS.calcNextDue('2026-03-25', 'custom_days', 10) === '2026-04-04');
  check('över sommartidsskifte (29 mars) ingen dagförskjutning', SIS.calcNextDue('2026-03-28', 'custom_days', 1) === '2026-03-29');
  check('okänd intervalltyp ger tom sträng', SIS.calcNextDue('2026-01-01', 'nope') === '');
}

section('getStatus — trösklar och pausning');
{
  const { SIS } = sandbox('2026-06-15');
  check('förfallen igår → overdue', SIS.getStatus(si({ nextDue: '2026-06-14' })) === 'overdue');
  check('idag → due_soon', SIS.getStatus(si({ nextDue: '2026-06-15' })) === 'due_soon');
  check('om 10 dagar, reminder 14 → approaching', SIS.getStatus(si({ nextDue: '2026-06-25' })) === 'approaching');
  check('om 30 dagar → ok', SIS.getStatus(si({ nextDue: '2026-07-15' })) === 'ok');
  check('pausad men förfallen → paused', SIS.getStatus(si({ active: false, nextDue: '2026-01-01' })) === 'paused');
}

section('runDailyCheck — idempotens och separata nycklar');
{
  const t = sandbox('2026-06-15', { properties: [{ id: 'P1', name: 'Huset', serviceIntervals: [si({ nextDue: '2026-06-10' })] }] });
  t.SIS.runDailyCheck();
  const s1 = t.sb.state.properties[0].serviceIntervals[0];
  check('förfallen period → en Att göra-post', t.created.length === 1);
  check('…och en in-app-notis', t.notified.length === 1);
  check('klientnyckeln lastActivityNotifiedForDueDate sätts', s1.lastActivityNotifiedForDueDate === 'SI-1::2026-06-10');
  check('serverns nyckel lastNotificationSentForDueDate rörs INTE', s1.lastNotificationSentForDueDate === '');
  t.SIS.runDailyCheck();
  check('andra körningen samma dag: ingen ny post/notis', t.created.length === 1 && t.notified.length === 1);
}
{
  const t = sandbox('2026-06-15', { properties: [{ id: 'P1', name: 'Huset', serviceIntervals: [si({ nextDue: '2026-06-10', lastNotificationSentForDueDate: 'SI-1::2026-06-10' })] }] });
  t.SIS.runDailyCheck();
  check('server redan skickat push → klienten skapar ändå sin Att göra (tystas inte)', t.created.length === 1);
}
{
  const t = sandbox('2026-06-15', {
    properties: [{ id: 'P1', name: 'Huset', serviceIntervals: [si({ nextDue: '2026-06-10' })] }],
    activities: [{ id: 'OLD', relatedType: 'service_interval', relatedId: 'SI-1', duePeriodKey: 'SI-1::2026-06-10', status: 'done' }],
  });
  t.SIS.runDailyCheck();
  check('övergång: befintlig (även klar) post för perioden → ingen ny post', t.created.length === 0);
  check('övergång: ingen dubbel notis', t.notified.length === 0);
  check('övergång: klientnyckeln markeras', t.sb.state.properties[0].serviceIntervals[0].lastActivityNotifiedForDueDate === 'SI-1::2026-06-10');
}
{
  const t = sandbox('2026-06-15', { properties: [{ id: 'P1', name: 'Huset', serviceIntervals: [si({ nextDue: '2026-06-10', active: false })] }] });
  t.SIS.runDailyCheck();
  check('pausat intervall skapar ingen uppgift', t.created.length === 0 && t.notified.length === 0);
}

section('markDone — historik, ny period, nollställda nycklar');
{
  const t = sandbox('2026-06-15', { properties: [{ id: 'P1', name: 'Huset', serviceIntervals: [si({ nextDue: '2026-06-10', lastActivityNotifiedForDueDate: 'SI-1::2026-06-10', lastNotificationSentForDueDate: 'SI-1::2026-06-10' })] }] });
  t.sb.state.activities.push({ id: 'A9', relatedType: 'service_interval', relatedId: 'SI-1', duePeriodKey: 'SI-1::2026-06-10', status: 'open' });
  const ok = t.SIS.markDone('P1', 'SI-1', { date: '2026-06-15', staffId: 'ST-1', comment: 'bytt' });
  const s1 = t.sb.state.properties[0].serviceIntervals[0];
  check('markDone returnerar true', ok === true);
  check('historikpost med föregående förfallodatum', s1.history.length === 1 && s1.history[0].previousNextDue === '2026-06-10');
  check('nästa förfall = utförd + 3 mån', s1.nextDue === '2026-09-15');
  check('båda idempotensnycklarna nollställs', s1.lastActivityNotifiedForDueDate === '' && s1.lastNotificationSentForDueDate === '');
  check('kopplad Att göra-post stängs', t.sb.state.activities.find((a) => a.id === 'A9').status === 'done');
  check('markDone på okänt intervall → false', t.SIS.markDone('P1', 'NOPE') === false);
}

section('getAllAcrossProperties — alla fastigheter, alla statusar, sorterat');
{
  const t = sandbox('2026-06-15', { properties: [
    { id: 'P1', name: 'A', serviceIntervals: [si({ id: 'x1', nextDue: '2026-08-01' }), si({ id: 'x2', active: false, nextDue: '2026-06-01' })] },
    { id: 'P2', name: 'B', serviceIntervals: [si({ id: 'x3', nextDue: '' }), si({ id: 'x4', nextDue: '2026-06-01' })] },
    { id: 'P3', name: 'C' },
  ] });
  const all = t.SIS.getAllAcrossProperties();
  check('returnerar alla 4 intervall från alla fastigheter', all.length === 4);
  check('inkluderar pausade och datumlösa', all.some((x) => x.status === 'paused') && all.some((x) => x.status === 'not_set'));
  check('sorterat: tidigast förfall först, datumlöst sist', all[all.length - 1].interval.id === 'x3' && ['x2', 'x4'].includes(all[0].interval.id));
  check('propertyId/propertyName följer med', all.every((x) => x.propertyId && x.propertyName));
}

section('PropertyDetailPage — modalknappar är riktiga funktioner');
{
  const pdp = fs.readFileSync(path.join(__dirname, '..', 'src/pages/PropertyDetailPage.js'), 'utf8');
  const modal = fs.readFileSync(path.join(__dirname, '..', 'src/components/Modal.js'), 'utf8');
  check('Modal.open läser btn.onClick', /b\.onclick\s*=\s*btn\.onClick/.test(modal));
  check("inga döda `fn: '...'`-knappar kvar", !/\{\s*label:[^}]*\bfn:\s*['`]/.test(pdp));
  check('översiktens uppdateringshook anropas i 5 sparvägar', (pdp.match(/this\._refreshSIOverview\(\);/g) || []).length === 5);
}

done();
