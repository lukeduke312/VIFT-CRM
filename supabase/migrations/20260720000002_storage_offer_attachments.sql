-- ============================================================
-- Migration: Storage-bucket offer-attachments (privat, RLS)
-- Datum:     2026-07-20
-- Syfte:     Säkerställa att offer-attachments-bucketen är
--            PRIVAT och att inga permanenta publika URL:er
--            kan genereras. Alla nedladdningar sker via
--            signerade URL:er med begränsad giltighetstid.
--
-- ROLLBACK:
--   DELETE FROM storage.policies WHERE bucket_id = 'offer-attachments';
--   UPDATE storage.buckets SET public = false WHERE id = 'offer-attachments';
--   -- (bucketen förblir men utan policies — inga anrop går igenom)
-- ============================================================

-- ── Säkerställ att bucketen existerar och är PRIVAT ──────────
-- Om bucketen inte existerar — skapa den.
-- Om den redan finns — sätt public = false.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'offer-attachments',
  'offer-attachments',
  false,                  -- ALDRIG publik
  52428800,               -- 50 MB max
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/tiff',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.ms-excel',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/x-dwg',
    'image/vnd.dwg',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public            = false,
      file_size_limit   = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ── RLS-policyer för storage.objects ─────────────────────────
-- Supabase Storage använder storage.objects som RLS-skyddad tabell.
-- Anon-rollen ska ALDRIG kunna läsa eller skriva till bucketen.
-- Autentiserade användare kan heller inte nå den direkt —
-- all access sker via service_role i Edge Functions,
-- som utfärdar tidsbegränsade signerade URL:er (max 3600s).

-- Tillåt service_role att ladda upp filer (offer-attachment-upload EF)
CREATE POLICY "offer-attachments service_role insert"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'offer-attachments');

-- Tillåt service_role att läsa filer (för signerad URL, offer-attachment-url EF)
CREATE POLICY "offer-attachments service_role select"
  ON storage.objects FOR SELECT
  TO service_role
  USING (bucket_id = 'offer-attachments');

-- Tillåt service_role att ta bort filer (mjuk delete via EF)
CREATE POLICY "offer-attachments service_role delete"
  ON storage.objects FOR DELETE
  TO service_role
  USING (bucket_id = 'offer-attachments');

-- Anon och authenticated nekas allt (inga fler policyer = RLS deny)


-- ── Noteringar ───────────────────────────────────────────────
-- 1. Signerade URL:er genereras av offer-attachment-url EF med:
--      supabase.storage.from('offer-attachments').createSignedUrl(path, 600)
--    URL:erna är tidsbegränsade (10 min) och reusable under TTL — INTE engångs-URL.
--    Ny signerad URL genereras per nedladdningsanrop. URL:en loggas aldrig.
--
-- 2. Sökvägsformatet är:
--      {offerId}/{attachmentId}/{sanitized-filename}
--    Traversal blockeras i offer-attachment-url via regex-validering
--    på storagePath-fältet ('/..'-kontroll).
--
-- 3. För att verifiera att bucketen är privat, kör i SQL Editor:
--      SELECT public FROM storage.buckets WHERE id = 'offer-attachments';
--      -- Förväntat resultat: false
--
-- 4. Token A kan inte hämta bilaga från offert B eftersom
--    offer-attachment-url verifierar att:
--      att.offerId === off.id  (bilagan tillhör rätt offert)
--      att.includeInPublicView === true  (kundsynlig)
--      off.publicToken === customerToken  (rätt token)
