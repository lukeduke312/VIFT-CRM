/**
 * OperationsPage — Dagens drift (Fas 4B)
 * Chefsvy: KPI, personalstatus, försenade/akuta, klara ej fakturerade, kommande, serviceintervall (v9)
 */
const OperationsPage = {

  render() {
    const el = document.getElementById('pg-operations-content');
    if (!el) return;

    const today = tdy();
    const all   = (state.workOrders || []).filter(ao => !ao.archived && !ao.deleted);
    const alive = ao => !['klar','fakturerad','avbruten'].includes(ao.status);

    const todayAOs       = all.filter(ao => ao.scheduledDate === today && alive(ao));
    const ongoing        = all.filter(ao => ao.status === 'pågående');
    const ongoingNoDate  = ongoing.filter(ao => !ao.scheduledDate);
    const overdue        = all.filter(ao => ao.scheduledDate && ao.scheduledDate < today && alive(ao) && ao.status !== 'pool');
    const urgent         = all.filter(ao => ao.priority === 'akut' && alive(ao));
    const noStaff        = all.filter(ao => (ao.staff||[]).length === 0 && alive(ao) && !['pool','avbruten'].includes(ao.status));
    const readyBill      = all.filter(ao => ao.status === 'klar' && !ao.invoiceId);
    const withNotes      = all.filter(ao => alive(ao) && (ao.notes||[]).length > 0);
    const clocked        = state.stampActive ? 1 : 0;

    el.innerHTML =
      this._kpiRow(todayAOs.length, ongoing.length, overdue.length, urgent.length,
                   noStaff.length, clocked, readyBill.length, withNotes.length) +
      this._sectionCategories(all) +
      this._sectionToday(todayAOs, today) +
      this._sectionTime(todayAOs) +
      this._sectionAttention(overdue, urgent, noStaff, withNotes) +
      this._sectionOngoingNoDate(ongoingNoDate) +
      this._sectionStaff(all, today) +
      this._sectionServiceIntervals(today) +
      this._sectionReadyBill(readyBill) +
      this._sectionUpcoming(all, today);
  },

  // ── Belastning per kategori ──────────────────────────────────────────────

  _sectionCategories(all) {
    const isOpen = ao => !['klar','fakturerad','avbruten'].includes(ao.status);
    const openAos = all.filter(isOpen);
    if (!openAos.length) return '';

    const rows = AO_CATEGORIES
      .map(c => {
        const aos    = openAos.filter(ao => (ao.category || 'ovrigt') === c.slug);
        const urgent = aos.filter(ao => ao.priority === 'akut').length;
        return { cat: c, count: aos.length, urgent };
      })
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .map(({ cat: c, count, urgent }) => `
        <div style="display:flex;align-items:center;gap:10px;padding:7px 14px;border-bottom:1px solid var(--br);cursor:pointer;" onclick="Router.showPage('pg-ao')">
          <span style="width:26px;height:26px;border-radius:7px;background:${c.color}1a;color:${c.color};display:flex;align-items:center;justify-content:center;flex-shrink:0;">${ic(c.icon,12)}</span>
          <div style="flex:1;font-size:12px;font-weight:700;color:var(--navy);">${esc(c.label)}</div>
          <div style="display:flex;align-items:center;gap:8px;">
            ${urgent > 0 ? `<span style="font-size:10px;font-weight:700;color:var(--rd);background:var(--lrd);padding:2px 7px;border-radius:6px;">${ic('zap',9)} ${urgent} akut${urgent>1?'a':''}</span>` : ''}
            <span style="font-size:14px;font-weight:900;color:var(--navy);min-width:18px;text-align:right;">${count}</span>
          </div>
        </div>`).join('');

    return `<div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <h3 class="ch3">${ic('layers',14)} Belastning per kategori</h3>
        <span style="font-size:10px;color:var(--mt);">${openAos.length} öppna totalt</span>
      </div>
      <div class="card-body" style="padding:0;">${rows}</div>
    </div>`;
  },

  // ── KPI row ──────────────────────────────────────────────────────────────

  _kpiRow(todayCnt, ongoingCnt, overdueCnt, urgentCnt, noStaffCnt, clockedCnt, billCnt, notesCnt) {
    const attentionCnt = overdueCnt + urgentCnt;
    const stat = (val, label, cls, icon, onclick) =>
      `<div class="ops-stat-card${cls?' '+cls:''}" ${onclick?`onclick="${onclick}"`:''}>
        <div class="ops-stat-num">${val}</div>
        <div class="ops-stat-lbl">${ic(icon,11)} ${label}</div>
      </div>`;

    const pills = [
      noStaffCnt > 0 ? `<span style="background:rgba(234,88,12,.1);color:var(--or);border-radius:6px;padding:3px 9px;font-size:11px;font-weight:700;display:flex;align-items:center;gap:4px;">${ic('user-x',10)} ${noStaffCnt} saknar personal</span>` : '',
      clockedCnt > 0 ? `<span style="background:rgba(43,127,212,.1);color:var(--sky);border-radius:6px;padding:3px 9px;font-size:11px;font-weight:700;display:flex;align-items:center;gap:4px;">${ic('clock',10)} ${clockedCnt} inklockad${clockedCnt>1?'e':''}</span>` : '',
      notesCnt > 0   ? `<span style="background:var(--bg);color:var(--mt);border-radius:6px;padding:3px 9px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:4px;">${ic('file-text',10)} ${notesCnt} med anteckningar</span>` : '',
    ].filter(Boolean).join('');

    return `<div class="ops-stats-bar">
      ${stat(todayCnt,     'Planerade idag', 'blue',                              'calendar',       `Router.showPage('pg-operations',{filter:'today'})`)}
      ${stat(ongoingCnt,   'Pågående',       'green',                             'play-circle',    `Router.showPage('pg-operations',{filter:'ongoing'})`)}
      ${stat(attentionCnt, 'Kräver åtgärd',  attentionCnt>0?'red':'',            'alert-triangle', `Router.showPage('pg-operations',{filter:'overdue'})`)}
      ${stat(billCnt,      'Ej fakturerade', billCnt>0?'orange':'',               'receipt',        `Router.showPage('pg-operations',{filter:'bill'})`)}
    </div>
    ${pills ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">${pills}</div>` : ''}`;
  },

  // ── Dagens AO ────────────────────────────────────────────────────────────

  _sectionToday(aos, today) {
    if (aos.length === 0) {
      return `<div class="card" style="margin-bottom:12px;">
        <div class="card-header"><h3 class="ch3">${ic('calendar',14)} Dagens arbetsorder</h3>
          <span style="font-size:10px;color:var(--mt);">${new Date().toLocaleDateString('sv-SE',{weekday:'long',day:'numeric',month:'long'})}</span>
        </div>
        <div class="card-body"><div class="empty" style="padding:12px 0;gap:4px;">${ic('calendar',22)}<p style="font-size:11px;">Inga planerade ordrar idag</p></div></div>
      </div>`;
    }
    const rows = aos.map(ao => this._aoRow(ao)).join('');
    return `<div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <h3 class="ch3">${ic('calendar',14)} Dagens arbetsorder</h3>
        <span style="font-size:10px;color:var(--mt);">${new Date().toLocaleDateString('sv-SE',{weekday:'long',day:'numeric',month:'long'})} · ${aos.length} st</span>
      </div>
      <div class="card-body" style="padding:0;">${rows}</div>
    </div>`;
  },

  // ── Kräver uppmärksamhet ─────────────────────────────────────────────────

  _sectionAttention(overdue, urgent, noStaff, withNotes) {
    const total = overdue.length + urgent.length + noStaff.length + withNotes.length;
    if (total === 0) return `<div class="attention-banner warn" style="border-left-color:var(--gr);background:#f0fdf4;border-color:#86efac;margin-bottom:12px;">
      <div class="attention-banner-icon" style="color:var(--gr);">${ic('check-circle',18)}</div>
      <div class="attention-banner-body">
        <div class="attention-banner-title" style="color:#166534;">Inget kräver omedelbar uppmärksamhet</div>
        <div class="attention-banner-sub">Alla aktiva ordrar är under kontroll</div>
      </div>
    </div>`;

    let html = `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--rd);">
      <div class="card-header"><h3 class="ch3" style="color:var(--rd);">${ic('alert-triangle',14)} Kräver uppmärksamhet</h3></div>
      <div class="card-body" style="padding:0;">`;

    if (overdue.length > 0) {
      html += this._attentionGroup('Försenade', 'rd', 'alert-triangle', overdue);
    }
    if (urgent.length > 0) {
      html += this._attentionGroup('Akuta', 'rd', 'alert-circle', urgent);
    }
    if (noStaff.length > 0) {
      html += this._attentionGroup('Saknar personal', 'orange', 'user-x', noStaff);
    }
    if (withNotes.length > 0) {
      html += this._attentionGroup('Med anteckningar', 'mt', 'file-text', withNotes);
    }

    return html + '</div></div>';
  },

  _attentionGroup(label, color, icon, aos) {
    return `<div style="padding:8px 14px 4px;border-bottom:1px solid var(--br);">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:6px;">
        <span style="width:6px;height:6px;border-radius:50%;background:var(--${color});flex-shrink:0;"></span>
        <span style="font-size:12px;font-weight:700;color:var(--${color});">${ic(icon,11)} ${label}</span>
        <span class="bdg" style="font-size:10px;background:var(--bg);color:var(--mt);">${aos.length}</span>
      </div>
      ${aos.map(ao => this._aoRow(ao, true)).join('')}
    </div>`;
  },

  // ── Pågående utan datum ───────────────────────────────────────────────────

  _sectionOngoingNoDate(aos) {
    if (!aos.length) return '';
    const rows = aos.map(ao => {
      const subLabels = {inväntar_material:'⏳ Inväntar material',inväntar_kund:'🔔 Inväntar kund',pausad:'⏸ Pausad',behöver_återbesök:'🔄 Återbesök',blockerad:'🚫 Blockerad'};
      const subBadge = ao.substatus ? `<span style="font-size:10px;padding:2px 7px;background:rgba(251,191,36,.12);color:var(--or);border-radius:7px;border:1px solid rgba(251,191,36,.25);">${subLabels[ao.substatus]||ao.substatus}</span>` : '';
      return this._aoRow(ao, true) + (ao.substatus ? '' : '');
    }).join('');
    return `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--orange);">
      <div class="card-header">
        <h3 class="ch3" style="color:var(--orange);">${ic('play-circle',14)} Pågående utan planerat datum</h3>
        <span class="bdg bdg-orange">${aos.length}</span>
      </div>
      <div class="card-body" style="padding:0;">${aos.map(ao => this._aoRow(ao)).join('')}</div>
    </div>`;
  },

  // ── Personalstatus ───────────────────────────────────────────────────────

  _sectionStaff(all, today) {
    const activeStaff = (state.staff || []).filter(s => s.active);
    if (activeStaff.length === 0) return '';

    const rows = activeStaff.map(s => {
      const myAOs    = all.filter(ao => (ao.staff||[]).includes(s.id));
      const todayAOs = myAOs.filter(ao => ao.scheduledDate === today && !['klar','fakturerad','avbruten'].includes(ao.status));
      const running  = myAOs.filter(ao => ao.status === 'pågående');
      const overdueN = myAOs.filter(ao => ao.scheduledDate && ao.scheduledDate < today && !['klar','fakturerad','avbruten','pool'].includes(ao.status));
      const isMe     = state.currentUser && state.currentUser.id === s.id;
      const stamped  = isMe && state.stampActive;
      const stampAo  = stamped ? getAO(state.stampAoId) : null;
      const role     = (state.roles||[]).find(r => r.id === s.role);

      const initials = (s.firstName||'').charAt(0) + (s.lastName||'').charAt(0);
      const nextJob  = todayAOs.find(ao => !['pågående'].includes(ao.status));

      return `<div class="ops-staff-row">
        <div class="ops-staff-avatar">${initials}</div>
        <div class="ops-staff-info">
          <div class="ops-staff-name">${esc(s.firstName)} ${esc(s.lastName)}</div>
          <div class="ops-staff-role">${role ? esc(role.label) : esc(s.role||'')}</div>
          ${stamped ? `<div class="ops-staff-status stamped">${ic('clock',10)} Inklockad${stampAo ? ` — ${esc(stampAo.id)}: ${esc(stampAo.title)}` : ''}</div>` : ''}
          ${nextJob && !stamped ? `<div class="ops-staff-status">${ic('arrow-right',10)} Nästa: ${esc(nextJob.title)}</div>` : ''}
        </div>
        <div class="ops-staff-stats">
          <div class="ops-staff-stat">
            <div class="ops-staff-stat-num" style="color:var(--sky);">${todayAOs.length}</div>
            <div class="ops-staff-stat-lbl">Idag</div>
          </div>
          <div class="ops-staff-stat">
            <div class="ops-staff-stat-num" style="color:${running.length>0?'var(--gr)':'var(--mt)'};">${running.length}</div>
            <div class="ops-staff-stat-lbl">Pågående</div>
          </div>
          <div class="ops-staff-stat">
            <div class="ops-staff-stat-num" style="color:${overdueN.length>0?'var(--rd)':'var(--mt)'};">${overdueN.length}</div>
            <div class="ops-staff-stat-lbl">Försenade</div>
          </div>
        </div>
      </div>`;
    }).join('');

    return `<div class="card" style="margin-bottom:12px;">
      <div class="card-header">
        <h3 class="ch3">${ic('users',14)} Personalstatus</h3>
        <span style="font-size:10px;color:var(--mt);">${activeStaff.length} aktiva</span>
      </div>
      <div class="card-body" style="padding:0;">${rows}</div>
    </div>`;
  },

  // ── Klara ej fakturerade ─────────────────────────────────────────────────

  _sectionReadyBill(aos) {
    const header = `<div class="card-header">
      <h3 class="ch3">${ic('receipt',14)} Klara — ej fakturerade</h3>
      <span style="font-size:10px;color:var(--mt);">${aos.length} st</span>
    </div>`;

    if (aos.length === 0) {
      return `<div class="card" style="margin-bottom:12px;">${header}
        <div class="card-body"><div class="empty" style="padding:8px 0;gap:4px;">${ic('check-circle',18)}<p style="font-size:11px;">Inga ordrar väntar på fakturering</p></div></div>
      </div>`;
    }

    const rows = aos.map(ao => {
      const cu = getCu(ao.customerId);
      const totalMins = this._totalMinutes(ao);
      const priceStr  = ao.priceType === 'fastpris' ? fkr(ao.fixedPrice) + ' (fast)' : totalMins > 0 ? `${Math.round(totalMins/60*10)/10} h reg.` : '—';
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--br);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:700;color:var(--navy);">${esc(ao.id)} · ${esc(ao.title)}</div>
          <div style="font-size:11px;color:var(--mt);">${cu ? esc(cu.name) : '—'} · ${ao.completedAt ? relDate(ao.completedAt) : '—'}</div>
        </div>
        <div style="font-size:11px;font-weight:700;color:var(--green);white-space:nowrap;">${priceStr}</div>
        <button class="btn bs bxs" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})" style="font-size:11px;padding:4px 8px;">Öppna</button>
        ${Auth.can('invoice_create') ? `<button class="btn bp bxs" onclick="OperationsPage._createInvoice('${ao.id}')" style="font-size:11px;padding:4px 8px;">Fakt.</button>` : ''}
      </div>`;
    }).join('');

    return `<div class="card" style="margin-bottom:12px;">${header}<div class="card-body" style="padding:0;">${rows}</div></div>`;
  },

  _totalMinutes(ao) {
    const ids = ao.timeEntries || [];
    return ids.reduce((sum, tid) => {
      const t = (state.timeEntries||[]).find(e => e.id === tid);
      return sum + (t ? (t.minutes||0) : 0);
    }, 0);
  },

  _createInvoice(aoId) {
    if (!Auth.require('invoice_create')) return;
    Router.showPage('pg-invoices');
    setTimeout(() => {
      if (typeof InvoicesPage !== 'undefined' && InvoicesPage.openCreate) {
        InvoicesPage.openCreate({ workOrderId: aoId });
      }
    }, 150);
  },

  // ── Kommande 7 dagar ─────────────────────────────────────────────────────

  _sectionUpcoming(all, today) {
    const days = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      days.push(d.toISOString().split('T')[0]);
    }

    const dayAOs = days.map(d => ({
      date: d,
      label: new Date(d + 'T12:00:00').toLocaleDateString('sv-SE', { weekday:'long', day:'numeric', month:'short' }),
      aos: all.filter(ao => ao.scheduledDate === d && !['klar','fakturerad','avbruten'].includes(ao.status))
    })).filter(g => g.aos.length > 0);

    const header = `<div class="card-header">
      <h3 class="ch3">${ic('calendar',14)} Kommande 7 dagar</h3>
      <span style="font-size:10px;color:var(--mt);">${dayAOs.reduce((s,g)=>s+g.aos.length,0)} planerade</span>
    </div>`;

    if (dayAOs.length === 0) {
      return `<div class="card" style="margin-bottom:12px;">${header}
        <div class="card-body"><div class="empty" style="padding:8px 0;gap:4px;">${ic('calendar',18)}<p style="font-size:11px;">Inga planerade jobb de närmaste 7 dagarna</p></div></div>
      </div>`;
    }

    const body = dayAOs.map(g => `
      <div style="padding:8px 14px 0;border-bottom:1px solid var(--br);">
        <div style="font-size:11px;font-weight:800;color:var(--blue);text-transform:capitalize;margin-bottom:6px;">${esc(g.label)} (${g.aos.length})</div>
        ${g.aos.map(ao => this._aoRow(ao, true)).join('')}
      </div>`).join('');

    return `<div class="card" style="margin-bottom:12px;">${header}<div class="card-body" style="padding:0;">${body}</div></div>`;
  },

  // ── AO-rad (återanvänd i alla sektioner) ─────────────────────────────────

  _sectionTime(todayAOs) {
    if (todayAOs.length === 0) return '';
    let totalEstMins = 0, totalActMins = 0, overPlanCnt = 0, noEstimateCnt = 0;
    todayAOs.forEach(ao => {
      const entries    = TimeService.getByAO(ao.id);
      const actualMins = TimeService.totalMinutes(entries);
      const estMins    = Math.round((ao.estimatedHours || 0) * 60);
      totalActMins += actualMins;
      if (estMins > 0) {
        totalEstMins += estMins;
        if (actualMins > estMins * 1.15) overPlanCnt++;
      } else {
        noEstimateCnt++;
      }
    });
    const fmtM = m => TimeService.fmtDuration(m);
    const overColor = overPlanCnt > 0 ? 'var(--rd)' : 'var(--gr)';
    return `
      <div class="card" style="margin-bottom:12px;">
        <div class="card-header"><h3>${ic('bar-chart-2',14)} Tid idag</h3></div>
        <div class="card-body" style="padding:10px 14px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;margin-bottom:10px;">
            <div class="dr"><span class="dk">Totalt planerat</span><span class="dv">${totalEstMins > 0 ? fmtM(totalEstMins) : '<span style="color:var(--mt);">—</span>'}</span></div>
            <div class="dr"><span class="dk">Totalt utfört</span><span class="dv">${totalActMins > 0 ? fmtM(totalActMins) : '<span style="color:var(--mt);">—</span>'}</span></div>
            <div class="dr"><span class="dk" style="color:${overColor};">Över plan (&gt;115%)</span><span class="dv" style="color:${overColor};font-weight:700;">${overPlanCnt}</span></div>
            <div class="dr"><span class="dk">Utan tidsestimat</span><span class="dv" style="color:${noEstimateCnt>0?'var(--orange)':'var(--gr)'};font-weight:700;">${noEstimateCnt}</span></div>
          </div>
        </div>
      </div>`;
  },

  // ── Serviceintervall som kräver uppmärksamhet ───────────────────────────

  _sectionServiceIntervals(today) {
    if (typeof ServiceIntervalService === 'undefined') return '';
    const SIS   = ServiceIntervalService;
    const items = SIS.getAllNeedingAttention();
    if (items.length === 0) return '';

    const dueToday    = items.filter(i => i.interval.nextDue === today);
    const overdue     = items.filter(i => i.status === 'overdue');
    const approaching = items.filter(i => i.status === 'due_soon' || i.status === 'approaching');

    const renderRow = (item) => {
      const { interval: si } = item;
      const propName  = item.propertyName || '—';
      const propAddr  = item.address || '';
      const respStaff = si.responsibleStaffId ? getStaff(si.responsibleStaffId) : null;
      const respName  = respStaff
        ? `${respStaff.firstName}${respStaff.lastName ? ' ' + respStaff.lastName : ''}`.trim()
        : 'Ej tilldelad';
      return `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 14px;border-bottom:1px solid var(--br);cursor:pointer;"
          onclick="Router.showPage('pg-obj-detail',{propId:'${item.propertyId}',tab:'service'})">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px;">
            <span style="font-size:12px;font-weight:700;color:var(--navy);">${esc(si.title)}</span>
            ${SIS.statusBadge(si)}
          </div>
          <div style="font-size:11px;color:var(--mt);">${esc(propName)}${propAddr ? ' · ' + esc(propAddr) : ''}</div>
          <div style="font-size:11px;color:var(--mt);display:flex;gap:8px;flex-wrap:wrap;">
            ${si.nextDue ? `<span>${ic('calendar',10)} ${fmtDate(si.nextDue)}</span>` : ''}
            <span>${ic('user',10)} ${esc(respName)}</span>
          </div>
        </div>
        <span style="color:var(--mt);flex-shrink:0;">${ic('chevron-right',14)}</span>
      </div>`;
    };

    let html = `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--rd);">
      <div class="card-header">
        <h3 class="ch3" style="color:var(--rd);">${ic('tool',14)} Serviceintervall kräver åtgärd</h3>
        <span class="bdg bdg-red">${items.length}</span>
      </div>
      <div class="card-body" style="padding:0;">`;

    if (dueToday.length > 0) {
      html += `<div style="padding:6px 14px 3px;font-size:11px;font-weight:700;color:var(--rd);border-bottom:1px solid var(--br);">${ic('alert-circle',11)} Förfaller idag</div>`;
      html += dueToday.map(renderRow).join('');
    }
    if (overdue.length > 0) {
      html += `<div style="padding:6px 14px 3px;font-size:11px;font-weight:700;color:var(--rd);border-bottom:1px solid var(--br);">${ic('alert-triangle',11)} Förfallna</div>`;
      html += overdue.map(renderRow).join('');
    }
    if (approaching.length > 0) {
      html += `<div style="padding:6px 14px 3px;font-size:11px;font-weight:700;color:var(--or);border-bottom:1px solid var(--br);">${ic('clock',11)} Förfaller snart</div>`;
      html += approaching.map(renderRow).join('');
    }

    return html + '</div></div>';
  },

  // ── AO-rad ───────────────────────────────────────────────────────────────

  _aoRow(ao, compact = false) {
    const cu        = getCu(ao.customerId);
    const staffHtml = (ao.staff || []).map(id => {
      const s = getStaff(id);
      return s ? `<span style="font-size:10px;background:var(--lbl);color:var(--navy);border-radius:10px;padding:1px 5px;">${esc(s.firstName)}</span>` : '';
    }).join(' ');

    const cl    = ao.checklist || [];
    const done  = cl.filter(c => c.done).length;
    const clStr = cl.length > 0 ? `${done}/${cl.length} ✓` : '';

    const timeStr = (ao.scheduledStart && ao.scheduledEnd)
      ? `${ao.scheduledStart}–${ao.scheduledEnd}`
      : ao.scheduledStart ? ao.scheduledStart : '';

    const timeEntries = TimeService.getByAO(ao.id);
    const actualMins  = TimeService.totalMinutes(timeEntries);
    const estMins     = Math.round((ao.estimatedHours || 0) * 60);
    const timePct     = estMins > 0 ? Math.round(actualMins / estMins * 100) : null;
    const timeColor   = timePct === null ? 'var(--mt)' : timePct <= 100 ? 'var(--gr)' : timePct <= 115 ? 'var(--orange)' : 'var(--rd)';
    const overPlan    = timePct !== null && timePct > 115;
    const fmtM        = m => TimeService.fmtDuration(m);
    const timeChip    = estMins > 0
      ? `<span style="font-size:10px;color:${timeColor};font-weight:700;">${ic('clock',9)} ${fmtM(estMins)}${actualMins > 0 ? ' / ' + fmtM(actualMins) : ''}${overPlan ? ' ⚠' : ''}</span>`
      : (actualMins > 0 ? `<span style="font-size:10px;color:var(--mt);">${ic('clock',9)} ${fmtM(actualMins)}</span>` : '');

    return `<div style="display:flex;align-items:flex-start;gap:8px;padding:${compact?'6':'8'}px 14px;border-bottom:1px solid var(--br);cursor:pointer;"
        onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px;">
          <span style="font-size:11px;font-weight:700;color:var(--mt);">${esc(ao.id)}</span>
          <span style="font-size:12px;font-weight:700;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">${esc(ao.title)}</span>
          ${sbdg(ao.status)} ${pbdg(ao.priority)}
          ${timeChip}
        </div>
        <div style="font-size:11px;color:var(--mt);">
          ${cu ? esc(cu.name) + ' · ' : ''}${esc(ao.address||'')}
          ${timeStr ? ` · ${timeStr}` : ''}
          ${clStr ? ` · ${clStr}` : ''}
        </div>
        ${ao.substatus?`<div style="margin-top:2px;"><span style="font-size:10px;padding:2px 7px;background:rgba(251,191,36,.1);color:var(--or);border-radius:7px;border:1px solid rgba(251,191,36,.25);">${({inväntar_material:'⏳ Inväntar material',inväntar_kund:'🔔 Inväntar kund',pausad:'⏸ Pausad',behöver_återbesök:'🔄 Återbesök',blockerad:'🚫 Blockerad'}[ao.substatus]||ao.substatus)}</span></div>`:''}
        ${staffHtml ? `<div style="margin-top:3px;display:flex;gap:3px;flex-wrap:wrap;">${staffHtml}</div>` : `<div style="margin-top:3px;font-size:11px;color:var(--rd);font-weight:700;">${ic('user-x',10)} Ingen personal tilldelad</div>`}
        ${(()=>{
          if (!ao.propertyId || typeof PropertyContactService === 'undefined') return '';
          const primary = PropertyContactService.summaryList(ao.propertyId).find(c => c.isPrimary);
          if (!primary) return '';
          return `<div style="margin-top:3px;font-size:10px;color:var(--mt);">${ic('user',9)} <strong>${esc(primary.personName)}</strong>${primary.roleName?' · '+esc(primary.roleName):''}${primary.phone?' · '+esc(primary.phone):''}</div>`;
        })()}
      </div>
      <span style="color:var(--mt);flex-shrink:0;">${ic('chevron-right',14)}</span>
    </div>`;
  }
};
