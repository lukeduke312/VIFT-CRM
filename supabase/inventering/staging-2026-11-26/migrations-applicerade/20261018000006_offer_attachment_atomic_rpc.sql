-- ============================================================
-- Migration: Atomisk RPC för vift_offerAttachments (append/soft-delete)
-- Datum:     2026-10-18 (P0 FINAL INTEGRATION — OFFER ATTACHMENTS R1)
--
-- Syfte: `supabase/functions/offer-attachment-upload/index.ts` gör
-- fortfarande "läs hela vift_offerAttachments-arrayen, mutera i Deno-
-- minnet, skriv hela arrayen tillbaka" för BÅDE uppladdning (append)
-- OCH soft-delete — EXAKT samma buggklass som redan åtgärdats för
-- vift_workOrders/vift_timeEntries/vift_ronderingspass/vift_invoices.
-- Två samtidiga uppladdningar till OLIKA offerter (eller en uppladdning
-- som råkar ske samtidigt som en annan bilagas soft-delete) kan tyst
-- radera varandras ändring på denna array.
--
-- SCOPE (medvetet, snävt — se README §3): ENDAST
-- vift_offerAttachments-arrayen i DENNA Edge Function berörs. Dess
-- EGEN `appendOfferEvent()`-hjälpfunktion (som skriver
-- vift_offerEvents, fortfarande med samma osäkra mönster) RÖRS INTE —
-- lämnas exakt som den är, per explicit uppdrag ("do NOT touch
-- anything else in the offer flow"). Samma gäller offer-respond/
-- offer-token-validate/send-offer-email, som alla har samma
-- vift_offerEvents-mönster — en tidigare sessions PROPOSAL att fixa
-- det (offer_events_append()) finns bara i scratchpad, aldrig
-- materialiserad i denna kodbas (verifierat: `grep -rln
-- offer_events_append supabase/` ger noll träffar) — INTE applicerad
-- här, och INTE en del av detta uppdrag.
--
-- Samma arkitekturmönster som tidigare: SELECT...FOR UPDATE, stabilt
-- id, SECURITY DEFINER + REVOKE/GRANT service_role-only,
-- vift_lastChanged bumpas inom samma transaktion.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.offer_attachment_append(jsonb);
--   DROP FUNCTION IF EXISTS public.offer_attachment_soft_delete(text);
-- ============================================================

create or replace function public.offer_attachment_append(
  p_attachment jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;
create or replace function public.offer_attachment_soft_delete(
  p_attachment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
$$;
revoke all on function public.offer_attachment_append(jsonb) from public, anon, authenticated;
revoke all on function public.offer_attachment_soft_delete(text) from public, anon, authenticated;
grant execute on function public.offer_attachment_append(jsonb) to service_role;
grant execute on function public.offer_attachment_soft_delete(text) to service_role