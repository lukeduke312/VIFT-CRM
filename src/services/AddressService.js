/**
 * AddressService v4 — Adressautokomplettering (återanvändbar)
 *
 * Koppling via HTML-attribut på adressinputen:
 *   oninput="AddressService.handleInput(this)"
 *   onblur="setTimeout(()=>AddressService.hideSuggestions(),150)"
 *   data-addr-zip="<id>"      — postnummerfält (valfritt)
 *   data-addr-city="<id>"     — stadsfält (valfritt)
 *   data-addr-country="<id>"  — landfält (valfritt)
 *   data-addr-lat="<id>"      — latitudfält (valfritt)
 *   data-addr-lng="<id>"      — longitudfält (valfritt)
 *
 * Om data-addr-zip/city finns:
 *   → adressfältet = gatuadress, zip/city fylls separat
 *   → relaterade fält töms om adressfältet töms
 * Om de saknas:
 *   → adressfältet = fullständig label (gatuadress, postnummer stad)
 *
 * Adresskälla (dataset.addrSource):
 *   'mapbox'   — vald från autocomplete
 *   'customer' — satt från vald kund/fastighet (AO-formulär)
 *   ''         — manuellt inskriven
 *
 * Token: window.VIFT_CONFIG.mapboxToken i config.js (rotmappen).
 * Lämnas tom → tyst fallback till manuell inmatning.
 *
 * NormalizedAddress: { label, address, zip, city, country, lat, lng, provider }
 */

