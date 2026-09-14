-- ============================================================
-- Migration: Storage-bucket project-documents (privat, RLS)
-- Datum:     2026-09-07
-- Syfte:     Skapa en PRIVAT Storage-bucket för Projekt-dokument
--            (V54C1 Part C), generaliserad direkt från den redan
--            godkända offer-attachments-migrationen
--            (20260720000002_storage_offer_attachments.sql). Alla
--            nedladdningar sker via signerade URL:er med begränsad
--            giltighetstid — ALDRIG en permanent publik URL.
--
-- ROLLBACK:
--   DELETE FROM storage.policies WHERE bucket_id = 'project-documents';
--   UPDATE storage.buckets SET public = false WHERE id = 'project-documents';
--   -- (bucketen förblir men utan policies — inga anrop går igenom)
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-documents',
  'project-documents',
  false,                  -- ALDRIG publik
  52428800,               -- 50 MB max — samma gräns som offer-attachments
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public            = false,
      file_size_limit   = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ── RLS-policyer för storage.objects ─────────────────────────
-- Anon/authenticated ska ALDRIG kunna läsa/skriva bucketen direkt.
-- All access sker via service_role i Edge Functions
-- (project-document-upload / project-document-url), som utfärdar
-- tidsbegränsade signerade URL:er (max 600s).

CREATE POLICY "project-documents service_role insert"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'project-documents');

CREATE POLICY "project-documents service_role select"
  ON storage.objects FOR SELECT
  TO service_role
  USING (bucket_id = 'project-documents');

CREATE POLICY "project-documents service_role delete"
  ON storage.objects FOR DELETE
  TO service_role
  USING (bucket_id = 'project-documents');

-- Anon och authenticated nekas allt (inga fler policyer = RLS deny)


-- ── Noteringar ───────────────────────────────────────────────
-- 1. INGEN ny SQL-tabell krävs. Dokument-METADATA lagras i den
--    redan befintliga generiska `store`-tabellen under nyckeln
--    `vift_projectDocuments` — exakt samma mönster som
--    `vift_offerAttachments`/`vift_projects` redan använder. Detta
--    är en medveten, granskad återanvändning av den arkitektur som
--    redan finns, inte en genväg.
--
-- 2. Sökvägsformatet är:
--      {projectId}/{documentId}/{sanitized-filename}
--    Traversal blockeras i project-document-url via regex-validering
--    på storagePath-fältet ('/..'-kontroll), identiskt med
--    offer-attachment-url.
--
-- 3. Verifiera att bucketen är privat:
--      SELECT public FROM storage.buckets WHERE id = 'project-documents';
--      -- Förväntat resultat: false
--
-- 4. Ett dokument i Projekt PRJ1 kan aldrig hämtas/raderas med ett
--    manipulerat documentId + ett godtyckligt projectId, eftersom
--    både project-document-url och project-document-upports DELETE-
--    väg jämför mot dokumentets EGEN lagrade projectId, inte mot ett
--    klientpåstått värde.
