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
  /* V51A: kategorier omgrupperade kring tre produktfrågor —
     "Kräver åtgärd" / "Idag & drift" / "Verksamhet" — istället för de
     tidigare löst besläktade "Översikt"/"Arbete"/"Aktiviteter"/
     "Sälj & ekonomi"/"System"-etiketterna. Detta driver sektionsrubrikerna
     i Dashboard.render() (redan befintlig kategori-grupperingslogik,
     oförändrad) utan att behöva bygga om själva render-mekaniken. */
  MODULES: {
    overdue_alert: { id:'overdue_alert', title:'Försenade aktiviteter',  icon:'alert-triangle',  category:'Kräver åtgärd',  description:'Varnar om försenade uppföljningar och aktiviteter',           requiredPermissions:['dashboard_view'],                        defaultSize:'full'  },
    todos:         { id:'todos',         title:'Kräver åtgärd',          icon:'alert-circle',    category:'Kräver åtgärd',  description:'Åtgärder som kräver omedelbar uppmärksamhet',                 requiredPermissions:['dashboard_view'],                        defaultSize:'full'  },
    operations:    { id:'operations',    title:'Dagens drift',           icon:'layout-dashboard', category:'Idag & drift',   description:'Chefsoversikt: försenade, akuta, saknar personal, klara ej fakt.', requiredPermissions:['staff_view','reports_view'],             defaultSize:'full'  },
    ops_map:       { id:'ops_map',       title:'Aktiva jobb — karta',    icon:'map-pin',          category:'Idag & drift',   description:'Karta och lista över dagens/aktiva arbetsorder med adress',    requiredPermissions:['ao_view_all','ao_view_own'],             defaultSize:'full'  },
    today:         { id:'today',         title:'Ordrar idag',            icon:'calendar',        category:'Idag & drift',   description:'Schemalagda arbetsorder för dagens datum',                    requiredPermissions:['ao_view_all','ao_view_own'],             defaultSize:'third' },
    pool:          { id:'pool',          title:'Arbetspool',             icon:'inbox',           category:'Idag & drift',   description:'Arbetsorder i poolen utan tilldelad resurs',                  requiredPermissions:['ao_view_all','ao_view_own'],             defaultSize:'third' },
    stamp:         { id:'stamp',         title:'Stämpla tid',            icon:'clock',           category:'Idag & drift',   description:'Klocka in och ut, se aktiv stämplingstid',                   requiredPermissions:['ao_time'],                              defaultSize:'third' },
    activities:    { id:'activities',    title:'Aktiviteter',            icon:'bell',            category:'Idag & drift',   description:'Uppföljningar, bokade möten och påminnelser',                 requiredPermissions:['dashboard_view'],                        defaultSize:'full'  },
    rondering:     { id:'rondering',     title:'Rondering',              icon:'clipboard-check', category:'Idag & drift',   description:'Ronderingsschema, ronderingsmallar och öppna avvikelser',      requiredPermissions:['ao_view_all'],                          defaultSize:'full'  },
    recurring:     { id:'recurring',     title:'Återkommande',           icon:'refresh-cw',      category:'Idag & drift',   description:'Återkommande uppdrag som snart ska skapas',                   requiredPermissions:['recurring_manage'],                      defaultSize:'third' },
    kpi:           { id:'kpi',           title:'Nyckeltal',              icon:'bar-chart-2',     category:'Verksamhet',     description:'Nyckeltal för arbetsorder, offerter och fakturering',          requiredPermissions:['ao_view_all','ao_view_own','ao_time'],    defaultSize:'full'  },
    ao_categories: { id:'ao_categories', title:'Öppna per kategori',     icon:'layers',           category:'Verksamhet',     description:'Hur belastningen fördelas per arbetsorderkategori', requiredPermissions:['ao_view_all','ao_view_own'],             defaultSize:'full'  },
    sales:         { id:'sales',         title:'Säljchanser',            icon:'target',          category:'Verksamhet',     description:'Aktiva säljchanser att kontakta och följa upp',               requiredPermissions:['sales_manage'],                          defaultSize:'third' },
    offers:        { id:'offers',        title:'Offerter väntar',        icon:'file-text',       category:'Verksamhet',     description:'Skickade offerter som väntar på kundens svar',                requiredPermissions:['offer_manage'],                          defaultSize:'third' },
    activity_log:  { id:'activity_log',  title:'Senaste händelser',      icon:'activity',        category:'Verksamhet',     description:'Bolagets senaste händelser, ändringar och loggar',            requiredPermissions:['reports_view','staff_view'],             defaultSize:'third' },
    quickbtns:     { id:'quickbtns',     title:'Snabbåtgärder',          icon:'zap',             category:'Verksamhet',     description:'Skapa ny order, offert eller kund med ett klick',             requiredPermissions:['dashboard_view'],                        defaultSize:'full'  },
  },

  /* ── Rollbaserade standardlayouter ──────────────────────────────────────
     Listar module-ids i önskad visningsordning.
     Moduler som inte listas visas med visible:false (kan aktiveras manuellt).
  ─────────────────────────────────────────────────────────────────────── */
  ROLE_DEFAULTS: {
    admin:    ['overdue_alert','todos','operations','ops_map','today','pool','stamp','activities','rondering','recurring','kpi','ao_categories','sales','offers','activity_log','quickbtns'],
    chef:     ['overdue_alert','todos','operations','ops_map','today','pool','stamp','activities','rondering','recurring','kpi','ao_categories','sales','offers','activity_log','quickbtns'],
    personal: ['overdue_alert','ops_map','today','pool','stamp','activities','rondering','kpi','quickbtns'],
    ekonomi:  ['overdue_alert','todos','kpi','offers','activity_log','quickbtns'],
  },

  /* V51A R1 §3: kategori-prioritetsordning som den fysiska renderings-
     grupperingen MÅSTE följa — en sparad äldre layout (från innan
     kategorierna slogs samman till dessa tre) kan annars interfoliera
     moduler från olika kategorier och få Dashboard.render()s befintliga
     "ny rubrik när kategorin ändras"-logik att skriva ut samma rubrik
     flera gånger (se _widgetOpsMap-rundans blockerare A). */
  CATEGORY_ORDER: ['Kräver åtgärd', 'Idag & drift', 'Verksamhet'],

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

  /* V51A R1 §3: ren, LÄSANDE normalisering/sammanslagning av en sparad
     (ev. ur-V51A) layout mot det aktuella modul-registret och den
     aktuella rollens standard. Anropas VARJE gång en sparad layout läses
     — skriver ALDRIG till localStorage själv (§3 KRITISKT / §21
     zero-write) — bara den explicita saveCustomize()-vägen persisterar.

     Regler (spec §3 A–I):
     A/B. befintliga kända moduler i `saved` behåller sitt visible/size.
     C. okända/obsoleta modul-id:n i `saved` ignoreras tyst (filtreras bort
        — de motsvarar inte längre något registrerat MODULES-objekt).
     D/E. moduler som saknas i `saved` men ingår i rollens NUVARANDE
        standardlayout (t.ex. ops_map för en användare som sparade sin
        layout innan kartan fanns) läggs till som synliga.
     F. moduler som varken finns i `saved` eller i rollens standard förblir
        dolda.
     G/H. resultatet grupperas fysiskt efter CATEGORY_ORDER — inom varje
        kategori bevaras den sparade layoutens INBÖRDES ordning för redan
        kända moduler; nya (ej sparade) moduler infogas vid ungefär sin
        plats i rollens standardordning.
     I. sekventiella order-nummer 0..N-1 tilldelas över hela den
        sammanslagna, kategorigrupperade listan. */
  normalizeLayout(saved, roleId) {
    const roleDefaultIds = this.ROLE_DEFAULTS[roleId] || this.ROLE_DEFAULTS.personal;
    const allIds = Object.keys(this.MODULES);
    const savedArr = Array.isArray(saved) ? saved : [];

    const savedMap = {};
    savedArr.forEach((e, i) => {
      if (e && e.id && this.MODULES[e.id]) savedMap[e.id] = { visible: !!e.visible, size: e.size, _savedIdx: i };
    });

    const entries = allIds.map(id => {
      const mod = this.MODULES[id];
      const savedEntry = savedMap[id];
      if (savedEntry) {
        return {
          id, visible: savedEntry.visible, size: savedEntry.size || mod.defaultSize || 'full',
          _inSaved: true, _savedIdx: savedEntry._savedIdx
        };
      }
      const roleIdx = roleDefaultIds.indexOf(id);
      return {
        id, visible: roleIdx !== -1, size: mod.defaultSize || 'full',
        _inSaved: false, _roleIdx: roleIdx
      };
    });

    const catRank = (id) => {
      const idx = this.CATEGORY_ORDER.indexOf((this.MODULES[id] || {}).category);
      return idx === -1 ? this.CATEGORY_ORDER.length : idx;
    };

    entries.sort((a, b) => {
      const ca = catRank(a.id), cb = catRank(b.id);
      if (ca !== cb) return ca - cb;
      const keyOf = (e) => e._inSaved ? e._savedIdx : (e._roleIdx === -1 ? Infinity : e._roleIdx + 0.5);
      return keyOf(a) - keyOf(b);
    });

    return entries.map((e, i) => ({ id: e.id, visible: e.visible, size: e.size, order: i }));
  },

  /* Hämta användarens sparade layout, fallback till rollstandard.
     En sparad layout körs ALLTID genom normalizeLayout() innan den
     returneras — se ovan. */
  getUserLayout(userId, roleId) {
    try {
      const saved = JSON.parse(localStorage.getItem('dashLayout_' + userId) || 'null');
      if (saved && Array.isArray(saved) && saved.length > 0) return this.normalizeLayout(saved, roleId || 'personal');
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
