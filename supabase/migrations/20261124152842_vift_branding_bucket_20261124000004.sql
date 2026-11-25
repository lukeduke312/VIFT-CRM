-- ============================================================
-- ÅTERSTÄLLD 2026-11-27 ur STAGING:s migrationshistorik (G1/G4 del 2).
-- Källa: supabase_migrations.schema_migrations, version 20261124152842, i STAGING
-- (yyzljlqyzzcbxmcdbual). Allt efter markören INNEHÅLL nedan, fram till
-- den avslutande raden ";", är EXAKT array_to_string(statements, E';\n')
-- (md5 ace9484676bf9384a92ef25fdcede786, samma fil som
-- inventering/staging-2026-11-26/migrations-applicerade/20261124152842_vift_branding_bucket_20261124000004.sql).
-- Supabase CLI sparar statements utan avslutande semikolon; ett ";" har
-- därför lagts till sist. Ingen annan ändring.
-- ============================================================
-- INNEHÅLL
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vift-branding', 'vift-branding', false, 524288, array['image/png'])
on conflict (id) do nothing;
drop policy if exists "vift_branding_service_select" on storage.objects;
drop policy if exists "vift_branding_service_insert" on storage.objects;
drop policy if exists "vift_branding_service_update" on storage.objects;
create policy "vift_branding_service_select" on storage.objects for select to service_role using (bucket_id = 'vift-branding');
create policy "vift_branding_service_insert" on storage.objects for insert to service_role with check (bucket_id = 'vift-branding');
create policy "vift_branding_service_update" on storage.objects for update to service_role using (bucket_id = 'vift-branding');
;
