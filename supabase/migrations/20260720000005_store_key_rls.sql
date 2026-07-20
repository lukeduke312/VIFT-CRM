-- ============================================================
-- Migration: Key-baserad store-auktorisering + app_users.is_admin
-- Datum:     2026-07-20
-- Syfte:     Förhindra privilege escalation via vift_roles/vift_staff/vift_settings.
--
--  Problemet med store_vift_users_all FOR ALL:
--    Alla aktiva VIFT-användare kan skriva till ALLA store-nycklar — inklusive
--    vift_roles (rollbehörigheter), vift_staff (personalregister) och vift_settings.
--    En aktiv användare kan ge sig själv objects_sensitive genom att skriva
--    till vift_roles via ett direkt REST-anrop (Authorization: Bearer <JWT>).
--
--  Lösning: Lägg till is_admin i app_users, dela upp FOR ALL i läs/skriv-policyer.
--
--  Skyddade nycklar (admin-only WRITE):
--    vift_roles     — rollbehörigheter
--    vift_staff     — personalregister inkl. e-post och rollkoppling
--    vift_settings  — systemvida CRM-inställningar
--
--  Övriga nycklar (alla aktiva användare kan skriva):
--    Operativ data (workOrders, customers, offers, m.fl.).
--    Notera: detta är det maximala skyddet möjligt med blob-modellen i RC1.
--    Per-behörighet write-kontroll (t.ex. bara customer_manage kan skriva
--    vift_customers) kräver normaliserat schema — planerat för v1.1.
--
--  Kvarvarande kända risker (dokumenterade):
--    1. Tekniker kan potentiellt skriva vift_workOrders direkt via REST.
--       Frontendbehörigheter ger kontext; fullständig server-side enforcement
--       kräver v1.1 normalisering.
--    2. vift_timeEntries laddas för alla aktiva användare oavsett payroll_view.
--       Partiell klient-side mitigation i DataSync — se migration 00007.
--    3. is_admin i app_users synkroniseras INTE automatiskt när admin
--       ändrar en användares roll i CRM-gränssnittet. Manuell/EF-driven
--       uppdatering krävs (dokumenterat i provisioning-migration 00006).
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS "store_active_read"             ON public.store;
--   DROP POLICY IF EXISTS "store_active_write_safe"       ON public.store;
--   DROP POLICY IF EXISTS "store_admin_write_protected"   ON public.store;
--   -- Återskapa original-policyn:
--   CREATE POLICY "store_vift_users_all" ON public.store FOR ALL TO authenticated
--     USING (EXISTS (SELECT 1 FROM app_users WHERE user_id = auth.uid() AND active = true))
--     WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE user_id = auth.uid() AND active = true));
--   -- OBS: ta INTE bort is_admin-kolumnen om den innehåller data.
--   -- ALTER TABLE app_users DROP COLUMN IF EXISTS is_admin;
-- ============================================================

-- ── Lägg till is_admin i app_users ──────────────────────────────
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN app_users.is_admin IS
  'Sant om användaren har all-behörighet (superadmin). Måste uppdateras manuellt '
  'eller via EF när rollen ändras. Styr admin-only write på skyddade store-nycklar.';

-- ── Ta bort den alltför breda store_vift_users_all-policyn ──────
DROP POLICY IF EXISTS "store_vift_users_all" ON public.store;

-- ── Policy 1: Läsning — alla aktiva VIFT-användare ──────────────
-- DataSync och frontend behöver kunna läsa alla nycklar.
-- Läsning är relativt ofarlig — mer kritiska klientdata skyddas via
-- DataSync-filtrering och EF-separation (property_sensitive_access).
DROP POLICY IF EXISTS "store_active_read" ON public.store;
CREATE POLICY "store_active_read"
  ON public.store FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.user_id = auth.uid()
        AND app_users.active  = true
    )
  );

-- ── Policy 2: Skriv — alla aktiva användare, EJ skyddade nycklar ─
-- Operativ data (workOrders, customers, offers, timeEntries m.fl.) är
-- skrivbar för alla aktiva användare. Detta speglar enkeltenant-modellen.
DROP POLICY IF EXISTS "store_active_write_safe" ON public.store;
CREATE POLICY "store_active_write_safe"
  ON public.store FOR ALL
  TO authenticated
  USING (
    key NOT IN ('vift_roles', 'vift_staff', 'vift_settings')
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.user_id = auth.uid()
        AND app_users.active  = true
    )
  )
  WITH CHECK (
    key NOT IN ('vift_roles', 'vift_staff', 'vift_settings')
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.user_id = auth.uid()
        AND app_users.active  = true
    )
  );

-- ── Policy 3: Skriv — skyddade nycklar, endast admin ────────────
-- vift_roles, vift_staff, vift_settings: kräver is_admin = true.
-- Blockerar privilege escalation via direkt REST-anrop till vift_roles.
DROP POLICY IF EXISTS "store_admin_write_protected" ON public.store;
CREATE POLICY "store_admin_write_protected"
  ON public.store FOR ALL
  TO authenticated
  USING (
    key IN ('vift_roles', 'vift_staff', 'vift_settings')
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.user_id = auth.uid()
        AND app_users.active  = true
        AND app_users.is_admin = true
    )
  )
  WITH CHECK (
    key IN ('vift_roles', 'vift_staff', 'vift_settings')
    AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.user_id = auth.uid()
        AND app_users.active  = true
        AND app_users.is_admin = true
    )
  );

-- ── Verifiera (kör i SQL Editor efter migration) ──────────────────
-- 1. Policyer på store:
--      SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'store';
--      → store_service_role_all, store_active_read, store_active_write_safe,
--        store_admin_write_protected
--
-- 2. Aktiv icke-admin kan inte skriva vift_roles:
--      SET ROLE authenticated;
--      SET LOCAL request.jwt.claims = '{"sub":"<uid-av-icke-admin>","email":"tekn@vift.se"}';
--      UPDATE store SET value = '[]'::jsonb WHERE key = 'vift_roles';
--      → 0 rows updated (RLS blockerar)
--      RESET ROLE;
--
-- 3. Admin (is_admin = true) kan skriva vift_roles:
--      -- Sätt is_admin = true för testadmin:
--      UPDATE app_users SET is_admin = true WHERE user_id = '<admin-uid>';
--      -- Verifiera att UPDATE på vift_roles lyckas som admin.
--
-- 4. is_admin-kolumn finns:
--      SELECT column_name, data_type, column_default
--        FROM information_schema.columns
--        WHERE table_name = 'app_users' AND column_name = 'is_admin';
