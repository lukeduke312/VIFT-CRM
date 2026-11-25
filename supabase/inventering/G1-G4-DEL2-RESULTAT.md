# G1/G4 del 2: reproducerbar serverarkitektur (2026-11-27)

**Avgränsning:** BESLUT-2026-11-27, omgång T0–T2. Allt arbete är gjort i repot och mot en
lokal PostgreSQL.

- STAGING: endast läsande `SELECT`, för jämförelse. Ingenting deployades, migrerades eller
  skrevs.
- LIVE: inte kontaktad.
- Inga hemligheter och ingen verksamhetsdata finns i repot. I STAGING lästes bara schema,
  funktionsdefinitioner (inklusive backup-tabellen `function_definitions`), antal och
  id-format.

## 1. Sammanfattning

- **Migrationskedjan är reproducerbar lokalt.** 45 migrationsfiler går igenom utan fel mot
  en tom PostgreSQL med Supabase-stubbar. Det gäller både i STAGING-ordning
  (`supabase/MIGRATIONSORDNING.txt`) och i ren filnamnsordning (som `supabase db push`).
- **Schemajämförelse mot STAGING:** 126 identiska objekt, 7 förklarade avvikelser,
  **0 oförklarade**. Jämförelsen omfattar:
  - 64 funktioner, jämförda på exakt `pg_get_functiondef` och EXECUTE-ACL,
  - 51 RLS-policyer i `public` och `storage`,
  - 3 triggers,
  - 11 tabeller/sekvenser (kolumner, constraints, index, RLS och ACL),
  - 4 buckets.
- **28 nya filer i `supabase/migrations/`:**
  - 17 återställda ur STAGING:s migrationshistorik, exakta och md5-kontrollerade,
  - 3 kandidater för de tomma migrationerna,
  - 5 rekonstruerade ur STAGING-schemat (varav en med versionsnummer 20261024000001),
  - övriga ändringar: 3 PROPOSAL-filer flyttade bort och 1 STAGING-only-migration flyttad
    till `staging-only/`.
- **Säkerhetsfynd utanför uppdraget:** utan rekonstruktionen R-E skulle en ny installation
  ge `anon` och `authenticated` EXECUTE på SECURITY DEFINER-funktionen `provision_vift_user`
  (och `deactivate_vift_user`, `check_app_users_health`). I STAGING är dessa rättigheter
  återkallade utanför migrationerna. R-E rättar detta.
- **Edge Functions:** de fem där STAGING var nyare är synkade, och de beteenden som bara
  fanns i repot är bevarade och dokumenterade. `send-push` är sammanslagen.
  `vift-admin-storage` och `e2e-test-cleanup` är flyttade till `supabase/staging-only/`.
  `PUBLIC_BASE_URL` har inget reservvärde längre.
- **Tester:** se avsnitt 9. Alla körda tester är gröna. Inget test har ändrats för att bli
  grönt.

## 2. Nya och flyttade filer

