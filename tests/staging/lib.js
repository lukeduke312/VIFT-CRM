'use strict';
/*
 * Gemensam grund för VIFT CRM:s STAGING-testverktyg (2026-11-23).
 *
 * Testnivåer — ett anrop som KAN uppdatera databasen kallas aldrig läsande:
 *
 *   Nivå 0  tests/e2e/staging-readonly.js
 *           Oinloggad. Statiska filer + anrop som nekas innan servern läser
 *           eller skriver något (401/403/404 på ogiltig token). Inga
 *           databasskrivningar (källverifierat för EF:er som finns i repot).
 *
 *   Nivå 1  tests/staging/authz-read.js
 *           Inloggad, endast läsåtgärder. Inloggningen SKRIVER i Supabase
 *           auth-schemat (session, refresh-token, last_sign_in_at). Inga
 *           affärsdata skrivs enligt den källkod som finns i repot; för
 *           EF:er utan källa i repot (G4) är det kontraktet, inte koden,
 *           som säger att åtgärden är läsande — redovisas per kontroll.
 *           Kräver GO (testkonton).
 *
 *   Nivå 2  tests/staging/authz-mutation.js
 *           Riktiga skrivförsök. Skapar och tar bort märkta testposter.
 *           Även en tillåten skrivning som inte ändrar något innehåll
 *           uppdaterar store.updated_at och vift_lastChanged (verifierat av
 *           Lucas/ChatGPT mot installerade STAGING-RPC:er) — därför rör
 *           nivå 2 ALDRIG befintliga poster, bara egna testposter.
 *           Kräver uttryckligt GO för mutationstest.
 *
 * Alla spärrar körs INNAN första nätverksanropet.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const LIVE_REF = 'hjplzjsbbowiyoyhdghc';
const EXIT = { OK: 0, AVVIKELSE: 1, SPARR: 2, STADNING_MISSLYCKADES: 3, OSAKER: 4 };

function arg(name) {
  const a = process.argv.slice(2).find((x) => x === '--' + name || x.startsWith('--' + name + '='));
  if (!a) return null;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
}

function refuse(msg) {
  console.error('SPÄRR: ' + msg + '\nInga anrop gjorda.');
  process.exit(EXIT.SPARR);
}

/* Miljöspärrar. level: 1 eller 2. Returnerar { sb, anon, ref, local }. */
function guard(level) {
  if (arg('jag-har-go') !== true) refuse('kräver uttryckligt GO (--jag-har-go).');
  const sb = String(process.env.VIFT_SUPABASE_URL || '').replace(/\/$/, '');
  const anon = String(process.env.VIFT_SUPABASE_ANON || '');
  if (!sb || !anon) refuse('saknar VIFT_SUPABASE_URL eller VIFT_SUPABASE_ANON.');
  let ref = null, local = false;
  const m = sb.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/);
  if (m) ref = m[1];
  else if (process.env.VIFT_LOKALT_TESTLAGE === '1' && /^http:\/\/127\.0\.0\.1:\d+$/.test(sb)) { ref = 'lokaltest'; local = true; }
  else refuse('VIFT_SUPABASE_URL måste vara https://<projekt-ref>.supabase.co.');
  if (ref === LIVE_REF || sb.includes(LIVE_REF)) refuse('adressen pekar på LIVE. Nekas alltid.');
  const confirm = arg('bekrafta-projekt');
  if (confirm !== ref) refuse('--bekrafta-projekt=<ref> måste anges och vara exakt projektet i VIFT_SUPABASE_URL (' + (local ? 'lokaltest' : 'det du avser') + ').');
  if (level >= 2) {
    if (arg('mutationstest') !== true) refuse('nivå 2 skriver testposter: kräver även --mutationstest.');
    if (process.env.VIFT_MILJO !== 'staging') refuse('nivå 2 kräver VIFT_MILJO=staging.');
  }
  return { sb, anon, ref, local };
}

/* Testkonton: läses ur miljön; e-postadressen måste se ut som ett
   testkonto (standard: "e2e" i lokaldelen) så att ett skarpt konto inte
   används av misstag. */
function accounts(roles, optional) {
  const pw = process.env.VIFT_PW || '';
  if (!pw) refuse('saknar VIFT_PW (testkontonas lösenord).');
  const pattern = new RegExp(process.env.VIFT_TESTKONTO_MONSTER || '^[^@]*e2e[^@]*@', 'i');
  const out = {};
  for (const r of roles.concat(optional || [])) {
    const email = process.env['VIFT_USER_' + r.toUpperCase()];
    if (!email) { if ((optional || []).includes(r)) continue; refuse('saknar VIFT_USER_' + r.toUpperCase() + '.'); }
    if (!pattern.test(email)) refuse('VIFT_USER_' + r.toUpperCase() + ' ser inte ut som ett testkonto (mönster ' + pattern + ').');
    out[r] = email;
  }
  return { pw, emails: out };
}

/* Transport: Node fetch (lokalt) eller curl när en HTTPS-proxy krävs. */
function client(env) {
  const useCurl = !env.local && !!(process.env.HTTPS_PROXY || process.env.https_proxy);
  const calls = [];
  async function req(p, { method = 'POST', token, body } = {}) {
    const headers = { apikey: env.anon, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    calls.push({ method, path: p.replace(/\?.*$/, ''), action: body && body.action });
    if (!useCurl) {
      const r = await fetch(env.sb + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
      let j = {}; try { j = await r.json(); } catch (e) {}
      return { status: r.status, body: j };
    }
    return new Promise((resolve) => {
      const a = ['-sS', '-X', method, '-w', '\n%{http_code}', '--max-time', '30'];
      Object.entries(headers).forEach(([k, v]) => a.push('-H', k + ': ' + v));
      if (body) a.push('--data-binary', '@-');
      a.push(env.sb + p);
      const c = spawn('curl', a);
      let out = '';
      c.stdout.on('data', (d) => { out += d; });
      c.on('close', () => {
        const i = out.lastIndexOf('\n');
        let j = {}; try { j = JSON.parse(out.slice(0, i)); } catch (e) {}
        resolve({ status: Number(out.slice(i + 1)) || 0, body: j });
      });
      if (body) c.stdin.end(JSON.stringify(body)); else c.stdin.end();
    });
  }
  async function login(email, pw) {
    const r = await req('/auth/v1/token?grant_type=password', { body: { email, password: pw } });
    if (!r.body.access_token) throw new Error('inloggning misslyckades för ' + email.replace(/@.*/, '@…'));
    return r.body.access_token;
  }
  return { req, login, calls };
}

function reporter(name, runId) {
  const results = [];
  const add = (id, ok, detail, extra) => {
    results.push(Object.assign({ id, ok, detail }, extra || {}));
    console.log((ok === true ? 'OK     ' : ok === false ? 'AVVIK  ' : 'INFO   ') + id + ' — ' + detail);
  };
  const dir = path.join(__dirname, 'rapport');
  const save = (extra) => {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, name + '-' + runId + '.json');
    fs.writeFileSync(f, JSON.stringify(Object.assign({ verktyg: name, runId, tid: new Date().toISOString(), results }, extra || {}), null, 2));
    return f;
  };
  return { results, add, save, dir };
}

function newRunId() {
  const d = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return 'E2E-AUTHZ-' + d + '-' + crypto.randomBytes(3).toString('hex');
}

const stable = (v) => JSON.stringify(v === undefined ? null : v);

module.exports = { LIVE_REF, EXIT, arg, refuse, guard, accounts, client, reporter, newRunId, stable };
