-- ============================================================
-- ROLLBACK T4-A (genererad av tests/local/t4a-rollback.js ur en lokal kedja utan T4-A,
-- dvs. läget efter T3-E).
-- Återställer store_business_key_write/_merge_write (5 parametrar), vift_store_full_access,
-- vift_store_project, work_order_patch, _vift_ej_verkstallda, _vift_role_perms, vift_caller_perms och
-- _vift_auth_staff EXAKT och tar bort T4-A:s hjälpfunktioner. Rör INGEN data.
-- Ordning vid rollback: 1) T4-B:s rollback (om installerad), 2) föregående EF-versioner
--   (store-key-write, work-orders-list, ao-time-write, work-order-image-delete), 3) denna fil,
--   4) föregående klientpaket, 5) vid behov T3-E-, T3-D-, T3-C- och T3-B-rollbacken (omvänd ordning).
-- ============================================================
begin;

-- 1. Signaturbyte tillbaka: T4-A:s versioner (med p_klient) bort, T3-C-versionerna tillbaka.
drop function if exists public.store_business_key_write(text,jsonb,text,boolean,text,jsonb);
-- store_business_key_write(text,jsonb,text,boolean,text)
CREATE OR REPLACE FUNCTION public.store_business_key_write(p_key text, p_new_value jsonb, p_expected_hash text, p_caller_authorized boolean, p_actor_id text)
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
revoke all on function public.store_business_key_write(text,jsonb,text,boolean,text) from public, anon, authenticated, service_role;
grant execute on function public.store_business_key_write(text,jsonb,text,boolean,text) to service_role;

drop function if exists public.store_business_key_merge_write(text,jsonb,jsonb,boolean,text,jsonb);
-- store_business_key_merge_write(text,jsonb,jsonb,boolean,text)
CREATE OR REPLACE FUNCTION public.store_business_key_merge_write(p_key text, p_upserts jsonb, p_removals jsonb, p_caller_authorized boolean, p_actor_id text)
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
  -- (`previous`) — same real-jsonb-equality check as the upsert branch.
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

    select (ord - 1)::int, elem into v_idx, v_cur_elem
      from jsonb_array_elements(v_current) with ordinality as t(elem, ord)
      where elem ->> 'id' = v_id
      limit 1;

    if v_idx is null then
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
revoke all on function public.store_business_key_merge_write(text,jsonb,jsonb,boolean,text) from public, anon, authenticated, service_role;
grant execute on function public.store_business_key_merge_write(text,jsonb,jsonb,boolean,text) to service_role;

-- 2. Ersatta funktioner (samma signatur) tillbaka till definitionen före T4-A.
-- vift_store_full_access(text,text[])
CREATE OR REPLACE FUNCTION public.vift_store_full_access(p_key text, p_perms text[])
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p text[] := coalesce(p_perms, '{}');
  wp text;
  intern text[] := array['admin_manage','invoice_view','invoice_create','reports_view','offer_manage','ao_view_all','ao_edit'];
  kund text[] := array['customer_manage','invoice_view','invoice_create','offer_manage','sales_manage','ao_view_all'];
