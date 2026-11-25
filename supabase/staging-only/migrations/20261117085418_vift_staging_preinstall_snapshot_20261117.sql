-- ============================================================
-- ÅTERSTÄLLD 2026-11-27 ur STAGING:s migrationshistorik (G1/G4 del 2).
-- Källa: supabase_migrations.schema_migrations, version 20261117085418, i STAGING
-- (yyzljlqyzzcbxmcdbual). Allt efter markören INNEHÅLL nedan, fram till
-- den avslutande raden ";", är EXAKT array_to_string(statements, E';\n')
-- (md5 99f50d3665b4f086cd7997d98751db2b, samma fil som
-- inventering/staging-2026-11-26/migrations-applicerade/20261117085418_vift_staging_preinstall_snapshot_20261117.sql).
-- Supabase CLI sparar statements utan avslutande semikolon; ett ";" har
-- därför lagts till sist. Ingen annan ändring.
-- ============================================================
-- INNEHÅLL
do $$ begin
 if to_regnamespace('vift_staging_backup_20261117') is not null then
   raise exception 'STOP: backup namespace already exists';
 end if;
end $$;
create schema vift_staging_backup_20261117 authorization postgres;
revoke all on schema vift_staging_backup_20261117 from public, anon, authenticated;
create table vift_staging_backup_20261117.store as
 select key, value, updated_at from public.store;
create table vift_staging_backup_20261117.op_idempotency as
 select fn_name, idem_key, result, created_at from public.op_idempotency;
create table vift_staging_backup_20261117.function_definitions as
 select p.proname, pg_get_function_identity_arguments(p.oid) as args,
 pg_get_functiondef(p.oid) as definition, md5(pg_get_functiondef(p.oid)) as fingerprint
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in
 ('invoice_append_checked','invoice_draft_delete','invoice_set_status','_protect_critical_store_keys');
create table vift_staging_backup_20261117.fingerprints as
 select 'store'::text as item, count(*)::bigint as row_count,
 md5(coalesce(string_agg(key||':'||md5(value::text),'|' order by key),'')) as fingerprint
 from vift_staging_backup_20261117.store
 union all
 select 'op_idempotency',count(*),
 md5(coalesce(string_agg(fn_name||':'||idem_key||':'||md5(result::text),'|' order by fn_name,idem_key),''))
 from vift_staging_backup_20261117.op_idempotency;
revoke all on all tables in schema vift_staging_backup_20261117 from public, anon, authenticated;

;