const AddressService = {
  PROVIDER: 'mapbox',
  _debounceTimer: null,
  _results: [],
  _currentInput: null,

  _token() {
    return (window.VIFT_CONFIG && window.VIFT_CONFIG.mapboxToken) || '';
  },

  /* ── Publik API ────────────────────────────────────────────── */

  async search(query) {
    if (!this._token() || (query || '').trim().length < 3) return [];
    try {
      return await this._fetchMapbox(query.trim());
    } catch(e) {
      console.warn('[AddressService] search() fel:', e);
      return [];
    }
  },

  /* ── Mapbox-implementation ─────────────────────────────────── */

  async _fetchMapbox(query) {
    const url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/'
      + encodeURIComponent(query) + '.json'
      + '?access_token=' + encodeURIComponent(this._token())
      + '&country=se&language=sv&types=address&limit=5';
    const res = await fetch(url);
    if (res.status === 401 || res.status === 403) {
      console.warn('[AddressService] Mapbox HTTP ' + res.status + ' — kontrollera token och domänbegränsning i config.js');
      throw new Error('Mapbox HTTP ' + res.status);
    }
    if (!res.ok) throw new Error('Mapbox HTTP ' + res.status);
    const { features = [] } = await res.json();
    return features.map(f => this._normalizeMapbox(f));
  },

  _normalizeMapbox(f) {
    const streetName = f.text    || '';
    const houseNum   = f.address || '';
    const address    = houseNum ? streetName + ' ' + houseNum : streetName;
    let zip = '', city = '', country = 'Sverige';
    (f.context || []).forEach(c => {
      const type = (c.id || '').split('.')[0];
      if      (type === 'postcode') zip     = c.text || '';
      else if (type === 'place')   city    = c.text || '';
      else if (type === 'country') country = c.text || 'Sverige';
    });
    return {
      label:    f.place_name || address,
      address,
      zip,
      city,
      country,
      lat:      f.center ? f.center[1] : null,
      lng:      f.center ? f.center[0] : null,
      provider: 'mapbox'
    };
  },

  /* ── UI ────────────────────────────────────────────────────── */

  handleInput(inputEl) {
    clearTimeout(this._debounceTimer);
    this._currentInput = inputEl;
    const q = (inputEl.value || '').trim();

    if (!this._token()) {
      console.warn('[AddressService] Token saknas — ange window.VIFT_CONFIG.mapboxToken i config.js');
      this.hideSuggestions();
      return;
    }

    /* Töm relaterade fält när adressfältet töms manuellt */
    if (!q) {
      this._clearRelated(inputEl);
      this.hideSuggestions();
      return;
    }

    this._clearCoords(inputEl);
    if (q.length < 3) { this.hideSuggestions(); return; }

    this._debounceTimer = setTimeout(async () => {
      this._renderDropdown(null);
      const results = await this.search(q);
      this._results = results;
      this._renderDropdown(results);
    }, 300);
  },

  _renderDropdown(results) {
    this.hideSuggestions();
    const inputEl = this._currentInput;
    if (!inputEl) return;

    const el = document.createElement('div');
    el.id = 'addr-dropdown-portal';
    el.className = 'addr-dropdown';

    const rect = inputEl.getBoundingClientRect();
    el.style.cssText = [
      'position:fixed',
      'top:'   + (rect.bottom + 4) + 'px',
      'left:'  + rect.left + 'px',
      'width:' + rect.width + 'px',
      'z-index:9999'
    ].join(';');

    if (results === null) {
      el.innerHTML = '<div class="addr-status">Söker adress…</div>';
    } else if (!results.length) {
      el.innerHTML = '<div class="addr-status">Inga adressförslag hittades</div>';
    } else {
      el.innerHTML = results.map((r, i) => {
        const meta = [r.zip, r.city].filter(Boolean).join(' ');
        return '<div class="addr-item" onmousedown="AddressService.selectSuggestion(' + i + ')">'
          + '<div class="addr-item-street">' + this._esc(r.address || r.label) + '</div>'
          + (meta ? '<div class="addr-item-meta">' + this._esc(meta) + '</div>' : '')
          + '</div>';
      }).join('');
    }

    document.body.appendChild(el);
  },

  selectSuggestion(idx) {
    const r = this._results[idx];
    if (!r) return;
    const inputEl = this._currentInput;
    if (!inputEl) return;

    const ds = inputEl.dataset;
    const hasFields = ds.addrZip || ds.addrCity;

    const set = (id, val) => {
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      el.value = val != null ? String(val) : '';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    if (hasFields) {
      inputEl.value = r.address || '';
      set(ds.addrZip,     r.zip     || '');
      set(ds.addrCity,    r.city    || '');
      set(ds.addrCountry, r.country || 'Sverige');
      set(ds.addrLat,     r.lat != null ? r.lat : '');
      set(ds.addrLng,     r.lng != null ? r.lng : '');
    } else {
      /* Inga separata fält — fyll med fullständig adress */
      inputEl.value = r.address
        ? (r.address + (r.zip || r.city ? ', ' + [r.zip, r.city].filter(Boolean).join(' ') : ''))
        : (r.label || '');
    }

    inputEl.dataset.addrSource = 'mapbox';
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));

    this.hideSuggestions();
    inputEl.focus();
  },

  hideSuggestions() {
    document.getElementById('addr-dropdown-portal')?.remove();
  },

  /* Töm koordinatfält (anropas vid varje tangenttryckning för att invalidera gamla koordinater) */
  _clearCoords(inputEl) {
    if (!inputEl) return;
    const ds = inputEl.dataset;
    [ds.addrLat, ds.addrLng].forEach(id => {
      if (!id) return;
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  },

  /* Töm alla relaterade fält (anropas när adressfältet töms) */
  _clearRelated(inputEl) {
    if (!inputEl) return;
    const ds = inputEl.dataset;
    [ds.addrZip, ds.addrCity, ds.addrCountry, ds.addrLat, ds.addrLng].forEach(id => {
      if (!id) return;
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    delete inputEl.dataset.addrSource;
  },

  _esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  },

  /* ── Fas 2: byt mot Lantmäteriet via Supabase Edge Function ─────────────
   *
   * async _fetchLantmateriet(query) {
   *   const res = await fetch('/api/address-search?q=' + encodeURIComponent(query), {
   *     headers: { 'Authorization': 'Bearer ' + Auth.getAccessToken() }
   *   });
   *   if (!res.ok) throw new Error('Edge Function HTTP ' + res.status);
   *   const items = await res.json();
   *   return items.map(r => this._normalizeLantmateriet(r));
   * },
   *
   * _normalizeLantmateriet(r) {
   *   return { label: ..., address: ..., zip: ..., city: ..., country: 'Sverige',
   *            lat: ..., lng: ..., provider: 'lantmateriet' };
   * },
   *
   * Och i search(): byt return await this._fetchMapbox(q)
   *             mot return await this._fetchLantmateriet(q)
   * ─────────────────────────────────────────────────────────────────────── */
};
