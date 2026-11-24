/**
 * RecurringPage — Återkommande ärenden (omarbetad QA 2026-11-26)
 *
 * Verktygsrad (sök, statusfilter, "+ Nytt ärende"), en kort förklaring av
 * hur arbetsorder skapas, och en lista där nästa tillfälle och läget
 * (aktiv/pausad/avslutad, förfallen/idag/om N dagar) syns direkt. Ärenden
 * som är dags kan skapas direkt från listan. Skapa-, spara- och
 * pausa-flödena går via RecurringOrderService som tidigare.
 */
const RecurringPage = {
  _tempChecklist: [],
  _tempStaff: [],
  _q: '',
  _status: 'alla',   // alla | aktiv | pausad | avslutad
  _due: false,       // snabbval: bara ärenden där det är dags att skapa AO
  _qTimer: null,

  /* F-12: "Om 1 dag" / "Om 3 dagar", "Förfallen sedan 1 dag" / "… 2 dagar". */
  _daysText(days) {
    if (days === null || days === undefined || isNaN(days)) return '';
    if (days === 0) return 'Idag';
    const n = Math.abs(days);
    const unit = n === 1 ? 'dag' : 'dagar';
    return days < 0 ? `Förfallen sedan ${n} ${unit}` : `Om ${n} ${unit}`;
  },

  _isDue(ro) {
    const d = RecurringOrderService.daysUntilNext(ro);
    return ro.status === 'aktiv' && d !== null && d <= 0;
  },

  _matches(ro, q) {
    if (!q) return true;
    const cu = getCu(ro.customerId);
    const hay = [ro.title, cu ? CustomerService.displayName(cu) : '', ro.address, ro.city, RecurringOrderService.intervalLabel(ro.interval)].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
  },

  _filtered() {
    const items = RecurringOrderService.getAll();
    const st = this._status;
    const rank = ro => ro.status === 'aktiv' ? 0 : ro.status === 'pausad' ? 1 : 2;
    return items.filter(ro => this._matches(ro, this._q))
      .filter(ro => (st === 'alla' || ro.status === st) && (!this._due || this._isDue(ro)))
      .sort((a, b) => rank(a) - rank(b) || String(a.nextDate || '9999').localeCompare(String(b.nextDate || '9999')) || String(a.title || '').localeCompare(String(b.title || ''), 'sv'));
  },

  render() {
    const el = document.getElementById('pg-recurring-content');
    if (!el) return;
    const items = RecurringOrderService.getAll();

    if (items.length === 0) {
      el.innerHTML = `<div class="rc">
        <div class="empty rc-empty">${ic('refresh-cw', 30)}<h3>Inga återkommande ärenden</h3>
          <p>Skapa mallar för regelbundet återkommande arbete – t.ex. månadsservice, kvartalskontroll eller veckorondering.</p>
          <button type="button" class="btn bp" onclick="RecurringPage.openCreate()">${ic('plus', 15)} Skapa första ärende</button>
        </div></div>`;
      return;
    }

    el.innerHTML = `<div class="rc">
      <div class="rc-toolbar">
        <label class="rc-search">
          <span class="rc-search-ico" aria-hidden="true">${ic('search', 16)}</span>
          <input type="search" id="rc-q" aria-label="Sök återkommande ärenden" placeholder="Sök titel, kund eller adress" value="${esc(this._q)}" oninput="RecurringPage._onSearch(this.value)" autocomplete="off">
        </label>
        <button type="button" class="btn bp rc-new" onclick="RecurringPage.openCreate()">${ic('plus', 15)} Nytt ärende</button>
      </div>
      <div class="rc-chips" id="rc-chips">${this._chipsHtml()}</div>
      <p class="rc-note">${ic('info', 14)}<span>Arbetsordern skapas när du väljer <b>Skapa AO nu</b> på ett ärende. Nästa datum flyttas då fram med valt intervall. Pausade och avslutade ärenden skapar inga arbetsorder.</span></p>
      <div id="rc-results">${this._listHtml()}</div>
    </div>`;
  },

  _chipsHtml() {
    const items = RecurringOrderService.getAll().filter(ro => this._matches(ro, this._q));
    const n = (k) => k === 'alla' ? items.length : items.filter(ro => ro.status === k).length;
    const dueN = items.filter(ro => this._isDue(ro)).length;
    const st = this._status;
    const c = (k, label, opts) => UiKit.chip(label, `RecurringPage.setStatus('${k}')`, Object.assign({ on: st === k, n: n(k) }, opts || {}));
    /* Snabbval och statusfilter är olika typer — två grupper (komponentstandard §4). */
    return `<div class="rc-chipgrp" role="group" aria-label="Snabbval">${UiKit.chip('Dags att skapa', 'RecurringPage.toggleDue()', { on: this._due, n: dueN, tone: dueN ? 'danger' : '', icon: 'alert-circle' })}</div>
      <div class="rc-chipgrp" role="group" aria-label="Status">${c('alla', 'Alla') + c('aktiv', 'Aktiva') + c('pausad', 'Pausade', { icon: 'pause-circle' }) + c('avslutad', 'Avslutade')}</div>`
      + (st !== 'alla' || this._due || this._q ? `<button type="button" class="btn bghost bsm" onclick="RecurringPage.clearFilters()">${ic('x', 13)} Rensa filter</button>` : '');
  },

  _listHtml() {
    const all = RecurringOrderService.getAll().length;
    const list = this._filtered();
    const count = `<div class="rc-count" id="rc-count">Visar ${list.length} av ${all}</div>`;
    if (!list.length) {
      return count + `<div class="empty rc-empty">${ic('search', 24)}<h3>Inga ärenden matchar</h3><p>Ändra sökningen eller statusfiltret.</p>
        <button type="button" class="btn bs" onclick="RecurringPage.clearFilters()">${ic('x', 14)} Rensa filter</button></div>`;
    }
    return count + `<div class="rc-list">${list.map(ro => this._renderCard(ro)).join('')}</div>`;
  },

  /* Sökningen ritar bara om resultatlistan och chipsen — aldrig fältet (fokus behålls). */
  _onSearch(v) {
    clearTimeout(this._qTimer);
    this._qTimer = setTimeout(() => {
      this._q = String(v || '').trim();
      const r = document.getElementById('rc-results'); if (r) r.innerHTML = this._listHtml();
      const c = document.getElementById('rc-chips'); if (c) c.innerHTML = this._chipsHtml();
    }, 150);
  },

  toggleDue() {
    this._due = !this._due;
    const r = document.getElementById('rc-results'); if (r) r.innerHTML = this._listHtml();
    const c = document.getElementById('rc-chips'); if (c) c.innerHTML = this._chipsHtml();
  },

  setStatus(k) {
    this._status = ['alla', 'aktiv', 'pausad', 'avslutad'].includes(k) ? k : 'alla';
    const r = document.getElementById('rc-results'); if (r) r.innerHTML = this._listHtml();
    const c = document.getElementById('rc-chips'); if (c) c.innerHTML = this._chipsHtml();
  },

  clearFilters() {
    this._q = ''; this._status = 'alla'; this._due = false;
    this.render();
  },

  _statusBadge(ro) {
    if (ro.status === 'pausad') return `<span class="bdg bdg-yellow">${ic('pause-circle', 11)}Pausad</span>`;
    if (ro.status === 'avslutad') return `<span class="bdg bdg-grey">Avslutad</span>`;
    if (ro.status === 'aktiv') return `<span class="bdg bdg-green">${ic('refresh-cw', 11)}Aktiv</span>`;
    return `<span class="bdg bdg-grey">${esc(statusLabel(ro.status))}</span>`;
  },

  _renderCard(ro) {
    const cu = getCu(ro.customerId);
    const days = RecurringOrderService.daysUntilNext(ro);
    const active = ro.status === 'aktiv';
    const isOverdue = active && days !== null && days < 0;
    const isToday = active && days === 0;
    const isSoon = active && days !== null && days > 0 && days <= 7;
    const tone = !active ? 'is-off' : isOverdue ? 'is-late' : isToday ? 'is-due' : isSoon ? 'is-soon' : '';
    const rel = active ? this._daysText(days) : (ro.status === 'pausad' ? 'Pausad – skapar inga arbetsorder' : 'Avslutad');
    const relCls = isOverdue ? 'is-late' : (isToday || isSoon) ? 'is-soon' : !active ? 'is-off' : '';
    const addr = ro.address ? AddressService.formatQuery(ro.address, ro.zip, ro.city, '') : '';
    const canCreateNow = active && days !== null && days <= 0;
    return `
      <article class="rc-item ${tone}" data-ro="${esc(ro.id)}" onclick="RecurringPage.openDetail(this.dataset.ro)">
        <div class="rc-main">
          <h3 class="rc-title"><button type="button" class="rc-open" data-ro="${esc(ro.id)}" onclick="event.stopPropagation();RecurringPage.openDetail(this.dataset.ro)">${esc(ro.title)}</button></h3>
          <div class="rc-sub">
            <span>${ic('user', 12)}<span>${esc(cu ? CustomerService.displayName(cu) : '—')}</span></span>
            <span>${ic('repeat', 12)}<span>${esc(RecurringOrderService.intervalLabel(ro.interval))}${ro.interval === 'eget' && ro.intervalDays ? ' (' + esc(ro.intervalDays) + ' dagar)' : ''}</span></span>
            ${addr ? `<span class="rc-addr">${ic('map-pin', 12)}<span>${esc(addr)}</span></span>` : ''}
          </div>
        </div>
        <dl class="rc-facts">
          <div class="rc-next"><dt>Nästa tillfälle</dt><dd>${ro.nextDate ? esc(fmtDate(ro.nextDate)) : '—'}${rel ? `<span class="rc-rel ${relCls}">${esc(rel)}</span>` : ''}</dd></div>
          ${(ro.staff || []).length ? `<div class="rc-staff"><dt>Personal</dt><dd>${UiKit.avatarStack(ro.staff, 3)}</dd></div>` : ''}
        </dl>
        <div class="rc-side">
          ${this._statusBadge(ro)}
          ${canCreateNow ? `<button type="button" class="btn bs bsm" data-ro="${esc(ro.id)}" onclick="event.stopPropagation();RecurringPage._createAO(this.dataset.ro)">${ic('plus', 13)} Skapa AO nu</button>` : ''}
        </div>
      </article>`;
  },

  openCreate() {
    this._openForm(null);
  },

  /* Pre-fill form from an existing AO to make it recurring */
  openFromAO(aoId) {
    const ao = getAO(aoId);
    if (!ao) return;
    const prefill = {
      title:        ao.title,
      description:  ao.description || '',
      customerId:   ao.customerId || '',
      /* R2.6 §1 (HARD BLOCKER, oberoende reproducerad) — TIDIGARE bar denna
         prefill redan med propertyId, men _openForm()/_save() hade ingen
         plats att spara det vidare — "Gör återkommande" från en
         fastighetslänkad AO tappade tyst kopplingen. propertyId är nu en
         egen, av adressläget OBEROENDE fält (se _openForm()s
         Fastighet-väljare och _save()) — en särskild arbetsadress och en
         fastighetskoppling är INTE ömsesidigt uteslutande. */
      propertyId:   ao.propertyId || '',
      address:      ao.address || '',
      zip:          ao.zip || '',
      city:         ao.city || '',
      /* R2.6 §2 — bär med AO:ns EGEN addressSource ('property'/'customer'/
         'manual', satt av den kanoniska skapande-tids-normaliseraren eller
         av redigera-dialogen) rakt av när den finns. En äldre AO som saknar
         fältet helt lämnas tom här — _openForm()s egen legacy-inferens
         (gatumatchning mot fastighet, sedan kund, R2.6 §4) avgör då läget
         konservativt, istället för att denna funktion gissar fel och tvingar
         fram "annan arbetsadress" för en adress som i själva verket redan
         är fastighetens/kundens. */
      addressSource: ao.addressSource || '',
      category:     ao.category || '',
      priority:     ao.priority || 'normal',
      priceGroupId: ao.priceGroupId || '',
      staff:        (ao.staff || []).slice(),
      checklist:    (ao.checklist || []).map(c => ({ text: c.text, description: c.description || '' }))
    };
    this._openForm(null, prefill);
  },

  openDetail(roId) {
    const ro = RecurringOrderService.getById(roId);
    if (!ro) return;
    const cu = getCu(ro.customerId);
    const prop = ro.propertyId && typeof getObj === 'function' ? getObj(ro.propertyId) : null;
    const days = RecurringOrderService.daysUntilNext(ro);
    const active = ro.status === 'aktiv';
    const chkHtml = (ro.checklist || []).length > 0
      ? `<div class="rc-d-sec"><h4>Checklistemall <span class="bdg bdg-grey">${ro.checklist.length}</span></h4><ul class="rc-chk">${
          ro.checklist.map(c => `<li>${ic('check-circle', 14)}<div><div class="rc-chk-t">${esc(c.text)}</div>${c.description ? `<div class="rc-chk-d">${esc(c.description)}</div>` : ''}</div></li>`).join('')
        }</ul></div>` : '';

    const staffNames = (ro.staff || []).map(id => {
      const s = getStaff(id);
      return s ? `${s.firstName} ${s.lastName}` : id;
    });

    const aoHistory = (state.workOrders||[]).filter(ao => ao.recurringOrderId === ro.id)
      .sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    const histHtml = aoHistory.length > 0
      ? `<div class="rc-d-sec"><h4>Skapade arbetsorder <span class="bdg bdg-grey">${aoHistory.length}</span></h4>
           ${aoHistory.slice(0,8).map(ao => `<div class="crow rc-hist" data-ao="${esc(ao.id)}" role="button" tabindex="0" onclick="Modal.close();Router.showPage('pg-ao-detail',{aoId:this.dataset.ao})" onkeydown="if(event.key==='Enter'){this.click();}">
               <div class="rc-hist-m"><div class="rc-hist-t">${esc(WorkOrderService.displayNumberOrPending(ao))} – ${esc(ao.title)}</div>
               <div class="rc-hist-d">${esc(fmtDate(ao.scheduledDate||ao.createdAt||''))}</div></div>
               ${sbdg(ao.status)}</div>`).join('')}
           ${aoHistory.length > 8 ? `<p class="rc-hist-more">+${aoHistory.length-8} till</p>` : ''}
         </div>` : '';

    /* Nästa tillfälle — tydligt vad som händer härnäst och vad knappen gör. */
    let nextBox;
    if (ro.status === 'pausad') {
      nextBox = `<div class="rc-d-next is-off">${ic('pause-circle', 18)}<div><div class="rc-d-next-h">Pausad</div><div class="rc-d-next-s">Inga arbetsorder skapas förrän ärendet aktiveras igen.${ro.nextDate ? ' Nästa datum när det aktiveras: ' + esc(fmtDate(ro.nextDate)) + '.' : ''}</div></div></div>`;
    } else if (ro.status === 'avslutad') {
      nextBox = `<div class="rc-d-next is-off">${ic('archive', 18)}<div><div class="rc-d-next-h">Avslutad</div><div class="rc-d-next-s">Ärendet har nått sitt slutdatum eller avslutats. Aktivera det för att skapa fler arbetsorder.</div></div></div>`;
    } else {
      const late = days !== null && days < 0, due = days !== null && days <= 0;
      nextBox = `<div class="rc-d-next ${late ? 'is-late' : due ? 'is-due' : ''}">${ic(late ? 'alert-triangle' : 'calendar', 18)}<div>
        <div class="rc-d-next-h">Nästa tillfälle: ${ro.nextDate ? esc(fmtDate(ro.nextDate)) : '—'}${ro.nextDate ? ` <span class="rc-rel ${late ? 'is-late' : due ? 'is-soon' : ''}">${esc(this._daysText(days))}</span>` : ''}</div>
        <div class="rc-d-next-s">${due ? 'Det är dags att skapa arbetsordern. ' : ''}<b>Skapa AO nu</b> skapar arbetsordern för tillfället och flyttar nästa datum fram enligt intervallet (${esc(RecurringOrderService.intervalLabel(ro.interval).toLowerCase())}).</div>
      </div></div>`;
    }

    const fact = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    const buttons = [
      { label: 'Stäng', cls: 'btn bs', onClick: () => Modal.close() }
    ];
    if (active) buttons.push({ label: `${ic('plus', 15)} Skapa AO nu`, cls: 'btn bp', onClick: () => {
      Modal.close();
      RecurringPage._createAO(roId);
    }});
    Modal.open({
      title: `<span class="fm-mt">${ic('refresh-cw', 18)}<span>${esc(ro.title)}</span></span>`,
      wide: true,
      body: `<div class="rc-d">
        <div class="rc-d-top">
          <div class="rc-d-badges">${this._statusBadge(ro)}${['akut', 'hög', 'normal', 'låg'].includes(ro.priority) ? pbdg(ro.priority) : ''}<span class="bdg bdg-sky">${esc(RecurringOrderService.intervalLabel(ro.interval))}</span></div>
          <div class="rc-d-acts">
            <button type="button" class="btn bs bsm" data-ro="${esc(roId)}" onclick="Modal.close();RecurringPage._openForm(this.dataset.ro)">${ic('pencil', 14)} Redigera</button>
            <button type="button" class="btn bs bsm" data-ro="${esc(roId)}" onclick="RecurringPage._toggleStatus(this.dataset.ro)">${active ? `${ic('pause-circle', 14)} Pausa` : `${ic('play-circle', 14)} Aktivera`}</button>
          </div>
        </div>
        ${nextBox}
        <dl class="rc-d-facts">
          ${fact('Kund', esc(cu ? CustomerService.displayName(cu) : '—'))}
          ${prop ? fact('Fastighet', esc(prop.name || prop.address || prop.id)) : ''}
          ${ro.address ? fact('Arbetsadress', esc(AddressService.formatQuery(ro.address, ro.zip, ro.city, ''))) : ''}
          ${ro.accessCode && Auth.can('objects_sensitive') ? fact('Portkod', esc(ro.accessCode)) : ''}
          ${staffNames.length ? fact('Personal', esc(staffNames.join(', '))) : ''}
          ${fact('Intervall', esc(RecurringOrderService.intervalLabel(ro.interval)) + (ro.interval === 'eget' ? ' (' + esc(ro.intervalDays) + ' dagar)' : ''))}
          ${ro.startDate ? fact('Startdatum', esc(fmtDate(ro.startDate))) : ''}
          ${fact('Slutdatum', ro.tillsvidare ? 'Tillsvidare' : esc(ro.endDate ? fmtDate(ro.endDate) : '—'))}
          ${ro.lastCreatedDate ? fact('Senast skapad', esc(fmtDate(ro.lastCreatedDate))) : ''}
        </dl>
        ${ro.description ? `<div class="rc-d-sec"><h4>Beskrivning</h4><p class="rc-d-desc">${esc(ro.description)}</p></div>` : ''}
        ${chkHtml}
        ${histHtml}
      </div>`,
      buttons
    });
  },

  /* Pausa/aktivera med serverbekräftelse (samma mönster som _save, G12). */
  _toggleStatus(roId) {
    const ro = RecurringOrderService.getById(roId);
    if (!ro) return;
    const newStatus = ro.status === 'aktiv' ? 'pausad' : 'aktiv';
    const saved = RecurringOrderService.update(roId, { status: newStatus });
    Modal.close();
    RecurringPage.render();
    if (saved) confirmPersist('recurringOrders', roId, {
      ok: newStatus === 'aktiv' ? 'Ärendet är aktiverat' : 'Ärendet är pausat',
      fail: 'Statusändringen kunde inte sparas',
      onChange: () => RecurringPage.render()
    });
    else showToast(newStatus === 'aktiv' ? 'Aktiverat' : 'Pausat');
  },

  _createAO(roId) {
    const result = RecurringOrderService.createNextAO(roId);
    if (!result.ok) { showToast(result.error); return; }
    RecurringPage.render();
    Sidebar.updateBadges();
    showToast(`${WorkOrderService.displayNumberOrPending(result.ao)} skapad`);
    Router.showPage('pg-ao-detail', { aoId: result.ao.id });
  },

  _openForm(roId, prefill) {
    const ro  = roId ? RecurringOrderService.getById(roId) : null;
    const isEdit = !!ro;
    const pf  = prefill || {};

    // Seed temp arrays — preserve descriptions when editing, use prefill when creating from AO
    this._tempChecklist = ro
      ? (ro.checklist || []).map(c => ({ text: c.text, description: c.description || '' }))
      : (pf.checklist || []).map(c => ({ text: c.text, description: c.description || '' }));
    this._tempStaff = ro ? (ro.staff || []).slice() : (pf.staff || []).slice();

    // Source values (edit = ro, new from AO = pf, blank = {})
    const src = ro || pf;

    const intervals = RecurringOrderService.INTERVALS;

    /* R2.6 §2/§4 — Adressläge avgörs i första hand av det EXPLICITA
       `addressSource`-fältet ('property'/'customer'/'manual', samma mönster
       som AO:ns eget) — robust, till skillnad från sträng-jämförelse.
       Genuint legacy-poster (skapade innan R2.6, saknar `addressSource`
       helt) infereras KONSERVATIVT i strikt ordning, ingen fuzzy-matchning:
         1. den (ev. legacy-parsade) gatan matchar den länkade FASTIGHETENS
            gata → fastighetsläge
         2. annars matchar den länkade KUNDENS gata → kundläge
         3. annars, om ingen adress alls finns → fastighetsläge om en
            fastighet är vald (annars kundläge, som tidigare)
         4. annars → eget/särskilt läge. */
    const roAddr  = src.address || '';
    const cu0     = src.customerId ? getCu(src.customerId) : null;
    const cu0Addr = cu0 ? [cu0.address, cu0.zip, cu0.city].filter(Boolean).join(', ') : '';
    const prop0   = src.propertyId ? getObj(src.propertyId) : null;
    const propsForCustomer = src.customerId
      ? (state.properties||[]).filter(p => p.customerId === src.customerId)
      : (state.properties||[]);

    /* Fält att förifylla i eget/särskilt-läget: föredra REDAN strukturerade
       zip/city (nya poster, eller från openFromAO()) — annars, för genuint
       legacy-poster som bara har en hopslagen sträng, använd den delade,
       bakåtkompatibla parsern (R2.5 §8/§9). Beräknas alltid (inte bara i
       custom-läge) eftersom den legacy-parsade gatan även används för
       läges-inferensen nedan. */
    var parsedStreet = roAddr, parsedZip = src.zip || '', parsedCity = src.city || '';
    if (!parsedZip && !parsedCity && roAddr) {
      const parsed = AddressService.parseLegacyCombinedAddress(roAddr);
      parsedStreet = parsed.street; parsedZip = parsed.zip; parsedCity = parsed.city;
    }

    let addrMode; // 'property' | 'cu' | 'custom'
    if (src.addressSource === 'manual') addrMode = 'custom';
    else if (src.addressSource === 'property') addrMode = 'property';
    else if (src.addressSource === 'customer') addrMode = 'cu';
    else {
      const streetNorm = AddressService._normalizeStreet(parsedStreet);
      if (roAddr && prop0 && streetNorm && streetNorm === AddressService._normalizeStreet(prop0.address)) addrMode = 'property';
      else if (roAddr && cu0 && streetNorm && streetNorm === AddressService._normalizeStreet(cu0.address)) addrMode = 'cu';
      else if (!roAddr) addrMode = prop0 ? 'property' : 'cu';
      else addrMode = 'custom';
    }

    Modal.open({
      title: `<span class="fm-mt">${ic(isEdit ? 'pencil' : 'refresh-cw', 18)}<span>${isEdit ? 'Redigera återkommande ärende' : (pf.title ? 'Gör återkommande' : 'Nytt återkommande ärende')}</span></span>`,
      wide: true,
      body: `
        <div class="fg"><label>Titel <span style="color:var(--rd)">*</span></label>
          <input id="ro-title" value="${esc(src.title || '')}" placeholder="T.ex. Månadsservice VVS, Kvartalskontroll"></div>

        <div class="g2">
          <div class="fg"><label>Kund</label>
            <select id="ro-cu" onchange="RecurringPage._customerChanged()">
              <option value="">— Välj kund —</option>
              ${(state.customers||[]).map(c=>`<option value="${c.id}" ${src.customerId===c.id?'selected':''}>${esc(CustomerService.displayName(c))}</option>`).join('')}
            </select></div>
          <div class="fg"><label>Fastighet (valfritt)</label>
            <select id="ro-prop" onchange="RecurringPage._propertyChanged()">
              <option value="">— Ingen fastighet —</option>
              ${propsForCustomer.map(p=>`<option value="${p.id}" ${src.propertyId===p.id?'selected':''}>${esc(p.name||p.address||p.id)}</option>`).join('')}
            </select></div>
        </div>

        <div class="fg"><label>Prioritet</label>
          <select id="ro-priority">
            ${['akut','hög','normal','låg'].map(p=>`<option value="${p}" ${(src.priority||'normal')===p?'selected':''}>${priorityLabel(p)}</option>`).join('')}
          </select></div>

        <div class="fg">
          <label>Arbetsadress</label>
          <div style="margin-top:4px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;cursor:pointer;">
              <input type="radio" name="ro-addr-mode" id="ro-addr-prop" value="property"
                ${addrMode==='property'?'checked':''} ${prop0?'':'disabled'} onchange="RecurringPage._addrModeChanged()">
              Använd fastighetens adress
            </label>
            <div id="ro-prop-addr-display" style="font-size:12px;color:var(--mt);margin-left:22px;">${prop0 ? esc([prop0.address, prop0.zip, prop0.city].filter(Boolean).join(', ')) : '(välj fastighet ovan)'}</div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;cursor:pointer;">
              <input type="radio" name="ro-addr-mode" id="ro-addr-cu" value="cu"
                ${addrMode==='cu'?'checked':''} onchange="RecurringPage._addrModeChanged()">
              Använd kundens adress
            </label>
            <div id="ro-cu-addr-display" style="font-size:12px;color:var(--mt);margin-left:22px;">${cu0Addr ? esc(cu0Addr) : '(välj kund ovan)'}</div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;cursor:pointer;">
              <input type="radio" name="ro-addr-mode" id="ro-addr-custom" value="custom"
                ${addrMode==='custom'?'checked':''} onchange="RecurringPage._addrModeChanged()">
              Annan arbetsadress
            </label>
          </div>
          <div id="ro-addr-custom-wrap" style="${addrMode==='custom'?'':'display:none'}">
            <div class="fg" style="margin-bottom:6px;">
              <label>Gatuadress</label>
              <input id="ro-street" value="${esc(parsedStreet)}" placeholder="Storgatan 1"
                autocomplete="off"
                oninput="AddressService.handleInput(this)"
                onblur="setTimeout(()=>AddressService.hideSuggestions(),150)"
                data-addr-zip="ro-zip" data-addr-city="ro-city"></div>
            <div class="g2" style="margin-bottom:6px;">
              <div class="fg"><label>Postnummer</label>
                <input id="ro-zip" value="${esc(parsedZip)}" placeholder="123 45"></div>
              <div class="fg"><label>Ort</label>
                <input id="ro-city" value="${esc(parsedCity)}" placeholder="Stockholm"></div>
            </div>
            ${Auth.can('objects_sensitive') ? `<div class="fg">
              <label>Portkod / åtkomst</label>
              <input id="ro-access" value="${esc(src.accessCode||'')}" placeholder="T.ex. 1234#"></div>` : ''}
          </div>
        </div>

        <div class="fg"><label>Beskrivning</label>
          <textarea id="ro-desc" rows="2" placeholder="Vad ska utföras vid varje tillfälle?">${esc(src.description || '')}</textarea></div>

        <div class="g2">
          <div class="fg"><label>Intervall</label>
            <select id="ro-interval" onchange="RecurringPage._toggleCustomInterval()">
              ${intervals.map(i=>`<option value="${i.value}" ${ro&&ro.interval===i.value?'selected':''}>${esc(i.label)}</option>`).join('')}
            </select></div>
          <div class="fg" id="ro-custom-wrap" style="display:none;">
            <label>Antal dagar</label>
            <input type="number" id="ro-days" value="${ro ? ro.intervalDays||30 : 30}" min="1" max="365"></div>
        </div>

        <div class="g2">
          <div class="fg"><label>Startdatum</label>
            <input type="date" id="ro-start" value="${ro ? ro.startDate||tdy() : tdy()}"></div>
          <div class="fg"><label>Nästa datum</label>
            <input type="date" id="ro-next" value="${ro ? ro.nextDate||tdy() : tdy()}"></div>
        </div>

        <div class="fg">
          <label style="display:flex;align-items:center;gap:8px;text-transform:none;font-size:13px;font-weight:600;letter-spacing:0;cursor:pointer;">
            <input type="checkbox" id="ro-tillsvidare" ${!ro||ro.tillsvidare?'checked':''}
              onchange="RecurringPage._toggleEndDate()">
            Tillsvidare (inget slutdatum)
          </label>
        </div>
        <div class="fg" id="ro-enddate-wrap" style="${ro&&!ro.tillsvidare?'':'display:none'}">
          <label>Slutdatum</label>
          <input type="date" id="ro-end" value="${ro ? ro.endDate||'' : ''}"></div>

        <div class="fg">
          <label>Personal</label>
          <div id="ro-staff-chips" style="display:flex;flex-wrap:wrap;gap:6px;min-height:32px;padding:4px 0;"></div>
          <button type="button" class="btn bs bsm" style="margin-top:4px;" onclick="RecurringPage._openStaffPicker()">
            ${ic('users',13)} Välj personal
          </button>
        </div>

        <div class="fg"><label>Prisgrupp</label>
          <select id="ro-pg">
            <option value="">— Ingen —</option>
            ${(state.priceGroups||[]).filter(p=>p.active).map(p=>`<option value="${p.id}" ${(src.priceGroupId||'')===p.id?'selected':''}>${esc(p.name)} – ${fmt(p.hourRate)} kr/tim ex moms</option>`).join('')}
          </select></div>

        <div class="fg">
          <label>Checklistemall</label>
          <div id="ro-checklist-items" style="margin-bottom:8px;"></div>
          <div style="display:flex;gap:6px;">
            <input id="ro-chk-input" placeholder="Rubrik…" style="flex:1;"
              onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('ro-chk-desc')?.focus();}">
            <button class="btn bs bsm" type="button" onclick="RecurringPage._addCheckItem()">Lägg till</button>
          </div>
          <input id="ro-chk-desc" placeholder="Beskrivning (valfritt)…" style="margin-top:4px;"
            onkeydown="if(event.key==='Enter'){event.preventDefault();RecurringPage._addCheckItem();}">
        </div>

        <div class="fg"><label>Internanteckning</label>
          <textarea id="ro-note" rows="2" placeholder="Syns ej för kund">${esc(ro ? ro.internalNote||'' : '')}</textarea></div>`,
      buttons: [
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() },
        { label: isEdit ? 'Spara ändringar' : 'Skapa ärende', cls: 'btn bp', onClick: () => RecurringPage._save(roId) }
      ]
    });

    setTimeout(() => {
      RecurringPage._toggleCustomInterval();
      RecurringPage._renderChecklistItems();
      RecurringPage._rpmUpdateChips();
      if (ro && !ro.tillsvidare) document.getElementById('ro-enddate-wrap').style.display = '';
      document.getElementById('ro-title')?.focus();
    }, 80);
  },

  /* ── Staff picker (AO-style modal) ─────────── */

  _openStaffPicker() {
    const active = (state.staff||[]).filter(s => s.active);
    Modal.open({
      title: 'Välj personal',
      wide: false,
      body: `
        <div class="fg" style="margin-bottom:8px;">
          <input id="rpm-search" placeholder="Sök namn…" oninput="RecurringPage._rpmSearch(this.value)" autocomplete="off">
        </div>
        <div id="rpm-list" style="max-height:300px;overflow-y:auto;">
          ${active.length ? this._rpmItems(active) : '<p style="font-size:12px;color:var(--mt);padding:8px 0;">Inga aktiva medarbetare registrerade</p>'}
        </div>`,
      buttons: [
        { label: 'Klar', cls: 'btn bp', onClick: () => { Modal.close(); RecurringPage._rpmUpdateChips(); } },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('rpm-search')?.focus(), 80);
  },

  _rpmItems(staffArr) {
    return staffArr.map(s => {
      const sel = this._tempStaff.includes(s.id);
      return `
        <div class="crow" id="rpm-row-${s.id}" onclick="RecurringPage._rpmToggle('${s.id}')"
          style="background:${sel ? 'var(--navy10,#eef2ff)' : ''};">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${esc(s.firstName)} ${esc(s.lastName)}</div>
            ${s.title ? `<div style="font-size:11px;color:var(--mt);">${esc(s.title)}</div>` : ''}
          </div>
          <div id="rpm-chk-${s.id}" style="color:var(--grn);${sel ? '' : 'display:none'}">${ic('check-circle',16)}</div>
        </div>`;
    }).join('');
  },

  _rpmToggle(staffId) {
    const idx = this._tempStaff.indexOf(staffId);
    if (idx === -1) {
      this._tempStaff.push(staffId);
    } else {
      this._tempStaff.splice(idx, 1);
    }
    const row = document.getElementById('rpm-row-' + staffId);
    const chk = document.getElementById('rpm-chk-' + staffId);
    const sel = this._tempStaff.includes(staffId);
    if (row) row.style.background = sel ? 'var(--navy10,#eef2ff)' : '';
    if (chk) chk.style.display    = sel ? '' : 'none';
  },

  _rpmSearch(q) {
    const lq = q.toLowerCase();
    document.querySelectorAll('#rpm-list .crow').forEach(row => {
      const name = row.querySelector('[style*="font-weight:700"]')?.textContent || '';
      row.style.display = !lq || name.toLowerCase().includes(lq) ? '' : 'none';
    });
  },

  _rpmRemove(staffId) {
    const idx = this._tempStaff.indexOf(staffId);
    if (idx !== -1) this._tempStaff.splice(idx, 1);
    this._rpmUpdateChips();
  },

  _rpmUpdateChips() {
    const el = document.getElementById('ro-staff-chips');
    if (!el) return;
    if (!this._tempStaff.length) {
      el.innerHTML = '<span style="font-size:12px;color:var(--mt);">Ingen personal vald</span>';
      return;
    }
    el.innerHTML = this._tempStaff.map(id => {
      const s = getStaff(id);
      if (!s) return '';
      return `
        <span style="display:inline-flex;align-items:center;gap:4px;background:var(--navy10,#eef2ff);color:var(--navy);border-radius:20px;padding:3px 8px;font-size:12px;font-weight:600;">
          ${esc(s.firstName)} ${esc(s.lastName)}
          <button type="button" data-id="${esc(id)}" onclick="RecurringPage._rpmRemove(this.dataset.id)" aria-label="Ta bort ${esc(s.firstName)} ${esc(s.lastName)}" title="Ta bort" style="background:none;border:none;cursor:pointer;padding:0;line-height:1;color:var(--mt);">${ic('x',11)}</button>
        </span>`;
    }).join('');
  },

  /* ── Address helpers ──────────────────────── */

  _customerChanged() {
    const cuId = document.getElementById('ro-cu')?.value;
    const cu   = cuId ? getCu(cuId) : null;
    const addr = cu ? [cu.address, cu.zip, cu.city].filter(Boolean).join(', ') : '';
    const display = document.getElementById('ro-cu-addr-display');
    if (display) display.textContent = addr || '(ingen adress registrerad)';

    /* R2.6 §3 — "Changing customer must safely clear an incompatible
       selected property": fastighetsväljaren filtreras om till den nya
       kundens fastigheter, och en redan vald fastighet som INTE tillhör
       den nya kunden rensas (kund/fastighet får aldrig peka åt olika håll
       i samma post). */
    const propSel = document.getElementById('ro-prop');
    if (propSel) {
      const currentPropId = propSel.value;
      const props = cuId ? (state.properties||[]).filter(p => p.customerId === cuId) : (state.properties||[]);
      const stillValid = props.some(p => p.id === currentPropId);
      propSel.innerHTML = '<option value="">— Ingen fastighet —</option>' +
        props.map(p => `<option value="${p.id}" ${stillValid && p.id===currentPropId?'selected':''}>${esc(p.name||p.address||p.id)}</option>`).join('');
      if (!stillValid) {
        propSel.value = '';
        RecurringPage._propertyChanged();
      }
    }

    /* R2.7 §1/§2 (HARD BLOCKER, oberoende reproducerad) — TIDIGARE
       förifylldes tomma fält i "annan arbetsadress"-läget tyst med den nya
       kundens adress vid ett kundbyte. Det bröt manuell-lägets grundregel:
       en särskild arbetsadress är ANVÄNDARENS EGNA data, oberoende av
       kund/fastighet, tills användaren SJÄLV explicit byter adressläge.
       Ett kundbyte medan "gata" var ifylld men "postnr" tom kunde alltså
       tyst skapa en HYBRIDADRESS (gammal gata + ny kunds postnr) som
       användaren aldrig skrev in. Manuella fält rörs nu ALDRIG av ett
       kund- eller fastighetsbyte — bara av användarens egen inmatning,
       eller vid det EXPLICITA ögonblick användaren väljer manuellt läge
       (se _addrModeChanged()). */
  },

  /* R2.6 §2/§3 — fastighetens adress-visning + radioknappens av/på-läge.
     En "Använd fastighetens adress"-radio kan bara vara vald/aktiv när en
     fastighet faktiskt är vald — om fastigheten rensas medan det läget är
     aktivt faller adressläget säkert tillbaka till kundens adress. */
  _propertyChanged() {
    const propId  = document.getElementById('ro-prop')?.value;
    const prop    = propId ? getObj(propId) : null;
    const display = document.getElementById('ro-prop-addr-display');
    if (display) display.textContent = prop ? [prop.address, prop.zip, prop.city].filter(Boolean).join(', ') : '(välj fastighet ovan)';
    const propRadio = document.getElementById('ro-addr-prop');
    if (propRadio) {
      propRadio.disabled = !prop;
      if (!prop && propRadio.checked) {
        const cuRadio = document.getElementById('ro-addr-cu');
        if (cuRadio) { cuRadio.checked = true; RecurringPage._addrModeChanged(); }
      }
    }
  },

  _addrModeChanged() {
    const isCustom = document.getElementById('ro-addr-custom')?.checked;
    const wrap  = document.getElementById('ro-addr-custom-wrap');
    if (wrap) wrap.style.display = isCustom ? '' : 'none';
  },

  _toggleCustomInterval() {
    const val  = document.getElementById('ro-interval')?.value;
    const wrap = document.getElementById('ro-custom-wrap');
    if (wrap) wrap.style.display = val === 'eget' ? '' : 'none';
  },

  _toggleEndDate() {
    const checked = document.getElementById('ro-tillsvidare')?.checked;
    const wrap    = document.getElementById('ro-enddate-wrap');
    if (wrap) wrap.style.display = checked ? 'none' : '';
  },

  /* ── Checklist helpers ────────────────────── */

  _addCheckItem() {
    const input = document.getElementById('ro-chk-input');
    const desc  = document.getElementById('ro-chk-desc');
    const text  = input?.value.trim();
    if (!text) { input?.focus(); return; }
    this._tempChecklist.push({ text, description: desc?.value.trim() || '' });
    input.value = '';
    if (desc) desc.value = '';
    input.focus();
    this._renderChecklistItems();
  },

  _removeCheckItem(idx) {
    this._tempChecklist.splice(idx, 1);
    this._renderChecklistItems();
  },

  _renderChecklistItems() {
    const el = document.getElementById('ro-checklist-items');
    if (!el) return;
    if (this._tempChecklist.length === 0) {
      el.innerHTML = '<p style="font-size:12px;color:var(--mt);margin:0 0 4px;">Inga kontrollpunkter tillagda</p>';
      return;
    }
    el.innerHTML = this._tempChecklist.map((item, idx) => `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:8px;border:1px solid var(--br);background:#fff;border-radius:6px;margin-bottom:4px;">
        <span style="color:var(--gr);flex-shrink:0;margin-top:2px;">${ic('check-circle',14)}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${esc(item.text)}</div>
          ${item.description ? `<div style="font-size:11px;color:var(--mt);margin-top:2px;">${esc(item.description)}</div>` : ''}
        </div>
        <button class="btn bxs bd" type="button" onclick="RecurringPage._removeCheckItem(${idx})" style="flex-shrink:0;">${ic('trash',11)}</button>
      </div>`).join('');
  },

  /* ── Save ─────────────────────────────────── */

  _save(roId) {
    const title = document.getElementById('ro-title')?.value.trim();
    if (!title) {
      const t = document.getElementById('ro-title');
      if (t) { t.classList.add('is-invalid'); t.setAttribute('aria-invalid', 'true'); t.focus(); }
      showToast('Titel krävs');
      return;
    }

    const tillsvidare = document.getElementById('ro-tillsvidare')?.checked !== false;
    const interval    = document.getElementById('ro-interval')?.value || 'månadsvis';
    const days        = parseInt(document.getElementById('ro-days')?.value) || 30;

    /* R2.6 §1/§3 — adressen sparas fortsatt STRUKTURERAD (gata/postnr/ort
       som egna fält, R2.5), och `propertyId` sparas nu ALLTID separat från
       adressläget — HARD BLOCKER (oberoende reproducerad): tidigare fanns
       ingen fastighets-koppling i formuläret alls, så "Gör återkommande"
       från en fastighetslänkad AO tappade tyst kopplingen redan här, innan
       posten ens sparats en gång. En särskild arbetsadress och en
       fastighetskoppling är INTE ömsesidigt uteslutande (§2/§7) — därför
       läses propertyId helt oberoende av vilket av de tre adresslägena
       (fastighet/kund/eget) som är valt. */
    const addrMode    = document.querySelector('input[name="ro-addr-mode"]:checked')?.value || 'cu';
    const propertyId  = document.getElementById('ro-prop')?.value || '';
    const customerId  = document.getElementById('ro-cu')?.value || '';

    let address = '', zip = '', city = '', accessCode = '', addressSource = '';
    if (addrMode === 'property') {
      const prop = propertyId ? getObj(propertyId) : null;
      address    = prop ? (prop.address || '') : '';
      zip        = prop ? (prop.zip || '') : '';
      city       = prop ? (prop.city || '') : '';
      accessCode = prop ? (prop.accessCode || '') : '';
      addressSource = 'property';
    } else if (addrMode === 'cu') {
      const cu   = customerId ? getCu(customerId) : null;
      address    = cu ? (cu.address || '') : '';
      zip        = cu ? (cu.zip || '') : '';
      city       = cu ? (cu.city || '') : '';
      accessCode = cu ? (cu.accessCode || '') : '';
      addressSource = 'customer';
    } else {
      address    = (document.getElementById('ro-street')?.value || '').trim();
      zip        = (document.getElementById('ro-zip')?.value    || '').trim();
      city       = (document.getElementById('ro-city')?.value   || '').trim();
      /* Utan objects_sensitive visas inte fältet — behåll då sparat värde. */
      const _accEl = document.getElementById('ro-access');
      const _prevRo = roId ? (state.recurringOrders || []).find(r => r.id === roId) : null;
      accessCode = _accEl ? (_accEl.value || '').trim() : ((_prevRo && _prevRo.accessCode) || '');
      addressSource = 'manual';
      /* R2.7 §5/§6 (oberoende reproducerad blockerare) — samma praktiska
         regel som redan gäller för AO:ns egen särskilda adress (skapa/
         redigera-flödena): en manuellt angiven arbetsadress kräver gata
         OCH minst postnummer ELLER ort — annars skapar VIFT SJÄLVT ny,
         tvetydig adressdata, exakt det ursprungliga produktionsproblemet.
         Fastighets-/kundläget spärras ALDRIG av detta — de får använda
         vilken strukturerad kontext masterposten faktiskt har, ofullständig
         eller ej (se AddressService.resolveCreateAddressSnapshot()). */
      if (!address || (!zip && !city)) {
        showToast('Ange postnummer eller ort för den särskilda adressen.');
        return;
      }
    }

    const data = {
      title,
      customerId,
      propertyId,
      address, zip, city, addressSource,
      description:  document.getElementById('ro-desc')?.value.trim() || '',
      priority:     document.getElementById('ro-priority')?.value || 'normal',
      interval,
      intervalDays: days,
      startDate:    document.getElementById('ro-start')?.value || tdy(),
      nextDate:     document.getElementById('ro-next')?.value || tdy(),
      tillsvidare,
      endDate:      tillsvidare ? '' : (document.getElementById('ro-end')?.value || ''),
      accessCode,
      priceGroupId: document.getElementById('ro-pg')?.value || '',
      staff:        this._tempStaff.slice(),
      checklist:    this._tempChecklist.slice(),
      internalNote: document.getElementById('ro-note')?.value.trim() || '',
      /* QA 2026-11-26: redigering behåller ärendets status — tidigare sattes
         alltid 'aktiv', så att spara ett pausat/avslutat ärende tyst
         återaktiverade det. Nytt ärende är aktivt som förut. */
      status:       roId ? (((state.recurringOrders || []).find(r => r.id === roId) || {}).status || 'aktiv') : 'aktiv'
    };

    /* G12: besked först efter serverns bekräftelse. */
    const saved = roId ? RecurringOrderService.update(roId, data) : RecurringOrderService.create(data);
    Modal.close();
    RecurringPage.render();
    if (saved) confirmPersist('recurringOrders', saved.id, { ok: roId ? 'Ärende uppdaterat' : 'Återkommande ärende skapat', fail: 'Ärendet kunde inte sparas', onChange: () => RecurringPage.render() });
  }
};
