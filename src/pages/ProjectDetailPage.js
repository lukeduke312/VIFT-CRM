/**
 * ProjectDetailPage — V54B Projektkort / operativt kontrollcentrum
 *
 * V54A byggde ENDAST en Översikt. V54B lägger till sex ytterligare
 * flikar (Arbetsorder/Tid/Uppgifter/Offerter/Ekonomi/Rapport) — alla
 * med verklig funktionalitet, ingen tom platshållare. Varje flik
 * återanvänder EN befintlig kanonisk arbetsyta (WorkOrdersPage/
 * WorkOrderDetailPage/ActivitiesPage/OffersPage/TimeService) — inget
 * dubblerat formulär byggs. Se RAPPORT-V54B-PROJEKT-OPERATIONS.md.
 *
 * §30 — Projektsidan kräver `customer_manage` (oförändrat sedan V54A).
 * Varje flikens ENSKILDA åtgärder styrs av respektive nativa
 * behörighet (ao_create/ao_edit, offer_manage, invoice_view, m.fl.) —
 * se respektive _renderXTab()/action nedan. Ekonomisk data renderas
 * ALDRIG (inte bara CSS-döljs) för en användare utan invoice_view.
 *
 * V54B R1 — blockerare 1: samma "rendera aldrig, inte bara dölj"-regel
 * gäller nu även Uppgifter (`Auth.canViewPage('pg-activities')`, dvs.
 * ao_view_all/ao_view_own — de kanoniska V53-reglerna) och Tid
 * (`ao_time`). En användare med enbart `customer_manage` ser Projekt-
 * sidan men INGEN uppgifts- eller tidsdata, ingen "Ny uppgift"/
 * "Registrera tid"-åtgärd, och Översikt/Rapport innehåller inte ens de
 * bakomliggande siffrorna för dessa kategorier (se `canTasks`/
 * `canTime`/`canFinance` nedan, trådade genom render()/Overview/Report
 * via `ProjectService.getOverview(id, {includeTasks, includeTime,
 * includeFinance})`).
 */
