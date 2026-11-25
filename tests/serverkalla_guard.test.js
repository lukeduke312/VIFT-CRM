'use strict';
/*
 * KÄLLA-1 (BESLUT-2026-11-28): klientgrenen får inte innehålla serverkod.
 * Underkänns om VIFT-CRM åter får supabase/migrations, supabase/functions, en Supabase
 * CLI-konfiguration eller .sql-filer avsedda för installation, eller om ett test läser en
 * lokal serverkopia i stället för den auktoritativa källan (tests/lib/serverkalla.js).
 * Hänvisningen supabase/README.md ska ange remote, gren och servercommit.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m + (d ? '\n        ' + JSON.stringify(d).slice(0, 600) : '')); } };

const TILLATNA_SQL = ['tests/fixtures/staging_offer_rpcs_installed.sql'];
/* Spårade och ospårade filer (utom ignorerade, t.ex. .claude/ med andra agenters worktrees). */
function filer() {
  try {
    const ut = execFileSync('git', ['-C', ROOT, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
      .filter((f) => fs.existsSync(path.join(ROOT, f)));
    const dirs = new Set(); ut.forEach((f) => { let d = path.dirname(f); while (d && d !== '.') { dirs.add(d); d = path.dirname(d); } });
    return { files: ut, dirs: [...dirs] };
  } catch (e) {
    const ut = { dirs: [], files: [] };
    (function walk(dir) {
      for (const e2 of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['.git', 'node_modules', '.claude'].includes(e2.name)) continue;
        const p = path.join(dir, e2.name);
        if (e2.isDirectory()) { ut.dirs.push(path.relative(ROOT, p)); walk(p); } else ut.files.push(path.relative(ROOT, p));
      }
    })(ROOT);
    return ut;
  }
}
const alla = filer();

const supa = alla.files.filter((f) => f.startsWith('supabase/'));
ok(supa.length === 1 && supa[0] === 'supabase/README.md', 'supabase/ innehåller bara hänvisningen README.md', supa);
const serverKat = alla.dirs.filter((d) => /(^|\/)supabase(-[^/]*)?\/(migrations|functions|staging-only|manual)$/.test(d) || /(^|\/)supabase\/functions\//.test(d));
ok(serverKat.length === 0, 'inga kataloger supabase/migrations, supabase/functions, staging-only eller manual', serverKat);
ok(!alla.files.some((f) => /(^|\/)config\.toml$/.test(f) && /supabase/.test(f)), 'ingen Supabase CLI-konfiguration (supabase/config.toml)');
const sql = alla.files.filter((f) => f.endsWith('.sql') && !TILLATNA_SQL.includes(f));
ok(sql.length === 0, 'inga .sql-filer avsedda för installation (bara testfixturen ' + TILLATNA_SQL.join(', ') + ')', sql);
const fx = fs.readFileSync(path.join(ROOT, TILLATNA_SQL[0]), 'utf8');
ok(/för lokala tester/.test(fx.slice(0, 400)), 'testfixturen är märkt som lokal testfixtur (inte installation)');
const ts = alla.files.filter((f) => /^(supabase|functions)\//.test(f) && f.endsWith('.ts'));
ok(ts.length === 0, 'inga Edge Function-källor (.ts) i klientgrenen', ts);

// Tester och verktyg ska läsa serverkällan via tests/lib/serverkalla.js (VIFT_SERVER_ROOT).
const js = alla.files.filter((f) => /^(tests|tools)\//.test(f) && /\.(js|sh|py)$/.test(f) && f !== 'tests/lib/serverkalla.js' && f !== 'tests/serverkalla_guard.test.js');
const lokalKopia = js.filter((f) => { const s = fs.readFileSync(path.join(ROOT, f), 'utf8'); return /path\.(join|resolve)\([^)]*['"]supabase['"]/.test(s) || /['"`]supabase\/(migrations|functions|backup|manual)\//.test(s); });
ok(lokalKopia.length === 0, 'inga tester eller verktyg läser en lokal supabase/-kopia', lokalKopia);
const deploy = js.filter((f) => /supabase\s+(db\s+push|functions\s+deploy|migration\s+repair)/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
ok(deploy.length === 0, 'inga skript i klientgrenen kör supabase db push / functions deploy / migration repair', deploy);

// Hänvisningen
const readme = fs.existsSync(path.join(ROOT, 'supabase/README.md')) ? fs.readFileSync(path.join(ROOT, 'supabase/README.md'), 'utf8') : '';
const commit = (/commit `?([0-9a-f]{7,40})`?/.exec(readme) || [])[1];
ok(/github\.com\/lukeduke312\/VIFT-CRM/.test(readme) && /claude\/vift-system-restructure-8fUme/.test(readme) && !!commit, 'supabase/README.md anger remote, gren och servercommit', { commit });
const serverRepo = path.join(process.env.VIFT_SERVER_ROOT || '/home/user/vift-v2/supabase', '..');
if (commit && fs.existsSync(path.join(serverRepo, '.git'))) {
  let finns = true; try { execFileSync('git', ['-C', serverRepo, 'cat-file', '-e', commit + '^{commit}'], { stdio: 'ignore' }); } catch (e) { finns = false; }
  ok(finns, 'servercommit ' + commit + ' finns i server-arbetskopian ' + serverRepo);
  const v2fx = path.join(serverRepo, 'tests', 'fixtures', path.basename(TILLATNA_SQL[0]));
  ok(fs.existsSync(v2fx) && fs.readFileSync(v2fx, 'utf8') === fx, 'testfixturen är identisk med serverrepots kopia (ingen divergerande serverdefinition)');
} else console.log('INFO server-arbetskopian saknas — commit och fixtur kontrolleras inte här (serverkalla.js underkänner testerna som behöver källan)');

console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
