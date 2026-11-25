# VIFT CRM – säkerhets-, test- och installationsplan (korrigerad 2026-11-27)

**Underlag:**
- `docs/qa-2026-11-27/BESLUT-2026-11-27.md`, auktoritativt: D-01–D-26, AP-A–AP-G, justeringar av säkerhetsplanen;
- `BEHORIGHETSMATRIS.md` (fastställd): R01–R63, felkodskatalog, testfall `SEC-*`, egna roller `SEC-CUST-*`, fynd F1–F23 med SÄK-koppling;
- serverinventeringen `vift-v2/supabase/inventering/staging-2026-11-26/`.

**Dokumentet kör ingenting.** Inga kommandon är körda i samband med det. Inga anrop är gjorda mot STAGING eller LIVE.

---

## 1. Gränser

| Regel | Gäller |
|---|---|
| **LIVE** kontaktas eller ändras aldrig | Alla omgångar. `tests/staging/lib.js` `guard()` nekar LIVE och godtar bara det hashlåsta STAGING-projektet eller lokalt testläge. |
| **Omgång T0–T2 (nu):** bara dokumentation, arbete i repot, rekonstruerade migrationer, samordning av källkod och lokal testning | Ingen installation i STAGING, inga skrivande STAGING-tester, ingen ändring av verksamhetsposter, ingen datamigrering, ingen UI/UX-omgång, ingen ombyggnad av rondering, inga framtidsmoduler |
| **T3/T4** körs i första hand **lokalt** | Installation och verifiering i STAGING kräver separat GO per paket (§6, §8) |
| **I STAGING** används bara isolerade märkta testposter (`[E2E-TEST]`, id med `runId`). Befintliga verksamhetsposter används **aldrig**, inte ens när anropet förväntas nekas. | `authz-mutation.js`/`recovery.js`: journal, spärrfil, efterkontroll |
| **Destruktiva scenarier körs bara lokalt eller i isolerad miljö:** skrivning av hel nyckel, rollregister och personalroller, `vift_settings` och append-only-loggar (`appendActivity`, `sensitive_access_audit`) | Lokal STAGING-replik (§3.2) |
| Inga hemligheter, personnummer, portkoder eller lösenord i rapporter, chatt eller git. Exportfiler raderas efter automatisk kontroll. | Alla tester |

---

## 2. Klassning och nuläge

### 2.1 SÄK-klassning (fastställd 2026-11-27)

| SÄK | Fynd | Klass | Paket |
|---|---|---|---|
| SÄK-5 | F1: `ao_complete` sätter `klar` på valfri AO, även `fakturerad`. `work_order_patch` saknar regelkontroller. | **P1** | T3-B |
| SÄK-3 | F4: `status=pool` lämnas ut oavsett `staff` (EF, `canViewWorkOrder`, SQL-urval, simulerad server) | **P1** | T3-B |
| SÄK-4 | F4: "Ta jobbet" på AO med personal, utan lås | **P1** | T3-B |
| SÄK-2 | O2: fältets Uppgifter visar andras uppgifter | **P1** | T3-D |
| SÄK-6 | F2: materialpriser från klienten, okänt = 0 | **P1** | T4-B |
| SÄK-7 | F3: skrivare utan `objects_sensitive` får portkod i data. **Informationsläckaget = P1.** Den saknade tilldelningsvägen = P2. | **P1**/P2 | T4-A (läckage), T4-C (väg) |
| SÄK-8 | F5: `staff_manage` kan ge sig själv admin, inget skydd för sista superadmin | **P1 inför LIVE** | T3-C |
| SÄK-9 | F6: cache kvar efter utloggning, används vid degraderad inläsning | **P1 inför LIVE** | T3-A |
| SÄK-10 | F7: reservrollen `personal` | **Blockerar standardrollen `personal`**. Rättas före standardrollerna. | T3-A |
| SÄK-1 | O1: personnummer förvalt i export | P2 | T4-F |
| – | F21: `ao_edit` kan sätta `fakturerad` i `patch_ao` (D-07) | **P1** | T3-B |
| – | F16/F23: tid och stämpling utan tilldelningskontroll (AP-B) | **P1** | T3-B |

### 2.2 Vad som är klart

| Område | Läge |
|---|---|
| **De fyra PostgreSQL-testerna** | **Körda lokalt och gröna:** PostgreSQL 16 via `PGHOST=/var/tmp/vift-localpg`. `checklist_progress_sql` 32, `server_rpcs_sql` 17, `offer_attachment_upload` 43 (alla tre delarna, `tsc` tillgängligt), `staging_backup_export` 12. Totalt **104 godkända, 0 fel**. |
| Serverkällor (G1/G4) | Inventerade läsande: 41 applicerade migrationer (38 md5-verifierade), 26 EF-källor exakta, `schema/functions.sql` (64 funktioner, även `work_order_patch` och `time_entry_*`), `schema/policies.sql` (51 policyer). `invoice-write` och `rondering-pass-write` är återställda till `vift-v2/supabase/functions/`. |
| C-5 och tid/AO-läsning i STAGING | `c5-read.js` och `authz-read.js` gröna (2026-11-25/26) |
| PERM-03/G13 | Bara "skapa ny post", 36/36. Resten görs lokalt (§3.3). |

### 2.3 Vad som återstår före T3

