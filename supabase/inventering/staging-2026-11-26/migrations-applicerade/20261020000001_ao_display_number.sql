-- ============================================================
-- Product decision (independent-reviewer finding, round 4 — flagged
-- explicitly, not shipped silently): the BLOCKER-2 fix (round 3)
-- changed the AO's INTERNAL id from a short, sequential "AO-063" to a
-- long UUID ("AO-<uuid>") to make it genuinely collision-safe. That id
-- is also what staff see, reference verbally, write on paper, and put
-- in reports — changing ITS visible format was never actually decided
-- by anyone, it was a side effect of fixing the collision bug the
-- fastest way that touched the fewest call sites.
--
-- This migration separates the two concerns properly:
--   - INTERNAL id (`id`): stays exactly as round 3 left it — a UUID,
--     collision-safe, used by every foreign key/link
--     (off.workOrderId, ro's schedule, avv.workOrderId, time entries'
--     aoId, etc.). NOT reverted, NOT renumbered.
--   - DISPLAY NUMBER (`displayNumber`, new field): a short, familiar
--     "AO-NNN" number, allocated ATOMICALLY by the server, inside the
--     SAME locked transaction as the create (reusing the row lock
--     `work_order_create` already takes on `vift_workOrders` via
--     `FOR UPDATE`, plus a dedicated sequence for the number itself —
--     `nextval()` is atomic by construction, so two concurrent creates
--     can never be handed the same display number, with no retry loop
--     needed for this part, unlike the id-collision-retry loop that
--     already existed for the legacy server-id branch). This is what
--     the UI should show people; it carries no uniqueness risk because
--     it is never client-chosen.
--
-- Backfill (existing AOs): NO AO is renumbered. An AO whose id already
-- matches the OLD convention (`AO-NNN`, i.e. every AO created before
-- the round-3 UUID fix) gets THAT SAME number copied into
-- `displayNumber` verbatim — it already effectively had this number,
-- staff already know it, nothing changes for them. An AO created
-- DURING the round-3-to-round-4 window (UUID id, no display number at
-- all yet) gets a genuinely NEW number from the sequence — this is not
-- a renumbering, it is a FIRST assignment, since that AO never had a
-- human-friendly number to begin with. The sequence is bumped past the
-- highest OLD-style number found before any new number is handed out,
-- so a backfilled UUID-AO's new number can never collide with an
-- existing OLD-style AO's number.
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS public.ao_display_number_seq;
-- ── Backfill existing vift_workOrders rows ───────────────────────────
DO $$
DECLARE
  v_workorders   jsonb;
  v_max_existing bigint := 0;
  v_elem         jsonb;
  v_ord          int;
  v_num          bigint;
  v_updated      jsonb;
  v_seq_current  bigint;
BEGIN
  SELECT value INTO v_workorders FROM public.store WHERE key = 'vift_workOrders' FOR UPDATE;
  IF v_workorders IS NULL OR jsonb_typeof(v_workorders) <> 'array' THEN
    RETURN;
  END IF;

  -- Pass 1: highest OLD-format numeric suffix present, so the sequence
  -- never later hands out a number that collides with one of them.
  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_workorders)
  LOOP
    IF (v_elem ->> 'id') ~ '^AO-[0-9]+$' THEN
      v_num := (regexp_replace(v_elem ->> 'id', '^AO-', ''))::bigint;
      IF v_num > v_max_existing THEN v_max_existing := v_num; END IF;
    END IF;
  END LOOP;

  IF v_max_existing > 0 THEN
    SELECT last_value INTO v_seq_current FROM public.ao_display_number_seq;
    IF v_max_existing > v_seq_current THEN
      PERFORM setval('public.ao_display_number_seq', v_max_existing);
    END IF;
  END IF;

  -- Pass 2: assign displayNumber to every element that doesn't already
  -- have one (idempotent — re-running this migration is a no-op for
  -- anything already backfilled, since it only fills in a MISSING field).
  v_updated := v_workorders;
  FOR v_ord IN 0 .. jsonb_array_length(v_workorders) - 1
  LOOP
    v_elem := v_workorders -> v_ord;
    IF (v_elem -> 'displayNumber') IS NULL THEN
      IF (v_elem ->> 'id') ~ '^AO-[0-9]+$' THEN
        v_num := (regexp_replace(v_elem ->> 'id', '^AO-', ''))::bigint;
      ELSE
        v_num := nextval('public.ao_display_number_seq');
      END IF;
      v_updated := jsonb_set(
        v_updated, array[v_ord::text],
        v_elem || jsonb_build_object('displayNumber', 'AO-' || lpad(v_num::text, 3, '0'))
      );
    END IF;
  END LOOP;

  UPDATE public.store SET value = v_updated WHERE key = 'vift_workOrders';
