-- ============================================================
-- T3-C (2026-11-28): roller och superadmin. NY – EJ INSTALLERAD I STAGING.
--
-- Beslut: D-14, D-21, D-25, D-26 (docs/qa-2026-11-27/BESLUT-2026-11-27.md),
-- T3-C i docs/qa-2026-11-28/BESLUT-2026-11-28.md. Rättar SÄK-8 (F5).
-- Testfall: BEHORIGHETSMATRIS §5.7 (SEC-ROLL-01–09, SEC-B3-03/05/06) och §5.13
-- (SEC-CUST-18/19/22/23).
--
-- Innehåll:
--   1. Regelfunktioner (_vift_*), bara service_role:
--        _vift_rec_active, _vift_role_perms, _vift_identity_perms,
--        _vift_superadmin_count, _vift_superadmin_lock, _vift_authz_check.
--      "Superadmin" avgörs ENBART av behörigheten 'all' i rollens permissions,
--      aldrig av roll-id eller rollnamn (SEC-ROLL-08/09).
--      En AKTIV användare = app_users.active, och auth-e-posten matchar den första
--      aktiva personalposten med samma e-post (samma regel som checkViftAuth).
--   2. store_business_key_write / store_business_key_merge_write (SAMMA SIGNATUR):
--      för vift_staff och vift_roles tas det gemensamma låset och
--      _vift_authz_check körs på det slutliga värdet, i samma transaktion som
--      skrivningen:
--        - anroparens behörigheter läses om under låset (personalpost via id,
--          aktiv app_users-rad, rollens permissions) — inte EF:ens bild;
--        - 403 forbidden/privilege_escalation: egen roll ändras (rollbyte i
--          personalregistret eller ändrade permissions i den egna rollen), eller
--          någon (post, roll eller inloggad identitet) får behörighet utöver
--          anroparens;
--        - 403 forbidden/superadmin_required: 'all' eller en roll/post med 'all'
--          tilldelas, ändras eller tas bort av någon som inte själv har 'all';
--        - 409 last_superadmin: ändringen ger 0 aktiva användare med 'all'
--          (gäller även superadmin).
--   3. deactivate_vift_user / provision_vift_user (SAMMA SIGNATUR): samma lås och
--      invarianten "minst en aktiv användare med 'all'" (409 last_superadmin).
--   4. Projektion (D-21, D-14): vift_store_full_access, vift_store_project och
--      store_read_all_with_hashes_projected. vift_store_project och
--      store_read_all_with_hashes_projected får parametern p_caller_staff_id
--      (default null). Utan admin_manage: vift_roles = bara den egna rollen
--      (med staff_manage även de roller anroparen får tilldela). Utan
--      staff_manage/admin_manage: andras 'permissions' i vift_staff tas bort, och
--      andras 'role' tas bort om anroparen saknar staff_view. REST-läsning av
--      vift_staff/vift_roles (RLS store_read_by_role) stängs för övriga.
--      ÖVERGÅNG: p_caller_staff_id = null (äldre store-key-write utan identitet,
--      bara under minuterna mellan databas- och EF-installationen) ger det
--      tidigare utfallet för vift_roles och tar bara bort 'permissions' ur
--      vift_staff, så att inloggningen fungerar. Den nya EF:en skickar alltid id.
--
-- LÅSORDNING (fast, alla vägar i detta paket):
--   1) pg_advisory_xact_lock(hashtextextended('vift:roles+staff', 0))
--   2) store-raden vift_roles FOR UPDATE  3) store-raden vift_staff FOR UPDATE
--   4) app_users-rader (deactivate/provision)  5) vift_lastChanged (sist, vid skrivning).
--   T3-B:s RPC:er tar aldrig 1)–4) (de LÄSER vift_staff/vift_roles utan lås, MVCC) och
--   T3-C:s vägar tar aldrig T3-B:s lås (vift_workOrders, vift_timeEntries,
--   vift_invoices, stamp_status, rådgivande lås för stämpling). vift_lastChanged tas
--   alltid sist av alla. Därför kan ingen cykel (deadlock) uppstå mellan paketen.
--
-- Felkoder (BEHORIGHETSMATRIS §4): RAISE 'forbidden:<reason>' → EF 403
-- {error:'forbidden', reason}; 'last_superadmin' → EF 409 {error:'last_superadmin'}.
-- En äldre store-key-write tolkar 'forbidden:*' som 403 forbidden (utan reason) och
-- 'last_superadmin' som 500 write_failed (bara under installationsfönstret).
--
-- STOP-kontroll: de ersatta funktionerna måste ha den driftversion som är verifierad mot
-- STAGING (md5 ur staging-schema-facit-2026-11-25.json) eller repokedjans version (samma
-- kod, andra kommentarer). Rollback: supabase/rollback/T3-C/rollback_t3c.sql (återställer
-- STAGING-definitionerna exakt; rör ingen data).
-- ============================================================
begin;

