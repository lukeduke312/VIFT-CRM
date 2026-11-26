/**
 * state.js — Centralt applikations-state
 * Allt data och UI-state på ett ställe
 */

let state = {
  // Autentisering
  currentUser: null,

  // Data
  customers: [],
  workOrders: [],
  offers: [],
  invoices: [],
  staff: [],
  roles: [],
  properties: [],
  contracts: [],
  inspections: [],
  timeEntries: [],
  articles: [],
  priceGroups: [],
  priceProfiles: [],
  titles: [],
  recurringOrders: [],
  salesOpportunities: [],
  activityLog: [],
  settings: {},
  ronderingsmallar: [],
  ronderingar: [],
  avvikelser: [],
  activities: [],
  serviceTemplates: [],
  emailTemplates: [],
  notifications: [],
  propertyCategories: [],
  ronderingspass: [],
  propertyObjects: [],
  importLogs: [],
  propertyRoles: [],        // Leverans D: titelregister (förvaltare, skötare, etc.)
  propertyContacts: [],     // Leverans D: kopplingar person↔fastighet/objekt
  deviationCategories: [],  // Fas 4B: admin-register för avvikelsekategorier
  offerEvents: [],          // Leverans E: händelselogg per offert
  offerAttachments: [],     // Leverans E2b: bilagor per offert
  projects: [],             // V54A: Projekt-kärna (se ProjectService.js)
  projectDocuments: [],     // V54C1: Projekt-dokument (se ProjectDocumentService.js)

  // UI-state
  currentPage: 'dash',
  currentAO: null,
  currentOffer: null,
  currentInvoice: null,
  currentProperty: null,
  currentCustomer: null,

  // Filters
  aoFilter: 'alla',
  customerTypeFilter: 'alla',

  // Stämpling
  stampActive: false,
  stampTimestamp: null,
  stampAoId: null
};

/* STAGING-GRANSKNING 2026-11-06 (fynd 2) — generisk business-key-arkitektur,
   PORTAD från det redan byggda, testade P0_FINAL_2026-11-04-paketet (LIVE-
   spåret), anpassad till STAGING:s REDAN BEFINTLIGA _doPersist()-nyckellista
   nedan (27 nycklar — STAGING har SEDAN TIDIGARE, oberoende av detta P0-
   arbete, redan tagit bort workOrders/timeEntries/invoices/ronderingspass/
   offerAttachments/projectDocuments/offerEvents ur den generiska vägen, se
   AOTimeSyncService.js/kommentarerna i _doPersist() nedan — INGEN av dessa
   fem rörs eller läggs till här, de har redan sina egna, mogna, atomiska
   RPC-vägar i STAGING och ska förbli OBERÖRDA av detta arbete). Löser
   STAGING-granskningens fynd 2 (orelaterade register skickas vid varje
   sparning, inklusive en potentiellt inaktuell kopia av en ANNAN session
   redan ändrat register). */
const VIFT_BUSINESS_KEYS = [
  'customers','offers','staff','properties',
  'priceGroups','priceProfiles','salesOpps','activityLog','settings',
  'contracts','articles','titles','roles',
  'recurringOrders','ronderingsmallar','ronderingar','avvikelser',
  'activities','serviceTemplates','emailTemplates','propertyCategories',
  'propertyObjects','importLogs','propertyRoles',
  'propertyContacts','deviationCategories','inspections','projects'
];
function _vfBusinessStateKey(shortKey) {
  return shortKey === 'salesOpps' ? 'salesOpportunities' : shortKey;
}

/* PR #2 CONSOLIDATED FIX (2026-11-09, finding C) — these five registers
   (plus projectDocuments, same bug class, not separately named by the
   reviewer but identical cause) have their OWN, already-correct, dedicated
   write paths elsewhere (invoice-write EF, offer event/attachment logic,
   RonderingSyncService, project-document-upload EF) and are therefore
   deliberately NOT in VIFT_BUSINESS_KEYS above — but `initState()`/`_poll()`
   still need to READ their current value for the UI, and after this round's
   switch to the atomic `getAllWithHashes()` call (instead of the old,
   unguarded `Storage.getAll()`), a key that's in neither list simply never
   arrives at all. This is a READ-ONLY allowlist: adding a key here can
   never let the client write it through the generic business-key path
   (see store-key-write/index.ts's separate ALLOWED_KEYS, used for
   write/writeMerge — this array is never consulted there). None of these
   six keys carry the per-row ownership sensitivity workOrders/timeEntries
   have (confirmed: no dedicated read-service/RLS-lockdown exists for any
   of them in this repo, and they were already broadly readable via the
   old, now-replaced `Storage.getAll()` under `store_active_read`). */
const VIFT_READONLY_EXTRA_KEYS = [
  'invoices', 'offerEvents', 'offerAttachments', 'notifications',
  'ronderingspass', 'projectDocuments'
];
state._keyHash = {};
state._keySnapshot = {};
/* Per-nyckel konflikt-lås + bevarat lokalt utkast — identisk semantik och
   motivering som i P0_FINAL_2026-11-04/client_patch/patched_source/state.js
   (se där för den fullständiga, redan dokumenterade bakgrunden till VARFÖR
   en baslinje-omsynk ALDRIG får rensa låset av sig själv). */
state._keyConflict = {};
state._keyConflictDraft = {};
function resolveKeyConflict(shortKey, keepLocalDraft) {
  if (!state._keyConflict[shortKey]) return false;
  if (keepLocalDraft && Object.prototype.hasOwnProperty.call(state._keyConflictDraft, shortKey)) {
    state[_vfBusinessStateKey(shortKey)] = state._keyConflictDraft[shortKey];
  }
  delete state._keyConflictDraft[shortKey];
  delete state._keyConflict[shortKey];
  return true;
}

/* ISSUE #1 FIX (2026-11-08, blocker e) — per-ELEMENT conflict drafts for
   the array-shaped generic keys' merge-write path (see _doPersist()).
   Unlike resolveKeyConflict() above, a reverted element does NOT block
   the rest of the key from saving on later cycles — only this one
   element's own edit is held here until the user decides. */
state._keyElementConflictDraft = {};
function resolveElementConflict(shortKey, elementId, reapplyLocalDraft) {
  const draftsForKey = state._keyElementConflictDraft[shortKey];
  if (!draftsForKey || !Object.prototype.hasOwnProperty.call(draftsForKey, elementId)) return false;
  if (reapplyLocalDraft) {
    const stateKey = _vfBusinessStateKey(shortKey);
    const arr = (state[stateKey] || []).slice();
    const idx = arr.findIndex(function(el) { return el && String(el.id) === String(elementId); });
    const draft = draftsForKey[elementId];
    /* PR #2 RE-REVIEW FIX (2026-11-09, blocker A): the draft's real
       operation type decides what "keep my change" means. A DELETE
       conflict has no `.data` to resurrect — "keep mine" here means "I
       still want to delete this," so we remove it from the LIVE array
       (which, at this point, already holds the server's latest confirmed
       value for it — see _doPersist()'s merge of `current` above), never
       write a stale old value back on top of whatever another session has
       since written. The next _doPersist() cycle then diffs the now-
       missing element against the (equally server-confirmed) snapshot and
       sends a FRESH, version-checked removal with the CURRENT server
       value as `previous` — if someone changes it again before this retry
       lands, the usual conflict check catches that too, exactly like any
       other removal. An UPSERT conflict keeps the original behavior:
       re-apply the user's actual new value. */
    if (draft && draft.op === 'delete') {
      if (idx >= 0) arr.splice(idx, 1);
      // idx < 0: already absent (someone else deleted it too) — nothing to do.
    } else if (draft && draft.op === 'upsert') {
      /* QA FIX-ROUND 2026-11-12 (M2): "keep my change" re-applies ONLY the
         fields this session actually changed (draft.value vs draft.base,
         the element as this session last confirmed it) on top of the
         server's CURRENT element — never the whole stale local element.
         The old whole-element replace resubmitted every field the user
         never touched (e.g. a phone number another session had already
         saved), silently reverting that other session's confirmed write.
         A field changed by BOTH sessions takes this session's value (the
         user explicitly chose "keep mine"). Without a base (a brand-new
         element, or a draft recorded before this fix) or without a
         current server element, the draft value is used as-is (unchanged
         prior behavior). Always a fresh clone: the live array never
         shares an object with the stored draft. */
      const _cur = idx >= 0 ? arr[idx] : null;
      const _resolved = (_cur && draft.base && typeof draft.base === 'object')
        ? _vfApplyFieldDelta(_cur, draft.base, draft.value)
        : _vfDeepClone(draft.value);
      if (idx >= 0) arr[idx] = _resolved; else arr.push(_resolved);
    }
    /* The journal entry (M4) is deliberately KEPT here: the next
       _doPersist() cycle re-records it with the current `previous`. If
       the page is reloaded before that, replay sees the conflict again
       and asks again — the user's choice is never silently lost. */
    state[stateKey] = arr;
    // Leave snapshot untouched so the next _doPersist() cycle sees this as
    // a fresh, real change and re-attempts the write with the CURRENT
    // server value as `previous` — never replays the stale one blindly.
  }
  else {
    /* "Använd serverns version": the user discarded this edit — it must
       not be replayed from the durable journal after a reload (M4). */
    _vfJournalForget(shortKey, elementId);
  }
  delete draftsForKey[elementId];
  if (Object.keys(draftsForKey).length === 0) delete state._keyElementConflictDraft[shortKey];
  return true;
}

/* ── QA FIX-ROUND 2026-11-12 helpers (M2/M4) ─────────────────────────── */

/* Plain JSON deep clone — every value in the generic store keys is JSON
   (it round-trips through the server's JSONB column), so this is exact. */
function _vfDeepClone(v) {
  if (v === undefined) return undefined;
  return JSON.parse(JSON.stringify(v));
}

/* Key-order-independent JSON for equality checks against values that
   came back from Postgres JSONB (which re-orders object keys). Used only
   where a client-built value is compared with a server-returned one. */
function _vfStableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(function(x) { return x === undefined ? 'null' : _vfStableStringify(x); }).join(',') + ']';
  return '{' + Object.keys(v).filter(function(k) { return v[k] !== undefined; }).sort()
    .map(function(k) { return JSON.stringify(k) + ':' + _vfStableStringify(v[k]); }).join(',') + '}';
}

/* M2: result = clone(current) + every top-level field where `mine`
   differs from `base` (removed in `mine` => removed in result). */
function _vfApplyFieldDelta(current, base, mine) {
  const out = _vfDeepClone(current) || {};
  const m = mine || {}, b = base || {};
  const fields = {};
  Object.keys(m).forEach(function(k) { fields[k] = true; });
  Object.keys(b).forEach(function(k) { fields[k] = true; });
  /* N1 round (live finding, 2026-11-12): a form that normalizes an ABSENT
     field to "" (the offer wizard does: `summary: d.summary || ''`) is not
     a change the user made. Treating absent -> "" as a change made "keep
     mine" blank another session's saved value (live: OFF-018 summary).
     Absent, null and "" are therefore the same "empty" here; every real
     change (incl. clearing a non-empty field) is still applied. */
  const _empty = function(v) { return v === undefined || v === null || v === ''; };
  Object.keys(fields).forEach(function(k) {
    const inMine = Object.prototype.hasOwnProperty.call(m, k);
    const _mv = inMine ? m[k] : undefined, _bv = Object.prototype.hasOwnProperty.call(b, k) ? b[k] : undefined;
    if (_empty(_mv) && _empty(_bv)) return;
    if (_vfStableStringify(inMine ? m[k] : undefined) === _vfStableStringify(Object.prototype.hasOwnProperty.call(b, k) ? b[k] : undefined)) return;
    if (inMine) out[k] = _vfDeepClone(m[k]); else delete out[k];
  });
  return out;
}

/* ── M4: durable journal for the generic merge-write path ───────────────
   QA FIX-ROUND 2026-11-12. Unlike the AO/time path (AOTimeSyncService's
   outbox), a customer/offer/etc. edit that was still in flight when the
   page was reloaded or closed was simply gone: nothing outside the
   in-memory request remembered it. _doPersist() now writes each element
   operation it is ABOUT to send (id, op, new value, and the `previous`
   value the server is asked to check against) to localStorage BEFORE the
   network call, and removes it only once the server has applied it. On
   the next load, initState() replays what is left with the SAME
   three-way rule the server uses: server value == `previous` -> re-apply
   and send again; server value == new value -> it had landed, drop it;
   anything else -> another session changed it since, so it becomes a
   normal element conflict (dialog), never a blind overwrite.
   Bound to the logged-in user (a different account on the same browser
   never replays someone else's edits). `activityLog` is NOT journaled:
   it is an append-only audit trail, and while its stored duplicate id
   (backlog C1) keeps rejecting its writes, journaling it would replay an
   ever-growing backlog on every load. `settings` (object-shaped,
   whole-value path with its own key-level conflict lock) is not
   journaled either. Nothing here changes what is sent, when, or how the
   response is merged — it only records and clears. */
var _VF_JOURNAL_KEY = 'vift_persistJournal';
var _VF_JOURNAL_EXCLUDED = { activityLog: true, settings: true };
function _vfJournalUser() {
  try {
    if (typeof Auth !== 'undefined' && typeof Auth.ownerIdentity === 'function') {
      const id = Auth.ownerIdentity();
      return id ? id.email : '';
    }
    return (typeof Auth !== 'undefined' && Auth._session && Auth._session.user_email) || '';
  } catch (e) { return ''; }
}
/* T3-A: journalen nycklas med miljö (Supabase-projektets ref) + e-post. */
function _vfJournalEnv() {
  try { return (typeof Storage !== 'undefined' && Storage.envRef) ? Storage.envRef() : ''; } catch (e) { return ''; }
}
/* E2E RES-04 (2026-11-23): journalen lagras per inloggning. Tidigare låg
   den under EN nyckel och kastades när en annan användare loggade in på
   samma enhet — den första användarens obekräftade ändring försvann då
   tyst även för henne/honom. Nu ligger varje användares journal under en
   egen nyckel; den skickas aldrig i någon annans namn och finns kvar när
   ägaren loggar in igen (samma princip som AO/tid-utkorgen, TIME-05).
   En äldre gemensam journal flyttas till ägarens nyckel när ägaren läser. */
function _vfJournalStorageKey(user) {
  const u = user === undefined ? _vfJournalUser() : user;
  return u ? _VF_JOURNAL_KEY + '::' + _vfJournalEnv() + '::' + String(u).toLowerCase() : _VF_JOURNAL_KEY;
}
function _vfJournalRead() {
  const me = _vfJournalUser();
  try {
    let raw = localStorage.getItem(_vfJournalStorageKey(me));
    /* T3-A uppgradering: v3.4 lagrade journalen under
       'vift_persistJournal:<e-post>' (ägaren given av nyckeln; samma
       ursprung = samma miljö) → flyttas till den nya nyckeln. */
    if (!raw && me) {
      const v34Key = _VF_JOURNAL_KEY + ':' + String(me).toLowerCase();
      const v34 = localStorage.getItem(v34Key);
      if (v34) {
        raw = v34;
        localStorage.setItem(_vfJournalStorageKey(me), v34);
        localStorage.removeItem(v34Key);
      }
    }
    if (!raw && me) {
      const legacy = localStorage.getItem(_VF_JOURNAL_KEY);
      const lj = legacy ? JSON.parse(legacy) : null;
      if (lj && (!lj.user || String(lj.user).toLowerCase() === String(me).toLowerCase())) {
        raw = legacy;
        localStorage.setItem(_vfJournalStorageKey(me), legacy);
        localStorage.removeItem(_VF_JOURNAL_KEY);
      }
    }
    const j = raw ? JSON.parse(raw) : null;
    if (j && typeof j === 'object' && j.keys && typeof j.keys === 'object') return j;
  } catch (e) {}
  return { v: 1, user: me, env: _vfJournalEnv(), keys: {} };
}
function _vfJournalWrite(j) {
  try {
    const key = _vfJournalStorageKey(j.user || _vfJournalUser());
    const empty = !j.keys || Object.keys(j.keys).every(function(k) { return !j.keys[k] || Object.keys(j.keys[k]).length === 0; });
    if (empty) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(j));
  } catch (e) {}
}
function _vfJournalRecord(shortKey, upserts, removals) {
  if (_VF_JOURNAL_EXCLUDED[shortKey]) return;
  const j = _vfJournalRead();
  j.user = j.user || _vfJournalUser();
  const forKey = j.keys[shortKey] = j.keys[shortKey] || {};
  const at = new Date().toISOString();
  upserts.forEach(function(u) { forKey[u.id] = { op: 'upsert', data: u.data, previous: u.previous, at: at }; });
  removals.forEach(function(r) { forKey[r.id] = { op: 'delete', previous: r.previous, at: at }; });
  _vfJournalWrite(j);
}
function _vfJournalForget(shortKey, id) {
  if (_VF_JOURNAL_EXCLUDED[shortKey]) return;
  const j = _vfJournalRead();
  if (!j.keys[shortKey] || !Object.prototype.hasOwnProperty.call(j.keys[shortKey], id)) return;
  delete j.keys[shortKey][id];
  if (Object.keys(j.keys[shortKey]).length === 0) delete j.keys[shortKey];
  _vfJournalWrite(j);
}
function _vfJournalPendingCount() {
  const j = _vfJournalRead();
  let n = 0;
  Object.keys(j.keys).forEach(function(k) { n += Object.keys(j.keys[k] || {}).length; });
  return n;
}

/* ── N1 (blocker round 2026-11-12): what happens to a journaled edit
   after a save the CALLER reported as failed ─────────────────────────
   Bug: CustomersPage._doSave()/OffersPage._save() roll the visible form
   back and say "Kunde inte spara" when persist() fails, but the M4
   journal entry for that element stayed. The next page load replayed it
   (server value == `previous` -> resend) and saved an edit the user had
   been told never happened, without a word.

   The rule now, for a caller that rolls back (it calls
   settlePersistFailure() first and acts on the fate):
   (A) 'rejected'  a definite server answer that the write was NOT
       applied (HTTP 4xx other than a conflict; the store-key-write RPC
       is transactional, so a 4xx means nothing committed). The journal
       entry is forgotten at that moment; the caller rolls back.
   (B) uncertain   network error / timeout / 5xx / auth lost / 200
       without `current`: the write may or may not have committed. A
       targeted re-read of THIS key (Storage.readBusinessKeyWithHash, the
       existing read action of store-key-write — no new protocol, no
       write) is compared with what was sent:
         server == sent      -> (C) 'landed': adopted as saved, journal
                                forgotten, nothing resent, the caller
                                reports success.
         server == previous  -> 'not-landed': the entry is kept but
                                marked `held` (never auto-replayed again)
                                and a persistent banner offers
                                "Återuppta" (resend, conflict-checked) or
                                "Kasta" (forget). The caller rolls back.
         anything else       -> 'diverged': another session changed it
                                since. The server value is shown and the
                                edit goes through the normal element
                                conflict dialog (draft value + base) —
                                never a blind resend. The caller must NOT
                                roll back over the server value.
         re-read failed      -> 'unknown': held + banner, as not-landed;
                                "Återuppta" re-checks before sending.
   (D) "Kasta" in the banner and "Använd serverns version" in the
       conflict dialog (resolveElementConflict(..., false)) both forget
       the entry. Nothing a user explicitly discarded can come back.
   M4's original case is unchanged: an entry whose request was simply
   cut off by a reload (no failure ever shown) is still replayed
   automatically by initState(). Only entries a caller reported as
   failed are held. persist()/_doPersist() return values (M1/M2/C1
   contract) are unchanged; this only adds a record of WHY a key failed. */
var _vfLastPersistFailure = {};

function _vfClassifyWriteFailure(r) {
  if (!r) return 'uncertain';
  if (r.error === 'network_error' || r.error === 'auth_expired') return 'uncertain';
  if (typeof r.status === 'number') {
    return (r.status >= 500 || r.status === 408 || r.status === 429) ? 'uncertain' : 'rejected';
  }
  if (typeof r.error === 'string' && /^http_(5\d\d|408|429)$/.test(r.error)) return 'uncertain';
  return 'rejected';
}

function _vfJournalEntry(shortKey, id) {
  const j = _vfJournalRead();
  const forKey = j.keys[shortKey];
  return (forKey && Object.prototype.hasOwnProperty.call(forKey, String(id))) ? forKey[String(id)] : null;
}
function _vfJournalSetHeld(shortKey, id, held) {
  const j = _vfJournalRead();
  const forKey = j.keys[shortKey];
  if (!forKey || !forKey[String(id)]) return;
  if (held) forKey[String(id)].held = true; else delete forKey[String(id)].held;
  _vfJournalWrite(j);
}

