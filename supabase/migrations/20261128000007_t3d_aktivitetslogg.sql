-- ============================================================
-- T3-D (2026-11-28): aktivitetsloggen — typer och referenser per behörighet (D-22, F11).
-- NY – EJ INSTALLERAD I STAGING.
--
-- activity_log_append får NY SIGNATUR (p_caller_staff_id, p_caller_perms); den gamla
-- 2-argumentsversionen tas bort. Allt kontrolleras i RPC:n, i samma transaktion som
-- skrivningen:
--   1. Identitet krävs (annars forbidden).
--   2. Händelsetypen måste vara tillåten för anroparens behörigheter
--      (_vift_activity_type_perms; 'all' får alla) → annars 'forbidden:type_not_allowed'
--      (EF: 403 {error:'forbidden', reason:'type_not_allowed'}, SEC-B4-05).
--   3. Varje referens (workOrderId, customerId, propertyId, offerId, invoiceId,
--      salesOpportunityId, inspectionId, ronderingId, deviationId) måste gå att se för
--      anroparen — samma urval som projektionen (_vift_post_refs, T3-B:s poolregel, Q3:
--      öppen pool ger ingen logg) → annars 'forbidden:ref_not_visible' (SEC-B4-06).
--      AO-raden läses under FOR SHARE, så att en samtidig omfördelning inte kan passera
--      kontrollen. Låsordning: vift_workOrders (FOR SHARE) → vift_activityLog (FOR UPDATE) →
--      vift_lastChanged, samma ordning som fakturavägarna (fakturor → AO → logg). Ingen väg
--      tar loggen före AO, så ingen cykel uppstår.
--   4. Servern sätter aktör (userId) och tid (timestamp) och märker posten
--      source='klientrapport' (D-22: klientrapporterat är inte revisionshistorik).
--   5. Append-only och idempotent på id som tidigare; listan kapas vid p_max.
--
-- Rollback: supabase/rollback/T3-D/rollback_t3d.sql (återställer STAGING-definitionen).
-- ============================================================
begin;

do $$
declare v text;
begin
  if to_regprocedure('public.activity_log_append(jsonb,integer,text,text[])') is not null then
    raise exception 'T3-D STOP: activity_log_append(4 argument) finns redan — T3-D är redan installerad; kör inte igen';
  end if;
  if to_regprocedure('public._vift_post_refs(text[],text)') is null then
    raise exception 'T3-D STOP: 20261128000006 måste installeras först';
  end if;
  v := md5(pg_get_functiondef('public.activity_log_append(jsonb,integer)'::regprocedure));
  if v not in ('1acc7a427e4ae312be2406bddff9b184') then
    raise exception 'T3-D STOP: activity_log_append avviker från verifierad STAGING-version (md5 %)', v;
  end if;
end $$;

/* Behörigheter (någon av) som får rapportera en händelsetyp (D-22). Speglas i
   supabase/functions/store-key-write/activity-log.ts (TYPE_PERMS); testet t3d jämför dem. */
create or replace function public._vift_activity_type_perms(p_type text)
returns text[] language sql immutable set search_path = public as $$
  select case
    when p_type in ('work_order_status','work_order_updated','work_order_assigned','material_added','material_removed',
                    'time_entry_created','note') then array['ao_view_own','ao_view_all']
    when p_type = 'work_order_created' then array['ao_create']
    when p_type in ('staff_assigned','work_order_archived','work_order_restored','work_order_deleted',
                    'work_order_permanent_delete') then array['ao_edit']
    when p_type in ('invoice_created','invoice_stale_override_approved') then array['invoice_create']
    when p_type in ('customer_created','customer_updated','customer_deleted','property_object_created',
                    'property_object_updated','property_object_deleted','contract_created','project_created') then array['customer_manage']
    when p_type in ('offer_created','offer_sent','offer_status') then array['offer_manage']
    when p_type in ('sales_opportunity_won','sales_opportunity_lost') then array['sales_manage']
    when p_type = 'recurring_order_created' then array['recurring_manage']
    when p_type in ('rondering_created','rondering_started','rondering_completed','point_ok','point_ej_aktuell',
                    'deviation_created','deviation_status','ao_from_deviation') then array['ao_view_all']
    else '{}'::text[]
  end
$$;

/* Får anroparen se den refererade posten? Hela registret (full åtkomst eller, för kunder och
   fastigheter, läsrätt till hela registret) eller posten finns i urvalet per uppdrag. */