do $$
declare v text;
begin
  if to_regprocedure('public._vift_authz_check(text,jsonb,jsonb,jsonb,jsonb,text)') is not null then
    raise exception 'T3-C STOP: _vift_authz_check finns redan — T3-C är redan installerad; kör inte igen';
  end if;
  if to_regprocedure('public.vift_store_project(text,jsonb,text[])') is null then
    raise exception 'T3-C STOP: vift_store_project(3 argument) saknas — oväntad version';
  end if;
  v := md5(pg_get_functiondef('public.store_business_key_write(text,jsonb,text,boolean,text)'::regprocedure));
  if v not in ('54a129cea2b853e89aa6e618bc30aba2') then
    raise exception 'T3-C STOP: store_business_key_write avviker från verifierad STAGING-version (md5 %)', v;
  end if;
  v := md5(pg_get_functiondef('public.store_business_key_merge_write(text,jsonb,jsonb,boolean,text)'::regprocedure));
  if v not in ('4fd792cdc09e82426d0bf9a564fe06a4') then
    raise exception 'T3-C STOP: store_business_key_merge_write avviker (md5 %)', v;
  end if;
  v := md5(pg_get_functiondef('public.provision_vift_user(uuid,text,text,boolean)'::regprocedure));
  if v not in ('d9e14e7d9aa92ff2eb18e212e2448b64') then
    raise exception 'T3-C STOP: provision_vift_user avviker (md5 %)', v;
  end if;
  v := md5(pg_get_functiondef('public.deactivate_vift_user(uuid)'::regprocedure));
  if v not in ('dae162bff82895b89685ea127edb1119') then
    raise exception 'T3-C STOP: deactivate_vift_user avviker (md5 %)', v;
  end if;
  v := md5(pg_get_functiondef('public.vift_store_full_access(text,text[])'::regprocedure));
  if v not in ('da865f7026c06f9360fec6d075c99650') then
    raise exception 'T3-C STOP: vift_store_full_access avviker (md5 %)', v;
  end if;
  v := md5(pg_get_functiondef('public.vift_store_project(text,jsonb,text[])'::regprocedure));
  if v not in ('142b9d5dfecc470d5decfae0e7f991ea', '0fde9e696f852df10df8a72aa6a89d1f') then
    raise exception 'T3-C STOP: vift_store_project avviker (md5 %)', v;
  end if;
  v := md5(pg_get_functiondef('public.store_read_all_with_hashes_projected(text[],text[])'::regprocedure));
  if v not in ('3a9fe3c22193bb454c5a43bb06ee38c9') then
    raise exception 'T3-C STOP: store_read_all_with_hashes_projected avviker (md5 %)', v;
  end if;
end $$;

-- ── 1. Regelfunktioner ───────────────────────────────────────────────

