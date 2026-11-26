'use strict';
/*
 * T3-E (2026-11-28, M9): standardrollerna och behörighetskatalogen i klienten.
 *
 *  1. Inga säkerhetsbeslut på rollnamn (BESLUT-2026-11-27 grundprincipen, BESLUT-2026-11-28 T3-E):
 *     grep över klienten (src/) och servern (Edge Functions och T3-migrationerna i den
 *     auktoritativa källan, tests/lib/serverkalla.js) efter jämförelser och förval med
 *     standardrollernas id. Bara uttryckligt tillåtna FÖRVAL (dashboardlayout, förvald roll för
 *     ny personal, importmappning; BEHORIGHETSMATRIS §0.2) godtas, och ingen av dem får stå på
 *     samma rad som en behörighetskontroll. Varje ny träff underkänns.
 *  2. Ej verkställda behörigheter (tillägget i BESLUT-2026-11-28): klienten använder dem inte
 *     till någon vy eller knapp (de förekommer bara i rolleditorns katalog och i demorollerna);
 *     listan i rolleditorn = serverns _vift_ej_verkstallda() = standardroller.json = fake-backend.
 *  3. Rolleditorns katalog innehåller alla behörigheter i matrisen (§1.1, §2) med beskrivning.
 *  4. Demorollerna (seedData, även fake-backendens seed) = standardroller.json = matrisen §2.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { serverRoot } = require('./lib/serverkalla');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m, d) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m + (d ? '\n        ' + JSON.stringify(d).slice(0, 800) : '')); } };
const SROT = serverRoot();
const DEF = JSON.parse(fs.readFileSync(path.join(SROT, 'manual', 't3e_standardroller', 'standardroller.json'), 'utf8'));
const EJV = Object.keys(DEF.ejVerkstallda).sort();
const NAMN = ['admin', 'chef', 'ekonomi', 'personal', 'begransad'];

const filerI = (dir, re) => { const ut = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (re.test(e.name)) ut.push(p); } })(dir); return ut; };
const arKommentar = (l) => /^\s*(\/\/|\*|\/\*|--)/.test(l);

// ════════════════ 1. Rollnamn ════════════════
/* Jämförelse eller förval med ett standardroll-id på en rad som handlar om roll. */
const RE = new RegExp(`['"](${NAMN.join('|')})['"]`);
const ROLLRAD = /\brole(Id|_id)?\b|\.role\b|role\s*[:=]/i;
/* Tillåtna förval (BEHORIGHETSMATRIS §0.2: "Rollnamn får bara styra förval i gränssnittet").
   Nyckel: fil + exakt radinnehåll (trimmat). Motivering krävs. */
