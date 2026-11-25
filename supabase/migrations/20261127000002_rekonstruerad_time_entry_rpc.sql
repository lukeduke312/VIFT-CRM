-- ============================================================
-- Rekonstruerad 2026-11-27 från STAGING-schema (pg_get_functiondef/pg_policies), inte historisk SQL.
-- Källa: STAGING yyzljlqyzzcbxmcdbual, läst med SELECT 2026-11-25
-- (supabase/inventering/staging-2026-11-26/schema/ och tests/local/staging-schema-facit-2026-11-25.json).
-- Den SQL som ursprungligen installerade objekten nedan finns inte i någon
-- registrerad migration, i något repo eller i git-historiken (G1/G4, avsnitt 7).
-- Funktionstexterna är exakt pg_get_functiondef() från STAGING; grants och
-- REVOKE motsvarar proacl/pg_policies i drift. Verifieras av
-- tests/local/migrationskedja.sh (jämför md5 av pg_get_functiondef efter körning).
-- ============================================================
-- R-C: time_entry_* i driftversion (ersätter versionerna från 20261017000001 och
-- lägger till time_entry_set_attested). Äldre signaturer som inte finns i drift tas bort.

begin;

drop function if exists public.time_entry_patch(text, jsonb, text, text);
drop function if exists public.time_entry_soft_delete(text, text);

