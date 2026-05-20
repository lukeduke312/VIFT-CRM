/**
 * SalesPage — Säljchanser
 */
const SalesPage = {
  _filter: 'active',

  render() {
    const el = document.getElementById('pg-sales-content');
    if (!el) return;

    const allOps = state.salesOpportunities || [];
    const counts = {
      active:  allOps.filter(function(s) { return ['new','contacted','contact_needed'].includes(s.status); }).length,
      snoozed: allOps.filter(function(s) { return s.status === 'snoozed'; }).length,
      done:    allOps.filter(function(s) { return ['won','lost','done','dismissed'].includes(s.status); }).length,
    };

    var list = allOps;
    if (this._filter === 'active')  list = list.filter(function(s) { return ['new','contacted','contact_needed'].includes(s.status); });
    else if (this._filter === 'snoozed') list = list.filter(function(s) { return s.status === 'snoozed'; });
    else if (this._filter === 'done')    list = list.filter(function(s) { return ['won','lost','done','dismissed'].includes(s.status); });

    var self = this;
    el.innerHTML =
      '<div class="ftabs" style="margin-bottom:8px;">' +
        '<button class="ft ' + (this._filter==='active'?'on':'') + '" onclick="SalesPage._filter=\'active\';SalesPage.render()">' +
          'Aktiva' + (counts.active > 0 ? ' (' + counts.active + ')' : '') +
        '</button>' +
        '<button class="ft ' + (this._filter==='snoozed'?'on':'') + '" onclick="SalesPage._filter=\'snoozed\';SalesPage.render()">' +
          'Uppskjutna' + (counts.snoozed > 0 ? ' (' + counts.snoozed + ')' : '') +
        '</button>' +
        '<button class="ft ' + (this._filter==='done'?'on':'') + '" onclick="SalesPage._filter=\'done\';SalesPage.render()">' +
          'Avslutade' + (counts.done > 0 ? ' (' + counts.done + ')' : '') +
        '</button>' +
      '</div>' +
      (list.length === 0
        ? '<div class="empty">' + ic('target',32) + '<h3>Inga säljchanser</h3><p>' + (this._filter==='active'?'Inga aktiva säljchanser':'Inga poster') + '</p></div>'
        : list.map(function(op) { return self._renderCard(op); }).join('')
      );
  },

  _renderCard(op) {
    const cu = getCu(op.customerId);
    const cuName = cu ? CustomerService.displayName(cu) : '—';
    const prioColors = { high: 'bdg-red', medium: 'bdg-orange', low: 'bdg-grey' };
    const prioLabels = { high: 'Hög', medium: 'Medium', low: 'Låg' };
    const typeLabels = {
      service_agreement: 'Serviceavtal',
      seasonal_job:      'Säsongsarbete',
      upsell:            'Merförsäljning',
      quote_followup:    'Offertuppföljning',
      win_back:          'Vinn tillbaka'
    };

    return `
      <div class="card" style="margin-bottom:10px;">
        <div class="card-header">
          <div style="flex:1;min-width:0;">
            <div style="font-size:14px;font-weight:800;margin-bottom:3px;">${op.title}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
              <span class="bdg ${prioColors[op.priority]||'bdg-grey'}">${prioLabels[op.priority]||op.priority}</span>
              ${op.type ? `<span class="bdg bdg-sky">${typeLabels[op.type]||op.type}</span>` : ''}
              ${sbdg(op.status)}
            </div>
          </div>
        </div>
        <div class="card-body">
          <div class="dr">
            <span class="dk">Kund</span>
            <span class="dv" style="cursor:pointer;color:var(--sky);"
              onclick="Router.showPage('pg-crm-detail',{customerId:'${op.customerId}'})">${cuName}</span>
          </div>
          ${op.reason ? `<div class="dr"><span class="dk">Orsak</span><span class="dv">${op.reason}</span></div>` : ''}
          ${op.suggestedAction ? `
            <div style="background:var(--acc);border-radius:8px;padding:10px 12px;margin:8px 0;">
              <div style="font-size:10px;font-weight:700;color:var(--mt);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Rekommenderad åtgärd</div>
              <div style="font-size:13px;font-weight:600;">${op.suggestedAction}</div>
            </div>` : ''}
          ${op.aiTip ? `
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;margin-bottom:8px;">
              <div style="font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">${ic('target',10)} AI-tips</div>
              <div style="font-size:12px;color:#78350f;line-height:1.5;">${op.aiTip}</div>
            </div>` : ''}
          ${op.estimatedValue > 0 ? `<div class="dr"><span class="dk">Est. värde</span><span class="dv">${fmt(op.estimatedValue)} kr</span></div>` : ''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
            <button class="btn bsm bp" onclick="SalesPage.createAO('${op.id}')">${ic('clipboard-list',13)} Skapa AO</button>
            <button class="btn bsm bs" onclick="SalesPage.createOffer('${op.id}')">${ic('file-text',13)} Skapa offert</button>
            ${op.status !== 'snoozed' ? `<button class="btn bsm bghost" onclick="SalesPage.snooze('${op.id}')">${ic('pause-circle',13)} Skjut upp</button>` : ''}
            <button class="btn bsm bsu" onclick="SalesPage.markDone('${op.id}')">${ic('check-circle',13)} Klar</button>
            <button class="btn bsm bd" onclick="SalesPage.dismiss('${op.id}')">${ic('x',13)} Avfärda</button>
          </div>
        </div>
      </div>`;
  },

  createAO(opId) {
    const op = getSO(opId);
    if (!op) return;
    SalesService.markDone(opId);
    Router.showPage('pg-ao');
    setTimeout(function() { WorkOrdersPage.openCreate(op.customerId); }, 100);
    showToast('Skapar arbetsorder…');
  },

  createOffer(opId) {
    showToast('Offerter byggs i Fas 3');
  },

  snooze(opId) {
    const until = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    SalesService.snooze(opId, until);
    SalesPage.render();
    Sidebar.updateBadges();
    showToast('Uppskjuten 7 dagar');
  },

  markDone(opId) {
    SalesService.markDone(opId);
    SalesPage.render();
    Sidebar.updateBadges();
    showToast('Markerad klar');
  },

  dismiss(opId) {
    Modal.confirm('Avfärda säljchansen?', function() {
      SalesService.markDone(opId);
      SalesPage.render();
      Sidebar.updateBadges();
      showToast('Avfärdad');
    });
  }
};
