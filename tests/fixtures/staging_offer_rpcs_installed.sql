-- Ordagrann kopia av de INSTALLERADE STAGING-funktionerna (ur
-- vift_staging_backup_20261124.function_definitions), för lokala tester
-- av offer-attachment-upload mot riktig PostgreSQL. Ändra inte för hand:
-- md5 per definition kontrolleras mot STAGING i installationsplanen.

CREATE OR REPLACE FUNCTION public.offer_attachment_append(p_attachment jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_attachments jsonb;
  v_now         timestamptz := clock_timestamp();
  v_now_text    text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  insert into public.store(key, value) values ('vift_offerAttachments', '[]'::jsonb)
    on conflict (key) do nothing;

  select value into v_attachments from public.store where key = 'vift_offerAttachments' for update;
  if v_attachments is null or jsonb_typeof(v_attachments) <> 'array' then
    v_attachments := '[]'::jsonb;
  end if;

  v_attachments := v_attachments || jsonb_build_array(p_attachment);
  -- Samma 5000-tak som den tidigare Deno-sidiga koden (oförändrad gräns).
  if jsonb_array_length(v_attachments) > 5000 then
    select jsonb_agg(elem) into v_attachments
      from (
        select elem, row_number() over () as rn
        from jsonb_array_elements(v_attachments) elem
      ) t
      where rn > (jsonb_array_length(v_attachments) - 5000);
  end if;

  update public.store set value = v_attachments, updated_at = v_now where key = 'vift_offerAttachments';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('attachment', p_attachment, 'serverSignature', v_now_text);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.offer_attachment_soft_delete(p_attachment_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_attachments jsonb;
  v_idx         int;
  v_att         jsonb;
  v_now         timestamptz := clock_timestamp();
  v_now_text    text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
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

  v_att := (v_attachments -> v_idx) || jsonb_build_object('active', false, 'deletedAt', v_now_text);
  v_attachments := jsonb_set(v_attachments, array[v_idx::text], v_att);
  update public.store set value = v_attachments, updated_at = v_now where key = 'vift_offerAttachments';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object('attachment', v_att, 'serverSignature', v_now_text);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.offer_events_append(p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_arr        jsonb;
  v_event_id   text := p_event ->> 'id';
  v_status     text := p_event ->> 'status';
  v_message_id text := p_event ->> 'messageId';
  v_existing   jsonb;
  v_max_keep   constant int := 10000;
  v_len        int;
begin
  if v_event_id is null or v_event_id = '' then
    raise exception 'invalid_event: missing id';
  end if;

  /* Säkerställ att raden existerar INNAN vi låser den — SELECT ... FOR
     UPDATE på en rad som inte finns låser ingenting. */
  insert into public.store(key, value) values ('vift_offerEvents', '[]'::jsonb)
    on conflict (key) do nothing;

  /* Radlåsning — EXAKT den mekanism som redan är etablerad i
     20260908000001/20260917000001 för samma problemklass. Alla samtidiga
     anrop (oavsett vilken offert de gäller — nyckeln är delad) serialiseras
     här; den som får låset andra läser garanterat den FÖRSTA transaktionens
     redan committade resultat, inte en stale kopia. */
  select value into v_arr from public.store where key = 'vift_offerEvents' for update;
  if v_arr is null or jsonb_typeof(v_arr) <> 'array' then
    v_arr := '[]'::jsonb;
  end if;

  /* Deduplicering INUTI den låsta transaktionen — flyttad hit från Edge
     Function-minnet, som i sig var racet (två samtidiga anrop kunde båda
     se "ingen dubblett" i sina respektive, redan föråldrade kopior). */
  select elem into v_existing
    from jsonb_array_elements(v_arr) as elem
    where (elem ->> 'id') = v_event_id
       or (
            v_status = 'sent' and v_message_id is not null and v_message_id <> ''
            and (elem ->> 'messageId') = v_message_id
            and (elem ->> 'status') = 'sent'
          )
    limit 1;

  if v_existing is not null then
    /* Redan persisterad (idempotent Resend-retur av samma mejl, eller ett
       dubbelt om-försök av samma händelse) — returnera den BEFINTLIGA
       posten oförändrad, skapa ALDRIG en andra historikpost. */
    return v_existing;
  end if;

  v_arr := v_arr || jsonb_build_array(p_event);

  v_len := jsonb_array_length(v_arr);
  if v_len > v_max_keep then
    /* Behåll bara de v_max_keep SENASTE, i ORIGINALORDNING (samma
       kvarhållningspolicy som tidigare — splice bort äldst — nu utförd
       atomiskt inom låset). */
    select jsonb_agg(elem order by ord) into v_arr
      from (
        select elem, ord
        from jsonb_array_elements(v_arr) with ordinality as t(elem, ord)
        where ord > (v_len - v_max_keep)
      ) sub;
  end if;

  update public.store set value = v_arr, updated_at = now() where key = 'vift_offerEvents';
  return p_event;
end;
$function$
;
