-- ============================================================
-- T3-D (2026-11-28): informationsåtkomst — urval per post. NY – EJ INSTALLERAD I STAGING.
--
-- Beslut: D-12, D-13, D-14, D-15, D-22 (docs/qa-2026-11-27/BESLUT-2026-11-27.md),
-- K-03, K-04, K-05, Q3 och T3-D (docs/qa-2026-11-28/BESLUT-2026-11-28.md). Rättar SÄK-2 (O2),
-- B4, Ö7, F8 (serverdelen), F9. Testfall: BEHORIGHETSMATRIS §5.6–§5.8 (SEC-B4-01..03,
-- SEC-TASK-04, SEC-OFF-01/02, SEC-KUND-01/02, SEC-B3-01..04).
--
-- Innehåll:
--   1. Regelfunktioner (_vift_*), bara service_role:
--        _vift_ao_visible          = T3-B:s poolregel (canViewWorkOrder i _shared/vift-auth.ts):
--                                    ao_view_all, eller ao_view_own + inte arkiverad/borttagen +
--                                    (tilldelad eller (ao_pool_take och öppen pool)). Byggd på
--                                    T3-B:s _vift_has/_vift_ao_assigned/_vift_ao_eff_perms/
--                                    _vift_ao_open_pool — ingen ny parallell regel.
--        _vift_ao_content_visible  = synlig OCH (ao_view_all eller tilldelad), dvs. INTE via
--                                    öppen pool (Q3: öppen pool ger ingen historik eller
--                                    aktivitetslogg; K-03: inga kontakter). Samma regel som
--                                    canViewWorkOrderContent.
--        _vift_post_refs           = urvalsmängden per anropare: AO som anroparen får se med
--                                    innehåll och de kunder, fastigheter, objekt, offerter och
--                                    den personal de refererar.
--        _vift_kund_las, _vift_staff_external, _vift_task_ao, _vift_activity_ao_type.
--   2. vift_store_full_access (SAMMA SIGNATUR): hela värdet / direkt REST-läsning för
--      vift_activityLog bara med ao_view_all (eller skrivrätten admin_manage), vift_activities
--      bara med admin_manage eller ao_edit + ao_view_all (D-15, samma regel som
--      activities-policy.ts), vift_customers och vift_properties bara för den som både får läsa
--      kundregistret och har objects_sensitive (eller skrivrätten customer_manage; K-04),
--      vift_propertyContacts som kundregistrets läsare (C-5).
--      RLS-policyn store_read_by_role använder funktionen: direkt REST för dessa nycklar ger
--      tom lista för roller utan full åtkomst.
--   3. vift_store_project (SAMMA SIGNATUR som T3-C): urval per post för roller utan full
--      åtkomst:
--        vift_activityLog     poster med workOrderId för AO som anroparen ser med innehåll,
--                             bara AO-händelser (inga offert-, faktura-, kund-, sälj- eller
--                             personalposter) (B4, Q3, SEC-B4-02/03).
--        vift_activities      egna (skapare eller ansvarig) och uppgifter kopplade till AO där
--                             anroparen är tilldelad (D-15, Ö7, SEC-TASK-04). ao_view_all
--                             räcker inte för andras uppgifter.
--        vift_offers          fält: bara offerter kopplade till AO som anroparen ser med
--                             innehåll, med id, titel, status och workOrderId (D-12, F9).
--        vift_customers,      roller som får läsa kundregistret (_vift_kund_las): alla poster
--        vift_properties,     utan portkoder/nyckelinformation (kundregistrets läsare enligt C-5
--                             behåller personnummer). Övriga (fält): bara poster som
--        vift_propertyObjects,hör till AO som anroparen ser med innehåll (D-13). Personnummer,
--        vift_propertyContacts portkoder och nyckelinformation tas alltid bort (K-04).
--        vift_staff           D-14: andra än en själv får bara namn, titel och (för interna
--                             kollegor) arbetstelefon och arbets-e-post. Externa (bara
--                             D-04:s tilläggsbehörigheter) får bara namn och titel för personal
--                             på egna AO (SEC-B3-04). Skyddade personaluppgifter (timpris m.m.)
--                             lämnas inte ut. T3-C:s regel för role/permissions oförändrad.
--      Utan identitet (p_caller_staff_id null, bara en äldre store-key-write) ger de nya
--      per-post-nycklarna tom lista (fail-closed); T3-C:s övergångsväg för vift_staff/vift_roles
--      finns kvar.
--
-- Datamigrering: ingen. Historiska poster skrivs inte om. Portkoder och inv.note rörs inte.
--
-- STOP-kontroll: T3-C måste vara installerad, och de ersatta funktionerna ska ha T3-C:s
-- version (repokedjan; finns inte i STAGING). Rollback: supabase/rollback/T3-D/rollback_t3d.sql
-- (återställer T3-C-definitionerna exakt; rör ingen data).
-- ============================================================
begin;

