/**
 * ServiceIntervalsPage v1 — Serviceintervall över alla fastigheter
 *
 * Den fastighetsöverskridande översikt som tidigare saknades: service-
 * intervall har hittills bara kunnat hanteras per fastighet (flik i
 * PropertyDetailPage) eller glimtats i Dagens drift (OperationsPage).
 * Denna sida visar/filtrerar/sorterar ALLA fastigheters serviceintervall
 * i en lista, samma mönster som WorkOrdersPage redan gör för arbetsordrar.
 *
 * Återanvänder, duplicerar INTE:
 *   - All data/affärslogik: ServiceIntervalService (status, intervalLabel,
 *     markDone, setPaused, create/update/delete, nextDue-beräkning).
 *   - Alla modalflöden (lägg till, redigera, markera utförd, historik):
 *     anropar PropertyDetailPage.openAddInterval()/openEditInterval()/
 *     openMarkDone()/openSIHistory() direkt — exakt samma modal-HTML,
 *     formulär och valideringslogik som fastighetskortets egen flik,
 *     inte en kopia.
 *   - Samma CSS-klasser (si-card, si-badge, si-filter-bar, si-fchip)
 *     som PropertyDetailPage._renderServiceTab() redan använder — ingen
 *     ny visuell stil uppfanns för denna sida.
 *
 * GRANSKNINGSFYND, rättat som en nödvändig förutsättning för denna sida
 * (se rapporten): PropertyDetailPage.openAddInterval()/openEditInterval()/
 * openMarkDone()/openSIHistory()s modalknappar använde tidigare en
 * icke-fungerande `fn: '...'`-konvention — Modal.open() läser ENDAST
 * `btn.onClick` (en riktig funktionsreferens), aldrig `btn.fn` (en
 * sträng). Dessa knappar gjorde alltså ingenting alls vid klick i den
 * redan driftsatta appen — "Lägg till"/"Redigera"/"Markera utförd" för
 * serviceintervall kunde inte sparas via sina egna Spara-knappar. Rättat
 * till den redan etablerade `onClick: () => ...`-konventionen (samma som
 * 23 andra knappar i samma fil redan använder) — en nödvändig korrigering
 * för att det återanvända flödet denna sida bygger på faktiskt ska
 * fungera, inte en ny, oberoende säkerhetsgranskning.
 * Samma ändring lade till en liten, generisk uppdateringshook i
 * PropertyDetailPage._saveAddInterval()/_saveEditInterval()/
 * _saveMarkDone()/deleteInterval()/toggleSIPaused() — de uppdaterade
 * tidigare BARA #prop-tab-service (som inte finns på denna sida); de
 * kontrollerar nu ÄVEN om #si-overview-list (denna sidas listcontainer)
 * finns och, om så, renderar om den — annars hade en sparad ändring här
 * varit korrekt persisterad men inte synlig förrän sidan laddades om.
 *
 * BEHÖRIGHET: `customer_manage` — samma som fastighetskortets egen
 * Service-flik (där serviceintervall redan hanteras idag) och samma som
 * hela övriga fastighetsregistret ('pg-objects'/'pg-obj-detail' i
 * AuthService.PAGE_PERMISSIONS). En fastighetsöverskridande vy av EXAKT
 * samma data kräver ingen ny, separat behörighet.
 *
 * OBS, medveten avgränsning: behörigheten kontrolleras HÄR, inuti
 * render() nedan — INTE via den centrala AuthService.PAGE_PERMISSIONS-
 * registreringen som alla andra sidor i appen annars använder (se
 * Router.js showPage()/Auth.canViewPage()). AuthService.js ägs av ett
 * annat, samtidigt pågående arbetsspår denna session och ska INTE röras
 * av detta uppdrag. Konsekvens: Router.showPage('pg-service-intervals')
 * nekar INTE åtkomst centralt (Auth.canViewPage() returnerar true för en
 * oregistrerad sida) — sidan visar istället sitt eget "Ingen behörighet"-
 * meddelande nedan. Funktionellt likvärdigt för användaren, men mindre
 * centraliserat än resten av appens sidor. Rekommenderas att lägga till
 * 'pg-service-intervals': ['customer_manage'] i AuthService.
 * PAGE_PERMISSIONS i en framtida, samordnad ändring (ägaren av
 * AuthService.js beslutar), för full konsekvens med hur alla andra
 * sidor gates.
 */
