'use strict';
/*
 * STAGING-verifiering av serverbehörigheter (G13/BLOCKER-2, G9) och
 * idempotens vid dubbel utstämpling (G6). FÖRBEREDD — KÖRS INTE UTAN GO.
 *
 * Kräver uttryckligt GO, isolerade testkonton per roll och flaggan
 * --jag-har-go. Inga STAGING-identifierare eller lösenord i repot:
 *
 *   VIFT_STAGING_URL=https://<staging-domän> \
 *   VIFT_SUPABASE_URL=https://<ref>.supabase.co VIFT_SUPABASE_ANON=<publik anon-nyckel> \
 *   VIFT_PW=<gemensamt testlösenord> \
 *   VIFT_USER_FALT=<e-post> VIFT_USER_CHEF=<e-post> VIFT_USER_EKONOMI=<e-post> VIFT_USER_BEGRANSAD=<e-post> \
 *   node tests/e2e/staging-authz.js --jag-har-go [--med-testdata]
 *
 * Utan --med-testdata ändras INGA data:
 *  - G13: varje rolls direktanrop till store-key-write gör en `writeMerge`
 *    som bara TAR BORT ett id som inte finns ("E2E-AUTHZ-PROBE-…"). En
 *    behörig server svarar 200 utan att något ändras; en obehörig 403.
 *    Svarar servern 200 för en roll som inte ska få skriva registret är
 *    det ett säkerhetsfel (BLOCKER-2) — trots att inget skrevs.
 *  - G9: ekonomirollen skickar patch_ao med AO:ns NUVARANDE status och
 *    invoiceId (oförändrade värden). 403 = rollen får inte sätta
 *    faktureringsstatus (förklarar G9); 200 = tillåtet (ingen ändring).
 * Med --med-testdata (kräver GO för testdata):
 *  - G6: två samtidiga create_time med SAMMA idempotensnyckel för en
 *    testanvändare på en märkt test-AO → ska ge exakt EN tidpost; posten
 *    tas sedan bort med delete_time.
 */
const ARGS = process.argv.slice(2);
if (!ARGS.includes('--jag-har-go')) { console.error('Avbryter: kräver uttryckligt GO (--jag-har-go). Inga anrop gjorda.'); process.exit(2); }
const SB = (process.env.VIFT_SUPABASE_URL || '').replace(/\/$/, '');
const ANON = process.env.VIFT_SUPABASE_ANON || '';
const PW = process.env.VIFT_PW || '';
const USERS = { falt: process.env.VIFT_USER_FALT, chef: process.env.VIFT_USER_CHEF, ekonomi: process.env.VIFT_USER_EKONOMI, begransad: process.env.VIFT_USER_BEGRANSAD };
if (!SB || !ANON || !PW || Object.values(USERS).some((u) => !u)) { console.error('Saknar miljövariabler (se filhuvudet).'); process.exit(2); }
if (/hjplzjsbbowiyoyhdghc/.test(SB)) { console.error('Avbryter: adressen pekar på LIVE.'); process.exit(2); }

