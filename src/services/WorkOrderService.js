/**
 * WorkOrderService — CRUD och statuslogik för arbetsorder
 */
const WorkOrderService = {

  /* BLOCKER-2 FIX (independent-reviewer regression, round 3): `create()`
     tidigare beräknade AO-id:et client-side via
     `newId(state.workOrders, 'AO')` — baserat på klientens EGEN,
     potentiellt inaktuella uppfattning om det högsta befintliga id:et.
     Två OLIKA, fullt legitima samtidiga AO-skapanden (två kassörskor,
     ingen gör något fel) som båda råkar se samma "senaste max" (t.ex.
     AO-062) räknar då BÅDA fram AO-063 — RPC:ns kollisionskontroll
     (korrekt!) förhindrar att den andra tyst skriver över den första,
     men gör det genom att helt AVVISA den andra med `id_collision`:
     den andra användarens fullt legitima AO försvinner aldrig till
     servern alls.

     ÖVERVÄGT och AVVISAT: ett "provisoriskt id → döp om till det
     riktiga server-id:et vid ACK"-mönster (server väljer nästa
     sekventiella AO-NNN, klienten bytr ut det lokala objektets id i
     efterhand). Avvisat efter att faktiskt granska anroparna (inte
     antaget säkert): `PageShells.js`s offert→AO-konvertering (se dess
     egen R2/blockerare-5-kommentar) kopierar `ao.id` till `off.
     workOrderId` SYNKRONT direkt efter `create()` returnerar — om
     `ao.id` senare bytts ut hade `off.workOrderId` blivit en död
     referens till ett id servern aldrig kände till (EXAKT den gamla
     "cross-record renumbering"-buggklassen denna kodbas redan en gång
     fixat, se R1.2/R2.1-historiken i scratchpad). Att döpa om require
     att granska/fixa VARJE sådan kopieringsplats (inte bara navigera
     till en sida) — en betydligt större och riskablare ändring än
     nödvändigt.

     Vald fix istället — SAMMA kategori fix som redan gjordes för
     tidposter (P0-2, UUID-baserat id): ett genuint kollisionssäkert
     UUID-baserat AO-id, satt EN gång vid skapandet och ALDRIG bytt ut
     senare. Ingen rekonciliering, inget omdöpningssteg, INGEN
     granskning av nedströms-konsumenter behövs — varje anropare får
     redan det RIKTIGA, slutgiltiga id:et synkront, precis som idag,
     bara nu utan kollisionsrisken. Avvägning, medvetet accepterad:
     AO-id:n blir längre (UUID istället för "AO-005") — samma avvägning
     som redan accepterades för tidposter. */
  _newAoId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'AO-' + crypto.randomUUID();
    return 'AO-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  },

  /* Product decision fix (round 4, independent-reviewer finding): the
     INTERNAL `id` is a UUID (collision-safe, never shown to users by
     this function). The HUMAN-FACING number is the separate,
     server-allocated `displayNumber` field (see migration
     20261020000001_ao_display_number.sql) — this is the ONE place UI
     code should go through to render "the AO number", instead of
     reading `ao.id`/`ao.displayNumber` directly at ~20 scattered call
     sites. Falls back gracefully: a brand-new AO whose create() call
     hasn't been ACKed yet (`_pendingSync === true`) has no
     displayNumber yet — show a clearly-marked "pending" placeholder
     rather than the raw UUID (which would be confusing/unprofessional
     if a user ever saw it, e.g. during a slow connection). A pre-
     round-3 AO or a backfilled one always has a real displayNumber
     (the backfill migration guarantees every existing row gets one),
     so the fallback path is only ever hit for the few seconds between
     an optimistic create and its ACK. */
  displayNumberOrPending(ao) {
    if (!ao) return '';
    if (ao.displayNumber) return ao.displayNumber;
    return ao._pendingSync ? 'AO-(sparas…)' : (ao.id || '');
  },

  /* ═══════════════════════════════════════════════════════════════════
     P0 AO/TID-FIX (2026-10-18) — _syncAO(): den EN gemensamma vägen
     varje AO-mutation i denna fil nu använder för att nå servern,
     istället för att förlita sig på att den generiska persist() (se
     state.js _doPersist()) skickar HELA state.workOrders-arrayen.

     Körs TILLSAMMANS MED, inte istället för, den befintliga persist()
     på varje anropsplats: persist() behövs fortfarande (oförändrat) för
     activityLog och alla andra state-nycklar denna fil rör vid samma
     tillfälle — bara `vift_workOrders`/`vift_timeEntries` har flyttats
     bort ur persist()-bundeln (se state.js _doPersist(), samma princip
     som redan gällde för vift_projectDocuments sedan 2026-09-08).

     `patch` ska innehålla ENDAST de fält just DENNA anropsplats faktiskt
     ändrat (aldrig en hel AO-kopia) — RPC:n (work_order_patch) mergar in
     patchen mot den LÅSTA, färskaste serverraden, inte mot klientens
     egen potentiellt inaktuella kopia, vilket är själva race-fixen.

     Faller tillbaka till ren lokal mutation (ingen extra serverskrivning
     utöver den befintliga persist()) OM AOTimeSyncService inte är laddad
     — t.ex. en äldre sidvy som laddats innan denna release, eller ett
     testscript som bara laddar WorkOrderService.js isolerat. Detta är
     INTE en permanent flykt-väg i produktion (filen laddas alltid
     tillsammans i index.html) — bara ett defensivt no-op istället för
     ett kastat fel om referensen skulle saknas. */
  /* FLOW-A/B FIX (independent-reviewer finding, this round): `_syncAO()`
     itself never gave ANY caller a way to learn the real server outcome —
     every one of the ~20 existing call sites is intentionally fire-and-
     forget (see the file header above) and that is NOT changed here. This
     round's confirmed bug was two SPECIFIC callers (WorkOrderDetailPage's
     edit-save, MyJobsPage's clockIn/clockOut) showing a success toast
     synchronously, with zero connection to whether the write actually
     reached the server. Fix mirrors create()'s existing R3-A pattern
     exactly: an optional `opts.onSettled(result)`, invoked from the SAME
     place the internal onSettled handler already runs, AFTER the internal
     bookkeeping above so _pendingSync/_syncFailed/onSyncStatusChanged are
     always consistent before any caller sees the result. A caller that
     doesn't pass `opts.onSettled` (all ~20 existing call sites) triggers
     NO new code path at all — purely additive. Also covers the "no
     AOTimeSyncService loaded" defensive no-op path (see file header) the
     same way create()'s own fallback does, so a caller that DOES pass
     onSettled is never left permanently unresolved. */
  /* FAIL-CLOSED FIX (2026-11-12, independent-reviewer finding, verified
     against the code before fixing): the defensive no-AOTimeSyncService
     fallback below used to call `opts.onSettled({ok:true, final:true})`
     — i.e. report a CONFIRMED server write when ZERO server write had
     happened. Harmless for the ~20 fire-and-forget callers (they never
     pass onSettled), but a direct false positive for exactly the callers
     that pass onSettled BECAUSE they want a real confirmation
     (doSave(), clock in/out, setStatus() UI). It now reports
     `{ok:false, final:true, error:'sync_unavailable'}` instead. Behavior
     for callers without onSettled is byte-for-byte unchanged (still a
     silent local-only no-op). In production this branch is never hit
     (AOTimeSyncService.js always loads before this file in index.html). */
  _syncAO(ao, patch, opts) {
    opts = opts || {};
    if (!ao) return;
    if (typeof AOTimeSyncService === 'undefined') {
      if (typeof opts.onSettled === 'function') {
        try { opts.onSettled({ ok: false, final: true, error: 'sync_unavailable', ao: ao }); } catch (e) { console.error('[WorkOrderService] caller onSettled threw (_syncAO fallback):', e); }
      }
      return;
    }
    const expected = opts.expectedUpdatedAt || null;
    ao._pendingSync = true;
    AOTimeSyncService.patchAO(ao.id, patch, expected, {
      onSettled: function (r) {
        if (r.ok) {
          ao._pendingSync = false;
          if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') {
            Storage.setLocal('workOrders', state.workOrders);
          }
        } else if (r.final) {
          ao._pendingSync = false;
          ao._syncFailed = r.error;
          console.error('[WorkOrderService] Serverskrivning avvisad för', ao.id, ':', r.error);
          if (typeof opts.onSettled !== 'function' && typeof AOTimeSyncService.reportUnhandledRejection === 'function') {
            AOTimeSyncService.reportUnhandledRejection('ao', WorkOrderService.displayNumberOrPending(ao), r.error);
          }
        }
        // else: transient, stannar i outboxen (ao._pendingSync kvarstår true)
        if (typeof WorkOrdersPage !== 'undefined' && typeof WorkOrdersPage.onSyncStatusChanged === 'function') {
          WorkOrdersPage.onSyncStatusChanged(ao.id);
        }
        if (typeof WorkOrderDetailPage !== 'undefined' && typeof WorkOrderDetailPage.onSyncStatusChanged === 'function') {
          WorkOrderDetailPage.onSyncStatusChanged(ao.id);
        }
        if (typeof opts.onSettled === 'function') {
          try { opts.onSettled(r); } catch (e) { console.error('[WorkOrderService] caller onSettled threw (_syncAO):', e); }
        }
      }
    });
  },

  /* V54B R1 — blockerare 4: create() tog tidigare emot ett `projectId` i
     `data` helt okontrollerat — en anropare (formulär idag, ett framtida
     AI-agent-skrivverktyg imorgon) kunde skicka in en kund-/fastighets-
     inkompatibel Projekt-koppling och få en AO skapad med den ändå. En
     icke-tom `projectId` valideras nu ALLTID mot den kanoniska
     `ProjectService.isChildCompatible()` INNAN AO:n skapas — om
     kombinationen är ogiltig skapas INGEN AO alls (varken kopplad eller
     tyst okopplad), utan `{ok:false, error}` returneras. Detta lämnar
     kontraktet för alla BEFINTLIGA anrop utan `projectId` helt orört
     (de returnerar fortfarande AO-objektet direkt) — bara de två
     ställen i kodbasen som faktiskt skickar `projectId`
     (WorkOrdersPage._wizSave, offert→AO-konverteringen i PageShells.js)
     behöver hantera det nya felfallet. */
  /* R3-A FIX (independent-reviewer finding, round 4): `create()` has
     always returned the new AO object SYNCHRONOUSLY with
     `ao._pendingSync = true` while the real server create is still in
     flight in the background (correct — that is what lets the AO list
     show the new row instantly). The bug this round's reviewer found is
     NOT in this function — it is that three CALLERS
     (`PageShells.js` offer→AO conversion, `RecurringOrderService.
     createNextAO()`, `RonderingService`'s AO-from-deviation linking)
     were treating that synchronous, UNCONFIRMED return value as if it
     were already a final, ACKed fact, and immediately committing their
     OWN permanent cross-reference (off.workOrderId/convertedAt, ro.
     lastCreatedDate/nextDate, avv.workOrderId) before the server had
     actually confirmed the AO exists. If the server later rejects the
     create (e.g. a stale project-compatibility check that changed
     between client and server, a genuine 409), that cross-reference is
     now permanently wrong — an offer marked "converted" to an AO that
     was never created, a recurring schedule that silently skipped an
     order, a deviation linked to nothing.

     Fix: `create()` now accepts an optional second `opts` argument with
     `opts.onSettled(result)`, called from the SAME place the existing
     internal onSettled handler already runs (AOTimeSyncService's real
     server ACK), with `result = { ok, final, error, ao }`. Callers that
     need to commit a DEPENDENT permanent cross-reference must do so
     ONLY inside this callback on `result.ok === true` — never
     synchronously after `create()` returns. This does not change
     anything for the ~20 existing callers that don't pass `opts` at
     all (`ao` is still returned synchronously exactly as before, for
     the optimistic AO-list display, navigation target, etc.) — it is
     purely additive. */
  create(data, opts) {
    data = data || {};
    opts = opts || {};
    if (data.projectId) {
      const compatible = typeof ProjectService !== 'undefined' &&
        ProjectService.isChildCompatible(data.projectId, data.customerId, data.propertyId || '');
      if (!compatible) {
        return { ok: false, error: 'Arbetsordern kunde inte kopplas till det valda projektet (kund/fastighet stämmer inte).' };
      }
    }
    const ao = Object.assign(Schema.workOrder(), data, {
      id:        this._newAoId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    /* R2.5 — EN kanonisk skapande-tids-adress-snapshot, körd HÄR för
       VARJE ny AO oavsett vilket produktionsflöde som anropade create()
       (huvudguiden, Återkommande, Rondering, Serviceintervall, offert->AO,
       Fastighetens direktskapande-knapp, m.fl.) — se
       AddressService.resolveCreateAddressSnapshot()s kommentar för den
       fullständiga motiveringen och regelordningen. Ingen effekt om
       anroparen redan skickat en komplett strukturerad adress (t.ex.
       huvudguiden, som redan gör detta själv) eller satt addressOverride.
       ALDRIG körd från update() — en befintlig AO:s sparade adress är en
       historisk ögonblicksbild, oförändrad sedan R1 §4. */
    if (typeof AddressService !== 'undefined' && typeof AddressService.resolveCreateAddressSnapshot === 'function') {
      AddressService.resolveCreateAddressSnapshot(ao);
    }
    state.workOrders.push(ao);
    console.log('[WorkOrderService] AO skapad lokalt:', ao.id, ao.title);
    ActivityService.log('work_order_created',
      `Arbetsorder ${ao.id} skapad: ${ao.title}`,
      { customerId: ao.customerId, workOrderId: ao.id });
    /* P0 AO/TID-FIX: den FAKTISKA serverskapelsen går nu via den atomiska
       work_order_create-RPC:n (se _syncAO-filhuvudet ovan för varför
       persist() ändå behövs här parallellt — den täcker activityLog m.fl.,
       inte längre workOrders). `ao.id` skickas med som p_client_id
       (RPC:n accepterar det och kontrollerar KOLLISION atomiskt mot den
       LÅSTA raden i stället för tyst överskrivning — se migrationens R2-
       kommentar) så att det synkrona kontraktet nedan (returnera `ao`
       direkt, med sitt ID, för navigering/koppling) förblir OFÖRÄNDRAT
       för alla ~20 befintliga anropsplatser. */
    if (typeof AOTimeSyncService !== 'undefined') {
      ao._pendingSync = true;
      AOTimeSyncService.createAO(ao, {
        /* B1 FIX (round 5): `opts.onSettledIntent`, if the caller gave
           one (just `{kind, refId, ...}` — the caller does NOT know
           `ao.id` yet when it builds this, since that is assigned
           inside THIS function), is forwarded to AOTimeSyncService's
           DURABLE intent mechanism (see that file's own header) with
           `aoId` filled in here — completely separate from the
           in-memory `onSettled` callback below, which only ever helps
           THIS caller's own in-memory `ao` object within the SAME
           session. */
        onSettledIntent: opts.onSettledIntent ? Object.assign({}, opts.onSettledIntent, { aoId: ao.id }) : undefined,
        onSettled: function (r) {
          if (r.ok) {
            ao._pendingSync = false;
            /* Product decision fix (round 4): the server-allocated,
               human-friendly displayNumber only exists once the REAL
               create is ACKed (it is assigned inside the same locked
               RPC transaction as the create, see migration
               20261020000001_ao_display_number.sql) — pick it up here
               and stamp it onto the SAME in-memory object every
               existing caller already holds a reference to, so the AO
               list/detail page can show it as soon as it exists
               without needing a page reload. Before this fires, UI
               code should fall back to displayNumberOrPending(ao) (see
               below), never to the raw internal `ao.id` (a UUID). */
            if (r.data && r.data.workOrder && r.data.workOrder.displayNumber) {
              ao.displayNumber = r.data.workOrder.displayNumber;
            }
            if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') {
              Storage.setLocal('workOrders', state.workOrders);
            }
          } else if (r.final) {
            ao._pendingSync = false;
            ao._syncFailed = r.error;
            console.error('[WorkOrderService] AO-skapande avvisades av servern för', ao.id, ':', r.error);
            if (typeof opts.onSettled !== 'function' && typeof AOTimeSyncService.reportUnhandledRejection === 'function') {
              AOTimeSyncService.reportUnhandledRejection('ao', 'ny arbetsorder' + (ao.title ? ' "' + ao.title + '"' : ''), r.error);
            }
          }
          if (typeof WorkOrdersPage !== 'undefined' && typeof WorkOrdersPage.onSyncStatusChanged === 'function') {
            WorkOrdersPage.onSyncStatusChanged(ao.id);
          }
          // R3-A FIX: let the caller's own cross-reference-commit logic
          // run AFTER (never instead of) the internal handling above,
          // and AFTER the real server ACK — not synchronously at
          // create()-call time. `r` already carries {ok, final, error};
          // `ao` is added so the callback need not close over anything
          // beyond what create() itself returned.
          if (typeof opts.onSettled === 'function') {
            try { opts.onSettled(Object.assign({}, r, { ao: ao })); } catch (e) { console.error('[WorkOrderService] caller onSettled threw:', e); }
          }
        }
      });
    } else if (typeof opts.onSettled === 'function') {
      // AOTimeSyncService not loaded at all (defensive no-op path, see
      // _syncAO's own comment). FAIL-CLOSED FIX (2026-11-12): this used
      // to report `{ok:true, final:true}` — a false "server confirmed"
      // for a create that never left the client, which would make an
      // ACK-then-commit caller (offer->AO, recurring next-AO, rondering
      // deviation->AO) durably commit a cross-reference to an AO the
      // server never saw. The caller is still always resolved (never
      // left hanging), but now with an honest final rejection.
      try { opts.onSettled({ ok: false, final: true, error: 'sync_unavailable', ao: ao }); } catch (e) { console.error('[WorkOrderService] caller onSettled threw:', e); }
    }
    persist();
    console.log('[WorkOrderService] persist() skickad till Supabase för', ao.id);
    Sidebar.updateBadges();
    /* Push-notis — ej för historiska importer (ao.historicalImport = true) */
    if (!ao.historicalImport &&
        typeof PushService !== 'undefined' &&
        typeof PushService.notifyNewAO === 'function') {
      PushService.notifyNewAO(ao).catch(function(e) {
        console.warn('[WorkOrderService] Push-fel för', ao.id, ':', e);
      });
    }
    this.geocodeAddressIfNeeded(ao).catch(function(e) {
      console.warn('[WorkOrderService] Geokodning misslyckades för', ao.id, ':', e);
    });
    return ao;
  },

  /* V54B §9 — kanonisk koppla/flytta/koppla-loss AO↔Projekt, ETT
     ställe för hela flödet (inte en tyst bieffekt av ett generiskt
     update()-anrop) så att UI:t (ProjectDetailPage "Koppla befintlig
     arbetsorder"/"Flytta"/"Koppla loss", WorkOrderDetailPage:s
     Projekt-väljare) alltid loggar och validerar likadant.
     `projectId` = '' eller null kopplar loss. Validerar ALLTID kund-/
     fastighetsinvarianten defensivt här, oavsett vad anroparen redan
     kontrollerat interaktivt — samma tvålagersdisciplin som V53B R1. */
  setProject(id, projectId, opts) {
    const ao = getAO(id);
    if (!ao) return { ok: false, error: 'Arbetsordern hittades inte' };
    opts = opts || {};
    const by = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : 'Admin';
    const oldProjectId = ao.projectId || '';
    const newProjectId = projectId || '';

    if (newProjectId) {
      if (typeof ProjectService === 'undefined' || !ProjectService.isChildCompatible(newProjectId, ao.customerId, ao.propertyId)) {
        return { ok: false, error: 'Arbetsordern är inte förenlig med det valda projektet (kund/fastighet stämmer inte).' };
      }
      /* Om AO:n redan hör till ett ANNAT projekt krävs en uttrycklig
         flytt-bekräftelse från anroparen (opts.confirmedMove) — en AO
         får aldrig tyst "stjälas" från sitt nuvarande projekt. */
      if (oldProjectId && oldProjectId !== newProjectId && !opts.confirmedMove) {
        return { ok: false, error: 'ALREADY_LINKED', currentProjectId: oldProjectId };
      }
    }
    if (newProjectId === oldProjectId) return { ok: true, workOrder: ao, noop: true };

    const newProj = newProjectId ? ProjectService.getById(newProjectId) : null;
    const oldProj = oldProjectId ? ProjectService.getById(oldProjectId) : null;
    let text;
    if (newProjectId && oldProjectId) text = `${by} flyttade arbetsordern från projekt ${oldProj ? oldProj.name : oldProjectId} till ${newProj ? newProj.name : newProjectId}`;
    else if (newProjectId) text = `${by} kopplade arbetsordern till projekt ${newProj ? newProj.name : newProjectId}`;
    else text = `${by} kopplade loss arbetsordern från projekt ${oldProj ? oldProj.name : oldProjectId}`;

    const log = (ao.log || []).slice();
    log.push({ id: 'L' + Date.now(), type: 'project_relation_changed', text, userName: by, timestamp: new Date().toISOString() });
    this._update_internal(id, { projectId: newProjectId, log });
    return { ok: true, workOrder: getAO(id) };
  },

  /* V54B R1 — blockerare 4: den publika update() fick tidigare ändra
     `projectId` som VILKEN ANNAN fält som helst — vilket helt kringgick
     setProject()s kompatibilitetsvalidering, flytt-bekräftelse
     (ALREADY_LINKED) och revisionslogg. `projectId` skyddas nu i
     update() på samma sätt som id/createdAt redan är oföränderliga på
     andra ställen i kodbasen — ENDAST setProject() (via den interna
     _update_internal()) får sätta det. En anropare som råkar skicka med
     `projectId` i en vanlig update()-patch får den tyst ignorerad HÄR
     (fältet tas bort ur patchen), inte en förvirrande delvis-mutation —
     Projekt-relationen ändras uteslutande via den explicita, loggade
     setProject()-vägen.

     FLOW-A FIX (this round): `update()`/`_update_internal()` now accept an
     optional `opts` (mirrors create()'s R3-A pattern, see that function's
     comment and _syncAO()'s own updated comment above). All ~20 existing
     callers pass no `opts` and are completely unaffected — `ao` is still
     returned synchronously exactly as before. A caller that DOES need a
     real server confirmation (WorkOrderDetailPage.doSave(), the one
     confirmed bug this round) passes `opts.onSettled(result)`, forwarded
     into `_syncAO()`'s own onSettled wiring with `result.ao` added so the
     caller need not close over anything beyond what `update()` itself
     returned. */
  update(id, data, opts) {
    const safeData = Object.assign({}, data);
    delete safeData.projectId;
    return this._update_internal(id, safeData, opts);
  },

  _update_internal(id, data, opts) {
    opts = opts || {};
    const ao = getAO(id);
    if (!ao) {
      if (typeof opts.onSettled === 'function') {
        try { opts.onSettled({ ok: false, final: true, error: 'Arbetsordern hittades inte.' }); } catch (e) { console.error('[WorkOrderService] caller onSettled threw (update, missing ao):', e); }
      }
      return null;
    }
    /* P0 AO/TID-FIX: `expectedUpdatedAt` lost-update-skyddet (RPC:ns
       p_expected_updated_at) medvetet INTE använt här — se motivering i
       README §"stale_write-beslut": detta generiska update()-anrop
       körs ofta i snabb följd från SAMMA session (t.ex. omedelbart av
       geocodeAddressIfNeeded() nedan) UTAN att vänta på föregående
       anrops serverbekräftelse, vilket skulle ge falska stale_write-
       avvisningar inom SAMMA flik — en värre regression än den sällsynta
       verkliga tvärsession-kollisionen detta fält annars skyddar mot.
       Själva race-fixen (atomisk radlåsning + merge mot den FAKTISKA
       serverraden, aldrig en hel array-överskrivning) gäller OAVSETT —
       detta fält är bara ett valfritt, EXTRA lager för UI:n som faktiskt
       har en konflikthanteringsdialog (ingen av dagens anropsplatser har
       det ännu). */
    const patch = Object.assign({}, data, { updatedAt: new Date().toISOString() });
    Object.assign(ao, patch);
    ActivityService.log('work_order_updated',
      `Arbetsorder ${ao.id} redigerad: ${ao.title}`,
      { customerId: ao.customerId, workOrderId: ao.id });
    this._syncAO(ao, patch, {
      onSettled: typeof opts.onSettled === 'function' ? function (r) {
        opts.onSettled(Object.assign({}, r, { ao: ao }));
      } : undefined
    });
    persist();
    this.geocodeAddressIfNeeded(ao).catch(function(e) {
      console.warn('[WorkOrderService] Geokodning misslyckades för', ao.id, ':', e);
    });
    return ao;
  },

  /* ── Arbetsadress → koordinater ──────────────────────────────────────
   * Körs efter varje create()/update(). R1 §1 (blockerare #1, oberoende
   * reproducerad): byggde tidigare EN EGEN, snävare frågesträng härifrån
   * — bara AO:ns egna address/zip/city — som ALDRIG använde den länkade
   * fastighetens/kundens postnr/ort som fallback, till skillnad från
   * Dashboard-kartans egen (korrekta) kedja. En legacy-AO med bara en
   * gatuadress + länkad fastighet i Göteborg kunde alltså geokodas som
   * bara "Södra Vägen 4" (ingen stadskontext) varje gång update() kördes
   * — och EN GÅNG en koordinat väl sparats på ao.lat/ao.lng prioriterar
   * kartan alltid DEN, och når aldrig sin egen säkrare fallback-kedja.
   * Fixat: använder nu SAMMA kanoniska AddressService.resolveWorkOrderQuery()
   * som kartan — de två kan inte längre divergera.
   *
   * R1 §2 (blockerare #2, oberoende reproducerad) — race mellan två
   * överlappande geokodningsförsök för SAMMA AO (t.ex. adressen ändras och
   * update() körs igen INNAN det första, långsammare geokodningssvaret
   * hunnit komma tillbaka): ett sent svar för den GAMLA frågan kunde
   * skriva över koordinater som redan korrekt satts av ett SENARE, snabbare
   * svar för den NYA frågan. Fixat med en generations-token per AO-id
   * (_geocodeGen) — precis som Dashboard._mapGeneration redan skyddar
   * kartans egen race — plus en extra kontroll att AO:ns adress inte hunnit
   * ändras UNDER väntan (bälte-och-hängslen, skyddar även vägar som inte
   * går via denna tokenmekanism). Ett föråldrat svar kastas TYST — rör
   * varken ao.lat/ao.lng/ao.geocodedAddress, och persisterar ingenting.
   *
   * En oförändrad adress geokodas ALDRIG om (jämförs mot
   * ao.geocodedAddress). Körs alltid asynkront EFTER att create()/update()
   * redan persistat synkront — geokodning får aldrig blockera eller kunna
   * få ett spara-anrop att krascha (uppdragets §8). */
  _geocodeGen: {}, // { [aoId]: senaste startade geokodningsförsökets nummer }

  async geocodeAddressIfNeeded(ao) {
    if (!ao || typeof AddressService === 'undefined') return;
    const resolved = AddressService.resolveWorkOrderQuery(ao);
    const query = resolved ? resolved.query : '';
    if (!query) {
      if (ao.lat != null || ao.lng != null || ao.geocodedAddress) {
        ao.lat = null; ao.lng = null; ao.geocodedAddress = '';
        this._syncAO(ao, { lat: null, lng: null, geocodedAddress: '' });
        persist();
      }
      return;
    }
    if (query === ao.geocodedAddress && ao.lat != null && ao.lng != null) return; // redan geokodad, oförändrad

    const myGen = (this._geocodeGen[ao.id] || 0) + 1;
    this._geocodeGen[ao.id] = myGen;

    const coord = await AddressService.geocodeTrusted(query, resolved.hasCityContext);

    /* Stale-kontroll #1: har ett NYARE geokodningsförsök för samma AO redan
       startat medan vi väntade på detta svar? Om så, kasta TYST — det
       nyare försöket äger sanningen. */
    if (this._geocodeGen[ao.id] !== myGen) return;
    /* Stale-kontroll #2 (bälte-och-hängslen): resolvera AO:ns adress IGEN,
       mot dess NUVARANDE (kanske sedan ändrade) tillstånd — om frågan inte
       längre är densamma som den vi just geokodade, hör svaret till en
       adress som inte längre gäller. Kasta TYST, rör ingenting. */
    const recheck = AddressService.resolveWorkOrderQuery(getAO(ao.id) || ao);
    if (!recheck || recheck.query !== query) return;

    if (coord) {
      ao.lat = coord.lat;
      ao.lng = coord.lng;
    } else if (ao.geocodedAddress !== query) {
      /* Adressen ändrades men det nya försöket gav inget säkert resultat —
         gamla koordinater hörde till en ANNAN adress och får inte stå kvar
         (hellre ingen nål än en nål på fel adress, uppdragets §8). */
      ao.lat = null;
      ao.lng = null;
    }
    ao.geocodedAddress = query;
    this._syncAO(ao, { lat: ao.lat, lng: ao.lng, geocodedAddress: query });
    persist();
  },

  /* STATUS-ACK FIX (2026-11-12): setStatus()/markComplete() now accept an
     optional `opts.onSettled(result)` — exactly the same additive
     pattern update() got in commit 4078994 (forwarded into _syncAO()'s
     own onSettled wiring, `result.ao` attached). AO status gates billing
     eligibility (readyForInvoice() requires status 'klar'), so the UI
     buttons "Starta arbete"/"Klarmarkera"/status-change must not claim
     success before the server has confirmed the status write. Callers
     that pass no opts (autoStartFromChecklist(), bulk paths, etc.) are
     completely unaffected. */
  /* STATUS-ROLLBACK FIX (2026-11-12, owner-corrected QA finding — verified
     against the code before fixing with a vm repro: after a FINAL server
     rejection of markComplete(), `ao.status` stayed 'klar' and
     `ao.completedAt`/`ao.completedBy` stayed set; only `_syncFailed` and
     an error toast reflected the rejection). The real bug is NOT that a
     fakturaunderlag can be created from a 'pågående' order (partial /
     running invoicing is an explicit business requirement — no "must be
     klar" gate is added anywhere), it is that a failed status change left
     the CRM in a FALSE local state that every re-render then displayed as
     the truth.

     Fix, scoped to setStatus()/markComplete() ONLY (`_syncAO()` itself and
     its ~20 other callers — checklist/material/notes/archive/etc. — are
     deliberately untouched): the business fields this function changes
     (`status`, `updatedAt`, plus `completedAt` for 'klar' and
     `completedBy` for markComplete()) are snapshotted immediately BEFORE
     the optimistic mutation. The rollback runs INSIDE this function's own
     onSettled wrapper, which is now ALWAYS passed to `_syncAO()` (not only
     when the caller supplied opts.onSettled), so every caller —
     WorkOrderDetailPage "Starta arbete"/status modal/"Klarmarkera"/
     återaktivera, MyJobsPage.startJob(), autoStartFromChecklist(), any
     future caller — is protected without having to opt in. On
     `r.final === true && r.ok === false` it:
       1. restores the snapshotted fields (see _rollbackStatusAttempt() for
          the overlapping-attempt rules — a newer status attempt or an
          untracked writer (bulk, takeFromPool, a server refresh replacing
          the object) always wins; a rollback never overwrites them);
       2. logs a correcting 'work_order_status' activity entry (append-only
          history: the original "X → Y" entry is kept, the correction says
          the server rejected it and what it was restored to);
       3. rewrites the `vift_workOrders` localStorage cache
          (Storage.setLocal) so a reload cannot resurrect the rejected
          status from a stale cache written by an unrelated ACK in between;
       4. re-renders: fires the existing onSyncStatusChanged hooks (if
          defined — today neither page defines them, so they are a no-op)
          AND refreshes the currently visible AO view via
          Router.refreshCurrent() when it can show this AO (pg-ao, pg-myjobs,
          pg-dash, or pg-ao-detail for this same aoId), plus
          Sidebar.updateBadges();
       5. shows a toast ONLY if the caller passed no opts.onSettled (callers
          that pass one already show their own failure toast — no double
          toast);
       6. THEN forwards the result to the caller's opts.onSettled, with
          `ao` (now reverted), `rolledBack` and `restoredStatus` attached.
     Transient (non-final) results change nothing (still queued/pending).
     The no-AOTimeSyncService fallback (`sync_unavailable`, never hit in
     production — see _syncAO()'s header) is NOT a server rejection and
     does not roll back (preserves the documented local-only behavior). */
  _statusAttempts: {},
  _statusAttemptSeq: 0,
  _STATUS_REFRESH_PAGES: ['pg-ao', 'pg-myjobs', 'pg-dash'],

  setStatus(id, status, opts) {
    return this._applyStatus(id, status, opts || {}, null);
  },

  _applyStatus(id, status, opts, extra) {
    const self = this;
    const ao = getAO(id);
    if (!ao) {
      if (typeof opts.onSettled === 'function') {
        try { opts.onSettled({ ok: false, final: true, error: 'Arbetsordern hittades inte.' }); } catch (e) { console.error('[WorkOrderService] caller onSettled threw (setStatus, missing ao):', e); }
      }
      return null;
    }
    const prev = ao.status;
    // Snapshot BEFORE any mutation — only the fields this attempt touches.
    const snapPrev = { status: ao.status, updatedAt: ao.updatedAt };
    if (status === 'klar') snapPrev.completedAt = ao.completedAt;
    if (extra && extra.completedBy) { snapPrev.completedBy = ao.completedBy; ao.completedBy = extra.completedBy; }
    ao.status    = status;
    ao.updatedAt = new Date().toISOString();
    const patch = { status: status, updatedAt: ao.updatedAt };
    if (status === 'klar') { ao.completedAt = new Date().toISOString(); patch.completedAt = ao.completedAt; }
    const snapNext = {};
    Object.keys(snapPrev).forEach(function (f) { snapNext[f] = ao[f]; });
    const attempt = { seq: ++this._statusAttemptSeq, ao: ao, prev: snapPrev, next: snapNext, state: 'pending' };
    (this._statusAttempts[ao.id] = this._statusAttempts[ao.id] || []).push(attempt);

    ActivityService.log('work_order_status',
      `Arbetsorder ${ao.id} ändrad: ${statusLabel(prev)} → ${statusLabel(status)}`,
      { customerId: ao.customerId, workOrderId: ao.id });
    this._syncAO(ao, patch, {
      onSettled: function (r) {
        let rb = null;
        if (r && r.ok) {
          self._settleStatusAttempt(attempt, 'ok');
          /* K2 (2026-11-12): only once the server CONFIRMED the status. */
          if (typeof RonderingService !== 'undefined' && typeof RonderingService.syncAvvikelserWithWorkOrderStatus === 'function') {
            try { RonderingService.syncAvvikelserWithWorkOrderStatus(ao.id, status); } catch (e) { console.error('[WorkOrderService] avvikelse-synk misslyckades:', e); }
          }
        }
        else if (r && r.final && r.error !== 'sync_unavailable') rb = self._rollbackStatusAttempt(attempt, r, typeof opts.onSettled !== 'function');
        else if (r && r.final) self._settleStatusAttempt(attempt, 'unsynced');
        if (typeof opts.onSettled === 'function') {
          opts.onSettled(Object.assign({}, r, { ao: ao }, rb ? { rolledBack: rb.rolledBack, restoredStatus: rb.restoredStatus } : {}));
        }
      }
    });
    persist();
    Sidebar.updateBadges();
    return ao;
  },

  /* Marks an attempt settled and prunes the per-AO attempt list: once an
     attempt is CONFIRMED (ok) every older attempt is irrelevant to future
     rollbacks; when nothing is pending any more the entry is dropped. */
  _settleStatusAttempt(attempt, st) {
    attempt.state = st;
    let list = this._statusAttempts[attempt.ao.id];
    if (!list) return;
    if (st === 'ok') {
      const i = list.indexOf(attempt);
      // Older attempts are superseded by this CONFIRMED one: a later
      // rejection of any of them must never roll anything back.
      list.slice(0, i).forEach(function (a) { a.superseded = true; });
      list = list.slice(i);
    }
    if (!list.some(function (a) { return a.state === 'pending'; })) delete this._statusAttempts[attempt.ao.id];
    else this._statusAttempts[attempt.ao.id] = list;
  },

  /* Rollback of ONE finally-rejected status attempt. Rules:
     - If a NEWER tracked attempt that is still pending or confirmed
       exists for the same AO, nothing is restored now (the newer attempt's value is what the user last
       asked for); the attempt is only marked rejected, so that if the
       newer one is ALSO rejected later, its rollback skips past this one.
     - The AO object must still be the one in state (a server refresh that
       replaced it already shows server truth) and `ao.status` must still
       equal what THIS attempt set (otherwise an untracked writer — bulk
       status, takeFromPool/assign, an edit — changed it since; never
       clobber that).
     - Each field is restored from this attempt's `prev` snapshot, except
       that if that value itself came from an older, ALSO-rejected
       attempt, it walks further back to that attempt's `prev` (stops at
       the first older attempt that is pending/ok — its values are
       legitimate). A field is only restored if it still holds the value
       this attempt wrote. */
  _rollbackStatusAttempt(attempt, r, toastIfNoCaller) {
    const aoId = attempt.ao.id;
    const list = this._statusAttempts[aoId] || [attempt];
    const idx = list.indexOf(attempt);
    attempt.state = 'rejected';
    // "Latest" = no NEWER attempt that is still pending or confirmed
    // (newer attempts that were themselves rejected — and already rolled
    // back to this attempt's value — do not count).
    const isLatest = idx === -1 || list.slice(idx + 1).every(function (a) { return a.state === 'rejected'; });
    const ao = attempt.ao;
    let result = { rolledBack: false, restoredStatus: ao.status };
    if (!attempt.superseded && isLatest && getAO(aoId) === ao && ao.status === attempt.next.status) {
      const target = Object.assign({}, attempt.prev);
      for (let i = idx - 1; i >= 0; i--) {
        const e = list[i];
        if (e.state !== 'rejected') break;
        Object.keys(e.next).forEach(function (f) {
          if (Object.prototype.hasOwnProperty.call(target, f) && target[f] === e.next[f]) target[f] = e.prev[f];
        });
      }
      const attempted = ao.status;
      Object.keys(target).forEach(function (f) {
        if (ao[f] !== attempt.next[f]) return;
        if (target[f] === undefined) delete ao[f]; else ao[f] = target[f];
      });
      result = { rolledBack: true, restoredStatus: ao.status };
      try {
        ActivityService.log('work_order_status',
          `Arbetsorder ${ao.id}: statusändringen till ${statusLabel(attempted)} avvisades av servern (${r.error || 'okänt fel'}) — återställd till ${statusLabel(ao.status)}`,
          { customerId: ao.customerId, workOrderId: ao.id });
      } catch (e) { console.error('[WorkOrderService] rollback log failed:', e); }
      console.warn('[WorkOrderService] Status för', ao.id, 'återställd till', ao.status, 'efter serveravvisning:', r.error);
      if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') {
        Storage.setLocal('workOrders', state.workOrders);
      }
      try { persist(); } catch (e) { console.error('[WorkOrderService] rollback persist failed:', e); }
      this._rerenderAfterStatusRollback(aoId);
      if (toastIfNoCaller && typeof showToast === 'function') {
        showToast(`Statusändringen för ${ao.id} avvisades av servern — status återställd till ${statusLabel(ao.status)}.`);
      }
    }
    if (!list.some(function (a) { return a.state === 'pending'; })) delete this._statusAttempts[aoId];
    return result;
  },

  _rerenderAfterStatusRollback(aoId) {
    try {
      if (typeof WorkOrdersPage !== 'undefined' && typeof WorkOrdersPage.onSyncStatusChanged === 'function') WorkOrdersPage.onSyncStatusChanged(aoId);
      if (typeof WorkOrderDetailPage !== 'undefined' && typeof WorkOrderDetailPage.onSyncStatusChanged === 'function') WorkOrderDetailPage.onSyncStatusChanged(aoId);
      if (typeof Router !== 'undefined' && typeof Router.refreshCurrent === 'function') {
        const pg = Router.currentPage;
        const params = Router.currentParams || {};
        if (this._STATUS_REFRESH_PAGES.indexOf(pg) !== -1 || (pg === 'pg-ao-detail' && params.aoId === aoId)) {
          Router.refreshCurrent();
        }
      }
      if (typeof Sidebar !== 'undefined' && typeof Sidebar.updateBadges === 'function') Sidebar.updateBadges();
    } catch (e) { console.error('[WorkOrderService] re-render after status rollback failed:', e); }
  },

  markComplete(id, completedBy, opts) {
    // completedBy is now set INSIDE _applyStatus(), after the rollback
    // snapshot is taken (previously set here first, so it could not be
    // restored on a rejection). Local effect for the success path is
    // identical: ao.completedBy === completedBy, status 'klar'.
    return this._applyStatus(id, 'klar', opts || {}, completedBy ? { completedBy: completedBy } : null);
  },

  /* AO-CHECKLIST-AUTOSTART R1 (se RAPPORT-AO-CHECKLIST-AUTOSTART-R1.md
     för fullständig spårning). Ren återanvändning av setStatus() ovan —
     SAMMA kanoniska övergång och logghändelse ('work_order_status') som
     manuell "Starta arbete" (WorkOrderDetailPage._primaryActionBtns /
     setStatus). Ingen parallell statusarkitektur.
     Behörighet [RÄTTAD I R1.1 — var felaktigt dokumenterad här som
     "MUST already have verified ao_edit", vilket INTE stämmer sedan
     R1.1:s behörighetsfix]: precis som setStatus() själv bär INGEN egen
     behörighetskontroll, upprätthålls detta fortfarande av ANROPAREN —
     men den korrekta, godkända regeln (R1.1) är ao_checklist ELLER
     ao_edit, inte enbart ao_edit. Se WorkOrderDetailPage.setAvvikelse()/
     _openAvvikelseModal() (klientsidan) och work-order-checklist-
     resolve/index.ts (R1.2, serversidan) för var den regeln faktiskt
     upprätthålls idag.
     Idempotens/status-säkerhet: vakten nedan är SAMMA "ostartad"-lista
     som redan styr "Starta arbete"-knappens synlighet
     (['nytt','pool','planerad']). Så snart status blivit 'pågående'
     (eller redan var 'klar'/'fakturerad'/'avbruten') kortsluts alla
     efterföljande anrop utan ny statushändelse — aldrig bakåt, aldrig
     en låst/avslutad order återöppnad.
     R1.2 — ANVÄNDNING: denna metod (lokal mutation + generisk persist())
     anropas INTE LÄNGRE av WorkOrderDetailPage.setAvvikelse()/
     _openAvvikelseModal() — de går numera via den atomiska
     work-order-checklist-resolve-vägen (se RAPPORT-...-R1.2.md §1) för
     att eliminera det verifierade samtidighetsraceet mellan klienter.
     Metoden lämnas OFÖRÄNDRAD och kvar (samma etablerade mönster som
     redan gäller för toggleChecklist()/removeChecklist(), vilka sedan
     R1 också saknar egna UI-anropsplatser) — ingen befintlig
     testyta/beteende tas bort, bara den nya, race-säkra vägen föredras
     av de två live UI-anropsplatserna. */
  autoStartFromChecklist(id) {
    const ao = getAO(id);
    if (!ao) return;
    if (!['nytt','pool','planerad'].includes(ao.status)) return;
    this.setStatus(id, 'pågående');
  },

  /* AO-CHECKLIST-AUTOSTART R1.2/R1.3 — atomisk, race-säker checklist-
     mutation via work-order-checklist-resolve (se
     supabase/migrations/20260917000001_work_order_checklist_atomic_rpc.sql
     och RAPPORT-AO-CHECKLIST-AUTOSTART-R1.2/R1.3.md för fullständig
     spårning). Ersätter, för EXAKT denna operation, den tidigare vägen
     "mutera lokal kopia + generisk persist()" — den generiska
     persist()-vägen kvarstår oförändrad för ALLA ANDRA AO-mutationer
     (titel, personal, prissättning, tid, m.fl.), detta är INTE en
     ersättning av den generiska arkitekturen.
     Kontrakt: {ok, error} vid fel, {ok:true, workOrder} vid framgång —
     samma mönster som ProjectDocumentService/ProjectService redan
     etablerat. Uppdaterar ALDRIG lokal state förrän servern bekräftat
     — vid fel lämnas state helt orörd (ingen "låtsad framgång").

     R1.3 BLOCKERARE 1: denna metod deltar nu i EXAKT samma DataSync-
     skrivspärr som persist() själv (state.js) — annars kunde en redan
     pågående DataSync._poll() (som hunnit påbörja sin GET INNAN detta
     anrop startade) applicera en INAKTUELL fjärr-snapshot ovanpå just
     denna bekräftade, färskare lokala mutation, och synligt rulla
     tillbaka checklistan/statusen tills nästa poll. `_pendingWrites`/
     `_localWriteGeneration` höjs SYNKRONT här, INNAN någon await —
     precis som persist() kräver — och `_pendingWrites` sänks alltid i
     `finally`, oavsett framgång/fel (Math.max(0, ...) skyddar mot att
     någonsin gå under noll, samma som persist()).
     R1.3 BLOCKERARE 2: `body.activityLog` (den FAKTISKA kanoniska
     loggen som RPC:n alltid returnerar, se migrationen) skriver nu
     ÖVER `state.activityLog` i sin helhet — inte bara AO:n — så att en
     redan skapad starthändelse (av DENNA eller en SAMTIDIG andra
     klients anrop) omedelbart finns lokalt och aldrig kan raderas av
     en efterföljande, ovetande generisk persist().
     VIKTIGT (uttryckligt krav): `DataSync._lastSig` sätts ALDRIG från
     `body.serverSignature` — detta är ett smalt, partiellt svar, inte
     en fullständig generisk snapshot av all CRM-data. Nästa ordinarie
     DataSync-poll måste fortfarande själv upptäcka den nya server-
     signaturen och hämta en fullständig, självkonsekvent snapshot. */
  async resolveChecklistItemAtomic(aoId, itemId, avvikelse, avvikelseComment, avvikelseImage) {
    if (typeof DataSync !== 'undefined') {
      DataSync._pendingWrites = (DataSync._pendingWrites || 0) + 1;
      DataSync._localWriteGeneration = (DataSync._localWriteGeneration || 0) + 1;
    }
    try {
      const res = await fetch(this._edgeBase() + '/functions/v1/work-order-checklist-resolve', {
        method: 'POST',
        headers: this._authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          aoId, itemId,
          avvikelse: avvikelse === undefined ? null : avvikelse,
          avvikelseComment: avvikelseComment || '',
          avvikelseImage: avvikelseImage || ''
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: body.error || ('HTTP ' + res.status) };
      const ao = getAO(aoId);
      if (ao && body.workOrder) {
        Object.assign(ao, body.workOrder);
        if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') {
          Storage.setLocal('workOrders', state.workOrders);
        }
      }
      if (Array.isArray(body.activityLog)) {
        state.activityLog = body.activityLog;
        if (typeof Storage !== 'undefined' && typeof Storage.setLocal === 'function') {
          Storage.setLocal('activityLog', state.activityLog);
        }
      }
      /* R1.3 — se filhuvudkommentaren: serverSignature medvetet ALDRIG
         tilldelat DataSync._lastSig här. */
      return { ok: true, workOrder: body.workOrder };
    } catch (e) {
      return { ok: false, error: 'Kunde inte spara checklistan: ' + (e.message || e) };
    } finally {
      if (typeof DataSync !== 'undefined') {
        DataSync._pendingWrites = Math.max(0, (DataSync._pendingWrites || 0) - 1);
      }
    }
  },

  _edgeBase() {
    return (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '').replace(/\/$/, '');
  },

  _authHeaders(extra) {
    return Object.assign({
      'apikey': (typeof SUPABASE_AKEY !== 'undefined' ? SUPABASE_AKEY : ''),
      'Authorization': 'Bearer ' + (typeof Auth !== 'undefined' ? (Auth.getAccessToken() || '') : '')
    }, extra || {});
  },

  /* Checklista */
  addChecklist(aoId, text) {
    const ao = getAO(aoId);
    if (!ao) return;
    ao.checklist = ao.checklist || [];
    ao.checklist.push({ id: 'c' + Date.now(), text, done: false });
    ao.updatedAt = new Date().toISOString();
    this._syncAO(ao, { checklist: ao.checklist, updatedAt: ao.updatedAt });
    persist();
  },

  toggleChecklist(aoId, idx) {
    const ao = getAO(aoId);
    if (!ao || !ao.checklist[idx]) return;
    ao.checklist[idx].done = !ao.checklist[idx].done;
    ao.updatedAt = new Date().toISOString();
    this._syncAO(ao, { checklist: ao.checklist, updatedAt: ao.updatedAt });
    persist();
  },

  removeChecklist(aoId, idx) {
    const ao = getAO(aoId);
    if (!ao) return;
    ao.checklist.splice(idx, 1);
    ao.updatedAt = new Date().toISOString();
    this._syncAO(ao, { checklist: ao.checklist, updatedAt: ao.updatedAt });
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
    this._syncAO(ao, { materials: ao.materials, updatedAt: ao.updatedAt });
    persist();
    return entry;
  },

  updateMaterial(aoId, matId, data) {
    const ao = getAO(aoId);
    if (!ao) return;
    const mat = (ao.materials || []).find(m => m.id === matId);
    if (mat) {
      Object.assign(mat, data);
      ao.updatedAt = new Date().toISOString();
      this._syncAO(ao, { materials: ao.materials, updatedAt: ao.updatedAt });
      persist();
    }
  },

  deleteMaterial(aoId, matId) {
    const ao = getAO(aoId);
    if (!ao) return;
    ao.materials = (ao.materials || []).filter(m => m.id !== matId);
    ao.updatedAt = new Date().toISOString();
    ActivityService.log('material_removed', `Material borttaget från ${ao.id}`,
      { workOrderId: aoId, customerId: ao.customerId });
    this._syncAO(ao, { materials: ao.materials, updatedAt: ao.updatedAt });
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
    this._syncAO(ao, { notes: ao.notes, updatedAt: ao.updatedAt });
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

  /* Ordrar redo för fakturering — kräver faktiskt fakturerbart innehåll */
  readyForInvoice() {
    let _res = null; // L1: one candidate pass for the whole list, created lazily
    return (state.workOrders || []).filter(a =>
      a.status === 'klar' && !a.invoiceId && this.getBillingStatus(a, (_res = _res || this.billingStatusResolver())).eligible
    );
  },

  /* AO-PRICING-RECOVERY R2 — Blocker 1: DELEGERAR HELT till
     BillingQueueService.getPricingStatusForAO(), som i sin tur bygger
     på EXAKT samma getUnclaimedSourcesForAO()-lista som
     InvoiceService.createFromAO() själv kräver att ALLA poster i är
     `selectable` för. R1:s egen omimplementation (`entries.some(t =>
     t.billable && t.hourRate>0)`) kollade bara OM NÅGON post var
     giltig — en AO med EN giltig historisk tidpost + två trasiga
     visade då "Redo fakturering" fast `InvoiceService` fortfarande
     vägrade (kräver ALLA, inte NÅGON). Genom att aldrig omimplementera
     samma regel på två ställen kan de per konstruktion inte glida isär
     igen. Returnerar { hasContent, eligible, pricingBlocked,
     otherBlocked, issues } — se BillingQueueService.js för definitionen. */
  getBillingStatus(ao, resolver) {
    if (!ao || typeof BillingQueueService === 'undefined') {
      return { hasContent: false, eligible: false, pricingBlocked: false, otherBlocked: false, issues: [] };
    }
    if (typeof resolver === 'function') return resolver(ao.id); // L1: batch path
    return BillingQueueService.getPricingStatusForAO(ao.id);
  },

  /* L1 (2026-11-12): a per-pass resolver for list views — computes the
     billing candidates once for ALL work orders, then answers per AO. */
  billingStatusResolver() {
    if (typeof BillingQueueService === 'undefined' || typeof BillingQueueService.getPricingStatusResolver !== 'function') return null;
    return BillingQueueService.getPricingStatusResolver();
  },

  /* Bakåtkompatibel tunn wrapper — bara `eligible`, för ev. befintliga
     anropare som förväntar sig ett booleskt svar. Ingen egen
     villkorslogik kvar här längre. */
  _hasBillableContent(ao, resolver) {
    return this.getBillingStatus(ao, resolver).eligible;
  },

  /* ── Arkiv & Papperskorg ────────────── */

  /* Statusflaggor (arkiv/papperskorg) via ao-time-write. opts.onSettled(r)
     anropas med serverns slutliga svar (ok eller definitivt avslag). Vid
     definitivt avslag återställs de fält denna ändring skrev (om de inte
     ändrats igen sedan) — samma I4-regel som TimeService.update(): en AO
     ska aldrig fortsätta visa ett läge servern vägrat. */
  _applyFlagPatch(ao, patch, opts) {
    const before = {};
    Object.keys(patch).forEach(function (f) {
      before[f] = Object.prototype.hasOwnProperty.call(ao, f) ? ao[f] : undefined;
    });
    Object.assign(ao, patch);
    this._syncAO(ao, patch, {
      onSettled: function (r) {
        let rolledBack = false;
        if (!r.ok && r.final) {
          Object.keys(patch).forEach(function (f) {
            if (ao[f] !== patch[f]) return;
            if (before[f] === undefined) delete ao[f]; else ao[f] = before[f];
            rolledBack = true;
          });
          if (typeof Sidebar !== 'undefined') Sidebar.updateBadges();
        }
        if (opts && typeof opts.onSettled === 'function') {
          try { opts.onSettled(Object.assign({}, r, { ao: ao, rolledBack: rolledBack })); } catch (e) { console.error('[WorkOrderService] caller onSettled threw (_applyFlagPatch):', e); }
        }
      }
    });
  },

  archive(id, opts) {
    const ao = getAO(id);
    if (!ao) return;
    const by = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '';
    const now = new Date().toISOString();
    ActivityService.log('work_order_archived', `Arbetsorder ${ao.id} arkiverad`, { workOrderId: id, customerId: ao.customerId });
    this._applyFlagPatch(ao, { archived: true, archivedAt: now, archivedBy: by, updatedAt: now }, opts);
    persist();
    Sidebar.updateBadges();
  },

  restoreFromArchive(id, opts) {
    const ao = getAO(id);
    if (!ao) return;
    ActivityService.log('work_order_restored', `Arbetsorder ${ao.id} återställd från arkiv`, { workOrderId: id, customerId: ao.customerId });
    this._applyFlagPatch(ao, { archived: false, archivedAt: '', archivedBy: '', updatedAt: new Date().toISOString() }, opts);
    persist();
    Sidebar.updateBadges();
  },

  softDelete(id, opts) {
    const ao = getAO(id);
    if (!ao) return;
    const by  = state.currentUser ? `${state.currentUser.firstName} ${state.currentUser.lastName}`.trim() : '';
    const now = new Date();
    ActivityService.log('work_order_deleted', `Arbetsorder ${ao.id} borttagen (papperskorg)`, { workOrderId: id, customerId: ao.customerId });
    this._applyFlagPatch(ao, {
      deleted: true, deletedAt: now.toISOString(), deletedBy: by,
      deleteAfter: new Date(now.getTime() + 14 * 86400000).toISOString(), updatedAt: now.toISOString()
    }, opts);
    persist();
    Sidebar.updateBadges();
  },

  restoreFromTrash(id, opts) {
    const ao = getAO(id);
    if (!ao) return;
    ActivityService.log('work_order_restored', `Arbetsorder ${ao.id} återställd från papperskorg`, { workOrderId: id, customerId: ao.customerId });
    this._applyFlagPatch(ao, { deleted: false, deletedAt: '', deletedBy: '', deleteAfter: '', updatedAt: new Date().toISOString() }, opts);
    persist();
    Sidebar.updateBadges();
  },

  /* P0 AO/TID-FIX: äkta array-borttagning via work_order_permanent_delete
     (atomisk, idempotent). Lokal borttagning sker direkt; vid definitivt
     avslag (t.ex. ändrad behörighet) läggs AO:n tillbaka på samma plats —
     den finns kvar på servern. opts.onSettled som _applyFlagPatch(). */
  permanentDelete(id, opts) {
    const idx = state.workOrders.findIndex(a => a.id === id);
    if (idx === -1) return;
    const ao = state.workOrders[idx];
    ActivityService.log('work_order_permanent_delete', `Arbetsorder ${id} raderad permanent`, { workOrderId: id, customerId: ao ? ao.customerId : '' });
    state.workOrders.splice(idx, 1);
    const notify = function (r) {
      if (opts && typeof opts.onSettled === 'function') {
        try { opts.onSettled(r); } catch (e) { console.error('[WorkOrderService] caller onSettled threw (permanentDelete):', e); }
      }
    };
    if (typeof AOTimeSyncService !== 'undefined') {
      AOTimeSyncService.deleteAOPermanent(id, {
        onSettled: function (r) {
          let rolledBack = false;
          if (!r.ok && r.final) {
            console.error('[WorkOrderService] Permanent radering avvisad av servern för', id, ':', r.error);
            if (!state.workOrders.some(a => a.id === id)) {
              state.workOrders.splice(Math.min(idx, state.workOrders.length), 0, ao);
              rolledBack = true;
              if (typeof Sidebar !== 'undefined') Sidebar.updateBadges();
            }
          }
          notify(Object.assign({}, r, { ao: ao, rolledBack: rolledBack }));
        }
      });
    } else {
      notify({ ok: false, final: true, error: 'sync_unavailable', ao: ao, rolledBack: false });
    }
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
    this._syncAO(ao, { staff: ao.staff, responsibleStaffId: ao.responsibleStaffId, status: ao.status, log: ao.log, updatedAt: ao.updatedAt });
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
    this._syncAO(ao, { staff: ao.staff, status: ao.status, log: ao.log, updatedAt: ao.updatedAt });
    persist();
    Sidebar.updateBadges();
    return ao;
  }
};
