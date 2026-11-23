'use strict';
/*
 * NIVÅ 0 — oinloggade kontroller mot en befintlig STAGING-miljö (nivåerna:
 * tests/staging/lib.js). Inga inloggningar, inga skrivåtgärder, inga utskick.
 * Klassning per anrop (2026-11-23):
 *  - statiska filer (index.html, storage.js, sidan i webbläsaren): ingen databas
 *  - REST GET store utan JWT: nekas av RLS (401), ingen läsning av affärsdata
 *  - EF:er utan JWT (work-orders-list, time-entries-list, store-key-write
 *    readHashes): nekas (401/403) innan anropet har en identitet; källan för
 *    store-key-write/work-orders-list finns inte i repot (G4), men ingen
 *    skrivåtgärd skickas
 *  - offer-token-validate och kundsidan med OGILTIG token: källverifierat att
 *    servern svarar 404 innan något skrivs (skrivning sker bara vid första
 *    öppning av en GILTIG token — sådan används aldrig här)
 * Mål anges via miljövariabler så att inga STAGING-identifierare hamnar i
 * repot:
 *
 *   VIFT_STAGING_URL=https://<staging-domän>  node tests/e2e/staging-readonly.js
 *
 * Supabase-projektets adress och den publika anon-nyckeln läses från den
 * driftsatta sidans egen storage.js (publik information) och skrivs aldrig
 * ut i klartext — bara projektreferensens första tecken visas.
 *
 * Kontroller:
 *  1. Startsidan laddar utan JS-fel, inloggningsformuläret visas.
 *  2. Klienten pratar med STAGING-projektet (inte LIVE).
 *  3. Driftsatta versionsnummer jämförs med repots index.html (vilka filer
 *     skiljer — underlag för installationen).
 *  4. Utan inloggning: REST-läsning av store ger inga affärsdata; EF:er för
 *     läsning nekas (401).
 *  5. Publika offertsidan med ogiltig token ger begripligt besked.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = (process.env.VIFT_STAGING_URL || '').replace(/\/$/, '');
const LIVE_REF = 'hjplzjsbbowiyoyhdghc';
if (!BASE) { console.error('Ange VIFT_STAGING_URL.'); process.exit(2); }

/* curl i stället för Node https: följer miljöns proxyinställningar. */
const { execFileSync } = require('child_process');
function get(url, headers, method, body) {
  const args = ['-s', '-S', '--max-time', '20', '-o', '-', '-w', '\n__STATUS__%{http_code}', '-X', method || 'GET', '-A', 'vift-e2e-readonly'];
  Object.entries(headers || {}).forEach(([k, v]) => { args.push('-H', k + ': ' + v); });
  if (body) args.push('--data-binary', body);
  args.push(url);
  try {
    const raw = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    const i = raw.lastIndexOf('\n__STATUS__');
    return Promise.resolve({ status: Number(raw.slice(i + 11)), body: raw.slice(0, i) });
  } catch (e) { return Promise.resolve({ status: 0, body: String(e.message).slice(0, 200) }); }
}
const mask = (ref) => !ref ? '(okänd)' : (ref === LIVE_REF ? 'LIVE' : 'ett annat projekt än LIVE');

