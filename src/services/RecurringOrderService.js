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

    /* E2E REC-01 (2026-11-23): schemat flyttas fram först när servern
       bekräftat AO:n (se nedan). Under den tiden visade ärendet samma
       nästa datum, och ett andra klick på "Skapa AO nu" skapade en andra
       AO för SAMMA tillfälle (reproducerat med långsam server). Finns
       redan en (ej raderad) AO för ärendet och tillfället — väntande
       eller bekräftad men schemat ännu inte framflyttat — skapas ingen ny. */
    const occDate = ro.nextDate || tdy();
    const existing = (state.workOrders || []).find(a => a && a.recurringOrderId === ro.id && !a.deleted && a.scheduledDate === occDate);
    if (existing) {
      const nr = (typeof WorkOrderService !== 'undefined' && WorkOrderService.displayNumberOrPending) ? WorkOrderService.displayNumberOrPending(existing) : existing.id;
      return { ok: false, error: 'Det finns redan en arbetsorder (' + nr + ') för tillfället ' + occDate + (existing._pendingSync ? ' — den väntar på serverns bekräftelse.' : '.') };
    }

    /* R2.5 §3/§9 (oberoende reproducerad blockerare) — `ro.address` var
       TIDIGARE ibland en hopslagen "Gata, 123 45 Ort"-sträng (skriven av
       den gamla RecurringPage._save(), se dess kommentar) medan
       `ro.zip`/`ro.city` alltid var tomma — det gjorde den nya AO:ns
       "gata" i praktiken till en sträng som redan innehöll postnr/ort,
       vilket bröt den kanoniska gatunormaliseringen (R2 §1) och kunde
       göra att en i övrigt korrekt adress aldrig fick stadskontext.
       Nya poster (efter denna omgång) har redan strukturerade zip/city
       — använd dem direkt. Genuint LEGACY-poster (bara den hopslagna
       strängen) parsas konservativt via den delade
       AddressService.parseLegacyCombinedAddress() — samma "hellre ingen
       nål än fel stad"-princip om formatet inte känns igen. */
    let aoAddress = ro.address || '', aoZip = ro.zip || '', aoCity = ro.city || '';
    if (!aoZip && !aoCity && aoAddress && typeof AddressService !== 'undefined') {
      const parsed = AddressService.parseLegacyCombinedAddress(aoAddress);
      aoAddress = parsed.street; aoZip = parsed.zip; aoCity = parsed.city;
    }

    const aoData = {
      title:         ro.title,
      description:   ro.description || '',
      customerId:    ro.customerId,
      propertyId:    ro.propertyId || '',
      address:       aoAddress,
      zip:           aoZip,
      city:          aoCity,
      addressSource: ro.addressSource || '',
      accessCode:    ro.accessCode || '',
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
        id:          'c' + Date.now() + Math.random().toString(36).slice(2),
        text:        c.text,
        description: c.description || '',
        avvikelse:   null,
        done:        false
      })),
      recurringOrderId: ro.id
    };

    /* R3-A FIX (independent-reviewer finding, round 4): `lastCreatedDate`/
       `nextDate` (and a status flip to "avslutad" if this was the last
       occurrence) used to advance SYNCHRONOUSLY, right after
       `WorkOrderService.create()` returned its optimistic, not-yet-
       ACKed object. If the server later rejected the create, the
       schedule had ALREADY moved past this occurrence — the recurring
       order would silently never actually get this AO, with no error
       surfaced anywhere (the caller, `RecurringPage._createAO()`, only
       sees the synchronous `{ok:true, ao}` return and shows "AO
       skapad" immediately). Fix: the schedule advancement, the
       ActivityService log entry, and the create() rejection path all
       move into `onSettled`, firing only once the server has actually
       confirmed the AO — mirroring the same fix applied to the offer→AO
       conversion flow in `PageShells.js`. The synchronous return value
       is kept (same shape, `{ok:true, ao}`) so `RecurringPage._createAO()`
       keeps working for the OPTIMISTIC navigation/toast, but the
       definitive schedule state only exists after a real ACK. */
    /* B1 FIX (independent-reviewer finding, round 5): the actual
       schedule-advancement/log-entry logic moved OUT of this in-memory
       `onSettled` and into the DURABLE 'recurring_ao_created' intent
       handler (registered once below, at file load) — see
       AOTimeSyncService.js's header and PageShells.js's matching fix
       for the offer->AO flow. `fromDate` is captured HERE, now, into
       the durable intent descriptor — never recomputed from `ro.
       nextDate` inside the handler, which could already have been
       advanced by the time the handler actually runs (same-session
       immediately, or on a future reload). */
    const ao = WorkOrderService.create(aoData, {
      onSettledIntent: { kind: 'recurring_ao_created', refId: ro.id, fromDate: ro.nextDate || tdy() },
      onSettled: (r) => {
        if (r.final && !r.ok) {
          if (typeof showToast === 'function') {
            showToast(`Arbetsordern för "${ro.title}" kunde inte skapas (${r.error || 'okänt fel'}) — schemat har INTE flyttats fram, försök igen.`);
          }
        }
        // ok:true's actual effect (schedule advance, log) happens in the
        // durable handler, not here — this callback is just same-session
        // UI feedback for the rejection case above.
      }
    });

    return { ok: true, ao };
  },

  /* Hur många dagar till nästa datum */
  daysUntilNext(ro) {
    if (!ro.nextDate) return null;
    const diff = Math.ceil((new Date(ro.nextDate) - new Date(tdy())) / 86400000);
    return diff;
  }
};

