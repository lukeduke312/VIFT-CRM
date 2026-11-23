-- =====================================================================
-- VIFT CRM — STAGING: backup och kontroll före installation (2026-11-24)
-- Körs i Supabase SQL Editor för projektet STAGING (yyzljlqyzzcbxmcdbual).
-- ALDRIG mot LIVE. Del A är bara läsning. Del B skapar ett backupschema
-- och kräver GO. Del C är bara läsning (efterkontroll av backupen).
-- =====================================================================

-- ── Del A: läsande kontroll (ingen ändring) ──────────────────────────
-- A1. Rätt projekt? Ska visa STAGING-data (t.ex. staging-banner/testkonton).
select current_database(), now();
-- A2. Vilka av de berörda funktionerna finns redan?
select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p where p.pronamespace = 'public'::regnamespace
   and p.proname in ('work_order_checklist_resolve','work_order_checklist_set_state','activity_log_append',
                     'work_order_log_append','work_order_log_remove','store_business_key_merge_write',
                     'store_business_key_write','project_documents_append','work_order_create','work_order_patch')
 order by 1;
-- A3. Finns bucketen för AO-bilder / projektdokument?
select id, public, file_size_limit from storage.buckets where id in ('workorder-images','project-documents','offer-attachments');
-- A4. Storlek och tidpunkt för berörda nycklar.
select key, jsonb_typeof(value) as typ,
       case when jsonb_typeof(value) = 'array' then jsonb_array_length(value) end as antal,
       pg_column_size(value) as bytes, updated_at
  from public.store
 where key in ('vift_workOrders','vift_timeEntries','vift_activities','vift_activityLog','vift_staff','vift_roles',
               'vift_customers','vift_offers','vift_settings','vift_lastChanged')
 order by key;
-- A5. Testkonton (efter att de skapats): ska ge 6 rader med "e2e" i e-posten.
select id, email, email_confirmed_at is not null as bekraftad from auth.users where email ilike '%e2e%' order by email;

-- ── Del B: backup i databasen (KRÄVER GO) ────────────────────────────
-- Skapar schemat vift_staging_backup_20261124 med en kopia av store,
-- alla public-funktioners definitioner och (om den finns) op_idempotency.
-- Ändrar inga befintliga data. Rollback: drop schema vift_staging_backup_20261124 cascade;
-- begin;
-- create schema if not exists vift_staging_backup_20261124;
-- revoke all on schema vift_staging_backup_20261124 from public, anon, authenticated;
-- create table vift_staging_backup_20261124.store as select * from public.store;
-- create table vift_staging_backup_20261124.function_definitions as
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as definition
--     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f';
-- do $$ begin
--   if to_regclass('public.op_idempotency') is not null then
--     execute 'create table vift_staging_backup_20261124.op_idempotency as select * from public.op_idempotency';
--   end if;
-- end $$;
-- commit;

-- ── Del C: efterkontroll av backupen (bara läsning) ──────────────────
-- select (select count(*) from public.store) as store_live,
--        (select count(*) from vift_staging_backup_20261124.store) as store_backup,
--        (select count(*) from vift_staging_backup_20261124.function_definitions) as funktioner;
-- select s.key from public.store s join vift_staging_backup_20261124.store b using (key)
--  where s.value is distinct from b.value;   -- ska vara tom direkt efter backupen

-- ── Kopia utanför databasen (rekommenderas) ──────────────────────────
-- Kör: select key, value::text, updated_at from vift_staging_backup_20261124.store;
-- och ladda ner resultatet (CSV/JSON) i SQL Editor. Spara utanför Supabase.
-- Edge Functions som ändras (spara deployade versioner före deploy):
--   supabase functions download store-key-write            --project-ref yyzljlqyzzcbxmcdbual
--   supabase functions download work-order-checklist-resolve --project-ref yyzljlqyzzcbxmcdbual
--   supabase functions download offer-attachment-upload    --project-ref yyzljlqyzzcbxmcdbual