/* Puts the server's element (or its absence) into BOTH the visible state
   and the diff baseline for one id, so the next persist() sees no change
   for it (nothing resent) and later writes carry the right `previous`. */
function _vfAdoptServerElement(shortKey, id, serverEl) {
  const stateKey = _vfBusinessStateKey(shortKey);
  const put = function(arr) {
    const out = Array.isArray(arr) ? arr.slice() : [];
    const i = out.findIndex(function(el) { return el && String(el.id) === String(id); });
    if (serverEl === undefined || serverEl === null) { if (i >= 0) out.splice(i, 1); }
    else if (i >= 0) out[i] = _vfDeepClone(serverEl);
    else out.push(_vfDeepClone(serverEl));
    return out;
  };
  if (Array.isArray(state[stateKey])) state[stateKey] = put(state[stateKey]);
  let snap = null;
  try { snap = JSON.parse(state._keySnapshot[shortKey] || 'null'); } catch (e) { snap = null; }
  if (Array.isArray(snap)) state._keySnapshot[shortKey] = JSON.stringify(put(snap));
  try { if (typeof Storage !== 'undefined' && Storage.setLocal) Storage.setLocal(shortKey, state[stateKey]); } catch (e) {}
}

/* Targeted, read-only check of one journaled element against the server
   (case B). Never writes. Returns {fate, element?}. */
async function _vfVerifyJournaledElement(shortKey, id) {
  const e = _vfJournalEntry(shortKey, id);
  if (!e) return { fate: 'none' };
  let r = null;
  try { r = await Storage.readBusinessKeyWithHash('vift_' + shortKey); } catch (err) { r = null; }
  if (!r || !r.ok || !Array.isArray(r.value)) {
    _vfJournalSetHeld(shortKey, id, true);
    _vfRefreshHeldBanner();
    return { fate: 'unknown' };
  }
  const cur = r.value.find(function(el) { return el && String(el.id) === String(id); });
  const curS = _vfStableStringify(cur === undefined ? null : cur);
  const landed = e.op === 'delete' ? cur === undefined : (cur !== undefined && curS === _vfStableStringify(e.data));
  if (landed) {
    _vfAdoptServerElement(shortKey, id, cur);
    _vfJournalForget(shortKey, id);
    _vfRefreshHeldBanner();
    return { fate: 'landed', element: cur };
  }
  if (curS === _vfStableStringify(e.previous === undefined ? null : e.previous)) {
    _vfJournalSetHeld(shortKey, id, true);
    _vfRefreshHeldBanner();
    return { fate: 'not-landed' };
  }
  /* Diverged: a third value. Show the server's, and hand the edit to the
     existing element-conflict mechanism (same draft shape as _doPersist()
     and the M4 replay). The entry stays journaled, not held: the
     conflict dialog now owns it (keep -> resent with the server value as
     `previous`; use server -> forgotten). */
  _vfAdoptServerElement(shortKey, id, cur);
  _vfJournalSetHeld(shortKey, id, false);
  state._keyElementConflictDraft[shortKey] = state._keyElementConflictDraft[shortKey] || {};
  state._keyElementConflictDraft[shortKey][String(id)] = e.op === 'delete'
    ? { op: 'delete' }
    : { op: 'upsert', value: _vfDeepClone(e.data), base: _vfDeepClone(e.previous) };
  _vfRefreshHeldBanner();
  if (typeof App !== 'undefined' && App.showPersistConflictWarning) {
    try { App.showPersistConflictWarning(shortKey, [String(id)]); } catch (e2) {}
  }
  return { fate: 'diverged', element: cur };
}

/* Called by a caller right after its own `await persist({keys:[k]})`
   returned false and BEFORE it rolls anything back. See the block
   comment above for the fates and what the caller must do with each. */
async function settlePersistFailure(shortKey, elementId) {
  const id = String(elementId);
  const drafts = state._keyElementConflictDraft[shortKey];
  if (drafts && Object.prototype.hasOwnProperty.call(drafts, id)) return { fate: 'conflict' };
  const f = _vfLastPersistFailure[shortKey];
  if (!f || !f.ids || !f.ids[id]) return { fate: 'none' };
  delete f.ids[id]; // settled once
  if (f.kind === 'rejected') {
    _vfJournalForget(shortKey, id); // (A)
    _vfRefreshHeldBanner();
    return { fate: 'rejected', error: f.error, reason: f.reason || null };
  }
  return _vfVerifyJournaledElement(shortKey, id); // (B) -> landed | not-landed | diverged | unknown
}

/* "Återuppta" in the banner. Re-checks the server first (three-way),
   then resends only if the server still has `previous`. */
async function resumeHeldPersist(shortKey, elementId) {
  const id = String(elementId);
  const e = _vfJournalEntry(shortKey, id);
  if (!e) { _vfRefreshHeldBanner(); return { fate: 'none' }; }
  let r = null;
  try { r = await Storage.readBusinessKeyWithHash('vift_' + shortKey); } catch (err) { r = null; }
  if (!r || !r.ok || !Array.isArray(r.value)) {
    if (typeof showToast === 'function') showToast('Ingen kontakt med servern just nu — ändringen ligger kvar osparad. Försök igen om en stund.', 6000);
    return { fate: 'unknown' };
  }
  const cur = r.value.find(function(el) { return el && String(el.id) === id; });
  const curS = _vfStableStringify(cur === undefined ? null : cur);
  const landed = e.op === 'delete' ? cur === undefined : (cur !== undefined && curS === _vfStableStringify(e.data));
  if (landed) {
    _vfAdoptServerElement(shortKey, id, cur);
    _vfJournalForget(shortKey, id);
    _vfRefreshHeldBanner();
    _vfRefreshCurrentView();
    if (typeof showToast === 'function') showToast('Ändringen var redan sparad på servern.');
    return { fate: 'landed' };
  }
  if (curS !== _vfStableStringify(e.previous === undefined ? null : e.previous)) {
    _vfJournalSetHeld(shortKey, id, true); // so _vfVerify... sees the same entry
    return _vfVerifyJournaledElement(shortKey, id); // -> diverged: conflict dialog
  }
  /* Server still has `previous`: baseline = server, state = my edit, send. */
  _vfAdoptServerElement(shortKey, id, cur);
  const stateKey = _vfBusinessStateKey(shortKey);
  const arr = (state[stateKey] || []).slice();
  const i = arr.findIndex(function(el) { return el && String(el.id) === id; });
  if (e.op === 'delete') { if (i >= 0) arr.splice(i, 1); }
  else if (i >= 0) arr[i] = _vfDeepClone(e.data); else arr.push(_vfDeepClone(e.data));
  state[stateKey] = arr;
  _vfJournalSetHeld(shortKey, id, false);
  const ok = await persist({ keys: [shortKey] });
  if (ok) {
    _vfRefreshHeldBanner();
    _vfRefreshCurrentView();
    if (typeof showToast === 'function') showToast('Ändringen är sparad.');
    return { fate: 'resumed' };
  }
  const s = await settlePersistFailure(shortKey, id);
  if (s.fate === 'rejected' || s.fate === 'not-landed' || s.fate === 'unknown' || s.fate === 'none') {
    _vfAdoptServerElement(shortKey, id, cur); // never leave an unconfirmed edit looking saved
  }
  _vfRefreshHeldBanner();
  _vfRefreshCurrentView();
  if (typeof showToast === 'function') {
    if (s.fate === 'landed') showToast('Ändringen är sparad.');
    else if (s.fate === 'rejected') showToast('Servern avvisade ändringen' + (s.error ? ' (' + s.error + ')' : '') + ' — den har INTE sparats.', 6000);
    else if (s.fate === 'not-landed' || s.fate === 'unknown') showToast('Ändringen kunde fortfarande inte sparas — den ligger kvar osparad.', 6000);
  }
  return s;
}

/* ── E2E 2026-11-23: commitElementChange() ─────────────────────────
   One place for the "visa framgång först efter serverns bekräftelse"
   rule for a single element of a generic business key. The browser
   suite reproduced several screens (serviceintervall, offertlänk,
   roller) that showed success while persist() was still running and
   kept showing it after the server refused. Usage:
     await commitElementChange('roles', roleId, () => { ...mutate...; },
       { ok: 'Roll uppdaterad', fail: 'Rollen kunde inte sparas',
         onChange: () => rerender(), onSaved: () => sideEffects() });
   mutate() returning false aborts without saving. On failure the N1
   rule decides (settlePersistFailure): landed -> success; diverged ->
   conflict dialog, no rollback; otherwise the element is restored to
   its pre-change value and `fail` is shown. Returns {ok, fate}.
   For a create whose id is assigned inside mutate(), pass `null` as
   elementId and return the new element (or its id) from mutate(). */
var _vfCommitBusy = {};
/* T3-C (SÄK-8, D-25): begripliga meddelanden för serverns avslag i personal- och
   rollregistret (BEHORIGHETSMATRIS §4). null = inget särskilt meddelande. */
function persistRefusalText(error, reason) {
  if (error === 'last_superadmin') return 'Ändringen nekades: det måste alltid finnas minst en aktiv superadministratör (behörigheten "Alla behörigheter"). Ge först någon annan aktiv användare den behörigheten.';
  if (error === 'forbidden' && reason === 'superadmin_required') return 'Ändringen nekades: bara en superadministratör får tilldela, ändra eller ta bort behörigheten "Alla behörigheter" eller roller och personer som har den.';
  if (error === 'forbidden' && reason === 'privilege_escalation') return 'Ändringen nekades: du kan inte ge dig själv eller någon annan behörigheter som du inte själv har, och inte ändra din egen roll.';
  /* T4-A (B5, D-13, D-17, D-01): skyddat fält (portkod, personnummer, bankgiro, inköpspris, intern timkostnad). */
  if (error === 'forbidden' && reason === 'field_protected') return 'Ändringen nekades: den rör ett skyddat fält (t.ex. portkod, personnummer, bankgiro eller inköpspris) som du inte har behörighet att ändra. Inget sparades.';
  return null;
}

async function commitElementChange(shortKey, elementId, mutate, msgs) {
  msgs = msgs || {};
  let id = elementId === null || elementId === undefined ? null : String(elementId);
  const busyKey = shortKey + '|' + (id === null ? '*new*' : id);
  if (_vfCommitBusy[busyKey]) return { ok: false, fate: 'busy' };
  const stateKey = _vfBusinessStateKey(shortKey);
  const find = function(a) { return (a || []).findIndex(function(el) { return el && String(el.id) === id; }); };
  const i0 = id === null ? -1 : find(state[stateKey]);
  const before = i0 >= 0 ? _vfDeepClone(state[stateKey][i0]) : undefined;
  _vfCommitBusy[busyKey] = true;
  const say = function(m, ms) { if (m && typeof showToast === 'function') showToast(m, ms); };
  const changed = function() { if (typeof msgs.onChange === 'function') { try { msgs.onChange(); } catch (e) { console.warn('[commit] onChange:', e); } } };
  try {
    const m = mutate();
    if (m === false) return { ok: false, fate: 'aborted' };
    if (id === null) {
      id = m && typeof m === 'object' ? String(m.id) : (m !== undefined && m !== null ? String(m) : null);
      if (id === null) return { ok: false, fate: 'aborted' };
    }
    changed();
    say(msgs.saving || 'Sparar…');
    let fate = 'ok';
    const ok = await persist({ keys: [shortKey] });
    if (!ok) {
      const n1 = (typeof settlePersistFailure === 'function') ? await settlePersistFailure(shortKey, id) : { fate: 'none' };
      fate = n1.fate;
      if (fate === 'diverged' || fate === 'conflict') {
        changed();
        say('Ändringen krockade med en ändring från en annan session — välj i konfliktdialogen.', 6000);
        return { ok: false, fate: fate };
      }
      if (fate !== 'landed') {
        const a = (state[stateKey] || []).slice();
        const i = find(a);
        if (before === undefined) { if (i >= 0) a.splice(i, 1); }
        else if (i >= 0) a[i] = before; else a.push(before);
        state[stateKey] = a;
        try { if (typeof Storage !== 'undefined' && Storage.setLocal) Storage.setLocal(shortKey, a); } catch (e) {}
        changed();
        const _refusal = fate === 'rejected' ? persistRefusalText(n1.error, n1.reason) : null;
        say(_refusal || ((msgs.fail || 'Ändringen kunde inte sparas') + (fate === 'not-landed' || fate === 'unknown'
          ? ' — den ligger kvar som osparad; välj Återuppta eller Kasta i meddelandet överst.'
          : '. Servern avvisade ändringen — försök igen.')), 8000);
        return { ok: false, fate: fate, error: n1.error, reason: n1.reason };
      }
    }
    if (typeof msgs.onSaved === 'function') { try { msgs.onSaved(); } catch (e) { console.warn('[commit] onSaved:', e); } }
    changed();
    say(msgs.ok);
    return { ok: true, fate: fate };
  } finally {
    delete _vfCommitBusy[busyKey];
  }
}

/* ── G12 (2026-11-23): confirmPersist() ──────────────────────────────
   För sparvägar där ändringen REDAN är gjord i state (de ~40 äldre
   anropsställena som tidigare gjorde `persist(); showToast('Sparat')`).
   Ett anrop ersätter de två raderna:
     confirmPersist('customers', cu.id, { ok: 'Kontaktperson sparad',
       fail: 'Kontaktpersonen kunde inte sparas', onChange: () => rerender() });
   Visar "Sparar…", väntar på serverns svar för nyckeln och visar framgång
   först då. Vid avslag avgör settlePersistFailure() (N1) utfallet:
   landed → framgång; krock → konfliktdialogen; annars återställs posten
   till serverns senast bekräftade värde (diff-baslinjen) och felet visas.
   Utan element-id (objektformade nycklar som settings) visas bara felet —
   ändringen ligger kvar osparad och skickas med nästa sparning.
   Samma nyckel+id kan inte sparas parallellt (dubbelklick). */
var _vfConfirmBusy = {};
async function confirmPersist(shortKey, elementId, msgs) {
  msgs = msgs || {};
  const id = elementId === null || elementId === undefined ? null : String(elementId);
  const busyKey = shortKey + '|' + (id === null ? '*' : id);
  const say = function(m, ms) { if (m && typeof showToast === 'function') showToast(m, ms); };
  const changed = function() { if (typeof msgs.onChange === 'function') { try { msgs.onChange(); } catch (e) { console.warn('[confirmPersist] onChange:', e); } } };
  if (_vfConfirmBusy[busyKey]) return _vfConfirmBusy[busyKey];
  const run = (async function() {
    if (msgs.saving !== false) say(msgs.saving || 'Sparar…');
    const ok = await persist({ keys: [shortKey] });
    if (ok) {
      if (typeof msgs.onSaved === 'function') { try { msgs.onSaved(); } catch (e) { console.warn('[confirmPersist] onSaved:', e); } }
      say(msgs.ok);
      return { ok: true, fate: 'ok' };
    }
    const stateKey = _vfBusinessStateKey(shortKey);
    if (id === null || !Array.isArray(state[stateKey])) {
      say((msgs.fail || 'Ändringen kunde inte sparas') + ' — servern bekräftade inte ändringen. Försök igen.', 8000);
      return { ok: false, fate: 'unknown' };
    }
    const n1 = (typeof settlePersistFailure === 'function') ? await settlePersistFailure(shortKey, id) : { fate: 'none' };
    if (n1.fate === 'landed') {
      if (typeof msgs.onSaved === 'function') { try { msgs.onSaved(); } catch (e) {} }
      say(msgs.ok); return { ok: true, fate: 'landed' };
    }
    if (n1.fate === 'diverged' || n1.fate === 'conflict') {
      changed();
      say('Ändringen krockade med en ändring från en annan session — välj i konfliktdialogen.', 6000);
      return { ok: false, fate: n1.fate };
    }
    let base = null;
    try { base = JSON.parse(state._keySnapshot[shortKey] || 'null'); } catch (e) { base = null; }
    if (Array.isArray(base)) {
      const srv = base.find(function(el) { return el && String(el.id) === id; });
      _vfAdoptServerElement(shortKey, id, srv === undefined ? null : srv);
    }
    if (typeof Sidebar !== 'undefined' && Sidebar.updateBadges) { try { Sidebar.updateBadges(); } catch (e) {} }
    changed();
    const _refusal = n1.fate === 'rejected' ? persistRefusalText(n1.error, n1.reason) : null;
    say(_refusal || ((msgs.fail || 'Ändringen kunde inte sparas') + (n1.fate === 'not-landed' || n1.fate === 'unknown'
      ? ' — den ligger kvar som osparad; välj Återuppta eller Kasta i meddelandet överst.'
      : '. Servern avvisade ändringen — försök igen.')), 8000);
    return { ok: false, fate: n1.fate, error: n1.error, reason: n1.reason };
  })();
  _vfConfirmBusy[busyKey] = run;
  try { return await run; } finally { delete _vfConfirmBusy[busyKey]; }
}

/* Global skyddsnät för de äldre anropsställen som anropar persist()
   utan argument och visar framgång direkt (≈40 ställen, se docs/E2E).
   Misslyckas skrivningen för en ändrad nyckel (inte konflikt — den har
   egen dialog) visas en tydlig varning EFTER anroparens egna meddelanden
   (setTimeout 0), så ett tidigare "Sparat" inte står kvar som sista
   besked. Anropare som skickar {keys}/{detailed} hanterar felet själva
   och berörs inte. Max en varning per 5 s. */
var _VF_KEY_LABELS = { customers: 'kunder', offers: 'offerter', staff: 'personal', properties: 'fastigheter', priceGroups: 'prisgrupper',
  priceProfiles: 'prisprofiler', salesOpps: 'säljchanser', activityLog: 'aktivitetslogg', settings: 'inställningar', contracts: 'kontrakt',
  articles: 'artiklar', titles: 'titlar', roles: 'roller', recurringOrders: 'återkommande ärenden', ronderingsmallar: 'ronderingsmallar',
  ronderingar: 'ronderingar', avvikelser: 'avvikelser', activities: 'att göra', serviceTemplates: 'servicemallar', emailTemplates: 'e-postmallar',
  propertyCategories: 'fastighetskategorier', propertyObjects: 'objekt', importLogs: 'importloggar', propertyRoles: 'fastighetsroller',
  propertyContacts: 'kontaktpersoner', deviationCategories: 'avvikelsekategorier', inspections: 'besiktningar', projects: 'projekt' };
var _vfLastUnconfirmedWarnAt = 0;
function _vfWarnUnconfirmed(detail, opts) {
  if (opts && (opts.detailed || (Array.isArray(opts.keys) && opts.keys.length))) return;
  if (!detail || typeof detail !== 'object' || detail.ok) return;
  const r = detail.results || {};
  /* activityLog är historik, inte användarens data, och är redan undantagen
     från journalen. STAGING:s store-key-write v3
     kräver admin_manage för den — utan undantaget fick varje fältarbetare
     en varning efter varje åtgärd (E2E STG-01, 2026-11-23). */
  const bad = Object.keys(r).filter(function(k) { return k !== 'activityLog' && (r[k] === 'failed' || r[k] === 'unverified' || r[k] === 'blocked'); });
  if (!bad.length && !detail.degraded && !detail.error) return;
  if (Date.now() - _vfLastUnconfirmedWarnAt < 5000) return;
  _vfLastUnconfirmedWarnAt = Date.now();
  const what = bad.map(function(k) { return _VF_KEY_LABELS[k] || k; }).join(', ');
  const msg = detail.degraded
    ? 'Ändringen sparades INTE: senaste inläsningen från servern var ofullständig. Ladda om sidan och gör om ändringen.'
    : 'Varning: servern bekräftade inte den senaste ändringen' + (what ? ' (' + what + ')' : '') + '. Den kan vara osparad — kontrollera och försök igen.';
  setTimeout(function() {
    try {
      const t = typeof document !== 'undefined' && document.getElementById('toast');
      if (t && /kunde inte|INTE|misslyck|avvisade/i.test(t.textContent || '') && t.classList.contains('show')) return;
    } catch (e) {}
    if (typeof showToast === 'function') showToast(msg, 8000);
  }, 0);
}

/* "Kasta" in the banner (D). */
function discardHeldPersist(shortKey, elementId) {
  _vfJournalForget(shortKey, String(elementId));
  _vfRefreshHeldBanner();
  if (typeof showToast === 'function') showToast('Den osparade ändringen är kastad.');
  return true;
}

function _vfRefreshCurrentView() {
  try { if (typeof Router !== 'undefined' && Router.refreshCurrent) Router.refreshCurrent(); } catch (e) {}
}

