/**
 * RonderingUtforandePage — Utförande av rondering (steg-för-steg)
 */
const RonderingUtforandePage = {

  ronderingId: null,
  _currentCatIdx: 0,

  render(params) {
    const el = document.getElementById('pg-rondering-utfor-content');
    if (!el) return;
    const id = params && params.ronderingId;
    this.ronderingId = id;
    const ron = id ? getRon(id) : null;
    if (!ron) {
      el.innerHTML = `<div class="empty">${ic('clipboard-check',32)}<h3>Rondering hittades inte</h3></div>`;
      return;
    }
    // Auto-start if planerad
    if (ron.status === 'planerad') RonderingService.startRondering(id);
    this._renderForm(el, ron);
  },

  _renderForm(el, ron) {
    const cu = getCu(ron.customerId);
    const cuName = cu ? (cu.name||(cu.firstName+' '+cu.lastName).trim()) : '—';
    const prop = ron.propertyId ? getObj(ron.propertyId) : null;
    const stats = RonderingService.getStats(ron.id);
    const pct = stats && stats.total > 0 ? Math.round(stats.checked/stats.total*100) : 0;
    const cats = ron.results || [];
    const allDone = stats && stats.checked === stats.total && stats.total > 0;

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <button class="btn bs bsm" onclick="Router.back()">${ic('arrow-left',14)}</button>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:15px;">${ron.templateName}</div>
          <div style="font-size:11px;color:var(--mt);">${cuName}${prop?' · '+prop.name:''} · ${fmtDate(ron.scheduledDate||ron.createdAt)}</div>
        </div>
      </div>

      <!-- Progress -->
      <div class="card" style="margin-bottom:10px;">
        <div class="card-body" style="padding:10px 14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:12px;font-weight:700;">${stats?stats.checked:0} / ${stats?stats.total:0} punkter kontrollerade</span>
            <span style="font-size:12px;font-weight:800;color:${pct===100?'var(--green)':'var(--blue)'};">${pct}%</span>
          </div>
          <div style="background:var(--br);border-radius:4px;height:6px;">
            <div style="background:${pct===100?'var(--green)':'var(--blue)'};width:${pct}%;height:6px;border-radius:4px;transition:width .3s;"></div>
          </div>
          <div style="display:flex;gap:12px;margin-top:6px;font-size:11px;">
            <span style="color:var(--green);">${ic('check',11)} ${stats?stats.ok:0} ok</span>
            <span style="color:var(--rd);">${ic('alert-triangle',11)} ${stats?stats.avvs:0} avv.</span>
            <span style="color:var(--mt);">${ic('minus',11)} ${stats?stats.ejAktuell:0} ej aktuell</span>
          </div>
        </div>
      </div>

      <!-- Kategori-accordion -->
      ${cats.map((cat,ci) => this._catHtml(ron, cat, ci)).join('')}

      <!-- Interna anteckningar -->
      <div class="card" style="margin-top:8px;">
        <div class="card-body" style="padding:12px 14px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:6px;">Interna anteckningar</div>
          <textarea id="ron-note" rows="3" style="width:100%;padding:8px;border:1px solid var(--br);border-radius:8px;font-size:13px;resize:vertical;"
            placeholder="Anteckningar för rondering...">${ron.internalNote||''}</textarea>
          <button class="btn bs bsm" style="margin-top:6px;" onclick="RonderingUtforandePage._saveNote()">Spara anteckning</button>
        </div>
      </div>

      ${allDone ? `
        <div style="margin-top:12px;">
          <button class="btn bp bfull" style="padding:14px;font-size:15px;" onclick="RonderingUtforandePage.complete()">
            ${ic('check-circle',18)} Slutför rondering
          </button>
        </div>` : ''}`;
  },

  _catHtml(ron, cat, ci) {
    const pts = cat.points || [];
    const catOk = pts.filter(p=>p.status==='ok').length;
    const catAvv = pts.filter(p=>p.status==='avvikelse').length;
    const catEj = pts.filter(p=>p.status==='ej_aktuell').length;
    const catDone = catOk + catAvv + catEj;
    const allCatDone = catDone === pts.length && pts.length > 0;

    return `
      <div class="card" style="margin-bottom:8px;">
        <div class="card-head" style="padding:12px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;"
          onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
          <span style="font-weight:700;font-size:14px;flex:1;">${cat.categoryName}</span>
          <span style="font-size:11px;color:var(--mt);">${catDone}/${pts.length}</span>
          ${allCatDone ? `<span style="color:var(--green);">${ic('check-circle',16)}</span>` : ''}
        </div>
        <div>
          ${pts.map(pt => this._ptHtml(ron, cat, pt)).join('')}
        </div>
      </div>`;
  },

  _ptHtml(ron, cat, pt) {
    const statusColor = {ok:'var(--green)',avvikelse:'var(--rd)',ej_aktuell:'var(--mt)','':undefined}[pt.status];
    const statusIcon  = {ok:'check-circle',avvikelse:'alert-triangle',ej_aktuell:'minus-circle','':'circle'}[pt.status];
    const avv = pt.deviationId ? getAvv(pt.deviationId) : null;

    return `
      <div style="padding:12px 14px;border-top:1px solid var(--br);" id="pt-row-${pt.pointId}">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="color:${statusColor||'var(--br)'};margin-top:2px;flex-shrink:0;">${ic(statusIcon,18)}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13px;">${pt.pointTitle}</div>
            ${pt.comment ? `<div style="font-size:11px;color:var(--mt);margin-top:2px;">${pt.comment}</div>` : ''}
            ${avv ? `
              <div style="background:#fff0f0;border:1px solid #fca5a5;border-radius:6px;padding:6px 8px;margin-top:6px;font-size:11px;">
                ${ic('alert-triangle',11)} <strong>${avv.title}</strong> — ${avv.comment||''}
                ${avv.workOrderId ? `<span class="bdg bdg-green" style="font-size:9px;margin-left:4px;">AO ${avv.workOrderId}</span>` : `
                  <button class="btn bp bsm" style="font-size:10px;margin-top:4px;" onclick="RonderingUtforandePage.createAOFromAvv('${avv.id}')">Skapa AO</button>`}
              </div>` : ''}
          </div>
        </div>
        ${pt.status === '' ? `
          <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
            <button class="btn bsm" style="flex:1;background:#dcfce7;border:1px solid #86efac;color:#166534;font-weight:700;padding:10px;"
              onclick="RonderingUtforandePage.markOk('${ron.id}','${cat.categoryId}','${pt.pointId}')">
              ${ic('check',15)} Godkänd
            </button>
            <button class="btn bsm" style="flex:1;background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;font-weight:700;padding:10px;"
              onclick="RonderingUtforandePage.openAvvikelseModal('${ron.id}','${cat.categoryId}','${pt.pointId}','${pt.pointTitle}')">
              ${ic('alert-triangle',15)} Avvikelse
            </button>
            <button class="btn bs bsm" style="padding:10px;"
              onclick="RonderingUtforandePage.openEjAktuellModal('${ron.id}','${cat.categoryId}','${pt.pointId}')">
              Ej aktuell
            </button>
          </div>` : `
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button class="btn bs bsm" style="font-size:10px;"
              onclick="RonderingUtforandePage.undoPoint('${ron.id}','${cat.categoryId}','${pt.pointId}')">
              ${ic('rotate-ccw',11)} Ångra
            </button>
          </div>`}
      </div>`;
  },

  markOk(ronderingId, catId, ptId) {
    RonderingService.setPointStatus(ronderingId, catId, ptId, 'ok', '');
    this._refresh();
  },

  openAvvikelseModal(ronderingId, catId, ptId, ptTitle) {
    const priorities = [{v:'akut',l:'Akut'},{v:'hög',l:'Hög'},{v:'normal',l:'Normal'},{v:'låg',l:'Låg'}];
    Modal.open({
      title: 'Avvikelse: ' + ptTitle,
      body: `
        <div class="fg"><label>Rubrik *</label>
          <input type="text" id="avv-title" placeholder="Beskriv avvikelsen kortfattat">
        </div>
        <div class="fg"><label>Kommentar</label>
          <textarea id="avv-comment" rows="3" placeholder="Ytterligare detaljer..."></textarea>
        </div>
        <div class="fg"><label>Prioritet</label>
          <select id="avv-priority">
            ${priorities.map(p=>`<option value="${p.v}"${p.v==='normal'?' selected':''}>${p.l}</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label>Foto (valfritt)</label>
          <input type="file" id="avv-photo" accept="image/*" capture="environment" style="font-size:12px;">
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-top:8px;cursor:pointer;">
          <input type="checkbox" id="avv-create-ao"> Skapa arbetsorder automatiskt
        </label>`,
      buttons: [
        { label: 'Spara avvikelse', cls: 'btn bp bfull', onClick: () => this._saveAvvikelse(ronderingId, catId, ptId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveAvvikelse(ronderingId, catId, ptId) {
    const title    = (document.getElementById('avv-title')||{}).value||'';
    if (!title.trim()) { showToast('Ange rubrik för avvikelsen'); return; }
    const comment  = (document.getElementById('avv-comment')||{}).value||'';
    const priority = (document.getElementById('avv-priority')||{}).value||'normal';
    const createAO = (document.getElementById('avv-create-ao')||{}).checked||false;
    const photoFile = document.getElementById('avv-photo');
    const ron = getRon(ronderingId);
    if (!ron) return;

    const cat = (ron.results||[]).find(r=>r.categoryId===catId);
    const catName = cat ? cat.categoryName : '';
    const ptTitle = cat ? ((cat.points||[]).find(p=>p.pointId===ptId)||{}).pointTitle || '' : '';

    const doSave = (images) => {
      const avv = RonderingService.createAvvikelse(ronderingId, {
        categoryId: catId, pointId: ptId, categoryName: catName, pointTitle: ptTitle,
        customerId: ron.customerId, propertyId: ron.propertyId,
        title: title.trim(), comment: comment, priority: priority, images: images
      });
      if (createAO) {
        const ao = RonderingService.createAOFromAvvikelse(avv.id);
        if (ao) showToast('AO skapad: ' + ao.id);
      }
      Modal.close();
      this._refresh();
    };

    if (photoFile && photoFile.files && photoFile.files[0]) {
      const reader = new FileReader();
      reader.onload = function(e) { doSave([{dataUrl: e.target.result, name: photoFile.files[0].name}]); };
      reader.readAsDataURL(photoFile.files[0]);
    } else {
      doSave([]);
    }
  },

  openEjAktuellModal(ronderingId, catId, ptId) {
    Modal.open({
      title: 'Ej aktuell',
      body: `<div class="fg"><label>Kommentar (valfri)</label>
        <input type="text" id="ej-comment" placeholder="Varför ej aktuell...">
      </div>`,
      buttons: [
        { label: 'Bekräfta', cls: 'btn bp bfull', onClick: () => {
          const comment = (document.getElementById('ej-comment')||{}).value||'';
          RonderingService.setPointStatus(ronderingId, catId, ptId, 'ej_aktuell', comment);
          Modal.close();
          this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  undoPoint(ronderingId, catId, ptId) {
    const ron = getRon(ronderingId);
    if (!ron) return;
    const cat = (ron.results||[]).find(r=>r.categoryId===catId);
    if (!cat) return;
    const pt = (cat.points||[]).find(p=>p.pointId===ptId);
    if (!pt) return;
    // If there's a deviation, mark it as avskriven
    if (pt.deviationId) {
      RonderingService.updateAvvikelse(pt.deviationId, { status: 'avskriven' });
      const ron2 = getRon(ronderingId);
      if (ron2) {
        ron2.deviationIds = (ron2.deviationIds||[]).filter(function(id){return id!==pt.deviationId;});
        persist();
      }
    }
    pt.status = '';
    pt.comment = '';
    pt.deviationId = null;
    pt.checkedAt = '';
    persist();
    this._refresh();
  },

  createAOFromAvv(avvId) {
    const ao = RonderingService.createAOFromAvvikelse(avvId);
    if (ao) {
      showToast('AO ' + ao.id + ' skapad');
      this._refresh();
    }
  },

  _saveNote() {
    const note = (document.getElementById('ron-note')||{}).value||'';
    RonderingService.updateRondering(this.ronderingId, { internalNote: note });
    showToast('Anteckning sparad');
  },

  complete() {
    const ron = getRon(this.ronderingId);
    if (!ron) return;
    // Save note before completing
    const noteEl = document.getElementById('ron-note');
    if (noteEl) RonderingService.updateRondering(this.ronderingId, { internalNote: noteEl.value });
    RonderingService.completeRondering(this.ronderingId);
    showToast('Rondering slutförd!');
    Router.showPage('pg-rondering-rapport', { ronderingId: this.ronderingId });
  },

  _refresh() {
    const ron = getRon(this.ronderingId);
    if (!ron) return;
    const el = document.getElementById('pg-rondering-utfor-content');
    if (el) this._renderForm(el, ron);
  }
};

/**
 * RonderingRapportPage — Rapportvy efter slutförd rondering
 */
const RonderingRapportPage = {

  render(params) {
    const el = document.getElementById('pg-rondering-rapport-content');
    if (!el) return;
    const id = params && params.ronderingId;
    const ron = id ? getRon(id) : null;
    if (!ron) {
      el.innerHTML = `<div class="empty">${ic('file-text',32)}<h3>Rondering hittades inte</h3></div>`;
      return;
    }
    const cu  = getCu(ron.customerId);
    const cuName = cu ? (cu.name||(cu.firstName+' '+cu.lastName).trim()) : '—';
    const prop = ron.propertyId ? getObj(ron.propertyId) : null;
    const stats = RonderingService.getStats(ron.id);
    const avvikelser = (ron.deviationIds||[]).map(function(id){return getAvv(id);}).filter(Boolean);

    const ronStatusBadge = function(s) {
      const cls = {planerad:'bdg-blue',pågående:'bdg-orange',slutförd:'bdg-green',har_avvikelser:'bdg-red'}[s]||'bdg-grey';
      const lbl = {planerad:'Planerad',pågående:'Pågående',slutförd:'Slutförd',har_avvikelser:'Har avvikelser'}[s]||s;
      return '<span class="bdg ' + cls + '">' + lbl + '</span>';
    };

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        <button class="btn bs bsm" onclick="Router.back()">${ic('arrow-left',14)}</button>
        <div style="flex:1;">
          <div style="font-size:16px;font-weight:800;">Ronderingsrapport</div>
          <div style="font-size:11px;color:var(--mt);">${ron.id}</div>
        </div>
        ${ronStatusBadge(ron.status)}
        <button class="btn bs bsm" onclick="window.print()" style="display:flex;align-items:center;gap:4px;">${ic('printer',14)} Skriv ut</button>
      </div>

      <!-- Sammanfattning -->
      <div class="card" style="margin-bottom:10px;" id="ron-rapport-summary">
        <div class="card-body" style="padding:14px;">
          <div style="font-weight:700;font-size:14px;margin-bottom:10px;">Sammanfattning</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">KUND</div><div style="font-size:13px;font-weight:700;">${cuName}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">FASTIGHET</div><div style="font-size:13px;font-weight:700;">${prop?prop.name:'—'}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">DATUM</div><div style="font-size:13px;">${fmtDate(ron.scheduledDate||ron.createdAt)}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">UTFÖRD AV</div><div style="font-size:13px;">${ron.performedByName||'—'}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">MALL</div><div style="font-size:13px;">${ron.templateName}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">SLUTFÖRD</div><div style="font-size:13px;">${ron.completedAt?fmtDate(ron.completedAt):'Pågår'}</div></div>
          </div>
          <!-- KPI row -->
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center;">
            <div style="background:#f0fdf4;border-radius:8px;padding:10px 4px;">
              <div style="font-size:20px;font-weight:900;color:#166534;">${stats?stats.ok:0}</div>
              <div style="font-size:10px;color:#166534;">Godkända</div>
            </div>
            <div style="background:#fef2f2;border-radius:8px;padding:10px 4px;">
              <div style="font-size:20px;font-weight:900;color:#991b1b;">${stats?stats.avvs:0}</div>
              <div style="font-size:10px;color:#991b1b;">Avvikelser</div>
            </div>
            <div style="background:#f9fafb;border-radius:8px;padding:10px 4px;">
              <div style="font-size:20px;font-weight:900;color:#374151;">${stats?stats.ejAktuell:0}</div>
              <div style="font-size:10px;color:#374151;">Ej aktuell</div>
            </div>
            <div style="background:#eff6ff;border-radius:8px;padding:10px 4px;">
              <div style="font-size:20px;font-weight:900;color:#1d4ed8;">${stats?stats.total:0}</div>
              <div style="font-size:10px;color:#1d4ed8;">Totalt</div>
            </div>
          </div>
          ${ron.internalNote ? `<div style="margin-top:10px;padding:8px;background:#f9fafb;border-radius:6px;font-size:12px;color:var(--mt);"><strong>Anteckning:</strong> ${ron.internalNote}</div>` : ''}
        </div>
      </div>

      <!-- Resultat per kategori -->
      ${(ron.results||[]).map(function(cat) {
        const pts = cat.points||[];
        const ok = pts.filter(function(p){return p.status==='ok';}).length;
        const avvs = pts.filter(function(p){return p.status==='avvikelse';}).length;
        const ej = pts.filter(function(p){return p.status==='ej_aktuell';}).length;
        return `
          <div class="card" style="margin-bottom:8px;">
            <div class="card-head" style="padding:10px 14px;display:flex;align-items:center;gap:8px;">
              <span style="font-weight:700;font-size:14px;flex:1;">${cat.categoryName}</span>
              <span style="font-size:11px;color:var(--mt);">${ok} ok · ${avvs} avv · ${ej} ej</span>
            </div>
            <div>
              ${pts.map(function(pt) {
                const stIcon = {ok:'check-circle',avvikelse:'alert-triangle',ej_aktuell:'minus-circle','':'circle'}[pt.status];
                const stColor = {ok:'var(--green)',avvikelse:'var(--rd)',ej_aktuell:'var(--mt)','':'var(--br)'}[pt.status];
                const stLabel = {ok:'Godkänd',avvikelse:'Avvikelse',ej_aktuell:'Ej aktuell','':'Ej kontrollerad'}[pt.status];
                const avv = pt.deviationId ? getAvv(pt.deviationId) : null;
                return `
                  <div style="padding:8px 14px;border-top:1px solid var(--br);display:flex;align-items:flex-start;gap:10px;">
                    <span style="color:${stColor};flex-shrink:0;margin-top:1px;">${ic(stIcon,15)}</span>
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:13px;font-weight:600;">${pt.pointTitle}</div>
                      <div style="font-size:11px;color:${stColor};font-weight:600;">${stLabel}</div>
                      ${pt.comment&&pt.status!=='avvikelse' ? `<div style="font-size:11px;color:var(--mt);">${pt.comment}</div>` : ''}
                      ${avv ? `
                        <div style="background:#fff0f0;border:1px solid #fca5a5;border-radius:6px;padding:8px;margin-top:6px;font-size:12px;">
                          <div style="font-weight:700;">${avv.title}</div>
                          ${avv.comment ? `<div style="color:var(--mt);margin-top:2px;">${avv.comment}</div>` : ''}
                          <div style="display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap;">
                            ${pbdg(avv.priority)}
                            ${avv.workOrderId ? `<span class="bdg bdg-green">AO: ${avv.workOrderId}</span>` : '<span class="bdg bdg-grey">Ingen AO</span>'}
                          </div>
                        </div>` : ''}
                    </div>
                  </div>`;
              }).join('')}
            </div>
          </div>`;
      }).join('')}

      <!-- Sammanlagda avvikelser -->
      ${avvikelser.length > 0 ? `
        <div class="card" style="margin-bottom:8px;">
          <div class="card-head" style="padding:10px 14px;">
            <span style="font-weight:700;font-size:14px;">${ic('alert-triangle',15)} Avvikelser (${avvikelser.length})</span>
          </div>
          ${avvikelser.map(function(avv) { return `
            <div style="padding:10px 14px;border-top:1px solid var(--br);">
              <div style="display:flex;align-items:flex-start;gap:8px;justify-content:space-between;flex-wrap:wrap;">
                <div>
                  <div style="font-weight:700;font-size:13px;">${avv.title}</div>
                  <div style="font-size:11px;color:var(--mt);">${avv.categoryName} › ${avv.pointTitle}</div>
                  ${avv.comment ? `<div style="font-size:12px;margin-top:4px;">${avv.comment}</div>` : ''}
                  <div style="display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap;">
                    ${pbdg(avv.priority)}
                    ${avv.workOrderId
                      ? `<span class="bdg bdg-green">AO: ${avv.workOrderId}</span>`
                      : `<button class="btn bp bsm" style="font-size:11px;" onclick="RonderingRapportPage.createAO('${avv.id}')">Skapa AO</button>`}
                  </div>
                </div>
              </div>
            </div>`; }).join('')}
        </div>` : ''}

      <!-- Tillbaka/ny rondering -->
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn bs" style="flex:1;" onclick="Router.showPage('pg-rondering')">Alla ronderingar</button>
        <button class="btn bp" style="flex:1;" onclick="RonderingPage.openNewRondering()">Ny rondering</button>
      </div>`;
  },

  createAO(avvId) {
    const ao = RonderingService.createAOFromAvvikelse(avvId);
    if (ao) {
      showToast('AO ' + ao.id + ' skapad');
      // Re-render current rapport
      const ron = state.ronderingar.find(function(r) { return (r.deviationIds||[]).includes(avvId); });
      if (ron) this.render({ ronderingId: ron.id });
    }
  }
};
