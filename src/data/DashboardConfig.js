/**
 * DashboardConfig v49 — Widget-moduler, behörigheter, rollbaserade standardlayouter
 * och per-användarlayouter.
 *
 * requiredPermissions: ANY av dessa räcker (tom array = alla inloggade)
 * defaultSize: 'full' | 'half' | 'third'
 * description: visas i "Anpassa dashboard"-modalen
 */
const DashboardConfig = {

  /* ── Modul-registry ───────────────────────────────────────────────────── */
  MODULES: {
    overdue_alert: { id:'overdue_alert', title:'Försenade aktiviteter',  icon:'alert-triangle',  category:'Översikt',       description:'Varnar om försenade uppföljningar och aktiviteter',           requiredPermissions:['dashboard_view'],                        defaultSize:'full'  },
    kpi:           { id:'kpi',           title:'Nyckeltal',              icon:'bar-chart-2',     category:'Översikt',       description:'Nyckeltal för arbetsorder, offerter och fakturering',          requiredPermissions:['ao_view_all','ao_view_own','ao_time'],    defaultSize:'full'  },
    todos:         { id:'todos',         title:'Kräver åtgärd',          icon:'alert-circle',    category:'Översikt',       description:'Åtgärder som kräver omedelbar uppmärksamhet',                 requiredPermissions:['dashboard_view'],                        defaultSize:'full'  },
    today:         { id:'today',         title:'Ordrar idag',            icon:'calendar',        category:'Arbete',         description:'Schemalagda arbetsorder för dagens datum',                    requiredPermissions:['ao_view_all','ao_view_own'],             defaultSize:'third' },
    pool:          { id:'pool',          title:'Arbetspool',             icon:'inbox',           category:'Arbete',         description:'Arbetsorder i poolen utan tilldelad resurs',                  requiredPermissions:['ao_view_all','ao_view_own'],             defaultSize:'third' },
    stamp:         { id:'stamp',         title:'Stämpla tid',            icon:'clock',           category:'Arbete',         description:'Klocka in och ut, se aktiv stämplingstid',                   requiredPermissions:['ao_time'],                              defaultSize:'third' },
    rondering:     { id:'rondering',     title:'Rondering',              icon:'clipboard-check', category:'Arbete',         description:'Ronderingsschema, ronderingsmallar och öppna avvikelser',      requiredPermissions:['ao_view_all'],                          defaultSize:'full'  },
    recurring:     { id:'recurring',     title:'Återkommande',           icon:'refresh-cw',      category:'Arbete',         description:'Återkommande uppdrag som snart ska skapas',                   requiredPermissions:['recurring_manage'],                      defaultSize:'third' },
    activities:    { id:'activities',    title:'Aktiviteter',            icon:'bell',            category:'Aktiviteter',    description:'Uppföljningar, bokade möten och påminnelser',                 requiredPermissions:['dashboard_view'],                        defaultSize:'full'  },
    sales:         { id:'sales',         title:'Säljchanser',            icon:'target',          category:'Sälj & ekonomi', description:'Aktiva säljchanser att kontakta och följa upp',               requiredPermissions:['sales_manage'],                          defaultSize:'third' },
    offers:        { id:'offers',        title:'Offerter väntar',        icon:'file-text',       category:'Sälj & ekonomi', description:'Skickade offerter som väntar på kundens svar',                requiredPermissions:['offer_manage'],                          defaultSize:'third' },
    activity_log:  { id:'activity_log',  title:'Senaste händelser',      icon:'activity',        category:'System',         description:'Bolagets senaste händelser, ändringar och loggar',            requiredPermissions:['reports_view','staff_view'],             defaultSize:'third' },
    quickbtns:     { id:'quickbtns',     title:'Snabbåtgärder',          icon:'zap',             category:'System',         description:'Skapa ny order, offert eller kund med ett klick',             requiredPermissions:['dashboard_view'],                        defaultSize:'full'  },
  },

  /* ── Rollbaserade standardlayouter ──────────────────────────────────────
     Listar module-ids i önskad visningsordning.
     Moduler som inte listas visas med visible:false (kan aktiveras manuellt).
  ─────────────────────────────────────────────────────────────────────── */
  ROLE_DEFAULTS: {
    admin:    ['overdue_alert','kpi','todos','today','pool','stamp','activities','sales','offers','activity_log','recurring','rondering','quickbtns'],
    chef:     ['overdue_alert','kpi','todos','today','pool','stamp','activities','sales','offers','activity_log','recurring','rondering','quickbtns'],
    personal: ['overdue_alert','kpi','today','pool','stamp','activities','rondering','quickbtns'],
    ekonomi:  ['overdue_alert','kpi','todos','offers','activity_log','quickbtns'],
  },

  getModule(id) { return this.MODULES[id] || null; },
  getAllModules() { return Object.values(this.MODULES); },

  /* Bygg standardlayout för en roll (inkl. alla moduler, icke-default = hidden) */
  getDefaultLayout(roleId) {
    const ids    = this.ROLE_DEFAULTS[roleId] || this.ROLE_DEFAULTS.personal;
    const allIds = Object.keys(this.MODULES);
    const result = [];
    ids.forEach((id, i) => {
      const m = this.MODULES[id];
      if (m) result.push({ id, visible:true, size:m.defaultSize||'full', order:i });
    });
    let next = ids.length;
    allIds.forEach(id => {
      if (!ids.includes(id)) {
        const m = this.MODULES[id];
        if (m) result.push({ id, visible:false, size:m.defaultSize||'full', order:next++ });
      }
    });
    return result;
  },

  /* Hämta användarens sparade layout, fallback till rollstandard */
  getUserLayout(userId, roleId) {
    try {
      const saved = JSON.parse(localStorage.getItem('dashLayout_' + userId) || 'null');
      if (saved && Array.isArray(saved) && saved.length > 0) return saved;
    } catch(e) {}
    return this.getDefaultLayout(roleId || 'personal');
  },

  saveUserLayout(userId, layout) {
    if (!userId) return;
    try { localStorage.setItem('dashLayout_' + userId, JSON.stringify(layout)); } catch(e) {}
  },

  resetUserLayout(userId) {
    if (!userId) return;
    try { localStorage.removeItem('dashLayout_' + userId); } catch(e) {}
  }
};
