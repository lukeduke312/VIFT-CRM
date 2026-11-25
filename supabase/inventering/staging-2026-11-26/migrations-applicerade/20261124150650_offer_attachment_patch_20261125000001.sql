create or replace function public.offer_attachment_patch(p_attachment_id text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_attachments jsonb;
  v_idx         int;
  v_att         jsonb;
  v_set         jsonb := '{}'::jsonb;
  v_name        text;
  v_now         timestamptz := clock_timestamp();
  v_now_text    text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_attachment_id is null or p_attachment_id = '' then
    raise exception 'missing_fields';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_patch';
  end if;

  select value into v_attachments from public.store where key = 'vift_offerAttachments' for update;
  if v_attachments is null or jsonb_typeof(v_attachments) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1)::int into v_idx
    from jsonb_array_elements(v_attachments) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_attachment_id
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;
  v_att := v_attachments -> v_idx;
  if (v_att ->> 'active') = 'false' then
    raise exception 'not_found';
  end if;

  if p_patch ? 'displayName' then
    v_name := left(btrim(coalesce(p_patch ->> 'displayName', '')), 200);
    if v_name = '' then
      v_name := coalesce(v_att ->> 'originalFileName', '');
    end if;
    v_set := v_set || jsonb_build_object('displayName', v_name);
  end if;
  if p_patch ? 'description' then
    v_set := v_set || jsonb_build_object('description', left(btrim(coalesce(p_patch ->> 'description', '')), 1000));
  end if;
  if p_patch ? 'includeInPublicView' then
    v_set := v_set || jsonb_build_object('includeInPublicView', (p_patch -> 'includeInPublicView') = 'true'::jsonb);
  end if;
  if p_patch ? 'includeInCombinedPdf' then
    v_set := v_set || jsonb_build_object('includeInCombinedPdf', (p_patch -> 'includeInCombinedPdf') = 'true'::jsonb);
  end if;

  v_att := v_att || v_set || jsonb_build_object('updatedAt', v_now_text);
  v_attachments := jsonb_set(v_attachments, array[v_idx::text], v_att);
  update public.store set value = v_attachments, updated_at = v_now where key = 'vift_offerAttachments';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('attachment', v_att, 'serverSignature', v_now_text);
end;
$function$;

revoke all on function public.offer_attachment_patch(text, jsonb) from public, anon, authenticated;
grant execute on function public.offer_attachment_patch(text, jsonb) to service_role;