const ProjectDetailPage = {

  activeTab: 'overview',

  render(params) {
    const el = document.getElementById('pg-project-detail-content');
    if (!el) return;

    const projectId = (params && params.projectId) || this._projectId;
    this._projectId = projectId;
    if (params && params.tab) this.activeTab = params.tab;
    const p = projectId ? ProjectService.getById(projectId) : null;

    if (!p) {
      el.innerHTML = `
        <div class="ao-action-panel">
          <div class="ao-action-panel-left">
            <button class="btn bs bsm ao-back-btn" onclick="Router.showPage('pg-projects',{})">${ic('arrow-left', 14)} Tillbaka</button>
          </div>
        </div>
        <div class="empty" style="padding:48px 0;gap:8px;">
          ${ic('alert-circle', 24)}
          <p style="font-size:13px;color:var(--mt);">Projektet kunde inte hittas. Det kan ha tagits bort, eller så är länken felaktig.</p>
          <button class="btn bp bsm" onclick="Router.showPage('pg-projects',{})">${ic('arrow-left', 12)} Till Projekt</button>
        </div>`;
      return;
    }

    const cu   = getCu(p.customerId);
    const prop = p.propertyId ? getObj(p.propertyId) : null;
    const resp = p.responsibleUserId ? getStaff(p.responsibleUserId) : null;
    const sm   = ProjectsPage._statusMeta(p.status);

    const workOrders = ProjectService.getWorkOrders(p.id);
    const offers      = ProjectService.getOffers(p.id);
    const canFinance   = typeof Auth !== 'undefined' && Auth.can('invoice_view');
    const canAoCreate  = typeof Auth !== 'undefined' && Auth.can('ao_create');
    const canAoEdit    = typeof Auth !== 'undefined' && Auth.can('ao_edit');
    const canOffer     = typeof Auth !== 'undefined' && Auth.can('offer_manage');
    /* V54B R1 — blockerare 1A/1B: kanoniska behörighetskällor, samma
       som de befintliga sidorna faktiskt använder — inte en egen
       Projekt-specifik regel. */
    const canTasks     = typeof Auth !== 'undefined' && Auth.canViewPage('pg-activities');
    const canTime       = typeof Auth !== 'undefined' && Auth.can('ao_time');
    this._canTasks = canTasks; this._canTime = canTime; this._canFinance = canFinance;
    const tasks = canTasks ? ProjectService.getActivities(p.id) : [];

    el.innerHTML = `
      <div class="ao-action-panel">
        <div class="ao-action-panel-left">
          <button class="btn bs bsm ao-back-btn" onclick="Router.showPage('pg-projects',{})">${ic('arrow-left', 14)} Tillbaka</button>
          <span style="font-size:11px;font-weight:700;color:var(--mt);">${esc(p.id)}</span>
        </div>
        <div class="ao-action-panel-badges">
          <span style="font-size:11px;padding:3px 10px;border-radius:10px;background:${sm.color}22;color:${sm.color};border:1px solid ${sm.color}44;">${esc(sm.label)}</span>
          ${p.archived ? `<span class="bdg bdg-grey">${ic('archive', 10)} Arkiverad</span>` : ''}
        </div>
        <div class="ao-action-panel-btns">
          ${canAoCreate ? `<button class="btn bs bxs" onclick="ProjectDetailPage.newWorkOrder()">${ic('plus', 13)} Ny arbetsorder</button>` : ''}
          ${canTasks ? `<button class="btn bs bxs" onclick="ProjectDetailPage.newTask()">${ic('plus', 13)} Ny uppgift</button>` : ''}
          <button class="btn bs bxs" onclick="ProjectsPage.openEdit('${esc(p.id)}')">${ic('pencil', 13)} Redigera</button>
          <div class="dd-wrap" style="position:relative;display:inline-block;">
            <button class="btn bs bxs" onclick="ProjectDetailPage._toggleMenu(event)">${ic('more-vertical', 13)}</button>
            <div id="pd-action-menu" class="dd-menu" style="display:none;position:absolute;right:0;top:100%;z-index:40;background:var(--card);border:1px solid var(--br);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.15);min-width:200px;">
              ${canAoEdit ? `<button class="dd-item" onclick="ProjectDetailPage._toggleMenu();ProjectDetailPage.openLinkWorkOrder()" style="display:block;width:100%;text-align:left;padding:9px 12px;font-size:12px;border:0;background:none;cursor:pointer;">${ic('link', 12)} Koppla arbetsorder</button>` : ''}
              ${canOffer ? `<button class="dd-item" onclick="ProjectDetailPage._toggleMenu();ProjectDetailPage.openLinkOffer()" style="display:block;width:100%;text-align:left;padding:9px 12px;font-size:12px;border:0;background:none;cursor:pointer;">${ic('link', 12)} Koppla offert</button>` : ''}
              ${p.archived
                ? `<button class="dd-item" onclick="ProjectDetailPage._toggleMenu();ProjectsPage.unarchive('${esc(p.id)}')" style="display:block;width:100%;text-align:left;padding:9px 12px;font-size:12px;border:0;background:none;cursor:pointer;">${ic('rotate-ccw', 12)} Återställ</button>`
                : `<button class="dd-item" onclick="ProjectDetailPage._toggleMenu();ProjectsPage.archive('${esc(p.id)}')" style="display:block;width:100%;text-align:left;padding:9px 12px;font-size:12px;border:0;background:none;cursor:pointer;">${ic('archive', 12)} Arkivera</button>`}
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:12px;">
        <div class="card-body" style="padding:14px 16px;">
          <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:baseline;">
            <h3 class="ch3" style="margin:0;">${ic('folder', 15)} ${esc(p.name || 'Namnlöst projekt')}</h3>
            <div style="font-size:12px;color:var(--mt);">
              ${cu ? `<a href="javascript:void(0)" onclick="Router.showPage('pg-crm-detail',{customerId:'${esc(cu.id)}'})" style="color:var(--sky);">${esc(CustomerService.displayName(cu))}</a>` : '—'}
              ${prop ? ` · <a href="javascript:void(0)" onclick="Router.showPage('pg-obj-detail',{propId:'${esc(prop.id)}'})" style="color:var(--sky);">${esc(prop.name || prop.address || prop.id)}</a>` : ''}
              ${resp ? ` · Ansvarig: ${esc((resp.firstName + ' ' + resp.lastName).trim())}` : ''}
              ${(p.startDate || p.endDate) ? ` · ${p.startDate ? esc(fmtDate(p.startDate)) : '?'}–${p.endDate ? esc(fmtDate(p.endDate)) : '?'}` : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="ftabs" id="pd-tabs" style="margin-top:10px;margin-bottom:8px;">
        <button class="ft ${this.activeTab==='overview' ?'on':''}" onclick="ProjectDetailPage.switchTab('overview')">Översikt</button>
        <button class="ft ${this.activeTab==='ao'        ?'on':''}" onclick="ProjectDetailPage.switchTab('ao')">Arbetsorder${workOrders.length?` (${workOrders.length})`:''}</button>
        ${canTime ? `<button class="ft ${this.activeTab==='time' ?'on':''}" onclick="ProjectDetailPage.switchTab('time')">Tid</button>` : ''}
        ${canTasks ? `<button class="ft ${this.activeTab==='tasks' ?'on':''}" onclick="ProjectDetailPage.switchTab('tasks')">Uppgifter${tasks.length?` (${tasks.length})`:''}</button>` : ''}
        <button class="ft ${this.activeTab==='offers'    ?'on':''}" onclick="ProjectDetailPage.switchTab('offers')">Offerter${offers.length?` (${offers.length})`:''}</button>
        <button class="ft ${this.activeTab==='documents' ?'on':''}" onclick="ProjectDetailPage.switchTab('documents')">Dokument${(ProjectService.getDocuments(p.id).length)?` (${ProjectService.getDocuments(p.id).length})`:''}</button>
        ${canFinance ? `<button class="ft ${this.activeTab==='economy'   ?'on':''}" onclick="ProjectDetailPage.switchTab('economy')">Ekonomi</button>` : ''}
        <button class="ft ${this.activeTab==='report'    ?'on':''}" onclick="ProjectDetailPage.switchTab('report')">Rapport</button>
      </div>

      <div id="pd-tab-overview" ${this.activeTab!=='overview'?'style="display:none"':''}>${this._renderOverviewTab(p, canTasks, canTime, canFinance)}</div>
      <div id="pd-tab-ao"       ${this.activeTab!=='ao'      ?'style="display:none"':''}>${this._renderAOTab(p, workOrders, canAoCreate, canAoEdit)}</div>
      ${canTime ? `<div id="pd-tab-time" ${this.activeTab!=='time'?'style="display:none"':''}>${this._renderTimeTab(p)}</div>` : ''}
      ${canTasks ? `<div id="pd-tab-tasks" ${this.activeTab!=='tasks'?'style="display:none"':''}>${this._renderTasksTab(p, tasks)}</div>` : ''}
      <div id="pd-tab-offers"   ${this.activeTab!=='offers'  ?'style="display:none"':''}>${this._renderOffersTab(p, offers, canOffer)}</div>
      <div id="pd-tab-documents" ${this.activeTab!=='documents'?'style="display:none"':''}>${this._renderDocumentsTab(p, canFinance)}</div>
      ${canFinance ? `<div id="pd-tab-economy" ${this.activeTab!=='economy'?'style="display:none"':''}>${this._renderEconomyTab(p)}</div>` : ''}
      <div id="pd-tab-report"   ${this.activeTab!=='report'  ?'style="display:none"':''}>${this._renderReportTab(p, canTasks, canTime, canFinance)}</div>
    `;

    /* V54B R1 — om det aktiva fliknamnet blev otillgängligt (behörighet
       saknas för just den fliken) faller vyn tillbaka till Översikt
       istället för att lämna kvar en vald-men-osynlig flik. */
    if ((this.activeTab === 'tasks' && !canTasks) || (this.activeTab === 'time' && !canTime) || (this.activeTab === 'economy' && !canFinance)) {
      this.activeTab = 'overview';
      const ovEl = document.getElementById('pd-tab-overview');
      if (ovEl) ovEl.style.display = '';
    }

    document.addEventListener('click', this._dismissMenuOnOutsideClick, true);
  },

  switchTab(tab) {
    if ((tab === 'tasks' && !this._canTasks) || (tab === 'time' && !this._canTime) || (tab === 'economy' && !this._canFinance)) return;
    this.activeTab = tab;
    const tabs = ['overview','ao','time','tasks','offers','documents','economy','report'];
    tabs.forEach(t => {
      const el = document.getElementById('pd-tab-' + t);
      if (el) el.style.display = (t === tab) ? '' : 'none';
    });
    document.querySelectorAll('#pd-tabs .ft').forEach(btn => {
      btn.classList.toggle('on', btn.textContent.trim().toLowerCase().startsWith(this._tabLabel(tab).toLowerCase()));
    });
  },

  _tabLabel(tab) {
    return { overview:'Översikt', ao:'Arbetsorder', time:'Tid', tasks:'Uppgifter', offers:'Offerter', documents:'Dokument', economy:'Ekonomi', report:'Rapport' }[tab] || tab;
  },

  _toggleMenu(evt) {
    if (evt) evt.stopPropagation();
    const m = document.getElementById('pd-action-menu');
    if (m) m.style.display = (m.style.display === 'none' || !m.style.display) ? 'block' : 'none';
  },

  _dismissMenuOnOutsideClick(evt) {
    const m = document.getElementById('pd-action-menu');
    if (m && m.style.display === 'block' && !m.contains(evt.target)) m.style.display = 'none';
  },

  newWorkOrder() {
    const p = ProjectService.getById(this._projectId);
    if (!p) return;
    WorkOrdersPage.openCreate(p.customerId || null, p.propertyId || null, { projectId: p.id });
  },

  newTask() {
    /* V54B R1 — blockerare 1A: defensiv spärr även på metodnivå — samma
       mönster som ActivitiesPage._canEditTask() redan etablerat i V53A
       R1 — så åtgärden inte går att trigga via ett direkt anrop även om
       knappen (redan behörighetsstyrd i render()) av något skäl ändå
       renderades. */
    if (typeof Auth === 'undefined' || !Auth.canViewPage('pg-activities')) { showToast('Du saknar behörighet för uppgifter'); return; }
    const p = ProjectService.getById(this._projectId);
    if (!p) return;
    ActivitiesPage.openCreate({ customerId: p.customerId || '', propertyId: p.propertyId || '', projectId: p.id });
  },

  /* ══════════════════ Översikt (§5-6) ══════════════════════════════ */

  /* V54C1 — Part B: Översikten var strukturellt bra men platt — ingen
     visuell gruppering, inget uttryckligt "inget att åtgärda"-läge, och
     Arbetsorder-kortet saknade en tydlig "X klara av Y"-fras. Ingen
     omdesign — samma underliggande `ProjectService.getOverview()`-data,
     bara tydligare hierarki: en kompakt uppmärksamhets-yta (B1), en
     visuellt identifierbar Nästa åtgärd (B2), "DRIFT/UPPFÖLJNING"- och
     "EKONOMI"-rubriker som grupperar korten (B4) istället för en enda
     odelad rad. INGEN AI-poäng, INGEN uppfunnen procentandel — samma
     rent deterministiska fakta som redan fanns. */
  _renderOverviewTab(p, canTasks, canTime, canFinance) {
    const ov = ProjectService.getOverview(p.id, { includeTasks: canTasks, includeTime: canTime, includeFinance: canFinance });
    if (!ov) return '';
    const na = ov.nextAction;
    const naNav = na.aoId ? `Router.showPage('pg-ao-detail',{aoId:'${esc(na.aoId)}'})`
      : (na.activityId ? `ProjectDetailPage.switchTab('tasks')` : '');

    const card = (label, value, sub) => `
      <div class="card" style="flex:1;min-width:180px;">
        <div class="card-body" style="padding:12px 14px;">
          <div style="font-size:10px;color:var(--mt);font-weight:700;text-transform:uppercase;letter-spacing:.02em;">${label}</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px;">${value}</div>
          ${sub ? `<div style="font-size:11px;color:var(--mt);margin-top:2px;">${sub}</div>` : ''}
        </div>
      </div>`;

    const groupHeader = label => `<div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.03em;margin:14px 0 6px;">${label}</div>`;

    return `
      <!-- B1/B2 — Status/uppmärksamhets-yta + Nästa åtgärd -->
      ${na.type !== 'none' ? `
      <div class="card" style="margin-bottom:8px;border-left:3px solid var(--sky);">
        <div class="card-body" style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:8px;">
            ${ic('arrow-right',16)}
            <div><span style="font-size:10px;color:var(--mt);font-weight:700;text-transform:uppercase;">Nästa åtgärd</span>
              <div style="font-size:13px;font-weight:600;margin-top:2px;">${esc(na.text)}</div></div>
          </div>
          ${naNav ? `<button class="btn bs bxs" onclick="${naNav}">Visa</button>` : ''}
        </div>
      </div>` : `
      <div class="card" style="margin-bottom:8px;">
        <div class="card-body" style="padding:12px 14px;color:var(--mt);font-size:13px;display:flex;align-items:center;gap:8px;">${ic('check-circle',15)} ${esc(na.text)}</div>
      </div>`}

      <div class="card" style="margin-bottom:10px;">
        <div class="card-body" style="padding:10px 14px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
          ${ov.signals.length
            ? ov.signals.map(s => `<span class="bdg bdg-orange" style="font-size:11px;">${ic('alert-triangle',10)} ${esc(s)}</span>`).join('')
            : `<span style="font-size:12px;color:var(--mt);display:flex;align-items:center;gap:6px;">${ic('check-circle',13)} Projektet har inga identifierade öppna avvikelser</span>`}
        </div>
      </div>

      ${groupHeader('Drift / Uppföljning')}
      <div style="display:flex;flex-wrap:wrap;gap:10px;">
        ${card('Arbetsorder', `${ov.workOrders.completed} klara av ${ov.workOrders.total}`, `${ov.workOrders.open} öppna · ${ov.workOrders.overdue} försenade`)}
        ${canTasks ? card('Uppgifter', ov.tasks.total, `${ov.tasks.open} öppna · ${ov.tasks.overdue} förfallna`) : ''}
        ${canTime ? card('Tid', `${ov.time.actualHours} h registrerat`, `Planerat ${ov.time.plannedHours} h på ${ov.time.aoWithEstimateCount} av ${ov.time.aoTotalCount} AO`) : ''}
      </div>

      ${canFinance ? `
      ${groupHeader('Ekonomi')}
      <div style="display:flex;flex-wrap:wrap;gap:10px;">
        ${card('Godkänd offert exkl. moms', fkr(ov.commercial.approvedOfferExVat), '')}
        ${card('Fakturerat exkl. moms', fkr(ov.commercial.invoicedExVat), `Utestående kundbelopp ${fkr(ov.commercial.unpaidCustomerAmount)}`)}
        ${card('Kvar mot godkänd offert', ov.commercial.hasApprovedOffer ? fkr(ov.commercial.remainingAgainstApprovedOfferExVat) : '—', 'Exkl. moms')}
      </div>` : ''}

      <div class="card" style="margin-top:14px;">
        <div class="card-header"><h3>${ic('history',14)} Senaste händelser</h3></div>
        <div class="card-body">
          ${ov.recentEvents.length === 0
            ? `<p style="font-size:12px;color:var(--mt);padding:4px 0;">Inga händelser registrerade ännu</p>`
            : ov.recentEvents.map(e => `
              <div style="padding:8px 0;border-bottom:1px solid var(--bg);font-size:12px;">
                <span style="color:var(--mt);">${fmtDateTime(e.ts)}</span> — ${esc(e.text)}
              </div>`).join('')}
        </div>
      </div>

      ${p.description ? `<div class="card" style="margin-top:10px;"><div class="card-body" style="padding:12px 14px;"><div style="font-size:10px;color:var(--mt);font-weight:700;text-transform:uppercase;margin-bottom:3px;">Beskrivning</div><div style="font-size:13px;white-space:pre-wrap;">${esc(p.description)}</div></div></div>` : ''}
    `;
  },

  /* ══════════════════ Arbetsorder (§7-10) ══════════════════════════ */

  /* V54B R2 — "Missing scope 2": lade till aktuella timmar (härledda
     via den REDAN befintliga `getTimeSummary().byAo` — ingen ny
     formel, ingen ny cache), kompakt faktura-/faktureringsstatus (via
     `getInvoices()`, endast för `invoice_view`) och kompakta,
     radbrytande filter (Alla/Öppna/Klara + Status + Fastighet). Räkne-
     semantik: "Öppna" = ej klar/fakturerad/avbruten, "Klara" = klar
     ELLER fakturerad — samma definition som §5 Översikt redan
     använder, ingen ny/motsägande definition. */
  _renderAOTab(p, workOrders, canAoCreate, canAoEdit) {
    if (!this._aoFilterState) this._aoFilterState = { scope: 'all', status: '', propertyId: '' };
    return `
      <div class="card">
        <div class="card-header">
          <h3>${ic('clipboard-list',14)} Arbetsorder</h3>
          <span class="bdg bdg-blue">${workOrders.length}</span>
          <div style="margin-left:auto;display:flex;gap:6px;">
            ${canAoCreate ? `<button class="btn bp bxs" onclick="ProjectDetailPage.newWorkOrder()">${ic('plus',13)} Ny arbetsorder</button>` : ''}
            ${canAoEdit ? `<button class="btn bs bxs" onclick="ProjectDetailPage.openLinkWorkOrder()">${ic('link',13)} Koppla befintlig</button>` : ''}
          </div>
        </div>
        <div class="card-body">
          <div id="pd-ao-filterbar">${this._aoFilterBarHtml(workOrders)}</div>
          <div id="pd-ao-results">${this._renderAOResults(p, workOrders, canAoEdit)}</div>
        </div>
      </div>
    `;
  },

  _aoFilterBarHtml(workOrders) {
    const st = this._aoFilterState;
    const properties = [];
    const seen = new Set();
    workOrders.forEach(ao => {
      if (ao.propertyId && !seen.has(ao.propertyId)) { seen.add(ao.propertyId); const prop = getObj(ao.propertyId); if (prop) properties.push(prop); }
    });
    const statuses = Array.from(new Set(workOrders.map(a => a.status))).sort();
    const chip = (key, label) => `<button class="btn ${st.scope===key?'bp':'bs'} bxs" onclick="ProjectDetailPage.setAOFilterScope('${key}')">${label}</button>`;
    return `
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px;">
        ${chip('all','Alla')}${chip('open','Öppna')}${chip('done','Klara')}
        ${statuses.length > 1 ? `
        <select id="ao-filter-status" onchange="ProjectDetailPage.setAOFilterField('status', this.value)" style="font-size:12px;padding:5px 8px;">
          <option value="">Alla statusar</option>
          ${statuses.map(s => `<option value="${esc(s)}" ${st.status===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>` : ''}
        ${properties.length > 1 ? `
        <select id="ao-filter-property" onchange="ProjectDetailPage.setAOFilterField('propertyId', this.value)" style="font-size:12px;padding:5px 8px;">
          <option value="">Alla fastigheter</option>
          ${properties.map(pr => `<option value="${esc(pr.id)}" ${st.propertyId===pr.id?'selected':''}>${esc(pr.name||pr.address||pr.id)}</option>`).join('')}
        </select>` : ''}
      </div>
    `;
  },

  setAOFilterScope(scope) {
    this._aoFilterState.scope = scope;
    this._refreshAOResults();
  },
  setAOFilterField(field, value) {
    this._aoFilterState[field] = value;
    this._refreshAOResults();
  },
  /* V54B R2 — fyllnadsfix: `_aoFilterBarHtml()` (chippen/urvalen) och
     `_renderAOResults()` (raderna) uppdaterades tidigare bara den
     SENARE — chippens visuella "aktiv"-läge (`bp` vs `bs`) blev
     synligt inaktuellt efter ett filterval, trots att filtreringen av
     raderna faktiskt fungerade korrekt. Båda delarna av fliken
     återspeglar nu alltid samma `_aoFilterState`. */
  _refreshAOResults() {
    const p = ProjectService.getById(this._projectId);
    if (!p) return;
    const workOrders = ProjectService.getWorkOrders(p.id);
    const canAoEdit = typeof Auth !== 'undefined' && Auth.can('ao_edit');
    const barEl = document.getElementById('pd-ao-filterbar');
    if (barEl) barEl.innerHTML = this._aoFilterBarHtml(workOrders);
    const el = document.getElementById('pd-ao-results');
    if (el) el.innerHTML = this._renderAOResults(p, workOrders, canAoEdit);
  },

  _renderAOResults(p, workOrders, canAoEdit) {
    const st = this._aoFilterState || { scope: 'all', status: '', propertyId: '' };
    const doneStatuses = ['klar', 'fakturerad'];
    const aliveAo = a => !['klar', 'fakturerad', 'avbruten'].includes(a.status);
    let rows = workOrders.slice();
    if (st.scope === 'open') rows = rows.filter(aliveAo);
    else if (st.scope === 'done') rows = rows.filter(a => doneStatuses.includes(a.status));
    if (st.status) rows = rows.filter(a => a.status === st.status);
    if (st.propertyId) rows = rows.filter(a => a.propertyId === st.propertyId);
    rows.sort((a,b) => (b.scheduledDate||b.createdAt||'').localeCompare(a.scheduledDate||a.createdAt||''));

    const canTime = typeof Auth !== 'undefined' && Auth.can('ao_time');
    const canFinance = typeof Auth !== 'undefined' && Auth.can('invoice_view');
    const byAo = canTime ? ProjectService.getTimeSummary(p.id).byAo : [];
    const actualHoursFor = aoId => { const m = byAo.find(x => x.aoId === aoId); return m ? m.hours : 0; };
    const invoicesByAo = canFinance ? (ProjectService.getInvoices(p.id) || []).reduce((m, inv) => { if (inv.workOrderId) (m[inv.workOrderId] = m[inv.workOrderId] || []).push(inv); return m; }, {}) : {};

    if (rows.length === 0) {
      return `<div class="empty" style="padding:16px 0;">${ic('clipboard-list',28)}<p style="font-size:12px;color:var(--mt);">Inga arbetsorder matchar filtret</p></div>`;
    }
    return rows.map(ao => {
      const prop = ao.propertyId ? getObj(ao.propertyId) : null;
      /* V54B R3 — blockerare 1: `ao.assignedStaffIds` är INTE ett fält i
         WorkOrder-schemat — den kanoniska AO-personallistan är
         `ao.staff` (en array av personal-ID:n), exakt det fält
         WorkOrdersPage/WorkOrderDetailPage redan använder (samma
         namnupplösnings-mönster återanvänt rakt av här). Med det
         felaktiga fältnamnet visades ansvarig personal ALDRIG i
         Projekt-fliken, oavsett hur många som faktiskt var tilldelade. */
      const staffNames = (ao.staff||[]).map(id => { const s=getStaff(id); return s ? (s.firstName+' '+s.lastName).trim() : ''; }).filter(Boolean).join(', ');
      const actualHours = canTime ? actualHoursFor(ao.id) : null;
      const aoInvoices = invoicesByAo[ao.id] || [];
      const latestInvoice = aoInvoices.length ? aoInvoices[aoInvoices.length - 1] : null;
      return `
      <div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${esc(ao.id)}'})">
        <div style="flex:1;min-width:0;">
          <div class="crow-title"><span style="font-size:10px;font-weight:700;color:var(--mt);margin-right:4px;">${esc(ao.id)}</span>${esc(ao.title||'')}</div>
          <div class="crow-sub">${prop ? esc(prop.name||prop.address||'') + ' · ' : ''}${ao.scheduledDate ? fmtDate(ao.scheduledDate) : 'Ej planerad'}${staffNames ? ' · ' + esc(staffNames) : ''}${ao.estimatedHours ? ' · Est. ' + ao.estimatedHours + ' h' : ''}${canTime ? ' · Faktiskt ' + actualHours + ' h' : ''}</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;align-items:center;">
          ${sbdg(ao.status)}${pbdg(ao.priority)}
          ${canFinance && latestInvoice ? `<span class="bdg bdg-sky" style="font-size:9px;">${esc(latestInvoice.status)}</span>` : ''}
          ${canAoEdit ? `<button class="btn bxs bs" onclick="event.stopPropagation();ProjectDetailPage.unlinkWorkOrder('${esc(ao.id)}')" title="Koppla loss från projektet">${ic('unlink',11)}</button>` : ''}
        </div>
      </div>`;
    }).join('');
  },

  openLinkWorkOrder() {
    const p = ProjectService.getById(this._projectId);
    if (!p) return;
    const eligible = (state.workOrders||[]).filter(a => a.customerId === p.customerId && !a.deleted);
    if (!eligible.length) { showToast('Inga arbetsorder hos denna kund att koppla'); return; }
    const rowsHtml = eligible.map(a => {
      const linkedHere = a.projectId === p.id;
      const linkedElsewhere = a.projectId && a.projectId !== p.id;
      const otherProj = linkedElsewhere ? ProjectService.getById(a.projectId) : null;
      const stateLabel = linkedHere ? `<span class="bdg bdg-green" style="font-size:9px;">Redan kopplad</span>`
        : linkedElsewhere ? `<span class="bdg bdg-orange" style="font-size:9px;">Kopplad till ${esc(otherProj ? otherProj.name : a.projectId)}</span>`
        : `<span class="bdg bdg-grey" style="font-size:9px;">Ej kopplad</span>`;
      const compatible = ProjectService.isChildCompatible(p.id, a.customerId, a.propertyId);
      return `
        <div class="crow" style="${compatible?'':'opacity:.5;'}" ${(!linkedHere && compatible) ? `onclick="ProjectDetailPage._confirmLinkWorkOrder('${esc(a.id)}','${esc(p.id)}',${linkedElsewhere?'true':'false'})"` : ''}>
          <div style="flex:1;min-width:0;">
            <div class="crow-title">${esc(a.id)} – ${esc(a.title||'')}</div>
            <div class="crow-sub">${a.scheduledDate ? fmtDate(a.scheduledDate) : 'Ej planerad'}${compatible?'':' · Fastighet ej kompatibel med projektet'}</div>
          </div>
          ${stateLabel}
        </div>`;
    }).join('');
    Modal.open({
      title: 'Koppla befintlig arbetsorder',
      body: `<div style="max-height:400px;overflow-y:auto;">${rowsHtml}</div>`,
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  _confirmLinkWorkOrder(aoId, projectId, wasElsewhere) {
    const doLink = () => {
      const result = WorkOrderService.setProject(aoId, projectId, { confirmedMove: true });
      if (!result.ok) { showToast(result.error); return; }
      Modal.close();
      showToast('Arbetsorder kopplad till projektet');
      this.render({ projectId, tab: 'ao' });
    };
    if (wasElsewhere) {
      Modal.open({
        title: 'Flytta arbetsorder?',
        body: `<p style="font-size:13px;">Arbetsordern är redan kopplad till ett annat projekt. Vill du flytta den till detta projekt istället?</p>`,
        buttons: [
          { label: 'Flytta', cls: 'btn bsu', onClick: doLink },
          { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
        ]
      });
    } else {
      doLink();
    }
  },

  unlinkWorkOrder(aoId) {
    Modal.open({
      title: 'Koppla loss arbetsorder',
      body: `<p style="font-size:13px;">Arbetsordern ${esc(aoId)} kopplas loss från projektet. Själva arbetsordern tas inte bort.</p>`,
      buttons: [
        { label: 'Koppla loss', cls: 'btn bd', onClick: () => {
          const result = WorkOrderService.setProject(aoId, '', { confirmedMove: true });
          if (!result.ok) { showToast(result.error); return; }
          Modal.close();
          showToast('Arbetsorder losskopplad');
          this.render({ projectId: this._projectId, tab: 'ao' });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* ══════════════════ Tid (§16-19) ══════════════════════════════════ */

  /* V54B R2 — "Missing scope 1": Tid-fliken hade tidigare bara en
     sammanfattning. Kompletterad med ett kompakt period-filter (Från/
     Till, valfritt — helt projekt om tomt), en "Per vecka"-uppdelning,
     och de faktiska tidposterna som responsiva rader. Periodbytet
     anropar EXAKT samma `ProjectService.getTimeSummary(projectId,
     range)` som redan fanns — ingen egen, duplicerad aggregering. */
  _renderTimeTab(p) {
    const canRegister = ProjectService.getWorkOrders(p.id).length > 0 &&
      typeof Auth !== 'undefined' && (Auth.can('ao_time') || Auth.can('all'));
    return `
      <div class="card">
        <div class="card-header">
          <h3>${ic('clock',14)} Tid</h3>
          <div style="margin-left:auto;">
            ${canRegister ? `<button class="btn bp bxs" onclick="ProjectDetailPage.openRegisterTime()">${ic('plus',13)} Registrera tid</button>` : ''}
          </div>
        </div>
        <div class="card-body">
          <div class="g2" style="margin-bottom:10px;">
            <div class="fg"><label>Från</label><input type="date" id="tt-from" onchange="ProjectDetailPage.applyTimeFilter()"></div>
            <div class="fg"><label>Till</label><input type="date" id="tt-to" onchange="ProjectDetailPage.applyTimeFilter()"></div>
          </div>
          <div id="pd-time-results">${this._renderTimeResults(p, {})}</div>
        </div>
      </div>
    `;
  },

  applyTimeFilter() {
    const p = ProjectService.getById(this._projectId);
    if (!p) return;
    const from = document.getElementById('tt-from')?.value || '';
    const to   = document.getElementById('tt-to')?.value || '';
    if (from && to && from > to) { showToast('Från-datum kan inte vara efter Till-datum.'); return; }
    const el = document.getElementById('pd-time-results');
    if (el) el.innerHTML = this._renderTimeResults(p, { from, to });
  },

  _renderTimeResults(p, range) {
    const ts = ProjectService.getTimeSummary(p.id, range);
    const weeks = ProjectService.groupTimeEntriesByWeek(ts.entries);
    const stat = (label, value) => `
      <div style="flex:1;min-width:110px;"><div style="font-size:10px;color:var(--mt);font-weight:700;text-transform:uppercase;">${label}</div>
        <div style="font-size:17px;font-weight:700;">${value}</div></div>`;
    return `
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:14px;">
        ${stat('Planerat', ts.plannedHours + ' h')}
        ${stat('Registrerat', ts.actualHours + ' h')}
        ${stat('Avvikelse', (ts.deviationHours>0?'+':'') + ts.deviationHours + ' h')}
        ${stat('Debiterbart', ts.billableHours + ' h')}
        ${stat('Internt', ts.internalHours + ' h')}
        ${stat('Attesterat', ts.attestedHours + ' h')}
        ${stat('Oattesterat', ts.unattestedHours + ' h')}
      </div>
      <div style="font-size:11px;color:var(--mt);margin-bottom:12px;">Planerat baseras på ${ts.aoWithEstimateCount} av ${ts.aoTotalCount} arbetsorder${ts.isPeriodScoped ? ' schemalagda i perioden' : ''} som har en angiven tidsuppskattning.</div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:14px;">
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;margin-bottom:6px;">Per personal</div>
          ${ts.byStaff.length === 0 ? `<p style="font-size:12px;color:var(--mt);">Ingen tid registrerad</p>` :
            ts.byStaff.map(s => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bg);font-size:12px;"><span>${esc(s.staffName||'—')}</span><span style="font-weight:700;">${s.hours} h</span></div>`).join('')}
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;margin-bottom:6px;">Per arbetsorder</div>
          ${ts.byAo.length === 0 ? `<p style="font-size:12px;color:var(--mt);">Ingen tid registrerad</p>` :
            ts.byAo.map(a => { const ao=getAO(a.aoId); return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bg);font-size:12px;cursor:pointer;" onclick="Router.showPage('pg-ao-detail',{aoId:'${esc(a.aoId)}'})"><span>${esc(a.aoId)}${ao?' – '+esc(ao.title||''):''}</span><span style="font-weight:700;">${a.hours} h</span></div>`; }).join('')}
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;margin-bottom:6px;">Per vecka</div>
          ${weeks.length === 0 ? `<p style="font-size:12px;color:var(--mt);">Ingen tid registrerad</p>` :
            weeks.map(w => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bg);font-size:12px;"><span>v. ${w.week}</span><span style="font-weight:700;">${w.hours} h</span></div>`).join('')}
        </div>
      </div>

      <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;margin-bottom:6px;">Registrerade poster</div>
      ${ts.entries.length === 0 ? `<p style="font-size:12px;color:var(--mt);">Inga registrerade poster i vald period</p>` :
        ts.entries.map(te => {
          const ao = te.aoId ? getAO(te.aoId) : null;
          return `
          <div style="padding:9px 0;border-bottom:1px solid var(--bg);display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline;font-size:12px;">
            <span style="font-weight:700;min-width:90px;">${te.date ? fmtDate(te.date) : '—'}</span>
            <span>${esc(te.staffName||'—')}</span>
            <span style="color:var(--sky);cursor:${ao?'pointer':'default'};" ${ao?`onclick="Router.showPage('pg-ao-detail',{aoId:'${esc(te.aoId)}'})"`:''}>${esc(te.aoId||'—')}${ao?' – '+esc(ao.title||''):''}</span>
            <span>${esc(te.startStr||'')}–${esc(te.endStr||'')}</span>
            <span style="font-weight:700;">${TimeService.fmtDuration ? TimeService.fmtDuration(te.minutes) : (Math.round((te.minutes||0)/6)/10 + ' h')}</span>
            ${te.priceGroupName ? `<span>${esc(te.priceGroupName)}</span>` : (te.hourRate ? `<span>${fmt(te.hourRate)} kr/tim</span>` : '')}
            <span class="bdg bdg-${te.billable!==false?'blue':'grey'}" style="font-size:9px;">${te.billable!==false?'Debiterbar':'Intern'}</span>
            <span class="bdg bdg-${te.attested?'green':'orange'}" style="font-size:9px;">${te.attested?'Attesterad':'Oattesterad'}</span>
            ${te.comment ? `<div style="width:100%;color:var(--mt);">${esc(te.comment)}</div>` : ''}
          </div>`;
        }).join('')}
    `;
  },

  /* V54B R1 — blockerare 9/1B: registrerar INTE längre via ett eget,
     dubblerat formulär — anropar den kanoniska
     `TimePage.openManual()` (samma kod, samma fält, samma
     "Utförd av"-stöd för payroll_manage som Tid-sidan) med AO-listan
     låst till projektets kopplade arbetsordrar. Defensiv `ao_time`-
     spärr på metodnivå, oberoende av att knappen redan är
     behörighetsstyrd i render()/_renderTimeTab(). */
  /* V54B R2 — blockerare 2: "Registrera tid" öppnas nu bara om projektet
     har minst en INTE-avbruten kopplad AO — annars visas ett tydligt
     meddelande istället för ett formulär vars enda AO-alternativ ändå
     skulle blockeras vid Spara (se TimePage._collectAndSaveManual). */
  openRegisterTime() {
    if (typeof Auth === 'undefined' || !Auth.can('ao_time')) { showToast('Du saknar behörighet att registrera tid'); return; }
    const p = ProjectService.getById(this._projectId);
    if (!p) return;
    const aos = ProjectService.getWorkOrders(p.id);
    const eligible = aos.filter(a => a.status !== 'avbruten');
    if (!eligible.length) { showToast('Projektet har inga arbetsorder som går att registrera tid mot.'); return; }
    /* V54B R3 — blockerare 2: `allowedAoIds` är bara en ÖGONBLICKSBILD
       tagen när modalen öppnas — om AO1 flyttas/kopplas loss från detta
       projekt av en annan flik/användare/DataSync-cykel INNAN Spara
       klickas, är AO1 fortfarande kvar i den ögonblicksbilden och
       skulle annars godkännas. `projectId` skickas nu med så att
       TimePage._collectAndSaveManual() kan slå upp AO:ns FAKTISKA,
       aktuella `projectId` i `state` vid själva sparandet — inte bara
       den ursprungliga listan. */
    TimePage.openManual({
      title: 'Registrera tid — ' + (p.name || p.id),
      customerId: p.customerId || '',
      lockCustomer: true,
      allowedAoIds: aos.map(a => a.id),
      projectId: p.id,
      onSaved: () => { showToast('Tid sparad'); this.render({ projectId: p.id, tab: 'time' }); }
    });
  },

  /* ══════════════════ Uppgifter (§14-15) ═════════════════════════════ */

  _renderTasksTab(p, tasks) {
    const open = (typeof ActivitiesService.sortOpen === 'function' ? ActivitiesService.sortOpen(tasks.filter(a=>a.status==='open')) : tasks.filter(a=>a.status==='open'));
    const done = tasks.filter(a => a.status !== 'open');
    const row = a => `
      <div class="crow" onclick="ActivitiesPage.openEdit('${esc(a.id)}')">
        <div style="flex:1;min-width:0;">
          <div class="crow-title">${esc(a.title || ActivitiesService.typeLabel(a.type))}</div>
          <div class="crow-sub">${a.dueDate ? fmtDate(a.dueDate) : 'Inget datum'}${a.relatedType==='workOrder'&&a.relatedId?' · AO '+esc(a.relatedId):''}</div>
        </div>
        <span class="bdg bdg-${a.status==='open'?'blue':'green'}" style="font-size:9px;">${a.status==='open'?'Öppen':'Klar'}</span>
      </div>`;
    return `
      <div class="card">
        <div class="card-header">
          <h3>${ic('check-square',14)} Uppgifter</h3>
          <span class="bdg bdg-blue">${open.length} öppna</span>
          <div style="margin-left:auto;"><button class="btn bp bxs" onclick="ProjectDetailPage.newTask()">${ic('plus',13)} Ny uppgift</button></div>
        </div>
        <div class="card-body">
          ${open.length === 0 ? `<p style="font-size:12px;color:var(--mt);padding:4px 0;">Inga öppna uppgifter</p>` : open.map(row).join('')}
          ${done.length ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bg);"><div style="font-size:10px;color:var(--mt);font-weight:700;text-transform:uppercase;margin-bottom:4px;">Avslutade (${done.length})</div>${done.map(row).join('')}</div>` : ''}
        </div>
      </div>
    `;
  },

  /* ══════════════════ Offerter (§11-13) ══════════════════════════════ */

  _renderOffersTab(p, offers, canOffer) {
    const current = ProjectService.resolveCurrentOffers(p.id);
    const currentIds = new Set(current.map(o => o.id));
    return `
      <div class="card">
        <div class="card-header">
          <h3>${ic('file-text',14)} Offerter</h3>
          <span class="bdg bdg-blue">${offers.length}</span>
          <div style="margin-left:auto;display:flex;gap:6px;">
            ${canOffer ? `<button class="btn bp bxs" onclick="ProjectDetailPage.newOffer()">${ic('plus',13)} Ny offert</button>` : ''}
            ${canOffer ? `<button class="btn bs bxs" onclick="ProjectDetailPage.openLinkOffer()">${ic('link',13)} Koppla offert</button>` : ''}
          </div>
        </div>
        <div class="card-body">
          ${offers.length === 0
            ? `<p style="font-size:12px;color:var(--mt);padding:4px 0;">Inga offerter kopplade till projektet</p>`
            : offers.slice().sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).map(o => {
                /* V54B R2 — blockerare "missing scope 4": en egen,
                   lokal `(lines||[]).reduce((s,l)=>s+(l.total||0),0)`-
                   formel ignorerade servicerader/extrarader/fallback-
                   radstrukturer och kunde därför skilja sig från
                   Ekonomi-fliken och själva Offert-detaljen. Använder
                   nu den KANONISKA `_offRawExVat(o)` — samma formel
                   som `getCommercialSummary()` redan bygger på — så
                   Projekt-fliken, Ekonomi-fliken och Offert-detaljen
                   ALDRIG kan visa olika totalsummor för samma offert. */
                const total = typeof _offRawExVat === 'function' ? _offRawExVat(o) : (o.lines||[]).reduce((s,l)=>s+(l.total||0),0);
                return `
              <div class="crow" onclick="Router.showPage('pg-offer-detail',{offerId:'${esc(o.id)}'})">
                <div style="flex:1;min-width:0;">
                  <div class="crow-title">${esc(o.id)}${o.versionNumber>1?' · v'+o.versionNumber:''}${!currentIds.has(o.id)?' <span style="color:var(--mt);font-weight:400;">(tidigare revision)</span>':''}</div>
                  <div class="crow-sub">${fmt(total)} kr exkl. moms · ${fmtDate(o.createdAt)}</div>
                </div>
                ${sbdg(o.status)}
              </div>`;}).join('')}
        </div>
      </div>
    `;
  },

  newOffer() {
    const p = ProjectService.getById(this._projectId);
    if (!p) return;
    OffersPage.openCreate(p.customerId || null, { projectId: p.id });
  },

  openLinkOffer() {
    const p = ProjectService.getById(this._projectId);
    if (!p) return;
    const eligible = (state.offers||[]).filter(o => o.customerId === p.customerId && !o.deleted);
    if (!eligible.length) { showToast('Inga offerter hos denna kund att koppla'); return; }
    const rowsHtml = eligible.map(o => {
      const linkedHere = o.projectId === p.id;
      const linkedElsewhere = o.projectId && o.projectId !== p.id;
      const otherProj = linkedElsewhere ? ProjectService.getById(o.projectId) : null;
      const stateLabel = linkedHere ? `<span class="bdg bdg-green" style="font-size:9px;">Redan kopplad</span>`
        : linkedElsewhere ? `<span class="bdg bdg-orange" style="font-size:9px;">Kopplad till ${esc(otherProj ? otherProj.name : o.projectId)}</span>`
        : `<span class="bdg bdg-grey" style="font-size:9px;">Ej kopplad</span>`;
      const compatible = ProjectService.isChildCompatible(p.id, o.customerId, o.propertyId);
      return `
        <div class="crow" style="${compatible?'':'opacity:.5;'}" ${(!linkedHere && compatible) ? `onclick="ProjectDetailPage._confirmLinkOffer('${esc(o.id)}','${esc(p.id)}',${linkedElsewhere?'true':'false'})"` : ''}>
          <div style="flex:1;min-width:0;">
            <div class="crow-title">${esc(o.id)}</div>
            <div class="crow-sub">${fmtDate(o.createdAt)}${compatible?'':' · Fastighet ej kompatibel med projektet'}</div>
          </div>
          ${stateLabel}
        </div>`;
    }).join('');
    Modal.open({
      title: 'Koppla befintlig offert',
      body: `<div style="max-height:400px;overflow-y:auto;">${rowsHtml}</div>`,
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  _confirmLinkOffer(offerId, projectId, wasElsewhere) {
    const doLink = () => {
      const result = ProjectService.setOfferProject(offerId, projectId, { confirmedMove: true });
      if (!result.ok) { showToast(result.error); return; }
      Modal.close();
      showToast('Offert kopplad till projektet');
      this.render({ projectId, tab: 'offers' });
    };
    if (wasElsewhere) {
      Modal.open({
        title: 'Flytta offert?',
        body: `<p style="font-size:13px;">Offerten är redan kopplad till ett annat projekt. Vill du flytta den till detta projekt istället?</p>`,
        buttons: [
          { label: 'Flytta', cls: 'btn bsu', onClick: doLink },
          { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
        ]
      });
    } else {
      doLink();
    }
  },

  /* ══════════════════ Dokument (V54C1 Part C) ═════════════════════════
     Generaliserad direkt från OfferAttachment-arkitekturen (se
     ProjectDocumentService.js) — riktiga filer i privat Supabase
     Storage via signerade URL:er, ALDRIG base64 i Projekt-JSON. Sidan
     kräver ENDAST `customer_manage` (samma som Projektsidan i övrigt —
     ingen ny behörighet uppfunnen, §D). `amountExVat` för UE-offerter
     renderas ALDRIG i DOM:en för en användare utan `invoice_view` —
     samma "rendera aldrig, inte bara dölj"-disciplin som Ekonomi-fliken
     redan följer. */
  _documentFilterState: { type: '', search: '' },

  _renderDocumentsTab(p, canFinance) {
    const chip = (key, label) => `<button class="btn ${this._documentFilterState.type===key?'bp':'bs'} bxs" onclick="ProjectDetailPage.setDocumentFilter('${key}')">${label}</button>`;
    return `
      <div class="card">
        <div class="card-header">
          <h3>${ic('file-text',14)} Dokument</h3>
          <span class="bdg bdg-blue">${ProjectService.getDocuments(p.id).length}</span>
          <div style="margin-left:auto;">
            <button class="btn bp bxs" onclick="ProjectDetailPage.openUploadDocument()">${ic('plus',13)} Ladda upp dokument</button>
          </div>
        </div>
        <div class="card-body">
          <div class="fg" style="margin-bottom:8px;">
            <input type="search" id="doc-search" placeholder="Sök dokument / leverantör…" value="${esc(this._documentFilterState.search)}"
              oninput="ProjectDetailPage.setDocumentSearch(this.value)"
              style="width:100%;font-size:13px;padding:7px 10px;border:1px solid var(--br);border-radius:8px;background:var(--bg);color:var(--tx);">
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
            ${chip('', 'Alla')}
            ${chip('ue_offert', 'UE-offerter')}
            ${chip('avtal', 'Avtal')}
            ${chip('leverantorsfaktura', 'Fakturor')}
            ${chip('ritning', 'Ritningar')}
            ${chip('protokoll', 'Protokoll')}
            ${chip('ovrigt', 'Övrigt')}
          </div>
          <div id="pd-doc-results">${this._renderDocumentResults(p, canFinance)}</div>
        </div>
      </div>
    `;
  },

  setDocumentFilter(type) {
    this._documentFilterState.type = type;
    this._refreshDocumentResults();
  },
  setDocumentSearch(val) {
    this._documentFilterState.search = val;
    this._refreshDocumentResults();
  },
  _refreshDocumentResults() {
    const p = ProjectService.getById(this._projectId);
    if (!p) return;
    const el = document.getElementById('pd-doc-results');
    if (el) el.innerHTML = this._renderDocumentResults(p, this._canFinance);
  },

  _renderDocumentResults(p, canFinance) {
    const st = this._documentFilterState;
    let docs = ProjectService.getDocuments(p.id);
    if (st.type) docs = docs.filter(d => d.documentType === st.type);
    if (st.search) {
      const q = st.search.toLowerCase().trim();
      docs = docs.filter(d => [d.displayName, d.originalFileName, d.supplierName, d.note].filter(Boolean).some(f => f.toLowerCase().includes(q)));
    }
    if (!docs.length) {
      return `<div class="empty" style="padding:24px 0;">${ic('file-text',26)}<p style="font-size:12px;color:var(--mt);">Inga dokument ${st.type || st.search ? 'matchar filtret' : 'uppladdade ännu'}.</p></div>`;
    }
    return docs.map(d => this._documentCardHtml(d, canFinance)).join('');
  },

  _documentTypeIcon(type) {
    return { ue_offert: 'file-text', orderbekraftelse: 'clipboard-check', avtal: 'file-check', leverantorsfaktura: 'receipt', ritning: 'layers', protokoll: 'clipboard-list', foto: 'image', ovrigt: 'file-text' }[type] || 'file-text';
  },

  _documentCardHtml(d, canFinance) {
    const uploader = d.uploadedBy ? getStaff(d.uploadedBy) : null;
    const ao = d.workOrderId ? getAO(d.workOrderId) : null;
    const isUe = d.documentType === 'ue_offert';
    const ueStatusColor = { inkommen: 'bdg-grey', vald: 'bdg-green', ej_vald: 'bdg-orange' }[d.supplierQuoteStatus] || 'bdg-grey';
    return `
      <div class="crow" style="align-items:flex-start;cursor:default;">
        <div style="flex-shrink:0;color:var(--mt);margin-top:2px;">${ic(this._documentTypeIcon(d.documentType), 18)}</div>
        <div style="flex:1;min-width:0;">
          <div class="crow-title">${esc(d.displayName || d.originalFileName)} <span class="bdg bdg-grey" style="font-size:9px;">${esc(ProjectDocumentService.typeLabel(d.documentType))}</span>${isUe && d.supplierQuoteStatus ? ` <span class="bdg ${ueStatusColor}" style="font-size:9px;">${esc(ProjectDocumentService.ueStatusLabel(d.supplierQuoteStatus))}</span>` : ''}</div>
          <div class="crow-sub">
            ${d.supplierName ? esc(d.supplierName) + ' · ' : ''}${d.documentDate ? fmtDate(d.documentDate) + ' · ' : ''}${isUe && canFinance && typeof d.amountExVat === 'number' ? fkr(d.amountExVat) + ' exkl. moms · ' : ''}${ao ? 'AO ' + esc(ao.id) + ' · ' : ''}${uploader ? esc((uploader.firstName+' '+uploader.lastName).trim()) + ' · ' : ''}${d.uploadedAt ? fmtDateTime(d.uploadedAt) + ' · ' : ''}${d.sizeBytes ? Math.round(d.sizeBytes/1024) + ' kB' : ''}
          </div>
          ${d.note ? `<div style="font-size:11px;color:var(--mt);margin-top:2px;">${esc(d.note)}</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;">
          ${isUe ? `
            <button class="btn bxs ${d.supplierQuoteStatus==='vald'?'bp':'bs'}" onclick="ProjectDetailPage.setUeStatus('${esc(d.id)}','vald')" title="Markera vald">${ic('check',11)}</button>
            <button class="btn bxs ${d.supplierQuoteStatus==='ej_vald'?'bd':'bs'}" onclick="ProjectDetailPage.setUeStatus('${esc(d.id)}','ej_vald')" title="Markera ej vald">${ic('x',11)}</button>
          ` : ''}
          <button class="btn bxs bs" onclick="ProjectDetailPage.openDocument('${esc(d.id)}')" title="Öppna">${ic('eye',11)}</button>
          <button class="btn bxs bs" onclick="ProjectDetailPage.downloadDocument('${esc(d.id)}')" title="Ladda ner">${ic('download',11)}</button>
          <button class="btn bxs bs" onclick="ProjectDetailPage.openEditDocument('${esc(d.id)}')" title="Redigera metadata">${ic('pencil',11)}</button>
          <button class="btn bxs bd" onclick="ProjectDetailPage.confirmDeleteDocument('${esc(d.id)}')" title="Ta bort">${ic('trash',11)}</button>
        </div>
      </div>
    `;
  },

  /* V54C1 R1 — Blockerare 5: `canFinance` (= Auth.can('invoice_view'),
     SAMMA behörighet som redan styr Projekt-Ekonomi) styr om
     "Belopp exkl. moms"-fältet renderas ALLS i formuläret — inte bara
     döljs med CSS. En användare utan `invoice_view` kan varken SE eller
     SÄTTA ett belopp via uppladdnings- eller redigeringsformuläret. Vid
     redigering utan `invoice_view` skickas `amountExVat` överhuvudtaget
     inte med i patchen (se openEditDocument) — ett befintligt belopp
     varken exponeras eller nollställs av en sådan användares sparning. */
  _documentFormFieldsHtml(d, p, canFinance) {
    d = d || {};
    const isUe = (d.documentType || 'ovrigt') === 'ue_offert';
    const projectAos = ProjectService.getWorkOrders(p.id);
    return `
      <div class="fg"><label>Dokumenttyp <span style="color:var(--rd)">*</span></label>
        <select id="doc-type" onchange="ProjectDetailPage._docTypeChanged()">
          ${ProjectDocumentService.DOCUMENT_TYPES.map(t => `<option value="${t.key}" ${(d.documentType||'ovrigt')===t.key?'selected':''}>${esc(t.label)}</option>`).join('')}
        </select></div>
      <div class="fg"><label>Namn</label>
        <input id="doc-name" value="${esc(d.displayName||'')}" placeholder="Valfritt — annars filnamnet"></div>
      <div id="doc-ue-fields" style="display:${isUe?'block':'none'}">
        <div class="g2">
          <div class="fg"><label>Leverantör / UE <span style="color:var(--rd)">*</span></label>
            <input id="doc-supplier" value="${esc(d.supplierName||'')}" placeholder="Företagsnamn"></div>
          ${canFinance ? `
          <div class="fg"><label>Belopp exkl. moms</label>
            <input type="number" id="doc-amount" value="${d.amountExVat!=null?d.amountExVat:''}" placeholder="0"></div>
          ` : ''}
        </div>
        <div class="g2">
          <div class="fg"><label>Offertdatum</label><input type="date" id="doc-date" value="${esc(d.documentDate||'')}"></div>
          <div class="fg"><label>Giltig till</label><input type="date" id="doc-valid" value="${esc(d.validUntil||'')}"></div>
        </div>
        <div class="fg"><label>Status</label>
          <select id="doc-uestatus">
            <option value="">— Inkommen (standard) —</option>
            ${ProjectDocumentService.UE_STATUSES.map(s => `<option value="${s.key}" ${d.supplierQuoteStatus===s.key?'selected':''}>${esc(s.label)}</option>`).join('')}
          </select></div>
      </div>
      <div class="fg"><label>Arbetsorder (valfritt)</label>
        <select id="doc-ao">
          <option value="">— Ingen —</option>
          ${projectAos.map(a => `<option value="${esc(a.id)}" ${d.workOrderId===a.id?'selected':''}>${esc(a.id)} – ${esc(a.title||'')}</option>`).join('')}
        </select></div>
      <div class="fg"><label>Notering</label><textarea id="doc-note" rows="2">${esc(d.note||'')}</textarea></div>
    `;
  },

  _docTypeChanged() {
    const type = document.getElementById('doc-type')?.value;
    const ueFields = document.getElementById('doc-ue-fields');
    if (ueFields) ueFields.style.display = (type === 'ue_offert') ? 'block' : 'none';
  },

  /* §C8/§C9 — Cancel = ingen metadata-post, ingen föräldralös fil.
     Godkända filtyper granskade mot faktisk backend-arkitektur
     (project-document-upload, se backend/) — samma allow-list som
     redan används för offert-bilagor, minus format vi INTE kan
     verifiera säkert stöds i denna leverans (se rapportens §17). */
  openUploadDocument() {
    const p = ProjectService.getById(this._projectId);
    if (!p) return;
    const canFinance = this._canFinance;
    Modal.open({
      title: 'Ladda upp dokument',
      body: `
        <div class="fg"><label>Fil <span style="color:var(--rd)">*</span></label>
          <input type="file" id="doc-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"></div>
        ${this._documentFormFieldsHtml(null, p, canFinance)}
      `,
      buttons: [
        { label: 'Ladda upp', cls: 'btn bp', onClick: async () => {
          const fileInput = document.getElementById('doc-file');
          const file = fileInput && fileInput.files && fileInput.files[0];
          if (!file) { showToast('Välj en fil'); return; }
          const amountEl = document.getElementById('doc-amount');
          const meta = {
            projectId: p.id,
            documentType: document.getElementById('doc-type')?.value || 'ovrigt',
            displayName: document.getElementById('doc-name')?.value.trim() || '',
            supplierName: document.getElementById('doc-supplier')?.value.trim() || '',
            /* §Blockerare 5 — fältet finns inte ens i DOM:en utan
               `invoice_view` (se _documentFormFieldsHtml); amountEl är
               då null och inget belopp skickas alls med uppladdningen. */
            amountExVat: (canFinance && amountEl && amountEl.value !== '') ? parseFloat(amountEl.value) : null,
            documentDate: document.getElementById('doc-date')?.value || '',
            validUntil: document.getElementById('doc-valid')?.value || '',
            supplierQuoteStatus: document.getElementById('doc-uestatus')?.value || '',
            workOrderId: document.getElementById('doc-ao')?.value || '',
            note: document.getElementById('doc-note')?.value.trim() || ''
          };
          const result = await ProjectDocumentService.upload(file, meta);
          if (!result.ok) { showToast(result.error); return; }
          Modal.close();
          showToast('Dokument uppladdat');
          this.render({ projectId: p.id, tab: 'documents' });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openEditDocument(id) {
    const p = ProjectService.getById(this._projectId);
    const doc = ProjectDocumentService.getById(id);
    if (!p || !doc) return;
    const canFinance = this._canFinance;
    Modal.open({
      title: 'Redigera dokumentmetadata',
      body: this._documentFormFieldsHtml(doc, p, canFinance),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: async () => {
          const patch = {
            documentType: document.getElementById('doc-type')?.value || 'ovrigt',
            displayName: document.getElementById('doc-name')?.value.trim() || '',
            supplierName: document.getElementById('doc-supplier')?.value.trim() || '',
            documentDate: document.getElementById('doc-date')?.value || '',
            validUntil: document.getElementById('doc-valid')?.value || '',
            supplierQuoteStatus: document.getElementById('doc-uestatus')?.value || '',
            workOrderId: document.getElementById('doc-ao')?.value || '',
            note: document.getElementById('doc-note')?.value.trim() || ''
          };
          /* §Blockerare 5 — `amountExVat` ingår i patchen ENDAST om
             fältet faktiskt renderades (dvs `invoice_view` finns). En
             användare utan den behörigheten kan alltså aldrig sätta
             ELLER nollställa ett befintligt belopp via denna dialog —
             fältet saknas helt i den skickade patchen, och backend
             lämnar då dokumentets befintliga belopp orört. */
          const amountEl = document.getElementById('doc-amount');
          if (canFinance && amountEl) {
            patch.amountExVat = amountEl.value !== '' ? parseFloat(amountEl.value) : null;
          }
          const result = await ProjectDocumentService.updateMetadata(id, this._projectId, patch);
          if (!result.ok) { showToast(result.error); return; }
          Modal.close();
          showToast('Metadata uppdaterad');
          this.render({ projectId: p.id, tab: 'documents' });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* §Blockerare 1 — `expectedProjectId` = denna sidas EGEN kontext
     (`this._projectId`), aldrig härlett från dokumentet som pekas på.
     Onclick-markupen i _documentCardHtml behöver inte ändras — dessa
     sidmetoder behåller sin (id[, status])-signatur och trådar igenom
     `this._projectId` till ProjectDocumentService internt. */
  async setUeStatus(id, status) {
    const result = await ProjectDocumentService.setUeStatus(id, this._projectId, status);
    if (!result.ok) { showToast(result.error); return; }
    showToast('Status uppdaterad');
    this._refreshDocumentResults();
  },

  async openDocument(id) {
    const result = await ProjectDocumentService.getSignedUrl(id, this._projectId, 'view');
    if (!result.ok) { showToast(result.error); return; }
    window.open(result.url, '_blank');
  },

  async downloadDocument(id) {
    const result = await ProjectDocumentService.getSignedUrl(id, this._projectId, 'download');
    if (!result.ok) { showToast(result.error); return; }
    const a = document.createElement('a');
    a.href = result.url;
    a.download = result.fileName || 'dokument';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  confirmDeleteDocument(id) {
    const doc = ProjectDocumentService.getById(id);
    if (!doc) return;
    Modal.open({
      title: 'Ta bort dokument',
      body: `<p style="font-size:13px;">Dokumentet "${esc(doc.displayName || doc.originalFileName)}" tas bort permanent. Detta kan inte ångras.</p>`,
      buttons: [
        { label: 'Ta bort', cls: 'btn bd', onClick: async () => {
          const result = await ProjectDocumentService.remove(id, this._projectId);
          if (!result.ok) { showToast(result.error); return; }
          Modal.close();
          showToast('Dokument borttaget');
          this.render({ projectId: this._projectId, tab: 'documents' });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* ══════════════════ Ekonomi (§20-22) ═══════════════════════════════
     Fliken renderas ALDRIG i DOM:en om Auth.can('invoice_view') är
     falskt (se render() ovan) — inte bara CSS-dold. */

  _renderEconomyTab(p) {
    const c = ProjectService.getCommercialSummary(p.id);
    const row = (label, value) => `<div class="dr"><span class="dk">${label}</span><span class="dv" style="font-weight:700;">${value}</span></div>`;
    /* V54B R1 — blockerare 7: etiketterna namnger nu exakt vilken bas
       varje belopp har (exkl. moms vs. inkl. moms efter ev. ROT/RUT) —
       de får ALDRIG blandas ihop visuellt. "Kvar mot godkänd offert"
       visas bara om ett godkänt offert-underlag faktiskt finns
       (`hasApprovedOffer`); annars visas ett förklarande "—" istället
       för ett påhittat 0. En negativ siffra (fakturerat överstiger
       offerten) visas rakt av, klipps aldrig. */
    return `
      <div class="card">
        <div class="card-header"><h3>${ic('coins',14)} Ekonomi</h3></div>
        <div class="card-body">
          ${row('Godkänd offert exkl. moms', fkr(c.approvedOfferExVat))}
          ${row('Fakturerat exkl. moms', fkr(c.invoicedExVat))}
          ${row('Kvar mot godkänd offert (exkl. moms)', c.hasApprovedOffer ? fkr(c.remainingAgainstApprovedOfferExVat) : '—')}
          ${row('Utestående kundbelopp (inkl. moms efter ev. ROT/RUT)', fkr(c.unpaidCustomerAmount))}
          ${row('Material inköp', fkr(c.materialBuy))}
          ${row('Material försäljning', fkr(c.materialSell))}
          ${row('Registrerat tidsvärde', fkr(c.registeredTimeValue))}
          ${row('Registrerade timmar', c.totalRegisteredHours + ' h')}
          ${row('Valda UE-offerter exkl. moms', fkr(c.selectedUeOffersExVat))}
          ${c.invoiceConflicts.length ? `
            <div style="margin-top:12px;padding:10px;border:1px solid var(--rd);border-radius:8px;background:rgba(220,50,50,.08);">
              <div style="font-size:12px;font-weight:700;color:var(--rd);margin-bottom:4px;">${ic('alert-triangle',12)} Relationskonflikt (${c.invoiceConflicts.length})</div>
              <div style="font-size:11px;color:var(--mt);">Följande fakturor pekar via arbetsorder respektive offert på OLIKA projekt och räknas därför inte in ovan: ${c.invoiceConflicts.map(i=>esc(i.id)).join(', ')}</div>
            </div>` : ''}
        </div>
      </div>
    `;
  },

  /* ══════════════════ Rapport (§23-24) ═══════════════════════════════
     Återanvänder exakt samma print-mönster som InvoicesPage: window.open
     + document.write + setTimeout(print). Ingen ny PDF-motor. */

  /* V54B R1 — blockerare 8: rapporten visade tidigare "Period: X–Y" men
     endast TimeEntry-raderna var faktiskt periodfiltrerade — AO/
     Uppgifts-antal och offert/faktura-underlaget var alltid hela
     projektets livstid, vilket gjorde periodetiketten missvisande.
     Rapporten delas nu uttryckligen i två slags sektioner:
       "Aktuellt läge" — öppna/försenade AO:er och uppgifter, ALLTID
         nuläget, oavsett vald period (etiketterat som sådant).
       Period-sektioner — registrerad tid (redan periodfiltrerad),
         avslutade uppgifter VARS completedAt faller i perioden,
         utfärdade fakturor VARS sent-/skapad-datum faller i perioden.
     Planerat/faktiskt-jämförelsen i Tid-sektionen använder nu samma
     periodavgränsade planerings-underlag som getTimeSummary(...,{from,
     to}) själv definierar (se blockerare 8-kommentaren där) — aldrig
     en jämförelse mellan en periodavgränsad faktisk siffra och ett
     odefinierat helprojekt-planerat värde. */
  _renderReportTab(p, canTasks, canTime, canFinance) {
    const defFrom = p.startDate || '';
    return `
      <div class="card">
        <div class="card-header"><h3>${ic('bar-chart-2',14)} Projektuppföljning</h3></div>
        <div class="card-body">
          <div class="g2">
            <div class="fg"><label>Från</label><input type="date" id="pr-from" value="${esc(defFrom)}"></div>
            <div class="fg"><label>Till</label><input type="date" id="pr-to" value="${tdy()}"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button class="btn bp bsm" onclick="ProjectDetailPage.showReport()">${ic('eye',13)} Visa rapport</button>
            <button class="btn bs bsm" onclick="ProjectDetailPage.printReport()">${ic('printer',13)} Skriv ut / Spara som PDF</button>
          </div>
          <div id="pr-preview" style="margin-top:14px;"></div>
        </div>
      </div>
    `;
  },

  _buildReportData(p) {
    const from = document.getElementById('pr-from')?.value || p.startDate || '';
    const to   = document.getElementById('pr-to')?.value || tdy();
    /* V54B R1 — blockerare 1C: exakt samma behörighetskällor som
       render() — rapportens underlag bygger ALDRIG data för en
       kategori en användare saknar åtkomst till, oavsett vad
       formuläret (som kördes från en redan behörighetsstyrd flik)
       råkar be om. */
    const canTasks   = typeof Auth !== 'undefined' && Auth.canViewPage('pg-activities');
    const canTime    = typeof Auth !== 'undefined' && Auth.can('ao_time');
    const canFinance = typeof Auth !== 'undefined' && Auth.can('invoice_view');
    const allTasks = canTasks ? ProjectService.getActivities(p.id) : [];
    const completedTasksInPeriod = allTasks.filter(a => a.completedAt && (!from || a.completedAt.slice(0,10) >= from) && (!to || a.completedAt.slice(0,10) <= to));
    /* V54B R2 — blockerare 7: filtrerade tidigare BARA på datum, utan
       att först begränsa till `ISSUED_INVOICE_STATUSES` (skickad/
       förfallen/betald) — ett utkast eller en makulerad faktura vars
       datum råkade falla i perioden räknades alltså felaktigt som
       "utfärdad i perioden". Statusfiltret körs nu FÖRST, datumfiltret
       därefter. `invoicedExVatInPeriod` summeras via
       `InvoiceService.calcSummary(inv).exVat` — samma exkl.-moms-bas
       som §7:s helprojekt-siffra, aldrig en egen formel. */
    const issuedInvoices = canFinance
      ? (ProjectService.getInvoices(p.id) || []).filter(inv => ProjectService.ISSUED_INVOICE_STATUSES.includes(inv.status))
      : [];
    const invoicesInPeriod = issuedInvoices.filter(inv => {
      const d = (inv.sentAt || inv.createdAt || '').slice(0, 10);
      return d && (!from || d >= from) && (!to || d <= to);
    });
    const invoicedExVatInPeriod = invoicesInPeriod.reduce((s, inv) => s + (typeof InvoiceService !== 'undefined' ? InvoiceService.calcSummary(inv).exVat : 0), 0);
    return {
      p, from, to, canTasks, canTime, canFinance,
      cu: getCu(p.customerId),
      prop: p.propertyId ? getObj(p.propertyId) : null,
      workOrders: ProjectService.getWorkOrders(p.id),
      ts: canTime ? ProjectService.getTimeSummary(p.id, { from, to }) : null,
      allTasks,
      completedTasksInPeriod,
      nextAction: ProjectService.getNextAction(p.id, { includeTasks: canTasks }),
      invoicesInPeriod,
      invoicedExVatInPeriod: Math.round(invoicedExVatInPeriod),
      commercial: canFinance ? ProjectService.getCommercialSummary(p.id) : null
    };
  },

  /* V54B R2 — blockerare 8: Från/Till valideras nu innan någon
     rapportberäkning görs — ett Från-datum efter Till-datum ger annars
     ett meningslöst rapportinnehåll (tomma/felaktiga periodfilter)
     utan att användaren varnas. */
  _validateReportRange() {
    const from = document.getElementById('pr-from')?.value || '';
    const to   = document.getElementById('pr-to')?.value || '';
    if (from && to && from > to) {
      showToast('Från-datum kan inte vara efter Till-datum.');
      return false;
    }
    return true;
  },

  showReport() {
    const p = ProjectService.getById(this._projectId);
    if (!p) return;
    if (!this._validateReportRange()) return;
    const d = this._buildReportData(p);
    const el = document.getElementById('pr-preview');
    if (el) el.innerHTML = this._reportHtml(d, false);
  },

  printReport() {
    const p = ProjectService.getById(this._projectId);
    if (!p) return;
    if (!this._validateReportRange()) return;
    const d = this._buildReportData(p);
    const html = this._reportHtml(d, true);
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) { showToast('Popup blockerad — tillåt popup-fönster för att skriva ut'); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Projektrapport ${esc(p.id)}</title>
      <style>
        body{font-family:Arial,sans-serif;color:#1a1a1a;padding:32px;}
        h1{color:#0f3763;font-size:20px;margin-bottom:2px;}
        h2{color:#0f3763;font-size:14px;border-bottom:1px solid #0f3763;padding-bottom:4px;margin-top:22px;}
        table{width:100%;border-collapse:collapse;margin-top:8px;}
        td,th{padding:5px 6px;font-size:12px;border-bottom:1px solid #ddd;text-align:left;}
        .meta{color:#555;font-size:12px;}
        .tot{font-weight:700;}
      </style></head><body>${html}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 800);
  },

  _reportHtml(d, printMode) {
    const p = d.p;
    const aliveAo = a => !['klar','fakturerad','avbruten'].includes(a.status);
    const openAo = d.workOrders.filter(aliveAo);
    const today = tdy();
    const overdueAo = openAo.filter(a => a.scheduledDate && a.scheduledDate < today);
    const doneAo = d.workOrders.filter(a => ['klar','fakturerad'].includes(a.status));
    const openTasks = d.allTasks.filter(a => a.status === 'open');
    const overdueTasks = openTasks.filter(a => a.dueDate && a.dueDate < today);
    return `
      <h1>${esc(p.name || p.id)}</h1>
      <div class="meta">${esc(p.id)} · ${d.cu ? esc(CustomerService.displayName(d.cu)) : ''}${d.prop ? ' · '+esc(d.prop.name||d.prop.address||'') : ''}</div>
      <div class="meta">Period: ${d.from ? fmtDate(d.from) : '—'} – ${d.to ? fmtDate(d.to) : '—'} · Status: ${esc(ProjectService.statusLabel(p.status))}</div>
      <div class="meta">Nästa åtgärd: ${esc(d.nextAction.text)}</div>

      <h2>Arbetsorder — aktuellt läge</h2>
      <table><tr><th>ID</th><th>Titel</th><th>Status</th><th>Datum</th></tr>
        ${d.workOrders.length ? d.workOrders.map(a=>`<tr><td>${esc(a.id)}</td><td>${esc(a.title||'')}</td><td>${esc(a.status)}</td><td>${a.scheduledDate?fmtDate(a.scheduledDate):'—'}</td></tr>`).join('') : '<tr><td colspan="4">Inga arbetsorder</td></tr>'}
      </table>
      <div class="meta tot">Just nu: ${openAo.length} öppna (${overdueAo.length} försenade), ${doneAo.length} avslutade av ${d.workOrders.length} totalt</div>

      ${d.canTime ? `
      <h2>Tid — i vald period</h2>
      <table>
        <tr><td>Planerat i perioden</td><td class="tot">${d.ts.plannedHours} h (${d.ts.aoWithEstimateCount} av ${d.ts.aoTotalCount} arbetsorder schemalagda i perioden med tidsuppskattning)</td></tr>
        <tr><td>Registrerat i perioden</td><td class="tot">${d.ts.actualHours} h</td></tr>
        <tr><td>Avvikelse (samma periodavgränsning)</td><td class="tot">${d.ts.deviationHours>0?'+':''}${d.ts.deviationHours} h</td></tr>
        <tr><td>Debiterbar / Intern</td><td>${d.ts.billableHours} h / ${d.ts.internalHours} h</td></tr>
        <tr><td>Attesterad / Oattesterad</td><td>${d.ts.attestedHours} h / ${d.ts.unattestedHours} h</td></tr>
      </table>
      <h2>Tid per personal</h2>
      <table><tr><th>Personal</th><th>Timmar</th></tr>
        ${d.ts.byStaff.length ? d.ts.byStaff.map(s=>`<tr><td>${esc(s.staffName||'—')}</td><td>${s.hours} h</td></tr>`).join('') : '<tr><td colspan="2">Ingen tid registrerad i perioden</td></tr>'}
      </table>
      <h2>Tid per arbetsorder</h2>
      <table><tr><th>Arbetsorder</th><th>Timmar</th></tr>
        ${d.ts.byAo.length ? d.ts.byAo.map(a=>{ const ao=getAO(a.aoId); return `<tr><td>${esc(a.aoId)}${ao?' – '+esc(ao.title||''):''}</td><td>${a.hours} h</td></tr>`; }).join('') : '<tr><td colspan="2">Ingen tid registrerad i perioden</td></tr>'}
      </table>` : ''}

      ${d.canTasks ? `
      <h2>Uppgifter</h2>
      <div class="meta">Aktuellt läge: ${openTasks.length} öppna (${overdueTasks.length} förfallna) av ${d.allTasks.length} totalt</div>
      <div class="meta">Avslutade i perioden: ${d.completedTasksInPeriod.length}</div>` : ''}

      ${d.commercial ? `
      <h2>Ekonomi</h2>
      <div class="meta">Aktuell godkänd offert (ej ett periodtotal)</div>
      <table>
        <tr><td>Godkänd offert exkl. moms</td><td class="tot">${fkr(d.commercial.approvedOfferExVat)}</td></tr>
        <tr><td>Fakturerat totalt exkl. moms</td><td class="tot">${fkr(d.commercial.invoicedExVat)}</td></tr>
        <tr><td>Kvar mot godkänd offert (exkl. moms)</td><td class="tot">${d.commercial.hasApprovedOffer ? fkr(d.commercial.remainingAgainstApprovedOfferExVat) : '—'}</td></tr>
        <tr><td>Utestående kundbelopp (inkl. moms efter ev. ROT/RUT)</td><td>${fkr(d.commercial.unpaidCustomerAmount)}</td></tr>
        <tr><td>Fakturor utfärdade i perioden</td><td>${d.invoicesInPeriod.length} st</td></tr>
        <tr><td>Fakturerat i perioden exkl. moms</td><td>${fkr(d.invoicedExVatInPeriod)}</td></tr>
        <tr><td>Material inköp</td><td>${fkr(d.commercial.materialBuy)}</td></tr>
        <tr><td>Material försäljning</td><td>${fkr(d.commercial.materialSell)}</td></tr>
        <tr><td>Registrerat tidsvärde</td><td>${fkr(d.commercial.registeredTimeValue)}</td></tr>
      </table>
      ${d.commercial.invoiceConflicts.length ? `<div class="meta">${d.commercial.invoiceConflicts.length} fakturarelation i konflikt — exkluderad ur totalerna ovan.</div>` : ''}` : ''}
      ${printMode ? '' : `<div style="margin-top:10px;"><button class="btn bs bxs" onclick="ProjectDetailPage.printReport()">${ic('printer',12)} Skriv ut / Spara som PDF</button></div>`}
    `;
  }
};
