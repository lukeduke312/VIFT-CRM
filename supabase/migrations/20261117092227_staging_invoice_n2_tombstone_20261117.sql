-- ============================================================
-- ÅTERSTÄLLD 2026-11-27 ur STAGING:s migrationshistorik (G1/G4 del 2).
-- Källa: supabase_migrations.schema_migrations, version 20261117092227, i STAGING
-- (yyzljlqyzzcbxmcdbual). Allt efter markören INNEHÅLL nedan, fram till
-- den avslutande raden ";", är EXAKT array_to_string(statements, E';\n')
-- (md5 2ec8d8d64e3b324b23646168ec793938, samma fil som
-- inventering/staging-2026-11-26/migrations-applicerade/20261117092227_staging_invoice_n2_tombstone_20261117.sql).
-- Supabase CLI sparar statements utan avslutande semikolon; ett ";" har
-- därför lagts till sist. Ingen annan ändring.
-- ============================================================
-- INNEHÅLL
-- Generated directly from live STAGING pg_get_functiondef on 2026-11-17.
-- NO-GO for LIVE. This is a candidate migration; UNTESTED in real Postgres.
-- Does NOT modify or delete existing invoices; changes only functions.
-- Historical keys: only freshly versioned vift-v2:* keys may create invoices.
-- Previously deleted keys have no tombstone; legacy keys MUST fail closed.
begin;
do $$
begin
 if md5(pg_get_functiondef('public.invoice_append_checked(jsonb,text)'::regprocedure)) <> 'd8214a4b6ff13ab963af0573412beaa2'
    or md5(pg_get_functiondef('public.invoice_draft_delete(text,bigint)'::regprocedure)) <> '86ed8fa39828f6dc0938e75e34c1469a' then
    raise exception 'N2 STOP: deployed SQL definitions drifted; regenerate migration';
 end if;
