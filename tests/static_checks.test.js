'use strict';
/*
 * Statiska kontroller av frontendkoden (inga beroenden).
 *
 * 1. Operatorprioritet: `'…' + \n (villkor)\n ? a : b` — `+` binder hårdare
 *    än `?:`, så hela den föregående strängen blir villkoret. Exakt detta
 *    gjorde Exportcentret obrukbart (E2E EXP-01, 2026-11-23). Ett villkor
 *    som följer direkt efter ett `+` måste ligga inom en egen parentes
 *    tillsammans med sina grenar: `+ (villkor ? a : b)`.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('PASS — ' + name); }
  else { failed++; console.log('FAIL — ' + name + (detail ? '\n        ' + detail : '')); }
}

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out); else if (/\.js$/.test(d.name)) out.push(p);
  });
  return out;
}
const isComment = (s) => { s = s.trim(); return s === '' || s.startsWith('//') || s.startsWith('*') || (s.startsWith('/*') && s.endsWith('*/')) || (s.endsWith('*/') && !s.includes('/*')); };
function balancedWhole(s) {
  s = s.trim();
  if (!s.startsWith('(')) return false;
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') d++;
    else if (s[i] === ')') { d--; if (d === 0) return i === s.length - 1; }
  }
  return false;
}
function precedenceHits(src) {
  const L = src.split('\n'); const hits = [];
  for (let i = 0; i < L.length; i++) {
    if (!/^\s*\?(\s|$)/.test(L[i])) continue;
    let j = i - 1; while (j >= 0 && isComment(L[j])) j--;
    let k = j - 1; while (k >= 0 && isComment(L[k])) k--;
    if (j >= 0 && k >= 0 && /\+\s*$/.test(L[k]) && balancedWhole(L[j])) hits.push(i + 1);
  }
  return hits;
}

// Självtest: mönstret som bröt Exportcentret ska hittas.
check('detektorn hittar det kända felmönstret', precedenceHits("x = '<a>' +\n  /* c */\n  (cfg && ok)\n    ? '<b>'\n    : '' +\n  '<c>';").length === 1);
check('detektorn godkänner korrekt parentes', precedenceHits("x = '<a>' +\n  ((cfg && ok)\n    ? '<b>'\n    : '') +\n  '<c>';").length === 0);

const files = walk(path.join(ROOT, 'src'), []).concat([path.join(ROOT, 'public-offer.html'), path.join(ROOT, 'index.html')].filter(fs.existsSync));
const all = [];
files.forEach((f) => { precedenceHits(fs.readFileSync(f, 'utf8')).forEach((ln) => all.push(path.relative(ROOT, f) + ':' + ln)); });
check('inget `+ (villkor) ? a : b` utan omslutande parentes i frontendkoden', all.length === 0, all.join(', '));

/*
 * 2. Cachebuster: varje lokal .js/.css i index.html laddas med ?v=N, och
 *    varje fil som ändrats sedan den driftsatta STAGING-baslinjen
 *    (commit 56a943d) har ett HÖGRE N än baslinjen — annars kan Service
 *    Workern/webbläsaren servera den gamla filen (E2E: gamla cachefiler).
 */
const { execFileSync } = require('child_process');
const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const refRe = /(?:src|href)="((?:src\/|config)[^"?]*\.(?:js|css))(\?v=(\d+))?"/g;
const missing = []; const cur = {};
let mm; while ((mm = refRe.exec(idxHtml))) { if (!mm[2]) missing.push(mm[1]); else cur[mm[1]] = Number(mm[3]); }
check('alla lokala skript/stilmallar i index.html har ?v=', missing.length === 0, missing.join(', '));
let baseIdx = null;
try { baseIdx = execFileSync('git', ['show', '56a943d:index.html'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { baseIdx = null; }
if (baseIdx) {
  const base = {}; const re2 = /(?:src|href)="([^"?]+\.(?:js|css))\?v=(\d+)"/g; let b;
  while ((b = re2.exec(baseIdx))) base[b[1]] = Number(b[2]);
  const stale = [];
  Object.keys(cur).forEach((f) => {
    if (!(f in base)) return;
    let changed = false;
    try { execFileSync('git', ['diff', '--quiet', '56a943d', '--', f], { cwd: ROOT, stdio: 'ignore' }); } catch (e) { changed = true; }
    if (changed && !(cur[f] > base[f])) stale.push(f + ' (v' + cur[f] + ', baslinje v' + base[f] + ')');
  });
  check('ändrade filer sedan STAGING-baslinjen har högre ?v=', stale.length === 0, stale.join(', '));
} else {
  console.log('SKIP — git/baslinjecommit saknas; versionsjämförelsen hoppas över');
}

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
