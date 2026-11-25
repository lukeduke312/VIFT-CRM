-- ============================================================
-- Rekonstruerad 2026-11-27 från STAGING-schema (pg_get_functiondef/pg_policies), inte historisk SQL.
-- Källa: STAGING yyzljlqyzzcbxmcdbual, läst med SELECT 2026-11-25
-- (supabase/inventering/staging-2026-11-26/schema/ och tests/local/staging-schema-facit-2026-11-25.json).
-- Den SQL som ursprungligen installerade objekten nedan finns inte i någon
-- registrerad migration, i något repo eller i git-historiken (G1/G4, avsnitt 7).
-- Funktionstexterna är exakt pg_get_functiondef() från STAGING; grants och
-- REVOKE motsvarar proacl/pg_policies i drift. Verifieras av
-- tests/local/migrationskedja.sh (jämför md5 av pg_get_functiondef efter körning).
-- ============================================================
-- R-E: rättigheter och en policy som ändrats i STAGING utanför registrerade migrationer.
--  1. provision_vift_user, deactivate_vift_user och check_app_users_health (SECURITY DEFINER,
--     20260720000006) återkallar bara EXECUTE från PUBLIC. Supabase ger dessutom anon och
--     authenticated EXECUTE via default privileges. I STAGING är de återkallade (proacl =
--     {postgres=X, service_role=X}); i en ny installation utan denna fil skulle anon kunna
--     anropa provision_vift_user. Lokalt verifierat med tests/local/migrationskedja.sh.
--  2. store_active_write_safe undantar i drift även vift_offerEvents (skrivs bara via
--     offer_events_append). 20260720000005 skapade policyn utan den nyckeln.

begin;

revoke all on function public.provision_vift_user(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.provision_vift_user(uuid, text, text, boolean) to service_role;
revoke all on function public.deactivate_vift_user(uuid) from public, anon, authenticated;
grant execute on function public.deactivate_vift_user(uuid) to service_role;
revoke all on function public.check_app_users_health() from public, anon, authenticated;
grant execute on function public.check_app_users_health() to service_role;

drop policy if exists "store_active_write_safe" on public.store;
create policy "store_active_write_safe" on public.store as permissive for all to authenticated
  using (((key <> ALL (ARRAY['vift_roles'::text, 'vift_staff'::text, 'vift_settings'::text, 'vift_offerEvents'::text])) AND (EXISTS ( SELECT 1
   FROM app_users
  WHERE ((app_users.user_id = auth.uid()) AND (app_users.active = true))))))
  with check (((key <> ALL (ARRAY['vift_roles'::text, 'vift_staff'::text, 'vift_settings'::text, 'vift_offerEvents'::text])) AND (EXISTS ( SELECT 1
   FROM app_users
  WHERE ((app_users.user_id = auth.uid()) AND (app_users.active = true))))));

commit;
