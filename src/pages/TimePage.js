/**
 * TimePage — Tid & stämpla (omarbetad QA 2026-11-26)
 *
 * Överst: stämplingsstatus (inte instämplad / instämplad med löpande tid,
 * sedan-klockslag och arbetsorder) med summa idag och denna vecka. Sedan
 * manuell registrering med validering vid fälten och en svensk sammanfattning
 * av passet (oberoende av webbläsarens språk i datum-/tidsfälten, F-24), och
 * egen registrerad tid grupperad per dag med dagssumma. Stämpling, sparning,
 * redigering och borttagning går via samma TimeService-vägar som tidigare;
 * inga beräkningar (minuter, midnatt, sommartid) är ändrade.
 */
const TimePage = {
  _elapsed: null,
  _scope: 'mine',   // 'mine' | 'all' (bara för den som ser andras poster)
  _limit: 50,
  _mtTried: false,

  /* Svensk decimal i timmar (komponentstandard §10): 255 min → "4,25 h". */
  _h(min) {
    const h = Math.round((Number(min) || 0) / 60 * 100) / 100;
    return h.toLocaleString('sv-SE', { maximumFractionDigits: 2 }) + ' h';
  },

  /* Samma minutberäkning som TimeService.saveManual() (ingen egen regel). */
  _mins(startStr, endStr) {
    if (!startStr || !endStr) return null;
    const [sh, sm] = String(startStr).split(':').map(Number);
    const [eh, em] = String(endStr).split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  },

  /* "2026-11-24" → "tisdag 24 nov. 2026" (lokalt datum, inte UTC). */
  _dateLong(ds, weekday) {
    if (!ds || !/^\d{4}-\d{2}-\d{2}/.test(ds)) return '';
    const [y, m, d] = ds.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('sv-SE', { weekday: weekday === false ? undefined : (weekday || 'long'), day: 'numeric', month: 'short', year: 'numeric' });
  },

  _dayHead(ds) {
    const t = tdy();
    const rel = ds === t ? 'Idag' : ds === UiKit.addDays(t, -1) ? 'Igår' : '';
    const long = this._dateLong(ds);
    return rel ? rel + ' · ' + long : cap(long);
  },

  _weekStart(ds) {
    const [y, m, d] = ds.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const back = (dt.getDay() + 6) % 7; // måndag = 0
    return UiKit.localDate(new Date(y, m - 1, d - back));
  },

  render() {
    const el = document.getElementById('pg-tid-content');
    if (!el) return;
    clearInterval(this._elapsed);
    const isOn = state.stampActive;
    const canPayroll = typeof Auth !== 'undefined' && Auth.can('payroll_manage');

    el.innerHTML = `<div class="tp">
      ${this._statusHtml()}
      <div class="tp-cols">
        <section class="card tp-form" aria-labelledby="tp-form-h">
          <div class="card-header"><h3 id="tp-form-h">${ic('plus-circle', 16)} Registrera tid manuellt</h3></div>
          <div class="card-body">${this._manualFieldsHtml()}</div>
          <div class="tp-form-f">
            <div class="tp-status" id="mt-status" role="status" aria-live="polite"></div>
            <button type="button" class="btn bp" id="mt-save" onclick="TimePage.saveManual()">${ic('check', 15)} Spara tid</button>
          </div>
        </section>
        <section class="card tp-list" aria-labelledby="tp-list-h">
          <div class="card-header tp-list-h">
            <h3 id="tp-list-h">${ic('list', 16)} Registrerad tid</h3>
            <div class="ao-overflow-wrap tp-more">
              <button type="button" class="ibtn ao-overflow-btn tp-more-btn" id="ao-ovf-btn-tid" aria-label="Fler åtgärder" title="Fler åtgärder" aria-haspopup="menu" aria-expanded="false" onclick="aoToggleOverflow('ao-ovf-tid',this)">${ic('more-vertical', 16)}</button>
              <div class="ao-overflow-menu" id="ao-ovf-tid" role="menu">
                ${canPayroll ? `<button type="button" class="ao-overflow-menu-item" role="menuitem" onclick="aoCloseOverflow();Router.showPage('pg-import-wizard',{type:'timeEntry'})">${ic('upload', 14)} Importera</button>` : ''}
                <button type="button" class="ao-overflow-menu-item" role="menuitem" onclick="aoCloseOverflow();ImportExportService.showExportMenu('timeEntry',document.getElementById('ao-ovf-btn-tid'))">${ic('download', 14)} Exportera</button>
              </div>
            </div>
          </div>
          <div id="time-list">${this._renderList()}</div>
        </section>
      </div>
    </div>`;

    this._mtTried = false;
    this._mtLive();
    if (isOn) this._startElapsed();
  },

  /* ── Stämplingsstatus + summa idag / denna vecka ──────────────────── */
  _statusHtml() {
    const isOn = !!state.stampActive;
    const meId = state.currentUser ? state.currentUser.id : null;
    const t = tdy();
    const wk = this._weekStart(t);
    const wkEnd = UiKit.addDays(wk, 6);
    const mine = TimeService.getAll().filter(e => e.staffId === meId);
    const dayMin = TimeService.totalMinutes(mine.filter(e => e.date === t));
    const weekMin = TimeService.totalMinutes(mine.filter(e => e.date >= wk && e.date <= wkEnd));
    const ao = isOn && state.stampAoId ? getAO(state.stampAoId) : null;
    const since = isOn && state.stampTimestamp ? new Date(state.stampTimestamp).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '';
    const what = ao ? esc(WorkOrderService.displayNumberOrPending(ao)) + ' – ' + esc(ao.title)
      : (isOn && state.stampAoId ? esc(state.stampAoId) : 'Utan arbetsorder');
    return `<section class="tp-now${isOn ? ' is-on' : ''}" aria-label="Stämpling">
      <span class="tp-now-ico" aria-hidden="true">${ic(isOn ? 'clock' : 'log-in', 22)}</span>
      <div class="tp-now-txt">
        <div class="tp-now-h">${isOn ? `Instämplad · <span id="stamp-elapsed">${esc(TimeService.elapsedStr(state.stampTimestamp))}</span>` : 'Inte instämplad'}</div>
        <div class="tp-now-s">${isOn
          ? `Sedan ${esc(since)} · ${what}`
          : 'Stämpla in när du börjar arbeta. Tiden sparas som en tidpost när du stämplar ut.'}</div>
      </div>
      <dl class="tp-now-facts">
        <div><dt>Idag</dt><dd>${this._h(dayMin)}</dd></div>
        <div><dt>Denna vecka</dt><dd>${this._h(weekMin)}</dd></div>
      </dl>
      <div class="tp-now-act">
        <button type="button" class="btn bp" id="stamp-btn" onclick="TimePage.toggleStamp()">
          ${isOn ? `${ic('log-out', 16)} Stämpla ut` : `${ic('log-in', 16)} Stämpla in`}
        </button>
      </div>
    </section>`;
  },

  _startElapsed() {
    clearInterval(this._elapsed);
    this._elapsed = setInterval(() => {
      const el = document.getElementById('stamp-elapsed');
      if (el && state.stampActive) {
        el.textContent = TimeService.elapsedStr(state.stampTimestamp);
      } else {
        clearInterval(this._elapsed);
      }
    }, 10000);
    const el = document.getElementById('stamp-elapsed');
    if (el) el.textContent = TimeService.elapsedStr(state.stampTimestamp);
  },

  _customerChanged() {
    const cuId = document.getElementById('mt-customer')?.value;
    const aoSel = document.getElementById('mt-ao');
    if (!aoSel) return;
    const curr = aoSel.value;
    const filtered = cuId
      ? (state.workOrders||[]).filter(a => a.customerId === cuId && !['avbruten'].includes(a.status))
      : (state.workOrders||[]).filter(a => !['avbruten'].includes(a.status));
    aoSel.innerHTML = `<option value="">— Välj arbetsorder —</option>` +
      filtered.map(a => `<option value="${esc(a.id)}" ${curr===a.id?'selected':''}>${esc(a.id)} – ${esc(a.title)}</option>`).join('');
  },

  /* V3: väljer man arbetsorder fylls kunden i (om den inte redan är vald). */
  _aoChanged() {
    const aoId = document.getElementById('mt-ao')?.value;
    const cuSel = document.getElementById('mt-customer');
    if (!aoId || !cuSel || cuSel.tagName !== 'SELECT' || cuSel.value) return;
    const ao = getAO(aoId);
    if (ao && ao.customerId && [...cuSel.options].some(o => o.value === ao.customerId)) cuSel.value = ao.customerId;
  },

  toggleStamp() {
    if (!state.stampActive) {
      TimePage.openClockIn();
    } else {
      this.openClockOut();
    }
  },

  openClockIn() {
    /* Egna jobb idag först, sedan övriga valbara — samma urval som tidigare. */
    const meId = state.currentUser ? state.currentUser.id : null;
    const t = tdy();
    const list = (state.workOrders||[]).filter(a=>['planerad','pågående','pool','nytt'].includes(a.status));
    const rank = a => ((a.staff||[]).includes(meId) && a.scheduledDate === t) ? 0 : (a.staff||[]).includes(meId) ? 1 : 2;
    const sorted = list.slice().sort((a, b) => rank(a) - rank(b) || String(a.scheduledStart||'99').localeCompare(String(b.scheduledStart||'99')));
    const opt = a => `<option value="${esc(a.id)}">${esc(a.id)} – ${esc(a.title)}${a.scheduledDate === t && a.scheduledStart ? ' (kl. ' + esc(a.scheduledStart) + ')' : ''}</option>`;
    const mineToday = sorted.filter(a => rank(a) === 0), rest = sorted.filter(a => rank(a) !== 0);
    Modal.open({
      title: `<span class="fm-mt">${ic('log-in', 18)}<span>Stämpla in</span></span>`,
      body: `
        <div class="fg"><label for="ci-ao">Arbetsorder (valfritt)</label>
          <select id="ci-ao">
            <option value="">— Utan arbetsorder —</option>
            ${mineToday.length ? `<optgroup label="Mina jobb idag">${mineToday.map(opt).join('')}</optgroup>` : ''}
            ${rest.length ? `<optgroup label="${mineToday.length ? 'Övriga' : 'Arbetsordrar'}">${rest.map(opt).join('')}</optgroup>` : ''}
          </select></div>
        <p class="tp-modal-hint">Tiden börjar räknas nu och sparas som en tidpost när du stämplar ut. Stämpling ändrar inte arbetsorderns status.</p>`,
      buttons: [
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() },
        { label: `${ic('log-in', 15)} Stämpla in`, cls: 'btn bp', onClick: () => {
          const aoId = document.getElementById('ci-ao')?.value || null;
          /* CLOCK-ACK AUDIT (2026-11-12): clockIn() är rent lokal (ingen
             serverskrivning finns att invänta — se WorkOrderDetailPage.
             toggleStamp()s kommentar), men dess returvärde kontrolleras nu
             så "Inklockat" aldrig visas för en nekad inklockning. */
          const ok = TimeService.clockIn(aoId || null);
          if (!ok) { showToast('Kunde inte klocka in — kontrollera din behörighet.'); return; }
          Modal.close();
          showToast('Instämplad');
          TimePage.render();
          if (typeof Router !== 'undefined' && Router.currentPage === 'pg-myjobs' && typeof MyJobsPage !== 'undefined') MyJobsPage.render();
        }}
      ]
    });
  },

  openClockOut() {
    const mins = Math.round((Date.now() - state.stampTimestamp) / 60000);
    const aoId = state.stampAoId;
    const ao = aoId ? getAO(aoId) : null;
    const cu = ao ? getCu(ao.customerId) : null;
    const pgOptions = (state.priceGroups||[]).filter(p=>p.active).map(p =>
      `<option value="${esc(p.id)}">${esc(p.name)} – ${fmt(p.hourRate)} kr/tim exkl. moms</option>`
    ).join('');
    const since = state.stampTimestamp ? new Date(state.stampTimestamp).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }) : '';
    Modal.open({
      title: `<span class="fm-mt">${ic('log-out', 18)}<span>Stämpla ut</span></span>`,
      body: `
        <dl class="tp-facts">
          <div><dt>Instämplad tid</dt><dd>${esc(TimeService.fmtDuration(mins))}${since ? ` <span class="tp-facts-sub">sedan ${esc(since)}</span>` : ''}</dd></div>
          <div><dt>Arbetsorder</dt><dd>${ao ? `${esc(WorkOrderService.displayNumberOrPending(ao))} – ${esc(ao.title)}` : aoId ? esc(aoId) : 'Utan arbetsorder'}</dd></div>
          ${cu ? `<div><dt>Kund</dt><dd>${esc(CustomerService.displayName(cu))}</dd></div>` : ''}
        </dl>
        <div class="fg"><label for="co-pg">Prisgrupp</label>
          <select id="co-pg"><option value="">— Ingen —</option>${pgOptions}</select></div>
        <div class="fg"><label for="co-comment">Kommentar</label>
          <textarea id="co-comment" rows="2" placeholder="Vad utfördes?"></textarea></div>
        <div class="fg tp-check">
          <label><input type="checkbox" id="co-billable" checked> Debiterbar tid</label>
        </div>`,
      buttons: [
        /* CLOCK-OUT-ACK FIX (2026-11-12): tredje klock-ut-UI:t (även det
           MobileShell:s "Klocka ut"-knapp öppnar). Hade exakt samma lucka
           som WorkOrderDetailPage._openClockOutModal(): "Utloggad" visades
           direkt utan att tidpostens serverskrivning bekräftats (och
           clockOut()s returvärde kontrollerades inte ens). Samma lösning
           och samma UX-beslut som där — se den kommentaren. */
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() },
        { label: `${ic('log-out', 15)} Stämpla ut`, cls: 'btn bp', onClick: (ev) => {
          const btnEl = ev && ev.currentTarget;
          let closed = false;
          const closeOnce = () => {
            if (closed) return false;
            closed = true;
            Modal.close();
            TimePage.render();
            if (typeof Router !== 'undefined' && Router.currentPage === 'pg-myjobs' && typeof MyJobsPage !== 'undefined') MyJobsPage.render();
            return true;
          };
          const entry = TimeService.clockOut({
            priceGroupId: document.getElementById('co-pg')?.value || '',
            comment:      document.getElementById('co-comment')?.value.trim() || '',
            billable:     document.getElementById('co-billable')?.checked !== false,
            onSettled: (r) => {
              if (!r) return;
              if (r.ok) {
                if (!closeOnce()) { showToast('Tidposten är nu bekräftad av servern'); return; }
                showToast('Utstämplad — tid sparad');
              } else if (r.final) {
                closeOnce();
                showToast('Utstämplad, men tidposten kunde INTE sparas av servern' + (r.error ? ' (' + r.error + ')' : '') + ' — registrera tiden manuellt.');
              } else if (r.queued) {
                closeOnce();
                showToast('Utstämplad — sparar tiden… (ej bekräftad av servern ännu, skickas automatiskt när anslutningen fungerar)');
              }
            }
          });
          if (!entry) { showToast('Kunde inte klocka ut — kontrollera din behörighet.'); return; }
          if (!closed && btnEl) { btnEl.disabled = true; btnEl.innerHTML = 'Sparar…'; }
        }}
      ]
    });
  },

  /* V54B R1 — blockerare 9: KANONISK, delad manuell tidsregistrering.
     `_manualFieldsHtml(opts)` bygger fältmarkeringen (identisk med den
     ursprungliga inline-kortets markup när `opts` utelämnas — samma
     `mt-*`-id:n, samma etiketter/beteende, ingen regression för den
     vanliga Tid-sidan) och stöder valfritt `opts.allowedAoIds` (låser
     AO-listan till en given delmängd — används av Projekt) och
     `opts.lockCustomer`+`opts.customerId` (visar kunden som låst text
     istället för en fri väljare). `_collectAndSaveManual(opts)` är den
     ENDA platsen som läser fälten och anropar
     `TimeService.saveManual()` — både Tid-sidans inline-kort
     (`saveManual()`) och Projektets modal (`openManual()`) går via
     samma kod, aldrig två parallella formulär-implementationer som kan
     divergera (vilket redan hade hänt en gång: Projekt-modalen saknade
     "Utförd av"-fältet som fanns här). En sparad post får ALDRIG bara
     ett `projectId` utan `aoId` — `allowedAoIds` begränsar bara VILKEN
     AO som får väljas, det finns inget Projekt-bara tidsregistrerings-
     läge. */
  /* V54B R2 — blockerare 2: `allowedAoIds` filtrerade tidigare ENDAST på
     ID — en avbruten Projekt-AO kunde alltså fortfarande visas och
     väljas i Projekt-sammanhanget, trots att den vanliga Tid-sidan
     redan uteslöt `avbruten`-AO:er. Snittet är nu ALLTID
     allowedAoIds ∩ AO finns ∩ status!=='avbruten' — samma regel som
     den icke-Projekt-kontextuella listan redan följde. */
  _manualFieldsHtml(opts) {
    opts = opts || {};
    const lockCustomer  = !!opts.lockCustomer;
    const allowedAoIds  = opts.allowedAoIds || null;
    const aoList = allowedAoIds
      ? (state.workOrders||[]).filter(a => allowedAoIds.includes(a.id) && a.status !== 'avbruten')
      : (opts.customerId
          ? (state.workOrders||[]).filter(a => a.customerId === opts.customerId && !['avbruten'].includes(a.status))
          : (state.workOrders||[]).filter(a => !['avbruten'].includes(a.status)));
    const cuName = lockCustomer ? (opts.customerName || (opts.customerId && getCu(opts.customerId) ? CustomerService.displayName(getCu(opts.customerId)) : '')) : '';
    const live = `oninput="TimePage._mtLive()" onchange="TimePage._mtLive()"`;
    return `
      <div class="tp-when">
        <div class="fg tp-f-date"><label for="mt-date">Datum</label><input type="date" id="mt-date" value="${tdy()}" required aria-describedby="mt-date-err" ${live}><span class="tp-ferr" id="mt-date-err"></span></div>
        <div class="fg"><label for="mt-start">Starttid</label><input type="time" id="mt-start" value="08:00" required aria-describedby="mt-start-err" ${live}><span class="tp-ferr" id="mt-start-err"></span></div>
        <div class="fg"><label for="mt-end">Sluttid</label><input type="time" id="mt-end" value="16:00" required aria-describedby="mt-end-err" ${live}><span class="tp-ferr" id="mt-end-err"></span></div>
      </div>
      <p class="tp-sum" id="mt-sum" aria-live="polite"></p>
      ${(typeof Auth !== 'undefined' && Auth.can('payroll_manage')) ? `
      <div class="fg"><label for="mt-staff">Utförd av <span class="tp-perm">Lönebehörighet</span></label>
        <select id="mt-staff">
          <option value="">— Inloggad användare (${esc(state.currentUser.firstName)}) —</option>
          ${(state.staff||[]).filter(s=>s.active).map(s=>
            `<option value="${esc(s.id)}:${esc(s.firstName)} ${esc(s.lastName)}">${esc(s.firstName)} ${esc(s.lastName)}${s.title?' – '+esc(s.title):''}</option>`
          ).join('')}
        </select>
      </div>` : ''}
      <div class="g2 tp-g2">
        <div class="fg"><label for="mt-ao">Arbetsorder${allowedAoIds?'':' (valfritt)'}</label>
          <select id="mt-ao" onchange="TimePage._aoChanged()">
            ${!allowedAoIds ? `<option value="">— Välj arbetsorder —</option>` : ''}
            ${aoList.map(a => `<option value="${esc(a.id)}">${esc(a.id)} – ${esc(a.title)}</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label for="mt-customer">Kund${lockCustomer?'':' (valfritt)'}</label>
          ${lockCustomer
            ? `<input type="text" disabled value="${esc(cuName)}" aria-label="Kund"><input type="hidden" id="mt-customer" value="${esc(opts.customerId||'')}">`
            : `<select id="mt-customer" onchange="TimePage._customerChanged()">
                <option value="">— Välj kund —</option>
                ${(state.customers||[]).map(c=>`<option value="${esc(c.id)}">${esc(CustomerService.displayName(c))}</option>`).join('')}
              </select>`}
        </div>
      </div>
      <div class="fg"><label for="mt-pg">Prisgrupp / typ</label>
        <select id="mt-pg">
          <option value="">— Välj —</option>
          ${(state.priceGroups||[]).filter(p=>p.active).map(p=>
            `<option value="${esc(p.id)}">${esc(p.name)} – ${fmt(p.hourRate)} kr/tim exkl. moms</option>`
          ).join('')}
        </select>
      </div>
      <div class="fg"><label for="mt-comment">Kommentar – vad utfördes</label>
        <textarea id="mt-comment" rows="2" placeholder="Beskriv kort vad som gjordes…"></textarea></div>
      <div class="fg tp-check">
        <label><input type="checkbox" id="mt-billable" checked> Debiterbar tid</label>
      </div>`;
  },

  /* Validering vid fälten (komponentstandard §9). prefix 'mt' = manuell
     registrering, 'et' = redigera tid. Samma regler som TimeService
     (datum/start/slut krävs, sluttid efter starttid) — ingen ny affärsregel. */
  _validateManual(prefix, show) {
    const g = (k) => document.getElementById(prefix + '-' + k);
    const val = (k) => (g(k) || {}).value || '';
    const errs = [];
    if (!val('date')) errs.push({ f: 'date', m: 'Välj datum.' });
    if (!val('start')) errs.push({ f: 'start', m: 'Ange starttid.' });
    if (!val('end')) errs.push({ f: 'end', m: 'Ange sluttid.' });
    const mins = this._mins(val('start'), val('end'));
    if (mins !== null && mins <= 0) errs.push({ f: 'end', m: 'Sluttid måste vara efter starttid. Ett pass över midnatt registreras som två poster (före och efter 00:00).' });
    if (show) {
      ['date', 'start', 'end'].forEach((k) => {
        const inp = g(k), out = document.getElementById(prefix + '-' + k + '-err');
        const e = errs.find(x => x.f === k);
        if (inp) { inp.classList.toggle('is-invalid', !!e); if (e) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
        if (out) out.textContent = e ? e.m : '';
      });
    }
    return errs;
  },

  /* Svensk sammanfattning av passet under tidsfälten — "tisdag 24 nov. 2026 ·
     08:00–16:00 · 8 h" — oavsett vilket språk webbläsaren visar i fälten. */
  _mtLive() {
    if (this._mtTried) this._validateManual('mt', true);
    const sum = document.getElementById('mt-sum');
    if (!sum) return;
    const v = (id) => (document.getElementById(id) || {}).value || '';
    const date = v('mt-date'), st = v('mt-start'), en = v('mt-end');
    const mins = this._mins(st, en);
    if (date && mins !== null && mins > 0) {
      sum.className = 'tp-sum' + (mins > 720 ? ' is-warn' : '');
      sum.innerHTML = `${ic(mins > 720 ? 'alert-triangle' : 'clock', 14)}<span>${esc(cap(this._dateLong(date)))} · ${esc(st)}–${esc(en)} · <b>${this._h(mins)}</b>${mins > 720 ? ' — längre än 12 timmar, kontrollera tiderna' : ''}</span>`;
    } else {
      sum.className = 'tp-sum';
      sum.textContent = '';
    }
  },

  /* Öppnar den kanoniska manuella tidsregistreringen i en modal — det
     ENDA sättet ett annat sammanhang (t.ex. Projekt) får registrera tid
     på. `opts.allowedAoIds` begränsar AO-valet, `opts.onSaved` körs
     efter lyckad sparning (istället för Tid-sidans standardbeteende). */
  openManual(opts) {
    opts = opts || {};
    Modal.open({
      title: opts.title || 'Registrera tid',
      body: this._manualFieldsHtml(opts),
      buttons: [
        { label: 'Spara tid', cls: 'btn bsu', onClick: () => {
          this._collectAndSaveManual(Object.assign({}, opts, {
            onSuccess: () => { Modal.close(); if (typeof opts.onSaved === 'function') opts.onSaved(); }
          }));
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  /* V54B R2 — blockerare 1: `opts.allowedAoIds && aoId && !includes()`
     lämnade tidigare ETT hål — ett TOMT `aoId` (manipulerad DOM, eller
     en framtida ändring av fältmarkeringen) klarade villkoret helt
     eftersom `aoId &&`-delen då var falsk, och `TimeService.saveManual()`
     självt tillåter `aoId=''`. En Projekt-kontextuell registrering
     kunde alltså i praktiken skapa en AO-lös TimeEntry — en hård
     invariant-överträdelse (Projekt-tid MÅSTE alltid tillhöra en
     Projekt-länkad arbetsorder). Kontrollen är nu: när
     `opts.allowedAoIds` är satt (dvs. ett begränsat sammanhang) KRÄVS
     ett `aoId` som (a) finns, (b) ingår i `allowedAoIds`, (c) inte är
     avbruten, och (d) — om `opts.customerId` angetts — tillhör den
     kunden. Alla fyra kontrolleras oberoende av vad `_manualFieldsHtml`
     redan filtrerat fram, exakt samma tvålagersdisciplin som övriga
     V54B-invarianter. Normal Tid-sida (`allowedAoIds` ej satt) är
     helt oförändrad.

     V54B R3 — blockerare 2: `allowedAoIds` är bara en ÖGONBLICKSBILD
     tagen när modalen öppnades — om AO:n flyttas/kopplas loss från
     PROJEKTET (en annan flik, en annan användare, en DataSync-cykel)
     EFTER att modalen öppnats men INNAN Spara klickas, skulle den
     gamla ögonblicksbilden ändå godkänna den. `getAO(aoId)` läser
     redan `state` live (ingen egen kopia), så det räcker att jämföra
     AO:ns FAKTISKA, aktuella `projectId` mot `opts.projectId` (skickas
     nu med av `ProjectDetailPage.openRegisterTime()`) — inte bara
     kontrollera medlemskap i den ursprungliga listan. AO:n omkopplas
     ALDRIG tyst till projektet igen; sparningen blockeras bara. */
  _collectAndSaveManual(opts) {
    opts = opts || {};
    const staffSel = document.getElementById('mt-staff')?.value || '';
    const [overrideStaffId, overrideStaffName] = staffSel ? staffSel.split(':') : ['', ''];
    const aoId = document.getElementById('mt-ao')?.value || '';
    if (opts.allowedAoIds) {
      const ao = aoId ? getAO(aoId) : null;
      const valid = !!ao && opts.allowedAoIds.includes(aoId) && ao.status !== 'avbruten' &&
        (!opts.customerId || ao.customerId === opts.customerId) &&
        (!opts.projectId || ao.projectId === opts.projectId);
      if (!valid) { showToast('Välj en giltig arbetsorder i projektet.'); return; }
    }
    /* QA 2026-11-26: validering vid fälten + sammanfattning innan något
       skickas. TimeService.saveManual() kontrollerar samma sak igen. */
    const pageCtx = typeof opts.onSuccess !== 'function';
    const statusEl = () => (pageCtx ? document.getElementById('mt-status') : null);
    const setStatus = (cls, html) => { const s = statusEl(); if (s) { s.className = 'tp-status' + (cls ? ' ' + cls : ''); s.innerHTML = html; } };
    this._mtTried = true;
    const errs = this._validateManual('mt', true);
    if (errs.length) {
      setStatus('is-err', `${ic('alert-circle', 14)}<span>Kontrollera ${errs.length === 1 ? 'fältet' : errs.length + ' fält'}: ${esc(errs.map(e => e.m).join(' '))}</span>`);
      const first = document.getElementById('mt-' + errs[0].f); if (first) first.focus();
      showToast(errs[0].m);
      return;
    }
    const dateV = document.getElementById('mt-date')?.value || '';
    const startV = document.getElementById('mt-start')?.value || '';
    const endV = document.getElementById('mt-end')?.value || '';
    const desc = cap(this._dateLong(dateV, 'short')) + ' ' + startV + '–' + endV + ' (' + this._h(this._mins(startV, endV)) + ')';
    const btn = pageCtx ? document.getElementById('mt-save') : null;
    const btnLabel = `${ic('check', 15)} Spara tid`;
    let settled = false;
    const resetBtn = () => { if (btn) { btn.disabled = false; btn.innerHTML = btnLabel; } };
    const result = TimeService.saveManual({
      date:         dateV,
      startStr:     startV,
      endStr:       endV,
      aoId:         aoId,
      /* V3: vald arbetsorder ger kunden om ingen kund valts — tidigare
         sparades posten då helt utan kund och föll bort ur kundrapporter. */
      customerId:   document.getElementById('mt-customer')?.value || opts.customerId || ((aoId && getAO(aoId)) ? (getAO(aoId).customerId || '') : ''),
      priceGroupId: document.getElementById('mt-pg')?.value || '',
      comment:      document.getElementById('mt-comment')?.value.trim() || '',
      billable:     document.getElementById('mt-billable')?.checked !== false,
      staffId:      overrideStaffId || undefined,
      staffName:    overrideStaffName || undefined
    }, {
      /* "Tid sparad" först efter serverns ACK; avslag → posten tas bort och
         användaren uppmanas registrera igen; transient → ärligt "köad". */
      onSettled: (r) => {
        settled = true;
        resetBtn();
        const l = document.getElementById('time-list'); if (l) l.innerHTML = this._renderList();
        this._refreshStatus();
        if (r.ok) {
          setStatus('is-ok', `${ic('check-circle', 14)}<span>Sparad: ${esc(desc)}</span>`);
          showToast('Tid sparad'); return;
        }
        if (typeof opts.onSaved === 'function') opts.onSaved();
        setStatus('is-err', `${ic('alert-circle', 14)}<span>Tiden kunde inte sparas${r.error ? ' (' + esc(r.error) + ')' : ''}. Posten är borttagen — registrera den igen.</span>`);
        showToast('Tiden kunde INTE sparas' + (r.error ? ' (' + r.error + ')' : '') + ' — posten är borttagen, registrera den igen.', 7000);
      },
      onFirstAttempt: (first) => {
        if (first && !first.ok && !first.final) {
          settled = true;
          resetBtn();
          setStatus('is-warn', `${ic('clock', 14)}<span>Ej bekräftad av servern ännu: ${esc(desc)}. Skickas automatiskt när anslutningen fungerar.</span>`);
          showToast('Sparar tiden… ej bekräftad av servern ännu — skickas automatiskt när anslutningen fungerar.', 6000);
        }
      }
    });
    if (!result.ok) {
      setStatus('is-err', `${ic('alert-circle', 14)}<span>${esc(result.error)}</span>`);
      showToast(result.error); return;
    }
    showToast('Sparar tiden…');
    if (!settled) {
      setStatus('', `${ic('loader', 14)}<span>Sparar ${esc(desc)}…</span>`);
      if (btn) {
        btn.disabled = true; btn.innerHTML = 'Sparar…';
        setTimeout(() => { if (!settled) resetBtn(); }, 20000);
      }
    }
    if (typeof opts.onSuccess === 'function') {
      opts.onSuccess();
    } else {
      const c = document.getElementById('mt-comment'); if (c) c.value = '';
      const l = document.getElementById('time-list'); if (l) l.innerHTML = this._renderList();
      this._refreshStatus();
    }
  },

  saveManual() {
    this._collectAndSaveManual({});
  },

  /* Uppdaterar summorna i statusrutan utan att rita om formuläret. */
  _refreshStatus() {
    const cur = document.querySelector('#pg-tid-content .tp-now');
    if (!cur) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this._statusHtml();
    const facts = tmp.querySelector('.tp-now-facts'), old = cur.querySelector('.tp-now-facts');
    if (facts && old) old.replaceWith(facts);
  },

  /* Anropas av TimeService när en posts serverstatus ändras (sparas/ej
     sparad) — listan visar då rätt märke utan att formuläret ritas om. */
  onSyncStatusChanged() {
    const page = document.getElementById('pg-tid');
    const l = document.getElementById('time-list');
    if (!l || !page || !page.classList.contains('active')) return;
    l.innerHTML = this._renderList();
    this._refreshStatus();
  },

  setScope(s) {
    this._scope = s === 'all' ? 'all' : 'mine';
    this._limit = 50;
    const l = document.getElementById('time-list'); if (l) l.innerHTML = this._renderList();
  },

  showMore() {
    this._limit += 50;
    const l = document.getElementById('time-list'); if (l) l.innerHTML = this._renderList();
  },

  /* Registrerad tid grupperad per dag (senaste först) med dagssumma.
     Redigera/ta bort visas bara där det redan var tillåtet (samma villkor
     som tidigare; TimeService._guardMutation() avgör ändå). */
  _renderList() {
    const all = TimeService.getAll();
    const meId = state.currentUser ? state.currentUser.id : null;
    const hasOthers = all.some(t => t.staffId !== meId);
    const scope = hasOthers ? this._scope : 'mine';
    const entries = (scope === 'mine' ? all.filter(t => t.staffId === meId) : all.slice())
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.startStr || '').localeCompare(String(b.startStr || '')));
    const scopeHtml = hasOthers ? `<div class="tp-scope">
        <div class="ftabs" role="tablist" aria-label="Vems tid">
          <button type="button" class="ft${scope === 'mine' ? ' on' : ''}" role="tab" aria-selected="${scope === 'mine'}" onclick="TimePage.setScope('mine')">Min tid <span class="ft-n">${all.filter(t => t.staffId === meId).length}</span></button>
          <button type="button" class="ft${scope === 'all' ? ' on' : ''}" role="tab" aria-selected="${scope === 'all'}" onclick="TimePage.setScope('all')">Alla <span class="ft-n">${all.length}</span></button>
        </div>
      </div>` : '';
    if (!entries.length) {
      return scopeHtml + `<div class="empty tp-empty">${ic('clock', 24)}<h3>Ingen tid registrerad</h3><p>Stämpla in eller registrera tid manuellt — posterna visas här, dag för dag.</p></div>`;
    }
    const isSuper = typeof Auth !== 'undefined' && Auth.can('all');
    const canPayroll = typeof Auth !== 'undefined' && Auth.can('payroll_manage');
    const shown = entries.slice(0, this._limit);
    const dayTotals = {};
    entries.forEach(t => { dayTotals[t.date] = (dayTotals[t.date] || 0) + (t.minutes || 0); });
    const days = [];
    shown.forEach(t => {
      let d = days[days.length - 1];
      if (!d || d.date !== t.date) { d = { date: t.date, list: [] }; days.push(d); }
      d.list.push(t);
    });
    const row = (t) => {
      const cu  = t.customerId ? getCu(t.customerId) : null;
      const ao  = t.aoId ? getAO(t.aoId) : null;
      const isOwn    = state.currentUser && t.staffId === state.currentUser.id;
      const isLocked = !!t.attested && !isSuper;
      const canEdit  = !isLocked && (isOwn || isSuper || canPayroll);
      const title = ao ? `${esc(WorkOrderService.displayNumberOrPending(ao))} · ${esc(ao.title)}`
        : t.aoId ? esc(t.aoId) : (cu ? esc(CustomerService.displayName(cu)) : 'Utan arbetsorder');
      const sub = [ao && cu ? esc(CustomerService.displayName(cu)) : '', t.priceGroupName ? esc(t.priceGroupName) : '', t.comment ? esc(t.comment) : ''].filter(Boolean).join(' · ');
      const who = !isOwn || scope === 'all' ? `<div class="tp-row-who">${ic('user', 12)}<span>${esc(t.staffName || '')}</span></div>` : '';
      const by = t.registeredByName ? `<div class="tp-row-who">${ic('edit-3', 12)}<span>Registrerat av ${esc(t.registeredByName)}</span></div>` : '';
      const sync = t._syncFailed ? `<span class="bdg bdg-red">Ej sparad</span>` : t._pendingSync ? `<span class="bdg bdg-orange">Sparas…</span>` : '';
      return `<div class="tp-row">
        <div class="tp-row-t">${esc(t.startStr || '')}–${esc(t.endStr || '')}</div>
        <div class="tp-row-m">
          <div class="tp-row-title">${title}</div>
          ${sub ? `<div class="tp-row-sub">${sub}</div>` : ''}
          ${who}${by}
        </div>
        <div class="tp-row-r">
          <span class="tp-row-h">${this._h(t.minutes)}</span>
          <span class="tp-row-b">
            <span class="bdg ${t.billable ? 'bdg-green' : 'bdg-grey'}">${t.billable ? 'Debiterbar' : 'Intern'}</span>
            ${t.attested ? `<span class="bdg bdg-blue">${ic('lock', 11)}Attesterad</span>` : ''}
            ${sync}
          </span>
          ${canEdit ? `<span class="tp-row-act">
            <button type="button" class="ibtn" data-id="${esc(t.id)}" onclick="TimePage.openEditEntry(this.dataset.id)" aria-label="Redigera tidpost" title="Redigera">${ic('pencil', 15)}</button>
            <button type="button" class="ibtn tp-del" data-id="${esc(t.id)}" onclick="TimePage.deleteEntry(this.dataset.id)" aria-label="Ta bort tidpost" title="Ta bort">${ic('trash', 15)}</button>
          </span>` : ''}
        </div>
      </div>`;
    };
    return scopeHtml + days.map(d => `<div class="tp-day">
        <div class="tp-day-h"><span>${esc(this._dayHead(d.date) || d.date)}</span><span class="tp-day-sum">${this._h(dayTotals[d.date])}</span></div>
        ${d.list.map(row).join('')}
      </div>`).join('') +
      `<div class="tp-list-f"><span>Visar ${shown.length} av ${entries.length} poster</span>${entries.length > shown.length ? `<button type="button" class="btn bs bsm" onclick="TimePage.showMore()">${ic('chevron-down', 14)} Visa fler</button>` : ''}</div>`;
  },

  openEditEntry(id) {
    const t = (state.timeEntries||[]).find(x=>x.id===id);
    if (!t) return;
    const pgOptions = (state.priceGroups||[]).filter(p=>p.active).map(p =>
      `<option value="${esc(p.id)}" ${t.priceGroupId===p.id?'selected':''}>${esc(p.name)} – ${fmt(p.hourRate)} kr/tim exkl. moms</option>`
    ).join('');
    const cuOptions = (state.customers||[]).map(c =>
      `<option value="${esc(c.id)}" ${t.customerId===c.id?'selected':''}>${esc(CustomerService.displayName(c))}</option>`
    ).join('');
    const aoOptions = (state.workOrders||[]).filter(a=>!['avbruten'].includes(a.status)).map(a=>
      `<option value="${esc(a.id)}" ${t.aoId===a.id?'selected':''}>${esc(a.id)} – ${esc(a.title)}</option>`
    ).join('');

    Modal.open({
      title: `<span class="fm-mt">${ic('pencil', 18)}<span>Redigera tid</span></span>`,
      body: `
        <div class="tp-when">
          <div class="fg tp-f-date"><label for="et-date">Datum</label><input type="date" id="et-date" value="${esc(t.date)}" required oninput="TimePage._validateManual('et', true)"><span class="tp-ferr" id="et-date-err"></span></div>
          <div class="fg"><label for="et-start">Starttid</label><input type="time" id="et-start" value="${esc(t.startStr)}" required oninput="TimePage._validateManual('et', true)"><span class="tp-ferr" id="et-start-err"></span></div>
          <div class="fg"><label for="et-end">Sluttid</label><input type="time" id="et-end" value="${esc(t.endStr)}" required oninput="TimePage._validateManual('et', true)"><span class="tp-ferr" id="et-end-err"></span></div>
        </div>
        <div class="fg"><label for="et-pg">Prisgrupp</label>
          <select id="et-pg"><option value="">— Ingen —</option>${pgOptions}</select></div>
        <div class="g2 tp-g2">
          <div class="fg"><label for="et-ao">Arbetsorder</label>
            <select id="et-ao"><option value="">— Ingen arbetsorder —</option>${aoOptions}</select></div>
          <div class="fg"><label for="et-customer">Kund</label>
            <select id="et-customer"><option value="">— Ingen kund —</option>${cuOptions}</select></div>
        </div>
        <div class="fg"><label for="et-comment">Kommentar</label><textarea id="et-comment" rows="2">${esc(t.comment||'')}</textarea></div>
        <div class="fg tp-check"><label><input type="checkbox" id="et-billable" ${t.billable?'checked':''}> Debiterbar tid</label></div>`,
      buttons: [
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() },
        { label: `${ic('check', 15)} Spara`, cls: 'btn bp', onClick: (ev) => {
          /* QA 2026-11-26: samma fältvalidering som vid ny registrering —
             TimeService.update() räknar om minuterna men kontrollerade inte
             att sluttiden ligger efter starttiden (kunde ge negativ tid). */
          const vErr = TimePage._validateManual('et', true);
          if (vErr.length) { showToast(vErr[0].m); const f = document.getElementById('et-' + vErr[0].f); if (f) f.focus(); return; }
          /* I4 (2026-11-12): "Tid uppdaterad" only after the server's ACK.
             Final rejection: the entry is rolled back (TimeService.update),
             the dialog stays open with what the user typed, a real error
             is shown. Transient first attempt: honest "köad" message. */
          const btnEl = ev && ev.currentTarget;
          const origLabel = btnEl ? btnEl.innerHTML : '';
          let settled = false, closed = false;
          const resetBtn = () => { if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = origLabel; } };
          const refreshList = () => { const l = document.getElementById('time-list'); if (l) l.innerHTML = this._renderList(); this._refreshStatus(); };
          const result = TimeService.update(id, {
            date:         document.getElementById('et-date')?.value || t.date,
            startStr:     document.getElementById('et-start')?.value || t.startStr,
            endStr:       document.getElementById('et-end')?.value || t.endStr,
            priceGroupId: document.getElementById('et-pg')?.value || '',
            customerId:   document.getElementById('et-customer')?.value || '',
            aoId:         document.getElementById('et-ao')?.value || '',
            comment:      document.getElementById('et-comment')?.value.trim() || '',
            billable:     document.getElementById('et-billable')?.checked !== false
          }, {
            onSettled: (r) => {
              settled = true;
              refreshList();
              if (r.ok) {
                if (closed) { showToast('Tidsändringen är nu bekräftad av servern'); return; }
                closed = true;
                Modal.close();
                showToast('Tid uppdaterad');
              } else {
                if (!closed) resetBtn();
                showToast('Tiden kunde INTE sparas' + (r.error ? ' (' + r.error + ')' : '') + ' — ändringen är ångrad.' + (closed ? '' : ' Dina uppgifter finns kvar i formuläret, försök igen.'), 7000);
              }
            },
            onFirstAttempt: (first) => {
              if (settled || !first || first.ok || first.final) return;
              closed = true;
              Modal.close();
              refreshList();
              showToast('Sparar tiden… ej bekräftad av servern ännu — skickas automatiskt när anslutningen fungerar.', 6000);
            }
          });
          if (!result.ok) { showToast(result.error); return; }
          if (!settled && !closed && btnEl) { btnEl.disabled = true; btnEl.innerHTML = 'Sparar…'; }
        }}
      ]
    });
  },

  deleteEntry(id) {
    Modal.confirm('Ta bort tidspost?', () => {
      const refresh = () => { const l = document.getElementById('time-list'); if (l) l.innerHTML = this._renderList(); this._refreshStatus(); };
      const result = TimeService.delete(id, {
        onSettled: (r) => {
          refresh();
          if (r.ok) showToast('Tidspost borttagen');
          else showToast('Borttagningen nekades' + (r.error ? ' (' + r.error + ')' : '') + ' — posten finns kvar.', 7000);
        },
        onFirstAttempt: (first) => {
          if (first && !first.ok && !first.final) showToast('Borttagningen väntar på anslutning — skickas automatiskt.', 6000);
        }
      });
      if (!result.ok) { showToast(result.error); return; }
      refresh();
      showToast('Tar bort…');
    });
  }
};
