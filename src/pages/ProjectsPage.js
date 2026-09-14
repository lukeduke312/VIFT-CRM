/**
 * ProjectsPage — V54A Projektlista
 *
 * Lista/filtrering/skapa/redigera/arkivera för Projekt. V54A innehåller
 * INGA barn-relationer (AO/Offert/Uppgift/Faktura) — se ProjectService.js
 * och RAPPORT-V54-PROJEKT-DISCOVERY.md. Radkorten visar därför MEDVETET
 * inga AO-/uppgifts-/ekonomi-räknare — de skulle vara påhittade siffror
 * så länge inga barn-relationer finns (V54B/C/D).
 */
const ProjectsPage = {

  _filter: { status: '', responsibleUserId: '', customerId: '', propertyId: '', archived: false, search: '' },
  _tempCustomerId: '',

  /* V54C1 R1 — Part A: filterräkningens semantik (§A5/Filter Polish 1),
     KORRIGERAD så att koden faktiskt matchar det ursprungligen avtalade
     kontraktet (R0-rapporten påstod detta men koden gjorde det INTE —
     "Alla" var tidigare en fast räknare precis som statuscheckarna):
       - varje NAMNGIVEN status-chip (Planerad/Pågående/...) visar antalet
         ICKE-arkiverade projekt i den statusen, OAVSETT sekundärfilter/
         sökning — en fast kategori-räknare, exakt som Uppgifter-sidans
         etablerade, orörda statuschips.
       - "Alla"-chippet = alla ICKE-arkiverade projekt som matchar de
         AKTIVA sekundärfiltren (Ansvarig/Kund/Fastighet) OCH sökningen —
         dvs samma urval som raderna nedan visar när inget status-chip
         är valt. Detta är den enda räknaren som reagerar på sekundär-
         filter/sökning; namngivna statuschips gör det aldrig.
       - "Arkiverade"-chippet visar antalet arkiverade projekt totalt —
         en EGEN vy (archived=true), inte en delmängd av "Alla".
     Se test R1-#20 för verifiering att "Alla" faktiskt ändras när Kund-
     eller sökfiltret ändras, till skillnad från de namngivna statuscheckarna. */
  render() {
    const el = document.getElementById('pg-projects-content');
    if (!el) return;

    const f = this._filter;
    const base = f.archived ? ProjectService.getArchived() : ProjectService.getActive();
    let list = base;
    if (f.status)            list = list.filter(p => p.status === f.status);
    if (f.responsibleUserId) list = list.filter(p => p.responsibleUserId === f.responsibleUserId);
    if (f.customerId)        list = list.filter(p => p.customerId === f.customerId);
    if (f.propertyId)        list = list.filter(p => p.propertyId === f.propertyId);
    list = ProjectService.search(list, f.search);
    list = list.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    const activeAll = ProjectService.getActive();
    const archivedAll = ProjectService.getArchived();
    /* "Alla" = icke-arkiverade projekt som matchar de AKTIVA sekundär-
       filtren + sökningen — se filhuvud-kommentaren ovan. Namngivna
       statuschips nedan använder MEDVETET `activeAll` (fast räknare). */
    const secondaryFilteredActive = activeAll.filter(p =>
      (!f.responsibleUserId || p.responsibleUserId === f.responsibleUserId) &&
      (!f.customerId        || p.customerId        === f.customerId) &&
      (!f.propertyId         || p.propertyId         === f.propertyId)
    );
    const allCount = ProjectService.search(secondaryFilteredActive, f.search).length;
    const statusChips = [{ key: '', label: 'Alla' }].concat(PROJECT_STATUSES).map(s => {
      const count = s.key ? activeAll.filter(p => p.status === s.key).length : allCount;
      return `<button class="filter-panel-chip ${!f.archived && f.status === s.key ? 'on' : ''}" data-status="${esc(s.key)}" onclick="ProjectsPage.setFilter('status','${esc(s.key)}')">${esc(s.label)} <span class="qf-cnt">${count}</span></button>`;
    }).join('');

    const responsibleOpts = [{ id: '', label: 'Alla ansvariga' }].concat(
      (state.staff || []).filter(s => s.active).map(s => ({ id: s.id, label: (s.firstName + ' ' + s.lastName).trim() }))
    ).map(o => `<option value="${esc(o.id)}" ${f.responsibleUserId === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('');

    /* V54C1 — Part A2: en enorm nativ <select> med varje kund byts mot
       den REDAN BEFINTLIGA, sökbara `CustomerPicker` (samma komponent
       som redan används i skapa/redigera-formuläret ovan i denna fil)
       — ingen ny sökbar-väljare-implementation skapas. */
    const propertyPool = f.customerId ? (state.properties || []).filter(p => p.customerId === f.customerId) : (state.properties || []);
    const propertyOpts = [{ id: '', label: f.customerId ? 'Alla fastigheter (denna kund)' : 'Alla fastigheter' }].concat(
      propertyPool.map(p => ({ id: p.id, label: p.name || p.address || p.id }))
    ).map(o => `<option value="${esc(o.id)}" ${f.propertyId === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('');

    const anyFilterActive = !!(f.status || f.responsibleUserId || f.customerId || f.propertyId || f.search || f.archived);

    const rows = list.length === 0
      ? `<div class="empty" style="padding:32px 0;gap:6px;">${ic('folder', 22)}<p style="font-size:12px;color:var(--mt);">Inga projekt matchar filtret.</p></div>`
      : list.map(p => this._rowHtml(p)).join('');

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
        <div>
          <h1 style="font-size:19px;font-weight:800;margin:0;">Projekt</h1>
          <div style="font-size:12px;color:var(--mt);margin-top:2px;">${list.length} ${list.length === 1 ? 'projekt' : 'projekt'}</div>
        </div>
        <button class="btn bp bsm" onclick="ProjectsPage.openCreate()">${ic('plus', 13)} Nytt projekt</button>
      </div>

      <div class="fg" style="margin-bottom:8px;">
        <input type="search" placeholder="Sök projekt, PRJ-id, kund, fastighet…" value="${esc(f.search)}"
          oninput="ProjectsPage.setFilter('search', this.value)"
          style="width:100%;font-size:13px;padding:8px 12px;border:1px solid var(--br);border-radius:8px;background:var(--bg);color:var(--tx);">
      </div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">${statusChips}
        <button class="filter-panel-chip ${f.archived ? 'on' : ''}" onclick="ProjectsPage.setFilter('archived', ${!f.archived})">${ic('archive', 11)} Arkiverade <span class="qf-cnt">${archivedAll.length}</span></button>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">
        <select onchange="ProjectsPage.setFilter('responsibleUserId', this.value)" style="flex:1 1 180px;min-width:150px;font-size:12px;padding:7px 9px;border:1px solid var(--br);border-radius:6px;background:var(--bg);color:var(--tx);">${responsibleOpts}</select>
        <div style="flex:1 1 180px;min-width:150px;">
          ${CustomerPicker.render('proj-filter-cu', { value: f.customerId || '', placeholder: 'Alla kunder', onchange: 'ProjectsPage._filterCustomerChanged()' })}
        </div>
        <select onchange="ProjectsPage.setFilter('propertyId', this.value)" style="flex:1 1 180px;min-width:150px;font-size:12px;padding:7px 9px;border:1px solid var(--br);border-radius:6px;background:var(--bg);color:var(--tx);">${propertyOpts}</select>
        ${anyFilterActive ? `<button class="btn bs bxs" onclick="ProjectsPage.clearFilters()">${ic('x', 12)} Rensa filter</button>` : ''}
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;">${rows}</div>
    `;
  },

  /* Kundfiltret ändrat: Fastighet-filtret rensas om det pekade på en
     fastighet hos en ANNAN kund — samma envägsregel som redan gäller i
     skapa/redigera-formuläret (§A3, "changing Customer must clear an
     incompatible Property filter"). */
  _filterCustomerChanged() {
    const cuId = document.getElementById('proj-filter-cu')?.value || '';
    this._filter.customerId = cuId;
    if (this._filter.propertyId) {
      const prop = getObj(this._filter.propertyId);
      if (!prop || prop.customerId !== cuId) this._filter.propertyId = '';
    }
    this.render();
  },

  clearFilters() {
    this._filter = { status: '', responsibleUserId: '', customerId: '', propertyId: '', archived: false, search: '' };
    this.render();
  },

  _rowHtml(p) {
    const cu   = getCu(p.customerId);
    const prop = p.propertyId ? getObj(p.propertyId) : null;
    const resp = p.responsibleUserId ? getStaff(p.responsibleUserId) : null;
    const sm   = this._statusMeta(p.status);
    const dateRange = (p.startDate || p.endDate)
      ? `${p.startDate ? fmtDate(p.startDate) : '?'} – ${p.endDate ? fmtDate(p.endDate) : '?'}`
      : '';
    return `<div class="card" style="cursor:pointer;" onclick="Router.showPage('pg-project-detail',{projectId:'${esc(p.id)}'})">
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px;">
            <span style="font-size:13px;font-weight:700;color:var(--navy);">${esc(p.name || 'Namnlöst projekt')}</span>
            <span class="bdg bdg-grey" style="font-size:10px;">${esc(p.id)}</span>
            <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${sm.color}22;color:${sm.color};border:1px solid ${sm.color}44;">${esc(sm.label)}</span>
            ${p.archived ? `<span class="bdg bdg-grey" style="font-size:10px;">${ic('archive', 9)} Arkiverad</span>` : ''}
          </div>
          <div style="font-size:11px;color:var(--mt);">
            ${cu ? esc(CustomerService.displayName(cu)) : '—'}${prop ? ' · ' + esc(prop.name || prop.address || prop.id) : ''}${resp ? ' · ' + esc((resp.firstName + ' ' + resp.lastName).trim()) : ''}
          </div>
        </div>
        ${dateRange ? `<div style="font-size:11px;color:var(--mt);flex-shrink:0;">${esc(dateRange)}</div>` : ''}
      </div>
    </div>`;
  },

  _statusMeta(status) {
    const colors = { planerad: 'var(--sky)', 'pågående': 'var(--gr)', pausad: 'var(--or)', klar: 'var(--blue)', avslutad: 'var(--mt)' };
    return { label: ProjectService.statusLabel(status), color: colors[status] || 'var(--mt)' };
  },

  /* V54C1 R1 — Filter Polish 2: status och arkiverad är ÖMSESIDIGT
     uteslutande, aldrig en dold kombination. Att välja en namngiven
     status återgår alltid till aktiva projekt (archived=false); att slå
     på Arkiverade rensar alltid ett eventuellt valt status-chip (ingen
     "archived=true + status=planerad"-kombination kan uppstå). */
  setFilter(key, val) {
    if (key === 'status') {
      this._filter.status = val;
      this._filter.archived = false;
    } else if (key === 'archived') {
      this._filter.archived = val;
      if (val) this._filter.status = '';
    } else {
      this._filter[key] = val;
    }
    if (key === 'customerId') this._filter.propertyId = '';
    this.render();
  },

  /* ── Skapa/redigera ───────────────────────────────────────────── */

  openCreate() {
    this._openForm(null);
  },

  openEdit(id) {
    this._openForm(id);
  },

  _propertyOptionsHtml(customerId, selectedId) {
    const props = customerId ? (state.properties || []).filter(p => p.customerId === customerId) : [];
    let html = `<option value="">— Ingen fastighet (valfritt) —</option>`;
    html += props.map(p => `<option value="${esc(p.id)}" ${selectedId === p.id ? 'selected' : ''}>${esc(p.name || p.address || p.id)}</option>`).join('');
    return html;
  },

  /* V54A R1 — blockerare 2: en uppgifts-/projekt-ansvarig som senare
     inaktiveras fick tidigare inte plats i listan alls — en nativ
     <select> utan sin valda option faller tyst tillbaka till "tomt",
     och en efterföljande sparning (t.ex. bara ett notering-fält
     ändrat) skrev då bort den befintliga tilldelningen helt.
     `allowInactiveSelected` (bara satt vid REDIGERING, aldrig vid
     skapande) lägger till EXAKT den redan tilldelade personen om den
     är inaktiv — tydligt märkt "(inaktiv)" — utan att göra inaktiv
     personal i allmänhet valbar för NYA tilldelningar. */
  _staffOptionsHtml(selectedId, allowInactiveSelected) {
    const activeStaff = (state.staff || []).filter(s => s.active);
    let inactiveAssigned = null;
    if (allowInactiveSelected && selectedId) {
      const assigned = getStaff(selectedId);
      if (assigned && !assigned.active) inactiveAssigned = assigned;
    }
    let html = `<option value="">— Ej tilldelad —</option>`;
    html += activeStaff.map(s => `<option value="${esc(s.id)}" ${selectedId === s.id ? 'selected' : ''}>${esc((s.firstName + ' ' + s.lastName).trim())}</option>`).join('');
    if (inactiveAssigned) {
      html += `<option value="${esc(inactiveAssigned.id)}" selected>${esc((inactiveAssigned.firstName + ' ' + inactiveAssigned.lastName).trim())} (inaktiv)</option>`;
    }
    return html;
  },

  _openForm(id) {
    const proj   = id ? ProjectService.getById(id) : null;
    const isEdit = !!proj;
    const v = (field, def) => proj ? (proj[field] ?? def) : (def ?? '');

    this._tempCustomerId = v('customerId', '');

    Modal.open({
      title: isEdit ? 'Redigera projekt' : 'Nytt projekt',
      body: `
        <div class="fg"><label>Namn <span style="color:var(--rd)">*</span></label>
          <input id="prj-name" value="${esc(v('name', ''))}" placeholder="T.ex. Renovering tak – Södra Vägen 4"></div>

        <div class="fg"><label>Kund <span style="color:var(--rd)">*</span></label>
          ${CustomerPicker.render('prj-cu', { value: this._tempCustomerId, placeholder: '— Välj kund —', onchange: 'ProjectsPage._customerChangedInForm()' })}
        </div>

        <div class="g2">
          <div class="fg"><label>Fastighet (valfritt)</label>
            <select id="prj-prop">${this._propertyOptionsHtml(this._tempCustomerId, v('propertyId', ''))}</select></div>
          <div class="fg"><label>Ansvarig</label>
            <select id="prj-resp">${this._staffOptionsHtml(v('responsibleUserId', ''), isEdit)}</select></div>
        </div>

        <div class="fg" style="margin-top:2px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;font-weight:400;">
            <input type="checkbox" id="prj-multi" ${v('allowMultiProperty', false) ? 'checked' : ''}>
            Tillåt flera fastigheter i detta projekt
          </label>
        </div>

        <div class="g2">
          <div class="fg"><label>Status</label>
            <select id="prj-status">
              ${PROJECT_STATUSES.map(s => `<option value="${s.key}" ${v('status', 'planerad') === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select></div>
          <div></div>
        </div>

        <div class="g2">
          <div class="fg"><label>Startdatum</label>
            <input type="date" id="prj-start" value="${esc(v('startDate', ''))}"></div>
          <div class="fg"><label>Slutdatum</label>
            <input type="date" id="prj-end" value="${esc(v('endDate', ''))}"></div>
        </div>

        <div class="fg"><label>Beskrivning</label>
          <textarea id="prj-desc" rows="2" placeholder="Vad gäller projektet?">${esc(v('description', ''))}</textarea></div>

        <div class="fg"><label>Intern notering</label>
          <textarea id="prj-note" rows="2" placeholder="Valfri detalj…">${esc(v('note', ''))}</textarea></div>
      `,
      buttons: [
        { label: isEdit ? 'Spara' : 'Skapa projekt', cls: 'btn bp', onClick: () => this._save(id) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });

    setTimeout(() => document.getElementById('prj-name')?.focus(), 80);
  },

  /* Kundbyte filtrerar om Fastighet-väljaren — samma envägs-mönster som
     redan etablerat för Uppgifter (V53B). En kvarhållen fastighet från
     en ANNAN kund får aldrig stå kvar vald. */
  _customerChangedInForm() {
    const cuId = document.getElementById('prj-cu')?.value || '';
    this._tempCustomerId = cuId;
    const propSel = document.getElementById('prj-prop');
    if (propSel) propSel.innerHTML = this._propertyOptionsHtml(cuId, '');
  },

  _save(id) {
    const data = {
      name:               document.getElementById('prj-name')?.value.trim(),
      customerId:         document.getElementById('prj-cu')?.value || '',
      propertyId:         document.getElementById('prj-prop')?.value || '',
      allowMultiProperty: !!document.getElementById('prj-multi')?.checked,
      responsibleUserId:  document.getElementById('prj-resp')?.value || '',
      status:             document.getElementById('prj-status')?.value || 'planerad',
      startDate:          document.getElementById('prj-start')?.value || '',
      endDate:            document.getElementById('prj-end')?.value || '',
      description:        document.getElementById('prj-desc')?.value.trim() || '',
      note:               document.getElementById('prj-note')?.value.trim() || ''
    };

    const result = id ? ProjectService.update(id, data) : ProjectService.create(data);
    if (!result.ok) { showToast(result.error); return; }

    Modal.close();
    showToast(id ? 'Projekt uppdaterat' : 'Projekt skapat');
    if (Router.currentPage === 'pg-project-detail' && Router.currentParams && Router.currentParams.projectId === id) {
      ProjectDetailPage.render({ projectId: id });
    } else {
      this.render();
    }
  },

  /* ── Arkivering ───────────────────────────────────────────────── */

  archive(id) {
    const result = ProjectService.archive(id);
    if (!result.ok) { showToast(result.error); return; }
    showToast('Projekt arkiverat');
    if (Router.currentPage === 'pg-project-detail') {
      ProjectDetailPage.render({ projectId: id });
    } else {
      this.render();
    }
  },

  unarchive(id) {
    const result = ProjectService.unarchive(id);
    if (!result.ok) { showToast(result.error); return; }
    showToast('Projekt återställt');
    if (Router.currentPage === 'pg-project-detail') {
      ProjectDetailPage.render({ projectId: id });
    } else {
      this.render();
    }
  }
};
