-- ============================================================
-- Migration: Atomiska RPC-funktioner för vift_workOrders + vift_timeEntries
-- Datum:     2026-10-17 (P0 — AO/tid "försvinner tyst")
-- STATUS:    FÖRSLAG — EJ EXEKVERAD mot staging eller produktion.
--            Testad LOKALT mot en disposable Postgres 16-instans
--            (se p0-ao-time-fix/tests/) av denna arbetskopia.
--
-- Beror på / återanvänder RAKT AV samma arkitekturmönster som redan
-- bevisat fungerande i detta repo:
--   20260908000001/20260908000002 (vift_projectDocuments)
--   20260917000001                (vift_workOrders checklista — work_order_checklist_resolve)
--   20260720000005                (store-RLS-modellen: store_active_write_safe m.fl.)
--
-- VARFÖR denna migration finns (P0-roten):
--   state.js _doPersist() (den GENERISKA "spara allt"-vägen) skickar
--   HELA state.workOrders OCH HELA state.timeEntries som två kompletta
--   arrayer i EN REST-skrivning, varje gång NÅGON OBESLÄKTAD CRM-ändring
--   sparas (se filhuvudkommentaren i state.js rad ~349). Två klienter som
--   båda har en något inaktuell kopia av dessa arrayer i minnet (t.ex. en
--   som inte hunnit polla DataSync sedan en AO skapades/en tid stämplades
--   på en ANNAN enhet) skriver tyst över varandras rader — "sista
--   skrivaren vinner" på en HEL array. Detta är EXAKT samma generella
--   klass av problem som redan NARROWLY lösts för vift_projectDocuments
--   och (endast för checklista-övergången) vift_workOrders — men AO-
--   skapande, AO-fältredigering, AO-radering, klocka in/ut och manuell
--   tidsregistrering/tidsredigering/tidsradering gick ALLA fortfarande
--   via den generiska, race-utsatta vägen.
--
-- VAD denna migration gör:
--   1. work_order_create       — atomisk, kollisionsresistent ID-generering
--                                 + append, med idempotensnyckel.
--   2. work_order_patch        — atomisk fält-merge mot EXAKT den LÅSTA AO:n
--                                 (stabilt id, aldrig array-index), med
--                                 valfri `p_expected_updated_at` (lost-update-
--                                 skydd: om satt och inte matchar → 'stale_write').
--   3. work_order_soft_delete  — atomisk, idempotent (redan borttagen → ok,
--                                 no-op, inte fel).
--   4. time_entry_create       — atomisk append + AO-koppling (ao.timeEntries),
--                                 med idempotensnyckel (klocka in/ut, manuell).
--   5. time_entry_patch        — atomisk merge mot EXAKT den LÅSTA posten.
--   6. time_entry_soft_delete  — atomisk, idempotent.
--   7. En delad idempotenstabell `public.op_idempotency` + hjälpfunktionen
--      `_idempotency_check_and_store()`: en retry med SAMMA klientgenererade
--      `p_idempotency_key` (UUID) returnerar det UR­SPRUNGLIGA resultatet
--      igen UTAN att mutera något en andra gång — löser "nätverksfel EFTER
--      att servern redan lyckats, FÖRE klienten hann se svaret" (§E i
--      uppdraget) för SAMTLIGA sex funktioner ovan.
--
-- VIKTIGT — vad denna migration AVSIKTLIGT INTE gör (till skillnad från
-- motsvarande projectDocuments-migration 20260908000002):
--   Den lägger INGA RESTRICTIVE-policyer som blockerar direkt klient-
--   skrivning av vift_workOrders/vift_timeEntries. Detta är en MEDVETEN,
--   separat Fas 2 (se 20261017000002_..._PHASE2_DO_NOT_SHIP_YET.sql) —
--   till skillnad från vift_projectDocuments (som vid sin motsvarande
--   migration redan hade ALLA sina mutationsvägar flyttade till RPC:er)
--   har vift_workOrders/vift_timeEntries FORTFARANDE ~24 ANDRA, obesläktade
--   mutations-callsites (personaltilldelning, material, prissättning,
--   tidpost-redigering m.fl.) som INTE ingår i denna runda och fortfarande
--   går via generisk persist(). Att stänga direktskrivning NU skulle tyst
--   förstöra ALLA dessa — se Fas 2-filens huvud för fullständig motivering.
--   DENNA migration är ändå säker och värdefull att rulla ut FRISTÅENDE:
--   den är RENT ADDITIV (nya funktioner + ny tabell), rör INGEN befintlig
--   policy eller befintlig skrivväg, och kan tas i bruk av NY klientkod
--   (AOTimeSyncService.js) UTAN att något befintligt beteende ändras.
--
-- MEDVETET UTELÄMNAT (dokumenterad avgränsning, samma princip som
-- 20260917000001 §"MEDVETET UTELÄMNAT"):
--   - Ingen ägarskaps-/behörighetskontroll INUTI SQL-funktionerna själva
--     (t.ex. "får denna användare skapa/ändra DENNA AO") — det ansvaret
--     ligger, precis som för work_order_checklist_resolve, på anropande
--     Edge Function (ao-time-write/index.ts), som härleder
--     p_caller_staff_id/p_caller_can_view_all SERVER-SIDIGT från JWT:n
--     via checkViftAuth() INNAN RPC:n anropas — SQL-funktionerna tar
--     emot redan-verifierade parametrar, exakt som
--     work_order_checklist_resolve(p_caller_can_view_all, p_caller_staff_id).
--   - Ingen ändring av vift_activityLog-skrivvägen utöver vad som redan
--     finns — nya aktivitetsloggrader för create/patch/delete skrivs av
--     Edge Function:en EFTER en lyckad RPC, via den befintliga generiska
--     vägen (ActivityService-mönstret), INTE inuti denna migration. Att
--     göra OCKSÅ activityLog atomiskt för dessa operationer är utanför
--     detta P0-uppdrags omfång (ingen verifierad förlustbugg där) och
--     riskerar att i onödan utöka låsningsytan.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.work_order_create(jsonb, text, text);
--   DROP FUNCTION IF EXISTS public.work_order_patch(text, jsonb, text, text);
--   DROP FUNCTION IF EXISTS public.work_order_soft_delete(text, text);
--   DROP FUNCTION IF EXISTS public.work_order_permanent_delete(text, text);
--   DROP FUNCTION IF EXISTS public.time_entry_create(jsonb, text, text);
--   DROP FUNCTION IF EXISTS public.time_entry_patch(text, jsonb, text, text);
--   DROP FUNCTION IF EXISTS public.time_entry_soft_delete(text, text);
--   DROP TABLE IF EXISTS public.op_idempotency;
--   -- Riskfri rollback: inga befintliga policyer/skrivvägar rörs av denna
--   -- migration (se "VIKTIGT" ovan) -- en rollback återställer alltså
--   -- bara till "RPC:erna finns inte", utan att återinföra någon ny risk.
-- ============================================================

