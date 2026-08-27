/**
 * DashboardConfig v50 — Widget-moduler, behörigheter, rollbaserade standardlayouter
 * och per-användarlayouter.
 *
 * requiredPermissions: ANY av dessa räcker (tom array = alla inloggade)
 * defaultSize: 'full' | 'half' | 'third' | 'twothird' — LEGACY visningsstorlek,
 *   används bara för att räkna fram defaultSpan (se sizeToSpan nedan).
 * minSpan: minsta tillåtna 12-kolumnsbredd (V51B). Saknas → 3 (¼), dvs.
 *   widgeten stödjer alla fyra bredd-presets. Endast satt där en genuin,
 *   källbaserad anledning finns (se kommentarer per modul nedan) — INTE
 *   godtyckligt begränsat.
 * description: visas i "Anpassa dashboard"-panelen
 */
const DashboardConfig = {

  /* ── V51B: 12-kolumnersgrid — bredd-presets ────────────────────────────
     Fyra diskreta bredder, exakt enligt uppdragsspec: ¼/½/¾/Hel =
     3/6/9/12 kolumner av 12. Sparas ALLTID som detta numeriska span-värde
     — aldrig som en CSS-sträng. */
  VALID_SPANS: [3, 6, 9, 12],

  SPAN_LABELS: { 3: '¼', 6: '½', 9: '¾', 12: 'Hel' },

  /* Migrerar ENDAST det gamla 'full'/'half'/'third'/'twothird'-systemet
     till det nya numeriska span-systemet (V51B). 'third' fanns inte som
     en exakt fjärdedel i det gamla systemet (12/3≈4, inte 3) — den
     mappas medvetet till närmaste NYA preset, ¼ (3), snarare än ½ (6):
     'third' var redan den smalaste av de gamla storlekarna tillsammans
     med 'half', så att runda den nedåt till den nya minsta presetten är
     den tolkning som bäst bevarar den ursprungliga avsikten (smalast
     möjliga), inte en godtycklig gissning. */
  sizeToSpan(size) {
    const map = { full: 12, twothird: 9, half: 6, third: 3 };
    return map[size] || 12;
  },

  /* ── Modul-registry ───────────────────────────────────────────────────── */
  /* V51A: kategorier omgrupperade kring tre produktfrågor —
     "Kräver åtgärd" / "Idag & drift" / "Verksamhet" — istället för de
     tidigare löst besläktade "Översikt"/"Arbete"/"Aktiviteter"/
     "Sälj & ekonomi"/"System"-etiketterna. Detta driver sektionsrubrikerna
     i Dashboard.render() för den ORÖRDA rollstandard-layouten (V51B §3:
     en sparad PERSONLIG layout renderas däremot som ETT sammanhängande
     grid utan kategirirubriker — se Dashboard.js). */
  MODULES: {
    overdue_alert: { id:'overdue_alert', title:'Försenade aktiviteter',  icon:'alert-triangle',  category:'Kräver åtgärd',  description:'Varnar om försenade uppföljningar och aktiviteter',           requiredPermissions:['dashboard_view'],                        defaultSize:'full'  },
    todos:         { id:'todos',         title:'Kräver åtgärd',          icon:'alert-circle',    category:'Kräver åtgärd',  description:'Åtgärder som kräver omedelbar uppmärksamhet',                 requiredPermissions:['dashboard_view'],                        defaultSize:'full'  },
    operations:    { id:'operations',    title:'Dagens drift',           icon:'layout-dashboard', category:'Idag & drift',   description:'Chefsoversikt: försenade, akuta, saknar personal, klara ej fakt.', requiredPermissions:['staff_view','reports_view'],             defaultSize:'full'  },
    /* ops_map: kombinerad karta + lista sida vid sida (CSS-layout från
       V51A). Källbaserad begränsning: widgetens EGEN interna
       .dash-ops-map-wrap-layout lägger redan karta+lista bredvid varandra
       från 1024px och kräver rimligt om utrymme för att förbli läsbar —
       source-verifierat i dashboard.css. Tillåter INTE ¼ (3), stödjer
       ½/¾/Hel. */
    ops_map:       { id:'ops_map',       title:'Aktiva jobb — karta',    icon:'map-pin',          category:'Idag & drift',   description:'Karta och lista över dagens/aktiva arbetsorder med adress',    requiredPermissions:['ao_view_all','ao_view_own'],             defaultSize:'full',  minSpan: 6 },
    today:         { id:'today',         title:'Ordrar idag',            icon:'calendar',        category:'Idag & drift',   description:'Schemalagda arbetsorder för dagens datum',                    requiredPermissions:['ao_view_all','ao_view_own'],             defaultSize:'third' },
    pool:          { id:'pool',          title:'Arbetspool',             icon:'inbox',           category:'Idag & drift',   description:'Arbetsorder i poolen utan tilldelad resurs',                  requiredPermissions:['ao_view_all','ao_view_own'],             defaultSize:'third' },
    stamp:         { id:'stamp',         title:'Stämpla tid',            icon:'clock',           category:'Idag & drift',   description:'Klocka in och ut, se aktiv stämplingstid',                   requiredPermissions:['ao_time'],                              defaultSize:'third' },
    activities:    { id:'activities',    title:'Aktiviteter',            icon:'bell',            category:'Idag & drift',   description:'Uppföljningar, bokade möten och påminnelser',                 requiredPermissions:['dashboard_view'],                        defaultSize:'full'  },
    rondering:     { id:'rondering',     title:'Rondering',              icon:'clipboard-check', category:'Idag & drift',   description:'Ronderingsschema, ronderingsmallar och öppna avvikelser',      requiredPermissions:['ao_view_all'],                          defaultSize:'full'  },
    recurring:     { id:'recurring',     title:'Återkommande',           icon:'refresh-cw',      category:'Idag & drift',   description:'Återkommande uppdrag som snart ska skapas',                   requiredPermissions:['recurring_manage'],                      defaultSize:'third' },
    /* kpi: upp till 5 nyckeltalskort i en rad, med EGEN viewport-baserad
       (inte container-baserad) responsiv kolumnindelning (kpi-row i
       dashboard.css) — source-verifierat att den INTE anpassar sig efter
       widgetens egen gridbredd. Vid ¼ bredd på en bred skärm skulle
       kpi-row:s interna 3-5-kolumnslayout tvingas ihop orimligt smalt.
       Tillåter INTE ¼, stödjer ½/¾/Hel. */
    kpi:           { id:'kpi',           title:'Nyckeltal',              icon:'bar-chart-2',     category:'Verksamhet',     description:'Nyckeltal för arbetsorder, offerter och fakturering',          requiredPermissions:['ao_view_all','ao_view_own','ao_time'],    defaultSize:'full',  minSpan: 6 },
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
  getMinSpan(id) {
    const m = this.MODULES[id];
    const min = m && m.minSpan;
    return this.VALID_SPANS.includes(min) ? min : 3;
  },
  clampSpan(span, moduleId) {
    const min = this.getMinSpan(moduleId);
    let s = this.VALID_SPANS.includes(span) ? span : 12;
    if (s < min) s = min;
    return s;
  },

  /* V51B — giltig, stabil användaridentitet. Samma konvention som redan
     etablerad genomgående i Dashboard.js (R1–R5): null/undefined/tom
     sträng/sentinelvärdet 'unknown' räknas ALDRIG som en giltig identitet.
     En PERSONLIG layout får ALDRIG läsas/skrivas under en ogiltig/delad
     nyckel — fail closed till rollstandard istället. */
  _validUserId(userId) {
    return (userId && typeof userId === 'string' && userId !== 'unknown') ? userId : null;
  },
  _keyV1(userId) { return 'dashLayout_' + userId; },       // V51A — legacy, LÄSES men skrivs aldrig av ny kod
  _keyV2(userId) { return 'dashLayoutV2_' + userId; },     // V51B — personlig grid-layout (span-modell)

  /* Bygg standardlayout för en roll (inkl. alla moduler, icke-default = hidden) */
  getDefaultLayout(roleId) {
    const ids    = this.ROLE_DEFAULTS[roleId] || this.ROLE_DEFAULTS.personal;
    const allIds = Object.keys(this.MODULES);
    const result = [];
    ids.forEach((id, i) => {
      const m = this.MODULES[id];
      if (m) result.push({ id, visible:true, span:this.clampSpan(this.sizeToSpan(m.defaultSize), id), order:i });
    });
    let next = ids.length;
    allIds.forEach(id => {
      if (!ids.includes(id)) {
        const m = this.MODULES[id];
        if (m) result.push({ id, visible:false, span:this.clampSpan(this.sizeToSpan(m.defaultSize), id), order:next++ });
      }
    });
    return result;
  },

  /* V51A R1 §3 / V51B: ren, LÄSANDE normalisering av en LEGACY (V51A,
     bar array under dashLayout_<uid>) sparad layout mot det aktuella
     modul-registret och rollens standard. Skriver ALDRIG till
     localStorage själv. Denna funktion appliceras BARA på det gamla
     formatet — en genuin V51B-personlig layout (dashLayoutV2_<uid>)
     kategorisorteras INTE om (se normalizePersonalLayout nedan); annars
     skulle en medvetet tvärkategorisk användarordning (t.ex. karta +
     offerter på samma rad) tystas ned till kategorigrupper vid varje
     rendering, vilket direkt bryter V51B:s kärnkrav.

     Regler (oförändrat sedan R1, span ersätter nu size):
     A/B. befintliga kända moduler i `saved` behåller sitt visible/span
        (gammal 'size'-sträng migreras via sizeToSpan; span clampas mot
        modulens minSpan).
     C. okända/obsoleta modul-id:n i `saved` ignoreras tyst.
     D/E. moduler som saknas i `saved` men ingår i rollens NUVARANDE
        standardlayout läggs till som synliga.
     F. moduler som varken finns i `saved` eller i rollens standard
        förblir dolda.
     G/H. resultatet grupperas fysiskt efter CATEGORY_ORDER.
     I. sekventiella order-nummer 0..N-1 tilldelas. */
  normalizeLayout(saved, roleId) {
    const roleDefaultIds = this.ROLE_DEFAULTS[roleId] || this.ROLE_DEFAULTS.personal;
    const allIds = Object.keys(this.MODULES);
    const savedArr = Array.isArray(saved) ? saved : [];

    const savedMap = {};
    savedArr.forEach((e, i) => {
      /* V51B: dubbletter i sparad data — behåll FÖRSTA förekomsten
         deterministiskt, ignorera efterföljande (samma id kan aldrig
         förekomma två gånger i det normaliserade resultatet). */
      if (e && e.id && this.MODULES[e.id] && !savedMap[e.id]) {
        const rawSpan = typeof e.span === 'number' ? e.span : this.sizeToSpan(e.size);
        savedMap[e.id] = { visible: !!e.visible, span: this.clampSpan(rawSpan, e.id), _savedIdx: i };
      }
    });

    const entries = allIds.map(id => {
      const mod = this.MODULES[id];
      const savedEntry = savedMap[id];
      if (savedEntry) {
        return {
          id, visible: savedEntry.visible, span: savedEntry.span,
          _inSaved: true, _savedIdx: savedEntry._savedIdx
        };
      }
      const roleIdx = roleDefaultIds.indexOf(id);
      return {
        id, visible: roleIdx !== -1, span: this.clampSpan(this.sizeToSpan(mod.defaultSize), id),
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

    return entries.map((e, i) => ({ id: e.id, visible: e.visible, span: e.span, order: i }));
  },

  /* V51B — ren normalisering av en GENUIN personlig (V51B) layout.
     Till skillnad från normalizeLayout() ovan: bevarar den sparade
     INBÖRDES ORDNINGEN EXAKT (ingen kategorisortering) — det är precis
     vad som gör tvärkategorisk komposition (karta 3/4 + offerter 1/4 på
     samma rad) möjlig och beständig. Hanterar ändå samtliga
     robusthetskrav: okända moduler tas bort, dubbletter dedupliceras
     (första vinner), ogiltig span clampas, nya moduler som saknas i den
     sparade layouten men ingår i rollens standard slås ihop in som
     synliga (tillagda sist, efter den sparade ordningen — det finns
     ingen meningsfull "rätt plats" att gissa i en fritt omordnad
     layout). Rent LÄSANDE, ingen persistens. */
  normalizePersonalLayout(saved, roleId) {
    const roleDefaultIds = this.ROLE_DEFAULTS[roleId] || this.ROLE_DEFAULTS.personal;
    const savedArr = Array.isArray(saved) ? saved : [];
    const seen = new Set();
    const out = [];

    savedArr.forEach(e => {
      if (!e || !e.id || !this.MODULES[e.id] || seen.has(e.id)) return;
      seen.add(e.id);
      const rawSpan = typeof e.span === 'number' ? e.span : this.sizeToSpan(e.size);
      out.push({ id: e.id, visible: !!e.visible, span: this.clampSpan(rawSpan, e.id) });
    });

    // Nya moduler (tillkomna efter att layouten sparades) som ingår i rollens
    // standard men saknas i den sparade layouten — läggs till sist, synliga.
    roleDefaultIds.forEach(id => {
      if (!seen.has(id) && this.MODULES[id]) {
        seen.add(id);
        out.push({ id, visible: true, span: this.clampSpan(this.sizeToSpan(this.MODULES[id].defaultSize), id) });
      }
    });

    return out.map((e, i) => ({ id: e.id, visible: e.visible, span: e.span, order: i }));
  },

  /* V51B — läser BARA localStorage, avgör om användaren har en genuin
     personlig (V51B) layout sparad. Ren, ingen mutation. Dashboard.js
     använder denna för att avgöra om Dashboard ska renderas som
     kategirgrupperad rollstandard (med rubriker) eller som ETT
     sammanhängande, tvärkategoriskt grid (utan rubriker). */
  hasCustomLayout(userId) {
    const uid = this._validUserId(userId);
    if (!uid) return false;
    try {
      const raw = JSON.parse(localStorage.getItem(this._keyV2(uid)) || 'null');
      return Array.isArray(raw) && raw.length > 0;
    } catch(e) { return false; }
  },

  /* Hämta användarens sparade layout, fallback till rollstandard.
     Ordning: V51B-personlig layout (om sparad) → LEGACY V51A-layout (om
     sparad, migreras via normalizeLayout) → rollstandard.
     En saknad/ogiltig identitet (se _validUserId) läser ALDRIG någon
     personlig nyckel — faller alltid tillbaka till rollstandard, fail
     closed. */
  getUserLayout(userId, roleId) {
    const uid = this._validUserId(userId);
    const role = roleId || 'personal';
    if (uid) {
      try {
        const v2 = JSON.parse(localStorage.getItem(this._keyV2(uid)) || 'null');
        if (Array.isArray(v2) && v2.length > 0) return this.normalizePersonalLayout(v2, role);
      } catch(e) {}
      try {
        const v1 = JSON.parse(localStorage.getItem(this._keyV1(uid)) || 'null');
        if (Array.isArray(v1) && v1.length > 0) return this.normalizeLayout(v1, role);
      } catch(e) {}
    }
    return this.getDefaultLayout(role);
  },

  /* V51B — sparar ALLTID i det nya versionerade formatet
     (dashLayoutV2_<uid>). Skriver ALDRIG den gamla V51A-nyckeln. Vägrar
     skriva under en ogiltig/saknad identitet — se _validUserId. */
  saveUserLayout(userId, layout) {
    const uid = this._validUserId(userId);
    if (!uid) return;
    try { localStorage.setItem(this._keyV2(uid), JSON.stringify(layout)); } catch(e) {}
  },

  /* Återställer BÅDA nycklarna (legacy + V51B) så att nästa getUserLayout
     garanterat faller tillbaka till en fräsch rollstandard. Vägrar under
     ogiltig identitet. */
  resetUserLayout(userId) {
    const uid = this._validUserId(userId);
    if (!uid) return;
    try {
      localStorage.removeItem(this._keyV1(uid));
      localStorage.removeItem(this._keyV2(uid));
    } catch(e) {}
  }
};
