/**
 * Dashboard v49 — Rollbaserad behörighet, anpassningsbar layout,
 * personliga inställningar per användare.
 * v49: Fix Anpassa-modal (grid-layout, tydliga modulnamn, ingen horisontell scroll).
 */

const Dashboard = {

  _collapsed: {},  /* { catKey: true } — persisted in sessionStorage */

  _colKey: 'dash_collapsed_v1',

  _loadCollapsed() {
    let stored = null;
    try { stored = sessionStorage.getItem(this._colKey); } catch(e) {}
    try { this._collapsed = JSON.parse(stored || '{}'); } catch(e) { this._collapsed = {}; }
    /* V3: på mobil börjar de tunga sektionerna hopfällda — dagens tavla och
       "Kräver åtgärd" räcker för att komma igång. Användarens egna val
       (sparade i sessionen) gäller före standardvärdet. */
    /* V3 omgång 2: inget hopfällt från start på mobil — viktiga funktioner
       ska inte gömmas; standardlayouten är i stället kortare. */
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

    if (this._editMode) {
      /* En draft hör till EN användare. Har inloggningen bytts (eller
         identiteten blivit oupplösbar) kastas den — den får aldrig visas
         eller sparas under någon annan. */
      if (!layoutUserId || layoutUserId !== this._editUserId) {
        this._clearEditState();
      } else if (this._dnd) {
        /* Pågående dragning: en bakgrundsuppdatering (DataSync) skulle
           ersätta kortet som dras och avbryta dragningen — vänta. */
        this._dndPendingRender = true;
        return;
      } else {
        this._renderEditMode(el);
        return;
      }
    }

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

    // Tavlan visar AO-nyckeltal för den som får se arbetsordrar (se _todayBoard)
    this._boardTiles = Auth.can('ao_view_all') || Auth.can('ao_view_own');

    // Bygg widgets i rätt ordning, filtrerat på behörighet
    this._loadCollapsed();
    const parts  = [];
    /* V3: "Dagens drift" och "Ordrar idag" visar samma sak som dagens
       tavla överst — i standardlayouten döljs de. En användare som själv
       sparat en layout med dem får behålla dem. */
    const SHOWN_IN_BOARD = new Set(['operations', 'today']);
    const sorted = layout
      .filter(m => m.visible !== false)
      .filter(m => isCustomLayout || !SHOWN_IN_BOARD.has(m.id))
      .filter(m => this._canSee(m.id))
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    let lastCat = null;
    for (const m of sorted) {
      const html = this._renderWidget(m.id);
      if (html) {
        const mod = DashboardConfig.getModule(m.id);
        const cat = mod ? (mod.category || null) : null;
        const key = cat ? cat.toLowerCase().replace(/[^a-z0-9]+/g,'-') : 'other';
        /* 2026-11-26: "Kräver åtgärd" får ingen egen sektionsrubrik — den
           upprepade bara widgetens rubrik ("KRÄVER ÅTGÄRD" + "Kräver
           åtgärd") och det som brådskar ska aldrig kunna fällas ihop. */
        const urgentCat = cat === DashboardConfig.CATEGORY_ORDER[0];
        if (urgentCat) delete this._collapsed[key];
        if (!isCustomLayout && cat && cat !== lastCat && !urgentCat) {
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
        parts.push(`<div class="${cls}" data-sec="${key}" data-w="${m.id}"${collapsed ? ' style="display:none;"' : ''}>${html}</div>`);
      }
    }

    el.innerHTML =
      this._todayBoard(user) +
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
    this._compactMobile(el);
  },

  /* V3 slutpolering — mobil (<768 px): långa listor visar tre rader och
     "Visa fler (N)"; kartan ligger bakom "Visa karta". Inget tas bort och
     ingen layoutinställning ändras — bara visningen på smal skärm.
     "Kräver åtgärd" flyttas upp efter nyckeltalen med CSS-ordning. */
  _compactMobile(root) {
    if (!root || typeof window === 'undefined' || window.innerWidth >= 768) return;
    /* Sekundär information (Verksamhet) visar färre rader; kategorifördelningen
       bara som sammanfattning tills man väljer "Visa fördelning". */
    const LIMITS = { sales: 2, offers: 2, ao_categories: 0 };
    const clamp = (box, rows, limit) => {
      const LIMIT = limit === undefined ? 3 : limit;
      if (rows.length <= LIMIT || box.dataset.dmDone) return;
      box.dataset.dmDone = '1';
      rows.slice(LIMIT).forEach(r => r.classList.add('dm-hidden'));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn bghost bsm bfull dm-more';
      b.textContent = (LIMIT === 0 ? 'Visa fördelning (' : 'Visa fler (') + (rows.length - LIMIT) + ')';
      b.onclick = (e) => { e.stopPropagation(); rows.forEach(r => r.classList.remove('dm-hidden')); b.remove(); };
      rows[rows.length - 1].after(b);
      if (LIMIT === 0) b.classList.add('dm-more-sum');
    };
    root.querySelectorAll('.dt-jobs').forEach(l => clamp(l, [...l.children].filter(c => c.classList.contains('dt-job'))));
    root.querySelectorAll('.dash-ops-map-list').forEach(l => clamp(l, [...l.children].filter(c => c.classList.contains('dash-job-row'))));
    root.querySelectorAll('.dash-layout [data-sec] .card-body').forEach(cb => {
      if (cb.closest('[data-sec^="kr"]')) return;   // Kräver åtgärd visas alltid i sin helhet
      if (cb.classList.contains('dash-ops-map-body')) return;   // kartans lista hanteras ovan
      const w = (cb.closest('[data-w]') || {}).dataset || {};
      let rows = [...cb.children].filter(c => !c.matches('.btn, button, .empty, .dm-more, .kpi-row, .dw-lead') && !c.classList.contains('dash-ops-map-wrap'));
      if (w.w === 'ao_categories') rows = rows.filter(r => r.hasAttribute('onclick'));   // sammanfattningsraden visas alltid
      if (!rows.length) return;
      if (w.w === 'ao_categories') { clamp(rows[0].parentElement, rows, 0); return; }
      clamp(cb, rows, LIMITS[w.w]);
    });
    root.querySelectorAll('.dash-ops-map-canvas-wrap').forEach(w => {
      if (w.dataset.dmDone) return;
      w.dataset.dmDone = '1';
      w.classList.add('dm-map-hidden');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn bs bsm bfull dm-map-btn';
      b.innerHTML = ic('map-pin', 14) + ' Visa karta';
      b.onclick = (e) => { e.stopPropagation(); w.classList.remove('dm-map-hidden'); b.remove(); try { window.dispatchEvent(new Event('resize')); } catch (x) {} };
      w.before(b);
    });
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
      const diagSnapshot = this._opsMapDiag;
      this._mapInitTimer = setTimeout(() => this._initOpsMap(myGen, jobsSnapshot, diagSnapshot), 30);
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
  /* ── V3: Dagens tavla — överst på dashboarden ─────────────────────
     Svarar på "vad behöver göras idag?" innan någon statistik visas.
     Nyckeltalen använder EXAKT samma definitioner som AO-listans
     snabbfilter (WorkOrderService.isOverdue m.fl.) och leder dit, så att
     siffran och listan man landar i alltid stämmer överens. Behörighet:
     samma kanoniska _scopeWorkOrdersForCurrentUser() som övriga AO-ytor. */
  _todayBoard(user) {
    const today = tdy();
    const scoped = this._scopeWorkOrdersForCurrentUser(
      (state.workOrders||[]).filter(a => !a.archived && !a.deleted), { includeSharedPool: true });
    const live = scoped.filter(a => WorkOrderService.isAlive(a));
    const canAO = Auth.can('ao_view_all') || Auth.can('ao_view_own');
    const isLead = Auth.can('ao_view_all');
    const todays = live.filter(a => a.scheduledDate === today)
      .sort((a, b) => String(a.scheduledStart||'99') < String(b.scheduledStart||'99') ? -1 : 1);
    let _r = null;
    const k = {
      today: todays.length,
      ongoing: live.filter(a => a.status === 'pågående').length,
      overdue: live.filter(a => WorkOrderService.isOverdue(a, today)).length,
      urgent: live.filter(a => a.priority === 'akut').length,
      unassigned: live.filter(a => !(a.staff||[]).length && a.status !== 'pool').length,
      bill: Auth.canAny(['invoice_view','invoice_create']) ? scoped.filter(a => a.status === 'klar' && !a.invoiceId && WorkOrderService._hasBillableContent(a, (_r = _r || WorkOrderService.billingStatusResolver()))).length : null,
    };
    const tile = (n, label, sub, go, tone, icon) => `
      <button type="button" class="dt-tile${tone && n ? ' tone-' + tone : ''}" onclick="${go}">
        <span class="dt-tile-ico">${ic(icon, 16)}</span>
        <span class="dt-tile-n">${n}</span>
        <span class="dt-tile-l">${label}</span>
        ${sub ? `<span class="dt-tile-s">${sub}</span>` : ''}
      </button>`;
    const userName = user ? (user.firstName || user.username || '') : '';
    const dateStr = new Date().toLocaleDateString('sv-SE', { weekday:'long', day:'numeric', month:'long' });
    const hour = new Date().getHours();
    const greet = hour < 10 ? 'God morgon' : hour < 17 ? 'Hej' : 'God kväll';

    const actions = [
      Auth.can('ao_create') ? `<button class="btn bp bsm" onclick="Router.showPage('pg-ao');setTimeout(()=>WorkOrdersPage.openCreate(),0)">${ic('plus',15)} Ny order</button>` : '',
      Auth.can('offer_manage') ? `<button class="btn bs bsm" onclick="Router.showPage('pg-offer')">${ic('file-text',15)} Ny offert</button>` : '',
      Auth.can('ao_time') ? `<button class="btn bs bsm" onclick="Router.showPage('pg-tid')">${ic('clock',15)} ${state.stampActive ? 'Instämplad' : 'Stämpla'}</button>` : '',
      `<button type="button" class="btn bghost bsm dash-customize-btn" onclick="Dashboard.enterEditMode()" title="Flytta, ändra storlek på eller dölj widgets">${ic('sliders',15)} Anpassa</button>`,
      `<button class="ibtn" onclick="Dashboard.openUserPrefs()" title="Mina inställningar" aria-label="Mina inställningar">${ic('user',16)}</button>`,
    ].join('');

    const schedule = todays.length ? todays.slice(0, 8).map(ao => {
      const cu = getCu(ao.customerId);
      const where = ao.address || (cu ? CustomerService.displayName(cu) : '');
      return `<button type="button" class="dt-job" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
        <span class="dt-job-t">${ao.scheduledStart ? esc(ao.scheduledStart) : '—'}</span>
        <span class="dt-job-m"><span class="dt-job-title">${ao.priority === 'akut' ? `<span class="bdg bdg-red">${ic('alert-triangle',11)}Akut</span>` : ''}${esc(ao.title)}</span><span class="dt-job-sub">${esc(where)}</span></span>
        <span class="dt-job-r">${UiKit.avatarStack(ao.staff, 3)}${sbdg(ao.status)}</span>
      </button>`;
    }).join('') + (todays.length > 8 ? `<button type="button" class="dt-more" onclick="Router.showPage('pg-ao',{filter:'idag'})">Visa alla ${todays.length} →</button>` : '')
      : `<div class="dt-empty">${ic('calendar',20)}<span>Inga jobb planerade idag.</span></div>`;

    let load = '';
    if (isLead && Auth.canAny(['staff_view','reports_view','ao_view_all'])) {
      const staff = (state.staff||[]).filter(s => s.active !== false);
      const rows = staff.map(s => {
        const mine = live.filter(a => (a.staff||[]).includes(s.id));
        const t = mine.filter(a => a.scheduledDate === today).length;
        const late = mine.filter(a => WorkOrderService.isOverdue(a, today)).length;
        return { s, t, open: mine.length, late };
      }).filter(r => r.open > 0 || r.t > 0).sort((a, b) => b.t - a.t || b.open - a.open).slice(0, 8);
      const max = Math.max(1, ...rows.map(r => r.t));
      load = `<section class="dt-panel dt-load">
        <div class="dt-panel-h"><h3>${ic('users',15)} Personal idag</h3><button class="btn bghost bxs" onclick="Router.showPage('pg-operations')">Dagens drift ${ic('arrow-right',12)}</button></div>
        ${rows.length ? `<ul class="dt-people">${rows.map(r => `<li>
            ${UiKit.avatar(r.s, 28)}
            <span class="dt-p-name">${esc(UiKit.staffName(r.s))}</span>
            <span class="dt-p-bar" aria-hidden="true"><i style="width:${Math.round(r.t / max * 100)}%"></i></span>
            <span class="dt-p-n">${r.t} idag</span>
            <span class="dt-p-o">${r.open} öppna${r.late ? ` · <b>${r.late} försenad${r.late > 1 ? 'e' : ''}</b>` : ''}</span>
          </li>`).join('')}</ul>` : `<div class="dt-empty">${ic('users',20)}<span>Ingen personal har öppna jobb.</span></div>`}
      </section>`;
    }

    return `<section class="dt">
      <div class="dt-head">
        <div>
          <h2 class="dt-greet">${greet}${userName ? ', ' + esc(userName) : ''}</h2>
          <div class="dt-date">${esc(dateStr.charAt(0).toUpperCase() + dateStr.slice(1))}</div>
        </div>
        <div class="dt-actions">${actions}</div>
      </div>
      ${canAO ? `<div class="dt-tiles">
        ${tile(k.today, isLead ? 'Jobb idag' : 'Mina jobb idag', '', `Router.showPage('pg-ao',{filter:'idag'})`, '', 'calendar')}
        ${tile(k.ongoing, 'Pågående', '', `Router.showPage('pg-ao',{filter:'pågående'})`, '', 'play-circle')}
        ${tile(k.overdue, 'Försenade', k.overdue ? 'Behöver planeras om' : 'Inget försenat', `Router.showPage('pg-ao',{filter:'forsenad'})`, 'danger', 'clock')}
        ${tile(k.urgent, 'Akuta', '', `Router.showPage('pg-ao',{filter:'akut'})`, 'danger', 'alert-triangle')}
        ${isLead ? tile(k.unassigned, 'Otilldelade', '', `Router.showPage('pg-ao',{filter:'unassigned'})`, 'warn', 'user-x') : ''}
        ${k.bill !== null ? tile(k.bill, 'Att fakturera', '', `Router.showPage('pg-ao',{filter:'readyForInvoice'})`, 'info', 'receipt') : ''}
      </div>
      <div class="dt-body${load ? '' : ' is-single'}">
        <section class="dt-panel dt-sched">
          <div class="dt-panel-h"><h3>${ic('calendar',15)} ${isLead ? 'Dagens schema' : 'Mina jobb idag'}</h3><button class="btn bghost bxs" onclick="Router.showPage('pg-calendar')">Kalender ${ic('arrow-right',12)}</button></div>
          <div class="dt-jobs">${schedule}</div>
        </section>
        ${load}
      </div>` : ''}
    </section>`;
  },

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

  /* ── 2026-11-26: gemensamt kortchrome för widgetar ───────────────────
     Samma rubrikrad överallt: ikon + rubrik till vänster; antal (märke)
     och EN länk "Visa alla →" till höger. `o.go` är betrodd, statisk
     kod (sidbyte med fasta parametrar) — aldrig data. */
  _head(icon, title, o) {
    o = o || {};
    const has = (v) => v !== undefined && v !== null && v !== '';
    const count = has(o.count) ? `<span class="bdg${o.tone ? ' bdg-' + o.tone : ''} dw-count"${o.countLabel ? ` title="${esc(o.countLabel)}"` : ''}>${esc(String(o.count))}${o.countSuffix ? ' ' + esc(o.countSuffix) : ''}</span>` : '';
    const act = o.go ? `<button type="button" class="btn bghost bxs dw-go" onclick="${o.go}">${esc(o.goLabel || 'Visa alla')} ${ic('arrow-right', 12)}</button>` : '';
    const side = (count || act || o.extra) ? `<div class="dw-head-r">${o.extra || ''}${count}${act}</div>` : '';
    return `<div class="card-header"><h3 class="ch3">${ic(icon, 14)} ${esc(title)}</h3>${side}</div>`;
  },

  /* Hur länge sedan (hela dagar) ett ISO-datum var — för "väntar sedan". */
  _daysSince(iso) {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (!isFinite(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
  },

  /* ── Widget-dispatcher ─────────────────────────────────────────────── */
  _renderWidget(id) {
    try {
      switch (id) {
        case 'overdue_alert': {
          const list = this._myOverdueActivities();
          return list.length > 0 ? this._widgetOverdueAlert(list) : null;
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
        case 'my_tasks':     return this._widgetMyTasks() || null;
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
  /* ── 2026-11-26 — "Anpassa dashboard" som ett tydligt, separat läge ────
     Samma DRAFT/SAVE-kontrakt som V51B (se ovan), men nytt gränssnitt:
       • sticky verktygsrad: Spara (primär), Avbryt, Återställ standard
         (med bekräftelse) och en tydlig "Osparade ändringar"-status;
       • varje widget får en kompakt redigeringsrad: "Flytta"-handtag (dra
         med musen — HTML5 drag-and-drop med släppmarkering — eller
         piltangenter), storleksknappar Liten/Halv/Hel (bara de som är
         relevanta för widgeten) och "Dölj";
       • mobil/pekskärm: "Flytta upp"/"Flytta ned"-knappar (ingen precision);
       • "Dolda widgets" listar dolda widgets med beskrivning och "Visa";
       • återkoppling via toast + en beständig aria-live-yta.
     Inget persisteras förrän Spara. Avbryt kastar draften (läser om exakt
     samma sparade layout som innan). Spara utan ändringar skriver ingenting
     (rollstandarden förblir orörd). Byts inloggad användare medan läget är
     öppet kastas draften — en draft kan aldrig sparas under fel användare. */
  _editMode: false,
  _editDraft: null,
  _editSourceLayout: null,
  _editInitial: null,        // signatur av draften när redigeringen startade
  _editInitialSpans: null,   // { id: span } vid start — äldre sparad bredd finns kvar i väljaren
  _editUserId: null,         // vems layout som redigeras
  _editResetToDefault: false,
  _editMsg: '',
  _dnd: null,
  _dndPendingRender: false,

  /* Sex punkter — ett vedertaget "dra här"-handtag (finns inte i Icons). Statisk, betrodd markup. */
  _GRIP: '<svg class="dash-grip" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="5.5" r="1.7"/><circle cx="15" cy="5.5" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18.5" r="1.7"/><circle cx="15" cy="18.5" r="1.7"/></svg>',

  _sig(draft) { return JSON.stringify((draft || []).map(e => [e.id, !!e.visible, e.span])); },
  _editDirty() { return !!this._editDraft && this._sig(this._editDraft) !== this._editInitial; },
  _modTitle(id) { const m = DashboardConfig.getModule(id); return m ? m.title : id; },

  _clearEditState() {
    this._editMode = false;
    this._editDraft = null;
    this._editSourceLayout = null;
    this._editInitial = null;
    this._editInitialSpans = null;
    this._editUserId = null;
    this._editResetToDefault = false;
    this._editMsg = '';
    this._dnd = null;
    this._dndPendingRender = false;
    if (typeof document !== 'undefined') document.body.classList.remove('dash-dragging');
  },

  /* Återkoppling: synlig statusrad i verktygsraden + en BESTÄNDIG
     aria-live-yta utanför #dash-content (som byggs om vid varje
     rendering — en nyskapad live-yta läses annars inte upp). */
  _announce(msg, toast) {
    this._editMsg = msg || '';
    let live = document.getElementById('dash-live');
    if (!live) {
      live = document.createElement('div');
      live.id = 'dash-live';
      live.className = 'sr-only';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      document.body.appendChild(live);
    }
    live.textContent = '';
    setTimeout(() => { live.textContent = msg || ''; }, 20);
    const st = document.getElementById('dash-edit-status-msg');
    if (st) st.textContent = msg || '';
    if (toast && typeof showToast === 'function') showToast(msg);
  },

  _focus(sel) {
    const el = document.querySelector(sel);
    if (el && !el.disabled) { try { el.focus(); } catch (e) {} return true; }
    return false;
  },

  enterEditMode() {
    const user = Auth.getUser();
    const layoutUserId = this._layoutUserId(user);
    if (!user || !layoutUserId) { showToast('Kan inte anpassa dashboarden — okänd användare'); return; }
    const roleId = user.role || 'personal';
    const layout = DashboardConfig.getUserLayout(layoutUserId, roleId);
    /* V51B R2 §4 — PRIVAT minnessnapshot av HELA den normaliserade
       käll-layouten (innan behörighetsfiltrering), så att en tillfälligt
       obehörig widgets sparade plats bevaras vid Spara (se saveEditMode). */
    this._editSourceLayout = layout;
    this._editDraft = this._buildDraftFrom(layout, user);
    this._editInitial = this._sig(this._editDraft);
    this._editInitialSpans = {};
    this._editDraft.forEach(e => { this._editInitialSpans[e.id] = e.span; });
    this._editUserId = layoutUserId;
    this._editResetToDefault = false;
    this._editMsg = '';
    this._editMode = true;
    this.render();
    const sc = document.getElementById('content-scroll');
    if (sc) sc.scrollTop = 0;
    this._focus('#dash-edit-title');
    this._announce('Flytta, ändra storlek eller dölj widgets. Inget sparas förrän du klickar Spara.');
  },

  exitEditModeCancel() {
    const dirty = this._editDirty() || this._editResetToDefault;
    this._clearEditState();
    this.render();
    this._announce(dirty ? 'Ändringarna kastades — dashboarden är som innan.' : 'Anpassningen avbröts — inget ändrades.', true);
  },

  saveEditMode() {
    const user = Auth.getUser();
    const layoutUserId = this._layoutUserId(user);
    if (!layoutUserId || !this._editDraft) {
      showToast('Kunde inte spara — okänd användaridentitet');
      return;
    }
    if (this._editUserId && this._editUserId !== layoutUserId) {
      this._clearEditState();
      this.render();
      showToast('Inloggad användare har bytts — ändringarna sparades inte');
      return;
    }
    if (this._editResetToDefault) {
      /* Äkta återställning (V51B R1 BLOCKER B-FIX): ta bort BÅDA
         lagringsnycklarna via den kanoniska vägen, så hasCustomLayout()
         blir false och Dashboard återgår till den orörda, kategori-
         grupperade rollstandarden — inte bara samma innehåll under en
         "personlig layout finns"-flagga. */
      DashboardConfig.resetUserLayout(layoutUserId);
      this._clearEditState();
      this.render();
      this._announce('Standardlayouten är sparad.', true);
      return;
    }
    if (!this._editDirty()) {
      /* Inget ändrat → skriv ingenting. Annars skulle en orörd
         rollstandard tyst bli en "personlig layout" bara för att någon
         öppnade läget och tryckte Spara. */
      this._clearEditState();
      this.render();
      this._announce('Inga ändringar att spara — dashboarden är oförändrad.', true);
      return;
    }
    /* V51B R2 §5 / R3 — sammanslagning som bevarar en tillfälligt obehörig
       widgets sparade konfiguration OCH plats:
         KÄLLA:  [A, U, B, C]   (U tillfälligt obehörig)
         DRAFT (efter omordning av A/B/C): [C, A, B]
         RESULTAT: [C, U, A, B]
       Okända modul-id:n har redan filtrerats bort av
       normalizePersonalLayout() när _editSourceLayout byggdes. */
    const source = this._editSourceLayout || [];
    const draftIds = new Set(this._editDraft.map(e => e.id));
    const draftQueue = this._editDraft.map(e => ({ id: e.id, visible: e.visible, span: e.span }));
    let draftPtr = 0;
    const merged = source.map(srcEntry => {
      if (draftIds.has(srcEntry.id)) return draftQueue[draftPtr++];
      return { id: srcEntry.id, visible: srcEntry.visible, span: srcEntry.span };
    });
    while (draftPtr < draftQueue.length) merged.push(draftQueue[draftPtr++]);

    const layout = merged.map((e, i) => ({ id: e.id, visible: e.visible, span: e.span, order: i }));
    DashboardConfig.saveUserLayout(layoutUserId, layout);
    this._clearEditState();
    this.render();
    this._announce('Dashboard sparad. Layouten gäller för dig på den här enheten.', true);
  },

  /* "Återställ standard" frågar först. Själva återställningen laddar bara
     rollens standard i draften — persisteras INTE förrän Spara. */
  confirmResetEditDraft() {
    if (!this._editMode) return;
    Modal.open({
      title: `${ic('rotate-ccw', 15)} Återställ standardlayout?`,
      body: `<p class="dash-reset-text">Alla widgets får standardordning, standardstorlek och standardsynlighet för din roll. Det sparas först när du klickar <strong>Spara</strong> — <strong>Avbryt</strong> i verktygsraden ångrar det.</p>`,
      buttons: [
        { label: 'Behåll nuvarande', cls: 'btn bs', onClick: () => Modal.close() },
        { label: `${ic('rotate-ccw', 13)} Återställ standard`, cls: 'btn bp', onClick: () => { Modal.close(); Dashboard.resetEditDraft(); } },
      ]
    });
  },

  /* Nollställer BARA draften (§13) — inte persisterat förrän Spara.
     Markerar draften som en ÄKTA återställning (_editResetToDefault) tills
     en efterföljande ändring nollställer flaggan. */
  resetEditDraft() {
    const user = Auth.getUser();
    if (!user || !this._editMode) return;
    const roleId = user.role || 'personal';
    const def = DashboardConfig.getDefaultLayout(roleId);
    this._editDraft = this._buildDraftFrom(def, user);
    this._editResetToDefault = true;
    this.render();
    this._announce('Standardlayouten är inläst. Klicka Spara för att behålla den, eller Avbryt för att ångra.', true);
  },

  /* Bygger redigeringsdraften: EN rad per modul användaren faktiskt har
     behörighet att se (§11 — obehöriga moduler kan aldrig dyka upp i
     draften eller bland dolda widgets). Ordning följer den inkommande
     layoutens ordning; moduler som saknas i layouten hamnar sist. */
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

  /* ── Draft-mutationer (renderar om draften, ALDRIG persistens) ───────
     Varje genuin ändring nollställer _editResetToDefault (V51B R1 §9). */
  _editSetSpan(id, span) {
    if (!this._editDraft) return;
    const e = this._editDraft.find(x => x.id === id);
    if (!e) return;
    const next = DashboardConfig.clampSpan(parseInt(span, 10), id);
    if (next === e.span) return;
    e.span = next;
    this._editResetToDefault = false;
    this.render();
    this._focus(`.dash-edit-card[data-widget-id="${id}"] .dash-size-btn[data-span="${next}"]`);
    this._announce(`${this._modTitle(id)}: storlek ${DashboardConfig.SIZE_LABELS[next] || next}.`);
  },

  _editHideWidget(id) {
    if (!this._editDraft) return;
    const vis = this._editDraft.filter(x => x.visible);
    const vIdx = vis.findIndex(x => x.id === id);
    const e = this._editDraft.find(x => x.id === id);
    if (!e || !e.visible) return;
    e.visible = false;
    this._editResetToDefault = false;
    this.render();
    // Fokus till nästa (annars föregående) widgets handtag, eller till Dolda widgets.
    const rest = vis.filter(x => x.id !== id);
    const nextFocus = rest[Math.min(vIdx, rest.length - 1)];
    if (!(nextFocus && this._focus(`.dash-edit-card[data-widget-id="${nextFocus.id}"] .dash-edit-handle`))) this._focus('#dash-edit-hidden .dash-edit-show');
    this._announce(`${this._modTitle(id)} är dold. Du hittar den under Dolda widgets.`, true);
  },

  /* §12: återställd widget behåller sin sparade/standard-storlek och
     placeras deterministiskt sist bland widgetarna. */
  _editRestoreWidget(id) {
    if (!this._editDraft) return;
    const idx = this._editDraft.findIndex(x => x.id === id);
    if (idx === -1) return;
    const [e] = this._editDraft.splice(idx, 1);
    e.visible = true;
    this._editDraft.push(e);
    this._editResetToDefault = false;
    this.render();
    const card = document.querySelector(`.dash-edit-card[data-widget-id="${id}"]`);
    if (card) {
      card.classList.add('is-new');
      setTimeout(() => card.classList.remove('is-new'), 1800);
      try { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) {}
    }
    this._focus(`.dash-edit-card[data-widget-id="${id}"] .dash-edit-handle`) || this._focus(`.dash-edit-card[data-widget-id="${id}"] .dash-move-up`);
    this._announce(`${this._modTitle(id)} visas igen, längst ned. Flytta den dit du vill ha den.`, true);
  },

  /* Flytta ett steg bland de SYNLIGA widgetarna (mobilens knappar och
     tangentbordet). Samma draft, samma grid — ingen andra editor. */
  _editMoveWidget(id, dir, from) {
    if (!this._editDraft) return;
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
    const base = `.dash-edit-card[data-widget-id="${id}"] `;
    if (from === 'handle') this._focus(base + '.dash-edit-handle');
    else if (from === 'btn') this._focus(base + (dir < 0 ? '.dash-move-up' : '.dash-move-down')) || this._focus(base + (dir < 0 ? '.dash-move-down' : '.dash-move-up'));
    this._announce(`${this._modTitle(id)} flyttad till plats ${targetVIdx + 1} av ${visibleIds.length}.`);
  },

  /* Flytta till en given plats: före/efter targetId, eller sist (targetId null). */
  _editMoveTo(id, targetId, after) {
    if (!this._editDraft || id === targetId) return;
    const draft = this._editDraft;
    const before = this._sig(draft);
    const from = draft.findIndex(x => x.id === id);
    if (from === -1) return;
    const [moved] = draft.splice(from, 1);
    let to = draft.length;
    if (targetId) {
      const ti = draft.findIndex(x => x.id === targetId);
      if (ti === -1) { draft.splice(from, 0, moved); return; }
      to = ti + (after ? 1 : 0);
    } else {
      // "Sist" = efter sista SYNLIGA widgeten (dolda widgets ordning spelar ingen roll)
      const vis = draft.map((x, i) => (x.visible ? i : -1)).filter(i => i !== -1);
      to = vis.length ? vis[vis.length - 1] + 1 : draft.length;
    }
    draft.splice(to, 0, moved);
    if (this._sig(draft) !== before) this._editResetToDefault = false;
    this.render();
    this._focus(`.dash-edit-card[data-widget-id="${id}"] .dash-edit-handle`);
    const vis = draft.filter(x => x.visible);
    this._announce(`${this._modTitle(id)} flyttad till plats ${vis.findIndex(x => x.id === id) + 1} av ${vis.length}.`);
  },

  /* Tangentbord på "Flytta"-handtaget: pilar flyttar ett steg, Home/End
     till första/sista plats. */
  _handleKey(e, id) {
    const k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowLeft') { e.preventDefault(); this._editMoveWidget(id, -1, 'handle'); }
    else if (k === 'ArrowDown' || k === 'ArrowRight') { e.preventDefault(); this._editMoveWidget(id, 1, 'handle'); }
    else if (k === 'Home' || k === 'End') {
      e.preventDefault();
      const vis = (this._editDraft || []).filter(x => x.visible);
      if (!vis.length) return;
      if (k === 'Home') this._editMoveTo(id, vis[0].id, false);
      else this._editMoveTo(id, null, true);
    }
  },

  /* ── Drag och släpp (dator) — HTML5 DnD från "Flytta"-handtaget ──────
     Hela kortet visas som dragbild; under dragningen markeras var
     widgeten hamnar (linje före/efter målkortet, eller "Släpp här för att
     lägga sist"). Släpp utanför ett mål ändrar ingenting. */
  _dndStart(e, id) {
    if (!this._editMode) return;
    const card = e.target && e.target.closest ? e.target.closest('.dash-edit-card') : null;
    this._dnd = { id, target: null };
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); } catch (x) {}
    try { if (card && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(card, 36, 22); } catch (x) {}
    document.body.classList.add('dash-dragging');
    if (card) setTimeout(() => card.classList.add('is-dragging'), 0);
  },

  _dndClearMarks() {
    document.querySelectorAll('.dash-edit-card.is-drop-before, .dash-edit-card.is-drop-after, .dash-edit-dropend.is-over')
      .forEach(c => c.classList.remove('is-drop-before', 'is-drop-after', 'is-over', 'drop-x'));
  },

  _dndOver(e, toEnd) {
    if (!this._dnd) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (x) {}
    if (toEnd) {
      if (!(this._dnd.target && this._dnd.target.end)) { this._dndClearMarks(); e.currentTarget.classList.add('is-over'); }
      this._dnd.target = { end: true };
      return;
    }
    const card = e.target && e.target.closest ? e.target.closest('.dash-edit-card') : null;
    if (!card || card.getAttribute('data-widget-id') === this._dnd.id) {
      if (this._dnd.target) this._dndClearMarks();
      this._dnd.target = null;
      return;
    }
    const r = card.getBoundingClientRect();
    const g = card.parentElement.getBoundingClientRect();
    const horiz = r.width < g.width * 0.85;
    const after = horiz ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    const tid = card.getAttribute('data-widget-id');
    const t = this._dnd.target;
    if (t && t.id === tid && t.after === after) return;
    this._dndClearMarks();
    card.classList.add(after ? 'is-drop-after' : 'is-drop-before');
    if (horiz) card.classList.add('drop-x');
    this._dnd.target = { id: tid, after };
  },

  _dndLeave(e) {
    if (!this._dnd) return;
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    this._dndClearMarks();
    this._dnd.target = null;
  },

  _dndDrop(e, toEnd) {
    if (!this._dnd) return;
    e.preventDefault();
    const d = this._dnd;
    this._dndEnd(true);
    if (toEnd || (d.target && d.target.end)) this._editMoveTo(d.id, null, true);
    else if (d.target && d.target.id) this._editMoveTo(d.id, d.target.id, d.target.after);
  },

  _dndEnd(dropped) {
    this._dndClearMarks();
    document.querySelectorAll('.dash-edit-card.is-dragging').forEach(c => c.classList.remove('is-dragging'));
    document.body.classList.remove('dash-dragging');
    const pending = this._dndPendingRender;
    this._dnd = null;
    this._dndPendingRender = false;
    if (pending && !dropped && this._editMode) this.render();
  },

  _jumpToHidden() {
    const sec = document.getElementById('dash-edit-hidden');
    if (!sec) return;
    try { sec.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (x) {}
    this._focus('#dash-edit-hidden .dash-edit-show') || this._focus('#dash-edit-hidden-h');
  },

  /* ── Redigeringsläge — render ──────────────────────────────────────── */
  _renderEditMode(el) {
    const draft = this._editDraft || [];
    const visible = draft.filter(e => e.visible);
    const hidden  = draft.filter(e => !e.visible);
    const n = visible.length;
    const dirty = this._editDirty() || this._editResetToDefault;

    const cardHtml = (e, idx) => {
      const mod = DashboardConfig.getModule(e.id);
      if (!mod) return '';
      const t = esc(mod.title);
      const content = this._renderWidget(e.id);
      const widgetHtml = content ||
        `<div class="card dash-edit-ph">${this._head(mod.icon || 'layers', mod.title)}<div class="card-body"><p class="dash-edit-ph-text">${ic('info', 14)} <span>${esc(mod.emptyHint || 'Inget att visa just nu.')}</span></p></div></div>`;
      const sizes = DashboardConfig.getSizeOptions(e.id, [e.span, (this._editInitialSpans || {})[e.id]]);
      const sizeHtml = sizes.length > 1 ? `<div class="dash-edit-size" role="group" aria-label="Storlek för ${t}">
          <span class="dash-edit-size-l" aria-hidden="true">Storlek</span>
          ${sizes.map(s => `<button type="button" class="dash-size-btn${s === e.span ? ' is-on' : ''}" aria-pressed="${s === e.span}" data-span="${s}" title="${esc(DashboardConfig.SIZE_HINTS[s] || '')}" onclick="Dashboard._editSetSpan('${e.id}',${s})">${esc(DashboardConfig.SIZE_LABELS[s] || String(s))}</button>`).join('')}
        </div>` : '';
      return `<div class="dgw-${e.span} dash-edit-card" data-widget-id="${e.id}" data-pos="${idx + 1}">
        <div class="dash-edit-chrome">
          <button type="button" class="dash-edit-handle" draggable="true" aria-label="Flytta ${t}, plats ${idx + 1} av ${n}. Dra med musen eller använd piltangenterna." title="Dra för att flytta — eller använd piltangenterna" ondragstart="Dashboard._dndStart(event,'${e.id}')" ondragend="Dashboard._dndEnd()" onkeydown="Dashboard._handleKey(event,'${e.id}')">${this._GRIP}<span>Flytta</span></button>
          <div class="dash-edit-name"><span class="dash-edit-title">${t}</span><span class="dash-edit-pos">Plats ${idx + 1} av ${n}</span></div>
          ${sizeHtml}
          <button type="button" class="btn bghost bsm dash-edit-hide" aria-label="Dölj ${t}" onclick="Dashboard._editHideWidget('${e.id}')">${ic('eye-off', 14)} Dölj</button>
        </div>
        <div class="dash-edit-move">
          <button type="button" class="btn bs bsm dash-move-up" ${idx === 0 ? 'disabled' : ''} aria-label="Flytta ${t} upp" onclick="Dashboard._editMoveWidget('${e.id}',-1,'btn')">${ic('arrow-up', 14)} Flytta upp</button>
          <button type="button" class="btn bs bsm dash-move-down" ${idx === n - 1 ? 'disabled' : ''} aria-label="Flytta ${t} ned" onclick="Dashboard._editMoveWidget('${e.id}',1,'btn')">${ic('arrow-down', 14)} Flytta ned</button>
        </div>
        <div class="dash-edit-preview" inert aria-hidden="true">${widgetHtml}</div>
      </div>`;
    };

    const gridHtml = n ? visible.map((e, i) => cardHtml(e, i)).join('')
      : `<div class="dgw-12 dash-edit-allhidden">${ic('eye-off', 18)} <span>Alla widgets är dolda. Välj <b>Visa</b> under Dolda widgets för att lägga tillbaka någon.</span></div>`;

    const hiddenHtml = `<section class="dash-edit-hidden" id="dash-edit-hidden" aria-labelledby="dash-edit-hidden-h">
      <div class="dash-edit-hidden-head">
        <h3 id="dash-edit-hidden-h" tabindex="-1">${ic('eye-off', 15)} Dolda widgets <span class="bdg">${hidden.length}</span></h3>
        <p>Dolda widgets syns inte på din dashboard. Klicka <b>Visa</b> så läggs widgeten tillbaka längst ned.</p>
      </div>
      ${hidden.length ? `<ul class="dash-edit-hidden-list">${hidden.map(e => {
        const mod = DashboardConfig.getModule(e.id);
        if (!mod) return '';
        return `<li class="dash-edit-hidden-item" data-widget-id="${e.id}">
          <span class="dash-edit-hidden-ico">${ic(mod.icon || 'layers', 16)}</span>
          <span class="dash-edit-hidden-txt"><span class="dash-edit-hidden-t">${esc(mod.title)}</span><span class="dash-edit-hidden-d">${esc(mod.description || '')}</span></span>
          <button type="button" class="btn bs bsm dash-edit-show" aria-label="Visa ${esc(mod.title)} igen" onclick="Dashboard._editRestoreWidget('${e.id}')">${ic('plus', 14)} Visa</button>
        </li>`;
      }).join('')}</ul>`
      : `<p class="dash-edit-hidden-empty">Inga dolda widgets just nu. Använd <b>Dölj</b> på en widget för att ta bort den från vyn.</p>`}
    </section>`;

    el.innerHTML = `<div class="dash-edit${dirty ? ' is-dirty' : ''}">
      <div class="dash-edit-bar" role="region" aria-labelledby="dash-edit-title">
        <div class="dash-edit-bar-main">
          <h2 class="dash-edit-bar-title" id="dash-edit-title" tabindex="-1">${ic('sliders', 16)} Anpassa dashboard</h2>
          <p class="dash-edit-status${dirty ? ' is-dirty' : ''}"><span class="dash-edit-dot" aria-hidden="true"></span><span class="dash-edit-state">${dirty ? 'Osparade ändringar' : 'Inga ändringar ännu'}</span><span class="dash-edit-status-msg" id="dash-edit-status-msg">${esc(this._editMsg || '')}</span></p>
        </div>
        <div class="dash-edit-bar-actions">
          <button type="button" class="btn bghost bsm dash-edit-reset" onclick="Dashboard.confirmResetEditDraft()">${ic('rotate-ccw', 14)} <span class="dash-lbl-l">Återställ standard</span><span class="dash-lbl-s" aria-hidden="true">Återställ</span></button>
          <button type="button" class="btn bs bsm dash-edit-cancel" onclick="Dashboard.exitEditModeCancel()">${ic('x', 14)} Avbryt</button>
          <button type="button" class="btn bp bsm dash-edit-save" onclick="Dashboard.saveEditMode()">${ic('check', 14)} Spara</button>
        </div>
      </div>
      <div class="dash-edit-help" id="dash-edit-help">
        <span class="dash-edit-tip tip-dnd">${this._GRIP}<span><b>Dra i Flytta</b> för att byta plats — eller markera Flytta och använd piltangenterna.</span></span>
        <span class="dash-edit-tip tip-touch">${ic('arrow-up', 14)}<span><b>Flytta upp / Flytta ned</b> byter plats med widgeten intill.</span></span>
        <span class="dash-edit-tip tip-size">${ic('grid', 14)}<span><b>Storlek</b>: Liten, Halv eller Hel bredd.</span></span>
        <span class="dash-edit-tip">${ic('eye-off', 14)}<span><b>Dölj</b> flyttar widgeten till Dolda widgets.</span></span>
        <button type="button" class="btn bghost bsm dash-edit-jump" onclick="Dashboard._jumpToHidden()">${ic('eye-off', 14)} Dolda widgets (${hidden.length})</button>
      </div>
      <p class="dash-edit-note">${ic('info', 13)} <span>Layouten sparas bara för dig, på den här enheten. Dagens tavla överst (nyckeltal och schema) är fast och påverkas inte.</span></p>
      <div class="dash-layout dash-edit-grid" ondragover="Dashboard._dndOver(event)" ondrop="Dashboard._dndDrop(event)" ondragleave="Dashboard._dndLeave(event)">${gridHtml}</div>
      <div class="dash-edit-dropend" ondragover="Dashboard._dndOver(event,true)" ondrop="Dashboard._dndDrop(event,true)">${ic('arrow-down', 14)} Släpp här för att lägga widgeten sist</div>
      ${hiddenHtml}
    </div>`;

    // Långa förhandsvisningar kapas med en tonad kant (bara när de faktiskt kapas).
    el.querySelectorAll('.dash-edit-preview').forEach(p => { if (p.scrollHeight > p.clientHeight + 4) p.classList.add('is-clipped'); });

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

  /* ── Widget: Försenade aktiviteter ──────────────────────────────────
     2026-11-26: från en stor röd banderoll till ett kort i samma stil som
     övriga — antal, de äldsta försenade uppföljningarna med hur många
     dagar de är sena, och EN väg vidare ("Visa försenade"). Urvalet är
     samma som Aktiviteter-widgeten: alla för den som ser all personal,
     annars egna/otilldelade (se _myOverdueActivities). */
  _myOverdueActivities() {
    let overdue = [];
    try { overdue = ActivitiesService.getOverdue() || []; } catch (e) { return []; }
    const user = Auth.getUser();
    const userId = user ? user.id : null;
    const canSeeAll = Auth.can('all') || Auth.can('staff_view');
    const mine = canSeeAll ? overdue : overdue.filter(a => !a.assignedTo || a.assignedTo === userId || a.createdBy === userId);
    return mine.slice().sort((a, b) => String(a.dueDate || '') < String(b.dueDate || '') ? -1 : 1);
  },

  _widgetOverdueAlert(list) {
    const items = Array.isArray(list) ? list : this._myOverdueActivities();
    const count = items.length;
    if (!count) return null;
    const go = "Router.showPage('pg-activities',{filter:'försenade'})";
    const rows = items.slice(0, 3).map(a => {
      const days = this._daysSince(a.dueDate);
      const cu = ActivitiesService.resolveCustomer ? ActivitiesService.resolveCustomer(a) : null;
      const who = cu ? CustomerService.displayName(cu) : '';
      return `<button type="button" class="dwr dwr--danger" onclick="${go}">
        <span class="dwr-ico">${ic(ActivitiesService.typeIcon(a.type), 14)}</span>
        <span class="dwr-main"><span class="dwr-t">${esc(a.title || a.note || ActivitiesService.typeLabel(a.type))}</span><span class="dwr-s">${days !== null ? `<b>${days} dag${days === 1 ? '' : 'ar'} sen</b> · ` : ''}${esc(fmtDate(a.dueDate))}${who ? ' · ' + esc(who) : ''}</span></span>
        <span class="dwr-go">${ic('chevron-right', 14)}</span>
      </button>`;
    }).join('');
    return `<div class="card dw-card dw-tone-danger">
      ${this._head('alert-triangle', 'Försenade aktiviteter', { count, tone: 'red', countLabel: count + ' försenade', go, goLabel: 'Visa försenade' })}
      <div class="card-body dw-list">
        <p class="dw-lead">${count} uppföljning${count === 1 ? '' : 'ar'} har passerat sitt datum${count > 3 ? ' — de äldsta visas här' : ''}.</p>
        ${rows}
      </div>
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

  /* ── Widget: Kräver åtgärd (behörighetsfiltrad) ───────────────────
     2026-11-26: raderna är riktiga knappar (tangentbord/skärmläsare),
     mest brådskande först, och kortet har samma rubrikrad som övriga. */
  _widgetTodos(todos) {
    const rank = (t) => t.cls === 'urgent' ? 0 : (t.badgeCls === 'orange' ? 1 : 2);
    const sorted = todos.slice().sort((a, b) => rank(a) - rank(b));
    const hasUrgent = todos.some(t => t.cls === 'urgent');
    const total = todos.reduce((n, t) => n + (Number(t.badge) || 0), 0);
    return `<div class="card dw-card ${hasUrgent ? 'dw-tone-danger' : 'dw-tone-warn'}">
      ${this._head('alert-circle', 'Kräver åtgärd', { count: todos.length, tone: hasUrgent ? 'red' : 'orange', countLabel: todos.length + ' typer av ärenden, ' + total + ' st totalt' })}
      <div class="card-body dw-list">
        ${sorted.map(t => this._actionItem(t)).join('')}
      </div>
    </div>`;
  },

  _actionItem(t) {
    const isUrgent = t.cls === 'urgent';
    const iconColor = isUrgent ? 'var(--rd)' : t.iconCls === 'orange' ? 'var(--or)' : t.iconCls === 'blue' ? 'var(--sky)' : t.iconCls === 'purple' ? 'var(--pu)' : 'var(--mt)';
    const countCls = isUrgent ? 'urgent' : (t.badgeCls === 'orange' ? 'orange' : '');
    return `<button type="button" class="dash-action-item dwr ${t.cls||''}" onclick="${t.onClick}">
      <span class="dwr-ico" style="color:${iconColor};">${ic(t.icon, 15)}</span>
      <span class="dai-text dwr-main">
        <span class="dai-title dwr-t">${esc(t.title)}</span>
        ${t.sub ? `<span class="dai-sub dwr-s">${esc(t.sub)}</span>` : ''}
      </span>
      <span class="dai-count ${countCls}">${esc(String(t.badge))}</span>
      <span class="dwr-go">${ic('chevron-right',14)}</span>
    </button>`;
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
      ${this._head('layout-dashboard', 'Dagens drift', { go: "Router.showPage('pg-operations')", goLabel: 'Öppna' })}
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
              <span style="font-size:13px;font-weight:800;color:var(--navy);">${count}${urgent > 0 ? `&nbsp;<span style="display:inline-flex;align-items:center;gap:2px;color:var(--rd);font-size:10px;font-weight:700;" title="${urgent} akuta">${ic('zap',9)} ${urgent}</span>` : ''}</span>
            </div>
            <div style="height:4px;background:var(--br);border-radius:4px;overflow:hidden;">
              <div style="width:${barW}%;height:100%;background:${c.color};border-radius:4px;"></div>
            </div>
          </div>
        </div>`;
      }).join('');

    if (!rows) {
      return `<div class="card">
        ${this._head('layers', 'Öppna per kategori')}
        <div class="card-body"><div class="empty" style="padding:12px 0;gap:4px;">${ic('check-circle',22)}<p style="font-size:11px;">Inga öppna ordrar</p></div></div>
      </div>`;
    }

    return `<div class="card">
      ${this._head('layers', 'Öppna per kategori', { count: openN, countLabel: openN + ' öppna arbetsordrar', go: "Router.showPage('pg-ao')", goLabel: 'Se alla' })}
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
  _opsMapDiag: null,
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

    /* V51A R1 §6 — FAIL-CLOSED behörighetskontrakt (oförändrat):
         ao_view_all              → alla operativa jobb
         ao_view_own + giltigt id → ENDAST jobb tilldelade exakt det id:t
                                     (ingen delad pool på kartan)
         annars                   → inga jobb alls (fail closed) */
    let jobs = this._scopeWorkOrdersForCurrentUser(allOperational, { includeSharedPool: false });

    // Sortera: akut överst, sedan planerat datum (försenat/idag före kommande)
    jobs = jobs.slice().sort((a, b) => {
      const aUrgent = a.priority === 'akut' ? 0 : 1;
      const bUrgent = b.priority === 'akut' ? 0 : 1;
      if (aUrgent !== bUrgent) return aUrgent - bUrgent;
      return (a.scheduledDate || '9999') < (b.scheduledDate || '9999') ? -1 : 1;
    });
    this._opsMapJobs = jobs;
    /* 2026-11-26: klassa varje jobb SYNKRONT (utan nätverk) — har
       koordinater / saknar adress / saknar postnummer-ort / behöver
       geokodas. Talen visas direkt, även när kartan inte kan laddas. */
    const diag = jobs.map(ao => this._geoStatusOf(ao));
    this._opsMapDiag = diag;

    if (jobs.length === 0) {
      return `<div class="card dw-card">
        ${this._head('map-pin', 'Aktiva jobb — karta')}
        <div class="card-body"><div class="empty" style="padding:12px 0;gap:4px;">${ic('check-circle',22)}<p style="font-size:11px;">Inga aktiva jobb just nu</p></div></div>
      </div>`;
    }

    const LIST_LIMIT = 25;
    const jobRow = ao => {
      const cu = getCu(ao.customerId);
      /* V51A R4 — adress-precedens: AO:ns egen adress vinner, länkad
         fastighets/kunds adress är bara fallback (AddressService.displayAddress). */
      const resolvedDisplay = AddressService.displayAddress(ao);
      const locLabel = resolvedDisplay || (cu ? CustomerService.displayName(cu) : '—');
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
          <div class="dash-job-row-sub">${esc(locLabel)}${ao.scheduledStart ? ' · '+esc(ao.scheduledStart) : ''}</div>
          ${hasChecklist ? `
            <div style="display:flex;align-items:center;gap:6px;">
              <div class="dash-job-progress-track" style="flex:1;"><div class="dash-job-progress-fill" style="width:${Math.round(clDone/cl.length*100)}%;background:${barColor};"></div></div>
              <span class="dash-job-progress-label">${clDone}/${cl.length}</span>
            </div>` : ''}
        </div>
      </div>`;
    };
    const more = jobs.length > LIST_LIMIT
      ? `<button type="button" class="btn bghost bsm bfull dash-ops-more" onclick="Router.showPage('pg-ao',{filter:'active'})">Visa alla ${jobs.length} aktiva jobb ${ic('arrow-right',12)}</button>` : '';

    return `<div class="card dw-card dash-map-card">
      ${this._head('map-pin', 'Aktiva jobb — karta', { count: jobs.length, countLabel: jobs.length + ' aktiva jobb', go: "Router.showPage('pg-ao',{filter:'active'})", goLabel: 'Se alla' })}
      <div class="card-body dash-ops-map-body">
        <div class="dash-ops-map-count" id="dash-ops-map-count">${esc(this._geoCountText(diag, null))}</div>
        <div class="dash-ops-map-wrap">
          <div class="dash-ops-map-list">${jobs.slice(0, LIST_LIMIT).map(jobRow).join('')}${more}</div>
          <div class="dash-ops-map-canvas-wrap" id="dash-ops-map-canvas-wrap">
            <div id="dash-ops-map"></div>
          </div>
        </div>
        <div class="dash-ops-geo-wrap" id="dash-ops-geo-wrap">${this._geoDiagHtml(diag)}</div>
      </div>
    </div>`;
  },

  /* ── 2026-11-26: varför hamnar ett jobb inte på kartan? ────────────────
     Orsakerna redovisas VAR FÖR SIG med antal — inga tal döljs:
       KARTFEL (hela kartan, inte enskilda jobb): kartbiblioteket Mapbox GL
         laddas inte → "Kartan kunde inte laddas"; token saknas → "Kartan är
         inte konfigurerad"; fel vid ritning → "Kartan kunde inte visas";
         kartbakgrunden nekas efter laddning → rad ovanpå kartan.
       GEOKODNING SAKNAS (adress med postnummer/ort finns, inga koordinater):
         pending/skipped — "inte geokodade ännu" (kartan söker högst 20 nya
                            adresser per visning; resten väntar)
         error           — "geokodning misslyckades" (401/403 eller nätverk;
                            vid 401/403 ser admin "Kartnyckeln nekas för den
                            här domänen")
       ADRESSEN BEHÖVER KOMPLETTERAS:
         nocity   — "adress saknar ort/postnummer" (geokodas inte: hellre
                     ingen nål än en nål i fel stad, AddressService.geocodeTrusted)
         noaddr   — "saknar adress" (varken AO, fastighet eller kund)
         notfound — "adressen hittades inte" (kartsökningen gav ingen träff)
     Koordinater finns sparade på AO:n (ao.lat/ao.lng — sätts av
     WorkOrderService.geocodeAddressIfNeeded() när en AO skapas/ändras i
     appen) eller tas fram av kartan själv, ENDAST i minnet för sessionen.
     Importerade AO (ImportWizard) går inte via WorkOrderService.create()
     och saknar därför koordinater. */
  _GEO_LABELS: {
    pending:  'inte geokodade ännu',
    skipped:  'inte geokodade ännu',
    error:    'geokodning misslyckades',
    nocity:   'adress saknar ort/postnummer',
    noaddr:   'saknar adress',
    notfound: 'adressen hittades inte',
  },
  _GEO_GROUPS: [
    { key: 'nogeo', label: 'Geokodning saknas', items: ['notyet', 'error'],
      hint: 'Adressen har postnummer eller ort men inga koordinater är sparade. Koordinater sparas när arbetsordern skapas eller ändras i appen; importerade och äldre arbetsordrar saknar dem. Kartan söker själv högst 20 nya adresser per visning och sparar inte resultatet.' },
    { key: 'badaddr', label: 'Adressen behöver kompletteras', items: ['nocity', 'noaddr', 'notfound'],
      hint: 'Kartan placerar inte en gata utan ort eller postnummer (risk för fel stad). Jobb utan adress — och utan kopplad fastighet eller kund med adress — kan inte visas.' },
  ],
  _GEO_ITEM_LABEL: {
    notyet: 'inte geokodade ännu', error: 'geokodning misslyckades',
    nocity: 'adress saknar ort/postnummer', noaddr: 'saknar adress', notfound: 'adressen hittades inte',
  },
  _GEO_STATUSES: ['pending', 'skipped', 'error', 'nocity', 'noaddr', 'notfound'],
  _GEO_FAIL_MS: 5 * 60000,
  _geoFailed: {},      // query → { at, status } — misslyckade sökningar (visas som misslyckade i 5 min)
  _geoDenied: false,   // senaste felet var 401/403 (token nekas för domänen)
  _mapTileDenied: false,

  _aoCoord(ao) {
    const num = (v) => typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN);
    const lat = num(ao && ao.lat), lng = num(ao && ao.lng);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
    return { lat, lng };
  },

  _geoStatusOf(ao) {
    const c = this._aoCoord(ao);
    if (c) return { ao, status: 'coords', coord: c };
    let r = null;
    try { r = AddressService.resolveWorkOrderQuery(ao); } catch (e) { r = null; }
    if (!r || !r.query) return { ao, status: 'noaddr' };
    if (!r.hasCityContext) return { ao, status: 'nocity', query: r.query };
    const cached = this._geoCache[r.query];
    if (cached) return { ao, status: 'geocoded', coord: cached, query: r.query };
    if (cached === null) return { ao, status: 'notfound', query: r.query };
    const f = this._geoFailed[r.query];
    if (f && Date.now() - f.at < this._GEO_FAIL_MS) return { ao, status: 'error', query: r.query, http: f.status };
    return { ao, status: 'pending', query: r.query };
  },

  _geoCounts(diag) {
    const c = { total: diag.length, coords: 0, geocoded: 0 };
    this._GEO_STATUSES.forEach(k => { c[k] = 0; });
    diag.forEach(d => { c[d.status] = (c[d.status] || 0) + 1; });
    c.placed = c.coords + c.geocoded;
    c.missing = c.total - c.placed;
    c.notyet = c.pending + c.skipped;
    c.nogeo = c.notyet + c.error;
    c.badaddr = c.nocity + c.noaddr + c.notfound;
    return c;
  },

  /* "190 inte geokodade ännu · 1 adress saknar ort/postnummer · 14 saknar adress" */
  _geoCauseText(c) {
    return ['notyet', 'error', 'nocity', 'noaddr', 'notfound'].filter(k => c[k] > 0).map(k => `${c[k]} ${this._GEO_ITEM_LABEL[k]}`).join(' · ');
  },

  _isMapAdmin() { return Auth.can('all') || Auth.can('admin_manage'); },

  /* Räknarraden ovanför kartan. `groups` = platser på kartan (efter
     kartritning), annars null (synkront läge / ingen karta). */
  _geoCountText(diag, groups) {
    const c = this._geoCounts(diag);
    const parts = [`${c.total} aktiv${c.total === 1 ? 't' : 'a'} jobb`];
    if (groups) {
      const nPlaced = groups.reduce((s, g) => s + g.count, 0);
      parts.push(groups.length !== nPlaced ? `${groups.length} platser på kartan` : `${nPlaced} på kartan`);
    } else {
      parts.push(`${c.placed} med koordinater`);
    }
    if (c.missing > 0) parts.push(`${c.missing} saknar koordinater`);
    return parts.join(' · ');
  },

  _geoListOpen: false,

  _geoDiagHtml(diag) {
    const c = this._geoCounts(diag);
    if (!c.missing) return '';
    const open = !!this._geoListOpen;
    const MAX = 40;
    const itemOf = (d) => (d.status === 'pending' || d.status === 'skipped') ? 'notyet' : d.status;
    const causeRows = this._GEO_GROUPS.filter(g => c[g.key] > 0).map(g =>
      `<span class="dash-ops-geo-cause" data-group="${g.key}"><span class="dash-ops-geo-cl">${esc(g.label)}:</span> ${g.items.filter(k => c[k] > 0).map(k => `<span class="dash-ops-geo-chip" data-reason="${k}"><b>${c[k]}</b> ${esc(this._GEO_ITEM_LABEL[k])}</span>`).join(' ')}</span>`).join('');
    const denied = c.error > 0 && this._geoDenied;
    const adminNote = denied && this._isMapAdmin()
      ? `<span class="dash-ops-geo-admin" data-denied="1">${ic('lock', 12)} Kartnyckeln nekas för den här domänen (Mapbox svarar 401/403). Kontrollera tokenens URL-begränsning i Mapbox.</span>` : '';
    const groups = this._GEO_GROUPS.filter(g => c[g.key] > 0).map(g => {
      const rows = diag.filter(d => g.items.includes(itemOf(d)));
      return `<div class="dash-ops-geo-group" data-reason="${g.key}">
        <h4>${esc(g.label)} <span class="bdg">${rows.length}</span></h4>
        <p class="dash-ops-geo-hint">${esc(g.hint)}</p>
        <ul>${rows.slice(0, MAX).map(d => {
          const addr = AddressService.displayAddress(d.ao);
          return `<li><button type="button" class="dash-ops-geo-row" data-ao="${esc(d.ao.id)}" data-status="${d.status}" onclick="Dashboard._openAo(this)"><span class="dash-ops-geo-t">${esc(d.ao.title || d.ao.id)}</span><span class="dash-ops-geo-a">${esc(addr || 'Ingen adress')} · ${esc(this._GEO_LABELS[d.status] || '')}</span></button></li>`;
        }).join('')}</ul>
        ${rows.length > MAX ? `<p class="dash-ops-geo-hint">+${rows.length - MAX} till — se arbetsorderlistan.</p>` : ''}
      </div>`;
    }).join('');
    return `<div class="dash-ops-geo" id="dash-ops-geo" data-missing="${c.missing}" data-total="${c.total}" data-notyet="${c.notyet}" data-error="${c.error}" data-nocity="${c.nocity}" data-noaddr="${c.noaddr}" data-notfound="${c.notfound}">
      <button type="button" class="dash-ops-geo-sum" aria-expanded="${open}" aria-controls="dash-ops-geo-list" onclick="Dashboard._toggleGeoList()">
        <span class="dash-ops-geo-ico">${ic('alert-circle', 15)}</span>
        <span class="dash-ops-geo-txt"><b>${c.missing} av ${c.total} aktiva jobb visas inte på kartan</b>${causeRows}${adminNote}</span>
        <span class="dash-ops-geo-act">${open ? 'Dölj' : 'Visa vilka'} ${ic(open ? 'chevron-up' : 'chevron-down', 13)}</span>
      </button>
      <div class="dash-ops-geo-list" id="dash-ops-geo-list"${open ? '' : ' hidden'}>${groups}</div>
    </div>`;
  },

  _toggleGeoList(force) {
    this._geoListOpen = force === undefined ? !this._geoListOpen : !!force;
    const wrap = document.getElementById('dash-ops-geo-wrap');
    if (wrap && this._opsMapDiag) wrap.innerHTML = this._geoDiagHtml(this._opsMapDiag);
    if (this._geoListOpen) {
      const l = document.getElementById('dash-ops-geo-list');
      if (l) { try { l.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }
    }
  },

  _openAo(btn) {
    const id = btn && btn.getAttribute('data-ao');
    if (id) Router.showPage('pg-ao-detail', { aoId: id });
  },

  /* Tomt/felläge i kartytan — talen döljs aldrig.
     kind: 'nolib' (Mapbox GL laddas inte) | 'notoken' | 'error' (fel vid
     ritning) = kartfel; 'none' = kartan fungerar men inget jobb kan placeras. */
  _mapEmptyHtml(kind, diag) {
    const c = this._geoCounts(diag || []);
    const causes = this._geoCauseText(c);
    let title, text, icon = 'alert-triangle';
    if (kind === 'nolib') {
      title = 'Kartan kunde inte laddas';
      text = `Kartbiblioteket (Mapbox GL) gick inte att nå. Det beror inte på jobbens adresser — listan fungerar som vanligt. ${c.placed} av ${c.total} jobb har koordinater.`;
    } else if (kind === 'notoken') {
      title = 'Kartan är inte konfigurerad';
      text = `Ingen Mapbox-token är inställd (config.js). ${c.placed} av ${c.total} jobb har koordinater.`;
    } else if (kind === 'error') {
      title = 'Kartan kunde inte visas';
      text = `Ett fel uppstod när kartan ritades. ${c.placed} av ${c.total} jobb har koordinater.`;
    } else {
      icon = 'map-pin';
      title = c.total === 1 ? 'Det aktiva jobbet har inga koordinater' : `Inga av de ${c.total} aktiva jobben har koordinater`;
      text = `${causes}.` + (c.nogeo ? ' Adresserna behöver geokodas.' : '');
    }
    return `<div class="dash-ops-map-empty" data-kind="${esc(kind)}" role="status">
      ${ic(icon, 22)}
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      ${c.missing ? `<button type="button" class="btn bs bsm" onclick="Dashboard._toggleGeoList(true)">${ic('list', 13)} Visa jobb utan plats (${c.missing})</button>` : ''}
    </div>`;
  },

  /* Kartbakgrunden/stilen nekas eller laddas inte EFTER att Mapbox GL
     laddats: markörerna finns kvar, en rad ovanpå kartan förklarar. */
  _mapAlert(wrap, generation, status) {
    if (generation !== this._mapGeneration || !wrap || !wrap.isConnected || wrap.querySelector('.dash-ops-map-alert')) return;
    const denied = status === 401 || status === 403;
    if (denied) this._mapTileDenied = true;
    const el = document.createElement('div');
    el.className = 'dash-ops-map-alert';
    el.setAttribute('role', 'status');
    el.innerHTML = `${ic('alert-triangle', 14)}<span>${esc(denied && this._isMapAdmin() ? 'Kartbakgrunden kunde inte laddas — kartnyckeln nekas för den här domänen.' : 'Kartbakgrunden kunde inte laddas. Markörerna och listan visas ändå.')}</span>`;
    wrap.appendChild(el);
  },

  /* Adressökning för kartan: samma beslut som AddressService.geocodeTrusted()
     (ingen nål utan postnummer/ort, första träffen), men skiljer "ingen
     träff" från "sökningen misslyckades" så att orsaken kan visas ärligt.
     AddressService.search() sväljer fel och returnerar [] — därför anropas
     dess _fetchMapbox() direkt när den finns. */
  async _geocodeForMap(query) {
    const AS = AddressService;
    if (typeof AS._fetchMapbox !== 'function' || typeof AS._token !== 'function') {
      const c = await AS.geocodeTrusted(query, true);
      return c ? { status: 'ok', coord: c } : { status: 'notfound' };
    }
    if (!AS._token() || String(query || '').trim().length < 3) return { status: 'notfound' };
    try {
      const results = await AS._fetchMapbox(String(query).trim());
      const best = (results || [])[0];
      if (!best || best.lat == null || best.lng == null) return { status: 'notfound' };
      return { status: 'ok', coord: { lat: best.lat, lng: best.lng } };
    } catch (e) {
      const message = String(e && e.message || e);
      const m = /HTTP (\d{3})/.exec(message);
      return { status: 'error', message, http: m ? Number(m[1]) : 0 };
    }
  },
  _geoErrUntil: 0,

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
  /* R1 §1 — den lokala kopian av fallback-kedjan (tidigare `_resolveAOAddress`
     här) är BORTTAGEN. Den kunde divergera från WorkOrderService's egen,
     enklare kopia (exakt det som orsakade blockerare #1: en legacy-AO
     geokodades med fel/ingen stadskontext varje gång update() kördes, trots
     att kartan visste bättre). Nu finns EN kanonisk resolver,
     AddressService.resolveWorkOrderQuery(ao) — se dess kommentar för hela
     prioritetskedjan. Både kartan (nedan) och
     WorkOrderService.geocodeAddressIfNeeded() anropar SAMMA funktion och kan
     därför aldrig divergera igen. */

  async _initOpsMap(generation, jobs, diagIn) {
    if (generation !== this._mapGeneration) return; // redan föråldrad innan start

    const wrap = document.getElementById('dash-ops-map-canvas-wrap');
    if (!wrap) return; // widgeten är inte synlig i aktuell layout

    if (this._mapInstance) {
      try { this._mapInstance.remove(); } catch(e) {}
      this._mapInstance = null;
    }

    jobs = jobs || [];
    const diag = (diagIn && diagIn.length === jobs.length) ? diagIn : jobs.map(ao => this._geoStatusOf(ao));
    const setCount = (groups) => { const el = document.getElementById('dash-ops-map-count'); if (el) el.textContent = this._geoCountText(diag, groups); };
    const setDiag = () => { const w = document.getElementById('dash-ops-geo-wrap'); if (w) w.innerHTML = this._geoDiagHtml(diag); this._opsMapDiag = diag; };
    const empty = (kind) => { wrap.innerHTML = this._mapEmptyHtml(kind, diag); wrap.classList.add('is-empty'); };

    const token = (window.VIFT_CONFIG && window.VIFT_CONFIG.mapboxToken) || '';
    if (!token) { setCount(null); setDiag(); empty('notoken'); return; }

    try {
      await this._loadMapboxGl();
    } catch(e) {
      if (generation !== this._mapGeneration) return;
      setCount(null); setDiag(); empty('nolib');
      return;
    }
    if (generation !== this._mapGeneration) return;

    const MAX_LOOKUPS = 20; // V51A §19: begränsa antal NYA geokodningsanrop per uppdatering
    let newLookups = 0;

    for (const d of diag) {
      if (generation !== this._mapGeneration) return; // avbruten av en nyare render()
      if (d.status !== 'pending') continue;
      /* Efter ett misslyckat anrop (t.ex. 401/403 när token inte gäller
         för domänen) görs inga nya sökningar på 5 min — inget hamrande
         mot Mapbox vid varje uppdatering. Ej sökta räknas som "inte
         geokodade ännu", det misslyckade som "geokodning misslyckades". */
      if (Date.now() < this._geoErrUntil) { d.status = 'skipped'; continue; }
      if (newLookups >= MAX_LOOKUPS) { d.status = 'skipped'; continue; }
      newLookups++;
      const res = await this._geocodeForMap(d.query);
      if (generation !== this._mapGeneration) return; // svaret hann bli inaktuellt
      if (res.status === 'ok') {
        /* V51A R1 §12: ENDAST ett äkta API-svar cachas (även "ingen träff"
           som null). Ett fel cachas aldrig. Bara i minnet för sessionen. */
        this._geoCache[d.query] = res.coord;
        d.status = 'geocoded'; d.coord = res.coord;
        this._geoDenied = false;
      } else if (res.status === 'notfound') {
        this._geoCache[d.query] = null;
        d.status = 'notfound';
      } else {
        d.status = 'error'; d.http = res.http;
        this._geoFailed[d.query] = { at: Date.now(), status: res.http || 0 };
        this._geoDenied = res.http === 401 || res.http === 403;
        this._geoErrUntil = Date.now() + this._GEO_FAIL_MS;
        console.warn('[Dashboard] kartans adressökning misslyckades:', res.message);
      }
    }

    if (generation !== this._mapGeneration) return;

    const geocoded = diag.filter(d => d.coord && (d.status === 'coords' || d.status === 'geocoded')).map(d => ({ ao: d.ao, coord: d.coord }));

    /* Kartgruppering (2026-11-23, MapGrouping): en markör per plats, med
       antal när flera AO delar adress (Vasaplatsen 8). Räknaren skiljer på
       jobb, platser och jobb som saknar koordinater. */
    const groups = (typeof MapGrouping !== 'undefined') ? MapGrouping.group(geocoded)
      : geocoded.map(g => ({ coord: g.coord, display: g.coord, items: [g.ao], count: 1, hasAkut: g.ao.priority === 'akut' }));
    this._mapGroups = groups;
    setCount(geocoded.length ? groups : null);
    setDiag();

    if (geocoded.length === 0) { empty('none'); return; }

    // Återställ canvas-elementet (kan ha ersatts av tom-läge ovan i ett tidigare pass)
    if (!document.getElementById('dash-ops-map')) {
      if (generation !== this._mapGeneration) return;
      wrap.innerHTML = '<div id="dash-ops-map"></div>';
    }
    wrap.classList.remove('is-empty');
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
      if (typeof map.on === 'function') {
        let loaded = false;
        map.on('load', () => { loaded = true; });
        map.on('error', (ev) => {
          const st = ev && ev.error && (ev.error.status || ev.error.statusCode);
          if (!loaded || st === 401 || st === 403) this._mapAlert(wrap, generation, st);
        });
      }

      const bounds = new mapboxgl.LngLatBounds();
      groups.forEach((g) => {
        const first = g.items[0];
        const color = g.hasAkut ? '#dc2626' : (g.items.every(a => a.status === 'pågående') ? '#16a34a' : '#2b7fd4');
        const rows = g.items.map(ao => {
          const cu = getCu(ao.customerId);
          const cuName = cu ? CustomerService.displayName(cu) : '—';
          return `<div class="dash-map-popup-item">
            <div class="dash-map-popup-title">${ao.priority === 'akut' ? '<span class="bdg bdg-red">Akut</span> ' : ''}${esc(ao.title||ao.id)}</div>
            <div class="dash-map-popup-sub">${esc(WorkOrderService.displayNumberOrPending ? WorkOrderService.displayNumberOrPending(ao) : ao.id)} · ${esc(typeof statusLabel === 'function' ? statusLabel(ao.status) : ao.status)} · ${esc(cuName)}${ao.scheduledStart ? ' · '+esc(ao.scheduledStart) : ''}</div>
            <button type="button" class="dash-map-popup-btn" data-ao="${esc(ao.id)}" onclick="Dashboard._openAo(this)">Öppna</button>
          </div>`;
        }).join('');
        const popupHtml = `<div class="dash-map-popup">${g.count > 1 ? `<div class="dash-map-popup-head">${g.count} arbetsordrar · ${esc(g.label || first.address || '')}</div>` : ''}${rows}</div>`;
        const opts = { color };
        if (g.count > 1) {
          const el = document.createElement('div');
          el.className = 'dash-map-cluster' + (g.hasAkut ? ' akut' : '');
          el.setAttribute('aria-label', g.count + ' arbetsordrar på samma plats');
          el.textContent = String(g.count);
          opts.element = el;
        }
        const marker = new mapboxgl.Marker(opts)
          .setLngLat([g.display.lng, g.display.lat])
          .setPopup(new mapboxgl.Popup({ offset: 18, maxWidth: '300px' }).setHTML(popupHtml))
          .addTo(map);
        if (marker.getElement) { const me = marker.getElement(); if (me) { me.dataset.count = String(g.count); me.dataset.aoIds = g.items.map(a => a.id).join(','); } }
        bounds.extend([g.display.lng, g.display.lat]);
      });
      if (groups.length > 1) map.fitBounds(bounds, { padding: 36, maxZoom: 15 });
    } catch(e) {
      console.error('[Dashboard] kartfel:', e);
      if (generation === this._mapGeneration) empty('error');
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
      btns.push(this._qbtn('clock',         'Stämpla tid',  "Router.showPage('pg-tid')",                                                                  'Stämpla in och hantera din tid'));
    }
    if (Auth.canAny(['invoice_view','invoice_create'])) {
      btns.push(this._qbtn('receipt',       'Fakturering',  "Router.showPage('pg-invoices')",                                                             'Fakturaunderlag och betalningsstatus'));
    }

    if (btns.length === 0) return '';
    return `<div class="card">
      ${this._head('zap', 'Snabbåtgärder')}
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
      ${this._head('calendar', hasAll ? 'Ordrar idag' : 'Mina ordrar idag', { count: todayAOs.length || '', countLabel: todayAOs.length + ' ordrar idag', extra: `<span class="dw-date">${esc(dateStr)}</span>` })}
      <div class="card-body">
        ${todayAOs.length === 0
          ? `<div class="empty" style="padding:12px 0;gap:4px;">${ic('calendar',22)}<p style="font-size:11px;text-align:center;">Inga planerade ordrar idag</p></div>`
          : (() => {
              const LIMIT = 4;
              const uid = 'vm-today';
              const renderRow = ao => { var cu = getCu(ao.customerId); return `<div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})"><div class="crow-top"><div class="crow-title">${esc(ao.title)}</div>${sbdg(ao.status)}</div><div class="crow-sub">${ao.scheduledStart||'?'}–${ao.scheduledEnd||'?'} · ${esc(cu?CustomerService.displayName(cu):'—')}</div></div>`; };
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
  /* 2026-11-26: mest brådskande överst (akut → hög → normal → låg), och
     inom samma prioritet det som väntat längst. Varje rad visar kund/plats
     och hur länge jobbet legat i poolen. */
  _POOL_PRIO: { akut: 0, 'hög': 1, normal: 2, 'låg': 3 },
  _widgetPool() {
    const poolScope = this._scopeWorkOrdersForCurrentUser(
      (state.workOrders || []).filter(a => !a.archived && !a.deleted),
      { includeSharedPool: true }
    );
    const pr = (a) => { const r = this._POOL_PRIO[a.priority]; return r === undefined ? 2 : r; };
    const pool = poolScope.filter(a => a.status === 'pool')
      .sort((a, b) => pr(a) - pr(b) || String(a.createdAt || '9999').localeCompare(String(b.createdAt || '9999')));
    const urgentN = pool.filter(a => a.priority === 'akut').length;
    const go = "Router.showPage('pg-ao',{filter:'pool'})";
    const renderRow = ao => {
      const cu = getCu(ao.customerId);
      const where = AddressService.displayAddress(ao) || (cu ? CustomerService.displayName(cu) : '');
      const who = cu ? CustomerService.displayName(cu) : '';
      const days = this._daysSince(ao.createdAt);
      const sub = [who, where && where !== who ? where : '', days !== null ? (days === 0 ? 'i poolen sedan idag' : 'väntat ' + days + ' d') : ''].filter(Boolean).join(' · ');
      return `<div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})"><div class="crow-top"><div class="crow-title">${esc(ao.title)}</div>${pbdg(ao.priority)}</div><div class="crow-sub">${esc(sub || '—')}</div></div>`;
    };
    return `<div class="card dw-card${urgentN ? ' dw-tone-danger' : ''}">
      ${this._head('inbox', 'Arbetspool', { count: pool.length || '', countSuffix: pool.length ? 'väntar' : '', tone: urgentN ? 'red' : '', countLabel: pool.length + ' jobb väntar på att tilldelas' + (urgentN ? ', varav ' + urgentN + ' akuta' : ''), go, goLabel: 'Visa alla' })}
      <div class="card-body">
        ${pool.length === 0
          ? `<div class="empty" style="padding:12px 0;gap:4px;">${ic('inbox',22)}<p style="font-size:11px;text-align:center;">Arbetspoolen är tom — inga jobb väntar på att tilldelas</p></div>`
          : (() => {
              const LIMIT = 4;
              const uid = 'vm-pool';
              const visible = pool.slice(0, LIMIT).map(renderRow).join('');
              const hidden  = pool.length > LIMIT ? `<div id="${uid}" style="display:none;">${pool.slice(LIMIT).map(renderRow).join('')}</div><button class="btn bghost bfull bsm" style="margin-top:2px;" onclick="document.getElementById('${uid}').style.display='';this.remove()">${ic('chevron-down',11)} Visa alla (${pool.length})</button>` : '';
              return (urgentN ? `<p class="dw-lead dw-lead--danger">${ic('alert-triangle', 13)} ${urgentN} akut${urgentN === 1 ? '' : 'a'} jobb väntar på att tilldelas.</p>` : '') + visible + hidden;
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
      ${this._head('clock', 'Stämpla tid', { extra: active ? `<span class="bdg bdg-green">${ic('check-circle',10)} Incheckad</span>` : `<span class="dw-date">Utcheckad</span>` })}
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
      ${this._head('refresh-cw', 'Återkommande snart', { count: recurring.length, tone: recurring.some(r => Math.ceil((new Date(r.nextDate) - new Date(tdy())) / 86400000) <= 0) ? 'red' : '', countLabel: recurring.length + ' återkommande uppdrag inom 7 dagar', go: "Router.showPage('pg-recurring')", goLabel: 'Visa alla' })}
      <div class="card-body">
        ${(() => {
          const LIMIT = 4;
          const uid = 'vm-recur';
          const renderRow = r => { var days = Math.ceil((new Date(r.nextDate)-new Date(tdy()))/86400000); var cu = getCu(r.customerId); return `<div class="crow" onclick="Router.showPage('pg-recurring')"><div class="crow-top"><div class="crow-title">${esc(r.title)}</div><span class="bdg ${days<=0?'bdg-red':'bdg-orange'}" style="font-size:10px;white-space:nowrap;flex-shrink:0;">${days<=0?'Förfallen':days===0?'Idag':days+' d'}</span></div><div class="crow-sub">${esc(cu?CustomerService.displayName(cu):'—')}</div></div>`; };
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
      ${this._head('calendar-check', 'Planerade', { count: planned.length || '', tone: 'sky', countLabel: planned.length + ' planerade denna vecka' })}
      <div class="card-body">
        ${planned.length === 0
          ? `<div class="empty" style="padding:12px 0;gap:4px;">${ic('calendar',22)}<p style="font-size:11px;text-align:center;">Inga planerade denna vecka</p></div>`
          : (() => {
              const LIMIT = 4;
              const uid = 'vm-planned';
              const renderRow = ao => { var cu = getCu(ao.customerId); return `<div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})"><div class="crow-top"><div class="crow-title">${esc(ao.title)}</div>${sbdg(ao.status)}</div><div class="crow-sub">${fmtDate(ao.scheduledDate)} · ${esc(cu?CustomerService.displayName(cu):'—')}</div></div>`; };
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
      ${this._head('target', 'Säljchanser', { count: active.length || '', countLabel: active.length + ' aktiva säljchanser', go: "Router.showPage('pg-sales')", goLabel: 'Visa alla' })}
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
                  <div class="crow-title">${esc(opp.title)}</div>
                  ${pBadge}
                </div>
                <div class="crow-sub">${esc(cuName)}${val}</div>
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
      ${this._head('file-text', 'Offerter väntar', { count: pending.length || '', tone: 'orange', countLabel: pending.length + ' offerter väntar på svar', go: "Router.showPage('pg-offer')", goLabel: 'Visa alla' })}
      <div class="card-body">
        ${pending.length === 0
          ? `<div class="empty" style="padding:12px 0;gap:4px;">${ic('file-text',22)}<p style="font-size:11px;text-align:center;">Inga offerter väntar svar</p></div>`
          : (() => {
              const LIMIT = 3;
              const uid = 'vm-offers';
              const renderRow = o => { var cu = getCu(o.customerId); var cuName = cu?(cu.name||(cu.firstName+' '+cu.lastName).trim()):'—'; var total = (function() { var pd = typeof _offPrimaryDisplay === 'function' ? _offPrimaryDisplay(o) : null; return pd ? pd.compact : fmt((o.lines||[]).reduce((s,l)=>s+(l.total||0),0)) + ' kr'; })(); /* OFFER CORE R1.3 — BLOCKER 1: R1.2's _offRawExVat() routing fixed the wrong-blended-total bug but introduced a new "0 kr" bug for pure-recurring offers (_offRawExVat excludes recurring by design). This is a display surface — routed through the canonical _offPrimaryDisplay(off), which already handles recurring/mixed/discounted/rate-only correctly in one place. */ var age = o.sentAt?Math.floor((Date.now()-new Date(o.sentAt))/86400000):null; return `<div class="crow" onclick="Router.showPage('pg-offer-detail',{offerId:'${o.id}'})"><div class="crow-top"><div class="crow-title">${esc(cuName)}</div>${sbdg(o.status)}</div><div class="crow-sub">${total}${age!==null?' · '+age+' dagar':''}</div></div>`; };
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
      ${this._head('activity', 'Senaste händelser')}
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
      ${this._head('bell', 'Aktiviteter & uppföljningar', { go: "Router.showPage('pg-activities')", goLabel: 'Visa alla' })}
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
                <div style="font-size:12px;font-weight:700;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(a.note || ActivitiesService.typeLabel(a.type))}</div>
                <div style="font-size:10px;color:${isOverdue?'var(--rd)':'var(--mt)'};">${isOverdue?'Försenad — ':''} ${fmtDate(a.dueDate)}</div>
              </div>
              <button class="btn bxs bsu" style="font-size:9px;padding:3px 8px;" onclick="event.stopPropagation();ActivitiesService.complete('${a.id}');Dashboard.render();">${ic('check',10)} Klar</button>
            </div>`;
          }).join('')}
        </div>` : ''}
      </div>
    </div>`;
  },

  /* ── Widget: Mina uppgifter (V53B) ───────────────────────────────────
     V53B §7/§8/§9 — integrerar det befintliga Uppgifter-systemet
     (state.activities/ActivitiesService, se ActivitiesPage) i den
     BEFINTLIGA widget-registern (DashboardConfig) istället för ett
     eget, parallellt dashboard-block. Läser STRIKT
     assignedTo === egen userId (INTE "obemannad OK" som
     _widgetActivities() ovan tillåter) — det är precis skillnaden
     mellan "Aktiviteter" (bolagsbrett, äldre widget) och "Mina
     uppgifter" (uttryckligen bara EGNA uppgifter, §9: "Dashboard only
     shows task widget content where task access is permitted" och
     "MUST show ONLY current user's own open tasks — never another
     user's task under 'Mina'"). Sortering återanvänder
     ActivitiesService.sortOpen() rakt av — ingen egen, andra
     sorteringsimplementation (§8, frysningskrav §18: V53A:s
     hink-sortering får inte dupliceras/omtolkas här). */
  _widgetMyTasks() {
    const user   = Auth.getUser();
    const userId = user && user.id && user.id !== 'unknown' ? user.id : null;
    if (!userId) return '';

    const today = tdy();
    const mine   = ActivitiesService.getOpen().filter(a => a.assignedTo === userId);
    const sorted = ActivitiesService.sortOpen(mine);
    const overdueN = mine.filter(a => a.dueDate && a.dueDate < today).length;
    const todayN   = mine.filter(a => a.dueDate === today).length;
    const totalN   = mine.length;

    const _taskContext = (a) => {
      if (a.relatedType === 'workOrder' && a.relatedId) {
        const ao = getAO(a.relatedId);
        return ao ? (ao.id + (ao.title ? ' – ' + ao.title : '')) : '';
      }
      if (a.relatedType === 'offer' && a.relatedId) return 'Offert ' + a.relatedId;
      const prop = a.propertyId ? getObj(a.propertyId) : null;
      if (prop) return prop.name || prop.address || '';
      const cu = ActivitiesService.resolveCustomer(a);
      return cu ? CustomerService.displayName(cu) : '';
    };

    const bodyHtml = totalN === 0
      ? `<div class="empty" style="padding:10px 0;gap:3px;">${ic('check-square',18)}<p style="font-size:11px;color:var(--mt);">Inga öppna uppgifter</p></div>`
      : `<div style="display:flex;gap:6px;margin-bottom:10px;font-size:11px;font-weight:600;flex-wrap:wrap;">
          ${overdueN > 0 ? `<span style="color:var(--rd);">${overdueN} försenad${overdueN===1?'':'e'}</span>` : ''}
          ${todayN   > 0 ? `<span style="color:var(--or);">${todayN} idag</span>` : ''}
          <span style="color:var(--mt);">${totalN} öppna totalt</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          ${sorted.slice(0, 5).map(a => {
            const isOverdue = !!(a.dueDate && a.dueDate < today);
            const isToday   = a.dueDate === today;
            const dueColor  = isOverdue ? 'var(--rd)' : isToday ? 'var(--or)' : 'var(--mt)';
            const dueText   = a.dueDate ? (isOverdue ? 'Försenad — ' + fmtDate(a.dueDate) : isToday ? 'Idag' : fmtDate(a.dueDate)) : 'Inget datum';
            const showPrio  = a.priority === 'akut' || a.priority === 'hög';
            const ctx       = _taskContext(a);
            return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--bg);border-radius:var(--rx);cursor:pointer;border-left:3px solid ${isOverdue?'var(--rd)':isToday?'var(--or)':'var(--br)'};" onclick="ActivitiesPage.openEdit('${a.id}')">
              <span style="color:${dueColor};flex-shrink:0;">${ic(ActivitiesService.typeIcon(a.type),13)}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:700;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(a.title || ActivitiesService.typeLabel(a.type))}</div>
                <div style="font-size:10px;color:${dueColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${dueText}${ctx ? ' · ' + esc(ctx) : ''}</div>
              </div>
              ${showPrio ? `<span style="font-size:9px;font-weight:700;color:${a.priority==='akut'?'var(--rd)':'var(--or)'};background:${a.priority==='akut'?'var(--lrd)':'var(--lor)'};border-radius:5px;padding:2px 6px;flex-shrink:0;">${ActivitiesService.priorityLabel(a.priority)}</span>` : ''}
            </div>`;
          }).join('')}
        </div>`;

    return `<div class="card">
      ${this._head('check-square', 'Mina uppgifter', { count: totalN || '', tone: overdueN ? 'red' : '', countLabel: totalN + ' öppna uppgifter' + (overdueN ? ', ' + overdueN + ' försenade' : ''), go: "Router.showPage('pg-activities',{filter:'mina'})", goLabel: 'Visa alla' })}
      <div class="card-body" style="padding:10px 12px;">${bodyHtml}</div>
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
      ${this._head('clipboard-check', 'Rondering', { go: "Router.showPage('pg-rondering')", goLabel: 'Visa alla' })}
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
        ${avvUanAO.length > 0 ? `<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--mt);padding:4px 0;">${ic('info',11)} ${avvUanAO.length} avvikelse${avvUanAO.length===1?'':'r'} saknar arbetsorder</div>` : ''}
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

    /* V3: när dagens tavla visar nyckeltalen (akuta, försenade, att
       fakturera) upprepas de inte här — "Kräver åtgärd" visar då det
       tavlan inte visar (offerter, säljchanser, uppföljningar). */
    const inBoard = !!this._boardTiles;
    if (Auth.canAny(['ao_view_all','ao_view_own']) && !inBoard) {
      const akut = aos.filter(a => a.priority==='akut' && !['klar','fakturerad','avbruten'].includes(a.status));
      if (akut.length > 0) todos.push({
        icon:'alert-triangle', iconCls:'red', cls:'urgent',
        title:'Akuta ordrar kräver omedelbar åtgärd',
        sub: akut.map(a=>a.title).slice(0,2).join(', ')+(akut.length>2?` +${akut.length-2} till`:''),
        badge:akut.length, badgeCls:'',
        onClick:"Router.showPage('pg-ao',{filter:'akut'})"
      });

      /* Samma definition som AO-listans "Försenade" som raden länkar till. */
      const late = aos.filter(a => WorkOrderService.isOverdue(a, today));
      if (late.length > 0) todos.push({
        icon:'clock', iconCls:'orange',
        title:'Försenade arbetsorder',
        sub:late.map(a=>a.title).slice(0,2).join(', ')+(late.length>2?` +${late.length-2} till`:''),
        badge:late.length, badgeCls:'orange',
        onClick:"Router.showPage('pg-ao',{filter:'forsenad'})"
      });
    }

    if (Auth.canAny(['invoice_view','invoice_create']) && !inBoard) {
      /* Samma urval som AO-listans "Att fakturera" som raden länkar till. */
      let _r = null;
      const readyBill = allAos.filter(a => a.status==='klar' && !a.invoiceId && WorkOrderService._hasBillableContent(a, (_r = _r || WorkOrderService.billingStatusResolver())));
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
