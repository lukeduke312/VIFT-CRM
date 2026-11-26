-- =====================================================================
-- VIFT CRM — T3-E standardroller (M9, D-02): B. Installera de standardroller som saknas (KRÄVER GO)
-- Genererad av vift-v2 tests/local/t3e-skript.js ur standardroller.json (t4d-2026-11-28). Ändra inte för hand.
-- Körs i Supabase SQL Editor för STAGING (yyzljlqyzzcbxmcdbual) FÖRST efter separat GO.
-- ALDRIG mot LIVE utan en egen LIVE-plan. Ingår INTE i migrationskedjan (inte db push).
-- Lägger BARA till standardroller som saknas. Skriver aldrig över eller tar bort befintliga roller.
-- Ändrar aldrig personalposter (D-02). Idempotent: en andra körning ändrar ingenting.
-- STOP (inget ändras) om: hashen i rad 1 inte är rollregistrets aktuella hash (del A, A2);
--   en befintlig roll har samma id men andra behörigheter (id-krock) eller dubbla id;
--   aktiv personal redan har ett roll-id som skulle läggas till (rollen skulle då ge dem åtkomst);
--   antalet superadministratörer skulle ändras.
-- Journal: vift_t3e_journal.rollregister (före/efter med hash). Rollback: C_rollback.sql.
-- =====================================================================

-- Rad 1: fyll i forvantad_hash från del A (A2). Lämnas platshållaren kvar stoppas skriptet.
select set_config('vift.t3e_forvantad_hash', 'FYLL_I_HASH_FRAN_DEL_A', false);

