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
    document.dispatchEvent(new CustomEvent('brandingUpdated'));
  },

  clearLogo(field) {
    try {
      if (field === 'logoLight') localStorage.removeItem(this._LS_LIGHT);
      if (field === 'logoDark')  localStorage.removeItem(this._LS_DARK);
    } catch(e) {}
    document.dispatchEvent(new CustomEvent('brandingUpdated'));
  },

  applyToLogin() {
    const img = document.getElementById('login-logo-img');
    if (img) img.src = this.logoLight();
  },
};
