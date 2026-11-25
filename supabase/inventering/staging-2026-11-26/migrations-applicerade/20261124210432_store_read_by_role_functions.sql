create or replace function public.vift_caller_perms()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
$$;

create or replace function public.vift_store_full_access(p_key text, p_perms text[])
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
$$;

create or replace function public.vift_store_project(p_key text, p_value jsonb, p_perms text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
$$;

create or replace function public.store_read_all_with_hashes_projected(p_business_keys text[], p_perms text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
$$;

revoke all on function public.vift_store_project(text, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.store_read_all_with_hashes_projected(text[], text[]) from public, anon, authenticated;
grant execute on function public.vift_store_project(text, jsonb, text[]) to service_role;
grant execute on function public.store_read_all_with_hashes_projected(text[], text[]) to service_role;
revoke all on function public.vift_caller_perms() from public, anon;
revoke all on function public.vift_store_full_access(text, text[]) from public, anon;
grant execute on function public.vift_caller_perms() to authenticated, service_role;
grant execute on function public.vift_store_full_access(text, text[]) to authenticated, service_role;