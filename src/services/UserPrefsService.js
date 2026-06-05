/**
 * UserPrefsService v48 — Personliga vyinställningar per användare.
 * Sparas i localStorage under nyckel 'vift_prefs_{userId}'.
 * Påverkar ALDRIG PDF, företagets branding eller andra användare.
 */
const UserPrefsService = {

  _key(userId) { return 'vift_prefs_' + (userId || 'default'); },

  get(userId) {
    if (!userId) return {};
    try { return JSON.parse(localStorage.getItem(this._key(userId)) || 'null') || {}; }
    catch(e) { return {}; }
  },

  save(userId, delta) {
    if (!userId) return;
    try {
      const merged = Object.assign({}, this.get(userId), delta, { userId });
      localStorage.setItem(this._key(userId), JSON.stringify(merged));
    } catch(e) {}
  },

  reset(userId) {
    if (!userId) return;
    try { localStorage.removeItem(this._key(userId)); } catch(e) {}
    this.apply(userId);
  },

  /**
   * Applicera sparade preferenser på DOM-roten.
   * Anropas vid inloggning och vid Dashboard.render().
   */
  apply(userId) {
    const p    = this.get(userId);
    const root = document.documentElement;

    // Personlig accentfärg (override av --acc CSS-variabel)
    if (p.accentColor) {
      root.style.setProperty('--acc', p.accentColor);
    } else {
      root.style.removeProperty('--acc');
    }

    // Layout-täthet (kompakt/normal/luftig)
    document.body.dataset.density = p.density || 'normal';
  }
};