create or replace function public._vift_ref_visible(p_field text, p_id text, p_perms text[], p_refs jsonb)
returns boolean language sql stable set search_path = public as $$
  select 'all' = any(coalesce(p_perms, '{}')) or case p_field
    when 'workOrderId' then public._vift_has(p_perms, 'ao_view_all') or coalesce(p_refs -> 'ao', '[]'::jsonb) ? p_id
    when 'customerId' then public._vift_kund_las(p_perms) or coalesce(p_refs -> 'customers', '[]'::jsonb) ? p_id
    when 'propertyId' then public._vift_kund_las(p_perms) or coalesce(p_refs -> 'properties', '[]'::jsonb) ? p_id
    when 'offerId' then coalesce(p_perms, '{}') && array['offer_manage','customer_manage','sales_manage','invoice_view','invoice_create',
                          'reports_view','ao_view_all','ao_edit','ao_create']
                        or coalesce(p_refs -> 'offers', '[]'::jsonb) ? p_id
    when 'invoiceId' then public.vift_store_full_access('vift_invoices', p_perms)
    when 'salesOpportunityId' then public.vift_store_full_access('vift_salesOpps', p_perms)
    when 'inspectionId' then public.vift_store_full_access('vift_inspections', p_perms)
    when 'ronderingId' then public.vift_store_full_access('vift_ronderingar', p_perms)
    when 'deviationId' then public.vift_store_full_access('vift_avvikelser', p_perms)
    else false
  end
$$;

drop function public.activity_log_append(jsonb, integer);
create function public.activity_log_append(p_entry jsonb, p_max integer, p_caller_staff_id text, p_caller_perms text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log jsonb;
  v_now timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  p text[] := coalesce(p_caller_perms, '{}');
  v_refs jsonb;
  v_f text;
  v_ref text;
  v_entry jsonb;
begin
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' or coalesce(p_entry->>'id', '') = '' then
    raise exception 'invalid_entry';
  end if;
  if coalesce(p_caller_staff_id, '') = '' then
    raise exception 'forbidden';
  end if;
  -- D-22: typen per behörighet.
  if not ('all' = any(p) or p && public._vift_activity_type_perms(coalesce(p_entry->>'type', ''))) then
    raise exception 'forbidden:type_not_allowed';
  end if;
  -- D-22: referenserna mot det anroparen får se, med AO-raden låst (FOR SHARE).
  perform 1 from public.store where key = 'vift_workOrders' for share;
  v_refs := public._vift_post_refs(p, p_caller_staff_id);
  foreach v_f in array array['workOrderId','customerId','propertyId','offerId','invoiceId','salesOpportunityId',
                             'inspectionId','ronderingId','deviationId'] loop
    v_ref := coalesce(p_entry ->> v_f, '');
    continue when v_ref = '';
    if not public._vift_ref_visible(v_f, v_ref, p, v_refs) then
      raise exception 'forbidden:ref_not_visible';
    end if;
  end loop;
  -- Servern sätter aktör och tid; posten är klientrapporterad (inte revisionshistorik).
  v_entry := p_entry || jsonb_build_object('userId', p_caller_staff_id, 'timestamp', v_now_text,
    'source', 'klientrapport', 'verifiedFields', jsonb_build_array('userId', 'timestamp'));

  insert into public.store(key, value) values ('vift_activityLog', '[]'::jsonb) on conflict (key) do nothing;
  select value into v_log from public.store where key = 'vift_activityLog' for update;
  if v_log is null or jsonb_typeof(v_log) <> 'array' then v_log := '[]'::jsonb; end if;
  if exists (select 1 from jsonb_array_elements(v_log) e where e->>'id' = v_entry->>'id') then
    return jsonb_build_object('ok', true, 'id', v_entry->>'id', 'duplicate', true);
  end if;
  v_log := jsonb_build_array(v_entry) || v_log;
  while jsonb_array_length(v_log) > greatest(coalesce(p_max, 500), 1) loop
    v_log := v_log - (jsonb_array_length(v_log) - 1);
  end loop;
  update public.store set value = v_log, updated_at = v_now where key = 'vift_activityLog';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('ok', true, 'id', v_entry->>'id', 'duplicate', false);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public._vift_activity_type_perms(text)', 'public._vift_ref_visible(text,text,text[],jsonb)',
    'public.activity_log_append(jsonb,integer,text,text[])']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
