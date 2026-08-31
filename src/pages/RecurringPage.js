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
      /* R2.6 §1 (HARD BLOCKER, oberoende reproducerad) — TIDIGARE bar denna
         prefill redan med propertyId, men _openForm()/_save() hade ingen
         plats att spara det vidare — "Gör återkommande" från en
         fastighetslänkad AO tappade tyst kopplingen. propertyId är nu en
         egen, av adressläget OBEROENDE fält (se _openForm()s
         Fastighet-väljare och _save()) — en särskild arbetsadress och en
         fastighetskoppling är INTE ömsesidigt uteslutande. */
      propertyId:   ao.propertyId || '',
      address:      ao.address || '',
      zip:          ao.zip || '',
      city:         ao.city || '',
      /* R2.6 §2 — bär med AO:ns EGEN addressSource ('property'/'customer'/
         'manual', satt av den kanoniska skapande-tids-normaliseraren eller
         av redigera-dialogen) rakt av när den finns. En äldre AO som saknar
         fältet helt lämnas tom här — _openForm()s egen legacy-inferens
         (gatumatchning mot fastighet, sedan kund, R2.6 §4) avgör då läget
         konservativt, istället för att denna funktion gissar fel och tvingar
         fram "annan arbetsadress" för en adress som i själva verket redan
         är fastighetens/kundens. */
      addressSource: ao.addressSource || '',
      category:     ao.category || '',
      priority:     ao.priority || 'normal',
      priceGroupId: ao.priceGroupId || '',
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
        ${ro.address ? `<div class="dr"><span class="dk">Arbetsadress</span><span class="dv">${esc(AddressService.formatQuery(ro.address, ro.zip, ro.city, ''))}</span></div>` : ''}
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

    /* R2.6 §2/§4 — Adressläge avgörs i första hand av det EXPLICITA
       `addressSource`-fältet ('property'/'customer'/'manual', samma mönster
       som AO:ns eget) — robust, till skillnad från sträng-jämförelse.
       Genuint legacy-poster (skapade innan R2.6, saknar `addressSource`
       helt) infereras KONSERVATIVT i strikt ordning, ingen fuzzy-matchning:
         1. den (ev. legacy-parsade) gatan matchar den länkade FASTIGHETENS
            gata → fastighetsläge
         2. annars matchar den länkade KUNDENS gata → kundläge
         3. annars, om ingen adress alls finns → fastighetsläge om en
            fastighet är vald (annars kundläge, som tidigare)
         4. annars → eget/särskilt läge. */
    const roAddr  = src.address || '';
    const cu0     = src.customerId ? getCu(src.customerId) : null;
    const cu0Addr = cu0 ? [cu0.address, cu0.zip, cu0.city].filter(Boolean).join(', ') : '';
    const prop0   = src.propertyId ? getObj(src.propertyId) : null;
    const propsForCustomer = src.customerId
      ? (state.properties||[]).filter(p => p.customerId === src.customerId)
      : (state.properties||[]);

    /* Fält att förifylla i eget/särskilt-läget: föredra REDAN strukturerade
       zip/city (nya poster, eller från openFromAO()) — annars, för genuint
       legacy-poster som bara har en hopslagen sträng, använd den delade,
       bakåtkompatibla parsern (R2.5 §8/§9). Beräknas alltid (inte bara i
       custom-läge) eftersom den legacy-parsade gatan även används för
       läges-inferensen nedan. */
    var parsedStreet = roAddr, parsedZip = src.zip || '', parsedCity = src.city || '';
    if (!parsedZip && !parsedCity && roAddr) {
      const parsed = AddressService.parseLegacyCombinedAddress(roAddr);
      parsedStreet = parsed.street; parsedZip = parsed.zip; parsedCity = parsed.city;
    }

    let addrMode; // 'property' | 'cu' | 'custom'
    if (src.addressSource === 'manual') addrMode = 'custom';
    else if (src.addressSource === 'property') addrMode = 'property';
    else if (src.addressSource === 'customer') addrMode = 'cu';
    else {
      const streetNorm = AddressService._normalizeStreet(parsedStreet);
      if (roAddr && prop0 && streetNorm && streetNorm === AddressService._normalizeStreet(prop0.address)) addrMode = 'property';
      else if (roAddr && cu0 && streetNorm && streetNorm === AddressService._normalizeStreet(cu0.address)) addrMode = 'cu';
      else if (!roAddr) addrMode = prop0 ? 'property' : 'cu';
      else addrMode = 'custom';
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
          <div class="fg"><label>Fastighet (valfritt)</label>
            <select id="ro-prop" onchange="RecurringPage._propertyChanged()">
              <option value="">— Ingen fastighet —</option>
              ${propsForCustomer.map(p=>`<option value="${p.id}" ${src.propertyId===p.id?'selected':''}>${esc(p.name||p.address||p.id)}</option>`).join('')}
            </select></div>
        </div>

        <div class="fg"><label>Prioritet</label>
          <select id="ro-priority">
            ${['akut','hög','normal','låg'].map(p=>`<option value="${p}" ${(src.priority||'normal')===p?'selected':''}>${priorityLabel(p)}</option>`).join('')}
          </select></div>

        <div class="fg">
          <label>Arbetsadress</label>
          <div style="margin-top:4px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;cursor:pointer;">
              <input type="radio" name="ro-addr-mode" id="ro-addr-prop" value="property"
                ${addrMode==='property'?'checked':''} ${prop0?'':'disabled'} onchange="RecurringPage._addrModeChanged()">
              Använd fastighetens adress
            </label>
            <div id="ro-prop-addr-display" style="font-size:12px;color:var(--mt);margin-left:22px;">${prop0 ? [prop0.address, prop0.zip, prop0.city].filter(Boolean).join(', ') : '(välj fastighet ovan)'}</div>
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

    /* R2.6 §3 — "Changing customer must safely clear an incompatible
       selected property": fastighetsväljaren filtreras om till den nya
       kundens fastigheter, och en redan vald fastighet som INTE tillhör
       den nya kunden rensas (kund/fastighet får aldrig peka åt olika håll
       i samma post). */
    const propSel = document.getElementById('ro-prop');
    if (propSel) {
      const currentPropId = propSel.value;
      const props = cuId ? (state.properties||[]).filter(p => p.customerId === cuId) : (state.properties||[]);
      const stillValid = props.some(p => p.id === currentPropId);
      propSel.innerHTML = '<option value="">— Ingen fastighet —</option>' +
        props.map(p => `<option value="${p.id}" ${stillValid && p.id===currentPropId?'selected':''}>${esc(p.name||p.address||p.id)}</option>`).join('');
      if (!stillValid) {
        propSel.value = '';
        RecurringPage._propertyChanged();
      }
    }

    /* R2.7 §1/§2 (HARD BLOCKER, oberoende reproducerad) — TIDIGARE
       förifylldes tomma fält i "annan arbetsadress"-läget tyst med den nya
       kundens adress vid ett kundbyte. Det bröt manuell-lägets grundregel:
       en särskild arbetsadress är ANVÄNDARENS EGNA data, oberoende av
       kund/fastighet, tills användaren SJÄLV explicit byter adressläge.
       Ett kundbyte medan "gata" var ifylld men "postnr" tom kunde alltså
       tyst skapa en HYBRIDADRESS (gammal gata + ny kunds postnr) som
       användaren aldrig skrev in. Manuella fält rörs nu ALDRIG av ett
       kund- eller fastighetsbyte — bara av användarens egen inmatning,
       eller vid det EXPLICITA ögonblick användaren väljer manuellt läge
       (se _addrModeChanged()). */
  },

  /* R2.6 §2/§3 — fastighetens adress-visning + radioknappens av/på-läge.
     En "Använd fastighetens adress"-radio kan bara vara vald/aktiv när en
     fastighet faktiskt är vald — om fastigheten rensas medan det läget är
     aktivt faller adressläget säkert tillbaka till kundens adress. */
  _propertyChanged() {
    const propId  = document.getElementById('ro-prop')?.value;
    const prop    = propId ? getObj(propId) : null;
    const display = document.getElementById('ro-prop-addr-display');
    if (display) display.textContent = prop ? [prop.address, prop.zip, prop.city].filter(Boolean).join(', ') : '(välj fastighet ovan)';
    const propRadio = document.getElementById('ro-addr-prop');
    if (propRadio) {
      propRadio.disabled = !prop;
      if (!prop && propRadio.checked) {
        const cuRadio = document.getElementById('ro-addr-cu');
        if (cuRadio) { cuRadio.checked = true; RecurringPage._addrModeChanged(); }
      }
    }
  },

  _addrModeChanged() {
    const isCustom = document.getElementById('ro-addr-custom')?.checked;
    const wrap  = document.getElementById('ro-addr-custom-wrap');
    if (wrap) wrap.style.display = isCustom ? '' : 'none';
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

    /* R2.6 §1/§3 — adressen sparas fortsatt STRUKTURERAD (gata/postnr/ort
       som egna fält, R2.5), och `propertyId` sparas nu ALLTID separat från
       adressläget — HARD BLOCKER (oberoende reproducerad): tidigare fanns
       ingen fastighets-koppling i formuläret alls, så "Gör återkommande"
       från en fastighetslänkad AO tappade tyst kopplingen redan här, innan
       posten ens sparats en gång. En särskild arbetsadress och en
       fastighetskoppling är INTE ömsesidigt uteslutande (§2/§7) — därför
       läses propertyId helt oberoende av vilket av de tre adresslägena
       (fastighet/kund/eget) som är valt. */
    const addrMode    = document.querySelector('input[name="ro-addr-mode"]:checked')?.value || 'cu';
    const propertyId  = document.getElementById('ro-prop')?.value || '';
    const customerId  = document.getElementById('ro-cu')?.value || '';

    let address = '', zip = '', city = '', accessCode = '', addressSource = '';
    if (addrMode === 'property') {
      const prop = propertyId ? getObj(propertyId) : null;
      address    = prop ? (prop.address || '') : '';
      zip        = prop ? (prop.zip || '') : '';
      city       = prop ? (prop.city || '') : '';
      accessCode = prop ? (prop.accessCode || '') : '';
      addressSource = 'property';
    } else if (addrMode === 'cu') {
      const cu   = customerId ? getCu(customerId) : null;
      address    = cu ? (cu.address || '') : '';
      zip        = cu ? (cu.zip || '') : '';
      city       = cu ? (cu.city || '') : '';
      accessCode = cu ? (cu.accessCode || '') : '';
      addressSource = 'customer';
    } else {
      address    = (document.getElementById('ro-street')?.value || '').trim();
      zip        = (document.getElementById('ro-zip')?.value    || '').trim();
      city       = (document.getElementById('ro-city')?.value   || '').trim();
      accessCode = (document.getElementById('ro-access')?.value || '').trim();
      addressSource = 'manual';
      /* R2.7 §5/§6 (oberoende reproducerad blockerare) — samma praktiska
         regel som redan gäller för AO:ns egen särskilda adress (skapa/
         redigera-flödena): en manuellt angiven arbetsadress kräver gata
         OCH minst postnummer ELLER ort — annars skapar VIFT SJÄLVT ny,
         tvetydig adressdata, exakt det ursprungliga produktionsproblemet.
         Fastighets-/kundläget spärras ALDRIG av detta — de får använda
         vilken strukturerad kontext masterposten faktiskt har, ofullständig
         eller ej (se AddressService.resolveCreateAddressSnapshot()). */
      if (!address || (!zip && !city)) {
        showToast('Ange postnummer eller ort för den särskilda adressen.');
        return;
      }
    }

    const data = {
      title,
      customerId,
      propertyId,
      address, zip, city, addressSource,
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
