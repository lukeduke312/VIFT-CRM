# STAGING-only: allt som aldrig får installeras i LIVE

Källa: läsning (endast SELECT och get_edge_function) mot STAGING-projektet
`yyzljlqyzzcbxmcdbual`, 2026-11-25. LIVE (`hjplzjsbbowiyoyhdghc`) har inte rörts.

Allt i listan nedan ska bort ur varje framtida LIVE-installationsordning. Det ska inte
deployas, inte köras och inte kopieras in i en LIVE-migrationskedja.

## 1. Edge Functions

| Slug | STAGING-version | Varför bara STAGING | Spärr i koden |
|---|---|---|---|
| `e2e-test-cleanup` | v1 | Testverktyg som rensar `[E2E-TEST]`-offerter (via RPC `e2e_purge_offer_artifacts`) och AO-bilder i Storage. | Svarar 410 när `SUPABASE_URL` saknar STAGING-ref, och kräver behörigheten `all`. |
| `vift-admin-storage` | v8 (410-stubb) | Tillfällig underhållsfunktion från 2026-11-24 som laddade upp logotypen till `vift-branding` och tog bort testobjekt. I STAGING är den avaktiverad och svarar alltid 410 `disabled`. | Repo-filen `supabase/functions/vift-admin-storage/index.ts` är fortfarande den **aktiva** versionen (behörigheten `all`, uppladdning och borttagning). Den får aldrig deployas till LIVE. Föreslagen åtgärd, som kräver godkännande: ersätt repo-filen med 410-stubben eller ta bort katalogen. |

Två funktioner hör till den riktiga arkitekturen men har STAGING-spärrar.
**De ska till LIVE.** Spärrarna släpper bara igenom LIVE-projektet:

- `send-offer-email` (STAGING v11): `isProductionEnvironment()` kräver värden
  `hjplzjsbbowiyoyhdghc.supabase.co`. OBS: standardvärdet för `PUBLIC_BASE_URL` i
  STAGING-källan är `https://staging-crm.viftfast.se`. I LIVE måste variabeln sättas
  explicit, annars får kundlänkar och logotyp-URL en STAGING-domän.
- `send-push` (STAGING v9): spärren mot `https://hjplzjsbbowiyoyhdghc.supabase.co`.

## 2. Migrationer (supabase_migrations.schema_migrations)

| Version | Namn | Bedömning |
|---|---|---|
| 20261117085418 | `vift_staging_preinstall_snapshot_20261117` | **Bara STAGING.** Skapar schemat `vift_staging_backup_20261117` med en kopia av hela `store`, `op_idempotency` och utvalda funktionsdefinitioner, alltså en backup av data. Får aldrig köras i LIVE som migration. |
| 20261124211128 | `e2e_purge_offer_artifacts` (repo: `20261125000004_e2e_purge_offer_artifacts.sql`) | **Bara STAGING.** RPC:n som `e2e-test-cleanup` använder. Den tar bara bort offerter vars titel börjar med `[E2E-TEST]`, men den är ett testverktyg med SECURITY DEFINER. |
| 20261106000002 | `staging_generic_keys_write_lockdown` | **Riktig arkitektur trots namnet.** Skapar `store_business_key_*`, `store_read_all_with_hashes` och `_staging_business_key_required_perm`, som `store-key-write` är beroende av. Ska till LIVE. (Statements är tomma i STAGING, se INVENTERING.md.) |
| 20261106000003 | `staging_generic_keys_enforce_rls` | **Riktig arkitektur.** RESTRICTIVE-policyerna `staging_generic_keys_no_direct_*` på `public.store`. Ska till LIVE. |
| 20261108000001 | `staging_review_fixes` | **Riktig arkitektur.** Bland annat `store_business_key_merge_write`. Ska till LIVE. |
| 20261117085458 | `staging_stamp_status_identity_scoped_cas_20261117` | **Riktig arkitektur.** Tabellen `stamp_status` och RPC:erna `store_read_stamp_status`/`store_write_stamp_status`. |
| 20261117092227 | `staging_invoice_n2_tombstone_20261117` | **Riktig arkitektur.** Fakturaidempotens med N2-tombstone. |
| 20261117092236 | `staging_invoice_price_approval_a3a_atomic_20261117` | **Riktig arkitektur.** `invoice_stale_override_approve_commit` och A3a-spärren i `invoice_set_status`. |
| 20261117092246 | `staging_a4_notifications_legacy_guard_20261117` | **Riktig arkitektur.** Triggern `protect_notifications_and_legacy_keys`. |

Prefixet `staging_` betyder alltså bara att migrationen installerades i STAGING först.
Bara de två första raderna är STAGING-specifika.

## 3. Databasobjekt utan migration som bara finns i STAGING

| Objekt | Typ | Kommentar |
|---|---|---|
| `vift_staging_backup_20261117` (schema: `store`, `op_idempotency`, `function_definitions`, `fingerprints`) | backup | Skapas av migrationen 20261117085418. Innehåller verksamhetsdata och har inte lästs här. |
| `vift_staging_backup_20261124` (schema: samma fyra tabeller) | backup | Skapades manuellt (`supabase/manual/staging_backup_och_kontroll_2026-11-24.sql`). |
| `public._qa_cleanup_journal_20261124` | tabell, RLS på, 100 rader | QA-journal från städningen 2026-11-24 (docs/qa-2026-11-24). Ingen migration. Får aldrig till LIVE. |
| `public.store_backup_prop_objects_20260720`, `public.store_backup_properties_20260720` | backup-tabeller | Kommer från repo-migrationen 20260720000004. De följer med i LIVE-kedjan men är engångsbackuper (bedömning, inte STAGING-specifikt). |
| cron-jobbet `vift-service-monitor-daily` | cron | Som det står i STAGING pekar det på STAGING:s egen URL. I LIVE ska jobbet skapas med `supabase/manual/setup_service_monitor_cron.sql` mot LIVE-URL:en och med LIVE:s Vault-hemlighet, och bara efter Lucas godkännande. |

## 4. Testroller och testkonton (data i `vift_roles`/`vift_staff`, inte schema)

Rollerna i STAGING:s `vift_roles` är `admin` (`all`), `v7_sakerhetstest`, `qa_p2_avgransad`,
`e2e_begransad`, `e2e_falt`, `e2e_arbetsledare` och `e2e_ekonomi`. Alla utom `admin` är
test- eller QA-roller och får inte följa med till LIVE. Av 9 personalposter i STAGING
matchar 7 test- eller e2e-mönster (bara antal har lästs, inga namn eller adresser).
Antalet AO och offerter med `[E2E-TEST]`-titel är 0 vid tidpunkten för läsningen.

## 5. Övrigt som hör till testning

- `tests/e2e/**` och `tests/fixtures/staging_offer_rpcs_installed.sql` i repot: testverktyg,
  ingen LIVE-installation.
- `supabase/manual/staging_*.sql` (backup, återställning och borttagning av e2e-konton):
  bara STAGING.
