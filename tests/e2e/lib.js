'use strict';
/* Testprocessen (simulerad server, demodata) går i samma tidszon som
   webbläsarkontexterna nedan (Europe/Stockholm) — annars skiljer "idag"
   mellan server och klient en timme varje natt. */
process.env.TZ = 'Europe/Stockholm';
/*
 * E2E-harness: statisk server för repots klient, Chromium-kontexter per
 * användare/enhet, Supabase-anrop dirigerade till FakeSupabase, insamling av
 * JS-fel, konsolfel, nätverksfel, toasts, anropsräkning och skärmbilder.
 *
 * Mål "fake" (standard): allt mot simulerad backend i testprocessen.
 * Mål "staging": se tests/e2e/README.md — kräver uttryckligt GO, isolerade
 * testkonton och miljövariabler; ingen STAGING-identifierare i repot.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const { FakeSupabase, TEST_USERS, PASSWORD } = require('./fake-backend');

/* VIFT_E2E_ROOT/VIFT_E2E_SUPA: kör sviten mot ett publiceringspaket (t.ex.
   STAGING-paketet med STAGING-överlägg). Alla anrop till SUPA fångas av den
   simulerade servern — ingen trafik når den riktiga Supabase-servern. */
const ROOT = process.env.VIFT_E2E_ROOT ? path.resolve(process.env.VIFT_E2E_ROOT) : path.resolve(__dirname, '..', '..');
const SUPA = process.env.VIFT_E2E_SUPA || 'https://hjplzjsbbowiyoyhdghc.supabase.co';
/* Riktigt läge: Supabase-anropen går till riktig server (eller, vid lokal
   provning, vidarebefordras till VIFT_E2E_FORWARD). Kan bara aktiveras av
   tests/staging/e2e-real.js, som sätter VIFT_E2E_REAL_GUARD efter sina
   spärrar (godkänt STAGING-projekt, GO-flaggor). LIVE nekas alltid. */
const REAL = process.env.VIFT_E2E_REAL === '1';
if (REAL && (process.env.VIFT_E2E_REAL_GUARD !== 'godkand-av-e2e-real' || /hjplzjsbbowiyoyhdghc/.test(SUPA))) {
  console.error('Riktigt läge får bara startas av tests/staging/e2e-real.js (och aldrig mot LIVE).'); process.exit(2);
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const VIEWPORTS = {
  desktop: { viewport: { width: 1920, height: 1080 } },
  laptop: { viewport: { width: 1366, height: 768 } },
  tablet: Object.assign({}, devices['iPad (gen 7)'], { defaultBrowserType: undefined }),
  iphone: Object.assign({}, devices['iPhone 13'], { defaultBrowserType: undefined }),
  android: Object.assign({}, devices['Galaxy S8'], { defaultBrowserType: undefined }),
  /* Granskningsbredder för visuell kontroll (tests/e2e/visual.js). */
  w1024: { viewport: { width: 1024, height: 768 } },
  w768: { viewport: { width: 768, height: 1024 }, hasTouch: true },
};

let server = null, baseUrl = null, browser = null;
/* Simulerad driftsättning: ersätt en fils innehåll som servern levererar
   (sökväg utan querysträng → funktion(originalinnehåll) → nytt innehåll). */
const OVERRIDES = {};
function setOverride(p, fn) { OVERRIDES[p] = fn; }
function clearOverrides() { Object.keys(OVERRIDES).forEach((k) => delete OVERRIDES[k]); }

async function start() {
  if (!server) {
    server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      if (OVERRIDES[p]) return res.end(OVERRIDES[p](fs.readFileSync(f, 'utf8'), req.url));
      fs.createReadStream(f).pipe(res);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = 'http://127.0.0.1:' + server.address().port;
  }
  /* Riktigt läge (tests/staging/e2e-real.js, efter dess spärrar): sidan
     hämtas från den publicerade webbplatsen. */
  if (REAL && process.env.VIFT_E2E_BASEURL) {
    baseUrl = process.env.VIFT_E2E_BASEURL.replace(/\/$/, '');
  }
  if (!browser) browser = await chromium.launch();
  return { baseUrl, browser };
}
async function stop() {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise((r) => server.close(r));
  browser = null; server = null;
}

/* Minimal multipart-tolkning för bilduppladdningen. */
function parseMultipart(buf, contentType) {
  const m = /boundary=([^;]+)/.exec(contentType || '');
  if (!m || !buf) return {};
  const boundary = Buffer.from('--' + m[1]);
  const out = {};
  let start = buf.indexOf(boundary);
  while (start !== -1) {
    const next = buf.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    const part = buf.slice(start + boundary.length + 2, next - 2);
    const sep = part.indexOf('\r\n\r\n');
    const head = part.slice(0, sep).toString();
    const body = part.slice(sep + 4);
    const name = /name="([^"]+)"/.exec(head);
    if (name) {
      if (/filename=/.test(head)) out[name[1] + 'Base64'] = body.toString('base64');
      else out[name[1]] = body.toString();
    }
    start = next;
  }
  return out;
}

