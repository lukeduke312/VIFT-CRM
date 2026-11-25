-- STAGING (yyzljlqyzzcbxmcdbual) schema-ögonblicksbild 2026-11-25, endast läsning (SELECT). Ingen verksamhetsdata.
-- Alla RLS-policyer i public och storage (pg_policies), 51 st, återgivna som CREATE POLICY.


-- ---- public.app_users ----
CREATE POLICY "app_users_own_read" ON public.app_users AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
CREATE POLICY "app_users_service_role" ON public.app_users AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ---- public.property_sensitive_access ----
CREATE POLICY "psa_service_role_all" ON public.property_sensitive_access AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ---- public.push_subscriptions ----
CREATE POLICY "push_own_insert" ON public.push_subscriptions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM app_users
  WHERE ((app_users.user_id = auth.uid()) AND (app_users.active = true))))));
CREATE POLICY "push_own_read" ON public.push_subscriptions AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM app_users
  WHERE ((app_users.user_id = auth.uid()) AND (app_users.active = true))))));
CREATE POLICY "push_own_update" ON public.push_subscriptions AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "push_service_role_all" ON public.push_subscriptions AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ---- public.sensitive_access_audit ----
CREATE POLICY "audit_own_read" ON public.sensitive_access_audit AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
CREATE POLICY "audit_service_all" ON public.sensitive_access_audit AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ---- public.stamp_status ----
CREATE POLICY "stamp_status_insert_own" ON public.stamp_status AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "stamp_status_select_own" ON public.stamp_status AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() = user_id));
CREATE POLICY "stamp_status_update_own" ON public.stamp_status AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

-- ---- public.store ----
CREATE POLICY "staging_generic_keys_no_direct_delete" ON public.store AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((_staging_business_key_required_perm(key) IS NULL));
CREATE POLICY "staging_generic_keys_no_direct_insert" ON public.store AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((_staging_business_key_required_perm(key) IS NULL));
CREATE POLICY "staging_generic_keys_no_direct_update" ON public.store AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((_staging_business_key_required_perm(key) IS NULL))
  WITH CHECK ((_staging_business_key_required_perm(key) IS NULL));
CREATE POLICY "store_active_read" ON public.store AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM app_users
  WHERE ((app_users.user_id = auth.uid()) AND (app_users.active = true)))));
CREATE POLICY "store_active_write_safe" ON public.store AS PERMISSIVE FOR ALL TO authenticated
  USING (((key <> ALL (ARRAY['vift_roles'::text, 'vift_staff'::text, 'vift_settings'::text, 'vift_offerEvents'::text])) AND (EXISTS ( SELECT 1
   FROM app_users
  WHERE ((app_users.user_id = auth.uid()) AND (app_users.active = true))))))
  WITH CHECK (((key <> ALL (ARRAY['vift_roles'::text, 'vift_staff'::text, 'vift_settings'::text, 'vift_offerEvents'::text])) AND (EXISTS ( SELECT 1
   FROM app_users
  WHERE ((app_users.user_id = auth.uid()) AND (app_users.active = true))))));
CREATE POLICY "store_admin_write_protected" ON public.store AS PERMISSIVE FOR ALL TO authenticated
  USING (((key = ANY (ARRAY['vift_roles'::text, 'vift_staff'::text, 'vift_settings'::text])) AND (EXISTS ( SELECT 1
   FROM app_users
  WHERE ((app_users.user_id = auth.uid()) AND (app_users.active = true) AND (app_users.is_admin = true))))))
  WITH CHECK (((key = ANY (ARRAY['vift_roles'::text, 'vift_staff'::text, 'vift_settings'::text])) AND (EXISTS ( SELECT 1
   FROM app_users
  WHERE ((app_users.user_id = auth.uid()) AND (app_users.active = true) AND (app_users.is_admin = true))))));
CREATE POLICY "store_ao_time_no_direct_delete" ON public.store AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((key <> ALL (ARRAY['vift_workOrders'::text, 'vift_timeEntries'::text])));
CREATE POLICY "store_ao_time_no_direct_insert" ON public.store AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((key <> ALL (ARRAY['vift_workOrders'::text, 'vift_timeEntries'::text])));
CREATE POLICY "store_ao_time_no_direct_update" ON public.store AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((key <> ALL (ARRAY['vift_workOrders'::text, 'vift_timeEntries'::text])))
  WITH CHECK ((key <> ALL (ARRAY['vift_workOrders'::text, 'vift_timeEntries'::text])));
