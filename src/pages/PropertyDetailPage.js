/**
 * PropertyDetailPage — Fullständigt fastighetskort (Fas 3, Modul 1 v12)
 * Tabs: Översikt | Kontakt | Teknisk info | Serviceintervall | Arbetsorder | Återkommande | Objekt | Bilder | Anteckningar
 * v12: ServiceIntervalService-integration — bevakning, historik, markera utförd
 * v18: Objekt-flik (lägenheter, lokaler) — Leverans C
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

  /* V3 2026-11-26 — flikgrupper. Elva smala flikar blev åtta grupper så
     att allt får plats och syns (F-06). Varje grupp visar en eller flera
     paneler (#prop-tab-<panel>); switchTab() tar både gruppnyckel och de
     äldre panelnycklarna ('ansvariga', 'recurring', 'notes'). */
  _TAB_GROUPS: [
    { key: 'overview',  label: 'Översikt',              panels: ['overview'] },
    { key: 'contact',   label: 'Kontakter & åtkomst',   short: 'Kontakter', panels: ['contact', 'ansvariga'] },
    { key: 'tech',      label: 'Teknik & besiktning',   short: 'Teknik',    panels: ['tech'] },
    { key: 'service',   label: 'Service',               panels: ['service'] },
    { key: 'ao',        label: 'Arbetsorder',           panels: ['ao', 'recurring'] },
    { key: 'rondering', label: 'Rondering',             panels: ['rondering'] },
    { key: 'objects',   label: 'Objekt',                panels: ['objects'] },
    { key: 'images',    label: 'Bilder & anteckningar', panels: ['images', 'notes'] }
  ],

  _groupOf(tab) {
    const g = this._TAB_GROUPS.find(x => x.key === tab || x.panels.includes(tab));
    return g ? g.key : 'overview';
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
    const siList  = p.serviceIntervals || [];
    const objList = (typeof PropertyObjectService !== 'undefined') ? PropertyObjectService.getByProperty(p.id) : [];
    const ansv    = (typeof PropertyContactService !== 'undefined') ? PropertyContactService.getForProperty(p.id) : [];
    const overdueInsp = Object.values(insp).filter(v => v && v.nextDate && v.nextDate < tdy()).length;
    const overdueServices = (typeof ServiceIntervalService !== 'undefined')
      ? siList.filter(si => ServiceIntervalService.getStatus(si) === 'overdue').length : 0;
    const approachingServices = (typeof ServiceIntervalService !== 'undefined')
      ? siList.filter(si => ['due_soon','approaching'].includes(ServiceIntervalService.getStatus(si))).length : 0;
    const addrLine = p.address || '';
    const cityLine = [p.zip, p.city].filter(Boolean).join(' ');
    const fullAddr = [addrLine, cityLine].filter(Boolean).join(', ');
    const mapsUrl  = fullAddr ? `https://maps.google.com/?q=${encodeURIComponent(fullAddr)}` : '';
    const canManage = Auth.can('customer_manage');
    const group = this._groupOf(this.activeTab);

    /* ── Huvud: tillbaka, namn, nummer/typ, status, primär åtgärd ── */
    const badges = [
      p.status !== 'inaktiv' ? `<span class="bdg st bdg-green"><span class="st-dot"></span>Aktiv</span>` : `<span class="bdg st bdg-grey"><span class="st-dot"></span>Inaktiv</span>`,
      overdueInsp > 0 ? `<button type="button" class="bdg bdg-red mx-bdg-btn" onclick="PropertyDetailPage.switchTab('tech')">${ic('alert-triangle',11)} ${overdueInsp} ${overdueInsp === 1 ? 'försenad besiktning' : 'försenade besiktningar'}</button>` : '',
      overdueServices > 0 ? `<button type="button" class="bdg bdg-red mx-bdg-btn" onclick="PropertyDetailPage.switchTab('service')">${ic('wrench',11)} ${overdueServices} service förfallen</button>` : '',
      approachingServices > 0 && overdueServices === 0 ? `<button type="button" class="bdg bdg-orange mx-bdg-btn" onclick="PropertyDetailPage.switchTab('service')">${ic('wrench',11)} ${approachingServices} service snart</button>` : ''
    ].join('');
    const sub = [
      `<span class="mx-dh-no">${esc(displayNumberOf(p))}</span>`,
      p.objectNumber ? `<span>${esc(p.objectNumber)}</span>` : '',
      p.type ? `<span>${esc(p.type)}</span>` : ''
    ].filter(Boolean).join('<span class="mx-sep">·</span>');
    const head = MxUi.detailHead({
      back: 'Router.back()',
      title: esc(p.name || displayNumberOf(p) || 'Fastighet'),
      sub, badges,
      primary: Auth.can('ao_create') ? { label: 'Ny AO', icon: 'plus', onclick: 'PropertyDetailPage.openCreateAO()' } : null,
      menuId: 'prop-head-menu',
      actions: [
        canManage ? { label: 'Redigera', icon: 'pencil', onclick: 'PropertyDetailPage.openEdit()', inline: true } : null,
        Auth.canViewPage('pg-activities') ? { label: 'Ny uppgift', icon: 'check-square', onclick: `ActivitiesPage.openCreate({customerId:'${esc(p.customerId||'')}',propertyId:'${esc(p.id)}'})`, inline: true } : null,
        canManage ? { label: 'Kopiera fastighet', icon: 'copy', onclick: 'PropertyDetailPage.openCopyProperty()' } : null,
        canManage ? (p.status === 'inaktiv'
          ? { label: 'Aktivera fastigheten', icon: 'check-circle', onclick: 'PropertyDetailPage.toggleStatus()' }
          : { label: 'Inaktivera fastigheten', icon: 'eye-off', onclick: 'PropertyDetailPage.toggleStatus()', destructive: true }) : null
      ].filter(Boolean)
    });

    /* ── Fakta: adress, ägare och nyckeltal — en gång, inte tre ── */
    /* extra=true: visas inte på mobil (finns redan i Grundinformation/flikraden) */
    const fig = (label, value, onclick, extra) => value === '' || value == null ? '' :
      `<div class="mx-pf-fig${extra ? ' mx-pf-x' : ''}"><dt class="mx-pf-l">${label}</dt><dd class="mx-pf-v">${onclick ? `<button type="button" class="mx-pf-figbtn" onclick="${onclick}" aria-label="${label}: visa">${value}</button>` : value}</dd></div>`;
    const figs = [
      fig('Öppna AO', `<b class="${openAos > 0 ? 'is-on' : ''}">${openAos}</b>`, `PropertyDetailPage.switchTab('ao')`),
      p.area ? fig('Total yta', `${fmt(p.area)} m²`) : '',
      p.boa ? fig('BOA', `${fmt(p.boa)} m²`) : '',
      p.loa ? fig('LOA', `${fmt(p.loa)} m²`) : '',
      p.apartments ? fig('Lägenheter', `${esc(String(p.apartments))} st`) : '',
      p.floors ? fig('Våningar', esc(String(p.floors))) : '',
      p.buildYear ? fig('Byggår', esc(String(p.buildYear)), null, true) : '',
      objList.length ? fig('Objekt', String(objList.length), `PropertyDetailPage.switchTab('objects')`, true) : ''
    ].join('');
    const factsHtml = `
      <section class="mx-pf" aria-label="Fastighetsfakta">
        <div class="mx-pf-who">
          ${fullAddr ? `<div class="mx-pf-line">${ic('map-pin',14)}<a href="${esc(mapsUrl)}" target="_blank" rel="noopener" class="mx-pf-addr">${esc(fullAddr)}</a>
            <a href="${esc(mapsUrl)}" target="_blank" rel="noopener" class="btn bs bxs mx-pf-nav">${ic('navigation',12)} Navigera</a></div>` : `<div class="mx-pf-line mx-pf-muted">${ic('map-pin',14)} Ingen adress registrerad</div>`}
          ${cu ? `<div class="mx-pf-line">${ic('building-2',14)}<span class="mx-pf-muted">Ägare</span><a class="mx-dh-link" onclick="Router.showPage('pg-crm-detail',{customerId:'${esc(cu.id)}'})">${esc(cuName)}</a></div>` : ''}
          ${p.group ? `<div class="mx-pf-line mx-pf-muted">${ic('layers',14)} Koncern: ${esc(p.group)}</div>` : ''}
          ${p.operationalArea ? `<div class="mx-pf-line mx-pf-muted">${ic('map-pin',14)} Driftområde: ${esc(p.operationalArea)}</div>` : ''}
        </div>
        <dl class="mx-pf-figs">${figs}</dl>
      </section>`;

    /* ── Flikar: alla grupper syns (radbryts vid behov), tydlig aktiv flik ── */
    const tabCount = {
      contact: contacts.length + ansv.length,
      service: siList.length,
      ao: aos.length,
      objects: objList.length
    };
    const tabsHtml = `
      <div class="ftabs mx-ptabs" id="prop-tabs" role="tablist" aria-label="Fastighetskortets delar">
        ${this._TAB_GROUPS.map(g => {
          const n = tabCount[g.key];
          const alert = (g.key === 'service' && overdueServices > 0) || (g.key === 'tech' && overdueInsp > 0);
          return `<button class="ft ${group === g.key ? 'on' : ''}" role="tab" data-tab="${g.key}" aria-selected="${group === g.key ? 'true' : 'false'}" onclick="PropertyDetailPage.switchTab('${g.key}')">${g.short ? `<span class="mx-tl">${esc(g.label)}</span><span class="mx-ts">${esc(g.short)}</span>` : esc(g.label)}${n ? `<span class="ft-n">${n}</span>` : ''}${alert ? `<span class="si-tab-alert" title="Kräver åtgärd">!</span>` : ''}</button>`;
        }).join('')}
      </div>`;

    const shown = (panel) => this._groupOf(panel) === group ? '' : 'style="display:none"';
    const panelsHtml = `
      <div class="mx-ppanels" data-group="${group}">
        <div id="prop-tab-overview"  class="mx-ppanel" ${shown('overview')}>${this._renderOverview(p, insp, siList)}</div>
        <div class="mx-pgrid mx-pgrid-contact">
          <div id="prop-tab-contact"   class="mx-ppanel" ${shown('contact')}>${this._renderContactTab(p, contacts)}</div>
          <div id="prop-tab-ansvariga" class="mx-ppanel" ${shown('ansvariga')}>${this._renderAnsvarigaTab(p)}</div>
        </div>
        <div id="prop-tab-tech"      class="mx-ppanel" ${shown('tech')}>${this._renderTechTab(tech, insp)}</div>
        <div id="prop-tab-service"   class="mx-ppanel" ${shown('service')}>${this._renderServiceTab(p)}</div>
        <div id="prop-tab-ao"        class="mx-ppanel" ${shown('ao')}>${this._renderAOTab(aos)}</div>
        <div id="prop-tab-recurring" class="mx-ppanel" ${shown('recurring')}>${this._renderRecurringTab(recs)}</div>
        <div id="prop-tab-rondering" class="mx-ppanel" ${shown('rondering')}><div id="tab-rondering">${group==='rondering'?this._renderRonderingTabContent(p):''}</div></div>
        <div id="prop-tab-objects"   class="mx-ppanel" ${shown('objects')}>${this._renderObjectsTab(p)}</div>
        <div class="mx-pgrid mx-pgrid-media">
          <div id="prop-tab-images"  class="mx-ppanel" ${shown('images')}>${this._renderImagesTab(p)}</div>
          <div id="prop-tab-notes"   class="mx-ppanel" ${shown('notes')}>${this._renderNotesTab(notes)}</div>
        </div>
      </div>`;

    el.innerHTML = `<div class="mx-prop">${head}${factsHtml}${tabsHtml}${panelsHtml}</div>`;
    if (group === 'rondering') { const r = document.getElementById('tab-rondering'); if (r) r.dataset.loaded = '1'; }
    /* Auto-load images if images tab is active */
    if (group === 'images') this._loadImages(p.id);
    /* Ladda känsliga fält om contact-fliken är aktiv och användaren har behörighet */
    if (group === 'contact' && Auth.can('objects_sensitive')) {
      this._loadSensitiveProperty(p.id);
    }
  },

  async _loadSensitiveProperty(propertyId) {
    const el = document.getElementById('sensitive-prop-' + propertyId);
    if (!el) return;
    try {
      const jwt = Auth.getAccessToken();
      const res = await fetch(SUPABASE_URL + '/functions/v1/get-sensitive-fields', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId })
      });
      if (!res.ok) { el.innerHTML = '<p style="font-size:12px;color:var(--mt);">Ingen åtkomstinformation registrerad.</p>'; return; }
      const d = await res.json();
      if (!d.accessCode && !d.keyInformation) {
        el.innerHTML = '<p style="font-size:12px;color:var(--mt);">Ingen åtkomstinformation registrerad.</p>'; return;
      }
      el.innerHTML =
        (d.accessCode ? '<div class="dr"><span class="dk">Portkod</span><span class="dv" style="font-family:monospace;font-weight:700;font-size:15px;">' + esc(d.accessCode) + '</span></div>' : '') +
        (d.keyInformation ? '<div class="dr"><span class="dk">Nyckelinformation</span><span class="dv">' + esc(d.keyInformation) + '</span></div>' : '');
    } catch(e) { el.innerHTML = '<p style="font-size:12px;color:var(--mt);">Kunde inte ladda åtkomstuppgifter.</p>'; }
  },

  switchTab(tab) {
    this.activeTab = tab;
    const group = this._groupOf(tab);
    const panels = (this._TAB_GROUPS.find(g => g.key === group) || { panels: ['overview'] }).panels;
    const all = ['overview','contact','ansvariga','tech','service','ao','recurring','rondering','objects','images','notes'];
    all.forEach(t => {
      const el = document.getElementById(`prop-tab-${t}`);
      if (el) el.style.display = panels.includes(t) ? '' : 'none';
    });
    document.querySelectorAll('#prop-tabs .ft').forEach(btn => {
      const on = btn.dataset.tab === group;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const wrap = document.querySelector('#pg-obj-detail .mx-ppanels');
    if (wrap) wrap.dataset.group = group;
    // Lazy-render rondering tab
    if (group === 'rondering') {
      const el = document.getElementById('tab-rondering');
      if (el && !el.dataset.loaded) {
        const p = getObj(this.propId);
        if (p) el.innerHTML = this._renderRonderingTabContent(p);
        el.dataset.loaded = '1';
      }
    }
    // Load images from Supabase when switching to images tab
    if (group === 'images') {
      this._loadImages(this.propId);
    }
    // Ladda känsliga fält när contact-fliken aktiveras
    if (group === 'contact' && Auth.can('objects_sensitive')) {
      this._loadSensitiveProperty(this.propId);
    }
    // Underpanel (t.ex. 'ansvariga' eller 'notes'): visa den direkt på smal skärm.
    if (tab !== group && window.matchMedia && window.matchMedia('(max-width: 1023px)').matches) {
      const sub = document.getElementById(`prop-tab-${tab}`);
      if (sub && sub.scrollIntoView) sub.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  },

  /* ── Tab: Översikt ─────────────────────────────────────── */

  /* V3 2026-11-26: Översikten samlar det viktigaste från varje del —
     varningar först, sedan grundinformation, öppna arbetsorder, ansvariga
     och kontakter samt service/besiktningar — med länk till fliken med
     alla detaljer. Ingen ny data; samma källor som flikarna. */
  _renderOverview(p, insp, siList) {
    siList = siList || p.serviceIntervals || [];
    const staff = state.staff || [];
    const mgrObj = p.propertyManager ? staff.find(s => s.id === p.propertyManager) : null;
    const techObj = p.technician     ? staff.find(s => s.id === p.technician)     : null;
    const mgrName = mgrObj ? `${mgrObj.firstName} ${mgrObj.lastName}`.trim() : (p.propertyManager || '');
    const techName = techObj ? `${techObj.firstName} ${techObj.lastName}`.trim() : (p.technician || '');
    const canManage = Auth.can('customer_manage');

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

    const overdueInsp = Object.entries(insp).filter(([,v]) => v && v.nextDate && v.nextDate < tdy());
    const inspTypes = { ovk:'OVK', sba:'SBA', hiss:'Hissbesiktning', el:'Elbesiktning', pbe:'PBE-kontroll' };

    // Service interval alerts for overview
    const SIS = typeof ServiceIntervalService !== 'undefined' ? ServiceIntervalService : null;
    const alertSIs = SIS ? siList.filter(si => {
      const st = SIS.getStatus(si);
      return st === 'overdue' || st === 'due_soon' || st === 'approaching';
    }).sort((a,b) => (SIS.daysUntil(a.nextDue)||999) - (SIS.daysUntil(b.nextDue)||999)) : [];

    const more = (label, tab) => `<button type="button" class="btn bghost bxs mx-more" onclick="PropertyDetailPage.switchTab('${tab}')">${label} ${ic('arrow-right',12)}</button>`;

    /* Öppna arbetsorder (högst fyra, närmast planerade först) */
    const openAos = (state.workOrders || [])
      .filter(a => a.propertyId === p.id && !a.deleted && !['klar','fakturerad','avbruten'].includes(a.status))
      .sort((a,b) => (a.scheduledDate || '9999').localeCompare(b.scheduledDate || '9999'));
    const aoRows = openAos.slice(0, 4).map(ao => `
      <button type="button" class="mx-ov-row" onclick="Router.showPage('pg-ao-detail',{aoId:'${esc(ao.id)}'})">
        <span class="mx-ov-main"><span class="mx-ov-t">${esc(ao.title || ao.id)}</span>
          <span class="mx-ov-s">${esc(ao.id)}${ao.scheduledDate ? ' · ' + esc(fmtDate(ao.scheduledDate)) : ''}</span></span>
        ${sbdg(ao.status)}
      </button>`).join('');

    /* Ansvariga och kontaktpersoner (sammanfattning) */
    const ansv = (typeof PropertyContactService !== 'undefined') ? PropertyContactService.getForProperty(p.id) : [];
    const contacts = p.contacts || [];
    const people = ansv.slice(0, 4).map(c => `
      <div class="mx-ov-person"><span class="mx-ov-pn">${esc(c.personNameSnapshot || '—')}</span><span class="mx-ov-pr">${esc(c.roleNameSnapshot || 'Ansvarig')}${c.isPrimary ? ' · Primär' : ''}</span></div>`).join('') +
      contacts.slice(0, Math.max(0, 4 - Math.min(ansv.length, 4))).map(c => `
      <div class="mx-ov-person"><span class="mx-ov-pn">${esc(c.name || '—')}</span><span class="mx-ov-pr">${esc(c.role || 'Kontaktperson')}${c.phone ? ` · <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ''}</span></div>`).join('');

    /* Service och besiktningar: de närmaste */
    const nextSIs = SIS ? siList.filter(si => si.active !== false && si.nextDue)
      .sort((a,b) => (a.nextDue || '').localeCompare(b.nextDue || '')).slice(0, 3) : [];
    const nextInsp = Object.entries(insp).filter(([,v]) => v && v.nextDate)
      .sort((a,b) => a[1].nextDate.localeCompare(b[1].nextDate)).slice(0, 3);
    const svcRows = nextSIs.map(si => `
      <div class="mx-ov-kv"><span>${esc(si.title)}<small>${esc(fmtDate(si.nextDue))}</small></span>${SIS.statusBadge(si)}</div>`).join('') +
      nextInsp.map(([k,v]) => {
        const late = v.nextDate < tdy();
        return `<div class="mx-ov-kv"><span>${esc(inspTypes[k] || k.toUpperCase())}<small>${late ? 'Försenad sedan ' : 'Nästa: '}${esc(fmtDate(v.nextDate))}</small></span>${late ? '<span class="bdg bdg-red">Försenad</span>' : (v.status === 'godkänd' ? '<span class="bdg bdg-green">Godkänd</span>' : '')}</div>`;
      }).join('');

    return `
      ${overdueInsp.length > 0 ? `
      <div class="card mx-ov-alert">
        <div class="card-header"><h3>${ic('alert-triangle',14)} Försenade besiktningar</h3></div>
        <div class="card-body kv">
          ${overdueInsp.map(([k,v]) =>
            `<div class="dr"><span class="dk">${esc(inspTypes[k]||k)}</span>
             <span class="dv mx-late">Försenad sedan ${esc(fmtDate(v.nextDate))}</span></div>`
          ).join('')}
          ${canManage ? `<button class="btn bs bsm" style="margin-top:8px;align-self:flex-start;" onclick="PropertyDetailPage.switchTab('tech');PropertyDetailPage.openEditInsp()">Uppdatera besiktningar</button>` : ''}
        </div>
      </div>` : ''}

      ${alertSIs.length > 0 ? `
      <div class="card mx-ov-alert">
        <div class="card-header"><h3>${ic('wrench',14)} Serviceintervall kräver åtgärd</h3></div>
        <div class="card-body">
          ${alertSIs.map(si => `
            <div class="dr" style="align-items:center;">
              <span class="dk">${esc(si.title)}</span>
              <span class="dv">${SIS.statusBadge(si)}</span>
            </div>`).join('')}
          <button class="btn bs bsm" style="margin-top:8px;" onclick="PropertyDetailPage.switchTab('service')">Visa serviceintervall</button>
        </div>
      </div>` : ''}

      <div class="mx-ov-grid">
        <div class="card">
          <div class="card-header">
            <h3>${ic('info',14)} Grundinformation</h3>
            ${canManage
              ? `<button class="btn bghost bxs" aria-label="Redigera grundinformation" title="Redigera" onclick="PropertyDetailPage.openEdit()">${ic('pencil',13)}</button>`
              : ''}
          </div>
          <div class="card-body kv">
            ${rows.length === 0
              ? `<p class="mx-muted">Ingen utökad information registrerad.
                 ${canManage ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openEdit()">Redigera</button>` : ''}</p>`
              : rows.map(([k,v]) =>
                  `<div class="dr"><span class="dk">${k}</span><span class="dv">${esc(v)}</span></div>`
                ).join('')}
            ${p.note ? `<div class="nbox mx-ov-note">${ic('eye',12)} ${esc(p.note)}</div>` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>${ic('clipboard-list',14)} Öppna arbetsorder <span class="ft-n">${openAos.length}</span></h3>
            ${more('Alla', 'ao')}
          </div>
          <div class="card-body mx-ov-list">
            ${aoRows || `<p class="mx-muted">Inga öppna arbetsorder.</p>`}
            ${openAos.length > 4 ? `<p class="mx-muted">+ ${openAos.length - 4} till</p>` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>${ic('user-check',14)} Ansvariga och kontakter</h3>
            ${more('Alla', 'contact')}
          </div>
          <div class="card-body mx-ov-list">
            ${people || `<p class="mx-muted">Inga ansvariga eller kontaktpersoner registrerade.</p>`}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>${ic('calendar-check',14)} Service och besiktningar</h3>
            ${more('Alla', 'service')}
          </div>
          <div class="card-body mx-ov-list">
            ${svcRows || `<p class="mx-muted">Inga planerade serviceintervall eller besiktningar.</p>`}
          </div>
        </div>
      </div>
    `;
  },

  /* ── Tab: Serviceintervall ─────────────────────────────── */

  /* ── Objekt-flik ─────────────────────────────────────────── */

  _objFilter: { type: '', status: '', search: '' },

  _objFApply(f) {
    Object.assign(this._objFilter, f);
    const p = this.propId ? getObj(this.propId) : null;
    if (p) {
      const el = document.getElementById('prop-tab-objects');
      if (el) { el.innerHTML = this._renderObjectsTab(p); this._refocus('prop-obj-search', f); }
    }
  },

  /* Sökfältet ritas om vid varje tangent — behåll fokus och markör så att
     man kan skriva vidare (tidigare tappades fokus efter första tecknet). */
  _refocus(id, f) {
    if (!f || f.search === undefined) return;
    const inp = document.getElementById(id);
    if (!inp) return;
    inp.focus();
    try { const n = inp.value.length; inp.setSelectionRange(n, n); } catch (e) {}
  },

  _renderObjectsTab(p) {
    const POS = typeof PropertyObjectService !== 'undefined' ? PropertyObjectService : null;
    if (!POS) return '<div class="empty"><h3>PropertyObjectService saknas</h3></div>';
    const canManage = Auth.can('customer_manage');
    const f = this._objFilter;

    const objects = POS.search(p.id, { query: f.search, type: f.type, status: f.status });
    const all     = POS.getByProperty(p.id);

    const typeOptions = [{ key: '', label: 'Alla typer' }, ...(typeof PROPERTY_OBJECT_TYPES !== 'undefined' ? PROPERTY_OBJECT_TYPES : [])];
    const statusOptions = [{ key: '', label: 'Alla statusar' }, ...(typeof PROPERTY_OBJECT_STATUSES !== 'undefined' ? PROPERTY_OBJECT_STATUSES : [])];

    const filterBar = `
      <div class="si-filter-bar" style="margin-bottom:10px;">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;flex:1;">
          <select class="fi" style="font-size:12px;padding:5px 8px;height:32px;" onchange="PropertyDetailPage._objFApply({type:this.value})">
            ${typeOptions.map(t => `<option value="${t.key}" ${f.type===t.key?'selected':''}>${esc(t.label)}</option>`).join('')}
          </select>
          <select class="fi" style="font-size:12px;padding:5px 8px;height:32px;" onchange="PropertyDetailPage._objFApply({status:this.value})">
            ${statusOptions.map(s => `<option value="${s.key}" ${f.status===s.key?'selected':''}>${esc(s.label)}</option>`).join('')}
          </select>
          <label class="mx-isearch">${ic('search',13)}<span class="sr-only">Sök objekt</span>
            <input type="search" class="fi" id="prop-obj-search" placeholder="Sök objekt…" value="${esc(f.search||'')}"
              oninput="PropertyDetailPage._objFApply({search:this.value})"></label>
        </div>
        ${canManage ? `<button class="btn bp bxs" onclick="PropertyDetailPage.openAddObject('${p.id}')">${ic('plus',13)} Lägg till objekt</button>` : ''}
      </div>`;

    const itemsHtml = objects.length === 0
      ? `<div class="empty" style="padding:24px 0;">
           ${ic('layers',28)}
           <p style="font-size:12px;color:var(--mt);margin-top:6px;">${all.length === 0 ? 'Inga objekt tillagda ännu.' : 'Inga objekt matchar filtret.'}</p>
           ${all.length === 0 && canManage ? `<button class="btn bp bsm" onclick="PropertyDetailPage.openAddObject('${p.id}')">${ic('plus',13)} Lägg till objekt</button>` : ''}
         </div>`
      : objects.map(obj => {
          const typeLbl   = POS.typeLabel(obj.type);
          const statusLbl = POS.statusLabel(obj.status);
          const badgeCls  = POS.statusBadgeClass(obj.status);
          const openAO    = (state.workOrders || []).filter(a => a.objectId === obj.id && !a.deleted && !a.archived && !['klar','fakturerad','avbruten'].includes(a.status)).length;
          return `
            <div class="obj-card" onclick="Router.showPage('pg-propobj-detail',{objId:'${obj.id}'})">
              <div class="obj-card-header">
                <div class="obj-card-num">${esc(obj.objectNumber || '—')}</div>
                <div class="obj-card-info">
                  <div class="obj-card-name">${esc(obj.name || typeLbl)}</div>
                  <div class="obj-card-meta">
                    <span>${typeLbl}</span>
                    ${obj.floor ? `<span>Vån ${esc(obj.floor)}</span>` : ''}
                    ${obj.entrance ? `<span>${esc(obj.entrance)}</span>` : ''}
                    ${obj.area ? `<span>${fmt(obj.area)} m²</span>` : ''}
                  </div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                  <span class="bdg ${badgeCls}" style="font-size:10px;">${statusLbl}</span>
                  ${openAO > 0 ? `<span class="bdg bdg-orange" style="font-size:10px;">${openAO} AO</span>` : ''}
                </div>
              </div>
              ${obj.description ? `
              <div class="obj-card-desc">${esc(obj.description)}</div>` : ''}
              <div class="obj-card-actions" onclick="event.stopPropagation()">
                <button class="btn bghost bsm" onclick="Router.showPage('pg-propobj-detail',{objId:'${obj.id}'})">${ic('eye',13)} Visa</button>
                ${canManage ? `<button class="btn bghost bsm" onclick="PropertyDetailPage.openEditObject('${obj.id}')">${ic('pencil',13)} Redigera</button>` : ''}
                ${canManage ? `<button class="btn bd bsm" onclick="PropertyDetailPage.deleteObject('${obj.id}')">${ic('trash-2',13)}</button>` : ''}
              </div>
            </div>`;
        }).join('');

    return `
      <div class="card">
        <div class="card-header">
          <h3>${ic('layers',14)} Objekt <span class="ft-n">${all.length}</span></h3>
          ${canManage ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openAddObject('${p.id}')">${ic('plus',13)} Lägg till objekt</button>` : ''}
        </div>
        <div class="card-body" style="padding-top:8px;">
          ${all.length > 0 ? filterBar : ''}
          <div id="obj-list-body">${itemsHtml}</div>
        </div>
      </div>`;
  },

  openAddObject(propId) {
    const p = getObj(propId);
    if (!p) return;
    const typeOptions = (typeof PROPERTY_OBJECT_TYPES !== 'undefined' ? PROPERTY_OBJECT_TYPES : [])
      .map(t => `<option value="${t.key}">${esc(t.label)}</option>`).join('');
    const statusOptions = (typeof PROPERTY_OBJECT_STATUSES !== 'undefined' ? PROPERTY_OBJECT_STATUSES : [])
      .map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join('');
    /* QA FIX-ROUND 2026-11-12 (I1, confirmed): `openModal()`/`closeModal()`
       are not defined anywhere in the codebase — "Lägg till objekt" threw a
       ReferenceError and no property object could ever be created. Now uses
       the app's one modal system, Modal.open({title, body, buttons}); the
       form fields, their ids and the save handler are unchanged. */
    Modal.open({
      title: `${ic('plus',14)} Nytt objekt — ${esc(p.name)}`,
      body: `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label class="fl">Typ *</label>
            <select id="new-obj-type" class="fi" style="width:100%;">${typeOptions}</select>
          </div>
          <div style="flex:1;">
            <label class="fl">Objektnummer</label>
            <input type="text" id="new-obj-num" class="fi" style="width:100%;" placeholder="t.ex. 1101">
          </div>
        </div>
        <div>
          <label class="fl">Namn / benämning</label>
          <input type="text" id="new-obj-name" class="fi" style="width:100%;" placeholder="t.ex. Lägenhet 1101">
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label class="fl">Entré / port</label>
            <input type="text" id="new-obj-entrance" class="fi" style="width:100%;">
          </div>
          <div style="flex:1;">
            <label class="fl">Trapphus</label>
            <input type="text" id="new-obj-stairwell" class="fi" style="width:100%;">
          </div>
          <div style="flex:1;">
            <label class="fl">Våning</label>
            <input type="text" id="new-obj-floor" class="fi" style="width:100%;">
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label class="fl">Yta (m²)</label>
            <input type="number" id="new-obj-area" class="fi" style="width:100%;" min="0">
          </div>
          <div style="flex:1;">
            <label class="fl">Status</label>
            <select id="new-obj-status" class="fi" style="width:100%;">${statusOptions}</select>
          </div>
        </div>
        <div>
          <label class="fl">Beskrivning</label>
          <textarea id="new-obj-desc" class="fi" rows="2" style="width:100%;resize:vertical;"></textarea>
        </div>
        <div>
          <label class="fl">Tillträdesinformation / portkod</label>
          <input type="text" id="new-obj-access" class="fi" style="width:100%;">
        </div>
      </div>
    `,
      buttons: [
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() },
        { label: 'Spara objekt', cls: 'btn bp', onClick: () => PropertyDetailPage._saveAddObject(propId) }
      ]
    });
  },

  async _saveAddObject(propId) {
    const type        = document.getElementById('new-obj-type')?.value || 'lagenhet';
    const objectNumber= (document.getElementById('new-obj-num')?.value || '').trim();
    const name        = (document.getElementById('new-obj-name')?.value || '').trim();
    const entrance    = (document.getElementById('new-obj-entrance')?.value || '').trim();
    const stairwell   = (document.getElementById('new-obj-stairwell')?.value || '').trim();
    const floor       = (document.getElementById('new-obj-floor')?.value || '').trim();
    const area        = parseFloat(document.getElementById('new-obj-area')?.value || '0') || 0;
    const status      = document.getElementById('new-obj-status')?.value || 'aktiv';
    const description = (document.getElementById('new-obj-desc')?.value || '').trim();
    const accessInformation = (document.getElementById('new-obj-access')?.value || '').trim();
    try {
      const newObj = PropertyObjectService.create({ propertyId: propId, type, objectNumber, name, entrance, stairwell, floor, area, status, description });
      const refresh = () => {
        const p = getObj(propId);
        const el = p && document.getElementById('prop-tab-objects');
        if (el) el.innerHTML = this._renderObjectsTab(p);
      };
      Modal.close(); // I1: closeModal() does not exist
      refresh();
      // Routa känsliga fält via EF om angivet
      if (accessInformation && newObj && newObj.id) {
        /* I5 (client, 2026-11-12): success only after a real 2xx {ok:true}.
           The object itself is already created, so on failure the add
           form is NOT reopened (a second "Spara objekt" would create a
           duplicate object); instead a retry dialog holds what was typed. */
        const body = { objectId: newObj.id, propertyId: propId, accessInformation };
        const r = await this._saveSensitiveFields(body);
        if (!r.ok) {
          this._openSensitiveRetry('Objektet sparades — tillträdesinformationen gjorde det INTE', r, body,
            [{ key: 'accessInformation', label: 'Tillträdesinformation / portkod' }]);
          return;
        }
      }
      showToast('Objekt sparat');
    } catch(e) {
      showToast(e.message || 'Kunde inte spara objekt', 'error');
    }
  },

  /* ── I5 (client half, blocker round 2026-11-12) ────────────────────────
     set-sensitive-fields was called fire-and-forget (`.catch(()=>{})`)
     and the UI said "sparat" whatever came back — live it answers 500 and
     the door code / key info was silently lost. Now: success only after
     HTTP 2xx with {ok:true}; anything else returns {ok:false} with the
     real status, and the caller keeps what the user typed in a retry
     dialog. The request itself (URL, headers, body) is unchanged — the
     server-side 500 is NOT fixed here (EF work, see the server package). */
  async _saveSensitiveFields(body) {
    const jwt = (typeof Auth !== 'undefined' && Auth.getAccessToken) ? Auth.getAccessToken() : null;
    if (!jwt) return { ok: false, status: 0, error: 'inte inloggad' };
    let res;
    try {
      res = await fetch(SUPABASE_URL + '/functions/v1/set-sensitive-fields', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (e) {
      return { ok: false, status: 0, error: 'nätverksfel' };
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.ok && data && data.ok === true) return { ok: true, status: res.status };
    return { ok: false, status: res.status, error: (data && data.error) || ('HTTP ' + res.status) };
  },

  _sensitiveFailText(r) {
    const why = (r.status ? 'HTTP ' + r.status : r.error || 'okänt fel') +
      (r.status && r.error && r.error !== 'HTTP ' + r.status ? ': ' + r.error : '');
    /* A 4xx is a definite "not saved". A 5xx/network error is not proof
       either way (the EF may fail after its write, e.g. in its audit
       insert), so it is reported as NOT CONFIRMED; a retry is safe (the
       EF does a partial update with the same values). */
    if (r.status >= 400 && r.status < 500) return 'Uppgifterna sparades INTE på servern (' + why + ').';
    return 'Servern bekräftade INTE att uppgifterna sparades (' + why + ') — räkna med att de inte är sparade och försök igen.';
  },

  /* Retry dialog: the typed values stay editable; "Försök igen" resends,
     "Stäng utan att spara" is an explicit choice. Values are put into the
     inputs via .value (never HTML) and are never logged. */
  _openSensitiveRetry(title, r, body, fields) {
    showToast(title + ' — ' + this._sensitiveFailText(r), 8000);
    const inputs = fields.map(f => `<div class="fg"><label>${esc(f.label)}</label><input type="text" id="sens-retry-${f.key}" class="fi" style="width:100%;" autocomplete="off"></div>`).join('');
    Modal.open({
      title: `${ic('alert-triangle',14)} ${esc(title)}`,
      body: `<p style="font-size:13px;line-height:1.5;color:var(--rd);" id="sens-retry-msg">${esc(this._sensitiveFailText(r))}</p>
        <p style="font-size:13px;line-height:1.5;">Det du skrev finns kvar nedan. Försök igen, eller stäng (då sparas det inte).</p>${inputs}`,
      buttons: [
        { label: 'Försök igen', cls: 'btn bp', onClick: async (ev) => {
          const btn = ev && ev.currentTarget;
          if (btn) { btn.disabled = true; btn.textContent = 'Sparar…'; }
          const again = Object.assign({}, body);
          fields.forEach(f => { const el = document.getElementById('sens-retry-' + f.key); if (el) again[f.key] = (el.value || '').trim(); });
          const r2 = await this._saveSensitiveFields(again);
          if (r2.ok) { Modal.close(); showToast('Tillträdesuppgifterna sparade'); return; }
          if (btn) { btn.disabled = false; btn.textContent = 'Försök igen'; }
          const m = document.getElementById('sens-retry-msg');
          if (m) m.textContent = this._sensitiveFailText(r2);
          showToast('Sparades fortfarande inte — ' + this._sensitiveFailText(r2), 7000);
        }},
        { label: 'Stäng utan att spara', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    fields.forEach(f => { const el = document.getElementById('sens-retry-' + f.key); if (el) el.value = body[f.key] || ''; });
  },

  openEditObject(objId) {
    const obj = getPropObj(objId);
    if (!obj) return;
    const typeOptions = (typeof PROPERTY_OBJECT_TYPES !== 'undefined' ? PROPERTY_OBJECT_TYPES : [])
      .map(t => `<option value="${t.key}" ${obj.type===t.key?'selected':''}>${esc(t.label)}</option>`).join('');
    const statusOptions = (typeof PROPERTY_OBJECT_STATUSES !== 'undefined' ? PROPERTY_OBJECT_STATUSES : [])
      .map(s => `<option value="${s.key}" ${obj.status===s.key?'selected':''}>${esc(s.label)}</option>`).join('');
    /* I1 (2026-11-12): same fix as openAddObject() — Modal.open(). */
    Modal.open({
      title: `${ic('pencil',14)} Redigera objekt — ${esc(obj.name || obj.objectNumber)}`,
      body: `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label class="fl">Typ *</label>
            <select id="edit-obj-type" class="fi" style="width:100%;">${typeOptions}</select>
          </div>
          <div style="flex:1;">
            <label class="fl">Objektnummer</label>
            <input type="text" id="edit-obj-num" class="fi" style="width:100%;" value="${esc(obj.objectNumber||'')}">
          </div>
        </div>
        <div>
          <label class="fl">Namn / benämning</label>
          <input type="text" id="edit-obj-name" class="fi" style="width:100%;" value="${esc(obj.name||'')}">
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label class="fl">Entré / port</label>
            <input type="text" id="edit-obj-entrance" class="fi" style="width:100%;" value="${esc(obj.entrance||'')}">
          </div>
          <div style="flex:1;">
            <label class="fl">Trapphus</label>
            <input type="text" id="edit-obj-stairwell" class="fi" style="width:100%;" value="${esc(obj.stairwell||'')}">
          </div>
          <div style="flex:1;">
            <label class="fl">Våning</label>
            <input type="text" id="edit-obj-floor" class="fi" style="width:100%;" value="${esc(obj.floor||'')}">
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <div style="flex:1;">
            <label class="fl">Yta (m²)</label>
            <input type="number" id="edit-obj-area" class="fi" style="width:100%;" value="${obj.area||0}" min="0">
          </div>
          <div style="flex:1;">
            <label class="fl">Status</label>
            <select id="edit-obj-status" class="fi" style="width:100%;">${statusOptions}</select>
          </div>
        </div>
        <div>
          <label class="fl">Beskrivning</label>
          <textarea id="edit-obj-desc" class="fi" rows="2" style="width:100%;resize:vertical;">${esc(obj.description||'')}</textarea>
        </div>
        <div>
          <label class="fl">Tillträdesinformation / portkod</label>
          <input type="text" id="edit-obj-access" class="fi" style="width:100%;" value="${esc(obj.accessInformation||'')}">
        </div>
      </div>
    `,
      buttons: [
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() },
        { label: 'Spara ändringar', cls: 'btn bp', onClick: (ev) => PropertyDetailPage._saveEditObject(objId, ev) }
      ]
    });
  },

  async _saveEditObject(objId, ev) {
    const obj = getPropObj(objId);
    if (!obj) return;
    const accessInformation = (document.getElementById('edit-obj-access')?.value || '').trim();
    const fields = {
      type:         document.getElementById('edit-obj-type')?.value || obj.type,
      objectNumber: (document.getElementById('edit-obj-num')?.value || '').trim(),
      name:         (document.getElementById('edit-obj-name')?.value || '').trim(),
      entrance:     (document.getElementById('edit-obj-entrance')?.value || '').trim(),
      stairwell:    (document.getElementById('edit-obj-stairwell')?.value || '').trim(),
      floor:        (document.getElementById('edit-obj-floor')?.value || '').trim(),
      area:         parseFloat(document.getElementById('edit-obj-area')?.value || '0') || 0,
      status:       document.getElementById('edit-obj-status')?.value || obj.status,
      description:  (document.getElementById('edit-obj-desc')?.value || '').trim(),
    };
    try {
      PropertyObjectService.update(objId, fields);
      // Routa känsliga fält via EF (lagras ej i state/store)
      /* I5 (client, 2026-11-12): awaited, success only on a real 2xx
         {ok:true}; on failure the edit dialog STAYS OPEN with what the
         user typed (pressing Spara again is safe: the object update is a
         no-op diff, only the sensitive save is retried).
         Also: sent only when the field differs from what the form was
         opened with. The value lives in property_sensitive_access, not in
         the store, so the form normally opens with "" — the old code sent
         accessInformation:"" on EVERY object edit, which (once the EF
         works) would null an existing door code just by renaming the
         object. */
      const prefilled = (obj.accessInformation || '').trim();
      if (accessInformation !== prefilled) {
        const btn = (ev && ev.currentTarget) || null;
        if (btn) { btn.disabled = true; btn.textContent = 'Sparar…'; }
        const r = await this._saveSensitiveFields({ objectId: objId, propertyId: obj.propertyId, accessInformation });
        if (btn) { btn.disabled = false; btn.textContent = 'Spara ändringar'; }
        if (!r.ok) {
          const p0 = getObj(obj.propertyId);
          const el0 = p0 && document.getElementById('prop-tab-objects');
          if (el0) el0.innerHTML = this._renderObjectsTab(p0);
          showToast('Objektets övriga fält sparades, men tillträdesinformationen/portkoden gjorde det INTE — ' + this._sensitiveFailText(r) + ' Det du skrev finns kvar i formuläret; försök igen.', 9000);
          return;
        }
      }
      Modal.close(); // I1: closeModal() does not exist
      /* G12: objektets fält bekräftade av servern innan "uppdaterat". */
      confirmPersist('propertyObjects', objId, { ok: 'Objekt uppdaterat', fail: 'Objektet kunde inte sparas', onChange: () => {
        const pp = getObj(obj.propertyId); const e2 = pp && document.getElementById('prop-tab-objects'); if (e2) e2.innerHTML = this._renderObjectsTab(pp);
      }});
      const p = getObj(obj.propertyId);
      if (p) {
        const el = document.getElementById('prop-tab-objects');
        if (el) el.innerHTML = this._renderObjectsTab(p);
      }
    } catch(e) {
      showToast(e.message || 'Kunde inte spara', 'error');
    }
  },

  deleteObject(objId) {
    const obj = getPropObj(objId);
    if (!obj) return;
    if (!confirm(`Ta bort "${obj.name || obj.objectNumber}"? Åtgärden kan inte ångras.`)) return;
    try {
      PropertyObjectService.remove(objId);
      showToast('Objekt borttaget');
      const p = getObj(obj.propertyId);
      if (p) {
        const el = document.getElementById('prop-tab-objects');
        if (el) el.innerHTML = this._renderObjectsTab(p);
      }
    } catch(e) {
      showToast(e.message || 'Kunde inte ta bort', 'error');
    }
  },

  /* _siFilter: { status: 'all'|'overdue'|'due_soon'|'approaching'|'ok'|'paused', search: '', sort: 'nextDue' } */
  _siFilter: { status: 'all', search: '', sort: 'nextDue' },

  _siFApply(f) {
    Object.assign(this._siFilter, f);
    const propId = this.propId;
    const p = propId ? getObj(propId) : null;
    if (p) {
      const el = document.getElementById('prop-tab-service');
      if (el) { el.innerHTML = this._renderServiceTab(p); this._refocus('prop-si-search', f); }
    }
  },

  _renderServiceTab(p) {
    const SIS = typeof ServiceIntervalService !== 'undefined' ? ServiceIntervalService : null;
    if (!SIS) return '<div class="empty"><h3>ServiceIntervalService saknas</h3></div>';
    let siList = (p.serviceIntervals || []).slice();

    const canManage = Auth.can('customer_manage');
    const canMark   = canManage || Auth.can('ao_edit');
    const f = this._siFilter;

    /* ── Filter ───────────────────────────── */
    const q = (f.search || '').toLowerCase();
    if (q) siList = siList.filter(si => (si.title + ' ' + si.category + ' ' + (si.supplier||'')).toLowerCase().includes(q));
    if (f.status !== 'all') siList = siList.filter(si => SIS.getStatus(si) === f.status);

    /* ── Sort ─────────────────────────────── */
    siList.sort((a, b) => {
      if (f.sort === 'name') return (a.title || '').localeCompare(b.title || '', 'sv');
      const da = SIS.daysUntil(a.nextDue); const db = SIS.daysUntil(b.nextDue);
      if (da === null && db === null) return 0;
      if (da === null) return 1; if (db === null) return -1;
      return da - db;
    });

    /* ── Status-räknare för filter-chips ─── */
    const all    = p.serviceIntervals || [];
    const counts = { overdue: 0, due_soon: 0, approaching: 0, ok: 0, paused: 0 };
    all.forEach(si => { const st = SIS.getStatus(si); if (counts[st] !== undefined) counts[st]++; });

    const filterBar = `
      <div class="si-filter-bar">
        <div style="display:flex;gap:4px;flex-wrap:wrap;flex:1;">
          ${[
            ['all',        'Alla',          all.length],
            ['overdue',    'Förfallna',     counts.overdue],
            ['due_soon',   'Förfaller snart',counts.due_soon],
            ['approaching','Närmar sig',    counts.approaching],
            ['ok',         'OK',            counts.ok],
            ['paused',     'Pausade',       counts.paused]
          ].map(([k,l,n]) => `<button class="si-fchip ${f.status===k?'on':''}" onclick="PropertyDetailPage._siFApply({status:'${k}'})">${l}${n>0?` <span class="si-fchip-cnt">${n}</span>`:''}</button>`).join('')}
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <label class="mx-isearch">${ic('search',13)}<span class="sr-only">Sök serviceintervall</span>
            <input type="search" class="fi" id="prop-si-search" placeholder="Sök…" value="${esc(f.search||'')}"
              oninput="PropertyDetailPage._siFApply({search:this.value})"></label>
          <select class="fi" style="font-size:12px;padding:5px 8px;height:32px;" onchange="PropertyDetailPage._siFApply({sort:this.value})">
            <option value="nextDue" ${f.sort==='nextDue'?'selected':''}>Sorterat efter förfall</option>
            <option value="name"    ${f.sort==='name'   ?'selected':''}>Sorterat efter namn</option>
          </select>
        </div>
      </div>`;

    const itemsHtml = siList.length === 0
      ? `<div class="empty" style="padding:24px 0;">
           ${ic('wrench',28)}
           <p style="font-size:12px;color:var(--mt);margin-top:6px;">${all.length === 0 ? 'Inga serviceintervall tillagda ännu.' : 'Inga intervall matchar filtret.'}</p>
           ${all.length === 0 && canManage ? `<button class="btn bp bsm" onclick="PropertyDetailPage.openAddInterval('${p.id}')">${ic('plus',13)} Lägg till</button>` : ''}
         </div>`
      : siList.map(si => {
          const status   = SIS.getStatus(si);
          const respS    = si.responsibleStaffId ? (state.staff||[]).find(s => s.id === si.responsibleStaffId) : null;
          const respName = respS ? `${respS.firstName} ${respS.lastName}`.trim() : '';
          const cat      = SIS.CATEGORIES.find(c => c.key === si.category);
          const cardCls  = status === 'overdue' ? 'si-card--overdue'
                         : status === 'due_soon' ? 'si-card--due-soon'
                         : status === 'approaching' ? 'si-card--approaching'
                         : status === 'paused' ? 'si-card--paused' : '';
          const nextColor = status==='overdue'?'var(--rd)':status==='due_soon'||status==='approaching'?'var(--or)':'inherit';
          const linkedAO  = si.lastGeneratedAOId ? (state.workOrders||[]).find(a=>a.id===si.lastGeneratedAOId) : null;
          return `
            <div class="si-card ${cardCls}">
              <div class="si-card-header">
                <div style="flex:1;min-width:0;">
                  <div class="si-card-title">${esc(si.title)}</div>
                  <div class="si-card-meta">
                    ${cat ? `<span>${esc(cat.label)}</span>` : ''}
                    <span>${SIS.intervalLabel(si)}</span>
                    ${respName ? `<span>${ic('user',10)} ${esc(respName)}</span>` : ''}
                    ${si.supplier ? `<span>${ic('package',10)} ${esc(si.supplier)}</span>` : ''}
                  </div>
                </div>
                <div class="si-card-status">${SIS.statusBadge(si)}</div>
              </div>
              <div class="si-card-body">
                <div class="si-info-row">
                  <span>Senast utfört:</span>
                  <span>${si.lastDone ? fmtDate(si.lastDone) : '—'}</span>
                </div>
                <div class="si-info-row">
                  <span>Nästa förfall:</span>
                  <span style="font-weight:600;color:${nextColor};">
                    ${si.nextDue ? fmtDate(si.nextDue) : '—'}
                    ${si.nextDue && status !== 'ok' && status !== 'paused' ? ` <span style="font-size:11px;font-weight:400;color:var(--mt);">(${SIS.statusLabel(si)})</span>` : ''}
                  </span>
                </div>
                ${si.reminderDays ? `<div class="si-info-row"><span>Påminnelse:</span><span>${si.reminderDays} dagar före</span></div>` : ''}
                ${si.autoCreateAO ? `<div class="si-info-row"><span class="bdg bdg-blue" style="font-size:10px;">${ic('clipboard-list',10)} Automatisk AO ${si.aoCreateDaysBefore > 0 ? si.aoCreateDaysBefore+' dgr före':' på förfallodagen'}</span>${linkedAO?`<span class="bdg bdg-grey" style="font-size:10px;cursor:pointer;" onclick="Router.showPage('pg-ao-detail',{aoId:'${linkedAO.id}'})">${ic('link',9)} ${linkedAO.id}</span>`:''}</div>` : ''}
                ${si.description ? `<div class="si-info-row" style="color:var(--mt);font-size:11px;">${esc(si.description)}</div>` : ''}
              </div>
              <div class="si-card-actions">
                ${canMark && si.active ? `<button class="btn bp bsm" onclick="PropertyDetailPage.openMarkDone('${p.id}','${si.id}')">${ic('check-circle',13)} Markera utförd</button>` : ''}
                ${(si.history||[]).length > 0 ? `<button class="btn bghost bsm" onclick="PropertyDetailPage.openSIHistory('${p.id}','${si.id}')">${ic('clock',13)} Historik (${si.history.length})</button>` : ''}
                ${canManage ? `<button class="btn bghost bsm" onclick="PropertyDetailPage.openEditInterval('${p.id}','${si.id}')">${ic('pencil',13)}</button>` : ''}
                ${canManage ? `<button class="btn bghost bsm" title="${si.active?'Pausa':'Återuppta'}" onclick="PropertyDetailPage.toggleSIPaused('${p.id}','${si.id}')">${ic(si.active?'pause-circle':'play-circle',13)}</button>` : ''}
                ${canManage ? `<button class="btn bd bsm" onclick="PropertyDetailPage.deleteInterval('${p.id}','${si.id}')">${ic('trash-2',13)}</button>` : ''}
              </div>
            </div>`;
        }).join('');

    return `
      <div class="card">
        <div class="card-header">
          <h3>${ic('wrench',14)} Serviceintervall <span class="ft-n">${all.length}</span></h3>
          ${canManage ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openAddInterval('${p.id}')">${ic('plus',13)} Lägg till</button>` : ''}
        </div>
        <div class="card-body" style="padding-top:8px;">
          ${all.length > 0 ? filterBar : ''}
          <div id="si-list-body" style="margin-top:${all.length>0?'10':'0'}px;">${itemsHtml}</div>
        </div>
      </div>`;
  },

  _siIntervalFormHtml(si) {
    const SIS      = ServiceIntervalService;
    const cats     = SIS.CATEGORIES;
    const iTypes   = SIS.INTERVAL_TYPES;
    const staff    = state.staff || [];
    const selType  = si ? (si.intervalType  || 'annual')      : 'annual';
    const selCat   = si ? (si.category      || 'filterbyte')  : 'filterbyte';
    const selRem   = si ? (si.reminderDays  || 14)            : 14;
    const selStaff = si ? (si.responsibleStaffId || '')       : '';
    const selObj   = si ? (si.objectId || '') : '';
    const isCustom = selType.startsWith('custom_');
    const isAutoAO = si ? !!si.autoCreateAO : false;
    const aoStaff  = si ? (si.aoStaff || []) : [];
    const prios    = [{v:'akut',l:'Akut'},{v:'hög',l:'Hög'},{v:'normal',l:'Normal'},{v:'låg',l:'Låg'}];

    // Objekt-väljare för fastigheten
    const POS = typeof PropertyObjectService !== 'undefined' ? PropertyObjectService : null;
    const propObjs = (this.propId && POS) ? POS.getByProperty(this.propId) : [];
    const objSelectHtml = propObjs.length
      ? `<div class="fg">
           <label>Kopplat objekt (valfritt)</label>
           <select id="si-object" class="fi">
             <option value="">— Hela fastigheten —</option>
             ${propObjs.map(o=>`<option value="${o.id}" ${selObj===o.id?'selected':''}>${esc(o.objectNumber?o.objectNumber+' – ':'')}${esc(o.name || POS.typeLabel(o.type))}</option>`).join('')}
           </select>
         </div>`
      : '';

    return `
      <div class="fg">
        <label>Titel *</label>
        <input id="si-title" class="fi" type="text" value="${esc(si ? si.title : '')}" placeholder="Filterbyte ventilation, OVK, …">
      </div>
      ${objSelectHtml}
      <div class="g2">
        <div class="fg">
          <label>Kategori</label>
          <select id="si-category" class="fi">
            ${cats.map(c => `<option value="${c.key}" ${selCat===c.key?'selected':''}>${esc(c.label)}</option>`).join('')}
          </select>
        </div>
        <div class="fg">
          <label>Intervall *</label>
          <select id="si-interval-type" class="fi" onchange="PropertyDetailPage._siToggleCustom()">
            ${iTypes.map(t => `<option value="${t.key}" ${selType===t.key?'selected':''}>${esc(t.label)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="fg" id="si-custom-val-wrap" style="${isCustom?'':'display:none;'}">
        <label>Antal <span id="si-custom-unit-lbl">${selType==='custom_months'?'månader':selType==='custom_years'?'år':'dagar'}</span></label>
        <input id="si-custom-val" class="fi" type="number" min="1" value="${si && isCustom ? (si.intervalValue||1) : 1}">
      </div>
      <div class="fg">
        <label>Senast utfört</label>
        <input id="si-last-done" class="fi" type="date" value="${si ? (si.lastDone || '') : ''}">
      </div>
      <div class="g2">
        <div class="fg">
          <label>Ansvarig person</label>
          <select id="si-staff" class="fi">
            <option value="">— Välj —</option>
            ${staff.map(s => `<option value="${s.id}" ${selStaff===s.id?'selected':''}>${esc(s.firstName)} ${esc(s.lastName)}</option>`).join('')}
          </select>
        </div>
        <div class="fg">
          <label>Leverantör</label>
          <input id="si-supplier" class="fi" type="text" value="${esc(si ? (si.supplier||'') : '')}" placeholder="Företagsnamn">
        </div>
      </div>
      <div class="g2">
        <div class="fg">
          <label>Påminnelse</label>
          <select id="si-reminder" class="fi">
            <option value="7"  ${selRem==7 ?'selected':''}>7 dagar före</option>
            <option value="14" ${selRem==14?'selected':''}>14 dagar före</option>
            <option value="30" ${selRem==30?'selected':''}>30 dagar före</option>
            <option value="60" ${selRem==60?'selected':''}>60 dagar före</option>
          </select>
        </div>
        <div class="fg" style="padding-top:20px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
            <input id="si-auto-ao" type="checkbox" ${isAutoAO ? 'checked' : ''}
              onchange="PropertyDetailPage._siToggleAutoAO()">
            Skapa AO automatiskt
          </label>
        </div>
      </div>

      <div id="si-ao-fields" style="${isAutoAO?'':'display:none;'}margin-top:4px;padding:10px 12px;background:rgba(14,165,233,.05);border:1px solid rgba(14,165,233,.15);border-radius:8px;">
        <div style="font-size:11px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">${ic('clipboard-list',11)} AO-inställningar</div>
        <div class="fg">
          <label>Skapa AO antal dagar före förfall (0 = på förfallodagen)</label>
          <input id="si-ao-days-before" class="fi" type="number" min="0" value="${si ? (si.aoCreateDaysBefore||0) : 0}">
        </div>
        <div class="fg">
          <label>AO-rubrik (lämna tomt för intervalltitel)</label>
          <input id="si-ao-title" class="fi" type="text" value="${esc(si ? (si.aoTitle||'') : '')}" placeholder="Lämna tomt för automatisk rubrik">
        </div>
        <div class="fg">
          <label>AO-beskrivning</label>
          <textarea id="si-ao-description" class="fi" rows="2">${esc(si ? (si.aoDescription||'') : '')}</textarea>
        </div>
        <div class="g2">
          <div class="fg">
            <label>AO-prioritet</label>
            <select id="si-ao-priority" class="fi">
              ${prios.map(pr => `<option value="${pr.v}" ${(si?si.aoPriority||'normal':'normal')===pr.v?'selected':''}>${pr.l}</option>`).join('')}
            </select>
          </div>
          <div class="fg">
            <label>AO-personal (valfritt)</label>
            <select id="si-ao-staff" class="fi">
              <option value="">— Välj —</option>
              ${staff.map(s => `<option value="${s.id}" ${aoStaff.includes(s.id)?'selected':''}>${esc(s.firstName)} ${esc(s.lastName)}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="fg" style="margin-top:8px;">
        <label>Anteckning</label>
        <textarea id="si-description" class="fi" rows="2" placeholder="Mer information om åtgärden…">${esc(si ? (si.description||'') : '')}</textarea>
      </div>`;
  },

  _siToggleCustom() {
    const sel  = document.getElementById('si-interval-type');
    const wrap = document.getElementById('si-custom-val-wrap');
    const lbl  = document.getElementById('si-custom-unit-lbl');
    if (!sel || !wrap) return;
    const isC = sel.value.startsWith('custom_');
    wrap.style.display = isC ? '' : 'none';
    if (lbl) lbl.textContent = sel.value === 'custom_months' ? 'månader' : sel.value === 'custom_years' ? 'år' : 'dagar';
  },

  _siToggleAutoAO() {
    const cb   = document.getElementById('si-auto-ao');
    const wrap = document.getElementById('si-ao-fields');
    if (wrap) wrap.style.display = cb && cb.checked ? '' : 'none';
  },

  _siReadForm() {
    const iType = document.getElementById('si-interval-type')?.value || 'annual';
    const iVal  = Number(document.getElementById('si-custom-val')?.value || 1);
    const aoStaffSel = document.getElementById('si-ao-staff');
    const aoStaff = aoStaffSel && aoStaffSel.value ? [aoStaffSel.value] : [];
    return {
      title:              document.getElementById('si-title')?.value.trim()       || '',
      category:           document.getElementById('si-category')?.value           || 'filterbyte',
      intervalType:       iType,
      intervalValue:      iType.startsWith('custom_') ? iVal : 1,
      lastDone:           document.getElementById('si-last-done')?.value          || '',
      responsibleStaffId: document.getElementById('si-staff')?.value              || '',
      supplier:           document.getElementById('si-supplier')?.value.trim()    || '',
      reminderDays:       Number(document.getElementById('si-reminder')?.value    || 14),
      autoCreateAO:       document.getElementById('si-auto-ao')?.checked          || false,
      aoCreateDaysBefore: Number(document.getElementById('si-ao-days-before')?.value || 0),
      aoTitle:            document.getElementById('si-ao-title')?.value.trim()    || '',
      aoDescription:      document.getElementById('si-ao-description')?.value.trim() || '',
      aoPriority:         document.getElementById('si-ao-priority')?.value        || 'normal',
      aoStaff,
      description:        document.getElementById('si-description')?.value.trim() || '',
      objectId:           document.getElementById('si-object')?.value || ''
    };
  },

  openAddInterval(propId) {
    if (!Auth.can('customer_manage')) return;
    Modal.open({
      title: 'Lägg till serviceintervall',
      wide:  true,
      body:  this._siIntervalFormHtml(null),
      buttons: [
        { label: 'Avbryt', cls: 'bs', onClick: () => Modal.close() },
        { label: 'Spara', cls: 'bp', onClick: () => PropertyDetailPage._saveAddInterval(propId) }
      ]
    });
  },

  /* Håller den fastighetsöverskridande översikten (#/serviceintervall) i
     synk när ett intervall sparas via samma modaler därifrån. */
  _refreshSIOverview() {
    if (typeof ServiceIntervalsPage !== 'undefined' && document.getElementById('si-overview-list')) ServiceIntervalsPage.render();
  },

  /* Renderar om fastighetens Service-flik, översikten och (vid behov)
     översiktsfliken efter en ändring av ett serviceintervall. */
  _siRefreshViews(propId) {
    const p = getObj(propId);
    if (!p) return;
    const el = document.getElementById('prop-tab-service');
    if (el) el.innerHTML = this._renderServiceTab(p);
    this._refreshSIOverview();
    const ovEl = document.getElementById('prop-tab-overview');
    if (ovEl) ovEl.innerHTML = this._renderOverview(p, p.inspections || {}, p.serviceIntervals || []);
  },

  /* E2E SVC-02 (2026-11-23): gemensam sparväg för alla serviceintervall-
     ändringar. Tidigare visades "Markerat som utförd"/"tillagt" direkt
     medan persist() gick i bakgrunden — även när servern sedan nekade.
     Nu: mutera state (utan egen persist), visa "Sparar…", vänta på
     serverns svar för nyckeln properties, och visa framgång först då.
     Vid fel avgör settlePersistFailure() (samma N1-regel som kund-
     registret) om ändringen faktiskt landade; annars rullas fastigheten
     tillbaka till läget före ändringen och ett tydligt fel visas.
     `_siSaving` spärrar dubbelklick/parallella sparningar. */
  async _siCommit(propId, mutate, msgs) {
    if (this._siSaving) return false;
    const p0 = getObj(propId);
    if (!p0) return false;
    const before = JSON.parse(JSON.stringify(p0));
    this._siSaving = true;
    try {
      const r = mutate();
      if (r === false || r === null || r === undefined) { showToast('Serviceintervallet hittades inte'); return false; }
      Modal.close();
      this._siRefreshViews(propId);
      showToast('Sparar…');
      const ok = await persist({ keys: ['properties'] });
      if (!ok) {
        const n1 = (typeof settlePersistFailure === 'function') ? await settlePersistFailure('properties', propId) : { fate: 'none' };
        if (n1.fate === 'diverged' || n1.fate === 'conflict') {
          this._siRefreshViews(propId);
          showToast('Fastigheten ändrades samtidigt av en annan session — välj i konfliktdialogen.', 6000);
          return false;
        }
        if (n1.fate !== 'landed') {
          const idx = (state.properties || []).findIndex(x => x.id === propId);
          if (idx >= 0) state.properties[idx] = before;
          try { Storage.setLocal('properties', state.properties); } catch (e) {}
          if (typeof Sidebar !== 'undefined') Sidebar.updateBadges();
          this._siRefreshViews(propId);
          showToast((msgs.fail || 'Ändringen kunde inte sparas') + (n1.fate === 'not-landed' || n1.fate === 'unknown'
            ? ' — den ligger kvar som osparad; välj Återuppta eller Kasta i meddelandet överst.'
            : ' av servern. Försök igen.'), 7000);
          return false;
        }
      }
      if (typeof msgs.after === 'function') { try { msgs.after(r); } catch (e) { console.warn('[serviceintervall] efterarbete:', e); } }
      this._siRefreshViews(propId);
      showToast(msgs.ok);
      return true;
    } finally {
      this._siSaving = false;
    }
  },

  _saveAddInterval(propId) {
    const d = this._siReadForm();
    if (!d.title) { showToast('Ange en titel'); return; }
    return this._siCommit(propId, () => ServiceIntervalService.create(propId, d, { persist: false }),
      { ok: 'Serviceintervall tillagt', fail: 'Serviceintervallet kunde inte sparas' });
  },

  openEditInterval(propId, siId) {
    if (!Auth.can('customer_manage')) return;
    const p  = getObj(propId);
    const si = p ? (p.serviceIntervals || []).find(s => s.id === siId) : null;
    if (!si) return;
    Modal.open({
      title: 'Redigera serviceintervall',
      wide:  true,
      body:  this._siIntervalFormHtml(si),
      buttons: [
        { label: 'Avbryt', cls: 'bs', onClick: () => Modal.close() },
        { label: 'Spara',  cls: 'bp', onClick: () => PropertyDetailPage._saveEditInterval(propId, siId) }
      ]
    });
  },

  _saveEditInterval(propId, siId) {
    const d = this._siReadForm();
    if (!d.title) { showToast('Ange en titel'); return; }
    return this._siCommit(propId, () => ServiceIntervalService.update(propId, siId, d, { persist: false }),
      { ok: 'Serviceintervall uppdaterat', fail: 'Ändringen av serviceintervallet kunde inte sparas' });
  },

  deleteInterval(propId, siId) {
    if (!Auth.can('customer_manage')) return;
    if (!confirm('Ta bort detta serviceintervall?')) return;
    return this._siCommit(propId, () => ServiceIntervalService.delete(propId, siId, { persist: false }),
      { ok: 'Serviceintervall borttaget', fail: 'Serviceintervallet kunde inte tas bort' });
  },

  openMarkDone(propId, siId) {
    const p   = getObj(propId);
    const si  = p ? (p.serviceIntervals || []).find(s => s.id === siId) : null;
    if (!si) return;
    const staff    = state.staff || [];
    const curStaff = si.responsibleStaffId || (state.currentUser ? state.currentUser.id : '');
    const SIS      = ServiceIntervalService;
    const linkedAO = si.lastGeneratedAOId ? (state.workOrders||[]).find(a => a.id === si.lastGeneratedAOId) : null;
    // Open property AOs for linkage
    const propAOs  = (state.workOrders||[]).filter(a => a.propertyId === propId && !a.archived && !a.deleted && !['fakturerad'].includes(a.status)).slice(0, 30);
    Modal.open({
      title: `Markera utförd — ${esc(si.title)}`,
      wide:  false,
      body:  `
        <div class="fg">
          <label>Datum för utförande</label>
          <input id="si-done-date" class="fi" type="date" value="${tdy()}">
        </div>
        <div class="fg">
          <label>Utförd av</label>
          <select id="si-done-staff" class="fi">
            <option value="">— Välj —</option>
            ${staff.map(s => `<option value="${s.id}" ${curStaff===s.id?'selected':''}>${esc(s.firstName)} ${esc(s.lastName)}</option>`).join('')}
          </select>
        </div>
        <div class="fg">
          <label>Kopplad arbetsorder (valfritt)</label>
          <select id="si-done-ao" class="fi">
            <option value="">— Ingen —</option>
            ${linkedAO ? `<option value="${linkedAO.id}" selected>${linkedAO.id} — ${esc(linkedAO.title)}</option>` : ''}
            ${propAOs.filter(a => !linkedAO || a.id !== linkedAO.id).map(a => `<option value="${a.id}">${a.id} — ${esc(a.title)}</option>`).join('')}
          </select>
        </div>
        <div class="fg">
          <label>Kommentar (valfritt)</label>
          <textarea id="si-done-comment" class="fi" rows="2" placeholder="Ev. anteckning om utförandet…"></textarea>
        </div>
        <div style="background:rgba(14,165,233,.07);border:1px solid rgba(14,165,233,.2);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--mt);margin-top:4px;line-height:1.5;">
          ${ic('info',12)} Nästa förfallodatum räknas om automatiskt: ${esc(SIS.intervalLabel(si))}.
          ${si.nextDue ? `Nuvarande: <strong>${fmtDate(si.nextDue)}</strong>.` : ''}
        </div>`,
      buttons: [
        { label: 'Avbryt',         cls: 'bs', onClick: () => Modal.close() },
        { label: 'Markera utförd', cls: 'bp', onClick: () => PropertyDetailPage._saveMarkDone(propId, siId) }
      ]
    });
  },

  _saveMarkDone(propId, siId) {
    const date    = document.getElementById('si-done-date')?.value       || tdy();
    const staffId = document.getElementById('si-done-staff')?.value      || '';
    const aoId    = document.getElementById('si-done-ao')?.value         || '';
    const comment = document.getElementById('si-done-comment')?.value.trim() || '';
    return this._siCommit(propId,
      () => ServiceIntervalService.markDone(propId, siId, { date, staffId, comment, aoId, persist: false }),
      { ok: 'Markerat som utförd — nästa datum beräknat', fail: 'Utförandet kunde inte sparas',
        after: (r) => ServiceIntervalService.finishMarkDone(propId, siId, r.previousNextDue, { staffId, comment }) });
  },

  toggleSIPaused(propId, siId) {
    if (!Auth.can('customer_manage')) return;
    const p  = getObj(propId);
    const si = p ? (p.serviceIntervals || []).find(s => s.id === siId) : null;
    if (!si) return;
    const pausing = !!si.active;
    return this._siCommit(propId, () => ServiceIntervalService.setPaused(propId, siId, pausing, { persist: false }),
      { ok: pausing ? 'Intervall pausat' : 'Intervall återupptaget', fail: 'Ändringen kunde inte sparas' });
  },

  openSIHistory(propId, siId) {
    const p     = getObj(propId);
    const si    = p ? (p.serviceIntervals || []).find(s => s.id === siId) : null;
    if (!si) return;
    const hist  = si.history || [];
    const staff = state.staff || [];
    const rows  = hist.map(h => {
      const s     = h.staffId ? staff.find(x => x.id === h.staffId) : null;
      const sName = s ? `${s.firstName} ${s.lastName}`.trim() : (h.staffId || '—');
      const ao    = h.aoId ? (state.workOrders||[]).find(a => a.id === h.aoId) : null;
      return `<div class="si-hist-row">
        <div class="si-hist-date">${fmtDate(h.date)}</div>
        <div class="si-hist-by">${ic('user',11)} ${sName}</div>
        ${h.previousNextDue ? `<div style="font-size:11px;color:var(--mt);">Avslutad förfallsperiod: ${fmtDate(h.previousNextDue)}</div>` : ''}
        ${h.comment ? `<div class="si-hist-comment">${ic('message-square',10)} ${esc(h.comment)}</div>` : ''}
        ${ao ? `<div style="font-size:11px;margin-top:3px;"><a style="color:var(--sky);cursor:pointer;" onclick="Modal.close();Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">${ic('clipboard-list',10)} ${ao.id} — ${esc(ao.title)}</a></div>` : ''}
      </div>`;
    });
    Modal.open({
      title: `Historik — ${esc(si.title)}`,
      wide:  false,
      body:  hist.length === 0
        ? '<p style="color:var(--mt);">Ingen historik ännu.</p>'
        : `<div class="si-hist-list">${rows.join('')}</div>`,
      buttons: [{ label: 'Stäng', cls: 'bs', onClick: () => Modal.close() }]
    });
  },

  /* ── Tab: Ansvariga & kontakter (Leverans D) ─────────── */

  _renderAnsvarigaTab(p) {
    const contacts = PropertyContactService.getForProperty(p.id);
    const roles    = PropertyContactService.activeRoles();
    const canEdit  = Auth.can('customer_manage');

    const rows = contacts.length
      ? contacts.map(c => `
          <div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--br);">
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:700;">${esc(c.personNameSnapshot||'—')}</div>
              <div style="font-size:11px;color:var(--mt);">${esc(c.roleNameSnapshot||'—')}${c.isPrimary?' · Primär':''}${c.personPhoneSnapshot?' · '+esc(c.personPhoneSnapshot):''}</div>
              ${c.notes?`<div style="font-size:11px;color:var(--mt);">${esc(c.notes)}</div>`:''}
            </div>
            ${c.isPrimary?`<span class="bdg bdg-blue" style="font-size:9px;">Primär</span>`:''}
            ${canEdit?`
              <button class="btn bxs bs" onclick="PropertyDetailPage.openEditPropContact('${c.id}','${p.id}')">${ic('pencil',11)}</button>
              <button class="btn bxs bd" onclick="PropertyDetailPage.removePropContact('${c.id}','${p.id}')">${ic('trash',11)}</button>
            `:''}
          </div>`)
        .join('')
      : `<p style="font-size:12px;color:var(--mt);padding:4px 0;">Inga ansvariga kopplade.</p>`;

    return `
      <div class="card">
        <div class="card-header">
          <h3>${ic('user-check',14)} Ansvariga <span class="ft-n">${contacts.length}</span></h3>
          ${canEdit ? `<button class="btn bp bxs" onclick="PropertyDetailPage.openAddPropContact('${p.id}')">${ic('plus',13)} Lägg till</button>` : ''}
        </div>
        <div class="card-body">
          ${roles.length === 0 ? `<div style="font-size:12px;color:var(--or);padding:8px 0;">${ic('alert-circle',12)} Inga ansvarstiler skapade. Gå till <b>Admin → Ansvariga</b> för att lägga till titlar.</div>` : ''}
          ${rows}
        </div>
      </div>`;
  },

  openAddPropContact(propertyId) {
    this._propContactForm(null, propertyId);
  },

  openEditPropContact(id, propertyId) {
    const c = (state.propertyContacts || []).find(x => x.id === id);
    if (c) this._propContactForm(c, propertyId);
  },

  _propContactForm(contact, propertyId) {
    const isEdit = !!contact;
    const roles  = PropertyContactService.activeRoles();
    const staffOpts = (state.staff || [])
      .filter(s => s.active !== false)
      .map(s => `<option value="${s.id}" ${contact&&contact.personId===s.id?'selected':''}>${esc(s.firstName+' '+s.lastName)}</option>`)
      .join('');

    Modal.open({
      title: isEdit ? 'Redigera ansvarig' : 'Lägg till ansvarig',
      body: `
        <div class="fg"><label>Titel *</label>
          <select id="pcon-role" class="fi">
            <option value="">— Välj titel —</option>
            ${roles.map(r => `<option value="${r.id}" ${contact&&contact.roleId===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label>Personal *</label>
          <select id="pcon-staff" class="fi">
            <option value="">— Välj personal —</option>
            ${staffOpts}
          </select>
        </div>
        <div class="fg"><label>Anteckningar</label>
          <input type="text" id="pcon-notes" value="${contact ? esc(contact.notes||'') : ''}" placeholder="Valfri notering...">
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-top:6px;">
          <input type="checkbox" id="pcon-primary" ${contact&&contact.isPrimary?'checked':''}> Primär kontakt för denna titel
        </label>`,
      buttons: [
        { label: isEdit ? 'Spara' : 'Lägg till', cls: 'btn bp', onClick: () => this._savePropContact(contact ? contact.id : null, propertyId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _savePropContact(id, propertyId) {
    const roleId    = (document.getElementById('pcon-role')||{}).value||'';
    const staffId   = (document.getElementById('pcon-staff')||{}).value||'';
    const notes     = ((document.getElementById('pcon-notes')||{}).value||'').trim();
    const isPrimary = !!(document.getElementById('pcon-primary')||{}).checked;
    if (!roleId) { showToast('Välj titel'); return; }
    if (!staffId) { showToast('Välj personal'); return; }
    const data = { roleId, personType: 'staff', personId: staffId, notes, isPrimary, propertyId, active: true };
    if (id) {
      PropertyContactService.update(id, data);
    } else {
      PropertyContactService.add(data);
    }
    Modal.close();
    this.render({ propId: propertyId });
  },

  removePropContact(id, propertyId) {
    if (!confirm('Ta bort denna koppling?')) return;
    PropertyContactService.remove(id);
    this.render({ propId: propertyId });
  },

  /* ── Tab: Kontakt & åtkomst ────────────────────────────── */

  _renderContactTab(p, contacts) {
    return `
      <div class="card">
        <div class="card-header">
          <h3>${ic('users',14)} Kontaktpersoner <span class="ft-n">${contacts.length}</span></h3>
          ${Auth.can('customer_manage')
            ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openAddContact()">${ic('plus',13)} Lägg till</button>`
            : ''}
        </div>
        <div class="card-body" id="prop-contacts">
          ${this._renderContacts(contacts)}
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>${ic('key',14)} Åtkomst & nycklar</h3>
          ${Auth.can('customer_manage')
            ? `<button class="btn bghost bxs" aria-label="Redigera åtkomst och nycklar" title="Redigera" onclick="PropertyDetailPage.openEdit()">${ic('pencil',13)}</button>`
            : ''}
        </div>
        <div class="card-body">
          ${Auth.can('objects_sensitive')
            ? `<div id="sensitive-prop-${p.id}" style="color:var(--mt);font-size:12px;">${ic('loader',12)} Laddar…</div>`
            : `<p style="font-size:12px;color:var(--mt);">${ic('lock',11)} Du saknar behörighet att se känsliga åtkomstuppgifter.</p>`}
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
          <div style="font-size:13px;font-weight:700;">${esc(c.name||'—')}</div>
          ${c.role ? `<div style="font-size:11px;color:var(--mt);">${esc(c.role)}</div>` : ''}
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:2px;">
            ${c.phone ? `<a href="tel:${esc(c.phone)}" class="mx-link-sm">${ic('phone',12)} ${esc(c.phone)}</a>` : ''}
            ${c.email ? `<a href="mailto:${esc(c.email)}" class="mx-link-sm">${ic('mail',12)} ${esc(c.email)}</a>` : ''}
          </div>
        </div>
        ${Auth.can('customer_manage') ? `
          <button class="btn bxs bs" onclick="PropertyDetailPage.openAddContact(${i})">${ic('pencil',11)}</button>
          <button class="btn bxs bd" onclick="PropertyDetailPage.removeContact(${i})">${ic('trash',11)}</button>
        ` : ''}
      </div>`).join('');
  },

  /* ── Tab: Teknisk information ──────────────────────────── */

  _renderTechTab(tech, insp) {
    const cats = (state.propertyCategories || [])
      .filter(c => c.active !== false)
      .sort((a, b) => (a.order || 99) - (b.order || 99));

    const fallbackSystems = [
      { slug:'heating',     icon:'thermometer',   label:'Värme' },
      { slug:'ventilation', icon:'wind',          label:'Ventilation' },
      { slug:'electricity', icon:'zap',           label:'El' },
      { slug:'water',       icon:'droplets',      label:'Vatten & avlopp' },
      { slug:'sba',         icon:'shield-check',  label:'SBA / Brand' },
      { slug:'waste',       icon:'trash-2',       label:'Avfall & miljö' },
      { slug:'other',       icon:'settings',      label:'Övrigt' },
    ];
    const systems = cats.length
      ? cats.map(c => ({ slug: c.slug, icon: c.icon, label: c.label, fields: c.fields || [] }))
      : fallbackSystems.map(s => ({ ...s, fields: [] }));

    const propId = this.propId;

    return `
      <div class="card" style="margin-bottom:8px;">
        <div class="card-header">
          <h3>${ic('settings',14)} Tekniska system</h3>
        </div>
        ${systems.map(sys => {
          const t = tech[sys.slug];
          const tObj = (t && typeof t === 'object') ? t : (t ? { _value: t } : {});
          const hasData = Object.values(tObj).some(Boolean);
          const accId = `prop-acc-${sys.slug}`;
          const openCatAOs = (state.workOrders||[]).filter(a =>
            a.propertyId === propId &&
            a.technicalCategorySlug === sys.slug &&
            !['klar','fakturerad','avbruten'].includes(a.status) &&
            !a.deleted
          ).length;
          return `
          <div class="prop-acc-row" id="${accId}">
            <div class="prop-acc-hd" onclick="PropertyDetailPage._toggleAcc('${accId}')">
              <span class="prop-acc-hd-icon">${ic(sys.icon,14)}</span>
              <span class="prop-acc-hd-label">${esc(sys.label)}</span>
              <div class="prop-acc-hd-right">
                ${openCatAOs > 0 ? `<span class="bdg bdg-blue" style="font-size:9px;" title="${openCatAOs} öppna AO">${ic('clipboard-list',9)} ${openCatAOs}</span>` : ''}
                ${hasData
                  ? `<span class="bdg bdg-green" style="font-size:9px;">Ifylld</span>`
                  : `<span class="bdg bdg-grey" style="font-size:9px;">Tom</span>`}
                <span class="prop-acc-chevron">${ic('chevron-down',14)}</span>
              </div>
            </div>
            <div class="prop-acc-body">
              ${this._renderTechSystem(sys.slug, tObj, sys.fields)}
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
                ${Auth.can('customer_manage')
                  ? `<button class="btn bs bsm"
                       onclick="PropertyDetailPage.openEditTechSystem('${sys.slug}')">
                       ${ic('pencil',13)} Redigera</button>`
                  : ''}
                ${Auth.can('ao_create')
                  ? `<button class="btn bsu bsm"
                       onclick="PropertyDetailPage.openCreateAOFromTech('${sys.slug}','${esc(sys.label)}')">
                       ${ic('plus',13)} Skapa AO</button>`
                  : ''}
              </div>
              ${this._techCatHistory(propId, sys.slug)}
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="card">
        <div class="card-header">
          <h3>${ic('clipboard-check',14)} Besiktningar & lagstadgade krav</h3>
          ${Auth.can('customer_manage')
            ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openEditInsp()">${ic('pencil',13)}</button>`
            : ''}
        </div>
        <div class="card-body" id="prop-insp-body">
          ${this._renderInspections(insp)}
        </div>
      </div>
    `;
  },

  _renderTechSystem(key, t, fields) {
    if (!fields || !fields.length) {
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
      if (t._value) return `<div class="dr"><span class="dk">Info</span><span class="dv" style="white-space:pre-wrap;">${esc(t._value)}</span></div>`;
      const entries = Object.entries(t).filter(([,v]) => v);
      if (!entries.length) return `<p style="font-size:12px;color:var(--mt);">Ingen information registrerad</p>`;
      return entries.map(([k,v]) =>
        `<div class="dr"><span class="dk">${labels[k]||cap(k)}</span><span class="dv" style="white-space:pre-wrap;">${esc(String(v))}</span></div>`
      ).join('');
    }
    if (t._value) return `<div class="dr"><span class="dk">Info</span><span class="dv" style="white-space:pre-wrap;">${esc(t._value)}</span></div>`;
    const activeFields = fields.filter(f => f.active !== false).sort((a,b) => (a.order||99)-(b.order||99));
    const entries = activeFields.filter(f => t[f.key] !== undefined && t[f.key] !== null && t[f.key] !== '');
    if (!entries.length) return `<p style="font-size:12px;color:var(--mt);">Ingen information registrerad</p>`;
    return entries.map(f => {
      const displayed = this._displayFieldValue(f.type, t[f.key]);
      return `<div class="dr"><span class="dk">${esc(f.label)}</span><span class="dv">${displayed}</span></div>`;
    }).join('');
  },

  _displayFieldValue(type, v) {
    if (v === undefined || v === null || v === '') return '—';
    const s = String(v);
    switch (type) {
      case 'date':
        return fmtDate(s) || esc(s);
      case 'boolean':
        return (s === 'true' || s === '1') ? 'Ja' : 'Nej';
      case 'link':
        return `<a href="${esc(s)}" target="_blank" rel="noopener" style="color:var(--sky);word-break:break-all;">${esc(s)}</a>`;
      case 'phone':
        return `<a href="tel:${esc(s)}" style="color:var(--sky);">${esc(s)}</a>`;
      case 'email':
        return `<a href="mailto:${esc(s)}" style="color:var(--sky);">${esc(s)}</a>`;
      case 'textarea':
      case 'comment':
        return `<span style="white-space:pre-wrap;">${esc(s)}</span>`;
      default:
        return esc(s);
    }
  },

  _buildFieldInput(f, val) {
    const id   = `tech-dyn-${f.key}`;
    const v    = val !== undefined && val !== null ? String(val) : '';
    const ev   = esc(v);
    const opts = f.options || [];
    switch (f.type) {
      case 'textarea':
      case 'comment':
        return `<textarea id="${id}" rows="3" placeholder="${esc(f.placeholder||f.label||'')}">${esc(v)}</textarea>`;
      case 'date':
        return `<input type="date" id="${id}" value="${ev}">`;
      case 'number':
        return `<input type="number" id="${id}" value="${ev}" placeholder="0">`;
      case 'boolean':
        return `<select id="${id}">
          <option value="">— Ej angett —</option>
          <option value="true" ${v==='true'?'selected':''}>Ja</option>
          <option value="false" ${v==='false'?'selected':''}>Nej</option>
        </select>`;
      case 'dropdown':
      case 'status':
        if (opts.length) {
          return `<select id="${id}">
            <option value="">— Välj —</option>
            ${opts.map(o => `<option value="${esc(o)}" ${v===o?'selected':''}>${esc(o)}</option>`).join('')}
          </select>`;
        }
        return `<input type="text" id="${id}" value="${ev}" placeholder="Inga val definierade ännu">`;
      case 'interval':
        const stdIntervals = ['Dagligen','Veckovis','Månadsvis','Kvartalsvis','Halvårsvis','Årsvis','Vartannat år','Vart 3:e år','Vart 5:e år','Vid behov'];
        const allIntervals = [...stdIntervals, ...opts.filter(o => !stdIntervals.includes(o))];
        return `<select id="${id}">
          <option value="">— Välj —</option>
          ${allIntervals.map(o => `<option value="${esc(o)}" ${v===o?'selected':''}>${esc(o)}</option>`).join('')}
        </select>`;
      case 'link':
        return `<input type="url" id="${id}" value="${ev}" placeholder="https://...">`;
      case 'phone':
        return `<input type="tel" id="${id}" value="${ev}" placeholder="070-XXX XX XX">`;
      case 'email':
        return `<input type="email" id="${id}" value="${ev}" placeholder="namn@exempel.se">`;
      default:
        return `<input type="text" id="${id}" value="${ev}" placeholder="${esc(f.placeholder||'')}">`;
    }
  },

  _toggleAcc(id) {
    const row = document.getElementById(id);
    if (row) row.classList.toggle('open');
  },

  _techCatHistory(propId, catSlug) {
    if (!propId || !catSlug) return '';
    const allAOs = (state.workOrders||[]).filter(a =>
      a.propertyId === propId &&
      a.technicalCategorySlug === catSlug &&
      !a.deleted
    );
    if (!allAOs.length) return '';

    const isOpen = a => !['klar','fakturerad','avbruten'].includes(a.status);
    const open   = allAOs.filter(isOpen) .sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    const closed = allAOs.filter(a => !isOpen(a)).sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    const sorted = [...open, ...closed];

    const rows = sorted.map(ao => `
      <div class="crow" style="padding:7px 0;" onclick="Router.showPage('pg-ao-detail',{aoId:'${ao.id}'})">
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:700;line-height:1.3;">${esc(ao.title)}</div>
          <div style="font-size:10px;color:var(--mt);">${fmtDate(ao.scheduledDate||ao.createdAt)}</div>
        </div>
        <div style="flex-shrink:0;">${sbdg(ao.status)}</div>
      </div>`).join('');

    return `
      <details style="margin-top:10px;">
        <summary style="font-size:11px;font-weight:700;color:var(--mt);cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px;padding:4px 0;user-select:none;">
          ${ic('clock',11)} Tidigare arbetsorder
          <span class="bdg ${open.length?'bdg-blue':'bdg-grey'}" style="font-size:9px;">${allAOs.length}</span>
        </summary>
        <div style="margin-top:4px;border-top:1px solid var(--bg);">${rows}</div>
      </details>`;
  },

  _buildTechDesc(p, catSlug, catLabel, catFields) {
    const lines = [];
    lines.push(`Tekniskt område: ${catLabel}`);
    lines.push(`Fastighet: ${p.name||'—'}`);
    const cityLine = [p.zip, p.city].filter(Boolean).join(' ');
    const addr = [p.address, cityLine].filter(Boolean).join(', ');
    if (addr) lines.push(`Adress: ${addr}`);

    const rawT = (p.technicalSystems||{})[catSlug];
    if (rawT) {
      lines.push('');
      lines.push('Teknisk information:');
      if (typeof rawT === 'string') {
        lines.push(`• ${rawT}`);
      } else if (rawT && rawT._value) {
        lines.push(`• ${rawT._value}`);
      } else if (rawT && typeof rawT === 'object') {
        const activeFields = catFields && catFields.length
          ? catFields.filter(f => f.active !== false).sort((a,b) => (a.order||99)-(b.order||99))
          : null;
        const fallback = {
          type:'Systemtyp',manufacturer:'Fabrikat',model:'Modell',location:'Placering',
          serviceInterval:'Serviceintervall',lastService:'Senaste service',comment:'Kommentar',
          mainPanel:'Elcentral',meter:'Elmätare/anl-ID',shutoffLocation:'Huvudavstängning',
          description:'Systembeskrivning',pump:'Pump/Sump',alarmSystem:'Brandlarmsystem',
          lastControl:'Senaste kontroll',nextControl:'Nästa kontroll',filterType:'Filtertyp',
          lastFilterChange:'Senaste filterbyte',fractions:'Fraktioner',supplier:'Leverantör',access:'Åtkomst'
        };
        if (activeFields) {
          activeFields.forEach(f => { const v = rawT[f.key]; if (v) lines.push(`• ${f.label}: ${v}`); });
        } else {
          Object.entries(rawT).forEach(([k,v]) => { if (v) lines.push(`• ${fallback[k]||cap(k)}: ${v}`); });
        }
      }
    }
    return lines.join('\n');
  },

  openCreateAOFromTech(catSlug, catLabel) {
    if (!Auth.require('ao_create')) return;
    const p = getObj(this.propId);
    if (!p) return;

    const cu      = p.customerId ? getCu(p.customerId) : null;
    const cuName  = cu ? CustomerService.displayName(cu) : null;
    const dynCat  = (state.propertyCategories||[]).find(c => c.slug === catSlug);
    const catFields = dynCat ? (dynCat.fields||[]) : [];
    const addr    = p.address || '';
    const desc    = this._buildTechDesc(p, catSlug, catLabel, catFields);

    const warnings = [];
    if (!p.customerId || !cu) warnings.push('Fastigheten har ingen kopplad kund — lägg till kund efteråt i redigera-vyn.');
    if (!addr)              warnings.push('Fastigheten saknar adress — fyll i manuellt nedan.');

    Modal.open({
      title: `${ic('clipboard-list',14)} Skapa AO — ${esc(catLabel)}`,
      wide: true,
      body: `
        <div class="nbox" style="margin-bottom:10px;font-size:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          ${ic('building-2',12)} <strong>${esc(p.name)}</strong>
          ${cuName ? `· ${ic('user',11)} ${esc(cuName)}` : ''}
          · ${ic('settings',11)} ${esc(catLabel)}
        </div>
        ${warnings.map(w=>`<div class="nbox" style="margin-bottom:8px;font-size:11px;background:#fef9c3;border-left-color:#ca8a04;">${ic('alert-triangle',11)} ${esc(w)}</div>`).join('')}
        <div class="fg">
          <label>Rubrik</label>
          <input id="act-title" value="${esc(catLabel)} – service/kontroll">
        </div>
        <div class="g2">
          <div class="fg"><label>Datum</label>
            <input type="date" id="act-date" value="">
          </div>
          <div class="fg"><label>Prioritet</label>
            <select id="act-prio">
              <option value="normal" selected>Normal</option>
              <option value="hög">Hög</option>
              <option value="akut">Akut</option>
              <option value="låg">Låg</option>
            </select>
          </div>
        </div>
        <div class="fg">
          <label>Adress</label>
          <input id="act-addr" value="${esc(addr)}" placeholder="Fastighetens adress">
        </div>
        <div class="fg">
          <label>Beskrivning</label>
          <textarea id="act-desc" rows="8">${esc(desc)}</textarea>
        </div>`,
      buttons: [
        { label: 'Skapa AO', cls: 'btn bsu', onClick: () => {
          const title = document.getElementById('act-title')?.value.trim();
          if (!title) { showToast('Rubrik krävs'); return; }
          const ao = WorkOrderService.create({
            title,
            description:            document.getElementById('act-desc')?.value.trim() || '',
            customerId:             p.customerId || '',
            propertyId:             p.id,
            address:                document.getElementById('act-addr')?.value.trim() || addr,
            status:                 'nytt',
            priority:               document.getElementById('act-prio')?.value || 'normal',
            scheduledDate:          document.getElementById('act-date')?.value || '',
            category:               '',
            technicalCategorySlug:  catSlug,
            technicalCategoryLabel: catLabel,
            materials: [], notes: [], log: [], timeEntries: [], checklist: []
          });
          Modal.close();
          showToast(`${ao.id} skapad — ${esc(catLabel)}`);
          // Live-uppdatera teknik-fliken utan omladdning
          const freshProp = getObj(p.id);
          if (freshProp) {
            const tabEl = document.getElementById('prop-tab-tech');
            if (tabEl) {
              tabEl.innerHTML = this._renderTechTab(freshProp.technicalSystems||{}, freshProp.inspections||{});
              setTimeout(() => {
                const accEl = document.getElementById(`prop-acc-${catSlug}`);
                if (accEl && !accEl.classList.contains('open')) accEl.classList.add('open');
              }, 60);
            }
          }
          Sidebar.updateBadges();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
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
          <h3>${ic('clipboard-list',14)} Arbetsorder <span class="ft-n">${aos.length}</span></h3>
          ${Auth.can('ao_create')
            ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openCreateAO()">${ic('plus',13)} Ny AO</button>`
            : ''}
        </div>
        <div class="card-body">
          ${aos.length === 0
            ? `<div class="empty" style="padding:16px 0;">${ic('clipboard-list',28)}<p style="font-size:12px;color:var(--mt);">Inga arbetsorder kopplade till denna fastighet</p></div>`
            : aos.map(ao => `
              <div class="crow" role="button" tabindex="0" onclick="Router.showPage('pg-ao-detail',{aoId:'${esc(ao.id)}'})" onkeydown="if(event.key==='Enter')this.click()">
                <div style="flex:1;min-width:0;">
                  <div class="crow-title">${esc(ao.title)}</div>
                  <div class="crow-sub">${esc(ao.id)} · ${esc(fmtDate(ao.scheduledDate||ao.createdAt))}</div>
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
          <h3>${ic('repeat',14)} Återkommande ärenden <span class="ft-n">${recs.length}</span></h3>
        </div>
        <div class="card-body">
          ${recs.length === 0
            ? `<p style="font-size:12px;color:var(--mt);padding:4px 0;">Inga återkommande ärenden kopplade till denna fastighet</p>`
            : recs.map(r => `
              <div class="crow" onclick="Router.showPage('pg-recurring')">
                <div style="flex:1;min-width:0;">
                  <div class="crow-title">${esc(r.title)}</div>
                  <div class="crow-sub">${esc(r.frequencyLabel||r.frequency||'')}</div>
                </div>
                <span class="bdg st bdg-${r.active!==false?'green':'grey'}"><span class="st-dot"></span>${r.active!==false?'Aktiv':'Pausad'}</span>
              </div>`).join('')}
        </div>
      </div>
    `;
  },

  /* ── Tab: Bilder (Supabase Storage) ───────────────────── */

  _renderImagesTab(p) {
    return `
      <div class="card" id="prop-images-card">
        <div class="card-header">
          <h3>${ic('image',14)} Bilder</h3>
          ${Auth.can('customer_manage')
            ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openAddImage()">${ic('plus',13)} Lägg till</button>`
            : ''}
        </div>
        <div class="card-body" id="prop-images-container">
          <div style="text-align:center;padding:24px 0;color:var(--mt);">${ic('loader',18)} Laddar bilder…</div>
        </div>
      </div>`;
  },

  async _loadImages(propId) {
    const container = document.getElementById('prop-images-container');
    const card      = document.getElementById('prop-images-card');
    if (!container) return;
    try {
      const images = await PropertyImageService.list(propId);
      this._cachedImages = images;
      /* Update tab counter */
      /* (Tidigare skrev detta över flik nr 7 — "Återkommande" — med
         "Bilder (N)". Antalet visas nu i kortets rubrik.) */
      /* Update card header count */
      const h3 = card?.querySelector('h3');
      if (h3) h3.innerHTML = `${ic('image',14)} Bilder${images.length ? ` (${images.length})` : ''}`;

      container.innerHTML = images.length === 0
        ? `<div style="text-align:center;padding:32px 0;">
            <div style="color:var(--mt);margin-bottom:12px;">${ic('image',36)}</div>
            <div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:6px;">Inga bilder ännu</div>
            <p style="font-size:12px;color:var(--mt);margin:0 0 16px;line-height:1.5;">
              Lägg till bilder på entré, teknikrum, undercentral, garage m.m.<br>
              Bilderna sparas i molnet och syns för alla inloggade användare.
            </p>
            ${Auth.can('customer_manage')
              ? `<button class="btn bp bsm" onclick="PropertyDetailPage.openAddImage()">${ic('plus',13)} Lägg till bild</button>`
              : ''}
          </div>`
        : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;">
            ${images.map((img, i) => `
              <div style="border-radius:8px;overflow:hidden;border:1px solid var(--br);cursor:pointer;background:#fff;"
                onclick="PropertyDetailPage.viewImage(${i})">
                <div style="position:relative;">
                  <img src="${esc(img.signedUrl)}" alt="${esc(img.title||'')}"
                    loading="lazy"
                    style="width:100%;height:90px;object-fit:cover;display:block;">
                  ${img.category ? `<span class="img-cat-badge">${esc(img.category)}</span>` : ''}
                </div>
                <div style="padding:5px 7px;font-size:10px;font-weight:700;color:var(--navy);
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(img.title||'Bild')}</div>
              </div>`).join('')}
          </div>`;
    } catch(e) {
      container.innerHTML = `<div class="ibox" style="color:var(--rd);">${ic('alert-circle',13)} Kunde inte ladda bilder: ${esc(e.message)}</div>`;
    }
  },

  /* ── Tab: Rondering ───────────────────────────────────── */

  _renderRonderingTabContent(p) {
    // Hämta ronderingar kopplade till fastigheten (via propertyId eller customerId)
    const ronderingar = (state.ronderingar||[]).filter(function(r) {
      return r.propertyId === p.id || r.customerId === p.customerId;
    }).sort(function(a,b) { return new Date(b.createdAt)-new Date(a.createdAt); });

    // Hämta PASS kopplade till fastigheten (direkt eller via rondering)
    const ronIds = new Set(ronderingar.map(r=>r.id));
    const passes = (state.ronderingspass||[]).filter(function(pass) {
      return pass.propertyId === p.id || ronIds.has(pass.ronderingId);
    }).sort(function(a,b) {
      const da = a.scheduledDate||a.createdAt||'';
      const db = b.scheduledDate||b.createdAt||'';
      return db.localeCompare(da);
    });

    const avvikelser = (state.avvikelser||[]).filter(function(a) {
      return a.propertyId === p.id || (a.ronderingId && ronIds.has(a.ronderingId));
    });
    const openAvv = avvikelser.filter(function(a){ return a.status==='öppen'; });

    const passStatusBadge = function(s) {
      const cls = {planerat:'bdg-blue',pågående:'bdg-orange',slutfört:'bdg-green',har_avvikelser:'bdg-red'}[s]||'bdg-grey';
      const lbl = {planerat:'Planerat',pågående:'Pågående',slutfört:'Slutfört',har_avvikelser:'Har anmärkningar'}[s]||s;
      return `<span class="bdg ${cls}">${esc(lbl)}</span>`;
    };

    // KPI-rad: senaste 30 dagar
    const recent = passes.filter(function(p){ return p.completedAt && p.completedAt > new Date(Date.now()-30*86400000).toISOString(); });
    const totalAnm = avvikelser.filter(function(a){ return a.status==='öppen'; }).length;
    const totalAO  = avvikelser.filter(function(a){ return a.workOrderId; }).length;

    return `
      <div class="mx-sec-head">
        <h3 class="mx-sec-h">${ic('clipboard-check',14)} Ronderingshistorik</h3>
        <button class="btn bp bsm" onclick="RonderingPage.openNewRonderingFromProperty('${esc(p.customerId||'')}','${esc(p.id)}')">${ic('plus',13)} Ny rondering</button>
      </div>

      ${ronderingar.length > 0 ? `
      <div class="mx-kpis mx-kpis-3" style="margin-bottom:12px;">
        <div class="mx-kpi"><span class="mx-kpi-n">${passes.length}</span><span class="mx-kpi-l">Tillfällen</span></div>
        <div class="mx-kpi ${totalAnm ? 'tone-danger' : ''}"><span class="mx-kpi-n">${totalAnm}</span><span class="mx-kpi-l">Öppna anmärkningar</span></div>
        <div class="mx-kpi ${totalAO ? 'tone-ok' : ''}"><span class="mx-kpi-n">${totalAO}</span><span class="mx-kpi-l">AO skapade</span></div>
      </div>` : ''}

      ${passes.length === 0
        ? `<div class="ibox">Inga ronderingstillfällen kopplade till denna fastighet ännu.</div>`
        : passes.slice(0, 15).map(function(pass) {
            const ron  = getRon(pass.ronderingId);
            const ronName = ron ? (ron.name||ron.templateName||pass.ronderingId) : pass.ronderingId;
            const stats = RonderingService.getPassStats(pass.id);
            const pct = stats && stats.total > 0 ? Math.round(stats.checked/stats.total*100) : 0;
            const staffNames = (pass.staffIds||[]).map(function(sid){
              const s = getStaff(sid);
              return s ? (s.firstName+' '+s.lastName).trim() : sid;
            }).filter(Boolean).join(', ');
            const isLegacy = pass.migratedFromLegacy;
            const openFn = (pass.status==='slutfört'||pass.status==='har_avvikelser')
              ? `Router.showPage('pg-rondering-rapport',{passId:'${pass.id}'})`
              : `Router.showPage('pg-rondering-utfor',{passId:'${pass.id}'})`;
            return `
              <div class="list-item" onclick="${openFn}" style="margin-bottom:4px;">
                <div class="item-row" style="gap:8px;">
                  <div style="width:24px;height:24px;background:var(--bg);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:var(--navy);flex-shrink:0;">#${pass.sequenceNumber||1}</div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(ronName)}</div>
                    <div style="font-size:11px;color:var(--mt);display:flex;gap:6px;flex-wrap:wrap;margin-top:1px;">
                      ${pass.scheduledDate?`<span>${fmtDate(pass.scheduledDate)}</span>`:''}
                      ${staffNames?`<span>${ic('user',11)} ${esc(staffNames)}</span>`:''}
                      ${stats&&stats.total>0?`<span>${ic('check-circle',10)} ${stats.checked}/${stats.total}</span>`:''}
                      ${stats&&stats.anmärkningar>0?`<span style="color:var(--danger);">${ic('alert-triangle',11)} ${stats.anmärkningar}</span>`:''}
                      ${isLegacy?`<span style="color:var(--mt);">(historisk)</span>`:''}
                    </div>
                    ${stats&&stats.total>0&&pass.status!=='planerat'?`
                      <div style="background:var(--line);border-radius:3px;height:3px;margin-top:4px;overflow:hidden;">
                        <div style="background:${stats.anmärkningar>0?'var(--danger)':'var(--ok)'};width:${pct}%;height:3px;border-radius:3px;"></div>
                      </div>`:''}
                  </div>
                  ${passStatusBadge(pass.status)}
                </div>
              </div>`;
          }).join('')
      }

      ${ronderingar.length > 0 ? `
        <div style="margin-top:6px;text-align:center;">
          <button class="btn bs bsm" onclick="Router.showPage('pg-rondering',{ronId:'${ronderingar[0].id}'})">
            Visa i ronderingsvy ${ic('arrow-right',11)}
          </button>
        </div>` : ''}

      ${openAvv.length > 0 ? `
        <div style="margin-top:16px;font-weight:700;font-size:13px;margin-bottom:8px;">${ic('alert-triangle',13)} Öppna anmärkningar (${openAvv.length})</div>
        ${openAvv.slice(0,8).map(function(avv){ return `
          <div class="list-item" style="margin-bottom:4px;">
            <div class="item-row">
              <div style="flex:1;min-width:0;">
                <div class="item-title">${esc(avv.title)}</div>
                <div class="item-sub">${esc(avv.categoryName||'')} · ${fmtDate(avv.createdAt)}</div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
                ${pbdg(avv.priority)}
                ${avv.workOrderId?`<span class="bdg bdg-green" style="font-size:9px;cursor:pointer;" onclick="event.stopPropagation();Router.showPage('pg-ao-detail',{aoId:'${avv.workOrderId}'})">${ic('clipboard',9)} AO</span>`:''}
              </div>
            </div>
          </div>`;}).join('')}` : ''}`;
  },

  /* ── Tab: Anteckningar ─────────────────────────────────── */

  _renderNotesTab(notes) {
    return `
      <div class="card">
        <div class="card-header">
          <h3>${ic('file-text',14)} Anteckningar <span class="ft-n">${notes.length}</span></h3>
          ${Auth.can('customer_manage')
            ? `<button class="btn bs bxs" onclick="PropertyDetailPage.openAddNote()">${ic('plus',13)} Lägg till</button>`
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
        <div style="font-size:12px;line-height:1.5;color:var(--tx);white-space:pre-wrap;">${esc(n.text)}</div>
        <div style="font-size:10px;color:var(--mt);margin-top:4px;">${esc(n.createdBy||'Okänd')} · ${esc(relDate(n.createdAt))}</div>
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
    /* P1-2 (fix round 2026-11-16): accessCode/keyInformation live only in
       property_sensitive_access (via the EF), never on `p`/`prefill` — the
       inputs below are rendered disabled/empty and only unlocked once
       _loadSensitiveForEdit() has actually fetched the real current values.
       This replaces the old bug where the form silently "pre-filled" from
       fields that never existed on the property object, so editing just
       one of the two sensitive fields sent the OTHER as an empty string
       and the server correctly-but-destructively nulled it. */
    this._sensState = null;
    Modal.open({
      title: p ? `Redigera: ${esc(p.name)}` : 'Redigera fastighet',
      wide: true,
      body: this._formHtml(data),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => this._saveBasic() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('prop-name')?.focus(), 80);
    if (p && p.id) this._loadSensitiveForEdit(p.id);
  },

  /* P1-2: fetch the real current accessCode/keyInformation for the edit
     form. Unlocks the two inputs with their true current values only on a
     definite 2xx — on ANY other outcome (network error, non-2xx, missing
     jwt) the inputs stay disabled and empty, so a failed read can never be
     followed by a save that wipes a field the user never actually saw.

     P1-2 CORRECTION (2026-11-16, round 2): an independent review found a
     genuine race — this only checked that the DOM elements still exist,
     not that they still belong to the SAME request/property. If property
     A's modal is closed and property B's edit modal is opened (REUSING
     the same #prop-access/#prop-keyinfo ids — Modal always renders the
     same ids), A's fetch resolving late could write A's accessCode into
     B's now-open form. Guarded now with a monotonic request token
     (bumped on every call, so any earlier in-flight call becomes stale
     the moment a new one starts) AND an explicit propertyId check against
     the page's current property — BOTH must still match before touching
     the DOM or `_sensState`. */
  async _loadSensitiveForEdit(propertyId) {
    const myToken = (this._sensReqToken = (this._sensReqToken || 0) + 1);
    const stillCurrent = () => this._sensReqToken === myToken && this.propId === propertyId;
    const statusEl = () => document.getElementById('prop-sens-status');
    const accessEl = () => document.getElementById('prop-access');
    const keyEl    = () => document.getElementById('prop-keyinfo');
    const jwt = (typeof Auth !== 'undefined' && Auth.getAccessToken) ? Auth.getAccessToken() : null;
    if (!jwt) {
      if (stillCurrent() && statusEl()) statusEl().innerHTML = `<span style="color:var(--rd);">${ic('alert-triangle',11)} Inte inloggad — portkod/nyckelinformation kan inte redigeras i denna omgång.</span>`;
      return;
    }
    try {
      const res = await fetch(SUPABASE_URL + '/functions/v1/get-sensitive-fields', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      // A newer request for the same or a different property has already
      // started (or the user navigated away) while this one was in
      // flight — this answer is stale and must NEVER be applied, even
      // though the DOM elements themselves may still exist (reused ids).
      if (!stillCurrent()) return;
      if (!accessEl() || !keyEl()) return;
      const accessCode     = d.accessCode || '';
      const keyInformation = d.keyInformation || '';
      this._sensState = { status: 'ok', accessCode, keyInformation };
      accessEl().value = accessCode; accessEl().disabled = false; accessEl().placeholder = 'T.ex. 1234#';
      keyEl().value    = keyInformation; keyEl().disabled = false; keyEl().placeholder = 'T.ex. Nyckelskåp 9876, Aptus-tagg...';
      if (statusEl()) statusEl().remove();
    } catch (e) {
      if (!stillCurrent()) return;
      this._sensState = { status: 'error' };
      if (statusEl()) statusEl().innerHTML = `<span style="color:var(--rd);">${ic('alert-triangle',11)} Kunde inte läsa in aktuell portkod/nyckelinformation — fälten är låsta denna omgång för att inte skriva över okänt innehåll.</span> <button type="button" class="btn bxs bs" onclick="PropertyDetailPage._loadSensitiveForEdit('${propertyId}')">Försök igen</button>`;
    }
  },

  _formHtml(p) {
    /* P0-1 (fix round 2026-11-16, round 3): every value="${v(...)}" below
       is an HTML ATTRIBUTE interpolation, a different, equally real
       injection vector from the text-node XSS already fixed elsewhere —
       a stored value containing a `"` could close the attribute early
       and inject arbitrary markup/event handlers. Escaping once, here,
       inside v() itself, protects every call site below without having
       to touch each of the ~20 individual inputs. Safe for the
       comparison call sites too (e.g. v('type')===t): `t` is always one
       of this function's own hardcoded constants (never containing `<`,
       `>`, `&`, `"`), so escaping the stored value never changes the
       comparison's outcome. */
    const v = (k, d='') => {
      const val = p ? (p[k] != null ? p[k] : d) : d;
      return typeof val === 'string' ? esc(val) : val;
    };
    const types = ['Flerbostadshus','Kontorsfastighet','Industrifastighet','BRF','Villa','Butiksfastighet','Lager','Övrigt'];
    const mgmtTypes = ['Teknisk förvaltning','Ekonomisk förvaltning','Full förvaltning','Egen förvaltning','Tillsynsavtal'];
    const activeStaff = (state.staff||[]).filter(s => s.active!==false);
    const staffOpts = id => activeStaff.map(s =>
      `<option value="${s.id}" ${v(id)===s.id?'selected':''}>${esc(s.firstName)} ${esc(s.lastName)}</option>`
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
        <div class="fg" style="flex:1;margin-bottom:0;"><label>Kund / ägare</label>${CustomerPicker.render('prop-cu', { value: v('customerId'), placeholder: '— Välj kund —' })}</div>
        <button class="btn bs bsm" style="flex-shrink:0;white-space:nowrap;"
          onclick="PropertyDetailPage._createCustomerFromForm()">${ic('plus',13)} Ny kund</button>
      </div>

      <div style="font-size:11px;font-weight:800;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px;">Adress</div>
      <div class="fg"><label>Gatuadress</label>
        <input id="prop-addr" value="${v('address')}" placeholder="Börja skriva adress…"
          autocomplete="off"
          oninput="AddressService.handleInput(this)"
          onblur="setTimeout(()=>AddressService.hideSuggestions(),150)"
          data-addr-zip="prop-zip" data-addr-city="prop-city"></div>
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
      <div id="prop-sens-status" style="font-size:12px;color:var(--mt);margin-bottom:6px;">${ic('loader',11)} Läser in aktuella portkod/nyckeluppgifter…</div>
      <div class="g2">
        <div class="fg"><label>Portkod</label>
          <input id="prop-access" value="" placeholder="Läser in…" disabled></div>
        <div class="fg"><label>Status</label>
          <select id="prop-status">
            <option value="aktiv"   ${v('status','aktiv')==='aktiv'   ?'selected':''}>Aktiv</option>
            <option value="inaktiv" ${v('status')==='inaktiv'?'selected':''}>Inaktiv</option>
          </select></div>
      </div>
      <div class="fg"><label>Nyckelinformation / passagesystem</label>
        <input id="prop-keyinfo" value="" placeholder="Läser in…" disabled></div>
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
      status:            document.getElementById('prop-status')?.value          || 'aktiv',
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

  async _saveBasic() {
    const data = this._captureFormState();
    if (!data.name) { showToast('Namn krävs'); return; }
    const idx = (state.properties||[]).findIndex(x => x.id === this.propId);
    if (idx < 0) return;
    // Känsliga fält sparas via EF, ej i state. P1-2 (2026-11-16): skicka
    // ENDAST de fält användaren faktiskt ändrat jämfört med vad som
    // verkligen lästes in (this._sensState) — ett orört fält utelämnas helt
    // ur body, ett avsiktligt tömt fält skickas som tom sträng (servern
    // tolkar det som en medveten radering, se sensitive_fields_write), och
    // om inläsningen misslyckades (status !== 'ok') skickas INGET av dem,
    // eftersom inputen då var låst och inte kan ha ändrats av användaren.
    const sens = this._sensState;
    const sensBody = { propertyId: this.propId };
    let sensDirty = false;
    if (sens && sens.status === 'ok') {
      const accessNow = (document.getElementById('prop-access')?.value || '').trim();
      const keyNow     = (document.getElementById('prop-keyinfo')?.value || '').trim();
      if (accessNow !== (sens.accessCode || '')) { sensBody.accessCode = accessNow; sensDirty = true; }
      if (keyNow !== (sens.keyInformation || '')) { sensBody.keyInformation = keyNow; sensDirty = true; }
    }
    state.properties[idx] = Object.assign({}, state.properties[idx], data, { updatedAt: new Date().toISOString() });
    persist();
    const propId = this.propId;
    Modal.close();
    this.render({ propId: propId });
    if (sensDirty) {
      /* I5 (client, 2026-11-12): awaited; success only on a real 2xx
         {ok:true}; on failure a retry dialog keeps what was typed. */
      const r = await this._saveSensitiveFields(sensBody);
      if (!r.ok) {
        const fields = [];
        if ('accessCode' in sensBody) fields.push({ key: 'accessCode', label: 'Portkod' });
        if ('keyInformation' in sensBody) fields.push({ key: 'keyInformation', label: 'Nyckelinformation' });
        this._openSensitiveRetry('Fastigheten sparades — portkod/nyckelinformation gjorde det INTE', r, sensBody, fields);
        return;
      }
    }
    showToast('Fastighet uppdaterad');
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
    Modal.close();
    /* G12: framgång först efter serverns bekräftelse (confirmPersist). */
    const _rr = () => { const p = getObj(this.propId); const el = document.getElementById('prop-contacts'); if (p && el) el.innerHTML = this._renderContacts(p.contacts || []); };
    _rr();
    return confirmPersist('properties', prop.id, { ok: idx !== null ? 'Kontaktperson uppdaterad' : 'Kontaktperson tillagd', fail: 'Kontaktpersonen kunde inte sparas', onChange: _rr });
  },

  removeContact(idx) {
    const prop = getObj(this.propId);
    if (!prop || !prop.contacts) return;
    prop.contacts.splice(idx, 1);
    const _rr = () => { const p = getObj(this.propId); const el = document.getElementById('prop-contacts'); if (p && el) el.innerHTML = this._renderContacts(p.contacts || []); };
    _rr();
    return confirmPersist('properties', prop.id, { ok: 'Kontaktperson borttagen', fail: 'Kontaktpersonen kunde inte tas bort', onChange: _rr });
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
    const rawT = (p.technicalSystems||{})[key];
    const t = (rawT && typeof rawT === 'object' && !rawT._value) ? rawT : {};
    const legacyVal = rawT && typeof rawT === 'string' ? rawT : (rawT && rawT._value ? rawT._value : '');

    const dynCat = (state.propertyCategories||[]).find(c => c.slug === key);
    const dynFields = dynCat && (dynCat.fields||[]).length
      ? dynCat.fields.filter(f => f.active !== false).sort((a,b)=>(a.order||99)-(b.order||99))
      : null;

    if (dynFields) {
      const legacyNote = legacyVal
        ? `<div class="nbox" style="margin-bottom:8px;font-size:11px;">${ic('info',11)} Äldre fritext finns lagrad: <em>${esc(legacyVal)}</em> — spara för att migrera till strukturerad data.</div>`
        : '';
      Modal.open({
        title: `${ic(dynCat.icon||'folder',14)} ${dynCat.label}`,
        wide: true,
        body: legacyNote + dynFields.map(f => `
          <div class="fg">
            <label>${esc(f.label)}${f.required ? ' <span style="color:var(--rd);">*</span>' : ''}</label>
            ${this._buildFieldInput(f, t[f.key])}
          </div>`).join(''),
        buttons: [
          { label: 'Spara', cls: 'btn bp', onClick: () => this._saveTechSystemDyn(key, dynFields) },
          { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
        ]
      });
    } else {
      const cfgs = this._techSystemConfig();
      const cfg = cfgs[key] || cfgs.other;
      Modal.open({
        title: cfg.label,
        wide: true,
        body: cfg.fields.map(f =>
          f.textarea
            ? `<div class="fg"><label>${esc(f.label)}</label>
                 <textarea id="tech-${f.id}" rows="3" placeholder="${f.ph}">${esc(t[f.id]||legacyVal||'')}</textarea></div>`
            : `<div class="fg"><label>${esc(f.label)}</label>
                 <input id="tech-${f.id}" value="${esc(t[f.id]||'')}" placeholder="${f.ph}"></div>`
        ).join(''),
        buttons: [
          { label: 'Spara', cls: 'btn bp', onClick: () => this._saveTechSystem(key, cfg.fields) },
          { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
        ]
      });
    }
  },

  _saveTechSystemDyn(key, fields) {
    const prop = getObj(this.propId);
    if (!prop) return;
    if (!prop.technicalSystems) prop.technicalSystems = {};
    const existing = (prop.technicalSystems[key] && typeof prop.technicalSystems[key] === 'object' && !prop.technicalSystems[key]._value)
      ? prop.technicalSystems[key] : {};
    const t = Object.assign({}, existing);
    fields.forEach(f => {
      const el  = document.getElementById(`tech-dyn-${f.key}`);
      if (!el) return;
      const val = el.tagName === 'SELECT' ? el.value : (el.value || '').trim();
      if (val) t[f.key] = val;
      else delete t[f.key];
    });
    prop.technicalSystems[key] = t;
    Modal.close();
    return this._confirmTech(prop.id, 'Teknisk info sparad', 'Teknisk info kunde inte sparas');
  },

  /* G12: gemensam bekräftad sparning för teknik-/besiktningsfliken. */
  _confirmTech(propId, ok, fail) {
    const _rr = () => {
      const p = getObj(propId); if (!p) return;
      const tabEl = document.getElementById('prop-tab-tech');
      if (tabEl) tabEl.innerHTML = this._renderTechTab(p.technicalSystems || {}, p.inspections || {});
      const ov = document.getElementById('prop-tab-overview');
      if (ov) ov.innerHTML = this._renderOverview(p, p.inspections || {}, p.serviceIntervals || []);
    };
    _rr();
    return confirmPersist('properties', propId, { ok, fail, onChange: _rr });
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
    Modal.close();
    return this._confirmTech(prop.id, 'Teknisk info sparad', 'Teknisk info kunde inte sparas');
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
            <div style="font-size:12px;font-weight:700;color:var(--navy);margin-bottom:6px;">${esc(t.label)}</div>
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
    Modal.close();
    return this._confirmTech(prop.id, 'Besiktningar sparade', 'Besiktningarna kunde inte sparas');
  },

  /* ── Bilder (Supabase Storage) ────────────────────────── */

  _cachedImages: [],   /* Cache för aktuell fastighets bilder */

  openAddImage() {
    Modal.open({
      title: `${ic('image',14)} Lägg till bild`,
      body: `
        <div class="fg"><label>Rubrik <span style="color:var(--rd)">*</span></label>
          <input id="img-title" placeholder="T.ex. Undercentral, Entré port A…"></div>
        <div class="g2">
          <div class="fg"><label>Kategori</label>
            <select id="img-cat">
              <option value="">— Valfritt —</option>
              ${['Fasad','Entré','Teknik','Garage','Tvättstuga','Utemiljö','Skada/problem','Övrigt'].map(c=>`<option>${c}</option>`).join('')}
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
          <input type="file" id="img-file" accept="image/*,image/heic,image/heif"
            onchange="PropertyDetailPage._previewImage(this)"></div>
        <div id="img-preview" style="margin-top:8px;"></div>
        <div style="font-size:11px;color:var(--mt);margin-top:8px;">${ic('lock',10)} Privat lagring — kräver inloggning för visning.</div>`,
      buttons: [
        { label: `${ic('upload',13)} Ladda upp`, cls: 'btn bp', onClick: () => this._saveImage() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('img-title')?.focus(), 80);
  },

  _previewImage(input) {
    const file = input.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const prev = document.getElementById('img-preview');
    if (prev) prev.innerHTML =
      `<img src="${url}" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:contain;">`;
  },

  async _saveImage() {
    const title = document.getElementById('img-title')?.value.trim();
    if (!title) { showToast('Rubrik krävs'); return; }
    const file = document.getElementById('img-file')?.files[0];
    if (!file) { showToast('Välj en bild'); return; }

    const saveBtn = document.querySelector('.modal-footer .btn.bp');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = ic('loader',13) + ' Laddar upp…'; }

    try {
      await PropertyImageService.upload(this.propId, file, {
        title,
        category:    document.getElementById('img-cat')?.value    || '',
        techSection: document.getElementById('img-section')?.value || '',
        description: document.getElementById('img-desc')?.value.trim() || ''
      });
      Modal.close();
      showToast('Bild uppladdad');
      await this._loadImages(this.propId);
    } catch(e) {
      showToast('Fel: ' + e.message);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = ic('upload',13) + ' Ladda upp'; }
    }
  },

  viewImage(idx) {
    const img = this._cachedImages[idx];
    if (!img) return;
    Modal.open({
      title: esc(img.title || 'Bild'),
      body: `
        <div style="text-align:center;">
          <img src="${esc(img.signedUrl)}" alt="${esc(img.title||'')}"
            style="max-width:100%;max-height:60vh;border-radius:8px;object-fit:contain;">
          ${img.description  ? `<p style="font-size:13px;margin-top:10px;">${esc(img.description)}</p>` : ''}
          <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:8px;">
            ${img.category    ? `<span style="font-size:11px;color:var(--mt);">${ic('tag',10)} ${esc(img.category)}</span>` : ''}
            ${img.tech_section? `<span style="font-size:11px;color:var(--mt);">${ic('settings',10)} ${img.tech_section}</span>` : ''}
          </div>
        </div>`,
      buttons: [
        { label: `${ic('trash',13)} Ta bort`, cls: 'btn bd', onClick: () => this._removeImage(img.id, img.storage_path) },
        { label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  async _removeImage(id, storagePath) {
    Modal.confirm('Ta bort bilden permanent från Supabase?', async () => {
      try {
        await PropertyImageService.remove(id, storagePath);
        showToast('Bild borttagen');
        await this._loadImages(this.propId);
      } catch(e) {
        showToast('Fel: ' + e.message);
      }
    });
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
    Modal.close();
    const _rr = () => { const p = getObj(this.propId); const el = document.getElementById('prop-notes'); if (p && el) el.innerHTML = this._renderNotes(p.notes || []); };
    _rr();
    return confirmPersist('properties', prop.id, { ok: 'Anteckning sparad', fail: 'Anteckningen kunde inte sparas', onChange: _rr });
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
  },

  /* ── Fler åtgärder (action sheet) ─────────────────────── */

  openFlerAtgarder(propId) {
    Modal.open({
      title: 'Fler åtgärder',
      body: `
        <ul class="action-sheet-list">
          <li><button class="action-sheet-btn" onclick="Modal.close();PropertyDetailPage.openCopyProperty()">
            ${ic('copy',16)} Kopiera fastighet
          </button></li>
        </ul>`,
      buttons: [{ label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }]
    });
  },

  /* ── Kopiera fastighet ─────────────────────────────────── */

  openCopyProperty() {
    const p = getObj(this.propId);
    if (!p) return;
    const contactCount = (p.contacts||[]).length;
    const noteCount    = (p.notes||[]).length;
    const techKeys     = Object.keys(p.technicalSystems||{}).filter(k => Object.values(p.technicalSystems[k]||{}).some(Boolean));
    const techSummary  = techKeys.length ? techKeys.length + ' system ifyllda' : 'inga ifyllda';
    const inspKeys     = Object.keys(p.inspections||{}).filter(k => Object.values(p.inspections[k]||{}).some(Boolean));

    Modal.open({
      title: `${ic('copy',14)} Kopiera fastighet`,
      body: `
        <div style="background:var(--bg);border-radius:8px;padding:12px;margin-bottom:12px;">
          <div style="font-size:12px;font-weight:700;color:var(--navy);margin-bottom:4px;">Ny fastighet skapas</div>
          <div style="font-size:12px;color:var(--mt);">Namn: <strong style="color:var(--navy);">Kopia av ${esc(p.name)}</strong></div>
          <div style="font-size:11px;color:var(--mt);margin-top:4px;">Grunddata (adress, typ, kund, ytor, förvaltning, åtkomst) kopieras alltid.</div>
        </div>

        <div style="font-size:11px;font-weight:800;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Välj vad som inkluderas</div>

        <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--bg);cursor:pointer;">
          <input type="checkbox" id="copy-tech" checked style="margin-top:2px;flex-shrink:0;">
          <div>
            <div style="font-size:13px;font-weight:600;">Tekniska system</div>
            <div style="font-size:11px;color:var(--mt);">${techSummary} · Värme, Ventilation, El, Vatten, SBA m.m.</div>
          </div>
        </label>

        <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--bg);cursor:pointer;">
          <input type="checkbox" id="copy-contacts" ${contactCount > 0 ? 'checked' : ''} style="margin-top:2px;flex-shrink:0;">
          <div>
            <div style="font-size:13px;font-weight:600;">Kontaktpersoner</div>
            <div style="font-size:11px;color:var(--mt);">${contactCount > 0 ? contactCount + ' person' + (contactCount>1?'er':'') : 'Inga registrerade'}</div>
          </div>
        </label>

        <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--bg);cursor:pointer;">
          <input type="checkbox" id="copy-insp" style="margin-top:2px;flex-shrink:0;">
          <div>
            <div style="font-size:13px;font-weight:600;">Besiktningsdata</div>
            <div style="font-size:11px;color:var(--mt);">${inspKeys.length > 0 ? inspKeys.length + ' besiktning(ar) registrerade' : 'Inga registrerade'} · OVK, SBA, Hiss m.m.</div>
          </div>
        </label>

        <label style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;cursor:pointer;">
          <input type="checkbox" id="copy-notes" style="margin-top:2px;flex-shrink:0;">
          <div>
            <div style="font-size:13px;font-weight:600;">Anteckningar</div>
            <div style="font-size:11px;color:var(--mt);">${noteCount > 0 ? noteCount + ' anteckning(ar)' : 'Inga registrerade'}</div>
          </div>
        </label>

        <div style="margin-top:10px;padding:10px;background:var(--bg);border-radius:8px;">
          <div style="font-size:11px;color:var(--mt);font-weight:700;margin-bottom:4px;">Inkluderas aldrig</div>
          <div style="font-size:11px;color:var(--mt);">Bilder · Arbetsorder · Återkommande ärenden · Historik</div>
        </div>`,
      buttons: [
        { label: `${ic('copy',13)} Skapa kopia`, cls: 'btn bp', onClick: () => this._executeCopy() },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _executeCopy() {
    if (!Auth.can('customer_manage')) { showToast('Du saknar behörighet'); return; }
    const p = getObj(this.propId);
    if (!p) return;

    const opts = {
      tech:      document.getElementById('copy-tech')?.checked     ?? true,
      contacts:  document.getElementById('copy-contacts')?.checked ?? false,
      insp:      document.getElementById('copy-insp')?.checked     ?? false,
      notes:     document.getElementById('copy-notes')?.checked    ?? false,
    };

    /* Deep clone — strips by reference cleanly */
    const src = JSON.parse(JSON.stringify(p));

    const copy = {
      /* Basic data — always copied */
      id:                   newSafeId('OBJ', state.properties), // K3 (2026-11-12): collision-safe
      name:                 'Kopia av ' + p.name,
      customerId:           src.customerId           || '',
      address:              src.address              || '',
      zip:                  src.zip                  || '',
      city:                 src.city                 || '',
      type:                 src.type                 || '',
      group:                src.group                || '',
      operationalArea:      src.operationalArea      || '',
      propertyDesignation:  src.propertyDesignation  || '',
      buildYear:            src.buildYear            || '',
      renovationYear:       src.renovationYear       || '',
      buildingCount:        src.buildingCount        || 1,
      floors:               src.floors               || 0,
      apartments:           src.apartments           || 0,
      area:                 src.area                 || 0,
      boa:                  src.boa                  || 0,
      loa:                  src.loa                  || 0,
      bta:                  src.bta                  || 0,
      lotArea:              src.lotArea              || 0,
      managementType:       src.managementType       || '',
      propertyManager:      src.propertyManager      || '',
      technician:           src.technician           || '',
      accessCode:           '',
      keyInfo:              '',
      note:                 src.note                 || '',
      objectNumber:         '',        /* cleared — varje fastighet har unikt objektnummer */
      status:               'aktiv',
      createdAt:            new Date().toISOString(),
      updatedAt:            new Date().toISOString(),

      /* Optionals */
      technicalSystems:     opts.tech     ? (src.technicalSystems || {}) : {},
      contacts:             opts.contacts ? (src.contacts          || []) : [],
      inspections:          opts.insp     ? (src.inspections        || {}) : {},
      notes:                opts.notes    ? (src.notes              || []) : [],

      /* Always empty — these are separate records indexed by propertyId */
      images: [],
    };

    state.properties = state.properties || [];
    copy.shortNumber = newShortNumber(copy.id, state.properties); // display number (2026-11-12), never copied from the source
    state.properties.push(copy);
    Modal.close();
    /* G12: öppna kopian först när servern bekräftat den. */
    return confirmPersist('properties', copy.id, { ok: 'Fastighet kopierad', fail: 'Kopian kunde inte sparas',
      onSaved: () => setTimeout(() => Router.showPage('pg-obj-detail', { propId: copy.id }), 300) });
  }
};


/**
 * MxUi — gemensamt sidhuvud för detaljsidorna i arbetsblock "övriga sidor"
 * (Fastighetskort, Objekt, Kundkort, Projektkort). V3 2026-11-26, F-10.
 * Tillbaka + rubrik (+ nummer/status) på en rad, en primär åtgärd synlig,
 * övriga åtgärder i "⋮" (på dator visas åtgärder märkta inline som knappar).
 * Stilar: src/styles/v3-misc.css (.mx-dh-*). Menyn använder den delade
 * aoToggleOverflow/aoCloseOverflow (state.js: Escape, klick utanför).
 *
 * o.title och o.sub/o.badges ska vara färdig, escapad HTML. primary/actions[].onclick är
 * betrodd JS-sträng för onclick (byggd av anroparen med esc() på data).
 */
const MxUi = {
  detailHead(o) {
    const acts = (o.actions || []).filter(Boolean);
    const menuId = o.menuId || 'mx-dh-menu';
    const inline = acts.filter(a => a.inline).map(a =>
      `<button type="button" class="btn bs bsm mx-only-d" onclick="${a.onclick}">${ic(a.icon, 14)} ${esc(a.label)}</button>`).join('');
    /* Komponentstandard §3: destruktiva poster sist, avskilda och röda
       (bekräftelsen ligger i respektive åtgärd). */
    const ordered = acts.filter(a => !a.destructive).concat(acts.filter(a => a.destructive));
    const firstDestr = ordered.findIndex(a => a.destructive);
    const items = ordered.map((a, i) =>
      (i > 0 && i === firstDestr ? '<div class="ao-overflow-divider" role="separator"></div>' : '') +
      `<button type="button" class="ao-overflow-menu-item${a.destructive ? ' ao-overflow-menu-item--red' : ''}${a.inline ? ' mx-only-m' : ''}" role="menuitem" onclick="aoCloseOverflow();${a.onclick}">${ic(a.icon, 14)} ${esc(a.label)}</button>`).join('');
    const onlyInline = acts.length > 0 && acts.every(a => a.inline);
    const more = acts.length ? `
      <div class="ao-overflow-wrap mx-dh-more-wrap${onlyInline ? ' mx-hide-d' : ''}">
        <button type="button" class="ibtn mx-dh-more" id="${menuId}-btn" aria-label="Fler åtgärder" title="Fler åtgärder" aria-haspopup="menu" aria-expanded="false" onclick="aoToggleOverflow('${menuId}',this)">${ic('more-horizontal', 16)}</button>
        <div class="ao-overflow-menu" id="${menuId}" role="menu">${items}</div>
      </div>` : '';
    const p = o.primary;
    const primary = p ? `<button type="button" class="btn ${p.cls || 'bp'} bsm mx-dh-primary" onclick="${p.onclick}">${ic(p.icon || 'plus', 14)} ${esc(p.label)}</button>` : '';
    const badges = o.badges || '';
    return `
      <header class="mx-dh${badges ? '' : ' no-row2'}">
        <button type="button" class="btn bs bsm mx-dh-back" onclick="${o.back || 'Router.back()'}" aria-label="Tillbaka">${ic('arrow-left', 15)}<span class="mx-dh-back-l">Tillbaka</span></button>
        <div class="mx-dh-tt">
          <h2 class="mx-dh-title">${o.title}</h2>
          ${o.sub ? `<div class="mx-dh-sub">${o.sub}</div>` : ''}
        </div>
        <div class="mx-dh-badges">${badges}</div>
        <div class="mx-dh-acts">${inline}${primary}${more}</div>
      </header>`;
  }
};
