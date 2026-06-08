/**
 * OperationsPage — Dagens drift (Fas 4B)
 * Chefsvy: KPI, personalstatus, försenade/akuta, klara ej fakturerade, kommande
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
      this._sectionToday(todayAOs, today) +
      this._sectionTime(todayAOs) +
      this._sectionAttention(overdue, urgent, noStaff, withNotes) +
      this._sectionOngoingNoDate(ongoingNoDate) +
      this._sectionStaff(all, today) +
      this._sectionReadyBill(readyBill) +
      this._sectionUpcoming(all, today);
  },

  // ── KPI row ──────────────────────────────────────────────────────────────

  _kpiRow(todayCnt, ongoingCnt, overdueCnt, urgentCnt, noStaffCnt, clockedCnt, billCnt, notesCnt) {
    const kpi = (val, label, color, icon, page, filter) => {
      const onclick = page ? `Router.showPage('${page}'${filter ? `,{filter:'${filter}'}` : ''})` : '';
      return `<div class="kpi-card" style="border-top:3px solid var(--${color});cursor:${onclick?'pointer':'default'};" ${onclick?`onclick="${onclick}"`:''}">
        <div class="kpi-val" style="color:var(--${color});">${val}</div>
        <div class="kpi-lbl">${ic(icon,11)} ${label}</div>
      </div>`;
    };
    return `<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:12px;">
      ${kpi(todayCnt,  'Planerade idag',      'blue',   'calendar',       'pg-operations', 'today')}
      ${kpi(ongoingCnt,'Pågående',            'green',  'play-circle',    'pg-operations', 'ongoing')}
      ${kpi(overdueCnt,'Försenade',           'rd',     'alert-triangle', 'pg-operations', 'overdue')}
      ${kpi(urgentCnt, 'Akuta',               'rd',     'alert-circle',   'pg-operations', 'urgent')}
      ${kpi(noStaffCnt,'Saknar personal',     'orange', 'user-x',         'pg-operations', 'nostaff')}
      ${kpi(clockedCnt,'Inklockade',          'blue',   'clock',          null, null)}
      ${kpi(billCnt,   'Klara ej fakt.',      'orange', 'receipt',        'pg-operations', 'bill')}
      ${kpi(notesCnt,  'Med anteckningar',    'mt',     'file-text',      'pg-operations', 'notes')}
    </div>`;
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
    if (total === 0) return `<div class="card" style="margin-bottom:12px;border-left:3px solid var(--green);">
      <div class="card-body" style="padding:12px 14px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:22px;">${ic('check-circle',22)}</span>
        <span style="font-size:13px;font-weight:700;color:var(--green);">Inget kräver omedelbar uppmärksamhet</span>
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
      <div style="font-size:11px;font-weight:800;color:var(--${color});text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">${ic(icon,11)} ${label} (${aos.length})</div>
      ${aos.map(ao => this._aoRow(ao, true)).join('')}
    </div>`;
  },

  // ── Pågående utan datum ───────────────────────────────────────────────────

  _sectionOngoingNoDate(aos) {
    if (!aos.length) return '';
    const rows = aos.map(ao => {
      const subLabels = {inväntar_material:'⏳ Inväntar material',inväntar_kund:'🔔 Inväntar kund',pausad:'⏸ Pausad',behöver_återbesök:'🔄 Återbesök',blockerad:'🚫 Blockerad'};
      const subBadge = ao.substatus ? `<span style="font-size:9px;padding:1px 6px;background:rgba(251,191,36,.12);color:var(--or);border-radius:7px;border:1px solid rgba(251,191,36,.25);">${subLabels[ao.substatus]||ao.substatus}</span>` : '';
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

      return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--br);">
        <div style="width:34px;height:34px;border-radius:50%;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0;">${initials}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;color:var(--navy);">${esc(s.firstName)} ${esc(s.lastName)}</div>
          <div style="font-size:11px;color:var(--mt);">${role ? esc(role.label) : esc(s.role||'')}</div>
          ${stamped ? `<div style="font-size:11px;font-weight:700;color:var(--green);margin-top:2px;">${ic('clock',10)} Inklockad${stampAo ? ` — ${esc(stampAo.id)}: ${esc(stampAo.title)}` : ''}</div>` : ''}
          ${nextJob && !stamped ? `<div style="font-size:11px;color:var(--mt);margin-top:2px;">${ic('arrow-right',10)} Nästa: ${esc(nextJob.title)}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <div style="text-align:center;">
            <div style="font-size:14px;font-weight:800;color:var(--blue);">${todayAOs.length}</div>
            <div style="font-size:9px;color:var(--mt);">Idag</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:14px;font-weight:800;color:${running.length>0?'var(--green)':'var(--mt)'};">${running.length}</div>
            <div style="font-size:9px;color:var(--mt);">Pågående</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:14px;font-weight:800;color:${overdueN.length>0?'var(--rd)':'var(--mt)'};">${overdueN.length}</div>
            <div style="font-size:9px;color:var(--mt);">Försenade</div>
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

  _aoRow(ao, compact = false) {
    const cu      = getCu(ao.customerId);
    const staffHtml = (ao.staff || []).map(id => {
      const s = getStaff(id);
      return s ? `<span style="font-size:10px;background:var(--lbl);color:var(--navy);border-radius:10px;padding:1px 5px;">${esc(s.firstName)}</span>` : '';
    }).join(' ');

    const cl = ao.checklist || [];
    const done = cl.filter(c => c.done).length;
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
      ? `<span style="font-size:9px;color:${timeColor};font-weight:700;">${ic('clock',8)} ${fmtM(estMins)}${actualMins > 0 ? ' / ' + fmtM(actualMins) : ''}${overPlan ? ' ⚠' : ''}</span>`
      : (actualMins > 0 ? `<span style="font-size:9px;color:var(--mt);">${ic('clock',8)} ${fmtM(actualMins)}</span>` : '');

    return `<div style="display:flex;align-items:flex-start;gap:8px;padding:${compact?'6':'8'}px 14px;border-bottom:1px solid var(--br);cursor:pointer;"
        onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px;">
          <span style="font-size:10px;font-weight:700;color:var(--mt);">${esc(ao.id)}</span>
          <span style="font-size:12px;font-weight:700;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">${esc(ao.title)}</span>
          ${sbdg(ao.status)} ${pbdg(ao.priority)}
          ${timeChip}
        </div>
        <div style="font-size:11px;color:var(--mt);">
          ${cu ? esc(cu.name) + ' · ' : ''}${esc(ao.address||'')}
          ${timeStr ? ` · ${timeStr}` : ''}
          ${clStr ? ` · ${clStr}` : ''}
        </div>
        ${ao.substatus?`<div style="margin-top:2px;"><span style="font-size:9px;padding:1px 6px;background:rgba(251,191,36,.1);color:var(--or);border-radius:7px;border:1px solid rgba(251,191,36,.25);">${({inväntar_material:'⏳ Inväntar material',inväntar_kund:'🔔 Inväntar kund',pausad:'⏸ Pausad',behöver_återbesök:'🔄 Återbesök',blockerad:'🚫 Blockerad'}[ao.substatus]||ao.substatus)}</span></div>`:''}
        ${staffHtml ? `<div style="margin-top:3px;display:flex;gap:3px;flex-wrap:wrap;">${staffHtml}</div>` : `<div style="margin-top:3px;font-size:10px;color:var(--rd);font-weight:700;">${ic('user-x',10)} Ingen personal tilldelad</div>`}
      </div>
      <span style="color:var(--mt);flex-shrink:0;">${ic('chevron-right',14)}</span>
    </div>`;
  }
};
