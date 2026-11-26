-- =====================================================================
-- VIFT CRM — T3-E standardroller (M9, D-02): C. Rollback av en journalförd ändring med expectedHash (KRÄVER GO)
-- Genererad av vift-v2 tests/local/t3e-skript.js ur standardroller.json (t4a-2026-11-28). Ändra inte för hand.
-- Körs i Supabase SQL Editor för STAGING (yyzljlqyzzcbxmcdbual) FÖRST efter separat GO.
-- ALDRIG mot LIVE utan en egen LIVE-plan. Ingår INTE i migrationskedjan (inte db push).
-- Återställer rollregistrets förevärde för EN journalrad (från B eller D), i omvänd ordning.
-- STOP (inget ändras) om rollregistret ändrats efter journalraden (aktuell hash ≠ journalens
--   efter_hash): nyare ändringar skrivs aldrig över; om raden redan är återställd; om någon
--   personalpost (aktiv eller inaktiv) har ett roll-id som raden lade till.
-- Personalregistret ändras aldrig. Rollbacken journalförs.
-- =====================================================================

-- Rad 1: fyll i journalradens id (del A, A7). Lämnas platshållaren kvar stoppas skriptet.
select set_config('vift.t3e_journal_id', 'FYLL_I_JOURNAL_ID', false);

begin;
do $$
declare
  v_id text := current_setting('vift.t3e_journal_id', true);
  v_j vift_t3e_journal.rollregister%rowtype;
  v_roles jsonb; v_staff jsonb; v_hash text; v_ref text[]; v_super_fore int; v_super_efter int; v_jid bigint;
begin
  if v_id is null or v_id !~ '^[0-9]+$' then
    raise exception 'T3-E STOP: journalradens id saknas (fyll i rad 1) — inget ändrat';
  end if;
  select * into v_j from vift_t3e_journal.rollregister where id = v_id::bigint;
  if not found or v_j.steg like 'rollback:%' then
    raise exception 'T3-E STOP: journalrad % finns inte eller är själv en rollback — inget ändrat', v_id;
  end if;
  if exists (select 1 from vift_t3e_journal.rollregister where steg = 'rollback:' || v_id) then
    raise exception 'T3-E STOP: journalrad % är redan återställd — inget ändrat', v_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('vift:roles+staff', 0));
  select value into v_roles from public.store where key = 'vift_roles' for update;
  select value into v_staff from public.store where key = 'vift_staff' for update;
  if v_roles is null or jsonb_typeof(v_roles) <> 'array' then
    raise exception 'T3-E STOP: vift_roles saknas eller är inte en lista — inget ändrat';
  end if;
  if v_staff is null or jsonb_typeof(v_staff) <> 'array' then
    raise exception 'T3-E STOP: vift_staff saknas eller är inte en lista — inget ändrat';
  end if;
  v_hash := encode(sha256(convert_to(v_roles::text, 'UTF8')), 'hex');
  if v_hash <> v_j.efter_hash then
    raise exception 'T3-E STOP: rollregistret har ändrats efter journalrad % (hash % ≠ %) — nyare ändringar skrivs aldrig över; inget ändrat', v_id, v_hash, v_j.efter_hash;
  end if;
  if encode(sha256(convert_to(v_j.fore_varde::text, 'UTF8')), 'hex') <> v_j.fore_hash then
    raise exception 'T3-E STOP: journalens förevärde stämmer inte med sin hash — inget ändrat';
  end if;
  select coalesce(array_agg(distinct s->>'role'), '{}') into v_ref from jsonb_array_elements(v_staff) s where s->>'role' = any(v_j.tillagda_roller);
  if array_length(v_ref, 1) > 0 then
    raise exception 'T3-E STOP: personal har tilldelats roll som rollbacken skulle ta bort (%) — inget ändrat', array_to_string(v_ref, ', ');
  end if;
  if to_regprocedure('public._vift_superadmin_count(jsonb,jsonb)') is not null then
    execute 'select public._vift_superadmin_count($1, $2)' into v_super_fore using v_staff, v_roles;
  end if;
  update public.store set value = v_j.fore_varde, updated_at = now() where key = 'vift_roles';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    on conflict (key) do update set value = excluded.value, updated_at = now(); -- som RPC:erna: öppna klienter läser om
  v_roles := v_j.fore_varde;
  if to_regprocedure('public._vift_superadmin_count(jsonb,jsonb)') is not null then
    execute 'select public._vift_superadmin_count($1, $2)' into v_super_efter using v_staff, v_roles;
  end if;
  if v_super_fore is distinct from v_super_efter then
    raise exception 'T3-E STOP: antalet superadministratörer skulle ändras (% → %) — inget ändrat', v_super_fore, v_super_efter;
  end if;
  insert into vift_t3e_journal.rollregister(steg, fore_hash, efter_hash, fore_varde, efter_varde, personal_hash, kommentar)
  values ('rollback:' || v_id, v_hash, v_j.fore_hash, v_j.efter_varde, v_j.fore_varde, encode(sha256(convert_to(v_staff::text, 'UTF8')), 'hex'), 'återställt förevärdet för journalrad ' || v_id)
  returning id into v_jid;
  raise notice 'T3-E: rollback av journalrad % klar (journalrad %), rollregistrets hash nu %', v_id, v_jid, v_j.fore_hash;
end $$;
commit;
