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
    (async () => {
      try {
        const res = await this._authFetch(SUPABASE_URL + '/rest/v1/store', {
          body: JSON.stringify({ key: k, value }),
          extraHeaders: { 'Prefer': 'resolution=merge-duplicates' }
        });
        if (!res.ok) console.warn('[Storage.set]', key, 'HTTP', res.status);
      } catch(e) {
        if (!e.isAuthExpired) console.warn('[Storage.set]', key, e);
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
  }
};
