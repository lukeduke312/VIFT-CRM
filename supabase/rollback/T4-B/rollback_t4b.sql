-- ============================================================
-- ROLLBACK T4-B (genererad av tests/local/t4b-rollback.js ur en lokal kedja utan
-- 20261128000011, dvs. läget efter T4-A + notisdelen).
-- Återställer de tio ersatta funktionerna EXAKT och tar bort T4-B:s nya funktioner
-- (work_order_material_*, time_entry_correct, _vift_t4b_*). Rör INGEN data: materialrader och
-- tidposter skrivna med den nya vägen ligger kvar och är giltiga för den äldre koden.
-- Ordning vid rollback: 1) föregående EF-versioner (ao-time-write, time-entries-list, invoice-write,
--   work-orders-list, _shared/vift-auth.ts) och föregående klientpaket, 2) denna fil, 3) notisdelens
--   rollback, 4) T4-A:s rollback, 5) vid behov T3-E-, T3-D-, T3-C- och T3-B-rollbacken (omvänd ordning).
-- ============================================================
begin;

-- 1. Ersatta funktioner (samma signatur) tillbaka till definitionen efter T4-A + notisdelen.
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
  -- T4-A notiser: notiserna är personliga. Ingen roll (inte heller 'all') får hela listan; direkt
  -- REST-läsning av vift_notifications ger inga rader och läsningen projiceras per mottagare.
  if p_key = 'vift_notifications' then return false; end if;
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

  -- T4-A notiser: bara anroparens egna notiser (userId = personal-id). Poster utan mottagarfält
  -- lämnas inte ut till någon (restriktivt; äldre data skrivs inte om).
  if p_key = 'vift_notifications' then
    return public._vift_notis_projicera(p_value, v_id);
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
  v_can_edit boolean; v_t4a jsonb;
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
    if public._vift_ao_billing_touched(v_ao, v_patch) then
      raise exception 'forbidden:invoice_path_required';
    end if;
    -- T4-A (B5, B1, SÄK-7): skyddade fält prövas på den låsta raden, efter behörighetskontrollen.
    -- Saknad portkod bevaras (v_ao || patch); saknat inköpspris i en befintlig materialrad återställs.
    v_t4a := public._vift_t4a_ao_patch(v_ao, v_patch, coalesce(p_caller_perms, '{}'));
    v_patch := v_t4a -> 'patch';
    select coalesce(array_agg(x), '{}') into v_ignored from jsonb_array_elements_text(v_t4a -> 'ignored') x;
    v_updated := v_ao || v_patch;
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
    if not public._vift_has(v_eff, 'ao_material') then raise exception 'forbidden'; end if;
    if not (public._vift_ao_assigned(v_ao, v_me) or public._vift_has(v_eff, 'ao_view_all')) then raise exception 'forbidden:not_assigned'; end if;
    if public._vift_ao_locked(v_ao) then raise exception 'ao_locked'; end if;
    if jsonb_typeof(v_patch -> 'materials') <> 'array' or jsonb_array_length(v_patch -> 'materials') > 500 then raise exception 'missing_fields'; end if;
    -- T4-A: fältet läser raderna utan inköpspris; det återställs innan raderna jämförs (D-19 delvis).
    v_t4a := public._vift_t4a_ao_patch(v_ao, v_patch, coalesce(p_caller_perms, '{}'));
    v_patch := v_t4a -> 'patch';
    select coalesce(array_agg(x), '{}') into v_ignored from jsonb_array_elements_text(v_t4a -> 'ignored') x;
    v_updated := v_ao || jsonb_build_object('materials', public._vift_ao_material_merge(v_ao -> 'materials', v_patch -> 'materials', v_me, v_now_text));

  elsif v_status = 'pågående' and v_keys <@ array['status'] then
    if not public._vift_has(v_eff, 'ao_start_own') then raise exception 'forbidden'; end if;
    if not public._vift_ao_assigned(v_ao, v_me) then raise exception 'forbidden:not_assigned'; end if;
    if public._vift_ao_locked(v_ao) then raise exception 'ao_locked'; end if;
    if coalesce(v_ao ->> 'status', '') not in ('nytt', 'planerad', 'pool') then raise exception 'invalid_source_status'; end if;
    v_updated := v_ao || jsonb_build_object('status', 'pågående', 'startedAt', coalesce(nullif(v_ao ->> 'startedAt', ''), v_now_text),
                                            'startedBy', coalesce(nullif(v_ao ->> 'startedBy', ''), v_me));

  elsif v_status = 'klar' and v_keys <@ array['status', 'completedAt', 'completedBy'] then
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
  select array['ao_plan_own','time_view_all','objects_access_assigned','rondering_utfor','export_data','export_personal_data']
