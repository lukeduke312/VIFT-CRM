-- ============================================================
-- T4-A, tilläggsdel NOTISER (2026-11-28): säker skriv- och läsväg för in-app-notiser och
-- avveckling av den direkta REST-vägen (punkt 275). NY – EJ INSTALLERAD I STAGING.
-- Installeras i samma serveromgång som T4-A + T4-B, DIREKT EFTER 20261128000009 (T4-A).
--
-- Beslut: "Tillägg efter T3-leveransen" (docs/qa-2026-11-28/BESLUT-2026-11-28.md): T3-C beslut 1
-- ("Registrera avvecklingen av övergångsvägen när notiserna fått säker skrivväg") och punkt 7
-- ("Notiser som kan skapas åt andra användare utan korrekt kontroll av aktör, mottagare och
-- referens", placerad i befintligt paket T4-A). Föreslagen väg: T4-RESULTAT.md T4-A §9.
--
-- Före (baslinje, T4-A-koden):
--   - vift_notifications var EN gemensam lista. Varje inloggad läste HELA listan (REST och
--     readAllWithHashes), även andras notiser (AO-titlar, kundnamn i offertnotiser).
--   - Varje inloggad skrev listan direkt via REST (T3-C-vitlistan): nya poster åt vem som helst,
--     med valfri typ, text, avsändare och tid. Triggern protect_notifications_and_legacy_keys
--     skyddade bara befintliga posters innehåll (utom 'read'), inte vem som skapade vad.
--   - vift_lastChanged stod kvar på REST-vitlistan bara för att samma upsert bar notiserna.
--
-- Efter:
--   1. Skrivning bara via RPC (store-key-write, service_role):
--      notification_append(p_caller_staff_id, p_entry, p_request_id, p_max)
--        - anroparen omläses i transaktionen (_vift_t4a_aktor_perms); utan giltig behörighet
--          'forbidden';
--        - servern sätter avsändare (createdBy), tid (createdAt), id, read=false och source;
--        - typ per behörighet (_vift_notis_kategori): 'ao_assigned' kräver ao_edit (som
--          personaländringen i work_order_patch); 'service_done', 'service_overdue',
--          'service_approaching' är egna påminnelser och får bara gå till anroparen själv;
--          alla andra typer (även 'offer_approved', som bara offer-respond skapar med
--          service_role) → 'forbidden:type_not_allowed';
--        - mottagaren måste vara aktiv personal → annars 'forbidden:recipient_not_allowed'
--          (även en egen påminnelse till någon annan);
--        - referensen (aoId) prövas för AVSÄNDAREN med _vift_ref_visible (T3-D) med AO-raden
--          under FOR SHARE → 'forbidden:ref_not_visible'; för 'ao_assigned' måste AO:n finnas
--          och mottagaren vara tilldelad den → 'forbidden:recipient_not_assigned' (AP-D: ingen
--          falsk tilldelningsnotis);
--        - texten för 'ao_assigned' sätts av servern ur AO:n ("Du har tilldelats <id>: <titel>");
--          klientens text används bara för egna påminnelser (1–500 tecken);
--        - idempotens bunden till innehåll: (anropare, requestId) med fingeravtryck av
--          mottagare, typ, aoId och text i op_idempotency; samma requestId med annat innehåll
--          → 'idempotency_key_conflict'; dessutom ingen dubblett av en oläst tilldelningsnotis
--          (mottagare, typ, aoId) eller en oläst egen påminnelse med samma text;
--        - listan kapas vid p_max (högst 5000, som tidigare): de ÄLDSTA posterna tas bort.
--      notifications_mark_read(p_caller_staff_id, p_ids, p_all)
--        - markerar bara ANROPARENS egna notiser lästa (userId = anroparen); id som inte är
--          egna (andras eller okända) lämnas orörda och räknas som 'ignored' utan att skilja
--          på andras och okända (inget orakel). Inga ändringar → ingen skrivning.
--   2. Läsning projiceras per mottagare: vift_store_full_access('vift_notifications') är falskt
--      för ALLA (även 'all'), så direkt REST-läsning ger inga rader, och vift_store_project
--      lämnar bara poster vars userId är en sträng lika med anroparens personal-id
--      (_vift_notis_projicera). ÄLDRE POSTER utan mottagarfält (eller med annat än en sträng)
--      lämnas inte ut till någon (restriktivt; ingen datamigrering, inget skrivs om).
--   3. REST-vitlistan (T3-C, F18) avvecklas (punkt 275): triggern _store_direct_write_guard
--      nekar ALL direkt skrivning från authenticated/anon (även vift_notifications och
--      vift_lastChanged) med 42501 direct_write_blocked, och RESTRICTIVE-policyerna
--      store_direct_write_allowlist_insert/_update får WITH CHECK (false). Direkt REST-LÄSNING
--      av vift_lastChanged (klientens pollsignal) påverkas inte. Triggern
--      protect_notifications_and_legacy_keys ligger kvar orörd (den berör inte RPC:er).
--
-- LÅSORDNING (samma som T3-D:s activity_log_append): vift_workOrders FOR SHARE (bara när en
-- AO-referens prövas) → vift_notifications FOR UPDATE → vift_lastChanged sist. Ingen väg tar
-- vift_notifications före vift_workOrders. offer-respond skriver notiser med service_role och
-- villkorad uppdatering på updated_at (optimistiskt); RPC:erna sätter updated_at, så en
-- samtidig offer-respond-skrivning förlorar inget (den gör om läsningen).
--
-- Felkoder (BEHORIGHETSMATRIS §4): 'forbidden:<reason>' → EF 403 {error:'forbidden', reason}
-- (type_not_allowed, ref_not_visible, recipient_not_allowed, recipient_not_assigned);
-- 'forbidden' → 403 {error:'forbidden'}; 'invalid_entry' → 400; 'idempotency_key_conflict' → 409.
--
-- Datamigrering: ingen. Befintliga notiser skrivs inte om.
--
-- STOP-kontroll: T4-A (20261128000009) måste vara installerad och denna migration får inte vara
-- det; vift_store_full_access, vift_store_project och _store_direct_write_guard ska ha
-- T4-A-/T3-C-versionen (md5 nedan) och vitlistepolicyerna finnas. Rollback:
-- supabase/rollback/T4-A-notiser/rollback_t4a_notiser.sql (återställer de föregående
-- definitionerna och policyerna exakt; rör ingen data). Körs FÖRE T4-A:s rollback.
-- ============================================================
begin;

do $$
declare v text;
begin
  if to_regprocedure('public.notification_append(text,jsonb,text,integer)') is not null then
    raise exception 'T4-A-notiser STOP: notification_append finns redan — tilläggsdelen är redan installerad; kör inte igen';
  end if;
  if to_regprocedure('public._vift_t4a_kan_lasa(text,text,jsonb,text[])') is null then
    raise exception 'T4-A-notiser STOP: T4-A (20261128000009) måste vara installerad först (MIGRATIONSORDNING.txt)';
  end if;
  v := md5(pg_get_functiondef('public.vift_store_full_access(text,text[])'::regprocedure));
  if v not in ('429030d2146ea1997687c83213598ca4') then raise exception 'T4-A-notiser STOP: vift_store_full_access avviker från T4-A-versionen (md5 %)', v; end if;
  v := md5(pg_get_functiondef('public.vift_store_project(text,jsonb,text[],text)'::regprocedure));
  if v not in ('654d0db82ba49f00d7dabba5720c2342') then raise exception 'T4-A-notiser STOP: vift_store_project avviker från T4-A-versionen (md5 %)', v; end if;
  v := md5(pg_get_functiondef('public._store_direct_write_guard()'::regprocedure));
  if v not in ('33b3da1ed510ccda462d5560ba8a1a70') then raise exception 'T4-A-notiser STOP: _store_direct_write_guard avviker från T3-C-versionen (md5 %)', v; end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'store'
      and policyname in ('store_direct_write_allowlist_insert', 'store_direct_write_allowlist_update')
      and with_check like '%vift_notifications%' and with_check like '%vift_lastChanged%') <> 2 then
    raise exception 'T4-A-notiser STOP: T3-C:s vitlistepolicyer saknas eller avviker';
  end if;