const TILLATNA = {
  'src/data/DashboardConfig.js|const role = roleId || \'personal\';': 'dashboardlayout: förvald layout när roll saknas (presentation)',
  'src/pages/Dashboard.js|const roleId = user ? user.role : \'personal\';': 'dashboardlayout (presentation)',
  'src/pages/Dashboard.js|const roleId = user.role || \'personal\';': 'dashboardlayout (presentation, två ställen)',
  'src/data/schema.js|role: \'personal\',         // admin | chef | personal': 'förvald roll i fabriken för ny personalpost; servern prövar tilldelningen (T3-C eskaleringsregel)',
  'src/pages/PageShells.js|const defRole = s ? (s.role || \'\') : ((displayRoles.find(r => r.id === \'personal\') || displayRoles[0] || {}).id || \'\');': 'personaldialogen: förvalt rollval för ny personal (användaren väljer, servern prövar)',
  'src/pages/PageShells.js|role: document.getElementById(\'sf-role\')?.value || \'personal\',': 'personaldialogen: förval om fältet saknas (servern prövar tilldelningen)',
  'src/services/ImportExportConfigs.js|obj.role = (r === \'chef\' || r === \'manager\') ? \'chef\' : \'personal\';': 'importmappning av rollkolumnen (admin_manage; servern prövar tilldelningen)',
  'src/services/ImportExportConfigs.js|} else { obj.role = \'personal\'; }': 'importmappning: förval (servern prövar tilldelningen)',
};
const traffar = [];
for (const f of filerI(path.join(ROOT, 'src'), /\.js$/)) {
  const rel = path.relative(ROOT, f);
  if (rel === 'src/data/seedData.js') continue; // demodata (rollerna själva), prövas i punkt 4
  fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    if (arKommentar(l) || !RE.test(l) || !ROLLRAD.test(l)) return;
    traffar.push({ rel, rad: i + 1, text: l.trim() });
  });
}
const otillatna = traffar.filter((t) => !TILLATNA[t.rel + '|' + t.text]);
ok(otillatna.length === 0, 'klienten: inga jämförelser eller förval med standardrollernas id utöver de uttryckligt tillåtna förvalen (dashboardlayout, ny personal, import)', otillatna.map((t) => t.rel + ':' + t.rad + ' ' + t.text));
ok(traffar.every((t) => !/Auth\.(can|canAny|isSuperadmin)|hasPerm|PAGE_PERMISSIONS/.test(t.text)), 'klienten: inget av de tillåtna förvalen står på en rad med en behörighetskontroll');
const anvanda = new Set(traffar.map((t) => t.rel + '|' + t.text));
ok(Object.keys(TILLATNA).every((k) => anvanda.has(k)), 'listan över tillåtna förval är aktuell (varje post finns i koden)', Object.keys(TILLATNA).filter((k) => !anvanda.has(k)));
const besl = [];
for (const f of filerI(path.join(ROOT, 'src'), /\.js$/)) {
  const rel = path.relative(ROOT, f);
  fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    if (arKommentar(l)) return;
    if (new RegExp(`(role|roleId|\\.role)\\s*(===|!==|==|!=)\\s*['"](${NAMN.join('|')})['"]|['"](${NAMN.join('|')})['"]\\s*(===|!==|==|!=)\\s*[\\w.]*role\\b|\\.id\\s*===\\s*['"]admin['"]`).test(l) && !/displayRoles\.find\(r => r\.id === 'personal'\)/.test(l)) besl.push(rel + ':' + (i + 1) + ' ' + l.trim());
  });
}
ok(besl.length === 0, 'klienten: ingen jämförelse role === \'admin\'/\'chef\'/\'personal\'/… eller roll-id === \'admin\' någonstans (superadmin = behörigheten all, Auth.isSuperadmin)', besl);
const serverTraff = [];
const sre = new RegExp(`(role(_id|Id)?|\\.role|->>'role')\\s*(===|!==|==|!=|=|<>)\\s*['"](${NAMN.join('|')})['"]|['"](${NAMN.join('|')})['"]\\s*(===|!==|==|!=|=|<>)\\s*[\\w.]*role\\b`, 'i');
for (const f of filerI(path.join(SROT, 'functions'), /\.ts$/)) fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (!arKommentar(l) && sre.test(l)) serverTraff.push(path.relative(SROT, f) + ':' + (i + 1) + ' ' + l.trim()); });
const nya = fs.readFileSync(path.join(SROT, 'MIGRATIONSORDNING.txt'), 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => /^\d{14}$/.test(p[0]) && p[0] > '20261124211128').map((p) => p[1]);
for (const rel of nya) fs.readFileSync(path.join(SROT, rel), 'utf8').split('\n').forEach((l, i) => { if (!arKommentar(l) && sre.test(l)) serverTraff.push(rel + ':' + (i + 1) + ' ' + l.trim()); });
ok(nya.length >= 9 && nya.filter((x) => /_t3[a-e]_/.test(x)).length === 8 && nya.some((x) => /_t4a_/.test(x)) && serverTraff.length === 0, 'servern (auktoritativ källa): inga säkerhetsbeslut på rollnamn i Edge Functions eller i de 8 T3-migrationerna och T4-migrationerna (' + nya.length + ')', serverTraff);

