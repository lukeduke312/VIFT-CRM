'use strict';
/*
 * MIG-1 (BESLUT-2026-11-28): verifierbar mappning mellan STAGING:s 41 installerade
 * migrationsversioner och repots migrationsfiler.
 *
 *   PGHOST=/var/tmp/vift-localpg PGUSER=postgres node tests/local/migrationsmappning.js [--skriv]
 *
 * Utan --skriv: räknar om allt och jämför med supabase/migrationsmappning.json och
 * supabase/MIGRATIONSMAPPNING.md (avvikelse = FAIL). Med --skriv: skriver om båda filerna.
 *
 * Bevisen:
 *   1. Filer: md5 för varje applicerad SQL (inventering/staging-2026-11-26/migrations-applicerade/,
 *      = STAGING:s md5(array_to_string(statements, E';\n'))) jämförs med repo-filen — exakt
 *      (Supabase CLI:s satsdelning, rå fil eller ÅTERSTÄLLD-innehåll) och normaliserat (utan
 *      kommentarer/whitespace).
 *   2. Objekt: två lokala kedjor i STAGING-ordning — A med repots filer, B med den applicerade
 *      SQL:en (tomma versioner ersatta med kandidaterna, R-A–R-E på sina platser) — och en
 *      katalogögonblicksbild efter varje steg. Objekten per version (funktioner med md5 av
 *      pg_get_functiondef + EXECUTE-ACL, policyer, triggers, tabeller, buckets, scheman) ska vara
 *      desamma i A och B. Rekonstruerade och kandidatobjekt jämförs med STAGING-facit.
 *   3. Beroenden: objekt som en version refererar och som skapats av en tidigare version.
 * Kör ingenting mot Supabase: bara lokal PostgreSQL (unix-socket).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { psql, psqlFile, createDb, dropDb, assertLocal, pgAvailable } = require('./lib/db');
const { cliText, aterstalltInnehall, sqlKod } = require('./lib/sql');

const REPO = path.resolve(__dirname, '..', '..');
const ROT = process.env.VIFT_SERVER_ROOT || path.join(REPO, 'supabase');
const APPL = path.join(ROT, 'inventering', 'staging-2026-11-26', 'migrations-applicerade');
const JSON_UT = path.join(ROT, 'migrationsmappning.json');
const MD_UT = path.join(ROT, 'MIGRATIONSMAPPNING.md');
const FACIT = require('./staging-schema-facit-2026-11-25.json');
const STAGING_SENASTE = '20261124211128';
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const SKRIV = process.argv.includes('--skriv');

const KLASS = {
  installerad: 'installerad – får ALDRIG köras igen',
  ny: 'ny – ej installerad i STAGING',
  rekonstruerad: 'rekonstruerad (R-A–R-E) – objekt finns redan i STAGING, får inte köras som ny',
  kandidat: 'kandidat',
  stagingOnly: 'staging-only',
  forslag: 'förslag – ej applicerat, ingår inte i kedjan',
};
const RKOD = {
  'migrations/20261024000001_rekonstruerad_faktura_revisionskontroll.sql': 'R-A',
  'migrations/20261127000001_rekonstruerad_store_skyddstrigger.sql': 'R-B',
  'migrations/20261127000002_rekonstruerad_time_entry_rpc.sql': 'R-C',
  'migrations/20261127000003_rekonstruerad_store_restrictive_policyer.sql': 'R-D',
  'migrations/20261127000004_rekonstruerad_grants_och_store_policy.sql': 'R-E',
};
const KANDIDATER = ['20261106000002', '20261106000003', '20261108000001'];
const STAGING_ONLY = ['20261117085418', '20261124211128'];

let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m + (d ? '\n        ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 800) : '')); } return !!c; };
const las = (rel) => fs.readFileSync(path.join(ROT, rel), 'utf8');

/* ── 1. Ordning och versioner ─────────────────────────────────── */
function lasOrdning() {
  const steg = [];
  let forra = null;
  for (const rad of fs.readFileSync(path.join(ROT, 'MIGRATIONSORDNING.txt'), 'utf8').split('\n')) {
    const t = rad.trim();
    const m = /^(#\s*)?(\d{14}|REKONSTRUKTION)\s+(\S+)/.exec(t);
    if (!m) continue;
    const komm = !!m[1];
    if (komm && m[3].startsWith('(policydelen')) { steg.push({ version: m[2], rel: forra.rel, del: 2, aktiv: false }); continue; }
    if (komm && !m[3].startsWith('staging-only/')) continue;
    // T3-B: nya migrationer (version efter STAGING:s senaste) är inte installerade i STAGING
    // och ingår inte i MIG-1-mappningen; deras filer klassas som "ny" nedan.
    if (!komm && /^\d{14}$/.test(m[2]) && m[2] > STAGING_SENASTE) continue;
    const s = { version: m[2] === 'REKONSTRUKTION' ? null : m[2], rel: m[3], aktiv: !komm };
    steg.push(s); if (!komm) forra = s;
  }
  return steg;
}

/* ── 2. Katalogögonblicksbild ──────────────────────────────────── */
const SNAP_SQL = `select json_build_object(
 'f', (select coalesce(json_object_agg('funktion:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
        json_build_object('d', pg_get_functiondef(p.oid), 'a', coalesce(p.proacl::text, 'NULL'))), '{}')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind in ('f','p')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
 'p', (select coalesce(json_object_agg('policy:' || schemaname || '.' || tablename || '.' || policyname,
        md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check))), '{}') from pg_policies where schemaname in ('public','storage')),
 't', (select coalesce(json_object_agg('trigger:' || c.relname || '.' || t.tgname, md5(pg_get_triggerdef(t.oid))), '{}')
       from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname = 'public'),
 'r', (select coalesce(json_object_agg('tabell:' || n.nspname || '.' || c.relname, md5(concat_ws('|', c.relkind, c.relrowsecurity, coalesce(c.relacl::text, ''),
        (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || a.attnotnull, ',' order by a.attnum) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
        (select string_agg(pg_get_constraintdef(co.oid), ',' order by co.conname) from pg_constraint co where co.conrelid = c.oid),
        (select string_agg(pg_get_indexdef(i.indexrelid), ',' order by 1) from pg_index i where i.indrelid = c.oid)))), '{}')
       from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p','v','m','S')
       and n.nspname not in ('pg_catalog','information_schema','pg_toast','auth','extensions') and not (n.nspname = 'storage' and c.relname in ('buckets','objects'))),
 'b', (select coalesce(json_object_agg('bucket:' || id, md5(concat_ws('|', public, file_size_limit, allowed_mime_types::text))), '{}') from storage.buckets),
 's', (select coalesce(json_object_agg('schema:' || nspname, '1'), '{}') from pg_namespace where nspname not like 'pg\\_%' and nspname not in ('information_schema','public','auth','storage','extensions'))
)::text`;
function snapshot(db) {
  const j = JSON.parse(psql(db, SNAP_SQL));
  const platt = {}, defs = {};
  for (const [k, v] of Object.entries(j.f)) { platt[k] = md5(v.d) + '|' + v.a; defs[k] = v.d; }
  for (const g of ['p', 't', 'r', 'b', 's']) Object.assign(platt, j[g]);
  return { platt, defs };
}
function delta(fore, efter) {
  const nya = [], andrade = [], borta = [];
  for (const k of Object.keys(efter.platt)) { if (!(k in fore.platt)) nya.push(k); else if (fore.platt[k] !== efter.platt[k]) andrade.push(k); }
  for (const k of Object.keys(fore.platt)) if (!(k in efter.platt)) borta.push(k);
  return { nya: nya.sort(), andrade: andrade.sort(), borta: borta.sort() };
}

/* ── 3. Kedjorna A (repo) och B (applicerad SQL) ───────────────── */
function korKedja(namn, steg, sqlFor) {
  const db = createDb('vift_mig1_' + process.pid + '_' + namn);
  try {
    psqlFile(db, path.join(REPO, 'tests', 'local', 'supabase-stubbar.sql'));
    psql('postgres', `alter database ${db} set search_path = "$user", public, extensions`);
    const forst = snapshot(db);
    let snap = forst;
    const ut = [];
    for (const s of steg) {
      const sql = sqlFor(s);
      if (sql !== null) {
        const tmp = path.join(require('os').tmpdir(), `vift-mig1-${process.pid}.sql`);
        fs.writeFileSync(tmp, sql);
        try { psqlFile(db, tmp); } catch (e) { throw new Error(`kedja ${namn}: ${s.rel}${s.del ? ' del ' + s.del : ''} fallerade: ${e.message}`); } finally { fs.unlinkSync(tmp); }
      }
      const ny = snapshot(db);
      ut.push({ steg: s, fore: snap, efter: ny, delta: delta(snap, ny) });
      snap = ny;
    }
    return { per: ut, slut: snap };
  } finally { dropDb(db); }
}

function main() {
  assertLocal();
  if (!pgAvailable()) { console.log('RESULT: 0 passed, 0 failed (HOPPAS ÖVER — ingen lokal PostgreSQL; INTE godkänt, inte kört)'); process.exit(0); }
  const steg = lasOrdning();
  const appl = fs.readdirSync(APPL).filter((f) => f.endsWith('.sql')).sort();
  const applMap = new Map(appl.map((f) => [f.slice(0, 14), { fil: f, namn: f.slice(15, -4), sql: fs.readFileSync(path.join(APPL, f), 'utf8') }]));
  ok(appl.length === 41, '41 installerade STAGING-versioner i migrations-applicerade/');

  // Versioner → repo-filer
  const repoFor = new Map();
  for (const s of steg) if (s.version) { if (!repoFor.has(s.version)) repoFor.set(s.version, []); repoFor.get(s.version).push(s); }
  ok([...applMap.keys()].every((v) => repoFor.has(v)), 'varje installerad version har minst en repo-fil (MIGRATIONSORDNING.txt)', [...applMap.keys()].filter((v) => !repoFor.has(v)));
  ok([...repoFor.keys()].every((v) => applMap.has(v)), 'varje version i MIGRATIONSORDNING.txt finns installerad i STAGING');

  // Kedja A: repots filer. Kedja B: applicerad SQL (tom → kandidat; delad version körs i sina delar).
  const repoSql = (s) => (s.del === 2 ? null : las(s.rel));
  const applSql = (s) => {
    if (!s.version) return las(s.rel); // R-A–R-E
    const a = applMap.get(s.version);
    if (a.sql.length === 0) return las(s.rel); // tom i STAGING → kandidaten (INVENTERING §7.1)
    const forsta = repoFor.get(s.version)[0];
    return forsta === s ? a.sql + '\n;\n' : null; // flera repo-filer → applicerad SQL en gång
  };
  const A = korKedja('a', steg, repoSql);
  ok(true, `kedja A (repo-filer, STAGING-ordning inkl. STAGING-only): ${steg.length} steg utan fel`);
  const B = korKedja('b', steg, applSql);
  ok(true, `kedja B (applicerad STAGING-SQL, kandidater för tomma, R-A–R-E på plats): ${steg.length} steg utan fel`);

  /* Grupper: versioner som delar repo-fil (20261124210432 + 20261124210747) och versioner med
     flera repo-filer (20261124160425) jämförs som en helhet: läget före gruppens första steg
     mot läget efter dess sista steg. Mellanlägen (en fil ersätter en annan) räknas inte. */
  const gruppAv = new Map();
  steg.forEach((s, i) => {
    const k = s.version || s.rel;
    const tidigare = steg.slice(0, i).find((x) => x.rel === s.rel || (x.version && x.version === s.version));
    gruppAv.set(i, tidigare ? gruppAv.get(steg.indexOf(tidigare)) : k);
  });
  const objPer = (kedja) => {
    const m = new Map();
    const grupper = new Map();
    kedja.per.forEach((p, i) => { const g = gruppAv.get(i); if (!grupper.has(g)) grupper.set(g, []); grupper.get(g).push(p); });
    for (const [g, ps] of grupper) {
      const d = delta(ps[0].fore, ps[ps.length - 1].efter);
      for (const p of ps) m.set(p.steg.version || p.steg.rel, { grupp: g, gruppDelta: d, egetDelta: p.delta });
    }
    return m;
  };
  const objA = objPer(A), objB = objPer(B);
  // Senaste definierande version per objekt (för "ersätter"/beroenden)
  const forstSkapad = new Map();
  A.per.forEach(({ steg: s, delta: d }, i) => d.nya.forEach((o) => { if (!forstSkapad.has(o)) forstSkapad.set(o, { v: s.version || RKOD[s.rel], i }); }));
  const forstaSteg = (nyckel) => steg.findIndex((x) => x.version === nyckel || x.rel === nyckel);

  const sammaKod = (k) => (A.slut.defs[k] && B.slut.defs[k] && sqlKod(A.slut.defs[k]) === sqlKod(B.slut.defs[k]));
  const facitF = new Map(FACIT.functions.map((f) => ['funktion:' + f.name + '(' + f.args + ')', f]));
  const facitP = new Set(FACIT.policies.map((p) => 'policy:' + p.schemaname + '.' + p.tablename + '.' + p.policyname));
  const facitT = new Set(FACIT.triggers.map((t) => 'trigger:' + t.table + '.' + t.name));
  const iStaging = (o) => {
    if (o.startsWith('funktion:')) { const f = facitF.get(o); return !!f && (md5(f.def) === md5(A.slut.defs[o] || '') || sqlKod(f.def) === sqlKod(A.slut.defs[o] || '')); }
    if (o.startsWith('policy:')) return facitP.has(o);
    if (o.startsWith('trigger:')) return facitT.has(o);
    if (o.startsWith('tabell:public.')) return FACIT.tables.some((t) => 'tabell:public.' + t.table === o);
    if (o.startsWith('bucket:')) return FACIT.buckets.some((b) => 'bucket:' + b.id === o);
    return true;
  };

  const namnRef = (o) => { const m = /^(?:funktion|tabell):(?:public\.)?([A-Za-z0-9_]+)/.exec(o); return m ? m[1] : null; };
  function beroenden(version, text, egna, fran) {
    const res = new Set();
    for (const [o, { v, i }] of forstSkapad) {
      if (v === version || egna.has(o) || i >= fran) continue;
      const n = namnRef(o); if (!n || n.length < 5) continue;
      if (new RegExp('\\b' + n + '\\b').test(text)) res.add(v);
    }
    return [...res].filter(Boolean).sort();
  }

  // ── Per installerad version ──
  const versioner = [];
  for (const [v, a] of applMap) {
    const filer = repoFor.get(v);
    const rels = [...new Set(filer.map((s) => s.rel))];
    const innehall = rels.map((r) => { const s = las(r); const at = aterstalltInnehall(s); return { r, s, at }; });
    let exakt = null;
    const tom = a.sql.length === 0;
    if (!tom) {
      if (rels.length === 1) {
        const { s, at } = innehall[0];
        if (at !== null && md5(at) === md5(a.sql)) exakt = 'återställd (innehållet efter INNEHÅLL = applicerad SQL)';
        else if (md5(s) === md5(a.sql)) exakt = 'rå fil = applicerad SQL';
        else if (md5(cliText(s)) === md5(a.sql)) exakt = 'Supabase CLI-satsdelning av filen = applicerad SQL';
        else if (filer.some((x) => x.del === 2) || (repoFor.get(v).length === 1 && steg.some((x) => x.del === 2 && x.rel === rels[0]))) {
          const delar = steg.filter((x) => x.rel === rels[0]).map((x) => applMap.get(x.version).sql);
          if (md5(cliText(s)) === md5(delar.join(';\n'))) exakt = 'CLI-satsdelning av filen = applicerad SQL i två versioner (del 1 + del 2)';
        }
      }
    }
    const repoText = innehall.map((x) => (x.at !== null ? x.at : x.s)).join('\n;\n');
    let norm = null;
    if (!tom) {
      const delad = steg.filter((x) => rels.length === 1 && x.rel === rels[0] && x.version).map((x) => x.version);
      const applText = delad.length > 1 ? delad.map((x) => applMap.get(x).sql).join(';\n') : a.sql;
      norm = md5(sqlKod(applText)) === md5(sqlKod(repoText));
    }
    const ga = objA.get(v), gb = objB.get(v);
    const nycklar = (o) => JSON.stringify([o.nya, o.andrade, o.borta].map((x) => [...new Set(x)].sort()));
    let objLika = nycklar(ga.gruppDelta) === nycklar(gb.gruppDelta);
    // Objekt per version: den applicerade SQL:ens (kedja B) eget steg — vilken version som faktiskt installerade vad.
    const helGrupp = steg.filter((x, i) => gruppAv.get(i) === gb.grupp).every((x) => x.version === v);
    const oa = helGrupp ? gb.gruppDelta : gb.egetDelta;
    const skillnadKod = [];
    if (objLika) {
      // samma objektnycklar; jämför dessutom definitionerna (efter steget) via slutläget
      for (const o of [...oa.nya, ...oa.andrade]) if (o.startsWith('funktion:') && A.slut.defs[o] !== B.slut.defs[o]) skillnadKod.push(o);
    }
    const egna = new Set([...oa.nya, ...oa.andrade]);
    const klass = STAGING_ONLY.includes(v) ? 'stagingOnly' : KANDIDATER.includes(v) ? 'kandidat' : 'installerad';
    const harStop = /STOP/.test(repoText) && /md5/i.test(repoText);
    versioner.push({
      version: v, appliceratNamn: a.namn, repoFiler: rels, del: filer.some((x) => x.del === 2) ? 2 : (steg.some((x) => x.del === 2 && rels.includes(x.rel)) ? 1 : undefined),
      md5Applicerad: md5(a.sql), tomIStaging: tom, exaktMatchning: exakt, normaliseradLika: norm,
      klass: KLASS[klass], klassKod: klass,
      objekt: { nya: [...new Set(oa.nya)].sort(), andrade: [...new Set(oa.andrade)].sort(), borttagna: [...new Set(oa.borta)].sort() },
      objektLikaMedAppliceradSql: objLika, jamfordSomGrupp: ga.grupp !== v ? ga.grupp : (steg.filter((x) => x.version === v).length > 1 || steg.some((x, i) => gruppAv.get(i) === v && x.version !== v) ? v : undefined), kommentarsskillnad: skillnadKod.sort(),
      objektIStagingFacit: klass === 'kandidat' ? [...egna].every(iStaging) : undefined,
      beroenden: beroenden(v, repoText, egna, forstaSteg(v)), stopKontroll: harStop || undefined,
    });
  }

  // ── Per repo-fil ──
  const repoFiler = [];
  const migFiler = fs.readdirSync(path.join(ROT, 'migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => 'migrations/' + f);
  const soFiler = fs.readdirSync(path.join(ROT, 'staging-only', 'migrations')).filter((f) => f.endsWith('.sql')).sort().map((f) => 'staging-only/migrations/' + f);
  const forslag = fs.existsSync(path.join(ROT, 'forslag-ej-applicerade')) ? fs.readdirSync(path.join(ROT, 'forslag-ej-applicerade')).filter((f) => f.endsWith('.sql')).sort().map((f) => 'forslag-ej-applicerade/' + f) : [];
  for (const rel of [...migFiler, ...soFiler, ...forslag]) {
    const s = las(rel);
    const vs = steg.filter((x) => x.rel === rel && x.version).map((x) => x.version);
    let klass;
    if (rel.startsWith('forslag-')) klass = 'forslag';
    else if (RKOD[rel]) klass = 'rekonstruerad';
    else if (vs.length) klass = vs.some((x) => STAGING_ONLY.includes(x)) ? 'stagingOnly' : vs.some((x) => KANDIDATER.includes(x)) ? 'kandidat' : 'installerad';
    else klass = 'ny';
    const post = { fil: rel, md5: md5(s), stagingVersioner: vs, klass: KLASS[klass], klassKod: klass };
    if (klass === 'rekonstruerad') {
      post.rKod = RKOD[rel];
      const o = objA.get(rel).egetDelta;
      post.objekt = { nya: [...new Set(o.nya)].sort(), andrade: [...new Set(o.andrade)].sort(), borttagna: [...new Set(o.borta)].sort() };
      post.objektIStagingFacit = [...o.nya, ...o.andrade].every(iStaging);
      post.objektLikaIKedjaB = JSON.stringify(objA.get(rel).egetDelta) === JSON.stringify(objB.get(rel).egetDelta);
      const egna = new Set([...o.nya, ...o.andrade]);
      post.beroenden = beroenden(RKOD[rel], s, egna, forstaSteg(rel));
    }
    if (klass === 'ny') { const fv = (/^migrations\/(\d{14})_/.exec(rel) || [])[1]; post.versionEfterStaging = !!fv && fv > STAGING_SENASTE; }
    repoFiler.push(post);
  }

  // ── Slutläge A = B ──
  const allaK = new Set([...Object.keys(A.slut.platt), ...Object.keys(B.slut.platt)]);
  const slutDiff = [], slutSammaKod = [];
  for (const k of allaK) {
    if (A.slut.platt[k] === B.slut.platt[k]) continue;
    if (k.startsWith('funktion:') && sammaKod(k) && A.slut.platt[k].split('|')[1] === B.slut.platt[k].split('|')[1]) slutSammaKod.push(k); else slutDiff.push(k);
  }

  const resultat = {
    beskrivning: 'MIG-1: mappning STAGING-version ↔ repo-fil. Genererad av tests/local/migrationsmappning.js --skriv; ändra inte för hand.',
    stagingSenasteVersion: STAGING_SENASTE,
    kalla: { applicerad: 'supabase/inventering/staging-2026-11-26/migrations-applicerade/ (STAGING, läst 2026-11-25)', ordning: 'supabase/MIGRATIONSORDNING.txt', facit: 'tests/local/staging-schema-facit-2026-11-25.json' },
    sammanfattning: {
      installeradeVersioner: versioner.length,
      perKlass: Object.fromEntries(Object.keys(KLASS).map((k) => [k, versioner.filter((x) => x.klassKod === k).length])),
      exaktMd5: versioner.filter((x) => x.exaktMatchning).length,
      normaliseradLikaUtanExakt: versioner.filter((x) => !x.exaktMatchning && x.normaliseradLika).length,
      tommaIStaging: versioner.filter((x) => x.tomIStaging).length,
      objektLikaAB: versioner.filter((x) => x.objektLikaMedAppliceradSql).length,
      repoFilerPerKlass: Object.fromEntries(Object.keys(KLASS).map((k) => [k, repoFiler.filter((x) => x.klassKod === k).length])),
      slutlageAB: { skillnader: slutDiff.sort(), sammaKodAndraKommentarer: slutSammaKod.sort() },
    },
    versioner, repoFiler,
  };

  // ── Kontroller ──
  const S = resultat.sammanfattning;
  ok(S.perKlass.installerad === 36 && S.perKlass.kandidat === 3 && S.perKlass.stagingOnly === 2, `klassning av de 41 versionerna: ${S.perKlass.installerad} installerade, ${S.perKlass.kandidat} kandidater (tomma i STAGING), ${S.perKlass.stagingOnly} STAGING-only`);
  ok(migFiler.every((f) => repoFiler.filter((x) => x.fil === f).length === 1), `alla ${migFiler.length} filer i migrations/ klassade exakt en gång (${S.repoFilerPerKlass.installerad} installerade, ${S.repoFilerPerKlass.kandidat} kandidater, ${S.repoFilerPerKlass.rekonstruerad} rekonstruerade, ${S.repoFilerPerKlass.ny} nya)`);
  const huvudMd5 = repoFiler.filter((x) => /ÅTERSTÄLLD/.test(las(x.fil).slice(0, 400))).map((x) => { const m = /md5 ([0-9a-f]{32})/.exec(las(x.fil).slice(0, 900)); const v = versioner.find((y) => y.repoFiler.includes(x.fil)); return { fil: x.fil, ok: !!m && !!v && m[1] === v.md5Applicerad }; });
  ok(huvudMd5.length === 18 && huvudMd5.every((x) => x.ok), `md5 i huvudet på de ${huvudMd5.length} ÅTERSTÄLLDA filerna = md5 av applicerad STAGING-SQL`, huvudMd5.filter((x) => !x.ok));
  const ejTomma = versioner.filter((x) => !x.tomIStaging);
  const utanExakt = ejTomma.filter((x) => !x.exaktMatchning);
  ok(S.exaktMd5 + utanExakt.length === 38, `exakt md5 för ${S.exaktMd5} av 38 icke-tomma versioner; övriga ${utanExakt.length}: ${utanExakt.map((x) => x.version).join(', ')}`);
  ok(utanExakt.every((x) => x.normaliseradLika || x.objektLikaMedAppliceradSql), 'varje version utan exakt md5 har normaliserat samma kod eller samma objekt som den applicerade SQL:en', utanExakt.filter((x) => !(x.normaliseradLika || x.objektLikaMedAppliceradSql)).map((x) => x.version));
  ok(versioner.every((x) => x.objektLikaMedAppliceradSql), `objektjämförelse per version: kedja A (repo) och B (applicerad SQL) skapar/ändrar samma objekt för ${S.objektLikaAB}/41 versioner`, versioner.filter((x) => !x.objektLikaMedAppliceradSql).map((x) => x.version));
  ok(slutDiff.length === 0, `slutläge A = B (${allaK.size} objekt); ${slutSammaKod.length} funktioner skiljer bara i kommentarer: ${slutSammaKod.map((k) => k.replace(/\(.*/, '')).join(', ')}`, slutDiff);
  const rf = repoFiler.filter((x) => x.klassKod === 'rekonstruerad');
  ok(rf.length === 5 && rf.every((x) => x.objektIStagingFacit), 'R-A–R-E: alla objekt de skapar/ändrar finns redan i STAGING (facit) — får inte köras som nya mot STAGING', rf.filter((x) => !x.objektIStagingFacit).map((x) => x.rKod));
  ok(versioner.filter((x) => x.klassKod === 'kandidat').every((x) => x.objektIStagingFacit), 'kandidaterna: objekten finns identiskt i STAGING (men att just den SQL:en kördes är obevisat)');
  ok(repoFiler.filter((x) => x.klassKod === 'ny').every((x) => x.versionEfterStaging), 'nya (ej installerade) filer har versionsnummer efter STAGING:s senaste ' + STAGING_SENASTE, repoFiler.filter((x) => x.klassKod === 'ny').map((x) => x.fil));
  const avvikandeNamn = versioner.filter((x) => x.repoFiler.some((f) => !path.basename(f).startsWith(x.version)));
  ok(true, `${avvikandeNamn.length} installerade versioner har repo-filer med ANNAT versionsnummer i filnamnet (supabase db push skulle se dem som nya): ${avvikandeNamn.map((x) => x.version).join(', ')}`);
  resultat.sammanfattning.annatFilnamnsnummer = avvikandeNamn.map((x) => ({ version: x.version, filer: x.repoFiler }));

  const md = skrivMd(resultat);
  const json = JSON.stringify(resultat, null, 1) + '\n';
  if (SKRIV) {
    fs.writeFileSync(JSON_UT, json); fs.writeFileSync(MD_UT, md);
    console.log('Skrev ' + path.relative(REPO, JSON_UT) + ' och ' + path.relative(REPO, MD_UT));
  } else {
    const finnsJ = fs.existsSync(JSON_UT) ? fs.readFileSync(JSON_UT, 'utf8') : '';
    const finnsM = fs.existsSync(MD_UT) ? fs.readFileSync(MD_UT, 'utf8') : '';
    ok(finnsJ === json, 'supabase/migrationsmappning.json är aktuell (kör med --skriv efter ändringar i migrationerna)');
    ok(finnsM === md, 'supabase/MIGRATIONSMAPPNING.md är aktuell');
  }
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

function kort(o) { return o.replace(/^funktion:/, '').replace(/^(policy|trigger|tabell|bucket|schema):/, '$1 '); }
function skrivMd(r) {
  const S = r.sammanfattning;
  const rad = (x) => `| ${x.version} | \`${x.appliceratNamn}\` | ${x.repoFiler.map((f) => '`' + f + '`').join('<br>')}${x.del ? ' (del ' + x.del + ')' : ''} | \`${x.md5Applicerad.slice(0, 8)}\` | ${x.tomIStaging ? 'tom i STAGING' : x.exaktMatchning ? 'exakt: ' + x.exaktMatchning.split(' (')[0] : (x.normaliseradLika ? 'samma kod (normaliserat)' : 'samma objekt, annan form')} | ${x.klass} | ${[...x.objekt.nya.map(kort), ...x.objekt.andrade.map((o) => kort(o) + ' (ändras)')].join(', ') || '–'} | ${x.beroenden.join(', ') || '–'}${x.stopKontroll ? ' · STOP-kontroll' : ''} |`;
  return `# MIG-1: migrationsmappning STAGING ↔ repo

**Genererad av \`tests/local/migrationsmappning.js --skriv\`. Ändra inte för hand.** Maskinläsbar
version: \`supabase/migrationsmappning.json\`. Installationsunderlag:
\`supabase/INSTALLATIONSUNDERLAG-MIGRATIONER.md\`.

Källor: ${r.kalla.applicerad}; ordning ${r.kalla.ordning}; facit ${r.kalla.facit}.
Verifiering: \`node tests/local/migrationsmappning.js\` (lokal PostgreSQL, ingen kontakt med Supabase).

## Sammanfattning

- Installerade STAGING-versioner: **${S.installeradeVersioner}** (senaste ${r.stagingSenasteVersion}):
  ${S.perKlass.installerad} installerade, ${S.perKlass.kandidat} kandidater (tomma i STAGING), ${S.perKlass.stagingOnly} STAGING-only.
- Filinnehåll: **${S.exaktMd5}** av 38 icke-tomma versioner har exakt md5-matchning mot repo-filen.
  ${S.normaliseradLikaUtanExakt} har samma kod efter normalisering (kommentarer/whitespace). Resten har samma objekt i en annan form.
- Objekt: kedja A (repo-filer) och kedja B (applicerad SQL) ger samma objekt för **${S.objektLikaAB}/41** versioner.
  Slutläget är identiskt utom ${S.slutlageAB.sammaKodAndraKommentarer.length} funktioner som bara skiljer i kommentarer.
- Repo-filer: ${Object.entries(S.repoFilerPerKlass).map(([k, n]) => k + ' ' + n).join(', ')}.
- **${S.annatFilnamnsnummer.length} versioner har repo-filer med ett annat versionsnummer i filnamnet.**
  En \`supabase db push\` mot STAGING skulle se dem som nya. Därför ska aldrig \`db push\` köras mot STAGING utan beslut. Se installationsunderlaget.

## Klassning

| Klass | Betydelse |
|---|---|
| ${KLASS.installerad} | Versionen finns i STAGING:s \`schema_migrations\`. SQL:en får aldrig köras igen mot STAGING. |
| ${KLASS.kandidat} | Versionen är registrerad men tom i STAGING. Repo-filen återger driftobjekten exakt, men att det var den SQL:en som kördes är obevisat. Får aldrig köras mot STAGING. |
| ${KLASS.rekonstruerad} | Ingen STAGING-version. Objekten finns redan i STAGING (installerade utanför migrationerna). Körs bara i en ny tom databas (LIVE/replik). |
| ${KLASS.stagingOnly} | Bara STAGING (backup och e2e-verktyg). Aldrig LIVE. |
| ${KLASS.ny} | Ny ändring som inte finns i STAGING. Versionsnumret måste vara efter ${r.stagingSenasteVersion}. |
| ${KLASS.forslag} | Ligger i \`forslag-ej-applicerade/\` och ingår inte i kedjan. |

## Per installerad STAGING-version

| Version | Applicerat namn | Repo-fil(er) | md5 (appl.) | Innehåll | Klass | Objekt (nya; ändrade) | Beroenden |
|---|---|---|---|---|---|---|---|
${r.versioner.map(rad).join('\n')}

## Rekonstruerade filer (ingen STAGING-version)

| R | Fil | Objekt | Finns i STAGING | Samma i kedja B | Beroenden |
|---|---|---|---|---|---|
${r.repoFiler.filter((x) => x.klassKod === 'rekonstruerad').map((x) => `| ${x.rKod} | \`${x.fil}\` | ${[...x.objekt.nya.map(kort), ...x.objekt.andrade.map((o) => kort(o) + ' (ändras)'), ...x.objekt.borttagna.map((o) => kort(o) + ' (tas bort)')].join(', ')} | ${x.objektIStagingFacit ? 'ja' : '**nej**'} | ${x.objektLikaIKedjaB ? 'ja' : 'nej'} | ${x.beroenden.join(', ') || '–'} |`).join('\n')}

## Alla repo-filer

| Fil | md5 | STAGING-version(er) | Klass |
|---|---|---|---|
${r.repoFiler.map((x) => `| \`${x.fil}\` | \`${x.md5.slice(0, 8)}\` | ${x.stagingVersioner.join(', ') || '–'} | ${x.klass} |`).join('\n')}

## Repo-filer vars filnamn inte bär STAGING-versionen

${S.annatFilnamnsnummer.map((x) => `- ${x.version}: ${x.filer.map((f) => '`' + f + '`').join(', ')}`).join('\n')}
`;
}

main();
