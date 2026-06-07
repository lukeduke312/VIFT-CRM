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
  },

  /* ── Arkiv & Papperskorg ────────────── */

  archive(id) {
    const ao = getAO(id);
    if (!ao) return;
    const by = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '';
    ao.archived   = true;
    ao.archivedAt = new Date().toISOString();
    ao.archivedBy = by;
    ao.updatedAt  = new Date().toISOString();
    ActivityService.log('work_order_archived', `Arbetsorder ${ao.id} arkiverad`, { workOrderId: id, customerId: ao.customerId });
    persist();
    Sidebar.updateBadges();
  },

  restoreFromArchive(id) {
    const ao = getAO(id);
    if (!ao) return;
    ao.archived   = false;
    ao.archivedAt = '';
    ao.archivedBy = '';
    ao.updatedAt  = new Date().toISOString();
    ActivityService.log('work_order_restored', `Arbetsorder ${ao.id} återställd från arkiv`, { workOrderId: id, customerId: ao.customerId });
    persist();
    Sidebar.updateBadges();
  },

  softDelete(id) {
    const ao = getAO(id);
    if (!ao) return;
    const by  = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '';
    const now = new Date();
    ao.deleted     = true;
    ao.deletedAt   = now.toISOString();
    ao.deletedBy   = by;
    ao.deleteAfter = new Date(now.getTime() + 14 * 86400000).toISOString();
    ao.updatedAt   = now.toISOString();
    ActivityService.log('work_order_deleted', `Arbetsorder ${ao.id} borttagen (papperskorg)`, { workOrderId: id, customerId: ao.customerId });
    persist();
    Sidebar.updateBadges();
  },

  restoreFromTrash(id) {
    const ao = getAO(id);
    if (!ao) return;
    ao.deleted     = false;
    ao.deletedAt   = '';
    ao.deletedBy   = '';
    ao.deleteAfter = '';
    ao.updatedAt   = new Date().toISOString();
    ActivityService.log('work_order_restored', `Arbetsorder ${ao.id} återställd från papperskorg`, { workOrderId: id, customerId: ao.customerId });
    persist();
    Sidebar.updateBadges();
  },

  permanentDelete(id) {
    const idx = state.workOrders.findIndex(a => a.id === id);
    if (idx === -1) return;
    const ao = state.workOrders[idx];
    ActivityService.log('work_order_permanent_delete', `Arbetsorder ${id} raderad permanent`, { workOrderId: id, customerId: ao ? ao.customerId : '' });
    state.workOrders.splice(idx, 1);
    persist();
    Sidebar.updateBadges();
  },

  updateStaff(aoId, opts = {}) {
    const ao = getAO(aoId);
    if (!ao) return;
    const user = state.currentUser;
    const by = user ? `${user.firstName} ${user.lastName}`.trim() : 'Okänd';
    const { staffIds = [], responsibleStaffId = '', moveToPool = false } = opts;
    const oldStaff = [...(ao.staff || [])];
    const oldResp  = ao.responsibleStaffId || '';
    ao.log = ao.log || [];

    if (moveToPool) {
      ao.staff = [];
      ao.status = 'pool';
      ao.responsibleStaffId = '';
      ao.log.push({ id: 'L'+Date.now(), type: 'staff_changed', text: `${by} flyttade ordern till arbetspoolen`, userName: by, timestamp: new Date().toISOString() });
    } else {
      const staffName = id => { const s = getStaff(id); return s ? `${s.firstName} ${s.lastName}` : id; };
      const added   = staffIds.filter(id => !oldStaff.includes(id));
      const removed = oldStaff.filter(id => !staffIds.includes(id));
      ao.staff = staffIds;
      ao.responsibleStaffId = responsibleStaffId;
      if (ao.status === 'pool' && staffIds.length > 0) ao.status = 'planerad';
      const t = Date.now();
      if (added.length > 0)
        ao.log.push({ id: 'L'+t,   type: 'staff_added',       text: `${by} lade till: ${added.map(staffName).join(', ')}`,   userName: by, timestamp: new Date().toISOString() });
      if (removed.length > 0)
        ao.log.push({ id: 'L'+(t+1), type: 'staff_removed',   text: `${by} tog bort: ${removed.map(staffName).join(', ')}`, userName: by, timestamp: new Date().toISOString() });
      if (responsibleStaffId !== oldResp)
        ao.log.push({ id: 'L'+(t+2), type: 'staff_responsible', text: `${by} satte ansvarig: ${responsibleStaffId ? staffName(responsibleStaffId) : 'Ingen'}`, userName: by, timestamp: new Date().toISOString() });
    }

    ao.updatedAt = new Date().toISOString();
    ActivityService.log('work_order_updated', `Personal ändrad på ${ao.id}`, { workOrderId: aoId, customerId: ao.customerId });
    persist();
    Sidebar.updateBadges();
  },

  takeFromPool(aoId) {
    const ao   = getAO(aoId);
    const user = state.currentUser;
    if (!ao || ao.status !== 'pool' || !user) return null;
    if (!(ao.staff || []).includes(user.id)) {
      ao.staff = [...(ao.staff || []), user.id];
    }
    ao.status    = 'planerad';
    ao.updatedAt = new Date().toISOString();
    const staffName = `${user.firstName} ${user.lastName}`.trim();
    ao.log = ao.log || [];
    ao.log.push({
      id: 'L' + Date.now(), type: 'taken_from_pool',
      text: `${staffName} tog jobbet från arbetspoolen`,
      userName: staffName, timestamp: new Date().toISOString()
    });
    ActivityService.log('work_order_assigned',
      `${staffName} tog ${ao.id} från arbetspoolen`,
      { workOrderId: aoId, customerId: ao.customerId });
    persist();
    Sidebar.updateBadges();
    return ao;
  }
};
