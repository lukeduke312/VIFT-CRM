/**
 * WorkOrderDetailPage — Fullständig AO-detaljvy
 */
const WorkOrderDetailPage = {
  aoId: null,
  _stampInterval: null,

  render(params) {
    this._stopStampTimer();
    const el = document.getElementById('pg-ao-detail-content');
    if (!el) return;
    const id = params && params.aoId;
    this.aoId = id;
    const ao = id ? getAO(id) : null;
    if (!ao) {
      el.innerHTML = `<div class="empty">${ic('clipboard-list',32)}<h3>Välj en order</h3></div>`;
      return;
    }
    // ao_view_own: technicians may only see their own AOs (pool is always visible)
    if (!Auth.can('ao_view_all') && !Auth.can('all') && Auth.can('ao_view_own') && state.currentUser) {
      const myId = state.currentUser.id;
      if (!(ao.staff || []).includes(myId) && ao.status !== 'pool') {
        el.innerHTML = `<div class="empty">${ic('lock',32)}<h3>Ingen behörighet</h3><p>Du har inte tillgång till denna arbetsorder.</p></div>`;
        return;
      }
    }
    this._renderFull(el, ao);
    if (state.stampActive && state.stampAoId === ao.id) this._startStampTimer();
  },

  _renderFull(el, ao) {
    const cu     = getCu(ao.customerId);
    const cuName = cu ? CustomerService.displayName(cu) : '—';
    const staff  = (ao.staff||[]).map(id => { const s = getStaff(id); return s ? `${s.firstName} ${s.lastName}` : id; });
    const respS  = ao.responsibleStaffId ? getStaff(ao.responsibleStaffId) : null;
    const respName = respS ? `${respS.firstName} ${respS.lastName}` : '';
    const chkOk   = (ao.checklist||[]).filter(c=>c.done||c.avvikelse==='ok').length;
    const chkAvv  = (ao.checklist||[]).filter(c=>c.avvikelse==='avvikelse').length;
    const chkTotal = (ao.checklist||[]).length;
    const chkBadge = chkTotal > 0
      ? `<span class="bdg bdg-${chkOk===chkTotal&&!chkAvv?'green':chkAvv>0?'orange':'blue'}">${chkOk}/${chkTotal} OK${chkAvv>0?' · '+chkAvv+' avv.':''}</span>`
      : '';
    const timeEntries = TimeService.getByAO(ao.id);
    const totalMins   = TimeService.totalMinutes(timeEntries);
    const matTotal    = WorkOrderService.materialTotal(ao);
    const isStampedOnThis = state.stampActive && state.stampAoId === ao.id;
    const hasChk  = chkTotal > 0;
    const hasMat  = (ao.materials||[]).length > 0;
    const hasTime = timeEntries.length > 0;

    el.innerHTML = `
      ${ao.deleted ? `<div class="nbox" style="background:#fee2e2;border-left-color:var(--rd);margin-bottom:8px;">${ic('trash',13)} Denna arbetsorder finns i papperskorgen och raderas automatiskt ${ao.deleteAfter?fmtDate(ao.deleteAfter):'om 14 dagar'}.</div>` : ''}
      ${ao.archived && !ao.deleted ? `<div class="nbox" style="background:#f1f5f9;border-left-color:var(--mt);margin-bottom:8px;">${ic('archive',13)} Denna arbetsorder är arkiverad och syns inte i ordinarie lista.</div>` : ''}

      <!-- Kompakt header: tillbaka + ID + badges -->
      <div class="ao-detail-top">
        <button class="btn bsm ao-back-btn" onclick="Router.back()" title="Tillbaka">
          ${ic('arrow-left',15)} <span class="ao-back-label">Tillbaka</span>
        </button>
        <span style="font-size:11px;font-weight:700;color:var(--mt);letter-spacing:.3px;white-space:nowrap;">${ao.id}</span>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-left:auto;">
          ${sbdg(ao.status)}
          ${ao.priority==='akut'?`<span class="bdg bdg-red ao-akut-badge">🚨 AKUT</span>`:ao.priority!=='normal'?pbdg(ao.priority):''}
          ${ao.status==='pågående'&&ao.substatus?`<span class="bdg" style="font-size:10px;background:#fef3c7;color:#d97706;border:1px solid #fde68a;">${esc({'inväntar_material':'⏳ Inväntar material','inväntar_kund':'🔔 Inväntar kund','pausad':'⏸ Pausad','behöver_återbesök':'🔄 Återbesök','blockerad':'🚫 Blockerad'}[ao.substatus]||ao.substatus)}</span>`:''}
        </div>
      </div>

      <!-- Titelkort: rubrik + kund/adress/datum + knappar -->
      <div class="card ao-title-card">
        <div class="ao-title-hero">
          <h2 class="ao-title-main">${esc(ao.title)}</h2>
          <div class="ao-title-meta">
            ${cu?`<div class="ao-title-meta-row"><span style="color:var(--mt);flex-shrink:0;">${ic('user',11)}</span><a style="color:var(--sky);text-decoration:none;font-weight:600;cursor:pointer;" onclick="Router.showPage('pg-crm-detail',{customerId:'${cu.id}'})">${esc(cuName)}</a></div>`:''}
            ${ao.address?`<div class="ao-title-meta-row">
              <span style="color:var(--mt);flex-shrink:0;">${ic('map-pin',11)}</span>
              <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(ao.address)}</span>
              <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ao.address)}" target="_blank" rel="noopener" class="btn bsm" style="font-size:11px;padding:3px 8px;white-space:nowrap;flex-shrink:0;" onclick="event.stopPropagation()">${ic('navigation',10)} Navigera</a>
            </div>`:''}
            ${ao.scheduledDate?`<div class="ao-title-meta-row"><span style="color:var(--mt);flex-shrink:0;">${ic('calendar',11)}</span><span>${ao.scheduledDate}${ao.scheduledStart?' · '+ao.scheduledStart+'–'+ao.scheduledEnd:''}</span></div>`:''}
          </div>
        </div>
        <div class="ao-action-strip">
          ${this._actionBtns(ao)}
        </div>
      </div>

      <!-- Beskrivning / uppdrag (framträdande, högt upp) -->
      <div class="card">
        <div class="card-header">
          <h3>${ic('align-left',14)} Beskrivning / uppdrag</h3>
          ${ao.priority==='akut'?`<span class="bdg bdg-red ao-akut-badge">🚨 AKUT</span>`:''}
        </div>
        <div class="card-body ao-desc-body">
          ${ao.description
            ? `<p style="font-size:14px;line-height:1.65;margin:0;color:var(--tx);white-space:pre-wrap;">${esc(ao.description)}</p>`
            : `<p style="font-size:13px;color:var(--mt);font-style:italic;margin:0;">Ingen beskrivning angiven</p>`
          }
        </div>
      </div>

      <!-- Info: kontakt, portkod, personal, pris, kategori -->
      <div class="card">
        <div class="ao-info-list">
          <div class="ao-info-row">
            <span class="ao-info-lbl">${ic('phone',11)} Kontakt</span>
            <span class="ao-info-val">
              ${ao.contactPerson ? esc(ao.contactPerson) : '<span style="color:var(--mt);">—</span>'}
              ${ao.phone?`<br><a href="tel:${ao.phone}" style="color:var(--sky);font-size:12px;font-weight:600;">${esc(ao.phone)}</a>`:''}
            </span>
          </div>
          ${ao.accessCode?`<div class="ao-info-row">
            <span class="ao-info-lbl">${ic('key',11)} Portkod</span>
            <span class="ao-info-val" style="font-weight:800;letter-spacing:.8px;font-size:16px;">${esc(ao.accessCode)}</span>
          </div>`:''}
          <div class="ao-info-row">
            <span class="ao-info-lbl">${ic('users',11)} Personal</span>
            <span class="ao-info-val">
              ${staff.length
                ? esc(staff.join(', ')) + (respName?`<br><span style="font-size:11px;color:var(--mt);">${ic('star',9)} Ansvarig: ${esc(respName)}</span>`:'')
                : `<span style="color:var(--rd);font-weight:600;">Ej tilldelad</span>`
              }
            </span>
          </div>
          <div class="ao-info-row">
            <span class="ao-info-lbl">${ic('tag',11)} Pris</span>
            <span class="ao-info-val">${this._priceLabel(ao)}</span>
          </div>
          ${ao.category?`<div class="ao-info-row">
            <span class="ao-info-lbl">${ic('folder',11)} Kategori</span>
            <span class="ao-info-val">${catBadge(ao.category)}</span>
          </div>`:''}
          ${ao.technicalCategorySlug?`<div class="ao-info-row">
            <span class="ao-info-lbl">${ic('settings',11)} Tekniskt</span>
            <span class="ao-info-val" style="${ao.propertyId?'cursor:pointer;':''}display:flex;align-items:center;gap:4px;" ${ao.propertyId?`onclick="Router.showPage('pg-obj-detail',{propId:'${ao.propertyId}',tab:'tech'})"`:''}>${esc(ao.technicalCategoryLabel||ao.technicalCategorySlug)}${ao.propertyId?ic('arrow-right',10):''}</span>
          </div>`:''}
          ${chkTotal>0?`<div class="ao-info-row">
            <span class="ao-info-lbl">${ic('clipboard-check',11)} Lista</span>
            <span class="ao-info-val">${chkBadge}</span>
          </div>`:''}
          ${ao.internalNote?`<div class="ao-info-row">
            <span class="ao-info-lbl">${ic('eye-off',11)} Internt</span>
            <span class="ao-info-val">${esc(ao.internalNote)}</span>
          </div>`:''}
        </div>
      </div>

      <!-- Stämpling -->
      ${this._stampSection(ao, isStampedOnThis)}

      <!-- Checklista (hopfällbar om tom) -->
      <details class="card ao-section" ${hasChk?'open':''}>
        <summary class="ao-section-head">
          <span class="ao-section-title">${ic('clipboard-check',14)} Checklista</span>
          <div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
            <span id="ao-chk-counter">${chkBadge}</span>
            ${Auth.can('ao_checklist')?`<button class="btn bs bxs" onclick="event.stopPropagation();WorkOrderDetailPage.openAddChecklist()">${ic('plus',13)}</button>`:''}
            <span class="ao-section-chevron">${ic('chevron-down',12)}</span>
          </div>
        </summary>
        <div class="card-body" style="padding:6px 14px;" id="ao-checklist">
          ${this._renderChecklist(ao)}
        </div>
      </details>

      <!-- Material & kostnader (hopfällbar om tom) -->
      <details class="card ao-section" ${hasMat?'open':''}>
        <summary class="ao-section-head">
          <span class="ao-section-title">${ic('package',14)} Material & kostnader</span>
          <div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
            ${Auth.can('ao_material')?`<button class="btn bs bxs" onclick="event.stopPropagation();WorkOrderDetailPage.openAddMaterial()">${ic('plus',13)}</button>`:''}
            <span class="ao-section-chevron">${ic('chevron-down',12)}</span>
          </div>
        </summary>
        <div id="ao-materials" style="overflow:hidden;">${this._renderMaterials(ao)}</div>
        <div id="ao-mat-totals">${hasMat?this._matTotals(ao):''}</div>
      </details>

      <!-- Tidsposter (hopfällbar om tom) -->
      <details class="card ao-section" ${hasTime?'open':''}>
        <summary class="ao-section-head">
          <span class="ao-section-title">${ic('clock',14)} Arbetstid</span>
          <div style="display:flex;align-items:center;gap:6px;margin-left:auto;">
            <span id="ao-time-badge">${totalMins>0?`<span class="bdg bdg-sky">${TimeService.fmtDuration(totalMins)}</span>`:''}</span>
            ${Auth.can('ao_time')?`<button class="btn bs bxs" onclick="event.stopPropagation();WorkOrderDetailPage.openAddTime()">${ic('plus',13)}</button>`:''}
            <span class="ao-section-chevron">${ic('chevron-down',12)}</span>
          </div>
        </summary>
        <div id="ao-timeentries" style="overflow:hidden;">${this._renderTimeEntries(ao)}</div>
      </details>

      <!-- Tid vs plan -->
      <div id="ao-time-plan">${this._timePlanBlock(ao)}</div>

      <!-- Händelselogg (visar senaste 5, "Visa alla"-knapp) -->
      <div class="card">
        <div class="card-header">
          <h3>${ic('activity',14)} Händelselogg</h3>
          <div style="display:flex;gap:5px;">
            <button class="btn bxs bsu" style="font-size:11px;padding:4px 10px;" onclick="WorkOrderDetailPage.openFollowUp()">${ic('bell',12)} Uppföljning</button>
            <button class="btn bs bxs" onclick="WorkOrderDetailPage.openAddLog()">${ic('plus',13)}</button>
          </div>
        </div>
        <div id="ao-timeline" style="overflow:hidden;">
          ${this._renderTimeline(ao)}
        </div>
      </div>

      <!-- Fakturaunderlag -->
      ${ao.status === 'klar' && !ao.invoiceId ? `
        <button class="btn bsu bfull" style="padding:14px;" onclick="WorkOrderDetailPage.createInvoice()">
          ${ic('file-plus',16)} Skapa fakturaunderlag
        </button>` : ''}
      ${ao.invoiceId ? `
        <div class="ibox" style="cursor:pointer;" onclick="Router.showPage('pg-inv-detail',{invoiceId:'${ao.invoiceId}'})">
          ${ic('receipt',14)} Fakturaunderlag: ${ao.invoiceId} – klicka för att öppna
        </div>` : ''}

      ${ao.offerId ? this._offerUnderlag(ao) : ''}
      ${ao.offerId ? `
        <div class="ibox" style="cursor:pointer;margin-top:8px;" onclick="Router.showPage('pg-offer-detail',{offerId:'${ao.offerId}'})">
          ${ic('file-text',13)} Skapad från offert: ${ao.offerId} — klicka för att öppna
        </div>` : ''}

      <!-- Intern lönsamhet (hopfällbar, admin) -->
      <div id="ao-lonsam">${this._renderLonsamhet(ao)}</div>

      <!-- Återkommande -->
      ${ao.recurringOrderId
        ? `<div class="ibox" style="cursor:pointer;margin-top:8px;" onclick="Router.showPage('pg-recurring')">
             ${ic('refresh-cw',13)} Skapad från återkommande mall: ${ao.recurringOrderId}
           </div>`
        : `<button class="btn bghost bfull" style="margin-top:8px;" onclick="WorkOrderDetailPage.makeRecurring()">
             ${ic('refresh-cw',14)} Gör till återkommande ärende
           </button>`
      }
    `;
  },

  _renderLonsamhet(ao) {
    if (!Auth.canAny(['reports_view','staff_view'])) return '';
    return `
      <details class="card ao-section" style="margin-top:8px;">
        <summary class="ao-section-head">
          <span class="ao-section-title">${ic('bar-chart-2',13)} Intern lönsamhet</span>
          <span class="ao-section-chevron" style="margin-left:auto;">${ic('chevron-down',12)}</span>
        </summary>
        ${this._tbBlock(ao)}
      </details>`;
  },

  _showAllTimeline() {
    const el = document.getElementById('ao-timeline');
    const ao = getAO(this.aoId);
    if (!el || !ao) return;
    el.innerHTML = this._renderTimeline(ao, true);
  },

  _openSectionOf(elementId) {
    const el = document.getElementById(elementId);
    if (el) { const det = el.closest('details.ao-section'); if (det) det.open = true; }
  },

  _actionBtns(ao) {
    const primary   = this._primaryActionBtns(ao);
    const secondary = this._secondaryActions(ao);
    const moreBtnHtml = secondary.length > 0
      ? `<button class="btn bghost bsm" onclick="WorkOrderDetailPage.openMoreActions('${ao.id}')">${ic('more-horizontal',13)} Fler åtgärder</button>`
      : '';
    return primary.join('') + moreBtnHtml;
  },

  _primaryActionBtns(ao) {
    const canEdit     = Auth.can('ao_edit');
    const canComplete = Auth.can('ao_complete');
    const canInvoice  = Auth.can('invoice_create');
    const btns = [];
    // Start work
    if (canEdit && ['nytt','pool','planerad'].includes(ao.status)) {
      btns.push(`<button class="btn bsu bsm" onclick="WorkOrderDetailPage.setStatus('pågående')">${ic('play-circle',13)} Starta arbete</button>`);
    }
    // Mark complete
    if (ao.status === 'pågående' && canComplete) {
      btns.push(`<button class="btn bsu bsm" onclick="WorkOrderDetailPage.markComplete()">${ic('check-circle',13)} Klarmarkera</button>`);
    }
    // Substatus select (shown inline when active)
    if (ao.status === 'pågående' && canEdit && ao.substatus) {
      const subOpts = [
        {v:'',label:'Inget substatus'},
        {v:'inväntar_material',label:'Inväntar material'},
        {v:'inväntar_kund',label:'Inväntar kund'},
        {v:'pausad',label:'Pausad'},
        {v:'behöver_återbesök',label:'Behöver återbesök'},
        {v:'blockerad',label:'Blockerad'},
      ];
      btns.push(`<select class="btn bs bsm" style="padding:5px 8px;font-size:11px;" onchange="WorkOrderDetailPage.setSubstatus(this.value);this.blur();" title="Substatus">
        ${subOpts.map(o=>`<option value="${o.v}"${ao.substatus===o.v?' selected':''}>${o.label}</option>`).join('')}
      </select>`);
    }
    // Invoice CTA
    if (ao.status === 'klar' && !ao.invoiceId && canInvoice) {
      btns.push(`<button class="btn bsu bsm" onclick="InvoicesPage.createFromAO('${ao.id}')">${ic('receipt',13)} Skapa fakturaunderlag</button>`);
    }
    // Reactivate
    if (canEdit && ao.status === 'avbruten' && !ao.archived && !ao.deleted) {
      btns.push(`<button class="btn bsu bsm" onclick="WorkOrderDetailPage.openReactivateModal()">${ic('rotate-ccw',13)} Återaktivera</button>`);
    }
    // Restore from trash
    if (ao.deleted) {
      btns.push(`<button class="btn bs bsm" onclick="WorkOrderDetailPage._restoreFromTrash('${ao.id}')">${ic('rotate-ccw',13)} Återställ</button>`);
    }
    // Change status
    if (canEdit && !['klar','fakturerad','avbruten'].includes(ao.status) && !ao.archived && !ao.deleted) {
      btns.push(`<button class="btn bghost bsm" onclick="WorkOrderDetailPage.openStatusModal()">${ic('refresh-cw',13)} Byt status</button>`);
    }
    // Contact
    btns.push(`<button class="btn bxs bs" onclick="WorkOrderDetailPage.openContact()" style="display:inline-flex;align-items:center;gap:5px;">${ic('phone',13)} Kontakt</button>`);
    return btns;
  },

  _secondaryActions(ao) {
    const canEdit    = Auth.can('ao_edit');
    const canInvoice = Auth.can('invoice_create');
    const items = [];
    // Plan / reschedule
    if (canEdit && ['nytt','pool'].includes(ao.status)) {
      items.push({ label:'Planera',   icon:'calendar',    fn:`WorkOrderDetailPage.setStatus('planerad')` });
    }
    if (canEdit && ao.status === 'nytt') {
      items.push({ label:'Till pool', icon:'inbox',       fn:`WorkOrderDetailPage.setStatus('pool')` });
    }
    if (canEdit && ao.status === 'planerad') {
      items.push({ label:'Omplanera', icon:'calendar',    fn:`WorkOrderDetailPage.openReschedule()` });
    }
    // Pause
    if (canEdit && ao.status === 'pågående') {
      items.push({ label:'Pausa',     icon:'pause-circle',fn:`WorkOrderDetailPage.setStatus('planerad')` });
    }
    // View invoice
    if (ao.status === 'klar' && ao.invoiceId) {
      items.push({ label:'Visa fakturaunderlag', icon:'file-text', fn:`Router.showPage('pg-inv-detail',{invoiceId:'${ao.invoiceId}'})` });
    }
    // Edit / staff (separator before)
    if (canEdit) {
      items.push({ label:'Redigera',  icon:'pencil',      fn:`WorkOrderDetailPage.openEdit()`,           divider: items.length > 0 });
      items.push({ label:'Personal',  icon:'users',       fn:`WorkOrderDetailPage.manageStaff('${ao.id}')` });
    }
    // Archive / delete (separator before)
    if (canEdit && !ao.archived && !ao.deleted) {
      items.push({ label:'Arkivera',  icon:'archive',     fn:`WorkOrderDetailPage.openArchiveModal()`,   divider: true });
      items.push({ label:'Ta bort',   icon:'trash',       fn:`WorkOrderDetailPage.openDeleteModal()`,    destructive: true });
    }
    // Restore from archive
    if (ao.archived && !ao.deleted) {
      items.push({ label:'Återställ från arkiv', icon:'rotate-ccw', fn:`WorkOrderDetailPage._restoreFromArchive('${ao.id}')` });
    }
    // Permanent delete
    if (ao.deleted) {
      items.push({ label:'Radera permanent', icon:'trash-2', fn:`WorkOrderDetailPage._confirmPermanentDelete('${ao.id}')`, destructive: true, divider: true });
    }
    return items;
  },

  openMoreActions(aoId) {
    const ao = getAO(aoId || this.aoId);
    if (!ao) return;
    const items = this._secondaryActions(ao);
    if (!items.length) return;
    const rows = items.map(it => {
      const div = it.divider ? `<div style="height:1px;background:var(--br);margin:4px 0;"></div>` : '';
      const col = it.destructive ? 'color:var(--rd);' : '';
      return div + `<button class="btn bghost bfull" style="justify-content:flex-start;padding:11px 14px;gap:10px;${col}" onclick="Modal.close();${it.fn}">
        <span style="opacity:.65;flex-shrink:0;">${ic(it.icon,15)}</span>${it.label}
      </button>`;
    }).join('');
    Modal.open({
      title: `${ic('more-horizontal',14)} Fler åtgärder`,
      body:  `<div style="display:flex;flex-direction:column;gap:2px;margin:0 -2px;">${rows}</div>`,
      buttons: [{ label:'Avbryt', cls:'btn bs', onClick:() => Modal.close() }]
    });
  },

  openReschedule() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    Modal.open({
      title: 'Omplanera',
      body: `
        <div class="g2">
          <div class="fg"><label>Nytt datum</label><input type="date" id="rs-date" value="${ao.scheduledDate||tdy()}"></div>
          <div class="g2">
            <div class="fg"><label>Starttid</label><input type="time" id="rs-start" value="${ao.scheduledStart||'08:00'}"></div>
            <div class="fg"><label>Sluttid</label><input type="time" id="rs-end" value="${ao.scheduledEnd||'16:00'}"></div>
          </div>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const d = document.getElementById('rs-date')?.value;
          if (!d) { showToast('Välj datum'); return; }
          WorkOrderService.update(this.aoId, {
            scheduledDate:  d,
            scheduledStart: document.getElementById('rs-start')?.value || '',
            scheduledEnd:   document.getElementById('rs-end')?.value || ''
          });
          Modal.close();
          this.render({ aoId: this.aoId });
          showToast('Omplanerad');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openContact() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    const cu = getCu(ao.customerId);
    const prop = ao.propertyId ? getObj(ao.propertyId) : null;

    // Build prioritized contact list
    const contacts = [];

    // 1. AO contact person
    if (ao.contactPerson || ao.phone || ao.email) {
      contacts.push({
        label: 'AO-kontakt',
        name: ao.contactPerson || '',
        phone: ao.phone || '',
        email: ao.email || '',
        primary: true
      });
    }

    // 2. Customer
    if (cu) {
      contacts.push({
        label: 'Kund',
        name: CustomerService.displayName(cu),
        phone: cu.phone || '',
        email: cu.email || '',
        primary: false
      });
    }

    // 3. Property contacts
    if (prop && prop.contacts && prop.contacts.length) {
      prop.contacts.forEach(c => {
        contacts.push({
          label: c.role || 'Fastighetskontakt',
          name: c.name || '',
          phone: c.phone || '',
          email: c.email || '',
          primary: false
        });
      });
    }

    // 4. Assigned staff
    (ao.staff || []).forEach(staffId => {
      const s = getStaff(staffId);
      if (s && s.phone) {
        contacts.push({
          label: 'Personal',
          name: `${s.firstName} ${s.lastName}`,
          phone: s.phone || '',
          email: s.email || '',
          primary: false
        });
      }
    });

    if (!contacts.length) {
      showToast('Inga kontaktuppgifter registrerade');
      return;
    }

    const rows = contacts.map(c => `
      <div style="padding:12px 0;border-bottom:1px solid var(--bg);">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mt);">${esc(c.label)}</span>
          ${c.primary ? `<span class="bdg bdg-sky" style="font-size:9px;">Primär</span>` : ''}
        </div>
        ${c.name ? `<div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:6px;">${esc(c.name)}</div>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${c.phone
            ? `<a href="tel:${esc(c.phone)}" class="btn bp bsm" style="gap:6px;font-size:13px;font-weight:700;padding:10px 16px;">${ic('phone',14)} ${esc(c.phone)}</a>`
            : `<span class="btn bs bsm" style="opacity:.45;cursor:default;gap:5px;font-size:12px;">${ic('phone',13)} Inget tel.</span>`}
          ${c.email
            ? `<a href="mailto:${esc(c.email)}" class="btn bs bsm" style="gap:6px;font-size:12px;">${ic('mail',13)} ${esc(c.email)}</a>`
            : ''}
        </div>
      </div>`).join('');

    Modal.open({
      title: `${ic('phone',14)} Kontakt`,
      body: `<div style="margin:0 -2px;">${rows}</div>`,
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  _offerUnderlag(ao) {
    const off = (state.offers||[]).find(o => o.id === ao.offerId);
    if (!off) return '';
    const prLines = (off.lines||[]).filter(l => l.type !== 'text');
    if (!prLines.length) return '';
    const rows = prLines.map(l => {
      const name  = l.templateName || l.description || '—';
      const price = l.exVat || l.total || Math.round((l.qty||1)*(l.unitPrice||0));
      const qty   = (l.type !== 'service' && l.qty) ? `${l.qty} ${l.unit||'st'} · ` : '';
      return `<div class="dr">
        <span class="dk" style="display:flex;align-items:center;gap:4px;">${l.type==='service'?ic('zap',9):ic('minus',9)} ${esc(name)}</span>
        <span class="dv">${qty}${fmt(price)} kr ex moms</span>
      </div>`;
    }).join('');
    return `
      <div class="card" style="margin-bottom:2px;">
        <div class="card-header">
          <h3>${ic('file-text',14)} Arbetsunderlag (offert ${esc(ao.offerId)})</h3>
          <button class="btn bghost bxs" onclick="Router.showPage('pg-offer-detail',{offerId:'${ao.offerId}'})">${ic('external-link',12)} Öppna offert</button>
        </div>
        <div class="card-body" style="padding:8px 14px;">
          ${off.scope ? `<p style="font-size:12px;color:var(--mt);line-height:1.5;margin-bottom:8px;border-left:3px solid var(--blue);padding-left:8px;">${esc(off.scope)}</p>` : ''}
          ${rows}
          ${off.includes||off.excludes ? `<div style="margin-top:8px;font-size:11px;color:var(--mt);">
            ${off.includes?`${ic('check-circle',10)} Ingår: ${esc(off.includes)}<br>`:''}
            ${off.excludes?`${ic('x-circle',10)} Ingår ej: ${esc(off.excludes)}`:''}
          </div>` : ''}
        </div>
      </div>`;
  },

  _tbBlock(ao) {
    const hasMat   = (ao.materials || []).length > 0;
    const hasTime  = TimeService.getByAO(ao.id).length > 0;
    const hasPrice = ao.invoiceId || ao.fixedPrice > 0 ||
                     ['timpris','prisgrupp','fast','fastpris'].includes(ao.priceType);
    if (!hasMat && !hasTime && !hasPrice) return '';

    const tb   = ProfitabilityService.calcTB(ao);
    const vs   = ProfitabilityService.calcVsOffer(ao);
    const fmtM = m => TimeService.fmtDuration(m);
    const borderColor = tb.tbPct !== null ? tb.color : 'var(--br)';

    const vsHtml = vs ? `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--bg);">
        <div style="font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">${ic('git-compare',10)} Offert vs faktiskt utfall</div>
        <div class="dr"><span class="dk">Offererat ex moms</span><span class="dv">${fkr(vs.offerExVat)}</span></div>
        <div class="dr"><span class="dk">${tb.revenue.label}</span>
          <span class="dv" style="color:${vs.revDiff >= 0 ? 'var(--gr)' : 'var(--rd)'};">
            ${fkr(vs.actualRev)}
            ${vs.revDiff !== 0 ? `<span style="font-size:10px;font-weight:600;margin-left:4px;">(${vs.revDiff >= 0 ? '+' : ''}${fmt(Math.round(vs.revDiff))} kr)</span>` : ''}
          </span>
        </div>
        ${vs.estMins > 0 ? `
          <div class="dr"><span class="dk">Planerad tid</span><span class="dv">${fmtM(vs.estMins)}</span></div>
          <div class="dr"><span class="dk">Faktisk tid</span>
            <span class="dv" style="color:${vs.timeDiff > vs.estMins * 0.15 ? 'var(--rd)' : vs.timeDiff > 0 ? 'var(--yl)' : 'var(--gr)'};">
              ${fmtM(vs.actualMins)}
              ${vs.timeDiff !== 0 && vs.actualMins > 0 ? `<span style="font-size:10px;margin-left:4px;">(${vs.timeDiff > 0 ? '+' : '−'}${fmtM(Math.abs(vs.timeDiff))})</span>` : ''}
            </span>
          </div>` : ''}
      </div>` : '';

    return `
      <div class="card" style="border-left:3px solid ${borderColor};">
        <div class="card-header">
          <h3>${ic('trending-up',14)} Lönsamhet <span style="font-size:10px;font-weight:600;color:var(--mt);margin-left:4px;">${ic('eye-off',9)} Intern</span></h3>
          ${tb.tbPct !== null ? `<span class="bdg ${tb.badge}">${Math.round(tb.tbPct)} % TB</span>` : ''}
        </div>
        <div class="card-body" style="padding:10px 14px;">
          <div class="dr">
            <span class="dk">Intäkt ex moms</span>
            <span class="dv">${fkr(tb.revenue.value)} <span style="font-size:10px;color:var(--mt);">${tb.revenue.label}</span></span>
          </div>

          ${hasMat ? `
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bg);">
            <div style="font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${ic('package',10)} Material</div>
            <div class="dr"><span class="dk">Försäljning ex moms</span><span class="dv">${fkr(tb.material.sellEx)}</span></div>
            <div class="dr"><span class="dk">Inköp ex moms</span><span class="dv" style="color:var(--rd);">${fkr(tb.material.buyEx)}</span></div>
            <div class="dr"><span class="dk">Materialmarginal</span>
              <span class="dv" style="color:var(--gr);">${fkr(tb.material.margin)}
                ${tb.material.sellEx > 0 ? `<span style="font-size:10px;font-weight:600;margin-left:4px;">(${Math.round(tb.material.marginPct)} %)</span>` : ''}
              </span>
            </div>
          </div>` : ''}

          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bg);">
            <div style="font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${ic('clock',10)} Arbetstid</div>
            <div class="dr"><span class="dk">Registrerad tid</span><span class="dv">${tb.labor.minutes > 0 ? fmtM(tb.labor.minutes) : '<span style="color:var(--mt);">Ingen tid registrerad</span>'}</span></div>
            <div class="dr"><span class="dk">Intern timkostnad</span><span class="dv" style="color:var(--mt);">${fmt(tb.labor.rate)} kr/h</span></div>
            ${tb.labor.cost > 0 ? `<div class="dr"><span class="dk">Intern arbetskostnad</span><span class="dv" style="color:var(--rd);">${fkr(tb.labor.cost)}</span></div>` : ''}
          </div>

          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--br);">
            <div class="dr"><span class="dk">Total kostnad</span><span class="dv" style="color:var(--rd);font-weight:700;">${fkr(tb.totalCost)}</span></div>
            <div class="dr" style="font-size:15px;font-weight:800;border-top:2px solid var(--br);padding-top:8px;margin-top:4px;">
              <span class="dk" style="color:${tb.color};">Täckningsbidrag</span>
              <span class="dv" style="color:${tb.color};">${fkr(tb.tb)}</span>
            </div>
            ${tb.tbPct !== null ? `<div class="dr">
              <span class="dk">TB %</span>
              <span class="dv" style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">
                <strong style="font-size:15px;color:${tb.color};">${Math.round(tb.tbPct)} %</strong>
                <span class="bdg ${tb.badge}">${tb.label}</span>
              </span>
            </div>` : ''}
          </div>

          ${vsHtml}
        </div>
      </div>`;
  },

  _timePlanBlock(ao) {
    const entries    = TimeService.getByAO(ao.id);
    const actualMins = TimeService.totalMinutes(entries);
    const estMins    = Math.round((ao.estimatedHours || 0) * 60);
    if (estMins === 0 && actualMins === 0) return '';
    const fmt = m => TimeService.fmtDuration(m);
    const canEdit = Auth.can('ao_edit');

    if (estMins > 0) {
      const pct   = Math.round((actualMins / estMins) * 100);
      const diff  = actualMins - estMins;
      const color = pct <= 100 ? 'var(--gr)' : pct <= 115 ? 'var(--orange)' : 'var(--rd)';
      const cls   = pct <= 100 ? 'bdg-green' : pct <= 115 ? 'bdg-orange' : 'bdg-red';
      const lbl   = pct <= 100 ? 'Under/inom plan' : pct <= 115 ? 'Nära gräns' : 'Över plan';
      const diffStr = diff === 0 ? '±0' : diff > 0 ? `+${fmt(diff)}` : `−${fmt(-diff)}`;
      const barW  = Math.min(pct, 100);
      const overW = pct > 100 ? Math.min(pct - 100, 100) : 0;

      return `
        <div class="card" style="margin-bottom:2px;">
          <div class="card-header">
            <h3>${ic('bar-chart-2',14)} Tid vs plan</h3>
            ${canEdit ? `<button class="btn bs bxs" onclick="WorkOrderDetailPage.editEstimatedTime('${ao.id}')">${ic('pencil',13)} Ändra</button>` : ''}
          </div>
          <div class="card-body" style="padding:10px 14px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;margin-bottom:10px;">
              <div class="dr"><span class="dk">Planerat</span><span class="dv">${fmt(estMins)}</span></div>
              <div class="dr"><span class="dk">Utfört</span><span class="dv">${actualMins > 0 ? fmt(actualMins) : '<span style="color:var(--mt);">—</span>'}</span></div>
              <div class="dr"><span class="dk">Differens</span><span class="dv" style="color:${color};font-weight:700;">${diffStr}</span></div>
              <div class="dr"><span class="dk">Andel av plan</span><span class="dv"><strong>${pct} %</strong></span></div>
            </div>
            <div style="height:6px;background:var(--br);border-radius:3px;overflow:hidden;margin-bottom:4px;">
              <div style="height:100%;width:${barW}%;background:${color};border-radius:3px;"></div>
            </div>
            ${overW > 0 ? `<div style="height:4px;background:var(--br);border-radius:3px;overflow:hidden;margin-bottom:6px;">
              <div style="height:100%;width:${overW}%;background:${color};border-radius:3px;"></div>
            </div>` : '<div style="margin-bottom:6px;"></div>'}
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;"></span>
              <span class="bdg ${cls}">${lbl}</span>
              ${pct > 100 && ao.status === 'klar' ? `<span style="font-size:11px;color:var(--rd);">${ic('alert-triangle',10)} Faktisk tid överstiger plan med ${fmt(diff)}</span>` : ''}
            </div>
          </div>
        </div>`;
    }

    return `
      <div class="card" style="margin-bottom:2px;">
        <div class="card-header">
          <h3>${ic('bar-chart-2',14)} Tid vs plan</h3>
          ${canEdit ? `<button class="btn bs bxs" onclick="WorkOrderDetailPage.editEstimatedTime('${ao.id}')">${ic('pencil',13)} Ändra</button>` : ''}
        </div>
        <div class="card-body" style="padding:10px 14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div>
              <div style="font-size:12px;color:var(--mt);margin-bottom:2px;">${ic('clock',12)} Ingen uppskattad tid satt</div>
              ${actualMins > 0 ? `<div style="font-size:13px;font-weight:700;">Utfört: ${fmt(actualMins)}</div>` : ''}
            </div>
            ${canEdit ? `<button class="btn bp bsm" onclick="WorkOrderDetailPage.editEstimatedTime('${ao.id}')">${ic('plus',12)} Sätt tid</button>` : ''}
          </div>
        </div>
      </div>`;
  },

  editEstimatedTime(aoId) {
    if (!Auth.require('ao_edit')) return;
    const ao = getAO(aoId);
    if (!ao) return;
    const estMins = Math.round((ao.estimatedHours || 0) * 60);
    const curH = Math.floor(estMins / 60);
    const curM = estMins % 60;
    Modal.open({
      title: `${ic('clock',15)} Uppskattad tid — ${esc(aoId)}`,
      body: `
        <div class="g2" style="margin-bottom:12px;">
          <div class="fg"><label>Timmar</label><input type="number" id="et-hours" min="0" max="999" value="${curH}" style="text-align:center;font-size:18px;font-weight:700;"></div>
          <div class="fg"><label>Minuter</label><input type="number" id="et-mins" min="0" max="59" value="${curM}" style="text-align:center;font-size:18px;font-weight:700;"></div>
        </div>
        <div class="fg"><label>Kommentar (valfritt)</label><input type="text" id="et-comment" placeholder="T.ex. Ändrad efter besiktning"></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const h = parseInt(document.getElementById('et-hours')?.value || '0', 10) || 0;
          const m = parseInt(document.getElementById('et-mins')?.value  || '0', 10) || 0;
          const comment = (document.getElementById('et-comment')?.value || '').trim();
          const newHours = h + m / 60;
          const by = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : 'Okänd';
          ao.estimatedHours = newHours;
          ao.updatedAt = new Date().toISOString();
          ao.log = ao.log || [];
          ao.log.push({
            id: 'L' + Date.now(), type: 'estimated_time_changed',
            text: `${by} satte uppskattad tid: ${TimeService.fmtDuration(h * 60 + m)}${comment ? ' — ' + comment : ''}`,
            userName: by, timestamp: new Date().toISOString()
          });
          persist();
          Modal.close();
          WorkOrderDetailPage.render({ aoId });
          showToast('Uppskattad tid uppdaterad');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _priceLabel(ao) {
    if (ao.priceType === 'fastpris' || ao.priceType === 'fast') return `Fastpris: ${fmt(ao.fixedPrice)} kr ex moms`;
    if (ao.priceType === 'timpris' || ao.priceType === 'prisgrupp') {
      if (ao.priceGroupId) {
        const pg = (state.priceGroups||[]).find(p => p.id === ao.priceGroupId);
        return pg ? `Löpande timpris – ${pg.name} (${fmt(pg.hourRate)} kr/tim ex moms)` : 'Löpande timpris';
      }
      return 'Löpande timpris';
    }
    return 'Ej satt';
  },

  _stampSection(ao, isActive) {
    if (['klar','fakturerad','avbruten'].includes(ao.status)) return '';
    return `
      <div class="card">
        <div class="card-header"><h3>Stämpling</h3>
          ${isActive ? `<span class="bdg bdg-green" id="ao-stamp-elapsed">Inklockat ${TimeService.elapsedStr(state.stampTimestamp)}</span>` : ''}
        </div>
        <div class="card-body" style="text-align:center;padding:16px;">
          <button class="btn ${isActive?'bd':'bsu'} bfull" style="padding:14px;font-size:15px;"
            onclick="WorkOrderDetailPage.toggleStamp()">
            ${isActive ? `${ic('stop-circle',18)} Klocka ut` : `${ic('play-circle',18)} Klocka in`}
          </button>
          ${state.stampActive && !isActive ? `<div class="nbox" style="margin-top:8px;">Du är inloggad på ett annat jobb. Klocka ut därifrån först.</div>` : ''}
        </div>
      </div>`;
  },

  _renderChecklist(ao) {
    const items = ao.checklist || [];
    if (!items.length) return `<div class="empty" style="padding:16px 0;gap:4px;">${ic('clipboard-check',24)}<p style="font-size:12px;color:var(--mt);text-align:center;">Ingen checklista.<br>Tryck + för att lägga till checkpunkter.</p></div>`;
    return `${items.map((c, i) => {
        const isOk  = c.avvikelse === 'ok' || (c.done && !c.avvikelse);
        const isAvv = c.avvikelse === 'avvikelse';
        const statusBg = isOk ? 'var(--lgr)' : isAvv ? 'var(--lrd)' : 'var(--bg)';
        const statusBd = isOk ? 'var(--gr)' : isAvv ? 'var(--rd)' : 'var(--br)';
        return `
        <div style="border-bottom:1px solid var(--bg);padding:9px 0;background:${isAvv?'rgba(185,28,28,.02)':'#fff'};">
          <div style="display:flex;align-items:flex-start;gap:8px;">
            <div style="flex-shrink:0;margin-top:1px;width:20px;height:20px;border-radius:50%;
              border:2px solid ${statusBd};background:${isOk?'var(--gr)':isAvv?'var(--rd)':'#fff'};
              display:flex;align-items:center;justify-content:center;color:#fff;transition:all .15s;">
              ${isOk?ic('check',10):isAvv?ic('alert-triangle',9):''}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:${isOk?'500':'700'};color:${isOk?'var(--mt)':'var(--tx)'};${isOk?'text-decoration:line-through;':''}">${c.text}</div>
              ${c.description ? `<div style="font-size:11px;color:var(--mt);margin-top:2px;line-height:1.4;">${c.description}</div>` : ''}
              ${isAvv && (c.avvikelseComment || c.avvikelseImage) ? `<div style="margin-top:5px;background:#fff1f2;border-left:3px solid var(--rd);padding:5px 10px;border-radius:0 6px 6px 0;">
                <div style="font-size:9px;font-weight:800;color:var(--rd);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px;">${ic('alert-triangle',9)} Avvikelse</div>
                ${c.avvikelseComment?`<div style="font-size:12px;color:#374151;line-height:1.45;">${c.avvikelseComment}</div>`:''}
                ${c.avvikelseImage?`<img src="${c.avvikelseImage}" style="margin-top:4px;max-width:100%;border-radius:6px;max-height:90px;object-fit:cover;">`:''}
                ${c.avvikelseBy||c.avvikelseAt?`<div style="font-size:10px;color:var(--mt);margin-top:2px;">${c.avvikelseBy||''}${c.avvikelseAt?' · '+relDate(c.avvikelseAt):''}</div>`:''}
              </div>` : ''}
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0;align-self:center;">
              <button class="btn bxs ${isOk?'bsu':'bs'}" onclick="WorkOrderDetailPage.setAvvikelse(${i},'ok')"
                style="font-size:9px;padding:3px 7px;" title="${isOk?'OK markerat':'Markera OK'}">
                ${ic('check',9)} ${isOk ? 'OK' : 'OK'}
              </button>
              <button class="btn bxs ${isAvv?'bd':'bs'}" onclick="WorkOrderDetailPage.setAvvikelse(${i},'avvikelse')"
                style="font-size:9px;padding:3px 7px;" title="${isAvv?'Avvikelse markerad':'Markera avvikelse'}">
                ${ic('alert-triangle',9)}
              </button>
              <button class="btn bxs bd" onclick="WorkOrderDetailPage.removeCheck(${i})"
                style="font-size:9px;padding:3px 6px;" title="Ta bort">
                ${ic('trash',9)}
              </button>
            </div>
          </div>
        </div>`;
      }).join('')}`;
  },

  /* ── Material ─────────────────────────────── */
  _matTotals(ao) {
    const mats = ao.materials || [];
    if (!mats.length) return '';
    let exMoms = 0, momsAmt = 0;
    mats.forEach(m => {
      const ex = (m.qty||0) * (m.sellPrice||0);
      const vat = m.vatRate != null ? m.vatRate : 25;
      exMoms  += ex;
      momsAmt += ex * vat / 100;
    });
    const inkl = exMoms + momsAmt;
    return `
      <div style="padding:10px 14px;border-top:1px solid var(--br);">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--mt);margin-bottom:3px;">
          <span>Totalt ex moms</span><span>${fmt(exMoms)} kr</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--mt);margin-bottom:3px;">
          <span>Moms (25%)</span><span>${fmt(momsAmt)} kr</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:800;">
          <span>Totalt inkl moms</span><span>${fmt(inkl)} kr</span>
        </div>
      </div>`;
  },

  _renderMaterials(ao) {
    const mats = ao.materials || [];
    if (!mats.length) return `<p style="padding:12px 14px;color:var(--mt);font-size:13px;font-style:italic;">Inget material registrerat ännu.</p>`;
    return `<div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:var(--bg);border-bottom:2px solid var(--br);">
            <th style="padding:7px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mt);">Material</th>
            <th style="padding:7px 6px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mt);white-space:nowrap;">Antal</th>
            <th style="padding:7px 6px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mt);white-space:nowrap;">À-pris</th>
            <th style="padding:7px 14px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--mt);white-space:nowrap;">Inkl. moms</th>
            <th style="padding:7px 10px;text-align:right;width:1px;"></th>
          </tr>
        </thead>
        <tbody>
          ${mats.map(m => {
            const qty = m.qty || 0;
            const sell = m.sellPrice || 0;
            const buy  = m.buyPrice || 0;
            const vat  = m.vatRate != null ? m.vatRate : 25;
            const exMoms  = qty * sell;
            const momsAmt = exMoms * vat / 100;
            const inklMoms = exMoms + momsAmt;
            return `<tr style="border-bottom:1px solid var(--bg);" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
              <td style="padding:9px 14px;">
                <div style="font-weight:700;color:var(--tx);">${m.name}</div>
                ${buy > 0 ? `<div id="mat-int-${m.id}" style="display:none;font-size:10px;color:var(--mt);font-style:italic;margin-top:2px;">Ink: ${fmt(buy)} kr · Marginal: ${fmt(Math.max(0,sell-buy))} kr/st</div>
                <button type="button" onclick="(function(){var e=document.getElementById('mat-int-${m.id}');e.style.display=e.style.display==='none'?'':'none';})()" style="font-size:9px;color:var(--mt);background:none;border:none;padding:0;cursor:pointer;display:flex;align-items:center;gap:2px;margin-top:2px;">${ic('eye',9)} Intern</button>` : ''}
              </td>
              <td style="padding:9px 6px;text-align:right;white-space:nowrap;color:var(--mt);">${qty} ${m.unit}</td>
              <td style="padding:9px 6px;text-align:right;white-space:nowrap;color:var(--mt);">${fmt(sell)} kr</td>
              <td style="padding:9px 14px;text-align:right;font-weight:700;color:var(--navy);white-space:nowrap;">${fmt(inklMoms)} kr</td>
              <td style="padding:9px 10px;text-align:right;white-space:nowrap;">
                <div style="display:flex;gap:4px;justify-content:flex-end;">
                  <button class="btn bxs bs" onclick="WorkOrderDetailPage.openEditMaterial('${m.id}')">${ic('pencil',11)}</button>
                  <button class="btn bxs bd" onclick="WorkOrderDetailPage.deleteMaterial('${m.id}')">${ic('trash',11)}</button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  },

  _renderTimeEntries(ao) {
    const entries = TimeService.getByAO(ao.id);
    if (!entries.length) return `<p style="padding:12px 14px;color:var(--mt);font-size:13px;">Ingen tid registrerad</p>`;
    return entries.map(t => `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--bg);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;">${t.staffName} · ${TimeService.fmtDuration(t.minutes)}</div>
          <div style="font-size:11px;color:var(--mt);">${t.date} ${t.startStr}–${t.endStr}${t.comment?' · '+t.comment:''}</div>
          ${t.priceGroupName ? `<div style="font-size:11px;color:var(--sky);">${t.priceGroupName} – ${fmt(t.hourRate)} kr/tim ex moms</div>` : ''}
          ${t.registeredByName ? `<div style="font-size:10px;color:var(--mt);font-style:italic;">Registrerat av ${t.registeredByName}</div>` : ''}
          ${!t.billable ? `<span style="font-size:10px;color:var(--mt);font-style:italic;">Ej debiterbar</span>` : ''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <button class="btn bxs bs" onclick="WorkOrderDetailPage.openEditTime('${t.id}')">${ic('pencil',12)}</button>
          <button class="btn bxs bd" onclick="WorkOrderDetailPage.deleteTime('${t.id}')">${ic('trash',12)}</button>
        </div>
      </div>`).join('');
  },

  /* ── Tidslinje/logg ───────────────────────── */
  _renderTimeline(ao, showAll = false) {
    const events = [];
    (ao.notes||[]).forEach(n => events.push({ type:'note', ts:n.timestamp||'', who:n.staffName||'', text:n.text||'', id:n.id }));
    (ao.log||[]).forEach(l => events.push({ type:l.type||'log', ts:l.timestamp||'', who:l.userName||'', text:l.text||'', imageData:l.imageData||'', followUpDate:l.followUpDate||'', id:l.id }));
    TimeService.getByAO(ao.id).forEach(t => events.push({ type:'time', ts:t.createdAt||t.date||'', who:t.staffName||'', text:`${TimeService.fmtDuration(t.minutes)} registrerad${t.comment?' – '+t.comment:''}` }));
    (ao.materials||[]).forEach(m => { if (m.addedAt) events.push({ type:'material', ts:m.addedAt, who:'', text:`${m.qty} ${m.unit} ${m.name} tillagd` }); });
    ActivityService.getByWorkOrder(ao.id, 50).forEach(a => {
      if (a.type==='status_change'||a.type==='work_order_status'||a.type==='created')
        events.push({ type:a.type, ts:a.timestamp||'', who:'', text:a.description||'' });
    });

    if (!events.length) return `<div style="padding:20px 14px;text-align:center;color:var(--mt);font-size:13px;">Ingen logg ännu</div>`;
    events.sort((a,b) => (b.ts>a.ts?1:b.ts<a.ts?-1:0));

    const LIMIT   = 5;
    const hasMore = !showAll && events.length > LIMIT;
    const display = hasMore ? events.slice(0, LIMIT) : events;

    const TI = {
      note:              {ico:'file-text',   col:'var(--navy)', lbl:'Anteckning'},
      log:               {ico:'activity',    col:'var(--sky)',  lbl:'Logg'},
      photo:             {ico:'camera',      col:'var(--sky)',  lbl:'Foto'},
      time:              {ico:'clock',       col:'#16a34a',     lbl:'Tid'},
      material:          {ico:'package',     col:'#c2410c',     lbl:'Material'},
      status_change:     {ico:'refresh-cw',  col:'var(--mt)',   lbl:'Status'},
      work_order_status: {ico:'refresh-cw',  col:'var(--mt)',   lbl:'Status'},
      created:           {ico:'plus-circle', col:'var(--sky)',  lbl:'Skapad'},
      uppföljning:       {ico:'bell',        col:'#7c3aed',     lbl:'Uppföljning'},
    };

    const fmtTs = ts => {
      if (!ts) return '';
      try {
        const d = new Date(ts);
        if (isNaN(d)) return relDate(ts);
        const now = new Date();
        const pad = n => String(n).padStart(2,'0');
        const hm = pad(d.getHours())+':'+pad(d.getMinutes());
        if (d.toDateString()===now.toDateString()) return 'Idag '+hm;
        const yest = new Date(now); yest.setDate(now.getDate()-1);
        if (d.toDateString()===yest.toDateString()) return 'Igår '+hm;
        const sameYear = d.getFullYear()===now.getFullYear();
        return pad(d.getDate())+'/'+pad(d.getMonth()+1)+(sameYear?'':' '+d.getFullYear())+' '+hm;
      } catch(e) { return relDate(ts); }
    };

    let html = '<div style="padding:12px 14px 8px;">' + display.map((ev, i) => {
      const ti = TI[ev.type] || {ico:'activity', col:'var(--mt)', lbl:ev.type};
      const isLast = i === display.length - 1;
      const ts = fmtTs(ev.ts);
      const canDel = ev.id && (ev.type==='log'||ev.type==='photo'||ev.type==='uppföljning');
      return `
        <div style="display:flex;gap:0;">
          <div style="display:flex;flex-direction:column;align-items:center;width:36px;flex-shrink:0;">
            <div style="width:30px;height:30px;border-radius:50%;background:${ti.col}1a;border:1.5px solid ${ti.col}50;display:flex;align-items:center;justify-content:center;color:${ti.col};flex-shrink:0;">${ic(ti.ico,13)}</div>
            ${!isLast?'<div style="width:2px;flex:1;min-height:8px;background:var(--br);border-radius:1px;"></div>':''}
          </div>
          <div style="flex:1;min-width:0;padding:2px 0 ${isLast?'4':'16'}px 10px;">
            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:${ev.text||ev.imageData?'3':'0'}px;">
              <span style="font-size:10px;font-weight:800;color:${ti.col};text-transform:uppercase;letter-spacing:.4px;">${ti.lbl}</span>
              ${ts?`<span style="font-size:10px;color:var(--mt);">${ts}</span>`:''}
              ${ev.who?`<span style="font-size:10px;color:var(--mt);display:inline-flex;align-items:center;gap:3px;">${ic('user',9)} ${esc(ev.who)}</span>`:''}
            </div>
            ${ev.text?`<div style="font-size:13px;line-height:1.5;word-break:break-word;color:var(--tx);">${ev.text}</div>`:''}
            ${ev.followUpDate?`<div style="margin-top:5px;display:inline-flex;align-items:center;gap:4px;background:#f3e8ff;color:#7c3aed;font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;border:1px solid #ddd6fe;">${ic('calendar',9)} Uppföljning: ${ev.followUpDate}</div>`:''}
            ${ev.imageData?`<img src="${ev.imageData}" style="max-width:100%;max-width:260px;border-radius:8px;margin-top:6px;max-height:200px;object-fit:cover;border:1px solid var(--br);" loading="lazy">`:''}
          </div>
          ${canDel?`<button class="btn bxs bd" style="flex-shrink:0;align-self:flex-start;margin-top:1px;" onclick="WorkOrderDetailPage.deleteLogEntry('${ev.id}')">${ic('trash',12)}</button>`:''}
        </div>`;
    }).join('');

    if (hasMore) {
      html += `<div style="padding:0 14px 12px;">
        <button class="btn bghost bfull" style="font-size:12px;" onclick="WorkOrderDetailPage._showAllTimeline()">
          ${ic('chevron-down',13)} Visa alla ${events.length} händelser
        </button>
      </div>`;
    }
    html += '</div>';
    return html;
  },

  openAddLog() {
    Modal.open({
      title: 'Lägg till loggpost',
      body: `
        <div class="fg"><label>Text / beskrivning</label>
          <textarea id="log-text" rows="3" placeholder="Beskriv vad som hände eller vad bilden visar…"></textarea></div>
        <div class="fg">
          <label>Bild (valfri — kan kombineras med text)</label>
          <input type="file" id="log-img" accept="image/*" onchange="WorkOrderDetailPage._previewLogImg(this)">
          <div id="log-img-preview" style="margin-top:6px;"></div>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._saveLog() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('log-text')?.focus(), 80);
  },

  _previewLogImg(input) {
    const file = input.files && input.files[0];
    const prev = document.getElementById('log-img-preview');
    if (!file || !prev) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      prev.innerHTML = `<img src="${e.target.result}" style="max-width:100%;border-radius:8px;max-height:160px;object-fit:cover;">`;
    };
    reader.readAsDataURL(file);
  },

  _saveLog() {
    const text = document.getElementById('log-text')?.value.trim();
    const imgInput = document.getElementById('log-img');
    const file = imgInput && imgInput.files && imgInput.files[0];
    if (!text && !file) { showToast('Lägg till text eller bild'); return; }

    const finalize = (imageData) => {
      const ao = getAO(this.aoId);
      if (!ao) return;
      if (!ao.log) ao.log = [];
      const entry = {
        id: 'LOG-' + Date.now(),
        type: (file && imageData) ? (text ? 'photo' : 'photo') : 'log',
        text: text || '',
        imageData: imageData || '',
        visibility: 'intern',
        userName: state.currentUser ? state.currentUser.firstName + ' ' + state.currentUser.lastName : 'Okänd',
        timestamp: new Date().toISOString()
      };
      ao.log.push(entry);
      WorkOrderService.update(this.aoId, { log: ao.log });
      Modal.close();
      const aoUp = getAO(this.aoId);
      if (aoUp) document.getElementById('ao-timeline').innerHTML = this._renderTimeline(aoUp);
      showToast('Loggpost tillagd');
    };

    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => finalize(e.target.result);
      reader.readAsDataURL(file);
    } else {
      finalize('');
    }
  },

  deleteLogEntry(logId) {
    Modal.confirm('Ta bort loggpost?', () => {
      const ao = getAO(this.aoId);
      if (!ao) return;
      ao.log = (ao.log||[]).filter(l => l.id !== logId);
      WorkOrderService.update(this.aoId, { log: ao.log });
      const aoUp = getAO(this.aoId);
      if (aoUp) document.getElementById('ao-timeline').innerHTML = this._renderTimeline(aoUp);
      showToast('Borttagen');
    });
  },

  /* ── Uppföljning ───────────────────────────── */
  openFollowUp() {
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 2);
    const defaultDateStr = defaultDate.toISOString().split('T')[0];
    Modal.open({
      title: `${ic('bell',14)} Skapa uppföljning`,
      body: `
        <div class="fg"><label>Typ</label>
          <select id="fu-type">
            <option value="Följ upp kund">Följ upp kund</option>
            <option value="Ring kund">Ring kund</option>
            <option value="Skicka påminnelse">Skicka påminnelse</option>
            <option value="Återbesök">Återbesök</option>
            <option value="Kontrollera arbete">Kontrollera arbete</option>
          </select>
        </div>
        <div class="fg"><label>Kommentar <span style="color:var(--rd)">*</span></label>
          <textarea id="fu-comment" rows="3" placeholder="Vad ska följas upp? Vad är syftet?"></textarea>
        </div>
        <div class="g2">
          <div class="fg"><label>Datum för uppföljning <span style="color:var(--rd)">*</span></label>
            <input type="date" id="fu-date" value="${defaultDateStr}"></div>
          <div class="fg"><label>Tid (valfritt)</label>
            <input type="time" id="fu-time"></div>
        </div>`,
      buttons: [
        { label: 'Skapa uppföljning', cls: 'btn bsu', onClick: () => this._saveFollowUp() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('fu-comment')?.focus(), 80);
  },

  _saveFollowUp() {
    const date    = document.getElementById('fu-date')?.value;
    const time    = document.getElementById('fu-time')?.value || '';
    const type    = document.getElementById('fu-type')?.value || 'Följ upp kund';
    const comment = document.getElementById('fu-comment')?.value.trim();
    if (!date)    { showToast('Välj datum'); return; }
    if (!comment) { showToast('Kommentar krävs'); return; }
    const ao = getAO(this.aoId);
    if (!ao) return;
    if (!ao.log) ao.log = [];
    const who = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '';
    const entry = {
      id: 'LOG-' + Date.now(),
      type: 'uppföljning',
      text: `${type}: ${comment}`,
      followUpDate: date,
      followUpTime: time,
      followUpType: type,
      imageData: '',
      visibility: 'intern',
      userName: who,
      timestamp: new Date().toISOString()
    };
    ao.log.push(entry);
    WorkOrderService.update(this.aoId, { log: ao.log });
    ActivityService.log('uppföljning', `${type}: ${comment} (${date}${time?' '+time:''})`, {
      workOrderId: this.aoId,
      customerId: ao.customerId
    });
    ActivitiesService.create({
      type:        'followup',
      relatedType: 'workOrder',
      relatedId:   this.aoId,
      customerId:  ao.customerId || null,
      dueDate:     date,
      dueTime:     time,
      note:        `${type}: ${comment}`
    });
    Sidebar.updateBadges();
    Modal.close();
    const aoUp = getAO(this.aoId);
    if (aoUp) document.getElementById('ao-timeline').innerHTML = this._renderTimeline(aoUp);
    showToast(`Uppföljning skapad: ${date}`);
  },

  /* ── Material-modal ───────────────────────── */
  openAddMaterial() {
    if (!Auth.require('ao_material')) return;
    const articles = (state.articles||[]).filter(a=>a.active);
    const artListHtml = articles.length ? articles.map(a => `
      <div class="art-row" data-id="${a.id}" data-name="${a.name}" data-unit="${a.unit}" data-buy="${a.buyPrice}" data-sell="${a.sellPrice}" data-vat="${a.vatRate||25}" data-cat="${a.category||''}"
        onclick="WorkOrderDetailPage._matSelectArticle(this)"
        style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-radius:8px;transition:background .1s;"
        onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:700;">${a.articleNumber ? a.articleNumber+' – ':'' }${a.name}</div>
          <div style="font-size:11px;color:var(--mt);">${a.unit} · Ink: ${fmt(a.buyPrice)} kr · Pris: ${fmt(a.sellPrice)} kr ex moms</div>
        </div>
        <div id="art-check-${a.id}" style="display:none;color:var(--grn);">${ic('check',14)}</div>
      </div>`).join('') : '<p style="padding:8px;font-size:12px;color:var(--mt);">Inga artiklar i register</p>';

    Modal.open({
      title: 'Lägg till material',
      wide: true,
      body: `
        ${articles.length ? `
          <div style="margin-bottom:12px;">
            <div style="font-size:12px;font-weight:700;color:var(--mt);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;">Välj från artikelregister</div>
            <div class="fg" style="margin-bottom:6px;">
              <input id="art-search" placeholder="Sök artikel…" oninput="WorkOrderDetailPage._matFilterArticles()" autocomplete="off">
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
              ${[{v:'',l:'Alla'},{v:'kemikalier',l:'Kemikalier'},{v:'material',l:'Byggmaterial'},{v:'forbruk',l:'Förbrukning'},{v:'arbete',l:'Arbete'},{v:'kostnad',l:'Kostnad'}].map(c =>
                `<button type="button" class="chip ${c.v===''?'on':''}" data-cat="${c.v||'all'}" onclick="WorkOrderDetailPage._matSetCat('${c.v}',this)">${c.l}</button>`
              ).join('')}
            </div>
            <div id="art-list" style="max-height:180px;overflow-y:auto;border:1.5px solid var(--br);border-radius:9px;padding:4px;">${artListHtml}</div>
          </div>
          <div style="font-size:12px;font-weight:700;color:var(--mt);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;">Eller ange manuellt</div>` : ''}
        <div class="fg"><label>Benämning <span style="color:var(--rd)">*</span></label>
          <input id="mat-name" placeholder="T.ex. Fogmassa Sikaflex"></div>
        <div class="g3">
          <div class="fg"><label>Antal</label><input type="number" id="mat-qty" value="1" min="1" step="1" oninput="WorkOrderDetailPage._matUpdateCalc()"></div>
          <div class="fg"><label>Enhet</label>
            <select id="mat-unit" onchange="WorkOrderDetailPage._matUnitChanged(this.value)">
              ${unitsHtml('st')}
            </select></div>
          <div class="fg"><label>Ink-pris (kr)</label><input type="number" id="mat-buy" placeholder="0" min="0" oninput="WorkOrderDetailPage._matUpdateCalc()"></div>
        </div>
        <div class="fg"><label>Försäljningspris ex moms (kr/enhet)</label>
          <input type="number" id="mat-sell" placeholder="0" min="0" oninput="WorkOrderDetailPage._matUpdateCalc()"></div>
        <input type="hidden" id="mat-vat" value="25">
        <input type="hidden" id="mat-article-id" value="">
        <div id="mat-calc" style="display:none;background:var(--bg);border-radius:9px;padding:10px 12px;margin-top:6px;font-size:12px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:var(--mt)">Ex moms</span><span id="mat-ex">0 kr</span></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:var(--mt)">Moms 25%</span><span id="mat-moms">0 kr</span></div>
          <div style="display:flex;justify-content:space-between;font-weight:800;"><span>Inkl moms</span><span id="mat-inkl">0 kr</span></div>
        </div>`,
      buttons: [
        { label: 'Lägg till', cls: 'btn bp', onClick: () => this._saveMaterial(null) },
        { label: 'Avbryt',   cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('art-search')?.focus(), 80);
  },

  _matCatFilter: '',

  _matSetCat(cat, btn) {
    this._matCatFilter = cat;
    document.querySelectorAll('#art-cat-filter-chips .chip, .art-cat-chip').forEach(b => b.classList.remove('on'));
    document.querySelectorAll(`[data-cat="${cat||'all'}"]`).forEach(b => b.classList.add('on'));
    if (btn) { document.querySelectorAll('.chip[data-cat]').forEach(b => b.classList.remove('on')); btn.classList.add('on'); }
    this._matFilterArticles();
  },

  _matFilterArticles() {
    const q   = (document.getElementById('art-search')?.value || '').toLowerCase();
    const cat = this._matCatFilter;
    document.querySelectorAll('#art-list .art-row').forEach(row => {
      const name   = (row.dataset.name || '').toLowerCase();
      const rowCat = row.dataset.cat || '';
      const matchQ   = !q   || name.includes(q);
      const matchCat = !cat || rowCat === cat;
      row.style.display = (matchQ && matchCat) ? '' : 'none';
    });
  },

  _matSearch(q) {
    this._matFilterArticles();
  },

  _matSelectArticle(el) {
    // Toggle selection
    const selected = el.classList.contains('selected');
    document.querySelectorAll('#art-list .art-row').forEach(r => {
      r.classList.remove('selected');
      r.style.background = '';
      const chk = document.getElementById('art-check-' + r.dataset.id);
      if (chk) chk.style.display = 'none';
    });
    if (selected) {
      // Deselect: clear fields
      document.getElementById('mat-article-id').value = '';
      document.getElementById('mat-name').value = '';
      document.getElementById('mat-vat').value = '25';
      return;
    }
    el.classList.add('selected');
    el.style.background = 'var(--navy10,#f0f4ff)';
    const chk = document.getElementById('art-check-' + el.dataset.id);
    if (chk) chk.style.display = '';

    document.getElementById('mat-article-id').value = el.dataset.id;
    document.getElementById('mat-name').value = el.dataset.name || '';
    document.getElementById('mat-vat').value  = el.dataset.vat || '25';
    const buyEl  = document.getElementById('mat-buy');
    const sellEl = document.getElementById('mat-sell');
    const unitEl = document.getElementById('mat-unit');
    if (buyEl)  buyEl.value  = el.dataset.buy  || '0';
    if (sellEl) sellEl.value = el.dataset.sell || '0';
    if (unitEl) {
      for (let i = 0; i < unitEl.options.length; i++) {
        if (unitEl.options[i].value === el.dataset.unit) { unitEl.selectedIndex = i; break; }
      }
      this._matUnitChanged(unitEl.value);
    }
    this._matUpdateCalc();
  },

  _matUnitChanged(unit) {
    const step  = unitStep(unit);
    const qtyEl = document.getElementById('mat-qty');
    if (qtyEl) { qtyEl.step = step; qtyEl.min = step; }
  },

  _matUpdateCalc() {
    const qty  = parseFloat(document.getElementById('mat-qty')?.value) || 0;
    const sell = parseFloat(document.getElementById('mat-sell')?.value) || 0;
    const vat  = parseFloat(document.getElementById('mat-vat')?.value) || 25;
    const calc = document.getElementById('mat-calc');
    if (!calc) return;
    const exV = qty * sell;
    const momsV = exV * vat / 100;
    if (exV > 0 || sell > 0) {
      calc.style.display = '';
      document.getElementById('mat-ex').textContent    = fmt(exV) + ' kr';
      document.getElementById('mat-moms').textContent  = fmt(momsV) + ' kr';
      document.getElementById('mat-inkl').textContent  = fmt(exV + momsV) + ' kr';
    } else {
      calc.style.display = 'none';
    }
  },

  openEditMaterial(matId) {
    const ao = getAO(this.aoId);
    const m  = (ao.materials||[]).find(x=>x.id===matId);
    if (!m) return;
    const vat = m.vatRate != null ? m.vatRate : 25;
    Modal.open({
      title: 'Redigera material',
      body: `
        <div class="fg"><label>Benämning</label><input id="mat-name" value="${m.name}"></div>
        <div class="g3">
          <div class="fg"><label>Antal</label><input type="number" id="mat-qty" value="${m.qty}" min="${unitStep(m.unit||'st')}" step="${unitStep(m.unit||'st')}" oninput="WorkOrderDetailPage._matUpdateCalc()"></div>
          <div class="fg"><label>Enhet</label>
            <select id="mat-unit" onchange="WorkOrderDetailPage._matUnitChanged(this.value)">
              ${unitsHtml(m.unit||'st')}
            </select></div>
          <div class="fg"><label>Ink-pris (kr)</label><input type="number" id="mat-buy" value="${m.buyPrice}" min="0" oninput="WorkOrderDetailPage._matUpdateCalc()"></div>
        </div>
        <div class="fg"><label>Försäljningspris ex moms (kr/enhet)</label>
          <input type="number" id="mat-sell" value="${m.sellPrice}" min="0" oninput="WorkOrderDetailPage._matUpdateCalc()"></div>
        <input type="hidden" id="mat-vat" value="${vat}">
        <input type="hidden" id="mat-article-id" value="${m.articleId||''}">
        <div id="mat-calc" style="background:var(--bg);border-radius:9px;padding:10px 12px;margin-top:6px;font-size:12px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:var(--mt)">Ex moms</span><span id="mat-ex">${fmt((m.qty||0)*(m.sellPrice||0))} kr</span></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:var(--mt)">Moms ${vat}%</span><span id="mat-moms">${fmt((m.qty||0)*(m.sellPrice||0)*vat/100)} kr</span></div>
          <div style="display:flex;justify-content:space-between;font-weight:800;"><span>Inkl moms</span><span id="mat-inkl">${fmt((m.qty||0)*(m.sellPrice||0)*(1+vat/100))} kr</span></div>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._saveMaterial(matId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveMaterial(existingId) {
    const name = document.getElementById('mat-name')?.value.trim();
    if (!name) { showToast('Benämning krävs'); return; }
    const data = {
      name,
      qty:      parseFloat(document.getElementById('mat-qty')?.value) || 1,
      unit:     document.getElementById('mat-unit')?.value || 'st',
      buyPrice: parseFloat(document.getElementById('mat-buy')?.value)  || 0,
      sellPrice:parseFloat(document.getElementById('mat-sell')?.value) || 0,
      vatRate:  parseFloat(document.getElementById('mat-vat')?.value)  || 25,
      articleId:document.getElementById('mat-article-id')?.value || '',
      addedAt:  existingId ? undefined : new Date().toISOString()
    };
    if (existingId) {
      WorkOrderService.updateMaterial(this.aoId, existingId, data);
      showToast('Material uppdaterat');
    } else {
      WorkOrderService.addMaterial(this.aoId, data);
      showToast('Material tillagt');
    }
    Modal.close();
    this._refreshMaterialSection();
  },

  deleteMaterial(matId) {
    Modal.confirm('Ta bort material?', () => {
      WorkOrderService.deleteMaterial(this.aoId, matId);
      this._refreshMaterialSection();
      showToast('Borttaget');
    });
  },

  /* ── Refresh-helpers (partiell DOM-uppdatering utan full re-render) ── */

  _refreshTimeSection() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    const timeEntries = TimeService.getByAO(ao.id);
    const totalMins   = TimeService.totalMinutes(timeEntries);

    const listEl  = document.getElementById('ao-timeentries');
    if (listEl)  listEl.innerHTML  = this._renderTimeEntries(ao);

    const badge   = document.getElementById('ao-time-badge');
    if (badge)   badge.innerHTML   = totalMins > 0 ? `<span class="bdg bdg-sky">${TimeService.fmtDuration(totalMins)}</span>` : '';

    const planEl  = document.getElementById('ao-time-plan');
    if (planEl)  planEl.innerHTML  = this._timePlanBlock(ao);

    const timelineEl = document.getElementById('ao-timeline');
    if (timelineEl)  timelineEl.innerHTML = this._renderTimeline(ao);

    const lonEl   = document.getElementById('ao-lonsam');
    if (lonEl)   lonEl.innerHTML   = this._renderLonsamhet(ao);

    // Öppna tidssektionen om det finns poster
    if (TimeService.getByAO(ao.id).length > 0) this._openSectionOf('ao-timeentries');

    Sidebar.updateBadges();
  },

  _refreshMaterialSection() {
    const ao = getAO(this.aoId);
    if (!ao) return;

    const listEl  = document.getElementById('ao-materials');
    if (listEl)  listEl.innerHTML  = this._renderMaterials(ao);

    const totEl   = document.getElementById('ao-mat-totals');
    if (totEl)   totEl.innerHTML   = (ao.materials||[]).length > 0 ? this._matTotals(ao) : '';

    const lonEl   = document.getElementById('ao-lonsam');
    if (lonEl)   lonEl.innerHTML   = this._renderLonsamhet(ao);

    // Öppna materialsektionen om det finns material
    if ((ao.materials||[]).length > 0) this._openSectionOf('ao-materials');
  },

  /* ── Stämpling timer ──────────────────── */
  _startStampTimer() {
    this._stopStampTimer();
    this._stampInterval = setInterval(() => {
      const el = document.getElementById('ao-stamp-elapsed');
      if (!el || !state.stampActive || state.stampAoId !== this.aoId) { this._stopStampTimer(); return; }
      el.textContent = 'Inklockat ' + TimeService.elapsedStr(state.stampTimestamp);
    }, 30000);
  },

  _stopStampTimer() {
    if (this._stampInterval) { clearInterval(this._stampInterval); this._stampInterval = null; }
  },

  /* ── Åtgärder ──────────────────────────── */
  setStatus(status) {
    if (!Auth.require('ao_edit')) return;
    const ao = getAO(this.aoId);
    if (!ao) return;
    WorkOrderService.setStatus(this.aoId, status);
    if (status !== 'pågående') WorkOrderService.update(this.aoId, {substatus: ''});
    this.render({ aoId: this.aoId });
    Sidebar.updateBadges();
    showToast(`Status: ${statusLabel(status)}`);
  },

  setSubstatus(val) {
    if (!Auth.require('ao_edit')) return;
    WorkOrderService.update(this.aoId, {substatus: val});
    const ao = getAO(this.aoId);
    if (!ao) return;
    this.render({ aoId: this.aoId });
    const labels = {inväntar_material:'Inväntar material',inväntar_kund:'Inväntar kund',pausad:'Pausad',behöver_återbesök:'Behöver återbesök',blockerad:'Blockerad'};
    showToast(val ? 'Substatus: ' + (labels[val]||val) : 'Substatus borttaget');
  },

  markComplete() {
    if (!Auth.require('ao_complete')) return;
    const ao = getAO(this.aoId);
    if (!ao) return;
    const chkTotal = (ao.checklist||[]).length;
    const chkOkCnt = (ao.checklist||[]).filter(c=>c.done||c.avvikelse==='ok').length;
    const chkAvvCnt= (ao.checklist||[]).filter(c=>c.avvikelse==='avvikelse').length;
    const incomplete = chkTotal > 0 && (chkOkCnt + chkAvvCnt) < chkTotal;

    const doComplete = () => {
      const completedBy = state.currentUser
        ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim()
        : '';
      WorkOrderService.markComplete(this.aoId, completedBy);
      this.render({ aoId: this.aoId });
      Sidebar.updateBadges();
      showToast('Order markerad klar');
    };

    if (incomplete) {
      Modal.open({
        title: 'Ofullständig checklista',
        body: `
          <div class="nbox" style="margin-bottom:12px;">${ic('alert-triangle',16)} ${chkOkCnt + chkAvvCnt} av ${chkTotal} checkpunkter är hanterade</div>
          <p style="font-size:13px;color:var(--mt);">Vill du ändå klarmarkera ordern?</p>`,
        buttons: [
          { label: 'Klarmarkera ändå', cls: 'btn bsu', onClick: () => { Modal.close(); doComplete(); } },
          { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
        ]
      });
    } else {
      Modal.confirm('Markera ordern som klar?', doComplete);
    }
  },

  openStatusModal() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    const statuses = ['nytt','pool','planerad','pågående','klar','avbruten'];
    Modal.open({
      title: 'Ändra status',
      body: statuses.map(s => `
        <div class="crow" onclick="Modal.close();setTimeout(()=>WorkOrderDetailPage.setStatus('${s}'),50);">
          ${sbdg(s)}
          <span style="font-size:13px;">${ao.status===s?ic('check',14):''}</span>
        </div>`).join('')
    });
  },

  openReactivateModal() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    Modal.open({
      title: `${ic('rotate-ccw',14)} Återaktivera arbetsorder`,
      body: `
        <p style="font-size:13px;color:var(--mt);margin-bottom:14px;">Ordern är avbruten. Välj ny status att återaktivera till:</p>
        <div class="fg">
          <label>Ny status</label>
          <select id="reactivate-status" style="font-size:14px;">
            <option value="nytt">Nytt</option>
            <option value="planerad">Planerad</option>
            <option value="pågående">Pågående</option>
          </select>
        </div>`,
      buttons: [
        { label: `${ic('rotate-ccw',12)} Återaktivera`, cls: 'btn bsu', onClick: () => this._doReactivate() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _doReactivate() {
    const newStatus = document.getElementById('reactivate-status')?.value || 'nytt';
    WorkOrderService.setStatus(this.aoId, newStatus);
    Modal.close();
    this.render({ aoId: this.aoId });
    Sidebar.updateBadges();
    showToast(`Arbetsorder återaktiverad – ${statusLabel(newStatus)}`);
  },

  openArchiveModal() {
    Modal.open({
      title: `${ic('archive',14)} Arkivera arbetsorder`,
      body: `<p style="font-size:13px;color:var(--mt);">Ordern arkiveras och syns inte i ordinarie lista. Du kan återställa den när som helst från Arkiverade-vyn.</p>`,
      buttons: [
        { label: `${ic('archive',12)} Arkivera`, cls: 'btn bp', onClick: () => {
          WorkOrderService.archive(this.aoId);
          Modal.close();
          showToast('Arbetsorder arkiverad');
          Sidebar.updateBadges();
          Router.showPage('pg-ao');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openDeleteModal() {
    Modal.open({
      title: `${ic('trash',14)} Ta bort arbetsorder`,
      body: `<p style="font-size:13px;color:var(--mt);">Ordern hamnar i papperskorgen och raderas automatiskt efter 14 dagar. Du kan återställa den dessförinnan.</p>`,
      buttons: [
        { label: `${ic('trash',12)} Ta bort`, cls: 'btn bd', onClick: () => {
          WorkOrderService.softDelete(this.aoId);
          Modal.close();
          showToast('Arbetsorder borttagen (papperskorg)');
          Sidebar.updateBadges();
          Router.showPage('pg-ao');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _restoreFromArchive(id) {
    WorkOrderService.restoreFromArchive(id || this.aoId);
    showToast('Återställd från arkiv');
    if (id && id !== this.aoId) return;
    this.render({ aoId: this.aoId });
  },

  _restoreFromTrash(id) {
    WorkOrderService.restoreFromTrash(id || this.aoId);
    showToast('Återställd från papperskorg');
    if (id && id !== this.aoId) return;
    this.render({ aoId: this.aoId });
  },

  _confirmPermanentDelete(id) {
    const targetId = id || this.aoId;
    Modal.open({
      title: `${ic('trash-2',14)} Radera permanent`,
      body: `<p style="font-size:13px;color:var(--mt);">Arbetsorder <strong>${targetId}</strong> raderas permanent och kan inte återställas.</p>`,
      buttons: [
        { label: `${ic('trash-2',12)} Radera permanent`, cls: 'btn bd', onClick: () => {
          WorkOrderService.permanentDelete(targetId);
          Modal.close();
          showToast('Arbetsorder raderad permanent');
          Sidebar.updateBadges();
          Router.showPage('pg-ao');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  toggleStamp() {
    if (state.stampActive && state.stampAoId !== this.aoId) {
      showToast('Du är inklockat på ett annat jobb');
      return;
    }
    if (!state.stampActive) {
      TimeService.clockIn(this.aoId);
      showToast('Inklockat');
      this.render({ aoId: this.aoId });
    } else {
      this._openClockOutModal();
    }
  },

  _openClockOutModal() {
    const mins = Math.round((Date.now() - state.stampTimestamp) / 60000);
    const ao = getAO(this.aoId);
    const aoPgId = ao ? (ao.priceGroupId || '') : '';
    const pgOptions = (state.priceGroups||[]).filter(p=>p.active).map(p =>
      `<option value="${p.id}" ${p.id===aoPgId?'selected':''}>${p.name} – ${fmt(p.hourRate)} kr/tim ex moms</option>`
    ).join('');
    Modal.open({
      title: 'Klocka ut',
      body: `
        <div class="ibox" style="margin-bottom:12px;">${ic('clock',14)} Tid: ${TimeService.fmtDuration(mins)}</div>
        <div class="fg"><label>Prisgrupp</label>
          <select id="co-pg"><option value="">— Ingen —</option>${pgOptions}</select></div>
        <div class="fg"><label>Vad utfördes? <span style="color:var(--rd)">*</span></label>
          <textarea id="co-comment" rows="2" placeholder="Beskriv vad som gjordes…"></textarea></div>
        <div class="fg">
          <label><input type="checkbox" id="co-billable" checked style="width:16px;height:16px;margin-right:6px;">Debiterbar tid</label>
        </div>`,
      buttons: [
        { label: 'Klocka ut', cls: 'btn bsu', onClick: () => {
          const comment = document.getElementById('co-comment')?.value.trim();
          if (!comment) { showToast('Beskriv vad som gjordes'); return; }
          TimeService.clockOut({
            priceGroupId: document.getElementById('co-pg')?.value || '',
            comment,
            billable: document.getElementById('co-billable')?.checked !== false
          });
          Modal.close();
          showToast('Utloggad');
          this.render({ aoId: this.aoId });
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _updateChecklistCounter(ao) {
    const el = document.getElementById('ao-chk-counter');
    if (!el) return;
    const items  = ao.checklist || [];
    const total  = items.length;
    const okCnt  = items.filter(c => c.done || c.avvikelse === 'ok').length;
    const avvCnt = items.filter(c => c.avvikelse === 'avvikelse').length;
    if (!total) { el.innerHTML = ''; return; }
    el.innerHTML = `<span class="bdg bdg-${okCnt===total&&!avvCnt?'green':avvCnt>0?'orange':'blue'}">${okCnt}/${total} OK${avvCnt>0?' · '+avvCnt+' avv.':''}</span>`;
  },

  /* ── Checklista ────────────────────────── */
  openAddChecklist() {
    if (!Auth.require('ao_checklist')) return;
    Modal.open({
      title: 'Lägg till checkpunkt',
      body: `
        <div class="fg"><label>Rubrik <span style="color:var(--rd)">*</span></label>
          <input id="cl-text" placeholder="T.ex. Inspektera takbrunn…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('cl-desc')?.focus();}"></div>
        <div class="fg"><label>Beskrivning (valfritt)</label>
          <textarea id="cl-desc" rows="2" placeholder="Mer information om vad som ska kontrolleras…"></textarea></div>`,
      buttons: [
        { label: 'Lägg till', cls: 'btn bp', onClick: () => this.saveChecklist() },
        { label: 'Avbryt',   cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('cl-text')?.focus(), 80);
  },

  saveChecklist() {
    const text = document.getElementById('cl-text')?.value.trim();
    if (!text) { showToast('Rubrik krävs'); return; }
    const desc = document.getElementById('cl-desc')?.value.trim() || '';
    const ao = getAO(this.aoId);
    if (!ao) return;
    if (!ao.checklist) ao.checklist = [];
    ao.checklist.push({ id: 'c' + Date.now(), text, description: desc, avvikelse: null, done: false });
    WorkOrderService.update(this.aoId, { checklist: ao.checklist });
    Modal.close();
    const aoUp = getAO(this.aoId);
    if (aoUp) {
      document.getElementById('ao-checklist').innerHTML = this._renderChecklist(aoUp);
      this._updateChecklistCounter(aoUp);
      this._openSectionOf('ao-checklist');
    }
    showToast('Checkpunkt tillagd');
  },

  setAvvikelse(idx, status) {
    const ao = getAO(this.aoId);
    if (!ao || !ao.checklist || !ao.checklist[idx]) return;
    const c = ao.checklist[idx];
    if (status === 'avvikelse' && c.avvikelse !== 'avvikelse') {
      this._openAvvikelseModal(idx);
      return;
    }
    // Toggle: clicking same status clears it
    const newStatus = c.avvikelse === status ? null : status;
    c.avvikelse = newStatus;
    c.done = (newStatus === 'ok');
    if (newStatus !== 'avvikelse') { c.avvikelseComment = ''; c.avvikelseAt = ''; c.avvikelseBy = ''; }
    WorkOrderService.update(this.aoId, { checklist: ao.checklist });
    const aoUp = getAO(this.aoId);
    if (aoUp) {
      document.getElementById('ao-checklist').innerHTML = this._renderChecklist(aoUp);
      this._updateChecklistCounter(aoUp);
    }
  },

  _openAvvikelseModal(idx) {
    const ao = getAO(this.aoId);
    if (!ao || !ao.checklist || !ao.checklist[idx]) return;
    const c = ao.checklist[idx];
    Modal.open({
      title: `${ic('alert-triangle',14)} Markera avvikelse`,
      body: `
        <div class="nbox" style="margin-bottom:12px;">${ic('clipboard-check',13)} ${c.text}</div>
        <div class="fg">
          <label>Kommentar <span style="color:var(--rd)">*</span></label>
          <textarea id="avv-comment" rows="3" placeholder="Beskriv avvikelsen – vad som är skadat, var och hur…">${c.avvikelseComment||''}</textarea>
        </div>
        <div class="fg">
          <label>Bild (valfri)</label>
          <input type="file" id="avv-img" accept="image/*" onchange="WorkOrderDetailPage._previewAvvImg(this)">
          <div id="avv-img-preview" style="margin-top:6px;">
            ${c.avvikelseImage ? `<img src="${c.avvikelseImage}" style="max-width:100%;border-radius:8px;max-height:120px;object-fit:cover;">` : ''}
          </div>
        </div>`,
      buttons: [
        { label: 'Spara avvikelse', cls: 'btn bd', onClick: () => {
          const comment = document.getElementById('avv-comment')?.value.trim();
          if (!comment) { showToast('Kommentar krävs vid avvikelse'); return; }
          const imgInput = document.getElementById('avv-img');
          const file = imgInput && imgInput.files && imgInput.files[0];
          const saveAvv = (imageData) => {
            const aoF = getAO(this.aoId);
            if (!aoF || !aoF.checklist || !aoF.checklist[idx]) return;
            aoF.checklist[idx].avvikelse        = 'avvikelse';
            aoF.checklist[idx].done             = false;
            aoF.checklist[idx].avvikelseComment = comment;
            aoF.checklist[idx].avvikelseAt      = new Date().toISOString();
            aoF.checklist[idx].avvikelseBy      = state.currentUser
              ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '';
            if (imageData) aoF.checklist[idx].avvikelseImage = imageData;
            WorkOrderService.update(this.aoId, { checklist: aoF.checklist });
            Modal.close();
            const aoUp = getAO(this.aoId);
            if (aoUp) {
              document.getElementById('ao-checklist').innerHTML = this._renderChecklist(aoUp);
              this._updateChecklistCounter(aoUp);
            }
            showToast('Avvikelse sparad');
          };
          if (file) {
            const reader = new FileReader();
            reader.onload = (e) => saveAvv(e.target.result);
            reader.readAsDataURL(file);
          } else {
            saveAvv(null);
          }
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('avv-comment')?.focus(), 80);
  },

  _previewAvvImg(input) {
    const file = input.files && input.files[0];
    const prev = document.getElementById('avv-img-preview');
    if (!file || !prev) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      prev.innerHTML = `<img src="${e.target.result}" style="max-width:100%;border-radius:8px;max-height:120px;object-fit:cover;">`;
    };
    reader.readAsDataURL(file);
  },

  toggleCheck(idx) {
    WorkOrderService.toggleChecklist(this.aoId, idx);
    const ao = getAO(this.aoId);
    if (ao) {
      document.getElementById('ao-checklist').innerHTML = this._renderChecklist(ao);
      this._updateChecklistCounter(ao);
    }
  },

  removeCheck(idx) {
    WorkOrderService.removeChecklist(this.aoId, idx);
    const ao = getAO(this.aoId);
    if (ao) {
      document.getElementById('ao-checklist').innerHTML = this._renderChecklist(ao);
      this._updateChecklistCounter(ao);
    }
  },

  /* ── Tid ───────────────────────────────── */
  openAddTime() {
    if (!Auth.require('ao_time')) return;
    const ao = getAO(this.aoId);
    const aoPgId = ao ? (ao.priceGroupId || '') : '';
    const pgOptions = (state.priceGroups||[]).filter(p=>p.active).map(p =>
      `<option value="${p.id}" ${p.id===aoPgId?'selected':''}>${p.name} – ${fmt(p.hourRate)} kr/tim ex moms</option>`
    ).join('');
    Modal.open({
      title: 'Registrera tid',
      body: `
        ${(state.currentUser && ['admin','chef'].includes(state.currentUser.role)) ? `
        <div class="fg"><label>Utförd av <span style="color:var(--sky);font-size:9px;">Admin</span></label>
          <select id="t-staff">
            <option value="">— Inloggad användare (${state.currentUser ? state.currentUser.firstName : ''}) —</option>
            ${(state.staff||[]).filter(s=>s.active).map(s=>
              `<option value="${s.id}:${s.firstName} ${s.lastName}">${s.firstName} ${s.lastName}${s.title?' – '+s.title:''}</option>`
            ).join('')}
          </select>
        </div>` : ''}
        <div class="g2">
          <div class="fg"><label>Datum</label><input type="date" id="t-date" value="${tdy()}"></div>
          <div class="fg"><label>Prisgrupp</label>
            <select id="t-pg"><option value="">— Ingen —</option>${pgOptions}</select></div>
        </div>
        <div class="g2">
          <div class="fg"><label>Starttid</label><input type="time" id="t-start" value="08:00"></div>
          <div class="fg"><label>Sluttid</label><input type="time" id="t-end" value="16:00"></div>
        </div>
        <div class="fg"><label>Kommentar</label><textarea id="t-comment" rows="2" placeholder="Vad utfördes?"></textarea></div>
        <div class="fg"><label><input type="checkbox" id="t-billable" checked style="width:16px;height:16px;margin-right:6px;">Debiterbar tid</label></div>`,
      buttons: [
        { label: 'Spara tid', cls: 'btn bp', onClick: () => this._saveTimeEntry(null) },
        { label: 'Avbryt',    cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openEditTime(entryId) {
    const t = (state.timeEntries||[]).find(x=>x.id===entryId);
    if (!t) return;
    const pgOptions = (state.priceGroups||[]).filter(p=>p.active).map(p =>
      `<option value="${p.id}" ${t.priceGroupId===p.id?'selected':''}>${p.name} – ${fmt(p.hourRate)} kr/tim ex moms</option>`
    ).join('');
    Modal.open({
      title: 'Redigera tid',
      body: `
        <div class="g2">
          <div class="fg"><label>Datum</label><input type="date" id="t-date" value="${t.date}"></div>
          <div class="fg"><label>Prisgrupp</label>
            <select id="t-pg"><option value="">— Ingen —</option>${pgOptions}</select></div>
        </div>
        <div class="g2">
          <div class="fg"><label>Starttid</label><input type="time" id="t-start" value="${t.startStr}"></div>
          <div class="fg"><label>Sluttid</label><input type="time" id="t-end" value="${t.endStr}"></div>
        </div>
        <div class="fg"><label>Kommentar</label><textarea id="t-comment" rows="2">${t.comment||''}</textarea></div>
        <div class="fg"><label><input type="checkbox" id="t-billable" ${t.billable?'checked':''} style="width:16px;height:16px;margin-right:6px;">Debiterbar tid</label></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._saveTimeEntry(entryId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveTimeEntry(existingId) {
    const date  = document.getElementById('t-date')?.value;
    const start = document.getElementById('t-start')?.value;
    const end   = document.getElementById('t-end')?.value;
    if (!date || !start || !end) { showToast('Datum och tider krävs'); return; }
    const [sh,sm] = start.split(':').map(Number);
    const [eh,em] = end.split(':').map(Number);
    if ((eh*60+em) <= (sh*60+sm)) { showToast('Sluttid måste vara efter starttid'); return; }
    const data = {
      date,
      startStr:    start,
      endStr:      end,
      priceGroupId:document.getElementById('t-pg')?.value || '',
      comment:     document.getElementById('t-comment')?.value.trim() || '',
      billable:    document.getElementById('t-billable')?.checked !== false
    };
    const staffSel = document.getElementById('t-staff')?.value || '';
    const [overrideStaffId, overrideStaffName] = staffSel ? staffSel.split(':') : ['', ''];
    if (existingId) {
      if (overrideStaffId) { data.staffId = overrideStaffId; data.staffName = overrideStaffName; }
      TimeService.update(existingId, data);
      showToast('Tid uppdaterad');
    } else {
      const result = TimeService.saveManual({ ...data, aoId: this.aoId, staffId: overrideStaffId || undefined, staffName: overrideStaffName || undefined });
      if (!result.ok) { showToast(result.error); return; }
      showToast('Tid registrerad');
    }
    Modal.close();
    this._refreshTimeSection();
  },

  deleteTime(entryId) {
    Modal.confirm('Ta bort tidspost?', () => {
      TimeService.delete(entryId);
      this._refreshTimeSection();
      showToast('Tidspost borttagen');
    });
  },

  /* ── Hantera personal ──────────────────── */
  manageStaff(aoId) {
    if (!Auth.require('ao_edit')) return;
    const ao = getAO(aoId);
    if (!ao) return;

    const activeStaff = (state.staff || []).filter(s => s.active);
    const current = ao.staff || [];
    const currentResp = ao.responsibleStaffId || '';
    const isPool = ao.status === 'pool';

    const staffRows = activeStaff.map(s => {
      const role = (state.roles||[]).find(r => r.id === s.role);
      return `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;border-bottom:1px solid var(--br);">
        <input type="checkbox" id="smcb-${esc(s.id)}" ${current.includes(s.id)?'checked':''}>
        <div style="flex:1;">
          <span style="font-size:13px;font-weight:600;">${esc(s.firstName)} ${esc(s.lastName)}</span>
          <span style="font-size:11px;color:var(--mt);margin-left:4px;">${role?esc(role.label):esc(s.role||'')}</span>
        </div>
      </label>`;
    }).join('');

    const respOpts = `<option value="">Ingen ansvarig</option>` +
      activeStaff.map(s =>
        `<option value="${esc(s.id)}" ${s.id===currentResp?'selected':''}>${esc(s.firstName)} ${esc(s.lastName)}</option>`
      ).join('');

    const body = `
      <div style="margin-bottom:14px;">
        <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Tilldelad personal</div>
        ${staffRows}
      </div>
      <div class="fg" style="margin-bottom:14px;">
        <label>Ansvarig</label>
        <select id="sm-resp">${respOpts}</select>
      </div>
      <div style="border-top:1px solid var(--br);padding-top:10px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="sm-pool" ${isPool?'checked':''}>
          <div>
            <div style="font-size:13px;font-weight:600;">Flytta till arbetspool</div>
            <div style="font-size:11px;color:var(--mt);">Rensar personal och sätter status till Pool</div>
          </div>
        </label>
      </div>`;

    Modal.open({
      title: `${ic('users',15)} Hantera personal — ${esc(ao.id)}`,
      body,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => WorkOrderDetailPage._saveStaff(aoId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveStaff(aoId) {
    const ao = getAO(aoId);
    if (!ao) return;

    const activeStaff = (state.staff || []).filter(s => s.active);
    const selectedIds = activeStaff
      .filter(s => { const cb = document.getElementById(`smcb-${s.id}`); return cb && cb.checked; })
      .map(s => s.id);
    const responsibleId = (document.getElementById('sm-resp') || {}).value || '';
    const moveToPool = !!(document.getElementById('sm-pool') || {}).checked;

    // If responsible not in selected staff, add them
    if (responsibleId && !selectedIds.includes(responsibleId)) {
      selectedIds.push(responsibleId);
    }

    const prevStaff = (ao.staff || []).slice();
    WorkOrderService.updateStaff(aoId, { staffIds: selectedIds, responsibleStaffId: responsibleId, moveToPool });
    // Log assignment changes
    const added = selectedIds.filter(id => !prevStaff.includes(id));
    if (added.length > 0) {
      const names = added.map(id => { const s = getStaff(id); return s ? s.firstName + ' ' + s.lastName : id; }).join(', ');
      ActivityService.log('staff_assigned', `Personal tilldelad ${aoId}: ${names}`, { workOrderId: aoId });
      // Send notifications to newly added staff
      if (typeof NotificationsService !== 'undefined') {
        added.forEach(id => {
          NotificationsService.push(id, 'ao_assigned', `Du har tilldelats ${aoId}: ${ao.title || aoId}`, { aoId });
        });
      }
    }
    Modal.close();
    WorkOrderDetailPage.render({ aoId });
    showToast('Personal uppdaterad');
    Sidebar.updateBadges();
  },

  /* ── Redigera AO ───────────────────────── */
  openEdit() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    const cuOptions = (state.customers||[]).map(c =>
      `<option value="${c.id}" ${ao.customerId===c.id?'selected':''}>${CustomerService.displayName(c)}</option>`
    ).join('');
    Modal.open({
      title: 'Redigera order',
      wide: true,
      body: `
        <div class="fg"><label>Rubrik</label><input id="edit-title" value="${ao.title}"></div>
        <div class="fg"><label>Beskrivning</label><textarea id="edit-desc" rows="2">${ao.description||''}</textarea></div>
        <div class="fg"><label>Kund</label>
          <select id="edit-cu" onchange="WorkOrderDetailPage._editCustomerChanged('${this.aoId}')">
            ${cuOptions}
          </select></div>
        <div class="fg"><label>Adress</label><input id="edit-addr" value="${ao.address||''}"
          autocomplete="off"
          data-addr-source="${ao.address ? 'existing' : ''}"
          oninput="AddressService.handleInput(this)"
          onblur="setTimeout(()=>AddressService.hideSuggestions(),150)"></div>
        <div class="g2">
          <div class="fg"><label>Datum</label><input type="date" id="edit-date" value="${ao.scheduledDate||''}"></div>
          <div class="fg"><label>Prioritet</label>
            <select id="edit-prio">
              ${['akut','hög','normal','låg'].map(p=>`<option value="${p}" ${ao.priority===p?'selected':''}>${{akut:'Akut',hög:'Hög',normal:'Normal',låg:'Låg'}[p]}</option>`).join('')}
            </select></div>
        </div>
        <div class="fg"><label>Kategori</label>
          <select id="edit-category">
            <option value="">— Ingen kategori —</option>
            ${AO_CATEGORIES.map(c=>`<option value="${c.slug}" ${ao.category===c.slug?'selected':''}>${c.label}</option>`).join('')}
          </select></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const title = document.getElementById('edit-title')?.value.trim();
          if (!title) { showToast('Rubrik krävs'); return; }
          WorkOrderService.update(this.aoId, {
            title,
            description:   document.getElementById('edit-desc')?.value.trim() || '',
            customerId:    document.getElementById('edit-cu')?.value || '',
            address:       document.getElementById('edit-addr')?.value.trim() || '',
            scheduledDate: document.getElementById('edit-date')?.value || '',
            priority:      document.getElementById('edit-prio')?.value || 'normal',
            category:      document.getElementById('edit-category')?.value || ''
          });
          Modal.close();
          this.render({ aoId: this.aoId });
          showToast('Order uppdaterad');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /*
   * Autofyll adress från ny kund i redigera-AO-modal.
   * Fyller adressen om: fältet är tomt, ELLER adressen matchar gamla AO-adressen
   * (dvs. användaren har inte skrivit något manuellt).
   */
  _editCustomerChanged(aoId) {
    const ao = getAO(aoId);
    if (!ao) return;
    const sel    = document.getElementById('edit-cu');
    const addrEl = document.getElementById('edit-addr');
    if (!sel || !addrEl) return;

    const newCu      = sel.value ? getCu(sel.value) : null;
    const currentVal = addrEl.value.trim();
    const origAddr   = ao.address || '';
    const src        = addrEl.dataset.addrSource || '';

    /* Fyll adress om: tomt, oförändrat från AO, eller tidigare kundadress */
    if (!currentVal || currentVal === origAddr || src === 'customer') {
      addrEl.value = newCu ? (newCu.address || '') : '';
      addrEl.dataset.addrSource = newCu && newCu.address ? 'customer' : '';
    }
  },

  /* ── Gör återkommande ─────────────────── */
  makeRecurring() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    Router.showPage('pg-recurring');
    setTimeout(() => RecurringPage.openFromAO(this.aoId), 150);
  },

  /* ── Skapa fakturaunderlag ─────────────── */
  createInvoice() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    const result = InvoiceService.createFromAO(this.aoId);
    if (!result.ok) { showToast(result.error); return; }
    showToast(`${result.invoice.id} skapat`);
    Router.showPage('pg-inv-detail', { invoiceId: result.invoice.id });
  }
};
