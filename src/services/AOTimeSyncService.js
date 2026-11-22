/**
 * AOTimeSyncService — durable outbox for AO/time writes (P0 fix)
 *
 * Replaces the generic "mutate local array + persist() whole blob" path
 * for AO (vift_workOrders) and time-entry (vift_timeEntries) MUTATING
 * operations with calls to the new `ao-time-write` Edge Function, which
 * forwards to the atomic, row-locked RPCs in
 * supabase/migrations/20261017000001_ao_time_atomic_rpc.sql.
 *
 * Design (mirrors the P0 mandate §E/§F/§G):
 *   - Every mutation gets a client-generated idempotencyKey (UUID). A
 *     retried call with the SAME key is a no-op on the server beyond the
 *     first time — safe to retry blindly after ANY network uncertainty
 *     (timeout, disconnect, tab killed mid-request), including the
 *     "server received and committed it, but the client never saw the
 *     response" case.
 *   - A durable outbox (localStorage key `vift_outbox`, survives reload/
 *     crash/offline) holds not-yet-ACKed operations. `flush()` drains it
 *     with retry + exponential backoff, oldest first, one at a time per
 *     target (AO/time) to preserve server-visible ordering.
 *   - ACK-before-shown-as-saved: `enqueue()` returns a Promise that
 *     resolves ONLY once the server has actually acknowledged the write
 *     (HTTP 200 from ao-time-write) — never on local enqueue alone. The
 *     optional `onPending`/`onSettled` hooks let a page show a visible
 *     "Sparar..."/"Väntar på synk"/"Sparat" indicator without having to
 *     poll the outbox itself. Items still in the outbox after a reload
 *     are re-flushed automatically by `resumePending()` (called from
 *     initState()), so a crashed tab's unsynced work is never silently
 *     dropped — it is retried, not re-created (idempotencyKey survives
 *     the reload because it is stored IN the outbox entry, not
 *     regenerated).
 *   - `isUnsynced(id)` lets read paths (billing/invoicing/reports/
 *     payroll) check whether a given AO/time-entry id still has a
 *     pending outbox entry, so nothing not yet confirmed by the server
 *     is treated as final/invoiceable (§"no pending data becomes
 *     invoiceable as confirmed" in the test mandate).
 *
 * Fails closed toward the OLD behavior only in one sense: if the backend
 * (ao-time-write Edge Function) is not yet deployed to a given
 * environment, `isAvailable()` returns false and callers are expected to
 * fall back to the pre-existing create()/persist() path unchanged — this
 * lets the new path be merged and enabled per-environment without a
 * flag day, and never breaks an environment that has not yet run the
 * new migration/deployed the new function.
 */