var _VF_HELD_LABELS = { customers: 'Kund', offers: 'Offert', properties: 'Fastighet', propertyObjects: 'Objekt' };
function _vfHeldItems() {
  const j = _vfJournalRead();
  const items = [];
  Object.keys(j.keys || {}).forEach(function(k) {
    Object.keys(j.keys[k] || {}).forEach(function(id) {
      const e = j.keys[k][id];
      if (!e || !e.held) return;
      const d = e.data || e.previous || {};
      let num = id;
      try { if (typeof displayNumberOf === 'function') num = displayNumberOf(d && d.id ? d : { id: id }) || id; } catch (err) {}
      const name = (d && (d.title || d.name || d.label || ((d.firstName || '') + ' ' + (d.lastName || '')).trim())) || '';
      const kl = _VF_HELD_LABELS[k] || (_VF_KEY_LABELS[k] ? _VF_KEY_LABELS[k].charAt(0).toUpperCase() + _VF_KEY_LABELS[k].slice(1) : k);
      items.push({
        key: k, id: id, op: e.op, at: e.at || '', isCreate: e.op === 'upsert' && (e.previous === null || e.previous === undefined),
        label: kl + ' ' + num + (name ? ' — ' + name : '')
      });
    });
  });
  return items;
}
function _vfRefreshHeldBanner() {
  const items = _vfHeldItems();
  state._vfHeldUnsaved = items;
  try { if (typeof PersistRecoveryBanner !== 'undefined') PersistRecoveryBanner.render(items); } catch (e) {}
  return items;
}

/* Called once from initState() after a NON-degraded load (data and diff
   baselines are authoritative). Returns {reapplied, landed, conflicts}. */
function _vfReplayPersistJournal() {
  const res = { reapplied: 0, landed: 0, conflicts: {}, held: 0 };
  /* T3-A: spelas bara upp under ägarens egen, aktuella session. */
  if (typeof Auth !== 'undefined' && typeof Auth.identity === 'function' && !Auth.identity()) return res;
  const j = _vfJournalRead();
  const keys = Object.keys(j.keys || {});
  if (!keys.length) return res;
  const me = _vfJournalUser();
  if (j.env && j.env !== _vfJournalEnv()) {
    console.warn('[persist-journal] Osparade ändringar tillhör en annan miljö — spelas INTE upp här.');
    return res;
  }
  if (j.user && me && String(j.user).toLowerCase() !== String(me).toLowerCase()) {
    /* Kan bara hända med en äldre gemensam journal: lämna den orörd åt sin
       ägare (se _vfJournalRead), spela aldrig upp den i fel namn. */
    console.warn('[persist-journal] Osparade ändringar tillhör en annan inloggning — spelas INTE upp här.');
    return res;
  }
  keys.forEach(function(shortKey) {
    if (VIFT_BUSINESS_KEYS.indexOf(shortKey) === -1 || _VF_JOURNAL_EXCLUDED[shortKey]) { delete j.keys[shortKey]; return; }
    if (state._keyConflict[shortKey]) return; // key-level lock: leave for later, never touch
    const stateKey = _vfBusinessStateKey(shortKey);
    if (!Array.isArray(state[stateKey])) return;
    const arr = state[stateKey].slice();
    const entries = j.keys[shortKey] || {};
    Object.keys(entries).forEach(function(id) {
      const e = entries[id];
      const idx = arr.findIndex(function(el) { return el && String(el.id) === String(id); });
      const cur = idx >= 0 ? arr[idx] : undefined;
      const curS = _vfStableStringify(cur === undefined ? null : cur);
      const prevS = _vfStableStringify(e.previous === undefined ? null : e.previous);
      /* N1: an entry the user was told had FAILED (held) is never resent
         on its own. Landed -> dropped (C); still `previous` -> stays held
         and the banner asks again; diverged -> conflict dialog below. */
      if (e.held && curS === prevS && !(e.op === 'delete' && cur === undefined)) { res.held++; return; }
      if (e.op === 'upsert') {
        if (cur !== undefined && curS === _vfStableStringify(e.data)) { delete entries[id]; res.landed++; return; }
        if (curS === prevS) {
          if (idx >= 0) arr[idx] = _vfDeepClone(e.data); else arr.push(_vfDeepClone(e.data));
          res.reapplied++; return;
        }
        state._keyElementConflictDraft[shortKey] = state._keyElementConflictDraft[shortKey] || {};
        state._keyElementConflictDraft[shortKey][id] = { op: 'upsert', value: _vfDeepClone(e.data), base: _vfDeepClone(e.previous) };
        (res.conflicts[shortKey] = res.conflicts[shortKey] || []).push(id);
      } else if (e.op === 'delete') {
        if (cur === undefined) { delete entries[id]; res.landed++; return; }
        if (curS === prevS) { arr.splice(idx, 1); res.reapplied++; return; }
        state._keyElementConflictDraft[shortKey] = state._keyElementConflictDraft[shortKey] || {};
        state._keyElementConflictDraft[shortKey][id] = { op: 'delete' };
        (res.conflicts[shortKey] = res.conflicts[shortKey] || []).push(id);
      } else {
        delete entries[id];
      }
    });
    if (Object.keys(entries).length === 0) delete j.keys[shortKey];
    state[stateKey] = arr; // snapshot untouched: re-applied entries diff as real changes
  });
  _vfJournalWrite(j);
  return res;
}

/* ── T3-A (SÄK-9/SÄK-10): töm allt användarspecifikt i minnet ─────────
   Vid utloggning, kontobyte (även i annan flik), utgången session och när
   åtkomst saknas/dras in. Alla dataregister blir tomma, baslinjer och
   konfliktutkast nollställs, och `_degradedLoad` sätts så att ingen
   bulk-skrivning (persist) kan skicka det tömda läget som om det vore
   auktoritativt innan nästa riktiga initState(). Utkorgar/journaler i
   localStorage rörs inte. */
function _vfResetClientState() {
  const DATA = ['customers', 'workOrders', 'offers', 'invoices', 'staff', 'roles', 'properties', 'contracts', 'inspections',
    'timeEntries', 'articles', 'priceGroups', 'priceProfiles', 'titles', 'recurringOrders', 'salesOpportunities', 'activityLog',
    'ronderingsmallar', 'ronderingar', 'avvikelser', 'activities', 'serviceTemplates', 'emailTemplates', 'notifications',
    'propertyCategories', 'ronderingspass', 'propertyObjects', 'importLogs', 'propertyRoles', 'propertyContacts',
    'deviationCategories', 'offerEvents', 'offerAttachments', 'projects', 'projectDocuments'];
  DATA.forEach(function(k) { state[k] = []; });
  state.settings = {};
  state.currentUser = null;
  state.currentAO = null; state.currentOffer = null; state.currentInvoice = null; state.currentProperty = null; state.currentCustomer = null;
  state.stampActive = false; state.stampTimestamp = null; state.stampAoId = null;
  state._keyHash = {}; state._keySnapshot = {}; state._keyConflict = {}; state._keyConflictDraft = {}; state._keyElementConflictDraft = {};
  state._degradedLoad = true;
  state._wiped = true;
  try { _vfIdx = {}; } catch (e) {}
  try { if (typeof _vfLastPersistFailure !== 'undefined') _vfLastPersistFailure = {}; } catch (e) {}
  /* Okända/framtida register (arrays/objekt på state som inte är meta) töms också. */
  Object.keys(state).forEach(function(k) {
    if (k.charAt(0) === '_' || DATA.indexOf(k) !== -1) return;
    if (Array.isArray(state[k])) state[k] = [];
  });
}

/* T3-A: personal + roller från en omläsning (Auth.refreshAuthorization).
   Data, hash och baslinje uppdateras tillsammans (som DataSync._poll), och
   en nyckel i olöst konflikt rörs inte. */
function _vfApplyAuthzSnapshot(data, hashes) {
  if (!state._keyConflict['staff'] && Array.isArray(data.staff)) {
    state.staff = data.staff.map(function(s) { const c = Object.assign({}, s); delete c.password; delete c.passwordHash; return c; });
    state._keyHash['staff'] = Object.prototype.hasOwnProperty.call(hashes, 'vift_staff') ? hashes['vift_staff'] : null;
    state._keySnapshot['staff'] = JSON.stringify(state.staff);
  }
  if (!state._keyConflict['roles'] && Array.isArray(data.roles)) {
    state.roles = data.roles;
    state._keyHash['roles'] = Object.prototype.hasOwnProperty.call(hashes, 'vift_roles') ? hashes['vift_roles'] : null;
    state._keySnapshot['roles'] = JSON.stringify(data.roles);
  }
  if (Array.isArray(data.staff) && Array.isArray(data.roles)) { state._authzSource = 'server'; state._loadForbidden = false; }
}

/* M4 fallback/belt-and-braces: anything not yet confirmed by the server
   (a generic write in flight or queued, a journaled edit not yet
   applied, an unresolved conflict) makes the browser ask before the page
   is left — the user is never silently unaware. The journal above is
   what actually preserves the edit; this only makes the risk visible. */
function _vfHasUnconfirmedGenericWrites() {
  if (typeof DataSync !== 'undefined' && (DataSync._pendingWrites || 0) > 0) return true;
  if (Object.keys(state._keyConflict || {}).some(function(k) { return state._keyConflict[k]; })) return true;
  if (Object.keys(state._keyElementConflictDraft || {}).some(function(k) { return Object.keys(state._keyElementConflictDraft[k] || {}).length > 0; })) return true;
  return _vfJournalPendingCount() > 0;
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', function(e) {
    try {
      if (!_vfHasUnconfirmedGenericWrites()) return;
      e.preventDefault();
      e.returnValue = 'Det finns ändringar som ännu inte bekräftats sparade på servern.';
      return e.returnValue;
    } catch (err) {}
  });
}

/* PR #2 REVIEW FIX (2026-11-09, blocker B): the server's authoritative
   `current` (from a merge-write response) only reflects what the server
   knew about AT WRITE TIME — it cannot know about a local edit the user
   made to a DIFFERENT element in the same array WHILE this call was in
   flight (between the pre-write snapshot and this response arriving).
   Blindly replacing state[_stateKey] with `current` would silently
   discard that unsent edit with zero error. This performs a real
   three-way merge: an id this call actually SENT this cycle (`sentIds`)
   always takes the server's answer (identical to the old behavior for
   those ids — applied/conflicted, already correctly resolved above). For
   every OTHER id: if the live, in-memory value differs from what it was
   right before this call started (an edit made during the await, never
   sent), keep that live edit; otherwise trust the server's answer (which
   already reflects any OTHER session's changes to elements this call
   never touched). An element removed locally during the await (present
   before, absent now, never sent) stays removed rather than being
   resurrected from `current`. */
function _vfMergeAuthoritativeWithInFlightEdits(authoritativeArr, preAwaitArr, liveNowArr, sentIds, conflictedIds) {
  conflictedIds = conflictedIds || {};
  const authArr = authoritativeArr || [];

  /* PR #2 RE-REVIEW FIX (2026-11-09, finding E): a PRE-EXISTING duplicate
     id in the authoritative array (confirmed in real STAGING for
     vift_activityLog — 44 elements, one duplicated id) must never be
     silently collapsed to a single value by this function's id-keyed
     logic below. This call's own upserts/removals can never legitimately
     target an id that's duplicated server-side (the SQL layer refuses
     that outright with `duplicate_id_in_store`), so any duplicate seen
     here is always pre-existing data this call never touched — the only
     safe behavior is to pass every occurrence straight through, exactly
     as the server has it, untouched by the per-id merge entirely. */
  const _authCountById = {};
  authArr.forEach(function(el) { if (el && el.id != null) _authCountById[el.id] = (_authCountById[el.id] || 0) + 1; });
  const _duplicateIds = {};
  Object.keys(_authCountById).forEach(function(id) { if (_authCountById[id] > 1) _duplicateIds[id] = true; });

  const authById = {}, preById = {}, liveById = {};
  authArr.forEach(function(el) { if (el && el.id != null && !_duplicateIds[el.id]) authById[el.id] = el; });
  (preAwaitArr || []).forEach(function(el) { if (el && el.id != null && !_duplicateIds[el.id]) preById[el.id] = el; });
  (liveNowArr || []).forEach(function(el) { if (el && el.id != null && !_duplicateIds[el.id]) liveById[el.id] = el; });

  const allIds = {};
  Object.keys(authById).forEach(function(id) { allIds[id] = true; });
  Object.keys(preById).forEach(function(id) { allIds[id] = true; });
  Object.keys(liveById).forEach(function(id) { allIds[id] = true; });

  const result = [];
  // Every occurrence of a duplicated id, verbatim, untouched.
  authArr.forEach(function(el) { if (el && el.id != null && _duplicateIds[el.id]) result.push(el); });

  Object.keys(allIds).forEach(function(id) {
    if (sentIds[id]) {
      /* PR #2 RE-REVIEW FIX (2026-11-09, finding A): a same-id in-flight
         race. `preById[id]` for an id this call actually SENT is exactly
         the value that was transmitted (it's a clone of the array taken
         at the very moment the request was built — see _doPersist()'s
         `_preAwaitArr`). If the LIVE value now differs from that, the
         user edited this SAME element again locally while the HTTP call
         was still pending — a second, never-sent edit that must not be
         silently discarded by blindly trusting the server's answer to
         the OLDER edit. */
      if (conflictedIds[id]) {
        // The send for this id was REJECTED as a conflict. Never blend a
        // further local edit in here — the existing conflict-draft
        // mechanism (see _doPersist()) already owns what happens next
        // for this id; show the server's real current value, nothing
        // else, so the conflict dialog reflects reality.
        if (Object.prototype.hasOwnProperty.call(authById, id)) result.push(authById[id]);
        return;
      }
      const _sentValue = Object.prototype.hasOwnProperty.call(preById, id) ? preById[id] : undefined;
      const _liveValue  = Object.prototype.hasOwnProperty.call(liveById, id) ? liveById[id] : undefined;
      if (JSON.stringify(_liveValue) !== JSON.stringify(_sentValue)) {
        // A further, not-yet-sent edit (or removal) happened during the
        // await — keep it visible. The diff baseline is set separately
        // by the caller from `current` ALONE (never this merged value),
        // so the NEXT persist() cycle correctly sees this as a fresh
        // change against the server's confirmed value and sends it as a
        // real, version-checked write — never re-treated as "already
        // clean" and never silently dropped.
        if (_liveValue !== undefined) result.push(_liveValue);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(authById, id)) result.push(authById[id]);
      return; // this call's own send is authoritative for ids it touched
    }
    const inLive = Object.prototype.hasOwnProperty.call(liveById, id);
    const inPre  = Object.prototype.hasOwnProperty.call(preById, id);
    if (inLive && inPre) {
      if (JSON.stringify(liveById[id]) !== JSON.stringify(preById[id])) {
        result.push(liveById[id]); // edited locally DURING the await, never sent — keep it
      } else if (Object.prototype.hasOwnProperty.call(authById, id)) {
        result.push(authById[id]); // unchanged locally — trust the server
      }
      // else: unchanged locally, but server no longer has it (another
      // session removed it) — correctly omitted.
    } else if (inLive && !inPre) {
      result.push(liveById[id]); // brand-new local element added during the await, never sent
    } else if (!inLive && inPre) {
      // locally removed DURING the await, never sent — respect the
      // removal; the NEXT persist() cycle sends it as a real,
      // version-checked removal against the now-updated snapshot.
    } else if (Object.prototype.hasOwnProperty.call(authById, id)) {
      result.push(authById[id]);
    }
  });
  return result;
}

/* Etablerar/uppdaterar baslinje-hash+snapshot för ALLA generiska business-
   nycklar. Tar emot `precomputedHashes` från SAMMA atomiska
   Storage.getAllWithHashes()-anrop som också hämtade själva datan (se
   initState() nedan) — inget separat, senare nätverksanrop (det var root
   cause till P0-rättelsens egen, tidigare reproducerade lost-update-bugg;
   samma princip återanvänds här förebyggande). */
async function _vfSyncBusinessKeyBaselines(precomputedHashes) {
  if (!precomputedHashes) return;
  VIFT_BUSINESS_KEYS.forEach(function(shortKey) {
    const fullKey = 'vift_' + shortKey;
    state._keyHash[shortKey] = (precomputedHashes && Object.prototype.hasOwnProperty.call(precomputedHashes, fullKey))
      ? precomputedHashes[fullKey] : null;
    state._keySnapshot[shortKey] = JSON.stringify(state[_vfBusinessStateKey(shortKey)]);
  });
}

/**
 * Initiera state från Supabase (ett bulk-anrop), fall back på localStorage → seed-data.
 * Kräver att Auth.getAccessToken() returnerar ett giltigt JWT (RLS blockerar anon).
 */
