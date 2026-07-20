-- ============================================================
-- Migration: property_sensitive_access  (v2 — reversibel)
-- Datum:     2026-07-20
-- Syfte:     Separera känsliga objektfält från den delade store-blobben.
--            Portkod, nyckelinformation och larmuppgifter lagras i en
--            separat, hårt kontrollerad tabell utan direkt klientåtkomst.
--            Edge Function get-sensitive-fields (med objects_sensitive) är
--            den enda vägen att läsa dessa värden.
--
-- SÄKERHET:
--   - authenticated och anon har REVOKE ALL på tabellen
--   - Inga RLS-policyer för authenticated → deny-by-default
--   - Enbart service_role (EF) når tabellen
--
-- REVERSIBILITET:
--   Migrationen skapar backup-tabeller av blobbar INNAN stripning.
--   Rollback-SQL återställer originalblob ur backup utan manuell
--   JSON-manipulation.
--
-- ATOMICITET:
--   Migration och stripning körs i ett DO-block med explicit transaktion.
--   Om verifierat antal poster inte matchar förväntat antal → rollback.
--
-- ROLLBACK (kör i SQL Editor):
--   Se avsnittet "ROLLBACK-SQL" längst ned i denna fil.
-- ============================================================

-- ── Tabell: property_sensitive_access ─────────────────────────
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
REVOKE ALL ON property_sensitive_access FROM anon;
REVOKE ALL ON property_sensitive_access FROM authenticated;

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE property_sensitive_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "psa_service_role_all" ON property_sensitive_access;

CREATE POLICY "psa_service_role_all"
  ON property_sensitive_access FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated och anon: inga policyer = RLS deny-by-default


-- ── Backup-tabeller (INNAN all databearbetning) ─────────────────
-- Bevarar originaldata för säker rollback.
-- Tabellerna bevaras till rollbacken är verifierad och godkänd.
-- Ta bort med: DROP TABLE IF EXISTS store_backup_prop_objects_20260720;
--              DROP TABLE IF EXISTS store_backup_properties_20260720;

CREATE TABLE IF NOT EXISTS store_backup_prop_objects_20260720 AS
  SELECT key, value, now() AS backed_up_at
  FROM store
  WHERE key = 'vift_propertyObjects';

CREATE TABLE IF NOT EXISTS store_backup_properties_20260720 AS
  SELECT key, value, now() AS backed_up_at
  FROM store
  WHERE key = 'vift_properties';


-- ── Datamigration + stripning (atomisk) ────────────────────────
DO $$
DECLARE
  v_obj_count_expected   INT := 0;
  v_prop_count_expected  INT := 0;
  v_obj_count_inserted   INT := 0;
  v_prop_count_inserted  INT := 0;
