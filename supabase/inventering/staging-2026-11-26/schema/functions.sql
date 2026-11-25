-- STAGING (yyzljlqyzzcbxmcdbual) schema-ögonblicksbild 2026-11-25, endast läsning (SELECT). Ingen verksamhetsdata.
-- Alla egna funktioner i schema public (extension-ägda exkluderade), 64 st.
-- Per funktion: ägare, SECURITY DEFINER, proconfig, EXECUTE-grants (från proacl) som kommentar, sedan pg_get_functiondef().

-- OBS execute_grants-kommentaren nedan listar namngivna roller; PUBLIC (=X) visas inte där. Kontroll (proacl):
--   ingen SECURITY DEFINER-funktion har EXECUTE för PUBLIC/anon/authenticated utom vift_caller_perms och
--   vift_store_full_access (authenticated, används av RLS-policyn store_read_by_role).
--   Följande 5 icke-SD-hjälpfunktioner har EXECUTE för PUBLIC, anon och authenticated (plattformens default):
--   _invoice_calc_financial, _invoice_financial_check, _protect_critical_store_keys,
--   _protect_notifications_and_legacy_keys, _rondering_recompute_summary.

-- ====================================================================
-- public._invoice_calc_financial(p_inv jsonb)
-- owner=postgres security_definer=False config=-
-- execute_grants: anon:EXECUTE,authenticated:EXECUTE,postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public._invoice_calc_financial(p_inv jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_line         jsonb;
  v_qty          numeric;
  v_price        numeric;
  v_vat          numeric;
  v_linesEx      numeric := 0;
  v_linesVat     numeric := 0;
  v_disc         jsonb;
  v_discType     text;
  v_discValue    numeric;
  v_discAmt      numeric := 0;
  v_ratio        numeric;
  v_exVat        numeric;
  v_vatAmt       numeric;
  v_totalInclVat numeric;
  v_tr           jsonb;
  v_trType       text;
  v_trAmountText text;
  v_trAmount     numeric;
  v_customerPays numeric;
begin
  for v_line in select * from jsonb_array_elements(coalesce(p_inv -> 'lines', '[]'::jsonb)) loop
    v_qty   := case when jsonb_typeof(v_line -> 'qty') = 'number' then (v_line->>'qty')::numeric else 0 end;
    v_price := case when jsonb_typeof(v_line -> 'unitPrice') = 'number' then (v_line->>'unitPrice')::numeric else 0 end;
    if jsonb_typeof(v_line -> 'vatRate') = 'number' then
      v_vat := (v_line->>'vatRate')::numeric;
      if v_vat is null or v_vat < 0 or v_vat > 100 then v_vat := 25; end if;
    else
      v_vat := 25;
    end if;
    v_linesEx  := v_linesEx + v_qty * v_price;
    v_linesVat := v_linesVat + v_qty * v_price * (v_vat / 100);
  end loop;

  v_disc      := coalesce(p_inv -> 'discount', jsonb_build_object('type', 'none', 'value', 0));
  v_discType  := v_disc ->> 'type';
  v_discValue := coalesce((v_disc ->> 'value')::numeric, 0);
  if v_discType = 'percent' and v_discValue > 0 then
    v_discAmt := round(v_linesEx * v_discValue / 100, 2);
  elsif v_discType = 'fixed' and v_discValue > 0 then
    v_discAmt := least(v_discValue, v_linesEx);
  end if;

  if v_linesEx > 0 then v_ratio := 1 - v_discAmt / v_linesEx; else v_ratio := 1; end if;
  v_exVat        := round(v_linesEx - v_discAmt, 2);
  v_vatAmt       := round(v_linesVat * v_ratio, 2);
  v_totalInclVat := v_exVat + v_vatAmt;

  v_tr     := coalesce(p_inv -> 'taxReduction', jsonb_build_object('type', 'none', 'amount', 0));
  v_trType := v_tr ->> 'type';
  if v_trType in ('rot', 'rut') and (v_tr ? 'amount') then
    v_trAmountText := v_tr ->> 'amount';
    if v_trAmountText is null or trim(v_trAmountText) = '' then
      v_trAmount := 0;
    else
      v_trAmount := v_trAmountText::numeric;
    end if;
  else
    v_trAmount := 0;
  end if;

  v_customerPays := v_totalInclVat - v_trAmount;

  return jsonb_build_object(
    'linesEx', v_linesEx, 'linesVat', v_linesVat, 'discAmt', v_discAmt,
    'exVat', v_exVat, 'vat', v_vatAmt, 'totalInclVat', v_totalInclVat,
    'trAmount', v_trAmount, 'customerPays', v_customerPays
  );
end;
$function$;

-- ====================================================================
-- public._invoice_financial_check(p_inv jsonb)
-- owner=postgres security_definer=False config=-
-- execute_grants: anon:EXECUTE,authenticated:EXECUTE,postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public._invoice_financial_check(p_inv jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_s            jsonb;
  v_totalInclVat numeric;
  v_trAmount     numeric;
  v_customerPays numeric;
begin
  v_s := public._invoice_calc_financial(p_inv);
  v_totalInclVat := (v_s ->> 'totalInclVat')::numeric;
  v_trAmount     := (v_s ->> 'trAmount')::numeric;
  v_customerPays := (v_s ->> 'customerPays')::numeric;

  /* Postgres `numeric` accepterar det speciella värdet 'NaN' (till
     skillnad från JSON-talstypen, som aldrig kan vara NaN) — och ett
     sådant NaN är INTE `< 0` (det sorteras som "större än alla andra
     tal", inte jämförbart i vanlig mening). Ett explicit
     `= 'NaN'::numeric`-test krävs alltså HÄR (NaN = NaN utvärderas till
     TRUE i Postgres, till skillnad från IEEE754) — annars hade en
     textsträng `"NaN"` i `taxReduction.amount` (redan avvisad vid källan
     i invoice_tax_reduction_set, se där — men denna funktion måste vara
     fail-closed OBEROENDE av anroparen, samma princip som i hela denna
     fil). */
  if v_totalInclVat is null or v_totalInclVat = 'NaN'::numeric or v_totalInclVat < 0 then
    raise exception 'financial_invariant_violation';
  end if;
  if v_trAmount is null or v_trAmount = 'NaN'::numeric or v_trAmount < 0 then
    raise exception 'financial_invariant_violation';
  end if;
  if v_trAmount > v_totalInclVat then
    raise exception 'financial_invariant_violation';
  end if;
  if v_customerPays is null or v_customerPays = 'NaN'::numeric or v_customerPays < 0 then
    raise exception 'financial_invariant_violation';
  end if;
end;
$function$;

-- ====================================================================
-- public._invoice_fixed_stale_snapshot(p_invoice jsonb, p_workorders jsonb)
-- owner=postgres security_definer=False config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public._invoice_fixed_stale_snapshot(p_invoice jsonb, p_workorders jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_line jsonb; v_ref jsonb; v_ao jsonb; v_aoid text;
  v_price numeric; v_fixed numeric; v_items jsonb := '[]'::jsonb;
  v_sorted jsonb;
begin
  if jsonb_typeof(coalesce(p_workorders, 'null'::jsonb)) <> 'array' then
    raise exception 'stale_check_unavailable';
  end if;
  for v_line in select value from jsonb_array_elements(coalesce(p_invoice -> 'lines','[]'::jsonb)) as t(value) loop
    v_ref := null;
    select r.value into v_ref
    from jsonb_array_elements(coalesce(v_line -> 'sourceRefs','[]'::jsonb)) as r(value)
    where r.value ->> 'sourceType' = 'fixed'
      and nullif(r.value ->> 'workOrderId','') is not null
    limit 1;
    if v_ref is null then continue; end if;
    v_aoid := v_ref ->> 'workOrderId';
    v_ao := null;
    select a.value into v_ao from jsonb_array_elements(p_workorders) a(value)
      where a.value ->> 'id' = v_aoid limit 1;
    if v_ao is null then continue; end if;
    -- Fail closed on malformed monetary types, rather than accidentally
    -- treating an unparseable AO price as evidence that all is correct.
    if jsonb_typeof(v_ao -> 'fixedPrice') not in ('number','string')
       or jsonb_typeof(v_line -> 'unitPrice') not in ('number','string') then
      raise exception 'stale_check_unavailable';
    end if;
    begin
      v_fixed := (v_ao ->> 'fixedPrice')::numeric;
      v_price := (v_line ->> 'unitPrice')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'stale_check_unavailable';
    end;
    if v_fixed > 0 and v_price is distinct from v_fixed then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'lineId',v_line ->> 'id','workOrderId',v_aoid,
        'lineUnitPrice',v_price,'aoFixedPrice',v_fixed
      ));
    end if;
  end loop;
  select coalesce(jsonb_agg(x.value order by x.value ->> 'lineId'),'[]'::jsonb)
    into v_sorted from jsonb_array_elements(v_items) as x(value);
  return v_sorted;
end;
$function$;

-- ====================================================================
-- public._protect_critical_store_keys()
-- owner=postgres security_definer=False config=-
-- execute_grants: anon:EXECUTE,authenticated:EXECUTE,postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public._protect_critical_store_keys()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_protected text[] := array['vift_invoices', 'vift_workOrders', 'vift_timeEntries'];
  v_blocked_key text;
begin
  if tg_op = 'DELETE' then
    if old.key = any(v_protected) then
      v_blocked_key := old.key;
    end if;
  elsif tg_op = 'INSERT' then
    if new.key = any(v_protected) then
      v_blocked_key := new.key;
    end if;
  elsif tg_op = 'UPDATE' then
    -- Skyddar BÅDA riktningarna: en vanlig uppdatering av en redan
    -- skyddad nyckel (new.key = old.key, skyddad) OCH ett nyckelbyte
    -- i NÅGON riktning (in till, eller ut från, en skyddad nyckel).
    if old.key = any(v_protected) then
      v_blocked_key := old.key;
    elsif new.key = any(v_protected) then
      v_blocked_key := new.key;
    end if;
  end if;

  if v_blocked_key is not null and current_user <> 'postgres' then
    raise exception 'direct_write_blocked: nyckeln "%" (operation %) kan endast skrivas/ändras/raderas via en godkänd, atomisk RPC-funktion, inte direkt', v_blocked_key, tg_op;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

-- ====================================================================
-- public._protect_notifications_and_legacy_keys()
-- owner=postgres security_definer=False config=search_path=public
-- execute_grants: anon:EXECUTE,authenticated:EXECUTE,postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public._protect_notifications_and_legacy_keys()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_key       text := coalesce(new.key, old.key);
  v_old       jsonb;
  v_new       jsonb;
  v_old_by_id jsonb;
  v_new_by_id jsonb;
  v_id        text;
  v_oe        jsonb;
  v_ne        jsonb;
begin
  -- Every SECURITY DEFINER RPC in this codebase (invoice_*, store_*,
  -- sensitive_fields_write, etc.) is owned by `postgres`. When one of
  -- those RPCs does its own `insert/update ... public.store` from
  -- PL/pgSQL, THIS trigger fires as part of that same write statement,
  -- and because the RPC itself (not this trigger) is SECURITY DEFINER,
  -- `current_user` for the duration of the RPC's body -- and therefore
  -- for this trigger's firing inside it -- genuinely IS `postgres`, the
  -- RPC's owner. So this check correctly exempts every such RPC's own
  -- writes, while still seeing the real caller (`authenticated`/`anon`)
  -- for a direct REST write that never goes through any RPC at all.
  if current_user = 'postgres' then
    return coalesce(new, old);
  end if;
  -- The service-monitor and other EFs that legitimately write with the
  -- service-role key run as `service_role`, which already bypasses RLS;
  -- this trigger does not add a SEPARATE restriction on top of that.
  if current_user = 'service_role' then
    return coalesce(new, old);
  end if;

  -- A4 bypass guard: on UPDATE, checking only NEW.key is insufficient.
  -- An authenticated caller could rename an EXISTING protected key to an
  -- unprotected key and bypass both the legacy-key and notification
  -- content-integrity checks below. Forbid renames in either direction
  -- whenever EITHER side of the rename is a protected key.
  if TG_OP = 'UPDATE'
     and old.key is distinct from new.key
     and (
       old.key in ('vift_notifications', 'vift_stampActive', 'vift_stampTs',
                   'vift_stampAoId', 'vift_serviceMonitorLog')
       or new.key in ('vift_notifications', 'vift_stampActive', 'vift_stampTs',
                      'vift_stampAoId', 'vift_serviceMonitorLog')
     ) then
    raise exception 'direct_write_blocked' using errcode = '42501';
  end if;

  if v_key in ('vift_stampActive', 'vift_stampTs', 'vift_stampAoId', 'vift_serviceMonitorLog') then
    raise exception 'direct_write_blocked' using errcode = '42501';
  end if;

  if v_key = 'vift_notifications' then
    if TG_OP = 'DELETE' then
      raise exception 'direct_write_blocked' using errcode = '42501';
    end if;
    v_new := new.value;
    if jsonb_typeof(v_new) <> 'array' then
      raise exception 'direct_write_blocked' using errcode = '42501';
    end if;
    if jsonb_array_length(v_new) > 5000 then
      raise exception 'direct_write_blocked' using errcode = '42501';
    end if;
    -- Reject duplicate/missing identifiers: jsonb_object_agg() otherwise
    -- collapses duplicate keys and defeats the per-item tamper check.
    if exists (
      select 1 from jsonb_array_elements(v_new) e
      where nullif(e->>'id','') is null or nullif(e->>'createdAt','') is null
    ) or (select count(distinct e->>'id') from jsonb_array_elements(v_new) e)
         <> jsonb_array_length(v_new) then
      raise exception 'direct_write_blocked' using errcode = '42501';
    end if;
    v_old := coalesce(old.value, '[]'::jsonb);
    if jsonb_typeof(v_old) <> 'array' then
      v_old := '[]'::jsonb;
    end if;

    select coalesce(jsonb_object_agg(e ->> 'id', e), '{}'::jsonb) into v_old_by_id
      from jsonb_array_elements(v_old) e where e ? 'id';
    select coalesce(jsonb_object_agg(e ->> 'id', e), '{}'::jsonb) into v_new_by_id
      from jsonb_array_elements(v_new) e where e ? 'id';

    -- Every notification that already existed must still exist in the
    -- new value, and the ONLY field an authenticated write may change on
    -- it is `read` (a user marking a notification read/unread) -- no
    -- other field of an EXISTING entry (message/type/userId/createdAt/
    -- aoId/offerId) may be altered, and no existing entry may be removed,
    -- by this direct path. Adding brand-new entries (notifying someone)
    -- is unrestricted here -- that is NotificationsService.push()'s own,
    -- pre-existing, accepted behavior, not something this guard changes.
    for v_id in select jsonb_object_keys(v_old_by_id) loop
      v_oe := v_old_by_id -> v_id;
      v_ne := v_new_by_id -> v_id;
      if v_ne is null then
        -- Existing persistNotifs() intentionally caps the canonical list
        -- at 5000 entries. When a new notification arrives at that cap,
        -- allow pruning ONLY the chronologically OLDEST items, never an
        -- arbitrary existing message. No deletions allowed below the cap.
        if jsonb_array_length(v_old) < 5000
           or jsonb_array_length(v_new) <> 5000
           or not exists (
             select 1 from jsonb_array_elements(v_new) n
             where not (v_old_by_id ? (n->>'id'))
           )
           or coalesce(v_oe->>'createdAt','') > coalesce(
             (select min(n->>'createdAt') from jsonb_array_elements(v_new) n), ''
           )
        then
          raise exception 'direct_write_blocked' using errcode = '42501';
        end if;
        continue;
      end if;
      if (v_oe - 'read') is distinct from (v_ne - 'read') then
        raise exception 'direct_write_blocked' using errcode = '42501';
      end if;
    end loop;
  end if;

  return coalesce(new, old);
end;
$function$;

-- ====================================================================
-- public._rondering_recompute_summary(p_categories jsonb)
-- owner=postgres security_definer=False config=-
-- execute_grants: anon:EXECUTE,authenticated:EXECUTE,postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public._rondering_recompute_summary(p_categories jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_total int := 0;
  v_ok int := 0;
  v_anm int := 0;
  v_ejk int := 0;
  v_eja int := 0;
  v_cat jsonb;
  v_pt jsonb;
  v_status text;
begin
  for v_cat in select * from jsonb_array_elements(coalesce(p_categories, '[]'::jsonb))
  loop
    for v_pt in select * from jsonb_array_elements(coalesce(v_cat -> 'points', '[]'::jsonb))
    loop
      v_total := v_total + 1;
      v_status := v_pt ->> 'status';
      if v_status = 'ok' then v_ok := v_ok + 1;
      elsif v_status = 'anmärkning' then v_anm := v_anm + 1;
      elsif v_status = 'ej_kontrollerad' then v_ejk := v_ejk + 1;
      elsif v_status = 'ej_aktuell' then v_eja := v_eja + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object(
    'total', v_total, 'ok', v_ok, 'anmärkningar', v_anm,
    'ejKontrollerad', v_ejk, 'ejAktuell', v_eja
  );
end;
$function$;

-- ====================================================================
-- public._staging_business_key_required_perm(p_key text)
-- owner=postgres security_definer=False config=-
-- execute_grants: authenticated:EXECUTE,postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public._staging_business_key_required_perm(p_key text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_key
    WHEN 'vift_customers'          THEN 'customer_manage'
    WHEN 'vift_properties'         THEN 'customer_manage'
    WHEN 'vift_propertyContacts'   THEN 'customer_manage'
    WHEN 'vift_propertyRoles'      THEN 'customer_manage'
    WHEN 'vift_propertyCategories' THEN 'customer_manage'
    WHEN 'vift_propertyObjects'    THEN 'customer_manage'
    WHEN 'vift_deviationCategories' THEN 'customer_manage'
    WHEN 'vift_inspections'        THEN 'customer_manage'
    WHEN 'vift_contracts'          THEN 'customer_manage'
    WHEN 'vift_offers'             THEN 'offer_manage'
    WHEN 'vift_salesOpps'          THEN 'sales_manage'
    WHEN 'vift_recurringOrders'    THEN 'recurring_manage'
    WHEN 'vift_ronderingar'        THEN 'ao_view_all'
    WHEN 'vift_ronderingsmallar'   THEN 'ao_view_all'
    WHEN 'vift_avvikelser'         THEN 'ao_view_all'
    WHEN 'vift_staff'              THEN 'staff_manage'
    WHEN 'vift_roles'              THEN 'admin_manage'
    WHEN 'vift_settings'           THEN 'admin_manage'
    WHEN 'vift_titles'             THEN 'admin_manage'
    WHEN 'vift_articles'           THEN 'article_manage'
    WHEN 'vift_priceGroups'        THEN 'article_manage'
    WHEN 'vift_priceProfiles'      THEN 'article_manage'
    WHEN 'vift_serviceTemplates'   THEN 'admin_manage'
    WHEN 'vift_emailTemplates'     THEN 'admin_manage'
    WHEN 'vift_activities'         THEN 'admin_manage'
    WHEN 'vift_activityLog'        THEN 'admin_manage'
    WHEN 'vift_importLogs'         THEN 'admin_manage'
    WHEN 'vift_projects'           THEN 'customer_manage'
    -- vift_workOrders/vift_timeEntries/vift_invoices/vift_ronderingspass/
    -- vift_offerAttachments MEDVETET UTESLUTNA — se filhuvudet ovan.
    ELSE NULL
  END;
$function$;

-- ====================================================================
-- public._store_bump_lastchanged()
-- owner=postgres security_definer=True config=search_path=public, pg_temp
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public._store_bump_lastchanged()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into public.store(key, value)
  values ('vift_lastChanged',
          to_jsonb(to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return null;
end;
$function$;

-- ====================================================================
-- public.activity_log_append(p_entry jsonb, p_max integer)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.activity_log_append(p_entry jsonb, p_max integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_log jsonb;
  v_now timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' or coalesce(p_entry->>'id', '') = '' then
    raise exception 'invalid_entry';
  end if;
  insert into public.store(key, value) values ('vift_activityLog', '[]'::jsonb) on conflict (key) do nothing;
  select value into v_log from public.store where key = 'vift_activityLog' for update;
  if v_log is null or jsonb_typeof(v_log) <> 'array' then v_log := '[]'::jsonb; end if;
  if exists (select 1 from jsonb_array_elements(v_log) e where e->>'id' = p_entry->>'id') then
    return jsonb_build_object('ok', true, 'id', p_entry->>'id', 'duplicate', true);
  end if;
  v_log := jsonb_build_array(p_entry) || v_log;
  while jsonb_array_length(v_log) > greatest(coalesce(p_max, 500), 1) loop
    v_log := v_log - (jsonb_array_length(v_log) - 1);
  end loop;
  update public.store set value = v_log, updated_at = v_now where key = 'vift_activityLog';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('ok', true, 'id', p_entry->>'id', 'duplicate', false);
end;
$function$;

-- ====================================================================
-- public.check_app_users_health()
-- owner=postgres security_definer=True config=search_path=public, pg_catalog
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.check_app_users_health()
 RETURNS TABLE(check_name text, status text, count_or_detail text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_auth_count    INT;
  v_app_count     INT;
  v_active_count  INT;
  v_admin_count   INT;
  v_unmapped      INT;
BEGIN
  SELECT count(*) INTO v_auth_count FROM auth.users;
  SELECT count(*) INTO v_app_count  FROM app_users;
  SELECT count(*) INTO v_active_count FROM app_users WHERE active = true;
  SELECT count(*) INTO v_admin_count  FROM app_users WHERE active = true AND is_admin = true;
  SELECT count(*) INTO v_unmapped
    FROM auth.users u
    LEFT JOIN app_users a ON a.user_id = u.id
    WHERE a.user_id IS NULL;

  RETURN QUERY VALUES
    ('auth.users',       'INFO',
     v_auth_count::TEXT || ' Supabase Auth-användare'),
    ('app_users',        'INFO',
     v_app_count::TEXT  || ' rader totalt'),
    ('aktiva',           CASE WHEN v_active_count > 0 THEN 'OK' ELSE 'VARNING' END,
     v_active_count::TEXT || ' aktiva VIFT-användare'),
    ('admins',           CASE WHEN v_admin_count > 0 THEN 'OK' ELSE 'KRITISK' END,
     v_admin_count::TEXT || ' aktiva admins (is_admin = true)'),
    ('omappade auth',    CASE WHEN v_unmapped = 0 THEN 'OK' ELSE 'VARNING' END,
     v_unmapped::TEXT || ' auth-användare utan app_users-rad');
END;
$function$;

-- ====================================================================
-- public.deactivate_vift_user(p_user_id uuid)
-- owner=postgres security_definer=True config=search_path=public, pg_catalog
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.e2e_purge_offer_artifacts(p_offer_id text)
-- owner=postgres security_definer=True config=search_path=public, pg_temp
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.e2e_purge_offer_artifacts(p_offer_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_title text;
  v_paths text[];
  v_att int;
  v_evt int;
begin
  select e->>'title' into v_title
  from public.store s, jsonb_array_elements(s.value) e
  where s.key = 'vift_offers' and e->>'id' = p_offer_id;
  if v_title is null or v_title not like '[E2E-TEST]%' then
    raise exception 'not_test_offer';
  end if;

  perform 1 from public.store where key in ('vift_offerAttachments', 'vift_offerEvents') for update;

  select coalesce(array_agg(e->>'storagePath'), '{}'), count(*)
    into v_paths, v_att
  from public.store s, jsonb_array_elements(s.value) e
  where s.key = 'vift_offerAttachments' and e->>'offerId' = p_offer_id;

  select count(*) into v_evt
  from public.store s, jsonb_array_elements(s.value) e
  where s.key = 'vift_offerEvents' and e->>'offerId' = p_offer_id;

  update public.store
     set value = (select coalesce(jsonb_agg(e order by o), '[]'::jsonb)
                  from jsonb_array_elements(value) with ordinality x(e, o)
                  where e->>'offerId' is distinct from p_offer_id),
         updated_at = now()
   where key in ('vift_offerAttachments', 'vift_offerEvents')
     and jsonb_typeof(value) = 'array';

  return jsonb_build_object('offerId', p_offer_id, 'attachments', v_att, 'events', v_evt, 'storagePaths', to_jsonb(v_paths));
end;
$function$;

-- ====================================================================
-- public.invoice_append_checked(p_invoice jsonb, p_idempotency_key text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.invoice_append_checked(p_invoice jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_max_num  int := 0;
  v_elem     jsonb;
  v_num      int;
  v_new_id   text;
  v_new_inv  jsonb;
  v_collision boolean := false;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_existing jsonb;
  v_sa            boolean;
  v_line          jsonb;
  v_lines_checked jsonb;
  v_line_id       text;
  v_seen_ids      text[];
  v_sref          jsonb;
  v_seen_source_keys text[];
begin
  -- N2 historical-cutover guard: old idempotency keys whose cache row was
  -- deleted before this migration CANNOT be recovered retroactively.
  -- Reject them, rather than permitting a deleted invoice to resurrect.
  -- All new appendChecked clients must send vift-v2:<fresh random UUID>.
  if p_idempotency_key is null or left(trim(p_idempotency_key), 8) <> 'vift-v2:' then
    raise exception 'legacy_idempotency_key_retired';
  end if;
  insert into public.store(key, value) values ('vift_invoices', '[]'::jsonb) on conflict (key) do nothing;
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then v_invoices := '[]'::jsonb; end if;

  -- J1/N2 (S1, S3): idempotency lookup AFTER the vift_invoices lock; a hit is
  -- trusted only if the cached invoice still exists with the same identity.
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    create table if not exists public.op_idempotency (
      fn_name    text        not null,
      idem_key   text        not null,
      result     jsonb       not null,
      created_at timestamptz not null default now(),
      primary key (fn_name, idem_key)
    );
    select result into v_existing from public.op_idempotency
      where fn_name = 'invoice_append_checked' and idem_key = p_idempotency_key
      for update;
    if v_existing is not null then
      if coalesce((v_existing ->> 'tombstone')::boolean, false) = false
         and exists (
           select 1 from jsonb_array_elements(v_invoices) e
           where e ->> 'id'        = v_existing -> 'invoice' ->> 'id'
             and e ->> 'createdAt' = v_existing -> 'invoice' ->> 'createdAt'
             and coalesce(e ->> 'status', '') <> 'makulerad'
             and (
               ( (v_existing -> 'invoice') ? 'uid' and e ->> 'uid' = v_existing -> 'invoice' ->> 'uid' )
               or
               ( not ((v_existing -> 'invoice') ? 'uid')
                 and (select coalesce(jsonb_agg(x ->> 'id' order by x ->> 'id'), '[]'::jsonb)
                        from jsonb_array_elements(coalesce(e -> 'lines', '[]'::jsonb)) x)
                   = (select coalesce(jsonb_agg(x ->> 'id' order by x ->> 'id'), '[]'::jsonb)
                        from jsonb_array_elements(coalesce(v_existing -> 'invoice' -> 'lines', '[]'::jsonb)) x) )
             )
         ) then
        return v_existing || jsonb_build_object('replayed', true);
      end if;
      -- N2: a key that EVER created a different invoice is permanently
      -- consumed. Tombstones and other stale cache records cannot be used
      -- as permission to create a replacement; never recycle the key.
      if coalesce((v_existing ->> 'tombstone')::boolean, false) then
        raise exception 'idempotency_key_consumed_deleted';
      end if;
      raise exception 'idempotency_key_stale_or_reassigned';
    end if;
  end if;

  /* R9B FINAL (sista oberoende granskningen, punkt 2 — granska
     invoice_append_checked): till denna ronda tog denna funktion emot
     `p_invoice` nästan helt ofiltrerad — den enda kontrollen var
     källkollisionen MOT ANDRA fakturor (och den bara OM `sourceAware`
     redan var `true`). Fyra konkreta, åtgärdade luckor:

     1. `sourceAware=false` (eller saknat) GJORDE INGEN kontroll alls
        av `lines[].sourceRefs` — en rad kunde alltså bära en FULLT
        FUNGERANDE källkoppling (`sourceKey` m.m.) helt OSYNLIG för
        kollisionskontrollen, eftersom hela kontrollblocket nedan är
        villkorat på `sourceAware`. En sådan "dold" källkoppling hade
        kunnat existera parallellt med en annan, korrekt registrerad
        faktura för SAMMA arbetsorder, utan att någonsin upptäckas.
        FIX: `sourceRefs` TVINGAS BORT från varje rad när fakturan
        INTE är sourceAware, oavsett inskickat innehåll.
     2. Inga dubbletter inom DEN NYA fakturan SJÄLV kontrollerades —
        varken rad-id (skulle förväxla en senare
        `invoice_line_update`/`invoice_line_delete`-uppslagning mot
        fel rad) eller `sourceKey` (skulle kunna dubbel-claima SAMMA
        arbetsorder två gånger inom en och samma faktura, osynligt för
        kollisionskontrollen som bara jämför MOT andra fakturor).
        FIX: explicit dubblett-/tomhetskontroll för båda.
     3. INGEN numerisk validering av `lines[].qty/unitPrice/vatRate`
        skedde — Blockerare 2:s (ronda 7) typ-/värdekontroller gäller
        bara `invoice_line_add`/`invoice_line_update`, inte denna
        skapandeväg. FIX: samma kontroller tillämpade här också.
     4. Fakturans `status` litade blint på `p_invoice` — ett direkt
        `.rpc()`-anrop kunde skapa en faktura som redan är
        'skickad'/'betald'/'makulerad', vilket kringgår hela den
        normala livscykeln. FIX: `status` TVINGAS till `'utkast'` i
        den slutgiltiga sammanslagningen nedan (`v_new_inv := ...`),
        oavsett inskickat värde — IDENTISK princip som `id`/`revision`/
        `createdAt`/`updatedAt` redan tvingas där.

     Den legitima, source-aware skapandevägens EGNA claim-regler
     (kollisionskontrollen nedan) och idempotensen (ovan) är HELT
     OFÖRÄNDRADE — detta lägger bara till kontroller FÖRE dem, aldrig
     i stället för dem. */
  v_sa := coalesce((p_invoice ->> 'sourceAware')::boolean, false);

  /* R9B FINAL (sista riktade korrigeringen, Punkt 1): samma kontroll
     som invoice_discount_set — en faktura ska inte kunna SKAPAS med
     ett fast rabattbelopp som redan har ogiltig sub-öre-precision,
     via den källmedvetna skapandevägen, bara eftersom den vägen
     annars kringgår invoice_discount_set helt. */
  if (p_invoice -> 'discount' ->> 'type') = 'fixed'
     and (p_invoice -> 'discount' ->> 'value') is not null
     and scale((p_invoice -> 'discount' ->> 'value')::numeric) > 2 then
    raise exception 'invalid_discount_value';
  end if;

  /* R9B FINAL (sista precisionskontrollen): samma kontroll som
     invoice_tax_reduction_set — ett ROT/RUT-belopp/underlag ska inte
     kunna SKAPAS med ogiltig precision via den källmedvetna
     skapandevägen heller. */
  if (p_invoice -> 'taxReduction' ->> 'type') in ('rot', 'rut') then
    if (p_invoice -> 'taxReduction' ->> 'amount') is not null
       and scale((p_invoice -> 'taxReduction' ->> 'amount')::numeric) > 2 then
      raise exception 'invalid_tax_amount';
    end if;
    if (p_invoice -> 'taxReduction' ->> 'basis') is not null
       and scale((p_invoice -> 'taxReduction' ->> 'basis')::numeric) > 2 then
      raise exception 'invalid_tax_basis';
    end if;
  end if;

  if not v_sa then
    v_lines_checked := '[]'::jsonb;
    for v_line in select * from jsonb_array_elements(coalesce(p_invoice -> 'lines', '[]'::jsonb)) loop
      v_lines_checked := v_lines_checked || jsonb_build_array(v_line - 'sourceRefs');
    end loop;
    p_invoice := p_invoice || jsonb_build_object('lines', v_lines_checked);
  end if;

  v_seen_ids := '{}';
  v_seen_source_keys := '{}';
  for v_line in select * from jsonb_array_elements(coalesce(p_invoice -> 'lines', '[]'::jsonb)) loop
    v_line_id := v_line ->> 'id';
    if v_line_id is null or length(trim(v_line_id)) = 0 then
      raise exception 'invalid_line_id';
    end if;
    if v_line_id = any(v_seen_ids) then
      raise exception 'duplicate_line_id';
    end if;
    v_seen_ids := v_seen_ids || v_line_id;

    if v_line ? 'qty' then
      if jsonb_typeof(v_line -> 'qty') <> 'number' then raise exception 'invalid_qty'; end if;
      if (v_line->>'qty')::numeric < 0 then raise exception 'invalid_qty'; end if;
      if scale((v_line->>'qty')::numeric) > 3 then raise exception 'invalid_qty'; end if;
    end if;
    if v_line ? 'unitPrice' then
      if jsonb_typeof(v_line -> 'unitPrice') <> 'number' then raise exception 'invalid_price'; end if;
      if (v_line->>'unitPrice')::numeric < 0 then raise exception 'invalid_price'; end if;
      if scale((v_line->>'unitPrice')::numeric) > 4 then raise exception 'invalid_price'; end if;
    end if;
    if v_line ? 'vatRate' then
      if jsonb_typeof(v_line -> 'vatRate') <> 'number' then raise exception 'invalid_vat'; end if;
      if (v_line->>'vatRate')::numeric < 0 or (v_line->>'vatRate')::numeric > 100 then raise exception 'invalid_vat'; end if;
      if scale((v_line->>'vatRate')::numeric) > 4 then raise exception 'invalid_vat'; end if;
    end if;

    if v_sa then
      for v_sref in select * from jsonb_array_elements(coalesce(v_line -> 'sourceRefs', '[]'::jsonb)) loop
        if coalesce(v_sref ->> 'sourceKey', '') = '' then
          raise exception 'invalid_source_ref';
        end if;
        if (v_sref ->> 'sourceKey') = any(v_seen_source_keys) then
          raise exception 'duplicate_source_key';
        end if;
        v_seen_source_keys := v_seen_source_keys || (v_sref ->> 'sourceKey');
      end loop;
    end if;
  end loop;

  if v_sa then
    with other_keys as (
      select distinct (r ->> 'sourceKey') as sk
      from jsonb_array_elements(v_invoices) oi,
           jsonb_array_elements(coalesce(oi -> 'lines', '[]'::jsonb)) l,
           jsonb_array_elements(coalesce(l -> 'sourceRefs', '[]'::jsonb)) r
      where coalesce(oi ->> 'status', '') <> 'makulerad'
    ),
    my_keys as (
      select distinct (r ->> 'sourceKey') as sk
      from jsonb_array_elements(coalesce(p_invoice -> 'lines', '[]'::jsonb)) l,
           jsonb_array_elements(coalesce(l -> 'sourceRefs', '[]'::jsonb)) r
    )
    select exists(select 1 from my_keys m join other_keys o on m.sk = o.sk) into v_collision;
    if v_collision then
      raise exception 'source_collision';
    end if;
  end if;

  for v_elem in select * from jsonb_array_elements(v_invoices) loop
    v_num := nullif(regexp_replace(coalesce(v_elem ->> 'id', ''), '[^0-9]', '', 'g'), '')::int;
    if v_num is not null and v_num > v_max_num then v_max_num := v_num; end if;
  end loop;
  v_new_id := 'F-' || lpad((v_max_num + 1)::text, 3, '0');

  -- J1/N2 (S0): immutable server-generated uid; a client-sent uid is dropped.
  v_new_inv := (p_invoice - 'uid') || jsonb_build_object(
    'id', v_new_id, 'uid', gen_random_uuid()::text,
    'status', 'utkast', 'createdAt', v_now_text, 'updatedAt', v_now_text, 'revision', 1
  );

  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 3 — utöver
     granskningens egen lista, en extra, strikt SÄKRARE åtgärd: även
     den källmedvetna skapandevägen ska inte kunna producera en
     fakturapost som redan från start är finansiellt ogiltig, se
     filhuvudets kommentar vid _invoice_financial_check() ovan för
     motivering och den kända avgränsningen för denna specifika
     anropsväg). */
  perform public._invoice_financial_check(v_new_inv);

  v_invoices := v_invoices || jsonb_build_array(v_new_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  v_new_inv := jsonb_build_object('invoice', v_new_inv, 'serverSignature', v_now_text);

  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    insert into public.op_idempotency(fn_name, idem_key, result)
      values ('invoice_append_checked', p_idempotency_key, v_new_inv)
      on conflict (fn_name, idem_key) do nothing;
  end if;

  return v_new_inv;
end;
$function$;

-- ====================================================================
-- public.invoice_discount_set(p_invoice_id text, p_discount jsonb, p_expected_revision bigint)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.invoice_discount_set(p_invoice_id text, p_discount jsonb, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_now      timestamptz;
  v_now_text text;
  v_current_revision bigint;
  v_new_revision     bigint;
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  v_now := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then raise exception 'not_found'; end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;

  v_current_revision := coalesce((v_inv ->> 'revision')::bigint, 0);
  -- R9B TEST 9 (ronda 5, Blockerare 4): NULL-fail-closed, se invoice_line_update() ovan för full motivering.
  if p_expected_revision is null or v_current_revision is distinct from p_expected_revision then
    raise exception 'stale_write';
  end if;

  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  /* R9B TEST 9 (ronda 6): minsta server-sidiga sanity på rabatt-
     objektets struktur — typ måste vara ett av de giltiga värdena,
     värdet icke-negativt (och <=100 om procent). Replikerar INTE den
     fulla ROT/RUT-invarianten (medvetet, se invoice_line_update()). */
  if not (p_discount ->> 'type' = any(array['none','percent','fixed'])) then
    raise exception 'invalid_discount_type';
  end if;
  if (p_discount ->> 'value')::numeric is null
     or (p_discount ->> 'value')::numeric = 'NaN'::numeric
     or (p_discount ->> 'value')::numeric < 0 then
    raise exception 'invalid_discount_value';
  end if;
  if p_discount ->> 'type' = 'percent' and (p_discount ->> 'value')::numeric > 100 then
    raise exception 'invalid_discount_value';
  end if;

  /* R9B FINAL (sista riktade korrigeringen, Punkt 1 — verkligt
     reproducerad): ett FAST rabattbelopp med MER än två decimaler
     (t.ex. 0,005 kr) gav tidigare olika resultat i JS och SQL,
     eftersom SQL (till skillnad från JS) aldrig rundade det fasta
     beloppet separat innan det drogs av från radsumman — bara
     SLUTSUMMAN rundades. Grundorsaken var en SAKNAD gemensam
     affärsregel, inte en flyttalsbugg: svensk valuta saknar en
     denomination mindre än ett öre, så ett sådant belopp är i sig
     inte en giltig affärshändelse. Avvisas nu HÄR, konsekvent, med
     samma kontroll som klienten (InvoiceService.setDiscount()) gör —
     `(value * 100)` måste vara ett heltal. */
  if p_discount ->> 'type' = 'fixed' and scale((p_discount ->> 'value')::numeric) > 2 then
    raise exception 'invalid_discount_value';
  end if;

  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 3): den
     fulla finansiella invarianten valideras nu ATOMISKT mot fakturans
     NYA tillstånd, under SAMMA radlås (se _invoice_financial_check()
     ovan) — INNAN skrivningen. En rabattändring som skulle sänka
     totalsumman under ett redan satt ROT/RUT-avdrag (negativ
     kundbetalning) avvisas här, oavsett om den enskilda
     rabattvalideringen ovan annars skulle godkänna den. */
  perform public._invoice_financial_check(
    v_inv || jsonb_build_object('discount', p_discount)
  );

  v_new_revision := v_current_revision + 1;
  v_inv := v_inv || jsonb_build_object('discount', p_discount, 'updatedAt', v_now_text, 'revision', v_new_revision);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.invoice_draft_delete(p_invoice_id text, p_expected_revision bigint)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.invoice_draft_delete(p_invoice_id text, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_activity_log jsonb;
  v_new_activity jsonb;
  v_actlog_id text;
  v_now      timestamptz;
  v_now_text text;
  v_current_revision bigint;
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  v_now := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then
    raise exception 'not_found';
  end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;

  v_current_revision := coalesce((v_inv ->> 'revision')::bigint, 0);
  -- R9B TEST 9 (ronda 5, Blockerare 4): NULL-fail-closed, se invoice_line_update() ovan för full motivering.
  if p_expected_revision is null or v_current_revision is distinct from p_expected_revision then
    raise exception 'stale_write';
  end if;

  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  select jsonb_agg(elem) into v_invoices from jsonb_array_elements(v_invoices) elem where elem ->> 'id' <> p_invoice_id;
  v_invoices := coalesce(v_invoices, '[]'::jsonb);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';

  -- J1/N2 (S2): invalidate this invoice's idempotency entries atomically,
  -- while vift_invoices is still locked. Only fn_name='invoice_append_checked'.
  if to_regclass('public.op_idempotency') is not null then
    -- Atomic tombstone under vift_invoices FOR UPDATE lock.
    -- Keep the consumed idem_key forever, even when invoice numbers recycle.
    update public.op_idempotency
       set result = jsonb_build_object(
          'tombstone', true,
          'deletedInvoiceId', p_invoice_id,
          'deletedInvoiceUid', v_inv ->> 'uid',
          'deletedCreatedAt', v_inv ->> 'createdAt',
          'deletedAt', v_now_text
       )
     where fn_name = 'invoice_append_checked'
       and result -> 'invoice' ->> 'id' = p_invoice_id
       and result -> 'invoice' ->> 'createdAt' = v_inv ->> 'createdAt'
       and (not (v_inv ? 'uid') or result -> 'invoice' ->> 'uid' = v_inv ->> 'uid');
  end if;

  insert into public.store(key, value) values ('vift_activityLog', '[]'::jsonb) on conflict (key) do nothing;
  select value into v_activity_log from public.store where key = 'vift_activityLog' for update;
  if v_activity_log is null or jsonb_typeof(v_activity_log) <> 'array' then v_activity_log := '[]'::jsonb; end if;
  v_actlog_id := 'ACT-' || to_char(v_now, 'YYYYMMDDHH24MISSMS') || '-' || substr(md5(random()::text), 1, 6);
  v_new_activity := jsonb_build_object(
    'id', v_actlog_id, 'type', 'invoice_deleted',
    'description', 'Fakturautkast ' || p_invoice_id || ' raderat',
    'timestamp', v_now_text, 'customerId', coalesce(v_inv ->> 'customerId', ''),
    'propertyId', '', 'workOrderId', '', 'offerId', '', 'invoiceId', p_invoice_id,
    'salesOpportunityId', '', 'inspectionId', '', 'ronderingId', '', 'deviationId', '', 'userId', ''
  );
  v_activity_log := jsonb_build_array(v_new_activity) || v_activity_log;
  update public.store set value = v_activity_log, updated_at = v_now where key = 'vift_activityLog';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('deletedInvoice', v_inv, 'activityLog', v_activity_log, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.invoice_line_add(p_invoice_id text, p_line jsonb, p_expected_revision bigint)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.invoice_line_add(p_invoice_id text, p_line jsonb, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_now      timestamptz;
  v_now_text text;
  v_current_revision bigint;
  v_new_revision bigint;
  v_qty        numeric;
  v_unit_price numeric;
  v_vat_rate   numeric;
  v_patch_key  text;
  v_line_id    text;
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  v_now := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then
    raise exception 'not_found';
  end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;

  v_current_revision := coalesce((v_inv ->> 'revision')::bigint, 0);
  -- R9B FINAL: samma NULL-fail-closed-princip som i invoice_line_update
  -- m.fl. (se dess kommentar för full motivering av `IS DISTINCT FROM`).
  if p_expected_revision is null or v_current_revision is distinct from p_expected_revision then
    raise exception 'stale_write';
  end if;

  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 2 — verkligt
     fynd): `p_line` fogades tidigare in i `lines` OFILTRERAD. Klienten
     (InvoiceService.addLine()) tar visserligen redan bort
     `sourceRefs`/`id`/`sourceId` innan den bygger sin egen rad — men ett
     direkt `.rpc('invoice_line_add', ...)`-anrop (eller en framtida
     klientbugg) kunde ändå skicka ETT av dessa fält rakt igenom, precis
     som Blockerare 3 i ronda 6 redan visade för invoice_line_update.
     FAIL-CLOSED ALLOWLIST här, server-sidigt, oberoende av klienten —
     exakt samma princip, samma lista (minus `id`/`source`/`sourceId`,
     som ÄR tillåtna att skicka in här eftersom en NY rad måste ha ett
     id/source-label, men vars VÄRDEN ändå aldrig litas på rakt av, se
     nedan). `sourceRefs` finns INTE i listan — den kan alltså aldrig
     förekomma i en manuellt tillagd rad, oavsett anropare. */
  for v_patch_key in select jsonb_object_keys(p_line) loop
    if not (v_patch_key = any(array['description','qty','unit','unitPrice','vatRate','freetext','source','id','sourceId'])) then
      raise exception 'forbidden_field';
    end if;
  end loop;

  /* Blockerare 2, forts.: `sourceId` kan ALDRIG sättas av anroparen —
     en manuell rad är per definition inte source-backed (samma regel
     som redan gäller klientsidan, nu även garanterad server-sidigt).
     Värdet tvingas till tomt HÄR, oavsett vad `p_line` innehöll — detta
     bryter INTE den normala addLine()-vägen, som redan själv skickar
     `sourceId: ''`. */
  p_line := p_line || jsonb_build_object('sourceId', '');

  /* Blockerare 2, forts.: radens `id` måste finnas och vara unikt inom
     fakturan — annars kunde en manipulerad/dubblerad id förväxla eller
     skriva över en annan rads identitet (t.ex. en source-backed rad)
     vid en SENARE operation som slår upp raden via id. En ren
     existens-/dubblettkontroll här, ingen omskrivning av ett giltigt,
     unikt klient-id (det skulle bryta addLine()s kontrakt att returnera
     SAMMA id som faktiskt sparades, se InvoiceService.js). */
  v_line_id := p_line ->> 'id';
  if v_line_id is null or length(trim(v_line_id)) = 0 then
    raise exception 'invalid_line_id';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_inv -> 'lines', '[]'::jsonb)) as le
    where le ->> 'id' = v_line_id
  ) then
    raise exception 'duplicate_line_id';
  end if;

  /* R9B TEST 9 (ronda 6, utökad ronda 7 — Blockerare 2): samma minsta
     server-sidiga sanity-validering som invoice_line_update — se dess
     kommentar för avgränsningen mot den fulla ROT/RUT-invarianten
     (medvetet INTE replikerad här, se Blockerare 3 nedan för den
     separata hanteringen av DEN frågan). Ronda 7-tillägg: ett
     JSON-NUMMER-typkrav INNAN cast — annars accepterar
     `(x ->> 'qty')::numeric` even en textsträng som `"NaN"` som ett
     "giltigt", icke-negativt numeriskt värde (Postgres numeric stödjer
     NaN som ett eget värde och `NaN < 0` är FALSE, så det tidigare
     `< 0`-testet skyddade INTE mot detta). `jsonb_typeof(...) = 'number'`
     avvisar både textsträngar och NaN/Infinity (JSON-specifikationen
     tillåter aldrig dessa som number-literaler, så ett sådant försök
     anländer alltid som en annan JSON-typ eller blir redan avvisat av
     JSON-parsningen tidigare i kedjan). */
  if p_line ? 'qty' then
    if jsonb_typeof(p_line -> 'qty') <> 'number' then raise exception 'invalid_qty'; end if;
    v_qty := (p_line->>'qty')::numeric;
    if v_qty is null or v_qty < 0 then raise exception 'invalid_qty'; end if;
    -- R9B FINAL (sista precisionskontrollen): samma dokumenterade
    -- gräns som klienten — antal högst 3 decimaler. `scale()` ger
    -- EXAKT antal decimaler i den inskickade JSON-talstextens
    -- numeriska representation, ingen avrundning inblandad.
    if scale(v_qty) > 3 then raise exception 'invalid_qty'; end if;
  end if;
  if p_line ? 'unitPrice' then
    if jsonb_typeof(p_line -> 'unitPrice') <> 'number' then raise exception 'invalid_price'; end if;
    v_unit_price := (p_line->>'unitPrice')::numeric;
    if v_unit_price is null or v_unit_price < 0 then raise exception 'invalid_price'; end if;
    -- R9B FINAL (sista precisionskontrollen, verkligt reproducerad:
    -- 0.0199996 — 7 decimaler — gav olika resultat i JS och SQL).
    -- Pris högst 4 decimaler, samma dokumenterade gräns som klienten.
    if scale(v_unit_price) > 4 then raise exception 'invalid_price'; end if;
  end if;
  if p_line ? 'vatRate' then
    if jsonb_typeof(p_line -> 'vatRate') <> 'number' then raise exception 'invalid_vat'; end if;
    v_vat_rate := (p_line->>'vatRate')::numeric;
    if v_vat_rate is null or v_vat_rate < 0 or v_vat_rate > 100 then raise exception 'invalid_vat'; end if;
    -- R9B FINAL (sista precisionskontrollen, ANDRA ronda, verkligt
    -- reproducerad): momssats högst 4 decimaler, samma dokumenterade
    -- gräns som klienten.
    if scale(v_vat_rate) > 4 then raise exception 'invalid_vat'; end if;
  end if;

  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 3): den fulla
     finansiella invarianten valideras ATOMISKT mot fakturans NYA
     tillstånd (med den nya raden redan inlagd), under SAMMA radlås,
     INNAN skrivningen — se _invoice_financial_check() ovan. */
  perform public._invoice_financial_check(
    v_inv || jsonb_build_object('lines', coalesce(v_inv -> 'lines', '[]'::jsonb) || jsonb_build_array(p_line))
  );

  v_new_revision := v_current_revision + 1;
  v_inv := v_inv || jsonb_build_object(
    'lines', coalesce(v_inv -> 'lines', '[]'::jsonb) || jsonb_build_array(p_line),
    'updatedAt', v_now_text,
    'revision', v_new_revision
  );
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.invoice_line_delete(p_invoice_id text, p_line_id text, p_expected_revision bigint)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.invoice_line_delete(p_invoice_id text, p_line_id text, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_lines    jsonb;
  v_now      timestamptz;
  v_now_text text;
  v_current_revision bigint;
  v_new_revision     bigint;
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  v_now := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then
    raise exception 'not_found';
  end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;

  v_current_revision := coalesce((v_inv ->> 'revision')::bigint, 0);
  -- R9B TEST 9 (ronda 5, Blockerare 4): NULL-fail-closed, se invoice_line_update() ovan för full motivering.
  if p_expected_revision is null or v_current_revision is distinct from p_expected_revision then
    raise exception 'stale_write';
  end if;

  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  v_lines := coalesce(v_inv -> 'lines', '[]'::jsonb);
  select jsonb_agg(elem) into v_lines from jsonb_array_elements(v_lines) elem where elem ->> 'id' <> p_line_id;
  v_lines := coalesce(v_lines, '[]'::jsonb);

  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 3): en
     radborttagning kan sänka totalsumman under ett redan satt
     ROT/RUT-avdrag precis lika väl som en radredigering — samma
     atomiska kontroll, under samma radlås, innan skrivningen. */
  perform public._invoice_financial_check(v_inv || jsonb_build_object('lines', v_lines));

  v_new_revision := v_current_revision + 1;
  v_inv := v_inv || jsonb_build_object('lines', v_lines, 'updatedAt', v_now_text, 'revision', v_new_revision);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.invoice_line_update(p_invoice_id text, p_line_id text, p_patch jsonb, p_expected_revision bigint)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.invoice_line_update(p_invoice_id text, p_line_id text, p_patch jsonb, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_lines    jsonb;
  v_lidx     int;
  v_now      timestamptz;
  v_now_text text;
  v_current_revision bigint;
  v_new_revision     bigint;
  v_patch_key text;
  v_qty        numeric;
  v_unit_price numeric;
  v_vat_rate   numeric;
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  v_now := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then
    raise exception 'not_found';
  end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;

  v_current_revision := coalesce((v_inv ->> 'revision')::bigint, 0);
  /* R9B TEST 9 (oberoende granskning, ronda 5, Blockerare 4): `<>` med
     ett SQL NULL-operand utvärderas till UNKNOWN, inte TRUE — en
     `IF v_current_revision <> p_expected_revision THEN` hoppade då
     tyst över hela avvisningsgrenen om `p_expected_revision` råkade
     vara NULL, och tillämpade patchen OVILLKORLIGT. Edge Function-
     lagret avvisar redan ett NULL/icke-heltalsvärde INNAN RPC:n
     anropas (`parseExpectedRevision()` i invoice-write/index.ts) — men
     RPC:n ska vara FAIL-CLOSED OBEROENDE av anroparen (ett direkt
     `.rpc()`-anrop, ett framtida EF-buggfix som glömmer validera, etc.).
     `IS DISTINCT FROM` hanterar NULL korrekt på egen hand (NULL anses
     alltid skilja sig från ett konkret värde) — den explicita
     `p_expected_revision is null or`-klausulen är därför strikt
     redundant men behålls för LÄSBARHET. Samma mönster upprepas
     identiskt i SAMTLIGA sju revisionskontrollerade funktioner i denna
     fil. */
  if p_expected_revision is null or v_current_revision is distinct from p_expected_revision then
    raise exception 'stale_write';
  end if;

  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  v_lines := coalesce(v_inv -> 'lines', '[]'::jsonb);
  select (ord - 1)::int into v_lidx from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_line_id limit 1;
  if v_lidx is null then raise exception 'line_not_found'; end if;

  /* R9B TEST 9 (oberoende granskning, ronda 6, Blockerare 3 — verkligt
     reproducerad): `(v_lines -> v_lidx) || p_patch` slog samman
     VILKEN NYCKEL SOM HELST i `p_patch` in i raden, utan servervalidering
     — klienten (InvoiceService.updateLine()) tar visserligen bort
     `id`/`sourceId`/`source`/`sourceRefs` innan den skickar, men RPC:n
     själv litade blint på det. Ett direkt `.rpc()`-anrop (eller en
     framtida klientbugg) hade kunnat skriva om radens identitets-/
     claim-fält. FAIL-CLOSED ALLOWLIST här, server-sidigt, oberoende av
     klienten — exakt samma princip som NULL-revisionsskyddet ovan. */
  for v_patch_key in select jsonb_object_keys(p_patch) loop
    if not (v_patch_key = any(array['description','qty','unit','unitPrice','vatRate','freetext'])) then
      raise exception 'forbidden_field';
    end if;
  end loop;

  /* Minsta säkra server-sidiga sanity-validering (ronda 6): negativa
     mängder/priser och ogiltiga momssatser avvisas HÄR också, inte
     bara i klientens `_validateLineData()`. Replikerar INTE den fulla
     ROT/RUT-invariantkontrollen (`_prospectiveCheck`/`calcSummary` i
     InvoiceService.js) — det är en MEDVETEN, OFÖRÄNDRAD avgränsning
     från den ursprungliga migrationens filhuvud (se där för
     motiveringen: ingen pengar-risk i detta interna, icke kundvända
     system, och en hög risk att införa subtila räknefel genom att
     återimplementera hela beräkningsmotorn i PL/pgSQL). */
  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 2 — samma
     typkontroll som nu även tillagd i invoice_line_add, för konsistens:
     `jsonb_typeof(...) = 'number'` INNAN cast stoppar en textsträng
     som `"NaN"` som annars skulle castas till ett numeriskt NaN-värde
     som klarar `< 0`-testet (Postgres numeric NaN är inte mindre än
     0). Ingen ändring av de redan godkända gränsvärdena i övrigt. */
  if p_patch ? 'qty' then
    if jsonb_typeof(p_patch -> 'qty') <> 'number' then raise exception 'invalid_qty'; end if;
    v_qty := (p_patch->>'qty')::numeric;
    if v_qty is null or v_qty < 0 then raise exception 'invalid_qty'; end if;
    if scale(v_qty) > 3 then raise exception 'invalid_qty'; end if;
  end if;
  if p_patch ? 'unitPrice' then
    if jsonb_typeof(p_patch -> 'unitPrice') <> 'number' then raise exception 'invalid_price'; end if;
    v_unit_price := (p_patch->>'unitPrice')::numeric;
    if v_unit_price is null or v_unit_price < 0 then raise exception 'invalid_price'; end if;
    if scale(v_unit_price) > 4 then raise exception 'invalid_price'; end if;
  end if;
  if p_patch ? 'vatRate' then
    if jsonb_typeof(p_patch -> 'vatRate') <> 'number' then raise exception 'invalid_vat'; end if;
    v_vat_rate := (p_patch->>'vatRate')::numeric;
    if v_vat_rate is null or v_vat_rate < 0 or v_vat_rate > 100 then raise exception 'invalid_vat'; end if;
    if scale(v_vat_rate) > 4 then raise exception 'invalid_vat'; end if;
  end if;

  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 3 — EXAKT
     den av granskningen givna reproduktionen: en giltig revision +
     unitPrice=0 på en rad med kvarstående ROT/RUT-avdrag ⇒ negativ
     customerPays). Validerad ATOMISKT mot fakturans NYA tillstånd,
     under SAMMA radlås, INNAN skrivningen — se
     _invoice_financial_check() ovan. */
  perform public._invoice_financial_check(
    v_inv || jsonb_build_object('lines', jsonb_set(v_lines, array[v_lidx::text], (v_lines -> v_lidx) || p_patch))
  );

  v_new_revision := v_current_revision + 1;
  v_lines := jsonb_set(v_lines, array[v_lidx::text], (v_lines -> v_lidx) || p_patch);
  v_inv := v_inv || jsonb_build_object('lines', v_lines, 'updatedAt', v_now_text, 'revision', v_new_revision);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.invoice_meta_update(p_invoice_id text, p_patch jsonb, p_expected_revision bigint)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.invoice_meta_update(p_invoice_id text, p_patch jsonb, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_safe     jsonb := '{}'::jsonb;
  v_now      timestamptz;
  v_now_text text;
  v_current_revision bigint;
  v_new_revision     bigint;
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  v_now := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then raise exception 'not_found'; end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;

  v_current_revision := coalesce((v_inv ->> 'revision')::bigint, 0);
  -- R9B TEST 9 (ronda 5, Blockerare 4): NULL-fail-closed, se invoice_line_update() ovan för full motivering.
  if p_expected_revision is null or v_current_revision is distinct from p_expected_revision then
    raise exception 'stale_write';
  end if;

  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  if p_patch ? 'customerReference' then v_safe := v_safe || jsonb_build_object('customerReference', p_patch->>'customerReference'); end if;
  if p_patch ? 'ocr' then v_safe := v_safe || jsonb_build_object('ocr', p_patch->>'ocr'); end if;
  if p_patch ? 'note' then v_safe := v_safe || jsonb_build_object('note', p_patch->>'note'); end if;

  v_new_revision := v_current_revision + 1;
  v_inv := v_inv || v_safe || jsonb_build_object('updatedAt', v_now_text, 'revision', v_new_revision);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.invoice_set_status(p_invoice_id text, p_status text, p_expected_revision bigint, p_actor_id text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.invoice_set_status(p_invoice_id text, p_status text, p_expected_revision bigint, p_actor_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices    jsonb;
  v_idx         int;
  v_inv         jsonb;
  v_prev        text;
  v_allowed     text[];
  v_reactivating boolean := false;
  v_source_aware boolean;
  v_collision   boolean := false;
  v_now         timestamptz;
  v_now_text    text;
  v_activity_log jsonb;
  v_new_activity jsonb;
  v_actlog_id   text;
  v_current_revision bigint;
  v_new_revision     bigint;
  v_wo_list jsonb;
  v_stale jsonb;
  v_latest_override jsonb;
  v_item jsonb;
begin
  if p_status not in ('utkast', 'skickad', 'betald', 'förfallen', 'makulerad') then
    raise exception 'invalid_status';
  end if;

  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  v_now := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1)::int into v_idx
    from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;
  v_inv  := v_invoices -> v_idx;
  v_prev := v_inv ->> 'status';

  v_current_revision := coalesce((v_inv ->> 'revision')::bigint, 0);
  -- R9B TEST 9 (ronda 5, Blockerare 4): NULL-fail-closed, se invoice_line_update() ovan för full motivering.
  if p_expected_revision is null or v_current_revision is distinct from p_expected_revision then
    raise exception 'stale_write';
  end if;

  if p_status = v_prev then
    return jsonb_build_object('invoice', v_inv, 'changed', false, 'serverSignature', v_now_text);
  end if;

  v_allowed := case v_prev
    when 'utkast'     then array['skickad', 'makulerad']
    when 'skickad'    then array['betald', 'förfallen', 'makulerad']
    when 'förfallen'  then array['skickad', 'betald', 'makulerad']
    when 'betald'     then array['makulerad']
    when 'makulerad'  then array['utkast']
    else array[]::text[]
  end;
  if not (p_status = any(v_allowed)) then
    raise exception 'invalid_transition';
  end if;

  -- A3a: perform the final stale-price guard UNDER THE SAME TRANSACTION
  -- as invoice_set_status. The invoice row is already locked above; lock
  -- workOrders FOR SHARE as well. A concurrent work_order_patch cannot
  -- change its fixedPrice until this invoice has committed.
  if p_status = 'skickad' then
    select value into v_wo_list from public.store
      where key='vift_workOrders' for share;
    v_stale := public._invoice_fixed_stale_snapshot(v_inv,v_wo_list);
    if jsonb_array_length(v_stale)>0 then
      v_latest_override := null;
      if jsonb_typeof(v_inv -> 'staleOverrides') = 'array' then
        v_latest_override := (v_inv -> 'staleOverrides') -> -1;
      end if;
      for v_item in select value from jsonb_array_elements(v_stale) t(value) loop
        if v_latest_override is null or not exists (
          select 1 from jsonb_array_elements(coalesce(v_latest_override -> 'lines','[]'::jsonb)) o(value)
           where o.value ->> 'lineId' = v_item ->> 'lineId'
             and o.value ->> 'workOrderId' = v_item ->> 'workOrderId'
             and o.value -> 'lineUnitPrice' = v_item -> 'lineUnitPrice'
             and o.value -> 'aoFixedPrice' = v_item -> 'aoFixedPrice'
        ) then
          raise exception 'stale_price_unapproved';
        end if;
      end loop;
    end if;
  end if;

  v_reactivating := (v_prev = 'makulerad' and p_status = 'utkast');
  v_source_aware := coalesce((v_inv ->> 'sourceAware')::boolean, false);

  if v_reactivating and v_source_aware then
    with other_keys as (
      select distinct (r ->> 'sourceKey') as sk
      from jsonb_array_elements(v_invoices) oi,
           jsonb_array_elements(coalesce(oi -> 'lines', '[]'::jsonb)) l,
           jsonb_array_elements(coalesce(l -> 'sourceRefs', '[]'::jsonb)) r
      where (oi ->> 'id') <> p_invoice_id
        and coalesce(oi ->> 'status', '') <> 'makulerad'
    ),
    my_keys as (
      select distinct (r ->> 'sourceKey') as sk
      from jsonb_array_elements(coalesce(v_inv -> 'lines', '[]'::jsonb)) l,
           jsonb_array_elements(coalesce(l -> 'sourceRefs', '[]'::jsonb)) r
    )
    select exists(select 1 from my_keys m join other_keys o on m.sk = o.sk) into v_collision;

    if v_collision then
      raise exception 'source_collision';
    end if;
  end if;

  v_new_revision := v_current_revision + 1;
  v_inv := v_inv || jsonb_build_object('status', p_status, 'updatedAt', v_now_text, 'revision', v_new_revision);
  if p_status = 'betald' then
    v_inv := v_inv || jsonb_build_object('paidAt', v_now_text);
  end if;
  if p_status = 'skickad' then
    v_inv := v_inv || jsonb_build_object('sentAt', v_now_text);
  end if;
  if v_reactivating then
    v_inv := v_inv || jsonb_build_object('sentAt', '', 'paidAt', '');
  end if;

  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';

  insert into public.store(key, value) values ('vift_activityLog', '[]'::jsonb)
    on conflict (key) do nothing;
  select value into v_activity_log from public.store where key = 'vift_activityLog' for update;
  if v_activity_log is null or jsonb_typeof(v_activity_log) <> 'array' then
    v_activity_log := '[]'::jsonb;
  end if;
  v_actlog_id := 'ACT-' || to_char(v_now, 'YYYYMMDDHH24MISSMS') || '-' || substr(md5(random()::text), 1, 6);
  v_new_activity := jsonb_build_object(
    'id', v_actlog_id,
    'type', 'invoice_status',
    'description', 'Faktura ' || p_invoice_id || ' ändrad till ' || p_status,
    'timestamp', v_now_text,
    'customerId', coalesce(v_inv ->> 'customerId', ''),
    'propertyId', '', 'workOrderId', '', 'offerId', '',
    'invoiceId', p_invoice_id, 'salesOpportunityId', '',
    'inspectionId', '', 'ronderingId', '', 'deviationId', '',
    'userId', coalesce(p_actor_id, '')
  );
  v_activity_log := jsonb_build_array(v_new_activity) || v_activity_log;
  update public.store set value = v_activity_log, updated_at = v_now where key = 'vift_activityLog';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object(
    'invoice', v_inv, 'prevStatus', v_prev, 'changed', true,
    'activityLog', v_activity_log, 'serverSignature', v_now_text
  );
end;
$function$;

-- ====================================================================
-- public.invoice_stale_override_approve_commit(p_invoice_id text, p_expected_revision integer, p_entry jsonb)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.invoice_stale_override_approve_commit(p_invoice_id text, p_expected_revision integer, p_entry jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_now      timestamptz := now();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_rev      int;
  v_new_inv  jsonb;
  v_wo_list jsonb;
  v_stale jsonb;
begin
  if p_invoice_id is null or trim(p_invoice_id) = '' then
    raise exception 'invoice_stale_override_approve_commit: p_invoice_id required' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invoice_stale_override_approve_commit: p_expected_revision required' using errcode = '22023';
  end if;
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' or coalesce(trim(p_entry ->> 'id'), '') = '' then
    raise exception 'invoice_stale_override_approve_commit: p_entry (with an id) required' using errcode = '22023';
  end if;

  -- Same lock ordering as every other invoice_* RPC: lock vift_invoices
  -- FOR UPDATE before reading it, so no other writer can interleave.
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then
    raise exception 'not_found';
  end if;

  select ord.i - 1, elem into v_idx, v_inv
  from jsonb_array_elements(v_invoices) with ordinality as ord(elem, i)
  where elem ->> 'id' = p_invoice_id
  limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;

  -- Idempotent replay: the same override.id already stored (authoritative,
  -- atomic recheck under the lock — the EF's own pre-check is only a
  -- non-atomic fast path, this is the one that matters).
  if exists (
       select 1 from jsonb_array_elements(coalesce(v_inv -> 'staleOverrides', '[]'::jsonb)) o
       where o ->> 'id' = p_entry ->> 'id'
     ) then
    return jsonb_build_object('invoice', v_inv, 'replayed', true);
  end if;

  v_rev := coalesce((v_inv ->> 'revision')::int, 0);
  if v_rev <> p_expected_revision then
    raise exception 'stale_write';
  end if;
  if coalesce(v_inv ->> 'status', '') not in ('utkast', 'förfallen') then
    raise exception 'invalid_transition';
  end if;

  -- A3a: re-check the EXACT server-side fixed-price snapshot while
  -- both invoice and work-order rows are locked. Do not trust the
  -- Edge Function's earlier, non-atomic read.
  select value into v_wo_list from public.store
    where key='vift_workOrders' for share;
  v_stale := public._invoice_fixed_stale_snapshot(v_inv,v_wo_list);
  if jsonb_array_length(v_stale)=0 then raise exception 'no_stale_discrepancy'; end if;
  if p_entry -> 'lines' is distinct from v_stale then
    raise exception 'stale_snapshot_mismatch';
  end if;

  v_new_inv := v_inv || jsonb_build_object(
    'staleOverrides', coalesce(v_inv -> 'staleOverrides', '[]'::jsonb) || jsonb_build_array(p_entry),
    'revision', v_rev + 1,
    'updatedAt', v_now_text
  );
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_new_inv);

  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';

  return jsonb_build_object('invoice', v_new_inv, 'replayed', false);
end;
$function$;

-- ====================================================================
-- public.invoice_tax_reduction_set(p_invoice_id text, p_tax_reduction jsonb, p_expected_revision bigint)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.invoice_tax_reduction_set(p_invoice_id text, p_tax_reduction jsonb, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_now      timestamptz;
  v_now_text text;
  v_current_revision bigint;
  v_new_revision     bigint;
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  v_now := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then raise exception 'not_found'; end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;

  v_current_revision := coalesce((v_inv ->> 'revision')::bigint, 0);
  -- R9B TEST 9 (ronda 5, Blockerare 4): NULL-fail-closed, se invoice_line_update() ovan för full motivering.
  if p_expected_revision is null or v_current_revision is distinct from p_expected_revision then
    raise exception 'stale_write';
  end if;

  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  /* R9B TEST 9 (ronda 6): samma minsta sanity-nivå som discount_set.
     Replikerar INTE den fulla ROT/RUT-invarianten (medvetet). */
  if not (p_tax_reduction ->> 'type' = any(array['none','rot','rut'])) then
    raise exception 'invalid_tax_type';
  end if;
  if (p_tax_reduction ->> 'amount')::numeric is null
     or (p_tax_reduction ->> 'amount')::numeric = 'NaN'::numeric
     or (p_tax_reduction ->> 'amount')::numeric < 0 then
    raise exception 'invalid_tax_amount';
  end if;
  if (p_tax_reduction ->> 'basis')::numeric is null
     or (p_tax_reduction ->> 'basis')::numeric = 'NaN'::numeric
     or (p_tax_reduction ->> 'basis')::numeric < 0 then
    raise exception 'invalid_tax_basis';
  end if;
  /* R9B FINAL (sista precisionskontrollen): ROT/RUT-belopp är riktiga
     penningbelopp i SEK — samma dokumenterade 2-decimalersgräns som
     fast rabatt, för en KONSEKVENT affärsregel (gäller bara när ett
     faktiskt avdrag sätts — 'none' har redan amount/basis=0,
     scale 0). */
  if p_tax_reduction ->> 'type' in ('rot', 'rut') then
    if scale((p_tax_reduction ->> 'amount')::numeric) > 2 then raise exception 'invalid_tax_amount'; end if;
    if scale((p_tax_reduction ->> 'basis')::numeric) > 2 then raise exception 'invalid_tax_basis'; end if;
  end if;

  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 3 — EXAKT
     den av granskningen givna reproduktionen: qty=1, unitPrice=100→0,
     vatRate=25, ROT amount=100 kvarstående ⇒ customerPays=-100). Samma
     atomiska, radlås-skyddade kontroll som i invoice_discount_set. */
  perform public._invoice_financial_check(
    v_inv || jsonb_build_object('taxReduction', p_tax_reduction)
  );

  v_new_revision := v_current_revision + 1;
  v_inv := v_inv || jsonb_build_object('taxReduction', p_tax_reduction, 'updatedAt', v_now_text, 'revision', v_new_revision);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.offer_attachment_append(p_attachment jsonb)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.offer_attachment_append(p_attachment jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_attachments jsonb;
  v_now         timestamptz := clock_timestamp();
  v_now_text    text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  insert into public.store(key, value) values ('vift_offerAttachments', '[]'::jsonb)
    on conflict (key) do nothing;

  select value into v_attachments from public.store where key = 'vift_offerAttachments' for update;
  if v_attachments is null or jsonb_typeof(v_attachments) <> 'array' then
    v_attachments := '[]'::jsonb;
  end if;

  v_attachments := v_attachments || jsonb_build_array(p_attachment);
  -- Samma 5000-tak som den tidigare Deno-sidiga koden (oförändrad gräns).
  if jsonb_array_length(v_attachments) > 5000 then
    select jsonb_agg(elem) into v_attachments
      from (
        select elem, row_number() over () as rn
        from jsonb_array_elements(v_attachments) elem
      ) t
      where rn > (jsonb_array_length(v_attachments) - 5000);
  end if;

  update public.store set value = v_attachments, updated_at = v_now where key = 'vift_offerAttachments';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('attachment', p_attachment, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.offer_attachment_patch(p_attachment_id text, p_patch jsonb)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.offer_attachment_patch(p_attachment_id text, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_attachments jsonb;
  v_idx         int;
  v_att         jsonb;
  v_set         jsonb := '{}'::jsonb;
  v_name        text;
  v_now         timestamptz := clock_timestamp();
  v_now_text    text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_attachment_id is null or p_attachment_id = '' then
    raise exception 'missing_fields';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_patch';
  end if;

  select value into v_attachments from public.store where key = 'vift_offerAttachments' for update;
  if v_attachments is null or jsonb_typeof(v_attachments) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1)::int into v_idx
    from jsonb_array_elements(v_attachments) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_attachment_id
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;
  v_att := v_attachments -> v_idx;
  if (v_att ->> 'active') = 'false' then
    raise exception 'not_found';
  end if;

  if p_patch ? 'displayName' then
    v_name := left(btrim(coalesce(p_patch ->> 'displayName', '')), 200);
    if v_name = '' then
      v_name := coalesce(v_att ->> 'originalFileName', '');
    end if;
    v_set := v_set || jsonb_build_object('displayName', v_name);
  end if;
  if p_patch ? 'description' then
    v_set := v_set || jsonb_build_object('description', left(btrim(coalesce(p_patch ->> 'description', '')), 1000));
  end if;
  if p_patch ? 'includeInPublicView' then
    v_set := v_set || jsonb_build_object('includeInPublicView', (p_patch -> 'includeInPublicView') = 'true'::jsonb);
  end if;
  if p_patch ? 'includeInCombinedPdf' then
    v_set := v_set || jsonb_build_object('includeInCombinedPdf', (p_patch -> 'includeInCombinedPdf') = 'true'::jsonb);
  end if;

  v_att := v_att || v_set || jsonb_build_object('updatedAt', v_now_text);
  v_attachments := jsonb_set(v_attachments, array[v_idx::text], v_att);
  update public.store set value = v_attachments, updated_at = v_now where key = 'vift_offerAttachments';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('attachment', v_att, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.offer_attachment_soft_delete(p_attachment_id text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.offer_attachment_soft_delete(p_attachment_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_attachments jsonb;
  v_idx         int;
  v_att         jsonb;
  v_now         timestamptz := clock_timestamp();
  v_now_text    text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into v_attachments from public.store where key = 'vift_offerAttachments' for update;
  if v_attachments is null or jsonb_typeof(v_attachments) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1)::int into v_idx
    from jsonb_array_elements(v_attachments) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_attachment_id
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;

  v_att := (v_attachments -> v_idx) || jsonb_build_object('active', false, 'deletedAt', v_now_text);
  v_attachments := jsonb_set(v_attachments, array[v_idx::text], v_att);
  update public.store set value = v_attachments, updated_at = v_now where key = 'vift_offerAttachments';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('attachment', v_att, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.offer_email_prepare_commit(p_offer_id text)
-- owner=postgres security_definer=True config=search_path=public, extensions, pg_temp
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.offer_email_prepare_commit(p_offer_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_offers                jsonb;
  v_idx                   int;
  v_off                   jsonb;
  -- v_now FÅR INTE ha en DECLARE-initierare -- samma motivering som i
  -- offer_respond_commit (v2/v3/v4/v5): evalueras annars FÖRE de
  -- blockerande `for update`-raderna.
  v_now                   timestamptz;
  v_now_text              text;
  v_has_token             boolean;
  v_snap                  jsonb;
  v_has_valid_snapshot    boolean;
  v_created               boolean;
  v_token                 text;
  v_token_created_text    text;
  v_token_expires_text    text;
  v_open_count            int;
  v_opened_at             text;
  v_updated_at_text       text;
  v_snapshot_text         text;
  v_locked_in_version     text;
  v_lines                 jsonb;
  v_extras                jsonb;
  v_date_text             text;
  v_customer_id           text;
  v_customer              jsonb;
  v_customer_name         text;
  v_first_name            text;
  v_last_name             text;
  v_full_name             text;
  v_customer_type         text;
  v_atts                  jsonb;
  v_public_attachment_ids jsonb;
  v_attachment_patches    jsonb := '[]'::jsonb;
begin
  if p_offer_id is null or btrim(p_offer_id) = '' then
    raise exception 'offer_not_found';
  end if;

  -- ===== KONSEKVENT LÅSORDNING (NYTT I v2): vift_offers FÖRE
  -- vift_offerAttachments, ALLTID i denna ordning -- oavsett vilken gren
  -- koden nedan sedan tar. Båda låsen tas INNAN något beslut (A/B/C)
  -- fattas, av exakt samma skäl som ledde till hela denna rättning: ett
  -- beslut fattat mot olåst data är inaktuellt redan när det fattas. =====
  select value into v_offers from public.store where key = 'vift_offers' for update;

  v_now      := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  if v_offers is null or jsonb_typeof(v_offers) <> 'array' then
    raise exception 'offer_not_found';
  end if;

  select (ord - 1)::int into v_idx
    from jsonb_array_elements(v_offers) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_offer_id
    limit 1;
  if v_idx is null then
    raise exception 'offer_not_found';
  end if;
  v_off := v_offers -> v_idx;

  -- Andra låset, i SAMMA, alltid identiska ordning.
  select value into v_atts from public.store where key = 'vift_offerAttachments' for update;
  if v_atts is null or jsonb_typeof(v_atts) <> 'array' then
    v_atts := '[]'::jsonb;
  end if;

  -- ===== customerId härleds NU från den LÅSTA, aktuella offert-raden
  -- (NYTT I v2 -- v1 tog emot ett EF-beräknat p_customer_name som kunde
  -- vara baserat på en ANNAN, äldre customerId om offerten hunnit
  -- omtilldelas mellan EF:ens tidiga läsning och detta lås). vift_customers
  -- självt låses inte (se filhuvudets motivering), bara läst EFTER att
  -- customerId är känt ur den redan låsta offert-raden. ===== --
  v_customer_id := v_off ->> 'customerId';
  v_customer := null;
  if v_customer_id is not null and v_customer_id <> '' then
    select cust into v_customer
      from public.store s, jsonb_array_elements(coalesce(s.value, '[]'::jsonb)) as cust
      where s.key = 'vift_customers'
        and cust ->> 'id' = v_customer_id
      limit 1;
  end if;

  -- ===== displayCustomerName(), omskrivet i SQL ===== --
  v_first_name    := coalesce(v_customer ->> 'firstName', '');
  v_last_name     := coalesce(v_customer ->> 'lastName', '');
  v_full_name     := btrim(v_first_name || ' ' || v_last_name);
  v_customer_type := coalesce(v_customer ->> 'type', '');
  if v_customer_type = 'privat' then
    v_customer_name := case when v_full_name <> '' then v_full_name else coalesce(v_customer ->> 'name', '') end;
  else
    v_customer_name := case when coalesce(v_customer ->> 'name', '') <> '' then v_customer ->> 'name' else v_full_name end;
  end if;

  -- ===== publicAttachmentIds, beräknat mot den NU LÅSTA
  -- vift_offerAttachments-raden (NYTT I v2 -- v1 tog emot detta som ett
  -- EF-beräknat, pre-lås indata). Samma filter som buildLockedSnapshot()
  -- alltid använde. ===== --
  select coalesce(jsonb_agg(a ->> 'id'), '[]'::jsonb) into v_public_attachment_ids
    from jsonb_array_elements(v_atts) as a
    where (a ->> 'offerId') = p_offer_id
      and coalesce(a ->> 'active', 'true') <> 'false'
      and coalesce(a ->> 'includeInPublicView', 'false') = 'true';

  -- ===== isTokenActive(), omskrivet mot den LÅSTA, aktuella raden ===== --
  v_has_token := coalesce(v_off ->> 'publicToken', '') <> '';
  if v_has_token and coalesce(v_off ->> 'tokenRevokedAt', '') <> '' then
    v_has_token := false;
  end if;
  if v_has_token and coalesce(v_off ->> 'tokenExpiresAt', '') <> '' then
    begin
      if (v_off ->> 'tokenExpiresAt')::timestamptz < v_now then
        v_has_token := false;
      end if;
    exception when others then
      v_has_token := false;
    end;
  end if;

  -- ===== parseSnapshot() + isValidSnapshot(), omskrivet ===== --
  v_snap := null;
  if v_has_token and coalesce(v_off ->> 'lockedSnapshotJSON', '') <> '' then
    begin
      v_snap := (v_off ->> 'lockedSnapshotJSON')::jsonb;
    exception when others then
      v_snap := null;
    end;
  end if;
  v_has_valid_snapshot :=
    v_snap is not null
    and coalesce(v_snap ->> 'id', '') = p_offer_id
    and jsonb_typeof(v_snap -> 'lines') = 'array'
    and jsonb_typeof(v_snap -> 'extras') = 'array'
    and jsonb_typeof(v_snap -> 'publicAttachmentIds') = 'array';

  if v_has_token and v_has_valid_snapshot then
    -- ====== Fall A: aktiv token + giltigt snapshot -- INGEN skrivning ====== --
    v_created            := false;
    v_token               := v_off ->> 'publicToken';
    v_token_created_text  := coalesce(v_off ->> 'tokenCreatedAt', v_now_text);
    v_token_expires_text  := coalesce(v_off ->> 'tokenExpiresAt', '');
    v_open_count          := coalesce((v_off ->> 'openCount')::int, 0);
    v_opened_at           := coalesce(v_off ->> 'openedAt', '');
    v_updated_at_text     := coalesce(v_off ->> 'updatedAt', v_now_text);
    v_snapshot_text       := v_off ->> 'lockedSnapshotJSON';

  else
    -- ====== Fall B eller C: en skrivning krävs -- bygg nytt snapshot ====== --
    v_created := true;

    if v_has_token then
      -- Fall B: behåll befintlig token/utgångstid oförändrad.
      v_token              := v_off ->> 'publicToken';
      v_token_created_text := coalesce(v_off ->> 'tokenCreatedAt', v_now_text);
      v_token_expires_text := coalesce(v_off ->> 'tokenExpiresAt', '');
      v_open_count         := coalesce((v_off ->> 'openCount')::int, 0);
      v_opened_at          := coalesce(v_off ->> 'openedAt', '');
    else
      -- Fall C: nytt, kryptografiskt säkert 32-byte hex-token.
      v_token              := encode(gen_random_bytes(32), 'hex');
      v_token_created_text := v_now_text;
      v_token_expires_text := to_char(
        (v_now + interval '30 days') at time zone 'utc', 'YYYY-MM-DD'
      ) || 'T23:59:59.000Z';
      v_open_count         := 0;
      v_opened_at          := '';
    end if;

    -- ===== buildLockedSnapshot(), omskrivet mot den LÅSTA, aktuella raden ===== --
    v_lines := coalesce(
      (select jsonb_agg(
         (select jsonb_object_agg(kv.k, kv.v) from jsonb_each(elem) as kv(k, v)
            where kv.k in ('id','type','description','templateName','qty','unit',
                           'unitPrice','discount','total','vatRate','exVat','rutAmount',
                           'subLines','text'))
       ) from jsonb_array_elements(coalesce(v_off -> 'lines', '[]'::jsonb)) as elem),
      '[]'::jsonb
    );
    v_extras := coalesce(
      (select jsonb_agg(
         (select jsonb_object_agg(kv.k, kv.v) from jsonb_each(elem) as kv(k, v)
            where kv.k in ('id','description','qty','unit','unitPrice'))
       ) from jsonb_array_elements(coalesce(v_off -> 'extras', '[]'::jsonb)) as elem),
      '[]'::jsonb
    );

    v_date_text := coalesce(
      v_off ->> 'date',
      left(coalesce(v_off ->> 'createdAt', v_now_text), 10)
    );

    v_snapshot_text := (jsonb_build_object(
      'id',                 v_off -> 'id',
      'title',              v_off -> 'title',
      'versionNumber',      v_off -> 'versionNumber',
      'lines',              v_lines,
      'extras',             v_extras,
      'discount',           v_off -> 'discount',
      'taxType',            v_off -> 'taxType',
      'rotRutAmount',       v_off -> 'rotRutAmount',
      'date',               v_date_text,
      'validUntil',         v_off -> 'validUntil',
      'paymentTerms',       v_off -> 'paymentTerms',
      'validityText',       v_off -> 'validityText',
      'terms',              v_off -> 'terms',
      'includes',           v_off -> 'includes',
      'excludes',           v_off -> 'excludes',
      'scope',              v_off -> 'scope',
      'summary',            v_off -> 'summary',
      'generalTerms',       v_off -> 'generalTerms',
      'address',            v_off -> 'address',
      'customerName',       coalesce(v_customer_name, ''),
      'publicAttachmentIds', v_public_attachment_ids
    ))::text;

    if v_has_token then
      -- Fall B: patcha bara lockedSnapshotJSON + updatedAt -- allt annat oförändrat.
      v_off := v_off || jsonb_build_object(
        'lockedSnapshotJSON', v_snapshot_text,
        'updatedAt',          v_now_text
      );
    else
      -- Fall C: full ersättning av tokenfälten.
      v_off := v_off || jsonb_build_object(
        'publicToken',        v_token,
        'tokenCreatedAt',     v_token_created_text,
        'tokenExpiresAt',     v_token_expires_text,
        'tokenRevokedAt',     '',
        'openCount',          0,
        'openedAt',           '',
        'lockedSnapshotJSON', v_snapshot_text,
        'updatedAt',          v_now_text
      );
    end if;

    v_updated_at_text := v_now_text;

    v_offers := jsonb_set(v_offers, array[v_idx::text], v_off);
    update public.store set value = v_offers, updated_at = v_now where key = 'vift_offers';
  end if;

  v_locked_in_version := p_offer_id || '-' || substring(v_token from 1 for 8);

  -- ===== Bilagelåsning -- FLYTTAD IN hit (NYTT I v2). Lås ENDAST ännu
  -- olåsta, aktiva bilagor för DENNA offert, och ENDAST när vi faktiskt
  -- skapade/uppdaterade ett snapshot (v_created) -- exakt samma Fall
  -- A/B/C-gräns originalkoden alltid haft (Fall A låser aldrig bilagor).
  -- Görs atomiskt i samma transaktion/lås som vift_offers-skrivningen
  -- ovan -- EF:ens egen, tidigare olåsta lockOfferAttachments() behövs
  -- inte längre alls. ===== --
  if v_created then
    select coalesce(jsonb_agg(jsonb_build_object('id', a ->> 'id', 'lockedInVersion', v_locked_in_version)), '[]'::jsonb)
      into v_attachment_patches
      from jsonb_array_elements(v_atts) as a
      where (a ->> 'offerId') = p_offer_id
        and coalesce(a ->> 'active', 'true') <> 'false'
        and coalesce(a ->> 'lockedInVersion', '') = '';

    if jsonb_array_length(v_attachment_patches) > 0 then
      select jsonb_agg(
        case
          when (a ->> 'offerId') = p_offer_id
               and coalesce(a ->> 'active', 'true') <> 'false'
               and coalesce(a ->> 'lockedInVersion', '') = ''
            then a || jsonb_build_object('lockedInVersion', v_locked_in_version)
          else a
        end
      ) into v_atts
      from jsonb_array_elements(v_atts) as a;

      update public.store set value = v_atts, updated_at = v_now where key = 'vift_offerAttachments';
    end if;
  end if;

  return jsonb_build_object(
    'offerId',           p_offer_id,
    'offerVersion',      coalesce((v_off ->> 'versionNumber')::int, 1),
    'created',           v_created,
    'offerToken',        v_token,
    'tokenExpiresAt',    v_token_expires_text,
    'lockedInVersion',   v_locked_in_version,
    'attachmentPatches', v_attachment_patches,
    'offerPatch', jsonb_build_object(
      'publicToken',        v_token,
      'tokenCreatedAt',     v_token_created_text,
      'tokenExpiresAt',     v_token_expires_text,
      'tokenRevokedAt',     '',
      'openCount',          v_open_count,
      'openedAt',           v_opened_at,
      'lockedSnapshotJSON', v_snapshot_text,
      'updatedAt',          v_updated_at_text
    )
  );
end;
$function$;

-- ====================================================================
-- public.offer_events_append(p_event jsonb)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.offer_events_append(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_arr        jsonb;
  v_event_id   text := p_event ->> 'id';
  v_status     text := p_event ->> 'status';
  v_message_id text := p_event ->> 'messageId';
  v_existing   jsonb;
  v_max_keep   constant int := 10000;
  v_len        int;
begin
  if v_event_id is null or v_event_id = '' then
    raise exception 'invalid_event: missing id';
  end if;

  /* Säkerställ att raden existerar INNAN vi låser den — SELECT ... FOR
     UPDATE på en rad som inte finns låser ingenting. */
  insert into public.store(key, value) values ('vift_offerEvents', '[]'::jsonb)
    on conflict (key) do nothing;

  /* Radlåsning — EXAKT den mekanism som redan är etablerad i
     20260908000001/20260917000001 för samma problemklass. Alla samtidiga
     anrop (oavsett vilken offert de gäller — nyckeln är delad) serialiseras
     här; den som får låset andra läser garanterat den FÖRSTA transaktionens
     redan committade resultat, inte en stale kopia. */
  select value into v_arr from public.store where key = 'vift_offerEvents' for update;
  if v_arr is null or jsonb_typeof(v_arr) <> 'array' then
    v_arr := '[]'::jsonb;
  end if;

  /* Deduplicering INUTI den låsta transaktionen — flyttad hit från Edge
     Function-minnet, som i sig var racet (två samtidiga anrop kunde båda
     se "ingen dubblett" i sina respektive, redan föråldrade kopior). */
  select elem into v_existing
    from jsonb_array_elements(v_arr) as elem
    where (elem ->> 'id') = v_event_id
       or (
            v_status = 'sent' and v_message_id is not null and v_message_id <> ''
            and (elem ->> 'messageId') = v_message_id
            and (elem ->> 'status') = 'sent'
          )
    limit 1;

  if v_existing is not null then
    /* Redan persisterad (idempotent Resend-retur av samma mejl, eller ett
       dubbelt om-försök av samma händelse) — returnera den BEFINTLIGA
       posten oförändrad, skapa ALDRIG en andra historikpost. */
    return v_existing;
  end if;

  v_arr := v_arr || jsonb_build_array(p_event);

  v_len := jsonb_array_length(v_arr);
  if v_len > v_max_keep then
    /* Behåll bara de v_max_keep SENASTE, i ORIGINALORDNING (samma
       kvarhållningspolicy som tidigare — splice bort äldst — nu utförd
       atomiskt inom låset). */
    select jsonb_agg(elem order by ord) into v_arr
      from (
        select elem, ord
        from jsonb_array_elements(v_arr) with ordinality as t(elem, ord)
        where ord > (v_len - v_max_keep)
      ) sub;
  end if;

  update public.store set value = v_arr, updated_at = now() where key = 'vift_offerEvents';
  return p_event;
end;
$function$;

-- ====================================================================
-- public.offer_respond_commit(p_token text, p_offer_version integer, p_action text, p_name text, p_email text, p_comment text, p_decline_reason text, p_ip text, p_change_category text, p_request_id text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.offer_respond_commit(p_token text, p_offer_version integer, p_action text, p_name text, p_email text, p_comment text, p_decline_reason text, p_ip text, p_change_category text DEFAULT ''::text, p_request_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offers jsonb;
  v_idx    int;
  v_off    jsonb;
  -- v_now FÅR INTE sättas här -- se v2/v3:s motivering (DECLARE-initierare
  -- evalueras före den blockerande `for update`-raden). Oförändrat.
  v_now    timestamptz;
  v_now_text text;
  v_new_status text;
  v_event_type text;
  v_event      jsonb;
  v_cached     jsonb;
  v_result     jsonb;
  v_fingerprint text;
begin
  -- NYTT I v4: längdspärr på p_request_id, FÖRE allt annat (inklusive
  -- NULL-kontrollerna nedan, eftersom detta är ett strukturellt
  -- förkastande, inte en affärsregel).
  if p_request_id is not null and length(p_request_id) > 128 then
    raise exception 'invalid_request_id';
  end if;

  -- Oförändrat från v2/v3: explicit NULL-kontroll FÖRE varje jämförelse/användning.
  if p_token is null or length(p_token) < 32 then
    raise exception 'invalid_token';
  end if;
  if p_action is null or p_action not in ('approve', 'change_request', 'decline') then
    raise exception 'invalid_action';
  end if;
  if p_offer_version is null then
    raise exception 'invalid_action';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name_required';
  end if;
  if p_email is null or btrim(p_email) = '' or p_email not like '%@%' then
    raise exception 'name_required';
  end if;

  -- Radlås INNAN något läses för validering -- oförändrat från v2/v3.
  select value into v_offers from public.store where key = 'vift_offers' for update;

  v_now      := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  if v_offers is null or jsonb_typeof(v_offers) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1)::int into v_idx
    from jsonb_array_elements(v_offers) with ordinality as t(elem, ord)
    where elem ->> 'publicToken' = p_token
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;
  v_off := v_offers -> v_idx;

  -- NYTT I v4: fingeravtrycket beräknas ALLTID när ett request-ID finns,
  -- oavsett om det blir en cache-träff eller inte -- det behövs i båda
  -- fallen (jämförelse vid träff, lagring vid nytt anrop).
  if p_request_id is not null and btrim(p_request_id) <> '' then
    -- RÄTTAT I v5 (se RÄTTNING 3 i filhuvudet): jsonb_build_array(...)::text
    -- istället för '|'-konkatenering -- varje fält citeras/eskejpas för sig
    -- av JSON-serialiseringen, så ett '|' (eller citattecken, eller något
    -- annat tecken) INUTI ett fältvärde kan aldrig förväxlas med en
    -- fältgräns.
    v_fingerprint := md5(
      jsonb_build_array(
        coalesce(p_token, ''),
        p_offer_version,
        coalesce(p_action, ''),
        coalesce(p_name, ''),
        coalesce(p_email, ''),
        coalesce(p_comment, ''),
        coalesce(p_change_category, ''),
        coalesce(p_decline_reason, '')
      )::text
    );

    create table if not exists public.op_idempotency (
      fn_name    text        not null,
      idem_key   text        not null,
      result     jsonb       not null,
      created_at timestamptz not null default now(),
      primary key (fn_name, idem_key)
    );
    select result into v_cached from public.op_idempotency
      where fn_name = 'offer_respond_commit' and idem_key = p_request_id
      for update;

    if v_cached is not null then
      -- NYTT I v4: jämför fingeravtryck INNAN något returneras.
      if (v_cached ->> '_fp') is distinct from v_fingerprint then
        raise exception 'idempotency_key_conflict';
      end if;
      -- Äkta repris, oförändrat beteende från v3: returnera cachat resultat,
      -- med `_fp` strippat (den interna nyckeln ska aldrig nå anroparen).
      return (v_cached - '_fp') || jsonb_build_object('isReplay', true);
    end if;
    -- Ingen cache-träff -- samma resonemang som v3 om samtidiga tvillingar
    -- (radlåset serialiserar dem; en misslyckad första tvilling rullas
    -- tillbaka utan att skriva cache, så den andra utvärderas normalt).
  end if;

  -- Samma valideringar som v2/v3, körda EFTER låset (och EFTER
  -- idempotenskontrollen ovan, som är en ren läsning/jämförelse och inte
  -- ändrar något som dessa kontroller beror på).
  if coalesce(v_off ->> 'tokenRevokedAt', '') <> '' then
    raise exception 'revoked';
  end if;
  if coalesce(v_off ->> 'tokenExpiresAt', '') <> '' then
    if (v_off ->> 'tokenExpiresAt')::timestamptz < v_now then
      raise exception 'expired';
    end if;
  end if;

  if coalesce((v_off ->> 'versionNumber')::int, 1) is distinct from p_offer_version then
    raise exception 'version_mismatch:%', coalesce((v_off ->> 'versionNumber')::int, 1);
  end if;

  if (v_off ->> 'status') in ('godkänd', 'nekad') then
    raise exception 'already_answered:%', (v_off ->> 'status');
  end if;

  v_new_status := case p_action
    when 'approve'        then 'godkänd'
    when 'change_request' then 'ändring-begärd'
    when 'decline'        then 'nekad'
  end;

  v_off := v_off || jsonb_build_object(
    'status', v_new_status, 'answeredAt', v_now_text, 'updatedAt', v_now_text
  );

  if p_action = 'approve' then
    v_off := v_off || jsonb_build_object(
      'customerApproval', jsonb_build_object(
        'token', p_token, 'approvedAt', v_now_text,
        'approvedByName', p_name, 'approvedByEmail', p_email,
        'ip', p_ip, 'comment', coalesce(p_comment, '')
      )
    );
  end if;

  if p_action = 'decline' then
    v_off := v_off || jsonb_build_object('declineReason', coalesce(nullif(p_decline_reason, ''), 'annat'));
  end if;

  v_offers := jsonb_set(v_offers, array[v_idx::text], v_off);
  update public.store set value = v_offers, updated_at = v_now where key = 'vift_offers';

  -- Oförändrat från v2/v3: händelseloggen i samma transaktion som statusändringen.
  v_event_type := case p_action
    when 'approve'        then 'approved'
    when 'change_request' then 'change_requested'
    when 'decline'         then 'declined'
  end;
  v_event := jsonb_build_object(
    'id',                    'oe-' || gen_random_uuid()::text,
    'offerId',               v_off ->> 'id',
    'offerVersion',          coalesce((v_off ->> 'versionNumber')::int, 1),
    'type',                  v_event_type,
    'ts',                    v_now_text,
    'byUser',                '',
    'byCustomer',            p_name,
    'byEmail',               p_email,
    'ip',                    coalesce(p_ip, ''),
    'comment',               coalesce(p_comment, ''),
    'changeRequestCategory', coalesce(p_change_category, ''),
    'declineReason',         coalesce(nullif(p_decline_reason, ''), ''),
    'requestId',             coalesce(p_request_id, '')
  );
  perform public.offer_events_append(v_event);

  -- v_result = exakt payloaden som returneras till anroparen -- ALDRIG
  -- utökad med `_fp`. v_cached = v_result + `_fp`, ENDAST det som lagras.
  v_result := jsonb_build_object(
    'offerId',      v_off ->> 'id',
    'offerVersion', coalesce((v_off ->> 'versionNumber')::int, 1),
    'offerTitle',   coalesce(v_off ->> 'title', v_off ->> 'id'),
    'newStatus',    v_new_status,
    'answeredAt',   v_now_text
  );

  if p_request_id is not null and btrim(p_request_id) <> '' then
    v_cached := v_result || jsonb_build_object('_fp', v_fingerprint);
    insert into public.op_idempotency(fn_name, idem_key, result)
      values ('offer_respond_commit', p_request_id, v_cached)
      on conflict (fn_name, idem_key) do nothing;
  end if;

  return v_result || jsonb_build_object('isReplay', false);
end;
$function$;

-- ====================================================================
-- public.offer_token_open_commit(p_token text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.offer_token_open_commit(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_offers        jsonb;
  v_idx           int;
  v_off           jsonb;
  v_now           timestamptz;  -- EFTER låset, se motivering ovan -- ingen initierare här.
  v_now_text      text;
  v_is_first_open boolean;
  v_open_count    bigint;
begin
  -- Billig, ren indatavalidering FÖRE låset (samma stil som v3:s
  -- pre-lock-kontroller för kontroller som inte beror på radens innehåll).
  if p_token is null or length(p_token) < 32 then
    raise exception 'invalid_token';
  end if;

  -- Radlås INNAN något läses för validering -- oförändrat mönster från
  -- offer_respond_commit.
  select value into v_offers from public.store where key = 'vift_offers' for update;

  v_now      := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  if v_offers is null or jsonb_typeof(v_offers) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1)::int into v_idx
    from jsonb_array_elements(v_offers) with ordinality as t(elem, ord)
    where elem ->> 'publicToken' = p_token
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;
  v_off := v_offers -> v_idx;

  -- Omkontrollerat mot den LÅSTA, aktuella raden -- inte den olåsta kopian
  -- som dagens kod läser. Detta fångar en återkallning/utgång som skett
  -- medan detta anrop väntade på låset (bevisas separat i regressionstestet).
  if coalesce(v_off ->> 'tokenRevokedAt', '') <> '' then
    raise exception 'revoked';
  end if;
  if coalesce(v_off ->> 'tokenExpiresAt', '') <> '' then
    if (v_off ->> 'tokenExpiresAt')::timestamptz < v_now then
      raise exception 'expired:%', (v_off ->> 'tokenExpiresAt');
    end if;
  end if;

  -- Öppningsstatistik -- samma semantik som dagens kod (rad 131-137 i den
  -- verkliga EF-filen): openCount inkrementeras alltid, openedAt sätts
  -- bara vid FÖRSTA öppningen (saknas eller är tom sträng).
  v_is_first_open := (coalesce(v_off ->> 'openedAt', '') = '');
  v_open_count     := coalesce((v_off ->> 'openCount')::bigint, 0) + 1;

  v_off := v_off || jsonb_build_object(
    'openCount', v_open_count,
    'updatedAt', v_now_text
  );
  if v_is_first_open then
    v_off := v_off || jsonb_build_object('openedAt', v_now_text);
  end if;

  v_offers := jsonb_set(v_offers, array[v_idx::text], v_off);
  update public.store set value = v_offers, updated_at = v_now where key = 'vift_offers';
  -- Inget separat felkontroll-steg behövs: om UPDATE av någon anledning
  -- misslyckas (t.ex. en constraint) kastar Postgres självt en exception
  -- här och HELA transaktionen (inklusive den redan gjorda mutationen i
  -- minnet) rullas tillbaka -- till skillnad från dagens kod, som aldrig
  -- läser `upsert`-anropets `error` och därför kan svara "OK" till kunden
  -- trots ett tyst misslyckat skriv.

  return jsonb_build_object(
    'offer',       v_off,
    'isFirstOpen', v_is_first_open
  );
end;
$function$;

-- ====================================================================
-- public.project_documents_append(p_new_doc jsonb)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.project_documents_append(p_new_doc jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_arr jsonb; v_now_sig text;
begin
  insert into public.store(key, value) values ('vift_projectDocuments', '[]'::jsonb) on conflict (key) do nothing;
  select value into v_arr from public.store where key = 'vift_projectDocuments' for update;
  if v_arr is null or jsonb_typeof(v_arr) <> 'array' then v_arr := '[]'::jsonb; end if;
  v_arr := v_arr || jsonb_build_array(p_new_doc);
  update public.store set value = v_arr, updated_at = now() where key = 'vift_projectDocuments';
  v_now_sig := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_sig))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return p_new_doc;
end;
$function$;

-- ====================================================================
-- public.project_documents_finalize_delete(p_doc_id text, p_expected_project_id text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.project_documents_finalize_delete(p_doc_id text, p_expected_project_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_arr jsonb; v_idx int; v_doc jsonb; v_updated jsonb; v_now_sig text;
begin
  select value into v_arr from public.store where key = 'vift_projectDocuments' for update;
  if v_arr is null then raise exception 'not_found'; end if;
  select (ord - 1) into v_idx from jsonb_array_elements(v_arr) with ordinality as t(elem, ord) where elem ->> 'id' = p_doc_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_doc := v_arr -> v_idx;
  if (v_doc ->> 'projectId') is distinct from p_expected_project_id then raise exception 'forbidden'; end if;
  v_updated := v_doc || jsonb_build_object('active', false, 'deletedAt', to_jsonb(now()::text));
  v_arr := jsonb_set(v_arr, array[v_idx::text], v_updated);
  update public.store set value = v_arr, updated_at = now() where key = 'vift_projectDocuments';
  v_now_sig := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_sig))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_updated;
end;
$function$;

-- ====================================================================
-- public.project_documents_update_one(p_doc_id text, p_expected_project_id text, p_patch jsonb)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.project_documents_update_one(p_doc_id text, p_expected_project_id text, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_arr jsonb; v_idx int; v_doc jsonb; v_updated jsonb; v_now_sig text;
begin
  select value into v_arr from public.store where key = 'vift_projectDocuments' for update;
  if v_arr is null then raise exception 'not_found'; end if;
  select (ord - 1) into v_idx from jsonb_array_elements(v_arr) with ordinality as t(elem, ord) where elem ->> 'id' = p_doc_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_doc := v_arr -> v_idx;
  if (v_doc ->> 'projectId') is distinct from p_expected_project_id then raise exception 'forbidden'; end if;
  v_updated := (v_doc || p_patch) || jsonb_build_object('updatedAt', to_jsonb(now()::text));
  v_arr := jsonb_set(v_arr, array[v_idx::text], v_updated);
  update public.store set value = v_arr, updated_at = now() where key = 'vift_projectDocuments';
  v_now_sig := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_sig))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_updated;
end;
$function$;

-- ====================================================================
-- public.provision_vift_user(p_user_id uuid, p_staff_id text, p_role_id text, p_is_admin boolean)
-- owner=postgres security_definer=True config=search_path=public, pg_catalog
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.rondering_pass_auto_start(p_pass_id text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.rondering_pass_auto_start(p_pass_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_passes   jsonb;
  v_idx      int;
  v_pass     jsonb;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into v_passes from public.store where key = 'vift_ronderingspass' for update;
  if v_passes is null or jsonb_typeof(v_passes) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1) into v_idx
    from jsonb_array_elements(v_passes) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_pass_id
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;

  v_pass := v_passes -> v_idx;
  if (v_pass ->> 'status') = 'planerat' then
    v_pass := v_pass || jsonb_build_object('status', 'pågående', 'updatedAt', v_now_text);
    if coalesce(v_pass ->> 'startedAt', '') = '' then
      v_pass := v_pass || jsonb_build_object('startedAt', v_now_text);
    end if;
    v_passes := jsonb_set(v_passes, array[v_idx::text], v_pass);
    update public.store set value = v_passes, updated_at = v_now where key = 'vift_ronderingspass';
    insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
      on conflict (key) do update set value = excluded.value, updated_at = v_now;
  end if;

  return jsonb_build_object('pass', v_pass, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.rondering_pass_complete(p_pass_id text, p_caller_staff_id text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.rondering_pass_complete(p_pass_id text, p_caller_staff_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_passes   jsonb;
  v_idx      int;
  v_pass     jsonb;
  v_summary  jsonb;
  v_status   text;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into v_passes from public.store where key = 'vift_ronderingspass' for update;
  if v_passes is null or jsonb_typeof(v_passes) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1) into v_idx
    from jsonb_array_elements(v_passes) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_pass_id
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;

  v_pass := v_passes -> v_idx;
  v_summary := public._rondering_recompute_summary(v_pass -> 'categories');
  v_status := case when coalesce((v_summary ->> 'anmärkningar')::int, 0) > 0
                    then 'har_avvikelser' else 'slutfört' end;

  v_pass := v_pass || jsonb_build_object(
    'summary', v_summary,
    'status', v_status,
    'completedAt', v_now_text,
    'completedBy', p_caller_staff_id,
    'updatedAt', v_now_text
  );
  v_passes := jsonb_set(v_passes, array[v_idx::text], v_pass);
  update public.store set value = v_passes, updated_at = v_now where key = 'vift_ronderingspass';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('pass', v_pass, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.rondering_pass_create(p_pass_template jsonb)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.rondering_pass_create(p_pass_template jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_passes      jsonb;
  v_rondering_id text := p_pass_template ->> 'ronderingId';
  v_max_num     int := 0;
  v_seq         int := 0;
  v_elem        jsonb;
  v_num         int;
  v_new_id      text;
  v_now         timestamptz := clock_timestamp();
  v_now_text    text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_new_pass    jsonb;
begin
  insert into public.store(key, value) values ('vift_ronderingspass', '[]'::jsonb)
    on conflict (key) do nothing;

  select value into v_passes from public.store where key = 'vift_ronderingspass' for update;
  if v_passes is null or jsonb_typeof(v_passes) <> 'array' then
    v_passes := '[]'::jsonb;
  end if;

  for v_elem in select * from jsonb_array_elements(v_passes) loop
    v_num := nullif(regexp_replace(coalesce(v_elem ->> 'id', ''), '[^0-9]', '', 'g'), '')::int;
    if v_num is not null and v_num > v_max_num then v_max_num := v_num; end if;
    if (v_elem ->> 'ronderingId') = v_rondering_id then v_seq := v_seq + 1; end if;
  end loop;

  v_new_id := 'PASS-' || lpad((v_max_num + 1)::text, 3, '0');

  v_new_pass := p_pass_template || jsonb_build_object(
    'id', v_new_id,
    'sequenceNumber', v_seq + 1,
    'status', coalesce(p_pass_template ->> 'status', 'planerat'),
    'summary', public._rondering_recompute_summary(p_pass_template -> 'categories'),
    'createdAt', v_now_text,
    'updatedAt', v_now_text
  );

  v_passes := v_passes || jsonb_build_array(v_new_pass);
  update public.store set value = v_passes, updated_at = v_now where key = 'vift_ronderingspass';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('pass', v_new_pass, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.rondering_pass_migrate_legacy(p_pass jsonb)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.rondering_pass_migrate_legacy(p_pass jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_passes   jsonb;
  v_id       text := p_pass ->> 'id';
  v_existing jsonb;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if coalesce(v_id, '') = '' then
    raise exception 'missing_id';
  end if;

  insert into public.store(key, value) values ('vift_ronderingspass', '[]'::jsonb)
    on conflict (key) do nothing;

  select value into v_passes from public.store where key = 'vift_ronderingspass' for update;
  if v_passes is null or jsonb_typeof(v_passes) <> 'array' then
    v_passes := '[]'::jsonb;
  end if;

  select elem into v_existing from jsonb_array_elements(v_passes) elem where elem ->> 'id' = v_id limit 1;
  if v_existing is not null then
    return jsonb_build_object('pass', v_existing, 'created', false);
  end if;

  v_passes := v_passes || jsonb_build_array(p_pass || jsonb_build_object('updatedAt', v_now_text));
  update public.store set value = v_passes, updated_at = v_now where key = 'vift_ronderingspass';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('pass', p_pass, 'created', true, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.rondering_pass_save_note(p_pass_id text, p_note text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.rondering_pass_save_note(p_pass_id text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_passes   jsonb;
  v_idx      int;
  v_pass     jsonb;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into v_passes from public.store where key = 'vift_ronderingspass' for update;
  if v_passes is null or jsonb_typeof(v_passes) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1) into v_idx
    from jsonb_array_elements(v_passes) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_pass_id
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;

  v_pass := (v_passes -> v_idx) || jsonb_build_object(
    'internalNote', coalesce(p_note, ''), 'updatedAt', v_now_text
  );
  v_passes := jsonb_set(v_passes, array[v_idx::text], v_pass);
  update public.store set value = v_passes, updated_at = v_now where key = 'vift_ronderingspass';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('pass', v_pass, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.rondering_passes_bulk_create(p_rondering_id text, p_candidates jsonb)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.rondering_passes_bulk_create(p_rondering_id text, p_candidates jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_passes    jsonb;
  v_max_num   int := 0;
  v_seq       int := 0;
  v_elem      jsonb;
  v_num       int;
  v_cand      jsonb;
  v_exists    boolean;
  v_new_id    text;
  v_new_pass  jsonb;
  v_created   jsonb := '[]'::jsonb;
  v_created_count int := 0;
  v_skipped_count int := 0;
  v_now       timestamptz := clock_timestamp();
  v_now_text  text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  insert into public.store(key, value) values ('vift_ronderingspass', '[]'::jsonb)
    on conflict (key) do nothing;

  select value into v_passes from public.store where key = 'vift_ronderingspass' for update;
  if v_passes is null or jsonb_typeof(v_passes) <> 'array' then
    v_passes := '[]'::jsonb;
  end if;

  for v_elem in select * from jsonb_array_elements(v_passes) loop
    v_num := nullif(regexp_replace(coalesce(v_elem ->> 'id', ''), '[^0-9]', '', 'g'), '')::int;
    if v_num is not null and v_num > v_max_num then v_max_num := v_num; end if;
    if (v_elem ->> 'ronderingId') = p_rondering_id then v_seq := v_seq + 1; end if;
  end loop;

  for v_cand in select * from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) loop
    -- Dedupe: redan existerande rader i v_passes (inkl. de som skapas
    -- tidigare I SAMMA anrop, eftersom vi appendar till v_passes nedan).
    select exists(
      select 1 from jsonb_array_elements(v_passes) t(elem)
      where (elem ->> 'ronderingId') = p_rondering_id
        and (elem ->> 'scheduledDate') = (v_cand ->> 'scheduledDate')
        and coalesce((elem ->> 'migratedFromLegacy')::boolean, false) = false
    ) into v_exists;

    if v_exists then
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;

    v_max_num := v_max_num + 1;
    v_seq := v_seq + 1;
    v_new_id := 'PASS-' || lpad(v_max_num::text, 3, '0');
    v_new_pass := v_cand || jsonb_build_object(
      'id', v_new_id,
      'ronderingId', p_rondering_id,
      'sequenceNumber', v_seq,
      'status', coalesce(v_cand ->> 'status', 'planerat'),
      'summary', public._rondering_recompute_summary(v_cand -> 'categories'),
      'createdAt', v_now_text,
      'updatedAt', v_now_text
    );
    v_passes := v_passes || jsonb_build_array(v_new_pass);
    v_created := v_created || jsonb_build_array(v_new_pass);
    v_created_count := v_created_count + 1;
  end loop;

  if v_created_count > 0 then
    update public.store set value = v_passes, updated_at = v_now where key = 'vift_ronderingspass';
    insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
      on conflict (key) do update set value = excluded.value, updated_at = v_now;
  end if;

  return jsonb_build_object(
    'created', v_created, 'createdCount', v_created_count,
    'skippedCount', v_skipped_count, 'serverSignature', v_now_text
  );
end;
$function$;

-- ====================================================================
-- public.rondering_point_patch(p_pass_id text, p_category_id text, p_point_id text, p_status text, p_comment text, p_deviation_id text, p_work_order_id text, p_caller_staff_id text, p_is_reset boolean)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.rondering_point_patch(p_pass_id text, p_category_id text, p_point_id text, p_status text, p_comment text, p_deviation_id text, p_work_order_id text, p_caller_staff_id text, p_is_reset boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_passes      jsonb;
  v_pass_idx    int;
  v_pass        jsonb;
  v_cats        jsonb;
  v_cat_idx     int;
  v_cat         jsonb;
  v_pts         jsonb;
  v_pt_idx      int;
  v_pt          jsonb;
  v_updated_pt  jsonb;
  v_now         timestamptz := clock_timestamp();
  v_now_text    text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if not p_is_reset and p_status not in ('ok', 'anmärkning', 'ej_aktuell', 'ej_kontrollerad') then
    raise exception 'invalid_status';
  end if;

  -- ── 1) Lås EXAKT vift_ronderingspass-raden ────────────────────────
  select value into v_passes from public.store where key = 'vift_ronderingspass' for update;
  if v_passes is null or jsonb_typeof(v_passes) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1) into v_pass_idx
    from jsonb_array_elements(v_passes) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_pass_id
    limit 1;
  if v_pass_idx is null then
    raise exception 'not_found';
  end if;
  v_pass := v_passes -> v_pass_idx;

  -- ── 2) Hitta kategori via stabil id ───────────────────────────────
  v_cats := coalesce(v_pass -> 'categories', '[]'::jsonb);
  select (ord - 1) into v_cat_idx
    from jsonb_array_elements(v_cats) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_category_id
    limit 1;
  if v_cat_idx is null then
    raise exception 'category_not_found';
  end if;
  v_cat := v_cats -> v_cat_idx;

  -- ── 3) Hitta punkt via stabil id ───────────────────────────────────
  v_pts := coalesce(v_cat -> 'points', '[]'::jsonb);
  select (ord - 1) into v_pt_idx
    from jsonb_array_elements(v_pts) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_point_id
    limit 1;
  if v_pt_idx is null then
    raise exception 'point_not_found';
  end if;
  v_pt := v_pts -> v_pt_idx;

  -- ── 4) Beräkna punktens nya tillstånd — SAMMA semantik som
  --      klientens _setPointStatus()/undoPt() (oförändrad). ──────────
  if p_is_reset then
    v_updated_pt := v_pt || jsonb_build_object(
      'status', '', 'comment', '', 'deviationId', null,
      'workOrderId', null, 'checkedAt', null, 'checkedBy', null
    );
  else
    v_updated_pt := v_pt || jsonb_build_object(
      'status', p_status,
      'comment', coalesce(p_comment, ''),
      'checkedAt', v_now_text,
      'checkedBy', p_caller_staff_id
    );
    if p_deviation_id is not null then
      v_updated_pt := v_updated_pt || jsonb_build_object('deviationId', p_deviation_id);
    end if;
    if p_work_order_id is not null then
      v_updated_pt := v_updated_pt || jsonb_build_object('workOrderId', p_work_order_id);
    end if;
  end if;

  v_pts := jsonb_set(v_pts, array[v_pt_idx::text], v_updated_pt);
  v_cat := jsonb_set(v_cat, array['points'], v_pts);
  v_cats := jsonb_set(v_cats, array[v_cat_idx::text], v_cat);
  v_pass := jsonb_set(v_pass, array['categories'], v_cats);

  -- ── 5) Räkna om summary FRÅN den faktiska, låsta strukturen ───────
  v_pass := jsonb_set(v_pass, array['summary'], public._rondering_recompute_summary(v_cats));

  -- ── 6) Auto-start — SAMMA regel som klientens _setPointStatus()
  --      (oförändrad semantik): endast vid en ÄKTA statusändring
  --      (inte reset/undo), och endast från 'planerat'. Läses här från
  --      den LÅSTA raden — två samtidiga klienter kan omöjligen båda se
  --      "fortfarande planerat" och båda trigga en övergång. ─────────
  if not p_is_reset and (v_pass ->> 'status') = 'planerat' then
    v_pass := v_pass || jsonb_build_object('status', 'pågående');
    if coalesce(v_pass ->> 'startedAt', '') = '' then
      v_pass := v_pass || jsonb_build_object('startedAt', v_now_text);
    end if;
  end if;

  v_pass := v_pass || jsonb_build_object('updatedAt', v_now_text);
  v_passes := jsonb_set(v_passes, array[v_pass_idx::text], v_pass);
  update public.store set value = v_passes, updated_at = v_now where key = 'vift_ronderingspass';

  -- ── 7) Bumpa DataSync-synksignalen INOM SAMMA transaktion ─────────
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('pass', v_pass, 'serverSignature', v_now_text);
end;
$function$;

-- ====================================================================
-- public.sensitive_fields_write(p_object_id text, p_property_id text, p_fields jsonb, p_user_id uuid, p_user_email text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.sensitive_fields_write(p_object_id text, p_property_id text, p_fields jsonb, p_user_id uuid, p_user_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_keys  constant text[] := array['doorCode','keyInformation','keyReceipt','alarmInformation','accessInformation','accessCode'];
  v_obj   text := nullif(p_object_id, '');
  v_prop  text := nullif(p_property_id, '');
  v_bad   text[];
  v_names text[];
  v_n     int;
  v_id    uuid;
  v_op    text;
  v_audit uuid;
begin
  if v_obj is null and v_prop is null then
    raise exception 'sensitive_fields_write: objectId or propertyId required' using errcode = '22023';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'sensitive_fields_write: p_fields must be a JSON object' using errcode = '22023';
  end if;
  if p_user_id is null or nullif(p_user_email, '') is null then
    raise exception 'sensitive_fields_write: caller identity required for the audit row' using errcode = '22023';
  end if;
  select array_agg(k) into v_bad from jsonb_object_keys(p_fields) k where k <> all (c_keys);
  if v_bad is not null then
    raise exception 'sensitive_fields_write: unknown field(s) %', v_bad using errcode = '22023';
  end if;
  -- Field NAMES only, in a fixed order. Values never reach the audit table.
  select coalesce(array_agg(k order by array_position(c_keys, k)), '{}') into v_names
    from jsonb_object_keys(p_fields) k;

  -- Serialise writers of the same target (same lookup as the EF had: object row, else property row).
  perform pg_advisory_xact_lock(hashtextextended(
    'vift.psa:' || case when v_obj is not null then 'o:' || v_obj else 'p:' || v_prop end, 0));

  if v_obj is not null then
    select count(*) into v_n from property_sensitive_access where object_id = v_obj;
  else
    select count(*) into v_n from property_sensitive_access where property_id = v_prop and object_id is null;
  end if;
  if v_n > 1 then  -- the old EF's maybeSingle() also refused this case
    raise exception 'sensitive_fields_write: % rows for one target, expected 0 or 1', v_n;
  end if;

  if v_n = 1 then
    if v_obj is not null then
      select id into v_id from property_sensitive_access where object_id = v_obj for update;
    else
      select id into v_id from property_sensitive_access where property_id = v_prop and object_id is null for update;
    end if;
    update property_sensitive_access set
      property_id        = coalesce(v_prop, property_id),
      door_code          = case when p_fields ? 'doorCode'          then nullif(p_fields ->> 'doorCode', '')          else door_code end,
      key_information    = case when p_fields ? 'keyInformation'    then nullif(p_fields ->> 'keyInformation', '')    else key_information end,
      key_receipt        = case when p_fields ? 'keyReceipt'        then nullif(p_fields ->> 'keyReceipt', '')        else key_receipt end,
      alarm_information  = case when p_fields ? 'alarmInformation'  then nullif(p_fields ->> 'alarmInformation', '')  else alarm_information end,
      access_information = case when p_fields ? 'accessInformation' then nullif(p_fields ->> 'accessInformation', '') else access_information end,
      access_code        = case when p_fields ? 'accessCode'        then nullif(p_fields ->> 'accessCode', '')        else access_code end,
      updated_at         = now(),
      updated_by         = p_user_email
    where id = v_id;
    v_op := 'update';
  else
    insert into property_sensitive_access
      (object_id, property_id, door_code, key_information, key_receipt, alarm_information,
       access_information, access_code, updated_at, updated_by)
    values
      (v_obj, v_prop,
       nullif(p_fields ->> 'doorCode', ''), nullif(p_fields ->> 'keyInformation', ''),
       nullif(p_fields ->> 'keyReceipt', ''), nullif(p_fields ->> 'alarmInformation', ''),
       nullif(p_fields ->> 'accessInformation', ''), nullif(p_fields ->> 'accessCode', ''),
       now(), p_user_email)
    returning id into v_id;
    v_op := 'insert';
  end if;

  -- Mandatory audit row, same transaction. If this insert fails, the exception aborts the whole
  -- call and the data change above is rolled back with it.
  insert into sensitive_access_audit (user_id, user_email, action, object_id, property_id, fields, status, detail)
  values (p_user_id, p_user_email, 'write', v_obj, v_prop, v_names, 'allowed', v_op)
  returning id into v_audit;
  if v_audit is null then
    raise exception 'sensitive_fields_write: audit row not created';
  end if;

  return jsonb_build_object('ok', true, 'op', v_op, 'audit_id', v_audit);
end;
$function$;

-- ====================================================================
-- public.store_business_key_merge_write(p_key text, p_upserts jsonb, p_removals jsonb, p_caller_authorized boolean, p_actor_id text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.store_business_key_read_with_hash(p_key text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.store_business_key_read_with_hash(p_key text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'value', value,
    'hash', encode(sha256(convert_to(coalesce(value, 'null'::jsonb)::text, 'UTF8')), 'hex')
  )
  FROM public.store WHERE key = p_key;
$function$;

-- ====================================================================
-- public.store_business_key_write(p_key text, p_new_value jsonb, p_expected_hash text, p_caller_authorized boolean, p_actor_id text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.store_business_keys_read_hashes(p_keys text[])
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.store_business_keys_read_hashes(p_keys text[])
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_object_agg(key, encode(sha256(convert_to(coalesce(value, 'null'::jsonb)::text, 'UTF8')), 'hex')), '{}'::jsonb)
  FROM public.store
  WHERE key = ANY(p_keys);
$function$;

-- ====================================================================
-- public.store_read_all_with_hashes(p_business_keys text[])
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.store_read_all_with_hashes(p_business_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_data   jsonb := '{}'::jsonb;
  v_hashes jsonb := '{}'::jsonb;
  v_row    record;
begin
  for v_row in select key, value from public.store where key = ANY(p_business_keys) or key = 'vift_lastChanged' loop
    v_data := v_data || jsonb_build_object(v_row.key, v_row.value);
    if v_row.key = ANY(p_business_keys) then
      v_hashes := v_hashes || jsonb_build_object(v_row.key, encode(sha256(convert_to(coalesce(v_row.value, 'null'::jsonb)::text, 'UTF8')), 'hex'));
    end if;
  end loop;
  return jsonb_build_object('data', v_data, 'hashes', v_hashes);
end;
$function$;

-- ====================================================================
-- public.store_read_all_with_hashes_projected(p_business_keys text[], p_perms text[])
-- owner=postgres security_definer=True config=search_path=public, pg_temp
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.store_read_stamp_status(p_auth_user_id uuid)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.store_read_stamp_status(p_auth_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.stamp_status;
begin
  if p_auth_user_id is null then
    raise exception 'store_read_stamp_status: p_auth_user_id required' using errcode = '22023';
  end if;
  select * into v_row from public.stamp_status where user_id = p_auth_user_id;
  if not found then
    -- P2-2 migration-safety (round 3, unchanged): `hasRow:false` means
    -- "never written" — NOT "confirmed clocked out". `revision` 0 is the
    -- correct `p_expected_revision` for this user's FIRST write.
    return jsonb_build_object('active', false, 'ts', null, 'aoId', null, 'hasRow', false, 'revision', 0);
  end if;
  return jsonb_build_object('active', v_row.active, 'ts', v_row.ts, 'aoId', v_row.ao_id, 'hasRow', true, 'revision', v_row.revision);
end;
$function$;

-- ====================================================================
-- public.store_write_stamp_status(p_auth_user_id uuid, p_active boolean, p_ts bigint, p_ao_id text, p_expected_revision bigint)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.time_entry_create(p_entry jsonb, p_idempotency_key text, p_client_id text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.time_entry_patch(p_entry_id text, p_patch jsonb, p_idempotency_key text, p_expected_updated_at text, p_caller_staff_id text, p_caller_can_manage_others boolean)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.time_entry_set_attested(p_entry_id text, p_attested boolean, p_idempotency_key text, p_caller_staff_id text, p_caller_can_attest boolean)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.time_entry_set_attested(p_entry_id text, p_attested boolean, p_idempotency_key text, p_caller_staff_id text, p_caller_can_attest boolean)
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
  v_updated      jsonb;
  v_now          timestamptz := clock_timestamp();
  v_now_text     text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_sig          text;
  v_result       jsonb;
  v_scoped_key   text;
  v_fingerprint  text;
  v_caller_valid boolean;
BEGIN
  -- V5-FIX (fråga 1): se identisk motivering vid time_entry_patch ovan.
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

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  -- V6-FIX (fynd A): se identisk motivering vid time_entry_patch ovan —
  -- NULL normaliseras till FALSE innan den används för att fatta
  -- EXAKT ETT beslut om detta anrop ska tillåtas alls.
  p_caller_can_attest := coalesce(p_caller_can_attest, false);

  -- V6-FIX (fynd A): p_attested är den FAKTISKA attestvärdet som ska
  -- sättas — ett NULL här är en ogiltig, odefinierad begäran (varken
  -- "attestera" eller "av-attestera"), inte ett implicit val av något
  -- slag. Nekas explicit istället för att låta efterföljande
  -- CASE WHEN p_attested-grenar tyst tolka NULL som "falskt" (vilket då
  -- skulle av-attestera en post vid ett anrop som i själva verket var
  -- trasigt/ofullständigt, utan att någon bad om det).
  IF p_attested IS NULL THEN
    RAISE EXCEPTION 'missing_fields';
  END IF;

  -- Enda behörighetsregeln för denna funktion: anroparen måste ha
  -- payroll_manage/all (satt av Edge Function:en från checkViftAuth(),
  -- aldrig från ett klientfält). Ingen ägarskapsbegränsning här — en
  -- löneansvarig attesterar per definition ANDRAS tid.
  IF NOT p_caller_can_attest THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- V5-FIX (fråga 2): se identisk motivering vid time_entry_patch ovan.
  v_scoped_key := p_caller_staff_id || '::' || p_idempotency_key;
  v_fingerprint := md5(coalesce(p_entry_id,'') || '|' || p_attested::text || '|' || p_caller_staff_id);

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'time_entry_set_attested' AND idem_key = v_scoped_key;
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

  -- Bevarar ALLA övriga fält/historik på posten oförändrade (`v_entry ||
  -- ...` är en merge, inte en ersättning) — endast attest-relaterade
  -- fält + updatedAt rörs, exakt det kravet "bevara tidigare
  -- attesteringsstatus och historik" efterfrågar.
  v_updated := v_entry || jsonb_build_object(
    'attested',   p_attested,
    'attestedAt', CASE WHEN p_attested THEN to_jsonb(v_now_text) ELSE to_jsonb(''::text) END,
    'attestedBy', CASE WHEN p_attested THEN to_jsonb(p_caller_staff_id) ELSE to_jsonb(''::text) END,
    'updatedAt',  to_jsonb(v_now_text)
  );
  v_entries := jsonb_set(v_entries, array[v_idx::text], v_updated);
  UPDATE public.store SET value = v_entries, updated_at = v_now WHERE key = 'vift_timeEntries';

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('timeEntry', v_updated, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('time_entry_set_attested', v_scoped_key, v_result || jsonb_build_object('_fp', v_fingerprint));

  RETURN v_result;
END;
$function$;

-- ====================================================================
-- public.time_entry_soft_delete(p_entry_id text, p_idempotency_key text, p_caller_staff_id text, p_caller_can_manage_others boolean)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.time_entry_soft_delete(p_entry_id text, p_idempotency_key text, p_caller_staff_id text, p_caller_can_manage_others boolean)
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
  v_idx          int;
  v_entry        jsonb;
  v_now          timestamptz := clock_timestamp();
  v_now_text     text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_sig          text;
  v_result       jsonb;
  v_ao_id        text;
  v_scoped_key   text;
  v_fingerprint  text;
  v_caller_valid boolean;
BEGIN
  -- V5-FIX (fråga 1): se identisk motivering vid time_entry_patch ovan.
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

  -- V6-FIX (fynd A): se identisk motivering vid time_entry_patch ovan.
  p_caller_can_manage_others := coalesce(p_caller_can_manage_others, false);

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  -- V5-FIX (fråga 2): se identisk motivering vid time_entry_patch ovan —
  -- namnrymd per anropare + fingeravtryck av faktiska indata.
  v_scoped_key := p_caller_staff_id || '::' || p_idempotency_key;
  v_fingerprint := md5(coalesce(p_entry_id,'') || '|' || p_caller_staff_id || '|' || p_caller_can_manage_others::text);

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'time_entry_soft_delete' AND idem_key = v_scoped_key;
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
    -- Idempotent mot upprepad radering: posten finns inte längre →
    -- behandla som redan borttagen, inte ett fel. OBS: ägarskapet för
    -- en REDAN BORTTAGEN post går inte att kontrollera (den finns inte
    -- att läsa) — detta grenar INNAN någon mutation sker, så det är
    -- säkert: ingenting skrivs, bara ett "redan klart"-svar returneras.
    v_result := jsonb_build_object('deleted', true, 'alreadyDeleted', true, 'serverSignature', NULL);
    INSERT INTO public.op_idempotency(fn_name, idem_key, result)
      VALUES ('time_entry_soft_delete', v_scoped_key, v_result || jsonb_build_object('_fp', v_fingerprint));
    RETURN v_result;
  END IF;

  v_entry := v_entries -> v_idx;

  -- FIX 1/2 (SÄKERHETSBLOCKER): ägarskapskontroll, atomiskt — samma
  -- mönster som time_entry_patch ovan.
  IF (v_entry ->> 'staffId') IS DISTINCT FROM p_caller_staff_id
     AND NOT p_caller_can_manage_others THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF (v_entry ->> 'attested')::boolean IS TRUE THEN
    RAISE EXCEPTION 'attested_locked';
  END IF;

  v_ao_id := v_entry ->> 'aoId';
  v_entries := v_entries - v_idx;
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
          'timeEntries', (
            SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
            FROM jsonb_array_elements_text(coalesce(v_ao -> 'timeEntries', '[]'::jsonb)) x
            WHERE x <> p_entry_id
          )
        );
        v_workorders := jsonb_set(v_workorders, array[v_ao_idx::text], v_ao);
        UPDATE public.store SET value = v_workorders, updated_at = v_now WHERE key = 'vift_workOrders';
      END IF;
    END IF;
  END IF;

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('deleted', true, 'alreadyDeleted', false, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('time_entry_soft_delete', v_scoped_key, v_result || jsonb_build_object('_fp', v_fingerprint));

  RETURN v_result;
END;
$function$;

-- ====================================================================
-- public.vift_caller_perms()
-- owner=postgres security_definer=True config=search_path=public, pg_temp
-- execute_grants: authenticated:EXECUTE,postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.vift_store_full_access(p_key text, p_perms text[])
-- owner=postgres security_definer=True config=search_path=public, pg_temp
-- execute_grants: authenticated:EXECUTE,postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.vift_store_project(p_key text, p_value jsonb, p_perms text[])
-- owner=postgres security_definer=True config=search_path=public, pg_temp
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.work_order_checklist_resolve(p_ao_id text, p_item_id text, p_avvikelse text, p_avvikelse_comment text, p_actor_name text, p_caller_can_view_all boolean, p_caller_staff_id text, p_avvikelse_image text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.work_order_checklist_resolve(p_ao_id text, p_item_id text, p_avvikelse text, p_avvikelse_comment text, p_actor_name text, p_caller_can_view_all boolean, p_caller_staff_id text, p_avvikelse_image text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_avvikelse is not null and p_avvikelse not in ('ok', 'avvikelse') then
    raise exception 'invalid_avvikelse';
  end if;
  return public.work_order_checklist_set_state(
    p_ao_id, p_item_id,
    case p_avvikelse when 'ok' then 'done' when 'avvikelse' then 'avvikelse' else 'reset' end,
    null, null, p_avvikelse_comment, p_avvikelse_image,
    p_actor_name, p_caller_staff_id, p_caller_can_view_all, false
  );
end;
$function$;

-- ====================================================================
-- public.work_order_checklist_set_state(p_ao_id text, p_item_id text, p_action text, p_text text, p_description text, p_comment text, p_image text, p_actor_name text, p_caller_staff_id text, p_caller_can_view_all boolean, p_caller_can_edit boolean)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.work_order_create(p_ao jsonb, p_idempotency_key text, p_client_id text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.work_order_log_append(p_ao_id text, p_entry jsonb, p_caller_staff_id text, p_caller_can_view_all boolean)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.work_order_log_remove(p_ao_id text, p_entry_id text, p_caller_staff_id text, p_caller_can_view_all boolean, p_caller_can_edit boolean)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.work_order_patch(p_ao_id text, p_patch jsonb, p_idempotency_key text, p_expected_updated_at text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
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

-- ====================================================================
-- public.work_order_permanent_delete(p_ao_id text, p_idempotency_key text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.work_order_permanent_delete(p_ao_id text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing   jsonb;
  v_workorders jsonb;
  v_idx        int;
  v_now        timestamptz := clock_timestamp();
  v_sig        text;
  v_result     jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'work_order_permanent_delete' AND idem_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT value INTO v_workorders FROM public.store WHERE key = 'vift_workOrders' FOR UPDATE;
  IF v_workorders IS NULL THEN
    v_result := jsonb_build_object('deleted', true, 'alreadyDeleted', true, 'serverSignature', NULL);
    INSERT INTO public.op_idempotency(fn_name, idem_key, result)
      VALUES ('work_order_permanent_delete', p_idempotency_key, v_result);
    RETURN v_result;
  END IF;

  SELECT (ord - 1) INTO v_idx
    FROM jsonb_array_elements(v_workorders) WITH ORDINALITY AS t(elem, ord)
    WHERE elem ->> 'id' = p_ao_id
    LIMIT 1;
  IF v_idx IS NULL THEN
    -- Idempotent mot upprepad permanent radering: redan borta → ok, no-op.
    v_result := jsonb_build_object('deleted', true, 'alreadyDeleted', true, 'serverSignature', NULL);
    INSERT INTO public.op_idempotency(fn_name, idem_key, result)
      VALUES ('work_order_permanent_delete', p_idempotency_key, v_result);
    RETURN v_result;
  END IF;

  v_workorders := v_workorders - v_idx;
  UPDATE public.store SET value = v_workorders, updated_at = v_now WHERE key = 'vift_workOrders';

  v_sig := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('deleted', true, 'alreadyDeleted', false, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('work_order_permanent_delete', p_idempotency_key, v_result);

  RETURN v_result;
END;
$function$;

-- ====================================================================
-- public.work_order_soft_delete(p_ao_id text, p_idempotency_key text)
-- owner=postgres security_definer=True config=search_path=public
-- execute_grants: postgres:EXECUTE,service_role:EXECUTE
CREATE OR REPLACE FUNCTION public.work_order_soft_delete(p_ao_id text, p_idempotency_key text)
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
    WHERE fn_name = 'work_order_soft_delete' AND idem_key = p_idempotency_key;
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
  -- Idempotent mot UPPREPAD radering (inte bara upprepat ANROP): en AO
  -- som redan är markerad borttagen ger samma lyckade svar, no-op mot
  -- store — en nätverks-retry på en redan lyckad radering ska ALDRIG
  -- kunna ge ett förvirrande "not_found" eller en onödig andra mutation.
  IF (v_ao ->> 'deleted')::boolean IS TRUE THEN
    v_result := jsonb_build_object('workOrder', v_ao, 'serverSignature', NULL, 'alreadyDeleted', true);
    INSERT INTO public.op_idempotency(fn_name, idem_key, result)
      VALUES ('work_order_soft_delete', p_idempotency_key, v_result);
    RETURN v_result;
  END IF;

  v_updated := v_ao || jsonb_build_object('deleted', true, 'deletedAt', v_now_text, 'updatedAt', v_now_text);
  v_workorders := jsonb_set(v_workorders, array[v_idx::text], v_updated);
  UPDATE public.store SET value = v_workorders, updated_at = v_now WHERE key = 'vift_workOrders';

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('workOrder', v_updated, 'serverSignature', v_sig, 'alreadyDeleted', false);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('work_order_soft_delete', p_idempotency_key, v_result);

  RETURN v_result;
END;
$function$;

