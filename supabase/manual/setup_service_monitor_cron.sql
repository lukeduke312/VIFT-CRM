-- ============================================================
-- MANUELLT STEG: pg_cron + service-monitor
-- Fil:    supabase/manual/setup_service_monitor_cron.sql
-- Datum:  2026-07-20
--
-- !! DETTA ÄR INTE EN MIGRATION !!
-- Kör detta manuellt i Supabase SQL Editor — ALDRIG via supabase db push.
-- Migrationshistoriken ändras inte av detta steg.
--
-- KRAV INNAN KÖRNING — samtliga måste vara uppfyllda:
--   1. Vault-hemligheten SERVICE_MONITOR_SECRET har skapats.
--      (Se stagingrunboken steg 15 — kör vault.create_secret separat.)
--   2. Edge Function service-monitor är deployad.
--   3. service-monitor har testats manuellt med korrekt secret → 200.
--   4. Felaktig secret har verifierats ge 401.
--   5. Rätt secret har verifierats ge 200.
--   6. Automatisk AO-generering och dubblettskydd har testats.
--
-- VAULT-BOOTSTRAP (kör separat, steg 15 i runbooken):
--   OBS: Vault-hemligheten ska inte skrivas in i denna fil.
--   Kör i SQL Editor och ange värdet direkt i dialogen:
--
--   SELECT vault.create_secret(
--     '<SERVICE_MONITOR_SECRET-värdet>',
--     'SERVICE_MONITOR_SECRET',
--     'Cron-hemlighet för service-monitor Edge Function'
--   );
--
--   Verifiera att den finns (visar EJ decrypterat värde):
--   SELECT id, name, description FROM vault.secrets
--   WHERE name = 'SERVICE_MONITOR_SECRET';
--
-- ROLLBACK:
--   SELECT cron.unschedule('vift-service-monitor-daily');
--   DROP FUNCTION IF EXISTS invoke_service_monitor();
-- ============================================================


-- ── 1. Wrapper-funktion ─────────────────────────────────────────────
-- Läser SERVICE_MONITOR_SECRET ur Vault vid körtid.
-- Skickar X-Monitor-Secret (Model B) — INTE Authorization: Bearer.
-- SECURITY DEFINER med pinnad search_path: förhindrar search_path-injection.

CREATE OR REPLACE FUNCTION invoke_service_monitor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_secret  TEXT;
  v_url     TEXT;
BEGIN
  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'SERVICE_MONITOR_SECRET'
   LIMIT 1;

  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING '[invoke_service_monitor] SERVICE_MONITOR_SECRET saknas i Vault — avbruten.';
    RETURN;
  END IF;

  v_url := current_setting('app.supabase_url', true);
  IF v_url IS NULL OR v_url = '' THEN
    RAISE WARNING '[invoke_service_monitor] app.supabase_url saknas — avbruten.';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/service-monitor',
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'X-Monitor-Secret', v_secret
    ),
    body    := '{}'::jsonb
  );

  RAISE NOTICE '[invoke_service_monitor] HTTP-anrop skickat till service-monitor.';
END;
$$;

-- Ingen direkt åtkomst från klienter
REVOKE ALL ON FUNCTION invoke_service_monitor() FROM PUBLIC;
REVOKE ALL ON FUNCTION invoke_service_monitor() FROM anon;
REVOKE ALL ON FUNCTION invoke_service_monitor() FROM authenticated;


-- ── 2. Ta bort eventuellt befintligt cron-jobb (idempotent) ────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vift-service-monitor-daily') THEN
    PERFORM cron.unschedule('vift-service-monitor-daily');
    RAISE NOTICE 'Befintligt cron-jobb borttaget innan nytt skapas.';
  END IF;
END;
$$;


-- ── 3. Schemalägg nytt cron-jobb ────────────────────────────────────

SELECT cron.schedule(
  'vift-service-monitor-daily',
  '0 6 * * *',
  $$SELECT invoke_service_monitor();$$
);


-- ── 4. Verifiera ────────────────────────────────────────────────────

-- 4a. Jobbet är schemalagt:
SELECT jobname, schedule, command
  FROM cron.job
 WHERE jobname = 'vift-service-monitor-daily';
-- Förväntat: 1 rad

-- 4b. Testa funktionen manuellt (kör efter att ovanstående stämmer):
-- SELECT invoke_service_monitor();
-- Förväntat: NOTICE om anrop skickat, EF svarar med checked/notified/aoGenerated

-- 4c. Kontrollera att Vault-hemligheten läses korrekt (utan att avslöja värdet):
-- SELECT name, created_at FROM vault.secrets WHERE name = 'SERVICE_MONITOR_SECRET';

-- 4d. Senaste cron-körning (dagen efter setup):
-- SELECT jobid, status, return_message, start_time
--   FROM cron.job_run_details
--  WHERE jobid = (
--    SELECT jobid FROM cron.job WHERE jobname = 'vift-service-monitor-daily'
--  )
--  ORDER BY start_time DESC LIMIT 5;
-- Förväntat: status = 'succeeded'


-- ── ROLLBACK ────────────────────────────────────────────────────────
-- Om återgång behövs:
--   SELECT cron.unschedule('vift-service-monitor-daily');
--   DROP FUNCTION IF EXISTS invoke_service_monitor();
-- Vault-hemligheten tas bort manuellt: Dashboard → Vault → radera posten.
