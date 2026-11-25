# Inventering av STAGING:s serverarkitektur (G1/G4), 2026-11-25

Projekt: STAGING `yyzljlqyzzcbxmcdbual`. Allt är hämtat med läsande anrop: `SELECT` via
execute_sql samt list_migrations, list_edge_functions och get_edge_function.
LIVE (`hjplzjsbbowiyoyhdghc`) har inte rörts. Inget har deployats, skrivits eller
migrerats. Ingen verksamhetsdata har sparats här. De få kontroller som rörde data gav
bara antal, mönster och tidsstämplar, se avsnitt 5.

## 1. Sammanfattning

- **41 applicerade migrationer** finns i `supabase_migrations.schema_migrations`. 38 har
  statements och 3 är tomma (20261106000002, 20261106000003, 20261108000001).
  - Alla 38 är sparade exakt i `migrations-applicerade/`. **md5 är verifierad för 38/38**:
    lokal `md5sum` är lika med SQL-funktionens `md5(array_to_string(statements, E';\n'))`.
    Filerna saknar avslutande radbrytning. De 3 tomma migrationerna ligger där som tomma filer.
  - 9 av de 41 (2026-07-20-serien) finns byte för byte i repot.
  - 11 finns i vift-v2/VIFT-CRM med samma kod men andra kommentarer, ihopslagna eller
    uppdelade.
  - 5 finns bara i `staging-release/_staging_integration` (SI).
  - 3 är tomma. Källkandidater finns i SI.
  - **13 saknas helt i alla repon.**
- **26 Edge Functions** finns i STAGING. Alla källfiler är sparade exakt i `functions/<slug>/`.
  - 8 är identiska med repot.
  - 7 har identisk kod men skiljer i kommentarer eller format, till exempel kompakt
    deploy-variant eller Unicode-escapes.
  - 9 skiljer i logik. I 5 av dem är STAGING nyare, i 2 är repot nyare, 1 är divergerad
    och 1 är 410-stubb.
  - **2 saknades** i repot: `invoice-write` v9 och `rondering-pass-write` v3. De är nu
    återställda till `supabase/functions/<slug>/`.
- **Schema-ögonblicksbild** finns i `schema/`: 64 funktioner, 51 RLS-policyer, triggers,
  tabeller, buckets, cron-jobb och grants på `store`.
  - **13 funktioner** i drift har en kropp som inte finns i någon fil i något repo eller i
    någon migration. De kan bara återskapas från `schema/functions.sql`, se avsnitt 7.
  - **Flera RESTRICTIVE-policyer** på `store` saknar källa i migrationerna. Versionsluckorna
    20261018000002/05/07 tyder på cutover-SQL som körts manuellt.
- **AO-nummerserien:** dubbletten `AO-001` förklaras av ett off-by-one-fel i backfill-steget
  i migrationen `20261020000001_ao_display_number`. Felet är bekräftat mot STAGING:s data,
  se avsnitt 5.

## 2. Filer i denna katalog

| Sökväg | Innehåll |
|---|---|
| `migrations-applicerade/<version>_<namn>.sql` | 41 filer: exakt `array_to_string(statements, E';\n')`, utan avslutande radbrytning, md5-verifierade. |
| `functions/<slug>/...` | Exakta källfiler per EF. Bundle-namnets prefix `functions/` och `user_fn_*/` är borttaget, i övrigt är relativa sökvägar kvar (t.ex. `invoice-write/index.ts` och `_shared/vift-auth.ts`). |
| `functions/<slug>/_staging_meta.json` | version, verify_jwt, entrypoint, ezbr_sha256, tidsstämplar och ursprungliga filnamn. |
| `functions/MANIFEST.tsv` | En rad per fil: slug, version, verify_jwt, namn i bundle, sparad som, bytes och sha256. |
| `schema/functions.sql` | `pg_get_functiondef()` för alla 64 egna funktioner i `public`, med ägare, SECURITY DEFINER, proconfig och EXECUTE-grants. |
| `schema/policies.sql` | Alla 51 policyer i `public` och `storage` som `CREATE POLICY`. |
| `schema/triggers.sql` | Triggers i `public` (3 st.) och `storage` (plattformens egna). |
| `schema/tables.txt` | Tabeller, sekvens, kolumner, constraints, index och RLS-flaggor i `public` och i backupscheman (bara struktur). |
| `schema/storage_buckets.txt` | 4 buckets med gränser och MIME-typer. |
| `schema/cron_jobs.txt` | cron.job med maskerat kommando (det innehöll ingen hemlighet, se avsnitt 9). |
| `schema/grants_store.txt` | Grants på `public.store`. |
| `STAGING-ONLY.md` | Det som aldrig får till LIVE. |

