/**
 * Router — sidnavigering
 * Hanterar aktivering av sidor och topbar-titel
 */

const Router = {

  history: [],
  _goingBack: false,

  PAGE_TITLES: {
    'pg-dash':        { title: 'Dashboard',            sub: 'Översikt & åtgärder' },
    'pg-ao':          { title: 'Arbetsorder',           sub: 'Alla ordrar' },
    'pg-ao-detail':   { title: 'Arbetsorder',           sub: 'Detalj' },
    'pg-crm':         { title: 'Kunder',                sub: 'Kundregister' },
    'pg-crm-detail':  { title: 'Kundkort',              sub: '' },
    'pg-objects':     { title: 'Fastigheter',           sub: 'Fastighetsregister' },
    'pg-obj-detail':  { title: 'Fastighetskort',        sub: '' },
    'pg-offer':       { title: 'Offerter',              sub: 'Offerthantering' },
    'pg-offer-detail':{ title: 'Offert',                sub: 'Detalj' },
    'pg-invoices':    { title: 'Fakturering',           sub: 'Fakturaunderlag' },
    'pg-inv-detail':  { title: 'Fakturaunderlag',       sub: 'Detalj' },
    'pg-tid':         { title: 'Tid & stämpla',         sub: 'Tidregistrering' },
    'pg-calendar':    { title: 'Kalender',              sub: '' },
    'pg-contracts':   { title: 'Kontrakt',              sub: 'Avtalsregister' },
    'pg-rondering':         { title: 'Rondering',             sub: 'Ronderingsrapporter' },
    'pg-rondering-utfor':   { title: 'Utför rondering',      sub: 'Kontrollpunkter' },
    'pg-rondering-rapport': { title: 'Ronderingsrapport',    sub: 'Sammanfattning & avvikelser' },
    'pg-articles':    { title: 'Artiklar',              sub: 'Artikelregister' },
    'pg-pricegroups': { title: 'Prisgrupper',           sub: 'Timpris & prisgrupper' },
    'pg-payroll':     { title: 'Löneunderlag',          sub: 'Tidrapport per personal' },
    'pg-reports':     { title: 'Rapporter',             sub: 'Statistik & analys' },
    'pg-staff':       { title: 'Personal',              sub: 'Personalregister' },
    'pg-admin':       { title: 'Admin',                 sub: 'Systeminställningar' },
    'pg-recurring':   { title: 'Återkommande ärenden',  sub: 'Schemalagda serviceärenden' },
    'pg-sales':       { title: 'Säljchanser',           sub: 'CRM pipeline' }
  },

  currentPage: null,
  currentParams: {},

  back() {
    const prev = this.history.pop();
    this._goingBack = true;
    if (prev) {
      this.showPage(prev.page, prev.params);
    } else {
      this.showPage('pg-dash');
    }
  },

  showPage(pageId, params = {}) {
    // ── Lägg till i historik ─────────────────────────────────
    if (!this._goingBack && this.currentPage && pageId !== this.currentPage) {
      this.history.push({ page: this.currentPage, params: Object.assign({}, this.currentParams) });
      if (this.history.length > 30) this.history.shift();
    }
    this._goingBack = false;

    // ── Behörighetskontroll ──────────────────────────────────
    if (!Auth.canViewPage(pageId)) {
      showToast('Du saknar behörighet för den sidan');
      // Visa "Ingen behörighet"-meddelande på dashboarden
      document.querySelectorAll('.page.active').forEach(p => p.classList.remove('active'));
      const dash = document.getElementById('pg-dash');
      if (dash) {
        dash.classList.add('active');
        const meta = this.PAGE_TITLES['pg-dash'];
        document.getElementById('topbar-title').textContent = meta.title;
        document.getElementById('topbar-sub').textContent   = meta.sub;
        Sidebar.setActive('pg-dash');
        // Rendera dash med access-denied-banner om vi försökte gå till annan sida
        if (pageId !== 'pg-dash') {
          const pageMeta = this.PAGE_TITLES[pageId] || { title: pageId };
          const el = document.getElementById('dash-content');
          if (el) el.innerHTML = `
            <div class="card" style="border-left:3px solid var(--rd);margin-bottom:12px;">
              <div class="card-body" style="padding:16px;display:flex;align-items:center;gap:12px;">
                <div style="font-size:24px;">🔒</div>
                <div>
                  <div style="font-weight:800;color:var(--rd);font-size:14px;">Ingen behörighet</div>
                  <div style="font-size:12px;color:var(--mt);margin-top:2px;">
                    Du har inte tillgång till <strong>${pageMeta.title}</strong>.
                    Kontakta en administratör om du anser att detta är fel.
                  </div>
                </div>
              </div>
            </div>` + (el.innerHTML || '');
          Dashboard.render();
        } else {
          Dashboard.render();
        }
      }
      return;
    }

    // Stäng sidebar på mobil
    if (window.innerWidth < 1024) Sidebar.close();

    // Deaktivera gamla sidan
    document.querySelectorAll('.page.active').forEach(p => p.classList.remove('active'));

    // Aktivera nya sidan
    const page = document.getElementById(pageId);
    if (!page) {
      console.warn(`[Router] Sida inte hittad: ${pageId}`);
      return;
    }
    page.classList.add('active');

    // Uppdatera topbar
    const meta = this.PAGE_TITLES[pageId] || { title: pageId, sub: '' };
    document.getElementById('topbar-title').textContent = meta.title;
    document.getElementById('topbar-sub').textContent   = meta.sub;

    // Uppdatera sidebar aktiv-markering
    Sidebar.setActive(pageId);

    // Uppdatera state
    this.currentPage   = pageId;
    this.currentParams = params;
    state.currentPage  = pageId;

    // Kör sidans render-funktion om den finns
    const renderers = {
      'pg-dash':        () => Dashboard.render(),
      'pg-ao':          () => WorkOrdersPage.render(params),
      'pg-ao-detail':   () => WorkOrderDetailPage.render(params),
      'pg-crm':         () => CustomersPage.render(),
      'pg-crm-detail':  () => CustomerDetailPage.render(params),
      'pg-objects':     () => PropertiesPage.render(),
      'pg-obj-detail':  () => PropertyDetailPage.render(params),
      'pg-offer':       () => OffersPage.render(),
      'pg-offer-detail':() => OfferDetailPage.render(params),
      'pg-invoices':    () => InvoicesPage.render(),
      'pg-inv-detail':  () => InvoiceDetailPage.render(params),
      'pg-tid':         () => TimePage.render(),
      'pg-calendar':    () => CalendarPage.render(),
      'pg-contracts':   () => ContractsPage.render(),
      'pg-rondering':         () => RonderingPage.render(params),
      'pg-rondering-utfor':   () => RonderingUtforandePage.render(params),
      'pg-rondering-rapport': () => RonderingRapportPage.render(params),
      'pg-payroll':     () => PayrollPage.render(),
      'pg-reports':     () => ReportsPage.render(),
      'pg-articles':    () => ArticlesPage.render(),
      'pg-pricegroups': () => PriceGroupsPage.render(),
      'pg-staff':       () => StaffPage.render(),
      'pg-admin':       () => AdminPage.render(),
      'pg-recurring':   () => RecurringPage.render(),
      'pg-sales':       () => SalesPage.render()
    };

    const renderer = renderers[pageId];
    if (renderer) {
      try {
        renderer();
      } catch (e) {
        console.error(`[Router] Render-fel för ${pageId}:`, e);
        const con = page.querySelector('.con') || page;
        con.innerHTML = `<div style="padding:20px;"><div class="ibox" style="border-left:3px solid var(--rd);"><strong>Sidfel: ${pageId}</strong><br><code style="font-size:11px;word-break:break-all;">${e.message}</code></div></div>`;
      }
    }

    // Scrolla till topp
    const scroll = document.getElementById('content-scroll');
    if (scroll) scroll.scrollTop = 0;
  }
};
