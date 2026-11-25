-- ============================================================
-- ÅTERSTÄLLD 2026-11-27 ur STAGING:s migrationshistorik (G1/G4 del 2).
-- Källa: supabase_migrations.schema_migrations, version 20261117085458, i STAGING
-- (yyzljlqyzzcbxmcdbual). Allt efter markören INNEHÅLL nedan, fram till
-- den avslutande raden ";", är EXAKT array_to_string(statements, E';\n')
-- (md5 6234601436bdc57211cab2f10ec14826, samma fil som
-- inventering/staging-2026-11-26/migrations-applicerade/20261117085458_staging_stamp_status_identity_scoped_cas_20261117.sql).
-- Supabase CLI sparar statements utan avslutande semikolon; ett ";" har
-- därför lagts till sist. Ingen annan ändring.
-- ============================================================
-- INNEHÅLL
begin;

create table if not exists public.stamp_status (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  active     boolean not null default false,
  ts         bigint,
  ao_id      text,
  -- SERVER-owned revision counter (round 4 — replaces the client-supplied
  -- `seq` from round 3). Starts at 0 for a brand-new row (no prior write),
  -- bumped by exactly 1 on every accepted write. Never set directly from
  -- a client-supplied value.
  revision   bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.stamp_status enable row level security;

drop policy if exists stamp_status_select_own on public.stamp_status;
drop policy if exists stamp_status_insert_own on public.stamp_status;
drop policy if exists stamp_status_update_own on public.stamp_status;
create policy stamp_status_select_own on public.stamp_status
  for select to authenticated using (auth.uid() = user_id);
create policy stamp_status_insert_own on public.stamp_status
  for insert to authenticated with check (auth.uid() = user_id);
create policy stamp_status_update_own on public.stamp_status
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Deliberately NO delete policy for `authenticated` — nobody but
-- service_role (which bypasses RLS) can ever delete a row through
-- PostgREST, regardless of whose row it is.

revoke all on public.stamp_status from public, anon, authenticated;
-- No grant to `authenticated` at all (round 3's fix, unchanged) — the
-- policies above exist only as defense-in-depth, never relied on alone.

create or replace function public.store_read_stamp_status(p_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.stamp_status;
begin
  if p_auth_user_id is null then
    raise exception 'store_read_stamp_status: p_auth_user_id required' using errcode = '22023';
  end if;
  select * into v_row from public.stamp_status where user_id = p_auth_user_id;
  if not found then
    -- P2-2 migration-safety (round 3, unchanged): `hasRow:false` means
    -- "never written" — NOT "confirmed clocked out". `revision` 0 is the
    -- correct `p_expected_revision` for this user's FIRST write.
    return jsonb_build_object('active', false, 'ts', null, 'aoId', null, 'hasRow', false, 'revision', 0);
  end if;
  return jsonb_build_object('active', v_row.active, 'ts', v_row.ts, 'aoId', v_row.ao_id, 'hasRow', true, 'revision', v_row.revision);
end;
$$;

create or replace function public.store_write_stamp_status(
  p_auth_user_id        uuid,
  p_active              boolean,
  p_ts                  bigint,
  p_ao_id               text,
  p_expected_revision   bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       public.stamp_status;
  v_cur_rev   bigint;
  v_new_ts    bigint := case when p_active then p_ts else null end;
  v_new_ao_id text   := case when p_active then p_ao_id else null end;
  v_now       timestamptz := now();
begin
  if p_auth_user_id is null then
    raise exception 'store_write_stamp_status: p_auth_user_id required' using errcode = '22023';
  end if;
  if p_active is null then
    raise exception 'store_write_stamp_status: p_active required' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'store_write_stamp_status: p_expected_revision required' using errcode = '22023';
  end if;

  -- CONCURRENT FIRST-WRITE GUARD (2026-11-17): the row-level FOR UPDATE
  -- lock below only serializes writes if the row ALREADY EXISTS. Two
  -- first-ever writes could both see no row and reach the ON CONFLICT
  -- clause, whose unconditional DO UPDATE would overwrite the winner
  -- without comparing expected_revision. Serialize by verified auth UUID
  -- BEFORE the read so this race is also safe when no row exists.
  -- Hash collisions only cause additional serialization, never leakage:
  -- all state reads/writes still filter on the full UUID.
  perform pg_advisory_xact_lock(hashtextextended('vift_stamp_status:' || p_auth_user_id::text, 0));

  -- Row lock FIRST (same ordering discipline as every other revision-
  -- checked RPC in this codebase) — this is what makes the whole
  -- check-then-write atomic: no other writer for this SAME user_id can
  -- interleave between the read below and the write further down.
  select * into v_row from public.stamp_status where user_id = p_auth_user_id for update;
  v_cur_rev := coalesce(v_row.revision, 0);

  if v_cur_rev <> p_expected_revision then
    -- A different write already landed since the caller last read this
    -- row. Decide: genuine idempotent retry (accept, no-op) or a real
    -- conflict between two DIFFERENT operations (reject)?
    if v_row.user_id is not null
       and v_row.active = p_active
       and coalesce(v_row.ts, -1) = coalesce(v_new_ts, -1)
       and coalesce(v_row.ao_id, '') = coalesce(v_new_ao_id, '')
    then
      -- Byte-identical to what is already stored: this is the SAME
      -- logical write being retried (e.g. a dropped response, resent) —
      -- accept as a no-op, do not bump revision again.
      return jsonb_build_object('active', v_row.active, 'ts', v_row.ts, 'aoId', v_row.ao_id, 'hasRow', true, 'revision', v_row.revision, 'stale', false, 'replayed', true);
    end if;
    -- Genuinely different content under a stale expected revision: a REAL
    -- conflict (e.g. two devices both read revision 3, one clocked in,
    -- the other clocked out — whichever commits first wins, the other
    -- MUST be told to re-read, never silently overwritten or silently
    -- dropped). Return the actual current row so the caller can reconcile.
    return jsonb_build_object('active', coalesce(v_row.active, false), 'ts', v_row.ts, 'aoId', v_row.ao_id, 'hasRow', v_row.user_id is not null, 'revision', v_cur_rev, 'stale', true, 'replayed', false);
  end if;

  -- Revision matches what the caller last observed — safe to apply,
  -- atomically, under the still-held row lock.
  insert into public.stamp_status (user_id, active, ts, ao_id, revision, updated_at)
    values (p_auth_user_id, p_active, v_new_ts, v_new_ao_id, 1, v_now)
  on conflict (user_id) do update set
    active = excluded.active, ts = excluded.ts, ao_id = excluded.ao_id,
    revision = public.stamp_status.revision + 1, updated_at = excluded.updated_at;

  return jsonb_build_object('active', p_active, 'ts', v_new_ts, 'aoId', v_new_ao_id, 'hasRow', true, 'revision', v_cur_rev + 1, 'stale', false, 'replayed', false);
end;
$$;

alter function public.store_read_stamp_status(uuid) owner to postgres;
alter function public.store_write_stamp_status(uuid, boolean, bigint, text, bigint) owner to postgres;
revoke all on function public.store_read_stamp_status(uuid) from public, anon, authenticated;
revoke all on function public.store_write_stamp_status(uuid, boolean, bigint, text, bigint) from public, anon, authenticated;
grant execute on function public.store_read_stamp_status(uuid) to service_role;
grant execute on function public.store_write_stamp_status(uuid, boolean, bigint, text, bigint) to service_role;

notify pgrst, 'reload schema';
commit;
;