class World {
  constructor(opts) {
    this.opts = opts || {};
    /* VIFT_E2E_KEYPERMS=staging: hela sviten körs mot STAGING:s faktiska
       skrivregler per nyckel (store-key-write v3) i stället för den
       tillåtande standardmodellen. */
    const backend = Object.assign({}, this.opts.backend || {});
    if (process.env.VIFT_E2E_KEYPERMS === 'staging' && !backend.keyPerms) backend.keyPerms = require('./staging-key-perms.js');
    /* VIFT_E2E_SERVER=ny: serverändringarna som är förberedda för STAGING-GO
       (installationsplan §2i/§2j): per-post-regel för uppgifter,
       appendActivity (append-only aktivitetslogg) och work-order-log-write. */
    if (process.env.VIFT_E2E_SERVER === 'ny') ['activitiesPolicy', 'activityAppend', 'logOps'].forEach((k) => { if (backend[k] === undefined) backend[k] = true; }); // ett test som uttryckligen anger dagens server behåller det
    this.fake = new FakeSupabase(backend);
    this.sessions = [];
  }

  async session(opts) {
    opts = opts || {};
    const vp = VIEWPORTS[opts.viewport || 'laptop'];
    const context = await browser.newContext(Object.assign({}, vp, { serviceWorkers: opts.serviceWorkers || 'block', locale: 'sv-SE', timezoneId: 'Europe/Stockholm' }));
    const page = await context.newPage();
    const s = new Session(this, context, page, opts);
    this.sessions.push(s);
    await s._wire();
    return s;
  }

  async close() {
    for (const s of this.sessions) await s.context.close().catch(() => {});
  }
}

class Session {
  constructor(world, context, page, opts) {
    this.world = world; this.fake = world.fake; this.context = context; this.page = page; this.opts = opts;
    this.pageErrors = []; this.consoleErrors = []; this.netErrors = []; this.requests = []; this.blockedHosts = new Set();
    this.offline = false;
  }