do $$
declare v text;
begin
  if to_regprocedure('public._vift_post_refs(text[],text)') is not null then
    raise exception 'T3-D STOP: _vift_post_refs finns redan — T3-D är redan installerad; kör inte igen';
  end if;
  if to_regprocedure('public._vift_authz_check(text,jsonb,jsonb,jsonb,jsonb,text)') is null
     or to_regprocedure('public._vift_ao_open_pool(jsonb)') is null then
    raise exception 'T3-D STOP: T3-B och T3-C måste vara installerade först (MIGRATIONSORDNING.txt)';
  end if;
  v := md5(pg_get_functiondef('public.vift_store_full_access(text,text[])'::regprocedure));
  if v not in ('d578292e9c8a7c0305553faf41d3ed24') then
    raise exception 'T3-D STOP: vift_store_full_access avviker från T3-C-versionen (md5 %)', v;
  end if;
  v := md5(pg_get_functiondef('public.vift_store_project(text,jsonb,text[],text)'::regprocedure));
  if v not in ('c46ec751ad2054788c0c9e92f19ace7e') then
    raise exception 'T3-D STOP: vift_store_project avviker från T3-C-versionen (md5 %)', v;
  end if;
end $$;

-- ── 1. Regelfunktioner ───────────────────────────────────────────────

/* T3-B:s poolregel (canViewWorkOrder). */
create or replace function public._vift_ao_visible(p_ao jsonb, p_perms text[], p_staff_id text)
returns boolean language sql immutable set search_path = public as $$
  select case
    when p_ao is null or jsonb_typeof(p_ao) <> 'object' then false
    when public._vift_has(p_perms, 'ao_view_all') then true
    when not public._vift_has(p_perms, 'ao_view_own') or coalesce(p_staff_id, '') = '' then false
    when coalesce(p_ao ->> 'deleted', '') = 'true' or coalesce(p_ao ->> 'archived', '') = 'true' then false
    when public._vift_ao_assigned(p_ao, p_staff_id) then true
    else public._vift_has(public._vift_ao_eff_perms(p_perms), 'ao_pool_take') and public._vift_ao_open_pool(p_ao)
  end
$$;

/* Innehåll (historik, aktivitetslogg, kund/fastighet/kontakt, offertreferens): synlig och
   inte via öppen pool (Q3, K-03). Samma regel som canViewWorkOrderContent. */
create or replace function public._vift_ao_content_visible(p_ao jsonb, p_perms text[], p_staff_id text)
returns boolean language sql immutable set search_path = public as $$
  select public._vift_ao_visible(p_ao, p_perms, p_staff_id)
     and (public._vift_has(p_perms, 'ao_view_all') or public._vift_ao_assigned(p_ao, p_staff_id))
$$;

/* Urvalsmängden per anropare. Läser vift_workOrders (MVCC; under FOR SHARE när den anropas
   från activity_log_append). Offerter: AO:ns offerId och offerter vars workOrderId är en
   synlig AO. Personal: AO:ns staff och ansvarig. */
create or replace function public._vift_post_refs(p_perms text[], p_staff_id text)
returns jsonb language sql stable set search_path = public as $$
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
$$;

/* Roller som får läsa HELA kund-/fastighets-/objekt-/kontaktregistret (skyddade fält borttagna):
   de som redan hade fullt kundregister (C-5) plus de som skapar AO, återkommande ärenden eller
   rapporter och behöver välja kund. Fältroller (bara ao_view_own m.fl.) får urval per uppdrag. */
create or replace function public._vift_kund_las(p_perms text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_perms, '{}') && array['all','customer_manage','invoice_view','invoice_create','offer_manage',
    'sales_manage','ao_view_all','ao_create','recurring_manage','reports_view']
$$;

/* Extern användare (D-04): har inga andra behörigheter än begränsad roll och de tillägg som
   D-04 uttryckligen räknar upp. Interna kollegor får arbetskontakt till kollegor (D-14, R38);
   externa bara namn och titel för personal på egna AO (SEC-B3-04). Avgörs på behörigheter,
   aldrig på roll-id. */
create or replace function public._vift_staff_external(p_perms text[])
returns boolean language sql immutable set search_path = public as $$
  select not exists (select 1 from unnest(coalesce(p_perms, '{}')) x
    where x <> all (array['dashboard_view','ao_view_own','ao_time','ao_checklist','ao_start_own','ao_complete_own',
                          'objects_access_assigned','rondering_utfor']))
