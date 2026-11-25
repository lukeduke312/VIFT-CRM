-- ============================================================
-- ROLLBACK T3-B (genererad av tests/local/t3b-rollback.js ur STAGING-facit 2026-11-25).
-- Återställer de funktioner som T3-B ersatte EXAKT till STAGING-versionen och tar bort
-- T3-B:s nya funktioner. Rör INGEN data och ingen sekvens (ao_display_number_seq får stå
-- kvar framflyttad: det hindrar dubbletter). Körs i en transaktion. Kör därefter
-- EF-rollbacken (föregående EF-versioner) och klientpaketet enligt T3-RESULTAT.md (T3-B).
-- ============================================================
begin;

-- 1. Nya signaturer bort (gamla signaturer återskapas nedan).
drop function if exists public.work_order_patch(text,jsonb,text,text,text,text[]);
drop function if exists public.time_entry_create(jsonb,text,text,text,uuid,text[]);

-- 2. Ersatta funktioner tillbaka till STAGING-definitionen (exakt text ur facit).
-- work_order_patch(text,jsonb,text,text)
CREATE OR REPLACE FUNCTION public.work_order_patch(p_ao_id text, p_patch jsonb, p_idempotency_key text, p_expected_updated_at text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing   jsonb;
  v_workorders jsonb;
  v_idx        int;
  v_ao         jsonb;
  v_updated    jsonb;
  v_now        timestamptz := clock_timestamp();
  v_now_text   text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_sig        text;
  v_result     jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'work_order_patch' AND idem_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT value INTO v_workorders FROM public.store WHERE key = 'vift_workOrders' FOR UPDATE;
  IF v_workorders IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT (ord - 1) INTO v_idx
    FROM jsonb_array_elements(v_workorders) WITH ORDINALITY AS t(elem, ord)
    WHERE elem ->> 'id' = p_ao_id
    LIMIT 1;
  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_ao := v_workorders -> v_idx;

  -- ── Lost-update-skydd (§B/§G i uppdraget): om anroparen skickade ett
  --    förväntat updatedAt (dvs klienten BYGGDE sin patch från en viss,
  --    känd version av AO:n) och den INTE matchar den FAKTISKA, just
  --    LÅSTA server-raden → avvisa som 'stale_write' istället för att
  --    tyst skriva över en mellankommande ändring från en ANNAN klient.
  --    Anroparen (EF) returnerar detta som ett tydligt fel; klienten kan
  --    då hämta färsk data och be användaren slå ihop/försöka igen —
  --    ALDRIG en tyst, oavsiktlig överskrivning av ett fält den aldrig
  --    sett.
  IF p_expected_updated_at IS NOT NULL
     AND (v_ao ->> 'updatedAt') IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'stale_write';
  END IF;

  v_updated := (v_ao || p_patch) || jsonb_build_object('updatedAt', to_jsonb(v_now_text));
  v_workorders := jsonb_set(v_workorders, array[v_idx::text], v_updated);
  UPDATE public.store SET value = v_workorders, updated_at = v_now WHERE key = 'vift_workOrders';

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('workOrder', v_updated, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('work_order_patch', p_idempotency_key, v_result);

  RETURN v_result;
END;
$function$;
revoke all on function public.work_order_patch(text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.work_order_patch(text,jsonb,text,text) to service_role;

-- time_entry_create(jsonb,text,text)
CREATE OR REPLACE FUNCTION public.time_entry_create(p_entry jsonb, p_idempotency_key text, p_client_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing     jsonb;
  v_entries      jsonb;
  v_workorders   jsonb;
  v_ao_idx       int;
  v_ao           jsonb;
  v_seq          bigint;
  v_new_id       text;
  v_now          timestamptz := clock_timestamp();
  v_now_text     text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_safe_entry   jsonb;
  v_new_entry    jsonb;
  v_ao_id        text;
  v_sig          text;
  v_result       jsonb;
  v_collision_idx int;
BEGIN
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'time_entry_create' AND idem_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- FIX 3 (SÄKERHETSBLOCKER, försvar i djup): en NY post kan ALDRIG
  -- skapas redan attesterad via denna funktion, oavsett vad anroparen
  -- (Edge Function:en) skickar in. Attestering sker ENDAST via
  -- time_entry_set_attested() nedan, aldrig vid skapande.
  v_safe_entry := p_entry - 'attested' - 'attestedAt' - 'attestedBy';

  INSERT INTO public.store(key, value) VALUES ('vift_timeEntries', '[]'::jsonb)
    ON CONFLICT (key) DO NOTHING;
  SELECT value INTO v_entries FROM public.store WHERE key = 'vift_timeEntries' FOR UPDATE;
  IF v_entries IS NULL OR jsonb_typeof(v_entries) <> 'array' THEN
    v_entries := '[]'::jsonb;
  END IF;

  IF p_client_id IS NOT NULL AND trim(p_client_id) <> '' THEN
    SELECT (ord - 1) INTO v_collision_idx
      FROM jsonb_array_elements(v_entries) WITH ORDINALITY AS t(elem, ord)
      WHERE elem ->> 'id' = p_client_id
      LIMIT 1;
    IF v_collision_idx IS NOT NULL THEN
      RAISE EXCEPTION 'id_collision';
    END IF;
    v_new_id := p_client_id;
  ELSE
    CREATE SEQUENCE IF NOT EXISTS public.time_entry_id_seq;
    LOOP
      v_seq := nextval('public.time_entry_id_seq');
      v_new_id := 'TID-' || lpad(v_seq::text, 3, '0');
      SELECT (ord - 1) INTO v_collision_idx
        FROM jsonb_array_elements(v_entries) WITH ORDINALITY AS t(elem, ord)
        WHERE elem ->> 'id' = v_new_id
        LIMIT 1;
      IF v_collision_idx IS NULL THEN EXIT; END IF;
    END LOOP;
  END IF;

  v_new_entry := (v_safe_entry - 'id') || jsonb_build_object('id', v_new_id, 'createdAt', v_now_text);
  v_ao_id := v_new_entry ->> 'aoId';

  v_entries := jsonb_build_array(v_new_entry) || v_entries;
  UPDATE public.store SET value = v_entries, updated_at = v_now WHERE key = 'vift_timeEntries';

  IF v_ao_id IS NOT NULL AND v_ao_id <> '' THEN
    SELECT value INTO v_workorders FROM public.store WHERE key = 'vift_workOrders' FOR UPDATE;
    IF v_workorders IS NOT NULL AND jsonb_typeof(v_workorders) = 'array' THEN
      SELECT (ord - 1) INTO v_ao_idx
        FROM jsonb_array_elements(v_workorders) WITH ORDINALITY AS t(elem, ord)
        WHERE elem ->> 'id' = v_ao_id
        LIMIT 1;
      IF v_ao_idx IS NOT NULL THEN
        v_ao := v_workorders -> v_ao_idx;
        v_ao := v_ao || jsonb_build_object(
          'timeEntries', coalesce(v_ao -> 'timeEntries', '[]'::jsonb) || to_jsonb(v_new_id)
        );
        v_workorders := jsonb_set(v_workorders, array[v_ao_idx::text], v_ao);
        UPDATE public.store SET value = v_workorders, updated_at = v_now WHERE key = 'vift_workOrders';
      END IF;
    END IF;
  END IF;

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('timeEntry', v_new_entry, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('time_entry_create', p_idempotency_key, v_result);

  RETURN v_result;
END;
$function$;
revoke all on function public.time_entry_create(jsonb,text,text) from public, anon, authenticated;
grant execute on function public.time_entry_create(jsonb,text,text) to service_role;

-- time_entry_patch(text,jsonb,text,text,text,boolean)
CREATE OR REPLACE FUNCTION public.time_entry_patch(p_entry_id text, p_patch jsonb, p_idempotency_key text, p_expected_updated_at text, p_caller_staff_id text, p_caller_can_manage_others boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing     jsonb;
  v_entries      jsonb;
  v_idx          int;
  v_entry        jsonb;
  v_patch        jsonb;
  v_updated      jsonb;
  v_now          timestamptz := clock_timestamp();
  v_now_text     text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_sig          text;
  v_result       jsonb;
  v_scoped_key   text;
  v_fingerprint  text;
  v_caller_valid boolean;
BEGIN
  -- V5-FIX (fråga 1): anroparidentiteten är nu VERKLIGEN obligatorisk —
  -- inget DEFAULT (se ovan) betyder att ett anrop som utelämnar denna
  -- parameter inte matchar funktionen alls (ett rent "function does not
  -- exist"-fel, inte en tyst, osäker genväg). Denna kontroll är ett
  -- ANDRA, oberoende skyddslager mot att NULL/tom sträng ändå skickas in
  -- explicit (t.ex. av en framtida, buggig anropare) — en tom/NULL
  -- identitet behandlas ALLTID som obehörig, aldrig som "ingen särskild
  -- ägare att jämföra mot".
  IF p_caller_staff_id IS NULL OR btrim(p_caller_staff_id) = '' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- V5-FIX (fråga 1, "ogiltiga personal-id nekas"): anroparens staffId
  -- måste faktiskt existera i den riktiga personallistan — en extra,
  -- billig kontroll som gör en felaktigt härledd/förfalskad identitet
  -- overksam även om den råkar vara en icke-tom textsträng.
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      coalesce((SELECT value FROM public.store WHERE key = 'vift_staff'), '[]'::jsonb)
    ) s WHERE s ->> 'id' = p_caller_staff_id
  ) INTO v_caller_valid;
  IF NOT v_caller_valid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- V6-FIX (oberoende granskning, fynd A): en explicit NULL i
  -- `p_caller_can_manage_others` fick tidigare `NOT p_caller_can_manage_others`
  -- att utvärderas till NULL, inte TRUE/FALSE — och `IF NULL THEN ...`
  -- hoppar ALLTID över grenen, precis som `IF false THEN`. Nettoeffekten
  -- var att en NULL-flagga (t.ex. en bugg längre upp i anropskedjan som
  -- glömmer sätta värdet) TYST gav samma utfall som "obehörig åtkomst
  -- nekas INTE" på ägarskapskontrollen nedan, OCH samma tysta utfall som
  -- "stripp INTE ägarskapsfälten" på raden efter — motsatsen till avsedd
  -- fail-closed-design. Normaliseras HÄR, en gång, till en garanterat
  -- icke-NULL boolean — NULL behandlas nu uttryckligen som FALSE (den
  -- MEST restriktiva tolkningen), aldrig som en gräns som tyst öppnas.
  p_caller_can_manage_others := coalesce(p_caller_can_manage_others, false);

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  -- V5-FIX (fråga 2): idempotensnyckeln namnrymds nu PER ANROPARE
  -- (fn_name + anroparens staffId + klientnyckeln) — inte bara per
  -- klientnyckel. En annan användare som (av misstag eller avsiktligt)
  -- återanvänder EXAKT samma klientsträng kan därför ALDRIG få tillbaka
  -- en annan anropares tidigare resultat; de två raderna i
  -- `op_idempotency` är helt disjunkta trots samma `p_idempotency_key`.
  v_scoped_key := p_caller_staff_id || '::' || p_idempotency_key;
  -- Fingeravtryck av de FAKTISKA, betydelsebärande indata — om SAMMA
  -- anropare återanvänder sin egen nyckel men med ett ANNAT entryId/
  -- patch/behörighetsläge denna gång, är det inte en genuin retry av
  -- samma operation (klientbugg eller nyckelkollision) och ska nekas
  -- explicit, aldrig tyst returnera det GAMLA resultatet som om den nya
  -- begäran lyckats.
  v_fingerprint := md5(coalesce(p_entry_id,'') || '|' || coalesce(p_patch::text,'') || '|' ||
                        coalesce(p_expected_updated_at,'') || '|' || p_caller_staff_id || '|' ||
                        p_caller_can_manage_others::text);

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'time_entry_patch' AND idem_key = v_scoped_key;
  IF v_existing IS NOT NULL THEN
    IF (v_existing ->> '_fp') IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'idempotency_key_conflict';
    END IF;
    RETURN v_existing - '_fp';
  END IF;

  SELECT value INTO v_entries FROM public.store WHERE key = 'vift_timeEntries' FOR UPDATE;
  IF v_entries IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT (ord - 1) INTO v_idx
    FROM jsonb_array_elements(v_entries) WITH ORDINALITY AS t(elem, ord)
    WHERE elem ->> 'id' = p_entry_id
    LIMIT 1;
  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_entry := v_entries -> v_idx;

  -- FIX 1/2 (SÄKERHETSBLOCKER): ägarskapskontroll, atomiskt inom samma
  -- radlås som ovan (FOR UPDATE togs redan på hela blobben innan denna
  -- punkt) — ingen separat kontroll/skriv-race möjlig. En post UTAN
  -- staffId (`v_entry->>'staffId'` är NULL) kan aldrig matcha den nu
  -- obligatoriskt icke-tomma `p_caller_staff_id` via IS DISTINCT FROM —
  -- en sådan post kräver därför ALLTID p_caller_can_manage_others=true,
  -- precis som en post som ägs av någon annan.
  IF (v_entry ->> 'staffId') IS DISTINCT FROM p_caller_staff_id
     AND NOT p_caller_can_manage_others THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- FIX 4 (SÄKERHETSBLOCKER): attest-spärren är nu OVILLKORLIG — ingen
  -- patch, oavsett innehåll, kan röra en redan attesterad post. Attest-/
  -- av-attestflödet går ENDAST via time_entry_set_attested() nedan.
  IF (v_entry ->> 'attested')::boolean IS TRUE THEN
    RAISE EXCEPTION 'attested_locked';
  END IF;

  -- FIX 4 (försvar i djup): strippa attestfält på SQL-nivå oavsett vad
  -- Edge Function:en redan strippat.
  v_patch := p_patch - 'attested' - 'attestedAt' - 'attestedBy';

  -- FIX 1/2 (försvar i djup): ägarskapsfält i patchen kräver samma
  -- behörighet som att överhuvudtaget röra en annans post.
  IF NOT p_caller_can_manage_others THEN
    v_patch := v_patch - 'staffId' - 'staffName' - 'registeredById' - 'registeredByName';
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND (v_entry ->> 'createdAt') IS DISTINCT FROM p_expected_updated_at
     AND (v_entry ->> 'updatedAt') IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'stale_write';
  END IF;

  v_updated := (v_entry || v_patch) || jsonb_build_object('updatedAt', to_jsonb(v_now_text));
  v_entries := jsonb_set(v_entries, array[v_idx::text], v_updated);
  UPDATE public.store SET value = v_entries, updated_at = v_now WHERE key = 'vift_timeEntries';

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('timeEntry', v_updated, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('time_entry_patch', v_scoped_key, v_result || jsonb_build_object('_fp', v_fingerprint));

  RETURN v_result;
END;
$function$;
revoke all on function public.time_entry_patch(text,jsonb,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.time_entry_patch(text,jsonb,text,text,text,boolean) to service_role;

-- store_write_stamp_status(uuid,boolean,bigint,text,bigint)
CREATE OR REPLACE FUNCTION public.store_write_stamp_status(p_auth_user_id uuid, p_active boolean, p_ts bigint, p_ao_id text, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row       public.stamp_status;
  v_cur_rev   bigint;
  v_new_ts    bigint := case when p_active then p_ts else null end;
  v_new_ao_id text   := case when p_active then p_ao_id else null end;
  v_now       timestamptz := now();
begin
  if p_auth_user_id is null then
    raise exception 'store_write_stamp_status: p_auth_user_id required' using errcode = '22023';
  end if;
  if p_active is null then
    raise exception 'store_write_stamp_status: p_active required' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'store_write_stamp_status: p_expected_revision required' using errcode = '22023';
  end if;

  -- CONCURRENT FIRST-WRITE GUARD (2026-11-17): the row-level FOR UPDATE
  -- lock below only serializes writes if the row ALREADY EXISTS. Two
  -- first-ever writes could both see no row and reach the ON CONFLICT
  -- clause, whose unconditional DO UPDATE would overwrite the winner
  -- without comparing expected_revision. Serialize by verified auth UUID
  -- BEFORE the read so this race is also safe when no row exists.
  -- Hash collisions only cause additional serialization, never leakage:
  -- all state reads/writes still filter on the full UUID.
  perform pg_advisory_xact_lock(hashtextextended('vift_stamp_status:' || p_auth_user_id::text, 0));

  -- Row lock FIRST (same ordering discipline as every other revision-
  -- checked RPC in this codebase) — this is what makes the whole
  -- check-then-write atomic: no other writer for this SAME user_id can
  -- interleave between the read below and the write further down.
  select * into v_row from public.stamp_status where user_id = p_auth_user_id for update;
  v_cur_rev := coalesce(v_row.revision, 0);

  if v_cur_rev <> p_expected_revision then
    -- A different write already landed since the caller last read this
    -- row. Decide: genuine idempotent retry (accept, no-op) or a real
    -- conflict between two DIFFERENT operations (reject)?
    if v_row.user_id is not null
       and v_row.active = p_active
       and coalesce(v_row.ts, -1) = coalesce(v_new_ts, -1)
       and coalesce(v_row.ao_id, '') = coalesce(v_new_ao_id, '')
    then
      -- Byte-identical to what is already stored: this is the SAME
      -- logical write being retried (e.g. a dropped response, resent) —
      -- accept as a no-op, do not bump revision again.
      return jsonb_build_object('active', v_row.active, 'ts', v_row.ts, 'aoId', v_row.ao_id, 'hasRow', true, 'revision', v_row.revision, 'stale', false, 'replayed', true);
    end if;
    -- Genuinely different content under a stale expected revision: a REAL
    -- conflict (e.g. two devices both read revision 3, one clocked in,
    -- the other clocked out — whichever commits first wins, the other
    -- MUST be told to re-read, never silently overwritten or silently
    -- dropped). Return the actual current row so the caller can reconcile.
    return jsonb_build_object('active', coalesce(v_row.active, false), 'ts', v_row.ts, 'aoId', v_row.ao_id, 'hasRow', v_row.user_id is not null, 'revision', v_cur_rev, 'stale', true, 'replayed', false);
  end if;

  -- Revision matches what the caller last observed — safe to apply,
  -- atomically, under the still-held row lock.
  insert into public.stamp_status (user_id, active, ts, ao_id, revision, updated_at)
    values (p_auth_user_id, p_active, v_new_ts, v_new_ao_id, 1, v_now)
  on conflict (user_id) do update set
    active = excluded.active, ts = excluded.ts, ao_id = excluded.ao_id,
    revision = public.stamp_status.revision + 1, updated_at = excluded.updated_at;

  return jsonb_build_object('active', p_active, 'ts', v_new_ts, 'aoId', v_new_ao_id, 'hasRow', true, 'revision', v_cur_rev + 1, 'stale', false, 'replayed', false);
end;
$function$;
revoke all on function public.store_write_stamp_status(uuid,boolean,bigint,text,bigint) from public, anon, authenticated;
grant execute on function public.store_write_stamp_status(uuid,boolean,bigint,text,bigint) to service_role;

-- work_order_checklist_set_state(text,text,text,text,text,text,text,text,text,boolean,boolean)
CREATE OR REPLACE FUNCTION public.work_order_checklist_set_state(p_ao_id text, p_item_id text, p_action text, p_text text, p_description text, p_comment text, p_image text, p_actor_name text, p_caller_staff_id text, p_caller_can_view_all boolean, p_caller_can_edit boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_workorders  jsonb;
  v_ao_idx      int;
  v_ao          jsonb;
  v_checklist   jsonb;
  v_item_idx    int;
  v_item        jsonb;
  v_new_item    jsonb;
  v_state       text;
  v_owner       text;
  v_is_own      boolean;
  v_history     jsonb;
  v_noop        boolean := false;
  v_updated_ao  jsonb;
  v_now         timestamptz := clock_timestamp();
  v_now_text    text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_actor       text := coalesce(nullif(trim(p_actor_name), ''), 'Okänd användare');
  v_entry       jsonb;
begin
  if p_action is null or p_action not in ('start', 'done', 'avvikelse', 'reset', 'add', 'remove') then
    raise exception 'invalid_action';
  end if;
  if coalesce(p_item_id, '') = '' then
    raise exception 'missing_fields';
  end if;
  if p_action = 'avvikelse' and coalesce(trim(p_comment), '') = '' then
    raise exception 'comment_required';
  end if;
  if p_action = 'add' and coalesce(trim(p_text), '') = '' then
    raise exception 'text_required';
  end if;

  select value into v_workorders from public.store where key = 'vift_workOrders' for update;
  if v_workorders is null or jsonb_typeof(v_workorders) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1) into v_ao_idx
    from jsonb_array_elements(v_workorders) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_ao_id
    limit 1;
  if v_ao_idx is null then
    raise exception 'not_found';
  end if;
  v_ao := v_workorders -> v_ao_idx;

  if not p_caller_can_view_all then
    if not (coalesce(v_ao -> 'staff', '[]'::jsonb) ? p_caller_staff_id) and (v_ao ->> 'status') <> 'pool' then
      raise exception 'forbidden';
    end if;
  end if;

  v_checklist := coalesce(v_ao -> 'checklist', '[]'::jsonb);
  select (ord - 1) into v_item_idx
    from jsonb_array_elements(v_checklist) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_item_id
    limit 1;

  v_entry := jsonb_build_object('a', p_action, 'by', v_actor, 'byId', coalesce(p_caller_staff_id, ''), 'at', v_now_text);

  if p_action = 'add' then
    if v_item_idx is not null then
      if (v_checklist -> v_item_idx ->> 'text') = trim(p_text) then
        v_noop := true;
      else
        raise exception 'id_collision';
      end if;
    else
      v_checklist := v_checklist || jsonb_build_array(jsonb_build_object(
        'id', p_item_id,
        'text', left(trim(p_text), 300),
        'description', left(coalesce(trim(p_description), ''), 2000),
        'done', false,
        'avvikelse', null,
        'history', jsonb_build_array(v_entry)
      ));
    end if;
  else
    if v_item_idx is null then
      if p_action = 'remove' then
        v_noop := true;
      else
        raise exception 'item_not_found';
      end if;
    else
      v_item := v_checklist -> v_item_idx;
      v_state := case
        when v_item ->> 'avvikelse' = 'avvikelse' then 'avvikelse'
        when coalesce((v_item ->> 'done')::boolean, false) or v_item ->> 'avvikelse' = 'ok' then 'utford'
        when coalesce(v_item ->> 'startedAt', '') <> '' then 'pagaende'
        else 'ej_paborjad'
      end;
      v_owner := case v_state
        when 'avvikelse' then v_item ->> 'avvikelseById'
        when 'utford'    then v_item ->> 'doneById'
        when 'pagaende'  then v_item ->> 'startedById'
        else null
      end;
      v_is_own := coalesce(v_owner, '') <> '' and v_owner = coalesce(p_caller_staff_id, '');

      if not p_caller_can_edit and not v_is_own and (
           (p_action in ('reset', 'remove') and v_state <> 'ej_paborjad')
        or (p_action in ('done', 'avvikelse') and v_state in ('utford', 'avvikelse'))
      ) then
        raise exception 'forbidden_other';
      end if;

      if p_action = 'remove' then
        v_checklist := v_checklist - v_item_idx;
      else
        v_entry := v_entry || jsonb_build_object('from', v_state);
        v_new_item := v_item;

        if p_action = 'start' then
          if v_state in ('utford', 'avvikelse') then
            raise exception 'already_resolved';
          elsif v_state = 'pagaende' then
            v_noop := true;
          else
            v_new_item := v_new_item || jsonb_build_object(
              'startedAt', v_now_text, 'startedBy', v_actor, 'startedById', coalesce(p_caller_staff_id, ''));
          end if;

        elsif p_action = 'done' then
          if v_state = 'utford' then
            v_noop := true;
          else
            v_new_item := v_new_item || jsonb_build_object(
              'avvikelse', 'ok', 'done', true,
              'avvikelseComment', '', 'avvikelseAt', '', 'avvikelseBy', '', 'avvikelseById', '',
              'doneAt', v_now_text, 'doneBy', v_actor, 'doneById', coalesce(p_caller_staff_id, ''));
          end if;

        elsif p_action = 'avvikelse' then
          v_new_item := v_new_item || jsonb_build_object(
            'avvikelse', 'avvikelse', 'done', false,
            'avvikelseComment', left(trim(p_comment), 2000),
            'avvikelseAt', v_now_text, 'avvikelseBy', v_actor, 'avvikelseById', coalesce(p_caller_staff_id, ''),
            'doneAt', '', 'doneBy', '', 'doneById', '');
          if p_image is not null and p_image <> '' then
            v_new_item := v_new_item || jsonb_build_object('avvikelseImage', p_image);
          end if;

        elsif p_action = 'reset' then
          if v_state = 'ej_paborjad' then
            v_noop := true;
          else
            v_new_item := v_new_item || jsonb_build_object(
              'done', false, 'avvikelse', null,
              'avvikelseComment', '', 'avvikelseAt', '', 'avvikelseBy', '', 'avvikelseById', '',
              'startedAt', '', 'startedBy', '', 'startedById', '',
              'doneAt', '', 'doneBy', '', 'doneById', '');
          end if;
        end if;

        if not v_noop then
          v_history := coalesce(v_new_item -> 'history', '[]'::jsonb) || jsonb_build_array(v_entry);
          while jsonb_array_length(v_history) > 20 loop
            v_history := v_history - 0;
          end loop;
          v_new_item := v_new_item || jsonb_build_object('history', v_history);
          v_checklist := jsonb_set(v_checklist, array[v_item_idx::text], v_new_item);
        end if;
      end if;
    end if;
  end if;

  if v_noop then
    return jsonb_build_object('workOrder', v_ao, 'noop', true, 'serverSignature', v_now_text);
  end if;

  v_updated_ao := v_ao || jsonb_build_object('checklist', v_checklist, 'updatedAt', v_now_text);
  v_workorders := jsonb_set(v_workorders, array[v_ao_idx::text], v_updated_ao);
  update public.store set value = v_workorders, updated_at = v_now where key = 'vift_workOrders';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('workOrder', v_updated_ao, 'noop', false, 'serverSignature', v_now_text);
end;
$function$;
revoke all on function public.work_order_checklist_set_state(text,text,text,text,text,text,text,text,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.work_order_checklist_set_state(text,text,text,text,text,text,text,text,text,boolean,boolean) to service_role;

-- work_order_log_append(text,jsonb,text,boolean)
CREATE OR REPLACE FUNCTION public.work_order_log_append(p_ao_id text, p_entry jsonb, p_caller_staff_id text, p_caller_can_view_all boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_arr jsonb; v_idx int; v_ao jsonb; v_log jsonb; v_existing jsonb;
  v_now timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if coalesce(p_ao_id, '') = '' or p_entry is null or jsonb_typeof(p_entry) <> 'object' or coalesce(p_entry->>'id', '') = '' then
    raise exception 'missing_fields';
  end if;
  select value into v_arr from public.store where key = 'vift_workOrders' for update;
  if v_arr is null or jsonb_typeof(v_arr) <> 'array' then raise exception 'not_found'; end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_arr) with ordinality as t(el, ord) where el->>'id' = p_ao_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_ao := v_arr -> v_idx;
  if not coalesce(p_caller_can_view_all, false) then
    if not (coalesce(v_ao->'staff', '[]'::jsonb) ? coalesce(p_caller_staff_id, '')) and (v_ao->>'status') <> 'pool' then
      raise exception 'forbidden';
    end if;
  end if;
  v_log := coalesce(v_ao->'log', '[]'::jsonb);
  select e into v_existing from jsonb_array_elements(v_log) e where e->>'id' = p_entry->>'id' limit 1;
  if v_existing is not null then
    if v_existing = p_entry then return jsonb_build_object('workOrder', v_ao, 'noop', true); end if;
    raise exception 'id_collision';
  end if;
  v_ao := v_ao || jsonb_build_object('log', v_log || jsonb_build_array(p_entry), 'updatedAt', v_now_text);
  v_arr := jsonb_set(v_arr, array[v_idx::text], v_ao);
  update public.store set value = v_arr, updated_at = v_now where key = 'vift_workOrders';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('workOrder', v_ao, 'noop', false);
end;
$function$;
revoke all on function public.work_order_log_append(text,jsonb,text,boolean) from public, anon, authenticated;
grant execute on function public.work_order_log_append(text,jsonb,text,boolean) to service_role;

-- work_order_log_remove(text,text,text,boolean,boolean)
CREATE OR REPLACE FUNCTION public.work_order_log_remove(p_ao_id text, p_entry_id text, p_caller_staff_id text, p_caller_can_view_all boolean, p_caller_can_edit boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_arr jsonb; v_idx int; v_ao jsonb; v_log jsonb; v_entry jsonb;
  v_now timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if coalesce(p_ao_id, '') = '' or coalesce(p_entry_id, '') = '' then raise exception 'missing_fields'; end if;
  select value into v_arr from public.store where key = 'vift_workOrders' for update;
  if v_arr is null or jsonb_typeof(v_arr) <> 'array' then raise exception 'not_found'; end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_arr) with ordinality as t(el, ord) where el->>'id' = p_ao_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_ao := v_arr -> v_idx;
  if not coalesce(p_caller_can_view_all, false) then
    if not (coalesce(v_ao->'staff', '[]'::jsonb) ? coalesce(p_caller_staff_id, '')) and (v_ao->>'status') <> 'pool' then
      raise exception 'forbidden';
    end if;
  end if;
  v_log := coalesce(v_ao->'log', '[]'::jsonb);
  select e into v_entry from jsonb_array_elements(v_log) e where e->>'id' = p_entry_id limit 1;
  if v_entry is null then return jsonb_build_object('workOrder', v_ao, 'noop', true); end if;
  if not coalesce(p_caller_can_edit, false) and coalesce(v_entry->>'staffId', '') <> coalesce(p_caller_staff_id, '-') then
    raise exception 'forbidden_other';
  end if;
  v_log := coalesce((select jsonb_agg(e order by ord) from jsonb_array_elements(v_log) with ordinality as l(e, ord) where e->>'id' is distinct from p_entry_id), '[]'::jsonb);
  v_ao := v_ao || jsonb_build_object('log', v_log, 'updatedAt', v_now_text);
  v_arr := jsonb_set(v_arr, array[v_idx::text], v_ao);
  update public.store set value = v_arr, updated_at = v_now where key = 'vift_workOrders';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('workOrder', v_ao, 'noop', false);
end;
$function$;
revoke all on function public.work_order_log_remove(text,text,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.work_order_log_remove(text,text,text,boolean,boolean) to service_role;

-- work_order_create(jsonb,text,text)
CREATE OR REPLACE FUNCTION public.work_order_create(p_ao jsonb, p_idempotency_key text, p_client_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
revoke all on function public.work_order_create(jsonb,text,text) from public, anon, authenticated;
grant execute on function public.work_order_create(jsonb,text,text) to service_role;

-- 3. T3-B:s nya funktioner bort (efter att inget längre anropar dem).
drop function if exists public.work_order_pool_take(text,text,text[],text,text);
drop function if exists public.work_order_billing_set(text,text,text,text);
drop function if exists public._vift_ao_take(jsonb,text,text,text);
drop function if exists public._vift_ao_material_merge(jsonb,jsonb,text,text);
drop function if exists public._vift_ao_billing_touched(jsonb,jsonb);
drop function if exists public._vift_idem_lookup(text,text,text);
drop function if exists public._vift_staff_name(text);
drop function if exists public._vift_staff_active(text);
drop function if exists public._vift_auth_staff(uuid);
drop function if exists public._vift_ao_number_text(bigint);
drop function if exists public._vift_ao_open_pool(jsonb);
drop function if exists public._vift_ao_locked(jsonb);
drop function if exists public._vift_ao_assigned(jsonb,text);
drop function if exists public._vift_ao_staff(jsonb);
drop function if exists public._vift_ao_eff_perms(text[]);
drop function if exists public._vift_has(text[],text);

commit;
