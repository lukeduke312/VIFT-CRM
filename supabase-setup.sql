-- ============================================================
-- VIFT CRM — Supabase setup (Fas 0 + Fas 1)
-- Kör i: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ── STEG 1: Skapa store-tabellen (om den inte redan finns) ──
CREATE TABLE IF NOT EXISTS public.store (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT 'null'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── STEG 2 (Fas 0): Aktivera RLS ──────────────────────────
-- Blockerar ALL anon-access. Kör detta även om tabellen redan finns.

ALTER TABLE public.store ENABLE ROW LEVEL SECURITY;

-- ── STEG 3: Policies — bara inloggade användare har access ─
-- (ta bort gamla om de finns: DROP POLICY IF EXISTS "..." ON public.store;)

CREATE POLICY "authenticated_select" ON public.store
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_insert" ON public.store
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "authenticated_update" ON public.store
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_delete" ON public.store
  FOR DELETE USING (auth.role() = 'authenticated');

-- ── STEG 4 (Fas 1): Skapa Supabase Auth-användare ─────────
-- Gör detta manuellt i Supabase Dashboard:
-- Authentication → Users → Add user → Create new user
-- Markera "Auto Confirm User"
--
-- E-post            Lösenord        Roll i systemet
-- admin@vift.se     (välj säkert)   admin
-- erik@vift.se      (välj säkert)   personal
-- maria@vift.se     (välj säkert)   chef
-- jonas@vift.se     (välj säkert)   personal
-- sofia@vift.se     (välj säkert)   personal
-- emma@vift.se      (välj säkert)   ekonomi
--
-- E-posten MÅSTE matcha fältet email i staff-posten i systemet.
-- Login sker med e-post + lösenord (inte längre användarnamn).

-- ── STEG 5: Verifiera ──────────────────────────────────────
-- Kontrollera att RLS är aktiverat:
SELECT schemaname, tablename, rowsecurity
FROM pg_tables WHERE tablename = 'store';
-- Förväntat: rowsecurity = true

-- Kontrollera policies:
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'store';
-- Förväntat: 4 rader (authenticated_select/insert/update/delete)
