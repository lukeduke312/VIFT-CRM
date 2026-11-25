-- ============================================================
-- ÅTERSTÄLLD 2026-11-27 ur STAGING:s migrationshistorik (G1/G4 del 2).
-- Källa: supabase_migrations.schema_migrations, version 20261120103829, i STAGING
-- (yyzljlqyzzcbxmcdbual). Allt efter markören INNEHÅLL nedan, fram till
-- den avslutande raden ";", är EXAKT array_to_string(statements, E';\n')
-- (md5 fef049716410ecba43d854ad02b9f860, samma fil som
-- inventering/staging-2026-11-26/migrations-applicerade/20261120103829_vift_crm12_offer_email_prepare_commit_v3_20261120.sql).
-- Supabase CLI sparar statements utan avslutande semikolon; ett ";" har
-- därför lagts till sist. Ingen annan ändring.
-- ============================================================
-- INNEHÅLL
-- FÖRSLAG v3, EJ INSTALLERAT. Supersederar v2
-- (send_offer_email_fix_v2/002_offer_email_prepare_commit_v2.sql). Del av
-- VIFT CRM 12-leveransen.
--
-- v3 (denna version, 2026-11-20, avgränsad uppföljningsfråga): v2:s EF-fil
-- läser offertens versionsnummer (`resolvedVersion`) EN gång, OLÅST, FÖRE
-- detta RPC-anrop -- för idempotenskontrollen och för det fält som
-- faktiskt sparas i händelseloggen (`emailEvent.offerVersion`). Om
-- offertens versionsnummer hinner ändras MELLAN den läsningen och detta
-- RPC-anrops lås, byggde/skickade RPC:n ett snapshot av DEN NYA versionen,
-- medan händelseloggen skulle registrera DEN GAMLA -- en tyst
-- felkoppling mellan vad som faktiskt skickades och vad som bokfördes.
-- RÄTTNING (enbart denna, inget annat ändrat i funktionen): returvärdet
-- innehåller nu även `offerVersion` -- det FAKTISKA versionsnumret från
-- den LÅSTA raden som detta anrop verkligen agerade på. EF:en (v3 av den
-- filen) jämför detta mot sin egen, tidigare lästa `resolvedVersion` och
-- avbryter EXPLICIT (ny felkod `offer_version_changed`, 409) om de
-- skiljer sig -- istället för att tyst fortsätta med en bokförd version
-- som inte stämmer med vad som verkligen förbereddes/skickades.
--
-- FYND 2 (pgcrypto-schema, BEKRÄFTAT AV GRANSKAREN OCH NU ÄVEN AV
-- GRANSKARENS EGEN KONTROLL MOT BÅDE STAGING OCH LIVE: pgcrypto 1.3 i
-- schemat `extensions` i båda miljöerna -- ingen ytterligare kontroll
-- behövs):
-- v1 körde `set search_path = public` och anropade `gen_random_bytes(32)`
-- oskalifierat. STAGING och LIVE har pgcrypto installerat i
-- schemat `extensions` (Supabase:s egen, vanliga standardplacering för
-- extensions -- INTE `public`), vilket skulle göra v1:s anrop till
-- `gen_random_bytes` till ett runtime-fel ("function gen_random_bytes(integer)
-- does not exist") första gången Fall C (ny token) faktiskt körs i den
-- miljön. RÄTTNING: `set search_path = public, extensions, pg_temp` --
-- samma mönster Supabase självt rekommenderar för SECURITY DEFINER-
-- funktioner som behöver en extension-funktion, oavsett om extensionen
-- råkar ligga i `public` eller `extensions` (fungerar i båda fallen,
-- eftersom endast EN av de två skarpen faktiskt innehåller funktionen).
--
-- FYND 4 (kvarstående bilage-/kundnamnsrisk): v1 lät EF:en läsa kundnamn
-- OCH publika bilage-ID:n INNAN RPC:n tog sitt lås på vift_offers --
-- en verklig felkopplingsrisk om offertens customerId hinner ändras, eller
-- en bilaga hinner läggas till/tas bort/ändra synlighet, mellan EF:ens
-- tidiga läsning och RPC:ns lås. v1 lämnade dessutom lockOfferAttachments()
-- kvar som en EGEN, olåst whole-array-upsert av vift_offerAttachments i
-- EF:en -- samma klass av race som redan rättats för vift_offers, bara på
-- en annan nyckel.
--
-- FYND 2 (pgcrypto-schema, BEKRÄFTAT AV GRANSKAREN -- EJ sj=lvständigt
-- verifierat av mig mot en verklig databas, se LÄS_FÖRST-rapporten):
-- v1 körde `set search_path = public` och anropade `gen_random_bytes(32)`
-- oskalifierat. Enligt granskaren har STAGING redan pgcrypto installerat i
-- schemat `extensions` (Supabase:s egen, vanliga standardplacering för
-- extensions -- INTE `public`), vilket skulle göra v1:s anrop till
-- `gen_random_bytes` till ett runtime-fel ("function gen_random_bytes(integer)
-- does not exist") första gången Fall C (ny token) faktiskt körs i den
-- miljön. RÄTTNING: `set search_path = public, extensions, pg_temp` --
-- samma mönster Supabase självt rekommenderar för SECURITY DEFINER-
-- funktioner som behöver en extension-funktion, oavsett om extensionen
-- råkar ligga i `public` eller `extensions` (fungerar i båda fallen,
-- eftersom endast EN av de två skarpen faktiskt innehåller funktionen).
--
-- FYND 4 (kvarstående bilage-/kundnamnsrisk): v1 lät EF:en läsa kundnamn
-- OCH publika bilage-ID:n INNAN RPC:n tog sitt lås på vift_offers --
-- en verklig felkopplingsrisk om offertens customerId hinner ändras, eller
-- en bilaga hinner läggas till/tas bort/ändra synlighet, mellan EF:ens
-- tidiga läsning och RPC:ns lås. v1 lämnade dessutom lockOfferAttachments()
-- kvar som en EGEN, olåst whole-array-upsert av vift_offerAttachments i
-- EF:en -- samma klass av race som redan rättats för vift_offers, bara på
-- en annan nyckel.
--
-- RÄTTNING: funktionen tar nu SJÄLV, i EN konsekvent ordning
-- (vift_offers FÖRE vift_offerAttachments, ALLTID i den ordningen, oavsett
-- vilken gren koden nedan sedan tar), radlås på BÅDA nycklarna INNAN något
-- beslut fattas. customerId härleds från den nu LÅSTA offert-raden (inte
-- från en tidigare EF-läsning); kundnamnet slås upp mot vift_customers
-- EFTER det att customerId är känt ur den låsta raden (vift_customers
-- självt låses INTE -- inget i denna kodbas har visats skriva-låsa kund-
-- poster samtidigt med en offert, så det är utanför omfånget att införa
-- ett nytt låsmönster där utan anledning; den enda verifierade
-- felkopplingsrisken var ATT CUSTOMERID LÄSTS FÖRE OFFERT-LÅSET, inte
-- SJÄLVA kundposten). publicAttachmentIds beräknas mot den nu LÅSTA
-- vift_offerAttachments-raden. Bilagelåsningen (sätta lockedInVersion på
-- ännu olåsta, aktiva bilagor för offerten) görs HÄR, atomiskt, i samma
-- transaktion som vift_offers-skrivningen -- EF:ens egen lockOfferAttachments()
-- tas bort helt, inte bara skyddas.
--
-- Signaturen ändras: p_customer_name och p_locked_attachment_ids (v1:s
-- indataparametrar, beräknade av EF:en FÖRE låset) är BORTA -- funktionen
-- behöver bara p_offer_id, eftersom den nu härleder allt själv EFTER sina
-- egna lås.

begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regprocedure('public.offer_email_prepare_commit(text,text,jsonb)') is not null
     or to_regprocedure('public.offer_email_prepare_commit(text)') is not null then
    raise exception 'OFFER_EMAIL_PREPARE_COMMIT STOP: funktionen finns redan (v1/v2/v3); granska innan den ersätts';
  end if;
end $$;

create function public.offer_email_prepare_commit(
  p_offer_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  v_offers                jsonb;
  v_idx                   int;
  v_off                   jsonb;
  -- v_now FÅR INTE ha en DECLARE-initierare -- samma motivering som i
  -- offer_respond_commit (v2/v3/v4/v5): evalueras annars FÖRE de
  -- blockerande `for update`-raderna.
  v_now                   timestamptz;
  v_now_text              text;
  v_has_token             boolean;
  v_snap                  jsonb;
  v_has_valid_snapshot    boolean;
  v_created               boolean;
  v_token                 text;
  v_token_created_text    text;
  v_token_expires_text    text;
  v_open_count            int;
  v_opened_at             text;
  v_updated_at_text       text;
  v_snapshot_text         text;
  v_locked_in_version     text;
  v_lines                 jsonb;
  v_extras                jsonb;
  v_date_text             text;
  v_customer_id           text;
  v_customer              jsonb;
  v_customer_name         text;
  v_first_name            text;
  v_last_name             text;
  v_full_name             text;
  v_customer_type         text;
  v_atts                  jsonb;
  v_public_attachment_ids jsonb;
  v_attachment_patches    jsonb := '[]'::jsonb;
begin
  if p_offer_id is null or btrim(p_offer_id) = '' then
    raise exception 'offer_not_found';
  end if;

  -- ===== KONSEKVENT LÅSORDNING (NYTT I v2): vift_offers FÖRE
  -- vift_offerAttachments, ALLTID i denna ordning -- oavsett vilken gren
  -- koden nedan sedan tar. Båda låsen tas INNAN något beslut (A/B/C)
  -- fattas, av exakt samma skäl som ledde till hela denna rättning: ett
  -- beslut fattat mot olåst data är inaktuellt redan när det fattas. =====
  select value into v_offers from public.store where key = 'vift_offers' for update;

  v_now      := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  if v_offers is null or jsonb_typeof(v_offers) <> 'array' then
    raise exception 'offer_not_found';
  end if;

  select (ord - 1)::int into v_idx
    from jsonb_array_elements(v_offers) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_offer_id
    limit 1;
  if v_idx is null then
    raise exception 'offer_not_found';
  end if;
  v_off := v_offers -> v_idx;

  -- Andra låset, i SAMMA, alltid identiska ordning.
  select value into v_atts from public.store where key = 'vift_offerAttachments' for update;
  if v_atts is null or jsonb_typeof(v_atts) <> 'array' then
    v_atts := '[]'::jsonb;
  end if;

  -- ===== customerId härleds NU från den LÅSTA, aktuella offert-raden
  -- (NYTT I v2 -- v1 tog emot ett EF-beräknat p_customer_name som kunde
  -- vara baserat på en ANNAN, äldre customerId om offerten hunnit
  -- omtilldelas mellan EF:ens tidiga läsning och detta lås). vift_customers
  -- självt låses inte (se filhuvudets motivering), bara läst EFTER att
  -- customerId är känt ur den redan låsta offert-raden. ===== --
  v_customer_id := v_off ->> 'customerId';
  v_customer := null;
  if v_customer_id is not null and v_customer_id <> '' then
    select cust into v_customer
      from public.store s, jsonb_array_elements(coalesce(s.value, '[]'::jsonb)) as cust
      where s.key = 'vift_customers'
        and cust ->> 'id' = v_customer_id
      limit 1;
  end if;

  -- ===== displayCustomerName(), omskrivet i SQL ===== --
  v_first_name    := coalesce(v_customer ->> 'firstName', '');
  v_last_name     := coalesce(v_customer ->> 'lastName', '');
  v_full_name     := btrim(v_first_name || ' ' || v_last_name);
  v_customer_type := coalesce(v_customer ->> 'type', '');
  if v_customer_type = 'privat' then
    v_customer_name := case when v_full_name <> '' then v_full_name else coalesce(v_customer ->> 'name', '') end;
  else
    v_customer_name := case when coalesce(v_customer ->> 'name', '') <> '' then v_customer ->> 'name' else v_full_name end;
  end if;

  -- ===== publicAttachmentIds, beräknat mot den NU LÅSTA
  -- vift_offerAttachments-raden (NYTT I v2 -- v1 tog emot detta som ett
  -- EF-beräknat, pre-lås indata). Samma filter som buildLockedSnapshot()
  -- alltid använde. ===== --
  select coalesce(jsonb_agg(a ->> 'id'), '[]'::jsonb) into v_public_attachment_ids
    from jsonb_array_elements(v_atts) as a
    where (a ->> 'offerId') = p_offer_id
      and coalesce(a ->> 'active', 'true') <> 'false'
      and coalesce(a ->> 'includeInPublicView', 'false') = 'true';

  -- ===== isTokenActive(), omskrivet mot den LÅSTA, aktuella raden ===== --
  v_has_token := coalesce(v_off ->> 'publicToken', '') <> '';
  if v_has_token and coalesce(v_off ->> 'tokenRevokedAt', '') <> '' then
    v_has_token := false;
  end if;
  if v_has_token and coalesce(v_off ->> 'tokenExpiresAt', '') <> '' then
    begin
      if (v_off ->> 'tokenExpiresAt')::timestamptz < v_now then
        v_has_token := false;
      end if;
    exception when others then
      v_has_token := false;
    end;
  end if;

  -- ===== parseSnapshot() + isValidSnapshot(), omskrivet ===== --
  v_snap := null;
  if v_has_token and coalesce(v_off ->> 'lockedSnapshotJSON', '') <> '' then
    begin
      v_snap := (v_off ->> 'lockedSnapshotJSON')::jsonb;
    exception when others then
      v_snap := null;
    end;
  end if;
  v_has_valid_snapshot :=
    v_snap is not null
    and coalesce(v_snap ->> 'id', '') = p_offer_id
    and jsonb_typeof(v_snap -> 'lines') = 'array'
    and jsonb_typeof(v_snap -> 'extras') = 'array'
    and jsonb_typeof(v_snap -> 'publicAttachmentIds') = 'array';

  if v_has_token and v_has_valid_snapshot then
    -- ====== Fall A: aktiv token + giltigt snapshot -- INGEN skrivning ====== --
    v_created            := false;
    v_token               := v_off ->> 'publicToken';
    v_token_created_text  := coalesce(v_off ->> 'tokenCreatedAt', v_now_text);
    v_token_expires_text  := coalesce(v_off ->> 'tokenExpiresAt', '');
    v_open_count          := coalesce((v_off ->> 'openCount')::int, 0);
    v_opened_at           := coalesce(v_off ->> 'openedAt', '');
    v_updated_at_text     := coalesce(v_off ->> 'updatedAt', v_now_text);
    v_snapshot_text       := v_off ->> 'lockedSnapshotJSON';

  else
    -- ====== Fall B eller C: en skrivning krävs -- bygg nytt snapshot ====== --
    v_created := true;

    if v_has_token then
      -- Fall B: behåll befintlig token/utgångstid oförändrad.
      v_token              := v_off ->> 'publicToken';
      v_token_created_text := coalesce(v_off ->> 'tokenCreatedAt', v_now_text);
      v_token_expires_text := coalesce(v_off ->> 'tokenExpiresAt', '');
      v_open_count         := coalesce((v_off ->> 'openCount')::int, 0);
      v_opened_at          := coalesce(v_off ->> 'openedAt', '');
    else
      -- Fall C: nytt, kryptografiskt säkert 32-byte hex-token.
      v_token              := encode(gen_random_bytes(32), 'hex');
      v_token_created_text := v_now_text;
      v_token_expires_text := to_char(
        (v_now + interval '30 days') at time zone 'utc', 'YYYY-MM-DD'
      ) || 'T23:59:59.000Z';
      v_open_count         := 0;
      v_opened_at          := '';
    end if;

    -- ===== buildLockedSnapshot(), omskrivet mot den LÅSTA, aktuella raden ===== --
    v_lines := coalesce(
      (select jsonb_agg(
         (select jsonb_object_agg(kv.k, kv.v) from jsonb_each(elem) as kv(k, v)
            where kv.k in ('id','type','description','templateName','qty','unit',
                           'unitPrice','discount','total','vatRate','exVat','rutAmount',
                           'subLines','text'))
       ) from jsonb_array_elements(coalesce(v_off -> 'lines', '[]'::jsonb)) as elem),
      '[]'::jsonb
    );
    v_extras := coalesce(
      (select jsonb_agg(
         (select jsonb_object_agg(kv.k, kv.v) from jsonb_each(elem) as kv(k, v)
            where kv.k in ('id','description','qty','unit','unitPrice'))
       ) from jsonb_array_elements(coalesce(v_off -> 'extras', '[]'::jsonb)) as elem),
      '[]'::jsonb
    );

    v_date_text := coalesce(
      v_off ->> 'date',
      left(coalesce(v_off ->> 'createdAt', v_now_text), 10)
    );

    v_snapshot_text := (jsonb_build_object(
      'id',                 v_off -> 'id',
      'title',              v_off -> 'title',
      'versionNumber',      v_off -> 'versionNumber',
      'lines',              v_lines,
      'extras',             v_extras,
      'discount',           v_off -> 'discount',
      'taxType',            v_off -> 'taxType',
      'rotRutAmount',       v_off -> 'rotRutAmount',
      'date',               v_date_text,
      'validUntil',         v_off -> 'validUntil',
      'paymentTerms',       v_off -> 'paymentTerms',
      'validityText',       v_off -> 'validityText',
      'terms',              v_off -> 'terms',
      'includes',           v_off -> 'includes',
      'excludes',           v_off -> 'excludes',
      'scope',              v_off -> 'scope',
      'summary',            v_off -> 'summary',
      'generalTerms',       v_off -> 'generalTerms',
      'address',            v_off -> 'address',
      'customerName',       coalesce(v_customer_name, ''),
      'publicAttachmentIds', v_public_attachment_ids
    ))::text;

    if v_has_token then
      -- Fall B: patcha bara lockedSnapshotJSON + updatedAt -- allt annat oförändrat.
      v_off := v_off || jsonb_build_object(
        'lockedSnapshotJSON', v_snapshot_text,
        'updatedAt',          v_now_text
      );
    else
      -- Fall C: full ersättning av tokenfälten.
      v_off := v_off || jsonb_build_object(
        'publicToken',        v_token,
        'tokenCreatedAt',     v_token_created_text,
        'tokenExpiresAt',     v_token_expires_text,
        'tokenRevokedAt',     '',
        'openCount',          0,
        'openedAt',           '',
        'lockedSnapshotJSON', v_snapshot_text,
        'updatedAt',          v_now_text
      );
    end if;

    v_updated_at_text := v_now_text;

    v_offers := jsonb_set(v_offers, array[v_idx::text], v_off);
    update public.store set value = v_offers, updated_at = v_now where key = 'vift_offers';
  end if;

  v_locked_in_version := p_offer_id || '-' || substring(v_token from 1 for 8);

  -- ===== Bilagelåsning -- FLYTTAD IN hit (NYTT I v2). Lås ENDAST ännu
  -- olåsta, aktiva bilagor för DENNA offert, och ENDAST när vi faktiskt
  -- skapade/uppdaterade ett snapshot (v_created) -- exakt samma Fall
  -- A/B/C-gräns originalkoden alltid haft (Fall A låser aldrig bilagor).
  -- Görs atomiskt i samma transaktion/lås som vift_offers-skrivningen
  -- ovan -- EF:ens egen, tidigare olåsta lockOfferAttachments() behövs
  -- inte längre alls. ===== --
  if v_created then
    select coalesce(jsonb_agg(jsonb_build_object('id', a ->> 'id', 'lockedInVersion', v_locked_in_version)), '[]'::jsonb)
      into v_attachment_patches
      from jsonb_array_elements(v_atts) as a
      where (a ->> 'offerId') = p_offer_id
        and coalesce(a ->> 'active', 'true') <> 'false'
        and coalesce(a ->> 'lockedInVersion', '') = '';

    if jsonb_array_length(v_attachment_patches) > 0 then
      select jsonb_agg(
        case
          when (a ->> 'offerId') = p_offer_id
               and coalesce(a ->> 'active', 'true') <> 'false'
               and coalesce(a ->> 'lockedInVersion', '') = ''
            then a || jsonb_build_object('lockedInVersion', v_locked_in_version)
          else a
        end
      ) into v_atts
      from jsonb_array_elements(v_atts) as a;

      update public.store set value = v_atts, updated_at = v_now where key = 'vift_offerAttachments';
    end if;
  end if;

  return jsonb_build_object(
    'offerId',           p_offer_id,
    'offerVersion',      coalesce((v_off ->> 'versionNumber')::int, 1),
    'created',           v_created,
    'offerToken',        v_token,
    'tokenExpiresAt',    v_token_expires_text,
    'lockedInVersion',   v_locked_in_version,
    'attachmentPatches', v_attachment_patches,
    'offerPatch', jsonb_build_object(
      'publicToken',        v_token,
      'tokenCreatedAt',     v_token_created_text,
      'tokenExpiresAt',     v_token_expires_text,
      'tokenRevokedAt',     '',
      'openCount',          v_open_count,
      'openedAt',           v_opened_at,
      'lockedSnapshotJSON', v_snapshot_text,
      'updatedAt',          v_updated_at_text
    )
  );
end;
$function$;

alter function public.offer_email_prepare_commit(text) owner to postgres;
revoke all on function public.offer_email_prepare_commit(text) from public, anon, authenticated;
grant execute on function public.offer_email_prepare_commit(text) to service_role;

commit;

;