END $$;
-- ── work_order_create: always allocate + return a displayNumber ─────
-- Same signature as the version this replaces (20261017000001) — no
-- call site needs to change. `p_client_id` (the UUID the client always
-- sends, per the R2 comment this function already carries) still
-- becomes the INTERNAL `id`, completely unchanged from round 3. The
-- NEW part is `v_display_seq`/`displayNumber`, allocated unconditionally
-- (whether or not a client id was given), inside the SAME `FOR UPDATE`-
-- locked transaction.
CREATE OR REPLACE FUNCTION public.work_order_create(
  p_ao             jsonb,
  p_idempotency_key text,
  p_client_id       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing       jsonb;
  v_workorders     jsonb;
  v_new_id         text;
  v_seq            bigint;
  v_display_seq    bigint;
  v_now            timestamptz := clock_timestamp();
  v_now_text       text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_new_ao         jsonb;
  v_sig            text;
  v_collision_idx  int;
BEGIN
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'work_order_create' AND idem_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.store(key, value) VALUES ('vift_workOrders', '[]'::jsonb)
    ON CONFLICT (key) DO NOTHING;

  SELECT value INTO v_workorders FROM public.store WHERE key = 'vift_workOrders' FOR UPDATE;
  IF v_workorders IS NULL OR jsonb_typeof(v_workorders) <> 'array' THEN
    v_workorders := '[]'::jsonb;
  END IF;

  IF p_client_id IS NOT NULL AND trim(p_client_id) <> '' THEN
    SELECT (ord - 1) INTO v_collision_idx
      FROM jsonb_array_elements(v_workorders) WITH ORDINALITY AS t(elem, ord)
      WHERE elem ->> 'id' = p_client_id
      LIMIT 1;
    IF v_collision_idx IS NOT NULL THEN
      RAISE EXCEPTION 'id_collision';
    END IF;
    v_new_id := p_client_id;
  ELSE
    -- Legacy server-generated INTERNAL id branch (no current call site
    -- uses it — every real caller sends p_client_id — kept only for a
    -- hypothetical future caller per the original R2 comment). Uses
    -- its OWN, separate sequence from the display-number one below —
    -- the internal id and the display number are now two genuinely
    -- distinct concepts and must never share a counter, even here.
    CREATE SEQUENCE IF NOT EXISTS public.work_order_id_seq;
    LOOP
      v_seq := nextval('public.work_order_id_seq');
      v_new_id := 'AO-' || lpad(v_seq::text, 3, '0');
      SELECT (ord - 1) INTO v_collision_idx
        FROM jsonb_array_elements(v_workorders) WITH ORDINALITY AS t(elem, ord)
        WHERE elem ->> 'id' = v_new_id
        LIMIT 1;
      IF v_collision_idx IS NULL THEN EXIT; END IF;
    END LOOP;
  END IF;

  -- NEW: the human-friendly display number — ALWAYS server-allocated,
  -- regardless of which branch above produced the internal id. A
  -- single `nextval()` call; no retry/collision-check needed because
  -- this value is NEVER client-supplied and the sequence itself
  -- guarantees uniqueness by construction.
  CREATE SEQUENCE IF NOT EXISTS public.ao_display_number_seq;
  v_display_seq := nextval('public.ao_display_number_seq');

  v_new_ao := (p_ao - 'id') || jsonb_build_object(
    'id', v_new_id,
    'displayNumber', 'AO-' || lpad(v_display_seq::text, 3, '0'),
    'createdAt', v_now_text,
    'updatedAt', v_now_text
  );

  v_workorders := v_workorders || jsonb_build_array(v_new_ao);
  UPDATE public.store SET value = v_workorders, updated_at = v_now WHERE key = 'vift_workOrders';

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_existing := jsonb_build_object('workOrder', v_new_ao, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('work_order_create', p_idempotency_key, v_existing);

  RETURN v_existing;
END;
$$;
REVOKE ALL ON FUNCTION public.work_order_create(jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_create(jsonb, text, text) TO service_role