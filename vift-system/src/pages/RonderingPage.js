/**
 * RonderingPage — Lista ronderingar + mallar
 */
const RonderingPage = {
  _tab: 'ronderingar',
  _filterStatus: 'alla',
  _search: '',

  render(params) {
    const el = document.getElementById('pg-rondering-content');
    if (!el) return;
    if (params && params.tab) this._tab = params.tab;
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <div style="display:flex;gap:4px;flex:1;">
          <button class="btn ${this._tab==='ronderingar'?'bp':'bs'} bsm" onclick="RonderingPage.switchTab('ronderingar')">Ronderingar</button>
          <button class="btn ${this._tab==='mallar'?'bp':'bs'} bsm" onclick="RonderingPage.switchTab('mallar')">Mallar</button>
        </div>
        ${this._tab==='ronderingar'
          ? `<button class="btn bp bsm" onclick="RonderingPage.openNewRondering()">+ Ny rondering</button>`
          : `<button class="btn bp bsm" onclick="RonderingPage.openNewMall()">+ Ny mall</button>`}
      </div>
      <div id="ron-tab-content"></div>`;
    this._renderTab();
  },

  switchTab(tab) { this._tab = tab; this.render(); },

  _renderTab() {
    const el = document.getElementById('ron-tab-content');
    if (!el) return;
    this._tab === 'ronderingar' ? this._renderList(el) : this._renderMallar(el);
  },

  _renderList(el) {
    const statusOpts = [
      {v:'alla',l:'Alla'},{v:'utkast',l:'Utkast'},{v:'planerad',l:'Planerad'},
      {v:'pågående',l:'Pågående'},{v:'slutförd',l:'Slutförd'},{v:'har_avvikelser',l:'Avvikelser'}
    ];
    const statusBadge = s => {
      const cls = {utkast:'bdg-grey',planerad:'bdg-blue',pågående:'bdg-orange',slutförd:'bdg-green',har_avvikelser:'bdg-red'}[s]||'bdg-grey';
      const lbl = {utkast:'Utkast',planerad:'Planerad',pågående:'Pågående',slutförd:'Slutförd',har_avvikelser:'Har avvikelser'}[s]||s;
      return `<span class="bdg ${cls}">${lbl}</span>`;
    };
    const filtered = (state.ronderingar||[]).filter(r => {
      if (this._filterStatus !== 'alla' && r.status !== this._filterStatus) return false;
      if (this._search) {
        const cu = getCu(r.customerId);
        const cuName = cu ? (cu.name||(cu.firstName+' '+cu.lastName).trim()) : '';
        const hay = ((r.name||r.templateName||'')+cuName).toLowerCase();
        if (!hay.includes(this._search.toLowerCase())) return false;
      }
      return true;
    }).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));

    el.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <input style="flex:1;min-width:150px;padding:8px 10px;border:1px solid var(--br);border-radius:8px;font-size:13px;"
          placeholder="Sök rondering..." value="${this._search}"
          oninput="RonderingPage._search=this.value;RonderingPage._renderTab()">
        <select style="padding:8px 10px;border:1px solid var(--br);border-radius:8px;font-size:13px;"
          onchange="RonderingPage._filterStatus=this.value;RonderingPage._renderTab()">
          ${statusOpts.map(o=>`<option value="${o.v}"${this._filterStatus===o.v?' selected':''}>${o.l}</option>`).join('')}
        </select>
      </div>
      ${filtered.length === 0
        ? `<div class="empty">${ic('clipboard-check',36)}<h3>Inga ronderingar</h3><p>Skapa en ny rondering med knappen ovan</p></div>`
        : filtered.map(r => {
            const cu = getCu(r.customerId);
            const cuName = cu ? (cu.name||(cu.firstName+' '+cu.lastName).trim()) : '—';
            const prop = r.propertyId ? getObj(r.propertyId) : null;
            const stats = RonderingService.getStats(r.id);
            const nextOcc = (r.occasions||[]).filter(o=>o.date>=tdy()).sort((a,b)=>a.date>b.date?1:-1)[0];
            const totalPts = (r.categories||[]).reduce((s,c)=>s+(c.points||[]).length, 0);
            const planMins = (r.occasions||[]).reduce((s,o)=>s+(o.estimatedDuration||0),0) ||
              (((r.recurringSetups||[])[0])||{}).estimatedDuration || 0;
            const planTid = planMins > 0
              ? (planMins >= 60 ? Math.floor(planMins/60)+'h'+(planMins%60?(planMins%60)+'min':'') : planMins+'min')
              : '';
            const priMap = {låg:'#64748b',normal:'var(--blue)',hög:'var(--orange)',akut:'var(--rd)'};
            const priLbl = {låg:'Låg',normal:'Normal',hög:'Hög',akut:'Akut'};
            return `
              <div class="list-item" onclick="RonderingPage.openRondering('${r.id}')">
                <div class="item-row">
                  <div style="flex:1;min-width:0;">
                    <div class="item-title">${r.name||r.templateName||r.id}</div>
                    <div class="item-sub">${cuName}${prop?' · '+prop.name:''}</div>
                    <div style="font-size:11px;color:var(--mt);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap;">
                      ${nextOcc?'<span>'+ic('calendar',10)+' '+fmtDate(nextOcc.date)+'</span>':''}
                      ${totalPts>0?'<span>'+totalPts+' punkter</span>':''}
                      ${planTid?'<span>'+ic('clock',10)+' '+planTid+'</span>':''}
                    </div>
                  </div>
                  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
                    ${statusBadge(r.status)}
                    ${r.priority&&r.priority!=='normal'?`<span style="font-size:9px;font-weight:700;color:${priMap[r.priority]||''};">${priLbl[r.priority]||''}</span>`:''}
                    ${(r.deviationIds||[]).length>0?`<span class="bdg bdg-red" style="font-size:9px;">${r.deviationIds.length} avv.</span>`:''}
                  </div>
                </div>
              </div>`;
          }).join('')}`;
  },

  _renderMallar(el) {
    const mallar = (state.ronderingsmallar||[]).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    el.innerHTML = mallar.length === 0
      ? `<div class="empty">${ic('layout-template',36)}<h3>Inga mallar</h3><p>Skapa en mall med knappen ovan</p></div>`
      : mallar.map(m => {
          const pts = (m.categories||[]).reduce((s,c)=>s+(c.points||[]).length,0);
          return `
            <div class="card" style="margin-bottom:8px;">
              <div class="card-body" style="padding:12px 14px;">
                <div style="display:flex;gap:8px;align-items:flex-start;">
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:14px;">${m.name}</div>
                    <div style="font-size:12px;color:var(--mt);">${(m.categories||[]).length} grupper · ${pts} kontrollpunkter</div>
                    ${m.description?`<div style="font-size:11px;color:var(--mt);margin-top:3px;">${m.description}</div>`:''}
                  </div>
                  <span class="bdg ${m.active?'bdg-green':'bdg-grey'}">${m.active?'Aktiv':'Inaktiv'}</span>
                </div>
                <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
                  <button class="btn bs bsm" onclick="event.stopPropagation();RonderingPage.editMall('${m.id}')">Redigera</button>
                  <button class="btn bs bsm" onclick="event.stopPropagation();RonderingPage.duplicateMall('${m.id}')">Duplicera</button>
                  <button class="btn bs bsm" onclick="event.stopPropagation();RonderingPage.toggleMall('${m.id}')">${m.active?'Inaktivera':'Aktivera'}</button>
                  <button class="btn bp bsm" onclick="event.stopPropagation();RonderingPage.openNewRondering('${m.id}')">Starta rondering</button>
                </div>
              </div>
            </div>`;
        }).join('');
  },

  openRondering(id) {
    const ron = getRon(id);
    if (!ron) return;
    if (ron.status === 'utkast' || ron.status === 'planerad') {
      Router.showPage('pg-rondering-wizard', { ronderingId: id, reset: true });
    } else if (ron.status === 'pågående') {
      Router.showPage('pg-rondering-utfor', { ronderingId: id });
    } else {
      Router.showPage('pg-rondering-rapport', { ronderingId: id });
    }
  },

  openNewRondering(prefillMallId) {
    if (prefillMallId) {
      const mall = getMall(prefillMallId);
      if (mall) {
        RonderingWizardPage._step = 1;
        RonderingWizardPage._editId = null;
        RonderingWizardPage._prefill = {};
        RonderingWizardPage._d = {
          name: mall.name || '', customerId: '', propertyId: '',
          description: '', internalNote: '', isDraft: false,
          categories: JSON.parse(JSON.stringify(mall.categories||[])),
          templateId: prefillMallId, templateName: mall.name || '',
          occasions: [], recurringSetups: [],
          pricingType: '', priceGroupId: '', priceGroupName: '', hourRate: 0, fixedPrice: 0, debiterbar: true
        };
        RonderingWizardPage._catCounter = RonderingWizardPage._d.categories.length;
        Router.showPage('pg-rondering-wizard', { reset: false });
      } else {
        Router.showPage('pg-rondering-wizard', { reset: true });
      }
    } else {
      Router.showPage('pg-rondering-wizard', { reset: true });
    }
  },

  openNewMall() { this._openMallForm(null); },
  editMall(id) { this._openMallForm(getMall(id)); },

  _openMallForm(mall) {
    const cats = mall ? (mall.categories||[]) : [];
    let catCounter = cats.length;
    const ptCounters = {};

    const catHtml = (cat, ci) => {
      const pts = cat ? (cat.points||[]) : [];
      return `<div class="card" style="margin-bottom:6px;border:1px solid var(--br);" id="mc-${ci}">
        <div class="card-body" style="padding:8px 10px;">
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
            <input type="text" placeholder="Grupprubrik" value="${cat?cat.name:''}" id="mc-name-${ci}"
              style="flex:1;padding:5px 8px;border:1px solid var(--br);border-radius:6px;font-size:12px;font-weight:600;">
            <button class="btn bd bsm" onclick="document.getElementById('mc-${ci}').remove()">${ic('trash-2',12)}</button>
          </div>
          <div id="mc-pts-${ci}">${pts.map((pt,pi)=>ptHtml(ci,pi,pt)).join('')}</div>
          <button class="btn bs bsm" style="font-size:10px;" onclick="addMallPt(${ci})">+ Punkt</button>
        </div>
      </div>`;
    };

    const ptHtml = (ci, pi, pt) => `
      <div style="display:flex;gap:4px;margin-bottom:4px;" id="mc-pt-${ci}-${pi}">
        <div style="flex:1;">
          <input type="text" placeholder="Punktrubrik" value="${pt?pt.title:''}" id="mc-ptname-${ci}-${pi}"
            style="width:100%;padding:4px 7px;border:1px solid var(--br);border-radius:5px;font-size:11px;margin-bottom:2px;">
          <label style="font-size:10px;color:var(--mt);display:flex;align-items:center;gap:3px;">
            <input type="checkbox" id="mc-ptao-${ci}-${pi}" ${pt&&pt.canCreateAO!==false?'checked':'checked'}> AO
          </label>
        </div>
        <button class="btn bd bsm" style="align-self:flex-start;" onclick="document.getElementById('mc-pt-${ci}-${pi}').remove()">${ic('x',11)}</button>
      </div>`;

    window.addMallCat = () => {
      const ci = catCounter++;
      const div = document.createElement('div');
      div.innerHTML = catHtml(null, ci);
      document.getElementById('mc-cats').appendChild(div.firstElementChild);
      ptCounters[ci] = 0;
    };
    window.addMallPt = (ci) => {
      if (!ptCounters[ci]) ptCounters[ci] = 0;
      const pi = ptCounters[ci]++;
      const div = document.createElement('div');
      div.innerHTML = ptHtml(ci, pi, null);
      const el = document.getElementById('mc-pts-' + ci);
      if (el) el.appendChild(div.firstElementChild);
    };

    Modal.open({
      title: mall ? 'Redigera mall' : 'Ny ronderingsmall',
      body: `
        <div class="fg"><label>Mallnamn *</label><input type="text" id="mc-mname" value="${mall?mall.name:''}"></div>
        <div class="fg"><label>Beskrivning</label><textarea id="mc-mdesc" rows="2">${mall?mall.description:''}</textarea></div>
        <div style="margin-top:10px;">
          <div style="font-weight:700;font-size:12px;margin-bottom:6px;">Grupper och kontrollpunkter</div>
          <div id="mc-cats">${cats.map((c,ci)=>catHtml(c,ci)).join('')}</div>
          <button class="btn bs bsm" style="margin-top:4px;font-size:11px;" onclick="addMallCat()">+ Grupp</button>
        </div>`,
      buttons: [
        { label: mall?'Spara':'Skapa', cls:'btn bp bfull', onClick: () => this._saveMallForm(mall?mall.id:null, catCounter, ptCounters) },
        { label:'Avbryt', cls:'btn bs', onClick: () => Modal.close() }
      ]
    });
    cats.forEach((c,ci)=>{ ptCounters[ci] = (c.points||[]).length; });
  },

  _saveMallForm(id, catCounter, ptCounters) {
    const name = (document.getElementById('mc-mname')||{}).value||'';
    if (!name.trim()) { showToast('Ange mallnamn'); return; }
    const desc = (document.getElementById('mc-mdesc')||{}).value||'';
    const categories = [];
    for (let ci = 0; ci < catCounter + 1; ci++) {
      const el = document.getElementById('mc-' + ci);
      if (!el) continue;
      const catName = ((document.getElementById('mc-name-' + ci)||{}).value||'').trim();
      if (!catName) continue;
      const points = [];
      for (let pi = 0; pi < (ptCounters[ci]||0) + 10; pi++) {
        const el2 = document.getElementById('mc-pt-' + ci + '-' + pi);
        if (!el2) continue;
        const ptName = ((document.getElementById('mc-ptname-' + ci + '-' + pi)||{}).value||'').trim();
        if (!ptName) continue;
        const canAO = (document.getElementById('mc-ptao-' + ci + '-' + pi)||{}).checked !== false;
        points.push({ id: 'pt-' + Date.now() + '-' + ci + '-' + pi, title: ptName, description: '', requiresPhoto: false, canCreateAO: canAO, sortOrder: pi });
      }
      categories.push({ id: 'cat-' + Date.now() + '-' + ci, name: catName, sortOrder: ci, points });
    }
    if (id) { RonderingService.updateMall(id, { name: name.trim(), description: desc, categories }); showToast('Mall uppdaterad'); }
    else { RonderingService.createMall({ name: name.trim(), description: desc, categories, interval: 'månadsvis', active: true }); showToast('Mall skapad'); }
    Modal.close();
    this._renderTab();
  },

  duplicateMall(id) { RonderingService.duplicateMall(id); showToast('Mall duplicerad'); this._renderTab(); },
  toggleMall(id) {
    const m = getMall(id);
    if (!m) return;
    RonderingService.updateMall(id, { active: !m.active });
    showToast(m.active ? 'Inaktiverad' : 'Aktiverad');
    this._renderTab();
  },

  openNewRonderingFromProperty(customerId, propertyId) {
    RonderingWizardPage._step = 1;
    RonderingWizardPage._editId = null;
    RonderingWizardPage._d = {
      name: '', customerId: customerId||'', propertyId: propertyId||'',
      description: '', internalNote: '', isDraft: false,
      categories: [], templateId: '', templateName: '',
      occasions: [], recurringSetups: [],
      pricingType: '', priceGroupId: '', priceGroupName: '', hourRate: 0, fixedPrice: 0, debiterbar: true
    };
    RonderingWizardPage._catCounter = 0;
    Router.showPage('pg-rondering-wizard', { reset: false });
  }
};