begin
  if 'all' = any(p) then return true; end if;
  wp := public._staging_business_key_required_perm(p_key);
  if wp is not null and wp = any(p) then return true; end if;
  return case p_key
    when 'vift_offers'            then p && array['offer_manage']
    when 'vift_offerEvents'       then p && array['offer_manage']
    when 'vift_offerAttachments'  then p && array['offer_manage']
    when 'vift_emailTemplates'    then p && array['offer_manage','admin_manage']
    when 'vift_invoices'          then p && array['invoice_view','invoice_create','reports_view','ao_view_all','ao_edit']
    when 'vift_salesOpps'         then p && array['sales_manage','reports_view']
    when 'vift_contracts'         then p && array['customer_manage','invoice_view','invoice_create','reports_view']
    when 'vift_priceProfiles'     then p && array['article_manage','offer_manage','customer_manage','invoice_create','admin_manage','recurring_manage']
    when 'vift_importLogs'        then p && array['admin_manage']
    when 'vift_serviceMonitorLog' then p && array['admin_manage','ao_view_all']
    when 'vift_settings'          then p && intern
    -- T3-D (K-04): kundposter kan bära portkod/nyckelinformation; hela värdet bara med objects_sensitive.
    -- Övriga läsare av kundregistret får det via projektionen (personnummer kvar för dem, som C-5).
    when 'vift_customers'         then (p && kund) and (p && array['objects_sensitive'])
    when 'vift_propertyObjects'   then p && array['objects_sensitive']
    when 'vift_recurringOrders'   then p && array['objects_sensitive']
    -- T3-C (D-21, D-14): hela personal- och rollregistret bara för den som hanterar dem.
    when 'vift_staff'             then p && array['staff_manage','admin_manage']
    when 'vift_roles'             then false
    -- T3-D (B4, D-15, D-13): övriga får urval per post via store-key-write; REST döljer raden.
    when 'vift_activityLog'       then p && array['ao_view_all']
    when 'vift_activities'        then ('ao_edit' = any(p) and 'ao_view_all' = any(p))
    when 'vift_properties'        then (p && array['objects_sensitive']) and (p && kund)
    when 'vift_propertyContacts'  then p && kund
    else true
  end;
end;
$function$;
revoke all on function public.vift_store_full_access(text,text[]) from public, anon, authenticated, service_role;
grant execute on function public.vift_store_full_access(text,text[]) to authenticated;
grant execute on function public.vift_store_full_access(text,text[]) to service_role;

