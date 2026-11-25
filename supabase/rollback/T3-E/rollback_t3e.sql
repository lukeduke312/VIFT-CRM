-- ============================================================
-- ROLLBACK T3-E (genererad av tests/local/t3e-rollback.js ur en lokal kedja utan T3-E,
-- dvs. läget efter T3-D).
-- Återställer _vift_staff_external EXAKT till T3-D-versionen och tar bort _vift_ej_verkstallda().
-- Rör INGEN data och INTE rollregistret. Standardrollerna (manuellt skript) rullas tillbaka
-- separat med supabase/manual/t3e_standardroller/C_rollback.sql (expectedHash, journal).
-- Ordning vid rollback: 1) C_rollback.sql vid behov, 2) denna fil, 3) föregående klientpaket,
--   4) vid behov T3-D-, T3-C- och T3-B-rollbacken (omvänd ordning).
-- ============================================================
begin;

-- 1. Ersatt funktion (samma signatur) tillbaka till T3-D-definitionen.
-- _vift_staff_external(text[])
CREATE OR REPLACE FUNCTION public._vift_staff_external(p_perms text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select not exists (select 1 from unnest(coalesce(p_perms, '{}')) x
    where x <> all (array['dashboard_view','ao_view_own','ao_time','ao_checklist','ao_start_own','ao_complete_own',
                          'objects_access_assigned','rondering_utfor']))
$function$;
revoke all on function public._vift_staff_external(text[]) from public, anon, authenticated, service_role;
grant execute on function public._vift_staff_external(text[]) to service_role;

-- 2. T3-E:s nya registerfunktion bort (efter att inget längre anropar den).
drop function if exists public._vift_ej_verkstallda();

commit;
