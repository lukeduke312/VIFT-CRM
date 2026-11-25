-- ============================================================
-- ÅTERSTÄLLD 2026-11-27 ur STAGING:s migrationshistorik (G1/G4 del 2).
-- Källa: supabase_migrations.schema_migrations, version 20261018000001, i STAGING
-- (yyzljlqyzzcbxmcdbual). Allt efter markören INNEHÅLL nedan, fram till
-- den avslutande raden ";", är EXAKT array_to_string(statements, E';\n')
-- (md5 cc8564cdde977e85267e84e54714b46e, samma fil som
-- inventering/staging-2026-11-26/migrations-applicerade/20261018000001_rondering_pass_atomic_rpc.sql).
-- Supabase CLI sparar statements utan avslutande semikolon; ett ";" har
-- därför lagts till sist. Ingen annan ändring.
-- ============================================================
-- INNEHÅLL
-- ============================================================
-- Migration: Atomiska RPC:er för vift_ronderingspass
-- Datum:     2026-10-18 (P0 PART B — RONDERINGSPASS R1)
-- Syfte:     Eliminera det verifierade "läs hela ronderingspass-arrayen,
--            ändra ett objekt i minnet, skriv hela arrayen tillbaka"-
--            racet mellan SAMTIDIGA klienter (t.ex. två inspektörer som
--            kryssar OLIKA checklistpunkter på SAMMA ronderingspass
--            under en pågående rondering, eller en inspektör som sparar
--            en anteckning samtidigt som en annan slutför passet) utan
--            en mellanliggande poll. Detta är EXAKT samma generella
--            buggklass som redan åtgärdats smalt för
--            vift_projectDocuments (20260908000001/2) och
--            vift_workOrders-checklistan (20260917000001) — samma
--            arkitekturmönster återanvänds rakt av:
--              1. `SELECT ... FOR UPDATE` på EXAKT den `store`-rad som
--                 behövs, inom EN transaktion (ett RPC-anrop).
--              2. Leta upp posten via STABIL id (pass-id, kategori-id,
--                 punkt-id) — ALDRIG array-index, som kan ha skiftat
--                 mellan klientens senaste poll och nu.
--              3. Mergea patchen mot den LÅSTA, FÄRSKASTE server-raden
--                 — ALDRIG mot klientens egen, potentiellt inaktuella
--                 fulla PASS-kopia.
--              4. SECURITY DEFINER + REVOKE/GRANT: endast `service_role`
--                 (den nya Edge Function:en, se
--                 supabase/functions/rondering-pass-write/) kan anropa
--                 dessa funktioner.
--              5. `vift_lastChanged` bumpas INOM SAMMA transaktion (R2-
--                 lärdomen från 20260908000002 §Blockerare 1 — annars
--                 missar andra klienters DataSync._poll() ändringen).
--
--            Narrow, syftesspecifika funktioner (INTE en generisk
--            "patcha vad som helst"-RPC) — matchar etablerad stil i
--            work_order_checklist_resolve snarare än ett fritt
--            jsonb-merge-kontrakt, för att undvika en ny generisk
--            skrivyta som skulle kunna missbrukas för att sätta fält
--            klienten inte borde kunna sätta (t.ex. completedBy/status
--            vid slutförande).
--
--            Server-sidig invariant: summary (total/ok/anmärkningar/
--            ejKontrollerad/ejAktuell) räknas ALLTID om från den
--            FAKTISKA, låsta categories-strukturen efter varje mutation
--            — klienten kan aldrig skicka in ett avvikande summary-värde.
--
--            INGEN idempotency-nyckeltabell behövs för punkt-/pass-
--            patcharna: att återsända SAMMA punktstatus eller SAMMA
--            anteckning är redan naturligt idempotent (samma slutresultat,
--            ingen räknare som dubbelökar). För BULK-skapande
--            (rondering_passes_bulk_create) är dedupe mot (ronderingId,
--            scheduledDate, !migratedFromLegacy) SERVER-SIDIGT inom
--            låset — det gör även en nätverksretry av HELA
--            batch-anropet säker, utan separat idempotency-tabell.
--            För enstaka rondering_pass_create (en explicit ny bokning)
--            finns AVSIKTLIGT ingen sådan dedupe — en användare kan
--            legitimt boka två tillfällen samma dag — men id:t
--            genereras nu SERVER-SIDIGT under låset (näst-lediga
--            PASS-NNN), vilket eliminerar den tidigare klient-sidiga
--            `newId()`-race (två samtidiga skapanden som båda läser
--            samma "max" och båda försöker skapa PASS-007).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.rondering_point_patch(text,text,text,text,text,text,text,text,boolean);
--   DROP FUNCTION IF EXISTS public.rondering_pass_save_note(text,text);
--   DROP FUNCTION IF EXISTS public.rondering_pass_auto_start(text);
--   DROP FUNCTION IF EXISTS public.rondering_pass_complete(text,text);
--   DROP FUNCTION IF EXISTS public.rondering_pass_create(jsonb);
--   DROP FUNCTION IF EXISTS public.rondering_passes_bulk_create(text,jsonb);
--   DROP FUNCTION IF EXISTS public.rondering_pass_migrate_legacy(jsonb);
--   DROP FUNCTION IF EXISTS public._rondering_recompute_summary(jsonb);
-- ============================================================