$$;

/* Uppgiftens AO-koppling: relatedType 'workOrder' + relatedId (klientens modell), annars ett
   äldre workOrderId. */
create or replace function public._vift_task_ao(p_task jsonb)
returns text language sql immutable set search_path = public as $$
  select case when coalesce(p_task ->> 'relatedType', '') = 'workOrder' and coalesce(p_task ->> 'relatedId', '') <> ''
              then p_task ->> 'relatedId' else nullif(coalesce(p_task ->> 'workOrderId', ''), '') end
$$;

/* AO-händelser i aktivitetsloggen (det fältet får läsa för egna AO, B4). */
create or replace function public._vift_activity_ao_type(p_type text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_type, '') in ('work_order_created','work_order_updated','work_order_status','work_order_assigned',
    'work_order_archived','work_order_restored','work_order_deleted','work_order_permanent_delete','staff_assigned',
    'material_added','material_removed','time_entry_created','note')
$$;

-- ── 2. Hela värdet / direkt REST-läsning ─────────────────────────────

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
    -- T3-D (K-04): kundposter kan bära portkod/nyckelinformation; hela värdet bara med objects_sensitive.
    -- Övriga läsare av kundregistret får det via projektionen (personnummer kvar för dem, som C-5).
    when 'vift_customers'         then (p && kund) and (p && array['objects_sensitive'])
    when 'vift_propertyObjects'   then p && array['objects_sensitive']
    when 'vift_recurringOrders'   then p && array['objects_sensitive']
    -- T3-C (D-21, D-14): hela personal- och rollregistret bara för den som hanterar dem.
    when 'vift_staff'             then p && array['staff_manage','admin_manage']
    when 'vift_roles'             then false
    -- T3-D (B4, D-15, D-13): övriga får urval per post via store-key-write; REST döljer raden.
    when 'vift_activityLog'       then p && array['ao_view_all']
    when 'vift_activities'        then ('ao_edit' = any(p) and 'ao_view_all' = any(p))
    when 'vift_properties'        then (p && array['objects_sensitive']) and (p && kund)
    when 'vift_propertyContacts'  then p && kund
    else true
  end;
end;
$function$;

-- ── 3. Projektion med urval per post ─────────────────────────────────

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
  -- T3-D (D-12): fältets offertreferens = id, titel, status och den AO den hör till.
  offer_ref text[] := array['id','title','status','workOrderId'];
  -- T3-D (K-04, D-05): portkoder och nyckelinformation lämnas aldrig ut via projektionen.
  sens text[] := array['doorCode','keyInformation','accessInformation','keyReceipt','alarmInformation','accessCode','keyInfo'];
  -- T3-D (D-14): det andra än en själv får se av en kollega.
  staff_fields text[] := array['id','firstName','lastName','name','title','active','color','initials'];
  v_id text := nullif(coalesce(p_caller_staff_id, ''), '');
  v_own_role text;
  v_refs jsonb;
  v_ext boolean;
  kund text[] := array['customer_manage','invoice_view','invoice_create','offer_manage','sales_manage','ao_view_all'];