/* Personalpost aktiv: samma tolkning som vift_caller_perms (false/0/tom = inaktiv). */
create or replace function public._vift_rec_active(p_rec jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(p_rec) = 'object' and coalesce(p_rec ->> 'active', 'false') not in ('false', '0', '')
$$;

/* Rollens behörigheter: FÖRSTA rollen med id:t (som checkViftAuth: roles.find), och bara
   om dess permissions är en lista. Okänd roll = inga behörigheter (fail-closed). */
create or replace function public._vift_role_perms(p_roles jsonb, p_role_id text)
returns text[] language sql immutable set search_path = public as $$
  with r as (
    select x.e from jsonb_array_elements(case when jsonb_typeof(p_roles) = 'array' then p_roles else '[]'::jsonb end) with ordinality x(e, o)
    where jsonb_typeof(x.e) = 'object' and x.e ->> 'id' = p_role_id
    order by x.o limit 1)
  select coalesce((select case when jsonb_typeof(r.e -> 'permissions') = 'array'
      then array(select jsonb_array_elements_text(r.e -> 'permissions')) else '{}'::text[] end from r), '{}'::text[])
$$;

/* Varje AKTIV inloggningsidentitet (app_users.active) med de behörigheter den får med
   personal-/rollvärdena p_staff/p_roles: första aktiva personalposten med samma e-post
   (i registrets ordning), därefter rollens permissions. Samma regel som checkViftAuth. */
create or replace function public._vift_identity_perms(p_staff jsonb, p_roles jsonb)
returns table(user_id uuid, perms text[]) language sql stable set search_path = public as $$
  select au.user_id,
    coalesce((
      select public._vift_role_perms(p_roles, s.e ->> 'role')
      from jsonb_array_elements(case when jsonb_typeof(p_staff) = 'array' then p_staff else '[]'::jsonb end) with ordinality s(e, o)
      where public._vift_rec_active(s.e) and nullif(s.e ->> 'email', '') is not null and lower(s.e ->> 'email') = lower(u.email)
      order by s.o limit 1), '{}'::text[])
  from public.app_users au join auth.users u on u.id = au.user_id
  where au.active = true and nullif(u.email, '') is not null
$$;

/* Antal aktiva användare med 'all' (invarianten D-25: minst en). */
create or replace function public._vift_superadmin_count(p_staff jsonb, p_roles jsonb)
returns integer language sql stable set search_path = public as $$
  select count(*)::int from public._vift_identity_perms(p_staff, p_roles) i where 'all' = any(i.perms)
$$;

/* Det gemensamma låset för vift_staff + vift_roles + app_users (fast ordning, se huvudet). */
create or replace function public._vift_superadmin_lock()
returns void language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('vift:roles+staff', 0));
  perform 1 from public.store where key = 'vift_roles' for update;
  perform 1 from public.store where key = 'vift_staff' for update;
end;
$$;

/* Antal "trasiga" element (inte objekt med icke-tomt id, eller dubbla id). En skrivning
   får inte införa nya sådana i personal- eller rollregistret. */
create or replace function public._vift_reg_bad_count(p_arr jsonb)
returns integer language sql immutable set search_path = public as $$
  with e as (select x.e from jsonb_array_elements(case when jsonb_typeof(p_arr) = 'array' then p_arr else '[]'::jsonb end) x(e))
  select (select count(*) from e where jsonb_typeof(e.e) <> 'object' or nullif(e.e ->> 'id', '') is null)::int
       + ((select count(*) from e where jsonb_typeof(e.e) = 'object' and nullif(e.e ->> 'id', '') is not null)
          - (select count(distinct e.e ->> 'id') from e where jsonb_typeof(e.e) = 'object' and nullif(e.e ->> 'id', '') is not null))::int
$$;

/* Första elementet med id:t (eller null). */
create or replace function public._vift_reg_get(p_arr jsonb, p_id text)
returns jsonb language sql immutable set search_path = public as $$
  select x.e from jsonb_array_elements(case when jsonb_typeof(p_arr) = 'array' then p_arr else '[]'::jsonb end) with ordinality x(e, o)
  where jsonb_typeof(x.e) = 'object' and x.e ->> 'id' = p_id order by x.o limit 1
$$;

/* Finns det något i p_new som varken finns i p_old eller hos anroparen? */
create or replace function public._vift_perms_beyond(p_new text[], p_old text[], p_caller text[])
returns boolean language sql immutable set search_path = public as $$
  select exists (select 1 from unnest(coalesce(p_new, '{}'::text[])) x
                 where not (x = any(coalesce(p_old, '{}'::text[]))) and not (x = any(coalesce(p_caller, '{}'::text[]))))
$$;

/* Eskaleringsregeln och invarianten för en skrivning av vift_staff eller vift_roles
   (s0/r0 = nuvarande värden under låset, s1/r1 = värdena efter skrivningen).
   Måste anropas med _vift_superadmin_lock() taget, i samma transaktion som skrivningen. */
create or replace function public._vift_authz_check(p_key text, p_s0 jsonb, p_r0 jsonb, p_s1 jsonb, p_r1 jsonb, p_actor text)
returns void language plpgsql stable set search_path = public as $$
declare
  s0 jsonb := case when jsonb_typeof(p_s0) = 'array' then p_s0 else '[]'::jsonb end;
  r0 jsonb := case when jsonb_typeof(p_r0) = 'array' then p_r0 else '[]'::jsonb end;
  s1 jsonb := case when jsonb_typeof(p_s1) = 'array' then p_s1 else '[]'::jsonb end;
  r1 jsonb := case when jsonb_typeof(p_r1) = 'array' then p_r1 else '[]'::jsonb end;
  v_actor jsonb;
  v_p     text[];
  v_super boolean;
  v_id    text;
  o       jsonb;
  n       jsonb;
  op      text[];
  np      text[];
  v_auth  boolean;
  v_grant boolean;
  v_rec   record;
