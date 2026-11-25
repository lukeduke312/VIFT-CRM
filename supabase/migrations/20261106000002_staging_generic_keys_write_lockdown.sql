-- ============================================================
-- KANDIDAT, INTE BEVISAD HISTORISK SQL (G1/G4 del 2, 2026-11-27).
-- I STAGING har migrationen 20261106000002 en TOM statements-lista i
-- supabase_migrations.schema_migrations, så den SQL som faktiskt kördes
-- är okänd. Innehållet nedan är filen
--   staging-release/_staging_integration/server/migrations/20261106000002_staging_generic_keys_write_lockdown.sql
-- (md5 4716e44e62396a2f8cd2c50d78767678, oförändrad efter markören INNEHÅLL). Funktionskroppar och
-- policyer i drift har jämförts mot den, se
-- supabase/inventering/G1-G4-DEL2-RESULTAT.md, avsnittet om de tomma
-- migrationerna. Allt som avviker från drift rättas av de rekonstruerade
-- migrationerna 20261127*.
-- ============================================================
-- INNEHÅLL
-- STAGING-GRANSKNING 2026-11-06 (fynd 2) — Fas 1 (ADDITIV, NOLL enforcement-
-- ändring i denna fil, se filhuvudets princip i P0_FINAL_2026-11-04).
--
-- BAKGRUND: STAGING:s verkliga, hämtade _doPersist() (se client_patch/
-- patched_source/src/data/state.js, portat från den faktiska STAGING-koden)
-- skickar FORTFARANDE samtliga 27 generiska business-/referensnycklar i ETT
-- Storage.setAll()-anrop vid VARJE sparning — oavsett vad som faktiskt
-- ändrats. Detta är EXAKT samma riskmönster P0_FINAL_2026-11-04 redan
-- stängde för LIVE (en oförändrad, potentiellt inaktuell kopia av t.ex.
-- `offers` kan tyst skriva över en ANNAN sessions redan bekräftade, nyare
-- ändring, bara eftersom en obesläktad `customers`-ändring triggade samma
-- persist()-anrop).
--
-- OMFATTNING: ENDAST de 27 nycklar STAGING:s EGEN, redan befintliga
-- _doPersist()-lista omfattar. `vift_workOrders`/`vift_timeEntries`/
-- `vift_invoices`/`vift_ronderingspass`/`vift_offerAttachments`/
-- `vift_projectDocuments`/`vift_offerEvents` RÖRS INTE här och ingår INTE i
-- allowlistan nedan — STAGING har SEDAN TIDIGARE, oberoende av detta
-- P0-arbete, redan egna, mogna, atomiska RPC-vägar för dessa (se
-- AOTimeSyncService.js/invoice-write/rondering-pass-write/
-- offer-attachment-upload/send-offer-email, bekräftat genom att läsa STAGING:s
-- faktiska, hämtade klientkod). Att lägga till dem här skulle skapa en
-- KONKURRERANDE skrivväg vid sidan av ett redan fungerande system — exakt
-- det STAGING-granskningens eget, tidigare fynd (avsnitt 0 i den föregående
-- rundans rapport) varnade för.
--
-- VIKTIG DRIFTSKONSEKVENS (samma princip som P0_FINAL_2026-11-04 §driftnotis):
-- att installera Fas 2 (enforcement, SEPARAT fil) INNAN klienten ovan är
-- live gör redigering av dessa 27 register overksam i UI:t. Se
-- STAGING-CANDIDATE-REPORT-2026-11-06.md §installationsordning.

BEGIN;