// ════════════════ 2. Ej verkställda behörigheter ════════════════
const ps = fs.readFileSync(path.join(ROOT, 'src/pages/PageShells.js'), 'utf8');
const ejvKlient = (() => { const m = /_PERM_EJ_VERKSTALLD:\s*\{([\s\S]*?)\n\s*\},/.exec(ps); return m ? Array.from(m[1].matchAll(/'([a-z_]+)'\s*:/g)).map((x) => x[1]).sort() : []; })();
ok(ejvKlient.join() === EJV.join(), 'rolleditorns _PERM_EJ_VERKSTALLD = standardroller.json ejVerkstallda (= serverns _vift_ej_verkstallda, kontrollerat i vift-v2)', ejvKlient);
const { T3E_EJ_VERKSTALLDA } = require('./e2e/fake-backend.js');
ok(T3E_EJ_VERKSTALLDA.slice().sort().join() === EJV.join(), 'fake-backendens T3E_EJ_VERKSTALLDA = samma lista (paritet)');
const katStart = ps.indexOf('  _PERMISSIONS: [');
const katSlut = ps.indexOf('  openEditRole(roleId) {');
const ejvAnv = [];
for (const f of filerI(path.join(ROOT, 'src'), /\.js$/)) {
  const rel = path.relative(ROOT, f);
  const t = fs.readFileSync(f, 'utf8');
  t.split('\n').forEach((l, i) => {
    if (arKommentar(l)) return;
    for (const e of EJV) {
      if (!l.includes("'" + e + "'") && !l.includes('"' + e + '"')) continue;
      const pos = t.split('\n').slice(0, i).join('\n').length;
      const iKatalog = rel === 'src/pages/PageShells.js' && pos >= katStart && pos < katSlut;
      if (!iKatalog && rel !== 'src/data/seedData.js') ejvAnv.push(rel + ':' + (i + 1) + ' ' + e);
    }
  });
}
ok(ejvAnv.length === 0, 'klienten använder ingen ej verkställd behörighet utanför rolleditorns katalog och demorollerna — ingen vy, meny eller knapp visas som om den fungerade', ejvAnv);
/* T4-A: listan följer registret (cost_view, cost_edit, personal_data_view, bankgiro_edit är verkställda och får användas). */
ok(!new RegExp(`Auth\\.can(Any)?\\(\\s*\\[?\\s*['"](${EJV.join('|')})`).test(filerI(path.join(ROOT, 'src'), /\.js$/).map((f) => fs.readFileSync(f, 'utf8')).join('\n')), 'inget Auth.can/canAny på en ej verkställd behörighet');

