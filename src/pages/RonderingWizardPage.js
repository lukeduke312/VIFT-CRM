/**
 * RonderingWizardPage — 4-stegs wizard för att skapa/redigera rondering
 * Steg 1: Ronderingsinformation
 * Steg 2: Kontrollpunkter
 * Steg 3: Tillfällen / återkommande
 * Steg 4: Prissättning
 */
const RonderingWizardPage = {

  _step: 1,
  _editId: null,   // null = ny, string = redigera befintlig
  _prefill: {},    // {customerId, propertyId} from property card

  // Wizard state — persisted in memory between steps
  _d: {
    // Step 1
    name: '', customerId: '', propertyId: '', description: '',
    internalNote: '', isDraft: false,
    // Step 2
    categories: [],   // [{id, name, sortOrder, points:[...]}]
    templateId: '', templateName: '',
    // Step 3
    occasions: [],     // [{id, date, time, staffId, staffName, comment}]
    recurringSetups: [],
    // Step 4
    pricingType: '',   // 'tim' | 'fast' | ''
    priceGroupId: '', priceGroupName: '', hourRate: 0, fixedPrice: 0, debiterbar: true
  },

  // Counters for DOM-based form in step 2
  _catCounter: 0,
  _ptCounters: {},

  render(params) {
    const el = document.getElementById('pg-rondering-wizard-content');
    if (!el) return;
    params = params || {};

    // Initialize on first call
    if (params.reset !== false) {
      this._step = 1;
      this._editId = params.ronderingId || null;
      this._prefill = { customerId: params.customerId || '', propertyId: params.propertyId || '' };
      this._d = {
        name: '', customerId: params.customerId || '', propertyId: params.propertyId || '',
        description: '', internalNote: '', isDraft: false,
        categories: [], templateId: '', templateName: '',
        occasions: [], recurringSetups: [],
        pricingType: '', priceGroupId: '', priceGroupName: '', hourRate: 0, fixedPrice: 0, debiterbar: true
      };
      this._catCounter = 0;
      this._ptCounters = {};

      // If editing, load existing data
      if (this._editId) {
        const ron = getRon(this._editId);
        if (ron) {
          this._d = {
            name: ron.name || '', customerId: ron.customerId || '', propertyId: ron.propertyId || '',
            description: ron.description || '', internalNote: ron.internalNote || '', isDraft: ron.isDraft || false,
            categories: JSON.parse(JSON.stringify(ron.categories || [])),
            templateId: ron.templateId || '', templateName: ron.templateName || '',
            occasions: JSON.parse(JSON.stringify(ron.occasions || [])),
            recurringSetups: JSON.parse(JSON.stringify(ron.recurringSetups || [])),
            pricingType: ron.pricingType || '', priceGroupId: ron.priceGroupId || '',
            priceGroupName: ron.priceGroupName || '', hourRate: ron.hourRate || 0,
            fixedPrice: ron.fixedPrice || 0, debiterbar: ron.debiterbar !== false
          };
          this._catCounter = (ron.categories || []).length;
        }
      }
    }

    this._renderStep(el);
  },

  _renderStep(el) {
    const stepLabels = ['Ronderingsinfo', 'Kontrollpunkter', 'Tillfällen', 'Prissättning'];
    const stepIcons  = ['info', 'list-checks', 'calendar', 'dollar-sign'];

    const stepIndicator = `
      <div style="display:flex;align-items:center;gap:0;margin-bottom:16px;overflow-x:auto;padding-bottom:4px;">
        ${stepLabels.map((lbl, i) => {
          const n = i + 1;
          const active = n === this._step;
          const done   = n < this._step;
          const bg     = active ? 'var(--navy)' : done ? 'var(--green)' : 'var(--br)';
          const txtclr = (active || done) ? '#fff' : 'var(--mt)';
          return `
            <div style="display:flex;align-items:center;gap:0;flex-shrink:0;">
              <div style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:${done?'pointer':'default'};"
                ${done ? `onclick="RonderingWizardPage._goToStep(${n})"` : ''}>
                <div style="width:32px;height:32px;border-radius:50%;background:${bg};color:${txtclr};
                  display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;">
                  ${done ? ic('check', 14) : n}
                </div>
                <div style="font-size:9px;font-weight:700;color:${active?'var(--navy)':done?'var(--green)':'var(--mt)'};white-space:nowrap;">${lbl}</div>
              </div>
              ${i < stepLabels.length - 1 ? `<div style="width:24px;height:2px;background:${done?'var(--green)':'var(--br)'};margin:0 4px;margin-bottom:16px;flex-shrink:0;"></div>` : ''}
            </div>`;
        }).join('')}
      </div>`;

    let content = '';
    if (this._step === 1) content = this._renderStep1();
    else if (this._step === 2) content = this._renderStep2();
    else if (this._step === 3) content = this._renderStep3();
    else if (this._step === 4) content = this._renderStep4();

    const isLast = this._step === 4;
    const isFirst = this._step === 1;

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <button class="btn bs bsm" onclick="Router.back()">${ic('arrow-left',14)}</button>
        <div style="flex:1;font-weight:800;font-size:15px;">${this._editId ? 'Redigera rondering' : 'Ny rondering'}</div>
        <button class="btn bs bsm" onclick="RonderingWizardPage._saveDraft()" style="font-size:11px;">Spara utkast</button>
      </div>
      ${stepIndicator}
      <div id="wizard-step-content">${content}</div>
      ${(() => {
        const ron = this._editId ? getRon(this._editId) : null;
        const isPlanerad = ron && (ron.status === 'planerad' || ron.status === 'pågående');
        return isPlanerad ? `
          <div style="margin-top:12px;padding:10px 14px;background:#f0fdf4;border:1px solid #86efac;border-radius:10px;display:flex;align-items:center;gap:10px;">
            <span style="color:#16a34a;font-size:12px;flex:1;">${ic('clipboard-check',14)} Rondering klar att utföra</span>
            <button class="btn bsm" style="background:#16a34a;color:#fff;border-color:#16a34a;font-weight:700;"
              onclick="RonderingWizardPage._saveAndStart()">
              ${ic('play',13)} Starta utförande
            </button>
          </div>` : '';
      })()}
      <div style="display:flex;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--br);">
        ${!isFirst ? `<button class="btn bs" style="flex:1;" onclick="RonderingWizardPage._prevStep()">← Tillbaka</button>` : `<button class="btn bs" style="flex:1;" onclick="Router.back()">Avbryt</button>`}
        ${isLast
          ? `<button class="btn bp" style="flex:2;" onclick="RonderingWizardPage._save()">${ic('save',15)} Spara rondering</button>`
          : `<button class="btn bp" style="flex:2;" onclick="RonderingWizardPage._nextStep()">Nästa steg →</button>`}
      </div>`;
  },

  _renderStep1() {
    const customers = state.customers || [];

    return `
      <div class="fg"><label>Namn på rondering *</label>
        <input type="text" id="wiz-name" value="${this._d.name}" placeholder="T.ex. Månadsrondering BRF Solgläntan">
      </div>
      <div class="fg"><label>Kund *</label>
        <select id="wiz-cu" onchange="RonderingWizardPage._onCustomerChange(this.value)">
          <option value="">Välj kund...</option>
          ${customers.map(c => `<option value="${c.id}"${c.id===this._d.customerId?' selected':''}>${c.name||c.firstName+' '+c.lastName}</option>`).join('')}
        </select>
      </div>
      <div class="fg"><label>Fastighet / objekt</label>
        <select id="wiz-prop">
          <option value="">Ingen fastighet vald</option>
          ${(state.properties||[]).filter(p=>!this._d.customerId||p.customerId===this._d.customerId).map(p =>
            `<option value="${p.id}"${p.id===this._d.propertyId?' selected':''}>${p.name} – ${p.address}</option>`
          ).join('')}
        </select>
      </div>
      <div class="fg"><label>Beskrivning / syfte</label>
        <textarea id="wiz-desc" rows="3" placeholder="Beskriv vad ronderingen ska täcka...">${this._d.description}</textarea>
      </div>
      <div class="fg"><label>Intern notering</label>
        <textarea id="wiz-note" rows="2" placeholder="Interna anteckningar (syns ej i rapport)...">${this._d.internalNote}</textarea>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-top:4px;cursor:pointer;">
        <input type="checkbox" id="wiz-draft" ${this._d.isDraft?'checked':''}>
        Spara som utkast (visas inte som planerad)
      </label>`;
  },

  _onCustomerChange(cuId) {
    this._readStep1();
    this._d.customerId = cuId;
    this._d.propertyId = '';
    // Re-render step 1 to update property dropdown
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep1();
  },

  _renderStep2() {
    const mallar = (state.ronderingsmallar||[]).filter(m=>m.active);
    const cats = this._d.categories;

    return `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
        <div style="font-weight:700;font-size:14px;flex:1;">Kategorier och kontrollpunkter</div>
        <select id="wiz-mall-select" style="padding:6px 8px;border:1px solid var(--br);border-radius:7px;font-size:12px;background:var(--wh);"
          onchange="RonderingWizardPage._loadMall(this.value)">
          <option value="">Välj mall att ladda...</option>
          ${mallar.map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}
        </select>
      </div>
      ${cats.length === 0 ? `<div class="ibox" style="margin-bottom:10px;">Inga kontrollpunkter ännu. Välj en mall eller lägg till kategorier manuellt.</div>` : ''}
      <div id="wiz-cats">
        ${cats.map((cat, ci) => this._catHtml(cat, ci)).join('')}
      </div>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
        <button class="btn bs bsm" onclick="RonderingWizardPage._addCategory()">+ Lägg till grupp</button>
        ${cats.length > 0 ? `<button class="btn bs bsm" onclick="RonderingWizardPage._openSaveAsMall()">Spara som mall</button>` : ''}
      </div>`;
  },

  _catHtml(cat, ci) {
    const pts = cat ? (cat.points||[]) : [];
    return `
      <div class="card" style="margin-bottom:8px;" id="cat-block-${ci}">
        <div class="card-body" style="padding:10px 12px;">
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
            <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0;">
              <button class="btn bs bsm" style="padding:2px 6px;" onclick="RonderingWizardPage._moveCat(${ci},-1)">↑</button>
              <button class="btn bs bsm" style="padding:2px 6px;" onclick="RonderingWizardPage._moveCat(${ci},1)">↓</button>
            </div>
            <input type="text" placeholder="Grupprubrik" value="${cat?cat.name:''}"
              id="cat-name-${ci}" style="flex:1;padding:7px 9px;border:1px solid var(--br);border-radius:7px;font-size:13px;font-weight:700;">
            <button class="btn bd bsm" onclick="RonderingWizardPage._removeCat(${ci})">${ic('trash-2',13)}</button>
          </div>
          <div id="cat-pts-${ci}">
            ${pts.map((pt,pi)=>this._ptHtml(ci,pi,pt)).join('')}
          </div>
          <button class="btn bs bsm" style="margin-top:6px;font-size:11px;" onclick="RonderingWizardPage._addPoint(${ci})">+ Lägg till punkt</button>
        </div>
      </div>`;
  },

  _ptHtml(ci, pi, pt) {
    return `
      <div style="background:#f9fafb;border:1px solid var(--br);border-radius:7px;padding:8px 10px;margin-bottom:6px;" id="pt-block-${ci}-${pi}">
        <div style="display:flex;gap:6px;align-items:flex-start;">
          <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0;padding-top:2px;">
            <button class="btn bs bsm" style="padding:1px 5px;font-size:9px;" onclick="RonderingWizardPage._movePt(${ci},${pi},-1)">↑</button>
            <button class="btn bs bsm" style="padding:1px 5px;font-size:9px;" onclick="RonderingWizardPage._movePt(${ci},${pi},1)">↓</button>
          </div>
          <div style="flex:1;">
            <input type="text" placeholder="Punktrubrik *" value="${pt?pt.title:''}"
              id="pt-title-${ci}-${pi}" style="width:100%;padding:5px 8px;border:1px solid var(--br);border-radius:6px;font-size:12px;font-weight:600;margin-bottom:4px;">
            <input type="text" placeholder="Instruktion / beskrivning (valfri)" value="${pt?pt.description:''}"
              id="pt-desc-${ci}-${pi}" style="width:100%;padding:4px 8px;border:1px solid var(--br);border-radius:6px;font-size:11px;color:var(--mt);">
            <div style="display:flex;gap:12px;margin-top:5px;font-size:11px;flex-wrap:wrap;">
              <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                <input type="checkbox" id="pt-photo-${ci}-${pi}" ${pt&&pt.requiresPhoto?'checked':''}> Kräver foto
              </label>
              <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                <input type="checkbox" id="pt-ao-${ci}-${pi}" ${pt&&pt.canCreateAO!==false?'checked':''}> Kan skapa AO
              </label>
            </div>
          </div>
          <button class="btn bd bsm" style="flex-shrink:0;" onclick="RonderingWizardPage._removePt(${ci},${pi})">${ic('x',12)}</button>
        </div>
      </div>`;
  },

  _addCategory() {
    this._readStep2();
    const ci = this._d.categories.length;
    this._d.categories.push({ id: 'cat-' + Date.now(), name: '', sortOrder: ci, points: [] });
    this._ptCounters[ci] = 0;
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep2();
  },

  _removeCat(ci) {
    this._readStep2();
    this._d.categories.splice(ci, 1);
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep2();
  },

  _moveCat(ci, dir) {
    this._readStep2();
    const cats = this._d.categories;
    const ni = ci + dir;
    if (ni < 0 || ni >= cats.length) return;
    [cats[ci], cats[ni]] = [cats[ni], cats[ci]];
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep2();
  },

  _addPoint(ci) {
    this._readStep2();
    const cat = this._d.categories[ci];
    if (!cat) return;
    cat.points.push({ id: 'pt-' + Date.now(), title: '', description: '', requiresPhoto: false, canCreateAO: true, sortOrder: cat.points.length });
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep2();
  },

  _removePt(ci, pi) {
    this._readStep2();
    const cat = this._d.categories[ci];
    if (!cat) return;
    cat.points.splice(pi, 1);
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep2();
  },

  _movePt(ci, pi, dir) {
    this._readStep2();
    const pts = this._d.categories[ci] && this._d.categories[ci].points;
    if (!pts) return;
    const ni = pi + dir;
    if (ni < 0 || ni >= pts.length) return;
    [pts[pi], pts[ni]] = [pts[ni], pts[pi]];
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep2();
  },

  _loadMall(mallId) {
    if (!mallId) return;
    const mall = getMall(mallId);
    if (!mall) return;
    if (this._d.categories.length > 0) {
      if (!confirm('Ladda mall? Befintliga kontrollpunkter ersätts.')) return;
    }
    this._d.categories = JSON.parse(JSON.stringify(mall.categories || []));
    this._d.templateId = mall.id;
    this._d.templateName = mall.name;
    if (!this._d.name) this._d.name = mall.name;
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep2();
  },

  _openSaveAsMall() {
    this._readStep2();
    Modal.open({
      title: 'Spara som mall',
      body: `<div class="fg"><label>Mallnamn *</label>
        <input type="text" id="save-mall-name" value="${this._d.name || ''}" placeholder="T.ex. Månadsrondering BRF">
      </div>`,
      buttons: [
        { label: 'Spara mall', cls: 'btn bp bfull', onClick: () => {
          const name = (document.getElementById('save-mall-name')||{}).value||'';
          if (!name.trim()) { showToast('Ange mallnamn'); return; }
          RonderingService.createMall({
            name: name.trim(),
            description: this._d.description || '',
            categories: JSON.parse(JSON.stringify(this._d.categories)),
            customerId: this._d.customerId || '',
            interval: 'månadsvis',
            active: true
          });
          Modal.close();
          showToast('Mall sparad: ' + name.trim());
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _renderStep3() {
    const staff = (state.staff||[]).filter(s=>s.active);
    const occasions = this._d.occasions;
    const recurringSetups = this._d.recurringSetups;
    const intervals = [
      {v:'dagligen',l:'Dagligen'},{v:'veckovis',l:'Veckovis'},
      {v:'varannan_vecka',l:'Varannan vecka'},{v:'månadsvis',l:'Månadsvis'},
      {v:'kvartalsvis',l:'Kvartalsvis'},{v:'årsvis',l:'Årsvis'},{v:'eget',l:'Eget antal dagar'}
    ];

    return `
      <!-- Enstaka tillfällen -->
      <div style="font-weight:700;font-size:14px;margin-bottom:8px;">Enstaka tillfällen</div>
      <div id="occ-list">
        ${occasions.length === 0 ? `<div style="font-size:12px;color:var(--mt);margin-bottom:8px;">Inga enstaka tillfällen tillagda.</div>` : ''}
        ${occasions.map((occ, oi) => `
          <div style="background:#f9fafb;border:1px solid var(--br);border-radius:8px;padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;gap:8px;">
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:700;">${fmtDate(occ.date)} ${occ.time||''}</div>
              <div style="font-size:11px;color:var(--mt);">${occ.staffName||'Ej tilldelad'}${occ.comment?' · '+occ.comment:''}</div>
            </div>
            <button class="btn bd bsm" onclick="RonderingWizardPage._removeOcc(${oi})">${ic('x',12)}</button>
          </div>`).join('')}
      </div>
      <div class="card" style="margin-bottom:16px;">
        <div class="card-body" style="padding:12px 14px;">
          <div style="font-size:12px;font-weight:700;margin-bottom:8px;">+ Lägg till enstaka tillfälle</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div class="fg"><label>Datum</label><input type="date" id="occ-date" value="${tdy()}"></div>
            <div class="fg"><label>Tid</label><input type="time" id="occ-time" value="09:00"></div>
          </div>
          <div class="fg"><label>Tilldelad</label>
            <select id="occ-staff">
              <option value="">Ej tilldelad</option>
              ${staff.map(s=>`<option value="${s.id}">${s.firstName} ${s.lastName}</option>`).join('')}
            </select>
          </div>
          <div class="fg"><label>Kommentar</label><input type="text" id="occ-comment" placeholder="Valfri kommentar"></div>
          <button class="btn bp bsm" style="margin-top:6px;" onclick="RonderingWizardPage._addOcc()">Lägg till tillfälle</button>
        </div>
      </div>

      <!-- Återkommande -->
      <div style="font-weight:700;font-size:14px;margin-bottom:8px;">Återkommande</div>
      <div id="rec-list">
        ${recurringSetups.length === 0 ? `<div style="font-size:12px;color:var(--mt);margin-bottom:8px;">Inget återkommande upplägg tillagt.</div>` : ''}
        ${recurringSetups.map((rec, ri) => `
          <div style="background:#f9fafb;border:1px solid var(--br);border-radius:8px;padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;gap:8px;">
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:700;">${{dagligen:'Dagligen',veckovis:'Veckovis',varannan_vecka:'Varannan vecka',månadsvis:'Månadsvis',kvartalsvis:'Kvartalsvis',årsvis:'Årsvis',eget:'Var '+rec.intervalDays+' dag(ar)'}[rec.interval]||rec.interval}</div>
              <div style="font-size:11px;color:var(--mt);">Fr.o.m. ${fmtDate(rec.startDate)} · ${rec.tillsvidare?'Tills vidare':'T.o.m. '+fmtDate(rec.endDate)} · ${rec.staffName||'Ej tilldelad'}</div>
            </div>
            <button class="btn bd bsm" onclick="RonderingWizardPage._removeRec(${ri})">${ic('x',12)}</button>
          </div>`).join('')}
      </div>
      <div class="card">
        <div class="card-body" style="padding:12px 14px;">
          <div style="font-size:12px;font-weight:700;margin-bottom:8px;">+ Lägg till återkommande</div>
          <div class="fg"><label>Intervall</label>
            <select id="rec-interval" onchange="RonderingWizardPage._onRecIntervalChange(this.value)">
              ${intervals.map(i=>`<option value="${i.v}">${i.l}</option>`).join('')}
            </select>
          </div>
          <div id="rec-interval-extra"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div class="fg"><label>Startdatum</label><input type="date" id="rec-start" value="${tdy()}"></div>
            <div class="fg"><label>Slutdatum</label><input type="date" id="rec-end" disabled></div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;margin-top:4px;cursor:pointer;">
            <input type="checkbox" id="rec-tillsvidare" checked onchange="document.getElementById('rec-end').disabled=this.checked"> Tills vidare
          </label>
          <div class="fg" style="margin-top:8px;"><label>Tilldelad</label>
            <select id="rec-staff">
              <option value="">Ej tilldelad</option>
              ${staff.map(s=>`<option value="${s.id}">${s.firstName} ${s.lastName}</option>`).join('')}
            </select>
          </div>
          <button class="btn bp bsm" style="margin-top:6px;" onclick="RonderingWizardPage._addRec()">Lägg till återkommande</button>
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
    const date    = (document.getElementById('occ-date')||{}).value||'';
    const time    = (document.getElementById('occ-time')||{}).value||'';
    const staffId = (document.getElementById('occ-staff')||{}).value||'';
    const comment = (document.getElementById('occ-comment')||{}).value||'';
    if (!date) { showToast('Välj datum'); return; }
    const s = staffId ? getStaff(staffId) : null;
    this._d.occasions.push({
      id: 'occ-' + Date.now(), date, time, staffId,
      staffName: s ? (s.firstName+' '+s.lastName).trim() : '',
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
    const interval    = (document.getElementById('rec-interval')||{}).value||'månadsvis';
    const startDate   = (document.getElementById('rec-start')||{}).value||tdy();
    const tillsvidare = (document.getElementById('rec-tillsvidare')||{}).checked;
    const endDate     = tillsvidare ? '' : ((document.getElementById('rec-end')||{}).value||'');
    const staffId     = (document.getElementById('rec-staff')||{}).value||'';
    const weekday     = ((document.getElementById('rec-weekday')||{}).value)||'';
    const dayOfMonth  = ((document.getElementById('rec-dom')||{}).value)||'';
    const intervalDays = parseInt((document.getElementById('rec-days')||{}).value||'14',10);
    const s = staffId ? getStaff(staffId) : null;
    this._d.recurringSetups.push({
      id: 'rec-' + Date.now(), interval, intervalDays, startDate, endDate, tillsvidare,
      weekday, dayOfMonth, staffId,
      staffName: s ? (s.firstName+' '+s.lastName).trim() : ''
    });
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep3();
  },

  _removeRec(ri) {
    this._d.recurringSetups.splice(ri, 1);
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep3();
  },

  _renderStep4() {
    const priceGroups = (state.priceGroups||[]).filter(pg=>pg.active);
    const pt = this._d.pricingType;

    return `
      <div style="font-weight:700;font-size:14px;margin-bottom:12px;">Prissättning</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
        ${[
          {v:'tim',  l:'Timpris',              desc:'Faktureras per nedlagd tid med vald prisgrupp'},
          {v:'fast', l:'Fast pris per tillfälle', desc:'Fast pris debiteras per utförd rondering'},
          {v:'',     l:'Utan prissättning',    desc:'Ingen prissättning / internt arbete'}
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
        <div class="fg"><label>Prisgrupp *</label>
          <select id="wiz-pg" onchange="RonderingWizardPage._onPGChange(this.value)">
            <option value="">Välj prisgrupp...</option>
            ${priceGroups.map(pg=>`<option value="${pg.id}"${pg.id===this._d.priceGroupId?' selected':''}>${pg.name} – ${fmt(pg.hourRate)} kr/tim</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label>Timpris ex moms</label>
          <input type="number" id="wiz-hourrate" value="${this._d.hourRate}" placeholder="695" style="background:#f9fafb;">
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-top:4px;cursor:pointer;">
          <input type="checkbox" id="wiz-debiterbar" ${this._d.debiterbar?'checked':''}> Debiterbar tid
        </label>` : ''}

      ${pt === 'fast' ? `
        <div class="fg"><label>Fast pris ex moms (kr)</label>
          <input type="number" id="wiz-fixedprice" value="${this._d.fixedPrice||0}" placeholder="0">
        </div>
        <div id="wiz-vat-calc" style="margin-top:8px;padding:10px 12px;background:#f9fafb;border-radius:8px;font-size:12px;">
          ${(() => {
            const ex = this._d.fixedPrice || 0;
            const vat = Math.round(ex * 0.25);
            const inkl = ex + vat;
            return `Ex moms: <strong>${fmt(ex)} kr</strong> · Moms 25%: <strong>${fmt(vat)} kr</strong> · Inkl moms: <strong>${fmt(inkl)} kr</strong>`;
          })()}
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-top:8px;cursor:pointer;">
          <input type="checkbox" id="wiz-debiterbar" ${this._d.debiterbar?'checked':''}> Debiterbar
        </label>` : ''}`;
  },

  _setPricingType(val) {
    this._d.pricingType = val;
    const el = document.getElementById('wizard-step-content');
    if (el) el.innerHTML = this._renderStep4();
  },

  _onPGChange(pgId) {
    const pg = (state.priceGroups||[]).find(p=>p.id===pgId);
    if (pg) {
      this._d.priceGroupId = pg.id;
      this._d.priceGroupName = pg.name;
      this._d.hourRate = pg.hourRate;
      const el = document.getElementById('wizard-step-content');
      if (el) el.innerHTML = this._renderStep4();
    }
  },

  // ── Navigation ──────────────────────────────

  _readStep1() {
    this._d.name = (document.getElementById('wiz-name')||{}).value||'';
    this._d.customerId = (document.getElementById('wiz-cu')||{}).value||'';
    this._d.propertyId = (document.getElementById('wiz-prop')||{}).value||'';
    this._d.description = (document.getElementById('wiz-desc')||{}).value||'';
    this._d.internalNote = (document.getElementById('wiz-note')||{}).value||'';
    this._d.isDraft = (document.getElementById('wiz-draft')||{}).checked||false;
  },

  _readStep2() {
    const cats = [];
    const existingCats = this._d.categories;
    // Read from DOM — iterate existing categories
    existingCats.forEach((origCat, ci) => {
      const nameEl = document.getElementById('cat-name-' + ci);
      const catName = nameEl ? nameEl.value.trim() : origCat.name;
      const points = [];
      (origCat.points || []).forEach((origPt, pi) => {
        const titleEl = document.getElementById('pt-title-' + ci + '-' + pi);
        if (!titleEl) { points.push(origPt); return; }
        const title = titleEl.value.trim();
        if (!title) return;
        const desc      = (document.getElementById('pt-desc-' + ci + '-' + pi)||{}).value||'';
        const reqPhoto  = (document.getElementById('pt-photo-' + ci + '-' + pi)||{}).checked||false;
        const canAO     = (document.getElementById('pt-ao-' + ci + '-' + pi)||{}).checked!==false;
        points.push({ id: origPt.id, title, description: desc, requiresPhoto: reqPhoto, canCreateAO: canAO, sortOrder: pi });
      });
      if (catName) cats.push({ id: origCat.id, name: catName, sortOrder: ci, points });
    });
    this._d.categories = cats;
  },

  _readStep4() {
    const pt = this._d.pricingType;
    if (pt === 'tim') {
      const pgEl = document.getElementById('wiz-pg');
      if (pgEl && pgEl.value) {
        const pg = (state.priceGroups||[]).find(p=>p.id===pgEl.value);
        if (pg) { this._d.priceGroupId = pg.id; this._d.priceGroupName = pg.name; }
      }
      this._d.hourRate = parseFloat((document.getElementById('wiz-hourrate')||{}).value||0)||0;
      this._d.debiterbar = (document.getElementById('wiz-debiterbar')||{}).checked!==false;
    } else if (pt === 'fast') {
      this._d.fixedPrice = parseFloat((document.getElementById('wiz-fixedprice')||{}).value||0)||0;
      this._d.debiterbar = (document.getElementById('wiz-debiterbar')||{}).checked!==false;
    }
  },

  _readCurrentStep() {
    if (this._step === 1) this._readStep1();
    else if (this._step === 2) this._readStep2();
    else if (this._step === 4) this._readStep4();
  },

  _validateStep() {
    if (this._step === 1) {
      if (!this._d.name.trim()) { showToast('Ange namn på rondering'); return false; }
      if (!this._d.customerId) { showToast('Välj kund'); return false; }
    }
    if (this._step === 2) {
      if (this._d.categories.length === 0) { showToast('Lägg till minst en kategori med kontrollpunkter'); return false; }
      const hasPoints = this._d.categories.some(c => (c.points||[]).length > 0);
      if (!hasPoints) { showToast('Lägg till minst en kontrollpunkt'); return false; }
    }
    return true;
  },

  _nextStep() {
    this._readCurrentStep();
    if (!this._validateStep()) return;
    this._step++;
    const el = document.getElementById('pg-rondering-wizard-content');
    if (el) this._renderStep(el);
    const scroll = document.getElementById('content-scroll');
    if (scroll) scroll.scrollTop = 0;
  },

  _prevStep() {
    this._readCurrentStep();
    this._step--;
    const el = document.getElementById('pg-rondering-wizard-content');
    if (el) this._renderStep(el);
    const scroll = document.getElementById('content-scroll');
    if (scroll) scroll.scrollTop = 0;
  },

  _goToStep(n) {
    this._readCurrentStep();
    this._step = n;
    const el = document.getElementById('pg-rondering-wizard-content');
    if (el) this._renderStep(el);
    const scroll = document.getElementById('content-scroll');
    if (scroll) scroll.scrollTop = 0;
  },

  _saveDraft() {
    this._readCurrentStep();
    const d = this._d;
    if (!d.name.trim() || !d.customerId) { showToast('Ange minst namn och kund för att spara utkast'); return; }
    const data = Object.assign({}, d, { isDraft: true });
    if (this._editId) {
      RonderingService.updateRondering(this._editId, Object.assign(data, {
        results: this._buildResults(data.categories, getRon(this._editId))
      }));
      showToast('Utkast uppdaterat');
    } else {
      const ron = RonderingService.createRondering(data);
      this._editId = ron.id;
      showToast('Utkast sparat: ' + ron.id);
    }
  },

  _buildResults(categories, existingRon) {
    // Merge new categories with existing results (preserve already-checked points)
    const existingResults = existingRon ? (existingRon.results || []) : [];
    return categories.map(cat => {
      const existingCat = existingResults.find(r => r.categoryId === cat.id);
      return {
        categoryId: cat.id,
        categoryName: cat.name,
        points: (cat.points || []).map(pt => {
          const existingPt = existingCat && (existingCat.points || []).find(p => p.pointId === pt.id);
          return existingPt || {
            pointId: pt.id, pointTitle: pt.title,
            status: '', comment: '', deviationId: null, checkedAt: ''
          };
        })
      };
    });
  },

  _save() {
    this._readCurrentStep();
    const d = this._d;
    if (!d.name.trim()) { showToast('Ange namn (gå tillbaka till steg 1)'); return; }
    if (!d.customerId) { showToast('Välj kund (gå tillbaka till steg 1)'); return; }
    if (d.categories.length === 0) { showToast('Lägg till kontrollpunkter (steg 2)'); return; }

    const saveData = Object.assign({}, d);
    let ron;
    if (this._editId) {
      ron = getRon(this._editId);
      RonderingService.updateRondering(this._editId, Object.assign(saveData, {
        results: this._buildResults(saveData.categories, ron),
        status: saveData.isDraft ? 'utkast' : (ron && ron.status !== 'utkast' ? ron.status : 'planerad')
      }));
      ron = getRon(this._editId);
      showToast('Rondering sparad');
    } else {
      ron = RonderingService.createRondering(saveData);
      showToast('Rondering skapad: ' + ron.id);
    }
    Router.showPage('pg-rondering');
  },

  _saveAndStart() {
    this._readCurrentStep();
    const d = this._d;
    if (!d.name.trim()) { showToast('Ange namn (steg 1)'); return; }
    if (!d.customerId)  { showToast('Välj kund (steg 1)'); return; }
    const saveData = Object.assign({}, d);
    if (this._editId) {
      const ron = getRon(this._editId);
      RonderingService.updateRondering(this._editId, Object.assign(saveData, {
        results: this._buildResults(saveData.categories, ron)
      }));
      Router.showPage('pg-rondering-utfor', { ronderingId: this._editId });
    }
  }
};
