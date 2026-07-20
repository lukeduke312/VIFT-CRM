-- ============================================================
-- Migration 00000 — Grundtabeller: store + push_subscriptions
-- Datum:  2026-07-20
--
-- MÅSTE KÖRAS FÖRE ALLA ANDRA MIGRATIONER.
-- Migration 00001 (RLS + app_users) förutsätter att store existerar.
-- Migration 00007 (sensitive_access_audit) skriver till store via EF.
-- send-push EF:en förutsätter att push_subscriptions existerar.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS — säker att köra på nytt.
-- Ingen seeddata, inga användare, inga produktionsdata.
--
-- Schema verifierat mot produktionsdatabasen 2026-07-20.
--
-- ROLLBACK (ENDAST STAGING — se avsnittet längst ned):
--   Tabellerna får bara tas bort om de är tomma och det är
--   ett uttryckligt stagingbeslut. Kör INTE i produktion.
-- ============================================================


-- ── pgcrypto (krävs av gen_random_uuid i äldre PG-versioner) ──
-- I PostgreSQL 13+ är gen_random_uuid() inbyggt utan extension,
-- men CREATE EXTENSION IF NOT EXISTS är ofarligt att inkludera.
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ── Tabell: store ──────────────────────────────────────────────
-- Nyckel/värde-lager för all appdata (vift_staff, vift_roles m.fl.).
-- RLS aktiveras i migration 00001 och nyckelbaserade policies i 00005.

CREATE TABLE IF NOT EXISTS public.store (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL DEFAULT 'null'::jsonb,
  updated_at timestamptz          DEFAULT now()
);


-- ── Tabell: push_subscriptions ─────────────────────────────────
-- Web Push-prenumerationer per autentiserad användare.
-- Rader kopplade till auth.users — CASCADE DELETE vid kontoborttagning.
-- EF send-push läser och skriver mot denna tabell (via service_role).

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL
                             REFERENCES auth.users(id)
                             ON DELETE CASCADE,
  endpoint     text        NOT NULL UNIQUE,
  p256dh       text        NOT NULL,
  auth_key     text        NOT NULL,
  platform     text,
  browser      text,
  device_label text                 DEFAULT 'Min enhet'::text,
  created_at   timestamptz          DEFAULT now(),
  last_seen_at timestamptz          DEFAULT now(),
  revoked_at   timestamptz
);


-- ── Verifiera (kör i SQL Editor efter migration) ───────────────
--
-- 1. Tabellerna existerar:
--      SELECT tablename FROM pg_tables
--        WHERE schemaname = 'public'
--          AND tablename IN ('store', 'push_subscriptions');
--      → 2 rader
--
-- 2. store-kolumner:
--      SELECT column_name, data_type, column_default, is_nullable
--        FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'store'
--       ORDER BY ordinal_position;
--      → key (text, NOT NULL), value (jsonb, NOT NULL), updated_at (timestamptz)
--
-- 3. push_subscriptions-kolumner:
--      SELECT column_name, data_type, is_nullable
--        FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'push_subscriptions'
--       ORDER BY ordinal_position;
--      → id, user_id, endpoint, p256dh, auth_key, platform, browser,
--        device_label, created_at, last_seen_at, revoked_at
--
-- 4. Primary keys och unique constraint:
--      SELECT conname, contype, conrelid::regclass
--        FROM pg_constraint
--       WHERE conrelid IN ('store'::regclass, 'push_subscriptions'::regclass)
--       ORDER BY conrelid, contype;
--      → store_pkey (p), push_subscriptions_pkey (p),
--        push_subscriptions_endpoint_key (u),
--        push_subscriptions_user_id_fkey (f)
--
-- 5. Foreign key till auth.users:
--      SELECT conname, confrelid::regclass, confdeltype
--        FROM pg_constraint
--       WHERE conrelid = 'push_subscriptions'::regclass
--         AND contype = 'f';
--      → push_subscriptions_user_id_fkey, auth.users, a (CASCADE)
--
-- 6. Tabellerna är tomma (ny staginginstans):
--      SELECT count(*) FROM store;           → 0
--      SELECT count(*) FROM push_subscriptions; → 0


-- ============================================================
-- ROLLBACK — ENDAST STAGING, ALDRIG PRODUKTION
--
-- Tabellerna får bara tas bort om de är tomma och det är ett
-- uttryckligt beslut att återställa staginginstansen.
--
-- Kontrollera att tabellerna är tomma INNAN DROP:
--   SELECT count(*) FROM store;
--   SELECT count(*) FROM push_subscriptions;
--   → Bägge ska visa 0. Avbryt om någon innehåller rader.
--
-- Kör sedan (STAGING ONLY):
--   DROP TABLE IF EXISTS public.push_subscriptions;
--   DROP TABLE IF EXISTS public.store;
--
-- OBS: DROP TABLE store tar med sig alla app-data inkl. vift_staff,
-- vift_roles, vift_offers m.fl. — detta är destruktivt och
-- oåterkalleligt utan backup.
-- ============================================================
