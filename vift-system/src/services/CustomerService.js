/**
 * CustomerService — CRUD för kunder
 */
const CustomerService = {

  create(data) {
    const cu = Object.assign(Schema.customer(), data, {
      id:        newId(state.customers, 'K'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    state.customers.push(cu);
    ActivityService.log('customer_created', `Ny kund skapad: ${this.displayName(cu)}`,
      { customerId: cu.id });
    persist();
    return cu;
  },

  update(id, data) {
    const cu = getCu(id);
    if (!cu) return null;
    Object.assign(cu, data, { updatedAt: new Date().toISOString() });
    ActivityService.log('customer_updated', `Kund redigerad: ${this.displayName(cu)}`,
      { customerId: cu.id });
    persist();
    return cu;
  },

  delete(id) {
    const cu = getCu(id);
    if (!cu) return;
    const name = this.displayName(cu);
    state.customers = state.customers.filter(c => c.id !== id);
    ActivityService.log('customer_deleted', `Kund borttagen: ${name}`, {});
    persist();
  },

  displayName(cu) {
    if (!cu) return '—';
    return cu.type === 'privat'
      ? `${cu.firstName || ''} ${cu.lastName || ''}`.trim() || cu.name || '—'
      : cu.name || `${cu.firstName || ''} ${cu.lastName || ''}`.trim() || '—';
  },

  typeLabel(t) {
    return { privat: 'Privatperson', foretag: 'Företag', brf: 'BRF', fastighetsagare: 'Fastighetsägare' }[t] || t || '—';
  },

  search(q) {
    const ql = (q || '').toLowerCase();
    return (state.customers || []).filter(cu => {
      const name = this.displayName(cu).toLowerCase();
      return name.includes(ql)
        || (cu.orgNr || '').includes(ql)
        || (cu.phone || '').includes(ql)
        || (cu.email || '').toLowerCase().includes(ql)
        || (cu.city || '').toLowerCase().includes(ql);
    });
  },

  /* KPI-räkning */
  getActiveAOs(customerId) {
    return (state.workOrders || []).filter(a =>
      a.customerId === customerId && !['klar','fakturerad','avbruten'].includes(a.status)
    );
  },

  getOffers(customerId) {
    return (state.offers || []).filter(o => o.customerId === customerId);
  }
};
