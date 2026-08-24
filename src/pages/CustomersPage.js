/**
 * CustomersPage — Kundlista + skapa/redigera + kundkort
 */

const CustomersPage = {
  q: '',
  _typeFilter: 'alla',
  _sortBy: 'name', // 'name' | 'created' | 'aos'

  render() {
    const el = document.getElementById('pg-crm-content');
    if (!el) return;
    const custActions = [
      { id: 'export', label: 'Exportera', icon: 'download', type: 'export' },
      this._typeFilter === 'inaktiva'
        ? { id: 'reactivate', label: 'Återaktivera', icon: 'rotate-ccw', permission: 'customer_manage', type: 'confirm',
            confirmTitle: n => `Återaktivera ${n} kund${n===1?'':'er'}?`,
            confirmButtonLabel: n => `Återaktivera ${n}`,
            run: ids => CustomersPage._bulkSetInactive(ids, false) }
        : { id: 'archive', label: 'Arkivera', icon: 'archive', permission: 'customer_manage', type: 'confirm', destructive: true,
            confirmTitle: n => `Arkivera ${n} kund${n===1?'':'er'}?`,
            confirmDetail: 'Kunderna markeras som inaktiva och döljs i standardlistan. Kan återaktiveras senare.',
            confirmButtonLabel: n => `Arkivera ${n}`,
            run: ids => CustomersPage._bulkSetInactive(ids, true) }
    ];
    SelectionModel.init('customer', { stateKey: 'customers', actions: custActions });

    const TYPE_TABS = [
      { key:'alla',            label:'Alla' },
      { key:'foretag',         label:'Företag' },
      { key:'brf',             label:'BRF' },
      { key:'fastighetsagare', label:'Fastighetsäg.' },
      { key:'privat',          label:'Privat' },
      { key:'inaktiva',        label:'Inaktiva' }
    ];

    el.innerHTML = `
      <div class="ao-toolbar" style="margin-bottom:6px;">
        <div class="swrap">
          <span class="sico">${ic('search',16)}</span>
          <input type="search" id="crm-search" placeholder="Sök kund, telefon, e-post…"
            value="${this.q}"
            oninput="CustomersPage.q=this.value;CustomersPage.renderList()">
        </div>
        <div class="ao-toolbar-right">
          ${Auth.can('customer_manage') ? `<button class="btn bs bsm ao-import-btn" onclick="Router.showPage('pg-import-wizard',{type:'customer'})">${ic('upload',14)} Importera</button>` : ''}
          <button class="btn bs bsm ao-export-btn" onclick="ImportExportService.showExportMenu('customer',this)">${ic('download',14)} Exportera</button>
          <div class="ao-overflow-wrap">
            <button class="btn bs bsm ao-overflow-btn" id="ao-ovf-btn-crm" aria-label="Fler alternativ" aria-haspopup="menu" aria-expanded="false" onclick="aoToggleOverflow('ao-ovf-crm',this)">${ic('more-vertical',14)}</button>
            <div class="ao-overflow-menu" id="ao-ovf-crm" role="menu">
              ${Auth.can('customer_manage') ? `<button class="ao-overflow-menu-item" role="menuitem" onclick="aoCloseOverflow();Router.showPage('pg-import-wizard',{type:'customer'})">${ic('upload',13)} Importera</button>` : ''}
              <button class="ao-overflow-menu-item" role="menuitem" onclick="aoCloseOverflow();ImportExportService.showExportMenu('customer',this)">${ic('download',13)} Exportera</button>
            </div>
          </div>
          <button class="btn bp bsm" onclick="CustomersPage.openCreate()">${ic('plus',14)} Ny kund</button>
        </div>
      </div>
      <div class="ao-tabs-row" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <div class="ftabs ao-status-tabs" style="flex:1;margin-bottom:0;">
          ${TYPE_TABS.map(t =>
            `<button class="ft ${this._typeFilter===t.key?'on':''}"
              onclick="CustomersPage._typeFilter='${t.key}';CustomersPage.renderList()">${t.label}</button>`
          ).join('')}
        </div>
        <div class="ao-selall-cell" id="crm-sel-all"></div>
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
      /* V49A1: jämför NORMALISERAT värde, inte rått c.type — annars
         försvinner en legacy-kund (type='company' e.dyl.) tyst ur
         Företag-fliken trots att typeLabel() redan visar "Företag" för
         den överallt annars. Se RAPPORT-V49A1.md §12. */
      list = list.filter(c => CustomerService.normalizeType(c.type) === this._typeFilter && !c.inactive);
    } else {
      list = list.filter(c => !c.inactive);
    }
    // Sortering
    list = list.slice().sort((a, b) => {
      const na = CustomerService.displayName(a), nb = CustomerService.displayName(b);
      return na.localeCompare(nb, 'sv');
    });
    const visibleIds = list.map(c => c.id);
    const selAll = document.getElementById('crm-sel-all');
    if (selAll) selAll.innerHTML = SelectionModel.selectAllHtml(visibleIds);

    if (list.length === 0) {
      el.innerHTML = `<div class="empty"><span class="empty-ico">${ic('users',36)}</span><h3>Inga kunder</h3>
        <p>${this.q ? 'Inga träffar för sökning' : 'Skapa din första kund'}</p>
        ${this.q ? `<button class="btn bs bsm" style="margin-top:8px;" onclick="CustomersPage.q='';document.getElementById('crm-search').value='';CustomersPage.renderList()">Rensa sökning</button>` : ''}
      </div>`;
      return;
    }
    const selMode = SelectionModel.count() > 0;
    el.innerHTML = list.map(cu => {
      const name = CustomerService.displayName(cu);
      const aos  = CustomerService.getActiveAOs(cu.id).length;
      const selected = SelectionModel.isSelected(cu.id);
      return `
        <div class="list-item${selMode?' sel-mode':''}${selected?' selected':''}" data-sel-row-id="${cu.id}"
          onclick="SelectionModel.rowClick('${cu.id}', function(){ Router.showPage('pg-crm-detail',{customerId:'${cu.id}'}); })">
          <div class="item-row">
            ${SelectionModel.checkboxHtml(cu.id, name)}
            <div style="flex:1;min-width:0;">
              <div class="item-title">${name}</div>
              <div class="item-sub">${CustomerService.typeLabel(cu.type)}${cu.phone?' · '+cu.phone:''}${cu.city?' · '+cu.city:''}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
              ${aos > 0 ? `<span class="bdg bdg-blue">${aos} AO</span>` : ''}
              <span class="bdg bdg-grey">${cu.id}</span>
            </div>
            <button type="button" class="row-open-btn" title="Öppna" aria-label="Öppna kund" onclick="event.stopPropagation();Router.showPage('pg-crm-detail',{customerId:'${cu.id}'})">${ic('chevron-right',16)}</button>
          </div>
        </div>`;
    }).join('');
  },

  /* Bulk arkivera/återaktivera — samma fält som CustomerDetailPage.toggleInactive()
     (cu.inactive, cu.updatedAt), men EN persist() för hela batchen (SPRINT1 §18/V28 §1/§3/§7).
     Fail-closed: kräver customer_manage själv (publikt anropbar). Räknar
     bara faktiskt ändrade poster; redan-samma-värde = unchanged, ingen
     persist om inget ändrades. */
  _bulkSetInactive(ids, inactive) {
    if (typeof Auth === 'undefined' || !Auth.can('customer_manage')) {
      return { ok: false, error: 'Du saknar behörighet för denna åtgärd.', updated: 0, unchanged: 0 };
    }
    if (typeof inactive !== 'boolean') {
      return { ok: false, error: 'Ogiltigt värde.', updated: 0, unchanged: 0 };
    }
    const now = new Date().toISOString();
    let updated = 0, unchanged = 0;
    (state.customers || []).forEach(cu => {
      if (ids.indexOf(cu.id) === -1) return;
      if (!!cu.inactive === !!inactive) { unchanged++; return; }
      cu.inactive = inactive; cu.updatedAt = now; updated++;
    });
    if (updated > 0) { persist(); this.render(); }
    return { ok: true, updated, unchanged };
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
    const cu = id ? getCu(id) : null;

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
      /* V49A1 R1: initial fältvisning MÅSTE utgå från samma värde dropdownen
         faktiskt visar (sel.value), inte rå cu.type — annars normaliserar
         _formHtml() en legacy-synonym (t.ex. 'Private' -> dropdown visar
         "Privatperson") medan denna kod jämförde mot den orörda råsträngen
         ('Private' !== 'privat') och visade fel fältgrupp. Se RAPPORT-V49A1-R1.md §2. */
      if (sel) this._toggleTypeFields(sel.value);
    }, 50);
  },

  _formHtml(cu) {
    const v = (key, def='') => cu ? (cu[key] || def) : def;
    const diffInv = cu && (cu.invoiceAddress || cu.invoiceZip || cu.invoiceCity);
    /* V49A1: en BEFINTLIG kunds lagrade cu.type kan vara ett känt legacy-/
       import-värde (t.ex. "company") eller — mer allvarligt — ett HELT
       okänt värde. Det gamla beteendet lät webbläsaren tyst falla tillbaka
       till det FÖRSTA <option>-elementet ("Företag") när INGEN <option>
       matchade, utan att någonsin visa detta för användaren — nästa spar
       skrev då tyst över det verkliga (trasiga) värdet med 'foretag'.
       Se RAPPORT-V49A1.md §3/§7.
       normType: '' (ny kund/inget värde), en kanonisk sträng (känd, även
       legacy-synonym), eller null (explicit, icke-tomt, okänt värde). */
    const rawType  = cu ? (cu.type || '') : '';
    const normType = CustomerService.normalizeType(rawType);
    const isUnknown = !!rawType && normType === null;
    /* Nytt kund-formulär: förvalt 'foretag' precis som innan. Befintlig
       kund med känt värde: dess kanoniska typ. Befintlig kund med okänt
       värde: INGEN av de fyra riktiga alternativen förvalt — se
       placeholder-optionen nedan, som tvingar ett aktivt, medvetet val
       innan Spara går att lita på. */
    const selectedType = cu ? (normType || '') : 'foretag';

    /* CUSTOMER LEGACY R1: gör legacy/importerad data SYNLIG istället för att
       låta den ligga dold i ett fält edit-formuläret aldrig läser. Visar
       ENDAST — flyttar/gissar/skriver ALDRIG något automatiskt. Se
       RAPPORT-CUSTOMER-LEGACY-R1.md §1-§3. */
    const hasCanonicalPrivateName = !!(cu && cu.firstName && cu.lastName);
    const showLegacyNameBanner = !!(cu && normType === 'privat' && cu.name && !hasCanonicalPrivateName);
    const showLegacyIdBanner   = !!(cu && normType === 'privat' && !cu.personnr && cu.orgNr);

    const legacyNameBannerHtml = showLegacyNameBanner ? `
      <div class="ibox" style="margin-bottom:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">Importerat namn</div>
        <div style="font-size:14px;font-weight:700;color:var(--tx);margin-bottom:4px;">${esc(cu.name)}</div>
        <div style="font-size:11px;color:var(--mt);">Namnet är importerat i ett äldre kundfält. Fyll i förnamn och efternamn för att strukturera kunden.</div>
      </div>` : '';

    const legacyIdBannerHtml = showLegacyIdBanner ? `
      <div class="ibox" id="cu-legacy-id-box" style="margin-top:6px;">
        <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;">Importerat nummer</div>
        <div id="cu-legacy-id-value" style="font-size:14px;font-weight:700;color:var(--tx);margin-bottom:4px;">${esc(cu.orgNr)}</div>
        <div style="font-size:11px;color:var(--mt);margin-bottom:6px;">Detta värde ligger idag i fältet Organisationsnummer. Bekräfta innan det eventuellt används som personnummer.</div>
        <button type="button" class="btn bs bxs" onclick="CustomersPage._applyLegacyIdAsPersonnr()">Använd som personnummer</button>
      </div>` : '';

    return `
      <div class="fg">
        <label>Kundtyp</label>
        <select id="cu-type">
          ${isUnknown ? `<option value="" disabled selected>— Okänd kundtyp, välj rätt typ —</option>` : ''}
          <option value="foretag"         ${selectedType==='foretag'        ?'selected':''}>Företag</option>
          <option value="brf"             ${selectedType==='brf'            ?'selected':''}>BRF</option>
          <option value="fastighetsagare" ${selectedType==='fastighetsagare'?'selected':''}>Fastighetsägare</option>
          <option value="privat"          ${selectedType==='privat'         ?'selected':''}>Privatperson</option>
        </select>
        ${isUnknown ? `<div style="font-size:11px;font-weight:600;color:var(--rd);margin-top:4px;">⚠ Nuvarande sparade värde kunde inte tolkas: "${esc(rawType)}" — välj rätt kundtyp ovan innan du sparar.</div>` : ''}
      </div>

      <div id="cu-company-fields">
        <div class="fg"><label>Företags-/kundnamn <span style="color:var(--rd)">*</span></label>
          <input id="cu-name" value="${v('name')}" placeholder="BRF Solgläntan"></div>
        <div class="fg"><label>Org.nr</label><input id="cu-orgnr" value="${v('orgNr')}" placeholder="556123-4567"></div>
        <div class="fg"><label>Kontaktperson</label><input id="cu-contact" value="${v('contactPerson')}" placeholder="Anna Svensson"></div>
      </div>

      <div id="cu-private-fields" style="display:none;">
        ${legacyNameBannerHtml}
        <div class="g2">
          <div class="fg"><label>Förnamn <span style="color:var(--rd)">*</span></label>
            <input id="cu-firstname" value="${v('firstName')}" placeholder="Anna"></div>
          <div class="fg"><label>Efternamn <span style="color:var(--rd)">*</span></label>
            <input id="cu-lastname" value="${v('lastName')}" placeholder="Svensson"></div>
        </div>
        <div class="fg"><label>Personnummer</label>
          <input id="cu-personnr" value="${v('personnr')}" placeholder="YYYYMMDD-XXXX"></div>
        ${legacyIdBannerHtml}
      </div>

      <div class="g2">
        <div class="fg"><label>Telefon</label><input id="cu-phone" type="tel" value="${v('phone')}" placeholder="070-000 00 00"></div>
        <div class="fg"><label>E-post</label><input id="cu-email" type="email" value="${v('email')}" placeholder="info@exempel.se"></div>
      </div>
      <div class="fg"><label>Adress</label><input id="cu-address" value="${v('address')}" placeholder="Storgatan 1"
        autocomplete="off"
        oninput="AddressService.handleInput(this)"
        onblur="setTimeout(()=>AddressService.hideSuggestions(),150)"
        data-addr-zip="cu-zip" data-addr-city="cu-city"></div>
      <div class="g2">
        <div class="fg"><label>Postnummer</label><input id="cu-zip" value="${v('zip')}" placeholder="123 45"></div>
        <div class="fg"><label>Stad</label><input id="cu-city" value="${v('city')}" placeholder="Stockholm"></div>
      </div>

      <div class="fg" style="margin-top:4px;">
        <label><input type="checkbox" id="cu-diff-invoice" ${diffInv?'checked':''} style="width:16px;height:16px;margin-right:6px;"
          onchange="CustomersPage._toggleInvoice()">Annan fakturaadress</label>
      </div>
      <div id="cu-inv-fields" style="${diffInv?'':'display:none'}">
        <div class="fg"><label>Fakturaadress</label><input id="cu-inv-address" value="${v('invoiceAddress')}" placeholder="Fakturavägen 2"
          autocomplete="off"
          oninput="AddressService.handleInput(this)"
          onblur="setTimeout(()=>AddressService.hideSuggestions(),150)"
          data-addr-zip="cu-inv-zip" data-addr-city="cu-inv-city"></div>
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

  /* CUSTOMER LEGACY R1 §10/§11: privat och (foretag/brf/fastighetsagare)
     delar samma två fältgrupper i formuläret — "organisation" samlar de tre
     icke-privata typerna, eftersom de alla använder cu-company-fields. */
  _typeGroup(normType) {
    if (!normType) return null;
    return normType === 'privat' ? 'privat' : 'organisation';
  },

  /* Vilka FÖRE-värden på kundposten skulle bli föräldralösa skräpdata om
     typen byts bort från originalGroup utan explicit rensning — dvs. exakt
     de fält V49A2-audit-rapporten (§6/§9) visade blir kvarliggande idag.
     `name` ingår avsiktligt INTE här — det sätts alltid på nytt oavsett typ,
     det är aldrig kvarliggande skräp. Se RAPPORT-CUSTOMER-LEGACY-R1.md §6. */
  _staleFieldsForTypeGroup(cu, originalGroup) {
    if (originalGroup === 'organisation') {
      return [
        cu.orgNr         ? { label: 'Organisationsnummer', value: cu.orgNr }         : null,
        cu.contactPerson ? { label: 'Kontaktperson',        value: cu.contactPerson } : null
      ].filter(Boolean);
    }
    return [
      (cu.firstName || cu.lastName) ? { label: 'Namn',         value: `${cu.firstName||''} ${cu.lastName||''}`.trim() } : null,
      cu.personnr                   ? { label: 'Personnummer', value: cu.personnr } : null
    ].filter(Boolean);
  },

  /* Explicit bekräftelse-modal INNAN ett faktiskt kundtyp-byte (privat ↔
     organisation) sparas — R1 §9/§10. Cancel gör INGEN state-mutation (den
     underliggande redigera-modalen ligger orörd kvar i Modal._stack).
     Confirm kör onConfirm(), som i sin tur anropar _doSave() — samma
     Modal.close()-anrop där stänger DÅ både bekräftelse-modalen (redan
     poppad här) och den underliggande redigera-modalen. */
  _confirmTypeSwitch(cuTypeRaw, newType, staleFields, onConfirm) {
    const fromLabel = CustomerService.typeLabel(cuTypeRaw);
    const toLabel    = CustomerService.typeLabel(newType);
    const hasStale = staleFields.length > 0;
    const listHtml = staleFields.map(f =>
      `<div class="dr"><span class="dk">${esc(f.label)}</span><span class="dv">${esc(f.value)}</span></div>`
    ).join('');
    /* R1.1 §3: bekräftelse krävs för VARJE faktiskt privat↔organisation-byte,
       även om staleFields är tom (t.ex. type=foretag, name='Bolag AB', inga
       orgNr/contactPerson ifyllda) — R1 lät sådana byten passera helt tyst,
       vilket bröt "TYPE SWITCH MUST BE EXPLICIT"-principen. Om det inte finns
       konkreta fält att lista, förklara ändå tydligt att fältstrukturen byts. */
    Modal.open({
      title: 'Bekräfta byte av kundtyp',
      body: `
        <p style="font-size:14px;line-height:1.5;color:var(--tx);margin-bottom:10px;">
          Du ändrar kundtyp från <strong>${esc(fromLabel)}</strong> till <strong>${esc(toLabel)}</strong>.
        </p>
        ${hasStale ? `
        <p style="font-size:13px;color:var(--mt);margin-bottom:6px;">Följande uppgifter kommer att tas bort från den aktiva kundposten:</p>
        <div class="card" style="margin-bottom:10px;"><div class="card-body">${listHtml}</div></div>` : `
        <p style="font-size:13px;color:var(--mt);margin-bottom:10px;">Kundens fält byter struktur till den nya kundtypens uppgifter (företags- respektive privatfält).</p>`}
        <p style="font-size:13px;color:var(--tx);">Vill du fortsätta?</p>`,
      buttons: [
        { label: 'Byt kundtyp', cls: 'btn bp', onClick: () => { Modal.close(); onConfirm(); } },
        { label: 'Avbryt',      cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* R1 §7: "Använd som personnummer" — kopierar ENDAST det redan synliga,
     escapade legacy-värdet till #cu-personnr och sätter en form-lokal
     marker (dataset, ingen global state). Persistar INGET — användaren
     måste fortfarande trycka Spara. _doSave() läser markern och rensar då
     explicit orgNr, se R1 §15. */
  _applyLegacyIdAsPersonnr() {
    const valueEl = document.getElementById('cu-legacy-id-value');
    const input   = document.getElementById('cu-personnr');
    if (!valueEl || !input) return;
    input.value = valueEl.textContent;
    input.dataset.legacyRepair = '1';
    const box = document.getElementById('cu-legacy-id-box');
    if (box) box.innerHTML = `<div style="font-size:11px;font-weight:600;color:var(--gr);">${ic('check',12)} Kopierat till Personnummer ovan — kom ihåg att trycka Spara.</div>`;
  },

  _save(id) {
    const type = document.getElementById('cu-type').value;
    /* V49A1: tom value betyder att den disabled placeholder-optionen ("—
       Okänd kundtyp, välj rätt typ —", se _formHtml()) fortfarande är
       vald — dvs. användaren har INTE aktivt bekräftat en kundtyp för en
       kund vars lagrade värde inte gick att tolka. Blockera spar istället
       för att låta ett tomt/felaktigt värde skrivas. Se RAPPORT-V49A1.md §7. */
    if (!type) { showToast('Välj en kundtyp innan du sparar'); return; }

    /* CUSTOMER LEGACY R1/R1.1 §9/§3: om det redan sparade kundtyp-facket
       faktiskt byts (privat ↔ organisation), kräv ALLTID explicit
       bekräftelse INNAN något sparas — oavsett om det gamla facket bär
       konkreta legacy-fält eller inte (R1.1 §3: ett tyst genomsläppt byte,
       t.ex. type=foretag med bara `name` ifyllt, bröt "TYPE SWITCH MUST BE
       EXPLICIT"-principen i R1). Endast för BEFINTLIG kund — en ny kund har
       inget "från"-tillstånd att byta bort från. Organisationstyper
       sinsemellan (foretag/brf/fastighetsagare) är samma _typeGroup() och
       triggar INTE denna bekräftelse. */
    if (id) {
      const cu = getCu(id);
      if (cu) {
        const originalGroup = this._typeGroup(CustomerService.normalizeType(cu.type));
        const newGroup      = this._typeGroup(type);
        if (originalGroup && newGroup && originalGroup !== newGroup) {
          const staleFields = this._staleFieldsForTypeGroup(cu, originalGroup);
          this._confirmTypeSwitch(cu.type, type, staleFields, () => this._doSave(id, type));
          return;
        }
      }
    }
    this._doSave(id, type);
  },

  async _doSave(id, type) {
    const data = { type };
    const cu = id ? getCu(id) : null;
    const originalGroup = cu ? this._typeGroup(CustomerService.normalizeType(cu.type)) : null;
    const newGroup       = this._typeGroup(type);
    /* Sant ENDAST om typen faktiskt byts (privat↔organisation) på en
       BEFINTLIG kund — antingen direkt (inget legacy-data att förlora, se
       _save() ovan) eller efter explicit bekräftelse i _confirmTypeSwitch().
       Används för att explicit rensa den GAMLA typgruppens fält — R1 §11. */
    const groupChanged = !!(originalGroup && newGroup && originalGroup !== newGroup);

    if (type === 'privat') {
      data.firstName = (document.getElementById('cu-firstname').value || '').trim();
      data.lastName  = (document.getElementById('cu-lastname').value || '').trim();
      data.personnr  = (document.getElementById('cu-personnr')?.value || '').trim();
      /* R1.2 §1-§5: R1.1 gjorde firstName ensamt avgörande för om ett
         canonical namn skrevs — men ett icke-tomt firstName är INTE samma
         sak som ett KOMPLETT canonical namn. En legacy-privatkund med
         name='Alexandra Stadin', firstName='Alexandra', lastName='' (partial
         legacy — precis det UI:t redan flaggar via hasCanonicalPrivateName i
         _formHtml(), se dess `!!(cu && cu.firstName && cu.lastName)`) fick i
         R1.1 sitt fullständiga legacy-namn tyst trunkerat till bara 'Alexandra'
         vid en helt orelaterad ändring (t.ex. telefon), eftersom
         `if (data.firstName)` triggade direkt utan att bry sig om lastName.
         Save-logiken måste följa SAMMA "komplett canonical namn"-definition
         som edit-formulärets egen legacy-banner redan använder — annars kan
         formuläret visa en varning samtidigt som ett sparande tyst skriver
         över den data varningen handlade om.
         Se RAPPORT-CUSTOMER-LEGACY-R1-2.md §1-§3. */
      const hadIncompleteLegacyPrivateName = !!(
        cu && originalGroup === 'privat' && cu.name && !(cu.firstName && cu.lastName)
      );
      const nowHasCompletePrivateName = !!(data.firstName && data.lastName);

      if (hadIncompleteLegacyPrivateName && !nowHasCompletePrivateName) {
        /* Posten hade redan ett ofullständigt legacy-namn INNAN denna
           redigering, och användaren har INTE fyllt i ett komplett
           canonical namn (förnamn+efternamn) vid detta sparande — bevara
           legacy cu.name EXAKT, oavsett om ett enskilt firstName eller
           lastName råkar vara ifyllt (R1.2 fall A/B/C). */
        data.name = cu.name;
      } else if (data.firstName) {
        /* Antingen ett HELT NYTT canonical namn (inget legacy-problem att
           bevara), eller en KOMPLETT reparation/uppdatering av ett tidigare
           ofullständigt legacy-namn (R1.2 fall D/E) — skriv det canonical
           härledda namnet. */
        data.name = `${data.firstName} ${data.lastName}`.trim();
      } else if (cu && originalGroup === 'privat' && cu.name) {
        /* R1.1: samma-typ-bevarande för en REDAN CANONICAL kund vars
           firstName-fält just nu är tomt i formuläret (t.ex. tömt av
           misstag) — bevara befintligt namn oförändrat istället för att
           kräva Förnamn på en kund som redan hade ett komplett namn. */
        data.name = cu.name;
      } else {
        showToast('Förnamn krävs'); return;
      }
      /* R1.1 §4/§5: en tom Personnummer-input får ALDRIG konsumera/radera
         legacy orgNr — även om repair-markern är satt. Markern ensam räckte
         inte: användaren kunde klicka "Använd som personnummer", sedan
         manuellt tömma fältet igen, och Spara skulle då tyst radera BÅDA
         identitetsnumren (orgNr→'' via markern, personnr redan ''). Kräver nu
         explicit att det FAKTISKT KVARSTÅR ett icke-tomt personnummer vid
         sparande innan orgNr rensas som repair — annars bevaras orgNr
         oförändrat, exakt som en vanlig sparning utan repair redan gjorde.
         Vid ett BEKRÄFTAT typbyte till privat rensas orgNr/contactPerson
         fortsatt alltid explicit (R1 §11), oavsett repair-status. */
      const legacyRepair = document.getElementById('cu-personnr')?.dataset.legacyRepair === '1';
      if ((legacyRepair && data.personnr) || groupChanged) data.orgNr = '';
      if (groupChanged) data.contactPerson = '';
    } else {
      data.name = (document.getElementById('cu-name').value || '').trim();
      if (!data.name) { showToast('Kundnamn krävs'); return; }
      data.orgNr         = document.getElementById('cu-orgnr').value.trim();
      data.contactPerson = document.getElementById('cu-contact').value.trim();
      /* R1 §11: BEKRÄFTAT typbyte till organisation rensar alltid explicit
         de gamla privat-fälten — annars ligger de kvar som skräpdata
         (V49A2-fyndet, se RAPPORT-CUSTOMER-IMPORT-LEGACY-MAPPING-AUDIT.md §6). */
      if (groupChanged) {
        data.firstName = '';
        data.lastName  = '';
        data.personnr  = '';
      }
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
      /* V49A1: defense-in-depth — type är i praktiken alltid ett av de
         fyra kanoniska värdena här (dropdownens enda väljbara alternativ,
         se _formHtml()/_save()s tomt-värde-guard ovan), så detta bör
         aldrig faktiskt trigga. Men CustomerService.updateConfirmed() kan
         numera returnera `customer:null` om ett explicit okänt värde ändå
         skulle nå den (t.ex. ett framtida anropsställe) — visa då INTE en
         felaktig "Kund uppdaterad"-bekräftelse. */
      const result = await CustomerService.updateConfirmed(id, data);
      if (!result.customer) { showToast('Kunde inte spara kundtyp — okänt värde'); return; }

      /* GLOBAL LIVE UI R1A.1 §6/§7: persist misslyckades — rulla tillbaka
         EXAKT till pre-save-versionen (samma princip som OffersPage._save()s
         beprövade rollback, se PageShells.js), håll redigeringsmodalen
         ÖPPEN, visa INGEN framgångs-toast, gör INGEN vy-refresh (det skulle
         framställa den ej sparade ändringen som sparad). state.customers
         syftar redan på result.customer (samma objekt-referens som
         muterades i _applyUpdate()), så Object.assign(...) här återställer
         det i-minnet-objektet till exakt `before`. `state.activityLog`
         återställs SEPARAT till result.beforeActivityLog — den enda
         persist() som misslyckades täckte BÅDE kunden och den nya
         customer_updated-posten (R1A.1 undertrycker ActivityService.log()s
         egen persist() för denna väg, se CustomerService._applyUpdate()),
         så bägge måste rullas tillbaka tillsammans, annars blir en
         "spökpost" kvar lokalt i aktivitetsloggen för en ändring som
         aldrig bekräftades sparad. Full array-ersättning (inte bara att ta
         bort den nya posten) krävs eftersom ActivityService.log() kan ha
         trimmat bort en äldre post vid MAX_ENTRIES — den trimningen måste
         också ogöras. */
      if (!result.ok) {
        Object.assign(result.customer, result.before);
        if (result.beforeActivityLog) state.activityLog = result.beforeActivityLog;
        Storage.setLocal('customers', state.customers);
        Storage.setLocal('activityLog', state.activityLog);
        showToast('Kunde inte spara kunden. Försök igen.');
        return;
      }

      showToast('Kund uppdaterad');
      Modal.close();

      /* GLOBAL LIVE UI R1A §11: refresh ENDAST om AKTUELL vy faktiskt
         visar den sparade kunden — ingen bred rollout, ingen global
         rerender. Detaljvyn rendras via _renderFull() direkt (inte
         Router.refreshCurrent()) eftersom _renderFull() redan bevarar
         aktiv flik (CustomerDetailPage.tab är en modul-property som
         _renderFull() aldrig rör) och undviker showPage()s bieffekter
         (scroll-reset till toppen, SelectionModel.onNavigate, etc.) som
         inte behövs för en ren data-refresh av samma sida. Listvyn
         återanvänder Router.refreshCurrent(), vilket i praktiken bara
         återanropar CustomersPage.render() — identiskt med det
         "this.render()"-anrop som redan gjordes här innan R1A, så inget
         nytt beteende (sök/filter/sortering ligger redan i modul-scope
         properties, inte DOM, och överlever därför oförändrat). */
      if (Router.currentPage === 'pg-crm-detail' &&
          Router.currentParams && Router.currentParams.customerId === id) {
        CustomerDetailPage._renderFull(document.getElementById('pg-crm-detail-content'));
      } else if (Router.currentPage === 'pg-crm') {
        Router.refreshCurrent();
      }
      /* Alla andra rutter: ingen forced refresh i R1A (§11 C) — dolda
         moduler renderas ändå fräscht när de senare öppnas. */
    } else {
      const newCu = CustomerService.create(data);
      if (!newCu) { showToast('Kunde inte spara kundtyp — okänt värde'); return; }
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
  },

  /* ── Export ──────────────────────────── */

  _showExportMenu(btn) {
    // Enkel dropdown via popover
    const existing = document.getElementById('cust-export-menu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.id = 'cust-export-menu';
    menu.className = 'dropdown-menu';
    menu.style.cssText = 'position:absolute;z-index:900;background:var(--bg);border:1px solid var(--br);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:6px;min-width:200px';

    const items = [
      { icon: 'file-text', label: 'Exportera CSV (alla kunder)',        fn: () => this._exportCSV('all') },
      { icon: 'file-text', label: 'Exportera CSV (filtrerade)',         fn: () => this._exportCSV('filtered') },
      { icon: 'table',     label: 'Exportera XLSX (fullständig)',       fn: () => this._exportXLSX() }
    ];

    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'dropdown-item';
      div.innerHTML = ic(item.icon, 14) + ' ' + item.label;
      div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;';
      div.onmouseenter = () => div.style.background = 'var(--bg2)';
      div.onmouseleave = () => div.style.background = '';
      div.onclick = () => { menu.remove(); item.fn(); };
      menu.appendChild(div);
    });

    const rect = btn.getBoundingClientRect();
    menu.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
    document.body.appendChild(menu);

    const closer = (e) => {
      if (!menu.contains(e.target) && e.target !== btn) {
        menu.remove();
        document.removeEventListener('click', closer, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closer, true), 10);
  },

  _getFilteredList() {
    let list = CustomerService.search(this.q);
    if (this._typeFilter === 'inaktiva') {
      list = list.filter(c => c.inactive);
    } else if (this._typeFilter && this._typeFilter !== 'alla') {
      /* V49A1: jämför NORMALISERAT värde, inte rått c.type — annars
         försvinner en legacy-kund (type='company' e.dyl.) tyst ur
         Företag-fliken trots att typeLabel() redan visar "Företag" för
         den överallt annars. Se RAPPORT-V49A1.md §12. */
      list = list.filter(c => CustomerService.normalizeType(c.type) === this._typeFilter && !c.inactive);
    } else {
      list = list.filter(c => !c.inactive);
    }
    return list;
  },

  _exportCSV(scope) {
    const customers = scope === 'filtered' ? this._getFilteredList() : state.customers.filter(c => !c.deleted);
    const { headers, rows } = ImportExportService.buildCustomerExportRows(customers);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    ImportExportService.downloadCSV('kunder-' + ts + '.csv', headers, rows);
    showToast('Exporterar ' + customers.length + ' kunder som CSV…');
  },

  _exportXLSX() {
    const customers = state.customers.filter(c => !c.deleted);

    // Blad 1: Kunder
    const { headers: h1, rows: r1 } = ImportExportService.buildCustomerExportRows(customers);

    // Blad 2: Kontaktpersoner (alla kontakter ur contacts[])
    const h2 = ['KundID', 'Kundnamn', 'Kontaktnamn', 'Roll', 'Telefon', 'E-post'];
    const r2 = [];
    customers.forEach(c => {
      (c.contacts || []).forEach(ct => {
        r2.push([c.id, CustomerService.displayName(c), ct.name || '', ct.role || '', ct.phone || '', ct.email || '']);
      });
    });

    // Blad 3: Fastigheter (kopplade per kund)
    const h3 = ['KundID', 'Kundnamn', 'FastighetsID', 'Fastighetsbeteckning', 'Adress', 'Ort'];
    const r3 = [];
    customers.forEach(c => {
      (state.properties || []).filter(p => p.customerId === c.id).forEach(p => {
        r3.push([c.id, CustomerService.displayName(c), p.id, p.propertyDesignation || '', p.address || '', p.city || '']);
      });
    });

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    ImportExportService.downloadXLSX('kunder-' + ts + '.xlsx', [
      { name: 'Kunder',          headers: h1, rows: r1 },
      { name: 'Kontaktpersoner', headers: h2, rows: r2 },
      { name: 'Fastigheter',     headers: h3, rows: r3 }
    ]);
    showToast('Exporterar ' + customers.length + ' kunder som XLSX…');
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
    /* CUSTOMER LEGACY R1 §16: en privatkund vars enda identitetsnummer
       ligger legacy i orgNr (personnr tomt) ska INTE visas som om det vore
       ett vanligt, canonical Org.nr — det vore en tyst felaktig omtolkning.
       Visa istället explicit att värdet är importerat/legacy, utan att
       flytta/gissa/ändra något i data. Se RAPPORT-CUSTOMER-LEGACY-R1.md §6/§16. */
    const normType = CustomerService.normalizeType(cu.type);
    const isLegacyIdOnPrivate = normType === 'privat' && !cu.personnr && !!cu.orgNr;
    const rows = [
      ['Typ',         CustomerService.typeLabel(cu.type)],
      ['Telefon',     cu.phone   || '—'],
      ['E-post',      cu.email   || '—'],
      ['Adress',      [cu.address, cu.zip, cu.city].filter(Boolean).join(', ') || '—'],
      isLegacyIdOnPrivate
        ? ['Importerat nummer', `${esc(cu.orgNr)} <span style="color:var(--mt);font-weight:500;">(ligger i fältet Org.nr)</span>`]
        : (cu.orgNr ? ['Org.nr', cu.orgNr] : null),
      (!isLegacyIdOnPrivate && cu.personnr) ? ['Personnummer', cu.personnr] : null,
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

  /* V46 R3: samma aktiv-pipeline-statusar som SalesPage.ACTIVE_STATUSES, hållna
     som en lokal kopia här eftersom SalesPage.js inte får ändras/beros på i R3. */
  _SALES_ACTIVE_STATUSES: ['new', 'contact_needed', 'contacted', 'quote_created', 'work_order_created'],
  _salesTypeLabel(type) {
    const m = {
      service_agreement:'Serviceavtal', seasonal_job:'Säsongsarbete',
      upsell:'Merförsäljning', quote_followup:'Offertuppföljning', win_back:'Vinn tillbaka',
      new_customer:'Ny kund', other:'Övrigt'
    };
    return m[type] || type;
  },
  _salesStatusBadge(status) {
    /* sbdg()/statusClass()/statusLabel() (state.js) saknar Svenska etiketter för
       säljpipelinens tre mellansteg — lokal komplettering, återanvänder befintlig
       .bdg-komponent, ingen ny CSS-klass. Övriga statusar (new/contacted/snoozed/
       won/lost/done/dismissed) renderas redan korrekt av befintlig sbdg(). */
    const extraLabels = { contact_needed: 'Kontakt behövs', quote_created: 'Offert skapad', work_order_created: 'AO skapad' };
    const extraCls    = { contact_needed: 'bdg-orange', quote_created: 'bdg-sky', work_order_created: 'bdg-sky' };
    if (extraLabels[status]) return `<span class="bdg ${extraCls[status]}">${extraLabels[status]}</span>`;
    return sbdg(status);
  },
  _tabSales(cu) {
    const sales = (state.salesOpportunities||[]).filter(s => s.customerId === cu.id);
    if (!sales.length) return `<div class="empty"><p>Inga säljchanser</p></div>`;
    return sales.map(s => {
      const isOverdue = !!(s.dueDate && s.dueDate < tdy() && this._SALES_ACTIVE_STATUSES.includes(s.status));
      const overdueBadge = isOverdue ? `<span class="bdg bdg-red">${ic('alert-triangle',9)} Förfallen</span>` : '';
      const typeBadge = s.type && s.type !== 'other' ? `<span class="bdg bdg-grey">${this._salesTypeLabel(s.type)}</span>` : '';
      const staffName = s.assignedStaffId ? getStaff(s.assignedStaffId) : null;
      const staffLabel = staffName ? (staffName.firstName+' '+staffName.lastName).trim() : '';
      const sub = [
        s.suggestedAction ? s.suggestedAction : '',
        staffLabel ? 'Ansvarig: '+staffLabel : '',
        s.dueDate ? (isOverdue ? '<span style="color:var(--rd);font-weight:700;">'+fmtDate(s.dueDate)+'</span>' : fmtDate(s.dueDate)) : '',
        s.estimatedValue > 0 ? fmt(s.estimatedValue)+' kr' : ''
      ].filter(Boolean).join(' · ');
      return `
        <div class="list-item" onclick="Router.showPage('pg-sales')">
          <div class="item-row">
            <div>
              <div class="item-title">${s.title}</div>
              ${sub ? `<div class="item-sub">${sub}</div>` : ''}
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
              ${this._salesStatusBadge(s.status)}${typeBadge}${overdueBadge}
            </div>
          </div>
        </div>`;
    }).join('');
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
      /* V46 R2: säljchansers contactId är ett array-index i cu.contacts[] — när ett
         index tas bort måste kopplingen justeras i SAMMA mutation, annars pekar
         chansen fel efter borttagningen. */
      (state.salesOpportunities || []).forEach(op => {
        if (!op || op.customerId !== this.customerId) return;
        if (op.contactId === undefined || op.contactId === null || op.contactId === '') return;
        const n = Number(op.contactId);
        if (!Number.isInteger(n)) return;
        if (n === idx) op.contactId = '';
        else if (n > idx) op.contactId = String(n - 1);
      });
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