## 3. Edge Functions

`_shared/vift-auth.ts`: STAGING-bundlarna har tre varianter: repots fulla version (4 735 B),
en äldre delmängd utan `canViewWorkOrder`/`isPathUnderAo` (3 207/2 872 B) och en kompakt
omformaterad variant (2 290/2 768 B). Repots `_shared/vift-auth.ts` är en **övermängd** som
alla kan använda. Ingen åtgärd behövs.

| Slug | STAGING v (senast ändrad) | verify_jwt | Repo-status (vift-v2) | Åtgärd/förslag |
|---|---|---|---|---|
| ao-time-write | 5 (2026-11-24) | true | Kod identisk. STAGING är en kommentarsrensad kompakt deploy av repo-källan. | Ingen. |
| e2e-test-cleanup | 1 (2026-11-24) | true | Kod identisk (kompakt). | STAGING-ONLY. |
| get-sensitive-fields | 9 (2026-11-16) | true | **Skiljer, STAGING nyare.** I5-härdning: supabase-js låst till 2.110.8 och audit fail-closed (`audit_unavailable` 500). Repot har det gamla `.catch(()=>{})`, senast ändrat 2026-07-20. | Uppdatera repot från STAGING-källan (efter beslut). |
| invoice-write | 9 (2026-11-17) | true | **Saknades.** Återställd till `supabase/functions/invoice-write/` (`index.ts` + `stale-override.ts`). | Granska. Kräver migrationerna 20261018000003/4, 20261116094236, 20261117092227/36 och funktionerna i avsnitt 7. |
| offer-attachment-upload | 13 (2026-11-24) | true | Kod identisk. 5 kommentarsrader skiljer (bara längden på ─-linjer). | Ingen. |
| offer-attachment-url | 11 (2026-08-01) | **false** | Kod identisk. STAGING har en längre testfallskommentar. | Ingen. |
| offer-pdf | 10 (2026-08-02) | true | **Skiljer, repot nyare** (b270fb4 2026-09-24, prissättning). STAGING-v10 har logotypen inbäddad som base64. | Behåll repot. Installera och testa repo-versionen i STAGING före LIVE. |
| offer-public-pdf | 1 (2026-11-24) | **false** | Semantiskt identisk. STAGING har bokstavliga Unicode-tecken där repot har `\uXXXX` i `pdfSafeText`. | Ingen (repots form är robustare). |
| offer-respond | 10 (2026-11-20) | **false** | **Skiljer, STAGING nyare.** v5: atomisk `offer_respond_commit` och `requestId`-idempotens. Repot (2026-08-23) gör en olåst read→upsert av `vift_offers`. | Ersätt repo-källan med STAGING-v10 efter beslut, och lägg in migration 20261120103758 i repot. |
| offer-token-validate | 11 (2026-11-20) | **false** | **Skiljer, STAGING nyare** (`offer_token_open_commit`, `offer_events_append`). | Som ovan, med 20261120103824. |
| project-document-upload | 1 (2026-11-24) | true | Identisk. | Ingen. |
| project-document-url | 1 (2026-11-24) | true | Identisk. | Ingen. |
| rondering-pass-write | 3 (2026-10-30) | true | **Saknades.** Återställd till `supabase/functions/rondering-pass-write/index.ts`. | Granska. Kräver 20261018000001. |
| send-offer-email | 11 (2026-11-20) | true | **Skiljer, STAGING nyare** (`offer_email_prepare_commit` v3 och STAGING-spärr). Repot är från 2026-07-20. | Ersätt efter beslut. OBS: standardvärdet för `PUBLIC_BASE_URL` är STAGING-domänen och måste sättas i LIVE. Kräver 20261120103829. |
| send-push | 9 (2026-10-22) | true | **Divergerad.** Repot (V45, 2026-08-19, staffIds-mottagare m.m.) har logik som STAGING saknar. STAGING har STAGING-spärren som repot saknar. | Slå ihop manuellt (V45 + spärr) och testa i STAGING före LIVE. |
| service-monitor | 15 (2026-10-30) | **false** | Identisk. | Ingen. |
| set-sensitive-fields | 9 (2026-11-16) | true | **Skiljer, STAGING nyare.** I5: atomisk skrivning och audit via RPC:n `sensitive_fields_write`. Repot gör en direkt upsert och sedan audit med `.catch()`. | Uppdatera repot från STAGING. Kräver 20261116093820. |
| store-key-write | 5 (2026-11-24) | true | Kod identisk (kompakt; 4 moduler och `_shared`). | Ingen. |
| time-entries-list | 3 (2026-10-30) | true | **Skiljer, repot nyare** (baeb9b4 2026-11-22: rate-limit, try/catch, 401 i stället för 403). | Installera repo-versionen i STAGING och testa. |
| vift-admin-storage | 8 (2026-11-24) | true | **Skiljer.** STAGING är en 410-stubb (avaktiverad). Repot innehåller den aktiva underhållsversionen. | STAGING-ONLY. Föreslaget: ersätt repo-filen med stubben (kräver godkännande). |
| work-order-checklist-resolve | 2 (2026-11-24) | true | Identisk. | Ingen. |
| work-order-image-delete | 1 | true | Identisk. | Ingen. |
| work-order-image-upload | 1 | true | Identisk. | Ingen. |
| work-order-image-url | 1 | true | Identisk. | Ingen. |
| work-order-log-write | 1 | true | Identisk. | Ingen. |
| work-orders-list | 3 (2026-11-24) | true | Kod identisk (kompakt). | Ingen. |

