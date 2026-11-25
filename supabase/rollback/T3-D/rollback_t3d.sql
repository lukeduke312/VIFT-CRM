-- ============================================================
-- ROLLBACK T3-D (genererad av tests/local/t3d-rollback.js ur en lokal kedja utan T3-D,
-- dvs. läget efter T3-C; activity_log_append(jsonb,integer) = STAGING-facit).
-- Återställer de funktioner som T3-D ersatte EXAKT till T3-C-versionen, återskapar den gamla
-- signaturen för activity_log_append och tar bort T3-D:s nya hjälpfunktioner.
-- Rör INGEN data (store, app_users, property_sensitive_access). Körs i en transaktion.
-- Ordning vid rollback: 1) store-key-write och invoice-write till T3-C-versionerna (EF-backup),
--   2) denna fil, 3) föregående klientpaket, 4) vid behov T3-C- och T3-B-rollbacken (omvänd ordning).
-- ============================================================
begin;

-- 1. activity_log_append: den nya signaturen bort, STAGING-signaturen tillbaka (exakt text).
drop function if exists public.activity_log_append(jsonb,integer,text,text[]);
-- activity_log_append(jsonb,integer)
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
revoke all on function public.activity_log_append(jsonb,integer) from public, anon, authenticated, service_role;
grant execute on function public.activity_log_append(jsonb,integer) to service_role;

-- 2. Ersatta funktioner (samma signatur) tillbaka till T3-C-definitionen.
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
    -- T3-C (D-21, D-14): hela personal- och rollregistret bara för den som hanterar dem.
    -- Övriga får en projektion via store-key-write (vift_store_project); REST döljer raden.
    when 'vift_staff'             then p && array['staff_manage','admin_manage']
    when 'vift_roles'             then false
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
  offer_stub text[] := array['id','title','status','customerId','propertyId','workOrderId','projectId','versionNumber',
                             'createdAt','updatedAt','deleted','archived'];
  v_own_role text;
begin
  if p_value is null then return null; end if;
  if public.vift_store_full_access(p_key, p) then return p_value; end if;

  -- T3-C (D-14, D-21, SEC-B3-03): personalregistret. Den egna posten oförändrad; andras
  -- 'permissions' bort, och andras 'role' bort utan staff_view. ÖVERGÅNG: utan identitet
  -- (äldre store-key-write) tas bara 'permissions' bort (klienten läser aldrig fältet).
  if p_key = 'vift_staff' and is_arr then
    return coalesce((
      select jsonb_agg(case
        when jsonb_typeof(e) <> 'object' then e
        when p_caller_staff_id is null then e - 'permissions'
        when e ->> 'id' = p_caller_staff_id then e
        when 'staff_view' = any(p) then e - 'permissions'
        else e - array['permissions', 'role'] end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
  end if;

  -- T3-C (D-21, SEC-B3-05): rollregistret. Bara den egna effektiva rollen; med
  -- staff_manage även de roller anroparen får tilldela (utan 'all', inom egna
  -- behörigheter). ÖVERGÅNG: utan identitet (äldre store-key-write) oförändrat.
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
    -- Övriga (fältpersonal, begränsad): bara identitet och status, inga belopp.
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

  -- Nycklar som rollen inte ska se alls: tomt värde av samma form.
  return case jsonb_typeof(p_value) when 'array' then '[]'::jsonb when 'object' then '{}'::jsonb else null end;
end;
$function$;
revoke all on function public.vift_store_project(text,jsonb,text[],text) from public, anon, authenticated, service_role;
grant execute on function public.vift_store_project(text,jsonb,text[],text) to service_role;

-- 3. T3-D:s nya hjälpfunktioner bort (efter att inget längre anropar dem).
drop function if exists public._vift_ref_visible(text,text,text[],jsonb);
drop function if exists public._vift_activity_type_perms(text);
drop function if exists public._vift_post_refs(text[],text);
drop function if exists public._vift_kund_las(text[]);
drop function if exists public._vift_staff_external(text[]);
drop function if exists public._vift_task_ao(jsonb);
drop function if exists public._vift_activity_ao_type(text);
drop function if exists public._vift_ao_content_visible(jsonb,text[],text);
drop function if exists public._vift_ao_visible(jsonb,text[],text);

commit;
