/**
 * SalesPage — Säljchanser / CRM pipeline
 */
const SalesPage = {
  _filter: 'active',
  q: '',

  /* V46 §6: quote_created/work_order_created räknas som aktiva pipelineposter
     tills vidare (de aktiveras INTE som riktiga konverteringsflöden i V46 —
     det är V47) — annars blir en post med giltig status osynlig i alla
     tre flikarna. Delad mellan render()s flikräkning/filtrering och
     _renderCard()s Förfallen-check. */
  ACTIVE_STATUSES: ['new', 'contact_needed', 'contacted', 'quote_created', 'work_order_created'],

  /* V46 §5: expanderat/stängt-läge för Historik-sektionen per säljchans-id,
     stängt (falsy) som default så korten inte blir långa. */
  _historyOpen: {},

  render() {
    const el = document.getElementById('pg-sales-content');
    if (!el) return;

    const allOps = state.salesOpportunities || [];
    /* V46 §6: quote_created/work_order_created räknas som aktiva tills de
       eventuellt aktiveras som riktiga konverteringsflöden i V47 — annars
       blir en post med giltig status osynlig i alla tre flikarna. */
    const counts = {
      active:  allOps.filter(s => this.ACTIVE_STATUSES.includes(s.status)).length,
      snoozed: allOps.filter(s => s.status === 'snoozed').length,
      done:    allOps.filter(s => ['won','lost','done','dismissed'].includes(s.status)).length,
    };

    let list = allOps;
    if (this._filter === 'active')       list = list.filter(s => this.ACTIVE_STATUSES.includes(s.status));
    else if (this._filter === 'snoozed') list = list.filter(s => s.status === 'snoozed');
    else if (this._filter === 'done')    list = list.filter(s => ['won','lost','done','dismissed'].includes(s.status));

    if (this.q) {
      const ql = this.q.toLowerCase();
      list = list.filter(s => {
        const cu = getCu(s.customerId);
        return (s.title||'').toLowerCase().includes(ql)
          || (cu && CustomerService.displayName(cu).toLowerCase().includes(ql));
      });
    }

    list = list.slice().sort((a,b) => {
      const p = {high:0,medium:1,low:2};
      return (p[a.priority]||1) - (p[b.priority]||1);
    });

    el.innerHTML = `
      <div class="ao-toolbar" style="margin-bottom:6px;">
        <div class="swrap">
          <span class="sico">${ic('search',16)}</span>
          <input type="search" id="sales-search" placeholder="Sök kund eller titel…"
            value="${this.q}" oninput="SalesPage.q=this.value;SalesPage.render()">
        </div>
        <div class="ao-toolbar-right">
          <button class="btn bp bsm" onclick="SalesPage.openCreate()">${ic('plus',14)} Ny chans</button>
        </div>
      </div>
      <div class="ftabs ao-status-tabs" style="margin-bottom:8px;">
        <button class="ft ${this._filter==='active'?'on':''}" onclick="SalesPage._filter='active';SalesPage.render()">Aktiva${counts.active>0?' ('+counts.active+')':''}</button>
        <button class="ft ${this._filter==='snoozed'?'on':''}" onclick="SalesPage._filter='snoozed';SalesPage.render()">Uppskjutna${counts.snoozed>0?' ('+counts.snoozed+')':''}</button>
        <button class="ft ${this._filter==='done'?'on':''}" onclick="SalesPage._filter='done';SalesPage.render()">Avslutade${counts.done>0?' ('+counts.done+')':''}</button>
      </div>` +
      (list.length === 0
        ? `<div class="empty">${ic('target',32)}<h3>Inga säljchanser</h3><p>${this.q?'Inga träffar för sökningen.':this._filter==='active'?'Inga aktiva säljchanser just nu.':this._filter==='snoozed'?'Inga uppskjutna.':'Inga avslutade.'}</p>${this._filter==='active'&&!this.q?`<button class="btn bp" style="margin-top:12px;" onclick="SalesPage.openCreate()">${ic('plus',14)} Skapa säljchans</button>`:''}</div>`
        : list.map(op => this._renderCard(op)).join('')
      );
  },

  /* V46 §3: namnet på en kontaktperson kopplad till en säljchans — kontaktId
     är ett index i VALD kunds customer.contacts[] (se schema.js). Returnerar
     '' om inget giltigt val finns (fel/borttagen kund, index utanför gränser,
     kontakt saknas) — aldrig ett fel, bara "ingen kontaktperson att visa". */
  _resolveContactName(op) {
    if (op.contactId === '' || op.contactId == null) return '';
    const cu = op.customerId ? getCu(op.customerId) : null;
    if (!cu) return '';
    const idx = parseInt(op.contactId, 10);
    if (!Number.isInteger(idx) || idx < 0) return '';
    const c = (cu.contacts || [])[idx];
    return c ? (c.name || '') : '';
  },

  /* V46 §2: ansvarig visas alltid, med "Ej tilldelad" som explicit fallback. */
  _resolveStaffName(assignedStaffId) {
    if (!assignedStaffId) return 'Ej tilldelad';
    const s = getStaff(assignedStaffId);
    return s ? (s.firstName + ' ' + s.lastName).trim() : 'Ej tilldelad';
  },

  /* V46 §5: en historikpost, med användarnamn (ActivityService.renderEntry()
     visar inte användare, så en egen, liten renderare används här — läser
     bara redan existerande data via ActivityService.getBySalesOpp(), bygger
     ingen ny historikmodell). */
  _renderHistoryEntry(a) {
    const staff = a.userId ? getStaff(a.userId) : null;
    const who = staff ? (staff.firstName + ' ' + staff.lastName).trim() : (a.userId || 'Okänd');
    return `
      <div style="padding:6px 0;border-bottom:1px solid var(--bg);font-size:12px;">
        <div style="color:var(--tx);">${ActivityService._escHtml(a.description)}</div>
        <div style="color:var(--mt);font-size:11px;margin-top:2px;">${fmtDateTime(a.timestamp)} · ${ActivityService._escHtml(who)}</div>
      </div>`;
  },

  toggleHistory(opId) {
    this._historyOpen[opId] = !this._historyOpen[opId];
    this.render();
  },

  _renderCard(op) {
    const cu = getCu(op.customerId);
    const cuName = cu ? CustomerService.displayName(cu) : '—';
    const typeLabels = {
      service_agreement:'Serviceavtal', seasonal_job:'Säsongsarbete',
      upsell:'Merförsäljning', quote_followup:'Offertuppföljning', win_back:'Vinn tillbaka',
      new_customer:'Ny kund', other:'Övrigt'
    };
    const isDone = ['won','lost','done','dismissed'].includes(op.status);
    const wonLostBadge = op.status === 'won'
      ? `<span class="bdg bdg-green" style="font-size:10px;">${ic('check-circle',10)} Vunnen</span>`
      : op.status === 'lost'
      ? `<span class="bdg bdg-red" style="font-size:10px;">${ic('x',10)} Förlorad</span>`
      : op.status === 'dismissed'
      ? `<span class="bdg bdg-grey" style="font-size:10px;">Avfärdad</span>`
      : '';
    const leftBorder = op.priority === 'high' ? 'border-left:3px solid var(--rd);' : '';

    /* V46 §4: Förfallen — passerat dueDate på en fortfarande aktiv (ej
       vunnen/förlorad/klar/avfärdad, ej uppskjuten — den har redan sitt eget
       "Återkom"-datum) säljchans. Ingen notis/push i V46, bara en badge. */
    const isOverdue = !!(op.dueDate && op.dueDate < tdy() && this.ACTIVE_STATUSES.includes(op.status));
    const overdueBadge = isOverdue ? `<span class="bdg bdg-red" style="font-size:10px;">${ic('alert-triangle',9)} Förfallen</span>` : '';

    const staffName   = this._resolveStaffName(op.assignedStaffId);
    const contactName = this._resolveContactName(op);

    const acts = ActivityService.getBySalesOpp(op.id);
    const histOpen = !!this._historyOpen[op.id];

    return `
      <div class="card" style="margin-bottom:10px;${leftBorder}${isDone?'opacity:.7':''}">
        <div class="card-header">
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:800;margin-bottom:3px;">${op.title}</div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
              ${op.priority==='high' ? `<span class="bdg bdg-red" style="font-size:10px;">${ic('alert-circle',9)} Hög prioritet</span>` : ''}
              ${op.type && op.type !== 'other' ? `<span class="bdg bdg-grey" style="font-size:10px;">${typeLabels[op.type]||op.type}</span>` : ''}
              ${wonLostBadge}
              ${overdueBadge}
            </div>
          </div>
          ${!isDone ? `<button class="btn bxs bs" onclick="SalesPage.openEdit('${op.id}')">${ic('pencil',12)}</button>` : ''}
        </div>
        <div class="card-body">
          <div class="dr">
            <span class="dk">Kund</span>
            <span class="dv" style="cursor:pointer;color:var(--sky);"
              onclick="Router.showPage('pg-crm-detail',{customerId:'${op.customerId}'})">${cuName}</span>
          </div>
          ${contactName ? `<div class="dr"><span class="dk">Kontaktperson</span><span class="dv">${ActivityService._escHtml(contactName)}</span></div>` : ''}
          <div class="dr"><span class="dk">Ansvarig</span><span class="dv">${ActivityService._escHtml(staffName)}</span></div>
          ${op.reason ? `<div class="dr"><span class="dk">Varför</span><span class="dv">${op.reason}</span></div>` : ''}
          ${op.estimatedValue > 0 ? `<div class="dr"><span class="dk">Est. värde</span><span class="dv">${fmt(op.estimatedValue)} kr</span></div>` : ''}
          ${op.status === 'snoozed' && op.snoozedUntil ? `<div class="dr"><span class="dk">Återkom</span><span class="dv">${fmtDate(op.snoozedUntil)}</span></div>` : ''}
          ${op.suggestedAction || op.dueDate ? `
            <div style="background:var(--bg);border:1px solid var(--br);border-radius:8px;padding:9px 12px;margin:8px 0;">
              <div style="font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Nästa åtgärd</div>
              ${op.suggestedAction ? `<div style="font-size:13px;font-weight:600;color:var(--tx);">${op.suggestedAction}</div>` : `<div style="font-size:12px;color:var(--mt);">—</div>`}
              ${op.dueDate ? `<div style="font-size:11px;color:${isOverdue?'var(--rd)':'var(--mt)'};margin-top:3px;">Senast: ${fmtDate(op.dueDate)}</div>` : ''}
            </div>` : ''}
          ${op.aiTip ? `
            <div style="background:var(--bg);border-radius:8px;padding:9px 12px;margin-bottom:8px;border-left:2px solid var(--or);">
              <div style="font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">${ic('zap',9)} Tips</div>
              <div style="font-size:12px;color:var(--tx);line-height:1.5;">${op.aiTip}</div>
            </div>` : ''}
          ${!isDone ? `
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid var(--bg);">
            <button class="btn bsm bp" onclick="SalesPage.createAO('${op.id}')">${ic('clipboard-list',13)} Skapa AO</button>
            ${op.status !== 'snoozed' ? `<button class="btn bsm bs" onclick="SalesPage.openSnooze('${op.id}')">${ic('pause-circle',13)} Skjut upp</button>` : `<button class="btn bsm bsu" onclick="SalesPage.wakeUp('${op.id}')">${ic('play-circle',13)} Återaktivera</button>`}
            <button class="btn bsm bs" onclick="SalesPage.markWon('${op.id}')">${ic('check-circle',13)} Vunnen</button>
            <button class="btn bsm bs" onclick="SalesPage.markLost('${op.id}')">${ic('x-circle',13)} Förlorad</button>
            <button class="btn bxs bd" style="margin-left:auto;" onclick="SalesPage.dismiss('${op.id}')">${ic('trash-2',12)}</button>
          </div>` : ''}
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bg);">
            <button class="btn bxs bs bfull" style="display:flex;justify-content:space-between;align-items:center;" onclick="SalesPage.toggleHistory('${op.id}')">
              <span>Historik (${acts.length})</span>${ic(histOpen?'chevron-up':'chevron-down',12)}
            </button>
            ${histOpen ? `<div style="margin-top:6px;">${acts.length ? acts.map(a => this._renderHistoryEntry(a)).join('') : '<p style="font-size:12px;color:var(--mt);padding:6px 0;">Ingen historik ännu.</p>'}</div>` : ''}
          </div>
        </div>
      </div>`;
  },

  /* V46 §2: samma personalmodell/mönster som WorkOrderDetailPage redan
     använder för "Ansvarig" (state.staff.filter(s=>s.active)) — ingen ny
     personalmodell. */
  _staffOptionsHtml(selectedId) {
    const activeStaff = (state.staff || []).filter(s => s.active);
    let html = `<option value="">— Ej tilldelad —</option>`;
    html += activeStaff.map(s => `<option value="${s.id}" ${selectedId===s.id?'selected':''}>${ActivityService._escHtml((s.firstName+' '+s.lastName).trim())}</option>`).join('');
    return html;
  },

  /* V46 §3: kontaktlistan för VALD kund — värdet är kontaktens index i
     kundens customer.contacts[] (se schema.js-kommentaren för varför:
     kontakter saknar ett stabilt globalt id i befintlig modell). */
  _contactOptionsHtml(customerId, selectedContactId) {
    const cu = customerId ? getCu(customerId) : null;
    const contacts = cu ? (cu.contacts || []) : [];
    let html = `<option value="">— Ingen kontaktperson —</option>`;
    html += contacts.map((c, i) => `<option value="${i}" ${String(selectedContactId)===String(i)?'selected':''}>${ActivityService._escHtml(c.name||'')}${c.role?' ('+ActivityService._escHtml(c.role)+')':''}</option>`).join('');
    return html;
  },

  /* V46 §3: när kund byts i formuläret måste kontaktlistan uppdateras till
     den nya kundens kontakter — det gamla valet nollställs (ett index som
     var giltigt för förra kunden pekar annars fel eller på fel person). */
  _customerChanged() {
    const cuId = document.getElementById('so-cu')?.value || '';
    const wrap = document.getElementById('so-contact');
    if (wrap) wrap.innerHTML = this._contactOptionsHtml(cuId, '');
  },

  _formHtml(op) {
    const v = (k, d='') => op ? (op[k] != null ? op[k] : d) : d;
    const typeOpts = [
      {v:'service_agreement',l:'Serviceavtal'},
      {v:'seasonal_job',l:'Säsongsarbete'},
      {v:'upsell',l:'Merförsäljning'},
      {v:'quote_followup',l:'Offertuppföljning'},
      {v:'win_back',l:'Vinn tillbaka'},
      {v:'new_customer',l:'Ny kund'},
      {v:'other',l:'Övrigt'}
    ];
    return `
      <div class="fg"><label>Titel <span style="color:var(--rd)">*</span></label>
        <input id="so-title" value="${v('title')}" placeholder="T.ex. Serviceavtal BRF Solgläntan"></div>
      <div class="g2">
        <div class="fg"><label>Kund</label>
          <select id="so-cu" onchange="SalesPage._customerChanged()">
            <option value="">— Välj kund —</option>
            ${(state.customers||[]).map(c=>`<option value="${c.id}" ${v('customerId')===c.id?'selected':''}>${CustomerService.displayName(c)}</option>`).join('')}
          </select></div>
        <div class="fg"><label>Kontaktperson</label>
          <select id="so-contact">
            ${this._contactOptionsHtml(v('customerId'), v('contactId'))}
          </select></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Ansvarig</label>
          <select id="so-resp">
            ${this._staffOptionsHtml(v('assignedStaffId'))}
          </select></div>
        <div class="fg"><label>Typ</label>
          <select id="so-type">
            ${typeOpts.map(t=>`<option value="${t.v}" ${v('type')===t.v?'selected':''}>${t.l}</option>`).join('')}
          </select></div>
      </div>
      <div class="g2">
        <div class="fg"><label>Prioritet</label>
          <select id="so-prio">
            <option value="high"   ${v('priority')==='high'?'selected':''}>Hög</option>
            <option value="medium" ${v('priority')==='medium'||!v('priority')?'selected':''}>Medium</option>
            <option value="low"    ${v('priority')==='low'?'selected':''}>Låg</option>
          </select></div>
        <div class="fg"><label>Estimerat värde (kr)</label>
          <input type="number" id="so-val" value="${v('estimatedValue',0)}" min="0" placeholder="0"></div>
      </div>
      <div class="fg"><label>Senast (nästa åtgärd)</label>
        <input type="date" id="so-due" value="${v('dueDate')}"></div>
      <div class="fg"><label>Beskrivning / orsak</label>
        <textarea id="so-reason" rows="2" placeholder="Varför är detta en möjlighet?">${v('reason')}</textarea></div>
      <div class="fg"><label>Nästa åtgärd</label>
        <input id="so-action" value="${v('suggestedAction')}" placeholder="T.ex. Ring och erbjud förlängning…"></div>`;
  },

  openCreate() {
    Modal.open({
      title: 'Ny säljchans',
      wide: true,
      body: this._formHtml(null),
      buttons: [
        { label: 'Skapa', cls: 'btn bp', onClick: () => SalesPage._save(null) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
    setTimeout(() => document.getElementById('so-title')?.focus(), 80);
  },

  openEdit(opId) {
    const op = getSO(opId);
    if (!op) return;
    Modal.open({
      title: 'Redigera säljchans',
      wide: true,
      body: this._formHtml(op),
      buttons: [
        { label: 'Spara', cls: 'btn bp', onClick: () => SalesPage._save(opId) },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  _save(opId) {
    const title = document.getElementById('so-title')?.value.trim();
    if (!title) { showToast('Titel krävs'); return; }
    const customerId = document.getElementById('so-cu')?.value || '';

    /* V46 §2: strikt write-validering av ansvarig — endast en person som
       FAKTISKT finns och FORTFARANDE är aktiv i state.staff accepteras.
       En inaktiverad eller borttagen person kan alltså aldrig "smygas in"
       via ett formulärvärde som blev inaktuellt medan modalen var öppen. */
    const respRaw = document.getElementById('so-resp')?.value || '';
    const activeStaffIds = new Set((state.staff || []).filter(s => s.active).map(s => s.id));
    const assignedStaffId = respRaw && activeStaffIds.has(respRaw) ? respRaw : '';

    /* V46 §3: kontaktId är bara giltigt om det pekar på en faktisk kontakt
       inom DEN VALDA kundens contacts[] — en kontakt från fel kund (eller
       ett index utanför gränserna) kan aldrig sparas. */
    const contactRaw = document.getElementById('so-contact')?.value;
    let contactId = '';
    if (customerId && contactRaw !== undefined && contactRaw !== '') {
      const cu = getCu(customerId);
      const idx = parseInt(contactRaw, 10);
      if (cu && Number.isInteger(idx) && idx >= 0 && cu.contacts && cu.contacts[idx]) {
        contactId = String(idx);
      }
    }

    const data = {
      title,
      customerId,
      contactId,
      assignedStaffId,
      type:           document.getElementById('so-type')?.value || 'other',
      priority:       document.getElementById('so-prio')?.value || 'medium',
      estimatedValue: parseFloat(document.getElementById('so-val')?.value) || 0,
      dueDate:        document.getElementById('so-due')?.value || '',
      reason:         document.getElementById('so-reason')?.value.trim() || '',
      suggestedAction:document.getElementById('so-action')?.value.trim() || ''
    };
    if (!opId) {
      SalesService.create({ ...data, status: 'new' });
      showToast('Säljchans skapad');
    } else {
      const op = getSO(opId);
      if (!op) return;
      Object.assign(op, data, { updatedAt: new Date().toISOString() });
      persist();
      showToast('Uppdaterad');
    }
    Modal.close();
    Sidebar.updateBadges();
    SalesPage.render();
  },

  createAO(opId) {
    const op = getSO(opId);
    if (!op) return;
    const cu = op.customerId ? getCu(op.customerId) : null;
    Router.showPage('pg-ao');
    setTimeout(() => WorkOrdersPage.openCreate(op.customerId || null), 100);
    // Mark as contacted if still new
    if (op.status === 'new') {
      op.status = 'contacted';
      op.updatedAt = new Date().toISOString();
      persist();
      Sidebar.updateBadges();
    }
    showToast('Skapar arbetsorder…');
  },

  openSnooze(opId) {
    const op = getSO(opId);
    if (!op) return;
    const def = _ds(7);
    Modal.open({
      title: 'Skjut upp',
      body: `
        <p style="font-size:13px;color:var(--mt);margin-bottom:12px;">${op.title}</p>
        <div class="fg"><label>Återkom datum</label>
          <input type="date" id="snooze-date" value="${def}" min="${tdy()}"></div>`,
      buttons: [
        { label: 'Skjut upp', cls: 'btn bp', onClick: () => {
          const d = document.getElementById('snooze-date')?.value;
          if (!d) { showToast('Välj datum'); return; }
          SalesService.snooze(opId, d);
          Modal.close(); Sidebar.updateBadges(); SalesPage.render();
          showToast('Uppskjuten');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  wakeUp(opId) {
    const op = getSO(opId);
    if (!op) return;
    op.status = 'contacted';
    op.snoozedUntil = '';
    op.updatedAt = new Date().toISOString();
    persist(); Sidebar.updateBadges(); SalesPage.render();
    showToast('Återaktiverad');
  },

  markWon(opId) {
    Modal.confirm('Markera som vunnen affär?', () => {
      const op = getSO(opId);
      if (!op) return;
      op.status = 'won'; op.completedAt = new Date().toISOString(); op.updatedAt = new Date().toISOString();
      ActivityService.log('sales_opportunity_won', `Säljchans vunnen: ${op.title}`, { customerId: op.customerId, salesOpportunityId: op.id });
      persist(); Sidebar.updateBadges(); SalesPage.render(); showToast('Markerad vunnen!');
    });
  },

  markLost(opId) {
    const op = getSO(opId);
    if (!op) return;
    Modal.open({
      title: 'Markera som förlorad',
      body: `
        <p style="font-size:13px;color:var(--mt);margin-bottom:8px;">${op.title}</p>
        <div class="fg"><label>Anledning (valfritt)</label>
          <input id="lost-reason" placeholder="T.ex. Valde annan leverantör, priset för högt…"></div>`,
      buttons: [
        { label: 'Markera förlorad', cls: 'btn bd', onClick: () => {
          op.status = 'lost'; op.completedAt = new Date().toISOString(); op.updatedAt = new Date().toISOString();
          const r = document.getElementById('lost-reason')?.value.trim();
          if (r) op.reason = (op.reason ? op.reason + ' · Förlorad: ' : 'Förlorad: ') + r;
          ActivityService.log('sales_opportunity_lost', `Säljchans förlorad: ${op.title}`, { customerId: op.customerId, salesOpportunityId: op.id });
          persist(); Modal.close(); Sidebar.updateBadges(); SalesPage.render(); showToast('Markerad förlorad');
        }},
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  dismiss(opId) {
    Modal.confirm('Avfärda säljchansen?', () => {
      const op = getSO(opId);
      if (!op) return;
      op.status = 'dismissed'; op.updatedAt = new Date().toISOString();
      persist(); Sidebar.updateBadges(); SalesPage.render(); showToast('Avfärdad');
    });
  }
};