  async _wire() {
    const page = this.page;
    await page.addInitScript(() => {
      window.__toasts = [];
      document.addEventListener('DOMContentLoaded', () => {
        const el = document.getElementById('toast');
        if (!el) return;
        new MutationObserver(() => { if (el.textContent) window.__toasts.push({ m: el.textContent, t: Date.now() }); }).observe(el, { childList: true, characterData: true, subtree: true });
      });
      window.__confirm = true;
      window.confirm = () => window.__confirm;
      window.alert = () => {};
    });
    page.on('pageerror', (e) => this.pageErrors.push(String(e && e.message || e)));
    page.on('console', (m) => { if (m.type() === 'error') this.consoleErrors.push(m.text()); });
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      if (url.startsWith(baseUrl)) return route.continue();
      if (url.startsWith(SUPA) && REAL) {
        if (this.offline) return route.abort('internetdisconnected');
        const t0 = Date.now();
        const fwd = process.env.VIFT_E2E_FORWARD;
        try {
          if (!fwd) { await route.continue(); this.requests.push({ url: url.replace(SUPA, ''), method: req.method(), status: 0, ms: Date.now() - t0 }); return; }
          const resp = await route.fetch({ url: url.replace(SUPA, fwd) });
          this.requests.push({ url: url.replace(SUPA, ''), method: req.method(), status: resp.status(), ms: Date.now() - t0 });
          if (resp.status() >= 400) this.netErrors.push(req.method() + ' ' + url.replace(SUPA, '') + ' → ' + resp.status());
          return route.fulfill({ response: resp, headers: Object.assign({}, resp.headers(), { 'access-control-allow-origin': '*' }) });
        } catch (e) { return route.abort('failed'); }
      }
      if (url.startsWith(SUPA)) {
        if (this.offline) return route.abort('internetdisconnected');
        const t0 = Date.now();
        let bodyText = req.postData();
        const headers = req.headers();
        if (/work-order-image-upload/.test(url)) bodyText = JSON.stringify(parseMultipart(req.postDataBuffer(), headers['content-type']));
        const res = await this.fake.handle(req.method(), url, headers, bodyText);
        this.requests.push({ url: url.replace(SUPA, ''), method: req.method(), status: res.status, ms: Date.now() - t0 });
        if (res.hang) return; // svarar aldrig (klienten måste ha egen timeout)
        if (res.drop) return route.abort('connectionreset');
        if (res.status >= 400) this.netErrors.push(req.method() + ' ' + url.replace(SUPA, '') + ' → ' + res.status + ' ' + JSON.stringify(res.body).slice(0, 120));
        const h = Object.assign({ 'access-control-allow-origin': '*', 'content-type': 'application/json' }, res.headers || {});
        return route.fulfill({ status: res.status, headers: h, body: res.raw ? res.raw : (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)) });
      }
      // Externa resurser (fonter, kartor) blockeras och noteras — inga anrop lämnar maskinen.
      try { this.blockedHosts.add(new URL(url).host); } catch (e) {}
      // Anrop till ett ANNAT Supabase-projekt än det paketet ska använda (t.ex. LIVE
      // från ett STAGING-paket) är ett fel — blockeras och underkänner testet.
      if (/\.supabase\.co\//.test(url)) this.pageErrors.push('OTILLÅTEN SUPABASE-ADRESS: ' + url.split('?')[0]);
      return route.abort('blockedbyclient');
    });
  }

  async open(hashPath) {
    await this.page.goto(baseUrl + '/' + (hashPath ? '#' + hashPath : ''), { waitUntil: 'load' });
  }

  /* Riktig inloggning via formuläret. */
  async login(alias, password) {
    if (REAL) {
      // Riktigt läge: testkontots e-post ur VIFT_USER_<ALIAS>, lösenord ur VIFT_PW (visas aldrig).
      alias = process.env['VIFT_USER_' + String(alias).toUpperCase()] || alias;
      password = process.env.VIFT_PW;
      if (!this.page.url().startsWith(baseUrl)) await this.open();
      await this.page.waitForSelector('#login-user', { state: 'visible', timeout: 20000 });
      await this.page.fill('#login-user', alias);
      await this.page.fill('#login-pass', password || '');
      await this.page.click('#lp-login button.btn.bp');
      await this.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id && state.currentUser.id !== 'unknown', null, { timeout: 30000 });
      await this.settle(1500);
      return;
    }
    const u = TEST_USERS[alias];
    if (!this.page.url().startsWith(baseUrl)) await this.open();
    await this.page.waitForSelector('#login-user', { state: 'visible', timeout: 15000 });
    await this.page.fill('#login-user', u ? u.email : alias);
    await this.page.fill('#login-pass', password || PASSWORD);
    await this.page.click('#lp-login button.btn.bp');
    if (password && password !== PASSWORD) return;
    try {
      await this.page.waitForSelector('#app', { state: 'visible', timeout: 20000 });
      await this.page.waitForFunction(() => typeof state !== 'undefined' && state.currentUser && state.currentUser.id && state.currentUser.id !== 'unknown', null, { timeout: 15000 });
    } catch (e) {
      const diag = await this.page.evaluate(() => ({
        app: getComputedStyle(document.getElementById('app')).display,
        loginErr: (document.getElementById('login-err') || {}).textContent,
        btn: (document.querySelector('#lp-login button.btn.bp') || {}).textContent,
        user: typeof state !== 'undefined' && state.currentUser ? state.currentUser.id : null,
        toasts: (window.__toasts || []).map((x) => x.m),
      })).catch(() => ({}));
      const mine = this.requests.map((r) => r.method + ' ' + r.url.split('?')[0] + '=' + r.status).slice(-12);
      throw new Error('Inloggning fastnade: ' + JSON.stringify(diag) + ' anrop: ' + mine.join(', ') + ' konsol: ' + this.consoleErrors.filter((m) => !/Failed to load/.test(m)).slice(0, 4).join(' | '));
    }
    await this.settle();
  }

  async settle(ms) { await this.page.waitForTimeout(ms || 400); }
  async go(pageId, params) {
    await this.page.evaluate(([p, prm]) => Router.showPage(p, prm || {}), [pageId, params || null]);
    await this.settle(350);
  }
  async eval(fn, arg) { return this.page.evaluate(fn, arg); }
  async toasts() { return this.page.evaluate(() => window.__toasts.map((x) => x.m)); }
  async clearToasts() { await this.page.evaluate(() => { window.__toasts = []; }); }
  async waitToast(re, timeout) {
    const src = re.source, flags = re.flags;
    await this.page.waitForFunction(([s, f]) => window.__toasts.some((x) => new RegExp(s, f).test(x.m)), [src, flags], { timeout: timeout || 8000 });
  }
  async modalOpen() { return this.page.evaluate(() => document.querySelectorAll('.modal-overlay.open').length > 0); }
  async clickModalButton(re) {
    // .open sätts först i nästa animationsruta — vänta in den.
    await this.page.waitForSelector('.modal-overlay.open .modal-footer button', { timeout: 5000 }).catch(() => {});
    const btns = this.page.locator('.modal-overlay.open .modal-footer button');
    const n = await btns.count();
    for (let i = n - 1; i >= 0; i--) {
      const t = (await btns.nth(i).textContent()) || '';
      if (re.test(t)) { await btns.nth(i).click(); return true; }
    }
    throw new Error('Modalknapp saknas: ' + re + ' (fanns: ' + (await btns.allTextContents()).join(' | ') + ')');
  }
  /* Välj i en CustomSelect som en användare: klicka triggern, sedan alternativet. */
  async pickCustom(id, value) {
    const wrap = this.page.locator('select#' + id + ' + .cswrap').first();
    await wrap.locator('.cstrig').click();
    await wrap.locator('.cso[data-v="' + value + '"]').click();
    await this.settle(150);
  }
  async text(sel) { return (await this.page.locator(sel).first().textContent()) || ''; }
  /* Horisontell scroll och element utanför skärmen. */
  async layoutIssues() {
    return this.page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const issues = [];
      if (document.documentElement.scrollWidth > vw + 2) issues.push('horisontell scroll: ' + document.documentElement.scrollWidth + ' > ' + vw);
      document.querySelectorAll('.page.active button, .page.active a.btn').forEach((b) => {
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (r.right > vw + 2) && getComputedStyle(b).visibility !== 'hidden') {
          // inom en horisontellt scrollbar container är det avsiktligt
          let p = b.parentElement, scroller = false;
          while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') { scroller = true; break; } p = p.parentElement; }
          if (!scroller) issues.push('knapp utanför skärmen: "' + (b.textContent || '').trim().slice(0, 30) + '"');
        }
      });
      document.querySelectorAll('.page.active .ftabs button, .page.active .ft').forEach((b) => {
        if (b.offsetParent && b.scrollWidth > b.clientWidth + 2) issues.push('avklippt flikknapp: "' + (b.textContent || '').trim().slice(0, 30) + '"');
      });
      return issues.slice(0, 8);
    });
  }
  async shot(file) { await this.page.screenshot({ path: file, fullPage: false }).catch(() => {}); }
}

module.exports = { start, stop, World, VIEWPORTS, TEST_USERS, PASSWORD, SUPA, setOverride, clearOverrides, get baseUrl() { return baseUrl; } };
