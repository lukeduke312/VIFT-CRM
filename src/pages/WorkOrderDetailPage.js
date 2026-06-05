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
    this._renderFull(el, ao);
    if (state.stampActive && state.stampAoId === ao.id) this._startStampTimer();
  },

  _renderFull(el, ao) {
    const cu     = getCu(ao.customerId);
    const cuName = cu ? CustomerService.displayName(cu) : '—';
    const staff  = (ao.staff||[]).map(id => { const s = getStaff(id); return s ? `${s.firstName} ${s.lastName}` : id; });
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

    el.innerHTML = `
      ${ao.deleted ? `<div class="nbox" style="background:#fee2e2;border-left-color:var(--rd);margin-bottom:8px;">${ic('trash',13)} Denna arbetsorder finns i papperskorgen och raderas automatiskt ${ao.deleteAfter?fmtDate(ao.deleteAfter):'om 14 dagar'}.</div>` : ''}
      ${ao.archived && !ao.deleted ? `<div class="nbox" style="background:#f1f5f9;border-left-color:var(--mt);margin-bottom:8px;">${ic('archive',13)} Denna arbetsorder är arkiverad och syns inte i ordinarie lista.</div>` : ''}

      <!-- Status/Action panel -->
      <div class="ao-action-panel">
        <div class="ao-action-panel-left">
          <button class="btn bs bsm" onclick="Router.back()" title="Tillbaka">${ic('arrow-left',14)}</button>
          <span style="font-size:11px;font-weight:700;color:var(--mt);">${ao.id}</span>
        </div>
        <div class="ao-action-panel-badges">
          ${sbdg(ao.status)} ${pbdg(ao.priority)}
        </div>
        <div class="ao-action-panel-btns">
          ${this._actionBtns(ao)}
          ${Auth.can('ao_edit') ? `<button class="btn bs bxs" onclick="WorkOrderDetailPage.openEdit()">${ic('pencil',13)} Redigera</button>` : ''}
        </div>
      </div>

      <!-- Rubrik -->
      <div class="card">
        <div class="card-header">
          <h3 style="font-size:14px;font-weight:800;color:var(--navy);line-height:1.3;">${ao.title}</h3>
        </div>
        <div class="card-body">
          ${ao.description ? `<p style="font-size:13px;color:var(--mt);line-height:1.5;margin-bottom:10px;">${ao.description}</p>` : ''}
          <div class="dr"><span class="dk">Kund</span><span class="dv" style="cursor:pointer;color:var(--sky);" onclick="Router.showPage('pg-crm-detail',{customerId:'${cu&&cu.id}'})">${cuName}</span></div>
          <div class="dr"><span class="dk">Adress</span><span class="dv">${ao.address||'—'}</span></div>
          <div class="dr"><span class="dk">Kontakt</span><span class="dv">${ao.contactPerson||'—'}${ao.phone?' · '+ao.phone:''}</span></div>
          ${ao.accessCode ? `<div class="dr"><span class="dk">Portkod</span><span class="dv">${ao.accessCode}</span></div>` : ''}
          <div class="dr"><span class="dk">Datum</span><span class="dv">${ao.scheduledDate||'Ej planerad'}${ao.scheduledStart?' '+ao.scheduledStart+' – '+ao.scheduledEnd:''}</span></div>
          <div class="dr"><span class="dk">Personal</span><span class="dv">${staff.length?staff.join(', '):'Ej tilldelad'}</span></div>
          <div class="dr"><span class="dk">Pris</span><span class="dv">${this._priceLabel(ao)}</span></div>
          ${ao.internalNote ? `<div style="margin-top:8px;" class="nbox">${ic('eye',13)} ${ao.internalNote}</div>` : ''}
        </div>
      </div>

      <!-- Stämpling -->
      ${this._stampSection(ao, isStampedOnThis)}

      <!-- Checklista -->
      <div class="card">
        <div class="card-header">
          <h3>${ic('clipboard-check',14)} Checklista</h3>
          <div style="display:flex;align-items:center;gap:6px;">
            <span id="ao-chk-counter">${chkBadge}</span>
            ${Auth.can('ao_checklist') ? `<button class="btn bs bxs" onclick="WorkOrderDetailPage.openAddChecklist()">${ic('plus',13)}</button>` : ''}
          </div>
        </div>
        <div class="card-body" style="padding:6px 14px;" id="ao-checklist">
          ${this._renderChecklist(ao)}
        </div>
      </div>

      <!-- Material & kostnader -->
      <div class="card">
        <div class="card-header">
          <h3>${ic('package',14)} Material & kostnader</h3>
          ${Auth.can('ao_material') ? `<button class="btn bs bxs" onclick="WorkOrderDetailPage.openAddMaterial()">${ic('plus',13)}</button>` : ''}
        </div>
        <div id="ao-materials" style="overflow:hidden;">
          ${this._renderMaterials(ao)}
        </div>
        ${(ao.materials||[]).length > 0 ? this._matTotals(ao) : ''}
      </div>

      <!-- Tidsposter -->
      <div class="card">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
            <h3 style="margin:0;">${ic('clock',14)} Arbetstid</h3>
            ${totalMins > 0 ? `<span class="bdg bdg-sky">${TimeService.fmtDuration(totalMins)}</span>` : ''}
          </div>
          ${Auth.can('ao_time') ? `<button class="btn bs bxs" onclick="WorkOrderDetailPage.openAddTime()">${ic('plus',13)}</button>` : ''}
        </div>
        <div id="ao-timeentries" style="overflow:hidden;">
          ${this._renderTimeEntries(ao)}
        </div>
      </div>

      <!-- Tidslinje/logg -->
      <div class="card">
        <div class="card-header">
          <h3>${ic('activity',14)} Tidslinje & logg</h3>
          <div style="display:flex;gap:5px;">
            <button class="btn bxs bsu" style="font-size:11px;padding:4px 10px;" onclick="WorkOrderDetailPage.openFollowUp()">${ic('bell',12)} Uppföljning</button>
            <button class="btn bs bxs" onclick="WorkOrderDetailPage.openAddLog()">${ic('plus',13)}</button>
          </div>
        </div>
        <div id="ao-timeline" style="overflow:hidden;">
          ${this._renderTimeline(ao)}
        </div>
      </div>

      <!-- Fakturaunderlag-knapp -->
      ${ao.status === 'klar' && !ao.invoiceId ? `
        <button class="btn bsu bfull" style="padding:14px;" onclick="WorkOrderDetailPage.createInvoice()">
          ${ic('file-plus',16)} Skapa fakturaunderlag
        </button>` : ''}
      ${ao.invoiceId ? `
        <div class="ibox" style="cursor:pointer;" onclick="Router.showPage('pg-inv-detail',{invoiceId:'${ao.invoiceId}'})">
          ${ic('receipt',14)} Fakturaunderlag: ${ao.invoiceId} – klicka för att öppna
        </div>` : ''}

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

  _actionBtns(ao) {
    const canEdit     = Auth.can('ao_edit');
    const canComplete = Auth.can('ao_complete');
    const canInvoice  = Auth.can('invoice_create');
    const btns = [];
    if (canEdit && ao.status === 'nytt') {
      btns.push(`<button class="btn bsu bsm" onclick="WorkOrderDetailPage.setStatus('pågående')">${ic('play-circle',13)} Starta arbete</button>`);
      btns.push(`<button class="btn bp bsm" onclick="WorkOrderDetailPage.setStatus('planerad')">${ic('calendar',13)} Planera</button>`);
      btns.push(`<button class="btn bs bsm" onclick="WorkOrderDetailPage.setStatus('pool')">${ic('inbox',13)} Till pool</button>`);
    }
    if (canEdit && ao.status === 'pool') {
      btns.push(`<button class="btn bsu bsm" onclick="WorkOrderDetailPage.setStatus('pågående')">${ic('play-circle',13)} Starta arbete</button>`);
      btns.push(`<button class="btn bp bsm" onclick="WorkOrderDetailPage.setStatus('planerad')">${ic('calendar',13)} Planera</button>`);
    }
    if (canEdit && ao.status === 'planerad') {
      btns.push(`<button class="btn bsu bsm" onclick="WorkOrderDetailPage.setStatus('pågående')">${ic('play-circle',13)} Starta arbete</button>`);
      btns.push(`<button class="btn bs bsm" onclick="WorkOrderDetailPage.openReschedule()">${ic('calendar',13)} Omplanera</button>`);
    }
    if (ao.status === 'pågående') {
      if (canComplete) btns.push(`<button class="btn bsu bsm" onclick="WorkOrderDetailPage.markComplete()">${ic('check-circle',13)} Klarmarkera</button>`);
      if (canEdit) btns.push(`<button class="btn bw bsm" onclick="WorkOrderDetailPage.setStatus('planerad')">${ic('pause-circle',13)} Pausa</button>`);
    }
    if (ao.status === 'klar' && !ao.invoiceId && canInvoice) {
      btns.push(`<button class="btn bsu bsm" onclick="InvoicesPage.createFromAO('${ao.id}')">${ic('receipt',13)} Skapa fakturaunderlag</button>`);
    }
    if (ao.status === 'klar' && ao.invoiceId) {
      btns.push(`<button class="btn bs bsm" onclick="Router.showPage('pg-inv-detail',{invoiceId:'${ao.invoiceId}'})">${ic('file-text',13)} Visa fakturaunderlag</button>`);
    }
    if (canEdit && ao.status === 'avbruten' && !ao.archived && !ao.deleted) {
      btns.push(`<button class="btn bsu bsm" onclick="WorkOrderDetailPage.openReactivateModal()">${ic('rotate-ccw',13)} Återaktivera</button>`);
    }
    if (canEdit && !['klar','fakturerad','avbruten'].includes(ao.status) && !ao.archived && !ao.deleted) {
      btns.push(`<button class="btn bghost bsm" onclick="WorkOrderDetailPage.openStatusModal()" title="Fler statusval">${ic('more-horizontal',13)}</button>`);
    }
    // Archive / trash actions
    if (canEdit && !ao.archived && !ao.deleted) {
      btns.push(`<button class="btn bghost bsm" onclick="WorkOrderDetailPage.openArchiveModal()" title="Arkivera">${ic('archive',13)}</button>`);
      btns.push(`<button class="btn bghost bsm" onclick="WorkOrderDetailPage.openDeleteModal()" title="Ta bort">${ic('trash',13)}</button>`);
    }
    if (ao.archived && !ao.deleted) {
      btns.push(`<button class="btn bsu bsm" onclick="WorkOrderDetailPage._restoreFromArchive('${ao.id}')">${ic('rotate-ccw',13)} Återställ från arkiv</button>`);
    }
    if (ao.deleted) {
      btns.push(`<button class="btn bs bsm" onclick="WorkOrderDetailPage._restoreFromTrash('${ao.id}')">${ic('rotate-ccw',13)} Återställ</button>`);
      btns.push(`<button class="btn bd bsm" onclick="WorkOrderDetailPage._confirmPermanentDelete('${ao.id}')">${ic('trash-2',13)} Radera permanent</button>`);
    }
    return btns.join('');
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

  _priceLabel(ao) {
    if (ao.priceType === 'fastpris')  return `Fastpris: ${fmt(ao.fixedPrice)} kr ex moms`;
    if (ao.priceType === 'timpris')   return 'Timpris';
    if (ao.priceType === 'prisgrupp') {
      const pg = (state.priceGroups||[]).find(p => p.id === ao.priceGroupId);
      return pg ? `${pg.name} – ${fmt(pg.hourRate)} kr/tim ex moms` : 'Prisgrupp';
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
        return `
        <div style="border-bottom:1px solid var(--bg);padding:10px 0;">
          <div style="display:flex;align-items:flex-start;gap:8px;">
            <div style="flex-shrink:0;margin-top:2px;width:18px;height:18px;border-radius:50%;
              background:${isOk?'var(--grn)':isAvv?'var(--rd)':'var(--br)'};
              display:flex;align-items:center;justify-content:center;color:#fff;">
              ${isOk?ic('check',11):isAvv?ic('alert-triangle',10):''}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:700;${isOk?'text-decoration:line-through;color:var(--mt);':''}">${c.text}</div>
              ${c.description ? `<div style="font-size:11px;color:var(--mt);margin-top:2px;line-height:1.4;">${c.description}</div>` : ''}
              ${isAvv && (c.avvikelseComment || c.avvikelseImage) ? `<div style="margin-top:6px;background:#fff1f2;border-left:3px solid var(--rd);padding:6px 10px;border-radius:0 6px 6px 0;">
                <div style="font-size:10px;font-weight:700;color:var(--rd);text-transform:uppercase;letter-spacing:.3px;margin-bottom:2px;">Avvikelse</div>
                ${c.avvikelseComment?`<div style="font-size:12px;color:#374151;line-height:1.5;">${c.avvikelseComment}</div>`:''}
                ${c.avvikelseImage?`<img src="${c.avvikelseImage}" style="margin-top:4px;max-width:100%;border-radius:6px;max-height:100px;object-fit:cover;">`:''}
                ${c.avvikelseBy||c.avvikelseAt?`<div style="font-size:10px;color:var(--mt);margin-top:3px;">${c.avvikelseBy||''}${c.avvikelseAt?' · '+relDate(c.avvikelseAt):''}</div>`:''}
              </div>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:5px;margin-top:7px;margin-left:26px;">
            <button class="btn bxs ${isOk?'bsu':'bs'}" onclick="WorkOrderDetailPage.setAvvikelse(${i},'ok')"
              style="font-size:10px;padding:3px 8px;display:flex;align-items:center;gap:3px;">
              ${ic('check',10)} ${isOk ? 'OK ✓' : 'Markera OK'}
            </button>
            <button class="btn bxs ${isAvv?'bd':'bs'}" onclick="WorkOrderDetailPage.setAvvikelse(${i},'avvikelse')"
              style="font-size:10px;padding:3px 8px;display:flex;align-items:center;gap:3px;">
              ${ic('alert-triangle',10)} ${isAvv ? 'Avvikelse ✓' : 'Markera avvikelse'}
            </button>
            <button class="btn bxs bd" onclick="WorkOrderDetailPage.removeCheck(${i})"
              style="font-size:10px;padding:3px 8px;" title="Ta bort punkt">
              ${ic('trash',10)}
            </button>
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
    if (!mats.length) return `<p style="padding:12px 14px;color:var(--mt);font-size:13px;">Inget material registrerat</p>`;
    return mats.map(m => {
      const qty  = m.qty || 0;
      const sell = m.sellPrice || 0;
      const buy  = m.buyPrice || 0;
      const vat  = m.vatRate != null ? m.vatRate : 25;
      const exMoms  = qty * sell;
      const momsAmt = exMoms * vat / 100;
      const inklMoms = exMoms + momsAmt;
      return `
        <div style="padding:10px 14px;border-bottom:1px solid var(--bg);">
          <div style="display:flex;align-items:flex-start;gap:8px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:700;margin-bottom:3px;">${m.name}</div>
              <div style="font-size:11px;color:var(--mt);">${qty} ${m.unit} × ${fmt(sell)} kr ex moms</div>
              <div style="display:flex;gap:10px;margin-top:4px;font-size:11px;">
                <span style="color:var(--mt);">Ex: <strong style="color:var(--tx)">${fmt(exMoms)} kr</strong></span>
                <span style="color:var(--mt);">Moms: ${fmt(momsAmt)} kr</span>
                <span style="color:var(--navy);font-weight:700;">Inkl: ${fmt(inklMoms)} kr</span>
              </div>
              ${buy > 0 ? `<div id="mat-int-${m.id}" style="display:none;margin-top:5px;font-size:10px;color:var(--mt);font-style:italic;padding:4px 8px;background:var(--bg);border-radius:6px;">
                Ink-pris: ${fmt(buy)} kr/st · Marginal: ${fmt(Math.max(0,sell-buy))} kr/st
              </div>
              <button type="button" onclick="(function(){var e=document.getElementById('mat-int-${m.id}');e.style.display=e.style.display==='none'?'':'none';})()"
                style="font-size:10px;color:var(--mt);background:none;border:none;padding:2px 0;margin-top:2px;cursor:pointer;display:flex;align-items:center;gap:3px;">
                ${ic('eye',9)} Intern kalkyl
              </button>` : ''}
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0;margin-top:2px;">
              <button class="btn bxs bs" onclick="WorkOrderDetailPage.openEditMaterial('${m.id}')">${ic('pencil',12)}</button>
              <button class="btn bxs bd" onclick="WorkOrderDetailPage.deleteMaterial('${m.id}')">${ic('trash',12)}</button>
            </div>
          </div>
        </div>`;
    }).join('');
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
  _renderTimeline(ao) {
    const events = [];

    // Notes
    (ao.notes||[]).forEach(n => {
      events.push({ type:'note', ts: n.timestamp||'', who: n.staffName||'', text: n.text||'', id: n.id });
    });

    // Log entries (manual log)
    (ao.log||[]).forEach(l => {
      events.push({ type: l.type||'log', ts: l.timestamp||'', who: l.userName||'', text: l.text||'', imageData: l.imageData||'', followUpDate: l.followUpDate||'', id: l.id });
    });

    // Time entries
    TimeService.getByAO(ao.id).forEach(t => {
      events.push({ type:'time', ts: t.createdAt||t.date||'', who: t.staffName||'', text: `${TimeService.fmtDuration(t.minutes)} registrerad${t.comment?' – '+t.comment:''}` });
    });

    // Material additions
    (ao.materials||[]).forEach(m => {
      if (m.addedAt) {
        events.push({ type:'material', ts: m.addedAt, who: '', text: `${m.qty} ${m.unit} ${m.name} tillagd` });
      }
    });

    // Status changes from activity log
    ActivityService.getByWorkOrder(ao.id, 50).forEach(a => {
      if (a.type === 'status_change' || a.type === 'work_order_status' || a.type === 'created') {
        events.push({ type: a.type, ts: a.timestamp||'', who: '', text: a.description||'' });
      }
    });

    if (!events.length) {
      return `<p style="padding:12px 14px;color:var(--mt);font-size:13px;">Ingen logg ännu</p>`;
    }

    // Sort descending (newest first)
    events.sort((a,b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));

    const typeIcon  = { note:'file-text', log:'activity', time:'clock', material:'package', status_change:'refresh-cw', work_order_status:'refresh-cw', created:'plus', uppföljning:'bell' };
    const typeColor = { note:'var(--navy)', log:'var(--sky)', time:'var(--grn)', material:'var(--orn)', status_change:'var(--mt)', work_order_status:'var(--mt)', created:'var(--sky)', uppföljning:'#7c3aed' };

    return `<div style="padding:8px 14px 4px;">` + events.map(ev => {
      const col  = typeColor[ev.type] || 'var(--mt)';
      const ico  = typeIcon[ev.type]  || 'activity';
      return `
        <div style="display:flex;gap:10px;margin-bottom:14px;align-items:flex-start;">
          <div style="width:28px;height:28px;border-radius:50%;background:${col}20;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:${col};">${ic(ico,13)}</div>
          <div style="flex:1;min-width:0;padding-top:4px;">
            ${ev.who ? `<div style="font-size:11px;font-weight:700;color:var(--mt);margin-bottom:2px;">${ev.who}${ev.ts?' · '+relDate(ev.ts):''}</div>` : (ev.ts ? `<div style="font-size:11px;color:var(--mt);margin-bottom:2px;">${relDate(ev.ts)}</div>` : '')}
            <div style="font-size:13px;line-height:1.5;word-break:break-word;">${ev.text}</div>
            ${ev.followUpDate ? `<div style="margin-top:4px;display:inline-flex;align-items:center;gap:4px;background:#f3e8ff;color:#7c3aed;font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;">${ic('calendar',9)} Uppföljning: ${ev.followUpDate}</div>` : ''}
            ${ev.imageData ? `<img src="${ev.imageData}" style="max-width:100%;border-radius:8px;margin-top:6px;max-height:200px;object-fit:cover;" loading="lazy">` : ''}
          </div>
          ${ev.id && (ev.type==='log'||ev.type==='uppföljning') ? `<button class="btn bxs bd" style="flex-shrink:0;" onclick="WorkOrderDetailPage.deleteLogEntry('${ev.id}')">${ic('trash',12)}</button>` : ''}
        </div>`;
    }).join('') + '</div>';
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
        <div class="g2">
          <div class="fg"><label>Datum <span style="color:var(--rd)">*</span></label>
            <input type="date" id="fu-date" value="${defaultDateStr}"></div>
          <div class="fg"><label>Tid (valfritt)</label>
            <input type="time" id="fu-time"></div>
        </div>
        <div class="fg"><label>Kommentar <span style="color:var(--rd)">*</span></label>
          <textarea id="fu-comment" rows="3" placeholder="Vad ska följas upp? Vad är syftet?"></textarea>
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
    const ao = getAO(this.aoId);
    if (ao) {
      document.getElementById('ao-materials').innerHTML = this._renderMaterials(ao);
      const matTotEl = document.getElementById('ao-materials').nextElementSibling;
      if (matTotEl && matTotEl.style !== undefined) matTotEl.outerHTML = this._matTotals(ao);
    }
  },

  deleteMaterial(matId) {
    Modal.confirm('Ta bort material?', () => {
      WorkOrderService.deleteMaterial(this.aoId, matId);
      const ao = getAO(this.aoId);
      if (ao) document.getElementById('ao-materials').innerHTML = this._renderMaterials(ao);
      showToast('Borttaget');
    });
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
    this.render({ aoId: this.aoId });
    Sidebar.updateBadges();
    showToast(`Status: ${statusLabel(status)}`);
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
    const ao = getAO(this.aoId);
    if (ao) document.getElementById('ao-timeentries').innerHTML = this._renderTimeEntries(ao);
  },

  deleteTime(entryId) {
    Modal.confirm('Ta bort tidspost?', () => {
      TimeService.delete(entryId);
      const ao = getAO(this.aoId);
      if (ao) document.getElementById('ao-timeentries').innerHTML = this._renderTimeEntries(ao);
      showToast('Tidspost borttagen');
    });
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
        <div class="fg"><label>Kund</label><select id="edit-cu">${cuOptions}</select></div>
        <div class="fg"><label>Adress</label><input id="edit-addr" value="${ao.address||''}"></div>
        <div class="g2">
          <div class="fg"><label>Datum</label><input type="date" id="edit-date" value="${ao.scheduledDate||''}"></div>
          <div class="fg"><label>Prioritet</label>
            <select id="edit-prio">
              ${['akut','hög','normal','låg'].map(p=>`<option value="${p}" ${ao.priority===p?'selected':''}>${{akut:'Akut',hög:'Hög',normal:'Normal',låg:'Låg'}[p]}</option>`).join('')}
            </select></div>
        </div>`,
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
            priority:      document.getElementById('edit-prio')?.value || 'normal'
          });
          Modal.close();
          this.render({ aoId: this.aoId });
          showToast('Order uppdaterad');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
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
