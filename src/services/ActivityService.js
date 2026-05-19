/**
 * ActivityService — Central aktivitetslogg
 * Används av hela systemet för att spåra händelser
 */

const ActivityService = {

  MAX_ENTRIES: 500,

  /**
   * Logga en aktivitet
   */
  log(type, description, meta = {}) {
    const entry = {
      id: 'ACT-' + Date.now(),
      type,
      description,
      timestamp: new Date().toISOString(),
      customerId:          meta.customerId          || '',
      propertyId:          meta.propertyId          || '',
      workOrderId:         meta.workOrderId         || '',
      offerId:             meta.offerId             || '',
      invoiceId:           meta.invoiceId           || '',
      salesOpportunityId:  meta.salesOpportunityId  || '',
      inspectionId:        meta.inspectionId        || '',
      userId:              (state.currentUser && state.currentUser.id) || ''
    };

    if (!state.activityLog) state.activityLog = [];
    state.activityLog.unshift(entry);

    // Begränsa till MAX_ENTRIES
    if (state.activityLog.length > this.MAX_ENTRIES) {
      state.activityLog = state.activityLog.slice(0, this.MAX_ENTRIES);
    }

    persist();
    return entry;
  },

  /**
   * Hämta senaste aktiviteter (alla)
   */
  getRecent(limit = 20) {
    return (state.activityLog || []).slice(0, limit);
  },

  /**
   * Filtrera per kund
   */
  getByCustomer(customerId, limit = 50) {
    return (state.activityLog || [])
      .filter(e => e.customerId === customerId)
      .slice(0, limit);
  },

  /**
   * Filtrera per arbetsorder
   */
  getByWorkOrder(workOrderId, limit = 50) {
    return (state.activityLog || [])
      .filter(e => e.workOrderId === workOrderId)
      .slice(0, limit);
  },

  /**
   * Filtrera per säljchans
   */
  getBySalesOpp(salesOpportunityId, limit = 50) {
    return (state.activityLog || [])
      .filter(e => e.salesOpportunityId === salesOpportunityId)
      .slice(0, limit);
  },

  /**
   * Filtrera per typ
   */
  getByType(type, limit = 50) {
    return (state.activityLog || [])
      .filter(e => e.type === type)
      .slice(0, limit);
  },

  /**
   * Rendera ett log-objekt som HTML (för dashboard)
   */
  renderEntry(entry) {
    const dotColor = this._dotColor(entry.type);
    const timeStr  = relDate(entry.timestamp);
    return `
      <div class="act-item">
        <div class="act-dot ${dotColor}"></div>
        <span class="act-text">${this._escHtml(entry.description)}</span>
        <span class="act-time">${timeStr}</span>
      </div>`;
  },

  /**
   * Rendera lista av logg-poster
   */
  renderList(entries) {
    if (!entries || entries.length === 0) {
      return '<div class="empty" style="padding:16px;"><span class="empty-ico">📋</span><p>Ingen aktivitet ännu</p></div>';
    }
    return entries.map(e => this.renderEntry(e)).join('');
  },

  _dotColor(type) {
    const map = {
      work_order_created:   'blue',
      work_order_completed: 'green',
      work_order_updated:   '',
      customer_created:     'green',
      offer_created:        'blue',
      offer_sent:           'blue',
      offer_accepted:       'green',
      offer_declined:       'red',
      invoice_created:      'purple',
      invoice_paid:         'green',
      sales_opportunity_created: '',
      sales_opportunity_done:    'green',
      sales_opportunity_snoozed: 'orange',
      sales_opportunity_order:   'green',
      sales_opportunity_quote:   'blue',
      time_entry_created:   '',
      inspection_completed: 'green'
    };
    return map[type] || '';
  },

  _escHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};
