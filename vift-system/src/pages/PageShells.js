/**
 * PageShells — Placeholder-rendering för sidor som byggs i Fas 3+
 * Fas 2-sidor (Kunder, AO, Tid, Faktura) har egna filer.
 */

/* ── Offerter ─────────────────────────── */
const OffersPage = {
  render() {
    const el = document.getElementById('pg-offer-content');
    if (!el) return;
    const offers = state.offers || [];
    el.innerHTML = offers.length === 0
      ? `<div class="empty">${ic('file-text',36)}<h3>Inga offerter</h3></div>`
      : offers.map(o => {
          const cu = getCu(o.customerId);
          const cuName = cu ? (cu.name || `${cu.firstName} ${cu.lastName}`.trim()) : '—';
          const total = (o.lines || []).reduce((s, l) => s + (l.total || 0), 0);
          return `
            <div class="list-item" onclick="Router.showPage('pg-offer-detail', {offerId: '${o.id}'})">
              <div class="item-row">
                <div>
                  <div class="item-title">${o.id} – ${cuName}</div>
                  <div class="item-sub">${fmt(total)} kr · ${fmtDate(o.createdAt)}</div>
                </div>
                ${sbdg(o.status)}
              </div>
            </div>`;
        }).join('');
  }
};

/* ── Offert-detalj ────────────────────── */
const OfferDetailPage = {
  offerId: null,

  render(params) {
    const el = document.getElementById('pg-offer-detail-content');
    if (!el) return;
    const id = params && params.offerId;
    this.offerId = id;
    const off = id ? getOff(id) : null;
    if (!off) {
      el.innerHTML = `<div class="empty">${ic('file-text',32)}<h3>Offert hittades inte</h3></div>`;
      return;
    }
    const cu = getCu(off.customerId);
    const lines = off.lines || [];
    const total = lines.reduce((s,l) => s+(l.total||0), 0);
    const exVat = total;
    const vat = Math.round(total * 0.25);
    const statusOpts = ['utkast','skickad','väntar','godkänd','nekad','utgången'];

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
        <button class="btn bs bsm" onclick="Router.back()" title="Tillbaka">${ic('arrow-left',14)}</button>
        <div style="flex:1;">
          <div style="font-size:16px;font-weight:800;">${off.id}</div>
          <div>${sbdg(off.status)}</div>
        </div>
        <select class="btn bs bsm" style="font-weight:600;" onchange="OfferDetailPage.setStatus(this.value)">
          ${statusOpts.map(s=>`<option value="${s}" ${off.status===s?'selected':''}>${statusLabel(s)}</option>`).join('')}
        </select>
      </div>

      <div class="card">
        <div class="card-header"><h3>Offereras till</h3></div>
        <div class="card-body">
          <div class="dr"><span class="dk">Kund</span><span class="dv">${cu?CustomerService.displayName(cu):'—'}</span></div>
          ${cu ? `<div class="dr"><span class="dk">Adress</span><span class="dv">${cu.address||'—'}${cu.city?', '+cu.city:''}</span></div>` : ''}
          <div class="dr"><span class="dk">Skapad</span><span class="dv">${fmtDate(off.createdAt)}</span></div>
          ${off.validUntil ? `<div class="dr"><span class="dk">Giltig till</span><span class="dv">${fmtDate(off.validUntil)}</span></div>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Offertrader</h3></div>
        ${lines.length === 0 ? '<p style="padding:12px 14px;font-size:13px;color:var(--mt);">Inga rader</p>' :
          lines.map(l => `
            <div style="padding:10px 14px;border-bottom:1px solid var(--bg);">
              <div style="font-size:13px;font-weight:700;margin-bottom:2px;">${l.description||l.text||'—'}</div>
              <div style="font-size:11px;color:var(--mt);">${l.qty||1} ${l.unit||'st'} × ${fmt(l.unitPrice||l.price||0)} kr ex moms</div>
              <div style="font-size:12px;font-weight:700;color:var(--navy);margin-top:2px;">${fmt(l.total||0)} kr ex moms</div>
            </div>`).join('')}
        <div style="padding:12px 14px;border-top:2px solid var(--br);">
          <div class="dr"><span class="dk">Summa ex. moms</span><span class="dv">${fmt(exVat)} kr</span></div>
          <div class="dr"><span class="dk">Moms 25%</span><span class="dv">${fmt(vat)} kr</span></div>
          <div class="dr" style="font-size:16px;font-weight:800;border-top:2px solid var(--br);padding-top:8px;margin-top:4px;">
            <span class="dk" style="color:var(--navy);">Totalt inkl. moms</span>
            <span class="dv" style="color:var(--navy);">${fmt(exVat + vat)} kr</span>
          </div>
        </div>
      </div>

      ${off.note ? `<div class="nbox">${off.note}</div>` : ''}

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${off.status === 'utkast' ? `<button class="btn bp bsm" onclick="OfferDetailPage.setStatus('skickad')">${ic('send',14)} Markera skickad</button>` : ''}
        ${off.status === 'väntar' || off.status === 'skickad' ? `
          <button class="btn bsu bsm" onclick="OfferDetailPage.setStatus('godkänd')">${ic('check-circle',14)} Godkänd</button>
          <button class="btn bd bsm" onclick="OfferDetailPage.setStatus('nekad')">${ic('x-circle',14)} Nekad</button>` : ''}
        ${off.status === 'godkänd' ? `<button class="btn bsu bsm" onclick="OfferDetailPage.createAO()">${ic('clipboard-list',14)} Skapa AO</button>` : ''}
      </div>`;
  },

  setStatus(status) {
    const off = getOff(this.offerId);
    if (!off) return;
    off.status = status; off.updatedAt = new Date().toISOString();
    persist();
    this.render({ offerId: this.offerId });
    showToast(`Status: ${statusLabel(status)}`);
  },

  createAO() {
    const off = getOff(this.offerId);
    if (!off) return;
    Router.showPage('pg-ao');
    setTimeout(() => WorkOrdersPage.openCreate(off.customerId || null), 100);
    showToast('Skapar arbetsorder från offert…');
  }
};

/* ── Fastigheter ──────────────────────── */
const PropertiesPage = {
  _q: '',

  render() {
    const el = document.getElementById('pg-objects-content');
    if (!el) return;
    let props = state.properties || [];
    if (this._q) {
      const q = this._q.toLowerCase();
      props = props.filter(p =>
        p.name.toLowerCase().includes(q) || (p.address||'').toLowerCase().includes(q) || (p.city||'').toLowerCase().includes(q)
      );
    }
    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
        <div class="swrap" style="flex:1;">
          <span class="sico">${ic('search',16)}</span>
          <input type="search" placeholder="Sök fastighet…" value="${this._q}"
            oninput="PropertiesPage._q=this.value;PropertiesPage.render()">
        </div>
        <button class="btn bp bsm" onclick="PropertiesPage.openCreate()">${ic('plus',14)} Ny fastighet</button>
      </div>` +
      (props.length === 0
        ? `<div class="empty">${ic('building-2',36)}<h3>Inga fastigheter</h3></div>`
        : props.map(p => {
            const cu = getCu(p.customerId);
            const cuName = cu ? CustomerService.displayName(cu) : '—';
            const aos = (state.workOrders||[]).filter(a => a.propertyId === p.id).length;
            return `
              <div class="list-item" onclick="PropertiesPage.openDetail('${p.id}')">
                <div class="item-row">
                  <div style="flex:1;min-width:0;">
                    <div class="item-title">${p.name}</div>
                    <div class="item-sub">${[p.address, p.zip, p.city].filter(Boolean).join(', ')} · ${cuName}</div>
                  </div>
                  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                    ${aos > 0 ? `<span class="bdg bdg-blue">${aos} AO</span>` : ''}
                    <span class="bdg bdg-grey" style="font-size:9px;">${p.id}</span>
                  </div>
                </div>
              </div>`;
          }).join(''));
  },

  _formHtml(p) {
    const v = (k, d='') => p ? (p[k]!=null?p[k]:d) : d;
    return `
      <div class="fg"><label>Namn / beteckning <span style="color:var(--rd)">*</span></label>
        <input id="prop-name" value="${v('name')}" placeholder="T.ex. Solvägen 1, Fastighet A…"></div>
      <div class="fg"><label>Ägare / kund</label>
        <select id="prop-cu">
          <option value="">— Välj kund —</option>
          ${(state.customers||[]).map(c=>`<option value="${c.id}" ${v('customerId')===c.id?'selected':''}>${CustomerService.displayName(c)}</option>`).join('')}
        </select></div>
      <div class="fg"><label>Gatuadress</label>
        <input id="prop-addr" value="${v('address')}" placeholder="Storgatan 1"></div>
      <div class="g2">
        <div class="fg"><label>Postnummer</label><input id="prop-zip" value="${v('zip')}" placeholder="123 45"></div>
        <div class="fg"><label>Stad</label><input id="prop-city" value="${v('city')}" placeholder="Stockholm"></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Typ</label>
          <select id="prop-type">
            ${['Flerbostadshus','Kontorsfastighet','Industrifastighet','BRF','Villa','Butiksfastighet','Lager','Övrigt'].map(t=>`<option ${v('type')===t?'selected':''}>${t}</option>`).join('')}
          </select></div>
        <div class="fg"><label>Yta (m²)</label>
          <input type="number" id="prop-area" value="${v('area',0)}" min="0" placeholder="0"></div>
      </div>
      <div class="fg"><label>Antal våningar</label>
        <input type="number" id="prop-floors" value="${v('floors',1)}" min="1" max="50"></div>
      <div class="fg"><label>Portkod / åtkomst</label>
        <input id="prop-access" value="${v('accessCode')}" placeholder="T.ex. 1234#"></div>
      <div class="fg"><label>Anteckning</label>
        <textarea id="prop-note" rows="2" placeholder="Intern anteckning…">${v('note')}</textarea></div>`;
  },

  openCreate() {
    Modal.open({
      title: 'Ny fastighet',
      wide: true,
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => PropertiesPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('prop-name')?.focus(), 80);
  },

  openDetail(propId) {
    Router.showPage('pg-obj-detail', { propId });
  },

  openEdit(propId) {
    const p = (state.properties||[]).find(x=>x.id===propId);
    if (!p) return;
    Modal.open({
      title: `Redigera ${p.name}`,
      wide: true,
      body: this._formHtml(p),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => PropertiesPage._save(propId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _save(propId) {
    const name = document.getElementById('prop-name')?.value.trim();
    if (!name) { showToast('Namn krävs'); return; }
    const data = {
      name,
      customerId: document.getElementById('prop-cu')?.value || '',
      address:    document.getElementById('prop-addr')?.value.trim() || '',
      zip:        document.getElementById('prop-zip')?.value.trim() || '',
      city:       document.getElementById('prop-city')?.value.trim() || '',
      type:       document.getElementById('prop-type')?.value || '',
      area:       parseFloat(document.getElementById('prop-area')?.value) || 0,
      floors:     parseInt(document.getElementById('prop-floors')?.value) || 1,
      accessCode: document.getElementById('prop-access')?.value.trim() || '',
      note:       document.getElementById('prop-note')?.value.trim() || '',
      updatedAt:  new Date().toISOString()
    };
    if (!propId) {
      state.properties = state.properties || [];
      state.properties.push({ ...data, id: newId(state.properties,'OBJ'), createdAt: new Date().toISOString() });
      showToast(`${name} skapad`);
    } else {
      const idx = (state.properties||[]).findIndex(x=>x.id===propId);
      if (idx < 0) return;
      state.properties[idx] = { ...state.properties[idx], ...data };
      showToast('Fastighet uppdaterad');
    }
    persist(); Modal.close(); this.render();
  }
};

/* ── Artiklar ─────────────────────────── */
const ArticlesPage = {
  _filter: 'alla',
  _q: '',

  render() {
    const el = document.getElementById('pg-articles-content');
    if (!el) return;
    const cats = ['alla','kemikalier','material','forbruk','arbete','kostnad'];
    const catLabels = { alla:'Alla', kemikalier:'Kemikalier', material:'Byggmaterial', forbruk:'Förbrukning', arbete:'Arbete', kostnad:'Kostnader' };
    let arts = state.articles || [];
    if (this._filter !== 'alla') arts = arts.filter(a => a.category === this._filter);
    if (this._q) {
      const q = this._q.toLowerCase();
      arts = arts.filter(a => a.name.toLowerCase().includes(q) || (a.articleNumber||'').includes(q));
    }
    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
        <div class="swrap" style="flex:1;">
          <span class="sico">${ic('search',16)}</span>
          <input type="search" placeholder="Sök artikel, artnr…" value="${this._q}"
            oninput="ArticlesPage._q=this.value;ArticlesPage.render()">
        </div>
        <button class="btn bp bsm" onclick="ArticlesPage.openCreate()">${ic('plus',14)} Ny artikel</button>
      </div>
      <div class="ftabs" style="margin-bottom:4px;">
        ${cats.map(c=>`<button class="ft ${this._filter===c?'on':''}" onclick="ArticlesPage._filter='${c}';ArticlesPage.render()">${catLabels[c]}</button>`).join('')}
      </div>
      ${arts.length === 0
        ? `<div class="empty">${ic('package',32)}<h3>Inga artiklar</h3></div>`
        : arts.map(a => `
          <div class="list-item" onclick="ArticlesPage.openEdit('${a.id}')">
            <div class="item-row">
              <div style="flex:1;min-width:0;">
                <div class="item-title">${a.articleNumber ? a.articleNumber+' – ':'' }${a.name}</div>
                <div class="item-sub">Ink: ${fmt(a.buyPrice)} kr · Pris: ${fmt(a.sellPrice)} kr/${a.unit} · Moms ${a.vatRate||25}%</div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                <span class="bdg ${a.active!==false?'bdg-green':'bdg-grey'}">${a.active!==false?'Aktiv':'Inaktiv'}</span>
                <span class="bdg bdg-sky" style="font-size:9px;">${catLabels[a.category]||a.category}</span>
              </div>
            </div>
          </div>`).join('')}`;
  },

  _formHtml(a) {
    const catLabels = { kemikalier:'Kemikalier', material:'Byggmaterial', forbruk:'Förbrukning', arbete:'Arbete', kostnad:'Kostnader' };
    return `
      <div class="g2">
        <div class="fg"><label>Artikelnummer</label>
          <input id="art-num" value="${a?a.articleNumber||'':''}" placeholder="T.ex. 1001"></div>
        <div class="fg"><label>Kategori</label>
          <select id="art-cat">
            ${Object.entries(catLabels).map(([v,l])=>`<option value="${v}" ${a&&a.category===v?'selected':''}>${l}</option>`).join('')}
          </select></div>
      </div>
      <div class="fg"><label>Benämning <span style="color:var(--rd)">*</span></label>
        <input id="art-name" value="${a?a.name||'':''}" placeholder="T.ex. Fogmassa Sikaflex 291i"></div>
      <div class="g2">
        <div class="fg"><label>Enhet</label>
          <select id="art-unit">${unitsHtml(a?a.unit:'st')}</select></div>
        <div class="fg"><label>Momssats</label>
          <select id="art-vat">
            ${[0,6,12,25].map(r=>`<option value="${r}" ${a&&a.vatRate===r?'selected':r===25?'selected':''} >${r}%</option>`).join('')}
          </select></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Inköpspris (kr/enhet)</label>
          <input type="number" id="art-buy" value="${a?a.buyPrice||0:0}" min="0" placeholder="0"></div>
        <div class="fg"><label>Försäljningspris ex moms (kr/enhet)</label>
          <input type="number" id="art-sell" value="${a?a.sellPrice||0:0}" min="0" placeholder="0"></div>
      </div>`;
  },

  openCreate() {
    if (!Auth.require('article_manage')) return;
    Modal.open({
      title: 'Ny artikel',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => ArticlesPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('art-name')?.focus(), 80);
  },

  openEdit(artId) {
    const a = (state.articles||[]).find(x=>x.id===artId);
    if (!a) return;
    Modal.open({
      title: a.name,
      wide: true,
      body: this._formHtml(a),
      buttons: [
        { label: a.active!==false ? `${ic('eye-off',13)} Inaktivera` : `${ic('eye',13)} Aktivera`,
          cls: 'btn bw', onClick: () => ArticlesPage._toggleActive(artId) },
        { label: 'Spara', cls: 'btn bp', onClick: () => ArticlesPage._save(artId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _save(artId) {
    const name = document.getElementById('art-name')?.value.trim();
    if (!name) { showToast('Benämning krävs'); return; }
    const data = {
      articleNumber: document.getElementById('art-num')?.value.trim() || '',
      name,
      category: document.getElementById('art-cat')?.value || 'material',
      unit:     document.getElementById('art-unit')?.value || 'st',
      vatRate:  parseInt(document.getElementById('art-vat')?.value) || 25,
      buyPrice: parseFloat(document.getElementById('art-buy')?.value) || 0,
      sellPrice:parseFloat(document.getElementById('art-sell')?.value) || 0,
      updatedAt: new Date().toISOString()
    };
    if (!artId) {
      state.articles.push({ ...data, id: newId(state.articles,'ART'), active: true, createdAt: new Date().toISOString() });
      showToast(`${name} skapad`);
    } else {
      const idx = (state.articles||[]).findIndex(a=>a.id===artId);
      if (idx < 0) return;
      state.articles[idx] = { ...state.articles[idx], ...data };
      showToast('Artikel uppdaterad');
    }
    persist(); Modal.close(); this.render();
  },

  _toggleActive(artId) {
    const idx = (state.articles||[]).findIndex(a=>a.id===artId);
    if (idx < 0) return;
    state.articles[idx] = { ...state.articles[idx], active: !state.articles[idx].active, updatedAt: new Date().toISOString() };
    persist(); Modal.close();
    showToast(state.articles[idx].active ? 'Aktiverad' : 'Inaktiverad');
    this.render();
  }
};

/* ── Prisgrupper ──────────────────────── */
const PriceGroupsPage = {
  render() {
    const el = document.getElementById('pg-pricegroups-content');
    if (!el) return;
    const pgs = state.priceGroups || [];
    el.innerHTML =
      `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
         <h3 style="flex:1;font-size:14px;font-weight:700;">Prisgrupper</h3>
         <button class="btn bp bsm" onclick="PriceGroupsPage.openCreate()">${ic('plus',14)} Ny prisgrupp</button>
       </div>` +
      (pgs.length === 0
        ? `<div class="empty">${ic('dollar-sign',36)}<h3>Inga prisgrupper</h3></div>`
        : pgs.map(pg => `
          <div class="list-item" onclick="PriceGroupsPage.openEdit('${pg.id}')">
            <div class="item-row">
              <div>
                <div class="item-title">${pg.name}</div>
                <div class="item-sub">${fmt(pg.hourRate)} kr/tim${pg.description ? ' · ' + pg.description : ''}</div>
              </div>
              <span class="bdg ${pg.active ? 'bdg-green' : 'bdg-grey'}">${pg.active ? 'Aktiv' : 'Inaktiv'}</span>
            </div>
          </div>`).join(''));
  },

  _formHtml(pg) {
    return `
      <div class="fg"><label>Namn <span style="color:var(--rd)">*</span></label>
        <input id="pg-name" value="${pg?pg.name||'':''}" placeholder="T.ex. Standard, Jour, Övertid"></div>
      <div class="fg"><label>Timpris ex moms (kr/tim)</label>
        <input type="number" id="pg-rate" value="${pg?pg.hourRate||0:0}" min="0"></div>
      <div class="fg"><label>Beskrivning</label>
        <input id="pg-desc" value="${pg?pg.description||'':''}" placeholder="Valfri beskrivning"></div>`;
  },

  openCreate() {
    if (!Auth.require('article_manage')) return;
    Modal.open({
      title: 'Ny prisgrupp',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => PriceGroupsPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('pg-name')?.focus(), 80);
  },

  openEdit(pgId) {
    const pg = (state.priceGroups||[]).find(x=>x.id===pgId);
    if (!pg) return;
    Modal.open({
      title: pg.name,
      body: this._formHtml(pg),
      buttons: [
        { label: pg.active ? `${ic('eye-off',13)} Inaktivera` : `${ic('eye',13)} Aktivera`, cls: 'btn bw',
          onClick: () => { const idx=(state.priceGroups||[]).findIndex(x=>x.id===pgId); if(idx<0)return; state.priceGroups[idx].active=!state.priceGroups[idx].active; persist();Modal.close();PriceGroupsPage.render();showToast(state.priceGroups[idx].active?'Aktiverad':'Inaktiverad'); }},
        { label: 'Spara', cls: 'btn bp', onClick: () => PriceGroupsPage._save(pgId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _save(pgId) {
    const name = document.getElementById('pg-name')?.value.trim();
    if (!name) { showToast('Namn krävs'); return; }
    const data = {
      name,
      hourRate: parseFloat(document.getElementById('pg-rate')?.value) || 0,
      description: document.getElementById('pg-desc')?.value.trim() || '',
      updatedAt: new Date().toISOString()
    };
    if (!pgId) {
      state.priceGroups = state.priceGroups || [];
      state.priceGroups.push({ ...data, id: newId(state.priceGroups,'PG'), active: true, createdAt: new Date().toISOString() });
      showToast(`${name} skapad`);
    } else {
      const idx = (state.priceGroups||[]).findIndex(x=>x.id===pgId);
      if (idx < 0) return;
      state.priceGroups[idx] = { ...state.priceGroups[idx], ...data };
      showToast('Prisgrupp uppdaterad');
    }
    persist(); Modal.close(); this.render();
  }
};

/* ── Personal ─────────────────────────── */
const StaffPage = {
  _filter: 'aktiva',

  render() {
    const el = document.getElementById('pg-staff-content');
    if (!el) return;
    const all     = state.staff || [];
    const aktiva  = all.filter(s => s.active);
    const inaktiva = all.filter(s => !s.active);
    const list    = this._filter === 'aktiva' ? aktiva : inaktiva;
    const roleColor = (rid) => ({ admin:'bdg-red', chef:'bdg-orange', personal:'bdg-blue' }[rid] || 'bdg-grey');
    const roleLabel = (rid) => { const r = (state.roles||[]).find(x=>x.id===rid); return r ? r.label : (rid || '—'); };

    el.innerHTML =
      `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
         <div class="ftabs" style="flex:1;margin-bottom:0;">
           <button class="ft ${this._filter==='aktiva'?'on':''}" onclick="StaffPage._filter='aktiva';StaffPage.render()">Aktiva (${aktiva.length})</button>
           <button class="ft ${this._filter==='inaktiva'?'on':''}" onclick="StaffPage._filter='inaktiva';StaffPage.render()">Inaktiva (${inaktiva.length})</button>
         </div>
         <button class="btn bp bsm" onclick="StaffPage.openCreate()">${ic('plus',14)} Ny personal</button>
       </div>` +
      (list.length === 0
        ? `<div class="empty">${ic('users',32)}<h3>Inga ${this._filter} medarbetare</h3></div>`
        : list.map(s => `
          <div class="list-item" onclick="StaffPage.openEdit('${s.id}')">
            <div class="item-row">
              <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:38px;height:38px;border-radius:50%;background:var(--acc);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:var(--navy);flex-shrink:0;">${(s.firstName||'?').charAt(0)}${(s.lastName||'').charAt(0)}</div>
                <div>
                  <div class="item-title">${s.firstName} ${s.lastName}</div>
                  <div class="item-sub">${s.title||'—'}${s.phone?' · '+s.phone:''}</div>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                <span class="bdg ${roleColor(s.role)}">${roleLabel(s.role)}</span>
                <span style="font-size:10px;color:var(--mt);">${s.email||''}</span>
              </div>
            </div>
          </div>`).join('')
      );
  },

  _formHtml(s) {
    const allRoles = state.roles || [];
    const activeRoles = allRoles.filter(r => r.active !== false);
    const fallbackRoles = [
      { id:'personal', label:'Tekniker / Personal', description:'', active:true },
      { id:'chef',     label:'Chef / Projektledare', description:'', active:true },
      { id:'admin',    label:'Admin', description:'', active:true }
    ];
    const displayRoles = activeRoles.length ? activeRoles : fallbackRoles;
    const activeTitles = (state.titles||[]).filter(t => t.active !== false);
    return `
      <div class="g2">
        <div class="fg"><label>Förnamn <span style="color:var(--rd)">*</span></label>
          <input id="sf-first" value="${s?s.firstName:''}" placeholder="Förnamn" autocomplete="off"></div>
        <div class="fg"><label>Efternamn <span style="color:var(--rd)">*</span></label>
          <input id="sf-last" value="${s?s.lastName:''}" placeholder="Efternamn" autocomplete="off"></div>
      </div>
      <div class="fg"><label>Titel / yrkesroll</label>
        ${activeTitles.length > 0 ? `
          <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
            <div id="sf-title-display" style="flex:1;">
              ${s && s.title
                ? `<span class="chip on">${s.title}</span>`
                : '<span style="font-size:12px;color:var(--mt);">Ingen titel vald</span>'}
            </div>
            <button type="button" class="btn bs bsm" onclick="StaffPage._openTitlePicker()">
              ${ic('list',13)} Välj titel
            </button>
          </div>
          <input type="hidden" id="sf-title" value="${s?s.title||'':''}">
          ${s && s.title && !activeTitles.some(t => t.name === s.title)
            ? `<div class="nbox" style="margin-top:4px;font-size:11px;">⚠ "${s.title}" finns inte bland aktiva titlar</div>`
            : ''}` :
          `<div class="nbox" style="font-size:12px;">Inga aktiva titlar. <button type="button" class="btn bghost bxs" style="margin-left:4px;" onclick="Modal.close();Router.showPage('pg-admin')">Gå till Admin ${ic('arrow-right',10)}</button></div>
          <input type="hidden" id="sf-title" value="${s?s.title||'':''}">`
        }</div>
      <div class="g2">
        <div class="fg"><label>Telefon</label>
          <input id="sf-phone" value="${s?s.phone||'':''}" placeholder="070-XXX XX XX" type="tel"></div>
        <div class="fg"><label>E-post</label>
          <input id="sf-email" value="${s?s.email||'':''}" placeholder="namn@vift.se" type="email"></div>
      </div>
      <div style="border-top:1px solid var(--br);margin:4px 0;"></div>
      <div class="fg"><label>Användarnamn <span style="color:var(--rd)">*</span></label>
        <input id="sf-uname" value="${s?s.username||'':''}" placeholder="användarnamn" autocomplete="off"></div>
      <div class="fg"><label>Roll / behörighet</label>
        <input type="hidden" id="sf-role" value="${s?s.role||'personal':'personal'}">
        <div style="display:flex;flex-direction:column;gap:5px;margin-top:4px;">
          ${displayRoles.map(r => {
            const isSel = s ? s.role === r.id : r.id === 'personal';
            return `<div onclick="StaffPage._selectRole('${r.id}')" id="sf-role-opt-${r.id}"
              style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1.5px solid ${isSel?'var(--sky)':'var(--br)'};border-radius:var(--rs);cursor:pointer;transition:border-color .1s;">
              <div id="sf-role-dot-${r.id}" style="width:16px;height:16px;border-radius:50%;border:2px solid ${isSel?'var(--navy)':'var(--br)'};background:${isSel?'var(--navy)':'transparent'};flex-shrink:0;transition:all .1s;"></div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;">${r.label}</div>
                ${r.description?`<div style="font-size:11px;color:var(--mt);">${r.description}</div>`:''}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      ${s ? `
      <div class="fg"><label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13px;font-weight:600;letter-spacing:0;cursor:pointer;">
        <input type="checkbox" id="sf-change-pw" onchange="document.getElementById('sf-pw-wrap').style.display=this.checked?'':'none'">
        Ändra lösenord
      </label></div>
      <div id="sf-pw-wrap" style="display:none;">
        <div class="fg"><label>Nytt lösenord</label>
          <input type="password" id="sf-pw" placeholder="Minst 4 tecken" autocomplete="new-password"></div>
      </div>` : `
      <div class="fg"><label>Lösenord <span style="color:var(--rd)">*</span></label>
        <input type="password" id="sf-pw" placeholder="Minst 4 tecken" autocomplete="new-password"></div>`}`;
  },

  _openTitlePicker() {
    const titles = (state.titles || []).filter(t => t.active !== false);
    if (titles.length === 0) { showToast('Inga aktiva titlar. Gå till Admin → Titlar.'); return; }
    Modal.open({
      title: 'Välj titel',
      body: `
        <div class="fg" style="margin-bottom:8px;">
          <input id="tp-search" placeholder="Sök titel…" autocomplete="off"
            oninput="document.getElementById('tp-list').innerHTML=StaffPage._titlePickerItems(this.value)">
        </div>
        <div id="tp-list" style="max-height:280px;overflow-y:auto;">
          ${this._titlePickerItems('')}
        </div>`,
      buttons: [
        { label: 'Rensa val', cls: 'btn bw', onClick: () => StaffPage._selectTitleFromPicker('') },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('tp-search')?.focus(), 80);
  },

  _titlePickerItems(q) {
    const titles = (state.titles || []).filter(t => t.active !== false);
    const cur = document.getElementById('sf-title')?.value || '';
    const filtered = q ? titles.filter(t => t.name.toLowerCase().includes(q.toLowerCase())) : titles;
    if (!filtered.length) return '<p style="font-size:12px;color:var(--mt);padding:8px 0;">Inga aktiva titlar matchar</p>';
    return filtered.map(t => {
      const isSel = cur === t.name;
      const usageCount = (state.staff||[]).filter(s => s.title === t.name).length;
      return `<div class="crow" onclick="StaffPage._selectTitleFromPicker('${t.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')"
        style="${isSel?'background:var(--navy10,#eef2ff);':''};cursor:pointer;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${t.name}</div>
          ${t.description ? `<div style="font-size:11px;color:var(--mt);">${t.description}</div>` : ''}
          ${usageCount > 0 ? `<div style="font-size:10px;color:var(--sky);">${usageCount} person${usageCount===1?'':'er'}</div>` : ''}
        </div>
        ${isSel ? `<span style="color:var(--grn);">${ic('check-circle',16)}</span>` : ''}
      </div>`;
    }).join('');
  },

  _selectTitleFromPicker(title) {
    const inp = document.getElementById('sf-title');
    if (inp) inp.value = title;
    const display = document.getElementById('sf-title-display');
    if (display) {
      display.innerHTML = title
        ? `<span class="chip on">${title}</span>`
        : '<span style="font-size:12px;color:var(--mt);">Ingen titel vald</span>';
    }
    Modal.close();
  },

  _selectRole(roleId) {
    document.getElementById('sf-role').value = roleId;
    const roles = (state.roles && state.roles.length
      ? state.roles.filter(r => r.active !== false)
      : [{ id:'personal' }, { id:'chef' }, { id:'admin' }]);
    roles.forEach(r => {
      const opt = document.getElementById('sf-role-opt-' + r.id);
      const dot = document.getElementById('sf-role-dot-' + r.id);
      const isSel = r.id === roleId;
      if (opt) opt.style.borderColor = isSel ? 'var(--sky)' : 'var(--br)';
      if (dot) {
        dot.style.borderColor = isSel ? 'var(--navy)' : 'var(--br)';
        dot.style.background  = isSel ? 'var(--navy)' : 'transparent';
      }
    });
  },

  openCreate() {
    if (!Auth.require('staff_manage')) return;
    Modal.open({
      title: 'Ny personal',
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => StaffPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => { document.getElementById('sf-first')?.focus(); }, 80);
  },

  openEdit(staffId) {
    if (!Auth.require('staff_manage')) return;
    const s = (state.staff||[]).find(x => x.id === staffId);
    if (!s) return;
    Modal.open({
      title: `${s.firstName} ${s.lastName}`,
      wide: true,
      body: this._formHtml(s),
      buttons: [
        { label: s.active ? `${ic('user-x',13)} Inaktivera` : `${ic('user-check',13)} Aktivera`,
          cls: s.active ? 'btn bw' : 'btn bsu',
          onClick: () => StaffPage._toggleActive(staffId) },
        { label: 'Spara', cls: 'btn bp', onClick: () => StaffPage._save(staffId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => { document.getElementById('sf-first')?.focus(); }, 80);
  },

  _save(staffId) {
    const first = document.getElementById('sf-first')?.value.trim();
    const last  = document.getElementById('sf-last')?.value.trim();
    const uname = document.getElementById('sf-uname')?.value.trim();
    if (!first || !last) { showToast('Förnamn och efternamn krävs'); return; }
    if (!uname)          { showToast('Användarnamn krävs'); return; }

    const data = {
      firstName: first, lastName: last,
      title:  document.getElementById('sf-title')?.value.trim() || '',
      phone:  document.getElementById('sf-phone')?.value.trim() || '',
      email:  document.getElementById('sf-email')?.value.trim() || '',
      username: uname,
      role: document.getElementById('sf-role')?.value || 'personal',
      updatedAt: new Date().toISOString()
    };

    if (!staffId) {
      const pw = document.getElementById('sf-pw')?.value || '';
      if (!pw || pw.length < 4) { showToast('Lösenord krävs (minst 4 tecken)'); return; }
      if ((state.staff||[]).find(s => s.username === uname)) { showToast('Användarnamnet används redan'); return; }
      state.staff.push({ ...data, id: newId(state.staff||[], 'ST'), password: pw, permissions: [], active: true, createdAt: new Date().toISOString() });
      persist(); Modal.close(); showToast(`${first} ${last} skapad`);
    } else {
      const idx = (state.staff||[]).findIndex(s => s.id === staffId);
      if (idx < 0) return;
      if ((state.staff||[]).find(s => s.username === uname && s.id !== staffId)) { showToast('Användarnamnet används redan'); return; }
      const changePw = document.getElementById('sf-change-pw');
      if (changePw?.checked) {
        const pw = document.getElementById('sf-pw')?.value || '';
        if (!pw || pw.length < 4) { showToast('Lösenord krävs (minst 4 tecken)'); return; }
        data.password = pw;
      }
      state.staff[idx] = { ...state.staff[idx], ...data };
      persist(); Modal.close(); showToast('Sparat');
    }
    this.render();
  },

  _toggleActive(staffId) {
    const idx = (state.staff||[]).findIndex(s => s.id === staffId);
    if (idx < 0) return;
    state.staff[idx] = { ...state.staff[idx], active: !state.staff[idx].active, updatedAt: new Date().toISOString() };
    persist(); Modal.close();
    showToast(state.staff[idx].active ? 'Aktiverad' : 'Inaktiverad');
    this.render();
  }
};

/* ── Admin ────────────────────────────── */
const AdminPage = {
  _titleQ: '',

  render() {
    const el = document.getElementById('pg-admin-content');
    if (!el) return;
    const s = state.settings || {};
    const allTitles = state.titles || [];
    const titles = this._titleQ
      ? allTitles.filter(t => typeof t === 'object' && t.name && t.name.toLowerCase().includes(this._titleQ.toLowerCase()))
      : allTitles;

    el.innerHTML = `
      <!-- Företagsinformation -->
      <div class="card">
        <div class="card-header">
          <h3>Företagsinformation</h3>
          <button class="btn bs bxs" onclick="AdminPage.openEditCompany()">${ic('pencil',13)} Redigera</button>
        </div>
        <div class="card-body">
          <div class="dr"><span class="dk">Företag</span><span class="dv">${s.companyName || '—'}</span></div>
          <div class="dr"><span class="dk">Telefon</span><span class="dv">${s.companyPhone || '—'}</span></div>
          <div class="dr"><span class="dk">E-post</span><span class="dv">${s.companyEmail || '—'}</span></div>
          <div class="dr"><span class="dk">Adress</span><span class="dv">${s.companyAddress || '—'}</span></div>
          <div class="dr"><span class="dk">Org.nr</span><span class="dv">${s.orgNr || '—'}</span></div>
          <div class="dr"><span class="dk">Moms-nr</span><span class="dv">${s.vatNr || '—'}</span></div>
        </div>
      </div>

      <!-- Titlar / yrkesroller -->
      <div class="card">
        <div class="card-header">
          <h3>Titlar / yrkesroller</h3>
          <button class="btn bp bxs" onclick="AdminPage.openAddTitle()">${ic('plus',13)} Lägg till</button>
        </div>
        <div style="padding:8px 14px 4px;border-bottom:1px solid var(--br);">
          <div class="swrap">
            <span class="sico">${ic('search',14)}</span>
            <input type="search" placeholder="Sök titel…" value="${this._titleQ}"
              oninput="AdminPage._titleQ=this.value;AdminPage.render()" style="font-size:12px;">
          </div>
        </div>
        <div class="card-body" style="padding:4px 14px;">
          ${allTitles.length === 0
            ? '<p style="font-size:12px;color:var(--mt);padding:6px 0;">Inga titlar registrerade</p>'
            : titles.length === 0
              ? `<p style="font-size:12px;color:var(--mt);padding:6px 0;">Ingen titel matchar "${this._titleQ}"</p>`
              : titles.map(t => {
                  const origIdx = allTitles.findIndex(x => x.id === t.id);
                  const usageCount = (state.staff||[]).filter(s => s.title === t.name).length;
                  return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--bg);">
                    <div style="flex:1;min-width:0;">
                      <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:13px;font-weight:600;">${t.name}</span>
                        <span class="bdg ${t.active?'bdg-green':'bdg-grey'}" style="font-size:9px;">${t.active?'Aktiv':'Inaktiv'}</span>
                      </div>
                      ${t.description ? `<div style="font-size:11px;color:var(--mt);">${t.description}</div>` : ''}
                      ${usageCount > 0
                        ? `<div style="font-size:10px;color:var(--sky);cursor:pointer;" onclick="AdminPage.showTitleStaff('${t.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')">
                            ${usageCount} person${usageCount===1?'':'er'} – Visa ${ic('arrow-right',9)}
                          </div>`
                        : '<div style="font-size:10px;color:var(--mt);">Ej använd</div>'}
                    </div>
                    <button class="btn bxs bs" onclick="AdminPage.openEditTitle(${origIdx})">${ic('pencil',11)}</button>
                    <button class="btn bxs ${t.active?'bw':'bsu'}" onclick="AdminPage.toggleTitleActive(${origIdx})"
                      style="font-size:10px;">${t.active?ic('eye-off',11):ic('eye',11)}</button>
                    <button class="btn bxs bd" onclick="AdminPage.removeTitle(${origIdx})"
                      ${usageCount>0?`title="Används av ${usageCount} person(er)"`:''}>${ic('trash',11)}</button>
                  </div>`;
                }).join('')
          }
        </div>
      </div>

      <!-- Roller & behörigheter -->
      <div class="card">
        <div class="card-header">
          <h3>Roller & behörigheter</h3>
          <button class="btn bp bxs" onclick="AdminPage.openAddRole()">${ic('plus',13)} Ny roll</button>
        </div>
        <div class="card-body" style="padding:4px 14px;">
          ${(state.roles||[]).length === 0
            ? '<p style="font-size:12px;color:var(--mt);padding:6px 0;">Inga roller definierade</p>'
            : (state.roles||[]).map(r => {
                const permCount  = (r.permissions||[]).length;
                const staffCount = (state.staff||[]).filter(s=>s.role===r.id).length;
                const isActive   = r.active !== false;
                return `<div style="padding:9px 0;border-bottom:1px solid var(--bg);display:flex;align-items:flex-start;gap:8px;${isActive?'':'opacity:.65'}">
                  <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;flex-wrap:wrap;">
                      <span style="font-size:13px;font-weight:700;">${r.label}</span>
                      <span class="bdg ${isActive?'bdg-green':'bdg-grey'}" style="font-size:9px;">${isActive?'Aktiv':'Inaktiv'}</span>
                      ${r.isBuiltin?`<span class="bdg bdg-grey" style="font-size:9px;">Inbyggd</span>`:''}
                      ${staffCount>0?`<span class="bdg bdg-blue" style="font-size:9px;cursor:pointer;" onclick="AdminPage.showRoleStaff('${r.id}')">${staffCount} pers.</span>`:''}
                    </div>
                    ${r.description?`<div style="font-size:11px;color:var(--mt);">${r.description}</div>`:''}
                    <div style="font-size:10px;color:var(--sky);margin-top:2px;">${permCount===0?'Inga behörigheter':permCount+' behörighet'+(permCount===1?'':'er')+(r.permissions&&r.permissions.includes('all')?' (superadmin)':'')}</div>
                  </div>
                  <div style="display:flex;gap:4px;flex-shrink:0;">
                    <button class="btn bxs bs" onclick="AdminPage.openEditRole('${r.id}')">${ic('pencil',11)}</button>
                    <button class="btn bxs ${isActive?'bw':'bsu'}" onclick="AdminPage.toggleRoleActive('${r.id}')"
                      title="${isActive?'Inaktivera':'Aktivera'}" style="font-size:10px;">${isActive?ic('eye-off',11):ic('eye',11)}</button>
                    ${!r.isBuiltin?`<button class="btn bxs bd" onclick="AdminPage.removeRole('${r.id}')">${ic('trash',11)}</button>`:''}
                  </div>
                </div>`;
              }).join('')
          }
        </div>
      </div>

      <!-- Register-shortcuts -->
      <div class="card">
        <div class="card-header"><h3>Register</h3></div>
        <div class="card-body">
          <div class="dr">
            <span class="dk">${ic('users',13)} Personal</span>
            <span class="dv"><button class="btn bs bxs" onclick="Router.showPage('pg-staff')">${(state.staff||[]).filter(s=>s.active).length} aktiva – Hantera ${ic('arrow-right',12)}</button></span>
          </div>
          <div class="dr">
            <span class="dk">${ic('package',13)} Artiklar</span>
            <span class="dv"><button class="btn bs bxs" onclick="Router.showPage('pg-articles')">${(state.articles||[]).filter(a=>a.active!==false).length} aktiva – Hantera ${ic('arrow-right',12)}</button></span>
          </div>
          <div class="dr">
            <span class="dk">${ic('dollar-sign',13)} Prisgrupper</span>
            <span class="dv"><button class="btn bs bxs" onclick="Router.showPage('pg-pricegroups')">${(state.priceGroups||[]).filter(p=>p.active).length} aktiva – Hantera ${ic('arrow-right',12)}</button></span>
          </div>
        </div>
      </div>

      <!-- Systemdata -->
      <div class="card">
        <div class="card-header"><h3>Systemöversikt</h3></div>
        <div class="card-body">
          <div class="dr"><span class="dk">Kunder</span><span class="dv">${(state.customers||[]).length} st</span></div>
          <div class="dr"><span class="dk">Arbetsorder</span><span class="dv">${(state.workOrders||[]).length} st</span></div>
          <div class="dr"><span class="dk">Offerter</span><span class="dv">${(state.offers||[]).length} st</span></div>
          <div class="dr"><span class="dk">Fakturor</span><span class="dv">${(state.invoices||[]).length} st</span></div>
          <div class="dr"><span class="dk">Återkommande</span><span class="dv">${(state.recurringOrders||[]).length} st</span></div>
          <div class="dr"><span class="dk">Tidsposter</span><span class="dv">${(state.timeEntries||[]).length} st</span></div>
          <div class="dr"><span class="dk">Aktivitetslogg</span><span class="dv">${(state.activityLog||[]).length} poster</span></div>
        </div>
      </div>

      <!-- Rensa testdata -->
      <div class="card">
        <div class="card-header"><h3>Demodata & återställning</h3></div>
        <div class="card-body">
          <p style="font-size:12px;color:var(--mt);margin-bottom:8px;">Rensa localStorage och ladda om demodata. Återställer allt till startläget.</p>
          <button class="btn bd bsm" onclick="if(confirm('Rensa all data och återgå till demodata?')){localStorage.clear();location.reload();}">${ic('trash',13)} Återställ demodata</button>
        </div>
      </div>`;
  },

  openEditCompany() {
    if (!Auth.require('admin_manage')) return;
    const s = state.settings || {};
    Modal.open({
      title: 'Företagsinformation',
      body: `
        <div class="fg"><label>Företagsnamn</label><input id="co-name" value="${s.companyName||''}"></div>
        <div class="g2">
          <div class="fg"><label>Telefon</label><input id="co-phone" value="${s.companyPhone||''}" type="tel"></div>
          <div class="fg"><label>E-post</label><input id="co-email" value="${s.companyEmail||''}" type="email"></div>
        </div>
        <div class="fg"><label>Adress</label><input id="co-addr" value="${s.companyAddress||''}"></div>
        <div class="g2">
          <div class="fg"><label>Org.nr</label><input id="co-orgnr" value="${s.orgNr||''}"></div>
          <div class="fg"><label>Moms-nr</label><input id="co-vatnr" value="${s.vatNr||''}"></div>
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          state.settings = {
            ...state.settings,
            companyName:    document.getElementById('co-name')?.value.trim()  || s.companyName,
            companyPhone:   document.getElementById('co-phone')?.value.trim() || '',
            companyEmail:   document.getElementById('co-email')?.value.trim() || '',
            companyAddress: document.getElementById('co-addr')?.value.trim()  || '',
            orgNr:          document.getElementById('co-orgnr')?.value.trim() || '',
            vatNr:          document.getElementById('co-vatnr')?.value.trim() || ''
          };
          persist(); Modal.close(); AdminPage.render(); showToast('Sparat');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  showRoleStaff(roleId) {
    const role = (state.roles||[]).find(r => r.id === roleId);
    const staffList = (state.staff||[]).filter(s => s.role === roleId);
    if (!staffList.length) { showToast('Ingen personal med denna roll'); return; }
    Modal.open({
      title: `Personal med roll: ${role ? role.label : roleId}`,
      body: staffList.map(s => `
        <div class="crow">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${s.firstName} ${s.lastName}</div>
            <div style="font-size:11px;color:var(--mt);">${s.title||''} ${s.email?'· '+s.email:''}</div>
          </div>
          <span class="bdg ${s.active?'bdg-green':'bdg-grey'}">${s.active?'Aktiv':'Inaktiv'}</span>
        </div>`).join(''),
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  toggleRoleActive(roleId) {
    const r = (state.roles||[]).find(x => x.id === roleId);
    if (!r) return;
    // Guard: don't deactivate the last active admin-level role
    if (r.active !== false) {
      const activeAdmins = (state.roles||[]).filter(x => x.active !== false && (x.permissions||[]).includes('all'));
      if (activeAdmins.length <= 1 && (r.permissions||[]).includes('all')) {
        showToast('Kan inte inaktivera – det finns bara en admin-roll'); return;
      }
    }
    r.active = r.active === false ? true : false;
    persist(); AdminPage.render(); showToast(r.active ? 'Roll aktiverad' : 'Roll inaktiverad');
  },

  showTitleStaff(title) {
    const staffWithTitle = (state.staff||[]).filter(s => s.title === title);
    if (!staffWithTitle.length) { showToast('Ingen personal med denna titel'); return; }
    Modal.open({
      title: `Personal med titel: ${title}`,
      body: staffWithTitle.map(s => `
        <div class="crow" onclick="Modal.close();Router.showPage('pg-staff')">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${s.firstName} ${s.lastName}</div>
            <div style="font-size:11px;color:var(--mt);">${s.email||''}</div>
          </div>
          <span class="bdg ${s.active?'bdg-green':'bdg-grey'}">${s.active?'Aktiv':'Inaktiv'}</span>
        </div>`).join(''),
      buttons: [{ label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  openAddTitle() {
    if (!Auth.require('admin_manage')) return;
    Modal.open({
      title: 'Lägg till titel',
      body: `
        <div class="fg"><label>Titel / yrkesroll <span style="color:var(--rd)">*</span></label>
          <input id="adm-title" placeholder="T.ex. Låssmed, VVS-tekniker…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('adm-title-desc')?.focus();}"></div>
        <div class="fg"><label>Beskrivning (valfritt)</label>
          <input id="adm-title-desc" placeholder="Kort beskrivning av yrkesrollen…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();AdminPage._addTitle();}"></div>`,
      buttons: [
        { label: 'Lägg till', cls: 'btn bp', onClick: () => AdminPage._addTitle() },
        { label: 'Avbryt',   cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('adm-title')?.focus(), 80);
  },

  _addTitle() {
    const name = (document.getElementById('adm-title')?.value || '').trim();
    if (!name) { showToast('Ange en titel'); return; }
    if ((state.titles||[]).some(x => x.name.toLowerCase() === name.toLowerCase())) { showToast('Finns redan'); return; }
    const desc = (document.getElementById('adm-title-desc')?.value || '').trim();
    state.titles = state.titles || [];
    const newId_ = 'TIT-' + String(Date.now()).slice(-6);
    state.titles.push({ id: newId_, name, description: desc, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    persist(); Modal.close(); AdminPage.render(); showToast(`"${name}" tillagd`);
  },

  openEditTitle(idx) {
    const t = (state.titles||[])[idx];
    if (!t) return;
    Modal.open({
      title: 'Redigera titel',
      body: `
        <div class="fg"><label>Titel / yrkesroll <span style="color:var(--rd)">*</span></label>
          <input id="adm-edit-title" value="${t.name}"
            onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('adm-edit-desc')?.focus();}"></div>
        <div class="fg"><label>Beskrivning</label>
          <input id="adm-edit-desc" value="${t.description||''}" placeholder="Kort beskrivning…"
            onkeydown="if(event.key==='Enter'){event.preventDefault();AdminPage._saveEditTitle(${idx});}"></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => AdminPage._saveEditTitle(idx) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('adm-edit-title')?.focus(), 80);
  },

  _saveEditTitle(idx) {
    const name = (document.getElementById('adm-edit-title')?.value || '').trim();
    if (!name) { showToast('Ange en titel'); return; }
    const t = (state.titles||[])[idx];
    if (!t) return;
    const oldName = t.name;
    if (name.toLowerCase() !== oldName.toLowerCase() &&
        (state.titles||[]).some((x, i) => i !== idx && x.name.toLowerCase() === name.toLowerCase())) {
      showToast('Titeln finns redan'); return;
    }
    // Update staff records that had the old name
    (state.staff||[]).forEach(s => { if (s.title === oldName) s.title = name; });
    t.name = name;
    t.description = (document.getElementById('adm-edit-desc')?.value || '').trim();
    t.updatedAt = new Date().toISOString();
    persist(); Modal.close(); AdminPage.render(); showToast('Titel uppdaterad');
  },

  toggleTitleActive(idx) {
    const t = (state.titles||[])[idx];
    if (!t) return;
    t.active = !t.active;
    t.updatedAt = new Date().toISOString();
    persist(); AdminPage.render(); showToast(t.active ? 'Titel aktiverad' : 'Titel inaktiverad');
  },

  removeTitle(idx) {
    const t = (state.titles||[])[idx];
    if (!t) return;
    const usageCount = (state.staff||[]).filter(s => s.title === t.name).length;
    if (usageCount > 0) { showToast(`Kan inte ta bort – används av ${usageCount} person${usageCount===1?'':'er'}`); return; }
    if (!confirm(`Ta bort titeln "${t.name}"?`)) return;
    state.titles.splice(idx, 1);
    persist(); AdminPage.render(); showToast('Borttagen');
  },

  openAddRole() {
    if (!Auth.require('admin_manage')) return;
    Modal.open({
      title: 'Ny anpassad roll',
      body: `
        <div class="fg"><label>Roll-ID (unik nyckel) <span style="color:var(--rd)">*</span></label>
          <input id="role-id" placeholder="t.ex. konsult, vikarie, tekniker2…" autocomplete="off"
            oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9_]/g,'')"></div>
        <div class="fg"><label>Visningsnamn <span style="color:var(--rd)">*</span></label>
          <input id="role-label" placeholder="T.ex. Konsult, Vikarie…" autocomplete="off"></div>
        <div class="fg"><label>Beskrivning</label>
          <input id="role-desc" placeholder="Kort beskrivning av rollen och dess tillgång…"></div>`,
      buttons: [
        { label: 'Skapa roll', cls: 'btn bp', onClick: () => AdminPage._addRole() },
        { label: 'Avbryt',    cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('role-id')?.focus(), 80);
  },

  _addRole() {
    const id    = document.getElementById('role-id')?.value.trim();
    const label = document.getElementById('role-label')?.value.trim();
    if (!id || !label) { showToast('ID och visningsnamn krävs'); return; }
    if ((state.roles||[]).some(r => r.id === id)) { showToast('Roll-ID används redan'); return; }
    state.roles = state.roles || [];
    state.roles.push({
      id, label, isBuiltin: false, active: true,
      description: document.getElementById('role-desc')?.value.trim() || '',
      permissions: []
    });
    persist(); Modal.close(); AdminPage.render(); showToast(`Roll "${label}" skapad`);
  },

  _PERMISSIONS: [
    { id:'all',              label:'Alla behörigheter (superadmin)' },
    { id:'dashboard_view',   label:'Se dashboard' },
    { id:'ao_create',        label:'Skapa / redigera arbetsorder' },
    { id:'ao_complete',      label:'Klarmarkera arbetsorder' },
    { id:'ao_view_all',      label:'Se alla arbetsorder' },
    { id:'customer_manage',  label:'Hantera kunder' },
    { id:'offer_manage',     label:'Hantera offerter' },
    { id:'invoice_view',     label:'Se fakturaunderlag' },
    { id:'invoice_create',   label:'Skapa fakturaunderlag' },
    { id:'article_manage',   label:'Hantera artiklar & prisgrupper' },
    { id:'staff_view',       label:'Se personal' },
    { id:'staff_manage',     label:'Hantera personal' },
    { id:'admin_manage',     label:'Adminpanel & systeminställningar' },
    { id:'reports_view',     label:'Se rapporter & löneunderlag' },
    { id:'recurring_manage', label:'Hantera återkommande ärenden' },
    { id:'sales_manage',     label:'Hantera säljchanser' }
  ],

  _PERM_LABELS: {
    'all':              'Superadmin – full åtkomst',
    'dashboard_view':   'Visa dashboard',
    'ao_view_all':      'Visa alla arbetsordrar',
    'ao_view_own':      'Visa egna arbetsordrar',
    'ao_create':        'Skapa arbetsordrar',
    'ao_edit':          'Redigera arbetsordrar',
    'ao_complete':      'Avsluta/slutföra arbetsordrar',
    'ao_time':          'Registrera tid',
    'ao_material':      'Registrera material',
    'ao_checklist':     'Hantera checklista',
    'customer_manage':  'Hantera kunder & fastigheter',
    'offer_manage':     'Hantera offerter',
    'invoice_view':     'Visa fakturaunderlag',
    'invoice_create':   'Skapa/redigera fakturaunderlag',
    'staff_view':       'Visa personal',
    'staff_manage':     'Hantera personal',
    'admin_manage':     'Systeminställningar & roller',
    'article_manage':   'Hantera artiklar & prisgrupper',
    'recurring_manage': 'Hantera återkommande ärenden',
    'sales_manage':     'Hantera säljchanser',
    'reports_view':     'Visa rapporter & löneunderlag',
  },

  _PERM_GROUPS: [
    { label: 'Superadmin',         perms: ['all'] },
    { label: 'Dashboard',          perms: ['dashboard_view'] },
    { label: 'Arbetsorder',        perms: ['ao_view_all','ao_view_own','ao_create','ao_edit','ao_complete','ao_time','ao_material','ao_checklist'] },
    { label: 'Kunder & Offerter',  perms: ['customer_manage','offer_manage'] },
    { label: 'Fakturering',        perms: ['invoice_view','invoice_create'] },
    { label: 'Personal & Admin',   perms: ['staff_view','staff_manage','admin_manage','article_manage'] },
    { label: 'Övrigt',             perms: ['recurring_manage','sales_manage','reports_view'] }
  ],

  openEditRole(roleId) {
    const r = (state.roles||[]).find(x => x.id === roleId);
    if (!r) return;
    const perms = r.permissions || [];
    const permMap = this._PERM_LABELS || {};

    const groupsHtml = this._PERM_GROUPS.map((g, gi) => {
      const groupCheckedCount = g.perms.filter(pid => perms.includes(pid)).length;
      const rows = g.perms.map(pid => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 0 6px 12px;border-bottom:1px solid var(--bg);cursor:pointer;">
          <input type="checkbox" name="role-perm" value="${pid}" ${perms.includes(pid)?'checked':''}
            style="width:15px;height:15px;flex-shrink:0;" onchange="AdminPage._onPermChange(this)">
          <span style="font-size:12px;">${permMap[pid]||pid}</span>
        </label>`).join('');
      return `
        <div style="margin-top:8px;border:1px solid var(--br);border-radius:var(--rs);overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--bg);border-bottom:1px solid var(--br);">
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:11px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.4px;">${g.label}</span>
              <span class="bdg bdg-${groupCheckedCount>0?'sky':'grey'}" style="font-size:9px;">${groupCheckedCount}/${g.perms.length}</span>
            </div>
            <button type="button" class="btn bghost bxs" style="font-size:10px;padding:2px 7px;"
              onclick="AdminPage._togglePermGroup(${gi})">Markera alla</button>
          </div>
          ${rows}
        </div>`;
    }).join('');

    Modal.open({
      title: `Redigera roll: ${r.label}`,
      wide: true,
      body: `
        <div class="fg"><label>Visningsnamn</label>
          <input id="role-edit-label" value="${r.label}" ${r.isBuiltin?'readonly style="background:var(--bg);"':''}></div>
        <div class="fg"><label>Beskrivning</label>
          <input id="role-edit-desc" value="${r.description||''}" placeholder="Kort beskrivning…"></div>
        <div style="margin-top:4px;">
          <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">Behörigheter</div>
          ${groupsHtml}
        </div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => AdminPage._saveEditRole(roleId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _togglePermGroup(groupIdx) {
    const group = this._PERM_GROUPS[groupIdx];
    if (!group) return;
    const cbs = document.querySelectorAll('input[name="role-perm"]');
    const groupCbs = Array.from(cbs).filter(cb => group.perms.includes(cb.value));
    const allChecked = groupCbs.every(cb => cb.checked);
    groupCbs.forEach(cb => {
      cb.checked = !allChecked;
      this._onPermChange(cb);
    });
  },

  _onPermChange(checkbox) {
    if (checkbox.value === 'all' && checkbox.checked) {
      document.querySelectorAll('input[name="role-perm"]').forEach(cb => { cb.checked = cb.value === 'all'; });
    } else if (checkbox.value !== 'all' && checkbox.checked) {
      const allCb = document.querySelector('input[name="role-perm"][value="all"]');
      if (allCb) allCb.checked = false;
    }
  },

  _saveEditRole(roleId) {
    const idx = (state.roles||[]).findIndex(r => r.id === roleId);
    if (idx < 0) return;
    const label = document.getElementById('role-edit-label')?.value.trim();
    if (!label) { showToast('Visningsnamn krävs'); return; }
    const checked = Array.from(document.querySelectorAll('input[name="role-perm"]:checked')).map(cb => cb.value);
    state.roles[idx] = {
      ...state.roles[idx],
      label,
      description: document.getElementById('role-edit-desc')?.value.trim() || '',
      permissions: checked
    };
    persist(); Modal.close(); AdminPage.render(); showToast('Roll uppdaterad');
  },

  removeRole(roleId) {
    const usageCount = (state.staff||[]).filter(s => s.role === roleId).length;
    if (usageCount > 0) { showToast(`Kan inte ta bort – används av ${usageCount} person${usageCount===1?'':'er'}`); return; }
    if (!confirm('Ta bort rollen?')) return;
    state.roles = (state.roles||[]).filter(r => r.id !== roleId);
    persist(); AdminPage.render(); showToast('Roll borttagen');
  }
};

/* ── Shell-sidor utan rendering ───────── */
const CalendarPage    = { render() { _renderShell('pg-calendar-content',    'Kalender',    'Kalendervy med planerade ordrar byggs i Fas 4.'); } };
const ContractsPage   = { render() { _renderShell('pg-contracts-content',   'Kontrakt',    'Kontrakthantering byggs i Fas 4.'); } };
const InspectionsPage = { render() { _renderShell('pg-rondering-content',   'Rondering',   'Ronderingssystem med mallar och avvikelser byggs i Fas 5.'); } };
const PayrollPage     = { render() { _renderShell('pg-payroll-content',     'Löneunderlag','Löneunderlag per person byggs i Fas 4.'); } };
const ReportsPage     = { render() { _renderShell('pg-reports-content',     'Rapporter',   'Statistik och rapporter byggs i Fas 4.'); } };

/* ── Hjälpfunktioner ──────────────────── */
function _shellEmpty(title, msg) {
  return `<div class="empty">${ic('settings',36)}<h3>${title}</h3><p>${msg}</p></div>`;
}

function _shellFull(title, msg) {
  return `
    <div class="card">
      <div class="card-header"><h3>${title}</h3></div>
      <div class="card-body"><div class="ibox">${msg}</div></div>
    </div>`;
}

function _renderShell(elId, title, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = _shellFull(title, msg);
}