CREATE POLICY "store_invoices_no_direct_delete" ON public.store AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((key <> 'vift_invoices'::text));
CREATE POLICY "store_invoices_no_direct_insert" ON public.store AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((key <> 'vift_invoices'::text));
CREATE POLICY "store_invoices_no_direct_update" ON public.store AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((key <> 'vift_invoices'::text))
  WITH CHECK ((key <> 'vift_invoices'::text));
CREATE POLICY "store_offerattachments_no_direct_delete" ON public.store AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((key <> 'vift_offerAttachments'::text));
CREATE POLICY "store_offerattachments_no_direct_insert" ON public.store AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((key <> 'vift_offerAttachments'::text));
CREATE POLICY "store_offerattachments_no_direct_update" ON public.store AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((key <> 'vift_offerAttachments'::text))
  WITH CHECK ((key <> 'vift_offerAttachments'::text));
CREATE POLICY "store_project_documents_no_direct_delete" ON public.store AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((key <> 'vift_projectDocuments'::text));
CREATE POLICY "store_project_documents_no_direct_insert" ON public.store AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((key <> 'vift_projectDocuments'::text));
CREATE POLICY "store_project_documents_no_direct_update" ON public.store AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((key <> 'vift_projectDocuments'::text))
  WITH CHECK ((key <> 'vift_projectDocuments'::text));
CREATE POLICY "store_read_by_role" ON public.store AS RESTRICTIVE FOR SELECT TO authenticated
  USING (vift_store_full_access(key, ( SELECT vift_caller_perms() AS vift_caller_perms)));
CREATE POLICY "store_ronderingspass_no_direct_delete" ON public.store AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((key <> 'vift_ronderingspass'::text));
CREATE POLICY "store_ronderingspass_no_direct_insert" ON public.store AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((key <> 'vift_ronderingspass'::text));
CREATE POLICY "store_ronderingspass_no_direct_update" ON public.store AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((key <> 'vift_ronderingspass'::text))
  WITH CHECK ((key <> 'vift_ronderingspass'::text));
CREATE POLICY "store_service_role_all" ON public.store AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
CREATE POLICY "store_timeentries_no_direct_select" ON public.store AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((key <> 'vift_timeEntries'::text));
CREATE POLICY "store_workorders_no_direct_select" ON public.store AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((key <> 'vift_workOrders'::text));

-- ---- public.store_backup_prop_objects_20260720 ----
CREATE POLICY "backup_objects_service_role_all" ON public.store_backup_prop_objects_20260720 AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ---- public.store_backup_properties_20260720 ----
CREATE POLICY "backup_props_service_role_all" ON public.store_backup_properties_20260720 AS PERMISSIVE FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ---- storage.objects ----
CREATE POLICY "offer-attachments service_role delete" ON storage.objects AS PERMISSIVE FOR DELETE TO service_role
  USING ((bucket_id = 'offer-attachments'::text));
CREATE POLICY "offer-attachments service_role insert" ON storage.objects AS PERMISSIVE FOR INSERT TO service_role
  WITH CHECK ((bucket_id = 'offer-attachments'::text));
CREATE POLICY "offer-attachments service_role select" ON storage.objects AS PERMISSIVE FOR SELECT TO service_role
  USING ((bucket_id = 'offer-attachments'::text));
CREATE POLICY "project-documents service_role delete" ON storage.objects AS PERMISSIVE FOR DELETE TO service_role
  USING ((bucket_id = 'project-documents'::text));
CREATE POLICY "project-documents service_role insert" ON storage.objects AS PERMISSIVE FOR INSERT TO service_role
  WITH CHECK ((bucket_id = 'project-documents'::text));
CREATE POLICY "project-documents service_role select" ON storage.objects AS PERMISSIVE FOR SELECT TO service_role
  USING ((bucket_id = 'project-documents'::text));
CREATE POLICY "vift_branding_service_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO service_role
  WITH CHECK ((bucket_id = 'vift-branding'::text));
CREATE POLICY "vift_branding_service_select" ON storage.objects AS PERMISSIVE FOR SELECT TO service_role
  USING ((bucket_id = 'vift-branding'::text));
CREATE POLICY "vift_branding_service_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO service_role
  USING ((bucket_id = 'vift-branding'::text));
CREATE POLICY "wo_images_storage_delete" ON storage.objects AS PERMISSIVE FOR DELETE TO service_role
  USING ((bucket_id = 'workorder-images'::text));
CREATE POLICY "wo_images_storage_insert" ON storage.objects AS PERMISSIVE FOR INSERT TO service_role
  WITH CHECK ((bucket_id = 'workorder-images'::text));
CREATE POLICY "wo_images_storage_select" ON storage.objects AS PERMISSIVE FOR SELECT TO service_role
  USING ((bucket_id = 'workorder-images'::text));
