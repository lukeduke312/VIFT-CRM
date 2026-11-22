/**
 * storage.js v9 — Supabase REST-backend med localStorage-cache
 *
 * Läsning vid start: Supabase i ett enda bulk-anrop, localStorage som fallback.
 * Skrivning: localStorage direkt + Supabase i bakgrunden (fire-and-forget).
 * Auth: JWT från Auth.getAccessToken() injiceras i headers — RLS kräver inloggning.
 * Auth-session (inkl. refresh) hanteras helt av AuthService — rörs inte här.
 *
 * V8: _authFetch() — asynkron central fetch-wrapper.
 *   • Kallar Auth.refreshIfNeeded() proaktivt före varje autentiserat anrop.
 *   • Vid HTTP 401: forcerar en extra refresh-försök + en retry (aldrig loop).
 *   • Vid dubbel 401 eller misslyckat refresh: stoppar DataSync och visar inloggning.
 *   • _authFailed återställs automatiskt vid nästa lyckade anrop (efter ny inloggning).
 *
 * V24: 401-retryn använder nu Auth.forceRefresh() istället för att manipulera
 *   Auth._session.expires_at direkt härifrån — AuthService är den enda platsen
 *   som äger token-refresh-logiken (inkl. single-flight, se AuthService.js).
 *   Detta fixar upprepade "JWT expired"-fel i produktion som berodde på att
 *   flera samtidiga Storage-anrop (DataSync-poll, persist, persistNotifs)
 *   kunde trigga parallella /auth/v1/token-anrop som race:ade mot varandra.
 */
const SUPABASE_URL  = 'https://hjplzjsbbowiyoyhdghc.supabase.co';
const SUPABASE_AKEY = 'sb_publishable_y0htroGxexlmICBDPAUn2Q_Qq7NWrSC';

