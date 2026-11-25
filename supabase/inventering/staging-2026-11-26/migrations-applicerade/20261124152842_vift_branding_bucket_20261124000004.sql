insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vift-branding', 'vift-branding', false, 524288, array['image/png'])
on conflict (id) do nothing;
drop policy if exists "vift_branding_service_select" on storage.objects;
drop policy if exists "vift_branding_service_insert" on storage.objects;
drop policy if exists "vift_branding_service_update" on storage.objects;
create policy "vift_branding_service_select" on storage.objects for select to service_role using (bucket_id = 'vift-branding');
create policy "vift_branding_service_insert" on storage.objects for insert to service_role with check (bucket_id = 'vift-branding');
create policy "vift_branding_service_update" on storage.objects for update to service_role using (bucket_id = 'vift-branding');