-- A4 (2026-11-17) — closes the two concrete, named direct-write gaps left
-- open by the 20261117 candidate package's own README
-- ("vift_notifications, vift_lastChanged, vift_serviceMonitorLog, and
-- legacy vift_stampActive/vift_stampTs/vift_stampAoId remain" -- see
-- candidate/20261117/README_GO_NO_GO.md).
--
-- Investigated against the ACTUAL client source in this repo before
-- writing this (not guessed):
--   - vift_stampActive/vift_stampTs/vift_stampAoId: grep confirms NO
--     client code writes these anymore (round 3/4 moved stamping
--     entirely to the dedicated public.stamp_status table). Safe to
--     block ALL authenticated writes outright -- no workflow depends on
--     these three keys any more.
--   - vift_serviceMonitorLog: not referenced anywhere in src/ at all --
--     written only by the service-monitor Edge Function, which uses its
--     own X-Monitor-Secret auth and the service_role client (bypasses
--     this trigger's role check entirely, same as every SECURITY
--     DEFINER RPC). Safe to block ALL authenticated/anon writes outright.
--   - vift_notifications: src/data/state.js's persistNotifs() legitimately
--     writes this key DIRECTLY via Storage.setRemoteStrict() (a raw
--     PostgREST upsert, not through any EF/RPC) every time a user pushes
--     or marks a notification read -- blocking it outright would break a
--     real, currently-used workflow. Closing this one requires allowing
--     the write but validating its SHAPE and that no authenticated write
--     can silently corrupt or erase another user's EXISTING notification
--     content -- only the `read` flag on an existing entry may change via
--     this path; nothing else about an existing entry may be added,
--     removed or altered. NotificationsService.push()'s own choice to let
--     any authenticated user notify any OTHER userId is pre-existing,
--     accepted application behavior (e.g. assigning staff notifies them)
--     and is NOT restricted here -- only non-consensual tampering with an
--     EXISTING notification's content is.
--   - vift_lastChanged: written directly, as `authenticated`, from MANY
--     call sites across the whole client (every persist()/setRemoteStrict
--     call bumps it as a cheap "something changed, re-poll" signal) --
--     this is not a security-sensitive value (no authorization or
--     financial decision reads it), so it is deliberately left writable
--     here; locking it down would break the poll-signal flow broadly for
--     near-zero real security benefit. Documented, not silently ignored.
--
-- Deliberately a NEW, ADDITIONAL trigger/function -- does NOT touch,
-- redefine, or depend on the existing, already-deployed
-- `_protect_critical_store_keys()` trigger (its real source is not in
-- this repo; this migration never risks it). Postgres fires every BEFORE
-- trigger on a table/event, so this is purely additive: every key this
-- trigger does not name passes straight through untouched, exactly as
-- today.
--
-- REFERENCE MIGRATION. NOT EXECUTED. Run as postgres, STAGING first,
-- after Lucas's explicit GO.
begin;

-- Deliberately INVOKER rights (the default -- no `security definer`). A
-- validating trigger needs no elevated privileges of its own (it only
-- ever inspects the row already being written in the same statement).
-- CAUGHT IN LOCAL TESTING (real local Postgres, see this round's own
-- report): an earlier draft of this file marked the function `security
-- definer`. Inside a SECURITY DEFINER function, `current_user` resolves
-- to the FUNCTION OWNER (postgres) for as long as that function runs --
-- not the role that actually fired the statement. That silently made the
-- `current_user = 'postgres'` exemption below true for EVERY caller, so
-- the guard never fired for anyone; a real authenticated test write
-- went straight through unblocked. Removing `security definer` fixes
-- this: as an ordinary invoker-rights trigger function, `current_user`
-- here genuinely reflects whoever is executing the write right now.
create or replace function public._protect_notifications_and_legacy_keys()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_key       text := coalesce(new.key, old.key);
  v_old       jsonb;
  v_new       jsonb;
  v_old_by_id jsonb;
  v_new_by_id jsonb;
  v_id        text;
  v_oe        jsonb;
  v_ne        jsonb;
