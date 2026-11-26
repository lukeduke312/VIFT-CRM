-- ============================================================
-- T4-A (2026-11-28): skyddade fält, projektion även för skrivare, fältvis sammanslagning,
-- uttryckliga behörigheter för kollegors arbetskontakt och full aktivitetslogg, skydd mot att
-- äldre klienter tappar behörigheter, och inga verksamhetsdata utan giltig behörighet.
-- NY – EJ INSTALLERAD I STAGING. Installeras i samma serveromgång som T4-B (T4-A + T4-B).
--
-- Beslut: D-01, D-05, D-06, D-13, D-17, B1, B5, K-02 (docs/qa-2026-11-27/BESLUT-2026-11-27.md),
-- "Tillägg efter T3-leveransen" (docs/qa-2026-11-28/BESLUT-2026-11-28.md): T3-D 2 och 6, T3-E 4,
-- 5 och "äldre cachade klienter", punkt 7 (okända/tomma/inaktiverade roller, åtkomst per post).
-- Rättar SÄK-7 (läckaget till skrivare, P1). Testfall: BEHORIGHETSMATRIS §5.4 (SEC-B1-09/11/12/14/
-- 17, SEC-B2-06), §5.6 (SEC-KUND-03..06), §5.9 (SEC-B5-01..05), §5.11 (SEC-INST-01..07), §5.13.
--
-- Innehåll:
--   1. Regelfunktioner (_vift_t4a_*), bara service_role:
--        _vift_t4a_falt / _kan_lasa / _kan_skriva   katalogen över skyddade fält per nyckel:
--            portkod och nyckelinformation (doorCode, keyInformation, accessInformation, keyReceipt,
--              alarmInformation, accessCode, keyInfo)                       objects_sensitive
--            personnr, orgNr för privatperson (vift_customers)             personal_data_view
--            buyPrice, markup (vift_articles)                    läsa cost_view, skriva cost_edit
--            internalHourlyCost (vift_settings)                  läsa cost_view, skriva cost_edit
--            bankgiro och betalningsuppgifter (vift_settings)    läsa interna roller, skriva bankgiro_edit
--            materials[].buyPrice (vift_workOrders)              läsa cost_view, skriva cost_edit
--        _vift_t4a_projicera_elem                   tar bort de fält anroparen inte får läsa.
--        _vift_t4a_sammanfoga(_lista)               FÄLTVIS SAMMANSLAGNING vid skrivning: ett fält
--            anroparen inte får skriva hämtas från det lagrade värdet om det saknas i skrivningen
--            (projicerat värde raderar aldrig), och om det finns med (annat än tomt mot tomt, eller
--            oförändrat läsbart värde) nekas hela skrivningen med 403 forbidden/field_protected.
--            Ett oläsbart fält jämförs aldrig mot det lagrade värdet (inget orakel).
--        _vift_t4a_aktor_perms                      anroparens behörigheter lästa i RPC:ns transaktion
--            (personalpost via id, aktiv app_users, rollens permissions; inaktiv roll = inga).
--        _vift_t4a_giltig                           minst en verkställd behörighet ur katalogen.
--        _vift_t4a_legacy / _kontakt / _logg_full    staff_contacts_view och activity_log_view_all
--            med ÖVERGÅNGSREGEL (som T3-B §4.6): en roll som saknar BÅDA de nya behörigheterna
--            behåller T3-D/T3-E:s härledning (intern kollega av behörigheterna; hela loggen med
--            ao_view_all eller admin_manage). Så fort en roll får någon av dem gäller listan exakt.
--        _vift_t4a_roller_bevara                    v3.4- och T3-klienter (utan katalogmarkör) kan
--            inte ta bort behörigheter som deras rolleditor inte känner till (T3-E-beslutet).
--        _vift_t4a_ao_patch                         fältvis kontroll i work_order_patch (accessCode,
--            materials[].buyPrice); nya rader med inköpspris utan cost_edit → ignoredFields.
--   2. Ändrade funktioner (SAMMA signatur): vift_store_full_access, vift_store_project,
--      work_order_patch, _vift_role_perms, vift_caller_perms, _vift_auth_staff, _vift_ej_verkstallda.
--      NY signatur (extra parameter p_klient jsonb DEFAULT NULL; namngivna anrop från en äldre EF
--      fungerar oförändrat): store_business_key_write, store_business_key_merge_write.
--      store_business_key_merge_write sammanfogar dessutom vift_settings FÄLT FÖR FÄLT (D-17):
--      upserts {id: fältnamn, data: värde, previous: senast lästa värde}; samtidiga ändringar av
--      olika fält tappar inget, samma fält ger konflikt (som element i listnycklarna).
--   3. Projektion även för skrivare (C-5 regel 1 ersatt): hela värdet (och direkt REST-läsning)
--      bara om anroparen får läsa alla skyddade fält i nyckeln. Okänd roll, tom eller bara ej
--      verkställda behörigheter, och inaktiverad roll: inga verksamhetsdata (bara egen personalpost
--      och egen roll). Åtkomst per post för återkommande ärenden, projekt, avvikelser och
--      inspektioner (samma urval som T3-D för kunder).
--   4. _vift_ej_verkstallda: cost_view, cost_edit, personal_data_view, bankgiro_edit verkställs nu
--      och tas bort ur registret (cost_edit:s materialradsdel och prisflödet: T4-B).
--
-- LÅSORDNING (oförändrad mot T3): store_business_key_* tar som förut (T3-C-låset för personal/
-- roller) → nyckelns rad FOR UPDATE → vift_lastChanged sist. Anroparens behörigheter LÄSES
-- (MVCC, utan lås) i samma transaktion. work_order_patch: vift_workOrders FOR UPDATE (som T3-B).
--
-- Felkoder (BEHORIGHETSMATRIS §4): 'forbidden:field_protected' → EF 403 {error:'forbidden',
-- reason:'field_protected'}. En äldre EF (T3) tolkar samma text som 403 forbidden + reason
-- (T3-C:s regex). Inga nya 409-koder.
--
-- Datamigrering: ingen. Portkoder, personnummer och priser i lagrade värden skrivs inte om.
--
-- STOP-kontroll: T3-E (20261128000008) måste vara installerad, T4-A får inte vara det, och de
-- ersatta funktionerna ska ha T3-versionen (repokedjan; md5 nedan) respektive STAGING-versionen
-- (vift_caller_perms). Rollback: supabase/rollback/T4-A/rollback_t4a.sql (återställer föregående
-- definitioner exakt; rör ingen data). T4-B kompletterar i en egen migration efter denna.
-- ============================================================
begin;

