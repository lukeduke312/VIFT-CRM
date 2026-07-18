/**
 * Router v18 — sidnavigering + fullständig hash-baserad routing
 * Alla sidor reflekteras i URL-hashen (#/ao/AO-016 osv.)
 * Browser back + swipe-back delar samma historik via pushState/popstate.
 */

const Router = {

  history: [],
  _goingBack: false,

  /* ── Hash-routing ──────────────────────────────────────── */

  /*
   * Generera hash-sträng för en sida + params.
   * Returnerar sträng utan #-prefix, t.ex. '/ao/AO-016'.
   */
  _hashForPage(pageId, params) {
    const p = params || {};
    switch (pageId) {
      case 'pg-dash':             return '/dashboard';
      case 'pg-ao':               return '/ao';
      case 'pg-ao-detail':        return p.aoId ? '/ao/' + p.aoId : '/ao';
      case 'pg-crm':              return '/kunder';
      case 'pg-crm-detail':       return p.customerId ? '/kunder/' + p.customerId : '/kunder';
      case 'pg-objects':          return '/fastigheter';
      case 'pg-obj-detail':       return p.propId ? '/fastigheter/' + p.propId : '/fastigheter';
      case 'pg-propobj-detail':   return p.objId ? '/objekt/' + p.objId : '/fastigheter';
      case 'pg-import-wizard':    return '/importera/' + (p.type || 'kunder');
      case 'pg-offer':            return '/offerter';
      case 'pg-offer-detail':     return p.offerId ? '/offerter/' + p.offerId : '/offerter';
      case 'pg-invoices':         return '/fakturaunderlag';
      case 'pg-inv-detail':       return p.invoiceId ? '/fakturaunderlag/' + p.invoiceId : '/fakturaunderlag';
      case 'pg-tid':              return '/tid';
      case 'pg-calendar':         return '/kalender';
      case 'pg-contracts':        return '/kontrakt';
      case 'pg-rondering':        return '/rondering';
      case 'pg-rondering-wizard': return '/rondering/ny';
      case 'pg-rondering-utfor':  return p.passId ? '/rondering/utfor/' + p.passId : '/rondering';
      case 'pg-rondering-rapport':return p.passId ? '/rondering/rapport/' + p.passId : '/rondering';
      case 'pg-payroll':          return '/loneunderlag';
      case 'pg-reports':          return '/rapporter';
      case 'pg-articles':         return '/artiklar';
      case 'pg-pricegroups':      return '/prisgrupper';
      case 'pg-staff':            return '/personal';
      case 'pg-admin':            return '/admin';
      case 'pg-recurring':        return '/aterkommande';
      case 'pg-sales':            return '/saljchanser';
      case 'pg-activities':       return '/aktiviteter';
      case 'pg-service-templates':return '/offerttjanster';
      case 'pg-myjobs':           return '/minajobb';
      case 'pg-operations':       return '/drift';
      default:                    return null;
    }
  },

  /*
   * Läs aktuell hash vid start och navigera till rätt sida.
   * Anropas av App.showApp() direkt efter inloggning.
   * Stödjer gamla #ao=AO-ID och #pass=ID för bakåtkompatibilitet.
   */
  initFromHash() {
    const raw = (window.location.hash || '').slice(1); // utan #-tecknet

    /* ── Bakåtkompatibla gamla format ─────────── */
    if (raw.startsWith('ao='))   { this.showPage('pg-ao-detail',        { aoId:   raw.slice(3) }, { replace: true }); return; }
    if (raw.startsWith('pass=')) { this.showPage('pg-rondering-rapport', { passId: raw.slice(5) }, { replace: true }); return; }

    /* ── Parsa nytt /path/segment-format ─────── */
    const parts = raw.replace(/^\//, '').split('/');
    const s0 = parts[0] || '';
    const s1 = parts[1] || '';
    const s2 = parts[2] || '';

    switch (s0) {
      case '':
      case 'dashboard':
        this.showPage('pg-dash', {}, { replace: true }); return;

      case 'ao':
        if (s1) { this.showPage('pg-ao-detail', { aoId: s1 }, { replace: true }); return; }
        this.showPage('pg-ao', {}, { replace: true }); return;

      case 'kunder':
        if (s1) { this.showPage('pg-crm-detail', { customerId: s1 }, { replace: true }); return; }
        this.showPage('pg-crm', {}, { replace: true }); return;

      case 'fastigheter':
        if (s1) { this.showPage('pg-obj-detail', { propId: s1 }, { replace: true }); return; }
        this.showPage('pg-objects', {}, { replace: true }); return;

      case 'objekt':
        if (s1) { this.showPage('pg-propobj-detail', { objId: s1 }, { replace: true }); return; }
        this.showPage('pg-objects', {}, { replace: true }); return;

      case 'offerter':
        if (s1) { this.showPage('pg-offer-detail', { offerId: s1 }, { replace: true }); return; }
        this.showPage('pg-offer', {}, { replace: true }); return;

      case 'fakturaunderlag':
        if (s1) { this.showPage('pg-inv-detail', { invoiceId: s1 }, { replace: true }); return; }
        this.showPage('pg-invoices', {}, { replace: true }); return;

      case 'rondering':
        if (s1 === 'utfor'   && s2) { this.showPage('pg-rondering-utfor',   { passId: s2 }, { replace: true }); return; }
        if (s1 === 'rapport' && s2) { this.showPage('pg-rondering-rapport',  { passId: s2 }, { replace: true }); return; }
        if (s1 === 'ny')            { this.showPage('pg-rondering-wizard',   {},             { replace: true }); return; }
        this.showPage('pg-rondering', {}, { replace: true }); return;

      case 'admin':         this.showPage('pg-admin',            {}, { replace: true }); return;
      case 'aterkommande':  this.showPage('pg-recurring',        {}, { replace: true }); return;
      case 'tid':           this.showPage('pg-tid',              {}, { replace: true }); return;
      case 'kalender':      this.showPage('pg-calendar',         {}, { replace: true }); return;
      case 'kontrakt':      this.showPage('pg-contracts',        {}, { replace: true }); return;
      case 'loneunderlag':  this.showPage('pg-payroll',          {}, { replace: true }); return;
      case 'rapporter':     this.showPage('pg-reports',          {}, { replace: true }); return;
      case 'artiklar':      this.showPage('pg-articles',         {}, { replace: true }); return;
      case 'prisgrupper':   this.showPage('pg-pricegroups',      {}, { replace: true }); return;
      case 'personal':      this.showPage('pg-staff',            {}, { replace: true }); return;
      case 'saljchanser':   this.showPage('pg-sales',            {}, { replace: true }); return;
      case 'aktiviteter':   this.showPage('pg-activities',       {}, { replace: true }); return;
      case 'offerttjanster':this.showPage('pg-service-templates',{}, { replace: true }); return;
      case 'minajobb':      this.showPage('pg-myjobs',           {}, { replace: true }); return;
      case 'drift':         this.showPage('pg-operations',       {}, { replace: true }); return;
      case 'importera':     this.showPage('pg-import-wizard', { type: s1 || 'customer' }, { replace: true }); return;
    }

    /* Fallback: dashboard */
    this.showPage('pg-dash', {}, { replace: true });
  },

  PAGE_TITLES: {
    'pg-dash':        { title: 'Dashboard',            sub: 'Översikt & åtgärder' },
    'pg-ao':          { title: 'Arbetsorder',           sub: 'Alla ordrar' },
    'pg-ao-detail':   { title: 'Arbetsorder',           sub: 'Detalj' },
    'pg-crm':         { title: 'Kunder',                sub: 'Kundregister' },
    'pg-crm-detail':  { title: 'Kundkort',              sub: '' },
    'pg-objects':     { title: 'Fastigheter',           sub: 'Fastighetsregister' },
    'pg-obj-detail':  { title: 'Fastighetskort',        sub: '' },
    'pg-propobj-detail': { title: 'Objekt',             sub: 'Lägenhet / lokal' },
    'pg-offer':       { title: 'Offerter',              sub: 'Offerthantering' },
    'pg-offer-detail':{ title: 'Offert',                sub: 'Detalj' },
    'pg-invoices':    { title: 'Fakturering',           sub: 'Fakturaunderlag' },
    'pg-inv-detail':  { title: 'Fakturaunderlag',       sub: 'Detalj' },
    'pg-tid':         { title: 'Tid & stämpla',         sub: 'Tidregistrering' },
    'pg-calendar':    { title: 'Kalender',              sub: '' },
    'pg-contracts':   { title: 'Kontrakt',              sub: 'Avtalsregister' },
    'pg-rondering':         { title: 'Rondering',             sub: 'Ronderingsrapporter' },
    'pg-rondering-wizard':  { title: 'Ny rondering',         sub: 'Steg-för-steg setup' },
    'pg-rondering-utfor':   { title: 'Utför rondering',      sub: 'Kontrollpunkter' },
    'pg-rondering-rapport': { title: 'Ronderingsrapport',    sub: 'Sammanfattning & avvikelser' },
    'pg-articles':    { title: 'Artiklar',              sub: 'Artikelregister' },
    'pg-pricegroups': { title: 'Prisgrupper',           sub: 'Timpris & prisgrupper' },
    'pg-payroll':     { title: 'Löneunderlag',          sub: 'Tidrapport per personal' },
    'pg-reports':     { title: 'Rapporter',             sub: 'Statistik & analys' },
    'pg-staff':       { title: 'Personal',              sub: 'Personalregister' },
    'pg-admin':       { title: 'Admin',                 sub: 'Systeminställningar' },
    'pg-recurring':   { title: 'Återkommande ärenden',  sub: 'Schemalagda serviceärenden' },
    'pg-sales':       { title: 'Säljchanser',           sub: 'CRM pipeline' },
    'pg-activities':        { title: 'Att göra',              sub: 'Uppföljningar & åtgärder' },
    'pg-service-templates': { title: 'Offerttjänster',         sub: 'Tjänster & prismodeller' },
    'pg-myjobs':            { title: 'Mina jobb',              sub: 'Tilldelade uppdrag & pool' },
    'pg-operations':        { title: 'Dagens drift',           sub: 'Chefsöversikt & driftläge' },
    'pg-import-wizard':     { title: 'Importera',              sub: 'CSV- och XLSX-import' }
  },

  currentPage: null,
  currentParams: {},

  /*
   * Gå tillbaka: delegera till browser history (pushState-baserat).
   * Swipe-gesten anropar också back() — delar exakt samma historik.
   * Fallback till Router.history om browser history inte är tillgänglig.
   */
  back() {
    if (window.history && window.history.length > 1) {
      window.history.back(); // utlöser popstate → _restoreFromState
      return;
    }
    /* Fallback utan browserhistorik */
    const prev = this.history.pop();
    this._goingBack = true;
    this.showPage(prev ? prev.page : 'pg-dash', prev ? prev.params : {}, { replace: true });
  },

  /* Intern: återställ sida från popstate utan att lägga till ny historikpost */
  _restoreFromState(pageId, params) {
    this._goingBack = true;
    this.showPage(pageId, params || {}, { replace: true });
  },

  /*
   * Navigera till en sida.
   * opts.replace = true → history.replaceState (vid back/restore/init)
   * opts.replace = false (default) → history.pushState (vid framåtnavigering)
   */
  showPage(pageId, params = {}, opts = {}) {
    const doReplace = opts.replace === true;

    // ── Lägg till i historik ─────────────────────────────────
    if (!this._goingBack && !doReplace && this.currentPage && pageId !== this.currentPage) {
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

    // Uppdatera URL-hash + browser-historik
    const hash = this._hashForPage(pageId, params);
    if (hash) {
      const histState = { pageId, params };
      try {
        if (doReplace) {
          history.replaceState(histState, '', '#' + hash);
        } else {
          history.pushState(histState, '', '#' + hash);
        }
      } catch(e) {}
    }

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
      'pg-rondering-wizard':  () => RonderingWizardPage.render(params),
      'pg-rondering-utfor':   () => RonderingUtforandePage.render(params),
      'pg-rondering-rapport': () => RonderingRapportPage.render(params),
      'pg-payroll':     () => PayrollPage.render(),
      'pg-reports':     () => ReportsPage.render(),
      'pg-articles':    () => ArticlesPage.render(),
      'pg-pricegroups': () => PriceGroupsPage.render(),
      'pg-staff':       () => StaffPage.render(),
      'pg-admin':       () => AdminPage.render(),
      'pg-recurring':   () => RecurringPage.render(),
      'pg-sales':       () => SalesPage.render(),
      'pg-activities':        () => ActivitiesPage.render(params),
      'pg-service-templates': () => ServiceTemplatesPage.render(),
      'pg-myjobs':            () => MyJobsPage.render(),
      'pg-operations':        () => OperationsPage.render(),
      'pg-propobj-detail':    () => PropertyObjectPage.render(params),
      'pg-import-wizard':     () => ImportWizardPage.render(params)
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