Enligt uppdraget har ingen befintlig repo-fil ersatts. De enda filer som skrivits utanför
inventeringen är de två återställda katalogerna.

## 4. Migrationer: applicerad i STAGING → repo

Förkortningar: **V2** = `vift-v2/supabase/migrations`, **CRM** = `VIFT-CRM/supabase/migrations`,
**SI** = `staging-release/_staging_integration/server/...` (eget repo, inte vift-v2).
"Identisk" betyder att repo-filen, uppdelad i statements som CLI:n gör, ger exakt samma
text och md5. "Samma kod" betyder att filerna bara skiljer i kommentarer och whitespace.

| Applicerad version_namn | Repo-fil(er) | Status |
|---|---|---|
| 20260720000000_create_core_tables | V2+CRM 20260720000000_create_core_tables.sql | Identisk |
| 20260720000001_rls_store_table | V2+CRM samma namn | Identisk |
| 20260720000002_storage_offer_attachments | V2+CRM samma namn | Identisk |
| 20260720000003_pg_cron_service_monitor | V2+CRM samma namn | Identisk (avsiktlig no-op) |
| 20260720000004_property_sensitive_access | V2+CRM samma namn | Identisk |
| 20260720000005_store_key_rls | V2+CRM samma namn | Identisk |
| 20260720000006_app_users_lifecycle | V2+CRM samma namn | Identisk |
| 20260720000007_sensitive_access_audit | V2+CRM samma namn | Identisk |
| 20260720000008_strip_passwords_from_store | V2+CRM samma namn | Identisk |
| 20260928000001_offer_events_atomic_rpc | – (funktionen finns bara i `tests/fixtures/staging_offer_rpcs_installed.sql`) | **Saknas i repo** |
| 20261017000001_ao_time_atomic_rpc | – | **Saknas i repo**. OBS: `time_entry_*` i drift skiljer från denna version, se avsnitt 7. |
| 20261018000001_rondering_pass_atomic_rpc | – | **Saknas i repo** |
| 20261018000003_invoice_set_status_atomic_rpc | – (äldre form finns i SI `ROLLBACK_20261117000002_invoice_stale_override.sql`) | **Saknas i repo** |
| 20261018000004_invoice_lines_and_create_atomic_rpc | – | **Saknas i repo**. 6 av dess funktioner har senare ändrats utanför migrationerna. |
| 20261018000006_offer_attachment_atomic_rpc | – | **Saknas i repo** |
| 20261020000001_ao_display_number | – | **Saknas i repo** (`work_order_create` och nummerserien, avsnitt 5) |
| 20261106000002_staging_generic_keys_write_lockdown | SI `migrations/20261106000002_staging_generic_keys_write_lockdown.sql` | **Tom i STAGING.** Funktionskropparna i drift matchar SI-filen. |
| 20261106000003_staging_generic_keys_enforce_rls | SI `migrations/20261106000003_...` | **Tom i STAGING.** Policyerna `staging_generic_keys_no_direct_*` finns i SI-filen. |
| 20261108000001_staging_review_fixes | SI `migrations/20261108000001_staging_review_fixes.sql` | **Tom i STAGING.** `store_business_key_merge_write` matchar SI-filen. |
| 20261116093820_i5_sensitive_fields_write_atomic_20261116 | SI `functions/set-sensitive-fields/20261113000002_i5_sensitive_fields_write_atomic.sql` | Identisk (rå fil), men inte i V2/CRM |
| 20261116094016_i3_work_order_checklist_atomic_20261116 | V2+CRM 20260917000001_work_order_checklist_atomic_rpc.sql | Identisk (rå fil) |
| 20261116094236_j1_invoice_idempotency_strong_identity_20261116 | – (97 % lik SI `ROLLBACK_20261117000001_n2_staging.sql`) | **Saknas i repo** |
| 20261117085418_vift_staging_preinstall_snapshot_20261117 | – | Saknas. **STAGING-ONLY** |
| 20261117085458_staging_stamp_status_identity_scoped_cas_20261117 | SI `functions/store-key-write/20261116000002_stamp_status_identity_scoped.sql` | Samma kod, men inte i V2/CRM |
| 20261117092227_staging_invoice_n2_tombstone_20261117 | SI `migrations/20261117000001_n2_tombstone_from_actual_staging.sql` | Identisk (rå fil), men inte i V2/CRM |
| 20261117092236_staging_invoice_price_approval_a3a_atomic_20261117 | SI `migrations/20261117000002_invoice_stale_override_and_a3a_atomic.sql` | Identisk (rå fil), men inte i V2/CRM |
| 20261117092246_staging_a4_notifications_legacy_guard_20261117 | SI `migrations/20261117000003_a4_notifications_and_legacy_keys_guard.sql` | Samma kod, men inte i V2/CRM |
| 20261120103758_vift_crm12_offer_respond_commit_v5_20261120 | – (EF-kommentaren nämner `001_offer_respond_commit_v5.sql`, som inte finns lokalt) | **Saknas i repo** |
| 20261120103824_vift_crm12_offer_token_open_commit_v1_20261120 | – | **Saknas i repo** |
| 20261120103829_vift_crm12_offer_email_prepare_commit_v3_20261120 | – | **Saknas i repo** |
| 20261124145455_work_order_checklist_progress_20261123000002 | V2+CRM 20261123000002_work_order_checklist_progress.sql | Samma kod |
| 20261124145958_activity_log_append_20261124000001 | V2+CRM 20261124000001_activity_log_append.sql | Samma kod |
| 20261124150357_work_order_log_ops_20261124000002 | V2+CRM 20261124000002_work_order_log_ops.sql (ersätter PROPOSAL 20261123000001) | Samma kod |
| 20261124150650_offer_attachment_patch_20261125000001 | V2+CRM 20261125000001_offer_attachment_patch.sql | Samma kod |
| 20261124151118_workorder_images_bucket_20261124000003 | V2+CRM 20261124000003_workorder_images_bucket.sql | Samma kod |
| 20261124152842_vift_branding_bucket_20261124000004 | – (repot saknar 20261124000004) | **Saknas i repo** (bucket `vift-branding` som `offer-public-pdf` behöver) |
| 20261124160425_project_documents_20260907_20260908 | V2+CRM 20260907000001 + 20260908000001 + 20260908000002 | Skiljer i form. Sammanslaget slutläge: samma objekt, kompaktare, funktionskropparna skiljer i kommentarer och format. |
| 20261124201228_store_lastchanged_bump | V2 20261125000002_store_lastchanged_bump.sql (CRM saknar) | Samma kod |
| 20261124210432_store_read_by_role_functions | V2 20261125000003_store_read_by_role.sql (första delen) | Samma kod tillsammans med raden nedan |
| 20261124210747_store_read_by_role_policy | V2 20261125000003_store_read_by_role.sql (policydelen) | Del 1 + del 2 ger exakt samma kod som repo-filen |
| 20261124211128_e2e_purge_offer_artifacts | V2 20261125000004_e2e_purge_offer_artifacts.sql | Samma kod. **STAGING-ONLY** |

