'use strict';
/*
 * NIVÅ 1 — autentiserad läsning (se tests/staging/lib.js för nivåerna).
 *
 * Skickar ALDRIG en skrivåtgärd. Skriver ändå i Supabase auth-schemat vid
 * inloggning (session/refresh-token/last_sign_in_at) — därför inte
 * "skrivskyddat" i strikt mening och kräver GO + testkonton.
 *
 *   VIFT_SUPABASE_URL=https://<ref>.supabase.co VIFT_SUPABASE_ANON=<publik nyckel> \
 *   VIFT_PW=<testlösenord> VIFT_USER_FALT=<e2e-konto> VIFT_USER_CHEF=… \
 *   VIFT_USER_EKONOMI=… VIFT_USER_BEGRANSAD=… [VIFT_USER_ADMIN=…] \
 *   node tests/staging/authz-read.js --jag-har-go --bekrafta-projekt=<ref>
 *
 * Kontroller:
 *   R1 work-orders-list per roll (T3-B, skärpt 2026-11-28): utan ao_view_all bara egna
 *      tilldelade AO (inte arkiverade/borttagna) och, med ao_pool_take (övergångsregel:
 *      äldre roll med ao_complete), ÖPPEN pool (status pool, poolOpen ≠ false, ingen
 *      personal) i begränsad projektion (K-03). Pool med personal godkänns INTE längre.
 *   R1b öppen pool-AO lämnas ut utan kontakter, portkod, kund, priser, logg, material,
 *      checklista (poolProjection === true).
 *   R2 time-entries-list per roll: utan payroll_view bara egna tidposter.
 *   R3 Direkt REST-läsning av vift_workOrders/vift_timeEntries nekas/tom.
 *   R4 store-key-write readWithHash på vift_workOrders nekas.
 *   (Sondering av checklistans serverstöd görs i nivå 2 — den skickar en
 *   åtgärd som skulle kunna mutera och hör därför inte hemma här.)
 */
const L = require('./lib');

const env = L.guard(1);
const { pw, emails } = L.accounts(['falt', 'chef', 'ekonomi', 'begransad'], ['admin']);
const { req, login, calls } = L.client(env);
const runId = L.newRunId().replace('E2E-AUTHZ', 'E2E-READ');
const rep = L.reporter('authz-read', runId);

/* Enda tillåtna åtgärderna i POST-anrop. Allt annat (även åtgärder som
   "normalt nekas") räknas som en skrivåtgärd och underkänner körningen. */
const READ_ACTIONS = new Set(['readWithHash', 'readHashes', 'readAllWithHashes']);

