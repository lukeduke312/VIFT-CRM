/**
 * RonderingWizardPage — 4-stegs wizard för att skapa/redigera rondering
 * Steg 1: Ronderingsinfo · Steg 2: Kontrollpunkter · Steg 3: Tillfällen · Steg 4: Prissättning
 */
const RonderingWizardPage = {

  _step: 1,
  _editId: null,

  _d: {
    name: '', customerId: '', propertyId: '', description: '',
    internalNote: '', isDraft: false, priority: 'normal',
    categories: [],
    templateId: '', templateName: '',
    occasions: [],
    recurringSetups: [],
    pricingType: '', priceGroupId: '', priceGroupName: '', hourRate: 0, fixedPrice: 0, debiterbar: true
  },

  render(params) {
    const el = document.getElementById('pg-rondering-wizard-content');
    if (!el) return;
    params = params || {};

    if (params.reset !== false) {
      this._step = 1;
      this._editId = params.ronderingId || null;
      this._d = {
        name: '', customerId: params.customerId || '', propertyId: params.propertyId || '',
        description: '', internalNote: '', isDraft: false, priority: 'normal',
        categories: [], templateId: '', templateName: '',
        occasions: [], recurringSetups: [],
        pricingType: '', priceGroupId: '', priceGroupName: '', hourRate: 0, fixedPrice: 0, debiterbar: true
      };

      if (this._editId) {
        const ron = getRon(this._editId);
        if (ron) {
          this._d = {
            name: ron.name || '',
            customerId: ron.customerId || '',
            propertyId: ron.propertyId || '',
            description: ron.description || '',
            internalNote: ron.internalNote || '',
            isDraft: ron.isDraft || false,
            priority: ron.priority || 'normal',
            categories: JSON.parse(JSON.stringify(ron.categories || [])),
            templateId: ron.templateId || '',
            templateName: ron.templateName || '',
            occasions: JSON.parse(JSON.stringify(ron.occasions || [])),
            recurringSetups: JSON.parse(JSON.stringify(ron.recurringSetups || [])),
            pricingType: ron.pricingType || '',
            priceGroupId: ron.priceGroupId || '',
            priceGroupName: ron.priceGroupName || '',
            hourRate: ron.hourRate || 0,
            fixedPrice: ron.fixedPrice || 0,
            debiterbar: ron.debiterbar !== false
          };
        }
      }
    }

    this._renderWizard(el);
  },

  _renderWizard(el) {
    const steps = ['Ronderingsinfo', 'Kontrollpunkter', 'Tillfällen', 'Prissättning'];

    const stepInd = `
      <div style="display:flex;align-items:flex-start;margin-bottom:20px;">
        ${steps.map((lbl, i) => {
          const n      = i + 1;
          const active = n === this._step;
          const done   = n < this._step;
          const circBg  = active ? 'var(--navy)' : done ? 'var(--green)' : '#e2e8f0';
          const circClr = (active || done) ? '#fff' : '#94a3b8';
          const lblClr  = active ? 'var(--navy)' : done ? 'var(--green)' : '#94a3b8';
          const lineClr = done ? 'var(--green)' : '#e2e8f0';
          const circ = `<div style="width:28px;height:28px;border-radius:50%;background:${circBg};color:${circClr};
              display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${done?'14px':'12px'};
              flex-shrink:0;cursor:${done?'pointer':'default'};"
              ${done ? `onclick="RonderingWizardPage._goToStep(${n})"` : ''}>${done ? '✓' : n}</div>`;
          const lbl2 = `<div style="font-size:9px;font-weight:700;color:${lblClr};margin-top:4px;text-align:center;line-height:1.3;padding:0 2px;">${lbl}</div>`;
          const line = i < steps.length - 1
            ? `<div style="flex:0 0 14px;height:2px;background:${lineClr};margin-top:14px;"></div>`
            : '';
          return `<div style="display:flex;flex-direction:column;align-items:center;flex:1;">${circ}${lbl2}</div>${line}`;
        }).join('')}
      </div>`;

    let content = '';
    if (this._step === 1) content = this._renderStep1();
    else if (this._step === 2) content = this._renderStep2();
    else if (this._step === 3) content = this._renderStep3();
    else if (this._step === 4) content = this._renderStep4();

    const isLast  = this._step === 4;
    const isFirst = this._step === 1;
    const ron = this._editId ? getRon(this._editId) : null;
    const canStart = ron && (ron.status === 'planerad' || ron.status === 'pågående');

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <button class="btn bs bsm" onclick="Router.back()">${ic('arrow-left', 14)}</button>
        <div style="flex:1;font-weight:800;font-size:15px;">${this._editId ? 'Redigera rondering' : 'Ny rondering'}</div>
        <button class="btn bs bsm" onclick="RonderingWizardPage._saveDraft()">Spara utkast</button>
      </div>
      ${stepInd}
      <div id="wizard-step-content">${content}</div>
      ${canStart ? `
        <div style="margin-top:12px;padding:10px 14px;background:#f0fdf4;border:1px solid #86efac;border-radius:10px;display:flex;align-items:center;gap:10px;">
          <span style="color:#16a34a;font-size:12px;flex:1;">Rondering klar att utföra</span>
          <button class="btn bsm" style="background:#16a34a;color:#fff;border-color:#16a34a;font-weight:700;"
            onclick="RonderingWizardPage._saveAndStart()">${ic('play',13)} Starta utförande</button>
        </div>` : ''}
      <div style="display:flex;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--br);">
        ${!isFirst
          ? `<button class="btn bs" style="flex:1;" onclick="RonderingWizardPage._prevStep()">${ic('arrow-left',13)} Tillbaka</button>`
          : `<button class="btn bs" style="flex:1;" onclick="Router.back()">Avbryt</button>`}
        ${isLast
          ? `<button class="btn bp" style="flex:2;" onclick="RonderingWizardPage._save()">${ic('save',14)} Spara rondering</button>`
          : `<button class="btn bp" style="flex:2;" onclick="RonderingWizardPage._nextStep()">Nästa ${ic('arrow-right',13)}</button>`}
      </div>`;
  },

  // ── Step 1 ───────────────────────────────────────────────────────────────

  _renderStep1() {
    const customers = state.customers || [];
    const prios = [{v:'låg',l:'Låg'},{v:'normal',l:'Normal'},{v:'hög',l:'Hög'},{v:'akut',l:'Akut'}];
    return `
      <div class="fg"><label>Namn på rondering *</label>
        <input type="text" id="wiz-name" value="${this._esc(this._d.name)}" placeholder="T.ex. Månadsrondering BRF Solgläntan">
      </div>
      <div class="fg"><label>Kund *</label>
        <select id="wiz-cu" onchange="RonderingWizardPage._onCustomerChange(this.value)">
          <option value="">Välj kund...</option>
          ${customers.map(c => `<option value="${c.id}"${c.id===this._d.customerId?' selected':''}>${this._esc(c.name||((c.firstName||'')+' '+(c.lastName||'')).trim())}</option>`).join('')}
        </select>
      </div>
      <div class="fg"><label>Fastighet / objekt</label>
        <select id="wiz-prop">
          <option value="">Ingen fastighet vald</option>
          ${(state.properties||[]).filter(p=>!this._d.customerId||p.customerId===this._d.customerId).map(p =>
            `<option value="${p.id}"${p.id===this._d.propertyId?' selected':''}>${this._esc(p.name+(p.address?' – '+p.address:''))}</option>`
          ).join('')}
        </select>
      </div>
      <div class="fg"><label>Prioritet</label>
        <select id="wiz-priority">
          ${prios.map(p=>`<option value="${p.v}"${this._d.priority===p.v?' selected':''}>${p.l}</option>`).join('')}
        </select>
      </div>
      <div class="fg"><label>Beskrivning / syfte</label>
        <textarea id="wiz-desc" rows="3" placeholder="Beskriv vad ronderingen ska täcka...">${this._esc(this._d.description)}</textarea>
      </div>
      <div class="fg"><label>Intern notering</label>
        <textarea id="wiz-note" rows="2" placeholder="Interna anteckningar (syns ej i rapport)...">${this._esc(this._d.internalNote)}</textarea>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-top:4px;cursor:pointer;">
        <input type="checkbox" id="wiz-draft" ${this._d.isDraft?'checked':''}> Spara som utkast
      </label>`;
  },

  _onCustomerChange(cuId) {
    this._readStep1();
    this._d.customerId = cuId;
    this._d.propertyId = '';
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep1();
  },

  // ── Step 2 ───────────────────────────────────────────────────────────────

  _renderStep2() {
    const mallar = (state.ronderingsmallar || []).filter(m => m.active);
    const cats   = this._d.categories;
    const total  = cats.reduce((s, c) => s + (c.points || []).length, 0);

    return `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
        <div style="flex:1;">
          <div style="font-weight:700;font-size:14px;">Grupper och kontrollpunkter</div>
          ${cats.length > 0 ? `<div style="font-size:11px;color:var(--mt);margin-top:2px;">${cats.length} grupp${cats.length!==1?'er':''} · ${total} punkt${total!==1?'er':''}</div>` : ''}
        </div>
        ${mallar.length > 0 ? `
          <div class="fg" style="margin:0;min-width:160px;max-width:200px;">
            <select id="wiz-mall-select" onchange="RonderingWizardPage._loadMall(this.value)">
              <option value="">Ladda mall...</option>
              ${mallar.map(m => `<option value="${m.id}">${this._esc(m.name)}</option>`).join('')}
            </select>
          </div>` : ''}
      </div>

      ${cats.length === 0 ? `
        <div style="padding:24px;text-align:center;border:2px dashed var(--br);border-radius:12px;margin-bottom:12px;background:#fafbfc;">
          <div style="color:var(--mt);font-size:13px;font-weight:600;margin-bottom:4px;">Inga grupper tillagda</div>
          <div style="font-size:12px;color:var(--mt);">Välj en mall ovan eller skapa grupper manuellt nedan</div>
        </div>` : ''}

      <div id="wiz-cats">
        ${cats.map((cat, ci) => this._catHtml(cat, ci)).join('')}
      </div>

      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
        <button class="btn bs bsm" onclick="RonderingWizardPage._addCategory()">${ic('plus',12)} Lägg till grupp</button>
        ${cats.length > 0 ? `<button class="btn bs bsm" onclick="RonderingWizardPage._openSaveAsMall()">${ic('layout-template',12)} Spara som mall</button>` : ''}
      </div>`;
  },

  _catHtml(cat, ci) {
    const pts = cat.points || [];
    return `
      <div class="card" style="margin-bottom:10px;" id="cat-block-${ci}">
        <div style="padding:10px 12px;border-bottom:1px solid var(--br);display:flex;gap:6px;align-items:center;background:#fafbfc;border-radius:10px 10px 0 0;">
          <div style="display:flex;flex-direction:column;gap:1px;flex-shrink:0;">
            <button class="btn bs" style="padding:0 5px;line-height:1.6;font-size:10px;" onclick="RonderingWizardPage._moveCat(${ci},-1)">▲</button>
            <button class="btn bs" style="padding:0 5px;line-height:1.6;font-size:10px;" onclick="RonderingWizardPage._moveCat(${ci},1)">▼</button>
          </div>
          <input type="text" placeholder="Grupprubrik *" value="${this._esc(cat.name)}"
            id="cat-name-${ci}" style="flex:1;padding:7px 9px;border:1px solid var(--br);border-radius:7px;font-size:13px;font-weight:700;background:var(--wh);">
          <div style="font-size:11px;color:var(--mt);white-space:nowrap;flex-shrink:0;">${pts.length} pt</div>
          <button class="btn bd bsm" onclick="RonderingWizardPage._removeCat(${ci})" title="Ta bort grupp">${ic('trash-2',13)}</button>
        </div>
        <div style="padding:10px 12px;">
          <div id="cat-pts-${ci}">
            ${pts.map((pt, pi) => this._ptHtml(ci, pi, pt)).join('')}
          </div>
          <button class="btn bs bsm" style="margin-top:6px;width:100%;text-align:center;" onclick="RonderingWizardPage._addPoint(${ci})">
            ${ic('plus',12)} Lägg till kontrollpunkt
          </button>
        </div>
      </div>`;
  },

  _ptHtml(ci, pi, pt) {
    return `
      <div style="background:#f9fafb;border:1px solid var(--br);border-radius:8px;padding:8px 10px;margin-bottom:6px;" id="pt-block-${ci}-${pi}">
        <div style="display:flex;gap:6px;align-items:flex-start;">
          <div style="display:flex;flex-direction:column;gap:1px;flex-shrink:0;padding-top:4px;">
            <button class="btn bs" style="padding:0 4px;line-height:1.6;font-size:9px;" onclick="RonderingWizardPage._movePt(${ci},${pi},-1)">▲</button>
            <button class="btn bs" style="padding:0 4px;line-height:1.6;font-size:9px;" onclick="RonderingWizardPage._movePt(${ci},${pi},1)">▼</button>
          </div>
          <div style="flex:1;min-width:0;">
            <input type="text" placeholder="Kontrollpunktens namn *" value="${this._esc(pt.title)}"
              id="pt-title-${ci}-${pi}" style="width:100%;padding:5px 8px;border:1px solid var(--br);border-radius:6px;font-size:12px;font-weight:600;margin-bottom:4px;box-sizing:border-box;">
            <input type="text" placeholder="Instruktion / beskrivning (valfri)" value="${this._esc(pt.description||'')}"
              id="pt-desc-${ci}-${pi}" style="width:100%;padding:4px 8px;border:1px solid var(--br);border-radius:6px;font-size:11px;color:var(--mt);margin-bottom:6px;box-sizing:border-box;">
            <label style="display:flex;align-items:flex-start;gap:6px;cursor:pointer;">
              <input type="checkbox" id="pt-ao-${ci}-${pi}" ${pt.canCreateAO!==false?'checked':''} style="margin-top:1px;">
              <div>
                <div style="font-size:11px;font-weight:600;">Tillåt arbetsorder vid avvikelse</div>
                <div style="font-size:10px;color:var(--mt);margin-top:1px;">Möjliggör att skapa AO direkt från avvikelsen vid utförande</div>
              </div>
            </label>
          </div>
          <button class="btn bd bsm" style="flex-shrink:0;align-self:flex-start;" onclick="RonderingWizardPage._removePt(${ci},${pi})">${ic('x',12)}</button>
        </div>
      </div>`;
  },

  _esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  },

  // Sync DOM → _d without dropping empty names or titles
  _syncStep2() {
    const cats = [];
    this._d.categories.forEach((origCat, ci) => {
      const nameEl  = document.getElementById('cat-name-' + ci);
      const catName = nameEl ? nameEl.value : origCat.name;
      const points  = [];
      (origCat.points || []).forEach((origPt, pi) => {
        const titleEl = document.getElementById('pt-title-' + ci + '-' + pi);
        if (!titleEl) { points.push(origPt); return; }
        const title       = titleEl.value;
        const desc        = (document.getElementById('pt-desc-'+ ci + '-' + pi)||{}).value || '';
        const canCreateAO = (document.getElementById('pt-ao-'  + ci + '-' + pi)||{}).checked !== false;
        points.push({ id: origPt.id, title, description: desc, canCreateAO, sortOrder: pi });
      });
      cats.push({ id: origCat.id, name: catName, sortOrder: ci, points });
    });
    this._d.categories = cats;
  },

  _rerender2() {
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep2();
  },

  _addCategory() {
    this._syncStep2();
    this._d.categories.push({
      id: 'cat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      name: '', sortOrder: this._d.categories.length, points: []
    });
    this._rerender2();
  },

  _removeCat(ci) {
    this._syncStep2();
    this._d.categories.splice(ci, 1);
    this._rerender2();
  },

  _moveCat(ci, dir) {
    this._syncStep2();
    const cats = this._d.categories;
    const ni   = ci + dir;
    if (ni < 0 || ni >= cats.length) return;
    [cats[ci], cats[ni]] = [cats[ni], cats[ci]];
    this._rerender2();
  },

  _addPoint(ci) {
    this._syncStep2();
    const cat = this._d.categories[ci];
    if (!cat) return;
    cat.points.push({
      id: 'pt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      title: '', description: '', canCreateAO: true, sortOrder: cat.points.length
    });
    this._rerender2();
  },

  _removePt(ci, pi) {
    this._syncStep2();
    const cat = this._d.categories[ci];
    if (!cat) return;
    cat.points.splice(pi, 1);
    this._rerender2();
  },

  _movePt(ci, pi, dir) {
    this._syncStep2();
    const cat = this._d.categories[ci];
    if (!cat) return;
    const pts = cat.points;
    const ni  = pi + dir;
    if (ni < 0 || ni >= pts.length) return;
    [pts[pi], pts[ni]] = [pts[ni], pts[pi]];
    this._rerender2();
  },

  _loadMall(mallId) {
    if (!mallId) return;
    const mall = getMall(mallId);
    if (!mall) return;

    const doLoad = (replace) => {
      const newCats = JSON.parse(JSON.stringify(mall.categories || []));
      if (!replace) {
        const ts = Date.now();
        newCats.forEach(c => {
          c.id = c.id + '-' + ts;
          (c.points || []).forEach(p => { p.id = p.id + '-' + ts; });
        });
        this._d.categories = this._d.categories.concat(newCats);
      } else {
        this._d.categories = newCats;
        if (!this._d.name) this._d.name = mall.name;
      }
      this._d.templateId   = mall.id;
      this._d.templateName = mall.name;
      this._rerender2();
    };

    if (this._d.categories.length > 0) {
      Modal.open({
        title: 'Ladda mall',
        body: `<p style="font-size:13px;margin:0 0 8px;">Mall: <strong>${this._esc(mall.name)}</strong></p>
          <p style="font-size:12px;color:var(--mt);margin:0;">Du har redan ${this._d.categories.length} grupp(er). Vad ska hända?</p>`,
        buttons: [
          { label: 'Ersätt befintliga',        cls: 'btn bd bfull', onClick: () => { Modal.close(); doLoad(true);  } },
          { label: 'Lägg till efter befintliga', cls: 'btn bs bfull', onClick: () => { Modal.close(); doLoad(false); } },
          { label: 'Avbryt',                    cls: 'btn bs',       onClick: () => Modal.close() }
        ]
      });
    } else {
      doLoad(true);
    }
  },

  _openSaveAsMall() {
    this._syncStep2();
    Modal.open({
      title: 'Spara som mall',
      body: `<div class="fg"><label>Mallnamn *</label>
        <input type="text" id="save-mall-name" value="${this._esc(this._d.name || '')}" placeholder="T.ex. Månadsrondering BRF">
      </div>`,
      buttons: [
        { label: 'Spara mall', cls: 'btn bp bfull', onClick: () => {
          const name = (document.getElementById('save-mall-name') || {}).value || '';
          if (!name.trim()) { showToast('Ange mallnamn'); return; }
          RonderingService.createMall({
            name: name.trim(), description: this._d.description || '',
            categories: JSON.parse(JSON.stringify(this._d.categories)),
            customerId: this._d.customerId || '', interval: 'månadsvis', active: true
          });
          Modal.close();
          showToast('Mall sparad');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  // ── Step 3 ───────────────────────────────────────────────────────────────

  _renderStep3() {
    const staff = (state.staff || []).filter(s => s.active);
    const occs  = this._d.occasions;
    const recs  = this._d.recurringSetups;
    const intervals = [
      {v:'dagligen',l:'Dagligen'},{v:'veckovis',l:'Veckovis'},
      {v:'varannan_vecka',l:'Varannan vecka'},{v:'månadsvis',l:'Månadsvis'},
      {v:'kvartalsvis',l:'Kvartalsvis'},{v:'årsvis',l:'Årsvis'},{v:'eget',l:'Eget antal dagar'}
    ];
    const fmtDur = (m) => !m ? '' : m >= 60
      ? (Math.floor(m/60)+'h'+(m%60?''+(m%60)+'min':''))
      : (m+'min');

    return `
      <div style="font-weight:700;font-size:14px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--br);">Enstaka tillfällen</div>
      ${occs.length === 0 ? `<div style="font-size:12px;color:var(--mt);margin-bottom:8px;padding:10px;background:#f9fafb;border-radius:8px;">Inga enstaka tillfällen tillagda.</div>` : ''}
      ${occs.map((occ, oi) => `
        <div style="background:#f9fafb;border:1px solid var(--br);border-radius:8px;padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;gap:8px;">
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:700;">${fmtDate(occ.date)}${occ.time?' kl '+occ.time:''}</div>
            <div style="font-size:11px;color:var(--mt);">${occ.staffName||'Ej tilldelad'}${occ.estimatedDuration?' · '+fmtDur(occ.estimatedDuration):''}${occ.comment?' · '+occ.comment:''}</div>
          </div>
          <button class="btn bd bsm" onclick="RonderingWizardPage._removeOcc(${oi})">${ic('x',12)}</button>
        </div>`).join('')}
      <div class="card" style="margin-bottom:16px;">
        <div class="card-body" style="padding:12px 14px;">
          <div style="font-size:12px;font-weight:700;margin-bottom:10px;">Lägg till enstaka tillfälle</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div class="fg"><label>Datum</label><input type="date" id="occ-date" value="${tdy()}"></div>
            <div class="fg"><label>Starttid</label><input type="time" id="occ-time" value="09:00"></div>
          </div>
          <div class="fg"><label>Planerad tidsåtgång (min)</label>
            <input type="number" id="occ-duration" value="60" min="0" step="15" placeholder="60">
          </div>
          <div class="fg"><label>Tilldelad personal</label>
            <select id="occ-staff">
              <option value="">Ej tilldelad</option>
              ${staff.map(s=>`<option value="${s.id}">${s.firstName} ${s.lastName}</option>`).join('')}
            </select>
          </div>
          <div class="fg"><label>Kommentar</label><input type="text" id="occ-comment" placeholder="Valfri kommentar"></div>
          <button class="btn bp bsm" style="margin-top:6px;" onclick="RonderingWizardPage._addOcc()">Lägg till tillfälle</button>
        </div>
      </div>

      <div style="font-weight:700;font-size:14px;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--br);">Återkommande</div>
      ${recs.length === 0 ? `<div style="font-size:12px;color:var(--mt);margin-bottom:8px;padding:10px;background:#f9fafb;border-radius:8px;">Inget återkommande upplägg tillagt.</div>` : ''}
      ${recs.map((rec, ri) => {
        const lbl = {dagligen:'Dagligen',veckovis:'Veckovis',varannan_vecka:'Varannan vecka',månadsvis:'Månadsvis',kvartalsvis:'Kvartalsvis',årsvis:'Årsvis',eget:'Var '+rec.intervalDays+' dag(ar)'}[rec.interval]||rec.interval;
        return `
          <div style="background:#f9fafb;border:1px solid var(--br);border-radius:8px;padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;gap:8px;">
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:700;">${lbl}${rec.time?' kl '+rec.time:''}</div>
              <div style="font-size:11px;color:var(--mt);">Fr.o.m. ${fmtDate(rec.startDate)} · ${rec.tillsvidare?'Tills vidare':'T.o.m. '+(rec.endDate?fmtDate(rec.endDate):'')}${rec.estimatedDuration?' · '+fmtDur(rec.estimatedDuration):''} · ${rec.staffName||'Ej tilldelad'}</div>
            </div>
            <button class="btn bd bsm" onclick="RonderingWizardPage._removeRec(${ri})">${ic('x',12)}</button>
          </div>`;
      }).join('')}
      <div class="card">
        <div class="card-body" style="padding:12px 14px;">
          <div style="font-size:12px;font-weight:700;margin-bottom:10px;">Lägg till återkommande</div>
          <div class="fg"><label>Intervall</label>
            <select id="rec-interval" onchange="RonderingWizardPage._onRecIntervalChange(this.value)">
              ${intervals.map(i=>`<option value="${i.v}">${i.l}</option>`).join('')}
            </select>
          </div>
          <div id="rec-interval-extra"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div class="fg"><label>Startdatum</label><input type="date" id="rec-start" value="${tdy()}"></div>
            <div class="fg"><label>Starttid</label><input type="time" id="rec-time" value="09:00"></div>
          </div>
          <div class="fg"><label>Planerad tidsåtgång per tillfälle (min)</label>
            <input type="number" id="rec-duration" value="60" min="0" step="15" placeholder="60">
          </div>
          <div class="fg"><label>Tilldelad personal</label>
            <select id="rec-staff">
              <option value="">Ej tilldelad</option>
              ${staff.map(s=>`<option value="${s.id}">${s.firstName} ${s.lastName}</option>`).join('')}
            </select>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:8px;cursor:pointer;font-weight:600;">
            <input type="checkbox" id="rec-tillsvidare" checked
              onchange="document.getElementById('rec-end-row').style.display=this.checked?'none':'block';">
            Tills vidare
          </label>
          <div id="rec-end-row" style="display:none;">
            <div class="fg"><label>Slutdatum</label><input type="date" id="rec-end"></div>
          </div>
          <button class="btn bp bsm" style="margin-top:6px;" onclick="RonderingWizardPage._addRec()">Lägg till</button>
        </div>
      </div>`;
  },

  _onRecIntervalChange(val) {
    const el = document.getElementById('rec-interval-extra');
    if (!el) return;
    if (val === 'veckovis') {
      el.innerHTML = `<div class="fg"><label>Veckodag</label>
        <select id="rec-weekday">
          <option value="1">Måndag</option><option value="2">Tisdag</option><option value="3">Onsdag</option>
          <option value="4">Torsdag</option><option value="5">Fredag</option><option value="6">Lördag</option><option value="0">Söndag</option>
        </select></div>`;
    } else if (val === 'månadsvis') {
      el.innerHTML = `<div class="fg"><label>Dag i månaden</label>
        <select id="rec-dom">${Array.from({length:31},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}</select></div>`;
    } else if (val === 'eget') {
      el.innerHTML = `<div class="fg"><label>Antal dagar mellan tillfällen</label><input type="number" id="rec-days" value="14" min="1"></div>`;
    } else {
      el.innerHTML = '';
    }
  },

  _addOcc() {
    const date              = (document.getElementById('occ-date')    || {}).value || '';
    const time              = (document.getElementById('occ-time')    || {}).value || '';
    const estimatedDuration = parseInt((document.getElementById('occ-duration') || {}).value || '0', 10) || 0;
    const staffId           = (document.getElementById('occ-staff')   || {}).value || '';
    const comment           = (document.getElementById('occ-comment') || {}).value || '';
    if (!date) { showToast('Välj datum'); return; }
    const s = staffId ? getStaff(staffId) : null;
    this._d.occasions.push({
      id: 'occ-' + Date.now(), date, time, estimatedDuration, staffId,
      staffName: s ? (s.firstName + ' ' + s.lastName).trim() : '',
      comment
    });
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep3();
  },

  _removeOcc(oi) {
    this._d.occasions.splice(oi, 1);
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep3();
  },

  _addRec() {
    const interval          = (document.getElementById('rec-interval')    || {}).value || 'månadsvis';
    const startDate         = (document.getElementById('rec-start')       || {}).value || tdy();
    const time              = (document.getElementById('rec-time')        || {}).value || '';
    const estimatedDuration = parseInt((document.getElementById('rec-duration') || {}).value || '0', 10) || 0;
    const tillsvidare       = !!(document.getElementById('rec-tillsvidare') || {}).checked;
    const endDate           = tillsvidare ? '' : ((document.getElementById('rec-end') || {}).value || '');
    const staffId           = (document.getElementById('rec-staff')       || {}).value || '';
    const weekday           = (document.getElementById('rec-weekday')     || {}).value || '';
    const dayOfMonth        = (document.getElementById('rec-dom')         || {}).value || '';
    const intervalDays      = parseInt((document.getElementById('rec-days') || {}).value || '14', 10) || 14;
    const s = staffId ? getStaff(staffId) : null;
    this._d.recurringSetups.push({
      id: 'rec-' + Date.now(), interval, intervalDays, startDate, endDate, tillsvidare,
      time, estimatedDuration, weekday, dayOfMonth, staffId,
      staffName: s ? (s.firstName + ' ' + s.lastName).trim() : ''
    });
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep3();
  },

  _removeRec(ri) {
    this._d.recurringSetups.splice(ri, 1);
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep3();
  },

  // ── Step 4 ───────────────────────────────────────────────────────────────

  _renderStep4() {
    const priceGroups = (state.priceGroups || []).filter(pg => pg.active);
    const pt = this._d.pricingType;

    return `
      <div style="font-weight:700;font-size:14px;margin-bottom:12px;">Prissättning</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
        ${[
          {v:'tim',  l:'Timpris',                 desc:'Faktureras per nedlagd tid med vald prisgrupp'},
          {v:'fast', l:'Fast pris per tillfälle',  desc:'Fast pris debiteras per utförd rondering'},
          {v:'',     l:'Utan prissättning',        desc:'Ingen fakturering / internt arbete'}
        ].map(opt => `
          <label style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:2px solid ${pt===opt.v?'var(--navy)':'var(--br)'};border-radius:10px;cursor:pointer;background:${pt===opt.v?'#f0f4ff':'var(--wh)'};"
            onclick="RonderingWizardPage._setPricingType('${opt.v}')">
            <input type="radio" name="pricing-type" value="${opt.v}" ${pt===opt.v?'checked':''} style="margin-top:2px;">
            <div>
              <div style="font-weight:700;font-size:13px;">${opt.l}</div>
              <div style="font-size:11px;color:var(--mt);">${opt.desc}</div>
            </div>
          </label>`).join('')}
      </div>
      ${pt === 'tim' ? `
        <div class="fg"><label>Prisgrupp</label>
          <select id="wiz-pg" onchange="RonderingWizardPage._onPGChange(this.value)">
            <option value="">Välj prisgrupp...</option>
            ${priceGroups.map(pg=>`<option value="${pg.id}"${pg.id===this._d.priceGroupId?' selected':''}>${this._esc(pg.name)} – ${fmt(pg.hourRate)} kr/tim</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label>Timpris ex moms (kr)</label>
          <input type="number" id="wiz-hourrate" value="${this._d.hourRate||0}" placeholder="695" style="background:#f9fafb;">
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-top:4px;cursor:pointer;">
          <input type="checkbox" id="wiz-debiterbar" ${this._d.debiterbar!==false?'checked':''}> Debiterbar tid
        </label>` : ''}
      ${pt === 'fast' ? `
        <div class="fg"><label>Fast pris ex moms (kr)</label>
          <input type="number" id="wiz-fixedprice" value="${this._d.fixedPrice||0}" placeholder="0"
            oninput="RonderingWizardPage._liveVAT(this.value)">
        </div>
        <div id="wiz-vat-calc" style="margin-top:8px;padding:10px 12px;background:#f9fafb;border-radius:8px;font-size:12px;">
          ${this._vatHtml(this._d.fixedPrice || 0)}
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-top:8px;cursor:pointer;">
          <input type="checkbox" id="wiz-debiterbar" ${this._d.debiterbar!==false?'checked':''}> Debiterbar
        </label>` : ''}`;
  },

  _vatHtml(ex) {
    ex = parseFloat(ex) || 0;
    const vat  = Math.round(ex * 0.25);
    return `Ex moms: <strong>${fmt(ex)} kr</strong> &nbsp;·&nbsp; Moms 25%: <strong>${fmt(vat)} kr</strong> &nbsp;·&nbsp; Inkl moms: <strong>${fmt(ex+vat)} kr</strong>`;
  },

  _liveVAT(val) {
    const el = document.getElementById('wiz-vat-calc');
    if (el) el.innerHTML = this._vatHtml(val);
  },

  _setPricingType(val) {
    this._readStep4();
    this._d.pricingType = val;
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep4();
  },

  _onPGChange(pgId) {
    const pg = (state.priceGroups || []).find(p => p.id === pgId);
    if (pg) {
      this._d.priceGroupId   = pg.id;
      this._d.priceGroupName = pg.name;
      this._d.hourRate       = pg.hourRate;
      const el = document.getElementById('wizard-step-content');
      if (el) el.innerHTML = this._renderStep4();
    }
  },

  // ── Read / sync DOM → state ───────────────────────────────────────────────

  _readStep1() {
    this._d.name         = (document.getElementById('wiz-name')     || {}).value || '';
    this._d.customerId   = (document.getElementById('wiz-cu')       || {}).value || '';
    this._d.propertyId   = (document.getElementById('wiz-prop')     || {}).value || '';
    this._d.priority     = (document.getElementById('wiz-priority') || {}).value || 'normal';
    this._d.description  = (document.getElementById('wiz-desc')     || {}).value || '';
    this._d.internalNote = (document.getElementById('wiz-note')     || {}).value || '';
    this._d.isDraft      = !!(document.getElementById('wiz-draft')  || {}).checked;
  },

  _readStep4() {
    const pt = this._d.pricingType;
    if (pt === 'tim') {
      const pgEl = document.getElementById('wiz-pg');
      if (pgEl && pgEl.value) {
        const pg = (state.priceGroups || []).find(p => p.id === pgEl.value);
        if (pg) { this._d.priceGroupId = pg.id; this._d.priceGroupName = pg.name; }
      }
      this._d.hourRate   = parseFloat((document.getElementById('wiz-hourrate')   || {}).value || 0) || 0;
      this._d.debiterbar = !!(document.getElementById('wiz-debiterbar') || {}).checked;
    } else if (pt === 'fast') {
      this._d.fixedPrice = parseFloat((document.getElementById('wiz-fixedprice') || {}).value || 0) || 0;
      this._d.debiterbar = !!(document.getElementById('wiz-debiterbar') || {}).checked;
    }
  },

  _readCurrentStep() {
    if (this._step === 1) this._readStep1();
    else if (this._step === 2) this._syncStep2();
    else if (this._step === 4) this._readStep4();
    // Step 3: data pushed directly to _d.occasions / _d.recurringSetups on add/remove
  },

  // ── Navigation ────────────────────────────────────────────────────────────

  _validateStep() {
    if (this._step === 1) {
      if (!this._d.name.trim()) { showToast('Ange namn på rondering'); return false; }
      if (!this._d.customerId)  { showToast('Välj kund'); return false; }
    }
    if (this._step === 2) {
      const cats = this._d.categories.filter(c => c.name.trim());
      if (cats.length === 0) { showToast('Lägg till minst en grupp med namn'); return false; }
      if (!cats.some(c => (c.points || []).some(p => p.title.trim()))) {
        showToast('Lägg till minst en kontrollpunkt med namn'); return false;
      }
    }
    return true;
  },

  _nextStep() {
    this._readCurrentStep();
    if (!this._validateStep()) return;
    this._step++;
    this._reRenderWizard();
  },

  _prevStep() {
    this._readCurrentStep();
    this._step--;
    this._reRenderWizard();
  },

  _goToStep(n) {
    this._readCurrentStep();
    this._step = n;
    this._reRenderWizard();
  },

  _reRenderWizard() {
    const el = document.getElementById('pg-rondering-wizard-content');
    if (el) this._renderWizard(el);
    const scroll = document.getElementById('content-scroll');
    if (scroll) scroll.scrollTop = 0;
  },

  // ── Save ──────────────────────────────────────────────────────────────────

  _buildResults(categories, existingRon) {
    const existingResults = existingRon ? (existingRon.results || []) : [];
    return categories.map(cat => {
      const existingCat = existingResults.find(r => r.categoryId === cat.id);
      return {
        categoryId: cat.id,
        categoryName: cat.name,
        points: (cat.points || []).map(pt => {
          const ex = existingCat && (existingCat.points || []).find(p => p.pointId === pt.id);
          return ex || { pointId: pt.id, pointTitle: pt.title, status: '', comment: '', deviationId: null, checkedAt: '' };
        })
      };
    });
  },

  _cleanCats() {
    return this._d.categories
      .filter(c => c.name.trim())
      .map(c => Object.assign({}, c, { points: (c.points || []).filter(p => p.title.trim()) }));
  },

  _saveDraft() {
    this._readCurrentStep();
    const d = this._d;
    if (!d.name.trim()) { showToast('Ange namn på rondering för att spara utkast'); return; }
    if (!d.customerId)  { showToast('Välj kund för att spara utkast'); return; }
    const cats = this._cleanCats();
    const data = Object.assign({}, d, { isDraft: true, categories: cats });
    if (this._editId) {
      const existing = getRon(this._editId);
      RonderingService.updateRondering(this._editId, Object.assign({}, data, {
        results: this._buildResults(cats, existing)
      }));
      showToast('Utkast uppdaterat');
    } else {
      const ron = RonderingService.createRondering(data);
      this._editId = ron.id;
      showToast('Utkast sparat');
    }
  },

  _save() {
    this._readCurrentStep();
    const d    = this._d;
    const cats = this._cleanCats();

    // Validate — navigate to the failing step on error
    if (!d.name.trim()) {
      showToast('Ange namn på rondering');
      this._step = 1; this._reRenderWizard(); return;
    }
    if (!d.customerId) {
      showToast('Välj kund');
      this._step = 1; this._reRenderWizard(); return;
    }
    if (cats.length === 0) {
      showToast('Lägg till minst en grupp i steg 2');
      this._step = 2; this._reRenderWizard(); return;
    }
    if (!cats.some(c => (c.points || []).length > 0)) {
      showToast('Lägg till minst en kontrollpunkt i steg 2');
      this._step = 2; this._reRenderWizard(); return;
    }

    // Occasions/recurring are optional — rondering can be saved and dates added later

    const saveData = Object.assign({}, d, { categories: cats });

    try {
      if (this._editId) {
        const existing = getRon(this._editId);
        RonderingService.updateRondering(this._editId, Object.assign({}, saveData, {
          results: this._buildResults(cats, existing),
          status: saveData.isDraft ? 'utkast' : (existing && existing.status !== 'utkast' ? existing.status : 'planerad')
        }));
        showToast('Rondering sparad');
      } else {
        RonderingService.createRondering(saveData);
        showToast('Rondering skapad');
      }
      Router.showPage('pg-rondering');
    } catch (e) {
      console.error('[Wizard] Save failed:', e);
      showToast('Fel vid sparande: ' + e.message);
    }
  },

  _saveAndStart() {
    this._readCurrentStep();
    const d    = this._d;
    const cats = this._cleanCats();
    if (!d.name.trim()) { showToast('Ange namn (steg 1)'); return; }
    if (!d.customerId)  { showToast('Välj kund (steg 1)'); return; }
    if (this._editId) {
      const existing = getRon(this._editId);
      RonderingService.updateRondering(this._editId, Object.assign({}, d, {
        categories: cats,
        results: this._buildResults(cats, existing)
      }));
      RonderingService.startRondering(this._editId);
      Router.showPage('pg-rondering-utfor', { ronderingId: this._editId });
    }
  }
};