const AOTimeSyncService = {
  _OUTBOX_KEY: 'vift_outbox',
  _FN_NAME:    'ao-time-write',
  _flushing:   false,
  _available:  null, /* null = unknown yet, probed lazily */

  /* ── Outbox persistence (localStorage, survives reload/crash) ────── */
  _readOutbox() {
    try {
      const raw = localStorage.getItem(this._OUTBOX_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  },
  _writeOutbox(arr) {
    try { localStorage.setItem(this._OUTBOX_KEY, JSON.stringify(arr)); } catch (e) {}
  },

  /* ── UUID (idempotency key) — crypto.randomUUID with a safe fallback ── */
  _uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  },

  /* ── Is a given AO/time-entry id currently unconfirmed (still in the
       outbox, not yet ACKed by the server)? Read paths (invoicing,
       payroll, reports, calendar) MUST treat such an id as "not yet
       final" and exclude it from anything irreversible (e.g. adding it
       to an invoice underlag) until it is gone from the outbox. ────── */
  isUnsynced(entityType, localRefId) {
    return this._readOutbox().some(function(it) {
      return it.entityType === entityType && it.localRefId === localRefId;
    });
  },
  listUnsynced(entityType) {
    return this._readOutbox()
      .filter(function(it) { return !entityType || it.entityType === entityType; })
      .map(function(it) { return it.localRefId; });
  },

  /* P0-1 FIX (2026-10-18, independent-reviewer regression): a pending
     'create_ao'/'create_time' outbox entry carries the FULL object the
     user created (`entry.payload.ao`/`entry.payload.entry`) — this is
     the only place that object still exists after a page reload (it is
     never written to the generic `state.js` persist()-bundle, by
     design; see AOTimeSyncService's own file header). Used by
     state.js's initState()/DataSync._poll() to reconstruct an
     optimistic entry that a fresh server snapshot does not (yet)
     contain, so it is never silently dropped from the UI just because
     the server hasn't ACKed it yet. Returns `null` if this id has no
     pending CREATE outbox entry (e.g. it's a PATCH/DELETE on an
     already-existing, already-server-known record — those are never at
     risk of "disappearing", only of NOT YET showing their latest patch,
     which is a different, already-accepted last-write-wins tradeoff). */
  getPendingCreateObject(entityType, localRefId) {
    const entry = this._readOutbox().find(function(it) {
      return it.entityType === entityType && it.localRefId === localRefId &&
             it.payload && (it.payload.action === 'create_ao' || it.payload.action === 'create_time');
    });
    if (!entry) return null;
    return entry.payload.ao || entry.payload.entry || null;
  },

  /* BLOCKER-1 FIX (independent-reviewer regression, round 3): a pending
     EDIT (patch_ao/patch_time) to an ALREADY-server-known record has the
     SAME "silently looks reverted on a poll" problem as a pending
     CREATE — reconcilePendingAoTime() (state.js) used to take an early
     return the moment the id already existed in the canonical snapshot,
     never checking whether a pending PATCH for that same id was still
     sitting unflushed in the outbox. Reproduced: a locally-edited AO
     title, patch still unACKed, server snapshot still shows the OLD
     title — the poll visually reverted the user's edit (the patch
     itself was never lost server-side/in the outbox; this was a UI
     trust violation, not a data-loss bug, but a real one).
     Returns the MERGED fields of every still-pending patch_ao/patch_time
     entry for this id, oldest first (so a later queued patch's fields
     correctly override an earlier one's for the same field) — used to
     reconstruct the "as the user last saw it" object on top of a
     canonical record when the in-memory object itself is not available
     (e.g. a fresh reload) in state.js's reconcilePendingAoTime(). */
  getPendingPatchFields(entityType, localRefId) {
    const entries = this._readOutbox().filter(function(it) {
      return it.entityType === entityType && it.localRefId === localRefId &&
             it.payload && (it.payload.action === 'patch_ao' || it.payload.action === 'patch_time');
    });
    if (!entries.length) return null;
    let merged = {};
    entries.forEach(function(e) { merged = Object.assign(merged, e.payload.patch || {}); });
    return merged;
  },

  /* Any kind of pending outbox entry (create OR patch) for this id —
     used by reconcilePendingAoTime() to decide whether to prefer the
     in-memory/reconstructed object over a canonical snapshot record at
     all, regardless of which specific action is queued. */
  hasPendingEntry(entityType, localRefId) {
    return this._readOutbox().some(function(it) {
      return it.entityType === entityType && it.localRefId === localRefId;
    });
  },

  /* ── Low-level: call the Edge Function (reuses Storage._authFetch's
       JWT-refresh behavior for consistency with every other Supabase
       call in this codebase). Returns {ok:true, data} or {ok:false, error, httpStatus}. */
  async _call(payload) {
    if (typeof Storage === 'undefined' || !Storage._authFetch) {
      return { ok: false, error: 'storage_unavailable' };
    }
    const base = (typeof Storage._functionsBase === 'function') ? Storage._functionsBase() : null;
    if (!base) return { ok: false, error: 'no_functions_base' };
    try {
      /* STAGING-GRANSKNING 2026-11-11: egen inledande "/" — _functionsBase()
         har INGEN avslutande "/" (samma 404-klass bugg som work-orders-list/
         time-entries-list, se storage.js för full motivering). Denna anrops-
         plats var INTE nämnd i det ursprungliga felrapporten men drabbades
         av exakt samma rotorsak — ao-time-write (AO-/tid-/attestskrivningar)
         fick alltså också 404 innan denna rättelse. */
      const res = await Storage._authFetch(base + '/' + this._FN_NAME, { body: JSON.stringify(payload) });
      let data = null;
      try { data = await res.json(); } catch (e) {}
      if (!res.ok) return { ok: false, error: (data && data.error) || ('http_' + res.status), httpStatus: res.status };
      return { ok: true, data: data || {} };
    } catch (e) {
      return { ok: false, error: e.isAuthExpired ? 'auth_expired' : ('network: ' + (e.message || e)) };
    }
  },

  /* Probe once per session whether the backend is deployed in this
     environment — lets callers fall back gracefully to the legacy path
     where the migration/function is not yet live (e.g. an environment
     mid-rollout). Cached after first successful OR definitively-failed
     probe; a transient network error does NOT cache `false` permanently. */
  async isAvailable() {
    if (this._available === true) return true;
    const r = await this._call({ action: '__probe__', idempotencyKey: this._uuid() });
    // unknown_action (400) means the function IS deployed and responded
    // correctly to an intentionally-invalid action — that's a definite
    // "yes, available". Any network/storage failure is inconclusive.
    if (r.error === 'unknown_action' || r.httpStatus === 400) { this._available = true; return true; }
    if (r.httpStatus === 403 || r.httpStatus === 401) { this._available = true; return true; } /* reachable, just unauthorized for this probe shape */
    if (r.error === 'storage_unavailable' || r.error === 'no_functions_base') { this._available = false; return false; }
    return false; /* inconclusive (e.g. 404 = function not deployed here) — treat as unavailable for THIS call, re-probe next time */
  },

  /* ── enqueue(): the public entry point. Adds to the durable outbox
       (survives reload), then attempts an immediate send. Resolves only
       once the server ACKs (or the caller gives up after maxAttempts on
       a DEFINITE rejection, e.g. forbidden/not_found — NOT on transient
       network errors, which stay queued and are retried). ───────────── */
  /* R3-A FIX (independent-reviewer finding, round 4): `onSettled` used
     to fire exactly once, synchronously after the FIRST `_sendOne()`
     attempt inside `enqueue()` — if that first attempt came back
     TRANSIENT (network/5xx/timeout), the entry correctly stayed queued
     for `resumePending()`/`retryOne()` to retry later, but the ORIGINAL
     caller's `onSettled` callback was never invoked again, so a caller
     that only commits a permanent cross-reference inside `onSettled`
     (the ACK-then-commit pattern this round introduces for AO creation)
     would simply hang forever on a "timeout, then the automatic retry
     actually succeeds" sequence, instead of eventually being told. Fix:
     `onSettled` is now registered in an in-memory map keyed by the
     idempotency key, and `_sendOne()` itself (wherever it is called
     from — the initial `enqueue()` attempt, a later `resumePending()`
     sweep, or an explicit `retryOne()`) fires and clears the
     registration once the result is truly final (`ok:true` or
     `final:true`) — never on a transient result, which leaves the
     registration in place for the next retry to find. Deliberately
     IN-MEMORY, not persisted: a page reload loses the callback the same
     way it already loses any other in-flight JS closure (the AO/time
     data itself is never lost — that is what the durable outbox is
     for); `resumePending()` on the next load still completes the write
     server-side, just without re-notifying a caller that no longer
     exists in that tab. */
  _settleCallbacks: {},
  _fireSettled(idempotencyKey, result) {
    const cb = this._settleCallbacks[idempotencyKey];
    if (cb) {
      delete this._settleCallbacks[idempotencyKey];
      try { cb(result); } catch (e) { console.error('[AOTimeSyncService] onSettled callback threw:', e); }
    }
  },

  /* ═══════════════════════════════════════════════════════════════════
     B1 FIX (independent-reviewer finding, round 5): `_settleCallbacks`
     above is in-memory ONLY — fine for `WorkOrderService`'s own internal
     bookkeeping (clearing `ao._pendingSync`, etc.), which has nothing
     left to do after a reload anyway since the in-memory `ao` object is
     itself gone. It is NOT fine for the round-4 "ACK-then-commit"
     callers (offer->AO conversion, recurring-order next-AO, rondering
     deviation->AO) — their commit is a PERMANENT, durable mutation
     (off.workOrderId, ro.nextDate, avv.workOrderId) that must happen
     EXACTLY ONCE, even if the tab is closed/crashes between the server
     ACK and the commit running. Reproduced by the round-4 reviewer with
     a separate Node VM context sharing localStorage (a real reload
     simulation): the outbox entry and the retry both survive and
     succeed server-side, but the in-memory callback registry does not,
     so NOTHING ever commits the cross-reference — and a second click
     (the guard was also in-memory, `off._aoConversionPending`) could
     then create a SECOND AO.

     Fix: a SEPARATE, DURABLE mechanism — `onSettledIntent` — stores a
     plain, JSON-serializable descriptor (`{kind, data}`) in localStorage
     the moment `enqueue()` is called, not a function reference. Each
     `kind` has a HANDLER FUNCTION registered via `registerIntentHandler()`
     by the module that knows how to apply it (`PageShells.js`,
     `RecurringOrderService.js`, `RonderingService.js` — registered at
     their own file-load time, which per index.html's script order
     always happens before `initState()` ever runs `reconcileSettledIntents()`).
     The intent record tracks `settled`/`settleResult`/`applied`
     independently of any in-memory state, survives a reload because it
     lives in localStorage, and is idempotent by construction: applying
     an already-`applied` intent is a guaranteed no-op, so calling
     `reconcileSettledIntents()` on every load (and after every real
     settle in the SAME session) is always safe, however many times it
     runs. `hasPendingIntent(kind, refId)` lets a caller's "don't double-
     submit" guard survive a reload too (checking durable state, not an
     in-memory flag). */
  _INTENT_KEY: 'vift_settleIntents',
  _intentHandlers: {},

  /* Registered by the module that knows how to APPLY one specific kind
     of settled intent (e.g. 'offer_ao_conversion' by PageShells.js).
     `fn(intentData, settleResult)` — `settleResult` is `{ok, final,
     error}` (never the raw outbox entry/ao object, since those may not
     exist in THIS session — the handler must look everything up fresh
     via `intentData`'s ids, exactly like a reload would require). Safe
     to call multiple times for the same kind (last registration wins) —
     harmless in practice since each module registers its own kind
     exactly once, at load time. */
  registerIntentHandler(kind, fn) {
    this._intentHandlers[kind] = fn;
  },

  _readIntents() {
    try {
      const raw = localStorage.getItem(this._INTENT_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  },
  _writeIntents(arr) {
    try { localStorage.setItem(this._INTENT_KEY, JSON.stringify(arr)); } catch (e) {}
  },

  /* Any kind+refId with a NOT-YET-APPLIED intent record — covers BOTH
     "still waiting for the server" (not settled yet) AND "server
     confirmed, but the commit hasn't run yet" (settled, not applied).
     Both are real "already in flight, don't start a second one"
     states — this is what survives a reload for the per-caller
     double-submit guards (replacing an in-memory-only flag). */
  hasPendingIntent(kind, refId) {
    return this._readIntents().some(function(it) {
      return it.intent && it.intent.kind === kind && it.intent.refId === refId && !it.applied;
    });
  },

  _recordIntent(idempotencyKey, intent) {
    const arr = this._readIntents();
    if (arr.some(function(it) { return it.idemKey === idempotencyKey; })) return; // already recorded (e.g. a resend with the same key)
    arr.push({ idemKey: idempotencyKey, intent, settled: false, settleResult: null, applied: false, createdAt: new Date().toISOString() });
    this._writeIntents(arr);
  },

  /* Called from _sendOne() the instant a result becomes final (ok:true
     or final:true — never on a transient result), REGARDLESS of
     whether anything is listening in this session right now. Durably
     marks the intent settled, then immediately tries to apply it (the
     same-session fast path) — if no handler is registered yet (e.g.
     this fires before that module's script has finished loading, an
     edge case `reconcileSettledIntents()` at initState()-time covers
     for the normal case), it simply stays `settled:true, applied:false`
     until the next reconcile pass (every load, and this same function
     on every future settle) picks it up. */
  _markIntentSettled(idempotencyKey, settleResult) {
    const arr = this._readIntents();
    const item = arr.find(function(it) { return it.idemKey === idempotencyKey; });
    if (!item) return; // no intent was recorded for this entry -- nothing to do (the common case)
    item.settled = true;
    item.settleResult = { ok: settleResult.ok, final: !!settleResult.final, error: settleResult.error || null };
    this._writeIntents(arr);
    this._tryApplyIntent(item);
  },

  /* Idempotent by construction: `applied` is only ever set to true
     AFTER the handler has run AND explicitly reported `{ok:true}` —
     a second call for an already-`applied` item is a guaranteed no-op
     (first `if` below).

     B1 FOLLOW-UP FIX (independent-reviewer finding, round 6): this
     used to mark `applied=true` as soon as the handler's returned
     promise RESOLVED, with no check of what it resolved TO — "didn't
     throw" was treated as "succeeded". The reviewer's real, runnable
     repro (two vm sandboxes sharing localStorage, `persist()` stubbed
     to always resolve `false`) proved this durably pruned the intent
     even though the handler's own underlying write had failed: the
     handler called `persist()` without awaiting/checking it, resolved
     normally regardless, and the durable record was deleted with
     nothing left to retry from on the next "reload".

     Fix: every registered handler (see PageShells.js/
     RecurringOrderService.js/RonderingService.js) now has an explicit
     success/failure CONTRACT — it must resolve to `{ok:true}` to be
     treated as succeeded; `{ok:false, ...}`, a thrown/rejected error,
     or anything else (including a bare `undefined` — a handler that
     forgets to return is a BUG, not a success) is treated as a
     failure and leaves the intent in place (`settled:true,
     applied:false`) for the next reconcile pass to retry. */
  _tryApplyIntent(item) {
    if (!item || item.applied || !item.settled) return;
    const handler = this._intentHandlers[item.intent.kind];
    if (!handler) return; // not registered (yet) in this session -- next reconcile pass retries
    const self = this;
    try {
      /* Handlers may be `async` (e.g. RonderingService's, which awaits
         a point-link RPC before its own persist()/log). `applied` must
         only ever be set AFTER the handler's work has actually
         finished AND confirmed succeeded — marking it synchronously,
         right after calling an async handler (which returns a pending
         Promise immediately, long before its real work completes),
         would durably record "done" before the mutation it describes
         has actually happened/succeeded, reopening the exact kind of
         gap this whole mechanism exists to close. */
      const maybePromise = handler(item.intent, item.settleResult);
      Promise.resolve(maybePromise).then(function (result) {
        if (result && result.ok === true) {
          item.applied = true;
          self._persistIntentUpdate(item);
        } else {
          console.error('[AOTimeSyncService] intent handler for "' + item.intent.kind + '" reported failure (will retry on next reconcile):', result && result.error);
          // Deliberately NOT pruned/marked applied -- stays
          // `settled:true, applied:false` for the next reconcile pass
          // (or the next real settle of a related entry) to retry.
        }
      }).catch(function (e) {
        console.error('[AOTimeSyncService] intent handler for "' + item.intent.kind + '" threw/rejected (will retry on next reconcile):', e);
      });
    } catch (e) {
      console.error('[AOTimeSyncService] intent handler for "' + item.intent.kind + '" threw synchronously (will retry on next reconcile):', e);
    }
  },

  _persistIntentUpdate(item) {
    const arr = this._readIntents()
      .map(function(it) { return it.idemKey === item.idemKey ? item : it; })
      .filter(function(it) { return !it.applied; }); // prune once applied -- nothing left to reconcile for it, ever
    this._writeIntents(arr);
  },

  /* Call once on every app load (initState()), AFTER every page/service
     script has registered its handlers (see index.html's load order —
     `initState()` only ever runs from the bootstrap script at the very
     end). Re-tries applying every settled-but-not-yet-applied intent —
     this is the actual self-healing step for "ACK arrived, but the
     commit never ran before a crash/reload". Safe to call extra times;
     each item either applies exactly once or is already gone. */
  reconcileSettledIntents() {
    this._readIntents().forEach(this._tryApplyIntent.bind(this));
  },

  async enqueue(entityType, localRefId, payload, opts) {
    opts = opts || {};
    const idempotencyKey = payload.idempotencyKey || this._uuid();
    payload = Object.assign({}, payload, { idempotencyKey });
    const entry = {
      id: idempotencyKey,
      entityType, localRefId, payload,
      attempts: 0,
      createdAt: new Date().toISOString()
    };
    const box = this._readOutbox();
    box.push(entry);
    this._writeOutbox(box);
    if (opts.onPending) { try { opts.onPending(entry); } catch (e) {} }
    if (opts.onSettled) { this._settleCallbacks[idempotencyKey] = opts.onSettled; }
    if (opts.onSettledIntent) { this._recordIntent(idempotencyKey, opts.onSettledIntent); }

    /* QA FIX-ROUND 2026-11-12 (M3): was `await this._sendOne(entry)`
       directly — every enqueue() started its own fetch at once, so two
       rapid patches to the SAME AO were two concurrent requests with no
       ordering guarantee (live: 6 of 10 bursts ended with the server on
       an OLDER value while the UI showed the newest). Sends are now
       serialized per target (entityType + id) and always drain that
       target's outbox entries oldest-first; see _drainTarget(). */
    return this._sendInOrder(entry);
  },

  /* ── M3: per-target ordered sending ─────────────────────────────────
     One promise chain per target (`ao:<id>` / `time:<id>`). Every send for
     a target — a fresh enqueue(), resumePending()'s sweep, retryOne() —
     runs inside that chain and drains the target's outbox entries in
     insertion order. An entry is never sent while an OLDER entry for the
     same target is still unsent: if the older one gets a transient error
     the drain stops there, and the newer one stays queued (reported as
     transient, `blockedBy` the older id) — so a newer value can never be
     overtaken by an older one that is retried later. A definite
     rejection of an older entry removes it (unchanged behavior) and the
     drain continues. Different targets stay fully independent/parallel.
     No server change: the server already applies patches in arrival
     order; the client now guarantees that arrival order is issue order. */
  _targetChains: {},
  _targetKey(entityType, localRefId) { return entityType + ':' + localRefId; },
  _runSerialized(entityType, localRefId, fn) {
    const k = this._targetKey(entityType, localRefId);
    const prev = this._targetChains[k] || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(function () {});
    this._targetChains[k] = tail;
    const self = this;
    tail.then(function () { if (self._targetChains[k] === tail) delete self._targetChains[k]; });
    return run;
  },
  _sendInOrder(entry, opts) {
    const self = this;
    return this._runSerialized(entry.entityType, entry.localRefId, function () {
      return self._drainTarget(entry.entityType, entry.localRefId, entry.id, opts || {});
    });
  },
  /* Drains one target oldest-first until `uptoId` has been sent (or the
     drain had to stop at an older transient entry). `opts.automatic`:
     resumePending()'s sweep — an entry that exhausted its automatic
     attempts stops the drain instead of being sent (it waits for an
     explicit user action, as before; newer entries wait behind it). */
  async _drainTarget(entityType, localRefId, uptoId, opts) {
    const box = this._readOutbox().filter(function (it) {
      return it.entityType === entityType && it.localRefId === localRefId;
    });
    const uptoIdx = box.findIndex(function (it) { return it.id === uptoId; });
    if (uptoIdx === -1) return { ok: true, alreadyGone: true };
    for (let i = 0; i <= uptoIdx; i++) {
      const e = box[i];
      const still = this._readOutbox().find(function (it) { return it.id === e.id; });
      if (!still) continue; // already settled by an earlier drain
      if (opts.automatic && (still.attempts || 0) >= this._MAX_AUTO_RETRY_ATTEMPTS) {
        return { ok: false, error: 'blocked_by_exhausted_entry', entry: box[uptoIdx], final: false, blockedBy: e.id };
      }
      // Always send the CURRENT stored copy (fresh attempt counter).
      const r = await this._sendOne(still);
      if (e.id === uptoId) return r;
      if (!r.ok && !r.final) {
        return { ok: false, error: r.error, entry: box[uptoIdx], final: false, blockedBy: e.id };
      }
    }
    return { ok: false, error: 'not_sent', entry: box[uptoIdx], final: false };
  },

  /* Errors where a BLIND retry (same payload) can never succeed — the
     caller must change something first (pick a new id, refetch and
     recompute the patch, wait for an admin to un-attest, etc.). These are
     removed from the outbox immediately and surfaced as `final:true`.
     NOTE (2026-10-18): `stale_write`/`attested_locked`/`id_collision`
     moved here from the transient bucket during the full call-site
     migration — they are genuine business-rule rejections, not network
     hiccups, and retrying them unchanged would spin forever without ever
     succeeding, silently never explaining why to the user. */
  _DEFINITE_REJECTIONS: ['forbidden', 'not_found', 'invalid_json', 'missing_fields', 'unknown_action',
                         'attested_locked', 'id_collision', 'stale_write'],
  /* After this many failed attempts at a genuinely TRANSIENT error (network,
     5xx, auth), stop auto-retrying on every resumePending() sweep — avoids
     an unbounded retry storm against a backend that is simply not deployed
     yet in this environment (e.g. staging before the migration/EF landed).
     The entry stays in the outbox (nothing is lost, pendingCount() still
     reports it, isUnsynced() still protects read paths) and IS retried
     again on the next explicit user action for that same AO/entry (a fresh
     enqueue() for a related op does not touch this entry, but the next
     app launch's resumePending() intentionally gives still-fresh entries,
     i.e. attempts < cap, another chance — only truly stuck ones are
     skipped from the AUTOMATIC sweep). */
  _MAX_AUTO_RETRY_ATTEMPTS: 8,

  async _sendOne(entry) {
    entry.attempts = (entry.attempts || 0) + 1;
    const r = await this._call(entry.payload);
    if (r.ok) {
      this._removeFromOutbox(entry.id);
      const result = { ok: true, data: r.data, entry };
      this._fireSettled(entry.id, result);
      this._markIntentSettled(entry.id, result);
      return result;
    }
    if (this._DEFINITE_REJECTIONS.indexOf(r.error) !== -1) {
      // A definite, non-retriable rejection: remove from outbox (retrying
      // forever would never succeed) and surface the error to the caller
      // so the UI can show it — this is NOT "lost", it never left the
      // client as a confirmed write, so there is nothing to roll back
      // server-side, only the optimistic local UI state (caller's job).
      this._removeFromOutbox(entry.id);
      const result = { ok: false, error: r.error, entry, final: true };
      this._fireSettled(entry.id, result);
      this._markIntentSettled(entry.id, result);
      return result;
    }
    // Transient (network, 5xx, auth) — KEEP it queued; resumePending()/
    // flush() will retry later. Persist the incremented attempt counter
    // so backoff/telemetry survive reload.
    this._updateOutboxEntry(entry);
    return { ok: false, error: r.error, entry, final: false };
  },

  _removeFromOutbox(id) {
    const box = this._readOutbox().filter(function(it) { return it.id !== id; });
    this._writeOutbox(box);
  },
  _updateOutboxEntry(entry) {
    const box = this._readOutbox().map(function(it) { return it.id === entry.id ? entry : it; });
    this._writeOutbox(box);
  },

  /* ── resumePending(): call once at startup (initState()) to retry any
       outbox entries left over from a crashed/closed tab or a failed
       network attempt in a previous session. Sequential, oldest first,
       small delay between to avoid a thundering herd on reconnect. ──── */
  async resumePending() {
    if (this._flushing) return;
    this._flushing = true;
    try {
      const self = this;
      let box = this._readOutbox();
      for (let i = 0; i < box.length; i++) {
        const entry = box[i];
        if ((entry.attempts || 0) >= self._MAX_AUTO_RETRY_ATTEMPTS) continue; // see _MAX_AUTO_RETRY_ATTEMPTS
        // Re-fetch outbox each iteration in case a concurrent _sendOne
        // (e.g. triggered by a fresh user action) already resolved it.
        const stillThere = this._readOutbox().some(function(it) { return it.id === entry.id; });
        if (!stillThere) continue;
        // M3: through the per-target chain, oldest-first (see _drainTarget()).
        await this._sendInOrder(entry, { automatic: true });
        await new Promise(function(r) { setTimeout(r, 150); });
      }
    } finally {
      this._flushing = false;
    }
  },

  pendingCount() { return this._readOutbox().length; },
  /* Entries that have exhausted automatic retry (see _MAX_AUTO_RETRY_ATTEMPTS)
     — still unsynced/pending (isUnsynced() still protects reads), but
     resumePending() will not keep hammering them on its own. A page can
     show these as "Kunde inte synkas — försök igen" with a manual retry
     button wired to retryOne(). */
  pendingExhaustedEntries() {
    const cap = this._MAX_AUTO_RETRY_ATTEMPTS;
    return this._readOutbox().filter(function(it) { return (it.attempts || 0) >= cap; });
  },
  /* Manual retry for one specific outbox entry (e.g. a "Försök igen"
     button next to a stuck pending badge) — bypasses the attempts cap
     for this one explicit, user-initiated attempt. */
  async retryOne(idemKey) {
    const entry = this._readOutbox().find(function(it) { return it.id === idemKey; });
    if (!entry) return { ok: true, alreadyGone: true };
    // M3: an explicit retry still respects order (older entries for the
    // same target go first); explicit = not subject to the automatic cap.
    return this._sendInOrder(entry);
  },

  /* ── High-level convenience wrappers (one per RPC action) ─────────── */
  createAO(ao, opts) {
    return this.enqueue('ao', ao.id || ('pending-' + this._uuid()), { action: 'create_ao', ao: ao }, opts);
  },
  patchAO(aoId, patch, expectedUpdatedAt, opts) {
    return this.enqueue('ao', aoId, { action: 'patch_ao', aoId: aoId, patch: patch, expectedUpdatedAt: expectedUpdatedAt || null }, opts);
  },
  deleteAO(aoId, opts) {
    return this.enqueue('ao', aoId, { action: 'delete_ao', aoId: aoId }, opts);
  },
  deleteAOPermanent(aoId, opts) {
    return this.enqueue('ao', aoId, { action: 'permanent_delete_ao', aoId: aoId }, opts);
  },
  createTime(entry, opts) {
    return this.enqueue('time', entry.id || ('pending-' + this._uuid()), { action: 'create_time', entry: entry }, opts);
  },
  patchTime(entryId, patch, expectedUpdatedAt, opts) {
    return this.enqueue('time', entryId, { action: 'patch_time', entryId: entryId, patch: patch, expectedUpdatedAt: expectedUpdatedAt || null }, opts);
  },
  deleteTime(entryId, opts) {
    return this.enqueue('time', entryId, { action: 'delete_time', entryId: entryId }, opts);
  },

  /* SÄKERHETSBLOCKER-FIX (2026-10-28): PayrollPage.js:s attestering/
     av-attestering gick tidigare via en direkt `state.timeEntries`-
     mutation + den generiska `persist()` — en skrivväg som (a) redan
     var utesluten ur `persist()`s nyckel-bundel (se state.js) och (b)
     ändå skulle blockeras av `20261021000001_ao_time_rls_lockdown.sql`s
     RESTRICTIVE-policy, eftersom den går direkt mot `vift_timeEntries`
     som en vanlig autentiserad användare. Attestering fungerade därför
     i praktiken ALDRIG server-sidigt via den gamla koden — bara i
     minnet/UI:t. Detta är ett EGET, direkt anrop (inte via `enqueue()`s
     offline-outbox/retry-kö) — en löneansvarigs attestering ska
     misslyckas SYNLIGT och OMEDELBART om den inte går igenom, inte
     tyst köas för en senare, osynkroniserad återförsök. */
  async setAttested(entryId, attested) {
    return this._call({ action: 'attest_time', entryId: entryId, attested: !!attested, idempotencyKey: this._uuid() });
  },

  /* ── Bulk PATCH helper (WorkOrdersPage bulk actions, BillingQueueService
       material-id backfill, etc.) — fires one patchAO/patchTime per item,
       fresh random idempotency key per item (these are live, user-
       triggered bulk edits, not resumable import batches — see bulkSync()
       below for the deterministic-key variant used by the importer).
       Sequential, same rationale as bulkSync(). Returns a Promise that
       resolves once ALL items have been attempted — callers that need to
       fire-and-forget (most do, matching the existing single-persist()-
       after-the-loop pattern this replaces) simply don't await it. */
  async bulkPatch(entityType, items) {
    const results = { succeeded: [], failed: [] };
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const r = entityType === 'ao' ? await this.patchAO(it.id, it.patch) : await this.patchTime(it.id, it.patch);
      if (r.ok) results.succeeded.push(it.id); else results.failed.push({ id: it.id, error: r.error });
    }
    return results;
  },

  /* ── Bulk import helper (ImportWizardPage.js) ──────────────────────
     Sequential (not parallel) on purpose: preserves the SAME row-by-row
     ordering/semantics the generic importer already had, and avoids
     opening dozens of simultaneous connections against the row-locked
     RPCs (which would just serialize server-side anyway, see
     tests/02_concurrency_repro.sh Test C for proof that doing so is SAFE
     but not necessarily FASTER).

     Crash-safe/resumable: each row's idempotency key is derived
     DETERMINISTICALLY from the import log id + the row's own
     (already locally-assigned) id + whether it was a create or an
     update — NOT a fresh random UUID — so that re-running the SAME
     import batch (e.g. the user re-opens the wizard and clicks
     "Importera" again after a tab crash mid-import) can never
     double-create or double-apply a row that already landed on a
     previous partial run; the server-side op_idempotency table
     recognizes the repeated key and returns the original result again.

     `ops` is an array of {id, kind:'create'|'patch', obj|patch}. Returns
     {succeeded:[...ids], failed:[{id, error}]} — the caller
     (ImportWizardPage) decides how to report partial failures in the
     import log/UI. */
  async bulkSync(entityType, ops, importLogId) {
    const results = { succeeded: [], failed: [] };
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const idemKey = 'import-' + (importLogId || 'noid') + '-' + entityType + '-' + op.id + '-' + op.kind;
      const action = entityType === 'ao'
        ? (op.kind === 'create' ? 'create_ao' : 'patch_ao')
        : (op.kind === 'create' ? 'create_time' : 'patch_time');
      const payload = op.kind === 'create'
        ? (entityType === 'ao' ? { action, ao: Object.assign({}, op.obj, { id: op.id }), idempotencyKey: idemKey }
                                : { action, entry: Object.assign({}, op.obj, { id: op.id }), idempotencyKey: idemKey })
        : (entityType === 'ao' ? { action, aoId: op.id, patch: op.patch, expectedUpdatedAt: null, idempotencyKey: idemKey }
                                : { action, entryId: op.id, patch: op.patch, expectedUpdatedAt: null, idempotencyKey: idemKey });
      const r = await this.enqueue(entityType, op.id, payload);
      if (r.ok) results.succeeded.push(op.id); else results.failed.push({ id: op.id, error: r.error });
    }
    return results;
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = AOTimeSyncService;