begin
  if p_value is null then return null; end if;
  if public.vift_store_full_access(p_key, p) then return p_value; end if;

  -- Personalregistret (D-14, D-21, SEC-B3-01..04). Den egna posten oförändrad. ÖVERGÅNG utan
  -- identitet (store-key-write före T3-C): vitlistade fält + role/e-post/telefon, så att
  -- inloggningen fungerar.
  if p_key = 'vift_staff' and is_arr then
    if v_id is null then
      return coalesce((
        select jsonb_agg(case when jsonb_typeof(e) <> 'object' then e else
          (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(e) z(k, v)
           where k = any(staff_fields || array['role','email','phone'])) end order by o)
        from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
    end if;
    v_ext := public._vift_staff_external(p);
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

  -- T3-C (D-21, SEC-B3-05): rollregistret. Oförändrat.
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
    -- T3-D (D-12, F9, SEC-OFF-01/02): fält och begränsad roll får bara referensen till
    -- offerter kopplade till AO de ser med innehåll. Inga belopp, rader, token eller andra offerter.
    if v_id is null then return '[]'::jsonb; end if;
    v_refs := public._vift_post_refs(p, v_id);
    return coalesce((
      select jsonb_agg((select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(e) z(k, v) where k = any(offer_ref)) order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (v_refs -> 'offers') ? coalesce(e ->> 'id', '')), '[]'::jsonb);
  end if;

  if p_key = 'vift_settings' and jsonb_typeof(p_value) = 'object' then
    return p_value - array['internalHourlyCost','bankgiro'];
  end if;

  -- T3-D (D-13, SEC-KUND-01/02): kunder, fastigheter, objekt och kontakter.
  if p_key in ('vift_customers','vift_properties','vift_propertyObjects','vift_propertyContacts') and is_arr then
    if not public._vift_kund_las(p) then
      if v_id is null then return '[]'::jsonb; end if;
      v_refs := public._vift_post_refs(p, v_id);
    end if;
    return coalesce((
      select jsonb_agg(case
        -- Läsare av hela kundregistret (C-5:s lista) behåller personnummer som tidigare.
        when p_key = 'vift_customers' and p && kund then e - sens
        when p_key = 'vift_customers' and lower(coalesce(e->>'type','')) in ('privat','private','privatperson') then e - array['personnr','orgNr'] - sens
        when p_key = 'vift_customers' then e - 'personnr' - sens
        else e - sens end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (v_refs is null or case p_key
        when 'vift_customers' then (v_refs -> 'customers') ? coalesce(e ->> 'id', '')
        when 'vift_properties' then (v_refs -> 'properties') ? coalesce(e ->> 'id', '')
        when 'vift_propertyObjects' then (v_refs -> 'objects') ? coalesce(e ->> 'id', '')
        else (v_refs -> 'properties') ? coalesce(e ->> 'propertyId', '')
             and (coalesce(e ->> 'objectId', '') = '' or (v_refs -> 'objects') ? (e ->> 'objectId')) end)), '[]'::jsonb);
  end if;

  if p_key = 'vift_recurringOrders' and is_arr then
    return coalesce((
      select jsonb_agg(case when jsonb_typeof(e) = 'object' then e - 'accessCode' else e end order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)), '[]'::jsonb);
  end if;

  -- T3-D (B4, Q3, SEC-B4-02/03): aktivitetsloggen för fält = AO-händelser för AO som anroparen
  -- ser med innehåll (inte öppen pool). Inga poster med offert-, faktura- eller säljreferens.
  if p_key = 'vift_activityLog' and is_arr then
    if v_id is null then return '[]'::jsonb; end if;
    v_refs := public._vift_post_refs(p, v_id);
    return coalesce((
      select jsonb_agg(e order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and public._vift_activity_ao_type(e ->> 'type')
        and (v_refs -> 'ao') ? coalesce(e ->> 'workOrderId', '')
        and coalesce(e ->> 'offerId', '') = '' and coalesce(e ->> 'invoiceId', '') = ''
        and coalesce(e ->> 'salesOpportunityId', '') = ''), '[]'::jsonb);
  end if;

  -- T3-D (D-15, Ö7, SÄK-2, SEC-TASK-04): egna uppgifter (skapare eller ansvarig) och uppgifter
  -- kopplade till AO där anroparen är tilldelad. ao_view_all ger inte andras uppgifter.
  if p_key = 'vift_activities' and is_arr then
    if v_id is null then return '[]'::jsonb; end if;
    v_refs := case when p && array['ao_view_own','ao_view_all'] then public._vift_post_refs(array['ao_view_own'], v_id) else '{"ao":[]}'::jsonb end;
    return coalesce((
      select jsonb_agg(e order by o)
      from jsonb_array_elements(p_value) with ordinality x(e, o)
      where jsonb_typeof(e) = 'object' and (coalesce(e ->> 'createdBy', '') = v_id or coalesce(e ->> 'assignedTo', '') = v_id
            or (v_refs -> 'ao') ? coalesce(public._vift_task_ao(e), ''))), '[]'::jsonb);
  end if;

  -- Nycklar som rollen inte ska se alls: tomt värde av samma form.
  return case jsonb_typeof(p_value) when 'array' then '[]'::jsonb when 'object' then '{}'::jsonb else null end;
end;
$function$;

-- ── Rättigheter: bara service_role (Edge Functions). vift_store_full_access behåller
--    sin EXECUTE för authenticated (RLS-hjälpen i store_read_by_role). ────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._vift_ao_visible(jsonb,text[],text)', 'public._vift_ao_content_visible(jsonb,text[],text)',
    'public._vift_post_refs(text[],text)', 'public._vift_kund_las(text[])', 'public._vift_staff_external(text[])',
    'public._vift_task_ao(jsonb)', 'public._vift_activity_ao_type(text)',
    'public.vift_store_project(text,jsonb,text[],text)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- vift_store_full_access: samma rättigheter som tidigare (authenticated för RLS, service_role).
  revoke all on function public.vift_store_full_access(text, text[]) from public, anon;
  grant execute on function public.vift_store_full_access(text, text[]) to authenticated, service_role;
end $$;

commit;