async function initState() {
  let d = {};
  let _combinedHashes = null;
  state._degradedLoad = false;
  /* T3-A: var personal/roller kommer ifrån avgör om identiteten kan
     fastställas (Auth._resolveUser): 'server' | 'cache' (egen cache) | 'seed'. */
  state._loadForbidden = false;
  state._authzSource = null;
  state._wiped = false;
  let _fromServer = false;
  try {
    /* 8-sekunders timeout — om Supabase är långsam/offline faller vi tillbaka
     * på localStorage direkt utan att hänga på "Laddar data".
     * STAGING-GRANSKNING 2026-11-06 (fynd 2): hämtar nu data OCH baslinje-
     * hashar för de generiska nycklarna i ETT ATOMISKT anrop
     * (Storage.getAllWithHashes), istället för en separat, senare
     * hash-hämtning — samma motivering som P0_FINAL_2026-11-04:s
     * motsvarande rättelse (två separata round-trips kan en annan sessions
     * skrivning hinna ske mellan). */
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000));
    /* PR #2 CONSOLIDATED FIX (finding C): request the write-allowlisted
       generic keys AND the read-only extra keys in the SAME atomic call —
       only the former get a write baseline (see _vfSyncBusinessKeyBaselines
       below, unchanged, still VIFT_BUSINESS_KEYS-only), but both need their
       current value in `d` for the state assignments further down. */
    const fullBusinessKeys = VIFT_BUSINESS_KEYS.concat(VIFT_READONLY_EXTRA_KEYS).map(function(k) { return 'vift_' + k; });
    const _combined = await Promise.race([Storage.getAllWithHashes(fullBusinessKeys, { authzProbe: true }), timeout]);
    if (!_combined.ok) throw new Error(_combined.error || 'getAllWithHashes_failed');
    d = _combined.data;
    _combinedHashes = _combined.hashes;
    _fromServer = true;
  } catch(e) {
    /* T3-A (SÄK-10): servern nekar användaren (403, t.ex. ingen aktiv
       personalpost) → ingen reservdata alls, inte ens egen cache. */
    if (/\b403\b/.test(String(e && e.message || ''))) {
      console.warn('[initState] Servern nekade inläsningen (403) — ingen åtkomst, ingen cache används.');
      state._loadForbidden = true;
      d = {};
    } else {
    console.warn('[initState] Supabase ej tillgänglig, använder localStorage:', e.message);
    /* T3-A (SÄK-9): Storage._localAll() returnerar bara cache som tillhör
       den inloggade användaren i denna miljö (annars tomt). */
    d = Storage._localAll();
    }
    /* P0-INCIDENT-FIX (2026-11): en degraderad läsning (timeout/nätverksfel/
       401/403 → localStorage-fallback) får ALDRIG tillåta en efterföljande
       persist() att skriva tillbaka det ofullständiga/seedade resultatet som
       om det vore auktoritativt. Flaggan konsumeras av _doPersist() nedan. */
    state._degradedLoad = true;
  }

  /* STAGING-GRANSKNING 2026-11-06 (fynd 1) — "lyckad men ofullständig"-
     luckan: ett getAll()-svar som INTE kastar fel/timeout kan ändå vara
     otillförlitligt — saknade nycklar helt, eller ett mönster som är
     praktiskt omöjligt för en äkta, i drift varande installation. Portat
     ordagrant från P0_FINAL_2026-11-04:s motsvarande, redan testade
     korrigering (samma motivering, samma gräns mellan "nyckel finns, är
     tom array" [kan vara en äkta, ny/tömd installation] och "nyckel finns
     inte alls i svaret" [ett ofullständigt/trunkerat svar som ALDRIG ska
     tolkas som auktoritativt]). En genuint ny, tom STAGING-installation
     (inte dagens verkliga läge — STAGING har redan riktig data) måste gå
     via samma separata, server-verifierade bootstrap-väg som LIVE-arbetet
     redan byggde (Storage.bootstrapEmptyInstance(), kräver admin_manage +
     en server-sidig bekräftelse att nycklarna verkligen är tomma) — INTE
     den generiska persist()-vägen. Se STAGING-CANDIDATE-REPORT-2026-11-06.md
     §1 för den fullständiga, ärligt redovisade avgränsningen av denna
     heuristik (klienten kan INTE perfekt skilja "äkta ny installation" från
     "ett degraderat svar som råkar se likt ut" utan ett server-sidigt
     facit — vi väljer därför det SÄKRARE felläget). */
  if (!state._degradedLoad) {
    var _expectedTopKeys = ['customers', 'offers', 'staff', 'properties', 'activityLog', 'settings'];
    var _missingKeys = _expectedTopKeys.filter(function(k) { return d[k] === undefined; });
    if (_missingKeys.length > 0) {
      console.warn('[initState] Svaret saknar förväntade nycklar helt (' + _missingKeys.join(', ') + ') — räknas som degraderad/ofullständig läsning.');
      state._degradedLoad = true;
    } else {
      var _criticalKeys = ['customers', 'offers'];
      var _allCriticalEmpty = _criticalKeys.every(function(k) {
        return Array.isArray(d[k]) && d[k].length === 0;
      });
      /* T3-D (2026-11-28, D-12/D-13): servern lämnar ut kunder och offerter per uppdrag till
         fält och begränsad roll. Tomma listor är då ett äkta svar (inga egna AO), inte ett
         tecken på en degraderad läsning. Heuristiken gäller bara den som får läsa hela
         kundregistret (samma behörigheter som servern, _vift_kund_las). Behörigheterna tas ur
         serverns egen, projicerade personal- och rollpost för den inloggade e-posten. */
      if (_allCriticalEmpty) {
        var _me = (typeof Auth !== 'undefined' && Auth.getUserEmail) ? String(Auth.getUserEmail() || '').toLowerCase() : '';
        var _meStaff = (Array.isArray(d['staff']) ? d['staff'] : []).find(function(s) { return s && s.active && s.email && String(s.email).toLowerCase() === _me; });
        var _meRole = _meStaff ? (Array.isArray(d['roles']) ? d['roles'] : []).find(function(r) { return r && r.id === _meStaff.role; }) : null;
        var _mePerms = _meRole && Array.isArray(_meRole.permissions) ? _meRole.permissions : null;
        var _readsAll = !_mePerms || ['all', 'customer_manage', 'invoice_view', 'invoice_create', 'offer_manage', 'sales_manage', 'ao_view_all', 'ao_create', 'recurring_manage', 'reports_view']
          .some(function(p) { return _mePerms.indexOf(p) !== -1; });
        if (!_readsAll) _allCriticalEmpty = false;
      }
      if (_allCriticalEmpty) {
        var _respStaffIds = (Array.isArray(d['staff']) ? d['staff'] : []).map(function(s) { return s && s.id; }).filter(Boolean).slice().sort();
        var _seedStaffIds = (typeof SeedData !== 'undefined' && Array.isArray(SeedData.staff) ? SeedData.staff : []).map(function(s) { return s && s.id; }).filter(Boolean).slice().sort();
        var _staffLooksLikeSeed = _respStaffIds.length > 0 && JSON.stringify(_respStaffIds) === JSON.stringify(_seedStaffIds);
        if (_staffLooksLikeSeed) {
          console.warn('[initState] Kunder och offerter tomma SAMTIDIGT som personal matchar exakt SeedData.staff — räknas som misstänkt/degraderad läsning, inte ett äkta nyinstallerat system.');
          state._degradedLoad = true;
        }
      }
    }
  }

  const g = key => (d[key] !== undefined && d[key] !== null) ? d[key] : null;

  /* ── Transaktionell CRM-data: tom lista om inget finns i Supabase ──────
   * Faller INTE tillbaka på SeedData — annars visas demo-siffror i badges
   * och filterpanelen för en installation som saknar riktig data.          */
  state.customers          = g('customers')        || [];
  /* SÄKERHETSFYND V7 (vift_workOrders-läsningslucka): `vift_workOrders`
     är nu blockerad från direkt autentiserad SELECT (RLS, se
     20261030000001_workorders_read_lockdown.sql) — `g('workOrders')`
     ovan kommer ALLTID vara null/saknas i bulk-snapshoten nu, oavsett
     behörighet (precis som för `vift_timeEntries` sedan BLOCKER-1).
     Hämtas istället via WorkOrdersReadService (work-orders-list EF,
     server-sidig ao_view_own/ao_view_all-filtrering) — se nedan, efter
     att AOTimeSyncService m.fl. redan är definierade. */
  state.workOrders         = [];
  state.offers             = g('offers')           || [];
  state.invoices           = g('invoices')         || [];
  state.properties         = g('properties')       || [];
  state.salesOpportunities = g('salesOpps')        || [];
  state.activityLog        = g('activityLog')      || [];
  /* P0 FINAL INTEGRATION (STAFF/PAYROLL R1 — BLOCKER-1): `vift_timeEntries`
     är nu blockerad från direkt autentiserad SELECT (RLS, se
     20261018000007_timeentries_payroll_read_lockdown.sql) — `g('timeEntries')`
     ovan kommer ALLTID vara null/saknas i bulk-snapshoten nu, oavsett
     behörighet. Hämtas istället via TimeEntriesReadService (time-entries-list
     EF, server-sidig payroll_view-filtrering) — se nedan, efter att
     RonderingSyncService m.fl. redan är definierade (anropas async, väntas
     INTE in här för att inte blockera initState() på ett extra nätverksanrop;
     sätts asynkront strax efter, se nedan). */
  state.timeEntries        = [];
  state.contracts          = g('contracts')        || [];
  state.recurringOrders    = g('recurringOrders')  || [];
  state.ronderingar        = g('ronderingar')      || [];
  state.avvikelser         = g('avvikelser')       || [];
  state.activities         = g('activities')       || [];
  state.notifications      = g('notifications')    || [];
  state.ronderingspass     = g('ronderingspass')   || [];
  state.propertyObjects    = g('propertyObjects')  || [];
  state.importLogs         = g('importLogs')       || [];
  state.propertyRoles         = g('propertyRoles')         || [];
  state.propertyContacts      = g('propertyContacts')      || [];
  state.deviationCategories   = g('deviationCategories')   || [];
  state.inspections           = g('inspections')           || [];
  state.offerEvents           = g('offerEvents')           || [];
  state.offerAttachments      = g('offerAttachments')      || [];
  state.projects               = g('projects')               || [];
  state.projectDocuments        = g('projectDocuments')        || [];

  /* ── Konfigurations- och referensdata: SeedData ger vettiga standardvärden ── */
  state.priceGroups        = g('priceGroups')        || SeedData.priceGroups        || [];
  state.priceProfiles      = g('priceProfiles')      || SeedData.priceProfiles      || [];
  state.settings           = g('settings')           || SeedData.settings           || {};
  state.articles           = g('articles')           || SeedData.articles           || [];
  state.titles             = g('titles')             || SeedData.titles             || [];
  state.roles              = g('roles')              || SeedData.roles              || [];
  state.serviceTemplates   = g('serviceTemplates')   || SeedData.serviceTemplates   || [];
  state.emailTemplates     = g('emailTemplates')     || SeedData.emailTemplates     || [];
  state.propertyCategories = g('propertyCategories') || SeedData.propertyCategories || [];
  state.ronderingsmallar   = g('ronderingsmallar')   || SeedData.ronderingsmallar   || [];

  /* Ladda staff — strippa alltid lösenordsfält (ska aldrig ligga i frontend).
   * BEHÅLLER SeedData.staff som fallback: _resolveUser() matchar inloggad email
   * mot state.staff för rollresolution — tom lista → alla får roll "personal". */
  const rawStaff = g('staff') || SeedData.staff;
  state.staff = rawStaff.map(function(s) {
    const clean = Object.assign({}, s);
    delete clean.password;
    delete clean.passwordHash;
    return clean;
  });

  /* T3-A (SÄK-10): identiteten får bara fastställas mot personal och roller
     från servern eller användarens EGEN cache — aldrig mot SeedData. */
  if (!state._loadForbidden && Array.isArray(d['staff']) && Array.isArray(d['roles'])) state._authzSource = _fromServer ? 'server' : 'cache';
  else state._authzSource = 'seed';
  /* Avgör åtkomsten INNAN något annat görs med datan (baslinjer, uppspelning
     av osparade ändringar, stämpling, migreringar, utkorg). Utan åtkomst
     töms allt direkt och inget skickas. */
  if (typeof Auth !== 'undefined' && typeof Auth._resolveUser === 'function' && typeof Auth.accessState === 'function') {
    Auth._resolveUser();
    if (Auth.accessState() !== 'ok') {
      console.warn('[initState] Ingen åtkomst (' + Auth.accessState() + ') — data töms, inget skickas.');
      _vfResetClientState();
      return;
    }
  }


  // Rensa AO:er vars 14-dagarsfönster gått ut
  const _trashNow = new Date();
  state.workOrders = state.workOrders.filter(function(ao) {
    if (!ao.deleted || !ao.deleteAfter) return true;
    return new Date(ao.deleteAfter) > _trashNow;
  });

  // Migrera titlar från sträng → objekt
  state.titles = state.titles.map(function(t, i) {
    if (typeof t === 'string') {
      return { id: 'TIT-' + String(i + 1).padStart(3, '0'), name: t, description: '', active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }
    return t;
  });

  // Säkerställ att alla roller har active-fält
  state.roles = state.roles.map(function(r) {
    return r.active !== undefined ? r : Object.assign({ active: true }, r);
  });

  /* Sätt DataSync._lastSig från laddad lastChanged — undviker omedelbar re-fetch vid första poll */
  var _loadedSig = d['lastChanged'] || null;
  if (_loadedSig && typeof DataSync !== 'undefined') DataSync._lastSig = _loadedSig;
  var _aoCount = Array.isArray(state.workOrders) ? state.workOrders.filter(function(a) { return !a.deleted && !a.archived; }).length : 0;
  console.log('[initState] Laddat ' + _aoCount + ' aktiva AO — lastChanged: ' + (_loadedSig || 'saknas'));

  /* STAGING-GRANSKNING 2026-11-06 (fynd 2): etablera baslinje-hash+snapshot
     för ALLA generiska business-nycklar NU, direkt efter att de just
     laddats — detta är den enda gång _doPersist() därefter kommer behöva
     lita på en LAGRAD (inte nyhämtad) hash. Körs INTE om degraderad-läsning
     redan är satt (en baslinje mot en degraderad kopia skulle vara
     meningslös/farlig). */
  if (!state._degradedLoad) {
    try { await _vfSyncBusinessKeyBaselines(_combinedHashes); }
    catch(e) { console.warn('[initState] kunde inte etablera baslinje-hashar:', e); }

    /* QA FIX-ROUND 2026-11-12 (M4): replay generic edits that were still
       unconfirmed when the previous page load ended (see
       _vfReplayPersistJournal()). Only after a non-degraded load, so the
       three-way check runs against the server's real current value. */
    try {
      const _rp = _vfReplayPersistJournal();
      const _conflictKeys = Object.keys(_rp.conflicts);
      if (_rp.reapplied > 0) {
        console.warn('[initState] ' + _rp.reapplied + ' osparad(e) ändring(ar) från förra sessionen återupptas och skickas igen.');
        persist();
        if (typeof showToast === 'function') {
          setTimeout(function() { showToast(_rp.reapplied + ' osparad(e) ändring(ar) från förra sessionen skickas nu till servern.', 6000); }, 500);
        }
      }
      if (_conflictKeys.length > 0 && typeof App !== 'undefined' && App.showPersistConflictWarning) {
        setTimeout(function() {
          _conflictKeys.forEach(function(k) { try { App.showPersistConflictWarning(k, _rp.conflicts[k]); } catch (e2) {} });
        }, 800);
      }
      /* N1: edits the user was told had failed are not resent; they are
         offered again (Återuppta / Kasta) until the user decides. */
      if (_rp.held > 0) {
        console.warn('[initState] ' + _rp.held + ' osparad(e) ändring(ar) väntar på ditt beslut (Återuppta/Kasta).');
        _vfRefreshHeldBanner();
        setTimeout(function() { try { _vfRefreshHeldBanner(); } catch (e3) {} }, 800);
      }
    } catch (e) { console.warn('[initState] uppspelning av osparade ändringar misslyckades:', e); }
  }

  /* Stämplingsstate — P2-2 (fix round 2026-11-16, KORRIGERAD i en andra
     omgång efter oberoende granskning): servern är den kanoniska källan
     vid inloggning/omladdning, inte bara enhetens egen localStorage (det
     var rotorsaken till att mobil och dator kunde visa olika status för
     samma person).
     KORRIGERING: den FÖRSTA versionen av denna fix läste ett påstått
     "redan hämtat" värde ur `d`/`g()` — men `d` kommer uteslutande från
     `Storage.getAllWithHashes(fullBusinessKeys)` ovan, och
     `fullBusinessKeys` är ALLTID exakt VIFT_BUSINESS_KEYS +
     VIFT_READONLY_EXTRA_KEYS (dessutom filtrerat server-sidigt mot
     store-key-write:s egen READABLE_KEYS-allowlist) — en per-användare-
     nyckel ingår aldrig i det svaret, oavsett vad den heter. Den
     ursprungliga reconciliation-koden föll därför ALLTID tillbaka på
     local-grenen; buggen den skulle lösa kvarstod opåverkad. Fixat genom
     ett EGET, dedikerat anrop (Storage.getStampStatus()) mot en ny,
     identitetsskopad EF-väg där servern själv avgör "vilken användare"
     utifrån JWT:en — se STAMP_STATUS_patch_2026-11-16.ts/
     20261116000002_stamp_status_identity_scoped.sql. En stabil
     server-verifierad identitet (auth.user.id), inte en klientvald
     e-postsuffix, är den faktiska behörighetsgränsen nu — epost-
     suffixningen från den första omgången är helt borttagen (både här
     och i TimeService.js/Storage.setStampStatus()). */
  // Lokal cache-nyckel, namnge med inloggad användares e-post — ENBART en
  // lokal bekvämlighetsåtgärd (två personalmedlemmar som delar en
  // surfplatta ska inte läsa varandras cachade status); INTE en
  // behörighetsgräns, det är nu stamp_status-tabellens egen RLS. Samma
  // konvention som Storage._stampLocalKey() i storage.js.
  const _stampEmail = (typeof Auth !== 'undefined' && Auth.getUserEmail) ? Auth.getUserEmail() : null;
  const _stampSfx = _stampEmail ? '_' + _stampEmail : '';
  let localActive = false, localTs = null, localAoId = null;
  const _stampHasSuffixedKey = _stampSfx && localStorage.getItem('vift_stampActive' + _stampSfx) !== null;
  if (_stampHasSuffixedKey) {
    try { localActive = !!JSON.parse(localStorage.getItem('vift_stampActive' + _stampSfx)); } catch(e) {}
    try { localTs      = JSON.parse(localStorage.getItem('vift_stampTs' + _stampSfx))    || null; } catch(e) {}
    try { localAoId    = JSON.parse(localStorage.getItem('vift_stampAoId' + _stampSfx)) || null; } catch(e) {}
  } else if (localStorage.getItem('vift_stampActive') !== null) {
    /* P2-2 migrationssäkerhet (fix round 4): denna enhet körde tidigare
       round-2-kod, som cachade stämplingsstatus under den OSUFFIXADE
       nyckeln (ingen kontokoppling fanns då alls). Round 3/4 läser och
       skriver bara den KONTOSUFFIXADE nyckeln — utan denna gren hade den
       gamla cachen blivit osynlig för den nya koden och en pågående
       instämpling hade tyst försvunnit vid första omladdningen efter
       uppgraderingen. Läses EN gång, som en provisorisk startpunkt
       (exakt samma garantinivå den redan hade under round 2 — ingen
       kontoverifiering fanns då heller), och TAS BORT omedelbart efteråt
       så den aldrig kan läsas igen av ett SENARE, ANNAT konto på samma
       enhet ("tilldela aldrig en global gammal stämpling till fel
       användare"). Den nya, korrekt namngivna nyckeln skriven av
       reconciliation-steget nedan (serverbekräftad, eller denna
       provisoriska migrering om servern saknar rad) blir permanent. */
    try { localActive = !!JSON.parse(localStorage.getItem('vift_stampActive')); } catch(e) {}
    try { localTs      = JSON.parse(localStorage.getItem('vift_stampTs'))    || null; } catch(e) {}
    try { localAoId    = JSON.parse(localStorage.getItem('vift_stampAoId')) || null; } catch(e) {}
    try {
      localStorage.removeItem('vift_stampActive');
      localStorage.removeItem('vift_stampTs');
      localStorage.removeItem('vift_stampAoId');
    } catch(e) {}
    console.warn('[initState] migrerade engångs- och tog bort den osuffixade round-2-stämplingscachen (konto: ' + (_stampEmail || 'okänt') + ')');
  }

  let _stampServerOk = false;
  if (!state._degradedLoad && typeof Storage !== 'undefined' && typeof Storage.getStampStatus === 'function') {
    try {
      const _stampTimeout = new Promise((_, rej) => setTimeout(() => rej(new Error('stamp_timeout')), 5000));
      const stampResult = await Promise.race([Storage.getStampStatus(), _stampTimeout]);
      if (stampResult && stampResult.ok) {
        _stampServerOk = true;
        if (typeof Storage.setStampRevision === 'function') Storage.setStampRevision(stampResult.revision || 0);
        if (stampResult.hasRow) {
          // Servern har en bekräftad rad för DEN HÄR användaren — kanonisk.
          state.stampActive    = !!stampResult.active;
          state.stampTimestamp = state.stampActive ? (stampResult.ts || null) : null;
          state.stampAoId      = state.stampActive ? (stampResult.aoId || null) : null;
          try {
            localStorage.setItem('vift_stampActive' + _stampSfx, JSON.stringify(state.stampActive));
            localStorage.setItem('vift_stampTs' + _stampSfx,     JSON.stringify(state.stampTimestamp));
            localStorage.setItem('vift_stampAoId' + _stampSfx,   JSON.stringify(state.stampAoId));
          } catch(e) {}
        } else {
          /* P2-2 migrationssäkerhet (fix round 3): hasRow:false betyder
             "den här användaren har aldrig skrivit en rad i den nya
             tabellen" — INTE "bekräftat utstämplad". Utan denna gren
             hade den allra första inloggningen efter att denna fix
             installerats tyst kunnat radera en redan pågående stämpling
             ur klientens tillstånd. Faller istället tillbaka på
             enhetens egen lokala kopia som en PROVISORISK sanning, och
             laddar — om den visar aktiv — upp den till den nya tabellen
             (självläkning) så att framtida inloggningar (denna och andra
             enheter) blir serverbekräftade från och med nu. */
          state.stampActive    = localActive;
          state.stampTimestamp = localTs;
          state.stampAoId      = localAoId;
          if (localActive && typeof Storage.setStampStatus === 'function') {
            // hasRow:false -> the correct expectedRevision for this
            // user's FIRST write is 0 (matches store_read_stamp_status's
            // own "no row" response), not a client-invented counter.
            try { Storage.setStampStatus(true, localTs, localAoId, 0); }
            catch(e) { console.warn('[initState] kunde inte självläka stämplingsstatus till den nya tabellen:', e.message); }
          }
        }
      } else {
        console.warn('[initState] kunde inte läsa stämplingsstatus från servern, faller tillbaka på lokal cache:', stampResult && stampResult.error);
      }
    } catch(e) {
      console.warn('[initState] stämplingsstatus-anrop misslyckades, faller tillbaka på lokal cache:', e.message);
    }
  }
  if (!_stampServerOk) {
    // Ingen bekräftad serversvar (degraderad laddning, nätverksfel,
    // timeout, eller EF:en/RPC:erna ännu inte installerade) — fall
    // tillbaka på enhetens egen lokala kopia, exakt som innan denna fix.
    // ALDRIG en falsk "serverbekräftad"-status här.
    state.stampActive    = localActive;
    state.stampTimestamp = localTs;
    state.stampAoId      = localAoId;
  }

  /* Time-clock DURABLE RECOVERY (2026-11-17): clockOut() writes a
     pending-clear marker (Storage.setPendingStampClear()) the instant its
     time entry is server-confirmed, BEFORE attempting the stamp-clear
     itself, and only removes it once that clear gets a real, definitive
     server response. If the browser closed/crashed in between, the
     marker survives and the SAME dangling "still active" row is still
     exactly what the server just reported above — safe to retry the
     clear here. If the marker's ts/aoId do NOT match the server's
     current row (the user legitimately clocked in again on a different
     AO since), the marker is stale and is discarded WITHOUT touching the
     new, unrelated, genuinely active session — never blindly clear
     "whatever is currently active" just because a marker exists. */
  if (_stampServerOk && typeof Storage !== 'undefined' && typeof Storage.getPendingStampClear === 'function') {
    try {
      const pending = Storage.getPendingStampClear();
      if (pending && state.stampActive === true
          && state.stampTimestamp === pending.ts
          && (state.stampAoId || null) === (pending.aoId || null)) {
        console.warn('[initState] återupptar en avbruten stämplingsutloggning (tidpost ' + pending.timeEntryId + ' redan bekräftad, servern visade fortfarande instämplad) — försöker rensa statusen igen.');
        Storage.setStampStatus(false, null, null, Storage.getStampRevision()).then(function (r) {
          if (r && r.ok) {
            Storage.clearPendingStampClear();
            if (!r.stale) {
              state.stampActive = false; state.stampTimestamp = null; state.stampAoId = null;
              if (typeof MobileShell !== 'undefined' && MobileShell.onClockChange) MobileShell.onClockChange();
            }
          }
        });
      } else if (pending && !(state.stampActive === true && state.stampTimestamp === pending.ts && (state.stampAoId || null) === (pending.aoId || null))) {
        // Marker no longer matches the server's current row (a new,
        // legitimate session has since started, or the clear already
        // landed through some other path) — discard it, do not act on it.
        Storage.clearPendingStampClear();
      }
    } catch (e) { console.warn('[initState] kunde inte kontrollera väntande stämplingsutloggning:', e.message); }
  }

  /* Molnstämpling: en utstämpling vars tidpost fortfarande väntar i outboxen
     (fliken stängdes före svaret) ska visas som utstämplad — servern visar
     passet aktivt tills tidposten bekräftats och fortsättningen
     (clockout_stamp_clear-intent) rensat det. */
  if (state.stampActive && typeof TimeService !== 'undefined' && typeof TimeService._pendingClockOutFor === 'function'
      && TimeService._pendingClockOutFor(state.stampTimestamp)) {
    state.stampActive = false; state.stampTimestamp = null; state.stampAoId = null;
  }
  if (typeof TimeService !== 'undefined' && typeof TimeService.startStampWatch === 'function') TimeService.startStampWatch();

  // Migrera gamla RON.results[] → ronderingspass (idempotent, kör varje laddning tills migrerat)
  //
  // P0 PART B (RONDERINGSPASS R1): skriver nu via
  // RonderingSyncService.migrateLegacy() (rondering_pass_migrate_legacy-
  // RPC:n, deterministiskt id, server-sidigt idempotent) istället för att
  // bara pusha in i state.ronderingspass och förlita sig på att en
  // SENARE, obesläktad persist()-anrop råkar skicka med den — det
  // skrivvägen finns inte längre (vift_ronderingspass är exkluderad ur
  // den generiska _doPersist()-listan, se nedan). Utan denna omskrivning
  // hade legacy-migreringen tystnat helt: den hade fortsatt köras om vid
  // VARJE sidladdning (eftersom ingenting längre bekräftade den som
  // sparad server-sidigt) utan att någonsin faktiskt synas för andra
  // enheter.
  for (const ron of state.ronderingar) {
    if (!ron.results || ron.results.length === 0) continue;
    if (state.ronderingspass.some(function(p) { return p.ronderingId === ron.id && p.migratedFromLegacy; })) continue;
    var passStatus = (ron.status === 'slutförd' || ron.status === 'har_avvikelser') ? ron.status
                   : (ron.status === 'pågående' ? 'pågående' : 'planerat');
    var passCats = (ron.results || []).map(function(res) {
      return {
        id: res.categoryId,
        name: res.categoryName,
        points: (res.points || []).map(function(pt) {
          var newStatus = pt.status === 'avvikelse' ? 'anmärkning' : (pt.status || '');
          return {
            id: pt.pointId,
            title: pt.pointTitle,
            description: pt.pointDesc || '',
            canCreateAO: pt.canCreateAO !== false,
            requiresPhoto: false,
            status: newStatus,
            comment: pt.comment || '',
            images: [],
            workOrderId: pt.workOrderId || null,
            checkedAt: pt.checkedAt || null,
            checkedBy: ron.performedBy || null
          };
        })
      };
    });
    var sumTotal = 0, sumOk = 0, sumAnm = 0, sumEjK = 0, sumEjA = 0;
    passCats.forEach(function(cat) {
      (cat.points || []).forEach(function(pt) {
        sumTotal++;
        if (pt.status === 'ok') sumOk++;
        else if (pt.status === 'anmärkning') sumAnm++;
        else if (pt.status === 'ej_aktuell') sumEjA++;
        else if (pt.status === 'ej_kontrollerad') sumEjK++;
      });
    });
    var pass = Object.assign(Schema.ronderingspass(), {
      id: 'PASS-MIG-' + ron.id,
      ronderingId: ron.id,
      mallId: ron.templateId || '',
      propertyId: ron.propertyId || '',
      customerId: ron.customerId || '',
      sequenceNumber: 1,
      scheduledDate: ron.startedAt ? ron.startedAt.split('T')[0] : '',
      scheduledTime: ron.startedAt ? ron.startedAt.split('T')[1].substring(0, 5) : '',
      staffIds: ron.performedBy ? [ron.performedBy] : [],
      status: passStatus,
      startedAt: ron.startedAt || null,
      completedAt: ron.completedAt || null,
      completedBy: ron.performedBy || null,
      categories: passCats,
      summary: { total: sumTotal, ok: sumOk, anmärkningar: sumAnm, ejKontrollerad: sumEjK, ejAktuell: sumEjA },
      internalNote: ron.internalNote || '',
      migratedFromLegacy: true,
      createdAt: ron.createdAt || new Date().toISOString(),
      updatedAt: ron.updatedAt || new Date().toISOString()
    });
    try {
      const r = await RonderingSyncService.migrateLegacy(pass);
      if (!r.ok) console.warn('[initState] Legacy-migrering av ronderingspass misslyckades för ' + ron.id + ':', r.error);
      // RonderingSyncService._applyLocally() har redan satt in den
      // servercanoniska (eller redan existerande) kopian i
      // state.ronderingspass — ingen ytterligare lokal push här.
    } catch (e) {
      console.warn('[initState] Legacy-migrering av ronderingspass kastade fel för ' + ron.id + ':', e);
    }
  }

  /* P0 AO/TID-FIX: återuppta eventuella AO-/tidskrivningar som stod kvar
     i AOTimeSyncService:s durabla outbox (localStorage) från en tidigare,
     avbruten session (flik stängd/kraschad mitt i en serverskrivning,
     nätverksfel som aldrig löstes ut) — se AOTimeSyncService.js för hela
     mönstret. Körs fire-and-forget (väntas INTE in här) — initState() ska
     aldrig hänga på en nätverksretry; outboxen är redan själv-serialiserad
     och trygg att köra i bakgrunden medan resten av appen laddar. */
  if (typeof AOTimeSyncService !== 'undefined' && typeof AOTimeSyncService.resumePending === 'function') {
    AOTimeSyncService.resumePending().catch(function(e) {
      console.warn('[initState] AOTimeSyncService.resumePending() fel:', e);
    });
  }

  /* B1 FIX (independent-reviewer finding, round 5): self-healing pass
     for the durable "ACK-then-commit" intents (offer->AO conversion,
     recurring-order next-AO, rondering deviation->AO — see
     AOTimeSyncService.js's header for the whole mechanism). Covers
     exactly the gap the reviewer reproduced: an outbox entry that
     settled successfully (even in a PRIOR session, e.g. the tab closed
     right after the server ACK but before the commit handler ran) but
     whose cross-reference commit never actually ran. Safe to call on
     EVERY load, unconditionally — each intent either applies exactly
     once (idempotent, see each handler's own guard) or is already
     gone. Runs here, NOT earlier, because every page/service script
     (which register their handlers at file-load time) has already run
     by the time `initState()` is ever called — see index.html's load
     order (bootstrap script, after every other `<script>` tag). */
  if (typeof TimeService !== 'undefined' && typeof TimeService.registerStampIntentHandler === 'function') TimeService.registerStampIntentHandler();
  if (typeof AOTimeSyncService !== 'undefined' && typeof AOTimeSyncService.reconcileSettledIntents === 'function') {
    try { AOTimeSyncService.reconcileSettledIntents(); } catch (e) { console.warn('[initState] AOTimeSyncService.reconcileSettledIntents() fel:', e); }
  }

  /* P0 FINAL INTEGRATION (STAFF/PAYROLL R1 — BLOCKER-1): hämta
     state.timeEntries via time-entries-list EF:en (server-sidig
     payroll_view-filtrering) — AWAIT:ad (till skillnad från
     resumePending ovan), eftersom flera sidor (TimePage, löneunderlag,
     fakturering) förutsätter att state.timeEntries redan är populerad
     direkt efter att initState() returnerat, precis som tidigare när
     den kom från bulk-snapshoten. Ett nätverksfel lämnar
     state.timeEntries som en tom array (redan satt ovan) — fail-safe,
     aldrig ett kastat fel som skulle avbryta hela initState(). */
  if (typeof TimeEntriesReadService !== 'undefined') {
    try {
      const _teOk = await TimeEntriesReadService.fetchAndApply();
      /* STAGING-GRANSKNING 2026-11-11 (ChatGPT): ett console.error/warn
         räcker inte — ingen riktig användare ser konsolen. fetchAndApply()
         returnerar `false` (inget kastat fel) på en 404/nätverksfel vid
         den FÖRSTA laddningen efter inloggning, och state.timeEntries
         förblir då den redan förifyllda tomma arrayen — exakt samma utseende
         som en genuint tom, legitim lista. Återanvänder den befintliga
         showToast()-mekanismen (samma som showPersistConflictWarning redan
         använder) så inloggningen visar en SYNLIG varning istället för att
         tyst se ut som "inga tidposter finns". */
      if (_teOk === false && typeof showToast === 'function') {
        showToast('Kunde inte hämta tidposter just nu — listan kan vara ofullständig. Ladda om sidan för att försöka igen.', 8000);
      }
    }
    catch (e) { console.warn('[initState] TimeEntriesReadService.fetchAndApply() fel:', e); }
  }

  /* SÄKERHETSFYND V7: hämta state.workOrders via work-orders-list EF:en
     (server-sidig ao_view_own/ao_view_all-filtrering) — AWAIT:ad, av
     samma skäl som TimeEntriesReadService ovan (MyJobsPage/
     WorkOrdersPage/WorkOrderDetailPage förutsätter att state.workOrders
     redan är populerad direkt efter att initState() returnerat). Ett
     nätverksfel lämnar state.workOrders som en tom array (redan satt
     ovan) — fail-safe, aldrig ett kastat fel som avbryter initState(). */
  if (typeof WorkOrdersReadService !== 'undefined') {
    try {
      const _woOk = await WorkOrdersReadService.fetchAndApply();
      /* Samma motivering som TimeEntriesReadService ovan. */
      if (_woOk === false && typeof showToast === 'function') {
        showToast('Kunde inte hämta arbetsordrar just nu — listan kan vara ofullständig. Ladda om sidan för att försöka igen.', 8000);
      }
    }
    catch (e) { console.warn('[initState] WorkOrdersReadService.fetchAndApply() fel:', e); }
  }
}

