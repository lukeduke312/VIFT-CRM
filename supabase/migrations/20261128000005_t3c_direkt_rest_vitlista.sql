-- ============================================================
-- T3-C (2026-11-28): direkt REST-skrivning till public.store bara för en uttrycklig
-- vitlista (F18 / SÄK-13). NY – EJ INSTALLERAD I STAGING.
--
-- Inventering av klientens direkta REST-skrivningar (VIFT-CRM, både nuvarande klient och
-- v3.4 i STAGING, se docs/qa-2026-11-28/T3-RESULTAT.md, T3-C):
--   - persistNotifs() → Storage.setRemoteStrict([['notifications', …], ['lastChanged', now]])
--     = POST /rest/v1/store med Prefer: resolution=merge-duplicates (upsert av två rader).
--   - Storage.set / Storage.setAll / Storage.remove: definierade men anropas inte.
--   - Alla affärsnycklar går via Edge Functions (store-key-write, ao-time-write,
--     invoice-write m.fl.); push_subscriptions och bildtabellen är andra tabeller.
--
-- Vitlista (authenticated):
--   vift_notifications  INSERT/UPDATE. Innehållsskyddet finns redan i triggern
--                       protect_notifications_and_legacy_keys (befintliga notiser får
--                       bara ändra 'read', ingen radering). Saknar EF-väg; klienten
--                       behöver den (notiser till kollegor, lästmarkering).
--   vift_lastChanged    INSERT/UPDATE, men VÄRDET SÄTTS AV SERVERN (klockan i databasen).
--                       Klientens värde sparas aldrig: ingen data kan smugglas in och
--                       signalen kan inte vridas bakåt. Behövs för att v3.4 och nuvarande
--                       klient skickar raden i samma upsert som notiserna; utan den skulle
--                       hela notisskrivningen nekas. Tas bort när persistNotifs har en
--                       EF-väg (se "Beslut som behövs" i T3-RESULTAT.md).
--   DELETE              ingen nyckel.
-- Allt annat från authenticated/anon nekas med 42501 'direct_write_blocked'.
--
-- Två lager:
--   1. RLS (RESTRICTIVE, authenticated): INSERT och UPDATE kräver att nyckeln står på
--      vitlistan (WITH CHECK). UPDATE har USING (true) så att en otillåten uppdatering ger
--      ett uttryckligt fel i stället för "0 rader" (rader som befintliga RESTRICTIVE-
--      policyer redan döljer, t.ex. affärsnycklarna, ger fortfarande 0 rader).
--   2. Trigger protect_direct_write_allowlist (BEFORE INSERT/UPDATE/DELETE): samma vitlista
--      för authenticated och anon, inga nyckelbyten, DELETE alltid nekad, och servern
--      sätter vift_lastChanged. SECURITY DEFINER-RPC:er (current_user postgres) och
--      service_role (Edge Functions) berörs inte.
--
-- Rollback: supabase/rollback/T3-C/rollback_t3c.sql (tar bort policyerna, triggern och
-- funktionen; rör ingen data).
-- ============================================================
begin;

do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'protect_direct_write_allowlist' and tgrelid = 'public.store'::regclass) then
    raise exception 'T3-C STOP: triggern protect_direct_write_allowlist finns redan — kör inte igen';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'store'
             and policyname in ('store_direct_write_allowlist_insert', 'store_direct_write_allowlist_update')) then
    raise exception 'T3-C STOP: vitlistepolicyerna finns redan — kör inte igen';
  end if;
  if to_regprocedure('public._vift_authz_check(text,jsonb,jsonb,jsonb,jsonb,text)') is null then
    raise exception 'T3-C STOP: 20261128000004 (roller och superadmin) är inte installerad — installera den först';
  end if;
end $$;

create or replace function public._store_direct_write_guard()
returns trigger language plpgsql set search_path = public as $$
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
$$;
revoke all on function public._store_direct_write_guard() from public, anon, authenticated;
grant execute on function public._store_direct_write_guard() to service_role;

create trigger protect_direct_write_allowlist
  before insert or update or delete on public.store
  for each row execute function public._store_direct_write_guard();

create policy "store_direct_write_allowlist_insert" on public.store as restrictive for insert to authenticated
  with check ((key = ANY (ARRAY['vift_notifications'::text, 'vift_lastChanged'::text])));

create policy "store_direct_write_allowlist_update" on public.store as restrictive for update to authenticated
  using (true)
  with check ((key = ANY (ARRAY['vift_notifications'::text, 'vift_lastChanged'::text])));

commit;
