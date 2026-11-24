-- QA 2026-11-24 (fynd QA-P1-4): kundens offertsvar syntes inte för personalen.
--
-- Klienternas DataSync hämtar om data bara när vift_lastChanged ändrats.
-- offer_respond_commit (kundens godkännande/nekande/ändringsbegäran),
-- offer_token_open_commit, offer_events_append, offer_email_prepare_commit och
-- invoice_stale_override_approve_commit skriver affärsdata UTAN att uppdatera
-- vift_lastChanged — ändringen nådde inte inloggade klienter förrän någon
-- annan skrivning råkade uppdatera signaturen (verifierat i STAGING,
-- affärsflöde F6.11b: godkänd på servern, "utkast" i arbetsledarens klient
-- efter 60 s).
--
-- Rättning: en AFTER-trigger på public.store som, för exakt nycklarna
-- vift_offers, vift_offerEvents och vift_invoices, sätter vift_lastChanged.
-- Funktioner som redan sätter egen signatur gör det EFTER sin affärsskrivning
-- i samma transaktion, så deras värde (serverSignature till klienten) vinner.
-- Ingen rekursion: triggern körs inte för vift_lastChanged.
--
-- Återställning: DROP TRIGGER store_bump_lastchanged ON public.store;
--                DROP FUNCTION public._store_bump_lastchanged();

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
