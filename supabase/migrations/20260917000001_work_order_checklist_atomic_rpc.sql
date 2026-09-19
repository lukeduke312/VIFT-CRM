-- ============================================================
-- Migration: Atomisk RPC för AO-checklista → auto-start
-- Datum:     2026-09-17 (AO CHECKLIST AUTO-START R1.2)
-- Syfte:     Eliminera det verifierade "läs hela workOrders-arrayen,
--            ändra, skriv hela arrayen"-racet mellan SAMTIDIGA klienter
--            som löser OLIKA checklistpunkter på SAMMA arbetsorder utan
--            en mellanliggande DataSync-poll. Två sådana klienter kunde
--            tidigare tyst radera varandras checkliständring ("sista
--            skrivaren vinner" på en HEL array) — se
--            RAPPORT-AO-CHECKLIST-AUTOSTART-R1.1.md §3 för den fulla
--            spårningen av varför detta är samma generella klass av
--            problem som redan löstes NARROWLY för
--            vift_projectDocuments i 20260908000001/20260908000002.
--
--            Samma arkitekturmönster återanvänds rakt av:
--              1. `SELECT ... FOR UPDATE` på EXAKT den `store`-rad som
--                 behövs, inom EN transaktion (ett RPC-anrop).
--              2. Leta upp posten via STABIL ID (AO-id, checklistpunkt-
--                 id) — ALDRIG array-index, som kan ha skiftat mellan
--                 klientens senaste poll och nu.
--              3. Mergea patchen mot den LÅSTA, FÄRSKASTE server-raden
--                 — ALDRIG mot klientens egen, potentiellt inaktuella
--                 fulla AO-kopia.
--              4. SECURITY DEFINER + REVOKE/GRANT: endast `service_role`
--                 (dvs den nya Edge Function:en, se
--                 supabase/functions/work-order-checklist-resolve/)
--                 kan anropa denna funktion. En autentiserad klient som
--                 försöker anropa RPC:en direkt (utanför Edge Function:en,
--                 t.ex. via ett manipulerat REST-anrop) nekas helt av
--                 Postgres — INTE bara av applikationslogik.
--
--            MEDVETET UTELÄMNAT jämfört med projectDocuments-mönstret:
--            INGA nya RESTRICTIVE-policyer läggs till på `vift_workOrders`
--            eller `vift_activityLog` i denna migration. Till skillnad
--            från `vift_projectDocuments` (som i sin helhet flyttades
--            bort från den generiska skrivvägen 2026-09-08) förblir
--            `vift_workOrders`/`vift_activityLog` den GENERISKA
--            skrivvägen för MÅNGA ANDRA, obesläktade AO-/aktivitets-
--            mutationer (titel, personal, prissättning, tid, m.fl.) som
--            INTE ingår i detta uppdrag — att blockera direkt klient-
--            skrivning av dessa nycklar skulle ha slagit sönder alla de
--            mutationerna. Detta är samma medvetna, redan dokumenterade
--            avgränsning som CLAUDE.md/migration 20260720000005 själva
--            beskriver under "Kvarvarande kända risker" (§1: "Tekniker
--            kan potentiellt skriva vift_workOrders direkt via REST" —
--            en känd, accepterad begränsning av den generiska blob-
--            modellen, inte något denna leverans kan eller ska lösa i
--            sin helhet). Skyddet denna migration ger är: (a) EXAKT
--            checklista/status-övergången blir atomisk och race-fri SÅ
--            LÄNGE båda klienterna använder denna nya väg (vilket
--            frontend-ändringen i samma release gör för just denna
--            operation), och (b) själva RPC-anropet är obehörigt-
--            oåtkomligt (endast service_role).
--
--            R1.3 (samma dag, final hardening — 3 punktinsatser, ingen
--            arkitekturändring): (1) ownership-kontrollen fail-closed:ad
--            mot en saknad/felformad `staff`-egenskap (se steg 2 nedan);
--            (2) RETURN-värdet utökat till att alltid innehålla den
--            FAKTISKA kanoniska `activityLog`-arrayen (inte bara AO:n),
--            så att ingen klient — särskilt den ANDRA av två samtidiga
--            anropare — kan råka radera en redan skapad starthändelse
--            via en efterföljande generisk persist() (se steg 6/8);
--            (3) starthändelsens `userId` sätts nu till den server-
--            verifierade `p_caller_staff_id` istället för en tom sträng.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.work_order_checklist_resolve(
--     text, text, text, text, text, boolean, text, text
--   );
-- ============================================================

create or replace function public.work_order_checklist_resolve(
  p_ao_id                text,     -- vilken arbetsorder
  p_item_id               text,     -- vilken checklistpunkt (STABIL id, ej index)
  p_avvikelse             text,     -- 'ok' | 'avvikelse' | NULL (återöppna/rensa)
  p_avvikelse_comment     text,     -- obligatorisk kommentar, endast vid p_avvikelse='avvikelse'
  p_actor_name            text,     -- härlett SERVER-SIDIGT av Edge Function från JWT-identiteten
  p_caller_can_view_all   boolean,  -- härlett server-sidigt: ao_view_all ELLER 'all'
  p_caller_staff_id       text,     -- härlett server-sidigt: anroparens EGET staff-id
  p_avvikelse_image       text default null  -- valfri bild (data-URL), endast vid p_avvikelse='avvikelse'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workorders   jsonb;
  v_ao_idx       int;
  v_ao           jsonb;
  v_checklist    jsonb;
  v_item_idx     int;
  v_item         jsonb;
  v_updated_item jsonb;
  v_new_status   text;
  v_current_status text;
  v_should_start boolean := false;
  v_updated_ao   jsonb;
  v_now          timestamptz := clock_timestamp();
  v_now_text     text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_activity_log jsonb;
  v_new_activity jsonb;
  v_actlog_id    text;
begin
  if p_avvikelse is not null and p_avvikelse not in ('ok', 'avvikelse') then
    raise exception 'invalid_avvikelse';
  end if;
  if p_avvikelse = 'avvikelse' and coalesce(trim(p_avvikelse_comment), '') = '' then
    raise exception 'comment_required';
  end if;

  -- ── 1) Lås EXAKT vift_workOrders-raden (deterministisk låsordning:
  --      workOrders FÖRE activityLog, se filhuvudet). ────────────────
  select value into v_workorders from public.store where key = 'vift_workOrders' for update;
  if v_workorders is null or jsonb_typeof(v_workorders) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1) into v_ao_idx
    from jsonb_array_elements(v_workorders) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_ao_id
    limit 1;
  if v_ao_idx is null then
    raise exception 'not_found';
  end if;

  v_ao := v_workorders -> v_ao_idx;
  v_current_status := v_ao ->> 'status';

  -- ── 2) Behörighet/tilldelning — SAMMA regel som klientens EGEN
  --      ownership-spärr (WorkOrderDetailPage.render(), oförändrad):
  --      ao_view_all/all ELLER (anroparen finns i ao.staff ELLER
  --      AO:n ligger i den delade poolen). Kontrolleras HÄR, mot den
  --      just LÅSTA, färskaste raden — ingen TOCTOU-lucka mot en
  --      tidigare, separat läsning.
  --      R1.3 BLOCKERARE 3 (fail-closed): `v_ao -> 'staff'` är SQL NULL
  --      om fältet helt saknas på en legacy/felformad AO-post — och
  --      `NULL ? p_caller_staff_id` utvärderas då till NULL, inte
  --      false. Ett `if not (NULL)` i PL/pgSQL är `if not NULL`, vilket
  --      ALDRIG är sant — grenen skulle då TYST HOPPAS ÖVER och
  --      anropet tillåtas fel-öppet. `coalesce(v_ao -> 'staff', '[]')`
  --      gör motsvarigheten till klientens egen, redan etablerade regel
  --      EXAKT: `(ao.staff || []).includes(myId)` — saknad `staff`
  --      tolkas som en TOM lista (`[]`), aldrig som "tillåt alla". */
  if not p_caller_can_view_all then
    if not (coalesce(v_ao -> 'staff', '[]'::jsonb) ? p_caller_staff_id) and v_current_status <> 'pool' then
      raise exception 'forbidden';
    end if;
  end if;

  -- ── 3) Hitta checklistpunkten via STABIL id ──────────────────────
  v_checklist := coalesce(v_ao -> 'checklist', '[]'::jsonb);
  select (ord - 1) into v_item_idx
    from jsonb_array_elements(v_checklist) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_item_id
    limit 1;
  if v_item_idx is null then
    raise exception 'item_not_found';
  end if;
  v_item := v_checklist -> v_item_idx;

  -- ── 4) Beräkna punktens nya tillstånd — SAMMA semantik som
  --      klientens setAvvikelse()/_openAvvikelseModal() (R1/R1.1,
  --      oförändrad): 'ok' -> done=true; 'avvikelse' -> done=false +
  --      kommentar/tidpunkt/utförare; NULL -> återöppna/rensa. ──────
  if p_avvikelse = 'ok' then
    v_updated_item := v_item
      || jsonb_build_object('avvikelse', 'ok', 'done', true,
                             'avvikelseComment', '', 'avvikelseAt', '', 'avvikelseBy', '');
  elsif p_avvikelse = 'avvikelse' then
    v_updated_item := v_item
      || jsonb_build_object('avvikelse', 'avvikelse', 'done', false,
                             'avvikelseComment', p_avvikelse_comment,
                             'avvikelseAt', v_now_text, 'avvikelseBy', p_actor_name);
    if p_avvikelse_image is not null and p_avvikelse_image <> '' then
      v_updated_item := v_updated_item || jsonb_build_object('avvikelseImage', p_avvikelse_image);
    end if;
  else
    v_updated_item := v_item
      || jsonb_build_object('avvikelse', null, 'done', false,
                             'avvikelseComment', '', 'avvikelseAt', '', 'avvikelseBy', '');
  end if;

  v_checklist := jsonb_set(v_checklist, array[v_item_idx::text], v_updated_item);

  -- ── 5) Auto-start — SAMMA regel som WorkOrderService.
  --      autoStartFromChecklist() (R1/R1.1, oförändrad semantik):
  --      endast vid ÖVERGÅNG till ett löst tillstånd (p_avvikelse IS
  --      NOT NULL), och ENDAST från ett legitimt ostartat läge. Läses
  --      här från den LÅSTA raden — aldrig från klientens påstådda
  --      status — så två samtidiga klienter kan omöjligen båda se
  --      "fortfarande ostartad" och båda trigga en övergång. ────────
  if p_avvikelse is not null and v_current_status in ('nytt', 'pool', 'planerad') then
    v_new_status := 'pågående';
    v_should_start := true;
  else
    v_new_status := v_current_status;
  end if;

  v_updated_ao := v_ao
    || jsonb_build_object('checklist', v_checklist, 'status', v_new_status, 'updatedAt', v_now_text);
  v_workorders := jsonb_set(v_workorders, array[v_ao_idx::text], v_updated_ao);
  update public.store set value = v_workorders, updated_at = v_now where key = 'vift_workOrders';

  -- ── 6) Exakt EN kanonisk starthändelse — samma format som
  --      ActivityService.log('work_order_status', ...) redan
  --      producerar klient-sidigt (R1/R1.1), så befintlig UI-kod som
  --      läser state.activityLog fungerar oförändrat. Låses/uppdateras
  --      EFTER vift_workOrders, i samma transaktion (deterministisk
  --      låsordning — se filhuvudet).
  --      R1.3 BLOCKERARE 2: `v_activity_log` läses ALLTID (inte bara när
  --      v_should_start), eftersom RETURN-värdet (se steg 8) alltid
  --      måste innehålla den FAKTISKA kanoniska aktivitetsloggen —
  --      annars kan en andra, samtidig klient (som själv INTE skapade
  --      någon starthändelse, eftersom den redan hade skapats av den
  --      FÖRSTA klientens transaktion) fortsätta med en LOKALT
  --      inaktuell activityLog och senare radera den redan skapade
  --      händelsen via en helt vanlig generisk persist(). Samma
  --      aktör-korrigering: `userId` sätts nu till den SERVER-VERIFIERADE
  --      `p_caller_staff_id` (aldrig klient-inskickad, aldrig tom sträng)
  --      — matchar ActivityService.log()'s befintliga
  --      `state.currentUser.id`-kontrakt. ────────────────────────────
  if v_should_start then
    /* Säkerställ att raden existerar INNAN vi låser den — SELECT ... FOR
       UPDATE på en rad som inte finns låser ingenting (samma defensiva
       mönster som project_documents_append). */
    insert into public.store(key, value) values ('vift_activityLog', '[]'::jsonb)
      on conflict (key) do nothing;

    select value into v_activity_log from public.store where key = 'vift_activityLog' for update;
    if v_activity_log is null or jsonb_typeof(v_activity_log) <> 'array' then
      v_activity_log := '[]'::jsonb;
    end if;

    v_actlog_id := 'ACT-' || to_char(v_now, 'YYYYMMDDHH24MISSMS') || '-' || substr(md5(random()::text), 1, 6);
    v_new_activity := jsonb_build_object(
      'id', v_actlog_id,
      'type', 'work_order_status',
      'description', 'Arbetsorder ' || p_ao_id || ' ändrad: ' ||
        (case v_current_status
          when 'nytt' then 'Nytt' when 'pool' then 'Pool' when 'planerad' then 'Planerad'
          else v_current_status end) || ' → Pågående',
      'timestamp', v_now_text,
      'customerId', coalesce(v_ao ->> 'customerId', ''),
      'propertyId', '',
      'workOrderId', p_ao_id,
      'offerId', '', 'invoiceId', '', 'salesOpportunityId', '',
      'inspectionId', '', 'ronderingId', '', 'deviationId', '',
      'userId', p_caller_staff_id
    );
    v_activity_log := jsonb_build_array(v_new_activity) || v_activity_log;
    update public.store set value = v_activity_log, updated_at = v_now where key = 'vift_activityLog';
  else
    /* Ingen mutation behövs — men RETUR-värdet måste ändå spegla den
       FAKTISKA kanoniska loggen (t.ex. en tidigare klients redan
       skapade starthändelse, som denna anropares egen lokala kopia
       ännu inte känner till). Ingen FOR UPDATE-låsning krävs här,
       eftersom inget skrivs. */
    select value into v_activity_log from public.store where key = 'vift_activityLog';
    if v_activity_log is null or jsonb_typeof(v_activity_log) <> 'array' then
      v_activity_log := '[]'::jsonb;
    end if;
  end if;

  -- ── 7) Bumpa DataSync-synksignalen INOM SAMMA transaktion (samma
  --      krav/mönster som 20260908000002 §Blockerare 1) — annars kan
  --      andra klienters DataSync._poll() missa denna ändring. ──────
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  -- ── 8) R1.3 BLOCKERARE 2: returnera BÅDE den uppdaterade AO:n OCH
  --      den FAKTISKA, kanoniska activityLog-arrayen (inte bara AO:n,
  --      som R1.2 gjorde) — se motivering i steg 6. `serverSignature`
  --      medskickas som REN metadata/diagnostik; klienten får ALDRIG
  --      sätta DataSync._lastSig från detta partiella svar (klienten
  --      har inte mottagit en fullständig, generisk snapshot av all
  --      CRM-data) — nästa ordinarie DataSync-poll måste fortfarande
  --      själv upptäcka den nya server-signaturen och hämta en
  --      fullständig, självkonsekvent snapshot. ─────────────────────
  return jsonb_build_object(
    'workOrder', v_updated_ao,
    'activityLog', v_activity_log,
    'serverSignature', v_now_text
  );
end;
$$;

-- ── Behörigheter: ENDAST service_role (samma princip som project_documents_*)
revoke all on function public.work_order_checklist_resolve(text, text, text, text, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.work_order_checklist_resolve(text, text, text, text, text, boolean, text, text)
  to service_role;

-- ── Verifiering (körs manuellt efter migrering) ─────────────────────
-- SELECT proname, proacl FROM pg_proc WHERE proname = 'work_order_checklist_resolve';
-- Förväntat: EXECUTE endast beviljat till service_role.
