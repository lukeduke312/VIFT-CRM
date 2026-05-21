/**
 * SalesService — Säljchanser / CRM-pipeline
 * Fas 1: Visa, filtrera, markera klar, skjut upp
 * Fas 3: Fullt CRM-flöde
 */

const SalesService = {

  /**
   * Hämta alla aktiva säljchanser (ej done/dismissed)
   */
  getActive() {
    const today = tdy();
    return (state.salesOpportunities || []).filter(o => {
      if (['done', 'dismissed', 'won', 'lost'].includes(o.status)) return false;
      if (o.status === 'snoozed' && o.snoozedUntil && o.snoozedUntil > today) return false;
      return true;
    }).sort((a, b) => {
      const pOrder = { high: 0, medium: 1, low: 2 };
      return (pOrder[a.priority] || 1) - (pOrder[b.priority] || 1);
    });
  },

  /**
   * Hämta uppskjutna
   */
  getSnoozed() {
    const today = tdy();
    return (state.salesOpportunities || []).filter(o =>
      o.status === 'snoozed' && o.snoozedUntil && o.snoozedUntil > today
    );
  },

  /**
   * Hämta klara/vunna/förlorade
   */
  getDone() {
    return (state.salesOpportunities || []).filter(o =>
      ['done', 'won', 'lost', 'dismissed'].includes(o.status)
    ).slice(0, 50);
  },

  /**
   * Markera klar
   */
  markDone(id) {
    const opp = getSO(id);
    if (!opp) return;
    opp.status      = 'done';
    opp.completedAt = new Date().toISOString();
    opp.completedBy = state.currentUser ? state.currentUser.id : '';
    opp.updatedAt   = new Date().toISOString();

    ActivityService.log(
      'sales_opportunity_done',
      `Säljchans klar: ${opp.title}`,
      { customerId: opp.customerId, salesOpportunityId: opp.id }
    );
    persist();
  },

  /**
   * Skjut upp (snooze)
   */
  snooze(id, untilDate) {
    const opp = getSO(id);
    if (!opp) return;
    opp.status       = 'snoozed';
    opp.snoozedUntil = untilDate;
    opp.updatedAt    = new Date().toISOString();

    ActivityService.log(
      'sales_opportunity_snoozed',
      `Säljchans uppskjuten till ${fmtDate(untilDate)}: ${opp.title}`,
      { customerId: opp.customerId, salesOpportunityId: opp.id }
    );
    persist();
  },

  /**
   * Koppla en arbetsorder till säljchansen
   */
  linkWorkOrder(id, workOrderId) {
    const opp = getSO(id);
    if (!opp) return;
    opp.status               = 'work_order_created';
    opp.convertedWorkOrderId = workOrderId;
    opp.updatedAt            = new Date().toISOString();

    ActivityService.log(
      'sales_opportunity_order',
      `Order skapad från säljchans: ${opp.title}`,
      { customerId: opp.customerId, salesOpportunityId: opp.id, workOrderId }
    );
    persist();
  },

  /**
   * Koppla en offert till säljchansen
   */
  linkOffer(id, offerId) {
    const opp = getSO(id);
    if (!opp) return;
    opp.status            = 'quote_created';
    opp.convertedQuoteId  = offerId;
    opp.updatedAt         = new Date().toISOString();

    ActivityService.log(
      'sales_opportunity_quote',
      `Offert skapad från säljchans: ${opp.title}`,
      { customerId: opp.customerId, salesOpportunityId: opp.id, offerId }
    );
    persist();
  },

  /**
   * Skapa ny säljchans
   */
  create(data) {
    const opp = Object.assign(Schema.salesOpportunity(), data, {
      id:        newId(state.salesOpportunities, 'SO'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    state.salesOpportunities.unshift(opp);

    ActivityService.log(
      'sales_opportunity_created',
      `Säljchans skapad: ${opp.title}`,
      { customerId: opp.customerId, salesOpportunityId: opp.id }
    );
    persist();
    return opp;
  },

  /**
   * Rendera prioritets-ikon
   */
  priorityIcon(priority) {
    return priority === 'high' ? '🔴' : priority === 'medium' ? '🟡' : '🟢';
  },

  /**
   * Rendera ett kort för dashboard
   */
  renderDashCard(opp) {
    const cu   = getCu(opp.customerId);
    const cuName = cu ? cu.name || `${cu.firstName} ${cu.lastName}`.trim() : '—';
    const due  = opp.dueDate ? `Åtgärd senast ${fmtDate(opp.dueDate)}` : '';
    const val  = opp.estimatedValue ? ` · ~${fmt(opp.estimatedValue)} kr` : '';

    return `
    <div class="sales-card ${opp.priority}" id="so-card-${opp.id}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div class="sales-title">${ActivityService._escHtml(opp.title)}</div>
          <div class="sales-meta">${ActivityService._escHtml(cuName)}${val}${due ? ' · ' + due : ''}</div>
          ${opp.aiTip ? `<div class="sales-tip">💡 ${ActivityService._escHtml(opp.aiTip)}</div>` : ''}
        </div>
        <span class="bdg ${statusClass(opp.status)}" style="flex-shrink:0;">${statusLabel(opp.status)}</span>
      </div>
      <div class="sales-actions">
        <button class="btn bsm bs" onclick="SalesService.openCustomer('${opp.customerId}')">Kund</button>
        <button class="btn bsm bs" onclick="SalesService.openSnooze('${opp.id}')">Skjut upp</button>
        <button class="btn bsm bsu" onclick="SalesService.markDoneUI('${opp.id}')">Klar</button>
      </div>
    </div>`;
  },

  openCustomer(customerId) {
    Router.showPage('pg-crm-detail', { customerId });
  },

  openSnooze(id) {
    const opp = getSO(id);
    if (!opp) return;
    const def = new Date(Date.now() + 7 * 24 * 3600000).toISOString().split('T')[0];

    Modal.open({
      title: 'Skjut upp säljchans',
      body: `
        <p style="font-size:13px;color:var(--mt);margin-bottom:12px;">
          ${ActivityService._escHtml(opp.title)}
        </p>
        <div class="fg">
          <label>Återkom datum</label>
          <input type="date" id="snooze-date" value="${def}" min="${tdy()}">
        </div>`,
      buttons: [
        { label: 'Skjut upp', cls: 'btn bp bfull', onClick: () => {
            const d = document.getElementById('snooze-date').value;
            if (!d) { showToast('Välj datum'); return; }
            SalesService.snooze(id, d);
            Modal.close();
            Sidebar.updateBadges();
            Dashboard.render();
            showToast('Säljchans uppskjuten');
          }
        },
        { label: 'Avbryt', cls: 'btn bs', onClick: () => Modal.close() }
      ]
    });
  },

  markDoneUI(id) {
    const opp = getSO(id);
    if (!opp) return;
    Modal.confirm(
      `Markera "${opp.title}" som klar?`,
      () => {
        SalesService.markDone(id);
        Sidebar.updateBadges();
        Dashboard.render();
        showToast('Säljchans markerad klar ✓');
      }
    );
  }
};