end $$;

-- ── 1. Regelfunktioner (bara service_role) ───────────────────────────

/* Notistyper som en klient får skapa, och deras kategori:
     'tilldelning'  ao_assigned — åt annan (eller sig själv) när personal faktiskt tilldelats en AO;
                    kräver ao_edit; mottagaren måste vara tilldelad AO:n; texten sätts av servern.
     'egen'         service_done, service_overdue, service_approaching — påminnelser till sig själv.
   Övriga (offer_approved, ao_pool, okända) skapas aldrig av en klient: null. */
create or replace function public._vift_notis_kategori(p_type text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_type = 'ao_assigned' then 'tilldelning'
    when p_type in ('service_done', 'service_overdue', 'service_approaching') then 'egen'
    else null
  end
$$;

/* Projektion per mottagare: bara poster vars userId är en sträng lika med anroparens personal-id.
   Poster utan mottagarfält (äldre data) eller utan identitet lämnas inte ut (restriktivt). */
create or replace function public._vift_notis_projicera(p_value jsonb, p_staff_id text)
returns jsonb language sql stable set search_path = public as $$
  select case
    when jsonb_typeof(p_value) <> 'array' or coalesce(p_staff_id, '') = '' then '[]'::jsonb
    else coalesce((
      select jsonb_agg(e order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'userId') = 'string' and e ->> 'userId' = p_staff_id), '[]'::jsonb)
  end
$$;

create or replace function public.notification_append(p_caller_staff_id text, p_entry jsonb, p_request_id text, p_max integer DEFAULT 5000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      text := coalesce(p_caller_staff_id, '');
  v_now     timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_max     int := least(greatest(coalesce(p_max, 5000), 1), 5000);
  v_perms   text[];
  v_typ     text;
  v_kat     text;
  v_mott    text;
  v_ao_id   text;
  v_msg     text;
  v_aos     jsonb;
  v_ao      jsonb;
  v_list    jsonb;
  v_fp      text;
  v_key     text;
  v_existing jsonb;
  v_dup     text;
  v_id      text;
  v_entry   jsonb;
  v_result  jsonb;
  v_idx     int;
begin
  -- 0. Indata (inget läses eller låses innan formen är giltig).
  if v_me = '' then raise exception 'forbidden'; end if;
  if p_entry is null or jsonb_typeof(p_entry) <> 'object'
     or coalesce(p_request_id, '') = '' or length(p_request_id) > 100
     or jsonb_typeof(p_entry -> 'userId') is distinct from 'string' or jsonb_typeof(p_entry -> 'type') is distinct from 'string'
     or (p_entry ? 'aoId' and jsonb_typeof(p_entry -> 'aoId') not in ('string', 'null'))
     or (p_entry ? 'message' and jsonb_typeof(p_entry -> 'message') not in ('string', 'null')) then
    raise exception 'invalid_entry';
  end if;
  v_typ := p_entry ->> 'type';
  v_mott := p_entry ->> 'userId';
  v_ao_id := coalesce(p_entry ->> 'aoId', '');
  v_msg := btrim(coalesce(p_entry ->> 'message', ''));
  if v_mott = '' or length(v_mott) > 100 or length(v_typ) > 50 or length(v_ao_id) > 100 then raise exception 'invalid_entry'; end if;

  -- 1. Anroparen omläst i transaktionen (inaktiverad, tom eller okänd roll: inga behörigheter).
  v_perms := public._vift_t4a_aktor_perms(v_me);
  if not public._vift_t4a_giltig(v_perms) then raise exception 'forbidden'; end if;

  -- 2. Typ per behörighet.
  v_kat := public._vift_notis_kategori(v_typ);
  if v_kat is null or (v_kat = 'tilldelning' and not public._vift_has(public._vift_ao_eff_perms(v_perms), 'ao_edit')) then
    raise exception 'forbidden:type_not_allowed';
  end if;
  if v_kat = 'tilldelning' and v_ao_id = '' then raise exception 'invalid_entry'; end if;
  if v_kat = 'egen' and (v_msg = '' or length(v_msg) > 500) then raise exception 'invalid_entry'; end if;

  -- 3. Lås i fast ordning: AO-raden (FOR SHARE, bara när en AO-referens prövas) → notiserna.
  if v_ao_id <> '' then
    select value into v_aos from public.store where key = 'vift_workOrders' for share;
  end if;
  insert into public.store(key, value) values ('vift_notifications', '[]'::jsonb) on conflict (key) do nothing;
  select value into v_list from public.store where key = 'vift_notifications' for update;
  if v_list is null or jsonb_typeof(v_list) <> 'array' then raise exception 'invalid_store_value'; end if;

  -- 4. Idempotens bunden till innehållet (anropare + requestId; fingeravtryck av mottagare, typ, AO, text).
  v_key := v_me || ':' || p_request_id;
  v_fp := md5(jsonb_build_array('notification_append', v_me, v_mott, v_typ, v_ao_id, v_msg)::text);
  v_existing := public._vift_idem_lookup('notification_append', v_key, v_fp);
  if v_existing is not null then return v_existing || jsonb_build_object('replay', true); end if;

  -- 5. Mottagaren: aktiv personal; en egen påminnelse bara till anroparen själv.
  if not public._vift_staff_active(v_mott) or (v_kat = 'egen' and v_mott <> v_me) then
    raise exception 'forbidden:recipient_not_allowed';
  end if;

  -- 6. Referensen prövas för AVSÄNDAREN (T3-D:s regel och urval), på den låsta AO-raden.
  if v_ao_id <> '' then
    if not public._vift_ref_visible('workOrderId', v_ao_id, v_perms, public._vift_post_refs(v_perms, v_me)) then
      raise exception 'forbidden:ref_not_visible';
    end if;
    select e into v_ao from jsonb_array_elements(case when jsonb_typeof(v_aos) = 'array' then v_aos else '[]'::jsonb end) e
      where jsonb_typeof(e) = 'object' and e ->> 'id' = v_ao_id limit 1;
    if v_ao is null then raise exception 'forbidden:ref_not_visible'; end if;
    if v_kat = 'tilldelning' then
      if not public._vift_ao_assigned(v_ao, v_mott) then raise exception 'forbidden:recipient_not_assigned'; end if;
      v_msg := 'Du har tilldelats ' || v_ao_id || ': ' || coalesce(nullif(btrim(coalesce(v_ao ->> 'title', '')), ''), v_ao_id);
    end if;
  end if;

  -- 7. Ingen dubblett av en oläst tilldelningsnotis (mottagare, typ, AO) eller en oläst egen
  --    påminnelse med samma text.
  select e ->> 'id' into v_dup from jsonb_array_elements(v_list) e
    where jsonb_typeof(e) = 'object' and e ->> 'userId' = v_mott and e ->> 'type' = v_typ
      and coalesce(e ->> 'read', 'false') <> 'true'
      and (case when v_kat = 'tilldelning' then coalesce(e ->> 'aoId', '') = v_ao_id else coalesce(e ->> 'message', '') = v_msg end)
    limit 1;
  if v_dup is not null then
    v_result := jsonb_build_object('ok', true, 'id', v_dup, 'duplicate', true);
    insert into public.op_idempotency(fn_name, idem_key, result) values ('notification_append', v_key, v_result || jsonb_build_object('_fp', v_fp));
    return v_result;
  end if;

  -- 8. Servern sätter id, avsändare, tid och läsläge.
  v_id := 'N-' || substr(md5(v_key || '|' || v_fp), 1, 24);
  if exists (select 1 from jsonb_array_elements(v_list) e where e ->> 'id' = v_id) then raise exception 'idempotency_key_conflict'; end if;
  v_entry := jsonb_build_object('id', v_id, 'userId', v_mott, 'type', v_typ, 'message', v_msg, 'aoId', v_ao_id, 'offerId', '',
    'read', false, 'createdAt', v_now_text, 'createdBy', v_me, 'source', 'server');
  v_list := jsonb_build_array(v_entry) || v_list;
  -- Storleksgräns: de äldsta posterna (createdAt) tas bort, aldrig den nya.
  while jsonb_array_length(v_list) > v_max loop
    select (o - 1) into v_idx from jsonb_array_elements(v_list) with ordinality x(e, o)
      where o > 1 order by coalesce(e ->> 'createdAt', '') asc, o desc limit 1;
    v_list := v_list - v_idx;
  end loop;
  update public.store set value = v_list, updated_at = v_now where key = 'vift_notifications';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  v_result := jsonb_build_object('ok', true, 'id', v_id, 'duplicate', false, 'serverSignature', v_now_text);
  if v_mott = v_me then v_result := v_result || jsonb_build_object('notification', v_entry); end if;
  insert into public.op_idempotency(fn_name, idem_key, result) values ('notification_append', v_key, v_result || jsonb_build_object('_fp', v_fp));
  return v_result;
end;
$$;

create or replace function public.notifications_mark_read(p_caller_staff_id text, p_ids jsonb, p_all boolean DEFAULT false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me     text := coalesce(p_caller_staff_id, '');
  v_all    boolean := coalesce(p_all, false);
  v_now    timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_ids    text[] := '{}';
  v_list   jsonb;
  v_new    jsonb;
  v_marked int;
  v_ignored int;
begin
  if v_me = '' then raise exception 'forbidden'; end if;
  if not v_all then
    if p_ids is null or jsonb_typeof(p_ids) <> 'array' or jsonb_array_length(p_ids) = 0 or jsonb_array_length(p_ids) > 500
       or exists (select 1 from jsonb_array_elements(p_ids) x where jsonb_typeof(x) <> 'string' or length(x #>> '{}') = 0 or length(x #>> '{}') > 100) then
      raise exception 'invalid_entry';
    end if;
    select array_agg(distinct x) into v_ids from jsonb_array_elements_text(p_ids) x;
  end if;
  if not public._vift_t4a_giltig(public._vift_t4a_aktor_perms(v_me)) then raise exception 'forbidden'; end if;

  select value into v_list from public.store where key = 'vift_notifications' for update;
  if v_list is null or jsonb_typeof(v_list) <> 'array' then v_list := '[]'::jsonb; end if;

  -- Bara egna (userId = anroparen), olästa, och (alla eller angivna id).
  select coalesce(jsonb_agg(case
           when jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'userId') = 'string' and e ->> 'userId' = v_me
                and coalesce(e ->> 'read', 'false') <> 'true' and (v_all or (e ->> 'id') = any(v_ids))
             then e || jsonb_build_object('read', true, 'readAt', v_now_text)
           else e end order by o), '[]'::jsonb),
         count(*) filter (where jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'userId') = 'string' and e ->> 'userId' = v_me
                and coalesce(e ->> 'read', 'false') <> 'true' and (v_all or (e ->> 'id') = any(v_ids)))
    into v_new, v_marked
    from jsonb_array_elements(v_list) with ordinality x(e, o);
  -- Id som inte är anroparens egna (andras eller okända) räknas lika: inget orakel.
  select count(*) into v_ignored from unnest(v_ids) i
    where not exists (select 1 from jsonb_array_elements(v_list) e
                      where jsonb_typeof(e) = 'object' and e ->> 'id' = i and jsonb_typeof(e -> 'userId') = 'string' and e ->> 'userId' = v_me);

  if v_marked > 0 then
    update public.store set value = v_new, updated_at = v_now where key = 'vift_notifications';
    insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
      on conflict (key) do update set value = excluded.value, updated_at = v_now;
  end if;
  return jsonb_build_object('ok', true, 'marked', v_marked, 'ignored', v_ignored)
    || case when v_marked > 0 then jsonb_build_object('serverSignature', v_now_text) else '{}'::jsonb end;
end;
$$;

-- ── 2. Läsning: hela listan till ingen, projektion per mottagare ─────

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
  if p_key = 'vift_articles' and is_arr then
    return coalesce((select jsonb_agg(public._vift_t4a_projicera_elem(p_key, e, p) order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
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


-- ── 3. REST-vitlistan avvecklas (punkt 275, T3-C beslut 1) ───────────
/* Ingen nyckel kan längre skrivas direkt via REST av authenticated/anon. Notiser skrivs via
   store-key-write (appendNotification, markNotificationsRead) och vift_lastChanged sätts av
   RPC:erna och triggern store_bump_lastchanged. RPC:er (SECURITY DEFINER, ägare postgres) och
   Edge Functions (service_role) berörs inte. Felkoden är oförändrad (42501 direct_write_blocked). */
create or replace function public._store_direct_write_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  -- RPC:er (SECURITY DEFINER, ägare postgres) och Edge Functions (service_role) berörs inte.
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'direct_write_blocked' using errcode = '42501',
      detail = 'Direkt REST-radering av store är inte tillåten (nyckel ' || coalesce(old.key, '') || ').';
  end if;
  if tg_op = 'UPDATE' and new.key is distinct from old.key then
    raise exception 'direct_write_blocked' using errcode = '42501', detail = 'Nyckelbyte är inte tillåtet.';
  end if;
  -- T4-A notiser (punkt 275): vitlistan (vift_notifications, vift_lastChanged) är avvecklad.
  raise exception 'direct_write_blocked' using errcode = '42501',
    detail = 'Direkt REST-skrivning av store är avvecklad (nyckel ' || coalesce(new.key, '') || '). Notiser skrivs via store-key-write (appendNotification, markNotificationsRead).';
end;
$$;

alter policy "store_direct_write_allowlist_insert" on public.store with check (false);
alter policy "store_direct_write_allowlist_update" on public.store using (true) with check (false);

-- ── Rättigheter: bara service_role. vift_store_full_access behåller EXECUTE för authenticated
--    (RLS-hjälpen i store_read_by_role). ────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._vift_notis_kategori(text)', 'public._vift_notis_projicera(jsonb,text)',
    'public.notification_append(text,jsonb,text,integer)', 'public.notifications_mark_read(text,jsonb,boolean)',
    'public.vift_store_project(text,jsonb,text[],text)', 'public._store_direct_write_guard()']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  revoke all on function public.vift_store_full_access(text, text[]) from public, anon;
  grant execute on function public.vift_store_full_access(text, text[]) to authenticated, service_role;
end $$;

commit;