/**
 * Spara hela state — localStorage direkt + Supabase (serialiserad, bekräftad skrivning).
 *
 * V48B3B0 R1 (kritisk data consistency-hotfix): tidigare satte persist() både
 * DataSync._lastSig OCH skickade Supabase-skrivningen helt fire-and-forget,
 * innan skrivningen någonsin bekräftats. Det race:et är verifierat och
 * dokumenterat i RAPPORT-RACE-VERIFIERING.md/run-race-repro.js — en pågående
 * DataSync-poll kunde då applicera en förlegad remote-snapshot rakt över en
 * precis skapad, ännu obekräftad lokal offert och radera den permanent,
 * inklusive att newId() sedan återanvände det "försvunna" ID:t.
 *
 * Fixen har tre delar, se RAPPORT-V48B3B0-R1.md för fullständig motivering:
 *   1. persist() är nu serialiserad via en enkel promise-kö (_persistQueue,
 *      samma etablerade mönster som _notifPersistQueue/persistNotifs() i
 *      denna fil) — två persist()-anrop kan aldrig skicka sina Supabase-
 *      writes i parallell/omvänd ordning.
 *   2. DataSync._pendingWrites/_localWriteGeneration ökas SYNKRONT här,
 *      innan någon await — DataSync._poll() kontrollerar båda före den
 *      någonsin applicerar en remote-snapshot (se DataSync._poll()).
 *   3. DataSync._lastSig sätts ENDAST efter en BEKRÄFTAD lyckad
 *      server-write — aldrig optimistiskt innan, vilket var precis den
 *      falska "redan synkad"-signalen som lurade den ursprungliga pollen
 *      att fortsätta trots att skrivningen ännu inte fanns server-sidigt.
 *
 * Returnerar en Promise<boolean> som ALDRIG rejectar (alla fel fångas och
 * ger `false`) — så de ~200 befintliga anropsställena som gör `persist();`
 * utan att invänta returvärdet fortsätter fungera oförändrat, utan risk för
 * unhandled promise rejections. Nya/kritiska anropsställen (t.ex.
 * OffersPage._save()) kan göra `const ok = await persist();` och agera på
 * resultatet.
 */
var _persistQueue = Promise.resolve();

/* QA FIX-ROUND 2026-11-12 (C1) — per-key result, backward compatible.
   `persist()` (no argument — ~300 existing call sites) is UNCHANGED: it
   resolves to the same flat boolean as before (every changed key in the
   batch saved, nothing conflict-locked).
   `persist({keys: ['customers']})` resolves to a boolean about THOSE keys
   only: true unless one of them was rejected, conflicted, unverified, or
   is conflict-locked with an unsent change in this cycle. A rejection of
   an UNRELATED key in the same batch (e.g. `activityLog`, rejected on
   every write by its stored duplicate id — backlog C1, the cause of the
   false "Kunde inte spara kunden" and of the duplicate offer OFF-011) no
   longer reports the caller's own, genuinely saved, data as failed.
   `persist({detailed: true})` resolves to {ok, results, failedKeys,
   degraded?} for callers that want the whole picture.
   The flat result is deliberately NOT replaced by an object for plain
   `persist()`: an object is always truthy, so every existing
   `if (!ok)` check would silently stop detecting failures. */
function _vfPersistResultFor(detail, opts) {
  if (!detail || typeof detail !== 'object') detail = { ok: false, results: {}, failedKeys: [], error: true };
  if (opts && opts.detailed) return detail;
  if (opts && Array.isArray(opts.keys) && opts.keys.length) {
    if (detail.degraded || detail.error) return false;
    const r = detail.results || {};
    return opts.keys.every(function(k) { return !Object.prototype.hasOwnProperty.call(r, k) || r[k] === 'ok'; });
  }
  return !!detail.ok;
}

function persist(opts) {
  /* Måste ske SYNKRONT, före all await — annars hinner en poll som redan
     startat aldrig se att en lokal write är på väg. Se DataSync._poll(). */
  if (typeof DataSync !== 'undefined') {
    DataSync._pendingWrites = (DataSync._pendingWrites || 0) + 1;
    DataSync._localWriteGeneration = (DataSync._localWriteGeneration || 0) + 1;
  }
  /* The opts->boolean mapping happens INSIDE the chain, so `safeTask`
     below is still ONE promise shared by the caller and the queue (the
     R1.2 ordering invariant): a derived `.then()` here would let the
     next queued _doPersist() start before the caller's own continuation
     (e.g. a rollback) — exactly the bug R1.2 fixed. */
  /* T3-A: ändringen hör till den identitet som var inloggad när den gjordes.
     Har identiteten bytts innan kön hunnit hit skickas den inte. */
  const _owner = (typeof Auth !== 'undefined' && typeof Auth.ownerKey === 'function') ? Auth.ownerKey() : undefined;
  const task = _persistQueue.then(function() { return _doPersistDetailed(_owner); })
    .then(function(detail) { _vfWarnUnconfirmed(detail, opts); return _vfPersistResultFor(detail, opts); });
  /* V48B3B0 R1.2 (kritisk fix): EN och SAMMA promise (`safeTask`) används
     nu för både _persistQueue OCH returvärdet till callern — tidigare
     skapade `_persistQueue = task.catch(A)` och `return task.catch(B)` två
     SEPARATA reaction-kedjor på `task`. Per Promise/A+ körs reactions på
     samma promise i REGISTRERINGSORDNING — eftersom _persistQueue-grenen
     registrerades FÖRE retur-grenen, kunde nästa köade persist()-anrops
     `_persistQueue.then(...)`-fortsättning faktiskt köras FÖRE callerns
     egen `await persist()`-fortsättning (t.ex. OffersPage._save():s
     rollback vid fel) — verifierat, reproducerat och dokumenterat i
     RAPPORT-V48B3B0-R1.2.md. Det bröt R1/R1.1:s failure-invariant: en
     misslyckad, ännu ej tillbakarullad mutation kunde hinna serialiseras
     av en senare, lyckad köad write innan callern hunnit rulla tillbaka
     den ur state.offers/localStorage.
     Med EN delad `safeTask`: callerns `await persist()` (registrerat
     synkront, direkt vid anropet) och en SENARE persist()-anrops
     `_persistQueue.then(...)` (som med nödvändighet registreras EFTER,
     eftersom den bara kan ske efter att den förra callern redan fått sin
     egen väntande promise) körs garanterat i den ordningen — callerns
     fortsättning (och ev. rollback) FÖRE nästa köade writes start. */
  const safeTask = task.catch(function(e) {
    console.error('[persist] Ohanterat fel i persist-kön:', e);
    return (opts && opts.detailed) ? { ok: false, results: {}, failedKeys: [], error: true } : false;
  });
  /* Kön måste leva vidare även om detta specifika anrop misslyckas —
     annars fastnar alla senare persist()-anrop bakom ett permanent
     avvisat promise. safeTask rejectar aldrig (se catch ovan), så detta
     är redan säkert utan ytterligare .catch(). */
  _persistQueue = safeTask;
  return safeTask;
}

/* QA FIX-ROUND 2026-11-12 (C1): `_doPersist()` keeps its exact old
   contract (Promise<boolean>, the flat batch result) for any direct
   caller; the per-key detail lives in `_doPersistDetailed()`, which is
   what persist() now runs. One implementation, two views of its result. */
async function _doPersist() {
  const d = await _doPersistDetailed();
  return !!(d && d.ok);
}

