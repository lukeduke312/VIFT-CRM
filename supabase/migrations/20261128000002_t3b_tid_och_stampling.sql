-- ============================================================
-- T3-B (2026-11-28): tid och stämpling kräver tilldelning (AP-B, SÄK-11,
-- F16/F23, D-11 delvis). NY – EJ INSTALLERAD I STAGING. Kräver
-- 20261128000001_t3b_ao_regler_och_pool.sql (regelfunktionerna _vift_*).
--
-- 1. time_entry_create: NY SIGNATUR (p_caller_staff_id, p_caller_auth_id,
--    p_caller_perms). Under AO-låset (FOR UPDATE, samma låsordning som förut:
--    vift_timeEntries före vift_workOrders):
--      - en post med aoId kräver att anroparen är tilldelad AO:n, eller har
--        ao_edit, eller registrerar åt annan med payroll_manage
--        ('forbidden:not_assigned');
--      - låst AO (fakturerad/avbruten/arkiverad/borttagen) -> 'ao_locked';
--      - aoId som inte finns -> 'not_found';
--      - UNDANTAG (utfört arbete får inte försvinna): utstämpling av en
--        pågående stämpling som startades legitimt tillåts alltid. Villkor:
--        anroparens egen stamp_status-rad är aktiv med samma ao_id och samma
--        ts som postens startTs. Instämplingen kontrollerades vid
--        instämplingen (punkt 3), så omfördelning, klarmarkering eller
--        fakturering under passet tar inte bort det utförda arbetet.
--      - hourRate och priceGroupName sätts av servern från vift_priceGroups
--        (priceGroupId); klientens värden ignoreras och redovisas i
--        ignoredFields. Befintliga poster ändras aldrig (historiska priser).
--      - idempotens bunden till aktör och innehåll ('idempotency_key_conflict').
-- 2. time_entry_patch: samma signatur; byte av aoId kräver tilldelning på
--    den nya AO:n (eller payroll_manage) och att den inte är låst.
-- 3. store_write_stamp_status: samma signatur; instämpling med aoId kräver
--    att anroparen (härledd ur auth-id, samma regel som checkViftAuth) är
--    tilldelad AO:n eller har ao_edit, och att AO:n inte är låst. Instämpling
--    utan AO och utstämpling fungerar som förut.
--
-- STOP-kontroll mot STAGING-md5. Rollback: supabase/rollback/T3-B/rollback_t3b.sql.
-- ============================================================
begin;

do $$
declare v text;
begin
  if to_regprocedure('public._vift_ao_eff_perms(text[])') is null then
    raise exception 'T3-B STOP: 20261128000001 (regelfunktionerna) måste installeras först';
  end if;
  if to_regprocedure('public.time_entry_create(jsonb,text,text)') is null then
    raise exception 'T3-B STOP: time_entry_create(3 argument) saknas — T3-B är redan installerad eller drift; kör inte igen';
  end if;
  v := md5(pg_get_functiondef('public.time_entry_create(jsonb,text,text)'::regprocedure));
  if v not in ('859ef65023890c203caee7c65b11b324') then
    raise exception 'T3-B STOP: time_entry_create avviker från verifierad STAGING-version (md5 %)', v;
  end if;
  v := md5(pg_get_functiondef('public.time_entry_patch(text,jsonb,text,text,text,boolean)'::regprocedure));
  if v not in ('6109ef1b84027e2c32a8ee3c2b47ec10') then
    raise exception 'T3-B STOP: time_entry_patch avviker (md5 %)', v;
  end if;
  v := md5(pg_get_functiondef('public.store_write_stamp_status(uuid,boolean,bigint,text,bigint)'::regprocedure));
  if v not in ('265438f4c6cee7e34d243a4769f30f90') then
    raise exception 'T3-B STOP: store_write_stamp_status avviker (md5 %)', v;
  end if;
end $$;

/* Personal och behörigheter för ett auth-id: samma regel som checkViftAuth
   (app_users.active, e-post -> aktiv vift_staff-post, rollens behörigheter). */
create or replace function public._vift_auth_staff(p_auth uuid)
returns jsonb language sql stable set search_path = public as $$
  with u as (
    select lower(au.email) as email from auth.users au
    join public.app_users ap on ap.user_id = au.id and ap.active = true
    where au.id = p_auth
  ), st as (
    select s from public.store, jsonb_array_elements(case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) s, u
    where key = 'vift_staff' and lower(s ->> 'email') = u.email and coalesce(s ->> 'active', 'false') not in ('false', '0', '')
    limit 1
  ), ro as (
    select r from public.store, jsonb_array_elements(case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) r, st
    where key = 'vift_roles' and r ->> 'id' = st.s ->> 'role'
    limit 1
  )
  select case when exists (select 1 from st) then jsonb_build_object(
    'staffId', (select s ->> 'id' from st),
    'perms', coalesce((select case when jsonb_typeof(r -> 'permissions') = 'array' then r -> 'permissions' else '[]'::jsonb end from ro), '[]'::jsonb))
  else null end