begin
  if p_key not in ('vift_staff', 'vift_roles') then return; end if;

  -- Anroparen, omläst under låset: första aktiva personalposten med id:t, en aktiv
  -- app_users-rad för dess e-post, och rollens behörigheter. Annars 403 forbidden.
  v_actor := (select x.e from jsonb_array_elements(s0) with ordinality x(e, o)
              where public._vift_rec_active(x.e) and x.e ->> 'id' = p_actor order by x.o limit 1);
  if v_actor is null or not exists (
       select 1 from public.app_users au join auth.users u on u.id = au.user_id
       where au.active = true and nullif(u.email, '') is not null and lower(u.email) = lower(coalesce(v_actor ->> 'email', ''))) then
    raise exception 'forbidden';
  end if;
  v_p := public._vift_role_perms(r0, v_actor ->> 'role');
  if not ('all' = any(v_p) or (case when p_key = 'vift_staff' then 'staff_manage' else 'admin_manage' end) = any(v_p)) then
    raise exception 'forbidden';
  end if;
  v_super := 'all' = any(v_p);

  -- Inga nya element utan id och inga nya dubbla id i registren.
  if p_key = 'vift_staff' and public._vift_reg_bad_count(s1) > public._vift_reg_bad_count(s0) then
    raise exception 'invalid_element';
  end if;
  if p_key = 'vift_roles' and public._vift_reg_bad_count(r1) > public._vift_reg_bad_count(r0) then
    raise exception 'invalid_element';
  end if;

  if not v_super then
    -- (1) Egen roll: rollbyte i den egna personalposten, eller ändrade behörigheter i den
    --     egna rollen (även borttagen roll) → privilege_escalation.
    if p_key = 'vift_staff' then
      n := public._vift_reg_get(s1, p_actor);
      if n is null or (n ->> 'role') is distinct from (v_actor ->> 'role') then
        raise exception 'forbidden:privilege_escalation';
      end if;
    else
      o := public._vift_reg_get(r0, v_actor ->> 'role');
      n := public._vift_reg_get(r1, v_actor ->> 'role');
      if (o is null) <> (n is null) or (o is not null and
          (select coalesce(array_agg(x order by x), '{}') from unnest(public._vift_role_perms(r0, v_actor ->> 'role')) x)
          is distinct from
          (select coalesce(array_agg(x order by x), '{}') from unnest(public._vift_role_perms(r1, v_actor ->> 'role')) x)) then
        raise exception 'forbidden:privilege_escalation';
      end if;
    end if;

    -- (2) Rollregistret: roller med 'all' (före eller efter) får bara ändras av 'all';
    --     tillagda behörigheter måste anroparen själv ha.
    if p_key = 'vift_roles' then
      for v_id in select distinct x.e ->> 'id' from (select jsonb_array_elements(r0) e union all select jsonb_array_elements(r1)) x
                  where jsonb_typeof(x.e) = 'object' and nullif(x.e ->> 'id', '') is not null loop
        o := public._vift_reg_get(r0, v_id);
        n := public._vift_reg_get(r1, v_id);
        if o is distinct from n then
          op := case when o is null then '{}'::text[] else public._vift_role_perms(r0, v_id) end;
          np := case when n is null then '{}'::text[] else public._vift_role_perms(r1, v_id) end;
          if 'all' = any(op) or 'all' = any(np) then raise exception 'forbidden:superadmin_required'; end if;
          if public._vift_perms_beyond(np, op, v_p) then raise exception 'forbidden:privilege_escalation'; end if;
        end if;
      end loop;
    end if;

    -- (3) Personalregistret: poster vars roll, e-post eller aktiv-status ändras (eller som
    --     läggs till/tas bort). En post med 'all' får bara hanteras av 'all'. En post som
    --     blir aktiv med ny roll/e-post får inte få behörigheter utöver anroparens.
    if p_key = 'vift_staff' then
      for v_id in select distinct x.e ->> 'id' from (select jsonb_array_elements(s0) e union all select jsonb_array_elements(s1)) x
                  where jsonb_typeof(x.e) = 'object' and nullif(x.e ->> 'id', '') is not null loop
        o := public._vift_reg_get(s0, v_id);
        n := public._vift_reg_get(s1, v_id);
        if o is distinct from n then
          v_auth := o is null or n is null
            or (o ->> 'role') is distinct from (n ->> 'role')
            or lower(coalesce(o ->> 'email', '')) is distinct from lower(coalesce(n ->> 'email', ''))
            or public._vift_rec_active(o) <> public._vift_rec_active(n);
          if v_auth then
            op := case when o is null then '{}'::text[] else public._vift_role_perms(r1, o ->> 'role') end;
            np := case when n is null then '{}'::text[] else public._vift_role_perms(r1, n ->> 'role') end;
            if 'all' = any(op) or 'all' = any(np) then raise exception 'forbidden:superadmin_required'; end if;
            v_grant := n is not null and public._vift_rec_active(n) and (
              o is null or not public._vift_rec_active(o)
              or (o ->> 'role') is distinct from (n ->> 'role')
              or lower(coalesce(o ->> 'email', '')) is distinct from lower(coalesce(n ->> 'email', '')));
            if v_grant and public._vift_perms_beyond(np, '{}'::text[], v_p) then
              raise exception 'forbidden:privilege_escalation';
            end if;
          end if;
        end if;
      end loop;
    end if;

    -- (4) Inloggade identiteter (fångar e-postbyten, dubbla e-postadresser och rollernas
    --     behörigheter): ingen får vinna eller förlora 'all', och ingen får behörighet
    --     utöver anroparens.
    for v_rec in
      select a.user_id, a.perms as p0, coalesce(b.perms, '{}'::text[]) as p1
      from public._vift_identity_perms(s0, r0) a left join public._vift_identity_perms(s1, r1) b on b.user_id = a.user_id
    loop
      if ('all' = any(v_rec.p0)) <> ('all' = any(v_rec.p1)) then raise exception 'forbidden:superadmin_required'; end if;
      if public._vift_perms_beyond(v_rec.p1, v_rec.p0, v_p) then raise exception 'forbidden:privilege_escalation'; end if;
    end loop;
  end if;

  -- (5) Invarianten (alla anropare, även superadmin): minst en aktiv användare med 'all'.
  if public._vift_superadmin_count(s0, r0) >= 1 and public._vift_superadmin_count(s1, r1) = 0 then
    raise exception 'last_superadmin';
  end if;
