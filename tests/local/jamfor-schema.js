'use strict';
/*
 * Jämför schemat i en lokal databas (efter migrationskedjan) mot STAGING-facit
 * tests/local/staging-schema-facit-2026-11-25.json.
 *
 * Användning: node tests/local/jamfor-schema.js <databas> [rapport.json]
 * Miljö: PGHOST/PGUSER som för psql.
 *
 * Objekt som jämförs: funktioner i public (pg_get_functiondef + EXECUTE-ACL),
 * RLS-policyer i public och storage, triggers i public, tabeller/sekvenser i public
 * (kolumner, constraints, index, RLS-flaggor, ACL) och storage-buckets.
 *
 * Avvikelser som har en förklaring i tests/local/kanda-avvikelser.json redovisas som
 * FÖRKLARADE. Allt annat är OFÖRKLARAT och ger exit-kod 1.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DB = process.argv[2];
const OUT = process.argv[3];
if (!DB) { console.error('användning: node jamfor-schema.js <databas> [rapport.json]'); process.exit(2); }
const facit = JSON.parse(fs.readFileSync(path.join(__dirname, 'staging-schema-facit-2026-11-25.json'), 'utf8'));
const kanda = JSON.parse(fs.readFileSync(path.join(__dirname, 'kanda-avvikelser.json'), 'utf8'));
/* T3-B (2026-11-28): avsiktliga, ännu inte installerade ändringar (klass "ny" i MIG-1).
   Ett objekt i t3-andringar.json räknas som FÖRKLARAT bara om dess lokala definition har
   exakt den registrerade md5:n; annars är det OFÖRKLARAT. Generera/verifiera med
   tests/local/t3-andringar.js. */
const t3Fil = path.join(__dirname, 't3-andringar.json');
const t3 = (fs.existsSync(t3Fil) && !process.env.T3_IGNORERA) ? JSON.parse(fs.readFileSync(t3Fil, 'utf8')).objekt : {};
/* T4-A (2026-11-28): T4:s ändringar registreras separat i t4-andringar.json (relativt läget efter
   T3-E), så att T3-registret är oförändrat och en kedja utan T4 fortfarande jämförs exakt. Ett
   objekt som både T3 och T4 ändrar godtas med T4:s md5 när T4 är installerad, annars med T3:s.
   T4_IGNORERA=1 (eller T3_IGNORERA=1) jämför utan T4-registret. */
const t4Fil = path.join(__dirname, 't4-andringar.json');
const t4 = (fs.existsSync(t4Fil) && !process.env.T3_IGNORERA && !process.env.T4_IGNORERA) ? JSON.parse(fs.readFileSync(t4Fil, 'utf8')).objekt : {};
const md5 = (x) => require('crypto').createHash('md5').update(String(x == null ? '' : x)).digest('hex');

