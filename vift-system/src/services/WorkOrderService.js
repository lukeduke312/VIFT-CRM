/**
 * WorkOrderService — CRUD och statuslogik för arbetsorder
 */
const WorkOrderService = {

  create(data) {
    const ao = Object.assign(Schema.workOrder(), data, {
      id:        newId(state.workOrders, 'AO'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    state.workOrders.push(ao);
    const cu = getCu(ao.customerId);
    ActivityService.log('work_order_created',
      `Arbetsorder ${ao.id} skapad: ${ao.title}`,
      { customerId: ao.customerId, workOrderId: ao.id });
    persist();
    Sidebar.updateBadges();
    return ao;
  },

  update(id, data) {
    const ao = getAO(id);
    if (!ao) return null;
    Object.assign(ao, data, { updatedAt: new Date().toISOString() });
    ActivityService.log('work_order_updated',
      `Arbetsorder ${ao.id} redigerad: ${ao.title}`,
      { customerId: ao.customerId, workOrderId: ao.id });
    persist();
    return ao;
  },

  setStatus(id, status) {
    const ao = getAO(id);
    if (!ao) return null;
    const prev = ao.status;
    ao.status    = status;
    ao.updatedAt = new Date().toISOString();
    if (status === 'klar') ao.completedAt = new Date().toISOString();
    ActivityService.log('work_order_status',
      `Arbetsorder ${ao.id} ändrad: ${statusLabel(prev)} → ${statusLabel(status)}`,
      { customerId: ao.customerId, workOrderId: ao.id });
    persist();
    Sidebar.updateBadges();
    return ao;
  },

  markComplete(id, completedBy) {
    const ao = getAO(id);
    if (ao && completedBy) ao.completedBy = completedBy;
    return this.setStatus(id, 'klar');
  },

  /* Checklista */
  addChecklist(aoId, text) {
    const ao = getAO(aoId);
    if (!ao) return;
    ao.checklist = ao.checklist || [];
    ao.checklist.push({ id: 'c' + Date.now(), text, done: false });
    ao.updatedAt = new Date().toISOString();
    persist();
  },

  toggleChecklist(aoId, idx) {
    const ao = getAO(aoId);
    if (!ao || !ao.checklist[idx]) return;
    ao.checklist[idx].done = !ao.checklist[idx].done;
    ao.updatedAt = new Date().toISOString();
    persist();
  },

  removeChecklist(aoId, idx) {
    const ao = getAO(aoId);
    if (!ao) return;
    ao.checklist.splice(idx, 1);
    ao.updatedAt = new Date().toISOString();
    persist();
  },

  /* Material */
  addMaterial(aoId, mat) {
    const ao = getAO(aoId);
    if (!ao) return;
    ao.materials = ao.materials || [];
    const entry = Object.assign({ id: 'M' + Date.now() }, mat);
    ao.materials.push(entry);
    ao.updatedAt = new Date().toISOString();
    ActivityService.log('material_added',
      `Material tillagt på ${ao.id}: ${mat.name}`,
      { workOrderId: aoId, customerId: ao.customerId });
    persist();
    return entry;
  },

  updateMaterial(aoId, matId, data) {
    const ao = getAO(aoId);
    if (!ao) return;
    const mat = (ao.materials || []).find(m => m.id === matId);
    if (mat) { Object.assign(mat, data); ao.updatedAt = new Date().toISOString(); persist(); }
  },

  deleteMaterial(aoId, matId) {
    const ao = getAO(aoId);
    if (!ao) return;
    ao.materials = (ao.materials || []).filter(m => m.id !== matId);
    ao.updatedAt = new Date().toISOString();
    ActivityService.log('material_removed', `Material borttaget från ${ao.id}`,
      { workOrderId: aoId, customerId: ao.customerId });
    persist();
  },

  /* Anteckningar */
  addNote(aoId, text, imageData = '') {
    const ao = getAO(aoId);
    if (!ao) return;
    ao.notes = ao.notes || [];
    const n = {
      id:        'N' + Date.now(),
      text,
      imageData,
      staffName: state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '',
      timestamp: new Date().toISOString()
    };
    ao.notes.push(n);
    ao.updatedAt = new Date().toISOString();
    persist();
    return n;
  },

  /* Materialprissummering */
  materialTotal(ao) {
    return (ao.materials || []).reduce((s, m) => s + (m.qty || 0) * (m.sellPrice || 0), 0);
  },

  /* Klara denna månad */
  doneThisMonth() {
    const m = tdy().substring(0, 7);
    return (state.workOrders || []).filter(a =>
      a.status === 'klar' && (a.completedAt || '').startsWith(m)
    ).length;
  },

  /* Ordrar redo för fakturering */
  readyForInvoice() {
    return (state.workOrders || []).filter(a =>
      a.status === 'klar' && !a.invoiceId
    );
  }
};
