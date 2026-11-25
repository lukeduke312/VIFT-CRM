-- ============================================================
-- ÅTERSTÄLLD 2026-11-27 ur STAGING:s migrationshistorik (G1/G4 del 2).
-- Källa: supabase_migrations.schema_migrations, version 20261120103824, i STAGING
-- (yyzljlqyzzcbxmcdbual). Allt efter markören INNEHÅLL nedan, fram till
-- den avslutande raden ";", är EXAKT array_to_string(statements, E';\n')
-- (md5 412a2f9022a31453b1f24ea4397a1236, samma fil som
-- inventering/staging-2026-11-26/migrations-applicerade/20261120103824_vift_crm12_offer_token_open_commit_v1_20261120.sql).
-- Supabase CLI sparar statements utan avslutande semikolon; ett ";" har
-- därför lagts till sist. Ingen annan ändring.
-- ============================================================
-- INNEHÅLL
-- FÖRSLAG v1, EJ INSTALLERAT. Del av VIFT CRM 12-leveransen (offer-respond +
-- offer-token-validate + send-offer-email). Fristående migration -- beror
-- INTE på offer_respond_commit eller på op_idempotency; kan installeras
-- oberoende av de andra två funktionernas rättningar.
--
-- BUGGEN (bekräftad direkt mot den verkliga, checksumverifierade STAGING-filen
-- supabase/functions/offer-token-validate/index.ts, "Leverans E, Del E2, v4",
-- rad 101-142):
--   1. Ett OLÅST `select` av HELA vift_offers-arrayen (rad 102-110).
--   2. tokenRevokedAt/tokenExpiresAt kontrolleras mot den olåsta kopian
--      (rad 118-128) -- inget skydd mot att token återkallas/löper ut
--      MEDAN detta anrop körs.
--   3. openCount/openedAt/updatedAt muteras i minnet (rad 131-137).
--   4. Ett villkorslöst `upsert` skriver HELA arrayen tillbaka (rad 140-142)
--      -- samma "sista skrivaren vinner"-mönster som redan rättats i
--      offer_respond_commit, men här på VARJE publik sidvisning av en
--      offert (inte bara vid kundens slutgiltiga beslut) -- en
--      HÖGFREKVENT variant av samma dataförluststrisk.
--   5. `upsert`-anropets `error`-resultat läses ALDRIG (rad 140-142: inget
--      `{ error }` destruktureras, inget kontrolleras) -- ett misslyckat
--      skriv (t.ex. RLS, nätverk) upptäcks aldrig; svaret skickas till
--      kunden som om statistiken sparats, även om den inte gjorde det.
--
-- LÖSNINGEN: en ny, additiv SECURITY DEFINER-funktion
-- public.offer_token_open_commit(p_token) som gör HELA
-- läs-lås-validera-ändra-skriv-cykeln atomiskt, exakt samma disciplin som
-- redan etablerad i offer_respond_commit (se offer_respond_fix_v3):
--   - Radlås (`for update`) TAGET FÖRE all affärsvalidering.
--   - `v_now` sätts EFTER låset (inte som DECLARE-initierare -- samma
--     tidigare identifierade fallgrop, undviks medvetet här).
--   - revoked/expired omkontrolleras mot den nu LÅSTA, aktuella raden --
--     en strikt starkare garanti än dagens kod, som aldrig omkontrollerar
--     efter en eventuell väntan.
--   - Skrivfel kan inte längre tystas: UPDATE sker i samma transaktion som
--     låset, och en riktig DB-exception propagerar automatiskt till EF:n.
--
-- Ingen idempotens/request-ID behövs här -- detta är en läsning med
-- sidoeffekt vid första öppning, inte ett kundbeslut som kan skickas om
-- via nätverksretry på samma sätt som offer-respond.

begin;

do $$
begin
  if to_regprocedure('public.offer_token_open_commit(text)') is not null then
    raise exception 'OFFER_TOKEN_OPEN_COMMIT STOP: funktionen finns redan; granska innan den ersätts';
  end if;
end $$;

create function public.offer_token_open_commit(
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_offers        jsonb;
  v_idx           int;
  v_off           jsonb;
  v_now           timestamptz;  -- EFTER låset, se motivering ovan -- ingen initierare här.
  v_now_text      text;
  v_is_first_open boolean;
  v_open_count    bigint;
begin
  -- Billig, ren indatavalidering FÖRE låset (samma stil som v3:s
  -- pre-lock-kontroller för kontroller som inte beror på radens innehåll).
  if p_token is null or length(p_token) < 32 then
    raise exception 'invalid_token';
  end if;

  -- Radlås INNAN något läses för validering -- oförändrat mönster från
  -- offer_respond_commit.
  select value into v_offers from public.store where key = 'vift_offers' for update;

  v_now      := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  if v_offers is null or jsonb_typeof(v_offers) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1)::int into v_idx
    from jsonb_array_elements(v_offers) with ordinality as t(elem, ord)
    where elem ->> 'publicToken' = p_token
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;
  v_off := v_offers -> v_idx;

  -- Omkontrollerat mot den LÅSTA, aktuella raden -- inte den olåsta kopian
  -- som dagens kod läser. Detta fångar en återkallning/utgång som skett
  -- medan detta anrop väntade på låset (bevisas separat i regressionstestet).
  if coalesce(v_off ->> 'tokenRevokedAt', '') <> '' then
    raise exception 'revoked';
  end if;
  if coalesce(v_off ->> 'tokenExpiresAt', '') <> '' then
    if (v_off ->> 'tokenExpiresAt')::timestamptz < v_now then
      raise exception 'expired:%', (v_off ->> 'tokenExpiresAt');
    end if;
  end if;

  -- Öppningsstatistik -- samma semantik som dagens kod (rad 131-137 i den
  -- verkliga EF-filen): openCount inkrementeras alltid, openedAt sätts
  -- bara vid FÖRSTA öppningen (saknas eller är tom sträng).
  v_is_first_open := (coalesce(v_off ->> 'openedAt', '') = '');
  v_open_count     := coalesce((v_off ->> 'openCount')::bigint, 0) + 1;

  v_off := v_off || jsonb_build_object(
    'openCount', v_open_count,
    'updatedAt', v_now_text
  );
  if v_is_first_open then
    v_off := v_off || jsonb_build_object('openedAt', v_now_text);
  end if;

  v_offers := jsonb_set(v_offers, array[v_idx::text], v_off);
  update public.store set value = v_offers, updated_at = v_now where key = 'vift_offers';
  -- Inget separat felkontroll-steg behövs: om UPDATE av någon anledning
  -- misslyckas (t.ex. en constraint) kastar Postgres självt en exception
  -- här och HELA transaktionen (inklusive den redan gjorda mutationen i
  -- minnet) rullas tillbaka -- till skillnad från dagens kod, som aldrig
  -- läser `upsert`-anropets `error` och därför kan svara "OK" till kunden
  -- trots ett tyst misslyckat skriv.

  return jsonb_build_object(
    'offer',       v_off,
    'isFirstOpen', v_is_first_open
  );
end;
$function$;

alter function public.offer_token_open_commit(text) owner to postgres;
revoke all on function public.offer_token_open_commit(text) from public, anon, authenticated;
grant execute on function public.offer_token_open_commit(text) to service_role;

commit;

;
