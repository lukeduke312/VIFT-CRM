-- ============================================================
-- T3-B (2026-11-28): AO-kärnan och arbetspoolen. NY – EJ INSTALLERAD I STAGING.
--
-- Beslut: D-03, D-07, D-19 (delvis), D-24, AP-A, AP-B, AP-F, AP-G, K-03, Q3
-- (docs/qa-2026-11-27/BESLUT-2026-11-27.md, docs/qa-2026-11-28/BESLUT-2026-11-28.md).
-- Rättar SÄK-3, SÄK-4, SÄK-5, SÄK-12 (F17), SÄK-15 (F21), SÄK-16.
--
-- Innehåll:
--   1. Gemensamma regelfunktioner (_vift_*): effektiva AO-behörigheter med
--      ÖVERGÅNGSREGEL, öppen pool, låst AO, tilldelning, idempotens med
--      fingeravtryck (aktör + operation + innehåll).
--   2. work_order_patch: NY SIGNATUR (p_caller_staff_id, p_caller_perms). Alla
--      regelkontroller görs här, på den radlåsta raden (FOR UPDATE):
--      start/klar för egen tilldelad AO, källstatus, låsta AO, servern sätter
--      completedBy/completedAt, faktureringsfält avvisas för ALLA roller,
--      materialrader: fältet får bara ändra egna rader, "Ta jobbet" i den
--      äldre v3.4-formen går genom samma atomiska tagningsregel.
--   3. work_order_pool_take: atomisk tagning ur öppen pool, exakt en vinner.
--   4. work_order_billing_set: den ENDA vägen att sätta/ta bort
--      AO:s faktureringsstatus (anropas av invoice-write, invoice_create).
--   5. work_order_checklist_set_state, work_order_log_append/remove:
--      poolgrenen borttagen (öppen pool ger ingen skrivrätt), ao_locked.
--
-- ÖVERGÅNGSREGEL (testplanen §4.6, dokumenterad i T3-RESULTAT.md T3-B):
--   En roll som INTE har någon av de nya behörigheterna ao_start_own,
--   ao_complete_own, ao_pool_take ("äldre roll") och som har ao_complete men
--   varken ao_view_all eller ao_edit behandlas som om den hade
--   ao_start_own + ao_complete_own + ao_pool_take. Det SMALNAR AV dagens rätt
--   (bara egna AO, bara öppen pool). Så fort en roll får någon av de nya
--   behörigheterna gäller rollens egna lista exakt (T3-E). Regeln tas bort när
--   standardrollerna har de nya behörigheterna.
--
-- Felkoder (BEHORIGHETSMATRIS §4): RAISE 'forbidden:<reason>' tolkas av
-- Edge Functions som 403 {error:'forbidden', reason}. 'ao_locked',
-- 'invalid_source_status', 'already_assigned', 'idempotency_key_conflict'
-- ger 409. En äldre EF tolkar 'forbidden:*' som 403 forbidden (utan reason).
--
-- STOP-kontroll: de ersatta funktionerna måste ha den driftversion som är
-- verifierad mot STAGING (md5 ur staging-schema-facit-2026-11-25.json) eller
-- repokedjans version (samma kod, andra kommentarer). Rollback:
-- supabase/rollback/T3-B/rollback_t3b.sql (återställer STAGING-definitionerna
-- exakt; rör ingen data).
-- ============================================================
begin;

do $$
declare v text;
begin
  if to_regprocedure('public.work_order_patch(text,jsonb,text,text)') is null then
    raise exception 'T3-B STOP: work_order_patch(4 argument) saknas — T3-B är redan installerad eller drift; kör inte igen';
  end if;
  v := md5(pg_get_functiondef('public.work_order_patch(text,jsonb,text,text)'::regprocedure));
  if v not in ('8e03aad6e9ba461555ce87fab2cef757') then
    raise exception 'T3-B STOP: work_order_patch avviker från verifierad STAGING-version (md5 %)', v;
  end if;
  v := md5(pg_get_functiondef('public.work_order_checklist_set_state(text,text,text,text,text,text,text,text,text,boolean,boolean)'::regprocedure));
  if v not in ('cbf925cced41e0ea0e77a77a39442729', 'd05a110d2c321b89ee3f192c4a13a07f') then
    raise exception 'T3-B STOP: work_order_checklist_set_state avviker (md5 %)', v;
  end if;
  v := md5(pg_get_functiondef('public.work_order_log_append(text,jsonb,text,boolean)'::regprocedure));
  if v not in ('a2ab250b2ca53cef23be26aa30ee2e11') then
    raise exception 'T3-B STOP: work_order_log_append avviker (md5 %)', v;
  end if;
  v := md5(pg_get_functiondef('public.work_order_log_remove(text,text,text,boolean,boolean)'::regprocedure));
  if v not in ('cc9fdfb4f1bf0052d86db060a99adafd') then
    raise exception 'T3-B STOP: work_order_log_remove avviker (md5 %)', v;
  end if;
  if to_regprocedure('public.work_order_pool_take(text,text,text[],text,text)') is not null then
    raise exception 'T3-B STOP: work_order_pool_take finns redan; granska innan den ersätts';
  end if;
end $$;

-- ── 1. Regelfunktioner ───────────────────────────────────────────────

