/**
 * Dashboard — Startsida och styrbord
 * KPI, att-göra, snabbknappar, säljchanser, aktivitet
 */

const Dashboard = {

  render() {
    const el = document.getElementById('dash-content');
    if (!el) return;

    const kpis   = this._calcKPIs();
    const todos  = this._calcTodos();
    const active = SalesService.getActive();
    const acts   = ActivityService.getRecent(6);

    el.innerHTML = `
      <!-- KPI-rutor -->
      <div class="dash-full">
        <div class="kpi-grid">
          ${this._renderKPI(kpis.activeOrders,    'Aktiva ordrar',      'blue',   'pg-ao')}
          ${this._renderKPI(kpis.doneThisMonth,   'Klara denna månad',  'green',  'pg-ao')}
          ${this._renderKPI(kpis.openOffers,      'Offerter ute',       '',       'pg-offer')}
          ${this._renderKPI(kpis.workPool,        'Arbetspool',         'purple', 'pg-ao')}
        </div>
      </div>

      <!-- Att göra / Kräver åtgärd -->
      ${todos.length > 0 ? `
      <div class="dash-full">
        <div class="card">
          <div class="card-header">
            <h3>⚡ Kräver åtgärd</h3>
            <span class="bdg bdg-red">${todos.length}</span>
          </div>
          <div class="card-body" style="padding:8px 10px;">
            <div class="todo-list">
              ${todos.map(t => this._renderTodo(t)).join('')}
            </div>
          </div>
        </div>
      </div>` : ''}

      <!-- Snabbknappar -->
      <div class="dash-full">
        <div class="card">
          <div class="card-header"><h3>Snabbknappar</h3></div>
          <div class="card-body">
            <div class="quick-grid">
              ${this._quickBtn('📋', 'Ny order',   "Dashboard.newWorkOrder()")}
              ${this._quickBtn('📄', 'Ny offert',  "Router.showPage('pg-offer')")}
              ${this._quickBtn('👥', 'Ny kund',    "Dashboard.newCustomer()")}
              ${this._quickBtn('🔍', 'Rondering',  "Router.showPage('pg-rondering')")}
              ${this._quickBtn('⏱', 'Stämpla',    "Router.showPage('pg-tid')")}
              ${this._quickBtn('💰', 'Fakturering',"Router.showPage('pg-invoices')")}
            </div>
          </div>
        </div>
      </div>

      <!-- Idag -->
      <div>
        <div class="card">
          <div class="card-header"><h3>📅 Idag</h3></div>
          <div class="card-body" style="padding:6px 14px;">
            ${this._renderToday()}
          </div>
        </div>
      </div>

      <!-- Säljchanser -->
      <div>
        <div class="card">
          <div class="card-header">
            <h3>🎯 Säljchanser</h3>
            ${active.length > 0 ? `<span class="bdg bdg-orange">${active.length}</span>` : ''}
          </div>
          <div class="card-body" style="padding:8px 10px;">
            ${active.length === 0
              ? '<div class="empty" style="padding:16px;"><span class="empty-ico">🎯</span><p>Inga aktiva säljchanser</p></div>'
              : active.slice(0, 4).map(o => SalesService.renderDashCard(o)).join('')
            }
            ${active.length > 4
              ? `<button class="btn bs bfull" style="margin-top:8px;" onclick="Dashboard.showAllSales()">Visa alla ${active.length} säljchanser</button>`
              : ''}
          </div>
        </div>
      </div>

      <!-- Offerter väntar svar -->
      <div>
        <div class="card">
          <div class="card-header"><h3>📄 Offerter väntar svar</h3></div>
          <div class="card-body" style="padding:6px 14px;">
            ${this._renderPendingOffers()}
          </div>
        </div>
      </div>

      <!-- Arbetspool -->
      <div>
        <div class="card">
          <div class="card-header"><h3>🗂 Arbetspool</h3></div>
          <div class="card-body" style="padding:6px 14px;">
            ${this._renderPool()}
          </div>
        </div>
      </div>

      <!-- Senaste aktivitet -->
      <div>
        <div class="card">
          <div class="card-header"><h3>🕐 Senaste aktivitet</h3></div>
          <div class="card-body" style="padding:8px 10px;">
            ${ActivityService.renderList(acts)}
          </div>
        </div>
      </div>
    `;
  },

  _calcKPIs() {
    const today     = tdy();
    const monthStr  = today.substring(0, 7); // YYYY-MM

    const aos = state.workOrders || [];
    return {
      activeOrders: aos.filter(a => ['nytt','pool','planerad','pågående'].includes(a.status)).length,
      doneThisMonth: aos.filter(a => a.status === 'klar' && (a.completedAt || '').startsWith(monthStr)).length,
      openOffers:   (state.offers || []).filter(o => ['skickad','väntar'].includes(o.status)).length,
      workPool:     aos.filter(a => a.status === 'pool').length
    };
  },

  _calcTodos() {
    const todos  = [];
    const today  = tdy();
    const week   = new Date(Date.now() - 7 * 24 * 3600000).toISOString().split('T')[0];
    const aos    = state.workOrders || [];
    const offers = state.offers || [];

    // Akuta ordrar
    const akut = aos.filter(a => a.priority === 'akut' && !['klar','fakturerad','avbruten'].includes(a.status));
    if (akut.length > 0) {
      todos.push({
        icon: '🚨', iconCls: 'red',
        title: 'Akuta ordrar kräver åtgärd',
        sub: akut.map(a => a.title).join(', '),
        badge: akut.length, badgeCls: '',
        onClick: "Router.showPage('pg-ao')"
      });
    }

    // Klara ordrar redo för fakturering
    const readyBill = aos.filter(a => a.status === 'klar' && !a.invoiceId);
    if (readyBill.length > 0) {
      todos.push({
        icon: '💰', iconCls: 'green',
        title: 'Ordrar redo för fakturering',
        sub: `${readyBill.length} klar${readyBill.length === 1 ? '' : 'a'} order${readyBill.length === 1 ? '' : 'ar'} saknar fakturaunderlag`,
        badge: readyBill.length, badgeCls: 'blue',
        onClick: "Router.showPage('pg-invoices')"
      });
    }

    // Offerter utan svar 7+ dagar
    const staleOffers = offers.filter(o =>
      o.status === 'skickad' && o.sentAt && o.sentAt.split('T')[0] <= week
    );
    if (staleOffers.length > 0) {
      todos.push({
        icon: '📄', iconCls: 'orange',
        title: 'Offert utan svar i 7+ dagar',
        sub: staleOffers.map(o => {
          const cu = getCu(o.customerId);
          return cu ? (cu.name || `${cu.firstName} ${cu.lastName}`.trim()) : o.id;
        }).join(', '),
        badge: staleOffers.length, badgeCls: 'orange',
        onClick: "Router.showPage('pg-offer')"
      });
    }

    // Säljchanser att agera på
    const salesCount = SalesService.getActive().length;
    if (salesCount > 0) {
      todos.push({
        icon: '🎯', iconCls: 'purple',
        title: 'Säljchanser att agera på',
        sub: `${salesCount} aktiv${salesCount === 1 ? '' : 'a'} säljchans${salesCount === 1 ? '' : 'er'}`,
        badge: salesCount, badgeCls: 'purple',
        onClick: "document.getElementById('dash-sales').scrollIntoView({behavior:'smooth'})"
      });
    }

    // Försenade AO (planerade förbi datum)
    const late = aos.filter(a =>
      a.status === 'planerad' && a.scheduledDate && a.scheduledDate < today
    );
    if (late.length > 0) {
      todos.push({
        icon: '⚠️', iconCls: 'orange',
        title: 'Försenade arbetsorder',
        sub: late.map(a => a.title).slice(0, 2).join(', ') + (late.length > 2 ? ` +${late.length - 2} till` : ''),
        badge: late.length, badgeCls: 'orange',
        onClick: "Router.showPage('pg-ao')"
      });
    }

    return todos;
  },

  _renderKPI(value, label, color, page) {
    return `
      <div class="kpi-card ${color}" onclick="Router.showPage('${page}')">
        <div class="kpi-number">${value}</div>
        <div class="kpi-label">${label}</div>
      </div>`;
  },

  _renderTodo(t) {
    return `
      <div class="todo-item" onclick="${t.onClick}">
        <div class="todo-icon ${t.iconCls}">${t.icon}</div>
        <div class="todo-text">
          <div class="todo-title">${t.title}</div>
          ${t.sub ? `<div class="todo-sub">${t.sub}</div>` : ''}
        </div>
        <span class="todo-badge ${t.badgeCls}">${t.badge}</span>
      </div>`;
  },

  _quickBtn(icon, label, onclick) {
    return `
      <button class="quick-btn" onclick="${onclick}">
        <div class="quick-icon">${icon}</div>
        <span class="quick-label">${label}</span>
      </button>`;
  },

  _renderToday() {
    const today = tdy();
    const todayAOs = (state.workOrders || []).filter(a =>
      a.scheduledDate === today && !['klar','fakturerad','avbruten'].includes(a.status)
    );

    if (todayAOs.length === 0) {
      return '<div class="empty" style="padding:12px 0;"><span class="empty-ico">📅</span><p>Inga planerade ordrar idag</p></div>';
    }

    return todayAOs.map(ao => {
      const cu = getCu(ao.customerId);
      const cuName = cu ? (cu.name || `${cu.firstName} ${cu.lastName}`.trim()) : '—';
      return `
        <div class="crow" onclick="Router.showPage('pg-ao-detail', {aoId: '${ao.id}'})">
          <div>
            <div style="font-size:14px;font-weight:700;">${ao.title}</div>
            <div style="font-size:11px;color:var(--mt);">${cuName} · ${ao.scheduledStart || '?'}–${ao.scheduledEnd || '?'}</div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${sbdg(ao.status)}
            ${pbdg(ao.priority)}
          </div>
        </div>`;
    }).join('');
  },

  _renderPendingOffers() {
    const pending = (state.offers || []).filter(o => ['skickad','väntar'].includes(o.status));
    if (pending.length === 0) {
      return '<div class="empty" style="padding:12px 0;"><span class="empty-ico">📄</span><p>Inga offerter väntar svar</p></div>';
    }
    return pending.slice(0, 4).map(o => {
      const cu = getCu(o.customerId);
      const cuName = cu ? (cu.name || `${cu.firstName} ${cu.lastName}`.trim()) : '—';
      const total = (o.lines || []).reduce((s, l) => s + (l.total || 0), 0);
      const age   = o.sentAt ? Math.floor((Date.now() - new Date(o.sentAt)) / 86400000) : null;
      return `
        <div class="crow" onclick="Router.showPage('pg-offer-detail', {offerId: '${o.id}'})">
          <div>
            <div style="font-size:13px;font-weight:700;">${o.id} – ${cuName}</div>
            <div style="font-size:11px;color:var(--mt);">${fmt(total)} kr · ${age !== null ? `${age} dagar sedan` : 'Ej skickad'}</div>
          </div>
          ${sbdg(o.status)}
        </div>`;
    }).join('');
  },

  _renderPool() {
    const pool = (state.workOrders || []).filter(a => a.status === 'pool');
    if (pool.length === 0) {
      return '<div class="empty" style="padding:12px 0;"><span class="empty-ico">🗂</span><p>Arbetspoolen är tom</p></div>';
    }
    return pool.slice(0, 4).map(ao => {
      const cu = getCu(ao.customerId);
      const cuName = cu ? (cu.name || `${cu.firstName} ${cu.lastName}`.trim()) : '—';
      return `
        <div class="crow" onclick="Router.showPage('pg-ao-detail', {aoId: '${ao.id}'})">
          <div>
            <div style="font-size:13px;font-weight:700;">${ao.title}</div>
            <div style="font-size:11px;color:var(--mt);">${cuName}</div>
          </div>
          ${pbdg(ao.priority)}
        </div>`;
    }).join('');
  },

  showAllSales() {
    const active = SalesService.getActive();
    Modal.open({
      title: `Alla säljchanser (${active.length})`,
      body: active.map(o => SalesService.renderDashCard(o)).join('') || '<p style="color:var(--mt)">Inga aktiva</p>'
    });
  },

  newWorkOrder() {
    // Placeholder – fylls ut i Fas 2
    showToast('Ny arbetsorder – kommer i nästa fas');
    Router.showPage('pg-ao');
  },

  newCustomer() {
    // Placeholder – fylls ut i Fas 2
    showToast('Ny kund – kommer i nästa fas');
    Router.showPage('pg-crm');
  }
};
