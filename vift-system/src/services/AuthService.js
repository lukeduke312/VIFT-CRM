/**
 * AuthService — Inloggning, session och behörighetskontroll
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

  SESSION_KEY: 'vift_session',

  // Sidor → vilka permissions som räcker (ANY)
  // Tom array = alltid tillgänglig när inloggad
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

  isLoggedIn() {
    try { return !!sessionStorage.getItem(this.SESSION_KEY); } catch(e) { return false; }
  },

  getUser() {
    try {
      const s = sessionStorage.getItem(this.SESSION_KEY);
      return s ? JSON.parse(s) : null;
    } catch(e) { return null; }
  },

  /**
   * Kolla om den inloggade användaren har en specifik behörighet.
   * Söker i rollens permissions (state.roles), inte i sessionen.
   */
  can(permission) {
    const user = this.getUser();
    if (!user) return false;
    const perms = this._getPermsForUser(user);
    return perms.includes('all') || perms.includes(permission);
  },

  /**
   * Kolla om användaren har NÅGON av de angivna behörigheterna.
   * Tom lista → alltid sant (ingen begränsning).
   */
  canAny(permissions) {
    if (!permissions || permissions.length === 0) return true;
    return permissions.some(p => this.can(p));
  },

  /**
   * Kolla om en sida är tillgänglig för inloggad användare.
   */
  canViewPage(pageId) {
    if (!this.isLoggedIn()) return false;
    const required = this.PAGE_PERMISSIONS[pageId];
    if (required === undefined) return true; // okänd sida — tillåt
    return this.canAny(required);
  },

  /**
   * Guard: returnerar true om behörighet finns, annars visar toast och returnerar false.
   * Används inuti onclick-handlers och metoder.
   */
  require(permission) {
    if (this.can(permission)) return true;
    showToast('Du saknar behörighet för den åtgärden');
    return false;
  },

  /**
   * Returnerar alla behörigheter för den inloggade användaren.
   * Slår upp rollens permissions från state.roles (live, inte cachad session).
   */
  _getPermsForUser(user) {
    if (!user) return [];
    const role = (state.roles || []).find(r => r.id === user.role);
    if (role) return role.permissions || [];
    // fallback: staff-level permissions (bakåtkompatibilitet)
    return user.permissions || [];
  },

  login(username, password) {
    const staff = (state.staff || []).find(s =>
      s.active &&
      s.username.toLowerCase() === username.toLowerCase().trim() &&
      s.password === password
    );
    if (!staff) return { ok: false, error: 'Fel användarnamn eller lösenord' };

    const user = {
      id:        staff.id,
      firstName: staff.firstName,
      lastName:  staff.lastName,
      role:      staff.role,
      username:  staff.username,
      title:     staff.title
    };

    try { sessionStorage.setItem(this.SESSION_KEY, JSON.stringify(user)); } catch(e) {}
    state.currentUser = user;
    return { ok: true, user };
  },

  logout() {
    try { sessionStorage.removeItem(this.SESSION_KEY); } catch(e) {}
    state.currentUser = null;
    App.showLogin();
  },

  init() {
    const user = this.getUser();
    if (user) { state.currentUser = user; return true; }
    return false;
  }
};