-- ── Hjälpfunktion: räkna om summary från categories/points ──────────
-- Ingen tabellåtkomst — ren jsonb-beräkning. Säker att anropa från
-- SECURITY DEFINER-funktionerna nedan; ingen särskild behörighet krävs.
create or replace function public._rondering_recompute_summary(p_categories jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_total int := 0;
  v_ok int := 0;
  v_anm int := 0;
  v_ejk int := 0;
  v_eja int := 0;
  v_cat jsonb;
  v_pt jsonb;
  v_status text;
begin
  for v_cat in select * from jsonb_array_elements(coalesce(p_categories, '[]'::jsonb))
  loop
    for v_pt in select * from jsonb_array_elements(coalesce(v_cat -> 'points', '[]'::jsonb))
    loop
      v_total := v_total + 1;
      v_status := v_pt ->> 'status';
      if v_status = 'ok' then v_ok := v_ok + 1;
      elsif v_status = 'anmärkning' then v_anm := v_anm + 1;
      elsif v_status = 'ej_kontrollerad' then v_ejk := v_ejk + 1;
      elsif v_status = 'ej_aktuell' then v_eja := v_eja + 1;
      end if;
    end loop;
  end loop;
  return jsonb_build_object(
    'total', v_total, 'ok', v_ok, 'anmärkningar', v_anm,
    'ejKontrollerad', v_ejk, 'ejAktuell', v_eja
  );
end;
$$;
-- ── rondering_point_patch — kärnoperationen: en checklistpunkt ───────
-- Täcker RonderingUtforandePage._setPointStatus() (p_is_reset=false)
-- OCH .undoPt() (p_is_reset=true).
create or replace function public.rondering_point_patch(
  p_pass_id          text,
  p_category_id      text,
  p_point_id         text,
  p_status           text,     -- '', 'ok', 'anmärkning', 'ej_aktuell', 'ej_kontrollerad'
  p_comment          text,
  p_deviation_id     text,     -- nullable
  p_work_order_id    text,     -- nullable
  p_caller_staff_id  text,     -- server-härlett av EF från JWT — aldrig klient-inskickat
  p_is_reset         boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passes      jsonb;
  v_pass_idx    int;
  v_pass        jsonb;
  v_cats        jsonb;
  v_cat_idx     int;
  v_cat         jsonb;
  v_pts         jsonb;
  v_pt_idx      int;
  v_pt          jsonb;
  v_updated_pt  jsonb;
  v_now         timestamptz := clock_timestamp();
  v_now_text    text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if not p_is_reset and p_status not in ('ok', 'anmärkning', 'ej_aktuell', 'ej_kontrollerad') then
    raise exception 'invalid_status';
  end if;

  -- ── 1) Lås EXAKT vift_ronderingspass-raden ────────────────────────
  select value into v_passes from public.store where key = 'vift_ronderingspass' for update;
  if v_passes is null or jsonb_typeof(v_passes) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1) into v_pass_idx
    from jsonb_array_elements(v_passes) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_pass_id
    limit 1;
  if v_pass_idx is null then
    raise exception 'not_found';
  end if;
  v_pass := v_passes -> v_pass_idx;

  -- ── 2) Hitta kategori via stabil id ───────────────────────────────
  v_cats := coalesce(v_pass -> 'categories', '[]'::jsonb);
  select (ord - 1) into v_cat_idx
    from jsonb_array_elements(v_cats) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_category_id
    limit 1;
  if v_cat_idx is null then
    raise exception 'category_not_found';
  end if;
  v_cat := v_cats -> v_cat_idx;

  -- ── 3) Hitta punkt via stabil id ───────────────────────────────────
  v_pts := coalesce(v_cat -> 'points', '[]'::jsonb);
  select (ord - 1) into v_pt_idx
    from jsonb_array_elements(v_pts) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_point_id
    limit 1;
  if v_pt_idx is null then
    raise exception 'point_not_found';
  end if;
  v_pt := v_pts -> v_pt_idx;

  -- ── 4) Beräkna punktens nya tillstånd — SAMMA semantik som
  --      klientens _setPointStatus()/undoPt() (oförändrad). ──────────
  if p_is_reset then
    v_updated_pt := v_pt || jsonb_build_object(
      'status', '', 'comment', '', 'deviationId', null,
      'workOrderId', null, 'checkedAt', null, 'checkedBy', null
    );
  else
    v_updated_pt := v_pt || jsonb_build_object(
      'status', p_status,
      'comment', coalesce(p_comment, ''),
      'checkedAt', v_now_text,
      'checkedBy', p_caller_staff_id
    );
    if p_deviation_id is not null then
      v_updated_pt := v_updated_pt || jsonb_build_object('deviationId', p_deviation_id);
    end if;
    if p_work_order_id is not null then
      v_updated_pt := v_updated_pt || jsonb_build_object('workOrderId', p_work_order_id);
    end if;
  end if;

  v_pts := jsonb_set(v_pts, array[v_pt_idx::text], v_updated_pt);
  v_cat := jsonb_set(v_cat, array['points'], v_pts);
  v_cats := jsonb_set(v_cats, array[v_cat_idx::text], v_cat);
  v_pass := jsonb_set(v_pass, array['categories'], v_cats);

  -- ── 5) Räkna om summary FRÅN den faktiska, låsta strukturen ───────
  v_pass := jsonb_set(v_pass, array['summary'], public._rondering_recompute_summary(v_cats));

  -- ── 6) Auto-start — SAMMA regel som klientens _setPointStatus()
  --      (oförändrad semantik): endast vid en ÄKTA statusändring
  --      (inte reset/undo), och endast från 'planerat'. Läses här från
  --      den LÅSTA raden — två samtidiga klienter kan omöjligen båda se
  --      "fortfarande planerat" och båda trigga en övergång. ─────────
  if not p_is_reset and (v_pass ->> 'status') = 'planerat' then
    v_pass := v_pass || jsonb_build_object('status', 'pågående');
    if coalesce(v_pass ->> 'startedAt', '') = '' then
      v_pass := v_pass || jsonb_build_object('startedAt', v_now_text);
    end if;
  end if;

  v_pass := v_pass || jsonb_build_object('updatedAt', v_now_text);
  v_passes := jsonb_set(v_passes, array[v_pass_idx::text], v_pass);
  update public.store set value = v_passes, updated_at = v_now where key = 'vift_ronderingspass';

  -- ── 7) Bumpa DataSync-synksignalen INOM SAMMA transaktion ─────────
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('pass', v_pass, 'serverSignature', v_now_text);
end;
$$;
-- ── rondering_pass_save_note — RonderingUtforandePage._saveNote() ───
create or replace function public.rondering_pass_save_note(
  p_pass_id text,
  p_note    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passes   jsonb;
  v_idx      int;
  v_pass     jsonb;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into v_passes from public.store where key = 'vift_ronderingspass' for update;
  if v_passes is null or jsonb_typeof(v_passes) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1) into v_idx
    from jsonb_array_elements(v_passes) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_pass_id
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;

  v_pass := (v_passes -> v_idx) || jsonb_build_object(
    'internalNote', coalesce(p_note, ''), 'updatedAt', v_now_text
  );
  v_passes := jsonb_set(v_passes, array[v_idx::text], v_pass);
  update public.store set value = v_passes, updated_at = v_now where key = 'vift_ronderingspass';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('pass', v_pass, 'serverSignature', v_now_text);
