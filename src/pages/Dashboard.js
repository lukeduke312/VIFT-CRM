/**
 * Dashboard — Operativ startsida
 */

const Dashboard = {

  render() {
    const el = document.getElementById('dash-content');
    if (!el) return;

    const todos     = this._calcTodos();
    const recurring = this._recurringDue();

    el.innerHTML =
      '<div class="dash-layout">' +

      // 1. KPI row
      '<div class="dw-full">' + this._widgetKpi() + '</div>' +

      // 2. Kräver åtgärd (only when items exist)
      (todos.length > 0 ? '<div class="dw-full">' + this._widgetTodos(todos) + '</div>' : '') +

      // 3. Snabbknappar — compact strip above the work sections
      '<div class="dw-full">' + this._widgetQuickbtns() + '</div>' +

      // 4. Drift: Idag | Pool | Återkommande snart
      '<div class="dw-third">' + this._widgetToday() + '</div>' +
      '<div class="dw-third">' + this._widgetPool() + '</div>' +
      '<div class="dw-third">' + (recurring.length > 0 ? this._widgetRecurring(recurring) : this._widgetPlanned()) + '</div>' +

      // 5. Affär: Säljchanser | Offerter | Senaste aktivitet
      '<div class="dw-third">' + this._widgetSales() + '</div>' +
      '<div class="dw-third">' + this._widgetOffers() + '</div>' +
      '<div class="dw-third">' + this._widgetActivity() + '</div>' +

      '</div>';
  },

  /* ── KPI ─────────────────────────────────── */
  _widgetKpi() {
    const kpis = this._calcKPIs();
    return `<div class="kpi-row">
      ${this._kpi(kpis.activeOrders, 'Aktiva ordrar',       'blue',   "Router.showPage('pg-ao',{filter:'active'})")}
      ${this._kpi(kpis.doneThisMonth,'Klara denna månad',   'green',  "Router.showPage('pg-ao',{filter:'klar'})")}
      ${this._kpi(kpis.readyBill,    'Redo fakturering',    'orange', "Router.showPage('pg-ao',{filter:'readyForInvoice'})")}
      ${this._kpi(kpis.openOffers,   'Offerter ute',        '',       "Router.showPage('pg-offer')")}
      ${this._kpi(kpis.salesActive,  'Säljchanser',         'purple', "Router.showPage('pg-sales')")}
    </div>`;
  },

  _kpi(value, label, color, onclick) {
    return `<div class="kpi-card ${color}" onclick="${onclick}">
      <div class="kpi-number">${value}</div>
      <div class="kpi-label">${label}</div>
    </div>`;
  },

  /* ── Kräver åtgärd ───────────────────────── */
  _widgetTodos(todos) {
    return `<div class="card" style="border-left:3px solid var(--rd);">
      <div class="card-header">
        <h3 class="ch3r">${ic('alert-triangle',14)} Kräver åtgärd</h3>
        <span class="bdg bdg-red">${todos.length}</span>
      </div>
      <div class="card-body" style="padding:8px 10px;">
        <div class="dash-action-list">
          ${todos.map(t => this._actionItem(t)).join('')}
        </div>
      </div>
    </div>`;
  },

  _actionItem(t) {
    return `<div class="dash-action-item ${t.cls||''}" onclick="${t.onClick}">
      <div class="dai-icon ${t.iconCls}">${ic(t.icon, 15)}</div>
      <div class="dai-text">
        <div class="dai-title">${t.title}</div>
        ${t.sub ? `<div class="dai-sub">${t.sub}</div>` : ''}
      </div>
      <span class="dai-badge ${t.badgeCls||''}">${t.badge}</span>
      <span style="color:var(--mt);font-size:11px;flex-shrink:0;">${ic('chevron-right',12)}</span>
    </div>`;
  },

  /* ── Snabbknappar ─────────────────────────── */
  _widgetQuickbtns() {
    return `<div class="card">
      <div class="card-header"><h3 class="ch3">${ic('zap',14)} Snabbåtgärder</h3></div>
      <div class="card-body" style="padding:8px 12px;">
        <div class="quick-row">
          ${this._qbtn('clipboard-list','Ny order',     "Router.showPage('pg-ao');setTimeout(()=>WorkOrdersPage.openCreate(),80)")}
          ${this._qbtn('file-text',     'Ny offert',    "Router.showPage('pg-offer')")}
          ${this._qbtn('users',         'Ny kund',      "Router.showPage('pg-crm');setTimeout(()=>CustomersPage.openCreate(),80)")}
          ${this._qbtn('refresh-cw',    'Återkommande', "Router.showPage('pg-recurring')")}
          ${this._qbtn('clock',         'Stämpla tid',  "Router.showPage('pg-tid')")}
          ${this._qbtn('receipt',       'Fakturering',  "Router.showPage('pg-invoices')")}
        </div>
      </div>
    </div>`;
  },

  _qbtn(icon, label, onclick) {
    return `<button class="quick-btn" onclick="${onclick}">
      <div class="quick-icon">${ic(icon, 18)}</div>
      <span class="quick-label">${label}</span>
    </button>`;
  },

  /* ── Idag ─────────────────────────────────── */
  _widgetToday() {
    const today   = tdy();
    const todayAOs = (state.workOrders||[]).filter(a =>
      a.scheduledDate === today && !['klar','fakturerad','avbruten'].includes(a.status)
    );
    const dateStr = new Date().toLocaleDateString('sv-SE',{weekday:'long',day:'numeric',month:'short'});
    return `<div class="card">
      <div class="card-header">
        <h3 class="ch3">${ic('calendar',14)} Idag</h3>
        <span style="font-size:10px;color:var(--mt);font-weight:600;text-transform:capitalize;">${dateStr}</span>
      </div>
      <div class="card-body">
        ${todayAOs.length === 0
          ? `<div class="empty" style="padding:12px 0;gap:4px;">${ic('calendar',22)}<p style="font-size:11px;text-align:center;">Inga planerade ordrar idag</p></div>`
          : todayAOs.slice(0,5).map(ao => {
              var cu = getCu(ao.customerId);
              return `<div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
                <div style="min-width:0;flex:1;">
                  <div class="crow-title">${ao.title}</div>
                  <div class="crow-sub">${ao.scheduledStart||'?'}–${ao.scheduledEnd||'?'} · ${cu?CustomerService.displayName(cu):'—'}</div>
                </div>
                ${sbdg(ao.status)}
              </div>`;
            }).join('')
        }
        ${todayAOs.length > 5 ? `<button class="btn bghost bfull bsm" style="margin-top:4px;" onclick="Router.showPage('pg-ao',{filter:'idag'})">+${todayAOs.length-5} till idag</button>` : ''}
        <button class="btn bghost bfull bsm" style="margin-top:4px;" onclick="Router.showPage('pg-ao',{filter:'idag'})">
          ${ic('list',11)} Alla ordrar idag
        </button>
      </div>
    </div>`;
  },

  /* ── Arbetspool ───────────────────────────── */
  _widgetPool() {
    const pool = (state.workOrders||[]).filter(a => a.status === 'pool');
    return `<div class="card">
      <div class="card-header">
        <h3 class="ch3">${ic('inbox',14)} Arbetspool</h3>
        ${pool.length > 0 ? `<span class="bdg bdg-purple">${pool.length}</span>` : ''}
      </div>
      <div class="card-body">
        ${pool.length === 0
          ? `<div class="empty" style="padding:12px 0;gap:4px;">${ic('inbox',22)}<p style="font-size:11px;text-align:center;">Arbetspoolen är tom</p></div>`
          : pool.slice(0,5).map(ao => {
              var cu = getCu(ao.customerId);
              return `<div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
                <div style="min-width:0;flex:1;">
                  <div class="crow-title">${ao.title}</div>
                  <div class="crow-sub">${cu?CustomerService.displayName(cu):'—'}</div>
                </div>
                ${pbdg(ao.priority)}
              </div>`;
            }).join('')
        }
        ${pool.length > 5 ? `<button class="btn bghost bfull bsm" style="margin-top:4px;" onclick="Router.showPage('pg-ao',{filter:'pool'})">+${pool.length-5} i poolen</button>` : ''}
      </div>
    </div>`;
  },

  /* ── Återkommande snart ───────────────────── */
  _widgetRecurring(recurring) {
    return `<div class="card" style="border-left:3px solid var(--sky);">
      <div class="card-header">
        <h3 class="ch3">${ic('refresh-cw',14)} Återkommande snart</h3>
        <span class="bdg bdg-sky">${recurring.length}</span>
      </div>
      <div class="card-body">
        ${recurring.slice(0,5).map(r => {
          var days = Math.ceil((new Date(r.nextDate) - new Date(tdy())) / 86400000);
          var cu   = getCu(r.customerId);
          return `<div class="crow" onclick="Router.showPage('pg-recurring')">
            <div style="min-width:0;flex:1;">
              <div class="crow-title">${r.title}</div>
              <div class="crow-sub">${cu?CustomerService.displayName(cu):'—'}</div>
            </div>
            <span class="bdg ${days<=0?'bdg-red':'bdg-orange'}" style="font-size:10px;white-space:nowrap;flex-shrink:0;">
              ${days<=0?'Förfallen':days===0?'Idag':days+' d'}
            </span>
          </div>`;
        }).join('')}
        <button class="btn bghost bfull bsm" style="margin-top:4px;" onclick="Router.showPage('pg-recurring')">
          ${ic('refresh-cw',11)} Hantera återkommande
        </button>
      </div>
    </div>`;
  },

  /* ── Planerade denna vecka ───────────────── */
  _widgetPlanned() {
    const today = tdy();
    const week  = _ds(7);
    const planned = (state.workOrders||[]).filter(a =>
      a.status === 'planerad' && a.scheduledDate > today && a.scheduledDate <= week
    );
    return `<div class="card">
      <div class="card-header">
        <h3 class="ch3">${ic('calendar-check',14)} Planerade</h3>
        ${planned.length > 0 ? `<span class="bdg bdg-sky">${planned.length}</span>` : ''}
      </div>
      <div class="card-body">
        ${planned.length === 0
          ? `<div class="empty" style="padding:12px 0;gap:4px;">${ic('calendar',22)}<p style="font-size:11px;text-align:center;">Inga planerade denna vecka</p></div>`
          : planned.slice(0,5).map(ao => {
              var cu = getCu(ao.customerId);
              return `<div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
                <div style="min-width:0;flex:1;">
                  <div class="crow-title">${ao.title}</div>
                  <div class="crow-sub">${fmtDate(ao.scheduledDate)} · ${cu?CustomerService.displayName(cu):'—'}</div>
                </div>
                ${sbdg(ao.status)}
              </div>`;
            }).join('')
        }
      </div>
    </div>`;
  },

  /* ── Säljchanser ──────────────────────────── */
  _widgetSales() {
    const active = SalesService.getActive();
    // Sales opportunities use English priority keys; translate here
    const prioSv  = { high:'Hög', medium:'Normal', low:'Låg', akut:'Akut', hög:'Hög', normal:'Normal', låg:'Låg' };
    const prioCls = { high:'bdg-orange', medium:'bdg-sky', low:'bdg-grey', akut:'bdg-red', hög:'bdg-orange', normal:'bdg-sky', låg:'bdg-grey' };
    return `<div class="card">
      <div class="card-header">
        <h3 class="ch3">${ic('target',14)} Säljchanser</h3>
        <div style="display:flex;gap:5px;align-items:center;">
          ${active.length > 0 ? `<span class="bdg bdg-purple">${active.length}</span>` : ''}
          <button class="btn bghost bxs" style="font-size:10px;font-weight:700;padding:3px 7px;gap:3px;"
            onclick="Router.showPage('pg-sales')" title="Visa alla säljchanser">
            Visa alla ${ic('arrow-right',10)}
          </button>
        </div>
      </div>
      <div class="card-body">
        ${active.length === 0
          ? `<div class="empty" style="padding:12px 0;gap:4px;">${ic('target',22)}<p style="font-size:11px;text-align:center;">Inga aktiva säljchanser</p></div>`
          : active.slice(0,3).map(opp => {
              var cu = getCu(opp.customerId);
              var cuName = cu ? (cu.name||(cu.firstName+' '+cu.lastName).trim()) : '—';
              var val = opp.estimatedValue ? ` · ${fmt(opp.estimatedValue)} kr` : '';
              var pBadge = `<span class="bdg ${prioCls[opp.priority]||'bdg-grey'}" style="font-size:9px;flex-shrink:0;">${prioSv[opp.priority]||opp.priority}</span>`;
              var tip = opp.aiTip ? `<div style="font-size:10px;color:var(--mt);font-style:italic;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">💡 ${opp.aiTip}</div>` : '';
              return `<div style="padding:6px 0;border-bottom:1px solid var(--bg);">
                <div style="display:flex;align-items:flex-start;gap:6px;margin-bottom:4px;">
                  <div style="flex:1;min-width:0;">
                    <div class="crow-title">${opp.title}</div>
                    <div class="crow-sub">${cuName}${val}</div>
                    ${tip}
                  </div>
                  ${pBadge}
                </div>
                <div style="display:flex;gap:4px;">
                  <button class="btn bxs bs" style="font-size:10px;padding:3px 7px;" onclick="event.stopPropagation();SalesService.openSnooze('${opp.id}')">Skjut upp</button>
                  <button class="btn bxs bsu" style="font-size:10px;padding:3px 7px;" onclick="event.stopPropagation();SalesService.markDoneUI('${opp.id}')">Klar</button>
                </div>
              </div>`;
            }).join('')}
        ${active.length > 3 ? `<button class="btn bghost bfull bsm" style="margin-top:4px;" onclick="Router.showPage('pg-sales')">+${active.length-3} fler säljchanser</button>` : ''}
      </div>
    </div>`;
  },

  /* ── Offerter väntar ──────────────────────── */
  _widgetOffers() {
    const pending = (state.offers||[]).filter(o => ['skickad','väntar'].includes(o.status));
    return `<div class="card">
      <div class="card-header">
        <h3 class="ch3">${ic('file-text',14)} Offerter väntar</h3>
        ${pending.length > 0 ? `<span class="bdg bdg-orange">${pending.length}</span>` : ''}
      </div>
      <div class="card-body">
        ${pending.length === 0
          ? `<div class="empty" style="padding:12px 0;gap:4px;">${ic('file-text',22)}<p style="font-size:11px;text-align:center;">Inga offerter väntar svar</p></div>`
          : pending.slice(0,4).map(o => {
              var cu    = getCu(o.customerId);
              var cuName = cu ? (cu.name||(cu.firstName+' '+cu.lastName).trim()) : '—';
              var total  = (o.lines||[]).reduce((s,l) => s+(l.total||0),0);
              var age    = o.sentAt ? Math.floor((Date.now()-new Date(o.sentAt))/86400000) : null;
              return `<div class="crow" onclick="Router.showPage('pg-offer-detail',{offerId:'${o.id}'})">
                <div style="min-width:0;flex:1;">
                  <div class="crow-title">${cuName}</div>
                  <div class="crow-sub">${fmt(total)} kr${age!==null?' · '+age+' dagar':''}</div>
                </div>
                ${sbdg(o.status)}
              </div>`;
            }).join('')
        }
        ${pending.length > 4 ? `<button class="btn bghost bfull bsm" style="margin-top:4px;" onclick="Router.showPage('pg-offer')">+${pending.length-4} fler</button>` : ''}
      </div>
    </div>`;
  },

  /* ── Senaste aktivitet ────────────────────── */
  _widgetActivity() {
    const acts = ActivityService.getRecent(8);
    return `<div class="card">
      <div class="card-header"><h3 class="ch3">${ic('activity',14)} Senaste händelser</h3></div>
      <div class="card-body">
        ${ActivityService.renderList(acts)}
      </div>
    </div>`;
  },

  /* ── Beräkningar ──────────────────────────── */
  _calcKPIs() {
    const today    = tdy();
    const monthStr = today.substring(0, 7);
    const aos      = state.workOrders || [];
    const sales    = state.salesOpportunities || [];
    return {
      activeOrders:  aos.filter(a => ['nytt','pool','planerad','pågående'].includes(a.status)).length,
      doneThisMonth: aos.filter(a => a.status==='klar' && (a.completedAt||'').startsWith(monthStr)).length,
      readyBill:     aos.filter(a => a.status==='klar' && !a.invoiceId).length,
      openOffers:    (state.offers||[]).filter(o => ['skickad','väntar'].includes(o.status)).length,
      salesActive:   sales.filter(s => ['new','contacted','contact_needed'].includes(s.status)).length
    };
  },

  _calcTodos() {
    const todos = [];
    const today = tdy();
    const week  = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const aos   = state.workOrders || [];

    // Akuta ordrar
    const akut = aos.filter(a => a.priority==='akut' && !['klar','fakturerad','avbruten'].includes(a.status));
    if (akut.length > 0) todos.push({
      icon:'alert-triangle', iconCls:'red', cls:'urgent',
      title:'Akuta ordrar kräver omedelbar åtgärd',
      sub: akut.map(a=>a.title).slice(0,2).join(', ')+(akut.length>2?` +${akut.length-2} till`:''),
      badge:akut.length, badgeCls:'',
      onClick:"Router.showPage('pg-ao',{filter:'akut'})"
    });

    // Ej fakturerade klara ordrar
    const readyBill = aos.filter(a => a.status==='klar' && !a.invoiceId);
    if (readyBill.length > 0) todos.push({
      icon:'receipt', iconCls:'orange',
      title:'Klara ordrar utan fakturaunderlag',
      sub:readyBill.length+' order'+(readyBill.length===1?'':'ar')+' redo för fakturering',
      badge:readyBill.length, badgeCls:'orange',
      onClick:"Router.showPage('pg-ao',{filter:'readyForInvoice'})"
    });

    // Försenade (planerade som passerat datum)
    const late = aos.filter(a =>
      ['planerad','pågående'].includes(a.status) && a.scheduledDate && a.scheduledDate < today
    );
    if (late.length > 0) todos.push({
      icon:'clock', iconCls:'orange',
      title:'Försenade arbetsorder',
      sub:late.map(a=>a.title).slice(0,2).join(', ')+(late.length>2?` +${late.length-2} till`:''),
      badge:late.length, badgeCls:'orange',
      onClick:"Router.showPage('pg-ao',{filter:'forsenad'})"
    });

    // Offerter utan svar 7+ dagar
    const staleOff = (state.offers||[]).filter(o =>
      o.status==='skickad' && o.sentAt && o.sentAt.split('T')[0] <= week
    );
    if (staleOff.length > 0) todos.push({
      icon:'file-text', iconCls:'blue',
      title:'Offerter utan svar i 7+ dagar',
      sub:staleOff.map(o=>{var cu=getCu(o.customerId);return cu?(cu.name||(cu.firstName+' '+cu.lastName).trim()):o.id;}).slice(0,2).join(', ')+(staleOff.length>2?` +${staleOff.length-2} till`:''),
      badge:staleOff.length, badgeCls:'blue',
      onClick:"Router.showPage('pg-offer')"
    });

    // Säljchanser
    const salesCount = SalesService.getActive().length;
    if (salesCount > 0) todos.push({
      icon:'target', iconCls:'purple',
      title:'Säljchanser att agera på',
      sub:salesCount+' aktiv'+(salesCount===1?'':'a')+' säljchans'+(salesCount===1?'':'er'),
      badge:salesCount, badgeCls:'purple',
      onClick:"Router.showPage('pg-sales')"
    });

    return todos;
  },

  _recurringDue() {
    return (state.recurringOrders||[]).filter(r => {
      if (r.status !== 'aktiv' || !r.nextDate) return false;
      var days = Math.ceil((new Date(r.nextDate) - new Date(tdy())) / 86400000);
      return days <= 7;
    });
  },

  /* ── Compat ───────────────────────────────── */
  showAllSales() { Router.showPage('pg-sales'); },
  newWorkOrder() { Router.showPage('pg-ao'); setTimeout(() => WorkOrdersPage.openCreate(), 80); },
  newCustomer()  { Router.showPage('pg-crm'); setTimeout(() => CustomersPage.openCreate(), 80); }
};
