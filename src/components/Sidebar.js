/**
 * Sidebar — enda nav-systemet
 * Drawer på mobil, fast sidebar på desktop
 */

const Sidebar = {

  NAV_ITEMS: [
    { section: 'Huvudmeny' },
    { id: 'pg-dash',       icon: 'dashboard',        label: 'Dashboard' },
    { id: 'pg-myjobs',     icon: 'briefcase',        label: 'Mina jobb',    badgeKey: 'myJobsToday' },
    { id: 'pg-ao',         icon: 'clipboard-list',   label: 'Arbetsorder',  badgeKey: 'aoNew' },
    { id: 'pg-crm',        icon: 'users',            label: 'Kunder' },
    { id: 'pg-offer',      icon: 'file-text',        label: 'Offerter' },
    { id: 'pg-sales',      icon: 'target',           label: 'Säljchanser',  badgeKey: 'salesNew' },
    { id: 'pg-activities', icon: 'bell',             label: 'Aktiviteter',  badgeKey: 'activitiesOverdue' },
    { id: 'pg-invoices',   icon: 'receipt',          label: 'Fakturering' },
    { section: 'Fastigheter' },
    { id: 'pg-objects',    icon: 'building-2',       label: 'Fastigheter' },
    { id: 'pg-contracts',  icon: 'file-check',       label: 'Kontrakt' },
    { id: 'pg-rondering',  icon: 'clipboard-check',  label: 'Rondering' },
    { section: 'Tid & Admin' },
    { id: 'pg-operations', icon: 'layout-dashboard',  label: 'Dagens drift',  badgeKey: 'operationsAlert' },
    { id: 'pg-recurring',  icon: 'refresh-cw',        label: 'Återkommande' },
    { id: 'pg-tid',        icon: 'clock',            label: 'Tid & stämpla' },
    { id: 'pg-calendar',   icon: 'calendar',         label: 'Kalender' },
    { id: 'pg-reports',    icon: 'bar-chart-2',      label: 'Rapporter' },
    { section: 'Register' },
    { id: 'pg-articles',   icon: 'package',          label: 'Artiklar' },
    { id: 'pg-pricegroups',icon: 'dollar-sign',      label: 'Prisgrupper' },
    { id: 'pg-payroll',    icon: 'wallet',           label: 'Löneunderlag' },
    { section: 'System' },
    { id: 'pg-staff',      icon: 'user-cog',         label: 'Personal' },
    { id: 'pg-admin',      icon: 'settings',         label: 'Admin' }
  ],

  render() {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;

    const user = state.currentUser;
    const initials = user
      ? (user.firstName || 'A').charAt(0) + (user.lastName || '').charAt(0)
      : 'VF';
    const userName = user ? `${user.firstName} ${user.lastName}`.trim() : 'VIFT';
    const userRole = user ? cap(user.role) : '';

    const brandLogo  = BrandingService.logoDark();
    const collapsed  = document.body.classList.contains('sidebar-collapsed');
    let html = `
      <div class="nav-brand">
        <img src="${brandLogo}" class="nav-brand-img" alt="VIFT"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="nav-brand-fb" style="display:none;">
          <div class="nav-brand-fb-vift">VIFT</div>
          <div class="nav-brand-fb-sub">Fastighetsservice</div>
        </div>
        <button class="nav-collapse-btn" onclick="Sidebar.toggleCollapse()" title="${collapsed?'Expandera meny':'Fäll ihop meny'}">
          ${ic(collapsed?'chevrons-right':'chevrons-left', 14)}
        </button>
      </div>
      <div class="nav-scroll">`;

    let inSection = false;
    let sectionHasItems = false;
    let pendingSection  = '';

    this.NAV_ITEMS.forEach(item => {
      if (item.section) {
        // Close previous section if it had visible items
        if (inSection && sectionHasItems) html += '</div>';
        // Queue new section header — only written lazily when a visible item appears
        pendingSection = `<div class="nav-section"><div class="nav-section-label">${item.section}</div>`;
        inSection = true;
        sectionHasItems = false;
        return;
      }

      // Skip pages the user cannot access
      if (!Auth.canViewPage(item.id)) return;

      // Lazily flush pending section header before first visible item
      if (inSection && !sectionHasItems) {
        html += pendingSection;
        sectionHasItems = true;
      }

      const badge = this._getBadge(item.badgeKey);
      html += `
        <button class="ni" id="nav-${item.id}" onclick="Router.showPage('${item.id}')">
          <span class="ico">${ic(item.icon)}</span>
          <span class="lbl">${item.label}</span>
          ${badge ? `<span class="nbdg">${badge}</span>` : ''}
        </button>`;
    });

    // Close the last section if it had items
    if (inSection && sectionHasItems) html += '</div>';

    html += `
      </div><!-- /nav-scroll -->
      <div class="nav-user">
        <div class="nav-user-row" onclick="Sidebar.userMenu()">
          <div class="nav-user-avatar">${initials}</div>
          <div style="flex:1;min-width:0;">
            <div class="nav-user-name">${userName}</div>
            ${userRole ? `<div class="nav-user-role">${userRole}</div>` : ''}
          </div>
          <span style="color:rgba(255,255,255,.35);">${ic('log-out', 14)}</span>
        </div>
      </div>`;

    nav.innerHTML = html;
  },

  setActive(pageId) {
    document.querySelectorAll('#bottom-nav .ni').forEach(el => el.classList.remove('on'));
    const btn = document.getElementById(`nav-${pageId}`);
    if (btn) btn.classList.add('on');
  },

  open() {
    document.getElementById('bottom-nav').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('open');
  },

  close() {
    document.getElementById('bottom-nav').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
  },

  toggle() {
    document.getElementById('bottom-nav').classList.contains('open')
      ? this.close() : this.open();
  },

  toggleCollapse() {
    const collapsed = document.body.classList.toggle('sidebar-collapsed');
    const user = Auth.getUser ? Auth.getUser() : state.currentUser;
    if (user) UserPrefsService.save(user.id, { sidebarCollapsed: collapsed });
    // Re-render just the brand area to flip the chevron icon
    this.render();
  },

  userMenu() {
    Modal.open({
      title: state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}` : 'Användare',
      body: `<p style="font-size:13px;color:var(--mt);margin-bottom:4px;">Roll: ${state.currentUser ? cap(state.currentUser.role) : '—'}</p>
             <p style="font-size:13px;color:var(--mt);">Inloggad: ${state.currentUser ? state.currentUser.username : '—'}</p>`,
      buttons: [
        { label: 'Logga ut', cls: 'btn bd bfull', onClick: () => { Modal.close(); Auth.logout(); } },
        { label: 'Avbryt',   cls: 'btn bs',        onClick: () => Modal.close() }
      ]
    });
  },

  updateBadges() {
    [
      { key: 'aoNew',              navId: 'nav-pg-ao' },
      { key: 'salesNew',           navId: 'nav-pg-sales' },
      { key: 'activitiesOverdue',  navId: 'nav-pg-activities' },
      { key: 'operationsAlert',    navId: 'nav-pg-operations' }
    ].forEach(({ key, navId }) => {
      const badge  = this._getBadge(key);
      const navBtn = document.getElementById(navId);
      if (!navBtn) return;
      let el = navBtn.querySelector('.nbdg');
      if (badge) {
        if (!el) {
          el = document.createElement('span');
          el.className = 'nbdg';
          navBtn.appendChild(el);
        }
        el.textContent = badge;
        el.style.display = '';
      } else if (el) {
        el.style.display = 'none';
      }
    });
  },

  _getBadge(key) {
    if (!key) return null;
    if (key === 'myJobsToday') {
      const myId = state.currentUser ? state.currentUser.id : null;
      if (!myId) return null;
      const today = tdy();
      const n = (state.workOrders || []).filter(ao =>
        !ao.archived && !ao.deleted &&
        (ao.staff || []).includes(myId) &&
        ao.scheduledDate === today &&
        !['klar','fakturerad','avbruten'].includes(ao.status)
      ).length;
      return n > 0 ? n : null;
    }
    if (key === 'aoNew') {
      const n = (state.workOrders || []).filter(o => o.status === 'nytt').length;
      return n > 0 ? n : null;
    }
    if (key === 'salesNew') {
      const n = (state.salesOpportunities || []).filter(function(s) {
        return ['new', 'contacted', 'contact_needed'].includes(s.status);
      }).length;
      return n > 0 ? n : null;
    }
    if (key === 'activitiesOverdue') {
      const today = tdy();
      const n = (state.activities || []).filter(a => a.status === 'open' && a.dueDate && a.dueDate < today).length;
      return n > 0 ? n : null;
    }
    if (key === 'operationsAlert') {
      const today = tdy();
      const all   = (state.workOrders || []).filter(ao => !ao.archived && !ao.deleted);
      const alive = ao => !['klar','fakturerad','avbruten'].includes(ao.status);
      const n = all.filter(ao =>
        (ao.scheduledDate && ao.scheduledDate < today && alive(ao) && ao.status !== 'pool') ||
        (ao.priority === 'akut' && alive(ao)) ||
        ((ao.staff||[]).length === 0 && alive(ao) && !['pool','avbruten'].includes(ao.status))
      ).length;
      return n > 0 ? n : null;
    }
    return null;
  }
};

// Re-render sidebar whenever branding changes (logo upload etc.)
document.addEventListener('brandingUpdated', () => Sidebar.render());