end;
$$;
-- ── rondering_pass_auto_start — RonderingUtforandePage.render() ─────
-- Idempotent no-op om passet redan är startat/avslutat.
create or replace function public.rondering_pass_auto_start(
  p_pass_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passes   jsonb;
  v_idx      int;
  v_pass     jsonb;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into v_passes from public.store where key = 'vift_ronderingspass' for update;
  if v_passes is null or jsonb_typeof(v_passes) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1) into v_idx
    from jsonb_array_elements(v_passes) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_pass_id
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;

  v_pass := v_passes -> v_idx;
  if (v_pass ->> 'status') = 'planerat' then
    v_pass := v_pass || jsonb_build_object('status', 'pågående', 'updatedAt', v_now_text);
    if coalesce(v_pass ->> 'startedAt', '') = '' then
      v_pass := v_pass || jsonb_build_object('startedAt', v_now_text);
    end if;
    v_passes := jsonb_set(v_passes, array[v_idx::text], v_pass);
    update public.store set value = v_passes, updated_at = v_now where key = 'vift_ronderingspass';
    insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
      on conflict (key) do update set value = excluded.value, updated_at = v_now;
  end if;

  return jsonb_build_object('pass', v_pass, 'serverSignature', v_now_text);
end;
$$;
-- ── rondering_pass_complete — RonderingUtforandePage.complete() ─────
-- Status (slutfört / har_avvikelser) beslutas HÄR, av den omräknade
-- summary:n — klienten skickar INGEN status/completedBy; detta
-- eliminerar möjligheten att en klient (bugg eller manipulerat REST-
-- anrop) rapporterar fel slutstatus eller falsk completedBy-identitet.
create or replace function public.rondering_pass_complete(
  p_pass_id         text,
  p_caller_staff_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passes   jsonb;
  v_idx      int;
  v_pass     jsonb;
  v_summary  jsonb;
  v_status   text;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into v_passes from public.store where key = 'vift_ronderingspass' for update;
  if v_passes is null or jsonb_typeof(v_passes) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1) into v_idx
    from jsonb_array_elements(v_passes) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_pass_id
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;

  v_pass := v_passes -> v_idx;
  v_summary := public._rondering_recompute_summary(v_pass -> 'categories');
  v_status := case when coalesce((v_summary ->> 'anmärkningar')::int, 0) > 0
                    then 'har_avvikelser' else 'slutfört' end;

  v_pass := v_pass || jsonb_build_object(
    'summary', v_summary,
    'status', v_status,
    'completedAt', v_now_text,
    'completedBy', p_caller_staff_id,
    'updatedAt', v_now_text
  );
  v_passes := jsonb_set(v_passes, array[v_idx::text], v_pass);
  update public.store set value = v_passes, updated_at = v_now where key = 'vift_ronderingspass';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('pass', v_pass, 'serverSignature', v_now_text);
