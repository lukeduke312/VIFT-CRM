-- ============================================================
-- Migration: pg_cron schema + service-monitor scheduling  (v2)
-- Datum:     2026-07-20
-- Syfte:     Schemalägg automatisk körning av service-monitor
--            Edge Function en gång per dag kl. 06:00 UTC.
--
-- SÄKERHET (v2):
--   - Hemligheten (SERVICE_MONITOR_SECRET) lagras i Supabase Vault,
--     ALDRIG i current_setting() eller i klartext i SQL.
--   - Cron-jobbet anropar en SECURITY DEFINER-wrapper som läser
--     hemligheten ur Vault vid körtid och skickar den som
--     X-Monitor-Secret — exakt vad service-monitor kräver (Model B).
--   - service_role_key skickas INTE längre — det är felaktigt och
--     skulle returnera 401 (EF accepterar inte Bearer som auth).
--
-- KRAV:
--   1. pg_cron aktiverat: Dashboard → Database → Extensions → pg_cron
--   2. pg_net aktiverat:  Dashboard → Database → Extensions → pg_net
--   3. Vault-hemlighet skapad (se BOOTSTRAP nedan)
--
-- ROLLBACK:
--   SELECT cron.unschedule('vift-service-monitor-daily');
--   DROP FUNCTION IF EXISTS invoke_service_monitor();
--   (Vault-hemligheten tas bort manuellt i Dashboard → Vault)
-- ============================================================


-- ── BOOTSTRAP: Spara hemligheten i Vault (kör MANUELLT, en gång) ──────
--
-- Vault-hemligheten måste skapas INNAN cron-jobbet körs.
-- Kör i Supabase SQL Editor (byt ut <din-hemlighet> mot det faktiska värdet):
--
--   SELECT vault.create_secret(
--     '<din-hemlighet>',        -- det faktiska hemligheten
--     'SERVICE_MONITOR_SECRET', -- namn som wrapper-funktionen letar efter
--     'Cron-hemlighet för service-monitor Edge Function'
--   );
--
-- Verifiera att den finns (visar EJ decrypterat värde):
--   SELECT id, name, description FROM vault.secrets
--   WHERE name = 'SERVICE_MONITOR_SECRET';
--
-- Om hemligheten saknas returnerar net.http_post ett tomt X-Monitor-Secret
-- och EF svarar med 401 — cron-körningen loggas som misslyckad men
-- kraschar inte databasen.
-- ──────────────────────────────────────────────────────────────────────


-- ── Wrapper-funktion: invoke_service_monitor ──────────────────────────
-- Läser SERVICE_MONITOR_SECRET ur Vault vid körtid och anropar EF
-- via net.http_post med korrekt X-Monitor-Secret-header.
-- SECURITY DEFINER: kör som funktionsägare (postgres) med pinnad search_path.
-- Schemaläggs av pg_cron — anropas aldrig direkt av klienter.

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
  -- Läs hemlighet ur Vault (decrypted_secrets kräver postgres-rättigheter)
  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'SERVICE_MONITOR_SECRET'
   LIMIT 1;

  -- Om hemligheten saknas: logga och avbryt (returnera utan HTTP-anrop)
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING '[invoke_service_monitor] SERVICE_MONITOR_SECRET saknas i Vault — cron-körning avbruten.';
    RETURN;
  END IF;

  -- Hämta Supabase URL ur app-inställning (sätts av Supabase automatiskt)
  v_url := current_setting('app.supabase_url', true);
  IF v_url IS NULL OR v_url = '' THEN
    RAISE WARNING '[invoke_service_monitor] app.supabase_url saknas — cron-körning avbruten.';
    RETURN;
  END IF;

  -- Anropa service-monitor med X-Monitor-Secret (Model B auth)
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

-- Inga klienter ska kunna anropa wrapper-funktionen direkt
REVOKE ALL ON FUNCTION invoke_service_monitor() FROM PUBLIC;
REVOKE ALL ON FUNCTION invoke_service_monitor() FROM anon;
REVOKE ALL ON FUNCTION invoke_service_monitor() FROM authenticated;


-- ── Schemalägg via pg_cron ────────────────────────────────────────────
-- Kör service-monitor kl. 06:00 UTC varje dag.
-- cron.schedule är idempotent på jobbnamnet — körning två gånger är OK.

SELECT cron.unschedule('vift-service-monitor-daily')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'vift-service-monitor-daily'
  );

SELECT cron.schedule(
  'vift-service-monitor-daily',   -- jobbnamn (unikt)
  '0 6 * * *',                    -- CRON-uttryck: 06:00 UTC dagligen
  $$SELECT invoke_service_monitor();$$
);


-- ── Alternativ om pg_cron ELLER pg_net saknas ─────────────────────────
-- Använd Supabase Cron (Dashboard → Edge Functions → Schedule):
--   Funktion:  service-monitor
--   Schema:    0 6 * * *  (dagligen kl. 06:00 UTC)
--   Metod:     POST
--   Body:      {}
--   Header:    X-Monitor-Secret: <värdet ur Vault>
--
-- OBS: Dashboard-cron skickar hemligheten direkt i header-konfigurationen.
--      Hantera det värdet med samma sekretess som en API-nyckel.


-- ── Verifiera ─────────────────────────────────────────────────────────
-- 1. Jobbet är schemalagt:
--      SELECT jobname, schedule, command FROM cron.job
--        WHERE jobname = 'vift-service-monitor-daily';
--
-- 2. Vault-hemligheten finns (visar EJ decrypterat värde):
--      SELECT id, name, description FROM vault.secrets
--        WHERE name = 'SERVICE_MONITOR_SECRET';
--
-- 3. Manuell test (ersätt <URL> med faktisk Supabase URL):
--      SELECT invoke_service_monitor();
--      -- Förväntat: NOTICE om anrop skickat
--      -- EF svarar med: { "checked": N, "notified": M, "aoGenerated": K }
--
-- 4. Kontrollera senaste cron-körning:
--      SELECT jobid, status, return_message, start_time
--        FROM cron.job_run_details
--       WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='vift-service-monitor-daily')
--       ORDER BY start_time DESC
--       LIMIT 5;

-- ── Idempotensnotering ────────────────────────────────────────────────
-- service-monitor lagrar senast skickad notis per serviceintervall
-- och servicedatum som nycklar i store:
--   lastNotificationSentForDueDate = "{si.id}::{si.nextDue}"
--   lastAOGeneratedForDueDate      = "{si.id}::{si.nextDue}"
-- Dubbla körningar (t.ex. vid cron-retry) skapar inga dubbletter.
