/**
 * storage.js — localStorage-wrapper
 * Alla nycklar prefixas med 'vift_'
 */
const Storage = {
  prefix: 'vift_',

  get(key) {
    try {
      const raw = localStorage.getItem(this.prefix + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[Storage] get error', key, e);
      return null;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (e) {
      console.warn('[Storage] set error', key, e);
    }
  },

  remove(key) {
    localStorage.removeItem(this.prefix + key);
  },

  clear() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(this.prefix));
    keys.forEach(k => localStorage.removeItem(k));
  }
};