| Fil | Typ | Innehåll |
|---|---|---|
| `migrations/20260928000001_offer_events_atomic_rpc.sql` … `20261124152842_vift_branding_bucket_20261124000004.sql` (17 st.) | Återställd ur STAGING | Huvud och exakt `array_to_string(statements, E';\n')` (md5 anges i huvudet, samma som i `inventering/.../migrations-applicerade/`), plus ett avslutande `;` |
| `migrations/20261106000002_…`, `20261106000003_…`, `20261108000001_…` | **Kandidat**, inte historisk SQL | SI-filen från `staging-release/_staging_integration/server/migrations/` under ett tydligt KANDIDAT-huvud. Se avsnitt 4. |
| `migrations/20261024000001_rekonstruerad_faktura_revisionskontroll.sql` | Rekonstruerad (R-A) | `_invoice_calc_financial`, `_invoice_financial_check`, `invoice_line_add/update/delete`, `invoice_discount_set`, `invoice_tax_reduction_set`, `invoice_meta_update` i driftversion. `invoice_set_status(text,text,bigint,text)` i versionen *före* A3a, ur STAGING:s backup `vift_staging_backup_20261117.function_definitions` med verifierad md5 `b86aab34…`. Gamla signaturer tas bort. |
| `migrations/20261127000001_rekonstruerad_store_skyddstrigger.sql` | Rekonstruerad (R-B) | `_protect_critical_store_keys()` och triggern `protect_critical_store_keys` |
| `migrations/20261127000002_rekonstruerad_time_entry_rpc.sql` | Rekonstruerad (R-C) | `time_entry_create/patch/soft_delete/set_attested` i driftversion. Gamla signaturer tas bort. |
| `migrations/20261127000003_rekonstruerad_store_restrictive_policyer.sql` | Rekonstruerad (R-D) | 14 RESTRICTIVE-policyer `store_{ao_time,invoices,offerattachments,ronderingspass}_no_direct_*`, `store_workorders_no_direct_select`, `store_timeentries_no_direct_select` |
| `migrations/20261127000004_rekonstruerad_grants_och_store_policy.sql` | Rekonstruerad (R-E) | REVOKE från anon/authenticated på de tre admin-funktionerna, och `store_active_write_safe` i driftversion (undantar även `vift_offerEvents`) |
| `MIGRATIONSORDNING.txt` | Ny | Auktoritativ ordning (STAGING:s facit plus rekonstruktionerna), med STAGING-only utkommenterat |
| `staging-only/` | Flyttat | `migrations/20261117085418_…`, `migrations/20261125000004_e2e_purge_offer_artifacts.sql`, `functions/e2e-test-cleanup/`, `functions/vift-admin-storage/` (410-stubb, identisk med STAGING v8), README med exkluderingslista |
| `forslag-ej-applicerade/` | Flyttat | De tre `*_PROPOSAL_*`-filerna, som aldrig applicerats i STAGING och skulle ge avvikande objekt. README finns. |
| `inventering/referens-vift-admin-storage-aktiv/` | Referens | Repots tidigare **aktiva** `vift-admin-storage`, märkt ALDRIG LIVE |
| `functions/_shared/public-base-url.ts` | Ny | Validering av `PUBLIC_BASE_URL`, se avsnitt 6 |
| `config.toml` | Ändrad | `[functions.offer-public-pdf] verify_jwt = false`, som i STAGING. Övriga verify_jwt stämmer redan. |
| `AUKTORITATIV-KALLA.md` | Ny | Server- och klientkälla, samt förslag för VIFT-CRM:s spegel |
| `tests/local/` | Nytt | `migrationskedja.sh`, `jamfor-schema.js`, `supabase-stubbar.sql`, `staging-schema-facit-2026-11-25.json`, `kanda-avvikelser.json` |
| `tests/*.test.js` | Nya | `migrationskedja`, `rekonstruerade_rpc_sql`, `public_base_url`, `edge_functions_syntax` |

Inventeringens ögonblicksbild `inventering/staging-2026-11-26/` och de återställda källorna
(`functions/invoice-write`, `functions/rondering-pass-write`) är oförändrade.
`inventering/staging-2026-11-26/STAGING-ONLY.md` anger fortfarande de gamla sökvägarna för
`vift-admin-storage`/`e2e-test-cleanup`. De aktuella platserna står i
`supabase/staging-only/README.md`.

## 3. De rekonstruerade migrationerna

Alla har huvudet "Rekonstruerad 2026-11-27 från STAGING-schema
(pg_get_functiondef/pg_policies), inte historisk SQL".
- Funktionstexterna är exakt `pg_get_functiondef()` från STAGING.
- SECURITY DEFINER, `SET search_path` och argumentlistor följer med i den texten.
- Grants och REVOKE är härledda ur `proacl`: exakt samma rättighetsuppsättning efter körning.

Efter kedjan är alla 13 funktioner **byte för byte identiska** med STAGING, inklusive ACL.
Detta kontrolleras av `tests/local/jamfor-schema.js`. Det gäller också policyerna och
triggern.

**Avvikelse från "datumprefix efter befintliga":** R-A har fått versionsnummer
20261024000001 och inte 20261127. Skälen:
- Den registrerade migrationen A3a (20261117092236) har en STOP-kontroll som kräver att
  `invoice_set_status(text,text,bigint,text)` redan finns med md5 `b86aab34…`.
- Den registrerade J1/N2-kedjan förutsätter också revisionssignaturerna.
- R-A måste därför ligga före dem, både i `MIGRATIONSORDNING.txt` och i filnamnsordning.
- 20261024000001 är numret som invoice-write-kommentaren anger för den oregistrerade
  originalfilen (`migrations_phase1_additive/…_invoice_revision_conflict_control.sql`).