create or replace function public._vift_has(p_perms text[], p_perm text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce('all' = any(p_perms) or p_perm = any(p_perms), false)
$$;

/* Effektiva AO-behörigheter inklusive övergångsregeln ovan. */
create or replace function public._vift_ao_eff_perms(p_perms text[])
returns text[] language sql immutable set search_path = public as $$
  select case
    when p_perms is null then '{}'::text[]
    when 'all' = any(p_perms) then p_perms
    when not (p_perms && array['ao_start_own','ao_complete_own','ao_pool_take'])
         and 'ao_complete' = any(p_perms)
         and not (p_perms && array['ao_view_all','ao_edit'])
      then p_perms || array['ao_start_own','ao_complete_own','ao_pool_take']
    else p_perms
  end
$$;

create or replace function public._vift_ao_staff(p_ao jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p_ao -> 'staff') = 'array' then p_ao -> 'staff' else '[]'::jsonb end
$$;

create or replace function public._vift_ao_assigned(p_ao jsonb, p_staff_id text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_staff_id, '') <> '' and public._vift_ao_staff(p_ao) ? p_staff_id
$$;

/* Låst AO (BEHORIGHETSMATRIS §4, 409 ao_locked): fakturerad, avbruten,
   arkiverad, borttagen, eller kopplad till ett fakturaunderlag. */
create or replace function public._vift_ao_locked(p_ao jsonb)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_ao ->> 'deleted', '') = 'true'
      or coalesce(p_ao ->> 'archived', '') = 'true'
      or coalesce(p_ao ->> 'status', '') in ('fakturerad', 'avbruten')
      or coalesce(p_ao ->> 'invoiceId', '') <> ''
$$;

/* Öppen pool (AP-A): status pool, poolOpen inte false, ingen personal,
   inte arkiverad eller borttagen. Delmängd av dagens utlämning (utredningen §5.4). */
create or replace function public._vift_ao_open_pool(p_ao jsonb)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_ao ->> 'status', '') = 'pool'
     and coalesce(p_ao ->> 'poolOpen', '') <> 'false'
     and jsonb_array_length(public._vift_ao_staff(p_ao)) = 0
     and coalesce(p_ao ->> 'deleted', '') <> 'true'
     and coalesce(p_ao ->> 'archived', '') <> 'true'
$$;

/* Idempotens bunden till aktör, operation och innehåll (SÄK-12/F17).
   Nyckeln är oförändrad (op_idempotency.fn_name + idem_key); fingeravtrycket
   lagras i resultatet som '_fp' (samma mönster som time_entry_patch).
   Samma nyckel + samma fingeravtryck → sparat svar (återspelning).
   Samma nyckel + annat fingeravtryck (annan aktör eller annat innehåll) →
   'idempotency_key_conflict' (409), ingen mutation.
   Poster utan '_fp' (skrivna före T3-B) återspelas som förut. */
create or replace function public._vift_idem_lookup(p_fn text, p_key text, p_fp text)
returns jsonb language plpgsql stable set search_path = public as $$
declare v jsonb;
begin
  select result into v from public.op_idempotency where fn_name = p_fn and idem_key = p_key;
  if v is null then return null; end if;
  if (v ? '_fp') and (v ->> '_fp') is distinct from p_fp then
    raise exception 'idempotency_key_conflict';
  end if;
  return v - '_fp';
end $$;

create or replace function public._vift_staff_name(p_staff_id text)
returns text language sql stable set search_path = public as $$
  select coalesce(nullif(trim(coalesce(s ->> 'firstName', '') || ' ' || coalesce(s ->> 'lastName', '')), ''), p_staff_id)
  from public.store, jsonb_array_elements(case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) s
  where key = 'vift_staff' and s ->> 'id' = p_staff_id
  limit 1
$$;

create or replace function public._vift_staff_active(p_staff_id text)
returns boolean language sql stable set search_path = public as $$
  select coalesce(p_staff_id, '') <> '' and exists (
    select 1 from public.store, jsonb_array_elements(case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) s
    where key = 'vift_staff' and s ->> 'id' = p_staff_id and coalesce(s ->> 'active', 'false') not in ('false', '0', ''))
$$;

/* Tagning ur öppen pool, anropas med AO-raden redan låst (FOR UPDATE).
   Returnerar den uppdaterade AO:n eller kastar. Felordning (matrisen §5.3):
     arkiverad/borttagen               -> forbidden:pool_not_open (403)
     har personal                      -> already_assigned (409)
     inte öppen pool                   -> forbidden:pool_not_open (403)
   Servern sätter staff=[anroparen], poolOpen=false, status 'planerad'
   (AP-G: övergångsstatus för v3.4-klienter) och lägger loggposten SIST. */
create or replace function public._vift_ao_take(p_ao jsonb, p_me text, p_entry_id text, p_now_text text)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_name text; v_log jsonb;
begin
  if coalesce(p_ao ->> 'deleted', '') = 'true' or coalesce(p_ao ->> 'archived', '') = 'true' then
    raise exception 'forbidden:pool_not_open';
  end if;
  if jsonb_array_length(public._vift_ao_staff(p_ao)) > 0 then
    raise exception 'already_assigned';
  end if;
  if not public._vift_ao_open_pool(p_ao) then
    raise exception 'forbidden:pool_not_open';
  end if;
  v_name := coalesce(public._vift_staff_name(p_me), p_me);
  v_log := case when jsonb_typeof(p_ao -> 'log') = 'array' then p_ao -> 'log' else '[]'::jsonb end;
  if coalesce(p_entry_id, '') = '' or exists (select 1 from jsonb_array_elements(v_log) e where e ->> 'id' = p_entry_id) then
    p_entry_id := 'L-TAKE-' || md5(p_me || '|' || coalesce(p_ao ->> 'id', '') || '|' || p_now_text);
  end if;
  return p_ao || jsonb_build_object(
    'staff', jsonb_build_array(p_me),
    'poolOpen', false,
    'status', 'planerad',
    'log', v_log || jsonb_build_array(jsonb_build_object(
      'id', p_entry_id, 'type', 'taken_from_pool',
      'text', v_name || ' tog jobbet från arbetspoolen',
      'userName', v_name, 'staffId', p_me, 'timestamp', p_now_text)),
    'updatedAt', p_now_text);
