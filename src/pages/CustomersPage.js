/**
 * CustomersPage — Kundlista + skapa/redigera + kundkort
 */

const CustomersPage = {
  q: '',

  render() {
    const el = document.getElementById('pg-crm-content');
    if (!el) return;
    const customers = CustomerService.search(this.q);

    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
        <div class="swrap" style="flex:1;">
          <span class="sico">${ic('search',16)}</span>
          <input type="search" id="crm-search" placeholder="Sök kund, telefon, e-post…"
            value="${this.q}"
            oninput="CustomersPage.q=this.value;CustomersPage.renderList()">
        </div>
        <button class="btn bp bsm" onclick="CustomersPage.openCreate()">
          ${ic('plus',14)} Ny kund
        </button>
      </div>
      <div class="chips" style="margin-bottom:4px;">
        ${['alla','privat','foretag','brf','fastighetsagare','inaktiva'].map(t =>
          `<button class="chip ${!this.q && this._typeFilter===t||(!this._typeFilter&&t==='alla')?'on':''}"
            onclick="CustomersPage._typeFilter='${t}';CustomersPage.renderList()">${
            {alla:'Alla',privat:'Privat',foretag:'Företag',brf:'BRF',fastighetsagare:'Fastighetsägare',inaktiva:'Inaktiva'}[t]}</button>`
        ).join('')}
      </div>
      <div id="crm-list"></div>`;
    this.renderList();
  },

  renderList() {
    const el = document.getElementById('crm-list');
    if (!el) return;
    let list = CustomerService.search(this.q);
    if (this._typeFilter === 'inaktiva') {
      list = list.filter(c => c.inactive);
    } else if (this._typeFilter && this._typeFilter !== 'alla') {
      list = list.filter(c => c.type === this._typeFilter && !c.inactive);
    } else {
      list = list.filter(c => !c.inactive);
    }
    if (list.length === 0) {
      el.innerHTML = `<div class="empty"><span class="empty-ico">${ic('users',36)}</span><h3>Inga kunder</h3><p>${this.q ? 'Inga träffar för sökning' : 'Skapa din första kund'}</p></div>`;
      return;
    }
    el.innerHTML = list.map(cu => {
      const name = CustomerService.displayName(cu);
      const aos  = CustomerService.getActiveAOs(cu.id).length;
      return `
        <div class="list-item" onclick="Router.showPage('pg-crm-detail',{customerId:'${cu.id}'})">
          <div class="item-row">
            <div>
              <div class="item-title">${name}</div>
              <div class="item-sub">${CustomerService.typeLabel(cu.type)}${cu.phone?' · '+cu.phone:''}${cu.city?' · '+cu.city:''}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
              ${aos > 0 ? `<span class="bdg bdg-blue">${aos} AO</span>` : ''}
              <span class="bdg bdg-grey">${cu.id}</span>
            </div>
          </div>
        </div>`;
    }).join('');
  },

  _onCreated: null,

  openCreate(onCreated = null) {
    this._onCreated = onCreated || null;
    this._openForm(null);
  },

  openEdit(id) {
    this._openForm(id);
  },

  _openForm(id) {
    const cu   = id ? getCu(id) : null;
    const type = cu ? cu.type : 'foretag';

    Modal.open({
      title: id ? 'Redigera kund' : 'Ny kund',
      wide:  true,
      body:  this._formHtml(cu),
      buttons: [
        { label: id ? 'Spara' : 'Skapa kund', cls: 'btn bp', onClick: () => this._save(id) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });

    // Bind type change
    setTimeout(() => {
      const sel = document.getElementById('cu-type');
      if (sel) sel.addEventListener('change', () => this._toggleTypeFields(sel.value));
      this._toggleTypeFields(type);
    }, 50);
  },

  _formHtml(cu) {
    const v = (key, def='') => cu ? (cu[key] || def) : def;
    const diffInv = cu && (cu.invoiceAddress || cu.invoiceZip || cu.invoiceCity);
    return `
      <div class="fg">
        <label>Kundtyp</label>
        <select id="cu-type">
          <option value="foretag"         ${v('type')==='foretag'        ?'selected':''}>Företag</option>
          <option value="brf"             ${v('type')==='brf'            ?'selected':''}>BRF</option>
          <option value="fastighetsagare" ${v('type')==='fastighetsagare'?'selected':''}>Fastighetsägare</option>
          <option value="privat"          ${v('type')==='privat'         ?'selected':''}>Privatperson</option>
        </select>
      </div>

      <div id="cu-company-fields">
        <div class="fg"><label>Företags-/kundnamn <span style="color:var(--rd)">*</span></label>
          <input id="cu-name" value="${v('name')}" placeholder="BRF Solgläntan"></div>
        <div class="fg"><label>Org.nr</label><input id="cu-orgnr" value="${v('orgNr')}" placeholder="556123-4567"></div>
        <div class="fg"><label>Kontaktperson</label><input id="cu-contact" value="${v('contactPerson')}" placeholder="Anna Svensson"></div>
      </div>

      <div id="cu-private-fields" style="display:none;">
        <div class="g2">
          <div class="fg"><label>Förnamn <span style="color:var(--rd)">*</span></label>
            <input id="cu-firstname" value="${v('firstName')}" placeholder="Anna"></div>
          <div class="fg"><label>Efternamn <span style="color:var(--rd)">*</span></label>
            <input id="cu-lastname" value="${v('lastName')}" placeholder="Svensson"></div>
        </div>
        <div class="fg"><label>Personnummer</label>
          <input id="cu-personnr" value="${v('personnr')}" placeholder="YYYYMMDD-XXXX"></div>
      </div>

      <div class="g2">
        <div class="fg"><label>Telefon</label><input id="cu-phone" type="tel" value="${v('phone')}" placeholder="070-000 00 00"></div>
        <div class="fg"><label>E-post</label><input id="cu-email" type="email" value="${v('email')}" placeholder="info@exempel.se"></div>
      </div>
      <div class="fg"><label>Adress</label><input id="cu-address" value="${v('address')}" placeholder="Storgatan 1"></div>
      <div class="g2">
        <div class="fg"><label>Postnummer</label><input id="cu-zip" value="${v('zip')}" placeholder="123 45"></div>
        <div class="fg"><label>Stad</label><input id="cu-city" value="${v('city')}" placeholder="Stockholm"></div>
      </div>

      <div class="fg" style="margin-top:4px;">
        <label><input type="checkbox" id="cu-diff-invoice" ${diffInv?'checked':''} style="width:16px;height:16px;margin-right:6px;"
          onchange="CustomersPage._toggleInvoice()">Annan fakturaadress</label>
      </div>
      <div id="cu-inv-fields" style="${diffInv?'':'display:none'}">
        <div class="fg"><label>Fakturaadress</label><input id="cu-inv-address" value="${v('invoiceAddress')}" placeholder="Fakturavägen 2"></div>
        <div class="g2">
          <div class="fg"><label>Postnummer</label><input id="cu-inv-zip" value="${v('invoiceZip')}" placeholder="123 45"></div>
          <div class="fg"><label>Stad</label><input id="cu-inv-city" value="${v('invoiceCity')}" placeholder="Stockholm"></div>
        </div>
      </div>

      <div class="fg"><label>Anteckning</label>
        <textarea id="cu-note" rows="2" placeholder="Intern anteckning om kunden">${v('note')}</textarea></div>`;
  },

  _toggleTypeFields(type) {
    const co = document.getElementById('cu-company-fields');
    const pr = document.getElementById('cu-private-fields');
    if (!co || !pr) return;
    if (type === 'privat') { co.style.display = 'none'; pr.style.display = ''; }
    else                    { co.style.display = '';     pr.style.display = 'none'; }
  },

  _toggleInvoice() {
    const checked = document.getElementById('cu-diff-invoice')?.checked;
    const el = document.getElementById('cu-inv-fields');
    if (el) el.style.display = checked ? '' : 'none';
  },

  _save(id) {
    const type = document.getElementById('cu-type').value;
    const data = { type };

    if (type === 'privat') {
      data.firstName = (document.getElementById('cu-firstname').value || '').trim();
      data.lastName  = (document.getElementById('cu-lastname').value || '').trim();
      data.personnr  = (document.getElementById('cu-personnr')?.value || '').trim();
      data.name      = `${data.firstName} ${data.lastName}`.trim();
      if (!data.firstName) { showToast('Förnamn krävs'); return; }
    } else {
      data.name = (document.getElementById('cu-name').value || '').trim();
      if (!data.name) { showToast('Kundnamn krävs'); return; }
      data.orgNr         = document.getElementById('cu-orgnr').value.trim();
      data.contactPerson = document.getElementById('cu-contact').value.trim();
    }

    data.phone   = document.getElementById('cu-phone').value.trim();
    data.email   = document.getElementById('cu-email').value.trim();
    data.address = document.getElementById('cu-address').value.trim();
    data.zip     = document.getElementById('cu-zip').value.trim();
    data.city    = document.getElementById('cu-city').value.trim();
    data.note    = document.getElementById('cu-note').value.trim();

    if (document.getElementById('cu-diff-invoice')?.checked) {
      data.invoiceAddress = (document.getElementById('cu-inv-address')?.value || '').trim();
      data.invoiceZip     = (document.getElementById('cu-inv-zip')?.value || '').trim();
      data.invoiceCity    = (document.getElementById('cu-inv-city')?.value || '').trim();
    } else {
      data.invoiceAddress = '';
      data.invoiceZip     = '';
      data.invoiceCity    = '';
    }

    if (id) {
      CustomerService.update(id, data);
      showToast('Kund uppdaterad');
      Modal.close();
      this.render();
    } else {
      const newCu = CustomerService.create(data);
      showToast('Kund skapad');
      Modal.close();
      if (this._onCreated) {
        const cb = this._onCreated;
        this._onCreated = null;
        cb(newCu);
      } else {
        this.render();
      }
    }
  }
};

/* ── Kundkort ──────────────────────────── */
const CustomerDetailPage = {
  customerId: null,
  tab: 'info',

  render(params) {
    const el = document.getElementById('pg-crm-detail-content');
    if (!el) return;
    const id = params && params.customerId;
    this.customerId = id;
    if (!id || !getCu(id)) {
      el.innerHTML = `<div class="empty">${ic('users',32)}<h3>Välj en kund</h3></div>`;
      return;
    }
    this._renderFull(el);
  },

  _renderFull(el) {
    const cu     = getCu(this.customerId);
    const name   = CustomerService.displayName(cu);
    const aos    = (state.workOrders||[]).filter(a => a.customerId === cu.id);
    const offers = CustomerService.getOffers(cu.id);
    const invoices = (state.invoices||[]).filter(i => i.customerId === cu.id);
    const sales  = (state.salesOpportunities||[]).filter(s => s.customerId === cu.id);

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
        <button class="btn bs bsm ao-back-btn" onclick="Router.back()">${ic('arrow-left',14)} Tillbaka</button>
        <h2 style="font-size:17px;font-weight:800;flex:1;">${name}${cu.inactive ? ' <span class="bdg bdg-grey" style="font-size:10px;vertical-align:middle;">Inaktiv</span>' : ''}</h2>
        <button class="btn bs bsm" onclick="CustomerDetailPage.toggleInactive('${cu.id}')">${cu.inactive ? ic('user-check',13)+' Aktivera' : ic('user-x',13)+' Inaktivera'}</button>
        <button class="btn bp bsm" onclick="CustomersPage.openEdit('${cu.id}')">${ic('pencil',14)} Redigera</button>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
        <span class="bdg bdg-grey">${cu.id}</span>
        <span class="bdg bdg-grey">${CustomerService.typeLabel(cu.type)}</span>
        ${cu.orgNr ? `<span class="bdg bdg-grey">${cu.orgNr}</span>` : ''}
      </div>

      <div class="ftabs" style="margin-bottom:4px;">
        ${[['info','Info'],['ao','AO ('+aos.length+')'],['offers','Offerter ('+offers.length+')'],
           ['invoices','Fakturor ('+invoices.length+')'],['sales','Säljchanser ('+sales.length+')'],['activity','Aktivitet']].map(([t,l]) =>
          `<button class="ft ${this.tab===t?'on':''}" onclick="CustomerDetailPage.switchTab('${t}')">${l}</button>`
        ).join('')}
      </div>

      <div id="cu-tab-content"></div>

      <div style="margin-top:8px;">
        <button class="btn bp bsm" onclick="WorkOrdersPage.openCreate('${cu.id}')">
          ${ic('plus',14)} Ny arbetsorder från kund
        </button>
      </div>`;

    this._renderTab();
  },

  switchTab(tab) {
    this.tab = tab;
    document.querySelectorAll('#pg-crm-detail-content .ft').forEach(b =>
      b.classList.toggle('on', b.textContent.trim().startsWith(
        {info:'Info',ao:'AO',offers:'Offerter',invoices:'Fakturor',sales:'Säljchanser',activity:'Aktivitet'}[tab]
      ))
    );
    this._renderTab();
  },

  _renderTab() {
    const el = document.getElementById('cu-tab-content');
    if (!el) return;
    const cu = getCu(this.customerId);

    switch (this.tab) {
      case 'info':     el.innerHTML = this._tabInfo(cu);     break;
      case 'ao':       el.innerHTML = this._tabAO(cu);       break;
      case 'offers':   el.innerHTML = this._tabOffers(cu);   break;
      case 'invoices': el.innerHTML = this._tabInvoices(cu); break;
      case 'sales':    el.innerHTML = this._tabSales(cu);    break;
      case 'activity': el.innerHTML = this._tabActivity(cu); break;
    }
  },

  _tabInfo(cu) {
    const rows = [
      ['Typ',         CustomerService.typeLabel(cu.type)],
      ['Telefon',     cu.phone   || '—'],
      ['E-post',      cu.email   || '—'],
      ['Adress',      [cu.address, cu.zip, cu.city].filter(Boolean).join(', ') || '—'],
      cu.orgNr         ? ['Org.nr',          cu.orgNr]         : null,
      cu.personnr      ? ['Personnummer',     cu.personnr]      : null,
      cu.contactPerson ? ['Kontaktperson',   cu.contactPerson] : null,
    ].filter(Boolean);

    const diffInv = cu.invoiceAddress || cu.invoiceZip || cu.invoiceCity;
    const contacts = (cu.contacts || []);
    return `
      <div class="card">
        <div class="card-header"><h3>Kontaktuppgifter</h3></div>
        <div class="card-body">
          ${rows.map(([k,v]) => `<div class="dr"><span class="dk">${k}</span><span class="dv">${v}</span></div>`).join('')}
          ${diffInv ? `<div class="dr"><span class="dk">Fakturaadress</span><span class="dv">${[cu.invoiceAddress, cu.invoiceZip, cu.invoiceCity].filter(Boolean).join(', ')}</span></div>` : ''}
          ${cu.note ? `<div style="margin-top:10px;" class="ibox">${cu.note}</div>` : ''}
        </div>
      </div>
      <div class="card" style="margin-top:8px;">
        <div class="card-header">
          <h3>Kontaktpersoner</h3>
          <button class="btn bs bxs" onclick="CustomerDetailPage.openAddContact()">${ic('plus',13)}</button>
        </div>
        <div class="card-body" style="padding:6px 14px;">
          ${contacts.length === 0 ? '<p style="font-size:13px;color:var(--mt);padding:4px 0;">Inga kontaktpersoner</p>' :
            contacts.map((c, i) => `
              <div class="crow">
                <div>
                  <div style="font-size:13px;font-weight:700;">${c.name}${c.primary?' <span class="bdg bdg-blue" style="font-size:9px;">Primär</span>':''}</div>
                  <div style="font-size:11px;color:var(--mt);">${c.role||''}${c.phone?' · '+c.phone:''}${c.email?' · '+c.email:''}</div>
                </div>
                <div style="display:flex;gap:4px;">
                  <button class="btn bxs bs" onclick="CustomerDetailPage.openAddContact(${i})">${ic('pencil',12)}</button>
                  <button class="btn bxs bd" onclick="CustomerDetailPage.removeContact(${i})">${ic('trash',12)}</button>
                </div>
              </div>`).join('')}
        </div>
      </div>`;
  },

  _tabAO(cu) {
    const aos = (state.workOrders||[]).filter(a => a.customerId === cu.id);
    if (!aos.length) return `<div class="empty"><p>Inga arbetsorder</p></div>`;
    return aos.map(ao => `
      <div class="list-item ${priorityClass(ao.priority)}"
           onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
        <div class="item-row">
          <div><div class="item-title">${ao.id} – ${ao.title}</div>
            <div class="item-sub">${ao.scheduledDate||'Ej planerad'}</div></div>
          <div style="display:flex;gap:4px;">${sbdg(ao.status)}${pbdg(ao.priority)}</div>
        </div>
      </div>`).join('');
  },

  _tabOffers(cu) {
    const offers = CustomerService.getOffers(cu.id);
    if (!offers.length) return `<div class="empty"><p>Inga offerter</p></div>`;
    return offers.map(o => {
      const total = (o.lines||[]).reduce((s,l)=>s+(l.total||0),0);
      return `<div class="list-item" onclick="Router.showPage('pg-offer-detail',{offerId:'${o.id}'})">
        <div class="item-row">
          <div><div class="item-title">${o.id}</div>
            <div class="item-sub">${fmt(total)} kr · ${fmtDate(o.createdAt)}</div></div>
          ${sbdg(o.status)}
        </div></div>`;
    }).join('');
  },

  _tabInvoices(cu) {
    const inv = (state.invoices||[]).filter(i => i.customerId === cu.id);
    if (!inv.length) return `<div class="empty"><p>Inga fakturor</p></div>`;
    return inv.map(i => {
      const t = InvoiceService.calcTotals(i);
      return `<div class="list-item" onclick="Router.showPage('pg-inv-detail',{invoiceId:'${i.id}'})">
        <div class="item-row">
          <div><div class="item-title">${i.id}</div>
            <div class="item-sub">${fkr(t.total)} · ${fmtDate(i.createdAt)}</div></div>
          ${sbdg(i.status)}
        </div></div>`;
    }).join('');
  },

  _tabSales(cu) {
    const sales = (state.salesOpportunities||[]).filter(s => s.customerId === cu.id);
    if (!sales.length) return `<div class="empty"><p>Inga säljchanser</p></div>`;
    return sales.map(s => `
      <div class="sales-card ${s.priority}">
        <div class="sales-title">${s.title}</div>
        <div class="sales-meta">${s.reason}</div>
        <div style="display:flex;gap:6px;margin-top:6px;">${sbdg(s.status)}</div>
      </div>`).join('');
  },

  _tabActivity(cu) {
    const acts = ActivityService.getByCustomer(cu.id, 20);
    return ActivityService.renderList(acts);
  },

  openAddContact(existingIdx) {
    const cu = getCu(this.customerId);
    if (!cu) return;
    const c = existingIdx !== undefined ? (cu.contacts||[])[existingIdx] : null;
    const v = (key) => c ? (c[key] || '') : '';
    Modal.open({
      title: c ? 'Redigera kontaktperson' : 'Lägg till kontaktperson',
      body: `
        <div class="fg"><label>Namn</label><input id="cc-name" value="${v('name')}" placeholder="Förnamn Efternamn"></div>
        <div class="fg"><label>Roll / Titel</label><input id="cc-role" value="${v('role')}" placeholder="T.ex. VD, Förvaltare…"></div>
        <div class="g2">
          <div class="fg"><label>Telefon</label><input id="cc-phone" type="tel" value="${v('phone')}" placeholder="070-000 00 00"></div>
          <div class="fg"><label>E-post</label><input id="cc-email" type="email" value="${v('email')}" placeholder="namn@exempel.se"></div>
        </div>
        <div class="fg">
          <label><input type="checkbox" id="cc-primary" ${v('primary')?'checked':''} style="width:16px;height:16px;margin-right:6px;">Primär kontaktperson</label>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._saveContact(existingIdx) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveContact(existingIdx) {
    const cu = getCu(this.customerId);
    if (!cu) return;
    const name = (document.getElementById('cc-name')?.value || '').trim();
    if (!name) { showToast('Namn krävs'); return; }
    const contact = {
      name,
      role:    (document.getElementById('cc-role')?.value || '').trim(),
      phone:   (document.getElementById('cc-phone')?.value || '').trim(),
      email:   (document.getElementById('cc-email')?.value || '').trim(),
      primary: document.getElementById('cc-primary')?.checked || false
    };
    cu.contacts = cu.contacts || [];
    if (existingIdx !== undefined) {
      cu.contacts[existingIdx] = contact;
    } else {
      cu.contacts.push(contact);
    }
    cu.updatedAt = new Date().toISOString();
    persist();
    Modal.close();
    this._renderFull(document.getElementById('pg-crm-detail-content'));
    showToast('Kontaktperson sparad');
  },

  removeContact(idx) {
    Modal.confirm('Ta bort kontaktperson?', () => {
      const cu = getCu(this.customerId);
      if (!cu) return;
      cu.contacts = (cu.contacts || []).filter((_, i) => i !== idx);
      cu.updatedAt = new Date().toISOString();
      persist();
      this._renderFull(document.getElementById('pg-crm-detail-content'));
      showToast('Kontaktperson borttagen');
    });
  },

  toggleInactive(id) {
    const cu = getCu(id);
    if (!cu) return;
    const activate = !!cu.inactive;
    Modal.confirm(activate ? 'Aktivera kunden?' : 'Markera kunden som inaktiv? Kunden döljs i standardlistan.', () => {
      cu.inactive = !cu.inactive;
      cu.updatedAt = new Date().toISOString();
      persist();
      this._renderFull(document.getElementById('pg-crm-detail-content'));
      showToast(activate ? 'Kund aktiverad' : 'Kund inaktiverad');
    });
  }
};
