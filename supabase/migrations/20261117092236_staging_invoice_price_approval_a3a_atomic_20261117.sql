-- ============================================================
-- ÅTERSTÄLLD 2026-11-27 ur STAGING:s migrationshistorik (G1/G4 del 2).
-- Källa: supabase_migrations.schema_migrations, version 20261117092236, i STAGING
-- (yyzljlqyzzcbxmcdbual). Allt efter markören INNEHÅLL nedan, fram till
-- den avslutande raden ";", är EXAKT array_to_string(statements, E';\n')
-- (md5 cb2ea2d23074235c2d329dc6fa9ed0f5, samma fil som
-- inventering/staging-2026-11-26/migrations-applicerade/20261117092236_staging_invoice_price_approval_a3a_atomic_20261117.sql).
-- Supabase CLI sparar statements utan avslutande semikolon; ett ";" har
-- därför lagts till sist. Ingen annan ändring.
-- ============================================================
-- INNEHÅLL
-- Combined P1-1 + A3a STAGING CANDIDATE, constructed from the
-- ACTUALLY deployed invoice_set_status SQL (md5 b86aab346d6339c5959c3d76f192635e) and the
-- reviewed P1-1 reference RPC. NO DEPLOY. A real two-connection concurrency
-- test against PostgreSQL is still required before any LIVE consideration.
begin;
do $$ begin
 if md5(pg_get_functiondef('public.invoice_set_status(text,text,bigint,text)'::regprocedure)) <> 'b86aab346d6339c5959c3d76f192635e' then
    raise exception 'P1/A3a STOP: invoice_set_status drift from verified STAGING';
 end if;
 if to_regprocedure('public.invoice_stale_override_approve_commit(text,int,jsonb)') is not null then
    raise exception 'P1/A3a STOP: override RPC already exists; inspect first';
 end if;
end $$;
-- The snapshot is recalculated INSIDE the DB transaction, never from
-- a browser-provided flag. It mirrors staleDiscrepancySnapshot() for the
-- fixed-price first sourceRefs entry of each invoice line.
create or replace function public._invoice_fixed_stale_snapshot(p_invoice jsonb,p_workorders jsonb)
returns jsonb language plpgsql immutable set search_path=public as $helper$
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
$helper$;
revoke all on function public._invoice_fixed_stale_snapshot(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public._invoice_fixed_stale_snapshot(jsonb,jsonb) to service_role;

create or replace function public.invoice_stale_override_approve_commit(
  p_invoice_id        text,
  p_expected_revision int,
  p_entry             jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;
alter function public.invoice_stale_override_approve_commit(text,int,jsonb) owner to postgres;
revoke all on function public.invoice_stale_override_approve_commit(text,int,jsonb) from public,anon,authenticated;
grant execute on function public.invoice_stale_override_approve_commit(text,int,jsonb) to service_role;
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

notify pgrst,'reload schema';
commit;

;