begin
  -- Every SECURITY DEFINER RPC in this codebase (invoice_*, store_*,
  -- sensitive_fields_write, etc.) is owned by `postgres`. When one of
  -- those RPCs does its own `insert/update ... public.store` from
  -- PL/pgSQL, THIS trigger fires as part of that same write statement,
  -- and because the RPC itself (not this trigger) is SECURITY DEFINER,
  -- `current_user` for the duration of the RPC's body -- and therefore
  -- for this trigger's firing inside it -- genuinely IS `postgres`, the
  -- RPC's owner. So this check correctly exempts every such RPC's own
  -- writes, while still seeing the real caller (`authenticated`/`anon`)
  -- for a direct REST write that never goes through any RPC at all.
  if current_user = 'postgres' then
    return coalesce(new, old);
  end if;
  -- The service-monitor and other EFs that legitimately write with the
  -- service-role key run as `service_role`, which already bypasses RLS;
  -- this trigger does not add a SEPARATE restriction on top of that.
  if current_user = 'service_role' then
    return coalesce(new, old);
  end if;

  -- A4 bypass guard: on UPDATE, checking only NEW.key is insufficient.
  -- An authenticated caller could rename an EXISTING protected key to an
  -- unprotected key and bypass both the legacy-key and notification
  -- content-integrity checks below. Forbid renames in either direction
  -- whenever EITHER side of the rename is a protected key.
  if TG_OP = 'UPDATE'
     and old.key is distinct from new.key
     and (
       old.key in ('vift_notifications', 'vift_stampActive', 'vift_stampTs',
                   'vift_stampAoId', 'vift_serviceMonitorLog')
       or new.key in ('vift_notifications', 'vift_stampActive', 'vift_stampTs',
                      'vift_stampAoId', 'vift_serviceMonitorLog')
     ) then
    raise exception 'direct_write_blocked' using errcode = '42501';
  end if;

  if v_key in ('vift_stampActive', 'vift_stampTs', 'vift_stampAoId', 'vift_serviceMonitorLog') then
    raise exception 'direct_write_blocked' using errcode = '42501';
  end if;

  if v_key = 'vift_notifications' then
    if TG_OP = 'DELETE' then
      raise exception 'direct_write_blocked' using errcode = '42501';
    end if;
    v_new := new.value;
    if jsonb_typeof(v_new) <> 'array' then
      raise exception 'direct_write_blocked' using errcode = '42501';
    end if;
    if jsonb_array_length(v_new) > 5000 then
      raise exception 'direct_write_blocked' using errcode = '42501';
    end if;
    -- Reject duplicate/missing identifiers: jsonb_object_agg() otherwise
    -- collapses duplicate keys and defeats the per-item tamper check.
    if exists (
      select 1 from jsonb_array_elements(v_new) e
      where nullif(e->>'id','') is null or nullif(e->>'createdAt','') is null
    ) or (select count(distinct e->>'id') from jsonb_array_elements(v_new) e)
         <> jsonb_array_length(v_new) then
      raise exception 'direct_write_blocked' using errcode = '42501';
    end if;
    v_old := coalesce(old.value, '[]'::jsonb);
    if jsonb_typeof(v_old) <> 'array' then
      v_old := '[]'::jsonb;
    end if;

    select coalesce(jsonb_object_agg(e ->> 'id', e), '{}'::jsonb) into v_old_by_id
      from jsonb_array_elements(v_old) e where e ? 'id';
    select coalesce(jsonb_object_agg(e ->> 'id', e), '{}'::jsonb) into v_new_by_id
      from jsonb_array_elements(v_new) e where e ? 'id';

    -- Every notification that already existed must still exist in the
    -- new value, and the ONLY field an authenticated write may change on
    -- it is `read` (a user marking a notification read/unread) -- no
    -- other field of an EXISTING entry (message/type/userId/createdAt/
    -- aoId/offerId) may be altered, and no existing entry may be removed,
    -- by this direct path. Adding brand-new entries (notifying someone)
    -- is unrestricted here -- that is NotificationsService.push()'s own,
    -- pre-existing, accepted behavior, not something this guard changes.
    for v_id in select jsonb_object_keys(v_old_by_id) loop
      v_oe := v_old_by_id -> v_id;
      v_ne := v_new_by_id -> v_id;
      if v_ne is null then
        -- Existing persistNotifs() intentionally caps the canonical list
        -- at 5000 entries. When a new notification arrives at that cap,
        -- allow pruning ONLY the chronologically OLDEST items, never an
        -- arbitrary existing message. No deletions allowed below the cap.
        if jsonb_array_length(v_old) < 5000
           or jsonb_array_length(v_new) <> 5000
           or not exists (
             select 1 from jsonb_array_elements(v_new) n
             where not (v_old_by_id ? (n->>'id'))
           )
           or coalesce(v_oe->>'createdAt','') > coalesce(
             (select min(n->>'createdAt') from jsonb_array_elements(v_new) n), ''
           )
        then
          raise exception 'direct_write_blocked' using errcode = '42501';
        end if;
        continue;
      end if;
      if (v_oe - 'read') is distinct from (v_ne - 'read') then
        raise exception 'direct_write_blocked' using errcode = '42501';
      end if;
    end loop;
  end if;

  return coalesce(new, old);
end;
$$;

alter function public._protect_notifications_and_legacy_keys() owner to postgres;

drop trigger if exists protect_notifications_and_legacy_keys on public.store;
create trigger protect_notifications_and_legacy_keys
  before insert or update or delete on public.store
  for each row
  execute function public._protect_notifications_and_legacy_keys();

commit;