1. **13 funktioner och de RESTRICTIVE cutover-policyerna finns bara i ögonblicksbilden.** De ska bli versionerade migrationer i repot (T3-0).
2. **Fem EF:er är nyare i STAGING än i repot:** `get-sensitive-fields`, `set-sensitive-fields`, `offer-respond`, `offer-token-validate`, `send-offer-email`. `send-push` är divergerad. Repot synkas före ändringar.
3. **Migrationerna är uppdelade** mellan `vift-v2` och `VIFT-CRM`. De samlas i ett repo med fullständig ordning enligt `INVENTERING.md` §10.
4. **Testverktygen ska kontrollera felkod, `reason` och kontrollsumma** (§4). I dag godkänner `authz-mutation.js` varje 401/403/`key_not_allowlisted` som "nekad".
5. **Den simulerade servern** (`tests/e2e/fake-backend.js`) har samma poolläcka och saknar fältbegränsningen i `patch_ao`. Den ska spegla den rättade servern.
6. Testkonton med exakt standardrollerna och egna roller (D-26) skapas i STAGING **först efter separat godkännande**. Lokalt skapas de fritt i replikan.

---

## 3. Lokal testmiljö (huvudspår för T3/T4)

### 3.1 De fyra befintliga PostgreSQL-testerna

| Test | Prövar | Resultat |
|---|---|---|
| `tests/checklist_progress_sql.test.js` | Checklistans tre lägen (`work_order_checklist_set_state` och den äldre `_resolve`), ingen loggning i aktivitetsloggen, `vift_lastChanged` | 32/32 |
| `tests/server_rpcs_sql.test.js` | `activity_log_append` (idempotens, kapning, `lastChanged`), `work_order_log_append`/`_remove` (samtidighet, grants) | 17/17 |
| `tests/offer_attachment_upload.test.js` | Statisk jämförelse med v12, RPC:erna (md5 mot fixtur), EF-källan transpilerad med `tsc` och körd i Node | 43/43 |
| `tests/staging_backup_export.test.js` | Backupverktyget: CSV-export, verifiering, återställning, kapad fil avvisas, LIVE-ref avvisas | 12/12 |

**Körsätt:**
- Lokal PostgreSQL 16 med Unix-socket `PGHOST=/var/tmp/vift-localpg`.
- Varje test skapar och tar bort en egen temporär databas (`vift_*_<pid>`).
- Ingen trafik till Supabase.
- `tests/run-all.sh` ska visa PASS (inte SKIP) för alla fyra.

**Versionsnot:** STAGING:s PostgreSQL-huvudversion är inte läst. Migrationen `20261017000001` testades lokalt mot 16 enligt sin kommentar.

### 3.2 Lokal STAGING-replik (ny, byggs i T3-0)

En engångsdatabas i samma lokala server som byggs **bara** från inventeringen och repots migrationer. Inga STAGING-data.

1. **Roller och plattform:**
   - `anon`, `authenticated`, `service_role`;
   - minimalt `auth`-schema: `auth.users`, och `auth.uid()` som läser `request.jwt.claims` via `current_setting`;
   - tabellen `app_users`.
2. **Migrationer** i STAGING-ordning från `migrations-applicerade/` (41 filer, 3 tomma ersatta med SI-källan enligt `INVENTERING.md` §7.1).
3. **Driftläget** läggs på från `schema/functions.sql` (de 13 funktionerna bara där) och `schema/policies.sql` (cutover-policyerna) och `schema/triggers.sql`.
4. **Kontroll:** `md5(pg_get_functiondef(...))` för alla 64 funktioner och en jämförelse av policylistan mot inventeringen. Avvikelse stoppar paketet.
5. **Syntetiska testdata:**
   - personal och roller: standardrollerna + egna roller enligt `SEC-CUST`;
   - AO enligt pooltestdata P1–P5, N1, N2, SI1;
   - kunder med påhittade personnummer;
   - objekt med testportkoder.
6. **Anropare:**
   - som `authenticated` med satt `request.jwt.claims` (REST/RLS-vägen, `SET ROLE authenticated`);
   - som `service_role` (RPC);
   - EF-källor transpilerade och körda i Node mot replikan med stubbad `serve`/`createClient`, samma mönster som `offer_attachment_upload` del 3. På så sätt prövas EF, RPC och RLS **tillsammans** lokalt.
7. **Samtidighet:** parallella `psql`-processer (mönster i `server_rpcs_sql`) och upprepning 20–50 gånger per fall.

### 3.3 Lokala testsviter som byggs i T3/T4

Varje svit täcker matrisens vägar R (REST), E (EF), P (RPC) och S (simulerad server). K, C och X (klient, cache, export) täcks med Playwright mot den simulerade servern.

| Svit | Testfall (matrisen) | Paket |
|---|---|---|
| `replica_build` (md5, policyer, grants, inga EXECUTE för anon/authenticated utom de två RLS-hjälparna) | SEC-REST-03/04 | T3-0 |
| `ao_rules` | SEC-AO-*, SEC-POOL-*, SEC-TID-01..05 | T3-B |
| `roles_superadmin` | SEC-ROLL-*, SEC-B3-05/06, SEC-REST-01/02, SEC-CUST-18/19/22/23 | T3-C |
| `projection_per_post` | SEC-B4-*, SEC-TASK-*, SEC-OFF-01/02, SEC-KUND-01/02, SEC-B3-01..04 | T3-D |
| `standard_roles` | Alla SEC-CUST mot den slutliga rolluppsättningen | T3-E |
| `merge_protected` | SEC-B5-01..05, SEC-KUND-03..06, SEC-INST-*, SEC-B1-09/11/12/17, SEC-B2-06, SEC-AO-18 | T4-A |
| `material_pricing` | SEC-B1-01..08, 13..16, SEC-B2-01..05, SEC-TID-06..09 | T4-B |
| `access_info` | SEC-B5-06..13 | T4-C |
| `rondering` | SEC-ROND-* | T4-D |
| `invoice_notes` | SEC-FAKT-06..08 (+ SEC-FAKT-01..05) | T4-E |
| `export` (Playwright + serverexport) | SEC-EXP-*, SEC-CUST-06 | T4-F |
| `client_cache` (Playwright) | SEC-CACHE-*, SEC-ROLL-10 | T3-A |
| `sim_parity` | SEC-SIM-01 | T3-B, T3-D, T4-B |

