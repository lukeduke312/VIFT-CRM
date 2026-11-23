-- =====================================================================
-- VIFT CRM — Privat bucket för arbetsorderbilder (2026-11-24)
-- FÖRBEREDD I REPOT — EJ KÖRD. Kräver separat GO (installationsplan §2b).
-- Samma SQL som tidigare stod i WorkOrderImageService.js filhuvud, nu som
-- migrationsfil. Idempotent. Därefter deployas work-order-image-upload,
-- work-order-image-url och work-order-image-delete.
-- Ingen policy ger rollen authenticated åtkomst: bara service_role (de tre
-- EF:erna, som kontrollerar behörighet och AO-synlighet) når bucketen.
-- Rollback: drop policy … ×3; delete from storage.buckets where id =
--   'workorder-images' (endast om bucketen är tom).
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workorder-images', 'workorder-images', false, 10485760,
        array['image/jpeg','image/jpg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "wo_images_storage_select" on storage.objects;
drop policy if exists "wo_images_storage_insert" on storage.objects;
drop policy if exists "wo_images_storage_delete" on storage.objects;

create policy "wo_images_storage_select" on storage.objects for select to service_role
  using (bucket_id = 'workorder-images');
create policy "wo_images_storage_insert" on storage.objects for insert to service_role
  with check (bucket_id = 'workorder-images');
create policy "wo_images_storage_delete" on storage.objects for delete to service_role
  using (bucket_id = 'workorder-images');
