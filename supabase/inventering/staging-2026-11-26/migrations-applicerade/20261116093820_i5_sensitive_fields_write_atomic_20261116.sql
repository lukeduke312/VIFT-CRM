-- I5 hardening 2026-11-12: ONE transaction for a sensitive-field write AND its mandatory audit row.
-- Before: set-sensitive-fields wrote property_sensitive_access and sensitive_access_audit as two
-- separate PostgREST requests (two transactions), so a failed audit insert could leave a saved
-- door code with no audit row. Now both happen in this function: either both commit or neither.
-- New function only. No table, column, RLS or policy change. STAGING only. Run as postgres.
begin;

-- Fail-closed pre-check: the two tables and every column used below must exist.
do $$
declare v_missing text;
begin
  select string_agg(t || '.' || c, ', ') into v_missing
  from (values
    ('property_sensitive_access','id'), ('property_sensitive_access','object_id'),
    ('property_sensitive_access','property_id'), ('property_sensitive_access','door_code'),
    ('property_sensitive_access','key_information'), ('property_sensitive_access','key_receipt'),
    ('property_sensitive_access','alarm_information'), ('property_sensitive_access','access_information'),
    ('property_sensitive_access','access_code'), ('property_sensitive_access','updated_at'),
    ('property_sensitive_access','updated_by'),
    ('sensitive_access_audit','id'), ('sensitive_access_audit','user_id'), ('sensitive_access_audit','user_email'),
    ('sensitive_access_audit','action'), ('sensitive_access_audit','object_id'),
    ('sensitive_access_audit','property_id'), ('sensitive_access_audit','fields'),
    ('sensitive_access_audit','status'), ('sensitive_access_audit','detail')) as w(t, c)
  where not exists (select 1 from information_schema.columns ic
                    where ic.table_schema = 'public' and ic.table_name = w.t and ic.column_name = w.c);
  if v_missing is not null then
    raise exception 'I5 STOP: missing column(s): %', v_missing;
  end if;
end $$;

create function public.sensitive_fields_write(
  p_object_id   text,
  p_property_id text,
  p_fields      jsonb,
  p_user_id     uuid,
  p_user_email  text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_keys  constant text[] := array['doorCode','keyInformation','keyReceipt','alarmInformation','accessInformation','accessCode'];
  v_obj   text := nullif(p_object_id, '');
  v_prop  text := nullif(p_property_id, '');
  v_bad   text[];
  v_names text[];
  v_n     int;
  v_id    uuid;
  v_op    text;
  v_audit uuid;
begin
  if v_obj is null and v_prop is null then
    raise exception 'sensitive_fields_write: objectId or propertyId required' using errcode = '22023';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'sensitive_fields_write: p_fields must be a JSON object' using errcode = '22023';
  end if;
  if p_user_id is null or nullif(p_user_email, '') is null then
    raise exception 'sensitive_fields_write: caller identity required for the audit row' using errcode = '22023';
  end if;
  select array_agg(k) into v_bad from jsonb_object_keys(p_fields) k where k <> all (c_keys);
  if v_bad is not null then
    raise exception 'sensitive_fields_write: unknown field(s) %', v_bad using errcode = '22023';
  end if;
  -- Field NAMES only, in a fixed order. Values never reach the audit table.
  select coalesce(array_agg(k order by array_position(c_keys, k)), '{}') into v_names
    from jsonb_object_keys(p_fields) k;

  -- Serialise writers of the same target (same lookup as the EF had: object row, else property row).
  perform pg_advisory_xact_lock(hashtextextended(
    'vift.psa:' || case when v_obj is not null then 'o:' || v_obj else 'p:' || v_prop end, 0));

  if v_obj is not null then
    select count(*) into v_n from property_sensitive_access where object_id = v_obj;
  else
    select count(*) into v_n from property_sensitive_access where property_id = v_prop and object_id is null;
  end if;
  if v_n > 1 then  -- the old EF's maybeSingle() also refused this case
    raise exception 'sensitive_fields_write: % rows for one target, expected 0 or 1', v_n;
  end if;

  if v_n = 1 then
    if v_obj is not null then
      select id into v_id from property_sensitive_access where object_id = v_obj for update;
    else
      select id into v_id from property_sensitive_access where property_id = v_prop and object_id is null for update;
    end if;
    update property_sensitive_access set
      property_id        = coalesce(v_prop, property_id),
      door_code          = case when p_fields ? 'doorCode'          then nullif(p_fields ->> 'doorCode', '')          else door_code end,
      key_information    = case when p_fields ? 'keyInformation'    then nullif(p_fields ->> 'keyInformation', '')    else key_information end,
      key_receipt        = case when p_fields ? 'keyReceipt'        then nullif(p_fields ->> 'keyReceipt', '')        else key_receipt end,
      alarm_information  = case when p_fields ? 'alarmInformation'  then nullif(p_fields ->> 'alarmInformation', '')  else alarm_information end,
      access_information = case when p_fields ? 'accessInformation' then nullif(p_fields ->> 'accessInformation', '') else access_information end,
      access_code        = case when p_fields ? 'accessCode'        then nullif(p_fields ->> 'accessCode', '')        else access_code end,
      updated_at         = now(),
      updated_by         = p_user_email
    where id = v_id;
    v_op := 'update';
  else
    insert into property_sensitive_access
      (object_id, property_id, door_code, key_information, key_receipt, alarm_information,
       access_information, access_code, updated_at, updated_by)
    values
      (v_obj, v_prop,
       nullif(p_fields ->> 'doorCode', ''), nullif(p_fields ->> 'keyInformation', ''),
       nullif(p_fields ->> 'keyReceipt', ''), nullif(p_fields ->> 'alarmInformation', ''),
       nullif(p_fields ->> 'accessInformation', ''), nullif(p_fields ->> 'accessCode', ''),
       now(), p_user_email)
    returning id into v_id;
    v_op := 'insert';
  end if;

  -- Mandatory audit row, same transaction. If this insert fails, the exception aborts the whole
  -- call and the data change above is rolled back with it.
  insert into sensitive_access_audit (user_id, user_email, action, object_id, property_id, fields, status, detail)
  values (p_user_id, p_user_email, 'write', v_obj, v_prop, v_names, 'allowed', v_op)
  returning id into v_audit;
  if v_audit is null then
    raise exception 'sensitive_fields_write: audit row not created';
  end if;

  return jsonb_build_object('ok', true, 'op', v_op, 'audit_id', v_audit);
end;
$$;

alter function public.sensitive_fields_write(text, text, jsonb, uuid, text) owner to postgres;
revoke all on function public.sensitive_fields_write(text, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.sensitive_fields_write(text, text, jsonb, uuid, text) to service_role;

notify pgrst, 'reload schema';
commit;
