/**
 * WorkOrdersPage — AO-lista + skapa-wizard (v33)
 * v33: status-badge som span (fix nested button), tydlig datumvy med svensk text
 */

/* Akut-badge: röd chip med emoji och fetstilstext */
function akutBadge() {
  return `<span class="bdg bdg-red ao-akut-badge">${ic('alert-triangle',11)}Akut</span>`;
}

const WorkOrdersPage = {
  /* Massändringar: definitiva serveravslag (transienta ligger kvar i
     outboxen och skickas om) rapporteras som för enskilda ändringar. */
  _reportBulkRejections(res) {
    if (!res || !Array.isArray(res.failed) || typeof AOTimeSyncService.reportUnhandledRejection !== 'function') return;
    res.failed.filter(f => f.final).forEach(f => {
      const ao = getAO(f.id);
      AOTimeSyncService.reportUnhandledRejection('ao', ao ? WorkOrderService.displayNumberOrPending(ao) : f.id, f.error);
    });
  },

  filter: 'alla',
  q: '',
  viewMode: localStorage.getItem('view-ao') || 'list',

  /* R2.4 — MOBILE SHELL + AO RETURN FIX: transient (module memory only,
     never persisted) return-state for list scroll position, following
     EXACTLY the already-proven CustomersPage pattern (see
     CustomersPage.js's own _pendingReturn/openDetail()/
     _consumeScrollRestore() and their comments for the full rationale —
     not duplicated here). `null` = no pending return. Set by
     openDetail() immediately before navigating away from the list,
     consumed (cleared) UNCONDITIONALLY by _consumeScrollRestore() the
     next time pg-ao renders, regardless of whether the restore was
     actually applied. */
  _pendingReturn: null,

  /* Opens an AO's detail view FROM the list. The only purpose of this
     indirection (instead of letting each entry point call
     Router.showPage directly) is to capture the current scroll position
     IMMEDIATELY before navigation — mirrors CustomersPage.openDetail()
     exactly. No other side effect, no new navigation behavior: calls
     Router.showPage exactly as every entry point already did. Filter/
     search/sort/view-mode state (this.filter, this.q, this._f, etc.) is
     plain module state that Router.showPage() never touches — it is
     naturally preserved across this round trip without any extra code
     here. */
  openDetail(aoId) {
    const scrollEl = document.getElementById('content-scroll');
    this._pendingReturn = { scrollTop: scrollEl ? scrollEl.scrollTop : 0 };
    Router.showPage('pg-ao-detail', { aoId: aoId });
  },

  /* Called by Router.showPage() (see Router.js's small, generic,
     opt-in scroll-restore-owner lookup) every time pg-ao has just
     rendered — regardless of WHY (return navigation, a fresh explicit
     navigation, etc). This function, not Router, decides whether a
     restore actually happens. Rule: restore ONLY if (a) a pending
     return record exists, AND (b) THIS SPECIFIC navigation to pg-ao
     happened via Router.back()/the browser's Back
     (Router._lastNavigationWasBack === true) — NOT via a fresh, explicit
     navigation (e.g. tapping "Arbetsorder" in the sidebar/bottom nav,
     which calls Router.showPage('pg-ao') without going through
     Router.back()). `_pendingReturn` is always cleared as soon as we
     know this is a pg-ao render, whether or not the restore is actually
     applied — otherwise a stale return record could resurface on a
     LATER, unrelated back-navigation. A one-shot value can only be
     consumed once. */
  _consumeScrollRestore(scrollEl) {
    if (Router.currentPage !== 'pg-ao') return false;
    const pending = this._pendingReturn;
    this._pendingReturn = null;
    if (!pending) return false;
    if (!Router._lastNavigationWasBack) return false;

    /* Defensive clamping: a saved value could in theory be NaN/negative/
       infinite (never in practice via this code path, but no exception
       should ever be possible), or larger than what the list can
       currently actually scroll to (e.g. if the list became shorter
       while the detail view was open) — the nearest valid position is
       used instead of writing an invalid scrollTop. */
    let target = pending.scrollTop;
    if (typeof target !== 'number' || !isFinite(target) || target < 0) target = 0;
    const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    if (target > maxScroll) target = maxScroll;

    scrollEl.scrollTop = target;
    return true;
  },

  /* ── Wizard-state ──────────────────────── */
  _wiz: { step: 1, data: {}, modalId: null },

  /* ── Avancerade filter ─────────────────── */
  _f: {
    quick: null,       // 'akut' | 'readyForInvoice' | 'idag' | 'forsenad'
    mine: false,       // bara mina ärenden
    unassigned: false, // bara otilldelade
    staffIds: [],      // specifik personal (OR)
    customer: null,    // kund-ID
    categories: [],    // kategori-slugs (OR, flera tillåtna)
    sort: 'default',   // 'default' | 'updated' | 'scheduled' | 'priority' | 'number' | 'customer' | 'status'
    dir: null          // null = sorteringens naturliga riktning, annars 'asc' | 'desc'
  },
  _fDraft: null,       // Staging-state för filterpanel (null = ingen panel öppen)

  /* ── V3.2 (2026-11-26) — AO-listans arbetsblock ─────────────────────
     Status (en dimension: vilken mängd) och Snabbval (avgränsningar inom
     mängden) visas som två olika kontroller med egna etiketter. Sökningen
     väntar in en kort paus i skrivandet (_SEARCH_DEBOUNCE_MS, 120 ms enligt
     V3-komponentstandarden §5) och ritar bara om resultatlistan — aldrig
     fältet — i stället för hela listan per tangent. Markeringen ligger kvar över
     filterbyten (SPRINT1 §7, SelectionModel oförändrad) men massåtgärder
     och export gäller bara markerade som matchar nuvarande filter och sök
     — de dolda räknas upp i bulk-baren och i varje dialog, aldrig tyst. */
  _pickMode: false,        // "Markera"-läge (mobil/kortvy): kryssrutor visas på varje rad
  _qTimer: null,
  _SEARCH_DEBOUNCE_MS: 120,
  _matchIds: [],           // alla AO som matchar status+filter+sök (sorterade), senaste renderList()
  _matchSet: null,
  _shownSet: null,         // de som faktiskt ritades (begränsade av _limit)

  _defaultFilters(keepSort) {
    const f = this._f || {};
    return { quick: null, mine: false, unassigned: false, staffIds: [], customer: null, property: null, categories: [],
      sort: keepSort ? (f.sort || 'default') : 'default', dir: keepSort ? (f.dir || null) : null };
  },

  render(params) {
    const el = document.getElementById('pg-ao-content');
    if (!el) return;

    // Handle filter params from dashboard/reports navigation — reset filters
    if (params && (params.filter || params.propertyId || params.customerId)) {
      this._f = this._defaultFilters(false);
      if (params.filter) {
        const tabMap = { pool:'pool', planerad:'planerad', pågående:'pågående', klar:'klar', nytt:'nytt', active:'alla' };
        this.filter = tabMap[params.filter] || 'alla';
        if (params.filter === 'akut')            { this._f.quick = 'akut'; this.filter = 'alla'; }
        if (params.filter === 'readyForInvoice') { this._f.quick = 'readyForInvoice'; this.filter = 'klar'; }
        if (params.filter === 'idag')            { this._f.quick = 'idag'; }
        if (params.filter === 'forsenad')        { this._f.quick = 'forsenad'; }
        if (params.filter === 'mine')            { this._f.mine = true; }
        if (params.filter === 'unassigned')      { this._f.unassigned = true; }
      }
      if (params.propertyId) { this._f.property = params.propertyId; this.filter = 'alla'; }
      if (params.customerId) { this._f.customer = params.customerId; this.filter = 'alla'; }
    }

    const aoActions = [
      /* filterItems: export-boundary (V29 §4) — en markering kan i teorin
         innehålla ID:n som lagts till programmatiskt (SelectionModel.toggle()
         från konsolen), utanför vad renderList() någonsin visat den här
         användaren. Export får ALDRIG läcka en AO utanför _canAccessAo().
         V3.2: exporten gäller dessutom bara markerade som matchar nuvarande
         filter och sök — samma regel som övriga massåtgärder. */
      { id: 'export', label: 'Exportera', icon: 'download', type: 'export', filterItems: items => WorkOrdersPage._exportScope(items) },
      { id: 'status', label: 'Ändra status', icon: 'refresh-cw', permission: 'ao_edit', type: 'custom', open: (ids) => WorkOrdersPage._openBulkStatus(ids) },
      { id: 'assign', label: 'Lägg till personal', icon: 'user-plus', permission: 'ao_edit', type: 'custom', open: (ids) => WorkOrdersPage._openBulkAssign(ids) }
    ];
    SelectionModel.init('workOrder', { stateKey: 'workOrders', actions: aoActions, selectionSummary: () => WorkOrdersPage._selectionSummary() });
    this._limit = this.PAGE;
    const advCount = this._f.staffIds.length + (this._f.customer?1:0) + (this._f.property?1:0) + (this._f.categories||[]).length;

    /* V3: antal per status och per snabbfilter, beräknat EN gång per render
       (inte per tangenttryck i sökfältet). */
    const seen = this._permittedList();
    const live = seen.filter(a => !a.archived && !a.deleted);
    const n = { alla: 0, arkiverade: 0, papperskorg: 0 };
    seen.forEach(a => { if (a.deleted) n.papperskorg++; else if (a.archived) n.arkiverade++; });
    live.forEach(a => { n[a.status] = (n[a.status] || 0) + 1; if (a.status !== 'fakturerad') n.alla++; });

    const tabBase = this._baseList();
    const today = tdy();
    const myId = state.currentUser ? state.currentUser.id : null;
    let _r = null;
    const q = {
      mine: myId ? tabBase.filter(a => (a.staff||[]).includes(myId)).length : 0,
      idag: tabBase.filter(a => a.scheduledDate === today).length,
      forsenad: tabBase.filter(a => WorkOrderService.isOverdue(a, today)).length,
      akut: tabBase.filter(a => a.priority === 'akut').length,
      unassigned: tabBase.filter(a => !(a.staff||[]).length).length,
      readyForInvoice: tabBase.filter(a => a.status === 'klar' && !a.invoiceId && WorkOrderService._hasBillableContent(a, (_r = _r || WorkOrderService.billingStatusResolver()))).length,
    };
    const isLive = this.filter !== 'arkiverade' && this.filter !== 'papperskorg';
    const f = this._f;
    const chips = isLive ? [
      myId ? UiKit.chip('Mina', "WorkOrdersPage.toggleQuick('mine')", { on: f.mine, n: q.mine, icon: 'user' }) : '',
      UiKit.chip('Idag', "WorkOrdersPage.toggleQuick('idag')", { on: f.quick === 'idag', n: q.idag, icon: 'calendar' }),
      UiKit.chip('Försenade', "WorkOrdersPage.toggleQuick('forsenad')", { on: f.quick === 'forsenad', n: q.forsenad, icon: 'clock', tone: q.forsenad ? 'danger' : '' }),
      UiKit.chip('Akuta', "WorkOrdersPage.toggleQuick('akut')", { on: f.quick === 'akut', n: q.akut, icon: 'alert-triangle', tone: q.akut ? 'danger' : '' }),
      UiKit.chip('Otilldelade', "WorkOrdersPage.toggleQuick('unassigned')", { on: f.unassigned, n: q.unassigned, icon: 'user-x' }),
      (this.filter === 'alla' || this.filter === 'klar') ? UiKit.chip('Att fakturera', "WorkOrdersPage.toggleQuick('readyForInvoice')", { on: f.quick === 'readyForInvoice', n: q.readyForInvoice, icon: 'receipt' }) : '',
    ].join('') : '';

    const tabBtn = (t) => `<button type="button" class="ft${this.filter===t.key?' on':''}" role="tab" aria-selected="${this.filter===t.key}" onclick="WorkOrdersPage.setFilter('${t.key}')">${esc(t.label)}${n[t.key] ? `<span class="ft-n">${n[t.key]}</span>` : ''}</button>`;
    const opt = (t) => `<option value="${t.key}"${this.filter===t.key?' selected':''}>${esc(t.label)}${n[t.key] ? ' (' + n[t.key] + ')' : ''}</option>`;

    el.innerHTML = `
      <div class="aol">
        <div class="aol-bar">
          <div class="swrap aol-search${this.q ? ' has-q' : ''}">
            <span class="sico">${ic('search',16)}</span>
            <input type="search" id="ao-search"
              placeholder="Sök nummer, uppdrag, kund, adress, personal…"
              value="${esc(this.q)}" oninput="WorkOrdersPage.onSearchInput(this.value)"
              onkeydown="if(event.key==='Enter'){WorkOrdersPage.renderList()}"
              aria-label="Sök arbetsorder" aria-controls="ao-list">
            <button type="button" class="swrap-clear" onclick="WorkOrdersPage.clearSearch()" title="Rensa sökning" aria-label="Rensa sökning">${ic('x',12)}</button>
          </div>
          <div class="aol-bar-right">
            <label class="aol-sort"><span>Sortera</span>
              <select id="ao-sort" onchange="WorkOrdersPage.setSort(this.value)" aria-label="Sortera arbetsorder">${this._sortOptionsHtml()}</select>
            </label>
            <button type="button" class="btn bs bsm ao-filter-btn${advCount?' ao-filter-active':''}" onclick="WorkOrdersPage.openFilterPanel()" title="Personal, kategori och kund">
              ${ic('sliders',14)} Filter${advCount ? ` <span class="aol-badge">${advCount}</span>` : ''}
            </button>
            <div class="ao-overflow-wrap">
              <button type="button" class="btn bs bsm ao-overflow-btn" id="ao-ovf-btn-wo" aria-label="Fler åtgärder" title="Fler åtgärder: importera och exportera" aria-haspopup="menu" aria-expanded="false" onclick="aoToggleOverflow('ao-ovf-wo',this)">${ic('more-vertical',15)}</button>
              <div class="ao-overflow-menu" id="ao-ovf-wo" role="menu">
                ${Auth.can('ao_edit') ? `<button class="ao-overflow-menu-item" role="menuitem" onclick="aoCloseOverflow();Router.showPage('pg-import-wizard',{type:'workOrder'})">${ic('upload',13)} Importera</button>` : ''}
                <button class="ao-overflow-menu-item" role="menuitem" onclick="aoCloseOverflow();ImportExportService.showExportMenu('workOrder',this)">${ic('download',13)} Exportera</button>
              </div>
            </div>
            ${Auth.can('ao_create') ? `<button type="button" class="btn bp bsm aol-new" onclick="WorkOrdersPage.openCreate()">${ic('plus',15)} Ny order</button>` : ''}
          </div>
        </div>
        <div class="aol-filters">
          <div class="ao-tabs-row aol-frow aol-frow-status">
            <span class="aol-flabel" id="aol-lbl-status">Status</span>
            <label class="aol-status-sel"><span class="sr-only">Status</span>
              <select onchange="WorkOrdersPage.setFilter(this.value)" aria-labelledby="aol-lbl-status">
                <optgroup label="Status">${this.STATUS_TABS.map(opt).join('')}</optgroup>
                <optgroup label="Övrigt">${this.MODE_TABS.map(opt).join('')}</optgroup>
              </select>
            </label>
            <div class="ftabs ao-status-tabs" role="tablist" aria-labelledby="aol-lbl-status">
              ${this.STATUS_TABS.map(tabBtn).join('')}<span class="aol-tab-sep" aria-hidden="true"></span>${this.MODE_TABS.map(tabBtn).join('')}
            </div>
          </div>
          ${isLive ? `<div class="ao-quick-row aol-frow aol-frow-quick">
            <span class="aol-flabel" id="aol-lbl-quick">Snabbval</span>
            <div class="ao-quick" role="group" aria-labelledby="aol-lbl-quick">${chips}</div>
          </div>` : ''}
        </div>
        <div id="ao-active-filters"></div>
        <div id="ao-list"></div>
      </div>`;
    this.renderList();
  },

  STATUS_TABS: [
    { key:'alla',        label:'Aktiva' },
    { key:'nytt',        label:'Nytt' },
    { key:'pool',        label:'Pool' },
    { key:'planerad',    label:'Planerad' },
    { key:'pågående',    label:'Pågående' },
    { key:'klar',        label:'Klar' },
    { key:'fakturerad',  label:'Fakturerad' }
  ],
  /* Arkiv och papperskorg är lägen, inte arbetsflödesstatusar — samma
     kontroll som förut, men avskilda. */
  MODE_TABS: [
    { key:'arkiverade',  label:'Arkiv' },
    { key:'papperskorg', label:'Papperskorg' }
  ],

  /* Snabbfilter: ett klick slår på, ett till slår av. "Mina" och
     "Otilldelade" utesluter varandra (samma regel som renderList). */
  toggleQuick(key) {
    const f = this._f;
    if (key === 'mine') { f.mine = !f.mine; if (f.mine) { f.unassigned = false; f.staffIds = []; } }
    else if (key === 'unassigned') { f.unassigned = !f.unassigned; if (f.unassigned) { f.mine = false; f.staffIds = []; } }
    else f.quick = f.quick === key ? null : key;
    this.render();
  },

  /* V3: stegvis visning — stora listor (tusentals AO) ritas i omgångar.
     Sök, filter och antal gäller alltid hela urvalet; "Välj alla" gäller
     de rader som visas, "Markera alla N som matchar" hela urvalet. */
  PAGE: 150,
  STEP: 300,
  _limit: 150,
  showMore() {
    this._limit = (this._limit || this.PAGE) + this.STEP;
    this.renderList();
  },
  showAll() {
    this._limit = Infinity;
    this.renderList();
  },

  /* ── Sortering ─────────────────────────── */
  /* Korta etiketter: den stängda väljaren är bara ~80 px bred på 360 px
     (Filter, ⋮ och Ny order delar raden) — längre text klipptes.
     Pilen följer kolumnrubrikernas: ↑ stigande, ↓ fallande. */
  _SORTS: {
    default:   { label: 'Standard',  dir: 'asc'  },
    scheduled: { label: 'Datum',     dir: 'asc'  },
    updated:   { label: 'Ändrad',    dir: 'desc' },
    priority:  { label: 'Prioritet', dir: 'asc'  },
    number:    { label: 'AO-nr',     dir: 'asc'  },
    customer:  { label: 'Kund',      dir: 'asc'  },
    status:    { label: 'Status',    dir: 'asc'  }
  },
  _SORT_OPTIONS: [
    ['default', 'Standard'],
    ['scheduled', 'Datum ↑'],
    ['scheduled:desc', 'Datum ↓'],
    ['updated', 'Ändrad'],
    ['priority', 'Prioritet'],
    ['number', 'AO-nr ↑'],
    ['number:desc', 'AO-nr ↓'],
    ['customer', 'Kund A–Ö'],
    ['customer:desc', 'Kund Ö–A'],
    ['status', 'Status']
  ],
  _sortKey() { return this._SORTS[this._f.sort] ? this._f.sort : 'default'; },
  _sortDir() { const k = this._sortKey(); return this._f.dir === 'asc' || this._f.dir === 'desc' ? this._f.dir : this._SORTS[k].dir; },
  _sortValue() { const k = this._sortKey(); const d = this._sortDir(); return d === this._SORTS[k].dir ? k : k + ':' + d; },
  _sortOptionsHtml() {
    const cur = this._sortValue();
    const opts = this._SORT_OPTIONS.slice();
    if (!opts.some(o => o[0] === cur)) opts.unshift([cur, this._SORTS[this._sortKey()].label + (this._sortDir() === 'asc' ? ' ↑' : ' ↓')]);
    return opts.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  },

  setSort(v) {
    const parts = String(v || 'default').split(':');
    const key = this._SORTS[parts[0]] ? parts[0] : 'default';
    this._f.sort = key;
    this._f.dir = (parts[1] === 'asc' || parts[1] === 'desc') && parts[1] !== this._SORTS[key].dir ? parts[1] : null;
    this._syncSortSelect();
    this.renderList();
  },

  /* Klick på en kolumnrubrik: sortera på kolumnen; klick igen vänder ordningen. */
  sortBy(key) {
    if (!this._SORTS[key]) return;
    if (this._sortKey() === key) {
      const d = this._sortDir() === 'asc' ? 'desc' : 'asc';
      this._f.dir = d === this._SORTS[key].dir ? null : d;
    } else {
      this._f.sort = key;
      this._f.dir = null;
    }
    this._syncSortSelect();
    this.renderList();
  },

  _syncSortSelect() {
    const sel = document.getElementById('ao-sort');
    if (sel) sel.innerHTML = this._sortOptionsHtml();
  },

  /* Sortering med förberäknade nycklar (en gång per post, inte per jämförelse).
     Samma ordning som tidigare för de befintliga lägena; sista nyckel är alltid
     ursprunglig ordning så att resultatet är stabilt. */
  _sortList(list) {
    const key = this._sortKey();
    const mult = this._sortDir() === this._SORTS[key].dir ? 1 : -1;
    const pOrd = { akut: 0, hög: 1, normal: 2, låg: 3 };
    const sOrd = { nytt: 0, pool: 1, planerad: 2, pågående: 3, klar: 4, avbruten: 5, fakturerad: 6 };
    const coll = (typeof Intl !== 'undefined' && Intl.Collator) ? new Intl.Collator('sv', { numeric: true, sensitivity: 'base' }) : null;
    const cmpStr = (a, b) => coll ? coll.compare(a, b) : (a < b ? -1 : a > b ? 1 : 0);
    const ts = (v) => { const t = v ? Date.parse(v) : NaN; return isNaN(t) ? 0 : t; };
    const rows = list.map((a, i) => {
      const r = { a, i, p: pOrd[a.priority] !== undefined ? pOrd[a.priority] : 2, c: ts(a.createdAt) };
      if (key === 'updated') r.k = ts(a.updatedAt || a.createdAt);
      else if (key === 'scheduled') { r.k = a.scheduledDate || ''; r.k2 = String(a.scheduledStart || ''); }
      else if (key === 'number') {
        const lbl = String(WorkOrderService.displayNumberOrPending(a) || '');
        const m = /^[A-Za-zÅÄÖåäö]+-(\d{1,9})$/.exec(lbl);
        r.k = m ? Number(m[1]) : null; r.k2 = lbl;
      } else if (key === 'customer') {
        const cu = a.customerId ? getCu(a.customerId) : null;
        r.k = String(cu ? CustomerService.displayName(cu) : (a.customerName || '')).trim();
      } else if (key === 'status') r.k = sOrd[a.status] !== undefined ? sOrd[a.status] : 9;
      return r;
    });
    const tie = (x, y) => (x.p - y.p) || (y.c - x.c) || (x.i - y.i);
    rows.sort((x, y) => {
      let d = 0;
      switch (key) {
        case 'updated':  d = (y.k - x.k) * mult; return d || (x.i - y.i);
        case 'priority': d = (x.p - y.p) * mult; return d || (x.i - y.i);
        case 'scheduled':
          if (!x.k && !y.k) return x.i - y.i;
          if (!x.k) return 1;                      // utan datum sist i båda riktningarna
          if (!y.k) return -1;
          if (x.k !== y.k) return (x.k < y.k ? -1 : 1) * mult;
          if (x.k2 !== y.k2) return (x.k2 < y.k2 ? -1 : 1) * mult;
          return x.i - y.i;
        case 'number':
          if (x.k === null && y.k === null) d = cmpStr(x.k2, y.k2);
          else if (x.k === null) return 1;          // utan nummer (t.ex. "sparas…") sist
          else if (y.k === null) return -1;
          else d = (x.k - y.k) || cmpStr(x.k2, y.k2);
          return (d * mult) || (x.i - y.i);
        case 'customer':
          if (!x.k && !y.k) return tie(x, y);
          if (!x.k) return 1;                      // utan kund sist
          if (!y.k) return -1;
          d = cmpStr(x.k, y.k);
          return (d * mult) || tie(x, y);
        case 'status':   d = (x.k - y.k) * mult; return d || tie(x, y);
        default:         return tie(x, y);         // prioritet, sedan senast skapad
      }
    });
    return rows.map(r => r.a);
  },

  /* AO som användaren får se (behörighet), alla statusar och lägen. */
  _permittedList() {
    let list = state.workOrders || [];
    const canViewAll = Auth.can('ao_view_all') || Auth.can('all');
    if (!canViewAll && Auth.can('ao_view_own') && state.currentUser) {
      const myId = state.currentUser.id;
      list = list.filter(a => (a.staff||[]).includes(myId) || a.status === 'pool');
    }
    return list;
  },

  /* Avancerade filter (personal/kund/fastighet/kategori) som chips —
     snabbfiltren visas redan som egna chips ovanför. (Behålls för
     bakåtkompatibilitet; sidan visar nu en samlad rad, _summaryHtml.) */
  _advChipsHtml() {
    const f = this._f;
    const saved = { quick: f.quick, mine: f.mine, unassigned: f.unassigned };
    f.quick = null; f.mine = false; f.unassigned = false;
    let html = '';
    try { html = this._activeChipsHtml(); } finally { Object.assign(f, saved); }
    return html;
  },

  setView(mode) {
    this.viewMode = mode === 'grid' ? 'grid' : 'list';
    try { localStorage.setItem('view-ao', this.viewMode); } catch (e) {}
    this.render();
  },

  toggleView() {
    this.setView(this.viewMode === 'list' ? 'grid' : 'list');
  },

  /* "Markera" (mobil och kortvy): visar kryssrutor på varje rad; ett tryck
     på raden markerar i stället för att öppna. Påverkar inte vad som är
     markerat. */
  togglePick() {
    this._pickMode = !this._pickMode;
    this.renderList();
  },

  setFilter(f) {
    this.filter = f;
    this.render();
  },

  /* ── Sök ───────────────────────────────── */
  onSearchInput(v) {
    this.q = v || '';
    if (this._qTimer) { clearTimeout(this._qTimer); this._qTimer = null; }
    const wrap = document.querySelector('#pg-ao .aol-search');
    if (wrap) wrap.classList.toggle('has-q', !!this.q);
    this._qTimer = setTimeout(() => { this._qTimer = null; this.renderList(); }, this._SEARCH_DEBOUNCE_MS);
  },

  clearSearch() {
    this.q = '';
    const inp = document.getElementById('ao-search');
    if (inp) { inp.value = ''; inp.focus(); }
    const wrap = document.querySelector('#pg-ao .aol-search');
    if (wrap) wrap.classList.remove('has-q');
    this.renderList();
  },

  /* Rensa filter: tillbaka till Aktiva utan snabbval, filter eller sökning.
     Sorteringen behålls (den är ett visningsval, inget filter). */
  resetFilters() {
    this.filter = 'alla';
    this._f = this._defaultFilters(true);
    this.q = '';
    this.render();
  },

  /* Snabb statusbyte direkt från listvy/kortvy */
  quickSetStatus(aoId, newStatus) {
    if (!newStatus || !aoId) return;
    if (!Auth.require('ao_edit')) return;
    const ao = (state.workOrders||[]).find(a => a.id === aoId);
    if (!ao || ao.status === newStatus) return;
    ao.status = newStatus;
    ao.updatedAt = new Date().toISOString();
    if (typeof WorkOrderService !== 'undefined' && typeof WorkOrderService._syncAO === 'function') {
      WorkOrderService._syncAO(ao, { status: ao.status, updatedAt: ao.updatedAt });
    }
    persist();
    Sidebar.updateBadges();
    WorkOrdersPage.renderList();
    showToast(WorkOrderService.displayNumberOrPending(ao) + ': ' + statusLabel(newStatus));
  },

  /* Flytande statuspopover — öppnas vid klick på status-badge i listan.
     AO-id:t skickas aldrig in i inline-hanterare (data-attribut + closure). */
  openStatusPop(event, aoId) {
    event.stopPropagation();
    document.getElementById('ao-spop')?.remove();
    if (!Auth.can('ao_edit')) return;
    const STATUSES = ['nytt','pool','planerad','pågående','klar','avbruten'];
    const pop = document.createElement('div');
    pop.id = 'ao-spop';
    pop.className = 'ao-spop';
    pop.innerHTML = STATUSES.map(s =>
      `<button type="button" class="ao-spop-item" data-status="${s}">${sbdg(s)}</button>`
    ).join('');
    pop.querySelectorAll('.ao-spop-item').forEach(b => b.addEventListener('click', () => {
      pop.remove();
      WorkOrdersPage.quickSetStatus(aoId, b.getAttribute('data-status'));
    }));
    document.body.appendChild(pop);

    const btn  = event.currentTarget || event.target;
    const rect = btn.getBoundingClientRect();
    const popW = 190;
    let left = rect.left + window.scrollX;
    let top  = rect.bottom + window.scrollY + 4;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    if (rect.bottom + 260 > window.innerHeight) top = rect.top + window.scrollY - pop.offsetHeight - 4;
    pop.style.left = left + 'px';
    pop.style.top  = top  + 'px';

    const close = (e) => {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', close, true); }
    };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  },

  /* ── Radhändelser (id läses ur data-sel-row-id, aldrig ur inline-kod) ── */
  _rowId(el) {
    const row = el && el.closest ? el.closest('[data-sel-row-id]') : null;
    return row ? row.getAttribute('data-sel-row-id') : null;
  },
  _rowClick(el) {
    const id = this._rowId(el);
    if (!id) return;
    if (this._pickMode && SelectionModel.count() === 0) { SelectionModel.toggle(id); return; }
    SelectionModel.rowClick(id, () => WorkOrdersPage.openDetail(id));
  },
  _rowKey(ev, el) {
    if (ev.target !== el) return;
    const id = this._rowId(el);
    if (!id) return;
    if (ev.key === 'Enter') { WorkOrdersPage.openDetail(id); }
    else if (ev.key === ' ' || ev.key === 'Spacebar') { ev.preventDefault(); SelectionModel.toggle(id); }
  },
  _statusBtn(ev, el) {
    const id = this._rowId(el);
    if (id) this.openStatusPop(ev, id);
  },
  _rowAction(ev, el, act) {
    ev.stopPropagation();
    const id = this._rowId(el);
    if (!id) return;
    if (act === 'restoreArchive') { WorkOrderDetailPage._restoreFromArchive(id); WorkOrdersPage.render(); }
    else if (act === 'restoreTrash') { WorkOrderDetailPage._restoreFromTrash(id); WorkOrdersPage.render(); }
    else if (act === 'delete') { WorkOrderDetailPage._confirmPermanentDelete(id); }
  },

  /* ── Filter helpers ────────────────────── */

  /* Statusurval (flik) ur en redan behörighetsfiltrerad lista. */
  _statusFilter(list) {
    if (this.filter === 'arkiverade') return list.filter(a => a.archived && !a.deleted);
    if (this.filter === 'papperskorg') return list.filter(a => a.deleted);
    list = list.filter(a => !a.archived && !a.deleted);
    // "Aktiva" visar alla ej fakturerade AO
    if (this.filter === 'alla') return list.filter(a => a.status !== 'fakturerad');
    return list.filter(a => a.status === this.filter);
  },

  /* Basurval för aktuell flik — samma logik som renderList(), utan avancerade filter.
   * Används för att räkna korrekt i filterpanelen. */
  _baseList() {
    return this._statusFilter(this._permittedList());
  },

  /* Snabbval + avancerade filter (bara i levande lägen, som förut). */
  _narrowFilter(list, today) {
    if (this.filter === 'arkiverade' || this.filter === 'papperskorg') return list;
    const f = this._f;
    if (f.quick === 'akut')            list = list.filter(a => a.priority==='akut');
    if (f.quick === 'readyForInvoice') { let _r = null; list = list.filter(a => a.status==='klar' && !a.invoiceId && WorkOrderService._hasBillableContent(a, (_r = _r || WorkOrderService.billingStatusResolver()))); } // L1: one candidate pass
    if (f.quick === 'idag')            list = list.filter(a => a.scheduledDate===today);
    if (f.quick === 'forsenad')        list = list.filter(a => WorkOrderService.isOverdue(a, today));
    // Personal
    if (f.mine) {
      const myId = state.currentUser ? state.currentUser.id : null;
      if (myId) list = list.filter(a => (a.staff||[]).includes(myId));
    } else if (f.unassigned) {
      list = list.filter(a => !(a.staff||[]).length);
    } else if (f.staffIds.length) {
      list = list.filter(a => f.staffIds.some(id => (a.staff||[]).includes(id)));
    }
    // Kund / Fastighet / Kategori (categories är en array — OR-logik inom typen)
    if (f.customer)  list = list.filter(a => a.customerId===f.customer);
    if (f.property)  list = list.filter(a => a.propertyId===f.property);
    if ((f.categories||[]).length) list = list.filter(a => f.categories.includes(a.category));
    return list;
  },

  /* Fritextsökning. Uppslag via index (getCu/getObj/getStaff) i stället för
     linjär sökning per AO; synligt AO-nummer (displayNumber) ingår. */
  _searchFilter(list) {
    const words = String(this.q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return list;
    const catLabel = new Map((typeof AO_CATEGORIES !== 'undefined' ? AO_CATEGORIES : []).map(c => [c.slug, c.label]));
    const nrm = s => (s||'').toLowerCase().replace(/å/g,'a').replace(/ä/g,'a').replace(/ö/g,'o');
    const staffName = new Map();
    const nameOf = (id) => {
      if (staffName.has(id)) return staffName.get(id);
      const s = getStaff(id); const v = s ? s.firstName + ' ' + s.lastName : '';
      staffName.set(id, v); return v;
    };
    const nw = words.map(w => { const x = nrm(w); return { x, d: x.replace(/\D/g, '') }; });
    return list.filter(ao => {
      const cu       = ao.customerId ? getCu(ao.customerId) : null;
      const prop     = ao.propertyId ? getObj(ao.propertyId) : null;
      const stfNames = (ao.staff||[]).map(nameOf).join(' ');
      const matText  = (ao.materials||[]).map(m => m.description||m.name||'').join(' ');
      const haystack = nrm([
        ao.id, ao.displayNumber, ao.aoNumber, ao.title, ao.description, ao.address, ao.zip, ao.city, ao.contactPerson,
        ao.phone, ao.email, ao.category,
        catLabel.get(ao.category) || '',
        ao.status, ao.priority,
        cu ? CustomerService.displayName(cu) : '',
        ao.customerName || '',
        prop ? (prop.name||prop.address||'') : '',
        ao.propertyName || '',
        ao.objectId || '', ao.objectName || '', ao.objectNumber || '',
        ao.entrance || '', ao.stairwell || '', ao.floor || '', ao.apartmentNumber || '',
        ao.contactEmail || '',
        stfNames, matText
      ].join(' '));
      const phoneDigits = (ao.phone||'').replace(/\D/g,'');
      return nw.every(w => haystack.includes(w.x) || (w.d && phoneDigits.includes(w.d)));
    });
  },

  /* Alla AO som matchar status + snabbval/filter + sökning (osorterad). */
  _matchingList() {
    const today = tdy();
    const narrowed = this._narrowFilter(this._baseList(), today);
    return this.q ? this._searchFilter(narrowed) : narrowed;
  },

  _activeFilterCount() {
    const f = this._f;
    return (f.quick?1:0) + (f.mine?1:0) + (f.unassigned?1:0) +
      f.staffIds.length + (f.customer?1:0) + (f.property?1:0) + f.categories.length;
  },

  /* Samlad rad över allt som avgränsar listan (status ≠ Aktiva, snabbval,
     avancerade filter, sökning) — varje del kan tas bort för sig, och
     "Rensa filter" tar bort allt. Ritas av renderList() så att sökningen
     syns direkt. Borttagning sker via index (inga data i inline-kod). */
  _summaryItems() {
    const f = this._f;
    const items = [];
    const QUICK_LABELS = { akut:'Akuta', readyForInvoice:'Att fakturera', idag:'Idag', forsenad:'Försenade' };
    const QUICK_ICONS  = { akut:'alert-triangle', readyForInvoice:'receipt', idag:'calendar', forsenad:'clock' };
    const statusTab = this.STATUS_TABS.concat(this.MODE_TABS).find(t => t.key === this.filter);
    if (this.filter !== 'alla') items.push({ label: 'Status: ' + (statusTab ? statusTab.label : this.filter), icon: 'layers', clear: () => { this.filter = 'alla'; } });
    const live = this.filter !== 'arkiverade' && this.filter !== 'papperskorg';
    if (live) {
      if (f.quick) items.push({ label: QUICK_LABELS[f.quick] || f.quick, icon: QUICK_ICONS[f.quick] || 'filter', clear: () => { this._f.quick = null; } });
      if (f.mine) items.push({ label: 'Mina', icon: 'user', clear: () => { this._f.mine = false; } });
      if (f.unassigned) items.push({ label: 'Otilldelade', icon: 'user-x', clear: () => { this._f.unassigned = false; } });
      f.staffIds.forEach(id => {
        const s = getStaff(id);
        items.push({ label: 'Personal: ' + (s ? `${s.firstName} ${String(s.lastName || '').charAt(0)}.` : id), icon: 'user', clear: () => { this._f.staffIds = this._f.staffIds.filter(x => x !== id); } });
      });
      if (f.customer) {
        const cu = getCu(f.customer);
        items.push({ label: 'Kund: ' + (cu ? CustomerService.displayName(cu) : f.customer), icon: 'building-2', clear: () => { this._f.customer = null; } });
      }
      if (f.property) {
        const prop = getObj(f.property);
        items.push({ label: 'Fastighet: ' + (prop ? (prop.name || prop.address || f.property) : f.property), icon: 'home', clear: () => { this._f.property = null; } });
      }
      (f.categories||[]).forEach(slug => {
        const cat = (typeof AO_CATEGORIES!=='undefined'?AO_CATEGORIES:[]).find(c=>c.slug===slug);
        items.push({ label: 'Kategori: ' + (cat ? cat.label : slug), icon: 'tag', clear: () => { this._f.categories = (this._f.categories||[]).filter(s => s !== slug); } });
      });
    }
    if (this.q) items.push({ label: 'Sök: “' + this.q + '”', icon: 'search', clear: () => { this.q = ''; } });
    return items;
  },

  _summaryHtml() {
    const items = this._summaryItems();
    this._summaryClears = items.map(i => i.clear);
    if (!items.length) return '';
    return `<div class="aol-summary" role="group" aria-label="Aktiva filter">
      <span class="aol-summary-l">Visar bara:</span>
      ${items.map((c, i) => `<span class="active-filter-chip aol-fchip">${ic(c.icon,11)}<span>${esc(c.label)}</span><button type="button" onclick="WorkOrdersPage._clearSummary(${i})" aria-label="Ta bort filtret ${esc(c.label)}" title="Ta bort">${ic('x',10)}</button></span>`).join('')}
      <button type="button" class="btn bghost bsm aol-reset" onclick="WorkOrdersPage.resetFilters()">${ic('x',12)} Rensa filter</button>
    </div>`;
  },

  _clearSummary(i) {
    const fn = (this._summaryClears || [])[i];
    if (typeof fn !== 'function') return;
    fn();
    this.render();
  },

  _activeChipsHtml() {
    const f = this._f;
    const chips = [];
    const QUICK_LABELS = { akut:'Akuta', readyForInvoice:'Redo fakturering', idag:'Idag', forsenad:'Försenade' };
    const QUICK_ICONS  = { akut:'zap', readyForInvoice:'receipt', idag:'calendar', forsenad:'clock' };
    if (f.quick) chips.push({ label: QUICK_LABELS[f.quick]||f.quick, icon: QUICK_ICONS[f.quick]||'filter',
      clear: `WorkOrdersPage._f.quick=null;WorkOrdersPage._refreshFilters()` });
    if (f.mine) chips.push({ label: 'Mina ärenden', icon: 'user',
      clear: `WorkOrdersPage._f.mine=false;WorkOrdersPage._refreshFilters()` });
    if (f.unassigned) chips.push({ label: 'Otilldelade', icon: 'user-x',
      clear: `WorkOrdersPage._f.unassigned=false;WorkOrdersPage._refreshFilters()` });
    f.staffIds.forEach((id, i) => {
      const s = getStaff(id);
      chips.push({ label: s ? `${s.firstName} ${s.lastName.charAt(0)}.` : id, icon: 'user',
        clear: `WorkOrdersPage._removeStaffFilter(WorkOrdersPage._f.staffIds[${i}])` });
    });
    if (f.customer) {
      const cu = getCu(f.customer);
      chips.push({ label: cu ? CustomerService.displayName(cu) : f.customer, icon: 'building-2',
        clear: `WorkOrdersPage._f.customer=null;WorkOrdersPage._refreshFilters()` });
    }
    if (f.property) {
      const prop = (state.properties||[]).find(p => p.id === f.property);
      chips.push({ label: prop ? (prop.name || prop.address || f.property) : f.property, icon: 'home',
        clear: `WorkOrdersPage._f.property=null;WorkOrdersPage._refreshFilters()` });
    }
    (f.categories||[]).forEach((slug, i) => {
      const cat = (typeof AO_CATEGORIES!=='undefined'?AO_CATEGORIES:[]).find(c=>c.slug===slug);
      chips.push({ label: cat ? cat.label : slug, icon: 'tag',
        clear: `WorkOrdersPage._removeCatFilter(WorkOrdersPage._f.categories[${i}])` });
    });
    if (!chips.length) return '';
    const chipsHtml = chips.map(c =>
      `<span class="active-filter-chip">${ic(c.icon,10)} ${esc(c.label)}<button onclick="${c.clear}">${ic('x',9)}</button></span>`
    ).join('');
    return `<div class="active-filters-row">${chipsHtml}<button class="active-filter-clear" onclick="WorkOrdersPage.clearAllFilters()">${ic('x',10)} Rensa</button></div>`;
  },

  _refreshFilters() {
    /* V3: räknare i flikar och snabbfilter beror på filtren — rendera om helt. */
    this.render();
  },

  clearAllFilters() {
    this._f = this._defaultFilters(true);
    this._refreshFilters();
  },

  _removeStaffFilter(id) {
    this._f.staffIds = this._f.staffIds.filter(s => s !== id);
    this._refreshFilters();
  },

  _removeCatFilter(slug) {
    this._f.categories = (this._f.categories||[]).filter(s => s !== slug);
    this._refreshFilters();
  },

  /* ── Filter panel — staged (draft) ─────── */

  openFilterPanel() {
    // Klona aktuellt filter som draft — inget sparas förrän "Tillämpa"
    this._fDraft = JSON.parse(JSON.stringify(this._f));
    this._showFilterPanel();
  },

  _showFilterPanel() {
    const draftCount = this._draftCount();
    Modal.open({
      title: `${ic('sliders',14)} Filter`,
      body: `<div class="filter-panel">${this._filterPanelBody()}</div>`,
      buttons: [
        { label: `${ic('check',12)} Tillämpa${draftCount ? ' ('+draftCount+')' : ''}`, cls: 'btn bp', onClick: () => this._applyFilter() },
        { label: `${ic('x',11)} Rensa`, cls: 'btn bs', onClick: () => this._clearDraft() },
        { label: 'Avbryt', cls: 'btn bghost', onClick: () => { this._fDraft = null; Modal.close(); } }
      ]
    });
  },

  _applyFilter() {
    if (this._fDraft) {
      this._f = this._fDraft;
      this._fDraft = null;
    }
    Modal.close();
    this._refreshFilters();
  },

  _clearDraft() {
    this._f = this._defaultFilters(true);
    this._fDraft = null;
    Modal.close();
    this._refreshFilters();
  },

  _draftCount() {
    const f = this._fDraft;
    if (!f) return 0;
    return (f.quick?1:0) + (f.mine?1:0) + (f.unassigned?1:0) +
      f.staffIds.length + (f.customer?1:0) + (f.property?1:0) + (f.categories||[]).length;
  },

  /* Uppdatera bara panelens body (utan att stänga/öppna modalen) */
  _fpRefresh() {
    const panelEl = document.querySelector('.modal-body .filter-panel');
    if (panelEl) panelEl.innerHTML = this._filterPanelBody();
    // Uppdatera Tillämpa-knappens räknare
    const applyBtn = document.querySelector('.modal-footer .btn.bp');
    if (applyBtn) {
      const n = this._draftCount();
      applyBtn.innerHTML = `${ic('check',12)} Tillämpa${n ? ' ('+n+')' : ''}`;
    }
  },

  _filterPanelBody() {
    const f = this._fDraft || this._f;
    const base = this._baseList();  // räkna mot aktuell flik, inte allt
    const today = tdy();
    const myId = state.currentUser ? state.currentUser.id : null;

    // Snabbval (samma regler och antal som chipsen på sidan)
    const quickOpts = [
      { key:'akut',            icon:'zap',      label:'Akuta',            cnt: base.filter(a=>a.priority==='akut').length },
      { key:'readyForInvoice', icon:'receipt',  label:'Redo fakturering', cnt: (() => { let _r = null; return base.filter(a=>a.status==='klar'&&!a.invoiceId&&WorkOrderService._hasBillableContent(a, (_r = _r || WorkOrderService.billingStatusResolver()))).length; })() }, // L1: one candidate pass
      { key:'idag',            icon:'calendar', label:'Idag',             cnt: base.filter(a=>a.scheduledDate===today).length },
      { key:'forsenad',        icon:'clock',    label:'Försenade',        cnt: base.filter(a=>WorkOrderService.isOverdue(a, today)).length }
    ];
    const quickHtml = quickOpts.map(o =>
      `<button type="button" class="filter-panel-chip ${f.quick===o.key?'on':''}" onclick="WorkOrdersPage._fpToggleQuick('${o.key}')">
        ${ic(o.icon,11)} ${esc(o.label)}${o.cnt ? `<span class="qf-cnt">${o.cnt}</span>` : ''}
      </button>`
    ).join('');

    // Personal
    const staffList = (state.staff||[]).filter(s => s.active);
    const mineCount = myId ? base.filter(a=>(a.staff||[]).includes(myId)).length : 0;
    const unassCount = base.filter(a=>!(a.staff||[]).length).length;
    const staffSpecial = `
      <button type="button" class="filter-panel-chip ${f.mine?'on':''}" onclick="WorkOrdersPage._fpToggleMine()">
        ${ic('user',11)} Mina ärenden${mineCount ? `<span class="qf-cnt">${mineCount}</span>` : ''}
      </button>
      <button type="button" class="filter-panel-chip ${f.unassigned?'on':''}" onclick="WorkOrdersPage._fpToggleUnassigned()">
        ${ic('user-x',11)} Otilldelade${unassCount ? `<span class="qf-cnt">${unassCount}</span>` : ''}
      </button>`;
    const staffItems = staffList.map(s => {
      const isOn = (f.staffIds||[]).includes(s.id);
      const cnt = base.filter(a=>(a.staff||[]).includes(s.id)).length;
      return `<div class="filter-staff-item ${isOn?'on':''}" data-id="${esc(s.id)}" onclick="WorkOrdersPage._fpToggleStaff(this.getAttribute('data-id'))">
        <div class="filter-staff-check">${isOn?ic('check',11):''}</div>
        <div style="flex:1;min-width:0;">
          <span style="font-size:13px;font-weight:600;">${esc(s.firstName)} ${esc(s.lastName)}</span>
          ${s.title?`<span style="font-size:11px;color:var(--mt);margin-left:6px;">${esc(s.title)}</span>`:''}
        </div>
        ${cnt ? `<span class="qf-cnt" style="background:var(--bg);color:var(--mt);">${cnt}</span>` : ''}
      </div>`;
    }).join('');

    // Kategori — multi-select, OR-logik
    const cats = typeof AO_CATEGORIES!=='undefined' ? AO_CATEGORIES : [];
    const selCats = f.categories || [];
    const catHtml = cats.map(c => {
      const cnt = base.filter(a=>a.category===c.slug).length;
      const isOn = selCats.includes(c.slug);
      return `<button type="button" class="filter-panel-chip ${isOn?'on':''}" data-slug="${esc(c.slug)}" onclick="WorkOrdersPage._fpToggleCat(this.getAttribute('data-slug'))">
        ${isOn?ic('check',10)+' ':''}${esc(c.label)}${cnt ? `<span class="qf-cnt">${cnt}</span>` : ''}
      </button>`;
    }).join('');

    // Kund
    const cuIds = [...new Set(base.filter(a=>a.customerId).map(a=>a.customerId))];
    const cuOpts = cuIds.map(id => {
      const cu = getCu(id);
      if (!cu) return null;
      return { id, name: CustomerService.displayName(cu), cnt: base.filter(a=>a.customerId===id).length };
    }).filter(Boolean).sort((a,b) => a.name.localeCompare(b.name,'sv'));
    const cuHtml = cuOpts.length ? `<select onchange="WorkOrdersPage._fpSetCust(this.value)" style="width:100%;padding:9px 10px;border:1.5px solid var(--br);border-radius:8px;font-size:13px;background:var(--bg);font-family:inherit;" aria-label="Kund">
      <option value="">— Alla kunder —</option>
      ${cuOpts.map(c=>`<option value="${esc(c.id)}" ${f.customer===c.id?'selected':''}>${esc(c.name)} (${c.cnt})</option>`).join('')}
    </select>` : '<span style="font-size:12px;color:var(--mt);">Inga kunder i aktuellt urval</span>';

    // Sortering
    const SORT_OPTS = [
      { key:'default',   label:'Prioritet & datum' },
      { key:'updated',   label:'Senast uppdaterad' },
      { key:'scheduled', label:'Planerat datum' },
      { key:'priority',  label:'Enbart prioritet' },
      { key:'number',    label:'AO-nummer' },
      { key:'customer',  label:'Kund' },
      { key:'status',    label:'Status' }
    ];
    const sortHtml = SORT_OPTS.map(o =>
      `<button type="button" class="filter-panel-chip ${f.sort===o.key?'on':''}" onclick="WorkOrdersPage._fpSetSort('${o.key}')">${esc(o.label)}</button>`
    ).join('');

    return `
      <div class="filter-section">
        <div class="filter-section-title">Snabbval</div>
        <div class="filter-chips-row">${quickHtml}</div>
      </div>
      <div class="filter-section">
        <div class="filter-section-title">Personal</div>
        <div class="filter-chips-row" style="margin-bottom:8px;">${staffSpecial}</div>
        ${staffItems ? `<div class="filter-staff-list">${staffItems}</div>` : ''}
      </div>
      ${cats.length ? `<div class="filter-section">
        <div class="filter-section-title">Kategori <span style="font-size:10px;font-weight:400;color:var(--mt);">(flera möjliga)</span></div>
        <div class="filter-chips-row">${catHtml}</div>
      </div>` : ''}
      <div class="filter-section">
        <div class="filter-section-title">Kund</div>
        ${cuHtml}
      </div>
      <div class="filter-section">
        <div class="filter-section-title">Sortering</div>
        <div class="filter-chips-row">${sortHtml}</div>
      </div>`;
  },

  /* Draft-toggle-funktioner (ändrar _fDraft, inte _f, och re-renderar panelen) */
  _fpToggleQuick(key)   { const f=this._fDraft; f.quick=f.quick===key?null:key; this._fpRefresh(); },
  _fpToggleMine()       { const f=this._fDraft; f.mine=!f.mine; if(f.mine){f.unassigned=false;f.staffIds=[];} this._fpRefresh(); },
  _fpToggleUnassigned() { const f=this._fDraft; f.unassigned=!f.unassigned; if(f.unassigned){f.mine=false;f.staffIds=[];} this._fpRefresh(); },
  _fpToggleStaff(id)    { const f=this._fDraft; const i=f.staffIds.indexOf(id); if(i>-1)f.staffIds.splice(i,1); else{f.staffIds.push(id);f.mine=false;f.unassigned=false;} this._fpRefresh(); },
  _fpToggleCat(slug)    { const f=this._fDraft; const i=(f.categories||[]).indexOf(slug); if(i>-1)f.categories.splice(i,1); else{if(!f.categories)f.categories=[];f.categories.push(slug);} this._fpRefresh(); },
  _fpSetCust(id)        { this._fDraft.customer=id||null; this._fpRefresh(); },
  _fpSetSort(key)       { this._fDraft.sort=key; this._fDraft.dir=null; this._fpRefresh(); },

  /* ── V51A R5 §9-§16: kompakt checklista-progressbar för AO-listan ────
     Käll-auditerat checklistdatamodell (Schema.workOrder(): checklist:
     [{id, text, done, avvikelse}]) — VARJE punkt har bara TVÅ verkliga
     tillstånd: löst (done===true ELLER avvikelse==='ok') eller olöst
     (done===false, avvikelse===null). Det finns INGET "påbörjad men ej
     klar"-fält någonstans i modellen eller i WorkOrderDetailPage.js:s
     checklist-UI (_renderChecklist, setAvvikelse, saveChecklist) — en
     punkt går direkt från "orörd" till "OK" eller "Avvikelse", aldrig via
     ett mellanläge. Att kalla "Avvikelse" för "Påbörjade" hade varit
     missvisande (en avvikelse-flaggad punkt ÄR färdigbehandlad, bara med
     ett upptäckt problem — inte en pågående uppgift). R5 implementerar
     därför INTE det efterfrågade "Påbörjade"-tillståndet (det skulle
     kräva att fabricera data som inte finns) utan använder istället den
     verkliga, redan existerande tre-läges-semantiken:
       Klara       = done===true ELLER avvikelse==='ok'
       Avvikelse   = avvikelse==='avvikelse'
       Kvarstående = varken det ovanstående (orörd punkt)
     Rent LÄSANDE — muterar aldrig checklist/AO-status, persisterar
     ingenting. */
  _chkProgress(ao) {
    const items = ao.checklist || [];
    const total = items.length;
    if (!total) return null;
    /* 2026-11-23: tre statuslägen — "Pågående" finns nu i modellen
       (startedAt), se WorkOrderService.checklistStatus(). Kvarstående =
       varken utförd, avvikelse eller pågående. */
    const k = WorkOrderService.checklistCounts(items);
    return { total, done: k.done, avv: k.avv, prog: k.prog, rest: k.rest };
  },

  _chkProgressHtml(ao) {
    const p = this._chkProgress(ao);
    if (!p) return '';
    const pct = (n) => Math.round((n / p.total) * 100);
    const label = `Klara: ${p.done} · Avvikelse: ${p.avv} · Pågående: ${p.prog} · Kvarstående: ${p.rest} · Totalt: ${p.total}`;
    return `<span class="ao-chk-progress" tabindex="0" role="img" aria-label="Checklista — ${esc(label)}">
      <span class="ao-chk-bar">
        ${p.done > 0 ? `<span class="ao-chk-seg ao-chk-seg-done" style="width:${pct(p.done)}%"></span>` : ''}
        ${p.avv  > 0 ? `<span class="ao-chk-seg ao-chk-seg-avv"  style="width:${pct(p.avv)}%"></span>`  : ''}
        ${p.prog > 0 ? `<span class="ao-chk-seg ao-chk-seg-prog" style="width:${pct(p.prog)}%"></span>` : ''}
      </span>
      <span class="ao-chk-count">${p.done + p.avv}/${p.total}</span>
      <span class="ao-chk-tip" role="tooltip">Klara: ${p.done}<br>Avvikelse: ${p.avv}<br>Pågående: ${p.prog}<br>Kvarstående: ${p.rest}</span>
    </span>`;
  },

  /* ── Synligt AO-nummer och dubbletter ───────────────────────────────
     Det synliga numret kommer ALLTID från WorkOrderService.
     displayNumberOrPending(ao): ao.displayNumber (tilldelat av servern
     vid skapandet) → annars "AO-(sparas…)" medan skapandet väntar på
     servern → annars ao.id. Två olika AO kan alltså visa samma etikett om
     (a) två poster har samma displayNumber, eller (b) en äldre post utan
     displayNumber har id "AO-001" medan en nyare har displayNumber
     "AO-001" (olika nummerserier), eller (c) två poster har samma id.
     Listan ändrar aldrig något lagrat nummer: när en etikett förekommer
     flera gånger bland de AO användaren får se visas ett kort internt id
     bredvid ("id faeb91"), så att raderna går att skilja åt. */
  _shortId(ao, len) {
    const id = String(ao && ao.id != null ? ao.id : '');
    const core = id.replace(/^AO-/i, '');
    if (len && core.length >= 12) return core.replace(/[^0-9a-z]/gi, '').slice(0, len).toLowerCase();
    return id;
  },

  _dupTags(list) {
    const byLabel = new Map();
    (list || []).forEach(a => {
      if (!a || a._pendingSync) return;
      const l = WorkOrderService.displayNumberOrPending(a);
      if (!l) return;
      const g = byLabel.get(l);
      if (g) g.push(a); else byLabel.set(l, [a]);
    });
    const tags = new Map(); // ao-objekt → { text, title, bad }
    byLabel.forEach((g, label) => {
      if (g.length < 2) return;
      let ids = null;
      for (const len of [6, 10, 0]) {
        ids = g.map(a => this._shortId(a, len));
        if (new Set(ids).size === g.length) break;
      }
      const seen = {};
      ids.forEach(x => { seen[x] = (seen[x] || 0) + 1; });
      g.forEach((a, i) => {
        const bad = seen[ids[i]] > 1; // samma interna id på flera poster — datafel, kan inte skiljas åt
        tags.set(a, {
          text: 'id ' + ids[i],
          title: bad
            ? `${g.length} arbetsordrar har samma nummer ${label} och samma interna id (${a.id}). Kontakta administratör — numret ändras inte här.`
            : `${g.length} arbetsordrar visas som ${label}. Internt id: ${a.id}`,
          bad
        });
      });
    });
    return tags;
  },

  /* För andra vyer (t.ex. AO-detaljens rubrik, som ägs av ett annat block):
     { label, tag } där tag är null eller { text, title, bad } när samma
     synliga nummer finns på flera AO som användaren får se. ao ska vara
     posten ur state.workOrders (getAO). Läser bara. */
  labelInfo(ao) {
    if (!ao) return { label: '', tag: null };
    return { label: WorkOrderService.displayNumberOrPending(ao), tag: this._dupTags(this._permittedList()).get(ao) || null };
  },

  /* Etikett i klartext (dialoger, bekräftelser): "AO-001" eller "AO-001 (id faeb91)". */
  _labelText(ao, tags) {
    const l = WorkOrderService.displayNumberOrPending(ao);
    const t = tags && tags.get(ao);
    return t ? l + ' (' + t.text + ')' : l;
  },

  _noHtml(ao, tags, cls) {
    const t = tags.get(ao);
    return `<span class="${cls || 'aol-no'}">${esc(WorkOrderService.displayNumberOrPending(ao))}</span>${t ? `<span class="aol-dupid${t.bad ? ' is-bad' : ''}" title="${esc(t.title)}">${esc(t.text)}</span>` : ''}`;
  },

  /* Egen kryssruta (samma klass/attribut som SelectionModel.checkboxHtml så
     att markeringen synkas), men id:t läses ur data-attributet. */
  _cbHtml(ao, label) {
    return `<span class="sel-cb-wrap" onclick="event.stopPropagation()"><input type="checkbox" class="_sel-cb" data-sel-id="${esc(ao.id)}"${SelectionModel.isSelected(ao.id) ? ' checked' : ''} aria-label="Markera ${esc(label)}" onchange="SelectionModel.toggle(this.getAttribute('data-sel-id'))"></span>`;
  },

  /* Text efter antalet i bulk-baren: hur många av de markerade som döljs
     av nuvarande filter (ingår INTE i åtgärder) och hur många som matchar
     men inte är utritade än. */
  _selectionSummary() {
    if (!this._matchSet) return '';
    let hidden = 0, notShown = 0;
    SelectionModel.getSelected().forEach(id => {
      if (!this._matchSet.has(id)) hidden++;
      else if (this._shownSet && !this._shownSet.has(id)) notShown++;
    });
    const parts = [];
    if (hidden) parts.push(hidden + (hidden === 1 ? ' dold' : ' dolda') + ' av filtret ingår inte');
    if (notShown) parts.push(notShown + ' ej utritade i listan');
    return parts.join(' · ');
  },

  /* Markera alla som matchar (även de som inte är utritade än). */
  selectAllMatching() {
    SelectionModel.selectAllVisible((this._matchIds || []).slice());
  },

  renderList() {
    const el = document.getElementById('ao-list');
    if (!el) return;
    if (this._qTimer) { clearTimeout(this._qTimer); this._qTimer = null; }
    const today = tdy();
    const permitted = this._permittedList();
    const statusList = this._statusFilter(permitted);
    const narrowed = this._narrowFilter(statusList, today);
    let list = this.q ? this._searchFilter(narrowed) : narrowed;
    list = this._sortList(list);

    this._matchIds = list.map(a => a.id);
    this._matchSet = new Set(this._matchIds);
    const wrap = document.querySelector('#pg-ao .aol-search');
    if (wrap) wrap.classList.toggle('has-q', !!this.q);
    const sumEl = document.getElementById('ao-active-filters');
    if (sumEl) sumEl.innerHTML = this._summaryHtml();
    el.className = 'aol-results' + (this._pickMode ? ' aol-pick' : '') + (this.viewMode === 'grid' ? ' aol-is-grid' : ' aol-is-list');

    const isLive = this.filter !== 'arkiverade' && this.filter !== 'papperskorg';
    const tabObj = this.STATUS_TABS.concat(this.MODE_TABS).find(t => t.key === this.filter);
    const noun = (k) => k === 1 ? 'arbetsorder' : 'arbetsordrar';
    const scopeTxt = (k) => this.filter === 'alla' ? `aktiva ${noun(k)}`
      : this.filter === 'arkiverade' ? `arkiverade ${noun(k)}`
      : this.filter === 'papperskorg' ? `${noun(k)} i papperskorgen`
      : `${noun(k)} med status ${tabObj ? tabObj.label : this.filter}`;
    const narrowedBy = list.length !== statusList.length || !!this.q || (isLive && this._activeFilterCount() > 0);

    if (!list.length) {
      this._shownSet = new Set();
      SelectionModel.selectAllHtml([]);
      if (SelectionModel.count() > 0) SelectionModel.selectAllVisible([]); // uppdatera bulk-baren (dolda markerade)
      const isSearch = !!this.q;
      const isFilter = this.filter !== 'alla' || this._activeFilterCount() > 0;
      const hasAnyFilter = isSearch || isFilter;
      el.innerHTML = `<div class="aol-countrow aol-count"><span class="aol-count-txt" aria-live="polite">Visar <strong>0</strong>${statusList.length ? ` av <strong>${statusList.length}</strong>` : ''} ${esc(scopeTxt(statusList.length || 0))}</span></div>
      <div class="empty">${ic('clipboard-list',32)}
        <h3>${isSearch ? 'Inga träffar' : isFilter ? 'Inga ordrar här' : 'Inga arbetsorder ännu'}</h3>
        <p>${isSearch ? 'Inga ordrar matchar sökningen. Pröva ett kundnamn, en adress eller ett ordernummer.' : isFilter ? 'Inga ordrar matchar valt filter.' : 'Skapa din första arbetsorder — den hamnar här och i kalendern.'}</p>
        ${hasAnyFilter ? `<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;justify-content:center;">
          ${isSearch ? `<button type="button" class="btn bs bsm" onclick="WorkOrdersPage.clearSearch()">Rensa sökning</button>` : ''}
          ${isFilter ? `<button type="button" class="btn bs bsm" onclick="WorkOrdersPage.filter='alla';WorkOrdersPage.clearAllFilters()">Visa alla aktiva</button>` : ''}
          ${isSearch && isFilter ? `<button type="button" class="btn bghost bsm" onclick="WorkOrdersPage.resetFilters()">Rensa filter och sökning</button>` : ''}
        </div>` : (Auth.can('ao_create') ? `<button type="button" class="btn bs bsm" style="margin-top:10px" onclick="WorkOrdersPage.openCreate()">${ic('plus',14)} Ny order</button>` : '')}
      </div>`;
      return;
    }

    /* QA FIX-ROUND 2026-11-12 (L1, confirmed): ett faktureringsresolver-pass
       per render, skapat vid första rad som behöver det (se tidigare
       kommentar i git-historiken). */
    let _billRes = null;
    const canEdit = Auth.can('ao_edit');
    const tags = this._dupTags(permitted);
    const SUB = { inväntar_material:'Inväntar material', inväntar_kund:'Inväntar kund', pausad:'Pausad', behöver_återbesök:'Återbesök', blockerad:'Blockerad' };
    /* Avatarer utan överlapp: högst tre platser — fler än tre personer visas
       som två avatarer + "+N", så initialerna aldrig klipps (F-22). */
    const staffHtml = (ids) => {
      const ok = (ids || []).filter(id => getStaff(id));
      if (!ok.length) return `<span class="aol-staff is-none">${UiKit.avatarStack([], 3)}<span class="aol-staff-none">Ingen</span></span>`;
      return `<span class="aol-staff">${UiKit.avatarStack(ok, ok.length > 3 ? 2 : 3)}</span>`;
    };
    const row = (ao) => {
      const cu     = ao.customerId ? getCu(ao.customerId) : null;
      const cuName = cu ? CustomerService.displayName(cu) : (ao.customerName || '');
      const prop   = ao.propertyId ? getObj(ao.propertyId) : null;
      const where  = [ao.address || (prop && prop.address) || '', ao.city || (prop && prop.city) || ''].filter(Boolean).join(', ');
      const needsInvoice = ao.status==='klar' && !ao.invoiceId;
      /* AO-PRICING-RECOVERY R2 — Blocker 1: den DELADE fakturerbarhets-
         sanningen (WorkOrderService.getBillingStatus()). "Saknar
         prissättning" visas ENDAST vid en faktisk pris-blockerare. */
      const billingStatus = needsInvoice ? WorkOrderService.getBillingStatus(ao, (_billRes = _billRes || WorkOrderService.billingStatusResolver())) : null; // L1
      const isBillable   = needsInvoice && billingStatus.eligible;
      const noPricing    = needsInvoice && billingStatus.pricingBlocked;
      const overdue = WorkOrderService.isOverdue(ao, today);
      const when = ao.scheduledDate
        ? `<span class="aol-when${overdue ? ' is-late' : ao.scheduledDate === today ? ' is-today' : ''}"${overdue ? ' title="Försenad"' : ''}>${overdue ? ic('clock',12) : ''}${esc(UiKit.dayLabel(ao.scheduledDate, today))}${ao.scheduledStart ? `<span class="aol-time">${esc(ao.scheduledStart)}</span>` : ''}</span>`
        : `<span class="aol-when is-none">Ej planerad</span>`;
      const status = canEdit && !ao.archived && !ao.deleted
        ? `<span role="button" tabindex="0" class="ao-status-btn" onclick="event.stopPropagation();WorkOrdersPage._statusBtn(event,this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();WorkOrdersPage._statusBtn(event,this)}" title="Byt status" aria-label="Status: ${esc(statusLabel(ao.status))} — byt">${sbdg(ao.status)}${ic('chevron-down',11)}</span>`
        : sbdg(ao.status);
      const billing = ao.invoiceId ? `<span class="aol-bill is-done">${ic('check',12)} Underlag skapat</span>`
        : isBillable ? `<span class="bdg bdg-blue ao-ready-inv">${ic('receipt',11)} Redo fakturering</span>`
        : noPricing ? `<span class="bdg bdg-orange">${ic('alert-circle',11)} Saknar prissättning</span>`
        : ao.status === 'fakturerad' ? `<span class="aol-bill is-done">Fakturerad</span>` : '<span class="aol-dash">—</span>';
      const prio = ao.priority === 'akut' ? akutBadge() : ao.priority === 'hög' ? pbdg('hög') : '';
      /* Kategorin Akut/jour + prioritet Akut sa samma sak två gånger — visa bara prioriteten. */
      const cat = ao.category && !(ao.priority === 'akut' && ao.category === 'akut') ? catBadge(ao.category) : '';
      const flags = [
        ao.substatus ? `<span class="bdg bdg-yellow">${esc(SUB[ao.substatus] || ao.substatus)}</span>` : '',
        ao.archived ? `<span class="bdg bdg-grey">${ic('archive',11)} Arkiverad${ao.archivedAt?' '+esc(fmtDate(ao.archivedAt)):''}</span>` : '',
        ao.deleted ? `<span class="bdg bdg-red">${ic('trash',11)} Papperskorg${ao.deletedAt?' '+esc(fmtDate(ao.deletedAt)):''}</span>` : '',
      ].join('');
      const rowActions = ao.archived ? `<button type="button" class="btn bxs bs" onclick="WorkOrdersPage._rowAction(event,this,'restoreArchive')">${ic('rotate-ccw',11)} Återställ</button>`
        : ao.deleted ? `<button type="button" class="btn bxs bs" onclick="WorkOrdersPage._rowAction(event,this,'restoreTrash')">${ic('rotate-ccw',11)} Återställ</button><button type="button" class="btn bxs bd" onclick="WorkOrdersPage._rowAction(event,this,'delete')">${ic('trash-2',11)} Radera</button>` : '';
      const label = WorkOrderService.displayNumberOrPending(ao) + (ao.title ? ' ' + ao.title : '');
      return { cu, cuName, where, when, status, billing, prio, cat, flags, rowActions, chk: this._chkProgressHtml(ao), overdue, label };
    };

    const total = list.length;
    const lim = Math.max(this._limit || this.PAGE, this.PAGE);
    list = list.slice(0, lim);
    const shown = list.length;
    const shownIds = list.map(a => a.id);
    this._shownSet = new Set(shownIds);
    // "Välj alla" gäller raderna som visas. SelectionModel håller listan (inga id:n i HTML).
    SelectionModel.selectAllHtml(shownIds);
    const allShownSel = shownIds.every(id => SelectionModel.isSelected(id));
    const rest = total - shown;
    const selAll = `<label class="sel-all-label aol-selall"><input type="checkbox" class="_sel-all-cb"${allShownSel ? ' checked' : ''} aria-label="${rest > 0 ? `Välj de ${shown} som visas` : `Välj alla ${total}`}" onchange="SelectionModel.selectAllToggle()" onclick="event.stopPropagation()"> ${rest > 0 ? `Välj de ${shown} som visas` : `Välj alla (${total})`}</label>`
      + (rest > 0 ? `<button type="button" class="btn bghost bsm aol-selmatch" onclick="WorkOrdersPage.selectAllMatching()">Markera alla ${total} som matchar</button>` : '');
    /* "Visar X av Y" (V3-komponentstandarden §5): X = utritade rader, Y = alla
       som matchar; vid filter/sökning även hur många statusurvalet har totalt. */
    const sN = statusList.length;
    const countInner = !narrowedBy
      ? (rest > 0 ? `Visar <strong>${shown}</strong> av <strong>${total}</strong> ${esc(scopeTxt(total))}` : `Visar alla <strong>${total}</strong> ${esc(scopeTxt(total))}`)
      : (rest > 0 ? `Visar <strong>${shown}</strong> av <strong>${total}</strong> som matchar <span class="aol-count-of">(av ${sN} ${esc(scopeTxt(sN))})</span>` : `Visar <strong>${total}</strong> av <strong>${sN}</strong> ${esc(scopeTxt(sN))}`);
    const countTxt = `<span class="aol-count-txt" aria-live="polite">${countInner}</span>`;
    const viewSeg = `<div class="aol-viewseg" role="group" aria-label="Visning">
        <button type="button" class="aol-vbtn${this.viewMode==='list'?' on':''}" aria-pressed="${this.viewMode==='list'}" aria-label="Lista" onclick="WorkOrdersPage.setView('list')" title="Visa som lista">${ic('list',14)}<span>Lista</span></button>
        <button type="button" class="aol-vbtn${this.viewMode==='grid'?' on':''}" aria-pressed="${this.viewMode==='grid'}" aria-label="Kort" onclick="WorkOrdersPage.setView('grid')" title="Visa som kort">${ic('grid',14)}<span>Kort</span></button>
      </div>`;
    const pickBtn = `<button type="button" class="btn bs bsm aol-pickbtn${this._pickMode ? ' on' : ''}" aria-pressed="${this._pickMode}" onclick="WorkOrdersPage.togglePick()">${ic(this._pickMode ? 'check' : 'check-square', 13)}${this._pickMode ? 'Klar' : 'Markera'}</button>`;
    const countRow = `<div class="aol-countrow aol-count">
        ${countTxt}
        <span class="aol-countrow-r"><span class="ao-selall-cell">${selAll}</span>${pickBtn}${viewSeg}</span>
      </div>`;
    const foot = total > this.PAGE ? `<div class="aol-foot" role="status">
        <span class="aol-foot-txt">${rest > 0 ? `Visar <strong>${shown}</strong> av <strong>${total}</strong>` : `Visar alla <strong>${total}</strong>`} ${noun(total)}</span>
        ${rest > 0 ? `${rest > this.STEP ? `<button type="button" class="btn bs bsm aol-more" onclick="WorkOrdersPage.showMore()">Visa ${this.STEP} till</button>` : ''}<button type="button" class="btn ${rest > this.STEP ? 'bghost' : 'bs'} bsm aol-all" onclick="WorkOrdersPage.showAll()">Visa alla ${total}${rest <= this.STEP ? ` (${rest} till)` : ''}</button>` : ''}
      </div>` : '';
    // Bulk-baren: uppdatera "dolda av filtret" efter filterbyte.
    const selModeCls = SelectionModel.count() > 0 ? ' sel-mode' : '';
    if (selModeCls) SelectionModel.selectAllVisible([]);

    if (this.viewMode === 'grid') {
      el.innerHTML = `${countRow}<div class="ao-grid aol-cards">${list.map(ao => {
        const r = row(ao);
        const selected = SelectionModel.isSelected(ao.id);
        return `
          <div class="ao-card aol-card ${priorityClass(ao.priority)}${selected ? ' selected' : ''}${selModeCls}" data-sel-row-id="${esc(ao.id)}" tabindex="0" onclick="WorkOrdersPage._rowClick(this)" onkeydown="WorkOrdersPage._rowKey(event,this)">
            <div class="aol-card-top">
              <span class="aol-card-no">${this._cbHtml(ao, r.label)}${this._noHtml(ao, tags)}</span>
              <span class="aol-card-badges" onclick="event.stopPropagation()">${r.prio}${r.status}</span>
            </div>
            <div class="aol-title${ao.title ? '' : ' is-empty'}">${esc(ao.title || 'Utan titel')}</div>
            <div class="aol-sub">${esc(r.cuName || '—')}${r.where ? ' · ' + esc(r.where) : ''}</div>
            <div class="aol-card-tags">${r.cat}${r.flags}</div>
            <div class="aol-card-foot">
              ${r.when}
              <span class="aol-card-foot-r">${r.chk}${staffHtml(ao.staff)}</span>
            </div>
            ${r.billing.includes('bdg') ? `<div class="aol-card-bill">${r.billing}</div>` : ''}
            ${r.rowActions ? `<div class="aol-card-actions" onclick="event.stopPropagation()">${r.rowActions}</div>` : ''}
          </div>`;
      }).join('')}</div>${foot}`;
      return;
    }

    const sk = this._sortKey();
    const sd = this._sortDir();
    const th = (key, label, cls, what) => {
      const on = sk === key;
      const ariaSort = on ? (sd === 'asc' ? 'ascending' : 'descending') : 'none';
      return `<th class="${cls} aol-th-s${on ? ' is-sorted' : ''}" aria-sort="${ariaSort}"><button type="button" class="aol-th-btn" onclick="WorkOrdersPage.sortBy('${key}')" title="Sortera på ${esc(what || label.toLowerCase())}${on ? ' (klicka för att vända ordningen)' : ''}">${esc(label)}<span class="aol-th-ind" aria-hidden="true">${ic(on && sd === 'asc' ? 'arrow-up' : 'arrow-down', 12)}</span></button></th>`;
    };

    /* Tabellvy (desktop) som blir kompakta kort på smal skärm via CSS —
       samma markup, inga dubbla renderingar. */
    el.innerHTML = `
      <div class="dt-wrap aol-table-wrap">
        ${countRow}
        <div class="dt-scroll"><table class="dtab aol-table${selModeCls}">
          <thead><tr>
            <th class="c-shrink aol-c-sel"><span class="sr-only">Markera</span></th>
            ${th('number', 'Uppdrag', 'aol-c-main', 'AO-nummer')}
            ${th('customer', 'Kund och plats', 'aol-c-cust', 'kund')}
            ${th('scheduled', 'Planerat', 'aol-c-when', 'planerat datum')}
            <th class="aol-c-staff">Personal</th>
            <th class="aol-c-chk">Checklista</th>
            ${th('status', 'Status', 'aol-c-status')}
            <th class="aol-c-bill">Fakturering</th>
          </tr></thead>
          <tbody>
          ${list.map(ao => {
            const r = row(ao);
            const selected = SelectionModel.isSelected(ao.id);
            return `<tr class="aol-row ${priorityClass(ao.priority)}${selected ? ' selected' : ''}${selModeCls}${r.overdue ? ' is-late' : ''}" data-sel-row-id="${esc(ao.id)}" tabindex="0"
                onclick="WorkOrdersPage._rowClick(this)"
                onkeydown="WorkOrdersPage._rowKey(event,this)">
              <td class="aol-c-sel" onclick="event.stopPropagation()">${this._cbHtml(ao, r.label)}</td>
              <td class="aol-c-main">
                <div class="aol-main">
                  <div class="aol-line1">${r.prio}<span class="aol-title${ao.title ? '' : ' is-empty'}" title="${esc(ao.title || 'Utan titel')}">${esc(ao.title || 'Utan titel')}</span></div>
                  <div class="aol-line2">${this._noHtml(ao, tags)}${r.cat}${r.flags}<span class="aol-m-cust">${esc(r.cuName)}</span></div>
                </div>
              </td>
              <td class="aol-c-cust"><div class="aol-cu" title="${esc(r.cuName)}">${esc(r.cuName || '—')}</div>${r.where ? `<div class="aol-where" title="${esc(r.where)}">${esc(r.where)}</div>` : ''}</td>
              <td class="aol-c-when">${r.when}<span class="aol-m-no">${this._noHtml(ao, tags, 'aol-m-nolbl')}</span>${r.billing.includes('bdg') ? `<div class="aol-m-bill">${r.billing}</div>` : ''}</td>
              <td class="aol-c-staff">${staffHtml(ao.staff)}</td>
              <td class="aol-c-chk">${r.chk || '<span class="aol-dash">—</span>'}</td>
              <td class="aol-c-status" onclick="event.stopPropagation()">${r.status}${r.billing.includes('bdg') ? `<div class="aol-bill-inline">${r.billing}</div>` : ''}</td>
              <td class="aol-c-bill" onclick="event.stopPropagation()">${r.billing}${r.rowActions ? `<div class="aol-row-actions">${r.rowActions}</div>` : ''}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table></div>
      </div>${foot}`;
  },

  /* ── Skapa AO – wizard ─────────────────── */
  /* V47: opts är en bakåtkompatibel, optional tredje parameter — gamla anrop
     som bara skickar (prefillCustomerId, prefillPropertyId) fortsätter fungera
     exakt som tidigare. opts.onCreated(ao) anropas EFTER lyckad, riktig persist
     i _wizSave() — aldrig vid avbrutet/misslyckat sparande. Används av
     SalesPage.createAO(). */
  openCreate(prefillCustomerId = null, prefillPropertyId = null, opts = null) {
    if (!Auth.require('ao_create')) return;
    this._wiz = {
      step: 1,
      /* V54B — opts.projectId (samma opts-mönster som onCreated redan
         använder) förhandsifyller EN kontextuell projektkoppling, aldrig
         ett nytt AO-skapandeflöde. Se _wizCustomerChanged()/
         _wizPropertyChanged() för hur den rensas om användaren aktivt
         väljer en oförenlig kund/fastighet, och _wizSave() för det
         defensiva slutlagret. */
      data: { customerId: prefillCustomerId || '', propertyId: prefillPropertyId || '', projectId: (opts && opts.projectId) || '' },
      modalId: null,
      onCreated: (opts && typeof opts.onCreated === 'function') ? opts.onCreated : null
    };
    this._wizSeedDefaultAddress();
    this._showWizard();
  },

  /* Alias för anrop från PropertyObjectPage / PropertyDetailPage */
  openCreateAO(opts) {
    if (!Auth.require('ao_create')) return;
    opts = opts || {};
    this._wiz = {
      step: 1,
      data: {
        customerId: opts.customerId || '',
        propertyId: opts.propertyId || '',
        objectId:   opts.objectId   || '',
        objectName: opts.objectName || ''
      },
      modalId: null
    };
    this._wizSeedDefaultAddress();
    this._showWizard();
  },

  /* FINAL INVARIANTS AUDIT — `d.address/zip/city/country/addressSource`
     är den enda sanningskällan från och med GUIDENS ÖPPNING, inte bara
     efter första kund-/fastighetsbytet. Utan detta kunde flöde "A. D ->
     Spara" (aldrig röra kund/fastighet-väljarna alls) spara en TOM
     adress, eftersom _wizCollectAddress() inte längre räknar ut något
     eget (§6, förenklad till ren serialisering av `d`) — se dess
     kommentar. Anropas en gång direkt vid _wiz-initiering. */
  _wizSeedDefaultAddress() {
    const d = this._wiz.data;
    d.addressOverride = false;
    const resolved = this._wizResolvedAddress(d);
    d.address = resolved.address;
    d.zip     = resolved.zip;
    d.city    = resolved.city;
    d.country = '';
    d.addressSource = resolved.source;
  },

  _showWizard() {
    const wiz = this._wiz;
    const stepTitles = ['', 'Kund & jobb', 'Planering', 'Pris & utförande'];

    const progressHtml = `
      <div style="display:flex;gap:4px;margin-bottom:14px;">
        ${[1,2,3].map(n=>`<div style="flex:1;height:4px;border-radius:4px;background:${n<=wiz.step?'var(--sky)':'var(--br)'};"></div>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--mt);margin-bottom:12px;">Steg ${wiz.step} av 3 – ${stepTitles[wiz.step]}</div>`;

    const stepBody = `${progressHtml}<div id="wiz-body">${this._wizStep(wiz.step)}</div>`;

    // If modal already exists, update it; otherwise create new
    const existingSheet = wiz.modalId ? document.getElementById(wiz.modalId)?.querySelector('.modal-sheet') : null;

    if (!existingSheet) {
      wiz.modalId = Modal.open({
        title: 'Ny arbetsorder',
        wide: true,
        body: stepBody,
        buttons: this._wizButtons(wiz.step)
      });
    } else {
      // Update body content
      const bodyContent = existingSheet.querySelector('.modal-body > div');
      if (bodyContent) bodyContent.innerHTML = stepBody;

      // Update footer buttons
      const footer = existingSheet.querySelector('.modal-footer');
      if (footer) {
        footer.innerHTML = '';
        this._wizButtons(wiz.step).forEach(btn => {
          const b = document.createElement('button');
          b.className = btn.cls || 'btn bs';
          b.textContent = btn.label;
          b.onclick = btn.onClick;
          footer.appendChild(b);
        });
      }
    }

    // Bind step-specific events
    setTimeout(() => {
      if (wiz.step === 1) this._bindWizStep1();
      else if (wiz.step === 2) this._bindWizStep2();
      else if (wiz.step === 3) this._bindWizStep3();
    }, 60);
  },

  _wizButtons(step) {
    if (step === 1) return [
      { label: 'Nästa',  cls: 'btn bp', onClick: () => this._wizNext() },
      { label: 'Avbryt', cls: 'btn bs', onClick: () => this._wizCancel() }
    ];
    if (step === 2) return [
      { label: 'Nästa',    cls: 'btn bp', onClick: () => this._wizNext() },
      { label: 'Tillbaka', cls: 'btn bs', onClick: () => this._wizBack() }
    ];
    return [
      { label: 'Skapa order', cls: 'btn bsu', onClick: () => this._wizSave() },
      { label: 'Tillbaka',    cls: 'btn bs',  onClick: () => this._wizBack() }
    ];
  },

  _wizCancel() {
    Modal.confirm('Avbryt arbetsorder?', () => {
      this._wiz.modalId = null;
      Modal.close();
    });
  },

  _wizStep(step) {
    const d = this._wiz.data;
    if (step === 1) return this._wizStep1Html(d);
    if (step === 2) return this._wizStep2Html(d);
    if (step === 3) return this._wizStep3Html(d);
    return '';
  },

  _wizStep1Html(d) {
    const cu = d.customerId ? getCu(d.customerId) : null;
    const cuProps = d.customerId
      ? (state.properties||[]).filter(p => p.customerId === d.customerId)
      : [];
    const propSelectHtml = cuProps.length
      ? `<div class="fg"><label>Fastighet (valfritt)</label>
           <select id="wiz-property" onchange="WorkOrdersPage._wizPropertyChanged()">
             <option value="">— Välj fastighet —</option>
             ${cuProps.map(p=>`<option value="${p.id}" ${d.propertyId===p.id?'selected':''}>${esc(p.name||p.address||p.id)}</option>`).join('')}
           </select>
         </div>`
      : '';

    // Objekt-väljare — visas om en fastighet är vald och har objekt
    const propObjs = d.propertyId
      ? (typeof PropertyObjectService !== 'undefined' ? PropertyObjectService.getByProperty(d.propertyId) : [])
      : [];
    const objSelectHtml = propObjs.length
      ? `<div class="fg"><label>Objekt / lägenhet (valfritt)</label>
           <select id="wiz-object" onchange="WorkOrdersPage._wizObjectChanged()">
             <option value="">— Välj objekt —</option>
             ${propObjs.map(o=>`<option value="${o.id}" ${d.objectId===o.id?'selected':''}>${esc(o.objectNumber?o.objectNumber+' – ':'') + esc(o.name || PropertyObjectService.typeLabel(o.type))}</option>`).join('')}
           </select>
         </div>`
      : (d.objectId ? `<input type="hidden" id="wiz-object" value="${esc(d.objectId)}">` : '');

    return `
      <div class="fg"><label>Rubrik / Vad ska göras <span style="color:var(--rd)">*</span></label>
        <input id="wiz-title" value="${esc(d.title||'')}" placeholder="T.ex. Läckage badrum, Fasadtvätt…"></div>
      <div class="g2">
        <div class="fg"><label>Kategori</label>
          <select id="wiz-category">
            <option value="">— Välj kategori —</option>
            ${AO_CATEGORIES.map(c=>`<option value="${c.slug}" ${d.category===c.slug?'selected':''}>${esc(c.label)}</option>`).join('')}
          </select>
        </div>
        <div class="fg" style="align-self:flex-end;"><label>&nbsp;</label>
          ${d.category ? `<div style="margin-top:6px;">${catBadge(d.category)}</div>` : '<div></div>'}
        </div>
      </div>
      <div class="fg"><label>Beskrivning</label>
        <textarea id="wiz-desc" rows="2" placeholder="Mer detaljer om jobbet…">${esc(d.description||'')}</textarea></div>
      <div class="fg"><label>Kund <span style="color:var(--rd)">*</span></label>
        ${CustomerPicker.render('wiz-customer', { value: d.customerId || '', placeholder: '— Välj kund —', onchange: 'WorkOrdersPage._wizCustomerChanged()' })}
        <button class="btn bs bxs" style="margin-top:4px;" onclick="WorkOrdersPage.openNewCustomerFromWizard()">
          + Ny kund
        </button></div>
      <div id="wiz-autofill"></div>
      <div id="wiz-prop-wrap">${propSelectHtml}</div>
      <div id="wiz-obj-wrap">${objSelectHtml}</div>
      <div id="wiz-contacts">${this._wizContactsHtml(d.propertyId)}</div>
      <div id="wiz-addr-wrap">${this._wizAddressBlockHtml(d)}</div>
      <div class="g2">
        <div class="fg"><label>Kontaktperson</label>
          <input id="wiz-contact" value="${esc(d.contactPerson||cu&&cu.contactPerson||'')}" placeholder="Namn"></div>
        <div class="fg"><label>Telefon</label>
          <input id="wiz-phone" type="tel" value="${esc(d.phone||cu&&cu.phone||'')}" placeholder="070-xxx xx xx"></div>
      </div>
      <div class="g2">
        ${(typeof Auth === 'undefined' || Auth.can('objects_sensitive')) ? `<div class="fg"><label>Åtkomst / portkod</label>
          <input id="wiz-access" value="${esc(d.accessCode||'')}" placeholder="T.ex. 1234#"></div>` : `<div class="fg"><label>Åtkomst / portkod</label>
          <div style="font-size:12px;color:var(--mt);padding:6px 0;">Kräver behörigheten för känsliga fält (portkod).</div></div>`}
        <div class="fg"><label>Intern notering</label>
          <input id="wiz-intnote" value="${esc(d.internalNote||'')}" placeholder="Visas ej för kund"></div>
      </div>`;
  },

  /* ── Arbetsadress: fastighet/kund-ärvd som default, med explicit
     "särskild adress"-läge ─────────────────────────────────────────────
     V51B ARBETSORDER §3/§4 — fastighet (om vald) har ALLTID företräde
     framför kund, samma precedens som redan användes i Dashboard-kartan
     och jobRow() (ao.address || prop.address) innan denna omgång — nu
     bara flyttad hit till ETT ställe som räknar ut den föreslagna adressen
     från strukturerade fält (inkl. zip/city), inte bara gatan. */
  _wizResolvedAddress(d) {
    const prop = d.propertyId ? (state.properties||[]).find(p => p.id === d.propertyId) : null;
    if (prop && prop.address) {
      return { address: prop.address, zip: prop.zip || '', city: prop.city || '', source: 'property' };
    }
    const cu = d.customerId ? getCu(d.customerId) : null;
    if (cu && cu.address) {
      return { address: cu.address, zip: cu.zip || '', city: cu.city || '', source: 'customer' };
    }
    return { address: '', zip: '', city: '', source: '' };
  },

  /* Renderar HELA arbetsadress-blocket (resolved-visning ELLER redigerbara
     särskild-adress-fält, plus togglen) — en enda återanvändbar funktion så
     att både förstarendering (_wizStep1Html) och punktvisa uppdateringar
     (kund/fastighet byts, togglen klickas) alltid ger identiskt resultat.
     Patchas in i #wiz-addr-wrap istället för att köra _showWizard() (som
     skulle bygga om HELA steg 1 från `d` och tappa ev. redan inskrivna,
     ännu ej insamlade fältvärden — samma försiktighetsprincip som redan
     används av _wizPropertyChanged()/_wizCustomerChanged() för övriga fält). */
  /* FINAL INVARIANTS AUDIT — `d` (this._wiz.data) är den ENDA
     sanningskällan för den väntande adressen, alltid. De redigerbara
     särskilt-adress-fälten synkas nu in i `d` vid VARJE tangenttryckning
     (`_wizSyncAddr()`, kopplad via oninput/onchange nedan — täcker både
     vanlig inskrivning och Mapbox-autocompletens `selectSuggestion()`,
     som dispatchar riktiga 'change'-event på varje satt fält). Det
     betyder att `d` ALDRIG kan bli inaktuell jämfört med det som visas —
     invariant B (VISNING == PENDING == INSAMLAT == SPARAT) håller
     bokstavligen, inte bara "råkar stämma överens". Kundbytes-/
     fastighetsbytes-hanterarna kan därför även fortsättningsvis hoppa
     över omrendering i särskilt-adress-läge (ren UX-hänsyn, undviker att
     tappa markörposition/fokus mitt i skrivning) UTAN att det någonsin
     är en förutsättning för korrekthet. */
  _wizAddressBlockHtml(d) {
    const override = !!d.addressOverride;
    const resolved = this._wizResolvedAddress(d);
    const resolvedLine2 = [resolved.zip, resolved.city].filter(Boolean).join(' ');

    const resolvedHtml = `
      <div class="addr-card">
        ${resolved.address
          ? `<div>${esc(resolved.address)}</div>${resolvedLine2 ? `<div class="addr-card-city">${esc(resolvedLine2)}</div>` : ''}`
          : `<span style="color:var(--mt);">Ingen adress att visa — välj kund/fastighet med adress, eller ange en särskild adress nedan.</span>`}
      </div>`;

    const editHtml = `
      <input id="wiz-address" value="${esc(d.address||'')}" placeholder="Gatuadress"
        autocomplete="off"
        data-addr-zip="wiz-zip" data-addr-city="wiz-city" data-addr-country="wiz-country" data-addr-lat="wiz-lat" data-addr-lng="wiz-lng"
        oninput="AddressService.handleInput(this); WorkOrdersPage._wizSyncAddr()"
        onchange="WorkOrdersPage._wizSyncAddr()"
        onblur="setTimeout(()=>AddressService.hideSuggestions(),150)">
      <div class="g2" style="margin-top:6px;">
        <div class="fg" style="margin:0;"><label>Postnummer</label>
          <input id="wiz-zip" value="${esc(d.zip||'')}" placeholder="T.ex. 412 54" oninput="WorkOrdersPage._wizSyncAddr()" onchange="WorkOrdersPage._wizSyncAddr()"></div>
        <div class="fg" style="margin:0;"><label>Ort</label>
          <input id="wiz-city" value="${esc(d.city||'')}" placeholder="T.ex. Göteborg" oninput="WorkOrdersPage._wizSyncAddr()" onchange="WorkOrdersPage._wizSyncAddr()"></div>
      </div>
      <input type="hidden" id="wiz-country" value="${esc(d.country||'')}" onchange="WorkOrdersPage._wizSyncAddr()">
      <input type="hidden" id="wiz-lat" value="${d.lat!=null?d.lat:''}">
      <input type="hidden" id="wiz-lng" value="${d.lng!=null?d.lng:''}">`;

    return `
      <div class="fg"><label>Arbetsadress</label>
        ${override ? editHtml : resolvedHtml}
        <label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;font-weight:500;color:var(--tx);cursor:pointer;">
          <input type="checkbox" id="wiz-addr-override" ${override?'checked':''} onchange="WorkOrdersPage._wizToggleAddressOverride(this.checked)">
          Välj en särskild adress för denna arbetsorder
        </label>
      </div>`;
  },

  /* Synkar de levande särskilt-adress-fälten in i `d` — den enda
     sanningskällan. Anropas på varje input/change i editHtml (manuell
     inskrivning OCH Mapbox-autocomplete via selectSuggestion()s riktiga
     'change'-event). Ingen effekt om särskilt-adress-läget inte är
     aktivt (fälten finns då inte i DOM:en). */
  _wizSyncAddr() {
    const d = this._wiz.data;
    if (!d || !d.addressOverride) return;
    d.address = (document.getElementById('wiz-address')?.value || '').trim();
    d.zip     = (document.getElementById('wiz-zip')?.value || '').trim();
    d.city    = (document.getElementById('wiz-city')?.value || '').trim();
    d.country = (document.getElementById('wiz-country')?.value || '').trim();
    d.addressSource = 'manual'; // ev. Mapbox-valdhet är rent kosmetisk metadata, se AddressService.selectSuggestion()
  },

  /* FINAL INVARIANTS AUDIT §7 (oberoende reproducerad R2.3-restbugg) —
     Invariant E: att gå in i särskilt-adress-läge MÅSTE alltid utgå från
     den NUVARANDE länkade standardadressen, ALDRIG från en tidigare,
     ev. inaktuell `d.address` (t.ex. en tidigare kunds adress som blev
     kvarliggande efter en AV-växling). R2.3s villkor `checked && !d.address`
     kunde tysta behålla en gammal kunds adress om `d.address` råkade
     redan vara ifylld (t.ex. efter en tidigare S->AV-cykel som INTE
     skrev tillbaka den nya standardadressen till `d`) — reproducerat:
     K1 -> S PÅ -> K2 -> S AV (visar K2 korrekt via live-beräkning, men
     `d.address` förblev K1) -> S PÅ igen -> K1 dyker upp igen.
     Fix, båda hälfterna:
       PÅ:  reseedar ALLTID `d` från den nuvarande standardadressen —
            aldrig villkorat, aldrig en gissning baserad på om `d.address`
            råkar vara tomt.
       AV:  skriver ALLTID den nuvarande standardadressen in i `d` (inte
            bara visningen) — så `d` är den sanna, uppdaterade
            sanningskällan även i standardläge, och en efterföljande
            PÅ-växling reseedar från RÄTT data. */
  _wizToggleAddressOverride(checked) {
    const d = this._wiz.data;
    d.addressOverride = checked;
    /* Både PÅ och AV seedar/synkar `d` med den NUVARANDE länkade
       standardadressen — se kommentaren ovan. Symmetriskt med avsikt:
       PÅ ger användaren en känd, aktuell startpunkt att justera från;
       AV gör `d` till den sanna, uppdaterade standardadress-posten så
       en EVENTUELL efterföljande PÅ-växling reseedar korrekt. */
    const resolved = this._wizResolvedAddress(d);
    d.address = resolved.address;
    d.zip     = resolved.zip;
    d.city    = resolved.city;
    d.country = '';
    d.addressSource = resolved.source;
    const wrap = document.getElementById('wiz-addr-wrap');
    if (wrap) wrap.innerHTML = this._wizAddressBlockHtml(d);
  },

  _fmtSwedishDate(isoStr) {
    if (!isoStr) return '';
    const DAYS = ['söndag','måndag','tisdag','onsdag','torsdag','fredag','lördag'];
    const MONTHS = ['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december'];
    const d = new Date(isoStr + 'T12:00:00');
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  },

  _wizStep2Html(d) {
    const isPlan = d.status === 'planerad' || !!d.scheduledDate;
    const priorities = [{v:'akut',l:'Akut'},{v:'hög',l:'Hög'},{v:'normal',l:'Normal'},{v:'låg',l:'Låg'}];
    const prio = d.priority || 'normal';
    const activeDateKey = d.scheduledDate || '';

    // Staff modal picker
    const sel = d.staff || [];
    const staffChips = sel.map(id => {
      const s = getStaff(id);
      return s ? `<span class="mpicker-tag">${esc(s.firstName)} ${s.lastName.charAt(0)}.<button onclick="WorkOrdersPage._spmRemove('${id}');event.stopPropagation();">${ic('x',9)}</button></span>` : '';
    }).join('');

    const td = new Date(); const todayStr = tdy();
    const tm = new Date(td); tm.setDate(tm.getDate()+1); const tmStr = tm.toISOString().slice(0,10);
    const nw = new Date(td); nw.setDate(nw.getDate()+1); while(nw.getDay()===0||nw.getDay()===6)nw.setDate(nw.getDate()+1); const nwStr = nw.toISOString().slice(0,10);
    const wk = new Date(td); wk.setDate(wk.getDate()+7); const wkStr = wk.toISOString().slice(0,10);
    const quickDates = [{l:'Idag',d:todayStr},{l:'Imorgon',d:tmStr},{l:'Nästa vardag',d:nwStr},{l:'Om en vecka',d:wkStr}];

    const sweDateDisplay = activeDateKey
      ? `<div id="wiz-date-display" style="font-size:13px;font-weight:600;color:var(--sky);margin-bottom:6px;">${ic('calendar',13)} ${this._fmtSwedishDate(activeDateKey)}</div>`
      : `<div id="wiz-date-display" style="font-size:13px;color:var(--mt);margin-bottom:6px;">${ic('calendar',13)} Inget datum valt</div>`;

    return `
      <div class="fg">
        <label style="font-size:12px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Planeringstyp</label>
        <div class="g2" style="margin-top:6px;">
          <button type="button" class="btn ${!isPlan?'bp':'bs'} bfull" id="btn-pool"
            onclick="WorkOrdersPage._wizSetPlan('pool')" style="padding:12px;font-size:13px;">
            ${ic('clipboard-list',15)} Arbetspool
          </button>
          <button type="button" class="btn ${isPlan?'bp':'bs'} bfull" id="btn-direct"
            onclick="WorkOrdersPage._wizSetPlan('direct')" style="padding:12px;font-size:13px;">
            ${ic('calendar',15)} Planera till datum
          </button>
        </div>
      </div>

      <div id="wiz-pool-info" style="${!isPlan?'':'display:none;'}margin-top:8px;">
        <div style="background:rgba(14,165,233,.08);border:1px solid rgba(14,165,233,.2);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--mt);line-height:1.5;">
          ${ic('info',13)} Ordern läggs i <strong>arbetspoolen</strong> — ingen specifik dag är bokad. Personal kan hämta ordern därifrån när de har tid.
        </div>
      </div>

      <div id="wiz-schedule" style="${isPlan?'':'display:none;'}">
        <div class="fg" style="margin-top:8px;">
          <label>Datum</label>
          ${sweDateDisplay}
          <div class="date-quick-row">
            ${quickDates.map(q=>`<button type="button" class="wiz-qdate-btn btn bxs ${activeDateKey===q.d?'bp':'bghost'}" data-date="${q.d}" style="font-size:11px;padding:3px 8px;" onclick="WorkOrdersPage._wizSetDate('${q.d}')">${q.l}</button>`).join('')}
          </div>
          <div class="date-input-wrap" style="margin-top:6px;">
            <span class="date-input-icon">${ic('calendar',14)}</span>
            <input type="date" id="wiz-date" value="${activeDateKey||todayStr}" oninput="WorkOrdersPage._wizDateInputChanged(this.value)">
            <button type="button" class="date-input-clear" title="Rensa datum"
              onclick="WorkOrdersPage._wizSetDate('')">${ic('x',11)}</button>
          </div>
        </div>
        <div class="g2" style="margin-top:8px;">
          <div class="fg">
            <label>Starttid</label>
            <div class="date-input-wrap">
              <span class="date-input-icon">${ic('clock',13)}</span>
              <input type="time" id="wiz-start" value="${d.scheduledStart||'08:00'}">
            </div>
          </div>
          <div class="fg">
            <label>Sluttid</label>
            <div class="date-input-wrap">
              <span class="date-input-icon">${ic('clock',13)}</span>
              <input type="time" id="wiz-end" value="${d.scheduledEnd||'16:00'}">
            </div>
          </div>
        </div>
      </div>

      <div class="fg">
        <label style="font-size:12px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Prioritet</label>
        <div class="chips" style="margin-top:6px;">
          ${priorities.map(p => `
            <button type="button" class="chip ${prio===p.v?'on':''}" id="prio-${p.v}"
              onclick="WorkOrdersPage._wizSetPrio('${p.v}')">${p.l}</button>`).join('')}
        </div>
      </div>

      <div class="fg">
        <label style="font-size:12px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Personal (valfritt)</label>
        <button type="button" class="btn bs bfull" style="justify-content:flex-start;gap:8px;margin-top:6px;padding:11px 14px;font-size:13px;"
          onclick="WorkOrdersPage._openStaffModal()">
          ${ic('users',15)} ${sel.length ? sel.length + ' person' + (sel.length > 1 ? 'er' : '') + ' vald' : 'Välj personal…'}
        </button>
        <div id="wiz-staff-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
          ${staffChips}
        </div>
      </div>`;
  },

  _wizStep3Html(d) {
    const pgOptions = (state.priceGroups||[]).filter(p=>p.active).map(p =>
      `<option value="${p.id}" ${d.priceGroupId===p.id?'selected':''}>${esc(p.name)} – ${fmt(p.hourRate)} kr/tim</option>`
    ).join('');
    /* Bakåtkompatibilitet: gamla AO:n med priceType='prisgrupp' visas som 'timpris' i UI */
    const pt = (d.priceType === 'prisgrupp' ? 'timpris' : d.priceType) || 'ej_satt';
    const hints = {
      ej_satt:  'Pris sätts senare på arbetsordern eller vid fakturering.',
      fastpris: 'Ange fast pris exkl. moms. Moms 25% tillkommer.',
      timpris:  'Tid debiteras enligt registrerade tidsnoteringar och vald prisgrupp.'
    };
    return `
      <div class="fg"><label>Prissättning</label>
        <div class="chips" style="margin-top:6px;">
          <button type="button" class="chip ${pt==='ej_satt'?'on':''}" id="pt-ej_satt" onclick="WorkOrdersPage._wizSetPriceType('ej_satt')">Ej satt</button>
          <button type="button" class="chip ${pt==='fastpris'?'on':''}" id="pt-fastpris" onclick="WorkOrdersPage._wizSetPriceType('fastpris')">Fastpris</button>
          <button type="button" class="chip ${pt==='timpris'?'on':''}" id="pt-timpris" onclick="WorkOrdersPage._wizSetPriceType('timpris')">Löpande timpris</button>
        </div>
      </div>

      <div id="wiz-pt-hint" class="ibox" style="margin:8px 0;font-size:12px;">${hints[pt]||''}</div>

      <div id="wiz-fastpris-row" style="${pt==='fastpris'?'':'display:none'}">
        <div class="fg"><label>Fastpris ex. moms (kr)</label>
          <input type="number" id="wiz-fastpris" value="${d.fixedPrice||''}" placeholder="0" min="0"
            oninput="WorkOrdersPage._wizUpdateMoms()"></div>
        <div id="wiz-moms-calc" class="ibox" style="font-size:12px;margin-top:4px;display:${d.fixedPrice?'':'none'};">
          ${d.fixedPrice?`Moms 25%: ${fmt(Math.round(d.fixedPrice*0.25))} kr &nbsp;·&nbsp; Inkl. moms: ${fmt(Math.round(d.fixedPrice*1.25))} kr`:''}
        </div>
      </div>

      <div id="wiz-prisgrupp-row" style="${pt==='timpris'?'':'display:none'}">
        <div class="fg"><label>Prisgrupp</label>
          <select id="wiz-pg"><option value="">— Välj prisgrupp —</option>${pgOptions}</select></div>
      </div>

      <div class="fg" style="margin-top:4px;">
        <label style="font-size:12px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Checklista (valfritt)</label>
        <div id="wiz-checklist" style="margin-top:4px;"></div>
        <div style="display:flex;gap:6px;margin-top:6px;">
          <input id="wiz-cl-input" placeholder="Lägg till checkpunkt…" style="flex:1;"
            onkeydown="if(event.key==='Enter'){event.preventDefault();WorkOrdersPage._wizAddCL();}">
          <button type="button" class="btn bs bsm" onclick="WorkOrdersPage._wizAddCL()">${ic('plus',14)} Lägg till</button>
        </div>
      </div>`;
  },

  _bindWizStep1() {
    const d = this._wiz.data;
    d._sources = d._sources || {};

    /* Fyll kunduppgifter om kund redan vald — preserveProperty:true eftersom
       detta är en REN OMBINDNING (första render eller Nästa/Tillbaka), inte
       ett äkta kundbyte; en redan vald fastighet (t.ex. förifylld via
       openCreate(customerId, propertyId)) ska inte tystnat nollställas. */
    if (document.getElementById('wiz-customer') && d.customerId) {
      this._wizCustomerChanged(true);
    }

    /* Spåra manuella ändringar i kontakt/telefon */
    const markManual = (id, key) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => { d._sources[key] = 'manual'; });
    };
    markManual('wiz-contact', 'contact');
    markManual('wiz-phone',   'phone');
  },

  _bindWizStep2() {
    this._wizUpdateStaffChips();
  },

  _bindWizStep3() {
    this._renderWizChecklist();
  },

  /* ── Staff modal picker ────────────────── */
  _openStaffModal() {
    Modal.open({
      title: 'Välj personal',
      body: `
        <div class="fg" style="margin-bottom:8px;">
          <input id="spm-search" placeholder="Sök namn eller titel…"
            oninput="WorkOrdersPage._spmSearch(this.value)" autocomplete="off">
        </div>
        <div id="spm-list" style="max-height:380px;overflow-y:auto;">
          ${this._spmItems(state.staff || [])}
        </div>`,
      buttons: [
        { label: 'Klar', cls: 'btn bp', onClick: () => {
          Modal.close();
          this._wizUpdateStaffChips();
        }}
      ]
    });
    setTimeout(() => document.getElementById('spm-search')?.focus(), 80);
  },

  _spmItems(staffArr) {
    const active = (staffArr || []).filter(s => s.active);
    const sel = this._wiz.data.staff || [];
    if (!active.length) return `<p style="padding:12px 14px;color:var(--mt);font-size:13px;">Ingen aktiv personal</p>`;
    return active.map(s => {
      const isSel = sel.includes(s.id);
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 4px;cursor:pointer;border-bottom:1px solid var(--bg);transition:background .1s;"
          onclick="WorkOrdersPage._spmToggle('${s.id}')"
          onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
          <div style="width:24px;height:24px;border-radius:6px;border:2px solid ${isSel?'var(--navy)':'var(--br)'};
            background:${isSel?'var(--navy)':'transparent'};color:${isSel?'#fff':'transparent'};
            display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${ic('check',13)}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:700;color:var(--tx);">${esc(s.firstName)} ${esc(s.lastName)}</div>
            ${s.title?`<div style="font-size:12px;color:var(--mt);">${esc(s.title)}</div>`:''}
          </div>
        </div>`;
    }).join('');
  },

  _spmToggle(staffId) {
    const staff = this._wiz.data.staff = this._wiz.data.staff || [];
    const i = staff.indexOf(staffId);
    if (i > -1) staff.splice(i, 1);
    else staff.push(staffId);
    this._spmSearch(document.getElementById('spm-search')?.value || '');
  },

  _spmSearch(q) {
    const lq = q.toLowerCase();
    const listEl = document.getElementById('spm-list');
    if (!listEl) return;
    const filtered = (state.staff||[]).filter(s =>
      s.active && (!q || `${s.firstName} ${s.lastName} ${s.title||''}`.toLowerCase().includes(lq))
    );
    listEl.innerHTML = this._spmItems(filtered);
  },

  _spmRemove(staffId) {
    const staff = this._wiz.data.staff = this._wiz.data.staff || [];
    const i = staff.indexOf(staffId);
    if (i > -1) staff.splice(i, 1);
    this._wizUpdateStaffChips();
  },

  _wizUpdateStaffChips() {
    const chipsEl = document.getElementById('wiz-staff-chips');
    if (!chipsEl) return;
    const sel = this._wiz.data.staff || [];
    chipsEl.innerHTML = sel.map(id => {
      const s = getStaff(id);
      return s ? `<span class="mpicker-tag">${esc(s.firstName)} ${s.lastName.charAt(0)}.<button onclick="WorkOrdersPage._spmRemove('${id}');event.stopPropagation();">${ic('x',9)}</button></span>` : '';
    }).join('');
    // Update button label in step 2 if visible
    const openBtn = document.querySelector('.wiz-staff-btn');
    if (openBtn) openBtn.textContent = sel.length ? `${sel.length} person${sel.length > 1 ? 'er' : ''} vald` : 'Välj personal…';
  },

  /* ── Wizard helpers ────────────────────── */

  /*
   * Fyll in kunduppgifter i wizard-formuläret.
   * Skriver över fält som kom från föregående kund (source='customer'),
   * men rör inte fält som användaren skrivit manuellt (source='manual')
   * eller fyllt via Mapbox (addrSource='mapbox').
   */
  _applyCustomerToWizard(cu) {
    const d   = this._wiz.data;
    d._sources = d._sources || {};

    const cont = document.getElementById('wiz-contact');
    const ph   = document.getElementById('wiz-phone');

    /* Arbetsadress: hanteras numera av _wizResolvedAddress()/
       _wizAddressBlockHtml() — den ärvda adressen räknas alltid ut live
       från d.propertyId/d.customerId, ingen DOM-synk behövs här längre.
       Ett aktivt "särskild adress"-läge (d.addressOverride) rörs
       medvetet INTE av ett kundbyte — se uppdragets §4. */

    /* Kontaktperson: fyll om tomt eller kom från kund */
    if (cont && d._sources.contact !== 'manual') {
      cont.value = cu.contactPerson || '';
      d._sources.contact = cu.contactPerson ? 'customer' : '';
    }

    /* Telefon: fyll om tomt eller kom från kund */
    if (ph && d._sources.phone !== 'manual') {
      ph.value = cu.phone || '';
      d._sources.phone = cu.phone ? 'customer' : '';
    }
  },

  /*
   * Rensa alla fält som kom från kund.
   * Lämnar fält med source='manual' eller source='mapbox' orörda.
   */
  _clearCustomerDependentWizardFields() {
    const d = this._wiz.data;
    d._sources = d._sources || {};

    const cont = document.getElementById('wiz-contact');
    const ph   = document.getElementById('wiz-phone');

    if (cont && d._sources.contact === 'customer') {
      cont.value = '';
      d._sources.contact = '';
    }
    if (ph && d._sources.phone === 'customer') {
      ph.value = '';
      d._sources.phone = '';
    }
  },

  /* V51B ARBETSORDER — `preserveProperty` (default false, dvs. oförändrat
     beteende vid ett ÄKTA kundbyte) förhindrar att en redan vald fastighet
     (t.ex. förifylld via openCreate(customerId, propertyId) från
     PropertyDetailPage/PropertyObjectPage/SalesPage) tyst nollställs av
     _bindWizStep1()s ren ombindning av redan befintligt state — se
     anropet i _bindWizStep1() nedan. Utan detta kunde en förvald fastighet
     försvinna bara av att öppna guiden eller gå Nästa/Tillbaka, vilket i
     sin tur gjorde att arbetsadressen tystnat föll tillbaka till kundens
     adress istället för fastighetens (upptäckt via genuin Chromium-
     reproduktion under denna omgångs testning). */
  _wizCustomerChanged(preserveProperty) {
    const sel = document.getElementById('wiz-customer');
    if (!sel) return;
    const id = sel.value;
    this._wiz.data.customerId = id;
    /* V54B — en buren projektkoppling (från openCreate(...,{projectId}))
       hör alltid till EN specifik kund. Ett genuint kundbyte (inte en
       ren ombindning, se preserveProperty) som lämnar den kunden bakom
       rensar kopplingen tyst istället för att riskera en motsägelsefull
       AO/Projekt/Kund-kombination — samma princip som V53B R1:s
       AO-är-auktoritativ-mönster, tillämpad här på Projekt/Kund. */
    if (!preserveProperty && this._wiz.data.projectId) {
      const proj = typeof ProjectService !== 'undefined' ? ProjectService.getById(this._wiz.data.projectId) : null;
      if (!proj || proj.customerId !== id) this._wiz.data.projectId = '';
    }
    if (!preserveProperty) {
      this._wiz.data.propertyId = ''; // reset fastighet vid ÄKTA kundbyte
      this._wiz.data.objectId   = '';
      this._wiz.data.objectName = '';
    }
    const cu = id ? getCu(id) : null;

    if (cu) {
      this._applyCustomerToWizard(cu);
    } else {
      this._clearCustomerDependentWizardFields();
    }

    document.getElementById('wiz-autofill').innerHTML = cu
      ? `<div class="ibox" style="margin-bottom:8px;">${ic('check',14)} ${esc(CustomerService.displayName(cu))}</div>`
      : '';

    // Uppdatera fastighetsväljaren för ny kund
    const propWrap = document.getElementById('wiz-prop-wrap');
    if (propWrap) {
      const cuProps = id ? (state.properties||[]).filter(p => p.customerId === id) : [];
      const selectedPropertyId = preserveProperty ? (this._wiz.data.propertyId || '') : '';
      propWrap.innerHTML = cuProps.length
        ? `<div class="fg"><label>Fastighet (valfritt)</label>
             <select id="wiz-property" onchange="WorkOrdersPage._wizPropertyChanged()">
               <option value="">— Välj fastighet —</option>
               ${cuProps.map(p=>`<option value="${p.id}" ${selectedPropertyId===p.id?'selected':''}>${esc(p.name||p.address||p.id)}</option>`).join('')}
             </select>
           </div>`
        : '';
    }
    // Töm objekt-väljaren när kund BYTS (rör inte vid ren ombindning)
    if (!preserveProperty) {
      const objWrap = document.getElementById('wiz-obj-wrap');
      if (objWrap) objWrap.innerHTML = '';
    }

    /* R2.3 §1/§2 (oberoende reproducerad blockerare, samma klass som
       R2.2:s edit-mode-fix) — OSPARAD SÄRSKILD ADRESS FÖRSVANN VID
       KUNDBYTE I SKAPA-GUIDEN: i särskilt-adress-läge (addressOverride
       ===true) är #wiz-address/-zip/-city/-country LEVANDE DOM-inputs
       som medvetet INTE speglas in i this._wiz.data vid varje
       knapptryckning (de läses direkt från DOM:en i _wizCollectAddress()
       vid nästa steg/Spara). Koden nedan renderade TIDIGARE alltid om
       #wiz-addr-wrap från this._wiz.data oavsett override-läge — vilket
       byggde om formuläret från denna (nu inaktuella) datan och FÖRSTÖRDE
       allt oskrivet den använda skrivit i de levande fälten. En särskild
       adress är oberoende av kunden tills användaren EXPLICIT slår av
       läget — rör därför INTE formuläret alls här när override är på;
       kundId/fastighet/objekt/kontakter uppdateras ändå som avsett ovan. */
    /* FINAL INVARIANTS AUDIT §Q (upptäckt via den nya multi-cykel-
       testmatrisen) — i standardläge räckte det INTE att bara rendera om
       visningen (som räknar ut adressen LIVE varje gång); `d.address/
       zip/city` SJÄLVA måste också skrivas här, annars blir `d` stillastående
       inaktuell så fort en efterföljande kod litar på `d` direkt istället
       för att räkna om (exakt det _wizCollectAddress() nu gör sedan §6:s
       förenkling till en ren serialisering). Utan detta kunde `d.address`
       fortsätta peka på en tidigare kund/fastighet trots att både
       visningen och den faktiska länkningen redan bytt. */
    if (!this._wiz.data.addressOverride) {
      const resolved = this._wizResolvedAddress(this._wiz.data);
      this._wiz.data.address       = resolved.address;
      this._wiz.data.zip           = resolved.zip;
      this._wiz.data.city          = resolved.city;
      this._wiz.data.country       = '';
      this._wiz.data.addressSource = resolved.source;
      const addrWrap = document.getElementById('wiz-addr-wrap');
      if (addrWrap) addrWrap.innerHTML = this._wizAddressBlockHtml(this._wiz.data);
    }
  },

  _wizPropertyChanged() {
    const sel = document.getElementById('wiz-property');
    if (!sel) return;
    const id = sel.value;
    this._wiz.data.propertyId = id;
    this._wiz.data.objectId   = '';
    this._wiz.data.objectName = '';
    /* V54B — samma invariant som kundbytet ovan: en buren projektkoppling
       till ett projekt utan allowMultiProperty får bara kombineras med
       projektets EGEN fastighet eller ingen fastighet alls (aldrig en
       ANNAN fastighet) — se RAPPORT-V54-PROJEKT-DISCOVERY.md §5. Ett
       projekt med allowMultiProperty=true tillåter valfri fastighet hos
       SAMMA kund (redan säkrat av kundbytes-kontrollen ovan/i
       _wizCustomerChanged). */
    if (this._wiz.data.projectId) {
      const proj = typeof ProjectService !== 'undefined' ? ProjectService.getById(this._wiz.data.projectId) : null;
      if (proj && !proj.allowMultiProperty && proj.propertyId && id && id !== proj.propertyId) {
        this._wiz.data.projectId = '';
      }
    }
    // Uppdatera objekt-väljaren
    const objWrap = document.getElementById('wiz-obj-wrap');
    if (objWrap) {
      const POS = typeof PropertyObjectService !== 'undefined' ? PropertyObjectService : null;
      const propObjs = (id && POS) ? POS.getByProperty(id) : [];
      objWrap.innerHTML = propObjs.length
        ? `<div class="fg"><label>Objekt / lägenhet (valfritt)</label>
             <select id="wiz-object" onchange="WorkOrdersPage._wizObjectChanged()">
               <option value="">— Välj objekt —</option>
               ${propObjs.map(o=>`<option value="${o.id}">${esc(o.objectNumber?o.objectNumber+' – ':'')}${esc(o.name || POS.typeLabel(o.type))}</option>`).join('')}
             </select>
           </div>`
        : '';
    }
    // Uppdatera kontaktförslag
    const conWrap = document.getElementById('wiz-contacts');
    if (conWrap) conWrap.innerHTML = this._wizContactsHtml(id);

    /* R2.3 §1/§3 — samma skydd som _wizCustomerChanged() ovan: en
       fastighetsändring rör INTE adressformuläret medan särskild adress
       är aktiv, för att inte förstöra osparade levande fältvärden.
       FINAL INVARIANTS AUDIT §J — samma skrivning av `d` som i
       _wizCustomerChanged() ovan, se den kommentaren. */
    if (!this._wiz.data.addressOverride) {
      const resolved = this._wizResolvedAddress(this._wiz.data);
      this._wiz.data.address       = resolved.address;
      this._wiz.data.zip           = resolved.zip;
      this._wiz.data.city          = resolved.city;
      this._wiz.data.country       = '';
      this._wiz.data.addressSource = resolved.source;
      const addrWrap = document.getElementById('wiz-addr-wrap');
      if (addrWrap) addrWrap.innerHTML = this._wizAddressBlockHtml(this._wiz.data);
    }
  },

  _wizContactsHtml(propertyId) {
    if (!propertyId || typeof PropertyContactService === 'undefined') return '';
    const contacts = PropertyContactService.summaryList(propertyId);
    if (!contacts.length) return '';
    return `<div style="background:rgba(14,165,233,.07);border:1px solid rgba(14,165,233,.18);border-radius:8px;padding:10px 12px;margin-top:4px;">
      <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">${ic('users',12)} Ansvariga för fastigheten</div>
      ${contacts.map(c => `<div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0;">
        <span style="flex:1;min-width:0;">
          ${c.isPrimary ? `<span style="color:var(--sky);font-weight:700;" title="Primär kontakt">★</span> ` : ''}
          <strong>${esc(c.personName)}</strong>
          ${c.roleName ? `<span style="color:var(--mt);"> · ${esc(c.roleName)}</span>` : ''}
          ${c.phone ? `<span style="color:var(--mt);"> · ${esc(c.phone)}</span>` : ''}
        </span>
        <button type="button" class="btn bs bxs" style="font-size:10px;padding:2px 7px;white-space:nowrap;"
          onclick="WorkOrdersPage._wizUseContact(${JSON.stringify(c.personName)},${JSON.stringify(c.phone)});event.stopPropagation();">
          Använd
        </button>
      </div>`).join('')}
    </div>`;
  },

  _wizUseContact(name, phone) {
    const nc = document.getElementById('wiz-contact');
    const np = document.getElementById('wiz-phone');
    if (nc && !nc.value) nc.value = name || '';
    else if (nc) nc.value = name || '';
    if (np && !np.value) np.value = phone || '';
    else if (np) np.value = phone || '';
    this._wiz.data.contactPerson = nc ? nc.value : name;
    this._wiz.data.phone = np ? np.value : phone;
  },

  _wizObjectChanged() {
    const sel = document.getElementById('wiz-object');
    if (!sel) return;
    const id = sel.value;
    this._wiz.data.objectId = id;
    const POS = typeof PropertyObjectService !== 'undefined' ? PropertyObjectService : null;
    const obj = (id && POS) ? POS.getById(id) : null;
    this._wiz.data.objectName       = obj ? (obj.name || obj.objectNumber || '') : '';
    this._wiz.data.objectNumber     = obj ? (obj.objectNumber || '') : '';
    this._wiz.data.entrance         = obj ? (obj.entrance   || '') : '';
    this._wiz.data.stairwell        = obj ? (obj.stairwell  || '') : '';
    this._wiz.data.floor            = obj ? (obj.floor      || '') : '';
    this._wiz.data.apartmentNumber  = obj ? (obj.apartmentNumber || '') : '';

    if (!obj) return;

    /* Tillträdeskod — hämtas via EF om användaren har objects_sensitive */
    if (Auth.can('objects_sensitive')) {
      const accessEl = document.getElementById('wiz-access');
      const wiz = this._wiz;
      if (accessEl && !accessEl.value) {
        const jwt = Auth.getAccessToken();
        if (jwt) {
          fetch(SUPABASE_URL + '/functions/v1/get-sensitive-fields', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
            body: JSON.stringify({ objectId: obj.id })
          }).then(function(r) { return r.ok ? r.json() : {}; })
            .then(function(d) {
              const val = (d.accessInformation || d.doorCode || '').trim();
              if (val && accessEl && !accessEl.value) {
                accessEl.value = val;
                if (wiz) wiz.data.accessCode = val;
              }
            }).catch(function() {});
        }
      }
    }

    /* Kontaktperson från objekt.contacts[] eller PropertyContactService */
    var contact = null;
    /* 1. PropertyContactService: primärkontakt på objektnivå */
    if (typeof PropertyContactService !== 'undefined') {
      const pcs = PropertyContactService.getByObject(obj.id);
      const primary = pcs.find(c => c.isPrimary) || pcs[0];
      if (primary) {
        contact = {
          name:  primary.personNameSnapshot  || '',
          phone: primary.personPhoneSnapshot || '',
          email: primary.personEmailSnapshot || '',
          id:    primary.personId || ''
        };
      }
    }
    /* 2. Fallback: obj.contacts[] (äldre schema) */
    if (!contact && obj.contacts && obj.contacts.length) {
      const first = obj.contacts.find(c => c.active !== false) || obj.contacts[0];
      if (first && first.contactId) {
        /* leta i state.customers[].contacts[] */
        var cc = null;
        (state.customers || []).forEach(function(cu) {
          (cu.contacts || []).forEach(function(c) { if (c.id === first.contactId) cc = c; });
        });
        if (cc) contact = { name: cc.name||'', phone: cc.phone||'', email: cc.email||'', id: first.contactId };
      }
    }

    if (contact) {
      const nc = document.getElementById('wiz-contact');
      const np = document.getElementById('wiz-phone');
      if (nc && !nc.value) { nc.value = contact.name;  this._wiz.data.contactPerson = contact.name; }
      if (np && !np.value) { np.value = contact.phone; this._wiz.data.phone         = contact.phone; }
      this._wiz.data.contactEmail = contact.email || '';
      this._wiz.data.contactId    = contact.id    || '';
    }

    /* Uppdatera kontaktförslag */
    const conWrap = document.getElementById('wiz-contacts');
    if (conWrap) conWrap.innerHTML = this._wizContactsHtml(this._wiz.data.propertyId);
  },

  _wizSetDate(dateStr) {
    this._wiz.data.scheduledDate = dateStr;
    const el = document.getElementById('wiz-date');
    if (el) el.value = dateStr;
    const disp = document.getElementById('wiz-date-display');
    if (disp) {
      if (dateStr) {
        disp.style.color = 'var(--sky)';
        disp.style.fontWeight = '600';
        disp.innerHTML = `${ic('calendar',13)} ${this._fmtSwedishDate(dateStr)}`;
      } else {
        disp.style.color = 'var(--mt)';
        disp.style.fontWeight = 'normal';
        disp.innerHTML = `${ic('calendar',13)} Inget datum valt`;
      }
    }
    document.querySelectorAll('.wiz-qdate-btn').forEach(b => {
      b.className = `wiz-qdate-btn btn bxs ${b.dataset.date === dateStr ? 'bp' : 'bghost'}`;
      b.style.cssText = 'font-size:11px;padding:3px 8px;';
    });
  },

  _wizDateInputChanged(v) { this._wizSetDate(v); },

  _wizSetPlan(mode) {
    const isPlan = mode === 'direct';
    const sched    = document.getElementById('wiz-schedule');
    const poolInfo = document.getElementById('wiz-pool-info');
    if (sched)    sched.style.display    = isPlan ? '' : 'none';
    if (poolInfo) poolInfo.style.display = isPlan ? 'none' : '';
    const pool   = document.getElementById('btn-pool');
    const direct = document.getElementById('btn-direct');
    if (pool)   pool.className   = `btn ${!isPlan?'bp':'bs'} bfull`;
    if (direct) direct.className = `btn ${isPlan?'bp':'bs'} bfull`;
    this._wiz.data.status = isPlan ? 'planerad' : 'pool';
    if (!isPlan) { this._wiz.data.scheduledDate = ''; this._wiz.data.scheduledStart = ''; this._wiz.data.scheduledEnd = ''; }
  },

  _wizSetPrio(p) {
    this._wiz.data.priority = p;
    document.querySelectorAll('[id^="prio-"]').forEach(b =>
      b.classList.toggle('on', b.id === 'prio-'+p)
    );
  },

  _wizSetPriceType(pt) {
    this._wiz.data.priceType = pt;
    ['ej_satt','fastpris','timpris'].forEach(t => {
      const b = document.getElementById('pt-'+t);
      if (b) b.classList.toggle('on', t === pt);
    });
    const fp   = document.getElementById('wiz-fastpris-row');
    const pg   = document.getElementById('wiz-prisgrupp-row');
    const hint = document.getElementById('wiz-pt-hint');
    if (fp) fp.style.display = pt === 'fastpris' ? '' : 'none';
    if (pg) pg.style.display = pt === 'timpris'  ? '' : 'none';
    const hints = {
      ej_satt: 'Pris sätts senare på arbetsordern eller vid fakturering.',
      fastpris: 'Ange fast pris exkl. moms. Moms 25% tillkommer.',
      timpris:  'Tid debiteras enligt registrerade tidsnoteringar och vald prisgrupp.'
    };
    if (hint) hint.textContent = hints[pt] || '';
  },

  _wizUpdateMoms() {
    const fp  = parseFloat(document.getElementById('wiz-fastpris')?.value) || 0;
    const el  = document.getElementById('wiz-moms-calc');
    if (!el) return;
    if (!fp) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = `Moms 25%: ${fmt(Math.round(fp*0.25))} kr &nbsp;·&nbsp; Inkl. moms: ${fmt(Math.round(fp*1.25))} kr`;
  },

  _wizAddCL() {
    const inp = document.getElementById('wiz-cl-input');
    if (!inp || !inp.value.trim()) return;
    const d = this._wiz.data;
    d.checklist = d.checklist || [];
    d.checklist.push({ id: 'c' + Date.now(), text: inp.value.trim(), done: false });
    inp.value = '';
    this._renderWizChecklist();
    inp.focus();
  },

  _renderWizChecklist() {
    const el = document.getElementById('wiz-checklist');
    if (!el) return;
    const items = this._wiz.data.checklist || [];
    el.innerHTML = items.map((c, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--bg);">
        <span style="color:var(--mt);">${ic('check',14)}</span>
        <span style="flex:1;font-size:13px;">${esc(c.text)}</span>
        <button class="btn bxs bd" onclick="WorkOrdersPage._wizRemoveCL(${i})">${ic('x',12)}</button>
      </div>`).join('');
  },

  _wizRemoveCL(idx) {
    (this._wiz.data.checklist || []).splice(idx, 1);
    this._renderWizChecklist();
  },

  /* ── Wizard collect ────────────────────── */
  /* Slutgiltig arbetsadress vid spara — särskild adress (om påslagen) från
     de redigerbara fälten, annars den ärvda fastighets-/kundadressen kopierad
     rakt in i AO:ns EGNA fält (Schema.workOrder(): address/zip/city/country).
     d.lat/d.lng sätts ALDRIG här (heller inte ens vid en nyss vald Mapbox-
     autokomplettering) — endast WorkOrderService.geocodeAddressIfNeeded()
     (körs automatiskt efter create()/update()) äger all geokodning. En
     tidigare version litade på de dolda lat/lng-fälten som Mapbox-
     autokompletteringen fyller i (som en snabbhets-optimering för att slippa
     en extra geokodningsfråga direkt efter spara) — men de fälten kan bli
     INAKTUELLA om användaren sedan redigerar postnummer/ort-fälten direkt
     (dessa har ingen egen lyssnare som ogiltigförklarar koordinaterna, bara
     gatuadressfältets AddressService.handleInput() gör det), vilket kunde
     spara en koordinat som INTE hörde till den slutgiltiga adressen — exakt
     den risk uppdragets §8 varnar för. Riktig, alltid korrekt geokodning
     efter varje spara väger tyngre än en enstaka extra API-fråga. */
  _wizCollectAddress(d) {
    /* FINAL INVARIANTS AUDIT §6 — förenklad till en ren serialisering.
       `d.address/zip/city/country/addressSource` är REDAN den enda,
       aktuella sanningskällan vid det här laget: `_wizSyncAddr()` håller
       dem synkade i särskilt-adress-läge (varje tangenttryckning/
       autocomplete-val), och `_wizCustomerChanged()`/`_wizPropertyChanged()`/
       `_wizToggleAddressOverride()` håller dem synkade i standardläge.
       Ingen ny läsning av DOM:en eller ny beräkning behövs eller görs här
       längre — den här funktionen är inte en andra beslutsmotor. */
    const overrideEl = document.getElementById('wiz-addr-override');
    d.addressOverride = overrideEl ? overrideEl.checked : !!d.addressOverride;
    /* lat/lng/geocodedAddress sätts ALDRIG härifrån — en helt NY AO har dem
       redan null/'' via Schema.workOrder(), och WorkOrderService.
       geocodeAddressIfNeeded() (körs automatiskt efter create()) äger all
       geokodning centralt, race-skyddad. Se motsvarande, mer utförliga
       kommentar i WorkOrderDetailPage._editCollectAddress(). */
    d.lat = null; d.lng = null; d.geocodedAddress = '';
  },

  /* R1 §6 — särskild-adress-validering: ett manuellt satt "särskild adress"
     utan postnummer ELLER ort skulle kunna återskapa exakt den ursprungliga
     tvetydigheten (samma gatunamn i flera städer) — se
     AddressService.geocodeTrusted(), som numera aldrig sätter en nål utan
     stadskontext. Kräver gata + minst postnr ELLER ort innan spara tillåts;
     återanvänds av både guiden och redigera-AO-dialogen. */
  _validateAddressOverride(d) {
    if (!d.addressOverride) return true;
    if (!d.address) { showToast('Ange en gatuadress för den särskilda adressen'); return false; }
    if (!d.zip && !d.city) { showToast('Ange postnummer eller ort för den särskilda adressen (annars kan kartan hamna i fel stad)'); return false; }
    return true;
  },

  _wizCollectStep1() {
    const d = this._wiz.data;
    d.title         = (document.getElementById('wiz-title')?.value || '').trim();
    d.category      = document.getElementById('wiz-category')?.value || '';
    d.description   = (document.getElementById('wiz-desc')?.value || '').trim();
    d.customerId    = document.getElementById('wiz-customer')?.value || '';
    this._wizCollectAddress(d);
    d.contactPerson = document.getElementById('wiz-contact')?.value.trim() || '';
    d.phone         = document.getElementById('wiz-phone')?.value.trim() || '';
    d.accessCode    = document.getElementById('wiz-access')?.value.trim() || '';
    d.internalNote  = document.getElementById('wiz-intnote')?.value.trim() || '';
    // Objekt (lägenhet/lokal) — inkl. snapshot-fält
    const objSel = document.getElementById('wiz-object');
    if (objSel && objSel.tagName === 'SELECT') {
      d.objectId = objSel.value || '';
      const POS = typeof PropertyObjectService !== 'undefined' ? PropertyObjectService : null;
      const obj = (d.objectId && POS) ? POS.getById(d.objectId) : null;
      if (obj) {
        d.objectName      = obj.name || obj.objectNumber || '';
        d.objectNumber    = obj.objectNumber    || '';
        d.entrance        = obj.entrance        || '';
        d.stairwell       = obj.stairwell       || '';
        d.floor           = obj.floor           || '';
        d.apartmentNumber = obj.apartmentNumber || '';
      }
    }
    // customerName snapshot
    const cu = d.customerId ? (state.customers||[]).find(c => c.id === d.customerId) : null;
    d.customerName = cu ? CustomerService.displayName(cu) : '';

    if (!d.title)      { showToast('Rubrik krävs'); return false; }
    if (!d.customerId) { showToast('Välj en kund'); return false; }
    if (!this._validateAddressOverride(d)) return false;
    return true;
  },

  _wizCollectStep2() {
    const d = this._wiz.data;
    const isPlan = d.status === 'planerad';
    if (isPlan) {
      d.scheduledDate  = document.getElementById('wiz-date')?.value || '';
      d.scheduledStart = document.getElementById('wiz-start')?.value || '';
      d.scheduledEnd   = document.getElementById('wiz-end')?.value || '';
      if (!d.scheduledDate) { showToast('Välj datum'); return false; }
    } else {
      d.scheduledDate = ''; d.scheduledStart = ''; d.scheduledEnd = '';
    }
    if (!d.priority) d.priority = 'normal';
    return true;
  },

  _wizCollectStep3() {
    const d = this._wiz.data;
    d.priceType    = d.priceType    || 'ej_satt';
    d.fixedPrice   = parseFloat(document.getElementById('wiz-fastpris')?.value || '0') || 0;
    d.priceGroupId = document.getElementById('wiz-pg')?.value || '';
    if (d.priceType === 'fastpris' && !d.fixedPrice) { showToast('Ange fastpris'); return false; }
    return true;
  },

  _wizNext() {
    const step = this._wiz.step;
    const ok = step === 1 ? this._wizCollectStep1() : this._wizCollectStep2();
    if (!ok) return;
    this._wiz.step++;
    this._showWizard();
  },

  _wizBack() {
    if (this._wiz.step > 1) {
      this._wiz.step--;
      this._showWizard();
    }
  },

  _wizSave() {
    if (!this._wizCollectStep3()) return;
    const d  = this._wiz.data;
    const _prop = d.propertyId ? (state.properties||[]).find(p => p.id === d.propertyId) : null;
    /* V54B — defensivt slutlager (samma disciplin som V53B R1): den
       interaktiva synkroniseringen i _wizCustomerChanged()/
       _wizPropertyChanged() räcker inte ensam — detta garanterar
       invarianten oavsett DOM-tillstånd. */
    /* V54B R2 — blockerare 3: en icke-tom, INKOMPATIBEL `projectId`
       rensades tidigare tyst till '' och AO:n skapades ändå okopplad —
       en användare som uttryckligen skapade en AO FRÅN ett Projekt fick
       alltså ingen indikation på att kopplingen tappades. En sådan
       kombination BLOCKERAR nu sparningen helt istället — ingen AO
       skapas, ingen tyst frikoppling. Endast ETT tomt `projectId`
       (dvs. inget projekt-sammanhang alls) fortsätter oförändrat. */
    const _projectId = d.projectId || '';
    if (_projectId && !(typeof ProjectService !== 'undefined' && ProjectService.isChildCompatible(_projectId, d.customerId, d.propertyId || ''))) {
      showToast('Arbetsordern kan inte skapas i projektet eftersom kund eller fastighet inte är förenlig med projektet.');
      return;
    }
    const ao = WorkOrderService.create({
      title:           d.title,
      description:     d.description,
      customerId:      d.customerId,
      customerName:    d.customerName    || '',
      propertyId:      d.propertyId      || '',
      propertyName:    _prop ? (_prop.name || _prop.address || '') : '',
      objectId:        d.objectId        || '',
      objectName:      d.objectName      || '',
      objectNumber:    d.objectNumber    || '',
      address:         d.address,
      zip:             d.zip             || '',
      city:            d.city            || '',
      country:         d.country         || '',
      lat:             d.lat != null ? d.lat : null,
      lng:             d.lng != null ? d.lng : null,
      geocodedAddress: d.geocodedAddress || '',
      addressOverride: !!d.addressOverride,
      addressSource:   d.addressSource   || '',
      contactPerson:   d.contactPerson,
      contactEmail:    d.contactEmail    || '',
      contactId:       d.contactId       || '',
      phone:           d.phone,
      /* T4-A (SÄK-7): portkod bara med objects_sensitive (servern nekar annars, field_protected). */
      accessCode:      (typeof Auth === 'undefined' || Auth.can('objects_sensitive')) ? d.accessCode : '',
      entrance:        d.entrance        || '',
      stairwell:       d.stairwell       || '',
      floor:           d.floor           || '',
      apartmentNumber: d.apartmentNumber || '',
      internalNote:    d.internalNote,
      status:          d.status    || 'pool',
      priority:        d.priority  || 'normal',
      category:        d.category  || '',
      priceType:       d.priceType,
      fixedPrice:      d.fixedPrice,
      priceGroupId:    d.priceGroupId,
      staff:           d.staff      || [],
      scheduledDate:   d.scheduledDate  || '',
      scheduledStart:  d.scheduledStart || '',
      scheduledEnd:    d.scheduledEnd   || '',
      checklist:       (d.checklist || []).map(c => ({ ...c })),
      materials:       [],
      notes:           [],
      log:             [],
      timeEntries:     [],
      projectId:       _projectId
    });
    /* V54B R2 — blockerare 4: WorkOrderService.create() har sedan R1 TVÅ
       giltiga returkontrakt — AO-objektet vid lyckat skapande, eller
       `{ok:false, error}` om en icke-tom `projectId` visade sig
       inkompatibel (defensivt slutlager, se WorkOrderService.js).
       Denna kod antog tidigare ALLTID success och läste `ao.id` direkt
       — vid ett `{ok:false}`-svar hade det kraschat eller (värre) tyst
       navigerat till en obefintlig AO. Nu kontrolleras resultatet
       INNAN modal stängs/callback körs/navigering sker: vid fel visas
       felmeddelandet, modalen förblir öppen, ingen callback, ingen
       navigering, ingen "AO skapad" — inget delvis lyckat tillstånd.
       Befintliga lyckade anrop är helt oförändrade. */
    if (!ao || ao.ok === false) {
      showToast((ao && ao.error) || 'Arbetsordern kunde inte skapas.');
      return;
    }
    /* V47: callback körs EFTER lyckad persist (WorkOrderService.create() har
       redan persistat synkront ovan), aldrig innan — se openCreate(). */
    const onCreated = this._wiz.onCreated;
    this._wiz.modalId = null;
    if (typeof onCreated === 'function') {
      try { onCreated(ao); } catch (e) { console.warn('[WorkOrdersPage] onCreated-fel:', e); }
    }
    Modal.close();
    Sidebar.updateBadges();
    showToast(`${WorkOrderService.displayNumberOrPending(ao)} skapad`);
    Router.showPage('pg-ao-detail', { aoId: ao.id });
  },

  /* ── Ny kund från wizard ───────────────── */
  openNewCustomerFromWizard() {
    // Save current step 1 fields before opening second modal
    const titleEl = document.getElementById('wiz-title');
    const descEl  = document.getElementById('wiz-desc');
    if (titleEl) this._wiz.data.title = titleEl.value.trim();
    if (descEl)  this._wiz.data.description = descEl.value.trim();

    Modal.open({
      title: 'Ny kund',
      wide: true,
      body: CustomersPage._formHtml(null),
      buttons: [
        { label: 'Skapa kund', cls: 'btn bp', onClick: () => {
          const type = document.getElementById('cu-type')?.value || 'foretag';
          const data = { type };
          if (type === 'privat') {
            data.firstName = (document.getElementById('cu-firstname')?.value || '').trim();
            data.lastName  = (document.getElementById('cu-lastname')?.value || '').trim();
            data.personnr  = (document.getElementById('cu-personnr')?.value || '').trim();
            data.name = `${data.firstName} ${data.lastName}`.trim();
            if (!data.firstName) { showToast('Förnamn krävs'); return; }
          } else {
            data.name = (document.getElementById('cu-name')?.value || '').trim();
            if (!data.name) { showToast('Kundnamn krävs'); return; }
            data.orgNr = (document.getElementById('cu-orgnr')?.value || '').trim();
            data.contactPerson = (document.getElementById('cu-contact')?.value || '').trim();
          }
          data.phone   = (document.getElementById('cu-phone')?.value || '').trim();
          data.email   = (document.getElementById('cu-email')?.value || '').trim();
          data.address = (document.getElementById('cu-address')?.value || '').trim();
          data.zip     = (document.getElementById('cu-zip')?.value || '').trim();
          data.city    = (document.getElementById('cu-city')?.value || '').trim();

          const cu = CustomerService.create(data);
          Modal.close();

          // V49A2A: ren omrendering av CustomerPicker mot uppdaterad
          // state.customers, istället för manuell createElement('option')-
          // splicing i den gamla koden. Se RAPPORT-V49A2A.md §9.
          const wiz = document.getElementById(this._wiz.modalId);
          if (wiz?.querySelector('#cpouter-wiz-customer')) {
            this._wiz.data.customerId = cu.id;
            CustomerPicker.refresh('wiz-customer', { value: cu.id, placeholder: '— Välj kund —', onchange: 'WorkOrdersPage._wizCustomerChanged()' });
            this._wizCustomerChanged();
          }
          showToast(`Kund ${CustomerService.displayName(cu)} skapad`);
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });

    setTimeout(() => {
      const sel = document.getElementById('cu-type');
      if (sel) sel.addEventListener('change', () => CustomersPage._toggleTypeFields(sel.value));
      CustomersPage._toggleTypeFields(sel?.value || 'foretag');
    }, 60);
  },

  /* En AO som är raderad, arkiverad eller redan fakturerad är låst för
     bulk-mutation (samma spärr som den enskilda redigerings-UI:n redan
     använder, se rad ~568/623: !ao.archived&&!ao.deleted). Markeringar kan
     ligga kvar över flikbyten (avsiktligt, SPRINT1 §7) — så en dold, låst
     AO kan fortfarande vara markerad när en bulk-åtgärd körs. UI-gömning
     räcker alltså inte; varje vald AO valideras här, i mutationslagret. */
  _isAoLockedForBulk(ao) {
    return !!(ao.archived || ao.deleted || ao.status === 'fakturerad');
  },

  /* View-scope-boundary för bulk-mutation/export (V29 §3/§4): EXAKT samma
     semantik som renderList()/_baseList() rad ~441-446 använder för att
     bygga den lista kryssrutorna renderas från. SelectionModel.toggle()/
     selectAllVisible() är publika metoder — ett ID kan i teorin läggas in
     programmatiskt (t.ex. via konsolen) utan att ha passerat renderad UI.
     Denna helper är boundary-kontrollen i MUTATIONS-/EXPORT-lagret, inte
     bara UI-filtrering, så det spelar ingen roll hur ID:t hamnade i
     markeringen. */
  _canAccessAo(ao) {
    const canViewAll = Auth.can('ao_view_all') || Auth.can('all');
    if (canViewAll) return true;
    if (Auth.can('ao_view_own') && state.currentUser) {
      const myId = state.currentUser.id;
      return (ao.staff || []).includes(myId) || ao.status === 'pool';
    }
    return false;
  },

  /* Poster i state.workOrders som anroparen både FÅR se och som är kända
     (existerar). Används av bulk-mutation OCH av export-boundary-filtret
     (V29 §4) — samma regel på båda ställena. */
  _authorizedAos(ids) {
    return (state.workOrders || []).filter(ao => ids.indexOf(ao.id) !== -1 && WorkOrdersPage._canAccessAo(ao));
  },

  _bulkBusy: false,

  /* ── Bulk: ändra status ─────────────────────────────────────────────
     "Klar" utesluts medvetet ur bulk-menyn (SPRINT1 §13): enskild
     klarmarkering (WorkOrderDetailPage.markComplete) varnar och kräver
     ett aktivt beslut per order om checklistan är ofullständig — det
     går inte att generalisera till en batch utan att antingen tysta
     den varningen (osäkert) eller kräva en per-order-granskning i
     dialogen (ingen "bulk" kvar). Öppna ordern individuellt istället.
     V29 §1: allowlisten är den ENDA källan för vilka statusar bulk-UI:t
     visar OCH vilka mutationslagret accepterar — ett direktanrop med
     'klar', 'fakturerad' eller ett påhittat värde nekas identiskt. */
  _BULK_ALLOWED_STATUSES: ['nytt', 'pool', 'planerad', 'pågående', 'avbruten'],

  _bulkStatusIds: [],
  _bulkHiddenIds: [],      // markerade som döljs av filtret när dialogen öppnades (ingår inte)

  /* ── V3.2: markering ↔ filter ───────────────────────────────────────
     Markeringen ligger kvar över filter- och sökbyten (SPRINT1 §7), men en
     massåtgärd ska aldrig tyst omfatta rader som filtret döljer. Därför
     delas markeringen alltid upp i "matchar nuvarande filter och sök"
     (ingår) och "döljs" (ingår inte, räknas upp i dialogen). Urvalet
     räknas om här, vid åtgärden — inte från en gammal rendering. */
  _matchingSet() {
    return new Set(this._matchingList().map(a => a.id));
  },
  _splitSelection(ids) {
    const m = this._matchingSet();
    const inView = [], hidden = [];
    (ids || []).forEach(id => (m.has(id) ? inView : hidden).push(id));
    return { inView, hidden };
  },
  _exportScope(items) {
    const m = this._matchingSet();
    const allowed = (items || []).filter(ao => WorkOrdersPage._canAccessAo(ao));
    const scoped = allowed.filter(ao => m.has(ao.id));
    if (allowed.length > scoped.length && typeof showToast === 'function') showToast((allowed.length - scoped.length) + (allowed.length - scoped.length === 1 ? ' markerad' : ' markerade') + ' som döljs av nuvarande filter exporteras inte.');
    return scoped;
  },

  /* Klartextlista över arbetsordrar: "AO-001, AO-002 … och 4 till". */
  _labelList(aos, max) {
    const tags = this._dupTags(this._permittedList());
    const m = max || 8;
    const names = aos.slice(0, m).map(a => this._labelText(a, tags));
    return names.join(', ') + (aos.length > m ? ' … och ' + (aos.length - m) + ' till' : '');
  },
  _aosById(ids) {
    const set = new Set(ids || []);
    return (state.workOrders || []).filter(a => set.has(a.id));
  },
  _noun(n) { return n === 1 ? 'arbetsorder' : 'arbetsordrar'; },

  /* Vad dialogen gäller: antal + vilka, och de markerade som filtret döljer. */
  _bulkScopeHtml(aos, hiddenIds) {
    const hidden = this._aosById(hiddenIds);
    return `<div class="aol-bulk-scope">
      <div class="aol-bulk-which"><strong>Gäller ${aos.length} ${this._noun(aos.length)}:</strong> ${esc(this._labelList(aos))}</div>
      ${hidden.length ? `<div class="aol-bulk-hidden">${ic('eye-off',13)}<span>${hidden.length} ${hidden.length === 1 ? 'markerad' : 'markerade'} döljs av nuvarande filter och <strong>ingår inte</strong>: ${esc(this._labelList(hidden, 5))}</span></div>` : ''}
    </div>`;
  },

  _openBulkStatus(ids) {
    if (!Auth.can('ao_edit')) { showToast('Du saknar behörighet för denna åtgärd.'); return; }
    const split = WorkOrdersPage._splitSelection(ids);
    if (!split.inView.length) { showToast('Ingen av de markerade arbetsordrarna syns med nuvarande filter — inget ändras. Rensa filtret eller markera på nytt.'); return; }
    WorkOrdersPage._bulkStatusIds = split.inView;
    WorkOrdersPage._bulkHiddenIds = split.hidden;
    const aos = WorkOrdersPage._aosById(split.inView);
    const n = split.inView.length;
    Modal.open({
      title: `Ändra status på ${n} ${WorkOrdersPage._noun(n)}`,
      body: `
        ${WorkOrdersPage._bulkScopeHtml(aos, split.hidden)}
        <p style="font-size:12px;color:var(--mt);margin:10px 0;">"Klar" kan inte sättas i bulk — checklistan måste granskas per order. Öppna varje order individuellt för att klarmarkera. Fakturerade, arkiverade och raderade order hoppas alltid över.</p>
        <div class="aol-bulk-label">Välj ny status</div>
        ${WorkOrdersPage._BULK_ALLOWED_STATUSES.map(s => `<div class="crow" role="button" tabindex="0" onclick="Modal.close();setTimeout(()=>WorkOrdersPage._confirmBulkStatus('${s}'),50);" onkeydown="if(event.key==='Enter'){this.click()}">${sbdg(s)}</div>`).join('')}
      `
    });
  },

  /* Läsande förhandsvisning av _bulkSetStatus(): exakt samma villkor, i
     samma ordning, så att bekräftelsen säger hur många som FAKTISKT
     ändras (och toasten efteråt säger samma sak). Muterar ingenting. */
  _bulkStatusPlan(ids, status) {
    const change = [], unchanged = [], skipped = [];
    (state.workOrders || []).forEach(ao => {
      if (ids.indexOf(ao.id) === -1) return;
      if (!WorkOrdersPage._canAccessAo(ao) || WorkOrdersPage._isAoLockedForBulk(ao)) { skipped.push(ao); return; }
      if (ao.status === status) { unchanged.push(ao); return; }
      change.push(ao);
    });
    return { change, unchanged, skipped };
  },

  _confirmBulkStatus(status) {
    if (WorkOrdersPage._bulkBusy) return;
    if (!Auth.can('ao_edit')) { showToast('Du saknar behörighet för denna åtgärd.'); return; }
    if (WorkOrdersPage._BULK_ALLOWED_STATUSES.indexOf(status) === -1) { showToast('Den statusen kan inte sättas i bulk.'); return; }
    const ids = WorkOrdersPage._bulkStatusIds || [];
    if (!ids.length) return;
    const plan = WorkOrdersPage._bulkStatusPlan(ids, status);
    const k = plan.change.length;
    const notes = [];
    if (plan.unchanged.length) notes.push(`${plan.unchanged.length} har redan status "${esc(statusLabel(status))}" och ändras inte: ${esc(WorkOrdersPage._labelList(plan.unchanged, 5))}`);
    if (plan.skipped.length) notes.push(`${plan.skipped.length} hoppas över (fakturerade, arkiverade, raderade eller utanför din behörighet): ${esc(WorkOrdersPage._labelList(plan.skipped, 5))}`);
    const hiddenN = (WorkOrdersPage._bulkHiddenIds || []).length;
    if (hiddenN) notes.push(`${hiddenN} ${hiddenN === 1 ? 'markerad' : 'markerade'} som döljs av nuvarande filter ingår inte.`);
    const notesHtml = notes.length ? `<ul class="aol-bulk-notes">${notes.map(x => `<li>${x}</li>`).join('')}</ul>` : '';
    if (!k) {
      Modal.open({
        title: 'Ingen ändring',
        body: `<p class="aol-bulk-lead">Ingen av de ${ids.length} markerade arbetsordrarna kan få status ${sbdg(status)}.</p>${notesHtml}`,
        buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
      });
      return;
    }
    Modal.open({
      title: `Ändra status på ${k} ${WorkOrdersPage._noun(k)}`,
      body: `<p class="aol-bulk-lead">Ny status: ${sbdg(status)}</p>
        <div class="aol-bulk-which"><strong>Ändras (${k}):</strong> ${esc(WorkOrdersPage._labelList(plan.change, 12))}</div>
        ${notesHtml}`,
      buttons: [
        { label: `Ändra status på ${k}`, cls: 'btn bp', onClick: () => {
          Modal.close();
          if (WorkOrdersPage._bulkBusy) return;
          WorkOrdersPage._bulkBusy = true;
          const r = WorkOrdersPage._bulkSetStatus(ids, status);
          WorkOrdersPage._bulkBusy = false;
          if (!r.ok) { showToast(r.error); return; }
          SelectionModel.clearAll();
          showToast(WorkOrdersPage._bulkResultMessage(r, `till "${statusLabel(status)}"`, 'redan hade den statusen', 'inte kan hanteras (låsta eller utanför din behörighet)'));
        } },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* Samma fält som WorkOrderService.setStatus() (ao.status, ao.updatedAt,
     ActivityService-logg), men EN persist() för hela batchen (SPRINT1 §18).
     Fail-closed på tre oberoende villkor, samtliga krävda (V29 §1/§3/§9):
     (1) Auth.can('ao_edit'), (2) status finns i _BULK_ALLOWED_STATUSES,
     (3) per post: _canAccessAo() (view-scope) OCH !_isAoLockedForBulk()
     (fakturerad/arkiverad/raderad). Räknar bara poster som FAKTISKT bytte
     status som "updated" — redan rätt status blir "unchanged", allt annat
     (låst ELLER utanför view-scope) blir "skipped". */
  _bulkSetStatus(ids, status) {
    if (!Auth.can('ao_edit')) return { ok: false, error: 'Du saknar behörighet för denna åtgärd.', updated: 0, skipped: 0, unchanged: 0 };
    if (WorkOrdersPage._BULK_ALLOWED_STATUSES.indexOf(status) === -1) return { ok: false, error: 'Den statusen kan inte sättas i bulk.', updated: 0, skipped: 0, unchanged: 0 };
    const now = new Date().toISOString();
    let updated = 0, skipped = 0, unchanged = 0;
    const _syncOps = [];
    (state.workOrders || []).forEach(ao => {
      if (ids.indexOf(ao.id) === -1) return;
      if (!WorkOrdersPage._canAccessAo(ao) || WorkOrdersPage._isAoLockedForBulk(ao)) { skipped++; return; }
      if (ao.status === status) { unchanged++; return; }
      const prev = ao.status;
      ao.status = status;
      ao.updatedAt = now;
      ActivityService.log('work_order_status',
        `Arbetsorder ${ao.id} ändrad: ${statusLabel(prev)} → ${statusLabel(status)}`,
        { customerId: ao.customerId, workOrderId: ao.id });
      updated++;
      _syncOps.push({ id: ao.id, patch: { status: ao.status, updatedAt: ao.updatedAt } });
    });
    if (updated > 0) {
      if (typeof AOTimeSyncService !== 'undefined' && _syncOps.length > 0) {
        AOTimeSyncService.bulkPatch('ao', _syncOps).then(res => this._reportBulkRejections(res)).catch(e => console.warn('[WorkOrdersPage] _bulkSetStatus sync-fel:', e));
      }
      persist(); Sidebar.updateBadges(); this.render();
    }
    return { ok: true, updated, skipped, unchanged };
  },

  /* ── Bulk: lägg till personal ─────────────────────────────────────────
     Uttryckligen ADDITIV, aldrig ersättande (SPRINT1 §13): befintlig
     tilldelning på varje markerad order rörs inte. Detta undviker den
     tvetydighet en "ersätt"-variant skulle innebära (olika ordrar kan ha
     helt olika befintlig personal) och matchar kravet att UI:t tydligt
     ska ange add-vs-replace INNAN bekräftelse. */
  _bulkAssignIds: [],

  /* V30 §4: dialogen visar nuläget PER person över hela den valda batchen
     (bara de AO som faktiskt är muterbara — samma _canAccessAo/
     _isAoLockedForBulk-regler som mutationen använder, så N alltid matchar
     vad som verkligen kommer hända). Additiv-principen är oförändrad:
     "Tilldelad på alla" är bara disabled eftersom det inte finns något
     kvar att lägga till för den personen, inte för att additiv-logiken
     ändrats. */
  _openBulkAssign(ids) {
    if (!Auth.can('ao_edit')) { showToast('Du saknar behörighet för denna åtgärd.'); return; }
    /* V3.2: bara markerade som matchar nuvarande filter och sök ingår. */
    const split = WorkOrdersPage._splitSelection(ids);
    if (!split.inView.length) { showToast('Ingen av de markerade arbetsordrarna syns med nuvarande filter — inget ändras. Rensa filtret eller markera på nytt.'); return; }
    ids = split.inView;
    const eligible = (state.workOrders || []).filter(ao =>
      ids.indexOf(ao.id) !== -1 && WorkOrdersPage._canAccessAo(ao) && !WorkOrdersPage._isAoLockedForBulk(ao));
    if (!eligible.length) { showToast('Ingen av de markerade arbetsordrarna kan tilldelas personal (låsta eller utanför din behörighet).'); return; }

    WorkOrdersPage._bulkAssignIds = ids;
    const activeStaff = (state.staff || []).filter(s => s.active);
    if (!activeStaff.length) { showToast('Ingen aktiv personal att tilldela.'); return; }

    const N = eligible.length;
    const coverage = activeStaff.map(s => ({
      staff: s,
      count: eligible.filter(ao => (ao.staff || []).includes(s.id)).length
    }));
    const anySelectable = coverage.some(c => c.count < N);

    const skippedN = WorkOrdersPage._aosById(ids).length - eligible.length;
    let body = WorkOrdersPage._bulkScopeHtml(eligible, split.hidden) +
      `<p style="font-size:12px;color:var(--mt);margin:10px 0;">Vald personal <strong>läggs till</strong> på de markerade arbetsordrarna. Befintlig tilldelning ersätts inte.${skippedN > 0 ? ' ' + skippedN + ' av de markerade hoppas över (låsta eller utanför din behörighet).' : ''}</p>`;

    if (!anySelectable) {
      body += `<div class="nbox" style="font-size:13px;">${ic('check-circle',14)} Alla aktiva medarbetare är redan tilldelade på de markerade arbetsordrarna.</div>`;
      Modal.open({
        title: `Lägg till personal på ${N} ${WorkOrdersPage._noun(N)}`,
        body,
        buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
      });
      return;
    }

    body += coverage.map(c => {
      const s = c.staff;
      const full = c.count === N;
      const partial = c.count > 0 && !full;
      const statusText = full ? 'Redan tilldelad på alla' : partial ? `Tilldelad på ${c.count} av ${N}` : '';
      return `
      <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:${full?'default':'pointer'};border-bottom:1px solid var(--br);${full?'opacity:.55;':''}">
        <input type="checkbox" id="bulkassign-${esc(s.id)}" ${full?'disabled':''}>
        <span style="flex:1;min-width:0;">
          <span style="font-size:13px;font-weight:600;">${esc(s.firstName)} ${esc(s.lastName)}</span>
          ${statusText ? `<span style="display:block;font-size:11px;color:var(--mt);">${statusText}</span>` : ''}
        </span>
      </label>`;
    }).join('');

    Modal.open({
      title: `Lägg till personal på ${N} ${WorkOrdersPage._noun(N)}`,
      body,
      buttons: [
        { label: `Lägg till på ${N} ${WorkOrdersPage._noun(N)}`, cls: 'btn bp', onClick: () => WorkOrdersPage._confirmBulkAssign() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _confirmBulkAssign() {
    if (WorkOrdersPage._bulkBusy) return;
    if (!Auth.can('ao_edit')) { showToast('Du saknar behörighet för denna åtgärd.'); Modal.close(); return; }
    const ids = WorkOrdersPage._bulkAssignIds || [];
    const activeStaff = (state.staff || []).filter(s => s.active);
    const chosen = activeStaff
      .filter(s => { const cb = document.getElementById('bulkassign-' + s.id); return cb && cb.checked; })
      .map(s => s.id);
    Modal.close();
    if (!chosen.length) { showToast('Ingen personal vald.'); return; }
    WorkOrdersPage._bulkBusy = true;
    const r = WorkOrdersPage._bulkAddStaff(ids, chosen);
    WorkOrdersPage._bulkBusy = false;
    if (!r.ok) { showToast(r.error); return; }
    SelectionModel.clearAll();
    showToast(WorkOrdersPage._bulkResultMessage(r, null, 'redan hade vald personal', 'inte kan hanteras (låsta eller utanför din behörighet)'));
  },

  /* Validerar den inkommande staffIdsToAdd-arrayen mot state.staff (V29 §2)
     — muterar aldrig baserat på ett obekräftat värde. Returnerar antingen
     en canonical, deduplicerad lista med bekräftat existerande OCH aktiva
     ID:n, eller null om NÅGOT ID var ogiltigt (hela anropet nekas, ingen
     partial mutation — samma "allt eller inget"-princip som statuslistan). */
  _validateStaffIds(staffIdsToAdd) {
    if (!Array.isArray(staffIdsToAdd) || staffIdsToAdd.length === 0) return null;
    const unique = Array.from(new Set(staffIdsToAdd));
    const activeStaffIds = new Set((state.staff || []).filter(s => s.active).map(s => s.id));
    const allValid = unique.every(id => activeStaffIds.has(id));
    return allValid ? unique : null;
  },

  /* Samma fält/loggtyp som WorkOrderService.updateStaff() (ao.staff,
     pool→planerad-övergång, ao.log staff_added-post), men additiv och
     med EN persist() för hela batchen istället för en per order.
     Fail-closed på flera oberoende villkor (V29 §2/§3/§9): (1) ao_edit,
     (2) staffIdsToAdd validerad mot state.staff (okänt/inaktivt ID nekar
     HELA anropet, ingen partial mutation), (3) per post: _canAccessAo()
     OCH !_isAoLockedForBulk(). "updated" räknas ENDAST när minst en
     person faktiskt lades till. */
  _bulkAddStaff(ids, staffIdsToAdd) {
    if (!Auth.can('ao_edit')) return { ok: false, error: 'Du saknar behörighet för denna åtgärd.', updated: 0, skipped: 0, unchanged: 0 };
    const validStaffIds = WorkOrdersPage._validateStaffIds(staffIdsToAdd);
    if (!validStaffIds) return { ok: false, error: 'Ogiltig eller inaktiv personal vald.', updated: 0, skipped: 0, unchanged: 0 };
    const now = new Date().toISOString();
    const user = state.currentUser;
    const by = user ? `${user.firstName} ${user.lastName}`.trim() : 'Okänd';
    let updated = 0, skipped = 0, unchanged = 0;
    /* V45: samlar {ao, added} bara för AO som FAKTISKT fick ny personal —
       aldrig skipped/unchanged — så notiser (in-app + Web Push) kan skickas
       EFTER den enda batch-persist() nedan, utan att skapa en mutation/
       persist per AO. */
    const assignments = [];
    const _syncOps = [];
    (state.workOrders || []).forEach(ao => {
      if (ids.indexOf(ao.id) === -1) return;
      if (!WorkOrdersPage._canAccessAo(ao) || WorkOrdersPage._isAoLockedForBulk(ao)) { skipped++; return; }
      const oldStaff = ao.staff || [];
      const added = validStaffIds.filter(id => !oldStaff.includes(id));
      if (added.length === 0) { unchanged++; return; }
      ao.staff = oldStaff.concat(added);
      if (ao.status === 'pool') ao.status = 'planerad';
      ao.log = ao.log || [];
      const names = added.map(id => { const s = getStaff(id); return s ? `${s.firstName} ${s.lastName}` : id; }).join(', ');
      ao.log.push({ id: 'L' + Date.now() + Math.random().toString(36).slice(2, 6), type: 'staff_added', text: `${by} lade till (bulk): ${names}`, userName: by, timestamp: now });
      ao.updatedAt = now;
      updated++;
      assignments.push({ ao, added });
      _syncOps.push({ id: ao.id, patch: { staff: ao.staff, status: ao.status, log: ao.log, updatedAt: ao.updatedAt } });
    });
    if (updated > 0) {
      if (typeof AOTimeSyncService !== 'undefined' && _syncOps.length > 0) {
        AOTimeSyncService.bulkPatch('ao', _syncOps).then(res => this._reportBulkRejections(res)).catch(e => console.warn('[WorkOrdersPage] _bulkAddStaff sync-fel:', e));
      }
      persist(); Sidebar.updateBadges(); this.render();
      /* V45: in-app-notis + riktig Web Push, bara för AO som faktiskt fick
         ny personal (assignments) — aldrig för skipped/unchanged eller
         personal som redan fanns. EN PushService-anrop per AO (inte per
         person). Fire-and-forget — push-fel får inte påverka bulkresultatet
         ovan (redan returnerat/beräknat). */
      assignments.forEach(({ ao, added }) => {
        if (typeof NotificationsService !== 'undefined') {
          added.forEach(id => {
            NotificationsService.push(id, 'ao_assigned', `Du har tilldelats ${ao.id}: ${ao.title || ao.id}`, { aoId: ao.id });
          });
        }
        if (typeof PushService !== 'undefined') {
          PushService.notifyStaffAssigned(ao, added).catch(e => console.warn('[WorkOrdersPage] notifyStaffAssigned fel:', e));
        }
      });
    }
    return { ok: true, updated, skipped, unchanged };
  },

  /* Bygger ett läsbart, korrekt toast-meddelande från { updated, skipped, unchanged }
     — ingen tyst partial mutation (SPRINT1 §4/§18). */
  _bulkResultMessage(r, updatedSuffix, unchangedReason, skippedReason) {
    if (r.updated === 0 && r.skipped === 0 && r.unchanged > 0) return 'Ingen ändring — alla markerade ' + unchangedReason + '.';
    let msg = r.updated + ' arbetsorder uppdaterade' + (updatedSuffix ? ' ' + updatedSuffix : '') + '.';
    const notes = [];
    if (r.skipped > 0)   notes.push(r.skipped + ' hoppades över eftersom de ' + skippedReason);
    if (r.unchanged > 0) notes.push(r.unchanged + ' ' + unchangedReason);
    if (notes.length) msg += ' ' + notes.join(', ') + '.';
    return msg;
  }
};
