/**
 * BrandingService — single source of truth for logos and brand identity.
 *
 * Logos are stored as data URLs (base64) in state.settings.
 * Falls back to static SVG files if no upload exists.
 * Dispatches 'brandingUpdated' so sidebar/login can refresh.
 */
const BrandingService = {
  FALLBACK_LIGHT: '/assets/vift-logo.svg',
  FALLBACK_DARK:  '/assets/vift-logo-white.svg',

  /* Return the logo for light backgrounds (PDF, print, email, login). */
  logoLight() {
    return (state.settings && state.settings.logoLight) || this.FALLBACK_LIGHT;
  },

  /* Return the logo for dark backgrounds (sidebar, hero).
     Falls back to logoLight, then to the dark SVG. */
  logoDark() {
    const s = state.settings || {};
    return s.logoDark || s.logoLight || this.FALLBACK_DARK;
  },

  /* Return a URL suitable for embedding inside a window.open() document.
     data: URLs work as-is; relative paths need an origin prefix. */
  logoLightAbsolute() {
    const u = this.logoLight();
    return u.startsWith('data:') ? u : window.location.origin + u;
  },

  /* Persist partial branding data and notify all consumers. */
  update(data) {
    state.settings = Object.assign({}, state.settings || {}, data);
    persist();
    document.dispatchEvent(new CustomEvent('brandingUpdated'));
  },

  /* Reset a specific logo field back to the built-in SVG fallback. */
  clearLogo(field) {
    const upd = {};
    upd[field] = '';
    this.update(upd);
  },

  /* Called once after App.showApp() to patch the static login logo src. */
  applyToLogin() {
    const img = document.getElementById('login-logo-img');
    if (img) img.src = this.logoLight();
  },
};
