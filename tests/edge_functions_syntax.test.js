'use strict';
/*
 * Syntaxkontroll av alla Edge Functions (supabase/functions/**.ts och
 * supabase/staging-only/functions/**.ts) med TypeScript-kompilatorns parser.
 * Kontrollerar bara syntax (inga typer, inga fjärrimporter löses upp) och att varje
 * relativ import pekar på en fil som finns. Ersätter inte en riktig `deno check`.
 * Saknas TypeScript-kompilatorn hoppas testet över (redovisas, inte godkänt).
 */
const fs = require('fs');
const path = require('path');

let ts = null;
for (const p of ['typescript', '/opt/node22/lib/node_modules/typescript']) { try { ts = require(p); break; } catch (e) { /* prova nästa */ } }
if (!ts) { console.log('RESULT: 0 passed, 0 failed (HOPPAS ÖVER — TypeScript saknas; INTE godkänt, inte kört)'); process.exit(0); }

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isSymbolicLink()) continue;
    if (d.isDirectory()) walk(p, out); else if (/\.ts$/.test(d.name)) out.push(p);
  }
  return out;
}
const files = walk(path.join(ROOT, 'supabase', 'functions'), []).concat(walk(path.join(ROOT, 'supabase', 'staging-only', 'functions'), []));
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const out = ts.transpileModule(src, { fileName: f, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  const diags = (out.diagnostics || []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
  const missing = [];
  for (const m of src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    if (!fs.existsSync(path.resolve(path.dirname(f), m[1]))) missing.push(m[1]);
  }
  const r = path.relative(ROOT, f);
  if (!diags.length && !missing.length) { pass++; console.log('PASS', r); }
  else { fail++; console.log('FAIL', r, diags.concat(missing.map((x) => 'saknad import ' + x)).join(' | ')); }
}
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