Repo-filer som inte är applicerade som migration i STAGING:
`20261120000001_PROPOSAL_push_subscriptions_index` (indexet finns inte),
`20261120000002_PROPOSAL_timeentries_read_lockdown` (policyn `store_timeentries_no_direct_select`
finns i drift men är installerad utanför migrationerna), `20261123000001_PROPOSAL_work_order_log_ops`
(ersatt).

## 5. `work_order_create` och AO-nummerserien (displayNumber)

**Var den definieras:** i `migrations-applicerade/20261020000001_ao_display_number.sql`. Ingen
fil i vift-v2 eller VIFT-CRM innehåller den. Kroppen i drift
(`schema/functions.sql`, `public.work_order_create(jsonb, text, text)`, SECURITY DEFINER,
EXECUTE bara för service_role) är identisk med migrationens. Den första versionen kom i
20261017000001_ao_time_atomic_rpc. Anropare: EF `ao-time-write` (`create_ao`) och
`service-monitor` (auto-AO med deterministisk nyckel `service-monitor-<si.id>-<periodKey>`).

**Logik:**
1. Kräver `p_idempotency_key`. Om `op_idempotency('work_order_create', key)` redan finns
   returneras det sparade resultatet.
2. Låser `store`-raden `vift_workOrders` med `FOR UPDATE`.
3. Det interna id:t blir `p_client_id` (klientens UUID, `AO-<uuid>`), med kontroll mot
   `id_collision`. Den äldre grenen utan klient-id använder `work_order_id_seq`. Den grenen
   används inte, och sekvensen finns inte i STAGING.
