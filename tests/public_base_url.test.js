'use strict';
/*
 * PUBLIC_BASE_URL ska vara uttryckligen miljöspecifik (G1/G4 del 2, 2026-11-27).
 *
 * 1. Statisk kontroll av alla Edge Functions i supabase/functions/:
 *    - inget reservvärde för PUBLIC_BASE_URL (`?? '...'` eller `|| '...'`),
 *    - ingen STAGING-domän och ingen hårdkodad CRM-/app-origin i koden (kommentarer räknas inte),
 *    - send-offer-email och send-push validerar PUBLIC_BASE_URL med resolvePublicBaseUrl()
 *      innan de skriver eller skickar något.
 * 2. Logiken i supabase/functions/_shared/public-base-url.ts körs på riktigt
 *    (transpileras med TypeScript-kompilatorn) med ett antal fall.
 * Saknas TypeScript-kompilatorn hoppas del 2 över, och det redovisas som ÖVERHOPPAT.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'supabase', 'functions');
let pass = 0, fail = 0, skipped = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m + (d ? '\n        ' + d : '')); } };

function walk(dir, out) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out); else if (/\.ts$/.test(d.name)) out.push(p);
  }
  return out;
}
// Tar bort kommentarer men behåller strängar (enkel lexer, räcker för dessa filer).
function stripComments(src) {
  let o = '', i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1; while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      o += src.slice(i, j + 1); i = j + 1; continue;
    }
    o += c; i++;
  }
  return o;
}

const files = walk(FN, []);
const rel = (f) => path.relative(ROOT, f);
const code = new Map(files.map((f) => [f, stripComments(fs.readFileSync(f, 'utf8'))]));

const fallback = files.filter((f) => /PUBLIC_BASE_URL['"]\s*\)\s*(\?\?|\|\|)/.test(code.get(f)));
ok(fallback.length === 0, 'inget reservvärde för PUBLIC_BASE_URL i någon Edge Function', fallback.map(rel).join(', '));

const stagingDomain = files.filter((f) => /staging-crm\./i.test(fs.readFileSync(f, 'utf8')));
ok(stagingDomain.length === 0, 'ingen STAGING-domän i supabase/functions (inte heller i kommentarer)', stagingDomain.map(rel).join(', '));

const hardOrigin = [];
for (const f of files) {
  const m = code.get(f).match(/['"`]https?:\/\/(?:crm|app|staging-crm)\.viftfast\.se[^'"`]*['"`]/g);
  if (m) hardOrigin.push(rel(f) + ': ' + m.join(' '));
}
ok(hardOrigin.length === 0, 'ingen hårdkodad CRM-/app-origin i koden', hardOrigin.join('; '));

function orderCheck(file, before, afterList) {
  const c = code.get(path.join(FN, file)) || '';
  const i = c.indexOf(before);
  const bad = afterList.filter((a) => { const j = c.indexOf(a); return j < 0 || i < 0 || i > j; });
  ok(i >= 0 && bad.length === 0, `${file}: ${before} körs före ${afterList.join(', ')}`, bad.join(', '));
}
orderCheck('send-offer-email/index.ts', 'resolvePublicBaseUrl(', ["req.json()", "rpc('offer_email_prepare_commit'", "'https://api.resend.com/emails'", 'public-offer.html']);
orderCheck('send-push/index.ts', 'resolvePublicBaseUrl(', ['req.json()', 'webpush.sendNotification(', '.from(\'push_subscriptions\')']);
orderCheck('send-push/index.ts', 'isProductionEnvironment()) {', ['resolvePublicBaseUrl(', 'req.json()', 'webpush.sendNotification(']);
ok(!fs.existsSync(path.join(FN, 'e2e-test-cleanup')) && !fs.existsSync(path.join(FN, 'vift-admin-storage')),
  'STAGING-only-funktionerna ligger inte i supabase/functions/ (finns i supabase/staging-only/functions/)');

// Del 2: kör logiken.
let ts = null;
for (const p of ['typescript', '/opt/node22/lib/node_modules/typescript']) { try { ts = require(p); break; } catch (e) { /* prova nästa */ } }
if (!ts) {
  skipped++;
  console.log('SKIP logiktest av public-base-url.ts (HOPPAS ÖVER — TypeScript saknas; INTE godkänt)');
} else {
  const src = fs.readFileSync(path.join(FN, '_shared', 'public-base-url.ts'), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  const r = mod.exports.resolvePublicBaseUrl;
  const LIVE = 'https://' + mod.exports.LIVE_SUPABASE_HOST;
  const OTHER = 'https://exempelprojekt.supabase.co';
  ok(r(undefined, LIVE).error === 'config_missing_public_base_url', 'saknat värde i LIVE ger config_missing_public_base_url');
  ok(r('   ', OTHER).error === 'config_missing_public_base_url', 'tomt värde i annat projekt ger config_missing_public_base_url');
  ok(r('http://crm.exempel.se', LIVE).error === 'config_invalid_public_base_url', 'http (inte https) avvisas');
  ok(r('inte en url', LIVE).error === 'config_invalid_public_base_url', 'ogiltig URL avvisas');
  ok(r('https://crm.exempel.se/app', LIVE).error === 'config_invalid_public_base_url', 'sökväg i bas-URL avvisas');
  ok(r('https://staging-x.exempel.se', LIVE).error === 'config_invalid_public_base_url', 'STAGING-värdnamn avvisas i LIVE-projektet');
  ok(r('https://staging-x.exempel.se', OTHER).ok === true, 'STAGING-värdnamn tillåts utanför LIVE-projektet');
  const v = r('https://crm.exempel.se/', LIVE);
  ok(v.ok === true && v.url === 'https://crm.exempel.se', 'giltig bas-URL accepteras och avslutande / tas bort');
  ok(r('https://crm.exempel.se', '').ok === true, 'saknat SUPABASE_URL räknas inte som LIVE men kräver ändå värde');
}

console.log(`RESULT: ${pass} passed, ${fail} failed${skipped ? `, ${skipped} ÖVERHOPPADE (inte godkända)` : ''}`);
process.exit(fail ? 1 : 0);