R-B–R-E är daterade 20261127 och ligger sist. Ingen registrerad migration efter dem
förutsätter något annat.

Utan rekonstruktionerna R-B–R-E ger samma kedja **26 oförklarade avvikelser**:
- 10 funktioner (saknade, fel version eller fel ACL, plus 2 kvarvarande gamla överlagringar),
- 15 policyer,
- 1 trigger.

Med dem: 0.

## 4. De tre tomma migrationerna (20261106000002/03, 20261108000001)

I STAGING är `statements` tomma, så den SQL som faktiskt kördes är **okänd**. I
`supabase/migrations/` ligger nu SI-filerna med samma versionsnummer, märkta
**KANDIDAT, INTE BEVISAD HISTORISK SQL**.

Lokalt mot drift efter hela kedjan:

| Kandidat | Objekt | Resultat mot STAGING |
|---|---|---|
| 20261106000002 | `_staging_business_key_required_perm`, `store_business_key_write`, `store_business_key_read_with_hash`, `store_business_keys_read_hashes`, `store_read_all_with_hashes` + REVOKE/GRANT | Alla 5 identiska (definition och ACL). `_staging_business_key_required_perm` har EXECUTE för authenticated, precis som i drift. |
| 20261106000003 | Policyerna `staging_generic_keys_no_direct_{insert,update,delete}` | Identiska |
| 20261108000001 | `store_business_key_merge_write` + REVOKE/GRANT | Identisk |

Kandidaterna återskapar alltså exakt det som finns i drift för dessa objekt. Att just de
filerna kördes, och att inget mer kördes, går inte att bevisa.

## 5. Edge Functions

| Funktion | Åtgärd | Bevarat från repot (märkt `REPO-BEVARAT`) | Inte bevarat, kräver beslut |
|---|---|---|---|
| get-sensitive-fields | Ersatt med STAGING v9 (I5: fail-closed audit, supabase-js 2.110.8) | Inget (repot var den äldre versionen) | – |
| set-sensitive-fields | Ersatt med STAGING v9 (RPC:n `sensitive_fields_write`, atomisk skrivning och audit) | Inget (RPC:n sätter även `updated_by`) | – |
| offer-token-validate | STAGING v11 + repo-beteenden | (1) status `ersatt` ger 410 `replaced`, både som förkontroll och på den låsta posten; (2) contactName/-Email hämtas ur vift_customers när offerten saknar dem | – |
| offer-respond | STAGING v10 + repo-beteenden | (1) `ersatt` ger 410 `replaced`; (2) giltig `lockedSnapshotJSON` krävs (409) och offerVersion jämförs mot snapshotens version; (3) in-app-notiser till personal med `offer_manage`/`all` vid godkännande, nu med jämför-och-byt på `updated_at` | `approvedByPhone`/`approvedByPosition` sparas inte (RPC:n saknar dem). Repots regel att `ändring-begärd` räknas som besvarad saknas i RPC:n; en EF-förkontroll skulle bryta requestId-reprisen. Båda kräver en ny RPC-migration. |
| send-offer-email | STAGING v11 + `PUBLIC_BASE_URL` utan reservvärde | Inget (repot var äldst, 2026-07-20) | – |
| send-push | **Manuell sammanslagning:** repots V42–V45 (declarative push, TTL/urgency, testEndpoint-diagnostik, staffIds-tilldelningspush) + STAGING v9:s spärr `isProductionEnvironment()` direkt efter `checkViftAuth()`, som i STAGING | All V42–V45-logik är kvar. STAGING:s mottagarlogik (propertyId/userId/broadcast) var redan identisk. Navigate-origin kommer nu från `PUBLIC_BASE_URL` (var hårdkodad LIVE-domän). | STAGING:s enklare payload `{title, body, url}` ersätts av repots declarative-format. Kräver klienten med repots service-worker. |
| vift-admin-storage | 410-stubb (= STAGING v8) i `staging-only/functions/` | Aktiv kod endast som referens i `inventering/referens-vift-admin-storage-aktiv/` (ALDRIG LIVE) | – |
| e2e-test-cleanup | Flyttad till `staging-only/functions/` (koden identisk med STAGING v1) | – | – |