4. Visningsnumret allokeras alltid:
   ```sql
   CREATE SEQUENCE IF NOT EXISTS public.ao_display_number_seq;
   v_display_seq := nextval('public.ao_display_number_seq');
   ...
   'displayNumber', 'AO-' || lpad(v_display_seq::text, 3, '0'),
   ```
   Funktionen kontrollerar inte om ett befintligt AO redan har samma `displayNumber`.
   Unikheten antas komma från sekvensen.

**Backfill-steget i samma migration (felet finns här):**
```sql
IF v_max_existing > 0 THEN
  SELECT last_value INTO v_seq_current FROM public.ao_display_number_seq;
  IF v_max_existing > v_seq_current THEN
    PERFORM setval('public.ao_display_number_seq', v_max_existing);
  END IF;
END IF;
```
En nyskapad sekvens har `last_value = 1` och `is_called = false`. Då ger nästa `nextval()`
värdet 1. Om det högsta gamla numret i `vift_workOrders` var just **1** (bara `AO-001`
fanns i gammalt format) blir villkoret `1 > 1` falskt. `setval` körs därför aldrig, och det
första AO som skapas efter migrationen får `nextval() = 1`, alltså `AO-001` igen. Med ett
högsta gammalt nummer N ≥ 2 fungerar steget, eftersom `setval(N)` sätter `is_called = true`.

**Bekräftat i STAGING** (bara antal, id-format och tidsstämplar har lästs):
- 364 AO, alla med `displayNumber`. Exakt 1 AO har id i gammalt format (`AO-NNN`).
- Exakt en dubblett, `AO-001` ×2:
  - AO:t med id i gammalt format, skapat 2026-07-23. Backfill kopierade dess
    `displayNumber` ordagrant.
  - Det **första** UUID-AO:t, skapat 2026-10-22T09:23:39Z. Det har den tidigaste
    `createdAt` bland alla UUID-AO och fick `nextval() = 1`.
- Sekvensen står nu på `last_value = 412`. Efter dubbletten har numreringen gått vidare
  utan fler kollisioner.

Andra vägar som kan ge dubbletter med samma mekanism, eftersom sekvensen aldrig jämförs
med data som tillkommit senare:
- AO med id `AO-NNN` som skrivs in utanför `work_order_create`, till exempel från
  `seedData.js` (innehåller `AO-001`), import eller en återställning av `store` från backup.
- En återställning av `store` till ett äldre läge medan sekvensen ligger kvar. Det ger
  luckor, inte dubbletter, men en återställning *framåt* ger dubbletter.

**Föreslagen rättning, kör ingenting nu:**
- Vid installation: `setval(seq, greatest(max(gamla id-nummer), max(befintliga
  displayNumber)), true)`, och utan villkoret `> last_value`.
