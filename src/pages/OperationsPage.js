/**
 * OperationsPage — Dagens drift (Fas 4B, omarbetad QA 2026-11-26)
 * Chefsvy: vad händer idag, vem gör vad, vad är försenat/akut/otilldelat.
 *
 * Nyckeltalen överst (samma dt-tile som dashboarden) är också väljare för
 * arbetsorderlistan under dem — siffran på rutan är exakt antalet rader man
 * får när man trycker på den. Dagens jobb grupperas per status. Till höger:
 * personal (vem arbetar med vad, nästa jobb), tid idag och öppna per
 * kategori. Därunder serviceintervall som kräver åtgärd och kommande 7 dagar.
 * Urvalen är oförändrade jämfört med tidigare version (försenad =
 * WorkOrderService.isOverdue, otilldelad = utan personal och inte i poolen,
 * ej fakturerad = klar utan fakturaunderlag).
 */
const OperationsPage = {

  _focus: 'today',

  FOCUS: {
    today:   { label: 'Jobb idag',             title: 'Dagens arbetsorder',            icon: 'calendar',       tone: '',       ao: 'idag' },
    ongoing: { label: 'Pågående',              title: 'Pågående arbetsorder',          icon: 'play-circle',    tone: '',       ao: 'pågående' },
    overdue: { label: 'Försenade',             title: 'Försenade arbetsorder',         icon: 'clock',          tone: 'danger', ao: 'forsenad' },
    urgent:  { label: 'Akuta',                 title: 'Akuta arbetsorder',             icon: 'alert-triangle', tone: 'danger', ao: 'akut' },
    noStaff: { label: 'Otilldelade',           title: 'Saknar personal',               icon: 'user-x',         tone: 'warn',   ao: 'unassigned' },
    bill:    { label: 'Klara, ej fakturerade', title: 'Klara — ej fakturerade',        icon: 'receipt',        tone: 'info',   ao: 'readyForInvoice' },
    notes:   { label: 'Med anteckningar',      title: 'Aktiva med anteckningar',       icon: 'file-text',      tone: '',       ao: null }
  },

  setFocus(k) {
    if (!this.FOCUS[k]) return;
    this._focus = k;
    this.render();
    const m = document.getElementById('ops2-main');
    if (m && window.innerWidth < 1024 && m.scrollIntoView) m.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },

  /* Alla urval på ett ställe (samma definitioner som tidigare version). */
  _sets(today) {
    const all   = (state.workOrders || []).filter(ao => !ao.archived && !ao.deleted);
    const alive = ao => !['klar', 'fakturerad', 'avbruten'].includes(ao.status);
    const byTime = (a, b) => (a.scheduledStart || '99:99').localeCompare(b.scheduledStart || '99:99');
    const byDate = (a, b) => String(a.scheduledDate || '9999').localeCompare(String(b.scheduledDate || '9999')) || byTime(a, b);
    return {
      all, alive,
      today:   all.filter(ao => ao.scheduledDate === today && alive(ao)).sort(byTime),
      ongoing: all.filter(ao => ao.status === 'pågående').sort(byDate),
      overdue: all.filter(ao => ao.scheduledDate && ao.scheduledDate < today && alive(ao) && ao.status !== 'pool').sort(byDate),
      urgent:  all.filter(ao => ao.priority === 'akut' && alive(ao)).sort(byDate),
      noStaff: all.filter(ao => (ao.staff || []).length === 0 && alive(ao) && !['pool', 'avbruten'].includes(ao.status)).sort(byDate),
      bill:    all.filter(ao => ao.status === 'klar' && !ao.invoiceId).sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || ''))),
      notes:   all.filter(ao => alive(ao) && (ao.notes || []).length > 0).sort(byDate)
    };
  },

  render() {
    const el = document.getElementById('pg-operations-content');
    if (!el) return;
    const today = tdy();
    const S = this._sets(today);
    if (!this.FOCUS[this._focus]) this._focus = 'today';
    const focus = this._focus;
    const now = new Date();
    const dateStr = cap(now.toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    const timeStr = now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    const openN = S.all.filter(S.alive).length;

    const tile = (k) => {
      const f = this.FOCUS[k], n = S[k].length;
      return `<button type="button" class="dt-tile ops2-tile${f.tone && n ? ' tone-' + f.tone : ''}${focus === k ? ' is-on' : ''}" data-k="${k}" aria-pressed="${focus === k}" onclick="OperationsPage.setFocus(this.dataset.k)">
        <span class="dt-tile-ico">${ic(f.icon, 16)}</span>
        <span class="dt-tile-n">${n}</span>
        <span class="dt-tile-l">${f.label}</span>
      </button>`;
    };

    const actions = [
      `<button type="button" class="btn bs" onclick="Router.showPage('pg-ao')">${ic('clipboard-list', 15)} Arbetsorder</button>`,
      Auth.can('ao_create') ? `<button type="button" class="btn bp" onclick="Router.showPage('pg-ao');setTimeout(()=>WorkOrdersPage.openCreate(),0)">${ic('plus', 15)} Ny arbetsorder</button>` : ''
    ].join('');

    el.innerHTML = `<div class="ops2">
      <div class="ops2-head">
        <div>
          <div class="ops2-date">${esc(dateStr)}</div>
          <div class="ops2-sub">${openN} öppna arbetsorder · uppdaterad ${esc(timeStr)}</div>
        </div>
        <div class="ops2-actions">${actions}</div>
      </div>
      <div class="dt-tiles ops2-tiles" role="group" aria-label="Välj lista">
        ${['today', 'ongoing', 'overdue', 'urgent', 'noStaff', 'bill'].map(tile).join('')}
      </div>
      <div class="ops2-body">
        <div class="ops2-col">
          ${this._mainPanel(S, focus, today)}
          ${this._sectionUpcoming(S.all, today)}
        </div>
        <div class="ops2-col">
          ${this._sectionStaff(S, today)}
          ${this._sectionTime(S.today)}
          ${this._sectionCategories(S.all)}
          ${this._sectionServiceIntervals(today)}
        </div>
      </div>
    </div>`;
  },

  /* ── Huvudlistan (styrs av nyckeltalen) ───────────────────────────── */
  _mainPanel(S, focus, today) {
    const f = this.FOCUS[focus];
    const list = S[focus];
    const link = f.ao ? `<button type="button" class="btn bghost bsm" data-f="${esc(f.ao)}" onclick="Router.showPage('pg-ao',{filter:this.dataset.f})">${ic('external-link', 13)} Visa i arbetsorderlistan</button>` : '';
    let body;
    if (!list.length) {
      const msg = { today: 'Inga arbetsorder planerade idag.', ongoing: 'Ingen arbetsorder är pågående just nu.', overdue: 'Inget är försenat.',
        urgent: 'Inga akuta arbetsorder.', noStaff: 'Alla aktiva arbetsorder har personal.', bill: 'Inga klara arbetsorder väntar på fakturering.',
        notes: 'Inga aktiva arbetsorder har anteckningar.' }[focus];
      body = `<div class="ops2-empty">${ic(focus === 'today' ? 'calendar' : 'check-circle', 18)}<span>${msg}</span></div>`;
    } else if (focus === 'today') {
      const groups = [['pågående', 'arbete pågår'], ['nytt', 'ej påbörjade'], ['planerad', 'ej påbörjade'], ['pool', 'ingen har tagit jobbet']];
      const known = groups.map(g => g[0]);
      body = groups.map(([st, lbl]) => {
        const g = list.filter(ao => ao.status === st);
        return g.length ? `<div class="ops2-grp" data-status="${esc(st)}"><div class="ops2-grp-h">${sbdg(st)}<span class="ops2-grp-d">${lbl}</span><span class="ops2-grp-n">${g.length}</span></div>${g.map(ao => this._aoRow(ao, { today, focus })).join('')}</div>` : '';
      }).join('') + (() => {
        const other = list.filter(ao => !known.includes(ao.status));
        return other.length ? `<div class="ops2-grp"><div class="ops2-grp-h"><span>Övriga</span><span class="ops2-grp-n">${other.length}</span></div>${other.map(ao => this._aoRow(ao, { today, focus })).join('')}</div>` : '';
      })();
    } else {
      body = list.map(ao => this._aoRow(ao, { today, focus })).join('');
    }
    const notesN = S.notes.length;
    const chips = `<div class="ops2-chips">${UiKit.chip('Med anteckningar', "OperationsPage.setFocus('notes')", { on: focus === 'notes', n: notesN, icon: 'file-text' })}${focus !== 'today' ? `<button type="button" class="btn bghost bsm" onclick="OperationsPage.setFocus('today')">${ic('x', 13)} Tillbaka till idag</button>` : ''}</div>`;
    return `<section class="dt-panel ops2-main" id="ops2-main" aria-labelledby="ops2-main-h">
      <div class="dt-panel-h"><h3 id="ops2-main-h">${ic(f.icon, 15)} ${esc(f.title)} <span class="ops2-n" id="ops2-main-n">${list.length}</span></h3>${link}</div>
      ${chips}
      <div class="ops2-list" id="ops2-list">${body}</div>
    </section>`;
  },

  // ── Personal: vem gör vad ────────────────────────────────────────────
  _sectionStaff(S, today) {
    const activeStaff = (state.staff || []).filter(s => s.active);
    if (activeStaff.length === 0) return '';
    const roleOf = s => (state.roles || []).find(r => r.id === s.role);
    const isField = s => { const r = roleOf(s); const p = r && Array.isArray(r.permissions) ? r.permissions : []; return p.includes('ao_time') || p.includes('all'); };
    const rows = activeStaff.map(s => {
      const mine    = S.all.filter(ao => (ao.staff || []).includes(s.id) && S.alive(ao));
      const todays  = mine.filter(ao => ao.scheduledDate === today).sort((a, b) => (a.scheduledStart || '99').localeCompare(b.scheduledStart || '99'));
      const running = mine.filter(ao => ao.status === 'pågående');
      const late    = mine.filter(ao => ao.scheduledDate && ao.scheduledDate < today && ao.status !== 'pool');
      const isMe    = state.currentUser && state.currentUser.id === s.id;
      const stamped = isMe && state.stampActive;
      const stampAo = stamped && state.stampAoId ? getAO(state.stampAoId) : null;
      const next    = todays.find(ao => ao.status !== 'pågående');
      return { s, mine, todays, running, late, stamped, stampAo, next };
    });
    const busy = rows.filter(r => r.mine.length || r.stamped)
      .sort((a, b) => (b.running.length > 0) - (a.running.length > 0) || b.todays.length - a.todays.length || UiKit.staffName(a.s).localeCompare(UiKit.staffName(b.s), 'sv'));
    const free = rows.filter(r => !r.mine.length && !r.stamped && isField(r.s));
    const aoTxt = ao => `${esc(WorkOrderService.displayNumberOrPending(ao))} · ${esc(ao.title)}`;
    const li = (r) => {
      let now;
      if (r.stamped) now = `<span class="ops2-p-now is-on">${ic('clock', 12)}<span>Instämplad (du)${r.stampAo ? ' · ' + aoTxt(r.stampAo) : ''}</span></span>`;
      else if (r.running.length) now = `<span class="ops2-p-now is-run">${ic('play-circle', 12)}<span>Arbetar med ${aoTxt(r.running[0])}${r.running.length > 1 ? ' (+' + (r.running.length - 1) + ')' : ''}</span></span>`;
      else if (r.next) now = `<span class="ops2-p-now">${ic('arrow-right', 12)}<span>Nästa${r.next.scheduledStart ? ' ' + esc(r.next.scheduledStart) : ''}: ${aoTxt(r.next)}</span></span>`;
      else now = `<span class="ops2-p-now is-idle">${ic('calendar', 12)}<span>Inget planerat idag</span></span>`;
      return `<li class="ops2-p">
        ${UiKit.avatar(r.s, 30)}
        <div class="ops2-p-m">
          <div class="ops2-p-name">${esc(UiKit.staffName(r.s))}<span class="ops2-p-role">${esc((roleOf(r.s) || {}).label || r.s.role || '')}</span></div>
          ${now}
        </div>
        <div class="ops2-p-n">
          <span title="Jobb idag"><b>${r.todays.length}</b> idag</span>
          ${r.late.length ? `<span class="is-late" title="Försenade">${r.late.length} försenad${r.late.length > 1 ? 'e' : ''}</span>` : ''}
        </div>
      </li>`;
    };
    return `<section class="dt-panel ops2-staff" aria-labelledby="ops2-staff-h">
      <div class="dt-panel-h"><h3 id="ops2-staff-h">${ic('users', 15)} Personal idag</h3><span class="ops2-meta">${busy.length} med öppna jobb</span></div>
      ${busy.length ? `<ul class="ops2-people">${busy.map(li).join('')}</ul>` : `<div class="ops2-empty">${ic('users', 18)}<span>Ingen personal har öppna jobb.</span></div>`}
      ${free.length ? `<div class="ops2-free">${ic('user-check', 13)}<span><b>Utan öppna jobb:</b> ${free.map(r => esc(UiKit.staffName(r.s))).join(', ')}</span></div>` : ''}
    </section>`;
  },

  // ── Tid idag ─────────────────────────────────────────────────────────
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
    return `<section class="dt-panel ops2-time" aria-labelledby="ops2-time-h">
      <div class="dt-panel-h"><h3 id="ops2-time-h">${ic('bar-chart-2', 15)} Tid på dagens jobb</h3></div>
      <dl class="ops2-facts">
        <div><dt>Planerat</dt><dd>${totalEstMins > 0 ? this._h(totalEstMins) : '—'}</dd></div>
        <div><dt>Registrerat</dt><dd>${totalActMins > 0 ? this._h(totalActMins) : '—'}</dd></div>
        <div class="${overPlanCnt ? 'is-danger' : ''}"><dt>Över plan (&gt; 115 %)</dt><dd>${overPlanCnt}</dd></div>
        <div class="${noEstimateCnt ? 'is-warn' : ''}"><dt>Utan tidsestimat</dt><dd>${noEstimateCnt}</dd></div>
      </dl>
    </section>`;
  },

  /* Svensk decimal i timmar (komponentstandard §10). */
  _h(min) {
    const h = Math.round((Number(min) || 0) / 60 * 100) / 100;
    return h.toLocaleString('sv-SE', { maximumFractionDigits: 2 }) + ' h';
  },

  // ── Öppna per kategori ───────────────────────────────────────────────
  _sectionCategories(all) {
    const isOpen = ao => !['klar', 'fakturerad', 'avbruten'].includes(ao.status);
    const openAos = all.filter(isOpen);
    if (!openAos.length) return '';
    const rows = AO_CATEGORIES
      .map(c => {
        const aos    = openAos.filter(ao => (ao.category || 'ovrigt') === c.slug);
        const urgent = aos.filter(ao => ao.priority === 'akut').length;
        return { cat: c, count: aos.length, urgent };
      })
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count);
    const max = Math.max(1, ...rows.map(r => r.count));
    return `<section class="dt-panel ops2-cats" aria-labelledby="ops2-cats-h">
      <div class="dt-panel-h"><h3 id="ops2-cats-h">${ic('layers', 15)} Öppna per kategori</h3><span class="ops2-meta">${openAos.length} öppna</span></div>
      <ul class="ops2-catlist">
        ${rows.map(({ cat: c, count, urgent }) => `<li>
          <button type="button" class="ops2-cat" onclick="Router.showPage('pg-ao')">
            <span class="ops2-cat-l">${catBadge(c.slug)}</span>
            <span class="ops2-cat-bar" aria-hidden="true"><i style="width:${Math.round(count / max * 100)}%"></i></span>
            ${urgent > 0 ? `<span class="bdg bdg-red">${ic('alert-triangle', 11)}${urgent} akut${urgent > 1 ? 'a' : ''}</span>` : ''}
            <span class="ops2-cat-n">${count}</span>
          </button>
        </li>`).join('')}
      </ul>
    </section>`;
  },

  // ── Serviceintervall som kräver åtgärd ───────────────────────────────
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
      const respName  = respStaff ? `${respStaff.firstName}${respStaff.lastName ? ' ' + respStaff.lastName : ''}`.trim() : 'Ej tilldelad';
      return `<div class="ops2-row ops2-si" role="button" tabindex="0" data-prop="${esc(item.propertyId)}"
          onclick="Router.showPage('pg-obj-detail',{propId:this.dataset.prop,tab:'service'})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
        <span class="ops2-row-m">
          <span class="ops2-row-title"><span>${esc(si.title)}</span> ${SIS.statusBadge(si)}</span>
          <span class="ops2-row-sub">${esc(propName)}${propAddr ? ' · ' + esc(propAddr) : ''}</span>
          <span class="ops2-row-flags">
            ${si.nextDue ? `<span class="ops2-flag">${ic('calendar', 12)}<span>${esc(fmtDate(si.nextDue))}</span></span>` : ''}
            <span class="ops2-flag">${ic('user', 12)}<span>${esc(respName)}</span></span>
          </span>
        </span>
        <span class="ops2-row-chev" aria-hidden="true">${ic('chevron-right', 16)}</span>
      </div>`;
    };
    const grp = (lbl, icon, tone, list) => list.length
      ? `<div class="ops2-grp"><div class="ops2-grp-h tone-${tone}">${ic(icon, 13)}<span>${lbl}</span><span class="ops2-grp-n">${list.length}</span></div>${list.map(renderRow).join('')}</div>` : '';
    return `<section class="dt-panel ops2-si-panel" aria-labelledby="ops2-si-h">
      <div class="dt-panel-h"><h3 id="ops2-si-h">${ic('wrench', 15)} Serviceintervall att åtgärda</h3><span class="bdg bdg-red">${items.length}</span></div>
      ${grp('Förfaller idag', 'alert-circle', 'danger', dueToday)}
      ${grp('Förfallna', 'alert-triangle', 'danger', overdue)}
      ${grp('Förfaller snart', 'clock', 'warn', approaching)}
    </section>`;
  },

  // ── Kommande 7 dagar ─────────────────────────────────────────────────
  _sectionUpcoming(all, today) {
    /* Lokala datum (UiKit.addDays) — tidigare toISOString(), som gav fel
       dag mellan midnatt och 01/02 svensk tid. */
    const days = [];
    for (let i = 1; i <= 7; i++) days.push(UiKit.addDays(today, i));
    const dayAOs = days.map(d => ({
      date: d,
      aos: all.filter(ao => ao.scheduledDate === d && !['klar', 'fakturerad', 'avbruten'].includes(ao.status))
        .sort((a, b) => (a.scheduledStart || '99').localeCompare(b.scheduledStart || '99'))
    })).filter(g => g.aos.length > 0);
    const total = dayAOs.reduce((s, g) => s + g.aos.length, 0);
    const body = dayAOs.length
      ? dayAOs.map(g => `<div class="ops2-grp"><div class="ops2-grp-h"><span>${esc(cap(UiKit.dayLabel(g.date, today)))}</span><span class="ops2-grp-d">${esc(fmtDate(g.date))}</span><span class="ops2-grp-n">${g.aos.length}</span></div>
          ${g.aos.map(ao => this._aoRow(ao, { today, focus: 'upcoming', compact: true })).join('')}</div>`).join('')
      : `<div class="ops2-empty">${ic('calendar', 18)}<span>Inga planerade jobb de närmaste 7 dagarna.</span></div>`;
    return `<section class="dt-panel ops2-up" aria-labelledby="ops2-up-h">
      <div class="dt-panel-h"><h3 id="ops2-up-h">${ic('calendar-check', 15)} Kommande 7 dagar</h3><span class="ops2-meta">${total} planerade</span></div>
      ${body}
    </section>`;
  },

  // ── Klara ej fakturerade: hjälpare (oförändrade) ─────────────────────
  _totalMinutes(ao) {
    const ids = ao.timeEntries || [];
    return ids.reduce((sum, tid) => {
      const t = (state.timeEntries || []).find(e => e.id === tid);
      return sum + (t ? (t.minutes || 0) : 0);
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

  _subLabel(s) {
    const m = { inväntar_material: ['package', 'Inväntar material'], inväntar_kund: ['bell', 'Inväntar kund'], pausad: ['pause-circle', 'Pausad'],
      behöver_återbesök: ['rotate-ccw', 'Behöver återbesök'], blockerad: ['alert-circle', 'Blockerad'] };
    const x = m[s];
    return x ? `${ic(x[0], 12)}<span>${x[1]}</span>` : `<span>${esc(s)}</span>`;
  },

  // ── AO-rad (återanvänds i alla listor) ───────────────────────────────
  _aoRow(ao, o) {
    o = o || {};
    const today = o.today || tdy();
    const cu = getCu(ao.customerId);
    const addr = AddressService.displayAddress(ao);
    const cl = ao.checklist || [];
    const done = cl.filter(c => c.done).length;
    const entries = TimeService.getByAO(ao.id);
    const actualMins = TimeService.totalMinutes(entries);
    const estMins = Math.round((ao.estimatedHours || 0) * 60);
    const timePct = estMins > 0 ? Math.round(actualMins / estMins * 100) : null;
    const overPlan = timePct !== null && timePct > 115;

    // Tidskolumn: klockslag idag, annars dag.
    let when;
    if (o.focus === 'bill') when = ao.completedAt ? esc(relDate(ao.completedAt)) : '—';
    else if (ao.scheduledDate === today || o.focus === 'upcoming') when = ao.scheduledStart ? esc(ao.scheduledStart) + (ao.scheduledEnd ? `<small>–${esc(ao.scheduledEnd)}</small>` : '') : (ao.scheduledDate === today ? 'Idag' : '—');
    else if (ao.scheduledDate) when = esc(cap(UiKit.dayLabel(ao.scheduledDate, today))) + (ao.scheduledStart ? `<small>${esc(ao.scheduledStart)}</small>` : '');
    else when = '<span class="ops2-muted">Inget datum</span>';

    const flags = [];
    if (ao.substatus) flags.push(`<span class="ops2-flag is-warn">${this._subLabel(ao.substatus)}</span>`);
    if (cl.length) flags.push(`<span class="ops2-flag">${ic('check-square', 12)}<span>${done} av ${cl.length}</span></span>`);
    if (estMins > 0 || actualMins > 0) flags.push(`<span class="ops2-flag${overPlan ? ' is-danger' : ''}">${ic('clock', 12)}<span>${estMins > 0 ? this._h(estMins) + ' plan' : ''}${estMins > 0 && actualMins > 0 ? ' · ' : ''}${actualMins > 0 ? this._h(actualMins) + ' reg.' : ''}</span></span>`);
    if (o.focus === 'bill') {
      const totalMins = this._totalMinutes(ao);
      const priceStr = ao.priceType === 'fastpris' ? fkr(ao.fixedPrice) + ' exkl. moms (fast pris)' : totalMins > 0 ? this._h(totalMins) + ' registrerat' : '';
      if (priceStr) flags.push(`<span class="ops2-flag">${ic('receipt', 12)}<span>${esc(priceStr)}</span></span>`);
    }
    if (!o.compact && ao.propertyId && typeof PropertyContactService !== 'undefined') {
      const primary = PropertyContactService.summaryList(ao.propertyId).find(c => c.isPrimary);
      if (primary) flags.push(`<span class="ops2-flag">${ic('user', 12)}<span>${esc(primary.personName)}${primary.roleName ? ' · ' + esc(primary.roleName) : ''}${primary.phone ? ' · ' + esc(primary.phone) : ''}</span></span>`);
    }
    const staffN = (ao.staff || []).length;
    const staffHtml = staffN ? UiKit.avatarStack(ao.staff, 3)
      : (ao.status === 'pool' ? '' : `<span class="ops2-nostaff">${ic('user-x', 12)}<span>Ingen personal</span></span>`);
    const billActs = o.focus === 'bill' && Auth.can('invoice_create')
      ? `<button type="button" class="btn bs bsm" data-ao="${esc(ao.id)}" onclick="event.stopPropagation();OperationsPage._createInvoice(this.dataset.ao)">${ic('file-plus', 13)} Skapa underlag</button>` : '';

    return `<div class="ops2-row${o.compact ? ' is-compact' : ''}${ao.priority === 'akut' ? ' p-akut' : ''}" role="button" tabindex="0" data-ao="${esc(ao.id)}"
        onclick="Router.showPage('pg-ao-detail',{aoId:this.dataset.ao})" onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();this.click();}">
      <span class="ops2-row-t">${when}</span>
      <span class="ops2-row-m">
        <span class="ops2-row-title"><span class="ops2-id">${esc(WorkOrderService.displayNumberOrPending(ao))}</span><span>${esc(ao.title)}</span></span>
        <span class="ops2-row-sub">${[cu ? esc(CustomerService.displayName(cu)) : '', addr ? esc(addr) : ''].filter(Boolean).join(' · ') || '—'}</span>
        ${flags.length ? `<span class="ops2-row-flags">${flags.join('')}</span>` : ''}
      </span>
      <span class="ops2-row-r">
        <span class="ops2-row-b">${sbdg(ao.status)}${['akut', 'hög', 'låg'].includes(ao.priority) ? pbdg(ao.priority) : ''}</span>
        ${staffHtml}
        ${billActs}
      </span>
    </div>`;
  }
};
