/**
 * AuthService v9 — Supabase Auth + rollbaserade behörigheter
 *
 * Inloggning: Supabase Auth (email + lösenord via /auth/v1/token)
 * Session: JWT + refresh_token i localStorage ('vift_auth_v2')
 * Koppling: auth.user.email → state.staff[].email → currentUser + roll
 *
 * Permission keys:
 *   all               – Superadmin, full access
 *   dashboard_view    – Visa dashboard
 *   ao_view_all       – Visa alla arbetsordrar
 *   ao_view_own       – Visa egna arbetsordrar
 *   ao_create         – Skapa arbetsordrar
 *   ao_edit           – Redigera arbetsordrar
 *   ao_complete       – Avsluta/slutföra arbetsordrar
 *   ao_time           – Registrera tid
 *   ao_material       – Registrera material
 *   ao_checklist      – Hantera checklista
 *   customer_manage   – Hantera kunder & fastigheter
 *   offer_manage      – Hantera offerter
 *   invoice_view      – Visa fakturaunderlag
 *   invoice_create    – Skapa/redigera fakturaunderlag
 *   staff_view        – Visa personal
 *   staff_manage      – Hantera personal (skapa/redigera/ta bort)
 *   admin_manage      – Systeminställningar, roller, titlar
 *   article_manage    – Hantera artiklar & prisgrupper
 *   recurring_manage  – Hantera återkommande ärenden
 *   sales_manage      – Hantera säljchanser
 *   reports_view      – Visa rapporter (exkluderar löneunderlag)
 *   payroll_view      – Visa löneunderlag och exportera lönedata
 *   payroll_manage    – Attestera, korrigera och bulkattestera tidposter
 *   objects_sensitive – Visa portkoder, nyckelinformation och övriga säkerhetskänsliga objektfält
 *                       (saknas i roll → fälten döljs i UI; ges till förvaltare/admin)
 */

