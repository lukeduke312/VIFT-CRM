-- ============================================================
-- Migration 00003 — AVSIKTLIGT TOM
-- Datum:  2026-07-20
-- Ersatt: cron-uppläggning har flyttats till migration 00009.
--
-- Bakgrund: Cron-jobbet för service-monitor kräver att
--   (a) Vault-hemligheten SERVICE_MONITOR_SECRET är skapad,
--   (b) Edge Function service-monitor är deployad och testad.
-- Dessa förutsättningar existerar inte vid tidpunkten för
-- automatisk supabase db push (migrationer körs före deploy).
-- Cron-uppläggningen hanteras därför separat i migration 00009
-- som körs manuellt i SQL Editor efter EF-verifiering.
--
-- ROLLBACK: inget att göra — inga ändringar.
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 00003: avsiktligt tom. Cron-setup finns i 00009.';
END;
$$;
