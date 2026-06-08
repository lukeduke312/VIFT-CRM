/**
 * MyJobsPage — Mina jobb (Fas 4A)
 * Tekniker-vy: tilldelade AO, arbetspool, stämpling
 */
const MyJobsPage = {

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

    let html = '';

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
      todayJobs,
      'Inga planerade jobb idag',
      'var(--sky)', false,
      ao => this._jobCard(ao, myId, isStamped, stampAoId),
      `<button class="btn bghost bfull bsm" style="margin-top:8px;" onclick="Router.showPage('pg-ao',{filter:'idag'})">${ic('list',11)} Se alla ordrar idag</button>`
    );

    // ── Tilldelade utan datum ─────────────────────────────────────────────────
    if (unscheduled.length) {
      html += this._sectionHtml(
        `${ic('clipboard',14)} Tilldelade — ej schemalagda`,
        unscheduled, null, 'var(--mt)', false,
        ao => this._jobCard(ao, myId, isStamped, stampAoId)
      );
    }

    // ── Pågående ─────────────────────────────────────────────────────────────
    if (ongoing.length) {
      html += this._sectionHtml(
        `${ic('play-circle',14)} Pågående jobb`,
        ongoing, null, 'var(--orange)', false,
        ao => this._jobCard(ao, myId, isStamped, stampAoId)
      );
    }

    // ── Försenade ────────────────────────────────────────────────────────────
    if (overdue.length) {
      html += this._sectionHtml(
        `${ic('alert-triangle',14)} Försenade jobb`,
        overdue, null, 'var(--rd)', true,
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
    if (upcoming.length) {
      html += this._sectionHtml(
        `${ic('calendar',14)} Kommande jobb`,
        upcoming, null, 'var(--br)', false,
        ao => this._jobCard(ao, myId, false, null, true)
      );
    }

    el.innerHTML = html;
  },

  /* ── Sektions-wrapper ─────────────────────────────────────────────────── */
  _sectionHtml(title, items, emptyMsg, borderColor, warn, cardFn, extra='') {
    const hasItems = items.length > 0;
    return `
      <div class="card" style="border-left:4px solid ${borderColor};margin-bottom:12px;${warn?'background:linear-gradient(to right,rgba(220,38,38,.02),transparent);':''}">
        <div class="card-header">
          <h3 class="ch3" style="${warn?'color:var(--rd);':''}">${title}</h3>
          ${hasItems ? `<span class="bdg ${warn?'bdg-red':''}">${items.length}</span>` : ''}
        </div>
        <div class="card-body" style="padding:${hasItems?'8':'12'}px 10px;">
          ${!hasItems && emptyMsg
            ? `<div class="empty" style="padding:12px 0;gap:4px;">${ic('check-circle',22)}<p style="font-size:11px;text-align:center;">${emptyMsg}</p></div>`
            : items.map(cardFn).join('')}
          ${extra}
        </div>
      </div>`;
  },

  /* ── AO-kort ──────────────────────────────────────────────────────────── */
  _jobCard(ao, myId, isStamped, stampAoId, compact=false) {
    const cu       = getCu(ao.customerId);
    const cuName   = cu ? CustomerService.displayName(cu) : '—';
    const chkOk    = (ao.checklist||[]).filter(c => c.done).length;
    const chkAvv   = (ao.checklist||[]).filter(c => c.avvikelse==='avvikelse').length;
    const chkTotal = (ao.checklist||[]).length;
    const active   = isStamped && stampAoId === ao.id;
    const isLate   = ao.scheduledDate && ao.scheduledDate < tdy() && !['klar','fakturerad','avbruten'].includes(ao.status);

    const timeEntries = TimeService.getByAO(ao.id);
    const actualMins  = TimeService.totalMinutes(timeEntries);
    const estMins     = Math.round((ao.estimatedHours || 0) * 60);
    const timePct     = estMins > 0 ? Math.round(actualMins / estMins * 100) : null;
    const timeColor   = timePct === null ? 'var(--mt)' : timePct <= 100 ? 'var(--gr)' : timePct <= 115 ? 'var(--orange)' : 'var(--rd)';

    const meta = [];
    if (cuName !== '—') meta.push(esc(cuName));
    if (ao.address)     meta.push(esc(ao.address));
    if (ao.scheduledDate) meta.push(ao.scheduledDate + (ao.scheduledStart ? ' ' + ao.scheduledStart : ''));

    const chkHtml = chkTotal > 0
      ? `<span class="ao-item-progress ${chkOk===chkTotal&&!chkAvv?'done':chkAvv>0?'has-dev':''}">${chkOk}/${chkTotal} ✓${chkAvv>0?' · '+chkAvv+' avv.':''}</span>`
      : '';

    let actions = '';
    if (!compact) {
      const openBtn  = `<button class="btn bghost bsm" onclick="event.stopPropagation();Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">${ic('arrow-right',12)} Öppna</button>`;
      const startBtn = ['nytt','pool','planerad'].includes(ao.status)
        ? `<button class="btn bs bsm" onclick="event.stopPropagation();MyJobsPage.startJob('${ao.id}')">${ic('play',12)} Starta</button>`
        : '';
      let clockBtn = '';
      if (Auth.can('ao_time')) {
        if (active) {
          clockBtn = `<button class="btn bsm" style="background:rgba(22,101,52,.08);color:var(--gr);border:1.5px solid var(--gr);"
            onclick="event.stopPropagation();MyJobsPage.clockOut()">${ic('log-out',12)} Stämpla ut</button>`;
        } else if (!isStamped) {
          clockBtn = `<button class="btn bp bsm" onclick="event.stopPropagation();MyJobsPage.clockIn('${ao.id}')">${ic('log-in',12)} Stämpla in</button>`;
        }
      }
      actions = `<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;" onclick="event.stopPropagation()">${openBtn}${startBtn}${clockBtn}</div>`;
    }

    return `
      <div style="padding:11px;border-radius:9px;border:1.5px solid ${active?'var(--gr)':isLate?'rgba(220,38,38,.3)':'var(--br)'};margin-bottom:8px;cursor:pointer;
        ${active?'background:rgba(22,101,52,.03);':isLate?'background:rgba(220,38,38,.02);':''}"
        onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:4px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
              <span style="font-size:10px;font-weight:800;color:var(--mt);">${ao.id}</span>
              ${active ? `<span class="bdg bdg-green" style="font-size:9px;">${ic('clock',8)} Aktiv stämpling</span>` : ''}
            </div>
            <div style="font-size:13px;font-weight:700;line-height:1.3;color:var(--tx);">${esc(ao.title)}</div>
          </div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;flex-shrink:0;">${sbdg(ao.status)}${pbdg(ao.priority)}</div>
        </div>
        ${meta.length ? `<div style="font-size:11px;color:var(--mt);line-height:1.5;margin-bottom:2px;">${meta.join(' · ')}</div>` : ''}
        ${ao.substatus?`<div style="margin-bottom:3px;"><span style="font-size:9px;padding:1px 6px;background:rgba(251,191,36,.1);color:var(--or);border-radius:7px;border:1px solid rgba(251,191,36,.25);">${({inväntar_material:'⏳ Inväntar material',inväntar_kund:'🔔 Inväntar kund',pausad:'⏸ Pausad',behöver_återbesök:'🔄 Återbesök',blockerad:'🚫 Blockerad'}[ao.substatus]||ao.substatus)}</span></div>`:''}
        <div style="font-size:10px;color:${timeColor};margin-bottom:4px;">
          ${ic('clock',9)} ${estMins > 0 ? 'Plan: ' + TimeService.fmtDuration(estMins) + ' · ' : ''}Utfört: ${actualMins > 0 ? TimeService.fmtDuration(actualMins) : '—'}${timePct !== null ? ' (' + timePct + '%)' : estMins === 0 ? ' · Ingen tidsplan' : ''}
        </div>
        ${chkHtml ? `<div style="margin-bottom:4px;">${chkHtml}</div>` : ''}
        ${compact
          ? `<button class="btn bghost bsm" style="font-size:11px;margin-top:4px;" onclick="event.stopPropagation();Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">${ic('arrow-right',10)} Öppna</button>`
          : actions}
      </div>`;
  },

  /* ── Pool-kort ────────────────────────────────────────────────────────── */
  _poolCard(ao) {
    const cu       = getCu(ao.customerId);
    const cuName   = cu ? CustomerService.displayName(cu) : '—';
    const chkTotal = (ao.checklist||[]).length;

    return `
      <div style="padding:11px;border-radius:9px;border:1.5px solid rgba(109,40,217,.2);margin-bottom:8px;background:rgba(109,40,217,.015);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:4px;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:10px;font-weight:800;color:var(--mt);margin-bottom:2px;">${ao.id}</div>
            <div style="font-size:13px;font-weight:700;line-height:1.3;color:var(--tx);">${esc(ao.title)}</div>
          </div>
          <div style="flex-shrink:0;">${pbdg(ao.priority)}</div>
        </div>
        ${cuName !== '—' || ao.address
          ? `<div style="font-size:11px;color:var(--mt);margin-bottom:5px;">${esc(cuName)}${ao.address ? ' · ' + esc(ao.address) : ''}</div>`
          : ''}
        ${ao.description
          ? `<div style="font-size:11px;color:var(--mt);margin-bottom:5px;line-height:1.4;">${esc(ao.description.slice(0,120))}${ao.description.length>120?'…':''}</div>`
          : ''}
        ${chkTotal ? `<div style="font-size:11px;color:var(--mt);margin-bottom:6px;">${ic('check-square',10)} ${chkTotal} checkpunkt${chkTotal!==1?'er':''}</div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn bp bsm" onclick="MyJobsPage.takeFromPool('${ao.id}')">${ic('user-plus',12)} Ta jobbet</button>
          <button class="btn bghost bsm" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">${ic('external-link',12)} Öppna</button>
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
