-- ============================================================
-- Migration: R2 — vift_lastChanged-synksignal + databas-nivå
--            skrivskydd på vift_projectDocuments
-- Datum:     2026-09-08 (V54C1 R2 — Release Final)
-- Beror på:  20260908000001_project_documents_atomic_rpc.sql
--            (definierar project_documents_append/update_one/
--            finalize_delete som denna migration bygger vidare på)
--            samt den redan existerande store-RLS-modellen i
--            supabase/migrations/20260720000005_store_key_rls.sql
--            (policyerna `store_active_write_safe`/`store_admin_
--            write_protected`/`store_active_read`).
--
-- ── Del A — Blockerare 1: DataSync-kontraktet bröts ─────────────────
-- R1:s tre RPC-funktioner muterade `vift_projectDocuments` atomiskt
-- men uppdaterade ALDRIG `vift_lastChanged` — den lättviktsnyckel
-- `DataSync._poll()` (var 15:e sekund) jämför mot för att avgöra om en
-- fjärruppdatering överhuvudtaget existerar (se state.js `_poll()`:
-- `if (!sig || sig === DataSync._lastSig) return;`). En annan enhet
-- kunde därför missa ett uppladdat/ändrat/borttaget Projekt-dokument
-- tills en HELT OBESLÄKTAD vanlig CRM-sparning råkade ändra
-- `lastChanged` av en annan anledning.
--
-- Fix: alla tre RPC-funktioner definieras om (CREATE OR REPLACE,
-- SAMMA signatur/kontrakt som R1 — endast kroppen utökas) så att de,
-- EFTER en lyckad dokumentmutation, UPSERTar `vift_lastChanged` MED
-- EN FRÄSCH TIDSSTÄMPEL INOM SAMMA TRANSAKTION/FUNKTIONSANROP. Ingen
-- andra, icke-atomisk REST-skrivning görs av Edge Function:en efteråt
-- — RPC-anropet ÄR transaktionsgränsen, exakt som uppdraget kräver.
--
-- ── Del B — Blockerare 2: "enda skrivare" inte databasdurkraftad ───
-- R1 tog bort `projectDocuments` ur frontendens generiska
-- `_doPersist()`-skrivning (applikationsnivå-disciplin), men en
-- autentiserad klient kunde ALLTJÄMT skriva `vift_projectDocuments`
-- direkt via vanligt REST-anrop, eftersom den befintliga
-- `store_active_write_safe`-policyn (se 20260720000005) tillåter
-- ALLA nycklar UTOM `vift_roles`/`vift_staff`/`vift_settings`.
--
-- Fix: tre nya RESTRICTIVE-policyer (INSERT/UPDATE/DELETE, roll
-- `authenticated`) som kombineras med AND mot alla PERMISSIVE-policyer
-- (Postgres RLS-semantik: effektiv åtkomst = (OR av permissive) AND
-- (AND av restrictive)). Dessa blockerar ENDAST direkt klient-REST-
-- mutation av `vift_projectDocuments` — övriga nycklar och SELECT
-- (läsning, som DataSync/`Storage.getAll()` behöver) är HELT
-- opåverkade. `service_role` (Edge Functions/RPC:er, SECURITY DEFINER
-- körs som funktionens ägare) omfattas inte av `TO authenticated`-
-- policyer och fortsätter fungera oförändrat.
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS "store_project_documents_no_direct_insert" ON public.store;
--   DROP POLICY IF EXISTS "store_project_documents_no_direct_update" ON public.store;
--   DROP POLICY IF EXISTS "store_project_documents_no_direct_delete" ON public.store;
--   -- Återställ RPC-funktionerna till R1:s definition (utan
--   -- lastChanged-uppsättningen) genom att köra om
--   -- 20260908000001_project_documents_atomic_rpc.sql:s CREATE OR
--   -- REPLACE-block.
-- ============================================================

-- ── Del A: RPC-funktioner omdefinierade med atomisk lastChanged-bump