---

## 4. Regler som gäller alla paket

1. **Öppen pool ger ingen skrivrätt före tilldelning (AP-B, planjustering).**
   - Material, bilder, checklista, AO-logg, tid och stämpling kräver att anroparen finns i `staff`.
   - `canViewWorkOrder` delas upp i `canViewWorkOrder` (läsning, öppen pool ingår för `ao_pool_take`) och `canWriteWorkOrder` (bara tilldelad eller `ao_view_all`/`ao_edit`).
   - SQL-urvalen i `work_order_checklist_*` och `work_order_log_*` får samma uppdelning.
2. **Samtidighetskritiska kontroller görs under transaktionslås i RPC:n, inte före anropet.** Det gäller:

   | Kontroll | Var |
   |---|---|
   | Tilldelning och källstatus för start och klar, låsta statusar, faktureringsfält | `work_order_patch` (SÄK-5, F21) |
   | "Ta jobbet": öppen pool, `staff` tom, bara anroparen läggs till | `work_order_patch` (ny transitionsparameter, eller ny `work_order_take_from_pool`) |
   | Tilldelning för tid och stämpling | `time_entry_create`, `store_write_stamp_status` |
   | Ägarskap av materialrad | `work_order_material_*` |
   | Eskaleringsregel och invarianten "≥1 aktiv `all`" | gemensamt `pg_advisory_xact_lock` för `vift_staff` + `vift_roles` |
   | Fältvis sammanslagning av skyddade fält | `store_business_key_write`/`_merge_write` |
   | Tilldelning för åtkomstinformation | läsning i samma transaktion som revisionsraden |

   EF-kontroller får finnas kvar som ett snabbt första lager, men räknas inte som skydd.
3. **Negativa tester** är godkända först när:
   - svaret har rätt status, `error` och `reason` enligt felkodskatalogen;
   - kontrollsummorna är oförändrade (matrisen §4–§5.1).

   Ett generiskt fel är underkänt.
4. **Alla vägar prövas:**
   - REST/RLS;
   - Edge Functions;
   - RPC, direkt och via EF;
   - klient;
   - cache;
   - export;
   - simulerad server.

   En regel räknas som införd först när den gäller i varje väg där resursen kan nås.
5. **Ingen breddning.** Ingen ändring får lämna ut mer data än i dag till någon roll (AP-A). Varje paket har en lokal "före/efter"-jämförelse av utlämnade fält per roll.
6. **Övergångsregel för befintliga roller,** tills T3-E är installerat:
   - en roll med `ao_complete` men utan `ao_view_all`/`ao_edit` behandlas som `ao_start_own` + `ao_complete_own` + `ao_pool_take`;
   - en roll med `ao_view_own` + `ao_complete` får öppen pool.

   Det **smalnar av** dagens rätt (bara egna AO och bara öppen pool) och bryter inte fältets arbete. Regeln tas bort när standardrollerna har de nya behörigheterna.

---

## 5. Isolering och kontrollsummor i STAGING (senare omgång)

| Moment | Krav |
|---|---|
| Testposter | Skapas av testkonto, märkta `[E2E-TEST]` + `runId`. "Befintlig post" i ett test = testpost som ADM skapat tidigare i samma körning. |
| Förbjudet | Anrop mot verkliga poster, även negativa. Skrivning av hel nyckel, roll- och personalregistret, `vift_settings`, `appendActivity` och massanrop mot `sensitive_access_audit`. |
| Journal | Före varje mutation. Städning från journalen. Efterkontroll. Spärrfil vid misslyckande (`recovery.js`). |
| KS | Per nyckel: SHA-256 av kanoniskt JSON **utan testelement** + serverhash. AO och tid via listorna. Testraderna i tabellerna. Före och efter varje negativt anrop och efter städning. Verkliga poster ska vara oförändrade (annars kod 4 = NO-GO). |
| Redovisas, återställs inte | `vift_lastChanged`, `store.updated_at`, `op_idempotency`, inloggningar, EF-loggar, revisionsrader (`denied`/`allowed`) för testobjekt |
| Tid | Utanför arbetstid. Meddelas i förväg. |

---

## 6. Paketordning T3 och T4

**Kontroll mot beslutsdokumentet:**

| Krav | Uppfyllt genom |
|---|---|
| F7 (SÄK-10) före standardrollerna | T3-A före T3-E |
| Poolens serverregel (SÄK-3/4, F4) före eller samtidigt med B4/Ö7 | T3-B före T3-D. Den tidigare ordningen, där B4/Ö7 låg före F1/F4/F15, är **struken**. |
| B1 och B5 samordnas | T4-A och T4-B utvecklas, testas och installeras i samma serveromgång |
| M8 finns i både installations- och verifieringsordningen | T4-E |
| SÄK-8 och SÄK-9 är P1 inför LIVE | T3-C och T3-A |

**Ordning:** T3-0 → T3-A → T3-B → T3-C → T3-D → T3-E → T4-A + T4-B (samordnat) → T4-C → T4-D → T4-E → T4-F.

T3-A är bara klient och kan utvecklas parallellt med T3-B, men installeras först.

