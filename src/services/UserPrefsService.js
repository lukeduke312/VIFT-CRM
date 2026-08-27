/**
 * UserPrefsService v6 — Enda källan för accentfärg och personliga vyinställningar.
 *
 * INGEN komponent eller sida får anropa
 *   document.documentElement.style.setProperty('--acc', ...)
 * direkt. Alla accentsättningar sker via metoderna nedan.
 *
 * API — accentfärg:
 *   getContrastText(hex)        → '#111827' | '#ffffff'  (YIQ-kontrast)
 *   previewAccent(hex)          → uppdaterar CSS-var live, sparar INTE
 *   saveAccent(userId, hex)     → sparar + applicerar; null/'' = återställ
 *   resetAccent(userId)         → tar bort sparad accent, applicerar standard
 *
 * API — preferenser i övrigt:
 *   save(userId, delta)         → spara godtyckliga preferenser
 *   apply(userId)               → applicera sparade preferenser på DOM-rot
 *   reset(userId)               → rensa ALLA preferenser
 *
 * CSS-variabler som hanteras:
 *   --acc        personlig accentfärg (standard: #E8F4FD via tokens.css)
 *   --acc-text   kontrasterande text för --acc (standard: var(--navy) via tokens.css)
 *
 * Sparas i localStorage under nyckel 'vift_prefs_{userId}'.
 * Påverkar ALDRIG PDF, företagets branding eller andra användares vy.
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
   * Beräkna kontrasterande textfärg för en bakgrundsfärg via YIQ-algoritmen.
   * Returnerar '#ffffff' för mörka bakgrunder och '#111827' för ljusa.
   */
  getContrastText(hex) {
    try {
      const h = (hex || '').replace('#', '');
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? '#111827' : '#ffffff';
    } catch(e) { return '#111827'; }
  },

  // Intern alias — behåll för bakåtkompatibilitet om ngn anropar den
  _yiqText(hex) { return this.getContrastText(hex); },

  /**
   * Förhandsgranska accentfärg live — uppdaterar --acc och --acc-text direkt.
   * Sparar INGENTING till localStorage.
   * hex = null/'' → tar bort override, CSS-filen tar över (standard #E8F4FD).
   */
  previewAccent(hex) {
    const root = document.documentElement;
    if (hex) {
      root.style.setProperty('--acc', hex);
      root.style.setProperty('--acc-text', this.getContrastText(hex));
    } else {
      root.style.removeProperty('--acc');
      root.style.removeProperty('--acc-text');
    }
  },

  /**
   * Spara accentfärg och applicera omedelbart.
   * hex = null/'' → rensa sparad accent, återgå till standard.
   */
  saveAccent(userId, hex) {
    const color = (hex && hex.trim()) ? hex.trim() : null;
    this.save(userId, { accentColor: color });
    this.apply(userId);
  },

  /**
   * Återställ accent till standard och rensa localStorage-värdet.
   */
  resetAccent(userId) {
    this.saveAccent(userId, null);
  },

  /**
   * Applicera sparade preferenser på DOM-roten.
   * Anropas vid inloggning och vid Dashboard.render().
   */
  apply(userId) {
    const p    = this.get(userId);
    const root = document.documentElement;

    // Personlig accentfärg — enda platsen som sätter --acc och --acc-text
    if (p.accentColor) {
      root.style.setProperty('--acc', p.accentColor);
      root.style.setProperty('--acc-text', this.getContrastText(p.accentColor));
    } else {
      root.style.removeProperty('--acc');
      root.style.removeProperty('--acc-text');
    }

    // Layout-täthet (kompakt/normal/luftig)
    // V51B R7.1 §5: Sidebar.js sparade tidigare 'airy' för Luftig medan
    // Dashboard.js/dashboard.css alltid använt 'spacious' för samma val —
    // ett enum-mismatch som fanns innan R7. Sidebar sparar numera 'spacious'
    // (se Sidebar.showSettings()/_setPref()), men ett REDAN SPARAT 'airy'-
    // värde i localStorage rörs INTE (ingen destruktiv migrering) — det
    // normaliseras bara HÄR, vid applicering på DOM-roten, så gammalt och
    // nytt värde alltid renderas identiskt. dashboard.css matchar även
    // [data-density="airy"] direkt som ett andra skyddslager.
    const rawDensity = p.density || 'normal';
    document.body.dataset.density = rawDensity === 'airy' ? 'spacious' : rawDensity;

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
