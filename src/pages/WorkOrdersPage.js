/**
 * WorkOrdersPage — AO-lista + skapa-wizard
 */
const WorkOrdersPage = {
  filter: 'alla',
  q: '',
  viewMode: localStorage.getItem('view-ao') || 'list',

  /* ── Wizard-state ──────────────────────── */
  _wiz: { step: 1, data: {}, modalId: null },

  _dashFilter: null, // extra filter from dashboard navigation

  render(params) {
    const el = document.getElementById('pg-ao-content');
    if (!el) return;

    // Handle filter params from dashboard navigation
    if (params && params.filter) {
      const tabMap = {
        akut:'alla', active:'alla', pool:'pool', planerad:'planerad',
        pågående:'pågående', klar:'klar', nytt:'nytt', readyForInvoice:'klar',
        idag:'planerad', forsenad:'alla', mine:'alla'
      };
      this.filter      = tabMap[params.filter] || 'alla';
      this._dashFilter = params.filter;
    }

    // Compute quick-filter counts
    const wos   = state.workOrders || [];
    const today = tdy();
    const myId  = state.currentUser ? state.currentUser.id : null;
    const active = a => !['klar','fakturerad','avbruten'].includes(a.status);
    const qfCounts = {
      akut:           wos.filter(a => a.priority==='akut' && active(a)).length,
      readyForInvoice:wos.filter(a => a.status==='klar' && !a.invoiceId).length,
      idag:           wos.filter(a => a.scheduledDate===today && active(a)).length,
      forsenad:       wos.filter(a => a.scheduledDate && a.scheduledDate<today && active(a)).length,
      mine:           myId ? wos.filter(a => (a.staff||[]).includes(myId) && active(a)).length : 0
    };

    const qfBtns = [
      { key:null,              label:'Alla filter',       cnt:null },
      { key:'akut',            label:'Akuta',             cnt:qfCounts.akut },
      { key:'readyForInvoice', label:'Redo fakturering',  cnt:qfCounts.readyForInvoice },
      { key:'idag',            label:'Idag',              cnt:qfCounts.idag },
      { key:'forsenad',        label:'Försenade',         cnt:qfCounts.forsenad },
      { key:'mine',            label:'Mina ärenden',      cnt:qfCounts.mine }
    ];
    const qfHtml = qfBtns.map(b => {
      const isOn = b.key === null ? !this._dashFilter : this._dashFilter === b.key;
      const cntBadge = b.cnt ? ` <span style="font-size:10px;background:${isOn?'rgba(255,255,255,.35)':'var(--br)'};border-radius:999px;padding:0 5px;">${b.cnt}</span>` : '';
      return `<button class="ft ${isOn?'on':''}" onclick="WorkOrdersPage.setQuickFilter(${b.key===null?'null':"'"+b.key+"'"})">${b.label}${cntBadge}</button>`;
    }).join('');

    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
        <div class="swrap" style="flex:1;">
          <span class="sico">${ic('search',16)}</span>
          <input type="search" id="ao-search" placeholder="Sök order, kund, adress…"
            value="${this.q}" oninput="WorkOrdersPage.q=this.value;WorkOrdersPage.renderList()">
        </div>
        <div style="display:flex;border:1.5px solid var(--br);border-radius:var(--rx);overflow:hidden;flex-shrink:0;">
          <button class="btn bxs ${this.viewMode==='list'?'bp':'bghost'}" style="border-radius:0;border:none;gap:4px;" onclick="WorkOrdersPage.setView('list')">
            ${ic('list',13)} Lista
          </button>
          <button class="btn bxs ${this.viewMode==='grid'?'bp':'bghost'}" style="border-radius:0;border-left:1.5px solid var(--br);border-right:none;border-top:none;border-bottom:none;gap:4px;" onclick="WorkOrdersPage.setView('grid')">
            ${ic('grid',13)} Kort
          </button>
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
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <span style="font-size:10px;font-weight:700;color:var(--mt);white-space:nowrap;flex-shrink:0;">${ic('filter',11)}</span>
        <div class="ftabs" style="margin-bottom:0;flex:1;">${qfHtml}</div>
      </div>
      <div id="ao-list"></div>`;
    this.renderList();
  },

  setView(mode) {
    this.viewMode = mode;
    localStorage.setItem('view-ao', this.viewMode);
    this.render();
  },

  toggleView() {
    this.setView(this.viewMode === 'list' ? 'grid' : 'list');
  },

  setFilter(f) {
    this.filter = f;
    this.render();
  },

  setQuickFilter(key) {
    this._dashFilter = key === this._dashFilter ? null : key;
    this.render();
  },

  renderList() {
    const el = document.getElementById('ao-list');
    if (!el) return;
    let list = state.workOrders || [];
    if (this.filter !== 'alla') list = list.filter(a => a.status === this.filter);
    // Apply quick-filter refinements
    const _active = a => !['klar','fakturerad','avbruten'].includes(a.status);
    if (this._dashFilter === 'readyForInvoice') list = list.filter(a => a.status==='klar' && !a.invoiceId);
    if (this._dashFilter === 'akut')    list = list.filter(a => a.priority==='akut' && _active(a));
    if (this._dashFilter === 'active')  list = list.filter(a => ['nytt','pool','planerad','pågående'].includes(a.status));
    if (this._dashFilter === 'idag')    list = list.filter(a => a.scheduledDate===tdy() && _active(a));
    if (this._dashFilter === 'forsenad')list = list.filter(a => a.scheduledDate && a.scheduledDate<tdy() && _active(a));
    if (this._dashFilter === 'mine') {
      const myId = state.currentUser ? state.currentUser.id : null;
      if (myId) list = list.filter(a => (a.staff||[]).includes(myId) && _active(a));
    }
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
    if (this.viewMode === 'grid') {
      el.innerHTML = `<div class="ao-grid">${list.map(ao => {
        const cu     = getCu(ao.customerId);
        const cuName = cu ? CustomerService.displayName(cu) : '—';
        const done   = (ao.checklist||[]).filter(c=>c.done).length;
        const total  = (ao.checklist||[]).length;
        return `
          <div class="ao-card ${priorityClass(ao.priority)}" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:6px;">
              <div style="font-size:12px;font-weight:700;color:var(--navy);">${ao.id}</div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">${sbdg(ao.status)}${pbdg(ao.priority)}</div>
            </div>
            <div style="font-size:13px;font-weight:700;margin-bottom:4px;line-height:1.3;">${ao.title}</div>
            <div style="font-size:11px;color:var(--mt);">${cuName}</div>
            ${ao.scheduledDate?`<div style="font-size:11px;color:var(--mt);margin-top:2px;">${ao.scheduledDate}${ao.scheduledStart?' '+ao.scheduledStart:''}</div>`:''}
            ${total>0?`<div style="margin-top:6px;"><div class="pb"><div class="pbf" style="width:${Math.round(done/total*100)}%"></div></div><div style="font-size:10px;color:var(--mt);margin-top:2px;">${done}/${total} klara</div></div>`:''}
          </div>`;
      }).join('')}</div>`;
    } else {
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
    }
  },

  /* ── Skapa AO – wizard ─────────────────── */
  openCreate(prefillCustomerId = null) {
    this._wiz = { step: 1, data: { customerId: prefillCustomerId || '' }, modalId: null };
    this._showWizard();
  },

  _showWizard() {
    const wiz = this._wiz;
    const stepTitles = ['', 'Kund & jobb', 'Planering', 'Pris & utförande'];

    const progressHtml = `
      <div style="display:flex;gap:4px;margin-bottom:14px;">
        ${[1,2,3].map(n=>`<div style="flex:1;height:4px;border-radius:4px;background:${n<=wiz.step?'var(--sky)':'var(--br)'};"></div>`).join('')}
      </div>
      <div style="font-size:11px;color:var(--mt);margin-bottom:12px;">Steg ${wiz.step} av 3 – ${stepTitles[wiz.step]}</div>`;

    const stepBody = `${progressHtml}<div id="wiz-body">${this._wizStep(wiz.step)}</div>`;

    // If modal already exists, update it; otherwise create new
    const existingSheet = wiz.modalId ? document.getElementById(wiz.modalId)?.querySelector('.modal-sheet') : null;

    if (!existingSheet) {
      wiz.modalId = Modal.open({
        title: 'Ny arbetsorder',
        wide: true,
        body: stepBody,
        buttons: this._wizButtons(wiz.step)
      });
    } else {
      // Update body content
      const bodyContent = existingSheet.querySelector('.modal-body > div');
      if (bodyContent) bodyContent.innerHTML = stepBody;

      // Update footer buttons
      const footer = existingSheet.querySelector('.modal-footer');
      if (footer) {
        footer.innerHTML = '';
        this._wizButtons(wiz.step).forEach(btn => {
          const b = document.createElement('button');
          b.className = btn.cls || 'btn bs';
          b.textContent = btn.label;
          b.onclick = btn.onClick;
          footer.appendChild(b);
        });
      }
    }

    // Bind step-specific events
    setTimeout(() => {
      if (wiz.step === 1) this._bindWizStep1();
      else if (wiz.step === 2) this._bindWizStep2();
      else if (wiz.step === 3) this._bindWizStep3();
    }, 60);
  },

  _wizButtons(step) {
    if (step === 1) return [
      { label: 'Nästa',  cls: 'btn bp', onClick: () => this._wizNext() },
      { label: 'Avbryt', cls: 'btn bs', onClick: () => this._wizCancel() }
    ];
    if (step === 2) return [
      { label: 'Nästa',    cls: 'btn bp', onClick: () => this._wizNext() },
      { label: 'Tillbaka', cls: 'btn bs', onClick: () => this._wizBack() }
    ];
    return [
      { label: 'Skapa order', cls: 'btn bsu', onClick: () => this._wizSave() },
      { label: 'Tillbaka',    cls: 'btn bs',  onClick: () => this._wizBack() }
    ];
  },

  _wizCancel() {
    Modal.confirm('Avbryt arbetsorder?', () => {
      this._wiz.modalId = null;
      Modal.close();
    });
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
        </select>
        <button class="btn bs bxs" style="margin-top:4px;" onclick="WorkOrdersPage.openNewCustomerFromWizard()">
          + Ny kund
        </button></div>
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
    const isPlan = d.status === 'planerad' || !!d.scheduledDate;
    const priorities = [{v:'akut',l:'Akut'},{v:'hög',l:'Hög'},{v:'normal',l:'Normal'},{v:'låg',l:'Låg'}];
    const prio = d.priority || 'normal';

    // Staff modal picker
    const sel = d.staff || [];
    const staffChips = sel.map(id => {
      const s = getStaff(id);
      return s ? `<span class="mpicker-tag">${s.firstName} ${s.lastName.charAt(0)}.<button onclick="WorkOrdersPage._spmRemove('${id}');event.stopPropagation();">${ic('x',9)}</button></span>` : '';
    }).join('');

    return `
      <div class="fg">
        <label style="font-size:12px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Planering</label>
        <div class="g2" style="margin-top:6px;">
          <button type="button" class="btn ${!isPlan?'bp':'bs'} bfull" id="btn-pool"
            onclick="WorkOrdersPage._wizSetPlan('pool')" style="padding:12px;font-size:13px;">
            ${ic('clipboard-list',15)} Arbetspool
          </button>
          <button type="button" class="btn ${isPlan?'bp':'bs'} bfull" id="btn-direct"
            onclick="WorkOrdersPage._wizSetPlan('direct')" style="padding:12px;font-size:13px;">
            ${ic('calendar',15)} Planera direkt
          </button>
        </div>
      </div>

      <div id="wiz-schedule" style="${isPlan?'':'display:none;'}">
        <div class="g2">
          <div class="fg"><label>Datum</label><input type="date" id="wiz-date" value="${d.scheduledDate||tdy()}"></div>
          <div class="g2">
            <div class="fg"><label>Starttid</label><input type="time" id="wiz-start" value="${d.scheduledStart||'08:00'}"></div>
            <div class="fg"><label>Sluttid</label><input type="time" id="wiz-end" value="${d.scheduledEnd||'16:00'}"></div>
          </div>
        </div>
      </div>

      <div class="fg">
        <label style="font-size:12px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Prioritet</label>
        <div class="chips" style="margin-top:6px;">
          ${priorities.map(p => `
            <button type="button" class="chip ${prio===p.v?'on':''}" id="prio-${p.v}"
              onclick="WorkOrdersPage._wizSetPrio('${p.v}')">${p.l}</button>`).join('')}
        </div>
      </div>

      <div class="fg">
        <label style="font-size:12px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Personal (valfritt)</label>
        <button type="button" class="btn bs bfull" style="justify-content:flex-start;gap:8px;margin-top:6px;padding:11px 14px;font-size:13px;"
          onclick="WorkOrdersPage._openStaffModal()">
          ${ic('users',15)} ${sel.length ? sel.length + ' person' + (sel.length > 1 ? 'er' : '') + ' vald' : 'Välj personal…'}
        </button>
        <div id="wiz-staff-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
          ${staffChips}
        </div>
      </div>`;
  },

  _wizStep3Html(d) {
    const pgOptions = (state.priceGroups||[]).filter(p=>p.active).map(p =>
      `<option value="${p.id}" ${d.priceGroupId===p.id?'selected':''}>${p.name} – ${fmt(p.hourRate)} kr/tim</option>`
    ).join('');
    const pt = d.priceType || 'ej_satt';
    const hints = {
      ej_satt:  'Pris sätts senare på arbetsordern eller vid fakturering.',
      fastpris: 'Ange fast pris exkl. moms. Moms 25% tillkommer.',
      timpris:  'Tid debiteras enligt registrerade tidsnoteringar.',
      prisgrupp:'Tid debiteras enligt vald prisgrupp.'
    };
    return `
      <div class="fg"><label>Prissättning</label>
        <div class="chips" style="margin-top:6px;">
          <button type="button" class="chip ${pt==='ej_satt'?'on':''}" id="pt-ej_satt" onclick="WorkOrdersPage._wizSetPriceType('ej_satt')">Ej satt</button>
          <button type="button" class="chip ${pt==='fastpris'?'on':''}" id="pt-fastpris" onclick="WorkOrdersPage._wizSetPriceType('fastpris')">Fastpris</button>
          <button type="button" class="chip ${pt==='timpris'?'on':''}" id="pt-timpris" onclick="WorkOrdersPage._wizSetPriceType('timpris')">Timpris</button>
          <button type="button" class="chip ${pt==='prisgrupp'?'on':''}" id="pt-prisgrupp" onclick="WorkOrdersPage._wizSetPriceType('prisgrupp')">Prisgrupp</button>
        </div>
      </div>

      <div id="wiz-pt-hint" class="ibox" style="margin:8px 0;font-size:12px;">${hints[pt]}</div>

      <div id="wiz-fastpris-row" style="${pt==='fastpris'?'':'display:none'}">
        <div class="fg"><label>Fastpris ex. moms (kr)</label>
          <input type="number" id="wiz-fastpris" value="${d.fixedPrice||''}" placeholder="0" min="0"
            oninput="WorkOrdersPage._wizUpdateMoms()"></div>
        <div id="wiz-moms-calc" class="ibox" style="font-size:12px;margin-top:4px;display:${d.fixedPrice?'':'none'};">
          ${d.fixedPrice?`Moms 25%: ${fmt(Math.round(d.fixedPrice*0.25))} kr &nbsp;·&nbsp; Inkl. moms: ${fmt(Math.round(d.fixedPrice*1.25))} kr`:''}
        </div>
      </div>

      <div id="wiz-prisgrupp-row" style="${pt==='prisgrupp'?'':'display:none'}">
        <div class="fg"><label>Prisgrupp</label>
          <select id="wiz-pg"><option value="">— Välj prisgrupp —</option>${pgOptions}</select></div>
      </div>

      <div class="fg" style="margin-top:4px;">
        <label style="font-size:12px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;">Checklista (valfritt)</label>
        <div id="wiz-checklist" style="margin-top:4px;"></div>
        <div style="display:flex;gap:6px;margin-top:6px;">
          <input id="wiz-cl-input" placeholder="Lägg till checkpunkt…" style="flex:1;"
            onkeydown="if(event.key==='Enter'){event.preventDefault();WorkOrdersPage._wizAddCL();}">
          <button type="button" class="btn bs bsm" onclick="WorkOrdersPage._wizAddCL()">${ic('plus',14)} Lägg till</button>
        </div>
      </div>`;
  },

  _bindWizStep1() {
    const sel = document.getElementById('wiz-customer');
    if (sel && this._wiz.data.customerId) this._wizCustomerChanged();
  },

  _bindWizStep2() {
    this._wizUpdateStaffChips();
  },

  _bindWizStep3() {
    this._renderWizChecklist();
  },

  /* ── Staff modal picker ────────────────── */
  _openStaffModal() {
    Modal.open({
      title: 'Välj personal',
      body: `
        <div class="fg" style="margin-bottom:8px;">
          <input id="spm-search" placeholder="Sök namn eller titel…"
            oninput="WorkOrdersPage._spmSearch(this.value)" autocomplete="off">
        </div>
        <div id="spm-list" style="max-height:380px;overflow-y:auto;">
          ${this._spmItems(state.staff || [])}
        </div>`,
      buttons: [
        { label: 'Klar', cls: 'btn bp', onClick: () => {
          Modal.close();
          this._wizUpdateStaffChips();
        }}
      ]
    });
    setTimeout(() => document.getElementById('spm-search')?.focus(), 80);
  },

  _spmItems(staffArr) {
    const active = (staffArr || []).filter(s => s.active);
    const sel = this._wiz.data.staff || [];
    if (!active.length) return `<p style="padding:12px 14px;color:var(--mt);font-size:13px;">Ingen aktiv personal</p>`;
    return active.map(s => {
      const isSel = sel.includes(s.id);
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 4px;cursor:pointer;border-bottom:1px solid var(--bg);transition:background .1s;"
          onclick="WorkOrdersPage._spmToggle('${s.id}')"
          onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
          <div style="width:24px;height:24px;border-radius:6px;border:2px solid ${isSel?'var(--navy)':'var(--br)'};
            background:${isSel?'var(--navy)':'transparent'};color:${isSel?'#fff':'transparent'};
            display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${ic('check',13)}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:700;color:var(--tx);">${s.firstName} ${s.lastName}</div>
            ${s.title?`<div style="font-size:12px;color:var(--mt);">${s.title}</div>`:''}
          </div>
        </div>`;
    }).join('');
  },

  _spmToggle(staffId) {
    const staff = this._wiz.data.staff = this._wiz.data.staff || [];
    const i = staff.indexOf(staffId);
    if (i > -1) staff.splice(i, 1);
    else staff.push(staffId);
    this._spmSearch(document.getElementById('spm-search')?.value || '');
  },

  _spmSearch(q) {
    const lq = q.toLowerCase();
    const listEl = document.getElementById('spm-list');
    if (!listEl) return;
    const filtered = (state.staff||[]).filter(s =>
      s.active && (!q || `${s.firstName} ${s.lastName} ${s.title||''}`.toLowerCase().includes(lq))
    );
    listEl.innerHTML = this._spmItems(filtered);
  },

  _spmRemove(staffId) {
    const staff = this._wiz.data.staff = this._wiz.data.staff || [];
    const i = staff.indexOf(staffId);
    if (i > -1) staff.splice(i, 1);
    this._wizUpdateStaffChips();
  },

  _wizUpdateStaffChips() {
    const chipsEl = document.getElementById('wiz-staff-chips');
    if (!chipsEl) return;
    const sel = this._wiz.data.staff || [];
    chipsEl.innerHTML = sel.map(id => {
      const s = getStaff(id);
      return s ? `<span class="mpicker-tag">${s.firstName} ${s.lastName.charAt(0)}.<button onclick="WorkOrdersPage._spmRemove('${id}');event.stopPropagation();">${ic('x',9)}</button></span>` : '';
    }).join('');
    // Update button label in step 2 if visible
    const openBtn = document.querySelector('.wiz-staff-btn');
    if (openBtn) openBtn.textContent = sel.length ? `${sel.length} person${sel.length > 1 ? 'er' : ''} vald` : 'Välj personal…';
  },

  /* ── Wizard helpers ────────────────────── */
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
      ? `<div class="ibox" style="margin-bottom:8px;">${ic('check',14)} ${CustomerService.displayName(cu)}</div>`
      : '';
  },

  _wizSetPlan(mode) {
    const isPlan = mode === 'direct';
    const sched = document.getElementById('wiz-schedule');
    if (sched) sched.style.display = isPlan ? '' : 'none';
    const pool   = document.getElementById('btn-pool');
    const direct = document.getElementById('btn-direct');
    if (pool)   pool.className   = `btn ${!isPlan?'bp':'bs'} bfull`;
    if (direct) direct.className = `btn ${isPlan?'bp':'bs'} bfull`;
    this._wiz.data.status = isPlan ? 'planerad' : 'pool';
    if (!isPlan) { this._wiz.data.scheduledDate = ''; this._wiz.data.scheduledStart = ''; this._wiz.data.scheduledEnd = ''; }
  },

  _wizSetPrio(p) {
    this._wiz.data.priority = p;
    document.querySelectorAll('[id^="prio-"]').forEach(b =>
      b.classList.toggle('on', b.id === 'prio-'+p)
    );
  },

  _wizSetPriceType(pt) {
    this._wiz.data.priceType = pt;
    ['ej_satt','fastpris','timpris','prisgrupp'].forEach(t => {
      const b = document.getElementById('pt-'+t);
      if (b) b.classList.toggle('on', t === pt);
    });
    const fp   = document.getElementById('wiz-fastpris-row');
    const pg   = document.getElementById('wiz-prisgrupp-row');
    const hint = document.getElementById('wiz-pt-hint');
    if (fp) fp.style.display = pt === 'fastpris'  ? '' : 'none';
    if (pg) pg.style.display = pt === 'prisgrupp' ? '' : 'none';
    const hints = {
      ej_satt:'Pris sätts senare på arbetsordern eller vid fakturering.',
      fastpris:'Ange fast pris exkl. moms. Moms 25% tillkommer.',
      timpris:'Tid debiteras enligt registrerade tidsnoteringar.',
      prisgrupp:'Tid debiteras enligt vald prisgrupp.'
    };
    if (hint) hint.textContent = hints[pt] || '';
  },

  _wizUpdateMoms() {
    const fp  = parseFloat(document.getElementById('wiz-fastpris')?.value) || 0;
    const el  = document.getElementById('wiz-moms-calc');
    if (!el) return;
    if (!fp) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = `Moms 25%: ${fmt(Math.round(fp*0.25))} kr &nbsp;·&nbsp; Inkl. moms: ${fmt(Math.round(fp*1.25))} kr`;
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

  /* ── Wizard collect ────────────────────── */
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
    const d = this._wiz.data;
    const isPlan = d.status === 'planerad';
    if (isPlan) {
      d.scheduledDate  = document.getElementById('wiz-date')?.value || '';
      d.scheduledStart = document.getElementById('wiz-start')?.value || '';
      d.scheduledEnd   = document.getElementById('wiz-end')?.value || '';
      if (!d.scheduledDate) { showToast('Välj datum'); return false; }
    } else {
      d.scheduledDate = ''; d.scheduledStart = ''; d.scheduledEnd = '';
    }
    if (!d.priority) d.priority = 'normal';
    return true;
  },

  _wizCollectStep3() {
    const d = this._wiz.data;
    d.priceType    = d.priceType    || 'ej_satt';
    d.fixedPrice   = parseFloat(document.getElementById('wiz-fastpris')?.value || '0') || 0;
    d.priceGroupId = document.getElementById('wiz-pg')?.value || '';
    if (d.priceType === 'fastpris' && !d.fixedPrice) { showToast('Ange fastpris'); return false; }
    if (d.priceType === 'prisgrupp' && !d.priceGroupId) { showToast('Välj prisgrupp'); return false; }
    return true;
  },

  _wizNext() {
    const step = this._wiz.step;
    const ok = step === 1 ? this._wizCollectStep1() : this._wizCollectStep2();
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
      log:           [],
      timeEntries:   []
    });
    this._wiz.modalId = null;
    Modal.close();
    Sidebar.updateBadges();
    showToast(`${ao.id} skapad`);
    Router.showPage('pg-ao-detail', { aoId: ao.id });
  },

  /* ── Ny kund från wizard ───────────────── */
  openNewCustomerFromWizard() {
    // Save current step 1 fields before opening second modal
    const titleEl = document.getElementById('wiz-title');
    const descEl  = document.getElementById('wiz-desc');
    if (titleEl) this._wiz.data.title = titleEl.value.trim();
    if (descEl)  this._wiz.data.description = descEl.value.trim();

    Modal.open({
      title: 'Ny kund',
      wide: true,
      body: CustomersPage._formHtml(null),
      buttons: [
        { label: 'Skapa kund', cls: 'btn bp', onClick: () => {
          const type = document.getElementById('cu-type')?.value || 'foretag';
          const data = { type };
          if (type === 'privat') {
            data.firstName = (document.getElementById('cu-firstname')?.value || '').trim();
            data.lastName  = (document.getElementById('cu-lastname')?.value || '').trim();
            data.personnr  = (document.getElementById('cu-personnr')?.value || '').trim();
            data.name = `${data.firstName} ${data.lastName}`.trim();
            if (!data.firstName) { showToast('Förnamn krävs'); return; }
          } else {
            data.name = (document.getElementById('cu-name')?.value || '').trim();
            if (!data.name) { showToast('Kundnamn krävs'); return; }
            data.orgNr = (document.getElementById('cu-orgnr')?.value || '').trim();
            data.contactPerson = (document.getElementById('cu-contact')?.value || '').trim();
          }
          data.phone   = (document.getElementById('cu-phone')?.value || '').trim();
          data.email   = (document.getElementById('cu-email')?.value || '').trim();
          data.address = (document.getElementById('cu-address')?.value || '').trim();
          data.zip     = (document.getElementById('cu-zip')?.value || '').trim();
          data.city    = (document.getElementById('cu-city')?.value || '').trim();

          const cu = CustomerService.create(data);
          Modal.close();

          // Add new customer to wizard dropdown and select it
          const wiz = document.getElementById(this._wiz.modalId);
          const sel = wiz?.querySelector('#wiz-customer');
          if (sel) {
            const opt = document.createElement('option');
            opt.value = cu.id;
            opt.textContent = CustomerService.displayName(cu);
            opt.selected = true;
            sel.appendChild(opt);
            this._wiz.data.customerId = cu.id;
            this._wizCustomerChanged();
          }
          showToast(`Kund ${CustomerService.displayName(cu)} skapad`);
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });

    setTimeout(() => {
      const sel = document.getElementById('cu-type');
      if (sel) sel.addEventListener('change', () => CustomersPage._toggleTypeFields(sel.value));
      CustomersPage._toggleTypeFields(sel?.value || 'foretag');
    }, 60);
  }
};
