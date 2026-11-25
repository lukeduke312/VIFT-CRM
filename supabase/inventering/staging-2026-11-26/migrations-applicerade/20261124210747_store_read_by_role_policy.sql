drop policy if exists store_read_by_role on public.store;
create policy store_read_by_role on public.store
  as restrictive
  for select
  to authenticated
  using (public.vift_store_full_access(key, (select public.vift_caller_perms())));