async function _doPersistDetailed(_owner) {
  /* T3-A (SÄK-9): ingen skrivning utan giltig, aktuell session med åtkomst,
     och aldrig under en annan identitet än den som gjorde ändringen. */
  if (typeof Auth !== 'undefined' && typeof Auth.hasAccess === 'function') {
    const _blocked = !Auth.hasAccess() || (_owner !== undefined && Auth.ownerKey() !== _owner) ||
      (typeof Auth.assertSessionCurrent === 'function' && !Auth.assertSessionCurrent());
    if (_blocked || state._wiped) {
      console.error('[persist] BLOCKERAD: ingen giltig session/åtkomst för den identitet som gjorde ändringen.');
      return { ok: false, error: true, authBlocked: true, results: {}, failedKeys: [] };
    }
  }
  /* P0-INCIDENT-FIX (2026-11): blockera varje bred/generisk skrivning om
     senaste läsningen var degraderad (timeout/nätverksfel/fallback till
     localStorage). En tom/ofullständig lokal kopia får aldrig skrivas
     tillbaka som auktoritativ. Narrow, redan atomiska skrivvägar (AOTimeSyncService,
     work_order- och time_entry-RPC:erna m.fl.) berörs INTE av denna spärr
     — de beror inte på en föregående bulk-läsning. */
  if (state._degradedLoad) {
    console.error('[persist] BLOCKERAD: senaste läsningen var degraderad (fallback), ingen bulk-skrivning tillåten.');
    return { ok: false, degraded: true, results: {}, failedKeys: [] };
  }
  try {
    const _now = new Date().toISOString();
    const _persistAoCount = Array.isArray(state.workOrders) ? state.workOrders.filter(function(a) { return !a.deleted && !a.archived; }).length : 0;
    console.log('[persist] Sparar state — aktiva AO: ' + _persistAoCount + ' — ts: ' + _now);
    /* STAGING-GRANSKNING 2026-11-06 (fynd 2) — ERSÄTTER den tidigare
       helregister-`Storage.setAll([...])`-anropet (alla 27 generiska
       nycklar skickades VARJE gång, oavsett vad som faktiskt ändrats) med
       en diff-baserad, hash-skyddad, per-nyckel-skrivning — portad från det
       redan byggda/testade P0_FINAL_2026-11-04-mönstret (se dess egen,
       fullständiga motivering: att skicka en oförändrad, potentiellt
       inaktuell kopia av t.ex. `offers` bara eftersom en obesläktad
       `customers`-ändring triggade samma persist()-anrop kunde tyst skriva
       över en ANNAN sessions redan bekräftade, nyare ändring, eftersom
       ingenting om OFFERS data "sågs" ha ändrats ur DEN sparande sessionens
       (stale) synvinkel). En nyckel i konflikt-läge (`state._keyConflict`)
       försöks ALDRIG skrivas automatiskt igen — se loopen nedan. */
    let ok = true;
    const _failedKeys = [];
    const _staleKeys = [];
    const _conflictBlockedKeys = [];
    /* QA FIX-ROUND 2026-11-12 (C1): per-key outcome of THIS cycle, next to
       (never instead of) the flat `ok` above, which keeps its exact old
       meaning for DataSync._lastSig and for every caller of plain
       `persist()`. Values: 'ok' | 'failed' | 'conflict' | 'blocked' |
       'unverified'. A key absent from the map was unchanged this cycle
       (nothing to send) — see persist()'s `opts.keys` for how callers
       ask "did MY key save" without being failed by an unrelated key
       (in practice `activityLog`, rejected on every write by its stored
       duplicate id, backlog C1). */
    const _keyResults = {};
    for (const _shortKey of VIFT_BUSINESS_KEYS) {
      if (state._keyConflict[_shortKey]) {
        _conflictBlockedKeys.push(_shortKey);
        /* Reported only if this key has a real unsent local change; an
           untouched locked key is not "this caller's key failed". */
        if (JSON.stringify(state[_vfBusinessStateKey(_shortKey)]) !== state._keySnapshot[_shortKey]) _keyResults[_shortKey] = 'blocked';
        continue;
      }
      const _stateKey = _vfBusinessStateKey(_shortKey);
      const _value = state[_stateKey];
      const _snapshot = JSON.stringify(_value);
      if (_snapshot === state._keySnapshot[_shortKey]) continue; // oförändrad — skicka inte
      /* 2026-11-24: när servern stöder appendActivity skickas aktiviteter
         post för post (ActivityService) — aldrig hela listan härifrån
         (servern nekar den: append-only). */
      if (_shortKey === 'activityLog' && typeof ActivityService !== 'undefined' && ActivityService._append === true) { state._keySnapshot.activityLog = _snapshot; continue; }
      const _fullKey = 'vift_' + _shortKey;
      try { Storage._writeCache(Storage.prefix + _shortKey, _snapshot); } catch(e) {}

      /* ISSUE #1 FIX (2026-11-08, blocker e): array-shaped keys (every
         generic key except the single-object `settings`) go through an
         element-level three-way merge instead of a whole-array,
         whole-key hash-gated replace. This means an unrelated concurrent
         edit to a DIFFERENT customer/offer/etc. in the SAME array can
         never be discarded by this session's save, and is never even
         reported as a conflict — only a genuine same-element collision
         is. Object-shaped keys keep the original whole-value path below. */
      if (Array.isArray(_value)) {
        let _oldArr = [];
        try { _oldArr = JSON.parse(state._keySnapshot[_shortKey] || '[]') || []; } catch(e) { _oldArr = []; }
        if (!Array.isArray(_oldArr)) _oldArr = [];
        const _oldById = {};
        _oldArr.forEach(function(el) { if (el && el.id != null) _oldById[el.id] = el; });
        const _newIds = {};
        const _upserts = [];
        _value.forEach(function(el) {
          if (!el || el.id == null) return;
          _newIds[el.id] = true;
          const _old = Object.prototype.hasOwnProperty.call(_oldById, el.id) ? _oldById[el.id] : null;
          if (JSON.stringify(_old) !== JSON.stringify(el)) {
            _upserts.push({ id: String(el.id), data: el, previous: _old });
          }
        });
        // PR #2 REVIEW FIX (2026-11-08, blocker 1): a removal now carries
        // the element's own last-known value (`previous`), not just its
        // id — the server rejects (as a conflict, not a silent delete) a
        // removal whose current server value no longer matches what this
        // session last read, exactly like an update would be rejected.
        const _removals = Object.keys(_oldById)
          .filter(function(id) { return !_newIds[id]; })
          .map(function(id) { return { id: String(id), previous: _oldById[id] }; });

        if (_upserts.length === 0 && _removals.length === 0) {
          // Snapshot differed (e.g. array reorder) but no real element
          // change/removal — nothing meaningful to send.
          state._keySnapshot[_shortKey] = _snapshot;
          continue;
        }

        // PR #2 REVIEW FIX (2026-11-09, blocker B): capture what we're
        // about to send AND a true snapshot of the array as it stood right
        // before the network call starts (`_snapshot`, already computed
        // above as `state[_stateKey]`'s JSON at the moment we decided to
        // persist) — a fresh JSON.parse() clone, immune to any in-place
        // mutation the live `state[_stateKey]` might undergo while this
        // await is pending (see _vfMergeAuthoritativeWithInFlightEdits()
        // above). This is NOT `_oldArr` (that's the OLDER, prior-confirmed
        // baseline used only to compute what changed THIS cycle).
        let _preAwaitArr = [];
        try { _preAwaitArr = JSON.parse(_snapshot) || []; } catch(e) { _preAwaitArr = []; }
        if (!Array.isArray(_preAwaitArr)) _preAwaitArr = [];
        const _sentIds = {};
        _upserts.forEach(function(u) { _sentIds[u.id] = true; });
        _removals.forEach(function(r) { _sentIds[r.id] = true; });

        /* M4: durable record BEFORE the request leaves (see
           _vfJournalRecord()). Recording only; the request is unchanged. */
        _vfJournalRecord(_shortKey, _upserts, _removals);

        const _mergeWrite = await Storage.writeBusinessKeyMerge(_fullKey, _upserts, _removals);
        if (!_mergeWrite.ok) {
          console.error('[persist] merge-skrivning avvisad för ' + _fullKey + ':', _mergeWrite.error);
          ok = false; _failedKeys.push(_shortKey); _keyResults[_shortKey] = 'failed';
          /* N1: remember WHY, per key, for settlePersistFailure(). Read by
             the awaiting caller before the next queued cycle starts (R1.2
             ordering invariant). Does not change any return value. */
          _vfLastPersistFailure[_shortKey] = {
            kind: _vfClassifyWriteFailure(_mergeWrite), error: _mergeWrite.error || null, reason: _mergeWrite.reason || null,
            status: (typeof _mergeWrite.status === 'number') ? _mergeWrite.status : null,
            ids: Object.assign({}, _sentIds)
          };
          continue; // whole call failed (auth/forbidden/etc.) — leave local state as-is, retry next cycle
        }
        delete _vfLastPersistFailure[_shortKey];

        const _conflicts = (_mergeWrite.data && _mergeWrite.data.conflicts) || [];
        // PR #2 RE-REVIEW FIX (2026-11-09, finding A): tells the merge
        // function below which sent ids were REJECTED, so it never
        // blends a further in-flight edit onto a rejected id — see
        // _vfMergeAuthoritativeWithInFlightEdits() for why that distinct
        // case must never silently "win" over the conflict mechanism.
        const _conflictedIds = {};
        _conflicts.forEach(function(c) { _conflictedIds[c.id] = true; });
        // PR #2 REVIEW FIX (2026-11-08, blocker 2): the server's `current`
        // is now the ONLY source for state/snapshot after a merge-write —
        // never a client-side re-serialization of `state[_stateKey]`.
        // A re-serialization would miss elements another session added
        // or changed that THIS call never touched (e.g. B's concurrent
        // insert of a brand-new element while A was only updating one of
        // its own) — the next persist()'s diff would then run against a
        // baseline the server never actually confirmed, exactly the bug
        // the reviewer reproduced. If the server ever fails to return
        // `current` (should not happen after this fix — fail closed, not
        // closed-but-wrong): leave the snapshot untouched so the next
        // persist() re-diffs against the last known-good baseline instead
        // of silently adopting an unverified one.
        const _authoritative = _mergeWrite.data && Array.isArray(_mergeWrite.data.current)
          ? _mergeWrite.data.current : null;
        if (_conflicts.length > 0) {
          ok = false; // a partial conflict is never a silent full success
          state._keyElementConflictDraft[_shortKey] = state._keyElementConflictDraft[_shortKey] || {};
          _conflicts.forEach(function(c) {
            const _localUpsert = _upserts.find(function(u) { return u.id === c.id; });
            const _localRemoval = !_localUpsert && _removals.find(function(r) { return r.id === c.id; });
            /* PR #2 RE-REVIEW FIX (2026-11-09, blocker A): record the REAL
               intent (upsert vs delete), never a bare value. A delete
               conflict has no `.data` — the old code fell back to
               `.previous` (the stale pre-delete value) with no record that
               the actual intent was deletion, which let "keep my change"
               in resolveElementConflict() silently resurrect that stale
               value on top of another session's newer write. See
               resolveElementConflict() above for the other half of this
               fix. */
            /* QA FIX-ROUND 2026-11-12 (M2, confirmed): `_localUpsert.data`
               IS the live element object of state[_stateKey] (see the
               `_value.forEach` above — `data: el`). Stored as-is, the
               draft aliased the live object, so a caller's own rollback
               after the failed save (CustomersPage._doSave():
               Object.assign(result.customer, result.before)) rewrote the
               stored draft too, and "Behåll min ändring" then resubmitted
               the PRE-edit element: the user's edit was lost AND another
               session's already-saved field on the same element was
               reverted. The draft is now an independent deep clone taken
               at the moment the conflict is recorded, and carries `base`
               (the element as this session last confirmed it, i.e. the
               `previous` the server rejected) so resolveElementConflict()
               can re-apply only the fields this session changed. */
            if (_localUpsert) {
              state._keyElementConflictDraft[_shortKey][c.id] = {
                op: 'upsert', value: _vfDeepClone(_localUpsert.data), base: _vfDeepClone(_localUpsert.previous)
              };
            } else if (_localRemoval) {
              state._keyElementConflictDraft[_shortKey][c.id] = { op: 'delete' };
            }
          });
          if (typeof App !== 'undefined' && App.showPersistConflictWarning) {
            try { App.showPersistConflictWarning(_shortKey, _conflicts.map(function(c) { return c.id; })); } catch(e2) {}
          }
        }
        if (_authoritative !== null) {
          /* PR #2 RE-REVIEW FIX (2026-11-09, blocker B): merge, don't
             blindly replace — see _vfMergeAuthoritativeWithInFlightEdits()
             above for the full rationale. Protects any local edit the user
             made to a DIFFERENT element in this same array while this
             write was in flight.

             Critical: the DISPLAYED state and the DIFF BASELINE must stay
             separate here. `state[_stateKey]` gets the merged array (so an
             in-flight edit never visually vanishes), but
             `state._keySnapshot[_shortKey]` is set from `_authoritative`
             ALONE — never the merged value. If the snapshot absorbed the
             still-unsent in-flight edit too, the NEXT persist() cycle would
             see zero diff for that element and silently never send it to
             the server at all — the exact failure this fix exists to
             prevent, just deferred by one cycle instead of happening
             immediately. */
          const _liveNow = state[_stateKey];
          const _merged = _vfMergeAuthoritativeWithInFlightEdits(_authoritative, _preAwaitArr, _liveNow, _sentIds, _conflictedIds);
          state[_stateKey] = _merged;
          state._keySnapshot[_shortKey] = JSON.stringify(_authoritative);
          /* M4: the server applied every sent, non-conflicted id — those
             journal entries are done. Conflicted ids stay journaled until
             the user resolves the conflict (resolveElementConflict()). */
          Object.keys(_sentIds).forEach(function(id) { if (!_conflictedIds[id]) _vfJournalForget(_shortKey, id); });
          _keyResults[_shortKey] = _conflicts.length > 0 ? 'conflict' : 'ok';
        } else {
          console.error('[persist] merge-skrivning för ' + _fullKey + ' svarade utan auktoritativ \'current\' — baslinjen uppdateras INTE denna cykel');
          ok = false;
          _keyResults[_shortKey] = 'unverified';
          // N1: a 200 without `current` proves nothing either way -> re-check.
          _vfLastPersistFailure[_shortKey] = { kind: 'uncertain', error: 'unverified', status: null, ids: Object.assign({}, _sentIds) };
        }
        if (_conflicts.length > 0) _keyResults[_shortKey] = 'conflict';
        continue;
      }

      /* T4-A (D-17, SEC-INST-04/05): inställningarna sparas FÄLT FÖR FÄLT (writeMerge med fältnamn
         som id och senast lästa värde som previous). Servern sammanfogar under radlås: samtidiga
         ändringar av olika fält tappas aldrig, samma fält ger en konflikt (ingen tyst överskrivning),
         och skyddade fält som användaren inte får läsa (intern timkostnad utan cost_view) eller ändra
         (bankgiro utan bankgiro_edit) bevaras. Äldre klienter (v3.4) skriver fortfarande hela värdet;
         servern bevarar de skyddade fälten även då. */
      if (_shortKey === 'settings' && _value && typeof _value === 'object' && !Array.isArray(_value)) {
        let _oldS = {};
        try { _oldS = JSON.parse(state._keySnapshot[_shortKey] || '{}') || {}; } catch(e) { _oldS = {}; }
        if (!_oldS || typeof _oldS !== 'object' || Array.isArray(_oldS)) _oldS = {};
        const _has = function(o, f) { return Object.prototype.hasOwnProperty.call(o, f) && o[f] !== undefined; };
        const _sUps = [], _sRems = [];
        Object.keys(_value).forEach(function(f) {
          if (_value[f] === undefined) return;
          if (JSON.stringify(_value[f]) !== JSON.stringify(_oldS[f])) _sUps.push({ id: f, data: _value[f], previous: _has(_oldS, f) ? _oldS[f] : null });
        });
        Object.keys(_oldS).forEach(function(f) { if (!_has(_value, f) && _has(_oldS, f)) _sRems.push({ id: f, previous: _oldS[f] }); });
        if (_sUps.length === 0 && _sRems.length === 0) { state._keySnapshot[_shortKey] = _snapshot; continue; }
        const _sw = await Storage.writeBusinessKeyMerge(_fullKey, _sUps, _sRems);
        if (!_sw.ok) {
          console.error('[persist] fältvis skrivning av inställningar avvisad:', _sw.error, _sw.reason || '');
          ok = false; _failedKeys.push(_shortKey); _keyResults[_shortKey] = 'failed';
          _vfLastPersistFailure[_shortKey] = {
            kind: _vfClassifyWriteFailure(_sw), error: _sw.error || null, reason: _sw.reason || null,
            status: (typeof _sw.status === 'number') ? _sw.status : null, ids: {}
          };
          continue;
        }
        delete _vfLastPersistFailure[_shortKey];
        const _sConf = (_sw.data && _sw.data.conflicts) || [];
        const _sCur = _sw.data && _sw.data.current && typeof _sw.data.current === 'object' && !Array.isArray(_sw.data.current) ? _sw.data.current : null;
        if (_sCur) {
          /* Serverns (projicerade) värde blir både tillstånd och baslinje; ett fält i konflikt får
             den andra sessionens värde och användaren varnas (ändringen kan göras om). */
          state[_stateKey] = _vfDeepClone(_sCur);
          state._keySnapshot[_shortKey] = JSON.stringify(_sCur);
          delete state._keyHash[_shortKey];
        }
        if (_sConf.length > 0) {
          ok = false; _keyResults[_shortKey] = 'conflict';
          if (typeof App !== 'undefined' && App.showPersistConflictWarning) {
            try { App.showPersistConflictWarning(_shortKey, _sConf.map(function(c) { return c.id; })); } catch(e2) {}
          }
        } else {
          _keyResults[_shortKey] = _sCur ? 'ok' : 'unverified';
          if (!_sCur) ok = false;
        }
        continue;
      }

      /* Object-shaped key (settings): unchanged whole-value, hash-gated
         replace — a single object has no finer-grained element to merge. */
      let _expectedHash = state._keyHash[_shortKey];
      if (_expectedHash === undefined) {
        const _fallbackRead = await Storage.readBusinessKeyWithHash(_fullKey);
        _expectedHash = _fallbackRead.ok ? _fallbackRead.hash : null;
      }
      const _write = await Storage.writeBusinessKey(_fullKey, _value, _expectedHash);
      if (!_write.ok) {
        console.error('[persist] skrivning avvisad för ' + _fullKey + ':', _write.error);
        ok = false; _failedKeys.push(_shortKey);
        _keyResults[_shortKey] = _write.error === 'stale_write' ? 'conflict' : 'failed';
        if (_write.error === 'stale_write') {
          _staleKeys.push(_shortKey);
          state._keyConflictDraft[_shortKey] = _vfDeepClone(_value); // M2: never alias the live value
          state._keyConflict[_shortKey] = true;
          try {
            const _resync = await Storage.readBusinessKeyWithHash(_fullKey);
            if (_resync.ok) {
              state._keyHash[_shortKey] = _resync.hash;
              const _authoritative = (_resync.value !== undefined && _resync.value !== null)
                ? _resync.value : (Array.isArray(_value) ? [] : {});
              state[_stateKey] = _authoritative;
              state._keySnapshot[_shortKey] = JSON.stringify(_authoritative);
            }
          } catch(e) { console.warn('[persist] kunde inte omsynka baslinje efter stale_write för ' + _fullKey + ':', e); }
          if (typeof App !== 'undefined' && App.showPersistConflictWarning) {
            try { App.showPersistConflictWarning(_shortKey); } catch(e2) {}
          }
        }
        continue;
      }
      state._keyHash[_shortKey] = (_write.data && _write.data.newHash) || null;
      state._keySnapshot[_shortKey] = _snapshot;
      _keyResults[_shortKey] = 'ok';
    }
    /* En nyckel som fortfarande sitter konflikt-låst (ovan, `continue`:ad
       utan försök) FÅR ALDRIG döljas bakom ett övergripande `ok:true` —
       exakt den falska sparbekräftelsen P0-arbetet redan en gång rättade
       för AO-vägen, samma princip gäller den generiska vägen. */
    if (_conflictBlockedKeys.length > 0) ok = false;
    if (ok) {
      /* R1: lastSig sätts ENDAST efter bekräftad write — se filhuvud-
         kommentaren ovan för varför detta är kärnan i fixen. */
      if (typeof DataSync !== 'undefined') DataSync._lastSig = _now;
    } else {
      console.error('[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).');
      /* R1.1: Storage.setAll() ovan hann redan (synkront, före nätverkssvaret
         var känt) skriva DENNA misslyckade skrivnings _now-tidsstämpel till
         localStorage['vift_lastChanged']. Utan denna rad skulle den lokala
         cachen påstå en NYARE "sanning" än vad som faktiskt persisterats —
         och en offline initState()-fallback (Storage._localAll()) sätter
         DataSync._lastSig direkt från just den cachade signaturen (se
         initState(), rad ~154-155), vilket annars skulle sprida den aldrig
         bekräftade signaturen vidare. Återställ cachen till den senast
         BEKRÄFTADE signaturen (kan vara null om ingen write någonsin
         lyckats denna session — korrekt, då finns ingen bekräftad signatur). */
      if (typeof DataSync !== 'undefined') Storage.setLocal('lastChanged', DataSync._lastSig);
    }
    return {
      ok: ok,
      results: _keyResults,
      failedKeys: Object.keys(_keyResults).filter(function(k) { return _keyResults[k] !== 'ok'; })
    };
  } finally {
    if (typeof DataSync !== 'undefined') {
      DataSync._pendingWrites = Math.max(0, (DataSync._pendingWrites || 0) - 1);
    }
    _vfScheduleShortNumberReconcile(); // display-number clash repair, see newShortNumber()
    // N1: a held entry superseded by a newer confirmed save leaves the banner.
    if (state._vfHeldUnsaved && state._vfHeldUnsaved.length) { try { _vfRefreshHeldBanner(); } catch (e) {} }
  }
}

/* Spara bara notiser — anropas av NotificationsService.
   Serialiserad via _notifPersistQueue — aldrig parallella read/write-flöden.
   Använder Storage.getRemoteStrict() — ingen localStorage-fallback vid nätverksfel. */
var _notifPersistQueue = Promise.resolve();

function persistNotifs() {
  _notifPersistQueue = _notifPersistQueue
    .then(function() { return _doNotifPersist(); })
    .catch(function(e) { console.warn('[persistNotifs] queue-fel:', e); });
}