$function$;
revoke all on function public._vift_ej_verkstallda() from public, anon, authenticated, service_role;
grant execute on function public._vift_ej_verkstallda() to service_role;

-- time_entry_create(jsonb,text,text,text,uuid,text[])
CREATE OR REPLACE FUNCTION public.time_entry_create(p_entry jsonb, p_idempotency_key text, p_client_id text, p_caller_staff_id text, p_caller_auth_id uuid, p_caller_perms text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;
revoke all on function public.time_entry_create(jsonb,text,text,text,uuid,text[]) from public, anon, authenticated, service_role;
grant execute on function public.time_entry_create(jsonb,text,text,text,uuid,text[]) to service_role;

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
revoke all on function public.time_entry_patch(text,jsonb,text,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.time_entry_patch(text,jsonb,text,text,text,boolean) to service_role;

-- time_entry_soft_delete(text,text,text,boolean)
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
revoke all on function public.time_entry_soft_delete(text,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.time_entry_soft_delete(text,text,text,boolean) to service_role;

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
revoke all on function public.store_write_stamp_status(uuid,boolean,bigint,text,bigint) from public, anon, authenticated, service_role;
grant execute on function public.store_write_stamp_status(uuid,boolean,bigint,text,bigint) to service_role;

-- invoice_append_checked(jsonb,text)
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
revoke all on function public.invoice_append_checked(jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.invoice_append_checked(jsonb,text) to service_role;

-- invoice_set_status(text,text,bigint,text)
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
revoke all on function public.invoice_set_status(text,text,bigint,text) from public, anon, authenticated, service_role;
grant execute on function public.invoice_set_status(text,text,bigint,text) to service_role;

-- 2. T4-B:s nya funktioner bort (efter att inget längre anropar dem).
drop function if exists public.work_order_material_add(text,jsonb,text,text,text[]);
drop function if exists public.work_order_material_update(text,text,jsonb,text,text,text,text[]);
drop function if exists public.work_order_material_remove(text,text,text,text,text,text[]);
drop function if exists public.time_entry_correct(text,jsonb,text,text,text,text,text[]);
drop function if exists public._vift_t4b_rad_kontroll(jsonb,jsonb,text[],text,jsonb);
drop function if exists public._vift_t4b_material_lista(jsonb,jsonb,text[],text,text,jsonb);
drop function if exists public._vift_t4b_ny_rad(jsonb,jsonb,text[],text,text,text);
drop function if exists public._vift_t4b_faktura_pris_kontroll(jsonb);
drop function if exists public._vift_t4b_faktura_kallor(jsonb,jsonb,jsonb,jsonb);
drop function if exists public._vift_t4b_kallrad(text,jsonb,jsonb);
drop function if exists public._vift_t4b_rad_kant(jsonb,text,text);
drop function if exists public._vift_t4b_anspraak(jsonb);
drop function if exists public._vift_t4b_kalla_status(jsonb,text);
drop function if exists public._vift_t4b_pris(text,text,jsonb);
drop function if exists public._vift_t4b_lage(jsonb);
drop function if exists public._vift_t4b_tid_last(jsonb);
drop function if exists public._vift_t4b_datum_ok(text);
drop function if exists public._vift_t4b_idag();
drop function if exists public._vift_t4b_tal(jsonb);
drop function if exists public._vift_t4b_kontor(text[]);
drop function if exists public._vift_t4b_tillagg_satta(text[]);
drop function if exists public._vift_t4b_inkop_satta(text[]);
drop function if exists public._vift_t4b_pris_satta(text[]);
drop function if exists public._vift_t4b_pris_las(text[]);

commit;
