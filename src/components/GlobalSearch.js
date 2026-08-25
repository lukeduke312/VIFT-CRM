/**
 * GlobalSearch — V50A Global Search MVP
 * (R3: desktop UX correction — centered command overlay restored for
 * Ctrl/Cmd+K, integrated topbar quick-search field, expand control,
 * transient query state)
 *
 * Cmd/Ctrl+K. Läser GlobalSearchService, navigerar via Router.showPage().
 * Read-only mot CRM-data i alla lägen — inga create/update/delete-åtgärder
 * härifrån. Den ENDA tillåtna skrivningen är lokal, per-användare sök-
 * historik i localStorage (se §History nedan) — aldrig persist()/
 * Storage.setAll()/DataSync/state-mutation.
 *
 * TRE UX-ingångar delar EN gemensam fråge-/resultat-/urvalsstate:
 *  - Desktop snabbsök: permanent riktigt textfält i topbaren
 *    (#gsearch-topbar-input) + en kompakt dropdown-panel under fältet
 *    (#gsearch-dropdown), ingen mörk bakgrund/modal. `this._surface='topbar'`.
 *  - Kommandosök (Ctrl/Cmd+K, expand-knappen, mobilens trigger): samma
 *    stora centrerade overlay/dialog som ursprungliga V50A
 *    (#global-search-root → .gsearch-overlay). `this._surface='overlay'`.
 * Bara EN yta kan vara aktiv åt gången — att öppna den ena stänger alltid
 * den andra, aldrig två resultatpaneler samtidigt. Ingen dubblerad
 * sökmotor/state — `GlobalSearchService` och `_index`/`_flat`/
 * `_selectedIdx` är exakt samma oavsett vilken yta som just nu renderar.
 */

