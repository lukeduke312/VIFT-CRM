INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('project-documents','project-documents',false,52428800,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS "project-documents service_role insert" ON storage.objects;
DROP POLICY IF EXISTS "project-documents service_role select" ON storage.objects;
DROP POLICY IF EXISTS "project-documents service_role delete" ON storage.objects;
CREATE POLICY "project-documents service_role insert" ON storage.objects FOR INSERT TO service_role WITH CHECK (bucket_id = 'project-documents');
CREATE POLICY "project-documents service_role select" ON storage.objects FOR SELECT TO service_role USING (bucket_id = 'project-documents');
CREATE POLICY "project-documents service_role delete" ON storage.objects FOR DELETE TO service_role USING (bucket_id = 'project-documents');

create or replace function public.project_documents_append(p_new_doc jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_arr jsonb; v_now_sig text;
begin
  insert into public.store(key, value) values ('vift_projectDocuments', '[]'::jsonb) on conflict (key) do nothing;
  select value into v_arr from public.store where key = 'vift_projectDocuments' for update;
  if v_arr is null or jsonb_typeof(v_arr) <> 'array' then v_arr := '[]'::jsonb; end if;
  v_arr := v_arr || jsonb_build_array(p_new_doc);
  update public.store set value = v_arr, updated_at = now() where key = 'vift_projectDocuments';
  v_now_sig := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_sig))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return p_new_doc;
end;
$$;

create or replace function public.project_documents_update_one(p_doc_id text, p_expected_project_id text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_arr jsonb; v_idx int; v_doc jsonb; v_updated jsonb; v_now_sig text;
begin
  select value into v_arr from public.store where key = 'vift_projectDocuments' for update;
  if v_arr is null then raise exception 'not_found'; end if;
  select (ord - 1) into v_idx from jsonb_array_elements(v_arr) with ordinality as t(elem, ord) where elem ->> 'id' = p_doc_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_doc := v_arr -> v_idx;
  if (v_doc ->> 'projectId') is distinct from p_expected_project_id then raise exception 'forbidden'; end if;
  v_updated := (v_doc || p_patch) || jsonb_build_object('updatedAt', to_jsonb(now()::text));
  v_arr := jsonb_set(v_arr, array[v_idx::text], v_updated);
  update public.store set value = v_arr, updated_at = now() where key = 'vift_projectDocuments';
  v_now_sig := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_sig))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_updated;
end;
$$;

create or replace function public.project_documents_finalize_delete(p_doc_id text, p_expected_project_id text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_arr jsonb; v_idx int; v_doc jsonb; v_updated jsonb; v_now_sig text;
begin
  select value into v_arr from public.store where key = 'vift_projectDocuments' for update;
  if v_arr is null then raise exception 'not_found'; end if;
  select (ord - 1) into v_idx from jsonb_array_elements(v_arr) with ordinality as t(elem, ord) where elem ->> 'id' = p_doc_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_doc := v_arr -> v_idx;
  if (v_doc ->> 'projectId') is distinct from p_expected_project_id then raise exception 'forbidden'; end if;
  v_updated := v_doc || jsonb_build_object('active', false, 'deletedAt', to_jsonb(now()::text));
  v_arr := jsonb_set(v_arr, array[v_idx::text], v_updated);
  update public.store set value = v_arr, updated_at = now() where key = 'vift_projectDocuments';
  v_now_sig := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_sig))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_updated;
end;
$$;

revoke all on function public.project_documents_append(jsonb) from public, anon, authenticated;
revoke all on function public.project_documents_update_one(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.project_documents_finalize_delete(text, text) from public, anon, authenticated;
grant execute on function public.project_documents_append(jsonb) to service_role;
grant execute on function public.project_documents_update_one(text, text, jsonb) to service_role;
grant execute on function public.project_documents_finalize_delete(text, text) to service_role;

drop policy if exists "store_project_documents_no_direct_insert" on public.store;
create policy "store_project_documents_no_direct_insert" on public.store as restrictive for insert to authenticated
  with check (key <> 'vift_projectDocuments');
drop policy if exists "store_project_documents_no_direct_update" on public.store;
create policy "store_project_documents_no_direct_update" on public.store as restrictive for update to authenticated
  using (key <> 'vift_projectDocuments') with check (key <> 'vift_projectDocuments');
drop policy if exists "store_project_documents_no_direct_delete" on public.store;
create policy "store_project_documents_no_direct_delete" on public.store as restrictive for delete to authenticated
  using (key <> 'vift_projectDocuments');