create or replace function public.project_documents_append(p_new_doc jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_arr jsonb;
  v_now_sig text;
begin
  insert into public.store(key, value) values ('vift_projectDocuments', '[]'::jsonb)
    on conflict (key) do nothing;

  select value into v_arr from public.store where key = 'vift_projectDocuments' for update;
  if v_arr is null or jsonb_typeof(v_arr) <> 'array' then
    v_arr := '[]'::jsonb;
  end if;

  v_arr := v_arr || jsonb_build_array(p_new_doc);
  update public.store set value = v_arr, updated_at = now() where key = 'vift_projectDocuments';

  /* R2 §Blockerare 1 — bumpa DataSync-synksignalen INOM SAMMA
     transaktion som dokumentmutationen. clock_timestamp() (inte now())
     används medvetet för en fräsch, mutation-specifik tidsstämpel. */
  v_now_sig := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_sig))
    on conflict (key) do update set value = excluded.value, updated_at = now();

  return p_new_doc;
end;
$$;

create or replace function public.project_documents_update_one(
  p_doc_id text,
  p_expected_project_id text,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_arr jsonb;
  v_idx int;
  v_doc jsonb;
  v_updated jsonb;
  v_now_sig text;
begin
  select value into v_arr from public.store where key = 'vift_projectDocuments' for update;
  if v_arr is null then
    raise exception 'not_found';
  end if;

  select (ord - 1) into v_idx
    from jsonb_array_elements(v_arr) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_doc_id
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;

  v_doc := v_arr -> v_idx;
  if (v_doc ->> 'projectId') is distinct from p_expected_project_id then
    raise exception 'forbidden';
  end if;

  v_updated := (v_doc || p_patch) || jsonb_build_object('updatedAt', to_jsonb(now()::text));
  v_arr := jsonb_set(v_arr, array[v_idx::text], v_updated);
  update public.store set value = v_arr, updated_at = now() where key = 'vift_projectDocuments';

  /* R2 §Blockerare 1 */
  v_now_sig := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_sig))
    on conflict (key) do update set value = excluded.value, updated_at = now();

  return v_updated;
end;
$$;

create or replace function public.project_documents_finalize_delete(
  p_doc_id text,
  p_expected_project_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_arr jsonb;
  v_idx int;
  v_doc jsonb;
  v_updated jsonb;
  v_now_sig text;
begin
  select value into v_arr from public.store where key = 'vift_projectDocuments' for update;
  if v_arr is null then
    raise exception 'not_found';
  end if;

  select (ord - 1) into v_idx
    from jsonb_array_elements(v_arr) with ordinality as t(elem, ord)
    where elem ->> 'id' = p_doc_id
    limit 1;
  if v_idx is null then
    raise exception 'not_found';
  end if;

  v_doc := v_arr -> v_idx;
  if (v_doc ->> 'projectId') is distinct from p_expected_project_id then
    raise exception 'forbidden';
  end if;

  v_updated := v_doc || jsonb_build_object('active', false, 'deletedAt', to_jsonb(now()::text));
  v_arr := jsonb_set(v_arr, array[v_idx::text], v_updated);
  update public.store set value = v_arr, updated_at = now() where key = 'vift_projectDocuments';

  /* R2 §Blockerare 1 */
  v_now_sig := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(v_now_sig))
    on conflict (key) do update set value = excluded.value, updated_at = now();

  return v_updated;
end;
$$;

