/**
 * PropertyDetailPage — Fullständigt fastighetskort (Fas 3, Modul 1 v2)
 * Tabs: Översikt | Kontakt | Teknisk info | Arbetsorder | Återkommande | Bilder | Anteckningar
 */
const PropertyDetailPage = {
  propId: null,
  activeTab: 'overview',

  render(params) {
    const el = document.getElementById('pg-obj-detail-content');
    if (!el) return;
    const id = params && params.propId;
    this.propId = id;
    if (params && params.tab) this.activeTab = params.tab;
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
                      .sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    const openAos = aos.filter(a => !['klar','fakturerad','avbruten'].includes(a.status)).length;
    const recs    = (state.recurringOrders || []).filter(r => r.propertyId === p.id);
    const contacts= p.contacts || [];
    const notes   = p.notes || [];
    const tech    = p.technicalSystems || {};
    const insp    = p.inspections || {};
    const images  = p.images || [];
    const overdueInsp = Object.values(insp).filter(v => v.nextDate && v.nextDate < tdy()).length;
    const addrLine = p.address || '';
    const cityLine = [p.zip, p.city].filter(Boolean).join(' ');
    const fullAddr = [addrLine, cityLine].filter(Boolean).join(', ');
    const mapsUrl  = fullAddr ? `https://maps.google.com/?q=${encodeURIComponent(fullAddr)}` : '';

    el.innerHTML = `
      <!-- Action panel -->
      <div class="ao-action-panel">
        <div class="ao-action-panel-left">
          <button class="btn bs bsm ao-back-btn" onclick="Router.back()">${ic('arrow-left',14)} Tillbaka</button>
          <span style="font-size:11px;font-weight:700;color:var(--mt);">${p.id}${p.objectNumber?' · '+p.objectNumber:''}</span>
        </div>
        <div class="ao-action-panel-badges">
          ${p.status==='aktiv'
            ? `<span class="bdg bdg-green">Aktiv</span>`
            : `<span class="bdg bdg-grey">Inaktiv</span>`}
          ${p.type ? `<span class="bdg bdg-blue" style="font-size:10px;">${p.type}</span>` : ''}
          ${overdueInsp > 0 ? `<span class="bdg bdg-red">${overdueInsp} försenade</span>` : ''}
        </div>
        <div class="ao-action-panel-btns">
          ${Auth.can('ao_create')
            ? `<button class="btn bp bxs" onclick="PropertyDetailPage.openCreateAO()">${ic('plus',13)} Ny AO</button>`
            : ''}
          ${Auth.can('properties_manage')
            ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openEdit()">${ic('pencil',13)} Redigera</button>`
            : ''}
          ${Auth.can('properties_manage')
            ? `<button class="btn ${p.status==='inaktiv'?'bsu':'bw'} bxs" onclick="PropertyDetailPage.toggleStatus()">${p.status==='inaktiv'?ic('check-circle',13)+' Aktivera':ic('eye-off',13)+' Inaktivera'}</button>`
            : ''}
        </div>
      </div>

      <!-- Fastighetshuvud -->
      <div class="card" style="margin-bottom:8px;">
        <div class="card-body" style="padding:14px;">
          <div style="display:flex;align-items:flex-start;gap:12px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:18px;font-weight:900;color:var(--navy);line-height:1.2;margin-bottom:4px;">${p.name}</div>
              ${addrLine ? `<div style="font-size:12px;color:var(--mt);display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px;">
                <a href="${mapsUrl}" target="_blank" rel="noopener"
                  style="color:inherit;text-decoration:underline;text-underline-offset:2px;text-decoration-color:rgba(0,0,0,.3);">${addrLine}${cityLine ? ', ' + cityLine : ''}</a>
                <a href="${mapsUrl}" target="_blank" rel="noopener"
                  class="btn bs bxs" style="font-size:10px;padding:2px 8px;line-height:1.8;">${ic('navigation',11)} Navigera</a>
              </div>` : ''}
              ${cu ? `<div style="font-size:12px;margin-top:4px;">
                <span style="color:var(--mt);">Ägare: </span>
                <span style="color:var(--sky);cursor:pointer;font-weight:600;"
                  onclick="Router.showPage('pg-crm-detail',{customerId:'${cu.id}'})">${cuName}</span>
              </div>` : ''}
              ${p.group ? `<div style="font-size:12px;color:var(--mt);">Koncern: ${p.group}</div>` : ''}
              ${p.operationalArea ? `<div style="font-size:12px;color:var(--mt);">Driftområde: ${p.operationalArea}</div>` : ''}
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">Öppna AO</div>
              <div style="font-size:28px;font-weight:900;color:${openAos>0?'var(--navy)':'var(--mt)'};">${openAos}</div>
            </div>
          </div>
          ${(p.area||p.boa||p.apartments||p.floors) ? `
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--bg);">
            ${p.area    ? `<div><div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">Total yta</div><div style="font-size:14px;font-weight:800;">${fmt(p.area)} m²</div></div>` : ''}
            ${p.boa     ? `<div><div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">BOA</div><div style="font-size:14px;font-weight:800;">${fmt(p.boa)} m²</div></div>` : ''}
            ${p.loa     ? `<div><div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">LOA</div><div style="font-size:14px;font-weight:800;">${fmt(p.loa)} m²</div></div>` : ''}
            ${p.apartments ? `<div><div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">Lägenheter</div><div style="font-size:14px;font-weight:800;">${p.apartments} st</div></div>` : ''}
            ${p.floors  ? `<div><div style="font-size:9px;color:var(--mt);font-weight:700;text-transform:uppercase;">Våningar</div><div style="font-size:14px;font-weight:800;">${p.floors}</div></div>` : ''}
          </div>` : ''}
        </div>
      </div>

      <!-- Flikar -->
      <div class="ftabs" id="prop-tabs" style="margin-bottom:8px;">
        <button class="ft ${this.activeTab==='overview'  ?'on':''}" onclick="PropertyDetailPage.switchTab('overview')">Översikt</button>
        <button class="ft ${this.activeTab==='contact'   ?'on':''}" onclick="PropertyDetailPage.switchTab('contact')">Kontakt${contacts.length?` (${contacts.length})`:''}</button>
        <button class="ft ${this.activeTab==='tech'      ?'on':''}" onclick="PropertyDetailPage.switchTab('tech')">Teknisk info</button>
        <button class="ft ${this.activeTab==='ao'        ?'on':''}" onclick="PropertyDetailPage.switchTab('ao')">Arbetsorder${aos.length?` (${aos.length})`:''}</button>
        <button class="ft ${this.activeTab==='recurring' ?'on':''}" onclick="PropertyDetailPage.switchTab('recurring')">Återkommande${recs.length?` (${recs.length})`:''}</button>
        <button class="ft ${this.activeTab==='rondering'  ?'on':''}" onclick="PropertyDetailPage.switchTab('rondering')">Rondering</button>
        <button class="ft ${this.activeTab==='images'    ?'on':''}" onclick="PropertyDetailPage.switchTab('images')">Bilder${images.length?` (${images.length})`:''}</button>
        <button class="ft ${this.activeTab==='notes'     ?'on':''}" onclick="PropertyDetailPage.switchTab('notes')">Anteckningar${notes.length?` (${notes.length})`:''}</button>
      </div>

      <div id="prop-tab-overview"   ${this.activeTab!=='overview'   ?'style="display:none"':''}>${this._renderOverview(p, insp)}</div>
      <div id="prop-tab-contact"    ${this.activeTab!=='contact'    ?'style="display:none"':''}>${this._renderContactTab(p, contacts)}</div>
      <div id="prop-tab-tech"       ${this.activeTab!=='tech'       ?'style="display:none"':''}>${this._renderTechTab(tech, insp)}</div>
      <div id="prop-tab-ao"         ${this.activeTab!=='ao'         ?'style="display:none"':''}>${this._renderAOTab(aos)}</div>
      <div id="prop-tab-recurring"  ${this.activeTab!=='recurring'  ?'style="display:none"':''}>${this._renderRecurringTab(recs)}</div>
      <div id="prop-tab-rondering"  ${this.activeTab!=='rondering'  ?'style="display:none"':''}><div id="tab-rondering">${this.activeTab==='rondering'?this._renderRonderingTabContent(p):''}</div></div>
      <div id="prop-tab-images"     ${this.activeTab!=='images'     ?'style="display:none"':''}>${this._renderImagesTab(p, images)}</div>
      <div id="prop-tab-notes"      ${this.activeTab!=='notes'      ?'style="display:none"':''}>${this._renderNotesTab(notes)}</div>
    `;
  },

  switchTab(tab) {
    this.activeTab = tab;
    const tabs = ['overview','contact','tech','ao','recurring','rondering','images','notes'];
    tabs.forEach(t => {
      const el = document.getElementById(`prop-tab-${t}`);
      if (el) el.style.display = t === tab ? '' : 'none';
    });
    document.querySelectorAll('#prop-tabs .ft').forEach((btn, i) => {
      btn.classList.toggle('on', i === tabs.indexOf(tab));
    });
    // Lazy-render rondering tab
    if (tab === 'rondering') {
      const el = document.getElementById('tab-rondering');
      if (el && !el.dataset.loaded) {
        const p = getObj(this.propId);
        if (p) el.innerHTML = this._renderRonderingTabContent(p);
        el.dataset.loaded = '1';
      }
    }
  },

  /* ── Tab: Översikt ─────────────────────────────────────── */

  _renderOverview(p, insp) {
    const staff = state.staff || [];
    const mgrObj = p.propertyManager ? staff.find(s => s.id === p.propertyManager) : null;
    const techObj = p.technician     ? staff.find(s => s.id === p.technician)     : null;
    const mgrName = mgrObj ? `${mgrObj.firstName} ${mgrObj.lastName}`.trim() : (p.propertyManager || '');
    const techName = techObj ? `${techObj.firstName} ${techObj.lastName}`.trim() : (p.technician || '');

    const rows = [
      p.objectNumber     ? ['Objektnummer',        p.objectNumber]                              : null,
      p.group            ? ['Koncern / Grupp',      p.group]                                    : null,
      p.propertyDesignation ? ['Fastighetsbeteckning', p.propertyDesignation]                  : null,
      p.buildYear        ? ['Byggår',               p.buildYear]                                : null,
      p.renovationYear   ? ['Ombyggnadsår',         p.renovationYear]                          : null,
      p.buildingCount>1  ? ['Antal byggnader',      p.buildingCount + ' st']                   : null,
      p.managementType   ? ['Förvaltningsform',     p.managementType]                          : null,
      mgrName            ? ['Ansvarig förvaltare',  mgrName]                                   : null,
      techName           ? ['Ansvarig tekniker',    techName]                                  : null,
      p.operationalArea  ? ['Driftområde',          p.operationalArea]                         : null,
      p.bta              ? ['BTA',                  fmt(p.bta) + ' m²']                        : null,
      p.lotArea          ? ['Tomtarea',             fmt(p.lotArea) + ' m²']                    : null,
    ].filter(Boolean);

    const overdueInsp = Object.entries(insp).filter(([,v]) => v.nextDate && v.nextDate < tdy());
    const inspTypes = { ovk:'OVK', sba:'SBA', hiss:'Hissbesiktning', el:'Elbesiktning', pbe:'PBE-kontroll' };

    return `
      ${overdueInsp.length > 0 ? `
      <div class="card" style="border-left:3px solid var(--rd);">
        <div class="card-header"><h3>${ic('alert-triangle',14)} Försenade besiktningar</h3></div>
        <div class="card-body">
          ${overdueInsp.map(([k,v]) =>
            `<div class="dr"><span class="dk">${inspTypes[k]||k}</span>
             <span class="dv" style="color:var(--rd);">Försenad sedan ${fmtDate(v.nextDate)}</span></div>`
          ).join('')}
          <button class="btn bs bsm" style="margin-top:8px;" onclick="PropertyDetailPage.switchTab('tech');PropertyDetailPage.openEditInsp()">Uppdatera besiktningar</button>
        </div>
      </div>` : ''}

      <div class="card">
        <div class="card-header">
          <h3>${ic('info',14)} Grundinformation</h3>
          ${Auth.can('properties_manage')
            ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openEdit()">${ic('pencil',13)}</button>`
            : ''}
        </div>
        <div class="card-body">
          ${rows.length === 0
            ? `<p style="font-size:12px;color:var(--mt);">Ingen utökad information registrerad.
               ${Auth.can('properties_manage') ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openEdit()">Redigera</button>` : ''}</p>`
            : rows.map(([k,v]) =>
                `<div class="dr"><span class="dk">${k}</span><span class="dv">${v}</span></div>`
              ).join('')}
        </div>
      </div>

      ${p.note ? `<div class="nbox">${ic('eye',12)} ${p.note}</div>` : ''}
    `;
  },

  /* ── Tab: Kontakt & åtkomst ────────────────────────────── */

  _renderContactTab(p, contacts) {
    return `
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

      <div class="card">
        <div class="card-header">
          <h3>${ic('key',14)} Åtkomst & nycklar</h3>
          ${Auth.can('properties_manage')
            ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openEdit()">${ic('pencil',13)}</button>`
            : ''}
        </div>
        <div class="card-body">
          ${p.accessCode
            ? `<div class="dr"><span class="dk">Portkod</span>
               <span class="dv" style="font-family:monospace;font-weight:700;font-size:15px;">${p.accessCode}</span></div>`
            : ''}
          ${p.keyInfo
            ? `<div class="dr"><span class="dk">Nyckelinformation</span><span class="dv">${p.keyInfo}</span></div>`
            : ''}
          ${!p.accessCode && !p.keyInfo
            ? `<p style="font-size:12px;color:var(--mt);">Ingen åtkomstinformation registrerad.</p>`
            : ''}
        </div>
      </div>
    `;
  },

  _renderContacts(contacts) {
    if (!contacts.length) {
      return `<p style="font-size:12px;color:var(--mt);padding:4px 0;">Inga kontaktpersoner registrerade</p>`;
    }
    return contacts.map((c, i) => `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid var(--bg);">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;">${c.name||'—'}</div>
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

  /* ── Tab: Teknisk information ──────────────────────────── */

  _renderTechTab(tech, insp) {
    const systems = [
      { key:'heating',     icon:'thermometer',   label:'Värme' },
      { key:'ventilation', icon:'wind',          label:'Ventilation' },
      { key:'electricity', icon:'zap',           label:'El' },
      { key:'water',       icon:'droplets',      label:'Vatten & avlopp' },
      { key:'sba',         icon:'shield-check',  label:'SBA / Brand' },
      { key:'waste',       icon:'trash-2',       label:'Avfall & miljö' },
      { key:'other',       icon:'settings',      label:'Övrigt' },
    ];
    const inspTypes = { ovk:'OVK',sba:'SBA',hiss:'Hissbesiktning',el:'Elbesiktning',pbe:'PBE-kontroll' };

    return `
      ${systems.map(sys => {
        const t = tech[sys.key] || {};
        const hasData = Object.values(t).some(Boolean);
        return `
        <div class="card">
          <div class="card-header" style="cursor:pointer;"
            onclick="var b=this.nextElementSibling;b.style.display=b.style.display==='none'?'':'none'">
            <h3>${ic(sys.icon,14)} ${sys.label}</h3>
            <div style="display:flex;align-items:center;gap:6px;">
              ${hasData
                ? `<span class="bdg bdg-green" style="font-size:9px;">Ifylld</span>`
                : `<span class="bdg bdg-grey" style="font-size:9px;">Tom</span>`}
              ${ic('chevron-down',14)}
            </div>
          </div>
          <div style="display:none;">
            <div class="card-body">
              ${this._renderTechSystem(sys.key, t)}
              ${Auth.can('properties_manage')
                ? `<button class="btn bs bsm" style="margin-top:8px;"
                     onclick="event.stopPropagation();PropertyDetailPage.openEditTechSystem('${sys.key}')">
                     ${ic('pencil',13)} Redigera ${sys.label}</button>`
                : ''}
            </div>
          </div>
        </div>`;
      }).join('')}

      <div class="card">
        <div class="card-header">
          <h3>${ic('clipboard-check',14)} Besiktningar & lagstadgade krav</h3>
          ${Auth.can('properties_manage')
            ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openEditInsp()">${ic('pencil',13)}</button>`
            : ''}
        </div>
        <div class="card-body" id="prop-insp-body">
          ${this._renderInspections(insp)}
        </div>
      </div>
    `;
  },

  _renderTechSystem(key, t) {
    const fieldLabels = {
      heating:     { type:'Systemtyp',manufacturer:'Fabrikat',model:'Modell',location:'Placering',serviceInterval:'Serviceintervall',lastService:'Senaste service',comment:'Kommentar' },
      ventilation: { type:'Systemtyp',manufacturer:'Fabrikat/Aggregat',location:'Placering',filterType:'Filtertyp',lastFilterChange:'Senaste filterbyte',comment:'Kommentar' },
      electricity: { mainPanel:'Elcentral',location:'Placering',meter:'Elmätare/anl-ID',comment:'Kommentar' },
      water:       { shutoffLocation:'Huvudavstängning',description:'Systembeskrivning',pump:'Pump/Sump',comment:'Kommentar' },
      sba:         { alarmSystem:'Brandlarmsystem',lastControl:'Senaste SBA-kontroll',nextControl:'Nästa SBA-kontroll',comment:'Kommentar' },
      waste:       { location:'Miljörum placering',fractions:'Fraktioner',supplier:'Leverantör',access:'Åtkomst',comment:'Kommentar' },
      other:       { description:'Beskrivning' },
    };
    const labels = fieldLabels[key] || {};
    const entries = Object.entries(t).filter(([,v]) => v);
    if (!entries.length) return `<p style="font-size:12px;color:var(--mt);">Ingen information registrerad</p>`;
    return entries.map(([k,v]) =>
      `<div class="dr"><span class="dk">${labels[k]||cap(k)}</span><span class="dv" style="white-space:pre-wrap;">${v}</span></div>`
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
    const entries = Object.entries(insp).filter(([,v]) => v);
    if (!entries.length) return `<p style="font-size:12px;color:var(--mt);">Inga besiktningar registrerade</p>`;
    return entries.map(([k,v]) => {
      const isOverdue = v.nextDate && v.nextDate < tdy();
      return `
        <div style="padding:8px 0;border-bottom:1px solid var(--bg);">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
            <span style="font-size:12px;font-weight:700;">${types[k]||k.toUpperCase()}</span>
            ${v.status==='godkänd'
              ? `<span class="bdg bdg-green">Godkänd</span>`
              : isOverdue
                ? `<span class="bdg bdg-red">Försenad</span>`
                : v.status ? `<span class="bdg bdg-grey">${v.status}</span>` : ''}
          </div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;">
            ${v.lastDate ? `<span style="font-size:11px;color:var(--mt);">Senast: ${fmtDate(v.lastDate)}</span>` : ''}
            ${v.nextDate ? `<span style="font-size:11px;color:${isOverdue?'var(--rd)':'var(--mt)'};">Nästa: ${fmtDate(v.nextDate)}</span>` : ''}
          </div>
        </div>`;
    }).join('');
  },

  /* ── Tab: Arbetsorder ──────────────────────────────────── */

  _renderAOTab(aos) {
    return `
      <div class="card">
        <div class="card-header">
          <h3>${ic('clipboard-list',14)} Arbetsorder</h3>
          <span class="bdg bdg-blue">${aos.length}</span>
          ${Auth.can('ao_create')
            ? `<button class="btn bp bxs" onclick="PropertyDetailPage.openCreateAO()" style="margin-left:4px;">${ic('plus',13)} Ny AO</button>`
            : ''}
        </div>
        <div class="card-body">
          ${aos.length === 0
            ? `<div class="empty" style="padding:16px 0;">${ic('clipboard-list',28)}<p style="font-size:12px;color:var(--mt);">Inga arbetsorder kopplade till denna fastighet</p></div>`
            : aos.map(ao => `
              <div class="crow" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
                <div style="flex:1;min-width:0;">
                  <div class="crow-title"><span style="font-size:10px;font-weight:700;color:var(--mt);margin-right:4px;">${ao.id}</span>${ao.title}</div>
                  <div class="crow-sub">${fmtDate(ao.scheduledDate||ao.createdAt)}</div>
                </div>
                <div style="display:flex;gap:4px;flex-shrink:0;">${sbdg(ao.status)}${pbdg(ao.priority)}</div>
              </div>`).join('')}
        </div>
      </div>
    `;
  },

  /* ── Tab: Återkommande ─────────────────────────────────── */

  _renderRecurringTab(recs) {
    return `
      <div class="card">
        <div class="card-header">
          <h3>${ic('repeat',14)} Återkommande ärenden</h3>
          <span class="bdg bdg-${recs.length>0?'blue':'grey'}">${recs.length}</span>
        </div>
        <div class="card-body">
          ${recs.length === 0
            ? `<p style="font-size:12px;color:var(--mt);padding:4px 0;">Inga återkommande ärenden kopplade till denna fastighet</p>`
            : recs.map(r => `
              <div class="crow" onclick="Router.showPage('pg-recurring')">
                <div style="flex:1;min-width:0;">
                  <div class="crow-title">${r.title}</div>
                  <div class="crow-sub">${r.frequencyLabel||r.frequency||''}</div>
                </div>
                <span class="bdg bdg-${r.active!==false?'green':'grey'}" style="font-size:9px;">${r.active!==false?'Aktiv':'Pausad'}</span>
              </div>`).join('')}
        </div>
      </div>
    `;
  },

  /* ── Tab: Bilder ───────────────────────────────────────── */

  _renderImagesTab(p, images) {
    return `
      <div class="card">
        <div class="card-header">
          <h3>${ic('image',14)} Bilder</h3>
          ${Auth.can('properties_manage')
            ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openAddImage()">${ic('plus',13)}</button>`
            : ''}
        </div>
        <div class="card-body">
          ${images.length === 0 ? `
            <div style="text-align:center;padding:24px 0;">
              ${ic('image',28)}
              <p style="font-size:12px;color:var(--mt);margin:8px 0 4px;">Lägg till bilder på fastigheten</p>
              <p style="font-size:11px;color:var(--mt);margin-bottom:12px;">
                Bilder på entré, teknikrum, undercentral, garage m.m. hjälper personalen att hitta rätt.
              </p>
              ${Auth.can('properties_manage')
                ? `<button class="btn bs bsm" onclick="PropertyDetailPage.openAddImage()">${ic('plus',13)} Lägg till bild</button>`
                : ''}
            </div>` :
            `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;">
              ${images.map((img, i) => `
                <div style="border-radius:8px;overflow:hidden;border:1px solid var(--br);cursor:pointer;"
                  onclick="PropertyDetailPage.viewImage(${i})">
                  <img src="${img.dataUrl||''}" alt="${img.title||''}"
                    style="width:100%;height:90px;object-fit:cover;display:block;">
                  <div style="padding:5px 7px;font-size:10px;font-weight:700;color:var(--navy);
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${img.title||'Bild'}</div>
                  ${img.category ? `<div style="padding:0 7px 5px;font-size:9px;color:var(--mt);">${img.category}</div>` : ''}
                </div>`).join('')}
            </div>`}
        </div>
      </div>
      <div class="ibox" style="font-size:11px;color:var(--mt);text-align:center;">
        ${ic('info',12)} Bilder lagras lokalt. Riktig filuppladdning aktiveras i Fas 4 (backend).
      </div>
    `;
  },

  /* ── Tab: Rondering ───────────────────────────────────── */

  _renderRonderingTabContent(p) {
    const ronderingar = (state.ronderingar||[]).filter(function(r) {
      return r.propertyId === p.id || r.customerId === p.customerId;
    }).sort(function(a,b) { return new Date(b.createdAt)-new Date(a.createdAt); }).slice(0,10);
    const avvikelser = (state.avvikelser||[]).filter(function(a) { return a.propertyId === p.id; });

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-weight:700;font-size:14px;">Ronderingar</div>
        <button class="btn bp bsm" onclick="RonderingPage.openNewRonderingFromProperty('${p.customerId}','${p.id}')">Ny rondering</button>
      </div>
      ${ronderingar.length === 0
        ? `<div class="ibox">Inga ronderingar kopplade till denna fastighet ännu.</div>`
        : ronderingar.map(function(r) {
            const statusCls = {planerad:'bdg-blue',pågående:'bdg-orange',slutförd:'bdg-green',har_avvikelser:'bdg-red'}[r.status]||'bdg-grey';
            const statusLbl = {planerad:'Planerad',pågående:'Pågående',slutförd:'Slutförd',har_avvikelser:'Har avvikelser'}[r.status]||r.status;
            const page = (r.status==='slutförd'||r.status==='har_avvikelser') ? 'pg-rondering-rapport' : 'pg-rondering-utfor';
            return `
              <div class="list-item" onclick="Router.showPage('${page}',{ronderingId:'${r.id}'})">
                <div class="item-row">
                  <div>
                    <div class="item-title">${r.templateName}</div>
                    <div class="item-sub">${fmtDate(r.scheduledDate||r.createdAt)} · ${r.performedByName||'—'}</div>
                  </div>
                  <span class="bdg ${statusCls}">${statusLbl}</span>
                </div>
              </div>`;
          }).join('')
      }
      ${avvikelser.filter(function(a){return a.status==='öppen';}).length > 0 ? `
        <div style="margin-top:16px;font-weight:700;font-size:14px;margin-bottom:8px;">Öppna avvikelser (${avvikelser.filter(function(a){return a.status==='öppen';}).length})</div>
        ${avvikelser.filter(function(a){return a.status==='öppen';}).map(function(avv){ return `
          <div class="list-item">
            <div class="item-row">
              <div>
                <div class="item-title">${avv.title}</div>
                <div class="item-sub">${avv.categoryName} · ${fmtDate(avv.createdAt)}</div>
              </div>
              ${pbdg(avv.priority)}
            </div>
          </div>`;}).join('')}` : ''}`;
  },

  /* ── Tab: Anteckningar ─────────────────────────────────── */

  _renderNotesTab(notes) {
    return `
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
    `;
  },

  _renderNotes(notes) {
    if (!notes.length) return `<p style="font-size:12px;color:var(--mt);padding:4px 0;">Inga anteckningar</p>`;
    return [...notes].reverse().map(n => `
      <div style="padding:8px 0;border-bottom:1px solid var(--bg);">
        <div style="font-size:12px;line-height:1.5;color:var(--tx);white-space:pre-wrap;">${n.text}</div>
        <div style="font-size:10px;color:var(--mt);margin-top:4px;">${n.createdBy||'Okänd'} · ${relDate(n.createdAt)}</div>
      </div>`).join('');
  },

  /* ── Redigera fastighet (fullständigt formulär) ─────────── */

  _editFormData: null,

  openEdit() {
    const p = getObj(this.propId);
    if (!p) return;
    this._openEditModal(p, null);
  },

  _openEditModal(p, prefill) {
    const data = prefill || p;
    Modal.open({
      title: p ? `Redigera: ${p.name}` : 'Redigera fastighet',
      wide: true,
      body: this._formHtml(data),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._saveBasic() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('prop-name')?.focus(), 80);
  },

  _formHtml(p) {
    const v = (k, d='') => p ? (p[k] != null ? p[k] : d) : d;
    const types = ['Flerbostadshus','Kontorsfastighet','Industrifastighet','BRF','Villa','Butiksfastighet','Lager','Övrigt'];
    const mgmtTypes = ['Teknisk förvaltning','Ekonomisk förvaltning','Full förvaltning','Egen förvaltning','Tillsynsavtal'];
    const activeStaff = (state.staff||[]).filter(s => s.active!==false);
    const staffOpts = id => activeStaff.map(s =>
      `<option value="${s.id}" ${v(id)===s.id?'selected':''}>${s.firstName} ${s.lastName}</option>`
    ).join('');

    return `
      <div style="font-size:11px;font-weight:800;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Grundinformation</div>
      <div class="fg"><label>Namn / beteckning <span style="color:var(--rd)">*</span></label>
        <input id="prop-name" value="${v('name')}" placeholder="T.ex. BRF Solgläntan, Storgatan 1…"></div>
      <div class="g2">
        <div class="fg"><label>Objektnummer</label>
          <input id="prop-objnum" value="${v('objectNumber')}" placeholder="T.ex. OBJ-001"></div>
        <div class="fg"><label>Typ</label>
          <select id="prop-type">
            <option value="">— Välj typ —</option>
            ${types.map(t=>`<option ${v('type')===t?'selected':''}>${t}</option>`).join('')}
          </select></div>
      </div>
      <div class="fg"><label>Koncern / fastighetsgrupp</label>
        <input id="prop-group" value="${v('group')}" placeholder="T.ex. Wallenstam, privat..."></div>

      <div style="font-size:11px;font-weight:800;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px;">Kund / ägare</div>
      <div style="display:flex;gap:6px;align-items:flex-end;">
        <div class="fg" style="flex:1;margin-bottom:0;"><label>Kund / ägare</label>
          <select id="prop-cu">
            <option value="">— Välj kund —</option>
            ${(state.customers||[]).map(c=>
              `<option value="${c.id}" ${v('customerId')===c.id?'selected':''}>${CustomerService.displayName(c)}</option>`
            ).join('')}
          </select></div>
        <button class="btn bs bsm" style="flex-shrink:0;white-space:nowrap;"
          onclick="PropertyDetailPage._createCustomerFromForm()">${ic('plus',13)} Ny kund</button>
      </div>

      <div style="font-size:11px;font-weight:800;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px;">Adress</div>
      <div class="fg"><label>Gatuadress</label>
        <input id="prop-addr" value="${v('address')}" placeholder="Storgatan 1"></div>
      <div class="g2">
        <div class="fg"><label>Postnummer</label><input id="prop-zip" value="${v('zip')}" placeholder="123 45"></div>
        <div class="fg"><label>Stad</label><input id="prop-city" value="${v('city')}" placeholder="Stockholm"></div>
      </div>
      <div class="fg"><label>Fastighetsbeteckning</label>
        <input id="prop-desig" value="${v('propertyDesignation')}" placeholder="T.ex. Stockholm Haga 1:234"></div>

      <div style="font-size:11px;font-weight:800;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px;">Nyckeltal & ytor</div>
      <div class="g2">
        <div class="fg"><label>Byggår</label>
          <input id="prop-year" value="${v('buildYear')}" placeholder="T.ex. 1985"></div>
        <div class="fg"><label>Ombyggnadsår</label>
          <input id="prop-renyear" value="${v('renovationYear')}" placeholder="T.ex. 2005"></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Antal byggnader</label>
          <input type="number" id="prop-buildcount" value="${v('buildingCount',1)}" min="1"></div>
        <div class="fg"><label>Antal våningar</label>
          <input type="number" id="prop-floors" value="${v('floors','')}"></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Antal lägenheter/lokaler</label>
          <input type="number" id="prop-apts" value="${v('apartments',0)}" min="0"></div>
        <div class="fg"><label>Total yta (m²)</label>
          <input type="number" id="prop-area" value="${v('area',0)||0}" min="0" placeholder="0"></div>
      </div>
      <div class="g2">
        <div class="fg"><label>BOA (m²)</label>
          <input type="number" id="prop-boa" value="${v('boa',0)||0}" min="0" placeholder="0"></div>
        <div class="fg"><label>LOA (m²)</label>
          <input type="number" id="prop-loa" value="${v('loa',0)||0}" min="0" placeholder="0"></div>
      </div>
      <div class="g2">
        <div class="fg"><label>BTA (m²)</label>
          <input type="number" id="prop-bta" value="${v('bta',0)||0}" min="0" placeholder="0"></div>
        <div class="fg"><label>Tomtarea (m²)</label>
          <input type="number" id="prop-lotarea" value="${v('lotArea',0)||0}" min="0" placeholder="0"></div>
      </div>

      <div style="font-size:11px;font-weight:800;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px;">Förvaltning</div>
      <div class="fg"><label>Förvaltningsform</label>
        <select id="prop-mgmttype">
          <option value="">— Välj —</option>
          ${mgmtTypes.map(t=>`<option ${v('managementType')===t?'selected':''}>${t}</option>`).join('')}
        </select></div>
      <div class="g2">
        <div class="fg"><label>Ansvarig förvaltare</label>
          <select id="prop-mgr">
            <option value="">— Välj —</option>
            ${staffOpts('propertyManager')}
          </select></div>
        <div class="fg"><label>Ansvarig tekniker</label>
          <select id="prop-tech">
            <option value="">— Välj —</option>
            ${staffOpts('technician')}
          </select></div>
      </div>
      <div class="fg"><label>Driftområde</label>
        <input id="prop-oparea" value="${v('operationalArea')}" placeholder="T.ex. Södermalm, Norra..."></div>

      <div style="font-size:11px;font-weight:800;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px;">Åtkomst & status</div>
      <div class="g2">
        <div class="fg"><label>Portkod</label>
          <input id="prop-access" value="${v('accessCode')}" placeholder="T.ex. 1234#"></div>
        <div class="fg"><label>Status</label>
          <select id="prop-status">
            <option value="aktiv"   ${v('status','aktiv')==='aktiv'   ?'selected':''}>Aktiv</option>
            <option value="inaktiv" ${v('status')==='inaktiv'?'selected':''}>Inaktiv</option>
          </select></div>
      </div>
      <div class="fg"><label>Nyckelinformation / passagesystem</label>
        <input id="prop-keyinfo" value="${v('keyInfo')}" placeholder="T.ex. Nyckelskåp 9876, Aptus-tagg..."></div>
      <div class="fg"><label>Intern anteckning</label>
        <textarea id="prop-note" rows="2" placeholder="Visas internt…">${v('note')}</textarea></div>
    `;
  },

  _captureFormState() {
    return {
      name:              document.getElementById('prop-name')?.value.trim()     || '',
      objectNumber:      document.getElementById('prop-objnum')?.value.trim()   || '',
      type:              document.getElementById('prop-type')?.value            || '',
      group:             document.getElementById('prop-group')?.value.trim()    || '',
      customerId:        document.getElementById('prop-cu')?.value              || '',
      address:           document.getElementById('prop-addr')?.value.trim()     || '',
      zip:               document.getElementById('prop-zip')?.value.trim()      || '',
      city:              document.getElementById('prop-city')?.value.trim()      || '',
      propertyDesignation: document.getElementById('prop-desig')?.value.trim() || '',
      buildYear:         document.getElementById('prop-year')?.value            || '',
      renovationYear:    document.getElementById('prop-renyear')?.value         || '',
      buildingCount:     parseInt(document.getElementById('prop-buildcount')?.value) || 1,
      floors:            parseInt(document.getElementById('prop-floors')?.value)     || 0,
      apartments:        parseInt(document.getElementById('prop-apts')?.value)       || 0,
      area:              parseFloat(document.getElementById('prop-area')?.value)     || 0,
      boa:               parseFloat(document.getElementById('prop-boa')?.value)      || 0,
      loa:               parseFloat(document.getElementById('prop-loa')?.value)      || 0,
      bta:               parseFloat(document.getElementById('prop-bta')?.value)      || 0,
      lotArea:           parseFloat(document.getElementById('prop-lotarea')?.value)  || 0,
      managementType:    document.getElementById('prop-mgmttype')?.value        || '',
      propertyManager:   document.getElementById('prop-mgr')?.value             || '',
      technician:        document.getElementById('prop-tech')?.value            || '',
      operationalArea:   document.getElementById('prop-oparea')?.value.trim()   || '',
      accessCode:        document.getElementById('prop-access')?.value.trim()   || '',
      status:            document.getElementById('prop-status')?.value          || 'aktiv',
      keyInfo:           document.getElementById('prop-keyinfo')?.value.trim()  || '',
      note:              document.getElementById('prop-note')?.value.trim()     || '',
    };
  },

  _createCustomerFromForm() {
    this._editFormData = this._captureFormState();
    Modal.close();
    CustomersPage.openCreate((newCu) => {
      const p = getObj(this.propId);
      const prefill = Object.assign({}, p||{}, this._editFormData, { customerId: newCu.id });
      this._editFormData = null;
      this._openEditModal(p, prefill);
    });
  },

  _saveBasic() {
    const data = this._captureFormState();
    if (!data.name) { showToast('Namn krävs'); return; }
    const idx = (state.properties||[]).findIndex(x => x.id === this.propId);
    if (idx < 0) return;
    state.properties[idx] = Object.assign({}, state.properties[idx], data, { updatedAt: new Date().toISOString() });
    persist();
    Modal.close();
    showToast('Fastighet uppdaterad');
    this.render({ propId: this.propId });
  },

  /* ── Ny AO från fastighetskort ─────────────────────────── */

  openCreateAO() {
    const p = getObj(this.propId);
    if (!p) return;
    Router.showPage('pg-ao');
    setTimeout(() => WorkOrdersPage.openCreate(p.customerId||null, p.id), 100);
  },

  /* ── Kontaktpersoner ───────────────────────────────────── */

  openAddContact(idx = null) {
    const p = getObj(this.propId);
    if (!p) return;
    const c = idx !== null ? (p.contacts||[])[idx] : null;
    Modal.open({
      title: c ? 'Redigera kontaktperson' : 'Lägg till kontaktperson',
      body: `
        <div class="g2">
          <div class="fg"><label>Namn <span style="color:var(--rd)">*</span></label>
            <input id="pc-name" value="${c?c.name||'':''}" placeholder="Förnamn Efternamn"></div>
          <div class="fg"><label>Roll</label>
            <input id="pc-role" value="${c?c.role||'':''}" placeholder="T.ex. BRF-ordförande…"></div>
        </div>
        <div class="g2">
          <div class="fg"><label>Telefon</label>
            <input id="pc-phone" type="tel" value="${c?c.phone||'':''}" placeholder="070-XXX XX XX"></div>
          <div class="fg"><label>E-post</label>
            <input id="pc-email" type="email" value="${c?c.email||'':''}" placeholder="namn@exempel.se"></div>
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
      role:  document.getElementById('pc-role')?.value.trim()  || '',
      phone: document.getElementById('pc-phone')?.value.trim() || '',
      email: document.getElementById('pc-email')?.value.trim() || ''
    };
    if (idx !== null) prop.contacts[idx] = contact;
    else prop.contacts.push(contact);
    persist();
    Modal.close();
    const el = document.getElementById('prop-contacts');
    if (el) el.innerHTML = this._renderContacts(prop.contacts);
    showToast(idx !== null ? 'Kontaktperson uppdaterad' : 'Kontaktperson tillagd');
  },

  removeContact(idx) {
    const prop = getObj(this.propId);
    if (!prop || !prop.contacts) return;
    prop.contacts.splice(idx, 1);
    persist();
    const el = document.getElementById('prop-contacts');
    if (el) el.innerHTML = this._renderContacts(prop.contacts);
    showToast('Kontaktperson borttagen');
  },

  /* ── Teknisk info per system ───────────────────────────── */

  _techSystemConfig() {
    return {
      heating: {
        label: 'Värme',
        fields: [
          { id:'type',            label:'Systemtyp',         ph:'T.ex. Fjärrvärme, Bergvärme, Olja…' },
          { id:'manufacturer',    label:'Fabrikat',          ph:'T.ex. Nibe, Danfoss…' },
          { id:'model',           label:'Modell',            ph:'T.ex. F1245' },
          { id:'location',        label:'Placering',         ph:'T.ex. Källare plan -1, rum 002' },
          { id:'serviceInterval', label:'Serviceintervall',  ph:'T.ex. Varje år, Vartannat år…' },
          { id:'lastService',     label:'Senaste service',   ph:'T.ex. 2024-03-15' },
          { id:'comment',         label:'Kommentar',         ph:'Övrigt att notera…', textarea:true },
        ]
      },
      ventilation: {
        label: 'Ventilation',
        fields: [
          { id:'type',            label:'Systemtyp',         ph:'T.ex. FTX, CAV, F, FX…' },
          { id:'manufacturer',    label:'Fabrikat/Aggregat', ph:'T.ex. Systemair, Swegon…' },
          { id:'location',        label:'Placering',         ph:'T.ex. Vindsplan, Takmonterat…' },
          { id:'filterType',      label:'Filtertyp',         ph:'T.ex. G4+F7, M5…' },
          { id:'lastFilterChange',label:'Senaste filterbyte',ph:'T.ex. 2024-01-10' },
          { id:'comment',         label:'Kommentar',         ph:'Övrigt…', textarea:true },
        ]
      },
      electricity: {
        label: 'El',
        fields: [
          { id:'mainPanel', label:'Elcentral',              ph:'T.ex. Hager 3-fas 400V' },
          { id:'location',  label:'Placering',              ph:'T.ex. Källarplan, elrum' },
          { id:'meter',     label:'Elmätare / anl-ID',      ph:'T.ex. 735999012345' },
          { id:'comment',   label:'Kommentar',              ph:'Övrigt…', textarea:true },
        ]
      },
      water: {
        label: 'Vatten & avlopp',
        fields: [
          { id:'shutoffLocation', label:'Huvudavstängning', ph:'T.ex. Källare, vid entré' },
          { id:'description',     label:'Systembeskrivning',ph:'T.ex. Plaströr 2005…' },
          { id:'pump',            label:'Pump/Sump',        ph:'T.ex. Grundfos, saknas' },
          { id:'comment',         label:'Kommentar',        ph:'Övrigt…', textarea:true },
        ]
      },
      sba: {
        label: 'SBA / Brand',
        fields: [
          { id:'alarmSystem',  label:'Brandlarmsystem',     ph:'T.ex. Autronica, Bosch BA9000…' },
          { id:'lastControl',  label:'Senaste SBA-kontroll',ph:'T.ex. 2024-02-01' },
          { id:'nextControl',  label:'Nästa SBA-kontroll',  ph:'T.ex. 2025-02-01' },
          { id:'comment',      label:'Kommentar',           ph:'Sprinkler, rökluckor, m.m.', textarea:true },
        ]
      },
      waste: {
        label: 'Avfall & miljö',
        fields: [
          { id:'location',  label:'Miljörum placering',     ph:'T.ex. Baksida, port C' },
          { id:'fractions', label:'Fraktioner',             ph:'T.ex. Restavfall, mat, papper, glas' },
          { id:'supplier',  label:'Leverantör',             ph:'T.ex. Ragnsells, Suez…' },
          { id:'access',    label:'Åtkomst/kod',            ph:'T.ex. Tagg, kod 1234' },
          { id:'comment',   label:'Kommentar',              ph:'Övrigt…', textarea:true },
        ]
      },
      other: {
        label: 'Övrigt',
        fields: [
          { id:'description', label:'Övrig teknisk information', ph:'Hiss, garage, utemiljö, m.m.', textarea:true },
        ]
      },
    };
  },

  openEditTechSystem(key) {
    const p = getObj(this.propId);
    if (!p) return;
    const t = (p.technicalSystems||{})[key] || {};
    const cfgs = this._techSystemConfig();
    const cfg = cfgs[key] || cfgs.other;
    Modal.open({
      title: cfg.label,
      wide: true,
      body: cfg.fields.map(f =>
        f.textarea
          ? `<div class="fg"><label>${f.label}</label>
               <textarea id="tech-${f.id}" rows="3" placeholder="${f.ph}">${t[f.id]||''}</textarea></div>`
          : `<div class="fg"><label>${f.label}</label>
               <input id="tech-${f.id}" value="${t[f.id]||''}" placeholder="${f.ph}"></div>`
      ).join(''),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._saveTechSystem(key, cfg.fields) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _saveTechSystem(key, fields) {
    const prop = getObj(this.propId);
    if (!prop) return;
    if (!prop.technicalSystems) prop.technicalSystems = {};
    const t = {};
    fields.forEach(f => {
      const val = document.getElementById(`tech-${f.id}`)?.value.trim();
      if (val) t[f.id] = val;
    });
    prop.technicalSystems[key] = t;
    persist();
    Modal.close();
    showToast('Teknisk info sparad');
    const tabEl = document.getElementById('prop-tab-tech');
    if (tabEl) tabEl.innerHTML = this._renderTechTab(prop.technicalSystems, prop.inspections||{});
  },

  /* ── Besiktningar ──────────────────────────────────────── */

  openEditInsp() {
    const p = getObj(this.propId);
    if (!p) return;
    const insp = p.inspections || {};
    const types = [
      { key:'ovk',  label:'OVK (Obligatorisk Ventilationskontroll)' },
      { key:'sba',  label:'SBA (Systematiskt Brandskyddsarbete)' },
      { key:'hiss', label:'Hissbesiktning' },
      { key:'el',   label:'Elbesiktning' },
      { key:'pbe',  label:'PBE-kontroll' }
    ];
    Modal.open({
      title: 'Besiktningar & lagstadgade krav',
      wide: true,
      body: types.map(t => {
        const iv = insp[t.key] || {};
        return `
          <div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--bg);">
            <div style="font-size:12px;font-weight:700;color:var(--navy);margin-bottom:6px;">${t.label}</div>
            <div class="g2">
              <div class="fg"><label>Senaste datum</label>
                <input type="date" id="insp-${t.key}-last" value="${iv.lastDate||''}"></div>
              <div class="fg"><label>Nästa datum</label>
                <input type="date" id="insp-${t.key}-next" value="${iv.nextDate||''}"></div>
            </div>
            <div class="fg"><label>Status</label>
              <select id="insp-${t.key}-status">
                <option value="">— Välj —</option>
                ${['godkänd','försenad','ej utförd','planerad'].map(s=>
                  `<option ${iv.status===s?'selected':''}>${s}</option>`
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
      if (last||next||status) insp[t.key] = { lastDate:last||'', nextDate:next||'', status:status||'' };
    });
    prop.inspections = insp;
    persist();
    Modal.close();
    showToast('Besiktningar sparade');
    const techTab = document.getElementById('prop-tab-tech');
    if (techTab) techTab.innerHTML = this._renderTechTab(prop.technicalSystems||{}, insp);
    const overviewTab = document.getElementById('prop-tab-overview');
    if (overviewTab) overviewTab.innerHTML = this._renderOverview(prop, insp);
  },

  /* ── Bilder ────────────────────────────────────────────── */

  openAddImage() {
    Modal.open({
      title: 'Lägg till bild',
      body: `
        <div class="fg"><label>Rubrik <span style="color:var(--rd)">*</span></label>
          <input id="img-title" placeholder="T.ex. Undercentral, Entré port A…"></div>
        <div class="g2">
          <div class="fg"><label>Kategori</label>
            <select id="img-cat">
              <option value="">— Valfritt —</option>
              ${['Fasad','Entré','Teknikrum','Garage','Gård','Övrigt'].map(c=>`<option>${c}</option>`).join('')}
            </select></div>
          <div class="fg"><label>Kopplat till system</label>
            <select id="img-section">
              <option value="">— Valfritt —</option>
              ${['Värme','Ventilation','El','Vatten','SBA/Brand','Avfall','Övrigt'].map(s=>`<option>${s}</option>`).join('')}
            </select></div>
        </div>
        <div class="fg"><label>Beskrivning</label>
          <textarea id="img-desc" rows="2" placeholder="Kort beskrivning…"></textarea></div>
        <div class="fg"><label>Bild (välj fil) <span style="color:var(--rd)">*</span></label>
          <input type="file" id="img-file" accept="image/*"
            onchange="PropertyDetailPage._previewImage(this)"></div>
        <div id="img-preview" style="margin-top:8px;"></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._saveImage() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('img-title')?.focus(), 80);
  },

  _previewImage(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const prev = document.getElementById('img-preview');
      if (prev) prev.innerHTML =
        `<img src="${e.target.result}" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:contain;">`;
    };
    reader.readAsDataURL(file);
  },

  _saveImage() {
    const title = document.getElementById('img-title')?.value.trim();
    if (!title) { showToast('Rubrik krävs'); return; }
    const file = document.getElementById('img-file')?.files[0];
    if (!file) { showToast('Välj en bild'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const prop = getObj(this.propId);
      if (!prop) return;
      if (!prop.images) prop.images = [];
      prop.images.push({
        id:          'IMG' + Date.now(),
        title,
        category:    document.getElementById('img-cat')?.value    || '',
        techSection: document.getElementById('img-section')?.value|| '',
        description: document.getElementById('img-desc')?.value.trim() || '',
        dataUrl:     e.target.result,
        createdAt:   new Date().toISOString()
      });
      persist();
      Modal.close();
      showToast('Bild sparad');
      const tabEl = document.getElementById('prop-tab-images');
      if (tabEl) tabEl.innerHTML = this._renderImagesTab(prop, prop.images);
    };
    reader.readAsDataURL(file);
  },

  viewImage(idx) {
    const prop = getObj(this.propId);
    const img = (prop?.images||[])[idx];
    if (!img) return;
    Modal.open({
      title: img.title || 'Bild',
      body: `
        <div style="text-align:center;">
          <img src="${img.dataUrl}" alt="${img.title}"
            style="max-width:100%;max-height:60vh;border-radius:8px;object-fit:contain;">
          ${img.description ? `<p style="font-size:13px;margin-top:8px;">${img.description}</p>` : ''}
          ${img.techSection ? `<div style="font-size:11px;color:var(--mt);">System: ${img.techSection}</div>` : ''}
          ${img.category    ? `<div style="font-size:11px;color:var(--mt);">Kategori: ${img.category}</div>` : ''}
        </div>`,
      buttons: [
        { label: `${ic('trash',13)} Ta bort`, cls:'btn bd', onClick: () => this._removeImage(idx) },
        { label: 'Stäng', cls:'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _removeImage(idx) {
    const prop = getObj(this.propId);
    if (!prop || !prop.images) return;
    prop.images.splice(idx, 1);
    persist();
    Modal.close();
    showToast('Bild borttagen');
    const tabEl = document.getElementById('prop-tab-images');
    if (tabEl) tabEl.innerHTML = this._renderImagesTab(prop, prop.images);
  },

  /* ── Anteckningar ──────────────────────────────────────── */

  openAddNote() {
    Modal.open({
      title: 'Ny anteckning',
      body: `<div class="fg"><label>Anteckning</label>
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
        ? `${state.currentUser.firstName||''} ${state.currentUser.lastName||''}`.trim()
        : 'Okänd'
    });
    persist();
    Modal.close();
    const el = document.getElementById('prop-notes');
    if (el) el.innerHTML = this._renderNotes(prop.notes);
    showToast('Anteckning sparad');
  },

  toggleStatus() {
    const p = getObj(this.propId);
    if (!p) return;
    const activate = p.status === 'inaktiv';
    Modal.confirm(activate ? 'Aktivera fastigheten?' : 'Inaktivera fastigheten? Den döljs från aktiva listor men historisk data bevaras.', () => {
      p.status = activate ? 'aktiv' : 'inaktiv';
      p.updatedAt = new Date().toISOString();
      persist();
      const el = document.getElementById('pg-obj-detail-content');
      if (el) this._renderFull(el, p);
      showToast(activate ? 'Fastighet aktiverad' : 'Fastighet inaktiverad');
    });
  }
};
