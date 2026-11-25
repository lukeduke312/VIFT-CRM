-- ============================================================
-- KANDIDAT, INTE BEVISAD HISTORISK SQL (G1/G4 del 2, 2026-11-27).
-- I STAGING har migrationen 20261108000001 en TOM statements-lista i
-- supabase_migrations.schema_migrations, så den SQL som faktiskt kördes
-- är okänd. Innehållet nedan är filen
--   staging-release/_staging_integration/server/migrations/20261108000001_staging_review_fixes.sql
-- (md5 ebd33705e4a06ca2b0f1528dad756122, oförändrad efter markören INNEHÅLL). Funktionskroppar och
-- policyer i drift har jämförts mot den, se
-- supabase/inventering/G1-G4-DEL2-RESULTAT.md, avsnittet om de tomma
-- migrationerna. Allt som avviker från drift rättas av de rekonstruerade
-- migrationerna 20261127*.
-- ============================================================
-- INNEHÅLL
-- VIFT CRM STAGING — issue #1 review fixes (2026-11-08)
-- Builds on 20261106000002/3 (generic-key write lockdown). Fixes:
--
-- (a) readAllWithHashes could be asked (by a crafted client request) for
--     ANY store key, not just the 27-key generic allowlist, because the EF
--     passed a client-supplied key list straight into a SECURITY DEFINER
--     RPC that bypasses RLS by design. That is exactly the "service-role
--     escape path to AO/time" risk named in the issue thread. Fixed in the
--     EF (see store-key-write/index.ts in this same integration folder) —
--     this migration adds no new SQL for that half of the fix, since the
--     RPC itself (store_read_all_with_hashes) was already correctly scoped
--     to whatever key list it's given; the bug was the EF trusting an
--     unfiltered client list. Documented here so the two fixes are read
--     together, not just in the EF diff.
--
-- (b)/(c) initState()/DataSync._poll() are unchanged by this migration —
--     confirmed by reading the real client code, they already read
--     non-generic registers (invoices, offerEvents, offerAttachments,
--     ronderingspass, notifications) via their own existing, already-correct
--     EFs, untouched by this work.
--
-- (e) resolveKeyConflict()/store_business_key_write() did a WHOLE-KEY
--     hash-gated replace: any concurrent edit to a DIFFERENT element in the
--     same array (e.g. two different customers, or an unrelated new offer)
--     produced a FALSE conflict, and resolving by "keep my draft" would
--     have discarded the other session's unrelated element entirely. This
--     migration adds a real, element-level three-way-merge write path for
--     the array-shaped generic keys (customers, offers, properties, etc.):
--     the caller sends only the elements it actually added/changed, each
--     tagged with the value it last read for that element (`previous`,
--     compared with real jsonb equality — not a hash, to avoid the
--     canonicalization-mismatch bug class already found once in this
--     engagement for a different function). Only a genuine same-element
--     collision is reported back as a conflict; every other element,
--     including ones changed concurrently by another session, is
--     preserved automatically. Object-shaped keys (settings) still use the
--     existing whole-value store_business_key_write — a single settings
--     object has no finer-grained "element" to merge at.
--
-- PR #2 REVIEW FIX (2026-11-08, ChatGPT code review, P0 blockers 1-2):
-- (1) Removals used to take a bare text[] of ids with NO version check at
--     all — session A could delete an element session B had just updated,
--     with zero conflict detection (silent loss of B's write). Removals now
--     carry the SAME {id, previous} shape as upserts and go through the
--     identical real-jsonb-equality check under the same row lock: a
--     removal is only applied if the element's CURRENT server value still
--     equals what the caller last read. A mismatch (someone else changed
--     it) or an already-gone element is reported back as a conflict
--     (`changed_by_other_session` / `already_removed`), never silently
--     actioned either way.
-- (2) The function's return value now always includes `current` — the
--     full, authoritative post-write array for this key — so the client
--     never has to (and after this fix, no longer does) reconstruct its
--     own snapshot/baseline by re-serializing a possibly-stale in-memory
--     copy. This closes the "partial merge leaves the client's next-diff
--     baseline silently wrong" bug: whatever `current` says is final.
-- (3) Trust-boundary re-verified explicitly for this round's review
--     (blocker 3): `grep -rn store_business_key_merge_write` across this
--     entire repo shows exactly ONE real caller — store-key-write/index.ts's
--     `writeMerge` action — which resolves `callerStaffId`/`authorized` from
--     checkViftAuth()'s server-side JWT verification BEFORE calling this
--     RPC; the RPC's own `p_caller_authorized`/`p_actor_id` parameters are
--     trustworthy only because of that specific, sole call chain, not
--     because the RPC re-derives them itself. EXECUTE remains restricted to
--     service_role (REVOKE/GRANT below, unchanged) — no JWT-holding client
--     can reach this function directly. No second caller or escape path
--     exists anywhere in this repo as of this commit.
--
-- PR #2 RE-REVIEW FIX (2026-11-09, ChatGPT re-review of commit 7933e21):
-- duplicate-id defense. The reviewer reported (read-only SQL against real
-- STAGING, not independently verified here) that `vift_activityLog` — one
-- of the 27 generic keys this function serves — currently holds 44
-- elements including ONE duplicate `id`. Both the upsert and removal
-- lookups below used `ORDER BY ordinality LIMIT 1`, which would silently
-- operate on an ARBITRARY one of two same-id elements and leave the other
-- untouched with no error — not a correctness guarantee for pre-existing
-- duplicate data. Fixed by counting matches for the target id before
-- acting: if more than one element in `v_current` shares the id a caller
-- is trying to upsert or remove, the whole call now fails loudly
-- (`duplicate_id_in_store`) instead of silently picking one. This is a
-- defensive guard only — no data is moved, deduplicated, or written by
-- this migration; existing duplicates in `vift_activityLog` remain exactly
-- as they are until a human decides how to resolve them.
--
-- PR #2 CONSOLIDATED REVIEW FIX (2026-11-09, finding D): mass-deletion
-- guard. store_business_key_write() already refuses a single call that
-- would empty (or reduce below 10% of) a register with more than a
-- handful of rows — store_business_key_merge_write()'s p_removals had NO
-- equivalent protection, even though each individual removal's own
-- per-element version check is fully correct in isolation. Fixed by
-- checking the REQUESTED removal count against the register's current
-- size, using the identical thresholds, before any removal is applied.

BEGIN;

CREATE OR REPLACE FUNCTION public.store_business_key_merge_write(
  p_key               text,
  p_upserts           jsonb,     -- array of {id, data, previous}; previous = null means "I believe this id is new"
  p_removals          jsonb,     -- array of {id, previous}; previous = the element's value as this session last read it
  p_caller_authorized boolean,
  p_actor_id          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_required_perm text;
  v_current       jsonb;
  v_now           timestamptz := clock_timestamp();
  v_now_text      text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_elem          jsonb;
  v_idx           int;
  v_cur_elem      jsonb;
  v_conflicts     jsonb := '[]'::jsonb;
  v_applied       jsonb := '[]'::jsonb;
  v_removed       jsonb := '[]'::jsonb;
  v_id            text;
  v_previous      jsonb;
  v_new_data      jsonb;
  v_dup_count     int;
  v_pre_removal_len int;
  v_requested_removal_count int;
begin
  p_caller_authorized := coalesce(p_caller_authorized, false);

  if p_key is null or p_actor_id is null or length(trim(p_actor_id)) = 0 then
    raise exception 'missing_fields';
  end if;

  v_required_perm := public._staging_business_key_required_perm(p_key);
  if v_required_perm is null then
    raise exception 'key_not_allowlisted';
  end if;
  if not p_caller_authorized then
    raise exception 'forbidden';
  end if;

  select value into v_current from public.store where key = p_key for update;
  if v_current is null then
    insert into public.store(key, value, updated_at) values (p_key, '[]'::jsonb, v_now)
      on conflict (key) do nothing;
    v_current := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_current) is distinct from 'array' then
    raise exception 'not_array_key';
  end if;

  for v_elem in select * from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) loop
    v_id       := v_elem ->> 'id';
    v_new_data := v_elem -> 'data';
    v_previous := v_elem -> 'previous';
    -- `v_elem -> 'previous'` returns the JSONB value `null` (not SQL NULL)
    -- when the caller sent a literal JSON `null` for "this is a new
    -- element" — normalize both SQL NULL and JSON null to SQL NULL here
    -- once, so every check below can use a plain `IS [NOT] NULL` safely.
    if v_previous is not null and jsonb_typeof(v_previous) = 'null' then
      v_previous := null;
    end if;
    if v_id is null or length(trim(v_id)) = 0 or v_new_data is null then
      raise exception 'invalid_element';
    end if;

    -- RE-REVIEW FIX (2026-11-09): refuse rather than silently pick one of
    -- several same-id elements (see migration header).
    select count(*) into v_dup_count from jsonb_array_elements(v_current) elem where elem ->> 'id' = v_id;
    if v_dup_count > 1 then
      raise exception 'duplicate_id_in_store';
    end if;

    select (ord - 1)::int, elem into v_idx, v_cur_elem
      from jsonb_array_elements(v_current) with ordinality as t(elem, ord)
      where elem ->> 'id' = v_id
      limit 1;

    if v_idx is null then
      -- element doesn't exist server-side right now
      if v_previous is not null then
        -- caller thought it existed and had this value — someone else removed it
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', 'removed_by_other_session'));
        continue;
      end if;
      v_current := v_current || jsonb_build_array(v_new_data);
      v_applied := v_applied || jsonb_build_array(v_id);
    else
      -- element exists: only apply if caller's last-known value matches
      -- the CURRENT server value exactly (real jsonb equality, order-
      -- independent for object keys — not a hash, deliberately, to avoid
      -- any canonical-serialization mismatch between client and server).
      if v_previous is distinct from v_cur_elem then
        v_conflicts := v_conflicts || jsonb_build_array(
          jsonb_build_object('id', v_id, 'reason', 'changed_by_other_session', 'serverValue', v_cur_elem)
        );
        continue;
      end if;
      v_current := jsonb_set(v_current, array[v_idx::text], v_new_data);
      v_applied := v_applied || jsonb_build_array(v_id);
    end if;
  end loop;

  -- RE-REVIEW FIX (2026-11-09, finding D): mass-deletion guard, mirroring
  -- store_business_key_write()'s existing mass_wipe_blocked threshold
  -- EXACTLY (see 20261106000002_staging_generic_keys_write_lockdown.sql).
  -- Every individual removal below DOES get its own correct version
  -- check — this guard is not about bypassing that; it's about the SCALE
  -- of a single call being completely unguarded even when every
  -- individual check would technically pass (e.g. a bug upstream in
  -- state/poll handling submitting an incorrectly-near-empty local array
  -- as a batch of "legitimately version-matched" removals). Checked
  -- BEFORE any removal is applied, against the register's size right
  -- now (after this call's own upserts, which is the correct "current
  -- size" to guard against).
  v_pre_removal_len := jsonb_array_length(v_current);
  v_requested_removal_count := jsonb_array_length(coalesce(p_removals, '[]'::jsonb));
  if v_pre_removal_len > 5 and v_requested_removal_count >= v_pre_removal_len then
    raise exception 'mass_wipe_blocked';
  end if;
  if v_pre_removal_len > 10 and (v_pre_removal_len - v_requested_removal_count)::numeric < (v_pre_removal_len::numeric * 0.1) then
    raise exception 'mass_wipe_blocked';
  end if;

  -- PR #2 review fix, blocker 1: a removal is only applied if the element's
  -- CURRENT server value still equals exactly what the caller last read
  -- (`previous`) — same real-jsonb-equality check as the upsert branch
  -- above, under the same row lock. An element someone else changed since
  -- the caller last read it is NEVER deleted out from under them; it comes
  -- back as a conflict instead, with its real current value attached so
  -- the client can show/reconcile it without a second round trip.
  for v_elem in select * from jsonb_array_elements(coalesce(p_removals, '[]'::jsonb)) loop
    v_id       := v_elem ->> 'id';
    v_previous := v_elem -> 'previous';
    if v_previous is not null and jsonb_typeof(v_previous) = 'null' then
      v_previous := null;
    end if;
    if v_id is null or length(trim(v_id)) = 0 then
      raise exception 'invalid_element';
    end if;

    -- RE-REVIEW FIX (2026-11-09): same duplicate-id guard as the upsert
    -- loop above — refuse rather than silently removing an arbitrary one
    -- of several same-id elements.
    select count(*) into v_dup_count from jsonb_array_elements(v_current) elem where elem ->> 'id' = v_id;
    if v_dup_count > 1 then
      raise exception 'duplicate_id_in_store';
    end if;

    select (ord - 1)::int, elem into v_idx, v_cur_elem
      from jsonb_array_elements(v_current) with ordinality as t(elem, ord)
      where elem ->> 'id' = v_id
      limit 1;

    if v_idx is null then
      -- already gone (removed by this same call's own upserts is not
      -- possible — ids are disjoint by construction on the client side,
      -- but defend anyway) — idempotent, not a conflict: the caller's
      -- intent ("this id should not exist") already holds.
      continue;
    end if;

    if v_previous is distinct from v_cur_elem then
      v_conflicts := v_conflicts || jsonb_build_array(
        jsonb_build_object('id', v_id, 'reason', 'changed_by_other_session', 'serverValue', v_cur_elem)
      );
      continue;
    end if;

    v_current := v_current - v_idx;
    v_removed := v_removed || jsonb_build_array(v_id);
  end loop;

  update public.store set value = v_current, updated_at = v_now where key = p_key;

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  -- PR #2 review fix, blocker 2: always return the full, authoritative
  -- post-write array as `current` — the client must build its next-diff
  -- baseline from THIS, never by re-serializing its own in-memory copy
  -- (which may be missing elements another session added/changed that
  -- this call never touched).
  return jsonb_build_object(
    'key', p_key,
    'applied', v_applied,
    'removed', v_removed,
    'conflicts', v_conflicts,
    'current', v_current,
    'serverSignature', v_now_text
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.store_business_key_merge_write(text, jsonb, jsonb, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_business_key_merge_write(text, jsonb, jsonb, boolean, text) TO service_role;

-- The old 5-arg signature (text[] removal list, no `current`/`removed` in
-- the result) is being REPLACED in place via CREATE OR REPLACE above where
-- Postgres allows it — but a parameter TYPE change (text[] -> jsonb) is not
-- an in-place REPLACE; Postgres treats this as a distinct overload unless
-- the old one is dropped first. Drop it explicitly so exactly one, correct
-- signature exists (no caller anywhere in this repo ever used the old
-- text[]-removal 5-arg form in a live environment — this function has
-- never been installed against real STAGING or LIVE).
DROP FUNCTION IF EXISTS public.store_business_key_merge_write(text, jsonb, text[], boolean, text);

COMMIT;
