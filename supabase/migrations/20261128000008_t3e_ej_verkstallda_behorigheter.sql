-- ============================================================
-- T3-E (2026-11-28): ej verkställda behörigheter är verkningslösa (BESLUT-2026-11-28,
-- "Tillägg – kontroll mot hela masterplanen": T3-E aktiverar inga nya behörigheter innan
-- motsvarande serverkontroller finns). NY – EJ INSTALLERAD I STAGING.
--
-- Bakgrund (fynd i T3-D-koden, lokalt bevisat i tests/t3e_standard_roles.test.js):
--   _vift_staff_external(perms) avgör om en användare är "extern" (bara D-04:s
--   tilläggsbehörigheter). Varje annan behörighet gjorde användaren "intern" och gav därmed
--   kollegornas arbetstelefon och arbets-e-post (R38). En roll som bara fick en framtida,
--   ännu inte verkställd behörighet (t.ex. begransad + cost_view) fick alltså BREDARE
--   åtkomst än utan den.
--
-- Rättning: ny registerfunktion _vift_ej_verkstallda() med behörigheter vars
-- serverkontroller hör till T4 eller AO-etappen. De räknas inte när _vift_staff_external
-- avgör intern/extern. Ingen annan serverregel läser dessa behörigheter (kontrolleras av
-- tests/t3e_standard_roles.test.js och VIFT-CRM tests/rollnamn_guard.test.js).
-- När ett T4-paket verkställer en behörighet tar det bort den ur listan i sin migration.
-- Listan speglas i supabase/manual/t3e_standardroller/standardroller.json (ejVerkstallda)
-- och i tests/e2e/fake-backend.js (T3E_EJ_VERKSTALLDA); testet jämför dem.
--
-- Rör inga data. Rollback: supabase/rollback/T3-E/rollback_t3e.sql (T3-D-definitionen).
-- Rollregistret (vift_roles) ändras INTE här: standardrollerna installeras bara med det
-- manuella skriptet supabase/manual/t3e_standardroller/B_installera.sql efter separat GO.
-- ============================================================
begin;

do $$
declare v text;
begin
  if to_regprocedure('public._vift_ej_verkstallda()') is not null then
    raise exception 'T3-E STOP: _vift_ej_verkstallda() finns redan — T3-E är redan installerad; kör inte igen';
  end if;
  if to_regprocedure('public._vift_staff_external(text[])') is null then
    raise exception 'T3-E STOP: 20261128000006 (T3-D) måste installeras först';
  end if;
  v := md5(pg_get_functiondef('public._vift_staff_external(text[])'::regprocedure));
  if v not in ('8206ed62e26cf1d6a3e91754573655b4') then
    raise exception 'T3-E STOP: _vift_staff_external avviker från T3-D-versionen (md5 %)', v;
  end if;
end $$;

/* Behörigheter som finns i katalogen och standardrollerna men vars serverkontroller ännu
   inte finns. De ger ingen åtkomst och räknas inte i någon regel. */
create or replace function public._vift_ej_verkstallda()
returns text[] language sql immutable set search_path = public as $$
  select array['ao_plan_own','cost_view','cost_edit','time_view_all','bankgiro_edit','personal_data_view',
               'objects_access_assigned','rondering_utfor','export_data','export_personal_data']
$$;

/* Extern användare = inga behörigheter utöver D-04:s tilläggslista och de ej verkställda.
   Samma beslut som T3-D i övrigt (inga rollnamn). */
create or replace function public._vift_staff_external(p_perms text[])
returns boolean language sql immutable set search_path = public as $$
  select not exists (select 1 from unnest(coalesce(p_perms, '{}')) x
    where x <> all (array['dashboard_view','ao_view_own','ao_time','ao_checklist','ao_start_own','ao_complete_own',
                          'objects_access_assigned','rondering_utfor'] || public._vift_ej_verkstallda()))
$$;

do $$
declare f text;
begin
  foreach f in array array['public._vift_ej_verkstallda()', 'public._vift_staff_external(text[])']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
