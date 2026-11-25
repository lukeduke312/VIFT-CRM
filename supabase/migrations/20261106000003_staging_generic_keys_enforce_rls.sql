-- ============================================================
-- KANDIDAT, INTE BEVISAD HISTORISK SQL (G1/G4 del 2, 2026-11-27).
-- I STAGING har migrationen 20261106000003 en TOM statements-lista i
-- supabase_migrations.schema_migrations, så den SQL som faktiskt kördes
-- är okänd. Innehållet nedan är filen
--   staging-release/_staging_integration/server/migrations/20261106000003_staging_generic_keys_enforce_rls.sql
-- (md5 461dd6386d114a8e881ba3ce9c8fa4ab, oförändrad efter markören INNEHÅLL). Funktionskroppar och
-- policyer i drift har jämförts mot den, se
-- supabase/inventering/G1-G4-DEL2-RESULTAT.md, avsnittet om de tomma
-- migrationerna. Allt som avviker från drift rättas av de rekonstruerade
-- migrationerna 20261127*.
-- ============================================================
-- INNEHÅLL
-- STAGING-GRANSKNING 2026-11-06 (fynd 2) — Fas 2 (ENFORCEMENT, separat fil,
-- samma fasindelningsprincip som P0_FINAL_2026-11-04's installationsordning
-- — se 20261106000002 för Fas 1/additiv SQL, NOLL enforcement-ändring där).
--
-- Installeras ENDAST efter att klienten (client_patch/patched_source/src/
-- data/state.js + storage.js) är live i STAGING och ett rökprov bekräftat
-- att de 27 generiska nycklarna kan skrivas via den nya vägen. Blockerar
-- EFTER det direkt `authenticated`-INSERT/UPDATE/DELETE av dessa 27 nycklar
-- — SELECT lämnas HELT OBERÖRD (samma, redan en gång gjorda och rättade
-- misstag som P0-arbetets egen tidigare runda — en RESTRICTIVE FOR ALL
-- blockerar annars SELECT också, se den rättelsens egen motivering).
--
-- SAMSPEL MED STAGING:S BEFINTLIGA, OFÖRÄNDRADE `store_timeentries_no_direct_
-- select` (rapporterat av ägaren, inte självständigt läst här): den policyn
-- gäller `vift_timeEntries`, en nyckel som INTE ingår i allowlistan nedan —
-- disjunkta nyckelmängder, ingen interaktion, ingen risk för att två
-- RESTRICTIVE-policyer kombinerade med AND skulle bli strängare än avsett.

BEGIN;

DROP POLICY IF EXISTS staging_generic_keys_no_direct_insert ON public.store;
CREATE POLICY staging_generic_keys_no_direct_insert
  ON public.store
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public._staging_business_key_required_perm(key) IS NULL);

DROP POLICY IF EXISTS staging_generic_keys_no_direct_update ON public.store;
CREATE POLICY staging_generic_keys_no_direct_update
  ON public.store
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (public._staging_business_key_required_perm(key) IS NULL)
  WITH CHECK (public._staging_business_key_required_perm(key) IS NULL);

DROP POLICY IF EXISTS staging_generic_keys_no_direct_delete ON public.store;
CREATE POLICY staging_generic_keys_no_direct_delete
  ON public.store
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (public._staging_business_key_required_perm(key) IS NULL);

COMMIT;

-- ROLLBACK (körs separat, inte en del av denna transaktion):
--   DROP POLICY IF EXISTS staging_generic_keys_no_direct_insert ON public.store;
--   DROP POLICY IF EXISTS staging_generic_keys_no_direct_update ON public.store;
--   DROP POLICY IF EXISTS staging_generic_keys_no_direct_delete ON public.store;
-- OBS: rulla ALDRIG tillbaka denna fil ensam om klienten ovan fortfarande
-- är live mot ett ÄLDRE, icke-RPC-anropande state.js — samma princip som
-- redan etablerad för workOrders-RLS-policyn i tidigare rundor: policy och
-- klient rullas alltid tillbaka TILLSAMMANS.