end;
$$;

-- ── 2. store_business_key_write / _merge_write (samma signatur) ──────

CREATE OR REPLACE FUNCTION public.store_business_key_write(p_key text, p_new_value jsonb, p_expected_hash text, p_caller_authorized boolean, p_actor_id text)
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

CREATE OR REPLACE FUNCTION public.store_business_key_merge_write(p_key text, p_upserts jsonb, p_removals jsonb, p_caller_authorized boolean, p_actor_id text)
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
begin
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
    -- `v_elem -> 'previous'` returns the JSONB value `null` (not SQL NULL)
    -- when the caller sent a literal JSON `null` for "this is a new
    -- element" — normalize both SQL NULL and JSON null to SQL NULL here
    -- once, so every check below can use a plain `IS [NOT] NULL` safely.
    if v_previous is not null and jsonb_typeof(v_previous) = 'null' then
      v_previous := null;
    end if;
    if v_id is null or length(trim(v_id)) = 0 or v_new_data is null then
      raise exception 'invalid_element';
    end if;

    -- RE-REVIEW FIX (2026-11-09): refuse rather than silently pick one of
    -- several same-id elements (see migration header).
    select count(*) into v_dup_count from jsonb_array_elements(v_current) elem where elem ->> 'id' = v_id;
    if v_dup_count > 1 then
      raise exception 'duplicate_id_in_store';
    end if;

    select (ord - 1)::int, elem into v_idx, v_cur_elem
      from jsonb_array_elements(v_current) with ordinality as t(elem, ord)
      where elem ->> 'id' = v_id
      limit 1;

    if v_idx is null then
      -- element doesn't exist server-side right now
      if v_previous is not null then
        -- caller thought it existed and had this value — someone else removed it
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', 'removed_by_other_session'));
        continue;
      end if;
      v_current := v_current || jsonb_build_array(v_new_data);
      v_applied := v_applied || jsonb_build_array(v_id);
    else
      -- element exists: only apply if caller's last-known value matches
      -- the CURRENT server value exactly (real jsonb equality, order-
      -- independent for object keys — not a hash, deliberately, to avoid
      -- any canonical-serialization mismatch between client and server).
      if v_previous is distinct from v_cur_elem then
        v_conflicts := v_conflicts || jsonb_build_array(
          jsonb_build_object('id', v_id, 'reason', 'changed_by_other_session', 'serverValue', v_cur_elem)
        );
        continue;
      end if;
      v_current := jsonb_set(v_current, array[v_idx::text], v_new_data);
      v_applied := v_applied || jsonb_build_array(v_id);
    end if;
  end loop;

  -- RE-REVIEW FIX (2026-11-09, finding D): mass-deletion guard, mirroring
  -- store_business_key_write()'s existing mass_wipe_blocked threshold
  -- EXACTLY (see 20261106000002_staging_generic_keys_write_lockdown.sql).
  v_pre_removal_len := jsonb_array_length(v_current);
  v_requested_removal_count := jsonb_array_length(coalesce(p_removals, '[]'::jsonb));
  if v_pre_removal_len > 5 and v_requested_removal_count >= v_pre_removal_len then
    raise exception 'mass_wipe_blocked';
  end if;
  if v_pre_removal_len > 10 and (v_pre_removal_len - v_requested_removal_count)::numeric < (v_pre_removal_len::numeric * 0.1) then
    raise exception 'mass_wipe_blocked';
  end if;

  -- PR #2 review fix, blocker 1: a removal is only applied if the element's
  -- CURRENT server value still equals exactly what the caller last read
  -- (`previous`) — same real-jsonb-equality check as the upsert branch.
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

    select (ord - 1)::int, elem into v_idx, v_cur_elem
      from jsonb_array_elements(v_current) with ordinality as t(elem, ord)
      where elem ->> 'id' = v_id
      limit 1;

    if v_idx is null then
      continue;
    end if;

    if v_previous is distinct from v_cur_elem then
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