(async () => {
  const out = { when: new Date().toISOString(), checks: [] };
  const add = (id, ok, detail) => { out.checks.push({ id, ok, detail }); console.log((ok === true ? 'OK    ' : ok === false ? 'AVVIK ' : 'INFO  ') + id + ' — ' + detail); };

  // 3. Versioner
  const idx = await get(BASE + '/');
  const deployed = {}; let m; const re = /(?:src|href)="([^"?]+\.(?:js|css))\?v=(\d+)"/g;
  while ((m = re.exec(idx.body))) deployed[m[1]] = Number(m[2]);
  const repoIdx = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const repo = {}; const re2 = /(?:src|href)="([^"?]+\.(?:js|css))\?v=(\d+)"/g;
  while ((m = re2.exec(repoIdx))) repo[m[1]] = Number(m[2]);
  const newer = Object.keys(repo).filter((f) => deployed[f] !== undefined && repo[f] > deployed[f]);
  const older = Object.keys(repo).filter((f) => deployed[f] !== undefined && repo[f] < deployed[f]);
  const onlyRepo = Object.keys(repo).filter((f) => deployed[f] === undefined);
  add('VERSIONER', older.length === 0, Object.keys(deployed).length + ' versionsatta filer driftsatta; ' + newer.length + ' nyare i repot, ' + older.length + ' ÄLDRE i repot än i STAGING' + (older.length ? ' (' + older.join(', ') + ')' : '') + ', ' + onlyRepo.length + ' bara i repot');
  out.newerInRepo = newer.map((f) => f + ' ' + deployed[f] + '→' + repo[f]);
  out.onlyInRepo = onlyRepo;

  // Supabase-projekt + anon-nyckel ur den driftsatta storage.js (publik)
  const storagePath = Object.keys(deployed).find((f) => /storage\.js$/.test(f));
  const st = storagePath ? await get(BASE + '/' + storagePath + '?v=' + deployed[storagePath]) : { body: '' };
  const urlM = /SUPABASE_URL\s*=\s*['"]https:\/\/([a-z0-9]+)\.supabase\.co/.exec(st.body);
  const keyM = /SUPABASE_AKEY\s*=\s*['"]([^'"]+)['"]/.exec(st.body);
  const ref = urlM && urlM[1]; const akey = keyM && keyM[1];
  add('PROJEKT', !!ref && ref !== LIVE_REF, 'driftsatt klient pekar på projekt ' + mask(ref) + (ref === LIVE_REF ? ' — LIVE!' : ' (inte LIVE)'));

  // 1–2. Startsidan i Chromium
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; const consoleErr = []; const hosts = new Set(); const failed = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (c) => { if (c.type() === 'error') consoleErr.push(c.text()); });
  page.on('request', (r) => { try { hosts.add(new URL(r.url()).hostname); } catch (e) {} });
  page.on('requestfailed', (r) => failed.push(r.url().split('?')[0] + ' ' + (r.failure() || {}).errorText));
  // Skydd: inga skrivande anrop från sidan under kontrollen
  await page.route('**/*', (r) => (['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.request().method()) && !/\/auth\/v1\//.test(r.request().url()) ? r.abort() : r.continue()));
  const t0 = Date.now();
  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#login-user', { state: 'visible', timeout: 15000 }).catch(() => {});
  const loadMs = Date.now() - t0;
  const loginVisible = await page.isVisible('#login-user').catch(() => false);
  add('START', loginVisible && errors.length === 0, 'inloggningsformulär ' + (loginVisible ? 'visas' : 'SAKNAS') + ', JS-fel: ' + errors.length + (errors.length ? ' (' + errors.slice(0, 2).join(' | ') + ')' : '') + ', laddtid ' + loadMs + ' ms');
  add('KONSOL', consoleErr.length === 0 ? true : null, consoleErr.length + ' konsolfel' + (consoleErr.length ? ': ' + consoleErr.slice(0, 3).map((x) => x.slice(0, 100)).join(' | ') : ''));
  const supaHosts = [...hosts].filter((h) => /supabase\.co$/.test(h)).map((h) => mask(h.split('.')[0]));
  add('NÄTVERK', ![...hosts].some((h) => h.startsWith(LIVE_REF)), 'kontaktade Supabase-projekt: ' + (supaHosts.join(', ') || 'inga före inloggning') + '; misslyckade anrop: ' + failed.length);

  // 5. Publika offertsidan med ogiltig token
  await page.goto(BASE + '/public-offer.html?t=ogiltig-e2e-token-0000000000000000', { waitUntil: 'load', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const pubTxt = (await page.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 400);
  add('PUBLIK OFFERT', /ogiltig|hittades inte|finns inte|utgått|kunde inte/i.test(pubTxt) && !/Godkänn/.test(pubTxt), 'ogiltig token visar: ' + JSON.stringify(pubTxt.replace(/\s+/g, ' ').slice(0, 120)));
  await browser.close();

  // 4. Oinloggad åtkomst (endast läsningar)
  if (ref && akey) {
    const SB = 'https://' + ref + '.supabase.co';
    const h = { apikey: akey, Authorization: 'Bearer ' + akey };
    const rest = await get(SB + '/rest/v1/store?select=key&limit=5', h);
    let rows = null; try { rows = JSON.parse(rest.body); } catch (e) {}
    add('REST OINLOGGAD', rest.status === 401 || (Array.isArray(rows) && rows.length === 0), 'GET store (bara nycklar) utan inloggning → HTTP ' + rest.status + (Array.isArray(rows) ? ', ' + rows.length + ' rader' : ''));
    const te = await get(SB + '/rest/v1/store?key=eq.vift_timeEntries&select=key', h);
    let terows = null; try { terows = JSON.parse(te.body); } catch (e) {}
    add('LÖNEDATA OINLOGGAD', te.status === 401 || (Array.isArray(terows) && terows.length === 0), 'GET vift_timeEntries utan inloggning → HTTP ' + te.status + (Array.isArray(terows) ? ', ' + terows.length + ' rader' : ''));
    for (const fn of ['work-orders-list', 'time-entries-list']) {
      const r = await get(SB + '/functions/v1/' + fn, { apikey: akey });
      add('EF ' + fn, r.status === 401 || r.status === 403, 'utan JWT → HTTP ' + r.status);
    }
    const sk = await get(SB + '/functions/v1/store-key-write', { apikey: akey, 'Content-Type': 'application/json' }, 'POST', JSON.stringify({ action: 'readHashes', keys: ['vift_customers'] }));
    add('EF store-key-write (läsaktion)', sk.status === 401 || sk.status === 403, 'readHashes utan JWT → HTTP ' + sk.status);
    const tv = await get(SB + '/functions/v1/offer-token-validate?t=ogiltig-e2e-token', { apikey: akey });
    add('EF offer-token-validate', tv.status >= 400 && tv.status < 500, 'ogiltig token → HTTP ' + tv.status);
  } else add('OINLOGGAD', null, 'kunde inte läsa projekt/anon-nyckel ur driftsatt storage.js — hoppar över');

  const dir = path.join(__dirname, 'report'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'staging-readonly.json'), JSON.stringify(out, null, 2));
  const bad = out.checks.filter((c) => c.ok === false).length;
  console.log('\n' + out.checks.filter((c) => c.ok === true).length + ' OK, ' + bad + ' avvikelser, ' + out.checks.filter((c) => c.ok === null).length + ' info');
  process.exit(bad ? 1 : 0);
})();