-- vift_store_project(text,jsonb,text[],text)
CREATE OR REPLACE FUNCTION public.vift_store_project(p_key text, p_value jsonb, p_perms text[], p_caller_staff_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p text[] := coalesce(p_perms, '{}');
  is_arr boolean := jsonb_typeof(p_value) = 'array';
  offer_secret text[] := array['publicToken','tokenCreatedAt','tokenExpiresAt','tokenRevokedAt','lockedSnapshotJSON',
                               'customerApproval','manualApproval','emailSentTo','openCount','openedAt','reminderSentAt','internalNote'];
  -- T3-D (D-12): fältets offertreferens = id, titel, status och den AO den hör till.
  offer_ref text[] := array['id','title','status','workOrderId'];
  -- T3-D (K-04, D-05): portkoder och nyckelinformation lämnas aldrig ut via projektionen.
  sens text[] := array['doorCode','keyInformation','accessInformation','keyReceipt','alarmInformation','accessCode','keyInfo'];
  -- T3-D (D-14): det andra än en själv får se av en kollega.
  staff_fields text[] := array['id','firstName','lastName','name','title','active','color','initials'];
  v_id text := nullif(coalesce(p_caller_staff_id, ''), '');
  v_own_role text;
  v_refs jsonb;
  v_ext boolean;
  kund text[] := array['customer_manage','invoice_view','invoice_create','offer_manage','sales_manage','ao_view_all'];
begin
  if p_value is null then return null; end if;
  if public.vift_store_full_access(p_key, p) then return p_value; end if;

  -- Personalregistret (D-14, D-21, SEC-B3-01..04). Den egna posten oförändrad. ÖVERGÅNG utan
  -- identitet (store-key-write före T3-C): vitlistade fält + role/e-post/telefon, så att
  -- inloggningen fungerar.
  if p_key = 'vift_staff' and is_arr then
    if v_id is null then
      return coalesce((
        select jsonb_agg(case when jsonb_typeof(e) <> 'object' then e else
          (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(e) z(k, v)
           where k = any(staff_fields || array['role','email','phone'])) end order by o)
        from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
    end if;
    v_ext := public._vift_staff_external(p);
    v_refs := case when v_ext and not ('staff_view' = any(p)) then public._vift_post_refs(p, v_id) else '{}'::jsonb end;
    return coalesce((
      select jsonb_agg(case
        when e ->> 'id' = v_id then e
        else (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(e) z(k, v)
              where k = any(staff_fields)
                 or (k = 'role' and 'staff_view' = any(p))
                 or (k in ('phone','email') and not v_ext)) end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (e ->> 'id' = v_id or not v_ext or 'staff_view' = any(p)
            or coalesce(v_refs -> 'staff', '[]'::jsonb) ? coalesce(e ->> 'id', ''))), '[]'::jsonb);
  end if;

  -- T3-C (D-21, SEC-B3-05): rollregistret. Oförändrat.
  if p_key = 'vift_roles' and is_arr then
    if p_caller_staff_id is null then return p_value; end if;
    v_own_role := (select s.e ->> 'role' from public.store st,
                     jsonb_array_elements(case when jsonb_typeof(st.value) = 'array' then st.value else '[]'::jsonb end) with ordinality s(e, o)
                   where st.key = 'vift_staff' and public._vift_rec_active(s.e) and s.e ->> 'id' = p_caller_staff_id
                   order by s.o limit 1);
    return coalesce((
      select jsonb_agg(e order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (
        (v_own_role is not null and e ->> 'id' = v_own_role)
        or ('staff_manage' = any(p) and jsonb_typeof(e -> 'permissions') = 'array'
            and not ((e -> 'permissions') ? 'all')
            and not exists (select 1 from jsonb_array_elements_text(e -> 'permissions') q where not (q = any(p)))))
    ), '[]'::jsonb);
  end if;

  if p_key = 'vift_offers' and is_arr then
    if p && array['customer_manage','sales_manage','invoice_view','invoice_create','reports_view','ao_view_all','ao_edit','ao_create'] then
      -- Interna roller: belopp och rader behövs (rapporter, AO-underlag), men
      -- aldrig token, låst kundversion, kundens godkännandeuppgifter eller interna anteckningar.
      return coalesce((
        select jsonb_agg(
          case when jsonb_typeof(e) = 'object' then
            (e - offer_secret) || case when jsonb_typeof(e->'lines') = 'array'
              then jsonb_build_object('lines', (select coalesce(jsonb_agg(case when jsonb_typeof(l) = 'object' then l - array['calculationNote','inputValues','priceRuleRef'] else l end order by o2), '[]'::jsonb)
                                                from jsonb_array_elements(e->'lines') with ordinality y(l, o2)))
              else '{}'::jsonb end
          else e end order by o)
        from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
    end if;
    -- T3-D (D-12, F9, SEC-OFF-01/02): fält och begränsad roll får bara referensen till
    -- offerter kopplade till AO de ser med innehåll. Inga belopp, rader, token eller andra offerter.
    if v_id is null then return '[]'::jsonb; end if;
    v_refs := public._vift_post_refs(p, v_id);
    return coalesce((
      select jsonb_agg((select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(e) z(k, v) where k = any(offer_ref)) order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (v_refs -> 'offers') ? coalesce(e ->> 'id', '')), '[]'::jsonb);
  end if;

  if p_key = 'vift_settings' and jsonb_typeof(p_value) = 'object' then
    return p_value - array['internalHourlyCost','bankgiro'];
  end if;

  -- T3-D (D-13, SEC-KUND-01/02): kunder, fastigheter, objekt och kontakter.
  if p_key in ('vift_customers','vift_properties','vift_propertyObjects','vift_propertyContacts') and is_arr then
    if not public._vift_kund_las(p) then
      if v_id is null then return '[]'::jsonb; end if;
      v_refs := public._vift_post_refs(p, v_id);
    end if;
    return coalesce((
      select jsonb_agg(case
        -- Läsare av hela kundregistret (C-5:s lista) behåller personnummer som tidigare.
        when p_key = 'vift_customers' and p && kund then e - sens
        when p_key = 'vift_customers' and lower(coalesce(e->>'type','')) in ('privat','private','privatperson') then e - array['personnr','orgNr'] - sens
        when p_key = 'vift_customers' then e - 'personnr' - sens
        else e - sens end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (v_refs is null or case p_key
        when 'vift_customers' then (v_refs -> 'customers') ? coalesce(e ->> 'id', '')
        when 'vift_properties' then (v_refs -> 'properties') ? coalesce(e ->> 'id', '')
        when 'vift_propertyObjects' then (v_refs -> 'objects') ? coalesce(e ->> 'id', '')
        else (v_refs -> 'properties') ? coalesce(e ->> 'propertyId', '')
             and (coalesce(e ->> 'objectId', '') = '' or (v_refs -> 'objects') ? (e ->> 'objectId')) end)), '[]'::jsonb);
  end if;

  if p_key = 'vift_recurringOrders' and is_arr then
    return coalesce((
      select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'accessCode' else e end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
  end if;

  -- T3-D (B4, Q3, SEC-B4-02/03): aktivitetsloggen för fält = AO-händelser för AO som anroparen
  -- ser med innehåll (inte öppen pool). Inga poster med offert-, faktura- eller säljreferens.
  if p_key = 'vift_activityLog' and is_arr then
    if v_id is null then return '[]'::jsonb; end if;
    v_refs := public._vift_post_refs(p, v_id);
    return coalesce((
      select jsonb_agg(e order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and public._vift_activity_ao_type(e ->> 'type')
        and (v_refs -> 'ao') ? coalesce(e ->> 'workOrderId', '')
        and coalesce(e ->> 'offerId', '') = '' and coalesce(e ->> 'invoiceId', '') = ''
        and coalesce(e ->> 'salesOpportunityId', '') = ''), '[]'::jsonb);
  end if;

  -- T3-D (D-15, Ö7, SÄK-2, SEC-TASK-04): egna uppgifter (skapare eller ansvarig) och uppgifter
  -- kopplade till AO där anroparen är tilldelad. ao_view_all ger inte andras uppgifter.
  if p_key = 'vift_activities' and is_arr then
    if v_id is null then return '[]'::jsonb; end if;
    v_refs := case when p && array['ao_view_own','ao_view_all'] then public._vift_post_refs(array['ao_view_own'], v_id) else '{"ao":[]}'::jsonb end;
    return coalesce((
      select jsonb_agg(e order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (coalesce(e ->> 'createdBy', '') = v_id or coalesce(e ->> 'assignedTo', '') = v_id
            or (v_refs -> 'ao') ? coalesce(public._vift_task_ao(e), ''))), '[]'::jsonb);
  end if;

  -- Nycklar som rollen inte ska se alls: tomt värde av samma form.
  return case jsonb_typeof(p_value) when 'array' then '[]'::jsonb when 'object' then '{}'::jsonb else null end;
end;
$function$;
revoke all on function public.vift_store_project(text,jsonb,text[],text) from public, anon, authenticated, service_role;
grant execute on function public.vift_store_project(text,jsonb,text[],text) to service_role;

-- work_order_patch(text,jsonb,text,text,text,text[])
CREATE OR REPLACE FUNCTION public.work_order_patch(p_ao_id text, p_patch jsonb, p_idempotency_key text, p_expected_updated_at text, p_caller_staff_id text, p_caller_perms text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_workorders jsonb; v_idx int; v_ao jsonb; v_updated jsonb; v_existing jsonb;
  v_now timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_fp text; v_result jsonb; v_eff text[]; v_me text := coalesce(p_caller_staff_id, '');
  v_patch jsonb; v_keys text[]; v_ignored text[] := '{}'; v_status text; v_new_log jsonb; v_added jsonb;
  v_can_edit boolean;
begin
  if p_idempotency_key is null or trim(p_idempotency_key) = '' then raise exception 'idempotency_key_required'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'missing_fields'; end if;
  if v_me = '' then raise exception 'forbidden'; end if;

  v_eff := public._vift_ao_eff_perms(coalesce(p_caller_perms, '{}'));
  v_can_edit := public._vift_has(v_eff, 'ao_edit');
  v_patch := p_patch - 'id' - 'createdAt' - 'updatedAt' - 'deleted' - 'deletedAt';
  v_fp := md5(jsonb_build_array('work_order_patch', v_me, p_ao_id, p_patch, coalesce(p_expected_updated_at, ''))::text);

  -- Radlåset FÖRST: alla kontroller nedan, även idempotensen, görs på den låsta raden.
  select value into v_workorders from public.store where key = 'vift_workOrders' for update;
  v_existing := public._vift_idem_lookup('work_order_patch', p_idempotency_key, v_fp);
  if v_existing is not null then return v_existing; end if;
  if v_workorders is null or jsonb_typeof(v_workorders) <> 'array' then raise exception 'not_found'; end if;
  select (ord - 1) into v_idx from jsonb_array_elements(v_workorders) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_ao_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_ao := v_workorders -> v_idx;

  if p_expected_updated_at is not null and (v_ao ->> 'updatedAt') is distinct from p_expected_updated_at then
    raise exception 'stale_write';
  end if;

  select coalesce(array_agg(k), '{}') into v_keys from jsonb_object_keys(v_patch) k;
  v_status := v_patch ->> 'status';

  if v_can_edit then
    -- Arbetsledare (ao_edit/all): fri patch utom faktureringsfälten.
    -- D-07/F21: faktureringsfält ändras aldrig här, oavsett roll (även 'all').
    -- (Fältets grenar nedan tillåter bara uppräknade fält och kan inte röra dem.)
    if public._vift_ao_billing_touched(v_ao, v_patch) then
      raise exception 'forbidden:invoice_path_required';
    end if;
    v_updated := v_ao || v_patch;
    -- AP-G: personal tilldelas en pool-AO -> den återvänder inte till öppen
    -- pool om personalen senare tas bort (poolOpen=false), om inte patchen säger annat.
    if (v_patch ? 'staff') and not (v_patch ? 'poolOpen')
       and coalesce(v_updated ->> 'status', '') = 'pool'
       and jsonb_array_length(public._vift_ao_staff(v_updated)) > 0
       and jsonb_array_length(public._vift_ao_staff(v_ao)) = 0 then
      v_updated := v_updated || jsonb_build_object('poolOpen', false);
    end if;
    if v_status = 'klar' and coalesce(v_ao ->> 'status', '') <> 'klar' then
      if coalesce(v_patch ->> 'completedAt', '') = '' then v_updated := v_updated || jsonb_build_object('completedAt', v_now_text); end if;
      if coalesce(v_patch ->> 'completedBy', '') = '' then v_updated := v_updated || jsonb_build_object('completedBy', v_me); end if;
    end if;

  elsif v_keys <@ array['materials'] and array_length(v_keys, 1) = 1 then
    -- Fältets materialpatch: ao_material, tilldelad, inte låst, bara egna rader.
    if not public._vift_has(v_eff, 'ao_material') then raise exception 'forbidden'; end if;
    if not (public._vift_ao_assigned(v_ao, v_me) or public._vift_has(v_eff, 'ao_view_all')) then raise exception 'forbidden:not_assigned'; end if;
    if public._vift_ao_locked(v_ao) then raise exception 'ao_locked'; end if;
    if jsonb_typeof(v_patch -> 'materials') <> 'array' or jsonb_array_length(v_patch -> 'materials') > 500 then raise exception 'missing_fields'; end if;
    v_updated := v_ao || jsonb_build_object('materials', public._vift_ao_material_merge(v_ao -> 'materials', v_patch -> 'materials', v_me, v_now_text));

  elsif v_status = 'pågående' and v_keys <@ array['status'] then
    -- Starta egen (D-03, R07): ao_start_own, tilldelad, källstatus nytt/planerad/pool.
    if not public._vift_has(v_eff, 'ao_start_own') then raise exception 'forbidden'; end if;
    if not public._vift_ao_assigned(v_ao, v_me) then raise exception 'forbidden:not_assigned'; end if;
    if public._vift_ao_locked(v_ao) then raise exception 'ao_locked'; end if;
    if coalesce(v_ao ->> 'status', '') not in ('nytt', 'planerad', 'pool') then raise exception 'invalid_source_status'; end if;
    v_updated := v_ao || jsonb_build_object('status', 'pågående', 'startedAt', coalesce(nullif(v_ao ->> 'startedAt', ''), v_now_text),
                                            'startedBy', coalesce(nullif(v_ao ->> 'startedBy', ''), v_me));

  elsif v_status = 'klar' and v_keys <@ array['status', 'completedAt', 'completedBy'] then
    -- Klarmarkera (D-03, R08): ao_complete_own på egen tilldelad AO, eller
    -- ao_complete + ao_view_all (valfri synlig). Servern sätter completedBy/At.
    if public._vift_has(v_eff, 'ao_complete') and public._vift_has(v_eff, 'ao_view_all') then
      null;
    elsif public._vift_has(v_eff, 'ao_complete_own') then
      if not public._vift_ao_assigned(v_ao, v_me) then raise exception 'forbidden:not_assigned'; end if;
    else
      raise exception 'forbidden';
    end if;
    if public._vift_ao_locked(v_ao) then raise exception 'ao_locked'; end if;
    if coalesce(v_ao ->> 'status', '') not in ('nytt', 'planerad', 'pool', 'pågående') then raise exception 'invalid_source_status'; end if;
    if v_patch ? 'completedAt' then v_ignored := array_append(v_ignored, 'completedAt'); end if;
    if v_patch ? 'completedBy' then v_ignored := array_append(v_ignored, 'completedBy'); end if;
    v_updated := v_ao || jsonb_build_object('status', 'klar', 'completedAt', v_now_text, 'completedBy', v_me);

  elsif v_status = 'planerad' and (v_patch ? 'staff') and v_keys <@ array['staff', 'status', 'log'] then
    -- "Ta jobbet" i v3.4-klientens form: samma atomiska regel som work_order_pool_take.
    if not public._vift_has(v_eff, 'ao_pool_take') then raise exception 'forbidden'; end if;
    if jsonb_typeof(v_patch -> 'staff') <> 'array' or v_patch -> 'staff' <> (public._vift_ao_staff(v_ao) || jsonb_build_array(v_me)) then
      if jsonb_array_length(public._vift_ao_staff(v_ao)) > 0 then raise exception 'already_assigned'; end if;
      raise exception 'forbidden:field_not_allowed';
    end if;
    v_new_log := case when jsonb_typeof(v_patch -> 'log') = 'array' then v_patch -> 'log' else '[]'::jsonb end;
    select n.e into v_added from jsonb_array_elements(v_new_log) as n(e)
      where n.e ->> 'type' = 'taken_from_pool'
        and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_ao -> 'log') = 'array' then v_ao -> 'log' else '[]'::jsonb end) as o(e) where o.e ->> 'id' = n.e ->> 'id')
      limit 1;
    v_updated := public._vift_ao_take(v_ao, v_me, v_added ->> 'id', v_now_text);

  else
    raise exception 'forbidden:field_not_allowed';
  end if;

  v_updated := v_updated || jsonb_build_object('updatedAt', v_now_text);
  v_workorders := jsonb_set(v_workorders, array[v_idx::text], v_updated);
  update public.store set value = v_workorders, updated_at = v_now where key = 'vift_workOrders';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('workOrder', v_updated, 'serverSignature', v_now_text);
  if array_length(v_ignored, 1) > 0 then v_result := v_result || jsonb_build_object('ignoredFields', to_jsonb(v_ignored)); end if;
  insert into public.op_idempotency(fn_name, idem_key, result)
    values ('work_order_patch', p_idempotency_key, v_result || jsonb_build_object('_fp', v_fp));
  return v_result;
end $function$;
revoke all on function public.work_order_patch(text,jsonb,text,text,text,text[]) from public, anon, authenticated, service_role;
grant execute on function public.work_order_patch(text,jsonb,text,text,text,text[]) to service_role;

-- _vift_ej_verkstallda()
CREATE OR REPLACE FUNCTION public._vift_ej_verkstallda()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select array['ao_plan_own','cost_view','cost_edit','time_view_all','bankgiro_edit','personal_data_view',
               'objects_access_assigned','rondering_utfor','export_data','export_personal_data']
$function$;
revoke all on function public._vift_ej_verkstallda() from public, anon, authenticated, service_role;
grant execute on function public._vift_ej_verkstallda() to service_role;

-- _vift_role_perms(jsonb,text)
CREATE OR REPLACE FUNCTION public._vift_role_perms(p_roles jsonb, p_role_id text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  with r as (
    select x.e from jsonb_array_elements(case when jsonb_typeof(p_roles) = 'array' then p_roles else '[]'::jsonb end) with ordinality x(e, o)
    where jsonb_typeof(x.e) = 'object' and x.e ->> 'id' = p_role_id
    order by x.o limit 1)
  select coalesce((select case when jsonb_typeof(r.e -> 'permissions') = 'array'
      then array(select jsonb_array_elements_text(r.e -> 'permissions')) else '{}'::text[] end from r), '{}'::text[])
$function$;
revoke all on function public._vift_role_perms(jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public._vift_role_perms(jsonb,text) to service_role;

-- vift_caller_perms()
CREATE OR REPLACE FUNCTION public.vift_caller_perms()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with u as (
    select lower(au.email) as email
    from auth.users au
    join public.app_users ap on ap.user_id = au.id and ap.active = true
    where au.id = auth.uid()
  ),
  st as (
    select s
    from public.store, jsonb_array_elements(case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) s, u
    where key = 'vift_staff' and lower(s->>'email') = u.email
      and coalesce(s->>'active', 'false') not in ('false', '0', '')
    limit 1
  ),
  ro as (
    select r
    from public.store, jsonb_array_elements(case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) r, st
    where key = 'vift_roles' and r->>'id' = st.s->>'role'
    limit 1
  )
  select coalesce(
    (select array(select jsonb_array_elements_text(case when jsonb_typeof(r->'permissions') = 'array' then r->'permissions' else '[]'::jsonb end)) from ro),
    '{}'::text[])
$function$;
revoke all on function public.vift_caller_perms() from public, anon, authenticated, service_role;
grant execute on function public.vift_caller_perms() to authenticated;
grant execute on function public.vift_caller_perms() to service_role;

-- _vift_auth_staff(uuid)
CREATE OR REPLACE FUNCTION public._vift_auth_staff(p_auth uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;
revoke all on function public._vift_auth_staff(uuid) from public, anon, authenticated, service_role;
grant execute on function public._vift_auth_staff(uuid) to service_role;

-- 3. T4-A:s nya hjälpfunktioner bort (efter att inget längre anropar dem).
drop function if exists public._vift_t4a_roll_aktiv(jsonb);
drop function if exists public._vift_t4a_giltig(text[]);
drop function if exists public._vift_t4a_legacy(text[]);
drop function if exists public._vift_t4a_kontakt(text[]);
drop function if exists public._vift_t4a_logg_full(text[]);
drop function if exists public._vift_t4a_privat(jsonb);
drop function if exists public._vift_t4a_tom(jsonb);
drop function if exists public._vift_t4a_falt(text);
drop function if exists public._vift_t4a_kan_lasa(text,text,jsonb,text[]);
drop function if exists public._vift_t4a_kan_skriva(text,text,jsonb,text[]);
drop function if exists public._vift_t4a_alla_lasbara(text,text[]);
drop function if exists public._vift_t4a_projicera_elem(text,jsonb,text[]);
drop function if exists public._vift_t4a_sammanfoga(text,jsonb,jsonb,text[]);
drop function if exists public._vift_t4a_sammanfoga_lista(text,jsonb,jsonb,text[]);
drop function if exists public._vift_t4a_aktor_perms(text);
drop function if exists public._vift_t4a_roller_bevara(jsonb,jsonb,jsonb);
drop function if exists public._vift_t4a_ao_patch(jsonb,jsonb,text[]);
drop function if exists public._vift_t4a_ao_ref(text[],text,text);

commit;
