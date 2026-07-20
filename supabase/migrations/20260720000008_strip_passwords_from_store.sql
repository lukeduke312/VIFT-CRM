-- ============================================================
-- Migration: Strip lösenordsfält ur vift_staff store-blob
-- Datum:     2026-07-20
-- Syfte:     Säkerställa att vift_staff-blobben ALDRIG innehåller
--            password, passwordHash eller tempPassword, oavsett
--            om något skrivit dit dem via CRM-klienten eller import.
--
-- Bakgrund:
--   Schema.staff() definierade ett passwordHash-fält som tagits bort.
--   DataSync strippade dessa fält på klientsidan vid läsning, men
--   råvärdena kunde fortfarande finnas lagrade i Supabase-store.
--   Denna migration rensar blobben permanent.
--
-- ROLLBACK:
--   Inga data återställs (lösenord ska aldrig ha funnits här).
--   Rollback i praktiken: ingenting att göra.
-- ============================================================

-- Strippa password, passwordHash, tempPassword, pin, secret ur vift_staff
-- Kör i transaktion — backas automatiskt om jsonb_agg misslyckas.
DO $$
DECLARE
  v_had_password_fields BOOLEAN := false;
BEGIN
  -- Kontrollera om blobben innehåller känsliga fält
  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT jsonb_array_elements(value) AS elem
      FROM store WHERE key = 'vift_staff'
    ) sub
    WHERE (sub.elem ? 'password') OR (sub.elem ? 'passwordHash') OR (sub.elem ? 'tempPassword')
       OR (sub.elem ? 'pin')      OR (sub.elem ? 'secret')
  ) INTO v_had_password_fields;

  IF v_had_password_fields THEN
    RAISE NOTICE 'VARNING: Lösenordsfält hittades i vift_staff. Strippar nu.';
  ELSE
    RAISE NOTICE 'OK: Inga lösenordsfält hittades i vift_staff-blobben.';
  END IF;

  -- Strippa oavsett — idempotent
  UPDATE store
  SET value = (
    SELECT jsonb_agg(
      elem
        - 'password'
        - 'passwordHash'
        - 'tempPassword'
        - 'pin'
        - 'secret'
        - 'apiKey'
        - 'accessToken'
    )
    FROM jsonb_array_elements(value) AS elem
  )
  WHERE key = 'vift_staff'
    AND value IS NOT NULL;

  -- Verifiera
  IF EXISTS (
    SELECT 1 FROM (
      SELECT jsonb_array_elements(value) AS elem
      FROM store WHERE key = 'vift_staff'
    ) sub
    WHERE (sub.elem ? 'password') OR (sub.elem ? 'passwordHash')
  ) THEN
    RAISE EXCEPTION 'Stripning misslyckades — lösenordsfält kvarstår.';
  END IF;

  RAISE NOTICE 'Strip klar. Lösenordsfält borttagna ur vift_staff.';
END;
$$;


-- ── Verifiera (kör i SQL Editor efter migration) ──────────────
-- 1. Inga lösenordsfält kvar:
--      SELECT jsonb_path_exists(value, '$[*].password')
--        FROM store WHERE key = 'vift_staff';
--      → false
--      SELECT jsonb_path_exists(value, '$[*].passwordHash')
--        FROM store WHERE key = 'vift_staff';
--      → false
--
-- 2. Övriga fält bevarade (namn, e-post, roll, m.m.):
--      SELECT jsonb_path_exists(value, '$[*].email')
--        FROM store WHERE key = 'vift_staff';
--      → true