Varje fil har ett REPO-SYNK-huvud som anger källversion och ändringar. En kontroll mot
STAGING visar att varje STAGING-kodrad finns kvar, utom avsiktligt ersatta rader: STAGING:s
standardvärde för `PUBLIC_BASE_URL`, send-push-payloaden och `buildPublicOffer` med ny
signatur.

**De ändrade funktionerna är inte verifierade i STAGING.** Lokalt har bara TypeScript-
syntaxen kontrollerats (`edge_functions_syntax.test.js`), inte körning i Deno.

Övriga EF-skillnader mot STAGING ligger kvar som i del 1 och ändrades inte i denna omgång:
- `offer-pdf` och `time-entries-list`: repot är nyare.
- Övriga: kommentarer och format skiljer.

## 6. PUBLIC_BASE_URL

- `functions/_shared/public-base-url.ts` → `resolvePublicBaseUrl(PUBLIC_BASE_URL, SUPABASE_URL)`:
  - värdet måste finnas, vara `https`, och bestå av bara schema och värd;
  - i LIVE-projektet avvisas ett värdnamn som innehåller "staging";
  - det finns inget reservvärde.
- `send-offer-email` och `send-push` svarar `500 config_missing_public_base_url` eller
  `config_invalid_public_base_url` **före** body-parsning, DB-skrivningar och utskick.
- Kontrollen ligger efter STAGING-spärren, så STAGING svarar som i dag `blocked_in_staging`.
- Inga andra EF använder en publik bas-URL. `offer-public-pdf` har bara texten "viftfast.se"
  i sidfoten.
- **Statisk kontroll och logiktest:** `tests/public_base_url.test.js` (16 kontroller).
  - Inget `PUBLIC_BASE_URL ?? / ||`-reservvärde finns, och ingen STAGING-domän i
    `supabase/functions/`.
  - Ingen hårdkodad crm-/app-origin finns i koden.
  - Validering sker före skrivningar och utskick.
  - `resolvePublicBaseUrl` testas med 9 fall.
- **Kvar att göra före LIVE:** sätt `PUBLIC_BASE_URL` som secret i LIVE (och i STAGING) när
  funktionerna installeras. Annars svarar de med 500, vilket är avsikten.

## 7. Kontroll mot ögonblicksbilden (punkt 8)

`tests/local/jamfor-schema.js` jämför efter hela kedjan:
- funktionssignatur och `pg_get_functiondef` (inklusive SECURITY DEFINER, search_path och
  språk),
- EXECUTE-ACL som mängd,
- `pg_policies`, triggers, tabellstruktur och tabell-ACL samt `storage.buckets`.

Beroenden mellan RPC:er prövas genom att kedjan körs med migrationernas egna STOP-kontroller
(N2, A3a och CRM12) och genom SQL-testerna i avsnitt 9.

**De 7 förklarade avvikelserna:**
- **5 funktioner med samma kod** (`project_documents_append/_finalize_delete/_update_one`,
  `vift_store_project`, `work_order_checklist_set_state`): repo-källan har kommentarer i
  funktionskroppen som inte följde med när STAGING installerades. Koden är identisk efter
  att kommentarer och whitespace tagits bort.
- **`e2e_purge_offer_artifacts`**: STAGING-only, avsiktligt utanför kedjan. Lokalt
  verifierat att `staging-only/migrations/20261125000004` ger exakt STAGING:s definition.
- **`_qa_cleanup_journal_20261124`**: STAGING-only, ingen migration.

**Avvikelser som hittades och åtgärdades:**
- 13 saknade eller felaktiga funktioner,
- triggern `protect_critical_store_keys`,
- 14 RESTRICTIVE-policyer och `store_active_write_safe`,
- EXECUTE för anon/authenticated på 3 admin-funktioner,
- 2 kvarvarande gamla överlagringar (`time_entry_patch(4 arg)`, `time_entry_soft_delete(2 arg)`),
- `config.toml`: offer-public-pdf saknade `verify_jwt = false`.

**Kvar att notera, inte avvikelse:** fem hjälpfunktioner utan SECURITY DEFINER har EXECUTE
för PUBLIC/anon/authenticated i drift (Supabase default privileges). Det återges som i drift.

## 8. Lokal PostgreSQL jämfört med Supabase, och PG16 jämfört med PG17

