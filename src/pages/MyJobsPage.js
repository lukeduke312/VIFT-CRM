/**
 * MyJobsPage — Mina jobb (Fas 4A)
 * Tekniker-vy: tilldelade AO, arbetspool, stämpling
 */
const MyJobsPage = {

  _catFilter: null,

  setCatFilter(slug) {
    this._catFilter = (slug && slug !== this._catFilter) ? slug : null;
    this.render();
  },

  render() {
    const el = document.getElementById('pg-myjobs-content');
    if (!el) return;
    const user = Auth.getUser();
    if (!user) { el.innerHTML = '<div class="empty"><p>Inte inloggad</p></div>'; return; }

    const myId  = user.id;
    const today = tdy();
    const all   = (state.workOrders || []).filter(ao => !ao.archived && !ao.deleted);
    const mine  = ao => (ao.staff || []).includes(myId);
    const alive = ao => !['klar','fakturerad','avbruten'].includes(ao.status);

    const todayJobs = all.filter(ao => mine(ao) && ao.scheduledDate === today && alive(ao))
      .sort((a,b) => (a.scheduledStart||'99:99').localeCompare(b.scheduledStart||'99:99'));

    const ongoing = all.filter(ao => mine(ao) && ao.status === 'pågående' && ao.scheduledDate !== today);

    const overdue = all.filter(ao => mine(ao) && ao.scheduledDate && ao.scheduledDate < today && alive(ao))
      .sort((a,b) => a.scheduledDate.localeCompare(b.scheduledDate));

    const pool = all.filter(ao => ao.status === 'pool')
      .sort((a,b) => ({akut:0,hög:1,normal:2,låg:3}[a.priority]||2) - ({akut:0,hög:1,normal:2,låg:3}[b.priority]||2));

    const upcoming = all.filter(ao => mine(ao) && ao.scheduledDate > today && alive(ao))
      .sort((a,b) => a.scheduledDate.localeCompare(b.scheduledDate))
      .slice(0, 8);

    const unscheduled = all.filter(ao => mine(ao) && !ao.scheduledDate && alive(ao) && ao.status !== 'pågående')
      .sort((a,b) => ({akut:0,hög:1,normal:2,låg:3}[a.priority]||2) - ({akut:0,hög:1,normal:2,låg:3}[b.priority]||2));

    const isStamped = !!state.stampActive;
    const stampAoId = state.stampAoId || null;
    const stampAo   = isStamped && stampAoId ? getAO(stampAoId) : null;

    // Category filter chips — only show categories present in user's jobs
    const myAllJobs = [...todayJobs, ...unscheduled, ...ongoing, ...overdue, ...upcoming];
    const usedCats  = new Set(myAllJobs.map(ao => ao.category || 'ovrigt'));
    const cf = this._catFilter;
    let catChipsHtml = '';
    if (usedCats.size > 1) {
      const chips = [`<button class="qf-chip ${!cf?'on':''}" onclick="MyJobsPage.setCatFilter(null)">${ic('list',10)} Alla</button>`];
      AO_CATEGORIES.forEach(c => {
        if (!usedCats.has(c.slug)) return;
        chips.push(`<button class="qf-chip ${cf===c.slug?'on':''}" onclick="MyJobsPage.setCatFilter('${c.slug}')" style="${cf===c.slug?`background:${c.color}20;border-color:${c.color}60;color:${c.color};`:''}">
          ${ic(c.icon,10)} ${c.label}
        </button>`);
      });
      catChipsHtml = `<div class="qf-row" style="margin-bottom:12px;">${chips.join('')}</div>`;
    }

    // Apply category filter to each section
    const catFilter = ao => !cf || (ao.category || 'ovrigt') === cf;
    const filteredToday       = todayJobs.filter(catFilter);
    const filteredUnscheduled = unscheduled.filter(catFilter);
    const filteredOngoing     = ongoing.filter(catFilter);
    const filteredOverdue     = overdue.filter(catFilter);
    const filteredUpcoming    = upcoming.filter(catFilter);

    let html = catChipsHtml;

    // ── Stamp banner ─────────────────────────────────────────────────────────
    if (isStamped) {
      const elapsed = TimeService.elapsedStr(state.stampTimestamp);
      const timeStr = state.stampTimestamp
        ? new Date(state.stampTimestamp).toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})
        : '';
      html += `
        <div style="background:linear-gradient(135deg,var(--gr),#15803d);color:#fff;border-radius:12px;padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px;">
          <div style="width:42px;height:42px;background:rgba(255,255,255,.15);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${ic('clock',20)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:15px;font-weight:800;margin-bottom:2px;">${ic('check-circle',13)} Incheckad — ${elapsed}</div>
            <div style="font-size:12px;opacity:.85;">Sedan ${timeStr}${stampAo?' · '+esc(stampAo.title):''}</div>
          </div>
          <button onclick="MyJobsPage.clockOut()"
            style="background:rgba(255,255,255,.2);color:#fff;border:1.5px solid rgba(255,255,255,.35);border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;">
            ${ic('log-out',13)} Stämpla ut
          </button>
        </div>`;
    }

    // ── Mina jobb idag ───────────────────────────────────────────────────────
    html += this._sectionHtml(
      `${ic('calendar',14)} Mina jobb idag`,
      filteredToday,
      cf ? 'Inga jobb idag i denna kategori' : 'Inga planerade jobb idag',
      'var(--sky)', false,
      ao => this._jobCard(ao, myId, isStamped, stampAoId),
      `<button class="btn bghost bfull bsm" style="margin-top:8px;" onclick="Router.showPage('pg-ao',{filter:'idag'})">${ic('list',11)} Se alla ordrar idag</button>`
    );

    // ── Tilldelade utan datum ─────────────────────────────────────────────────
    if (filteredUnscheduled.length) {
      html += this._sectionHtml(
        `${ic('clipboard',14)} Tilldelade — ej schemalagda`,
        filteredUnscheduled, null, 'var(--mt)', false,
        ao => this._jobCard(ao, myId, isStamped, stampAoId)
      );
    }

    // ── Pågående ─────────────────────────────────────────────────────────────
    if (filteredOngoing.length) {
      html += this._sectionHtml(
        `${ic('play-circle',14)} Pågående jobb`,
        filteredOngoing, null, 'var(--orange)', false,
        ao => this._jobCard(ao, myId, isStamped, stampAoId)
      );
    }

    // ── Försenade ────────────────────────────────────────────────────────────
    if (filteredOverdue.length) {
      html += this._sectionHtml(
        `${ic('alert-triangle',14)} Försenade jobb`,
        filteredOverdue, null, 'var(--rd)', true,
        ao => this._jobCard(ao, myId, isStamped, stampAoId)
      );
    }

    // ── Arbetspool ───────────────────────────────────────────────────────────
    html += this._sectionHtml(
      `${ic('inbox',14)} Arbetspool`,
      pool,
      'Arbetspoolen är tom',
      'var(--pu)', false,
      ao => this._poolCard(ao)
    );

    // ── Kommande jobb ────────────────────────────────────────────────────────
    if (filteredUpcoming.length) {
      html += this._sectionHtml(
        `${ic('calendar',14)} Kommande jobb`,
        filteredUpcoming, null, 'var(--br)', false,
        ao => this._jobCard(ao, myId, false, null, true)
      );
    }

    el.innerHTML = html;
  },

  /* ── Sektions-wrapper ─────────────────────────────────────────────────── */
  _sectionHtml(title, items, emptyMsg, borderColor, warn, cardFn, extra='') {
    const hasItems = items.length > 0;
    const accentColor = warn ? 'var(--rd)' : borderColor;
    return `
      <div class="surface-section">
        <div class="surface-section-header">
          <div class="surface-section-header-title" style="color:${accentColor};font-size:12px;font-weight:700;">
            <span style="width:3px;height:14px;background:${accentColor};border-radius:2px;display:inline-block;flex-shrink:0;"></span>
            ${title}
            ${hasItems ? `<span class="bdg ${warn?'bdg-red':'bdg-grey'}" style="margin-left:2px;">${items.length}</span>` : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;">
          ${!hasItems && emptyMsg
            ? `<div class="empty" style="padding:16px 0;gap:4px;">${ic('check-circle',22)}<p style="font-size:11px;text-align:center;">${emptyMsg}</p></div>`
            : items.map(cardFn).join('')}
          ${extra}
        </div>
      </div>`;
  },

  /* ── AO-kort v2 ──────────────────────────────────────────────────────── */
  _jobCard(ao, myId, isStamped, stampAoId, compact=false) {
    const cu       = getCu(ao.customerId);
    const cuName   = cu ? CustomerService.displayName(cu) : '—';
    const chkOk    = (ao.checklist||[]).filter(c => c.done).length;
    const chkAvv   = (ao.checklist||[]).filter(c => c.avvikelse==='avvikelse').length;
    const chkTotal = (ao.checklist||[]).length;
    const active   = isStamped && stampAoId === ao.id;
    const isLate   = ao.scheduledDate && ao.scheduledDate < tdy() && !['klar','fakturerad','avbruten'].includes(ao.status);
    const prioClass = ({akut:'p-akut',hög:'p-hog',normal:'p-normal',låg:'p-lag'}[ao.priority]||'p-lag');

    const timeEntries = TimeService.getByAO(ao.id);
    const actualMins  = TimeService.totalMinutes(timeEntries);
    const estMins     = Math.round((ao.estimatedHours || 0) * 60);
    const timePct     = estMins > 0 ? Math.round(actualMins / estMins * 100) : null;
    const timeOver    = timePct !== null && timePct > 115;

    const chkHtml = chkTotal > 0
      ? `<span class="ao-item-progress ${chkOk===chkTotal&&!chkAvv?'done':chkAvv>0?'has-dev':''}">${chkOk}/${chkTotal} ${ic('check',10)}</span>`
      : '';

    const subLbls = {inväntar_material:'⏳ Inväntar material',inväntar_kund:'🔔 Inväntar kund',pausad:'⏸ Pausad',behöver_återbesök:'🔄 Återbesök',blockerad:'🚫 Blockerad'};

    let primaryBtn = '';
    let secondaryBtns = '';
    if (!compact) {
      if (active) {
        primaryBtn = `<button class="btn bfull" style="background:#f0fdf4;color:var(--gr);border:1.5px solid var(--gr);font-size:13px;padding:10px;" onclick="event.stopPropagation();MyJobsPage.clockOut()">${ic('log-out',14)} Stämpla ut</button>`;
      } else if (!isStamped && Auth.can('ao_time')) {
        primaryBtn = `<button class="btn bp bfull" style="font-size:13px;padding:10px;" onclick="event.stopPropagation();MyJobsPage.clockIn('${ao.id}')">${ic('log-in',14)} Stämpla in</button>`;
      }
      secondaryBtns = `<div style="display:flex;gap:6px;">` +
        (['nytt','pool','planerad'].includes(ao.status)
          ? `<button class="btn bs bsm" onclick="event.stopPropagation();MyJobsPage.startJob('${ao.id}')">${ic('play',12)} Starta</button>`
          : '') +
        `<button class="btn bghost bsm" style="flex:1;" onclick="event.stopPropagation();Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">${ic('arrow-right',12)} Öppna</button>` +
        `</div>`;
    }

    return `
      <div class="job-card-v2 ${prioClass}${active?' active':''}${isLate&&!active?' late':''}" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
        <div class="job-card-v2-top">
          <div style="flex:1;min-width:0;">
            <div class="job-card-v2-id">${ao.id}${active?' · '+ic('clock',11)+' Aktiv stämpling':''}</div>
            <div class="job-card-v2-title">${esc(ao.title)}</div>
          </div>
          <div class="job-card-v2-badges">${sbdg(ao.status)}${ao.priority!=='normal'?pbdg(ao.priority):''}</div>
        </div>
        <div class="job-card-v2-meta">
          ${cuName !== '—' ? `<div class="job-card-v2-meta-row">${ic('user',11)} <span>${esc(cuName)}</span></div>` : ''}
          ${ao.address     ? `<div class="job-card-v2-meta-row">${ic('map-pin',11)} <span>${esc(ao.address)}</span></div>` : ''}
          ${ao.scheduledDate ? `<div class="job-card-v2-meta-row" style="color:${isLate?'var(--rd)':'var(--mt)'};">${ic('calendar',11)} <span>${isLate?'⚠ Försenad — ':''} ${ao.scheduledDate}${ao.scheduledStart?' '+ao.scheduledStart:''}</span></div>` : ''}
          ${ao.substatus ? `<div class="job-card-v2-meta-row" style="color:var(--or);">${subLbls[ao.substatus]||ao.substatus}</div>` : ''}
          ${chkTotal>0 ? `<div class="job-card-v2-meta-row">${ic('check-square',11)} ${chkHtml}</div>` : ''}
          ${estMins>0 ? `<div class="job-card-v2-meta-row" style="color:${timeOver?'var(--rd)':'var(--mt)'};">${ic('clock',11)} Plan: ${TimeService.fmtDuration(estMins)}${actualMins>0?' · Utfört: '+TimeService.fmtDuration(actualMins)+(timePct!==null?' ('+timePct+'%)':''):''}</div>` : ''}
          ${ao.category ? `<div class="job-card-v2-meta-row">${catBadge(ao.category)}</div>` : ''}
        </div>
        ${!compact ? `<div class="job-card-v2-actions" onclick="event.stopPropagation()">
          ${primaryBtn}
          ${secondaryBtns}
        </div>` : `<div onclick="event.stopPropagation()"><button class="btn bghost bsm bfull" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">${ic('arrow-right',11)} Öppna</button></div>`}
      </div>`;
  },

  /* ── Pool-kort v2 ──────────────────────────────────────────────────────── */
  _poolCard(ao) {
    const cu       = getCu(ao.customerId);
    const cuName   = cu ? CustomerService.displayName(cu) : '—';
    const chkTotal = (ao.checklist||[]).length;

    return `
      <div class="job-card-v2" style="border-left-color:var(--pu);" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
        <div class="job-card-v2-top">
          <div style="flex:1;min-width:0;">
            <div class="job-card-v2-id">${ao.id}</div>
            <div class="job-card-v2-title">${esc(ao.title)}</div>
          </div>
          <div class="job-card-v2-badges">${pbdg(ao.priority)}</div>
        </div>
        <div class="job-card-v2-meta">
          ${cuName !== '—' ? `<div class="job-card-v2-meta-row">${ic('user',11)} ${esc(cuName)}</div>` : ''}
          ${ao.address     ? `<div class="job-card-v2-meta-row">${ic('map-pin',11)} ${esc(ao.address)}</div>` : ''}
          ${ao.description ? `<div class="job-card-v2-meta-row" style="color:var(--mt);">${esc(ao.description.slice(0,80))}${ao.description.length>80?'…':''}</div>` : ''}
          ${chkTotal       ? `<div class="job-card-v2-meta-row">${ic('check-square',11)} ${chkTotal} checkpunkt${chkTotal!==1?'er':''}</div>` : ''}
        </div>
        <div class="job-card-v2-actions" onclick="event.stopPropagation()" style="justify-content:flex-end;">
          <button class="btn bghost bsm" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">${ic('external-link',12)} Öppna</button>
          <button class="btn bsu bsm" onclick="MyJobsPage.takeFromPool('${ao.id}')">${ic('user-plus',13)} Ta jobbet</button>
        </div>
      </div>`;
  },

  /* ── Åtgärder ─────────────────────────────────────────────────────────── */
  clockIn(aoId) {
    if (state.stampActive) { showToast('Stämpla ut från nuvarande jobb först'); return; }
    const ao   = getAO(aoId);
    const user = Auth.getUser();
    TimeService.clockIn(aoId);
    if (ao && user) {
      ao.log = ao.log || [];
      ao.log.push({
        id:        'L' + Date.now(),
        type:      'clock_in',
        text:      `${user.firstName} ${user.lastName} stämplade in`,
        userName:  `${user.firstName} ${user.lastName}`.trim(),
        timestamp: new Date().toISOString()
      });
      persist();
    }
    showToast('Instämplad');
    this.render();
  },

  clockOut() {
    if (!state.stampActive) return;
    const prevAoId = state.stampAoId;
    const entry    = TimeService.clockOut();
    if (entry && prevAoId) {
      const ao = getAO(prevAoId);
      if (ao) {
        ao.log = ao.log || [];
        ao.log.push({
          id:        'L' + (Date.now() + 1),
          type:      'clock_out',
          text:      `${entry.staffName} stämplade ut — ${TimeService.fmtDuration(entry.minutes)}`,
          userName:  entry.staffName,
          timestamp: new Date().toISOString()
        });
        persist();
      }
    }
    showToast('Utstämplad — tid sparad');
    this.render();
  },

  startJob(aoId) {
    WorkOrderService.setStatus(aoId, 'pågående');
    showToast('Status: Pågående');
    this.render();
  },

  takeFromPool(aoId) {
    const ao = WorkOrderService.takeFromPool(aoId);
    if (!ao) { showToast('Kunde inte ta jobbet'); return; }
    showToast(`Du är nu tilldelad ${ao.id}`);
    this.render();
    Sidebar.updateBadges();
  }
};
