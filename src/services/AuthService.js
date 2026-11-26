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
    'pg-service-intervals': ['customer_manage'],
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
    /* T4-D (2026-11-28, Ö3, R52): fältet med rondering_utfor utför och ser rapporten för sina EGNA pass
       (servern lämnar bara ut egna pass och prövar varje åtgärd per pass under lås). */
    'pg-rondering-utfor':   ['ao_view_all','rondering_utfor'],
    'pg-rondering-rapport': ['ao_view_all','rondering_utfor'],
  },

  /* ── JWT ──────────────────────────────────────────────── */

  /* T3-A: ger aldrig en token om den delade sessionen bytts till en annan
     användare (eller loggats ut) i en annan flik — gäller även tjänster som
     anropar fetch direkt med denna token (bilder, rondering, fakturor, push). */
  getAccessToken() {
    if (!this._session) return null;
    if (!this.assertSessionCurrent()) return null;
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
        this._noSessionAtStart();
        return false;
      }
      const s = JSON.parse(saved);
      if (!s || !s.access_token || !s.refresh_token) {
        this._noSessionAtStart();
        return false;
      }
      this._adoptSession(s, { save: false });
      /* T3-A: cachen får bara användas av sin ägare. En cache utan ägare
         (lämnad av v3.4) eller med en annan ägare rensas innan något läses. */
      if (typeof Storage !== 'undefined' && Storage.claimCache) Storage.claimCache(this.ownerKey());
      return true;
    } catch(e) {
      this._noSessionAtStart();
      return false;
    }
  },

  /* T3-A (SÄK-9): ingen giltig session vid start (utloggad, utgången,
     raderad eller korrupt session) → ingen användarspecifik cache får
     finnas kvar. Rensar hela cachen (inte bara tid/AO som tidigare);
     utkorgar och journaler behålls ägarnycklade (Storage._KEEP_RE). */
  _noSessionAtStart() {
    if (typeof TimeEntriesReadService !== 'undefined') TimeEntriesReadService.resetForAccountChange();
    if (typeof WorkOrdersReadService !== 'undefined') WorkOrdersReadService.resetForAccountChange(); // SÄKERHETSFYND V7
    if (typeof Storage !== 'undefined' && Storage.purgeUserCache) Storage.purgeUserCache();
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
      this._adoptSession(shared, { save: false });
      return { current: false, loggedIn: true };
    }

    /* Logout/account replacement happened elsewhere: invalidate only THIS
       tab. Never write back to the shared key from this branch.
       T3-A: tömmer även fliken (minne, DOM, utkorg i minnet). */
    this._onIdentityLost(shared ? 'switch' : 'logout');
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
      if (d.user && d.user.id) this._session.user_id = d.user.id;
      this._adoptSession(this._session);
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
      /* T3-A (SÄK-9): ny inloggning i denna flik — föregående användares
         data i minnet, DOM och utkorg i minnet tas bort innan den nya
         sessionen sätts. Den delade cachen rensas av claimCache() nedan om
         den tillhör någon annan (eller saknar ägare). Ägarnycklade
         utkorgar/journaler rörs inte. */
      this._endClientSession({ purgeShared: false });
      this._adoptSession({
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expires_at:    Date.now() + (data.expires_in * 1000),
        user_email:    data.user?.email || email.toLowerCase().trim(),
        user_id:       (data.user && data.user.id) || null
      });
      if (typeof Storage !== 'undefined' && Storage.claimCache) Storage.claimCache(this.ownerKey());
      return { ok: true };
    } catch(e) {
      return { ok: false, error: 'Kunde inte ansluta till servern. Kontrollera din uppkoppling.' };
    }
  },

  /* ── Logout ───────────────────────────────────────────── */

  /* T3-A: utloggning från gränssnittet. Finns osynkade ändringar för den
     inloggade användaren visas en tydlig varning med valen "Synka nu",
     "Logga ut ändå" (ändringarna ligger kvar på enheten, ägarnycklade, och
     skickas när samma användare loggar in igen — aldrig av någon annan)
     och "Avbryt". Inget rensas tyst. */
  requestLogout() {
    const pending = this.unsyncedSummary();
    if (!pending.total || typeof Modal === 'undefined') { this.logout(); return; }
    const esc_ = (typeof esc === 'function') ? esc : function (x) { return String(x); };
    const list = pending.parts.map(function (p) { return '<li>' + p.n + ' ' + esc_(p.label) + '</li>'; }).join('');
    const self = this;
    Modal.open({
      title: 'Osynkade ändringar',
      body: '<div style="font-size:14px;line-height:1.5;color:var(--tx);">' +
        '<p><b>' + pending.total + ' osynkad' + (pending.total === 1 ? '' : 'e') + ' ändring' + (pending.total === 1 ? '' : 'ar') + '</b> på den här enheten har inte bekräftats av servern:</p>' +
        '<ul style="margin:8px 0 8px 18px;">' + list + '</ul>' +
        '<p>Välj <b>Synka nu</b> för att försöka skicka dem innan du loggar ut. Loggar du ut ändå ligger de kvar på enheten för ditt konto och skickas när du loggar in igen här — de skickas aldrig i någon annans namn.</p></div>',
      buttons: [
        { label: 'Synka nu', cls: 'btn bp', onClick: function () { Modal.close(); self._syncBeforeLogout(); } },
        { label: 'Logga ut ändå', cls: 'btn bd', onClick: function () { Modal.close(); self.logout(); } },
        { label: 'Avbryt', cls: 'btn bs', onClick: function () { Modal.close(); } }
      ]
    });
  },

  async _syncBeforeLogout() {
    if (typeof showToast === 'function') showToast('Synkar osynkade ändringar…', 2500);
    try {
      const jobs = [];
      if (typeof AOTimeSyncService !== 'undefined' && AOTimeSyncService.syncAllNow) jobs.push(AOTimeSyncService.syncAllNow());
      if (typeof ActivityService !== 'undefined' && ActivityService.flush) jobs.push(ActivityService.flush());
      if (typeof persist === 'function' && typeof _vfJournalPendingCount === 'function' && _vfJournalPendingCount() > 0) jobs.push(persist());
      await Promise.all(jobs.map(function (j) { return Promise.resolve(j).catch(function () {}); }));
    } catch (e) {}
    if (!this._session) return;
    const left = this.unsyncedSummary();
    if (!left.total) {
      if (typeof showToast === 'function') showToast('Allt är synkat — du loggas ut.', 2500);
      this.logout();
      return;
    }
    if (typeof showToast === 'function') showToast('Kunde inte synka allt (' + left.total + ' kvar). Ändringarna finns kvar på enheten.', 5000);
    this.requestLogout();
  },

  /* Osynkat för den inloggade användaren (bara egna, ägarnycklade poster). */
  unsyncedSummary() {
    const parts = [];
    const add = function (label, fn) { try { const n = Number(fn()) || 0; if (n > 0) parts.push({ label: label, n: n }); } catch (e) {} };
    add('arbetsorder-/tidsändringar i kö', function () { return typeof AOTimeSyncService !== 'undefined' ? AOTimeSyncService.pendingCount() : 0; });
    add('osparade registerändringar', function () { return typeof _vfJournalPendingCount === 'function' ? _vfJournalPendingCount() : 0; });
    add('sparningar pågår', function () { return typeof DataSync !== 'undefined' ? (DataSync._pendingWrites || 0) : 0; });
    add('aktivitetsposter i kö', function () { return typeof ActivityService !== 'undefined' && ActivityService.pendingCount ? ActivityService.pendingCount() : 0; });
    return { parts: parts, total: parts.reduce(function (a, p) { return a + p.n; }, 0) };
  },

  logout() {
    const token = this._session ? this._session.access_token : null;
    this._clearSession({ explicit: true });
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
   *
   * T3-A (SÄK-10/F7): ingen reservroll. Tidigare fick en inloggad användare
   * utan matchande, aktiv personalpost rollen 'personal' (och därmed den
   * rollens behörigheter, eller SeedData:s). Nu fail-closed:
   *   - servern nekade inläsningen (403)       → 'no_staff'
   *   - ingen aktiv personalpost med e-posten  → 'no_staff'
   *   - personalpostens roll-id finns inte i
   *     state.roles (eller saknar behörighetslista) → 'no_role'
   *   - personal/roller kommer inte från servern
   *     eller användarens egen cache (bara SeedData,
   *     t.ex. nätfel utan egen cache)           → 'unverified'
   * I alla dessa fall är state.currentUser null: inga behörigheter, inga
   * sidor, ingen meny och ingen data (App.showNoAccess). Inga beslut fattas
   * på rollnamn — bara på om rollen finns och vilka behörigheter den har.
   * Samma matchningsregel som servern (_shared/vift-auth.ts: aktiv personal
   * med samma e-post, rollens permissions-lista).
   */
  _access: { state: 'none', email: null },

  _resolveUser() {
    /* Redan avvisad och tömd i denna inläsning (initState) — behåll beslutet. */
    if (state._wiped && this._access && this._access.state !== 'none' && this._access.state !== 'ok') { state.currentUser = null; return; }
    const email = this._session ? this._session.user_email : null;
    if (!email) { state.currentUser = null; this._access = { state: 'none', email: null }; return; }
    const deny = (why) => { state.currentUser = null; this._access = { state: why, email: email }; this._lastAuthzFp = this._authzFingerprint(); };

    if (state._loadForbidden) return deny('no_staff');
    if (state._authzSource !== 'server' && state._authzSource !== 'cache') return deny('unverified');

    const staff = (state.staff || []).find(s =>
      s && s.active && s.email && String(s.email).toLowerCase() === String(email).toLowerCase()
    );
    if (!staff) {
      console.warn('[Auth] Ingen aktiv personalpost för den inloggade användaren — ingen behörighet (SÄK-10).');
      return deny('no_staff');
    }
    const role = (state.roles || []).find(r => r && r.id === staff.role);
    if (!role || !Array.isArray(role.permissions)) {
      console.warn('[Auth] Personalpostens roll finns inte i rollregistret — ingen behörighet (SÄK-10).');
      return deny('no_role');
    }
    /* T4-A (2026-11-28): en inaktiverad roll ger inga behörigheter — samma regel som servern
       (checkViftAuth, _vift_role_perms, vift_caller_perms). */
    if (role.active === false || role.active === 'false' || role.active === 0 || role.active === '0') {
      console.warn('[Auth] Personalpostens roll är inaktiverad — ingen behörighet (T4-A).');
      return deny('no_role');
    }

    state.currentUser = {
      id:        staff.id,
      firstName: staff.firstName,
      lastName:  staff.lastName,
      role:      staff.role,
      username:  staff.username || staff.email,
      email:     String(staff.email).toLowerCase(),
      title:     staff.title   || ''
    };
    this._access = { state: 'ok', email: email };
    this._lastAuthzFp = this._authzFingerprint();
  },

  /* 'ok' | 'no_staff' | 'no_role' | 'unverified' | 'none' */
  accessState() { return this._access ? this._access.state : 'none'; },

  hasAccess() {
    return !!(this._session && this._session.access_token && state.currentUser && this.accessState() === 'ok');
  },

  /* ── Getters ──────────────────────────────────────────── */

  isLoggedIn() {
    return this.hasAccess();
  },

  getUser() {
    return state.currentUser || null;
  },

  /* ── Behörighetskontroll ──────────────────────────────── */

  can(permission) {
    if (!this.hasAccess()) return false;
    const perms = this._getPermsForUser(this.getUser());
    return perms.includes('all') || perms.includes(permission);
  },

  canAny(permissions) {
    if (!this.hasAccess()) return false;
    if (!permissions || permissions.length === 0) return true;
    return permissions.some(p => this.can(p));
  },

  /* T3-A: fail-closed — en sida som saknas i PAGE_PERMISSIONS visas inte
     (tidigare: alla inloggade). Alla sidor i index.html/Router finns i
     tabellen. */
  canViewPage(pageId) {
    if (!this.isLoggedIn()) return false;
    const required = this.PAGE_PERMISSIONS[pageId];
    if (required === undefined) return false;
    return this.canAny(required);
  },

  require(permission) {
    if (this.can(permission)) return true;
    showToast('Du saknar behörighet för den åtgärden');
    return false;
  },

  /* Behörigheter kommer bara från rollregistret (servern gör likadant).
     Ingen reserv via user.permissions eller rollnamn. */
  _getPermsForUser(user) {
    if (!user) return [];
    const role = (state.roles || []).find(r => r && r.id === user.role);
    return role && Array.isArray(role.permissions) ? role.permissions : [];
  },

  /* ── T3-C (SÄK-8, D-25): samma regler som servern (_vift_authz_check) ──
     Superadmin avgörs bara av behörigheten 'all' i den egna rollen, aldrig av
     roll-id eller rollnamn. Klienten erbjuder bara val som servern godtar;
     servern är ändå den som avgör (403 privilege_escalation/superadmin_required,
     409 last_superadmin). */
  isSuperadmin() {
    if (!this.hasAccess()) return false;
    return this._getPermsForUser(this.getUser()).includes('all');
  },

  /* Behörigheterna i en roll ur rollregistret (tom lista om rollen saknas). */
  rolePerms(roleId) {
    const r = (state.roles || []).find(x => x && x.id === roleId);
    return r && Array.isArray(r.permissions) ? r.permissions : [];
  },

  /* Får den inloggade ge någon rollen? Superadmin: alla. Annars bara roller utan 'all'
     vars behörigheter den inloggade själv har. */
  canAssignRole(roleId) {
    if (!this.hasAccess()) return false;
    if (this.isSuperadmin()) return true;
    const own = this._getPermsForUser(this.getUser());
    const p = this.rolePerms(roleId);
    if (!(state.roles || []).some(x => x && x.id === roleId)) return false;
    return !p.includes('all') && p.every(x => own.includes(x));
  },

  /* Får den inloggade ändra roll, e-post eller aktiv-status på personalposten? */
  canManageStaffAuth(staff) {
    if (!staff || !this.hasAccess()) return false;
    if (this.isSuperadmin()) return true;
    /* Rollen syns inte i det projicerade rollregistret (D-21): den kan ha 'all' eller
       behörigheter utöver ens egna — erbjud inget som servern kan neka. */
    if (!(state.roles || []).some(x => x && x.id === staff.role && Array.isArray(x.permissions))) return false;
    if (this.rolePerms(staff.role).includes('all')) return false;
    const me = this.getUser();
    if (me && me.id === staff.id) return false;
    return true;
  },

  /* Får den inloggade ändra rollens behörigheter (inte egen roll, inte roller med 'all')? */
  canEditRolePerms(roleId) {
    if (!this.hasAccess() || !this.can('admin_manage')) return false;
    if (this.isSuperadmin()) return true;
    const me = this.getUser();
    if (me && me.role === roleId) return false;
    return !this.rolePerms(roleId).includes('all');
  },

  /* ── T3-A: indragna behörigheter i öppen session ──────────
     Anropas efter att personal/roller uppdaterats (DataSync-poll,
     omläsning efter 403, meddelande från en annan flik). Löser om
     användaren; saknas åtkomst nu tas allt bort (no-access-sidan), annars
     lämnas en sida som inte längre är tillåten och menyn ritas om. */
  _authzFingerprint() {
    const u = state.currentUser;
    return JSON.stringify([this.accessState(), u ? u.id : null, u ? u.role : null, u ? this._getPermsForUser(u).slice().sort() : null]);
  },

  _lastAuthzFp: null,
  applyAuthorizationChange(reason) {
    if (!this._session) return false;
    const before = this._lastAuthzFp;
    this._resolveUser();
    if (this.accessState() !== 'ok') {
      this._denyAccess();
      if (reason !== 'broadcast') this._broadcast({ type: 'authz' });
      return true;
    }
    const changed = before !== this._lastAuthzFp;
    const page = (typeof Router !== 'undefined') ? Router.currentPage : null;
    const pageDenied = !!page && !this.canViewPage(page);
    if (!changed && !pageDenied) return false;
    if (changed) {
      console.warn('[Auth] Behörigheterna har ändrats (' + reason + ') — tillämpas direkt.');
      try { if (typeof Sidebar !== 'undefined' && Sidebar.render) Sidebar.render(); } catch (e) {}
      try { if (typeof MobileShell !== 'undefined' && MobileShell.renderBottomNav) MobileShell.renderBottomNav(); } catch (e) {}
    }
    if (pageDenied) {
      try { if (typeof Modal !== 'undefined') Modal.closeAll(); } catch (e) {}
      if (typeof showToast === 'function') showToast('Dina behörigheter har ändrats — du har inte längre tillgång till den sidan.', 6000);
      try { Router.showPage('pg-dash', {}, { replace: true }); } catch (e) {}
    }
    if (changed && reason !== 'broadcast') this._broadcast({ type: 'authz' });
    return true;
  },

  /* Läser om personal och roller från servern (samma atomiska läsväg som
     initState). 403 = servern nekar användaren helt (t.ex. inaktiverad
     personalpost) → ingen åtkomst. Nätfel ändrar ingenting. */
  _authzRefreshing: null,
  refreshAuthorization(reason) {
    if (!this._session || typeof Storage === 'undefined' || !Storage.getAllWithHashes) return Promise.resolve(false);
    if (this._authzRefreshing) return this._authzRefreshing;
    const self = this;
    const owner = this.ownerKey();
    const p = (async function () {
      const r = await Storage.getAllWithHashes(['vift_staff', 'vift_roles'], { authzProbe: true });
      if (!self._session || self.ownerKey() !== owner) return false;
      if (!r.ok) {
        if (/\b403\b/.test(String(r.error || ''))) { state._loadForbidden = true; return self.applyAuthorizationChange(reason); }
        return false;
      }
      if (typeof _vfApplyAuthzSnapshot === 'function') _vfApplyAuthzSnapshot(r.data || {}, r.hashes || {});
      return self.applyAuthorizationChange(reason);
    })().catch(function (e) { console.warn('[Auth] omläsning av behörigheter misslyckades:', e); return false; })
      .finally(function () { if (self._authzRefreshing === p) self._authzRefreshing = null; });
    this._authzRefreshing = p;
    return p;
  },

  /* Storage._authFetch anropar detta vid HTTP 403 (debouncat). */
  _forbiddenTimer: null,
  onServerForbidden() {
    if (!this._session || this._forbiddenTimer) return;
    const self = this;
    this._forbiddenTimer = setTimeout(function () { self._forbiddenTimer = null; self.refreshAuthorization('server_403'); }, 300);
  },

  /* Ingen åtkomst (SÄK-10, eller indragen i öppen session): ta bort all
     data ur minnet, DOM och lokal cache, och visa no-access-sidan.
     Sessionen ligger kvar så att användaren kan logga ut. */
  _denyAccess() {
    const access = this._access && this._access.state !== 'ok' && this._access.state !== 'none' ? this._access : { state: 'no_staff', email: null };
    this._endClientSession({ purgeShared: true });
    this._access = access;
    state.currentUser = null;
    if (typeof App !== 'undefined' && App.showNoAccess) { try { App.showNoAccess(access.state); } catch (e) {} }
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
        this._adoptSession({
          access_token:  params.access_token,
          refresh_token: params.refresh_token || '',
          expires_at:    params.expires_in ? Date.now() + Number(params.expires_in) * 1000 : Date.now() + 3600000,
          user_email:    params.email || ''
        });
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
      this._adoptSession({
        access_token:  d.access_token,
        refresh_token: d.refresh_token || '',
        expires_at:    d.expires_in ? Date.now() + Number(d.expires_in) * 1000 : Date.now() + 3600000,
        user_email:    (d.user && d.user.email) || '',
        user_id:       (d.user && d.user.id) || null
      });
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
    try { localStorage.setItem(this.SESSION_KEY, JSON.stringify(this._session)); this._sessionShared = true; }
    catch(e) { this._sessionShared = false; }
  },

  _sharedSession() {
    try { const raw = localStorage.getItem(this.SESSION_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  },

  /* ── T3-A: identitet (användare + miljö) ──────────────────
     Ägare för cache, utkorgar och journaler = miljö (Supabase-projektets
     ref) + inloggningens e-post (normaliserad); auth-uid sparas i posterna
     när det är känt och kontrolleras då också. `_lastIdentity` är den
     senaste giltiga identiteten i denna flik — en åtgärd som köas efter
     att sessionen just upphört hamnar därför i rätt ägares utkorg. */
  _lastIdentity: null,
  _sessionShared: false,

  envRef() {
    return (typeof Storage !== 'undefined' && Storage.envRef) ? Storage.envRef() : 'okand-miljo';
  },
  identity() {
    const s = this._session;
    if (!s || !s.user_email) return null;
    return { email: String(s.user_email).toLowerCase(), uid: s.user_id || null, env: this.envRef() };
  },
  ownerIdentity() { return this.identity() || this._lastIdentity; },
  ownerKey(id) {
    if (id === undefined) id = this.identity();
    return id ? id.env + '|' + id.email : null;
  },
  /* Får den aktuella sessionen skicka posten? (utkorg, journal, intents) */
  ownsEntry(entry) {
    const id = this.identity();
    if (!id || !entry || !entry.owner) return false;
    if (String(entry.owner).toLowerCase() !== id.email) return false;
    if (entry.env && entry.env !== id.env) return false;
    if (entry.ownerUid && id.uid && entry.ownerUid !== id.uid) return false;
    return true;
  },

  _adoptSession(s, opts) {
    this._session = s;
    const id = this.identity();
    if (id) this._lastIdentity = id;
    if (!opts || opts.save !== false) this._saveSession();
    else this._sessionShared = true;
  },

  /* Stämmer denna fliks session fortfarande med den delade (localStorage)?
     Samma användare med roterade token (annan flik förnyade) antas. Annan
     användare eller ingen delad session = denna fliks identitet är
     inaktuell: fliken töms och inget får skickas. */
  assertSessionCurrent() {
    if (!this._session) return false;
    if (!this._sessionShared) return true;
    const shared = this._sharedSession();
    const mine = String(this._session.user_email || '').toLowerCase();
    if (shared && shared.access_token && String(shared.user_email || '').toLowerCase() === mine) {
      if (shared.access_token !== this._session.access_token || shared.refresh_token !== this._session.refresh_token) this._adoptSession(shared, { save: false });
      return true;
    }
    this._onIdentityLost(shared ? 'switch' : 'logout');
    return false;
  },

  /* Tar bort sessionen. Den DELADE sessionsnyckeln tas bara bort om den
     fortfarande är denna fliks session (samma token, eller vid uttrycklig
     utloggning samma användare) — en annan fliks nya inloggning rörs aldrig. */
  _clearSession(opts) {
    const mine = this._session;
    this._session = null;
    /* V26: inget manuellt _refreshPromise-nollställande behövs här längre —
       se motiveringen i login(). */
    let removedShared = false;
    try {
      const shared = this._sharedSession();
      if (!shared) removedShared = true;
      else if (mine && (shared.refresh_token === mine.refresh_token || shared.access_token === mine.access_token ||
               (opts && opts.explicit && String(shared.user_email || '').toLowerCase() === String(mine.user_email || '').toLowerCase()))) {
        localStorage.removeItem(this.SESSION_KEY);
        removedShared = true;
      }
    } catch(e) {}
    /* BLOCKER-1/T3-A: varje väg hit (utloggning, misslyckad förnyelse,
       utgången session) tömmer fliken; den delade cachen rensas när den
       delade sessionen faktiskt är borta. Utkorgar/journaler behålls. */
    this._endClientSession({ purgeShared: removedShared });
  },

  /* Denna fliks identitet gäller inte längre (utloggning eller kontobyte i
     en annan flik, upptäckt via storage-händelse eller före en sändning).
     Skriver aldrig till den delade sessionen. */
  _onIdentityLost(reason) {
    if (!this._session && !state.currentUser) { this._endClientSession({ purgeShared: false }); return; }
    console.warn('[Auth] Sessionen ändrades i en annan flik (' + reason + ') — fliken töms och visar inloggning.');
    this._session = null;
    this._endClientSession({ purgeShared: false });
    if (typeof App !== 'undefined' && App.showLogin) { try { App.showLogin(); } catch (e) {} }
  },

  /* Tömmer allt användarspecifikt i DENNA flik: minne (state, index,
     baslinjer), pågående läsningar, utkorg i minnet, synk, dialoger och
     renderade sidor/meny. purgeShared: rensa även localStorage-cachen och
     sessionStorage (utkorgar/journaler behålls). */
  _endClientSession(opts) {
    this._access = { state: 'none', email: null };
    if (typeof DataSync !== 'undefined' && DataSync.stop) { try { DataSync.stop(); DataSync._lastSig = null; } catch (e) {} }
    if (typeof TimeEntriesReadService !== 'undefined') TimeEntriesReadService.resetForAccountChange();
    if (typeof WorkOrdersReadService !== 'undefined') WorkOrdersReadService.resetForAccountChange(); // SÄKERHETSFYND V7
    if (typeof ActivityService !== 'undefined' && ActivityService.resetForAccountChange) { try { ActivityService.resetForAccountChange(); } catch (e) {} }
    if (typeof AOTimeSyncService !== 'undefined' && AOTimeSyncService.resetForAccountChange) { try { AOTimeSyncService.resetForAccountChange(); } catch (e) {} }
    if (typeof SelectionModel !== 'undefined' && SelectionModel.clearAll) { try { SelectionModel.clearAll(); } catch (e) {} }
    if (typeof _vfResetClientState === 'function') { try { _vfResetClientState(); } catch (e) { console.warn('[Auth] kunde inte tömma state:', e); } }
    else if (typeof state !== 'undefined') state.currentUser = null;
    this._clearRenderedApp();
    if (opts && opts.purgeShared && typeof Storage !== 'undefined' && Storage.purgeUserCache) Storage.purgeUserCache();
  },

  _clearRenderedApp() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    try { if (typeof Modal !== 'undefined' && Modal.closeAll) Modal.closeAll(); } catch (e) {}
    try { document.querySelectorAll('#modal-root .modal-overlay').forEach(function (el) { el.remove(); }); document.body.classList.remove('modal-open'); } catch (e) {}
    try { document.querySelectorAll('#content-scroll .page .con').forEach(function (el) { el.innerHTML = ''; }); } catch (e) {}
    ['bottom-nav', 'mobile-bottom-nav', 'mobile-more-sheet', 'mobile-clock-status', 'gsearch-dropdown-results'].forEach(function (id) {
      try { const el = document.getElementById(id); if (el) el.innerHTML = ''; } catch (e) {}
    });
    try { const gi = document.getElementById('gsearch-topbar-input'); if (gi) gi.value = ''; } catch (e) {}
    try { const b = document.getElementById('persist-recovery-banner'); if (b) b.remove(); } catch (e) {}
    try {
      if (typeof Router !== 'undefined') { Router.currentPage = null; Router.currentParams = {}; Router.history = []; }
    } catch (e) {}
  },

  /* ── Flikar: storage-händelse (sessionen) + BroadcastChannel (behörigheter) ── */
  _channel: null,
  _broadcast(msg) {
    try {
      const m = Object.assign({ owner: this.ownerKey(), at: Date.now() }, msg);
      if (this._channel) this._channel.postMessage(m);
      else localStorage.setItem('vift_authzPing', JSON.stringify(m));
    } catch (e) {}
  },
  _onBroadcast(m) {
    if (!m || !this._session || m.owner !== this.ownerKey()) return;
    if (m.type === 'authz') this.refreshAuthorization('broadcast');
  },

  /* BLOCKER-1 SLUTFÖRANDE / RONDA 4 (se versionshistoriken för bakgrunden):
     - samma användare (normal token-förnyelse i en annan flik) → anta den
       nya sessionen i denna flik också (ingen flik använder en redan
       roterad refresh_token);
     - annars (utloggning, newValue null, eller annan user_email) → denna
       fliks session nollställs och inloggningen visas;
     - skriver ALDRIG till localStorage själv härifrån (vid kontobyte
       innehåller vift_auth_v2 redan den andra flikens nya session);
     - jämförelsen görs mot DENNA fliks egen session (en redan utloggad
       flik gör ingenting när en annan flik loggar in).
     T3-A: fliken töms nu helt (minne, DOM, utkorg i minnet, synk) — inte
     bara tid/AO — och behörighetsändringar i en flik når andra flikar för
     samma användare via BroadcastChannel ('vift-auth'). */
  _installCrossTabSessionListener() {
    if (this._crossTabListenerInstalled) return;
    this._crossTabListenerInstalled = true;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const self = this;
    window.addEventListener('storage', function (ev) {
      if (!ev) return;
      if (ev.key === 'vift_authzPing' && ev.newValue) { try { self._onBroadcast(JSON.parse(ev.newValue)); } catch (e) {} return; }
      if (ev.key !== self.SESSION_KEY && ev.key !== null) return;
      const selfEmail = self._session ? self._session.user_email : null;
      if (selfEmail === null) return;
      const newSession = self._sharedSession();
      const newEmail = newSession ? newSession.user_email : null;
      if (newEmail !== null && newEmail === selfEmail) {
        self._adoptSession(newSession, { save: false });
        return;
      }
      self._onIdentityLost(newSession ? 'switch' : 'logout');
    });
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this._channel = new BroadcastChannel('vift-auth');
        this._channel.onmessage = function (ev) { try { self._onBroadcast(ev && ev.data); } catch (e) {} };
      }
    } catch (e) { this._channel = null; }
  }
};

Auth._installCrossTabSessionListener();
