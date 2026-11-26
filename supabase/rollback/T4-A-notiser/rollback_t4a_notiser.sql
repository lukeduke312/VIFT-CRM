-- ============================================================
-- ROLLBACK T4-A, tilläggsdel NOTISER (genererad av tests/local/t4a-notiser-rollback.js ur en lokal
-- kedja utan 20261128000010, dvs. läget efter T4-A).
-- Återställer vift_store_full_access, vift_store_project, _store_direct_write_guard och T3-C:s
-- vitlistepolicyer EXAKT och tar bort notification_append, notifications_mark_read och
-- hjälpfunktionerna. Rör INGEN data (notiser skapade efter installationen ligger kvar).
-- Ordning vid rollback: 1) T4-B:s rollback (om installerad), 2) föregående store-key-write
--   (utan appendNotification) och föregående klientpaket (persistNotifs via REST), 3) denna fil,
--   4) T4-A:s rollback, 5) vid behov T3-E-, T3-D-, T3-C- och T3-B-rollbacken (omvänd ordning).
-- ============================================================
begin;

-- 1. Ersatta funktioner (samma signatur) tillbaka till definitionen efter T4-A.
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
  -- T4-A (punkt 7): utan giltig behörighet (tom, okänd eller inaktiverad roll) inga verksamhetsdata.
  if not public._vift_t4a_giltig(p) then return false; end if;
  -- T4-A (T3-D 6): hela aktivitetsloggen kräver activity_log_view_all (övergångsregel för äldre roller).
  if p_key = 'vift_activityLog' then return public._vift_t4a_logg_full(p); end if;
  -- T4-A (SÄK-7, B5, C-5 regel 1 ersatt): hela värdet, även för SKRIVARE, bara om alla skyddade
  -- fält i nyckeln får läsas. Övriga får projektionen (vift_store_project).
  if not public._vift_t4a_alla_lasbara(p_key, p) then return false; end if;
  -- T4-A (punkt 7, åtkomst per post): återkommande ärenden, projekt, inspektioner och avvikelser
  -- i sin helhet bara för de roller som läser kundregistret; övriga får urval per uppdrag.
  if p_key in ('vift_recurringOrders','vift_projects','vift_inspections','vift_avvikelser') then
    return public._vift_kund_las(p);
  end if;
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
    when 'vift_customers'         then (p && kund) and (p && array['objects_sensitive'])
    when 'vift_propertyObjects'   then p && array['objects_sensitive']
    when 'vift_staff'             then p && array['staff_manage','admin_manage']
    when 'vift_roles'             then false
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
  offer_ref text[] := array['id','title','status','workOrderId'];
  sens text[] := array['doorCode','keyInformation','accessInformation','keyReceipt','alarmInformation','accessCode','keyInfo'];
  staff_fields text[] := array['id','firstName','lastName','name','title','active','color','initials'];
  v_id text := nullif(coalesce(p_caller_staff_id, ''), '');
  v_own_role text;
  v_refs jsonb;
  v_ext boolean;
  v_ids jsonb;
  v_p2 text[];