-- ── 3. deactivate_vift_user / provision_vift_user (samma signatur) ───

CREATE OR REPLACE FUNCTION public.deactivate_vift_user(p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_email TEXT;
  v_staff JSONB;
  v_roles JSONB;
  v_fore  INT;
BEGIN
  -- T3-C (D-25): samma lås som personal- och rollregistret; invarianten under låset.
  PERFORM public._vift_superadmin_lock();
  SELECT value INTO v_staff FROM public.store WHERE key = 'vift_staff';
  SELECT value INTO v_roles FROM public.store WHERE key = 'vift_roles';
  v_fore := public._vift_superadmin_count(v_staff, v_roles);

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;

  UPDATE app_users
  SET active = false, disabled_at = now()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingen app_users-rad för user_id = %', p_user_id;
  END IF;

  IF v_fore >= 1 AND public._vift_superadmin_count(v_staff, v_roles) = 0 THEN
    RAISE EXCEPTION 'last_superadmin';
  END IF;

  RETURN format('Inaktiverad: %s', COALESCE(v_email, p_user_id::TEXT));
END;
$function$;

CREATE OR REPLACE FUNCTION public.provision_vift_user(p_user_id uuid, p_staff_id text, p_role_id text, p_is_admin boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_email TEXT;
  v_staff JSONB;
  v_roles JSONB;
  v_fore  INT;
BEGIN
  -- T3-C (D-25): samma lås som personal- och rollregistret; invarianten under låset.
  PERFORM public._vift_superadmin_lock();
  SELECT value INTO v_staff FROM public.store WHERE key = 'vift_staff';
  SELECT value INTO v_roles FROM public.store WHERE key = 'vift_roles';
  v_fore := public._vift_superadmin_count(v_staff, v_roles);

  -- Hämta e-post för loggning
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Ingen auth-användare med user_id = %', p_user_id;
  END IF;

  INSERT INTO app_users (user_id, staff_id, role_id, active, is_admin, created_at)
  VALUES (p_user_id, p_staff_id, p_role_id, true, p_is_admin, now())
  ON CONFLICT (user_id) DO UPDATE SET
    staff_id   = EXCLUDED.staff_id,
    role_id    = EXCLUDED.role_id,
    active     = true,
    is_admin   = EXCLUDED.is_admin,
    disabled_at = NULL;

  IF v_fore >= 1 AND public._vift_superadmin_count(v_staff, v_roles) = 0 THEN
    RAISE EXCEPTION 'last_superadmin';
  END IF;

  RETURN format('Provisionerad: %s (staff_id=%s, role=%s, is_admin=%s)',
                v_email, p_staff_id, p_role_id, p_is_admin);
END;
$function$;

-- ── 4. Projektion av vift_staff och vift_roles (D-21, D-14) ─────────

CREATE OR REPLACE FUNCTION public.vift_store_full_access(p_key text, p_perms text[])
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p text[] := coalesce(p_perms, '{}');
  wp text;
  intern text[] := array['admin_manage','invoice_view','invoice_create','reports_view','offer_manage','ao_view_all','ao_edit'];
begin
  if 'all' = any(p) then return true; end if;
  wp := public._staging_business_key_required_perm(p_key);
  if wp is not null and wp = any(p) then return true; end if;
  return case p_key
    when 'vift_offers'            then p && array['offer_manage']
    when 'vift_offerEvents'       then p && array['offer_manage']
    when 'vift_offerAttachments'  then p && array['offer_manage']
    when 'vift_emailTemplates'    then p && array['offer_manage','admin_manage']
    when 'vift_invoices'          then p && array['invoice_view','invoice_create','reports_view','ao_view_all','ao_edit']
    when 'vift_salesOpps'         then p && array['sales_manage','reports_view']
    when 'vift_contracts'         then p && array['customer_manage','invoice_view','invoice_create','reports_view']
    when 'vift_priceProfiles'     then p && array['article_manage','offer_manage','customer_manage','invoice_create','admin_manage','recurring_manage']
    when 'vift_importLogs'        then p && array['admin_manage']
    when 'vift_serviceMonitorLog' then p && array['admin_manage','ao_view_all']
    when 'vift_settings'          then p && intern
    when 'vift_customers'         then p && array['customer_manage','invoice_view','invoice_create','offer_manage','sales_manage','ao_view_all']
    when 'vift_propertyObjects'   then p && array['objects_sensitive']
    when 'vift_recurringOrders'   then p && array['objects_sensitive']
    -- T3-C (D-21, D-14): hela personal- och rollregistret bara för den som hanterar dem.
    -- Övriga får en projektion via store-key-write (vift_store_project); REST döljer raden.
    when 'vift_staff'             then p && array['staff_manage','admin_manage']
    when 'vift_roles'             then false
    else true
  end;
end;
$function$;

drop function public.vift_store_project(text, jsonb, text[]);
CREATE FUNCTION public.vift_store_project(p_key text, p_value jsonb, p_perms text[], p_caller_staff_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  p text[] := coalesce(p_perms, '{}');
  is_arr boolean := jsonb_typeof(p_value) = 'array';
  offer_secret text[] := array['publicToken','tokenCreatedAt','tokenExpiresAt','tokenRevokedAt','lockedSnapshotJSON',
                               'customerApproval','manualApproval','emailSentTo','openCount','openedAt','reminderSentAt','internalNote'];
  offer_stub text[] := array['id','title','status','customerId','propertyId','workOrderId','projectId','versionNumber',
                             'createdAt','updatedAt','deleted','archived'];
  v_own_role text;
begin
  if p_value is null then return null; end if;
  if public.vift_store_full_access(p_key, p) then return p_value; end if;

  -- T3-C (D-14, D-21, SEC-B3-03): personalregistret. Den egna posten oförändrad; andras
  -- 'permissions' bort, och andras 'role' bort utan staff_view. ÖVERGÅNG: utan identitet
  -- (äldre store-key-write) tas bara 'permissions' bort (klienten läser aldrig fältet).
  if p_key = 'vift_staff' and is_arr then
    return coalesce((
      select jsonb_agg(case
        when jsonb_typeof(e) <> 'object' then e
        when p_caller_staff_id is null then e - 'permissions'
        when e ->> 'id' = p_caller_staff_id then e
        when 'staff_view' = any(p) then e - 'permissions'
        else e - array['permissions', 'role'] end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
  end if;

  -- T3-C (D-21, SEC-B3-05): rollregistret. Bara den egna effektiva rollen; med
  -- staff_manage även de roller anroparen får tilldela (utan 'all', inom egna
  -- behörigheter). ÖVERGÅNG: utan identitet (äldre store-key-write) oförändrat.
  if p_key = 'vift_roles' and is_arr then
    if p_caller_staff_id is null then return p_value; end if;
    v_own_role := (select s.e ->> 'role' from public.store st,
                     jsonb_array_elements(case when jsonb_typeof(st.value) = 'array' then st.value else '[]'::jsonb end) with ordinality s(e, o)
                   where st.key = 'vift_staff' and public._vift_rec_active(s.e) and s.e ->> 'id' = p_caller_staff_id
                   order by s.o limit 1);
    return coalesce((
      select jsonb_agg(e order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (
        (v_own_role is not null and e ->> 'id' = v_own_role)
        or ('staff_manage' = any(p) and jsonb_typeof(e -> 'permissions') = 'array'
            and not ((e -> 'permissions') ? 'all')
            and not exists (select 1 from jsonb_array_elements_text(e -> 'permissions') q where not (q = any(p)))))
    ), '[]'::jsonb);
  end if;

  if p_key = 'vift_offers' and is_arr then
    if p && array['customer_manage','sales_manage','invoice_view','invoice_create','reports_view','ao_view_all','ao_edit','ao_create'] then
      -- Interna roller: belopp och rader behövs (rapporter, AO-underlag), men
      -- aldrig token, låst kundversion, kundens godkännandeuppgifter eller interna anteckningar.
      return coalesce((
        select jsonb_agg(
          case when jsonb_typeof(e) = 'object' then
            (e - offer_secret) || case when jsonb_typeof(e->'lines') = 'array'
              then jsonb_build_object('lines', (select coalesce(jsonb_agg(case when jsonb_typeof(l) = 'object' then l - array['calculationNote','inputValues','priceRuleRef'] else l end order by o2), '[]'::jsonb)
                                                from jsonb_array_elements(e->'lines') with ordinality y(l, o2)))
              else '{}'::jsonb end
          else e end order by o)
        from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
    end if;
    -- Övriga (fältpersonal, begränsad): bara identitet och status, inga belopp.
    return coalesce((
      select jsonb_agg(case when jsonb_typeof(e) = 'object'
        then (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(e) z(k, v) where k = any(offer_stub))
        else e end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
  end if;

  if p_key = 'vift_settings' and jsonb_typeof(p_value) = 'object' then
    return p_value - array['internalHourlyCost','bankgiro'];
  end if;

  if p_key = 'vift_customers' and is_arr then
    return coalesce((
      select jsonb_agg(case when jsonb_typeof(e) = 'object' then
        case when lower(coalesce(e->>'type','')) in ('privat','private','privatperson')
             then e - array['personnr','orgNr'] else e - 'personnr' end
        else e end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
  end if;

  if p_key = 'vift_propertyObjects' and is_arr then
    return coalesce((
      select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - array['doorCode','keyInformation','accessInformation'] else e end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
  end if;

  if p_key = 'vift_recurringOrders' and is_arr then
    return coalesce((
      select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'accessCode' else e end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
  end if;

  -- Nycklar som rollen inte ska se alls: tomt värde av samma form.
  return case jsonb_typeof(p_value) when 'array' then '[]'::jsonb when 'object' then '{}'::jsonb else null end;
end;
$function$;

drop function public.store_read_all_with_hashes_projected(text[], text[]);
CREATE FUNCTION public.store_read_all_with_hashes_projected(p_business_keys text[], p_perms text[], p_caller_staff_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r jsonb;
  d jsonb;
  out jsonb := '{}'::jsonb;
  k text;
begin
  r := public.store_read_all_with_hashes(p_business_keys);
  d := coalesce(r->'data', '{}'::jsonb);
  for k in select jsonb_object_keys(d) loop
    out := out || jsonb_build_object(k, public.vift_store_project(k, d->k, p_perms, p_caller_staff_id));
  end loop;
  return jsonb_build_object('data', out, 'hashes', coalesce(r->'hashes', '{}'::jsonb));
end;
$function$;

-- ── Rättigheter: bara service_role (Edge Functions). vift_store_full_access behåller
--    sin EXECUTE för authenticated (RLS-hjälpen i store_read_by_role). ────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._vift_rec_active(jsonb)', 'public._vift_role_perms(jsonb,text)', 'public._vift_identity_perms(jsonb,jsonb)',
    'public._vift_superadmin_count(jsonb,jsonb)', 'public._vift_superadmin_lock()', 'public._vift_reg_bad_count(jsonb)',
    'public._vift_reg_get(jsonb,text)', 'public._vift_perms_beyond(text[],text[],text[])',
    'public._vift_authz_check(text,jsonb,jsonb,jsonb,jsonb,text)',
    'public.store_business_key_write(text,jsonb,text,boolean,text)',
    'public.store_business_key_merge_write(text,jsonb,jsonb,boolean,text)',
    'public.deactivate_vift_user(uuid)', 'public.provision_vift_user(uuid,text,text,boolean)',
    'public.vift_store_project(text,jsonb,text[],text)',
    'public.store_read_all_with_hashes_projected(text[],text[],text)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
