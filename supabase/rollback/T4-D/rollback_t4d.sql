-- ============================================================
-- ROLLBACK T4-D (genererad av tests/local/t4d-rollback.js ur en lokal kedja utan
-- 20261128000013 och senare T4-paket, dvs. läget efter T4-C).
-- Tar bort passåtgärdernas T4-D-signaturer och återskapar de föregående exakt, återställer de sex
-- ersatta funktionerna exakt och tar bort T4-D:s hjälpfunktioner. Rör INGEN data.
-- Ordning vid rollback: 1) föregående EF-versioner (rondering-pass-write, store-key-write) och föregående
--   klientpaket, 2) denna fil, 3) T4-C:s rollback, 4) T4-B:s, 5) notisdelens, 6) T4-A:s, 7) vid behov
--   T3-E-, T3-D-, T3-C- och T3-B-rollbacken (omvänd ordning).
-- ============================================================
begin;

-- 1. Passåtgärderna: T4-D-signaturerna bort, de föregående tillbaka.
drop function if exists public.rondering_point_patch(text,text,text,text,text,text,text,text,boolean,text[]);
drop function if exists public.rondering_pass_save_note(text,text,text,text[]);
drop function if exists public.rondering_pass_auto_start(text,text,text[]);
drop function if exists public.rondering_pass_complete(text,text,text[]);

