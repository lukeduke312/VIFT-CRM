/**
 * storage.js v5 — Supabase REST-backend med localStorage-cache
 *
 * Läsning vid start: Supabase i ett enda bulk-anrop, localStorage som fallback.
 * Skrivning: localStorage direkt + Supabase i bakgrunden (fire-and-forget).
 * Auth: JWT från Auth.getAccessToken() injiceras i headers — RLS kräver inloggning.
 * Auth-session hanteras av AuthService — rörs inte här.
 */
const SUPABASE_URL  = 'https://hjplzjsbbowiyoyhdghc.supabase.co';
const SUPABASE_AKEY = 'sb_publishable_y0htroGxexlmICBDPAUn2Q_Qq7NWrSC';

const Storage = {
  prefix: 'vift_',

  /* Bygg headers — anon key som apikey, JWT som Authorization när inloggad */
  _h(contentType) {
    const jwt = (typeof Auth !== 'undefined' && Auth.getAccessToken)
      ? (Auth.getAccessToken() || SUPABASE_AKEY)
      : SUPABASE_AKEY;
    const h = {
      'apikey':        SUPABASE_AKEY,
      'Authorization': 'Bearer ' + jwt
    };
    if (contentType !== false) h['Content-Type'] = 'application/json';
    return h;
  },

  /* Hämta ALL data i ett enda HTTP-anrop (används av initState) */
  async getAll() {
    const res = await fetch(SUPABASE_URL + '/rest/v1/store?select=key,value', { headers: this._h(false) });
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
      .filter(k => k.startsWith(this.prefix) && k !== this.prefix + 'auth_v2')
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
    const aoEntry = pairs.find(function(p) { return p[0] === 'workOrders'; });
    const aoCount = Array.isArray(aoEntry && aoEntry[1]) ? aoEntry[1].filter(function(a) { return !a.deleted && !a.archived; }).length : '?';
    console.log('[Storage.setAll] Skriver ' + pairs.length + ' nycklar till Supabase — aktiva AO: ' + aoCount);
    fetch(SUPABASE_URL + '/rest/v1/store', {
      method:  'POST',
      headers: Object.assign({}, this._h(), { 'Prefer': 'resolution=merge-duplicates' }),
      body:    JSON.stringify(body)
    }).then(function(res) {
      if (res.ok) {
        console.log('[Storage.setAll] Supabase write OK — ' + pairs.length + ' nycklar (inkl. vift_workOrders)');
      } else {
        res.text().then(function(txt) {
          console.error('[Storage.setAll] Supabase write MISSLYCKADES HTTP ' + res.status + ':', txt.substring(0, 300));
        });
      }
    }).catch(function(e) {
      console.error('[Storage.setAll] Nätverksfel vid write:', e.message || e);
    });
  },

  /* Enstaka get */
  async get(key) {
    const k = this.prefix + key;
    try {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/store?key=eq.' + encodeURIComponent(k) + '&select=value',
        { headers: this._h(false) }
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rows = await res.json();
      return rows.length ? rows[0].value : null;
    } catch(e) {
      try { const raw = localStorage.getItem(k); return raw ? JSON.parse(raw) : null; } catch(e2) { return null; }
    }
  },

  /* Enstaka set */
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
      method: 'DELETE', headers: this._h(false)
    }).catch(e => console.warn('[Storage.remove]', key, e));
  },

  /* clear() rensar bara localStorage-cache — inte Supabase */
  clear() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(this.prefix) && k !== this.prefix + 'auth_v2')
      .forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
  }
};
