/**
 * TimeService — Tidregistrering
 * Klocka in/ut, manuell tid, koppling till AO/kund
 */
const TimeService = {

  /* P0-2 FIX (2026-10-18, independent-reviewer regression): sedan
     BLOCKER-1-fixen (time-entries-list) gör att en användare UTAN
     `payroll_view` bara ser SINA EGNA tidposter, räcker `newId(
     state.timeEntries, 'TID')` inte längre som ett kollisionssäkert
     id — två olika personalmedlemmar med OLIKA, partiella synliga
     delmängder kan oberoende räkna fram SAMMA nästa TID-NNN, och
     servern (som jämför mot HELA den riktiga arrayen) avvisar då en av
     dem med `id_collision`. Samma risk finns redan vid den FÖRSTA
     tidposten direkt efter inloggning, innan TimeEntriesReadService:s
     asynkrona läsning hunnit slutföras (state.timeEntries fortfarande
     tom). Fix: ett genuint kollisionssäkert, UUID-baserat id (samma
     entropikälla som redan används för idempotensnycklar överallt i
     detta uppdrag) istället för en sekventiell gissning baserad på en
     eventuellt partiell lokal vy — ingen server-rundtur, inget
     klient-id→server-id-utbyte behövs, eftersom kollisionsrisken för
     en UUID är försumbar, inte bara "mindre sannolik". */
  _newTimeEntryId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'TID-' + crypto.randomUUID();
    return 'TID-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  },

  /* ═══════════════════════════════════════════════════════════════════
     P0 AO/TID-FIX (2026-10-18) — _syncTime(): samma mönster/motivering
     som WorkOrderService._syncAO() (se den filens filhuvud för den fulla
     förklaringen) — patcht ENDAST de ändrade fälten mot den atomiska
     time_entry_patch-RPC:n, OVANPÅ (inte istället för) den oförändrade
     persist()-anropet som fortfarande behövs för activityLog m.fl. */
  /* I4 (blocker round 2026-11-12): optional `opts.onSettled(r)` /
     `opts.onFirstAttempt(r)`, same contract as WorkOrderService._syncAO()
     and clockOut(): onSettled runs AFTER the internal bookkeeping, once,
     with the FINAL answer (ok:true or final:true); onFirstAttempt gets the
     first attempt's result so a caller can say "köad" on a transient
     failure. Callers without opts (every other caller) are unchanged.
     The defensive no-AOTimeSyncService path reports an honest
     {ok:false, final:true, error:'sync_unavailable'} — never a false ok. */
  _syncTime(entry, patch, opts) {
    opts = opts || {};
    const notify = function (fn, r) {
      if (typeof fn !== 'function') return;
      try { fn(r); } catch (e) { console.error('[TimeService] caller callback threw (_syncTime):', e); }
    };
    if (!entry) return;
    if (typeof AOTimeSyncService === 'undefined') {
      notify(opts.onSettled, { ok: false, final: true, error: 'sync_unavailable' });
      return;
    }
    entry._pendingSync = true;
    const p = AOTimeSyncService.patchTime(entry.id, patch, null, {
      onSettled: function (r) {
        if (r.ok) {
          entry._pendingSync = false;
          if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') {
            Storage.setLocal('timeEntries', state.timeEntries);
          }
        } else if (r.final) {
          entry._pendingSync = false;
          entry._syncFailed = r.error;
          console.error('[TimeService] Serverskrivning avvisad för', entry.id, ':', r.error);
          if (typeof opts.onSettled !== 'function' && typeof AOTimeSyncService.reportUnhandledRejection === 'function') {
            AOTimeSyncService.reportUnhandledRejection('time', 'tidpost ' + (entry.date || ''), r.error);
          }
        }
        if (r.ok || r.final) notify(opts.onSettled, r);
        if (typeof TimePage !== 'undefined' && typeof TimePage.onSyncStatusChanged === 'function') {
          TimePage.onSyncStatusChanged(entry.id);
        }
      }
    });
    if (typeof opts.onFirstAttempt === 'function' && p && typeof p.then === 'function') {
      p.then(function (first) { notify(opts.onFirstAttempt, first || {}); }, function () {});
    }
  },

  /* V22: klocka in/ut kräver ao_time specifikt — payroll_manage ensamt räcker
     INTE (det är löneadministration, inte operativ tidsstämpling). Ingen
     state-/Storage-mutation får ske innan detta passerat.
     Returtyper bevarade så långt möjligt (MyJobsPage.js läser clockOut()s
     returvärde direkt som post-objektet — utanför denna releases filomfång,
     så kontraktet får inte ändras): clockIn → true/false, clockOut → post-
     objekt eller null, precis som innan (där null tidigare bara betydde
     "inte inklockad" — nu även "saknar behörighet"). Anroparen avgör alltså
     nekad operation på exakt samma sätt som redan gällde för clockOut. */
  /* P2-2 CORRECTION (2026-11-16, round 4): public.store has no per-row
     user dimension — stamp status lives in the dedicated, RLS-protected
     `public.stamp_status` table instead (round 3), with a SERVER-owned
     revision counter for concurrency (round 4 — see storage.js's own
     header on why round 3's client-generated `seq` was rejected). Stamp
     status goes through Storage.getStampStatus()/setStampStatus() — the
     server derives "which user" from the verified JWT alone; no identity
     is ever sent from here.

     opts.onStampSettled(result) (round 4, NEW, optional, additive — no
     existing caller is affected): reports the server's REAL answer for
     the stamp write specifically, independent of (for clockOut) the time
     entry's own onSettled. `result.stale === true` means a different,
     real write already won server-side and local state has been
     reconciled to the true value — never assume the original intent
     succeeded. Addresses "clockIn() inväntar fortfarande inte resultatet"
     and "kräv serverbekräftelse före definitivt lyckat besked" without
     changing clockIn()'s/clockOut()'s synchronous return contract. */

  clockIn(aoId = null, opts = {}) {
    if (!(typeof Auth !== 'undefined' && Auth.can('ao_time'))) return false;
    if (state.stampActive) return false;
    state.stampActive    = true;
    state.stampTimestamp = Date.now();
    state.stampAoId      = aoId;
    const expectedRevision = Storage.getStampRevision();
    const ts = state.stampTimestamp;
    Storage.setStampStatus(true, ts, aoId, expectedRevision).then((r) => {
      if (r && r.ok && r.stale) {
        // A different write already won (e.g. another device's clockOut
        // landed first with the same expected revision) — reconcile local
        // state to the real server truth rather than leaving this device
        // believing its own clock-in succeeded.
        state.stampActive    = !!r.active;
        state.stampTimestamp = state.stampActive ? r.ts : null;
        state.stampAoId      = state.stampActive ? r.aoId : null;
        if (typeof MobileShell !== 'undefined') MobileShell.onClockChange();
      }
      if (typeof opts.onStampSettled === 'function') {
        try { opts.onStampSettled(r); } catch (e) { console.error('[TimeService] onStampSettled threw (clockIn):', e); }
      }
    });
    /* V55A-A: uppdatera mobilskalets ihållande "Incheckad"-status direkt
       — läser samma state.stampActive/stampTimestamp som sätts ovan,
       ingen egen kopia av klock-in-tillståndet. Se MobileShell.js. */
    if (typeof MobileShell !== 'undefined') MobileShell.onClockChange();
    return true;
  },

  /* Klocka ut — returnerar skapad post, eller null (ej inklockad ELLER saknar ao_time) */
  /* TIME-ENTRY-ACK FIX (2026-11-12): clockOut() skapade redan tidposten
     via AOTimeSyncService.createTime() med egen ACK-spårning
     (entry._pendingSync/_syncFailed) — men INGEN anropare kunde få veta
     utfallet, så alla tre klock-ut-UI:n (MyJobsPage, WorkOrderDetailPage,
     TimePage) visade "tid sparad"/"Utloggad" utan att tidpostens egen
     serverskrivning bekräftats. Nytt, rent additivt: valfritt
     `opts.onSettled(result)`, `result = {ok, final, error, entry}`:
       - anropas EFTER den interna bokföringen nedan (samma ordning som
         WorkOrderService._syncAO()/create()),
       - med det SLUTGILTIGA svaret (ok:true eller final:true) när
         AOTimeSyncService avgör det (även vid en senare automatisk retry),
       - och dessutom EN gång med `{ok:false, final:false, queued:true}`
         om det FÖRSTA försöket blev transient (nätverk/5xx) — posten
         ligger då kvar i den durabla outboxen och skickas om; anroparen
         kan visa ett ärligt "köad, ej bekräftad" istället för att vänta
         tyst för evigt.
     Saknas AOTimeSyncService (endast isolerade testskript) får en
     anropare MED onSettled ett ärligt `{ok:false, final:true,
     error:'sync_unavailable'}` — aldrig ett falskt ok. Returvärdet
     (entry eller null) och allt övrigt beteende är oförändrat; en
     anropare utan opts.onSettled påverkas inte alls. */
  clockOut(opts = {}) {
    opts = opts || {};
    const callerOnSettled = typeof opts.onSettled === 'function' ? opts.onSettled : null;
    const notifyCaller = function (r) {
      if (!callerOnSettled) return;
      try { callerOnSettled(r); } catch (e) { console.error('[TimeService] caller onSettled threw (clockOut):', e); }
    };
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
      id:           this._newTimeEntryId(),
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

    /* P2-2 round 3/4: the server-side stamp-clear is deferred until the
       time entry's OWN creation is actually confirmed by the server (see
       onSettled below) — not fired immediately here. Reasoning: these are
       two independent writes (different tables/EFs), so firing both at
       once with no ordering risks a real inconsistency the review called
       out explicitly — if entry creation fails but the stamp clear still
       succeeds, the user is left "stämplad ut" with NO time entry to show
       for it (the work is lost from a payroll point of view) and no
       obvious way to notice, since the UI already shows them as clocked
       out. Deferring the clear until creation is CONFIRMED means: on
       success, both land together (the server clear below); on a
       definitive rejection, the optimistic local "clocked out" state is
       rolled back to "still clocked in" (matching what the server still
       has, since it was never told otherwise) so the user can see the
       failure and retry clocking out properly instead of silently losing
       the clock session.
       Round 4: expectedRevision replaces round 3's client-generated
       `seq`; opts.onStampSettled (optional, additive) reports the stamp
       clear's OWN real result once it actually runs, independent of
       opts.onSettled (the time entry's own confirmation) — "Detta kan ge
       en sparad tidpost samtidigt som servern fortfarande visar
       användaren som instämplad" is exactly what onStampSettled makes
       observable instead of silently assumed fine. */
    const expectedRevision = Storage.getStampRevision();
    state.stampActive    = false;
    state.stampTimestamp = null;
    state.stampAoId      = null;
    /* V55A-A: se motsvarande kommentar i clockIn() ovan. */
    if (typeof MobileShell !== 'undefined') MobileShell.onClockChange();

    ActivityService.log('time_entry_created',
      `Tid registrerad: ${minutes} min${aoId ? ' på ' + aoId : ''}`,
      { workOrderId: aoId || '', customerId: entry.customerId });
    /* P0 AO/TID-FIX: atomisk serverskapelse via time_entry_create (samma
       p_client_id-mönster som WorkOrderService.create(), se den filens
       kommentar) — oförändrat synkront kontrakt (entry returneras direkt,
       MyJobsPage.js läser detta returvärde). */
    if (typeof AOTimeSyncService !== 'undefined') {
      entry._pendingSync = true;
      let finalDelivered = false;
      const p = AOTimeSyncService.createTime(entry, {
        onSettled: function (r) {
          if (r.ok) {
            entry._pendingSync = false;
            if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') {
              Storage.setLocal('timeEntries', state.timeEntries);
              Storage.setLocal('workOrders', state.workOrders);
            }
            /* P2-2 round 3/4: the time entry is NOW confirmed by the
               server — only now is it safe to tell the server to clear
               the stamp status too, so the two never disagree about
               whether this clock-out "really happened". setStampStatus()
               itself retries on network/5xx (idempotent by construction);
               onStampSettled reports its real outcome once that settles.
               Time-clock DURABLE RECOVERY (2026-11-17): write the pending-
               clear marker BEFORE attempting the clear — if the browser
               closes/crashes before the clear's response ever arrives (or
               after it fails and gives up), the marker survives and the
               NEXT initState() retries just the clear, never a new entry. */
            if (typeof Storage.setPendingStampClear === 'function') {
              Storage.setPendingStampClear({ aoId: aoId || null, ts: startTs, timeEntryId: entry.id });
            }
            Storage.setStampStatus(false, null, null, expectedRevision).then((r) => {
              if (r && r.ok && typeof Storage.clearPendingStampClear === 'function') {
                Storage.clearPendingStampClear();
              }
              if (typeof opts.onStampSettled === 'function') {
                try { opts.onStampSettled(r); } catch (e2) { console.error('[TimeService] onStampSettled threw (clockOut):', e2); }
              }
            });
          } else if (r.final) {
            entry._pendingSync = false;
            entry._syncFailed = r.error;
            console.error('[TimeService] Klocka ut-skapande avvisades av servern för', entry.id, ':', r.error);
            /* P2-2 round 3: definitive rejection — the time entry does NOT
               exist server-side, so this clock-out did not really happen.
               Roll the optimistic local "clocked out" state back to
               "still clocked in" (the server's stamp_status row was never
               told otherwise, since the clear above never fired) so the
               user can see the failure and retry properly, instead of
               silently losing the clock session with no time entry to
               show for it. Mirrors the established optimistic-update-
               rollback pattern already used elsewhere in this codebase
               (e.g. WorkOrderService) for the same class of problem. */
            state.stampActive    = true;
            state.stampTimestamp = startTs;
            state.stampAoId      = aoId || null;
            if (typeof MobileShell !== 'undefined') MobileShell.onClockChange();
          }
          if (r.ok || r.final) {
            finalDelivered = true;
            notifyCaller({ ok: !!r.ok, final: true, error: r.error || null, entry: entry });
          }
        }
      });
      /* Första försöket transient → säg det till anroparen EN gång
         (AOTimeSyncService anropar själv bara onSettled på slutgiltiga
         svar). */
      if (callerOnSettled && p && typeof p.then === 'function') {
        p.then(function (first) {
          if (!finalDelivered && first && !first.ok && !first.final) {
            notifyCaller({ ok: false, final: false, queued: true, error: first.error || null, entry: entry });
          }
        }, function () {});
      }
    } else {
      // No sync service at all (test-only per the comment above) — same
      // "this clock-out did not really happen" rollback as a definitive
      // rejection; never attempt the server-side stamp clear.
      state.stampActive    = true;
      state.stampTimestamp = startTs;
      state.stampAoId      = aoId || null;
      if (typeof MobileShell !== 'undefined') MobileShell.onClockChange();
      notifyCaller({ ok: false, final: true, error: 'sync_unavailable', entry: entry });
    }
    persist();
    return entry;
  },

  /* Manuell tidsregistrering.
     V22: overrideStaffName tas emot men litas ALDRIG på — staffName härleds
     alltid från den faktiska state.staff-posten när ett staffId anges. */
  /* opts.onSettled(r) / opts.onFirstAttempt(r): samma kontrakt som update().
     Vid definitivt serveravslag tas posten bort lokalt igen (även AO:ns
     timeEntries-referens) — en tidpost servern vägrat får aldrig visas som
     registrerad. Anropare utan opts påverkas inte. */
  saveManual(data, opts) {
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
      id:            this._newTimeEntryId(),
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
    const callerOnSettled = opts && typeof opts.onSettled === 'function' ? opts.onSettled : null;
    const callerOnFirst = opts && typeof opts.onFirstAttempt === 'function' ? opts.onFirstAttempt : null;
    const notify = function (fn, r) {
      if (!fn) return;
      try { fn(r); } catch (e) { console.error('[TimeService] caller callback threw (saveManual):', e); }
    };
    if (typeof AOTimeSyncService !== 'undefined') {
      entry._pendingSync = true;
      const p = AOTimeSyncService.createTime(entry, {
        onSettled: function (r) {
          let rolledBack = false;
          if (r.ok) {
            entry._pendingSync = false;
            if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') {
              Storage.setLocal('timeEntries', state.timeEntries);
              Storage.setLocal('workOrders', state.workOrders);
            }
          } else if (r.final) {
            entry._pendingSync = false;
            entry._syncFailed = r.error;
            console.error('[TimeService] Manuellt tidsskapande avvisades av servern för', entry.id, ':', r.error);
            state.timeEntries = (state.timeEntries || []).filter(function (t) { return t.id !== entry.id; });
            const aoNow = entry.aoId ? getAO(entry.aoId) : null;
            if (aoNow && Array.isArray(aoNow.timeEntries)) aoNow.timeEntries = aoNow.timeEntries.filter(function (tid) { return tid !== entry.id; });
            if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') Storage.setLocal('timeEntries', state.timeEntries);
            rolledBack = true;
          }
          if (r.ok || r.final) notify(callerOnSettled, { ok: !!r.ok, final: true, error: r.error || null, entry: entry, rolledBack: rolledBack });
          if (!r.ok && r.final && !callerOnSettled && typeof AOTimeSyncService.reportUnhandledRejection === 'function') {
            AOTimeSyncService.reportUnhandledRejection('time', 'tidpost ' + (entry.date || ''), r.error);
          }
          if (typeof TimePage !== 'undefined' && typeof TimePage.onSyncStatusChanged === 'function') TimePage.onSyncStatusChanged(entry.id);
        }
      });
      if (callerOnFirst && p && typeof p.then === 'function') {
        p.then(function (first) { notify(callerOnFirst, first || {}); }, function () {});
      }
    } else {
      notify(callerOnSettled, { ok: false, final: true, error: 'sync_unavailable', entry: entry, rolledBack: false });
    }
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
  update(id, data, opts) {
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

    /* AO-050-fixen (R0 + R1): ett faktiskt priceGroupId-byte MÅSTE koherent
       uppdatera priceGroupName OCH hourRate härlett från den AKTUELLA
       PriceGroup-posten — annars kan en post hamna i ett partiellt
       tillstånd, vilket är exakt vad BillingQueueService.getCandidates()
       läser (`t.hourRate`) för att avgöra "Saknar timpris". Samma
       härledningsmönster som redan finns i saveManual()/clockOut() ovan.

       R1-tillägget: den GAMLA buggen (innan R0) hann redan i produktion
       persistera EXAKT detta trasiga tillstånd på riktiga poster:
       `priceGroupId` satt, men `priceGroupName`/`hourRate` kvar på sina
       gamla tomma värden. En sådan post har INGEN "ändring" att upptäcka
       nästa gång användaren öppnar redigeringsdialogen (samma priceGroupId
       står redan förvalt i dropdownen) — `changed('priceGroupId')` blir då
       FALSE, och R0:s logik skulle aldrig självläka den. Fyra distinkta
       fall hanteras nu explicit:
         A) priceGroupId FAKTISKT ändrat, satt till ett giltigt värde
            → härled om från den nya, aktuella PriceGroup-posten.
         B) SAMMA priceGroupId skickas explicit igen, OCH den lagrade
            posten är i det kända trasiga tillståndet (tomt namn och/eller
            hourRate <= 0) → självläk genom att härleda om, ÄVEN UTAN att
            `changed()` ser en skillnad — detta är den faktiska
            reparationen av redan drabbade produktionsposter.
         C) SAMMA priceGroupId skickas igen, och den lagrade pris-
            snapshotten är REDAN giltig → bevara den orört. En redan
            debiterbar historisk tidpost ska ALDRIG omprissättas bara för
            att dagens PriceGroup-kurs råkat ändras sedan arbetet
            utfördes — det vore en tyst, oönskad efterhandsjustering av
            redan godkänd/registrerad tid.
         D) priceGroupId rörs inte alls i denna redigering (fältet saknas
            i payloaden, t.ex. en ren kommentarsredigering) → rör aldrig
            pris-fälten.
       (E, priceGroupId rensas till tomt, hanteras av samma A-gren nedan.)
       I samtliga fall gäller fortsatt R0:s grundregel: ett payload som
       INTE faktiskt initierar en av dessa vägar kan aldrig smuggla in ett
       eget, egenhändigt satt priceGroupName/hourRate. */
    if (changed('priceGroupId')) {
      if (safeData.priceGroupId) {
        const pg = (state.priceGroups || []).find(p => p.id === safeData.priceGroupId);
        if (!pg) return { ok: false, error: 'Angiven prisgrupp hittades inte.' };
        safeData.priceGroupName = pg.name;
        safeData.hourRate = pg.hourRate;
      } else {
        safeData.priceGroupName = '';
        safeData.hourRate = 0;
      }
    } else if (Object.prototype.hasOwnProperty.call(safeData, 'priceGroupId') && safeData.priceGroupId) {
      const isKnownPartialState = !entry.priceGroupName || !(entry.hourRate > 0);
      if (isKnownPartialState) {
        const pg = (state.priceGroups || []).find(p => p.id === safeData.priceGroupId);
        if (pg) {
          safeData.priceGroupName = pg.name;
          safeData.hourRate = pg.hourRate;
        } else {
          delete safeData.priceGroupName;
          delete safeData.hourRate;
        }
      } else {
        delete safeData.priceGroupName;
        delete safeData.hourRate;
      }
    } else {
      delete safeData.priceGroupName;
      delete safeData.hourRate;
    }

    /* I4: what this edit overwrites, so a FINAL server rejection can put
       it back (same rule as A2's status rollback): the entry must never
       keep showing a value the server refused. */
    const before = {};
    Object.keys(safeData).concat(['minutes']).forEach(function (f) {
      before[f] = Object.prototype.hasOwnProperty.call(entry, f) ? entry[f] : undefined;
    });
    Object.assign(entry, safeData);
    if (safeData.startStr && safeData.endStr) {
      const [sh, sm] = safeData.startStr.split(':').map(Number);
      const [eh, em] = safeData.endStr.split(':').map(Number);
      entry.minutes = (eh * 60 + em) - (sh * 60 + sm);
      safeData.minutes = entry.minutes;
    }
    const applied = Object.assign({}, safeData);
    const callerOnSettled = opts && typeof opts.onSettled === 'function' ? opts.onSettled : null;
    const callerOnFirst = opts && typeof opts.onFirstAttempt === 'function' ? opts.onFirstAttempt : null;
    this._syncTime(entry, safeData, (callerOnSettled || callerOnFirst) ? {
      onSettled: function (r) {
        let rolledBack = false;
        if (!r.ok && r.final) {
          /* Restore only fields that still hold what THIS edit wrote (a
             newer local edit to the same field is not clobbered). */
          Object.keys(applied).forEach(function (f) {
            if (entry[f] !== applied[f]) return;
            if (before[f] === undefined) delete entry[f]; else entry[f] = before[f];
            rolledBack = true;
          });
          if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') {
            Storage.setLocal('timeEntries', state.timeEntries);
          }
        }
        if (callerOnSettled) callerOnSettled({ ok: !!r.ok, final: true, error: r.error || null, entry: entry, rolledBack: rolledBack });
      },
      onFirstAttempt: function (first) {
        if (callerOnFirst) callerOnFirst(first);
      }
    } : undefined);
    persist();
    return { ok: true, entry };
  },

  /* P0 AO/TID-FIX: äkta borttagning (inte en flagga) via time_entry_soft_delete
     (atomisk, idempotent, och fail-closed mot attesterad tid ÄVEN om
     klientens _guardMutation()-kontroll ovan av någon anledning kringgåtts
     — se migrationens attested_locked-skydd). */
  /* opts.onSettled / opts.onFirstAttempt som update(). Vid definitivt avslag
     (t.ex. attested_locked på servern) läggs posten tillbaka — den finns
     kvar på servern och ska då synas kvar, inte se raderad ut. */
  delete(id, opts) {
    const entry = (state.timeEntries || []).find(t => t.id === id);
    if (!entry) return { ok: false, error: 'Posten hittades inte' };
    const guard = this._guardMutation(entry);
    if (!guard.ok) return guard;
    const callerOnSettled = opts && typeof opts.onSettled === 'function' ? opts.onSettled : null;
    const callerOnFirst = opts && typeof opts.onFirstAttempt === 'function' ? opts.onFirstAttempt : null;
    const notify = function (fn, r) {
      if (!fn) return;
      try { fn(r); } catch (e) { console.error('[TimeService] caller callback threw (delete):', e); }
    };
    const idx = (state.timeEntries || []).findIndex(t => t.id === id);
    if (entry.aoId) {
      const ao = getAO(entry.aoId);
      if (ao) ao.timeEntries = (ao.timeEntries || []).filter(tid => tid !== id);
    }
    state.timeEntries = (state.timeEntries || []).filter(t => t.id !== id);
    if (typeof AOTimeSyncService !== 'undefined') {
      const p = AOTimeSyncService.deleteTime(id, {
        onSettled: function (r) {
          let rolledBack = false;
          if (!r.ok && r.final) {
            console.error('[TimeService] Radering avvisad av servern för', id, ':', r.error);
            if (!(state.timeEntries || []).some(t => t.id === id)) {
              state.timeEntries = (state.timeEntries || []).slice();
              state.timeEntries.splice(Math.max(0, Math.min(idx, state.timeEntries.length)), 0, entry);
              const aoNow = entry.aoId ? getAO(entry.aoId) : null;
              if (aoNow && !(aoNow.timeEntries || []).includes(id)) aoNow.timeEntries = (aoNow.timeEntries || []).concat([id]);
              if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') Storage.setLocal('timeEntries', state.timeEntries);
              rolledBack = true;
            }
          }
          if (r.ok || r.final) notify(callerOnSettled, { ok: !!r.ok, final: true, error: r.error || null, entry: entry, rolledBack: rolledBack });
          if (!r.ok && r.final && !callerOnSettled && typeof AOTimeSyncService.reportUnhandledRejection === 'function') {
            AOTimeSyncService.reportUnhandledRejection('time', 'tidpost ' + (entry.date || ''), r.error);
          }
          if (typeof TimePage !== 'undefined' && typeof TimePage.onSyncStatusChanged === 'function') TimePage.onSyncStatusChanged(id);
        }
      });
      if (callerOnFirst && p && typeof p.then === 'function') {
        p.then(function (first) { notify(callerOnFirst, first || {}); }, function () {});
      }
    } else {
      notify(callerOnSettled, { ok: false, final: true, error: 'sync_unavailable', entry: entry, rolledBack: false });
    }
    persist();
    return { ok: true };
  },

  getByAO(aoId) {
    return (state.timeEntries || []).filter(t => t.aoId === aoId);
  },

  /* AO-PRICING-RECOVERY R2.1 — Blocker B/C: EN delad definition av
     "en prisgrupp som faktiskt duger för kundfakturering". Använd
     BÅDE här (mutations-spärr) och i WorkOrderDetailPage.js (AO-nivå-
     sparning + dropdown-filtrering) så UI och skrivspärr aldrig kan
     glida isär. VIFT tillåter en AKTIV prisgrupp med hourRate=0 (t.ex.
     historiska/interna skäl) — det förblir tillåtet ATT FINNAS, men
     kan aldrig VÄLJAS som mål för en kundfaktureringsreparation. */
  isValidBillingPriceGroup(pg) {
    if (!pg) return false;
    if (!pg.active) return false;
    if (!pg.name || String(pg.name).trim() === '') return false;
    const rate = Number(pg.hourRate);
    return Number.isFinite(rate) && rate > 0;
  },

  /* ═══════════════════════════════════════════════════════════════
     AO-PRICING-RECOVERY R2/R2.1 — Blocker 2/3 (R2) + A/B (R2.1): en
     SMAL, självständig reparationsväg för en KÄNT TRASIG prissnapshot,
     ATT SKILJA FRÅN update(). update()s ägarskaps-/lönespärr
     (_guardMutation — annans tidpost kräver payroll_manage) är en
     LÖNE-/tidsredigeringsspärr; en prissnapshot-reparation (bara
     priceGroupId/priceGroupName/hourRate) är en SEPARAT, finansiell
     korrigering som en ren faktureringsanvändare (invoice_create, utan
     payroll_manage) måste kunna slutföra själv — annars uppstår EXAKT
     samma faktureringsdödläge som denna omgång finns till för att
     lösa, fast på tidpost-nivå istället för AO-nivå.

     DÄRFÖR har denna metod sin EGEN, snävare behörighetsdörr
     (ao_edit ELLER invoice_create) istället för att återanvända/
     försvaga _guardMutation() eller update() globalt — update()s
     spärrar för andras tid och attestfält är HELT OFÖRÄNDRADE och
     gäller precis som förut för ALLA andra anrop.

     R2.1 — DENNA VÄG ÄR EN PRIVILEGIERAD UNDANTAGSMEKANISM (kringgår
     payroll_manage), INTE ett generellt omprissättnings-API. Oberoende
     granskning visade att R2:s version felaktigt tillät reparation av:
       (1) billable:false-poster (aldrig kundfakturerbara över huvud
           taget — self._guardMutation-kringgåendet var då omotiverat),
       (2) poster på en fastprisAO (tid blir ALDRIG en egen fakturerings-
           källa där — BillingQueueService.js, _billingModeForAo==='fixed'),
       (3) poster vars fakturerings-source REDAN är claimad av en aktiv
           faktura (även om ao.invoiceId råkar stå tomt eftersom ANNAT
           AO-innehåll fortfarande är oclaimat — partiell fakturering).
     Samtliga tre stängs nu genom att kräva att posten FAKTISKT är en
     OCLAIMAD faktureringskälla, blockerad SPECIFIKT av "Saknar timpris"
     — härlett DIREKT från BillingQueueService.getUnclaimedSourcesForAO(),
     INTE en egen omimplementation av claim-/fakturerbarhetssemantik
     (samma delade-sanningskälla-princip som Blocker 1 i R2). Om
     BillingQueueService inte är tillgänglig: FAIL CLOSED (vägra),
     aldrig anta att posten är reparerbar.

     REVALIDERAR ALLT vid VARJE anrop (Blocker 3) — litar ALDRIG på
     ett tidigare öppnat modal-snapshot: AO:n och posten hämtas FÄRSKT,
     `aoId`-tillhörighet, `billable`, `attested`, `invoiceId`, AO:ns
     FAKTISKA `priceType`, och den obeclaimade käll-statusen kontrolleras
     ALLA på nytt vid just detta anrop.

     Skriver ENDAST priceGroupId/priceGroupName/hourRate — rör ALDRIG
     minutes/date/staffId/billable/attest-fält. Kanoniska namn/kurs
     hämtas alltid från den AKTUELLA, validerade PriceGroup-posten
     (Blocker B: `isValidBillingPriceGroup()` — en aktiv men 0-kr-grupp
     kan aldrig användas här, oavsett vad anroparen skickar in). */
  repairMissingPricingSnapshot(aoId, entryId, priceGroupId) {
    const authorized = typeof Auth !== 'undefined' && Auth.canAny(['ao_edit', 'invoice_create']);
    if (!authorized) return { ok: false, error: 'Du saknar behörighet att reparera prissättning.' };

    if (!aoId || !entryId) return { ok: false, error: 'Ogiltigt anrop.' };
    const ao = getAO(aoId);
    if (!ao) return { ok: false, error: 'Arbetsordern hittades inte.' };
    if (ao.invoiceId) return { ok: false, error: 'Arbetsordern är redan fakturerad och kan inte omprissättas härifrån.' };

    /* Blocker A(1): AO:ns FAKTISKA, aktuella prismodell måste vara
       löpande timpris — denna väg får aldrig användas på en fastpris-
       eller ej_satt-AO, oavsett vad anroparen påstår. */
    if (ao.priceType !== 'timpris' && ao.priceType !== 'prisgrupp') {
      return { ok: false, error: 'Arbetsordern är inte satt till löpande timpris — prissnapshot-reparation gäller inte här.' };
    }

    const entry = (state.timeEntries || []).find(t => t.id === entryId);
    if (!entry) return { ok: false, error: 'Tidposten hittades inte.' };
    if (entry.aoId !== aoId) return { ok: false, error: 'Tidposten tillhör inte denna arbetsorder.' };

    /* Blocker A(2): en icke-kundfakturerbar post ska aldrig kunna
       repareras via denna privilegierade väg — det finns inget
       faktureringsdödläge att lösa för en post som aldrig var
       kundfakturerbar. */
    if (entry.billable === false) {
      return { ok: false, error: 'Tidposten är inte kundfakturerbar och kan inte repareras via denna väg.' };
    }

    /* Genuin lönespärr — kontrolleras oavsett behörighet, precis som i
       _guardMutation(). Ingen `Auth.can('all')`-genväg här: en
       prissnapshot-reparation är inte samma sak som löneattestering,
       och attesterad tid ska förbli låst tills löneansvarig uttryckligen
       låser upp den, oavsett vem som försöker reparera priset. */
    if (entry.attested) {
      return { ok: false, error: 'Attesterad tid är låst och kan inte ändras. Kontakta löneansvarig för att låsa upp posten.' };
    }

    const isBroken = !entry.priceGroupId || !entry.priceGroupName || !(entry.hourRate > 0);
    if (!isBroken) {
      return { ok: false, error: 'Posten har redan en giltig prissättning och rördes inte.', skipped: true };
    }

    /* Blocker A(3) — den avgörande spärren: posten måste FAKTISKT vara
       en obeclaimad faktureringskälla, blockerad specifikt av "Saknar
       timpris", enligt BillingQueueService — den ENDA auktoritativa
       källan (samma som Blocker 1). Detta utesluter AUTOMATISKT
       billable:false (redan stoppat ovan, men bekräftas här också),
       fastpris-tid (mode!=='hourly' skulle redan ha stoppats av
       priceType-kontrollen ovan) och REDAN CLAIMADE källor (en aktiv
       faktura vars sourceRefs redan pekar på denna post — även om
       ao.invoiceId råkar stå tomt för att ANNAT AO-innehåll
       fortfarande är oclaimat, dvs. partiell fakturering). */
    if (typeof BillingQueueService === 'undefined') {
      return { ok: false, error: 'Faktureringsmotorn är inte tillgänglig — reparation avbruten.' };
    }
    const unclaimedSources = BillingQueueService.getUnclaimedSourcesForAO(aoId);
    const source = unclaimedSources.find(function (s) {
      return s.sourceType === 'time' && s.sourceKey === 'time:' + entryId;
    });
    if (!source) {
      return { ok: false, error: 'Tidposten är inte en obeclaimad faktureringskälla (kan redan ingå i en faktura, eller inte vara fakturerbar).' };
    }
    if (!(source.issues || []).includes('Saknar timpris')) {
      return { ok: false, error: 'Tidposten blockeras inte av saknad timprissättning — inget att reparera via denna väg.' };
    }

    if (!priceGroupId) return { ok: false, error: 'Ingen prisgrupp vald.' };
    const pg = (state.priceGroups || []).find(p => p.id === priceGroupId);
    /* Blocker B: en aktiv men 0-kr/ej-namngiven prisgrupp får ALDRIG
       användas som reparationsmål — den skulle ge ok:true men lämna
       posten fortsatt fakturerings-ogiltig. */
    if (!this.isValidBillingPriceGroup(pg)) {
      return { ok: false, error: 'Vald prisgrupp är inte giltig för kundfakturering (kräver aktiv, namngiven prisgrupp med timpris > 0).' };
    }
    const rate = Number(pg.hourRate);

    const before = { priceGroupId: entry.priceGroupId, priceGroupName: entry.priceGroupName, hourRate: entry.hourRate };
    entry.priceGroupId = pg.id;
    entry.priceGroupName = pg.name;
    entry.hourRate = rate;
    this._syncTime(entry, { priceGroupId: pg.id, priceGroupName: pg.name, hourRate: rate });
    persist();
    return {
      ok: true,
      entryId: entry.id,
      before,
      after: { priceGroupId: pg.id, priceGroupName: pg.name, hourRate: rate }
    };
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
