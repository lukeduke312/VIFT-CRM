/**
 * AuthService v7 — Supabase Auth + rollbaserade behörigheter
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
 *   reports_view      – Visa rapporter & löneunderlag
 */

const Auth = {

  /* Nyckel i localStorage för JWT-session */
  SESSION_KEY: 'vift_auth_v2',

  /* Intern session-state */
  _session: null,   // { access_token, refresh_token, expires_at, user_email }

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
    'pg-payroll':      ['reports_view'],
    'pg-reports':      ['reports_view'],
    'pg-staff':        ['staff_view','staff_manage'],
    'pg-admin':        ['admin_manage'],
    'pg-recurring':    ['recurring_manage'],
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

  /* ── Token refresh (async) ────────────────────────────── */

  /* Förnya JWT om det löper ut inom 60s. Returnerar true om token är giltig. */
  async refreshIfNeeded() {
    if (!this._session) return false;
    if (this._session.expires_at && Date.now() < this._session.expires_at - 60000) return true;
    try {
      const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
        method:  'POST',
        headers: { 'apikey': SUPABASE_AKEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refresh_token: this._session.refresh_token })
      });
      if (!res.ok) { this._clearSession(); return false; }
      const d = await res.json();
      this._session.access_token  = d.access_token;
      this._session.refresh_token = d.refresh_token;
      this._session.expires_at    = Date.now() + (d.expires_in * 1000);
      this._session.user_email    = d.user?.email || this._session.user_email;
      this._saveSession();
      return true;
    } catch(e) {
      /* Nätverksfel — behåll befintlig token och försök igen nästa anrop */
      return !!this._session.access_token;
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

  /*
   * Anropas synkront vid sidladdning (före session-restore).
   * Parsas URL-hash för tokens från Supabase e-postlänkar.
   * Returnerar 'recovery', 'signup' eller null.
   * Supabase skickar: #access_token=...&type=recovery&...
   */
  handleEmailLink() {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return null;

    const params = {};
    hash.slice(1).split('&').forEach(part => {
      const eq = part.indexOf('=');
      if (eq > 0) params[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
    });

    if (!params.access_token || !params.type) return null;

    this._session = {
      access_token:  params.access_token,
      refresh_token: params.refresh_token || '',
      expires_at:    params.expires_in ? Date.now() + Number(params.expires_in) * 1000 : Date.now() + 3600000,
      user_email:    params.email || ''
    };
    this._saveSession();

    /* Ta bort hashen ur URL utan sidladdning */
    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch(e) {}

    return params.type;  // 'recovery' | 'signup' | 'magiclink' | ...
  },

  /*
   * Skicka återställningslänk till angiven e-post.
   * Kräver bara anon-nyckel — service role key används INTE.
   */
  async sendPasswordReset(email) {
    try {
      const redirectTo = window.location.origin + window.location.pathname;
      const res = await fetch(SUPABASE_URL + '/auth/v1/recover', {
        method:  'POST',
        headers: { 'apikey': SUPABASE_AKEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.toLowerCase().trim(), redirect_to: redirectTo })
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return { ok: false, error: d.msg || d.error || 'Kunde inte skicka återställningslänk.' };
      }
      return { ok: true };
    } catch(e) {
      return { ok: false, error: 'Kunde inte ansluta till servern.' };
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
    try { localStorage.removeItem(this.SESSION_KEY); } catch(e) {}
  }
};
