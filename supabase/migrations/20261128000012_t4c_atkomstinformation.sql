-- ============================================================
-- T4-C (2026-11-28): åtkomstinformation till tilldelad personal (SÄK-7, tilldelningsvägen; D-05),
-- förberedelse för D-16 och D-23 (permanent radering tar bort den känsliga raden).
-- NY – EJ INSTALLERAD I STAGING. Installeras efter T4-A + notisdelen + T4-B (20261128000011), i en
-- egen serveromgång eller direkt efter T4-B. Rollback: supabase/rollback/T4-C/rollback_t4c.sql
-- (körs FÖRE T4-B:s rollback; T4-D:s rollback, om T4-D är installerad, körs före denna).
--
-- Beslut: D-05, D-16, D-23 (BESLUT-2026-11-27), "Tillägg efter T3-leveransen" (BESLUT-2026-11-28):
-- T4-C. Testfall: BEHORIGHETSMATRIS §5.9 (SEC-B5-06..13). Testgrupp `access_info`
-- (tests/t4c_atkomstinformation.test.js).
--
-- Innehåll:
--   1. sensitive_fields_read (ny RPC, bara service_role): get-sensitive-fields gör behörighets-
--      kontrollen, läsningen och revisionsraden i EN transaktion. objects_sensitive/all: som förut.
--      objects_access_assigned (verkställs nu): bara objektet eller fastigheten på en EGEN TILLDELAD
--      AKTIV AO (status nytt/planerad/pågående, inte låst, inte pool) eller — när rondering_utfor är
--      verkställd (T4-D) — fastigheten på ett eget tilldelat aktivt ronderingspass. Kontrollen görs
--      med vift_workOrders och vift_ronderingspass låsta (FOR SHARE). Varje uttag ger exakt en
--      revisionsrad (allowed eller denied) UTAN värden (bara fältnamn, väg och orsak).
--   2. D-23: triggern _vift_t4c_kanslig_radering på store: när ett objekt (vift_propertyObjects) eller
--      en fastighet (vift_properties) tas bort ur sin lista (permanent radering) tas den känsliga
--      raden i property_sensitive_access bort i SAMMA transaktion, med en revisionsrad utan värden.
--      Arkivering, inaktivering och mjuk radering (elementet finns kvar) behåller raden.
--      store_business_key_write/_merge_write sätter aktören (set_config 'vift.aktor') för raden.
--   3. _vift_ej_verkstallda: objects_access_assigned verkställd (rondering_utfor kvar till T4-D).
--   D-16 (förberedelse, bara läsning) ligger INTE här: supabase/manual/t4c_d16_jamforelse/.
--
-- Låsordning: vift_workOrders (FOR SHARE) → vift_ronderingspass (FOR SHARE); inga andra lås. Ingen
-- befintlig väg tar dessa i omvänd ordning (rondering-RPC:erna låser bara vift_ronderingspass).
-- Felkoder (BEHORIGHETSMATRIS §4): 403 forbidden (behörighet saknas), 403 forbidden/not_assigned
-- (inte egen tilldelad aktiv AO eller pass), 400 missing_fields, 500 audit_unavailable.
--
-- Datamigrering: ingen. Inga portkoder flyttas eller tas bort (D-16); bara permanent radering
-- framåt tar bort en rad (D-23).
--
-- STOP-kontroll: T4-B installerad, T4-C inte installerad, och varje ersatt funktion har exakt den
-- föregående versionen (md5 nedan = repokedjan; tests/local/t4-andringar.json).
-- ============================================================
begin;

do $$
declare v text; r record;
begin
  if to_regprocedure('public.sensitive_fields_read(text,text,text,text,text,text[],uuid,text)') is not null then
    raise exception 'T4-C STOP: sensitive_fields_read finns redan — T4-C är redan installerad; kör inte igen';
  end if;
  if to_regprocedure('public._vift_t4b_pris_las(text[])') is null then
    raise exception 'T4-C STOP: T4-B (20261128000011) måste vara installerad först (MIGRATIONSORDNING.txt)';
  end if;
  if to_regclass('public.property_sensitive_access') is null or to_regclass('public.sensitive_access_audit') is null then
    raise exception 'T4-C STOP: property_sensitive_access/sensitive_access_audit saknas';
  end if;
  for r in select * from (values
      ('public._vift_ej_verkstallda()', '135587f6c8d5b53c67d12b9762cbfaef'),
      ('public.store_business_key_write(text,jsonb,text,boolean,text,jsonb)', '721e9845a052c7d5e703cadf31ac38a9'),
      ('public.store_business_key_merge_write(text,jsonb,jsonb,boolean,text,jsonb)', '1e3f1a8b115fdca16bf5b1f7aac95cab')) t(sig, md5) loop
    v := md5(pg_get_functiondef(r.sig::regprocedure));
    if v <> r.md5 then raise exception 'T4-C STOP: % avviker från föregående version (md5 %, väntat %)', r.sig, v, r.md5; end if;
  end loop;
