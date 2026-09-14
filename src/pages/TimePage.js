/**
 * TimePage — Tid & stämpla
 */
const TimePage = {
  _elapsed: null,

  render() {
    const el = document.getElementById('pg-tid-content');
    if (!el) return;
    clearInterval(this._elapsed);
    const isOn = state.stampActive;

    el.innerHTML = `
      <!-- Stämpling -->
      <div class="card">
        <div class="card-header">
          <h3>Stämpling</h3>
          ${isOn ? `<span class="bdg bdg-green" id="stamp-elapsed">Pågår…</span>` : ''}
        </div>
        <div class="card-body" style="text-align:center;padding:20px;">
          <button class="btn ${isOn?'bd':'bsu'} bfull" style="font-size:16px;padding:16px;"
            id="stamp-btn" onclick="TimePage.toggleStamp()">
            ${isOn ? `${ic('stop-circle',18)} Klocka ut` : `${ic('play-circle',18)} Klocka in`}
          </button>
          ${isOn&&state.stampAoId ? `<div style="margin-top:10px;color:var(--mt);font-size:12px;">Kopplad till: ${state.stampAoId}</div>` : ''}
        </div>
      </div>

      <!-- Manuell tid -->
      <div class="card">
        <div class="card-header">
          <h3>Registrera tid manuellt</h3>
        </div>
        <div class="card-body">
          ${this._manualFieldsHtml()}
          <button class="btn bp bfull" style="margin-top:4px;" onclick="TimePage.saveManual()">
            ${ic('check',14)} Spara tid
          </button>
        </div>
      </div>

      <!-- Tidslista -->
      <div class="card">
        <div class="card-header">
          <h3>Registrerad tid</h3>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="bdg bdg-sky">${TimeService.fmtDuration(TimeService.totalMinutes(TimeService.getAll()))}</span>
            ${typeof Auth !== 'undefined' && Auth.can('payroll_manage') ? `<button class="btn bs bxs" onclick="Router.showPage('pg-import-wizard',{type:'timeEntry'})">${ic('upload',12)} Importera</button>` : ''}
            <button class="btn bs bxs" onclick="ImportExportService.showExportMenu('timeEntry',this)">${ic('download',12)} Exportera</button>
          </div>
        </div>
        <div id="time-list">
          ${this._renderList()}
        </div>
      </div>`;

    if (isOn) this._startElapsed();
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
    aoSel.innerHTML = `<option value="">— Välj AO —</option>` +
      filtered.map(a => `<option value="${a.id}" ${curr===a.id?'selected':''}>${a.id} – ${a.title}</option>`).join('');
  },

  toggleStamp() {
    if (!state.stampActive) {
      TimePage.openClockIn();
    } else {
      this.openClockOut();
    }
  },

  openClockIn() {
    Modal.open({
      title: 'Klocka in',
      body: `
        <div class="fg"><label>Arbetsorder (valfritt)</label>
          <select id="ci-ao">
            <option value="">— Utan AO-koppling —</option>
            ${(state.workOrders||[]).filter(a=>['planerad','pågående','pool','nytt'].includes(a.status)).map(a=>
              `<option value="${a.id}">${a.id} – ${a.title}</option>`
            ).join('')}
          </select></div>`,
      buttons: [
        { label: 'Klocka in', cls: 'btn bsu', onClick: () => {
          const aoId = document.getElementById('ci-ao')?.value || null;
          TimeService.clockIn(aoId || null);
          Modal.close();
          showToast('Inklockat');
          TimePage.render();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  openClockOut() {
    const mins = Math.round((Date.now() - state.stampTimestamp) / 60000);
    const aoId = state.stampAoId;
    const ao = aoId ? getAO(aoId) : null;
    const cu = ao ? getCu(ao.customerId) : null;
    const pgOptions = (state.priceGroups||[]).filter(p=>p.active).map(p =>
      `<option value="${p.id}">${p.name} – ${fmt(p.hourRate)} kr/tim</option>`
    ).join('');
    Modal.open({
      title: 'Klocka ut',
      body: `
        <div class="ibox" style="margin-bottom:12px;">${ic('clock',14)} Tid: ${TimeService.fmtDuration(mins)}</div>
        ${ao ? `<div class="dr"><span class="dk">AO</span><span class="dv">${ao.id} – ${ao.title}</span></div>` : ''}
        ${cu ? `<div class="dr"><span class="dk">Kund</span><span class="dv">${CustomerService.displayName(cu)}</span></div>` : ''}
        <div class="fg"><label>Prisgrupp</label>
          <select id="co-pg"><option value="">— Ingen —</option>${pgOptions}</select></div>
        <div class="fg"><label>Kommentar</label>
          <textarea id="co-comment" rows="2" placeholder="Vad utfördes?"></textarea></div>
        <div class="fg">
          <label><input type="checkbox" id="co-billable" checked style="width:16px;height:16px;margin-right:6px;">Debiterbar tid</label>
        </div>`,
      buttons: [
        { label: 'Klocka ut', cls: 'btn bsu', onClick: () => {
          TimeService.clockOut({
            priceGroupId: document.getElementById('co-pg')?.value || '',
            comment:      document.getElementById('co-comment')?.value.trim() || '',
            billable:     document.getElementById('co-billable')?.checked !== false
          });
          Modal.close();
          showToast('Utloggad');
          TimePage.render();
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
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
    return `
      <div class="g2">
        <div class="fg"><label>Datum</label><input type="date" id="mt-date" value="${tdy()}"></div>
        <div class="fg"><label>Prisgrupp / Typ</label>
          <select id="mt-pg">
            <option value="">— Välj —</option>
            ${(state.priceGroups||[]).filter(p=>p.active).map(p=>
              `<option value="${p.id}">${p.name} – ${fmt(p.hourRate)} kr/tim</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="g2">
        <div class="fg"><label>Starttid</label><input type="time" id="mt-start" value="08:00"></div>
        <div class="fg"><label>Sluttid</label><input type="time" id="mt-end" value="16:00"></div>
      </div>
      ${(typeof Auth !== 'undefined' && Auth.can('payroll_manage')) ? `
      <div class="fg"><label>Utförd av <span style="color:var(--sky);font-size:9px;">Lönebehörighet</span></label>
        <select id="mt-staff">
          <option value="">— Inloggad användare (${state.currentUser.firstName}) —</option>
          ${(state.staff||[]).filter(s=>s.active).map(s=>
            `<option value="${s.id}:${s.firstName} ${s.lastName}">${s.firstName} ${s.lastName}${s.title?' – '+s.title:''}</option>`
          ).join('')}
        </select>
      </div>` : ''}
      <div class="g2">
        <div class="fg"><label>Kund${lockCustomer?'':' (valfritt)'}</label>
          ${lockCustomer
            ? `<input type="text" disabled value="${esc(cuName)}"><input type="hidden" id="mt-customer" value="${esc(opts.customerId||'')}">`
            : `<select id="mt-customer" onchange="TimePage._customerChanged()">
                <option value="">— Välj kund —</option>
                ${(state.customers||[]).map(c=>`<option value="${c.id}">${CustomerService.displayName(c)}</option>`).join('')}
              </select>`}
        </div>
        <div class="fg"><label>Arbetsorder${allowedAoIds?'':' (valfritt)'}</label>
          <select id="mt-ao">
            ${!allowedAoIds ? `<option value="">— Välj AO —</option>` : ''}
            ${aoList.map(a => `<option value="${a.id}">${a.id} – ${a.title}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="fg"><label>Kommentar / Vad utfördes</label>
        <textarea id="mt-comment" rows="2" placeholder="Beskriv kort vad som gjordes…"></textarea></div>
      <div class="fg">
        <label><input type="checkbox" id="mt-billable" checked style="width:16px;height:16px;margin-right:6px;">Debiterbar tid</label>
      </div>`;
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
    const result = TimeService.saveManual({
      date:         document.getElementById('mt-date')?.value || '',
      startStr:     document.getElementById('mt-start')?.value || '',
      endStr:       document.getElementById('mt-end')?.value || '',
      aoId:         aoId,
      customerId:   document.getElementById('mt-customer')?.value || opts.customerId || '',
      priceGroupId: document.getElementById('mt-pg')?.value || '',
      comment:      document.getElementById('mt-comment')?.value.trim() || '',
      billable:     document.getElementById('mt-billable')?.checked !== false,
      staffId:      overrideStaffId || undefined,
      staffName:    overrideStaffName || undefined
    });
    if (!result.ok) { showToast(result.error); return; }
    if (typeof opts.onSuccess === 'function') {
      opts.onSuccess();
    } else {
      showToast('Tid sparad');
      const c = document.getElementById('mt-comment'); if (c) c.value = '';
      const l = document.getElementById('time-list'); if (l) l.innerHTML = this._renderList();
    }
  },

  saveManual() {
    this._collectAndSaveManual({});
  },

  _renderList() {
    const entries = TimeService.getAll();
    if (!entries.length) return `<p style="padding:14px;color:var(--mt);font-size:13px;">Ingen tid registrerad</p>`;
    const isSuper = typeof Auth !== 'undefined' && Auth.can('all');
    return entries.slice(0, 50).map(t => {
      const cu  = t.customerId ? getCu(t.customerId) : null;
      const ao  = t.aoId ? getAO(t.aoId) : null;
      const isOwn   = state.currentUser && t.staffId === state.currentUser.id;
      const isLocked = !!t.attested && !isSuper;
      const canEdit  = !isLocked && (isOwn || isSuper || (typeof Auth !== 'undefined' && Auth.can('payroll_manage')));
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--bg);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${t.staffName} · ${TimeService.fmtDuration(t.minutes)}${t.attested ? ` <span class="bdg bdg-green" style="font-size:9px;">${ic('lock',9)} Attesterad</span>` : ''}</div>
            <div style="font-size:11px;color:var(--mt);">${t.date} ${t.startStr}–${t.endStr}${t.comment?' · '+t.comment:''}</div>
            <div style="font-size:11px;color:var(--sky);">
              ${cu?CustomerService.displayName(cu):''}
              ${ao?' · '+ao.id+' '+ao.title:''}
              ${t.priceGroupName?' · '+t.priceGroupName:''}
            </div>
            ${t.registeredByName ? `<div style="font-size:10px;color:var(--mt);font-style:italic;">Registrerat av ${t.registeredByName}</div>` : ''}
          </div>
          <span class="bdg ${t.billable?'bdg-green':'bdg-grey'}">${t.billable?'Deb.':'Intern'}</span>
          ${canEdit ? `
          <div style="display:flex;gap:4px;">
            <button class="btn bxs bs" onclick="TimePage.openEditEntry('${t.id}')">${ic('pencil',12)}</button>
            <button class="btn bxs bd" onclick="TimePage.deleteEntry('${t.id}')">${ic('trash',12)}</button>
          </div>` : ''}
        </div>`;
    }).join('');
  },

  openEditEntry(id) {
    const t = (state.timeEntries||[]).find(x=>x.id===id);
    if (!t) return;
    const pgOptions = (state.priceGroups||[]).filter(p=>p.active).map(p =>
      `<option value="${p.id}" ${t.priceGroupId===p.id?'selected':''}>${p.name} – ${fmt(p.hourRate)} kr/tim</option>`
    ).join('');
    const cuOptions = (state.customers||[]).map(c =>
      `<option value="${c.id}" ${t.customerId===c.id?'selected':''}>${CustomerService.displayName(c)}</option>`
    ).join('');
    const aoOptions = (state.workOrders||[]).filter(a=>!['avbruten'].includes(a.status)).map(a=>
      `<option value="${a.id}" ${t.aoId===a.id?'selected':''}>${a.id} – ${a.title}</option>`
    ).join('');

    Modal.open({
      title: 'Redigera tid',
      body: `
        <div class="g2">
          <div class="fg"><label>Datum</label><input type="date" id="et-date" value="${t.date}"></div>
          <div class="fg"><label>Prisgrupp</label>
            <select id="et-pg"><option value="">— Ingen —</option>${pgOptions}</select></div>
        </div>
        <div class="g2">
          <div class="fg"><label>Starttid</label><input type="time" id="et-start" value="${t.startStr}"></div>
          <div class="fg"><label>Sluttid</label><input type="time" id="et-end" value="${t.endStr}"></div>
        </div>
        <div class="fg"><label>Kund</label>
          <select id="et-customer"><option value="">— Ingen kund —</option>${cuOptions}</select></div>
        <div class="fg"><label>Arbetsorder</label>
          <select id="et-ao"><option value="">— Ingen AO —</option>${aoOptions}</select></div>
        <div class="fg"><label>Kommentar</label><textarea id="et-comment" rows="2">${t.comment||''}</textarea></div>
        <div class="fg"><label><input type="checkbox" id="et-billable" ${t.billable?'checked':''} style="width:16px;height:16px;margin-right:6px;">Debiterbar tid</label></div>`,
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => {
          const result = TimeService.update(id, {
            date:         document.getElementById('et-date')?.value || t.date,
            startStr:     document.getElementById('et-start')?.value || t.startStr,
            endStr:       document.getElementById('et-end')?.value || t.endStr,
            priceGroupId: document.getElementById('et-pg')?.value || '',
            customerId:   document.getElementById('et-customer')?.value || '',
            aoId:         document.getElementById('et-ao')?.value || '',
            comment:      document.getElementById('et-comment')?.value.trim() || '',
            billable:     document.getElementById('et-billable')?.checked !== false
          });
          if (!result.ok) { showToast(result.error); return; }
          Modal.close();
          document.getElementById('time-list').innerHTML = this._renderList();
          showToast('Tid uppdaterad');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  deleteEntry(id) {
    Modal.confirm('Ta bort tidspost?', () => {
      const result = TimeService.delete(id);
      if (!result.ok) { showToast(result.error); return; }
      document.getElementById('time-list').innerHTML = this._renderList();
      showToast('Borttagen');
    });
  }
};
