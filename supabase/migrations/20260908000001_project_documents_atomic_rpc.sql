-- ============================================================
-- Migration: Atomiska RPC-funktioner för vift_projectDocuments
-- Datum:     2026-09-08 (V54C1 R1 — Production Hardening)
-- Syfte:     Eliminera "läs hela arrayen, ändra, skriv hela arrayen"-
--            racet mellan SAMTIDIGA Edge Function-anrop mot samma
--            `store`-rad (§Blockerare 4). Två samtidiga uppladdningar,
--            eller en uppladdning som krockar med en metadata-ändring,
--            kunde tidigare tysta radera varandras resultat ("sista
--            skrivaren vinner" på en HEL array).
--
--            Detta är Option B ur R1-uppdraget: "transactional Postgres
--            RPC/functions that atomically append/update/delete one
--            document under row locking" — INTE en ny tabell (Option A)
--            eftersom den generiska `store`-läsvägen (DataSync-polling,
--            Storage.getAll()) medvetet behålls oförändrad för Projekt-
--            dokument i denna runda; endast SKRIVvägen görs atomisk och
--            flyttas uteslutande till dessa RPC:er + Edge Functionerna.
--
--            Varje funktion tar en radlåsning (`SELECT ... FOR UPDATE`)
--            på EXAKT `store`-raden med key='vift_projectDocuments'
--            innan den läser/ändrar/skriver arrayen, inom EN transaktion
--            (en enda RPC-anrop = en enda transaktion). Postgres radlås
--            serialiserar automatiskt konkurrerande anrop — den andra
--            transaktionen blockerar tills den första committat, och
--            läser DÅ det redan uppdaterade värdet. Ingen förlorad rad
--            är möjlig genom dessa funktioner, oavsett hur många
--            samtidiga Edge Function-anrop som körs.
--
--            SECURITY DEFINER + explicit REVOKE/GRANT: endast
--            `service_role` (dvs Edge Functions, som redan är den enda
--            skrivvägen i denna arkitektur) kan anropa dem. anon/
--            authenticated har INGEN direkt åtkomst — exakt samma
--            princip som RLS på `store`-tabellen i övrigt.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.project_documents_append(jsonb);
--   DROP FUNCTION IF EXISTS public.project_documents_update_one(text, text, jsonb);
--   DROP FUNCTION IF EXISTS public.project_documents_finalize_delete(text, text);
-- ============================================================

-- ── Append: lägg till ETT nytt dokument atomiskt ────────────────────
create or replace function public.project_documents_append(p_new_doc jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_arr jsonb;
begin
  /* Säkerställ att raden existerar INNAN vi låser den — SELECT ... FOR
     UPDATE på en rad som inte finns låser ingenting. */
  insert into public.store(key, value) values ('vift_projectDocuments', '[]'::jsonb)
    on conflict (key) do nothing;

  select value into v_arr from public.store where key = 'vift_projectDocuments' for update;
  if v_arr is null or jsonb_typeof(v_arr) <> 'array' then
    v_arr := '[]'::jsonb;
  end if;

  v_arr := v_arr || jsonb_build_array(p_new_doc);
  update public.store set value = v_arr, updated_at = now() where key = 'vift_projectDocuments';
  return p_new_doc;
end;
$$;

-- ── Update: slå ihop `patch` in i ETT dokument, atomiskt + ägarkontroll
--    §Blockerare 1 (försvar i djupled): `p_expected_project_id` MÅSTE
--    matcha dokumentets EGEN lagrade projectId, annars 'forbidden'. ──
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
  return v_updated;
end;
$$;

-- ── Finalize-delete: markera ETT dokument inaktivt, atomiskt +
--    ägarkontroll. Anropas ENDAST av Edge Function EFTER att den
--    faktiska lagringsobjekt-borttagningen redan lyckats (§Blockerare 2
--    — se project-document-upload/index.ts: om Storage.remove()
--    misslyckas anropas denna funktion ALDRIG, och metadata förblir
--    aktiv). ──
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
  return v_updated;
end;
$$;

-- ── Behörigheter: ENDAST service_role (samma princip som RLS på store)
revoke all on function public.project_documents_append(jsonb) from public, anon, authenticated;
revoke all on function public.project_documents_update_one(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.project_documents_finalize_delete(text, text) from public, anon, authenticated;

grant execute on function public.project_documents_append(jsonb) to service_role;
grant execute on function public.project_documents_update_one(text, text, jsonb) to service_role;
grant execute on function public.project_documents_finalize_delete(text, text) to service_role;

-- ── Verifiering (körs manuellt efter migrering) ─────────────────────
-- SELECT proname, proacl FROM pg_proc WHERE proname LIKE 'project_documents_%';
-- Förväntat: EXECUTE endast beviljat till service_role.
