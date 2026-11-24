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
 * Sidan är registrerad i AuthService.PAGE_PERMISSIONS ('pg-service-intervals':
 * ['customer_manage']), så Router nekar centralt som för alla andra sidor;
 * kontrollen i render() nedan är kvar som extra skydd vid direktanrop.
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

    let list = this._filtered(SIS);

    /* ── Status-räknare för filter-chips (mot HELA, ofiltrerade listan) ── */
    const counts = { overdue: 0, due_soon: 0, approaching: 0, ok: 0, paused: 0, not_set: 0 };
    all.forEach(x => { if (counts[x.status] !== undefined) counts[x.status]++; });

    const categoriesUsed = SIS.CATEGORIES.filter(c => all.some(x => x.interval.category === c.key));

    const chips = [
      ['all',         'Alla',            all.length,         ''],
      ['overdue',     'Förfallna',       counts.overdue,     'chip-danger'],
      ['due_soon',    'Förfaller snart', counts.due_soon,    ''],
      ['approaching', 'Närmar sig',      counts.approaching, ''],
      ['ok',          'OK',              counts.ok,          ''],
      ['paused',      'Pausade',         counts.paused,      '']
    ];
    /* QA 2026-11-26: sökfältets placeholder innehöll tidigare ic()-SVG INNE i
       attributet, vilket bröt input-taggen (attribut och SVG syntes som text).
       Ikonen är nu ett eget element; placeholder är ren text. Sökningen
       renderar bara om listan (fältet behåller fokus). */
    const filterBar = `
      <div class="si2-toolbar">
        <label class="si2-search">
          ${ic('search', 15)}
          <input type="search" id="si2-q" placeholder="Sök titel, fastighet, ansvarig, leverantör…" value="${esc(f.search || '')}"
            aria-label="Sök serviceintervall" autocomplete="off" oninput="ServiceIntervalsPage._onSearch(this.value)">
        </label>
        <div class="si2-selects">
          <select class="fi" aria-label="Kategori" onchange="ServiceIntervalsPage._fApply({category:this.value})">
            <option value="all" ${f.category === 'all' ? 'selected' : ''}>Alla kategorier</option>
            ${categoriesUsed.map(c => `<option value="${esc(c.key)}" ${f.category === c.key ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select>
          <select class="fi" aria-label="Sortering" onchange="ServiceIntervalsPage._fApply({sort:this.value})">
            <option value="nextDue"  ${f.sort === 'nextDue'  ? 'selected' : ''}>Sortera: nästa förfall</option>
            <option value="name"     ${f.sort === 'name'     ? 'selected' : ''}>Sortera: namn</option>
            <option value="property" ${f.sort === 'property' ? 'selected' : ''}>Sortera: fastighet</option>
          </select>
        </div>
      </div>
      <div class="si2-chips" role="group" aria-label="Filtrera på status">
        ${chips.map(([k, l, n, cls]) => `<button type="button" class="chip ${cls} ${f.status === k ? 'on' : ''}" aria-pressed="${f.status === k}" onclick="ServiceIntervalsPage._fApply({status:'${k}'})">${l}${` <span class="chip-n">${n}</span>`}</button>`).join('')}
      </div>`;

    return `
      <div class="si2">
        ${all.length > 0 ? filterBar : ''}
        <div id="si-overview-list" class="si2-list">${this._renderList(list, all.length, SIS, canManage, canMark)}</div>
      </div>`;
  },

  _renderList(list, total, SIS, canManage, canMark) {
    if (list.length === 0) {
      return `<div class="empty si2-empty">
           ${ic('tool', 28)}
           <h3>${total === 0 ? 'Inga serviceintervall ännu' : 'Inga intervall matchar'}</h3>
           <p>${total === 0 ? 'Serviceintervall läggs till på fastighetskortet under fliken Service.' : 'Ändra sökningen eller statusfiltret för att se fler.'}</p>
         </div>`;
    }
    return `<div class="si2-count" aria-live="polite">Visar ${list.length} av ${total} serviceintervall</div>` +
      list.map(x => this._renderRow(x, SIS, canManage, canMark)).join('');
  },

  _renderRow(x, SIS, canManage, canMark) {
    const si       = x.interval;
    const respS    = si.responsibleStaffId ? (state.staff || []).find(s => s.id === si.responsibleStaffId) : null;
    const respName = respS ? `${respS.firstName} ${respS.lastName}`.trim() : '';
    const cat      = SIS.CATEGORIES.find(c => c.key === si.category);
    const tone     = x.status === 'overdue' ? 'danger' : (x.status === 'due_soon' || x.status === 'approaching') ? 'warn' : x.status === 'paused' ? 'paused' : x.status === 'not_set' ? 'muted' : 'ok';
    const hist     = (si.history || []).length;
    const pid = esc(x.propertyId), sid = esc(si.id);

    return `
      <article class="si2-card si2-${tone}">
        <div class="si2-head">
          <div class="si2-title-wrap">
            <h3 class="si2-title">${esc(si.title)}</h3>
            <div class="si2-sub">
              ${cat ? `<span class="si2-cat">${esc(cat.label)}</span>` : ''}
              <button type="button" class="si2-link" onclick="Router.showPage('pg-obj-detail',{propId:'${pid}'})">${ic('building-2', 13)}<span>${esc(x.propertyName || '—')}</span></button>
            </div>
          </div>
          <div class="si2-status">${SIS.statusBadge(si)}</div>
        </div>
        <dl class="si2-facts">
          <div><dt>Intervall</dt><dd>${esc(SIS.intervalLabel(si))}</dd></div>
          <div><dt>Senast utfört</dt><dd>${si.lastDone ? esc(fmtDate(si.lastDone)) : '—'}</dd></div>
          <div class="si2-next"><dt>Nästa förfall</dt><dd>${si.nextDue ? esc(fmtDate(si.nextDue)) : '—'}${si.nextDue && x.status !== 'ok' && x.status !== 'paused' ? `<span class="si2-rel">${esc(SIS.statusLabel(si))}</span>` : ''}</dd></div>
          <div><dt>Ansvarig</dt><dd>${respName ? esc(respName) : '<span class="si2-none">Ingen</span>'}</dd></div>
          ${si.supplier ? `<div><dt>Leverantör</dt><dd>${esc(si.supplier)}</dd></div>` : ''}
          ${si.autoCreateAO ? `<div><dt>Arbetsorder</dt><dd><span class="bdg bdg-blue">${ic('clipboard-list', 11)} Skapas automatiskt</span></dd></div>` : ''}
        </dl>
        <div class="si2-actions">
          ${canMark && si.active ? `<button type="button" class="btn bp bsm" onclick="ServiceIntervalsPage.markDone('${pid}','${sid}')">${ic('check-circle', 14)} Markera utförd</button>` : ''}
          ${hist > 0 ? `<button type="button" class="btn bs bsm" onclick="PropertyDetailPage.openSIHistory('${pid}','${sid}')">${ic('clock', 14)} Historik (${hist})</button>` : ''}
          ${canManage ? `<button type="button" class="btn bs bsm" onclick="ServiceIntervalsPage.editInterval('${pid}','${sid}')">${ic('pencil', 14)} Redigera</button>` : ''}
          ${canManage ? `<button type="button" class="btn bghost bsm" onclick="ServiceIntervalsPage.togglePaused('${pid}','${sid}')">${ic(si.active ? 'pause-circle' : 'play-circle', 14)} ${si.active ? 'Pausa' : 'Återuppta'}</button>` : ''}
        </div>
      </article>`;
  },

  /* Sök: uppdatera bara listan (behåll fokus i fältet), kort fördröjning. */
  _onSearch(v) {
    this._filter.search = v;
    clearTimeout(this._qT);
    this._qT = setTimeout(() => {
      const host = document.getElementById('si-overview-list');
      if (!host) { this.render(); return; }
      const SIS = ServiceIntervalService;
      const canManage = Auth.can('customer_manage');
      const canMark = canManage || Auth.can('ao_edit');
      host.innerHTML = this._renderList(this._filtered(SIS), SIS.getAllAcrossProperties().length, SIS, canManage, canMark);
    }, 150);
  },

  _filtered(SIS) {
    const f = this._filter;
    let list = SIS.getAllAcrossProperties().slice();
    if (f.status   !== 'all') list = list.filter(x => x.status === f.status);
    if (f.category !== 'all') list = list.filter(x => x.interval.category === f.category);
    const q = (f.search || '').toLowerCase().trim();
    if (q) {
      list = list.filter(x => {
        const resp = x.interval.responsibleStaffId ? (state.staff || []).find(s => s.id === x.interval.responsibleStaffId) : null;
        const respName = resp ? `${resp.firstName} ${resp.lastName}`.trim() : '';
        return ((x.interval.title || '') + ' ' + (x.propertyName || '') + ' ' + respName + ' ' + (x.interval.supplier || '')).toLowerCase().includes(q);
      });
    }
    /* getAllAcrossProperties() är redan sorterad efter nästa förfall. */
    if (f.sort === 'name')          list.sort((a, b) => (a.interval.title || '').localeCompare(b.interval.title || '', 'sv'));
    else if (f.sort === 'property') list.sort((a, b) => (a.propertyName || '').localeCompare(b.propertyName || '', 'sv'));
    return list;
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
