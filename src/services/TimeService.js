/**
 * TimeService — Tidregistrering
 * Klocka in/ut, manuell tid, koppling till AO/kund
 */
const TimeService = {

  /* Klocka in */
  clockIn(aoId = null) {
    if (state.stampActive) return;
    state.stampActive    = true;
    state.stampTimestamp = Date.now();
    state.stampAoId      = aoId;
    Storage.set('stampActive', true);
    Storage.set('stampTs',     state.stampTimestamp);
    Storage.set('stampAoId',   aoId);
  },

  /* Klocka ut — returnerar skapad post */
  clockOut(opts = {}) {
    if (!state.stampActive) return null;

    const startTs   = state.stampTimestamp;
    const endTs     = Date.now();
    const minutes   = Math.round((endTs - startTs) / 60000);
    const startDate = new Date(startTs);
    const endDate   = new Date(endTs);
    const pad = n  => String(n).padStart(2, '0');
    const startStr  = `${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`;
    const endStr    = `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;
    const dateStr   = startDate.toISOString().split('T')[0];
    const aoId      = state.stampAoId;
    const pg        = opts.priceGroupId ? (state.priceGroups || []).find(p => p.id === opts.priceGroupId) : null;
    const ao        = aoId ? getAO(aoId) : null;

    const entry = {
      id:           newId(state.timeEntries, 'TID'),
      aoId:         aoId || '',
      customerId:   opts.customerId || (ao ? ao.customerId : ''),
      staffId:      state.currentUser ? state.currentUser.id : '',
      staffName:    state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '',
      date:         dateStr,
      startStr,
      endStr,
      startTs,
      endTs,
      minutes,
      comment:      opts.comment || '',
      priceGroupId: opts.priceGroupId || '',
      priceGroupName: pg ? pg.name : '',
      hourRate:     pg ? pg.hourRate : 0,
      billable:     opts.billable !== false,
      internal:     !!opts.internal,
      createdAt:    new Date().toISOString()
    };

    state.timeEntries = state.timeEntries || [];
    state.timeEntries.unshift(entry);

    if (ao) {
      ao.timeEntries = ao.timeEntries || [];
      ao.timeEntries.push(entry.id);
    }

    state.stampActive    = false;
    state.stampTimestamp = null;
    state.stampAoId      = null;
    Storage.set('stampActive', false);
    Storage.set('stampTs',     null);
    Storage.set('stampAoId',   null);

    ActivityService.log('time_entry_created',
      `Tid registrerad: ${minutes} min${aoId ? ' på ' + aoId : ''}`,
      { workOrderId: aoId || '', customerId: entry.customerId });
    persist();
    return entry;
  },

  /* Manuell tidsregistrering */
  saveManual(data) {
    const { date, startStr, endStr, aoId, customerId, priceGroupId,
            comment, billable, internal } = data;

    if (!date || !startStr || !endStr) return { ok: false, error: 'Datum, starttid och sluttid krävs' };

    const [sh, sm] = startStr.split(':').map(Number);
    const [eh, em] = endStr.split(':').map(Number);
    const minutes  = (eh * 60 + em) - (sh * 60 + sm);
    if (minutes <= 0) return { ok: false, error: 'Sluttid måste vara efter starttid' };

    const pg = priceGroupId ? (state.priceGroups || []).find(p => p.id === priceGroupId) : null;
    const ao = aoId ? getAO(aoId) : null;
    const resolvedCustomer = customerId || (ao ? ao.customerId : '');

    const entry = {
      id:            newId(state.timeEntries, 'TID'),
      aoId:          aoId || '',
      customerId:    resolvedCustomer,
      staffId:       state.currentUser ? state.currentUser.id : '',
      staffName:     state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '',
      date,
      startStr,
      endStr,
      minutes,
      comment:       comment || '',
      priceGroupId:  priceGroupId || '',
      priceGroupName: pg ? pg.name : '',
      hourRate:      pg ? pg.hourRate : 0,
      billable:      billable !== false,
      internal:      !!internal,
      createdAt:     new Date().toISOString()
    };

    state.timeEntries = state.timeEntries || [];
    state.timeEntries.unshift(entry);

    if (ao) {
      ao.timeEntries = ao.timeEntries || [];
      ao.timeEntries.push(entry.id);
    }

    ActivityService.log('time_entry_created',
      `Manuell tid: ${minutes} min${aoId ? ' på ' + aoId : ''}`,
      { workOrderId: aoId || '', customerId: resolvedCustomer });
    persist();
    return { ok: true, entry };
  },

  update(id, data) {
    const entry = (state.timeEntries || []).find(t => t.id === id);
    if (!entry) return;
    Object.assign(entry, data);
    if (data.startStr && data.endStr) {
      const [sh, sm] = data.startStr.split(':').map(Number);
      const [eh, em] = data.endStr.split(':').map(Number);
      entry.minutes = (eh * 60 + em) - (sh * 60 + sm);
    }
    persist();
  },

  delete(id) {
    const entry = (state.timeEntries || []).find(t => t.id === id);
    if (entry && entry.aoId) {
      const ao = getAO(entry.aoId);
      if (ao) ao.timeEntries = (ao.timeEntries || []).filter(tid => tid !== id);
    }
    state.timeEntries = (state.timeEntries || []).filter(t => t.id !== id);
    persist();
  },

  getByAO(aoId) {
    return (state.timeEntries || []).filter(t => t.aoId === aoId);
  },

  getAll() {
    return state.timeEntries || [];
  },

  totalMinutes(entries) {
    return (entries || []).reduce((s, t) => s + (t.minutes || 0), 0);
  },

  fmtDuration(minutes) {
    if (!minutes) return '0 min';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h} tim`;
    return `${h}t ${m}m`;
  },

  elapsedStr(startTs) {
    if (!startTs) return '0 min';
    return this.fmtDuration(Math.round((Date.now() - startTs) / 60000));
  }
};
