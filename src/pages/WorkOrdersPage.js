/**
 * WorkOrdersPage — AO-lista + skapa-wizard
 */
const WorkOrdersPage = {
  filter: 'alla',
  q: '',

  /* ── Wizard-state ──────────────────────── */
  _wiz: { step: 1, data: {} },

  render() {
    const el = document.getElementById('pg-ao-content');
    if (!el) return;

    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
        <div class="swrap" style="flex:1;">
          <span class="sico">${ic('search',16)}</span>
          <input type="search" id="ao-search" placeholder="Sök order, kund, adress…"
            value="${this.q}" oninput="WorkOrdersPage.q=this.value;WorkOrdersPage.renderList()">
        </div>
        <button class="btn bp bsm" onclick="WorkOrdersPage.openCreate()">
          ${ic('plus',14)} Ny order
        </button>
      </div>
      <div class="ftabs" style="margin-bottom:4px;">
        ${['alla','nytt','pool','planerad','pågående','klar','fakturerad'].map(f =>
          `<button class="ft ${this.filter===f?'on':''}" onclick="WorkOrdersPage.setFilter('${f}')">${
            {alla:'Alla',nytt:'Nytt',pool:'Pool',planerad:'Planerad',pågående:'Pågående',klar:'Klar',fakturerad:'Fakturerad'}[f]
          }</button>`
        ).join('')}
      </div>
      <div id="ao-list"></div>`;
    this.renderList();
  },

  setFilter(f) {
    this.filter = f;
    document.querySelectorAll('#pg-ao-content .ft').forEach(b => {
      const label = {alla:'Alla',nytt:'Nytt',pool:'Pool',planerad:'Planerad',pågående:'Pågående',klar:'Klar',fakturerad:'Fakturerad'}[f];
      b.classList.toggle('on', b.textContent.trim() === label);
    });
    this.renderList();
  },

  renderList() {
    const el = document.getElementById('ao-list');
    if (!el) return;
    let list = state.workOrders || [];
    if (this.filter !== 'alla') list = list.filter(a => a.status === this.filter);
    if (this.q) {
      const ql = this.q.toLowerCase();
      list = list.filter(a => {
        const cu = getCu(a.customerId);
        return a.title.toLowerCase().includes(ql)
          || a.id.toLowerCase().includes(ql)
          || (a.address||'').toLowerCase().includes(ql)
          || (cu && CustomerService.displayName(cu).toLowerCase().includes(ql));
      });
    }
    list = list.slice().sort((a,b) => {
      const pOrd = {akut:0,hög:1,normal:2,låg:3};
      const d = (pOrd[a.priority]||2) - (pOrd[b.priority]||2);
      if (d !== 0) return d;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    if (!list.length) {
      el.innerHTML = `<div class="empty"><p>Inga ordrar matchar</p></div>`;
      return;
    }
    el.innerHTML = list.map(ao => {
      const cu     = getCu(ao.customerId);
      const cuName = cu ? CustomerService.displayName(cu) : '—';
      const done   = (ao.checklist||[]).filter(c=>c.done).length;
      const total  = (ao.checklist||[]).length;
      return `
        <div class="list-item ${priorityClass(ao.priority)}" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
          <div class="item-row">
            <div style="flex:1;min-width:0;">
              <div class="item-title">${ao.id} – ${ao.title}</div>
              <div class="item-sub">${cuName}${ao.scheduledDate?' · '+ao.scheduledDate:''}${ao.scheduledStart?' '+ao.scheduledStart:''}</div>
              ${total>0?`<div style="margin-top:4px;"><div class="pb"><div class="pbf" style="width:${Math.round(done/total*100)}%"></div></div></div>`:''}
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
              ${sbdg(ao.status)}${pbdg(ao.priority)}
            </div>
          </div>
        </div>`;
    }).join('');
  },

  /* ── Skapa AO – wizard ─────────────────── */
  openCreate(prefillCustomerId = null) {
    this._wiz = { step: 1, data: { customerId: prefillCustomerId || '' } };
    this._showWizard();
  },

  _showWizard() {
    const wiz = this._wiz;
    const stepTitles = ['', 'Kund & jobb', 'Planering', 'Pris & utförande'];
    const body = `
      <div style="display:flex;gap:4px;margin-bottom:14px;">
        ${[1,2,3].map(n => `
          <div style="flex:1;height:4px;border-radius:4px;background:${n<=wiz.step?'var(--sky)':'var(--br)'};"></div>
        `).join('')}
      </div>
      <div style="font-size:11px;color:var(--mt);margin-bottom:12px;">Steg ${wiz.step} av 3 – ${stepTitles[wiz.step]}</div>
      <div id="wiz-body">${this._wizStep(wiz.step)}</div>`;

    if (wiz.step === 1) {
      Modal.open({
        title: 'Ny arbetsorder',
        wide:  true,
        body,
        buttons: [
          { label: 'Nästa', cls: 'btn bp', onClick: () => this._wizNext() },
          { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
        ]
      });
      this._bindWizStep1();
    } else {
      // Uppdatera befintlig modal
      const sheet = document.querySelector('#modal-root .modal-overlay.open .modal-sheet');
      if (sheet) {
        sheet.querySelector('.modal-title').textContent = 'Ny arbetsorder';
        sheet.querySelector('#wiz-body').parentElement.innerHTML =
          `<div style="display:flex;gap:4px;margin-bottom:14px;">
            ${[1,2,3].map(n=>`<div style="flex:1;height:4px;border-radius:4px;background:${n<=wiz.step?'var(--sky)':'var(--br)'};"></div>`).join('')}
           </div>
           <div style="font-size:11px;color:var(--mt);margin-bottom:12px;">Steg ${wiz.step} av 3 – ${stepTitles[wiz.step]}</div>
           <div id="wiz-body">${this._wizStep(wiz.step)}</div>`;
        const footer = sheet.querySelector('.modal-footer');
        if (footer) {
          footer.innerHTML = '';
          const btns = wiz.step < 3
            ? [['Tillbaka','btn bs'], ['Nästa','btn bp']]
            : [['Tillbaka','btn bs'], ['Skapa order','btn bsu']];
          btns.forEach(([lbl, cls], i) => {
            const b = document.createElement('button');
            b.className = cls;
            b.textContent = lbl;
            b.onclick = i === 0 ? () => this._wizBack() : (wiz.step < 3 ? () => this._wizNext() : () => this._wizSave());
            footer.appendChild(b);
          });
        }
      }
      if (wiz.step === 2) this._bindWizStep2();
      if (wiz.step === 3) this._bindWizStep3();
    }
  },

  _wizStep(step) {
    const d = this._wiz.data;
    if (step === 1) return this._wizStep1Html(d);
    if (step === 2) return this._wizStep2Html(d);
    if (step === 3) return this._wizStep3Html(d);
    return '';
  },

  _wizStep1Html(d) {
    const cuOptions = (state.customers||[]).map(c =>
      `<option value="${c.id}" ${d.customerId===c.id?'selected':''}>${CustomerService.displayName(c)}</option>`
    ).join('');
    const cu = d.customerId ? getCu(d.customerId) : null;
    return `
      <div class="fg"><label>Rubrik / Vad ska göras <span style="color:var(--rd)">*</span></label>
        <input id="wiz-title" value="${d.title||''}" placeholder="T.ex. Läckage badrum, Fasadtvätt…"></div>
      <div class="fg"><label>Beskrivning</label>
        <textarea id="wiz-desc" rows="2" placeholder="Mer detaljer om jobbet…">${d.description||''}</textarea></div>
      <div class="fg"><label>Kund <span style="color:var(--rd)">*</span></label>
        <select id="wiz-customer" onchange="WorkOrdersPage._wizCustomerChanged()">
          <option value="">— Välj kund —</option>${cuOptions}
        </select></div>
      <div id="wiz-autofill"></div>
      <div class="fg"><label>Arbetsadress</label>
        <input id="wiz-address" value="${d.address||cu&&cu.address||''}" placeholder="Gatuadress"></div>
      <div class="g2">
        <div class="fg"><label>Kontaktperson</label>
          <input id="wiz-contact" value="${d.contactPerson||cu&&cu.contactPerson||''}" placeholder="Namn"></div>
        <div class="fg"><label>Telefon</label>
          <input id="wiz-phone" type="tel" value="${d.phone||cu&&cu.phone||''}" placeholder="070-xxx xx xx"></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Åtkomst / portkod</label>
          <input id="wiz-access" value="${d.accessCode||''}" placeholder="T.ex. 1234#"></div>
        <div class="fg"><label>Intern notering</label>
          <input id="wiz-intnote" value="${d.internalNote||''}" placeholder="Visas ej för kund"></div>
      </div>`;
  },

  _wizStep2Html(d) {
    const staffHtml = (state.staff||[]).filter(s=>s.active).map(s => {
      const checked = (d.staff||[]).includes(s.id);
      return `<label style="display:flex;align-items:center;gap:8px;padding:8px;border:1.5px solid ${checked?'var(--sky)':'var(--br)'};border-radius:8px;cursor:pointer;background:${checked?'var(--acc)':'#fff'};" id="staff-label-${s.id}">
        <input type="checkbox" value="${s.id}" ${checked?'checked':''} style="width:16px;height:16px;"
          onchange="WorkOrdersPage._wizToggleStaff('${s.id}',this.checked)">
        <span style="font-size:13px;font-weight:600;">${s.firstName} ${s.lastName}</span>
        <span style="font-size:11px;color:var(--mt);">${s.title||''}</span>
      </label>`;
    }).join('');

    return `
      <div class="fg"><label>Planering</label>
        <div class="g2">
          <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1.5px solid var(--br);border-radius:8px;cursor:pointer;" id="plan-pool-lbl">
            <input type="radio" name="wiz-plan" value="pool" ${(!d.scheduledDate&&d.status!=='planerad')?'checked':''} onchange="WorkOrdersPage._wizPlanChange('pool')">
            <span style="font-size:13px;font-weight:600;">Lägg i arbetspool</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;padding:10px;border:1.5px solid var(--br);border-radius:8px;cursor:pointer;" id="plan-direct-lbl">
            <input type="radio" name="wiz-plan" value="direct" ${d.scheduledDate?'checked':''} onchange="WorkOrdersPage._wizPlanChange('direct')">
            <span style="font-size:13px;font-weight:600;">Planera direkt</span>
          </label>
        </div>
      </div>
      <div id="wiz-schedule" style="${d.scheduledDate?'':'display:none'}">
        <div class="g2">
          <div class="fg"><label>Datum</label><input type="date" id="wiz-date" value="${d.scheduledDate||tdy()}"></div>
          <div class="fg"><label>Prioritet</label>
            <select id="wiz-priority">
              ${['akut','hög','normal','låg'].map(p=>`<option value="${p}" ${(d.priority||'normal')===p?'selected':''}>${{akut:'Akut',hög:'Hög',normal:'Normal',låg:'Låg'}[p]}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="g2">
          <div class="fg"><label>Starttid</label><input type="time" id="wiz-start" value="${d.scheduledStart||'08:00'}"></div>
          <div class="fg"><label>Sluttid</label><input type="time" id="wiz-end" value="${d.scheduledEnd||'16:00'}"></div>
        </div>
      </div>
      <div id="wiz-priority-pool" style="${d.scheduledDate?'display:none':''}">
        <div class="fg"><label>Prioritet</label>
          <select id="wiz-priority-p">
            ${['akut','hög','normal','låg'].map(p=>`<option value="${p}" ${(d.priority||'normal')===p?'selected':''}>${{akut:'Akut',hög:'Hög',normal:'Normal',låg:'Låg'}[p]}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="fg" style="margin-top:4px;"><label>Personal (välj en eller flera)</label>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:4px;">${staffHtml}</div>
      </div>`;
  },

  _wizStep3Html(d) {
    const pgOptions = (state.priceGroups||[]).filter(p=>p.active).map(p =>
      `<option value="${p.id}" ${d.priceGroupId===p.id?'selected':''}>${p.name} – ${fmt(p.hourRate)} kr/tim</option>`
    ).join('');
    return `
      <div class="fg"><label>Prissättning</label>
        <select id="wiz-pricetype" onchange="WorkOrdersPage._wizPriceChange()">
          <option value="ej_satt"   ${(d.priceType||'ej_satt')==='ej_satt'  ?'selected':''}>Ej satt</option>
          <option value="fastpris"  ${d.priceType==='fastpris'              ?'selected':''}>Fastpris</option>
          <option value="timpris"   ${d.priceType==='timpris'               ?'selected':''}>Timpris</option>
          <option value="prisgrupp" ${d.priceType==='prisgrupp'             ?'selected':''}>Prisgrupp</option>
        </select>
      </div>
      <div id="wiz-fastpris-row" style="${d.priceType==='fastpris'?'':'display:none'}">
        <div class="fg"><label>Fastpris (ex moms)</label>
          <input type="number" id="wiz-fastpris" value="${d.fixedPrice||''}" placeholder="0" min="0"></div>
      </div>
      <div id="wiz-prisgrupp-row" style="${d.priceType==='prisgrupp'?'':'display:none'}">
        <div class="fg"><label>Prisgrupp</label>
          <select id="wiz-pg"><option value="">— Välj prisgrupp —</option>${pgOptions}</select></div>
      </div>
      <div class="fg"><label>Checklista (valfritt)</label>
        <div id="wiz-checklist" style="margin-top:4px;"></div>
        <div style="display:flex;gap:6px;margin-top:6px;">
          <input id="wiz-cl-input" placeholder="Lägg till checkpunkt…" style="flex:1;"
            onkeydown="if(event.key==='Enter'){event.preventDefault();WorkOrdersPage._wizAddCL();}">
          <button class="btn bs bsm" onclick="WorkOrdersPage._wizAddCL()">${ic('plus',14)}</button>
        </div>
      </div>`;
  },

  _bindWizStep1() {
    setTimeout(() => {
      const sel = document.getElementById('wiz-customer');
      if (sel && this._wiz.data.customerId) this._wizCustomerChanged();
    }, 50);
  },

  _bindWizStep2() {
    setTimeout(() => {
      const plan = this._wiz.data.scheduledDate ? 'direct' : 'pool';
      this._wizPlanChange(plan);
    }, 50);
  },

  _bindWizStep3() {
    setTimeout(() => {
      this._wizPriceChange();
      this._renderWizChecklist();
    }, 50);
  },

  _wizCustomerChanged() {
    const sel = document.getElementById('wiz-customer');
    if (!sel) return;
    const id = sel.value;
    this._wiz.data.customerId = id;
    const cu = id ? getCu(id) : null;
    if (cu) {
      const addr = document.getElementById('wiz-address');
      const cont = document.getElementById('wiz-contact');
      const ph   = document.getElementById('wiz-phone');
      if (addr && !addr.value) addr.value = cu.address || '';
      if (cont && !cont.value) cont.value = cu.contactPerson || '';
      if (ph   && !ph.value)   ph.value   = cu.phone || '';
    }
    document.getElementById('wiz-autofill').innerHTML = cu
      ? `<div class="ibox" style="margin-bottom:8px;">${ic('check',14)} Kundinformation: ${CustomerService.displayName(cu)}</div>`
      : '';
  },

  _wizPlanChange(mode) {
    const sched = document.getElementById('wiz-schedule');
    const pool  = document.getElementById('wiz-priority-pool');
    if (!sched) return;
    sched.style.display = mode === 'direct' ? '' : 'none';
    pool.style.display  = mode === 'pool'   ? '' : 'none';
  },

  _wizToggleStaff(staffId, checked) {
    const staff = this._wiz.data.staff || [];
    if (checked && !staff.includes(staffId)) staff.push(staffId);
    if (!checked) { const i = staff.indexOf(staffId); if (i > -1) staff.splice(i, 1); }
    this._wiz.data.staff = staff;
    const lbl = document.getElementById('staff-label-' + staffId);
    if (lbl) {
      lbl.style.borderColor  = checked ? 'var(--sky)' : 'var(--br)';
      lbl.style.background   = checked ? 'var(--acc)' : '#fff';
    }
  },

  _wizPriceChange() {
    const sel = document.getElementById('wiz-pricetype');
    if (!sel) return;
    const v = sel.value;
    const fp = document.getElementById('wiz-fastpris-row');
    const pg = document.getElementById('wiz-prisgrupp-row');
    if (fp) fp.style.display = v === 'fastpris'  ? '' : 'none';
    if (pg) pg.style.display = v === 'prisgrupp' ? '' : 'none';
  },

  _wizAddCL() {
    const inp = document.getElementById('wiz-cl-input');
    if (!inp || !inp.value.trim()) return;
    const d = this._wiz.data;
    d.checklist = d.checklist || [];
    d.checklist.push({ id: 'c' + Date.now(), text: inp.value.trim(), done: false });
    inp.value = '';
    this._renderWizChecklist();
    inp.focus();
  },

  _renderWizChecklist() {
    const el = document.getElementById('wiz-checklist');
    if (!el) return;
    const items = this._wiz.data.checklist || [];
    el.innerHTML = items.map((c, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--bg);">
        <span style="color:var(--mt);">${ic('check',14)}</span>
        <span style="flex:1;font-size:13px;">${c.text}</span>
        <button class="btn bxs bd" onclick="WorkOrdersPage._wizRemoveCL(${i})">${ic('x',12)}</button>
      </div>`).join('');
  },

  _wizRemoveCL(idx) {
    (this._wiz.data.checklist || []).splice(idx, 1);
    this._renderWizChecklist();
  },

  _wizCollectStep1() {
    const d = this._wiz.data;
    d.title         = (document.getElementById('wiz-title')?.value || '').trim();
    d.description   = (document.getElementById('wiz-desc')?.value || '').trim();
    d.customerId    = document.getElementById('wiz-customer')?.value || '';
    d.address       = document.getElementById('wiz-address')?.value.trim() || '';
    d.contactPerson = document.getElementById('wiz-contact')?.value.trim() || '';
    d.phone         = document.getElementById('wiz-phone')?.value.trim() || '';
    d.accessCode    = document.getElementById('wiz-access')?.value.trim() || '';
    d.internalNote  = document.getElementById('wiz-intnote')?.value.trim() || '';
    if (!d.title)      { showToast('Rubrik krävs'); return false; }
    if (!d.customerId) { showToast('Välj en kund'); return false; }
    return true;
  },

  _wizCollectStep2() {
    const d      = this._wiz.data;
    const isPlan = document.querySelector('input[name="wiz-plan"]:checked')?.value === 'direct';
    d.status     = isPlan ? 'planerad' : 'pool';
    if (isPlan) {
      d.scheduledDate  = document.getElementById('wiz-date')?.value || '';
      d.scheduledStart = document.getElementById('wiz-start')?.value || '';
      d.scheduledEnd   = document.getElementById('wiz-end')?.value || '';
      d.priority       = document.getElementById('wiz-priority')?.value || 'normal';
    } else {
      d.scheduledDate  = '';
      d.priority       = document.getElementById('wiz-priority-p')?.value || 'normal';
    }
    return true;
  },

  _wizCollectStep3() {
    const d    = this._wiz.data;
    d.priceType = document.getElementById('wiz-pricetype')?.value || 'ej_satt';
    d.fixedPrice = parseFloat(document.getElementById('wiz-fastpris')?.value || 0) || 0;
    d.priceGroupId = document.getElementById('wiz-pg')?.value || '';
    return true;
  },

  _wizNext() {
    const step = this._wiz.step;
    const ok = step === 1 ? this._wizCollectStep1()
             : step === 2 ? this._wizCollectStep2()
             : false;
    if (!ok) return;
    this._wiz.step++;
    this._showWizard();
  },

  _wizBack() {
    if (this._wiz.step > 1) {
      this._wiz.step--;
      this._showWizard();
    }
  },

  _wizSave() {
    if (!this._wizCollectStep3()) return;
    const d  = this._wiz.data;
    const ao = WorkOrderService.create({
      title:         d.title,
      description:   d.description,
      customerId:    d.customerId,
      propertyId:    d.propertyId || '',
      address:       d.address,
      contactPerson: d.contactPerson,
      phone:         d.phone,
      accessCode:    d.accessCode,
      internalNote:  d.internalNote,
      status:        d.status || 'pool',
      priority:      d.priority || 'normal',
      priceType:     d.priceType,
      fixedPrice:    d.fixedPrice,
      priceGroupId:  d.priceGroupId,
      staff:         d.staff || [],
      scheduledDate: d.scheduledDate || '',
      scheduledStart:d.scheduledStart || '',
      scheduledEnd:  d.scheduledEnd || '',
      checklist:     (d.checklist || []).map(c => ({ ...c })),
      materials:     [],
      notes:         [],
      timeEntries:   []
    });
    Modal.close();
    showToast(`${ao.id} skapad`);
    Router.showPage('pg-ao-detail', { aoId: ao.id });
  }
};