end $$;
CREATE OR REPLACE FUNCTION public.invoice_append_checked(p_invoice jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_sa            boolean;
  v_line          jsonb;
  v_lines_checked jsonb;
  v_line_id       text;
  v_seen_ids      text[];
  v_sref          jsonb;
  v_seen_source_keys text[];
begin
  -- N2 historical-cutover guard: old idempotency keys whose cache row was
  -- deleted before this migration CANNOT be recovered retroactively.
  -- Reject them, rather than permitting a deleted invoice to resurrect.
  -- All new appendChecked clients must send vift-v2:<fresh random UUID>.
  if p_idempotency_key is null or left(trim(p_idempotency_key), 8) <> 'vift-v2:' then
    raise exception 'legacy_idempotency_key_retired';
  end if;
  insert into public.store(key, value) values ('vift_invoices', '[]'::jsonb) on conflict (key) do nothing;
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then v_invoices := '[]'::jsonb; end if;

  -- J1/N2 (S1, S3): idempotency lookup AFTER the vift_invoices lock; a hit is
  -- trusted only if the cached invoice still exists with the same identity.
  if p_idempotency_key is not null and trim(p_idempotency_key) <> '' then
    create table if not exists public.op_idempotency (
      fn_name    text        not null,
      idem_key   text        not null,
      result     jsonb       not null,
      created_at timestamptz not null default now(),
      primary key (fn_name, idem_key)
    );
    select result into v_existing from public.op_idempotency
      where fn_name = 'invoice_append_checked' and idem_key = p_idempotency_key
      for update;
    if v_existing is not null then
      if coalesce((v_existing ->> 'tombstone')::boolean, false) = false
         and exists (
           select 1 from jsonb_array_elements(v_invoices) e
           where e ->> 'id'        = v_existing -> 'invoice' ->> 'id'
             and e ->> 'createdAt' = v_existing -> 'invoice' ->> 'createdAt'
             and coalesce(e ->> 'status', '') <> 'makulerad'
             and (
               ( (v_existing -> 'invoice') ? 'uid' and e ->> 'uid' = v_existing -> 'invoice' ->> 'uid' )
               or
               ( not ((v_existing -> 'invoice') ? 'uid')
                 and (select coalesce(jsonb_agg(x ->> 'id' order by x ->> 'id'), '[]'::jsonb)
                        from jsonb_array_elements(coalesce(e -> 'lines', '[]'::jsonb)) x)
                   = (select coalesce(jsonb_agg(x ->> 'id' order by x ->> 'id'), '[]'::jsonb)
                        from jsonb_array_elements(coalesce(v_existing -> 'invoice' -> 'lines', '[]'::jsonb)) x) )
             )
         ) then
        return v_existing || jsonb_build_object('replayed', true);
      end if;
      -- N2: a key that EVER created a different invoice is permanently
      -- consumed. Tombstones and other stale cache records cannot be used
      -- as permission to create a replacement; never recycle the key.
      if coalesce((v_existing ->> 'tombstone')::boolean, false) then
        raise exception 'idempotency_key_consumed_deleted';
      end if;
      raise exception 'idempotency_key_stale_or_reassigned';
    end if;
  end if;

  /* R9B FINAL (sista oberoende granskningen, punkt 2 — granska
     invoice_append_checked): till denna ronda tog denna funktion emot
     `p_invoice` nästan helt ofiltrerad — den enda kontrollen var
     källkollisionen MOT ANDRA fakturor (och den bara OM `sourceAware`
     redan var `true`). Fyra konkreta, åtgärdade luckor:

     1. `sourceAware=false` (eller saknat) GJORDE INGEN kontroll alls
        av `lines[].sourceRefs` — en rad kunde alltså bära en FULLT
        FUNGERANDE källkoppling (`sourceKey` m.m.) helt OSYNLIG för
        kollisionskontrollen, eftersom hela kontrollblocket nedan är
        villkorat på `sourceAware`. En sådan "dold" källkoppling hade
        kunnat existera parallellt med en annan, korrekt registrerad
        faktura för SAMMA arbetsorder, utan att någonsin upptäckas.
        FIX: `sourceRefs` TVINGAS BORT från varje rad när fakturan
        INTE är sourceAware, oavsett inskickat innehåll.
     2. Inga dubbletter inom DEN NYA fakturan SJÄLV kontrollerades —
        varken rad-id (skulle förväxla en senare
        `invoice_line_update`/`invoice_line_delete`-uppslagning mot
        fel rad) eller `sourceKey` (skulle kunna dubbel-claima SAMMA
        arbetsorder två gånger inom en och samma faktura, osynligt för
        kollisionskontrollen som bara jämför MOT andra fakturor).
        FIX: explicit dubblett-/tomhetskontroll för båda.
     3. INGEN numerisk validering av `lines[].qty/unitPrice/vatRate`
        skedde — Blockerare 2:s (ronda 7) typ-/värdekontroller gäller
        bara `invoice_line_add`/`invoice_line_update`, inte denna
        skapandeväg. FIX: samma kontroller tillämpade här också.
     4. Fakturans `status` litade blint på `p_invoice` — ett direkt
        `.rpc()`-anrop kunde skapa en faktura som redan är
        'skickad'/'betald'/'makulerad', vilket kringgår hela den
        normala livscykeln. FIX: `status` TVINGAS till `'utkast'` i
        den slutgiltiga sammanslagningen nedan (`v_new_inv := ...`),
        oavsett inskickat värde — IDENTISK princip som `id`/`revision`/
        `createdAt`/`updatedAt` redan tvingas där.

     Den legitima, source-aware skapandevägens EGNA claim-regler
     (kollisionskontrollen nedan) och idempotensen (ovan) är HELT
     OFÖRÄNDRADE — detta lägger bara till kontroller FÖRE dem, aldrig
     i stället för dem. */
  v_sa := coalesce((p_invoice ->> 'sourceAware')::boolean, false);

  /* R9B FINAL (sista riktade korrigeringen, Punkt 1): samma kontroll
     som invoice_discount_set — en faktura ska inte kunna SKAPAS med
     ett fast rabattbelopp som redan har ogiltig sub-öre-precision,
     via den källmedvetna skapandevägen, bara eftersom den vägen
     annars kringgår invoice_discount_set helt. */
  if (p_invoice -> 'discount' ->> 'type') = 'fixed'
     and (p_invoice -> 'discount' ->> 'value') is not null
     and scale((p_invoice -> 'discount' ->> 'value')::numeric) > 2 then
    raise exception 'invalid_discount_value';
  end if;

  /* R9B FINAL (sista precisionskontrollen): samma kontroll som
     invoice_tax_reduction_set — ett ROT/RUT-belopp/underlag ska inte
     kunna SKAPAS med ogiltig precision via den källmedvetna
     skapandevägen heller. */
  if (p_invoice -> 'taxReduction' ->> 'type') in ('rot', 'rut') then
    if (p_invoice -> 'taxReduction' ->> 'amount') is not null
       and scale((p_invoice -> 'taxReduction' ->> 'amount')::numeric) > 2 then
      raise exception 'invalid_tax_amount';
    end if;
    if (p_invoice -> 'taxReduction' ->> 'basis') is not null
       and scale((p_invoice -> 'taxReduction' ->> 'basis')::numeric) > 2 then
      raise exception 'invalid_tax_basis';
    end if;
  end if;

  if not v_sa then
    v_lines_checked := '[]'::jsonb;
    for v_line in select * from jsonb_array_elements(coalesce(p_invoice -> 'lines', '[]'::jsonb)) loop
      v_lines_checked := v_lines_checked || jsonb_build_array(v_line - 'sourceRefs');
    end loop;
    p_invoice := p_invoice || jsonb_build_object('lines', v_lines_checked);
  end if;

  v_seen_ids := '{}';
  v_seen_source_keys := '{}';
  for v_line in select * from jsonb_array_elements(coalesce(p_invoice -> 'lines', '[]'::jsonb)) loop
    v_line_id := v_line ->> 'id';
    if v_line_id is null or length(trim(v_line_id)) = 0 then
      raise exception 'invalid_line_id';
    end if;
    if v_line_id = any(v_seen_ids) then
      raise exception 'duplicate_line_id';
    end if;
    v_seen_ids := v_seen_ids || v_line_id;

    if v_line ? 'qty' then
      if jsonb_typeof(v_line -> 'qty') <> 'number' then raise exception 'invalid_qty'; end if;
      if (v_line->>'qty')::numeric < 0 then raise exception 'invalid_qty'; end if;
      if scale((v_line->>'qty')::numeric) > 3 then raise exception 'invalid_qty'; end if;
    end if;
    if v_line ? 'unitPrice' then
      if jsonb_typeof(v_line -> 'unitPrice') <> 'number' then raise exception 'invalid_price'; end if;
      if (v_line->>'unitPrice')::numeric < 0 then raise exception 'invalid_price'; end if;
      if scale((v_line->>'unitPrice')::numeric) > 4 then raise exception 'invalid_price'; end if;
    end if;
    if v_line ? 'vatRate' then
      if jsonb_typeof(v_line -> 'vatRate') <> 'number' then raise exception 'invalid_vat'; end if;
      if (v_line->>'vatRate')::numeric < 0 or (v_line->>'vatRate')::numeric > 100 then raise exception 'invalid_vat'; end if;
      if scale((v_line->>'vatRate')::numeric) > 4 then raise exception 'invalid_vat'; end if;
    end if;

    if v_sa then
      for v_sref in select * from jsonb_array_elements(coalesce(v_line -> 'sourceRefs', '[]'::jsonb)) loop
        if coalesce(v_sref ->> 'sourceKey', '') = '' then
          raise exception 'invalid_source_ref';
        end if;
        if (v_sref ->> 'sourceKey') = any(v_seen_source_keys) then
          raise exception 'duplicate_source_key';
        end if;
        v_seen_source_keys := v_seen_source_keys || (v_sref ->> 'sourceKey');
      end loop;
    end if;
  end loop;

  if v_sa then
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

  -- J1/N2 (S0): immutable server-generated uid; a client-sent uid is dropped.
  v_new_inv := (p_invoice - 'uid') || jsonb_build_object(
    'id', v_new_id, 'uid', gen_random_uuid()::text,
    'status', 'utkast', 'createdAt', v_now_text, 'updatedAt', v_now_text, 'revision', 1
  );

  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 3 — utöver
     granskningens egen lista, en extra, strikt SÄKRARE åtgärd: även
     den källmedvetna skapandevägen ska inte kunna producera en
     fakturapost som redan från start är finansiellt ogiltig, se
     filhuvudets kommentar vid _invoice_financial_check() ovan för
     motivering och den kända avgränsningen för denna specifika
     anropsväg). */
  perform public._invoice_financial_check(v_new_inv);

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
$function$;

