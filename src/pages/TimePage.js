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
          ${(state.currentUser && ['admin','chef'].includes(state.currentUser.role)) ? `
          <div class="fg"><label>Utförd av <span style="color:var(--sky);font-size:9px;">Admin</span></label>
            <select id="mt-staff">
              <option value="">— Inloggad användare (${state.currentUser.firstName}) —</option>
              ${(state.staff||[]).filter(s=>s.active).map(s=>
                `<option value="${s.id}:${s.firstName} ${s.lastName}">${s.firstName} ${s.lastName}${s.title?' – '+s.title:''}</option>`
              ).join('')}
            </select>
          </div>` : ''}
          <div class="g2">
            <div class="fg"><label>Kund (valfritt)</label>
              <select id="mt-customer" onchange="TimePage._customerChanged()">
                <option value="">— Välj kund —</option>
                ${(state.customers||[]).map(c=>`<option value="${c.id}">${CustomerService.displayName(c)}</option>`).join('')}
              </select>
            </div>
            <div class="fg"><label>Arbetsorder (valfritt)</label>
              <select id="mt-ao">
                <option value="">— Välj AO —</option>
                ${(state.workOrders||[]).filter(a=>!['avbruten'].includes(a.status)).map(a=>
                  `<option value="${a.id}">${a.id} – ${a.title}</option>`
                ).join('')}
              </select>
            </div>
          </div>
          <div class="fg"><label>Kommentar / Vad utfördes</label>
            <textarea id="mt-comment" rows="2" placeholder="Beskriv kort vad som gjordes…"></textarea></div>
          <div class="fg">
            <label><input type="checkbox" id="mt-billable" checked style="width:16px;height:16px;margin-right:6px;">Debiterbar tid</label>
          </div>
          <button class="btn bp bfull" style="margin-top:4px;" onclick="TimePage.saveManual()">
            ${ic('check',14)} Spara tid
          </button>
        </div>
      </div>

      <!-- Tidslista -->
      <div class="card">
        <div class="card-header">
          <h3>Registrerad tid</h3>
          <span class="bdg bdg-sky">${TimeService.fmtDuration(TimeService.totalMinutes(TimeService.getAll()))}</span>
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

  saveManual() {
    const staffSel = document.getElementById('mt-staff')?.value || '';
    const [overrideStaffId, overrideStaffName] = staffSel ? staffSel.split(':') : ['', ''];
    const result = TimeService.saveManual({
      date:         document.getElementById('mt-date')?.value || '',
      startStr:     document.getElementById('mt-start')?.value || '',
      endStr:       document.getElementById('mt-end')?.value || '',
      aoId:         document.getElementById('mt-ao')?.value || '',
      customerId:   document.getElementById('mt-customer')?.value || '',
      priceGroupId: document.getElementById('mt-pg')?.value || '',
      comment:      document.getElementById('mt-comment')?.value.trim() || '',
      billable:     document.getElementById('mt-billable')?.checked !== false,
      staffId:      overrideStaffId || undefined,
      staffName:    overrideStaffName || undefined
    });
    if (!result.ok) { showToast(result.error); return; }
    showToast('Tid sparad');
    document.getElementById('mt-comment').value = '';
    document.getElementById('time-list').innerHTML = this._renderList();
  },

  _renderList() {
    const entries = TimeService.getAll();
    if (!entries.length) return `<p style="padding:14px;color:var(--mt);font-size:13px;">Ingen tid registrerad</p>`;
    return entries.slice(0, 50).map(t => {
      const cu  = t.customerId ? getCu(t.customerId) : null;
      const ao  = t.aoId ? getAO(t.aoId) : null;
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--bg);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${t.staffName} · ${TimeService.fmtDuration(t.minutes)}</div>
            <div style="font-size:11px;color:var(--mt);">${t.date} ${t.startStr}–${t.endStr}${t.comment?' · '+t.comment:''}</div>
            <div style="font-size:11px;color:var(--sky);">
              ${cu?CustomerService.displayName(cu):''}
              ${ao?' · '+ao.id+' '+ao.title:''}
              ${t.priceGroupName?' · '+t.priceGroupName:''}
            </div>
            ${t.registeredByName ? `<div style="font-size:10px;color:var(--mt);font-style:italic;">Registrerat av ${t.registeredByName}</div>` : ''}
          </div>
          <span class="bdg ${t.billable?'bdg-green':'bdg-grey'}">${t.billable?'Deb.':'Intern'}</span>
          <div style="display:flex;gap:4px;">
            <button class="btn bxs bs" onclick="TimePage.openEditEntry('${t.id}')">${ic('pencil',12)}</button>
            <button class="btn bxs bd" onclick="TimePage.deleteEntry('${t.id}')">${ic('trash',12)}</button>
          </div>
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
          TimeService.update(id, {
            date:         document.getElementById('et-date')?.value || t.date,
            startStr:     document.getElementById('et-start')?.value || t.startStr,
            endStr:       document.getElementById('et-end')?.value || t.endStr,
            priceGroupId: document.getElementById('et-pg')?.value || '',
            customerId:   document.getElementById('et-customer')?.value || '',
            aoId:         document.getElementById('et-ao')?.value || '',
            comment:      document.getElementById('et-comment')?.value.trim() || '',
            billable:     document.getElementById('et-billable')?.checked !== false
          });
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
      TimeService.delete(id);
      document.getElementById('time-list').innerHTML = this._renderList();
      showToast('Borttagen');
    });
  }
};