**Lokalt (`tests/local/supabase-stubbar.sql`) jämfört med Supabase:**

| Område | Lokalt | Supabase |
|---|---|---|
| Roller | `anon`, `authenticated` (NOLOGIN), `service_role` (BYPASSRLS); ingen `authenticator`/JWT-växling | PostgREST byter roll per JWT |
| `auth` | `auth.users` (id, email m.m.), `auth.uid()/jwt()/role()` läser `request.jwt.claims` | GoTrue-schema med fler tabeller och funktioner |
| `storage` | Tabellerna `buckets`/`objects` med RLS påslaget; inga filer, inget storage-API, inga plattformstriggers | Storage-API och plattformens triggers (se `inventering/.../schema/triggers.sql`) |
| Default privileges | Emulerade: postgres i public → ALL/EXECUTE till anon, authenticated, service_role | Samma beteende |
| `extensions` | pgcrypto i schemat `extensions`; search_path `"$user", public, extensions` | Fler extensions |
| `pg_cron`, `pg_net`, Vault | **Saknas.** Kedjan behöver dem inte (20260720000003 är en avsiktlig no-op; cron-jobbet skapas manuellt) | Finns; cron-jobbet läser Vault |
| Edge Functions | Körs inte. Endast TS-syntaxkontroll | Deno-runtime |

**PostgreSQL-version:** STAGING kör 17.6 (enligt koordinatorns `select version()`), lokalt
16.15.
- PG17 gick **inte** att installera:
  - Ubuntu noble har inget `postgresql-17`-paket.
  - apt.postgresql.org gav 403 i proxyn.
  - npm- och PyPI-registren gick inte att nå (DNS).
  - Nätverksreglerna har inte ändrats.
- Identifierade skillnader som kan påverka:
  1. **Rättigheten MAINTAIN (`m`)** finns i PG17:s tabell-ACL (`arwdDxtm`) men inte i PG16
     (`arwdDxt`). Jämförelsen räknar bort `m`. En LIVE-installation på PG17 får samma ACL
     som STAGING.
  2. **`pg_get_functiondef`-utdata:** identisk mellan 16 och 17 för alla 64 funktioner. Det
     visas av att 58 är byte för byte lika, och att md5-kontrollerna i N2/A3a, som jämför
     mot md5 räknade i STAGING på PG17, går igenom på PG16.
  3. **plpgsql-kroppar kontrolleras bara syntaktiskt** när de skapas. Ett anrop till en
     funktion som bara finns i PG17 skulle först fela vid körning.
- **Sökning i alla migrationer** (inklusive staging-only) efter PG17-specifika konstruktioner
  gav **inga träffar**: `JSON_TABLE`, `MERGE … WHEN NOT MATCHED BY SOURCE`, `MERGE …
  RETURNING`, `random(min,max)`, `uuid_extract_*`, `to_bin/to_oct`, `transaction_timeout`,
  `pg_maintain`/`MAINTAIN`, `COPY … ON_ERROR`, `AT LOCAL`, jsonpath-metoderna
  `.bigint()/.boolean()/.integer()/.string()`. Inte heller PG16-specifika:
  `any_value`, `regexp_*`, `JSON_OBJECT/JSON_ARRAY`, `IS JSON`, `pg_input_is_valid`.
- PG17:s ändring av search_path vid underhållsoperationer (index-/MV-uttryck) berör inte
  schemat. Alla index är rena kolumnindex.
- SQL-testerna (avsnitt 9) kör de rekonstruerade och återställda funktionerna på riktigt på
  PG16. **Rekommendation:** kör `tests/local/migrationskedja.sh` och SQL-testerna en gång på
  PG17 när ett nät med PGDG finns, innan LIVE.

## 9. Testresultat (lokalt, PGHOST=/var/tmp/vift-localpg, PostgreSQL 16.15)

