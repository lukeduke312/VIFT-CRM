#!/usr/bin/env node
/*
 * Kör E2E-sviten: node tests/e2e/run.js [--grep text] [--module "Arbetsordrar"]
 * Resultat: tests/e2e/report/results.json, tests/e2e/report/REPORT.md,
 * skärmbilder för misslyckade test i tests/e2e/report/screenshots/.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const GREP = opt('--grep');
const MODULE = opt('--module');
const REPORT = path.join(__dirname, 'report');
const SHOTS = path.join(REPORT, 'screenshots');
const TIMEOUT = Number(opt('--timeout') || 90000);

/* Kända, avsiktliga konsolmeddelanden som inte är fel i sig. */
const BENIGN_CONSOLE = [/Failed to load resource/i, /ERR_BLOCKED_BY_CLIENT/i, /frame-ancestors/i];

// Ett testfels kvarlämnade väntande löften får aldrig krascha hela körningen.
process.on('unhandledRejection', (e) => { console.warn('      (ohanterat löfte efter testfel: ' + String(e && e.message || e).split('\n')[0] + ')'); });

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.readdirSync(SHOTS).forEach((f) => fs.unlinkSync(path.join(SHOTS, f)));
  const specs = fs.readdirSync(path.join(__dirname, 'specs')).filter((f) => f.endsWith('.js')).sort();
  let tests = [];
  specs.forEach((f) => { require(path.join(__dirname, 'specs', f)).forEach((t) => tests.push(Object.assign({ file: f }, t))); });
  if (GREP) { const re = new RegExp(GREP, 'i'); tests = tests.filter((t) => re.test(t.id + ' ' + t.name)); }
  if (MODULE) tests = tests.filter((t) => t.module === MODULE);
  await lib.start();
  const results = [];
  const t0 = Date.now();
  for (const t of tests) {
    if (t.blocked) { results.push({ id: t.id, module: t.module, name: t.name, kind: t.kind || 'ui', status: 'blocked', reason: t.blocked }); console.log('BLOCK ' + t.id + ' — ' + t.blocked); continue; }
    const world = new lib.World(t.world);
    const ctx = { world, fake: world.fake, notes: [], metrics: {},
      assert(cond, msg) { if (!cond) throw new Error('Kontroll misslyckades: ' + msg); },
      note(m) { this.notes.push(m); },
      metric(k, v) { this.metrics[k] = v; } };
    const started = Date.now();
    let status = 'passed', error = null;
    try {
      await Promise.race([
        t.run(ctx),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout efter ' + TIMEOUT + ' ms')), TIMEOUT)),
      ]);
      // Ej fångade JS-fel underkänner alltid testet.
      const pageErrors = world.sessions.flatMap((s) => s.pageErrors);
      if (pageErrors.length) { status = 'failed'; error = 'Ej fångat JavaScript-fel: ' + pageErrors.slice(0, 3).join(' | '); }
    } catch (e) {
      status = 'failed'; error = (e && e.message || String(e)).split('\n').slice(0, 4).join(' ');
    }
    if (t.knownIssue) {
      if (status === 'failed') { status = 'known'; }
      else ctx.notes.push('Känt fel ' + t.knownIssue + ' reproduceras inte längre — kontrollera och stäng');
    }
    const consoleErrors = world.sessions.flatMap((s) => s.consoleErrors).filter((m) => !BENIGN_CONSOLE.some((r) => r.test(m)));
    const netErrors = world.sessions.flatMap((s) => s.netErrors);
    const shots = [];
    if (status === 'failed') {
      for (let i = 0; i < world.sessions.length; i++) {
        const f = path.join(SHOTS, t.id + (world.sessions.length > 1 ? '-' + (i + 1) : '') + '.png');
        await world.sessions[i].shot(f); shots.push(path.relative(REPORT, f));
      }
    }
    const r = { id: t.id, module: t.module, name: t.name, kind: t.kind || 'ui', status, error, ms: Date.now() - started,
      notes: ctx.notes, metrics: ctx.metrics, consoleErrors: consoleErrors.slice(0, 10), netErrors: netErrors.slice(0, 10),
      unmodeled: [...new Set(world.fake.unmodeled)], screenshots: shots,
      requests: world.sessions.reduce((n, s) => n + s.requests.length, 0) };
    results.push(r);
    console.log((status === 'passed' ? 'PASS  ' : status === 'known' ? 'KNOWN ' : 'FAIL  ') + t.id + ' ' + t.name + (error ? '\n      ' + error : ''));
    if (status === 'failed' && ctx.notes.length) console.log('      noteringar: ' + ctx.notes.join(' | '));
    await world.close();
  }
  await lib.stop();
  const summary = {
    when: new Date().toISOString(), target: 'simulerad backend (FakeSupabase)', browser: 'Chromium (Playwright)',
    total: results.length, passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) => r.status === 'failed').length, blocked: results.filter((r) => r.status === 'blocked').length,
    known: results.filter((r) => r.status === 'known').length,
    durationMs: Date.now() - t0,
  };
  fs.mkdirSync(REPORT, { recursive: true });
  fs.writeFileSync(path.join(REPORT, 'last-partial.json'), JSON.stringify({ summary, results }, null, 2));
  if (!GREP && !MODULE) {
    fs.writeFileSync(path.join(REPORT, 'results.json'), JSON.stringify({ summary, results }, null, 2));
    fs.writeFileSync(path.join(REPORT, 'REPORT.md'), renderMd(summary, results));
  }
  console.log('\n' + summary.passed + ' godkända, ' + summary.failed + ' misslyckade, ' + summary.blocked + ' blockerade, ' + summary.known + ' kända fel av ' + summary.total + ' (' + Math.round(summary.durationMs / 1000) + ' s)');
  process.exit(summary.failed ? 1 : 0);
}

