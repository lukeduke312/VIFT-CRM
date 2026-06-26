/**
 * WorkOrdersPage — AO-lista + skapa-wizard
 */

/* Akut-badge: röd chip med emoji och fetstilstext */
function akutBadge() {
  return `<span class="bdg bdg-red ao-akut-badge">🚨 AKUT</span>`;
}

const WorkOrdersPage = {
  filter: 'alla',
  q: '',
  viewMode: localStorage.getItem('view-ao') || 'list',

  /* ── Wizard-state ──────────────────────── */
  _wiz: { step: 1, data: {}, modalId: null },

  /* ── Avancerade filter ─────────────────── */
  _f: {
    quick: null,       // 'akut' | 'readyForInvoice' | 'idag' | 'forsenad'
    mine: false,       // bara mina ärenden
    unassigned: false, // bara otilldelade
    staffIds: [],      // specifik personal
    customer: null,    // kund-ID
    category: null,    // kategori-slug
    sort: 'default'    // 'default' | 'updated' | 'scheduled' | 'priority'
  },

  render(params) {
    const el = document.getElementById('pg-ao-content');
    if (!el) return;

    // Handle filter params from dashboard navigation — reset filters
    if (params && params.filter) {
      this._f = { quick: null, mine: false, unassigned: false, staffIds: [], customer: null, category: null, sort: 'default' };
      const tabMap = { pool:'pool', planerad:'planerad', pågående:'pågående', klar:'klar', nytt:'nytt', active:'alla' };
      this.filter = tabMap[params.filter] || 'alla';
      if (params.filter === 'akut')            { this._f.quick = 'akut'; this.filter = 'alla'; }
      if (params.filter === 'readyForInvoice') { this._f.quick = 'readyForInvoice'; this.filter = 'klar'; }
      if (params.filter === 'idag')            { this._f.quick = 'idag'; }
      if (params.filter === 'forsenad')        { this._f.quick = 'forsenad'; }
      if (params.filter === 'mine')            { this._f.mine = true; }
    }

    const activeCount = this._activeFilterCount();

    const STATUS_TABS = [
      { key:'alla',        label:'Alla' },
      { key:'nytt',        label:'Nytt' },
      { key:'pool',        label:'Pool' },
      { key:'planerad',    label:'Planerad' },
      { key:'pågående',    label:'Pågående' },
      { key:'klar',        label:'Klar' },
      { key:'fakturerad',  label:'Fakturerad' },
      { key:'arkiverade',  label:'Arkiverade' },
      { key:'papperskorg', label:'Papperskorg' }
    ];

    el.innerHTML = `
      <div class="ao-toolbar">
        <div class="swrap">
          <span class="sico">${ic('search',16)}</span>
          <input type="search" id="ao-search" placeholder="Sök order, kund, adress…"
            value="${this.q}" oninput="WorkOrdersPage.q=this.value;WorkOrdersPage.renderList()">
        </div>
        <button class="btn bghost bsm ao-filter-btn${activeCount?' ao-filter-active':''}" onclick="WorkOrdersPage.openFilterPanel()">
          ${ic('sliders',13)}${activeCount ? ` (${activeCount})` : ' Filter'}
        </button>
        <div class="ao-toolbar-right">
          <div class="view-toggle">
            <button class="btn ${this.viewMode==='list'?'bp':'bghost'}" title="Listvy" onclick="WorkOrdersPage.setView('list')">${ic('list',14)}</button>
            <button class="btn ${this.viewMode==='grid'?'bp':'bghost'}" title="Kortvy" onclick="WorkOrdersPage.setView('grid')">${ic('grid',14)}</button>
          </div>
          ${Auth.can('ao_create') ? `<button class="btn bp bsm" onclick="WorkOrdersPage.openCreate()">${ic('plus',14)} Ny order</button>` : ''}
        </div>
      </div>
      <div class="ftabs ao-status-tabs" style="margin-bottom:8px;">
        ${STATUS_TABS.map(t =>
          `<button class="ft ${this.filter===t.key?'on':''}" onclick="WorkOrdersPage.setFilter('${t.key}')">${t.label}</button>`
        ).join('')}
      </div>
      <div id="ao-active-filters">${this._activeChipsHtml()}</div>
      <div id="ao-list"></div>`;
    this.renderList();
  },

  setView(mode) {
    this.viewMode = mode;
    localStorage.setItem('view-ao', this.viewMode);
    this.render();
  },

  toggleView() {
    this.setView(this.viewMode === 'list' ? 'grid' : 'list');
  },

  setFilter(f) {
    this.filter = f;
    this.render();
  },

  /* ── Filter helpers ────────────────────── */

  _activeFilterCount() {
    const f = this._f;
    return (f.quick?1:0) + (f.mine?1:0) + (f.unassigned?1:0) +
      f.staffIds.length + (f.customer?1:0) + (f.category?1:0);
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
    f.staffIds.forEach(id => {
      const s = getStaff(id);
      chips.push({ label: s ? `${s.firstName} ${s.lastName.charAt(0)}.` : id, icon: 'user',
        clear: `WorkOrdersPage._removeStaffFilter('${id}')` });
    });
    if (f.customer) {
      const cu = getCu(f.customer);
      chips.push({ label: cu ? CustomerService.displayName(cu) : f.customer, icon: 'building-2',
        clear: `WorkOrdersPage._f.customer=null;WorkOrdersPage._refreshFilters()` });
    }
    if (f.category) {
      const cat = (typeof AO_CATEGORIES!=='undefined'?AO_CATEGORIES:[]).find(c=>c.slug===f.category);
      chips.push({ label: cat ? cat.label : f.category, icon: 'tag',
        clear: `WorkOrdersPage._f.category=null;WorkOrdersPage._refreshFilters()` });
    }
    if (!chips.length) return '';
    const chipsHtml = chips.map(c =>
      `<span class="active-filter-chip">${ic(c.icon,10)} ${esc(c.label)}<button onclick="${c.clear}">${ic('x',9)}</button></span>`
    ).join('');
    return `<div class="active-filters-row">${chipsHtml}<button class="active-filter-clear" onclick="WorkOrdersPage.clearAllFilters()">${ic('x',10)} Rensa</button></div>`;
  },

  _refreshFilters() {
    const chipsEl = document.getElementById('ao-active-filters');
    if (chipsEl) chipsEl.innerHTML = this._activeChipsHtml();
    const btn = document.querySelector('.ao-filter-btn');
    if (btn) {
      const n = this._activeFilterCount();
      btn.className = `btn bghost bsm ao-filter-btn${n?' ao-filter-active':''}`;
      btn.innerHTML = `${ic('sliders',13)}${n ? ` (${n})` : ' Filter'}`;
    }
    this.renderList();
    // Uppdatera filterpanelen om den är öppen
    const panelEl = document.querySelector('.modal-body .filter-panel');
    if (panelEl) panelEl.innerHTML = this._filterPanelBody();
  },

  clearAllFilters() {
    const sort = this._f.sort;
    this._f = { quick:null, mine:false, unassigned:false, staffIds:[], customer:null, category:null, sort };
    this._refreshFilters();
  },

  _removeStaffFilter(id) {
    this._f.staffIds = this._f.staffIds.filter(s => s !== id);
    this._refreshFilters();
  },

  /* ── Filter panel ──────────────────────── */

  openFilterPanel() {
    Modal.open({
      title: `${ic('sliders',14)} Filter`,
      body: `<div class="filter-panel">${this._filterPanelBody()}</div>`,
      buttons: [{ label: 'Stäng', cls: 'btn bp', onClick: () => Modal.close() }]
    });
  },

  _filterPanelBody() {
    const f = this._f;
    const wos = (state.workOrders||[]).filter(a => !a.archived && !a.deleted);
    const today = tdy();
    const myId = state.currentUser ? state.currentUser.id : null;

    // Snabbfilter
    const quickOpts = [
      { key:'akut',            icon:'zap',      label:'Akuta',            cnt: wos.filter(a=>a.priority==='akut').length },
      { key:'readyForInvoice', icon:'receipt',  label:'Redo fakturering', cnt: wos.filter(a=>a.status==='klar'&&!a.invoiceId&&WorkOrderService._hasBillableContent(a)).length },
      { key:'idag',            icon:'calendar', label:'Idag',             cnt: wos.filter(a=>a.scheduledDate===today).length },
      { key:'forsenad',        icon:'clock',    label:'Försenade',        cnt: wos.filter(a=>a.scheduledDate&&a.scheduledDate<today).length }
    ];
    const quickHtml = quickOpts.map(o =>
      `<button class="filter-panel-chip ${f.quick===o.key?'on':''}" onclick="WorkOrdersPage._toggleQuick('${o.key}')">
        ${ic(o.icon,11)} ${o.label}${o.cnt ? `<span class="qf-cnt">${o.cnt}</span>` : ''}
      </button>`
    ).join('');

    // Personal
    const staffList = (state.staff||[]).filter(s => s.active);
    const mineCount = myId ? wos.filter(a=>(a.staff||[]).includes(myId)).length : 0;
    const unassCount = wos.filter(a=>!(a.staff||[]).length).length;
    const staffSpecial = `
      <button class="filter-panel-chip ${f.mine?'on':''}" onclick="WorkOrdersPage._toggleMine()">
        ${ic('user',11)} Mina ärenden${mineCount ? `<span class="qf-cnt">${mineCount}</span>` : ''}
      </button>
      <button class="filter-panel-chip ${f.unassigned?'on':''}" onclick="WorkOrdersPage._toggleUnassigned()">
        ${ic('user-x',11)} Otilldelade${unassCount ? `<span class="qf-cnt">${unassCount}</span>` : ''}
      </button>`;
    const staffItems = staffList.map(s => {
      const isOn = f.staffIds.includes(s.id);
      const cnt = wos.filter(a=>(a.staff||[]).includes(s.id)).length;
      return `<div class="filter-staff-item ${isOn?'on':''}" onclick="WorkOrdersPage._toggleStaff('${s.id}')">
        <div class="filter-staff-check">${isOn?ic('check',11):''}</div>
        <div style="flex:1;min-width:0;">
          <span style="font-size:13px;font-weight:600;">${esc(s.firstName)} ${esc(s.lastName)}</span>
          ${s.title?`<span style="font-size:11px;color:var(--mt);margin-left:6px;">${esc(s.title)}</span>`:''}
        </div>
        ${cnt ? `<span class="qf-cnt" style="background:var(--bg);color:var(--mt);">${cnt}</span>` : ''}
      </div>`;
    }).join('');

    // Kategori
    const cats = typeof AO_CATEGORIES!=='undefined' ? AO_CATEGORIES : [];
    const catHtml = cats.map(c => {
      const cnt = wos.filter(a=>a.category===c.slug).length;
      return `<button class="filter-panel-chip ${f.category===c.slug?'on':''}" onclick="WorkOrdersPage._toggleCat('${c.slug}')">
        ${c.label}${cnt ? `<span class="qf-cnt">${cnt}</span>` : ''}
      </button>`;
    }).join('');

    // Kund
    const cuIds = [...new Set(wos.filter(a=>a.customerId).map(a=>a.customerId))];
    const cuOpts = cuIds.map(id => {
      const cu = getCu(id);
      if (!cu) return null;
      return { id, name: CustomerService.displayName(cu), cnt: wos.filter(a=>a.customerId===id).length };
    }).filter(Boolean).sort((a,b) => a.name.localeCompare(b.name,'sv'));
    const cuHtml = cuOpts.length ? `<select onchange="WorkOrdersPage._setCustFilter(this.value)" style="width:100%;padding:9px 10px;border:1.5px solid var(--br);border-radius:8px;font-size:13px;background:var(--bg);font-family:inherit;">
      <option value="">— Alla kunder —</option>
      ${cuOpts.map(c=>`<option value="${c.id}" ${f.customer===c.id?'selected':''}>${esc(c.name)} (${c.cnt})</option>`).join('')}
    </select>` : '';

    // Sortering
    const SORT_OPTS = [
      { key:'default',   label:'Prioritet & datum' },
      { key:'updated',   label:'Senast uppdaterad' },
      { key:'scheduled', label:'Planerat datum' },
      { key:'priority',  label:'Enbart prioritet' }
    ];
    const sortHtml = SORT_OPTS.map(o =>
      `<button class="filter-panel-chip ${f.sort===o.key?'on':''}" onclick="WorkOrdersPage._setSort('${o.key}')">${o.label}</button>`
    ).join('');

    const hasAny = this._activeFilterCount() > 0;
    const clearBtn = hasAny ? `<div style="padding-top:4px;"><button class="btn bd bsm" style="width:100%;" onclick="WorkOrdersPage.clearAllFilters()">${ic('x',12)} Rensa alla filter</button></div>` : '';

    return `
      <div class="filter-section">
        <div class="filter-section-title">Snabbfilter</div>
        <div class="filter-chips-row">${quickHtml}</div>
      </div>
      <div class="filter-section">
        <div class="filter-section-title">Personal</div>
        <div class="filter-chips-row" style="margin-bottom:8px;">${staffSpecial}</div>
        ${staffItems ? `<div class="filter-staff-list">${staffItems}</div>` : ''}
      </div>
      ${catHtml ? `<div class="filter-section">
        <div class="filter-section-title">Kategori</div>
        <div class="filter-chips-row">${catHtml}</div>
      </div>` : ''}
      ${cuHtml ? `<div class="filter-section">
        <div class="filter-section-title">Kund</div>
        ${cuHtml}
      </div>` : ''}
      <div class="filter-section">
        <div class="filter-section-title">Sortering</div>
        <div class="filter-chips-row">${sortHtml}</div>
      </div>
      ${clearBtn}`;
  },

  _toggleQuick(key)    { this._f.quick = this._f.quick===key ? null : key; this._refreshFilters(); },
  _toggleMine()        { this._f.mine = !this._f.mine; if(this._f.mine){ this._f.unassigned=false; this._f.staffIds=[]; } this._refreshFilters(); },
  _toggleUnassigned()  { this._f.unassigned = !this._f.unassigned; if(this._f.unassigned){ this._f.mine=false; this._f.staffIds=[]; } this._refreshFilters(); },
  _toggleStaff(id)     { const i=this._f.staffIds.indexOf(id); if(i>-1) this._f.staffIds.splice(i,1); else { this._f.staffIds.push(id); this._f.mine=false; this._f.unassigned=false; } this._refreshFilters(); },
  _toggleCat(slug)     { this._f.category = this._f.category===slug ? null : slug; this._refreshFilters(); },
  _setCustFilter(id)   { this._f.customer = id||null; this._refreshFilters(); },
  _setSort(key)        { this._f.sort = key; this._refreshFilters(); },

  renderList() {
    const el = document.getElementById('ao-list');
    if (!el) return;
    let list = state.workOrders || [];

    // ao_view_own: begränsa till egna AO och pool
    const canViewAll = Auth.can('ao_view_all') || Auth.can('all');
    if (!canViewAll && Auth.can('ao_view_own') && state.currentUser) {
      const myId = state.currentUser.id;
      list = list.filter(a => (a.staff||[]).includes(myId) || a.status === 'pool');
    }

    const today = tdy();

    if (this.filter === 'arkiverade') {
      list = list.filter(a => a.archived && !a.deleted);
    } else if (this.filter === 'papperskorg') {
      list = list.filter(a => a.deleted);
    } else {
      list = list.filter(a => !a.archived && !a.deleted);
      if (this.filter === 'alla') {
        // "Alla" visar bara aktiva AO — exkluderar fakturerade
        list = list.filter(a => a.status !== 'fakturerad');
      } else {
        list = list.filter(a => a.status === this.filter);
      }
      // Snabbfilter
      if (this._f.quick === 'akut')            list = list.filter(a => a.priority==='akut');
      if (this._f.quick === 'readyForInvoice') list = list.filter(a => a.status==='klar' && !a.invoiceId && WorkOrderService._hasBillableContent(a));
      if (this._f.quick === 'idag')            list = list.filter(a => a.scheduledDate===today);
      if (this._f.quick === 'forsenad')        list = list.filter(a => a.scheduledDate && a.scheduledDate<today);
      // Personal
      if (this._f.mine) {
        const myId = state.currentUser ? state.currentUser.id : null;
        if (myId) list = list.filter(a => (a.staff||[]).includes(myId));
      } else if (this._f.unassigned) {
        list = list.filter(a => !(a.staff||[]).length);
      } else if (this._f.staffIds.length) {
        list = list.filter(a => this._f.staffIds.some(id => (a.staff||[]).includes(id)));
      }
      // Kund / Kategori
      if (this._f.customer) list = list.filter(a => a.customerId===this._f.customer);
      if (this._f.category) list = list.filter(a => a.category===this._f.category);
    }

    if (this.q) {
      const ql = this.q.toLowerCase();
      list = list.filter(a => {
        const cu = getCu(a.customerId);
        return a.title.toLowerCase().includes(ql)
          || a.id.toLowerCase().includes(ql)
          || (a.address||'').toLowerCase().includes(ql)
          || (cu && CustomerService.displayName(cu).toLowerCase().includes(ql));
      });
    }

    // Sortering
    list = list.slice().sort((a,b) => {
      if (this._f.sort === 'updated')   return new Date(b.updatedAt||b.createdAt) - new Date(a.updatedAt||a.createdAt);
      if (this._f.sort === 'scheduled') {
        if (!a.scheduledDate && !b.scheduledDate) return 0;
        if (!a.scheduledDate) return 1;
        if (!b.scheduledDate) return -1;
        return a.scheduledDate < b.scheduledDate ? -1 : 1;
      }
      if (this._f.sort === 'priority') {
        const p = {akut:0,hög:1,normal:2,låg:3};
        return (p[a.priority]||2) - (p[b.priority]||2);
      }
      // default: prioritet + skapad
      const pOrd = {akut:0,hög:1,normal:2,låg:3};
      const d = (pOrd[a.priority]||2) - (pOrd[b.priority]||2);
      return d !== 0 ? d : new Date(b.createdAt) - new Date(a.createdAt);
    });
    if (!list.length) {
      const isSearch = !!this.q;
      const isFilter = this.filter !== 'alla' || this._activeFilterCount() > 0;
      const hasAnyFilter = isSearch || isFilter;
      el.innerHTML = `<div class="empty">${ic('clipboard-list',36)}
        <h3>${isSearch ? 'Inga träffar' : isFilter ? 'Inga ordrar' : 'Inga arbetsorder'}</h3>
        <p>${isSearch ? 'Inga ordrar matchar sökningen.' : isFilter ? 'Inga ordrar matchar valt filter.' : 'Skapa din första arbetsorder med knappen ovan.'}</p>
        ${hasAnyFilter ? `<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;justify-content:center;">
          ${isSearch ? `<button class="btn bs bsm" onclick="WorkOrdersPage.q='';document.getElementById('ao-search').value='';WorkOrdersPage.renderList()">Rensa sökning</button>` : ''}
          ${isFilter ? `<button class="btn bs bsm" onclick="WorkOrdersPage.clearAllFilters()">Rensa filter</button>` : ''}
        </div>` : ''}
      </div>`;
      return;
    }
    if (this.viewMode === 'grid') {
      el.innerHTML = `<div class="ao-grid">${list.map(ao => {
        const cu     = getCu(ao.customerId);
        const cuName = cu ? CustomerService.displayName(cu) : '—';
        const chkOk  = (ao.checklist||[]).filter(c=>c.done||c.avvikelse==='ok').length;
        const chkAvv = (ao.checklist||[]).filter(c=>c.avvikelse==='avvikelse').length;
        const total  = (ao.checklist||[]).length;
        const chkText = total > 0
          ? `<span class="ao-item-progress ${chkOk===total&&!chkAvv?'done':chkAvv>0?'has-dev':''}">${chkOk}/${total} ✓${chkAvv>0?' · '+chkAvv+' avv.':''}</span>`
          : '';
        const needsInvoice = ao.status==='klar' && !ao.invoiceId;
        const isBillable   = needsInvoice && WorkOrderService._hasBillableContent(ao);
        const noPricing    = needsInvoice && !isBillable;
        return `
          <div class="ao-card ${priorityClass(ao.priority)}" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:5px;">
              <div style="font-size:10px;font-weight:800;color:var(--mt);">${ao.id}</div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">${sbdg(ao.status)}${ao.priority==='akut'?akutBadge():pbdg(ao.priority)}</div>
            </div>
            <div style="font-size:13px;font-weight:700;margin-bottom:3px;line-height:1.3;">${ao.title}</div>
            <div style="font-size:11px;color:var(--mt);margin-bottom:2px;">${cuName}</div>
            ${ao.scheduledDate?`<div style="font-size:11px;color:var(--mt);">${ao.scheduledDate}${ao.scheduledStart?' · '+ao.scheduledStart:''}</div>`:''}
            ${ao.category?`<div style="margin-top:5px;">${catBadge(ao.category)}</div>`:''}
            ${ao.substatus?`<div style="margin-top:4px;"><span style="font-size:10px;padding:2px 7px;background:rgba(251,191,36,.12);color:var(--or);border-radius:8px;border:1px solid rgba(251,191,36,.3);">${({inväntar_material:'⏳ Inväntar material',inväntar_kund:'🔔 Inväntar kund',pausad:'⏸ Pausad',behöver_återbesök:'🔄 Återbesök',blockerad:'🚫 Blockerad'}[ao.substatus]||ao.substatus)}</span></div>`:''}
            ${isBillable?`<div style="margin-top:5px;"><span class="qf-chip on" style="font-size:10px;padding:2px 7px;">${ic('receipt',10)} Redo fakturering</span></div>`:''}
            ${noPricing?`<div style="margin-top:5px;"><span class="qf-chip" style="font-size:10px;padding:2px 7px;border-color:var(--or);color:var(--or);">${ic('alert-circle',10)} Saknar prissättning</span></div>`:''}
            ${chkText?`<div style="margin-top:5px;">${chkText}</div>`:''}
          </div>`;
      }).join('')}</div>`;
    } else {
      el.innerHTML = list.map(ao => {
        const cu     = getCu(ao.customerId);
        const cuName = cu ? CustomerService.displayName(cu) : '—';
        const chkOk  = (ao.checklist||[]).filter(c=>c.done||c.avvikelse==='ok').length;
        const chkAvv = (ao.checklist||[]).filter(c=>c.avvikelse==='avvikelse').length;
        const total  = (ao.checklist||[]).length;
        const needsInvoice = ao.status==='klar' && !ao.invoiceId;
        const isBillable   = needsInvoice && WorkOrderService._hasBillableContent(ao);
        const noPricing    = needsInvoice && !isBillable;
        const metaParts = [];
        if (cuName !== '—') metaParts.push(cuName);
        if (ao.scheduledDate) metaParts.push(ao.scheduledDate+(ao.scheduledStart?' '+ao.scheduledStart:''));
        const metaHtml = metaParts.join(' · ');
        const chkHtml = total > 0
          ? `<span class="ao-item-progress ${chkOk===total&&!chkAvv?'done':chkAvv>0?'has-dev':''}">${chkOk}/${total} ✓${chkAvv>0?' · '+chkAvv+' avv.':''}</span>`
          : '';
        const archiveActions = ao.archived ? `
          <div style="display:flex;gap:6px;align-items:center;margin-top:6px;" onclick="event.stopPropagation()">
            <span class="bdg bdg-grey">${ic('archive',9)} Arkiverad${ao.archivedAt?' · '+fmtDate(ao.archivedAt):''}</span>
            <button class="btn bxs bghost" onclick="WorkOrderDetailPage._restoreFromArchive('${ao.id}');WorkOrdersPage.render();">${ic('rotate-ccw',10)} Återställ</button>
          </div>` : '';
        const trashActions = ao.deleted ? `
          <div style="display:flex;gap:6px;align-items:center;margin-top:6px;" onclick="event.stopPropagation()">
            <span class="bdg bdg-red">${ic('trash',9)} Papperskorg${ao.deletedAt?' · '+fmtDate(ao.deletedAt):''}</span>
            <button class="btn bxs bghost" onclick="WorkOrderDetailPage._restoreFromTrash('${ao.id}');WorkOrdersPage.render();">${ic('rotate-ccw',10)} Återställ</button>
            <button class="btn bxs bd" onclick="WorkOrderDetailPage._confirmPermanentDelete('${ao.id}');">${ic('trash-2',10)} Radera</button>
          </div>` : '';
        return `
          <button class="ao-list-item ${priorityClass(ao.priority)}" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
            <div class="ao-item-top">
              <div style="flex:1;min-width:0;">
                <div class="ao-item-id">${ao.id}</div>
                <div class="ao-item-title">${ao.title}</div>
                ${metaHtml ? `<div class="ao-item-sub">${metaHtml}</div>` : ''}
              </div>
              <div class="ao-item-badges">
                ${sbdg(ao.status)}${ao.priority==='akut'?akutBadge():ao.priority!=='normal'?pbdg(ao.priority):''}
              </div>
            </div>
            ${ao.substatus?`<div style="margin-top:3px;"><span style="font-size:10px;padding:2px 7px;background:rgba(251,191,36,.1);color:var(--or);border-radius:8px;border:1px solid rgba(251,191,36,.25);">${({inväntar_material:'⏳ Inväntar material',inväntar_kund:'🔔 Inväntar kund',pausad:'⏸ Pausad',behöver_återbesök:'🔄 Återbesök',blockerad:'🚫 Blockerad'}[ao.substatus]||ao.substatus)}</span></div>`:''}
            ${ao.category || isBillable || noPricing || chkHtml ? `<div style="display:flex;gap:5px;align-items:center;margin-top:4px;flex-wrap:wrap;">
              ${ao.category ? catBadge(ao.category) : ''}
              ${isBillable?`<span class="qf-chip on" style="font-size:10px;padding:2px 7px;">${ic('receipt',10)} Redo fakturering</span>`:''}
              ${noPricing?`<span class="qf-chip" style="font-size:10px;padding:2px 7px;border-color:var(--or);color:var(--or);">${ic('alert-circle',10)} Saknar prissättning</span>`:''}
              ${chkHtml}
            </div>` : ''}
            ${archiveActions}${trashActions}
          </button>`;
      }).join('');
    }
  },

  /* ── Skapa AO – wizard ─────────────────── */
  openCreate(prefillCustomerId = null, prefillPropertyId = null) {
    if (!Auth.require('ao_create')) return;
    this._wiz = { step: 1, data: { customerId: prefillCustomerId || '', propertyId: prefillPropertyId || '' }, modalId: null };
    this._showWizard();
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
    const cuOptions = (state.customers||[]).map(c =>
      `<option value="${c.id}" ${d.customerId===c.id?'selected':''}>${CustomerService.displayName(c)}</option>`
    ).join('');
    const cu = d.customerId ? getCu(d.customerId) : null;
    return `
      <div class="fg"><label>Rubrik / Vad ska göras <span style="color:var(--rd)">*</span></label>
        <input id="wiz-title" value="${d.title||''}" placeholder="T.ex. Läckage badrum, Fasadtvätt…"></div>
      <div class="g2">
        <div class="fg"><label>Kategori</label>
          <select id="wiz-category">
            <option value="">— Välj kategori —</option>
            ${AO_CATEGORIES.map(c=>`<option value="${c.slug}" ${d.category===c.slug?'selected':''}>${c.label}</option>`).join('')}
          </select>
        </div>
        <div class="fg" style="align-self:flex-end;"><label>&nbsp;</label>
          ${d.category ? `<div style="margin-top:6px;">${catBadge(d.category)}</div>` : '<div></div>'}
        </div>
      </div>
      <div class="fg"><label>Beskrivning</label>
        <textarea id="wiz-desc" rows="2" placeholder="Mer detaljer om jobbet…">${d.description||''}</textarea></div>
      <div class="fg"><label>Kund <span style="color:var(--rd)">*</span></label>
        <select id="wiz-customer" onchange="WorkOrdersPage._wizCustomerChanged()">
          <option value="">— Välj kund —</option>${cuOptions}
        </select>
        <button class="btn bs bxs" style="margin-top:4px;" onclick="WorkOrdersPage.openNewCustomerFromWizard()">
          + Ny kund
        </button></div>
      <div id="wiz-autofill"></div>
      <div class="fg"><label>Arbetsadress</label>
        <input id="wiz-address" value="${d.address||cu&&cu.address||''}" placeholder="Gatuadress"
          autocomplete="off"
          oninput="AddressService.handleInput(this)"
          onblur="setTimeout(()=>AddressService.hideSuggestions(),150)"></div>
      <div class="g2">
        <div class="fg"><label>Kontaktperson</label>
          <input id="wiz-contact" value="${d.contactPerson||cu&&cu.contactPerson||''}" placeholder="Namn"></div>
        <div class="fg"><label>Telefon</label>
          <input id="wiz-phone" type="tel" value="${d.phone||cu&&cu.phone||''}" placeholder="070-xxx xx xx"></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Åtkomst / portkod</label>
          <input id="wiz-access" value="${d.accessCode||''}" placeholder="T.ex. 1234#"></div>
        <div class="fg"><label>Intern notering</label>
          <input id="wiz-intnote" value="${d.internalNote||''}" placeholder="Visas ej för kund"></div>
      </div>`;
  },

  _wizStep2Html(d) {
    const isPlan = d.status === 'planerad' || !!d.scheduledDate;
    const priorities = [{v:'akut',l:'Akut'},{v:'hög',l:'Hög'},{v:'normal',l:'Normal'},{v:'låg',l:'Låg'}];
    const prio = d.priority || 'normal';

    // Staff modal picker
    const sel = d.staff || [];
    const staffChips = sel.map(id => {
      const s = getStaff(id);
      return s ? `<span class="mpicker-tag">${s.firstName} ${s.lastName.charAt(0)}.<button onclick="WorkOrdersPage._spmRemove('${id}');event.stopPropagation();">${ic('x',9)}</button></span>` : '';
    }).join('');

    return `
      <div class="fg">
        <label style="font-size:12px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Planering</label>
        <div class="g2" style="margin-top:6px;">
          <button type="button" class="btn ${!isPlan?'bp':'bs'} bfull" id="btn-pool"
            onclick="WorkOrdersPage._wizSetPlan('pool')" style="padding:12px;font-size:13px;">
            ${ic('clipboard-list',15)} Arbetspool
          </button>
          <button type="button" class="btn ${isPlan?'bp':'bs'} bfull" id="btn-direct"
            onclick="WorkOrdersPage._wizSetPlan('direct')" style="padding:12px;font-size:13px;">
            ${ic('calendar',15)} Planera direkt
          </button>
        </div>
      </div>

      <div id="wiz-schedule" style="${isPlan?'':'display:none;'}">
        <div class="g2">
          <div class="fg"><label>Datum</label><input type="date" id="wiz-date" value="${d.scheduledDate||tdy()}"></div>
          <div class="g2">
            <div class="fg"><label>Starttid</label><input type="time" id="wiz-start" value="${d.scheduledStart||'08:00'}"></div>
            <div class="fg"><label>Sluttid</label><input type="time" id="wiz-end" value="${d.scheduledEnd||'16:00'}"></div>
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
      `<option value="${p.id}" ${d.priceGroupId===p.id?'selected':''}>${p.name} – ${fmt(p.hourRate)} kr/tim</option>`
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

    /* Återställ addrSource på DOM-elementet (förloras vid omrendering av steg) */
    const addrEl = document.getElementById('wiz-address');
    if (addrEl && d._sources.address) {
      addrEl.dataset.addrSource = d._sources.address;
    }

    /* Fyll kunduppgifter om kund redan vald */
    if (document.getElementById('wiz-customer') && d.customerId) {
      this._wizCustomerChanged();
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
            <div style="font-size:14px;font-weight:700;color:var(--tx);">${s.firstName} ${s.lastName}</div>
            ${s.title?`<div style="font-size:12px;color:var(--mt);">${s.title}</div>`:''}
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
      return s ? `<span class="mpicker-tag">${s.firstName} ${s.lastName.charAt(0)}.<button onclick="WorkOrdersPage._spmRemove('${id}');event.stopPropagation();">${ic('x',9)}</button></span>` : '';
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

    const addr = document.getElementById('wiz-address');
    const cont = document.getElementById('wiz-contact');
    const ph   = document.getElementById('wiz-phone');

    /* Adress: använd dataset.addrSource (hanteras av AddressService + oss) */
    if (addr) {
      const src = addr.dataset.addrSource || d._sources.address || '';
      if (!addr.value || src === 'customer') {
        addr.value = cu.address || '';
        const newSrc = cu.address ? 'customer' : '';
        addr.dataset.addrSource = newSrc;
        d._sources.address = newSrc;
      }
    }

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

    const addr = document.getElementById('wiz-address');
    const cont = document.getElementById('wiz-contact');
    const ph   = document.getElementById('wiz-phone');

    if (addr) {
      const src = addr.dataset.addrSource || d._sources.address || '';
      if (src === 'customer') {
        addr.value = '';
        addr.dataset.addrSource = '';
        d._sources.address = '';
      }
    }
    if (cont && d._sources.contact === 'customer') {
      cont.value = '';
      d._sources.contact = '';
    }
    if (ph && d._sources.phone === 'customer') {
      ph.value = '';
      d._sources.phone = '';
    }
  },

  _wizCustomerChanged() {
    const sel = document.getElementById('wiz-customer');
    if (!sel) return;
    const id = sel.value;
    this._wiz.data.customerId = id;
    const cu = id ? getCu(id) : null;

    if (cu) {
      this._applyCustomerToWizard(cu);
    } else {
      this._clearCustomerDependentWizardFields();
    }

    document.getElementById('wiz-autofill').innerHTML = cu
      ? `<div class="ibox" style="margin-bottom:8px;">${ic('check',14)} ${CustomerService.displayName(cu)}</div>`
      : '';
  },

  _wizSetPlan(mode) {
    const isPlan = mode === 'direct';
    const sched = document.getElementById('wiz-schedule');
    if (sched) sched.style.display = isPlan ? '' : 'none';
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
        <span style="flex:1;font-size:13px;">${c.text}</span>
        <button class="btn bxs bd" onclick="WorkOrdersPage._wizRemoveCL(${i})">${ic('x',12)}</button>
      </div>`).join('');
  },

  _wizRemoveCL(idx) {
    (this._wiz.data.checklist || []).splice(idx, 1);
    this._renderWizChecklist();
  },

  /* ── Wizard collect ────────────────────── */
  _wizCollectStep1() {
    const d = this._wiz.data;
    d.title         = (document.getElementById('wiz-title')?.value || '').trim();
    d.category      = document.getElementById('wiz-category')?.value || '';
    d.description   = (document.getElementById('wiz-desc')?.value || '').trim();
    d.customerId    = document.getElementById('wiz-customer')?.value || '';
    d.address       = document.getElementById('wiz-address')?.value.trim() || '';
    d.contactPerson = document.getElementById('wiz-contact')?.value.trim() || '';
    d.phone         = document.getElementById('wiz-phone')?.value.trim() || '';
    d.accessCode    = document.getElementById('wiz-access')?.value.trim() || '';
    d.internalNote  = document.getElementById('wiz-intnote')?.value.trim() || '';
    if (!d.title)      { showToast('Rubrik krävs'); return false; }
    if (!d.customerId) { showToast('Välj en kund'); return false; }
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
    const ao = WorkOrderService.create({
      title:         d.title,
      description:   d.description,
      customerId:    d.customerId,
      propertyId:    d.propertyId || '',
      address:       d.address,
      contactPerson: d.contactPerson,
      phone:         d.phone,
      accessCode:    d.accessCode,
      internalNote:  d.internalNote,
      status:        d.status || 'pool',
      priority:      d.priority || 'normal',
      category:      d.category || '',
      priceType:     d.priceType,
      fixedPrice:    d.fixedPrice,
      priceGroupId:  d.priceGroupId,
      staff:         d.staff || [],
      scheduledDate: d.scheduledDate || '',
      scheduledStart:d.scheduledStart || '',
      scheduledEnd:  d.scheduledEnd || '',
      checklist:     (d.checklist || []).map(c => ({ ...c })),
      materials:     [],
      notes:         [],
      log:           [],
      timeEntries:   []
    });
    this._wiz.modalId = null;
    Modal.close();
    Sidebar.updateBadges();
    showToast(`${ao.id} skapad`);
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

          // Add new customer to wizard dropdown and select it
          const wiz = document.getElementById(this._wiz.modalId);
          const sel = wiz?.querySelector('#wiz-customer');
          if (sel) {
            const opt = document.createElement('option');
            opt.value = cu.id;
            opt.textContent = CustomerService.displayName(cu);
            opt.selected = true;
            sel.appendChild(opt);
            this._wiz.data.customerId = cu.id;
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
  }
};
