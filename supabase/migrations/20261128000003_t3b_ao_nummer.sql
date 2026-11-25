-- ============================================================
-- T3-B (2026-11-28): AO-nummergeneratorn (MASTERPLAN punkt 245).
-- NY – EJ INSTALLERAD I STAGING. Kräver 20261128000001 (regelfunktionerna).
--
-- Fel i den installerade versionen (20261020000001):
--   (a) backfillens off-by-one: en ny sekvens har last_value = 1 med
--       is_called = false. Om det högsta gamla numret är 1 (AO-001) görs
--       ingen setval, och nästa nextval() ger 1 igen -> dubbletten "AO-001"
--       i STAGING. Sekvensen kontrolleras aldrig mot befintliga displayNumber.
--   (b) lpad(n, 3, '0') KORTAR tal med fler än tre siffror i PostgreSQL
--       (lpad('1234', 3) = '123'), så AO-1000 och senare skulle bli dubbletter.
--
-- Rättning (work_order_create, samma signatur, under samma radlås FOR UPDATE
-- på vift_workOrders som serialiserar alla AO-skapanden):
--   nästa nummer = max(nextval(sekvensen), högsta befintliga AO-nummer + 1),
--   där "befintliga" är både displayNumber och id i formen AO-<siffror>.
--   Om numret ändå finns (t.ex. ett id) prövas nästa. Sekvensen ställs fram
--   (setval) till det tilldelade numret. Formatet är AO-NNN med minst tre
--   siffror, aldrig avkortat.
--
-- Historiska data rörs INTE: ingen omnumrering, ingen unik index (som skulle
-- fallera på den befintliga dubbletten AO-001 och omöjliggöra installationen).
--
-- AP-A: en ny AO med status 'pool' OCH personal får poolOpen=false (tilldelad
-- pool, aldrig öppen pool). Övriga fält oförändrade.
-- ============================================================
begin;

do $$
declare v text;
begin
  if to_regprocedure('public._vift_ao_staff(jsonb)') is null then
    raise exception 'T3-B STOP: 20261128000001 (regelfunktionerna) måste installeras först';
  end if;
  v := md5(pg_get_functiondef('public.work_order_create(jsonb,text,text)'::regprocedure));
  if v not in ('c3ea0ea80703431e320a937cec6a05c7') then
    raise exception 'T3-B STOP: work_order_create avviker från verifierad STAGING-version (md5 %)', v;
  end if;
end $$;

create sequence if not exists public.ao_display_number_seq;

/* AO-nummer i visningsform: minst tre siffror, aldrig avkortat. */
create or replace function public._vift_ao_number_text(p_n bigint)
returns text language sql immutable set search_path = public as $$
  select 'AO-' || case when length(p_n::text) >= 3 then p_n::text else lpad(p_n::text, 3, '0') end
$$;

create or replace function public.work_order_create(p_ao jsonb, p_idempotency_key text, p_client_id text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_existing       jsonb;
  v_workorders     jsonb;
  v_new_id         text;
  v_seq            bigint;
  v_display_seq    bigint;
  v_max_existing   bigint;
  v_display        text;
  v_now            timestamptz := clock_timestamp();
  v_now_text       text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_new_ao         jsonb;
  v_sig            text;
  v_collision_idx  int;
begin
  if p_idempotency_key is null or trim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required';
  end if;

  insert into public.store(key, value) values ('vift_workOrders', '[]'::jsonb)
    on conflict (key) do nothing;
  select value into v_workorders from public.store where key = 'vift_workOrders' for update;
  -- Idempotens på den låsta raden (två samtidiga anrop med samma nyckel ger
  -- samma svar i stället för ett unikhetsfel).
  select result into v_existing from public.op_idempotency
    where fn_name = 'work_order_create' and idem_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;
  if v_workorders is null or jsonb_typeof(v_workorders) <> 'array' then
    v_workorders := '[]'::jsonb;
  end if;

  if p_client_id is not null and trim(p_client_id) <> '' then
    select (ord - 1) into v_collision_idx
      from jsonb_array_elements(v_workorders) with ordinality as t(elem, ord)
      where elem ->> 'id' = p_client_id
      limit 1;
    if v_collision_idx is not null then
      raise exception 'id_collision';
    end if;
    v_new_id := p_client_id;
  else
    create sequence if not exists public.work_order_id_seq;
    loop
      v_seq := nextval('public.work_order_id_seq');
      v_new_id := public._vift_ao_number_text(v_seq);
      select (ord - 1) into v_collision_idx
        from jsonb_array_elements(v_workorders) with ordinality as t(elem, ord)
        where elem ->> 'id' = v_new_id
        limit 1;
      if v_collision_idx is null then exit; end if;
    end loop;
  end if;

  -- Punkt 245: nästa visningsnummer, unikt mot befintliga AO-nummer.
  select coalesce(max(n), 0) into v_max_existing from (
    select (regexp_replace(elem ->> 'displayNumber', '^AO-', ''))::bigint as n
      from jsonb_array_elements(v_workorders) elem where (elem ->> 'displayNumber') ~ '^AO-[0-9]{1,18}$'
    union all
    select (regexp_replace(elem ->> 'id', '^AO-', ''))::bigint
      from jsonb_array_elements(v_workorders) elem where (elem ->> 'id') ~ '^AO-[0-9]{1,18}$'
  ) x;
  v_display_seq := greatest(nextval('public.ao_display_number_seq'), v_max_existing + 1);
  loop
    v_display := public._vift_ao_number_text(v_display_seq);
    exit when not exists (select 1 from jsonb_array_elements(v_workorders) elem
                          where elem ->> 'displayNumber' = v_display or elem ->> 'id' = v_display);
    v_display_seq := v_display_seq + 1;
  end loop;
  perform setval('public.ao_display_number_seq', v_display_seq, true);

  v_new_ao := (p_ao - 'id') || jsonb_build_object(
    'id', v_new_id,
    'displayNumber', v_display,
    'createdAt', v_now_text,
    'updatedAt', v_now_text
  );
  -- AP-A: status pool med personal är tilldelad pool, aldrig öppen pool.
  if coalesce(v_new_ao ->> 'status', '') = 'pool' and jsonb_array_length(public._vift_ao_staff(v_new_ao)) > 0 then
    v_new_ao := v_new_ao || jsonb_build_object('poolOpen', false);
  end if;

  v_workorders := v_workorders || jsonb_build_array(v_new_ao);
  update public.store set value = v_workorders, updated_at = v_now where key = 'vift_workOrders';

  v_sig := v_now_text;
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_sig))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  v_existing := jsonb_build_object('workOrder', v_new_ao, 'serverSignature', v_sig);
  insert into public.op_idempotency(fn_name, idem_key, result)
    values ('work_order_create', p_idempotency_key, v_existing);

  return v_existing;
end;
$function$;

revoke all on function public._vift_ao_number_text(bigint) from public, anon, authenticated;
grant execute on function public._vift_ao_number_text(bigint) to service_role;
revoke all on function public.work_order_create(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.work_order_create(jsonb, text, text) to service_role;

commit;
