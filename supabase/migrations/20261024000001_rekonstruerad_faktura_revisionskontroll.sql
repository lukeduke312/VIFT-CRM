-- ============================================================
-- Rekonstruerad 2026-11-27 från STAGING-schema (pg_get_functiondef/pg_policies), inte historisk SQL.
-- Källa: STAGING yyzljlqyzzcbxmcdbual, läst med SELECT 2026-11-25
-- (supabase/inventering/staging-2026-11-26/schema/ och tests/local/staging-schema-facit-2026-11-25.json).
-- Den SQL som ursprungligen installerade objekten nedan finns inte i någon
-- registrerad migration, i något repo eller i git-historiken (G1/G4, avsnitt 7).
-- Funktionstexterna är exakt pg_get_functiondef() från STAGING; grants och
-- REVOKE motsvarar proacl/pg_policies i drift. Verifieras av
-- tests/local/migrationskedja.sh (jämför md5 av pg_get_functiondef efter körning).
-- ============================================================
-- R-A: fakturafunktionernas revisionskontroll (R9B TEST 9). EF-kommentaren i invoice-write
-- hänvisar till migrations_phase1_additive/20261024000001_invoice_revision_conflict_control.sql,
-- som aldrig registrerades i schema_migrations och inte finns lokalt. Filen har därför fått
-- samma versionsnummer så att den sorteras FÖRE 20261116094236 (J1) och 20261117092236 (A3a).
-- A3a kräver att invoice_set_status(text,text,bigint,text) redan finns med md5
-- b86aab346d6339c5959c3d76f192635e. Den versionen är tagen ur STAGING:s egen backup
-- vift_staging_backup_20261117.function_definitions (definition före A3a). Övriga funktioner
-- är driftversionerna; ingen senare registrerad migration ändrar dem.
-- Äldre signaturer från 20261018000003/04 tas bort, eftersom de inte finns i drift.
-- invoice_draft_delete(text, bigint) skapas av J1 (20261116094236), inte här.

begin;

drop function if exists public.invoice_set_status(text, text, text);
drop function if exists public.invoice_draft_delete(text);
drop function if exists public.invoice_line_add(text, jsonb);
drop function if exists public.invoice_line_update(text, text, jsonb);
drop function if exists public.invoice_line_delete(text, text);
drop function if exists public.invoice_discount_set(text, jsonb);
drop function if exists public.invoice_tax_reduction_set(text, jsonb);
drop function if exists public.invoice_meta_update(text, jsonb);

