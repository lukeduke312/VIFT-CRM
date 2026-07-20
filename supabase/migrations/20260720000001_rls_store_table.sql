-- ============================================================
-- Migration: RLS for store table + push_subscriptions
-- Datum:     2026-07-20
-- Syfte:     Aktivera Row Level Security på alla CRM-tabeller.
--            Anonyma anrop kan ALDRIG läsa CRM-data.
--            Autentiserade användare kan BARA läsa/skriva sin
--            egen data (push_subscriptions) samt gemensam
--            CRM-data via service role.
--
-- ROLLBACK (om migrationen behöver ångras):
--   ALTER TABLE public.store           DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.push_subscriptions DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS store_service_role_all   ON public.store;
--   DROP POLICY IF EXISTS store_no_anon            ON public.store;
--   DROP POLICY IF EXISTS push_own_read            ON public.push_subscriptions;
--   DROP POLICY IF EXISTS push_own_insert          ON public.push_subscriptions;
--   DROP POLICY IF EXISTS push_own_update          ON public.push_subscriptions;
--   DROP POLICY IF EXISTS push_service_role_all    ON public.push_subscriptions;
-- ============================================================

-- ── store ────────────────────────────────────────────────────
-- Innehåller ALL CRM-data som JSON-blobbar (key/value, jsonb).
-- Anon-rollen ska aldrig kunna läsa eller skriva här.
-- Autentiserade användare kan inte heller nå tabellen direkt
-- — all data-access sker via service_role i Edge Functions.

ALTER TABLE public.store ENABLE ROW LEVEL SECURITY;

-- Tillåt service_role full access (Edge Functions + backend-anrop)
CREATE POLICY store_service_role_all ON public.store
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Neka ALLT för authenticated och anon (inga direkta reads)
-- Ingen ytterligare policy => standardvägran (RLS deny-by-default)

-- Verifiering (kör manuellt i SQL Editor):
--   SELECT current_user;                      -- ska vara "anon" eller "authenticated"
--   SELECT count(*) FROM public.store;        -- ska ge ERROR: permission denied (RLS block)
--   SET ROLE anon; SELECT count(*) FROM store; -- ERROR: permission denied


-- ── push_subscriptions ───────────────────────────────────────
-- Varje rad tillhör en auth-användare via user_id = auth.uid().
-- Autentiserade användare kan bara hantera sina egna subscriptions.
-- service_role (Edge Functions) kan läsa/uppdatera alla.

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Authenticated: läsa egna subscriptions
CREATE POLICY push_own_read ON public.push_subscriptions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Authenticated: registrera ny subscription
CREATE POLICY push_own_insert ON public.push_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Authenticated: uppdatera egna (t.ex. revoked_at)
CREATE POLICY push_own_update ON public.push_subscriptions
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- service_role: full access (send-push EF, service-monitor EF)
CREATE POLICY push_service_role_all ON public.push_subscriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Anon nekas allt (ingen ytterligare policy)

-- Verifiering:
--   SET ROLE anon; SELECT count(*) FROM push_subscriptions; -- ERROR: permission denied
--   SET ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<your-user-id>"}';
--   SELECT count(*) FROM push_subscriptions;  -- returnerar bara egna rader


-- ── Säkerhetskontroll: inga vift_*-nycklar via anon ─────────
-- Följande kontroll kan köras som anon-roll för att verifiera:
--
--   EXPLAIN SELECT value FROM store WHERE key = 'vift_customers';
--   --> ska returnera: ERROR: permission denied for table store
--
-- Detta innebär att en angripare med enbart anon-nyckeln INTE
-- kan läsa kunddata, kontrakt, offerter eller känsliga fält.