| Paket | Tidigare M-id | Huvudinnehåll |
|---|---|---|
| T3-0 | – | Grund: migrationer, EF-synk, replik, testverktyg |
| T3-A | M10 (del) | SÄK-10, SÄK-9 |
| T3-B | M4, M5 (del) | SÄK-5, SÄK-3, SÄK-4, F21, F16/F23 (tilldelning), F17, nya AO-behörigheter |
| T3-C | M3 (del) | SÄK-8, D-25, D-21, F18 |
| T3-D | M1, M2 | SÄK-2, B4/Ö7, D-12–D-15, D-22 |
| T3-E | M9 | Standardroller |
| T4-A | M1, M3 (del), M5 | B5 + B1-projektion: SÄK-7 (läckage), D-05/06/13/17, `cost_view` |
| T4-B | M4 (del), M5 | SÄK-6, D-09/10/11/19, `cost_edit`, `time_view_all` |
| T4-C | M6 | `objects_access_assigned`, D-16 (förberedelse), D-23 |
| T4-D | M7 | `rondering_utfor` |
| T4-E | **M8** | D-20 faktura-PDF och kommentarer |
| T4-F | M10 (del) | D-18 export, SÄK-1 |

### T3-0 Grund (repo och lokal miljö)

| | |
|---|---|
| **Innehåll** | (1) Versionerade migrationer i repot för de 13 funktionerna och cutover-policyerna, i den ordning som anges i `INVENTERING.md` §10. Bara rekonstruktion, inget nytt beteende. (2) Synk av de fem nyare EF:erna och send-push från inventeringen till repot. (3) Lokal STAGING-replik (§3.2). (4) Testverktyg: felkod + `reason` + KS per anrop, rapport per väg. Även `authz-mutation.js`/`c5-read.js`/`authz-read.js` uppdateras till de skärpta reglerna, t.ex. att `authz-read.js:62-63` inte längre ska godkänna pool med personal. (5) Den simulerade servern förbereds för paritetstester. |
| **Beroenden** | Inventeringen (klar), D-26 för rolluppsättningen i replikan |
| **Lokala tester** | `replica_build`: md5 för 64/64 funktioner, policylistan lika med inventeringen, grants. De fyra befintliga testerna gröna mot replikan. **Baslinje:** alla `SEC-*` körs mot den **oförändrade** replikan och avvikelserna dokumenteras (förväntat: SÄK-2–10, F16–F23, O1). |
| **STAGING-verifiering** | Ingen skrivning. Endast vid separat GO: läsande jämförelse av funktionsdefinitioner (md5) och policyer mot replikan. |
| **Backup** | Gäller inte STAGING. Repo-ändringarna görs i en gren. |
| **Rollback** | Gren och commit (bara repo) |
| **GO-kriterier** | Replikan identisk med inventeringen. Baslinjerapporten finns. De fyra testerna gröna. Inga hemligheter i nya filer. |

### T3-A Klientskydd: SÄK-10 och SÄK-9

| | |
|---|---|
| **Innehåll** | (1) `Auth._resolveUser`: reservrollen blir ett id som inte finns, så att fail-closed gäller. Rollnamn används inte som säkerhetsbeslut. (2) `Auth._clearSession` och flikbytet rensar **alla** `vift_*`-affärsnycklar (inte utkorg, `settleIntents` och nödvändiga användarnamnrymder). Degraderad inläsning (`state.js:983`) använder bara cache som tillhör samma användare (namnrymd per användare), annars ingen. (3) Versionshöjning `?v=N`. |
| **Beroenden** | Inga. **Måste vara installerat före T3-E.** |
| **Lokala tester** | `client_cache` (Playwright mot den simulerade servern): SEC-CACHE-01..03, SEC-ROLL-10, SEC-CUST-23. Regression: `tests/run-all.sh`. |
| **STAGING-verifiering** | Webbläsartest med testkonton (läsande): SEC-CACHE-01..03 på publicerat STAGING-paket |
| **Backup** | Föregående STAGING-klientpaket sparas |
| **Rollback** | Publicera föregående paket |
| **GO-kriterier** | SEC-CACHE och SEC-ROLL-10 gröna. Ingen förlust av osynkade ändringar (utkorgen orörd). |

### T3-B AO-kärna och arbetspool: SÄK-5, SÄK-3, SÄK-4, F21, F16/F23, AP-B

| | |
|---|---|
| **Innehåll** | (1) **`work_order_patch`** (RPC, under lås) får regelkontroll per anroparprofil (EF skickar `p_caller_staff_id` och behörighetsflaggor): start och klar för egen tilldelad AO, källstatus, låsta statusar (`ao_locked`), `completedAt`/`completedBy` sätts av servern, faktureringsfält avvisas för **alla** (`invoice_path_required`, D-07/F21), idempotenskonflikt (F17). (2) **Ta jobbet** atomiskt i RPC: öppen pool, `staff` tom, bara anroparen läggs till, 409 `already_assigned`. Status enligt AP-G (ingen ny statussemantik nu). (3) **Poolregeln** "egen eller (`pool` och `staff` tom och aktiv)" i `work-orders-list`, `canViewWorkOrder`/`canWriteWorkOrder`, SQL-urvalen i `work_order_checklist_*` och `work_order_log_*` samt den simulerade servern. Poolprojektion enligt K-03. (4) **AP-B:** `time_entry_create` och `store_write_stamp_status` kräver tilldelning under lås. Ingen automatisk tilldelning. (5) Nya behörigheter `ao_start_own`, `ao_complete_own`, `ao_pool_take` med övergångsregeln (§4.6). (6) Klient: knapparna "Ta jobbet", "Starta" och "Klar" följer servern, och besked ges först efter serversvar. Personaldialogen rör bara personal (AP-G). |
| **Beroenden** | T3-0. Beslut D-03, D-07, D-24, AP-A, AP-B, AP-F, AP-G (fastställda). |
| **Lokala tester** | `ao_rules`, `sim_parity`. Samtidighet SEC-AO-14 och SEC-POOL-09 med minst 20 upprepningar. Jämförelse av utlämning före och efter per roll (ingen breddning). De fyra befintliga testerna (checklistan och loggen ändras). |
| **STAGING-verifiering** | Märkta test-AO P1–P5, N1, N2 skapade av ADM. SEC-AO-01/05/06/09/10/11/15/17, SEC-POOL-01/02/05/06/08/10/11/12/13, SEC-TID-01..03. Bara icke-destruktiva anrop. **Inga** samtidighetsmassprov i STAGING. |
| **Backup** | Backupschema för `store`, `op_idempotency` och `function_definitions` (`supabase/manual/staging_backup_och_kontroll_2026-11-24.sql`), extern kopia verifierad med `tools/staging-backup-export.js --provata-lokalt`. EF-backup av `ao-time-write`, `work-orders-list`, `store-key-write`, `work-order-*`. |
| **Rollback** | `CREATE OR REPLACE` med föregående definitioner från `function_definitions` (prövat lokalt: installera, återställ, installera). Föregående EF-versioner. |
| **GO-kriterier** | Alla T3-B-fall gröna lokalt i alla vägar. Paritet med den simulerade servern. Ingen breddning. Rollback prövad. Fältets flöden (starta, klar, ta jobbet) fungerar med övergångsregeln. |

