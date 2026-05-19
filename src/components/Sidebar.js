/**
 * Sidebar — enda nav-systemet
 * Drawer på mobil, fast sidebar på desktop
 */

const Sidebar = {

  NAV_ITEMS: [
    // Sektion: Huvud
    { section: 'Huvudmeny' },
    { id: 'pg-dash',     icon: '⊞',  label: 'Dashboard',     page: 'pg-dash' },
    { id: 'pg-ao',       icon: '📋',  label: 'Arbetsorder',   page: 'pg-ao',   badgeKey: 'aoNew' },
    { id: 'pg-crm',      icon: '👥',  label: 'Kunder',        page: 'pg-crm' },
    { id: 'pg-offer',    icon: '📄',  label: 'Offerter',      page: 'pg-offer' },
    { id: 'pg-invoices', icon: '💰',  label: 'Fakturering',   page: 'pg-invoices' },
    // Sektion: Fastigheter
    { section: 'Fastigheter' },
    { id: 'pg-objects',  icon: '🏢',  label: 'Fastigheter',   page: 'pg-objects' },
    { id: 'pg-contracts',icon: '📝',  label: 'Kontrakt',      page: 'pg-contracts' },
    { id: 'pg-rondering',icon: '🔍',  label: 'Rondering',     page: 'pg-rondering' },
    // Sektion: Tid & Administration
    { section: 'Tid & Admin' },
    { id: 'pg-tid',      icon: '⏱',  label: 'Tid & stämpla', page: 'pg-tid' },
    { id: 'pg-calendar', icon: '📅',  label: 'Kalender',      page: 'pg-calendar' },
    { id: 'pg-reports',  icon: '📊',  label: 'Rapporter',     page: 'pg-reports' },
    // Sektion: Register
    { section: 'Register' },
    { id: 'pg-articles',    icon: '📦', label: 'Artiklar',      page: 'pg-articles' },
    { id: 'pg-pricegroups', icon: '💲', label: 'Prisgrupper',   page: 'pg-pricegroups' },
    { id: 'pg-payroll',     icon: '💼', label: 'Löneunderlag',  page: 'pg-payroll' },
    // Sektion: System
    { section: 'System' },
    { id: 'pg-staff',    icon: '👤',  label: 'Personal',      page: 'pg-staff' },
    { id: 'pg-admin',    icon: '⚙️',  label: 'Admin',         page: 'pg-admin' }
  ],

  render() {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;

    const user = state.currentUser;
    const initials = user
      ? (user.firstName || 'A').charAt(0) + (user.lastName || '').charAt(0)
      : 'VF';
    const userName   = user ? `${user.firstName} ${user.lastName}`.trim() : 'VIFT';
    const userRole   = user ? user.role : '';

    let html = `
      <div class="nav-brand">
        <div class="nav-brand-logo">
          <span style="font-size:18px;font-weight:900;color:var(--navy);">VIFT</span>
        </div>
        <div class="nav-brand-name">Fastighetsservice & Förvaltning</div>
      </div>`;

    let inSection = false;
    this.NAV_ITEMS.forEach(item => {
      if (item.section) {
        if (inSection) html += '</div>';
        html += `<div class="nav-section"><div class="nav-section-label">${item.section}</div>`;
        inSection = true;
        return;
      }
      const badge = this._getBadge(item.badgeKey);
      html += `
        <button class="ni" id="nav-${item.id}" onclick="Router.showPage('${item.page}')">
          <span class="ico">${item.icon}</span>
          <span class="lbl">${item.label}</span>
          ${badge ? `<span class="nbdg">${badge}</span>` : ''}
        </button>`;
    });

    if (inSection) html += '</div>';

    html += `
      <div class="nav-spacer"></div>
      <div class="nav-user">
        <div class="nav-user-row" onclick="Sidebar.userMenu()">
          <div class="nav-user-avatar">${initials}</div>
          <div>
            <div class="nav-user-name">${userName}</div>
            ${userRole ? `<div class="nav-user-role">${cap(userRole)}</div>` : ''}
          </div>
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
    document.body.style.overflow = 'hidden';
  },

  close() {
    document.getElementById('bottom-nav').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
    document.body.style.overflow = '';
  },

  toggle() {
    const nav = document.getElementById('bottom-nav');
    if (nav.classList.contains('open')) {
      this.close();
    } else {
      this.open();
    }
  },

  userMenu() {
    Modal.open({
      title: state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}` : 'Användare',
      body: `<p style="font-size:13px;color:var(--mt);margin-bottom:12px;">Roll: ${state.currentUser ? cap(state.currentUser.role) : '—'}</p>`,
      buttons: [
        { label: 'Logga ut', cls: 'btn bd bfull', onClick: () => { Modal.close(); Auth.logout(); } },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _getBadge(key) {
    if (!key) return null;
    if (key === 'aoNew') {
      const count = (state.workOrders || []).filter(o => o.status === 'nytt').length;
      return count > 0 ? count : null;
    }
    return null;
  }
};
