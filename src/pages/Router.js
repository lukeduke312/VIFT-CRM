/**
 * Router — sidnavigering
 * Hanterar aktivering av sidor och topbar-titel
 */

const Router = {

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
    'pg-rondering':   { title: 'Rondering',             sub: 'Ronderingsrapporter' },
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

  showPage(pageId, params = {}) {
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
      'pg-ao':          () => WorkOrdersPage.render(),
      'pg-ao-detail':   () => WorkOrderDetailPage.render(params),
      'pg-crm':         () => CustomersPage.render(),
      'pg-crm-detail':  () => CustomerDetailPage.render(params),
      'pg-objects':     () => PropertiesPage.render(),
      'pg-offer':       () => OffersPage.render(),
      'pg-offer-detail':() => OfferDetailPage.render(params),
      'pg-invoices':    () => InvoicesPage.render(),
      'pg-inv-detail':  () => InvoiceDetailPage.render(params),
      'pg-tid':         () => TimePage.render(),
      'pg-calendar':    () => CalendarPage.render(),
      'pg-contracts':   () => ContractsPage.render(),
      'pg-rondering':   () => InspectionsPage.render(),
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