const GlobalSearch = {

  TYPE_ICONS: {
    customer: 'users',
    workOrder: 'clipboard-list',
    offer: 'file-text',
    property: 'building-2',
    sales: 'target',
    contract: 'file-check',
    invoice: 'receipt'
  },

  HISTORY_VERSION: 1,
  HISTORY_MAX: 5,
  HISTORY_MIN_LEN: 2,

  _open: false,           // command-overlay öppen
  _topbarOpen: false,      // topbar-dropdown öppen
  _surface: null,          // 'topbar' | 'overlay' | null
  _index: [],
  _flat: [],
  _selectedIdx: -1,
  _debounceTimer: null,
  _closeTimer: null,
  _lastFocused: null,
  _globalListenerAttached: false,
  _topbarWired: false,
  _topbarOutsideHandler: null,

  /* ── Global Cmd/Ctrl+K-lyssnare — registreras en gång ────── */
  initGlobalShortcut() {
    this._applyPlatformShortcutLabel();
    this._wireTopbarInput();
    if (this._globalListenerAttached) return;
    this._globalListenerAttached = true;
    document.addEventListener('keydown', (e) => {
      const isCmdK = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey);
      if (!isCmdK) return;
      if (typeof Auth === 'undefined' || !Auth.isLoggedIn || !Auth.isLoggedIn()) return;
      e.preventDefault();
      /* R3 §18: Ctrl/Cmd+K öppnar ALLTID den stora centrerade kommando-
         sökningen (som ursprungliga V50A) — fokuserar ALDRIG bara det
         permanenta topbar-fältet. Om overlayen redan är öppen, fokusera
         bara om dess fält igen istället för att växla stängt. */
      if (this._open) {
        const overlayInput = document.getElementById('gsearch-input');
        if (overlayInput) overlayInput.focus();
        return;
      }
      this._openOverlayFromTopbar();
    });
  },

  _isDesktop() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches;
  },

  /* R1: den SYNLIGA hinten ska matcha användarens plattform — tangent-
     logiken accepterar redan (och fortsätter acceptera) BÅDA Meta+K och
     Ctrl+K oavsett vad hinten visar. userAgentData.platform används i
     första hand när tillgängligt; annars en robust kombination av
     navigator.platform + navigator.userAgent (inte bara den ensamma,
     numera avskrivna navigator.platform). */
  _isApplePlatform() {
    const uaData = (typeof navigator !== 'undefined') ? navigator.userAgentData : null;
    if (uaData && uaData.platform) return /mac/i.test(uaData.platform);
    const nav = (typeof navigator !== 'undefined') ? navigator : {};
    const combined = String(nav.platform || '') + ' ' + String(nav.userAgent || '');
    return /Mac|iPhone|iPad|iPod/i.test(combined);
  },

  _applyPlatformShortcutLabel() {
    const el = document.getElementById('global-search-trigger-kbd');
    if (el) el.textContent = this._isApplePlatform() ? '⌘K' : 'Ctrl K';
    const el2 = document.getElementById('gsearch-topbar-kbd');
    if (el2) el2.textContent = this._isApplePlatform() ? '⌘K' : 'Ctrl K';
  },

  /* ══════════════════════════════════════════════════════════
     KOMMANDOSÖK — stor centrerad overlay (Ctrl/Cmd+K, expand, mobil)
     ══════════════════════════════════════════════════════════ */

  /* Läser aktuell text i topbar-fältet (om något) och öppnar overlayen med
     den frågan förifylld + resultat direkt synliga. Används av både
     Ctrl/Cmd+K och expand-knappen — samma beteende, en kodväg. */
  _openOverlayFromTopbar() {
    const topbarInput = document.getElementById('gsearch-topbar-input');
    const preset = topbarInput ? topbarInput.value : '';
    /* R3 §F (expand): stäng topbar-dropdownen UTAN att rensa fältets värde
       — värdet ska överföras till overlayen, inte försvinna. Fältet
       nollställs separat, EFTER att preset redan lästs ut ovan, så att
       det aldrig finns två samtidiga "levande" kopior av frågan. */
    this._closeTopbarDropdown(false);
    if (topbarInput) topbarInput.value = '';
    this.open(preset);
  },

  /* opts.query — förifyll overlayens fält och visa matchande resultat
     omedelbart (expand/Ctrl+K-överföring). Utan query: tomt läge/historik,
     som tidigare. */
  open(presetQuery) {
    if (this._open) return;
    const root = document.getElementById('global-search-root');
    if (!root) return;

    /* R1: en tidigare close()'s fördröjda tömning av #global-search-root
       får ALDRIG hinna ta bort DENNA öppning om open() följs av ett snabbt
       close()+open() inom stängningens 200ms-fönster. */
    clearTimeout(this._closeTimer);
    this._closeTimer = null;

    /* R3 §14: bara en yta åt gången — en overlay-öppning stänger alltid
       en ev. öppen topbar-dropdown (utan att rensa dess fält om vi just
       höll på att överföra en fråga från den, se _openOverlayFromTopbar). */
    if (this._topbarOpen) this._closeTopbarDropdown(false);

    this._surface = 'overlay';
    this._lastFocused = document.activeElement;
    this._index = GlobalSearchService.buildIndex();
    this._flat = [];
    this._selectedIdx = -1;

    root.innerHTML = this._shellHtml();
    this._open = true;
    document.body.classList.add('gsearch-open');

    requestAnimationFrame(() => {
      const overlay = document.getElementById('gsearch-overlay');
      if (overlay) overlay.classList.add('open');
    });

    const overlay = document.getElementById('gsearch-overlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.close();
      });
    }
    const input = document.getElementById('gsearch-input');
    if (input) {
      input.addEventListener('input', () => this._onInput(input.value));
      input.addEventListener('keydown', (e) => this._onKeydown(e));
      if (presetQuery) input.value = presetQuery;
      setTimeout(() => {
        input.focus();
        if (presetQuery) { try { input.setSelectionRange(presetQuery.length, presetQuery.length); } catch (e) {} }
      }, 30);
    }

    if (presetQuery && presetQuery.trim()) {
      this._runQuery(presetQuery);
    } else {
      this._renderEmptyState('gsearch-results');
    }
  },

  close() {
    if (!this._open) return;
    this._open = false;
    if (this._surface === 'overlay') this._surface = null;
    clearTimeout(this._debounceTimer);
    const overlay = document.getElementById('gsearch-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      /* R1: kontrollera DOM-identitet innan roten töms — se full förklaring
         i R1-rapporten. En ny open() som redan hunnit rendera ett nytt skal
         gör denna callback till ett no-op istället för att radera det. */
      this._closeTimer = setTimeout(() => {
        this._closeTimer = null;
        const root = document.getElementById('global-search-root');
        if (root && root.firstElementChild === overlay) root.innerHTML = '';
      }, 200);
    } else {
      const root = document.getElementById('global-search-root');
      if (root) root.innerHTML = '';
    }
    document.body.classList.remove('gsearch-open');
    this._flat = [];
    this._selectedIdx = -1;
    if (this._lastFocused && typeof this._lastFocused.focus === 'function' && document.contains(this._lastFocused)) {
      this._lastFocused.focus();
    }
    this._lastFocused = null;
  },

  _shellHtml() {
    return `
      <div class="gsearch-overlay" id="gsearch-overlay" role="dialog" aria-modal="true" aria-label="Global sök">
        <div class="gsearch-panel">
          <div class="gsearch-inputrow">
            <span class="gsearch-icon">${ic('search', 18)}</span>
            <input id="gsearch-input" class="gsearch-input" type="text" placeholder="Sök efter kund, AO, offert, fastighet…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Sök i VIFT">
            <button class="gsearch-close" id="gsearch-close-btn" aria-label="Stäng sök" onclick="GlobalSearch.close()">${ic('x', 18)}</button>
          </div>
          <div class="gsearch-results" id="gsearch-results" role="listbox"></div>
        </div>
      </div>`;
  },

  /* ══════════════════════════════════════════════════════════
     DESKTOP SNABBSÖK — permanent topbar-fält + kompakt dropdown
     ══════════════════════════════════════════════════════════ */

  _wireTopbarInput() {
    if (this._topbarWired) return;
    const input = document.getElementById('gsearch-topbar-input');
    const expandBtn = document.getElementById('gsearch-expand-btn');
    if (!input) return;
    this._topbarWired = true;
    input.addEventListener('focus', () => this._openTopbarDropdown());
    /* R2/R3: efter att ett resultat öppnats via tangentbord (Enter) flyttas
       fokus ALDRIG bort från fältet (Router.showPage() rör inte DOM-fokus),
       så ett efterföljande klick på ett REDAN fokuserat fält utlöser inget
       nytt 'focus'-event i webbläsaren. Utan denna click-lyssnare skulle
       dropdownen då aldrig gå att återöppna efter en tangentbords-
       navigering förrän fältet tappat och återfått fokus på annat sätt. */
    input.addEventListener('click', () => this._openTopbarDropdown());
    input.addEventListener('input', () => this._onInput(input.value));
    input.addEventListener('keydown', (e) => this._onKeydown(e));
    if (expandBtn) {
      expandBtn.addEventListener('click', () => this._openOverlayFromTopbar());
    }
  },

  _openTopbarDropdown() {
    const wrap = document.getElementById('gsearch-topbar-wrap');
    const dropdown = document.getElementById('gsearch-dropdown');
    const input = document.getElementById('gsearch-topbar-input');
    if (!wrap || !dropdown || !input) return;

    /* R3 §14: bara en yta åt gången — om kommando-overlayen råkar vara
       öppen (t.ex. via ett tidigare Ctrl+K), stäng den innan dropdownen
       tar över, så de aldrig kan synas samtidigt. */
    if (this._open) this.close();

    this._surface = 'topbar';
    /* R3 §12/§13: bygg om indexet VARJE gång dropdownen öppnas (inte bara
       "om den inte redan var öppen") — det förra villkoret kunde lämna ett
       inaktuellt index om `_topbarOpen` av någon anledning inte var i takt
       med det faktiska DOM-/stängningsläget (t.ex. efter en navigering som
       stängde dropdownen på ett annat sätt än det vanliga flödet). Att
       alltid bygga om vid sessionsstart (fokus/klick) är fortfarande
       samma princip som §35 — bara robustare, tar bort en trolig
       rotorsak till att nästa sökning inte alltid dök upp direkt. */
    this._index = GlobalSearchService.buildIndex();
    this._flat = [];
    this._selectedIdx = -1;
    this._topbarOpen = true;
    dropdown.classList.add('open');

    if (input.value.trim()) {
      this._runQuery(input.value);
    } else {
      this._renderEmptyState('gsearch-dropdown-results');
    }

    if (!this._topbarOutsideHandler) {
      this._topbarOutsideHandler = (e) => {
        if (!wrap.contains(e.target)) this._closeTopbarDropdown(true);
      };
      document.addEventListener('mousedown', this._topbarOutsideHandler, true);
    }
  },

  /* clearInput=true (standard): rensar fältets värde — används av klick-
     utanför, Escape och efter en genomförd navigering (R3 §9/§10). Anropas
     med false ENDAST när frågan medvetet ska föras vidare till overlayen
     (expand-knappen/Ctrl+K från ett fyllt fält) — annars skulle den
     rensas precis innan den överförs. */
  _closeTopbarDropdown(clearInput) {
    if (clearInput === undefined) clearInput = true;
    if (!this._topbarOpen) return;
    this._topbarOpen = false;
    if (this._surface === 'topbar') this._surface = null;
    clearTimeout(this._debounceTimer);
    const dropdown = document.getElementById('gsearch-dropdown');
    if (dropdown) dropdown.classList.remove('open');
    if (clearInput) {
      const input = document.getElementById('gsearch-topbar-input');
      if (input) input.value = '';
    }
    this._flat = [];
    this._selectedIdx = -1;
  },

  /* ══════════════════════════════════════════════════════════
     Delad fråge-/resultat-/urvalslogik (bägge ytorna)
     ══════════════════════════════════════════════════════════ */

  _activeResultsContainerId() {
    return this._surface === 'topbar' ? 'gsearch-dropdown-results' : 'gsearch-results';
  },

  _onInput(value) {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._runQuery(value), 110);
  },

  _runQuery(value) {
    const q = String(value || '').trim();
    const containerId = this._activeResultsContainerId();
    if (!q) { this._renderEmptyState(containerId); return; }
    const result = GlobalSearchService.rank(this._index, q);
    this._renderResults(result, containerId);
  },

  _renderEmptyState(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const history = this._loadHistory();
    if (history.length) {
      el.innerHTML = `
        <div class="gsearch-history-head">
          <span>SENASTE SÖKNINGAR</span>
          <button type="button" class="gsearch-history-clear" onclick="GlobalSearch._onClearHistoryClick()">Rensa</button>
        </div>
        ${history.map((h, i) => `
          <div class="gsearch-history-row" onclick="GlobalSearch._onHistoryItemClick(${i})">
            <span class="gsearch-row-icon">${ic('clock', 15)}</span>
            <span class="gsearch-history-text">${esc(h.query)}</span>
          </div>`).join('')}`;
    } else {
      el.innerHTML = `<div class="gsearch-hint">Sök efter kund, AO, offert, fastighet, säljchans, kontrakt eller faktura.</div>`;
    }
    this._flat = [];
    this._selectedIdx = -1;
  },

  _renderResults(result, containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!result.groups.length) {
      el.innerHTML = `
        <div class="gsearch-empty">
          <div class="gsearch-empty-title">Inga träffar för "${esc(result.query)}"</div>
          <div class="gsearch-empty-hint">Prova namn, adress, nummer eller e-post.</div>
        </div>`;
      this._flat = [];
      this._selectedIdx = -1;
      return;
    }

    const flat = [];
    let html = '';
    result.groups.forEach(group => {
      html += `<div class="gsearch-group-label">${esc(group.label)}</div>`;
      group.items.forEach(item => {
        const idx = flat.length;
        flat.push(item);
        const inactiveCls = item.isInactive ? ' gsearch-row--inactive' : '';
        html += `
          <div class="gsearch-row${inactiveCls}" id="gsearch-row-${idx}" data-idx="${idx}" role="option" aria-selected="false" onclick="GlobalSearch._openByIdx(${idx})">
            <span class="gsearch-row-icon">${ic(this.TYPE_ICONS[item.type] || 'search', 16)}</span>
            <div class="gsearch-row-text">
              <div class="gsearch-row-title">${esc(item.title)}</div>
              ${item.subtitle ? `<div class="gsearch-row-sub">${esc(item.subtitle)}</div>` : ''}
            </div>
            ${item.meta ? `<span class="gsearch-row-badge">${esc(item.meta)}</span>` : ''}
            ${item.inactiveLabel ? `<span class="gsearch-row-badge gsearch-row-badge--inactive">${esc(item.inactiveLabel)}</span>` : ''}
          </div>`;
      });
    });
    el.innerHTML = html;
    this._flat = flat;
    this._selectedIdx = flat.length ? 0 : -1;
    this._applySelection();
  },

  /* ── Tangentbord (delad — bara den yta som är aktiv lyssnar) ── */
  _onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      /* R3 §10: Escape i topbaren stänger OCH rensar (transient sök) —
         overlayen stänger som tidigare (dess fält försvinner helt med
         DOM-noden, inget extra att rensa där). */
      if (this._surface === 'topbar') this._closeTopbarDropdown(true); else this.close();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); this._move(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); this._move(-1); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this._selectedIdx >= 0 && this._flat[this._selectedIdx]) this._openItem(this._flat[this._selectedIdx]);
      return;
    }
  },

  _move(delta) {
    if (!this._flat.length) return;
    const n = this._flat.length;
    this._selectedIdx = ((this._selectedIdx + delta) % n + n) % n;
    this._applySelection();
  },

  _applySelection() {
    const containerId = this._activeResultsContainerId();
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.gsearch-row').forEach(r => {
      r.classList.remove('sel');
      r.setAttribute('aria-selected', 'false');
    });
    if (this._selectedIdx < 0) return;
    const row = document.getElementById('gsearch-row-' + this._selectedIdx);
    if (row) {
      row.classList.add('sel');
      row.setAttribute('aria-selected', 'true');
      row.scrollIntoView({ block: 'nearest' });
    }
  },

  _openByIdx(idx) {
    const item = this._flat[idx];
    if (item) this._openItem(item);
  },

  /* ── Navigera till valt resultat ──────────────────────── */
  _openItem(item) {
    if (!item || !item.nav) return;
    const wasTopbar = this._surface === 'topbar';
    const activeInput = wasTopbar
      ? document.getElementById('gsearch-topbar-input')
      : document.getElementById('gsearch-input');
    /* R3 §9: historik sparas ALLTID innan frågan rensas (ordningen här är
       avgörande — _closeTopbarDropdown(true) nedan nollställer fältet). */
    if (activeInput) this._recordHistorySuccess(activeInput.value);

    const nav = item.nav;
    Router.showPage(nav.pageId, nav.params || {});
    if (nav.openAfter) {
      setTimeout(() => this._runOpenAfter(nav.openAfter), 60);
    }
    if (wasTopbar) {
      /* R3 §9: en genomförd navigering är alltid en "lämna sökningen"-
         händelse — stäng OCH rensa frågan, precis som klick-utanför/
         Escape. Konsoliderat till samma clearInput=true-väg istället för
         en separat manuell tömning. */
      this._closeTopbarDropdown(true);
    } else {
      this.close();
    }
  },

  /* R1: page-moduler (SalesPage, ContractsPage, ...) är vanliga
     top-level `const`-bindningar i klassiska <script>-taggar — de blir
     ALDRIG egenskaper på `window`. Dispatchas därför explicit mot de
     faktiska lexikala identifierarna istället för window[...]/eval/
     new Function. */
  _runOpenAfter(action) {
    if (!action) return;
    if (action.module === 'SalesPage' && action.method === 'openEdit' && typeof SalesPage !== 'undefined') {
      SalesPage.openEdit.apply(SalesPage, action.args || []);
      return;
    }
    if (action.module === 'ContractsPage' && action.method === '_openDetail' && typeof ContractsPage !== 'undefined') {
      ContractsPage._openDetail.apply(ContractsPage, action.args || []);
    }
  },

  /* ══════════════════════════════════════════════════════════
     Sökhistorik — R2 §16-27, oförändrad arkitektur i R3
     LOKAL, per användare, ENDAST söktermer (aldrig CRM-poster/ID:n).
     Enda tillåtna skrivning i hela GlobalSearch-funktionen: rå
     localStorage.setItem/removeItem under en per-användarnyckel. Aldrig
     persist()/Storage.setAll()/DataSync/state-mutation.
     ══════════════════════════════════════════════════════════ */

  /* R2 §19 KRITISKT: en instabil/kollisionsbenägen identitet ("unknown",
     tomt) får ALDRIG användas som nyckel — historik inaktiveras då helt
     för sessionen istället, sökningen fungerar ändå. `Auth.getUser()` kan
     returnera null i det korta fönstret innan _resolveUser() körts (läses
     alltid vid användningstillfället, aldrig cachat vid modul-load, så det
     fönstret spelar ingen roll här). */
  _historyStorageKey() {
    if (typeof Auth === 'undefined' || !Auth.getUser) return null;
    const user = Auth.getUser();
    const id = user && user.id;
    if (!id || id === 'unknown') return null;
    return 'vift_gsearch_history_v1_' + id;
  },

  _loadHistory() {
    const key = this._historyStorageKey();
    if (!key) return [];
    let raw;
    try { raw = localStorage.getItem(key); } catch (e) { return []; }
    if (!raw) return [];
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return []; }
    if (!parsed || typeof parsed !== 'object' || parsed.version !== this.HISTORY_VERSION || !Array.isArray(parsed.items)) return [];
    return parsed.items
      .filter(it => it && typeof it.query === 'string' && it.query.trim())
      .slice(0, this.HISTORY_MAX)
      .map(it => ({ query: it.query.trim(), usedAt: typeof it.usedAt === 'number' ? it.usedAt : 0 }));
  },

  _saveHistory(items) {
    const key = this._historyStorageKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({ version: this.HISTORY_VERSION, items: items.slice(0, this.HISTORY_MAX) }));
    } catch (e) { /* localStorage otillgängligt/fullt — historik är best-effort, sökningen påverkas inte */ }
  },

  /* R2 §17/§18: sparas ENDAST vid ett faktiskt öppnat resultat (klick/Enter
     via _openItem), aldrig per tangenttryckning. Case-insensitive dedupe —
     samma normaliserade fråga flyttas till toppen istället för att
     dupliceras, med den SENAST inskrivna formen bevarad. */
  _recordHistorySuccess(rawQuery) {
    const key = this._historyStorageKey();
    if (!key) return;
    const trimmed = String(rawQuery || '').trim();
    if (trimmed.length < this.HISTORY_MIN_LEN) return;

    const existing = this._loadHistory();
    const normalizedNew = trimmed.toLowerCase();
    const deduped = existing.filter(h => h.query.toLowerCase() !== normalizedNew);
    deduped.unshift({ query: trimmed, usedAt: Date.now() });
    this._saveHistory(deduped);
  },

  _clearHistory() {
    const key = this._historyStorageKey();
    if (!key) return;
    try { localStorage.removeItem(key); } catch (e) {}
  },

  _onClearHistoryClick() {
    this._clearHistory();
    this._renderEmptyState(this._activeResultsContainerId());
  },

  /* R2 §21/§26: klick på en historikpost fyller i frågan och kör en LIVE
     sökning mot aktuellt state — navigerar ALDRIG direkt till en gammal
     post (historik lagrar bara text, aldrig cachade resultatobjekt/ID:n). */
  _onHistoryItemClick(idx) {
    const history = this._loadHistory();
    const entry = history[idx];
    if (!entry) return;
    const input = this._surface === 'topbar'
      ? document.getElementById('gsearch-topbar-input')
      : document.getElementById('gsearch-input');
    if (input) input.value = entry.query;
    this._runQuery(entry.query);
  }
};
