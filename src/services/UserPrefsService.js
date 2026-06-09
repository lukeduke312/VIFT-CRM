/**
 * UserPrefsService v5 — Personliga vyinställningar per användare.
 * Sparas i localStorage under nyckel 'vift_prefs_{userId}'.
 * Påverkar ALDRIG PDF, företagets branding eller andra användare.
 *
 * Accentfärg-API:
 *   previewAccent(hex)        — uppdaterar CSS-variabler direkt, sparar INTE
 *   saveAccent(userId, hex)   — sparar + applicerar; null/'' = återställ till standard
 *   apply(userId)             — applicerar sparade preferenser (anropas vid login/render)
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

  _yiqText(hex) {
    try {
      const h = (hex || '').replace('#', '');
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? '#111827' : '#ffffff';
    } catch(e) { return '#111827'; }
  },

  /**
   * Uppdatera --acc och --acc-text direkt (ingen sparning).
   * Anropas vid live-förhandsgranskning i inställningsmodaler.
   * null/'' = ta bort override → CSS-filen tar över (standard #E8F4FD).
   */
  previewAccent(hex) {
    const root = document.documentElement;
    if (hex) {
      root.style.setProperty('--acc', hex);
      root.style.setProperty('--acc-text', this._yiqText(hex));
    } else {
      root.style.removeProperty('--acc');
      root.style.removeProperty('--acc-text');
    }
  },

  /**
   * Spara accentfärg och applicera omedelbart.
   * null/'' = rensa sparad accentfärg och återgå till standard.
   */
  saveAccent(userId, hex) {
    const color = (hex && hex.trim()) ? hex.trim() : null;
    this.save(userId, { accentColor: color });
    this.apply(userId);
  },

  /**
   * Applicera sparade preferenser på DOM-roten.
   * Anropas vid inloggning och vid Dashboard.render().
   */
  apply(userId) {
    const p    = this.get(userId);
    const root = document.documentElement;

    // Personlig accentfärg (override av --acc och --acc-text CSS-variabler)
    if (p.accentColor) {
      root.style.setProperty('--acc', p.accentColor);
      root.style.setProperty('--acc-text', this._yiqText(p.accentColor));
    } else {
      root.style.removeProperty('--acc');
      root.style.removeProperty('--acc-text');
    }

    // Layout-täthet (kompakt/normal/luftig)
    document.body.dataset.density = p.density || 'normal';

    // Fällbar sidopanel (desktop only — CSS hanterar mobilundantag)
    if (p.sidebarCollapsed) {
      document.body.classList.add('sidebar-collapsed');
    } else {
      document.body.classList.remove('sidebar-collapsed');
    }

    // Sidopanelens position (vänster/höger)
    if (p.sidebarPosition === 'right') {
      document.body.classList.add('sidebar-right');
    } else {
      document.body.classList.remove('sidebar-right');
    }
  }
};