- I `work_order_create`: hoppa över ett nummer som redan används av något
  `displayNumber` i den låsta arrayen, i en loop likt id-kollisionsgrenen.
- Datarättning i STAGING (det andra `AO-001` → nytt nummer) bara efter beslut.

## 6. RPC:er och vilka EF som anropar dem

| EF | RPC:er (alla SECURITY DEFINER, EXECUTE bara för service_role) |
|---|---|
| ao-time-write | work_order_create, work_order_patch, work_order_soft_delete, work_order_permanent_delete, time_entry_create, time_entry_patch, time_entry_soft_delete, time_entry_set_attested |
| service-monitor | work_order_create |
| invoice-write | invoice_set_status, invoice_line_add, invoice_line_update, invoice_line_delete, invoice_draft_delete, invoice_discount_set, invoice_tax_reduction_set, invoice_meta_update, invoice_append_checked, invoice_stale_override_approve_commit |
| rondering-pass-write | rondering_point_patch, rondering_pass_save_note, rondering_pass_auto_start, rondering_pass_complete, rondering_pass_create, rondering_pass_migrate_legacy, rondering_passes_bulk_create |
| store-key-write | store_business_key_write, store_business_key_merge_write, store_business_key_read_with_hash, store_business_keys_read_hashes, store_read_all_with_hashes_projected, vift_store_project, store_read_stamp_status, store_write_stamp_status, activity_log_append |
| offer-attachment-upload | offer_attachment_append, offer_attachment_soft_delete, offer_attachment_patch, offer_events_append |
| offer-respond | offer_respond_commit |
| offer-token-validate | offer_token_open_commit, offer_events_append |
| send-offer-email | offer_email_prepare_commit, offer_events_append |
| set-sensitive-fields | sensitive_fields_write |
| project-document-upload | project_documents_append, project_documents_update_one, project_documents_finalize_delete |
| work-order-checklist-resolve | work_order_checklist_set_state |
| work-order-log-write | work_order_log_append, work_order_log_remove |
| e2e-test-cleanup | e2e_purge_offer_artifacts (STAGING-ONLY) |
| get-sensitive-fields, offer-attachment-url, offer-pdf, offer-public-pdf, project-document-url, send-push, time-entries-list, work-order-image-*, work-orders-list, vift-admin-storage | inga RPC:er. De läser och skriver `store`, Storage och tabeller direkt med service role. |

Funktioner som inte anropas av någon EF:
- Interna hjälpfunktioner: `_invoice_*`, `_rondering_recompute_summary`.
- Triggerfunktioner: `_protect_critical_store_keys`, `_protect_notifications_and_legacy_keys`,
  `_store_bump_lastchanged`.
- Policyhjälp: `vift_caller_perms`, `vift_store_full_access` och
  `_staging_business_key_required_perm`.
- Administration: `provision_vift_user`, `deactivate_vift_user`, `check_app_users_health`.
- Ersatta: `work_order_checklist_resolve` (ersatt av `_set_state`) och
  `store_read_all_with_hashes` (ersatt av `_projected`).

Säkerhetsnotering: ingen SECURITY DEFINER-funktion kan köras av PUBLIC, anon eller
authenticated, med två undantag: `vift_caller_perms` och `vift_store_full_access` kan köras
av authenticated, och de används av RLS-policyn. 5 hjälpfunktioner utan SECURITY DEFINER
kan köras av PUBLIC/anon (plattformens default), se `schema/functions.sql`.

## 7. Vad som inte kan återskapas från migrationsfiler

1. **De 3 tomma migrationerna** (20261106000002/3, 20261108000001). STAGING har inga
   statements sparade. Det som finns i drift är dokumenterat i `schema/`. Troliga källor är
   SI-filerna med samma versionsnummer i `staging-release/_staging_integration/server/migrations/`,
   och funktionskropparna matchar dem. Att filerna är exakt det som kördes går inte att bevisa.
2. **13 funktioner vars kropp i drift inte finns i någon fil** (inte i migrationer, repon,
   git-historik eller dokument): `_invoice_calc_financial`, `_invoice_financial_check`,
   `_protect_critical_store_keys`, `invoice_discount_set`, `invoice_line_add`,
   `invoice_line_update`, `invoice_line_delete`, `invoice_meta_update`,
   `invoice_tax_reduction_set`, `time_entry_create`, `time_entry_patch`,
   `time_entry_soft_delete`, `time_entry_set_attested`. Den enda källan är
   `schema/functions.sql`.
   - invoice-write-kommentaren nämner
     `migrations_phase1_additive/20261024000001_invoice_revision_conflict_control.sql`,
     som inte finns lokalt.
   - Attest-funktionen nämns inte i någon migration.
