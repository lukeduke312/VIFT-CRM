# STAGING-only: får aldrig installeras i LIVE

Den här katalogen innehåller serverkod som bara hör hemma i STAGING (`yyzljlqyzzcbxmcdbual`).
Den ligger avsiktligt **utanför** `supabase/migrations/` och `supabase/functions/`. Därför
kommer den inte med i `supabase db push` eller en deploy av alla funktioner.
`tests/local/migrationskedja.sh` fallerar om någon av filerna hamnar i
`supabase/migrations/` eller i `supabase/MIGRATIONSORDNING.txt`.

## Exkluderingslista för LIVE

| Objekt | Var | Varför |
|---|---|---|
| Edge Function `e2e-test-cleanup` | `functions/e2e-test-cleanup/` | Testverktyg: rensar `[E2E-TEST]`-offerter och AO-bilder. Kräver `all`. Svarar 410 utanför STAGING. |
| Edge Function `vift-admin-storage` | `functions/vift-admin-storage/` | Avstängd 410-stubb (STAGING v8). Den tidigare aktiva underhållsversionen finns bara som referens i `supabase/inventering/referens-vift-admin-storage-aktiv/`. |
| Migration 20261117085418 `vift_staging_preinstall_snapshot_20261117` | `migrations/` | Kopierar hela `store` och `op_idempotency` till schemat `vift_staging_backup_20261117`, alltså en backup av data. |
| Migration 20261124211128 / repo 20261125000004 `e2e_purge_offer_artifacts` | `migrations/` | RPC för `e2e-test-cleanup` (SECURITY DEFINER, raderar testoffertens bilagor och händelser). |
| Schemat `vift_staging_backup_20261117` | skapas av migrationen ovan | Backup med verksamhetsdata. |
| Schemat `vift_staging_backup_20261124` | `supabase/manual/staging_backup_och_kontroll_2026-11-24.sql` | Manuell backup. |
| Tabellen `public._qa_cleanup_journal_20261124` | ingen migration (skapad manuellt) | QA-journal från städningen 2026-11-24. |
| Testroller i `vift_roles`: `v7_sakerhetstest`, `qa_p2_avgransad`, `e2e_begransad`, `e2e_falt`, `e2e_arbetsledare`, `e2e_ekonomi` | data, inte schema | Test- och QA-roller. Testkonton skapas i STAGING först efter separat godkännande (D-26). |
| `supabase/manual/staging_*.sql` | `supabase/manual/` | Backup, återställning och borttagning av e2e-konton i STAGING. |

`functions/_shared` är en symbolisk länk till `../../functions/_shared`. Länken behövs för
att `e2e-test-cleanup` ska kunna deployas till STAGING från den här katalogen. Kopiera
funktionen till en tillfällig `supabase/functions/`-katalog först, och bara mot STAGING
efter godkännande.

## Två funktioner med STAGING-spärr som SKA till LIVE

`send-offer-email` och `send-push` innehåller `isProductionEnvironment()`. Spärren släpper
bara igenom LIVE-projektet, så funktionerna ligger kvar i `supabase/functions/`.