const ServiceIntervalsPage = {

  _filter: { status: 'all', category: 'all', search: '', sort: 'nextDue' },

  render() {
    const el = document.getElementById('pg-service-intervals-content');
    if (!el) return;
    if (typeof Auth === 'undefined' || !Auth.can('customer_manage')) {
      el.innerHTML = `
        <div class="card">
          <div class="card-body" style="padding:16px;display:flex;align-items:center;gap:12px;">
            <div style="font-size:24px;">🔒</div>
            <div>
              <div style="font-weight:800;color:var(--rd);font-size:14px;">Ingen behörighet</div>
              <div style="font-size:12px;color:var(--mt);margin-top:2px;">Du har inte tillgång till Serviceintervall.</div>
            </div>
          </div>
        </div>`;
      return;
    }
    el.innerHTML = this._renderContent();
  },

  _renderContent() {
    const SIS = typeof ServiceIntervalService !== 'undefined' ? ServiceIntervalService : null;
    if (!SIS) return '<div class="empty" style="padding:24px 0;"><h3>ServiceIntervalService saknas</h3></div>';

    const all = SIS.getAllAcrossProperties();
    const f   = this._filter;
    const canManage = typeof Auth !== 'undefined' && Auth.can('customer_manage');
    const canMark   = canManage || (typeof Auth !== 'undefined' && Auth.can('ao_edit'));

    /* ── Filter ───────────────────────────── */
    let list = all.slice();
    if (f.status   !== 'all') list = list.filter(x => x.status === f.status);
    if (f.category !== 'all') list = list.filter(x => x.interval.category === f.category);
    const q = (f.search || '').toLowerCase();
    if (q) {
      list = list.filter(x => {
        const resp = x.interval.responsibleStaffId ? (state.staff || []).find(s => s.id === x.interval.responsibleStaffId) : null;
        const respName = resp ? `${resp.firstName} ${resp.lastName}`.trim() : '';
        return (x.interval.title + ' ' + (x.propertyName || '') + ' ' + respName + ' ' + (x.interval.supplier || '')).toLowerCase().includes(q);
      });
    }

    /* ── Sort ─────────────────────────────── (list är redan sorterad efter
       nästa förfall via getAllAcrossProperties() — bara de två alternativa
       sorteringarna behöver hanteras explicit här) */
    if (f.sort === 'name')     list.sort((a, b) => (a.interval.title   || '').localeCompare(b.interval.title   || '', 'sv'));
    else if (f.sort === 'property') list.sort((a, b) => (a.propertyName || '').localeCompare(b.propertyName || '', 'sv'));

    /* ── Status-räknare för filter-chips (mot HELA, ofiltrerade listan) ── */
    const counts = { overdue: 0, due_soon: 0, approaching: 0, ok: 0, paused: 0, not_set: 0 };
    all.forEach(x => { if (counts[x.status] !== undefined) counts[x.status]++; });

    const categoriesUsed = SIS.CATEGORIES.filter(c => all.some(x => x.interval.category === c.key));

    const filterBar = `
      <div class="si-filter-bar">
        <div style="display:flex;gap:4px;flex-wrap:wrap;flex:1;">
          ${[
            ['all',         'Alla',             all.length],
            ['overdue',     'Förfallna',        counts.overdue],
            ['due_soon',    'Förfaller snart',  counts.due_soon],
            ['approaching', 'Närmar sig',       counts.approaching],
            ['ok',          'OK',               counts.ok],
            ['paused',      'Pausade',          counts.paused]
          ].map(([k, l, n]) => `<button class="si-fchip ${f.status === k ? 'on' : ''}" onclick="ServiceIntervalsPage._fApply({status:'${k}'})">${l}${n > 0 ? ` <span class="si-fchip-cnt">${n}</span>` : ''}</button>`).join('')}
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <input type="text" class="fi" placeholder="${ic('search', 11)} Sök titel, fastighet, ansvarig…" value="${esc(f.search || '')}"
            style="font-size:12px;padding:5px 10px;height:32px;min-width:160px;max-width:220px;"
            oninput="ServiceIntervalsPage._fApply({search:this.value})">
          <select class="fi" style="font-size:12px;padding:5px 8px;height:32px;" onchange="ServiceIntervalsPage._fApply({category:this.value})">
            <option value="all" ${f.category === 'all' ? 'selected' : ''}>Alla kategorier</option>
            ${categoriesUsed.map(c => `<option value="${c.key}" ${f.category === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>
          <select class="fi" style="font-size:12px;padding:5px 8px;height:32px;" onchange="ServiceIntervalsPage._fApply({sort:this.value})">
            <option value="nextDue"  ${f.sort === 'nextDue'  ? 'selected' : ''}>Sorterat efter förfall</option>
            <option value="name"     ${f.sort === 'name'     ? 'selected' : ''}>Sorterat efter namn</option>
            <option value="property" ${f.sort === 'property' ? 'selected' : ''}>Sorterat efter fastighet</option>
          </select>
        </div>
      </div>`;

    const itemsHtml = list.length === 0
      ? `<div class="empty" style="padding:24px 0;">
           ${ic('tool', 28)}
           <p style="font-size:12px;color:var(--mt);margin-top:6px;">${all.length === 0 ? 'Inga serviceintervall registrerade ännu.' : 'Inga intervall matchar filtret.'}</p>
         </div>`
      : list.map(x => this._renderRow(x, SIS, canManage, canMark)).join('');

    return `
      <div class="card">
        <div class="card-header">
          <h3>${ic('tool', 14)} Serviceintervall — alla fastigheter</h3>
        </div>
        <div class="card-body" style="padding-top:8px;">
          ${all.length > 0 ? filterBar : ''}
          <div id="si-overview-list" style="margin-top:${all.length > 0 ? '10' : '0'}px;">${itemsHtml}</div>
        </div>
      </div>`;
  },

  _renderRow(x, SIS, canManage, canMark) {
    const si       = x.interval;
    const respS    = si.responsibleStaffId ? (state.staff || []).find(s => s.id === si.responsibleStaffId) : null;
    const respName = respS ? `${respS.firstName} ${respS.lastName}`.trim() : '';
    const cat      = SIS.CATEGORIES.find(c => c.key === si.category);
    const cardCls  = x.status === 'overdue' ? 'si-card--overdue'
                    : x.status === 'due_soon' ? 'si-card--due-soon'
                    : x.status === 'approaching' ? 'si-card--approaching'
                    : x.status === 'paused' ? 'si-card--paused' : '';
    const nextColor = x.status === 'overdue' ? 'var(--rd)' : (x.status === 'due_soon' || x.status === 'approaching') ? 'var(--or)' : 'inherit';

    return `
      <div class="si-card ${cardCls}">
        <div class="si-card-header">
          <div style="flex:1;min-width:0;">
            <div class="si-card-title">${esc(si.title)}</div>
            <div class="si-card-meta">
              ${cat ? `<span>${cat.label}</span>` : ''}
              <span>${SIS.intervalLabel(si)}</span>
              <span style="cursor:pointer;color:var(--sky);" onclick="Router.showPage('pg-obj-detail',{propId:'${x.propertyId}'})">${ic('building-2', 10)} ${esc(x.propertyName || '—')}</span>
              ${respName ? `<span>${ic('user', 10)} ${esc(respName)}</span>` : ''}
              ${si.supplier ? `<span>${ic('package', 10)} ${esc(si.supplier)}</span>` : ''}
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
              ${si.nextDue && x.status !== 'ok' && x.status !== 'paused' ? ` <span style="font-size:11px;font-weight:400;color:var(--mt);">(${SIS.statusLabel(si)})</span>` : ''}
            </span>
          </div>
          ${si.autoCreateAO ? `<div class="si-info-row"><span class="bdg bdg-blue" style="font-size:10px;">${ic('clipboard-list', 10)} Automatisk AO</span></div>` : ''}
        </div>
        <div class="si-card-actions">
          ${canMark && si.active ? `<button class="btn bp bsm" onclick="ServiceIntervalsPage.markDone('${x.propertyId}','${si.id}')">${ic('check-circle', 13)} Markera utförd</button>` : ''}
          ${(si.history || []).length > 0 ? `<button class="btn bghost bsm" onclick="PropertyDetailPage.openSIHistory('${x.propertyId}','${si.id}')">${ic('clock', 13)} Historik (${si.history.length})</button>` : ''}
          ${canManage ? `<button class="btn bghost bsm" onclick="ServiceIntervalsPage.editInterval('${x.propertyId}','${si.id}')">${ic('pencil', 13)}</button>` : ''}
          ${canManage ? `<button class="btn bghost bsm" title="${si.active ? 'Pausa' : 'Återuppta'}" onclick="ServiceIntervalsPage.togglePaused('${x.propertyId}','${si.id}')">${ic(si.active ? 'pause' : 'play', 13)}</button>` : ''}
        </div>
      </div>`;
  },

  /* ── Filter-state ─────────────────────────────────────────── */
  _fApply(patch) {
    Object.assign(this._filter, patch);
    this.render();
  },

  /* ── Åtgärder — delegerar ALLTID till PropertyDetailPage, öppnar
     SAMMA modaler/formulär. Ingen egen modal-/valideringslogik här. ── */
  markDone(propId, siId)   { PropertyDetailPage.openMarkDone(propId, siId); },
  editInterval(propId, siId) { PropertyDetailPage.openEditInterval(propId, siId); },

  /* togglePaused() är den enda synkrona (ingen modal) mutationen — ingen
     Spara-knapp att vänta på, så vi kan säkert rendera om DENNA sida
     direkt efter anropet (utöver den generiska hook PropertyDetailPage.
     toggleSIPaused() redan fått, som täcker fallet att en ANNAN kod-väg
     råkar anropa den). */
  togglePaused(propId, siId) {
    PropertyDetailPage.toggleSIPaused(propId, siId);
    this.render();
  }
};