end $$;

-- ── 1. Regelfunktioner (bara service_role) ───────────────────────────

/* Aktiv AO för åtkomstinformation (D-05, SEC-B5-06/08): status nytt, planerad eller pågående, inte
   låst (fakturerad, avbruten, arkiverad, borttagen, fakturakopplad). Klar AO och pool ger inget. */
create or replace function public._vift_t4c_ao_aktiv(p_ao jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(p_ao) = 'object'
     and coalesce(p_ao ->> 'status', '') in ('nytt', 'planerad', 'pågående')
     and not public._vift_ao_locked(p_ao)
$$;

/* Aktivt ronderingspass: planerat eller pågående (inte slutfört, inte har_avvikelser). */
create or replace function public._vift_t4c_pass_aktiv(p_pass jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(p_pass) = 'object' and coalesce(p_pass ->> 'status', '') in ('planerat', 'pågående')
$$;

/* Tilldelat pass: anroparens personal-id i staffIds. */
create or replace function public._vift_t4c_pass_tilldelad(p_pass jsonb, p_staff_id text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_staff_id, '') <> '' and jsonb_typeof(p_pass -> 'staffIds') = 'array' and (p_pass -> 'staffIds') ? p_staff_id
$$;

/* Ronderingsgrenen gäller först när rondering_utfor är VERKSTÄLLD (borttagen ur _vift_ej_verkstallda
   i T4-D). Före dess är grenen avstängd även för en roll som har behörigheten. */
create or replace function public._vift_t4c_rondering_aktiv(p_perms text[])
returns boolean language sql stable set search_path = public as $$
  select 'rondering_utfor' = any(coalesce(p_perms, '{}')) and not ('rondering_utfor' = any(public._vift_ej_verkstallda()))
$$;

-- ── 2. sensitive_fields_read: kontroll, läsning och revisionsrad i EN transaktion ────────────
create or replace function public.sensitive_fields_read(
  p_object_id text, p_property_id text, p_work_order_id text, p_pass_id text,
  p_caller_staff_id text, p_caller_perms text[], p_user_id uuid, p_user_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p        text[] := coalesce(p_caller_perms, '{}');
  v_me     text := coalesce(p_caller_staff_id, '');
  v_obj    text := nullif(trim(coalesce(p_object_id, '')), '');
  v_prop   text := nullif(trim(coalesce(p_property_id, '')), '');
  v_ao_id  text := nullif(trim(coalesce(p_work_order_id, '')), '');
  v_pass_id text := nullif(trim(coalesce(p_pass_id, '')), '');
  v_via    text;
  v_reason text;
  v_row    public.property_sensitive_access%rowtype;
  v_fields text[] := '{}';
  v_out    jsonb;
  v_audit  uuid;
  v_ts     timestamptz;
begin
  if v_obj is null and v_prop is null then raise exception 'missing_fields'; end if;
  if p_user_id is null or nullif(p_user_email, '') is null then raise exception 'identity_required'; end if;

  -- Tilldelningen kan inte ändras mellan kontrollen och revisionsraden (fast ordning, delade lås).
  perform 1 from public.store where key = 'vift_workOrders' for share;
  perform 1 from public.store where key = 'vift_ronderingspass' for share;
  v_ts := clock_timestamp();

  if 'all' = any(p) or 'objects_sensitive' = any(p) then
    v_via := 'objects_sensitive';
  elsif 'objects_access_assigned' = any(p) and v_me <> '' then
    -- Egen tilldelad aktiv AO på objektet (objekt-id) eller fastigheten (fastighetsnivå).
    select 'ao:' || (e ->> 'id') into v_via
      from public.store st, jsonb_array_elements(case when jsonb_typeof(st.value) = 'array' then st.value else '[]'::jsonb end) e
     where st.key = 'vift_workOrders' and jsonb_typeof(e) = 'object'
       and (v_ao_id is null or e ->> 'id' = v_ao_id) and v_pass_id is null
       and public._vift_ao_assigned(e, v_me) and public._vift_t4c_ao_aktiv(e)
       and case when v_obj is not null then coalesce(e ->> 'objectId', '') = v_obj else coalesce(e ->> 'propertyId', '') = v_prop end
     limit 1;
    -- Eget tilldelat aktivt ronderingspass på fastigheten (bara fastighetsnivå; aktiv först i T4-D).
    if v_via is null and v_obj is null and v_ao_id is null and public._vift_t4c_rondering_aktiv(p) then
      select 'pass:' || (e ->> 'id') into v_via
        from public.store st, jsonb_array_elements(case when jsonb_typeof(st.value) = 'array' then st.value else '[]'::jsonb end) e
       where st.key = 'vift_ronderingspass' and jsonb_typeof(e) = 'object'
         and (v_pass_id is null or e ->> 'id' = v_pass_id)
         and public._vift_t4c_pass_tilldelad(e, v_me) and public._vift_t4c_pass_aktiv(e)
         and coalesce(e ->> 'propertyId', '') = v_prop
       limit 1;
    end if;
    if v_via is null then v_reason := 'not_assigned'; end if;
  else
    v_reason := 'forbidden';
  end if;

  if v_reason is not null then
    -- Nekat uttag: exakt en revisionsrad utan värden.
    insert into public.sensitive_access_audit (ts, user_id, user_email, action, object_id, property_id, fields, status, detail)
    values (v_ts, p_user_id, lower(p_user_email), 'read', v_obj, case when v_obj is null then v_prop else null end, '{}', 'denied',
            case v_reason when 'forbidden' then 'objects_sensitive/objects_access_assigned saknas'
                          else 'not_assigned' || coalesce(' ao:' || v_ao_id, '') || coalesce(' pass:' || v_pass_id, '') end)
    returning id into v_audit;
    return jsonb_build_object('ok', false, 'reason', v_reason, 'audit_id', v_audit);
  end if;

  if v_obj is not null then
    select * into v_row from public.property_sensitive_access where object_id = v_obj order by updated_at desc limit 1;
  else
    select * into v_row from public.property_sensitive_access where property_id = v_prop and object_id is null order by updated_at desc limit 1;
  end if;

  -- objects_sensitive: alla sex fält (som förut). Tilldelad väg: den åtkomstinformation som behövs
  -- för uppdraget (portkod, nyckel, tillträde, larm, kod) — inte nyckelkvittensen.
  v_out := jsonb_build_object(
    'doorCode', v_row.door_code, 'keyInformation', v_row.key_information,
    'keyReceipt', case when v_via = 'objects_sensitive' then v_row.key_receipt else null end,
    'alarmInformation', v_row.alarm_information, 'accessInformation', v_row.access_information,
    'accessCode', v_row.access_code);
  select coalesce(array_agg(k order by array_position(array['doorCode','keyInformation','keyReceipt','alarmInformation','accessInformation','accessCode'], k)), '{}')
    into v_fields from jsonb_each(v_out) x(k, v) where jsonb_typeof(v) = 'string' and v #>> '{}' <> '';

  insert into public.sensitive_access_audit (ts, user_id, user_email, action, object_id, property_id, fields, status, detail)
  values (v_ts, p_user_id, lower(p_user_email), 'read', v_obj, case when v_obj is null then v_prop else null end, v_fields, 'allowed', v_via)
  returning id into v_audit;
  if v_audit is null then raise exception 'audit_unavailable'; end if;

  return jsonb_build_object('ok', true, 'via', v_via, 'audit_id', v_audit, 'fields', v_out);
end $$;

-- ── 3. D-23: permanent radering tar bort den känsliga raden i samma transaktion ────────────
create or replace function public._vift_t4c_kanslig_radering()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id text;
  v_row public.property_sensitive_access%rowtype;
  v_aktor text := nullif(current_setting('vift.aktor', true), '');
  v_uid uuid;
  v_mail text;
  v_fields text[];
begin
  if tg_op <> 'UPDATE' or new.value is not distinct from old.value then return null; end if;
  if v_aktor is not null then
    select au.id, lower(au.email) into v_uid, v_mail
      from public.app_users ap join auth.users au on au.id = ap.user_id
     where ap.staff_id = v_aktor limit 1;
  end if;
  for v_id in
    select x from (
      select o ->> 'id' x from jsonb_array_elements(case when jsonb_typeof(old.value) = 'array' then old.value else '[]'::jsonb end) o
       where jsonb_typeof(o) = 'object' and coalesce(o ->> 'id', '') <> ''
      except
      select n ->> 'id' from jsonb_array_elements(case when jsonb_typeof(new.value) = 'array' then new.value else '[]'::jsonb end) n
       where jsonb_typeof(n) = 'object' and coalesce(n ->> 'id', '') <> '') d
    order by x
  loop
    perform pg_advisory_xact_lock(hashtextextended('vift.psa:' || case when new.key = 'vift_propertyObjects' then 'o:' else 'p:' end || v_id, 0));
    for v_row in
      delete from public.property_sensitive_access
       where case when new.key = 'vift_propertyObjects' then object_id = v_id else property_id = v_id and object_id is null end
      returning *
    loop
      select coalesce(array_agg(k order by o), '{}') into v_fields from unnest(array['doorCode','keyInformation','keyReceipt','alarmInformation','accessInformation','accessCode'],
        array[v_row.door_code, v_row.key_information, v_row.key_receipt, v_row.alarm_information, v_row.access_information, v_row.access_code]) with ordinality u(k, v, o)
       where coalesce(v, '') <> '';
      insert into public.sensitive_access_audit (user_id, user_email, action, object_id, property_id, fields, status, detail)
      values (v_uid, coalesce(v_mail, case when v_aktor is null then null else 'personal:' || v_aktor end), 'write',
              v_row.object_id, v_row.property_id, v_fields, 'allowed',
              'permanent_delete (' || new.key || ', D-23)');
    end loop;
  end loop;
  return null;
end $$;

create trigger vift_t4c_kanslig_radering after update on public.store
  for each row when (new.key in ('vift_propertyObjects', 'vift_properties'))
  execute function public._vift_t4c_kanslig_radering();

-- ── 4. Ersatta funktioner (samma signatur) ─────────────────────────────

/* T4-C: objects_access_assigned verkställd (get-sensitive-fields → sensitive_fields_read). */
create or replace function public._vift_ej_verkstallda()
returns text[] language sql immutable set search_path = public as $$
  select array['ao_plan_own','rondering_utfor','export_data','export_personal_data']
$$;

/* T4-C (D-23): aktören för revisionsraden vid permanent radering (set_config 'vift.aktor', transaktionslokal). Annars oförändrad. */
CREATE OR REPLACE FUNCTION public.store_business_key_write(p_key text, p_new_value jsonb, p_expected_hash text, p_caller_authorized boolean, p_actor_id text, p_klient jsonb DEFAULT NULL::jsonb)
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
  v_staff0          jsonb;
  v_roles0          jsonb;
  v_perms           text[];
begin
  -- T4-C (D-23): aktören (personal-id) för revisionsraden när en permanent radering av ett objekt eller
  -- en fastighet tar bort den känsliga raden (triggern _vift_t4c_kanslig_radering, samma transaktion).
  perform set_config('vift.aktor', coalesce(p_actor_id, ''), true);
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

  -- T3-C: personal- och rollregistret under det gemensamma låset (fast ordning).
  if p_key in ('vift_staff', 'vift_roles') then
    perform public._vift_superadmin_lock();
    select value into v_staff0 from public.store where key = 'vift_staff';
    select value into v_roles0 from public.store where key = 'vift_roles';
  end if;

  select value into v_current_value from public.store where key = p_key for update;
  v_current_hash := encode(sha256(convert_to(coalesce(v_current_value, 'null'::jsonb)::text, 'UTF8')), 'hex');

  if v_current_value is not null and (p_expected_hash is null or length(trim(p_expected_hash)) = 0) then
    raise exception 'missing_expected_hash';
  end if;
  if v_current_value is not null and v_current_hash is distinct from p_expected_hash then
    raise exception 'stale_write';
  end if;

  -- T4-A (B5, D-13, D-17, D-01): fältvis sammanslagning av skyddade fält, på det låsta värdet,
  -- med anroparens behörigheter lästa i samma transaktion. Projicerat värde raderar aldrig.
  if array_length(public._vift_t4a_falt(p_key), 1) > 0 then
    v_perms := public._vift_t4a_aktor_perms(p_actor_id);
    if jsonb_typeof(p_new_value) = 'object' then
      p_new_value := public._vift_t4a_sammanfoga(p_key, v_current_value, p_new_value, v_perms);
    else
      p_new_value := public._vift_t4a_sammanfoga_lista(p_key, v_current_value, p_new_value, v_perms);
    end if;
  end if;
  -- T4-A (T3-E-beslutet): en äldre klient tappar inga behörigheter som dess rolleditor inte känner.
  if p_key = 'vift_roles' and jsonb_typeof(p_new_value) = 'array' then
    p_new_value := coalesce((select jsonb_agg(case when jsonb_typeof(n.e) = 'object'
        then public._vift_t4a_roller_bevara(public._vift_reg_get(v_current_value, n.e ->> 'id'), n.e, p_klient) else n.e end order by n.o)
      from jsonb_array_elements(p_new_value) with ordinality n(e, o)), '[]'::jsonb);
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

  -- T3-C: eskaleringsregeln och invarianten på det slutliga värdet.
  if p_key = 'vift_staff' then
    perform public._vift_authz_check(p_key, v_staff0, v_roles0, p_new_value, v_roles0, p_actor_id);
  elsif p_key = 'vift_roles' then
    perform public._vift_authz_check(p_key, v_staff0, v_roles0, v_staff0, p_new_value, p_actor_id);
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

/* T4-C (D-23): som store_business_key_write. Annars oförändrad. */
CREATE OR REPLACE FUNCTION public.store_business_key_merge_write(p_key text, p_upserts jsonb, p_removals jsonb, p_caller_authorized boolean, p_actor_id text, p_klient jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_required_perm text;
  v_current       jsonb;
  v_now           timestamptz := clock_timestamp();
  v_now_text      text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_elem          jsonb;
  v_idx           int;
  v_cur_elem      jsonb;
  v_conflicts     jsonb := '[]'::jsonb;
  v_applied       jsonb := '[]'::jsonb;
  v_removed       jsonb := '[]'::jsonb;
  v_id            text;
  v_previous      jsonb;
  v_new_data      jsonb;
  v_dup_count     int;
  v_pre_removal_len int;
  v_requested_removal_count int;
  v_staff0        jsonb;
  v_roles0        jsonb;
  v_skyddad       boolean := array_length(public._vift_t4a_falt(p_key), 1) > 0;
  v_perms         text[];
  v_proj          jsonb;
  v_ref           jsonb;
begin
  -- T4-C (D-23): aktören (personal-id) för revisionsraden när en permanent radering av ett objekt eller
  -- en fastighet tar bort den känsliga raden (triggern _vift_t4c_kanslig_radering, samma transaktion).
  perform set_config('vift.aktor', coalesce(p_actor_id, ''), true);
  p_caller_authorized := coalesce(p_caller_authorized, false);

  if p_key is null or p_actor_id is null or length(trim(p_actor_id)) = 0 then
    raise exception 'missing_fields';
  end if;

  v_required_perm := public._staging_business_key_required_perm(p_key);
  if v_required_perm is null then
    raise exception 'key_not_allowlisted';
  end if;
  if not p_caller_authorized then
    raise exception 'forbidden';
  end if;

  -- T3-C: personal- och rollregistret under det gemensamma låset (fast ordning).
  if p_key in ('vift_staff', 'vift_roles') then
    perform public._vift_superadmin_lock();
    select value into v_staff0 from public.store where key = 'vift_staff';
    select value into v_roles0 from public.store where key = 'vift_roles';
  end if;

  select value into v_current from public.store where key = p_key for update;
  if v_skyddad then v_perms := public._vift_t4a_aktor_perms(p_actor_id); end if;

  -- T4-A (D-17, SEC-INST-04/05): vift_settings sammanfogas FÄLT FÖR FÄLT under radlåset.
  -- upserts: {id: fältnamn, data: värde, previous: senast lästa (projicerade) värde};
  -- removals: {id: fältnamn, previous}. Olika fält från samtidiga sessioner tappas aldrig;
  -- samma fält med inaktuell previous blir en konflikt (serverValue projiceras av EF:en).
  if p_key = 'vift_settings' then
    if v_current is null then v_current := '{}'::jsonb; end if;
    if jsonb_typeof(v_current) is distinct from 'object' then raise exception 'not_array_key'; end if;
    v_proj := public._vift_t4a_projicera_elem(p_key, v_current, v_perms);
    for v_elem in select * from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) loop
      v_id := v_elem ->> 'id'; v_new_data := v_elem -> 'data'; v_previous := v_elem -> 'previous';
      if v_previous is not null and jsonb_typeof(v_previous) = 'null' then v_previous := null; end if;
      if v_id is null or length(trim(v_id)) = 0 or v_new_data is null then raise exception 'invalid_element'; end if;
      if v_previous is distinct from (v_proj -> v_id) then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', 'changed_by_other_session'));
        continue;
      end if;
      -- Skyddat fält: samma regel som hela värdet (oförändrat läsbart värde godtas, annars 403).
      -- Ny bild = det anroparen ser + fältet; oläsbara fält återställs från servern av sammanslagningen.
      v_current := public._vift_t4a_sammanfoga(p_key, v_current,
        public._vift_t4a_projicera_elem(p_key, v_current, v_perms) || jsonb_build_object(v_id, v_new_data), v_perms);
      v_applied := v_applied || jsonb_build_array(v_id);
    end loop;
    for v_elem in select * from jsonb_array_elements(coalesce(p_removals, '[]'::jsonb)) loop
      v_id := v_elem ->> 'id'; v_previous := v_elem -> 'previous';
      if v_previous is not null and jsonb_typeof(v_previous) = 'null' then v_previous := null; end if;
      if v_id is null or length(trim(v_id)) = 0 then raise exception 'invalid_element'; end if;
      if not (v_current ? v_id) then continue; end if;
      if v_previous is distinct from (v_proj -> v_id) then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', 'changed_by_other_session'));
        continue;
      end if;
      if not public._vift_t4a_kan_skriva(p_key, v_id, v_current, v_perms) then raise exception 'forbidden:field_protected'; end if;
      v_current := v_current - v_id;
      v_removed := v_removed || jsonb_build_array(v_id);
    end loop;
    update public.store set value = v_current, updated_at = v_now where key = p_key;
    if not found then insert into public.store(key, value, updated_at) values (p_key, v_current, v_now); end if;
    insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
      on conflict (key) do update set value = excluded.value, updated_at = v_now;
    return jsonb_build_object('key', p_key, 'applied', v_applied, 'removed', v_removed, 'conflicts', v_conflicts,
      'current', v_current, 'serverSignature', v_now_text);
  end if;

  if v_current is null then
    insert into public.store(key, value, updated_at) values (p_key, '[]'::jsonb, v_now)
      on conflict (key) do nothing;
    v_current := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_current) is distinct from 'array' then
    raise exception 'not_array_key';
  end if;

  for v_elem in select * from jsonb_array_elements(coalesce(p_upserts, '[]'::jsonb)) loop
    v_id       := v_elem ->> 'id';
    v_new_data := v_elem -> 'data';
    v_previous := v_elem -> 'previous';
    if v_previous is not null and jsonb_typeof(v_previous) = 'null' then
      v_previous := null;
    end if;
    if v_id is null or length(trim(v_id)) = 0 or v_new_data is null then
      raise exception 'invalid_element';
    end if;

    select count(*) into v_dup_count from jsonb_array_elements(v_current) elem where elem ->> 'id' = v_id;
    if v_dup_count > 1 then
      raise exception 'duplicate_id_in_store';
    end if;

    v_idx := null; v_cur_elem := null;
    select (ord - 1)::int, elem into v_idx, v_cur_elem
      from jsonb_array_elements(v_current) with ordinality as t(elem, ord)
      where elem ->> 'id' = v_id
      limit 1;

    if v_idx is null then
      if v_previous is not null then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', 'removed_by_other_session'));
        continue;
      end if;
      -- T4-A: ett nytt element får inte bära skyddade fält som anroparen inte får skriva.
      if v_skyddad then v_new_data := public._vift_t4a_sammanfoga(p_key, null, v_new_data, v_perms); end if;
      v_current := v_current || jsonb_build_array(v_new_data);
      v_applied := v_applied || jsonb_build_array(v_id);
    else
      -- T4-A: `previous` jämförs med serverns element SÅ SOM ANROPAREN FÅR SE DET (projicerat), så
      -- att en klient som aldrig fått de skyddade fälten kan spara utan att känna dem.
      v_ref := case when v_skyddad then public._vift_t4a_projicera_elem(p_key, v_cur_elem, v_perms) else v_cur_elem end;
      if v_previous is distinct from v_ref then
        v_conflicts := v_conflicts || jsonb_build_array(
          jsonb_build_object('id', v_id, 'reason', 'changed_by_other_session', 'serverValue', v_cur_elem)
        );
        continue;
      end if;
      if v_skyddad then v_new_data := public._vift_t4a_sammanfoga(p_key, v_cur_elem, v_new_data, v_perms); end if;
      if p_key = 'vift_roles' then v_new_data := public._vift_t4a_roller_bevara(v_cur_elem, v_new_data, p_klient); end if;
      v_current := jsonb_set(v_current, array[v_idx::text], v_new_data);
      v_applied := v_applied || jsonb_build_array(v_id);
    end if;
  end loop;

  v_pre_removal_len := jsonb_array_length(v_current);
  v_requested_removal_count := jsonb_array_length(coalesce(p_removals, '[]'::jsonb));
  if v_pre_removal_len > 5 and v_requested_removal_count >= v_pre_removal_len then
    raise exception 'mass_wipe_blocked';
  end if;
  if v_pre_removal_len > 10 and (v_pre_removal_len - v_requested_removal_count)::numeric < (v_pre_removal_len::numeric * 0.1) then
    raise exception 'mass_wipe_blocked';
  end if;

  for v_elem in select * from jsonb_array_elements(coalesce(p_removals, '[]'::jsonb)) loop
    v_id       := v_elem ->> 'id';
    v_previous := v_elem -> 'previous';
    if v_previous is not null and jsonb_typeof(v_previous) = 'null' then
      v_previous := null;
    end if;
    if v_id is null or length(trim(v_id)) = 0 then
      raise exception 'invalid_element';
    end if;

    select count(*) into v_dup_count from jsonb_array_elements(v_current) elem where elem ->> 'id' = v_id;
    if v_dup_count > 1 then
      raise exception 'duplicate_id_in_store';
    end if;

    v_idx := null; v_cur_elem := null;
    select (ord - 1)::int, elem into v_idx, v_cur_elem
      from jsonb_array_elements(v_current) with ordinality as t(elem, ord)
      where elem ->> 'id' = v_id
      limit 1;

    if v_idx is null then
      continue;
    end if;

    v_ref := case when v_skyddad then public._vift_t4a_projicera_elem(p_key, v_cur_elem, v_perms) else v_cur_elem end;
    if v_previous is distinct from v_ref then
      v_conflicts := v_conflicts || jsonb_build_array(
        jsonb_build_object('id', v_id, 'reason', 'changed_by_other_session', 'serverValue', v_cur_elem)
      );
      continue;
    end if;

    v_current := v_current - v_idx;
    v_removed := v_removed || jsonb_build_array(v_id);
  end loop;

  -- T3-C: eskaleringsregeln och invarianten på det slutliga värdet (efter sammanslagning).
  if p_key = 'vift_staff' then
    perform public._vift_authz_check(p_key, v_staff0, v_roles0, v_current, v_roles0, p_actor_id);
  elsif p_key = 'vift_roles' then
    perform public._vift_authz_check(p_key, v_staff0, v_roles0, v_staff0, v_current, p_actor_id);
  end if;

  update public.store set value = v_current, updated_at = v_now where key = p_key;

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object(
    'key', p_key,
    'applied', v_applied,
    'removed', v_removed,
    'conflicts', v_conflicts,
    'current', v_current,
    'serverSignature', v_now_text
  );
end;
$function$;

-- ── Rättigheter: nya funktioner bara service_role (Edge Functions); triggerfunktionen ingen.
--    De ersatta funktionerna behåller sina rättigheter (CREATE OR REPLACE ändrar inte ACL). ─────
do $$
declare f text;
begin
  foreach f in array array[
    'public._vift_t4c_ao_aktiv(jsonb)', 'public._vift_t4c_pass_aktiv(jsonb)', 'public._vift_t4c_pass_tilldelad(jsonb,text)',
    'public._vift_t4c_rondering_aktiv(text[])',
    'public.sensitive_fields_read(text,text,text,text,text,text[],uuid,text)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  revoke all on function public._vift_t4c_kanslig_radering() from public, anon, authenticated, service_role;
end $$;

commit;