do $$
declare v text;
begin
  if to_regprocedure('public._vift_t4a_kan_lasa(text,text,jsonb,text[])') is not null then
    raise exception 'T4-A STOP: _vift_t4a_kan_lasa finns redan — T4-A är redan installerad; kör inte igen';
  end if;
  if to_regprocedure('public._vift_ej_verkstallda()') is null then
    raise exception 'T4-A STOP: T3-E (20261128000008) måste vara installerad först (MIGRATIONSORDNING.txt)';
  end if;
  v := md5(pg_get_functiondef('public.vift_store_full_access(text,text[])'::regprocedure));
  if v not in ('92676359cc8ac79b7fa8b767904a646a') then raise exception 'T4-A STOP: vift_store_full_access avviker från T3-D-versionen (md5 %)', v; end if;
  v := md5(pg_get_functiondef('public.vift_store_project(text,jsonb,text[],text)'::regprocedure));
  if v not in ('64bd544627cf094bebffe6500aa63be8') then raise exception 'T4-A STOP: vift_store_project avviker från T3-D-versionen (md5 %)', v; end if;
  v := md5(pg_get_functiondef('public.store_business_key_write(text,jsonb,text,boolean,text)'::regprocedure));
  if v not in ('1ba131986ee4660659ae17816a034a56') then raise exception 'T4-A STOP: store_business_key_write avviker från T3-C-versionen (md5 %)', v; end if;
  v := md5(pg_get_functiondef('public.store_business_key_merge_write(text,jsonb,jsonb,boolean,text)'::regprocedure));
  if v not in ('f0a2b14ab404e0e7d0e8f6bd52db55d3') then raise exception 'T4-A STOP: store_business_key_merge_write avviker från T3-C-versionen (md5 %)', v; end if;
  v := md5(pg_get_functiondef('public.work_order_patch(text,jsonb,text,text,text,text[])'::regprocedure));
  if v not in ('081821fd2bcdd92be6afb0d9fa1b32c1') then raise exception 'T4-A STOP: work_order_patch avviker från T3-B-versionen (md5 %)', v; end if;
  v := md5(pg_get_functiondef('public._vift_ej_verkstallda()'::regprocedure));
  if v not in ('7ef7b3f8e5d2b33dc5fa05b2e0175e3f') then raise exception 'T4-A STOP: _vift_ej_verkstallda avviker från T3-E-versionen (md5 %)', v; end if;
  v := md5(pg_get_functiondef('public._vift_role_perms(jsonb,text)'::regprocedure));
  if v not in ('a2247a4104318a91800e931a6c25a7f5') then raise exception 'T4-A STOP: _vift_role_perms avviker från T3-C-versionen (md5 %)', v; end if;
  v := md5(pg_get_functiondef('public._vift_auth_staff(uuid)'::regprocedure));
  if v not in ('a535f8838d4e443a1c105db8d1acd57b') then raise exception 'T4-A STOP: _vift_auth_staff avviker från T3-B-versionen (md5 %)', v; end if;
  v := md5(pg_get_functiondef('public.vift_caller_perms()'::regprocedure));
  if v not in ('5146bf599bd2eadf2b3c95fcee680379') then raise exception 'T4-A STOP: vift_caller_perms avviker från STAGING-versionen (md5 %)', v; end if;
end $$;

-- ── 1. Regelfunktioner ───────────────────────────────────────────────