end $$;

/* Materialrader i fältets patch (D-19, delvis): fältet får lägga till rader
   och ändra/ta bort rader det själv lagt till (addedBy = anroparen, satt av
   servern). Andras rader och äldre rader utan addedBy måste finnas kvar
   oförändrade, annars forbidden:not_own_row. Nya rader får addedBy/addedAt
   av servern. Radvisa RPC:er (hela D-19) byggs i T4-B. */
create or replace function public._vift_ao_material_merge(p_old jsonb, p_new jsonb, p_me text, p_now_text text)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_old jsonb := case when jsonb_typeof(p_old) = 'array' then p_old else '[]'::jsonb end;
  v_new jsonb := case when jsonb_typeof(p_new) = 'array' then p_new else '[]'::jsonb end;
  o jsonb; n jsonb; v_out jsonb := '[]'::jsonb; v_old_ids text[];
begin
  select coalesce(array_agg(x ->> 'id'), '{}') into v_old_ids from jsonb_array_elements(v_old) x where coalesce(x ->> 'id', '') <> '';
  for o in select value from jsonb_array_elements(v_old) loop
    if coalesce(o ->> 'addedBy', '') = p_me then continue; end if;
    if coalesce(o ->> 'id', '') <> '' then
      select value into n from jsonb_array_elements(v_new) where value ->> 'id' = o ->> 'id' limit 1;
      if n is null or n <> o then raise exception 'forbidden:not_own_row'; end if;
    else
      if not exists (select 1 from jsonb_array_elements(v_new) x where x = o) then raise exception 'forbidden:not_own_row'; end if;
    end if;
    n := null;
  end loop;
  for n in select value from jsonb_array_elements(v_new) loop
    if coalesce(n ->> 'id', '') <> '' and n ->> 'id' = any(v_old_ids) then
      v_out := v_out || jsonb_build_array(n);
    elsif coalesce(n ->> 'id', '') = '' and exists (select 1 from jsonb_array_elements(v_old) x where x = n) then
      v_out := v_out || jsonb_build_array(n);
    else
      v_out := v_out || jsonb_build_array(n || jsonb_build_object('addedBy', p_me, 'addedAt', p_now_text));
    end if;
  end loop;
  return v_out;
end $$;

/* Faktureringsfält får bara ändras via work_order_billing_set (D-07, F21). */
create or replace function public._vift_ao_billing_touched(p_ao jsonb, p_patch jsonb)
returns boolean language sql immutable set search_path = public as $$
  select
       (p_patch ? 'status' and coalesce(p_patch ->> 'status', '') = 'fakturerad' and coalesce(p_ao ->> 'status', '') <> 'fakturerad')
    or (p_patch ? 'status' and coalesce(p_ao ->> 'status', '') = 'fakturerad' and coalesce(p_patch ->> 'status', '') <> 'fakturerad')
    or (p_patch ? 'invoiceId' and coalesce(p_patch ->> 'invoiceId', '') <> coalesce(p_ao ->> 'invoiceId', ''))
    or (p_patch ? 'invoicedAt' and coalesce(p_patch ->> 'invoicedAt', '') <> coalesce(p_ao ->> 'invoicedAt', ''))
    or (p_patch ? 'billingPreviousStatus' and coalesce(p_patch -> 'billingPreviousStatus', 'null'::jsonb) <> coalesce(p_ao -> 'billingPreviousStatus', 'null'::jsonb))
$$;

-- ── 2. work_order_patch (ny signatur) ────────────────────────────────

drop function public.work_order_patch(text, jsonb, text, text);