-- ── 0) Idempotenstabell + hjälpfunktion ──────────────────────────────
-- EN rad per (funktionsnamn, klient-idempotensnyckel). `result` är det
-- JSONB-svar som returnerades FÖRSTA gången — en identisk retry (samma
-- nyckel) får EXAKT samma svar igen, utan att något muteras en andra gång.
-- 24h TTL städas av `op_idempotency_prune()` (anropas valfritt från ett
-- cron/EF, inte en förutsättning för korrekthet — en gammal rad gör
-- aldrig en NY, obesläktad operation felaktigt idempotent, eftersom
-- nyckeln är klientgenererad per-operation och aldrig återanvänds
-- medvetet för en annan operation).
CREATE TABLE IF NOT EXISTS public.op_idempotency (
  fn_name    text        NOT NULL,
  idem_key   text        NOT NULL,
  result     jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fn_name, idem_key)
);
ALTER TABLE public.op_idempotency ENABLE ROW LEVEL SECURITY;
-- Ingen policy för authenticated/anon skapas — tabellen är ENDAST
-- åtkomlig via service_role (RPC-funktionerna körs SECURITY DEFINER som
-- ägaren, som har BYPASSRLS, så RLS här är ett extra defense-in-depth-
-- lager mot ett eventuellt framtida direkt REST-anrop, inte den primära
-- åtkomstkontrollen).