begin
  if p_value is null then return null; end if;
  if public.vift_store_full_access(p_key, p) then return p_value; end if;

  -- T4-A (punkt 7): tom, okänd eller inaktiverad roll (inga giltiga behörigheter): inga
  -- verksamhetsdata. Den egna personalposten och den egna rollen behövs för inloggningen.
  if not public._vift_t4a_giltig(p) and p_key not in ('vift_staff', 'vift_roles') then
    return case jsonb_typeof(p_value) when 'array' then '[]'::jsonb when 'object' then '{}'::jsonb else null end;
  end if;

  -- Personalregistret (D-14, D-21). T4-A: arbetskontakt till kollegor kräver staff_contacts_view
  -- (övergångsregel: T3-E:s härledning för roller utan T4:s nya behörigheter).
  if p_key = 'vift_staff' and is_arr then
    if v_id is null then
      return coalesce((
        select jsonb_agg(case when jsonb_typeof(e) <> 'object' then e else
          (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(e) z(k, v)
           where k = any(staff_fields || array['role','email','phone'])) end order by o)
        from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
    end if;
    v_ext := not public._vift_t4a_kontakt(p);
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

  -- T3-C (D-21): rollregistret. Oförändrat.
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
    if v_id is null then return '[]'::jsonb; end if;
    v_refs := public._vift_post_refs(p, v_id);
    return coalesce((
      select jsonb_agg((select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(e) z(k, v) where k = any(offer_ref)) order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (v_refs -> 'offers') ? coalesce(e ->> 'id', '')), '[]'::jsonb);
  end if;

  -- T4-A (D-17, D-01, SEC-INST-01/02, SEC-B2-06): bankgiro för interna roller (och bankgiro_edit),
  -- intern timkostnad bara med cost_view — även för skrivaren admin_manage.
  if p_key = 'vift_settings' and jsonb_typeof(p_value) = 'object' then
    return public._vift_t4a_projicera_elem(p_key, p_value, p);
  end if;

  -- T4-A (D-01, SEC-B1-09/12): artiklarnas inköpspris och påslag bara med cost_view.
  if p_key = 'vift_articles' and is_arr then
    return coalesce((select jsonb_agg(public._vift_t4a_projicera_elem(p_key, e, p) order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
  end if;

  -- T3-D (D-13) + T4-A (SÄK-7, D-13, K-02): kunder, fastigheter, objekt och kontakter. Portkoder
  -- och nyckelinformation bara med objects_sensitive, personnummer och privatpersoners org.nr bara
  -- med personal_data_view — även för skrivaren customer_manage. Urval per uppdrag (fält) som T3-D,
  -- där portkoder aldrig ingår.
  if p_key in ('vift_customers','vift_properties','vift_propertyObjects','vift_propertyContacts') and is_arr then
    if not public._vift_kund_las(p) then
      if v_id is null then return '[]'::jsonb; end if;
      v_refs := public._vift_post_refs(p, v_id);
    end if;
    return coalesce((
      select jsonb_agg(case when v_refs is null then public._vift_t4a_projicera_elem(p_key, e, p)
                            else public._vift_t4a_projicera_elem(p_key, e, p) - sens end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (v_refs is null or case p_key
        when 'vift_customers' then (v_refs -> 'customers') ? coalesce(e ->> 'id', '')
        when 'vift_properties' then (v_refs -> 'properties') ? coalesce(e ->> 'id', '')
        when 'vift_propertyObjects' then (v_refs -> 'objects') ? coalesce(e ->> 'id', '')
        else (v_refs -> 'properties') ? coalesce(e ->> 'propertyId', '')
             and (coalesce(e ->> 'objectId', '') = '' or (v_refs -> 'objects') ? (e ->> 'objectId')) end)), '[]'::jsonb);
  end if;

  -- T4-A (punkt 7, åtkomst per post): återkommande ärenden, projekt, avvikelser och inspektioner.
  -- Kundregistrets läsare: alla (återkommande utan portkod om objects_sensitive saknas). Övriga:
  -- bara poster som hör till AO som anroparen ser med innehåll. Inspektioner har ingen AO-koppling.
  if p_key in ('vift_recurringOrders','vift_projects','vift_avvikelser','vift_inspections') and is_arr then
    if public._vift_kund_las(p) then
      return coalesce((select jsonb_agg(public._vift_t4a_projicera_elem(p_key, e, p) order by o)
        from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
    end if;
    if v_id is null or p_key = 'vift_inspections' then return '[]'::jsonb; end if;
    if p_key = 'vift_avvikelser' then
      v_ids := public._vift_t4a_ao_ref(p, v_id, 'id');
      return coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(p_value) with ordinality x(e, o)
        where jsonb_typeof(e) = 'object' and v_ids ? coalesce(e ->> 'workOrderId', '')), '[]'::jsonb);
    end if;
    v_ids := public._vift_t4a_ao_ref(p, v_id, case p_key when 'vift_recurringOrders' then 'recurringOrderId' else 'projectId' end);
    return coalesce((select jsonb_agg(public._vift_t4a_projicera_elem(p_key, e, p) - sens order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and v_ids ? coalesce(e ->> 'id', '')), '[]'::jsonb);
  end if;

  -- T3-D (B4, Q3) + T4-A (T3-D 6): aktivitetsloggen utan activity_log_view_all = AO-händelser för
  -- AO som anroparen ser med innehåll; med ao_view_all men utan activity_log_view_all (ny roll)
  -- bara AO där anroparen är tilldelad. Inga poster med offert-, faktura- eller säljreferens.
  if p_key = 'vift_activityLog' and is_arr then
    if v_id is null then return '[]'::jsonb; end if;
    v_p2 := case when 'ao_view_all' = any(p) then array_remove(p, 'ao_view_all') || array['ao_view_own'] else p end;
    v_refs := public._vift_post_refs(v_p2, v_id);
    return coalesce((
      select jsonb_agg(e order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and public._vift_activity_ao_type(e ->> 'type')
        and (v_refs -> 'ao') ? coalesce(e ->> 'workOrderId', '')
        and coalesce(e ->> 'offerId', '') = '' and coalesce(e ->> 'invoiceId', '') = ''
        and coalesce(e ->> 'salesOpportunityId', '') = ''), '[]'::jsonb);
  end if;

  -- T3-D (D-15): uppgifter. Oförändrat.
  if p_key = 'vift_activities' and is_arr then
    if v_id is null then return '[]'::jsonb; end if;
    v_refs := case when p && array['ao_view_own','ao_view_all'] then public._vift_post_refs(array['ao_view_own'], v_id) else '{"ao":[]}'::jsonb end;
    return coalesce((
      select jsonb_agg(e order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (coalesce(e ->> 'createdBy', '') = v_id or coalesce(e ->> 'assignedTo', '') = v_id
            or (v_refs -> 'ao') ? coalesce(public._vift_task_ao(e), ''))), '[]'::jsonb);
  end if;

  return case jsonb_typeof(p_value) when 'array' then '[]'::jsonb when 'object' then '{}'::jsonb else null end;
end;
$function$;
revoke all on function public.vift_store_project(text,jsonb,text[],text) from public, anon, authenticated, service_role;
grant execute on function public.vift_store_project(text,jsonb,text[],text) to service_role;

-- _store_direct_write_guard()
CREATE OR REPLACE FUNCTION public._store_direct_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- RPC:er (SECURITY DEFINER, ägare postgres) och Edge Functions (service_role) berörs inte.
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'direct_write_blocked' using errcode = '42501',
      detail = 'Direkt REST-radering av store är inte tillåten (nyckel ' || coalesce(old.key, '') || ').';
  end if;
  if tg_op = 'UPDATE' and new.key is distinct from old.key then
    raise exception 'direct_write_blocked' using errcode = '42501', detail = 'Nyckelbyte är inte tillåtet.';
  end if;
  if new.key = 'vift_notifications' then
    return new;
  end if;
  if new.key = 'vift_lastChanged' then
    new.value := to_jsonb(to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    new.updated_at := now();
    return new;
  end if;
  raise exception 'direct_write_blocked' using errcode = '42501',
    detail = 'Nyckeln ' || coalesce(new.key, '') || ' står inte på vitlistan för direkt REST-skrivning (F18).';
end;
$function$;
revoke all on function public._store_direct_write_guard() from public, anon, authenticated, service_role;
grant execute on function public._store_direct_write_guard() to service_role;

-- 2. T3-C:s vitlista för direkt REST-skrivning tillbaka (vift_notifications, vift_lastChanged).
alter policy "store_direct_write_allowlist_insert" on public.store with check ((key = ANY (ARRAY['vift_notifications'::text, 'vift_lastChanged'::text])));
alter policy "store_direct_write_allowlist_update" on public.store using (true) with check ((key = ANY (ARRAY['vift_notifications'::text, 'vift_lastChanged'::text])));

-- 3. Tilläggsdelens nya funktioner bort (efter att inget längre anropar dem).
drop function if exists public.notification_append(text,jsonb,text,integer);
drop function if exists public.notifications_mark_read(text,jsonb,boolean);
drop function if exists public._vift_notis_projicera(jsonb,text);
drop function if exists public._vift_notis_kategori(text);

commit;
