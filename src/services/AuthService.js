/**
 * AuthService — Inloggning och session
 */

const Auth = {

  SESSION_KEY: 'vift_session',

  /**
   * Kontrollera om användaren är inloggad
   */
  isLoggedIn() {
    try {
      const s = sessionStorage.getItem(this.SESSION_KEY);
      return !!s;
    } catch(e) { return false; }
  },

  /**
   * Hämta nuvarande session
   */
  getUser() {
    try {
      const s = sessionStorage.getItem(this.SESSION_KEY);
      return s ? JSON.parse(s) : null;
    } catch(e) { return null; }
  },

  /**
   * Logga in
   */
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

    try {
      sessionStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
    } catch(e) { /* ignore */ }

    state.currentUser = user;
    return { ok: true, user };
  },

  /**
   * Logga ut
   */
  logout() {
    try { sessionStorage.removeItem(this.SESSION_KEY); } catch(e) {}
    state.currentUser = null;
    App.showLogin();
  },

  /**
   * Initiera session vid sidladdning
   */
  init() {
    const user = this.getUser();
    if (user) {
      state.currentUser = user;
      return true;
    }
    return false;
  }
};
