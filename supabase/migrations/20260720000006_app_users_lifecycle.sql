-- ============================================================
-- Migration: app_users livscykel, bootstrap och verifiering
-- Datum:     2026-07-20
-- Syfte:     Säkerställ att app_users-tabellen har ett tydligt
--            provisioneringsflöde och att RLS kan aktiveras utan
--            att låsa ut alla användare.
--
-- INNEHÅLL:
--  1. Hjälpfunktioner för provisionering och inaktivering
--  2. Preflight-verifieringsfrågor
--  3. Bootstrap-SQL för befintliga auth-användare
--  4. Uppstart av första administratören
--
-- VIKTIGT: Populera app_users INNAN RLS aktiveras (migration 00001).
--          Aktivera RLS med minst en aktiv admin (is_admin = true).
--          Om inga rader finns i app_users låses ALLA användare ute.
--
-- LIVSCYKELREGLER:
--  Ny användare:   Admin inviterar via Supabase Dashboard → Auth → Invite user
--                  Sedan INSERT i app_users med rätt staff_id och role_id
--  Rolländring:    UPDATE vift_roles via CRM + UPDATE app_users SET is_admin = true/false
--                  (is_admin synkroniseras inte automatiskt i RC1)
--  Inaktivering:   UPDATE app_users SET active = false, disabled_at = now()
--                  RLS blockerar omedelbart — ingen ytterligare åtgärd krävs.
--  Borttagen user: CASCADE DELETE från auth.users hanteras automatiskt
--                  (app_users.user_id REFERENCES auth.users ON DELETE CASCADE)
--
-- ROLLBACK:
--  Hjälpfunktionerna kan tas bort:
--    DROP FUNCTION IF EXISTS provision_vift_user(UUID,TEXT,TEXT,BOOLEAN);
--    DROP FUNCTION IF EXISTS deactivate_vift_user(UUID);
--    DROP FUNCTION IF EXISTS check_app_users_health();
--  app_users-data bevaras alltid (inga destruktiva operationer här).
-- ============================================================

-- ── 1. Hjälpfunktion: provision_vift_user ────────────────────────
-- Skapar eller uppdaterar en app_users-rad för en Supabase auth-användare.
-- Anropas av admin via SQL Editor eller framtida admin-EF.
--
-- Parametrar:
--   p_user_id  : UUID från auth.users (hittas i Dashboard → Auth → Users)
--   p_staff_id : Personalpost-ID från vift_staff (t.ex. 'ST-001')
--   p_role_id  : Roll-ID från vift_roles (t.ex. 'chef', 'personal', 'admin')
--   p_is_admin : true om rollen har 'all'-behörighet (superadmin)
--
-- Exempel:
--   SELECT provision_vift_user(
--     'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
--     'ST-001',
--     'chef',
--     false
--   );