| Test | Repo | Resultat |
|---|---|---|
| checklist_progress_sql | VIFT-CRM / vift-v2 | 32/0 / 32/0 |
| server_rpcs_sql | VIFT-CRM / vift-v2 | 17/0 / 17/0 |
| offer_attachment_upload | VIFT-CRM / vift-v2 | 43/0 / 43/0 |
| staging_backup_export | VIFT-CRM / vift-v2 | 12/0 / 12/0 |
| migrationskedja (nytt; STAGING-ordning och filnamnsordning) | vift-v2 | 2/0. Varje variant: 45 filer utan fel; 126 identiska, 7 förklarade, 0 oförklarade |
| rekonstruerade_rpc_sql (nytt) | vift-v2 | 40/0 |
| public_base_url (nytt) | vift-v2 | 16/0 |
| edge_functions_syntax (nytt) | vift-v2 | 32/0 |
| Hela `tests/run-all.sh` (SKIP_BROWSER=1) | vift-v2 | **19/20 testfiler gröna**: totalt 477 godkända och 1 fallerad kontroll. Webbläsartesterna hoppades över (Playwright saknas) och räknas inte som godkända. |

Noteringar:
- **Den enda röda kontrollen, `staging_e2e_real.test.js`, fallerar likadant på HEAD (c011aa6)
  före alla ändringar i denna omgång.** Resultatet är 25/1, kontrollen "kod 0 (1)".
  Orsaken: den lokala fake-backenden (`tests/e2e/fake-backend.js`) modellerar inte
  `/functions/v1/e2e-test-cleanup` och svarar 501. Därför markeras steget "STÄDNING
  testartefakter" som AVVIK och skriptet avslutas med kod 1. Det beror alltså inte på flytten
  av `e2e-test-cleanup` till `staging-only/`, eftersom fake-backenden inte läser
  `supabase/functions/`. Testet har inte ändrats. Föreslagen rättning, ej gjord: modellera
  `e2e-test-cleanup` i fake-backenden.
- Siffrorna anges som godkända/fallerade.
- Två fall i `rekonstruerade_rpc_sql` skrevs först efter ett antagande om beteendet och
  rättades efter driftkoden. `invoice_line_delete` på okänd rad är idempotent och höjer
  revisionen. `invoice_meta_update` ignorerar fält som inte är vitlistade, i stället för att
  ge fel. Det är driftens faktiska beteende, och testerna beskriver nu det.

## 10. Återstående hinder för en reproducerbar serverarkitektur

1. **Beslut om auktoritativ källa** (`AUKTORITATIV-KALLA.md`). VIFT-CRM:s `supabase/` är en
   inaktuell spegel med de tre PROPOSAL-filerna kvar i `migrations/`.
2. **De tre tomma migrationerna** kan bara återges med kandidater. De motsvarar drift exakt,
   men det är inte bevisat att det var den SQL som kördes.
3. **Rekonstruerad SQL är inte historisk.** Mellanstegen för invoice_*/time_entry_* och
   cutover-policyerna är okända. LIVE måste installeras i ordningen i
   `MIGRATIONSORDNING.txt`, och policyerna i R-D först när klienten använder EF-vägarna.
4. **EF-ändringarna i denna omgång är inte testade i Deno eller STAGING**: offer-respond,
   offer-token-validate, send-offer-email, send-push och `public-base-url`. De kräver ett
   STAGING-test efter godkännande.
5. **offer-respond:** phone/position och regeln för `ändring-begärd` kräver en ny version av
   RPC:n.
6. **PG17:** kedjan och testerna bör köras på PG17 innan LIVE.
7. **Vault, secrets och cron:** `SERVICE_MONITOR_SECRET`, `VAPID_*`, `RESEND_API_KEY`,
   `FROM_*` och `PUBLIC_BASE_URL` sätts per miljö manuellt. Cron-jobbet körs via
   `supabase/manual/setup_service_monitor_cron.sql` efter godkännande.
8. **AO-nummerserien:** off-by-one-felet i backfill-steget i 20261020000001 (del 1, avsnitt 5)
   finns kvar som historisk SQL. En rättning för LIVE är inte gjord.
9. **Storage-objekt:** logotypen i `vift-branding` måste laddas upp separat. Det är data,
   inte en migration.
10. **`supabase db push` mot ett befintligt projekt:** repots filnamn för redan installerade
    migrationer (t.ex. 20261124000001) skiljer sig från STAGING:s versionsnummer
    (20261124145958). En push mot STAGING skulle se dem som nya. Mot en tom LIVE-databas
    fungerar filnamnsordningen (verifierat lokalt). För STAGING behövs en
    `supabase migration repair` eller en mappning, och det kräver beslut.
