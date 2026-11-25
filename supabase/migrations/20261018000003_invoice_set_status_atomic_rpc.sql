-- ============================================================
-- ÅTERSTÄLLD 2026-11-27 ur STAGING:s migrationshistorik (G1/G4 del 2).
-- Källa: supabase_migrations.schema_migrations, version 20261018000003, i STAGING
-- (yyzljlqyzzcbxmcdbual). Allt efter markören INNEHÅLL nedan, fram till
-- den avslutande raden ";", är EXAKT array_to_string(statements, E';\n')
-- (md5 086cd3253529b5098c4f2fbc00ddf90c, samma fil som
-- inventering/staging-2026-11-26/migrations-applicerade/20261018000003_invoice_set_status_atomic_rpc.sql).
-- Supabase CLI sparar statements utan avslutande semikolon; ett ";" har
-- därför lagts till sist. Ingen annan ändring.
-- ============================================================
-- INNEHÅLL
-- ============================================================
-- Migration: Atomisk RPC för fakturastatus-övergångar (vift_invoices)
-- Datum:     2026-10-18 (P0 PART B — INVOICE PAYMENT-STATUS R1)
-- Syfte:     Eliminera det verifierade "läs hela invoices-arrayen, ändra
--            EN fakturas status i minnet, skriv hela arrayen tillbaka"-
--            racet mellan SAMTIDIGA skrivare (fakturaansvarig + kontors-
--            personal, båda med `invoice_create`, som kan ändra status
--            på OLIKA fakturor inom samma kort tidsfönster) — EXAKT
--            samma generella buggklass som redan åtgärdats för AO/tid
--            (Part A), vift_projectDocuments och vift_ronderingspass
--            (Part B, se tidigare migrationer i denna katalog).
--
--            SCOPE-BESLUT (medvetet, se README §2 för full motivering):
--            denna migration fixar ENDAST InvoiceService.setStatus() —
--            den konkreta, flaggade risken (betalningsstatus-ändringar).
--            Den rör INTE addLine/updateLine/deleteLine/deleteDraft/
--            setDiscount/setTaxReduction/updateMeta/createBlank/
--            createFromAO, som alla förblir på den generiska
--            persist()-vägen. `vift_invoices` är DÄRFÖR INTE exkluderad
--            ur state.js _doPersist(), och INGEN RLS-lockdown läggs till
--            här — SAMMA medvetna, redan etablerade avgränsning som
--            20260917000001_work_order_checklist_atomic_rpc.sql gjorde
--            för vift_workOrders (se dess filhuvud: "INGA nya
--            RESTRICTIVE-policyer... workOrders förblir den GENERISKA
--            skrivvägen för MÅNGA ANDRA, obesläktade mutationer").
--            Skyddet denna migration ger: EXAKT statusövergången
--            (inkl. återaktiverings-kollisionskontrollen, replikerad
--            här från BillingQueueService.claimedByOtherActiveInvoices())
--            blir atomisk och race-fri SÅ LÄNGE båda klienterna använder
--            denna väg för just setStatus() (vilket frontend-ändringen i
--            samma leverans gör) — INTE ett fullständigt skydd mot ALLA
--            invoices-mutationer. Dokumenterat kvarvarande-risk, inte en
--            bortglömd lucka (se README §5).
--
--            MEDVETET UTELÄMNAT: reconcileWorkOrderBilling(aoId)-
--            sidoeffekten (BillingQueueService, körs vid makulering/
--            återaktivering) rör `vift_workOrders`/`ao.materials[]` —
--            en annan nyckel, redan separat skyddad/hanterad av Part A:s
--            AO-arbete. Denna RPC gör ENDAST fakturastatus-mutationen;
--            anroparen (InvoiceService.setStatus(), se diff) fortsätter
--            köra reconcileWorkOrderBilling() client-side EFTER ett
--            lyckat RPC-svar, oförändrad — den körs bara vid cancel/
--            reactivate (inte vid vanlig skickad→betald), och dess EGEN
--            datakonsekvens hör till AO-sidans redan separat bedömda
--            riskprofil, inte denna.
--
--            Samma arkitekturmönster som tidigare: SELECT...FOR UPDATE,
--            stabilt id (aldrig array-index), SECURITY DEFINER +
--            REVOKE/GRANT service_role-only, vift_lastChanged bumpas
--            inom samma transaktion, och — likt work_order_checklist_
--            resolve — en kanonisk activityLog-post skapas HÄR (samma
--            låsordning: invoices FÖRE activityLog) så att en samtidig
--            andra anropare aldrig kan radera den via en efterföljande
--            generisk persist().
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.invoice_set_status(text, text, text);
-- ============================================================

create or replace function public.invoice_set_status(
  p_invoice_id text,
  p_status     text,
  p_actor_id   text default null  -- server-härlett av EF från JWT — aldrig klient-inskickat
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoices    jsonb;
  v_idx         int;
  v_inv         jsonb;
  v_prev        text;
  v_allowed     text[];
  v_reactivating boolean := false;
  v_source_aware boolean;
  v_collision   boolean := false;
  v_now         timestamptz := clock_timestamp();
  v_now_text    text := to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_activity_log jsonb;
  v_new_activity jsonb;
  v_actlog_id   text;
begin
  if p_status not in ('utkast', 'skickad', 'betald', 'förfallen', 'makulerad') then
    raise exception 'invalid_status';
  end if;

  -- ── 1) Lås EXAKT vift_invoices-raden ──────────────────────────────
  select value into v_invoices from public.store where key = 'vift_invoices' for update;
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

  if p_status = v_prev then
    return jsonb_build_object('invoice', v_inv, 'changed', false, 'serverSignature', v_now_text);
  end if;

  -- ── 2) SAMMA övergångstabell som InvoiceService.STATUS_TRANSITIONS
  --      (JS-sidan, oförändrad) — replikerad här så att den FAKTISKA,
  --      låsta serverraden avgör, inte klientens påstådda prevStatus. ──
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

  -- ── 3) Återaktiverings-kollisionskontroll — replikerad HÄR, mot den
  --      LÅSTA raden, från BillingQueueService.claimedByOtherActiveInvoices()
  --      (JS-sidan, oförändrad; se dess kommentar för varför denna
  --      kontroll existerar). Ingen TOCTOU-lucka mot en separat,
  --      tidigare klientläsning. ────────────────────────────────────
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

  -- ── 4) Tillämpa mutationen — SAMMA semantik som InvoiceService.
  --      setStatus() (oförändrad): paidAt/sentAt sätts, reaktivering
  --      nollställer båda. ───────────────────────────────────────────
  v_inv := v_inv || jsonb_build_object('status', p_status, 'updatedAt', v_now_text);
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

  -- ── 5) Kanonisk activityLog-post, i SAMMA transaktion (deterministisk
  --      låsordning: invoices FÖRE activityLog, samma mönster som
  --      20260917000001). ───────────────────────────────────────────
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

  -- ── 6) Bumpa DataSync-synksignalen inom samma transaktion ─────────
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_text))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  return jsonb_build_object(
    'invoice', v_inv, 'prevStatus', v_prev, 'changed', true,
    'activityLog', v_activity_log, 'serverSignature', v_now_text
  );
end;
$$;
-- ── Behörigheter: ENDAST service_role ────────────────────────────────
revoke all on function public.invoice_set_status(text, text, text) from public, anon, authenticated;
grant execute on function public.invoice_set_status(text, text, text) to service_role;
-- ── Verifiering (körs manuellt efter migrering) ──────────────────────
-- SELECT proname, proacl FROM pg_proc WHERE proname = 'invoice_set_status';
-- Förväntat: EXECUTE endast beviljat till service_role.
;
