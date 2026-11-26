/**
 * InvoicesPage — Fakturering: "Att fakturera" (SPRINT2/V32 faktureringskö)
 * + "Fakturaunderlag" (den befintliga listan från SPRINT1).
 * InvoiceDetailPage (fakturadetalj) ligger kvar längre ner i samma fil.
 *
 * V3 2026-11-26 (6A): kön är omgjord till en kompakt, grupperad vy —
 * en rad per kund (antal AO/underlag, belopp exkl. moms, åtgärdsräkning,
 * kryssruta med tre lägen) som fälls ut till arbetsordrar och sedan till
 * enskilda underlag. Endast presentation: kandidaterna, beloppen, momsen,
 * anspråken (sourceKey) och skapandet kommer oförändrat från
 * BillingQueueService/InvoiceService.
 */
const InvoicesPage = {
  _view: 'queue',     /* 'queue' = Att fakturera, 'list' = Fakturaunderlag */
  _tab: 'alla',        /* status-flik i Fakturaunderlag-vyn */

  /* Att fakturera — filter-state */
  _qQuery: '', _qCustomerId: '', _qPropertyId: '', _qType: 'alla', _qPeriod: 'alla', _qOnlyIssues: false,
  _qShow: 'alla',      /* 'alla' | 'redo' (kan faktureras) | 'atgard' (Kräver åtgärd) */
  _qSort: 'amount',    /* 'amount' | 'customer' | 'date' | 'issues' */
  _QSTEP: 30,          /* progressiv rendering: antal kundgrupper/åtgärdskort per steg */
  _qLimit: 30,
  _qFiltersOpen: false, /* mobil: filterpanelen utfälld */
  _exp: null,          /* Set med utfällda grupper ('c:<kund>' / 'a:<kund>|<AO>') */
  _model: null,        /* senaste vymodell (grupper → id-listor), endast presentation */
  _byKey: null,        /* sourceKey → kandidat från senaste getCandidates() */
  _shownSelIds: null,  /* valbara id:n som matchar aktuellt filter */
  _lastRenderMs: 0,
  _createBusy: false,
  _pendingIds: null,   /* exakt de id:n som förhandsgranskades i bekräftelsedialogen */

  /* Belopp med öre — fakturering visar alltid två decimaler så att delsummor
     och totaler går att stämma av (fkr() avrundar till hela kronor). */
  _kr(n) {
    /* T4-B (D-10, F13): ett okänt pris (null) visas som saknat, aldrig som 0 kr. */
    if (n === null) return 'Pris saknas';
    const v = Number(n);
    return (Number.isFinite(v) ? v : 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr';
  },

  /* Förklaringar till de åtgärdsorsaker BillingQueueService.getCandidates()
     faktiskt räknar fram. Inga egna spärregler — okända strängar visas som
     de är. */
  _ISSUE_HELP: {
    'Väntar på serverbekräftelse': 'Posten är ännu inte bekräftad av servern och kan inte faktureras förrän den sparats. Kön uppdateras automatiskt.',
    'Saknar arbetsorder': 'Tidposten är inte kopplad till någon arbetsorder.',
    'Arbetsorder hittades inte': 'Arbetsordern som tidposten pekar på finns inte längre.',
    'AO saknar prismodell': 'Arbetsordern saknar prismodell (löpande timpris eller fast pris), så tiden kan inte prissättas.',
    'AO saknar kund': 'Arbetsordern saknar kund — fakturaunderlag skapas per kund.',
    'Saknar timpris': 'Tidposten saknar timpris (0 kr/tim).',
    'Ogiltigt belopp': 'Beloppet blir 0 kr eller ogiltigt — kontrollera antal och pris.',
    'Saknar försäljningspris': 'Materialraden saknar försäljningspris (0 kr).',
    'Ogiltig momssats': 'Materialradens momssats är ogiltig (måste vara 0–100 %).',
    'Saknar fastpris': 'Arbetsordern har fast pris men inget belopp.'
  },
  _PRICING_ISSUES: ['AO saknar prismodell', 'Saknar timpris', 'Saknar fastpris'],
  _TYPE_LABEL: { time: 'Tid', material: 'Material', fixed: 'Fastpris' },
  _TYPE_ICON: { time: 'clock', material: 'package', fixed: 'file-check' },

  render() {
    const el = document.getElementById('pg-invoices-content');
    if (!el) return;
    el.innerHTML = `
      <div class="inv-page">
      <div class="ftabs" style="margin-bottom:8px;">
        <button class="ft ${this._view==='queue'?'on':''}" onclick="InvoicesPage._setView('queue')">Att fakturera</button>
        <button class="ft ${this._view==='list'?'on':''}" onclick="InvoicesPage._setView('list')">Fakturaunderlag</button>
      </div>
      <div id="inv-view-body"></div>
      </div>`;
    this._renderViewBody();
  },

  _setView(v) {
    this._view = v;
    this.render();
  },

  _renderViewBody() {
    const body = document.getElementById('inv-view-body');
    if (!body) return;
    if (this._view === 'queue') this._renderQueueView(body);
    else this._renderListView(body);
  },

  /* ══════════════════════════════════════════════════════════════════
     ATT FAKTURERA — faktureringskön (V32, kompakt vy V3 2026-11-26)
     ══════════════════════════════════════════════════════════════════ */

  /* Tvåfas-render (SPRINT1 §1-fixen): skelettet med sökfältet byggs EN
     gång här; _renderQueueList() fyller bara header/flikar/lista/summering
     på varje sök-/filterändring. Sökfältets DOM-nod byts aldrig ut. */
  _renderQueueView(body) {
    if (!this._exp) this._exp = new Set();
    const customers = (state.customers || []).slice().sort((a,b) => CustomerService.displayName(a).localeCompare(CustomerService.displayName(b), 'sv'));
    /* V33 §13: fastighetsfiltret begränsas till den valda kundens
       fastigheter (om någon kund är vald) — annars alla. */
    const properties = (state.properties || [])
      .filter(p => !this._qCustomerId || p.customerId === this._qCustomerId)
      .slice().sort((a,b) => (a.name||'').localeCompare(b.name||'', 'sv'));
    const opt = (v, cur, label) => `<option value="${esc(v)}" ${cur===v?'selected':''}>${esc(label)}</option>`;
    body.innerHTML = `
      <div class="bqv" id="bq-wrap">
        <div id="bq-header"></div>
        <div class="card bqv-tools${this._qFiltersOpen ? ' is-fopen' : ''}" id="bq-tools">
          <div class="bqv-tools-top">
            <div class="swrap bqv-search">
              <span class="sico">${ic('search',16)}</span>
              <input type="search" id="bq-search" placeholder="Sök kund, fastighet, AO, personal…" value="${esc(this._qQuery)}"
                aria-label="Sök i faktureringskön" oninput="InvoicesPage._onSearch(this.value)">
            </div>
            <div id="bq-chips" class="bqv-chips" role="group" aria-label="Visa underlag"></div>
            <button type="button" class="btn bs bsm bqv-ftoggle" data-act="toggle-filters" aria-controls="bq-filters" aria-expanded="${this._qFiltersOpen ? 'true' : 'false'}">${ic('sliders',14)} Filter och sortering<span class="bqv-fcount" id="bq-fcount"></span></button>
          </div>
          <div class="bqv-filters" id="bq-filters">
            <label class="bqv-f"><span>Kund</span>
              <select id="bq-f-customer" onchange="InvoicesPage._onCustomerFilterChange(this.value)">
                <option value="">Alla kunder</option>
                ${customers.map(c => opt(c.id, this._qCustomerId, CustomerService.displayName(c))).join('')}
              </select></label>
            <label class="bqv-f"><span>Fastighet</span>
              <select id="bq-f-property" onchange="InvoicesPage._setFilter('property', this.value)">
                <option value="">Alla fastigheter</option>
                ${properties.map(p => opt(p.id, this._qPropertyId, p.name || p.id)).join('')}
              </select></label>
            <label class="bqv-f"><span>Typ</span>
              <select id="bq-f-type" onchange="InvoicesPage._setFilter('type', this.value)">
                ${opt('alla', this._qType, 'Alla typer')}${opt('time', this._qType, 'Tid')}${opt('material', this._qType, 'Material')}${opt('fixed', this._qType, 'Fastpris')}
              </select></label>
            <label class="bqv-f"><span>Period</span>
              <select id="bq-f-period" onchange="InvoicesPage._setFilter('period', this.value)">
                ${opt('alla', this._qPeriod, 'Alla perioder')}${opt('denna_manad', this._qPeriod, 'Denna månad')}${opt('forra_manaden', this._qPeriod, 'Förra månaden')}${opt('senaste_30', this._qPeriod, 'Senaste 30 dagarna')}
              </select></label>
            <label class="bqv-f"><span>Sortera</span>
              <select id="bq-f-sort" onchange="InvoicesPage._setFilter('sort', this.value)">
                ${opt('amount', this._qSort, 'Belopp (högst först)')}${opt('customer', this._qSort, 'Kund (A–Ö)')}${opt('date', this._qSort, 'Datum (äldst först)')}${opt('issues', this._qSort, 'Kräver åtgärd (flest först)')}
              </select></label>
          </div>
        </div>
        <div id="bq-list"></div>
        <div id="bq-selsum" class="bqv-selsum-wrap"></div>
      </div>`;
    const wrap = document.getElementById('bq-wrap');
    if (wrap) {
      wrap.addEventListener('click', (e) => InvoicesPage._onQueueClick(e));
      wrap.addEventListener('change', (e) => InvoicesPage._onQueueChange(e));
    }
    this._renderQueueList();
  },

  /* V33 §13: byte av kundfilter kan göra det valda fastighetsfiltret
     ogiltigt (fastigheten hör inte längre till den valda kunden) — då
     nollställs det automatiskt. Bygger om HELA verktygsraden (fastighets-
     listans alternativ beror på vald kund) — påverkar inte sökfältets
     fokus eftersom detta bara triggas av ett select-byte. */
  _onCustomerFilterChange(value) {
    this._qCustomerId = value;
    if (this._qPropertyId) {
      const prop = (state.properties || []).find(p => p.id === this._qPropertyId);
      if (!prop || (value && prop.customerId !== value)) this._qPropertyId = '';
    }
    this._qLimit = this._QSTEP;
    const body = document.getElementById('inv-view-body');
    if (body) this._renderQueueView(body);
  },

  _onSearch(v) {
    this._qQuery = v || '';
    this._qLimit = this._QSTEP;
    clearTimeout(this._searchT);
    this._searchT = setTimeout(() => InvoicesPage._renderQueueList(), 150);
  },

  _setFilter(kind, value) {
    if (kind === 'property') this._qPropertyId = value || '';
    else if (kind === 'type') this._qType = value || 'alla';
    else if (kind === 'period') this._qPeriod = value || 'alla';
    else if (kind === 'sort') this._qSort = value || 'amount';
    this._qLimit = this._QSTEP;
    this._renderQueueList();
  },

  /* Visa: alla / redo att fakturera / Kräver åtgärd (ett klick). */
  _setShow(v) {
    this._qShow = ['alla', 'redo', 'atgard'].indexOf(v) >= 0 ? v : 'alla';
    this._qOnlyIssues = this._qShow === 'atgard';
    this._qLimit = this._QSTEP;
    if (document.getElementById('bq-list')) this._renderQueueList();
  },

  _filtersActive() {
    return !!(this._qQuery || this._qCustomerId || this._qPropertyId || this._qType !== 'alla' || this._qPeriod !== 'alla');
  },

  _clearFilters() {
    this._qQuery = ''; this._qCustomerId = ''; this._qPropertyId = ''; this._qType = 'alla'; this._qPeriod = 'alla';
    this._qShow = 'alla'; this._qOnlyIssues = false; this._qLimit = this._QSTEP;
    const body = document.getElementById('inv-view-body');
    if (body) this._renderQueueView(body);
  },

  _matchesPeriod(dateStr, period) {
    if (!dateStr) return period === 'alla';
    if (period === 'alla') return true;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    if (period === 'senaste_30') return (now - d) <= 30 * 86400000 && d <= now;
    if (period === 'denna_manad') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (period === 'forra_manaden') {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth();
    }
    return true;
  },

  /* Samma filterlogik som tidigare (typ, kund, fastighet, period, fritext). */
  _filterCandidates(all) {
    let f = all;
    if (this._qType !== 'alla')   f = f.filter(c => c.sourceType === this._qType);
    if (this._qCustomerId)        f = f.filter(c => c.customerId === this._qCustomerId);
    if (this._qPropertyId)        f = f.filter(c => c.propertyId === this._qPropertyId);
    if (this._qPeriod !== 'alla') f = f.filter(c => this._matchesPeriod(c.date, this._qPeriod));
    if (this._qQuery) {
      const q = this._qQuery.toLowerCase();
      f = f.filter(c => [c.customerName, c.propertyName, c.workOrderNumber, c.workOrderTitle, c.staffName, c.description]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    return f;
  },

  _sumAmounts(list) {
    return Math.round(list.reduce((s, c) => s + (c.amount || 0), 0) * 100) / 100;
  },

  _renderQueueList() {
    const headerEl = document.getElementById('bq-header');
    const listEl   = document.getElementById('bq-list');
    if (!listEl) return; /* användaren har hunnit byta vy */
    if (!this._exp) this._exp = new Set();
    const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

    const all = BillingQueueService.getCandidates();
    const byKey = {};
    all.forEach(c => { byKey[c.id] = c; });
    this._byKey = byKey;

    const matched = this._filterCandidates(all);
    const matchedSel = matched.filter(c => c.selectable);
    const matchedIss = matched.filter(c => !c.selectable);
    const show = this._qShow;
    const shown = show === 'redo' ? matchedSel : show === 'atgard' ? matchedIss : matched;
    const summary = BillingQueueService.getSummary(all);
    const filtersActive = this._filtersActive();

    if (headerEl) headerEl.innerHTML = this._queueHeaderHtml(summary, all);
    const fcount = document.getElementById('bq-fcount');
    if (fcount) {
      const nf = [this._qCustomerId, this._qPropertyId, this._qType !== 'alla', this._qPeriod !== 'alla'].filter(Boolean).length;
      fcount.textContent = nf ? ' (' + nf + ')' : '';
    }
    const chipsEl = document.getElementById('bq-chips');
    if (chipsEl) {
      const chip = (v, label, n, extra) => `<button type="button" class="chip${show===v?' on':''}${extra||''}" data-act="show" data-show="${v}" aria-pressed="${show===v?'true':'false'}">${label}<span class="chip-n">${n}</span></button>`;
      chipsEl.innerHTML = chip('alla', 'Alla', matched.length) + chip('redo', 'Redo att fakturera', matchedSel.length) +
        chip('atgard', `${ic('alert-triangle',13)} Kräver åtgärd`, matchedIss.length, matchedIss.length ? ' chip-danger' : '');
    }

    const actions = [
      { id: 'create', label: 'Skapa fakturautkast', icon: 'file-plus', permission: 'invoice_create', type: 'custom',
        open: ids => InvoicesPage._openCreateConfirm(ids) }
    ];
    SelectionModel.init('billingSource', {
      itemsProvider: () => BillingQueueService.getCandidates().filter(c => c.selectable),
      labelSingular: 'underlag', labelPlural: 'underlag',
      selectionSummary: () => InvoicesPage._kr(InvoicesPage._selTotals(SelectionModel.getSelected()).ex) + ' exkl. moms',
      actions
    });
    /* "Välj alla" gäller ALLA valbara underlag som matchar filtret — även de
       i ihopfällda grupper — och etiketten säger exakt hur många. */
    const selIds = show === 'atgard' ? [] : matchedSel.map(c => c.id);
    this._shownSelIds = new Set(selIds);
    SelectionModel.selectAllHtml(selIds);

    let html;
    if (all.length === 0) {
      html = `<div class="empty">${ic('check-circle',36)}<h3>Inget att fakturera</h3><p>Alla debiterbara underlag är redan kopplade till fakturautkast.</p></div>`;
    } else if (shown.length === 0) {
      const why = show === 'atgard' ? 'Inga underlag som matchar filtret kräver åtgärd.' : show === 'redo' ? 'Inga faktureringsbara underlag matchar filtret.' : 'Inga underlag matchar filtret.';
      html = this._resultBarHtml({ matched, matchedSel, matchedIss, shown, selIds, filtersActive, total: all.length }) +
        `<div class="empty">${ic('search',32)}<h3>Inga träffar</h3><p>${why}</p></div>`;
    } else {
      html = this._resultBarHtml({ matched, matchedSel, matchedIss, shown, selIds, filtersActive, total: all.length });
      if (show === 'atgard') html += this._issueListHtml(shown);
      else html += this._groupsHtml(this._buildModel(shown));
    }
    listEl.innerHTML = html;
    this._afterSelChange();
    /* "Välj alla" och andra markeringar utanför listan (t.ex. Esc/annan
       vy) går direkt via SelectionModel; synka kön efter varje klick medan
       den visas. Billigt: bara synliga gruppers kryssrutor + summeringen. */
    if (!this._groupSyncBound) {
      this._groupSyncBound = true;
      document.addEventListener('click', () => requestAnimationFrame(() => { if (document.querySelector('#pg-invoices.active #bq-list')) InvoicesPage._afterSelChange(); }), true);
    }
    this._lastRenderMs = Math.round((((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0) * 10) / 10;
  },

  _queueHeaderHtml(s, all) {
    const custs = new Set(all.filter(c => c.selectable).map(c => c.customerId || '—')).size;
    return `
      <div class="card bqv-head" id="bq-head">
        <div class="bqv-head-total">
          <div class="bqv-kicker">Hela kön · redo att fakturera</div>
          <div class="bqv-head-amt" data-total="${s.totalAmount}">${this._kr(s.totalAmount)} <span>exkl. moms</span></div>
          <div class="bqv-head-sub">${s.selectableCount} underlag · ${custs} ${custs===1?'kund':'kunder'}</div>
        </div>
        <dl class="bqv-head-break" aria-label="Fördelning exkl. moms">
          <div><dt>${ic('clock',12)} Tid</dt><dd data-part="time">${this._kr(s.timeAmount)}</dd></div>
          <div><dt>${ic('package',12)} Material</dt><dd data-part="material">${this._kr(s.materialAmount)}</dd></div>
          <div><dt>${ic('file-check',12)} Fastpris</dt><dd data-part="fixed">${this._kr(s.fixedAmount)}</dd></div>
        </dl>
        ${s.issuesCount > 0 ? `<button type="button" class="bqv-head-iss" data-act="show" data-show="atgard">
          ${ic('alert-triangle',14)}<span><b>${s.issuesCount} ${s.issuesCount===1?'post kräver':'poster kräver'} åtgärd</b><small>ingår inte i summan</small></span></button>` : ''}
      </div>`;
  },

  _resultBarHtml(o) {
    const n = o.selIds.length;
    const selAll = n > 0 ? `<label class="bqv-selall">
        <input type="checkbox" class="_sel-all-cb" onchange="SelectionModel.selectAllToggle()"
          aria-label="Välj alla ${n} underlag som ${o.filtersActive || this._qShow !== 'alla' ? 'matchar filtret' : 'kan faktureras'}">
        <span>Välj alla <b>${n}</b> ${o.filtersActive ? 'som matchar filtret' : 'som kan faktureras'}</span></label>` : '';
    let txt;
    if (this._qShow === 'atgard') {
      txt = `<b>${o.shown.length}</b> ${o.shown.length===1?'post':'poster'} kräver åtgärd${o.filtersActive ? ' (filtrerat urval)' : ''} · ingår inte i någon summa`;
    } else if (o.filtersActive || this._qShow !== 'alla') {
      txt = `Visar <b>${o.shown.length}</b> av ${o.total} underlag · <span class="bqv-fsum">Summa för filtrerat urval: <b data-filtered-sum="${this._sumAmounts(o.matchedSel)}">${this._kr(this._sumAmounts(o.matchedSel))}</b> exkl. moms</span>`;
    } else {
      txt = `Visar <b>${o.shown.length}</b> av ${o.total} underlag · <span class="bqv-fsum"><b>${o.matchedSel.length}</b> kan faktureras: <b data-filtered-sum="${this._sumAmounts(o.matchedSel)}">${this._kr(this._sumAmounts(o.matchedSel))}</b> exkl. moms</span>`;
    }
    const canExpand = this._qShow !== 'atgard' && o.shown.length > 0;
    return `
      <div class="bqv-result">
        <div class="bqv-result-txt"><span class="bqv-result-main">${txt}</span>
          ${(o.filtersActive || this._qShow !== 'alla') ? `<button type="button" class="btn bghost bsm bqv-clear" data-act="clear-filters">${ic('x',13)} Rensa filter</button>` : ''}
        </div>
        <div class="bqv-result-acts">
          ${selAll}
          ${canExpand ? `<button type="button" class="btn bghost bsm" id="bq-expand-all" data-act="expand-all">${ic('chevron-down',14)} Visa alla rader</button>
          <button type="button" class="btn bghost bsm" id="bq-collapse-all" data-act="collapse-all">${ic('chevron-up',14)} Fäll ihop</button>` : ''}
        </div>
      </div>`;
  },

  /* Gruppering: kund → fastighet → arbetsorder → underlag (SPRINT2 §17).
     Belopp per grupp = summan av gruppens VALBARA underlag (samma regel
     som köns totalsumma i getSummary()); underlag som kräver åtgärd räknas
     separat och ingår aldrig i beloppen. */
  _buildModel(list) {
    const custs = {};
    const idx = {};
    const dateOf = (c) => String(c.date || '');
    list.forEach(c => {
      const cId = c.customerId || '—';
      const cKey = 'c:' + cId;
      let cu = custs[cKey];
      if (!cu) cu = custs[cKey] = idx[cKey] = { key: cKey, name: c.customerName || '—', props: {}, aoIds: new Set(), rows: 0, selIds: [], issues: 0, amount: 0, firstDate: '' };
      const pKey = 'p:' + cId + '|' + (c.propertyId || '—');
      let pr = cu.props[pKey];
      if (!pr) pr = cu.props[pKey] = idx[pKey] = { key: pKey, name: c.propertyName || 'Utan fastighet', aos: {}, selIds: [], amount: 0 };
      const aKey = 'a:' + cId + '|' + (c.workOrderId || '—');
      let ao = pr.aos[aKey];
      if (!ao) ao = pr.aos[aKey] = idx[aKey] = { key: aKey, id: c.workOrderId || '', title: c.workOrderTitle || '', items: [], selIds: [], issues: 0, amount: 0, types: { time: 0, material: 0, fixed: 0 }, hours: 0, firstDate: '', lastDate: '' };
      ao.items.push(c);
      cu.rows++;
      if (c.workOrderId) cu.aoIds.add(c.workOrderId); else cu.aoIds.add('—');
      if (ao.types[c.sourceType] !== undefined) ao.types[c.sourceType]++;
      if (c.sourceType === 'time') ao.hours += Number(c.quantity) || 0;
      const d = dateOf(c);
      if (d) {
        if (!cu.firstDate || d < cu.firstDate) cu.firstDate = d;
        if (!ao.firstDate || d < ao.firstDate) ao.firstDate = d;
        if (!ao.lastDate || d > ao.lastDate) ao.lastDate = d;
      }
      if (c.selectable) {
        cu.selIds.push(c.id); pr.selIds.push(c.id); ao.selIds.push(c.id);
        cu.amount += c.amount; pr.amount += c.amount; ao.amount += c.amount;
      } else { cu.issues++; ao.issues++; }
    });
    const r2 = (v) => Math.round(v * 100) / 100;
    Object.values(idx).forEach(g => { g.amount = r2(g.amount); });
    const cmpName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'sv', { numeric: true });
    const sorters = {
      customer: cmpName,
      amount: (a, b) => (b.amount - a.amount) || cmpName(a, b),
      date: (a, b) => (String(a.firstDate || '9999') < String(b.firstDate || '9999') ? -1 : String(a.firstDate || '9999') > String(b.firstDate || '9999') ? 1 : cmpName(a, b)),
      issues: (a, b) => (b.issues - a.issues) || (b.amount - a.amount) || cmpName(a, b)
    };
    const sortFn = sorters[this._qSort] || sorters.amount;
    const aoSort = {
      customer: (a, b) => String(a.id).localeCompare(String(b.id), 'sv', { numeric: true }),
      amount: (a, b) => (b.amount - a.amount) || String(a.id).localeCompare(String(b.id), 'sv', { numeric: true }),
      date: (a, b) => (String(a.firstDate || '9999') < String(b.firstDate || '9999') ? -1 : String(a.firstDate || '9999') > String(b.firstDate || '9999') ? 1 : 0),
      issues: (a, b) => (b.issues - a.issues) || (b.amount - a.amount)
    }[this._qSort] || ((a, b) => b.amount - a.amount);
    const customers = Object.values(custs).sort(sortFn);
    customers.forEach(cu => {
      cu.propList = Object.values(cu.props).sort((a, b) => (b.amount - a.amount) || cmpName(a, b));
      cu.propList.forEach(p => {
        p.aoList = Object.values(p.aos).sort(aoSort);
        p.aoList.forEach(a => a.items.sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')) || String(x.id).localeCompare(String(y.id))));
      });
    });
    this._model = { customers, idx };
    return this._model;
  },

  _cbHtml(key, ids, label) {
    if (!ids.length) return `<span class="bqv-cbw is-empty" aria-hidden="true"></span>`;
    return `<label class="bqv-cbw" title="${esc(label)}"><input type="checkbox" class="bqv-cb" data-key="${esc(key)}" data-group-ids="${esc(ids.join('|'))}" aria-label="${esc(label)}"></label>`;
  },

  _groupsHtml(model) {
    const custs = model.customers;
    const lim = Math.max(this._QSTEP, this._qLimit || this._QSTEP);
    const visible = custs.slice(0, lim);
    const rest = custs.length - visible.length;
    return `<div class="bqv-groups" role="list">${visible.map(cu => this._custHtml(cu)).join('')}</div>` +
      (rest > 0 ? `<button type="button" class="btn bs bqv-more" data-act="more">Visa fler kunder (${rest} kvar)</button>` : '');
  },

  _custHtml(cu) {
    const open = this._exp.has(cu.key);
    const aoN = cu.aoIds.size;
    return `
      <div class="bqv-cust${open ? ' is-open' : ''}" role="listitem" data-key="${esc(cu.key)}">
        <div class="bqv-row bqv-cust-row" data-act="toggle" data-key="${esc(cu.key)}">
          ${this._cbHtml(cu.key, cu.selIds, 'Markera alla underlag för ' + (cu.name || 'kunden'))}
          <button type="button" class="bqv-tog" data-act="toggle" data-key="${esc(cu.key)}" aria-expanded="${open}" aria-label="${open ? 'Dölj' : 'Visa'} arbetsordrar för ${esc(cu.name)}" title="${open ? 'Dölj' : 'Visa'} arbetsordrar">${ic('chevron-right',16)}</button>
          <div class="bqv-main">
            <div class="bqv-title">${esc(cu.name)}</div>
            <div class="bqv-meta">
              <span>${aoN} AO</span><span>${cu.rows} ${cu.rows===1?'underlag':'underlag'}</span>
              ${cu.issues ? `<span class="bqv-iss">${ic('alert-triangle',11)} ${cu.issues} kräver åtgärd</span>` : ''}
              <span class="bqv-selinfo" data-selinfo="${esc(cu.key)}"></span>
            </div>
          </div>
          <div class="bqv-amt"><b>${this._kr(cu.amount)}</b><small>exkl. moms</small></div>
        </div>
        ${open ? `<div class="bqv-kids">${cu.propList.map(p => this._propHtml(p)).join('')}</div>` : ''}
      </div>`;
  },

  _propHtml(p) {
    return `
      <div class="bqv-prop">
        <div class="bqv-row bqv-prop-row">
          ${this._cbHtml(p.key, p.selIds, 'Markera alla underlag för ' + (p.name || 'fastigheten'))}
          <div class="bqv-main"><div class="bqv-title">${ic('building-2',12)} ${esc(p.name)}</div></div>
          <div class="bqv-amt"><b>${this._kr(p.amount)}</b></div>
        </div>
        ${p.aoList.map(a => this._aoHtml(a)).join('')}
      </div>`;
  },

  _aoHtml(a) {
    const open = this._exp.has(a.key);
    const parts = [];
    parts.push(`${a.items.length} underlag`);
    if (a.types.time) parts.push(`Tid ${fmt(Math.round(a.hours * 100) / 100)} h`);
    if (a.types.material) parts.push(`Material ${a.types.material}`);
    if (a.types.fixed) parts.push('Fastpris');
    if (a.lastDate) parts.push(fmtDate(a.lastDate));
    const aoLabel = a.id || 'Utan arbetsorder';
    return `
      <div class="bqv-ao${open ? ' is-open' : ''}" data-key="${esc(a.key)}">
        <div class="bqv-row bqv-ao-row" data-act="toggle" data-key="${esc(a.key)}">
          ${this._cbHtml(a.key, a.selIds, 'Markera alla underlag för ' + aoLabel)}
          <button type="button" class="bqv-tog" data-act="toggle" data-key="${esc(a.key)}" aria-expanded="${open}" aria-label="${open ? 'Dölj' : 'Visa'} underlag för ${esc(aoLabel)}" title="${open ? 'Dölj' : 'Visa'} underlag">${ic('chevron-right',15)}</button>
          <div class="bqv-main">
            <div class="bqv-title">${esc(aoLabel)}${a.title ? ' · ' + esc(a.title) : ''}</div>
            <div class="bqv-meta">${parts.map(p => `<span>${esc(p)}</span>`).join('')}
              ${a.issues ? `<span class="bqv-iss">${ic('alert-triangle',11)} ${a.issues} kräver åtgärd</span>` : ''}
              <span class="bqv-selinfo" data-selinfo="${esc(a.key)}"></span>
            </div>
          </div>
          <div class="bqv-amt"><b>${this._kr(a.amount)}</b></div>
          ${a.id ? `<button type="button" class="bqv-open" data-act="open-ao" data-ao="${esc(a.id)}" title="Öppna ${esc(a.id)}" aria-label="Öppna arbetsorder ${esc(a.id)}">${ic('external-link',15)}</button>` : ''}
        </div>
        ${open ? `<div class="bqv-srcs">${a.items.map(c => this._sourceRowHtml(c)).join('')}</div>` : ''}
      </div>`;
  },

  _sourceRowHtml(c) {
    const typeIcon  = this._TYPE_ICON[c.sourceType] || 'file-text';
    const typeLabel = this._TYPE_LABEL[c.sourceType] || c.sourceType;
    const head = c.sourceType === 'time'
      ? `${fmtDate(c.date)}${c.staffName ? ' · ' + esc(c.staffName) : ''}${c.attested === false ? ` <span class="bdg bdg-grey bqv-att" title="Information — attest påverkar inte om tiden kan faktureras">Ej attesterad</span>` : ''}`
      : (c.description && c.description !== typeLabel ? esc(c.description) : '');
    const vat = Number(c.vatRate);
    const calc = `${fmt(c.quantity)} ${esc(c.unit)} × ${this._kr(c.unitPrice)} · moms ${Number.isFinite(vat) ? fmt(vat) : '—'} %`;
    if (!c.selectable) {
      return `
      <div class="bqv-src is-issue" data-issue-key="${esc(c.id)}">
        <span class="bqv-cbw is-blocked" title="Kan inte faktureras ännu">${ic('alert-triangle',15)}</span>
        <div class="bqv-main">
          <div class="bqv-src-head">${ic(typeIcon,11)} ${typeLabel}${head ? ' · ' + head : ''}</div>
          <div class="bqv-meta"><span>${calc}</span></div>
          <div class="bqv-why">${c.issues.map(i => `<span>${esc(i)}</span>`).join('')}</div>
        </div>
        <div class="bqv-amt is-muted" title="Ingår inte i summan"><b>${this._kr(c.amount)}</b><small>ingår ej</small></div>
      </div>`;
    }
    const selected = SelectionModel.isSelected(c.id);
    return `
      <div class="bqv-src${selected ? ' selected' : ''}" data-sel-row-id="${esc(c.id)}">
        <label class="bqv-cbw"><input type="checkbox" class="_sel-cb" data-sel-id="${esc(c.id)}" ${selected ? 'checked' : ''}
          aria-label="Markera ${esc(typeLabel + ': ' + (c.description || ''))}"></label>
        <div class="bqv-main">
          <div class="bqv-src-head">${ic(typeIcon,11)} ${typeLabel}${head ? ' · ' + head : ''}</div>
          <div class="bqv-meta"><span>${calc}</span></div>
        </div>
        <div class="bqv-amt"><b>${this._kr(c.amount)}</b></div>
      </div>`;
  },

  /* "Kräver åtgärd": exakt de kandidater BillingQueueService markerar som
     ej valbara — varför (orsakerna från tjänsten + förklaring) och en direkt
     åtgärd där en befintlig funktion finns. */
  _issueListHtml(list) {
    const sorted = list.slice().sort((a, b) => String(a.customerName || '').localeCompare(String(b.customerName || ''), 'sv') ||
      String(a.workOrderId || '').localeCompare(String(b.workOrderId || ''), 'sv') || String(a.date || '').localeCompare(String(b.date || '')));
    const lim = Math.max(this._QSTEP, this._qLimit || this._QSTEP);
    const vis = sorted.slice(0, lim);
    const rest = sorted.length - vis.length;
    return `<div class="bqv-issues" role="list">${vis.map(c => this._issueCardHtml(c)).join('')}</div>` +
      (rest > 0 ? `<button type="button" class="btn bs bqv-more" data-act="more">Visa fler (${rest} kvar)</button>` : '');
  },

  _issueCardHtml(c) {
    const typeIcon  = this._TYPE_ICON[c.sourceType] || 'file-text';
    const typeLabel = this._TYPE_LABEL[c.sourceType] || c.sourceType;
    const where = [c.customerName && c.customerName !== '—' ? esc(c.customerName) : 'Ingen kund',
      c.workOrderId ? esc(c.workOrderId) + (c.workOrderTitle ? ' · ' + esc(c.workOrderTitle) : '') : '',
      c.date ? fmtDate(c.date) : '', c.staffName ? esc(c.staffName) : ''].filter(Boolean);
    return `
      <div class="card bqv-issue" role="listitem" data-issue-key="${esc(c.id)}">
        <div class="bqv-issue-head">
          <span class="bqv-issue-ico">${ic(typeIcon,14)}</span>
          <div class="bqv-main">
            <div class="bqv-title">${typeLabel}: ${esc(c.description)}</div>
            <div class="bqv-meta">${where.map(w => `<span>${w}</span>`).join('')}</div>
          </div>
          <div class="bqv-amt is-muted" title="Ingår inte i någon summa"><b>${this._kr(c.amount)}</b><small>ingår ej</small></div>
        </div>
        <ul class="bqv-why-list">
          ${c.issues.map(i => `<li><b>${esc(i)}</b>${this._ISSUE_HELP[i] ? ' — ' + esc(this._ISSUE_HELP[i]) : ''}</li>`).join('')}
        </ul>
        <div class="bqv-issue-acts">${this._issueActionsHtml(c)}</div>
      </div>`;
  },

  _issueActionsHtml(c) {
    const acts = [];
    const ao = c.workOrderId ? getAO(c.workOrderId) : null;
    const has = (i) => (c.issues || []).indexOf(i) !== -1;
    if (ao && c.sourceType === 'material' && has('Saknar försäljningspris') && Auth.can('ao_material')) {
      acts.push(`<button type="button" class="btn bp bsm" data-act="edit-mat" data-ao="${esc(ao.id)}" data-mat="${esc(c.sourceId)}">${ic('pencil',13)} Ändra materialpris</button>`);
    }
    if (ao && !ao.invoiceId && this._PRICING_ISSUES.some(has) && Auth.canAny(['ao_edit', 'invoice_create'])) {
      acts.push(`<button type="button" class="btn bp bsm" data-act="pricing" data-ao="${esc(ao.id)}">${ic('tag',13)} Sätt prissättning</button>`);
    }
    if (ao) acts.push(`<button type="button" class="btn bs bsm" data-act="open-ao" data-ao="${esc(ao.id)}">${ic('clipboard-list',13)} Öppna ${esc(ao.id)}</button>`);
    if (!c.workOrderId && c.sourceType === 'time' && Auth.canViewPage('pg-tid')) {
      acts.push(`<button type="button" class="btn bs bsm" data-act="open-tid">${ic('clock',13)} Öppna Tid &amp; stämpla</button>`);
    }
    if (!acts.length) acts.push(`<span class="bqv-noact">Ingen direkt åtgärd härifrån.</span>`);
    return acts.join('');
  },

  /* ── Händelser (delegerade — inga data i inline-hanterare) ── */
  _onQueueClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('label.bqv-cbw, input, select, .bqv-selall')) return;
    const el = t.closest('[data-act]');
    if (!el || !document.getElementById('bq-wrap').contains(el)) return;
    const act = el.getAttribute('data-act');
    if (act === 'toggle') { e.preventDefault(); this._toggleGroup(el.getAttribute('data-key')); }
    else if (act === 'show') { this._setShow(el.getAttribute('data-show')); }
    else if (act === 'toggle-filters') {
      this._qFiltersOpen = !this._qFiltersOpen;
      const tools = document.getElementById('bq-tools');
      if (tools) tools.classList.toggle('is-fopen', this._qFiltersOpen);
      el.setAttribute('aria-expanded', this._qFiltersOpen ? 'true' : 'false');
    }
    else if (act === 'more') { this._qLimit = (this._qLimit || this._QSTEP) + this._QSTEP; this._renderQueueList(); }
    else if (act === 'expand-all') { this._expandAll(); }
    else if (act === 'collapse-all') { this._exp.clear(); this._renderQueueList(); }
    else if (act === 'clear-filters') { this._clearFilters(); }
    else if (act === 'clear-sel') { SelectionModel.clearAll(); this._afterSelChange(); }
    else if (act === 'desel-hidden') { this._deselectHidden(); }
    else if (act === 'create') { this._openCreateConfirm(SelectionModel.getSelected()); }
    else if (act === 'open-ao') { e.stopPropagation(); Router.showPage('pg-ao-detail', { aoId: el.getAttribute('data-ao') }); }
    else if (act === 'edit-mat') { this._goAoAndOpen(el.getAttribute('data-ao'), 'openEditMaterial', el.getAttribute('data-mat')); }
    else if (act === 'pricing') { this._goAoAndOpen(el.getAttribute('data-ao'), 'openPricingModal'); }
    else if (act === 'open-tid') { Router.showPage('pg-tid'); }
  },

  _onQueueChange(e) {
    const t = e.target;
    if (!t || !t.matches) return;
    if (t.matches('input._sel-cb[data-sel-id]')) {
      const id = t.getAttribute('data-sel-id');
      if (SelectionModel.isSelected(id) !== t.checked) SelectionModel.toggle(id);
      this._afterSelChange();
    } else if (t.matches('input.bqv-cb')) {
      this._onGroupCheckboxChange(t);
    } else if (t.matches('input._sel-all-cb')) {
      this._afterSelChange();
    }
  },

  /* Öppnar arbetsordern och därefter dess befintliga dialog (samma
     funktion och samma behörighetskontroller som på AO-sidan). */
  _goAoAndOpen(aoId, fn, arg) {
    if (!aoId) return;
    Router.showPage('pg-ao-detail', { aoId });
    setTimeout(() => {
      if (typeof WorkOrderDetailPage === 'undefined' || WorkOrderDetailPage.aoId !== aoId || typeof WorkOrderDetailPage[fn] !== 'function') return;
      WorkOrderDetailPage[fn](arg);
    }, 60);
  },

  _toggleGroup(key) {
    if (!key) return;
    if (this._exp.has(key)) this._exp.delete(key); else this._exp.add(key);
    this._renderQueueList();
    /* Behåll tangentbordsfokus på samma pilknapp efter omritningen. */
    const btn = [...document.querySelectorAll('#bq-list .bqv-tog')].find(b => b.getAttribute('data-key') === key);
    if (btn && document.activeElement && document.activeElement !== btn && (document.activeElement === document.body || !document.getElementById('bq-list').contains(document.activeElement))) btn.focus({ preventScroll: true });
  },

  _expandAll() {
    if (!this._model) return;
    this._model.customers.forEach(cu => {
      this._exp.add(cu.key);
      cu.propList.forEach(p => p.aoList.forEach(a => this._exp.add(a.key)));
    });
    this._renderQueueList();
  },

  /* Testkrok/skärmbild: fäll ut första kunden och dess första AO. */
  _expandFirst() {
    if (!this._model || !this._model.customers.length) return;
    const cu = this._model.customers[0];
    this._exp.add(cu.key);
    const a = cu.propList[0] && cu.propList[0].aoList[0];
    if (a) this._exp.add(a.key);
    this._renderQueueList();
  },

  /* Gruppens kryssruta markerar/avmarkerar alla gruppens VALBARA underlag
     som matchar filtret — samma beteende som förut (ett klick på en delvis
     markerad grupp markerar alla). */
  _onGroupCheckboxChange(cbEl) {
    const ids = (cbEl.getAttribute('data-group-ids') || '').split('|').filter(Boolean);
    if (cbEl.checked) {
      const add = ids.filter(id => !SelectionModel.isSelected(id));
      if (add.length) SelectionModel.selectAllVisible(add);
    } else {
      ids.forEach(id => { if (SelectionModel.isSelected(id)) SelectionModel.toggle(id); });
    }
    this._afterSelChange();
  },

  _deselectHidden() {
    const shown = this._shownSelIds || new Set();
    SelectionModel.getSelected().forEach(id => { if (!shown.has(id)) SelectionModel.toggle(id); });
    this._afterSelChange();
  },

  /* Synkar gruppernas kryssrutor (tre lägen), "x av y valda" och den
     klistrade summeringen. Ritar inte om listan. */
  _afterSelChange() {
    const listEl = document.getElementById('bq-list');
    if (!listEl) return;
    const infos = {};
    listEl.querySelectorAll('[data-selinfo]').forEach(x => { infos[x.getAttribute('data-selinfo')] = x; });
    listEl.querySelectorAll('input.bqv-cb').forEach(cb => {
      const ids = (cb.getAttribute('data-group-ids') || '').split('|').filter(Boolean);
      const n = ids.filter(id => SelectionModel.isSelected(id)).length;
      cb.checked = ids.length > 0 && n === ids.length;
      cb.indeterminate = n > 0 && n < ids.length;
      const key = cb.getAttribute('data-key');
      const info = infos[key];
      if (info) {
        info.textContent = n === 0 ? '' : `${n} av ${ids.length} valda`;
        info.classList.toggle('is-partial', n > 0 && n < ids.length);
        info.classList.toggle('is-all', n > 0 && n === ids.length);
      }
      const grp = cb.closest('.bqv-cust, .bqv-ao');
      if (grp && cb.closest('.bqv-row') && cb.closest('.bqv-row').parentElement === grp) grp.classList.toggle('has-sel', n > 0);
    });
    listEl.querySelectorAll('input._sel-cb[data-sel-id]').forEach(cb => {
      const on = SelectionModel.isSelected(cb.getAttribute('data-sel-id'));
      cb.checked = on;
      const row = cb.closest('.bqv-src'); if (row) row.classList.toggle('selected', on);
    });
    const selAll = listEl.querySelector('._sel-all-cb');
    if (selAll && this._shownSelIds) {
      const tot = this._shownSelIds.size;
      let n = 0; this._shownSelIds.forEach(id => { if (SelectionModel.isSelected(id)) n++; });
      selAll.checked = tot > 0 && n === tot;
      selAll.indeterminate = n > 0 && n < tot;
    }
    this._renderSelSummary();
  },

  /* Summering av det VALDA underlaget, beräknad som de fakturautkast som
     skulle skapas: en faktura per kund, rader = kandidatens antal × à-pris
     med kandidatens momssats, summerat med InvoiceService.calcSummary() —
     samma funktion som fakturadetaljen använder. Ingen egen beräkning. */
  _selTotals(ids) {
    const byKey = this._byKey || {};
    const valid = [], stale = [];
    (ids || []).forEach(id => { const c = byKey[id]; if (c && c.selectable) valid.push(c); else stale.push(id); });
    const byCust = {};
    valid.forEach(c => { (byCust[c.customerId || '—'] = byCust[c.customerId || '—'] || []).push(c); });
    let ex = 0, vat = 0, total = 0;
    const perCustomer = Object.keys(byCust).map(cid => {
      const group = byCust[cid];
      const s = InvoiceService.calcSummary({ lines: group.map(c => ({ qty: c.quantity, unitPrice: c.unitPrice, vatRate: c.vatRate })) });
      ex += s.exVat; vat += s.vat; total += s.totalInclVat;
      return { customerId: cid, name: group[0].customerName, count: group.length, ex: s.exVat, vat: s.vat, total: s.totalInclVat };
    });
    const r2 = (v) => Math.round(v * 100) / 100;
    return { n: valid.length, stale, valid, perCustomer, ex: r2(ex), vat: r2(vat), total: r2(total) };
  },

  _renderSelSummary() {
    const el = document.getElementById('bq-selsum');
    if (!el) return;
    const ids = SelectionModel.getSelected();
    if (!ids.length) { el.innerHTML = ''; el.classList.remove('is-on'); return; }
    const t = this._selTotals(ids);
    const shown = this._shownSelIds || new Set();
    const hiddenByFilter = t.valid.filter(c => !shown.has(c.id)).length;
    const nCust = t.perCustomer.length;
    const notes = [];
    if (hiddenByFilter) notes.push(`${ic('eye-off',13)} <span><b>${hiddenByFilter}</b> av de valda syns inte med nuvarande filter men ingår.</span>`);
    if (t.stale.length) notes.push(`${ic('alert-triangle',13)} <span><b>${t.stale.length}</b> valda kan inte längre faktureras.</span>`);
    el.classList.add('is-on');
    el.innerHTML = `
      <div class="bqv-sel" role="region" aria-label="Valt underlag">
        <div class="bqv-sel-info">
          <div class="bqv-sel-count"><b data-sel-count="${t.n}">${t.n}</b> ${t.n===1?'underlag valt':'underlag valda'} · ${nCust} ${nCust===1?'kund':'kunder'}
            <span class="bqv-sel-sub">→ ${nCust} ${nCust===1?'fakturautkast':'fakturautkast'}</span></div>
          ${notes.length ? `<div class="bqv-sel-notes">${notes.map(n => `<div>${n}</div>`).join('')}
            <button type="button" class="btn bghost bxs" data-act="desel-hidden">Avmarkera dolda</button></div>` : ''}
        </div>
        <dl class="bqv-sel-sums">
          <div><dt>Exkl. moms</dt><dd data-sel-ex="${t.ex}">${this._kr(t.ex)}</dd></div>
          <div><dt>Moms</dt><dd data-sel-vat="${t.vat}">${this._kr(t.vat)}</dd></div>
          <div class="is-total"><dt>Inkl. moms</dt><dd data-sel-total="${t.total}">${this._kr(t.total)}</dd></div>
        </dl>
        <div class="bqv-sel-acts">
          <button type="button" class="btn bs bsm" data-act="clear-sel">Avmarkera</button>
          ${Auth.can('invoice_create') ? `<button type="button" class="btn bp bqv-create" data-act="create">${ic('file-plus',15)} Skapa fakturautkast</button>` : ''}
        </div>
      </div>`;
  },

  /* ── Skapa fakturautkast: förhandsgranskning + atomisk create (§21/§22/§40/§41) ── */
  _openCreateConfirm(ids) {
    if (typeof Auth === 'undefined' || !Auth.can('invoice_create')) { showToast('Du saknar behörighet för denna åtgärd.'); return; }
    const all = BillingQueueService.getCandidates();
    const byKey = {};
    all.forEach(c => { byKey[c.id] = c; });
    this._byKey = byKey;
    const unique = Array.from(new Set(ids || []));
    const t = this._selTotals(unique);
    if (!t.n) { showToast('Inga av de markerade underlagen kan längre faktureras.'); return; }
    this._pendingIds = unique;
    const shown = this._shownSelIds || null;
    const hidden = shown ? t.valid.filter(c => !shown.has(c.id)).length : 0;

    const body = `
      <p class="bqv-cf-lead">${t.perCustomer.length} ${t.perCustomer.length===1?'kund':'kunder'} · ${t.n} underlag — ett fakturautkast (fakturaunderlag med status Utkast) per kund. Underlagen reserveras och försvinner ur kön.</p>
      ${hidden ? `<p class="bqv-cf-note">${ic('eye-off',13)} ${hidden} av underlagen syns inte med kön nuvarande filter men ingår.</p>` : ''}
      ${t.stale.length ? `<p class="bqv-cf-warn">${ic('alert-triangle',13)} ${t.stale.length} av de markerade kan inte längre faktureras — då skapas inget alls. Uppdatera kön och markera om.</p>` : ''}
      <div class="bqv-cf-list">
      ${t.perCustomer.map(p => `<div class="bqv-cf-row"><div><strong>${esc(p.name)}</strong><div class="bqv-cf-sub">${p.count} underlag</div></div>
        <div class="bqv-cf-amt"><b>${this._kr(p.ex)}</b><small>exkl. moms</small></div></div>`).join('')}
      </div>
      <dl class="bqv-cf-sums">
        <div><dt>Summa exkl. moms</dt><dd>${this._kr(t.ex)}</dd></div>
        <div><dt>Moms</dt><dd>${this._kr(t.vat)}</dd></div>
        <div class="is-total"><dt>Totalt inkl. moms</dt><dd>${this._kr(t.total)}</dd></div>
      </dl>`;

    Modal.open({
      title: `${ic('file-plus',16)} Skapa fakturautkast?`,
      body,
      buttons: [
        { label: t.perCustomer.length > 1 ? `Skapa ${t.perCustomer.length} fakturautkast` : 'Skapa fakturautkast', cls: 'btn bp',
          onClick: (ev) => InvoicesPage._confirmCreate(ev) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  async _confirmCreate(ev) {
    if (InvoicesPage._createBusy) return; /* dubbelklicksskydd */
    InvoicesPage._createBusy = true;
    const btnEl = ev && ev.currentTarget;
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Skapar…'; }
    /* Exakt de underlag som visades i bekräftelsedialogen (inte en ny,
       eventuellt ändrad markering). BillingQueueService revaliderar allt
       och skapar inget alls om något av dem inte längre kan faktureras. */
    const ids = (InvoicesPage._pendingIds && InvoicesPage._pendingIds.length) ? InvoicesPage._pendingIds : SelectionModel.getSelected();
    const result = await BillingQueueService.createInvoicesFromSourceKeys(ids);
    InvoicesPage._createBusy = false;
    InvoicesPage._pendingIds = null;
    Modal.close();

    if (!result.ok) { showToast(result.error || 'Kunde inte skapa fakturautkast.'); if (document.getElementById('bq-list')) InvoicesPage._renderQueueList(); return; }

    SelectionModel.clearAll();
    if (result.created.length === 1) {
      showToast(`${result.created[0].id} skapat.`);
      Router.showPage('pg-inv-detail', { invoiceId: result.created[0].id });
    } else {
      InvoicesPage._view = 'list';
      InvoicesPage._tab  = 'utkast';
      showToast(`${result.created.length} fakturautkast skapades från ${result.sources} underlag.`);
      InvoicesPage.render();
    }
  },

  /* ══════════════════════════════════════════════════════════════════
     FAKTURAUNDERLAG — den befintliga listan (SPRINT1), oförändrad logik,
     bara flyttad in i sin egen vy-metod.
     ══════════════════════════════════════════════════════════════════ */

  _renderListView(el) {
    const invoices = state.invoices || [];
    const ready    = WorkOrderService.readyForInvoice();

    SelectionModel.init('invoice', { stateKey: 'invoices', actions: [
      { id: 'export', label: 'Exportera', icon: 'download', type: 'export' }
    ] });

    const TAB_LABELS = { alla:'Alla', utkast:'Utkast', skickad:'Skickade', betald:'Betalda', förfallen:'Förfallna', makulerad:'Makulerade' };
    const tabs = Object.keys(TAB_LABELS);

    const counts = {};
    tabs.forEach(t => { counts[t] = t === 'alla' ? invoices.length : invoices.filter(i => i.status === t).length; });

    // KPI summary
    const kpiItems = [
      { label:'Utkast',   key:'utkast',   cls:'',       icon:'file-text'    },
      { label:'Skickade', key:'skickad',  cls:'blue',   icon:'send'         },
      { label:'Betalda',  key:'betald',   cls:'green',  icon:'check-circle' },
      { label:'Förfallna',key:'förfallen',cls:'red',    icon:'alert-circle' }
    ];
    const kpiHtml = `<div class="kpi-row">
      ${kpiItems.map(k => {
        const subset = invoices.filter(i => i.status === k.key);
        const total  = subset.reduce((s,i) => s + InvoiceService.calcTotals(i).total, 0);
        const active = this._tab === k.key;
        return `<div class="kpi-card ${k.cls}${active?' kpi-active':''}" onclick="InvoicesPage._setTab('${k.key}')" style="${active?'box-shadow:0 0 0 2px var(--sky)22;':''}" title="${esc(k.label)}">
          <div class="kpi-number">${counts[k.key]}</div>
          <div class="kpi-label">${esc(k.label)}${total > 0 ? `<br><span style="font-size:10px;font-weight:500;">${fkr(total)} inkl. moms</span>` : ''}</div>
        </div>`;
      }).join('')}
    </div>`;

    // Ready-for-invoice banner
    const readyHtml = ready.length > 0 ? `
      <div class="card" style="border-color:var(--gr);border-left:4px solid var(--gr);">
        <div class="card-header">
          <h3 style="color:var(--gr);">${ic('alert-triangle',14)} Klara ordrar – väntar fakturering</h3>
          <span class="bdg bdg-green">${ready.length}</span>
        </div>
        <div class="card-body" style="padding:6px 14px;">
          ${ready.slice(0,5).map(ao => {
            const cu = getCu(ao.customerId);
            const alreadyInvoiced = !!ao.invoiceId;
            return `<div class="crow" data-ao="${esc(ao.id)}" onclick="Router.showPage('pg-ao-detail',{aoId:this.getAttribute('data-ao')})">
              <div>
                <div style="font-size:13px;font-weight:700;">${esc(ao.id)} – ${esc(ao.title)}</div>
                <div class="invlist-meta">${esc(cu?CustomerService.displayName(cu):'—')}${alreadyInvoiced?` · <span class="invlist-i">${ic('check',10)} Faktura ${esc(ao.invoiceId)}</span>`:''}</div>
              </div>
              ${alreadyInvoiced
                ? `<button class="btn bsm bs" data-inv="${esc(ao.invoiceId)}" onclick="event.stopPropagation();Router.showPage('pg-inv-detail',{invoiceId:this.getAttribute('data-inv')})">${ic('receipt',13)} Visa</button>`
                : `<button class="btn bsm bsu" data-ao="${esc(ao.id)}" onclick="event.stopPropagation();InvoicesPage.createFromAO(this.getAttribute('data-ao'))">${ic('file-plus',13)} Skapa</button>`}
            </div>`;
          }).join('')}
        </div>
      </div>` : '';

    // Tab bar
    const tabHtml = `<div class="ftabs" style="margin-bottom:0;">
      ${tabs.map(t => `<button class="ft ${this._tab===t?'on':''}" onclick="InvoicesPage._setTab('${t}')">
        ${TAB_LABELS[t]}${counts[t]>0?` <span class="ft-n">${counts[t]}</span>`:''}
      </button>`).join('')}
    </div>`;

    // Filtered invoice list
    const filtered = this._tab === 'alla' ? invoices : invoices.filter(i => i.status === this._tab);
    const visibleIds = filtered.map(i => i.id);
    const selMode = SelectionModel.count() > 0;
    const listHtml = filtered.length === 0
      ? `<div class="empty">${ic('receipt',32)}<h3>${this._tab==='alla'?'Inga fakturaunderlag':'Inga '+TAB_LABELS[this._tab].toLowerCase()}</h3><p>Skapa från en klar arbetsorder</p></div>`
      : filtered.map(inv => {
          const cu = getCu(inv.customerId);
          const t  = InvoiceService.calcTotals(inv);
          const woIds = (inv.workOrderIds && inv.workOrderIds.length) ? inv.workOrderIds : (inv.workOrderId ? [inv.workOrderId] : []);
          const ao = woIds.length === 1 ? (state.workOrders||[]).find(a=>a.id===woIds[0]) : null;
          const cuName = cu ? CustomerService.displayName(cu) : null;
          const title  = inv.title || (ao ? ao.title : null);
          const selected = SelectionModel.isSelected(inv.id);
          /* SPRINT2 §32: tydligare hierarki — fakturanummer/titel överst,
             kund på egen rad, AO(er)+datum sekundärt, status+belopp höger. */
          return `<div class="list-item-v2${selMode?' sel-mode':''}${selected?' selected':''}" data-sel-row-id="${esc(inv.id)}"
            onclick="InvoicesPage._listRowClick(this)">
            <div class="list-item-v2-row">
              <div style="padding-top:2px;" onclick="event.stopPropagation()">${SelectionModel.checkboxHtml(inv.id, inv.id)}</div>
              <div class="list-item-v2-main">
                <div class="list-item-v2-title">${esc(inv.id)}${title?' — '+esc(title):''}</div>
                ${cuName ? `<div class="list-item-v2-cust">${ic('user',10)} ${esc(cuName)}</div>` : ''}
                <div class="list-item-v2-meta">
                  ${woIds.length ? `<span class="invlist-i is-link">${ic('clipboard',11)} ${woIds.length>1?woIds.length+' AO':esc(woIds[0])}</span>` : ''}
                  <span>${fmtDate(inv.createdAt)}</span>
                </div>
              </div>
              <div class="list-item-v2-aside">
                ${sbdg(inv.status)}
                <span class="invlist-amt"><b>${InvoicesPage._kr(t.total)}</b><small>inkl. moms</small></span>
              </div>
              <button type="button" class="row-open-btn" title="Öppna" aria-label="Öppna fakturaunderlag ${esc(inv.id)}" data-inv="${esc(inv.id)}" onclick="event.stopPropagation();Router.showPage('pg-inv-detail',{invoiceId:this.getAttribute('data-inv')})">${ic('chevron-right',16)}</button>
            </div>
          </div>`;
        }).join('');

    el.innerHTML = `
      ${kpiHtml}
      ${readyHtml}
      <div class="ao-tabs-row" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        ${tabHtml}
        ${filtered.length > 0 ? `<div class="ao-selall-cell">${SelectionModel.selectAllHtml(visibleIds)}</div>` : ''}
        <button class="btn bs bsm ao-export-btn" style="flex-shrink:0;" onclick="ImportExportService.showExportMenu('invoice',this)">${ic('download',14)} Exportera</button>
        <div class="ao-overflow-wrap" style="flex-shrink:0;">
          <button class="btn bs bsm ao-overflow-btn" id="ao-ovf-btn-inv" aria-label="Fler alternativ" aria-haspopup="menu" aria-expanded="false" onclick="aoToggleOverflow('ao-ovf-inv',this)">${ic('more-vertical',14)}</button>
          <div class="ao-overflow-menu" id="ao-ovf-inv" role="menu">
            <button class="ao-overflow-menu-item" role="menuitem" onclick="aoCloseOverflow();ImportExportService.showExportMenu('invoice',this)">${ic('download',13)} Exportera</button>
          </div>
        </div>
        <button class="btn bp bsm" style="flex-shrink:0;" onclick="InvoicesPage.createBlank()">${ic('plus',14)} Ny faktura</button>
      </div>
      ${listHtml}`;
  },

  /* Radklick i Fakturaunderlag-listan: id läses ur data-attributet. */
  _listRowClick(el) {
    const id = el && el.getAttribute('data-sel-row-id');
    if (!id) return;
    SelectionModel.rowClick(id, function () { Router.showPage('pg-inv-detail', { invoiceId: id }); });
  },

  _setTab(tab) {
    this._tab = tab;
    this._renderViewBody();
  },

  /* V33 §6: den gamla "Skapa ny faktura ändå"-bypassen (temporär
     ao.invoiceId=''-manipulation) är borttagen. InvoiceService.createFromAO()
     avgör nu helt själv, via BillingQueueService, om det finns tillgängliga
     source-aware candidates för AO:t — legacy-fakturerade AO:er har inga
     (BillingQueueService exkluderar dem helt), och source-aware AO:er med
     nya, ännu inte claimade sources fungerar automatiskt utan någon
     specialhantering här. Ingen risk att kringgå legacy-exkluderingen. */
  async createFromAO(aoId) {
    if (!Auth.require('invoice_create')) return;
    const result = await InvoiceService.createFromAO(aoId);
    if (!result.ok) { showToast(result.error); return; }
    showToast(`${result.invoice.id} skapat`);
    Router.showPage('pg-inv-detail', { invoiceId: result.invoice.id });
  },

  createBlank() {
    if (!Auth.require('invoice_create')) return;
    Modal.open({
      title: 'Ny faktura / redovisning',
      wide: true,
      body: `
        <div class="fg"><label>Kund</label>${CustomerPicker.render('blank-cu', { value: '', placeholder: '— Välj kund (valfritt) —' })}</div>
        <div class="fg"><label>Rubrik</label>
          <input id="blank-title" placeholder="T.ex. Tilläggsarbete, Extrakostnader…"></div>
        <div class="fg"><label>Anteckning (skrivs i dag ut på PDF:en)</label>
          <textarea id="blank-note" rows="2" placeholder="Valfri anteckning…"></textarea></div>
        <div class="fg"><label>Förfallodatum</label>
          <input type="date" id="blank-due" value="${new Date(Date.now()+30*86400000).toISOString().split('T')[0]}"></div>`,
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: async () => {
          const cuId  = document.getElementById('blank-cu')?.value || '';
          const title = document.getElementById('blank-title')?.value.trim() || '';
          const note  = document.getElementById('blank-note')?.value.trim() || '';
          const due   = document.getElementById('blank-due')?.value || '';
          const result = await InvoiceService.createBlank(cuId, { title, note, dueDate: due });
          Modal.close();
          if (!result.ok) { showToast(result.error); return; }
          Router.showPage('pg-inv-detail', { invoiceId: result.invoice.id });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  exportCSV() {
    InvoiceService.exportCSV();
    showToast('CSV exporterad');
  }
};

/* ── Fakturaunderlag-detalj ──────────────── */
const InvoiceDetailPage = {
  invoiceId: null,

  render(params) {
    const el = document.getElementById('pg-inv-detail-content');
    if (!el) return;
    const id = params && params.invoiceId;
    this.invoiceId = id;
    const inv = id ? getInv(id) : null;
    if (!inv) {
      el.innerHTML = `<div class="empty">${ic('receipt',32)}<h3>Fakturaunderlag hittades inte</h3></div>`;
      return;
    }
    this._renderFull(el, inv);
  },

  _renderFull(el, inv) {
    const cu   = getCu(inv.customerId);
    /* V34 §12: dropdownen visar bara nuvarande status + de övergångar som
       InvoiceService.getAllowedStatusTransitions() faktiskt tillåter —
       ingen egen transition-matris duplicerad i UI:t. */
    const statusOpts = [inv.status].concat(InvoiceService.getAllowedStatusTransitions(inv));
    const off  = inv.offerId ? (state.offers||[]).find(o=>o.id===inv.offerId) : null;
    const summ = InvoiceService.calcSummary(inv);
    const hasRot = summ.trAmount > 0;
    const cuName = cu ? CustomerService.displayName(cu) : '—';
    const kr = (n) => InvoicesPage._kr(n);

    /* SPRINT2 §33: en faktura kan nu representera FLERA AO (inv.workOrderIds)
       för samma kund. Legacy inv.workOrderId (singular) behålls som fält
       för bakåtkompatibla konsumenter, men hero-metan visar hela listan
       när den finns. */
    const woIds = (inv.workOrderIds && inv.workOrderIds.length) ? inv.workOrderIds : (inv.workOrderId ? [inv.workOrderId] : []);
    /* V3: ljust dokumenthuvud (.doc-head) — kund, belopp och förfallodag
       i tydlig hierarki; kopplingar till AO/offert som länkrad. Samma
       belopp och samma statusövergångar som tidigare. Navigering via
       data-attribut (inga data i inline-hanterare). */
    const docLinks = [];
    if (inv.sentAt) docLinks.push(`<span class="doc-link is-plain">${ic('send',13)} Skickad ${fmtDate(inv.sentAt)}</span>`);
    if (inv.paidAt) docLinks.push(`<span class="doc-link is-ok">${ic('check-circle',13)} Betald ${fmtDate(inv.paidAt)}</span>`);
    woIds.forEach(woId => {
      const woAo = (state.workOrders||[]).find(a=>a.id===woId);
      docLinks.push(`<a class="doc-link" href="javascript:void(0)" data-nav="pg-ao-detail" data-id="${esc(woId)}" onclick="InvoiceDetailPage._nav(this)">${ic('clipboard-list',13)} ${esc(woAo ? WorkOrderService.displayNumberOrPending(woAo) : woId)}${woAo?' – '+esc(woAo.title):''}</a>`);
    });
    if (inv.offerId) docLinks.push(`<a class="doc-link" href="javascript:void(0)" data-nav="pg-offer-detail" data-id="${esc(inv.offerId)}" onclick="InvoiceDetailPage._nav(this)">${ic('file-text',13)} Offert ${esc(inv.offerId)}${off&&off.title?' – '+esc(off.title):''}</a>`);
    const overdue = inv.dueDate && inv.dueDate < tdy() && !['betald','makulerad'].includes(inv.status);
    const addr = cu ? [cu.invoiceAddress || cu.address, cu.invoiceZip || cu.zip, cu.invoiceCity || cu.city].filter(Boolean).map(esc).join(', ') : '';

    el.innerHTML = `<div class="inv-page">
      <div class="card doc-head inv-hero">
        <div class="doc-top">
          <button class="btn bghost bsm ao-back-btn" onclick="Router.back()" title="Tillbaka">${ic('arrow-left',15)} <span class="ao-back-label">Tillbaka</span></button>
          <span class="doc-no" title="${esc(inv.id)}">${esc(inv.id)}</span>
          <div class="doc-status">
            ${sbdg(inv.status)}
            ${Auth.can('invoice_create') && statusOpts.length > 1 ? `
            <select class="doc-status-sel" aria-label="Byt status" onchange="InvoiceDetailPage.setStatus(this.value)">
              ${statusOpts.map(st=>`<option value="${esc(st)}" ${inv.status===st?'selected':''}>${st===inv.status?'Byt status':esc(statusLabel(st))}</option>`).join('')}
            </select>` : ''}
          </div>
        </div>
        <div class="doc-main">
          <div class="doc-who">
            <div class="doc-kicker">Fakturaunderlag</div>
            <h2 class="doc-title">${cu ? `<a class="doc-cust" href="javascript:void(0)" data-nav="pg-crm-detail" data-id="${esc(cu.id)}" onclick="InvoiceDetailPage._nav(this)">${esc(cuName)}</a>` : esc(cuName)}</h2>
            ${inv.title ? `<div class="doc-sub">${esc(inv.title)}</div>` : ''}
          </div>
          <div class="doc-figs">
            <div class="doc-fig"><span>Summa exkl. moms</span><b class="sm">${kr(summ.exVat)}</b></div>
            <div class="doc-fig${hasRot ? ' is-struck' : ''}"><span>Totalt inkl. moms</span><b>${kr(summ.totalInclVat)}</b></div>
            ${hasRot ? `<div class="doc-fig is-pay"><span>Kunden betalar</span><b>${kr(summ.customerPays)}</b><small>efter ${esc(String((inv.taxReduction||{}).type||'RUT/ROT').toUpperCase())}-avdrag</small></div>` : ''}
            ${inv.dueDate ? `<div class="doc-fig${overdue ? ' is-late' : ''}"><span>Förfallodatum</span><b class="sm">${fmtDate(inv.dueDate)}</b>${overdue ? '<small>Förfallodatum passerat</small>' : ''}</div>` : ''}
          </div>
        </div>
        ${this._statusHelpHtml(inv)}
        ${docLinks.length ? `<div class="doc-links">${docLinks.join('')}</div>` : ''}
      </div>

      <!-- Two-column layout -->
      <div class="inv-layout">
        <!-- Left: invoice lines -->
        <div class="inv-left">
          <div class="card">
            <div class="card-header">
              <h3>Fakturarader</h3>
              ${(Auth.can('invoice_create') && InvoiceService.canEditLines(inv)) ? `<button class="btn bs bxs" onclick="InvoiceDetailPage.openAddLine()" aria-label="Lägg till rad" title="Lägg till rad">${ic('plus',13)}</button>` : ''}
            </div>
            ${this._renderStaleLinesWarning(inv)}
            ${this._checkHtml(inv, cu)}
            <div id="inv-lines">
              ${this._renderLines(inv)}
            </div>
            ${this._renderTotals(inv)}
          </div>
          ${inv.note ? `<div class="nbox invd-note"><span class="invd-note-k">Anteckning — skrivs ut på PDF:en</span>${esc(inv.note)}</div>` : ''}
        </div>

        <!-- Right: metadata + actions + intern ekonomi -->
        <div class="inv-right">
          <div class="card">
            <div class="card-header"><h3>Faktureras till</h3>
              ${(Auth.can('invoice_create') && InvoiceService.canEditDraft(inv)) ? `<button class="btn bxs bs" onclick="InvoiceDetailPage.openEditMeta()">${ic('pencil',11)} Redigera</button>` : ''}
            </div>
            <dl class="card-body invd-facts">
              <div><dt>Kund</dt><dd>${esc(cuName)}</dd></div>
              ${cu ? `<div><dt>Adress</dt><dd>${addr || '—'}</dd></div>` : ''}
              ${cu && cu.orgNr ? `<div><dt>Org.nr</dt><dd>${esc(cu.orgNr)}</dd></div>` : ''}
              ${inv.offerId ? `<div><dt>Från offert</dt><dd><a class="link" href="javascript:void(0)" data-nav="pg-offer-detail" data-id="${esc(inv.offerId)}" onclick="InvoiceDetailPage._nav(this)">${esc(inv.offerId)}${off?' (v'+esc(off.versionNumber)+')':''}</a></dd></div>` : ''}
              ${inv.customerReference ? `<div><dt>Er referens</dt><dd>${esc(inv.customerReference)}</dd></div>` : ''}
              ${inv.ocr ? `<div><dt>OCR</dt><dd class="is-mono">${esc(inv.ocr)}</dd></div>` : ''}
            </dl>
          </div>

          <div class="card">
            <div class="card-header"><h3>Datum och villkor</h3></div>
            <div class="card-body">
              <dl class="invd-facts">
                <div><dt>Fakturadatum</dt><dd>${fmtDate(inv.createdAt)}</dd></div>
                <div><dt>Förfallodatum</dt><dd${overdue ? ' class="is-late"' : ''}>${inv.dueDate ? fmtDate(inv.dueDate) : '—'}${overdue ? ' (passerat)' : ''}</dd></div>
                <div><dt>Betalningsvillkor</dt><dd>${esc(inv.paymentTerms || 30)} dagar</dd></div>
                <div><dt>Skickad</dt><dd>${inv.sentAt ? fmtDate(inv.sentAt) : '—'}</dd></div>
                <div><dt>Betald</dt><dd${inv.paidAt ? ' class="is-ok"' : ''}>${inv.paidAt ? fmtDate(inv.paidAt) : '—'}</dd></div>
              </dl>
              <p class="invt-note">Fakturadatum är datumet då underlaget skapades — samma datum som skrivs ut på PDF:en.</p>
            </div>
          </div>

          <div class="inv-actions-card">
            ${(inv.status === 'utkast'  && Auth.can('invoice_create')) ? (InvoiceService.isSendBlockedByStalePrice(inv)
              ? `<button class="btn bs bsm inv-action-btn" style="opacity:.7;" title="Spärrad: prisavvikelse mot arbetsordern" onclick="InvoiceDetailPage.setStatus('skickad')">${ic('lock',14)} Markera skickad (spärrad)</button>`
              : `<button class="btn bp bsm inv-action-btn" onclick="InvoiceDetailPage.setStatus('skickad')">${ic('send',14)} Markera skickad</button>`) : ''}
            ${(inv.status === 'skickad' && Auth.can('invoice_create')) ? `<button class="btn bsu bsm inv-action-btn" onclick="InvoiceDetailPage.setStatus('betald')">${ic('check-circle',14)} Markera betald</button>` : ''}
            <button class="btn bs bsm inv-action-btn" onclick="InvoiceDetailPage.showPrintView()">${ic('printer',14)} PDF / Skriv ut</button>
            ${(inv.status === 'utkast' && Auth.can('invoice_create')) ? `<button class="btn bd bsm inv-action-btn" onclick="InvoiceDetailPage.deleteDraft()">${ic('trash-2',14)} Radera utkast</button>` : ''}
          </div>

          ${inv.workOrderId ? `<details class="inv-intern-wrap">
            <summary class="inv-intern-summary">${ic('trending-up',12)} Intern ekonomi <span style="font-size:10px;color:var(--mt);">${ic('eye-off',9)} Ej kundsynlig</span></summary>
            ${this._internEkonomi(inv)}
          </details>` : ''}
        </div>
      </div></div>`;
  },

  /* Navigering från länkar i detaljvyn — målet läses från data-attribut. */
  _nav(a) {
    const page = a && a.getAttribute('data-nav');
    const id = a && a.getAttribute('data-id');
    if (!page || !id) return;
    const key = { 'pg-ao-detail': 'aoId', 'pg-offer-detail': 'offerId', 'pg-crm-detail': 'customerId' }[page];
    if (!key) return;
    Router.showPage(page, { [key]: id });
  },

  /* Vad statusen betyder i VIFT (fakturaunderlag — inte en bokförd
     faktura). Endast text; statuslogiken ligger i InvoiceService. */
  _STATUS_HELP: {
    utkast: '<b>Utkast</b> — underlaget kan ändras. Rader som kommer från faktureringskön (tid, material, fastpris) är reserverade och visas inte i kön. Inget har skickats: “Markera skickad” registrerar bara att du skickat PDF:en/underlaget — VIFT skickar ingenting själv.',
    skickad: '<b>Skickad</b> — markerat som skickat till kunden (VIFT skickar ingen e-post). Raderna är låsta. Markera betald när betalningen har kommit in.',
    förfallen: '<b>Förfallen</b> — skickat men inte betalt efter förfallodatum. Statusen sätts manuellt. Raderna är låsta.',
    betald: '<b>Betald</b> — betalningen är registrerad manuellt i VIFT. Raderna är låsta.',
    makulerad: '<b>Makulerad</b> — ogiltigförklarat. Underlagen har släppts tillbaka till faktureringskön och kan faktureras på nytt. Kan återställas till utkast.'
  },

  _statusHelpHtml(inv) {
    const t = this._STATUS_HELP[inv.status];
    if (!t) return '';
    return `<div class="invd-status-help" data-status-help="${esc(inv.status)}">${ic('info',14)}<span>${t}</span></div>`;
  },

  /* Att kontrollera (endast utkast): saknade uppgifter som syns på PDF:en.
     Rena tips — de spärrar ingenting och ändrar ingen status. */
  _checkHtml(inv, cu) {
    if (inv.status !== 'utkast') return '';
    const items = [];
    const lines = inv.lines || [];
    if (!cu) items.push('Kund saknas på underlaget.');
    else if (!(cu.invoiceAddress || cu.address)) items.push('Kunden saknar adress — adressen skrivs ut på PDF:en.');
    if (!lines.length) items.push('Underlaget har inga rader.');
    const zero = lines.filter(l => l.source !== 'Fritext' && !((l.qty || 0) * (l.unitPrice || 0))).length;
    if (zero) items.push(zero === 1 ? 'En rad har 0 kr.' : zero + ' rader har 0 kr.');
    if (!inv.dueDate) items.push('Förfallodatum saknas.');
    if (!items.length) return '';
    return `<div class="invd-check" role="note"><b>${ic('info',13)} Att kontrollera innan underlaget skickas</b><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
  },

  /* STAGING-granskning 2026-11-11 (F-002/AO-002-fyndet): varnar om en
     fastprisrad inte längre matchar arbetsorderns nuvarande fixedPrice
     (t.ex. om priset rättades EFTER att fakturaunderlaget skapades). Ändrar
     aldrig beloppet — visar bara avvikelsen så den upptäcks innan fakturan
     skickas. Se InvoiceService.staleFixedPriceLines(). */
  /* F-002 HÅRD SPÄRR (2026-11-12): utökad från ren varning. Visar ALLTID
     själva avvikelsen (rad, fakturapris, AO:ns nuvarande pris) — även
     efter ett godkännande, så att det aldrig döljs att avvikelsen fanns.
       - stale + ej godkänd + kan skickas: tydligt att "Markera skickad"
         är SPÄRRAD, plus knapp för godkännande (endast behörig användare).
       - stale + godkänd: vem/när/varför bredvid avvikelsen.
       - stale + tidigare godkännande som inte längre matchar: säger det.
       - stale + redan skickad/låst: oförändrad text (kreditering m.m.). */
  _renderStaleLinesWarning(inv) {
    const st = InvoiceService.staleOverrideStatus(inv);
    if (!st.stale.length) return '';
    const sendable = InvoiceService.getAllowedStatusTransitions(inv).indexOf('skickad') !== -1;
    const lineRows = st.stale.map(x => {
      const l = (inv.lines || []).find(y => String(y.id) === x.lineId) || {};
      return `<li>${esc(l.description || x.lineId)} (${esc(x.workOrderId)}): fakturarad ${fmt(x.lineUnitPrice)} kr — arbetsorderns pris nu ${fmt(x.aoFixedPrice)} kr</li>`;
    }).join('');
    const ov = st.override;
    const ovInfo = ov ? `${esc(ov.approvedByName || 'okänd användare')}, ${esc(fmtDateTime(ov.approvedAt))}. Motivering: "${esc(ov.justification || '')}"` : '';
    let statusHtml;
    if (!sendable && inv.status !== 'utkast') {
      statusHtml = 'Denna faktura är redan skickad/låst — kontrollera manuellt om en kreditering eller ny faktura behövs.' +
        (ov ? `<div style="margin-top:6px;">Avvikelsen godkändes innan sändning av ${ovInfo}</div>` : '');
    } else if (st.covered) {
      statusHtml = `<div style="margin-top:6px;color:#92400e;"><strong>${ic('check-circle',12)} Avvikelsen är uttryckligen godkänd</strong> av ${ovInfo}<br>Fakturan kan markeras skickad med nuvarande belopp. Om arbetsorderns pris ändras igen krävs ett nytt godkännande.</div>`;
    } else {
      statusHtml = (st.supersededOverride
          ? `<div style="margin-top:6px;">Ett tidigare godkännande (${ovInfo}) gäller inte längre — avvikelsen har ändrats sedan dess.</div>`
          : '') +
        `<div style="margin-top:6px;"><strong>"Markera skickad" är spärrad</strong> tills beloppet rättats eller avvikelsen godkänts med motivering av en behörig användare. Inga belopp ändras automatiskt.</div>` +
        (InvoiceService.canApproveStaleOverride()
          ? `<button class="btn bs bxs" style="margin-top:8px;" onclick="InvoiceDetailPage.openStaleOverride()">${ic('shield-check',11)} Godkänn avvikelsen med motivering…</button>`
          : `<div style="margin-top:6px;font-size:11px;">Endast en användare med fakturerings- och administratörsbehörighet kan godkänna avvikelsen.</div>`);
    }
    const covered = st.covered;
    return `
      <div id="inv-stale-warning" style="margin:0 14px 10px;padding:10px 12px;border-radius:8px;background:${covered ? '#fffbeb' : '#fef2f2'};border:1px solid ${covered ? '#fcd34d' : '#fca5a5'};">
        <div style="display:flex;align-items:flex-start;gap:8px;">
          <span style="color:${covered ? '#b45309' : 'var(--rd)'};flex-shrink:0;margin-top:1px;">${ic('alert-triangle',15)}</span>
          <div style="font-size:12px;color:${covered ? '#78350f' : 'var(--rd)'};line-height:1.4;">
            <strong>${st.stale.length === 1 ? 'En fakturarad' : st.stale.length + ' fakturarader'} matchar inte arbetsorderns nuvarande pris.</strong>
            <ul style="margin:4px 0 0 16px;padding:0;">${lineRows}</ul>
            ${statusHtml}
          </div>
        </div>
      </div>`;
  },

  openStaleOverride() {
    const inv = getInv(this.invoiceId);
    if (!inv) return;
    if (!InvoiceService.canApproveStaleOverride()) { showToast('Du saknar behörighet att godkänna en prisavvikelse.'); return; }
    const st = InvoiceService.staleOverrideStatus(inv);
    if (!st.stale.length) { showToast('Det finns ingen prisavvikelse att godkänna.'); return; }
    const rows = st.stale.map(x => `<li>${esc(x.lineId)} (${esc(x.workOrderId)}): ${fmt(x.lineUnitPrice)} kr på fakturan, ${fmt(x.aoFixedPrice)} kr på arbetsordern</li>`).join('');
    Modal.open({
      title: 'Godkänn prisavvikelse',
      body: `
        <p style="font-size:13px;margin-bottom:8px;">Du godkänner att fakturan får markeras skickad <strong>med nuvarande belopp</strong> trots att följande rader avviker från arbetsorderns pris. Inga belopp ändras.</p>
        <ul style="font-size:12px;margin:0 0 10px 16px;">${rows}</ul>
        <div class="fg"><label>Motivering (obligatorisk, minst ${InvoiceService.STALE_OVERRIDE_MIN_JUSTIFICATION} tecken) <span style="color:var(--rd)">*</span></label>
          <textarea id="stale-ov-just" rows="3" maxlength="${InvoiceService.STALE_OVERRIDE_MAX_JUSTIFICATION}" placeholder="Varför ska det avvikande beloppet faktureras?"></textarea></div>
        <p style="font-size:11px;color:var(--mt);">Godkännandet loggas med ditt namn och tidpunkt och gäller bara exakt denna avvikelse.</p>`,
      buttons: [
        { label: 'Godkänn avvikelse', cls: 'btn bp', onClick: async (ev) => {
          const text = (document.getElementById('stale-ov-just')?.value || '').trim();
          if (text.length < InvoiceService.STALE_OVERRIDE_MIN_JUSTIFICATION) {
            showToast(`Motiveringen måste vara minst ${InvoiceService.STALE_OVERRIDE_MIN_JUSTIFICATION} tecken.`); return;
          }
          const btnEl = ev && ev.currentTarget;
          const orig = btnEl ? btnEl.innerHTML : '';
          if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = 'Sparar…'; }
          const result = await InvoiceService.approveStaleLineOverride(this.invoiceId, text);
          if (!result.ok) {
            if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = orig; }
            showToast(result.error);
            return;
          }
          Modal.close();
          showToast('Avvikelsen godkänd — fakturan kan nu markeras skickad.');
          this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* V3 6B: raderna visas EX moms med momssatsen i egen kolumn — samma
     värden som InvoiceService.calcSummary() summerar (antal × à-pris).
     Tidigare visades radbeloppet inkl. moms utan etikett (t.ex. "1 tim ×
     430 kr" och 537,50 kr) medan summan visades exkl. moms. */
  _renderLines(inv) {
    const lines = inv.lines || [];
    const canEdit = InvoiceService.canEditLines(inv) && Auth.can('invoice_create');
    if (!lines.length) return `<p style="padding:12px 14px;color:var(--mt);font-size:13px;">Inga rader</p>`;
    const kr = (n) => InvoicesPage._kr(n);
    const typeIcons = { Tid:'clock', Material:'package', Fastpris:'file-check', Manuell:'pencil', Övrigt:'more-horizontal', Fritext:'align-left' };
    const typeClss  = { Tid:'bdg-sky', Material:'bdg-orange', Fastpris:'bdg-green', Manuell:'bdg-grey', Övrigt:'bdg-grey', Fritext:'bdg-grey' };
    const acts = (l) => canEdit ? `<div class="invl-act">
        <button class="btn bxs bs" data-line="${esc(l.id)}" onclick="InvoiceDetailPage.openEditLine(this.getAttribute('data-line'))" aria-label="Redigera rad" title="Redigera rad">${ic('pencil',12)}</button>
        <button class="btn bxs bd" data-line="${esc(l.id)}" onclick="InvoiceDetailPage.deleteLine(this.getAttribute('data-line'))" aria-label="Ta bort rad" title="Ta bort rad">${ic('trash',12)}</button>
      </div>` : '<div class="invl-act"></div>';
    const rows = lines.map(l => {
      const typeIcon = typeIcons[l.source] || 'file-text';
      const typeCls  = typeClss[l.source] || 'bdg-grey';
      const badge = `<span class="bdg ${typeCls}">${ic(typeIcon,9)} ${esc(InvoiceService.sourceLabel(l))}</span>`;
      if (l.source === 'Fritext') {
        return `<div class="invl-row is-info" data-line-id="${esc(l.id)}">
          <div class="invl-desc"><b>${esc(l.freetext || l.description)}</b>${badge} <span class="invl-src">Informationsrad — inget belopp</span></div>
          ${acts(l)}
        </div>`;
      }
      const qty = Number(l.qty) || 0, price = Number(l.unitPrice) || 0;
      const ex = Math.round(qty * price * 100) / 100; /* visas i hela ören */
      const rate = InvoiceService.normalizeVatRate(l.vatRate);
      return `<div class="invl-row${ex ? '' : ' is-zero'}" data-line-id="${esc(l.id)}" data-vat="${rate}">
          <div class="invl-desc"><b>${esc(l.description)}</b>${badge}</div>
          <div class="invl-c invl-qty"><span class="invl-k">Antal</span><span>${fmt(qty)} ${esc(l.unit || '')}</span></div>
          <div class="invl-c invl-price"><span class="invl-k">À-pris exkl. moms</span><span>${kr(price)}</span></div>
          <div class="invl-c invl-vat"><span class="invl-k">Moms</span><span>${fmt(rate)} %</span></div>
          <div class="invl-c invl-amt"><span class="invl-k">Belopp exkl. moms</span><span class="invl-amt-v">${kr(ex)}</span></div>
          ${acts(l)}
        </div>`;
    }).join('');
    return `<div class="invl-scroll"><div class="invl" role="table" aria-label="Fakturarader">
      <div class="invl-head" role="row"><span>Beskrivning</span><span>Antal</span><span>À-pris exkl. moms</span><span>Moms</span><span>Belopp exkl. moms</span><span></span></div>
      ${rows}
    </div></div>`;
  },

  /* Momsen per sats, härledd ur samma rader och samma rabattkvot som
     calcSummary() (moms × (1 − rabatt/radsumma)). Endast för visning —
     totalbeloppen nedan är alltid calcSummary():s. */
  _vatBreakdown(inv, s) {
    const by = {};
    (inv.lines || []).forEach(l => {
      if (l.source === 'Fritext') return;
      const rate = InvoiceService.normalizeVatRate(l.vatRate);
      by[rate] = (by[rate] || 0) + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
    });
    const ratio = s.linesEx > 0 ? (1 - s.discAmt / s.linesEx) : 1;
    return Object.keys(by).map(Number).sort((a, b) => b - a).map(rate => ({
      rate, base: Math.round(by[rate] * ratio * 100) / 100, vat: Math.round(by[rate] * ratio * rate) / 100
    }));
  },

  _internEkonomi(inv) {
    const ao = (state.workOrders || []).find(a => a.id === inv.workOrderId);
    if (!ao) return '';
    const tb = ProfitabilityService.calcTB(ao);
    if (tb.revenue.value === 0 && tb.totalCost === 0) return '';
    const borderColor = tb.tbPct !== null ? tb.color : 'var(--br)';
    return `
      <div class="card" style="border-left:3px solid ${borderColor};">
        <div class="card-header">
          <h3>${ic('trending-up',14)} Intern ekonomi <span style="font-size:10px;color:var(--mt);margin-left:4px;">${ic('eye-off',9)} Syns ej för kund</span></h3>
          ${tb.tbPct !== null ? `<span class="bdg ${tb.badge}">${Math.round(tb.tbPct)} % TB</span>` : ''}
        </div>
        <div class="card-body" style="padding:10px 14px;">
          ${tb.incomplete ? `<div class="dr" style="color:var(--yl);font-size:12px;">Ofullständig — ${esc(tb.saknas.join(', '))} saknas</div>` : ''}
          <div class="dr"><span class="dk">Fakturerat exkl. moms</span><span class="dv">${fkr(tb.revenue.value)}</span></div>
          ${tb.material.buyEx > 0 ? `<div class="dr"><span class="dk">Material inköp</span><span class="dv" style="color:var(--rd);">${fkr(tb.material.buyEx)}</span></div>` : ''}
          ${tb.labor.cost > 0 ? `<div class="dr"><span class="dk">Intern arbetskostnad</span><span class="dv" style="color:var(--rd);">${fkr(tb.labor.cost)} <span style="font-size:10px;color:var(--mt);">(${TimeService.fmtDuration(tb.labor.minutes)} × ${fmt(tb.labor.rate)} kr/h)</span></span></div>` : ''}
          <div class="dr"><span class="dk">Total kostnad</span><span class="dv" style="color:var(--rd);font-weight:700;">${fkr(tb.totalCost)}</span></div>
          <div class="dr" style="font-size:15px;font-weight:800;border-top:2px solid var(--br);padding-top:8px;margin-top:4px;">
            <span class="dk" style="color:${tb.color};">Täckningsbidrag</span>
            <span class="dv" style="color:${tb.color};">${fkr(tb.tb)}${tb.tbPct !== null ? ` <span style="font-size:12px;">(${Math.round(tb.tbPct)} %)</span>` : ''}</span>
          </div>
          ${tb.tbPct !== null ? `<div class="dr">
            <span class="dk">TB %</span>
            <span class="dv" style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">
              <strong style="font-size:14px;color:${tb.color};">${Math.round(tb.tbPct)} %</strong>
              <span class="bdg ${tb.badge}">${esc(tb.label)}</span>
            </span>
          </div>` : ''}
        </div>
      </div>`;
  },

  _lineFormHtml(line) {
    const vatRates = [0, 6, 12, 25];
    const vatOpts  = (sel) => vatRates.map(r => `<option value="${r}" ${r===sel?'selected':''}>${r}%</option>`).join('');

    const srcToType = { 'Tid':'tid', 'Material':'mat', 'Övrigt':'ovr', 'Fastpris':'fast', 'Fritext':'fri', 'Manuell':'ovr' };
    const curSrc  = line ? (line.source || 'Manuell') : 'Manuell';
    const curType = srcToType[curSrc] || 'ovr';

    const curVat   = line ? (line.vatRate != null ? line.vatRate : 25) : 25;
    const curUnit  = line ? (line.unit  || 'st') : 'st';
    const curQty   = line ? (line.qty   != null ? line.qty : 1)  : 1;
    const curPrice = line ? (line.unitPrice != null ? line.unitPrice : 0) : 0;
    const curDesc  = line ? (line.description || '') : '';
    const curFree  = line ? (line.freetext || '') : '';

    const types = ['tid','mat','ovr','fast','fri'];
    const typeLabels = { tid:'Tid', mat:'Material', ovr:'Övrigt', fast:'Fastpris', fri:'Fritext' };

    const typeBtns = types.map(t =>
      `<button type="button" class="btn ${t===curType?'bp':'bs'} bsm" style="flex:1;padding:7px 4px;font-size:11px;"
        onclick="InvoiceDetailPage._setType('${t}')">${typeLabels[t]}</button>`
    ).join('');

    const artOpts = (state.articles||[]).filter(a=>a.active).map(a =>
      `<option value="${a.id}" data-name="${esc(a.name||'')}" data-unit="${a.unit||'st'}" data-price="${a.sellPrice||0}" data-vat="${InvoiceService.normalizeVatRate(a.vatRate)}">${a.articleNumber?a.articleNumber+' – ':''}${esc(a.name)} (${fmt(a.sellPrice||0)} kr/${a.unit||'st'})</option>`
    ).join('');

    const vis = (t) => t === curType ? '' : 'display:none';

    return `
      <input type="hidden" id="il-type" value="${curType}">
      <div style="display:flex;gap:5px;margin-bottom:12px;">${typeBtns}</div>

      <!-- Tid -->
      <div id="il-tid" style="${vis('tid')}">
        ${(state.priceGroups||[]).filter(p=>p.active).length > 0 ? `
        <div class="fg"><label>Prisgrupp (auto-fyller timpris)</label>
          <select id="il-pg-tid" onchange="InvoiceDetailPage._pgChanged()">
            <option value="">— Välj prisgrupp —</option>
            ${(state.priceGroups||[]).filter(p=>p.active).map(p =>
              `<option value="${p.id}" data-rate="${p.hourRate||0}">${esc(p.name)} – ${fmt(p.hourRate||0)} kr/tim</option>`
            ).join('')}
          </select></div>` : ''}
        <div class="fg"><label>Beskrivning</label>
          <input id="il-desc-tid" value="${curType==='tid'?esc(curDesc):''}" placeholder="Arbetstid – installation"></div>
        <div class="g2">
          <div class="fg"><label>Antal timmar</label>
            <input type="number" id="il-qty-tid" value="${curType==='tid'?curQty:1}" min="0" step="0.25"
              oninput="InvoiceDetailPage._calcLineTotals()"></div>
          <div class="fg"><label>Timpris exkl. moms (kr)</label>
            <input type="number" id="il-price-tid" value="${curType==='tid'?curPrice:0}" min="0"
              oninput="InvoiceDetailPage._calcLineTotals()"></div>
        </div>
        <div class="fg"><label>Momssats</label>
          <select id="il-vat-tid" onchange="InvoiceDetailPage._calcLineTotals()">${vatOpts(curType==='tid'?curVat:25)}</select></div>
      </div>

      <!-- Material -->
      <div id="il-mat" style="${vis('mat')}">
        ${artOpts ? `<div class="fg"><label>Välj artikel</label>
          <select id="il-article" onchange="InvoiceDetailPage._articleSelected()">
            <option value="">— Välj från artikelregister —</option>
            ${artOpts}
          </select></div>` : ''}
        <div class="fg"><label>Beskrivning</label>
          <input id="il-desc-mat" value="${curType==='mat'?esc(curDesc):''}" placeholder="T.ex. Fogmassa, Kopparrör…"></div>
        <div class="g3">
          <div class="fg"><label>Antal</label>
            <input type="number" id="il-qty-mat" value="${curType==='mat'?curQty:1}" min="0" step="${curType==='mat'?unitStep(curUnit):1}"
              oninput="InvoiceDetailPage._calcLineTotals()"></div>
          <div class="fg"><label>Enhet</label>
            <select id="il-unit-mat" onchange="InvoiceDetailPage._unitChanged('mat')">${unitsHtml(curType==='mat'?curUnit:'st')}</select></div>
          <div class="fg"><label>À-pris exkl. moms (kr)</label>
            <input type="number" id="il-price-mat" value="${curType==='mat'?curPrice:0}" min="0"
              oninput="InvoiceDetailPage._calcLineTotals()"></div>
        </div>
        <div class="fg"><label>Momssats</label>
          <select id="il-vat-mat" onchange="InvoiceDetailPage._calcLineTotals()">${vatOpts(curType==='mat'?curVat:25)}</select></div>
      </div>

      <!-- Övrigt -->
      <div id="il-ovr" style="${vis('ovr')}">
        <div class="fg"><label>Beskrivning</label>
          <input id="il-desc-ovr" value="${curType==='ovr'?esc(curDesc):''}" placeholder="T.ex. Restid, Utrustning…"></div>
        <div class="g3">
          <div class="fg"><label>Antal</label>
            <input type="number" id="il-qty-ovr" value="${curType==='ovr'?curQty:1}" min="0" step="${curType==='ovr'?unitStep(curUnit):1}"
              oninput="InvoiceDetailPage._calcLineTotals()"></div>
          <div class="fg"><label>Enhet</label>
            <select id="il-unit-ovr" onchange="InvoiceDetailPage._unitChanged('ovr')">${unitsHtml(curType==='ovr'?curUnit:'st')}</select></div>
          <div class="fg"><label>À-pris exkl. moms (kr)</label>
            <input type="number" id="il-price-ovr" value="${curType==='ovr'?curPrice:0}" min="0"
              oninput="InvoiceDetailPage._calcLineTotals()"></div>
        </div>
        <div class="fg"><label>Momssats</label>
          <select id="il-vat-ovr" onchange="InvoiceDetailPage._calcLineTotals()">${vatOpts(curType==='ovr'?curVat:25)}</select></div>
      </div>

      <!-- Fastpris -->
      <div id="il-fast" style="${vis('fast')}">
        <div class="fg"><label>Beskrivning</label>
          <input id="il-desc-fast" value="${curType==='fast'?esc(curDesc):''}" placeholder="T.ex. Avtalat pris, Årsservice…"></div>
        <div class="fg"><label>Fast pris exkl. moms (kr)</label>
          <input type="number" id="il-price-fast" value="${curType==='fast'?curPrice:0}" min="0"
            oninput="InvoiceDetailPage._calcLineTotals()"></div>
        <div class="fg"><label>Momssats</label>
          <select id="il-vat-fast" onchange="InvoiceDetailPage._calcLineTotals()">${vatOpts(curType==='fast'?curVat:25)}</select></div>
      </div>

      <!-- Fritext -->
      <div id="il-fri" style="${vis('fri')}">
        <div class="fg"><label>Fritextrad</label>
          <textarea id="il-freetext" rows="3" placeholder="Visas som informationsrad på fakturan – ingen beräkning">${esc(curFree)}</textarea></div>
      </div>

      <!-- Live-kalkyl -->
      <div id="il-calc" style="background:var(--bg);border-radius:9px;padding:10px 12px;font-size:12px;margin-top:6px;display:none;">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:var(--mt)">Summa exkl. moms</span><strong id="il-ex">0 kr</strong></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:var(--mt)">Moms</span><strong id="il-moms">0 kr</strong></div>
        <div style="display:flex;justify-content:space-between;font-weight:800;color:var(--navy);"><span>Summa inkl. moms</span><span id="il-inkl">0 kr</span></div>
      </div>`;
  },

  _setType(type) {
    const hiddenInput = document.getElementById('il-type');
    if (hiddenInput) hiddenInput.value = type;
    const panels = ['tid','mat','ovr','fast','fri'];
    panels.forEach(p => {
      const el = document.getElementById('il-' + p);
      if (el) el.style.display = p === type ? '' : 'none';
    });
    const typeLabels = { tid:'Tid', mat:'Material', ovr:'Övrigt', fast:'Fastpris', fri:'Fritext' };
    const btnContainer = document.querySelector('#il-type + div');
    if (btnContainer) {
      btnContainer.querySelectorAll('button').forEach(btn => {
        const btnType = Object.keys(typeLabels).find(k => typeLabels[k] === btn.textContent.trim());
        if (btnType) {
          btn.className = 'btn ' + (btnType === type ? 'bp' : 'bs') + ' bsm';
          btn.style.cssText = 'flex:1;padding:7px 4px;font-size:11px;';
        }
      });
    }
    const calc = document.getElementById('il-calc');
    if (calc) calc.style.display = 'none';
    if (type !== 'fri') this._calcLineTotals();
  },

  _pgChanged() {
    const sel = document.getElementById('il-pg-tid');
    if (!sel || !sel.value) return;
    const opt  = sel.options[sel.selectedIndex];
    const rate = parseFloat(opt.dataset.rate) || 0;
    const priceEl = document.getElementById('il-price-tid');
    if (priceEl) { priceEl.value = rate; this._calcLineTotals(); }
  },

  _articleSelected() {
    const sel = document.getElementById('il-article');
    if (!sel || !sel.value) return;
    const opt = sel.options[sel.selectedIndex];
    const name  = opt.dataset.name  || '';
    const unit  = opt.dataset.unit  || 'st';
    const price = parseFloat(opt.dataset.price) || 0;
    const vat   = InvoiceService.normalizeVatRate(opt.dataset.vat);
    const descEl  = document.getElementById('il-desc-mat');
    const unitEl  = document.getElementById('il-unit-mat');
    const priceEl = document.getElementById('il-price-mat');
    const vatEl   = document.getElementById('il-vat-mat');
    const qtyEl   = document.getElementById('il-qty-mat');
    if (descEl)  descEl.value  = name;
    if (priceEl) priceEl.value = price;
    if (vatEl) {
      for (let i = 0; i < vatEl.options.length; i++) {
        if (parseInt(vatEl.options[i].value) === vat) { vatEl.selectedIndex = i; break; }
      }
    }
    if (unitEl) {
      for (let i = 0; i < unitEl.options.length; i++) {
        if (unitEl.options[i].value === unit) { unitEl.selectedIndex = i; break; }
      }
    }
    if (qtyEl) qtyEl.step = unitStep(unit);
    this._calcLineTotals();
  },

  _unitChanged(panelType) {
    const t = panelType || 'ovr';
    const unitEl = document.getElementById('il-unit-' + t);
    const qtyEl  = document.getElementById('il-qty-'  + t);
    if (unitEl && qtyEl) qtyEl.step = unitStep(unitEl.value);
    this._calcLineTotals();
  },

  _calcLineTotals() {
    const type = document.getElementById('il-type')?.value || 'ovr';
    const calc = document.getElementById('il-calc');
    if (!calc || type === 'fri') { if(calc) calc.style.display='none'; return; }

    let qty = 0, price = 0, vat = 0;
    if (type === 'tid') {
      qty   = parseFloat(document.getElementById('il-qty-tid')?.value)   || 0;
      price = parseFloat(document.getElementById('il-price-tid')?.value) || 0;
      vat   = parseFloat(document.getElementById('il-vat-tid')?.value)   || 0;
    } else if (type === 'mat') {
      qty   = parseFloat(document.getElementById('il-qty-mat')?.value)   || 0;
      price = parseFloat(document.getElementById('il-price-mat')?.value) || 0;
      vat   = parseFloat(document.getElementById('il-vat-mat')?.value)   || 0;
    } else if (type === 'ovr') {
      qty   = parseFloat(document.getElementById('il-qty-ovr')?.value)   || 0;
      price = parseFloat(document.getElementById('il-price-ovr')?.value) || 0;
      vat   = parseFloat(document.getElementById('il-vat-ovr')?.value)   || 0;
    } else if (type === 'fast') {
      qty   = 1;
      price = parseFloat(document.getElementById('il-price-fast')?.value) || 0;
      vat   = parseFloat(document.getElementById('il-vat-fast')?.value)   || 0;
    }

    const ex = qty * price;
    const momsAmt = ex * vat / 100;
    if (qty > 0 || price > 0) {
      calc.style.display = '';
      document.getElementById('il-ex').textContent   = fmt(ex) + ' kr';
      document.getElementById('il-moms').textContent = fmt(momsAmt) + ' kr';
      document.getElementById('il-inkl').textContent = fmt(ex + momsAmt) + ' kr';
    } else {
      calc.style.display = 'none';
    }
  },

  _getLineData() {
    const type = document.getElementById('il-type')?.value || 'ovr';
    const typeToSource = { tid:'Tid', mat:'Material', ovr:'Övrigt', fast:'Fastpris', fri:'Fritext' };
    const source = typeToSource[type] || 'Övrigt';

    if (type === 'fri') {
      const freetext = document.getElementById('il-freetext')?.value.trim() || '';
      return { description: freetext || '(fritext)', qty: 0, unit: 'st', unitPrice: 0, vatRate: 0, source: 'Fritext', freetext };
    }
    if (type === 'tid') {
      const desc = document.getElementById('il-desc-tid')?.value.trim();
      if (!desc) { showToast('Beskrivning krävs'); return null; }
      return {
        description: desc,
        qty:       parseFloat(document.getElementById('il-qty-tid')?.value)   || 1,
        unit:      'tim',
        unitPrice: parseFloat(document.getElementById('il-price-tid')?.value) || 0,
        vatRate:   InvoiceService.normalizeVatRate(document.getElementById('il-vat-tid')?.value),
        source:    'Tid'
      };
    }
    if (type === 'mat') {
      const desc = document.getElementById('il-desc-mat')?.value.trim();
      if (!desc) { showToast('Beskrivning krävs'); return null; }
      return {
        description: desc,
        qty:       parseFloat(document.getElementById('il-qty-mat')?.value)   || 1,
        unit:      document.getElementById('il-unit-mat')?.value              || 'st',
        unitPrice: parseFloat(document.getElementById('il-price-mat')?.value) || 0,
        vatRate:   InvoiceService.normalizeVatRate(document.getElementById('il-vat-mat')?.value),
        source:    'Material'
      };
    }
    if (type === 'fast') {
      const desc = document.getElementById('il-desc-fast')?.value.trim();
      if (!desc) { showToast('Beskrivning krävs'); return null; }
      return {
        description: desc,
        qty:       1,
        unit:      'st',
        unitPrice: parseFloat(document.getElementById('il-price-fast')?.value) || 0,
        vatRate:   InvoiceService.normalizeVatRate(document.getElementById('il-vat-fast')?.value),
        source:    'Fastpris'
      };
    }
    // ovr (Övrigt)
    const desc = document.getElementById('il-desc-ovr')?.value.trim();
    if (!desc) { showToast('Beskrivning krävs'); return null; }
    return {
      description: desc,
      qty:       parseFloat(document.getElementById('il-qty-ovr')?.value)   || 1,
      unit:      document.getElementById('il-unit-ovr')?.value              || 'st',
      unitPrice: parseFloat(document.getElementById('il-price-ovr')?.value) || 0,
      vatRate:   InvoiceService.normalizeVatRate(document.getElementById('il-vat-ovr')?.value),
      source:    'Övrigt'
    };
  },

  openAddLine() {
    if (!Auth.require('invoice_create')) return;
    Modal.open({
      title: 'Lägg till rad',
      body: this._lineFormHtml(null),
      buttons: [
        { label: 'Lägg till', cls: 'btn bp', onClick: async () => {
          const data = InvoiceDetailPage._getLineData();
          if (!data) return;
          const result = await InvoiceService.addLine(this.invoiceId, data);
          if (!result.ok) { showToast(result.error); return; }
          Modal.close();
          this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => {
      InvoiceDetailPage._calcLineTotals();
      const inv = getInv(this.invoiceId);
      if (inv && inv.workOrderId) {
        const ao = (state.workOrders||[]).find(a => a.id === inv.workOrderId);
        if (ao && ao.priceGroupId) {
          const pgSel = document.getElementById('il-pg-tid');
          if (pgSel) {
            for (let i = 0; i < pgSel.options.length; i++) {
              if (pgSel.options[i].value === ao.priceGroupId) {
                pgSel.selectedIndex = i;
                InvoiceDetailPage._pgChanged();
                break;
              }
            }
          }
        }
      }
    }, 80);
  },

  openEditLine(lineId) {
    if (!Auth.require('invoice_create')) return;
    const inv  = getInv(this.invoiceId);
    const line = (inv.lines||[]).find(l=>l.id===lineId);
    if (!line) return;
    if (!InvoiceService.canEditLines(inv)) { showToast(`Fakturan är ${statusLabel(inv.status)} och kan inte ändras`); return; }
    Modal.open({
      title: 'Redigera rad',
      body: this._lineFormHtml(line),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: async () => {
          const data = InvoiceDetailPage._getLineData();
          if (!data) return;
          const result = await InvoiceService.updateLine(this.invoiceId, lineId, data);
          if (!result.ok) { showToast(result.error); return; }
          Modal.close();
          this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => { InvoiceDetailPage._calcLineTotals(); }, 80);
  },

  /* V33 §10: samma redigeringslås (InvoiceService.canEditLines — endast
     'utkast') används här som i knapp-villkoren, så UI:t aldrig visar en
     handling servicelagret ändå skulle neka. */
  deleteLine(lineId) {
    if (!Auth.require('invoice_create')) return;
    const inv = getInv(this.invoiceId);
    if (!inv) return;
    if (!InvoiceService.canEditLines(inv)) {
      showToast(`Fakturan är ${statusLabel(inv.status)} och kan inte ändras`);
      return;
    }
    const line = (inv.lines || []).find(l => l.id === lineId);
    const desc = line ? `"${line.description}"` : 'raden';
    Modal.confirm(`Ta bort ${desc}?`, async () => {
      const result = await InvoiceService.deleteLine(this.invoiceId, lineId);
      if (!result.ok) { showToast(result.error); return; }
      this._refresh();
    });
  },

  /* V33 §12: riktig delete av ett redigerbart utkast — endast synlig/
     tillåten för status 'utkast'. Efter delete: tillbaka till
     Fakturaunderlag, sources tillbaka i Att fakturera (reconciliation sker
     redan i InvoiceService.deleteDraft()). */
  deleteDraft() {
    if (!Auth.require('invoice_create')) return;
    const inv = getInv(this.invoiceId);
    if (!inv) return;
    if (inv.status !== 'utkast') { showToast('Endast utkast kan raderas.'); return; }
    Modal.confirm(`Radera utkast ${inv.id}? Detta går inte att ångra.`, async () => {
      const result = await InvoiceService.deleteDraft(this.invoiceId);
      if (!result.ok) { showToast(result.error); return; }
      showToast(`${inv.id} raderat.`);
      InvoicesPage._view = 'list';
      Router.showPage('pg-invoices');
    });
  },

  setStatus(newStatus) {
    if (!Auth.require('invoice_create')) return;
    const inv = getInv(this.invoiceId);
    if (!inv) return;
    const prev = inv.status;
    if (newStatus === prev) return;

    /* F-002 HÅRD SPÄRR: förklara spärren direkt i stället för att visa en
       "Bekräfta"-dialog som ändå skulle nekas av InvoiceService. */
    if (newStatus === 'skickad' && InvoiceService.isSendBlockedByStalePrice(inv)) {
      this._refresh(); // återställ ev. status-dropdown
      const canApprove = InvoiceService.canApproveStaleOverride();
      Modal.open({
        title: 'Fakturan kan inte markeras skickad',
        body: `<p style="font-size:13px;">En eller flera fastprisrader matchar inte arbetsorderns nuvarande pris. Rätta beloppet på fakturaraden, eller låt en behörig användare godkänna avvikelsen med en motivering.</p>`,
        buttons: (canApprove
          ? [{ label: 'Godkänn avvikelse…', cls: 'btn bp', onClick: () => { Modal.close(); setTimeout(() => this.openStaleOverride(), 50); } }]
          : []).concat([{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }])
      });
      return;
    }

    const confirmStatuses = {
      skickad:   { label: 'Markera som skickad?', detail: 'Skickat datum sätts till idag och raderna låses. VIFT skickar ingenting själv — skicka PDF:en/underlaget till kunden som vanligt.' },
      betald:    { label: 'Markera som betald?',  detail: 'Betaldatum sätts till idag. Registrerar bara att betalningen kommit in.' },
      makulerad: { label: 'Makulera fakturaunderlaget?', detail: 'Underlaget markeras som ogiltigt och dess tid, material och fastpris släpps tillbaka till faktureringskön. Kan återställas till utkast.' }
    };

    if (confirmStatuses[newStatus]) {
      const c = confirmStatuses[newStatus];
      Modal.open({
        title: c.label,
        body: `<p style="color:var(--mt);font-size:13px;">${c.detail}</p>`,
        buttons: [
          { label: 'Bekräfta', cls: 'btn bp', onClick: async () => {
            Modal.close();
            const result = await InvoiceService.setStatus(this.invoiceId, newStatus);
            if (!result.ok) { showToast(result.error); this._refresh(); return; }
            showToast(`Status: ${statusLabel(newStatus)}`);
            this._refresh();
          }},
          { label: 'Avbryt', cls: 'btn bs', onClick: () => { Modal.close(); this._refresh(); } }
        ]
      });
    } else {
      (async () => {
        const result = await InvoiceService.setStatus(this.invoiceId, newStatus);
        if (!result.ok) { showToast(result.error); this._refresh(); return; }
        showToast(`Status: ${statusLabel(newStatus)}`);
        this._refresh();
      })();
    }
  },

  _refresh() {
    const inv = getInv(this.invoiceId);
    if (!inv) return;
    this.render({ invoiceId: this.invoiceId });
  },

  /* G10: beslutsruta när en kopplad offert lovade RUT/ROT och fakturan
     saknar avdrag. Inget förs över automatiskt. */
  _renderOfferTaxNotice(inv) {
    const need = InvoiceService.taxReductionReviewNeeded(inv);
    if (!need) return '';
    const canEdit = Auth.can('invoice_create') && InvoiceService.canEditDraft(inv);
    const sum = need.reduce((s, o) => s + o.amount, 0);
    const kind = need[0].type ? need[0].type.toUpperCase() : 'RUT/ROT';
    return `<div class="inv-tr-notice" role="alert" style="margin:0 14px 10px;padding:10px 12px;border:1px solid color-mix(in srgb, var(--or) 40%, transparent);background:color-mix(in srgb, var(--or) 8%, transparent);border-radius:8px;font-size:12px;">
      <div style="font-weight:700;margin-bottom:4px;">${ic('alert-triangle',12)} Offerten angav ${kind}-avdrag — fakturan saknar avdrag</div>
      <div style="color:var(--mt);margin-bottom:8px;">Offert ${need.map(o => esc(o.offerId)).join(', ')} lovade kunden ${fkr(sum)} i avdrag. Kontrollera avdragsrätten och välj innan fakturan markeras skickad.</div>
      ${canEdit ? `<div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn bxs bp" onclick="InvoiceDetailPage.openTaxReduction(true)">${ic('percent',11)} Lägg till avdrag från offerten</button>
        <button class="btn bxs bs" onclick="InvoiceDetailPage.confirmNoTaxReduction()">Fakturera utan avdrag</button>
      </div>` : ''}
    </div>`;
  },

  async confirmNoTaxReduction() {
    const inv = getInv(this.invoiceId);
    const need = inv && InvoiceService.taxReductionReviewNeeded(inv);
    if (!need) return;
    const ok = await Modal.confirm('Fakturera utan RUT/ROT-avdrag trots att offert ' + need.map(o => o.offerId).join(', ') + ' angav avdrag? Beslutet sparas på fakturan.');
    if (!ok) return;
    showToast('Sparar…');
    const r = await InvoiceService.setTaxReduction(inv.id, 'none', 0, 0, InvoiceService.OFFER_TR_REVIEWED_PREFIX + ' inget avdrag trots offert ' + need.map(o => o.offerId).join(', '));
    if (!r.ok) { showToast(r.error || 'Beslutet kunde inte sparas'); return; }
    this._refresh();
    showToast('Sparat: fakturan skickas utan avdrag');
  },

  _renderTotals(inv) {
    const s    = InvoiceService.calcSummary(inv);
    const disc = inv.discount    || { type: 'none', value: 0 };
    const tr   = inv.taxReduction|| { type: 'none', amount: 0, note: '' };
    const hasDiscount = s.discAmt > 0;
    const hasRot      = s.trAmount > 0;
    const kr = (n) => InvoicesPage._kr(n);
    const vb = this._vatBreakdown(inv, s);
    const oneRate = vb.length === 1 ? vb[0].rate : null;
    const r2 = (v) => Math.round(v * 100) / 100;
    const rowsShown = r2((inv.lines || []).filter(l => l.source !== 'Fritext').reduce((a, l) => a + r2((Number(l.qty) || 0) * (Number(l.unitPrice) || 0)), 0));
    const rowsTarget = hasDiscount ? r2(s.linesEx) : s.exVat;
    const rowRound = r2(rowsTarget - rowsShown);
    const vatRound = vb.length > 1 ? r2(s.vat - vb.reduce((a, v) => a + v.vat, 0)) : 0;
    const signed = (v) => (v < 0 ? '− ' : '+ ') + kr(Math.abs(v));
    const roundRow = rowRound ? `<div class="invt-r is-sub" data-t="round"><span>Öresavrundning (radbeloppen visas i hela ören)</span><span>${signed(rowRound)}</span></div>` : '';
    return `${this._renderOfferTaxNotice(inv)}
      <div class="invt" id="inv-totals">
        ${roundRow}
        ${hasDiscount ? `
        <div class="invt-r" data-t="lines"><span>Summa rader exkl. moms</span><span>${kr(rowsTarget)}</span></div>
        <div class="invt-r is-disc" data-t="disc"><span>${ic('tag',11)} Rabatt${disc.type==='percent'?' '+esc(disc.value)+' %':''}</span><span>− ${kr(s.discAmt)}</span></div>
        <div class="invt-r is-strong" data-t="ex"><span>Summa exkl. moms efter rabatt</span><span>${kr(s.exVat)}</span></div>` : `
        <div class="invt-r is-strong" data-t="ex"><span>Summa exkl. moms</span><span>${kr(s.exVat)}</span></div>`}
        <div class="invt-r" data-t="vat"><span>Moms${oneRate !== null ? ' ' + fmt(oneRate) + ' %' : ''}</span><span>${kr(s.vat)}</span></div>
        ${vb.length > 1 ? vb.map(v => `<div class="invt-r is-sub" data-t="vat-part" data-rate="${v.rate}"><span>varav ${fmt(v.rate)} % av ${kr(v.base)}${hasDiscount ? ' (efter rabatt)' : ''}</span><span>${kr(v.vat)}</span></div>`).join('') : ''}
        ${vatRound ? `<div class="invt-r is-sub" data-t="vat-round"><span>varav öresavrundning</span><span>${signed(vatRound)}</span></div>` : ''}
        <div class="invt-r ${hasRot ? 'is-strong' : 'is-total'}" data-t="total"><span>Totalt inkl. moms</span><span>${kr(s.totalInclVat)}</span></div>
        ${hasRot ? `
        <div class="invt-r is-rot" data-t="rot"><span>${ic('percent',11)} ${esc(String(tr.type).toUpperCase())}-avdrag${tr.note?' ('+esc(tr.note)+')':''}</span><span>− ${kr(s.trAmount)}</span></div>
        <div class="invt-r is-pay" data-t="pay"><span>Kunden betalar</span><span>${kr(s.customerPays)}</span></div>` : ''}
        <p class="invt-note">Radbeloppen ovan är exkl. moms. Momsen läggs på per momssats${hasDiscount ? ' efter rabatten' : ''} och räknas på radernas exakta belopp.</p>
        ${(Auth.can('invoice_create') && InvoiceService.canEditDraft(inv)) ? `
        <div class="invt-tools">
          <button class="btn bxs bs" onclick="InvoiceDetailPage.openDiscount()" title="Sätt rabatt">${ic('tag',11)} Rabatt</button>
          <button class="btn bxs bs" onclick="InvoiceDetailPage.openTaxReduction()" title="RUT/ROT-avdrag">${ic('percent',11)} RUT/ROT</button>
        </div>` : ''}
      </div>`;
  },

  openEditMeta() {
    if (!Auth.require('invoice_create')) return;
    const inv = getInv(this.invoiceId);
    if (!inv) return;
    if (!InvoiceService.canEditDraft(inv)) { showToast(`Fakturan är ${statusLabel(inv.status)} och kan inte ändras.`); return; }
    Modal.open({
      title: `${ic('edit',15)} Referens & OCR`,
      body: `
        <div class="fg"><label>Er referens (visas på faktura)</label>
          <input id="em-ref" value="${esc(inv.customerReference||'')}" placeholder="T.ex. namn, projektnummer…"></div>
        <div class="fg"><label>OCR-nummer</label>
          <input id="em-ocr" value="${esc(inv.ocr||'')}" placeholder="Auto: ${inv.id.replace(/\D/g,'').padStart(6,'0')}">
          <p style="font-size:11px;color:var(--mt);margin-top:4px;">Lämna tomt för auto-genererat. Syns vid betalning.</p></div>
        <div class="fg"><label>Anteckning (skrivs i dag ut på PDF:en)</label>
          <textarea id="em-note" rows="2">${esc(inv.note||'')}</textarea></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: async () => {
          const data = {
            customerReference: document.getElementById('em-ref')?.value.trim() || '',
            ocr:               document.getElementById('em-ocr')?.value.trim() || '',
            note:              document.getElementById('em-note')?.value.trim() || ''
          };
          const result = await InvoiceService.updateMeta(this.invoiceId, data);
          if (!result.ok) { showToast(result.error); return; }
          Modal.close(); this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openDiscount() {
    if (!Auth.require('invoice_create')) return;
    const inv  = getInv(this.invoiceId);
    if (!inv) return;
    if (!InvoiceService.canEditDraft(inv)) { showToast(`Fakturan är ${statusLabel(inv.status)} och kan inte ändras.`); return; }
    const disc = inv.discount || { type: 'none', value: 0 };
    Modal.open({
      title: `${ic('tag',15)} Rabatt`,
      body: `
        <div class="fg"><label>Rabattyp</label>
          <select id="disc-type" onchange="InvoiceDetailPage._discTypeChanged()">
            <option value="none"  ${disc.type==='none'   ?'selected':''}>Ingen rabatt</option>
            <option value="percent" ${disc.type==='percent'?'selected':''}>Procent (%)</option>
            <option value="fixed"   ${disc.type==='fixed'  ?'selected':''}>Fast belopp (kr)</option>
          </select></div>
        <div id="disc-val-wrap" style="${disc.type==='none'?'display:none':''}">
          <div class="fg"><label id="disc-val-label">${disc.type==='percent'?'Rabatt %':'Rabatt kr'}</label>
            <input type="number" id="disc-value" value="${disc.type==='none'?0:disc.value}" min="0" step="${disc.type==='percent'?'1':'100'}"></div>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: async () => {
          const type  = document.getElementById('disc-type')?.value  || 'none';
          const value = parseFloat(document.getElementById('disc-value')?.value) || 0;
          const result = await InvoiceService.setDiscount(this.invoiceId, type, value);
          if (!result.ok) { showToast(result.error); return; }
          Modal.close(); this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _discTypeChanged() {
    const type = document.getElementById('disc-type')?.value;
    const wrap = document.getElementById('disc-val-wrap');
    const lbl  = document.getElementById('disc-val-label');
    if (wrap) wrap.style.display = type === 'none' ? 'none' : '';
    if (lbl)  lbl.textContent = type === 'percent' ? 'Rabatt %' : 'Rabatt kr';
  },

  openTaxReduction(fromOffer) {
    if (!Auth.require('invoice_create')) return;
    const inv = getInv(this.invoiceId);
    if (!inv) return;
    if (!InvoiceService.canEditDraft(inv)) { showToast(`Fakturan är ${statusLabel(inv.status)} och kan inte ändras.`); return; }
    let tr = inv.taxReduction || { type: 'none', amount: 0, basis: 0, note: '' };
    /* G10: förifyllt från offerten — användaren bekräftar med Spara. */
    if (fromOffer) {
      const o = (InvoiceService.offerTaxReductionFor(inv) || [])[0];
      if (o) tr = { type: o.type || 'rot', basis: o.basisExVat || 0, amount: o.amount, note: (o.type || 'ROT').toUpperCase() + ' enligt offert ' + o.offerId };
    }
    Modal.open({
      title: `${ic('percent',15)} RUT/ROT-avdrag`,
      body: `
        <div class="fg"><label>Typ av skattereduktion</label>
          <select id="tr-type" onchange="InvoiceDetailPage._trTypeChanged()">
            <option value="none" ${tr.type==='none'?'selected':''}>Ingen</option>
            <option value="rot"  ${tr.type==='rot' ?'selected':''}>ROT-avdrag (30 %)</option>
            <option value="rut"  ${tr.type==='rut' ?'selected':''}>RUT-avdrag (50 %)</option>
          </select></div>
        <div id="tr-fields" style="${tr.type==='none'?'display:none':''}">
          <div class="fg"><label>Underlag – berättigat arbete exkl. moms (kr)</label>
            <input type="number" id="tr-basis" value="${tr.basis||0}" min="0" step="100"
              oninput="InvoiceDetailPage._trCalc()"></div>
          <div style="font-size:11px;color:var(--mt);margin:-4px 0 8px;">Avdraget räknas på arbetskostnaden inkl. moms (25 %), samma regel som i offerten.</div>
          <div class="fg"><label>Avdragsbelopp (kr) <span style="color:var(--mt);font-size:11px;">— auto-beräknat, kan justeras</span></label>
            <input type="number" id="tr-amount" value="${tr.amount||0}" min="0" step="100"></div>
          <div class="fg"><label>Notering (visas på faktura)</label>
            <input id="tr-note" value="${esc(tr.note||'')}" placeholder="T.ex. ROT 30% av arbete 5 560 kr"></div>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: async () => {
          const type   = document.getElementById('tr-type')?.value || 'none';
          const basis  = parseFloat(document.getElementById('tr-basis')?.value)  || 0;
          const amount = parseFloat(document.getElementById('tr-amount')?.value) || 0;
          const note   = document.getElementById('tr-note')?.value.trim() || '';
          const result = await InvoiceService.setTaxReduction(this.invoiceId, type, amount, basis, note);
          if (!result.ok) { showToast(result.error); return; }
          Modal.close(); this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _trTypeChanged() {
    const type   = document.getElementById('tr-type')?.value;
    const fields = document.getElementById('tr-fields');
    if (fields) fields.style.display = type === 'none' ? 'none' : '';
    this._trCalc();
  },

  _trCalc() {
    const type   = document.getElementById('tr-type')?.value;
    const basis  = parseFloat(document.getElementById('tr-basis')?.value) || 0;
    const amtEl  = document.getElementById('tr-amount');
    if (!amtEl || type === 'none') return;
    const rate   = type === 'rut' ? 0.50 : 0.30;
    /* E2E ECO-01 (2026-11-23): RUT/ROT räknas på arbetskostnaden INKL.
       moms — samma regel som offerten (OffersPage._calcLineRutAmount:
       underlag exkl. moms + moms 25 % på underlaget, × 30 %/50 %). Tidigare
       räknades procenten på underlaget exkl. moms, så fakturan gav ett ~20 %
       lägre avdrag än offerten för samma arbete (791,35 kr: 237 i st.f. 297). */
    const inclVat = basis + Math.round(basis * 25 / 100);
    amtEl.value  = Math.round(inclVat * rate);
  },

  showPrintView() {
    const inv = getInv(this.invoiceId);
    if (!inv) return;
    const html = this._buildPrintHTML(inv);
    const w = window.open('', '_blank', 'width=900,height=750,scrollbars=yes');
    if (!w) { showToast('Tillåt popup för att öppna utskriftsvy'); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.print(); } catch(e) {} }, 800);
  },

  _buildPrintHTML(inv) {
    const s        = InvoiceService.calcSummary(inv);
    const cu       = getCu(inv.customerId);
    const settings = state.settings || {};
    const ao       = inv.workOrderId ? getAO(inv.workOrderId) : null;
    const off      = inv.offerId ? (state.offers||[]).find(o=>o.id===inv.offerId) : null;
    const disc     = inv.discount    || { type: 'none', value: 0 };
    const tr       = inv.taxReduction|| { type: 'none', amount: 0, note: '' };

    const logoSrc    = BrandingService.logoLightAbsolute();
    const coName     = esc(settings.companyName  || 'VIFT');
    const coOrgNr    = esc(settings.orgNr         || '');
    const coVatNr    = esc(settings.vatNr         || '');
    const coAddr     = esc(settings.companyAddress|| '');
    const coPhone    = esc(settings.companyPhone  || '');
    const coEmail    = esc(settings.companyEmail  || '');
    const bankgiro   = esc(settings.bankgiro      || '');

    const cuName     = cu ? esc(CustomerService.displayName(cu)) : '';
    const cuAddr     = cu ? [cu.invoiceAddress||cu.address, cu.invoiceZip||cu.zip, cu.invoiceCity||cu.city].filter(Boolean).map(esc).join(', ') : '';
    const cuOrgNr    = cu && cu.orgNr    ? esc(cu.orgNr)    : '';
    const cuPersonnr = cu && cu.personnr ? esc(cu.personnr) : '';

    const invDate = (inv.createdAt||'').split('T')[0] || tdy();
    const ocr     = inv.ocr || inv.id.replace(/\D/g,'').padStart(6,'0');

    const linesHtml = (inv.lines||[]).map(l => {
      /* Radbelopp exkl. moms med öre — samma värde som summeras i calcSummary()
         (tidigare avrundat till hela kronor, så raderna inte gick att stämma av mot summan). */
      const ex = (Number(l.qty)||0)*(Number(l.unitPrice)||0);
      const k2 = (n) => Number(n||0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `<tr><td>${esc(l.description)}</td><td class="r">${fmt(l.qty)}</td><td>${esc(l.unit||'')}</td><td class="r">${k2(l.unitPrice)}</td><td class="r">${InvoiceService.normalizeVatRate(l.vatRate)}%</td><td class="r">${k2(ex)}</td></tr>`;
    }).join('');

    const refs = [];
    if (ao)  refs.push('AO: ' + esc(ao.id) + (ao.title?' – '+esc(ao.title):''));
    if (off) refs.push('Offert: ' + esc(off.id) + ' (v' + (off.versionNumber||1) + ')');
    if (inv.customerReference) refs.push('Er ref: ' + esc(inv.customerReference));

    const hasDiscount = s.discAmt > 0;
    const hasRot      = s.trAmount > 0;
    const trLabel     = tr.type === 'rut' ? 'RUT-avdrag' : 'ROT-avdrag';

    return `<!DOCTYPE html><html lang="sv"><head><meta charset="UTF-8">
<title>Faktura ${esc(inv.id)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;background:#fff;padding:12mm 14mm;}
h1{font-size:22px;font-weight:900;color:#0f3763;letter-spacing:-0.5px;}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #0f3763;}
.logo{max-height:44px;max-width:150px;}
.co{font-size:10px;color:#555;line-height:1.5;margin-top:5px;}
.inv-r{text-align:right;}
.inv-num{font-size:12px;font-weight:700;color:#0f3763;margin-top:3px;}
.inv-sub{font-size:10px;color:#777;}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:10px 0;padding:10px 0;border-bottom:1px solid #e5e7eb;}
.lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#999;margin-bottom:3px;}
.pname{font-size:12px;font-weight:700;}
.paddr{font-size:10px;color:#444;line-height:1.5;margin-top:2px;}
.dbar{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px 0;background:#f8f9fb;padding:7px 10px;border-radius:5px;}
.dl{font-size:9px;color:#999;text-transform:uppercase;letter-spacing:.5px;}
.dv{font-size:11px;font-weight:700;color:#0f3763;margin-top:1px;}
.refs{font-size:10px;color:#666;margin:6px 0 8px;}
table{width:100%;border-collapse:collapse;margin:6px 0;}
thead th{background:#0f3763;color:#fff;padding:6px 8px;text-align:left;font-size:10px;font-weight:700;}
th.r,td.r{text-align:right;}
tbody td{padding:5px 8px;border-bottom:1px solid #f0f0f0;font-size:10px;}
tbody tr:last-child td{border-bottom:none;}
.totals{margin-left:auto;width:260px;margin-top:4px;}
.trow{display:flex;justify-content:space-between;padding:2px 0;font-size:11px;}
.tbold{font-weight:700;}
.tdiv{border-top:1px solid #e5e7eb;margin:3px 0;}
.tfinal{font-size:13px;font-weight:800;color:#0f3763;border-top:2px solid #0f3763;padding-top:5px;margin-top:3px;display:flex;justify-content:space-between;}
.tgreen{color:#15803d;}
.pay{margin-top:12px;padding:8px 10px;background:#f8f9fb;border-radius:5px;font-size:10px;}
.pay strong{font-size:11px;color:#0f3763;display:block;margin-bottom:3px;}
.pay-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;}
.ocr{font-size:14px;font-weight:800;font-family:monospace;letter-spacing:2px;color:#0f3763;}
.note{margin-top:8px;padding:7px 9px;background:#fffbeb;border-left:3px solid #d97706;font-size:10px;color:#555;line-height:1.4;}
.foot{margin-top:14px;padding-top:7px;border-top:1px solid #e5e7eb;font-size:9px;color:#aaa;text-align:center;}
@media print{@page{margin:10mm;size:A4;}body{padding:0;font-family:'Helvetica Neue',Arial,Helvetica,sans-serif;}}
</style></head><body>

<div class="hdr">
  <div>
    <img src="${logoSrc}" class="logo" alt="${coName}" onerror="this.style.display='none'">
    <div class="co">
      ${coAddr ? coAddr + '<br>' : ''}
      ${coPhone}${coPhone && coEmail ? ' &nbsp;·&nbsp; ' : ''}${coEmail}<br>
      ${coOrgNr ? 'Org.nr: ' + coOrgNr : ''}${coOrgNr && coVatNr ? ' &nbsp;·&nbsp; ' : ''}${coVatNr ? 'Momsreg.nr: ' + coVatNr : ''}
    </div>
  </div>
  <div class="inv-r">
    <h1>FAKTURA</h1>
    <div class="inv-num">${esc(inv.id)}</div>
    ${inv.title ? '<div class="inv-sub">' + esc(inv.title) + '</div>' : ''}
  </div>
</div>

<div class="parties">
  <div>
    <div class="lbl">Faktureras till</div>
    <div class="pname">${cuName||'—'}</div>
    <div class="paddr">${cuAddr ? cuAddr + '<br>' : ''}${cuOrgNr ? 'Org.nr: ' + cuOrgNr + '<br>' : ''}${cuPersonnr ? 'Personnr: ' + cuPersonnr : ''}</div>
  </div>
  <div>
    <div class="lbl">Leverantör</div>
    <div class="pname">${coName}</div>
    <div class="paddr">${coAddr ? coAddr + '<br>' : ''}${coOrgNr ? 'Org.nr: ' + coOrgNr : ''}</div>
  </div>
</div>

<div class="dbar">
  <div><div class="dl">Fakturanr</div><div class="dv">${esc(inv.id)}</div></div>
  <div><div class="dl">Fakturadatum</div><div class="dv">${invDate}</div></div>
  <div><div class="dl">Förfallodatum</div><div class="dv">${inv.dueDate||'—'}</div></div>
  <div><div class="dl">Betalningsvillkor</div><div class="dv">${inv.paymentTerms||30} dagar</div></div>
</div>

${refs.length ? '<div class="refs">' + refs.join(' &nbsp;·&nbsp; ') + '</div>' : ''}

<table>
  <thead><tr>
    <th>Beskrivning</th>
    <th class="r" style="width:48px">Antal</th>
    <th style="width:38px">Enhet</th>
    <th class="r" style="width:78px">À-pris exkl. moms</th>
    <th class="r" style="width:38px">Moms</th>
    <th class="r" style="width:82px">Belopp exkl. moms</th>
  </tr></thead>
  <tbody>${linesHtml}</tbody>
</table>

<div class="totals">
  ${hasDiscount ? `<div class="trow"><span>Radernas summa</span><span>${fmt(s.linesEx)} kr</span></div>
  <div class="trow tgreen"><span>Rabatt (${disc.type==='percent'?disc.value+'%':'fast belopp'})</span><span>− ${fmt(s.discAmt)} kr</span></div>
  <div class="tdiv"></div>` : ''}
  <div class="trow"><span>Summa exkl. moms</span><span>${fmt(s.exVat)} kr</span></div>
  <div class="trow"><span>Moms</span><span>${fmt(s.vat)} kr</span></div>
  <div class="tdiv"></div>
  <div class="tfinal"><span>Totalt inkl. moms</span><span>${fmt(s.totalInclVat)} kr</span></div>
  ${hasRot ? `<div class="tdiv" style="margin-top:6px;"></div>
  <div class="trow tgreen" style="margin-top:3px;"><span>${trLabel}${tr.note?' ('+esc(tr.note)+')':''}</span><span>− ${fmt(s.trAmount)} kr</span></div>
  <div class="tdiv"></div>
  <div class="tfinal"><span>Kunden betalar</span><span>${fmt(s.customerPays)} kr</span></div>` : ''}
</div>

<div class="pay">
  <strong>Betalningsinformation</strong>
  <div class="pay-grid">
    <div>
      ${bankgiro ? '<div>Bankgiro: <strong>' + bankgiro + '</strong></div>' : ''}
      <div>Betalningsvillkor: ${inv.paymentTerms||30} dagar netto</div>
    </div>
    <div>
      <div style="color:#888;font-size:9px;margin-bottom:2px;">OCR-nummer – ange vid betalning</div>
      <div class="ocr">${esc(ocr)}</div>
    </div>
  </div>
</div>

${inv.note ? '<div class="note">' + esc(inv.note) + '</div>' : ''}

<div class="foot">${coName}${coOrgNr?' &nbsp;·&nbsp; Org.nr: '+coOrgNr:''}${coVatNr?' &nbsp;·&nbsp; Momsreg.nr: '+coVatNr:''}</div>
</body></html>`;
  }
};
