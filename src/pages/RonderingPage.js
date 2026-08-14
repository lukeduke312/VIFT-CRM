/**
 * RonderingPage — Lista ronderingar + mallar + tillfällen (PASS)
 * v2: detail-vy per rondering med PASS-lista
 */
const RonderingPage = {
  _tab: 'ronderingar',
  _filterStatus: 'alla',
  _search: '',
  _view: 'list',    // 'list' | 'detail'
  _detailId: null,

  render(params) {
    const el = document.getElementById('pg-rondering-content');
    if (!el) return;
    if (params && params.tab) this._tab = params.tab;
    if (params && params.ronId) {
      this._view = 'detail';
      this._detailId = params.ronId;
    } else {
      this._view = 'list';
      this._detailId = null;
    }
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <div style="display:flex;gap:4px;flex:1;">
          <button class="btn ${this._tab==='ronderingar'?'bp':'bs'} bsm" onclick="RonderingPage.switchTab('ronderingar')">Ronderingar</button>
          <button class="btn ${this._tab==='mallar'?'bp':'bs'} bsm" onclick="RonderingPage.switchTab('mallar')">Mallar</button>
        </div>
        <div id="ron-hdr-btn"></div>
      </div>
      <div id="ron-tab-content"></div>`;
    this._renderTab();
  },

  switchTab(tab) {
    this._tab = tab;
    this._view = 'list';
    this._detailId = null;
    this.render();
  },

  _renderTab() {
    const el = document.getElementById('ron-tab-content');
    if (!el) return;
    const btn = document.getElementById('ron-hdr-btn');
    if (btn) {
      if (this._view === 'detail') {
        btn.innerHTML = '';
      } else if (this._tab === 'ronderingar') {
        btn.innerHTML =
          `${Auth.can('ao_edit') ? `<button class="btn bs bsm" onclick="Router.showPage('pg-import-wizard',{type:'ronderingPass'})">${ic('upload',13)} Importera pass</button>` : ''}` +
          `<button class="btn bs bsm" onclick="ImportExportService.showExportMenu('ronderingSchema',this)">${ic('download',13)} Exportera</button>` +
          `<button class="btn bp bsm" onclick="RonderingPage.openNewRondering()">+ Ny rondering</button>`;
      } else {
        btn.innerHTML =
          `${Auth.can('ao_edit') ? `<button class="btn bs bsm" onclick="Router.showPage('pg-import-wizard',{type:'ronderingsmall'})">${ic('upload',13)} Importera</button>` : ''}` +
          `<button class="btn bs bsm" onclick="ImportExportService.showExportMenu('ronderingsmall',this)">${ic('download',13)} Exportera</button>` +
          `<button class="btn bp bsm" onclick="RonderingPage.openNewMall()">+ Ny mall</button>`;
      }
    }
    if (this._tab === 'mallar') {
      this._renderMallar(el);
    } else if (this._view === 'detail') {
      this._renderDetail(el);
    } else {
      this._renderList(el);
    }
  },

  /* ── LIST ──────────────────────────────── */

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
      <div class="ao-toolbar" style="margin-bottom:6px;">
        <div class="swrap">
          <span class="sico">${ic('search',16)}</span>
          <input type="search" placeholder="Sök rondering, kund…" value="${esc(this._search)}"
            oninput="RonderingPage._search=this.value;RonderingPage._renderTab()">
        </div>
      </div>
      <div class="ftabs ao-status-tabs" style="margin-bottom:8px;">
        ${statusOpts.map(o=>`<button class="ft ${this._filterStatus===o.v?'on':''}" onclick="RonderingPage._filterStatus='${o.v}';RonderingPage._renderTab()">${o.l}</button>`).join('')}
      </div>
      ${filtered.length === 0
        ? `<div class="empty">${ic('clipboard-check',36)}<h3>Inga ronderingar</h3><p>Skapa en ny rondering med knappen ovan</p></div>`
        : filtered.map(r => {
            const cu = getCu(r.customerId);
            const cuName = cu ? (cu.name||(cu.firstName+' '+cu.lastName).trim()) : '—';
            const prop = r.propertyId ? getObj(r.propertyId) : null;
            const passes = RonderingService.getPassesByRondering(r.id);
            const nextPass = passes.filter(p=>p.scheduledDate>=tdy()&&p.status==='planerat').sort((a,b)=>a.scheduledDate>b.scheduledDate?1:-1)[0];
            const totalPts = (r.categories||[]).reduce((s,c)=>s+(c.points||[]).length, 0);
            return `
              <div class="list-item" onclick="RonderingPage.openRondering('${r.id}')">
                <div class="item-row">
                  <div style="flex:1;min-width:0;">
                    <div class="item-title">${esc(r.name||r.templateName||r.id)}</div>
                    <div class="item-sub">${esc(cuName)}${prop?' · '+esc(prop.name):''}</div>
                    <div style="font-size:11px;color:var(--mt);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap;">
                      ${nextPass?`<span>${ic('calendar',10)} ${fmtDate(nextPass.scheduledDate)}</span>`:''}
                      ${totalPts>0?`<span>${totalPts} punkter</span>`:''}
                      ${passes.length>0?`<span>${ic('list',10)} ${passes.length} tillfälle${passes.length!==1?'n':''}</span>`:''}
                    </div>
                  </div>
                  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
                    ${statusBadge(r.status)}
                    ${(r.deviationIds||[]).length>0?`<span class="bdg bdg-red" style="font-size:9px;">${r.deviationIds.length} avv.</span>`:''}
                  </div>
                </div>
              </div>`;
          }).join('')}`;
  },

  /* ── DETAIL (RON + PASS-lista) ─────────── */

  openRondering(id) {
    this._view = 'detail';
    this._detailId = id;
    this._renderTab();
  },

  backToList() {
    this._view = 'list';
    this._detailId = null;
    this._renderTab();
  },

  _passStatusBadge(s) {
    const cls = {planerat:'bdg-blue',pågående:'bdg-orange',slutfört:'bdg-green',har_avvikelser:'bdg-red'}[s]||'bdg-grey';
    const lbl = {planerat:'Planerat',pågående:'Pågående',slutfört:'Slutfört',har_avvikelser:'Har anmärkningar'}[s]||s;
    return `<span class="bdg ${cls}">${lbl}</span>`;
  },

  _renderDetail(el) {
    const ron = getRon(this._detailId);
    if (!ron) {
      el.innerHTML = `<div class="empty">${ic('clipboard-check',32)}<h3>Rondering hittades inte</h3></div>`;
      return;
    }
    const cu = getCu(ron.customerId);
    const cuName = cu ? (cu.name||(cu.firstName+' '+cu.lastName).trim()) : '—';
    const prop = ron.propertyId ? getObj(ron.propertyId) : null;
    const passes = RonderingService.getPassesByRondering(ron.id)
      .sort((a,b) => (b.sequenceNumber||0)-(a.sequenceNumber||0));

    const ronStatusBadge = s => {
      const cls = {utkast:'bdg-grey',planerad:'bdg-blue',pågående:'bdg-orange',slutförd:'bdg-green',har_avvikelser:'bdg-red'}[s]||'bdg-grey';
      const lbl = {utkast:'Utkast',planerad:'Planerad',pågående:'Pågående',slutförd:'Slutförd',har_avvikelser:'Har avvikelser'}[s]||s;
      return `<span class="bdg ${cls}">${lbl}</span>`;
    };

    const totalPts = (ron.categories||[]).reduce((s,c)=>s+(c.points||[]).length,0);

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <button class="btn bs bsm" onclick="RonderingPage.backToList()">${ic('arrow-left',14)}</button>
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:800;color:var(--navy);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(ron.name||ron.templateName||ron.id)}</div>
          <div style="font-size:11px;color:var(--mt);">${esc(cuName)}${prop?' · '+esc(prop.name):''}</div>
        </div>
        ${ronStatusBadge(ron.status)}
      </div>

      <div class="card" style="margin-bottom:10px;">
        <div class="card-body" style="padding:12px 14px;">
          <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px;margin-bottom:10px;">
            ${ron.templateName?`<div><span style="color:var(--mt);">Mall: </span>${esc(ron.templateName)}</div>`:''}
            <div><span style="color:var(--mt);">Kontrollpunkter: </span>${totalPts}</div>
            ${(ron.categories||[]).length?`<div><span style="color:var(--mt);">Grupper: </span>${ron.categories.length}</div>`:''}
            ${ron.pricingType==='tim'?`<div><span style="color:var(--mt);">Timtaxa: </span>${ron.hourRate||0} kr/h</div>`:''}
            ${ron.pricingType==='fast'?`<div><span style="color:var(--mt);">Fast pris: </span>${fkr(ron.fixedPrice||0)}</div>`:''}
            ${ron.pricingType==='avtal'?`<div><span style="color:var(--mt);">Pris: </span>Enligt avtal</div>`:''}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn bp bsm" onclick="RonderingPage.openNewPass('${ron.id}')">${ic('plus',13)} Nytt tillfälle</button>
            <button class="btn bs bsm" onclick="RonderingPage.openRonderingWizard('${ron.id}')">${ic('settings',12)} Redigera</button>
          </div>
        </div>
      </div>

      <div style="font-weight:700;font-size:13px;color:var(--navy);margin-bottom:8px;">${ic('calendar',13)} Tillfällen (${passes.length})</div>
      ${passes.length === 0
        ? `<div class="ibox" style="text-align:center;padding:28px;">
            ${ic('calendar',32)}
            <div style="color:var(--mt);font-size:13px;margin:8px 0;">Inga tillfällen skapade ännu</div>
            <button class="btn bp bsm" onclick="RonderingPage.openNewPass('${ron.id}')">${ic('plus',13)} Skapa första tillfälle</button>
          </div>`
        : passes.map(pass => {
            const stats = RonderingService.getPassStats(pass.id);
            const pct = stats && stats.total > 0 ? Math.round(stats.checked/stats.total*100) : 0;
            const staffNames = (pass.staffIds||[]).map(sid => {
              const s = getStaff(sid);
              return s ? (s.firstName+' '+s.lastName).trim() : sid;
            }).filter(Boolean).join(', ');
            const isLegacy = pass.migratedFromLegacy;
            const isDone = pass.status==='slutfört'||pass.status==='har_avvikelser';
            const btnLabel = isDone ? ic('file-text',12)+' Rapport'
              : (pass.status==='pågående' ? ic('play',12)+' Fortsätt' : ic('play',12)+' Starta');
            const btnCls = isDone ? 'bs' : 'bp';
            const progColor = stats&&stats.anmärkningar>0 ? '#dc2626' : '#16a34a';
            return `
              <div class="ron-pass ${pass.status||''}" onclick="RonderingPage.openPass('${pass.id}')">
                <div style="display:flex;align-items:flex-start;gap:10px;">
                  <div style="width:32px;height:32px;background:var(--bg);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:var(--navy);flex-shrink:0;">#${pass.sequenceNumber||1}</div>
                  <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px;">
                      <span style="font-weight:800;font-size:14px;color:var(--navy);">${pass.scheduledDate?fmtDate(pass.scheduledDate):'Inget datum'}</span>
                      ${pass.scheduledTime?`<span style="font-size:12px;color:var(--mt);font-weight:600;">${pass.scheduledTime}</span>`:''}
                      ${isLegacy?`<span style="font-size:9px;color:var(--mt);padding:1px 5px;background:#f3f4f6;border-radius:4px;font-weight:600;">Historisk</span>`:''}
                    </div>
                    <div style="font-size:11px;color:var(--mt);display:flex;gap:10px;flex-wrap:wrap;">
                      ${staffNames?`<span>${ic('user',10)} ${staffNames}</span>`:''}
                      ${stats&&stats.total>0?`<span>${ic('check-square',10)} ${stats.checked}/${stats.total}</span>`:''}
                      ${stats&&stats.anmärkningar>0?`<span style="color:#dc2626;font-weight:700;">${ic('alert-triangle',10)} ${stats.anmärkningar} anm.</span>`:''}
                      ${stats&&stats.unchecked>0&&!isDone&&pass.status!=='planerat'?`<span style="color:var(--mt);">${stats.unchecked} kvar</span>`:''}
                    </div>
                    ${stats&&stats.total>0&&pass.status!=='planerat'?`
                      <div class="ron-prog" style="margin-top:6px;">
                        <div class="ron-prog-fill" style="width:${pct}%;background:${progColor};"></div>
                      </div>`:''}
                  </div>
                  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
                    ${this._passStatusBadge(pass.status)}
                    <button class="btn ${btnCls} bxs" style="white-space:nowrap;"
                      onclick="event.stopPropagation();RonderingPage.openPass('${pass.id}')">
                      ${btnLabel}
                    </button>
                  </div>
                </div>
              </div>`;
          }).join('')
      }`;
  },

  openPass(passId) {
    const pass = getPass(passId);
    if (!pass) return;
    if (pass.status === 'slutfört' || pass.status === 'har_avvikelser') {
      Router.showPage('pg-rondering-rapport', { passId: passId });
    } else {
      Router.showPage('pg-rondering-utfor', { passId: passId });
    }
  },

  openNewPass(ronId) {
    const ron = getRon(ronId);
    if (!ron) return;
    const staffOpts = (state.staff||[]).filter(s=>s.active!==false)
      .map(s=>`<option value="${s.id}">${esc(s.firstName+' '+s.lastName)}</option>`).join('');
    Modal.open({
      title: 'Nytt ronderingstillfälle',
      body: `
        <div class="fg"><label>Datum *</label>
          <input type="date" id="np-date" value="${tdy()}">
        </div>
        <div class="fg"><label>Starttid</label>
          <input type="time" id="np-time" value="09:00">
        </div>
        <div class="fg"><label>Personal</label>
          <select id="np-staff" multiple style="height:80px;width:100%;padding:6px;border:1px solid var(--br);border-radius:8px;font-size:13px;">
            ${staffOpts}
          </select>
          <div style="font-size:10px;color:var(--mt);margin-top:2px;">Håll Ctrl/Cmd för att välja flera</div>
        </div>
        <div class="fg"><label>Beräknad tid (min)</label>
          <input type="number" id="np-dur" value="90" min="15" step="15">
        </div>`,
      buttons: [
        { label: 'Skapa tillfälle', cls: 'btn bp bfull', onClick: () => {
          const date = (document.getElementById('np-date')||{}).value||'';
          if (!date) { showToast('Välj datum'); return; }
          const time = (document.getElementById('np-time')||{}).value||'';
          const staffEl = document.getElementById('np-staff');
          const staffIds = staffEl ? Array.from(staffEl.selectedOptions).map(o=>o.value) : [];
          const dur = parseInt((document.getElementById('np-dur')||{}).value||'90',10)||90;
          RonderingService.createPassFromRondering(ronId, { scheduledDate: date, scheduledTime: time, staffIds, estimatedDurationMins: dur });
          showToast('Tillfälle skapat');
          Modal.close();
          this._renderDetail(document.getElementById('ron-tab-content'));
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openRonderingWizard(ronId) {
    Router.showPage('pg-rondering-wizard', { ronderingId: ronId, reset: true });
  },

  /* ── MALLAR ────────────────────────────── */

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
                    <div style="font-weight:700;font-size:14px;">${esc(m.name)}</div>
                    <div style="font-size:12px;color:var(--mt);">${(m.categories||[]).length} grupper · ${pts} kontrollpunkter</div>
                    ${m.description?`<div style="font-size:11px;color:var(--mt);margin-top:3px;">${esc(m.description)}</div>`:''}
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
            <input type="text" placeholder="Grupprubrik" value="${cat?esc(cat.name):''}" id="mc-name-${ci}"
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
          <input type="text" placeholder="Punktrubrik" value="${pt?esc(pt.title):''}" id="mc-ptname-${ci}-${pi}"
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
        <div class="fg"><label>Mallnamn *</label><input type="text" id="mc-mname" value="${mall?esc(mall.name):''}"></div>
        <div class="fg"><label>Beskrivning</label><textarea id="mc-mdesc" rows="2">${mall?esc(mall.description):''}</textarea></div>
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