CREATE OR REPLACE FUNCTION public._staging_business_key_required_perm(p_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_key
    WHEN 'vift_customers'          THEN 'customer_manage'
    WHEN 'vift_properties'         THEN 'customer_manage'
    WHEN 'vift_propertyContacts'   THEN 'customer_manage'
    WHEN 'vift_propertyRoles'      THEN 'customer_manage'
    WHEN 'vift_propertyCategories' THEN 'customer_manage'
    WHEN 'vift_propertyObjects'    THEN 'customer_manage'
    WHEN 'vift_deviationCategories' THEN 'customer_manage'
    WHEN 'vift_inspections'        THEN 'customer_manage'
    WHEN 'vift_contracts'          THEN 'customer_manage'
    WHEN 'vift_offers'             THEN 'offer_manage'
    WHEN 'vift_salesOpps'          THEN 'sales_manage'
    WHEN 'vift_recurringOrders'    THEN 'recurring_manage'
    WHEN 'vift_ronderingar'        THEN 'ao_view_all'
    WHEN 'vift_ronderingsmallar'   THEN 'ao_view_all'
    WHEN 'vift_avvikelser'         THEN 'ao_view_all'
    WHEN 'vift_staff'              THEN 'staff_manage'
    WHEN 'vift_roles'              THEN 'admin_manage'
    WHEN 'vift_settings'           THEN 'admin_manage'
    WHEN 'vift_titles'             THEN 'admin_manage'
    WHEN 'vift_articles'           THEN 'article_manage'
    WHEN 'vift_priceGroups'        THEN 'article_manage'
    WHEN 'vift_priceProfiles'      THEN 'article_manage'
    WHEN 'vift_serviceTemplates'   THEN 'admin_manage'
    WHEN 'vift_emailTemplates'     THEN 'admin_manage'
    WHEN 'vift_activities'         THEN 'admin_manage'
    WHEN 'vift_activityLog'        THEN 'admin_manage'
    WHEN 'vift_importLogs'         THEN 'admin_manage'
    WHEN 'vift_projects'           THEN 'customer_manage'
    -- vift_workOrders/vift_timeEntries/vift_invoices/vift_ronderingspass/
    -- vift_offerAttachments MEDVETET UTESLUTNA — se filhuvudet ovan.
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.store_business_key_write(
  p_key               text,
  p_new_value         jsonb,
  p_expected_hash     text,
  p_caller_authorized boolean,
  p_actor_id          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_required_perm   text;
  v_current_value   jsonb;
  v_current_hash    text;
  v_now             timestamptz := clock_timestamp();
  v_now_text        text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_current_len     int;
  v_new_len         int;
begin
  p_caller_authorized := coalesce(p_caller_authorized, false);

  if p_key is null or p_new_value is null or p_actor_id is null or length(trim(p_actor_id)) = 0 then
    raise exception 'missing_fields';
  end if;

  v_required_perm := public._staging_business_key_required_perm(p_key);
  if v_required_perm is null then
    raise exception 'key_not_allowlisted';
  end if;
  if not p_caller_authorized then
    raise exception 'forbidden';
  end if;

  if jsonb_typeof(p_new_value) not in ('array', 'object') then
    raise exception 'invalid_value_type';
  end if;

  select value into v_current_value from public.store where key = p_key for update;
  v_current_hash := encode(sha256(convert_to(coalesce(v_current_value, 'null'::jsonb)::text, 'UTF8')), 'hex');

  if v_current_value is not null and (p_expected_hash is null or length(trim(p_expected_hash)) = 0) then
    raise exception 'missing_expected_hash';
  end if;
  if v_current_value is not null and v_current_hash is distinct from p_expected_hash then
    raise exception 'stale_write';
  end if;

  -- ANTI-MASSTÖMNING: samma skydd som P0_FINAL_2026-11-04, oförändrat.
  if jsonb_typeof(v_current_value) = 'array' and jsonb_typeof(p_new_value) = 'array' then
    v_current_len := jsonb_array_length(v_current_value);
    v_new_len     := jsonb_array_length(p_new_value);
    if v_current_len > 5 and v_new_len = 0 then
      raise exception 'mass_wipe_blocked';
    end if;
    if v_current_len > 10 and v_new_len::numeric < (v_current_len::numeric * 0.1) then
      raise exception 'mass_wipe_blocked';
    end if;
  end if;

  update public.store set value = p_new_value, updated_at = v_now where key = p_key;
  if not found then
    insert into public.store(key, value, updated_at) values (p_key, p_new_value, v_now);
  end if;

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object(
    'key', p_key,
    'newHash', encode(sha256(convert_to(p_new_value::text, 'UTF8')), 'hex'),
    'serverSignature', v_now_text
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.store_business_key_read_with_hash(p_key text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'value', value,
    'hash', encode(sha256(convert_to(coalesce(value, 'null'::jsonb)::text, 'UTF8')), 'hex')
  )
  FROM public.store WHERE key = p_key;
$$;

CREATE OR REPLACE FUNCTION public.store_business_keys_read_hashes(p_keys text[])
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(jsonb_object_agg(key, encode(sha256(convert_to(coalesce(value, 'null'::jsonb)::text, 'UTF8')), 'hex')), '{}'::jsonb)
  FROM public.store
  WHERE key = ANY(p_keys);
$$;

-- Atomisk helläsning (data+hash i SAMMA snapshot) för de 27 generiska
-- nycklarna ENDAST — ingen särskild workOrders/timeEntries-filtrering
-- behövs här, de ingår inte i p_keys (EF:en skickar bara denna lista, se
-- server/functions/store-key-write/index.ts).
CREATE OR REPLACE FUNCTION public.store_read_all_with_hashes(p_business_keys text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_data   jsonb := '{}'::jsonb;
  v_hashes jsonb := '{}'::jsonb;
  v_row    record;
begin
  for v_row in select key, value from public.store where key = ANY(p_business_keys) or key = 'vift_lastChanged' loop
    v_data := v_data || jsonb_build_object(v_row.key, v_row.value);
    if v_row.key = ANY(p_business_keys) then
      v_hashes := v_hashes || jsonb_build_object(v_row.key, encode(sha256(convert_to(coalesce(v_row.value, 'null'::jsonb)::text, 'UTF8')), 'hex'));
    end if;
  end loop;
  return jsonb_build_object('data', v_data, 'hashes', v_hashes);
end;
$function$;

REVOKE ALL ON FUNCTION public.store_business_keys_read_hashes(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_business_keys_read_hashes(text[]) TO service_role;
REVOKE ALL ON FUNCTION public.store_business_key_write(text, jsonb, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_business_key_write(text, jsonb, text, boolean, text) TO service_role;
REVOKE ALL ON FUNCTION public._staging_business_key_required_perm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._staging_business_key_required_perm(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.store_business_key_read_with_hash(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_business_key_read_with_hash(text) TO service_role;
REVOKE ALL ON FUNCTION public.store_read_all_with_hashes(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_read_all_with_hashes(text[]) TO service_role;

-- INGEN enforcement här — se 20261106000003_staging_generic_keys_enforce_rls.sql.
COMMIT;
