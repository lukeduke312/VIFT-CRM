/**
 * TimeService — Tidregistrering
 * Klocka in/ut, manuell tid, koppling till AO/kund
 */
const TimeService = {

  /* V22: klocka in/ut kräver ao_time specifikt — payroll_manage ensamt räcker
     INTE (det är löneadministration, inte operativ tidsstämpling). Ingen
     state-/Storage-mutation får ske innan detta passerat.
     Returtyper bevarade så långt möjligt (MyJobsPage.js läser clockOut()s
     returvärde direkt som post-objektet — utanför denna releases filomfång,
     så kontraktet får inte ändras): clockIn → true/false, clockOut → post-
     objekt eller null, precis som innan (där null tidigare bara betydde
     "inte inklockad" — nu även "saknar behörighet"). Anroparen avgör alltså
     nekad operation på exakt samma sätt som redan gällde för clockOut. */
  clockIn(aoId = null) {
    if (!(typeof Auth !== 'undefined' && Auth.can('ao_time'))) return false;
    if (state.stampActive) return false;
    state.stampActive    = true;
    state.stampTimestamp = Date.now();
    state.stampAoId      = aoId;
    Storage.set('stampActive', true);
    Storage.set('stampTs',     state.stampTimestamp);
    Storage.set('stampAoId',   aoId);
    return true;
  },

  /* Klocka ut — returnerar skapad post, eller null (ej inklockad ELLER saknar ao_time) */
  clockOut(opts = {}) {
    if (!(typeof Auth !== 'undefined' && Auth.can('ao_time'))) return null;
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

  /* Manuell tidsregistrering.
     V22: overrideStaffName tas emot men litas ALDRIG på — staffName härleds
     alltid från den faktiska state.staff-posten när ett staffId anges. */
  saveManual(data) {
    const { date, startStr, endStr, aoId, customerId, priceGroupId,
            comment, billable, internal,
            staffId: overrideStaffId } = data;

    const canPayroll = typeof Auth !== 'undefined' && Auth.can('payroll_manage');
    const canOwnTime  = typeof Auth !== 'undefined' && Auth.can('ao_time');

    let targetStaffId, targetStaffName, isForOther;
    if (overrideStaffId) {
      /* Ett staffId angetts — verifiera mot riktig personal, lita inte på fri
         staffName-text från klienten. */
      const staffRec = (state.staff || []).find(s => s.id === overrideStaffId);
      if (!staffRec) return { ok: false, error: 'Angiven personal hittades inte.' };
      targetStaffId   = staffRec.id;
      targetStaffName = `${staffRec.firstName} ${staffRec.lastName}`.trim();
      isForOther = !state.currentUser || targetStaffId !== state.currentUser.id;
    } else {
      targetStaffId   = state.currentUser ? state.currentUser.id : '';
      targetStaffName = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '';
      isForOther = false;
    }

    /* V20/V22: skapa tid åt annan kräver payroll_manage. Egen manuell tid kräver
       ao_time ELLER payroll_manage — samma regel som _guardMutation för befintliga
       poster. Ingen state-mutation får ske innan detta passerat. */
    if (isForOther) {
      if (!canPayroll) {
        return { ok: false, error: 'Du saknar behörighet att registrera tid åt annan personal.' };
      }
    } else if (!canOwnTime && !canPayroll) {
      return { ok: false, error: 'Du saknar behörighet att registrera tid.' };
    }

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
      staffId:          targetStaffId,
      staffName:        targetStaffName,
      registeredById:   isForOther && state.currentUser ? state.currentUser.id : '',
      registeredByName: isForOther && state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '',
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

  /* Fält som endast payroll_manage/all får sätta via update() — förhindrar att en
     vanlig ao_time-användare programmatiskt flyttar sin egen post till någon annan
     eller skriver in vem som "egentligen" registrerade den. */
  _OWNERSHIP_FIELDS: ['staffId', 'staffName', 'registeredById', 'registeredByName'],
  /* Attestfält får ALDRIG sättas via generisk update() — enda vägen är det befintliga
     PayrollPage._toggleAttest()/_attestAll()-flödet, som redan kräver payroll_manage
     och skriver dessa fält direkt på posten (går inte via TimeService.update()). */
  _ATTEST_FIELDS: ['attested', 'attestedAt', 'attestedBy'],

  /* V19/V21: skyddsregel (server-oberoende, klientkontroll) —
     1. Attesterad post (entry.attested===true) är helt låst, även för payroll_manage,
        tills den låsts upp igen via PayrollPage._toggleAttest(id,false) (kräver payroll_manage).
        Undantag: 'all' (superadmin) kan alltid ändra/radera.
     2. Egen post kräver ao_time ELLER payroll_manage — INTE bara "är ägaren". Detta
        eftersom update()/delete() också anropas från WorkOrderDetailPage, som kan nås
        med enbart ao_view_own (utan ao_time) — det tidigare antagandet att alla som
        når hit har ao_time (t.ex. via pg-tid) stämmer inte generellt.
     3. Andras tidposter kräver payroll_manage. */
  _guardMutation(entry) {
    const isSuper = typeof Auth !== 'undefined' && Auth.can('all');
    if (isSuper) return { ok: true };
    if (entry.attested) {
      return { ok: false, error: 'Attesterad tid är låst och kan inte ändras. Kontakta löneansvarig för att låsa upp posten.' };
    }
    const isOwn      = state.currentUser && entry.staffId === state.currentUser.id;
    const canPayroll  = typeof Auth !== 'undefined' && Auth.can('payroll_manage');
    if (isOwn) {
      const canOwnTime = typeof Auth !== 'undefined' && Auth.can('ao_time');
      if (!canOwnTime && !canPayroll) {
        return { ok: false, error: 'Du saknar behörighet att registrera tid.' };
      }
      return { ok: true };
    }
    if (!canPayroll) {
      return { ok: false, error: 'Du saknar behörighet att ändra en annan persons tidpost.' };
    }
    return { ok: true };
  },

  /* V22: explicit avvisning istället för tyst strippning — en anropare som
     FAKTISKT försöker ändra ett skyddat fält utan behörighet ska få ok:false,
     inte ett ok:true som tyst ignorerar ändringen. Ett payload som råkar
     innehålla samma (oförändrade) värde som redan finns på posten räknas
     inte som ett ändringsförsök och blockeras inte. */
  update(id, data) {
    const entry = (state.timeEntries || []).find(t => t.id === id);
    if (!entry) return { ok: false, error: 'Posten hittades inte' };
    const guard = this._guardMutation(entry);
    if (!guard.ok) return guard;

    const canPayroll = typeof Auth !== 'undefined' && Auth.can('payroll_manage');
    const safeData = Object.assign({}, data);
    const changed = function (f) {
      return Object.prototype.hasOwnProperty.call(safeData, f) && safeData[f] !== entry[f];
    };

    /* Attestfält: kan aldrig ändras via update() — enda vägen är PayrollPage. */
    for (let i = 0; i < this._ATTEST_FIELDS.length; i++) {
      if (changed(this._ATTEST_FIELDS[i])) {
        return { ok: false, error: 'Attestfält kan bara ändras via löneunderlagets attesteringsflöde.' };
      }
    }
    this._ATTEST_FIELDS.forEach(function (f) { delete safeData[f]; });

    /* Ägarskapsfält: ett faktiskt ändringsförsök utan payroll_manage nekas helt. */
    for (let i = 0; i < this._OWNERSHIP_FIELDS.length; i++) {
      if (changed(this._OWNERSHIP_FIELDS[i]) && !canPayroll) {
        return { ok: false, error: 'Du saknar behörighet att ändra ägarskapet för denna tidpost.' };
      }
    }

    if (changed('staffId')) {
      /* Faktiskt staffId-byte (kräver payroll_manage, redan verifierat ovan):
         validera mot riktig personal och härled staffName därifrån — lita
         aldrig på fri staffName-text i payloaden, undviker mismatch. */
      const staffRec = (state.staff || []).find(s => s.id === safeData.staffId);
      if (!staffRec) return { ok: false, error: 'Angiven personal hittades inte.' };
      safeData.staffName = `${staffRec.firstName} ${staffRec.lastName}`.trim();
    } else {
      /* Inget faktiskt staffId-byte — staffName får aldrig sättas fristående. */
      delete safeData.staffName;
    }
    if (!canPayroll) {
      this._OWNERSHIP_FIELDS.forEach(function (f) { delete safeData[f]; });
    }

    Object.assign(entry, safeData);
    if (safeData.startStr && safeData.endStr) {
      const [sh, sm] = safeData.startStr.split(':').map(Number);
      const [eh, em] = safeData.endStr.split(':').map(Number);
      entry.minutes = (eh * 60 + em) - (sh * 60 + sm);
    }
    persist();
    return { ok: true, entry };
  },

  delete(id) {
    const entry = (state.timeEntries || []).find(t => t.id === id);
    if (!entry) return { ok: false, error: 'Posten hittades inte' };
    const guard = this._guardMutation(entry);
    if (!guard.ok) return guard;
    if (entry.aoId) {
      const ao = getAO(entry.aoId);
      if (ao) ao.timeEntries = (ao.timeEntries || []).filter(tid => tid !== id);
    }
    state.timeEntries = (state.timeEntries || []).filter(t => t.id !== id);
    persist();
    return { ok: true };
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