(async () => {
  console.log('Nivå 1 — autentiserad läsning mot projekt ' + env.ref + '. Inloggning skriver i auth-schemat; inga affärsdata skrivs.\n');
  const tok = {};
  for (const [r, e] of Object.entries(emails)) tok[r] = await login(e, pw);
  const anyTok = tok.admin || tok.chef;

  const st = await req('/rest/v1/store?select=value&key=eq.vift_staff', { method: 'GET', token: anyTok });
  const rl = await req('/rest/v1/store?select=value&key=eq.vift_roles', { method: 'GET', token: anyTok });
  const staff = (st.body && st.body[0] && st.body[0].value) || [];
  const roles = (rl.body && rl.body[0] && rl.body[0].value) || [];
  const permsOf = (email) => {
    const s = staff.find((x) => String(x.email || '').toLowerCase() === email.toLowerCase());
    const r = s && roles.find((x) => x.id === s.role);
    return { staffId: s ? s.id : null, perms: (r && r.permissions) || [] };
  };
  const has = (p, x) => p.includes('all') || p.includes(x);

  let adminAoCount = null;
  for (const [role, email] of Object.entries(emails)) {
    const me = permsOf(email);
    if (!me.staffId) { rep.add('KONTO ' + role, null, 'ingen personalpost med testkontots e-post — rollkontroller hoppas över'); continue; }
    const wl = await req('/functions/v1/work-orders-list', { method: 'GET', token: tok[role] });
    const aos = (wl.body && wl.body.workOrders) || [];
    if (wl.status !== 200) rep.add('R1 ' + role, has(me.perms, 'ao_view_all') || has(me.perms, 'ao_view_own') ? false : true, 'work-orders-list HTTP ' + wl.status, { kalla: 'ej i repo (G4) — läsåtgärd enligt kontrakt' });
    else if (has(me.perms, 'ao_view_all')) {
      if (role === 'admin') adminAoCount = aos.length;
      rep.add('R1 ' + role, null, 'ser ' + aos.length + ' AO (ao_view_all)', { kalla: 'ej i repo (G4) — läsåtgärd enligt kontrakt' });
    } else {
      const eff = L.effAoPerms(me.perms);
      const egen = (a) => (a.staff || []).map(String).includes(me.staffId) && !a.archived && !a.deleted;
      const oppen = (a) => a.status === 'pool' && a.poolOpen !== false && !(a.staff || []).length && !a.archived && !a.deleted;
      const foreign = aos.filter((a) => !(egen(a) || (has(eff, 'ao_pool_take') && oppen(a))));
      rep.add('R1 ' + role, foreign.length === 0, foreign.length ? 'ser ' + foreign.length + ' AO som varken är egna eller öppen pool (t.ex. pool med annans personal, arkiverad/borttagen): ' + foreign.map((a) => a.id).slice(0, 5).join(',') : 'ser bara egna och ' + (has(eff, 'ao_pool_take') ? 'öppen pool' : 'ingen pool (saknar ao_pool_take)') + ' (' + aos.length + ')', { kalla: 'vift-v2 work-orders-list (T3-B)' });
      const FORBJUDNA = ['phone', 'contactEmail', 'contactPerson', 'accessCode', 'customerName', 'customerId', 'fixedPrice', 'materials', 'log', 'checklist'];
      const lackor = aos.filter((a) => !egen(a) && oppen(a)).filter((a) => a.poolProjection !== true || FORBJUDNA.some((f) => f in a && !(Array.isArray(a[f]) && a[f].length === 0)));
      rep.add('R1b ' + role, lackor.length === 0, lackor.length ? lackor.length + ' öppen pool-AO lämnas ut med skyddat innehåll' : 'öppen pool i begränsad projektion (K-03)', { kalla: 'vift-v2 work-orders-list poolProjection (T3-B)' });
    }
    const tl = await req('/functions/v1/time-entries-list', { method: 'GET', token: tok[role] });
    const tes = (tl.body && tl.body.timeEntries) || [];
    if (has(me.perms, 'payroll_view')) rep.add('R2 ' + role, null, 'ser ' + tes.length + ' tidposter (payroll_view)', { kalla: 'repo — skriver inte (in-memory rate-limit)' });
    else if (has(me.perms, 'time_view_all')) {
      /* T4-B (K-01, D-08): time_view_all ger all personals tid men inga löneuppgifter (attest) i andras poster. */
      const lon = tes.filter((t) => String(t.staffId) !== me.staffId && ['attested', 'attestedAt', 'attestedBy'].some((f) => f in t));
      rep.add('R2 ' + role, tl.status === 200 ? lon.length === 0 : null, 'ser ' + tes.length + ' tidposter (time_view_all, K-01); andras poster med löneuppgifter: ' + lon.length, { kalla: 'repo — skriver inte (in-memory rate-limit)' });
    } else {
      const foreign = tes.filter((t) => String(t.staffId) !== me.staffId);
      rep.add('R2 ' + role, tl.status === 200 || tl.status === 403 ? foreign.length === 0 : null, 'HTTP ' + tl.status + ', andras tidposter synliga: ' + foreign.length, { kalla: 'repo — skriver inte (in-memory rate-limit)' });
    }
    for (const key of ['vift_workOrders', 'vift_timeEntries']) {
      const r = await req('/rest/v1/store?select=value&key=eq.' + key, { method: 'GET', token: tok[role] });
      const leaked = r.status === 200 && Array.isArray(r.body) && r.body.length > 0;
      rep.add('R3 ' + role + ' ' + key, !leaked, 'direkt REST-läsning: HTTP ' + r.status + (leaked ? ' MED DATA' : ' utan data'), { kalla: 'PostgREST GET (RLS)' });
    }
    const rh = await req('/functions/v1/store-key-write', { token: tok[role], body: { action: 'readWithHash', key: 'vift_workOrders' } });
    /* Nekad = 401/403, eller 400 med felkoden key_not_allowlisted (STAGING:s
       store-key-write tillåter inte nyckeln alls). Data får aldrig följa med. */
    const rhErr = String((rh.body && rh.body.error) || '');
    const rhData = !!(rh.body && (rh.body.value !== undefined || rh.body.data !== undefined));
    const denied = !rhData && (rh.status === 401 || rh.status === 403 || (rh.status === 400 && rhErr === 'key_not_allowlisted'));
    rep.add('R4 ' + role, denied, 'readWithHash vift_workOrders: HTTP ' + rh.status + (rhErr ? ' ' + rhErr : '') + (rhData ? ' MED DATA' : ' utan data'), { kalla: 'ej i repo (G4) — läsåtgärd enligt kontrakt' });
  }

  if (adminAoCount !== null) rep.add('R1 jämförelse', null, 'admin ser ' + adminAoCount + ' AO');

  // Självkontroll: inga skrivåtgärder skickade.
  const writes = calls.filter((c) => c.method !== 'GET' && !c.path.startsWith('/auth/') && !READ_ACTIONS.has(c.action));
  rep.add('SJÄLVKONTROLL', writes.length === 0, writes.length ? 'skrivåtgärder skickade: ' + writes.map((w) => w.action).join(', ') : 'inga skrivåtgärder skickade (' + calls.length + ' anrop, varav ' + calls.filter((c) => c.path.startsWith('/auth/')).length + ' inloggningar)');

  const bad = rep.results.filter((r) => r.ok === false).length;
  const f = rep.save({ niva: 1, projekt: env.ref });
  console.log('\n' + rep.results.filter((r) => r.ok === true).length + ' OK, ' + bad + ' avvikelser, ' + rep.results.filter((r) => r.ok === null).length + ' info. Rapport: ' + f);
  process.exit(bad ? L.EXIT.AVVIKELSE : L.EXIT.OK);
})().catch((e) => { console.error('Fel:', e.message); process.exit(L.EXIT.AVVIKELSE); });
