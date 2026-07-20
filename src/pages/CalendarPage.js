/**
 * CalendarPage — Kalendervy för VIFT CRM (v1)
 * Dag / Vecka / Månad / Agenda — AO, Ronderingspass, Serviceintervall
 */

const CalendarPage = {
  _view: 'vecka',   // 'dag' | 'vecka' | 'manad' | 'agenda'
  _date: '',        // YYYY-MM-DD, initieras till today vid första render
  _filter: {
    staffId: '',
    customerId: '',
    propertyId: '',
    category: '',
    types: { workOrder: true, rondering: true, serviceInterval: true }
  },
  _dragAoId: null,

  /* ── Konstanter ──────────────────────────────────────────────────────── */
  _MONTHS: ['januari','februari','mars','april','maj','juni',
            'juli','augusti','september','oktober','november','december'],
  _MONTHS_SHORT: ['jan','feb','mar','apr','maj','jun',
                  'jul','aug','sep','okt','nov','dec'],
  _DAYS_SHORT: ['mån','tis','ons','tor','fre','lör','sön'],
  _HOUR_START: 7,
  _HOUR_END:  20,
  _SLOT_H:    44, // px per timme

  /* ── Entry point ─────────────────────────────────────────────────────── */
  render(params) {
    const el = document.getElementById('pg-calendar-content');
    if (!el) return;
    if (!this._date) this._date = tdy();
    if (params && params.view) this._view = params.view;
    if (params && params.date) this._date = params.date;

    el.innerHTML = this._styles() + this._toolbar() + '<div id="cal-view"></div>';
    this._renderView();
    this._bindDelegated();
  },

  _renderView() {
    const el = document.getElementById('cal-view');
    if (!el) return;
    switch (this._view) {
      case 'dag':    el.innerHTML = this._dag();    break;
      case 'vecka':  el.innerHTML = this._vecka();  break;
      case 'manad':  el.innerHTML = this._manad();  break;
      case 'agenda': el.innerHTML = this._agenda(); break;
      default:       el.innerHTML = this._vecka();
    }
  },

  /* ── Toolbar ─────────────────────────────────────────────────────────── */
  _toolbar() {
    const v = this._view;
    const periodLabel = this._periodLabel();
    const filterActive = this._filter.staffId || this._filter.customerId ||
      this._filter.propertyId || this._filter.category ||
      !this._filter.types.workOrder || !this._filter.types.rondering || !this._filter.types.serviceInterval;

    return `<div class="cal-toolbar">
      <div class="cal-nav">
        <button class="btn bghost bsm" onclick="CalendarPage.prev()" title="Föregående">${ic('chevron-left',15)}</button>
        <button class="btn bghost bsm" onclick="CalendarPage.goToday()">Idag</button>
        <button class="btn bghost bsm" onclick="CalendarPage.next()" title="Nästa">${ic('chevron-right',15)}</button>
        <span class="cal-period-label">${periodLabel}</span>
      </div>
      <div class="cal-view-tabs ftabs" style="margin-bottom:0;">
        <button class="ft ${v==='dag'?'on':''}" onclick="CalendarPage.setView('dag')">Dag</button>
        <button class="ft ${v==='vecka'?'on':''}" onclick="CalendarPage.setView('vecka')">Vecka</button>
        <button class="ft ${v==='manad'?'on':''}" onclick="CalendarPage.setView('manad')">Månad</button>
        <button class="ft ${v==='agenda'?'on':''}" onclick="CalendarPage.setView('agenda')">Agenda</button>
      </div>
      <div class="cal-toolbar-right">
        <button class="btn bghost bsm${filterActive?' cal-filter-active':''}" onclick="CalendarPage.openFilterPanel()">
          ${ic('filter',13)} Filter${filterActive?' •':''}
        </button>
        ${Auth.can('ao_create') ? `<button class="btn bp bsm" onclick="CalendarPage._createAOForDate('${this._date}')">${ic('plus',13)} Skapa AO</button>` : ''}
      </div>
    </div>`;
  },

  _periodLabel() {
    const d = this._parseDate(this._date);
    if (!d) return '';
    switch (this._view) {
      case 'dag': {
        const dn = this._DAYS_SHORT[this._isoWeekday(d) - 1];
        return `${dn} ${d.getDate()} ${this._MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      }
      case 'vecka': {
        const mon = this._weekStart(d);
        const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
        const wn  = this._isoWeek(mon);
        const sameMon = mon.getMonth() === sun.getMonth();
        const rangeStr = sameMon
          ? `${mon.getDate()}–${sun.getDate()} ${this._MONTHS[mon.getMonth()]}`
          : `${mon.getDate()} ${this._MONTHS_SHORT[mon.getMonth()]}–${sun.getDate()} ${this._MONTHS_SHORT[sun.getMonth()]}`;
        return `v.${wn}, ${rangeStr} ${sun.getFullYear()}`;
      }
      case 'manad':
        return `${this._MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      case 'agenda':
        return `Agenda från ${d.getDate()} ${this._MONTHS[d.getMonth()]}`;
      default:
        return '';
    }
  },

  /* ── DAG-vy ──────────────────────────────────────────────────────────── */
  _dag() {
    const events = this._events(this._date);
    const allDay  = events.filter(e => !e.startH);
    const timed   = events.filter(e =>  e.startH != null);
    const conflicts = this._detectConflicts(timed);
    const hours = [];
    for (let h = this._HOUR_START; h <= this._HOUR_END; h++) hours.push(h);

    const slotRows = hours.map(h =>
      `<div class="cal-slot" data-h="${h}" ondragover="CalendarPage._dragOver('${this._date}',event)" ondrop="CalendarPage._drop('${this._date}',event)">
        <span class="cal-slot-lbl">${String(h).padStart(2,'0')}:00</span>
        <div class="cal-slot-cell"></div>
       </div>`
    ).join('');

    const totalH = (this._HOUR_END - this._HOUR_START + 1) * this._SLOT_H;
    const evtHtml = timed.map(e => this._positionedEvent(e, conflicts)).join('');
    const allDayHtml = allDay.map(e => this._chipHtml(e)).join('');

    return `<div class="cal-day-wrap">
      ${allDay.length ? `<div class="cal-allday-row"><span class="cal-allday-lbl">Hela dagen</span><div class="cal-allday-events">${allDayHtml}</div></div>` : ''}
      <div class="cal-time-grid" style="position:relative;min-height:${totalH}px;">
        <div class="cal-slots">${slotRows}</div>
        <div class="cal-events-col" style="position:absolute;top:0;left:56px;right:0;height:${totalH}px;">${evtHtml}</div>
      </div>
    </div>`;
  },

  /* ── VECKA-vy ────────────────────────────────────────────────────────── */
  _vecka() {
    const mon  = this._weekStart(this._parseDate(this._date));
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon); d.setDate(d.getDate() + i);
      days.push(this._fmt(d));
    }
    const today = tdy();
    const hours = [];
    for (let h = this._HOUR_START; h <= this._HOUR_END; h++) hours.push(h);
    const totalH = (this._HOUR_END - this._HOUR_START + 1) * this._SLOT_H;

    // Pool AOs
    const pool = (state.workOrders||[]).filter(ao => ao.status === 'pool' && !ao.archived && !ao.deleted);

    const dayHeaders = days.map((ds, i) => {
      const d = this._parseDate(ds);
      const isToday = ds === today;
      return `<div class="cal-wk-hdr${isToday?' cal-today-hdr':''}">
        <span class="cal-wk-dayname">${this._DAYS_SHORT[i]}</span>
        <span class="cal-wk-daynum${isToday?' cal-today-num':''}" onclick="CalendarPage._navDay('${ds}')">${d.getDate()}</span>
      </div>`;
    }).join('');

    const allDayCols = days.map(ds => {
      const evts = this._events(ds).filter(e => !e.startH);
      return `<div class="cal-wk-allday-cell" ondragover="CalendarPage._dragOver('${ds}',event)" ondrop="CalendarPage._drop('${ds}',event)">${evts.map(e=>this._chipHtml(e)).join('')}</div>`;
    }).join('');

    const timeCols = days.map(ds => {
      const timed = this._events(ds).filter(e => e.startH != null);
      const conflicts = this._detectConflicts(timed);
      const evtHtml = timed.map(e => this._positionedEvent(e, conflicts)).join('');
      const isToday = ds === today;
      return `<div class="cal-wk-col${isToday?' cal-today-col':''}" style="position:relative;height:${totalH}px;"
        ondragover="CalendarPage._dragOver('${ds}',event)"
        ondrop="CalendarPage._drop('${ds}',event)">${evtHtml}</div>`;
    }).join('');

    const slotLabels = hours.map(h =>
      `<div class="cal-slot-lbl2" style="height:${this._SLOT_H}px;">${String(h).padStart(2,'0')}:00</div>`
    ).join('');

    const poolSection = pool.length ? `<div class="cal-pool-section">
      <div class="cal-pool-hdr">${ic('inbox',13)} Arbetspool (${pool.length} ej schemalagda)</div>
      <div class="cal-pool-items">${pool.map(ao => this._poolChip(ao)).join('')}</div>
    </div>` : '';

    return `<div class="cal-wk-wrap">
      <div class="cal-wk-grid">
        <div class="cal-wk-gutter"></div>
        <div class="cal-wk-headers">${dayHeaders}</div>
        <div class="cal-wk-gutter-sm"></div>
        <div class="cal-wk-allday-row">${allDayCols}</div>
        <div class="cal-wk-time-gutter">${slotLabels}</div>
        <div class="cal-wk-time-cols">${timeCols}</div>
      </div>
      ${poolSection}
    </div>`;
  },

  /* ── MÅNAD-vy ────────────────────────────────────────────────────────── */
  _manad() {
    const anchor = this._parseDate(this._date);
    const year   = anchor.getFullYear();
    const month  = anchor.getMonth();
    const today  = tdy();

    // Första dagen i månaden, justerad till måndag
    const firstOfMonth = new Date(year, month, 1);
    const startDow = this._isoWeekday(firstOfMonth); // 1=mån..7=sön
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - (startDow - 1));

    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart); d.setDate(d.getDate() + i);
      cells.push(d);
    }

    const dayHeaders = this._DAYS_SHORT.map(n =>
      `<div class="cal-mn-dh">${n}</div>`
    ).join('');

    const cellsHtml = cells.map(d => {
      const ds      = this._fmt(d);
      const evts    = this._events(ds);
      const isToday = ds === today;
      const otherMon = d.getMonth() !== month;
      const shown   = evts.slice(0, 3);
      const extra   = evts.length - shown.length;

      const chipsHtml = shown.map(e => `<div class="cal-mn-chip" style="background:${e.color};" onclick="event.stopPropagation();${e.onclick}" title="${esc(e.title)}">${esc(e.title.length > 20 ? e.title.slice(0,18)+'…' : e.title)}</div>`).join('');
      const extraHtml = extra > 0 ? `<div class="cal-mn-chip cal-mn-more" onclick="event.stopPropagation();CalendarPage._navDay('${ds}')">+${extra} mer</div>` : '';

      return `<div class="cal-mn-cell${isToday?' cal-mn-today':''}${otherMon?' cal-mn-other':''}"
        ondragover="CalendarPage._dragOver('${ds}',event)"
        ondrop="CalendarPage._drop('${ds}',event)"
        onclick="CalendarPage._createAOForDate('${ds}')">
        <span class="cal-mn-dn" onclick="event.stopPropagation();CalendarPage._navDay('${ds}')">${d.getDate()}</span>
        ${chipsHtml}${extraHtml}
      </div>`;
    }).join('');

    return `<div class="cal-mn-wrap">
      <div class="cal-mn-grid cal-mn-dh-row">${dayHeaders}</div>
      <div class="cal-mn-grid">${cellsHtml}</div>
    </div>`;
  },

  /* ── AGENDA-vy ───────────────────────────────────────────────────────── */
  _agenda() {
    const anchor = this._parseDate(this._date);
    const today  = tdy();
    const days   = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(anchor); d.setDate(d.getDate() + i);
      days.push(this._fmt(d));
    }

    const pool = (state.workOrders||[]).filter(ao =>
      ao.status === 'pool' && !ao.archived && !ao.deleted &&
      this._filter.types.workOrder
    );

    const sections = days.map(ds => {
      const evts = this._events(ds);
      if (!evts.length) return '';
      const d   = this._parseDate(ds);
      const dow = this._DAYS_SHORT[this._isoWeekday(d) - 1];
      const isToday = ds === today;
      const rows = evts.map(e => this._agendaRow(e)).join('');
      return `<div class="cal-ag-section">
        <div class="cal-ag-date-hdr${isToday?' cal-ag-today':''}">
          <span class="cal-ag-dow">${dow}</span>
          <span class="cal-ag-dom">${d.getDate()}</span>
          <span class="cal-ag-mon">${this._MONTHS_SHORT[d.getMonth()]}</span>
          ${isToday ? '<span class="cal-ag-today-badge">Idag</span>' : ''}
        </div>
        <div class="cal-ag-rows">${rows}</div>
      </div>`;
    }).filter(Boolean).join('');

    const poolSection = pool.length ? `<div class="cal-pool-section" style="margin-top:20px;">
      <div class="cal-pool-hdr">${ic('inbox',13)} Arbetspool — ${pool.length} ej schemalagda</div>
      <div class="cal-pool-items">${pool.map(ao => this._agendaRow({
        id: ao.id, title: ao.title||ao.id, type:'workOrder',
        color:'var(--mt)', onclick:`Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})`,
        ao, startH: null, endH: null
      })).join('')}</div>
    </div>` : '';

    return `<div class="cal-ag-wrap">
      ${sections || `<div class="empty" style="margin-top:40px;">${ic('calendar',28)}<p>Inga händelser de närmaste 30 dagarna</p></div>`}
      ${poolSection}
    </div>`;
  },

  /* ── Händelsebyggare ─────────────────────────────────────────────────── */
  _events(dateStr) {
    const events = [];
    const f = this._filter;

    // ── Arbetsorder ──
    if (f.types.workOrder) {
      (state.workOrders || []).forEach(ao => {
        if (ao.archived || ao.deleted) return;
        if (ao.status === 'pool') return; // pool hanteras separat
        if (!ao.scheduledDate || ao.scheduledDate !== dateStr) return;
        if (f.staffId && !(ao.staff||[]).includes(f.staffId)) return;
        if (f.customerId && ao.customerId !== f.customerId) return;
        if (f.propertyId && ao.propertyId !== f.propertyId) return;
        if (f.category && ao.category !== f.category) return;

        const today   = tdy();
        const overdue = ao.scheduledDate < today && !['klar','fakturerad','avbruten'].includes(ao.status);
        const cu   = ao.customerId ? getCu(ao.customerId) : null;
        const prop = ao.propertyId ? (state.properties||[]).find(p=>p.id===ao.propertyId) : null;

        let startH = null, endH = null;
        if (ao.scheduledStart) { const p = ao.scheduledStart.split(':'); startH = +p[0] + (+p[1]||0)/60; }
        if (ao.scheduledEnd)   { const p = ao.scheduledEnd.split(':');   endH   = +p[0] + (+p[1]||0)/60; }

        events.push({
          id:      ao.id,
          title:   ao.title || ao.id,
          type:    'workOrder',
          color:   overdue ? 'var(--rd)' : 'var(--sky)',
          overdue,
          startH,
          endH,
          ao,
          cu,
          prop,
          onclick: `Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})`,
          draggable: Auth.can('ao_edit')
        });
      });
    }

    // ── Ronderingspass ──
    if (f.types.rondering) {
      (state.ronderingspass || []).forEach(pass => {
        if (!pass.date || pass.date !== dateStr) return;
        // Filtrera på fastighet om satt
        if (f.propertyId) {
          const ron = (state.ronderingar||[]).find(r => r.id === pass.ronderingId);
          if (!ron || ron.propertyId !== f.propertyId) return;
        }
        if (f.staffId && pass.staffId && pass.staffId !== f.staffId) return;

        let startH = null, endH = null;
        if (pass.startTime) { const p = pass.startTime.split(':'); startH = +p[0] + (+p[1]||0)/60; }
        if (pass.endTime)   { const p = pass.endTime.split(':');   endH   = +p[0] + (+p[1]||0)/60; }

        const ron = (state.ronderingar||[]).find(r => r.id === pass.ronderingId);
        events.push({
          id:      pass.id,
          title:   (ron ? ron.name : 'Rondering') + (pass.title ? ': '+pass.title : ''),
          type:    'rondering',
          color:   'var(--indigo,#6366f1)',
          startH, endH,
          passId:  pass.id,
          onclick: `Router.showPage('pg-rondering-rapport',{passId:'${pass.id}'})`,
          draggable: false
        });
      });
    }

    // ── Serviceintervall ──
    if (f.types.serviceInterval) {
      const today = tdy();
      (state.properties || []).forEach(prop => {
        if (f.propertyId && prop.id !== f.propertyId) return;
        (prop.serviceIntervals || []).forEach(si => {
          if (!si.nextDate) return;
          const daysUntil = this._daysDiff(today, si.nextDate);
          const overdue   = daysUntil < 0;
          const dueSoon   = daysUntil >= 0 && daysUntil <= 14;
          if (si.nextDate !== dateStr) return;
          if (!overdue && !dueSoon) return;

          events.push({
            id:      `si-${prop.id}-${si.id||si.name}`,
            title:   `${si.name||'Service'} — ${prop.name||prop.address||prop.id}`,
            type:    'serviceInterval',
            color:   overdue ? 'var(--rd)' : 'var(--or)',
            startH:  null, endH: null,
            propId:  prop.id,
            onclick: `Router.showPage('pg-obj-detail',{propId:'${prop.id}',tab:'service'})`,
            draggable: false
          });
        });
      });
    }

    // Sortera på starttid
    events.sort((a,b) => {
      if (a.startH == null && b.startH == null) return 0;
      if (a.startH == null) return 1;
      if (b.startH == null) return -1;
      return a.startH - b.startH;
    });
    return events;
  },

  _eventsForRange(from, to) {
    const events = [];
    const a = this._parseDate(from), b = this._parseDate(to);
    const cur = new Date(a);
    while (cur <= b) {
      events.push(...this._events(this._fmt(cur)));
      cur.setDate(cur.getDate() + 1);
    }
    return events;
  },

  /* ── Konfliktdetektering ──────────────────────────────────────────────── */
  _detectConflicts(timedEvents) {
    // Returnerar Set av event-id:n som har konflikt med annan AO för samma personal
    const conflicted = new Set();
    const aos = timedEvents.filter(e => e.type === 'workOrder' && e.ao);
    for (let i = 0; i < aos.length; i++) {
      for (let j = i+1; j < aos.length; j++) {
        const a = aos[i], b = aos[j];
        // Kontrollera personalöverlapp
        const staffA = a.ao.staff || [];
        const staffB = b.ao.staff || [];
        const shared = staffA.some(s => staffB.includes(s));
        if (!shared) continue;
        // Tidöverlapp
        const aS = a.startH ?? 0, aE = a.endH ?? 24;
        const bS = b.startH ?? 0, bE = b.endH ?? 24;
        if (aS < bE && bS < aE) {
          conflicted.add(a.id);
          conflicted.add(b.id);
        }
      }
    }
    return conflicted;
  },

  /* ── Rendering-helpers ───────────────────────────────────────────────── */
  _positionedEvent(evt, conflicts) {
    const s = Math.max(evt.startH ?? this._HOUR_START, this._HOUR_START);
    const e = Math.min(evt.endH   ?? (s + 1),          this._HOUR_END + 1);
    const top  = (s - this._HOUR_START) * this._SLOT_H;
    const h    = Math.max((e - s) * this._SLOT_H, 22);
    const conflict = conflicts && conflicts.has(evt.id);
    const draggable = evt.draggable ? 'draggable="true"' : '';
    const dragEvts  = evt.draggable
      ? `ondragstart="CalendarPage._dragStart('${evt.id}',event)"`
      : `onclick="event.stopPropagation();${evt.onclick}"`;

    const dragAttr = evt.draggable ? `data-aoid="${evt.id}"` : '';
    return `<div class="cal-timed-evt${conflict?' cal-conflict':''}" ${draggable} ${dragAttr} ${dragEvts}
      style="top:${top}px;height:${h}px;background:${evt.color};"
      onclick="event.stopPropagation();${evt.onclick}"
      title="${esc(evt.title)}">
      <span class="cal-evt-title">${esc(evt.title)}</span>
      ${conflict ? `<span class="cal-conflict-icon" title="Konflikt med annan personal">${ic('alert-triangle',10)}</span>` : ''}
    </div>`;
  },

  _chipHtml(evt) {
    const draggable = evt.draggable ? 'draggable="true"' : '';
    const dragAttr  = evt.draggable ? `data-aoid="${evt.id}"` : '';
    const dragEvts  = evt.draggable
      ? `ondragstart="CalendarPage._dragStart('${evt.id}',event)"`
      : '';
    return `<div class="cal-chip" ${draggable} ${dragAttr} ${dragEvts}
      style="background:${evt.color};"
      onclick="event.stopPropagation();${evt.onclick}"
      title="${esc(evt.title)}">${esc(evt.title.length>22?evt.title.slice(0,20)+'…':evt.title)}</div>`;
  },

  _poolChip(ao) {
    return `<div class="cal-pool-chip" style="background:var(--mt)20;border:1px solid var(--mt)40;cursor:pointer;"
      onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})"
      title="${esc(ao.title||ao.id)}">
      ${ic('inbox',11)} ${esc(ao.title||ao.id)}
    </div>`;
  },

  _agendaRow(evt) {
    const ao = evt.ao;
    const timeStr = evt.startH != null
      ? `${String(Math.floor(evt.startH)).padStart(2,'0')}:${String(Math.round((evt.startH%1)*60)).padStart(2,'0')}`
      : '';
    const endStr = evt.endH != null && evt.startH != null
      ? `–${String(Math.floor(evt.endH)).padStart(2,'0')}:${String(Math.round((evt.endH%1)*60)).padStart(2,'0')}`
      : '';
    const today = tdy();
    const overdue = ao && ao.scheduledDate && ao.scheduledDate < today && !['klar','fakturerad','avbruten'].includes(ao.status||'');

    let meta = '';
    if (ao) {
      const cu   = ao.customerId ? getCu(ao.customerId) : null;
      const prop = ao.propertyId ? (state.properties||[]).find(p=>p.id===ao.propertyId) : null;
      const staffNames = (ao.staff||[]).map(sid => { const s = getStaff(sid); return s ? `${s.firstName} ${s.lastName.charAt(0)}.` : sid; });
      meta = `<div class="cal-ag-meta">
        ${cu ? `<span>${ic('building-2',10)} ${esc(typeof CustomerService!=='undefined'?CustomerService.displayName(cu):(cu.name||cu.id))}</span>` : ''}
        ${prop ? `<span>${ic('map-pin',10)} ${esc(prop.name||prop.address||prop.id)}</span>` : ''}
        ${staffNames.length ? `<span>${ic('users',10)} ${staffNames.map(esc).join(', ')}</span>` : ''}
        ${ao.status ? `<span class="bdg ${this._statusCls(ao.status)}">${esc(ao.status)}</span>` : ''}
      </div>`;
    }

    return `<div class="cal-ag-row${overdue?' cal-ag-overdue':''}" onclick="${evt.onclick}" style="border-left:3px solid ${evt.color};">
      <div class="cal-ag-time">${timeStr}${endStr ? `<br><span style="font-size:10px;opacity:.7;">${endStr}</span>` : ''}</div>
      <div class="cal-ag-body">
        <div class="cal-ag-title">${esc(evt.title)}</div>
        ${meta}
      </div>
      <div class="cal-ag-type-dot" style="background:${evt.color};"></div>
    </div>`;
  },

  _statusCls(s) {
    const m = {nytt:'bdg-blue',pool:'bdg-grey',planerad:'bdg-blue',
               'pågående':'bdg-orange',klar:'bdg-green',fakturerad:'bdg-green',
               avbruten:'bdg-grey'};
    return m[s] || 'bdg-grey';
  },

  /* ── Navigation ──────────────────────────────────────────────────────── */
  prev() {
    const d = this._parseDate(this._date);
    switch (this._view) {
      case 'dag':    d.setDate(d.getDate() - 1);         break;
      case 'vecka':  d.setDate(d.getDate() - 7);         break;
      case 'manad':  d.setMonth(d.getMonth() - 1);       break;
      case 'agenda': d.setDate(d.getDate() - 30);        break;
    }
    this._date = this._fmt(d);
    this._refresh();
  },

  next() {
    const d = this._parseDate(this._date);
    switch (this._view) {
      case 'dag':    d.setDate(d.getDate() + 1);         break;
      case 'vecka':  d.setDate(d.getDate() + 7);         break;
      case 'manad':  d.setMonth(d.getMonth() + 1);       break;
      case 'agenda': d.setDate(d.getDate() + 30);        break;
    }
    this._date = this._fmt(d);
    this._refresh();
  },

  goToday() {
    this._date = tdy();
    this._refresh();
  },

  setView(v) {
    this._view = v;
    this._refresh();
  },

  _navDay(ds) {
    this._date = ds;
    this._view = 'dag';
    this._refresh();
  },

  _refresh() {
    // Uppdatera toolbar + vy utan full render
    const el = document.getElementById('pg-calendar-content');
    if (!el) return;
    el.innerHTML = this._styles() + this._toolbar() + '<div id="cal-view"></div>';
    this._renderView();
    this._bindDelegated();
  },

  /* ── Filter ──────────────────────────────────────────────────────────── */
  openFilterPanel() {
    const f = this._filter;
    const staffOptions = (state.staff||[]).map(s =>
      `<option value="${s.id}"${f.staffId===s.id?' selected':''}>${esc(s.firstName+' '+s.lastName)}</option>`
    ).join('');
    const cuOptions = (state.customers||[]).map(cu => {
      const name = typeof CustomerService!=='undefined' ? CustomerService.displayName(cu) : (cu.name||cu.id);
      return `<option value="${cu.id}"${f.customerId===cu.id?' selected':''}>${esc(name)}</option>`;
    }).join('');
    const propOptions = (state.properties||[]).map(p =>
      `<option value="${p.id}"${f.propertyId===p.id?' selected':''}>${esc(p.name||p.address||p.id)}</option>`
    ).join('');

    const cats = typeof AO_CATEGORIES !== 'undefined' ? AO_CATEGORIES : [];
    const catOptions = cats.map(c =>
      `<option value="${c.slug}"${f.category===c.slug?' selected':''}>${esc(c.label)}</option>`
    ).join('');

    Modal.open({
      title: `${ic('filter',14)} Kalenderfilter`,
      body: `<div style="display:flex;flex-direction:column;gap:12px;">
        <label style="font-size:12px;font-weight:600;">Personal
          <select id="cal-f-staff" style="width:100%;margin-top:4px;padding:6px;border:1px solid var(--br);border-radius:6px;background:var(--card);">
            <option value="">Alla</option>${staffOptions}
          </select>
        </label>
        <label style="font-size:12px;font-weight:600;">Kund
          <select id="cal-f-cu" style="width:100%;margin-top:4px;padding:6px;border:1px solid var(--br);border-radius:6px;background:var(--card);">
            <option value="">Alla</option>${cuOptions}
          </select>
        </label>
        <label style="font-size:12px;font-weight:600;">Fastighet
          <select id="cal-f-prop" style="width:100%;margin-top:4px;padding:6px;border:1px solid var(--br);border-radius:6px;background:var(--card);">
            <option value="">Alla</option>${propOptions}
          </select>
        </label>
        ${cats.length ? `<label style="font-size:12px;font-weight:600;">Kategori
          <select id="cal-f-cat" style="width:100%;margin-top:4px;padding:6px;border:1px solid var(--br);border-radius:6px;background:var(--card);">
            <option value="">Alla</option>${catOptions}
          </select>
        </label>` : ''}
        <div style="font-size:12px;font-weight:600;">Aktivitetstyp
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px;">
            <label style="display:flex;align-items:center;gap:8px;font-weight:400;cursor:pointer;">
              <input type="checkbox" id="cal-f-ao"  ${f.types.workOrder?'checked':''}> Arbetsorder
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-weight:400;cursor:pointer;">
              <input type="checkbox" id="cal-f-ron" ${f.types.rondering?'checked':''}> Ronderingspass
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-weight:400;cursor:pointer;">
              <input type="checkbox" id="cal-f-si"  ${f.types.serviceInterval?'checked':''}> Serviceintervall
            </label>
          </div>
        </div>
      </div>`,
      buttons: [
        { label: `${ic('check',12)} Tillämpa`, cls: 'btn bp', onClick: () => this._applyFilter() },
        { label: `${ic('x',11)} Rensa`, cls: 'btn bs', onClick: () => { this._clearFilter(); Modal.close(); } },
        { label: 'Avbryt', cls: 'btn bghost', onClick: () => Modal.close() }
      ]
    });
  },

  _applyFilter() {
    this._filter.staffId    = document.getElementById('cal-f-staff')?.value || '';
    this._filter.customerId = document.getElementById('cal-f-cu')?.value    || '';
    this._filter.propertyId = document.getElementById('cal-f-prop')?.value  || '';
    this._filter.category   = document.getElementById('cal-f-cat')?.value   || '';
    this._filter.types.workOrder       = document.getElementById('cal-f-ao')?.checked  ?? true;
    this._filter.types.rondering       = document.getElementById('cal-f-ron')?.checked ?? true;
    this._filter.types.serviceInterval = document.getElementById('cal-f-si')?.checked  ?? true;
    Modal.close();
    this._refresh();
  },

  _clearFilter() {
    this._filter = {
      staffId:'', customerId:'', propertyId:'', category:'',
      types:{ workOrder:true, rondering:true, serviceInterval:true }
    };
    this._refresh();
  },

  /* ── Drag-and-drop ───────────────────────────────────────────────────── */
  _dragStart(aoId, evt) {
    if (!Auth.can('ao_edit')) { evt.preventDefault(); return; }
    this._dragAoId = aoId;
    evt.dataTransfer.setData('text/plain', aoId);
    evt.dataTransfer.effectAllowed = 'move';
  },

  _dragOver(dateStr, evt) {
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'move';
  },

  _drop(dateStr, evt) {
    evt.preventDefault();
    const aoId = this._dragAoId || evt.dataTransfer.getData('text/plain');
    this._dragAoId = null;
    if (!aoId || !dateStr) return;
    if (!Auth.can('ao_edit')) { showToast('Saknar behörighet att redigera arbetsorder'); return; }
    const ao = (state.workOrders||[]).find(a => a.id === aoId);
    if (!ao) return;
    if (ao.scheduledDate === dateStr) return;
    WorkOrderService.update(aoId, { scheduledDate: dateStr });
    showToast(`${aoId} flyttad till ${fmtDate(dateStr)}`);
    this._refresh();
  },

  /* ── Touch-flytt ─────────────────────────────────────────────────────── */
  _touchMove(aoId) {
    if (!Auth.can('ao_edit')) { showToast('Saknar behörighet'); return; }
    const ao = (state.workOrders||[]).find(a => a.id === aoId);
    if (!ao) return;
    Modal.open({
      title: `${ic('move',14)} Flytta till…`,
      body: `<div style="display:flex;flex-direction:column;gap:10px;">
        <p style="font-size:13px;margin:0;">Välj nytt datum för <strong>${esc(ao.title||ao.id)}</strong></p>
        <input type="date" id="touch-move-date" value="${ao.scheduledDate||this._date}"
          style="padding:8px;border:1px solid var(--br);border-radius:6px;font-size:14px;width:100%;box-sizing:border-box;">
      </div>`,
      buttons: [
        { label: `${ic('check',12)} Flytta`, cls:'btn bp', onClick: () => {
          const nd = document.getElementById('touch-move-date')?.value;
          if (!nd) return;
          WorkOrderService.update(aoId, { scheduledDate: nd });
          showToast(`${aoId} flyttad till ${fmtDate(nd)}`);
          Modal.close();
          this._refresh();
        }},
        { label: 'Avbryt', cls:'btn bghost', onClick: () => Modal.close() }
      ]
    });
  },

  /* ── Skapa AO från kalender ──────────────────────────────────────────── */
  _createAOForDate(dateStr) {
    if (!Auth.can('ao_create')) return;
    if (typeof WorkOrdersPage !== 'undefined' && typeof WorkOrdersPage.openCreate === 'function') {
      WorkOrdersPage.openCreate({ scheduledDate: dateStr });
    } else {
      Router.showPage('pg-ao');
    }
  },

  /* ── Eventbindning (delegering) ──────────────────────────────────────── */
  _bindDelegated() {
    const el = document.getElementById('cal-view');
    if (!el) return;

    // Pointer Events-baserad long-press för mobil-flytt (blockerar inte scroll)
    let _pressTimer  = null;
    let _pressTarget = null;
    let _pressOrigin = null;
    const HOLD_MS  = 480;
    const MOVE_PX  = 10;

    el.addEventListener('pointerdown', function(e) {
      const chip = e.target.closest('[data-aoid]');
      if (!chip) return;
      _pressTarget = chip;
      _pressOrigin = { x: e.clientX, y: e.clientY };
      _pressTimer  = setTimeout(function() {
        _pressTimer  = null;
        _pressTarget = null;
        if (navigator.vibrate) navigator.vibrate(30);
        CalendarPage._touchMove(chip.dataset.aoid);
      }, HOLD_MS);
    }, { passive: true });

    el.addEventListener('pointermove', function(e) {
      if (!_pressTimer || !_pressOrigin) return;
      const dx = Math.abs(e.clientX - _pressOrigin.x);
      const dy = Math.abs(e.clientY - _pressOrigin.y);
      if (dx > MOVE_PX || dy > MOVE_PX) {
        clearTimeout(_pressTimer);
        _pressTimer  = null;
        _pressTarget = null;
      }
    }, { passive: true });

    function cancelPress() {
      if (_pressTimer) { clearTimeout(_pressTimer); _pressTimer = null; }
      _pressTarget = null;
      _pressOrigin = null;
    }
    el.addEventListener('pointerup',     cancelPress, { passive: true });
    el.addEventListener('pointercancel', cancelPress, { passive: true });

    // Desktopkontextmeny — förhindra webbläsarens standardmeny på dra-bara chip
    el.addEventListener('contextmenu', function(e) {
      const chip = e.target.closest('[data-aoid]');
      if (chip) e.preventDefault();
    }, { passive: false });
  },

  /* ── Datumhjälp ──────────────────────────────────────────────────────── */
  _parseDate(s) {
    if (!s) return new Date();
    const [y,m,d] = s.split('-').map(Number);
    return new Date(y, m-1, d);
  },

  _fmt(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  },

  _isoWeekday(d) {
    // 1=måndag .. 7=söndag
    return ((d.getDay() + 6) % 7) + 1;
  },

  _isoWeek(d) {
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  },

  _weekStart(d) {
    const dow = this._isoWeekday(d); // 1=mån
    const mon = new Date(d);
    mon.setDate(d.getDate() - (dow - 1));
    return mon;
  },

  _daysDiff(from, to) {
    const a = this._parseDate(from), b = this._parseDate(to);
    return Math.round((b - a) / 86400000);
  },

  /* ── CSS (inlineat i JS — ingen extern fil) ──────────────────────────── */
  _styles() {
    return `<style>
/* ── Kalender: gemensam ─────────────────────────── */
.cal-toolbar {
  display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  margin-bottom:12px; padding:10px 14px;
  background:var(--card); border:1px solid var(--br); border-radius:10px;
}
.cal-nav { display:flex; align-items:center; gap:4px; }
.cal-period-label { font-size:13px; font-weight:700; color:var(--navy); margin-left:6px; white-space:nowrap; }
.cal-view-tabs { display:flex; }
.cal-toolbar-right { display:flex; align-items:center; gap:6px; margin-left:auto; }
.cal-filter-active { color:var(--blue)!important; }

/* ── Chip (allday + månad) ──────────────────────── */
.cal-chip {
  font-size:10px; font-weight:600; color:#fff;
  padding:2px 6px; border-radius:4px; cursor:pointer;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  max-width:100%; margin-bottom:2px;
  user-select:none; touch-action:manipulation;
}
.cal-chip:hover { filter:brightness(.9); }

/* ── Timed event ──────────────────────────────── */
.cal-timed-evt {
  position:absolute; left:2px; right:2px;
  border-radius:5px; padding:3px 6px;
  color:#fff; font-size:11px; font-weight:600;
  cursor:pointer; overflow:hidden;
  box-shadow:0 1px 3px rgba(0,0,0,.15);
  user-select:none; touch-action:manipulation; z-index:1;
}
.cal-timed-evt:hover { filter:brightness(.9); z-index:2; }
.cal-evt-title { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cal-conflict { box-shadow:0 0 0 2px var(--or)!important; }
.cal-conflict-icon { position:absolute; bottom:2px; right:4px; color:var(--or); }

/* ── DAG-vy ───────────────────────────────────── */
.cal-day-wrap { background:var(--card); border:1px solid var(--br); border-radius:10px; overflow:hidden; }
.cal-allday-row {
  display:flex; align-items:flex-start; gap:8px;
  padding:8px 12px; border-bottom:1px solid var(--br); background:var(--bg);
}
.cal-allday-lbl { font-size:10px; color:var(--mt); width:48px; flex-shrink:0; padding-top:2px; }
.cal-allday-events { display:flex; flex-wrap:wrap; gap:4px; flex:1; }
.cal-time-grid { overflow-x:auto; }
.cal-slots { position:absolute; top:0; left:0; width:56px; }
.cal-slot {
  display:flex; align-items:flex-start;
  height:44px; border-bottom:1px solid var(--br)22;
}
.cal-slot-lbl {
  font-size:10px; color:var(--mt); width:48px;
  padding:2px 4px 0 8px; flex-shrink:0; line-height:1;
}
.cal-slot-cell { flex:1; }

/* ── VECKA-vy ─────────────────────────────────── */
.cal-wk-wrap { overflow-x:auto; }
.cal-wk-grid {
  display:grid;
  grid-template-columns:48px 1fr;
  grid-template-rows:auto auto auto 1fr;
  min-width:520px;
}
.cal-wk-gutter { grid-row:1; grid-column:1; background:var(--card); border-bottom:1px solid var(--br); }
.cal-wk-headers {
  grid-row:1; grid-column:2;
  display:grid; grid-template-columns:repeat(7,1fr);
  background:var(--card); border-bottom:1px solid var(--br);
}
.cal-wk-hdr {
  text-align:center; padding:8px 2px;
  border-right:1px solid var(--br);
}
.cal-wk-hdr:last-child { border-right:none; }
.cal-wk-dayname { display:block; font-size:10px; color:var(--mt); text-transform:uppercase; }
.cal-wk-daynum {
  display:inline-flex; align-items:center; justify-content:center;
  width:26px; height:26px; border-radius:50%;
  font-size:14px; font-weight:700; cursor:pointer; margin-top:2px;
}
.cal-wk-daynum:hover { background:var(--bg); }
.cal-today-hdr { background:var(--sky)0d; }
.cal-today-num { background:var(--sky)!important; color:#fff!important; }
.cal-gutter-sm  { height:6px; }
.cal-wk-gutter-sm { grid-row:2; grid-column:1; border-bottom:1px solid var(--br); }
.cal-wk-allday-row {
  grid-row:2; grid-column:2;
  display:grid; grid-template-columns:repeat(7,1fr);
  border-bottom:1px solid var(--br); min-height:28px;
}
.cal-wk-allday-cell {
  padding:3px; border-right:1px solid var(--br); min-height:28px;
}
.cal-wk-allday-cell:last-child { border-right:none; }
.cal-wk-time-gutter {
  grid-row:3; grid-column:1;
  border-right:1px solid var(--br); background:var(--card);
}
.cal-slot-lbl2 {
  font-size:10px; color:var(--mt);
  padding:2px 4px 0 6px; box-sizing:border-box;
  border-bottom:1px solid var(--br)22;
  line-height:1;
}
.cal-wk-time-cols {
  grid-row:3; grid-column:2;
  display:grid; grid-template-columns:repeat(7,1fr);
}
.cal-wk-col {
  border-right:1px solid var(--br);
  background:repeating-linear-gradient(to bottom,
    transparent 0px,transparent 43px,var(--br)33 43px,var(--br)33 44px);
}
.cal-wk-col:last-child { border-right:none; }
.cal-today-col { background:var(--sky)05
  repeating-linear-gradient(to bottom,
    transparent 0px,transparent 43px,var(--br)33 43px,var(--br)33 44px); }

/* ── MÅNAD-vy ─────────────────────────────────── */
.cal-mn-wrap { background:var(--card); border:1px solid var(--br); border-radius:10px; overflow:hidden; }
.cal-mn-grid { display:grid; grid-template-columns:repeat(7,1fr); }
.cal-mn-dh-row { border-bottom:1px solid var(--br); }
.cal-mn-dh { text-align:center; font-size:10px; font-weight:700; color:var(--mt); padding:6px 0; text-transform:uppercase; }
.cal-mn-cell {
  min-height:90px; padding:4px; border-right:1px solid var(--br); border-bottom:1px solid var(--br);
  cursor:pointer; position:relative; overflow:hidden;
}
.cal-mn-cell:nth-child(7n) { border-right:none; }
.cal-mn-cell:hover { background:var(--bg); }
.cal-mn-other { opacity:.45; }
.cal-mn-today { background:var(--sky)0a; }
.cal-mn-dn {
  font-size:12px; font-weight:700; display:inline-block;
  padding:0 2px; margin-bottom:3px; cursor:pointer;
}
.cal-mn-today .cal-mn-dn {
  background:var(--sky); color:#fff; border-radius:50%;
  width:20px; height:20px; text-align:center; line-height:20px; padding:0;
}
.cal-mn-chip {
  font-size:10px; font-weight:600; color:#fff;
  padding:1px 5px; border-radius:3px; margin-bottom:2px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  cursor:pointer; max-width:100%;
}
.cal-mn-chip:hover { filter:brightness(.88); }
.cal-mn-more {
  background:var(--bg)!important; color:var(--mt)!important;
  border:1px solid var(--br); font-size:9px;
}

/* ── AGENDA-vy ────────────────────────────────── */
.cal-ag-wrap { max-width:700px; }
.cal-ag-section { display:flex; gap:14px; margin-bottom:16px; }
.cal-ag-date-hdr {
  width:52px; flex-shrink:0; text-align:center;
  padding-top:4px;
}
.cal-ag-today .cal-ag-dom {
  background:var(--sky); color:#fff; border-radius:50%;
  width:28px; height:28px; line-height:28px; display:inline-block;
}
.cal-ag-dow { display:block; font-size:10px; font-weight:700; color:var(--mt); text-transform:uppercase; }
.cal-ag-dom { display:block; font-size:22px; font-weight:900; color:var(--navy); line-height:1.1; }
.cal-ag-mon { display:block; font-size:10px; color:var(--mt); }
.cal-ag-today-badge {
  display:inline-block; background:var(--sky); color:#fff;
  font-size:9px; font-weight:700; padding:1px 5px; border-radius:8px; margin-top:2px;
}
.cal-ag-rows { flex:1; display:flex; flex-direction:column; gap:6px; }
.cal-ag-row {
  display:flex; gap:10px; align-items:flex-start;
  padding:8px 10px; background:var(--card); border:1px solid var(--br);
  border-radius:8px; cursor:pointer; position:relative;
}
.cal-ag-row:hover { background:var(--bg); }
.cal-ag-overdue { border-color:var(--rd)!important; }
.cal-ag-time { font-size:11px; font-weight:700; color:var(--mt); width:36px; flex-shrink:0; padding-top:1px; line-height:1.3; }
.cal-ag-body { flex:1; }
.cal-ag-title { font-size:13px; font-weight:700; color:var(--navy); margin-bottom:3px; }
.cal-ag-meta { display:flex; flex-wrap:wrap; gap:6px; font-size:11px; color:var(--mt); align-items:center; }
.cal-ag-meta span { display:inline-flex; align-items:center; gap:3px; }
.cal-ag-type-dot {
  width:8px; height:8px; border-radius:50%; flex-shrink:0; margin-top:4px;
}

/* ── Pool sektion ─────────────────────────────── */
.cal-pool-section {
  background:var(--card); border:1px solid var(--br);
  border-radius:10px; overflow:hidden; margin-top:12px;
}
.cal-pool-hdr {
  display:flex; align-items:center; gap:6px;
  font-size:12px; font-weight:700; color:var(--mt);
  padding:10px 14px; border-bottom:1px solid var(--br);
  background:var(--bg);
}
.cal-pool-items { display:flex; flex-wrap:wrap; gap:6px; padding:10px 14px; }
.cal-pool-chip {
  font-size:11px; font-weight:600; color:var(--navy);
  padding:4px 10px; border-radius:20px;
  display:inline-flex; align-items:center; gap:5px;
  white-space:nowrap;
}
.cal-pool-chip:hover { filter:brightness(.96); }

/* ── Mobilresponsivt ──────────────────────────── */
@media (max-width:640px) {
  .cal-toolbar { flex-wrap:wrap; gap:8px; }
  .cal-toolbar-right { width:100%; }
  .cal-period-label { font-size:12px; }
  .cal-mn-cell { min-height:60px; }
  .cal-mn-chip { display:none; }
  .cal-mn-more { display:block!important; font-size:9px; }
  .cal-wk-wrap { overflow-x:scroll; -webkit-overflow-scrolling:touch; }
  .cal-ag-section { flex-direction:row; gap:8px; }
  .cal-ag-date-hdr { width:40px; }
}
</style>`;
  }
};