async function _doNotifPersist() {
  const now = new Date().toISOString();
  var result;
  try {
    result = await Storage.getRemoteStrict('notifications');
  } catch(e) {
    console.warn('[persistNotifs] remote-läsning misslyckades — skriver inte:', e);
    return;
  }
  var toWrite;
  if (result.found && Array.isArray(result.value)) {
    /* Giltig remote-array: merge (lokal read-status vinner, nya EF-notiser bevaras) */
    const localMap = new Map((state.notifications || []).map(function(n) { return [n.id, n]; }));
    const merged = (state.notifications || []).slice();
    for (var i = 0; i < result.value.length; i++) {
      if (!localMap.has(result.value[i].id)) merged.push(result.value[i]);
    }
    merged.sort(function(a, b) { return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(); });
    toWrite = merged.slice(0, 5000);
    state.notifications = toWrite;
  } else if (result.found) {
    /* Oväntat format — skriv INTE för att inte radera data */
    console.warn('[persistNotifs] oväntat format — skriver inte:', typeof result.value);
    return;
  } else {
    /* Ingen rad finns — skriv lokal array som startvärde */
    toWrite = state.notifications || [];
  }
  try {
    await Storage.setRemoteStrict([['notifications', toWrite], ['lastChanged', now]]);
    if (typeof DataSync !== 'undefined') DataSync._lastSig = now;
  } catch(e) {
    console.warn('[persistNotifs] remote-skrivning misslyckades:', e);
  }
}

/* ── P0-1 FIX (2026-10-18, independent-reviewer regression) ──────────
 * reconcilePendingAoTime(canonicalArr, previousArr, entityType)
 *
 * `DataSync._poll()` (and, before this fix, the initial `initState()`
 * load too) wholesale-replaced `state.workOrders`/`state.timeEntries`
 * with whatever the server snapshot said — EXACTLY the same bug class
 * already found and fixed for `ronderingspass` (`LiveSync` doing a
 * wholesale array replace instead of a merge), just missed for the
 * AO/time poll path. Reproduced by an independent reviewer: an
 * optimistic `{id:'AO-TEST-NEW', _pendingSync:true}` AO, still in
 * `AOTimeSyncService`'s durable outbox (not yet ACKed), was silently
 * DROPPED the moment a poll's server snapshot — which doesn't have it
 * yet — replaced the array.
 *
 * Fix: for every id still in the outbox for this entityType
 * (`AOTimeSyncService.listUnsynced()`) that the FRESH canonical array
 * does NOT (yet) contain, keep it:
 *   1. If `previousArr` (the array in `state` right before this
 *      replacement) already has an object with that id, carry forward
 *      THE SAME OBJECT REFERENCE (not a clone) — `WorkOrderService.
 *      create()`/`TimeService.clockOut()`'s own `onSettled` closures
 *      close over that exact object and mutate `_pendingSync`/
 *      `_syncFailed` on it directly; losing identity here would leave
 *      a permanently-stuck-looking pending badge on an orphaned clone
 *      that is no longer the object actually rendered.
 *   2. Otherwise (e.g. a fresh `initState()` after a reload — the
 *      in-memory object from before the reload no longer exists at
 *      all) reconstruct a minimal stand-in from the outbox entry's own
 *      payload via `AOTimeSyncService.getPendingCreateObject()` — the
 *      only other place that data still exists, since pending AO/time
 *      objects are deliberately never written into the generic
 *      `state.js` persist()-bundle (see `_doPersist()`'s own comment).
 * BLOCKER-1 FIX (independent-reviewer regression, round 3): the
 * original version of this function took an early return the instant
 * the canonical snapshot already contained a record for this id —
 * correct for a pending CREATE (the server now has it, nothing more to
 * do), but WRONG for a pending EDIT (patch_ao/patch_time) to an
 * EXISTING record: the canonical snapshot can legitimately be STALE
 * relative to an edit still sitting unflushed in the outbox (network
 * slow/offline since the edit was made), and blindly taking the
 * canonical record in that case visually REVERTS the user's own
 * not-yet-ACKed edit the instant a poll runs — a real UI-trust
 * violation (the patch itself was never lost — see
 * AOTimeSyncService's own outbox — only the VISIBLE state briefly lied
 * about it). Fixed: for an id with ANY pending outbox entry (create OR
 * patch, via `AOTimeSyncService.hasPendingEntry()`), ALWAYS prefer
 * showing "what the user last saw" over the fresh canonical record,
 * for as long as that outbox entry exists — exactly the same
 * create-vs-canonical-arrival swap this function already did, just no
 * longer gated behind "id not yet in canonical array":
 *   1. If `previousArr` already has the (already-patched, by the
 *      calling page) in-memory object for this id, keep that SAME
 *      object reference (identity-preserving, see the note above on
 *      `onSettled` closures).
 *   2. Otherwise (fresh reload, no in-memory copy survives) reconstruct
 *      by merging the outbox's pending PATCH fields
 *      (`getPendingPatchFields()`) on top of whatever canonical record
 *      exists (or the pending CREATE payload if the id isn't canonical
 *      yet either) — "best known state", never a blank/reverted stand-in.
 * The moment the outbox entry actually clears (ACKed and removed, by
 * `_sendOne()`), `hasPendingEntry()`/`listUnsynced()` stop reporting it
 * and the canonical snapshot is used outright on the very next
 * reconciliation call — no double-apply, no stale flag left behind.
 *
 * Deliberately NOT extended to pending DELETE (`delete_ao`/`delete_time`)
 * — out of this fix's scope; a pending delete still shows the canonical
 * (not-yet-deleted) record until the delete ACKs, unchanged prior
 * behavior, not reported as a problem.
 *
 * Covers both failure modes an independent reviewer was asked to
 * reproduce: "response lost before commit" (server never got it — stays
 * pending, outbox keeps retrying, this function keeps it visible) and
 * "response lost after commit" (server committed it, but the client's
 * own HTTP response never arrived — the NEXT poll's snapshot will
 * contain the canonical record, outbox's own idempotent retry will get
 * a 200 and self-clear) — see tests/js/ao_time_poll_reconciliation_tests.js
 * for both (creates) and the SAME two failure modes for EDITS, plus the
 * reload/restart scenario, for both. */
function reconcilePendingAoTime(canonicalArr, previousArr, entityType) {
  if (!Array.isArray(canonicalArr)) canonicalArr = [];
  if (typeof AOTimeSyncService === 'undefined' || typeof AOTimeSyncService.listUnsynced !== 'function') {
    return canonicalArr;
  }
  var pendingIds = AOTimeSyncService.listUnsynced(entityType) || [];
  if (!pendingIds.length) return canonicalArr;

  var byId = {};
  canonicalArr.forEach(function(x) { if (x && x.id) byId[x.id] = x; });

  var prevById = {};
  (previousArr || []).forEach(function(x) { if (x && x.id) prevById[x.id] = x; });

  var merged = canonicalArr.slice();
  var indexById = {};
  merged.forEach(function(x, i) { if (x && x.id) indexById[x.id] = i; });

  pendingIds.forEach(function(id) {
    var hasCanonical = Object.prototype.hasOwnProperty.call(byId, id);
    var keep;

    if (hasCanonical) {
      // The id already exists server-side. This is EITHER (a) a pending
      // CREATE that has now landed — canonical wins outright, nothing to
      // override, the outbox entry will self-clear on its own retry — OR
      // (b) a genuinely pending EDIT (patch_ao/patch_time) whose fields
      // the canonical snapshot may not reflect yet (Blocker-1 fix).
      // Distinguish by checking for pending PATCH fields SPECIFICALLY —
      // NOT just "does a previous in-memory object exist", because a
      // landed CREATE also has a previous in-memory object (the
      // optimistic one from create()), and that stale copy must NOT win
      // over the richer, server-confirmed canonical record once the
      // create has actually landed.
      var patchFields = (typeof AOTimeSyncService.getPendingPatchFields === 'function')
        ? AOTimeSyncService.getPendingPatchFields(entityType, id) : null;
      if (!patchFields) return; // no pending EDIT for this id — canonical stands, nothing to do
      if (prevById[id]) {
        keep = prevById[id]; // identity-preserving — same object the caller's onSettled closure mutates
      } else {
        keep = Object.assign({}, byId[id], patchFields, { _pendingSync: true });
      }
      merged[indexById[id]] = keep; // replace in place — same array position
    } else {
      // Pending CREATE not yet in canonical — original logic, unchanged.
      keep = prevById[id];
      if (!keep) {
        var obj = AOTimeSyncService.getPendingCreateObject(entityType, id);
        if (obj) keep = Object.assign({}, obj, { _pendingSync: true });
      }
      if (keep) merged.push(keep);
    }
  });
  return merged;
}

/* ── Hjälpfunktioner ──────────────────── */

