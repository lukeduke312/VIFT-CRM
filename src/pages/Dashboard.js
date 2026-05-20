/**
 * Dashboard — Startsida och styrbord
 * KPI, att-göra, snabbknappar, säljchanser, aktivitet
 */

const Dashboard = {

  render() {
    const el = document.getElementById('dash-content');
    if (!el) return;

    const kpis     = this._calcKPIs();
    const todos    = this._calcTodos();
    const active   = SalesService.getActive();
    const acts     = ActivityService.getRecent(6);
    const recurring = (state.recurringOrders || []).filter(r => {
      if (r.status !== 'aktiv' || !r.nextDate) return false;
      const days = Math.ceil((new Date(r.nextDate) - new Date(tdy())) / 86400000);
      return days <= 7;
    });

    el.innerHTML = `
      <!-- KPI strip -->
      <div class="kpi-grid">
        ${this._renderKPI(kpis.activeOrders,    'Aktiva ordrar',      'blue',   'pg-ao')}
        ${this._renderKPI(kpis.doneThisMonth,   'Klara denna månad',  'green',  'pg-ao')}
        ${this._renderKPI(kpis.openOffers,      'Offerter ute',       '',       'pg-offer')}
        ${this._renderKPI(kpis.workPool,        'Arbetspool',         'purple', 'pg-ao')}
      </div>

      <!-- Kräver åtgärd -->
      ${todos.length > 0 ? `
      <div class="card" style="border-left:3px solid var(--rd);">
        <div class="card-header">
          <h3 style="color:var(--rd);">${ic('alert-triangle',14)} Kräver åtgärd</h3>
          <span class="bdg bdg-red">${todos.length}</span>
        </div>
        <div class="card-body" style="padding:6px 10px;">
          ${todos.map(t => this._renderTodo(t)).join('')}
        </div>
      </div>` : ''}

      <!-- Snabbknappar -->
      <div class="card">
        <div class="card-header"><h3>${ic('activity',14)} Snabbåtgärder</h3></div>
        <div class="card-body">
          <div class="quick-grid">
            ${this._quickBtn('clipboard-list', 'Ny order',      "WorkOrdersPage.openCreate()")}
            ${this._quickBtn('file-text',      'Ny offert',     "Router.showPage('pg-offer')")}
            ${this._quickBtn('users',          'Ny kund',       "CustomersPage.openCreate()")}
            ${this._quickBtn('refresh-cw',     'Återkommande',  "Router.showPage('pg-recurring')")}
            ${this._quickBtn('clock',          'Stämpla',       "Router.showPage('pg-tid')")}
            ${this._quickBtn('receipt',        'Fakturering',   "Router.showPage('pg-invoices')")}
          </div>
        </div>
      </div>

      <!-- 2-kolumns grid -->
      <div class="dash-grid">

        <!-- Idag -->
        <div>
          <div class="card">
            <div class="card-header">
              <h3>${ic('calendar',14)} Idag</h3>
              <span style="font-size:11px;font-weight:600;color:var(--mt);">${new Date().toLocaleDateString('sv-SE',{weekday:'long',day:'numeric',month:'long'})}</span>
            </div>
            <div class="card-body" style="padding:6px 14px;">
              ${this._renderToday()}
            </div>
          </div>
        </div>

        <!-- Offerter väntar svar -->
        <div>
          <div class="card">
            <div class="card-header">
              <h3>${ic('file-text',14)} Offerter väntar svar</h3>
              ${kpis.openOffers>0?`<span class="bdg bdg-orange">${kpis.openOffers}</span>`:''}
            </div>
            <div class="card-body" style="padding:6px 14px;">
              ${this._renderPendingOffers()}
            </div>
          </div>
        </div>

        <!-- Återkommande snart -->
        ${recurring.length > 0 ? `
        <div>
          <div class="card" style="border-left:3px solid var(--sky);">
            <div class="card-header">
              <h3>${ic('refresh-cw',14)} Återkommande snart</h3>
              <span class="bdg bdg-sky">${recurring.length}</span>
            </div>
            <div class="card-body" style="padding:6px 14px;">
              ${recurring.slice(0,4).map(r => {
                const days = Math.ceil((new Date(r.nextDate) - new Date(tdy())) / 86400000);
                const cu = getCu(r.customerId);
                return `<div class="crow" onclick="Router.showPage('pg-recurring')">
                  <div>
                    <div style="font-size:13px;font-weight:700;">${r.title}</div>
                    <div style="font-size:11px;color:var(--mt);">${cu?CustomerService.displayName(cu):'—'}</div>
                  </div>
                  <span class="bdg ${days<=0?'bdg-red':'bdg-orange'}">${days<=0?'Förfallen':days===0?'Idag':days+' d'}</span>
                </div>`;
              }).join('')}
            </div>
          </div>
        </div>` : ''}

        <!-- Säljchanser -->
        <div>
          <div class="card">
            <div class="card-header">
              <h3>${ic('target',14)} Säljchanser</h3>
              ${active.length > 0 ? `<span class="bdg bdg-purple">${active.length}</span>` : ''}
            </div>
            <div class="card-body" style="padding:8px 10px;">
              ${active.length === 0
                ? `<div class="empty" style="padding:16px;">${ic('target',28)}<p>Inga aktiva säljchanser</p></div>`
                : active.slice(0, 3).map(o => SalesService.renderDashCard(o)).join('')}
              ${active.length > 3
                ? `<button class="btn bs bfull" style="margin-top:8px;" onclick="Dashboard.showAllSales()">Visa alla ${active.length} →</button>`
                : ''}
            </div>
          </div>
        </div>

        <!-- Arbetspool -->
        <div>
          <div class="card">
            <div class="card-header">
              <h3>${ic('clipboard-list',14)} Arbetspool</h3>
              ${kpis.workPool>0?`<span class="bdg bdg-purple">${kpis.workPool}</span>`:''}
            </div>
            <div class="card-body" style="padding:6px 14px;">
              ${this._renderPool()}
            </div>
          </div>
        </div>

        <!-- Senaste aktivitet -->
        <div class="dash-full">
          <div class="card">
            <div class="card-header"><h3>${ic('activity',14)} Senaste aktivitet</h3></div>
            <div class="card-body" style="padding:8px 10px;">
              ${ActivityService.renderList(acts)}
            </div>
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
        icon: 'alert-triangle', iconCls: 'red',
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
        icon: 'receipt', iconCls: 'green',
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
        icon: 'file-text', iconCls: 'orange',
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
        icon: 'target', iconCls: 'purple',
        title: 'Säljchanser att agera på',
        sub: `${salesCount} aktiv${salesCount === 1 ? '' : 'a'} säljchans${salesCount === 1 ? '' : 'er'}`,
        badge: salesCount, badgeCls: 'purple',
        onClick: "Router.showPage('pg-offer')"
      });
    }

    // Försenade AO (planerade förbi datum)
    const late = aos.filter(a =>
      a.status === 'planerad' && a.scheduledDate && a.scheduledDate < today
    );
    if (late.length > 0) {
      todos.push({
        icon: 'alert-triangle', iconCls: 'orange',
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
        <div class="todo-icon ${t.iconCls}">${ic(t.icon, 16)}</div>
        <div class="todo-text">
          <div class="todo-title">${t.title}</div>
          ${t.sub ? `<div class="todo-sub">${t.sub}</div>` : ''}
        </div>
        <span class="todo-badge ${t.badgeCls}">${t.badge}</span>
      </div>`;
  },

  _quickBtn(iconName, label, onclick) {
    return `
      <button class="quick-btn" onclick="${onclick}">
        <div class="quick-icon">${ic(iconName, 22)}</div>
        <span class="quick-label">${label}</span>
      </button>`;
  },

  _renderToday() {
    const today = tdy();
    const todayAOs = (state.workOrders || []).filter(a =>
      a.scheduledDate === today && !['klar','fakturerad','avbruten'].includes(a.status)
    );

    if (todayAOs.length === 0) {
      return `<div class="empty" style="padding:12px 0;">${ic('calendar',28)}<p>Inga planerade ordrar idag</p></div>`;
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
      return `<div class="empty" style="padding:12px 0;">${ic('file-text',28)}<p>Inga offerter väntar svar</p></div>`;
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
      return `<div class="empty" style="padding:12px 0;">${ic('clipboard-list',28)}<p>Arbetspoolen är tom</p></div>`;
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
    Router.showPage('pg-ao');
    setTimeout(() => WorkOrdersPage.openCreate(), 50);
  },

  newCustomer() {
    Router.showPage('pg-crm');
    setTimeout(() => CustomersPage.openCreate(), 50);
  }
};
