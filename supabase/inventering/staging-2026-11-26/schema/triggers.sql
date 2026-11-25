-- STAGING (yyzljlqyzzcbxmcdbual) schema-ögonblicksbild 2026-11-25, endast läsning (SELECT). Ingen verksamhetsdata.
-- Triggers (ej interna) i public och storage. storage.*-triggers är Supabase-plattformens egna (ingår inte i VIFT:s migrationer).

-- public.store  enabled=O
CREATE TRIGGER protect_critical_store_keys BEFORE INSERT OR DELETE OR UPDATE ON public.store FOR EACH ROW EXECUTE FUNCTION _protect_critical_store_keys();

-- public.store  enabled=O
CREATE TRIGGER protect_notifications_and_legacy_keys BEFORE INSERT OR DELETE OR UPDATE ON public.store FOR EACH ROW EXECUTE FUNCTION _protect_notifications_and_legacy_keys();

-- public.store  enabled=O
CREATE TRIGGER store_bump_lastchanged AFTER INSERT OR UPDATE ON public.store FOR EACH ROW WHEN ((new.key = ANY (ARRAY['vift_offers'::text, 'vift_offerEvents'::text, 'vift_invoices'::text]))) EXECUTE FUNCTION _store_bump_lastchanged();

-- storage.buckets  enabled=O
CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();

-- storage.buckets  enabled=O
CREATE TRIGGER enforce_versioning_status_transition BEFORE UPDATE OF versioning_status ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_versioning_status_transition();

-- storage.buckets  enabled=O
CREATE TRIGGER protect_active_lifecycle_states BEFORE DELETE ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_active_lifecycle_states();

-- storage.buckets  enabled=O
CREATE TRIGGER protect_bucket_control_insert BEFORE INSERT ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns('service_role');

-- storage.buckets  enabled=O
CREATE TRIGGER protect_bucket_control_update BEFORE UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.protect_bucket_control_columns();

-- storage.buckets  enabled=O
CREATE TRIGGER protect_bucket_control_update_role AFTER UPDATE OF lifecycle_configuration, lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_lifecycle_service_role('service_role');

-- storage.buckets  enabled=O
CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

-- storage.buckets  enabled=O
CREATE TRIGGER wake_lifecycle_on_policy_write AFTER INSERT OR UPDATE OF lifecycle_configuration_generation ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.wake_lifecycle_state();

-- storage.buckets  enabled=O
CREATE TRIGGER wake_lifecycle_on_versioning_enable AFTER UPDATE OF versioning_status ON storage.buckets FOR EACH ROW WHEN ((new.lifecycle_configuration IS NOT NULL)) EXECUTE FUNCTION storage.wake_lifecycle_state();

-- storage.objects  enabled=O
CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

-- storage.objects  enabled=O
CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();