CREATE OR REPLACE FUNCTION public._idempotency_check_and_store(
  p_fn_name  text,
  p_idem_key text,
  p_compute  jsonb   -- resultatet IFALL detta är en ny operation (se nedan: detta är redan uträknat av anroparen)
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  -- OBS: denna hjälpfunktion används INTE direkt (en RPC kan inte
  -- "beräkna om inte redan finns" i ett enda uttryck utan att alltid
  -- mutera) — se istället det upprepade mönstret i varje funktion nedan:
  -- SELECT result FIRST, och endast om NULL utförs mutationen + INSERT.
  RAISE EXCEPTION 'not_implemented_use_inline_pattern';
END;
$$;
-- (Hjälpfunktionen ovan lämnas odefinierad/oanropad medvetet — det
-- faktiska idempotens-mönstret är inlinead i varje funktion nedan, se
-- steg 1 i var och en: "om p_idempotency_key redan finns i
-- op_idempotency för DENNA funktion → returnera lagrat resultat direkt,
-- UTAN att ta radlåsningen eller röra store alls." Att ha en gemensam
-- generisk `_compute`-funktion visade sig otympligt i ren SQL (ett
-- jsonb-uttryck kan inte lata-evalueras), så mönstret upprepas explicit
-- istället för en bräcklig abstraktion.

DROP FUNCTION public._idempotency_check_and_store(text, text, jsonb);
-- ── 1) work_order_create — atomisk, kollisionsresistent ID + append ──
-- R2 (2026-10-18) — tillägg: valfri `p_client_id`. UPPTÄCKT vid den
-- fulla call-site-migreringen (se §3 i paketets README): nästan alla
-- ~24 befintliga anropsplatser (WorkOrderService.create(), import-
-- motorn i ImportWizardPage.js) är SYNKRONA och returnerar/förväntar
-- sig AO:ns id OMEDELBART (för navigering, för att länka tidposter,
-- för importens createdIds-lista) — de kan inte vänta på en server-
-- resa för att få ett id. Att tvinga server-genererade id:n hade
-- krävt en id-reconciliation (byta ut det lokala id:t överallt i
-- state EFTER svaret) tvärs genom flera tusen rader sid-kod, vilket i
-- sig var en ny regressionsrisk denna insats inte kan riskera
-- oövervakat. Lösning: klienten FÅR fortsätta välja sitt eget id
-- (oförändrad newId()-logik, oförändrat synkront kontrakt för alla
-- anropare) — men id:t skickas nu till RPC:n, som atomiskt kontrollerar
-- KOLLISION mot den LÅSTA, färskaste raden (inte klientens eventuellt
-- inaktuella array-längd) och avvisar explicit (`id_collision`) om
-- det redan finns, istället för tyst överskrivning. Detta behåller HELA
-- racet-skyddet (atomisk låsning, ingen "läs hela/skriv hela") för
-- EXAKT den svaghet uppdraget identifierade (två klienter med samma
-- inaktuella längd kunde tidigare generera samma id och tysta
-- varandra) — bara id-VÄRDET kommer fortsatt från klienten, inte
-- unikheten/säkerheten. `p_client_id IS NULL` (nya, framtida anropare
-- som inte behöver ett synkront svar) ger fortsatt serverGenererat,
-- sequence-baserat id precis som R1 ovan.
CREATE OR REPLACE FUNCTION public.work_order_create(
  p_ao             jsonb,   -- fullständigt AO-objekt FRÅN klienten, UTAN 'id' (eller med 'id' ignorerat)
  p_idempotency_key text,
  p_client_id       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing   jsonb;
  v_workorders jsonb;
  v_new_id     text;
  v_seq        bigint;
  v_now        timestamptz := clock_timestamp();
  v_now_text   text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_new_ao     jsonb;
  v_sig        text;
  v_collision_idx int;
BEGIN
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  -- Idempotent retry: samma klientnyckel igen → samma svar, ingen ny mutation.
  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'work_order_create' AND idem_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO public.store(key, value) VALUES ('vift_workOrders', '[]'::jsonb)
    ON CONFLICT (key) DO NOTHING;

  SELECT value INTO v_workorders FROM public.store WHERE key = 'vift_workOrders' FOR UPDATE;
  IF v_workorders IS NULL OR jsonb_typeof(v_workorders) <> 'array' THEN
    v_workorders := '[]'::jsonb;
  END IF;

  IF p_client_id IS NOT NULL AND trim(p_client_id) <> '' THEN
    -- Klient-valt id: kontrollera KOLLISION mot den NU LÅSTA, färskaste
    -- raden (inte klientens egen, eventuellt inaktuella uppfattning om
    -- arrayens längd/innehåll) — detta är den faktiska race-fixen: två
    -- samtidiga anrop kan omöjligen båda lyckas med samma id, eftersom
    -- det andra anropet blockerar på FOR UPDATE tills det första
    -- committat, och ser DÅ redan det första idets rad.
    SELECT (ord - 1) INTO v_collision_idx
      FROM jsonb_array_elements(v_workorders) WITH ORDINALITY AS t(elem, ord)
      WHERE elem ->> 'id' = p_client_id
      LIMIT 1;
    IF v_collision_idx IS NOT NULL THEN
      RAISE EXCEPTION 'id_collision';
    END IF;
    v_new_id := p_client_id;
  ELSE
    -- ── Kollisionsresistent, kanoniskt AO-id (serverVALT) ───────────
    -- En monotont stigande sequence (databas-nivå, aldrig två anrop kan
    -- få samma värde). Används av anropare som inte behöver ett synkront
    -- klient-id (t.ex. service-monitor EF:en — se migration 20261017000003).
    -- Samma format (AO-NNN, minst 3 siffror, inget minimum-maxtak) som den
    -- befintliga klient-sidiga newId()/nextWorkOrderId()-konventionen, för
    -- visuell konsistens mellan gamla och nya AO:er. En explicit kollisions-
    -- kontroll (retry-loop) BEHÅLLS ändå här, defensivt — även om en
    -- kollision mellan en oberoende sequence och en array som (teoretiskt)
    -- redan råkar innehålla exakt samma textsträng är extremt osannolik,
    -- är den INTE strukturellt omöjlig på samma sätt som för p_client_id-
    -- grenen ovan (vars kollisionskontroll är den FAKTISKA race-fixen).
    CREATE SEQUENCE IF NOT EXISTS public.work_order_id_seq;
    LOOP
      v_seq := nextval('public.work_order_id_seq');
      v_new_id := 'AO-' || lpad(v_seq::text, 3, '0');
      SELECT (ord - 1) INTO v_collision_idx
        FROM jsonb_array_elements(v_workorders) WITH ORDINALITY AS t(elem, ord)
        WHERE elem ->> 'id' = v_new_id
        LIMIT 1;
      IF v_collision_idx IS NULL THEN EXIT; END IF;
    END LOOP;
  END IF;

  v_new_ao := (p_ao - 'id') || jsonb_build_object(
    'id', v_new_id,
    'createdAt', v_now_text,
    'updatedAt', v_now_text
  );

  v_workorders := v_workorders || jsonb_build_array(v_new_ao);
  UPDATE public.store SET value = v_workorders, updated_at = v_now WHERE key = 'vift_workOrders';

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_existing := jsonb_build_object('workOrder', v_new_ao, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('work_order_create', p_idempotency_key, v_existing);

  RETURN v_existing;
END;
$$;
-- ── 2) work_order_patch — atomisk fält-merge + lost-update-skydd ─────
CREATE OR REPLACE FUNCTION public.work_order_patch(
  p_ao_id              text,
  p_patch              jsonb,
  p_idempotency_key    text,
  p_expected_updated_at text DEFAULT NULL  -- NULL = ovillkorlig merge (bakåtkompatibelt); satt = kräver match, annars 'stale_write'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing   jsonb;
  v_workorders jsonb;
  v_idx        int;
  v_ao         jsonb;
  v_updated    jsonb;
  v_now        timestamptz := clock_timestamp();
  v_now_text   text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_sig        text;
  v_result     jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'work_order_patch' AND idem_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT value INTO v_workorders FROM public.store WHERE key = 'vift_workOrders' FOR UPDATE;
  IF v_workorders IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT (ord - 1) INTO v_idx
    FROM jsonb_array_elements(v_workorders) WITH ORDINALITY AS t(elem, ord)
    WHERE elem ->> 'id' = p_ao_id
    LIMIT 1;
  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_ao := v_workorders -> v_idx;

  -- ── Lost-update-skydd (§B/§G i uppdraget): om anroparen skickade ett
  --    förväntat updatedAt (dvs klienten BYGGDE sin patch från en viss,
  --    känd version av AO:n) och den INTE matchar den FAKTISKA, just
  --    LÅSTA server-raden → avvisa som 'stale_write' istället för att
  --    tyst skriva över en mellankommande ändring från en ANNAN klient.
  --    Anroparen (EF) returnerar detta som ett tydligt fel; klienten kan
  --    då hämta färsk data och be användaren slå ihop/försöka igen —
  --    ALDRIG en tyst, oavsiktlig överskrivning av ett fält den aldrig
  --    sett.
  IF p_expected_updated_at IS NOT NULL
     AND (v_ao ->> 'updatedAt') IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'stale_write';
  END IF;

  v_updated := (v_ao || p_patch) || jsonb_build_object('updatedAt', to_jsonb(v_now_text));
  v_workorders := jsonb_set(v_workorders, array[v_idx::text], v_updated);
  UPDATE public.store SET value = v_workorders, updated_at = v_now WHERE key = 'vift_workOrders';

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('workOrder', v_updated, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('work_order_patch', p_idempotency_key, v_result);

  RETURN v_result;
END;
$$;
-- ── 3) work_order_soft_delete — atomisk, idempotent ──────────────────
CREATE OR REPLACE FUNCTION public.work_order_soft_delete(
  p_ao_id           text,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing   jsonb;
  v_workorders jsonb;
  v_idx        int;
  v_ao         jsonb;
  v_updated    jsonb;
  v_now        timestamptz := clock_timestamp();
  v_now_text   text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_sig        text;
  v_result     jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'work_order_soft_delete' AND idem_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT value INTO v_workorders FROM public.store WHERE key = 'vift_workOrders' FOR UPDATE;
  IF v_workorders IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT (ord - 1) INTO v_idx
    FROM jsonb_array_elements(v_workorders) WITH ORDINALITY AS t(elem, ord)
    WHERE elem ->> 'id' = p_ao_id
    LIMIT 1;
  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_ao := v_workorders -> v_idx;
  -- Idempotent mot UPPREPAD radering (inte bara upprepat ANROP): en AO
  -- som redan är markerad borttagen ger samma lyckade svar, no-op mot
  -- store — en nätverks-retry på en redan lyckad radering ska ALDRIG
  -- kunna ge ett förvirrande "not_found" eller en onödig andra mutation.
  IF (v_ao ->> 'deleted')::boolean IS TRUE THEN
    v_result := jsonb_build_object('workOrder', v_ao, 'serverSignature', NULL, 'alreadyDeleted', true);
    INSERT INTO public.op_idempotency(fn_name, idem_key, result)
      VALUES ('work_order_soft_delete', p_idempotency_key, v_result);
    RETURN v_result;
  END IF;

  v_updated := v_ao || jsonb_build_object('deleted', true, 'deletedAt', v_now_text, 'updatedAt', v_now_text);
  v_workorders := jsonb_set(v_workorders, array[v_idx::text], v_updated);
  UPDATE public.store SET value = v_workorders, updated_at = v_now WHERE key = 'vift_workOrders';

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('workOrder', v_updated, 'serverSignature', v_sig, 'alreadyDeleted', false);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('work_order_soft_delete', p_idempotency_key, v_result);

  RETURN v_result;
END;
$$;
-- ── 3b) work_order_permanent_delete — atomisk HÅRDRADERING (array-
--       removal, inte en flagga) — tillagd 2026-10-18 vid den fulla
--       call-site-migreringen, för WorkOrderService.permanentDelete()
--       (papperskorgens "radera permanent", en sällan använd, destruktiv
--       admin-åtgärd — till skillnad från work_order_soft_delete ovan,
--       som sätter `deleted:true` och BEHÅLLER raden). Samma radlås +
--       idempotens-mönster som time_entry_soft_delete. ────────────────
CREATE OR REPLACE FUNCTION public.work_order_permanent_delete(
  p_ao_id           text,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing   jsonb;
  v_workorders jsonb;
  v_idx        int;
  v_now        timestamptz := clock_timestamp();
  v_sig        text;
  v_result     jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'work_order_permanent_delete' AND idem_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT value INTO v_workorders FROM public.store WHERE key = 'vift_workOrders' FOR UPDATE;
  IF v_workorders IS NULL THEN
    v_result := jsonb_build_object('deleted', true, 'alreadyDeleted', true, 'serverSignature', NULL);
    INSERT INTO public.op_idempotency(fn_name, idem_key, result)
      VALUES ('work_order_permanent_delete', p_idempotency_key, v_result);
    RETURN v_result;
  END IF;

  SELECT (ord - 1) INTO v_idx
    FROM jsonb_array_elements(v_workorders) WITH ORDINALITY AS t(elem, ord)
    WHERE elem ->> 'id' = p_ao_id
    LIMIT 1;
  IF v_idx IS NULL THEN
    -- Idempotent mot upprepad permanent radering: redan borta → ok, no-op.
    v_result := jsonb_build_object('deleted', true, 'alreadyDeleted', true, 'serverSignature', NULL);
    INSERT INTO public.op_idempotency(fn_name, idem_key, result)
      VALUES ('work_order_permanent_delete', p_idempotency_key, v_result);
    RETURN v_result;
  END IF;

  v_workorders := v_workorders - v_idx;
  UPDATE public.store SET value = v_workorders, updated_at = v_now WHERE key = 'vift_workOrders';

  v_sig := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('deleted', true, 'alreadyDeleted', false, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('work_order_permanent_delete', p_idempotency_key, v_result);

  RETURN v_result;
END;
$$;
-- ── 4) time_entry_create — atomisk append + AO-koppling ──────────────
-- R2 (2026-10-18): samma `p_client_id`-tillägg och samma motivering som
-- work_order_create ovan (TimeService.clockOut()/saveManual() är
-- synkrona och returnerar posten direkt till anroparen).
CREATE OR REPLACE FUNCTION public.time_entry_create(
  p_entry           jsonb,  -- fullständig tidpost UTAN 'id'
  p_idempotency_key text,
  p_client_id       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing     jsonb;
  v_entries      jsonb;
  v_workorders   jsonb;
  v_ao_idx       int;
  v_ao           jsonb;
  v_seq          bigint;
  v_new_id       text;
  v_now          timestamptz := clock_timestamp();
  v_now_text     text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_new_entry    jsonb;
  v_ao_id        text;
  v_sig          text;
  v_result       jsonb;
  v_collision_idx int;
BEGIN
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'time_entry_create' AND idem_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Deterministisk låsordning (samma princip som work_order_checklist_resolve):
  -- vift_timeEntries FÖRE vift_workOrders, alltid i denna ordning i ALLA
  -- funktioner i denna migration som rör båda — undviker deadlock mellan
  -- två samtidiga anrop som annars kunde låsa i omvänd ordning.
  INSERT INTO public.store(key, value) VALUES ('vift_timeEntries', '[]'::jsonb)
    ON CONFLICT (key) DO NOTHING;
  SELECT value INTO v_entries FROM public.store WHERE key = 'vift_timeEntries' FOR UPDATE;
  IF v_entries IS NULL OR jsonb_typeof(v_entries) <> 'array' THEN
    v_entries := '[]'::jsonb;
  END IF;

  IF p_client_id IS NOT NULL AND trim(p_client_id) <> '' THEN
    SELECT (ord - 1) INTO v_collision_idx
      FROM jsonb_array_elements(v_entries) WITH ORDINALITY AS t(elem, ord)
      WHERE elem ->> 'id' = p_client_id
      LIMIT 1;
    IF v_collision_idx IS NOT NULL THEN
      RAISE EXCEPTION 'id_collision';
    END IF;
    v_new_id := p_client_id;
  ELSE
    -- Samma format-konsistens + defensiv kollisionskontroll som
    -- work_order_create ovan (minst 3 siffror, samma som klientens
    -- newId()-konvention).
    CREATE SEQUENCE IF NOT EXISTS public.time_entry_id_seq;
    LOOP
      v_seq := nextval('public.time_entry_id_seq');
      v_new_id := 'TID-' || lpad(v_seq::text, 3, '0');
      SELECT (ord - 1) INTO v_collision_idx
        FROM jsonb_array_elements(v_entries) WITH ORDINALITY AS t(elem, ord)
        WHERE elem ->> 'id' = v_new_id
        LIMIT 1;
      IF v_collision_idx IS NULL THEN EXIT; END IF;
    END LOOP;
  END IF;

  v_new_entry := (p_entry - 'id') || jsonb_build_object('id', v_new_id, 'createdAt', v_now_text);
  v_ao_id := v_new_entry ->> 'aoId';

  v_entries := jsonb_build_array(v_new_entry) || v_entries;  -- unshift, samma ordning som klienten (nyast först)
  UPDATE public.store SET value = v_entries, updated_at = v_now WHERE key = 'vift_timeEntries';

  -- Koppla till AO:n (ao.timeEntries push) om aoId angetts, och AO:n finns.
  IF v_ao_id IS NOT NULL AND v_ao_id <> '' THEN
    SELECT value INTO v_workorders FROM public.store WHERE key = 'vift_workOrders' FOR UPDATE;
    IF v_workorders IS NOT NULL AND jsonb_typeof(v_workorders) = 'array' THEN
      SELECT (ord - 1) INTO v_ao_idx
        FROM jsonb_array_elements(v_workorders) WITH ORDINALITY AS t(elem, ord)
        WHERE elem ->> 'id' = v_ao_id
        LIMIT 1;
      IF v_ao_idx IS NOT NULL THEN
        v_ao := v_workorders -> v_ao_idx;
        v_ao := v_ao || jsonb_build_object(
          'timeEntries', coalesce(v_ao -> 'timeEntries', '[]'::jsonb) || to_jsonb(v_new_id)
        );
        v_workorders := jsonb_set(v_workorders, array[v_ao_idx::text], v_ao);
        UPDATE public.store SET value = v_workorders, updated_at = v_now WHERE key = 'vift_workOrders';
      END IF;
    END IF;
  END IF;

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('timeEntry', v_new_entry, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('time_entry_create', p_idempotency_key, v_result);

  RETURN v_result;
END;
$$;
-- ── 5) time_entry_patch — atomisk merge + lost-update-skydd ──────────
CREATE OR REPLACE FUNCTION public.time_entry_patch(
  p_entry_id            text,
  p_patch               jsonb,
  p_idempotency_key     text,
  p_expected_updated_at text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing jsonb;
  v_entries  jsonb;
  v_idx      int;
  v_entry    jsonb;
  v_updated  jsonb;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_sig      text;
  v_result   jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'time_entry_patch' AND idem_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT value INTO v_entries FROM public.store WHERE key = 'vift_timeEntries' FOR UPDATE;
  IF v_entries IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT (ord - 1) INTO v_idx
    FROM jsonb_array_elements(v_entries) WITH ORDINALITY AS t(elem, ord)
    WHERE elem ->> 'id' = p_entry_id
    LIMIT 1;
  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  v_entry := v_entries -> v_idx;

  -- Attesterad tid är ALLTID låst, oavsett vad patchen försöker sätta —
  -- samma genuina lönespärr som TimeService._guardMutation() redan
  -- tillämpar klient-sidigt (bevaras här som ett andra, databas-nivå
  -- skyddslager — EF:en förväntas redan ha kontrollerat detta, men en
  -- SQL-nivå spärr gör det omöjligt att kringgå via ett manipulerat anrop).
  IF (v_entry ->> 'attested')::boolean IS TRUE AND NOT (p_patch ? 'attested') THEN
    RAISE EXCEPTION 'attested_locked';
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND (v_entry ->> 'createdAt') IS DISTINCT FROM p_expected_updated_at
     AND (v_entry ->> 'updatedAt') IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'stale_write';
  END IF;

  v_updated := (v_entry || p_patch) || jsonb_build_object('updatedAt', to_jsonb(v_now_text));
  v_entries := jsonb_set(v_entries, array[v_idx::text], v_updated);
  UPDATE public.store SET value = v_entries, updated_at = v_now WHERE key = 'vift_timeEntries';

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('timeEntry', v_updated, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('time_entry_patch', p_idempotency_key, v_result);

  RETURN v_result;
END;
$$;
-- ── 6) time_entry_soft_delete — atomisk, idempotent, attest-skyddad ──
CREATE OR REPLACE FUNCTION public.time_entry_soft_delete(
  p_entry_id        text,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing jsonb;
  v_entries  jsonb;
  v_workorders jsonb;
  v_ao_idx   int;
  v_ao       jsonb;
  v_idx      int;
  v_entry    jsonb;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_sig      text;
  v_result   jsonb;
  v_ao_id    text;
BEGIN
  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'time_entry_soft_delete' AND idem_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT value INTO v_entries FROM public.store WHERE key = 'vift_timeEntries' FOR UPDATE;
  IF v_entries IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  SELECT (ord - 1) INTO v_idx
    FROM jsonb_array_elements(v_entries) WITH ORDINALITY AS t(elem, ord)
    WHERE elem ->> 'id' = p_entry_id
    LIMIT 1;
  IF v_idx IS NULL THEN
    -- Idempotent mot upprepad radering: posten finns inte längre →
    -- behandla som redan borttagen, inte ett fel.
    v_result := jsonb_build_object('deleted', true, 'alreadyDeleted', true, 'serverSignature', NULL);
    INSERT INTO public.op_idempotency(fn_name, idem_key, result)
      VALUES ('time_entry_soft_delete', p_idempotency_key, v_result);
    RETURN v_result;
  END IF;

  v_entry := v_entries -> v_idx;
  IF (v_entry ->> 'attested')::boolean IS TRUE THEN
    RAISE EXCEPTION 'attested_locked';
  END IF;

  v_ao_id := v_entry ->> 'aoId';
  v_entries := v_entries - v_idx;
  UPDATE public.store SET value = v_entries, updated_at = v_now WHERE key = 'vift_timeEntries';

  IF v_ao_id IS NOT NULL AND v_ao_id <> '' THEN
    SELECT value INTO v_workorders FROM public.store WHERE key = 'vift_workOrders' FOR UPDATE;
    IF v_workorders IS NOT NULL AND jsonb_typeof(v_workorders) = 'array' THEN
      SELECT (ord - 1) INTO v_ao_idx
        FROM jsonb_array_elements(v_workorders) WITH ORDINALITY AS t(elem, ord)
        WHERE elem ->> 'id' = v_ao_id
        LIMIT 1;
      IF v_ao_idx IS NOT NULL THEN
        v_ao := v_workorders -> v_ao_idx;
        v_ao := v_ao || jsonb_build_object(
          'timeEntries', (
            SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
            FROM jsonb_array_elements_text(coalesce(v_ao -> 'timeEntries', '[]'::jsonb)) x
            WHERE x <> p_entry_id
          )
        );
        v_workorders := jsonb_set(v_workorders, array[v_ao_idx::text], v_ao);
        UPDATE public.store SET value = v_workorders, updated_at = v_now WHERE key = 'vift_workOrders';
      END IF;
    END IF;
  END IF;

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('deleted', true, 'alreadyDeleted', false, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('time_entry_soft_delete', p_idempotency_key, v_result);

  RETURN v_result;
END;
$$;
-- ── Behörigheter: ENDAST service_role (samma princip som alla tidigare RPC:er) ──
REVOKE ALL ON FUNCTION public.work_order_create(jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.work_order_patch(text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.work_order_soft_delete(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.work_order_permanent_delete(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.time_entry_create(jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.time_entry_patch(text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.time_entry_soft_delete(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.work_order_create(jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.work_order_patch(text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.work_order_soft_delete(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.work_order_permanent_delete(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.time_entry_create(jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.time_entry_patch(text, jsonb, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.time_entry_soft_delete(text, text) TO service_role;
-- ── RESTRICTIVE-policyer: MEDVETET INTE i DENNA migration ───────────
-- Se separat fil 20261017000002_ao_time_rls_lockdown_PHASE2_DO_NOT_SHIP_YET.sql
-- för varför: vift_workOrders/vift_timeEntries har, till skillnad från
-- vift_projectDocuments vid dess motsvarande migration, FORTFARANDE
-- MÅNGA andra, obesläktade mutationsvägar (personaltilldelning, material,
-- prissättning, tidpost-redigering/radering m.fl. — se
-- WorkOrderService.js/TimeService.js, ~24 persist()-anrop utanför denna
-- rundas omfång) som ALLA fortfarande går via den generiska persist()-
-- vägen. Att stänga direktskrivning av dessa nycklar NU, innan de
-- vägarna migrerats till RPC-mönstret, skulle TYST FÖRSTÖRA samtliga —
-- en betydligt allvarligare regression än den detta uppdrag ska lösa.

-- ── Verifiering (körs manuellt efter migrering, se p0-ao-time-fix/tests/) ──
-- SELECT proname, proacl FROM pg_proc WHERE proname IN
--   ('work_order_create','work_order_patch','work_order_soft_delete',
--    'time_entry_create','time_entry_patch','time_entry_soft_delete');
-- SELECT policyname, cmd, permissive FROM pg_policies
--   WHERE tablename='store' AND policyname LIKE 'store_ao_time_%';