create function public.work_order_patch(
  p_ao_id text, p_patch jsonb, p_idempotency_key text, p_expected_updated_at text,
  p_caller_staff_id text, p_caller_perms text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_workorders jsonb; v_idx int; v_ao jsonb; v_updated jsonb; v_existing jsonb;
  v_now timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_fp text; v_result jsonb; v_eff text[]; v_me text := coalesce(p_caller_staff_id, '');
  v_patch jsonb; v_keys text[]; v_ignored text[] := '{}'; v_status text; v_new_log jsonb; v_added jsonb;
  v_can_edit boolean;
begin
  if p_idempotency_key is null or trim(p_idempotency_key) = '' then raise exception 'idempotency_key_required'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'missing_fields'; end if;
  if v_me = '' then raise exception 'forbidden'; end if;

  v_eff := public._vift_ao_eff_perms(coalesce(p_caller_perms, '{}'));
  v_can_edit := public._vift_has(v_eff, 'ao_edit');
  v_patch := p_patch - 'id' - 'createdAt' - 'updatedAt' - 'deleted' - 'deletedAt';
  v_fp := md5(jsonb_build_array('work_order_patch', v_me, p_ao_id, p_patch, coalesce(p_expected_updated_at, ''))::text);

  -- Radlåset FÖRST: alla kontroller nedan, även idempotensen, görs på den låsta raden.
  select value into v_workorders from public.store where key = 'vift_workOrders' for update;
  v_existing := public._vift_idem_lookup('work_order_patch', p_idempotency_key, v_fp);
  if v_existing is not null then return v_existing; end if;
  if v_workorders is null or jsonb_typeof(v_workorders) <> 'array' then raise exception 'not_found'; end if;
  select (ord - 1) into v_idx from jsonb_array_elements(v_workorders) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_ao_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_ao := v_workorders -> v_idx;

  if p_expected_updated_at is not null and (v_ao ->> 'updatedAt') is distinct from p_expected_updated_at then
    raise exception 'stale_write';
  end if;

  select coalesce(array_agg(k), '{}') into v_keys from jsonb_object_keys(v_patch) k;
  v_status := v_patch ->> 'status';

  if v_can_edit then
    -- Arbetsledare (ao_edit/all): fri patch utom faktureringsfälten.
    -- D-07/F21: faktureringsfält ändras aldrig här, oavsett roll (även 'all').
    -- (Fältets grenar nedan tillåter bara uppräknade fält och kan inte röra dem.)
    if public._vift_ao_billing_touched(v_ao, v_patch) then
      raise exception 'forbidden:invoice_path_required';
    end if;
    v_updated := v_ao || v_patch;
    -- AP-G: personal tilldelas en pool-AO -> den återvänder inte till öppen
    -- pool om personalen senare tas bort (poolOpen=false), om inte patchen säger annat.
    if (v_patch ? 'staff') and not (v_patch ? 'poolOpen')
       and coalesce(v_updated ->> 'status', '') = 'pool'
       and jsonb_array_length(public._vift_ao_staff(v_updated)) > 0
       and jsonb_array_length(public._vift_ao_staff(v_ao)) = 0 then
      v_updated := v_updated || jsonb_build_object('poolOpen', false);
    end if;
    if v_status = 'klar' and coalesce(v_ao ->> 'status', '') <> 'klar' then
      if coalesce(v_patch ->> 'completedAt', '') = '' then v_updated := v_updated || jsonb_build_object('completedAt', v_now_text); end if;
      if coalesce(v_patch ->> 'completedBy', '') = '' then v_updated := v_updated || jsonb_build_object('completedBy', v_me); end if;
    end if;

  elsif v_keys <@ array['materials'] and array_length(v_keys, 1) = 1 then
    -- Fältets materialpatch: ao_material, tilldelad, inte låst, bara egna rader.
    if not public._vift_has(v_eff, 'ao_material') then raise exception 'forbidden'; end if;
    if not (public._vift_ao_assigned(v_ao, v_me) or public._vift_has(v_eff, 'ao_view_all')) then raise exception 'forbidden:not_assigned'; end if;
    if public._vift_ao_locked(v_ao) then raise exception 'ao_locked'; end if;
    if jsonb_typeof(v_patch -> 'materials') <> 'array' or jsonb_array_length(v_patch -> 'materials') > 500 then raise exception 'missing_fields'; end if;
    v_updated := v_ao || jsonb_build_object('materials', public._vift_ao_material_merge(v_ao -> 'materials', v_patch -> 'materials', v_me, v_now_text));

  elsif v_status = 'pågående' and v_keys <@ array['status'] then
    -- Starta egen (D-03, R07): ao_start_own, tilldelad, källstatus nytt/planerad/pool.
    if not public._vift_has(v_eff, 'ao_start_own') then raise exception 'forbidden'; end if;
    if not public._vift_ao_assigned(v_ao, v_me) then raise exception 'forbidden:not_assigned'; end if;
    if public._vift_ao_locked(v_ao) then raise exception 'ao_locked'; end if;
    if coalesce(v_ao ->> 'status', '') not in ('nytt', 'planerad', 'pool') then raise exception 'invalid_source_status'; end if;
    v_updated := v_ao || jsonb_build_object('status', 'pågående', 'startedAt', coalesce(nullif(v_ao ->> 'startedAt', ''), v_now_text),
                                            'startedBy', coalesce(nullif(v_ao ->> 'startedBy', ''), v_me));

  elsif v_status = 'klar' and v_keys <@ array['status', 'completedAt', 'completedBy'] then
    -- Klarmarkera (D-03, R08): ao_complete_own på egen tilldelad AO, eller
    -- ao_complete + ao_view_all (valfri synlig). Servern sätter completedBy/At.
    if public._vift_has(v_eff, 'ao_complete') and public._vift_has(v_eff, 'ao_view_all') then
      null;
    elsif public._vift_has(v_eff, 'ao_complete_own') then
      if not public._vift_ao_assigned(v_ao, v_me) then raise exception 'forbidden:not_assigned'; end if;
    else
      raise exception 'forbidden';
    end if;
    if public._vift_ao_locked(v_ao) then raise exception 'ao_locked'; end if;
    if coalesce(v_ao ->> 'status', '') not in ('nytt', 'planerad', 'pool', 'pågående') then raise exception 'invalid_source_status'; end if;
    if v_patch ? 'completedAt' then v_ignored := array_append(v_ignored, 'completedAt'); end if;
    if v_patch ? 'completedBy' then v_ignored := array_append(v_ignored, 'completedBy'); end if;
    v_updated := v_ao || jsonb_build_object('status', 'klar', 'completedAt', v_now_text, 'completedBy', v_me);

  elsif v_status = 'planerad' and (v_patch ? 'staff') and v_keys <@ array['staff', 'status', 'log'] then
    -- "Ta jobbet" i v3.4-klientens form: samma atomiska regel som work_order_pool_take.
    if not public._vift_has(v_eff, 'ao_pool_take') then raise exception 'forbidden'; end if;
    if jsonb_typeof(v_patch -> 'staff') <> 'array' or v_patch -> 'staff' <> (public._vift_ao_staff(v_ao) || jsonb_build_array(v_me)) then
      if jsonb_array_length(public._vift_ao_staff(v_ao)) > 0 then raise exception 'already_assigned'; end if;
      raise exception 'forbidden:field_not_allowed';
    end if;
    v_new_log := case when jsonb_typeof(v_patch -> 'log') = 'array' then v_patch -> 'log' else '[]'::jsonb end;
    select n.e into v_added from jsonb_array_elements(v_new_log) as n(e)
      where n.e ->> 'type' = 'taken_from_pool'
        and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_ao -> 'log') = 'array' then v_ao -> 'log' else '[]'::jsonb end) as o(e) where o.e ->> 'id' = n.e ->> 'id')
      limit 1;
    v_updated := public._vift_ao_take(v_ao, v_me, v_added ->> 'id', v_now_text);

  else
    raise exception 'forbidden:field_not_allowed';
  end if;

  v_updated := v_updated || jsonb_build_object('updatedAt', v_now_text);
  v_workorders := jsonb_set(v_workorders, array[v_idx::text], v_updated);
  update public.store set value = v_workorders, updated_at = v_now where key = 'vift_workOrders';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('workOrder', v_updated, 'serverSignature', v_now_text);
  if array_length(v_ignored, 1) > 0 then v_result := v_result || jsonb_build_object('ignoredFields', to_jsonb(v_ignored)); end if;
  insert into public.op_idempotency(fn_name, idem_key, result)
    values ('work_order_patch', p_idempotency_key, v_result || jsonb_build_object('_fp', v_fp));
  return v_result;