### T3-C Superadmin, roller och direkta vägar: SÄK-8, D-25, D-21, F18

| | |
|---|---|
| **Innehåll** | (1) Eskaleringsregeln och invarianten "≥1 aktiv `all`" i RPC under gemensamt lås för `vift_staff` och `vift_roles` (`store_business_key_write`/`_merge_write` får en nyckelspecifik validering). Gäller även `deactivate_vift_user`/`provision_vift_user`. (2) Bara `all` får hantera `all` (`superadmin_required`). (3) Projektion av `vift_roles` (egen effektiv roll, alla med `admin_manage`) och av `vift_staff.permissions`/`role` (D-21, D-14). (4) RLS: direkt REST-skrivning bara för en uttrycklig vitlista (F18). Klientens egna direkta skrivningar inventeras först så att inget slutar fungera. |
| **Beroenden** | T3-0. T3-B rekommenderas först (samma RPC-familj och lås). |
| **Lokala tester** | `roles_superadmin`, inklusive 50 upprepningar av SEC-ROLL-05/06. **Bara lokalt** (rollregistret är destruktivt). |
| **STAGING-verifiering** | Bara läsande: SEC-B3-03/05 (projektion) och SEC-REST-03. **Inga skrivningar** i roll- eller personalregistret. Invarianten verifieras lokalt. |
| **Backup** | Som T3-B, plus en JSON-kopia av `vift_staff` och `vift_roles` med hash |
| **Rollback** | Föregående funktionsdefinitioner och policyer. Data ändras inte av paketet. |
| **GO-kriterier** | Ingen eskaleringsväg i någon väg (R, E, P). Invarianten håller i alla samtidighetsprov. Den egna superadminrollen med annat id fungerar (SEC-ROLL-08). Klientens skrivvägar opåverkade. |

### T3-D Urval per post: SÄK-2, B4/Ö7, D-12–D-15, D-22

| | |
|---|---|
| **Innehåll** | (1) Projektion per post för `vift_activityLog`, `vift_activities`, `vift_offers` (fältreferens), `vift_customers`/`properties`/`propertyObjects`/`propertyContacts` (urval per uppdrag) och `vift_staff` (D-14). Använder **den rättade poolregeln från T3-B** via samma delade funktion. `vift_store_project` får anroparens personal-id och synliga AO-id (ny signatur), och RLS nekar direkt REST för dessa nycklar för roller utan full åtkomst. (2) `appendActivity`: typer per behörighet och kontroll av referens (D-22). Felorsaker returneras (`not_own`, `type_not_allowed`, `ref_not_visible`). (3) Klienten följer serverns uppgiftsregel (D-15, F8). Uppgifter-sidan och dashboarden. |
| **Beroenden** | **T3-B (poolregeln) måste vara installerat först.** T3-0. |
| **Lokala tester** | `projection_per_post`, `sim_parity`. SEC-B4-05/06 (append-only) bara lokalt. |
| **STAGING-verifiering** | Läsande per roll: SEC-B4-01..03, SEC-TASK-04, SEC-OFF-01, SEC-KUND-01/02, SEC-B3-01..04. Uppgifter: märkta testuppgifter (SEC-TASK-01..03/05/06). **Ingen `appendActivity`** i STAGING. |
| **Backup** | Som T3-B |
| **Rollback** | Föregående `vift_store_project`/`vift_store_full_access`/`store_read_all_with_hashes_projected` och `store-key-write` |
| **GO-kriterier** | SÄK-2 stängd i REST, EF, klient och simulerad server. Fältets AO-historik och dashboard fungerar. Ingen breddning. |

### T3-E Standardroller (M9)

| | |
|---|---|
| **Innehåll** | (1) Rollregistret enligt matrisen §2: `admin`, `chef`, `ekonomi`, `personal`, `begransad` med de nya behörigheterna. Befintliga personalposter migreras inte (D-02). (2) Klientens behörighetslista i roll-editorn (`PageShells.js` ca 11660-11700) med nya behörigheter och beskrivningar. (3) Övergångsregeln (§4.6) tas bort när alla aktiva roller har de nya behörigheterna. |
| **Beroenden** | **T3-A (SÄK-10) installerat.** T3-B, T3-C, T3-D installerade (behörigheterna verkställs). D-26: testkonton skapas i STAGING först efter separat godkännande. |
| **Lokala tester** | `standard_roles`: hela SEC-CUST-01..23 och alla SEC-* per standardroll mot replikan med den slutliga rolluppsättningen. |
| **STAGING-verifiering** | Dataändring i `vift_roles` (journal med före- och eftervärde och hash) **efter separat GO**. Därefter läsande verifiering per testkonto (`c5-read.js`, `authz-read.js` med ny förväntan). |
| **Backup** | JSON-kopia av `vift_roles` och `vift_staff` med hash, plus backupschema |
| **Rollback** | Skriv tillbaka förevärdet av `vift_roles` med hash (`write`, `expectedHash`) |
| **GO-kriterier** | Alla SEC-CUST gröna lokalt. Ingen befintlig användare förlorar nödvändig åtkomst (jämförelse per aktiv personalpost, bara antal och behörigheter). |