/* Inaktiverad roll (active uttryckligen false/0) ger inga behörigheter. En roll utan active-fält
   räknas som aktiv (som tidigare). Personalposter tolkas som förut (_vift_rec_active). */
create or replace function public._vift_t4a_roll_aktiv(p_role jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(p_role) = 'object' and coalesce(p_role ->> 'active', 'true') not in ('false', '0')
$$;

/* Katalogen över verkställda behörigheter (BEHORIGHETSMATRIS §1). En anropare utan någon av dem
   (tom lista, okänd roll, inaktiverad roll, eller bara ej verkställda/okända strängar) får inga
   verksamhetsdata — bara den egna personalposten och den egna rollen (inloggningen). */
create or replace function public._vift_t4a_giltig(p_perms text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_perms, '{}') && array['all','dashboard_view','ao_view_all','ao_view_own','ao_create','ao_edit','ao_complete',
    'ao_time','ao_material','ao_checklist','ao_start_own','ao_complete_own','ao_pool_take','customer_manage','customer_view',
    'offer_manage','invoice_view','invoice_create','staff_view','staff_manage','staff_contacts_view','admin_manage',
    'article_manage','recurring_manage','sales_manage','reports_view','payroll_view','payroll_manage','objects_sensitive',
    'cost_view','cost_edit','personal_data_view','bankgiro_edit','activity_log_view_all']
$$;

/* Övergångsregel för T4:s två nya behörigheter (som T3-B §4.6): en roll utan båda behandlas som
   tidigare. Tas bort när ingen aktiv roll i STAGING och LIVE beror på den (införandeplanen). */
create or replace function public._vift_t4a_legacy(p_perms text[])
returns boolean language sql immutable set search_path = public as $$
  select not (coalesce(p_perms, '{}') && array['all','staff_contacts_view','activity_log_view_all'])
$$;

/* Arbetskontakt till kollegor (D-14, R38). Uttryckligen staff_contacts_view (T3-D 2, T3-E 4).
   Övergång: T3-E:s härledning med den FASTA listan från T3-E (D-04:s tillägg + de tio då ej
   verkställda), så att T4:s verkställande av cost_view m.fl. inte gör en extern roll intern. */
create or replace function public._vift_t4a_kontakt(p_perms text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce('all' = any(p_perms) or 'staff_contacts_view' = any(p_perms), false)
      or (public._vift_t4a_legacy(p_perms) and exists (select 1 from unnest(coalesce(p_perms, '{}')) x
            where x <> all (array['dashboard_view','ao_view_own','ao_time','ao_checklist','ao_start_own','ao_complete_own',
              'objects_access_assigned','rondering_utfor','ao_plan_own','cost_view','cost_edit','time_view_all','bankgiro_edit',
              'personal_data_view','export_data','export_personal_data'])))
$$;

/* Hela aktivitetsloggen (T3-D 6): activity_log_view_all. Övergång: som T3-D (ao_view_all eller
   admin_manage). Övriga: händelser för AO där anroparen är TILLDELAD (fältets historik). */
create or replace function public._vift_t4a_logg_full(p_perms text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce('all' = any(p_perms) or 'activity_log_view_all' = any(p_perms), false)
      or (public._vift_t4a_legacy(p_perms) and coalesce(p_perms, '{}') && array['ao_view_all','admin_manage'])
$$;

create or replace function public._vift_t4a_privat(p_e jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(p_e) = 'object' and lower(coalesce(p_e ->> 'type', '')) in ('privat','private','privatperson')
$$;

create or replace function public._vift_t4a_tom(p_v jsonb)
returns boolean language sql immutable set search_path = public as $$
  select p_v is null or jsonb_typeof(p_v) = 'null' or p_v = '""'::jsonb
$$;

/* Skyddade fält per nyckel (toppnivå). materials[].buyPrice hanteras i _vift_t4a_ao_patch. */
create or replace function public._vift_t4a_falt(p_key text)
returns text[] language sql immutable set search_path = public as $$
  select case
    when p_key = 'vift_customers' then array['doorCode','keyInformation','accessInformation','keyReceipt','alarmInformation','accessCode','keyInfo','personnr','orgNr']
    when p_key in ('vift_properties','vift_propertyObjects','vift_propertyContacts','vift_recurringOrders','vift_workOrders')
      then array['doorCode','keyInformation','accessInformation','keyReceipt','alarmInformation','accessCode','keyInfo']
    when p_key = 'vift_articles' then array['buyPrice','markup']
    when p_key = 'vift_settings' then array['internalHourlyCost','bankgiro','plusgiro','iban','bic','swish']
    else '{}'::text[] end
$$;

/* Får anroparen läsa fältet? p_e = elementet (bara för orgNr: skyddat när kunden är privatperson). */
create or replace function public._vift_t4a_kan_lasa(p_key text, p_falt text, p_e jsonb, p_perms text[])
returns boolean language sql immutable set search_path = public as $$
  select case
    when 'all' = any(coalesce(p_perms, '{}')) then true
    when p_falt = any(array['doorCode','keyInformation','accessInformation','keyReceipt','alarmInformation','accessCode','keyInfo'])
         and p_key in ('vift_customers','vift_properties','vift_propertyObjects','vift_propertyContacts','vift_recurringOrders','vift_workOrders')
      then 'objects_sensitive' = any(p_perms)
    when p_key = 'vift_customers' and p_falt = 'personnr' then 'personal_data_view' = any(p_perms)
    when p_key = 'vift_customers' and p_falt = 'orgNr' then not public._vift_t4a_privat(p_e) or 'personal_data_view' = any(p_perms)
    when p_key = 'vift_articles' and p_falt in ('buyPrice','markup') then 'cost_view' = any(p_perms)
    when p_key = 'vift_settings' and p_falt = 'internalHourlyCost' then 'cost_view' = any(p_perms)
    when p_key = 'vift_settings' and p_falt in ('bankgiro','plusgiro','iban','bic','swish')
      then p_perms && array['admin_manage','invoice_view','invoice_create','reports_view','offer_manage','ao_view_all','ao_edit','bankgiro_edit']
    else true end
$$;

/* Får anroparen skriva fältet? Kräver alltid att fältet får läsas. */
create or replace function public._vift_t4a_kan_skriva(p_key text, p_falt text, p_e jsonb, p_perms text[])
returns boolean language sql immutable set search_path = public as $$
  select public._vift_t4a_kan_lasa(p_key, p_falt, p_e, p_perms) and case
    when 'all' = any(coalesce(p_perms, '{}')) then true
    when p_falt = any(array['doorCode','keyInformation','accessInformation','keyReceipt','alarmInformation','accessCode','keyInfo'])
         and p_key in ('vift_customers','vift_properties','vift_propertyObjects','vift_propertyContacts','vift_recurringOrders','vift_workOrders')
      then 'objects_sensitive' = any(p_perms)
    when p_key = 'vift_customers' and p_falt = 'personnr' then 'personal_data_view' = any(p_perms)
    when p_key = 'vift_customers' and p_falt = 'orgNr' then not public._vift_t4a_privat(p_e) or 'personal_data_view' = any(p_perms)
    when p_key = 'vift_articles' and p_falt in ('buyPrice','markup') then 'cost_edit' = any(p_perms)
    when p_key = 'vift_settings' and p_falt = 'internalHourlyCost' then 'cost_edit' = any(p_perms)
    when p_key = 'vift_settings' and p_falt in ('bankgiro','plusgiro','iban','bic','swish') then 'bankgiro_edit' = any(p_perms)
    else true end
$$;

/* Får anroparen läsa ALLA skyddade fält i nyckeln? Annars aldrig hela värdet (C-5 regel 1 ersatt). */
create or replace function public._vift_t4a_alla_lasbara(p_key text, p_perms text[])
returns boolean language sql immutable set search_path = public as $$
  select case
    when 'all' = any(coalesce(p_perms, '{}')) then true
    when p_key = 'vift_customers' then coalesce(p_perms, '{}') @> array['objects_sensitive','personal_data_view']
    when p_key in ('vift_properties','vift_propertyObjects','vift_propertyContacts','vift_recurringOrders') then 'objects_sensitive' = any(p_perms)
    when p_key = 'vift_articles' then 'cost_view' = any(p_perms)
    when p_key = 'vift_settings' then 'cost_view' = any(p_perms)
      and p_perms && array['admin_manage','invoice_view','invoice_create','reports_view','offer_manage','ao_view_all','ao_edit','bankgiro_edit']
    else true end
$$;

/* Elementet utan de fält anroparen inte får läsa. */
create or replace function public._vift_t4a_projicera_elem(p_key text, p_e jsonb, p_perms text[])
returns jsonb language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p_e) <> 'object' then p_e else
    p_e - coalesce((select array_agg(f) from unnest(public._vift_t4a_falt(p_key)) f
                    where p_e ? f and not public._vift_t4a_kan_lasa(p_key, f, p_e, p_perms)), '{}'::text[]) end
$$;

/* Fältvis sammanslagning av ETT element (eller vift_settings-objektet) under RPC:ns radlås.
   p_old = lagrat element (null = nytt). Returnerar elementet som ska sparas eller kastar
   'forbidden:field_protected'. Ingen ändring av fält som anroparen får skriva. */
create or replace function public._vift_t4a_sammanfoga(p_key text, p_old jsonb, p_new jsonb, p_perms text[])
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_out jsonb := p_new;
  v_ref jsonb;
  f text;
begin
  if jsonb_typeof(p_new) is distinct from 'object' then return p_new; end if;
  if p_old is not null and jsonb_typeof(p_old) <> 'object' then p_old := null; end if;
  -- orgNr är skyddat om kunden blir privatperson, eller var privatperson med ett lagrat org.nr
  -- (äldre personnummer i org.nr-fältet). Byte från privatperson utan lagrat org.nr till företag
  -- får ange företagets org.nr.
  v_ref := case when p_key = 'vift_customers' and (public._vift_t4a_privat(p_new)
                  or (public._vift_t4a_privat(p_old) and not public._vift_t4a_tom(p_old -> 'orgNr')))
                then '{"type":"privat"}'::jsonb else '{}'::jsonb end;
  -- Typbyte från privatperson utan personal_data_view skulle lämna ut ett lagrat org.nr/personnummer.
  if p_key = 'vift_customers' and public._vift_t4a_privat(p_old) and not public._vift_t4a_privat(p_new)
     and not public._vift_t4a_kan_skriva(p_key, 'orgNr', v_ref, p_perms) and not public._vift_t4a_tom(p_old -> 'orgNr') then
    raise exception 'forbidden:field_protected';
  end if;
  foreach f in array public._vift_t4a_falt(p_key) loop
    continue when public._vift_t4a_kan_skriva(p_key, f, v_ref, p_perms);
    if not (p_new ? f) then
      -- Projicerat (saknat) fält raderar aldrig det lagrade värdet.
      if p_old is not null and p_old ? f then v_out := v_out || jsonb_build_object(f, p_old -> f); end if;
    elsif public._vift_t4a_tom(p_new -> f) and (p_old is null or not (p_old ? f) or public._vift_t4a_tom(p_old -> f)) then
      null; -- tomt mot tomt: ingen ändring (t.ex. ett nytt element ur klientens schema)
    elsif p_old is not null and p_old ? f and public._vift_t4a_kan_lasa(p_key, f, v_ref, p_perms) and (p_new -> f) = (p_old -> f) then
      null; -- läsbart men inte skrivbart fält, oförändrat (t.ex. bankgiro för admin_manage)
    else
      raise exception 'forbidden:field_protected';
    end if;
  end loop;
  return v_out;
end $$;

/* Hela listan (store_business_key_write): varje element sammanfogas med det lagrade elementet
   med samma id (det första, som RPC:erna); element utan id behandlas som nya. */
create or replace function public._vift_t4a_sammanfoga_lista(p_key text, p_old jsonb, p_new jsonb, p_perms text[])
returns jsonb language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p_new) <> 'array' then p_new else coalesce((
    select jsonb_agg(case when jsonb_typeof(n.e) = 'object' then public._vift_t4a_sammanfoga(p_key,
        (select o.e from jsonb_array_elements(case when jsonb_typeof(p_old) = 'array' then p_old else '[]'::jsonb end) with ordinality o(e, i)
         where jsonb_typeof(o.e) = 'object' and coalesce(n.e ->> 'id', '') <> '' and o.e ->> 'id' = n.e ->> 'id' order by o.i limit 1),
        n.e, p_perms) else n.e end order by n.o)
    from jsonb_array_elements(p_new) with ordinality n(e, o)), '[]'::jsonb) end
$$;

/* Anroparens behörigheter, lästa i RPC:ns transaktion (samma regel som checkViftAuth):
   första aktiva personalposten med id:t, en aktiv app_users-rad för dess e-post, rollens
   permissions (inaktiverad eller okänd roll = inga). */
create or replace function public._vift_t4a_aktor_perms(p_actor text)
returns text[] language sql stable set search_path = public as $$
  select coalesce((
    select public._vift_role_perms(r.value, s.e ->> 'role')
    from public.store st, public.store r,
      jsonb_array_elements(case when jsonb_typeof(st.value) = 'array' then st.value else '[]'::jsonb end) with ordinality s(e, o)
    where st.key = 'vift_staff' and r.key = 'vift_roles' and public._vift_rec_active(s.e) and s.e ->> 'id' = p_actor
      and exists (select 1 from public.app_users au join auth.users u on u.id = au.user_id
                  where au.active = true and nullif(u.email, '') is not null and lower(u.email) = lower(coalesce(s.e ->> 'email', '')))
    order by s.o limit 1), '{}'::text[])
$$;

/* v3.4-rolleditorns katalog (de behörigheter den visar som kryssrutor). En skrivning UTAN
   katalogmarkör från en T4-klient får bara ta bort behörigheter ur den listan; övriga som fanns i
   den lagrade rollen bevaras (T3-E-beslutet: äldre cachade klienter får inte tappa nya behörigheter).
   T4-klienten skickar {"behorighetskatalog": 4}. */
create or replace function public._vift_t4a_roller_bevara(p_old jsonb, p_new jsonb, p_klient jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_kept jsonb;
begin
  if coalesce(p_klient ->> 'behorighetskatalog', '') ~ '^[0-9]{1,3}$' and (p_klient ->> 'behorighetskatalog')::int >= 4 then return p_new; end if;
  if jsonb_typeof(p_old) is distinct from 'object' or jsonb_typeof(p_new) is distinct from 'object'
     or jsonb_typeof(p_old -> 'permissions') is distinct from 'array' or jsonb_typeof(p_new -> 'permissions') is distinct from 'array' then
    return p_new;
  end if;
  select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into v_kept
  from jsonb_array_elements(p_old -> 'permissions') with ordinality q(x, o)
  where not ((p_new -> 'permissions') @> jsonb_build_array(x))
    and jsonb_typeof(x) = 'string'
    and (x #>> '{}') <> all (array['all','dashboard_view','ao_view_all','ao_view_own','ao_create','ao_edit','ao_complete','ao_time',
      'ao_material','ao_checklist','customer_manage','offer_manage','invoice_view','invoice_create','staff_view','staff_manage',
      'admin_manage','article_manage','payroll_view','payroll_manage','recurring_manage','sales_manage','reports_view','objects_sensitive']);
  if jsonb_array_length(v_kept) = 0 then return p_new; end if;
  return p_new || jsonb_build_object('permissions', (p_new -> 'permissions') || v_kept);
end $$;

/* work_order_patch: fältvis kontroll av skyddade AO-fält (B5, B1). Returnerar {patch, ignored}.
   accessCode: objects_sensitive. materials[].buyPrice: läsa cost_view, skriva cost_edit; en
   befintlig rad (samma id) får saknat inköpspris tillbaka från servern; en ny rad med inköpspris
   från en anropare utan cost_edit: priset ignoreras och redovisas (T4-B sätter serverpris). */
create or replace function public._vift_t4a_ao_patch(p_ao jsonb, p_patch jsonb, p_perms text[])
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_patch jsonb := p_patch;
  v_ignored text[] := '{}';
  v_old_rows jsonb := case when jsonb_typeof(p_ao -> 'materials') = 'array' then p_ao -> 'materials' else '[]'::jsonb end;
  v_rows jsonb := '[]'::jsonb;
  n jsonb; o jsonb; f text;
  v_las boolean := 'all' = any(coalesce(p_perms, '{}')) or 'cost_view' = any(p_perms);
  v_skriv boolean := 'all' = any(coalesce(p_perms, '{}')) or ('cost_view' = any(p_perms) and 'cost_edit' = any(p_perms));
begin
  foreach f in array public._vift_t4a_falt('vift_workOrders') loop
    if v_patch ? f and not public._vift_t4a_kan_skriva('vift_workOrders', f, p_ao, p_perms) then
      if public._vift_t4a_tom(v_patch -> f) and public._vift_t4a_tom(p_ao -> f) then v_patch := v_patch - f;
      else raise exception 'forbidden:field_protected'; end if;
    end if;
  end loop;
  if v_skriv or not (v_patch ? 'materials') or jsonb_typeof(v_patch -> 'materials') <> 'array' then
    return jsonb_build_object('patch', v_patch, 'ignored', to_jsonb(v_ignored));
  end if;
  for n in select e from jsonb_array_elements(v_patch -> 'materials') with ordinality x(e, i) order by i loop
    o := null;
    if jsonb_typeof(n) = 'object' and coalesce(n ->> 'id', '') <> '' then
      select x.e into o from jsonb_array_elements(v_old_rows) with ordinality x(e, i)
        where jsonb_typeof(x.e) = 'object' and x.e ->> 'id' = n ->> 'id' order by x.i limit 1;
    end if;
    if jsonb_typeof(n) <> 'object' then
      null;
    elsif o is not null then
      if not (n ? 'buyPrice') then
        if o ? 'buyPrice' then n := n || jsonb_build_object('buyPrice', o -> 'buyPrice'); end if;
      elsif public._vift_t4a_tom(n -> 'buyPrice') and (not (o ? 'buyPrice') or public._vift_t4a_tom(o -> 'buyPrice')) then
        null;
      elsif v_las and o ? 'buyPrice' and (n -> 'buyPrice') = (o -> 'buyPrice') then
        null;
      else
        raise exception 'forbidden:field_protected';
      end if;
    elsif n ? 'buyPrice' and not public._vift_t4a_tom(n -> 'buyPrice') then
      n := n - 'buyPrice';
      if not ('materials[].buyPrice' = any(v_ignored)) then v_ignored := array_append(v_ignored, 'materials[].buyPrice'); end if;
    end if;
    v_rows := v_rows || jsonb_build_array(n);
  end loop;
  return jsonb_build_object('patch', v_patch || jsonb_build_object('materials', v_rows), 'ignored', to_jsonb(v_ignored));
end $$;

/* AO-id som anroparen ser med innehåll, och de poster de refererar (återkommande, projekt). */
create or replace function public._vift_t4a_ao_ref(p_perms text[], p_staff_id text, p_falt text)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(distinct e ->> p_falt), '[]'::jsonb)
  from public.store st, jsonb_array_elements(case when jsonb_typeof(st.value) = 'array' then st.value else '[]'::jsonb end) e
  where st.key = 'vift_workOrders' and jsonb_typeof(e) = 'object' and coalesce(e ->> p_falt, '') <> ''
    and public._vift_ao_content_visible(e, p_perms, p_staff_id)
$$;

-- ── 2. Ändrade hjälpfunktioner (samma signatur) ──────────────────────

/* T4-A (punkt 7, beslutets kvarstående luckor): inaktiverad roll ger inga behörigheter. Annars
   oförändrat (T3-C): FÖRSTA rollen med id:t, bara om permissions är en lista. */
create or replace function public._vift_role_perms(p_roles jsonb, p_role_id text)
returns text[] language sql immutable set search_path = public as $$
  with r as (
    select x.e from jsonb_array_elements(case when jsonb_typeof(p_roles) = 'array' then p_roles else '[]'::jsonb end) with ordinality x(e, o)
    where jsonb_typeof(x.e) = 'object' and x.e ->> 'id' = p_role_id
    order by x.o limit 1)
  select coalesce((select case when jsonb_typeof(r.e -> 'permissions') = 'array' and public._vift_t4a_roll_aktiv(r.e)
      then array(select jsonb_array_elements_text(r.e -> 'permissions')) else '{}'::text[] end from r), '{}'::text[])
$$;

/* T4-A: samma regel som checkViftAuth (inaktiverad roll = inga behörigheter). */
CREATE OR REPLACE FUNCTION public.vift_caller_perms()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with u as (
    select lower(au.email) as email
    from auth.users au
    join public.app_users ap on ap.user_id = au.id and ap.active = true
    where au.id = auth.uid()
  ),
  st as (
    select s
    from public.store, jsonb_array_elements(case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) s, u
    where key = 'vift_staff' and lower(s->>'email') = u.email
      and coalesce(s->>'active', 'false') not in ('false', '0', '')
    limit 1
  ),
  ro as (
    select r
    from public.store, jsonb_array_elements(case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) r, st
    where key = 'vift_roles' and r->>'id' = st.s->>'role'
    limit 1
  )
  select coalesce(
    (select array(select jsonb_array_elements_text(case when jsonb_typeof(r->'permissions') = 'array' and coalesce(r->>'active', 'true') not in ('false', '0')
                                                        then r->'permissions' else '[]'::jsonb end)) from ro),
    '{}'::text[])
$function$;

create or replace function public._vift_auth_staff(p_auth uuid)
returns jsonb language sql stable set search_path = public as $$
  with u as (
    select lower(au.email) as email from auth.users au
    join public.app_users ap on ap.user_id = au.id and ap.active = true
    where au.id = p_auth
  ), st as (
    select s from public.store, jsonb_array_elements(case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) s, u
    where key = 'vift_staff' and lower(s ->> 'email') = u.email and coalesce(s ->> 'active', 'false') not in ('false', '0', '')
    limit 1
  ), ro as (
    select r from public.store, jsonb_array_elements(case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) r, st
    where key = 'vift_roles' and r ->> 'id' = st.s ->> 'role'
    limit 1
  )
  select case when exists (select 1 from st) then jsonb_build_object(
    'staffId', (select s ->> 'id' from st),
    'perms', coalesce((select case when jsonb_typeof(r -> 'permissions') = 'array' and public._vift_t4a_roll_aktiv(r) then r -> 'permissions' else '[]'::jsonb end from ro), '[]'::jsonb))
  else null end
$$;

/* T4-A: cost_view, cost_edit, personal_data_view och bankgiro_edit verkställs nu. */
create or replace function public._vift_ej_verkstallda()
returns text[] language sql immutable set search_path = public as $$
  select array['ao_plan_own','time_view_all','objects_access_assigned','rondering_utfor','export_data','export_personal_data']
$$;

-- ── 3. Hela värdet / direkt REST-läsning ─────────────────────────────

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

-- ── 4. Projektion: skyddade fält även för skrivare, urval per post ──

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

-- ── 5. Skrivvägarna: fältvis sammanslagning under radlås ─────────────

drop function public.store_business_key_write(text, jsonb, text, boolean, text);

CREATE FUNCTION public.store_business_key_write(p_key text, p_new_value jsonb, p_expected_hash text, p_caller_authorized boolean, p_actor_id text, p_klient jsonb DEFAULT NULL::jsonb)
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

drop function public.store_business_key_merge_write(text, jsonb, jsonb, boolean, text);

CREATE FUNCTION public.store_business_key_merge_write(p_key text, p_upserts jsonb, p_removals jsonb, p_caller_authorized boolean, p_actor_id text, p_klient jsonb DEFAULT NULL::jsonb)
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

-- ── 6. work_order_patch (samma signatur): fältvis kontroll under radlåset ──

create or replace function public.work_order_patch(
  p_ao_id text, p_patch jsonb, p_idempotency_key text, p_expected_updated_at text,
  p_caller_staff_id text, p_caller_perms text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_workorders jsonb; v_idx int; v_ao jsonb; v_updated jsonb; v_existing jsonb;
  v_now timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_fp text; v_result jsonb; v_eff text[]; v_me text := coalesce(p_caller_staff_id, '');
  v_patch jsonb; v_keys text[]; v_ignored text[] := '{}'; v_status text; v_new_log jsonb; v_added jsonb;
  v_can_edit boolean; v_t4a jsonb;
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
    if public._vift_ao_billing_touched(v_ao, v_patch) then
      raise exception 'forbidden:invoice_path_required';
    end if;
    -- T4-A (B5, B1, SÄK-7): skyddade fält prövas på den låsta raden, efter behörighetskontrollen.
    -- Saknad portkod bevaras (v_ao || patch); saknat inköpspris i en befintlig materialrad återställs.
    v_t4a := public._vift_t4a_ao_patch(v_ao, v_patch, coalesce(p_caller_perms, '{}'));
    v_patch := v_t4a -> 'patch';
    select coalesce(array_agg(x), '{}') into v_ignored from jsonb_array_elements_text(v_t4a -> 'ignored') x;
    v_updated := v_ao || v_patch;
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
    if not public._vift_has(v_eff, 'ao_material') then raise exception 'forbidden'; end if;
    if not (public._vift_ao_assigned(v_ao, v_me) or public._vift_has(v_eff, 'ao_view_all')) then raise exception 'forbidden:not_assigned'; end if;
    if public._vift_ao_locked(v_ao) then raise exception 'ao_locked'; end if;
    if jsonb_typeof(v_patch -> 'materials') <> 'array' or jsonb_array_length(v_patch -> 'materials') > 500 then raise exception 'missing_fields'; end if;
    -- T4-A: fältet läser raderna utan inköpspris; det återställs innan raderna jämförs (D-19 delvis).
    v_t4a := public._vift_t4a_ao_patch(v_ao, v_patch, coalesce(p_caller_perms, '{}'));
    v_patch := v_t4a -> 'patch';
    select coalesce(array_agg(x), '{}') into v_ignored from jsonb_array_elements_text(v_t4a -> 'ignored') x;
    v_updated := v_ao || jsonb_build_object('materials', public._vift_ao_material_merge(v_ao -> 'materials', v_patch -> 'materials', v_me, v_now_text));

  elsif v_status = 'pågående' and v_keys <@ array['status'] then
    if not public._vift_has(v_eff, 'ao_start_own') then raise exception 'forbidden'; end if;
    if not public._vift_ao_assigned(v_ao, v_me) then raise exception 'forbidden:not_assigned'; end if;
    if public._vift_ao_locked(v_ao) then raise exception 'ao_locked'; end if;
    if coalesce(v_ao ->> 'status', '') not in ('nytt', 'planerad', 'pool') then raise exception 'invalid_source_status'; end if;
    v_updated := v_ao || jsonb_build_object('status', 'pågående', 'startedAt', coalesce(nullif(v_ao ->> 'startedAt', ''), v_now_text),
                                            'startedBy', coalesce(nullif(v_ao ->> 'startedBy', ''), v_me));

  elsif v_status = 'klar' and v_keys <@ array['status', 'completedAt', 'completedBy'] then
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

-- ── Rättigheter: bara service_role (Edge Functions). vift_store_full_access och vift_caller_perms
--    behåller EXECUTE för authenticated (RLS-hjälparna i store_read_by_role). ────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._vift_t4a_roll_aktiv(jsonb)', 'public._vift_t4a_giltig(text[])', 'public._vift_t4a_legacy(text[])',
    'public._vift_t4a_kontakt(text[])', 'public._vift_t4a_logg_full(text[])', 'public._vift_t4a_privat(jsonb)',
    'public._vift_t4a_tom(jsonb)', 'public._vift_t4a_falt(text)', 'public._vift_t4a_kan_lasa(text,text,jsonb,text[])',
    'public._vift_t4a_kan_skriva(text,text,jsonb,text[])', 'public._vift_t4a_alla_lasbara(text,text[])',
    'public._vift_t4a_projicera_elem(text,jsonb,text[])', 'public._vift_t4a_sammanfoga(text,jsonb,jsonb,text[])',
    'public._vift_t4a_sammanfoga_lista(text,jsonb,jsonb,text[])', 'public._vift_t4a_aktor_perms(text)',
    'public._vift_t4a_roller_bevara(jsonb,jsonb,jsonb)', 'public._vift_t4a_ao_patch(jsonb,jsonb,text[])',
    'public._vift_t4a_ao_ref(text[],text,text)',
    'public._vift_role_perms(jsonb,text)', 'public._vift_auth_staff(uuid)', 'public._vift_ej_verkstallda()',
    'public.vift_store_project(text,jsonb,text[],text)',
    'public.store_business_key_write(text,jsonb,text,boolean,text,jsonb)',
    'public.store_business_key_merge_write(text,jsonb,jsonb,boolean,text,jsonb)',
    'public.work_order_patch(text,jsonb,text,text,text,text[])']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  revoke all on function public.vift_store_full_access(text, text[]) from public, anon;
  grant execute on function public.vift_store_full_access(text, text[]) to authenticated, service_role;
  revoke all on function public.vift_caller_perms() from public, anon;
  grant execute on function public.vift_caller_perms() to authenticated, service_role;
end $$;

commit;