// ════════════════ 3. Katalogen ════════════════
const katalog = ps.slice(katStart, katSlut);
const grupper = (() => { const m = /_PERM_GROUPS:\s*\[([\s\S]*?)\n\s*\],/.exec(katalog); return m ? Array.from(m[1].matchAll(/'([a-z_]+)'/g)).map((x) => x[1]) : []; })();
const etiketter = (() => { const m = /_PERM_LABELS:\s*\{([\s\S]*?)\n\s*\},/.exec(katalog); return m ? Object.fromEntries(Array.from(m[1].matchAll(/'([a-z_]+)':\s*'([^']+)'/g)).map((x) => [x[1], x[2]])) : {}; })();
const allaStd = Array.from(new Set(DEF.roller.flatMap((r) => r.permissions)));
const MATRIS_NYA = ['cost_view', 'cost_edit', 'ao_start_own', 'ao_complete_own', 'ao_pool_take', 'ao_plan_own', 'rondering_utfor', 'objects_access_assigned', 'export_data', 'export_personal_data', 'personal_data_view', 'time_view_all', 'bankgiro_edit',
  /* T4-A */ 'staff_contacts_view', 'activity_log_view_all'];
const saknas = Array.from(new Set(allaStd.concat(MATRIS_NYA).concat(['staff_manage', 'admin_manage', 'article_manage']))).filter((p) => !grupper.includes(p) || !etiketter[p]);
ok(saknas.length === 0 && new Set(grupper).size === grupper.length, 'rolleditorns katalog innehåller alla behörigheter i standardrollerna och matrisens §1.1 (13 nya) med beskrivning, utan dubbletter (T4-A: även staff_contacts_view och activity_log_view_all)', saknas);
ok(/data-ej-verkstalld/.test(ps) && /verkställs i \$\{esc\(ejV\[pid\]\)\}/.test(ps), 'rolleditorn märker ej verkställda behörigheter "verkställs i <paket>"');
ok(/const okanda = perms\.filter\(pid => !kanda\.has\(pid\)\)/.test(ps), 'rolleditorn visar behörigheter som inte finns i katalogen i en egen grupp (de försvinner inte tyst vid Spara)');

// ════════════════ 4. Demorollerna och matrisen §2 ════════════════
const sb = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/data/schema.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'src/data/seedData.js'), 'utf8') + '\n;globalThis.__S = SeedData;', sb);
const seed = sb.__S.roles;
const kan = (r) => r.id + ':' + r.permissions.slice().sort().join(',');
ok(seed.map(kan).join('|') === DEF.roller.map(kan).join('|') && seed.every((r) => r.label === DEF.roller.find((d) => d.id === r.id).label), 'demorollerna (seedData, därmed fake-backendens seed) = standardroller.json: id, etikett och behörigheter', seed.map((r) => r.id));
const md = fs.readFileSync(path.join(ROOT, 'docs/qa-2026-11-26/BEHORIGHETSMATRIS.md'), 'utf8');
const avsnitt = md.split('## 2. Standardroller')[1].split('\n## ')[0];
const tabell = avsnitt.split('\n').filter((l) => /^\| `/.test(l));
const matris = { admin: [], chef: [], ekonomi: [], personal: [], begransad: [] };
for (const rad of tabell) {
  const cells = rad.split('|').slice(1, -1).map((c) => c.trim());
  const perms = Array.from(cells[0].matchAll(/`([a-z_]+)`/g)).map((x) => x[1]);
  ['admin', 'chef', 'ekonomi', 'personal', 'begransad'].forEach((rid, i) => { if (/^✔/.test(cells[i + 1])) matris[rid].push(...perms); });
}
matris.admin = ['all']; // admin har all (matrisen: "admin har all"; övriga bockar för admin är följden av all)
const avv = DEF.roller.filter((r) => r.permissions.slice().sort().join() !== Array.from(new Set(matris[r.id])).sort().join()).map((r) => r.id + ': def ' + r.permissions.slice().sort().join(',') + ' ≠ matris ' + Array.from(new Set(matris[r.id])).sort().join(','));
ok(tabell.length >= 20 && avv.length === 0, 'standardroller.json = BEHORIGHETSMATRIS §2 exakt (bara ✔ räknas; "(separat)", "K-02", "(har objects_sensitive)" och "(via payroll_view)" ingår inte)', avv);
ok(!DEF.roller.find((r) => r.id === 'chef').permissions.includes('personal_data_view'), 'K-02: personal_data_view ingår inte i arbetsledarrollen');
ok(['cost_view', 'cost_edit', 'objects_sensitive'].every((p) => DEF.roller.find((r) => r.id === 'chef').permissions.includes(p)) && DEF.roller.find((r) => r.id === 'chef').label === 'Arbetsledare', 'D-01/D-05/D-02: chef (etikett Arbetsledare) har cost_view, cost_edit och objects_sensitive (kan tas bort i en egen roll)');
ok(DEF.roller.find((r) => r.id === 'begransad').permissions.join() === 'dashboard_view,ao_view_own', 'D-04: begransad har bara egna AO (inga tilläggsbehörigheter som standard)');

console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