function newId(arr, prefix) {
  if (!arr || arr.length === 0) return `${prefix}-001`;
  const nums = arr
    .map(x => parseInt((x.id || '').replace(/[^0-9]/g, ''), 10))
    .filter(n => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

/* QA FIX-ROUND 2026-11-12 (K3, live-reproduced: two sessions created the
   same `K-007` at the same moment). newId() above is "highest existing +
   1" computed from THIS session's possibly stale copy, so two sessions
   creating concurrently get the same id. Same fix as work orders
   (WorkOrderService._newAoId()): a collision-safe random id, assigned
   once, never renumbered. Trade-off (same as already accepted for AOs and
   time entries): the id is long. `existing` is an optional array checked
   for the (astronomically unlikely) clash. newId() itself is kept for the
   entities not switched in this round. */
function newSafeId(prefix, existing) {
  for (let i = 0; i < 5; i++) {
    const id = prefix + '-' + ((typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
    if (!Array.isArray(existing) || !existing.some(function(x) { return x && x.id === id; })) return id;
  }
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

/* DISPLAY NUMBER (2026-11-12, follow-up to K3). newSafeId() made new
   customer/property/property-object ids collision-safe but long
   ("K-3f2a1b4c-9e21-..."), and those ids were shown as visible labels.
   The id stays exactly as it is (internal key: routing, customerId/
   propertyId/objectId references). Visible labels use displayNumberOf():
     - rec.shortNumber, set once at creation by newShortNumber();
     - else, for a long collision-safe id without one (created after K3 but
       before this fix), a short number derived from that id at read time
       (salt 0, nothing written);
     - else rec.id, i.e. every existing short-id record ("K-007",
       "OBJ-012") shows exactly what it showed before. No migration.
   The short number is DERIVED FROM THE ID (FNV-1a hash -> 5 digits,
   10000-99999), never "highest existing + 1": two sessions creating at
   the same moment derive from two different UUIDs. A clash with a number
   already in this session's view is resolved by re-hashing with the next
   salt (deterministic). A clash only visible after a sync (two sessions,
   each with a momentarily stale view) is repaired by
   _vfReconcileShortNumbers(): only `shortNumber` of one record changes,
   never an id. */
const _VF_SHORTNUM_MIN = 10000;
const _VF_SHORTNUM_SPAN = 90000;
const _vfShortNumberOwned = new Set();     // ids created by THIS session (in memory only)
const _vfShortNumberFixTries = {};         // id -> repair attempts this session (bounded)
let _vfShortNumberReconcileTimer = null;

function _vfFnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* True for ids made by newSafeId() (UUID or its time+random fallback);
   false for legacy short ids such as "K-007", "KU-012", "OBJ-001". */
function _vfIsSafeId(id) {
  const m = /^[A-Za-z]+-([0-9A-Za-z-]+)$/.exec(String(id == null ? '' : id));
  return !!m && m[1].length >= 12 && !/^[0-9]+$/.test(m[1]);
}

/* existingShortNumbers: Set or array of display numbers already in use
   (compared case-insensitively). Same id + same set -> same result. */
function _vfShortNumberFromUuid(uuid, existingShortNumbers) {
  const id = String(uuid == null ? '' : uuid);
  const pm = /^([A-Za-z]+)-/.exec(id);
  const prefix = pm ? pm[1] + '-' : '';
  const used = new Set();
  if (existingShortNumbers) Array.from(existingShortNumbers).forEach(function(n) { if (n != null) used.add(String(n).toUpperCase()); });
  for (let salt = 0; salt < 1000; salt++) {
    const cand = prefix + (_VF_SHORTNUM_MIN + (_vfFnv1a(salt + '|' + id) % _VF_SHORTNUM_SPAN));
    if (!used.has(cand.toUpperCase())) return cand;
  }
  /* Unreachable in practice (1000 consecutive taken candidates): a longer,
     still id-derived, code rather than a duplicate. */
  return prefix + _vfFnv1a(id).toString(36).toUpperCase() + _vfFnv1a('x|' + id).toString(36).toUpperCase();
}

function displayNumberOf(rec) {
  if (!rec) return '';
  if (rec.shortNumber) return String(rec.shortNumber);
  const id = rec.id == null ? '' : String(rec.id);
  if (_vfIsSafeId(id)) return _vfShortNumberFromUuid(id, null);
  return id;
}

function _vfDisplayNumbersIn(arr, exceptId) {
  const s = new Set();
  (Array.isArray(arr) ? arr : []).forEach(function(r) {
    if (r && r.id !== exceptId) s.add(displayNumberOf(r).toUpperCase());
  });
  return s;
}

/* Called once, at creation, right after newSafeId(). Registers the id as
   created by this session (the repair path below only touches those). */
function newShortNumber(id, existingArr) {
  _vfShortNumberOwned.add(id);
  return _vfShortNumberFromUuid(id, _vfDisplayNumbersIn(existingArr, id));
}

/* Post-sync repair of a cross-session clash. Deterministic winner: a
   record without its own shortNumber (legacy id / read-time number) first,
   then earliest createdAt, then id. Each losing record is renumbered only
   by the session that created it, so exactly one session writes and only
   that record's `shortNumber` changes. Returns [{key,id,from,to}]. */
const _VF_SHORTNUM_KEYS = ['customers', 'properties', 'propertyObjects'];
function _vfReconcileShortNumbers() {
  const changes = [];
  if (_vfShortNumberOwned.size === 0) return changes;
  _VF_SHORTNUM_KEYS.forEach(function(key) {
    const arr = state[key];
    if (!Array.isArray(arr) || (state._keyConflict && state._keyConflict[key])) return;
    const groups = {};
    arr.forEach(function(r) {
      if (!r || r.deleted) return;
      const n = displayNumberOf(r).toUpperCase();
      (groups[n] = groups[n] || []).push(r);
    });
    Object.keys(groups).forEach(function(n) {
      const g = groups[n];
      if (g.length < 2) return;
      g.sort(function(a, b) {
        const ao = a.shortNumber ? 1 : 0, bo = b.shortNumber ? 1 : 0;
        if (ao !== bo) return ao - bo;
        const ac = String(a.createdAt || ''), bc = String(b.createdAt || '');
        if (ac !== bc) return ac < bc ? -1 : 1;
        return String(a.id) < String(b.id) ? -1 : 1;
      });
      g.slice(1).forEach(function(r) {
        if (!r.shortNumber || !_vfShortNumberOwned.has(r.id)) return;
        _vfShortNumberFixTries[r.id] = (_vfShortNumberFixTries[r.id] || 0) + 1;
        if (_vfShortNumberFixTries[r.id] > 3) return;
        const from = r.shortNumber;
        r.shortNumber = _vfShortNumberFromUuid(r.id, _vfDisplayNumbersIn(arr, r.id));
        changes.push({ key: key, id: r.id, from: from, to: r.shortNumber });
      });
    });
  });
  if (changes.length) {
    const keys = Array.from(new Set(changes.map(function(c) { return c.key; })));
    console.warn('[shortNumber] cross-session clash repaired:', changes);
    persist({ keys: keys });
  }
  return changes;
}

/* Runs the repair after a confirmed write / applied poll, outside the
   persist chain. No-op unless this session created something. */
function _vfScheduleShortNumberReconcile() {
  if (_vfShortNumberOwned.size === 0 || _vfShortNumberReconcileTimer) return;
  _vfShortNumberReconcileTimer = setTimeout(function() {
    _vfShortNumberReconcileTimer = null;
    try { _vfReconcileShortNumbers(); } catch (e) { console.warn('[shortNumber] reconcile failed:', e); }
  }, 0);
}

/* E2E PERF-01 (2026-11-23): uppslagningarna nedan anropas per rad i listor
   (AO-listan med 3 000 AO och 2 000 kunder/3 000 fastigheter: ~1 s av
   2 s renderingstid i linjär find()). Ett id→index-register per array
   byggs om när arrayen byts ut eller ändrar längd, och varje träff
   kontrolleras (arr[i].id === id) — vid minsta avvikelse används samma
   linjära sökning som förut. Semantiken är oförändrad: första elementet
   med exakt samma id (===), annars null. */
var _vfIdx = {};
function _vfFindById(arr, id, cacheKey) {
  if (!Array.isArray(arr)) return null;
  let c = _vfIdx[cacheKey];
  if (!c || c.arr !== arr || c.len !== arr.length) {
    c = _vfIdx[cacheKey] = { arr: arr, len: arr.length, map: new Map() };
    for (let i = arr.length - 1; i >= 0; i--) { const el = arr[i]; if (el && el.id !== undefined && el.id !== null) c.map.set(el.id, i); }
  }
  const i = c.map.get(id);
  if (i !== undefined) { const el = arr[i]; if (el && el.id === id) return el; }
  const found = arr.find(x => x && x.id === id) || null;
  if (found) c.len = -1; // registret var inaktuellt — bygg om vid nästa anrop
  return found;
}
function getCu(id)   { return _vfFindById(state.customers, id, 'customers'); }
function getAO(id)   { return _vfFindById(state.workOrders, id, 'workOrders'); }
function getOff(id)  { return _vfFindById(state.offers, id, 'offers'); }
function getInv(id)  { return _vfFindById(state.invoices, id, 'invoices'); }
function getObj(id)  { return _vfFindById(state.properties, id, 'properties'); }
function getSO(id)   { return _vfFindById(state.salesOpportunities, id, 'salesOpportunities'); }
function getStaff(id){ return _vfFindById(state.staff, id, 'staff'); }
function getMall(id)  { return state.ronderingsmallar.find(m => m.id === id) || null; }
function getRon(id)   { return state.ronderingar.find(r => r.id === id) || null; }
function getAvv(id)   { return state.avvikelser.find(a => a.id === id) || null; }
function getPass(id)    { return state.ronderingspass.find(p => p.id === id) || null; }
function getPropObj(id) { return state.propertyObjects.find(o => o.id === id) || null; }
function getProject(id)  { return (state.projects||[]).find(p => p.id === id) || null; }

/* V3: lokalt datum (Europe/Stockholm på användarens enhet), inte UTC.
   Tidigare gav toISOString() gårdagens datum mellan midnatt och 01:00
   (02:00 sommartid) — "Idag", "försenad" och förvalda datum blev fel. */
function _localYmd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function tdy() {
  return _localYmd(new Date());
}

function _ds(days) {
  const d = new Date();
  return _localYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

function fmt(n) {
  return Number(n || 0).toLocaleString('sv-SE');
}

function fkr(n) {
  return Number(n || 0).toLocaleString('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 });
}

function cap(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* Unikt id för poster som flera enheter kan skapa samtidigt (AO-loggposter).
   Tidigare prefix + Date.now(): två enheter under samma millisekund fick
   samma id och servern behöll bara den ena (E2E AO-07C, 2026-11-23). */
function newEntryId(prefix) {
  var r = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return String(prefix || '') + Date.now() + '-' + r;
}

function relDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH   = Math.floor(diffMs / 3600000);
  const diffD   = Math.floor(diffMs / 86400000);
  if (diffMin < 2)  return 'Just nu';
  if (diffMin < 60) return `${diffMin} min sedan`;
  if (diffH < 24)   return `${diffH} tim sedan`;
  if (diffD === 1)  return 'Igår';
  if (diffD < 7)    return `${diffD} dagar sedan`;
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

function esc(s) {
  /* QA 2026-11-24 (QA-P0-3): tål tal och andra icke-strängar (t.ex. numeriskt
     postnummer) nu när alla HTML-sänkor för fritext går via esc(); null,
     undefined och false blir tom sträng som förut. Apostrof kodas också så
     att värden i '...'-attribut och onclick-strängar inte kan bryta sig ut. */
  if (s === null || s === undefined || s === false) return '';
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* Inbäddade bilder (data-URL) i delad data som andra användare kan skriva:
   rendera bara äkta base64-bilder, så ett manipulerat värde inte kan bryta
   sig ur ett src-attribut. */
function isSafeImageDataUrl(v) {
  return typeof v === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+\/=\s]+$/.test(v);
}

function fmtDate(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm' });
}

/* ── Status/prioritet-helpers ─────────── */
function statusLabel(s) {
  const m = {
    nytt: 'Nytt', pool: 'Arbetspool', planerad: 'Planerad',
    pågående: 'Pågående', klar: 'Klar', fakturerad: 'Fakturerad', avbruten: 'Avbruten',
    utkast: 'Utkast', skickad: 'Skickad', påmind: 'Påmind', väntar: 'Väntar svar',
    godkänd: 'Godkänd', nekad: 'Nekad', utgången: 'Utgången', ersatt: 'Ersatt',
    'ändring-begärd': 'Ändring begärd',
    betald: 'Betald', förfallen: 'Förfallen', makulerad: 'Makulerad',
    aktiv: 'Aktiv', pausad: 'Pausad', avslutad: 'Avslutad',
    new: 'Ny', contacted: 'Kontaktad', snoozed: 'Uppskjuten',
    won: 'Vunnen', lost: 'Förlorad', done: 'Klar', dismissed: 'Avvisad'
  };
  return m[s] || cap(s);
}

function statusClass(s) {
  const m = {
    nytt: 'bdg-blue', pool: 'bdg-purple', planerad: 'bdg-sky',
    pågående: 'bdg-orange', klar: 'bdg-green', fakturerad: 'bdg-grey',
    avbruten: 'bdg-grey', utkast: 'bdg-grey', skickad: 'bdg-blue',
    påmind: 'bdg-purple', väntar: 'bdg-orange', godkänd: 'bdg-green', nekad: 'bdg-red',
    utgången: 'bdg-grey', ersatt: 'bdg-grey', 'ändring-begärd': 'bdg-orange', betald: 'bdg-green', förfallen: 'bdg-red',
    makulerad: 'bdg-grey', aktiv: 'bdg-green', pausad: 'bdg-yellow',
    avslutad: 'bdg-grey', new: 'bdg-blue', contacted: 'bdg-sky',
    snoozed: 'bdg-yellow', won: 'bdg-green', lost: 'bdg-red',
    done: 'bdg-grey', dismissed: 'bdg-grey'
  };
  return m[s] || 'bdg-grey';
}

function priorityLabel(p) {
  return { akut: 'Akut', hög: 'Hög', normal: 'Normal', låg: 'Låg' }[p] || p;
}

function priorityClass(p) {
  return { akut: 'p-akut', hög: 'p-hog', normal: 'p-normal', låg: 'p-lag' }[p] || 'p-lag';
}

function sbdg(status) {
  /* V3: lugnt statusmärke — färgad punkt + text (designsystem, .bdg.st). */
  return `<span class="bdg st ${statusClass(status)}"><i class="st-dot" aria-hidden="true"></i>${statusLabel(status)}</span>`;
}

function pbdg(priority) {
  const cls   = { akut:'bdg-red', hög:'bdg-orange', normal:'bdg-grey', låg:'bdg-grey' }[priority] || 'bdg-grey';
  const icons = { akut:'alert-triangle', hög:'arrow-up', normal:'minus', låg:'arrow-down' };
  const ico = icons[priority];
  return `<span class="bdg ${cls}">${ico?ic(ico,11):''}${priorityLabel(priority)}</span>`;
}

/* ── LiveSync — polling för cross-device synk ─── */
const LiveSync = {
  _timer: null,
  _passId: null,
  _lastSig: null,

  start(passId) {
    this._passId = passId;
    this._lastSig = null;
    this.stop();
    this._timer = setInterval(function() { LiveSync._poll(); }, 4000);
  },

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  async _poll() {
    if (document.hidden) return;
    const page = typeof Router !== 'undefined' ? Router.currentPage : null;
    if (page !== 'pg-rondering-utfor' && page !== 'pg-rondering-rapport') { LiveSync.stop(); return; }
    if (!LiveSync._passId) return;
    try {
      const remote = await Storage.get('ronderingspass');
      if (!Array.isArray(remote)) return;
      const rp = remote.find(function(p) { return p.id === LiveSync._passId; });
      if (!rp) return;
      const sig = rp.updatedAt;
      if (sig === LiveSync._lastSig) return;
      const lp = getPass(LiveSync._passId);
      if (lp && lp.updatedAt === sig) { LiveSync._lastSig = sig; return; }
      LiveSync._lastSig = sig;
      // Spara osparad antecknings-text i textrutan innan vi byter ut state
      const noteEl = document.getElementById('pass-exec-note');
      const unsavedNote = noteEl ? noteEl.value : null;
      state.ronderingspass = remote;
      try { Storage._writeCache('vift_ronderingspass', JSON.stringify(remote)); } catch(e2) {}
      // Återställ osparad anteckning på det nya in-memory PASS-objektet
      if (unsavedNote !== null) {
        const np = getPass(LiveSync._passId);
        if (np) np.internalNote = unsavedNote;
      }
      if (page === 'pg-rondering-utfor' && typeof RonderingUtforandePage !== 'undefined') {
        RonderingUtforandePage._refresh();
      } else if (page === 'pg-rondering-rapport' && typeof RonderingRapportPage !== 'undefined') {
        RonderingRapportPage.render(Router.currentParams);
      }
    } catch(e) { /* network error — ignore */ }
  }
};

/*
 * DataSync — global cross-device synk för ALL appdata
 *
 * Polling var 15:e sekund mot en lättviktsnyckel (lastChanged).
 * Om timestamp ändrats av en annan enhet: hämta all data från Supabase,
 * uppdatera state, rendera om aktuell sida.
 *
 * Startas från App.showApp() i index.html när användaren är inloggad.
 * Egna persist()-skrivningar uppdaterar _lastSig och triggar INTE re-read.
 */
const DataSync = {
  _timer:   null,
  _lastSig: null,
  INTERVAL: 15000,

  start() {
    this.stop();
    this._timer = setInterval(function() { DataSync._poll(); }, DataSync.INTERVAL);
    console.log('[DataSync] Startar — pollar var', DataSync.INTERVAL / 1000, 's');
  },

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  /* R1: pending-write/generation-räknare, ökade synkront av persist() innan
     någon await — se persist() i denna fil. En poll som redan hunnit förbi
     sig-kontrollen (giltigt, av en ANNAN anledning) MÅSTE ändå kunna
     upptäcka och avbryta om en lokal write startar under de återstående
     await-punkterna nedan, annars kan den fortfarande applicera en
     förlegad snapshot ovanpå en färsk, ännu obekräftad lokal mutation. */
  _pendingWrites: 0,
  _localWriteGeneration: 0,

  _rerenderAfterAsyncApply() {
    try {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
      if (document.body.classList.contains('modal-open')) return;
      if (typeof Sidebar !== 'undefined') Sidebar.updateBadges();
      const page = typeof Router !== 'undefined' ? Router.currentPage : null;
      if (page && !DataSync._editorActive()) Router.showPage(page, Router.currentParams || {});
    } catch (e) { console.warn('[DataSync] omritning efter AO-hämtning misslyckades:', e); }
  },

  /* QA 2026-11-26: en redigeringsvy (offertguiden, importguiden, ny
     rondering eller en vy märkt data-unsaved) ritas inte om av synken.
     Tidigare ritades guiden om var 15:e sekund så fort inget fält hade
     fokus, och osparade ändringar i en befintlig offert försvann. Datan
     uppdateras ändå i state; vyn visar den nästa gång användaren byter sida. */
  _editorActive() {
    try {
      const page = typeof Router !== 'undefined' ? Router.currentPage : null;
      if (page === 'pg-import-wizard' || page === 'pg-rondering-wizard') return true;
      const act = document.querySelector('.page.active');
      if (!act) return false;
      return !!act.querySelector('.offw-steps, [data-unsaved="1"]');
    } catch (e) { return false; }
  },

  async _poll() {
    if (document.hidden) return;
    /* Avbryt om användaren skriver eller en modal är öppen */
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    if (document.body.classList.contains('modal-open')) return;
    /* R1: starta aldrig en ny pollcykel medan en lokal write pågår/köad. */
    if (DataSync._pendingWrites > 0) return;
    const startGeneration = DataSync._localWriteGeneration;
    /* T3-A: en poll som startade för en identitet appliceras aldrig efter
       att identiteten bytts/upphört under en await. */
    const _pollOwner = (typeof Auth !== 'undefined' && Auth.ownerKey) ? Auth.ownerKey() : null;
    const _sameOwner = function() { return typeof Auth === 'undefined' || !Auth.ownerKey || (Auth.hasAccess() && Auth.ownerKey() === _pollOwner); };
    if (!_sameOwner()) return;

    try {
      const sig = await Storage.get('lastChanged');
      if (!sig || sig === DataSync._lastSig) return;

      /* R1 (DEL 6, absolut krav): en lokal write kan ha startat under
         awaiten ovan — kontrollera igen innan vi ens hämtar full snapshot. */
      if (DataSync._pendingWrites > 0 || DataSync._localWriteGeneration !== startGeneration) {
        console.log('[DataSync] Avbryter poll — lokal write startade under GET lastChanged');
        return;
      }

      console.log('[DataSync] Fjärruppdatering detekterad (' + sig + ') — hämtar data…');
      /* PR #2 CONSOLIDATED FIX (2026-11-09, finding B): the old
         `Storage.getAll()` here was a plain, baseline-blind bulk read —
         it updated `state[...]` for every generic key but NEVER touched
         `state._keyHash`/`state._keySnapshot`, so a poll that picked up
         ANOTHER session's concurrent change left the DISPLAYED value and
         the DIFF BASELINE permanently out of sync for that key. The next,
         completely unrelated `persist()` would then see a spurious "local
         change" for a key this session never touched, and send a stale
         `previous`, producing a false `changed_by_other_session` conflict
         for data the user never edited. Fixed by using the SAME atomic
         data+hash call `initState()` already uses (`getAllWithHashes()`),
         for the SAME combined key set (write-allowlisted + read-only
         extras — see VIFT_READONLY_EXTRA_KEYS), and updating data+hash+
         snapshot together, per key, exactly like
         _vfSyncBusinessKeyBaselines() does at init time. */
      const _pollKeys = VIFT_BUSINESS_KEYS.concat(VIFT_READONLY_EXTRA_KEYS).map(function(k) { return 'vift_' + k; });
      const _pollCombined = await Storage.getAllWithHashes(_pollKeys);
      if (!_pollCombined.ok) {
        console.warn('[DataSync] poll: getAllWithHashes misslyckades:', _pollCombined.error);
        return;
      }
      const remote = _pollCombined.data || {};
      const pollHashes = _pollCombined.hashes || {};
      if (!_sameOwner()) return;

      /* R1 (DEL 6, absolut krav): kontrollera IGEN efter den andra
         await-gränsen — detta är exakt det fönster som orsakade den
         verifierade dataförlusten (se RAPPORT-RACE-VERIFIERING.md). */
      if (DataSync._pendingWrites > 0 || DataSync._localWriteGeneration !== startGeneration) {
        console.log('[DataSync] Avbryter poll — lokal write startade under GET all (den verifierade racefönstret)');
        return;
      }

      /* R1 (DEL 7): snapshot-koherens — om ytterligare en fjärrändring
         (t.ex. från en annan enhet) hann ske MELLAN de två läsningarna
         ovan kan lastChanged inuti denna snapshot skilja sig från den sig
         som utlöste cykeln. Applicera då inte en eventuellt inkonsekvent
         blandning — låt nästa poll (som ändå triggas av den nya sig:en)
         hämta en självkonsekvent snapshot istället. */
      if (remote['lastChanged'] !== sig) {
        console.log('[DataSync] Avbryter poll — lastChanged ändrades mellan de två läsningarna (' + sig + ' → ' + remote['lastChanged'] + ')');
        return;
      }

      DataSync._lastSig = sig;

      /* SÄKERHETSFYND V7 / BLOCKER-1: workOrders/timeEntries är INTE i
         _pollKeys (de ingår inte i VIFT_BUSINESS_KEYS eller
         VIFT_READONLY_EXTRA_KEYS — se state.js filhuvud) — hämtas
         fortsatt om via sina egna, server-sidigt filtrerande
         ReadServices, fire-and-forget, oförändrat av denna rättning. */
      if (typeof WorkOrdersReadService !== 'undefined') {
        /* 2026-11-23 (synkfel, reproducerat i E2E CHK-05/SYNC-AO-01): den
           asynkrona hämtningen blev ofta klar EFTER att sidan ritats om
           nedan — en annan enhets AO-ändring (t.ex. checklistpunkt) låg då
           i state men syntes inte förrän nästa omritning. Rita om när
           hämtningen faktiskt tillämpats (samma villkor som pollen själv:
           inte mitt i inmatning eller med öppen dialog). */
        WorkOrdersReadService.fetchAndApply().then(function(applied) {
          if (applied) DataSync._rerenderAfterAsyncApply();
        }).catch(function(e) {
          console.warn('[DataSync] WorkOrdersReadService.fetchAndApply() fel:', e);
        });
      }
      if (typeof TimeEntriesReadService !== 'undefined') {
        TimeEntriesReadService.fetchAndApply().catch(function(e) {
          console.warn('[DataSync] TimeEntriesReadService.fetchAndApply() fel:', e);
        });
      }

      /* Generiska, write-allowlistade nycklar: data+hash+snapshot
         uppdateras ATOMISKT, tillsammans, för var och en — en nyckel som
         sitter i ett olöst konflikt-läge (`state._keyConflict`) hoppas
         över helt (dess visade/osparade utkastvärde och baslinje rörs
         inte av en poll — det är användarens egen, ännu olösta konflikt
         att hantera, inte något en bakgrundssynk ska kunna skriva över). */
      VIFT_BUSINESS_KEYS.forEach(function(shortKey) {
        if (shortKey === 'staff' || shortKey === 'settings') return; // specialfall nedan
        if (state._keyConflict[shortKey]) return;
        var fullKey = 'vift_' + shortKey;
        var v = remote[shortKey];
        if (v === undefined || v === null) return;
        var stateKey = _vfBusinessStateKey(shortKey);
        state[stateKey] = v;
        state._keyHash[shortKey] = Object.prototype.hasOwnProperty.call(pollHashes, fullKey) ? pollHashes[fullKey] : null;
        state._keySnapshot[shortKey] = JSON.stringify(v);
      });

      /* Staff: strippa lösenordsfält — snapshot tas av den STRIPPADE
         kopian (samma princip som _vfSyncBusinessKeyBaselines()/
         initState(): baslinjen måste representera vad state.staff
         FAKTISKT innehåller, aldrig den råa server-kopian som fortfarande
         kan ha lösenordsfält, annars ser varje efterföljande persist()
         av staff ut som en lokal ändring den aldrig var). */
      if (!state._keyConflict['staff']) {
        var rawStaff = remote['staff'];
        if (Array.isArray(rawStaff)) {
          state.staff = rawStaff.map(function(s) {
            var clean = Object.assign({}, s);
            delete clean.password;
            delete clean.passwordHash;
            return clean;
          });
          state._keyHash['staff'] = Object.prototype.hasOwnProperty.call(pollHashes, 'vift_staff') ? pollHashes['vift_staff'] : null;
          state._keySnapshot['staff'] = JSON.stringify(state.staff);
        }
      }

      /* Settings är ett objekt — samma atomiska data+hash+snapshot-princip. */
      if (!state._keyConflict['settings'] && remote['settings'] && typeof remote['settings'] === 'object' && !Array.isArray(remote['settings'])) {
        state.settings = remote['settings'];
        state._keyHash['settings'] = Object.prototype.hasOwnProperty.call(pollHashes, 'vift_settings') ? pollHashes['vift_settings'] : null;
        state._keySnapshot['settings'] = JSON.stringify(remote['settings']);
      }

      /* Read-only extra-nycklar (finding C) — ingen baslinje att sätta,
         de går aldrig via den generiska skrivvägen; bara visningsvärdet
         uppdateras. */
      VIFT_READONLY_EXTRA_KEYS.forEach(function(shortKey) {
        var v = remote[shortKey];
        if (v !== undefined && v !== null) state[_vfBusinessStateKey(shortKey)] = v;
      });

      /* T3-A: personal/roller kan ha ändrats — behörigheterna tillämpas
         direkt (otillåten sida lämnas; utan åtkomst töms allt). */
      if (typeof Auth !== 'undefined' && typeof Auth.applyAuthorizationChange === 'function') {
        Auth.applyAuthorizationChange('sync');
        if (!_sameOwner()) return;
      }

      /* Uppdatera localStorage-cache (bara cachens ägare, se Storage._writeCache) */
      Object.entries(remote).forEach(function(entry) {
        try { Storage._writeCache('vift_' + entry[0], JSON.stringify(entry[1])); } catch(e) {}
      });

      /* Display-number clash repair (see newShortNumber()); before the
         re-render below so the repaired number is what gets shown. */
      try { _vfReconcileShortNumbers(); } catch (e) { console.warn('[shortNumber] reconcile failed:', e); }

      /* Uppdatera badge-räknare */
      if (typeof Sidebar !== 'undefined') Sidebar.updateBadges();

      /* Rendera om aktuell sida (om ingen modal är öppen) */
      var page = typeof Router !== 'undefined' ? Router.currentPage : null;
      if (page && typeof Router !== 'undefined' && !DataSync._editorActive()) {
        Router.showPage(page, Router.currentParams || {});
      }

      var aoCount = Array.isArray(state.workOrders) ? state.workOrders.filter(function(a){ return !a.deleted && !a.archived; }).length : 0;
      console.log('[DataSync] Synkat ' + new Date().toLocaleTimeString('sv-SE') + ' — aktiva AO: ' + aoCount + ' — sig: ' + sig);
    } catch(e) {
      console.warn('[DataSync] poll-fel:', e);
    }
  }
};

/* ── Overflow-meny för mobilverktygsfält ───────────────────────────────────
 * Enkla globala handlers (registreras en gång) — inga listener-läckor.
 * aoToggleOverflow(menuId, btn) — öppnar/stänger namngiven overflow-meny
 * aoCloseOverflow()             — stänger aktuell öppen meny (anropas av menyalternativ)
 * ─────────────────────────────────────────────────────────────────────────── */
var _aoCurrentMenu = null;
var _aoCurrentBtn  = null;

document.addEventListener('click', function(e) {
  if (!_aoCurrentMenu) return;
  if (!e.target.closest('.ao-overflow-wrap')) {
    _aoCurrentMenu.classList.remove('open');
    if (_aoCurrentBtn) _aoCurrentBtn.setAttribute('aria-expanded', 'false');
    _aoCurrentMenu = null;
    _aoCurrentBtn  = null;
  }
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && _aoCurrentMenu) {
    _aoCurrentMenu.classList.remove('open');
    if (_aoCurrentBtn) { _aoCurrentBtn.setAttribute('aria-expanded', 'false'); _aoCurrentBtn.focus(); }
    _aoCurrentMenu = null;
    _aoCurrentBtn  = null;
  }
});

function aoToggleOverflow(menuId, btn) {
  var menu = document.getElementById(menuId);
  if (!menu) return;
  var isOpen = menu === _aoCurrentMenu;

  // Stäng eventuell annan öppen meny
  if (_aoCurrentMenu && _aoCurrentMenu !== menu) {
    _aoCurrentMenu.classList.remove('open');
    if (_aoCurrentBtn) _aoCurrentBtn.setAttribute('aria-expanded', 'false');
    _aoCurrentMenu = null;
    _aoCurrentBtn  = null;
  }

  if (isOpen) {
    menu.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    _aoCurrentMenu = null;
    _aoCurrentBtn  = null;
  } else {
    menu.classList.add('open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    _aoCurrentMenu = menu;
    _aoCurrentBtn  = btn || null;
  }
}

function aoCloseOverflow() {
  if (_aoCurrentMenu) _aoCurrentMenu.classList.remove('open');
  if (_aoCurrentBtn)  _aoCurrentBtn.setAttribute('aria-expanded', 'false');
  _aoCurrentMenu = null;
  _aoCurrentBtn  = null;
}

// Cross-tab sync (same browser, storage event)
window.addEventListener('storage', function(e) {
  if (e.key !== 'vift_ronderingspass' || !e.newValue) return;
  try {
    const updated = JSON.parse(e.newValue);
    if (!Array.isArray(updated)) return;
    state.ronderingspass = updated;
    const page = typeof Router !== 'undefined' ? Router.currentPage : null;
    if (page === 'pg-rondering-utfor' && typeof RonderingUtforandePage !== 'undefined') {
      RonderingUtforandePage._refresh();
    } else if (page === 'pg-rondering-rapport' && typeof RonderingRapportPage !== 'undefined') {
      RonderingRapportPage.render(Router.currentParams);
    } else if (page === 'pg-rondering' && typeof RonderingPage !== 'undefined') {
      RonderingPage._renderTab();
    }
  } catch(e2) {}
});
