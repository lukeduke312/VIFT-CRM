-- ============================================================
-- Migration: property_sensitive_access
-- Datum:     2026-07-20
-- Syfte:     Separera känsliga objektfält från den delade store-blobben.
--            Portkod, nyckelinformation och larmuppgifter lagras nu i
--            en separat, hårt kontrollerad tabell.
--            Enbart Edge Function get-sensitive-fields (med giltig JWT
--            + objects_sensitive-rättighet) returnerar dessa värden.
--            Autentiserade frontend-klienter kan INTE nå tabellen direkt.
--
-- Berörda fält (migreras från store-blobbar):
--   vift_propertyObjects[].accessInformation → access_information
--   vift_propertyObjects[].doorCode          → door_code
--   vift_propertyObjects[].keyInformation    → key_information
--   vift_properties[].accessCode             → access_code
--   vift_properties[].keyInfo                → key_information (property-nivå)
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS property_sensitive_access;
--   -- Befintlig data kan återföras till store-blobbar via set-sensitive-fields EF
--   -- eller via manuell SQL om backupdata finns.
-- ============================================================

-- ── Tabell ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_sensitive_access (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         TEXT,
  object_id           TEXT,
  door_code           TEXT,
  key_information     TEXT,
  key_receipt         TEXT,
  alarm_information   TEXT,
  access_information  TEXT,
  access_code         TEXT,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by          TEXT,
  CONSTRAINT psa_at_least_one_id CHECK (property_id IS NOT NULL OR object_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_psa_object_id
  ON property_sensitive_access (object_id)
  WHERE object_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_psa_property_id
  ON property_sensitive_access (property_id)
  WHERE property_id IS NOT NULL;

-- ── Explicit GRANT/REVOKE ──────────────────────────────────────
-- authenticated och anon får INGA tabellprivilegier.
-- All åtkomst sker via service_role i EFs.

REVOKE ALL ON property_sensitive_access FROM anon;
REVOKE ALL ON property_sensitive_access FROM authenticated;

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE property_sensitive_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "psa_service_role_all" ON property_sensitive_access;

-- service_role: full access (get-sensitive-fields och set-sensitive-fields EF)
CREATE POLICY "psa_service_role_all"
  ON property_sensitive_access FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated och anon: inga policyer = RLS deny-by-default


-- ── Datamigration: extrahera från store-blobbar ────────────────
-- Säker att köra om: INSERT WHERE NOT EXISTS förhindrar dubbletter.
-- Migrerar bara poster som har minst ett icke-tomt känsligt fält.

-- 1. Migrera från vift_propertyObjects
INSERT INTO property_sensitive_access
  (object_id, property_id, door_code, key_information, access_information, updated_at, updated_by)
SELECT
  elem->>'id'                                          AS object_id,
  elem->>'propertyId'                                  AS property_id,
  NULLIF(TRIM(elem->>'doorCode'),          '')         AS door_code,
  NULLIF(TRIM(elem->>'keyInformation'),    '')         AS key_information,
  NULLIF(TRIM(elem->>'accessInformation'), '')         AS access_information,
  now()                                                AS updated_at,
  'migration-20260720'                                 AS updated_by
FROM (
  SELECT jsonb_array_elements(value) AS elem
  FROM store
  WHERE key = 'vift_propertyObjects'
) sub
WHERE
  NULLIF(TRIM(elem->>'doorCode'),          '') IS NOT NULL OR
  NULLIF(TRIM(elem->>'keyInformation'),    '') IS NOT NULL OR
  NULLIF(TRIM(elem->>'accessInformation'), '') IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM property_sensitive_access psa
  WHERE psa.object_id = elem->>'id'
);

-- 2. Migrera från vift_properties (fastighets-nivå accessCode + keyInfo)
INSERT INTO property_sensitive_access
  (property_id, object_id, access_code, key_information, updated_at, updated_by)
SELECT
  elem->>'id'                                   AS property_id,
  NULL                                          AS object_id,
  NULLIF(TRIM(elem->>'accessCode'), '')         AS access_code,
  NULLIF(TRIM(elem->>'keyInfo'),    '')         AS key_information,
  now()                                         AS updated_at,
  'migration-20260720'                          AS updated_by
FROM (
  SELECT jsonb_array_elements(value) AS elem
  FROM store
  WHERE key = 'vift_properties'
) sub
WHERE
  NULLIF(TRIM(elem->>'accessCode'), '') IS NOT NULL OR
  NULLIF(TRIM(elem->>'keyInfo'),    '') IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM property_sensitive_access psa
  WHERE psa.property_id = elem->>'id'
    AND psa.object_id IS NULL
);


-- ── Strip: ta bort känsliga fält ur store-blobbar ──────────────
-- VIKTIGT: Kör BARA detta om datamigration ovan lyckades.
-- Verifiera med: SELECT count(*) FROM property_sensitive_access; (> 0 om data finns)
--
-- Tar bort doorCode, keyInformation, accessInformation ur vift_propertyObjects.
UPDATE store
SET value = (
  SELECT jsonb_agg(
    elem - 'doorCode' - 'keyInformation' - 'accessInformation'
  )
  FROM jsonb_array_elements(value) AS elem
)
WHERE key = 'vift_propertyObjects'
  AND value IS NOT NULL;

-- Tar bort accessCode, keyInfo ur vift_properties.
UPDATE store
SET value = (
  SELECT jsonb_agg(
    elem - 'accessCode' - 'keyInfo'
  )
  FROM jsonb_array_elements(value) AS elem
)
WHERE key = 'vift_properties'
  AND value IS NOT NULL;


-- ── Verifiera (kör i SQL Editor efter migration) ────────────────
-- 1. Antal migrerade känsliga poster:
--      SELECT count(*) FROM property_sensitive_access;
--
-- 2. Känsliga fält borttagna ur store-blobben:
--      SELECT jsonb_path_exists(value, '$[*].doorCode')
--        FROM store WHERE key = 'vift_propertyObjects';
--      → false (doorCode borttagen)
--
--      SELECT jsonb_path_exists(value, '$[*].accessCode')
--        FROM store WHERE key = 'vift_properties';
--      → false
--
-- 3. Authenticated nekas direkt access:
--      SET ROLE authenticated;
--      SELECT count(*) FROM property_sensitive_access;
--      → ERROR: permission denied
--      RESET ROLE;
--
-- 4. EF get-sensitive-fields returnerar data korrekt för behörig användare:
--      curl -X POST <SUPABASE_URL>/functions/v1/get-sensitive-fields \
--        -H "Authorization: Bearer <JWT-med-objects_sensitive>" \
--        -H "Content-Type: application/json" \
--        -d '{"objectId":"OBJ-001"}'
--      → { "doorCode": "...", ... }
