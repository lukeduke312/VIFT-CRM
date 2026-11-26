-- ============================================================
-- ROLLBACK T4-C (genererad av tests/local/t4c-rollback.js ur en lokal kedja utan
-- 20261128000012 och senare T4-paket, dvs. läget efter T4-B).
-- Tar bort D-23-triggern, återställer de tre ersatta funktionerna EXAKT och tar bort T4-C:s nya
-- funktioner (sensitive_fields_read, _vift_t4c_*). Rör INGEN data: property_sensitive_access och
-- sensitive_access_audit (även T4-C:s revisionsrader) ligger kvar.
-- Ordning vid rollback: 1) föregående EF-version av get-sensitive-fields och föregående klientpaket,
--   2) (om T4-D är installerad) T4-D:s rollback, 3) denna fil, 4) T4-B:s rollback, 5) notisdelens,
--   6) T4-A:s, 7) vid behov T3-E-, T3-D-, T3-C- och T3-B-rollbacken (omvänd ordning).
-- ============================================================
begin;

-- 1. D-23-triggern bort.
drop trigger if exists vift_t4c_kanslig_radering on public.store;

-- 2. Ersatta funktioner (samma signatur) tillbaka till definitionen efter T4-B.
-- _vift_ej_verkstallda()
CREATE OR REPLACE FUNCTION public._vift_ej_verkstallda()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select array['ao_plan_own','objects_access_assigned','rondering_utfor','export_data','export_personal_data']
$function$;
revoke all on function public._vift_ej_verkstallda() from public, anon, authenticated, service_role;
grant execute on function public._vift_ej_verkstallda() to service_role;