-- Behörigheter oförändrade (redan satta i 20260908000001, men satta
-- om här för idempotens om denna fil körs isolerat mot en databas där
-- 00001 redan kört):
revoke all on function public.project_documents_append(jsonb) from public, anon, authenticated;
revoke all on function public.project_documents_update_one(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.project_documents_finalize_delete(text, text) from public, anon, authenticated;
grant execute on function public.project_documents_append(jsonb) to service_role;
grant execute on function public.project_documents_update_one(text, text, jsonb) to service_role;
grant execute on function public.project_documents_finalize_delete(text, text) to service_role;


-- ── Del B: RESTRICTIVE-policyer — databas-nivå enforcement av
--    "endast Edge Function/RPC får skriva vift_projectDocuments" ────
-- OBS: RESTRICTIVE policyer ANDas med ALLA tillämpliga PERMISSIVE-
-- policyer (t.ex. store_active_write_safe). De lägger ALDRIG till ny
-- åtkomst, bara begränsar. Ingen SELECT-policy läggs till här — läsning
-- (DataSync, Storage.getAll()) är HELT oförändrad.

drop policy if exists "store_project_documents_no_direct_insert" on public.store;
create policy "store_project_documents_no_direct_insert"
  on public.store
  as restrictive
  for insert
  to authenticated
  with check (key <> 'vift_projectDocuments');

drop policy if exists "store_project_documents_no_direct_update" on public.store;
create policy "store_project_documents_no_direct_update"
  on public.store
  as restrictive
  for update
  to authenticated
  using (key <> 'vift_projectDocuments')
  with check (key <> 'vift_projectDocuments');

drop policy if exists "store_project_documents_no_direct_delete" on public.store;
create policy "store_project_documents_no_direct_delete"
  on public.store
  as restrictive
  for delete
  to authenticated
  using (key <> 'vift_projectDocuments');

-- ── Verifiering (kör i SQL Editor efter migrering) ──────────────────
--
-- 1. Policyer finns och är RESTRICTIVE:
--      SELECT policyname, cmd, permissive, roles FROM pg_policies
--        WHERE tablename = 'store' AND policyname LIKE 'store_project_documents_%';
--      → 3 rader, permissive = 'RESTRICTIVE' (Postgres visar detta som
--        'PERMISSIVE'='f' i pg_policies.polpermissive, eller kolumnen
--        'permissive' = 'RESTRICTIVE' i pg_policies-vyn)
--
-- 2. En vanlig, oskyddad nyckel går fortfarande att skriva direkt
--    (t.ex. vift_customers) som en aktiv, icke-admin autentiserad
--    användare — RESTRICTIVE-policyerna påverkar ENDAST
--    vift_projectDocuments:
--      SET ROLE authenticated;
--      SET LOCAL request.jwt.claims = '{"sub":"<uid-av-aktiv-anvandare>"}';
--      UPDATE store SET value = value WHERE key = 'vift_customers';
--      → lyckas (0 eller fler rader, ingen policy-avvisning)
--      RESET ROLE;
--
-- 3. Direkt autentiserad UPDATE/INSERT/DELETE av vift_projectDocuments
--    nekas:
--      SET ROLE authenticated;
--      SET LOCAL request.jwt.claims = '{"sub":"<uid-av-aktiv-anvandare>"}';
--      UPDATE store SET value = '[]'::jsonb WHERE key = 'vift_projectDocuments';
--      → 0 rader uppdaterade (RESTRICTIVE-policyn blockerar)
--      RESET ROLE;
--
-- 4. service_role (Edge Functions/RPC) fortsätter fungera oförändrat
--    — service_role-anslutningar omfattas inte av `TO authenticated`-
--    policyer, och RPC-funktionerna körs SECURITY DEFINER (som
--    funktionens ägare, normalt en superuser-liknande migrations-roll
--    som redan har bypassrls):
--      SELECT * FROM project_documents_append('{"id":"smoke-test"}'::jsonb);
--      → lyckas, och en efterföljande SELECT på vift_lastChanged visar
--        en NY tidsstämpel (se punkt 5)
--
-- 5. En Projekt-dokument-mutation bumpar vift_lastChanged (manuell
--    post-deploy-verifiering, kräver en riktig mutation via UI/EF):
--      SELECT value FROM store WHERE key = 'vift_lastChanged';
--      -- notera värdet, gör sedan en uppladdning/redigering/borttagning
--      -- av ett Projekt-dokument via appen, kör om samma SELECT:
--      SELECT value FROM store WHERE key = 'vift_lastChanged';
--      → värdet ska ha ändrats, UTAN att någon annan CRM-post rörts
