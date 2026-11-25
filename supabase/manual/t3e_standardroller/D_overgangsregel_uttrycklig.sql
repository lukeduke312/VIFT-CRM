-- =====================================================================
-- VIFT CRM — T3-E standardroller (M9, D-02): D. Övergångsregeln: gör en befintlig rolls effektiva AO-behörigheter uttryckliga (KRÄVER GO PER ROLL)
-- Genererad av vift-v2 tests/local/t3e-skript.js ur standardroller.json (t3e-2026-11-28). Ändra inte för hand.
-- Körs i Supabase SQL Editor för STAGING (yyzljlqyzzcbxmcdbual) FÖRST efter separat GO.
-- ALDRIG mot LIVE utan en egen LIVE-plan. Ingår INTE i migrationskedjan (inte db push).
-- För EN roll som i dag får ao_start_own, ao_complete_own, ao_pool_take genom övergångsregeln (testplanen §4.6):
--   ao_complete utan ao_view_all/ao_edit/all och utan någon av de tre. Lägger till exakt de tre.
--   Rollens effektiva åtkomst är densamma före och efter (bevisat lokalt, t3e_installation).
--   Inga andra behörigheter ändras, ingen roll tas bort, personalregistret ändras aldrig.
-- STOP (inget ändras) om hashen inte stämmer, rollen saknas/är dubblerad, eller regeln inte gäller rollen.
-- Journal: vift_t3e_journal.rollregister. Rollback: C_rollback.sql med journalradens id.
-- =====================================================================

-- Rad 1: rollens id. Rad 2: rollregistrets hash från del A (A2).
select set_config('vift.t3e_roll', 'FYLL_I_ROLL_ID', false);
select set_config('vift.t3e_forvantad_hash', 'FYLL_I_HASH_FRAN_DEL_A', false);

begin;
do $$
declare
  v_roll text := current_setting('vift.t3e_roll', true);
  v_forv text := current_setting('vift.t3e_forvantad_hash', true);
  v_roles jsonb; v_staff jsonb; v_new jsonb; v_hash text; v_e jsonb; v_cnt int; v_jid bigint;
  v_nya text[] := array['ao_start_own', 'ao_complete_own', 'ao_pool_take'];
begin
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
  if v_forv is null or v_forv = '' or v_forv = 'FYLL_I_HASH_FRAN_DEL_A' or v_hash <> v_forv then
    raise exception 'T3-E STOP: rollregistrets hash % ≠ förväntad % — inget ändrat; kör A igen', v_hash, coalesce(v_forv, '-');
  end if;
  select count(*) into v_cnt from jsonb_array_elements(v_roles) e where e->>'id' = v_roll;
  if v_cnt <> 1 then
    raise exception 'T3-E STOP: rollen % finns % gånger (exakt 1 krävs) — inget ändrat', v_roll, v_cnt;
  end if;
  select e into v_e from jsonb_array_elements(v_roles) e where e->>'id' = v_roll;
  if jsonb_typeof(v_e->'permissions') <> 'array' or not (v_e->'permissions' ? 'ao_complete')
     or (v_e->'permissions' ?| array['ao_view_all', 'ao_edit', 'all']) or (v_e->'permissions' ?| v_nya) then
    raise exception 'T3-E STOP: övergångsregeln gäller inte rollen % (kräver ao_complete utan ao_view_all/ao_edit/all och utan %) — inget ändrat', v_roll, array_to_string(v_nya, ', ');
  end if;
  select jsonb_agg(case when e->>'id' = v_roll then jsonb_set(e, '{permissions}', (e->'permissions') || to_jsonb(v_nya)) else e end order by o)
    into v_new from jsonb_array_elements(v_roles) with ordinality t(e, o);
  update public.store set value = v_new, updated_at = now() where key = 'vift_roles';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    on conflict (key) do update set value = excluded.value, updated_at = now(); -- som RPC:erna: öppna klienter läser om
  create schema if not exists vift_t3e_journal;
  revoke all on schema vift_t3e_journal from public, anon, authenticated;
  create table if not exists vift_t3e_journal.rollregister (
    id bigserial primary key,
    steg text not null,
    utford_at timestamptz not null default now(),
    utford_av text not null default current_user,
    fore_hash text not null,
    efter_hash text not null,
    fore_varde jsonb not null,
    efter_varde jsonb not null,
    tillagda_roller text[] not null default '{}',
    identiska_roller text[] not null default '{}',
    tillagda_behorigheter text[] not null default '{}',
    personal_hash text not null,
    kommentar text
  );
  revoke all on table vift_t3e_journal.rollregister from public, anon, authenticated;
  insert into vift_t3e_journal.rollregister(steg, fore_hash, efter_hash, fore_varde, efter_varde, tillagda_behorigheter, personal_hash, kommentar)
  values ('overgang:' || v_roll, v_hash, encode(sha256(convert_to(v_new::text, 'UTF8')), 'hex'), v_roles, v_new, v_nya, encode(sha256(convert_to(v_staff::text, 'UTF8')), 'hex'), 'övergångsregeln uttrycklig för ' || v_roll)
  returning id into v_jid;
  raise notice 'T3-E: journalrad % — % fick % (samma effektiva åtkomst); ny hash %', v_jid, v_roll, array_to_string(v_nya, ', '), encode(sha256(convert_to(v_new::text, 'UTF8')), 'hex');
end $$;
commit;