-- store_business_key_write(text,jsonb,text,boolean,text,jsonb)
CREATE OR REPLACE FUNCTION public.store_business_key_write(p_key text, p_new_value jsonb, p_expected_hash text, p_caller_authorized boolean, p_actor_id text, p_klient jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_required_perm   text;
  v_current_value   jsonb;
  v_current_hash    text;
  v_now             timestamptz := clock_timestamp();
  v_now_text        text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_current_len     int;
  v_new_len         int;
  v_staff0          jsonb;
  v_roles0          jsonb;
  v_perms           text[];
begin
  p_caller_authorized := coalesce(p_caller_authorized, false);

  if p_key is null or p_new_value is null or p_actor_id is null or length(trim(p_actor_id)) = 0 then
    raise exception 'missing_fields';
  end if;

  v_required_perm := public._staging_business_key_required_perm(p_key);
  if v_required_perm is null then
    raise exception 'key_not_allowlisted';
  end if;
  if not p_caller_authorized then
    raise exception 'forbidden';
  end if;

  if jsonb_typeof(p_new_value) not in ('array', 'object') then
    raise exception 'invalid_value_type';
  end if;

  -- T3-C: personal- och rollregistret under det gemensamma låset (fast ordning).
  if p_key in ('vift_staff', 'vift_roles') then
    perform public._vift_superadmin_lock();
    select value into v_staff0 from public.store where key = 'vift_staff';
    select value into v_roles0 from public.store where key = 'vift_roles';
  end if;

  select value into v_current_value from public.store where key = p_key for update;
  v_current_hash := encode(sha256(convert_to(coalesce(v_current_value, 'null'::jsonb)::text, 'UTF8')), 'hex');

  if v_current_value is not null and (p_expected_hash is null or length(trim(p_expected_hash)) = 0) then
    raise exception 'missing_expected_hash';
  end if;
  if v_current_value is not null and v_current_hash is distinct from p_expected_hash then
    raise exception 'stale_write';
  end if;

  -- T4-A (B5, D-13, D-17, D-01): fältvis sammanslagning av skyddade fält, på det låsta värdet,
  -- med anroparens behörigheter lästa i samma transaktion. Projicerat värde raderar aldrig.
  if array_length(public._vift_t4a_falt(p_key), 1) > 0 then
    v_perms := public._vift_t4a_aktor_perms(p_actor_id);
    if jsonb_typeof(p_new_value) = 'object' then
      p_new_value := public._vift_t4a_sammanfoga(p_key, v_current_value, p_new_value, v_perms);
    else
      p_new_value := public._vift_t4a_sammanfoga_lista(p_key, v_current_value, p_new_value, v_perms);
    end if;
  end if;
  -- T4-A (T3-E-beslutet): en äldre klient tappar inga behörigheter som dess rolleditor inte känner.
  if p_key = 'vift_roles' and jsonb_typeof(p_new_value) = 'array' then
    p_new_value := coalesce((select jsonb_agg(case when jsonb_typeof(n.e) = 'object'
        then public._vift_t4a_roller_bevara(public._vift_reg_get(v_current_value, n.e ->> 'id'), n.e, p_klient) else n.e end order by n.o)
      from jsonb_array_elements(p_new_value) with ordinality n(e, o)), '[]'::jsonb);
  end if;

  -- ANTI-MASSTÖMNING: samma skydd som P0_FINAL_2026-11-04, oförändrat.
  if jsonb_typeof(v_current_value) = 'array' and jsonb_typeof(p_new_value) = 'array' then
    v_current_len := jsonb_array_length(v_current_value);
    v_new_len     := jsonb_array_length(p_new_value);
    if v_current_len > 5 and v_new_len = 0 then
      raise exception 'mass_wipe_blocked';
    end if;
    if v_current_len > 10 and v_new_len::numeric < (v_current_len::numeric * 0.1) then
      raise exception 'mass_wipe_blocked';
    end if;
  end if;

  -- T3-C: eskaleringsregeln och invarianten på det slutliga värdet.
  if p_key = 'vift_staff' then
    perform public._vift_authz_check(p_key, v_staff0, v_roles0, p_new_value, v_roles0, p_actor_id);
  elsif p_key = 'vift_roles' then
    perform public._vift_authz_check(p_key, v_staff0, v_roles0, v_staff0, p_new_value, p_actor_id);
  end if;

  update public.store set value = p_new_value, updated_at = v_now where key = p_key;
  if not found then
    insert into public.store(key, value, updated_at) values (p_key, p_new_value, v_now);
  end if;

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object(
    'key', p_key,
    'newHash', encode(sha256(convert_to(p_new_value::text, 'UTF8')), 'hex'),
    'serverSignature', v_now_text
  );
end;
$function$;
revoke all on function public.store_business_key_write(text,jsonb,text,boolean,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.store_business_key_write(text,jsonb,text,boolean,text,jsonb) to service_role;

-- store_business_key_merge_write(text,jsonb,jsonb,boolean,text,jsonb)
CREATE OR REPLACE FUNCTION public.store_business_key_merge_write(p_key text, p_upserts jsonb, p_removals jsonb, p_caller_authorized boolean, p_actor_id text, p_klient jsonb DEFAULT NULL::jsonb)
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
  v_staff0        jsonb;
  v_roles0        jsonb;
  v_skyddad       boolean := array_length(public._vift_t4a_falt(p_key), 1) > 0;
  v_perms         text[];
  v_proj          jsonb;
  v_ref           jsonb;
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

  -- T3-C: personal- och rollregistret under det gemensamma låset (fast ordning).
  if p_key in ('vift_staff', 'vift_roles') then
    perform public._vift_superadmin_lock();
    select value into v_staff0 from public.store where key = 'vift_staff';
    select value into v_roles0 from public.store where key = 'vift_roles';
  end if;

  select value into v_current from public.store where key = p_key for update;
  if v_skyddad then v_perms := public._vift_t4a_aktor_perms(p_actor_id); end if;

  -- T4-A (D-17, SEC-INST-04/05): vift_settings sammanfogas FÄLT FÖR FÄLT under radlåset.
  -- upserts: {id: fältnamn, data: värde, previous: senast lästa (projicerade) värde};
  -- removals: {id: fältnamn, previous}. Olika fält från samtidiga sessioner tappas aldrig;
  -- samma fält med inaktuell previous blir en konflikt (serverValue projiceras av EF:en).
  if p_key = 'vift_settings' then
    if v_current is null then v_current := '{}'::jsonb; end if;
    if jsonb_typeof(v_current) is distinct from 'object' then raise exception 'not_array_key'; end if;
    v_proj := public._vift_t4a_projicera_elem(p_key, v_current, v_perms);
    for v_elem in select * from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) loop
      v_id := v_elem ->> 'id'; v_new_data := v_elem -> 'data'; v_previous := v_elem -> 'previous';
      if v_previous is not null and jsonb_typeof(v_previous) = 'null' then v_previous := null; end if;
      if v_id is null or length(trim(v_id)) = 0 or v_new_data is null then raise exception 'invalid_element'; end if;
      if v_previous is distinct from (v_proj -> v_id) then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', 'changed_by_other_session'));
        continue;
      end if;
      -- Skyddat fält: samma regel som hela värdet (oförändrat läsbart värde godtas, annars 403).
      -- Ny bild = det anroparen ser + fältet; oläsbara fält återställs från servern av sammanslagningen.
      v_current := public._vift_t4a_sammanfoga(p_key, v_current,
        public._vift_t4a_projicera_elem(p_key, v_current, v_perms) || jsonb_build_object(v_id, v_new_data), v_perms);
      v_applied := v_applied || jsonb_build_array(v_id);
    end loop;
    for v_elem in select * from jsonb_array_elements(coalesce(p_removals, '[]'::jsonb)) loop
      v_id := v_elem ->> 'id'; v_previous := v_elem -> 'previous';
      if v_previous is not null and jsonb_typeof(v_previous) = 'null' then v_previous := null; end if;
      if v_id is null or length(trim(v_id)) = 0 then raise exception 'invalid_element'; end if;
      if not (v_current ? v_id) then continue; end if;
      if v_previous is distinct from (v_proj -> v_id) then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', 'changed_by_other_session'));
        continue;
      end if;
      if not public._vift_t4a_kan_skriva(p_key, v_id, v_current, v_perms) then raise exception 'forbidden:field_protected'; end if;
      v_current := v_current - v_id;
      v_removed := v_removed || jsonb_build_array(v_id);
    end loop;
    update public.store set value = v_current, updated_at = v_now where key = p_key;
    if not found then insert into public.store(key, value, updated_at) values (p_key, v_current, v_now); end if;
    insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
      on conflict (key) do update set value = excluded.value, updated_at = v_now;
    return jsonb_build_object('key', p_key, 'applied', v_applied, 'removed', v_removed, 'conflicts', v_conflicts,
      'current', v_current, 'serverSignature', v_now_text);
  end if;

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
    if v_previous is not null and jsonb_typeof(v_previous) = 'null' then
      v_previous := null;
    end if;
    if v_id is null or length(trim(v_id)) = 0 or v_new_data is null then
      raise exception 'invalid_element';
    end if;

    select count(*) into v_dup_count from jsonb_array_elements(v_current) elem where elem ->> 'id' = v_id;
    if v_dup_count > 1 then
      raise exception 'duplicate_id_in_store';
    end if;

    v_idx := null; v_cur_elem := null;
    select (ord - 1)::int, elem into v_idx, v_cur_elem
      from jsonb_array_elements(v_current) with ordinality as t(elem, ord)
      where elem ->> 'id' = v_id
      limit 1;

    if v_idx is null then
      if v_previous is not null then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', 'removed_by_other_session'));
        continue;
      end if;
      -- T4-A: ett nytt element får inte bära skyddade fält som anroparen inte får skriva.
      if v_skyddad then v_new_data := public._vift_t4a_sammanfoga(p_key, null, v_new_data, v_perms); end if;
      v_current := v_current || jsonb_build_array(v_new_data);
      v_applied := v_applied || jsonb_build_array(v_id);
    else
      -- T4-A: `previous` jämförs med serverns element SÅ SOM ANROPAREN FÅR SE DET (projicerat), så
      -- att en klient som aldrig fått de skyddade fälten kan spara utan att känna dem.
      v_ref := case when v_skyddad then public._vift_t4a_projicera_elem(p_key, v_cur_elem, v_perms) else v_cur_elem end;
      if v_previous is distinct from v_ref then
        v_conflicts := v_conflicts || jsonb_build_array(
          jsonb_build_object('id', v_id, 'reason', 'changed_by_other_session', 'serverValue', v_cur_elem)
        );
        continue;
      end if;
      if v_skyddad then v_new_data := public._vift_t4a_sammanfoga(p_key, v_cur_elem, v_new_data, v_perms); end if;
      if p_key = 'vift_roles' then v_new_data := public._vift_t4a_roller_bevara(v_cur_elem, v_new_data, p_klient); end if;
      v_current := jsonb_set(v_current, array[v_idx::text], v_new_data);
      v_applied := v_applied || jsonb_build_array(v_id);
    end if;
  end loop;

  v_pre_removal_len := jsonb_array_length(v_current);
  v_requested_removal_count := jsonb_array_length(coalesce(p_removals, '[]'::jsonb));
  if v_pre_removal_len > 5 and v_requested_removal_count >= v_pre_removal_len then
    raise exception 'mass_wipe_blocked';
  end if;
  if v_pre_removal_len > 10 and (v_pre_removal_len - v_requested_removal_count)::numeric < (v_pre_removal_len::numeric * 0.1) then
    raise exception 'mass_wipe_blocked';
  end if;

  for v_elem in select * from jsonb_array_elements(coalesce(p_removals, '[]'::jsonb)) loop
    v_id       := v_elem ->> 'id';
    v_previous := v_elem -> 'previous';
    if v_previous is not null and jsonb_typeof(v_previous) = 'null' then
      v_previous := null;
    end if;
    if v_id is null or length(trim(v_id)) = 0 then
      raise exception 'invalid_element';
    end if;

    select count(*) into v_dup_count from jsonb_array_elements(v_current) elem where elem ->> 'id' = v_id;
    if v_dup_count > 1 then
      raise exception 'duplicate_id_in_store';
    end if;

    v_idx := null; v_cur_elem := null;
    select (ord - 1)::int, elem into v_idx, v_cur_elem
      from jsonb_array_elements(v_current) with ordinality as t(elem, ord)
      where elem ->> 'id' = v_id
      limit 1;

    if v_idx is null then
      continue;
    end if;

    v_ref := case when v_skyddad then public._vift_t4a_projicera_elem(p_key, v_cur_elem, v_perms) else v_cur_elem end;
    if v_previous is distinct from v_ref then
      v_conflicts := v_conflicts || jsonb_build_array(
        jsonb_build_object('id', v_id, 'reason', 'changed_by_other_session', 'serverValue', v_cur_elem)
      );
      continue;
    end if;

    v_current := v_current - v_idx;
    v_removed := v_removed || jsonb_build_array(v_id);
  end loop;

  -- T3-C: eskaleringsregeln och invarianten på det slutliga värdet (efter sammanslagning).
  if p_key = 'vift_staff' then
    perform public._vift_authz_check(p_key, v_staff0, v_roles0, v_current, v_roles0, p_actor_id);
  elsif p_key = 'vift_roles' then
    perform public._vift_authz_check(p_key, v_staff0, v_roles0, v_staff0, v_current, p_actor_id);
  end if;

  update public.store set value = v_current, updated_at = v_now where key = p_key;

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

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
revoke all on function public.store_business_key_merge_write(text,jsonb,jsonb,boolean,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.store_business_key_merge_write(text,jsonb,jsonb,boolean,text,jsonb) to service_role;

-- 3. T4-C:s nya funktioner bort (efter att inget längre anropar dem).
drop function if exists public.sensitive_fields_read(text,text,text,text,text,text[],uuid,text);
drop function if exists public._vift_t4c_kanslig_radering();
drop function if exists public._vift_t4c_rondering_aktiv(text[]);
drop function if exists public._vift_t4c_pass_tilldelad(jsonb,text);
drop function if exists public._vift_t4c_pass_aktiv(jsonb);
drop function if exists public._vift_t4c_ao_aktiv(jsonb);

commit;