begin;
do $$
declare
  v_def jsonb := '[
  {"id":"admin","label":"Admin","isBuiltin":true,"active":true,"description":"Superadministratör: alla behörigheter.","permissions":["all"]},
  {"id":"chef","label":"Arbetsledare","isBuiltin":true,"active":true,"description":"Arbetsledare: arbetsorder, planering, kunder, offerter, fakturaunderlag, intern ekonomi, rapporter och personalens arbetstid (utan lön och personnummer).","permissions":["dashboard_view","ao_view_all","ao_view_own","ao_pool_take","ao_start_own","ao_complete_own","ao_plan_own","ao_create","ao_edit","ao_complete","ao_time","ao_material","ao_checklist","rondering_utfor","objects_sensitive","customer_manage","offer_manage","sales_manage","recurring_manage","invoice_view","invoice_create","reports_view","cost_view","cost_edit","time_view_all","staff_view","staff_contacts_view","activity_log_view_all","export_data"]},
  {"id":"ekonomi","label":"Ekonomi","isBuiltin":true,"active":true,"description":"Ekonomi: fakturaunderlag, rapporter, löneunderlag och attest, intern ekonomi och personnummer för ROT/RUT.","permissions":["dashboard_view","ao_view_all","customer_view","personal_data_view","invoice_view","invoice_create","reports_view","cost_view","cost_edit","payroll_view","payroll_manage","staff_contacts_view","activity_log_view_all","export_data"]},
  {"id":"personal","label":"Personal","isBuiltin":true,"active":true,"description":"Fältpersonal: egna tilldelade arbetsorder, öppen pool, start och klarmarkering av egna, tid, material och checklista.","permissions":["dashboard_view","ao_view_own","ao_pool_take","ao_start_own","ao_complete_own","ao_plan_own","ao_time","ao_material","ao_checklist","rondering_utfor","objects_access_assigned","staff_contacts_view"]},
  {"id":"begransad","label":"Begränsad","isBuiltin":true,"active":true,"description":"Begränsad/extern: bara egna tilldelade arbetsorder, ingen öppen pool och inga ekonomiska uppgifter. Tid, checklista, start, klarmarkering, rondering och åtkomstinformation kan läggas till separat (D-04).","permissions":["dashboard_view","ao_view_own"]}
]'::jsonb;
  v_forv text := current_setting('vift.t3e_forvantad_hash', true);
  v_roles jsonb; v_staff jsonb; v_new jsonb; v_hash text; v_staff_hash text;
  v_r jsonb; v_e jsonb; v_cnt int; v_ex text[]; v_std text[];
  v_tillagda text[] := '{}'; v_identiska text[] := '{}'; v_krock text[] := '{}'; v_aktiva text[] := '{}';
  v_super_fore int; v_super_efter int; v_jid bigint;
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
  if v_forv is null or v_forv = '' or v_forv = 'FYLL_I_HASH_FRAN_DEL_A' then
    raise exception 'T3-E STOP: förväntad hash saknas (fyll i rad 1 med A2) — inget ändrat';
  end if;
  if v_hash <> v_forv then
    raise exception 'T3-E STOP: rollregistret har ändrats sedan del A (hash % ≠ förväntad %) — inget ändrat; kör A igen', v_hash, v_forv;
  end if;
  v_staff_hash := encode(sha256(convert_to(v_staff::text, 'UTF8')), 'hex');
  if to_regprocedure('public._vift_superadmin_count(jsonb,jsonb)') is not null then
    execute 'select public._vift_superadmin_count($1, $2)' into v_super_fore using v_staff, v_roles;
  end if;
  for v_r in select x from jsonb_array_elements(v_def) x loop
    select count(*) into v_cnt from jsonb_array_elements(v_roles) e where e->>'id' = v_r->>'id';
    if v_cnt = 0 then
      v_tillagda := v_tillagda || (v_r->>'id');
      continue;
    end if;
    if v_cnt > 1 then
      v_krock := v_krock || format('%s: dubbla id i rollregistret (%s st)', v_r->>'id', v_cnt);
      continue;
    end if;
    select e into v_e from jsonb_array_elements(v_roles) e where e->>'id' = v_r->>'id';
    select coalesce(array_agg(distinct p order by p), '{}') into v_ex from jsonb_array_elements_text(case when jsonb_typeof(v_e->'permissions') = 'array' then v_e->'permissions' else '[]'::jsonb end) p;
    select coalesce(array_agg(distinct p order by p), '{}') into v_std from jsonb_array_elements_text(v_r->'permissions') p;
    if v_ex = v_std and jsonb_typeof(v_e->'permissions') = 'array' then
      v_identiska := v_identiska || (v_r->>'id');
    else
      v_krock := v_krock || format('%s: befintlig [%s], standard [%s]', v_r->>'id', array_to_string(v_ex, ','), array_to_string(v_std, ','));
    end if;
  end loop;
  if array_length(v_krock, 1) > 0 then
    raise exception 'T3-E STOP: id-krock — befintliga roller skrivs aldrig över; inget ändrat. %', array_to_string(v_krock, ' | ');
  end if;
  select coalesce(array_agg(format('%s (%s aktiva)', r, n) order by r), '{}') into v_aktiva from (
    select s->>'role' as r, count(*) as n from jsonb_array_elements(v_staff) s
     where s->>'role' = any(v_tillagda) and coalesce(s->>'active', 'true') <> 'false' group by 1) x;
  if array_length(v_aktiva, 1) > 0 then
    raise exception 'T3-E STOP: aktiv personal har redan roll-id som skulle läggas till (rollen skulle ge dem åtkomst direkt) — inget ändrat. %', array_to_string(v_aktiva, ', ');
  end if;
  if coalesce(array_length(v_tillagda, 1), 0) = 0 then
    raise notice 'T3-E: inget att göra — alla standardroller finns redan med exakt standardbehörigheterna (%). Ingen skrivning, ingen journalrad.', array_to_string(v_identiska, ', ');
    return;
  end if;
  select v_roles || coalesce(jsonb_agg(x order by o), '[]'::jsonb) into v_new
    from jsonb_array_elements(v_def) with ordinality t(x, o) where x->>'id' = any(v_tillagda);
  update public.store set value = v_new, updated_at = now() where key = 'vift_roles';
  insert into public.store(key, value) values ('vift_lastChanged', to_jsonb(to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    on conflict (key) do update set value = excluded.value, updated_at = now(); -- som RPC:erna: öppna klienter läser om
  if to_regprocedure('public._vift_superadmin_count(jsonb,jsonb)') is not null then
    execute 'select public._vift_superadmin_count($1, $2)' into v_super_efter using v_staff, v_new;
  end if;
  if v_super_fore is distinct from v_super_efter then
    raise exception 'T3-E STOP: antalet superadministratörer skulle ändras (% → %) — inget ändrat', v_super_fore, v_super_efter;
  end if;
  if (select encode(sha256(convert_to(value::text, 'UTF8')), 'hex') from public.store where key = 'vift_staff') <> v_staff_hash then
    raise exception 'T3-E STOP: personalregistret ändrades — inget ändrat';
  end if;
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
  insert into vift_t3e_journal.rollregister(steg, fore_hash, efter_hash, fore_varde, efter_varde, tillagda_roller, identiska_roller, personal_hash, kommentar)
  values ('installera', v_hash, encode(sha256(convert_to(v_new::text, 'UTF8')), 'hex'), v_roles, v_new, v_tillagda, v_identiska, v_staff_hash, 't4d-2026-11-28')
  returning id into v_jid;
  raise notice 'T3-E: journalrad % — tillagda roller: %; identiska (orörda): %; ny hash %', v_jid, array_to_string(v_tillagda, ', '), array_to_string(v_identiska, ', '), encode(sha256(convert_to(v_new::text, 'UTF8')), 'hex');
end $$;
commit;