3. **RESTRICTIVE-policyer på `public.store` utan källa i applicerade migrationer:**
   `store_ao_time_no_direct_{insert,update,delete}`, `store_invoices_no_direct_*`,
   `store_offerattachments_no_direct_*`, `store_ronderingspass_no_direct_*`,
   `store_workorders_no_direct_select` och `store_timeentries_no_direct_select` (den sista
   finns som repo-PROPOSAL). Versionsluckorna 20261018000002/05/07 tyder på cutover-SQL som
   körts manuellt. Den enda källan är `schema/policies.sql`.
4. **Vault-hemligheter och EF-secrets:**
   - `SERVICE_MONITOR_SECRET` i Vault.
   - EF-miljön: `VAPID_*`, `RESEND_API_KEY`, `FROM_EMAIL`, `FROM_NAME`, `PUBLIC_BASE_URL`,
     `SERVICE_MONITOR_SECRET`.
   Värden går inte att läsa och har inte försökts läsas. De måste sättas manuellt per miljö.
5. **cron-headers:** cron-jobbet hämtar `X-Monitor-Secret` ur Vault vid körning. Själva
   värdet finns inte i kommandot och kan inte återskapas.
6. **Exakt källa för `ezbr`-bundlarna:** EF-källorna är exakta, men bundlens import-
   upplösning (t.ex. vilken patch-version `supabase-js@2` hade vid deploy) går inte att
   återskapa från källan.
7. **Data:** `vift_workOrders`, roller, personal och övrig data ingår inte (avsiktligt).

## 8. RLS-översikt (detaljer i `schema/policies.sql`)

- `store`: PERMISSIVE `store_active_read` (aktiv `app_users`), `store_active_write_safe`
  (alla nycklar utom `vift_roles/staff/settings/offerEvents`), `store_admin_write_protected`
  (`is_admin` för roles/staff/settings) och `store_service_role_all`.
- RESTRICTIVE ovanpå dessa:
  - `store_read_by_role` (SELECT via `vift_store_full_access(key, vift_caller_perms())`).
  - `*_no_direct_select` för `vift_workOrders` och `vift_timeEntries`.
  - `*_no_direct_{insert,update,delete}` för workOrders/timeEntries, invoices,
    offerAttachments, ronderingspass och projectDocuments.
  - `staging_generic_keys_no_direct_*` (`_staging_business_key_required_perm(key) IS NULL`,
    det vill säga affärsnycklar kan bara skrivas via `store-key-write`).
- Triggers på `store`: `protect_critical_store_keys`, `protect_notifications_and_legacy_keys`
  och `store_bump_lastchanged` (AFTER, för offers/offerEvents/invoices).
- `app_users`: egen läsning plus service_role. `push_subscriptions`: egna rader (aktiv
  användare) plus service_role. `stamp_status`: egna rader. `sensitive_access_audit`: egen
  läsning plus service_role. `property_sensitive_access` och `op_idempotency`: bara
  service_role (op_idempotency har RLS på och inga policyer).
- `storage.objects`: bara service_role för de 4 privata bucketarna `offer-attachments`,
  `project-documents`, `workorder-images` och `vift-branding`. All klientåtkomst går via EF.
- Grants på `store`: authenticated har SELECT/INSERT/UPDATE/DELETE (begränsat av RLS),
  service_role har allt och anon har inget.

## 9. Säkerhetsgenomgång av de nya filerna

Alla nya filer i katalogen och de två återställda EF-katalogerna har sökts igenom efter
`sb_secret_`, JWT (`eyJ…`), `Bearer <token>`, literala lösenord och nycklar, VAPID-liknande
strängar, e-postadresser och personnummer.

- **Inga hemligheter hittades. Inget behövde maskeras**, och migrationsfilerna förblir därmed
  md5-exakta.
- Träffarna är ofarliga:
  - Base64-logotypen i `offer-pdf` (finns redan i repot).
  - Funktionella standardadresser i koden (`offert@viftfast.se`, `admin@viftfast.se`).
  - Platshållare i SQL-kommentarer (`tekn@vift.se`, `test@test.se`, `admin@vift.se`), som
    redan finns ordagrant i repots migrationer.
