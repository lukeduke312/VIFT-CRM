-- =====================================================================
-- VIFT CRM — Serverstyrd aktivitetslogg (2026-11-24)
-- FÖRBEREDD I REPOT — EJ KÖRD. Kräver separat GO (STAGING först).
-- Installeras tillsammans med store-key-write (action appendActivity,
-- vift_activityLog append-only). Migrationen först, därefter EF:en.
--
-- Atomisk prepend av EN post i vift_activityLog under radlås, idempotent
-- på id (omsändning = ingen dubblett), kapad till p_max (standard 500).
-- Posten byggs och valideras av EF:en (typ, längder, userId och tid från
-- verifierad JWT) — se supabase/functions/store-key-write/activity-log.ts.
-- Ändrar inga befintliga poster.
-- Rollback: drop function public.activity_log_append(jsonb, int);
--           deploya föregående store-key-write.
-- =====================================================================
create or replace function public.activity_log_append(p_entry jsonb, p_max int default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;
revoke all on function public.activity_log_append(jsonb, int) from public, anon, authenticated;
grant execute on function public.activity_log_append(jsonb, int) to service_role;
