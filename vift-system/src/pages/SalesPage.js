/**
 * SalesPage — Säljchanser / CRM pipeline
 */
const SalesPage = {
  _filter: 'active',

  render() {
    const el = document.getElementById('pg-sales-content');
    if (!el) return;

    const allOps = state.salesOpportunities || [];
    const counts = {
      active:  allOps.filter(s => ['new','contacted','contact_needed'].includes(s.status)).length,
      snoozed: allOps.filter(s => s.status === 'snoozed').length,
      done:    allOps.filter(s => ['won','lost','done','dismissed'].includes(s.status)).length,
    };

    let list = allOps;
    if (this._filter === 'active')  list = list.filter(s => ['new','contacted','contact_needed'].includes(s.status));
    else if (this._filter === 'snoozed') list = list.filter(s => s.status === 'snoozed');
    else if (this._filter === 'done')    list = list.filter(s => ['won','lost','done','dismissed'].includes(s.status));

    list = list.slice().sort((a,b) => {
      const p = {high:0,medium:1,low:2};
      return (p[a.priority]||1) - (p[b.priority]||1);
    });

    el.innerHTML =
      `<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;">
        <div class="ftabs" style="flex:1;margin-bottom:0;">
          <button class="ft ${this._filter==='active'?'on':''}" onclick="SalesPage._filter='active';SalesPage.render()">Aktiva${counts.active>0?' ('+counts.active+')':''}</button>
          <button class="ft ${this._filter==='snoozed'?'on':''}" onclick="SalesPage._filter='snoozed';SalesPage.render()">Uppskjutna${counts.snoozed>0?' ('+counts.snoozed+')':''}</button>
          <button class="ft ${this._filter==='done'?'on':''}" onclick="SalesPage._filter='done';SalesPage.render()">Avslutade${counts.done>0?' ('+counts.done+')':''}</button>
        </div>
        <button class="btn bp bsm" onclick="SalesPage.openCreate()">${ic('plus',14)} Ny chans</button>
       </div>` +
      (list.length === 0
        ? `<div class="empty">${ic('target',32)}<h3>Inga säljchanser</h3><p>${this._filter==='active'?'Inga aktiva säljchanser just nu.':this._filter==='snoozed'?'Inga uppskjutna.':'Inga avslutade.'}</p>${this._filter==='active'?`<button class="btn bp" style="margin-top:12px;" onclick="SalesPage.openCreate()">${ic('plus',14)} Skapa säljchans</button>`:''}</div>`
        : list.map(op => this._renderCard(op)).join('')
      );
  },

  _renderCard(op) {
    const cu = getCu(op.customerId);
    const cuName = cu ? CustomerService.displayName(cu) : '—';
    const prioColors = { high:'bdg-red', medium:'bdg-orange', low:'bdg-grey' };
    const prioLabels = { high:'Hög', medium:'Medium', low:'Låg' };
    const typeLabels = {
      service_agreement:'Serviceavtal', seasonal_job:'Säsongsarbete',
      upsell:'Merförsäljning', quote_followup:'Offertuppföljning', win_back:'Vinn tillbaka'
    };
    const isDone = ['won','lost','done','dismissed'].includes(op.status);
    const wonLostBadge = op.status === 'won'
      ? `<span class="bdg bdg-green" style="font-size:10px;">${ic('check-circle',10)} Vunnen</span>`
      : op.status === 'lost'
      ? `<span class="bdg bdg-red" style="font-size:10px;">${ic('x',10)} Förlorad</span>`
      : op.status === 'dismissed'
      ? `<span class="bdg bdg-grey" style="font-size:10px;">Avfärdad</span>`
      : '';

    return `
      <div class="card" style="margin-bottom:10px;${isDone?'opacity:.75':''}">
        <div class="card-header">
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:800;margin-bottom:4px;">${op.title}</div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;">
              <span class="bdg ${prioColors[op.priority]||'bdg-grey'}">${prioLabels[op.priority]||op.priority}</span>
              ${op.type ? `<span class="bdg bdg-sky" style="font-size:10px;">${typeLabels[op.type]||op.type}</span>` : ''}
              ${wonLostBadge || sbdg(op.status)}
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
          ${op.reason ? `<div class="dr"><span class="dk">Varför</span><span class="dv">${op.reason}</span></div>` : ''}
          ${op.estimatedValue > 0 ? `<div class="dr"><span class="dk">Est. värde</span><span class="dv">${fmt(op.estimatedValue)} kr</span></div>` : ''}
          ${op.dueDate ? `<div class="dr"><span class="dk">Deadline</span><span class="dv">${fmtDate(op.dueDate)}</span></div>` : ''}
          ${op.status === 'snoozed' && op.snoozedUntil ? `<div class="dr"><span class="dk">Återkom</span><span class="dv">${fmtDate(op.snoozedUntil)}</span></div>` : ''}
          ${op.suggestedAction ? `
            <div style="background:var(--acc);border-radius:8px;padding:10px 12px;margin:8px 0;">
              <div style="font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Rekommenderad åtgärd</div>
              <div style="font-size:13px;font-weight:600;">${op.suggestedAction}</div>
            </div>` : ''}
          ${op.aiTip ? `
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;margin-bottom:8px;">
              <div style="font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${ic('zap',10)} Tips</div>
              <div style="font-size:12px;color:#78350f;line-height:1.5;">${op.aiTip}</div>
            </div>` : ''}
          ${!isDone ? `
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid var(--bg);">
            <button class="btn bsm bp" onclick="SalesPage.createAO('${op.id}')">${ic('clipboard-list',13)} Skapa AO</button>
            ${op.status !== 'snoozed' ? `<button class="btn bsm bghost" onclick="SalesPage.openSnooze('${op.id}')">${ic('pause-circle',13)} Skjut upp</button>` : `<button class="btn bsm bsu" onclick="SalesPage.wakeUp('${op.id}')">${ic('play-circle',13)} Återaktivera</button>`}
            <button class="btn bsm bsu" onclick="SalesPage.markWon('${op.id}')">${ic('check-circle',13)} Vunnen</button>
            <button class="btn bsm bw" onclick="SalesPage.markLost('${op.id}')">${ic('x-circle',13)} Förlorad</button>
            <button class="btn bsm bd" onclick="SalesPage.dismiss('${op.id}')">${ic('trash-2',13)} Avfärda</button>
          </div>` : ''}
        </div>
      </div>`;
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
          <select id="so-cu">
            <option value="">— Välj kund —</option>
            ${(state.customers||[]).map(c=>`<option value="${c.id}" ${v('customerId')===c.id?'selected':''}>${CustomerService.displayName(c)}</option>`).join('')}
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
      <div class="fg"><label>Deadline / åtgärd senast</label>
        <input type="date" id="so-due" value="${v('dueDate')}"></div>
      <div class="fg"><label>Beskrivning / orsak</label>
        <textarea id="so-reason" rows="2" placeholder="Varför är detta en möjlighet?">${v('reason')}</textarea></div>
      <div class="fg"><label>Rekommenderad åtgärd</label>
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
    const data = {
      title,
      customerId:     document.getElementById('so-cu')?.value || '',
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
