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