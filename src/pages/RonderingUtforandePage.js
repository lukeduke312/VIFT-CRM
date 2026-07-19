/**
 * RonderingUtforandePage — Utförandeläge (PASS-baserat)
 * v2: läser och sparar mot PASS istället för direkt mot RON.results
 * Bakåtkompatibelt: om passId saknas men ronderingId finns, väljs/skapas PASS automatiskt
 */
const RonderingUtforandePage = {
  passId: null,
  ronderingId: null,

  _avvImages: [],

  _resizeImage(file) {
    return new Promise(function(resolve) {
      const reader = new FileReader();
      reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
          const MAX = 900;
          let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          if (w > MAX || h > MAX) { const s = Math.min(MAX/w, MAX/h); w = Math.round(w*s); h = Math.round(h*s); }
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = function() { resolve(e.target.result); };
        img.src = e.target.result;
      };
      reader.onerror = function() { resolve(null); };
      reader.readAsDataURL(file);
    });
  },

  async _addImgToAvvModal(files) {
    for (const file of Array.from(files || [])) {
      if (!file.type.startsWith('image/')) continue;
      const dataUrl = await this._resizeImage(file);
      if (!dataUrl) continue;
      this._avvImages.push({
        id: 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2,6),
        url: dataUrl, caption: '',
        createdAt: new Date().toISOString(),
        createdBy: state.currentUser ? state.currentUser.id : ''
      });
      this._renderAvvImgList();
    }
  },

  _renderAvvImgList() {
    const el = document.getElementById('avv-img-list');
    if (!el) return;
    el.innerHTML = this._avvImages.map(function(img, i) {
      return '<div style="position:relative;display:inline-block;">' +
        '<img src="' + img.url + '" class="ron-img-thumb">' +
        '<button onclick="RonderingUtforandePage._removeAvvImg(' + i + ')" class="ron-img-rm">×</button>' +
        '</div>';
    }).join('');
  },

  _removeAvvImg(i) {
    this._avvImages.splice(i, 1);
    this._renderAvvImgList();
  },

  render(params) {
    const el = document.getElementById('pg-rondering-utfor-content');
    if (!el) return;

    const passId = params && params.passId;
    const ronId  = params && params.ronderingId;

    // Resolve PASS
    let pass = passId ? getPass(passId) : null;

    if (!pass && ronId) {
      // Legacy / backward compat: find best PASS for this RON
      const passes = RonderingService.getPassesByRondering(ronId);
      // Prefer in-progress, then planned, then most recent
      pass = passes.find(p => p.status === 'pågående')
          || passes.find(p => p.status === 'planerat')
          || passes.sort((a,b) => (b.sequenceNumber||0)-(a.sequenceNumber||0))[0]
          || null;

      // If no PASS at all and RON has categories, create one
      if (!pass) {
        const ron = getRon(ronId);
        if (ron && (ron.categories||[]).length > 0) {
          pass = RonderingService.createPassFromRondering(ronId, {
            scheduledDate: tdy(),
            scheduledTime: '',
            staffIds: ron.performedBy ? [ron.performedBy] : []
          });
        }
      }
    }

    if (!pass) {
      el.innerHTML = `<div class="empty">${ic('clipboard-check',32)}<h3>Tillfälle hittades inte</h3>
        <p style="color:var(--mt);font-size:13px;">Skapa ett nytt tillfälle från ronderingen.</p></div>`;
      return;
    }

    this.passId = pass.id;
    this.ronderingId = pass.ronderingId;
    if (typeof LiveSync !== 'undefined') LiveSync.start(pass.id);

    // Auto-start if planerat
    if (pass.status === 'planerat') {
      pass.status = 'pågående';
      pass.startedAt = new Date().toISOString();
      pass.updatedAt = new Date().toISOString();
      persist();
    }

    this._renderAll(el, pass);
  },

  _renderAll(el, pass) {
    const ron     = getRon(pass.ronderingId);
    const cu      = pass.customerId ? getCu(pass.customerId) : (ron ? getCu(ron.customerId) : null);
    const cuName  = cu ? (cu.name||(cu.firstName+' '+cu.lastName).trim()) : '—';
    const prop    = pass.propertyId ? getObj(pass.propertyId) : (ron && ron.propertyId ? getObj(ron.propertyId) : null);
    const ronName = ron ? (ron.name||ron.templateName||ron.id) : (pass.ronderingId||'');
    const stats   = RonderingService.getPassStats(pass.id);
    const pct     = stats && stats.total > 0 ? Math.round(stats.checked/stats.total*100) : 0;
    const allDone = stats && stats.total > 0 && stats.checked === stats.total;

    const staffNames = (pass.staffIds||[]).map(sid => {
      const s = getStaff(sid);
      return s ? (s.firstName+' '+s.lastName).trim() : sid;
    }).filter(Boolean).join(', ');

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <button class="btn bs bsm" onclick="Router.showPage('pg-rondering',{ronId:'${pass.ronderingId}'})">${ic('arrow-left',14)}</button>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(ronName)}</div>
          <div style="font-size:11px;color:var(--mt);">${esc(cuName)}${prop?' · '+esc(prop.name):''}
            · Tillfälle #${pass.sequenceNumber||1}${pass.scheduledDate?' · '+fmtDate(pass.scheduledDate):''}
          </div>
        </div>
        <button class="btn bs bsm" style="font-size:10px;white-space:nowrap;"
          onclick="Router.showPage('pg-rondering-rapport',{passId:'${pass.id}'})">${ic('file-text',13)} Rapport</button>
      </div>

      <div style="background:var(--wh);border:1px solid var(--br);border-radius:10px;padding:10px 14px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
          <span style="font-size:12px;font-weight:700;color:var(--navy);">${stats?stats.checked:0} / ${stats?stats.total:0} kontrollerade</span>
          <span style="font-size:14px;font-weight:900;color:${pct===100?'var(--green)':'var(--blue)'};">${pct}%</span>
        </div>
        <div style="background:#e5e7eb;border-radius:4px;height:8px;overflow:hidden;">
          <div style="background:${pct===100?'#16a34a':'var(--blue)'};width:${pct}%;height:8px;border-radius:4px;transition:width .4s ease;"></div>
        </div>
        <div style="display:flex;gap:14px;margin-top:6px;font-size:11px;flex-wrap:wrap;">
          <span style="color:#16a34a;font-weight:600;">${ic('check',10)} ${stats?stats.ok:0} godkända</span>
          <span style="color:#dc2626;font-weight:600;">${ic('alert-triangle',10)} ${stats?stats.anmärkningar:0} anmärkningar</span>
          <span style="color:var(--mt);">${ic('minus',10)} ${stats?stats.ejAktuell:0} ej aktuell</span>
        </div>
        ${staffNames?`<div style="font-size:11px;color:var(--mt);margin-top:5px;">${ic('user',10)} ${staffNames}</div>`:''}
      </div>

      ${(pass.categories||[]).map((cat, ci) => this._renderCat(pass, cat, ci)).join('')}

      <details style="margin-top:10px;">
        <summary style="font-size:12px;font-weight:600;color:var(--mt);cursor:pointer;padding:6px 0;list-style:none;display:flex;align-items:center;gap:6px;">
          ${ic('message-square',13)} Anteckningar${pass.internalNote?' ·':''}
          ${pass.internalNote?`<span style="font-size:11px;font-weight:400;color:var(--mt);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;">${esc(pass.internalNote)}</span>`:''}
        </summary>
        <div style="margin-top:6px;">
          <textarea id="pass-exec-note" rows="2" style="width:100%;padding:8px;border:1px solid var(--br);border-radius:8px;font-size:12px;resize:vertical;box-sizing:border-box;"
            placeholder="Interna anteckningar...">${esc(pass.internalNote||'')}</textarea>
          <button class="btn bs bsm" style="margin-top:4px;" onclick="RonderingUtforandePage._saveNote()">Spara</button>
        </div>
      </details>

      ${allDone ? `
        <div style="margin-top:16px;padding:16px 0;">
          <button class="btn bp bfull" style="padding:16px;font-size:16px;font-weight:800;border-radius:12px;"
            onclick="RonderingUtforandePage.complete()">
            ${ic('check-circle',20)} Slutför rondering
          </button>
        </div>` : `
        <div style="margin-top:12px;font-size:12px;color:var(--mt);text-align:center;padding:8px;">
          ${stats?stats.total-stats.checked:0} punkt${(stats&&stats.total-stats.checked)===1?'':'er'} kvar att kontrollera
        </div>`}`;
  },

  _renderCat(pass, cat, ci) {
    const pts     = cat.points || [];
    const checked = pts.filter(p => p.status !== '').length;
    const allDone = checked === pts.length && pts.length > 0;
    const headCls = allDone ? 'done' : 'open';
    const bdrClr  = allDone ? '#bbf7d0' : 'var(--br)';
    return `
      <div style="margin-bottom:12px;">
        <div class="roncat-head ${headCls}">
          <span>${esc(cat.name)}</span>
          <span class="roncat-head-cnt" style="color:${allDone?'#16a34a':'var(--mt)'};">
            ${allDone ? ic('check',11)+' Klar' : checked + '/' + pts.length}
          </span>
        </div>
        <div style="border:1px solid ${bdrClr};border-top:none;border-radius:0 0 10px 10px;overflow:hidden;background:var(--wh);">
          ${pts.map((pt, pi) => this._renderPt(pass, cat, pt, pi)).join('')}
        </div>
      </div>`;
  },

  _renderPt(pass, cat, pt, pi) {
    const hasBorder = pi > 0;
    const avv = pt.deviationId ? getAvv(pt.deviationId) : null;

    if (pt.status === '') {
      return `
        <div class="ronpt${hasBorder?' ronpt-br':''}" id="pt-row-${pt.id}">
          <div class="ronpt-info">
            <div class="ronpt-name">${esc(pt.title)}</div>
            ${pt.description?`<div class="ronpt-desc">${esc(pt.description)}</div>`:''}
          </div>
          <div class="ronpt-acts">
            <button class="rona-ok" title="Godkänd"
              onclick="RonderingUtforandePage.markOk('${pass.id}','${cat.id}','${pt.id}')">
              ${ic('check',14)}<span class="rona-lbl">Godkänd</span>
            </button>
            <button class="rona-avv" title="Anmärkning"
              onclick="RonderingUtforandePage.openAvvModal('${pass.id}','${cat.id}','${pt.id}')">
              ${ic('alert-triangle',14)}<span class="rona-lbl">Anmärkning</span>
            </button>
            <button class="rona-ej" title="Ej aktuell"
              onclick="RonderingUtforandePage.openEjAktuell('${pass.id}','${cat.id}','${pt.id}')">
              ${ic('minus',13)}<span class="rona-lbl">Ej aktuell</span>
            </button>
          </div>
        </div>`;
    }

    const stIcon  = {ok:'check-circle',anmärkning:'alert-triangle',ej_aktuell:'minus-circle',ej_kontrollerad:'circle'}[pt.status]||'circle';
    const stColor = {ok:'#16a34a',anmärkning:'#dc2626',ej_aktuell:'#9ca3af',ej_kontrollerad:'#9ca3af'}[pt.status]||'#9ca3af';
    const stLabel = {ok:'Godkänd',anmärkning:'Anmärkning',ej_aktuell:'Ej aktuell',ej_kontrollerad:'Ej kontrollerad'}[pt.status]||pt.status;

    return `
      <div class="ronpt${hasBorder?' ronpt-br':''}" id="pt-row-${pt.id}">
        <span style="color:${stColor};flex-shrink:0;">${ic(stIcon,16)}</span>
        <div class="ronpt-info">
          <div class="ronpt-name">${esc(pt.title)}</div>
          <div style="font-size:11px;font-weight:600;color:${stColor};">${stLabel}${pt.comment?' — '+esc(pt.comment):''}</div>
          ${avv?`
            <div class="ron-anm">
              <div class="ron-anm-title">${esc(avv.title)}</div>
              ${avv.comment?`<div class="ron-anm-body">${esc(avv.comment)}</div>`:''}
              ${avv && avv.images && avv.images.length > 0 ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">${avv.images.map(img=>`<img src="${img.url}" class="ron-img-thumb">`).join('')}</div>` : ''}
              <div class="ron-anm-actions">
                ${pbdg(avv.priority)}
                ${avv.severity?`<span class="bdg bdg-orange" style="font-size:9px;">${avv.severity}</span>`:''}
                ${avv.issueType?`<span class="bdg bdg-grey" style="font-size:9px;">${avv.issueType}</span>`:''}
                ${avv.workOrderId
                  ?`<span class="bdg bdg-green" style="font-size:9px;cursor:pointer;" onclick="Router.showPage('pg-ao-detail',{aoId:'${avv.workOrderId}'})">${ic('clipboard',9)} ${avv.workOrderId}</span>`
                  :(pt.canCreateAO!==false
                    ?`<button class="btn bp bsm" style="font-size:10px;" onclick="RonderingUtforandePage.createAO('${avv.id}')">Skapa AO</button>`
                    :'')}
              </div>
            </div>`:''}
        </div>
        <button class="rona-undo" title="Ångra"
          onclick="RonderingUtforandePage.undoPt('${pass.id}','${cat.id}','${pt.id}')">
          ${ic('rotate-ccw',12)}
        </button>
      </div>`;
  },

  /* ── Actions ─────────────────────────── */

  markOk(passId, catId, ptId) {
    this._setPointStatus(passId, catId, ptId, 'ok', '');
  },

  openAvvModal(passId, catId, ptId) {
    this._avvImages = [];
    const pass = getPass(passId);
    const cat  = pass && (pass.categories||[]).find(c=>c.id===catId);
    const pt   = cat && (cat.points||[]).find(p=>p.id===ptId);
    if (!pt) return;
    const canAO = pt.canCreateAO !== false;

    // Objekt-väljare för fastigheten
    const POS = typeof PropertyObjectService !== 'undefined' ? PropertyObjectService : null;
    const propObjs = (pass && pass.propertyId && POS) ? POS.getByProperty(pass.propertyId) : [];
    const objSelectHtml = propObjs.length
      ? `<div class="fg"><label>Objekt (valfritt)</label>
           <select id="avv-object" class="fi">
             <option value="">— Hela fastigheten —</option>
             ${propObjs.map(o=>`<option value="${o.id}">${esc(o.objectNumber?o.objectNumber+' – ':'')}${esc(o.name || POS.typeLabel(o.type))}</option>`).join('')}
           </select>
         </div>`
      : '';

    // Avvikelsekategorier och återkommande-detektering
    const devCats = (typeof state !== 'undefined' ? state.deviationCategories || [] : []).filter(c => c.active !== false);
    const catSelectHtml = devCats.length
      ? `<div class="fg"><label>Avvikelsekategori</label>
           <select id="avv-dev-cat" class="fi">
             <option value="">— Välj kategori —</option>
             ${devCats.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
           </select>
         </div>`
      : '';

    // Returnkommande: kolla om samma pointTitle finns i nyliga avvikelser på denna fastighet
    const propId = pass ? pass.propertyId : '';
    const recentRecurring = propId
      ? (typeof state !== 'undefined' ? state.avvikelser || [] : [])
          .filter(a => a.propertyId === propId && a.status !== 'avskriven' &&
            a.pointTitle && a.pointTitle.toLowerCase() === (pt.title||'').toLowerCase() &&
            a.id !== (pt.deviationId || ''))
      : [];
    const recurringBanner = recentRecurring.length
      ? `<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:8px 10px;font-size:12px;color:var(--rd);margin-bottom:8px;">
           ${ic('repeat',12)} Återkommande — ${recentRecurring.length} liknande avvikelse${recentRecurring.length>1?'r':''} finns på denna fastighet
         </div>`
      : '';

    Modal.open({
      title: 'Anmärkning: ' + pt.title,
      body: `
        ${recurringBanner}
        <div class="fg"><label>Rubrik *</label>
          <input type="text" id="avv-title" value="${esc(pt.title)}" placeholder="Beskriv anmärkningen...">
        </div>
        ${objSelectHtml}
        ${catSelectHtml}
        <div class="g2">
          <div class="fg"><label>Allvarlighetsgrad</label>
            <select id="avv-severity" class="fi">
              <option value="">— Välj —</option>
              <option value="kritisk">Kritisk</option>
              <option value="hög">Hög</option>
              <option value="medel">Medel</option>
              <option value="låg">Låg</option>
            </select>
          </div>
          <div class="fg"><label>Feltyp</label>
            <select id="avv-issue-type" class="fi">
              <option value="">— Välj —</option>
              <option value="skada">Skada</option>
              <option value="slitage">Slitage</option>
              <option value="säkerhet">Säkerhet</option>
              <option value="hygien">Hygien</option>
              <option value="drift">Driftfel</option>
              <option value="övrigt">Övrigt</option>
            </select>
          </div>
        </div>
        <div class="fg"><label>Plats / lokal (valfri)</label>
          <input type="text" id="avv-location" placeholder="T.ex. Trapphus B, plan 3...">
        </div>
        <div class="fg"><label>Kommentar</label>
          <textarea id="avv-comment" rows="3" placeholder="Ytterligare detaljer..."></textarea>
        </div>
        <div class="fg"><label>Prioritet</label>
          ${CustomSelect.render('avv-priority', {
            options: [{v:'akut',l:'Akut'},{v:'hög',l:'Hög'},{v:'normal',l:'Normal'},{v:'låg',l:'Låg'}],
            value: 'normal'
          })}
        </div>
        <div class="fg" style="margin-top:4px;">
          <label>Bilder (valfria)</label>
          <div id="avv-img-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;"></div>
          <label class="ron-img-add">
            ${ic('camera',14)} Kamera / välj bild
            <input type="file" accept="image/*" multiple style="display:none;"
              onchange="RonderingUtforandePage._addImgToAvvModal(this.files)">
          </label>
        </div>
        ${canAO?`
          <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;font-weight:600;margin-top:10px;cursor:pointer;">
            <input type="checkbox" id="avv-create-ao" style="margin-top:2px;">
            <div>
              <div>Skapa arbetsorder direkt</div>
              <div style="font-size:10px;color:var(--mt);font-weight:400;margin-top:1px;">Skapar en AO kopplad till kund och fastighet</div>
            </div>
          </label>`:''}`,
      buttons: [
        { label: 'Spara anmärkning', cls: 'btn bp bfull', onClick: () => this._saveAvv(passId, catId, ptId, canAO) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveAvv(passId, catId, ptId, canAO) {
    const title    = ((document.getElementById('avv-title')||{}).value||'').trim();
    if (!title) { showToast('Ange rubrik'); return; }
    const comment           = (document.getElementById('avv-comment')||{}).value||'';
    const priority          = (document.getElementById('avv-priority')||{}).value||'normal';
    const severity          = (document.getElementById('avv-severity')||{}).value||'';
    const issueType         = (document.getElementById('avv-issue-type')||{}).value||'';
    const location          = ((document.getElementById('avv-location')||{}).value||'').trim();
    const deviationCategoryId = (document.getElementById('avv-dev-cat')||{}).value||'';
    const createAO = canAO && !!(document.getElementById('avv-create-ao')||{}).checked;
    const objectId = (document.getElementById('avv-object')||{}).value||'';

    const pass = getPass(passId);
    if (!pass) return;
    const cat  = (pass.categories||[]).find(c=>c.id===catId);
    const pt   = cat && (cat.points||[]).find(p=>p.id===ptId);

    /* Bygg recurringKey av kategori + punkttitel (används för återkommande-detektering) */
    const ptSlug = (pt ? pt.title : title).toLowerCase().replace(/[^a-zåäö0-9]+/g, '-').replace(/^-|-$/g,'');
    const catSlug = (cat ? cat.name : '').toLowerCase().replace(/[^a-zåäö0-9]+/g, '-').replace(/^-|-$/g,'');
    const recurringKey = [deviationCategoryId||catSlug, ptSlug].filter(Boolean).join('::');

    const avv = RonderingService.createAvvikelse(pass.ronderingId, {
      passId: passId,
      categoryId: catId,
      pointId: ptId,
      categoryName: cat ? cat.name : '',
      pointTitle: pt ? pt.title : '',
      customerId: pass.customerId,
      propertyId: pass.propertyId,
      objectId,
      title, comment, priority, images: this._avvImages.slice(),
      /* Fas 4B — strukturerade fält */
      deviationCategoryId, severity, issueType, location, recurringKey
    });

    // Update PASS point status
    this._setPointStatus(passId, catId, ptId, 'anmärkning', comment, avv.id);

    if (createAO) {
      const ao = RonderingService.createAOFromAvvikelse(avv.id, passId);
      if (ao) showToast('AO skapad: ' + ao.id);
    }

    Modal.close();
    this._avvImages = [];
    this._refresh();
  },

  openEjAktuell(passId, catId, ptId) {
    Modal.open({
      title: 'Ej aktuell',
      body: `<div class="fg"><label>Kommentar (valfri)</label>
        <input type="text" id="ej-comment" placeholder="Varför ej aktuell..."></div>`,
      buttons: [
        { label: 'Bekräfta', cls: 'btn bp bfull', onClick: () => {
          const comment = (document.getElementById('ej-comment')||{}).value||'';
          this._setPointStatus(passId, catId, ptId, 'ej_aktuell', comment);
          Modal.close();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  undoPt(passId, catId, ptId) {
    const pass = getPass(passId);
    if (!pass) return;
    const cat = (pass.categories||[]).find(c=>c.id===catId);
    if (!cat) return;
    const pt = (cat.points||[]).find(p=>p.id===ptId);
    if (!pt) return;
    if (pt.deviationId) {
      RonderingService.updateAvvikelse(pt.deviationId, { status: 'avskriven' });
      // Remove from RON deviationIds too
      const ron = getRon(pass.ronderingId);
      if (ron) {
        ron.deviationIds = (ron.deviationIds||[]).filter(id=>id!==pt.deviationId);
        ron.updatedAt = new Date().toISOString();
      }
    }
    pt.status = ''; pt.comment = ''; pt.deviationId = null;
    pt.workOrderId = null; pt.checkedAt = null; pt.checkedBy = null;
    this._updateSummary(pass);
    persist();
    this._refresh();
  },

  createAO(avvId) {
    const ao = RonderingService.createAOFromAvvikelse(avvId, this.passId);
    if (ao) { showToast('AO ' + ao.id + ' skapad'); this._refresh(); }
  },

  _setPointStatus(passId, catId, ptId, status, comment, deviationId) {
    const pass = getPass(passId);
    if (!pass) return;
    const cat = (pass.categories||[]).find(c=>c.id===catId);
    if (!cat) return;
    const pt = (cat.points||[]).find(p=>p.id===ptId);
    if (!pt) return;
    pt.status    = status;
    pt.comment   = comment || '';
    pt.checkedAt = new Date().toISOString();
    pt.checkedBy = state.currentUser ? state.currentUser.id : null;
    if (deviationId) pt.deviationId = deviationId;
    this._updateSummary(pass);
    if (pass.status === 'planerat') {
      pass.status    = 'pågående';
      pass.startedAt = pass.startedAt || new Date().toISOString();
    }
    pass.updatedAt = new Date().toISOString();
    persist();
    this._refresh();
  },

  _updateSummary(pass) {
    let total=0, ok=0, anmärkningar=0, ejKontrollerad=0, ejAktuell=0;
    (pass.categories||[]).forEach(cat => {
      (cat.points||[]).forEach(pt => {
        total++;
        if (pt.status==='ok') ok++;
        else if (pt.status==='anmärkning') anmärkningar++;
        else if (pt.status==='ej_kontrollerad') ejKontrollerad++;
        else if (pt.status==='ej_aktuell') ejAktuell++;
      });
    });
    pass.summary = { total, ok, anmärkningar, ejKontrollerad, ejAktuell };
  },

  _saveNote() {
    const pass = getPass(this.passId);
    if (!pass) return;
    const note = (document.getElementById('pass-exec-note')||{}).value||'';
    pass.internalNote = note;
    pass.updatedAt = new Date().toISOString();
    persist();
    showToast('Anteckning sparad');
  },

  complete() {
    const pass = getPass(this.passId);
    if (!pass) return;
    const noteEl = document.getElementById('pass-exec-note');
    if (noteEl) { pass.internalNote = noteEl.value; }
    const stats = RonderingService.getPassStats(pass.id);
    const hasAnm = stats && stats.anmärkningar > 0;
    pass.status      = hasAnm ? 'har_avvikelser' : 'slutfört';
    pass.completedAt = new Date().toISOString();
    pass.completedBy = state.currentUser ? state.currentUser.id : null;
    pass.updatedAt   = new Date().toISOString();
    this._updateSummary(pass);
    persist();
    showToast('Rondering slutförd!');
    Router.showPage('pg-rondering-rapport', { passId: pass.id });
  },

  _refresh() {
    const pass = getPass(this.passId);
    if (!pass) return;
    const el = document.getElementById('pg-rondering-utfor-content');
    if (el) this._renderAll(el, pass);
  }
};

/**
 * RonderingRapportPage — Rapportvy per PASS
 * v2: läser från PASS; fallback till RON.results för legacy
 */
const RonderingRapportPage = {
  copyLink(passId) {
    const url = location.origin + location.pathname + '#pass=' + passId;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function() { showToast('Länk kopierad!'); }).catch(function() { prompt('Kopiera länk:', url); });
    } else { prompt('Kopiera länk:', url); }
  },

  render(params) {
    const el = document.getElementById('pg-rondering-rapport-content');
    if (!el) return;

    const passId = params && params.passId;
    const ronId  = params && params.ronderingId;

    let pass = passId ? getPass(passId) : null;

    // Legacy: find most recent completed PASS for this RON
    if (!pass && ronId) {
      const passes = RonderingService.getPassesByRondering(ronId)
        .filter(p => p.status==='slutfört'||p.status==='har_avvikelser')
        .sort((a,b) => (b.sequenceNumber||0)-(a.sequenceNumber||0));
      pass = passes[0] || RonderingService.getPassesByRondering(ronId)
        .sort((a,b)=>(b.sequenceNumber||0)-(a.sequenceNumber||0))[0] || null;
    }

    if (pass) {
      this._renderFromPass(el, pass);
    } else if (ronId) {
      // True legacy: no PASS exists, render from RON.results
      const ron = getRon(ronId);
      if (ron) { this._renderLegacy(el, ron); return; }
      el.innerHTML = `<div class="empty">${ic('file-text',32)}<h3>Rondering hittades inte</h3></div>`;
    } else {
      el.innerHTML = `<div class="empty">${ic('file-text',32)}<h3>Inget tillfälle angivet</h3></div>`;
    }
  },

  _renderFromPass(el, pass) {
    const ron     = getRon(pass.ronderingId);
    const cu      = pass.customerId ? getCu(pass.customerId) : (ron ? getCu(ron.customerId) : null);
    const cuName  = cu ? (cu.name||(cu.firstName+' '+cu.lastName).trim()) : '—';
    const prop    = pass.propertyId ? getObj(pass.propertyId) : (ron&&ron.propertyId?getObj(ron.propertyId):null);
    const ronName = ron ? (ron.name||ron.templateName||ron.id) : (pass.ronderingId||'');
    const stats   = RonderingService.getPassStats(pass.id);

    const staffNames = (pass.staffIds||[]).map(sid => {
      const s = getStaff(sid);
      return s ? (s.firstName+' '+s.lastName).trim() : sid;
    }).filter(Boolean).join(', ');

    let faktiskTid = '';
    if (pass.startedAt && pass.completedAt) {
      const mins = Math.round((new Date(pass.completedAt)-new Date(pass.startedAt))/60000);
      faktiskTid = mins>=60 ? Math.floor(mins/60)+'h '+(mins%60?mins%60+'min':'') : mins+' min';
    }

    const passStatusBadge = s => {
      const cls = {planerat:'bdg-blue',pågående:'bdg-orange',slutfört:'bdg-green',har_avvikelser:'bdg-red'}[s]||'bdg-grey';
      const lbl = {planerat:'Planerat',pågående:'Pågående',slutfört:'Slutfört',har_avvikelser:'Har anmärkningar'}[s]||s;
      return `<span class="bdg ${cls}">${lbl}</span>`;
    };

    // Collect deviations from PASS points
    const avvIds = [];
    (pass.categories||[]).forEach(cat => (cat.points||[]).forEach(pt => { if (pt.deviationId) avvIds.push(pt.deviationId); }));
    const avvikelser = avvIds.map(id=>getAvv(id)).filter(Boolean);

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        <button class="btn bs bsm" onclick="Router.showPage('pg-rondering',{ronId:'${pass.ronderingId}'})">${ic('arrow-left',14)}</button>
        <div style="flex:1;">
          <div style="font-size:16px;font-weight:800;">Ronderingsrapport</div>
          <div style="font-size:11px;color:var(--mt);">${esc(ronName)} · Tillfälle #${pass.sequenceNumber||1}</div>
        </div>
        ${passStatusBadge(pass.status)}
        <button class="btn bs bsm" onclick="RonderingRapportPage.copyLink('${pass.id}')">${ic('share-2',14)} Dela</button>
        <button class="btn bs bsm" onclick="window.print()">${ic('printer',14)} Skriv ut</button>
      </div>

      <div class="card" style="margin-bottom:10px;">
        <div class="card-body" style="padding:14px;">
          <div style="font-weight:700;font-size:14px;margin-bottom:10px;">Sammanfattning</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">KUND</div><div style="font-size:13px;font-weight:700;">${esc(cuName)}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">FASTIGHET</div><div style="font-size:13px;font-weight:700;">${prop?esc(prop.name):'—'}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">RONDERING</div><div style="font-size:13px;">${esc(ronName)}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">TILLFÄLLE</div><div style="font-size:13px;">#${pass.sequenceNumber||1}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">DATUM</div><div style="font-size:13px;">${pass.scheduledDate?fmtDate(pass.scheduledDate):'—'}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">UTFÖRARE</div><div style="font-size:13px;">${esc(staffNames||'—')}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">STARTAD</div><div style="font-size:13px;">${pass.startedAt?fmtDate(pass.startedAt):'—'}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">SLUTFÖRD</div><div style="font-size:13px;">${pass.completedAt?fmtDate(pass.completedAt):'Pågår'}</div></div>
            ${faktiskTid?`<div><div style="font-size:10px;color:var(--mt);font-weight:600;">TID</div><div style="font-size:13px;">${faktiskTid}</div></div>`:''}
          </div>
          <div class="ron-kpi4">
            <div class="ron-kpi-cell" style="background:#f0fdf4;">
              <div class="ron-kpi-num" style="color:#166534;">${stats?stats.ok:0}</div>
              <div class="ron-kpi-lbl" style="color:#166534;">Godkända</div>
            </div>
            <div class="ron-kpi-cell" style="background:#fef2f2;">
              <div class="ron-kpi-num" style="color:#991b1b;">${stats?stats.anmärkningar:0}</div>
              <div class="ron-kpi-lbl" style="color:#991b1b;">Anmärkningar</div>
            </div>
            <div class="ron-kpi-cell" style="background:#f9fafb;">
              <div class="ron-kpi-num" style="color:#374151;">${stats?stats.ejAktuell:0}</div>
              <div class="ron-kpi-lbl" style="color:#374151;">Ej aktuell</div>
            </div>
            <div class="ron-kpi-cell" style="background:#eff6ff;">
              <div class="ron-kpi-num" style="color:#1d4ed8;">${stats?stats.total:0}</div>
              <div class="ron-kpi-lbl" style="color:#1d4ed8;">Totalt</div>
            </div>
          </div>
          ${pass.internalNote?`<div style="margin-top:10px;padding:8px;background:#f9fafb;border-radius:6px;font-size:12px;color:var(--mt);"><strong>Anteckning:</strong> ${esc(pass.internalNote)}</div>`:''}
        </div>
      </div>

      ${(pass.categories||[]).map(cat => {
        const pts  = cat.points||[];
        const ok   = pts.filter(p=>p.status==='ok').length;
        const anm  = pts.filter(p=>p.status==='anmärkning').length;
        const ej   = pts.filter(p=>p.status==='ej_aktuell').length;
        const unchecked = pts.filter(p=>p.status==='').length;
        return `
          <div class="card" style="margin-bottom:8px;">
            <div class="ron-sect">
              <span class="ron-sect-title">${esc(cat.name)}</span>
              <span class="ron-sect-meta">${ok} ok · ${anm} anm · ${ej} ej${unchecked?` · ${unchecked} kvar`:''}</span>
            </div>
            <div>
              ${pts.map(pt => {
                const stIcon  = {ok:'check-circle',anmärkning:'alert-triangle',ej_aktuell:'minus-circle',ej_kontrollerad:'circle','':'circle'}[pt.status]||'circle';
                const stColor = {ok:'var(--green)',anmärkning:'var(--rd)',ej_aktuell:'var(--mt)',ej_kontrollerad:'var(--br)','':'var(--br)'}[pt.status]||'var(--br)';
                const stLabel = {ok:'Godkänd',anmärkning:'Anmärkning',ej_aktuell:'Ej aktuell',ej_kontrollerad:'Ej kontrollerad','':'Ej kontrollerad'}[pt.status]||pt.status;
                const avv = pt.deviationId ? getAvv(pt.deviationId) : null;
                return `
                  <div style="padding:8px 14px;border-top:1px solid var(--br);display:flex;align-items:flex-start;gap:10px;">
                    <span style="color:${stColor};flex-shrink:0;margin-top:1px;">${ic(stIcon,15)}</span>
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:13px;font-weight:600;">${esc(pt.title)}</div>
                      ${pt.description?`<div style="font-size:11px;color:var(--mt);">${esc(pt.description)}</div>`:''}
                      <div style="font-size:11px;color:${stColor};font-weight:600;">${stLabel}</div>
                      ${pt.comment&&pt.status!=='anmärkning'?`<div style="font-size:11px;color:var(--mt);">${esc(pt.comment)}</div>`:''}
                      ${pt.checkedAt?`<div style="font-size:10px;color:var(--mt);">${fmtDate(pt.checkedAt)}</div>`:''}
                      ${avv?`
                        <div class="ron-anm">
                          <div class="ron-anm-title">${esc(avv.title)}</div>
                          ${avv.comment?`<div class="ron-anm-body">${esc(avv.comment)}</div>`:''}
                          ${avv && avv.images && avv.images.length > 0 ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">${avv.images.map(img=>`<img src="${img.url}" class="ron-img-thumb">`).join('')}</div>` : ''}
                          <div class="ron-anm-actions">
                            ${pbdg(avv.priority)}
                            ${avv.workOrderId
                              ?`<span class="bdg bdg-green" style="cursor:pointer;" onclick="Router.showPage('pg-ao-detail',{aoId:'${avv.workOrderId}'})">${ic('clipboard',9)} ${avv.workOrderId}</span>`
                              :`<button class="btn bp bsm" style="font-size:11px;" onclick="RonderingRapportPage.createAO('${avv.id}')">Skapa AO</button>`}
                          </div>
                        </div>`:''}
                      ${pt.workOrderId&&!avv?`<div style="margin-top:4px;"><span class="bdg bdg-green" style="cursor:pointer;font-size:10px;" onclick="Router.showPage('pg-ao-detail',{aoId:'${pt.workOrderId}'})">${ic('clipboard',9)} ${pt.workOrderId}</span></div>`:''}
                    </div>
                  </div>`;
              }).join('')}
            </div>
          </div>`;
      }).join('')}

      ${avvikelser.length>0?`
        <div class="card" style="margin-bottom:8px;">
          <div class="card-head" style="padding:10px 14px;">
            <span style="font-weight:700;font-size:14px;">${ic('alert-triangle',15)} Anmärkningar (${avvikelser.length})</span>
          </div>
          ${avvikelser.map(avv=>`
            <div style="padding:8px 14px;border-top:1px solid var(--br);">
              <div class="ron-anm">
                <div class="ron-anm-title">${esc(avv.title)}</div>
                <div class="ron-anm-body">${esc(avv.categoryName||'')} › ${esc(avv.pointTitle||'')}</div>
                ${avv.comment?`<div class="ron-anm-body" style="margin-top:2px;">${esc(avv.comment)}</div>`:''}
                <div class="ron-anm-actions">
                  ${pbdg(avv.priority)}
                  ${avv.workOrderId
                    ?`<span class="bdg bdg-green" style="cursor:pointer;" onclick="Router.showPage('pg-ao-detail',{aoId:'${avv.workOrderId}'})">${ic('clipboard',9)} ${avv.workOrderId}</span>`
                    :`<button class="btn bp bsm" style="font-size:11px;" onclick="RonderingRapportPage.createAO('${avv.id}','${pass.id}')">Skapa AO</button>`}
                </div>
              </div>
            </div>`).join('')}
        </div>`:''}

      ${(()=>{
        const aoIds = [...new Set([
          ...avvikelser.map(a=>a.workOrderId),
          ...(pass.categories||[]).flatMap(cat=>(cat.points||[]).map(pt=>pt.workOrderId))
        ].filter(Boolean))];
        const aos = aoIds.map(id=>getAO(id)).filter(Boolean);
        if (!aos.length) return '';
        return `
          <div class="card" style="margin-bottom:8px;">
            <div class="card-head" style="padding:10px 14px;">
              <span style="font-weight:700;font-size:14px;">${ic('clipboard',15)} Skapade arbetsorder (${aos.length})</span>
            </div>
            ${aos.map(ao=>`
              <div style="padding:8px 14px;border-top:1px solid var(--br);display:flex;align-items:center;gap:10px;">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;">${ao.id} — ${esc(ao.title)}</div>
                  <div style="font-size:11px;color:var(--mt);">${statusLabel(ao.status)}</div>
                </div>
                <button class="btn bs bsm" style="font-size:10px;" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">Öppna</button>
              </div>`).join('')}
          </div>`;
      })()}

      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
        <button class="btn bs" onclick="Router.showPage('pg-rondering')">Alla ronderingar</button>
        ${pass.status==='pågående'?`<button class="btn bp" onclick="Router.showPage('pg-rondering-utfor',{passId:'${pass.id}'})">Fortsätt utförande</button>`:''}
      </div>`;
  },

  _renderLegacy(el, ron) {
    // Fallback for RON without any PASS (truly legacy, should be rare after migration)
    const cu     = getCu(ron.customerId);
    const cuName = cu ? (cu.name||(cu.firstName+' '+cu.lastName).trim()) : '—';
    const prop   = ron.propertyId ? getObj(ron.propertyId) : null;
    const stats  = RonderingService.getStats(ron.id);
    const avvikelser = (ron.deviationIds||[]).map(id=>getAvv(id)).filter(Boolean);

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <button class="btn bs bsm" onclick="Router.back()">${ic('arrow-left',14)}</button>
        <div style="flex:1;"><div style="font-size:16px;font-weight:800;">Ronderingsrapport</div>
          <div style="font-size:11px;color:var(--mt);">${esc(ron.id)} (historisk data)</div></div>
      </div>
      <div class="ibox" style="margin-bottom:10px;font-size:12px;">
        ${ic('info',13)} Historisk rondering utan tillfällesdata. Visar direkt från ronderingsdata.
      </div>
      <div class="card" style="margin-bottom:10px;">
        <div class="card-body" style="padding:14px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">KUND</div><div style="font-size:13px;">${esc(cuName)}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">FASTIGHET</div><div style="font-size:13px;">${prop?esc(prop.name):'—'}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">UTFÖRARE</div><div style="font-size:13px;">${esc(ron.performedByName||'—')}</div></div>
            <div><div style="font-size:10px;color:var(--mt);font-weight:600;">SLUTFÖRD</div><div style="font-size:13px;">${ron.completedAt?fmtDate(ron.completedAt):'—'}</div></div>
          </div>
          <div class="ron-kpi3" style="margin-top:10px;">
            <div class="ron-kpi-cell" style="background:#f0fdf4;">
              <div class="ron-kpi-num" style="color:#166534;">${stats?stats.ok:0}</div>
              <div class="ron-kpi-lbl" style="color:#166534;">Godkända</div>
            </div>
            <div class="ron-kpi-cell" style="background:#fef2f2;">
              <div class="ron-kpi-num" style="color:#991b1b;">${stats?stats.avvs:0}</div>
              <div class="ron-kpi-lbl" style="color:#991b1b;">Avvikelser</div>
            </div>
            <div class="ron-kpi-cell" style="background:#eff6ff;">
              <div class="ron-kpi-num" style="color:#1d4ed8;">${stats?stats.total:0}</div>
              <div class="ron-kpi-lbl" style="color:#1d4ed8;">Totalt</div>
            </div>
          </div>
        </div>
      </div>
      ${(ron.results||[]).map(cat=>{
        const pts = cat.points||[];
        return `<div class="card" style="margin-bottom:8px;">
          <div class="card-head" style="padding:10px 14px;font-weight:700;font-size:14px;">${esc(cat.categoryName)}</div>
          ${pts.map(pt=>{
            const stColor = {ok:'var(--green)',avvikelse:'var(--rd)',ej_aktuell:'var(--mt)','':'var(--br)'}[pt.status]||'var(--br)';
            const stIcon  = {ok:'check-circle',avvikelse:'alert-triangle',ej_aktuell:'minus-circle','':'circle'}[pt.status]||'circle';
            const stLabel = {ok:'Godkänd',avvikelse:'Avvikelse',ej_aktuell:'Ej aktuell','':'Ej kontrollerad'}[pt.status]||pt.status;
            return `<div style="padding:8px 14px;border-top:1px solid var(--br);display:flex;gap:10px;align-items:flex-start;">
              <span style="color:${stColor};flex-shrink:0;">${ic(stIcon,14)}</span>
              <div><div style="font-size:13px;font-weight:600;">${esc(pt.pointTitle)}</div>
              <div style="font-size:11px;color:${stColor};">${stLabel}${pt.comment?' — '+esc(pt.comment):''}</div></div>
            </div>`;
          }).join('')}
        </div>`;
      }).join('')}
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn bs" onclick="Router.showPage('pg-rondering')">Alla ronderingar</button>
      </div>`;
  },

  createAO(avvId, passId) {
    const ao = RonderingService.createAOFromAvvikelse(avvId, passId);
    if (ao) {
      showToast('AO ' + ao.id + ' skapad');
      const params = { ronderingId: (getAvv(avvId)||{}).ronderingId };
      if (passId) params.passId = passId;
      this.render(params);
    }
  }
};
