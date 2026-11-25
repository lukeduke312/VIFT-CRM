-- ============================================================
-- ROLLBACK T3-C (genererad av tests/local/t3c-rollback.js ur STAGING-facit 2026-11-25).
-- Tar bort F18-vitlistan (trigger, policyer, triggerfunktion), återställer de funktioner som
-- T3-C ersatte EXAKT till STAGING-versionen och tar bort T3-C:s nya funktioner.
-- Rör INGEN data (store, app_users). Körs i en transaktion. Ordning vid rollback:
--   1) store-key-write till föregående version (EF-backup), 2) denna fil,
--   3) föregående klientpaket, 4) vid behov T3-B-rollbacken (omvänd installationsordning).
-- ============================================================
begin;

-- 1. F18: vitlistan för direkt REST-skrivning bort (STAGING:s tidigare policyer gäller igen).
drop trigger if exists protect_direct_write_allowlist on public.store;
drop policy if exists "store_direct_write_allowlist_insert" on public.store;
drop policy if exists "store_direct_write_allowlist_update" on public.store;
drop function if exists public._store_direct_write_guard();

-- 2. Projektionen: nya signaturer bort, STAGING-signaturerna tillbaka (exakt text ur facit).
drop function if exists public.vift_store_project(text,jsonb,text[],text);
drop function if exists public.store_read_all_with_hashes_projected(text[],text[],text);
-- vift_store_project(text,jsonb,text[])
CREATE OR REPLACE FUNCTION public.vift_store_project(p_key text, p_value jsonb, p_perms text[])
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
  offer_stub text[] := array['id','title','status','customerId','propertyId','workOrderId','projectId','versionNumber',
                             'createdAt','updatedAt','deleted','archived'];
begin
  if p_value is null then return null; end if;
  if public.vift_store_full_access(p_key, p) then return p_value; end if;

  if p_key = 'vift_offers' and is_arr then
    if p && array['customer_manage','sales_manage','invoice_view','invoice_create','reports_view','ao_view_all','ao_edit','ao_create'] then
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
    return coalesce((
      select jsonb_agg(case when jsonb_typeof(e) = 'object'
        then (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(e) z(k, v) where k = any(offer_stub))
        else e end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
  end if;

  if p_key = 'vift_settings' and jsonb_typeof(p_value) = 'object' then
    return p_value - array['internalHourlyCost','bankgiro'];
  end if;

  if p_key = 'vift_customers' and is_arr then
    return coalesce((
      select jsonb_agg(case when jsonb_typeof(e) = 'object' then
        case when lower(coalesce(e->>'type','')) in ('privat','private','privatperson')
             then e - array['personnr','orgNr'] else e - 'personnr' end
        else e end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
  end if;

  if p_key = 'vift_propertyObjects' and is_arr then
    return coalesce((
      select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - array['doorCode','keyInformation','accessInformation'] else e end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
  end if;

  if p_key = 'vift_recurringOrders' and is_arr then
    return coalesce((
      select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'accessCode' else e end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
  end if;

  return case jsonb_typeof(p_value) when 'array' then '[]'::jsonb when 'object' then '{}'::jsonb else null end;
end;
$function$;
revoke all on function public.vift_store_project(text,jsonb,text[]) from public, anon, authenticated, service_role;
grant execute on function public.vift_store_project(text,jsonb,text[]) to service_role;

-- store_read_all_with_hashes_projected(text[],text[])
CREATE OR REPLACE FUNCTION public.store_read_all_with_hashes_projected(p_business_keys text[], p_perms text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r jsonb;
  d jsonb;
  out jsonb := '{}'::jsonb;
  k text;
begin
  r := public.store_read_all_with_hashes(p_business_keys);
  d := coalesce(r->'data', '{}'::jsonb);
  for k in select jsonb_object_keys(d) loop
    out := out || jsonb_build_object(k, public.vift_store_project(k, d->k, p_perms));
  end loop;
  return jsonb_build_object('data', out, 'hashes', coalesce(r->'hashes', '{}'::jsonb));
end;
$function$;
revoke all on function public.store_read_all_with_hashes_projected(text[],text[]) from public, anon, authenticated, service_role;
grant execute on function public.store_read_all_with_hashes_projected(text[],text[]) to service_role;

-- 3. Ersatta funktioner (samma signatur) tillbaka till STAGING-definitionen.
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
revoke all on function public.store_business_key_merge_write(text,jsonb,jsonb,boolean,text) from public, anon, authenticated, service_role;
grant execute on function public.store_business_key_merge_write(text,jsonb,jsonb,boolean,text) to service_role;

-- deactivate_vift_user(uuid)
CREATE OR REPLACE FUNCTION public.deactivate_vift_user(p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;

  UPDATE app_users
  SET active = false, disabled_at = now()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingen app_users-rad för user_id = %', p_user_id;
  END IF;

  RETURN format('Inaktiverad: %s', COALESCE(v_email, p_user_id::TEXT));
END;
$function$;
revoke all on function public.deactivate_vift_user(uuid) from public, anon, authenticated, service_role;
grant execute on function public.deactivate_vift_user(uuid) to service_role;

-- provision_vift_user(uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION public.provision_vift_user(p_user_id uuid, p_staff_id text, p_role_id text, p_is_admin boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_email TEXT;
BEGIN
  -- Hämta e-post för loggning
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Ingen auth-användare med user_id = %', p_user_id;
  END IF;

  INSERT INTO app_users (user_id, staff_id, role_id, active, is_admin, created_at)
  VALUES (p_user_id, p_staff_id, p_role_id, true, p_is_admin, now())
  ON CONFLICT (user_id) DO UPDATE SET
    staff_id   = EXCLUDED.staff_id,
    role_id    = EXCLUDED.role_id,
    active     = true,
    is_admin   = EXCLUDED.is_admin,
    disabled_at = NULL;

  RETURN format('Provisionerad: %s (staff_id=%s, role=%s, is_admin=%s)',
                v_email, p_staff_id, p_role_id, p_is_admin);
END;
$function$;
revoke all on function public.provision_vift_user(uuid,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.provision_vift_user(uuid,text,text,boolean) to service_role;

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
    when 'vift_customers'         then p && array['customer_manage','invoice_view','invoice_create','offer_manage','sales_manage','ao_view_all']
    when 'vift_propertyObjects'   then p && array['objects_sensitive']
    when 'vift_recurringOrders'   then p && array['objects_sensitive']
    else true
  end;
end;
$function$;
revoke all on function public.vift_store_full_access(text,text[]) from public, anon, authenticated, service_role;
grant execute on function public.vift_store_full_access(text,text[]) to authenticated;
grant execute on function public.vift_store_full_access(text,text[]) to service_role;

-- 4. T3-C:s nya hjälpfunktioner bort (efter att inget längre anropar dem).
drop function if exists public._vift_authz_check(text,jsonb,jsonb,jsonb,jsonb,text);
drop function if exists public._vift_superadmin_lock();
drop function if exists public._vift_superadmin_count(jsonb,jsonb);
drop function if exists public._vift_identity_perms(jsonb,jsonb);
drop function if exists public._vift_role_perms(jsonb,text);
drop function if exists public._vift_rec_active(jsonb);
drop function if exists public._vift_reg_bad_count(jsonb);
drop function if exists public._vift_reg_get(jsonb,text);
drop function if exists public._vift_perms_beyond(text[],text[],text[]);

commit;
