-- ============================================================
-- Migration: pg_cron schema + service-monitor scheduling
-- Datum:     2026-07-20
-- Syfte:     Schemalägg automatisk körning av service-monitor
--            Edge Function en gång per dag kl. 06:00 UTC.
--
-- KRAV: pg_cron-tillägget måste vara aktiverat i Supabase Dashboard
--       under Database → Extensions → pg_cron.
--
-- ROLLBACK:
--   SELECT cron.unschedule('vift-service-monitor-daily');
-- ============================================================

-- ── Aktivera pg_cron (kräver superuser, görs via Supabase Dashboard) ──
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- GRANT USAGE ON SCHEMA cron TO postgres;

-- ── Hjälpfunktion: anropa Edge Function via HTTP ─────────────
-- pg_cron kan inte anropa HTTP direkt — vi använder
-- net.http_post() från pg_net-tillägget (aktiveras separat).
-- Alternativt: Supabase Scheduled Functions (utan pg_cron).

-- Schemalägg service-monitor: kl 06:00 UTC varje dag
SELECT cron.schedule(
  'vift-service-monitor-daily',   -- jobbnamn (unikt, idempotent)
  '0 6 * * *',                    -- CRON-uttryck: 06:00 UTC dagligen
  $$
  SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/service-monitor',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ── Alternativ om pg_net inte är tillgängligt ─────────────────
-- Använd Supabase Cron (Dashboard → Edge Functions → Schedule):
--   Funktion:  service-monitor
--   Schema:    0 6 * * *  (dagligen kl. 06:00 UTC)
--   Metod:     POST
--   Body:      {}
--   Header:    Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
--
-- Detta kräver inga SQL-migreringar.


-- ── Verifiera att jobbet är schemalagt ───────────────────────
-- SELECT jobname, schedule, command FROM cron.job
--   WHERE jobname = 'vift-service-monitor-daily';
--
-- Manuell test (kör direkt):
-- SELECT net.http_post(
--   url     := '<SUPABASE_URL>/functions/v1/service-monitor',
--   headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>"}',
--   body    := '{}'::jsonb
-- );
-- -- Förväntat svar: { "checked": N, "notified": M, "aoGenerated": K }

-- ── Idempotensnotering ────────────────────────────────────────
-- service-monitor lagrar senast skickad notis per serviceintervall
-- och servicedatum som nycklar i store:
--   lastNotificationSentForDueDate = "{si.id}::{si.nextDue}"
--   lastAOGeneratedForDueDate      = "{si.id}::{si.nextDue}"
-- Dubbla körningar (t.ex. vid cron-retry) skapar inga dubbletter.
