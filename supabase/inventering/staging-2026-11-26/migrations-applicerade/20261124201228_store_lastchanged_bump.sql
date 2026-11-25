create or replace function public._store_bump_lastchanged()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.store(key, value)
  values ('vift_lastChanged',
          to_jsonb(to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return null;
end;
$$;

revoke all on function public._store_bump_lastchanged() from public, anon, authenticated;

drop trigger if exists store_bump_lastchanged on public.store;
create trigger store_bump_lastchanged
  after insert or update on public.store
  for each row
  when (new.key in ('vift_offers', 'vift_offerEvents', 'vift_invoices'))
  execute function public._store_bump_lastchanged();