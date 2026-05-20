/**
 * RecurringOrderService — Återkommande ärenden
 */
const RecurringOrderService = {

  INTERVALS: [
    { value: 'dagligen',       label: 'Dagligen',       days: 1 },
    { value: 'veckovis',       label: 'Veckovis',       days: 7 },
    { value: 'varannan_vecka', label: 'Varannan vecka', days: 14 },
    { value: 'månadsvis',      label: 'Månadsvis',      days: 30 },
    { value: 'kvartalsvis',    label: 'Kvartalsvis',    days: 91 },
    { value: 'årsvis',         label: 'Årsvis',         days: 365 },
    { value: 'eget',           label: 'Eget intervall', days: null }
  ],

  create(data) {
    const ro = Object.assign(Schema.recurringOrder(), data, {
      id:        newId(state.recurringOrders || [], 'RO'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    if (!ro.nextDate && ro.startDate) ro.nextDate = ro.startDate;
    state.recurringOrders = state.recurringOrders || [];
    state.recurringOrders.push(ro);
    ActivityService.log('recurring_order_created',
      `Återkommande ärende ${ro.id} skapat: ${ro.title}`,
      { customerId: ro.customerId });
    persist();
    return ro;
  },

  update(id, data) {
    const ro = this.getById(id);
    if (!ro) return null;
    Object.assign(ro, data, { updatedAt: new Date().toISOString() });
    persist();
    return ro;
  },

  delete(id) {
    state.recurringOrders = (state.recurringOrders || []).filter(r => r.id !== id);
    persist();
  },

  getById(id) {
    return (state.recurringOrders || []).find(r => r.id === id) || null;
  },

  getAll() {
    return state.recurringOrders || [];
  },

  getActive() {
    return (state.recurringOrders || []).filter(r => r.status === 'aktiv');
  },

  getDaysForInterval(ro) {
    if (ro.interval === 'eget') return ro.intervalDays || 30;
    const def = this.INTERVALS.find(i => i.value === ro.interval);
    return def ? def.days : 30;
  },

  intervalLabel(interval) {
    const def = this.INTERVALS.find(i => i.value === interval);
    return def ? def.label : interval;
  },

  /* Skapa nästa AO från recurring order */
  createNextAO(roId) {
    const ro = this.getById(roId);
    if (!ro || ro.status !== 'aktiv') return { ok: false, error: 'Ärende ej aktivt' };

    const aoData = {
      title:         ro.title,
      description:   ro.description || '',
      customerId:    ro.customerId,
      propertyId:    ro.propertyId || '',
      address:       ro.address || '',
      contactPerson: ro.contactPerson || '',
      phone:         ro.phone || '',
      internalNote:  ro.internalNote || '',
      priority:      ro.priority || 'normal',
      priceType:     ro.priceType || 'ej_satt',
      priceGroupId:  ro.priceGroupId || '',
      fixedPrice:    ro.fixedPrice || 0,
      staff:         ro.staff ? [...ro.staff] : [],
      scheduledDate: ro.nextDate || tdy(),
      checklist:     (ro.checklist || []).map(c => ({
        id:   'c' + Date.now() + Math.random().toString(36).slice(2),
        text: c.text,
        done: false
      })),
      recurringOrderId: ro.id
    };

    const ao = WorkOrderService.create(aoData);

    // Beräkna nästa datum
    const days = this.getDaysForInterval(ro);
    const nextTs  = new Date(ro.nextDate || tdy());
    nextTs.setDate(nextTs.getDate() + days);
    const nextDate = nextTs.toISOString().split('T')[0];

    const updates = {
      lastCreatedDate: tdy(),
      nextDate
    };

    // Kontrollera endDate / tillsvidare
    if (!ro.tillsvidare && ro.endDate && nextDate > ro.endDate) {
      updates.status = 'avslutad';
    }

    this.update(roId, updates);
    ActivityService.log('work_order_created',
      `AO ${ao.id} skapad från återkommande ärende ${ro.id}`,
      { workOrderId: ao.id, customerId: ro.customerId });
    return { ok: true, ao };
  },

  /* Hur många dagar till nästa datum */
  daysUntilNext(ro) {
    if (!ro.nextDate) return null;
    const diff = Math.ceil((new Date(ro.nextDate) - new Date(tdy())) / 86400000);
    return diff;
  }
};
