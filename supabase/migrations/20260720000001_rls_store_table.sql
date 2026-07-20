-- ============================================================
-- Migration: RLS för store, push_subscriptions + app_users
-- Datum:     2026-07-20 (v2 — aktiv användarvalidering via app_users)
-- Syfte:     Aktivera Row Level Security på alla CRM-tabeller.
--
--  • anon-rollen nekas ALL access till ALL CRM-data.
--  • En giltig Supabase-inloggning räcker INTE — användaren
--    måste även finnas som aktiv rad i app_users-tabellen.
--  • Aktiva VIFT-användare (via app_users) har full tillgång
--    till all gemensam CRM-data (enkeltenant-modell).
--  • push_subscriptions: per-user isolering + app_users-krav.
--
-- FÖRUTSÄTTNING:
--  Populera app_users INNAN migrationen aktiveras, annars låses
--  ALLA autentiserade användare ute:
--    INSERT INTO app_users (user_id, active)
--    VALUES ('<supabase-auth-uid>', true);
--  auth-uid hittas i Dashboard → Authentication → Users.
--
-- REVOKE-notering:
--  REVOKE-satser nedan säkerställer att inga default GRANTs
--  råkar ge anon- eller authenticated-rollen access utan RLS.
--  GRANT återges sedan med RLS som grindvakt.
--
-- ROLLBACK (kör i SQL Editor):
--   OBS: Ta INTE bort app_users med DROP TABLE CASCADE — det raderar
--        mappningar och kan ta bort beroenden. Inaktivera policyer istället.
--
--   DROP POLICY IF EXISTS "store_service_role_all"  ON public.store;
--   DROP POLICY IF EXISTS "store_vift_users_all"    ON public.store;
--   DROP POLICY IF EXISTS "push_own_read"           ON public.push_subscriptions;
--   DROP POLICY IF EXISTS "push_own_insert"         ON public.push_subscriptions;
--   DROP POLICY IF EXISTS "push_own_update"         ON public.push_subscriptions;
--   DROP POLICY IF EXISTS "push_service_role_all"   ON public.push_subscriptions;
--   ALTER TABLE public.store              DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.push_subscriptions DISABLE ROW LEVEL SECURITY;
--   -- app_users bevaras (DROP TABLE är DESTRUKTIVT och ska undvikas):
--   ALTER TABLE app_users DISABLE ROW LEVEL SECURITY;
-- ============================================================

-- ── Tabell: app_users ─────────────────────────────────────────
-- Kartlägger Supabase auth.users (UUID) → behörig VIFT-medarbetare.
-- Varje rad skapas av admin när ett nytt VIFT-konto ges åtkomst.
-- Utan en aktiv rad här kan användaren inte nå store-tabellen.

CREATE TABLE IF NOT EXISTS app_users (
  user_id      UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_id     TEXT,
  active       BOOLEAN      NOT NULL DEFAULT true,
  role_id      TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  disabled_at  TIMESTAMPTZ
);

-- ── RLS på app_users ──────────────────────────────────────────
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_users_own_read"     ON app_users;
DROP POLICY IF EXISTS "app_users_service_role" ON app_users;

-- Authenticated: varje användare kan bara se sin EGEN rad
CREATE POLICY "app_users_own_read"
  ON app_users FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- service_role: full access (admin-verktyg, EF)
CREATE POLICY "app_users_service_role"
  ON app_users FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── Explicit GRANT/REVOKE — store ────────────────────────────
-- Ta bort eventuella default GRANTs och sätt sedan exakta rättigheter.
-- RLS begränsar vad authenticated faktiskt kan göra.

REVOKE ALL ON public.store FROM anon;
REVOKE ALL ON public.store FROM authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.store TO authenticated;

REVOKE ALL ON public.push_subscriptions FROM anon;
REVOKE ALL ON public.push_subscriptions FROM authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;

REVOKE ALL ON app_users FROM anon;
GRANT  SELECT ON app_users TO authenticated;

-- ── store ─────────────────────────────────────────────────────
-- Innehåller ALL CRM-data som JSON-blobbar (key TEXT / value JSONB).
-- Inga per-rad-ägare — enkeltenant-modell, alla delar all data.
-- Anon nekas via RLS deny-by-default (inga policyer = blockad).

ALTER TABLE public.store ENABLE ROW LEVEL SECURITY;

-- Idempotent: ta bort gamla policyer
DROP POLICY IF EXISTS "store_service_role_all"   ON public.store;
DROP POLICY IF EXISTS "store_no_anon"            ON public.store;
DROP POLICY IF EXISTS "store_authenticated_all"  ON public.store;
DROP POLICY IF EXISTS "store_vift_users_all"     ON public.store;

-- service_role: full access (Edge Functions + backend-anrop)
CREATE POLICY "store_service_role_all"
  ON public.store FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated: ENBART aktiva VIFT-användare (via app_users)
-- En authenticated Supabase-inloggning utan app_users-rad nekas.
-- En deaktiverad användare (active = false) nekas omedelbart.
CREATE POLICY "store_vift_users_all"
  ON public.store FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.user_id = auth.uid()
        AND app_users.active  = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.user_id = auth.uid()
        AND app_users.active  = true
    )
  );

-- anon: nekas allt (inga ytterligare policyer = RLS deny-by-default)


-- ── push_subscriptions ────────────────────────────────────────
-- Varje rad ägs av en auth-användare via user_id = auth.uid().
-- Kräver dessutom aktiv VIFT-användare (app_users-krav).

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_own_read"         ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_own_insert"       ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_own_update"       ON public.push_subscriptions;
DROP POLICY IF EXISTS "push_service_role_all" ON public.push_subscriptions;

CREATE POLICY "push_own_read"
  ON public.push_subscriptions FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.user_id = auth.uid()
        AND app_users.active  = true
    )
  );

CREATE POLICY "push_own_insert"
  ON public.push_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.user_id = auth.uid()
        AND app_users.active  = true
    )
  );

-- Uppdatering av egna rader (t.ex. revoked_at) — app_users-krav
-- i USING för att inte låsa ut användaren mitt i en session.
CREATE POLICY "push_own_update"
  ON public.push_subscriptions FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- service_role: full access (send-push EF)
CREATE POLICY "push_service_role_all"
  ON public.push_subscriptions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- anon: nekas allt (inga policyer = blockad)


-- ── Verifiera (kör i SQL Editor efter migration) ──────────────
-- 1. Kontrollera RLS aktiverat:
--      SELECT tablename, rowsecurity FROM pg_tables
--        WHERE tablename IN ('store','push_subscriptions','app_users');
--      → rowsecurity = true för alla tre
--
-- 2. Anon nekas store:
--      SET ROLE anon;
--      SELECT count(*) FROM store;
--      → ERROR: permission denied
--      RESET ROLE;
--
-- 3. Authenticated utan app_users-rad nekas:
--      SET ROLE authenticated;
--      SET LOCAL request.jwt.claims = '{"sub":"<uid-utan-app_users-rad>","email":"test@test.se"}';
--      SELECT count(*) FROM store;
--      → 0 rader (eller permission denied beroende på Supabase-version)
--      RESET ROLE;
--
-- 4. Aktivera en testanvändare och verifiera åtkomst:
--      INSERT INTO app_users (user_id, active)
--        VALUES ('<supabase-auth-uid>', true);
--      -- Logga in som den användaren i appen → DataSync bör ladda data.
--
-- 5. Policyer:
--      SELECT tablename, policyname, roles, cmd
--        FROM pg_policies
--        WHERE tablename IN ('store','push_subscriptions','app_users');
