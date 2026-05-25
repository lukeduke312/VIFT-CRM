/**
 * PropertyDetailPage — Fullständigt fastighetskort (Fas 3, Modul 1)
 */
const PropertyDetailPage = {
  propId: null,

  render(params) {
    const el = document.getElementById('pg-obj-detail-content');
    if (!el) return;
    const id = params && params.propId;
    this.propId = id;
    const p = id ? getObj(id) : null;
    if (!p) {
      el.innerHTML = `<div class="empty">${ic('building-2',36)}<h3>Välj en fastighet</h3></div>`;
      return;
    }
    this._renderFull(el, p);
  },

  _renderFull(el, p) {
    const cu      = getCu(p.customerId);
    const cuName  = cu ? CustomerService.displayName(cu) : '—';
    const aos     = (state.workOrders || [])
                      .filter(a => a.propertyId === p.id)
                      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const recs    = (state.recurringOrders || []).filter(r => r.propertyId === p.id);
    const contacts= p.contacts || [];
    const notes   = p.notes || [];
    const tech    = p.technicalSystems || {};
    const insp    = p.inspections || {};

    el.innerHTML = `
      <!-- Action panel -->
      <div class="ao-action-panel">
        <div class="ao-action-panel-left">
          <button class="btn bs bsm" onclick="Router.showPage('pg-objects')" title="Tillbaka">${ic('arrow-left',14)}</button>
          <span style="font-size:11px;font-weight:700;color:var(--mt);">${p.id}</span>
        </div>
        <div class="ao-action-panel-badges">
          ${p.status === 'aktiv'
            ? `<span class="bdg bdg-green">Aktiv</span>`
            : `<span class="bdg bdg-grey">Inaktiv</span>`}
          ${p.type ? `<span class="bdg bdg-blue" style="font-size:10px;">${p.type}</span>` : ''}
        </div>
        <div class="ao-action-panel-btns">
          ${Auth.can('properties_manage')
            ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openEdit()">${ic('pencil',13)} Redigera</button>`
            : ''}
        </div>
      </div>

      <!-- Grundinfo -->
      <div class="card">
        <div class="card-header">
          <h3 style="font-size:14px;font-weight:800;color:var(--navy);line-height:1.3;">${p.name}</h3>
        </div>
        <div class="card-body">
          <div class="dr"><span class="dk">Ägare / kund</span>
            <span class="dv" style="${cu ? 'cursor:pointer;color:var(--sky);' : ''}"
              ${cu ? `onclick="Router.showPage('pg-crm-detail',{customerId:'${cu.id}'})"` : ''}>
              ${cuName}
            </span></div>
          <div class="dr"><span class="dk">Adress</span>
            <span class="dv">${[p.address, p.zip, p.city].filter(Boolean).join(', ') || '—'}</span></div>
          ${p.propertyDesignation
            ? `<div class="dr"><span class="dk">Beteckning</span><span class="dv">${p.propertyDesignation}</span></div>`
            : ''}
          ${p.buildYear
            ? `<div class="dr"><span class="dk">Byggår</span><span class="dv">${p.buildYear}</span></div>`
            : ''}
          ${p.area
            ? `<div class="dr"><span class="dk">Yta</span><span class="dv">${fmt(p.area)} m²</span></div>`
            : ''}
          ${p.floors
            ? `<div class="dr"><span class="dk">Våningar</span><span class="dv">${p.floors}</span></div>`
            : ''}
          ${p.apartments
            ? `<div class="dr"><span class="dk">Lägenheter</span><span class="dv">${p.apartments} st</span></div>`
            : ''}
          ${p.accessCode
            ? `<div class="dr"><span class="dk">Portkod</span><span class="dv">${p.accessCode}</span></div>`
            : ''}
          ${p.note
            ? `<div class="nbox" style="margin-top:8px;">${ic('eye',13)} ${p.note}</div>`
            : ''}
        </div>
      </div>

      <!-- Kontaktpersoner -->
      <div class="card">
        <div class="card-header">
          <h3>${ic('users',14)} Kontaktpersoner</h3>
          ${Auth.can('properties_manage')
            ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openAddContact()">${ic('plus',13)}</button>`
            : ''}
        </div>
        <div class="card-body" id="prop-contacts">
          ${this._renderContacts(contacts)}
        </div>
      </div>

      <!-- Kopplade AO -->
      <div class="card">
        <div class="card-header">
          <h3>${ic('clipboard-list',14)} Arbetsorder</h3>
          <span class="bdg bdg-blue">${aos.length}</span>
          ${Auth.can('ao_create')
            ? `<button class="btn bp bxs" onclick="WorkOrdersPage.openCreate()" style="margin-left:4px;">${ic('plus',13)} Ny AO</button>`
            : ''}
        </div>
        <div class="card-body">
          ${aos.length === 0
            ? `<div class="empty" style="padding:12px 0;">${ic('clipboard-list',24)}<p style="font-size:12px;color:var(--mt);">Inga arbetsorder kopplade till denna fastighet</p></div>`
            : aos.map(ao => `
              <div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
                <div style="flex:1;min-width:0;">
                  <div class="crow-title"><span style="font-size:10px;font-weight:700;color:var(--mt);margin-right:4px;">${ao.id}</span>${ao.title}</div>
                  <div class="crow-sub">${fmtDate(ao.scheduledDate || ao.createdAt)}</div>
                </div>
                <div style="display:flex;gap:4px;flex-shrink:0;">${sbdg(ao.status)}${pbdg(ao.priority)}</div>
              </div>`).join('')
          }
        </div>
      </div>

      <!-- Återkommande ärenden -->
      <div class="card">
        <div class="card-header">
          <h3>${ic('repeat',14)} Återkommande ärenden</h3>
          <span class="bdg bdg-${recs.length > 0 ? 'blue' : 'grey'}">${recs.length}</span>
        </div>
        <div class="card-body">
          ${recs.length === 0
            ? `<p style="font-size:12px;color:var(--mt);padding:4px 0;">Inga återkommande ärenden kopplade till denna fastighet</p>`
            : recs.map(r => `
              <div class="crow" onclick="Router.showPage('pg-recurring')">
                <div style="flex:1;min-width:0;">
                  <div class="crow-title">${r.title}</div>
                  <div class="crow-sub">${r.frequencyLabel || r.frequency || ''}</div>
                </div>
                <span class="bdg bdg-${r.active !== false ? 'green' : 'grey'}" style="font-size:9px;">
                  ${r.active !== false ? 'Aktiv' : 'Pausad'}
                </span>
              </div>`).join('')
          }
        </div>
      </div>

      <!-- Teknisk information (accordion) -->
      <div class="card">
        <div class="card-header" style="cursor:pointer;" onclick="PropertyDetailPage._toggleAccordion('tech')">
          <h3>${ic('settings',14)} Teknisk information</h3>
          <span id="prop-tech-chevron" style="transition:transform .2s;">${ic('chevron-down',14)}</span>
        </div>
        <div id="prop-tech-body" style="display:none;">
          <div class="card-body">
            ${this._renderTechInfo(tech)}
            ${Auth.can('properties_manage')
              ? `<button class="btn bs bsm" style="margin-top:8px;" onclick="PropertyDetailPage.openEditTech()">${ic('pencil',13)} Redigera teknisk info</button>`
              : ''}
          </div>
        </div>
      </div>

      <!-- Besiktningar (accordion) -->
      <div class="card">
        <div class="card-header" style="cursor:pointer;" onclick="PropertyDetailPage._toggleAccordion('insp')">
          <h3>${ic('shield-check',14)} Besiktningar & lagstadgade krav</h3>
          <span id="prop-insp-chevron" style="transition:transform .2s;">${ic('chevron-down',14)}</span>
        </div>
        <div id="prop-insp-body" style="display:none;">
          <div class="card-body">
            ${this._renderInspections(insp)}
            ${Auth.can('properties_manage')
              ? `<button class="btn bs bsm" style="margin-top:8px;" onclick="PropertyDetailPage.openEditInsp()">${ic('pencil',13)} Redigera besiktningar</button>`
              : ''}
          </div>
        </div>
      </div>

      <!-- Anteckningar -->
      <div class="card">
        <div class="card-header">
          <h3>${ic('file-text',14)} Anteckningar</h3>
          ${Auth.can('properties_manage')
            ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openAddNote()">${ic('plus',13)}</button>`
            : ''}
        </div>
        <div class="card-body" id="prop-notes">
          ${this._renderNotes(notes)}
        </div>
      </div>

      <!-- Dokument (platshållare) -->
      <div class="card">
        <div class="card-header">
          <h3>${ic('folder',14)} Dokument</h3>
        </div>
        <div class="card-body">
          <div class="ibox" style="text-align:center;padding:16px;">
            ${ic('upload-cloud',24)}
            <p style="font-size:12px;color:var(--mt);margin-top:8px;line-height:1.5;">
              Filuppladdning aktiveras när backend är på plats (Fas 4).<br>
              <span style="font-size:11px;">Bifoga ritningar, avtal, OVK-protokoll och bilder.</span>
            </p>
          </div>
        </div>
      </div>
    `;
  },

  /* ── Renderhj älpare ───────────────────────── */

  _renderContacts(contacts) {
    if (!contacts.length) {
      return `<p style="font-size:12px;color:var(--mt);padding:4px 0;">Inga kontaktpersoner registrerade</p>`;
    }
    return contacts.map((c, i) => `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid var(--bg);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;">${c.name || '—'}</div>
          ${c.role ? `<div style="font-size:11px;color:var(--mt);">${c.role}</div>` : ''}
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:2px;">
            ${c.phone ? `<a href="tel:${c.phone}" style="font-size:11px;color:var(--sky);">${ic('phone',10)} ${c.phone}</a>` : ''}
            ${c.email ? `<a href="mailto:${c.email}" style="font-size:11px;color:var(--sky);">${ic('mail',10)} ${c.email}</a>` : ''}
          </div>
        </div>
        ${Auth.can('properties_manage') ? `
          <button class="btn bxs bs" onclick="PropertyDetailPage.openAddContact(${i})">${ic('pencil',11)}</button>
          <button class="btn bxs bd" onclick="PropertyDetailPage.removeContact(${i})">${ic('trash',11)}</button>
        ` : ''}
      </div>`).join('');
  },

  _renderTechInfo(tech) {
    const labels = {
      heating:     'Värmesystem',
      ventilation: 'Ventilation',
      water:       'VA / Rör',
      electricity: 'El',
      elevator:    'Hiss',
      alarm:       'Larm',
      sprinkler:   'Sprinkler',
      other:       'Övrigt'
    };
    const entries = Object.entries(tech).filter(([, v]) => v);
    if (!entries.length) {
      return `<p style="font-size:12px;color:var(--mt);">Ingen teknisk information registrerad</p>`;
    }
    return entries.map(([k, v]) =>
      `<div class="dr"><span class="dk">${labels[k] || cap(k)}</span><span class="dv">${v}</span></div>`
    ).join('');
  },

  _renderInspections(insp) {
    const types = {
      ovk:  'OVK (Obligatorisk Ventilationskontroll)',
      sba:  'SBA (Systematiskt Brandskyddsarbete)',
      hiss: 'Hissbesiktning',
      el:   'Elbesiktning',
      pbe:  'PBE-kontroll'
    };
    const entries = Object.entries(insp).filter(([, v]) => v);
    if (!entries.length) {
      return `<p style="font-size:12px;color:var(--mt);">Inga besiktningar registrerade</p>`;
    }
    return entries.map(([k, v]) => {
      const isOverdue = v.nextDate && v.nextDate < tdy();
      const statusBdg = v.status === 'godkänd'
        ? `<span class="bdg bdg-green">Godkänd</span>`
        : v.status === 'försenad' || isOverdue
          ? `<span class="bdg bdg-red">Försenad</span>`
          : `<span class="bdg bdg-grey">${v.status || '—'}</span>`;
      return `
        <div style="padding:8px 0;border-bottom:1px solid var(--bg);">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="font-size:12px;font-weight:700;">${types[k] || k.toUpperCase()}</span>
            ${statusBdg}
            ${isOverdue ? `<span class="bdg bdg-red">FÖRSENAD</span>` : ''}
          </div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;">
            ${v.lastDate ? `<span style="font-size:11px;color:var(--mt);">Senast: ${fmtDate(v.lastDate)}</span>` : ''}
            ${v.nextDate ? `<span style="font-size:11px;color:${isOverdue ? 'var(--rd)' : 'var(--mt)'};">Nästa: ${fmtDate(v.nextDate)}</span>` : ''}
          </div>
        </div>`;
    }).join('');
  },

  _renderNotes(notes) {
    if (!notes.length) {
      return `<p style="font-size:12px;color:var(--mt);padding:4px 0;">Inga anteckningar</p>`;
    }
    return [...notes].reverse().map((n, i) => `
      <div style="padding:8px 0;border-bottom:1px solid var(--bg);">
        <div style="font-size:12px;line-height:1.5;color:var(--tx);white-space:pre-wrap;">${n.text}</div>
        <div style="font-size:10px;color:var(--mt);margin-top:4px;">
          ${n.createdBy || 'Okänd'} · ${relDate(n.createdAt)}
        </div>
      </div>`).join('');
  },

  /* ── Accordion ─────────────────────────────── */

  _toggleAccordion(key) {
    const body    = document.getElementById(`prop-${key}-body`);
    const chevron = document.getElementById(`prop-${key}-chevron`);
    if (!body) return;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  },

  /* ── Redigera grundinfo ────────────────────── */

  openEdit() {
    const p = getObj(this.propId);
    if (!p) return;
    Modal.open({
      title: `Redigera ${p.name}`,
      wide: true,
      body: this._formHtml(p),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._saveBasic() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('prop-name')?.focus(), 80);
  },

  _formHtml(p) {
    const v = (k, d = '') => p ? (p[k] != null ? p[k] : d) : d;
    const types = ['Flerbostadshus', 'Kontorsfastighet', 'Industrifastighet', 'BRF', 'Villa', 'Butiksfastighet', 'Lager', 'Övrigt'];
    return `
      <div class="fg"><label>Namn <span style="color:var(--rd)">*</span></label>
        <input id="prop-name" value="${v('name')}" placeholder="T.ex. Solvägen 1, Fastighet A…"></div>
      <div class="fg"><label>Fastighetsbeteckning</label>
        <input id="prop-desig" value="${v('propertyDesignation')}" placeholder="T.ex. Stockholm Haga 1:234"></div>
      <div class="fg"><label>Ägare / kund</label>
        <select id="prop-cu">
          <option value="">— Välj kund —</option>
          ${(state.customers || []).map(c =>
            `<option value="${c.id}" ${v('customerId') === c.id ? 'selected' : ''}>${CustomerService.displayName(c)}</option>`
          ).join('')}
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
            <option value="">— Välj typ —</option>
            ${types.map(t => `<option ${v('type') === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select></div>
        <div class="fg"><label>Byggår</label>
          <input id="prop-year" value="${v('buildYear')}" placeholder="T.ex. 1985"></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Yta (m²)</label>
          <input type="number" id="prop-area" value="${v('area', 0)}" min="0"></div>
        <div class="fg"><label>Våningar</label>
          <input type="number" id="prop-floors" value="${v('floors', '')}"></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Lägenheter</label>
          <input type="number" id="prop-apts" value="${v('apartments', 0)}" min="0"></div>
        <div class="fg"><label>Portkod / åtkomst</label>
          <input id="prop-access" value="${v('accessCode')}" placeholder="T.ex. 1234#"></div>
      </div>
      <div class="fg"><label>Intern anteckning</label>
        <textarea id="prop-note" rows="2" placeholder="Visas internt…">${v('note')}</textarea></div>`;
  },

  _saveBasic() {
    const name = document.getElementById('prop-name')?.value.trim();
    if (!name) { showToast('Namn krävs'); return; }
    const idx = (state.properties || []).findIndex(x => x.id === this.propId);
    if (idx < 0) return;
    state.properties[idx] = {
      ...state.properties[idx],
      name,
      propertyDesignation: document.getElementById('prop-desig')?.value.trim() || '',
      customerId:  document.getElementById('prop-cu')?.value || '',
      address:     document.getElementById('prop-addr')?.value.trim() || '',
      zip:         document.getElementById('prop-zip')?.value.trim() || '',
      city:        document.getElementById('prop-city')?.value.trim() || '',
      type:        document.getElementById('prop-type')?.value || '',
      buildYear:   document.getElementById('prop-year')?.value || '',
      area:        parseFloat(document.getElementById('prop-area')?.value) || 0,
      floors:      parseInt(document.getElementById('prop-floors')?.value) || '',
      apartments:  parseInt(document.getElementById('prop-apts')?.value) || 0,
      accessCode:  document.getElementById('prop-access')?.value.trim() || '',
      note:        document.getElementById('prop-note')?.value.trim() || '',
      updatedAt:   new Date().toISOString()
    };
    persist();
    Modal.close();
    showToast('Fastighet uppdaterad');
    this.render({ propId: this.propId });
  },

  /* ── Kontaktpersoner ───────────────────────── */

  openAddContact(idx = null) {
    const p = getObj(this.propId);
    if (!p) return;
    const c = idx !== null ? (p.contacts || [])[idx] : null;
    Modal.open({
      title: c ? 'Redigera kontaktperson' : 'Lägg till kontaktperson',
      body: `
        <div class="g2">
          <div class="fg"><label>Namn <span style="color:var(--rd)">*</span></label>
            <input id="pc-name" value="${c ? c.name || '' : ''}" placeholder="Förnamn Efternamn"></div>
          <div class="fg"><label>Roll</label>
            <input id="pc-role" value="${c ? c.role || '' : ''}" placeholder="T.ex. Fastighetsskötare, BRF-ordförande…"></div>
        </div>
        <div class="g2">
          <div class="fg"><label>Telefon</label>
            <input id="pc-phone" type="tel" value="${c ? c.phone || '' : ''}" placeholder="070-XXX XX XX"></div>
          <div class="fg"><label>E-post</label>
            <input id="pc-email" type="email" value="${c ? c.email || '' : ''}" placeholder="namn@exempel.se"></div>
        </div>`,
      buttons: [
        { label: c ? 'Spara' : 'Lägg till', cls: 'btn bp', onClick: () => this._saveContact(idx) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('pc-name')?.focus(), 80);
  },

  _saveContact(idx) {
    const name = document.getElementById('pc-name')?.value.trim();
    if (!name) { showToast('Namn krävs'); return; }
    const prop = getObj(this.propId);
    if (!prop) return;
    if (!prop.contacts) prop.contacts = [];
    const contact = {
      name,
      role:  document.getElementById('pc-role')?.value.trim() || '',
      phone: document.getElementById('pc-phone')?.value.trim() || '',
      email: document.getElementById('pc-email')?.value.trim() || ''
    };
    if (idx !== null) {
      prop.contacts[idx] = contact;
    } else {
      prop.contacts.push(contact);
    }
    persist();
    Modal.close();
    document.getElementById('prop-contacts').innerHTML = this._renderContacts(prop.contacts);
    showToast(idx !== null ? 'Kontaktperson uppdaterad' : 'Kontaktperson tillagd');
  },

  removeContact(idx) {
    const prop = getObj(this.propId);
    if (!prop || !prop.contacts) return;
    prop.contacts.splice(idx, 1);
    persist();
    document.getElementById('prop-contacts').innerHTML = this._renderContacts(prop.contacts);
    showToast('Kontaktperson borttagen');
  },

  /* ── Teknisk info ──────────────────────────── */

  openEditTech() {
    const p = getObj(this.propId);
    if (!p) return;
    const t = p.technicalSystems || {};
    const fields = [
      { key: 'heating',     label: 'Värmesystem',  ph: 'T.ex. Fjärrvärme, Bergvärme…' },
      { key: 'ventilation', label: 'Ventilation',  ph: 'T.ex. FTX, CAV, F…' },
      { key: 'water',       label: 'VA / Rör',     ph: 'T.ex. Plaströr 2010…' },
      { key: 'electricity', label: 'El',           ph: 'T.ex. 3-fas, 400V…' },
      { key: 'elevator',    label: 'Hiss',         ph: 'T.ex. Schindler 2000, saknas…' },
      { key: 'alarm',       label: 'Larm',         ph: 'T.ex. Bosch BA9000…' },
      { key: 'sprinkler',   label: 'Sprinkler',    ph: 'T.ex. Finns/Saknas…' },
      { key: 'other',       label: 'Övrigt',       ph: 'Annan teknisk information…' }
    ];
    Modal.open({
      title: 'Teknisk information',
      wide: true,
      body: fields.map(f =>
        `<div class="fg"><label>${f.label}</label>
           <input id="tech-${f.key}" value="${t[f.key] || ''}" placeholder="${f.ph}"></div>`
      ).join(''),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._saveTech(fields) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveTech(fields) {
    const prop = getObj(this.propId);
    if (!prop) return;
    const tech = {};
    fields.forEach(f => {
      const val = document.getElementById(`tech-${f.key}`)?.value.trim();
      if (val) tech[f.key] = val;
    });
    prop.technicalSystems = tech;
    persist();
    Modal.close();
    const body = document.getElementById('prop-tech-body').querySelector('.card-body');
    if (body) body.innerHTML = this._renderTechInfo(tech) +
      (Auth.can('properties_manage')
        ? `<button class="btn bs bsm" style="margin-top:8px;" onclick="PropertyDetailPage.openEditTech()">${ic('pencil',13)} Redigera teknisk info</button>`
        : '');
    showToast('Teknisk info sparad');
  },

  /* ── Besiktningar ──────────────────────────── */

  openEditInsp() {
    const p = getObj(this.propId);
    if (!p) return;
    const insp = p.inspections || {};
    const types = [
      { key: 'ovk',  label: 'OVK' },
      { key: 'sba',  label: 'SBA' },
      { key: 'hiss', label: 'Hissbesiktning' },
      { key: 'el',   label: 'Elbesiktning' },
      { key: 'pbe',  label: 'PBE-kontroll' }
    ];
    Modal.open({
      title: 'Besiktningar & lagstadgade krav',
      wide: true,
      body: types.map(t => {
        const v = insp[t.key] || {};
        return `
          <div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--bg);">
            <div style="font-size:12px;font-weight:700;color:var(--navy);margin-bottom:6px;">${t.label}</div>
            <div class="g2">
              <div class="fg"><label>Senaste datum</label>
                <input type="date" id="insp-${t.key}-last" value="${v.lastDate || ''}"></div>
              <div class="fg"><label>Nästa datum</label>
                <input type="date" id="insp-${t.key}-next" value="${v.nextDate || ''}"></div>
            </div>
            <div class="fg"><label>Status</label>
              <select id="insp-${t.key}-status">
                <option value="">— Välj —</option>
                ${['godkänd', 'försenad', 'ej utförd', 'planerad'].map(s =>
                  `<option ${v.status === s ? 'selected' : ''}>${s}</option>`
                ).join('')}
              </select></div>
          </div>`;
      }).join(''),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._saveInsp(types) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveInsp(types) {
    const prop = getObj(this.propId);
    if (!prop) return;
    const insp = {};
    types.forEach(t => {
      const last   = document.getElementById(`insp-${t.key}-last`)?.value;
      const next   = document.getElementById(`insp-${t.key}-next`)?.value;
      const status = document.getElementById(`insp-${t.key}-status`)?.value;
      if (last || next || status) {
        insp[t.key] = { lastDate: last || '', nextDate: next || '', status: status || '' };
      }
    });
    prop.inspections = insp;
    persist();
    Modal.close();
    const body = document.getElementById('prop-insp-body').querySelector('.card-body');
    if (body) body.innerHTML = this._renderInspections(insp) +
      (Auth.can('properties_manage')
        ? `<button class="btn bs bsm" style="margin-top:8px;" onclick="PropertyDetailPage.openEditInsp()">${ic('pencil',13)} Redigera besiktningar</button>`
        : '');
    showToast('Besiktningar sparade');
  },

  /* ── Anteckningar ──────────────────────────── */

  openAddNote() {
    Modal.open({
      title: 'Ny anteckning',
      body: `
        <div class="fg"><label>Anteckning</label>
          <textarea id="prop-note-text" rows="4" placeholder="Skriv en intern anteckning…"></textarea></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._saveNote() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('prop-note-text')?.focus(), 80);
  },

  _saveNote() {
    const text = document.getElementById('prop-note-text')?.value.trim();
    if (!text) { showToast('Ange en anteckning'); return; }
    const prop = getObj(this.propId);
    if (!prop) return;
    if (!prop.notes) prop.notes = [];
    prop.notes.push({
      id:        'N' + Date.now(),
      text,
      createdAt: new Date().toISOString(),
      createdBy: state.currentUser
        ? `${state.currentUser.firstName || ''} ${state.currentUser.lastName || ''}`.trim()
        : 'Okänd'
    });
    persist();
    Modal.close();
    document.getElementById('prop-notes').innerHTML = this._renderNotes(prop.notes);
    showToast('Anteckning sparad');
  }
};
