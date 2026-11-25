/**
 * MyJobsPage — Mina jobb (Fas 4A, omarbetad QA 2026-11-26)
 * Tekniker-vy: tilldelade AO, arbetspool, stämpling.
 *
 * Struktur (fältpersonalens dag): stämplingsstatus överst (när man är
 * instämplad), sedan tre vyer i en segmentkontroll — Idag (nästa jobb
 * först, därefter försenade, resten av dagen, pågående sedan tidigare och
 * tilldelade utan datum), Kommande (per dag) och Arbetspool ("Ta jobbet").
 * "Stämpla in" (tid) och "Starta jobb" (status) är separata knappar med
 * olika ikon och förklaring. Åtgärdsfunktionerna längre ned (clockIn,
 * clockOut, startJob, takeFromPool) och deras serverbekräftelser är
 * oförändrade.
 */
const MyJobsPage = {

  _catFilter: null,
  _view: 'idag',
  _tick: null,

  setCatFilter(slug) {
    this._catFilter = (slug && slug !== this._catFilter) ? slug : null;
    this.render();
  },

  setView(v) {
    if (!['idag', 'kommande', 'pool'].includes(v)) return;
    this._view = v;
    this.render();
  },

  _prio(ao) { return ({ akut: 0, hög: 1, normal: 2, låg: 3 })[ao.priority] ?? 2; },

  /* Svensk decimal i timmar (komponentstandard §10): 90 min → "1,5 h". */
  _h(min) {
    const h = Math.round((Number(min) || 0) / 60 * 100) / 100;
    return h.toLocaleString('sv-SE', { maximumFractionDigits: 2 }) + ' h';
  },

  /* Grupperingen — samma urval som tidigare, men utan dubbletter: en
     pågående AO med passerat datum visas bara som försenad, och en
     pågående AO med framtida datum bara under "Pågående" (inte även i
     Kommande). */
  _groups(myId, today) {
    const all   = (state.workOrders || []).filter(ao => !ao.archived && !ao.deleted);
    const mine  = ao => (ao.staff || []).includes(myId);
    const alive = ao => !['klar', 'fakturerad', 'avbruten'].includes(ao.status);
    const byTime = (a, b) => (a.scheduledStart || '99:99').localeCompare(b.scheduledStart || '99:99');
    const byPrio = (a, b) => this._prio(a) - this._prio(b);
    const today_ = all.filter(ao => mine(ao) && ao.scheduledDate === today && alive(ao)).sort(byTime);
    const overdue = all.filter(ao => mine(ao) && ao.scheduledDate && ao.scheduledDate < today && alive(ao))
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || byTime(a, b));
    const ongoing = all.filter(ao => mine(ao) && ao.status === 'pågående' && ao.scheduledDate !== today && !(ao.scheduledDate && ao.scheduledDate < today));
    const unscheduled = all.filter(ao => mine(ao) && !ao.scheduledDate && alive(ao) && ao.status !== 'pågående').sort(byPrio);
    const upcoming = all.filter(ao => mine(ao) && ao.scheduledDate > today && alive(ao) && ao.status !== 'pågående')
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || byTime(a, b));
    /* T3-B (AP-A, SÄK-3): bara ÖPPEN pool (status pool, poolOpen ≠ false, ingen personal)
       och bara med ao_pool_take (övergångsregel: äldre fältroll med ao_complete). Egna
       pool-AO visas redan under "Tilldelade utan datum" — inga dubbletter. */
    const pool = WorkOrderService.aoCan('ao_pool_take') ? all.filter(ao => WorkOrderService.isOpenPool(ao) && !mine(ao)).sort(byPrio) : [];
    return { today: today_, overdue, ongoing, unscheduled, upcoming, pool };
  },

  render() {
    const el = document.getElementById('pg-myjobs-content');
    if (!el) return;
    clearInterval(this._tick);
    const user = Auth.getUser();
    if (!user) { el.innerHTML = '<div class="empty"><p>Inte inloggad</p></div>'; return; }

    const myId  = user.id;
    const today = tdy();
    const g     = this._groups(myId, today);
    const canTime   = Auth.can('ao_time');
    const isStamped = !!state.stampActive;
    const stampAoId = state.stampAoId || null;
    const stampAo   = isStamped && stampAoId ? getAO(stampAoId) : null;

    // Kategorifilter — bara kategorier som finns bland användarens egna jobb (inte poolen).
    const myAll = [...g.today, ...g.overdue, ...g.ongoing, ...g.unscheduled, ...g.upcoming];
    const cf = this._catFilter;
    const catOk = ao => !cf || (ao.category || 'ovrigt') === cf;
    const f = {
      today: g.today.filter(catOk), overdue: g.overdue.filter(catOk), ongoing: g.ongoing.filter(catOk),
      unscheduled: g.unscheduled.filter(catOk), upcoming: g.upcoming.filter(catOk)
    };

    /* Nästa jobb: det instämplade jobbet, annars dagens pågående, dagens akuta, dagens
       första enligt tid, sedan försenade, pågående och odaterade. */
    let hero = null, heroMode = 'next';
    if (stampAo && catOk(stampAo)) { hero = stampAo; heroMode = 'on'; }
    else {
      hero = f.today.find(ao => ao.status === 'pågående') || f.today.find(ao => ao.priority === 'akut') || f.today[0]
        || f.overdue[0] || f.ongoing[0] || f.unscheduled[0] || null;
    }
    const heroId = hero ? hero.id : null;
    const notHero = ao => ao.id !== heroId;

    const view = this._view;
    const idagIds = new Set([...f.today, ...f.overdue, ...f.ongoing, ...f.unscheduled].map(a => a.id));
    if (hero) idagIds.add(hero.id);
    const nIdag = idagIds.size;
    const tabs = [
      ['idag', 'Idag', nIdag, 'calendar'],
      ['kommande', 'Kommande', f.upcoming.length, 'calendar-check'],
      ['pool', 'Arbetspool', g.pool.length, 'inbox']
    ];
    const tabsHtml = `<div class="ftabs mj-views" role="tablist" aria-label="Visa">
      ${tabs.map(([k, l, n, icn]) => `<button type="button" class="ft${view === k ? ' on' : ''}" role="tab" aria-selected="${view === k}" onclick="MyJobsPage.setView('${k}')">${ic(icn, 14)}<span>${l}</span><span class="ft-n">${n}</span></button>`).join('')}
    </div>`;

    let chipsHtml = '';
    const usedCats = new Set(myAll.map(ao => ao.category || 'ovrigt'));
    if (usedCats.size > 1 && view !== 'pool') {
      const chips = [UiKit.chip('Alla', 'MyJobsPage.setCatFilter(null)', { on: !cf })];
      AO_CATEGORIES.forEach(c => {
        if (!usedCats.has(c.slug)) return;
        chips.push(UiKit.chip(c.label, `MyJobsPage.setCatFilter('${c.slug}')`, { on: cf === c.slug, n: myAll.filter(ao => (ao.category || 'ovrigt') === c.slug).length }));
      });
      /* Dator: chips. Mobil: en rullista (många kategorier tog annars tre rader). */
      const opts = [`<option value="">Alla kategorier (${myAll.length})</option>`].concat(AO_CATEGORIES.filter(c => usedCats.has(c.slug))
        .map(c => `<option value="${esc(c.slug)}"${cf === c.slug ? ' selected' : ''}>${esc(c.label)} (${myAll.filter(ao => (ao.category || 'ovrigt') === c.slug).length})</option>`));
      chipsHtml = `<div class="mj-chips" role="group" aria-label="Kategori">${chips.join('')}${cf ? `<button type="button" class="btn bghost bsm" onclick="MyJobsPage.setCatFilter(null)">${ic('x', 13)} Rensa filter</button>` : ''}</div>
        <label class="mj-catsel"><span class="sr-only">Kategori</span><select aria-label="Kategori" onchange="MyJobsPage.setCatFilter(this.value || null)">${opts.join('')}</select></label>`;
    }

    let body = '';
    if (view === 'idag') body = this._viewToday(f, g, hero, heroMode, notHero, today, canTime, isStamped, stampAoId);
    else if (view === 'kommande') body = this._viewUpcoming(f.upcoming, today, cf);
    else body = this._viewPool(g.pool);

    el.innerHTML = `<div class="mj">
      ${isStamped && canTime ? this._stampBar(stampAo) : ''}
      <div class="mj-bar">${tabsHtml}</div>
      ${chipsHtml}
      ${body}
    </div>`;

    if (isStamped && canTime) {
      this._tick = setInterval(() => {
        const e = document.getElementById('mj-elapsed');
        if (!e || !state.stampActive) { clearInterval(this._tick); return; }
        e.textContent = TimeService.elapsedStr(state.stampTimestamp);
      }, 30000);
    }
  },

  /* ── Stämplingsstatus (en enda aktiv markering i vyn) ─────────────── */
  _stampBar(stampAo) {
    const since = state.stampTimestamp
      ? new Date(state.stampTimestamp).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '';
    const what = stampAo
      ? `<span class="mj-stamp-ao">${esc(WorkOrderService.displayNumberOrPending(stampAo))} · ${esc(stampAo.title)}</span>`
      : `<span class="mj-stamp-ao">Utan arbetsorder</span>`;
    return `<section class="mj-stamp" aria-label="Stämpling">
      <span class="mj-stamp-ico" aria-hidden="true">${ic('clock', 20)}</span>
      <div class="mj-stamp-txt">
        <div class="mj-stamp-h">Instämplad · <span id="mj-elapsed">${esc(TimeService.elapsedStr(state.stampTimestamp))}</span></div>
        <div class="mj-stamp-s">${since ? 'Sedan ' + esc(since) + ' · ' : ''}${what}</div>
      </div>
      <div class="mj-stamp-act">
        ${stampAo ? `<button type="button" class="btn bs" data-ao="${esc(stampAo.id)}" onclick="Router.showPage('pg-ao-detail',{aoId:this.dataset.ao})">${ic('arrow-right', 15)} Öppna jobbet</button>` : ''}
        <button type="button" class="btn bp" onclick="MyJobsPage.clockOut()">${ic('log-out', 15)} Stämpla ut</button>
      </div>
    </section>`;
  },

  /* ── Vy: Idag ─────────────────────────────────────────────────────── */
  _viewToday(f, g, hero, heroMode, notHero, today, canTime, isStamped, stampAoId) {
    const card = ao => this._jobCard(ao, { canTime, isStamped, stampAoId, today });
    const dateStr = new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });
    let html = '';
    if (hero) {
      html += `<section class="mj-sec mj-sec-hero" aria-label="${heroMode === 'on' ? 'Pågår nu' : 'Nästa jobb'}">
        ${this._jobCard(hero, { canTime, isStamped, stampAoId, today, hero: heroMode })}
      </section>`;
    }
    const overdue = f.overdue.filter(notHero);
    if (overdue.length) html += this._section('Försenade', overdue.length, 'danger', overdue.map(card).join(''));
    const rest = f.today.filter(notHero);
    const allToday = f.today.length;
    if (rest.length) {
      html += this._section(hero && allToday > rest.length ? 'Resten av dagen' : 'Idag', rest.length, '', rest.map(card).join(''),
        `<button type="button" class="btn bghost bsm" onclick="Router.showPage('pg-ao',{filter:'idag'})">${ic('list', 13)} Alla ordrar idag</button>`,
        cap(dateStr));
    } else if (!allToday) {
      const poolN = g.pool.length;
      html += `<div class="empty mj-empty">${ic('calendar', 26)}<h3>Inga jobb planerade idag</h3>
        <p>${this._catFilter ? 'Inga jobb idag i den valda kategorin.' : 'Du har inga arbetsorder med dagens datum.'}</p>
        ${poolN ? `<button type="button" class="btn bs" onclick="MyJobsPage.setView('pool')">${ic('inbox', 15)} Visa arbetspoolen (${poolN})</button>` : ''}
      </div>`;
    }
    const ongoing = f.ongoing.filter(notHero);
    if (ongoing.length) html += this._section('Pågående sedan tidigare', ongoing.length, 'warn', ongoing.map(card).join(''));
    const uns = f.unscheduled.filter(notHero);
    if (uns.length) html += this._section('Tilldelade utan datum', uns.length, '', uns.map(card).join(''));
    return html;
  },

  /* ── Vy: Kommande (grupperat per dag) ─────────────────────────────── */
  _viewUpcoming(list, today, cf) {
    if (!list.length) {
      return `<div class="empty mj-empty">${ic('calendar-check', 26)}<h3>Inga kommande jobb</h3>
        <p>${cf ? 'Inga kommande jobb i den valda kategorin.' : 'Jobb som planeras in åt dig visas här, dag för dag.'}</p></div>`;
    }
    const MAX = 40;
    const shown = list.slice(0, MAX);
    const days = [];
    shown.forEach(ao => {
      let d = days.find(x => x.date === ao.scheduledDate);
      if (!d) { d = { date: ao.scheduledDate, aos: [] }; days.push(d); }
      d.aos.push(ao);
    });
    return days.map(d => this._section(cap(UiKit.dayLabel(d.date, today)), d.aos.length, '',
      d.aos.map(ao => this._jobCard(ao, { compact: true, today })).join(''), '', fmtDate(d.date))).join('') +
      (list.length > MAX ? `<p class="mj-more">Visar ${MAX} av ${list.length} kommande jobb. <button type="button" class="btn bghost bsm" onclick="Router.showPage('pg-ao')">${ic('list', 13)} Alla arbetsordrar</button></p>` : '');
  },

  /* ── Vy: Arbetspool ───────────────────────────────────────────────── */
  _viewPool(pool) {
    if (!pool.length) {
      return `<div class="empty mj-empty">${ic('inbox', 26)}<h3>Arbetspoolen är tom</h3>
        <p>Jobb som läggs i poolen kan tas av vem som helst i teamet. De visas här.</p></div>`;
    }
    return this._section('Lediga jobb att ta', pool.length, '', pool.map(ao => this._poolCard(ao)).join(''));
  },

  /* ── Sektion med rubrik och kortrutnät ────────────────────────────── */
  _section(title, n, tone, inner, action, sub) {
    return `<section class="mj-sec${tone ? ' tone-' + tone : ''}">
      <div class="mj-sec-h">
        <h3>${esc(title)} <span class="bdg ${tone === 'danger' ? 'bdg-red' : tone === 'warn' ? 'bdg-orange' : 'bdg-grey'}">${n}</span>${sub ? `<span class="mj-sec-sub">${esc(sub)}</span>` : ''}</h3>
        ${action || ''}
      </div>
      <div class="mj-grid">${inner}</div>
    </section>`;
  },

  _subLabel(s) {
    const m = { inväntar_material: ['package', 'Inväntar material'], inväntar_kund: ['bell', 'Inväntar kund'], pausad: ['pause-circle', 'Pausad'],
      behöver_återbesök: ['rotate-ccw', 'Behöver återbesök'], blockerad: ['alert-circle', 'Blockerad'] };
    const x = m[s];
    return x ? `${ic(x[0], 13)}<span>${x[1]}</span>` : `<span>${esc(s)}</span>`;
  },

  /* ── AO-kort ──────────────────────────────────────────────────────── */
  _jobCard(ao, o) {
    o = o || {};
    const today    = o.today || tdy();
    const cu       = getCu(ao.customerId);
    const cuName   = cu ? CustomerService.displayName(cu) : '';
    /* R2.6 §12 — adressraden villkoras på det RESOLVERADE resultatet
       (AddressService.displayAddress), så att en legacy-AO utan egen adress
       fortfarande visar fastighetens/kundens adress. */
    const workAddr = AddressService.displayAddress(ao);
    const cl       = ao.checklist || [];
    const chkTotal = cl.length;
    const chkOk    = cl.filter(c => c.done).length;
    const chkProg  = chkTotal ? WorkOrderService.checklistCounts(cl).prog : 0;
    const chkAvv   = cl.filter(c => c.avvikelse === 'avvikelse').length;
    const isOn     = !!(o.isStamped && o.stampAoId === ao.id) || o.hero === 'on';
    const isLate   = WorkOrderService.isOverdue(ao);
    const prioCls  = ({ akut: 'p-akut', hög: 'p-hog' })[ao.priority] || '';
    const timeEntries = TimeService.getByAO(ao.id);
    const actualMins  = TimeService.totalMinutes(timeEntries);
    const estMins     = Math.round((ao.estimatedHours || 0) * 60);
    const timePct     = estMins > 0 ? Math.round(actualMins / estMins * 100) : null;
    const timeOver    = timePct !== null && timePct > 115;
    const aoAttr      = `data-ao="${esc(ao.id)}"`;

    // När: klockslag idag, annars dag (+ klockslag).
    let when = '';
    if (ao.scheduledDate === today) when = ao.scheduledStart ? esc(ao.scheduledStart) + (ao.scheduledEnd ? '–' + esc(ao.scheduledEnd) : '') : 'Idag, ingen tid';
    else if (ao.scheduledDate) when = esc(cap(UiKit.dayLabel(ao.scheduledDate, today))) + (ao.scheduledStart ? ' kl. ' + esc(ao.scheduledStart) : '');
    else when = 'Inget datum';

    const label = o.hero === 'on' ? `<span class="mj-label is-on">${ic('clock', 13)}<span>Pågår nu</span></span>`
      : o.hero === 'next' ? `<span class="mj-label">${ic('arrow-right', 13)}<span>Nästa jobb</span></span>` : '';

    const meta = [];
    if (cuName) meta.push(`<li>${ic('user', 13)}<span>${esc(cuName)}</span></li>`);
    if (workAddr) meta.push(`<li class="mj-addr">${ic('map-pin', 13)}<span>${esc(workAddr)}</span></li>`);
    if (o.hero && ao.contactPerson) meta.push(`<li>${ic('phone', 13)}<span>${esc(ao.contactPerson)}${ao.phone ? ' · ' + esc(ao.phone) : ''}</span></li>`);
    if (ao.substatus) meta.push(`<li class="mj-warn">${this._subLabel(ao.substatus)}</li>`);
    if (chkTotal) meta.push(`<li class="${chkAvv ? 'mj-warn' : ''}">${ic('check-square', 13)}<span>Checklista ${chkOk} av ${chkTotal}${chkProg ? ' · ' + chkProg + ' pågår' : ''}${chkAvv ? ' · ' + chkAvv + ' avvikelse' + (chkAvv > 1 ? 'r' : '') : ''}</span></li>`);
    if (estMins > 0 || actualMins > 0) meta.push(`<li class="${timeOver ? 'mj-danger' : ''}">${ic('clock', 13)}<span>${estMins > 0 ? 'Plan ' + this._h(estMins) : ''}${estMins > 0 && actualMins > 0 ? ' · ' : ''}${actualMins > 0 ? 'Registrerat ' + this._h(actualMins) + (timePct !== null ? ' (' + timePct + ' %)' : '') : ''}</span></li>`);
    const desc = o.hero && ao.description ? `<p class="mj-desc">${esc(ao.description)}</p>` : '';

    let actions = '';
    if (o.compact) {
      actions = `<div class="mj-acts"><button type="button" class="btn bghost bsm" ${aoAttr} onclick="event.stopPropagation();Router.showPage('pg-ao-detail',{aoId:this.dataset.ao})">${ic('arrow-right', 13)} Öppna</button></div>`;
    } else {
      const mapsUrl = workAddr ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(workAddr) : '';
      // T3-B (D-03): Starta kräver ao_start_own (eller ao_edit); servern avgör.
      const canStart = ['nytt', 'pool', 'planerad'].includes(ao.status) && (Auth.can('ao_edit') || WorkOrderService.aoCan('ao_start_own'));
      let stampBtn = '';
      if (o.canTime && !o.isStamped) {
        stampBtn = `<button type="button" class="btn ${o.hero ? 'bp' : 'bs'}" ${aoAttr} title="Stämpla in – tiden börjar räknas på det här jobbet" onclick="event.stopPropagation();MyJobsPage.clockIn(this.dataset.ao)">${ic('log-in', 15)} Stämpla in</button>`;
      } else if (o.canTime && isOn && o.hero !== 'on') {
        stampBtn = `<button type="button" class="btn bs" onclick="event.stopPropagation();MyJobsPage.clockOut()">${ic('log-out', 15)} Stämpla ut</button>`;
      }
      const startBtn = canStart
        ? `<button type="button" class="btn bs" ${aoAttr} title="Starta jobb – ändrar status till Pågående (registrerar ingen tid)" onclick="event.stopPropagation();MyJobsPage.startJob(this.dataset.ao)">${ic('play', 14)} Starta jobb</button>` : '';
      const row1 = stampBtn || startBtn ? `<div class="mj-acts mj-acts-main">${stampBtn}${startBtn}</div>` : '';
      const row2 = `<div class="mj-acts mj-acts-nav">` +
        (mapsUrl ? `<a class="btn bs bsm" href="${esc(mapsUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Vägbeskrivning i kartappen">${ic('navigation', 14)} Karta</a>` : '') +
        (ao.phone ? `<a class="btn bs bsm" href="tel:${esc(String(ao.phone).replace(/[^\d+]/g, ''))}" onclick="event.stopPropagation()" title="Ring kontaktperson">${ic('phone', 14)} Ring</a>` : '') +
        `<button type="button" class="btn bghost bsm" ${aoAttr} onclick="event.stopPropagation();Router.showPage('pg-ao-detail',{aoId:this.dataset.ao})">${ic('arrow-right', 14)} Öppna</button>` +
        `</div>`;
      const hint = o.hero === 'next' && o.canTime && !o.isStamped && canStart
        ? `<p class="mj-hint">${ic('info', 13)}<span><b>Stämpla in</b> mäter din tid. <b>Starta jobb</b> ändrar bara status till Pågående.</span></p>` : '';
      actions = `<div class="mj-card-f" onclick="event.stopPropagation()">${row1}${row2}${hint}</div>`;
    }

    return `<article class="mj-card${o.hero ? ' mj-hero' : ''}${o.compact ? ' is-compact' : ''}${isOn ? ' is-on' : ''}${isLate && !isOn ? ' is-late' : ''}${prioCls ? ' ' + prioCls : ''}" ${aoAttr} onclick="Router.showPage('pg-ao-detail',{aoId:this.dataset.ao})">
      <div class="mj-card-top">
        <div class="mj-card-when${isLate ? ' is-late' : ''}">${ic(isLate ? 'alert-triangle' : 'clock', 13)}<span>${isLate ? 'Försenad · ' : ''}${when}</span></div>
        <div class="mj-card-badges">${sbdg(ao.status)}${['akut', 'hög', 'låg'].includes(ao.priority) ? pbdg(ao.priority) : ''}</div>
      </div>
      ${label}
      <h3 class="mj-title"><span class="mj-id">${esc(WorkOrderService.displayNumberOrPending(ao))}</span> ${esc(ao.title)}</h3>
      ${meta.length ? `<ul class="mj-meta">${meta.join('')}</ul>` : ''}
      ${desc}
      ${ao.category ? `<div class="mj-cat">${catBadge(ao.category)}</div>` : ''}
      ${actions}
    </article>`;
  },

  /* ── Pool-kort ────────────────────────────────────────────────────── */
  _poolCard(ao) {
    const cu       = getCu(ao.customerId);
    const cuName   = cu ? CustomerService.displayName(cu) : '';
    const chkTotal = (ao.checklist || []).length;
    const workAddr = AddressService.displayAddress(ao);
    const aoAttr   = `data-ao="${esc(ao.id)}"`;
    const desc = ao.description ? String(ao.description) : '';
    return `<article class="mj-card is-pool${ao.priority === 'akut' ? ' p-akut' : ao.priority === 'hög' ? ' p-hog' : ''}" ${aoAttr} onclick="Router.showPage('pg-ao-detail',{aoId:this.dataset.ao})">
      <div class="mj-card-top">
        <div class="mj-card-when">${ic('calendar', 13)}<span>${(ao.dueDate || ao.scheduledDate) ? 'Förfaller ' + esc(UiKit.dayLabel(ao.dueDate || ao.scheduledDate)) : 'Inget datum'}</span></div>
        <div class="mj-card-badges">${['akut', 'hög', 'låg'].includes(ao.priority) ? pbdg(ao.priority) : ''}</div>
      </div>
      <h3 class="mj-title"><span class="mj-id">${esc(WorkOrderService.displayNumberOrPending(ao))}</span> ${esc(ao.title)}</h3>
      <ul class="mj-meta">
        ${cuName ? `<li>${ic('user', 13)}<span>${esc(cuName)}</span></li>` : ''}
        ${workAddr ? `<li class="mj-addr">${ic('map-pin', 13)}<span>${esc(workAddr)}</span></li>` : ''}
        ${chkTotal ? `<li>${ic('check-square', 13)}<span>${chkTotal} checkpunkt${chkTotal !== 1 ? 'er' : ''}</span></li>` : ''}
      </ul>
      ${desc ? `<p class="mj-desc">${esc(desc.slice(0, 140))}${desc.length > 140 ? '…' : ''}</p>` : ''}
      ${ao.category ? `<div class="mj-cat">${catBadge(ao.category)}</div>` : ''}
      <div class="mj-card-f" onclick="event.stopPropagation()">
        <div class="mj-acts mj-acts-main">
          <button type="button" class="btn bs" ${aoAttr} onclick="MyJobsPage.takeFromPool(this.dataset.ao)">${ic('user-plus', 15)} Ta jobbet</button>
          <button type="button" class="btn bghost" ${aoAttr} onclick="Router.showPage('pg-ao-detail',{aoId:this.dataset.ao})">${ic('arrow-right', 14)} Öppna</button>
        </div>
      </div>
    </article>`;
  },

  /* ── Åtgärder ─────────────────────────────────────────────────────────── */
  /* V23: fail-closed handler-guard (UI-only räckte inte — knappen var redan
     ao_time-gated, men själva metoden hade ingen egen spärr och kollade
     aldrig TimeService.clockIn()s returvärde innan AO-logg/success-toast). */
  /* FLOW-B FIX (confirmed bug, this round): clockIn() previously called
     WorkOrderService._syncAO() (fire-and-forget, by design — see that
     function's own comment) for the AO's clock-in log note and then
     IMMEDIATELY showed "Instämplad" and re-rendered, with zero connection
     to whether that write actually reached the server. Confirmed live
     (network fully blocked): the toast fired identically to the success
     case and the log note was never persisted, with no error ever shown.
     Fix: the clock-in itself (state.stampActive etc, set synchronously by
     TimeService.clockIn() — a purely local, non-networked concept until
     clockOut() actually creates a time entry) still applies and renders
     immediately, same as before — but the SUCCESS TOAST now waits for
     _syncAO()'s new opts.onSettled confirmation, and a final rejection
     shows a clear warning instead of a false "Instämplad". No rollback of
     TimeService's local clock-in state is attempted here: every other
     _syncAO() call site in this codebase (WorkOrderService.js, see its
     file header) already follows the same convention on a final
     rejection — mark `ao._syncFailed`, surface it via
     onSyncStatusChanged(), never silently undo the optimistic local
     mutation — and introducing a one-off rollback only here would be
     inconsistent and riskier than the bug it fixes. */
  clockIn(aoId) {
    if (!Auth.require('ao_time')) return;
    if (state.stampActive) { showToast('Stämpla ut från nuvarande jobb först'); return; }
    const ao   = getAO(aoId);
    const user = Auth.getUser();
    const ok = TimeService.clockIn(aoId);
    if (!ok) { showToast('Kunde inte klocka in — kontrollera din behörighet.'); return; }
    let syncPending = false;
    if (ao && user) {
      ao.log = ao.log || [];
      ao.log.push({
        id:        newEntryId('L'),
        type:      'clock_in',
        text:      `${user.firstName} ${user.lastName} stämplade in`,
        userName:  `${user.firstName} ${user.lastName}`.trim(),
        timestamp: new Date().toISOString()
      });
      /* 2026-11-24 (riktig STAGING, E2E F3): loggposten skickas som EN post
         (appendLogEntry → work-order-log-write, atomiskt). Tidigare patch_ao
         med hela loggen nekades för fältroller och kunde skriva över en
         annan enhets samtidiga post (G5). Utan serverstöd: samma väg som förut. */
      if (typeof WorkOrderService !== 'undefined' && typeof WorkOrderService.appendLogEntry === 'function') {
        syncPending = true;
        WorkOrderService.appendLogEntry(ao.id, ao.log[ao.log.length - 1], {
          onSettled: function (r) {
            if (r && r.ok) {
              showToast('Instämplad');
            } else if (r && r.final) {
              showToast('Stämplingen kunde inte bekräftas av servern — kontrollera din anslutning och försök igen.');
            }
            // else: transient, väntar på ett senare slutgiltigt svar.
          }
        });
      }
      persist();
    }
    if (!syncPending) showToast('Instämplad');
    this.render();
  },

  /* V23: samma princip — kontrollera TimeService.clockOut()s returvärde
     (post-objekt eller null) INNAN entry.staffName/entry.minutes används
     eller någon success-toast visas. */
  /* FLOW-B FIX (confirmed bug, this round) — same principle as clockIn()
     above. Note: the time ENTRY itself (`entry`, created inside
     TimeService.clockOut() via AOTimeSyncService.createTime()) already
     has its own independent server-ACK tracking
     (entry._pendingSync/entry._syncFailed, see TimeService.js) — that
     part was already correct and is untouched here. The bug fixed in
     THIS function is specifically the AO's clock-out log note, written
     via the separate, fire-and-forget WorkOrderService._syncAO() call,
     whose outcome the old code never waited for before showing
     "Utstämplad — tid sparad". Same no-rollback rationale as clockIn(). */
  /* DUAL-ACK FIX (2026-11-12, independent-reviewer finding, verified
     against the code before fixing): the FLOW-B fix above gated
     "Utstämplad — tid sparad" ONLY on the AO log-note _syncAO() write —
     the comment claimed the time entry's own ACK "was already correct",
     but nothing in this function ever looked at it: TimeService.clockOut()
     gave callers no way to learn the entry's server outcome at all. So
     "tid sparad" could be shown while the actual time entry (the record
     payroll/invoicing reads) had been rejected by the server.
     Now there are TWO logically separate server writes and BOTH are
     tracked:
       1. the time entry itself (TimeService.clockOut()'s new
          opts.onSettled — the HIGH-stakes one),
       2. the AO log note (_syncAO(), lower stakes — only an audit note).
     "Utstämplad — tid sparad" is shown ONLY when (1) is confirmed AND (2)
     is confirmed (or there is no AO log note to write). A final rejection
     of (1) shows a clear error regardless of (2). A final rejection of
     (2) alone, with (1) confirmed, says the time WAS saved but the log
     note was not. A first transient attempt on (1) says honestly that the
     entry is queued, not confirmed. Local clock-out state (banner gone)
     still applies immediately — same documented no-rollback rationale as
     clockIn() above (and the entry stays in AOTimeSyncService's durable
     outbox, so nothing is silently dropped). */
  clockOut() {
    if (!Auth.require('ao_time')) return;
    if (!state.stampActive) return;
    const prevAoId = state.stampAoId;
    const st = { ready: false, done: false, queuedShown: false, entry: null, log: null, logRequired: false };
    const evaluate = function () {
      if (!st.ready || st.done) return;
      const e = st.entry, l = st.log;
      if (e && e.final && !e.ok) {
        st.done = true;
        showToast('Utstämplad, men tidposten kunde INTE sparas av servern' + (e.error ? ' (' + e.error + ')' : '') + ' — registrera tiden manuellt.');
        return;
      }
      if (e && e.ok) {
        if (!st.logRequired || (l && l.ok)) { st.done = true; showToast('Utstämplad — tid sparad'); return; }
        if (l && l.final && !l.ok) {
          st.done = true;
          showToast('Utstämplad — tid sparad. Obs: stämplingsnoteringen i arbetsorderns logg kunde inte bekräftas av servern.');
          return;
        }
        return; // tidposten bekräftad, loggnoteringen väntar fortfarande
      }
      if (e && e.queued && !st.queuedShown) {
        st.queuedShown = true;
        showToast('Utstämplad — sparar tiden… (ej bekräftad av servern ännu, skickas automatiskt när anslutningen fungerar)');
      }
    };
    const entry    = TimeService.clockOut({
      onSettled: function (r) { st.entry = r; evaluate(); }
    });
    if (!entry) { showToast('Kunde inte klocka ut — kontrollera din behörighet.'); return; }
    if (prevAoId) {
      const ao = getAO(prevAoId);
      if (ao) {
        ao.log = ao.log || [];
        ao.log.push({
          id:        newEntryId('L'),
          type:      'clock_out',
          text:      `${entry.staffName} stämplade ut — ${TimeService.fmtDuration(entry.minutes)}`,
          userName:  entry.staffName,
          timestamp: new Date().toISOString()
        });
        if (typeof WorkOrderService !== 'undefined' && typeof WorkOrderService.appendLogEntry === 'function') {
          st.logRequired = true;
          WorkOrderService.appendLogEntry(ao.id, ao.log[ao.log.length - 1], {
            onSettled: function (r) {
              // Endast slutgiltiga svar räknas; transient = väntar vidare.
              if (r && (r.ok || r.final)) { st.log = r; evaluate(); }
            }
          });
        }
        persist();
      }
    }
    st.ready = true;
    evaluate(); // ett redan synkront levererat svar (t.ex. fail-closed fallback) hanteras här
    this.render();
  },

  /* STATUS-ACK FIX (2026-11-12): "Starta" visade tidigare "Status:
     Pågående" synkront, utan koppling till om statusskrivningen nådde
     servern. Nu via WorkOrderService.setStatus()s nya opts.onSettled —
     samma mönster som clockIn() ovan. Lokal status/rendering sker direkt
     (oförändrad optimistisk UI), toasten väntar på serverbekräftelse. */
  startJob(aoId) {
    WorkOrderService.setStatus(aoId, 'pågående', {
      onSettled: function (r) {
        if (r && r.ok) showToast('Status: Pågående');
        else if (r && r.final) showToast('Statusändringen kunde inte bekräftas av servern — kontrollera din anslutning och försök igen.');
      }
    });
    this.render();
  },

  /* T3-B (SÄK-4): beskedet ges först efter serverns svar. Vid 409 already_assigned
     har någon annan hunnit först; listan läses om (WorkOrderService.takeFromPool). */
  async takeFromPool(aoId) {
    if (this._taking) return;
    this._taking = true;
    try {
      const r = await WorkOrderService.takeFromPool(aoId);
      if (r && r.ok) showToast(`Du är nu tilldelad ${WorkOrderService.displayNumberOrPending(r.ao) || aoId}`);
      else showToast(r && r.error === 'already_assigned' ? 'Jobbet har redan tagits av någon annan.' : 'Kunde inte ta jobbet: ' + ((r && r.text) || 'okänt fel'), 6000);
    } finally {
      this._taking = false;
      this.render();
      Sidebar.updateBadges();
    }
  }
};
