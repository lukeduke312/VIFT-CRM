/**
 * BrandingService — single source of truth for logos and brand identity.
 *
 * Logos are stored directly as raw strings in their own localStorage keys
 * (vift_logo_light / vift_logo_dark), bypassing the settings JSON blob.
 * This avoids QuotaExceededError from JSON.stringify on large base64 images.
 *
 * Falls back to static SVG files if no upload exists.
 * Dispatches 'brandingUpdated' so sidebar/login can refresh.
 */
const BrandingService = {
  FALLBACK_LIGHT: '/assets/vift-logo.svg',
  FALLBACK_DARK:  '/assets/vift-logo-white.svg',

  _LS_LIGHT: 'vift_logo_light',
  _LS_DARK:  'vift_logo_dark',

  logoLight() {
    try { return localStorage.getItem(this._LS_LIGHT) || this.FALLBACK_LIGHT; } catch(e) { return this.FALLBACK_LIGHT; }
  },

  logoDark() {
    try {
      return localStorage.getItem(this._LS_DARK)
          || localStorage.getItem(this._LS_LIGHT)
          || this.FALLBACK_DARK;
    } catch(e) { return this.FALLBACK_DARK; }
  },

  logoLightAbsolute() {
    const u = this.logoLight();
    return u.startsWith('data:') ? u : window.location.origin + u;
  },

  update(data) {
    try {
      if (data.logoLight !== undefined) {
        if (data.logoLight) localStorage.setItem(this._LS_LIGHT, data.logoLight);
        else localStorage.removeItem(this._LS_LIGHT);
      }
      if (data.logoDark !== undefined) {
        if (data.logoDark) localStorage.setItem(this._LS_DARK, data.logoDark);
        else localStorage.removeItem(this._LS_DARK);
      }
    } catch(e) {
      console.warn('[BrandingService] logo storage failed — image may be too large', e);
    }
    // Non-logo settings (colors, etc.) still go through state/persist
    const nonLogo = Object.assign({}, data);
    delete nonLogo.logoLight;
    delete nonLogo.logoDark;
    if (Object.keys(nonLogo).length > 0) {
      state.settings = Object.assign({}, state.settings || {}, nonLogo);
      persist();
    }
    this.applyColors();
    document.dispatchEvent(new CustomEvent('brandingUpdated'));
  },

  clearLogo(field) {
    try {
      if (field === 'logoLight') localStorage.removeItem(this._LS_LIGHT);
      if (field === 'logoDark')  localStorage.removeItem(this._LS_DARK);
    } catch(e) {}
    document.dispatchEvent(new CustomEvent('brandingUpdated'));
  },

  /* V51B R6 — ROTORSAK till "sidebar syns bara som en smal, klippt
     remsa": Sidebar.render() anropar BrandingService.logoForBg(bg) för
     att välja rätt logotypvariant för sidopanelens bakgrundsfärg — men
     denna metod har ALDRIG funnits i BrandingService (bara logoLight()/
     logoDark() fanns). Anropet kastade därför ett synkront TypeError
     ("BrandingService.logoForBg is not a function") så fort
     Sidebar.render() kördes — INNAN `nav.innerHTML` någonsin sattes och
     INNAN App.showApp() hann nå Router.initFromHash(). Sidopanelen
     renderades alltså som en tom, korrekt bred låda (själva #bottom-nav
     har redan sin CSS-bakgrundsfärg) helt utan nav-poster/ikoner — vilket
     matchar den rapporterade "smal klippt remsa"-observationen exakt.
     Bevisat via en riktig, oförändrad produktions-appskal-reproduktion
     (se RAPPORT-V51B-R6) — felet försvann helt, och ingen ytterligare
     bredd-/overflow-bugg kunde reproduceras, så snart detta metodanrop
     faktiskt gick att köra. Samma ljushetslogik som _yiqText() nedan
     (samma YIQ-formel) — mörk bakgrund → ljus (vit) logotyp, ljus
     bakgrund → mörk/vanlig logotyp, för läsbar kontrast. */
  logoForBg(hex) {
    try {
      const h = (hex || '').replace('#', '');
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
      const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
      const yiq = (r * 299 + g * 587 + b * 114) / 1000;
      return yiq >= 128 ? this.logoLight() : this.logoDark();
    } catch (e) { return this.logoDark(); }
  },

  _yiqText(hex) {
    // Returns '#fff' or '#111' for legible contrast on the given background
    try {
      const h = hex.replace('#','');
      const full = h.length === 3 ? h.split('').map(c=>c+c).join('') : h;
      const r = parseInt(full.slice(0,2),16), g = parseInt(full.slice(2,4),16), b = parseInt(full.slice(4,6),16);
      return (r*299 + g*587 + b*114) / 1000 >= 128 ? '#111827' : '#ffffff';
    } catch(e) { return '#ffffff'; }
  },

  applyColors() {
    const s = state && state.settings ? state.settings : {};
    const hexRe = /^#[0-9a-fA-F]{3,6}$/;
    const primary   = hexRe.test(s.primaryColor   || '') ? s.primaryColor   : '#0f3763';
    const secondary = hexRe.test(s.secondaryColor || '') ? s.secondaryColor : '#1d75d8';
    try {
      document.documentElement.style.setProperty('--brand-primary',        primary);
      document.documentElement.style.setProperty('--brand-secondary',      secondary);
      document.documentElement.style.setProperty('--brand-primary-text',   this._yiqText(primary));
      document.documentElement.style.setProperty('--brand-secondary-text', this._yiqText(secondary));
    } catch(e) {}
  },

  applyToLogin() {
    const img = document.getElementById('login-logo-img');
    if (img) img.src = this.logoLight();
  },
};
