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
 *   customer_manage   – Hantera kunder & fastigheter (läsning + skrivning)
 *   customer_view     – Visa kunder & kundkort (ENDAST läsning, ingen skrivning —
 *                       tillagd 2026-11 så att en roll kan se Kunder utan att få
 *                       customer_manage; customer_manage fortsätter ge både läsning
 *                       och skrivning oförändrat)
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
    /* 2026-11: customer_view läggs till som läsbehörighet vid sidan av
       customer_manage (canAny/.some() nedan ger OR-semantik mellan dessa
       två — exakt samma mönster som redan används för t.ex. pg-invoices).
       Skrivknappar/mutationsmetoder förblir strikt customer_manage-gated,
       se CustomersPage.js/CustomerService.js. */
    'pg-crm':          ['customer_manage','customer_view'],
    'pg-crm-detail':   ['customer_manage','customer_view'],
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
    /* V54A — återanvänder customer_manage rakt av, ingen ny
       project_view/project_edit/project_manage-behörighet ännu (se
       RAPPORT-V54-PROJEKT-DISCOVERY.md §17). Samma avgränsning som
       Kontrakt/Fastigheter redan använder. */
    'pg-projects':         ['customer_manage'],
    'pg-project-detail':   ['customer_manage'],
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

  /* P2-2 (fix round 2026-11-16, round 3): re-added for LOCAL CACHE
     namespacing ONLY — NOT a security boundary (that is now the new
     stamp_status table's own RLS, scoped by the server-verified
     auth.user.id, see 20261116000002_stamp_status_identity_scoped.sql).
     Used solely so two different staff members sharing one physical
     device/browser (common on a shared field-service tablet) don't read
     each other's cached localStorage stamp status — a purely local-device
     correctness concern, independent of server-side access control. */
  getUserEmail() {
    return this._session ? (this._session.user_email || null) : null;
  },

  /* ── Session restore (sync) ───────────────────────────── */

  /* Återställ session från localStorage. Returnerar true om token finns.

     BLOCKER-1 SLUTFÖRANDE (verkligt reproducerad kvarstående läcka,
     krav 3, samt fel 3 i den oberoende granskningen — en TRASIG/
     okorrupt sparad session lämnade cachen orörd eftersom `catch`-
     grenen inte rensade): om app-starten INTE hittar en giltig session
     — t.ex. efter en riktig utloggning, en utgången/raderad session,
     ELLER en korrupt/oläsbar sparad session (JSON.parse kastar) —
     rensas `vift_timeEntries` HÄR, defensivt, i SAMTLIGA tre grenar
     (saknad, ogiltig form, kastat fel). En fortsatt INLOGGAD användare
     som bara laddar om sidan (giltig session hittas) påverkas INTE. */
  init() {
    try {
      const saved = localStorage.getItem(this.SESSION_KEY);
      if (!saved) {
        if (typeof TimeEntriesReadService !== 'undefined') TimeEntriesReadService.resetForAccountChange();
        if (typeof WorkOrdersReadService !== 'undefined') WorkOrdersReadService.resetForAccountChange(); // SÄKERHETSFYND V7
        return false;
      }
      const s = JSON.parse(saved);
      if (!s || !s.access_token || !s.refresh_token) {
        if (typeof TimeEntriesReadService !== 'undefined') TimeEntriesReadService.resetForAccountChange();
        if (typeof WorkOrdersReadService !== 'undefined') WorkOrdersReadService.resetForAccountChange(); // SÄKERHETSFYND V7
        return false;
      }
      this._session = s;
      return true;
    } catch(e) {
      if (typeof TimeEntriesReadService !== 'undefined') TimeEntriesReadService.resetForAccountChange();
      if (typeof WorkOrdersReadService !== 'undefined') WorkOrdersReadService.resetForAccountChange(); // SÄKERHETSFYND V7
      return false;
    }
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

  /* R4 REVIEW: a refresh response is valid only if the shared session still
     contains the refresh token that started it. A different tab may already
     have rotated the token or logged out while its storage event is queued. */
  _checkSharedSessionForRefresh(refreshToken) {
    let shared = null;
    try {
      const raw = localStorage.getItem(this.SESSION_KEY);
      shared = raw ? JSON.parse(raw) : null;
    } catch (e) {}
    if (shared && shared.refresh_token === refreshToken) return { current: true };

    const local = this._session;
    if (shared && shared.refresh_token && shared.access_token && local &&
        shared.user_email && shared.user_email === local.user_email) {
      /* Another tab refreshed this same account first. Do not delete it. */
      this._session = shared;
      return { current: false, loggedIn: true };
    }

    /* Logout/account replacement happened elsewhere: invalidate only THIS
       tab. Never write back to the shared key from this branch. */
    this._session = null;
    if (typeof state !== 'undefined') state.currentUser = null;
    if (typeof TimeEntriesReadService !== 'undefined') TimeEntriesReadService.resetForAccountChange();
    if (typeof WorkOrdersReadService !== 'undefined') WorkOrdersReadService.resetForAccountChange(); // SÄKERHETSFYND V7
    if (typeof App !== 'undefined' && App.showLogin) App.showLogin();
    return { current: false, loggedIn: false };
  },

  async _performRefresh() {
    if (!this._session || !this._session.refresh_token) return false;
    const refreshToken = this._session.refresh_token;
    try {
      const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_AKEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      /* The token in localStorage is shared across tabs. Check it BEFORE
         handling a failure (which might clear it), or a success (which
         might resurrect a session after another tab logged out). */
      let shared = this._checkSharedSessionForRefresh(refreshToken);
      if (!shared.current) return shared.loggedIn;
      if (!this._session || this._session.refresh_token !== refreshToken) return !!this._session;
      if (!res.ok) {
        this._clearSession();
        return false;
      }
      const d = await res.json();
      /* res.json() also yields: logout or a newer refresh may have happened. */
      shared = this._checkSharedSessionForRefresh(refreshToken);
      if (!shared.current) return shared.loggedIn;
      if (!this._session || this._session.refresh_token !== refreshToken) return !!this._session;
      this._session.access_token = d.access_token;
      this._session.refresh_token = d.refresh_token;
      this._session.expires_at = Date.now() + (d.expires_in * 1000);
      this._session.user_email = d.user?.email || this._session.user_email;
      this._saveSession();
      console.log('[Auth] Access token refreshed');
      return true;
    } catch(e) {
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
      /* BLOCKER-1 SLUTFÖRANDE (krav 2 — en ny användare får aldrig ärva
         föregående användares cachade tidposter): körs INNAN den nya
         sessionen sätts, så att (a) ett ev. kvarvarande
         `vift_timeEntries`-värde från FÖREGÅENDE konto på samma enhet
         rensas, och (b) ett fortfarande-i-flykt fetchAndApply()-anrop
         som startades FÖRE denna inloggning epok-ogiltigförklaras — oavsett
         om ett explicit logout() hann köras innan detta login()-anrop eller
         inte (t.ex. ett utgånget-token-scenario, eller en session som
         ersätts via lösenordsåterställning, som går direkt till ny
         inloggning). */
      if (typeof TimeEntriesReadService !== 'undefined') TimeEntriesReadService.resetForAccountChange();
      if (typeof WorkOrdersReadService !== 'undefined') WorkOrdersReadService.resetForAccountChange(); // SÄKERHETSFYND V7
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
  /* ITEM A FIX (round 8, independent-reviewer finding): `redirectTo`
     used to be LIVE's URL, hardcoded, used UNCONDITIONALLY — including
     when this code runs on STAGING. A password-reset email sent from
     STAGING would then link the recipient to the PRODUCTION site's
     reset page, which cannot complete the reset (different Supabase
     project, different users).

     Fix: derive the redirect from the SAME signal `storage.js`/
     `config.js` already use to distinguish STAGING from LIVE — this
     deployment's own `SUPABASE_URL` (baked into storage.js per
     environment; no new mechanism invented). FAIL-CLOSED: if
     `SUPABASE_URL` matches neither known project ref, this refuses to
     send (logs clearly, returns `{ok:false}`) rather than silently
     falling through to the LIVE URL — the exact bug being fixed. */
  /* Produktionsrepots miljööverlägg: endast LIVE-posten. STAGING-
     deployen lägger till sin egen post vid synk till staging-repot
     (CLAUDE.md: stagingens ref/domän får aldrig finnas i produktionsfrontend). */
  _ENV_REDIRECT_BY_PROJECT_REF: {
    'hjplzjsbbowiyoyhdghc': 'https://crm.viftfast.se/#/reset-password'
  },
  _resolveEnvRedirect() {
    const url = (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL) ? SUPABASE_URL : '';
    const ref = Object.keys(this._ENV_REDIRECT_BY_PROJECT_REF).find(function (r) { return url.indexOf(r) !== -1; });
    return ref ? this._ENV_REDIRECT_BY_PROJECT_REF[ref] : null;
  },

  async sendPasswordReset(email) {
    const redirectTo = this._resolveEnvRedirect();
    if (!redirectTo) {
      console.error('[Auth.sendPasswordReset] Kunde inte avgöra miljö från SUPABASE_URL — avbryter FAIL-CLOSED (skickar INTE till produktionens URL som gissning).');
      return { ok: false, error: 'Kunde inte avgöra vilken miljö detta är (STAGING/LIVE) — återställningslänk skickades INTE. Kontakta systemansvarig.' };
    }
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
    /* BLOCKER-1 SLUTFÖRANDE (krav 1 — känsliga tidposter får inte ligga
       kvar efter utloggning): körs vid VARJE väg som når _clearSession()
       — explicit logout() OCH en misslyckad token-refresh — rensar
       `vift_timeEntries` ur localStorage/state OCH epok-ogiltigförklarar
       ett ev. fortfarande pågående fetchAndApply()-anrop I DENNA FLIK
       (krav 4). ANDRA, samtidigt öppna flikar nollställs via
       `_installCrossTabSessionListener()` nedan — se dess kommentar
       för varför det MÅSTE ogiltigförklara `_session` där, inte bara
       cachen (oberoende granskning, fel 2, ANDRA rapporterade
       bristen). Rör ALDRIG `vift_outbox`/`vift_settleIntents`
       (krav 5) — se TimeEntriesReadService.js. */
    if (typeof TimeEntriesReadService !== 'undefined') TimeEntriesReadService.resetForAccountChange();
    if (typeof WorkOrdersReadService !== 'undefined') WorkOrdersReadService.resetForAccountChange(); // SÄKERHETSFYND V7
  },

  /* BLOCKER-1 SLUTFÖRANDE (oberoende granskning, fel 2, ANDRA
     rapporterade bristen — verkligt reproducerad): den FÖRSTA
     rättelsens cross-tab-lyssnare (då i TimeEntriesReadService.js)
     rensade bara cachen/epoken i andra flikar, men lämnade DEN flikens
     `Auth._session` orörd — fliken "trodde" sig alltså fortfarande
     inloggad, och ett HELT NYTT `fetchAndApply()`-anrop (inte bara ett
     redan i-flykt) kunde då fortfarande lyckas och återskapa
     `vift_timeEntries` efter att en ANNAN flik loggat ut, ELLER
     återanvända FÖREGÅENDE användares data efter att en annan flik
     loggat in som en NY användare. Flyttad hit (AuthService.js äger
     redan hela sessionslivscykeln) och korrigerad:

     - `newEmail === oldEmail` (SAMMA användare) betyder en NORMAL
       token-refresh i en annan flik (`_doRefresh()`s `_saveSession()`
       skriver om exakt samma nyckel) — INGEN invalidering görs, annars
       hade en helt vanlig, bakgrunds-refresh i en flik tvingat ALLA
       andra flikar att logga ut i onödan.

       RONDA 4-KORRIGERING (fel 1, verkligt reproducerad): att bara
       IGNORERA en samma-användare-refresh räckte INTE — DENNA fliks
       `_session` behöll då sin GAMLA, redan roterade `refresh_token`
       (Supabase roterar `refresh_token` vid varje förnyelse). Nästa
       gång DENNA flik själv försökte förnya sin (nu ogiltiga) token
       och fick ett 401, anropade den `_clearSession()` — vilket tog
       bort den ANDRA flikens NYARE, fullt giltiga session från den
       DELADE `localStorage`, och den händelsen loggade i sin tur ut
       ÄVEN den andra, egentligen helt oskyldiga fliken. Fixat genom
       att ANTA (kopiera in) den nya sessionen i DENNA flik också vid
       en samma-användare-händelse — ingen flik använder då längre en
       redan inaktuell `refresh_token`.
     - Annars (riktig utloggning, `newValue===null`, ELLER ett genuint
       kontobyte, annan `user_email`): DENNA flikens `_session`
       nollställs OCH `App.showLogin()` visas — matchar exakt vad
       `logout()` redan gör för den flik som själv initierar
       utloggningen.
     - Skriver ALDRIG till `localStorage` själv härifrån (anropar
       INTE `_clearSession()`/`removeItem` rakt av) — vid ett
       kontobyte innehåller `vift_auth_v2` redan den ANDRA flikens
       NYA, giltiga session; om DENNA flik då tog bort den nyckeln
       hade den fliken själv blivit utloggad direkt efter sin egen,
       just lyckade inloggning (en förstörande återkopplingsloop).
     - RONDA 4-KORRIGERING (fel 2, verkligt reproducerad): nollställer
       nu även `state.currentUser` vid en riktig utloggning/kontobyte
       — tidigare lämnades den gamla användaridentiteten kvar i minnet
       trots att `_session` redan var nollställd. Rör ALDRIG
       `vift_outbox`/`vift_settleIntents` (osynkroniserad AO-/
       tiddata) — `state.currentUser` är bara en referens till VEM som
       är inloggad, ingen arbetsdata. */
  _installCrossTabSessionListener() {
    if (this._crossTabListenerInstalled) return;
    this._crossTabListenerInstalled = true;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const self = this;
    window.addEventListener('storage', function (ev) {
      if (!ev || ev.key !== self.SESSION_KEY) return;
      /* RONDA 4-KORRIGERING (fel 1, uppföljning — verkligt reproducerad
         mot egna tester): jämförelsen användes tidigare mot
         `ev.oldValue` — den DELADE localStorage-nyckelns FÖREGÅENDE
         värde, som inte nödvändigtvis har något att göra med DENNA
         flikens EGEN kännedom. Om denna flik redan var utloggad
         (`self._session === null`, t.ex. har aldrig loggat in än) men
         en ANNAN flik loggade in för FÖRSTA gången (`ev.oldValue` då
         `null`), tolkades det felaktigt som ett kontobyte och
         `App.showLogin()` anropades i onödan i denna, redan utloggade
         flik. Jämför nu istället mot DENNA flikens egen, aktuella
         `self._session`s e-post — den enda relevanta referenspunkten
         för om NÅGOT behöver ogiltigförklaras HÄR. Har denna flik
         redan ingen session, finns inget att invalidera eller anta —
         ingen åtgärd. */
      const selfEmail = self._session ? self._session.user_email : null;
      if (selfEmail === null) return;
      let newSession = null, newEmail = null;
      try {
        // Events can be queued behind a newer login/logout. Use the CURRENT
        // shared session rather than the potentially stale event payload.
        const currentRaw = localStorage.getItem(self.SESSION_KEY);
        newSession = currentRaw ? JSON.parse(currentRaw) : null;
        newEmail = newSession ? newSession.user_email : null;
      } catch (e) {}
      if (newEmail !== null && newEmail === selfEmail) {
        /* RONDA 4-KORRIGERING (fel 1): samma användare — anta
           (kopiera in) den NYA sessionen i denna flik också, se
           motiveringen ovan. */
        self._session = newSession;
        return;
      }
      self._session = null;
      if (typeof state !== 'undefined') state.currentUser = null; // RONDA 4-KORRIGERING (fel 2)
      if (typeof TimeEntriesReadService !== 'undefined') TimeEntriesReadService.resetForAccountChange();
      if (typeof WorkOrdersReadService !== 'undefined') WorkOrdersReadService.resetForAccountChange(); // SÄKERHETSFYND V7
      if (typeof App !== 'undefined' && App.showLogin) App.showLogin();
    });
  }
};

Auth._installCrossTabSessionListener();
