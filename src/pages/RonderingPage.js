/**
 * RonderingPage — Lista ronderingar + hantera mallar
 */
const RonderingPage = {

  _tab: 'ronderingar',    // 'ronderingar' | 'mallar'
  _filterStatus: 'alla',
  _search: '',

  render(params) {
    const el = document.getElementById('pg-rondering-content');
    if (!el) return;
    if (params && params.tab) this._tab = params.tab;

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
        <div style="flex:1;display:flex;gap:4px;">
          <button class="btn ${this._tab==='ronderingar'?'bp':'bs'} bsm" onclick="RonderingPage.switchTab('ronderingar')">Ronderingar</button>
          <button class="btn ${this._tab==='mallar'?'bp':'bs'} bsm" onclick="RonderingPage.switchTab('mallar')">Mallar</button>
        </div>
        ${this._tab==='ronderingar'
          ? `<button class="btn bp bsm" onclick="RonderingPage.openNewRondering()">+ Ny rondering</button>`
          : `<button class="btn bp bsm" onclick="RonderingPage.openNewMall()">+ Ny mall</button>`
        }
      </div>
      <div id="ron-tab-content"></div>`;

    this._renderTab();
  },

  switchTab(tab) {
    this._tab = tab;
    this.render();
  },

  _renderTab() {
    const el = document.getElementById('ron-tab-content');
    if (!el) return;
    if (this._tab === 'ronderingar') this._renderRonderingarList(el);
    else this._renderMallarList(el);
  },

  _renderRonderingarList(el) {
    const all = state.ronderingar || [];
    const statusOpts = [
      {v:'alla',l:'Alla statusar'},
      {v:'planerad',l:'Planerad'},
      {v:'pågående',l:'Pågående'},
      {v:'slutförd',l:'Slutförd'},
      {v:'har_avvikelser',l:'Har avvikelser'}
    ];
    const filtered = all.filter(r => {
      if (this._filterStatus !== 'alla' && r.status !== this._filterStatus) return false;
      if (this._search) {
        const cu = getCu(r.customerId);
        const cuName = cu ? cu.name || (cu.firstName + ' ' + cu.lastName).trim() : '';
        const hay = (r.templateName + cuName + r.performedByName).toLowerCase();
        if (!hay.includes(this._search.toLowerCase())) return false;
      }
      return true;
    }).sort(function(a,b) { return new Date(b.createdAt) - new Date(a.createdAt); });

    const ronStatusBadge = function(s) {
      const cls = {planerad:'bdg-blue',pågående:'bdg-orange',slutförd:'bdg-green',har_avvikelser:'bdg-red'}[s]||'bdg-grey';
      const lbl = {planerad:'Planerad',pågående:'Pågående',slutförd:'Slutförd',har_avvikelser:'Har avvikelser'}[s]||s;
      return '<span class="bdg ' + cls + '">' + lbl + '</span>';
    };

    el.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <input class="fg" style="flex:1;min-width:160px;padding:8px 10px;border:1px solid var(--br);border-radius:8px;font-size:13px;"
          placeholder="Sök..." value="${this._search}"
          oninput="RonderingPage._search=this.value;RonderingPage._renderTab()">
        <select style="padding:8px 10px;border:1px solid var(--br);border-radius:8px;font-size:13px;background:var(--wh);"
          onchange="RonderingPage._filterStatus=this.value;RonderingPage._renderTab()">
          ${statusOpts.map(o=>`<option value="${o.v}"${this._filterStatus===o.v?' selected':''}>${o.l}</option>`).join('')}
        </select>
      </div>
      ${filtered.length === 0
        ? `<div class="empty">${ic('clipboard-check',36)}<h3>Inga ronderingar</h3><p>Starta en ny rondering med knappen ovan</p></div>`
        : filtered.map(r => {
            const cu = getCu(r.customerId);
            const cuName = cu ? (cu.name || (cu.firstName + ' ' + cu.lastName).trim()) : '—';
            const stats = RonderingService.getStats(r.id);
            const prog = stats && stats.total > 0 ? stats.checked + '/' + stats.total + ' punkter' : '';
            return `
              <div class="list-item" onclick="RonderingPage.openRondering('${r.id}')">
                <div class="item-row">
                  <div style="flex:1;min-width:0;">
                    <div class="item-title">${r.templateName}</div>
                    <div class="item-sub">${cuName} · ${fmtDate(r.scheduledDate || r.createdAt)}${prog ? ' · '+prog : ''}</div>
                    <div style="font-size:11px;color:var(--mt);margin-top:2px;">${ic('user',11)} ${r.performedByName||'—'}</div>
                  </div>
                  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                    ${ronStatusBadge(r.status)}
                    ${(r.deviationIds||[]).length>0 ? `<span class="bdg bdg-red" style="font-size:9px;">${(r.deviationIds||[]).length} avv.</span>` : ''}
                  </div>
                </div>
              </div>`;
          }).join('')
      }`;
  },

  _renderMallarList(el) {
    const mallar = (state.ronderingsmallar || []).sort(function(a,b) { return new Date(b.createdAt)-new Date(a.createdAt); });
    el.innerHTML = mallar.length === 0
      ? `<div class="empty">${ic('layout-template',36)}<h3>Inga mallar</h3><p>Skapa en ronderingsmall med knappen ovan</p></div>`
      : mallar.map(m => {
          const totalPts = (m.categories||[]).reduce(function(s,c){return s+(c.points||[]).length;},0);
          const cu = m.customerId ? getCu(m.customerId) : null;
          const cuName = cu ? (cu.name||(cu.firstName+' '+cu.lastName).trim()) : 'Alla kunder';
          return `
            <div class="card" style="margin-bottom:8px;">
              <div class="card-body" style="padding:12px 14px;">
                <div style="display:flex;align-items:flex-start;gap:8px;">
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:14px;margin-bottom:2px;">${m.name}</div>
                    <div style="font-size:12px;color:var(--mt);">${cuName} · ${(m.categories||[]).length} kategorier · ${totalPts} punkter</div>
                    ${m.description ? `<div style="font-size:11px;color:var(--mt);margin-top:4px;">${m.description}</div>` : ''}
                  </div>
                  <span class="bdg ${m.active?'bdg-green':'bdg-grey'}">${m.active?'Aktiv':'Inaktiv'}</span>
                </div>
                <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
                  <button class="btn bs bsm" onclick="event.stopPropagation();RonderingPage.openEditMall('${m.id}')">Redigera</button>
                  <button class="btn bs bsm" onclick="event.stopPropagation();RonderingPage.duplicateMall('${m.id}')">Duplicera</button>
                  <button class="btn bs bsm" onclick="event.stopPropagation();RonderingPage.toggleMallActive('${m.id}')">${m.active?'Inaktivera':'Aktivera'}</button>
                  <button class="btn bp bsm" onclick="event.stopPropagation();RonderingPage.openNewRondering('${m.id}')">Starta rondering</button>
                </div>
              </div>
            </div>`;
        }).join('');
  },

  openRondering(id) {
    const ron = getRon(id);
    if (!ron) return;
    if (ron.status === 'planerad' || ron.status === 'pågående') {
      Router.showPage('pg-rondering-utfor', { ronderingId: id });
    } else {
      Router.showPage('pg-rondering-rapport', { ronderingId: id });
    }
  },

  openNewRondering(mallId) {
    const mallar = (state.ronderingsmallar || []).filter(m => m.active);
    const customers = state.customers || [];
    const staff = (state.staff || []).filter(s => s.active);
    const today = tdy();

    Modal.open({
      title: 'Ny rondering',
      body: `
        <div class="fg"><label>Mall *</label>
          <select id="ron-new-mall">
            <option value="">Välj mall...</option>
            ${mallar.map(m=>`<option value="${m.id}"${mallId===m.id?' selected':''}>${m.name}</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label>Kund *</label>
          <select id="ron-new-cu">
            <option value="">Välj kund...</option>
            ${customers.map(c=>`<option value="${c.id}">${c.name||c.firstName+' '+c.lastName}</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label>Fastighet</label>
          <select id="ron-new-prop">
            <option value="">Välj fastighet (valfritt)</option>
            ${(state.properties||[]).map(p=>`<option value="${p.id}">${p.name} – ${p.address}</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label>Planerat datum</label>
          <input type="date" id="ron-new-date" value="${today}">
        </div>
        <div class="fg"><label>Utförs av</label>
          <select id="ron-new-staff">
            <option value="">Välj personal...</option>
            ${staff.map(s=>`<option value="${s.id}"${state.currentUser&&s.id===state.currentUser.id?' selected':''}>${s.firstName} ${s.lastName}</option>`).join('')}
          </select>
        </div>`,
      buttons: [
        { label: 'Starta', cls: 'btn bp bfull', onClick: () => this._startNewRondering() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _startNewRondering() {
    const mallId  = (document.getElementById('ron-new-mall')||{}).value||'';
    const cuId    = (document.getElementById('ron-new-cu')||{}).value||'';
    const propId  = (document.getElementById('ron-new-prop')||{}).value||'';
    const date    = (document.getElementById('ron-new-date')||{}).value||'';
    const staffId = (document.getElementById('ron-new-staff')||{}).value||'';
    if (!mallId || !cuId) { showToast('Välj mall och kund'); return; }
    const staff = staffId ? getStaff(staffId) : null;
    const ron = RonderingService.createFromMall(mallId, {
      customerId: cuId,
      propertyId: propId,
      scheduledDate: date,
      performedBy: staffId,
      performedByName: staff ? (staff.firstName + ' ' + staff.lastName).trim() : ''
    });
    Modal.close();
    Router.showPage('pg-rondering-utfor', { ronderingId: ron.id });
  },

  /* ── Mall CRUD ─────────────────────── */

  openNewMall() {
    this._openMallForm(null);
  },

  openEditMall(id) {
    this._openMallForm(getMall(id));
  },

  _openMallForm(mall) {
    const intervals = [
      {v:'dagligen',l:'Dagligen'},{v:'veckovis',l:'Veckovis'},
      {v:'varannan_vecka',l:'Varannan vecka'},{v:'månadsvis',l:'Månadsvis'},
      {v:'kvartalsvis',l:'Kvartalsvis'},{v:'årsvis',l:'Årsvis'},{v:'eget',l:'Eget intervall'}
    ];
    const cats = mall ? (mall.categories||[]) : [];
    const customers = state.customers || [];

    Modal.open({
      title: mall ? 'Redigera mall' : 'Ny ronderingsmall',
      body: `
        <div class="fg"><label>Mallnamn *</label>
          <input type="text" id="mall-name" value="${mall?mall.name:''}">
        </div>
        <div class="fg"><label>Beskrivning</label>
          <textarea id="mall-desc" rows="2">${mall?mall.description:''}</textarea>
        </div>
        <div class="fg"><label>Kund (valfritt)</label>
          <select id="mall-cu">
            <option value="">Alla kunder</option>
            ${customers.map(c=>`<option value="${c.id}"${mall&&mall.customerId===c.id?' selected':''}>${c.name||c.firstName+' '+c.lastName}</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label>Intervall</label>
          <select id="mall-interval">
            ${intervals.map(i=>`<option value="${i.v}"${mall&&mall.interval===i.v?' selected':''}>${i.l}</option>`).join('')}
          </select>
        </div>
        <div style="margin-top:12px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:8px;">Kategorier & kontrollpunkter</div>
          <div id="mall-cats">
            ${cats.map((cat,ci)=>this._catHtml(cat,ci)).join('')}
          </div>
          <button class="btn bs bsm" onclick="RonderingPage._addCategory()" style="margin-top:6px;">+ Lägg till kategori</button>
        </div>`,
      buttons: [
        { label: mall?'Spara':'Skapa mall', cls: 'btn bp bfull', onClick: () => this._saveMall(mall?mall.id:null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    this._catCounter = cats.length;
  },

  _catHtml(cat, ci) {
    const pts = cat ? (cat.points||[]) : [];
    return `
      <div class="card" style="margin-bottom:8px;border:1px solid var(--br);" id="cat-block-${ci}">
        <div class="card-body" style="padding:10px 12px;">
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
            <input type="text" placeholder="Kategorinamn" value="${cat?cat.name:''}"
              id="cat-name-${ci}" style="flex:1;padding:6px 8px;border:1px solid var(--br);border-radius:6px;font-size:13px;font-weight:600;">
            <button class="btn bd bsm" onclick="document.getElementById('cat-block-${ci}').remove()">${ic('trash-2',13)}</button>
          </div>
          <div id="cat-pts-${ci}">
            ${pts.map((pt,pi)=>this._ptHtml(ci,pi,pt)).join('')}
          </div>
          <button class="btn bs bsm" onclick="RonderingPage._addPoint(${ci})" style="margin-top:4px;">+ Punkt</button>
        </div>
      </div>`;
  },

  _ptHtml(ci, pi, pt) {
    return `
      <div style="display:flex;gap:6px;align-items:flex-start;margin-bottom:6px;" id="pt-block-${ci}-${pi}">
        <div style="flex:1;">
          <input type="text" placeholder="Punktrubrik" value="${pt?pt.title:''}"
            id="pt-title-${ci}-${pi}" style="width:100%;padding:5px 8px;border:1px solid var(--br);border-radius:6px;font-size:12px;margin-bottom:3px;">
          <input type="text" placeholder="Instruktion (valfri)" value="${pt?pt.description:''}"
            id="pt-desc-${ci}-${pi}" style="width:100%;padding:5px 8px;border:1px solid var(--br);border-radius:6px;font-size:11px;color:var(--mt);">
          <label style="font-size:11px;color:var(--mt);margin-top:3px;display:inline-flex;align-items:center;gap:4px;">
            <input type="checkbox" id="pt-ao-${ci}-${pi}" ${pt&&pt.canCreateAO?'checked':''}> Kan skapa AO
          </label>
        </div>
        <button class="btn bd bsm" onclick="document.getElementById('pt-block-${ci}-${pi}').remove()">${ic('x',12)}</button>
      </div>`;
  },

  _catCounter: 0,
  _ptCounters: {},

  _addCategory() {
    const container = document.getElementById('mall-cats');
    if (!container) return;
    const ci = this._catCounter++;
    const div = document.createElement('div');
    div.innerHTML = this._catHtml(null, ci);
    container.appendChild(div.firstElementChild);
    this._ptCounters[ci] = 0;
  },

  _addPoint(ci) {
    const container = document.getElementById('cat-pts-' + ci);
    if (!container) return;
    if (!this._ptCounters[ci]) this._ptCounters[ci] = 0;
    const pi = this._ptCounters[ci]++;
    const div = document.createElement('div');
    div.innerHTML = this._ptHtml(ci, pi, null);
    container.appendChild(div.firstElementChild);
  },

  _saveMall(id) {
    const name = (document.getElementById('mall-name')||{}).value || '';
    if (!name.trim()) { showToast('Ange mallnamn'); return; }
    const cuId = (document.getElementById('mall-cu')||{}).value || '';
    const interval = (document.getElementById('mall-interval')||{}).value || 'månadsvis';
    const desc = (document.getElementById('mall-desc')||{}).value || '';

    // Collect categories
    const categories = [];
    let ci = 0;
    while (true) {
      const nameEl = document.getElementById('cat-name-' + ci);
      if (!nameEl) { if (ci > 50) break; ci++; continue; }
      if (!document.getElementById('cat-block-' + ci)) { ci++; continue; }
      const catName = nameEl.value.trim();
      if (!catName) { ci++; continue; }
      const points = [];
      let pi = 0;
      while (true) {
        const titleEl = document.getElementById('pt-title-' + ci + '-' + pi);
        if (!titleEl) { if (pi > 50) break; pi++; continue; }
        if (!document.getElementById('pt-block-' + ci + '-' + pi)) { pi++; continue; }
        const ptTitle = titleEl.value.trim();
        if (!ptTitle) { pi++; continue; }
        const ptDesc = (document.getElementById('pt-desc-' + ci + '-' + pi)||{}).value || '';
        const canAO  = (document.getElementById('pt-ao-' + ci + '-' + pi)||{}).checked || false;
        points.push({
          id: 'pt-' + Date.now() + '-' + ci + '-' + pi,
          title: ptTitle, description: ptDesc,
          requiresPhoto: false, canCreateAO: canAO, sortOrder: pi
        });
        pi++;
        if (pi > 50) break;
      }
      categories.push({ id: 'cat-' + Date.now() + '-' + ci, name: catName, sortOrder: ci, points: points });
      ci++;
      if (ci > 50) break;
    }

    const data = { name: name.trim(), description: desc, customerId: cuId, interval: interval, categories: categories };
    if (id) {
      RonderingService.updateMall(id, data);
      showToast('Mall uppdaterad');
    } else {
      RonderingService.createMall(data);
      showToast('Mall skapad');
    }
    Modal.close();
    this._renderTab();
  },

  duplicateMall(id) {
    RonderingService.duplicateMall(id);
    showToast('Mall duplicerad');
    this._renderTab();
  },

  toggleMallActive(id) {
    const mall = getMall(id);
    if (!mall) return;
    RonderingService.updateMall(id, { active: !mall.active });
    showToast(mall.active ? 'Mall inaktiverad' : 'Mall aktiverad');
    this._renderTab();
  }
};