### T4-A och T4-B (samordnat B1 + B5): skyddade fält, kostnad, material, priser

**Samordning.** T4-A och T4-B ändrar samma skrivvägar:
- `store_business_key_*`;
- `work_order_patch` och materialvägen;
- `time_entry_create`;
- projektionerna.

De utvecklas i samma gren, testas tillsammans lokalt och installeras i **samma** serveromgång med full regression.

| | **T4-A Skyddade fält och projektion för skrivare** | **T4-B Material, priser och tid** |
|---|---|---|
| **Innehåll** | (1) Fältvis sammanslagning i `store_business_key_write`/`_merge_write` och `work_order_patch` för skyddade fält: portkodsfälten (`objects_sensitive`), `personnr`/`orgNr` (`personal_data_view`), `bankgiro` (`bankgiro_edit`), `buyPrice` i artiklar (`cost_edit`), konfliktsäker sammanslagning av inställningar (D-17, P1 #5). (2) C-5 regel 1 ("skrivare får hela värdet") ersätts av projektion även för skrivare. **Stänger informationsläckaget i SÄK-7.** (3) `cost_view`-projektion av `articles.buyPrice`, `settings.internalHourlyCost`, `materials[].buyPrice`. D-06-projektion av AO-ekonomi i `work-orders-list`. | (1) Radvisa RPC:er `work_order_material_add/update/remove` under lås. Servern sätter id, `addedBy` och pris från artikel. Fritext ger `*Unknown`. Egen rad mot andras (D-19). Hela listan nekas för fält. (2) `cost_edit` kompletterar okänt pris. `_invoice_financial_check` stoppar eller flaggar okänt försäljningspris. Fastpris utan dubbeldebitering (D-10). (3) `time_entry_create` sätter `hourRate` från tillåten prisgrupp (`price_group_not_allowed`). Historik oförändrad. `time-entries-list` projicerar `hourRate` (D-11). `time_view_all` (D-08). (4) Klient: inga belopp för fält i artikelväljare, materialrader, stämpla-ut, Tid och AO-detalj. Ingen `\|\| 0`. `ProfitabilityService` utan påhittat standardvärde (F13). |
| **Beroenden** | T3-B, T3-C (samma RPC:er och lås), T3-E (roller med `cost_*`, `personal_data_view`, `bankgiro_edit`) | T4-A (samma omgång), T3-B (tilldelning i tid och material) |
| **Lokala tester** | `merge_protected` (även samtidighet SEC-B5-04/05, SEC-INST-05), `sim_parity` | `material_pricing`, `sim_parity`. Fakturaunderlag med okänt pris i `invoice-write` lokalt. |
| **STAGING-verifiering** | Märkta testobjekt, testkunder och testartiklar: SEC-B5-01..03, SEC-KUND-03/04, SEC-B1-09/11, SEC-AO-18. **Inga** skrivningar av `vift_settings` (SEC-INST bara lokalt). | Märkta test-AO och testartiklar: SEC-B1-01..05/08, SEC-B1-13, SEC-B2-01/03, SEC-TID-06. Fakturaflaggan med ett märkt testunderlag. |
| **Backup** | Backupschema + extern kopia + EF-backup (`store-key-write`, `work-orders-list`, `ao-time-write`, `time-entries-list`, `invoice-write`) | Samma omgång |
| **Rollback** | Föregående funktionsdefinitioner och EF-versioner. Materialrader skrivna med den nya vägen är kompatibla med den gamla läsningen (samma fält plus `*Unknown`, `addedBy`). | |
| **GO-kriterier** | Inget skyddat fält når en roll utan behörighet i någon väg, även för skrivare. Samtidiga skrivningar tappar inget. Gammal klient i Service Worker-cachen förstör inga skyddade fält. | Okänt ≠ 0 överallt. Fältet ser inga belopp. Fakturaunderlag med okänt pris stoppas. Ingen dubbeldebitering vid fastpris. |

### T4-C Åtkomstinformation till tilldelad personal (SÄK-7, vägen), D-16, D-23

| | |
|---|---|
| **Innehåll** | (1) `get-sensitive-fields` (från STAGING v9 i inventeringen) får en gren för `objects_access_assigned`: bara objekt och fastighet på egen tilldelad **aktiv** AO eller tilldelad rondering. Kontrollen och revisionsraden görs i samma transaktion (RPC). `denied` och `allowed` loggas utan värden. (2) D-16, bara förberedelse: läsande jämförelserapport blob mot `property_sensitive_access` (antal lika, olika, saknas och AO-ögonblicksbilder). **Ingen migrering, ingen borttagning.** (3) D-23: permanent radering tar bort den känsliga raden atomiskt. Arkivering och mjuk radering behåller den. |
| **Beroenden** | T3-B (tilldelningsregeln), T4-A (projektion), T4-D för rondering (eller gren som kan stängas av tills T4-D) |
| **Lokala tester** | `access_info` |
| **STAGING-verifiering** | Märkt testobjekt med testportkod och märkt test-AO: SEC-B5-06/08/09. Högst ett fåtal revisionsrader, redovisade. |
| **Backup** | EF-backup av `get-sensitive-fields`/`set-sensitive-fields`. Backupschema inklusive `property_sensitive_access` (bara struktur och antal i rapporten). |
| **Rollback** | Föregående EF-version |
| **GO-kriterier** | Ingen åtkomst till andras eller inaktiva uppdrags uppgifter. Varje uttag loggas. Inga värden i loggen. |

### T4-D Rondering (`rondering_utfor`)

| | |
|---|---|
| **Innehåll** | `rondering-pass-write` (återställd källa): åtgärder per pass för `rondering_utfor` (`rondering_point_patch`, `rondering_pass_save_note`, `rondering_pass_auto_start`, `rondering_pass_complete`) med tilldelningskontroll under lås i RPC. Skapa pass, mallar och massskapande kräver fortsatt `ao_view_all`. Projektion av `vift_ronderingspass` per post. `PAGE_PERMISSIONS` för utförandesidan. **Ingen ombyggnad av rondering.** |
| **Beroenden** | T3-E (behörigheten i rollerna), T3-D (urvalsfunktionen) |
| **Lokala tester** | `rondering` |
| **STAGING-verifiering** | Märkt testpass: SEC-ROND-01/02/04 |
| **Backup / rollback** | EF-backup. Föregående `rondering_*`-definitioner. |
| **GO-kriterier** | Fältet kan bara utföra egna pass. Arbetsledarens flöden är oförändrade. |

### T4-E Faktura-PDF och kommentarer (M8, D-20)

| | |
|---|---|
| **Innehåll** | (1) Separata fält `internalNote` och `customerNote` i fakturaunderlaget (`invoice-write` `metaUpdate` och tillåtna fält). (2) Kund-PDF (`InvoicesPage.js:2223` och eventuell serverväg) tar **bara** med `customerNote`. Befintligt `note` tas inte med i ny kund-PDF utan uttrycklig klassificering (K-05). (3) Historiska texter och redan utfärdade dokument bevaras. **Ingen dataändring.** |
| **Beroenden** | T3-0 (källan till `invoice-write`). Inget beroende av T4-A/B. Paketet kan tidigareläggas om det behövs. |
| **Lokala tester** | `invoice_notes`: SEC-FAKT-06..08 med PDF-generering i Playwright mot den simulerade servern, och `invoice-write` mot replikan |
| **STAGING-verifiering** | Märkt testunderlag med båda kommentarerna, PDF:en kontrolleras automatiskt och raderas (SEC-FAKT-06/07) |
| **Backup / rollback** | EF-backup av `invoice-write`. Föregående klientpaket. |
| **GO-kriterier** | Ingen intern text i någon kundsynlig PDF. Befintliga underlag oförändrade. |

### T4-F Export (D-18, SÄK-1, F12)

| | |
|---|---|
| **Innehåll** | (1) `export_data` styr både snabbexport (`showExportMenu`) och Exportcenter (samma regelfunktion). (2) Personnummer och org.nr för privatperson blir känsliga fält, av som standard. (3) Ny **serverexport** (EF) för skyddade fält (personnummer med `export_personal_data` + `personal_data_view`, portkod enligt K-04) med serverloggning. Klientkontrollen beskrivs inte som säkerhetsskydd. (4) Lösenord, token och autentiseringsuppgifter exporteras aldrig. |
| **Beroenden** | T3-E (behörigheter), T4-A (projektion och `personal_data_view`) |
| **Lokala tester** | `export`: SEC-EXP-01..08, SEC-CUST-06. Filer kontrolleras automatiskt och raderas. |
| **STAGING-verifiering** | Märkt testkund med påhittat personnummer: SEC-EXP-03..05. Filer raderas direkt. |
| **Backup / rollback** | Föregående klientpaket. Ny EF kan stängas av (410). |
| **GO-kriterier** | Inget personnummer utan aktivt val, behörighet och serverlogg. Samma regel i båda exportvägarna. |

### Utanför T3/T4

Följande hör till AO-etappen:
- `ao_plan_own` (AP-E);
- räknare (AP-C);
- notiser utöver "inga falska tilldelningsnotiser" (AP-D);
- avveckling av status `pool` (AP-G);
- UI/UX-omgången.

LIVE-planen är ett separat beslut (P1 #1).

---

## 7. Verifieringsordning efter installation i STAGING

Gäller en senare omgång, med separat GO per paket.

| Steg | Efter paket | Verifiering (märkta poster, läsande där möjligt) |
|---|---|---|
| V1 | T3-A | SEC-CACHE-01..03, SEC-ROLL-10 (webbläsare) |
| V2 | T3-B | §6 T3-B STAGING-lista, därefter `c5-read.js` + `authz-read.js` (ny förväntan) |
| V3 | T3-C | SEC-B3-03/05, SEC-REST-03 (läsande) |
| V4 | T3-D | SEC-B4-01..03, SEC-TASK-01..06, SEC-OFF-01, SEC-KUND-01/02 |
| V5 | T3-E | Ny förväntan för `c5-read.js` och `authz-read.js` per standardroll. Testkonton enligt D-26 efter GO. |
| V6 | T4-A + T4-B | Listorna i §6. Full regression `e2e-real.js` per roll. Manuell mobilkontroll av fältets materialflöde. |
| V7 | T4-C | SEC-B5-06/08/09 |
| V8 | T4-D | SEC-ROND-01/02/04 |
| **V9** | **T4-E (M8)** | **SEC-FAKT-06/07:** kund-PDF utan intern kommentar, och äldre `note` inte med |
| V10 | T4-F | SEC-EXP-03..05 |
| V11 | Alla | Slutregression: `tests/run-all.sh`, alla lokala sviter mot replikan med installerad kod, `e2e-real.js`, kontrollsummor och städning med kod 0 |

---

## 8. Generella installationssteg (beskrivs, körs inte)

1. **Backup före varje paket:**
   - backupschema i databasen (`store`, `op_idempotency`, `function_definitions`);
   - extern kopia verifierad med `--provata-lokalt`;
   - EF-backup till `supabase/backup/ef-installerade-<datum>/<slug>-v<N>/`;
   - för datapaket (T3-E): JSON med hash för berörd nyckel.
2. **Migrationsfil per ändring** med återställnings-SQL i filhuvudet. Prövas lokalt i replikan: installera → återställ → installera.
3. **Kompatibilitet:** varje serverändring ska fungera med gammal och ny klient (Service Worker-cache). Övergångsregeln enligt §4.6.
4. **Installationsordning inom ett paket:**
   1. migration;
   2. EF;
   3. läsande kontroll (`c5-read.js`, `authz-read.js`);
   4. märkta tester;
   5. klientpaket;
   6. webbläsarverifiering.
5. **Rollback utlöses av:**
   - ett felaktigt tillåtet anrop;
   - ett skyddat fält som når fel roll;
   - kod 3 eller 4 i städningen;
   - en funktionsregression i fältets flöden.

   Åtgärd: föregående definitioner, EF-versioner och klientpaket. Data återställs från JSON eller backupschema bara för datapaket.
6. **Inget från `STAGING-ONLY.md`** följer med till något paket avsett för LIVE: `e2e-test-cleanup`, `vift-admin-storage`, migrationerna `20261117085418`/`20261124211128`, backupscheman, testroller och testkonton.

---

## 9. GO/NO-GO-underlag för T3/T4

### 9.1 Läge 2026-11-27 per paket

| Paket | Lokal utveckling och test | Installation i STAGING | Underlag som finns | Det som saknas |
|---|---|---|---|---|
| T3-0 | **GO** | Inte tillämpligt (läsande jämförelse kräver GO) | Inventering, 104/104 lokala tester, besluten | Rekonstruerade migrationer, replik, testverktyg med felkod och KS |
| T3-A | **GO** | NO-GO i denna omgång | Matrisen R61, SEC-CACHE | Implementation, Playwright-svit |
| T3-B | **GO** efter T3-0 | NO-GO i denna omgång | `work_order_patch`-källan, poolutredningen, besluten D-03/D-07/D-24/AP-* | Replik, implementation, samtidighetsprov |
| T3-C | **GO** efter T3-0 | NO-GO i denna omgång | D-25, D-21, policyöversikt | Lokal invariant med lås, inventering av klientens direkta skrivningar (F18) |
| T3-D | **GO** efter T3-B lokalt | NO-GO i denna omgång | B4, Ö7, D-12–D-15, D-22 | Ny projektionssignatur, rättad poolregel |
| T3-E | **GO** lokalt (replik) | **NO-GO** tills T3-A–D är installerade och testkonton är godkända (D-26) | Matrisen §2 | Bekräftelse av K-01/K-02 |
| T4-A + T4-B | **GO** lokalt efter T3-B/C | NO-GO i denna omgång | D-01, D-05/06, D-09–D-11, D-13, D-17, D-19 | Radvisa RPC:er, sammanslagning, K-03 |
| T4-C | **GO** lokalt | NO-GO | D-05, D-16, D-23, STAGING v9-källan | Synk av repot, tilldelningsgren |
| T4-D | **GO** lokalt | NO-GO | Källan till `rondering-pass-write` | Gren per pass |
| T4-E (M8) | **GO** lokalt | NO-GO | D-20, källan till `invoice-write` | K-05 (klassificering, ingen dataändring krävs för införandet) |
| T4-F | **GO** lokalt efter T4-A | NO-GO | D-18 | Serverexport, K-04 |

### 9.2 GO för att installera ett paket i STAGING (senare omgång)

Alla villkor ska vara uppfyllda:

- [ ] Paketets lokala sviter är gröna i **alla** vägar (R, E, P, S och K/C/X där de gäller). Negativa fall har rätt felkod och orsak och oförändrad KS.
- [ ] Jämförelsen före/efter visar ingen breddning för någon roll.
- [ ] Samtidighetsfallen klarar sina upprepningar (20–50).
- [ ] Den simulerade servern har paritet (SEC-SIM-01) för paketets resurser.
- [ ] De fyra befintliga PostgreSQL-testerna och `tests/run-all.sh` är gröna utan SKIP.
- [ ] Rollback är prövad lokalt. Backup och extern kopia är verifierade.
- [ ] Beroende paket är installerade enligt §6. **Särskilt:**
  - T3-A före T3-E;
  - T3-B före T3-D;
  - T4-A och T4-B tillsammans.
- [ ] Lucas har gett separat GO för paketet. Testkonton finns först efter godkännande (D-26).

### 9.3 NO-GO

Något av följande stoppar paketet:

- ett felaktigt tillåtet anrop eller ett skyddat fält hos fel roll i någon väg;
- ett negativt test som bara ger ett generiskt fel;
- en mutation i ett negativt fall;
- kod 3 eller 4 i städningen;
- en verklig post som ändrats;
- ett obligatoriskt test som hoppats över;
- bristande paritet med den simulerade servern;
- en samtidighetskontroll som görs före RPC-låset i stället för under det;
- standardrollen `personal` utan att SÄK-10 är installerad;
- B4/Ö7 före den rättade poolregeln;
- B1 utan B5 (eller tvärtom) i samma skrivväg;
- något från `STAGING-ONLY.md` i ett paket avsett för LIVE.

### 9.4 LIVE

**NO-GO.** Kräver:
- att alla T3/T4-paket är installerade och verifierade i STAGING;
- att SÄK-8 och SÄK-9 (P1 inför LIVE) är stängda;
- en separat LIVE-plan (P1 #1, `INVENTERING.md` §10) med eget beslut.