async function req(path, { method = 'POST', token, body } = {}) {
  const r = await fetch(SB + path, { method, headers: Object.assign({ apikey: ANON, 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}
async function login(email) {
  const r = await req('/auth/v1/token?grant_type=password', { body: { email, password: PW } });
  if (!r.body.access_token) throw new Error('inloggning misslyckades för ' + email.replace(/@.*/, '@…'));
  return r.body.access_token;
}

/* Förväntad behörighet per register (klientens regler, AuthService +
   sidornas Auth.can). true = rollen ska få skriva. */
const EXPECT = {
  vift_customers:   { falt: false, chef: true,  ekonomi: false, begransad: false },
  vift_properties:  { falt: false, chef: true,  ekonomi: false, begransad: false },
  vift_offers:      { falt: false, chef: true,  ekonomi: false, begransad: false },
  vift_salesOpps:   { falt: false, chef: true,  ekonomi: false, begransad: false },
  vift_roles:       { falt: false, chef: false, ekonomi: false, begransad: false },
  vift_staff:       { falt: false, chef: false, ekonomi: false, begransad: false },
  vift_settings:    { falt: false, chef: false, ekonomi: false, begransad: false },
  vift_articles:    { falt: false, chef: false, ekonomi: false, begransad: false },
  vift_priceGroups: { falt: false, chef: false, ekonomi: false, begransad: false },
  vift_contracts:   { falt: false, chef: true,  ekonomi: false, begransad: false },
  vift_activities:  { falt: true,  chef: true,  ekonomi: true,  begransad: true },  // egna uppgifter; per-post-regel granskas separat
};

(async () => {
  const results = [];
  const add = (id, ok, detail) => { results.push({ id, ok, detail }); console.log((ok === true ? 'OK    ' : ok === false ? 'AVVIK ' : 'INFO  ') + id + ' — ' + detail); };
  const tokens = {};
  for (const [role, email] of Object.entries(USERS)) tokens[role] = await login(email);

  // G13 — writeMerge som bara tar bort ett id som inte finns (ändrar aldrig data)
  for (const [key, exp] of Object.entries(EXPECT)) {
    for (const role of Object.keys(USERS)) {
      const probeId = 'E2E-AUTHZ-PROBE-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const r = await req('/functions/v1/store-key-write', { token: tokens[role], body: { action: 'writeMerge', key, upserts: [], removals: [{ id: probeId, previous: null }] } });
      const allowed = r.status === 200;
      const denied = r.status === 401 || r.status === 403;
      if (!allowed && !denied) { add('G13 ' + key + ' ' + role, null, 'oväntat svar HTTP ' + r.status + ' ' + (r.body.error || '')); continue; }
      add('G13 ' + key + ' ' + role, allowed === exp[role], (allowed ? 'servern TILLÄT skrivning' : 'servern nekade') + ' (förväntat: ' + (exp[role] ? 'tillåten' : 'nekad') + ')');
    }
  }

  // G9 — ekonomi: patch_ao med oförändrade faktureringsfält
  const wl = await req('/functions/v1/work-orders-list', { method: 'GET', token: tokens.ekonomi });
  const ao = (wl.body.workOrders || []).find((a) => a.status === 'klar') || (wl.body.workOrders || [])[0];
  if (ao) {
    const r = await req('/functions/v1/ao-time-write', { token: tokens.ekonomi, body: { action: 'patch_ao', aoId: ao.id, patch: { status: ao.status, invoiceId: ao.invoiceId || '' }, expectedUpdatedAt: ao.updatedAt || null, idempotencyKey: 'e2e-g9-' + Date.now() } });
    add('G9 ekonomi patch_ao (oförändrade värden)', null, 'HTTP ' + r.status + ' ' + (r.body.error || 'ok') + ' — 403 betyder att ekonomirollen inte får sätta "fakturerad" (förklarar G9)');
  } else add('G9', null, 'ingen AO synlig för ekonomirollen');

  // G6 — endast med uttryckligt GO för testdata
  if (ARGS.includes('--med-testdata')) {
    const wlf = await req('/functions/v1/work-orders-list', { method: 'GET', token: tokens.falt });
    const tao = (wlf.body.workOrders || []).find((a) => /E2E/.test(a.title || ''));
    if (!tao) add('G6', null, 'ingen märkt test-AO (titel med "E2E") tilldelad fältarbetaren — skapa en innan testet');
    else {
      const key = 'e2e-g6-' + Date.now();
      const entry = { id: 'TID-E2E-G6-' + Date.now(), aoId: tao.id, date: new Date().toISOString().slice(0, 10), startStr: '08:00', endStr: '08:30', minutes: 30, comment: 'E2E-G6 dubbel utstämpling' };
      const [a, b] = await Promise.all([1, 2].map(() => req('/functions/v1/ao-time-write', { token: tokens.falt, body: { action: 'create_time', entry, idempotencyKey: key } })));
      const tl = await req('/functions/v1/time-entries-list', { method: 'GET', token: tokens.falt });
      const n = (tl.body.timeEntries || []).filter((e) => e.comment === 'E2E-G6 dubbel utstämpling' && e.aoId === tao.id).length;
      add('G6 dubbel create_time samma nyckel', n === 1, 'svar ' + a.status + '/' + b.status + ', tidposter på servern: ' + n);
      await req('/functions/v1/ao-time-write', { token: tokens.falt, body: { action: 'delete_time', entryId: entry.id, idempotencyKey: key + '-del' } });
    }
  } else add('G6', null, 'hoppas över (kräver --med-testdata och GO för testdata)');

  const bad = results.filter((r) => r.ok === false).length;
  console.log('\n' + results.filter((r) => r.ok === true).length + ' OK, ' + bad + ' avvikelser, ' + results.filter((r) => r.ok === null).length + ' info');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('Fel:', e.message); process.exit(1); });