end $$;

-- ── 3. work_order_pool_take ─────────────────────────────────────────

create function public.work_order_pool_take(
  p_ao_id text, p_caller_staff_id text, p_caller_perms text[], p_idempotency_key text, p_entry_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_workorders jsonb; v_idx int; v_ao jsonb; v_updated jsonb; v_existing jsonb; v_eff text[];
  v_now timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_fp text; v_result jsonb; v_me text := coalesce(p_caller_staff_id, '');
begin
  if p_idempotency_key is null or trim(p_idempotency_key) = '' then raise exception 'idempotency_key_required'; end if;
  if coalesce(p_ao_id, '') = '' then raise exception 'missing_fields'; end if;
  v_eff := public._vift_ao_eff_perms(coalesce(p_caller_perms, '{}'));
  if not (public._vift_has(v_eff, 'ao_pool_take') or public._vift_has(v_eff, 'ao_edit'))
     or not (public._vift_has(v_eff, 'ao_view_own') or public._vift_has(v_eff, 'ao_view_all')) then
    raise exception 'forbidden';
  end if;
  if not public._vift_staff_active(v_me) then raise exception 'forbidden'; end if;
  v_fp := md5(jsonb_build_array('work_order_pool_take', v_me, p_ao_id)::text);

  select value into v_workorders from public.store where key = 'vift_workOrders' for update;
  v_existing := public._vift_idem_lookup('work_order_pool_take', p_idempotency_key, v_fp);
  if v_existing is not null then return v_existing; end if;
  if v_workorders is null or jsonb_typeof(v_workorders) <> 'array' then raise exception 'not_found'; end if;
  select (ord - 1) into v_idx from jsonb_array_elements(v_workorders) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_ao_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_ao := v_workorders -> v_idx;

  v_updated := public._vift_ao_take(v_ao, v_me, p_entry_id, v_now_text);
  v_workorders := jsonb_set(v_workorders, array[v_idx::text], v_updated);
  update public.store set value = v_workorders, updated_at = v_now where key = 'vift_workOrders';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  v_result := jsonb_build_object('workOrder', v_updated, 'takenBy', v_me, 'serverSignature', v_now_text);
  insert into public.op_idempotency(fn_name, idem_key, result)
    values ('work_order_pool_take', p_idempotency_key, v_result || jsonb_build_object('_fp', v_fp));
  return v_result;
end $$;

-- ── 4. work_order_billing_set (faktureringsvägen, D-07) ─────────────
/* p_mode 'invoiced': AO markeras fakturerad med invoiceId. Kräver att
     fakturaunderlaget finns, inte är makulerat, och faktiskt hänvisar till AO:n
     (workOrderIds, workOrderId eller en rads sourceRefs). billingPreviousStatus
     sparas första gången (så att markeringen kan backas).
   p_mode 'restore': backar en markering som FAKTURERINGSMOTORN gjort
     (billingPreviousStatus satt). Status återställs till serverns sparade
     billingPreviousStatus, aldrig till ett klientvärde. En manuellt eller äldre
     satt 'fakturerad' (utan billingPreviousStatus) rörs aldrig.
   Låsordning som invoice_set_status: vift_invoices före vift_workOrders. */
create function public.work_order_billing_set(p_ao_id text, p_invoice_id text, p_mode text, p_actor_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_invoices jsonb; v_inv jsonb; v_workorders jsonb; v_idx int; v_ao jsonb; v_updated jsonb;
  v_now timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_refs boolean;
begin
  if coalesce(p_ao_id, '') = '' or p_mode not in ('invoiced', 'restore') or (p_mode = 'invoiced' and coalesce(p_invoice_id, '') = '') then
    raise exception 'missing_fields';
  end if;
  select value into v_invoices from public.store where key = 'vift_invoices' for share;
  select value into v_workorders from public.store where key = 'vift_workOrders' for update;
  if v_workorders is null or jsonb_typeof(v_workorders) <> 'array' then raise exception 'not_found'; end if;
  select (ord - 1) into v_idx from jsonb_array_elements(v_workorders) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_ao_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_ao := v_workorders -> v_idx;

  if p_mode = 'invoiced' then
    select value into v_inv from jsonb_array_elements(case when jsonb_typeof(v_invoices) = 'array' then v_invoices else '[]'::jsonb end)
      where value ->> 'id' = p_invoice_id limit 1;
    if v_inv is null or coalesce(v_inv ->> 'deleted', '') = 'true' then raise exception 'not_found'; end if;
    if coalesce(v_inv ->> 'status', '') = 'makulerad' then raise exception 'invalid_transition'; end if;
    v_refs := (jsonb_typeof(v_inv -> 'workOrderIds') = 'array' and (v_inv -> 'workOrderIds') ? p_ao_id)
      or coalesce(v_inv ->> 'workOrderId', '') = p_ao_id
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_inv -> 'lines') = 'array' then v_inv -> 'lines' else '[]'::jsonb end) l,
                 jsonb_array_elements(case when jsonb_typeof(l -> 'sourceRefs') = 'array' then l -> 'sourceRefs' else '[]'::jsonb end) r
                 where r ->> 'workOrderId' = p_ao_id or l ->> 'sourceId' = p_ao_id);
    if not v_refs then raise exception 'forbidden:invoice_not_linked'; end if;
    if coalesce(v_ao ->> 'deleted', '') = 'true' then raise exception 'ao_locked'; end if;
    if coalesce(v_ao ->> 'status', '') = 'fakturerad' and coalesce(v_ao ->> 'invoiceId', '') = p_invoice_id then
      return jsonb_build_object('workOrder', v_ao, 'noop', true, 'serverSignature', v_now_text);
    end if;
    if coalesce(v_ao ->> 'invoiceId', '') <> '' and v_ao ->> 'invoiceId' <> p_invoice_id then raise exception 'ao_locked'; end if;
    v_updated := v_ao || jsonb_build_object('status', 'fakturerad', 'invoiceId', p_invoice_id);
    -- Första markeringen sparar föregående status (så att motorn kan backa den).
    -- En AO som redan var manuellt/äldre 'fakturerad' får ingen billingPreviousStatus.
    if coalesce(v_ao -> 'billingPreviousStatus', 'null'::jsonb) = 'null'::jsonb and coalesce(v_ao ->> 'status', '') <> 'fakturerad' then
      v_updated := v_updated || jsonb_build_object('billingPreviousStatus', coalesce(nullif(v_ao ->> 'status', ''), 'klar'));
    end if;
  else
    if coalesce(v_ao ->> 'status', '') <> 'fakturerad' or coalesce(v_ao -> 'billingPreviousStatus', 'null'::jsonb) = 'null'::jsonb then
      return jsonb_build_object('workOrder', v_ao, 'noop', true, 'serverSignature', v_now_text);
    end if;
    v_updated := v_ao || jsonb_build_object('status', v_ao ->> 'billingPreviousStatus', 'invoiceId', '', 'billingPreviousStatus', null);
  end if;

  v_updated := v_updated || jsonb_build_object('updatedAt', v_now_text);
  v_workorders := jsonb_set(v_workorders, array[v_idx::text], v_updated);
  update public.store set value = v_workorders, updated_at = v_now where key = 'vift_workOrders';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('workOrder', v_updated, 'noop', false, 'serverSignature', v_now_text, 'actor', coalesce(p_actor_id, ''));
