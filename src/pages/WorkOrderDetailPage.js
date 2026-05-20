/**
 * WorkOrderDetailPage — Fullständig AO-detaljvy
 */
const WorkOrderDetailPage = {
  aoId: null,

  render(params) {
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
  },

  _renderFull(el, ao) {
    const cu     = getCu(ao.customerId);
    const cuName = cu ? CustomerService.displayName(cu) : '—';
    const staff  = (ao.staff||[]).map(id => { const s = getStaff(id); return s ? `${s.firstName} ${s.lastName}` : id; });
    const chkDone = (ao.checklist||[]).filter(c=>c.done).length;
    const chkTotal = (ao.checklist||[]).length;
    const timeEntries = TimeService.getByAO(ao.id);
    const totalMins   = TimeService.totalMinutes(timeEntries);
    const matTotal    = WorkOrderService.materialTotal(ao);
    const isStampedOnThis = state.stampActive && state.stampAoId === ao.id;

    el.innerHTML = `
      <!-- Tillbaka + Åtgärder -->
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
        <button class="btn bs bsm" onclick="Router.showPage('pg-ao')">${ic('arrow-left',14)}</button>
        <div style="flex:1;">
          <div style="display:flex;gap:6px;flex-wrap:wrap;">${sbdg(ao.status)}${pbdg(ao.priority)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${this._actionBtns(ao)}
        </div>
      </div>

      <!-- Rubrik -->
      <div class="card">
        <div class="card-header" style="justify-content:space-between;">
          <h3 style="font-size:13px;font-weight:800;color:var(--navy);">${ao.id}</h3>
          <button class="btn bs bxs" onclick="WorkOrderDetailPage.openEdit()">${ic('pencil',13)} Redigera</button>
        </div>
        <div class="card-body">
          <h2 style="font-size:16px;font-weight:800;margin-bottom:10px;">${ao.title}</h2>
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
          <h3>Checklista</h3>
          <div style="display:flex;align-items:center;gap:8px;">
            ${chkTotal>0 ? `<span class="bdg bdg-blue">${chkDone}/${chkTotal}</span>` : ''}
            <button class="btn bs bxs" onclick="WorkOrderDetailPage.openAddChecklist()">${ic('plus',13)}</button>
          </div>
        </div>
        <div class="card-body" style="padding:6px 14px;" id="ao-checklist">
          ${this._renderChecklist(ao)}
        </div>
      </div>

      <!-- Material -->
      <div class="card">
        <div class="card-header">
          <h3>Material & kostnader</h3>
          <button class="btn bs bxs" onclick="WorkOrderDetailPage.openAddMaterial()">${ic('plus',13)}</button>
        </div>
        <div id="ao-materials" style="overflow:hidden;">
          ${this._renderMaterials(ao)}
        </div>
        ${(ao.materials||[]).length > 0 ? `
          <div style="padding:10px 14px;border-top:1px solid var(--br);display:flex;justify-content:flex-end;">
            <span style="font-size:13px;font-weight:700;">Totalt: ${fmt(matTotal)} kr</span>
          </div>` : ''}
      </div>

      <!-- Tidsposter -->
      <div class="card">
        <div class="card-header">
          <h3>Arbetstid</h3>
          <div style="display:flex;align-items:center;gap:8px;">
            ${totalMins > 0 ? `<span class="bdg bdg-sky">${TimeService.fmtDuration(totalMins)}</span>` : ''}
            <button class="btn bs bxs" onclick="WorkOrderDetailPage.openAddTime()">${ic('plus',13)}</button>
          </div>
        </div>
        <div id="ao-timeentries" style="overflow:hidden;">
          ${this._renderTimeEntries(ao)}
        </div>
      </div>

      <!-- Anteckningar -->
      <div class="card">
        <div class="card-header">
          <h3>Anteckningar</h3>
          <button class="btn bs bxs" onclick="WorkOrderDetailPage.openAddNote()">${ic('plus',13)}</button>
        </div>
        <div id="ao-notes" style="overflow:hidden;">
          ${this._renderNotes(ao)}
        </div>
      </div>

      <!-- Aktivitetslogg -->
      <div class="card">
        <div class="card-header"><h3>Aktivitetslogg</h3></div>
        <div class="card-body" style="padding:8px 10px;">
          ${ActivityService.renderList(ActivityService.getByWorkOrder(ao.id, 10))}
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
    `;
  },

  _actionBtns(ao) {
    const btns = [];
    if (ao.status === 'nytt' || ao.status === 'pool') {
      btns.push(`<button class="btn bp bsm" onclick="WorkOrderDetailPage.setStatus('planerad')">Planera</button>`);
    }
    if (ao.status === 'planerad') {
      btns.push(`<button class="btn bsu bsm" onclick="WorkOrderDetailPage.setStatus('pågående')">Starta</button>`);
    }
    if (ao.status === 'pågående') {
      btns.push(`<button class="btn bsu bsm" onclick="WorkOrderDetailPage.markComplete()">Markera klar</button>`);
    }
    if (!['klar','fakturerad','avbruten'].includes(ao.status)) {
      btns.push(`<button class="btn bs bsm" onclick="WorkOrderDetailPage.openStatusModal()">${ic('more-vertical',14)}</button>`);
    }
    return btns.join('');
  },

  _priceLabel(ao) {
    if (ao.priceType === 'fastpris')  return `Fastpris: ${fmt(ao.fixedPrice)} kr`;
    if (ao.priceType === 'timpris')   return 'Timpris';
    if (ao.priceType === 'prisgrupp') {
      const pg = (state.priceGroups||[]).find(p => p.id === ao.priceGroupId);
      return pg ? `${pg.name} – ${fmt(pg.hourRate)} kr/tim` : 'Prisgrupp';
    }
    return 'Ej satt';
  },

  _stampSection(ao, isActive) {
    if (['klar','fakturerad','avbruten'].includes(ao.status)) return '';
    return `
      <div class="card">
        <div class="card-header"><h3>Stämpling</h3>
          ${isActive ? `<span class="bdg bdg-green">Inklockat ${TimeService.elapsedStr(state.stampTimestamp)}</span>` : ''}
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
    if (!items.length) return `<p style="padding:10px 0;color:var(--mt);font-size:13px;">Ingen checklista ännu</p>`;
    const done = items.filter(c=>c.done).length;
    return `
      <div class="pb" style="margin-bottom:8px;"><div class="pbf" style="width:${items.length?Math.round(done/items.length*100):0}%"></div></div>
      ${items.map((c, i) => `
        <div class="chi" onclick="WorkOrderDetailPage.toggleCheck(${i})">
          <div class="chc ${c.done?'done':''}">${c.done?ic('check',11):''}</div>
          <span class="cht ${c.done?'done':''}">${c.text}</span>
          <button class="btn bxs bd" style="flex-shrink:0;" onclick="event.stopPropagation();WorkOrderDetailPage.removeCheck(${i})">${ic('x',12)}</button>
        </div>`).join('')}`;
  },

  _renderMaterials(ao) {
    const mats = ao.materials || [];
    if (!mats.length) return `<p style="padding:12px 14px;color:var(--mt);font-size:13px;">Inget material registrerat</p>`;
    return mats.map(m => `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--bg);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;">${m.name}</div>
          <div style="font-size:11px;color:var(--mt);">${m.qty} ${m.unit} · Ink-pris: ${fmt(m.buyPrice)} kr · Pris: ${fmt(m.sellPrice)} kr/st</div>
        </div>
        <div style="font-size:13px;font-weight:700;flex-shrink:0;">${fmt((m.qty||0)*(m.sellPrice||0))} kr</div>
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <button class="btn bxs bs" onclick="WorkOrderDetailPage.openEditMaterial('${m.id}')">${ic('pencil',12)}</button>
          <button class="btn bxs bd" onclick="WorkOrderDetailPage.deleteMaterial('${m.id}')">${ic('trash',12)}</button>
        </div>
      </div>`).join('');
  },

  _renderTimeEntries(ao) {
    const entries = TimeService.getByAO(ao.id);
    if (!entries.length) return `<p style="padding:12px 14px;color:var(--mt);font-size:13px;">Ingen tid registrerad</p>`;
    return entries.map(t => `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--bg);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;">${t.staffName} · ${TimeService.fmtDuration(t.minutes)}</div>
          <div style="font-size:11px;color:var(--mt);">${t.date} ${t.startStr}–${t.endStr}${t.comment?' · '+t.comment:''}</div>
          ${t.priceGroupName ? `<div style="font-size:11px;color:var(--sky);">${t.priceGroupName} – ${fmt(t.hourRate)} kr/tim</div>` : ''}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <button class="btn bxs bs" onclick="WorkOrderDetailPage.openEditTime('${t.id}')">${ic('pencil',12)}</button>
          <button class="btn bxs bd" onclick="WorkOrderDetailPage.deleteTime('${t.id}')">${ic('trash',12)}</button>
        </div>
      </div>`).join('');
  },

  _renderNotes(ao) {
    const notes = ao.notes || [];
    if (!notes.length) return `<p style="padding:12px 14px;color:var(--mt);font-size:13px;">Inga anteckningar</p>`;
    return notes.map(n => `
      <div style="padding:10px 14px;border-bottom:1px solid var(--bg);">
        <div style="font-size:12px;color:var(--mt);margin-bottom:4px;">${n.staffName} · ${relDate(n.timestamp)}</div>
        <div style="font-size:13px;line-height:1.5;">${n.text}</div>
      </div>`).join('');
  },

  /* ── Åtgärder ──────────────────────────── */
  setStatus(status) {
    WorkOrderService.setStatus(this.aoId, status);
    this.render({ aoId: this.aoId });
    showToast(`Status: ${statusLabel(status)}`);
  },

  markComplete() {
    Modal.confirm(`Markera ordern som klar?`, () => {
      WorkOrderService.markComplete(this.aoId);
      this.render({ aoId: this.aoId });
      showToast('Order markerad klar');
    });
  },

  openStatusModal() {
    const ao = getAO(this.aoId);
    if (!ao) return;
    const statuses = ['nytt','pool','planerad','pågående','klar','avbruten'];
    Modal.open({
      title: 'Ändra status',
      body: statuses.map(s => `
        <div class="crow" onclick="WorkOrderDetailPage.setStatus('${s}');Modal.close();">
          ${sbdg(s)}
          <span style="font-size:13px;">${ao.status===s?ic('check',14):''}</span>
        </div>`).join('')
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
    const pgOptions = (state.priceGroups||[]).filter(p=>p.active).map(p =>
      `<option value="${p.id}">${p.name} – ${fmt(p.hourRate)} kr/tim</option>`
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

  /* ── Checklista ────────────────────────── */
  openAddChecklist() {
    Modal.open({
      title: 'Lägg till checkpunkt',
      body: `<div class="fg"><label>Text</label>
        <input id="cl-text" placeholder="T.ex. Inspektera takbrunn…" autofocus
          onkeydown="if(event.key==='Enter'){WorkOrderDetailPage.saveChecklist();event.preventDefault();}"></div>`,
      buttons: [
        { label: 'Lägg till', cls: 'btn bp', onClick: () => this.saveChecklist() },
        { label: 'Avbryt',   cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('cl-text')?.focus(), 80);
  },

  saveChecklist() {
    const text = document.getElementById('cl-text')?.value.trim();
    if (!text) { showToast('Skriv en text'); return; }
    WorkOrderService.addChecklist(this.aoId, text);
    Modal.close();
    const ao = getAO(this.aoId);
    if (ao) {
      document.getElementById('ao-checklist').innerHTML = this._renderChecklist(ao);
      showToast('Checkpunkt tillagd');
    }
  },

  toggleCheck(idx) {
    WorkOrderService.toggleChecklist(this.aoId, idx);
    const ao = getAO(this.aoId);
    if (ao) document.getElementById('ao-checklist').innerHTML = this._renderChecklist(ao);
  },

  removeCheck(idx) {
    WorkOrderService.removeChecklist(this.aoId, idx);
    const ao = getAO(this.aoId);
    if (ao) document.getElementById('ao-checklist').innerHTML = this._renderChecklist(ao);
  },

  /* ── Material ──────────────────────────── */
  openAddMaterial() {
    const artOptions = (state.articles||[]).filter(a=>a.active).map(a =>
      `<option value="${a.id}" data-name="${a.name}" data-unit="${a.unit}" data-buy="${a.buyPrice}" data-sell="${a.sellPrice}">${a.articleNumber ? a.articleNumber+' – ':'' }${a.name}</option>`
    ).join('');

    Modal.open({
      title: 'Lägg till material',
      body: `
        ${(state.articles||[]).length > 0 ? `
          <div class="fg"><label>Välj artikel (valfritt)</label>
            <select id="mat-article" onchange="WorkOrderDetailPage._matArticleChosen()">
              <option value="">— Välj artikel eller ange manuellt —</option>${artOptions}
            </select></div>` : ''}
        <div class="fg"><label>Benämning <span style="color:var(--rd)">*</span></label>
          <input id="mat-name" placeholder="T.ex. Fogmassa Sikaflex"></div>
        <div class="g3">
          <div class="fg"><label>Antal</label><input type="number" id="mat-qty" value="1" min="0.1" step="0.1"></div>
          <div class="fg"><label>Enhet</label>
            <select id="mat-unit">
              ${['st','tim','m²','m','lm','kg','liter','säck','rulle','dag','månad','gång','paket','par'].map(u=>`<option value="${u}">${u}</option>`).join('')}
            </select></div>
          <div class="fg"><label>Ink-pris</label><input type="number" id="mat-buy" placeholder="0" min="0"></div>
        </div>
        <div class="fg"><label>Försäljningspris (kr/enhet)</label>
          <input type="number" id="mat-sell" placeholder="0" min="0"></div>`,
      buttons: [
        { label: 'Lägg till', cls: 'btn bp', onClick: () => this._saveMaterial(null) },
        { label: 'Avbryt',   cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _matArticleChosen() {
    const sel = document.getElementById('mat-article');
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.value) return;
    const nameEl = document.getElementById('mat-name');
    const unitEl = document.getElementById('mat-unit');
    const buyEl  = document.getElementById('mat-buy');
    const sellEl = document.getElementById('mat-sell');
    if (nameEl) nameEl.value = opt.dataset.name || '';
    if (buyEl)  buyEl.value  = opt.dataset.buy  || '0';
    if (sellEl) sellEl.value = opt.dataset.sell || '0';
    if (unitEl) {
      for (let i = 0; i < unitEl.options.length; i++) {
        if (unitEl.options[i].value === opt.dataset.unit) { unitEl.selectedIndex = i; break; }
      }
    }
  },

  openEditMaterial(matId) {
    const ao = getAO(this.aoId);
    const m  = (ao.materials||[]).find(x=>x.id===matId);
    if (!m) return;
    Modal.open({
      title: 'Redigera material',
      body: `
        <div class="fg"><label>Benämning</label><input id="mat-name" value="${m.name}"></div>
        <div class="g3">
          <div class="fg"><label>Antal</label><input type="number" id="mat-qty" value="${m.qty}" min="0.1" step="0.1"></div>
          <div class="fg"><label>Enhet</label>
            <select id="mat-unit">
              ${['st','tim','m²','m','lm','kg','liter','säck','rulle','dag','månad','gång','paket','par'].map(u=>`<option value="${u}" ${m.unit===u?'selected':''}>${u}</option>`).join('')}
            </select></div>
          <div class="fg"><label>Ink-pris</label><input type="number" id="mat-buy" value="${m.buyPrice}" min="0"></div>
        </div>
        <div class="fg"><label>Försäljningspris (kr/enhet)</label>
          <input type="number" id="mat-sell" value="${m.sellPrice}" min="0"></div>`,
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
      articleId:document.getElementById('mat-article')?.value || ''
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

  /* ── Tid ───────────────────────────────── */
  openAddTime() {
    const pgOptions = (state.priceGroups||[]).filter(p=>p.active).map(p =>
      `<option value="${p.id}">${p.name} – ${fmt(p.hourRate)} kr/tim</option>`
    ).join('');
    Modal.open({
      title: 'Registrera tid',
      body: `
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
      `<option value="${p.id}" ${t.priceGroupId===p.id?'selected':''}>${p.name} – ${fmt(p.hourRate)} kr/tim</option>`
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
    if (existingId) {
      TimeService.update(existingId, data);
      showToast('Tid uppdaterad');
    } else {
      const result = TimeService.saveManual({ ...data, aoId: this.aoId });
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

  /* ── Anteckningar ──────────────────────── */
  openAddNote() {
    Modal.open({
      title: 'Lägg till anteckning',
      body: `<div class="fg"><label>Anteckning</label>
        <textarea id="note-text" rows="3" placeholder="Skriv din anteckning…"></textarea></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const text = document.getElementById('note-text')?.value.trim();
          if (!text) { showToast('Skriv en anteckning'); return; }
          WorkOrderService.addNote(this.aoId, text);
          Modal.close();
          const ao = getAO(this.aoId);
          if (ao) document.getElementById('ao-notes').innerHTML = this._renderNotes(ao);
          showToast('Anteckning tillagd');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
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
