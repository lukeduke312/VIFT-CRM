/**
 * Dashboard v49 — Rollbaserad behörighet, anpassningsbar layout,
 * personliga inställningar per användare.
 * v49: Fix Anpassa-modal (grid-layout, tydliga modulnamn, ingen horisontell scroll).
 */

const Dashboard = {

  _collapsed: {},  /* { catKey: true } — persisted in sessionStorage */

  _colKey: 'dash_collapsed_v1',

  _loadCollapsed() {
    try { this._collapsed = JSON.parse(sessionStorage.getItem(this._colKey) || '{}'); } catch(e) { this._collapsed = {}; }
  },

  _saveCollapsed() {
    try { sessionStorage.setItem(this._colKey, JSON.stringify(this._collapsed)); } catch(e) {}
  },

  toggleSection(key) {
    this._collapsed[key] = !this._collapsed[key];
    this._saveCollapsed();
    const isCollapsed = !!this._collapsed[key];
    document.querySelectorAll(`.dash-layout [data-sec="${key}"]`).forEach(el => {
      el.style.display = isCollapsed ? 'none' : '';
    });
    const caret = document.querySelector(`.dash-layout [data-sec-hdr="${key}"] .sec-caret`);
    if (caret) caret.innerHTML = ic(isCollapsed ? 'chevron-right' : 'chevron-down', 11);
  },

  /* ── Huvud-render ──────────────────────────────────────────────────── */
  render() {
    const el = document.getElementById('dash-content');
    if (!el) return;

    const user   = Auth.getUser();
    const userId = user ? user.id   : null;
    const roleId = user ? user.role : 'personal';

    // Applicera personliga preferenser (accentfärg, täthet)
    if (userId) UserPrefsService.apply(userId);

    // Hämta layout för användaren (sparad eller rollstandard)
    const layout = DashboardConfig.getUserLayout(userId, roleId);

    // Bygg widgets i rätt ordning, filtrerat på behörighet
    this._loadCollapsed();
    const parts  = [];
    const sorted = layout
      .filter(m => m.visible !== false)
      .filter(m => this._canSee(m.id))
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    let lastCat = null;
    for (const m of sorted) {
      const html = this._renderWidget(m.id);
      if (html) {
        const mod = DashboardConfig.getModule(m.id);
        const cat = mod ? (mod.category || null) : null;
        const key = cat ? cat.toLowerCase().replace(/[^a-z0-9]+/g,'-') : 'other';
        if (cat && cat !== lastCat) {
          const collapsed = !!this._collapsed[key];
          parts.push(`<div class="dw-full" data-sec-hdr="${key}">
            <div class="dash-sec-toggle" onclick="Dashboard.toggleSection('${key}')">
              <span class="dash-sec-label">${esc(cat)}</span>
              <span class="dash-sec-line"></span>
              <span class="sec-caret">${ic(collapsed ? 'chevron-right' : 'chevron-down', 11)}</span>
            </div>
          </div>`);
          lastCat = cat;
        }
        const cls = this._sizeClass(m.size || (mod || {}).defaultSize || 'full');
        const collapsed = !!this._collapsed[key];
        parts.push(`<div class="${cls}" data-sec="${key}"${collapsed ? ' style="display:none;"' : ''}>${html}</div>`);
      }
    }

    const userName = user ? (user.firstName || user.username || '') : '';
    const todayStr = new Date().toLocaleDateString('sv-SE', { weekday:'long', day:'numeric', month:'long' });
    const todayStr2 = todayStr.charAt(0).toUpperCase() + todayStr.slice(1);

    // Quick urgent summary for hero
    const allWos   = (state.workOrders||[]).filter(a => !a.archived && !a.deleted);
    const alive    = a => !['klar','fakturerad','avbruten'].includes(a.status);
    const urgCount = allWos.filter(a => a.priority==='akut' && alive(a)).length;
    const overdueC = allWos.filter(a => a.scheduledDate && a.scheduledDate < tdy() && alive(a) && a.status !== 'pool').length;
    const todayC   = allWos.filter(a => a.scheduledDate === tdy() && alive(a)).length;
    const heroSub  = [
      urgCount   > 0 ? `<span style="background:var(--lrd);color:var(--rd);border-radius:6px;padding:3px 9px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px;">${ic('zap',10)} ${urgCount} akut${urgCount>1?'a':''}</span>` : '',
      overdueC   > 0 ? `<span style="background:var(--lor);color:var(--or);border-radius:6px;padding:3px 9px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px;">${ic('clock',10)} ${overdueC} försen${overdueC>1?'ade':'ad'}</span>` : '',
      todayC     > 0 ? `<span style="background:var(--bg);color:var(--mt);border:1px solid var(--br);border-radius:6px;padding:3px 9px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;">${ic('calendar',10)} ${todayC} idag</span>` : '',
    ].filter(Boolean).join(' ');

    el.innerHTML =
      `<div class="dash-topbar">` +
        `<div style="display:flex;flex-direction:column;gap:1px;">` +
          (userName ? `<span style="font-size:14px;font-weight:700;color:var(--navy);">Hej, ${esc(userName)}</span>` : '<span></span>') +
          `<span style="font-size:12px;font-weight:500;color:var(--mt);">${todayStr2}</span>` +
        `</div>` +
        `<div style="display:flex;gap:4px;">` +
          `<button class="btn bghost bxs" onclick="Dashboard.openUserPrefs()" title="Mina inställningar" style="padding:6px;">${ic('user',14)}</button>` +
          `<button class="btn bghost bxs" onclick="Dashboard.openCustomize()" title="Anpassa dashboard" style="padding:6px;">${ic('settings',14)}</button>` +
        `</div>` +
      `</div>` +
      (heroSub ? `<div style="display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;align-items:center;">${heroSub}</div>` : '') +
      `<div class="dash-layout">${parts.join('')}</div>`;
  },

  /* ── Behörighet ────────────────────────────────────────────────────── */
  _canSee(moduleId) {
    const mod = DashboardConfig.getModule(moduleId);
    if (!mod) return false;
    return Auth.canAny(mod.requiredPermissions || []);
  },

  _sizeClass(size) {
    const map = { full:'dw-full', half:'dw-half', third:'dw-third', twothird:'dw-twothird' };
    return map[size] || 'dw-full';
  },

  /* ── Widget-dispatcher ─────────────────────────────────────────────── */
  _renderWidget(id) {
    try {
      switch (id) {
        case 'overdue_alert': {
          const n = this._calcOverdueActivities();
          return n > 0 ? this._widgetOverdueAlert(n) : null;
        }
        case 'kpi':          return this._widgetKpi();
        case 'todos': {
          const t = this._calcTodos();
          return t.length > 0 ? this._widgetTodos(t) : null;
        }
        case 'today':        return this._widgetToday();
        case 'pool':         return this._widgetPool();
        case 'stamp':        return this._widgetStamp();
        case 'activities':   return this._widgetActivities() || null;
        case 'recurring': {
          const r = this._recurringDue();
          return r.length > 0 ? this._widgetRecurring(r) : this._widgetPlanned();
        }
        case 'sales':        return this._widgetSales();
        case 'offers':       return this._widgetOffers();
        case 'activity_log': return this._widgetActivity();
        case 'rondering':      return this._widgetRondering();
        case 'quickbtns':      return this._widgetQuickbtns();
        case 'operations':     return this._widgetOperations();
        case 'ao_categories':  return this._widgetAoCategories();
        default: return null;
      }
    } catch(e) {
      console.error('[Dashboard] widget error:', id, e);
      return null;
    }
  },

  /* ── Anpassa dashboard ─────────────────────────────────────────────── */
  _custRows: [],

  openCustomize() {
    const user = Auth.getUser();
    if (!user) return;

    const layout    = DashboardConfig.getUserLayout(user.id, user.role);
    const permitted = DashboardConfig.getAllModules().filter(m => this._canSee(m.id));

    // Bygg rader: permitted modules sorterade på order
    const rows = permitted.map(m => {
      const entry = layout.find(e => e.id === m.id) || { id:m.id, visible:false, size:m.defaultSize||'full', order:999 };
      return { id:m.id, visible:!!entry.visible, size:entry.size||m.defaultSize||'full', order:entry.order, title:m.title, icon:m.icon||'square', description:m.description||'' };
    }).sort((a, b) => a.order - b.order);

    this._custRows = rows;

    Modal.open({
      title: `${ic('settings',15)} Anpassa dashboard`,
      body:
        `<p style="font-size:11px;color:var(--mt);margin-bottom:10px;">Välj vilka moduler som visas, flytta om ordningen och välj storlek. Layouten sparas per användare.</p>` +
        `<div id="dash-cust-list" style="display:flex;flex-direction:column;gap:5px;">${this._custListHtml()}</div>`,
      buttons: [
        { label: `${ic('check',13)} Spara layout`,     cls: 'btn bp',    onClick: () => Dashboard.saveCustomize() },
        { label: 'Återställ standard', cls: 'btn bs',    onClick: () => Dashboard._confirmResetLayout() },
        { label: 'Avbryt',             cls: 'btn bghost', onClick: () => Modal.close() }
      ],
      wide: true
    });
  },

  _custListHtml() {
    const sizeOpts = [
      { v:'full',  l:'Fullbredd'    },
      { v:'half',  l:'Halvbredd'    },
      { v:'third', l:'En tredjedel' },
    ];
    let lastCat = null;
    return this._custRows.map((r, i) => {
      const mod = DashboardConfig.getModule(r.id);
      const cat = mod ? (mod.category || '') : '';
      let header = '';
      if (cat && cat !== lastCat) {
        header = `<div class="dash-config-category">${esc(cat)}</div>`;
        lastCat = cat;
      }
      return header + `
        <div class="dash-config-row${r.visible ? ' on' : ''}" data-idx="${i}">
          <label class="dash-config-main">
            <input type="checkbox" ${r.visible ? 'checked' : ''} onchange="Dashboard._custToggle(${i})">
            <div class="dash-config-info">
              <span class="dash-config-name">${ic(r.icon||'square', 11)} ${esc(r.title)}</span>
              ${r.description ? `<span class="dash-config-desc" title="${esc(r.description)}">${esc(r.description)}</span>` : ''}
            </div>
          </label>
          <div class="dash-config-actions">
            <select onchange="Dashboard._custSize(${i},this.value)">
              ${sizeOpts.map(s => `<option value="${s.v}" ${r.size === s.v ? 'selected' : ''}>${s.l}</option>`).join('')}
            </select>
            <button type="button" class="btn bs bxs" style="padding:6px 10px;min-height:36px;" title="Flytta upp" onclick="Dashboard._custMove(${i},-1)">${ic('chevron-up',14)} Upp</button>
            <button type="button" class="btn bs bxs" style="padding:6px 10px;min-height:36px;" title="Flytta ned" onclick="Dashboard._custMove(${i},1)">${ic('chevron-down',14)} Ned</button>
          </div>
        </div>`;
    }).join('');
  },

  _custToggle(i) {
    const cb  = document.querySelector(`[data-idx="${i}"] input[type="checkbox"]`);
    const row = document.querySelector(`[data-idx="${i}"].dash-config-row`);
    if (this._custRows[i] && cb) {
      this._custRows[i].visible = cb.checked;
      if (row) row.classList.toggle('on', cb.checked);
    }
  },

  _custSize(i, val) {
    if (this._custRows[i]) this._custRows[i].size = val;
  },

  _custMove(i, dir) {
    const rows = this._custRows;
    const j    = i + dir;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    const list = document.getElementById('dash-cust-list');
    if (list) list.innerHTML = this._custListHtml();
  },

  saveCustomize() {
    const user = Auth.getUser();
    if (!user) return;

    // Spara permitted-modulers ordning/synlighet
    const layout = this._custRows.map((r, i) => ({ id:r.id, visible:r.visible, size:r.size, order:i }));

    // Behåll icke-permitted modulers befintliga inställningar
    const existing = DashboardConfig.getUserLayout(user.id, user.role);
    existing.forEach(e => {
      if (!layout.find(l => l.id === e.id)) layout.push(e);
    });

    DashboardConfig.saveUserLayout(user.id, layout);
    Modal.close();
    this.render();
    showToast('Dashboard-layout sparad');
  },

  _confirmResetLayout() {
    Modal.close();
    Modal.confirm('Återställa till standardlayout för din roll?', () => {
      const user = Auth.getUser();
      if (!user) return;
      DashboardConfig.resetUserLayout(user.id);
      Dashboard.render();
      showToast('Dashboard återställd till standard');
    });
  },

  /* ── Personliga inställningar ──────────────────────────────────────── */
  openUserPrefs() {
    const user = Auth.getUser();
    if (!user) return;
    const prefs   = UserPrefsService.get(user.id);
    const accent  = prefs.accentColor || '';
    const density = prefs.density || 'normal';
    const name    = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username;

    Modal.open({
      title: `${ic('user',15)} Mina inställningar`,
      body: `
        <p style="font-size:11px;color:var(--mt);margin-bottom:14px;">Inställningarna gäller bara din egen vy och lagras lokalt. De påverkar inte PDF, fakturor eller andra användares vy.</p>
        <div style="margin-bottom:10px;padding:10px 12px;background:var(--bg);border-radius:var(--rs);">
          <div style="font-size:12px;font-weight:700;color:var(--navy);">${esc(name)}</div>
          <div style="font-size:11px;color:var(--mt);">${esc(user.username)} · Roll: ${esc(user.role || '—')}</div>
        </div>
        <div class="fg">
          <label>Personlig accentfärg <span style="font-size:10px;font-weight:400;color:var(--mt);">(påverkar knappar och ikoner)</span></label>
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap;">
            <input type="color" id="pref-accent" value="${accent || '#2b7fd4'}" style="width:44px;height:32px;border:1px solid var(--br);border-radius:6px;cursor:pointer;padding:2px;"
              oninput="UserPrefsService.previewAccent(this.value)">
            <div style="display:flex;gap:4px;flex-wrap:wrap;">
              ${['#2b7fd4','#0f3763','#166534','#9333ea','#dc2626','#d97706','#0891b2','#1e293b'].map(c =>
                `<button type="button" style="width:22px;height:22px;background:${c};border-radius:4px;border:2px solid ${accent===c?'var(--navy)':'transparent'};cursor:pointer;" onclick="document.getElementById('pref-accent').value='${c}';UserPrefsService.previewAccent('${c}')" title="${c}"></button>`
              ).join('')}
            </div>
            <button class="btn bs bxs" style="font-size:11px;" onclick="document.getElementById('pref-accent').value='';UserPrefsService.previewAccent(null)">Återställ</button>
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:10px;">
            <button class="btn bs bxs" style="pointer-events:none;min-width:110px;">Aa Förhandsgranskning</button>
            <span style="font-size:10px;color:var(--mt);">Exempelknapp med vald accent</span>
          </div>
        </div>
        <div class="fg" style="margin-top:12px;">
          <label>Layout-täthet</label>
          <select id="pref-density" style="margin-top:4px;">
            <option value="normal"   ${density==='normal'   ?'selected':''}>Normal</option>
            <option value="compact"  ${density==='compact'  ?'selected':''}>Kompakt — mer information per skärm</option>
            <option value="spacious" ${density==='spacious' ?'selected':''}>Luftig — mer luft mellan element</option>
          </select>
        </div>`,
      buttons: [
        { label: `${ic('check',13)} Spara`,  cls:'btn bp',    onClick: () => Dashboard.saveUserPrefs() },
        { label: 'Avbryt', cls:'btn bghost', onClick: () => { const u = Auth.getUser(); if (u) UserPrefsService.apply(u.id); Modal.close(); } }
      ]
    });
  },

  saveUserPrefs() {
    const user = Auth.getUser();
    if (!user) return;
    const accent  = document.getElementById('pref-accent')?.value || null;
    const density = document.getElementById('pref-density')?.value || 'normal';
    UserPrefsService.saveAccent(user.id, accent);
    UserPrefsService.save(user.id, { density });
    UserPrefsService.apply(user.id);
    Modal.close();
    showToast('Inställningar sparade');
  },

  /* ── Widget: Försenade aktiviteter ──────────────────────────────────── */
  _widgetOverdueAlert(count) {
    return `<div class="attention-banner" onclick="Router.showPage('pg-activities',{filter:'försenade'})" style="cursor:pointer;">
      <div class="attention-banner-icon">${ic('alert-circle',18)}</div>
      <div class="attention-banner-body">
        <div class="attention-banner-title">${count} försenad${count===1?'':'e'} uppföljning${count===1?'':'ar'} — kräver åtgärd nu</div>
        <div class="attention-banner-sub">Klicka för att se och åtgärda</div>
      </div>
      <div style="color:var(--rd);flex-shrink:0;">${ic('chevron-right',14)}</div>
    </div>`;
  },

  /* ── Widget: KPI (behörighetsfiltrad) ─────────────────────────────── */
  _widgetKpi() {
    const kpis  = this._calcKPIs();
    const items = [];

    if (Auth.canAny(['ao_view_all','ao_view_own'])) {
      items.push(this._kpi(kpis.activeOrders,  'Aktiva ordrar',     '',       "Router.showPage('pg-ao',{filter:'active'})"));
      items.push(this._kpi(kpis.doneThisMonth, 'Klara denna månad', '',       "Router.showPage('pg-ao',{filter:'klar'})"));
    }
    if (Auth.canAny(['invoice_view','invoice_create'])) {
      items.push(this._kpi(kpis.readyBill, 'Redo fakturering', 'orange', "Router.showPage('pg-ao',{filter:'readyForInvoice'})"));
    }
    if (Auth.can('offer_manage')) {
      items.push(this._kpi(kpis.openOffers,  'Offerter ute',  '',       "Router.showPage('pg-offer')"));
    }
    if (Auth.can('sales_manage')) {
      items.push(this._kpi(kpis.salesActive, 'Säljchanser',   '',       "Router.showPage('pg-sales')"));
    }

    if (items.length === 0) return '';
    return `<div class="kpi-row">${items.join('')}</div>`;
  },

  _kpi(value, label, color, onclick) {
    const actionable = (color === 'orange' || color === 'red') && value > 0;
    const numColor = actionable ? (color === 'orange' ? 'color:var(--or)' : 'color:var(--rd)') : 'color:var(--navy)';
    const cardStyle = actionable ? 'border-left:3px solid '+(color==='orange'?'var(--or)':'var(--rd)')+';padding-left:11px;' : '';
    return `<div class="kpi-card" onclick="${onclick}" style="cursor:pointer;${cardStyle}">
      <div class="kpi-number" style="${numColor}">${value}</div>
      <div class="kpi-label">${label}</div>
    </div>`;
  },

  /* ── Widget: Kräver åtgärd (behörighetsfiltrad) ───────────────────── */
  _widgetTodos(todos) {
    const hasUrgent = todos.some(t => t.cls === 'urgent');
    return `<div class="card" style="border-top:2px solid ${hasUrgent?'var(--rd)':'var(--or)'};">
      <div class="card-header">
        <h3 class="ch3">${ic('alert-circle',14)} Kräver åtgärd</h3>
        <span class="bdg ${hasUrgent?'bdg-red':'bdg-orange'}">${todos.length}</span>
      </div>
      <div style="padding:2px 6px 6px;">
        ${todos.map(t => this._actionItem(t)).join('')}
      </div>
    </div>`;
  },

  _actionItem(t) {
    const isUrgent = t.cls === 'urgent';
    const iconColor = isUrgent ? 'var(--rd)' : t.iconCls === 'orange' ? 'var(--or)' : t.iconCls === 'blue' ? 'var(--sky)' : 'var(--mt)';
    const countCls = isUrgent ? 'urgent' : (t.badgeCls === 'orange' ? 'orange' : '');
    return `<div class="dash-action-item ${t.cls||''}" onclick="${t.onClick}">
      <span style="color:${iconColor};flex-shrink:0;">${ic(t.icon, 14)}</span>
      <div class="dai-text">
        <div class="dai-title">${t.title}</div>
        ${t.sub ? `<div class="dai-sub">${t.sub}</div>` : ''}
      </div>
      <span class="dai-count ${countCls}">${t.badge}</span>
      <span style="color:#cbd5e1;flex-shrink:0;">${ic('chevron-right',12)}</span>
    </div>`;
  },

  /* ── Widget: Dagens drift (chef/admin) ────────────────────────────── */
  _widgetOperations() {
    if (!Auth.canAny(['staff_view','reports_view'])) return null;
    const today = tdy();
    const all   = (state.workOrders || []).filter(ao => !ao.archived && !ao.deleted);
    const alive = ao => !['klar','fakturerad','avbruten'].includes(ao.status);
    const overdue  = all.filter(ao => ao.scheduledDate && ao.scheduledDate < today && alive(ao) && ao.status !== 'pool').length;
    const urgent   = all.filter(ao => ao.priority === 'akut' && alive(ao)).length;
    const noStaff  = all.filter(ao => (ao.staff||[]).length === 0 && alive(ao) && !['pool','avbruten'].includes(ao.status)).length;
    const readyBill= all.filter(ao => ao.status === 'klar' && !ao.invoiceId).length;
    const todayCnt = all.filter(ao => ao.scheduledDate === today && alive(ao)).length;
    const ongoing  = all.filter(ao => ao.status === 'pågående').length;
    const alert    = overdue > 0 || urgent > 0 || noStaff > 0;

    const chip = (val, label, color) =>
      `<div style="text-align:center;flex:1;min-width:60px;">
        <div style="font-size:18px;font-weight:900;color:var(--${color});">${val}</div>
        <div style="font-size:10px;color:var(--mt);margin-top:1px;">${label}</div>
      </div>`;

    return `<div class="card"${alert ? ' style="border-left:2px solid var(--or);"' : ''}>
      <div class="card-header">
        <h3 class="ch3">${ic('layout-dashboard',14)} Dagens drift</h3>
        <button class="btn bghost bxs" style="font-size:11px;" onclick="Router.showPage('pg-operations')">Öppna ${ic('arrow-right',11)}</button>
      </div>
      <div class="card-body" style="padding:12px 14px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${chip(todayCnt,  'Planerade',      'blue')}
          ${chip(ongoing,   'Pågående',       'green')}
          ${chip(overdue,   'Försenade',      overdue>0?'rd':'mt')}
          ${chip(urgent,    'Akuta',          urgent>0?'rd':'mt')}
          ${chip(noStaff,   'Sakn. personal', noStaff>0?'orange':'mt')}
          ${chip(readyBill, 'Ej fakt.',       readyBill>0?'orange':'mt')}
        </div>
      </div>
    </div>`;
  },

  /* ── Widget: Öppna AO per kategori ───────────────────────────────── */
  _widgetAoCategories() {
    const all    = (state.workOrders||[]).filter(a => !a.archived && !a.deleted);
    const isOpen = a => !['klar','fakturerad','avbruten'].includes(a.status);
    const isDone = a => ['klar','fakturerad'].includes(a.status);
    const openAos = all.filter(isOpen);
    const total   = all.length;
    const doneN   = all.filter(isDone).length;
    const pct     = total > 0 ? Math.round(doneN / total * 100) : 0;

    const rows = AO_CATEGORIES
      .map(c => {
        const aos    = openAos.filter(ao => (ao.category || 'ovrigt') === c.slug);
        const urgent = aos.filter(ao => ao.priority === 'akut').length;
        return { cat: c, count: aos.length, urgent };
      })
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .map(({ cat: c, count, urgent }) => {
        const barW = Math.min(100, Math.round(count / Math.max(1, openAos.length) * 100));
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--br);" onclick="Router.showPage('pg-ao')" style="cursor:pointer;">
          <span style="width:28px;height:28px;border-radius:8px;background:${c.color}1a;color:${c.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${ic(c.icon,13)}</span>
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
              <span style="font-size:12px;font-weight:700;color:var(--navy);">${esc(c.label)}</span>
              <span style="font-size:13px;font-weight:800;color:var(--navy);">${count}${urgent > 0 ? `&nbsp;<span style="color:var(--rd);font-size:10px;font-weight:700;">${ic('zap',9)} ${urgent}</span>` : ''}</span>
            </div>
            <div style="height:4px;background:var(--br);border-radius:4px;overflow:hidden;">
              <div style="width:${barW}%;height:100%;background:${c.color};border-radius:4px;"></div>
            </div>
          </div>
        </div>`;
      }).join('');

    if (!rows) {
      return `<div class="card">
        <div class="card-header"><h3 class="ch3">${ic('layers',14)} Öppna per kategori</h3></div>
        <div class="card-body"><div class="empty" style="padding:12px 0;gap:4px;">${ic('check-circle',22)}<p style="font-size:11px;">Inga öppna ordrar</p></div></div>
      </div>`;
    }

    return `<div class="card">
      <div class="card-header">
        <h3 class="ch3">${ic('layers',14)} Öppna per kategori</h3>
        <button class="btn bghost bxs" style="font-size:11px;padding:3px 8px;" onclick="Router.showPage('pg-ao')">${ic('arrow-right',11)} Se alla</button>
      </div>
      <div class="card-body" style="padding:8px 14px 4px;">
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:11px;color:var(--mt);">Totalt färdigställt</span>
            <span style="font-size:11px;font-weight:700;color:var(--navy);">${pct}% &nbsp;(${doneN}/${total})</span>
          </div>
          <div style="height:6px;background:var(--br);border-radius:6px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:var(--gr);border-radius:6px;"></div>
          </div>
        </div>
        ${rows}
      </div>
    </div>`;
  },

  /* ── Widget: Snabbknappar (behörighetsfiltrad) ────────────────────── */
  _widgetQuickbtns() {
    const btns = [];
    if (Auth.canAny(['ao_view_all','ao_view_own'])) {
      btns.push(this._qbtn('briefcase',     'Mina jobb',    "Router.showPage('pg-myjobs')",                                                               'Dina tilldelade arbetsorder'));
    }
    if (Auth.canAny(['ao_view_all','ao_view_own','ao_create'])) {
      btns.push(this._qbtn('clipboard-list','Ny order',     "Router.showPage('pg-ao');setTimeout(()=>WorkOrdersPage.openCreate(),80)",                    'Skapa ett nytt jobb för kund eller fastighet'));
    }
    if (Auth.can('offer_manage')) {
      btns.push(this._qbtn('file-text',     'Ny offert',    "Router.showPage('pg-offer');setTimeout(()=>OffersPage.openCreate(),80)",                     'Skapa och skicka offert till kund'));
    }
    if (Auth.can('customer_manage')) {
      btns.push(this._qbtn('users',         'Ny kund',      "Router.showPage('pg-crm');setTimeout(()=>CustomersPage.openCreate(),80)",                    'Lägg upp ny kund i registret'));
    }
    if (Auth.can('recurring_manage')) {
      btns.push(this._qbtn('refresh-cw',    'Återkommande', "Router.showPage('pg-recurring')",                                                            'Hantera återkommande uppdrag'));
    }
    if (Auth.can('ao_time')) {
      btns.push(this._qbtn('clock',         'Stämpla tid',  "Router.showPage('pg-tid')",                                                                  'Klocka in och hantera din tid'));
    }
    if (Auth.canAny(['invoice_view','invoice_create'])) {
      btns.push(this._qbtn('receipt',       'Fakturering',  "Router.showPage('pg-invoices')",                                                             'Fakturaunderlag och betalningsstatus'));
    }

    if (btns.length === 0) return '';
    return `<div class="card">
      <div class="card-header"><h3 class="ch3">${ic('zap',14)} Snabbåtgärder</h3></div>
      <div class="card-body" style="padding:4px 14px 10px;">
        <div class="quick-list">${btns.join('')}</div>
      </div>
    </div>`;
  },

  _qbtn(icon, label, onclick, desc) {
    return `<button class="quick-action-row" onclick="${onclick}">
      <div class="qar-icon">${ic(icon, 14)}</div>
      <div class="qar-body">
        <div class="qar-title">${label}</div>
        ${desc ? `<div class="qar-sub">${desc}</div>` : ''}
      </div>
      <span class="qar-arrow">${ic('chevron-right',13)}</span>
    </button>`;
  },

  /* ── Widget: Idag ──────────────────────────────────────────────────── */
  _widgetToday() {
    const today    = tdy();
    const user     = Auth.getUser();
    const userId   = user ? user.id : null;
    const isAdmin  = Auth.can('all') || Auth.canAny(['ao_view_all']);
    const hasAll   = Auth.can('ao_view_all');

    // Tekniker utan ao_view_all: visa bara sina ordrar
    let todayAOs = (state.workOrders || []).filter(a =>
      !a.archived && !a.deleted &&
      a.scheduledDate === today && !['klar','fakturerad','avbruten'].includes(a.status)
    );
    if (!hasAll && userId) {
      todayAOs = todayAOs.filter(a => (a.staff||[]).includes(userId));
    }

    const dateStr = new Date().toLocaleDateString('sv-SE',{weekday:'long',day:'numeric',month:'short'});
    return `<div class="card">
      <div class="card-header">
        <h3 class="ch3">${ic('calendar',14)} ${hasAll ? 'Ordrar idag' : 'Mina ordrar idag'}</h3>
        <span style="font-size:10px;color:var(--mt);font-weight:600;text-transform:capitalize;">${dateStr}</span>
      </div>
      <div class="card-body">
        ${todayAOs.length === 0
          ? `<div class="empty" style="padding:12px 0;gap:4px;">${ic('calendar',22)}<p style="font-size:11px;text-align:center;">Inga planerade ordrar idag</p></div>`
          : (() => {
              const LIMIT = 4;
              const uid = 'vm-today';
              const renderRow = ao => { var cu = getCu(ao.customerId); return `<div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})"><div style="min-width:0;flex:1;"><div class="crow-title">${ao.title}</div><div class="crow-sub">${ao.scheduledStart||'?'}–${ao.scheduledEnd||'?'} · ${cu?CustomerService.displayName(cu):'—'}</div></div>${sbdg(ao.status)}</div>`; };
              const visible = todayAOs.slice(0, LIMIT).map(renderRow).join('');
              const hidden  = todayAOs.length > LIMIT ? `<div id="${uid}" style="display:none;">${todayAOs.slice(LIMIT).map(renderRow).join('')}</div><button class="btn bghost bfull bsm" style="margin-top:2px;" onclick="document.getElementById('${uid}').style.display='';this.remove()">${ic('chevron-down',11)} Visa alla (${todayAOs.length})</button>` : '';
              return visible + hidden;
            })()
        }
        <button class="btn bghost bfull bsm" style="margin-top:4px;" onclick="Router.showPage('pg-ao',{filter:'idag'})">
          ${ic('list',11)} Alla ordrar idag
        </button>
      </div>
    </div>`;
  },

  /* ── Widget: Arbetspool ────────────────────────────────────────────── */
  _widgetPool() {
    const pool = (state.workOrders || []).filter(a => a.status === 'pool' && !a.archived && !a.deleted);
    return `<div class="card">
      <div class="card-header">
        <h3 class="ch3">${ic('inbox',14)} Arbetspool</h3>
        <div style="display:flex;align-items:center;gap:6px;">
          ${pool.length > 0 ? `<span class="bdg">${pool.length} väntar</span>` : ''}
          <button class="btn bghost bxs" style="font-size:10px;padding:3px 7px;" onclick="Router.showPage('pg-ao',{filter:'pool'})">Visa ${ic('arrow-right',10)}</button>
        </div>
      </div>
      <div class="card-body">
        ${pool.length === 0
          ? `<div class="empty" style="padding:12px 0;gap:4px;">${ic('inbox',22)}<p style="font-size:11px;text-align:center;">Arbetspoolen är tom</p></div>`
          : (() => {
              const LIMIT = 4;
              const uid = 'vm-pool';
              const renderRow = ao => { var cu = getCu(ao.customerId); return `<div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})"><div style="min-width:0;flex:1;"><div class="crow-title">${ao.title}</div><div class="crow-sub">${cu?CustomerService.displayName(cu):'—'}</div></div>${pbdg(ao.priority)}</div>`; };
              const visible = pool.slice(0, LIMIT).map(renderRow).join('');
              const hidden  = pool.length > LIMIT ? `<div id="${uid}" style="display:none;">${pool.slice(LIMIT).map(renderRow).join('')}</div><button class="btn bghost bfull bsm" style="margin-top:2px;" onclick="document.getElementById('${uid}').style.display='';this.remove()">${ic('chevron-down',11)} Visa alla (${pool.length})</button>` : '';
              return visible + hidden;
            })()
        }
      </div>
    </div>`;
  },

  /* ── Widget: Stämpla tid (ny i v48) ───────────────────────────────── */
  _widgetStamp() {
    const active = !!state.stampActive;
    const ts     = state.stampTimestamp;
    let elapsed  = '';
    if (active && ts) {
      const ms = Math.max(0, Date.now() - new Date(ts).getTime());
      const h  = Math.floor(ms / 3600000);
      const m  = Math.floor((ms % 3600000) / 60000);
      elapsed  = `${h}h ${m}min`;
    }
    const timeStr = (active && ts) ? new Date(ts).toLocaleTimeString('sv-SE', {hour:'2-digit', minute:'2-digit'}) : '';
    return `<div class="card"${active?' style="border-left:2px solid var(--gr);"':''}>
      <div class="card-header">
        <h3 class="ch3">${ic('clock',14)} Stämpla tid</h3>
        ${active
          ? `<span class="bdg bdg-green">${ic('check-circle',10)} Incheckad</span>`
          : `<span style="font-size:11px;color:var(--mt);">Utcheckad</span>`
        }
      </div>
      <div class="card-body" style="text-align:center;padding:16px 12px;">
        ${active
          ? `<div style="font-size:26px;font-weight:900;color:var(--gr);line-height:1;margin-bottom:4px;">${elapsed}</div>
             <div style="font-size:11px;color:var(--mt);margin-bottom:14px;">Incheckad sedan ${timeStr}</div>
             <button class="btn bs bfull bsm" onclick="Router.showPage('pg-tid')">${ic('clock',13)} Hantera stämpling</button>`
          : `<div style="font-size:13px;font-weight:600;color:var(--mt);margin-bottom:14px;">Inte incheckad</div>
             <button class="btn bp bfull bsm" onclick="Router.showPage('pg-tid')">${ic('log-in',13)} Stämpla in</button>`
        }
      </div>
    </div>`;
  },

  /* ── Widget: Återkommande ──────────────────────────────────────────── */
  _widgetRecurring(recurring) {
    return `<div class="card">
      <div class="card-header">
        <h3 class="ch3">${ic('refresh-cw',14)} Återkommande snart</h3>
        <span class="bdg">${recurring.length}</span>
      </div>
      <div class="card-body">
        ${(() => {
          const LIMIT = 4;
          const uid = 'vm-recur';
          const renderRow = r => { var days = Math.ceil((new Date(r.nextDate)-new Date(tdy()))/86400000); var cu = getCu(r.customerId); return `<div class="crow" onclick="Router.showPage('pg-recurring')"><div style="min-width:0;flex:1;"><div class="crow-title">${r.title}</div><div class="crow-sub">${cu?CustomerService.displayName(cu):'—'}</div></div><span class="bdg ${days<=0?'bdg-red':'bdg-orange'}" style="font-size:10px;white-space:nowrap;flex-shrink:0;">${days<=0?'Förfallen':days===0?'Idag':days+' d'}</span></div>`; };
          const visible = recurring.slice(0, LIMIT).map(renderRow).join('');
          const hidden  = recurring.length > LIMIT ? `<div id="${uid}" style="display:none;">${recurring.slice(LIMIT).map(renderRow).join('')}</div><button class="btn bghost bfull bsm" style="margin-top:2px;" onclick="document.getElementById('${uid}').style.display='';this.remove()">${ic('chevron-down',11)} Visa alla (${recurring.length})</button>` : '';
          return visible + hidden;
        })()}
        <button class="btn bghost bfull bsm" style="margin-top:4px;" onclick="Router.showPage('pg-recurring')">
          ${ic('refresh-cw',11)} Hantera återkommande
        </button>
      </div>
    </div>`;
  },

  /* ── Widget: Planerade ─────────────────────────────────────────────── */
  _widgetPlanned() {
    const today   = tdy();
    const week    = _ds(7);
    const planned = (state.workOrders||[]).filter(a =>
      a.status === 'planerad' && !a.archived && !a.deleted &&
      a.scheduledDate > today && a.scheduledDate <= week
    );
    return `<div class="card">
      <div class="card-header">
        <h3 class="ch3">${ic('calendar-check',14)} Planerade</h3>
        ${planned.length > 0 ? `<span class="bdg bdg-sky">${planned.length}</span>` : ''}
      </div>
      <div class="card-body">
        ${planned.length === 0
          ? `<div class="empty" style="padding:12px 0;gap:4px;">${ic('calendar',22)}<p style="font-size:11px;text-align:center;">Inga planerade denna vecka</p></div>`
          : (() => {
              const LIMIT = 4;
              const uid = 'vm-planned';
              const renderRow = ao => { var cu = getCu(ao.customerId); return `<div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})"><div style="min-width:0;flex:1;"><div class="crow-title">${ao.title}</div><div class="crow-sub">${fmtDate(ao.scheduledDate)} · ${cu?CustomerService.displayName(cu):'—'}</div></div>${sbdg(ao.status)}</div>`; };
              const visible = planned.slice(0, LIMIT).map(renderRow).join('');
              const hidden  = planned.length > LIMIT ? `<div id="${uid}" style="display:none;">${planned.slice(LIMIT).map(renderRow).join('')}</div><button class="btn bghost bfull bsm" style="margin-top:2px;" onclick="document.getElementById('${uid}').style.display='';this.remove()">${ic('chevron-down',11)} Visa alla (${planned.length})</button>` : '';
              return visible + hidden;
            })()
        }
      </div>
    </div>`;
  },

  /* ── Widget: Säljchanser ───────────────────────────────────────────── */
  /* V46 R3: samma pipeline-statusar som SalesPage.ACTIVE_STATUSES avgör om en
     säljchans räknas som aktiv i Förfallen-beräkningen — hålls som en lokal,
     identisk kopia här eftersom Dashboard.js inte får bero på att SalesPage.js
     laddats i en viss ordning. */
  _SALES_ACTIVE_STATUSES: ['new', 'contact_needed', 'contacted', 'quote_created', 'work_order_created'],
  _widgetSales() {
    const active   = SalesService.getActive();
    const prioSv   = { high:'Hög', medium:'Normal', low:'Låg', akut:'Akut', hög:'Hög', normal:'Normal', låg:'Låg' };
    const prioCls  = { high:'bdg-orange', medium:'bdg-sky', low:'bdg-grey', akut:'bdg-red', hög:'bdg-orange', normal:'bdg-sky', låg:'bdg-grey' };
    return `<div class="card">
      <div class="card-header">
        <h3 class="ch3">${ic('target',14)} Säljchanser</h3>
        <div style="display:flex;gap:5px;align-items:center;">
          ${active.length > 0 ? `<span class="bdg">${active.length}</span>` : ''}
          <button class="btn bghost bxs" style="font-size:10px;font-weight:700;padding:3px 7px;gap:3px;" onclick="Router.showPage('pg-sales')">Visa alla ${ic('arrow-right',10)}</button>
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
              /* V46: bugfix — fältet heter dueDate i Schema.salesOpportunity(), inte deadline (opp.deadline var alltid undefined, badgen visades aldrig). */
              var isOverdue = !!(opp.dueDate && opp.dueDate < tdy() && this._SALES_ACTIVE_STATUSES.includes(opp.status));
              var deadline = opp.dueDate ? `<span class="bdg" style="font-size:9px;flex-shrink:0;${isOverdue?'color:var(--rd);font-weight:700;':''}">${ic('calendar',9)} ${fmtDate(opp.dueDate)}</span>` : '';
              /* V46 R3: samma Förfallen-semantik som SalesPage._renderCard() — aktiv status + passerat dueDate. */
              var overdueBadge = isOverdue ? `<span class="bdg bdg-red" style="font-size:9px;flex-shrink:0;">${ic('alert-triangle',9)} Förfallen</span>` : '';
              return `<div class="crow" style="cursor:pointer;" onclick="Router.showPage('pg-sales')">
                <div style="flex:1;min-width:0;">
                  <div class="crow-title">${opp.title}</div>
                  <div class="crow-sub">${cuName}${val}</div>
                  ${tip}
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">
                  ${pBadge}
                  ${overdueBadge}
                  ${deadline}
                </div>
              </div>`;
            }).join('')}
        ${active.length > 3 ? `<button class="btn bghost bfull bsm" style="margin-top:4px;" onclick="Router.showPage('pg-sales')">+${active.length-3} fler säljchanser</button>` : ''}
      </div>
    </div>`;
  },

  /* ── Widget: Offerter väntar ───────────────────────────────────────── */
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
          : (() => {
              const LIMIT = 3;
              const uid = 'vm-offers';
              const renderRow = o => { var cu = getCu(o.customerId); var cuName = cu?(cu.name||(cu.firstName+' '+cu.lastName).trim()):'—'; var total = (o.lines||[]).reduce((s,l)=>s+(l.total||0),0); var age = o.sentAt?Math.floor((Date.now()-new Date(o.sentAt))/86400000):null; return `<div class="crow" onclick="Router.showPage('pg-offer-detail',{offerId:'${o.id}'})"><div style="min-width:0;flex:1;"><div class="crow-title">${cuName}</div><div class="crow-sub">${fmt(total)} kr${age!==null?' · '+age+' dagar':''}</div></div>${sbdg(o.status)}</div>`; };
              const visible = pending.slice(0, LIMIT).map(renderRow).join('');
              const hidden  = pending.length > LIMIT ? `<div id="${uid}" style="display:none;">${pending.slice(LIMIT).map(renderRow).join('')}</div><button class="btn bghost bfull bsm" style="margin-top:2px;" onclick="document.getElementById('${uid}').style.display='';this.remove()">${ic('chevron-down',11)} Visa alla (${pending.length})</button>` : '';
              return visible + hidden;
            })()
        }
      </div>
    </div>`;
  },

  /* ── Widget: Senaste händelser ─────────────────────────────────────── */
  _widgetActivity() {
    const acts = ActivityService.getRecent(8);
    return `<div class="card">
      <div class="card-header"><h3 class="ch3">${ic('activity',14)} Senaste händelser</h3></div>
      <div class="card-body">
        ${ActivityService.renderList(acts)}
      </div>
    </div>`;
  },

  /* ── Widget: Aktiviteter & uppföljningar ───────────────────────────── */
  _widgetActivities() {
    const stats     = ActivitiesService.getStats();
    const today     = tdy();
    const overdue   = ActivitiesService.getOverdue();
    const todayActs = ActivitiesService.getToday();
    const user      = Auth.getUser();
    const userId    = user ? user.id : null;

    // Filtera till inloggad användares aktiviteter om de inte är admin/chef
    const canSeeAll = Auth.can('all') || Auth.can('staff_view');
    const myOverdue = canSeeAll ? overdue : overdue.filter(a => !a.assignedTo || a.assignedTo === userId || a.createdBy === userId);
    const myToday   = canSeeAll ? todayActs : todayActs.filter(a => !a.assignedTo || a.assignedTo === userId || a.createdBy === userId);

    const myStats = canSeeAll ? stats : {
      overdue:  myOverdue.length,
      today:    myToday.length,
      upcoming: stats.upcoming
    };

    if (myStats.overdue === 0 && myStats.today === 0 && myStats.upcoming === 0) return '';

    const _cnt = (n, label, color, filter) =>
      `<div onclick="Router.showPage('pg-activities',{filter:'${filter}'})" style="flex:1;display:flex;align-items:center;gap:7px;padding:8px 10px;cursor:pointer;border-radius:var(--rx);border:1px solid var(--br);background:#fff;">
        <span style="font-size:18px;font-weight:900;color:${color};min-width:20px;line-height:1;">${n}</span>
        <span style="font-size:11px;color:var(--mt);font-weight:500;">${label}</span>
      </div>`;

    const urgent = [...myOverdue, ...myToday].slice(0, 4);

    return `<div class="card">
      <div class="card-header">
        <h3 class="ch3">${ic('bell',14)} Aktiviteter & uppföljningar</h3>
        <button class="btn bghost bxs" style="font-size:10px;font-weight:700;padding:3px 8px;gap:3px;" onclick="Router.showPage('pg-activities')">Visa alla ${ic('arrow-right',10)}</button>
      </div>
      <div class="card-body" style="padding:10px 12px;">
        <div style="display:flex;gap:8px;margin-bottom:${urgent.length>0?'10px':'0'};">
          ${_cnt(myStats.overdue, 'Försenade', 'var(--rd)', 'försenade')}
          ${_cnt(myStats.today,   'Idag',      'var(--or)', 'idag')}
          ${_cnt(myStats.upcoming,'Kommande',  'var(--blue)','kommande')}
        </div>
        ${urgent.length > 0 ? `<div style="display:flex;flex-direction:column;gap:4px;">
          ${urgent.map(a => {
            const isOverdue = a.dueDate < today;
            return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg);border-radius:var(--rx);cursor:pointer;border-left:3px solid ${isOverdue?'var(--rd)':'var(--or)'};" onclick="Router.showPage('pg-activities')">
              <span style="color:${isOverdue?'var(--rd)':'var(--or)'};">${ic(ActivitiesService.typeIcon(a.type),13)}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:700;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.note || ActivitiesService.typeLabel(a.type)}</div>
                <div style="font-size:10px;color:${isOverdue?'var(--rd)':'var(--mt)'};">${isOverdue?'Försenad — ':''} ${fmtDate(a.dueDate)}</div>
              </div>
              <button class="btn bxs bsu" style="font-size:9px;padding:3px 8px;" onclick="event.stopPropagation();ActivitiesService.complete('${a.id}');Dashboard.render();">${ic('check',10)} Klar</button>
            </div>`;
          }).join('')}
        </div>` : ''}
      </div>
    </div>`;
  },

  /* ── Widget: Rondering ─────────────────────────────────────────────── */
  _widgetRondering() {
    const today           = tdy();
    const forsenade       = (state.ronderingar||[]).filter(r => r.scheduledDate && r.scheduledDate < today && r.status === 'planerad');
    const oppnaAvvikelser = (state.avvikelser||[]).filter(a => a.status === 'öppen');
    const akutaAvvikelser = oppnaAvvikelser.filter(a => a.priority === 'akut' || a.priority === 'hög');
    const avvUanAO        = oppnaAvvikelser.filter(a => !a.workOrderId);

    return `<div class="card">
      <div class="card-header">
        <h3 class="ch3">${ic('clipboard-check',14)} Rondering</h3>
        <button class="btn bghost bxs" style="font-size:10px;font-weight:700;padding:3px 7px;gap:3px;" onclick="Router.showPage('pg-rondering')">
          Visa alla ${ic('arrow-right',10)}
        </button>
      </div>
      <div class="card-body" style="padding:10px 14px;">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">
          <div style="border:1px solid var(--br);border-radius:8px;padding:10px 8px;text-align:center;cursor:pointer;background:#fff;" onclick="Router.showPage('pg-rondering')">
            <div style="font-size:20px;font-weight:900;color:var(--navy);">${(state.ronderingar||[]).filter(r=>r.status==='planerad').length}</div>
            <div style="font-size:10px;color:var(--mt);font-weight:500;">Planerade</div>
          </div>
          <div style="border:1px solid var(--br);border-radius:8px;padding:10px 8px;text-align:center;cursor:pointer;background:#fff;" onclick="Router.showPage('pg-rondering')">
            <div style="font-size:20px;font-weight:900;color:${oppnaAvvikelser.length>0?'var(--rd)':'var(--navy)'};">${oppnaAvvikelser.length}</div>
            <div style="font-size:10px;color:var(--mt);font-weight:500;">Öppna avvikelser</div>
          </div>
          <div style="border:1px solid var(--br);border-radius:8px;padding:10px 8px;text-align:center;cursor:pointer;background:#fff;" onclick="Router.showPage('pg-rondering',{tab:'mallar'})">
            <div style="font-size:20px;font-weight:900;color:var(--navy);">${(state.ronderingsmallar||[]).filter(m=>m.active).length}</div>
            <div style="font-size:10px;color:var(--mt);font-weight:500;">Aktiva mallar</div>
          </div>
        </div>
        ${forsenade.length > 0 ? `
          <div style="font-size:12px;color:var(--rd);display:flex;align-items:center;gap:6px;margin-bottom:6px;padding:0 2px;">
            ${ic('clock',12)} ${forsenade.length} försenad${forsenade.length===1?'':'e'} rondering${forsenade.length===1?'':'ar'}
            <button class="btn bghost bxs" style="margin-left:auto;font-size:10px;padding:2px 8px;" onclick="Router.showPage('pg-rondering')">Visa</button>
          </div>` : ''}
        ${akutaAvvikelser.length > 0 ? `
          <div style="font-size:12px;color:var(--or);display:flex;align-items:center;gap:6px;margin-bottom:6px;padding:0 2px;">
            ${ic('alert-triangle',12)} ${akutaAvvikelser.length} akut/hög avvikelse${akutaAvvikelser.length===1?'':'r'}
            <button class="btn bghost bxs" style="margin-left:auto;font-size:10px;padding:2px 8px;" onclick="Router.showPage('pg-rondering')">Visa</button>
          </div>` : ''}
        ${avvUanAO.length > 0 ? `<div style="font-size:11px;color:var(--mt);padding:4px 0;">${ic('info',11)} ${avvUanAO.length} avvikelse${avvUanAO.length===1?'':'r'} saknar arbetsorder</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
          <button class="btn bp bsm" onclick="RonderingPage.openNewRondering()">${ic('plus',13)} Ny rondering</button>
          <button class="btn bs bsm" onclick="Router.showPage('pg-rondering',{tab:'mallar'})">${ic('layout-template',13)} Mallar</button>
        </div>
      </div>
    </div>`;
  },

  /* ── Beräkningar ───────────────────────────────────────────────────── */
  _calcKPIs() {
    const today    = tdy();
    const monthStr = today.substring(0, 7);
    const aos      = (state.workOrders || []).filter(a => !a.archived && !a.deleted);
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
    const aos   = (state.workOrders || []).filter(a => !a.archived && !a.deleted);

    if (Auth.canAny(['ao_view_all','ao_view_own'])) {
      const akut = aos.filter(a => a.priority==='akut' && !['klar','fakturerad','avbruten'].includes(a.status));
      if (akut.length > 0) todos.push({
        icon:'alert-triangle', iconCls:'red', cls:'urgent',
        title:'Akuta ordrar kräver omedelbar åtgärd',
        sub: akut.map(a=>a.title).slice(0,2).join(', ')+(akut.length>2?` +${akut.length-2} till`:''),
        badge:akut.length, badgeCls:'',
        onClick:"Router.showPage('pg-ao',{filter:'akut'})"
      });

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
    }

    if (Auth.canAny(['invoice_view','invoice_create'])) {
      const readyBill = aos.filter(a => a.status==='klar' && !a.invoiceId);
      if (readyBill.length > 0) todos.push({
        icon:'receipt', iconCls:'orange',
        title:'Klara ordrar utan fakturaunderlag',
        sub:readyBill.length+' order'+(readyBill.length===1?'':'ar')+' redo för fakturering',
        badge:readyBill.length, badgeCls:'orange',
        onClick:"Router.showPage('pg-ao',{filter:'readyForInvoice'})"
      });
    }

    if (Auth.can('offer_manage')) {
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
    }

    if (Auth.can('sales_manage')) {
      const salesActive = SalesService.getActive();
      const salesCount = salesActive.length;
      /* V46 R3: samma Förfallen-semantik som SalesPage/Dashboard-widgeten. */
      const salesOverdueCount = salesActive.filter(o =>
        o.dueDate && o.dueDate < tdy() && this._SALES_ACTIVE_STATUSES.includes(o.status)
      ).length;
      if (salesCount > 0) todos.push({
        icon:'target', iconCls:'purple',
        title:'Säljchanser att agera på',
        sub: salesOverdueCount > 0
          ? salesOverdueCount+' '+(salesOverdueCount===1?'förfallen':'förfallna')+' · '+salesCount+' aktiv'+(salesCount===1?'':'a')+' säljchans'+(salesCount===1?'':'er')
          : salesCount+' aktiv'+(salesCount===1?'':'a')+' säljchans'+(salesCount===1?'':'er'),
        badge:salesCount, badgeCls:'purple',
        onClick:"Router.showPage('pg-sales')"
      });
    }

    return todos;
  },

  _calcOverdueActivities() {
    try { return ActivitiesService.getStats().overdue || 0; } catch(e) { return 0; }
  },

  _recurringDue() {
    return (state.recurringOrders||[]).filter(r => {
      if (r.status !== 'aktiv' || !r.nextDate) return false;
      var days = Math.ceil((new Date(r.nextDate) - new Date(tdy())) / 86400000);
      return days <= 7;
    });
  },

  /* ── Bakåtkompatibilitet ───────────────────────────────────────────── */
  showAllSales() { Router.showPage('pg-sales'); },
  newWorkOrder() { Router.showPage('pg-ao'); setTimeout(() => WorkOrdersPage.openCreate(), 80); },
  newCustomer()  { Router.showPage('pg-crm'); setTimeout(() => CustomersPage.openCreate(), 80); }
};