-- rondering_point_patch(text,text,text,text,text,text,text,text,boolean)
CREATE OR REPLACE FUNCTION public.rondering_point_patch(p_pass_id text, p_category_id text, p_point_id text, p_status text, p_comment text, p_deviation_id text, p_work_order_id text, p_caller_staff_id text, p_is_reset boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
revoke all on function public.rondering_point_patch(text,text,text,text,text,text,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.rondering_point_patch(text,text,text,text,text,text,text,text,boolean) to service_role;

-- rondering_pass_save_note(text,text)
CREATE OR REPLACE FUNCTION public.rondering_pass_save_note(p_pass_id text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
revoke all on function public.rondering_pass_save_note(text,text) from public, anon, authenticated, service_role;
grant execute on function public.rondering_pass_save_note(text,text) to service_role;

-- rondering_pass_auto_start(text)
CREATE OR REPLACE FUNCTION public.rondering_pass_auto_start(p_pass_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
revoke all on function public.rondering_pass_auto_start(text) from public, anon, authenticated, service_role;
grant execute on function public.rondering_pass_auto_start(text) to service_role;

-- rondering_pass_complete(text,text)
CREATE OR REPLACE FUNCTION public.rondering_pass_complete(p_pass_id text, p_caller_staff_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
revoke all on function public.rondering_pass_complete(text,text) from public, anon, authenticated, service_role;
grant execute on function public.rondering_pass_complete(text,text) to service_role;

-- 2. Ersatta funktioner (samma signatur) tillbaka till definitionen efter T4-C.
-- _vift_ej_verkstallda()
CREATE OR REPLACE FUNCTION public._vift_ej_verkstallda()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select array['ao_plan_own','rondering_utfor','export_data','export_personal_data']
$function$;
revoke all on function public._vift_ej_verkstallda() from public, anon, authenticated, service_role;
grant execute on function public._vift_ej_verkstallda() to service_role;

-- vift_store_full_access(text,text[])
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
  kund text[] := array['customer_manage','invoice_view','invoice_create','offer_manage','sales_manage','ao_view_all'];
begin
  -- T4-A notiser: notiserna är personliga. Ingen roll (inte heller 'all') får hela listan; direkt
  -- REST-läsning av vift_notifications ger inga rader och läsningen projiceras per mottagare.
  if p_key = 'vift_notifications' then return false; end if;
  if 'all' = any(p) then return true; end if;
  -- T4-A (punkt 7): utan giltig behörighet (tom, okänd eller inaktiverad roll) inga verksamhetsdata.
  if not public._vift_t4a_giltig(p) then return false; end if;
  -- T4-A (T3-D 6): hela aktivitetsloggen kräver activity_log_view_all (övergångsregel för äldre roller).
  if p_key = 'vift_activityLog' then return public._vift_t4a_logg_full(p); end if;
  -- T4-A (SÄK-7, B5, C-5 regel 1 ersatt): hela värdet, även för SKRIVARE, bara om alla skyddade
  -- fält i nyckeln får läsas. Övriga får projektionen (vift_store_project).
  if not public._vift_t4a_alla_lasbara(p_key, p) then return false; end if;
  -- T4-B (D-09, D-11, R18, R23): artiklarnas försäljningspris och prisgruppernas timpris bara med
  -- prisläsrätt (_vift_t4b_pris_las) — även hela värdet och direkt REST-läsning.
  if p_key in ('vift_articles','vift_priceGroups') and not public._vift_t4b_pris_las(p) then return false; end if;
  -- T4-A (punkt 7, åtkomst per post): återkommande ärenden, projekt, inspektioner och avvikelser
  -- i sin helhet bara för de roller som läser kundregistret; övriga får urval per uppdrag.
  if p_key in ('vift_recurringOrders','vift_projects','vift_inspections','vift_avvikelser') then
    return public._vift_kund_las(p);
  end if;
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
    when 'vift_customers'         then (p && kund) and (p && array['objects_sensitive'])
    when 'vift_propertyObjects'   then p && array['objects_sensitive']
    when 'vift_staff'             then p && array['staff_manage','admin_manage']
    when 'vift_roles'             then false
    when 'vift_activities'        then ('ao_edit' = any(p) and 'ao_view_all' = any(p))
    when 'vift_properties'        then (p && array['objects_sensitive']) and (p && kund)
    when 'vift_propertyContacts'  then p && kund
    else true
  end;
end;
$function$;
revoke all on function public.vift_store_full_access(text,text[]) from public, anon, authenticated, service_role;
grant execute on function public.vift_store_full_access(text,text[]) to authenticated;
grant execute on function public.vift_store_full_access(text,text[]) to service_role;

-- vift_store_project(text,jsonb,text[],text)
CREATE OR REPLACE FUNCTION public.vift_store_project(p_key text, p_value jsonb, p_perms text[], p_caller_staff_id text DEFAULT NULL::text)
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
  offer_ref text[] := array['id','title','status','workOrderId'];
  sens text[] := array['doorCode','keyInformation','accessInformation','keyReceipt','alarmInformation','accessCode','keyInfo'];
  staff_fields text[] := array['id','firstName','lastName','name','title','active','color','initials'];
  v_id text := nullif(coalesce(p_caller_staff_id, ''), '');
  v_own_role text;
  v_refs jsonb;
  v_ext boolean;
  v_ids jsonb;
  v_p2 text[];
begin
  if p_value is null then return null; end if;
  if public.vift_store_full_access(p_key, p) then return p_value; end if;

  -- T4-A (punkt 7): tom, okänd eller inaktiverad roll (inga giltiga behörigheter): inga
  -- verksamhetsdata. Den egna personalposten och den egna rollen behövs för inloggningen.
  if not public._vift_t4a_giltig(p) and p_key not in ('vift_staff', 'vift_roles') then
    return case jsonb_typeof(p_value) when 'array' then '[]'::jsonb when 'object' then '{}'::jsonb else null end;
  end if;

  -- T4-A notiser: bara anroparens egna notiser (userId = personal-id). Poster utan mottagarfält
  -- lämnas inte ut till någon (restriktivt; äldre data skrivs inte om).
  if p_key = 'vift_notifications' then
    return public._vift_notis_projicera(p_value, v_id);
  end if;

  -- Personalregistret (D-14, D-21). T4-A: arbetskontakt till kollegor kräver staff_contacts_view
  -- (övergångsregel: T3-E:s härledning för roller utan T4:s nya behörigheter).
  if p_key = 'vift_staff' and is_arr then
    if v_id is null then
      return coalesce((
        select jsonb_agg(case when jsonb_typeof(e) <> 'object' then e else
          (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(e) z(k, v)
           where k = any(staff_fields || array['role','email','phone'])) end order by o)
        from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
    end if;
    v_ext := not public._vift_t4a_kontakt(p);
    v_refs := case when v_ext and not ('staff_view' = any(p)) then public._vift_post_refs(p, v_id) else '{}'::jsonb end;
    return coalesce((
      select jsonb_agg(case
        when e ->> 'id' = v_id then e
        else (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(e) z(k, v)
              where k = any(staff_fields)
                 or (k = 'role' and 'staff_view' = any(p))
                 or (k in ('phone','email') and not v_ext)) end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (e ->> 'id' = v_id or not v_ext or 'staff_view' = any(p)
            or coalesce(v_refs -> 'staff', '[]'::jsonb) ? coalesce(e ->> 'id', ''))), '[]'::jsonb);
  end if;

  -- T3-C (D-21): rollregistret. Oförändrat.
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
    if v_id is null then return '[]'::jsonb; end if;
    v_refs := public._vift_post_refs(p, v_id);
    return coalesce((
      select jsonb_agg((select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(e) z(k, v) where k = any(offer_ref)) order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (v_refs -> 'offers') ? coalesce(e ->> 'id', '')), '[]'::jsonb);
  end if;

  -- T4-A (D-17, D-01, SEC-INST-01/02, SEC-B2-06): bankgiro för interna roller (och bankgiro_edit),
  -- intern timkostnad bara med cost_view — även för skrivaren admin_manage.
  if p_key = 'vift_settings' and jsonb_typeof(p_value) = 'object' then
    return public._vift_t4a_projicera_elem(p_key, p_value, p);
  end if;

  -- T4-A (D-01, SEC-B1-09/12): artiklarnas inköpspris och påslag bara med cost_view.
  -- T4-B (D-09, SEC-B1-09): försäljningspriset bara med prisläsrätt.
  if p_key = 'vift_articles' and is_arr then
    return coalesce((select jsonb_agg(case when jsonb_typeof(e) = 'object' and not public._vift_t4b_pris_las(p)
        then public._vift_t4a_projicera_elem(p_key, e, p) - 'sellPrice' else public._vift_t4a_projicera_elem(p_key, e, p) end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
  end if;

  -- T4-B (D-11, R22, R23, SEC-B2-01): prisgrupper utan prisläsrätt — bara de grupper som får väljas
  -- (aktiva), med namn och typ, utan timpris och beskrivning.
  if p_key = 'vift_priceGroups' and is_arr then
    return coalesce((select jsonb_agg((select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(e) z(k, v)
        where k = any(array['id','name','active','billingType','sortOrder'])) order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and coalesce(e ->> 'active', 'true') not in ('false', '0')), '[]'::jsonb);
  end if;

  -- T3-D (D-13) + T4-A (SÄK-7, D-13, K-02): kunder, fastigheter, objekt och kontakter. Portkoder
  -- och nyckelinformation bara med objects_sensitive, personnummer och privatpersoners org.nr bara
  -- med personal_data_view — även för skrivaren customer_manage. Urval per uppdrag (fält) som T3-D,
  -- där portkoder aldrig ingår.
  if p_key in ('vift_customers','vift_properties','vift_propertyObjects','vift_propertyContacts') and is_arr then
    if not public._vift_kund_las(p) then
      if v_id is null then return '[]'::jsonb; end if;
      v_refs := public._vift_post_refs(p, v_id);
    end if;
    return coalesce((
      select jsonb_agg(case when v_refs is null then public._vift_t4a_projicera_elem(p_key, e, p)
                            else public._vift_t4a_projicera_elem(p_key, e, p) - sens end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (v_refs is null or case p_key
        when 'vift_customers' then (v_refs -> 'customers') ? coalesce(e ->> 'id', '')
        when 'vift_properties' then (v_refs -> 'properties') ? coalesce(e ->> 'id', '')
        when 'vift_propertyObjects' then (v_refs -> 'objects') ? coalesce(e ->> 'id', '')
        else (v_refs -> 'properties') ? coalesce(e ->> 'propertyId', '')
             and (coalesce(e ->> 'objectId', '') = '' or (v_refs -> 'objects') ? (e ->> 'objectId')) end)), '[]'::jsonb);
  end if;

  -- T4-A (punkt 7, åtkomst per post): återkommande ärenden, projekt, avvikelser och inspektioner.
  -- Kundregistrets läsare: alla (återkommande utan portkod om objects_sensitive saknas). Övriga:
  -- bara poster som hör till AO som anroparen ser med innehåll. Inspektioner har ingen AO-koppling.
  if p_key in ('vift_recurringOrders','vift_projects','vift_avvikelser','vift_inspections') and is_arr then
    if public._vift_kund_las(p) then
      return coalesce((select jsonb_agg(public._vift_t4a_projicera_elem(p_key, e, p) order by o)
        from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
    end if;
    if v_id is null or p_key = 'vift_inspections' then return '[]'::jsonb; end if;
    if p_key = 'vift_avvikelser' then
      v_ids := public._vift_t4a_ao_ref(p, v_id, 'id');
      return coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(p_value) with ordinality x(e, o)
        where jsonb_typeof(e) = 'object' and v_ids ? coalesce(e ->> 'workOrderId', '')), '[]'::jsonb);
    end if;
    v_ids := public._vift_t4a_ao_ref(p, v_id, case p_key when 'vift_recurringOrders' then 'recurringOrderId' else 'projectId' end);
    return coalesce((select jsonb_agg(public._vift_t4a_projicera_elem(p_key, e, p) - sens order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and v_ids ? coalesce(e ->> 'id', '')), '[]'::jsonb);
  end if;

  -- T3-D (B4, Q3) + T4-A (T3-D 6): aktivitetsloggen utan activity_log_view_all = AO-händelser för
  -- AO som anroparen ser med innehåll; med ao_view_all men utan activity_log_view_all (ny roll)
  -- bara AO där anroparen är tilldelad. Inga poster med offert-, faktura- eller säljreferens.
  if p_key = 'vift_activityLog' and is_arr then
    if v_id is null then return '[]'::jsonb; end if;
    v_p2 := case when 'ao_view_all' = any(p) then array_remove(p, 'ao_view_all') || array['ao_view_own'] else p end;
    v_refs := public._vift_post_refs(v_p2, v_id);
    return coalesce((
      select jsonb_agg(e order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and public._vift_activity_ao_type(e ->> 'type')
        and (v_refs -> 'ao') ? coalesce(e ->> 'workOrderId', '')
        and coalesce(e ->> 'offerId', '') = '' and coalesce(e ->> 'invoiceId', '') = ''
        and coalesce(e ->> 'salesOpportunityId', '') = ''), '[]'::jsonb);
  end if;

  -- T3-D (D-15): uppgifter. Oförändrat.
  if p_key = 'vift_activities' and is_arr then
    if v_id is null then return '[]'::jsonb; end if;
    v_refs := case when p && array['ao_view_own','ao_view_all'] then public._vift_post_refs(array['ao_view_own'], v_id) else '{"ao":[]}'::jsonb end;
    return coalesce((
      select jsonb_agg(e order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (coalesce(e ->> 'createdBy', '') = v_id or coalesce(e ->> 'assignedTo', '') = v_id
            or (v_refs -> 'ao') ? coalesce(public._vift_task_ao(e), ''))), '[]'::jsonb);
  end if;

  return case jsonb_typeof(p_value) when 'array' then '[]'::jsonb when 'object' then '{}'::jsonb else null end;
end;
$function$;
revoke all on function public.vift_store_project(text,jsonb,text[],text) from public, anon, authenticated, service_role;
grant execute on function public.vift_store_project(text,jsonb,text[],text) to service_role;

-- _vift_post_refs(text[],text)
CREATE OR REPLACE FUNCTION public._vift_post_refs(p_perms text[], p_staff_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with ao as (
    select e from public.store st,
      jsonb_array_elements(case when jsonb_typeof(st.value) = 'array' then st.value else '[]'::jsonb end) e
    where st.key = 'vift_workOrders' and jsonb_typeof(e) = 'object' and coalesce(e ->> 'id', '') <> ''
      and public._vift_ao_content_visible(e, p_perms, p_staff_id)
  ), ids as (select coalesce(jsonb_agg(distinct e ->> 'id'), '[]'::jsonb) a from ao)
  select jsonb_build_object(
    'ao', (select a from ids),
    'customers', coalesce((select jsonb_agg(distinct e ->> 'customerId') from ao where coalesce(e ->> 'customerId', '') <> ''), '[]'::jsonb),
    'properties', coalesce((select jsonb_agg(distinct e ->> 'propertyId') from ao where coalesce(e ->> 'propertyId', '') <> ''), '[]'::jsonb),
    'objects', coalesce((select jsonb_agg(distinct e ->> 'objectId') from ao where coalesce(e ->> 'objectId', '') <> ''), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(distinct x) from (
        select e ->> 'offerId' x from ao where coalesce(e ->> 'offerId', '') <> ''
        union
        select o ->> 'id' from public.store so,
          jsonb_array_elements(case when jsonb_typeof(so.value) = 'array' then so.value else '[]'::jsonb end) o
        where so.key = 'vift_offers' and jsonb_typeof(o) = 'object' and coalesce(o ->> 'id', '') <> ''
          and (select a from ids) ? coalesce(o ->> 'workOrderId', '')) y), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(distinct s) from (
        select jsonb_array_elements_text(public._vift_ao_staff(e)) s from ao
        union select e ->> 'responsibleStaffId' from ao) z where coalesce(s, '') <> ''), '[]'::jsonb)
  )
$function$;
revoke all on function public._vift_post_refs(text[],text) from public, anon, authenticated, service_role;
grant execute on function public._vift_post_refs(text[],text) to service_role;

-- _vift_ref_visible(text,text,text[],jsonb)
CREATE OR REPLACE FUNCTION public._vift_ref_visible(p_field text, p_id text, p_perms text[], p_refs jsonb)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select 'all' = any(coalesce(p_perms, '{}')) or case p_field
    when 'workOrderId' then public._vift_has(p_perms, 'ao_view_all') or coalesce(p_refs -> 'ao', '[]'::jsonb) ? p_id
    when 'customerId' then public._vift_kund_las(p_perms) or coalesce(p_refs -> 'customers', '[]'::jsonb) ? p_id
    when 'propertyId' then public._vift_kund_las(p_perms) or coalesce(p_refs -> 'properties', '[]'::jsonb) ? p_id
    when 'offerId' then coalesce(p_perms, '{}') && array['offer_manage','customer_manage','sales_manage','invoice_view','invoice_create',
                          'reports_view','ao_view_all','ao_edit','ao_create']
                        or coalesce(p_refs -> 'offers', '[]'::jsonb) ? p_id
    when 'invoiceId' then public.vift_store_full_access('vift_invoices', p_perms)
    when 'salesOpportunityId' then public.vift_store_full_access('vift_salesOpps', p_perms)
    when 'inspectionId' then public.vift_store_full_access('vift_inspections', p_perms)
    when 'ronderingId' then public.vift_store_full_access('vift_ronderingar', p_perms)
    when 'deviationId' then public.vift_store_full_access('vift_avvikelser', p_perms)
    else false
  end
$function$;
revoke all on function public._vift_ref_visible(text,text,text[],jsonb) from public, anon, authenticated, service_role;
grant execute on function public._vift_ref_visible(text,text,text[],jsonb) to service_role;

-- _vift_activity_type_perms(text)
CREATE OR REPLACE FUNCTION public._vift_activity_type_perms(p_type text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_type in ('work_order_status','work_order_updated','work_order_assigned','material_added','material_removed',
                    'time_entry_created','note') then array['ao_view_own','ao_view_all']
    when p_type = 'work_order_created' then array['ao_create']
    when p_type in ('staff_assigned','work_order_archived','work_order_restored','work_order_deleted',
                    'work_order_permanent_delete') then array['ao_edit']
    when p_type in ('invoice_created','invoice_stale_override_approved') then array['invoice_create']
    when p_type in ('customer_created','customer_updated','customer_deleted','property_object_created',
                    'property_object_updated','property_object_deleted','contract_created','project_created') then array['customer_manage']
    when p_type in ('offer_created','offer_sent','offer_status') then array['offer_manage']
    when p_type in ('sales_opportunity_won','sales_opportunity_lost') then array['sales_manage']
    when p_type = 'recurring_order_created' then array['recurring_manage']
    when p_type in ('rondering_created','rondering_started','rondering_completed','point_ok','point_ej_aktuell',
                    'deviation_created','deviation_status','ao_from_deviation') then array['ao_view_all']
    else '{}'::text[]
  end
$function$;
revoke all on function public._vift_activity_type_perms(text) from public, anon, authenticated, service_role;
grant execute on function public._vift_activity_type_perms(text) to service_role;

-- 3. T4-D:s hjälpfunktioner bort.
drop function if exists public._vift_t4d_las_pass(text,text,text[],boolean);
drop function if exists public._vift_t4d_pass_regel(jsonb,text,text[]);
drop function if exists public._vift_t4d_egna_ronderingar(text);

commit;
