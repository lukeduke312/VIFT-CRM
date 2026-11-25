-- ============================================================
-- ÅTERSTÄLLD 2026-11-27 ur STAGING:s migrationshistorik (G1/G4 del 2).
-- Källa: supabase_migrations.schema_migrations, version 20261018000004, i STAGING
-- (yyzljlqyzzcbxmcdbual). Allt efter markören INNEHÅLL nedan, fram till
-- den avslutande raden ";", är EXAKT array_to_string(statements, E';\n')
-- (md5 16d6a9e3acb981168c56a39895b002e7, samma fil som
-- inventering/staging-2026-11-26/migrations-applicerade/20261018000004_invoice_lines_and_create_atomic_rpc.sql).
-- Supabase CLI sparar statements utan avslutande semikolon; ett ";" har
-- därför lagts till sist. Ingen annan ändring.
-- ============================================================
-- INNEHÅLL
-- ============================================================
-- Migration: Atomiska RPC:er för RESTEN av vift_invoices-skrivvägarna
-- Datum:     2026-10-18 (P0 FINAL INTEGRATION — INVOICE CORRECTION)
-- Beror på:  20261018000003_invoice_set_status_atomic_rpc.sql
--
-- KORRIGERING (Lucas, via koordinator): den ursprungliga
-- invoice_set_status-leveransen fixade ENDAST betalningsstatus-racet,
-- men lämnade `vift_invoices` KVAR i state.js:s generiska
-- _doPersist()-lista — vilket betydde att en SENARE, obesläktad
-- persist()-anrop (med en i minnet potentiellt inaktuell kopia av HELA
-- invoices-arrayen, inhämtad FÖRE en atomisk statusändring) fortfarande
-- kunde skriva över den atomiskt satta statusen. Denna migration
-- stänger det kvarvarande gapet genom att migrera VARJE ANNAN skrivväg
-- till `vift_invoices` (radredigering, rabatt, ROT/RUT, metadata,
-- radering, skapande) till egna, smala RPC:er — SAMMA princip som
-- AO/tid och ronderingspass (ingen "ersätt hela fakturan"-RPC).
--
-- DESIGN-FÖRENKLING (medveten, se package/README.md §3 för full
-- motivering): dessa RPC:er replikerar INTE InvoiceService.js:s
-- finansiella prospective-validering (ROT/RUT-gränskontroll via
-- validateFinancialState()/calcSummary()) server-sidigt — det är inte
-- en säkerhetsgräns (ingen klient kan "fuska" sig till pengar genom att
-- kringgå den; den skyddar bara mot att användaren RÅKAR skapa ett
-- redovisningsmässigt konstigt tillstånd) och att reimplementera hela
-- fakturans beräkningsmotor i PL/pgSQL under tidspress är en betydligt
-- större risk (subtila räknefel) än nyttan. Klienten validerar och
-- bygger EXAKT samma redan-beräknade patch/rad som tidigare (oförändrad
-- JS-logik i InvoiceService.js) — RPC:n gör ENDAST den race-kritiska
-- delen atomisk: hitta fakturan via stabilt id under radlås, kontrollera
-- draft-spärren (`status = 'utkast'`, servad från den LÅSTA, färskaste
-- raden — INTE klientens påstående) och applicera den redan godkända
-- patchen. Detta eliminerar EXAKT den diagnostiserade racen (en
-- obesläktad senare write skriver över en tidigare bekräftad ändring)
-- utan att duplicera affärslogik som redan körs korrekt client-side.
--
-- invoice_append_checked() är undantaget — där replikeras VERKLIGEN en
-- cross-invoice dataintegritetskontroll (sourceKey-kollision mot andra
-- AKTIVA fakturor), eftersom det är en multi-rad-konsekvens som inte
-- kan garanteras av en enda klients lokala vy.
--
-- reconcileWorkOrderBilling() (vift_workOrders, en annan nyckel) körs
-- även efter dessa RPC:er fortsatt client-side, oförändrat — redan
-- separat täckt av Part A:s AO-arbete.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.invoice_line_add(text, jsonb);
--   DROP FUNCTION IF EXISTS public.invoice_line_update(text, text, jsonb);
--   DROP FUNCTION IF EXISTS public.invoice_line_delete(text, text);
--   DROP FUNCTION IF EXISTS public.invoice_draft_delete(text);
--   DROP FUNCTION IF EXISTS public.invoice_discount_set(text, jsonb);
--   DROP FUNCTION IF EXISTS public.invoice_tax_reduction_set(text, jsonb);
--   DROP FUNCTION IF EXISTS public.invoice_meta_update(text, jsonb);
--   DROP FUNCTION IF EXISTS public.invoice_append_checked(jsonb, text);
-- ============================================================

