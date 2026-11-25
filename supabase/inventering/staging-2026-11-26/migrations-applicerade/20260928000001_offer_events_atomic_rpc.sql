-- ============================================================
-- Migration: Atomisk RPC för vift_offerEvents append
-- Datum:     2026-09-28 (OFFER COMMUNICATION R2.3 — Data-Integrity Hardening)
-- Syfte:     Eliminera det verifierade "läs hela vift_offerEvents-arrayen,
--            lägg till en händelse i minnet, skriv HELA arrayen tillbaka"-
--            racet i supabase/functions/send-offer-email/index.ts.
--
--            Reproducerat mot den faktiska levererade Edge Function:en:
--            två SAMTIDIGA sändningar för TVÅ OLIKA offerter (alltså
--            garanterat inga konkurrerande Idempotency-Key-krockar hos
--            Resend — båda skickas verkligen) körde ändå båda
--            READ -> ändra -> WRITE mot SAMMA store-rad (key=
--            'vift_offerEvents'). Den som skrev SIST vann och tystade
--            radera den andra sändningens redan-persisterade händelse.
--            Detta bryter kravet att server-kommunikationshistoriken är
--            auktoritativ.
--
--            Detta är EXAKT samma problemklass som redan lösts NARROWLY
--            för vift_projectDocuments (20260908000001) och
--            vift_workOrders/checklistan (20260917000001) — samma
--            arkitekturmönster återanvänds rakt av, tillämpat på
--            vift_offerEvents:
--              1. `SELECT ... FOR UPDATE` på EXAKT store-raden med key=
--                 'vift_offerEvents', inom EN transaktion (ett RPC-anrop
--                 = en transaktion). Postgres radlås serialiserar
--                 automatiskt konkurrerande anrop — den andra transaktionen
--                 blockerar tills den första committat, och läser DÅ det
--                 redan uppdaterade värdet. Ingen förlorad händelse är
--                 möjlig genom denna funktion, oavsett hur många samtidiga
--                 Edge Function-anrop som körs (två olika offerter, eller
--                 t.o.m. concurrent-suppression-fallet för samma offert).
--              2. Deduplicering INUTI den låsta transaktionen (inte i
--                 Edge Function-minnet, som i sig var en del av racet):
--                 en händelse med samma `id` SKA aldrig läggas till två
--                 gånger, och för ett lyckat utskick (status='sent') SKA
--                 samma leverantörs-messageId aldrig heller skapa en andra
--                 post (en idempotent Resend-retur av samma mejl).
--              3. Kvarhållningspolicyn (max 10 000 poster, äldst bort
--                 först) bevaras oförändrad, nu utförd atomiskt.
--              4. SECURITY DEFINER + explicit REVOKE/GRANT: endast
--                 `service_role` (send-offer-email, den enda skrivvägen)
--                 kan anropa funktionen.
--
--            `store`-tabellens faktiska schema (verifierat i
--            20260720000000_create_core_tables.sql, inte antaget):
--              key        text        PRIMARY KEY
--              value      jsonb       NOT NULL DEFAULT 'null'::jsonb
--              updated_at timestamptz DEFAULT now()
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.offer_events_append(jsonb);
-- ============================================================

create or replace function public.offer_events_append(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_arr        jsonb;
  v_event_id   text := p_event ->> 'id';
  v_status     text := p_event ->> 'status';
  v_message_id text := p_event ->> 'messageId';
  v_existing   jsonb;
  v_max_keep   constant int := 10000;
  v_len        int;
begin
  if v_event_id is null or v_event_id = '' then
    raise exception 'invalid_event: missing id';
  end if;

  /* Säkerställ att raden existerar INNAN vi låser den — SELECT ... FOR
     UPDATE på en rad som inte finns låser ingenting. */
  insert into public.store(key, value) values ('vift_offerEvents', '[]'::jsonb)
    on conflict (key) do nothing;

  /* Radlåsning — EXAKT den mekanism som redan är etablerad i
     20260908000001/20260917000001 för samma problemklass. Alla samtidiga
     anrop (oavsett vilken offert de gäller — nyckeln är delad) serialiseras
     här; den som får låset andra läser garanterat den FÖRSTA transaktionens
     redan committade resultat, inte en stale kopia. */
  select value into v_arr from public.store where key = 'vift_offerEvents' for update;
  if v_arr is null or jsonb_typeof(v_arr) <> 'array' then
    v_arr := '[]'::jsonb;
  end if;

  /* Deduplicering INUTI den låsta transaktionen — flyttad hit från Edge
     Function-minnet, som i sig var racet (två samtidiga anrop kunde båda
     se "ingen dubblett" i sina respektive, redan föråldrade kopior). */
  select elem into v_existing
    from jsonb_array_elements(v_arr) as elem
    where (elem ->> 'id') = v_event_id
       or (
            v_status = 'sent' and v_message_id is not null and v_message_id <> ''
            and (elem ->> 'messageId') = v_message_id
            and (elem ->> 'status') = 'sent'
          )
    limit 1;

  if v_existing is not null then
    /* Redan persisterad (idempotent Resend-retur av samma mejl, eller ett
       dubbelt om-försök av samma händelse) — returnera den BEFINTLIGA
       posten oförändrad, skapa ALDRIG en andra historikpost. */
    return v_existing;
  end if;

  v_arr := v_arr || jsonb_build_array(p_event);

  v_len := jsonb_array_length(v_arr);
  if v_len > v_max_keep then
    /* Behåll bara de v_max_keep SENASTE, i ORIGINALORDNING (samma
       kvarhållningspolicy som tidigare — splice bort äldst — nu utförd
       atomiskt inom låset). */
    select jsonb_agg(elem order by ord) into v_arr
      from (
        select elem, ord
        from jsonb_array_elements(v_arr) with ordinality as t(elem, ord)
        where ord > (v_len - v_max_keep)
      ) sub;
  end if;

  update public.store set value = v_arr, updated_at = now() where key = 'vift_offerEvents';
  return p_event;
end;
$$;
-- ── Behörigheter: ENDAST service_role (samma princip som befintliga
--    atomiska RPC:er för vift_projectDocuments/vift_workOrders) ──
revoke all on function public.offer_events_append(jsonb) from public, anon, authenticated;
grant execute on function public.offer_events_append(jsonb) to service_role;
-- ── Verifiering (körs manuellt efter migrering) ─────────────────────
-- SELECT proname, proacl FROM pg_proc WHERE proname = 'offer_events_append';
-- Förväntat: EXECUTE endast beviljat till service_role.