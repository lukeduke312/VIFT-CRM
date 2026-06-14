-- VIFT CRM — Supabase setup
-- Kör i: Supabase Dashboard → SQL Editor → Run

CREATE TABLE IF NOT EXISTS public.store (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT 'null'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pilot: tillåt alla operationer (lås ner med RLS när riktig auth läggs till)
ALTER TABLE public.store DISABLE ROW LEVEL SECURITY;
