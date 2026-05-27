/**
 * RonderingUtforandePage — Utförandeläge (fältanpassat)
 */
const RonderingUtforandePage = {
  ronderingId: null,

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
    if (ron.status === 'planerad' || ron.status === 'utkast') RonderingService.startRondering(id);
    this._renderAll(el, ron);
  },

  _renderAll(el, ron) {
    const cu = getCu(ron.customerId);
    const cuName = cu ? (cu.name||(cu.firstName+' '+cu.lastName).trim()) : '—';
    const prop = ron.propertyId ? getObj(ron.propertyId) : null;
    const stats = RonderingService.getStats(ron.id);
    const pct = stats && stats.total > 0 ? Math.round(stats.checked / stats.total * 100) : 0;
    const allDone = stats && stats.total > 0 && stats.checked === stats.total;

    el.innerHTML = `
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <button class="btn bs bsm" onclick="Router.back()">${ic('arrow-left',14)}</button>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:15px;">${ron.name||ron.templateName}</div>
          <div style="font-size:11px;color:var(--mt);">${cuName}${prop?' · '+prop.name:''}</div>
        </div>
        <button class="btn bs bsm" style="font-size:10px;" onclick="Router.showPage('pg-rondering-rapport',{ronderingId:'${ron.id}'})">Rapport</button>
      </div>

      <!-- Progress bar -->
      <div style="background:var(--wh);border:1px solid var(--br);border-radius:10px;padding:10px 14px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
          <span style="font-size:12px;font-weight:700;color:var(--navy);">${stats?stats.checked:0} / ${stats?stats.total:0} kontrollerade</span>
          <span style="font-size:14px;font-weight:900;color:${pct===100?'var(--green)':'var(--blue)'};">${pct}%</span>
        </div>
        <div style="background:#e5e7eb;border-radius:4px;height:8px;overflow:hidden;">
          <div style="background:${pct===100?'#16a34a':'var(--blue)'};width:${pct}%;height:8px;border-radius:4px;transition:width .4s ease;"></div>
        </div>
        <div style="display:flex;gap:14px;margin-top:6px;font-size:11px;flex-wrap:wrap;">
          <span style="color:#16a34a;font-weight:600;">${ic('check-circle',11)} ${stats?stats.ok:0} godkända</span>
          <span style="color:#dc2626;font-weight:600;">${ic('alert-triangle',11)} ${stats?stats.avvs:0} avvikelser</span>
          <span style="color:var(--mt);">${ic('minus-circle',11)} ${stats?stats.ejAktuell:0} ej aktuell</span>
        </div>
      </div>

      <!-- All categories and points -->
      ${(ron.results||[]).map((cat, ci) => this._renderCat(ron, cat, ci)).join('')}

      <!-- Notes -->
      <div style="background:var(--wh);border:1px solid var(--br);border-radius:10px;padding:12px 14px;margin-top:8px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:6px;">${ic('message-square',13)} Anteckningar</div>
        <textarea id="ron-exec-note" rows="3" style="width:100%;padding:8px;border:1px solid var(--br);border-radius:8px;font-size:13px;resize:vertical;"
          placeholder="Interna anteckningar...">${ron.internalNote||''}</textarea>
        <button class="btn bs bsm" style="margin-top:6px;" onclick="RonderingUtforandePage._saveNote('${ron.id}')">Spara</button>
      </div>

      <!-- Complete button -->
      ${allDone ? `
        <div style="margin-top:16px;padding:16px 0;">
          <button class="btn bp bfull" style="padding:16px;font-size:16px;font-weight:800;border-radius:12px;"
            onclick="RonderingUtforandePage.complete('${ron.id}')">
            ${ic('check-circle',20)} Slutför rondering
          </button>
        </div>` : `
        <div style="margin-top:12px;font-size:12px;color:var(--mt);text-align:center;padding:8px;">
          ${stats?stats.total-stats.checked:0} punkt${(stats&&stats.total-stats.checked)===1?'':'er'} kvar att kontrollera
        </div>`}`;
  },

  _renderCat(ron, cat, ci) {
    const pts = cat.points || [];
    const catDone = pts.filter(p=>p.status!=='').length;
    const allDone = catDone === pts.length && pts.length > 0;

    return `
      <div style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;padding:8px 0 6px;">
          <span style="color:${allDone?'#16a34a':'var(--mt)'};">${ic(allDone?'check-circle':'circle',15)}</span>
          <span style="font-weight:800;font-size:14px;color:var(--navy);">${cat.categoryName}</span>
          <span style="font-size:11px;color:var(--mt);margin-left:auto;">${catDone}/${pts.length}</span>
        </div>
        <div style="border:1px solid var(--br);border-radius:10px;overflow:hidden;background:var(--wh);">
          ${pts.map((pt, pi) => this._renderPt(ron, cat, pt, pi, pts.length)).join('')}
        </div>
      </div>`;
  },

  _renderPt(ron, cat, pt, pi, total) {
    const hasBorder = pi > 0 ? 'border-top:1px solid var(--br);' : '';
    const avv = pt.deviationId ? getAvv(pt.deviationId) : null;

    if (pt.status === '') {
      // Pending point — show large action buttons
      return `
        <div style="padding:14px;${hasBorder}" id="pt-row-${pt.pointId}">
          <div style="font-size:13px;font-weight:700;margin-bottom:3px;">${pt.pointTitle}</div>
          ${pt.pointDesc ? `<div style="font-size:11px;color:var(--mt);margin-bottom:8px;">${pt.pointDesc}</div>` : ''}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
            <button style="padding:12px 8px;background:#dcfce7;border:2px solid #86efac;border-radius:10px;font-weight:800;font-size:13px;color:#15803d;cursor:pointer;"
              onclick="RonderingUtforandePage.markOk('${ron.id}','${cat.categoryId}','${pt.pointId}')">
              ${ic('check-circle',16)} Godkänd
            </button>
            <button style="padding:12px 8px;background:#fef2f2;border:2px solid #fca5a5;border-radius:10px;font-weight:800;font-size:13px;color:#dc2626;cursor:pointer;"
              onclick="RonderingUtforandePage.openAvvModal('${ron.id}','${cat.categoryId}','${pt.pointId}','${pt.pointTitle.replace(/'/g,"\\'")}')">
              ${ic('alert-triangle',16)} Avvikelse
            </button>
          </div>
          <button style="width:100%;margin-top:6px;padding:8px;background:#f9fafb;border:1px solid var(--br);border-radius:8px;font-size:11px;color:var(--mt);cursor:pointer;font-weight:600;"
            onclick="RonderingUtforandePage.openEjAktuell('${ron.id}','${cat.categoryId}','${pt.pointId}')">
            Ej aktuell / ej kontrollerad
          </button>
        </div>`;
    }

    // Checked point — compact row
    const stIcon  = {ok:'check-circle',avvikelse:'alert-triangle',ej_aktuell:'minus-circle'}[pt.status]||'circle';
    const stColor = {ok:'#16a34a',avvikelse:'#dc2626',ej_aktuell:'#9ca3af'}[pt.status]||'#9ca3af';
    const stLabel = {ok:'Godkänd',avvikelse:'Avvikelse',ej_aktuell:'Ej aktuell'}[pt.status]||pt.status;

    return `
      <div style="padding:10px 14px;${hasBorder}display:flex;align-items:flex-start;gap:10px;" id="pt-row-${pt.pointId}">
        <span style="color:${stColor};flex-shrink:0;margin-top:1px;">${ic(stIcon,16)}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${pt.pointTitle}</div>
          <div style="font-size:11px;color:${stColor};font-weight:600;">${stLabel}${pt.comment?' — '+pt.comment:''}</div>
          ${avv ? `
            <div style="background:#fff0f0;border:1px solid #fca5a5;border-radius:6px;padding:6px 8px;margin-top:6px;font-size:11px;">
              <strong>${avv.title}</strong>${avv.comment?' — '+avv.comment:''}
              ${avv.workOrderId
                ? `<span class="bdg bdg-green" style="margin-left:6px;">AO: ${avv.workOrderId}</span>`
                : `<button class="btn bp bsm" style="font-size:10px;margin-left:6px;" onclick="RonderingUtforandePage.createAO('${avv.id}')">Skapa AO</button>`}
            </div>` : ''}
        </div>
        <button class="btn bs bsm" style="flex-shrink:0;font-size:10px;" title="Ångra"
          onclick="RonderingUtforandePage.undoPt('${ron.id}','${cat.categoryId}','${pt.pointId}')">
          ${ic('rotate-ccw',11)}
        </button>
      </div>`;
  },

  markOk(ronderingId, catId, ptId) {
    RonderingService.setPointStatus(ronderingId, catId, ptId, 'ok', '');
    this._refresh();
  },

  openAvvModal(ronderingId, catId, ptId, ptTitle) {
    Modal.open({
      title: 'Avvikelse: ' + ptTitle,
      body: `
        <div class="fg"><label>Rubrik *</label>
          <input type="text" id="avv-title" placeholder="Beskriv avvikelsen kortfattat...">
        </div>
        <div class="fg"><label>Kommentar</label>
          <textarea id="avv-comment" rows="3" placeholder="Ytterligare detaljer..."></textarea>
        </div>
        <div class="fg"><label>Prioritet</label>
          <select id="avv-priority">
            <option value="akut">Akut</option>
            <option value="hög">Hög</option>
            <option value="normal" selected>Normal</option>
            <option value="låg">Låg</option>
          </select>
        </div>
        <div class="fg"><label>Foto (valfritt)</label>
          <input type="file" id="avv-photo" accept="image/*" capture="environment" style="font-size:12px;">
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-top:10px;cursor:pointer;">
          <input type="checkbox" id="avv-create-ao"> Skapa arbetsorder automatiskt
        </label>`,
      buttons: [
        { label: 'Spara avvikelse', cls: 'btn bp bfull', onClick: () => this._saveAvv(ronderingId, catId, ptId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveAvv(ronderingId, catId, ptId) {
    const title   = ((document.getElementById('avv-title')||{}).value||'').trim();
    if (!title) { showToast('Ange rubrik'); return; }
    const comment  = (document.getElementById('avv-comment')||{}).value||'';
    const priority = (document.getElementById('avv-priority')||{}).value||'normal';
    const createAO = (document.getElementById('avv-create-ao')||{}).checked||false;
    const photoFile = document.getElementById('avv-photo');
    const ron = getRon(ronderingId);
    if (!ron) return;
    const cat = (ron.results||[]).find(r=>r.categoryId===catId);
    const catName = cat ? cat.categoryName : '';
    const pt = cat && (cat.points||[]).find(p=>p.pointId===ptId);
    const ptTitle = pt ? pt.pointTitle : '';

    const doSave = (images) => {
      const avv = RonderingService.createAvvikelse(ronderingId, {
        categoryId: catId, pointId: ptId, categoryName: catName, pointTitle: ptTitle,
        customerId: ron.customerId, propertyId: ron.propertyId,
        title, comment, priority, images
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
      reader.onload = e => doSave([{dataUrl: e.target.result, name: photoFile.files[0].name}]);
      reader.readAsDataURL(photoFile.files[0]);
    } else {
      doSave([]);
    }
  },

  openEjAktuell(ronderingId, catId, ptId) {
    Modal.open({
      title: 'Ej aktuell',
      body: `<div class="fg"><label>Kommentar (valfri)</label>
        <input type="text" id="ej-comment" placeholder="Varför ej aktuell..."></div>`,
      buttons: [
        { label: 'Bekräfta', cls: 'btn bp bfull', onClick: () => {
          const comment = (document.getElementById('ej-comment')||{}).value||'';
          RonderingService.setPointStatus(ronderingId, catId, ptId, 'ej_aktuell', comment);
          Modal.close(); this._refresh();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  undoPt(ronderingId, catId, ptId) {
    const ron = getRon(ronderingId);
    if (!ron) return;
    const cat = (ron.results||[]).find(r=>r.categoryId===catId);
    if (!cat) return;
    const pt = (cat.points||[]).find(p=>p.pointId===ptId);
    if (!pt) return;
    if (pt.deviationId) {
      RonderingService.updateAvvikelse(pt.deviationId, {status:'avskriven'});
      ron.deviationIds = (ron.deviationIds||[]).filter(id=>id!==pt.deviationId);
    }
    pt.status = ''; pt.comment = ''; pt.deviationId = null; pt.checkedAt = '';
    persist();
    this._refresh();
  },

  createAO(avvId) {
    const ao = RonderingService.createAOFromAvvikelse(avvId);
    if (ao) { showToast('AO ' + ao.id + ' skapad'); this._refresh(); }
  },

  _saveNote(ronderingId) {
    const note = (document.getElementById('ron-exec-note')||{}).value||'';
    RonderingService.updateRondering(ronderingId, {internalNote: note});
    showToast('Anteckning sparad');
  },

  complete(ronderingId) {
    const noteEl = document.getElementById('ron-exec-note');
    if (noteEl) RonderingService.updateRondering(ronderingId, {internalNote: noteEl.value});
    RonderingService.completeRondering(ronderingId);
    showToast('Rondering slutförd!');
    Router.showPage('pg-rondering-rapport', {ronderingId});
  },

  _refresh() {
    const ron = getRon(this.ronderingId);
    if (!ron) return;
    const el = document.getElementById('pg-rondering-utfor-content');
    if (el) this._renderAll(el, ron);
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
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">NAMN</div><div style="font-size:13px;">${ron.name||ron.templateName||'—'}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">UTFÖRD AV</div><div style="font-size:13px;">${ron.performedByName||'—'}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">STARTAD</div><div style="font-size:13px;">${ron.startedAt?fmtDate(ron.startedAt):'—'}</div></div>
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
      const ron = state.ronderingar.find(function(r) { return (r.deviationIds||[]).includes(avvId); });
      if (ron) this.render({ ronderingId: ron.id });
    }
  }
};