CREATE OR REPLACE FUNCTION public.invoice_draft_delete(p_invoice_id text, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_activity_log jsonb;
  v_new_activity jsonb;
  v_actlog_id text;
  v_now      timestamptz;
  v_now_text text;
  v_current_revision bigint;
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  v_now := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then
    raise exception 'not_found';
  end if;
  select (ord - 1)::int into v_idx from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id limit 1;
  if v_idx is null then raise exception 'not_found'; end if;
  v_inv := v_invoices -> v_idx;

  v_current_revision := coalesce((v_inv ->> 'revision')::bigint, 0);
  -- R9B TEST 9 (ronda 5, Blockerare 4): NULL-fail-closed, se invoice_line_update() ovan för full motivering.
  if p_expected_revision is null or v_current_revision is distinct from p_expected_revision then
    raise exception 'stale_write';
  end if;

  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  select jsonb_agg(elem) into v_invoices from jsonb_array_elements(v_invoices) elem where elem ->> 'id' <> p_invoice_id;
  v_invoices := coalesce(v_invoices, '[]'::jsonb);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';

  -- J1/N2 (S2): invalidate this invoice's idempotency entries atomically,
  -- while vift_invoices is still locked. Only fn_name='invoice_append_checked'.
  if to_regclass('public.op_idempotency') is not null then
    -- Atomic tombstone under vift_invoices FOR UPDATE lock.
    -- Keep the consumed idem_key forever, even when invoice numbers recycle.
    update public.op_idempotency
       set result = jsonb_build_object(
          'tombstone', true,
          'deletedInvoiceId', p_invoice_id,
          'deletedInvoiceUid', v_inv ->> 'uid',
          'deletedCreatedAt', v_inv ->> 'createdAt',
          'deletedAt', v_now_text
       )
     where fn_name = 'invoice_append_checked'
       and result -> 'invoice' ->> 'id' = p_invoice_id
       and result -> 'invoice' ->> 'createdAt' = v_inv ->> 'createdAt'
       and (not (v_inv ? 'uid') or result -> 'invoice' ->> 'uid' = v_inv ->> 'uid');
  end if;

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
$function$;

commit;

;