-- _invoice_calc_financial(jsonb)  (md5 av pg_get_functiondef i drift: 50868d1124a4cb0c0a1ea2923e009a30)
CREATE OR REPLACE FUNCTION public._invoice_calc_financial(p_inv jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare
  v_line         jsonb;
  v_qty          numeric;
  v_price        numeric;
  v_vat          numeric;
  v_linesEx      numeric := 0;
  v_linesVat     numeric := 0;
  v_disc         jsonb;
  v_discType     text;
  v_discValue    numeric;
  v_discAmt      numeric := 0;
  v_ratio        numeric;
  v_exVat        numeric;
  v_vatAmt       numeric;
  v_totalInclVat numeric;
  v_tr           jsonb;
  v_trType       text;
  v_trAmountText text;
  v_trAmount     numeric;
  v_customerPays numeric;
begin
  for v_line in select * from jsonb_array_elements(coalesce(p_inv -> 'lines', '[]'::jsonb)) loop
    v_qty   := case when jsonb_typeof(v_line -> 'qty') = 'number' then (v_line->>'qty')::numeric else 0 end;
    v_price := case when jsonb_typeof(v_line -> 'unitPrice') = 'number' then (v_line->>'unitPrice')::numeric else 0 end;
    if jsonb_typeof(v_line -> 'vatRate') = 'number' then
      v_vat := (v_line->>'vatRate')::numeric;
      if v_vat is null or v_vat < 0 or v_vat > 100 then v_vat := 25; end if;
    else
      v_vat := 25;
    end if;
    v_linesEx  := v_linesEx + v_qty * v_price;
    v_linesVat := v_linesVat + v_qty * v_price * (v_vat / 100);
  end loop;

  v_disc      := coalesce(p_inv -> 'discount', jsonb_build_object('type', 'none', 'value', 0));
  v_discType  := v_disc ->> 'type';
  v_discValue := coalesce((v_disc ->> 'value')::numeric, 0);
  if v_discType = 'percent' and v_discValue > 0 then
    v_discAmt := round(v_linesEx * v_discValue / 100, 2);
  elsif v_discType = 'fixed' and v_discValue > 0 then
    v_discAmt := least(v_discValue, v_linesEx);
  end if;

  if v_linesEx > 0 then v_ratio := 1 - v_discAmt / v_linesEx; else v_ratio := 1; end if;
  v_exVat        := round(v_linesEx - v_discAmt, 2);
  v_vatAmt       := round(v_linesVat * v_ratio, 2);
  v_totalInclVat := v_exVat + v_vatAmt;

  v_tr     := coalesce(p_inv -> 'taxReduction', jsonb_build_object('type', 'none', 'amount', 0));
  v_trType := v_tr ->> 'type';
  if v_trType in ('rot', 'rut') and (v_tr ? 'amount') then
    v_trAmountText := v_tr ->> 'amount';
    if v_trAmountText is null or trim(v_trAmountText) = '' then
      v_trAmount := 0;
    else
      v_trAmount := v_trAmountText::numeric;
    end if;
  else
    v_trAmount := 0;
  end if;

  v_customerPays := v_totalInclVat - v_trAmount;

  return jsonb_build_object(
    'linesEx', v_linesEx, 'linesVat', v_linesVat, 'discAmt', v_discAmt,
    'exVat', v_exVat, 'vat', v_vatAmt, 'totalInclVat', v_totalInclVat,
    'trAmount', v_trAmount, 'customerPays', v_customerPays
  );
end;
$function$;
REVOKE ALL ON FUNCTION public._invoice_calc_financial(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._invoice_calc_financial(jsonb) TO PUBLIC, anon, authenticated, service_role;

-- _invoice_financial_check(jsonb)  (md5 av pg_get_functiondef i drift: 47094b57ec32374a8337eddd917d13af)
CREATE OR REPLACE FUNCTION public._invoice_financial_check(p_inv jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_s            jsonb;
  v_totalInclVat numeric;
  v_trAmount     numeric;
  v_customerPays numeric;
begin
  v_s := public._invoice_calc_financial(p_inv);
  v_totalInclVat := (v_s ->> 'totalInclVat')::numeric;
  v_trAmount     := (v_s ->> 'trAmount')::numeric;
  v_customerPays := (v_s ->> 'customerPays')::numeric;

  /* Postgres `numeric` accepterar det speciella värdet 'NaN' (till
     skillnad från JSON-talstypen, som aldrig kan vara NaN) — och ett
     sådant NaN är INTE `< 0` (det sorteras som "större än alla andra
     tal", inte jämförbart i vanlig mening). Ett explicit
     `= 'NaN'::numeric`-test krävs alltså HÄR (NaN = NaN utvärderas till
     TRUE i Postgres, till skillnad från IEEE754) — annars hade en
     textsträng `"NaN"` i `taxReduction.amount` (redan avvisad vid källan
     i invoice_tax_reduction_set, se där — men denna funktion måste vara
     fail-closed OBEROENDE av anroparen, samma princip som i hela denna
     fil). */
  if v_totalInclVat is null or v_totalInclVat = 'NaN'::numeric or v_totalInclVat < 0 then
    raise exception 'financial_invariant_violation';
  end if;
  if v_trAmount is null or v_trAmount = 'NaN'::numeric or v_trAmount < 0 then
    raise exception 'financial_invariant_violation';
  end if;
  if v_trAmount > v_totalInclVat then
    raise exception 'financial_invariant_violation';
  end if;
  if v_customerPays is null or v_customerPays = 'NaN'::numeric or v_customerPays < 0 then
    raise exception 'financial_invariant_violation';
  end if;
end;
$function$;
REVOKE ALL ON FUNCTION public._invoice_financial_check(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._invoice_financial_check(jsonb) TO PUBLIC, anon, authenticated, service_role;

-- Version FÖRE A3a (ur vift_staging_backup_20261117.function_definitions). A3a ersätter den.
-- invoice_set_status(text, text, bigint, text)  (md5 av pg_get_functiondef i backup 2026-11-17: b86aab346d6339c5959c3d76f192635e)
CREATE OR REPLACE FUNCTION public.invoice_set_status(p_invoice_id text, p_status text, p_expected_revision bigint, p_actor_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices    jsonb;
  v_idx         int;
  v_inv         jsonb;
  v_prev        text;
  v_allowed     text[];
  v_reactivating boolean := false;
  v_source_aware boolean;
  v_collision   boolean := false;
  v_now         timestamptz;
  v_now_text    text;
  v_activity_log jsonb;
  v_new_activity jsonb;
  v_actlog_id   text;
  v_current_revision bigint;
  v_new_revision     bigint;
begin
  if p_status not in ('utkast', 'skickad', 'betald', 'förfallen', 'makulerad') then
    raise exception 'invalid_status';
  end if;

  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  v_now := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then
    raise exception 'not_found';
  end if;

  select (ord - 1)::int into v_idx
    from jsonb_array_elements(v_invoices) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_invoice_id
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;
  v_inv  := v_invoices -> v_idx;
  v_prev := v_inv ->> 'status';

  v_current_revision := coalesce((v_inv ->> 'revision')::bigint, 0);
  -- R9B TEST 9 (ronda 5, Blockerare 4): NULL-fail-closed, se invoice_line_update() ovan för full motivering.
  if p_expected_revision is null or v_current_revision is distinct from p_expected_revision then
    raise exception 'stale_write';
  end if;

  if p_status = v_prev then
    return jsonb_build_object('invoice', v_inv, 'changed', false, 'serverSignature', v_now_text);
  end if;

  v_allowed := case v_prev
    when 'utkast'     then array['skickad', 'makulerad']
    when 'skickad'    then array['betald', 'förfallen', 'makulerad']
    when 'förfallen'  then array['skickad', 'betald', 'makulerad']
    when 'betald'     then array['makulerad']
    when 'makulerad'  then array['utkast']
    else array[]::text[]
  end;
  if not (p_status = any(v_allowed)) then
    raise exception 'invalid_transition';
  end if;

  v_reactivating := (v_prev = 'makulerad' and p_status = 'utkast');
  v_source_aware := coalesce((v_inv ->> 'sourceAware')::boolean, false);

  if v_reactivating and v_source_aware then
    with other_keys as (
      select distinct (r ->> 'sourceKey') as sk
      from jsonb_array_elements(v_invoices) oi,
           jsonb_array_elements(coalesce(oi -> 'lines', '[]'::jsonb)) l,
           jsonb_array_elements(coalesce(l -> 'sourceRefs', '[]'::jsonb)) r
      where (oi ->> 'id') <> p_invoice_id
        and coalesce(oi ->> 'status', '') <> 'makulerad'
    ),
    my_keys as (
      select distinct (r ->> 'sourceKey') as sk
      from jsonb_array_elements(coalesce(v_inv -> 'lines', '[]'::jsonb)) l,
           jsonb_array_elements(coalesce(l -> 'sourceRefs', '[]'::jsonb)) r
    )
    select exists(select 1 from my_keys m join other_keys o on m.sk = o.sk) into v_collision;

    if v_collision then
      raise exception 'source_collision';
    end if;
  end if;

  v_new_revision := v_current_revision + 1;
  v_inv := v_inv || jsonb_build_object('status', p_status, 'updatedAt', v_now_text, 'revision', v_new_revision);
  if p_status = 'betald' then
    v_inv := v_inv || jsonb_build_object('paidAt', v_now_text);
  end if;
  if p_status = 'skickad' then
    v_inv := v_inv || jsonb_build_object('sentAt', v_now_text);
  end if;
  if v_reactivating then
    v_inv := v_inv || jsonb_build_object('sentAt', '', 'paidAt', '');
  end if;

  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';

  insert into public.store(key, value) values ('vift_activityLog', '[]'::jsonb)
    on conflict (key) do nothing;
  select value into v_activity_log from public.store where key = 'vift_activityLog' for update;
  if v_activity_log is null or jsonb_typeof(v_activity_log) <> 'array' then
    v_activity_log := '[]'::jsonb;
  end if;
  v_actlog_id := 'ACT-' || to_char(v_now, 'YYYYMMDDHH24MISSMS') || '-' || substr(md5(random()::text), 1, 6);
  v_new_activity := jsonb_build_object(
    'id', v_actlog_id,
    'type', 'invoice_status',
    'description', 'Faktura ' || p_invoice_id || ' ändrad till ' || p_status,
    'timestamp', v_now_text,
    'customerId', coalesce(v_inv ->> 'customerId', ''),
    'propertyId', '', 'workOrderId', '', 'offerId', '',
    'invoiceId', p_invoice_id, 'salesOpportunityId', '',
    'inspectionId', '', 'ronderingId', '', 'deviationId', '',
    'userId', coalesce(p_actor_id, '')
  );
  v_activity_log := jsonb_build_array(v_new_activity) || v_activity_log;
  update public.store set value = v_activity_log, updated_at = v_now where key = 'vift_activityLog';

  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object(
    'invoice', v_inv, 'prevStatus', v_prev, 'changed', true,
    'activityLog', v_activity_log, 'serverSignature', v_now_text
  );
end;
$function$;
REVOKE ALL ON FUNCTION public.invoice_set_status(text, text, bigint, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_set_status(text, text, bigint, text) TO service_role;

-- invoice_line_add(text, jsonb, bigint)  (md5 av pg_get_functiondef i drift: 50828c4c7bf0201ad62141003b9dbabe)
CREATE OR REPLACE FUNCTION public.invoice_line_add(p_invoice_id text, p_line jsonb, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_now      timestamptz;
  v_now_text text;
  v_current_revision bigint;
  v_new_revision bigint;
  v_qty        numeric;
  v_unit_price numeric;
  v_vat_rate   numeric;
  v_patch_key  text;
  v_line_id    text;
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
  -- R9B FINAL: samma NULL-fail-closed-princip som i invoice_line_update
  -- m.fl. (se dess kommentar för full motivering av `IS DISTINCT FROM`).
  if p_expected_revision is null or v_current_revision is distinct from p_expected_revision then
    raise exception 'stale_write';
  end if;

  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 2 — verkligt
     fynd): `p_line` fogades tidigare in i `lines` OFILTRERAD. Klienten
     (InvoiceService.addLine()) tar visserligen redan bort
     `sourceRefs`/`id`/`sourceId` innan den bygger sin egen rad — men ett
     direkt `.rpc('invoice_line_add', ...)`-anrop (eller en framtida
     klientbugg) kunde ändå skicka ETT av dessa fält rakt igenom, precis
     som Blockerare 3 i ronda 6 redan visade för invoice_line_update.
     FAIL-CLOSED ALLOWLIST här, server-sidigt, oberoende av klienten —
     exakt samma princip, samma lista (minus `id`/`source`/`sourceId`,
     som ÄR tillåtna att skicka in här eftersom en NY rad måste ha ett
     id/source-label, men vars VÄRDEN ändå aldrig litas på rakt av, se
     nedan). `sourceRefs` finns INTE i listan — den kan alltså aldrig
     förekomma i en manuellt tillagd rad, oavsett anropare. */
  for v_patch_key in select jsonb_object_keys(p_line) loop
    if not (v_patch_key = any(array['description','qty','unit','unitPrice','vatRate','freetext','source','id','sourceId'])) then
      raise exception 'forbidden_field';
    end if;
  end loop;

  /* Blockerare 2, forts.: `sourceId` kan ALDRIG sättas av anroparen —
     en manuell rad är per definition inte source-backed (samma regel
     som redan gäller klientsidan, nu även garanterad server-sidigt).
     Värdet tvingas till tomt HÄR, oavsett vad `p_line` innehöll — detta
     bryter INTE den normala addLine()-vägen, som redan själv skickar
     `sourceId: ''`. */
  p_line := p_line || jsonb_build_object('sourceId', '');

  /* Blockerare 2, forts.: radens `id` måste finnas och vara unikt inom
     fakturan — annars kunde en manipulerad/dubblerad id förväxla eller
     skriva över en annan rads identitet (t.ex. en source-backed rad)
     vid en SENARE operation som slår upp raden via id. En ren
     existens-/dubblettkontroll här, ingen omskrivning av ett giltigt,
     unikt klient-id (det skulle bryta addLine()s kontrakt att returnera
     SAMMA id som faktiskt sparades, se InvoiceService.js). */
  v_line_id := p_line ->> 'id';
  if v_line_id is null or length(trim(v_line_id)) = 0 then
    raise exception 'invalid_line_id';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(v_inv -> 'lines', '[]'::jsonb)) as le
    where le ->> 'id' = v_line_id
  ) then
    raise exception 'duplicate_line_id';
  end if;

  /* R9B TEST 9 (ronda 6, utökad ronda 7 — Blockerare 2): samma minsta
     server-sidiga sanity-validering som invoice_line_update — se dess
     kommentar för avgränsningen mot den fulla ROT/RUT-invarianten
     (medvetet INTE replikerad här, se Blockerare 3 nedan för den
     separata hanteringen av DEN frågan). Ronda 7-tillägg: ett
     JSON-NUMMER-typkrav INNAN cast — annars accepterar
     `(x ->> 'qty')::numeric` even en textsträng som `"NaN"` som ett
     "giltigt", icke-negativt numeriskt värde (Postgres numeric stödjer
     NaN som ett eget värde och `NaN < 0` är FALSE, så det tidigare
     `< 0`-testet skyddade INTE mot detta). `jsonb_typeof(...) = 'number'`
     avvisar både textsträngar och NaN/Infinity (JSON-specifikationen
     tillåter aldrig dessa som number-literaler, så ett sådant försök
     anländer alltid som en annan JSON-typ eller blir redan avvisat av
     JSON-parsningen tidigare i kedjan). */
  if p_line ? 'qty' then
    if jsonb_typeof(p_line -> 'qty') <> 'number' then raise exception 'invalid_qty'; end if;
    v_qty := (p_line->>'qty')::numeric;
    if v_qty is null or v_qty < 0 then raise exception 'invalid_qty'; end if;
    -- R9B FINAL (sista precisionskontrollen): samma dokumenterade
    -- gräns som klienten — antal högst 3 decimaler. `scale()` ger
    -- EXAKT antal decimaler i den inskickade JSON-talstextens
    -- numeriska representation, ingen avrundning inblandad.
    if scale(v_qty) > 3 then raise exception 'invalid_qty'; end if;
  end if;
  if p_line ? 'unitPrice' then
    if jsonb_typeof(p_line -> 'unitPrice') <> 'number' then raise exception 'invalid_price'; end if;
    v_unit_price := (p_line->>'unitPrice')::numeric;
    if v_unit_price is null or v_unit_price < 0 then raise exception 'invalid_price'; end if;
    -- R9B FINAL (sista precisionskontrollen, verkligt reproducerad:
    -- 0.0199996 — 7 decimaler — gav olika resultat i JS och SQL).
    -- Pris högst 4 decimaler, samma dokumenterade gräns som klienten.
    if scale(v_unit_price) > 4 then raise exception 'invalid_price'; end if;
  end if;
  if p_line ? 'vatRate' then
    if jsonb_typeof(p_line -> 'vatRate') <> 'number' then raise exception 'invalid_vat'; end if;
    v_vat_rate := (p_line->>'vatRate')::numeric;
    if v_vat_rate is null or v_vat_rate < 0 or v_vat_rate > 100 then raise exception 'invalid_vat'; end if;
    -- R9B FINAL (sista precisionskontrollen, ANDRA ronda, verkligt
    -- reproducerad): momssats högst 4 decimaler, samma dokumenterade
    -- gräns som klienten.
    if scale(v_vat_rate) > 4 then raise exception 'invalid_vat'; end if;
  end if;

  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 3): den fulla
     finansiella invarianten valideras ATOMISKT mot fakturans NYA
     tillstånd (med den nya raden redan inlagd), under SAMMA radlås,
     INNAN skrivningen — se _invoice_financial_check() ovan. */
  perform public._invoice_financial_check(
    v_inv || jsonb_build_object('lines', coalesce(v_inv -> 'lines', '[]'::jsonb) || jsonb_build_array(p_line))
  );

  v_new_revision := v_current_revision + 1;
  v_inv := v_inv || jsonb_build_object(
    'lines', coalesce(v_inv -> 'lines', '[]'::jsonb) || jsonb_build_array(p_line),
    'updatedAt', v_now_text,
    'revision', v_new_revision
  );
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$function$;
REVOKE ALL ON FUNCTION public.invoice_line_add(text, jsonb, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_line_add(text, jsonb, bigint) TO service_role;

-- invoice_line_update(text, text, jsonb, bigint)  (md5 av pg_get_functiondef i drift: 7f0112ac59fc84a8a22a4e646cf55918)
CREATE OR REPLACE FUNCTION public.invoice_line_update(p_invoice_id text, p_line_id text, p_patch jsonb, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_lines    jsonb;
  v_lidx     int;
  v_now      timestamptz;
  v_now_text text;
  v_current_revision bigint;
  v_new_revision     bigint;
  v_patch_key text;
  v_qty        numeric;
  v_unit_price numeric;
  v_vat_rate   numeric;
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
  /* R9B TEST 9 (oberoende granskning, ronda 5, Blockerare 4): `<>` med
     ett SQL NULL-operand utvärderas till UNKNOWN, inte TRUE — en
     `IF v_current_revision <> p_expected_revision THEN` hoppade då
     tyst över hela avvisningsgrenen om `p_expected_revision` råkade
     vara NULL, och tillämpade patchen OVILLKORLIGT. Edge Function-
     lagret avvisar redan ett NULL/icke-heltalsvärde INNAN RPC:n
     anropas (`parseExpectedRevision()` i invoice-write/index.ts) — men
     RPC:n ska vara FAIL-CLOSED OBEROENDE av anroparen (ett direkt
     `.rpc()`-anrop, ett framtida EF-buggfix som glömmer validera, etc.).
     `IS DISTINCT FROM` hanterar NULL korrekt på egen hand (NULL anses
     alltid skilja sig från ett konkret värde) — den explicita
     `p_expected_revision is null or`-klausulen är därför strikt
     redundant men behålls för LÄSBARHET. Samma mönster upprepas
     identiskt i SAMTLIGA sju revisionskontrollerade funktioner i denna
     fil. */
  if p_expected_revision is null or v_current_revision is distinct from p_expected_revision then
    raise exception 'stale_write';
  end if;

  if (v_inv ->> 'status') <> 'utkast' then raise exception 'not_draft'; end if;

  v_lines := coalesce(v_inv -> 'lines', '[]'::jsonb);
  select (ord - 1)::int into v_lidx from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_line_id limit 1;
  if v_lidx is null then raise exception 'line_not_found'; end if;

  /* R9B TEST 9 (oberoende granskning, ronda 6, Blockerare 3 — verkligt
     reproducerad): `(v_lines -> v_lidx) || p_patch` slog samman
     VILKEN NYCKEL SOM HELST i `p_patch` in i raden, utan servervalidering
     — klienten (InvoiceService.updateLine()) tar visserligen bort
     `id`/`sourceId`/`source`/`sourceRefs` innan den skickar, men RPC:n
     själv litade blint på det. Ett direkt `.rpc()`-anrop (eller en
     framtida klientbugg) hade kunnat skriva om radens identitets-/
     claim-fält. FAIL-CLOSED ALLOWLIST här, server-sidigt, oberoende av
     klienten — exakt samma princip som NULL-revisionsskyddet ovan. */
  for v_patch_key in select jsonb_object_keys(p_patch) loop
    if not (v_patch_key = any(array['description','qty','unit','unitPrice','vatRate','freetext'])) then
      raise exception 'forbidden_field';
    end if;
  end loop;

  /* Minsta säkra server-sidiga sanity-validering (ronda 6): negativa
     mängder/priser och ogiltiga momssatser avvisas HÄR också, inte
     bara i klientens `_validateLineData()`. Replikerar INTE den fulla
     ROT/RUT-invariantkontrollen (`_prospectiveCheck`/`calcSummary` i
     InvoiceService.js) — det är en MEDVETEN, OFÖRÄNDRAD avgränsning
     från den ursprungliga migrationens filhuvud (se där för
     motiveringen: ingen pengar-risk i detta interna, icke kundvända
     system, och en hög risk att införa subtila räknefel genom att
     återimplementera hela beräkningsmotorn i PL/pgSQL). */
  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 2 — samma
     typkontroll som nu även tillagd i invoice_line_add, för konsistens:
     `jsonb_typeof(...) = 'number'` INNAN cast stoppar en textsträng
     som `"NaN"` som annars skulle castas till ett numeriskt NaN-värde
     som klarar `< 0`-testet (Postgres numeric NaN är inte mindre än
     0). Ingen ändring av de redan godkända gränsvärdena i övrigt. */
  if p_patch ? 'qty' then
    if jsonb_typeof(p_patch -> 'qty') <> 'number' then raise exception 'invalid_qty'; end if;
    v_qty := (p_patch->>'qty')::numeric;
    if v_qty is null or v_qty < 0 then raise exception 'invalid_qty'; end if;
    if scale(v_qty) > 3 then raise exception 'invalid_qty'; end if;
  end if;
  if p_patch ? 'unitPrice' then
    if jsonb_typeof(p_patch -> 'unitPrice') <> 'number' then raise exception 'invalid_price'; end if;
    v_unit_price := (p_patch->>'unitPrice')::numeric;
    if v_unit_price is null or v_unit_price < 0 then raise exception 'invalid_price'; end if;
    if scale(v_unit_price) > 4 then raise exception 'invalid_price'; end if;
  end if;
  if p_patch ? 'vatRate' then
    if jsonb_typeof(p_patch -> 'vatRate') <> 'number' then raise exception 'invalid_vat'; end if;
    v_vat_rate := (p_patch->>'vatRate')::numeric;
    if v_vat_rate is null or v_vat_rate < 0 or v_vat_rate > 100 then raise exception 'invalid_vat'; end if;
    if scale(v_vat_rate) > 4 then raise exception 'invalid_vat'; end if;
  end if;

  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 3 — EXAKT
     den av granskningen givna reproduktionen: en giltig revision +
     unitPrice=0 på en rad med kvarstående ROT/RUT-avdrag ⇒ negativ
     customerPays). Validerad ATOMISKT mot fakturans NYA tillstånd,
     under SAMMA radlås, INNAN skrivningen — se
     _invoice_financial_check() ovan. */
  perform public._invoice_financial_check(
    v_inv || jsonb_build_object('lines', jsonb_set(v_lines, array[v_lidx::text], (v_lines -> v_lidx) || p_patch))
  );

  v_new_revision := v_current_revision + 1;
  v_lines := jsonb_set(v_lines, array[v_lidx::text], (v_lines -> v_lidx) || p_patch);
  v_inv := v_inv || jsonb_build_object('lines', v_lines, 'updatedAt', v_now_text, 'revision', v_new_revision);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$function$;
REVOKE ALL ON FUNCTION public.invoice_line_update(text, text, jsonb, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_line_update(text, text, jsonb, bigint) TO service_role;

-- invoice_line_delete(text, text, bigint)  (md5 av pg_get_functiondef i drift: 5f5fcdc138ddfe4d059fa9b4e5043e48)
CREATE OR REPLACE FUNCTION public.invoice_line_delete(p_invoice_id text, p_line_id text, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_lines    jsonb;
  v_now      timestamptz;
  v_now_text text;
  v_current_revision bigint;
  v_new_revision     bigint;
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

  v_lines := coalesce(v_inv -> 'lines', '[]'::jsonb);
  select jsonb_agg(elem) into v_lines from jsonb_array_elements(v_lines) elem where elem ->> 'id' <> p_line_id;
  v_lines := coalesce(v_lines, '[]'::jsonb);

  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 3): en
     radborttagning kan sänka totalsumman under ett redan satt
     ROT/RUT-avdrag precis lika väl som en radredigering — samma
     atomiska kontroll, under samma radlås, innan skrivningen. */
  perform public._invoice_financial_check(v_inv || jsonb_build_object('lines', v_lines));

  v_new_revision := v_current_revision + 1;
  v_inv := v_inv || jsonb_build_object('lines', v_lines, 'updatedAt', v_now_text, 'revision', v_new_revision);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$function$;
REVOKE ALL ON FUNCTION public.invoice_line_delete(text, text, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_line_delete(text, text, bigint) TO service_role;

-- invoice_discount_set(text, jsonb, bigint)  (md5 av pg_get_functiondef i drift: 9752f920b3494ac02dd256dc1680da80)
CREATE OR REPLACE FUNCTION public.invoice_discount_set(p_invoice_id text, p_discount jsonb, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_now      timestamptz;
  v_now_text text;
  v_current_revision bigint;
  v_new_revision     bigint;
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  v_now := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then raise exception 'not_found'; end if;
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

  /* R9B TEST 9 (ronda 6): minsta server-sidiga sanity på rabatt-
     objektets struktur — typ måste vara ett av de giltiga värdena,
     värdet icke-negativt (och <=100 om procent). Replikerar INTE den
     fulla ROT/RUT-invarianten (medvetet, se invoice_line_update()). */
  if not (p_discount ->> 'type' = any(array['none','percent','fixed'])) then
    raise exception 'invalid_discount_type';
  end if;
  if (p_discount ->> 'value')::numeric is null
     or (p_discount ->> 'value')::numeric = 'NaN'::numeric
     or (p_discount ->> 'value')::numeric < 0 then
    raise exception 'invalid_discount_value';
  end if;
  if p_discount ->> 'type' = 'percent' and (p_discount ->> 'value')::numeric > 100 then
    raise exception 'invalid_discount_value';
  end if;

  /* R9B FINAL (sista riktade korrigeringen, Punkt 1 — verkligt
     reproducerad): ett FAST rabattbelopp med MER än två decimaler
     (t.ex. 0,005 kr) gav tidigare olika resultat i JS och SQL,
     eftersom SQL (till skillnad från JS) aldrig rundade det fasta
     beloppet separat innan det drogs av från radsumman — bara
     SLUTSUMMAN rundades. Grundorsaken var en SAKNAD gemensam
     affärsregel, inte en flyttalsbugg: svensk valuta saknar en
     denomination mindre än ett öre, så ett sådant belopp är i sig
     inte en giltig affärshändelse. Avvisas nu HÄR, konsekvent, med
     samma kontroll som klienten (InvoiceService.setDiscount()) gör —
     `(value * 100)` måste vara ett heltal. */
  if p_discount ->> 'type' = 'fixed' and scale((p_discount ->> 'value')::numeric) > 2 then
    raise exception 'invalid_discount_value';
  end if;

  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 3): den
     fulla finansiella invarianten valideras nu ATOMISKT mot fakturans
     NYA tillstånd, under SAMMA radlås (se _invoice_financial_check()
     ovan) — INNAN skrivningen. En rabattändring som skulle sänka
     totalsumman under ett redan satt ROT/RUT-avdrag (negativ
     kundbetalning) avvisas här, oavsett om den enskilda
     rabattvalideringen ovan annars skulle godkänna den. */
  perform public._invoice_financial_check(
    v_inv || jsonb_build_object('discount', p_discount)
  );

  v_new_revision := v_current_revision + 1;
  v_inv := v_inv || jsonb_build_object('discount', p_discount, 'updatedAt', v_now_text, 'revision', v_new_revision);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$function$;
REVOKE ALL ON FUNCTION public.invoice_discount_set(text, jsonb, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_discount_set(text, jsonb, bigint) TO service_role;

-- invoice_tax_reduction_set(text, jsonb, bigint)  (md5 av pg_get_functiondef i drift: fd98f01b4db586553fa06be00d260c5d)
CREATE OR REPLACE FUNCTION public.invoice_tax_reduction_set(p_invoice_id text, p_tax_reduction jsonb, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_now      timestamptz;
  v_now_text text;
  v_current_revision bigint;
  v_new_revision     bigint;
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  v_now := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then raise exception 'not_found'; end if;
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

  /* R9B TEST 9 (ronda 6): samma minsta sanity-nivå som discount_set.
     Replikerar INTE den fulla ROT/RUT-invarianten (medvetet). */
  if not (p_tax_reduction ->> 'type' = any(array['none','rot','rut'])) then
    raise exception 'invalid_tax_type';
  end if;
  if (p_tax_reduction ->> 'amount')::numeric is null
     or (p_tax_reduction ->> 'amount')::numeric = 'NaN'::numeric
     or (p_tax_reduction ->> 'amount')::numeric < 0 then
    raise exception 'invalid_tax_amount';
  end if;
  if (p_tax_reduction ->> 'basis')::numeric is null
     or (p_tax_reduction ->> 'basis')::numeric = 'NaN'::numeric
     or (p_tax_reduction ->> 'basis')::numeric < 0 then
    raise exception 'invalid_tax_basis';
  end if;
  /* R9B FINAL (sista precisionskontrollen): ROT/RUT-belopp är riktiga
     penningbelopp i SEK — samma dokumenterade 2-decimalersgräns som
     fast rabatt, för en KONSEKVENT affärsregel (gäller bara när ett
     faktiskt avdrag sätts — 'none' har redan amount/basis=0,
     scale 0). */
  if p_tax_reduction ->> 'type' in ('rot', 'rut') then
    if scale((p_tax_reduction ->> 'amount')::numeric) > 2 then raise exception 'invalid_tax_amount'; end if;
    if scale((p_tax_reduction ->> 'basis')::numeric) > 2 then raise exception 'invalid_tax_basis'; end if;
  end if;

  /* R9B TEST 9 (oberoende granskning, ronda 7, Blockerare 3 — EXAKT
     den av granskningen givna reproduktionen: qty=1, unitPrice=100→0,
     vatRate=25, ROT amount=100 kvarstående ⇒ customerPays=-100). Samma
     atomiska, radlås-skyddade kontroll som i invoice_discount_set. */
  perform public._invoice_financial_check(
    v_inv || jsonb_build_object('taxReduction', p_tax_reduction)
  );

  v_new_revision := v_current_revision + 1;
  v_inv := v_inv || jsonb_build_object('taxReduction', p_tax_reduction, 'updatedAt', v_now_text, 'revision', v_new_revision);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$function$;
REVOKE ALL ON FUNCTION public.invoice_tax_reduction_set(text, jsonb, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_tax_reduction_set(text, jsonb, bigint) TO service_role;

-- invoice_meta_update(text, jsonb, bigint)  (md5 av pg_get_functiondef i drift: af2a504bd183b50a5f374d866cd44a74)
CREATE OR REPLACE FUNCTION public.invoice_meta_update(p_invoice_id text, p_patch jsonb, p_expected_revision bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoices jsonb;
  v_idx      int;
  v_inv      jsonb;
  v_safe     jsonb := '{}'::jsonb;
  v_now      timestamptz;
  v_now_text text;
  v_current_revision bigint;
  v_new_revision     bigint;
begin
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
  v_now := clock_timestamp();
  v_now_text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if v_invoices is null or jsonb_typeof(v_invoices) <> 'array' then raise exception 'not_found'; end if;
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

  if p_patch ? 'customerReference' then v_safe := v_safe || jsonb_build_object('customerReference', p_patch->>'customerReference'); end if;
  if p_patch ? 'ocr' then v_safe := v_safe || jsonb_build_object('ocr', p_patch->>'ocr'); end if;
  if p_patch ? 'note' then v_safe := v_safe || jsonb_build_object('note', p_patch->>'note'); end if;

  v_new_revision := v_current_revision + 1;
  v_inv := v_inv || v_safe || jsonb_build_object('updatedAt', v_now_text, 'revision', v_new_revision);
  v_invoices := jsonb_set(v_invoices, array[v_idx::text], v_inv);
  update public.store set value = v_invoices, updated_at = v_now where key = 'vift_invoices';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;
  return jsonb_build_object('invoice', v_inv, 'serverSignature', v_now_text);
end;
$function$;
REVOKE ALL ON FUNCTION public.invoice_meta_update(text, jsonb, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoice_meta_update(text, jsonb, bigint) TO service_role;

commit;
