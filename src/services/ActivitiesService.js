/**
 * ActivitiesService — schemalagda uppföljningsuppgifter
 *
 * Separerat från ActivityService (audit-logg).
 * Aktiviteter är användar-skapade uppgifter med datum, ansvarig och status.
 *
 * Datamodell: { id, type, relatedType, relatedId, customerId,
 *               assignedTo, dueDate, dueTime, note, status, createdAt,
 *               createdBy, completedAt, completedBy }
 */
const ActivitiesService = {

  create(data) {
    if (!state.activities) state.activities = [];
    const id = newId(state.activities, 'ACT');
    const user = state.currentUser;
    const act = Object.assign({
      id,
      type:        'followup',
      relatedType: null,
      relatedId:   null,
      customerId:  null,
      assignedTo:  user ? user.id : null,
      dueDate:     tdy(),
      dueTime:     '',
      note:        '',
      status:      'open',
      createdAt:   new Date().toISOString(),
      createdBy:   user ? user.id : null,
      completedAt: null,
      completedBy: null
    }, data, { id });
    state.activities.push(act);
    persist();
    return act;
  },

  complete(id) {
    const act = this._get(id);
    if (!act) return;
    const user = state.currentUser;
    act.status      = 'done';
    act.completedAt = new Date().toISOString();
    act.completedBy = user ? user.id : null;
    persist();
    return act;
  },

  reschedule(id, newDate, newTime) {
    const act = this._get(id);
    if (!act) return;
    act.dueDate  = newDate;
    act.dueTime  = newTime || act.dueTime;
    act.status   = 'open';
    persist();
    return act;
  },

  update(id, changes) {
    const act = this._get(id);
    if (!act) return;
    Object.assign(act, changes);
    persist();
    return act;
  },

  delete(id) {
    const idx = (state.activities || []).findIndex(a => a.id === id);
    if (idx !== -1) { state.activities.splice(idx, 1); persist(); }
  },

  _get(id) {
    return (state.activities || []).find(a => a.id === id) || null;
  },

  getByRelated(relatedType, relatedId) {
    return (state.activities || []).filter(a => a.relatedType === relatedType && a.relatedId === relatedId);
  },

  getByAssignee(staffId) {
    return (state.activities || []).filter(a => a.assignedTo === staffId);
  },

  getOpen() {
    return (state.activities || []).filter(a => a.status === 'open');
  },

  getOverdue() {
    const today = tdy();
    return this.getOpen().filter(a => a.dueDate && a.dueDate < today);
  },

  getToday() {
    const today = tdy();
    return this.getOpen().filter(a => a.dueDate === today);
  },

  getUpcoming(days = 7) {
    const today = tdy();
    const limit = _ds(days);
    return this.getOpen().filter(a => a.dueDate && a.dueDate > today && a.dueDate <= limit);
  },

  getStats(staffId) {
    const all      = staffId ? this.getByAssignee(staffId) : (state.activities || []);
    const open     = all.filter(a => a.status === 'open');
    const today    = tdy();
    return {
      overdue:  open.filter(a => a.dueDate && a.dueDate < today).length,
      today:    open.filter(a => a.dueDate === today).length,
      upcoming: open.filter(a => a.dueDate && a.dueDate > today).length,
      done:     all.filter(a => a.status === 'done').length
    };
  },

  typeLabel(type) {
    return { followup:'Uppföljning', call:'Ring kund', meeting:'Möte', email:'Mejl', task:'Uppgift' }[type] || type;
  },

  typeIcon(type) {
    return { followup:'bell', call:'phone', meeting:'users', email:'mail', task:'check-square' }[type] || 'bell';
  }
};