- cron-kommandot fick ändå en regex-maskering vid uttaget. Det innehåller bara en
  Vault-uppslagning och inget värde.

## 10. Rekommenderad reproducerbar ordning för en framtida LIVE-installation

**Bara en beskrivning. Kör ingenting. Varje steg mot LIVE kräver Lucas uttryckliga
godkännande.** STAGING-only är exkluderat (se STAGING-ONLY.md). Varje steg ska först
provköras mot en tom eller kopierad STAGING-gren och jämföras mot `schema/`.

1. **Förberedelse.** Backup av LIVE:s `store`, `app_users` och `push_subscriptions`. Läs av
   LIVE:s `schema_migrations` och jämför med listan nedan. Hoppa över det som redan är
   applicerat.
2. **Grund (redan i repot, identisk):** 20260720000000–08.
3. **Atomiska RPC:er, i STAGING-ordning, källa `migrations-applicerade/`:**
   20260928000001 → 20261017000001 → 20261018000001 → 20261018000003 → 20261018000004 →
   20261018000006 → 20261020000001. Rätta backfill-felet i 20261020000001 innan den körs i
   LIVE (avsnitt 5): LIVE har troligen många AO-NNN-id, men villkoret är fel oavsett.
4. **Cutover-policyer som saknar migration** (avsnitt 7.3). Skapa en ny, versionerad
   migrationsfil ur `schema/policies.sql` för `store_*_no_direct_*`. Den ska köras först när
   motsvarande EF-klienter är ute, annars blockeras klienterna.
5. **Generiska nycklar:** 20261106000002 → 20261106000003 → 20261108000001. Källa: SI-filerna,
   verifierade mot `schema/functions.sql` och `schema/policies.sql`. Spara dem som riktiga
   filer i repot.
6. **I5, I3 och J1:** 20261116093820 → 20261116094016 → 20261116094236.
7. **Stamp-status och faktura N2/A3a/A4:** 20261117085458 → 20261117092227 → 20261117092236 →
   20261117092246. Hoppa över 20261117085418 (STAGING-only).
8. **Funktioner som bara finns i ögonblicksbilden** (avsnitt 7.2). Skapa en ny migrationsfil
   från `schema/functions.sql` med de 13 funktionerna och deras grants. Den ska köras efter
   steg 7, eftersom den ersätter tidigare versioner av invoice_* och time_entry_*.
9. **Offertflöde (CRM12):** 20261120103758 → 20261120103824 → 20261120103829.
10. **Senaste serien:** 20261124145455 → 20261124145958 → 20261124150357 → 20261124150650 →
    20261124151118 → 20261124152842 (vift-branding) → 20261124160425 → 20261124201228 →
    20261124210432 → 20261124210747. Hoppa över 20261124211128 (e2e).
11. **Storage-objekt:** ladda upp logotypen till `vift-branding/vift-logo-black.png`. I LIVE
    ska det göras utan `vift-admin-storage`, till exempel manuellt i Dashboard.
12. **Secrets:** sätt `VAPID_*`, `RESEND_API_KEY`, `FROM_EMAIL`, `FROM_NAME`,
    `PUBLIC_BASE_URL` (LIVE-domänen!) och `SERVICE_MONITOR_SECRET` i LIVE:s EF-miljö och Vault.
13. **Edge Functions**, alla utom `e2e-test-cleanup` och `vift-admin-storage`:
    - Använd STAGING-versionen för offer-respond, offer-token-validate, send-offer-email,
      get-/set-sensitive-fields, invoice-write och rondering-pass-write.
    - Använd den sammanslagna versionen för send-push.
    - För offer-pdf och time-entries-list: välj den nyare repo-versionen först efter test
      i STAGING.
    - Övriga: repot (identiskt).
    - verify_jwt enligt tabellen i avsnitt 3: `false` för offer-attachment-url,
      offer-public-pdf, offer-respond, offer-token-validate och service-monitor.
14. **cron:** `supabase/manual/setup_service_monitor_cron.sql` mot LIVE-URL:en.
15. **Kontroll:** kör en ögonblicksbild av LIVE med samma frågor som här och jämför
    funktioner, policyer och triggers med `schema/`.