end $$;

-- ── 5. Checklista och AO-logg: öppen pool ger ingen skrivrätt ──────
/* Ändrat jämfört med STAGING: (a) poolgrenen ("or status = 'pool'") är borttagen;
   bara tilldelad eller p_caller_can_view_all (arbetsledare) får skriva.
   (b) 'forbidden:not_assigned' i stället för 'forbidden'. (c) en låst AO
   (fakturerad/avbruten/arkiverad/borttagen) ger 'ao_locked' för den som inte
   är arbetsledare. Övrig logik är oförändrad. */
create or replace function public.work_order_checklist_set_state(p_ao_id text, p_item_id text, p_action text, p_text text, p_description text, p_comment text, p_image text, p_actor_name text, p_caller_staff_id text, p_caller_can_view_all boolean, p_caller_can_edit boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_workorders  jsonb;
  v_ao_idx      int;
  v_ao          jsonb;
  v_checklist   jsonb;
  v_item_idx    int;
  v_item        jsonb;
  v_new_item    jsonb;
  v_state       text;
  v_owner       text;
  v_is_own      boolean;
  v_history     jsonb;
  v_noop        boolean := false;
  v_updated_ao  jsonb;
  v_now         timestamptz := clock_timestamp();
  v_now_text    text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_actor       text := coalesce(nullif(trim(p_actor_name), ''), 'Okänd användare');
  v_entry       jsonb;
begin
  if p_action is null or p_action not in ('start', 'done', 'avvikelse', 'reset', 'add', 'remove') then
    raise exception 'invalid_action';
  end if;
  if coalesce(p_item_id, '') = '' then
    raise exception 'missing_fields';
  end if;
  if p_action = 'avvikelse' and coalesce(trim(p_comment), '') = '' then
    raise exception 'comment_required';
  end if;
  if p_action = 'add' and coalesce(trim(p_text), '') = '' then
    raise exception 'text_required';
  end if;

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

  -- T3-B: skrivrätt = arbetsledare (ao_view_all) eller tilldelad. Öppen pool ger ingen skrivrätt (AP-B).
  if not coalesce(p_caller_can_view_all, false) then
    if not public._vift_ao_assigned(v_ao, p_caller_staff_id) then
      raise exception 'forbidden:not_assigned';
    end if;
    if public._vift_ao_locked(v_ao) then
      raise exception 'ao_locked';
    end if;
  end if;

  v_checklist := coalesce(v_ao -> 'checklist', '[]'::jsonb);
  select (ord - 1) into v_item_idx
    from jsonb_array_elements(v_checklist) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_item_id
    limit 1;

  v_entry := jsonb_build_object('a', p_action, 'by', v_actor, 'byId', coalesce(p_caller_staff_id, ''), 'at', v_now_text);

  if p_action = 'add' then
    if v_item_idx is not null then
      if (v_checklist -> v_item_idx ->> 'text') = trim(p_text) then
        v_noop := true;
      else
        raise exception 'id_collision';
      end if;
    else
      v_checklist := v_checklist || jsonb_build_array(jsonb_build_object(
        'id', p_item_id,
        'text', left(trim(p_text), 300),
        'description', left(coalesce(trim(p_description), ''), 2000),
        'done', false,
        'avvikelse', null,
        'history', jsonb_build_array(v_entry)
      ));
    end if;
  else
    if v_item_idx is null then
      if p_action = 'remove' then
        v_noop := true;
      else
        raise exception 'item_not_found';
      end if;
    else
      v_item := v_checklist -> v_item_idx;
      v_state := case
        when v_item ->> 'avvikelse' = 'avvikelse' then 'avvikelse'
        when coalesce((v_item ->> 'done')::boolean, false) or v_item ->> 'avvikelse' = 'ok' then 'utford'
        when coalesce(v_item ->> 'startedAt', '') <> '' then 'pagaende'
        else 'ej_paborjad'
      end;
      v_owner := case v_state
        when 'avvikelse' then v_item ->> 'avvikelseById'
        when 'utford'    then v_item ->> 'doneById'
        when 'pagaende'  then v_item ->> 'startedById'
        else null
      end;
      v_is_own := coalesce(v_owner, '') <> '' and v_owner = coalesce(p_caller_staff_id, '');

      if not p_caller_can_edit and not v_is_own and (
           (p_action in ('reset', 'remove') and v_state <> 'ej_paborjad')
        or (p_action in ('done', 'avvikelse') and v_state in ('utford', 'avvikelse'))
      ) then
        raise exception 'forbidden_other';
      end if;

      if p_action = 'remove' then
        v_checklist := v_checklist - v_item_idx;
      else
        v_entry := v_entry || jsonb_build_object('from', v_state);
        v_new_item := v_item;

        if p_action = 'start' then
          if v_state in ('utford', 'avvikelse') then
            raise exception 'already_resolved';
          elsif v_state = 'pagaende' then
            v_noop := true;
          else
            v_new_item := v_new_item || jsonb_build_object(
              'startedAt', v_now_text, 'startedBy', v_actor, 'startedById', coalesce(p_caller_staff_id, ''));
          end if;

        elsif p_action = 'done' then
          if v_state = 'utford' then
            v_noop := true;
          else
            v_new_item := v_new_item || jsonb_build_object(
              'avvikelse', 'ok', 'done', true,
              'avvikelseComment', '', 'avvikelseAt', '', 'avvikelseBy', '', 'avvikelseById', '',
              'doneAt', v_now_text, 'doneBy', v_actor, 'doneById', coalesce(p_caller_staff_id, ''));
          end if;

        elsif p_action = 'avvikelse' then
          v_new_item := v_new_item || jsonb_build_object(
            'avvikelse', 'avvikelse', 'done', false,
            'avvikelseComment', left(trim(p_comment), 2000),
            'avvikelseAt', v_now_text, 'avvikelseBy', v_actor, 'avvikelseById', coalesce(p_caller_staff_id, ''),
            'doneAt', '', 'doneBy', '', 'doneById', '');
          if p_image is not null and p_image <> '' then
            v_new_item := v_new_item || jsonb_build_object('avvikelseImage', p_image);
          end if;

        elsif p_action = 'reset' then
          if v_state = 'ej_paborjad' then
            v_noop := true;
          else
            v_new_item := v_new_item || jsonb_build_object(
              'done', false, 'avvikelse', null,
              'avvikelseComment', '', 'avvikelseAt', '', 'avvikelseBy', '', 'avvikelseById', '',
              'startedAt', '', 'startedBy', '', 'startedById', '',
              'doneAt', '', 'doneBy', '', 'doneById', '');
          end if;
        end if;

        if not v_noop then
          v_history := coalesce(v_new_item -> 'history', '[]'::jsonb) || jsonb_build_array(v_entry);
          while jsonb_array_length(v_history) > 20 loop
            v_history := v_history - 0;
          end loop;
          v_new_item := v_new_item || jsonb_build_object('history', v_history);
          v_checklist := jsonb_set(v_checklist, array[v_item_idx::text], v_new_item);
        end if;
      end if;
    end if;
  end if;

  if v_noop then
    return jsonb_build_object('workOrder', v_ao, 'noop', true, 'serverSignature', v_now_text);
  end if;

  -- AO:ns status rörs ALDRIG här — bara checklistan och updatedAt.
  v_updated_ao := v_ao || jsonb_build_object('checklist', v_checklist, 'updatedAt', v_now_text);
  v_workorders := jsonb_set(v_workorders, array[v_ao_idx::text], v_updated_ao);
  update public.store set value = v_workorders, updated_at = v_now where key = 'vift_workOrders';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('workOrder', v_updated_ao, 'noop', false, 'serverSignature', v_now_text);
end;
$function$;

create or replace function public.work_order_log_append(p_ao_id text, p_entry jsonb, p_caller_staff_id text, p_caller_can_view_all boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_arr jsonb; v_idx int; v_ao jsonb; v_log jsonb; v_existing jsonb;
  v_now timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if coalesce(p_ao_id, '') = '' or p_entry is null or jsonb_typeof(p_entry) <> 'object' or coalesce(p_entry->>'id', '') = '' then
    raise exception 'missing_fields';
  end if;
  select value into v_arr from public.store where key = 'vift_workOrders' for update;
  if v_arr is null or jsonb_typeof(v_arr) <> 'array' then raise exception 'not_found'; end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_arr) with ordinality as t(el, ord) where el->>'id' = p_ao_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_ao := v_arr -> v_idx;
  -- T3-B: tilldelad eller arbetsledare; öppen pool ger ingen skrivrätt (AP-B, Q3).
  if not coalesce(p_caller_can_view_all, false) then
    if not public._vift_ao_assigned(v_ao, p_caller_staff_id) then raise exception 'forbidden:not_assigned'; end if;
    if public._vift_ao_locked(v_ao) then raise exception 'ao_locked'; end if;
  end if;
  v_log := coalesce(v_ao->'log', '[]'::jsonb);
  select e into v_existing from jsonb_array_elements(v_log) e where e->>'id' = p_entry->>'id' limit 1;
  if v_existing is not null then
    if v_existing = p_entry then return jsonb_build_object('workOrder', v_ao, 'noop', true); end if;
    raise exception 'id_collision';
  end if;
  v_ao := v_ao || jsonb_build_object('log', v_log || jsonb_build_array(p_entry), 'updatedAt', v_now_text);
  v_arr := jsonb_set(v_arr, array[v_idx::text], v_ao);
  update public.store set value = v_arr, updated_at = v_now where key = 'vift_workOrders';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('workOrder', v_ao, 'noop', false);
end;
$function$;

create or replace function public.work_order_log_remove(p_ao_id text, p_entry_id text, p_caller_staff_id text, p_caller_can_view_all boolean, p_caller_can_edit boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_arr jsonb; v_idx int; v_ao jsonb; v_log jsonb; v_entry jsonb;
  v_now timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if coalesce(p_ao_id, '') = '' or coalesce(p_entry_id, '') = '' then raise exception 'missing_fields'; end if;
  select value into v_arr from public.store where key = 'vift_workOrders' for update;
  if v_arr is null or jsonb_typeof(v_arr) <> 'array' then raise exception 'not_found'; end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_arr) with ordinality as t(el, ord) where el->>'id' = p_ao_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_ao := v_arr -> v_idx;
  -- T3-B: tilldelad eller arbetsledare; öppen pool ger ingen skrivrätt.
  if not coalesce(p_caller_can_view_all, false) then
    if not public._vift_ao_assigned(v_ao, p_caller_staff_id) then raise exception 'forbidden:not_assigned'; end if;
    if public._vift_ao_locked(v_ao) then raise exception 'ao_locked'; end if;
  end if;
  v_log := coalesce(v_ao->'log', '[]'::jsonb);
  select e into v_entry from jsonb_array_elements(v_log) e where e->>'id' = p_entry_id limit 1;
  if v_entry is null then return jsonb_build_object('workOrder', v_ao, 'noop', true); end if;
  if not coalesce(p_caller_can_edit, false) and coalesce(v_entry->>'staffId', '') <> coalesce(p_caller_staff_id, '-') then
    raise exception 'forbidden_other';
  end if;
  v_log := coalesce((select jsonb_agg(e order by ord) from jsonb_array_elements(v_log) with ordinality as l(e, ord) where e->>'id' is distinct from p_entry_id), '[]'::jsonb);
  v_ao := v_ao || jsonb_build_object('log', v_log, 'updatedAt', v_now_text);
  v_arr := jsonb_set(v_arr, array[v_idx::text], v_ao);
  update public.store set value = v_arr, updated_at = v_now where key = 'vift_workOrders';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('workOrder', v_ao, 'noop', false);
end;
$function$;

-- ── Rättigheter: bara service_role (Edge Functions). ────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._vift_has(text[],text)', 'public._vift_ao_eff_perms(text[])', 'public._vift_ao_staff(jsonb)',
    'public._vift_ao_assigned(jsonb,text)', 'public._vift_ao_locked(jsonb)', 'public._vift_ao_open_pool(jsonb)',
    'public._vift_idem_lookup(text,text,text)', 'public._vift_staff_name(text)', 'public._vift_staff_active(text)',
    'public._vift_ao_take(jsonb,text,text,text)', 'public._vift_ao_material_merge(jsonb,jsonb,text,text)',
    'public._vift_ao_billing_touched(jsonb,jsonb)',
    'public.work_order_patch(text,jsonb,text,text,text,text[])',
    'public.work_order_pool_take(text,text,text[],text,text)',
    'public.work_order_billing_set(text,text,text,text)',
    'public.work_order_checklist_set_state(text,text,text,text,text,text,text,text,text,boolean,boolean)',
    'public.work_order_log_append(text,jsonb,text,boolean)',
    'public.work_order_log_remove(text,text,text,boolean,boolean)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
