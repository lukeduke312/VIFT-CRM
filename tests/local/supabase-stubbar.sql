-- Minimala Supabase-stubbar för en tom lokal PostgreSQL (G1/G4 del 2, 2026-11-27).
-- Detta är INTE Supabase. Stubbarna räcker för att migrationskedjan ska gå att köra
-- och för att jämföra funktioner, policyer, triggers och grants mot STAGING.
-- Skillnaderna mot riktig Supabase står i supabase/inventering/G1-G4-DEL2-RESULTAT.md.

-- Roller (klusterglobala; skapas bara om de saknas).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

-- Schema public som i Supabase: USAGE för PUBLIC och de tre API-rollerna.
grant usage on schema public to public, anon, authenticated, service_role;

-- Supabase ger API-rollerna rättigheter på allt som postgres skapar i public.
-- Därför har t.ex. hjälpfunktioner utan uttrycklig REVOKE EXECUTE för anon.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;

-- extensions-schemat med pgcrypto (gen_random_bytes, digest m.m.), som i Supabase.
create schema if not exists extensions;
grant usage on schema extensions to public, anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;

-- auth: bara det migrationerna och RLS-policyerna använder.
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), auth.jwt() ->> 'sub'), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), auth.jwt() ->> 'role')
$$;
grant execute on function auth.jwt(), auth.uid(), auth.role() to public;

-- storage: tabellerna buckets och objects med de kolumner migrationerna använder.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  user_metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now()
);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
grant all on storage.buckets, storage.objects to service_role;
grant select on storage.buckets, storage.objects to anon, authenticated;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

-- Supabase lägger extensions i sökvägen; lokalt sätts den per databas av skriptet:
--   alter database <db> set search_path = "$user", public, extensions;
