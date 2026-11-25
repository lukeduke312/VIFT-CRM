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
-- R-D: RESTRICTIVE-policyer på public.store som blockerar direkt REST-åtkomst för
-- authenticated till nycklar som bara får läsas/skrivas via Edge Functions och RPC.
-- Versionsluckorna 20261018000002/05/07 i STAGING tyder på manuellt körd cutover-SQL.
-- OBS ordning vid en LIVE-installation: de här policyerna ska aktiveras först när klienten
-- som använder EF-vägarna (ao-time-write, work-orders-list, time-entries-list, invoice-write,
-- offer-attachment-upload, rondering-pass-write) är i drift, annars blockeras den gamla klienten.
-- 14 policyer. Texterna i USING/WITH CHECK är pg_policies-deparsning från STAGING.

begin;

drop policy if exists "store_ao_time_no_direct_delete" on public.store;
create policy "store_ao_time_no_direct_delete" on public.store as restrictive for delete to authenticated
  using ((key <> ALL (ARRAY['vift_workOrders'::text, 'vift_timeEntries'::text])));

drop policy if exists "store_ao_time_no_direct_insert" on public.store;
create policy "store_ao_time_no_direct_insert" on public.store as restrictive for insert to authenticated
  with check ((key <> ALL (ARRAY['vift_workOrders'::text, 'vift_timeEntries'::text])));

drop policy if exists "store_ao_time_no_direct_update" on public.store;
create policy "store_ao_time_no_direct_update" on public.store as restrictive for update to authenticated
  using ((key <> ALL (ARRAY['vift_workOrders'::text, 'vift_timeEntries'::text])))
  with check ((key <> ALL (ARRAY['vift_workOrders'::text, 'vift_timeEntries'::text])));

drop policy if exists "store_invoices_no_direct_delete" on public.store;
create policy "store_invoices_no_direct_delete" on public.store as restrictive for delete to authenticated
  using ((key <> 'vift_invoices'::text));

drop policy if exists "store_invoices_no_direct_insert" on public.store;
create policy "store_invoices_no_direct_insert" on public.store as restrictive for insert to authenticated
  with check ((key <> 'vift_invoices'::text));

drop policy if exists "store_invoices_no_direct_update" on public.store;
create policy "store_invoices_no_direct_update" on public.store as restrictive for update to authenticated
  using ((key <> 'vift_invoices'::text))
  with check ((key <> 'vift_invoices'::text));

drop policy if exists "store_offerattachments_no_direct_delete" on public.store;
create policy "store_offerattachments_no_direct_delete" on public.store as restrictive for delete to authenticated
  using ((key <> 'vift_offerAttachments'::text));

drop policy if exists "store_offerattachments_no_direct_insert" on public.store;
create policy "store_offerattachments_no_direct_insert" on public.store as restrictive for insert to authenticated
  with check ((key <> 'vift_offerAttachments'::text));

drop policy if exists "store_offerattachments_no_direct_update" on public.store;
create policy "store_offerattachments_no_direct_update" on public.store as restrictive for update to authenticated
  using ((key <> 'vift_offerAttachments'::text))
  with check ((key <> 'vift_offerAttachments'::text));

drop policy if exists "store_ronderingspass_no_direct_delete" on public.store;
create policy "store_ronderingspass_no_direct_delete" on public.store as restrictive for delete to authenticated
  using ((key <> 'vift_ronderingspass'::text));

drop policy if exists "store_ronderingspass_no_direct_insert" on public.store;
create policy "store_ronderingspass_no_direct_insert" on public.store as restrictive for insert to authenticated
  with check ((key <> 'vift_ronderingspass'::text));

drop policy if exists "store_ronderingspass_no_direct_update" on public.store;
create policy "store_ronderingspass_no_direct_update" on public.store as restrictive for update to authenticated
  using ((key <> 'vift_ronderingspass'::text))
  with check ((key <> 'vift_ronderingspass'::text));

drop policy if exists "store_timeentries_no_direct_select" on public.store;
create policy "store_timeentries_no_direct_select" on public.store as restrictive for select to authenticated
  using ((key <> 'vift_timeEntries'::text));

drop policy if exists "store_workorders_no_direct_select" on public.store;
create policy "store_workorders_no_direct_select" on public.store as restrictive for select to authenticated
  using ((key <> 'vift_workOrders'::text));

commit;
