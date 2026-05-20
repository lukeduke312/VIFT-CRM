/**
 * RecurringPage — Återkommande ärenden
 */
const RecurringPage = {

  render() {
    const el = document.getElementById('pg-recurring-content');
    if (!el) return;
    const items = RecurringOrderService.getAll();

    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
        <h3 style="flex:1;font-size:14px;font-weight:700;">Återkommande ärenden</h3>
        <button class="btn bp bsm" onclick="RecurringPage.openCreate()">
          ${ic('plus',14)} Nytt ärende
        </button>
      </div>

      ${items.length === 0
        ? `<div class="empty">${ic('refresh-cw',32)}<h3>Inga återkommande ärenden</h3>
             <p>Skapa mall för regelbundet återkommande arbete</p>
             <button class="btn bp" style="margin-top:12px;" onclick="RecurringPage.openCreate()">${ic('plus',14)} Skapa ärende</button>
           </div>`
        : items.map(ro => this._renderCard(ro)).join('')
      }`;
  },

  _renderCard(ro) {
    const cu = getCu(ro.customerId);
    const days = RecurringOrderService.daysUntilNext(ro);
    const daysStr = days === null ? '' : days < 0 ? `<span class="bdg bdg-red" style="font-size:10px;">Förfallen ${Math.abs(days)} dagar</span>`
      : days === 0 ? `<span class="bdg bdg-orange">Idag</span>`
      : days <= 7  ? `<span class="bdg bdg-orange">${days} dagar</span>`
      : `<span class="bdg bdg-grey">${days} dagar</span>`;
    const stCls = { aktiv: 'bdg-green', pausad: 'bdg-yellow', avslutad: 'bdg-grey' }[ro.status] || 'bdg-grey';
    const stLbl = { aktiv: 'Aktiv', pausad: 'Pausad', avslutad: 'Avslutad' }[ro.status] || ro.status;

    return `
      <div class="list-item p-${ro.priority || 'normal'}" onclick="RecurringPage.openDetail('${ro.id}')">
        <div class="item-row">
          <div style="flex:1;min-width:0;">
            <div class="item-title">${ro.title}</div>
            <div class="item-sub">${cu ? CustomerService.displayName(cu) : '—'} · ${RecurringOrderService.intervalLabel(ro.interval)}</div>
            ${ro.nextDate ? `<div style="font-size:11px;color:var(--mt);margin-top:3px;">${ic('calendar',11)} Nästa: ${fmtDate(ro.nextDate)} ${daysStr}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
            <span class="bdg ${stCls}">${stLbl}</span>
          </div>
        </div>
      </div>`;
  },

  openCreate() {
    this._openForm(null);
  },

  openDetail(roId) {
    const ro = RecurringOrderService.getById(roId);
    if (!ro) return;
    const cu = getCu(ro.customerId);
    const days = RecurringOrderService.daysUntilNext(ro);
    const chkCount = (ro.checklist || []).length;

    Modal.open({
      title: ro.title,
      wide: true,
      body: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
          ${sbdg(ro.status)}
          ${pbdg(ro.priority)}
          <span class="bdg bdg-sky">${RecurringOrderService.intervalLabel(ro.interval)}</span>
        </div>
        <div class="dr"><span class="dk">Kund</span><span class="dv">${cu ? CustomerService.displayName(cu) : '—'}</span></div>
        ${ro.address ? `<div class="dr"><span class="dk">Adress</span><span class="dv">${ro.address}</span></div>` : ''}
        <div class="dr"><span class="dk">Nästa datum</span><span class="dv">${ro.nextDate ? fmtDate(ro.nextDate) : '—'}${days !== null && days <= 0 ? ` <span class="bdg bdg-red" style="font-size:10px;">Förfallen</span>` : ''}</span></div>
        ${ro.lastCreatedDate ? `<div class="dr"><span class="dk">Senast skapad</span><span class="dv">${fmtDate(ro.lastCreatedDate)}</span></div>` : ''}
        <div class="dr"><span class="dk">Intervall</span><span class="dv">${RecurringOrderService.intervalLabel(ro.interval)}${ro.interval==='eget'?' ('+ro.intervalDays+' dagar)':''}</span></div>
        <div class="dr"><span class="dk">Slutdatum</span><span class="dv">${ro.tillsvidare ? 'Tillsvidare' : (fmtDate(ro.endDate) || '—')}</span></div>
        ${chkCount > 0 ? `<div class="dr"><span class="dk">Checklistemall</span><span class="dv">${chkCount} punkter</span></div>` : ''}
        ${ro.description ? `<div class="nbox" style="margin-top:8px;">${ro.description}</div>` : ''}`,
      buttons: [
        { label: `${ic('play-circle',14)} Skapa AO nu`, cls: 'btn bsu', onClick: () => {
          Modal.close();
          RecurringPage._createAO(roId);
        }},
        { label: `${ic('pencil',14)} Redigera`, cls: 'btn bs', onClick: () => {
          Modal.close();
          RecurringPage._openForm(roId);
        }},
        { label: ro.status==='aktiv' ? 'Pausa' : 'Aktivera', cls: 'btn bw', onClick: () => {
          const newStatus = ro.status === 'aktiv' ? 'pausad' : 'aktiv';
          RecurringOrderService.update(roId, { status: newStatus });
          Modal.close();
          RecurringPage.render();
          showToast(newStatus === 'aktiv' ? 'Aktiverat' : 'Pausat');
        }},
        { label: 'Stäng', cls: 'btn bghost', onClick: () => Modal.close() }
      ]
    });
  },

  _createAO(roId) {
    const result = RecurringOrderService.createNextAO(roId);
    if (!result.ok) { showToast(result.error); return; }
    RecurringPage.render();
    showToast(`${result.ao.id} skapad`);
    Router.showPage('pg-ao-detail', { aoId: result.ao.id });
  },

  _openForm(roId) {
    const ro  = roId ? RecurringOrderService.getById(roId) : null;
    const isEdit = !!ro;
    const intervals = RecurringOrderService.INTERVALS;

    const staffHtml = (state.staff||[]).filter(s=>s.active).map(s => {
      const sel = ro && (ro.staff||[]).includes(s.id) ? 'selected' : '';
      return `<option value="${s.id}" ${sel}>${s.firstName} ${s.lastName}${s.title?' – '+s.title:''}</option>`;
    }).join('');

    Modal.open({
      title: isEdit ? 'Redigera återkommande ärende' : 'Nytt återkommande ärende',
      wide: true,
      body: `
        <div class="fg"><label>Titel <span style="color:var(--rd)">*</span></label>
          <input id="ro-title" value="${ro ? ro.title : ''}" placeholder="T.ex. Månadsservice vvs"></div>
        <div class="g2">
          <div class="fg"><label>Kund</label>
            <select id="ro-cu">
              <option value="">— Välj kund —</option>
              ${(state.customers||[]).map(c=>`<option value="${c.id}" ${ro&&ro.customerId===c.id?'selected':''}>${CustomerService.displayName(c)}</option>`).join('')}
            </select></div>
          <div class="fg"><label>Prioritet</label>
            <select id="ro-priority">
              ${['akut','hög','normal','låg'].map(p=>`<option value="${p}" ${ro&&ro.priority===p?'selected':''}>${priorityLabel(p)}</option>`).join('')}
            </select></div>
        </div>
        <div class="fg"><label>Adress</label>
          <input id="ro-address" value="${ro ? ro.address||'' : ''}" placeholder="Gatuadress"></div>
        <div class="fg"><label>Beskrivning</label>
          <textarea id="ro-desc" rows="2" placeholder="Vad ska utföras?">${ro ? ro.description||'' : ''}</textarea></div>
        <div class="g2">
          <div class="fg"><label>Intervall</label>
            <select id="ro-interval" onchange="RecurringPage._toggleCustomInterval()">
              ${intervals.map(i=>`<option value="${i.value}" ${ro&&ro.interval===i.value?'selected':''}>${i.label}</option>`).join('')}
            </select></div>
          <div class="fg" id="ro-custom-wrap" style="display:none;">
            <label>Antal dagar</label>
            <input type="number" id="ro-days" value="${ro ? ro.intervalDays||30 : 30}" min="1" max="365" placeholder="30"></div>
        </div>
        <div class="g2">
          <div class="fg"><label>Startdatum</label>
            <input type="date" id="ro-start" value="${ro ? ro.startDate||tdy() : tdy()}"></div>
          <div class="fg"><label>Nästa datum</label>
            <input type="date" id="ro-next" value="${ro ? ro.nextDate||tdy() : tdy()}"></div>
        </div>
        <div class="fg">
          <label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13px;font-weight:600;letter-spacing:0;">
            <input type="checkbox" id="ro-tillsvidare" ${!ro||ro.tillsvidare?'checked':''} onchange="RecurringPage._toggleEndDate()">
            Tillsvidare (inget slutdatum)
          </label>
        </div>
        <div class="fg" id="ro-enddate-wrap" style="display:${ro&&!ro.tillsvidare?'':'none'}">
          <label>Slutdatum</label>
          <input type="date" id="ro-end" value="${ro ? ro.endDate||'' : ''}"></div>
        <div class="fg"><label>Personal</label>
          <select id="ro-staff" multiple style="height:80px;">
            ${staffHtml}
          </select>
          <span class="field-hint">Håll Ctrl/Cmd för att välja flera</span>
        </div>
        <div class="fg"><label>Prisgrupp</label>
          <select id="ro-pg">
            <option value="">— Ingen —</option>
            ${(state.priceGroups||[]).filter(p=>p.active).map(p=>`<option value="${p.id}" ${ro&&ro.priceGroupId===p.id?'selected':''}>${p.name} – ${fmt(p.hourRate)} kr/tim ex moms</option>`).join('')}
          </select></div>
        <div class="fg"><label>Checklistemall (en punkt per rad)</label>
          <textarea id="ro-checklist" rows="4" placeholder="Inspektera vvs-centralen&#10;Kontrollera trycknivå&#10;Rengöra filter">${ro ? (ro.checklist||[]).map(c=>c.text).join('\n') : ''}</textarea></div>
        <div class="fg"><label>Internanteckning</label>
          <textarea id="ro-note" rows="2" placeholder="Syns ej för kund">${ro ? ro.internalNote||'' : ''}</textarea></div>`,
      buttons: [
        { label: isEdit ? 'Spara' : 'Skapa ärende', cls: 'btn bp', onClick: () => RecurringPage._save(roId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });

    setTimeout(() => {
      RecurringPage._toggleCustomInterval();
      if (ro && !ro.tillsvidare) document.getElementById('ro-enddate-wrap').style.display = '';
      document.getElementById('ro-title')?.focus();
    }, 80);
  },

  _toggleCustomInterval() {
    const val  = document.getElementById('ro-interval')?.value;
    const wrap = document.getElementById('ro-custom-wrap');
    if (wrap) wrap.style.display = val === 'eget' ? '' : 'none';
  },

  _toggleEndDate() {
    const checked = document.getElementById('ro-tillsvidare')?.checked;
    const wrap    = document.getElementById('ro-enddate-wrap');
    if (wrap) wrap.style.display = checked ? 'none' : '';
  },

  _save(roId) {
    const title = document.getElementById('ro-title')?.value.trim();
    if (!title) { showToast('Titel krävs'); return; }

    const tillsvidare = document.getElementById('ro-tillsvidare')?.checked !== false;
    const interval    = document.getElementById('ro-interval')?.value || 'månadsvis';
    const days        = parseInt(document.getElementById('ro-days')?.value) || 30;

    const chkText = document.getElementById('ro-checklist')?.value || '';
    const checklist = chkText.split('\n').map(s=>s.trim()).filter(Boolean).map(text => ({ text }));

    const staffEl = document.getElementById('ro-staff');
    const staff   = staffEl ? Array.from(staffEl.selectedOptions).map(o=>o.value) : [];

    const data = {
      title,
      customerId:   document.getElementById('ro-cu')?.value || '',
      address:      document.getElementById('ro-address')?.value.trim() || '',
      description:  document.getElementById('ro-desc')?.value.trim() || '',
      priority:     document.getElementById('ro-priority')?.value || 'normal',
      interval,
      intervalDays: days,
      startDate:    document.getElementById('ro-start')?.value || tdy(),
      nextDate:     document.getElementById('ro-next')?.value || tdy(),
      tillsvidare,
      endDate:      tillsvidare ? '' : (document.getElementById('ro-end')?.value || ''),
      priceGroupId: document.getElementById('ro-pg')?.value || '',
      staff,
      checklist,
      internalNote: document.getElementById('ro-note')?.value.trim() || '',
      status:       'aktiv'
    };

    if (roId) {
      RecurringOrderService.update(roId, data);
      showToast('Ärende uppdaterat');
    } else {
      RecurringOrderService.create(data);
      showToast('Återkommande ärende skapat');
    }
    Modal.close();
    RecurringPage.render();
  }
};