end;
$$;
-- ── rondering_pass_create — enstaka ny bokning (RonderingPage /
--    RonderingUtforandePage auto-create-if-missing). id/sequenceNumber
--    genereras SERVER-SIDIGT under låset — ingen klient-sidig
--    newId()-race. ──────────────────────────────────────────────────
create or replace function public.rondering_pass_create(
  p_pass_template jsonb   -- allt UTOM id/sequenceNumber/createdAt/updatedAt/summary
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passes      jsonb;
  v_rondering_id text := p_pass_template ->> 'ronderingId';
  v_max_num     int := 0;
  v_seq         int := 0;
  v_elem        jsonb;
  v_num         int;
  v_new_id      text;
  v_now         timestamptz := clock_timestamp();
  v_now_text    text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_new_pass    jsonb;
begin
  insert into public.store(key, value) values ('vift_ronderingspass', '[]'::jsonb)
    on conflict (key) do nothing;

  select value into v_passes from public.store where key = 'vift_ronderingspass' for update;
  if v_passes is null or jsonb_typeof(v_passes) <> 'array' then
    v_passes := '[]'::jsonb;
  end if;

  for v_elem in select * from jsonb_array_elements(v_passes) loop
    v_num := nullif(regexp_replace(coalesce(v_elem ->> 'id', ''), '[^0-9]', '', 'g'), '')::int;
    if v_num is not null and v_num > v_max_num then v_max_num := v_num; end if;
    if (v_elem ->> 'ronderingId') = v_rondering_id then v_seq := v_seq + 1; end if;
  end loop;

  v_new_id := 'PASS-' || lpad((v_max_num + 1)::text, 3, '0');

  v_new_pass := p_pass_template || jsonb_build_object(
    'id', v_new_id,
    'sequenceNumber', v_seq + 1,
    'status', coalesce(p_pass_template ->> 'status', 'planerat'),
    'summary', public._rondering_recompute_summary(p_pass_template -> 'categories'),
    'createdAt', v_now_text,
    'updatedAt', v_now_text
  );

  v_passes := v_passes || jsonb_build_array(v_new_pass);
  update public.store set value = v_passes, updated_at = v_now where key = 'vift_ronderingspass';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('pass', v_new_pass, 'serverSignature', v_now_text);
end;
$$;
-- ── rondering_passes_bulk_create — RonderingService.generatePassesFromRecurring() ──
-- p_candidates: jsonb-array av pass-mallar (samma form som till
-- rondering_pass_create, men UTAN id). Server-sidig dedupe mot
-- (ronderingId, scheduledDate, !migratedFromLegacy) — gör HELA
-- batch-anropet säkert att återsända (t.ex. efter ett nätverksavbrott
-- där klienten inte fick svaret) utan att skapa dubbletter, och
-- skyddar även mot två ADMINISTRATÖRER som samtidigt trycker
-- "generera tillfällen" för samma rondering.
create or replace function public.rondering_passes_bulk_create(
  p_rondering_id text,
  p_candidates   jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passes    jsonb;
  v_max_num   int := 0;
  v_seq       int := 0;
  v_elem      jsonb;
  v_num       int;
  v_cand      jsonb;
  v_exists    boolean;
  v_new_id    text;
  v_new_pass  jsonb;
  v_created   jsonb := '[]'::jsonb;
  v_created_count int := 0;
  v_skipped_count int := 0;
  v_now       timestamptz := clock_timestamp();
  v_now_text  text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  insert into public.store(key, value) values ('vift_ronderingspass', '[]'::jsonb)
    on conflict (key) do nothing;

  select value into v_passes from public.store where key = 'vift_ronderingspass' for update;
  if v_passes is null or jsonb_typeof(v_passes) <> 'array' then
    v_passes := '[]'::jsonb;
  end if;

  for v_elem in select * from jsonb_array_elements(v_passes) loop
    v_num := nullif(regexp_replace(coalesce(v_elem ->> 'id', ''), '[^0-9]', '', 'g'), '')::int;
    if v_num is not null and v_num > v_max_num then v_max_num := v_num; end if;
    if (v_elem ->> 'ronderingId') = p_rondering_id then v_seq := v_seq + 1; end if;
  end loop;

  for v_cand in select * from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) loop
    -- Dedupe: redan existerande rader i v_passes (inkl. de som skapas
    -- tidigare I SAMMA anrop, eftersom vi appendar till v_passes nedan).
    select exists(
      select 1 from jsonb_array_elements(v_passes) t(elem)
      where (elem ->> 'ronderingId') = p_rondering_id
        and (elem ->> 'scheduledDate') = (v_cand ->> 'scheduledDate')
        and coalesce((elem ->> 'migratedFromLegacy')::boolean, false) = false
    ) into v_exists;

    if v_exists then
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;

    v_max_num := v_max_num + 1;
    v_seq := v_seq + 1;
    v_new_id := 'PASS-' || lpad(v_max_num::text, 3, '0');
    v_new_pass := v_cand || jsonb_build_object(
      'id', v_new_id,
      'ronderingId', p_rondering_id,
      'sequenceNumber', v_seq,
      'status', coalesce(v_cand ->> 'status', 'planerat'),
      'summary', public._rondering_recompute_summary(v_cand -> 'categories'),
      'createdAt', v_now_text,
      'updatedAt', v_now_text
    );
    v_passes := v_passes || jsonb_build_array(v_new_pass);
    v_created := v_created || jsonb_build_array(v_new_pass);
    v_created_count := v_created_count + 1;
  end loop;

  if v_created_count > 0 then
    update public.store set value = v_passes, updated_at = v_now where key = 'vift_ronderingspass';
    insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
      on conflict (key) do update set value = excluded.value, updated_at = v_now;
  end if;

  return jsonb_build_object(
    'created', v_created, 'createdCount', v_created_count,
    'skippedCount', v_skipped_count, 'serverSignature', v_now_text
  );
end;
$$;
-- ── rondering_pass_migrate_legacy — state.js initState()'s one-time
--    RON.results[] → ronderingspass backfill (client-supplied
--    DETERMINISTIC id 'PASS-MIG-<ronderingId>', unlike the other create
--    RPCs above). Idempotent by id: a second device racing the SAME
--    migration (or a page reload before the first write is visible)
--    gets back the ALREADY-migrated row, never a duplicate. This is the
--    one narrow case where a client-supplied id is accepted, precisely
--    because it is derived deterministically from already-immutable
--    historical data (a completed legacy rondering), not from a
--    sequence a concurrent writer could also be incrementing. ─────────
create or replace function public.rondering_pass_migrate_legacy(
  p_pass jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_passes   jsonb;
  v_id       text := p_pass ->> 'id';
  v_existing jsonb;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if coalesce(v_id, '') = '' then
    raise exception 'missing_id';
  end if;

  insert into public.store(key, value) values ('vift_ronderingspass', '[]'::jsonb)
    on conflict (key) do nothing;

  select value into v_passes from public.store where key = 'vift_ronderingspass' for update;
  if v_passes is null or jsonb_typeof(v_passes) <> 'array' then
    v_passes := '[]'::jsonb;
  end if;

  select elem into v_existing from jsonb_array_elements(v_passes) elem where elem ->> 'id' = v_id limit 1;
  if v_existing is not null then
    return jsonb_build_object('pass', v_existing, 'created', false);
  end if;

  v_passes := v_passes || jsonb_build_array(p_pass || jsonb_build_object('updatedAt', v_now_text));
  update public.store set value = v_passes, updated_at = v_now where key = 'vift_ronderingspass';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('pass', p_pass, 'created', true, 'serverSignature', v_now_text);
end;
$$;
-- ── Behörigheter: ENDAST service_role (samma princip som övriga atomiska RPC:er) ──
revoke all on function public.rondering_point_patch(text,text,text,text,text,text,text,text,boolean)
  from public, anon, authenticated;
revoke all on function public.rondering_pass_save_note(text,text)
  from public, anon, authenticated;
revoke all on function public.rondering_pass_auto_start(text)
  from public, anon, authenticated;
revoke all on function public.rondering_pass_complete(text,text)
  from public, anon, authenticated;
revoke all on function public.rondering_pass_create(jsonb)
  from public, anon, authenticated;
revoke all on function public.rondering_passes_bulk_create(text,jsonb)
  from public, anon, authenticated;
revoke all on function public.rondering_pass_migrate_legacy(jsonb)
  from public, anon, authenticated;
grant execute on function public.rondering_point_patch(text,text,text,text,text,text,text,text,boolean)
  to service_role;
grant execute on function public.rondering_pass_migrate_legacy(jsonb)
  to service_role;
grant execute on function public.rondering_pass_save_note(text,text)
  to service_role;
grant execute on function public.rondering_pass_auto_start(text)
  to service_role;
grant execute on function public.rondering_pass_complete(text,text)
  to service_role;
grant execute on function public.rondering_pass_create(jsonb)
  to service_role;
grant execute on function public.rondering_passes_bulk_create(text,jsonb)
  to service_role;
-- ── Verifiering (körs manuellt efter migrering) ──────────────────────
-- SELECT proname, proacl FROM pg_proc
--   WHERE proname LIKE 'rondering_%' OR proname = '_rondering_recompute_summary';
-- Förväntat: EXECUTE endast beviljat till service_role för alla utom
-- _rondering_recompute_summary (ren jsonb-hjälpfunktion, ingen
-- tabellåtkomst, ofarlig att lämna öppen — men anropas ändå aldrig
-- direkt av klienten eftersom ingen Edge Function exponerar den).
;