BEGIN

  -- Räkna hur många rader som ska migreras INNAN INSERT
  SELECT count(*) INTO v_obj_count_expected
  FROM (
    SELECT jsonb_array_elements(value) AS elem
    FROM store WHERE key = 'vift_propertyObjects'
  ) sub
  WHERE (
    NULLIF(TRIM(sub.elem->>'doorCode'),          '') IS NOT NULL OR
    NULLIF(TRIM(sub.elem->>'keyInformation'),    '') IS NOT NULL OR
    NULLIF(TRIM(sub.elem->>'accessInformation'), '') IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM property_sensitive_access psa
    WHERE psa.object_id = sub.elem->>'id'
  );

  SELECT count(*) INTO v_prop_count_expected
  FROM (
    SELECT jsonb_array_elements(value) AS elem
    FROM store WHERE key = 'vift_properties'
  ) sub
  WHERE (
    NULLIF(TRIM(sub.elem->>'accessCode'), '') IS NOT NULL OR
    NULLIF(TRIM(sub.elem->>'keyInfo'),    '') IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM property_sensitive_access psa
    WHERE psa.property_id = sub.elem->>'id'
      AND psa.object_id IS NULL
  );

  RAISE NOTICE 'Förväntar % objektposter och % fastighetsposter att migrera',
               v_obj_count_expected, v_prop_count_expected;

  -- 1. Migrera från vift_propertyObjects
  --    OBS: WHERE-satsen använder explicit parenteser runt OR-villkoren
  --         för att undvika operatorprioritetsproblem (AND binder hårdare än OR).
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
  WHERE (
    NULLIF(TRIM(elem->>'doorCode'),          '') IS NOT NULL OR
    NULLIF(TRIM(elem->>'keyInformation'),    '') IS NOT NULL OR
    NULLIF(TRIM(elem->>'accessInformation'), '') IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM property_sensitive_access psa
    WHERE psa.object_id = sub.elem->>'id'
  );

  GET DIAGNOSTICS v_obj_count_inserted = ROW_COUNT;

  -- 2. Migrera från vift_properties
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
  WHERE (
    NULLIF(TRIM(sub.elem->>'accessCode'), '') IS NOT NULL OR
    NULLIF(TRIM(sub.elem->>'keyInfo'),    '') IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM property_sensitive_access psa
    WHERE psa.property_id = sub.elem->>'id'
      AND psa.object_id IS NULL
  );

  GET DIAGNOSTICS v_prop_count_inserted = ROW_COUNT;

  RAISE NOTICE 'Infogade: % objektposter, % fastighetsposter',
               v_obj_count_inserted, v_prop_count_inserted;

  -- Verifiering: räkna ska matcha förväntat
  IF v_obj_count_inserted <> v_obj_count_expected THEN
    RAISE EXCEPTION
      'Objektmigration mismatch: förväntade %, fick %. ROLLBACK.',
      v_obj_count_expected, v_obj_count_inserted;
  END IF;

  IF v_prop_count_inserted <> v_prop_count_expected THEN
    RAISE EXCEPTION
      'Fastighetsmigration mismatch: förväntade %, fick %. ROLLBACK.',
      v_prop_count_expected, v_prop_count_inserted;
  END IF;

  -- 3. Strip: ta bort känsliga fält ur store-blobbar
  --    Körs ENBART om ovanstående INSERT lyckades (annars har EXCEPTION kastats).

  UPDATE store
  SET value = (
    SELECT jsonb_agg(
      elem - 'doorCode' - 'keyInformation' - 'accessInformation'
    )
    FROM jsonb_array_elements(value) AS elem
  )
  WHERE key = 'vift_propertyObjects'
    AND value IS NOT NULL;

  UPDATE store
  SET value = (
    SELECT jsonb_agg(
      elem - 'accessCode' - 'keyInfo'
    )
    FROM jsonb_array_elements(value) AS elem
  )
  WHERE key = 'vift_properties'
    AND value IS NOT NULL;

  RAISE NOTICE 'Migration klar. Känsliga fält strippade ur store-blobbar.';
  RAISE NOTICE 'Backuptabeller: store_backup_prop_objects_20260720, store_backup_properties_20260720';
  RAISE NOTICE 'Ta INTE bort backuptabellerna förrän rollback är verifierad och godkänd.';

END;
$$;


-- ── Verifiera (kör i SQL Editor efter migration) ──────────────
-- 1. Antal migrerade känsliga poster:
--      SELECT count(*) FROM property_sensitive_access;
--
-- 2. Känsliga fält borttagna ur store:
--      SELECT jsonb_path_exists(value, '$[*].doorCode')
--        FROM store WHERE key = 'vift_propertyObjects';
--      → false
--
--      SELECT jsonb_path_exists(value, '$[*].accessCode')
--        FROM store WHERE key = 'vift_properties';
--      → false
--
-- 3. Backuptabeller finns:
--      SELECT count(*) FROM store_backup_prop_objects_20260720;
--      SELECT count(*) FROM store_backup_properties_20260720;
--
-- 4. Authenticated nekas direkt åtkomst:
--      SET ROLE authenticated;
--      SELECT * FROM property_sensitive_access;
--      → ERROR: permission denied
--      RESET ROLE;
--
-- 5. EF returnerar data:
--      curl -X POST <URL>/functions/v1/get-sensitive-fields \
--        -H "Authorization: Bearer <JWT-med-objects_sensitive>" \
--        -d '{"objectId":"OBJ-001"}'
--      → { "doorCode": "...", ... }


-- ============================================================
-- ROLLBACK-SQL
-- Återställer originalblob ur backup utan manuell JSON-manipulation.
-- Kör ENBART om EF-verifiering misslyckades och återgång är beslutad.
-- Varning: ångrar INTE INSERT-rader i property_sensitive_access.
--          Om rader lagts till via EF (set-sensitive-fields) efter
--          migrationen bevaras de — de ursprungliga store-fälten
--          återläggs ovanpå, vilket ger dubblering av ev. ändringar.
--
--   -- Steg 1: Återlägg vift_propertyObjects-blob
--   UPDATE store
--   SET value = (SELECT value FROM store_backup_prop_objects_20260720 LIMIT 1)
--   WHERE key = 'vift_propertyObjects';
--
--   -- Steg 2: Återlägg vift_properties-blob
--   UPDATE store
--   SET value = (SELECT value FROM store_backup_properties_20260720 LIMIT 1)
--   WHERE key = 'vift_properties';
--
--   -- Steg 3 (valfritt, EFTER verifierad återgång):
--   DROP TABLE IF EXISTS property_sensitive_access;
--   DROP TABLE IF EXISTS store_backup_prop_objects_20260720;
--   DROP TABLE IF EXISTS store_backup_properties_20260720;
-- ============================================================
