create or replace function public.work_order_log_append(
  p_ao_id text, p_entry jsonb, p_caller_staff_id text, p_caller_can_view_all boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
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
$$;

create or replace function public.work_order_log_remove(
  p_ao_id text, p_entry_id text, p_caller_staff_id text, p_caller_can_view_all boolean, p_caller_can_edit boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
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
$$;
revoke all on function public.work_order_log_append(text, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.work_order_log_remove(text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.work_order_log_append(text, jsonb, text, boolean) to service_role;
grant execute on function public.work_order_log_remove(text, text, text, boolean, boolean) to service_role;