CREATE OR REPLACE FUNCTION provision_vift_user(
  p_user_id  UUID,
  p_staff_id TEXT,
  p_role_id  TEXT,
  p_is_admin BOOLEAN DEFAULT FALSE
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email TEXT;
BEGIN
  -- Hämta e-post för loggning
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Ingen auth-användare med user_id = %', p_user_id;
  END IF;

  INSERT INTO app_users (user_id, staff_id, role_id, active, is_admin, created_at)
  VALUES (p_user_id, p_staff_id, p_role_id, true, p_is_admin, now())
  ON CONFLICT (user_id) DO UPDATE SET
    staff_id   = EXCLUDED.staff_id,
    role_id    = EXCLUDED.role_id,
    active     = true,
    is_admin   = EXCLUDED.is_admin,
    disabled_at = NULL;

  RETURN format('Provisionerad: %s (staff_id=%s, role=%s, is_admin=%s)',
                v_email, p_staff_id, p_role_id, p_is_admin);
END;
$$;

-- ── 2. Hjälpfunktion: deactivate_vift_user ────────────────────────
-- Inaktiverar en app_users-rad omedelbart.
-- RLS nekar access direkt (active = false → EXISTS-check misslyckas).
-- Supabase-sessionen avslutas vid nästa token-refresh eller API-anrop.
--
-- Exempel:
--   SELECT deactivate_vift_user('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');

CREATE OR REPLACE FUNCTION deactivate_vift_user(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;

  UPDATE app_users
  SET active = false, disabled_at = now()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingen app_users-rad för user_id = %', p_user_id;
  END IF;

  RETURN format('Inaktiverad: %s', COALESCE(v_email, p_user_id::TEXT));
END;
$$;

-- ── 3. Hjälpfunktion: check_app_users_health ────────────────────
-- Preflight-verifiering. Kör INNAN RLS aktiveras och INNAN deployment.
-- Returnerar en tabell med hälsostatus.
--
-- Exempel:
--   SELECT * FROM check_app_users_health();

CREATE OR REPLACE FUNCTION check_app_users_health()
RETURNS TABLE(
  check_name       TEXT,
  status           TEXT,
  count_or_detail  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auth_count    INT;
  v_app_count     INT;
  v_active_count  INT;
  v_admin_count   INT;
  v_unmapped      INT;
BEGIN
  SELECT count(*) INTO v_auth_count FROM auth.users;
  SELECT count(*) INTO v_app_count  FROM app_users;
  SELECT count(*) INTO v_active_count FROM app_users WHERE active = true;
  SELECT count(*) INTO v_admin_count  FROM app_users WHERE active = true AND is_admin = true;
  SELECT count(*) INTO v_unmapped
    FROM auth.users u
    LEFT JOIN app_users a ON a.user_id = u.id
    WHERE a.user_id IS NULL;

  RETURN QUERY VALUES
    ('auth.users',       'INFO',
     v_auth_count::TEXT || ' Supabase Auth-användare'),
    ('app_users',        'INFO',
     v_app_count::TEXT  || ' rader totalt'),
    ('aktiva',           CASE WHEN v_active_count > 0 THEN 'OK' ELSE 'VARNING' END,
     v_active_count::TEXT || ' aktiva VIFT-användare'),
    ('admins',           CASE WHEN v_admin_count > 0 THEN 'OK' ELSE 'KRITISK' END,
     v_admin_count::TEXT || ' aktiva admins (is_admin = true)'),
    ('omappade auth',    CASE WHEN v_unmapped = 0 THEN 'OK' ELSE 'VARNING' END,
     v_unmapped::TEXT || ' auth-användare utan app_users-rad');
END;
$$;

-- Begränsa exekvering av hjälpfunktioner till service_role
REVOKE ALL ON FUNCTION provision_vift_user(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION deactivate_vift_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION check_app_users_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION provision_vift_user(UUID, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION deactivate_vift_user(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION check_app_users_health() TO service_role;


-- ============================================================
-- BOOTSTRAP-INSTRUKTIONER (kör manuellt i SQL Editor)
-- ============================================================
--
-- STEG 1 — Kör hälsokontroll INNAN du sätter upp användare:
--   SELECT * FROM check_app_users_health();
--   Förväntat: 'admins' → KRITISK (inga admins än)
--
-- STEG 2 — Skapa den första administratören:
--   Hitta admin-UID i Supabase Dashboard → Authentication → Users.
--   SELECT provision_vift_user(
--     '<admin-auth-uid>',   -- UUID från auth.users
--     'ST-001',             -- staff_id från vift_staff (eller 'system' om ej kopplad)
--     'admin',              -- role_id (inbyggd admin-roll med 'all'-behörighet)
--     true                  -- is_admin = true
--   );
--
-- STEG 3 — Skapa övriga användare (upprepa per användare):
--   SELECT provision_vift_user('<uid>', '<staff_id>', '<role_id>', false);
--
-- STEG 4 — Bekräfta att minst en admin finns:
--   SELECT * FROM check_app_users_health();
--   → 'admins' ska visa 'OK', inte 'KRITISK'
--
-- STEG 5 — Verifiera att RLS fungerar:
--   SET ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<admin-uid>","email":"admin@vift.se"}';
--   SELECT count(*) FROM store;   -- ska returnera rader
--   RESET ROLE;
--
-- INAKTIVERING av en användare:
--   SELECT deactivate_vift_user('<user-uid>');
--   Effekt: omedelbar — nästa API-anrop nekas, pågående session avslutas
--           vid nästa token-förfrågan (Supabase-JWT lever 1 timme).
--   Blockera dessutom i Supabase Dashboard → Auth → Users → Ban user
--   om omedelbar session-avstängning krävs.
--
-- ROLLÄNDRING (inkl. is_admin-synk):
--   -- 1. Ändra roll i CRM-gränssnittet (uppdaterar vift_staff + vift_roles)
--   -- 2. Uppdatera app_users manuellt:
--   UPDATE app_users
--     SET role_id  = '<ny-roll-id>',
--         is_admin = <true/false>
--   WHERE user_id = '<uid>';
--   -- OBS: is_admin synkroniseras INTE automatiskt i RC1.
--   --      Automatisk synk via trigger/EF planeras för v1.1.
-- ============================================================