$$;

-- ── 1. time_entry_create ─────────────────────────────────────────────

drop function public.time_entry_create(jsonb, text, text);

create function public.time_entry_create(
  p_entry jsonb, p_idempotency_key text, p_client_id text,
  p_caller_staff_id text, p_caller_auth_id uuid, p_caller_perms text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_existing jsonb; v_entries jsonb; v_workorders jsonb; v_ao_idx int; v_ao jsonb;
  v_seq bigint; v_new_id text; v_collision_idx int;
  v_now timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_safe jsonb; v_new_entry jsonb; v_ao_id text; v_result jsonb; v_fp text;
  v_eff text[]; v_me text := coalesce(p_caller_staff_id, ''); v_for_other boolean;
  v_stamp_ok boolean := false; v_pg jsonb; v_rate numeric := 0; v_ignored text[] := '{}';
begin
  if p_idempotency_key is null or trim(p_idempotency_key) = '' then raise exception 'idempotency_key_required'; end if;
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then raise exception 'missing_fields'; end if;
  if v_me = '' then raise exception 'forbidden'; end if;
  v_eff := public._vift_ao_eff_perms(coalesce(p_caller_perms, '{}'));
  -- En ny post kan aldrig skapas attesterad (oförändrat, försvar i djup).
  v_safe := p_entry - 'attested' - 'attestedAt' - 'attestedBy';
  v_for_other := coalesce(v_safe ->> 'staffId', '') <> '' and v_safe ->> 'staffId' <> v_me;
  if v_for_other and not public._vift_has(v_eff, 'payroll_manage') then raise exception 'forbidden'; end if;
  if not v_for_other and not (public._vift_has(v_eff, 'ao_time') or public._vift_has(v_eff, 'payroll_manage')) then raise exception 'forbidden'; end if;
  v_fp := md5(jsonb_build_array('time_entry_create', v_me, coalesce(p_client_id, ''), p_entry)::text);

  insert into public.store(key, value) values ('vift_timeEntries', '[]'::jsonb) on conflict (key) do nothing;
  select value into v_entries from public.store where key = 'vift_timeEntries' for update;
  v_existing := public._vift_idem_lookup('time_entry_create', p_idempotency_key, v_fp);
  if v_existing is not null then return v_existing; end if;
  if v_entries is null or jsonb_typeof(v_entries) <> 'array' then v_entries := '[]'::jsonb; end if;

  v_ao_id := coalesce(v_safe ->> 'aoId', '');
  if v_ao_id <> '' then
    select value into v_workorders from public.store where key = 'vift_workOrders' for update;
    if v_workorders is not null and jsonb_typeof(v_workorders) = 'array' then
      select (ord - 1) into v_ao_idx from jsonb_array_elements(v_workorders) with ordinality as t(elem, ord)
        where elem ->> 'id' = v_ao_id limit 1;
    end if;
    v_ao := case when v_ao_idx is not null then v_workorders -> v_ao_idx else null end;
    -- Utstämpling av en legitimt pågående stämpling (se filhuvudet).
    if not v_for_other and p_caller_auth_id is not null and coalesce(v_safe ->> 'startTs', '') ~ '^[0-9]+$' then
      select exists (select 1 from public.stamp_status ss where ss.user_id = p_caller_auth_id and ss.active
                     and ss.ao_id = v_ao_id and ss.ts = (v_safe ->> 'startTs')::bigint) into v_stamp_ok;
    end if;
    if not v_stamp_ok then
      if v_ao is null then raise exception 'not_found'; end if;
      if not (v_for_other or public._vift_ao_assigned(v_ao, v_me) or public._vift_has(v_eff, 'ao_edit')) then
        raise exception 'forbidden:not_assigned';
      end if;
      if public._vift_ao_locked(v_ao) then raise exception 'ao_locked'; end if;
    end if;
  end if;

  if p_client_id is not null and trim(p_client_id) <> '' then
    select (ord - 1) into v_collision_idx from jsonb_array_elements(v_entries) with ordinality as t(elem, ord)
      where elem ->> 'id' = p_client_id limit 1;
    if v_collision_idx is not null then raise exception 'id_collision'; end if;
    v_new_id := p_client_id;
  else
    create sequence if not exists public.time_entry_id_seq;
    loop
      v_seq := nextval('public.time_entry_id_seq');
      v_new_id := 'TID-' || lpad(v_seq::text, 3, '0');
      select (ord - 1) into v_collision_idx from jsonb_array_elements(v_entries) with ordinality as t(elem, ord)
        where elem ->> 'id' = v_new_id limit 1;
      if v_collision_idx is null then exit; end if;
    end loop;
  end if;

  -- D-11 (T3-B-delen): timpriset sätts av servern från prisgruppen.
  if coalesce(v_safe ->> 'priceGroupId', '') <> '' then
    select pg into v_pg from public.store, jsonb_array_elements(case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) pg
      where key = 'vift_priceGroups' and pg ->> 'id' = v_safe ->> 'priceGroupId' limit 1;
  end if;
  if v_pg is not null and coalesce(v_pg ->> 'hourRate', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then v_rate := (v_pg ->> 'hourRate')::numeric; end if;
  if v_safe ? 'hourRate' and (coalesce(v_safe ->> 'hourRate', '') !~ '^-?[0-9]+(\.[0-9]+)?$' or (v_safe ->> 'hourRate')::numeric <> v_rate) then
    v_ignored := array_append(v_ignored, 'hourRate');
  end if;
  v_safe := v_safe || jsonb_build_object('hourRate', v_rate);
  if v_pg is not null then
    if v_safe ? 'priceGroupName' and coalesce(v_safe ->> 'priceGroupName', '') <> coalesce(v_pg ->> 'name', '') then v_ignored := array_append(v_ignored, 'priceGroupName'); end if;
    v_safe := v_safe || jsonb_build_object('priceGroupName', coalesce(v_pg ->> 'name', ''));
  end if;

  v_new_entry := (v_safe - 'id') || jsonb_build_object('id', v_new_id, 'createdAt', v_now_text);
  v_entries := jsonb_build_array(v_new_entry) || v_entries;
  update public.store set value = v_entries, updated_at = v_now where key = 'vift_timeEntries';

  if v_ao is not null and not (coalesce(v_ao -> 'timeEntries', '[]'::jsonb) ? v_new_id) then
    v_ao := v_ao || jsonb_build_object('timeEntries', coalesce(v_ao -> 'timeEntries', '[]'::jsonb) || to_jsonb(v_new_id));
    v_workorders := jsonb_set(v_workorders, array[v_ao_idx::text], v_ao);
    update public.store set value = v_workorders, updated_at = v_now where key = 'vift_workOrders';
  end if;

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  v_result := jsonb_build_object('timeEntry', v_new_entry, 'serverSignature', v_now_text);
  if array_length(v_ignored, 1) > 0 then v_result := v_result || jsonb_build_object('ignoredFields', to_jsonb(v_ignored)); end if;
  insert into public.op_idempotency(fn_name, idem_key, result)
    values ('time_entry_create', p_idempotency_key, v_result || jsonb_build_object('_fp', v_fp));
  return v_result;
end $$;

-- ── 2. time_entry_patch (samma signatur, kontroll vid byte av aoId) ──

create or replace function public.time_entry_patch(p_entry_id text, p_patch jsonb, p_idempotency_key text, p_expected_updated_at text, p_caller_staff_id text, p_caller_can_manage_others boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  v_workorders   jsonb;
  v_ao           jsonb;
BEGIN
  IF p_caller_staff_id IS NULL OR btrim(p_caller_staff_id) = '' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      coalesce((SELECT value FROM public.store WHERE key = 'vift_staff'), '[]'::jsonb)
    ) s WHERE s ->> 'id' = p_caller_staff_id
  ) INTO v_caller_valid;
  IF NOT v_caller_valid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  p_caller_can_manage_others := coalesce(p_caller_can_manage_others, false);
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;
  v_scoped_key := p_caller_staff_id || '::' || p_idempotency_key;
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

  IF (v_entry ->> 'staffId') IS DISTINCT FROM p_caller_staff_id
     AND NOT p_caller_can_manage_others THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF (v_entry ->> 'attested')::boolean IS TRUE THEN
    RAISE EXCEPTION 'attested_locked';
  END IF;
  v_patch := p_patch - 'attested' - 'attestedAt' - 'attestedBy';
  IF NOT p_caller_can_manage_others THEN
    v_patch := v_patch - 'staffId' - 'staffName' - 'registeredById' - 'registeredByName';
  END IF;
  IF p_expected_updated_at IS NOT NULL
     AND (v_entry ->> 'createdAt') IS DISTINCT FROM p_expected_updated_at
     AND (v_entry ->> 'updatedAt') IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'stale_write';
  END IF;

  -- T3-B (AP-B): flytt av tidposten till en annan AO kräver tilldelning där
  -- (eller payroll_manage) och att AO:n inte är låst. Kontrollen görs under
  -- AO-låset (låsordning som time_entry_create: tid före AO).
  IF (v_patch ? 'aoId') AND coalesce(v_patch ->> 'aoId', '') <> ''
     AND coalesce(v_patch ->> 'aoId', '') IS DISTINCT FROM coalesce(v_entry ->> 'aoId', '') THEN
    SELECT value INTO v_workorders FROM public.store WHERE key = 'vift_workOrders' FOR UPDATE;
    SELECT elem INTO v_ao FROM jsonb_array_elements(case when jsonb_typeof(v_workorders) = 'array' then v_workorders else '[]'::jsonb end) elem
      WHERE elem ->> 'id' = v_patch ->> 'aoId' LIMIT 1;
    IF v_ao IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
    IF NOT p_caller_can_manage_others AND NOT public._vift_ao_assigned(v_ao, p_caller_staff_id) THEN
      RAISE EXCEPTION 'forbidden:not_assigned';
    END IF;
    IF public._vift_ao_locked(v_ao) THEN RAISE EXCEPTION 'ao_locked'; END IF;
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

-- ── 3. store_write_stamp_status (samma signatur, kontroll vid instämpling med AO) ──

create or replace function public.store_write_stamp_status(p_auth_user_id uuid, p_active boolean, p_ts bigint, p_ao_id text, p_expected_revision bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row       public.stamp_status;
  v_cur_rev   bigint;
  v_new_ts    bigint := case when p_active then p_ts else null end;
  v_new_ao_id text   := case when p_active then p_ao_id else null end;
  v_now       timestamptz := now();
  v_auth      jsonb;
  v_me        text;
  v_perms     text[];
  v_wos       jsonb;
  v_ao        jsonb;
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

  perform pg_advisory_xact_lock(hashtextextended('vift_stamp_status:' || p_auth_user_id::text, 0));
  select * into v_row from public.stamp_status where user_id = p_auth_user_id for update;
  v_cur_rev := coalesce(v_row.revision, 0);

  if v_cur_rev <> p_expected_revision then
    if v_row.user_id is not null
       and v_row.active = p_active
       and coalesce(v_row.ts, -1) = coalesce(v_new_ts, -1)
       and coalesce(v_row.ao_id, '') = coalesce(v_new_ao_id, '')
    then
      return jsonb_build_object('active', v_row.active, 'ts', v_row.ts, 'aoId', v_row.ao_id, 'hasRow', true, 'revision', v_row.revision, 'stale', false, 'replayed', true);
    end if;
    return jsonb_build_object('active', coalesce(v_row.active, false), 'ts', v_row.ts, 'aoId', v_row.ao_id, 'hasRow', v_row.user_id is not null, 'revision', v_cur_rev, 'stale', true, 'replayed', false);
  end if;

  -- T3-B (AP-B, F23): instämpling på en AO kräver tilldelning (eller ao_edit)
  -- och en AO som inte är låst. Kontrollen görs på AO-raden under delat lås
  -- (FOR SHARE) i samma transaktion som skrivningen. Ingen automatisk tagning.
  if p_active and coalesce(p_ao_id, '') <> '' then
    v_auth := public._vift_auth_staff(p_auth_user_id);
    v_me := v_auth ->> 'staffId';
    if coalesce(v_me, '') = '' then raise exception 'forbidden'; end if;
    v_perms := public._vift_ao_eff_perms(array(select jsonb_array_elements_text(v_auth -> 'perms')));
    select value into v_wos from public.store where key = 'vift_workOrders' for share;
    select elem into v_ao from jsonb_array_elements(case when jsonb_typeof(v_wos) = 'array' then v_wos else '[]'::jsonb end) elem
      where elem ->> 'id' = p_ao_id limit 1;
    if v_ao is null then raise exception 'not_found'; end if;
    if not (public._vift_ao_assigned(v_ao, v_me) or public._vift_has(v_perms, 'ao_edit')) then
      raise exception 'forbidden:not_assigned';
    end if;
    if public._vift_ao_locked(v_ao) then raise exception 'ao_locked'; end if;
  end if;

  insert into public.stamp_status (user_id, active, ts, ao_id, revision, updated_at)
    values (p_auth_user_id, p_active, v_new_ts, v_new_ao_id, 1, v_now)
  on conflict (user_id) do update set
    active = excluded.active, ts = excluded.ts, ao_id = excluded.ao_id,
    revision = public.stamp_status.revision + 1, updated_at = excluded.updated_at;

  return jsonb_build_object('active', p_active, 'ts', v_new_ts, 'aoId', v_new_ao_id, 'hasRow', true, 'revision', v_cur_rev + 1, 'stale', false, 'replayed', false);
end;
$function$;

do $$
declare f text;
begin
  foreach f in array array[
    'public._vift_auth_staff(uuid)',
    'public.time_entry_create(jsonb,text,text,text,uuid,text[])',
    'public.time_entry_patch(text,jsonb,text,text,text,boolean)',
    'public.store_write_stamp_status(uuid,boolean,bigint,text,bigint)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
