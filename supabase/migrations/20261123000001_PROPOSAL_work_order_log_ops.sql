-- =====================================================================
-- PROPOSAL (G5) — INTE KÖRD NÅGONSTANS. Kräver granskning mot den
-- driftsatta work_order_patch/ao-time-write (källa saknas i repot, G4)
-- och separat GO innan den körs i STAGING.
--
-- Syfte: lägga till / ta bort EN loggpost i en arbetsorder atomiskt,
-- i stället för att klienten skickar hela log-arrayen (patch_ao), så att
-- två enheter som skriver samtidigt inte skriver över varandra.
--
-- Antaganden (måste stämmas av mot STAGING innan körning):
--   * Arbetsordrar lagras som en JSON-array i public.store, key
--     'vift_workOrders' (samma som work_order_patch arbetar mot).
--   * Behörighet (ao_view_*, ao_edit/ao_checklist/…) kontrolleras i
--     Edge Function ao-time-write INNAN RPC:n anropas — RPC:n är
--     SECURITY DEFINER och får bara anropas av service_role.
--   * Idempotens: en post med samma id läggs aldrig till två gånger;
--     en borttagning av en post som redan saknas är ett lyckat no-op.
-- =====================================================================

create or replace function public.work_order_log_append(
  p_ao_id  text,
  p_entry  jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_arr   jsonb;
  v_idx   int;
  v_ao    jsonb;
  v_log   jsonb;
  v_now   text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_ao_id is null or p_entry is null or coalesce(p_entry->>'id', '') = '' then
    raise exception 'missing_fields' using errcode = '22023';
  end if;

  select value into v_arr from store where key = 'vift_workOrders' for update;
  if v_arr is null then raise exception 'not_found' using errcode = 'P0002'; end if;

  select (ord - 1)::int into v_idx
    from jsonb_array_elements(v_arr) with ordinality as t(el, ord)
   where el->>'id' = p_ao_id
   limit 1;
  if v_idx is null then raise exception 'not_found' using errcode = 'P0002'; end if;

  v_ao  := v_arr->v_idx;
  v_log := coalesce(v_ao->'log', '[]'::jsonb);

  -- Idempotens: finns posten redan görs ingenting.
  if exists (select 1 from jsonb_array_elements(v_log) e where e->>'id' = p_entry->>'id') then
    return v_ao;
  end if;

  v_ao  := jsonb_set(v_ao, '{log}', v_log || jsonb_build_array(p_entry));
  v_ao  := jsonb_set(v_ao, '{updatedAt}', to_jsonb(v_now));
  v_arr := jsonb_set(v_arr, array[v_idx::text], v_ao);

  update store set value = v_arr, updated_at = now() where key = 'vift_workOrders';
  -- Samma signal som övriga skrivvägar använder för klienternas pollning.
  insert into store(key, value, updated_at) values ('vift_lastChanged', to_jsonb(v_now), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_ao;
end;
$$;

create or replace function public.work_order_log_remove(
  p_ao_id    text,
  p_entry_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_arr jsonb;
  v_idx int;
  v_ao  jsonb;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_ao_id is null or coalesce(p_entry_id, '') = '' then
    raise exception 'missing_fields' using errcode = '22023';
  end if;
  select value into v_arr from store where key = 'vift_workOrders' for update;
  if v_arr is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  select (ord - 1)::int into v_idx
    from jsonb_array_elements(v_arr) with ordinality as t(el, ord)
   where el->>'id' = p_ao_id limit 1;
  if v_idx is null then raise exception 'not_found' using errcode = 'P0002'; end if;

  v_ao := v_arr->v_idx;
  v_ao := jsonb_set(v_ao, '{log}', coalesce((
            select jsonb_agg(e order by ord)
              from jsonb_array_elements(coalesce(v_ao->'log', '[]'::jsonb)) with ordinality as l(e, ord)
             where e->>'id' is distinct from p_entry_id), '[]'::jsonb));
  v_ao  := jsonb_set(v_ao, '{updatedAt}', to_jsonb(v_now));
  v_arr := jsonb_set(v_arr, array[v_idx::text], v_ao);
  update store set value = v_arr, updated_at = now() where key = 'vift_workOrders';
  insert into store(key, value, updated_at) values ('vift_lastChanged', to_jsonb(v_now), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_ao;
end;
$$;

revoke all on function public.work_order_log_append(text, jsonb) from public, anon, authenticated;
revoke all on function public.work_order_log_remove(text, text) from public, anon, authenticated;
grant execute on function public.work_order_log_append(text, jsonb) to service_role;
grant execute on function public.work_order_log_remove(text, text) to service_role;
