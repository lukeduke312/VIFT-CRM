-- ============================================================
-- Migration 00009 — pg_cron: service-monitor (SIST, MANUELLT)
-- Datum:  2026-07-20
--
-- !! KRAV INNAN KÖRNING !!
--    1. Vault-secret SERVICE_MONITOR_SECRET är skapad (se bootstrap nedan).
--    2. Edge Function service-monitor är deployad.
--    3. service-monitor har testats manuellt (se steg 21 i runbooken).
--    4. Stagingprojektet är verifierat — aldrig produktion utan beslut.
--
-- !! KÖR INTE VIA supabase db push !!
--    Denna migration körs manuellt i Supabase SQL Editor som SISTA steg.
--    Innan dess: markera 00009 som tillämpad i supabase_migrations för att
--    db push inte ska köra den automatiskt:
--
--      supabase migration repair --status applied 20260720000009
--
--    Kör därefter denna SQL manuellt i SQL Editor (steg 22 i runbooken).
--
-- ROLLBACK:
--   SELECT cron.unschedule('vift-service-monitor-daily');
--   DROP FUNCTION IF EXISTS invoke_service_monitor();
--   (Vault-hemligheten tas bort manuellt i Dashboard → Vault)
-- ============================================================


-- ── BOOTSTRAP: Spara hemligheten i Vault (kör MANUELLT, en gång) ──────
--
-- Kör i Supabase SQL Editor — byt ut <din-hemlighet> mot det faktiska värdet.
-- Gör detta INNAN du kör resten av denna migration.
--
--   SELECT vault.create_secret(
--     '<din-hemlighet>',
--     'SERVICE_MONITOR_SECRET',
--     'Cron-hemlighet för service-monitor Edge Function'
--   );
--
-- Verifiera att den finns (visar EJ decrypterat värde):
--   SELECT id, name, description FROM vault.secrets
--   WHERE name = 'SERVICE_MONITOR_SECRET';
-- ──────────────────────────────────────────────────────────────────────


-- ── Wrapper-funktion ────────────────────────────────────────────────
-- Läser SERVICE_MONITOR_SECRET ur Vault vid körtid och anropar EF
-- via net.http_post med X-Monitor-Secret (Model B auth).
-- SECURITY DEFINER: kör som funktionsägare (postgres).
-- Pinnad search_path: förhindrar search_path-injection.

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

  RAISE NOTICE '[invoke_service_monitor] HTTP-anrop skickat.';
END;
$$;

-- Ingen direkt åtkomst från klienter
REVOKE ALL ON FUNCTION invoke_service_monitor() FROM PUBLIC;
REVOKE ALL ON FUNCTION invoke_service_monitor() FROM anon;
REVOKE ALL ON FUNCTION invoke_service_monitor() FROM authenticated;


-- ── Schemalägg via pg_cron ──────────────────────────────────────────
-- Ta bort eventuellt existerande jobb (idempotent)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vift-service-monitor-daily') THEN
    PERFORM cron.unschedule('vift-service-monitor-daily');
    RAISE NOTICE 'Befintligt cron-jobb borttaget.';
  END IF;
END;
$$;

SELECT cron.schedule(
  'vift-service-monitor-daily',
  '0 6 * * *',
  $$SELECT invoke_service_monitor();$$
);


-- ── Verifiera ───────────────────────────────────────────────────────
-- 1. Jobbet är schemalagt:
--      SELECT jobname, schedule, command FROM cron.job
--        WHERE jobname = 'vift-service-monitor-daily';
--
-- 2. Vault-hemligheten finns:
--      SELECT id, name, description FROM vault.secrets
--        WHERE name = 'SERVICE_MONITOR_SECRET';
--
-- 3. Manuellt test:
--      SELECT invoke_service_monitor();
--      Förväntat: NOTICE om anrop skickat
--      EF svarar: { "checked": N, "notified": M, "aoGenerated": K }
--
-- 4. Senaste cron-körning (dagen efter):
--      SELECT jobid, status, return_message, start_time
--        FROM cron.job_run_details
--       WHERE jobid = (
--         SELECT jobid FROM cron.job WHERE jobname = 'vift-service-monitor-daily'
--       )
--       ORDER BY start_time DESC LIMIT 5;