const Auth = {

  /* Nyckel i localStorage för JWT-session */
  SESSION_KEY: 'vift_auth_v2',

  /* Intern session-state */
  _session: null,   // { access_token, refresh_token, expires_at, user_email }

  /* V24: EN gemensam refresh-promise — alla samtidiga anrop (DataSync-poll,
     persist(), persistNotifs(), 401-retry m.fl. som alla kan trigga refresh
     oberoende av varandra) väntar på SAMMA promise istället för att var och
     en skicka ett eget /auth/v1/token?grant_type=refresh_token-anrop.
     Nödvändigt eftersom Supabase roterar refresh_token vid varje förnyelse —
     parallella anrop med samma (redan förbrukade) refresh_token gör att alla
     utom den första nekas, vilket tidigare rensade en session som en samtidig
     lyckad refresh precis hade satt.
     V26: _refreshPromiseToken knyter den pågående promisen till EXAKT den
     session (refresh_token) den startades för. Detta löser ett andra race
     utöver V25:s token-write-guard: utan denna koppling kunde en gammal
     refresh-promises .finally() nollställa _refreshPromise även efter att en
     NY session (efter omloggning) redan hunnit starta en egen, fortfarande
     pågående refresh-promise — vilket i sin tur bröt single-flight för den
     nya sessionen. Båda fälten nollställs bara av den promise som fortfarande
     ÄR _refreshPromise (identitetskontroll i .finally(), se _doRefresh). */
  _refreshPromise: null,
  _refreshPromiseToken: null,

  /* ── Sidors behörighetskrav ───────────────────────────── */
  PAGE_PERMISSIONS: {
    'pg-dash':         [],
    'pg-ao':           ['ao_view_all','ao_view_own','ao_create','ao_edit','ao_complete','ao_time','ao_material','ao_checklist'],
    'pg-ao-detail':    ['ao_view_all','ao_view_own','ao_edit','ao_time','ao_material','ao_checklist'],
    'pg-crm':          ['customer_manage'],
    'pg-crm-detail':   ['customer_manage'],
    'pg-objects':      ['customer_manage'],
    'pg-obj-detail':   ['customer_manage'],
    'pg-offer':        ['offer_manage'],
    'pg-offer-detail': ['offer_manage'],
    'pg-invoices':     ['invoice_view','invoice_create'],
    'pg-inv-detail':   ['invoice_view','invoice_create'],
    'pg-sales':        ['sales_manage'],
    'pg-myjobs':       ['ao_view_all','ao_view_own','ao_time'],
    'pg-operations':   ['staff_view','reports_view'],
    'pg-tid':          ['ao_time'],
    'pg-calendar':     ['ao_view_all','ao_view_own'],
    'pg-contracts':    ['customer_manage'],
    'pg-rondering':    ['ao_view_all'],
    'pg-articles':     ['article_manage'],
    'pg-pricegroups':  ['article_manage'],
    'pg-payroll':      ['payroll_view'],
    'pg-reports':      ['reports_view'],
    'pg-staff':        ['staff_view','staff_manage'],
    'pg-admin':        ['admin_manage'],
    'pg-recurring':    ['recurring_manage'],

    /* V19 — tidigare ogatade routes (Auth.canViewPage() returnerade true för alla
       inloggade när pageId saknades här). Permissions valda utifrån sidans faktiska
       funktion, se VIFT-CRM-STABILIZATION-V19-rapporten för motivering per rad. */
    'pg-propobj-detail':    ['customer_manage'],
    'pg-import-wizard':     ['customer_manage','article_manage','staff_manage','ao_edit','payroll_manage','admin_manage'],
    'pg-import-log':        ['admin_manage'],
    /* V20: matchar exakt unionen av ExportCenterPage.js EXPORT_PERMISSIONS-kartan —
       varje permission här kan ge minst ett exporterbart register. admin_manage är
       medvetet UTESLUTET (ger inte i sig tillgång till något register att exportera);
       'all' fungerar redan universellt via Auth.can(). */
    'pg-export-center':     ['customer_manage','article_manage','staff_view','ao_view_all','payroll_view','invoice_view','reports_view'],
    'pg-activities':        ['ao_view_all','ao_view_own'],
    'pg-service-templates': ['offer_manage'],
    'pg-rondering-wizard':  ['ao_view_all'],
    'pg-rondering-utfor':   ['ao_view_all'],
    'pg-rondering-rapport': ['ao_view_all'],
  },

  /* ── JWT ──────────────────────────────────────────────── */

  getAccessToken() {
    return this._session ? this._session.access_token : null;
  },

  /* ── Session restore (sync) ───────────────────────────── */

  /* Återställ session från localStorage. Returnerar true om token finns. */
  init() {
    try {
      const saved = localStorage.getItem(this.SESSION_KEY);
      if (!saved) return false;
      const s = JSON.parse(saved);
      if (!s || !s.access_token || !s.refresh_token) return false;
      this._session = s;
      return true;
    } catch(e) { return false; }
  },

  /* ── Token refresh (async, single-flight) ─────────────── */

  /* Förnya JWT om det löper ut inom 60s. Returnerar true om token är giltig.
     Säkerhetsmarginal 60s täcker normal nätverkslatens; själva refresh-anropet
     är dessutom alltid single-flight (se _doRefresh) så flera samtidiga
     anrop med samma marginal aldrig triggar dubbla /auth/v1/token-anrop. */
  async refreshIfNeeded() {
    if (!this._session) return false;
    if (this._session.expires_at && Date.now() < this._session.expires_at - 60000) return true;
    return this._doRefresh();
  },

  /* Tvinga en förnyelse oavsett lokal expires_at — används av Storage._authFetch
     efter ett faktiskt 401-svar, då den lokala tidsuppskattningen redan visat
     sig vara fel (t.ex. klockdrift) och inte får hindra en riktig förnyelse.
     Delar samma single-flight-promise som refreshIfNeeded(). */
  async forceRefresh() {
    if (!this._session) return false;
    return this._doRefresh();
  },

  /* Single-flight PER SESSION: om en refresh redan pågår FÖR SAMMA session
     (samma refresh_token), återanvänd samma promise. En annan/ny session
     (t.ex. efter omloggning medan en gammal refresh fortfarande är i flykt)
     får alltid starta sin egen, separata refresh-promise — den återanvänder
     aldrig en promise som hör till en annan session.

     Identitetsskyddet i .finally() är avgörande: en promise nollställer bara
     _refreshPromise/_refreshPromiseToken om DEN SJÄLV fortfarande är den
     aktuella referensen. Om en nyare promise (för en annan session) redan
     tagit över _refreshPromise när den äldre landar, rör den äldre då INGET
     — annars skulle den kunna radera referensen till den nyare, fortfarande
     pågående refreshen och därmed bryta single-flight för den nya sessionen. */
  _doRefresh() {
    const token = this._session && this._session.refresh_token;
    if (!token) return Promise.resolve(false);

    if (this._refreshPromise && this._refreshPromiseToken === token) {
      return this._refreshPromise;
    }

    const promise = this._performRefresh().finally(() => {
      if (this._refreshPromise === promise) {
        this._refreshPromise = null;
        this._refreshPromiseToken = null;
      }
    });
    this._refreshPromise = promise;
    this._refreshPromiseToken = token;
    return promise;
  },

  async _performRefresh() {
    /* Snapshotta vilken session (via dess refresh_token) denna förnyelse
       startar för. Anropet är async — inloggningsstatus kan hinna ändras
       (utloggning, eller en helt ny inloggning) innan svaret kommer tillbaka.
       Ett svar får ENDAST tillämpas om _session fortfarande är exakt den
       session förnyelsen startade för, annars är resultatet inaktuellt:
       det får varken skriva över en nyare session eller återuppliva en
       utloggad session. */
    if (!this._session || !this._session.refresh_token) { this._clearSession(); return false; }
    const refreshToken = this._session.refresh_token;
    try {
      const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
        method:  'POST',
        headers: { 'apikey': SUPABASE_AKEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refresh_token: refreshToken })
      });

      /* V25: är detta svaret fortfarande för den aktuella sessionen? */
      const stillCurrent = !!(this._session && this._session.refresh_token === refreshToken);

      if (!res.ok) {
        /* Rensa BARA om den förnyelsen faktiskt gällde är den som fortfarande
           är aktuell. En session som redan ersatts (ny inloggning) eller
           redan är utloggad (_session===null) ska aldrig röras härifrån. */
        if (stillCurrent) this._clearSession();
        return !!(this._session && this._session.access_token);
      }

      const d = await res.json();
      if (!stillCurrent) {
        /* Inaktuellt svar — kasta bort de nya tokens, skriv ingenting,
           anropa inte _saveSession(). Rapportera bara sanningen om vad som
           faktiskt gäller just nu. */
        return !!(this._session && this._session.access_token);
      }

      this._session.access_token  = d.access_token;
      this._session.refresh_token = d.refresh_token;
      this._session.expires_at    = Date.now() + (d.expires_in * 1000);
      this._session.user_email    = d.user?.email || this._session.user_email;
      this._saveSession();
      console.log('[Auth] Access token refreshed');
      return true;
    } catch(e) {
      /* Nätverksfel — ingen mutation skedde, rapportera bara aktuellt läge */
      return !!(this._session && this._session.access_token);
    }
  },

  /* ── Login (async) ────────────────────────────────────── */

  async login(email, password) {
    try {
      const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
        method:  'POST',
        headers: { 'apikey': SUPABASE_AKEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.toLowerCase().trim(), password })
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = (data.error_description || data.msg || data.error || '').toLowerCase();
        if (msg.includes('invalid') || msg.includes('credentials') || msg.includes('email')) {
          return { ok: false, error: 'Fel e-post eller lösenord' };
        }
        return { ok: false, error: 'Inloggning misslyckades. Försök igen.' };
      }
      /* V26: inget manuellt _refreshPromise-nollställande behövs här längre —
         _doRefresh()s per-session token-koppling (_refreshPromiseToken) gör
         att en eventuell kvarvarande promise från FÖREGÅENDE session aldrig
         återanvänds för den nya (olika refresh_token), och dess .finally()
         kan inte radera referensen till en nyare promise tack vare identitets-
         kontrollen där. Ett explicit reset här skulle bara duplicera det
         skyddet utan att fylla någon egen funktion. */
      this._session = {
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expires_at:    Date.now() + (data.expires_in * 1000),
        user_email:    data.user?.email || email.toLowerCase().trim()
      };
      this._saveSession();
      return { ok: true };
    } catch(e) {
      return { ok: false, error: 'Kunde inte ansluta till servern. Kontrollera din uppkoppling.' };
    }
  },

  /* ── Logout ───────────────────────────────────────────── */

  logout() {
    const token = this._session ? this._session.access_token : null;
    this._clearSession();
    state.currentUser = null;
    App.showLogin();
    /* Fire-and-forget: ogiltigförklara JWT hos Supabase */
    if (token) {
      fetch(SUPABASE_URL + '/auth/v1/logout', {
        method:  'POST',
        headers: { 'apikey': SUPABASE_AKEY, 'Authorization': 'Bearer ' + token }
      }).catch(() => {});
    }
  },

  /* ── Koppla auth-user → staff-post ───────────────────── */

  /*
   * Kör efter initState(). Matchar auth-emailen mot state.staff[].email.
   * Sätter state.currentUser baserat på staff-posten (roll, behörigheter, namn).
   */
  _resolveUser() {
    const email = this._session ? this._session.user_email : null;
    if (!email) { state.currentUser = null; return; }

    const staff = (state.staff || []).find(s =>
      s.active && s.email && s.email.toLowerCase() === email.toLowerCase()
    );

    if (!staff) {
      console.warn('[Auth] Ingen aktiv staff-post hittad för e-post:', email);
      state.currentUser = {
        id: 'unknown', firstName: email.split('@')[0], lastName: '',
        role: 'personal', username: email, title: ''
      };
      return;
    }

    state.currentUser = {
      id:        staff.id,
      firstName: staff.firstName,
      lastName:  staff.lastName,
      role:      staff.role,
      username:  staff.username || staff.email,
      title:     staff.title   || ''
    };
  },

  /* ── Getters ──────────────────────────────────────────── */

  isLoggedIn() {
    return !!(this._session && this._session.access_token && state.currentUser);
  },

  getUser() {
    return state.currentUser || null;
  },

  /* ── Behörighetskontroll ──────────────────────────────── */

  can(permission) {
    const user = this.getUser();
    if (!user) return false;
    const perms = this._getPermsForUser(user);
    return perms.includes('all') || perms.includes(permission);
  },

  canAny(permissions) {
    if (!permissions || permissions.length === 0) return true;
    return permissions.some(p => this.can(p));
  },

  canViewPage(pageId) {
    if (!this.isLoggedIn()) return false;
    const required = this.PAGE_PERMISSIONS[pageId];
    if (required === undefined) return true;
    return this.canAny(required);
  },

  require(permission) {
    if (this.can(permission)) return true;
    showToast('Du saknar behörighet för den åtgärden');
    return false;
  },

  _getPermsForUser(user) {
    if (!user) return [];
    const role = (state.roles || []).find(r => r.id === user.role);
    if (role) return role.permissions || [];
    return user.permissions || [];
  },

  /* ── Lösenordsåterställning ──────────────────────────── */

  /* Pending PKCE auth code (set by handleEmailLink when ?code= detected) */
  _pendingPKCECode: null,

  /*
   * Anropas synkront vid sidladdning (före session-restore).
   * Hanterar både implicit flow (hash-tokens) och PKCE flow (?code=).
   * Returnerar 'recovery', 'signup' eller null.
   *
   * Implicit flow: #access_token=...&type=recovery (Supabase ersätter hela hash)
   * PKCE flow:     ?code=... i query string, eller #/reset-password?code=... i hash
   */
  handleEmailLink() {
    const hash = window.location.hash; // inkl. #

    /* ── Case 1: Implicit flow — tokens i hash ────────────── */
    if (hash && hash.length >= 2 && hash.includes('access_token=')) {
      const params = {};
      hash.slice(1).split('&').forEach(function(part) {
        const eq = part.indexOf('=');
        if (eq > 0) params[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
      });
      if (params.access_token && params.type) {
        this._session = {
          access_token:  params.access_token,
          refresh_token: params.refresh_token || '',
          expires_at:    params.expires_in ? Date.now() + Number(params.expires_in) * 1000 : Date.now() + 3600000,
          user_email:    params.email || ''
        };
        this._saveSession();
        try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch(e) {}
        return params.type;
      }
    }

    /* ── Case 2: PKCE code i hash-fragment (t.ex. #/reset-password?code=xxx) ── */
    if (hash && hash.includes('?code=')) {
      const qmark = hash.indexOf('?');
      const hashSearch = new URLSearchParams(hash.slice(qmark));
      const hashCode = hashSearch.get('code');
      if (hashCode) {
        this._pendingPKCECode = hashCode;
        const cleanHash = hash.slice(1, qmark) || '/';
        try { history.replaceState(null, '', window.location.pathname + window.location.search + '#' + cleanHash); } catch(e) {}
        return 'recovery';
      }
    }

    /* ── Case 3: PKCE code i query string (t.ex. ?code=xxx#/reset-password) ── */
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get('code');
    if (code) {
      this._pendingPKCECode = code;
      try { history.replaceState(null, '', window.location.pathname + (window.location.hash || '')); } catch(e) {}
      return 'recovery';
    }

    return null;
  },

  /*
   * Byt ut PKCE-kod mot access_token + refresh_token.
   * Kräver code_verifier ur sessionStorage (sparad av sendPasswordReset).
   */
  async exchangePKCECode(code) {
    const codeVerifier = sessionStorage.getItem('vift_pkce_verifier');
    try {
      const body = { auth_code: code };
      if (codeVerifier) body.code_verifier = codeVerifier;
      const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=pkce', {
        method:  'POST',
        headers: { 'apikey': SUPABASE_AKEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
      });
      if (!res.ok) {
        const d = await res.json().catch(function() { return {}; });
        return { ok: false, error: d.msg || d.error_description || d.error || 'Ogiltig återställningslänk. Begär en ny länk.' };
      }
      const d = await res.json();
      this._session = {
        access_token:  d.access_token,
        refresh_token: d.refresh_token || '',
        expires_at:    d.expires_in ? Date.now() + Number(d.expires_in) * 1000 : Date.now() + 3600000,
        user_email:    (d.user && d.user.email) || ''
      };
      this._saveSession();
      if (codeVerifier) sessionStorage.removeItem('vift_pkce_verifier');
      return { ok: true };
    } catch(e) {
      return { ok: false, error: 'Kunde inte ansluta till servern.' };
    }
  },

  /*
   * Skicka återställningslänk till angiven e-post.
   * Enkel POST utan PKCE — redirect_to satt till CRM:ets reset-sida.
   * OBS: PKCE skickas INTE i recover-anropet eftersom det kan göra att
   *      Supabase avvisar anropet eller att vi inte kan verifiera koden.
   */
  async sendPasswordReset(email) {
    const redirectTo = 'https://crm.viftfast.se/#/reset-password';
    const body       = { email: email.toLowerCase().trim(), redirect_to: redirectTo };
    console.log('[Auth.sendPasswordReset] Skickar till Supabase:', JSON.stringify(body));
    try {
      const res  = await fetch(SUPABASE_URL + '/auth/v1/recover', {
        method:  'POST',
        headers: { 'apikey': SUPABASE_AKEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body)
      });
      const text = await res.text();
      console.log('[Auth.sendPasswordReset] Svar', res.status, ':', text.slice(0, 400));
      if (!res.ok) {
        let errMsg = 'Kunde inte skicka återställningslänk.';
        try { const d = JSON.parse(text); errMsg = d.msg || d.error_description || d.error || errMsg; } catch(e) {}
        console.error('[Auth.sendPasswordReset] FEL:', errMsg);
        return { ok: false, error: errMsg };
      }
      console.log('[Auth.sendPasswordReset] E-post skickad OK.');
      return { ok: true };
    } catch(e) {
      console.error('[Auth.sendPasswordReset] Nätverksfel:', e.message || e);
      return { ok: false, error: 'Kunde inte ansluta till servern. Kontrollera din uppkoppling.' };
    }
  },

  /*
   * Uppdatera lösenord med JWT från återställningslänken (finns i this._session).
   * Anropas när användaren skriver sitt nya lösenord i ange-nytt-lösenord-vyn.
   */
  async updatePassword(newPassword) {
    if (!this._session || !this._session.access_token) {
      return { ok: false, error: 'Ogiltig session — begär en ny återställningslänk.' };
    }
    try {
      const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
        method:  'PUT',
        headers: {
          'apikey':        SUPABASE_AKEY,
          'Authorization': 'Bearer ' + this._session.access_token,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({ password: newPassword })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return { ok: false, error: d.msg || d.message || d.error || 'Kunde inte uppdatera lösenord.' };
      }
      return { ok: true };
    } catch(e) {
      return { ok: false, error: 'Kunde inte ansluta till servern.' };
    }
  },

  /* ── Intern helpers ───────────────────────────────────── */

  _saveSession() {
    try { localStorage.setItem(this.SESSION_KEY, JSON.stringify(this._session)); } catch(e) {}
  },

  _clearSession() {
    this._session = null;
    /* V26: inget manuellt _refreshPromise-nollställande behövs här längre —
       se motiveringen i login(). Om en refresh fortfarande pågår för den nu
       utloggade sessionen städar dess egen .finally() (identitetsskyddad)
       upp sig själv när den landar; ingen ny refresh kan starta för att
       refreshIfNeeded()/forceRefresh() redan kräver en icke-null _session. */
    try { localStorage.removeItem(this.SESSION_KEY); } catch(e) {}
  }
};