/* De 32 moduler uppdraget räknar upp, i samma ordning. */
const MODULES = ['Inloggning och utloggning', 'Dashboard', 'Navigering och menyer', 'Kundregister', 'Kontaktpersoner', 'Fastighetsregister',
  'Objekt och lägenheter', 'Arbetsordrar', 'Arbetsorderchecklistor', 'Arbetsorderloggar', 'Bilder och dokument', 'Materialregistrering',
  'Tidregistrering och instämpling', 'Mina jobb', 'Personalregister', 'Användarroller och behörigheter', 'Offertmodulen',
  'Digitala offertlänkar och kundsvar', 'Fakturering och fakturaunderlag', 'Prisgrupper och artiklar', 'Projekt', 'Rondering', 'Avvikelser',
  'Serviceintervall', 'Återkommande AO', 'Att göra', 'Kalender', 'Säljchanser', 'Rapporter och statistik', 'Import och export',
  'Inställningar och administration', 'Push och notifieringsgränssnitt'];

function renderMd(s, results) {
  const byMod = {};
  results.forEach((r) => { (byMod[r.module] = byMod[r.module] || []).push(r); });
  let md = '# VIFT CRM — E2E-resultat\n\n';
  md += 'Genererad ' + s.when + '. Mål: ' + s.target + '. Webbläsare: ' + s.browser + '.\n\n';
  md += '**' + s.total + ' tester: ' + s.passed + ' godkända, ' + s.failed + ' misslyckade, ' + s.blocked + ' blockerade, ' + s.known + ' kända fel (reproducerade, ej åtgärdade).**\n\n';
  md += 'Simulerad backend: klientens beteende mot en modell av Supabase-kontrakten — inte verifierat mot riktig STAGING.\n\n';
  const wf = results.filter((r) => r.kind === 'workflow');
  const covered = MODULES.filter((m) => (byMod[m] || []).some((r) => r.status === 'passed' || r.status === 'known'));
  md += '**Modultäckning: ' + covered.length + ' av ' + MODULES.length + ' moduler har minst ett godkänt webbläsartest. Kritiska arbetsflöden: ' + wf.filter((r) => r.status === 'passed').length + ' av ' + wf.length + ' godkända.** ';
  md += 'Ett godkänt test visar att det beskrivna flödet fungerar — inte att varje knapp på sidan är prövad; se kolumnen Omfattning.\n\n';
  md += '| # | Modul | Tester | Godkända | Misslyckade | Kända fel | Blockerade | Omfattning |\n|---|---|---|---|---|---|---|---|\n';
  MODULES.forEach((m, i) => {
    const rs = byMod[m] || [];
    const depth = rs.some((r) => r.kind === 'workflow') ? 'arbetsflöde end-to-end' : rs.some((r) => r.kind === 'contract') ? 'UI + serverkontrakt (simulerat)' : rs.length ? 'UI-funktioner' : 'EJ TESTAD';
    md += '| ' + (i + 1) + ' | ' + m + ' | ' + rs.map((r) => r.id).join(', ') + ' | ' + rs.filter((r) => r.status === 'passed').length + ' | ' + rs.filter((r) => r.status === 'failed').length + ' | ' + rs.filter((r) => r.status === 'known').length + ' | ' + rs.filter((r) => r.status === 'blocked').length + ' | ' + depth + ' |\n';
  });
  const extra = Object.keys(byMod).filter((m) => MODULES.indexOf(m) === -1);
  if (extra.length) {
    md += '\n**Tvärgående:** ';
    md += extra.map((m) => m + ' (' + byMod[m].filter((r) => r.status === 'passed').length + '/' + byMod[m].length + ' godkända: ' + byMod[m].map((r) => r.id).join(', ') + ')').join('; ') + '.\n';
  }
  md += '\n## Per test\n\n| Id | Modul | Test | Resultat | Tid | Anmärkning |\n|---|---|---|---|---|---|\n';
  results.forEach((r) => {
    const note = (r.status === 'failed' || r.status === 'known') ? r.error : r.status === 'blocked' ? r.reason : (r.notes || []).join('; ');
    md += '| ' + r.id + ' | ' + r.module + ' | ' + r.name + ' | ' + ({ passed: 'Godkänd', failed: 'Misslyckad', blocked: 'Blockerad', known: 'Känt fel' }[r.status]) + ' | ' + (r.ms != null ? r.ms + ' ms' : '') + ' | ' + String(note || '').replace(/\|/g, '/').slice(0, 220) + ' |\n';
  });
  const withMetrics = results.filter((r) => r.metrics && Object.keys(r.metrics).length);
  if (withMetrics.length) {
    md += '\n## Mätvärden (lokal maskin, simulerad backend utan nätverkslatens)\n\n| Test | Mätvärde | Värde |\n|---|---|---|\n';
    withMetrics.forEach((r) => Object.entries(r.metrics).forEach(([k, v]) => { md += '| ' + r.id + ' | ' + k + ' | ' + v + ' |\n'; }));
  }
  const errs = results.filter((r) => (r.consoleErrors && r.consoleErrors.length) || (r.unmodeled && r.unmodeled.length));
  if (errs.length) {
    md += '\n## Konsolfel och ej modellerade anrop\n\n';
    errs.forEach((r) => {
      md += '- **' + r.id + '**' + (r.unmodeled.length ? ' — ej modellerat: ' + r.unmodeled.join(', ') : '') + (r.consoleErrors.length ? ' — konsol: ' + r.consoleErrors.slice(0, 3).map((m) => '`' + m.replace(/`/g, "'").slice(0, 140) + '`').join(', ') : '') + '\n';
    });
  }
  return md;
}

main().catch((e) => { console.error(e); process.exit(2); });
