/**
 * RecurringPage — Återkommande ärenden
 */
const RecurringPage = {
  _tempChecklist: [],

  render() {
    const el = document.getElementById('pg-recurring-content');
    if (!el) return;
    const items = RecurringOrderService.getAll();

    el.innerHTML = `
      <div class="nbox" style="border-left:3px solid var(--sky);margin-bottom:2px;">
        <strong style="font-size:12px;color:var(--navy);">Om återkommande ärenden</strong>
        <p style="font-size:12px;color:var(--mt);margin-top:3px;line-height:1.4;">
          Schemalägg återkommande service, rondering eller underhåll. Systemet skapar automatiskt
          arbetsorder när det är dags, baserat på ditt valda intervall.
        </p>
      </div>

      <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
        <h3 style="flex:1;font-size:14px;font-weight:700;">Återkommande ärenden</h3>
        <button class="btn bp bsm" onclick="RecurringPage.openCreate()">
          ${ic('plus',14)} Nytt ärende
        </button>
      </div>

      ${items.length === 0
        ? `<div class="empty">${ic('refresh-cw',32)}<h3>Inga återkommande ärenden</h3>
             <p>Skapa mallar för regelbundet återkommande arbete – t.ex. månadsservice, kvartalskontroll eller veckorondering.</p>
             <button class="btn bp" style="margin-top:12px;" onclick="RecurringPage.openCreate()">${ic('plus',14)} Skapa första ärende</button>
           </div>`
        : items.map(ro => this._renderCard(ro)).join('')
      }`;
  },

  _renderCard(ro) {
    const cu = getCu(ro.customerId);
    const days = RecurringOrderService.daysUntilNext(ro);
    const daysStr = days === null ? '' : days < 0
      ? `<span class="bdg bdg-red" style="font-size:10px;">Förfallen ${Math.abs(days)} d</span>`
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
            ${(ro.checklist||[]).length > 0 ? `<span class="bdg bdg-grey" style="font-size:9px;">${ic('check-square',9)} ${ro.checklist.length}</span>` : ''}
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
    const chkHtml = (ro.checklist || []).length > 0
      ? `<div class="fg"><label>Checklistemall (${ro.checklist.length})</label><div style="margin-top:4px;">${
          ro.checklist.map(c => `<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--bg);">
            <span style="color:var(--gr);flex-shrink:0;margin-top:2px;">${ic('check-circle',13)}</span>
            <div><div style="font-size:13px;font-weight:600;">${c.text}</div>${c.description?`<div style="font-size:11px;color:var(--mt);">${c.description}</div>`:''}</div>
          </div>`).join('')
        }</div></div>` : '';

    const aoHistory = (state.workOrders||[]).filter(ao => ao.recurringOrderId === ro.id)
      .sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    const histHtml = aoHistory.length > 0
      ? `<div style="margin-top:12px;">
           <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">Skapade arbetsorder (${aoHistory.length})</div>
           ${aoHistory.slice(0,8).map(ao => {
             var cuAo = getCu(ao.customerId);
             return `<div class="crow" onclick="Modal.close();Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
               <div><div style="font-size:13px;font-weight:700;">${ao.id} – ${ao.title}</div>
               <div style="font-size:11px;color:var(--mt);">${fmtDate(ao.scheduledDate||ao.createdAt||'')}</div></div>
               ${sbdg(ao.status)}</div>`;
           }).join('')}
           ${aoHistory.length > 8 ? `<p style="font-size:11px;color:var(--mt);text-align:center;margin-top:4px;">+${aoHistory.length-8} till</p>` : ''}
         </div>` : '';

    Modal.open({
      title: ro.title,
      wide: true,
      body: `
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
          ${sbdg(ro.status)}
          ${pbdg(ro.priority)}
          <span class="bdg bdg-sky">${RecurringOrderService.intervalLabel(ro.interval)}</span>
        </div>
        <div class="dr"><span class="dk">Kund</span><span class="dv">${cu ? CustomerService.displayName(cu) : '—'}</span></div>
        ${ro.address ? `<div class="dr"><span class="dk">Arbetsadress</span><span class="dv">${ro.address}</span></div>` : ''}
        <div class="dr"><span class="dk">Nästa datum</span><span class="dv">${ro.nextDate ? fmtDate(ro.nextDate) : '—'}${days !== null && days <= 0 ? ` <span class="bdg bdg-red" style="font-size:10px;">Förfallen</span>` : ''}</span></div>
        ${ro.lastCreatedDate ? `<div class="dr"><span class="dk">Senast skapad</span><span class="dv">${fmtDate(ro.lastCreatedDate)}</span></div>` : ''}
        <div class="dr"><span class="dk">Intervall</span><span class="dv">${RecurringOrderService.intervalLabel(ro.interval)}${ro.interval==='eget'?' ('+ro.intervalDays+' dagar)':''}</span></div>
        <div class="dr"><span class="dk">Slutdatum</span><span class="dv">${ro.tillsvidare ? 'Tillsvidare' : (fmtDate(ro.endDate) || '—')}</span></div>
        ${ro.description ? `<div class="nbox" style="margin-top:8px;">${ro.description}</div>` : ''}
        ${chkHtml}
        ${histHtml}`,
      buttons: [
        { label: 'Skapa AO nu', cls: 'btn bsu', onClick: () => {
          Modal.close();
          RecurringPage._createAO(roId);
        }},
        { label: 'Redigera', cls: 'btn bs', onClick: () => {
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

    // Seed temp checklist
    this._tempChecklist = ro ? (ro.checklist || []).map(c => ({ text: c.text })) : [];

    const intervals = RecurringOrderService.INTERVALS;
    const activeStaff = (state.staff||[]).filter(s=>s.active);
    const staffHtml = activeStaff.length === 0
      ? '<p style="font-size:12px;color:var(--mt);margin:0;padding:4px 0;">Inga aktiva medarbetare registrerade</p>'
      : activeStaff.map(s => {
          const chk = ro && (ro.staff||[]).includes(s.id) ? 'checked' : '';
          return `<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer;font-size:13px;font-weight:500;letter-spacing:0;text-transform:none;border-radius:6px;" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
            <input type="checkbox" class="ro-staff-cb" value="${s.id}" ${chk} style="width:15px;height:15px;accent-color:var(--sky);">
            <span>${s.firstName} ${s.lastName}${s.title ? ' <span style="color:var(--mt);font-size:11px;">– ' + s.title + '</span>' : ''}</span>
          </label>`;
        }).join('');

    // Determine address mode for edit
    const roAddr = ro ? (ro.address || '') : '';
    const cu0 = ro ? getCu(ro.customerId) : null;
    const cu0Addr = cu0 ? [cu0.address, cu0.zip, cu0.city].filter(Boolean).join(', ') : '';
    const addrIsCu = roAddr === cu0Addr || !roAddr;
    const addrMode = addrIsCu ? 'cu' : 'custom';

    Modal.open({
      title: isEdit ? 'Redigera återkommande ärende' : 'Nytt återkommande ärende',
      wide: true,
      body: `
        <div class="fg"><label>Titel <span style="color:var(--rd)">*</span></label>
          <input id="ro-title" value="${ro ? ro.title : ''}" placeholder="T.ex. Månadsservice VVS, Kvartalskontroll"></div>

        <div class="g2">
          <div class="fg"><label>Kund</label>
            <select id="ro-cu" onchange="RecurringPage._customerChanged()">
              <option value="">— Välj kund —</option>
              ${(state.customers||[]).map(c=>`<option value="${c.id}" ${ro&&ro.customerId===c.id?'selected':''}>${CustomerService.displayName(c)}</option>`).join('')}
            </select></div>
          <div class="fg"><label>Prioritet</label>
            <select id="ro-priority">
              ${['akut','hög','normal','låg'].map(p=>`<option value="${p}" ${ro&&ro.priority===p?'selected':''}>${priorityLabel(p)}</option>`).join('')}
            </select></div>
        </div>

        <div class="fg">
          <label>Arbetsadress</label>
          <div style="margin-top:4px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;cursor:pointer;">
              <input type="radio" name="ro-addr-mode" id="ro-addr-cu" value="cu"
                ${addrMode==='cu'?'checked':''} onchange="RecurringPage._addrModeChanged()">
              Använd kundens adress
            </label>
            <div id="ro-cu-addr-display" style="font-size:12px;color:var(--mt);margin-left:22px;">${cu0Addr || '(välj kund ovan)'}</div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;cursor:pointer;">
              <input type="radio" name="ro-addr-mode" id="ro-addr-custom" value="custom"
                ${addrMode==='custom'?'checked':''} onchange="RecurringPage._addrModeChanged()">
              Annan arbetsadress
            </label>
          </div>
          <div id="ro-addr-custom-wrap" style="${addrMode==='custom'?'':'display:none'}">
            <input id="ro-address" value="${addrMode==='custom' ? roAddr : ''}" placeholder="Gatuadress, postnummer, ort"></div>
        </div>

        <div class="fg"><label>Beskrivning</label>
          <textarea id="ro-desc" rows="2" placeholder="Vad ska utföras vid varje tillfälle?">${ro ? ro.description||'' : ''}</textarea></div>

        <div class="g2">
          <div class="fg"><label>Intervall</label>
            <select id="ro-interval" onchange="RecurringPage._toggleCustomInterval()">
              ${intervals.map(i=>`<option value="${i.value}" ${ro&&ro.interval===i.value?'selected':''}>${i.label}</option>`).join('')}
            </select></div>
          <div class="fg" id="ro-custom-wrap" style="display:none;">
            <label>Antal dagar</label>
            <input type="number" id="ro-days" value="${ro ? ro.intervalDays||30 : 30}" min="1" max="365"></div>
        </div>

        <div class="g2">
          <div class="fg"><label>Startdatum</label>
            <input type="date" id="ro-start" value="${ro ? ro.startDate||tdy() : tdy()}"></div>
          <div class="fg"><label>Nästa datum</label>
            <input type="date" id="ro-next" value="${ro ? ro.nextDate||tdy() : tdy()}"></div>
        </div>

        <div class="fg">
          <label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13px;font-weight:600;letter-spacing:0;cursor:pointer;">
            <input type="checkbox" id="ro-tillsvidare" ${!ro||ro.tillsvidare?'checked':''}
              onchange="RecurringPage._toggleEndDate()">
            Tillsvidare (inget slutdatum)
          </label>
        </div>
        <div class="fg" id="ro-enddate-wrap" style="${ro&&!ro.tillsvidare?'':'display:none'}">
          <label>Slutdatum</label>
          <input type="date" id="ro-end" value="${ro ? ro.endDate||'' : ''}"></div>

        <div class="fg"><label>Personal</label>
          <div style="border:1px solid var(--br);border-radius:8px;padding:4px;max-height:130px;overflow-y:auto;background:#fff;">
            ${staffHtml}
          </div></div>

        <div class="fg"><label>Prisgrupp</label>
          <select id="ro-pg">
            <option value="">— Ingen —</option>
            ${(state.priceGroups||[]).filter(p=>p.active).map(p=>`<option value="${p.id}" ${ro&&ro.priceGroupId===p.id?'selected':''}>${p.name} – ${fmt(p.hourRate)} kr/tim ex moms</option>`).join('')}
          </select></div>

        <div class="fg">
          <label>Checklistemall</label>
          <div id="ro-checklist-items" style="margin-bottom:8px;"></div>
          <div style="display:flex;gap:6px;">
            <input id="ro-chk-input" placeholder="Rubrik…" style="flex:1;"
              onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('ro-chk-desc')?.focus();}">
            <button class="btn bs bsm" type="button" onclick="RecurringPage._addCheckItem()">Lägg till</button>
          </div>
          <input id="ro-chk-desc" placeholder="Beskrivning (valfritt)…" style="margin-top:4px;"
            onkeydown="if(event.key==='Enter'){event.preventDefault();RecurringPage._addCheckItem();}">
        </div>

        <div class="fg"><label>Internanteckning</label>
          <textarea id="ro-note" rows="2" placeholder="Syns ej för kund">${ro ? ro.internalNote||'' : ''}</textarea></div>`,
      buttons: [
        { label: isEdit ? 'Spara ändringar' : 'Skapa ärende', cls: 'btn bp', onClick: () => RecurringPage._save(roId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });

    setTimeout(() => {
      RecurringPage._toggleCustomInterval();
      RecurringPage._renderChecklistItems();
      if (ro && !ro.tillsvidare) document.getElementById('ro-enddate-wrap').style.display = '';
      document.getElementById('ro-title')?.focus();
    }, 80);
  },

  _customerChanged() {
    const cuId = document.getElementById('ro-cu')?.value;
    const cu   = cuId ? getCu(cuId) : null;
    const addr = cu ? [cu.address, cu.zip, cu.city].filter(Boolean).join(', ') : '';
    const display = document.getElementById('ro-cu-addr-display');
    if (display) display.textContent = addr || '(ingen adress registrerad)';
    // If "kundens adress" mode is selected, update address field too
    const isCuMode = document.getElementById('ro-addr-cu')?.checked;
    if (isCuMode) {
      const addrInput = document.getElementById('ro-address');
      if (addrInput) addrInput.value = addr;
    }
  },

  _addrModeChanged() {
    const isCu  = document.getElementById('ro-addr-cu')?.checked;
    const wrap  = document.getElementById('ro-addr-custom-wrap');
    if (wrap) wrap.style.display = isCu ? 'none' : '';
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

  _addCheckItem() {
    const input = document.getElementById('ro-chk-input');
    const desc  = document.getElementById('ro-chk-desc');
    const text  = input?.value.trim();
    if (!text) { input?.focus(); return; }
    this._tempChecklist.push({ text, description: desc?.value.trim() || '' });
    input.value = '';
    if (desc) desc.value = '';
    input.focus();
    this._renderChecklistItems();
  },

  _removeCheckItem(idx) {
    this._tempChecklist.splice(idx, 1);
    this._renderChecklistItems();
  },

  _renderChecklistItems() {
    const el = document.getElementById('ro-checklist-items');
    if (!el) return;
    if (this._tempChecklist.length === 0) {
      el.innerHTML = '<p style="font-size:12px;color:var(--mt);margin:0 0 4px;">Inga kontrollpunkter tillagda</p>';
      return;
    }
    el.innerHTML = this._tempChecklist.map((item, idx) => `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:8px;border:1px solid var(--br);background:#fff;border-radius:6px;margin-bottom:4px;">
        <span style="color:var(--gr);flex-shrink:0;margin-top:2px;">${ic('check-circle',14)}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${item.text}</div>
          ${item.description ? `<div style="font-size:11px;color:var(--mt);margin-top:2px;">${item.description}</div>` : ''}
        </div>
        <button class="btn bxs bd" type="button" onclick="RecurringPage._removeCheckItem(${idx})" style="flex-shrink:0;">${ic('trash',11)}</button>
      </div>`).join('');
  },

  _save(roId) {
    const title = document.getElementById('ro-title')?.value.trim();
    if (!title) { showToast('Titel krävs'); return; }

    const tillsvidare = document.getElementById('ro-tillsvidare')?.checked !== false;
    const interval    = document.getElementById('ro-interval')?.value || 'månadsvis';
    const days        = parseInt(document.getElementById('ro-days')?.value) || 30;

    // Resolve address
    const isCuAddr = document.getElementById('ro-addr-cu')?.checked;
    let address = '';
    if (isCuAddr) {
      const cuId = document.getElementById('ro-cu')?.value;
      const cu   = cuId ? getCu(cuId) : null;
      address = cu ? [cu.address, cu.zip, cu.city].filter(Boolean).join(', ') : '';
    } else {
      address = document.getElementById('ro-address')?.value.trim() || '';
    }

    const staffCbs = document.querySelectorAll('.ro-staff-cb:checked');
    const staff    = Array.from(staffCbs).map(cb => cb.value);

    const data = {
      title,
      customerId:   document.getElementById('ro-cu')?.value || '',
      address,
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
      checklist:    this._tempChecklist.slice(),
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
