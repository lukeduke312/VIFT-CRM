'use strict';
/*
 * SQL-texthjälp för MIG-1 (migrationsmappningen).
 *   cliStatements(sql)  delar en migrationsfil i satser som Supabase CLI gör (semikolon utanför
 *                       strängar, citerade namn, dollar-citat och kommentarer; varje sats trimmad,
 *                       tom sista sats bort). STAGING sparar array_to_string(statements, E';\n').
 *   cliText(sql)        = cliStatements(sql).join(';\n') — jämförs med migrations-applicerade/.
 *   aterstalltInnehall(fil)  för filer med huvudet "ÅTERSTÄLLD … INNEHÅLL": exakt innehåll.
 *   sqlKod(sql)         normaliserad kod: utan kommentarer, whitespace hopslaget (samma regel
 *                       som tests/local/jamfor-schema.js) — "samma kod".
 */
function cliStatements(s) {
  const out = []; let cur = '', i = 0;
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (c === '-' && d === '-') { const j = s.indexOf('\n', i); const e = j < 0 ? s.length : j + 1; cur += s.slice(i, e); i = e; continue; }
    if (c === '/' && d === '*') { const j = s.indexOf('*/', i + 2); const e = j < 0 ? s.length : j + 2; cur += s.slice(i, e); i = e; continue; }
    if (c === "'" || c === '"') { let j = i + 1; while (j < s.length) { if (s[j] === c) { if (s[j + 1] === c) { j += 2; continue; } break; } j++; } cur += s.slice(i, j + 1); i = j + 1; continue; }
    if (c === '$') { const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i, i + 64)); if (m) { const j = s.indexOf(m[0], i + m[0].length); const e = j < 0 ? s.length : j + m[0].length; cur += s.slice(i, e); i = e; continue; } }
    if (c === ';') { out.push(cur); cur = ''; i++; continue; }
    cur += c; i++;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x, k, a) => !(k === a.length - 1 && x === ''));
}
const cliText = (s) => cliStatements(s).join(';\n');
function aterstalltInnehall(s) {
  if (!/ÅTERSTÄLLD/.test(s.slice(0, 400))) return null;
  const i = s.indexOf('-- INNEHÅLL\n');
  if (i < 0) return null;
  let c = s.slice(i + '-- INNEHÅLL\n'.length);
  if (c.endsWith('\n;\n')) c = c.slice(0, -3);
  return c;
}
function sqlKod(s) {
  s = String(s || ''); let o = '', i = 0;
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (c === '-' && d === '-') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const j = s.indexOf('*/', i + 2); i = j < 0 ? s.length : j + 2; o += ' '; continue; }
    if (c === "'" || c === '"') { let j = i + 1; while (j < s.length) { if (s[j] === c) { if (s[j + 1] === c) { j += 2; continue; } break; } j++; } o += s.slice(i, j + 1); i = j + 1; continue; }
    o += c; i++;
  }
  return o.replace(/\s+/g, ' ').replace(/\s*([(),;=<>+*\/|-])\s*/g, '$1').replace(/;+/g, ';').replace(/^;|;$/g, '').trim();
}
module.exports = { cliStatements, cliText, aterstalltInnehall, sqlKod };
