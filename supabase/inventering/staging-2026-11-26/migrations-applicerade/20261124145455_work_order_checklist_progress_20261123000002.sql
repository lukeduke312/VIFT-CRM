create or replace function public.work_order_checklist_set_state(
  p_ao_id                text,
  p_item_id              text,
  p_action               text,
  p_text                 text,
  p_description          text,
  p_comment              text,
  p_image                text,
  p_actor_name           text,
  p_caller_staff_id      text,
  p_caller_can_view_all  boolean,
  p_caller_can_edit      boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workorders  jsonb;
  v_ao_idx      int;
  v_ao          jsonb;
  v_checklist   jsonb;
  v_item_idx    int;
  v_item        jsonb;
  v_new_item    jsonb;
  v_state       text;
  v_owner       text;
  v_is_own      boolean;
  v_history     jsonb;
  v_noop        boolean := false;
  v_updated_ao  jsonb;
  v_now         timestamptz := clock_timestamp();
  v_now_text    text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_actor       text := coalesce(nullif(trim(p_actor_name), ''), 'Okänd användare');
  v_entry       jsonb;
begin
  if p_action is null or p_action not in ('start', 'done', 'avvikelse', 'reset', 'add', 'remove') then
    raise exception 'invalid_action';
  end if;
  if coalesce(p_item_id, '') = '' then
    raise exception 'missing_fields';
  end if;
  if p_action = 'avvikelse' and coalesce(trim(p_comment), '') = '' then
    raise exception 'comment_required';
  end if;
  if p_action = 'add' and coalesce(trim(p_text), '') = '' then
    raise exception 'text_required';
  end if;

  select value into v_workorders from public.store where key = 'vift_workOrders' for update;
  if v_workorders is null or jsonb_typeof(v_workorders) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1) into v_ao_idx
    from jsonb_array_elements(v_workorders) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_ao_id
    limit 1;
  if v_ao_idx is null then
    raise exception 'not_found';
  end if;
  v_ao := v_workorders -> v_ao_idx;

  if not p_caller_can_view_all then
    if not (coalesce(v_ao -> 'staff', '[]'::jsonb) ? p_caller_staff_id) and (v_ao ->> 'status') <> 'pool' then
      raise exception 'forbidden';
    end if;
  end if;

  v_checklist := coalesce(v_ao -> 'checklist', '[]'::jsonb);
  select (ord - 1) into v_item_idx
    from jsonb_array_elements(v_checklist) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_item_id
    limit 1;

  v_entry := jsonb_build_object('a', p_action, 'by', v_actor, 'byId', coalesce(p_caller_staff_id, ''), 'at', v_now_text);

  if p_action = 'add' then
    if v_item_idx is not null then
      if (v_checklist -> v_item_idx ->> 'text') = trim(p_text) then
        v_noop := true;
      else
        raise exception 'id_collision';
      end if;
    else
      v_checklist := v_checklist || jsonb_build_array(jsonb_build_object(
        'id', p_item_id,
        'text', left(trim(p_text), 300),
        'description', left(coalesce(trim(p_description), ''), 2000),
        'done', false,
        'avvikelse', null,
        'history', jsonb_build_array(v_entry)
      ));
    end if;
  else
    if v_item_idx is null then
      if p_action = 'remove' then
        v_noop := true;
      else
        raise exception 'item_not_found';
      end if;
    else
      v_item := v_checklist -> v_item_idx;
      v_state := case
        when v_item ->> 'avvikelse' = 'avvikelse' then 'avvikelse'
        when coalesce((v_item ->> 'done')::boolean, false) or v_item ->> 'avvikelse' = 'ok' then 'utford'
        when coalesce(v_item ->> 'startedAt', '') <> '' then 'pagaende'
        else 'ej_paborjad'
      end;
      v_owner := case v_state
        when 'avvikelse' then v_item ->> 'avvikelseById'
        when 'utford'    then v_item ->> 'doneById'
        when 'pagaende'  then v_item ->> 'startedById'
        else null
      end;
      v_is_own := coalesce(v_owner, '') <> '' and v_owner = coalesce(p_caller_staff_id, '');

      if not p_caller_can_edit and not v_is_own and (
           (p_action in ('reset', 'remove') and v_state <> 'ej_paborjad')
        or (p_action in ('done', 'avvikelse') and v_state in ('utford', 'avvikelse'))
      ) then
        raise exception 'forbidden_other';
      end if;

      if p_action = 'remove' then
        v_checklist := v_checklist - v_item_idx;
      else
        v_entry := v_entry || jsonb_build_object('from', v_state);
        v_new_item := v_item;

        if p_action = 'start' then
          if v_state in ('utford', 'avvikelse') then
            raise exception 'already_resolved';
          elsif v_state = 'pagaende' then
            v_noop := true;
          else
            v_new_item := v_new_item || jsonb_build_object(
              'startedAt', v_now_text, 'startedBy', v_actor, 'startedById', coalesce(p_caller_staff_id, ''));
          end if;

        elsif p_action = 'done' then
          if v_state = 'utford' then
            v_noop := true;
          else
            v_new_item := v_new_item || jsonb_build_object(
              'avvikelse', 'ok', 'done', true,
              'avvikelseComment', '', 'avvikelseAt', '', 'avvikelseBy', '', 'avvikelseById', '',
              'doneAt', v_now_text, 'doneBy', v_actor, 'doneById', coalesce(p_caller_staff_id, ''));
          end if;

        elsif p_action = 'avvikelse' then
          v_new_item := v_new_item || jsonb_build_object(
            'avvikelse', 'avvikelse', 'done', false,
            'avvikelseComment', left(trim(p_comment), 2000),
            'avvikelseAt', v_now_text, 'avvikelseBy', v_actor, 'avvikelseById', coalesce(p_caller_staff_id, ''),
            'doneAt', '', 'doneBy', '', 'doneById', '');
          if p_image is not null and p_image <> '' then
            v_new_item := v_new_item || jsonb_build_object('avvikelseImage', p_image);
          end if;

        elsif p_action = 'reset' then
          if v_state = 'ej_paborjad' then
            v_noop := true;
          else
            v_new_item := v_new_item || jsonb_build_object(
              'done', false, 'avvikelse', null,
              'avvikelseComment', '', 'avvikelseAt', '', 'avvikelseBy', '', 'avvikelseById', '',
              'startedAt', '', 'startedBy', '', 'startedById', '',
              'doneAt', '', 'doneBy', '', 'doneById', '');
          end if;
        end if;

        if not v_noop then
          v_history := coalesce(v_new_item -> 'history', '[]'::jsonb) || jsonb_build_array(v_entry);
          while jsonb_array_length(v_history) > 20 loop
            v_history := v_history - 0;
          end loop;
          v_new_item := v_new_item || jsonb_build_object('history', v_history);
          v_checklist := jsonb_set(v_checklist, array[v_item_idx::text], v_new_item);
        end if;
      end if;
    end if;
  end if;

  if v_noop then
    return jsonb_build_object('workOrder', v_ao, 'noop', true, 'serverSignature', v_now_text);
  end if;

  v_updated_ao := v_ao || jsonb_build_object('checklist', v_checklist, 'updatedAt', v_now_text);
  v_workorders := jsonb_set(v_workorders, array[v_ao_idx::text], v_updated_ao);
  update public.store set value = v_workorders, updated_at = v_now where key = 'vift_workOrders';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('workOrder', v_updated_ao, 'noop', false, 'serverSignature', v_now_text);
end;
$$;

revoke all on function public.work_order_checklist_set_state(text, text, text, text, text, text, text, text, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.work_order_checklist_set_state(text, text, text, text, text, text, text, text, text, boolean, boolean)
  to service_role;

create or replace function public.work_order_checklist_resolve(
  p_ao_id                text,
  p_item_id               text,
  p_avvikelse             text,
  p_avvikelse_comment     text,
  p_actor_name            text,
  p_caller_can_view_all   boolean,
  p_caller_staff_id       text,
  p_avvikelse_image       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_avvikelse is not null and p_avvikelse not in ('ok', 'avvikelse') then
    raise exception 'invalid_avvikelse';
  end if;
  return public.work_order_checklist_set_state(
    p_ao_id, p_item_id,
    case p_avvikelse when 'ok' then 'done' when 'avvikelse' then 'avvikelse' else 'reset' end,
    null, null, p_avvikelse_comment, p_avvikelse_image,
    p_actor_name, p_caller_staff_id, p_caller_can_view_all, false
  );
end;
$$;

revoke all on function public.work_order_checklist_resolve(text, text, text, text, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.work_order_checklist_resolve(text, text, text, text, text, boolean, text, text)
  to service_role;