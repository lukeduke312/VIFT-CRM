-- =====================================================================
-- VIFT CRM — T3-E standardroller (M9, D-02): A. Läsande kontroll och plan (ändrar ingenting)
-- Genererad av vift-v2 tests/local/t3e-skript.js ur standardroller.json (t4b-2026-11-28). Ändra inte för hand.
-- Körs i Supabase SQL Editor för STAGING (yyzljlqyzzcbxmcdbual) FÖRST efter separat GO.
-- ALDRIG mot LIVE utan en egen LIVE-plan. Ingår INTE i migrationskedjan (inte db push).
-- Kör hela filen. Spara resultatet (hash, plan, antal per roll-id). Hashen från A2 fylls i B eller D.
-- Inga personuppgifter visas: bara roll-id, behörigheter och antal.
-- =====================================================================

-- A1. Rätt projekt? (STAGING)
select current_database() as databas, now() as tid;

-- A2. Rollregistrets hash (samma hash som store-key-write readWithHash) och antal roller.
select encode(sha256(convert_to(value::text, 'UTF8')), 'hex') as forvantad_hash, jsonb_array_length(value) as antal_roller, updated_at
  from public.store where key = 'vift_roles';

-- A3. Rollregistret: id och behörigheter (sorterade).
select e->>'id' as roll_id, coalesce(e->>'active', 'true') as aktiv,
       (select string_agg(p, ', ' order by p) from jsonb_array_elements_text(case when jsonb_typeof(e->'permissions') = 'array' then e->'permissions' else '[]'::jsonb end) p) as behorigheter
  from public.store, jsonb_array_elements(value) e where key = 'vift_roles' order by 1;

-- A4. Plan per standardroll: LAGGS_TILL, IDENTISK (hoppas över) eller KROCK (B stoppar).
with def as (select x as r from jsonb_array_elements('[
  {"id":"admin","label":"Admin","isBuiltin":true,"active":true,"description":"Superadministratör: alla behörigheter.","permissions":["all"]},
  {"id":"chef","label":"Arbetsledare","isBuiltin":true,"active":true,"description":"Arbetsledare: arbetsorder, planering, kunder, offerter, fakturaunderlag, intern ekonomi, rapporter och personalens arbetstid (utan lön och personnummer).","permissions":["dashboard_view","ao_view_all","ao_view_own","ao_pool_take","ao_start_own","ao_complete_own","ao_plan_own","ao_create","ao_edit","ao_complete","ao_time","ao_material","ao_checklist","rondering_utfor","objects_sensitive","customer_manage","offer_manage","sales_manage","recurring_manage","invoice_view","invoice_create","reports_view","cost_view","cost_edit","time_view_all","staff_view","staff_contacts_view","activity_log_view_all","export_data"]},
  {"id":"ekonomi","label":"Ekonomi","isBuiltin":true,"active":true,"description":"Ekonomi: fakturaunderlag, rapporter, löneunderlag och attest, intern ekonomi och personnummer för ROT/RUT.","permissions":["dashboard_view","ao_view_all","customer_view","personal_data_view","invoice_view","invoice_create","reports_view","cost_view","cost_edit","payroll_view","payroll_manage","staff_contacts_view","activity_log_view_all","export_data"]},
  {"id":"personal","label":"Personal","isBuiltin":true,"active":true,"description":"Fältpersonal: egna tilldelade arbetsorder, öppen pool, start och klarmarkering av egna, tid, material och checklista.","permissions":["dashboard_view","ao_view_own","ao_pool_take","ao_start_own","ao_complete_own","ao_plan_own","ao_time","ao_material","ao_checklist","rondering_utfor","objects_access_assigned","staff_contacts_view"]},
  {"id":"begransad","label":"Begränsad","isBuiltin":true,"active":true,"description":"Begränsad/extern: bara egna tilldelade arbetsorder, ingen öppen pool och inga ekonomiska uppgifter. Tid, checklista, start, klarmarkering, rondering och åtkomstinformation kan läggas till separat (D-04).","permissions":["dashboard_view","ao_view_own"]}
]'::jsonb) x),
     reg as (select e from public.store, jsonb_array_elements(value) e where key = 'vift_roles')
select d.r->>'id' as standardroll,
       case when not exists (select 1 from reg where reg.e->>'id' = d.r->>'id') then 'LAGGS_TILL'
            when (select count(*) from reg where reg.e->>'id' = d.r->>'id') > 1 then 'KROCK (dubbla id)'
            when (select array_agg(distinct p order by p) from reg, jsonb_array_elements_text(case when jsonb_typeof(reg.e->'permissions') = 'array' then reg.e->'permissions' else '[]'::jsonb end) p where reg.e->>'id' = d.r->>'id')
                 is not distinct from (select array_agg(distinct p order by p) from jsonb_array_elements_text(d.r->'permissions') p) then 'IDENTISK'
            else 'KROCK (andra behörigheter)' end as plan
  from def d order by 1;

-- A5. Personal per roll-id (bara antal). Aktiv personal med ett roll-id som ska LAGGS_TILL stoppar B.
select coalesce(s->>'role', '(saknas)') as roll_id,
       count(*) filter (where coalesce(s->>'active', 'true') <> 'false') as aktiva,
       count(*) filter (where coalesce(s->>'active', 'true') = 'false') as inaktiva
  from public.store, jsonb_array_elements(case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) s
 where key = 'vift_staff' group by 1 order by 1;

-- A6. Roller som i dag får ao_start_own/ao_complete_own/ao_pool_take genom övergångsregeln
--     (§4.6: ao_complete utan ao_view_all/ao_edit och utan någon av de nya). Kandidater för D.
select e->>'id' as roll_id,
       (select count(*) from public.store st, jsonb_array_elements(st.value) s where st.key = 'vift_staff' and s->>'role' = e->>'id' and coalesce(s->>'active', 'true') <> 'false') as aktiva_anvandare
  from public.store, jsonb_array_elements(value) e
 where key = 'vift_roles' and jsonb_typeof(e->'permissions') = 'array'
   and e->'permissions' ? 'ao_complete' and not (e->'permissions' ?| array['ao_view_all', 'ao_edit', 'all'])
   and not (e->'permissions' ?| array['ao_start_own', 'ao_complete_own', 'ao_pool_take'])
 order by 1;

-- A7. Journal (finns efter första körningen av B eller D; före det ger frågan ingen rad).
select query_to_xml('select id, steg, utford_at, fore_hash, efter_hash, tillagda_roller, identiska_roller, tillagda_behorigheter
                       from vift_t3e_journal.rollregister order by id', true, false, '') as journal
 where to_regclass('vift_t3e_journal.rollregister') is not null;