-- time_entry_create(jsonb, text, text)  (md5 av pg_get_functiondef i drift: 859ef65023890c203caee7c65b11b324)
CREATE OR REPLACE FUNCTION public.time_entry_create(p_entry jsonb, p_idempotency_key text, p_client_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_safe_entry   jsonb;
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

  -- FIX 3 (SÄKERHETSBLOCKER, försvar i djup): en NY post kan ALDRIG
  -- skapas redan attesterad via denna funktion, oavsett vad anroparen
  -- (Edge Function:en) skickar in. Attestering sker ENDAST via
  -- time_entry_set_attested() nedan, aldrig vid skapande.
  v_safe_entry := p_entry - 'attested' - 'attestedAt' - 'attestedBy';

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

  v_new_entry := (v_safe_entry - 'id') || jsonb_build_object('id', v_new_id, 'createdAt', v_now_text);
  v_ao_id := v_new_entry ->> 'aoId';

  v_entries := jsonb_build_array(v_new_entry) || v_entries;
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
$function$;
REVOKE ALL ON FUNCTION public.time_entry_create(jsonb, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.time_entry_create(jsonb, text, text) TO service_role;

-- time_entry_patch(text, jsonb, text, text, text, boolean)  (md5 av pg_get_functiondef i drift: 6109ef1b84027e2c32a8ee3c2b47ec10)
CREATE OR REPLACE FUNCTION public.time_entry_patch(p_entry_id text, p_patch jsonb, p_idempotency_key text, p_expected_updated_at text, p_caller_staff_id text, p_caller_can_manage_others boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing     jsonb;
  v_entries      jsonb;
  v_idx          int;
  v_entry        jsonb;
  v_patch        jsonb;
  v_updated      jsonb;
  v_now          timestamptz := clock_timestamp();
  v_now_text     text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_sig          text;
  v_result       jsonb;
  v_scoped_key   text;
  v_fingerprint  text;
  v_caller_valid boolean;
BEGIN
  -- V5-FIX (fråga 1): anroparidentiteten är nu VERKLIGEN obligatorisk —
  -- inget DEFAULT (se ovan) betyder att ett anrop som utelämnar denna
  -- parameter inte matchar funktionen alls (ett rent "function does not
  -- exist"-fel, inte en tyst, osäker genväg). Denna kontroll är ett
  -- ANDRA, oberoende skyddslager mot att NULL/tom sträng ändå skickas in
  -- explicit (t.ex. av en framtida, buggig anropare) — en tom/NULL
  -- identitet behandlas ALLTID som obehörig, aldrig som "ingen särskild
  -- ägare att jämföra mot".
  IF p_caller_staff_id IS NULL OR btrim(p_caller_staff_id) = '' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- V5-FIX (fråga 1, "ogiltiga personal-id nekas"): anroparens staffId
  -- måste faktiskt existera i den riktiga personallistan — en extra,
  -- billig kontroll som gör en felaktigt härledd/förfalskad identitet
  -- overksam även om den råkar vara en icke-tom textsträng.
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      coalesce((SELECT value FROM public.store WHERE key = 'vift_staff'), '[]'::jsonb)
    ) s WHERE s ->> 'id' = p_caller_staff_id
  ) INTO v_caller_valid;
  IF NOT v_caller_valid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- V6-FIX (oberoende granskning, fynd A): en explicit NULL i
  -- `p_caller_can_manage_others` fick tidigare `NOT p_caller_can_manage_others`
  -- att utvärderas till NULL, inte TRUE/FALSE — och `IF NULL THEN ...`
  -- hoppar ALLTID över grenen, precis som `IF false THEN`. Nettoeffekten
  -- var att en NULL-flagga (t.ex. en bugg längre upp i anropskedjan som
  -- glömmer sätta värdet) TYST gav samma utfall som "obehörig åtkomst
  -- nekas INTE" på ägarskapskontrollen nedan, OCH samma tysta utfall som
  -- "stripp INTE ägarskapsfälten" på raden efter — motsatsen till avsedd
  -- fail-closed-design. Normaliseras HÄR, en gång, till en garanterat
  -- icke-NULL boolean — NULL behandlas nu uttryckligen som FALSE (den
  -- MEST restriktiva tolkningen), aldrig som en gräns som tyst öppnas.
  p_caller_can_manage_others := coalesce(p_caller_can_manage_others, false);

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  -- V5-FIX (fråga 2): idempotensnyckeln namnrymds nu PER ANROPARE
  -- (fn_name + anroparens staffId + klientnyckeln) — inte bara per
  -- klientnyckel. En annan användare som (av misstag eller avsiktligt)
  -- återanvänder EXAKT samma klientsträng kan därför ALDRIG få tillbaka
  -- en annan anropares tidigare resultat; de två raderna i
  -- `op_idempotency` är helt disjunkta trots samma `p_idempotency_key`.
  v_scoped_key := p_caller_staff_id || '::' || p_idempotency_key;
  -- Fingeravtryck av de FAKTISKA, betydelsebärande indata — om SAMMA
  -- anropare återanvänder sin egen nyckel men med ett ANNAT entryId/
  -- patch/behörighetsläge denna gång, är det inte en genuin retry av
  -- samma operation (klientbugg eller nyckelkollision) och ska nekas
  -- explicit, aldrig tyst returnera det GAMLA resultatet som om den nya
  -- begäran lyckats.
  v_fingerprint := md5(coalesce(p_entry_id,'') || '|' || coalesce(p_patch::text,'') || '|' ||
                        coalesce(p_expected_updated_at,'') || '|' || p_caller_staff_id || '|' ||
                        p_caller_can_manage_others::text);

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'time_entry_patch' AND idem_key = v_scoped_key;
  IF v_existing IS NOT NULL THEN
    IF (v_existing ->> '_fp') IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'idempotency_key_conflict';
    END IF;
    RETURN v_existing - '_fp';
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

  -- FIX 1/2 (SÄKERHETSBLOCKER): ägarskapskontroll, atomiskt inom samma
  -- radlås som ovan (FOR UPDATE togs redan på hela blobben innan denna
  -- punkt) — ingen separat kontroll/skriv-race möjlig. En post UTAN
  -- staffId (`v_entry->>'staffId'` är NULL) kan aldrig matcha den nu
  -- obligatoriskt icke-tomma `p_caller_staff_id` via IS DISTINCT FROM —
  -- en sådan post kräver därför ALLTID p_caller_can_manage_others=true,
  -- precis som en post som ägs av någon annan.
  IF (v_entry ->> 'staffId') IS DISTINCT FROM p_caller_staff_id
     AND NOT p_caller_can_manage_others THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- FIX 4 (SÄKERHETSBLOCKER): attest-spärren är nu OVILLKORLIG — ingen
  -- patch, oavsett innehåll, kan röra en redan attesterad post. Attest-/
  -- av-attestflödet går ENDAST via time_entry_set_attested() nedan.
  IF (v_entry ->> 'attested')::boolean IS TRUE THEN
    RAISE EXCEPTION 'attested_locked';
  END IF;

  -- FIX 4 (försvar i djup): strippa attestfält på SQL-nivå oavsett vad
  -- Edge Function:en redan strippat.
  v_patch := p_patch - 'attested' - 'attestedAt' - 'attestedBy';

  -- FIX 1/2 (försvar i djup): ägarskapsfält i patchen kräver samma
  -- behörighet som att överhuvudtaget röra en annans post.
  IF NOT p_caller_can_manage_others THEN
    v_patch := v_patch - 'staffId' - 'staffName' - 'registeredById' - 'registeredByName';
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND (v_entry ->> 'createdAt') IS DISTINCT FROM p_expected_updated_at
     AND (v_entry ->> 'updatedAt') IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'stale_write';
  END IF;

  v_updated := (v_entry || v_patch) || jsonb_build_object('updatedAt', to_jsonb(v_now_text));
  v_entries := jsonb_set(v_entries, array[v_idx::text], v_updated);
  UPDATE public.store SET value = v_entries, updated_at = v_now WHERE key = 'vift_timeEntries';

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('timeEntry', v_updated, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('time_entry_patch', v_scoped_key, v_result || jsonb_build_object('_fp', v_fingerprint));

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.time_entry_patch(text, jsonb, text, text, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.time_entry_patch(text, jsonb, text, text, text, boolean) TO service_role;

-- time_entry_soft_delete(text, text, text, boolean)  (md5 av pg_get_functiondef i drift: 5e2cee5ca544a05abf418f266989f967)
CREATE OR REPLACE FUNCTION public.time_entry_soft_delete(p_entry_id text, p_idempotency_key text, p_caller_staff_id text, p_caller_can_manage_others boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing     jsonb;
  v_entries      jsonb;
  v_workorders   jsonb;
  v_ao_idx       int;
  v_ao           jsonb;
  v_idx          int;
  v_entry        jsonb;
  v_now          timestamptz := clock_timestamp();
  v_now_text     text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_sig          text;
  v_result       jsonb;
  v_ao_id        text;
  v_scoped_key   text;
  v_fingerprint  text;
  v_caller_valid boolean;
BEGIN
  -- V5-FIX (fråga 1): se identisk motivering vid time_entry_patch ovan.
  IF p_caller_staff_id IS NULL OR btrim(p_caller_staff_id) = '' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      coalesce((SELECT value FROM public.store WHERE key = 'vift_staff'), '[]'::jsonb)
    ) s WHERE s ->> 'id' = p_caller_staff_id
  ) INTO v_caller_valid;
  IF NOT v_caller_valid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- V6-FIX (fynd A): se identisk motivering vid time_entry_patch ovan.
  p_caller_can_manage_others := coalesce(p_caller_can_manage_others, false);

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  -- V5-FIX (fråga 2): se identisk motivering vid time_entry_patch ovan —
  -- namnrymd per anropare + fingeravtryck av faktiska indata.
  v_scoped_key := p_caller_staff_id || '::' || p_idempotency_key;
  v_fingerprint := md5(coalesce(p_entry_id,'') || '|' || p_caller_staff_id || '|' || p_caller_can_manage_others::text);

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'time_entry_soft_delete' AND idem_key = v_scoped_key;
  IF v_existing IS NOT NULL THEN
    IF (v_existing ->> '_fp') IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'idempotency_key_conflict';
    END IF;
    RETURN v_existing - '_fp';
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
    -- behandla som redan borttagen, inte ett fel. OBS: ägarskapet för
    -- en REDAN BORTTAGEN post går inte att kontrollera (den finns inte
    -- att läsa) — detta grenar INNAN någon mutation sker, så det är
    -- säkert: ingenting skrivs, bara ett "redan klart"-svar returneras.
    v_result := jsonb_build_object('deleted', true, 'alreadyDeleted', true, 'serverSignature', NULL);
    INSERT INTO public.op_idempotency(fn_name, idem_key, result)
      VALUES ('time_entry_soft_delete', v_scoped_key, v_result || jsonb_build_object('_fp', v_fingerprint));
    RETURN v_result;
  END IF;

  v_entry := v_entries -> v_idx;

  -- FIX 1/2 (SÄKERHETSBLOCKER): ägarskapskontroll, atomiskt — samma
  -- mönster som time_entry_patch ovan.
  IF (v_entry ->> 'staffId') IS DISTINCT FROM p_caller_staff_id
     AND NOT p_caller_can_manage_others THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

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
    VALUES ('time_entry_soft_delete', v_scoped_key, v_result || jsonb_build_object('_fp', v_fingerprint));

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.time_entry_soft_delete(text, text, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.time_entry_soft_delete(text, text, text, boolean) TO service_role;

-- time_entry_set_attested(text, boolean, text, text, boolean)  (md5 av pg_get_functiondef i drift: 0cfae35c4d099d09ca40d23bd7e94444)
CREATE OR REPLACE FUNCTION public.time_entry_set_attested(p_entry_id text, p_attested boolean, p_idempotency_key text, p_caller_staff_id text, p_caller_can_attest boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing     jsonb;
  v_entries      jsonb;
  v_idx          int;
  v_entry        jsonb;
  v_updated      jsonb;
  v_now          timestamptz := clock_timestamp();
  v_now_text     text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_sig          text;
  v_result       jsonb;
  v_scoped_key   text;
  v_fingerprint  text;
  v_caller_valid boolean;
BEGIN
  -- V5-FIX (fråga 1): se identisk motivering vid time_entry_patch ovan.
  IF p_caller_staff_id IS NULL OR btrim(p_caller_staff_id) = '' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      coalesce((SELECT value FROM public.store WHERE key = 'vift_staff'), '[]'::jsonb)
    ) s WHERE s ->> 'id' = p_caller_staff_id
  ) INTO v_caller_valid;
  IF NOT v_caller_valid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_idempotency_key IS NULL OR trim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key_required';
  END IF;

  -- V6-FIX (fynd A): se identisk motivering vid time_entry_patch ovan —
  -- NULL normaliseras till FALSE innan den används för att fatta
  -- EXAKT ETT beslut om detta anrop ska tillåtas alls.
  p_caller_can_attest := coalesce(p_caller_can_attest, false);

  -- V6-FIX (fynd A): p_attested är den FAKTISKA attestvärdet som ska
  -- sättas — ett NULL här är en ogiltig, odefinierad begäran (varken
  -- "attestera" eller "av-attestera"), inte ett implicit val av något
  -- slag. Nekas explicit istället för att låta efterföljande
  -- CASE WHEN p_attested-grenar tyst tolka NULL som "falskt" (vilket då
  -- skulle av-attestera en post vid ett anrop som i själva verket var
  -- trasigt/ofullständigt, utan att någon bad om det).
  IF p_attested IS NULL THEN
    RAISE EXCEPTION 'missing_fields';
  END IF;

  -- Enda behörighetsregeln för denna funktion: anroparen måste ha
  -- payroll_manage/all (satt av Edge Function:en från checkViftAuth(),
  -- aldrig från ett klientfält). Ingen ägarskapsbegränsning här — en
  -- löneansvarig attesterar per definition ANDRAS tid.
  IF NOT p_caller_can_attest THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- V5-FIX (fråga 2): se identisk motivering vid time_entry_patch ovan.
  v_scoped_key := p_caller_staff_id || '::' || p_idempotency_key;
  v_fingerprint := md5(coalesce(p_entry_id,'') || '|' || p_attested::text || '|' || p_caller_staff_id);

  SELECT result INTO v_existing FROM public.op_idempotency
    WHERE fn_name = 'time_entry_set_attested' AND idem_key = v_scoped_key;
  IF v_existing IS NOT NULL THEN
    IF (v_existing ->> '_fp') IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'idempotency_key_conflict';
    END IF;
    RETURN v_existing - '_fp';
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

  -- Bevarar ALLA övriga fält/historik på posten oförändrade (`v_entry ||
  -- ...` är en merge, inte en ersättning) — endast attest-relaterade
  -- fält + updatedAt rörs, exakt det kravet "bevara tidigare
  -- attesteringsstatus och historik" efterfrågar.
  v_updated := v_entry || jsonb_build_object(
    'attested',   p_attested,
    'attestedAt', CASE WHEN p_attested THEN to_jsonb(v_now_text) ELSE to_jsonb(''::text) END,
    'attestedBy', CASE WHEN p_attested THEN to_jsonb(p_caller_staff_id) ELSE to_jsonb(''::text) END,
    'updatedAt',  to_jsonb(v_now_text)
  );
  v_entries := jsonb_set(v_entries, array[v_idx::text], v_updated);
  UPDATE public.store SET value = v_entries, updated_at = v_now WHERE key = 'vift_timeEntries';

  v_sig := v_now_text;
  INSERT INTO public.store(key, value) VALUES ('vift_lastChanged', to_jsonb(v_sig))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('timeEntry', v_updated, 'serverSignature', v_sig);
  INSERT INTO public.op_idempotency(fn_name, idem_key, result)
    VALUES ('time_entry_set_attested', v_scoped_key, v_result || jsonb_build_object('_fp', v_fingerprint));

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.time_entry_set_attested(text, boolean, text, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.time_entry_set_attested(text, boolean, text, text, boolean) TO service_role;

commit;