const Storage = {
  prefix: 'vift_',

  /* P0 AO/TID-FIX: bas-URL för Supabase Edge Functions, härledd från
     SUPABASE_URL (samma projekt-URL som REST-anropen ovan). Används av
     AOTimeSyncService för att anropa ao-time-write. Lazy — läses vid
     ANROP, inte vid fil-parse, så script-laddningsordningen i
     index.html inte spelar någon roll.

     STAGING-GRANSKNING 2026-11-11 (fynd: 404 på work-orders-list/
     time-entries-list/ao-time-write): denna metod fanns tidigare TVÅ
     gånger i detta objektlitteral — en variant med avslutande "/" (den
     ursprungliga, ovan) och en utan (tillagd 2026-11-06, se historiken
     för "STAGING-GRANSKNING 2026-11-06 fynd 2"). I ett objektlitteral
     vinner den SENARE deklarationen tyst — den utan avslutande "/" var
     alltså den faktiskt gällande, medan AOTimeSyncService/WorkOrders-
     ReadService/TimeEntriesReadService:s anrop (`base + 'namn'`, ingen
     egen "/"-separator) förutsatte den FÖRSTA, bortträngda varianten.
     Resultat: `.../functions/v1` + `'work-orders-list'` =
     `.../v1work-orders-list` — en felformad URL, HTTP 404.

     RÄTTAT genom att slå ihop till EN deklaration (ingen avslutande
     "/") och göra alla anropsställen ansvariga för sin EGEN inledande
     "/" — exakt det mönster `readBusinessKeyWithHash()` m.fl. nedan
     redan använde korrekt (`this._functionsBase() + '/store-key-write'`).
     Se AOTimeSyncService.js/_call(), WorkOrdersReadService.js/fetch(),
     TimeEntriesReadService.js/fetch() för de tre rättade anropen. */
  _functionsBase() {
    return SUPABASE_URL + '/functions/v1';
  },

  /* Sätt true när auth-fel är oåterkalleligt — återställs vid nästa lyckade anrop */
  _authFailed: false,

  /* Bygg headers — anon key som apikey, JWT som Authorization när inloggad */
  _h(contentType) {
    const jwt = (typeof Auth !== 'undefined' && Auth.getAccessToken)
      ? (Auth.getAccessToken() || SUPABASE_AKEY)
      : SUPABASE_AKEY;
    const h = {
      'apikey':        SUPABASE_AKEY,
      'Authorization': 'Bearer ' + jwt
    };
    if (contentType !== false) h['Content-Type'] = 'application/json';
    return h;
  },

  /*
   * Asynkron auth-medveten fetch-wrapper.
   * opts: { method?, body?, extraHeaders? }
   *
   * Flöde:
   *   1. Auth.refreshIfNeeded() — förnyar token om den löper ut inom 60s
   *   2. fetch() med färska headers
   *   3. Vid HTTP 401: nollar expires_at → ett extra refresh-försök → en retry
   *   4. Vid dubbel 401 eller misslyckat refresh: _signalAuthFailure() + kastar AUTH_EXPIRED
   *   5. Vid lyckat anrop: återställer _authFailed (redo för ny session efter re-login)
   */
  async _authFetch(url, opts) {
    opts = opts || {};

    /* Steg 1: Proaktiv token-refresh */
    if (typeof Auth !== 'undefined' && Auth.refreshIfNeeded) {
      const ok = await Auth.refreshIfNeeded();
      if (!ok) {
        this._signalAuthFailure();
        const err = new Error('AUTH_EXPIRED');
        err.isAuthExpired = true;
        throw err;
      }
    }

    /* Bygg fetch-options med färska headers (anropas om vid retry) */
    const buildOpts = () => {
      const hasBody = opts.body !== undefined;
      const headers = Object.assign(
        {},
        this._h(hasBody ? undefined : false),
        opts.extraHeaders || {}
      );
      const o = { method: opts.method || (hasBody ? 'POST' : 'GET'), headers };
      if (hasBody) o.body = opts.body;
      return o;
    };

    /* Steg 2: Utför anrop */
    let res = await fetch(url, buildOpts());

    /* Steg 3: Hantera 401 — EN riktig force refresh (inte bara "redan färsk?"-
       kontrollen i refreshIfNeeded) + en retry. Auth.forceRefresh() delar
       AuthService.js:s single-flight-promise, så en 401-utlöst refresh här
       kolliderar aldrig med en samtidig proaktiv refresh från ett annat anrop. */
    if (res.status === 401) {
      console.log('[Storage] 401 — refreshing session and retrying once');
      const retryOk = (typeof Auth !== 'undefined' && Auth.forceRefresh)
        ? await Auth.forceRefresh()
        : false;
      if (!retryOk) {
        this._signalAuthFailure();
        const err = new Error('AUTH_EXPIRED');
        err.isAuthExpired = true;
        throw err;
      }
      res = await fetch(url, buildOpts()); /* retry med färsk token */
      if (res.status === 401) {
        this._signalAuthFailure();
        const err = new Error('AUTH_EXPIRED');
        err.isAuthExpired = true;
        throw err;
      }
    }

    /* Steg 5: Lyckad anrop — återställ felstatus så re-login fungerar */
    this._authFailed = false;
    return res;
  },

  /*
   * Hantera oåterkalleligt auth-fel:
   *   - Stoppar DataSync (avslutar polling-loop)
   *   - Rensar JWT-session
   *   - Visar inloggningsskärm
   * Idempotent via _authFailed-flagga.
   */
  _signalAuthFailure() {
    if (this._authFailed) return;
    this._authFailed = true;
    console.error('[Auth] Session expired — re-login required');
    if (typeof DataSync !== 'undefined') DataSync.stop();
    if (typeof Auth !== 'undefined') {
      try { Auth._clearSession(); } catch(e) {}
    }
    if (typeof App !== 'undefined' && App.showLogin) {
      try { App.showLogin(); } catch(e) {}
    }
  },

  /* Hämta ALL data i ett enda HTTP-anrop (används av initState) */
  async getAll() {
    const res = await this._authFetch(SUPABASE_URL + '/rest/v1/store?select=key,value');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    const out  = {};
    rows.forEach(r => {
      const k = r.key.startsWith(this.prefix) ? r.key.slice(this.prefix.length) : r.key;
      out[k] = r.value;
    });
    return out;
  },

  /* localStorage-fallback: returnera alla kända nycklar som objekt */
  _localAll() {
    const out = {};
    Object.keys(localStorage)
      .filter(k => k.startsWith(this.prefix) && k !== this.prefix + 'auth_v2')
      .forEach(k => {
        try { out[k.slice(this.prefix.length)] = JSON.parse(localStorage.getItem(k)); } catch(e) {}
      });
    return out;
  },

  /* Skriv ALLA nyckel/värde-par i ett enda HTTP-anrop (används av persist).
     V48B3B0 R1: tidigare gömdes Supabase-skrivningen i en oawaitad async
     IIFE ("fire-and-forget") — callern fick aldrig veta om den faktiskt
     lyckades, vilket var en av tre nödvändiga ingredienser i det verifierade
     dataförlust-racet (se RAPPORT-RACE-VERIFIERING.md/RAPPORT-V48B3B0-R1.md).
     setAll() är nu `async` och returnerar en riktig Promise<boolean> —
     `true` vid bekräftad lyckad server-write, `false` vid varje typ av
     misslyckande (aldrig ett kastat/reject:at fel — se catch nedan). Den
     enda anropsplatsen i kodbasen är persist() (state.js), som nu `await`ar
     detta värde. localStorage-cachningen är oförändrad — sker fortfarande
     synkront, direkt, oavsett vad server-skrivningen senare ger för resultat
     (offline-first-designen är avsiktligt bevarad). */
  async setAll(pairs) {
    pairs.forEach(([key, value]) => {
      try { localStorage.setItem(this.prefix + key, JSON.stringify(value)); } catch(e) {}
    });
    const body = pairs.map(([key, value]) => ({ key: this.prefix + key, value }));
    const aoEntry = pairs.find(function(p) { return p[0] === 'workOrders'; });
    const aoCount = Array.isArray(aoEntry && aoEntry[1]) ? aoEntry[1].filter(function(a) { return !a.deleted && !a.archived; }).length : '?';
    console.log('[Storage.setAll] Skriver ' + pairs.length + ' nycklar till Supabase — aktiva AO: ' + aoCount);
    try {
      const res = await this._authFetch(SUPABASE_URL + '/rest/v1/store', {
        body: JSON.stringify(body),
        extraHeaders: { 'Prefer': 'resolution=merge-duplicates' }
      });
      if (res.ok) {
        console.log('[Storage.setAll] Supabase write OK — ' + pairs.length + ' nycklar (inkl. vift_workOrders)');
        return true;
      } else {
        const txt = await res.text().catch(function() { return ''; });
        console.error('[Storage.setAll] Supabase write MISSLYCKADES HTTP ' + res.status + ':', txt.substring(0, 300));
        return false;
      }
    } catch(e) {
      if (!e.isAuthExpired) console.error('[Storage.setAll] Nätverksfel vid write:', e.message || e);
      return false;
    }
  },

  /* V48B3B0 R1.1: skriver ENDAST till localStorage, ingen nätverksskrivning.
     Används för att återställa den lokala cachen efter en misslyckad
     server-write vars synkrona localStorage.setItem() i setAll() redan
     hunnit skriva ett värde som sedan visade sig ALDRIG bli bekräftat
     server-sidigt (se RAPPORT-V48B3B0-R1.1.md). Utan detta skulle en
     offline-reload (initState() → Storage._localAll()) kunna återuppliva
     en mutation som callern redan rullat tillbaka i minnet. */
  setLocal(key, value) {
    try { localStorage.setItem(this.prefix + key, JSON.stringify(value)); } catch(e) {}
  },

  /* Enstaka get */
  async get(key) {
    const k = this.prefix + key;
    try {
      const res = await this._authFetch(
        SUPABASE_URL + '/rest/v1/store?key=eq.' + encodeURIComponent(k) + '&select=value'
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      return rows.length ? rows[0].value : null;
    } catch(e) {
      if (e.isAuthExpired) return null;
      try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; } catch(e2) { return null; }
    }
  },

  /* Strikt remote-läsning — ingen localStorage-fallback. Kastar vid nätverksfel.
     Returnerar {ok:true, found:true, value} eller {ok:true, found:false, value:null} */
  async getRemoteStrict(key) {
    const k = this.prefix + key;
    const res = await this._authFetch(
      SUPABASE_URL + '/rest/v1/store?key=eq.' + encodeURIComponent(k) + '&select=value'
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    return rows.length
      ? { ok: true, found: true,  value: rows[0].value }
      : { ok: true, found: false, value: null };
  },

  /* Strikt remote-skrivning — väntar på svar, kastar vid fel. Uppdaterar localStorage efter lyckad write. */
  async setRemoteStrict(pairs) {
    const body = pairs.map(function([key, value]) { return { key: Storage.prefix + key, value: value }; });
    const res = await this._authFetch(SUPABASE_URL + '/rest/v1/store', {
      body: JSON.stringify(body),
      extraHeaders: { 'Prefer': 'resolution=merge-duplicates' }
    });
    if (!res.ok) {
      const txt = await res.text().catch(function() { return ''; });
      throw new Error('HTTP ' + res.status + ': ' + txt.substring(0, 200));
    }
    pairs.forEach(function([key, value]) {
      try { localStorage.setItem(Storage.prefix + key, JSON.stringify(value)); } catch(_) {}
    });
    return true;
  },

  /* Enstaka set */
  set(key, value) {
    const k = this.prefix + key;
    try { localStorage.setItem(k, JSON.stringify(value)); } catch(e) {}
    /* P2-1 (fix round 2026-11-16): public.store.value is `jsonb NOT NULL`
       (see CLAUDE.md schema). PostgREST's write path for this upsert
       (jsonb_populate_record under `Prefer: resolution=merge-duplicates`)
       maps a JSON `null` request field to SQL NULL for ANY column type —
       there is no way through this REST body to store the JSON scalar
       `null` into a NOT NULL jsonb column. Every such write therefore
       failed with Postgres 23502 (not_null_violation); silently, since
       this call is fire-and-forget. TimeService.clockOut() hit this every
       time it tried to clear stampTs/stampAoId (`Storage.set('stampTs',
       null)`), so the server copy of these keys never actually cleared.
       Fix: send `false` on the wire instead of a bare `null` — a real,
       valid, non-null JSONB scalar, and exactly the sentinel already used
       for stampActive's own "cleared" state. Every reader of these keys
       already treats any falsy value (false, '', 0, null) as "no value"
       (state.js: `JSON.parse(...) || null`), so this changes nothing
       observable and introduces no new/arbitrary value — only makes the
       write actually succeed instead of always failing. The LOCAL
       localStorage copy above is untouched: it still stores exactly the
       value the caller passed in (e.g. a real `null`). */
    const remoteValue = value === null ? false : value;
    (async () => {
      try {
        const res = await this._authFetch(SUPABASE_URL + '/rest/v1/store', {
          body: JSON.stringify({ key: k, value: remoteValue }),
          extraHeaders: { 'Prefer': 'resolution=merge-duplicates' }
        });
        if (!res.ok) {
          console.warn('[Storage.set]', key, 'HTTP', res.status);
          if (typeof showToast === 'function') showToast('Kunde inte spara ' + key + ' på servern (HTTP ' + res.status + ') — försök igen senare.', 4000);
        }
      } catch(e) {
        if (!e.isAuthExpired) {
          console.warn('[Storage.set]', key, e);
          if (typeof showToast === 'function') showToast('Kunde inte spara ' + key + ' på servern (nätverksfel).', 4000);
        }
      }
    })();
  },

  remove(key) {
    const k = this.prefix + key;
    try { localStorage.removeItem(k); } catch(e) {}
    (async () => {
      try {
        await this._authFetch(
          SUPABASE_URL + '/rest/v1/store?key=eq.' + encodeURIComponent(k),
          { method: 'DELETE' }
        );
      } catch(e) {
        if (!e.isAuthExpired) console.warn('[Storage.remove]', key, e);
      }
    })();
  },

  /* clear() rensar bara localStorage-cache — inte Supabase */
  clear() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(this.prefix) && k !== this.prefix + 'auth_v2')
      .forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
  },

  /* STAGING-GRANSKNING 2026-11-06 (fynd 2) — PORTAT ordagrant från det
     redan byggda/testade P0_FINAL_2026-11-04-paketet (server/functions/
     store-key-write/index.ts, action: write/readWithHash/readHashes/
     readAllWithHashes). Enda ändringen mot LIVE-spårets version: ingen
     särskild behörighetshantering för workOrders/timeEntries behövs här,
     eftersom STAGING:s egen, redan etablerade AOTimeSyncService-väg aldrig
     rör dessa två nycklar via denna generiska kanal (de ingår inte i
     VIFT_BUSINESS_KEYS, se state.js).

     STAGING-GRANSKNING 2026-11-11: den duplicerade `_functionsBase()`-
     deklarationen som tidigare låg här är borttagen — se den enda
     kvarvarande deklarationen längst upp i detta objekt för den fulla
     förklaringen av 404-felet detta orsakade och hur det rättats. */

  async readBusinessKeyWithHash(key) {
    try {
      const res = await this._authFetch(this._functionsBase() + '/store-key-write', {
        body: JSON.stringify({ action: 'readWithHash', key: key }),
        extraHeaders: { 'apikey': SUPABASE_AKEY }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok) {
        console.error('[Storage.readBusinessKeyWithHash] avvisad för ' + key + ':', data && data.error);
        return { ok: false, error: (data && data.error) || ('http_' + res.status) };
      }
      return { ok: true, value: data.value, hash: data.hash };
    } catch (e) {
      return { ok: false, error: e.isAuthExpired ? 'auth_expired' : 'network_error' };
    }
  },

  async readBusinessKeyHashes(keys) {
    try {
      const res = await this._authFetch(this._functionsBase() + '/store-key-write', {
        body: JSON.stringify({ action: 'readHashes', keys: keys }),
        extraHeaders: { 'apikey': SUPABASE_AKEY }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok) {
        console.error('[Storage.readBusinessKeyHashes] avvisad:', data && data.error);
        return { ok: false, error: (data && data.error) || ('http_' + res.status) };
      }
      return { ok: true, hashes: (data && data.hashes) || {} };
    } catch (e) {
      return { ok: false, error: e.isAuthExpired ? 'auth_expired' : 'network_error' };
    }
  },

  /* P2-2 CORRECTION (2026-11-16, round 4): identity-scoped stamp status,
     backed by the dedicated `public.stamp_status` table (own RLS, round 3)
     with a SERVER-owned revision counter for concurrency (round 4 —
     replaces round 3's client-generated `seq`, which let two different
     devices independently produce the SAME counter value for two
     genuinely different, conflicting writes; see
     20261116000002_stamp_status_identity_scoped.sql's header). No key
     name, email, or identity is ever sent in the request body — the
     server derives "which user" entirely from the JWT.

     `hasRow:false` in the read result means "this user has never written
     a row" — NEVER "confirmed clocked out" (round 2's bug). Callers
     (state.js) must branch on `hasRow`, not just `active`.

     Every write carries `expectedRevision` — the revision THIS CLIENT
     last observed (from the previous read or write response), never a
     value it invents. See getStampRevision()/setStampRevision() below. */
  async getStampStatus() {
    try {
      const res = await this._authFetch(this._functionsBase() + '/store-key-write', {
        body: JSON.stringify({ action: 'getStampStatus' }),
        extraHeaders: { 'apikey': SUPABASE_AKEY }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const revision = Number(data.revision) || 0;
      this.setStampRevision(revision);
      return { ok: true, hasRow: !!data.hasRow, active: !!data.active, ts: data.ts != null ? data.ts : null, aoId: data.aoId != null ? data.aoId : null, revision };
    } catch (e) {
      return { ok: false, error: e.isAuthExpired ? 'auth_expired' : (e.message || 'network_error') };
    }
  },

  /* Local cache key, namespaced by the logged-in user's email — PURELY a
     local-device convenience (two different staff members sharing one
     physical device/browser must not read each other's cached status);
     NOT a security boundary, which is the new table's own RLS instead.
     Falls back to the plain, unsuffixed key if no session email is
     available yet (keeps working exactly as before in that edge case). */
  _stampLocalKey(name) {
    const email = (typeof Auth !== 'undefined' && Auth.getUserEmail) ? Auth.getUserEmail() : null;
    return this.prefix + name + (email ? '_' + email : '');
  },

  /* The revision this client last observed from the server — tracked so
     every write sends a real `expectedRevision`, never an invented one.
     Server-OWNED value (round 4): this is a cache of what the server told
     us, not a counter we generate ourselves (round 3's mistake). Always
     takes the server's latest word, never compared/maxed against the old
     value — the server is the only authority on ordering now. */
  _stampRevision: 0,
  getStampRevision() { return this._stampRevision; },
  setStampRevision(v) { if (Number.isFinite(v)) this._stampRevision = v; },

  /* P2/time-clock DURABLE RECOVERY (2026-11-17): clockOut() creates the
     time entry and clears the server-side stamp status as two separate
     writes, deliberately ordered (clear only AFTER the entry is server-
     confirmed, see TimeService.js) so neither can land "ahead of" an
     unconfirmed other — but a browser crash/close in the narrow window
     AFTER the entry is confirmed and BEFORE the clear's own response
     arrives (or after it fails and exhausts its retries) would otherwise
     leave the server believing the user is still clocked in, with no
     record left anywhere that a clear was ever owed. This marker is
     written synchronously (localStorage, namespaced like every other
     stamp cache key) the instant the time entry is confirmed and BEFORE
     the clear is even attempted, and removed only once the clear gets a
     real, definitive server response (ok:true, whether stale/replayed or
     clean) — never on a network/5xx failure, so it survives a crash and
     lets the NEXT initState() retry just the clear (never a new time
     entry — the entry already exists). */
  setPendingStampClear(info) {
    try { localStorage.setItem(this._stampLocalKey('pendingStampClear'), JSON.stringify(info)); } catch (e) {}
  },
  getPendingStampClear() {
    try {
      const raw = localStorage.getItem(this._stampLocalKey('pendingStampClear'));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },
  clearPendingStampClear() {
    try { localStorage.removeItem(this._stampLocalKey('pendingStampClear')); } catch (e) {}
  },

  async setStampStatus(active, ts, aoId, expectedRevision, _attempt) {
    _attempt = _attempt || 0;
    const k = (name) => this._stampLocalKey(name);
    if (_attempt === 0) {
      try {
        localStorage.setItem(k('stampActive'), JSON.stringify(!!active));
        localStorage.setItem(k('stampTs'), JSON.stringify(active ? ts : null));
        localStorage.setItem(k('stampAoId'), JSON.stringify(active ? (aoId || null) : null));
      } catch (e) {}
    }
    try {
      const res = await this._authFetch(this._functionsBase() + '/store-key-write', {
        body: JSON.stringify({ action: 'setStampStatus', active: !!active, ts: ts != null ? ts : undefined, aoId: aoId != null ? aoId : undefined, expectedRevision }),
        extraHeaders: { 'apikey': SUPABASE_AKEY }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok) {
        // P2-2 round 4 ("idempotent återhämtning om endast en
        // deloperation lyckas"): a network/server failure here is
        // ambiguous (the write may or may not have actually landed before
        // the response was lost) — retry a FEW times, since this write is
        // idempotent by construction (the server's own revision check
        // makes a byte-identical resend a safe no-op, never a double-
        // apply). Only a genuine 4xx (bad request/forbidden) is NOT
        // retried — retrying would just repeat the same rejection.
        if (res.status >= 500 && _attempt < 2) {
          await new Promise((r) => setTimeout(r, 400 * (_attempt + 1)));
          return this.setStampStatus(active, ts, aoId, expectedRevision, _attempt + 1);
        }
        console.warn('[Storage.setStampStatus] HTTP', res.status, data && data.error);
        if (typeof showToast === 'function') showToast('Stämplingsstatus kunde inte bekräftas av servern (HTTP ' + res.status + ') — kontrollera status igen vid omladdning.', 5000);
        return { ok: false, status: res.status, error: (data && data.error) || ('http_' + res.status) };
      }
      const revision = Number(data.revision ?? expectedRevision) || 0;
      this.setStampRevision(revision);
      if (data.stale) {
        // A DIFFERENT write already landed since this client last read the
        // row (round 4: never "same counter, assume same request" — the
        // server itself determined this is a real conflict, not a
        // replay). Self-heal the local cache to the server's real current
        // value, never what this call tried (and failed) to write.
        try {
          localStorage.setItem(k('stampActive'), JSON.stringify(!!data.active));
          localStorage.setItem(k('stampTs'), JSON.stringify(data.ts != null ? data.ts : null));
          localStorage.setItem(k('stampAoId'), JSON.stringify(data.aoId != null ? data.aoId : null));
        } catch (e) {}
      }
      return { ok: true, stale: !!data.stale, replayed: !!data.replayed, active: !!data.active, ts: data.ts != null ? data.ts : null, aoId: data.aoId != null ? data.aoId : null, revision };
    } catch (e) {
      if (e.isAuthExpired) return { ok: false, status: 0, error: 'auth_expired' };
      if (_attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (_attempt + 1)));
        return this.setStampStatus(active, ts, aoId, expectedRevision, _attempt + 1);
      }
      if (typeof showToast === 'function') showToast('Stämplingsstatus kunde inte bekräftas av servern (nätverksfel) — kontrollera status igen vid omladdning.', 5000);
      return { ok: false, status: 0, error: 'network_error' };
    }
  },

  async getAllWithHashes(businessFullKeys) {
    try {
      const res = await this._authFetch(this._functionsBase() + '/store-key-write', {
        body: JSON.stringify({ action: 'readAllWithHashes', keys: businessFullKeys }),
        extraHeaders: { 'apikey': SUPABASE_AKEY }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return { ok: true, data: data.data || {}, hashes: data.hashes || {} };
    } catch (e) {
      return { ok: false, error: e.isAuthExpired ? 'auth_expired' : (e.message || 'network_error') };
    }
  },

  async writeBusinessKey(key, value, expectedHash) {
    try {
      const res = await this._authFetch(this._functionsBase() + '/store-key-write', {
        body: JSON.stringify({ action: 'write', key: key, value: value, expectedHash: expectedHash }),
        extraHeaders: { 'apikey': SUPABASE_AKEY }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok) {
        console.error('[Storage.writeBusinessKey] avvisad för ' + key + ':', data && data.error);
        return { ok: false, error: (data && data.error) || ('http_' + res.status) };
      }
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.isAuthExpired ? 'auth_expired' : 'network_error' };
    }
  },

  /* ISSUE #1 FIX (2026-11-08) — element-level three-way merge for the
     array-shaped generic keys. `upserts` is [{id, data, previous}];
     `previous` is the element exactly as this session last read it (or
     null for an element it believes is brand new) — the server applies
     each upsert only if the server's CURRENT element still equals
     `previous`, so an unrelated concurrent edit to a DIFFERENT element in
     the same array is never discarded and never even reported as a
     conflict. Only genuine same-element collisions come back in
     `conflicts`.

     PR #2 REVIEW FIX (2026-11-08, blocker 1): `removals` is now
     [{id, previous}] — the SAME shape as upserts, not a bare id list —
     so a removal gets the identical conflict check as an update: the
     server only deletes an element whose current value still matches
     what this session last read. See store_business_key_merge_write() in
     _staging_integration/server/migrations/20261108000001_staging_review_fixes.sql. */
  async writeBusinessKeyMerge(key, upserts, removals) {
    try {
      const res = await this._authFetch(this._functionsBase() + '/store-key-write', {
        body: JSON.stringify({ action: 'writeMerge', key: key, upserts: upserts, removals: removals || [] }),
        extraHeaders: { 'apikey': SUPABASE_AKEY }
      });
      const data = await res.json().catch(function() { return {}; });
      if (!res.ok) {
        console.error('[Storage.writeBusinessKeyMerge] avvisad för ' + key + ':', data && data.error);
        /* N1 (2026-11-12): `status` lets the caller tell a definite 4xx
           rejection (nothing committed) from an uncertain 5xx. Additive. */
        return { ok: false, error: (data && data.error) || ('http_' + res.status), status: res.status };
      }
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.isAuthExpired ? 'auth_expired' : 'network_error' };
    }
  }
};
