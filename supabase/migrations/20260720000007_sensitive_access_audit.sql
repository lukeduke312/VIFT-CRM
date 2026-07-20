-- ============================================================
-- Migration: Auditlogg för känsliga fält (sensitive_access_audit)
-- Datum:     2026-07-20
-- Syfte:     Logga alla läs- och skrivoperationer mot property_sensitive_access
--            via get-sensitive-fields och set-sensitive-fields EF:er.
--
-- Loggas:
--   - Tid, användar-ID, e-post
--   - Åtgärd: 'read' eller 'write'
--   - Objekt-/fastighets-ID
--   - Fälttyper som berördes (INTE värdena)
--   - Status: 'allowed' (godkänd) eller 'denied' (nekad)
--
-- Loggas ALDRIG:
--   - Portkod, nyckelinformation, larmkod
--   - Signerade URL:er eller kompletta tokens
--   - Lösenord eller annan känslig data
--
-- Accessmodell:
--   - service_role: full access (EF:erna skriver)
--   - authenticated: kan LÄSA egna rader (own audit trail)
--   - anon: nekas allt
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS sensitive_access_audit;
-- ============================================================

CREATE TABLE IF NOT EXISTS sensitive_access_audit (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id      UUID,
  user_email   TEXT,
  action       TEXT        NOT NULL CHECK (action IN ('read', 'write')),
  object_id    TEXT,
  property_id  TEXT,
  fields       TEXT[],
  status       TEXT        NOT NULL CHECK (status IN ('allowed', 'denied')),
  detail       TEXT
);

-- Index för vanliga sökningar
CREATE INDEX IF NOT EXISTS idx_audit_ts         ON sensitive_access_audit (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_id    ON sensitive_access_audit (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_object_id  ON sensitive_access_audit (object_id) WHERE object_id IS NOT NULL;

-- ── GRANT/REVOKE ───────────────────────────────────────────────
REVOKE ALL ON sensitive_access_audit FROM anon;
REVOKE ALL ON sensitive_access_audit FROM authenticated;
GRANT SELECT ON sensitive_access_audit TO authenticated;  -- egna rader via RLS nedan
GRANT INSERT ON sensitive_access_audit TO service_role;
GRANT SELECT ON sensitive_access_audit TO service_role;

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE sensitive_access_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_own_read"      ON sensitive_access_audit;
DROP POLICY IF EXISTS "audit_service_write" ON sensitive_access_audit;
DROP POLICY IF EXISTS "audit_service_all"   ON sensitive_access_audit;

-- Authenticated: kan bara läsa sina egna loggposter
CREATE POLICY "audit_own_read"
  ON sensitive_access_audit FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- service_role: full access (EF:erna skriver + adminverktyg läser)
CREATE POLICY "audit_service_all"
  ON sensitive_access_audit FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated och anon kan INTE skriva (skyddas av REVOKE + RLS)
-- Auditloggen är immutabel från klientsidans perspektiv.


-- ── Verifiera (kör i SQL Editor efter migration) ────────────────
-- 1. Tabell finns med korrekt schema:
--      \d sensitive_access_audit
--
-- 2. authenticated nekas INSERT:
--      SET ROLE authenticated;
--      INSERT INTO sensitive_access_audit (action, status) VALUES ('read', 'allowed');
--      → ERROR: permission denied
--      RESET ROLE;
--
-- 3. authenticated kan läsa egna rader (efter att EF skrivit):
--      SELECT * FROM sensitive_access_audit
--        WHERE user_id = auth.uid()
--        ORDER BY ts DESC LIMIT 10;
--
-- 4. Typiska auditloggfrågor (kör som service_role/admin):
--      -- Alla nekade försök senaste 24h:
--      SELECT * FROM sensitive_access_audit
--        WHERE status = 'denied' AND ts > now() - interval '24 hours'
--        ORDER BY ts DESC;
--
--      -- Alla läsningar av ett specifikt objekt:
--      SELECT ts, user_email, action, fields, status
--        FROM sensitive_access_audit
--        WHERE object_id = 'OBJ-001'
--        ORDER BY ts DESC;
