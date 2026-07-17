/**
 * RecurringPage — Återkommande ärenden
 */
const RecurringPage = {
  _tempChecklist: [],
  _tempStaff: [],

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
    const isOverdue  = days !== null && days < 0;
    const isSoon     = days !== null && days >= 0 && days <= 7;
    const isInactive = ro.status === 'pausad' || ro.status === 'avslutad';
    const leftBorder = isOverdue ? 'border-left:3px solid var(--rd);'
      : isSoon      ? 'border-left:3px solid var(--or);'
      : !isInactive ? 'border-left:3px solid var(--gr);'
      :               'border-left:3px solid var(--br);';
    const daysLabel = days === null ? '' : days < 0
      ? `<span style="color:var(--rd);font-weight:700;">Förfallen ${Math.abs(days)} d sedan</span>`
      : days === 0 ? `<span style="color:var(--or);font-weight:700;">Idag</span>`
      : days <= 7  ? `<span style="color:var(--or);">Om ${days} dagar</span>`
      : `<span style="color:var(--mt);">Om ${days} dagar</span>`;
    const stCls = { aktiv: 'bdg-green', pausad: 'bdg-grey', avslutad: 'bdg-grey' }[ro.status] || 'bdg-grey';
    const stLbl = { aktiv: 'Aktiv', pausad: 'Pausad', avslutad: 'Avslutad' }[ro.status] || ro.status;

    return `
      <div class="list-item" style="${leftBorder}" onclick="RecurringPage.openDetail('${ro.id}')">
        <div class="item-row">
          <div style="flex:1;min-width:0;">
            <div class="item-title">${ro.title}</div>
            <div class="item-sub">${cu ? CustomerService.displayName(cu) : '—'} · ${RecurringOrderService.intervalLabel(ro.interval)}</div>
            ${ro.nextDate ? `<div style="font-size:11px;margin-top:3px;display:flex;align-items:center;gap:5px;">${ic('calendar',10)} <span style="color:var(--mt);">Nästa: ${fmtDate(ro.nextDate)}</span> ${daysLabel}</div>` : ''}
          </div>
          <span class="bdg ${stCls}" style="align-self:flex-start;">${stLbl}</span>
        </div>
      </div>`;
  },

  openCreate() {
    this._openForm(null);
  },

  /* Pre-fill form from an existing AO to make it recurring */
  openFromAO(aoId) {
    const ao = getAO(aoId);
    if (!ao) return;
    const prefill = {
      title:        ao.title,
      description:  ao.description || '',
      customerId:   ao.customerId || '',
      address:      ao.address || '',
      category:     ao.category || '',
      priority:     ao.priority || 'normal',
      priceGroupId: ao.priceGroupId || '',
      propertyId:   ao.propertyId || '',
      staff:        (ao.staff || []).slice(),
      checklist:    (ao.checklist || []).map(c => ({ text: c.text, description: c.description || '' }))
    };
    this._openForm(null, prefill);
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

    const staffNames = (ro.staff || []).map(id => {
      const s = getStaff(id);
      return s ? `${s.firstName} ${s.lastName}` : id;
    });

    const aoHistory = (state.workOrders||[]).filter(ao => ao.recurringOrderId === ro.id)
      .sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    const histHtml = aoHistory.length > 0
      ? `<div style="margin-top:12px;">
           <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">Skapade arbetsorder (${aoHistory.length})</div>
           ${aoHistory.slice(0,8).map(ao => {
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
        ${ro.accessCode ? `<div class="dr"><span class="dk">Portkod</span><span class="dv">${ro.accessCode}</span></div>` : ''}
        ${staffNames.length ? `<div class="dr"><span class="dk">Personal</span><span class="dv">${staffNames.join(', ')}</span></div>` : ''}
        <div class="dr"><span class="dk">Nästa datum</span><span class="dv">${ro.nextDate ? fmtDate(ro.nextDate) : '—'}${days !== null && days <= 0 ? ` <span class="bdg bdg-red" style="font-size:10px;">Förfallen</span>` : ''}</span></div>
        ${ro.lastCreatedDate ? `<div class="dr"><span class="dk">Senast skapad</span><span class="dv">${fmtDate(ro.lastCreatedDate)}</span></div>` : ''}
        <div class="dr"><span class="dk">Intervall</span><span class="dv">${RecurringOrderService.intervalLabel(ro.interval)}${ro.interval==='eget'?' ('+ro.intervalDays+' dagar)':''}</span></div>
        <div class="dr"><span class="dk">Slutdatum</span><span class="dv">${ro.tillsvidare ? 'Tillsvidare' : (fmtDate(ro.endDate) || '—')}</span></div>
        ${ro.description ? `<div class="nbox" style="margin-top:8px;">${ro.description}</div>` : ''}
        <div class="nbox" style="margin-top:8px;border-left:3px solid var(--sky);">
          <strong style="font-size:11px;color:var(--navy);">Nästa arbetsorder</strong>
          <p style="font-size:12px;color:var(--mt);margin-top:3px;">
            Tryck på <strong>Skapa AO nu</strong> för att omedelbart skapa en arbetsorder från den här mallen.
            Nästa datum räknas automatiskt framåt med valt intervall.
          </p>
        </div>
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
    Sidebar.updateBadges();
    showToast(`${result.ao.id} skapad`);
    Router.showPage('pg-ao-detail', { aoId: result.ao.id });
  },

  _openForm(roId, prefill) {
    const ro  = roId ? RecurringOrderService.getById(roId) : null;
    const isEdit = !!ro;
    const pf  = prefill || {};

    // Seed temp arrays — preserve descriptions when editing, use prefill when creating from AO
    this._tempChecklist = ro
      ? (ro.checklist || []).map(c => ({ text: c.text, description: c.description || '' }))
      : (pf.checklist || []).map(c => ({ text: c.text, description: c.description || '' }));
    this._tempStaff = ro ? (ro.staff || []).slice() : (pf.staff || []).slice();

    // Source values (edit = ro, new from AO = pf, blank = {})
    const src = ro || pf;

    const intervals = RecurringOrderService.INTERVALS;

    // Address mode — parse stored address back into fields (best-effort)
    const roAddr  = src.address || '';
    const cu0     = src.customerId ? getCu(src.customerId) : null;
    const cu0Addr = cu0 ? [cu0.address, cu0.zip, cu0.city].filter(Boolean).join(', ') : '';
    const addrIsCu = (roAddr === cu0Addr || !roAddr);
    const addrMode = addrIsCu ? 'cu' : 'custom';

    // Try to parse existing address string into street / zip / city
    var parsedStreet = '', parsedZip = '', parsedCity = '';
    if (addrMode === 'custom' && roAddr) {
      var parts = roAddr.split(',').map(function(p){ return p.trim(); });
      parsedStreet = parts[0] || '';
      var rest = parts[1] || '';
      var zipMatch = rest.match(/^(\d{3}\s?\d{2})\s+(.+)$/);
      if (zipMatch) { parsedZip = zipMatch[1]; parsedCity = zipMatch[2]; }
      else { parsedCity = rest; }
    }

    Modal.open({
      title: isEdit ? 'Redigera återkommande ärende' : (pf.title ? 'Gör återkommande' : 'Nytt återkommande ärende'),
      wide: true,
      body: `
        <div class="fg"><label>Titel <span style="color:var(--rd)">*</span></label>
          <input id="ro-title" value="${src.title || ''}" placeholder="T.ex. Månadsservice VVS, Kvartalskontroll"></div>

        <div class="g2">
          <div class="fg"><label>Kund</label>
            <select id="ro-cu" onchange="RecurringPage._customerChanged()">
              <option value="">— Välj kund —</option>
              ${(state.customers||[]).map(c=>`<option value="${c.id}" ${src.customerId===c.id?'selected':''}>${CustomerService.displayName(c)}</option>`).join('')}
            </select></div>
          <div class="fg"><label>Prioritet</label>
            <select id="ro-priority">
              ${['akut','hög','normal','låg'].map(p=>`<option value="${p}" ${(src.priority||'normal')===p?'selected':''}>${priorityLabel(p)}</option>`).join('')}
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
            <div class="fg" style="margin-bottom:6px;">
              <label>Gatuadress</label>
              <input id="ro-street" value="${parsedStreet}" placeholder="Storgatan 1"
                autocomplete="off"
                oninput="AddressService.handleInput(this)"
                onblur="setTimeout(()=>AddressService.hideSuggestions(),150)"
                data-addr-zip="ro-zip" data-addr-city="ro-city"></div>
            <div class="g2" style="margin-bottom:6px;">
              <div class="fg"><label>Postnummer</label>
                <input id="ro-zip" value="${parsedZip}" placeholder="123 45"></div>
              <div class="fg"><label>Ort</label>
                <input id="ro-city" value="${parsedCity}" placeholder="Stockholm"></div>
            </div>
            <div class="fg">
              <label>Portkod / åtkomst</label>
              <input id="ro-access" value="${src.accessCode||''}" placeholder="T.ex. 1234#"></div>
          </div>
        </div>

        <div class="fg"><label>Beskrivning</label>
          <textarea id="ro-desc" rows="2" placeholder="Vad ska utföras vid varje tillfälle?">${src.description || ''}</textarea></div>

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

        <div class="fg">
          <label>Personal</label>
          <div id="ro-staff-chips" style="display:flex;flex-wrap:wrap;gap:6px;min-height:32px;padding:4px 0;"></div>
          <button type="button" class="btn bs bsm" style="margin-top:4px;" onclick="RecurringPage._openStaffPicker()">
            ${ic('users',13)} Välj personal
          </button>
        </div>

        <div class="fg"><label>Prisgrupp</label>
          <select id="ro-pg">
            <option value="">— Ingen —</option>
            ${(state.priceGroups||[]).filter(p=>p.active).map(p=>`<option value="${p.id}" ${(src.priceGroupId||'')===p.id?'selected':''}>${p.name} – ${fmt(p.hourRate)} kr/tim ex moms</option>`).join('')}
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
      RecurringPage._rpmUpdateChips();
      if (ro && !ro.tillsvidare) document.getElementById('ro-enddate-wrap').style.display = '';
      document.getElementById('ro-title')?.focus();
    }, 80);
  },

  /* ── Staff picker (AO-style modal) ─────────── */

  _openStaffPicker() {
    const active = (state.staff||[]).filter(s => s.active);
    Modal.open({
      title: 'Välj personal',
      wide: false,
      body: `
        <div class="fg" style="margin-bottom:8px;">
          <input id="rpm-search" placeholder="Sök namn…" oninput="RecurringPage._rpmSearch(this.value)" autocomplete="off">
        </div>
        <div id="rpm-list" style="max-height:300px;overflow-y:auto;">
          ${active.length ? this._rpmItems(active) : '<p style="font-size:12px;color:var(--mt);padding:8px 0;">Inga aktiva medarbetare registrerade</p>'}
        </div>`,
      buttons: [
        { label: 'Klar', cls: 'btn bp', onClick: () => { Modal.close(); RecurringPage._rpmUpdateChips(); } },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('rpm-search')?.focus(), 80);
  },

  _rpmItems(staffArr) {
    return staffArr.map(s => {
      const sel = this._tempStaff.includes(s.id);
      return `
        <div class="crow" id="rpm-row-${s.id}" onclick="RecurringPage._rpmToggle('${s.id}')"
          style="background:${sel ? 'var(--navy10,#eef2ff)' : ''};">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${s.firstName} ${s.lastName}</div>
            ${s.title ? `<div style="font-size:11px;color:var(--mt);">${s.title}</div>` : ''}
          </div>
          <div id="rpm-chk-${s.id}" style="color:var(--grn);${sel ? '' : 'display:none'}">${ic('check-circle',16)}</div>
        </div>`;
    }).join('');
  },

  _rpmToggle(staffId) {
    const idx = this._tempStaff.indexOf(staffId);
    if (idx === -1) {
      this._tempStaff.push(staffId);
    } else {
      this._tempStaff.splice(idx, 1);
    }
    const row = document.getElementById('rpm-row-' + staffId);
    const chk = document.getElementById('rpm-chk-' + staffId);
    const sel = this._tempStaff.includes(staffId);
    if (row) row.style.background = sel ? 'var(--navy10,#eef2ff)' : '';
    if (chk) chk.style.display    = sel ? '' : 'none';
  },

  _rpmSearch(q) {
    const lq = q.toLowerCase();
    document.querySelectorAll('#rpm-list .crow').forEach(row => {
      const name = row.querySelector('[style*="font-weight:700"]')?.textContent || '';
      row.style.display = !lq || name.toLowerCase().includes(lq) ? '' : 'none';
    });
  },

  _rpmRemove(staffId) {
    const idx = this._tempStaff.indexOf(staffId);
    if (idx !== -1) this._tempStaff.splice(idx, 1);
    this._rpmUpdateChips();
  },

  _rpmUpdateChips() {
    const el = document.getElementById('ro-staff-chips');
    if (!el) return;
    if (!this._tempStaff.length) {
      el.innerHTML = '<span style="font-size:12px;color:var(--mt);">Ingen personal vald</span>';
      return;
    }
    el.innerHTML = this._tempStaff.map(id => {
      const s = getStaff(id);
      if (!s) return '';
      return `
        <span style="display:inline-flex;align-items:center;gap:4px;background:var(--navy10,#eef2ff);color:var(--navy);border-radius:20px;padding:3px 8px;font-size:12px;font-weight:600;">
          ${s.firstName} ${s.lastName}
          <button type="button" onclick="RecurringPage._rpmRemove('${id}')" style="background:none;border:none;cursor:pointer;padding:0;line-height:1;color:var(--mt);">${ic('x',11)}</button>
        </span>`;
    }).join('');
  },

  /* ── Address helpers ──────────────────────── */

  _customerChanged() {
    const cuId = document.getElementById('ro-cu')?.value;
    const cu   = cuId ? getCu(cuId) : null;
    const addr = cu ? [cu.address, cu.zip, cu.city].filter(Boolean).join(', ') : '';
    const display = document.getElementById('ro-cu-addr-display');
    if (display) display.textContent = addr || '(ingen adress registrerad)';
    // If in custom mode, optionally pre-fill fields from the customer
    const isCuMode = document.getElementById('ro-addr-cu')?.checked;
    if (!isCuMode && cu) {
      const street = document.getElementById('ro-street');
      const zip    = document.getElementById('ro-zip');
      const city   = document.getElementById('ro-city');
      if (street && !street.value) street.value = cu.address || '';
      if (zip    && !zip.value)    zip.value    = cu.zip     || '';
      if (city   && !city.value)   city.value   = cu.city    || '';
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

  /* ── Checklist helpers ────────────────────── */

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

  /* ── Save ─────────────────────────────────── */

  _save(roId) {
    const title = document.getElementById('ro-title')?.value.trim();
    if (!title) { showToast('Titel krävs'); return; }

    const tillsvidare = document.getElementById('ro-tillsvidare')?.checked !== false;
    const interval    = document.getElementById('ro-interval')?.value || 'månadsvis';
    const days        = parseInt(document.getElementById('ro-days')?.value) || 30;

    // Resolve address from split fields
    const isCuAddr = document.getElementById('ro-addr-cu')?.checked;
    let address = '';
    let accessCode = '';
    if (isCuAddr) {
      const cuId = document.getElementById('ro-cu')?.value;
      const cu   = cuId ? getCu(cuId) : null;
      address    = cu ? [cu.address, cu.zip, cu.city].filter(Boolean).join(', ') : '';
      accessCode = cu ? (cu.accessCode || '') : '';
    } else {
      const street = (document.getElementById('ro-street')?.value || '').trim();
      const zip    = (document.getElementById('ro-zip')?.value    || '').trim();
      const city   = (document.getElementById('ro-city')?.value   || '').trim();
      accessCode   = (document.getElementById('ro-access')?.value || '').trim();
      const zipCity = [zip, city].filter(Boolean).join(' ');
      address = [street, zipCity].filter(Boolean).join(', ');
    }

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
      accessCode,
      priceGroupId: document.getElementById('ro-pg')?.value || '',
      staff:        this._tempStaff.slice(),
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
