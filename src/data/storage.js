/**
 * storage.js v3 — Supabase REST-backend med localStorage-cache
 *
 * Alla skrivningar: localStorage direkt + Supabase i bakgrunden (fire-and-forget).
 * Läsning vid start: Supabase i ett enda bulk-anrop, localStorage som fallback.
 * Auth-session hanteras av AuthService via sessionStorage — rörs inte här.
 */
const SUPABASE_URL  = 'https://hjplzjsbbowiyoyhdghc.supabase.co';
const SUPABASE_AKEY = 'sb_publishable_y0htroGxexlmICBDPAUn2Q_Qq7NWrSC';

const Storage = {
  prefix: 'vift_',

  _h() {
    return {
      'apikey':        SUPABASE_AKEY,
      'Authorization': 'Bearer ' + SUPABASE_AKEY,
      'Content-Type':  'application/json'
    };
  },

  /* Hämta ALL data i ett enda HTTP-anrop (används av initState) */
  async getAll() {
    const res = await fetch(SUPABASE_URL + '/rest/v1/store?select=key,value', { headers: this._h() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    const out  = {};
    rows.forEach(r => {
      const k = r.key.startsWith(this.prefix) ? r.key.slice(this.prefix.length) : r.key;
      out[k] = r.value;
    });
    return out;
  },

  /* localStorage-fallback: returnera alla kända nycklar som objekt */
  _localAll() {
    const out = {};
    Object.keys(localStorage)
      .filter(k => k.startsWith(this.prefix))
      .forEach(k => {
        try { out[k.slice(this.prefix.length)] = JSON.parse(localStorage.getItem(k)); } catch(e) {}
      });
    return out;
  },

  /* Skriv ALLA nyckel/värde-par i ett enda HTTP-anrop (används av persist) */
  setAll(pairs) {
    pairs.forEach(([key, value]) => {
      try { localStorage.setItem(this.prefix + key, JSON.stringify(value)); } catch(e) {}
    });
    const body = pairs.map(([key, value]) => ({ key: this.prefix + key, value }));
    fetch(SUPABASE_URL + '/rest/v1/store', {
      method:  'POST',
      headers: Object.assign({}, this._h(), { 'Prefer': 'resolution=merge-duplicates' }),
      body:    JSON.stringify(body)
    }).catch(e => console.warn('[Storage.setAll]', e));
  },

  /* Enstaka get (för individuella nycklar utanför initState) */
  async get(key) {
    const k = this.prefix + key;
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/store?key=eq.' + encodeURIComponent(k) + '&select=value',
        { headers: this._h() }
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      return rows.length ? rows[0].value : null;
    } catch(e) {
      try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; } catch(e2) { return null; }
    }
  },

  /* Enstaka set — localStorage direkt + Supabase i bakgrunden */
  set(key, value) {
    const k = this.prefix + key;
    try { localStorage.setItem(k, JSON.stringify(value)); } catch(e) {}
    fetch(SUPABASE_URL + '/rest/v1/store', {
      method:  'POST',
      headers: Object.assign({}, this._h(), { 'Prefer': 'resolution=merge-duplicates' }),
      body:    JSON.stringify({ key: k, value })
    }).catch(e => console.warn('[Storage.set]', key, e));
  },

  remove(key) {
    const k = this.prefix + key;
    try { localStorage.removeItem(k); } catch(e) {}
    fetch(SUPABASE_URL + '/rest/v1/store?key=eq.' + encodeURIComponent(k), {
      method: 'DELETE', headers: this._h()
    }).catch(e => console.warn('[Storage.remove]', key, e));
  },

  /* clear() rensar bara localStorage — använd Supabase Dashboard för full reset */
  clear() {
    Object.keys(localStorage).filter(k => k.startsWith(this.prefix))
      .forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
  }
};
