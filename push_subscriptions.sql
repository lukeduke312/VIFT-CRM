-- ============================================================
-- VIFT CRM — Push Subscriptions
-- Kör i Supabase Dashboard → SQL Editor
-- ============================================================

-- Tabell för Web Push-subscriptions (en rad per enhet/browser)
create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth_key     text not null,
  platform     text,          -- 'iPhone', 'Android', 'Desktop'
  browser      text,          -- 'safari', 'chrome', 'firefox'
  device_label text default 'Min enhet',
  created_at   timestamptz default now(),
  last_seen_at timestamptz default now(),
  revoked_at   timestamptz,   -- satt när subscription är ogiltig (410 Gone)
  unique(endpoint)
);

-- RLS: användare hanterar bara egna subscriptions
alter table push_subscriptions enable row level security;

create policy "push_subscriptions_own"
  on push_subscriptions for all
  using (user_id = auth.uid());

-- Service role (Edge Function) kan läsa alla subscriptions för att skicka push
-- (Edge Function använder service_role key, kringgår RLS automatiskt)
