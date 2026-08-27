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

  /* ── V51B — giltig, stabil användaridentitet för layoutpersistens.
     Samma konvention som redan etablerad i _scopeWorkOrdersForCurrentUser
     (R1–R5): null/undefined/tom sträng/sentinelvärdet 'unknown' räknas
     ALDRIG som en giltig identitet. Personlig Dashboard-layout får
     ALDRIG läsas/skrivas under en ogiltig identitet — se
     DashboardConfig._validUserId (samma regel, käll-delad). */
  _layoutUserId(user) {
    return (user && user.id && user.id !== 'unknown') ? user.id : null;
  },

  /* ── Huvud-render ──────────────────────────────────────────────────── */
  render() {
    const el = document.getElementById('dash-content');
    if (!el) return;

    const user   = Auth.getUser();
    const userId = user ? user.id   : null;
    const roleId = user ? user.role : 'personal';
    const layoutUserId = this._layoutUserId(user);

    // Applicera personliga preferenser (accentfärg, täthet)
    if (userId) UserPrefsService.apply(userId);

    if (this._editMode) { this._renderEditMode(el, user, roleId); return; }

    // Hämta layout för användaren (sparad V51B-personlig, migrerad legacy, eller rollstandard)
    const layout = DashboardConfig.getUserLayout(layoutUserId, roleId);
    /* V51B §3: en genuin sparad PERSONLIG layout renderas som ETT
       sammanhängande, tvärkategoriskt 12-kolumnersgrid — INGA
       kategorirubriker infogas, eftersom dessa annars skulle tvinga en
       widget (t.ex. Offerter) till en ny rad även om användaren
       medvetet placerat den bredvid kartan. Den ORÖRDA rollstandarden
       (ingen sparad personlig layout ännu) behåller den befintliga,
       kategorigrupperade visuella hierarkin precis som innan V51B. */
    const isCustomLayout = DashboardConfig.hasCustomLayout(layoutUserId);

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
        if (!isCustomLayout && cat && cat !== lastCat) {
          const collapsed = !!this._collapsed[key];
          parts.push(`<div class="dgw-12" data-sec-hdr="${key}">
            <div class="dash-sec-toggle" onclick="Dashboard.toggleSection('${key}')">
              <span class="dash-sec-label">${esc(cat)}</span>
              <span class="dash-sec-line"></span>
              <span class="sec-caret">${ic(collapsed ? 'chevron-right' : 'chevron-down', 11)}</span>
            </div>
          </div>`);
          lastCat = cat;
        }
        const span = typeof m.span === 'number' ? m.span : DashboardConfig.clampSpan(DashboardConfig.sizeToSpan(m.size), m.id);
        const cls = 'dgw-' + DashboardConfig.clampSpan(span, m.id);
        const collapsed = !isCustomLayout && !!this._collapsed[key];
        parts.push(`<div class="${cls}" data-sec="${key}"${collapsed ? ' style="display:none;"' : ''}>${html}</div>`);
      }
    }

    const userName = user ? (user.firstName || user.username || '') : '';
    const todayStr = new Date().toLocaleDateString('sv-SE', { weekday:'long', day:'numeric', month:'long' });
    const todayStr2 = todayStr.charAt(0).toUpperCase() + todayStr.slice(1);

    // Quick urgent summary for hero
    /* V51A R3 §6 — blockerare A: heroSub byggdes tidigare från ALLA
       state.workOrders utan någon AO-behörighetskontroll alls — en
       användare helt utan ao_view_all/ao_view_own (eller med
       ao_view_own men oupplösbar identitet) kunde ändå se bolagets
       globala akut-/försenat-/idag-räknare i hero:n. Nu via samma
       kanoniska hjälpfunktion som resten av AO-ytorna: admin/all →
       oförändrat globalt; own+giltigt id → endast egna+pool-synliga
       ordrar; annars → tom lista (inga hero-chips visas alls). */
    const allWos   = this._scopeWorkOrdersForCurrentUser(
      (state.workOrders||[]).filter(a => !a.archived && !a.deleted),
      { includeSharedPool: true }
    );
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
          `<button class="btn bghost bxs" onclick="Dashboard.enterEditMode()" title="Anpassa dashboard" style="padding:6px;">${ic('settings',14)}</button>` +
        `</div>` +
      `</div>` +
      (heroSub ? `<div style="display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap;align-items:center;">${heroSub}</div>` : '') +
      `<div class="dash-layout">${parts.join('')}</div>`;

    /* V51A R1 §9/§10 — GENERATIONSSPÄRR mot asynkrona kart-race:er.
       Kartan kan bara initieras EFTER att innerHTML ovan satts (DOM-noden
       #dash-ops-map måste faktiskt existera). VARJE render()-anrop
       ogiltigförklarar alla tidigare, ev. fortfarande väntande
       kart-initieringar OVILLKORLIGT (även om denna omgång inte visar
       ops_map alls) — annars kan en gammal, långsam geokodningsrunda
       hinna slutföras EFTER en nyare rendering och skriva över dess
       kartcontainer med inaktuell data.
       `jobsSnapshot` fångas HÄR, synkront, i SAMMA render()-anrop som satte
       _opsMapJobs — inte lästs lat inifrån den asynkrona funktionen — så
       en efterföljande render() (som synkront skriver över _opsMapJobs
       igen innan den första kartinitieringen ens hunnit starta) aldrig kan
       smyga in fel data i ett äldre, redan schemalagt pass. */
    this._scheduleMapInit(sorted.some(m => m.id === 'ops_map'));
  },

  /* V51B — utbruten ur render() så att BÅDE normalläget och redigeringsläget
     (_renderEditMode) kan trigga samma generationsspärrade kart-initiering.
     Kartan måste förbli funktionell även under redigering (§19) — annars
     skulle den bara stå tom/trasig varje gång användaren öppnar
     "Anpassa dashboard" med kart-widgeten synlig. */
  _scheduleMapInit(hasOpsMap) {
    clearTimeout(this._mapInitTimer);
    this._mapGeneration = (this._mapGeneration || 0) + 1;
    const myGen = this._mapGeneration;
    if (hasOpsMap && document.getElementById('dash-ops-map-canvas-wrap')) {
      const jobsSnapshot = this._opsMapJobs;
      this._mapInitTimer = setTimeout(() => this._initOpsMap(myGen, jobsSnapshot), 30);
    } else if (this._mapInstance) {
      // ops_map inte längre synlig i denna layout (t.ex. avstängd via
      // Anpassa, eller dold i redigeringsläget) — städa bort en ev.
      // kvarvarande karta, ingen framtida generation kommer annars göra
      // det åt oss.
      try { this._mapInstance.remove(); } catch(e) {}
      this._mapInstance = null;
    }
  },

  /* ── Behörighet ────────────────────────────────────────────────────── */
  _canSee(moduleId) {
    const mod = DashboardConfig.getModule(moduleId);
    if (!mod) return false;
    return Auth.canAny(mod.requiredPermissions || []);
  },

  /* ── Kanonisk AO-synlighet (V51A R3) ──────────────────────────────────
     EN gemensam, ren hjälpfunktion för samtliga Dashboard-ytor som läser
     state.workOrders — ersätter tidigare separata, lätt divergerande
     kopior av samma behörighetslogik i varje enskild widget.

     Käll-verifierad mot den kanoniska frontend-kontrakt som redan gäller
     i WorkOrdersPage (_baseList()/renderList()/_canOpenAo(), tre
     oberoende ställen med identisk logik):
       const canViewAll = Auth.can('ao_view_all') || Auth.can('all');
       if (!canViewAll && Auth.can('ao_view_own') && state.currentUser) {
         list = list.filter(a => (a.staff||[]).includes(myId) || a.status === 'pool');
       }
     dvs: en ao_view_own-användare ser sina EGNA tilldelade arbetsorder
     PLUS hela den delade arbetspoolen (status:'pool', ingen tilldelad
     resurs) — pool är per produktkontrakt avsiktligt delad, inte privat.

     Dashboard skärper detta kontrakt ytterligare, konsekvent överallt
     (samma härdning som redan infördes för _widgetOpsMap() i R1 och
     _widgetToday() i R2): om identiteten inte går att fastställa med
     säkerhet (Auth.getUser() null, saknar id, tomt id, eller
     sentinelvärdet 'unknown' som AuthService sätter vid ett osäkert
     user-match) visas ALDRIG någon arbetsorderdata alls — FAIL CLOSED,
     aldrig fail open. (WorkOrdersPage:s källkod har inte denna extra
     härdning — den litar på att state.currentUser är satt om
     ao_view_own är sant. Det är en känd, separat observation dokumenterad
     i R3-rapporten, INTE något som ändras i WorkOrdersPage här.)

     options.includeSharedPool (default false): tar med delade pool-jobb
     (status:'pool') även för own-only-användare, enligt den
     käll-verifierade regeln ovan. Widgets som representerar en persons
     egna relevanta arbetsbelastning (KPI, kategorier, "Kräver åtgärd",
     hero-sammanfattningen, poolwidgeten själv) sätter detta till true.
     Kalender-/kartbundna widgets (Ordrar idag, Aktiva jobb — karta)
     behåller sitt R1/R2-beteende OFÖRÄNDRAT (ingen pool) via false. */
  _scopeWorkOrdersForCurrentUser(list, options) {
    options = options || {};
    const includeSharedPool = !!options.includeSharedPool;
    const hasAll = Auth.can('ao_view_all');
    const hasOwn = Auth.can('ao_view_own');
    const user   = Auth.getUser();
    const userId = user && user.id && user.id !== 'unknown' ? user.id : null;

    if (hasAll) return list;
    if (hasOwn && userId) {
      return list.filter(a => (a.staff||[]).includes(userId) || (includeSharedPool && a.status === 'pool'));
    }
    return [];
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
        case 'ops_map':        return this._widgetOpsMap();
        default: return null;
      }
    } catch(e) {
      console.error('[Dashboard] widget error:', id, e);
      return null;
    }
  },

  /* ── V51B — Personlig Dashboard / Grid Builder ────────────────────────
     Ersätter den gamla modal-listan (§7 DRAFT/SAVE-kontrakt):
       enterEditMode()  → klona NUVARANDE normaliserade layout till en
                           draft. Ingen persistens.
       drag/resize/hide → uppdaterar ENDAST draften (this._editDraft).
                           Ingen persistens.
       saveEditMode()   → EN skrivning via DashboardConfig.saveUserLayout
                           (den kanoniska vägen) — OM INTE draften just nu
                           representerar en äkta återställning (se
                           _editResetToDefault nedan), i vilket fall en
                           RIKTIG återställning görs istället.
       exitEditModeCancel() → kastar draften. NOLL persistens.
       resetEditDraft() → nollställer draften till rollens standard.
                           Persisteras INTE förrän Spara.

     V51B R1 — BLOCKER B-FIX: "Återställ standard" laddade tidigare BARA
     rollens standardlayout in i draften, men Spara anropade OVILLKORLIGT
     saveUserLayout() — vilket SKAPADE dashLayoutV2_<uid> (med
     standardlayoutens innehåll). Eftersom hasCustomLayout() bara
     kontrollerar OM den nyckeln existerar (inte VAD den innehåller),
     förblev Dashboard därefter felaktigt i "personligt grid utan
     kategirirubriker"-läge — trots att widget-ordning/storlek/synlighet
     visuellt RÅKADE matcha standarden. Det är INTE samma sak som en
     genuin återställning: rubrikerna (Kräver åtgärd/Idag & drift/
     Verksamhet) hörde till den ORÖRDA presentationen och försvann ändå.

     Fix: `_editResetToDefault`-flaggan markerar att draften just nu ÄR
     en ren, oförändrad kopia av rollstandarden (satt av
     resetEditDraft(), nollställd av ALLA andra draft-mutationer — se
     kommentarerna vid varje _edit*-metod nedan). Om flaggan fortfarande
     är sann när Spara klickas anropas DashboardConfig.resetUserLayout()
     (som tar bort BÅDA lagringsnycklarna, inte bara sparar
     standardinnehållet) — annars (flaggan har nollställts av en
     efterföljande genuin ändring) sparas draften som en vanlig personlig
     V51B-layout, exakt som förut. */
  _editMode: false,
  _editDraft: null,
  _editSourceLayout: null,
  _editResetToDefault: false,
  _drag: null,

  enterEditMode() {
    const user = Auth.getUser();
    if (!user) return;
    const layoutUserId = this._layoutUserId(user);
    const roleId = user.role || 'personal';
    const layout = DashboardConfig.getUserLayout(layoutUserId, roleId);
    /* V51B R2 §4 — spara en PRIVAT, ren minnessnapshot av HELA den
       normaliserade käll-layouten (innan behörighetsfiltrering) — inte
       persisterad, bara i minnet under redigeringssessionen. Detta är
       vad som gör det möjligt att BEVARA en tillfälligt obehörig
       widgets sparade konfiguration vid Spara (se saveEditMode()),
       utan att den någonsin visas i själva redigerings-UI:t (draften
       nedan förblir strikt behörighetsfiltrerad, precis som förut). */
    this._editSourceLayout = layout;
    this._editDraft = this._buildDraftFrom(layout, user);
    this._editResetToDefault = false;
    this._editMode = true;
    this.render();
  },

  exitEditModeCancel() {
    this._editMode = false;
    this._editDraft = null;
    this._editSourceLayout = null;
    this._editResetToDefault = false;
    this.render();
  },

  saveEditMode() {
    const user = Auth.getUser();
    const layoutUserId = this._layoutUserId(user);
    if (!layoutUserId) {
      showToast('Kunde inte spara — okänd användaridentitet');
      return;
    }
    if (this._editResetToDefault) {
      /* Äkta återställning: ta bort BÅDA lagringsnycklarna (legacy +
         V51B) via den kanoniska vägen, så hasCustomLayout() blir false
         och Dashboard genuint återgår till den orörda, kategigrupperade
         rollstandard-presentationen — inte bara samma widget-innehåll
         under en "personlig layout finns"-flagga. En ÄKTA återställning
         ska INTE bevara gamla, tillfälligt obehöriga widgets sparade
         inställningar (§8 — det vore motsatsen till vad "återställ
         till standard" betyder). */
      DashboardConfig.resetUserLayout(layoutUserId);
      this._editMode = false;
      this._editDraft = null;
      this._editSourceLayout = null;
      this._editResetToDefault = false;
      this.render();
      showToast('Dashboard återställd till standard');
      return;
    }
    /* V51B R2 §5 / R3 — BLOCKERARE-FIX: sparade tidigare BARA den
       behörighetsfiltrerade draften rakt av, vilket TYST RADERADE en
       giltig sparad konfiguration för varje widget användaren för
       tillfället saknar behörighet till (t.ex. "Offerter" om
       offer_manage temporärt saknas) — även om ändringen som faktiskt
       gjordes handlade om en helt annan widget. Behörighetsfiltrering
       och persistens är två separata frågor (§3): en obehörig widget
       får ALDRIG synas, men dess sparade inställning ska ändå överleva
       en icke-relaterad Spara.

       R2:s FÖRSTA version av sammanslagningen bevarade rätt
       id/visible/span, men flyttade ALLTID de obehöriga posterna sist
       — vilket i praktiken ändrade en tillfälligt obehörig widgets
       PLATS i layouten trots att inget faktiskt sparbart beslut om just
       den widgeten hade fattats. R3 bevarar nu ÄVEN den ursprungliga
       platsen (§4):

       1. `_editSourceLayout` (fångad, oförändrad, vid enterEditMode())
          representerar de ORIGINALA "platserna" i ordning.
       2. Ett käll-id som INTE finns i den behörighetsfiltrerade
          draften är "reserverat" — den platsen ska behållas EXAKT som
          den var (id/visible/span oförändrade).
       3. Övriga ("icke-reserverade") platser fylls, i tur och ordning,
          med den redigerade draftens poster I DRAFTENS NYA ordning —
          detta är vad som gör att en genuin användar-omordning bland de
          AUKTORISERADE widgetsen fortfarande slår igenom fullt ut,
          samtidigt som den reserverade platsen inte rör sig.
       4. Eventuella draft-poster utan en käll-plats (nya moduler som
          inte fanns med i källan alls) läggs till sist, deterministiskt.
       5. Sekventiella order-nummer 0..N-1 tilldelas till sist.

       Exempel (käll-verifierat, se PRE-bevis i rapporten):
         KÄLLA:  [A, U, B, C]   (U tillfälligt obehörig)
         DRAFT (efter omordning av A/B/C): [C, A, B]
         RESULTAT: [C, U, A, B]  — U kvar på sin plats (index 1),
                    C/A/B i sin NYA inbördes ordning på de kvarvarande
                    platserna.

       Endast KÄND, redan normaliserad modul-id kan någonsin hamna i den
       reserverade delen — okända/borttagna modul-id:n filtrerades redan
       bort av normalizePersonalLayout() när _editSourceLayout byggdes,
       så inget nytt säkerhetshål öppnas här (oförändrat sedan R2). */
    const source = this._editSourceLayout || [];
    const draftIds = new Set(this._editDraft.map(e => e.id));
    const draftQueue = this._editDraft.map(e => ({ id: e.id, visible: e.visible, span: e.span }));
    let draftPtr = 0;

    const merged = source.map(srcEntry => {
      if (draftIds.has(srcEntry.id)) {
        // Behörig plats — fyll med nästa post i draftens NYA ordning
        // (inte nödvändigtvis samma id som ursprungligen låg i just
        // denna källplats — det är precis poängen: den redigerade
        // inbördes ordningen bland de behöriga widgetsen ska slå
        // igenom, medan de reserverade platserna inte rör sig).
        const next = draftQueue[draftPtr++];
        return next;
      }
      // Reserverad (för tillfället obehörig) plats — behåll oförändrad.
      return { id: srcEntry.id, visible: srcEntry.visible, span: srcEntry.span };
    });
    // Draft-poster utan en käll-plats (t.ex. helt nya moduler som aldrig
    // funnits i den sparade layouten) läggs till sist, deterministiskt.
    while (draftPtr < draftQueue.length) merged.push(draftQueue[draftPtr++]);

    const layout = merged.map((e, i) => ({ id: e.id, visible: e.visible, span: e.span, order: i }));
    DashboardConfig.saveUserLayout(layoutUserId, layout);
    this._editMode = false;
    this._editDraft = null;
    this._editSourceLayout = null;
    this.render();
    showToast('Dashboard-layout sparad');
  },

  /* Nollställer BARA draften (§13) — inte persisterat förrän Spara.
     Markerar draften som en ÄKTA återställning (se _editResetToDefault
     ovan) tills en genuin efterföljande ändring (resize/dölj/återställ-
     widget/flytta/drag) nollställer flaggan igen — se respektive metod. */
  resetEditDraft() {
    const user = Auth.getUser();
    if (!user) return;
    const roleId = user.role || 'personal';
    const def = DashboardConfig.getDefaultLayout(roleId);
    this._editDraft = this._buildDraftFrom(def, user);
    this._editResetToDefault = true;
    this.render();
    showToast('Standardlayout inläst i redigeringsläget — klicka Spara för att bekräfta');
  },

  /* Bygger redigeringsdraften: EN rad per modul användaren faktiskt har
     behörighet att se (§11 — obehöriga moduler kan aldrig dyka upp i
     draften eller i den dolda-widgets-hyllan, oavsett vad en sparad
     layout råkar innehålla). Ordning följer den inkommande layoutens
     `order`; moduler som saknas i layouten (nya, ej ännu sparade)
     hamnar sist. */
  _buildDraftFrom(layout, user) {
    const permitted = DashboardConfig.getAllModules().filter(m => this._canSee(m.id));
    const draft = permitted.map(m => {
      const e = layout.find(x => x.id === m.id);
      return {
        id: m.id,
        visible: e ? !!e.visible : false,
        span: e && typeof e.span === 'number' ? DashboardConfig.clampSpan(e.span, m.id) : DashboardConfig.clampSpan(DashboardConfig.sizeToSpan(m.defaultSize), m.id)
      };
    });
    draft.sort((a, b) => {
      const ia = layout.findIndex(x => x.id === a.id);
      const ib = layout.findIndex(x => x.id === b.id);
      return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
    });
    return draft;
  },

  /* ── Draft-mutationer (ALLA renderar om draften, ALDRIG persistens) ───
     V51B R1 §9: VARJE genuin draft-mutation nedan nollställer
     _editResetToDefault — en "Återställ standard" följt av en faktisk
     ändring är INTE längre en ren återställning, och Spara ska då
     persistera den resulterande anpassade layouten via saveUserLayout()
     (inte resetUserLayout()). */
  _editSetSpan(id, span) {
    const e = this._editDraft.find(x => x.id === id);
    if (!e) return;
    e.span = DashboardConfig.clampSpan(parseInt(span, 10), id);
    this._editResetToDefault = false;
    this.render();
  },

  _editHideWidget(id) {
    const e = this._editDraft.find(x => x.id === id);
    if (!e) return;
    e.visible = false;
    this._editResetToDefault = false;
    this.render();
  },

  /* §12: återställd widget använder sitt sparade/standard-span och
     placeras deterministiskt sist i griddet. */
  _editRestoreWidget(id) {
    const idx = this._editDraft.findIndex(x => x.id === id);
    if (idx === -1) return;
    const [e] = this._editDraft.splice(idx, 1);
    e.visible = true;
    this._editDraft.push(e);
    this._editResetToDefault = false;
    this.render();
  },

  /* Tillgänglig/tangentbords-/touch-säker ordningsfallback (§15) — flyttar
     widgeten ett steg upp/ned bland de SYNLIGA widgetsen. Detta är INTE
     en andra, separat layout-editor — det är samma draft, samma
     grid, bara manipulerad utan pekardrag. */
  _editMoveWidget(id, dir) {
    const draft = this._editDraft;
    const visibleIds = draft.filter(e => e.visible).map(e => e.id);
    const vIdx = visibleIds.indexOf(id);
    if (vIdx === -1) return;
    const targetVIdx = vIdx + dir;
    if (targetVIdx < 0 || targetVIdx >= visibleIds.length) return;
    const targetId = visibleIds[targetVIdx];
    const i1 = draft.findIndex(e => e.id === id);
    const i2 = draft.findIndex(e => e.id === targetId);
    [draft[i1], draft[i2]] = [draft[i2], draft[i1]];
    this._editResetToDefault = false;
    this.render();
  },

  /* ── Pekar-/musbaserad drag-omordning ──────────────────────────────────
     V51B §14: native HTML5 drag-and-drop (dragstart/dragover/drop) kräver
     att draggable="true" sitter på HELA kortet, vilket gör det svårt att
     begränsa dragstart till bara draghandtaget utan bräckliga workarounds
     — och är notoriskt opålitligt att simulera i automatiserad testning.
     En enkel pekar-baserad (mousedown/mousemove/mouseup) drag som bara
     LYSSNAR från handtaget är enklare, mer förutsägbar och lättare att
     verifiera med riktiga musrörelser i Chromium. */
  _dragStart(e, id) {
    e.preventDefault();
    e.stopPropagation();
    this._drag = { id, moveHandler: null, upHandler: null };
    document.body.classList.add('dash-dragging');
    const move = (ev) => this._dragMove(ev);
    const up   = (ev) => this._dragEnd(ev);
    this._drag.moveHandler = move;
    this._drag.upHandler = up;
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up);
  },

  _dragMove(e) {
    if (!this._drag) return;
    if (e.touches) e.preventDefault();
    const point = e.touches ? e.touches[0] : e;
    const el = document.elementFromPoint(point.clientX, point.clientY);
    const card = el && el.closest ? el.closest('.dash-edit-card') : null;
    if (!card) return;
    const overId = card.getAttribute('data-widget-id');
    if (!overId || overId === this._drag.id) return;
    const draft = this._editDraft;
    const fromIdx = draft.findIndex(x => x.id === this._drag.id);
    const toIdx   = draft.findIndex(x => x.id === overId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const [moved] = draft.splice(fromIdx, 1);
    draft.splice(toIdx, 0, moved);
    this._editResetToDefault = false;
    this.render();
  },

  _dragEnd() {
    if (!this._drag) return;
    document.removeEventListener('mousemove', this._drag.moveHandler);
    document.removeEventListener('mouseup', this._drag.upHandler);
    document.removeEventListener('touchmove', this._drag.moveHandler);
    document.removeEventListener('touchend', this._drag.upHandler);
    document.body.classList.remove('dash-dragging');
    this._drag = null;
  },

  /* ── Redigeringsläge — render ──────────────────────────────────────── */
  _renderEditMode(el, user, roleId) {
    const draft = this._editDraft || [];
    const visible = draft.filter(e => e.visible);
    const hidden  = draft.filter(e => !e.visible);

    const cardHtml = (e, idx) => {
      const mod = DashboardConfig.getModule(e.id);
      if (!mod) return '';
      const minSpan = DashboardConfig.getMinSpan(e.id);
      const widgetHtml = this._renderWidget(e.id) ||
        `<div class="card"><div class="card-header"><h3 class="ch3">${ic(mod.icon||'square',14)} ${esc(mod.title)}</h3></div><div class="card-body"><div class="empty" style="padding:12px 0;gap:4px;">${ic('inbox',20)}<p style="font-size:11px;">Inget att visa just nu</p></div></div></div>`;
      const spanOpts = DashboardConfig.VALID_SPANS
        .filter(s => s >= minSpan)
        .map(s => `<option value="${s}" ${s === e.span ? 'selected' : ''}>${DashboardConfig.SPAN_LABELS[s]}</option>`)
        .join('');
      return `<div class="dgw-${e.span} dash-edit-card" data-widget-id="${e.id}">
        <div class="dash-edit-chrome">
          <span class="dash-edit-handle" title="Dra för att flytta" onmousedown="Dashboard._dragStart(event,'${e.id}')" ontouchstart="Dashboard._dragStart(event,'${e.id}')">${ic('more-vertical',13)}</span>
          <span class="dash-edit-title">${esc(mod.title)}</span>
          <div class="dash-edit-actions">
            <button type="button" class="btn bghost bxs" title="Flytta upp" aria-label="Flytta ${esc(mod.title)} upp" ${idx===0?'disabled':''} onclick="Dashboard._editMoveWidget('${e.id}',-1)">${ic('chevron-up',12)}</button>
            <button type="button" class="btn bghost bxs" title="Flytta ned" aria-label="Flytta ${esc(mod.title)} ned" ${idx===visible.length-1?'disabled':''} onclick="Dashboard._editMoveWidget('${e.id}',1)">${ic('chevron-down',12)}</button>
            <select title="Bredd" aria-label="Bredd för ${esc(mod.title)}" onchange="Dashboard._editSetSpan('${e.id}',this.value)">${spanOpts}</select>
            <button type="button" class="btn bghost bxs" title="Dölj widget" aria-label="Dölj ${esc(mod.title)}" onclick="Dashboard._editHideWidget('${e.id}')">${ic('eye-off',12)}</button>
          </div>
        </div>
        <div class="dash-edit-card-body">${widgetHtml}</div>
      </div>`;
    };

    const gridHtml = visible.map((e, i) => cardHtml(e, i)).join('');

    const hiddenHtml = hidden.length ? `
      <div class="dash-edit-hidden-tray">
        <div class="dash-edit-hidden-title">${ic('eye-off',12)} Dolda widgets</div>
        <div class="dash-edit-hidden-list">
          ${hidden.map(e => {
            const mod = DashboardConfig.getModule(e.id);
            if (!mod) return '';
            return `<button type="button" class="dash-edit-hidden-chip" onclick="Dashboard._editRestoreWidget('${e.id}')">
              ${ic(mod.icon||'square',12)} ${esc(mod.title)}
              <span class="dash-edit-hidden-restore">${ic('plus',10)} Visa</span>
            </button>`;
          }).join('')}
        </div>
      </div>` : '';

    el.innerHTML = `
      <div class="dash-edit-toolbar">
        <div class="dash-edit-toolbar-title">${ic('settings',15)} Anpassa dashboard</div>
        <div class="dash-edit-toolbar-actions">
          <button type="button" class="btn bs bsm" onclick="Dashboard.resetEditDraft()">${ic('rotate-ccw',12)} Återställ standard</button>
          <button type="button" class="btn bghost bsm" onclick="Dashboard.exitEditModeCancel()">Avbryt</button>
          <button type="button" class="btn bp bsm" onclick="Dashboard.saveEditMode()">${ic('check',13)} Spara</button>
        </div>
      </div>
      <p class="dash-edit-hint">Dra i handtaget ${ic('more-vertical',10)} för att ändra ordning, eller använd pilknapparna. Välj bredd, eller dölj widgets du inte vill se.</p>
      <div class="dash-layout">${gridHtml}</div>
      ${hiddenHtml}
    `;

    this._scheduleMapInit(visible.some(e => e.id === 'ops_map'));
  },

  /* ── Personliga inställningar ──────────────────────────────────────── */
  openUserPrefs() {
    const user = Auth.getUser();
    if (!user) return;
    const prefs   = UserPrefsService.get(user.id);
    const accent  = prefs.accentColor || '';
    /* V51B R7.1 §5 — Sidebar sparade historiskt 'airy' för samma "Luftig"-val
       som denna dialog alltid kallat 'spacious' (pre-R7-enum-mismatch). Ett
       redan sparat 'airy'-värde ska fortfarande visas som Luftig valt här,
       utan att själva localStorage-värdet skrivs om (icke-destruktivt). */
    const densityRaw = prefs.density || 'normal';
    const density = densityRaw === 'airy' ? 'spacious' : densityRaw;
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
  /* V51A R3 §13 — AUDITERAD, medvetet OFÖRÄNDRAD: denna widget styrs av
     staff_view/reports_view, INTE ao_view_all/ao_view_own. Dessa två
     permissions är per CLAUDE.md:s behörighetstabell chefs-/rapportnivå
     ("Visa personal", "Rapporter och löneunderlag") — helt separata från
     och strikt bredare än den vanliga fälttekniker-behörigheten
     ao_view_own. En roll som har staff_view/reports_view men INTE
     ao_view_all representerar ändå en operativ chefsöversiktsroll (t.ex.
     "ekonomi" eller "chef" utan direkt AO-hantering), inte en enskild
     tekniker — de globala räknarna här är alltså en AVSIKTLIG,
     rollmässigt separat chefsvy, inte en läcka av ao_view_own-data.
     Ingen AO-behörighet (ao_view_all/ao_view_own) krävs eller kontrolleras
     här eftersom widgeten aldrig är nåbar av en ren fälttekniker-roll utan
     staff_view/reports_view. Lämnas därför global, precis som innan R3. */
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
    /* V51A R3 §9 — blockerare D: kategorifördelning och "klara denna
       månad"/"öppna nu"-talen byggdes tidigare från ALLA bolagets
       arbetsorder, oavsett om användaren bara hade ao_view_own. En
       own-only-tekniker kunde alltså se hela bolagets öppna backlog och
       kategorifördelning. Nu skopat via samma kanoniska hjälpfunktion
       (inkl. delad pool, konsekvent med KPI/hero/todos). */
    const all    = this._scopeWorkOrdersForCurrentUser(
      (state.workOrders||[]).filter(a => !a.archived && !a.deleted),
      { includeSharedPool: true }
    );
    const isOpen = a => !['klar','fakturerad','avbruten'].includes(a.status);
    const openAos = all.filter(isOpen);
    /* V51A R1 §14/§15 — blockerare D: den fejkade färdigställandeprocenten
       togs bort helt.
       V51A (första rundan) bytte den GAMLA missvisande "för evigt mot
       100%"-livstidsandelen mot doneThisMonth/(openNow+doneThisMonth) —
       men det löste inte det underliggande problemet: täljaren är ett
       MÅNADSFLÖDE (ordrar färdiga DENNA månad) och nämnaren blandar in ett
       LAGERSALDO (alla ordrar öppna just nu, oavsett när de skapades) —
       två storheter som mäter olika saker och som ALDRIG utgör en giltig
       färdigställandegrad, oavsett hur formeln skalas. Ersatt med ett
       rent FAKTAPÅSTÅENDE utan påhittad procent: "N klara denna månad" +
       "M öppna nu" — två separata, var för sig korrekta tal, ingen
       kombinerad/antydd completion-rate.
       Kategoriradernas staplar NEDANFÖR är OFÖRÄNDRADE och behöver ingen
       fix — de visar redan `categoryCount / totalOpenCount`, dvs. varje
       kategoris ANDEL AV NUVARANDE ÖPPEN ARBETSBELASTNING, vilket är en
       koherent nämnare (till skillnad från den borttagna toppsiffran). */
    const monthStr = tdy().substring(0, 7);
    const doneThisMonth = all.filter(a => ['klar','fakturerad'].includes(a.status) && (a.completedAt||'').startsWith(monthStr));
    const doneN  = doneThisMonth.length;
    const openN  = openAos.length;

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
        <div style="display:flex;gap:14px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--br);">
          <span style="font-size:11px;color:var(--mt);"><strong style="color:var(--navy);font-size:12px;">${doneN}</strong> klara denna månad</span>
          <span style="font-size:11px;color:var(--mt);"><strong style="color:var(--navy);font-size:12px;">${openN}</strong> öppna nu</span>
        </div>
        ${rows}
      </div>
    </div>`;
  },

  /* ── Widget: Aktiva jobb — karta (V51A) ───────────────────────────────
     Karta + kompakt lista över operativa arbetsorder med känd adress.
     Återanvänder VIFT:s BEFINTLIGA Mapbox-integration (samma
     window.VIFT_CONFIG.mapboxToken som AddressService redan använder för
     adress-autokomplettering) — ingen ny kartleverantör. Ingen ny
     koordinat lagras/persisteras någonstans (rent läsande widget); adresser
     geokodas on-demand via AddressService.search() och cachas ENDAST i
     minnet för sessionen (Dashboard._geoCache), aldrig i localStorage/
     state/Supabase. */
  _opsMapJobs: [],
  _geoCache: {},
  _mapInstance: null,
  _mapGeneration: 0,
  _mapInitTimer: null,
  _mapboxLoadPromise: null,

  _widgetOpsMap() {
    if (!Auth.canAny(['ao_view_all','ao_view_own'])) return null;

    /* V51A §14: samma kanoniska "operativ/aktiv"-status-uppsättning som
       redan används i _calcKPIs/_widgetOperations — inga gissade
       statussträngar. Uttryckligen uteslutet: fakturerad/klar/avbruten
       (ej längre operativa) samt naturligtvis deleted/archived. */
    const ACTIVE_STATUSES = ['nytt','pool','planerad','pågående'];
    const allOperational = (state.workOrders || []).filter(a =>
      !a.archived && !a.deleted && ACTIVE_STATUSES.includes(a.status)
    );

    /* V51A R1 §6 — FAIL-CLOSED behörighetskontrakt (blockerare B).
       V51A R3 §10: numera implementerad via den kanoniska
       _scopeWorkOrdersForCurrentUser()-hjälpen (samma kontrakt som
       _widgetToday() och alla andra AO-ytor delar) istället för en egen
       kopia av logiken — men det FUNKTIONELLA beteendet är exakt
       oförändrat mot R1/R2:
         ao_view_all              → alla operativa jobb
         ao_view_own + giltigt id → ENDAST jobb tilldelade exakt det id:t
                                     (ingen delad pool på kartan — samma
                                     som tidigare, includeSharedPool:false)
         annars                   → inga jobb alls (fail closed) */
    let jobs = this._scopeWorkOrdersForCurrentUser(allOperational, { includeSharedPool: false });

    // Sortera: idag/försenat/akut överst, sedan planerat datum
    const today = tdy();
    jobs = jobs.slice().sort((a, b) => {
      const aUrgent = a.priority === 'akut' ? 0 : 1;
      const bUrgent = b.priority === 'akut' ? 0 : 1;
      if (aUrgent !== bUrgent) return aUrgent - bUrgent;
      return (a.scheduledDate || '9999') < (b.scheduledDate || '9999') ? -1 : 1;
    });
    this._opsMapJobs = jobs;

    if (jobs.length === 0) {
      return `<div class="card">
        <div class="card-header"><h3 class="ch3">${ic('map-pin',14)} Aktiva jobb — karta</h3></div>
        <div class="card-body"><div class="empty" style="padding:12px 0;gap:4px;">${ic('check-circle',22)}<p style="font-size:11px;">Inga aktiva jobb just nu</p></div></div>
      </div>`;
    }

    const jobRow = ao => {
      const cu = getCu(ao.customerId);
      const prop = ao.propertyId ? getObj(ao.propertyId) : null;
      /* V51A R4 — adress-precedensfix. ao.address (om satt) är den
         KANONISKA arbetsplatsadressen överallt annars i appen
         (WorkOrderDetailPage, MyJobsPage, OperationsPage visar alltid
         ao.address rakt av, utan någon fastighets-precedens) — Dashboard
         var den ENDA ytan i hela kodbasen som lät en länkad fastighets
         (ev. inaktuella) adress permanent övertrumfa AO:ns egen,
         redigerbara adressfält. Resultat: en användare som redigerade
         AO:ns adress via redigera-ordern-modalen såg sin nya adress
         korrekt på AO-sidan, men Dashboard fortsatte tyst visa den gamla
         fastighetsadressen oavsett hur många gånger Dashboard
         renderades om — inte en cache-/race-bugg, utan en
         precedensbugg isolerad till denna widget. Fastighetens adress
         används nu bara som FALLBACK när AO:n saknar egen adress. */
      const locLabel = ao.address || (prop && prop.address) || (cu ? CustomerService.displayName(cu) : '—');
      const cl = ao.checklist || [];
      const clDone = cl.filter(c => c.done).length;
      const hasChecklist = cl.length > 0;
      const barColor = ao.priority === 'akut' ? 'var(--rd)' : (ao.status === 'pågående' ? 'var(--gr)' : 'var(--sky)');
      return `<div class="dash-job-row" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
        <div class="dash-job-row-body">
          <div class="dash-job-row-top">
            <span class="dash-job-row-title">${esc(ao.title||ao.id)}</span>
            ${sbdg(ao.status)}
          </div>
          <div class="dash-job-row-sub">${esc(locLabel)}${ao.scheduledStart ? ' · '+ao.scheduledStart : ''}</div>
          ${hasChecklist ? `
            <div style="display:flex;align-items:center;gap:6px;">
              <div class="dash-job-progress-track" style="flex:1;"><div class="dash-job-progress-fill" style="width:${Math.round(clDone/cl.length*100)}%;background:${barColor};"></div></div>
              <span class="dash-job-progress-label">${clDone}/${cl.length}</span>
            </div>` : ''}
        </div>
      </div>`;
    };

    return `<div class="card">
      <div class="card-header">
        <h3 class="ch3">${ic('map-pin',14)} Aktiva jobb — karta</h3>
        <button class="btn bghost bxs" style="font-size:11px;padding:3px 8px;" onclick="Router.showPage('pg-ao',{filter:'active'})">${ic('arrow-right',11)} Se alla</button>
      </div>
      <div class="card-body" style="padding:10px 14px;">
        <div class="dash-ops-map-count" id="dash-ops-map-count">${jobs.length} aktiv${jobs.length===1?'t':'a'} jobb</div>
        <div class="dash-ops-map-wrap">
          <div class="dash-ops-map-list">${jobs.map(jobRow).join('')}</div>
          <div class="dash-ops-map-canvas-wrap" id="dash-ops-map-canvas-wrap">
            <div id="dash-ops-map"></div>
          </div>
        </div>
      </div>
    </div>`;
  },

  /* V51A R1 §13: Mapbox GL JS laddas nu LAT/ON-DEMAND — bara när
     dashboardens kart-widget faktiskt ska visas — istället för som en
     blockerande global <script>-tagg i index.html som skulle göra HELA
     CRM-startens laddningskedja beroende av en extern karta-CDN även för
     användare som aldrig öppnar Dashboard/kartan. En enda cachad Promise
     delas mellan samtliga samtidiga anrop (t.ex. flera snabba
     Dashboard.render()) så skriptet/CSS:en injiceras högst en gång. */
  _loadMapboxGl() {
    if (typeof mapboxgl !== 'undefined') return Promise.resolve();
    if (this._mapboxLoadPromise) return this._mapboxLoadPromise;
    this._mapboxLoadPromise = new Promise((resolve, reject) => {
      const cssHref = 'https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css';
      if (!document.querySelector('link[href="' + cssHref + '"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssHref;
        document.head.appendChild(link);
      }
      const jsSrc = 'https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js';
      const existing = document.querySelector('script[src="' + jsSrc + '"]');
      if (existing) {
        if (typeof mapboxgl !== 'undefined') { resolve(); return; }
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Mapbox GL JS kunde inte laddas')));
        return;
      }
      const script = document.createElement('script');
      script.src = jsSrc;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Mapbox GL JS kunde inte laddas'));
      document.head.appendChild(script);
    });
    return this._mapboxLoadPromise;
  },

  /* Körs EFTER att render() satt innerHTML (måste vänta på att DOM-noden
     #dash-ops-map faktiskt finns). Anropas via setTimeout från render()
     med (generation, jobsSnapshot) — se render()s generationsspärr-
     kommentar. Skapar ALDRIG en ny mapboxgl.Map-instans utan att först
     städa bort en ev. redan existerande — så inga dubbla instanser/
     lyssnare kan ackumuleras över upprepade Dashboard.render()-anrop.

     V51A R1 §9/§10: `generation` kontrolleras INNAN varje DOM-/kart-
     muterande steg (start, efter Mapbox-laddning, efter varje geokodning,
     före kartskapande) — en föråldrad generation avbryter TYST utan att
     röra DOM eller en nyare generations karta. */
  async _initOpsMap(generation, jobs) {
    if (generation !== this._mapGeneration) return; // redan föråldrad innan start

    const wrap = document.getElementById('dash-ops-map-canvas-wrap');
    const countEl = document.getElementById('dash-ops-map-count');
    if (!wrap) return; // widgeten är inte synlig i aktuell layout

    if (this._mapInstance) {
      try { this._mapInstance.remove(); } catch(e) {}
      this._mapInstance = null;
    }

    const token = (window.VIFT_CONFIG && window.VIFT_CONFIG.mapboxToken) || '';
    if (!token) {
      wrap.innerHTML = `<div class="dash-ops-map-empty">${ic('map-pin',22)}<span>Kartan kunde inte laddas</span></div>`;
      return;
    }

    try {
      await this._loadMapboxGl();
    } catch(e) {
      if (generation !== this._mapGeneration) return;
      wrap.innerHTML = `<div class="dash-ops-map-empty">${ic('map-pin',22)}<span>Kartan kunde inte laddas</span></div>`;
      return;
    }
    if (generation !== this._mapGeneration) return;

    jobs = jobs || [];
    const geocoded = [];
    const MAX_LOOKUPS = 20; // V51A §19: begränsa antal NYA geokodningsanrop per uppdatering
    let newLookups = 0;

    for (const ao of jobs) {
      if (generation !== this._mapGeneration) return; // avbruten mitt i geokodningsloopen av en nyare render()

      const prop = ao.propertyId ? getObj(ao.propertyId) : null;
      /* V51A R4 — samma precedensfix som jobRow() ovan (måste hållas
         identisk, annars kan listan och kartfrågan divergera för samma
         AO): ao.address vinner om satt, fastighetens adress är bara
         fallback. */
      const address = ao.address || (prop && prop.address) || '';
      if (!address) continue;

      let coord = this._geoCache[address];
      if (coord === undefined) {
        if (newLookups >= MAX_LOOKUPS) continue; // hoppa över — visas fortfarande i listan, bara inte på kartan denna gång
        newLookups++;
        try {
          const results = await AddressService.search(address);
          if (generation !== this._mapGeneration) return; // svaret hann bli inaktuellt medan vi väntade
          /* V51A R1 §12: ENDAST ett äkta, LYCKAT API-svar med noll träffar
             cachas som null. Ett undantag (nätverksfel, timeout etc.)
             cachas ALDRIG — adressen lämnas `undefined` i _geoCache så en
             SENARE rendering får försöka igen istället för att adressen
             blir permanent "okartläggningsbar" för resten av
             webbläsarsessionen på grund av ett tillfälligt fel. */
          coord = (results && results[0] && results[0].lat && results[0].lng)
            ? { lat: results[0].lat, lng: results[0].lng }
            : null;
          this._geoCache[address] = coord;
        } catch(e) {
          coord = null; // visas inte i DENNA runda, men försöks igen nästa gång (ej cachat)
        }
      }
      if (coord) geocoded.push({ ao, coord });
    }

    if (generation !== this._mapGeneration) return;

    if (countEl) {
      countEl.textContent = geocoded.length === jobs.length
        ? `${jobs.length} aktiv${jobs.length===1?'t':'a'} jobb`
        : `${jobs.length} aktiv${jobs.length===1?'t':'a'} jobb · ${geocoded.length} visas på karta`;
    }

    if (geocoded.length === 0) {
      wrap.innerHTML = `<div class="dash-ops-map-empty">${ic('map-pin',22)}<span>Inga jobb kunde placeras på kartan${jobs.length?' — se listan':''}</span></div>`;
      return;
    }

    // Återställ canvas-elementet (kan ha ersatts av tom-läge ovan i ett tidigare pass)
    if (!document.getElementById('dash-ops-map')) {
      if (generation !== this._mapGeneration) return;
      wrap.innerHTML = '<div id="dash-ops-map"></div>';
    }
    if (generation !== this._mapGeneration || !document.getElementById('dash-ops-map-canvas-wrap')) return;

    try {
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: 'dash-ops-map',
        style: 'mapbox://styles/mapbox/light-v11',
        center: [geocoded[0].coord.lng, geocoded[0].coord.lat],
        zoom: 11
      });
      this._mapInstance = map;

      const bounds = new mapboxgl.LngLatBounds();
      geocoded.forEach(({ ao, coord }) => {
        const color = ao.priority === 'akut' ? '#dc2626' : (ao.status === 'pågående' ? '#16a34a' : '#2b7fd4');
        const cu = getCu(ao.customerId);
        const cuName = cu ? CustomerService.displayName(cu) : '—';
        const popupHtml = `<div class="dash-map-popup">
          <div class="dash-map-popup-title">${esc(ao.title||ao.id)}</div>
          <div class="dash-map-popup-sub">${esc(cuName)}${ao.scheduledStart ? ' · '+esc(ao.scheduledStart) : ''}</div>
          <button type="button" class="dash-map-popup-btn" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">Öppna</button>
        </div>`;
        new mapboxgl.Marker({ color })
          .setLngLat([coord.lng, coord.lat])
          .setPopup(new mapboxgl.Popup({ offset: 18 }).setHTML(popupHtml))
          .addTo(map);
        bounds.extend([coord.lng, coord.lat]);
      });
      if (geocoded.length > 1) map.fitBounds(bounds, { padding: 36, maxZoom: 14 });
    } catch(e) {
      console.error('[Dashboard] kartfel:', e);
      if (generation === this._mapGeneration) {
        wrap.innerHTML = `<div class="dash-ops-map-empty">${ic('map-pin',22)}<span>Kartan kunde inte laddas</span></div>`;
      }
    }
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
    const hasAll   = Auth.can('ao_view_all');

    const eligibleToday = (state.workOrders || []).filter(a =>
      !a.archived && !a.deleted &&
      a.scheduledDate === today && !['klar','fakturerad','avbruten'].includes(a.status)
    );

    /* V51A R2 — FAIL-CLOSED behörighetskontrakt (samma som _widgetOpsMap()
       sedan R1 §6). V51A R3 §10: numera implementerad via den kanoniska
       _scopeWorkOrdersForCurrentUser()-hjälpen istället för en egen kopia
       av logiken — det FUNKTIONELLA beteendet är exakt oförändrat:
         ao_view_all              → alla dagens operativa jobb
         ao_view_own + giltigt id → ENDAST jobb tilldelade exakt det id:t
         annars                   → inga jobb alls (fail closed) — widgeten
                                     visar då sitt normala tomma-läge, ALDRIG
                                     ett fall tillbaka till global data. */
    const todayAOs = this._scopeWorkOrdersForCurrentUser(eligibleToday, { includeSharedPool: false });

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
              const renderRow = ao => { var cu = getCu(ao.customerId); return `<div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})"><div class="crow-top"><div class="crow-title">${ao.title}</div>${sbdg(ao.status)}</div><div class="crow-sub">${ao.scheduledStart||'?'}–${ao.scheduledEnd||'?'} · ${cu?CustomerService.displayName(cu):'—'}</div></div>`; };
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
  /* V51A R3 §5/§11 — poolen är per källverifierad kontrakt (WorkOrdersPage
     _baseList()) AVSIKTLIGT delad: alla med ao_view_own ser HELA den
     delade poolen, inte bara sina egna ordrar. Detta var redan widgetens
     tidigare beteende (inget filter alls) och ändras INTE i sak för en
     användare med giltig identitet. Det som ändras: om ao_view_own är
     satt men identiteten inte går att fastställa (Auth.getUser() null/
     utan giltigt id) visas nu poolen INTE längre — samma fail-closed-
     härdning som resten av Dashboardens AO-ytor, istället för att lita på
     att "poolen är ändå delad så det spelar ingen roll". En bruten
     identitetsupplösning ska aldrig tolkas som "visa ändå". */
  _widgetPool() {
    const poolScope = this._scopeWorkOrdersForCurrentUser(
      (state.workOrders || []).filter(a => !a.archived && !a.deleted),
      { includeSharedPool: true }
    );
    const pool = poolScope.filter(a => a.status === 'pool');
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
              const renderRow = ao => { var cu = getCu(ao.customerId); return `<div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})"><div class="crow-top"><div class="crow-title">${ao.title}</div>${pbdg(ao.priority)}</div><div class="crow-sub">${cu?CustomerService.displayName(cu):'—'}</div></div>`; };
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
          const renderRow = r => { var days = Math.ceil((new Date(r.nextDate)-new Date(tdy()))/86400000); var cu = getCu(r.customerId); return `<div class="crow" onclick="Router.showPage('pg-recurring')"><div class="crow-top"><div class="crow-title">${r.title}</div><span class="bdg ${days<=0?'bdg-red':'bdg-orange'}" style="font-size:10px;white-space:nowrap;flex-shrink:0;">${days<=0?'Förfallen':days===0?'Idag':days+' d'}</span></div><div class="crow-sub">${cu?CustomerService.displayName(cu):'—'}</div></div>`; };
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
  /* V51A R3 §14 — denna widget nås via 'recurring'-modulens fallback,
     som styrs av recurring_manage — EN behörighet som inte alls
     garanterar ao_view_all/ao_view_own. En användare med enbart
     recurring_manage (t.ex. en roll fokuserad på återkommande avtal utan
     daglig AO-hantering) kunde tidigare ändå se bolagets samtliga
     planerade arbetsorder för kommande vecka här — en AO-läcka helt
     utanför AO-behörighetssystemet. Nu skopat via samma kanoniska
     hjälpfunktion som resten av Dashboard: ao_view_all → oförändrat;
     ao_view_own + giltigt id → endast egna planerade ordrar; ingen
     AO-behörighet alls (eller oupplösbar identitet) → tom lista, widgeten
     visar sitt normala tomma-läge utan att avslöja någon AO-data. */
  _widgetPlanned() {
    const today   = tdy();
    const week    = _ds(7);
    const eligible = (state.workOrders||[]).filter(a =>
      a.status === 'planerad' && !a.archived && !a.deleted &&
      a.scheduledDate > today && a.scheduledDate <= week
    );
    const planned = this._scopeWorkOrdersForCurrentUser(eligible, { includeSharedPool: false });
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
              const renderRow = ao => { var cu = getCu(ao.customerId); return `<div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})"><div class="crow-top"><div class="crow-title">${ao.title}</div>${sbdg(ao.status)}</div><div class="crow-sub">${fmtDate(ao.scheduledDate)} · ${cu?CustomerService.displayName(cu):'—'}</div></div>`; };
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
                <div class="crow-top">
                  <div class="crow-title">${opp.title}</div>
                  ${pBadge}
                </div>
                <div class="crow-sub">${cuName}${val}</div>
                ${(overdueBadge || deadline) ? `<div class="crow-extra-badges">${overdueBadge}${deadline}</div>` : ''}
                ${tip}
              </div>`;
            }).join('')}
        ${active.length > 3 ? `<button class="btn bghost bfull bsm" style="margin-top:4px;" onclick="Router.showPage('pg-sales')">+${active.length-3} fler säljchanser</button>` : ''}
      </div>
    </div>`;
  },

  /* ── Widget: Offerter väntar ───────────────────────────────────────── */
  _widgetOffers() {
    /* V51A §2/§3: en offert i papperskorgen (deleted:true) eller arkiverad
       (archived:true) är INTE en aktiv, väntande offert — dessa fält är
       egna, oberoende flaggor i Schema.offer(), skilda från `status`, och
       måste alltid uteslutas ur operativa dashboard-vyer (samma princip
       som redan gäller konsekvent för arbetsorder via !a.archived &&
       !a.deleted överallt i denna fil). */
    const pending = (state.offers||[]).filter(o => !o.deleted && !o.archived && ['skickad','väntar'].includes(o.status));
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
              const renderRow = o => { var cu = getCu(o.customerId); var cuName = cu?(cu.name||(cu.firstName+' '+cu.lastName).trim()):'—'; var total = (o.lines||[]).reduce((s,l)=>s+(l.total||0),0); var age = o.sentAt?Math.floor((Date.now()-new Date(o.sentAt))/86400000):null; return `<div class="crow" onclick="Router.showPage('pg-offer-detail',{offerId:'${o.id}'})"><div class="crow-top"><div class="crow-title">${cuName}</div>${sbdg(o.status)}</div><div class="crow-sub">${fmt(total)} kr${age!==null?' · '+age+' dagar':''}</div></div>`; };
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
    const allAos   = (state.workOrders || []).filter(a => !a.archived && !a.deleted);
    /* V51A R3 §8 — blockerare C: "Aktiva ordrar"/"Klara denna månad"
       räknades tidigare från ALLA bolagets arbetsorder oavsett om
       användaren bara hade ao_view_own — en own-only-tekniker fick alltså
       se hela bolagets globala AO-räknare i KPI-raden. Skopat via samma
       kanoniska hjälpfunktion (inkl. delad pool, eftersom 'pool' redan
       ingick i den aktiva statuslistan nedan). `readyBill` (fakturering)
       styrs av ett HELT separat behörighetsdomän (invoice_view/
       invoice_create, se _widgetKpi()) och ska INTE skopas mot AO-ägande
       — den beräknas därför medvetet kvar från `allAos`, oskopad. */
    const aos = this._scopeWorkOrdersForCurrentUser(allAos, { includeSharedPool: true });
    return {
      activeOrders:  aos.filter(a => ['nytt','pool','planerad','pågående'].includes(a.status)).length,
      /* V51A §4/D.2: en order som fortfarande blev "klar" denna månad ska
         räknas som klar denna månad även om den senare flyttats vidare
         till fakturerad — completedAt sätts EN gång när status blir
         'klar' (WorkOrderService.js) och nollställs aldrig, så statusen
         måste kollas som klar ELLER fakturerad, inte bara exakt 'klar'
         (annars försvann ordern tyst ur måttet så fort den fakturerades). */
      doneThisMonth: aos.filter(a => ['klar','fakturerad'].includes(a.status) && (a.completedAt||'').startsWith(monthStr)).length,
      readyBill:     allAos.filter(a => a.status==='klar' && !a.invoiceId).length,
      /* V51A §2/§3: se _widgetOffers — samma saknade deleted/archived-
         kontroll fanns här (ett papperskorgs-offert kunde tidigare räknas
         med i "Offerter ute"-KPI:n). */
      openOffers:    (state.offers||[]).filter(o => !o.deleted && !o.archived && ['skickad','väntar'].includes(o.status)).length,
      /* V51A: denna KPI hade tidigare en EGEN, snävare whitelist
         (new/contacted/contact_needed) än den kanoniska
         SalesService.getActive() (som "Säljchanser"-widgeten och
         "Kräver åtgärd" redan använder — new/contact_needed/contacted/
         quote_created/work_order_created, minus snoozade med framtida
         datum). De två talen kunde alltså skilja sig åt på SAMMA
         sidladdning för samma data. Enad mot den kanoniska källan. */
      salesActive:   SalesService.getActive().length
    };
  },

  _calcTodos() {
    const todos = [];
    const today = tdy();
    const week  = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const allAos = (state.workOrders || []).filter(a => !a.archived && !a.deleted);
    /* V51A R3 §7 — blockerare B: "Akuta ordrar"/"Försenade arbetsorder"
       (inklusive faktiska AO-TITLAR i `sub`) beräknades tidigare från
       ALLA bolagets arbetsorder — en own-only-tekniker U1 kunde alltså få
       U2:s AO-titlar/kunder visade i "Kräver åtgärd" via Dashboard, trots
       att WorkOrdersPage aldrig skulle visa dem för U1. Skopat via samma
       kanoniska hjälpfunktion (inkl. delad pool, konsekvent med KPI/
       kategorier/hero — en akut pool-order är lika relevant att larma om
       för en own-only-tekniker som för alla andra). `readyBill` nedan
       styrs av det separata invoice_view/invoice_create-behörighetsdomänet
       och beräknas medvetet kvar från `allAos`, oskopat mot AO-ägande. */
    const aos = this._scopeWorkOrdersForCurrentUser(allAos, { includeSharedPool: true });

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
      const readyBill = allAos.filter(a => a.status==='klar' && !a.invoiceId);
      if (readyBill.length > 0) todos.push({
        icon:'receipt', iconCls:'orange',
        title:'Klara ordrar utan fakturaunderlag',
        sub:readyBill.length+' order'+(readyBill.length===1?'':'ar')+' redo för fakturering',
        badge:readyBill.length, badgeCls:'orange',
        onClick:"Router.showPage('pg-ao',{filter:'readyForInvoice'})"
      });
    }

    if (Auth.can('offer_manage')) {
      /* V51A §2 — GHOST-OFFER-FIXEN: en offert i papperskorgen (deleted)
         eller arkiverad (archived) visades tidigare ändå här om den
         råkade ha status:'skickad' och ett gammalt sentAt kvar — dessa två
         fält rensas/ändras inte automatiskt av papperskorgs-flödet, så en
         borttagen offert kunde permanent "spöka" i "Kräver åtgärd" tills
         någon manuellt bytte dess status. */
      const staleOff = (state.offers||[]).filter(o =>
        !o.deleted && !o.archived && o.status==='skickad' && o.sentAt && o.sentAt.split('T')[0] <= week
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