-- ── Hjälpfunktion: lås+hämta en faktura via stabilt id, valfritt
--    draft-spärrad. Returnerar (array, index, invoice) via OUT-parametrar
--    hade varit snyggare, men PL/pgSQL-funktioner som returnerar flera
--    värden till kod i SAMMA transaktion är klumpigt över RPC-gränsen —
--    varje funktion nedan upprepar därför den korta lås+hitta-sekvensen
--    själv (samma stil som redan etablerad i rondering_point_patch m.fl.,
--    inte en ny abstraktion). ──────────────────────────────────────────

create or replace function public.invoice_line_add(
  p_invoice_id text,
  p_line       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then
    raise exception 'not_found';
  end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;
  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  v_inv := v_inv || jsonb_build_object(
    'lines', coalesce(v_inv -> 'lines', '[]'::jsonb) || jsonb_build_array(p_line),
    'updatedAt', v_now_text
  );
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$$;
create or replace function public.invoice_line_update(
  p_invoice_id text,
  p_line_id    text,
  p_patch      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_lines    jsonb;
  v_lidx     int;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then
    raise exception 'not_found';
  end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;
  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  v_lines := coalesce(v_inv -> 'lines', '[]'::jsonb);
  select (ord - 1)::int into v_lidx from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_line_id limit 1;
  if v_lidx is null then raise exception 'line_not_found'; end if;

  v_lines := jsonb_set(v_lines, array[v_lidx::text], (v_lines -> v_lidx) || p_patch);
  v_inv := v_inv || jsonb_build_object('lines', v_lines, 'updatedAt', v_now_text);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$$;
create or replace function public.invoice_line_delete(
  p_invoice_id text,
  p_line_id    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_lines    jsonb;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then
    raise exception 'not_found';
  end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;
  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  v_lines := coalesce(v_inv -> 'lines', '[]'::jsonb);
  select jsonb_agg(elem) into v_lines from jsonb_array_elements(v_lines) elem where elem ->> 'id' <> p_line_id;
  v_inv := v_inv || jsonb_build_object('lines', coalesce(v_lines, '[]'::jsonb), 'updatedAt', v_now_text);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$$;
create or replace function public.invoice_draft_delete(
  p_invoice_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_activity_log jsonb;
  v_new_activity jsonb;
  v_actlog_id text;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then
    raise exception 'not_found';
  end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;
  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  select jsonb_agg(elem) into v_invoices from jsonb_array_elements(v_invoices) elem where elem ->> 'id' <> p_invoice_id;
  v_invoices := coalesce(v_invoices, '[]'::jsonb);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';

  insert into public.store(key, value) values ('vift_activityLog', '[]'::jsonb) on conflict (key) do nothing;
  select value into v_activity_log from public.store where key = 'vift_activityLog' for update;
  if v_activity_log is null or jsonb_typeof(v_activity_log) <> 'array' then v_activity_log := '[]'::jsonb; end if;
  v_actlog_id := 'ACT-' || to_char(v_now, 'YYYYMMDDHH24MISSMS') || '-' || substr(md5(random()::text), 1, 6);
  v_new_activity := jsonb_build_object(
    'id', v_actlog_id, 'type', 'invoice_deleted',
    'description', 'Fakturautkast ' || p_invoice_id || ' raderat',
    'timestamp', v_now_text, 'customerId', coalesce(v_inv ->> 'customerId', ''),
    'propertyId', '', 'workOrderId', '', 'offerId', '', 'invoiceId', p_invoice_id,
    'salesOpportunityId', '', 'inspectionId', '', 'ronderingId', '', 'deviationId', '', 'userId', ''
  );
  v_activity_log := jsonb_build_array(v_new_activity) || v_activity_log;
  update public.store set value = v_activity_log, updated_at = v_now where key = 'vift_activityLog';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('deletedInvoice', v_inv, 'activityLog', v_activity_log, 'serverSignature', v_now_text);
end;
$$;
create or replace function public.invoice_discount_set(
  p_invoice_id text,
  p_discount   jsonb  -- {type, value} — redan validerat av InvoiceService.setDiscount()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then raise exception 'not_found'; end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;
  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  v_inv := v_inv || jsonb_build_object('discount', p_discount, 'updatedAt', v_now_text);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$$;
create or replace function public.invoice_tax_reduction_set(
  p_invoice_id   text,
  p_tax_reduction jsonb  -- {type, amount, basis, note} — redan validerat av InvoiceService.setTaxReduction()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then raise exception 'not_found'; end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;
  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  v_inv := v_inv || jsonb_build_object('taxReduction', p_tax_reduction, 'updatedAt', v_now_text);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$$;
create or replace function public.invoice_meta_update(
  p_invoice_id text,
  p_patch      jsonb  -- allowlist enforced HERE, not just client-side
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_safe     jsonb := '{}'::jsonb;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then raise exception 'not_found'; end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;
  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  -- SAMMA allowlist som InvoiceService.updateMeta() (oförändrad semantik),
  -- men ENFORCED här server-sidigt, inte bara client-side.
  if p_patch ? 'customerReference' then v_safe := v_safe || jsonb_build_object('customerReference', p_patch->>'customerReference'); end if;
  if p_patch ? 'ocr' then v_safe := v_safe || jsonb_build_object('ocr', p_patch->>'ocr'); end if;
  if p_patch ? 'note' then v_safe := v_safe || jsonb_build_object('note', p_patch->>'note'); end if;

  v_inv := v_inv || v_safe || jsonb_build_object('updatedAt', v_now_text);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$$;
-- ── invoice_append_checked — createBlank() + createInvoicesFromSourceKeys().
--    Server-genererat id (eliminerar newId()-racen, samma princip som
--    rondering_pass_create). Cross-invoice sourceKey-kollisionskontroll
--    — SAMMA logik som invoice_set_status's reaktiveringskontroll, men
--    körd mot "det nya fakturaobjektet" istället för en reaktiverad. Om
--    kollision: fakturan skapas INTE, anropet avvisas (anroparen kan då
--    hoppa över just den kunden/gruppen istället för att hela batchen
--    misslyckas tyst). ─────────────────────────────────────────────────
create or replace function public.invoice_append_checked(
  p_invoice jsonb,  -- allt UTOM id — id tilldelas server-sidigt under låset
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoices jsonb;
  v_max_num  int := 0;
  v_elem     jsonb;
  v_num      int;
  v_new_id   text;
  v_new_inv  jsonb;
  v_collision boolean := false;
  v_now      timestamptz := clock_timestamp();
  v_now_text text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_existing jsonb;
begin
  /* P0-6 FIX (independent-reviewer finding): invoice_append_checked had
     NO idempotency-key protection — a network retry on ordinary invoice
     creation (createBlank/createFromAO/billing-queue) where "the
     request succeeded server-side but the client never saw the
     response" could silently double-create the invoice on retry,
     exactly the class of bug already protected against for AO/time
     (work_order_create/time_entry_create's own p_idempotency_key +
     op_idempotency table) and for ronderingspass creation. Reuses the
     SAME shared public.op_idempotency table (created defensively here
     too, IF NOT EXISTS, so this migration has no hidden ordering
     dependency on 20261017000001 having run first). A null/omitted key
     (the default) preserves the exact previous behavior for any
     existing caller that does not yet pass one — this is a strictly
     additive, backward-compatible signature change (new optional
     trailing parameter). */
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    create table if not exists public.op_idempotency (
      fn_name    text        not null,
      idem_key   text        not null,
      result     jsonb       not null,
      created_at timestamptz not null default now(),
      primary key (fn_name, idem_key)
    );
    select result into v_existing from public.op_idempotency
      where fn_name = 'invoice_append_checked' and idem_key = p_idempotency_key;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  insert into public.store(key, value) values ('vift_invoices', '[]'::jsonb) on conflict (key) do nothing;
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then v_invoices := '[]'::jsonb; end if;

  if coalesce((p_invoice ->> 'sourceAware')::boolean, false) then
    with other_keys as (
      select distinct (r ->> 'sourceKey') as sk
      from jsonb_array_elements(v_invoices) oi,
           jsonb_array_elements(coalesce(oi -> 'lines', '[]'::jsonb)) l,
           jsonb_array_elements(coalesce(l -> 'sourceRefs', '[]'::jsonb)) r
      where coalesce(oi ->> 'status', '') <> 'makulerad'
    ),
    my_keys as (
      select distinct (r ->> 'sourceKey') as sk
      from jsonb_array_elements(coalesce(p_invoice -> 'lines', '[]'::jsonb)) l,
           jsonb_array_elements(coalesce(l -> 'sourceRefs', '[]'::jsonb)) r
    )
    select exists(select 1 from my_keys m join other_keys o on m.sk = o.sk) into v_collision;
    if v_collision then
      raise exception 'source_collision';
    end if;
  end if;

  for v_elem in select * from jsonb_array_elements(v_invoices) loop
    v_num := nullif(regexp_replace(coalesce(v_elem ->> 'id', ''), '[^0-9]', '', 'g'), '')::int;
    if v_num is not null and v_num > v_max_num then v_max_num := v_num; end if;
  end loop;
  v_new_id := 'F-' || lpad((v_max_num + 1)::text, 3, '0');

  v_new_inv := p_invoice || jsonb_build_object(
    'id', v_new_id, 'createdAt', v_now_text, 'updatedAt', v_now_text
  );
  v_invoices := v_invoices || jsonb_build_array(v_new_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  v_new_inv := jsonb_build_object('invoice', v_new_inv, 'serverSignature', v_now_text);

  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    insert into public.op_idempotency(fn_name, idem_key, result)
      values ('invoice_append_checked', p_idempotency_key, v_new_inv)
      on conflict (fn_name, idem_key) do nothing;
  end if;

  return v_new_inv;
end;
$$;
-- ── Behörigheter: ENDAST service_role ────────────────────────────────
revoke all on function public.invoice_line_add(text, jsonb) from public, anon, authenticated;
revoke all on function public.invoice_line_update(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.invoice_line_delete(text, text) from public, anon, authenticated;
revoke all on function public.invoice_draft_delete(text) from public, anon, authenticated;
revoke all on function public.invoice_discount_set(text, jsonb) from public, anon, authenticated;
revoke all on function public.invoice_tax_reduction_set(text, jsonb) from public, anon, authenticated;
revoke all on function public.invoice_meta_update(text, jsonb) from public, anon, authenticated;
revoke all on function public.invoice_append_checked(jsonb, text) from public, anon, authenticated;
grant execute on function public.invoice_line_add(text, jsonb) to service_role;
grant execute on function public.invoice_line_update(text, text, jsonb) to service_role;
grant execute on function public.invoice_line_delete(text, text) to service_role;
grant execute on function public.invoice_draft_delete(text) to service_role;
grant execute on function public.invoice_discount_set(text, jsonb) to service_role;
grant execute on function public.invoice_tax_reduction_set(text, jsonb) to service_role;
grant execute on function public.invoice_meta_update(text, jsonb) to service_role;
grant execute on function public.invoice_append_checked(jsonb, text) to service_role
;