const q = (sql) => JSON.parse(execFileSync('psql', ['-d', DB, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `select coalesce(json_agg(t), '[]') from (${sql}) t`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim());
const ws = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
// SQL utan kommentarer (-- och /* */), med strängar och citerade namn orörda, och med
// normaliserat whitespace. Används för att skilja "samma kod, andra kommentarer" från
// verkliga avvikelser.
function sqlKod(s) {
  s = String(s || ''); let o = '', i = 0;
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (c === '-' && d === '-') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const j = s.indexOf('*/', i + 2); i = j < 0 ? s.length : j + 2; o += ' '; continue; }
    if (c === "'" || c === '"') { let j = i + 1; while (j < s.length) { if (s[j] === c) { if (s[j + 1] === c) { j += 2; continue; } break; } j++; } o += s.slice(i, j + 1); i = j + 1; continue; }
    o += c; i++;
  }
  return o.replace(/\s+/g, ' ').replace(/\s*([(),;=<>+*\/|-])\s*/g, '$1').trim();
}
// PG17 (STAGING) har rättigheten MAINTAIN ('m'); PG16 lokalt saknar den. Den räknas bort i jämförelsen.
const aclSet = (a) => (a == null || a === 'NULL') ? 'DEFAULT' : String(a).replace(/^\{|\}$/g, '').split(',').filter(Boolean)
  .map((x) => x.replace(/^"|"$/g, '').replace(/=([a-zA-Z*]+)\//, (m, p) => '=' + p.replace(/m/g, '') + '/')).sort().join(',');

const lokal = {
  functions: q(`select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def,
      coalesce(p.proacl::text,'NULL') as acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind in ('f','p') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')`),
  policies: q(`select schemaname, tablename, policyname, permissive, roles::text as roles, cmd, qual, with_check from pg_policies where schemaname in ('public','storage')`),
  triggers: q(`select c.relname as "table", t.tgname as name, t.tgenabled as enabled, pg_get_triggerdef(t.oid) as def
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public'`),
  tables: q(`select c.relname as "table", c.relkind as relkind, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls, coalesce(c.relacl::text,'NULL') as acl,
      (select string_agg(a.attname||' '||format_type(a.atttypid,a.atttypmod)||case when a.attnotnull then ' NOT NULL' else '' end||coalesce(' DEFAULT '||pg_get_expr(d.adbin,d.adrelid),''), E'\\n    ' order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as cols,
      (select string_agg(pg_get_constraintdef(co.oid)||' ['||co.conname||']', E'\\n    ' order by co.conname) from pg_constraint co where co.conrelid=c.oid) as constraints,
      (select string_agg(pg_get_indexdef(i.indexrelid), E'\\n    ' order by pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid=c.oid) as indexes
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S')`),
  buckets: q(`select id, name, public, file_size_limit, allowed_mime_types from storage.buckets`),
};

const res = [];
/* T3-C: även policyer och triggers registreras med md5 (tidigare bara funktioner). */
const lokalDef = (typ, key) => {
  if (typ === 'policy') {
    const p = lokal.policies.find((x) => x.schemaname + '.' + x.tablename + '.' + x.policyname === key);
    return p ? md5([p.permissive, p.roles, p.cmd, ws(p.qual), ws(p.with_check)].join('|')) : 'saknas';
  }
  if (typ === 'trigger') {
    const t = lokal.triggers.find((x) => x.table + '.' + x.name === key);
    return t ? md5(t.def + '|' + t.enabled) : 'saknas';
  }
  if (typ !== 'funktion') return null;
  const f = lokal.functions.find((x) => x.name + '(' + x.args + ')' === key);
  return f ? md5(f.def) + '|' + aclSet(f.acl) : 'saknas';
};
const add = (typ, key, status, detalj) => {
  let k = kanda[typ + ':' + key];
  const t = t3[typ + ':' + key];
  const t4e = t4[typ + ':' + key];
  if (!k && t4e && status !== 'IDENTISK' && status !== 'SAMMA KOD' && t4e.md5 === lokalDef(typ, key)) {
    k = t4e.paket + ' (' + t4e.andring + ', ej installerad i STAGING): ' + t4e.beskrivning;
  }
  if (!k && t && status !== 'IDENTISK' && status !== 'SAMMA KOD') {
    const nu = lokalDef(typ, key);
    if (t.md5 === nu) k = t.paket + ' (' + t.andring + ', ej installerad i STAGING): ' + t.beskrivning;
    /* T3-D: ett objekt som T3-C ändrade och T3-D ändrar igen godtas i T3-C-läget BARA när
       T3_LAGE=T3-C uttryckligen anges (efter en T3-D-rollback eller före T3-D-installationen). */
    else if (process.env.T3_LAGE === 'T3-C' && t.md5_t3c && t.md5_t3c === nu) k = 'T3-C (läge före T3-D, ej installerad i STAGING): ' + t.beskrivning;
    /* T3-E: på samma sätt T3-D-läget (före T3-E eller efter en T3-E-rollback) med T3_LAGE=T3-D. */
    else if (process.env.T3_LAGE === 'T3-D' && t.md5_t3d && t.md5_t3d === nu) k = 'T3-D (läge före T3-E, ej installerad i STAGING): ' + t.beskrivning;
    else detalj = (detalj ? detalj + '; ' : '') + 'registrerad som ' + t.paket + '-ändring men md5/ACL avviker (' + nu + ' ≠ ' + t.md5 + ')';
  }
  const forklarad = status !== 'IDENTISK' && (!!k || status === 'SAMMA KOD');
  const fx = k || (status === 'SAMMA KOD' ? 'Automatiskt: samma kod (repo-källan har kommentarer som inte följde med när STAGING installerades).' : '');
  res.push({ typ, key, status, detalj: detalj || '', forklaring: forklarad ? fx : '', kategori: status === 'IDENTISK' ? 'IDENTISK' : (forklarad ? 'FÖRKLARAD' : 'OFÖRKLARAD') });
};

// Funktioner
const fKey = (f) => f.name + '(' + f.args + ')';
const lf = new Map(lokal.functions.map((f) => [fKey(f), f]));
const sf = new Map(facit.functions.map((f) => [fKey(f), f]));
for (const [k, s] of sf) {
  const l = lf.get(k);
  if (!l) { add('funktion', k, 'SAKNAS LOKALT'); continue; }
  const defOk = l.def === s.def ? 'exakt' : (ws(l.def) === ws(s.def) ? 'whitespace' : (sqlKod(l.def) === sqlKod(s.def) ? 'kod' : null));
  const aclOk = aclSet(l.acl) === aclSet(s.acl);
  if (defOk === 'exakt' && aclOk) add('funktion', k, 'IDENTISK');
  else if (aclOk && defOk) add('funktion', k, 'SAMMA KOD', defOk === 'kod' ? 'skiljer bara i kommentarer och whitespace i funktionskroppen' : 'skiljer bara i whitespace');
  else add('funktion', k, 'AVVIKER', [defOk ? (defOk === 'exakt' ? '' : 'definition lika bara efter whitespace-normalisering') : 'definitionen skiljer', aclOk ? '' : `ACL lokalt ${aclSet(l.acl)} / STAGING ${aclSet(s.acl)}`].filter(Boolean).join('; '));
}
for (const k of lf.keys()) if (!sf.has(k)) add('funktion', k, 'EXTRA LOKALT');

// Policyer
const pKey = (p) => p.schemaname + '.' + p.tablename + '.' + p.policyname;
const lp = new Map(lokal.policies.map((p) => [pKey(p), p]));
const sp = new Map(facit.policies.map((p) => [pKey(p), p]));
for (const [k, s] of sp) {
  const l = lp.get(k);
  if (!l) { add('policy', k, 'SAKNAS LOKALT'); continue; }
  const diff = ['permissive', 'roles', 'cmd', 'qual', 'with_check'].filter((f) => ws(l[f]) !== ws(s[f]));
  if (!diff.length) add('policy', k, 'IDENTISK');
  else add('policy', k, 'AVVIKER', diff.map((f) => `${f}: lokalt «${ws(l[f])}» / STAGING «${ws(s[f])}»`).join('; '));
}
for (const k of lp.keys()) if (!sp.has(k)) add('policy', k, 'EXTRA LOKALT');

// Triggers
const tKey = (t) => t.table + '.' + t.name;
const lt = new Map(lokal.triggers.map((t) => [tKey(t), t]));
const st = new Map(facit.triggers.map((t) => [tKey(t), t]));
for (const [k, s] of st) {
  const l = lt.get(k);
  if (!l) add('trigger', k, 'SAKNAS LOKALT');
  else if (l.def === s.def && l.enabled === s.enabled) add('trigger', k, 'IDENTISK');
  else add('trigger', k, 'AVVIKER', `lokalt «${l.def}» / STAGING «${s.def}»`);
}
for (const k of lt.keys()) if (!st.has(k)) add('trigger', k, 'EXTRA LOKALT');

// Tabeller och sekvenser
const lb = new Map(lokal.tables.map((t) => [t.table, t]));
const sb = new Map(facit.tables.map((t) => [t.table, t]));
const sortLines = (s) => ws(s).split(/ (?=\S+ \[|CREATE )/).sort().join(' | ');
for (const [k, s] of sb) {
  const l = lb.get(k);
  if (!l) { add('tabell', k, 'SAKNAS LOKALT'); continue; }
  const diff = [];
  if (s.relkind !== 'S' && ws(l.cols) !== ws(s.cols)) diff.push(`kolumner: lokalt «${ws(l.cols)}» / STAGING «${ws(s.cols)}»`);
  if (sortLines(l.constraints) !== sortLines(s.constraints)) diff.push(`constraints: lokalt «${ws(l.constraints)}» / STAGING «${ws(s.constraints)}»`);
  if (sortLines(l.indexes) !== sortLines(s.indexes)) diff.push(`index: lokalt «${ws(l.indexes)}» / STAGING «${ws(s.indexes)}»`);
  if (l.rls !== s.rls || l.force_rls !== s.force_rls) diff.push(`RLS lokalt ${l.rls}/${l.force_rls} / STAGING ${s.rls}/${s.force_rls}`);
  if (aclSet(l.acl) !== aclSet(s.acl)) diff.push(`ACL lokalt ${aclSet(l.acl)} / STAGING ${aclSet(s.acl)}`);
  add('tabell', k, diff.length ? 'AVVIKER' : 'IDENTISK', diff.join('; '));
}
for (const k of lb.keys()) if (!sb.has(k)) add('tabell', k, 'EXTRA LOKALT');

// Buckets
const lbk = new Map(lokal.buckets.map((b) => [b.id, b]));
for (const s of facit.buckets) {
  const l = lbk.get(s.id);
  if (!l) { add('bucket', s.id, 'SAKNAS LOKALT'); continue; }
  const same = l.public === s.public && Number(l.file_size_limit) === Number(s.file_size_limit) && JSON.stringify(l.allowed_mime_types) === JSON.stringify(s.allowed_mime_types);
  add('bucket', s.id, same ? 'IDENTISK' : 'AVVIKER', same ? '' : `lokalt ${JSON.stringify(l)} / STAGING ${JSON.stringify(s)}`);
}
for (const k of lbk.keys()) if (!facit.buckets.find((b) => b.id === k)) add('bucket', k, 'EXTRA LOKALT');

// Rapport
const count = (kat, typ) => res.filter((r) => r.kategori === kat && (!typ || r.typ === typ)).length;
const typer = ['funktion', 'policy', 'trigger', 'tabell', 'bucket'];
console.log('Typ        IDENTISK  FÖRKLARAD  OFÖRKLARAD');
for (const t of typer) console.log(t.padEnd(10), String(count('IDENTISK', t)).padStart(8), String(count('FÖRKLARAD', t)).padStart(10), String(count('OFÖRKLARAD', t)).padStart(11));
for (const r of res.filter((x) => x.kategori !== 'IDENTISK')) {
  console.log(`${r.kategori.padEnd(10)} ${r.typ} ${r.key}: ${r.status}${r.detalj ? ' — ' + r.detalj.slice(0, 400) : ''}${r.forklaring ? '\n           förklaring: ' + r.forklaring : ''}`);
}
const t3Ej = Object.keys(t3).filter((k) => !res.find((r) => r.typ + ':' + r.key === k && r.kategori === 'FÖRKLARAD'));
if (t3Ej.length && !process.env.T3_UTAN) console.log('OBS: T3-ändringar som inte syns i databasen (ej installerade här?):', t3Ej.join(', '));
const t4Ej = Object.keys(t4).filter((k) => !res.find((r) => r.typ + ':' + r.key === k && r.kategori === 'FÖRKLARAD'));
if (t4Ej.length && !process.env.T3_UTAN) console.log('OBS: T4-ändringar som inte syns i databasen (ej installerade här?):', t4Ej.join(', '));
const ej = Object.keys(kanda).filter((k) => !res.find((r) => r.typ + ':' + r.key === k && r.kategori === 'FÖRKLARAD'));
if (ej.length) console.log('OBS: förklaringar som inte längre behövs (objektet är identiskt eller finns inte):', ej.join(', '));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log(`RESULT: ${count('IDENTISK')} identiska, ${count('FÖRKLARAD')} förklarade avvikelser, ${count('OFÖRKLARAD')} oförklarade`);
process.exit(count('OFÖRKLARAD') ? 1 : 0);