/* B1 FIX (independent-reviewer finding, round 5): registers the DURABLE
   handler for the 'recurring_ao_created' settled intent — see
   AOTimeSyncService.js's header for the whole mechanism. Idempotency
   is NOT "has nextDate already moved" (that can legitimately be true
   for an unrelated, later occurrence too) — it is tracked explicitly
   via `ro.appliedAoCreateIds`, a small array of AO ids whose schedule-
   advancement has already been applied, checked/updated atomically
   with the rest of this update so re-running this handler for the SAME
   settled intent (which `AOTimeSyncService` already guards against via
   its own `applied` flag, but this is a deliberate second, defensive
   layer, same as `PageShells.js`'s matching check) is always a no-op. */
if (typeof AOTimeSyncService !== 'undefined' && typeof AOTimeSyncService.registerIntentHandler === 'function') {
  /* B1 FOLLOW-UP FIX (independent-reviewer finding, round 6): this
     handler used to call `RecurringOrderService.update()` (which
     itself calls `persist()` fire-and-forget, never checking its
     result) and then treat "didn't throw" as success — the same class
     of gap just fixed in PageShells.js's matching handler. Now
     `async`, mutates `ro` directly (bypassing `update()`'s own
     unchecked `persist()` to get a single, awaited, checked write) and
     only reports `{ok:true}` once that write is CONFIRMED. Idempotent
     on a retry: `ro.appliedAoCreateIds` already contains `intent.aoId`
     skips re-advancing the schedule/re-logging the activity, same
     dedup marker as before — only the `persist()` itself is re-tried. */
  AOTimeSyncService.registerIntentHandler('recurring_ao_created', async function (intent, settleResult) {
    const ro = RecurringOrderService.getById(intent.refId);
    if (!ro) return { ok: true }; // recurring order no longer exists -- nothing left to commit, not a failure to retry
    if (settleResult.ok) {
      const alreadyApplied = Array.isArray(ro.appliedAoCreateIds) && ro.appliedAoCreateIds.indexOf(intent.aoId) !== -1;
      if (!alreadyApplied) {
        const days = RecurringOrderService.getDaysForInterval(ro);
        const nextTs = new Date(intent.fromDate);
        nextTs.setDate(nextTs.getDate() + days);
        const nextDate = nextTs.toISOString().split('T')[0];
        ro.lastCreatedDate = tdy();
        ro.nextDate = nextDate;
        ro.appliedAoCreateIds = (ro.appliedAoCreateIds || []).concat([intent.aoId]);
        if (!ro.tillsvidare && ro.endDate && nextDate > ro.endDate) ro.status = 'avslutad';
        ro.updatedAt = new Date().toISOString();
        const ao = (typeof getAO === 'function') ? getAO(intent.aoId) : null;
        const disp = (typeof WorkOrderService !== 'undefined') ? WorkOrderService.displayNumberOrPending(ao || { id: intent.aoId }) : intent.aoId;
        ActivityService.log('work_order_created',
          `AO ${disp} skapad från återkommande ärende ${ro.id}`,
          { workOrderId: intent.aoId, customerId: ro.customerId });
      }
      let persisted;
      try {
        /* C1 (2026-11-12): scoped to the key this code path mutated — an unrelated key's rejection (activityLog) is not this save's failure. */
        persisted = await persist({ keys: ['recurringOrders'] });
      } catch (e) {
        console.error('[RecurringOrderService] persist() threw while advancing schedule for', intent.refId, ':', e);
        return { ok: false, error: 'persist_threw' };
      }
      if (!persisted) {
        console.error('[RecurringOrderService] persist() reported failure while advancing schedule for', intent.refId, '-- the durable intent is kept for retry, not pruned.');
        return { ok: false, error: 'persist_failed' };
      }
      if (typeof RecurringPage !== 'undefined' && typeof RecurringPage.render === 'function') RecurringPage.render();
      return { ok: true };
    } else if (settleResult.final) {
      console.error('[RecurringOrderService] AO-skapande avvisades slutgiltigt av servern för återkommande ärende', intent.refId, '(reconciled):', settleResult.error);
      if (typeof showToast === 'function') {
        showToast(`Arbetsordern för "${ro.title}" kunde inte skapas (${settleResult.error || 'okänt fel'}) — schemat har INTE flyttats fram.`);
      }
      if (typeof RecurringPage !== 'undefined' && typeof RecurringPage.render === 'function') RecurringPage.render();
      return { ok: true };
    }
    return { ok: true };
  });
}
