# T3-resultat (säkerhetsomgången T3, 2026-11-28)

Ett avsnitt per paket. Varje paket uppdaterar sitt eget avsnitt; inga nya dokument.
Verifieringsnivån är **lokalt verifierad**: lokal PostgreSQL 16.15, Edge Functions körda i Node.
Ingenting är installerat eller verifierat i STAGING. LIVE är inte kontaktad.

---

## T3-0 – grunden (KÄLLA-1, MIG-1, replik, testverktyg, baslinje, paritet)

### Sammanfattning

| Del | Resultat |
|---|---|
| KÄLLA-1 | VIFT-CRM:s `supabase/` borttagen med `git rm`. Historiken finns kvar. Katalogen ersattes med `supabase/README.md` som hänvisar till rätt repo, gren och servercommit. Före borttagningen jämfördes alla filer med vift-v2: inga unika källor, fixturer eller testberoenden. Testerna läser `VIFT_SERVER_ROOT`, och om källan saknas blir det fel, inte en tyst överhoppning. Kontrollen `serverkalla_guard` underkänner återinförd serverkod. |
| MIG-1 | Alla 41 STAGING-versioner är mappade, verifierade och klassade: `supabase/MIGRATIONSMAPPNING.md`, `migrationsmappning.json`, `tests/local/migrationsmappning.js`. Installationsunderlaget finns i `supabase/INSTALLATIONSUNDERLAG-MIGRATIONER.md`. Ingenting har körts mot Supabase. |
| 28 jämfört med 25 | "28" var fel. Det faktiska antalet nya filer i `supabase/migrations/` i 168554b är **25** (17 + 3 + 5). Förklaringen står i `G1-G4-DEL2-RESULTAT.md` §11 och nedan. |
| Replik | `tests/local/replik.sh` och `lib/replik.js` bygger repliken: kedjan plus stubbar plus syntetiska data. Resultat: 126 identiska objekt, 7 förklarade avvikelser, 0 oförklarade. md5 för funktionerna: 58/64 exakta, 5 med samma kod och andra kommentarer, 1 STAGING-only. STAGING-varianten ger alla 64. |
| Testverktyg | `vift-v2/tests/local/lib/`: `db.js` (REST/RLS som roll, RPC), `ef.js` (EF i Node med Deno-shim och supabase-adapter mot lokal PG, JWT per användare, barriär för samtidighet), `kontroll.js` (KS, `expectReject` med status, error, reason och KS, `expectAccept`, `expectBaslinje`, parallellt/upprepa), `data.js`, `replik.js`, `paritet.js`, `sql.js`, `test.js`. |
| EF-tester | `ef_smoke.test.js` 39/0. Åtta EF körs på riktigt mot repliken: ao-time-write, work-orders-list, store-key-write, time-entries-list, work-order-checklist-resolve, work-order-log-write, invoice-write och offer-respond. |
| Baslinje | `baslinje_sakerhet.test.js` 38/0. **34 brister bevisade** i oförändrad kod (SÄK-2, -3, -4, -5, -8, -11, -12, -13, -15, -16 och GRANTS utan R-E). |
| Paritet | `VIFT-CRM/tests/sim_parity.test.js` 30/0. 29 scenarier: 22 lika och 7 kända avvikelser (SÄK-17), listade i `tests/e2e/paritet-kanda-avvikelser.json`. |
| staging_e2e_real | Åtgärdat. `e2e-test-cleanup` modelleras nu i fake-backend (båda repona). Testet är oförändrat: 25/1 blev 26/0. |
| PG17/Deno | Inte tillgängligt (se Kända begränsningar). PG17 är ett kvarstående releasevillkor. |

### 1. KÄLLA-1 (VIFT-CRM, gren `claude/vift-v3-major-redesign`)

**Inventering före flytten** (fil för fil mot `vift-v2/supabase`):

| VIFT-CRM `supabase/` | Antal | Utfall |
|---|---|---|
| `migrations/` | 21 | 18 identiska med vift-v2 `migrations/`. 3 PROPOSAL identiska med vift-v2 `forslag-ej-applicerade/`. |
| `functions/` | 24 filer | 11 identiska. 13 är äldre versioner som alla finns i vift-v2:s Git-historik (`git log --find-object`): get-/set-sensitive-fields, offer-attachment-url, offer-public-pdf, offer-respond, offer-token-validate, send-offer-email, send-push, store-key-write/index.ts, work-order-checklist-resolve, work-order-image-{delete,upload,url}. |
| `backup/staging-ef-fore-installation/` | 8 | Identiska med vift-v2. Används av `offer_attachment_upload`, som nu läser vift-v2. |
| `manual/` | 3 | Identiska med vift-v2 `supabase/manual/`. |
| `config.toml` | 1 | Äldre version i vift-v2:s historik. vift-v2 har `offer-public-pdf verify_jwt=false`. |
| Klientroten: `supabase-setup.sql`, `push_subscriptions.sql` | 2 | Identiska med vift-v2:s rot. **Borttagna ur klienten.** De är installations-SQL ("Kör i SQL Editor"), och `supabase-setup.sql` skapar breda `authenticated`-policyer. De följde dessutom med i STAGING-paketet (`tools/build-staging-package.sh` utesluter inte rotfiler). |
| `tests/fixtures/staging_offer_rpcs_installed.sql` | 1 | Identisk med vift-v2. **Kvar** som testfixtur, märkt "för lokala tester" och vitlistad i kontrollen. Kontrollen kräver också att den är identisk med serverrepots kopia. |

**Ingenting behövde kopieras till vift-v2**: det fanns ingen unik källa.

**Tester som läste från `supabase/`** pekar nu på `tests/lib/serverkalla.js`
(`VIFT_SERVER_ROOT`, standard `/home/user/vift-v2/supabase`; om källan saknas blir det FAIL och exit 1):
- `checklist_progress_sql`, `server_rpcs_sql`: migrationer;
- `offer_attachment_upload`: v12-backup, EF och migration;
- `edge_policies`: store-key-write;
- `e2e/fake-backend.js`: store-key-write-modulerna.

`static_checks`, `staging_backup_export` och `tools/*` läste inte från `supabase/`.
`tools/build-staging-package.sh` utesluter `supabase/` och påverkas inte.

**Hänvisning:** `supabase/README.md` anger:
- remote `https://github.com/lukeduke312/VIFT-CRM` (= `git -C /home/user/vift-v2 remote -v`);
- gren `claude/vift-system-restructure-8fUme`, katalog `supabase/`;
- servercommit (se Commits nedan).

**Kontroll:** `tests/serverkalla_guard.test.js` (körs av `run-all.sh`). Den underkänner:
- om `supabase/` innehåller något annat än README.md;
- kataloger `supabase/{migrations,functions,staging-only,manual}`;
- en Supabase `config.toml`;
- `.sql`-filer utom den vitlistade fixturen, och `.ts`-EF-källor;
- tester eller verktyg som läser en lokal `supabase/`-kopia;
- skript som kör `db push`, `functions deploy` eller `migration repair`;
- om README saknar remote, gren eller commit, eller om commiten saknas i serverrepot;
- om fixturen avviker från serverrepots kopia.

Kontrollen är provad negativt: en tillfälligt skapad `supabase/migrations/x.sql` och en rot-`.sql` gav 4 FAIL.

**CLAUDE.md** är inte ändrad, enligt instruktion. Följande rader är inaktuella och bör rättas av Lucas eller huvudsessionen:
- rad 190: "Deploys via `supabase functions deploy`". Deploy sker från vift-v2, efter godkännande.
- rad 207: "I detta workspace … finns **bara** `supabase/functions/send-push/`". Klientgrenen har ingen serverkod; alla EF:er finns i vift-v2/supabase/functions.
- rad 222: "Migreringar ligger i `supabase/migrations/` och körs med `supabase db push`". De ligger i vift-v2. Ordningen står i `MIGRATIONSORDNING.txt`, och `db push` mot STAGING är förbjudet utan beslut (MIG-1).
- rad 224–234: migreringstabellen. Den listar bara 20260720000000–08, och 0008 kallas "reserverat/tom", men filen finns och strippar lösenord. Kedjan har 45 filer.
- rad 229 och 236: `supabase/manual/…`. Den ligger i vift-v2/supabase/manual/.
- rad 238: "`supabase/migrations/`-mappen finns inte i detta workspace". Den finns i vift-v2.
- rad 286: "`supabase/functions/send-push/index.ts` | … (enda EF i detta workspace)". Inaktuellt.

### 2. MIG-1 (vift-v2)

**Filer:**
- `supabase/MIGRATIONSMAPPNING.md` (genererad tabell per version och per repo-fil);
- `supabase/migrationsmappning.json` (maskinläsbar);
- `tests/local/migrationsmappning.js` (`--skriv` genererar, utan flagga verifierar);
- `tests/migrationsmappning.test.js`;
- `supabase/INSTALLATIONSUNDERLAG-MIGRATIONER.md`.

**Bevis** (alla lokalt, ingen kontakt med Supabase):
1. **md5 mot filerna:**
   - Applicerad SQL (`migrations-applicerade/`, alltså STAGING:s `md5(array_to_string(statements, E';\n'))`) mot repo-filen.
   - Exakt matchning för **28 av 38** icke-tomma versioner: 9 via Supabase CLI:s satsdelning (som emuleras i `lib/sql.js`), 18 återställda, 1 rå fil.
   - Normaliserat samma kod för 9 (20261124*-installationerna, gjorda med kommentarer bortstrippade).
   - 1 med samma objekt i annan form: 20261124160425, där tre repo-filer motsvarar en kompakt installation.
   - md5-värdet i huvudet på de 18 ÅTERSTÄLLDA filerna är lika med den applicerade SQL:en.
   - 3 versioner är tomma i STAGING (kandidater).
2. **Objektjämförelse mot lokal kedja:**
   - Kedja A kör repo-filerna. Kedja B kör den applicerade STAGING-SQL:en, med kandidaterna för de tomma versionerna och R-A–R-E på sina platser.
   - Båda körs i STAGING-ordning inklusive STAGING-only (48 steg), med en katalogögonblicksbild efter varje steg.
   - Ögonblicksbilden omfattar funktioner (md5 av definition och ACL), policyer, triggers, tabeller, buckets och scheman.
   - Resultat: samma objekt för **41/41** versioner. Delade versioner jämförs som grupp.
   - Slutläget är identiskt (137 objekt), utom 5 funktioner som bara skiljer i kommentarer.
3. **R-A–R-E:** alla objekt som skapas eller ändras finns redan i STAGING-facit. Klass: får inte köras som ny. **Kandidaterna:** objekten finns identiskt i STAGING.
4. **Beroenden:** objekt som skapats tidigare och refereras per version, och STOP-kontroller (A3a, N2, CRM12 och STAGING-snapshoten).

**Klassning av de 41 versionerna:**
- 36 är "installerad – får ALDRIG köras igen".
- 3 är "kandidat" (20261106000002/03, 20261108000001).
- 2 är "staging-only" (20261117085418, 20261124211128).

**Repo-filerna i `migrations/` (45):**
- 37 installerade;
- 3 kandidater;
- 5 rekonstruerade R-A–R-E;
- 0 "ny – ej installerad i STAGING".

Till det kommer 2 STAGING-only-filer och 3 förslag.

**Installationsunderlaget:**
- Nya ändringar läggs som nya filer med version efter **20261124211128**.
- Varje ny fil har STOP-kontroll mot md5 av den driftversion den ersätter.
- Ingen `db push` mot STAGING. 11 filer har ett annat nummer än sin STAGING-version, och 5 rekonstruerade saknar version, så `db push` skulle köra 16 filer igen.
- `supabase migration list` kommer att visa 12 versioner som bara finns remote och 16 filer som bara finns lokalt. Det hanteras **utan repair** tills beslut finns. Alternativ (a), (b) och (c) är beskrivna i underlaget.
- Före och efter installation görs en läsande kontroll av md5 för `schema_migrations` mot `migrationsmappning.json`.

**Rättelse:** MASTERPLAN och MIG-1-frågan sade "13 migrationer har andra versionsnummer".
Faktiskt antal: 11 repo-filer för 10 installerade versioner, plus 210747 som är en del av samma fil.

### 3. 28 jämfört med 25 nya migrationsfiler (commit 168554b)

Räknat med `git diff --name-status c011aa6 168554b`:
- `supabase/migrations/` gick från 24 till 45 filer.
- **25 tillagda**: 17 återställda, 3 kandidater, 5 rekonstruerade.
- **4 utflyttade**: 3 PROPOSAL till `forslag-ej-applicerade/`, och e2e_purge till `staging-only/`.
- 1 ny återställd STAGING-only-migration ligger utanför `migrations/` (20261117085418).
- Totalt 27 nya `.sql` i commiten: de 25, 20261117085418 och `tests/local/supabase-stubbar.sql`.
- Kontroll: 24 − 4 + 25 = 45.

"28" motsvarar ingen filräkning. Troligen är det 25 + de 3 flyttade PROPOSAL-filerna.

Rättat i `G1-G4-DEL2-RESULTAT.md` §1 och §11, i `AUKTORITATIV-KALLA.md` och i MASTERPLAN punkt 242.

Obs: "28 av 38 exakta md5" i MIG-1 är ett annat mått och ska inte blandas ihop med detta.

### 4. Lokal STAGING-replik

**Bygge:** `tests/local/replik.sh [--behall] [--staging-only]` eller `lib/replik.js`.
1. `supabase-stubbar.sql` (anon, authenticated, service_role; auth; storage).
2. Kedjan i `MIGRATIONSORDNING.txt`, 45 steg. Med `--staging-only` även de två STAGING-only-migrationerna på sina platser, 47 steg.
3. Schemajämförelse med `jamfor-schema.js`. 0 oförklarade krävs.
4. Syntetiska data (`lib/data.js`).

Bygget tar cirka 3 sekunder. Databasen tas bort när processen avslutas.

**Syntetiska data (bara påhittade, `@example.test`):**
- **Roller:** admin, chef, ekonomi, personal, begransad, plus egna roller: personalansvarig (bara `staff_manage`), adminhanterare (bara `admin_manage`), chef_utan_faktura, saljare (utan personuppgifter) och tom.
- **Personal och auth:** 14 personalposter kopplade till auth.users och app_users. Bland dem finns en okänd roll, en inaktiv personalpost och en avstängd app_users-rad. Dessutom en auth-användare utan provisionering och en utan personalpost.
- **Kunder:** privatperson med påhittat personnummer, ett företag och en BRF.
- **Fastigheter och objekt:** portkoder både i bloben och i `property_sensitive_access`.
- **AO:** P1–P6, N1, N2 och SI1 enligt BEHORIGHETSMATRIS §5.3, plus A1–A9 i alla statusar: planerad, pågående, klar, fakturerad (två), avbruten, arkiverad, borttagen och annans.
- **Övrigt:** tidposter (en attesterad), uppgifter med tilldelning, aktivitetslogg, fakturaunderlag (skickat och utkast), offerter (med token och låst snapshot, och utkast) samt inställningar med bankgiro och internt timpris.

**`replica_build.test.js` 26/0:**
- 45 steg och 0 oförklarade.
- md5: 58/64 exakta, 5 med samma kod, 1 STAGING-only (64/64 i STAGING-varianten).
- Policylistan är lika med inventeringen (51). 21 RESTRICTIVE på store, varav 14 från R-D.
- 3 triggers.
- Inga SECURITY DEFINER-funktioner är körbara för anon. authenticated kan bara köra de två RLS-hjälparna `vift_caller_perms` och `vift_store_full_access` (SEC-REST-03/04).
- R-E-grants: anon/authenticated saknar EXECUTE på provision/deactivate/check.
- RLS är påslaget på alla tabeller.
- Datakontroller.
- Inga STAGING-/LIVE-adresser eller nycklar i verktygen.

### 5. Testverktyg (`vift-v2/tests/local/lib/`)

**(a) EF i Node (`ef.js`):**
- **Transpilering:** EF-källan och `_shared` transpileras med lokal `tsc` till ES-moduler, så att top-level await fungerar (offer-respond).
- **Deno-shim:** `Deno.env.get` och `Deno.serve`/std `serve`.
- **supabase-js-adapter mot lokal PG som service_role:** `from().select/eq/neq/in/is/filter/order/limit/maybeSingle/single/insert/update/upsert/delete` (+ `.select()` efter skrivning), `rpc()` med argument typade efter funktionssignaturen (som PostgREST), `auth.getUser(jwt)` mot auth.users och `storage` i minnet.
- **JWT-simulering:** `jwtFor(user)` ger en token som bara adaptern godtar. Utgångna tokens och fel signatur avvisas.
- **Samtidighet:** `ef.barriar(fn, n)` låter n RPC-anrop vänta in varandra (deterministisk samtidighet). Varje RPC körs på en egen anslutning.
- Mönstret kommer från `offer_attachment_upload.test.js` del 3, men här körs den **riktiga** `checkViftAuth`.

**(b) REST/RLS (`db.asUser`):**
- `SET LOCAL ROLE authenticated|anon` plus `request.jwt.claims`.
- SELECT ger rader. Skrivning ger antal rader via psql:s `ROW_COUNT` (som `Prefer: return=minimal`).
- 42501 ger 403/401.

**(c) RPC (`db.rpc`/`rpcAsync`):** typade namngivna argument, som service_role, authenticated eller anon.

**(d) `kontroll.expectReject(db, anrop, {status, error, reason}, {keys, tables})`:**
- Godkänt bara om status, error och reason stämmer exakt. `reason: null` kräver att reason saknas.
- KS (md5 av `store.value` och `updated_at` per nyckel, alltid inklusive `vift_lastChanged`, samt antal och md5 för hela tabeller) måste vara oförändrad.
- 5xx och `write_failed` godkänns aldrig som avslag.
- `expectAccept` kräver att bara de angivna resurserna ändrats. `expectBaslinje` gäller baslinjefynd.

**(e) Samtidighet:** `parallellt(n, fn)` (egna anslutningar och processer), `upprepa(n, fn)`, `psqlAsync` och `asUserAsync`.

### 6. Körbara EF-tester (`ef_smoke.test.js`, 39/0)

Positiva flöden mot repliken (riktig vift-auth, RPC:er, RLS och triggers):
- **work-orders-list:** admin, ekonomi med redigerad accessCode, fält, tom roll, avstängd 403.
- **time-entries-list:** ekonomi ser alla, fält bara egna.
- **ao-time-write:**
  - create_ao, inklusive idempotent repris;
  - patch_ao för chef och fält (start, klar);
  - create_time, patch_time, attest_time;
  - delete_ao.
- **store-key-write:** readAllWithHashes med C-5-projektion, readWithHash, writeMerge, appendActivity, get/setStampStatus.
- **checklist-resolve:** done och add.
- **log-write:** append och remove.
- **invoice-write:** lineAdd, metaUpdate, stale_write och draftDelete.
- **offer-respond:**
  - approve med händelse och in-app-notis;
  - repris med samma requestId (replay, inga nya händelser);
  - change_request.
- Inga direkta skrivningar mot skyddade nycklar utanför RPC.

### 7. Baslinjefynd (oförändrad kod, `baslinje_sakerhet.test.js`, 38/0, 34 brister bevisade)

Varje rad visar bristen: anropet godtas och muterar, eller data lämnas ut. I T3-B–D ska raden
**vändas** till ett godkänt säkerhetstest med `expectReject` (status, error, reason och KS),
inte tas bort.

| SÄK | Bevisad brist (lokalt) | Ska bli (matrisen) | Paket |
|---|---|---|---|
| SÄK-3 | work-orders-list lämnar ut P2/P3 (pool med annans personal) till fält | SEC-POOL-02: syns inte | T3-B |
| SÄK-16 | work-orders-list lämnar ut arkiverad P5 och borttagen P6 i poolen | SEC-POOL-02 | T3-B |
| SÄK-3 | Poolposten P1 lämnas ut med telefon, e-post, logg, material med inköpspris och fastpris | SEC-POOL-04, poolprojektion (K-03/D-13) | T3-B/T4-A |
| SÄK-3 | Begränsad roll (bara `ao_view_own`) ser öppen pool | SEC-POOL-03 (`ao_pool_take`) | T3-B |
| SÄK-3 | Checklista: fältet klarmarkerar en punkt på P2 (annans pool-AO), vilket muterar | SEC-POOL-12: 403 `not_assigned` | T3-B |
| SÄK-3 | Logg: fältet skriver loggpost på P1 före tagning | SEC-POOL-11 | T3-B |
| SÄK-4 | "Ta jobbet" på P2 (har personal) ger 200 och FÄ läggs till | SEC-POOL-06: 409 `already_assigned` | T3-B |
| SÄK-4 | Samtidig tagning av P1 (FÄ + FÄ2): **båda får 200**, men slutläget har en person (förlorad uppdatering) | SEC-POOL-09: exakt en 200, under radlås | T3-B |
| SÄK-4 | `work_order_patch` (RPC) saknar regelkontroll: tar en icke-pool-AO | Regel under lås i RPC | T3-B |
| SÄK-5 | Fält med `ao_complete` klarmarkerar **fakturerad** AO som hen inte är tilldelad (AO-A4) | SEC-AO-05/06 | T3-B |
| SÄK-5 | Fält klarmarkerar annans AO-A8 med eget completedBy/completedAt (`2000-01-01`) | SEC-AO-05/08 (`ignoredFields`) | T3-B |
| SÄK-5 | Fält klarmarkerar avbruten AO-A5 | SEC-AO-07: 409 `ao_locked` | T3-B |
| SÄK-15 | Arbetsledare (`ao_edit`) sätter `fakturerad` och `invoiceId` via patch_ao | SEC-AO-15: 403 `invoice_path_required` | T3-B |
| SÄK-12 | `work_order_patch`: samma idempotensnyckel med annan patch godtas tyst (RPC och EF) | SEC-AO-20: 409 `idempotency_key_conflict` | T3-B |
| SÄK-11 | `create_time` på ej tilldelad AO-A8 godtas och länkas in i målets `timeEntries` | 403 `not_assigned` | T3-B |
| SÄK-11 | `create_time` sparar klientens `hourRate` (9999) | Serverpris (D-11) | T4-B |
| SÄK-11 | `create_time` på fakturerad AO-A4 godtas | 409 `ao_locked` | T3-B |
| SÄK-11 | `setStampStatus` på ej tilldelad AO, och på ett aoId som inte finns, godtas | AP-B: 403 `not_assigned` | T3-B |
| SÄK-13 | REST: begränsad användare skapar och raderar en okänd nyckel och skriver `vift_lastChanged` | SEC-REST-01/02: 42501 | T3-C |
| SÄK-2 | readAllWithHashes: fält får andras uppgifter (TASK-R2, TASK-R3) och hela aktivitetsloggen | D-15/D-14, SEC-TASK/SEC-B4 | T3-D |
| SÄK-2 | REST: fält läser `vift_activities` direkt, med alla poster | Urval per post | T3-D |
| SÄK-8 | Egen roll med bara `staff_manage` ger sig själv `admin` (writeMerge vift_staff) och får sedan alla AO | SEC-ROLL-01: 403 `privilege_escalation` | T3-C |
| SÄK-8 | Den enda superadministratören tar bort sin egen `all`, vilket ger 0 aktiva superadmin | D-25: 409 `last_superadmin` | T3-C |
| GRANTS | Utan R-E: anon och authenticated får EXECUTE på `provision_vift_user`, `deactivate_vift_user` och `check_app_users_health`. Schemajämförelsen visar oförklarade avvikelser. | R-E installeras | T3-paketet (R-E finns i repot) |
| GRANTS | Utan R-E: **anonym** återaktiverar en avstängd användare som admin via `provision_vift_user`, och användaren kommer sedan åt AO-listan | – | Som ovan |

Kontroller i samma svit som redan är skyddade:
- Med R-E saknar anon EXECUTE.
- REST-uppdatering av affärsnyckeln `vift_customers` ger 0 rader (RESTRICTIVE).

**Observation (ingen SÄK):** `vift_staff` lämnas ut oprojicerad till fältet via readAllWithHashes, med
telefon och `hourlyRate`. Det bör bedömas i T3-D/T4-A (D-22).

**Inte prövat i baslinjen** (hör till senare paket eller kräver ny funktion): SÄK-1, -6, -7, -9, -10, -14.

### 8. Paritet faktisk server jämfört med simulerad server (SEC-SIM-01, SÄK-17)

**Ramverk:** `vift-v2/tests/local/lib/paritet.js` (29 scenarier ur SEC-AO, SEC-POOL, SEC-TID,
SEC-TASK, SEC-ROLL, SEC-CUST och SEC-FAKT).
- Varje scenario körs från ett nytt utgångsläge mot repliken (faktisk serverkod) och mot
  `VIFT-CRM/tests/e2e/fake-backend.js`. Fake-backend körs i samma världsinställning som
  `staging_e2e_real`.
- Jämförs: status, error, reason och ett utfall (lista eller AO-status efteråt).
- Testet `VIFT-CRM/tests/sim_parity.test.js` underkänner nya avvikelser, och kända avvikelser som
  ändrats eller försvunnit.

**Kända avvikelser** (`tests/e2e/paritet-kanda-avvikelser.json`, 7 st.):

| Id | Avvikelse |
|---|---|
| AO-04 | Fake lämnar ut `accessCode` till ekonomi. Servern tar bort det (C-5). |
| AO-05 | SÄK-5 syns inte i fake: fake nekar klar på ej tilldelad AO med 403 (fake är strängare än servern). |
| AO-13 | **SÄK-17:** fake `patch_ao` saknar fältbegränsningen: `{status:'pågående', title}` sparas. |
| AO-19 | **SÄK-17:** fake `patch_ao` saknar fältbegränsningen: fältet sätter `fixedPrice`. |
| CHK-LEGACY | **SÄK-17:** fake i `checklistLegacy` auto-startar AO:n. Servern gör det inte, inte heller med det äldre kontraktet. Standardläget i fake startar inte (SÄK-17-texten om `fake-backend.js:611` gäller alltså bara legacy-läget). |
| KEY-01 | readWithHash på `vift_workOrders`: servern svarar 400 `key_not_allowlisted`, fake 403 `forbidden`. |
| AUTH-02 | Inaktiv personal: servern svarar 403 `Forbidden`, fake 403 `forbidden`. |

**Lika i båda** (dvs. fake har samma brist som servern): poolläckan (AO-01/02, SÄK-3/16), tagning
av P2 (SÄK-4), ao_edit sätter fakturerad (SÄK-15), idempotensnyckel (SÄK-12), tid och stämpling
utan tilldelning (SÄK-11), uppgifter (SÄK-2) och eskalering (SÄK-8). När T3-B–D rättar servern
ska fake följa med, och listan uppdateras.

Fake-backend har inte ändrats utöver `e2e-test-cleanup` (punkt 9).

### 9. `staging_e2e_real` (vift-v2 run-all)

- **Orsak:** städsteget anropar `/functions/v1/e2e-test-cleanup`, som fake-backend inte modellerade (501). Därför AVVIK och kod 1.
- **Åtgärd:** fake-backend modellerar nu `e2e-test-cleanup` efter `staging-only/functions/e2e-test-cleanup` och RPC:n `e2e_purge_offer_artifacts`:
  - `all` krävs;
  - 400 `invalid_id`;
  - 403 `not_test_offer`/`not_test_ao` utan ändring för poster utan `[E2E-TEST]`;
  - bara den egna mappen rörs.
- Testet är oförändrat. Resultat: vift-v2 **26/0** (före: 25/1).
- Samma modell finns i VIFT-CRM:s fake-backend, eftersom e2e-real.js är densamma.

### 10. PG17 och Deno (sista försöket, utan ändrade nätverksinställningar)

- **Lokalt finns:** bara `/usr/lib/postgresql/16`. Ingen `deno`-binär någonstans. Inga PG- eller Deno-artefakter i uv- eller pip-cachen.
- **Nät:** proxyn nekar `deno.land`, `apt.postgresql.org` och `ftp.postgresql.org` (403 connect_rejected), och github-releaser (403). PyPI (`postgresql-wheel`, `pgserver`) och npm-registret går inte att nå (namnuppslag). Inga nätverksinställningar har ändrats.
- **Följd:** utveckling och verifiering sker på PostgreSQL 16.15, och EF körs i Node via tsc och shim.
- Kvarstående releasevillkor:
  - kör `migrationskedja.sh bada`, `migrationsmappning.js`, `replica_build`, SQL-testerna och EF-sviterna på PG17;
  - kör EF i riktig Deno (eller i STAGING efter GO) före LIVE.
- Kända skillnader mellan PG16 och PG17 (MAINTAIN-ACL, oförändrad `pg_get_functiondef`) finns i `G1-G4-DEL2-RESULTAT.md` §8.
- **Skillnad mellan Node och Deno:** bundlens importupplösning och supabase-js själv provas inte. Adaptern emulerar PostgREST-semantiken, till exempel typade RPC-argument, RLS-bypass för service_role och `maybeSingle`.

### 11. Tester (lokalt, PGHOST=/var/tmp/vift-localpg, PostgreSQL 16.15)

**vift-v2 `tests/run-all.sh` (SKIP_BROWSER=1):** **24/24 testfiler gröna, 599 godkända kontroller, 0 fel.** Webbläsartesterna hoppades över (SKIP_BROWSER=1, som i T0–T2) och räknas inte som godkända.

Nya i vift-v2:
- `replica_build` 26/0
- `ef_smoke` 39/0
- `baslinje_sakerhet` 38/0 (34 BASLINJE)
- `migrationsmappning` 18/0

Befintliga oförändrat gröna, bland annat:
- de fyra PostgreSQL-testerna: checklist_progress_sql 32/0, server_rpcs_sql 17/0, offer_attachment_upload 43/0, staging_backup_export 12/0;
- migrationskedja 2/0;
- rekonstruerade_rpc_sql 40/0;
- staging_e2e_real 26/0 (åtgärdat).

**VIFT-CRM `tests/run-all.sh` efter KÄLLA-1:** **21/21 testfiler gröna** (20 Node-testfiler med 470 godkända kontroller och 0 fel, plus `browser/offer_total_parity.js` med 120 offerter och 0 avvikelser). Inga överhoppade. `staging_e2e_real` ger 26/0 även här, eftersom e2e-test-cleanup nu modelleras.

Nya i VIFT-CRM:
- `serverkalla_guard` 11/0
- `sim_parity` 30/0

De fyra PostgreSQL-testerna läser nu vift-v2: checklist_progress_sql 32/0, server_rpcs_sql 17/0, offer_attachment_upload 43/0 och staging_backup_export 12/0.

**Inga tester har ändrats för att bli gröna.** De fem testerna som pekades om har bara fått en ny
sökväg, och deras kontroller är oförändrade. Överhoppade tester räknas inte som godkända.

### 12. SÄK, D och öppna frågor efter T3-0

- **Inga SÄK är åtgärdade i T3-0.** T3-0 bygger grunden och bevisar bristerna.
- **SÄK-2, -3, -4, -5, -8, -11, -12, -13, -15, -16:** "Baslinje bevisad lokalt (T3-0)". De rättas i T3-B, T3-C och T3-D enligt tabellen i punkt 7.
- **SÄK-17:**
  - Paritet förberedd (ramverk, 29 scenarier, 7 kända avvikelser).
  - `e2e-test-cleanup` är modellerad.
  - Fältbegränsningen och legacy-autostarten i fake återstår (T3-B).
- **KÄLLA-1 och MIG-1:** beslutade och lokalt genomförda.
- **Ej gjort i T3-0:** uppdatering av STAGING-verktygen `authz-mutation.js`, `c5-read.js` och `authz-read.js` till de skärpta reglerna (testplanen T3-0, punkt 4). Skäl: reglerna finns inte i servern förrän T3-B. Verktygen läser eller skriver mot STAGING, och den oförändrade servern skulle då ge avvikelser. Görs tillsammans med T3-B, och `kontroll.matchSvar` kan återanvändas för felkod, reason och KS.

### 13. Installationsplan och rollback (T3-0)

T3-0 installerar **ingenting** i STAGING eller LIVE.

| Del | Innehåll |
|---|---|
| Serverkod | Inga ändrade migrationer eller EF:er. Endast tester, verktyg och dokument. |
| Databas | Ingen ändring. Underlag för kommande installationer: `INSTALLATIONSUNDERLAG-MIGRATIONER.md`. Nya filer med version > 20261124211128, ingen `db push` och ingen repair utan beslut, och en läsande kontroll av md5 för `schema_migrations` före och efter. |
| Klient | Ingen ändrad klientfil (inga `?v=`-bumpar behövs). Borttagna rot-SQL-filer kom tidigare med i STAGING-paketet. De ska tas bort ur nästa paket, men de körs aldrig av klienten. |
| Storage | Ingen ändring. |
| Rollback | Bara repo: `git revert` av T3-0-commitarna i respektive repo. Ingen data berörs. |
| v3.4-klient mot ny server | Inte tillämpligt (ingen serverändring). |

### 14. GO-kriterier T3-0 (testplanen §6, T3-0)

| Kriterium | Uppfyllt | Belägg |
|---|---|---|
| Replikan identisk med inventeringen | **Ja** (lokalt) | 0 oförklarade, 126 identiska, 7 förklarade. md5 58/64 exakta + 5 med samma kod + 1 STAGING-only (64/64 i STAGING-varianten). Policyer 51/51, triggers 3/3, grants enligt SEC-REST-03/04. |
| Baslinjerapporten finns | **Ja** | Punkt 7 här. `baslinje_sakerhet.test.js` 34 brister. Maskinläsbar via `BASLINJE_RAPPORT=<fil>`. |
| De fyra testerna gröna | **Ja** | I båda repona, med VIFT-CRM mot den auktoritativa källan. |
| Inga hemligheter i nya filer | **Ja** | Bara syntetiska data (`@example.test`, påhittade personnummer, portkoder och token). Skanning efter JWT, nycklar och LIVE-adresser: inga träffar. `replica_build` kontrollerar verktygen. |
| (Innehåll) R-A–R-E och EF-synk | Ja (T0–T2) | MIG-1 bekräftar att objekten finns i STAGING |
| (Innehåll) testverktyg med felkod, reason och KS | Ja | `kontroll.js` |
| (Innehåll) STAGING-verktygen skärpta | **Nej** | Flyttat till T3-B (punkt 12) |
| (Innehåll) simulerad server förberedd för paritet | Ja | Punkt 8 |
| PG17 / Deno | **Nej** (miljö) | Releasevillkor (punkt 10) |

### 15. Kända begränsningar

- Lokalt är inte Supabase. PostgREST, GoTrue och Storage är emulerade. Se stubbarna och
  `G1-G4-DEL2-RESULTAT.md` §8. Rollbytet per JWT simuleras med `SET LOCAL ROLE` och claims.
- **EF körs i Node, inte i Deno.** Adaptern stöder de supabase-js-anrop som EF:erna använder i
  dag. Nya anropsformer (t.ex. `.range()`, `count`) måste läggas till.
- **Samtidighet mot två olika replikor i samma process stöds inte** av EF-harnessen. Samtidighet
  mot samma replik stöds (egna anslutningar och barriär).
- `kontroll.js` använder md5 av `store.value::text`. Matrisen §5.1 anger SHA-256 av kanoniskt
  JSON för STAGING-körningar. Lokalt är md5 likvärdigt för att upptäcka ändringar.
- **Baslinjetesterna är avsiktligt "gröna när bristen syns".** De måste vändas när rättningarna
  görs. Annars blir de röda, vilket är avsiktligt.
- Kandidaterna för de tre tomma versionerna är fortfarande inte bevisat historisk SQL. Rekonstruerad SQL är inte historisk.
- **Andra pågående agenters VIFT-CRM-worktrees** (`.claude/worktrees/*`) har fortfarande
  `supabase/`. Vid sammanslagning gäller KÄLLA-1: deras tester ska använda `tests/lib/serverkalla.js`.

### Ändrade filer

**vift-v2** (gren `claude/vift-system-restructure-8fUme`):
- nya: `supabase/MIGRATIONSMAPPNING.md`, `supabase/migrationsmappning.json`,
  `supabase/INSTALLATIONSUNDERLAG-MIGRATIONER.md`;
- nya: `tests/local/lib/{db,ef,kontroll,data,replik,paritet,sql,test}.js`,
  `tests/local/migrationsmappning.js`, `tests/local/replik.sh`;
- nya tester: `tests/{replica_build,ef_smoke,baslinje_sakerhet,migrationsmappning}.test.js`;
- ändrade: `tests/e2e/fake-backend.js` (e2e-test-cleanup), `supabase/AUKTORITATIV-KALLA.md`
  (beslut A genomfört), `supabase/inventering/G1-G4-DEL2-RESULTAT.md` (§1-rättelse, §9-not, §11).

**VIFT-CRM** (gren `claude/vift-v3-major-redesign`):
- borttagna: `supabase/{backup,config.toml,functions,manual,migrations}` och rotfilerna
  `supabase-setup.sql` och `push_subscriptions.sql` (59 filer);
- nya: `supabase/README.md`, `tests/lib/serverkalla.js`, `tests/serverkalla_guard.test.js`,
  `tests/sim_parity.test.js`, `tests/e2e/paritet-kanda-avvikelser.json`, detta dokument;
- ändrade:
  - `tests/{checklist_progress_sql,server_rpcs_sql,offer_attachment_upload,edge_policies}.test.js` (sökväg);
  - `tests/e2e/fake-backend.js` (sökväg + e2e-test-cleanup);
  - `docs/MASTERPLAN.md`.

### Commits

**vift-v2** (`claude/vift-system-restructure-8fUme`, inte pushad):
- `fd576b5` T3-0: lokal STAGING-replik, testverktyg, körbara EF-tester, baslinje och paritetsramverk
- `fb71f26` MIG-1: verifierad migrationsmappning STAGING ↔ repo, installationsunderlag; KÄLLA-1 och 28/25 rättat

**VIFT-CRM** (`claude/vift-v3-major-redesign`, inte pushad):
- `1d806f9` KÄLLA-1: serverkopian i klientgrenen borttagen; tester läser den auktoritativa källan vift-v2/supabase
- `f5f4326` T3-0: paritetstest faktisk server (lokal replik) mot fake-backend, kända avvikelser (SÄK-17)
- dokumentcommit (T3-RESULTAT, MASTERPLAN, BEHORIGHETSMATRIS): se `git log` efter `f5f4326`

---

## T3-A – klientskydd (SÄK-10/F7 och SÄK-9/F6)

Skrivet i T3-A:s worktree, gren `worktree-agent-abae39c66de5b869d` med bas `113a656` (`claude/vift-v3-major-redesign`). Sammanfogat i huvudgrenen efter T3-B.

**Verifieringsnivå: lokalt verifierad** mot den simulerade servern (`tests/e2e/fake-backend.js`) och i vm-sandlådor. Inget är verifierat i STAGING. Ingen serverkod, ingen `supabase/`-katalog och inget i `vift-v2` har ändrats. T3-A är bara klient.

### 1. Vad som gjorts

#### SÄK-10 / F7: ingen reservroll (`AuthService.js`, tidigare rad 379)

- `Auth._resolveUser()` ger inte längre `role:'personal'` till en omatchad inloggning. Åtkomsten blir fail-closed:

  | Fall | `Auth.accessState()` |
  |---|---|
  | Servern nekar inläsningen (403, t.ex. ingen aktiv personalpost) | `no_staff` |
  | Ingen aktiv personalpost med inloggningens e-post | `no_staff` |
  | Personalpostens roll-id finns inte i `state.roles`, eller rollen saknar `permissions`-lista | `no_role` |
  | Personal och roller kommer bara från `SeedData`, alltså inte från servern eller användarens egen cache (nätfel utan egen cache) | `unverified` |

  I alla dessa fall gäller samma sak: `state.currentUser` är `null`, `Auth.can()`, `canAny()` och `canViewPage()` är `false`, och all data töms ur minnet, DOM och lokal cache. Sidan **"Ditt konto saknar behörighet i VIFT – kontakta administratören."** visas med knappen Logga ut. För `unverified` står i stället att behörigheten inte kunde kontrolleras, och knappen Försök igen finns. Meny, sidor och data visas inte.
- Åtkomsten avgörs i `initState()` direkt efter att personal och roller lästs in. Det sker innan baslinjer sätts, osparade ändringar spelas upp, stämpling hämtas, migreringar körs och utkorgen återupptas. En användare utan åtkomst utlöser därför inga skrivningar.
- Inga beslut fattas på rollnamn. Behörigheter hämtas bara ur rollregistret, med samma matchningsregel som servern (`_shared/vift-auth.ts`). Reserven via `user.permissions` är borttagen. Superadmin `'all'` fungerar som tidigare.
- `canViewPage()` är fail-closed: en sida som saknas i `PAGE_PERMISSIONS` nekas. Alla 37 sid-id i `index.html` och `Router.js` finns i tabellen. `Router.showPage()` renderar ingenting utan inloggning med fungerande roll.
- Kvarvarande läsare av rollnamn är bara förval i gränssnittet: dashboardlayout (`Dashboard.js:56/558/664`, `DashboardConfig`), rollvisning i `Sidebar` och förvald roll i personaldialogen. Det är tillåtet enligt matrisens §0.2. Ingen av dem påverkar behörighet.

#### SÄK-9 / F6: utloggning, kontobyte, cache och flikar

**Cache.** All användarspecifik lokal cache rensas vid utloggning, när sessionen upphör, vid start utan session, när åtkomst saknas eller dras in, och vid inloggning när cachen tillhör någon annan. Det gäller `localStorage` `vift_*` (alla register, `lastChanged`, AO/tid, sökhistorik, stämplingscache) och hela `sessionStorage`. Följande behålls uttryckligen (`Storage._KEEP_RE`); allt annat med prefixet `vift_` rensas, även framtida nycklar:

| Behålls | Varför |
|---|---|
| `vift_auth_v2` | Sessionen. Tas bort separat. |
| `vift_outbox*`, `vift_settleIntents*`, `vift_persistJournal*`, `vift_activityOutbox*` | Osynkat arbete. Ägarnycklat, rensas aldrig tyst. |
| `vift_pendingStampClear_*` | En serverrensning som är skyldig ägaren. |
| `vift_logo_light`, `vift_logo_dark` | Företagets logotyp. Ingen användardata. |
| `vift_prefs_<id>`, `vift_push_onboarding_dismissed_<id>` | UI-val per användar-id. Ingen verksamhetsdata. |

Nycklar utan prefixet `vift_` (`dashLayout*`, `view-ao`, `vift-logops-supported`) är UI-val eller serverns förmåga och innehåller inga register. Undantaget är `offerDraft_v1_new_<id>`, ett osparat offertutkast per användar-id, som behålls som osynkat arbete. Se §6.

**Cachens ägare.** `vift_cacheOwner` är `<Supabase-projektets ref>|<e-post>`. Ref:en härleds ur deploymentens egen `SUPABASE_URL` och skrivs aldrig in i koden. Degraderad inläsning (`Storage._localAll()`, `state.js` cirka rad 983), `Storage.get`-reserven och alla cacheskrivningar (`Storage._writeCache`, även i `InvoiceService`, `RonderingSyncService`, läs-tjänsterna, `DataSync` och `persist`) gäller bara cachens ägare. Offline-läget visar därför aldrig en annan användares data.

**Minne och DOM.** `Auth._endClientSession()` och `_vfResetClientState()` tömmer alla register, baslinjer, konfliktutkast, index, stämplingsläge, synk, pågående läsningar, utkorgen i minnet, markeringar, dialoger, renderade sidor, meny och sökresultat. Läget sätts också till degraderat, så att `persist()` aldrig kan skicka det tömda läget.

**Identitetskontroll före sändning.** `Auth.assertSessionCurrent()` jämför fliken med den delade sessionen och körs:
- i `Storage._authFetch` före varje anrop och före en omsändning efter 401;
- i `persist()`, som också spärrar om identiteten bytts sedan ändringen gjordes;
- i utkorgens `enqueue` och `_sendOne`;
- i `Auth.getAccessToken()`. Det täcker tjänster som anropar `fetch` direkt (bilder, rondering, fakturor, push).

En flik vars delade session bytts eller loggats ut skickar alltså ingenting, även om storage-händelsen inte hunnit fram. En flik utan session kan inte längre via `_signalAuthFailure` ta bort en annan fliks nya session. `_clearSession` tar bara bort den delade nyckeln om den fortfarande är fliken egen.

**Utkorgar och journaler.** Allt osynkat isoleras per användare och miljö:

| Kö | Ny nyckel |
|---|---|
| AO/tid-utkorgen | `vift_outbox::<ref>::<e-post>` |
| Intents | `vift_settleIntents::<ref>::<e-post>` |
| Persist-journalen | `vift_persistJournal::<ref>::<e-post>` |
| Aktivitetskön | `vift_activityOutbox::<ref>::<e-post>` |

Utkorgsposter bär `owner`, `ownerUid` och `env`. Bara ägarens aktuella session får skicka (`Auth.ownsEntry` plus ägarkontroll i `_authFetch`). En post som tillhör någon annan ligger kvar oförändrad och räknas inte som ett försök. Nästa användare ser, räknar och skickar inte föregående användares poster. När rätt användare loggar in skickas de.

Aktivitetskön lagrades tidigare aldrig, eftersom `state.currentUser.email` saknades, och kunde efter ett kontobyte i samma flik skickas med nästa användares session. Nu sparas den under sin ägare och töms ur minnet vid kontobyte.

**Utloggning med osynkat.** `Auth.requestLogout()` används av menyns Logga ut. Finns osynkat visas en dialog med antalet per slag och tre val:
- Synka nu: skickar allt eget, även poster som nått taket för automatiska försök. Lyckas inte allt visas dialogen igen med det som återstår.
- Logga ut ändå: ändringarna ligger kvar för kontot på enheten.
- Avbryt.

Ingenting rensas tyst. När en flik saknar giltig session köas ingenting nytt; användaren får beskedet "Du är inte inloggad — ändringen sparades inte".

**Flera flikar.** Utloggning eller kontobyte i en flik slår igenom i andra flikar via storage-händelsen: fliken töms helt och visar inloggning. Behörighetsändringar i en flik når andra flikar för samma användare via `BroadcastChannel('vift-auth')`. Reserven är en storage-ping om kanalen saknas.

**Session som upphör.** Om JWT:n har gått ut och förnyelsen misslyckas gäller fail-closed: fliken töms, den delade cachen rensas och inloggningen visas med beskedet "Din session har upphört — logga in igen …". Inget skickas med den utgångna identiteten. En osparad registerändring ligger kvar i ägarens journal och skickas när samma användare loggar in igen.

**Indragna behörigheter.** Efter varje `DataSync`-poll som läser personal och roller körs `Auth.applyAuthorizationChange('sync')`. Vid HTTP 403 körs `Auth.onServerForbidden()`, som efter 300 ms läser om `vift_staff` och `vift_roles`, med samma atomiska läsväg som `initState`. Den kan också utlösas av ett meddelande från en annan flik. Behörigheterna tillämpas direkt: en otillåten sida lämnas med ett besked och menyn ritas om. Saknas åtkomst helt, till exempel när personalposten inaktiverats och servern svarar 403, töms allt och no-access-sidan visas. Admin- och personaldialogen använder samma väg när användaren ändrar sin egen roll.

**Service Worker.** Ingen ändring behövs. `service-worker.js` (`vift-crm-v14`) släpper alltid igenom `supabase.co` och cachar bara statiska filer från samma ursprung: `?v=`, `/assets/` och HTML. Det finns ingen API-data i CacheStorage och inget IndexedDB används. Statiska filer får ligga kvar.

### 2. Ändrade filer

**Klient** (`?v=` höjt för varje fil):

| Fil | `?v=` |
|---|---|
| `src/data/storage.js` | 22→23 |
| `src/data/state.js` | 78→79 |
| `src/services/AuthService.js` | 23→24 |
| `src/services/AOTimeSyncService.js` | 11→12 |
| `src/services/ActivityService.js` | 6→7 |
| `src/services/TimeEntriesReadService.js` | 2→3 |
| `src/services/WorkOrdersReadService.js` | 2→3 |
| `src/services/InvoiceService.js` | 19→20 |
| `src/services/RonderingSyncService.js` | 1→2 |
| `src/components/Sidebar.js` | 33→34 |
| `src/pages/Router.js` | 32→33 |
| `src/pages/PageShells.js` | 191→192 |

`index.html` har fått no-access-panelen, `App.showNoAccess`, åtkomstkontrollen efter `initState` och varningen för äldre utkorgsposter.

**Tester:**
- `tests/e2e/specs/36_client_security.js` (ny);
- `tests/e2e/lib.js` (`World.tab()`: flera flikar i samma webbläsarkontext);
- `tests/client_security.test.js` (ny).

**Dokument:**
- detta avsnitt;
- `docs/MASTERPLAN.md`: raderna SÄK-9, SÄK-10, 265 och T3-A;
- `docs/qa-2026-11-26/BEHORIGHETSMATRIS.md`: §0.2, R61, SEC-ROLL-10, SEC-CUST-23, SEC-CACHE och F6/F7.

### 3. Commits (bara VIFT-CRM; sammanfogade i `claude/vift-v3-major-redesign` efter T3-B)

| Commit | Innehåll |
|---|---|
| `4b43ee9` | Klientkoden och `?v=` |
| `63e94a4` | Testerna |
| `77b8e1a` | Detta avsnitt, statusraderna och e2e-rapporten |

Inga commits i `vift-v2`.

### 4. Tester

#### Baslinje, oförändrad kod (`113a656`): fynden bevisade

Den nya specen kördes före rättningen: **12 av 13 misslyckades**. Det enda som gick igenom var SEC-CACHE-04, det positiva fallet där samma användare använder sin egen cache.

| Test | Fynd i oförändrad kod |
|---|---|
| SEC-CACHE-01 | 36 `vift_*`-nycklar låg kvar efter utloggning, bland annat `vift_customers`, `vift_staff`, `vift_roles`, `vift_invoices`, `vift_offers`, `vift_settings` och ADM:s sökhistorik. |
| SEC-CACHE-02 | FÄ såg ADM:s cachade kund `K-FRAMMANDE` vid nätfel. |
| SEC-CACHE-03 | Den andra fliken behöll 7 kunder, 6 personal, 5 roller, 5 offerter och 5 fakturor i minnet efter utloggning i den första fliken. |
| SEC-TAB-02 | Efter kontobyte i den delade sessionen skrev fliken med den gamla identiteten: `persist` gav `true` och `patchAO` gav `ok`. |
| SEC-SESS-01 | När sessionen upphört låg all data och `currentUser` kvar i minnet. |
| SEC-OUTBOX-02 | En utkorgspost utan ägare från en äldre version skickades under en annan användare. |
| SEC-ROLL-10 och SEC-CUST-23 | Ingen no-access-sida. Omatchad användare fick reservrollen. |
| SEC-PERM-01 och SEC-PERM-02 | Otillåten sida låg kvar. Inaktiverad personal behöll åtkomsten i den öppna sessionen. |
| SEC-NORM-01 och SEC-OUTBOX-01 | Ingen utloggningsvarning fanns (`requestLogout` saknades). |

Märkning: BASLINJE. Underlag: `t3a-baseline-sec.json` i scratchpad, inte i repot.

#### Efter rättning

| Körning | Resultat |
|---|---|
| `tests/e2e/specs/36_client_security.js` | **13/13 godkända**. Varje negativt fall kontrollerar md5-kontrollsumman över den simulerade serverns store, stämpling, känsliga fält och idempotens, att inga skrivanrop gjorts, samt det förväntade klientbeteendet. |
| `tests/client_security.test.js` | **38/38 godkända** |
| Relevanta befintliga e2e-specar (AUTH, PERM, TIME, SYNC, RES, SW, RENDER-01, XSS-01, ROLE, ARP, STAFF, MYJOBS, SEC) | **54 godkända, 0 misslyckade, 1 blockerad** (PERM-03, sedan tidigare blockerad: G4/BLOCKER-2, inte T3-A). Efter den sista mindre rättningen kördes SEC och AUTH igen: 19/19 godkända. |
| Hela e2e-sviten | **229 godkända, 0 misslyckade, 1 blockerad, 1 känt fel av 231** (§4.1) |
| `bash tests/run-all.sh` med lokal PostgreSQL (`PGHOST=/var/tmp/vift-localpg`) | **20/20 testfiler gröna, 0 överhoppade** |

De 13 e2e-fallen:

| Test | Innehåll |
|---|---|
| SEC-NORM-01 | Normalläge |
| SEC-CACHE-01 | ADM loggar ut, FÄ loggar in: inga affärsnycklar, inget sessionStorage, tomt minne och tom DOM |
| SEC-CACHE-02 | Nätavbrott efter kontobyte med en främmande cache från v3.4 |
| SEC-CACHE-03 | Utloggning och kontobyte i annan flik |
| SEC-CACHE-04 | Positivt fall: egen cache vid nätfel. Skrivning blockerad. |
| SEC-TAB-02 | Kontobyte innan storage-händelsen kommit fram. Ingen token lämnas ut. |
| SEC-SESS-01 | Utgången session. Journalen behålls och skickas av ägaren. |
| SEC-OUTBOX-01 | Varningsdialogen och utkorg vid kontobyte |
| SEC-OUTBOX-02 | Migrering av v3.4-nycklar |
| SEC-ROLL-10 | Omatchad användare |
| SEC-CUST-23 | Okänt roll-id |
| SEC-PERM-01 | Indragen behörighet i öppen session och i annan flik utan egen synk |
| SEC-PERM-02 | Inaktiverad personal under session: 403 leder till no-access |

#### 4.1 Hela e2e-sviten

Hela sviten kördes en gång efter commit `63e94a4`: `node tests/e2e/run.js`, 1656 s. Resultatet står i `tests/e2e/report/REPORT.md` och `results.json`.

**231 tester: 229 godkända, 0 misslyckade, 1 blockerad, 1 känt fel.** Förra fulla körningen (2026-11-25) hade 218 tester. Skillnaden är de 13 nya SEC-testerna.

| Test | Status | Kommentar |
|---|---|---|
| PERM-03 | Blockerad, som tidigare | G4/BLOCKER-2, kan inte prövas mot den simulerade servern |
| AO-07 | Känt fel, som tidigare | G5: loggen skickas som hel array |

Ingen regression. Inget test har ändrats för att bli grönt. Den enda ändringen i befintlig testinfrastruktur är `World.tab()` i `lib.js`, som är additiv.

### 5. SÄK-status

| Id | Status |
|---|---|
| SÄK-10 / F7 | **Lokalt åtgärdad.** Förutsättningen "SÄK-10 är rättad" för att införa standardrollen `personal` (matrisen §2) är uppfylld lokalt. Den måste fortfarande installeras i STAGING före T3-E. |
| SÄK-9 / F6 | **Lokalt åtgärdad.** Gäller R61, SEC-CACHE-01..03, flikar, utgången session, utkorgar och indragna behörigheter. P1 inför LIVE kvarstår tills den är installerad och verifierad i STAGING (SEC-CACHE-01..03 i webbläsare med testkonton). |
| Punkt 265 (C-7) | **Delvis.** Stämplingsnycklarna med e-post rensas nu vid utloggning. Kvar: fem seriella anrop vid inloggning och STAGING-etiketten. |
| Serverdelen | **Öppen** (andra paket). Klienten är bara presentation. Servern måste fortsätta neka (403 `Forbidden` för omatchad användare enligt `vift-auth.ts`), och direkta REST-vägar (F18) och behörighetsgenomslag på servern (T3-C) ligger utanför T3-A. |

### 6. Bakåtkompatibilitet: användare med v3.4 i cachen

**Service Worker.** `index.html` hämtas alltid network-first med `no-store`. Vid nästa uppkopplade sidladdning laddas de nya `?v=`-filerna. Vid en offlinestart innan dess körs v3.4 från cachen, med v3.4:s beteende, tills användaren är uppkopplad igen.

**Server.** Ingen serverändring, så en v3.4-klient får inga nya felkoder. Den saknar bara klientskydden tills den uppdateras.

**Cache utan ägare.** Cache från v3.4 saknar ägarmarkör och rensas vid den första starten eller inloggningen med T3-A. Den första offlinestarten efter uppgraderingen har därför ingen offline-cache: användaren får `unverified` med Försök igen, aldrig någon annans data. Det sker en gång.

**Utkorgen (`vift_outbox`, gemensam i v3.4).** Poster där ägaren (`owner`) står flyttas till `vift_outbox::<ref>::<owner>`. Miljön är given eftersom samma ursprung är samma Supabase-projekt. Poster utan ägare, från versioner äldre än v3.4, ligger kvar i den gamla nyckeln. De skickas aldrig automatiskt, och varningen "N osynkade ändringar från en äldre version … saknar känd ägare och skickas inte automatiskt. Kontakta administratören." visas vid inloggning. Ingenting raderas. Testat i SEC-OUTBOX-02 och i enhetstestet: 3 poster före och 3 efter.

**Intents (`vift_settleIntents`).** De följer ägaren till sin utkorgspost. En intent utan känd ägare behålls i den gamla nyckeln och räknas i varningen.

**Journalen (`vift_persistJournal:<e-post>`, v3.4).** Den flyttas till `vift_persistJournal::<ref>::<e-post>` när ägaren läser den. Den äldre gemensamma `vift_persistJournal` hanteras som tidigare: den spelas bara upp för den användare som står i `j.user`.

**Aktivitetskön.** v3.4 lagrade den aldrig, så det finns inget att migrera.

**Blandade flikar.** En v3.4-flik som är öppen samtidigt kan fortsätta skriva till den gamla `vift_outbox`. De posterna migreras vid nästa sidladdning eller inloggning och går inte förlorade.

**Rensa lokal cache (admin).** Funktionen behåller nu utkorgar och journaler som tillhör andra användare eller saknar ägare. Bara den egna kön kan rensas, efter dubbel bekräftelse.

### 7. Installation (STAGING-klientpaketet) och rollback

T3-A är bara klient. Ingen databas, inga Edge Functions, ingen Storage och inga hemligheter berörs.

**Installation (kräver GO):**
1. Spara föregående STAGING-klientpaket som backup.
2. Bygg paketet från grenen (`tools/build-staging-package.sh`) med STAGING-överlägget.
3. Publicera alla ändrade filer i §2 tillsammans med `index.html`. `?v=` är redan höjt.
4. Hårdladda och verifiera de nya versionerna (`tools/verify-staging-deploy.sh`).
5. Verifiera i webbläsare med testkonton (D-26), bara läsande:
   - SEC-CACHE-01..03;
   - SEC-ROLL-10 med ett konto utan personalpost, om ett sådant godkänns;
   - kontroll av utloggningsdialogen.

**Rollback:** publicera det föregående paketet. Ingen verksamhetsdata skrivs över, eftersom servern inte berörs. Observera två saker:
- Osynkade poster som köats under T3-A ligger i de ägarnycklade nycklarna (`vift_outbox::…`, `vift_persistJournal::…`). v3.4 läser inte dem. De finns kvar i webbläsaren och skickas när T3-A installeras igen, men inte under tiden.
- Be därför fältet logga ut med "Synka nu" före en rollback. Dialogen visar osynkat.

Ett alternativ är ett litet rollback-tillägg som flyttar posterna tillbaka till `vift_outbox`. Det är inte byggt och får beslutas vid behov.

### 8. GO-kriterier (testplanen T3-A)

| Kriterium | Uppfyllt lokalt |
|---|---|
| SEC-CACHE-01..03 gröna | **Ja** (plus SEC-CACHE-04 som positivt fall) |
| SEC-ROLL-10 grön | **Ja** (och SEC-CUST-23) |
| Ingen förlust av osynkade ändringar, utkorgen orörd | **Ja**. Utkorg, journal, intents och aktivitetskö behålls ägarnycklade (SEC-OUTBOX-01/02, SEC-SESS-01). Poster utan känd ägare behålls. |
| `tests/run-all.sh` (regression) | **Ja**, 20/20 |
| Hela e2e-sviten | **Ja**: 229/231 godkända, 0 misslyckade. 1 blockerad och 1 känt fel, båda sedan tidigare. |

### 9. Begränsningar

- Klientskyddet är presentation och dataskydd på enheten, inte ett behörighetsskydd. Servern bestämmer. Allt är lokalt verifierat mot den simulerade servern, inget i STAGING.
- En uppringning som redan skickats innan ett kontobyte i en annan flik fullföljs med sin token. Skyddet gäller allt som skickas efter bytet.
- Data i `localStorage` som behålls (utkorgar och journaler) innehåller ägarens osynkade ändringar och kan läsas med utvecklarverktyg på en delad enhet. De visas och skickas aldrig av appen för någon annan. Detsamma gäller offertutkastet `offerDraft_v1_new_<id>`.
- Sökhistorik och påminnelsetid för 8-timmarsstämpling rensas vid utloggning, alltså också för samma användare.
- Den första offlinestarten efter uppgraderingen har ingen cache (§6).
- `role.active` påverkar inte behörigheten, i paritet med servern (`vift-auth.ts`).
- 403 utlöser en omläsning av personal och roller, debouncad till 300 ms. En behörighetsändring som servern inte signalerar syns vid nästa poll, som körs var 15:e sekund när fliken är synlig, eller via en annan flik.
- När en session upphör utan att användaren loggat ut kan ingen varning om osynkat visas, eftersom sessionen redan är borta. Ändringarna ligger kvar för ägaren.

## T3-B – AO-kärna och arbetspool

Verifieringsnivå: **lokalt verifierad** (PostgreSQL 16.15, Edge Functions körda i Node mot den
lokala STAGING-replikan). Ingenting är installerat eller verifierat i STAGING. LIVE är inte kontaktad.

### Sammanfattning

| Del | Resultat |
|---|---|
| Poolregel (SÄK-3, SÄK-16, AP-A, K-03, Q3) | Utlämning = egen tilldelad AO (inte arkiverad/borttagen) eller **öppen pool** (status `pool`, `poolOpen` ≠ false, ingen personal, inte arkiverad/borttagen) med `ao_pool_take`. Öppen pool lämnas ut i begränsad projektion. Samma regel i `work-orders-list`, `canViewWorkOrder`, SQL-funktionerna och fake-backend. Öppen pool ger ingen skrivrätt. Ingen breddning (L6-bevis per användare och AO). |
| "Ta jobbet" (SÄK-4, AP-F) | Ny RPC `work_order_pool_take` under radlås. Exakt en vinner (N=2 ×20 via EF, N=10 ×5 via egna anslutningar); förloraren får 409 `already_assigned` utan mutation. Servern sätter personal, `poolOpen:false`, status, aktör, tid och logg. |
| Start och klar (SÄK-5, D-03) | Egen tilldelad och giltig AO, kontrollerat i `work_order_patch` under lås. 403 `not_assigned`, 409 `ao_locked`, 409 `invalid_source_status`. Servern sätter `completedBy`/`completedAt` (`ignoredFields`). |
| F21 (SÄK-15, D-07, punkt 269) | `patch_ao` avvisar faktureringsfält för alla roller (403 `invoice_path_required`). Ny väg `invoice-write` `aoBilling` → `work_order_billing_set`. Flödet kö → underlag → status → borttaget utkast/makulering verifierat. |
| Tid och stämpling (SÄK-11, AP-B, D-11 delvis) | Tilldelning under lås i `time_entry_create`, `time_entry_patch` och `store_write_stamp_status`. `hourRate` sätts av servern ur prisgruppen. Legitim utstämpling bevaras. Sommartid, midnatt, nätavbrott och samtidighet prövade. |
| Material, checklista, logg, bilder | Tilldelning (eller arbetsledare) och skydd för låsta AO. Fältet kan bara ändra egna materialrader (`not_own_row`); full radvis D-19 är T4-B. |
| Idempotens (SÄK-12, F17) | Nyckeln binds till aktör, operation och innehåll (409 `idempotency_key_conflict`, ingen mutation; samma nyckel + innehåll återspelas). |
| AO-nummer (punkt 245) | Max+1 under radlåset, kontroll mot befintliga nummer, ingen avkortning över AO-999, ingen unik index, ingen omnumrering. 10 samtidiga skapanden ger unika nummer. |
| Datum (Q1, punkt 250) | `dueDate` för nya serviceintervall-AO (klient och `service-monitor`) och återkommande. Med personal skrivs förfallodagen inte till `scheduledDate`. Befintliga data orörda. |
| Klient | Personaldialogen (AP-FEL-1, AP-G), "Ta bort datum", "Släpp till öppen pool", "Ta jobbet" via RPC med 409-hantering, felkoder med begripliga texter, instämplingslista, `?v=` höjt. |
| Paritet (SÄK-17) | Fake-backend följer T3-B-reglerna. 54 scenarier: 52 lika, 2 kända (KEY-01, AUTH-02, utanför T3-B). AO-04, AO-05, AO-13, AO-19 och CHK-LEGACY borttagna ur listan över kända avvikelser. |
| STAGING-verktyg | `authz-read.js`, `c5-read.js`, `authz-mutation.js` skärpta (felkod, `reason`, oförändrad test-AO). **Inte körda mot STAGING.** |
| Rollback | `supabase/rollback/T3-B/rollback_t3b.sql`: installera → rollback (= STAGING-facit, ingen data ändrad) → installera, lokalt prövat. |

### 1. Serverändringar (vift-v2, `supabase/`)

**Nya migrationer** (klass "ny" i MIG-1, version efter 20261124211128, i `MIGRATIONSORDNING.txt`). Varje fil
har en STOP-kontroll mot md5 av den STAGING-version den ersätter (och repokedjans version med andra
kommentarer), och en andra körning stoppas.

| Fil | Innehåll |
|---|---|
| `20261128000001_t3b_ao_regler_och_pool.sql` | Regelfunktionerna `_vift_*` (bara `service_role`). `work_order_patch` med **ny signatur** (`p_caller_staff_id`, `p_caller_perms`); den gamla 4-argumentsversionen tas bort. Ny `work_order_pool_take`, ny `work_order_billing_set`. `work_order_checklist_set_state`, `work_order_log_append/remove` (samma signatur): poolgrenen borttagen, `forbidden:not_assigned`, `ao_locked` för icke-ledare. |
| `20261128000002_t3b_tid_och_stampling.sql` | `time_entry_create` med **ny signatur** (`p_caller_staff_id`, `p_caller_auth_id`, `p_caller_perms`); den gamla tas bort. `time_entry_patch` och `store_write_stamp_status` (samma signatur) med tilldelningskontroll. `_vift_auth_staff`. |
| `20261128000003_t3b_ao_nummer.sql` | `work_order_create` (samma signatur): AO-nummer enligt punkt 245; status `pool` + personal ger `poolOpen:false`. |

**Övergångsregel** (testplanen §4.6, `_vift_ao_eff_perms` i SQL, `effectiveAoPerms` i `_shared/vift-auth.ts`,
`WorkOrderService.aoCan` i klienten, `effAoPerms` i fake-backend och STAGING-verktygen): en roll som inte har
någon av `ao_start_own`, `ao_complete_own`, `ao_pool_take` och som har `ao_complete` men varken `ao_view_all`
eller `ao_edit` behandlas som om den hade alla tre. Så fort en roll får någon av de nya behörigheterna gäller
rollens egen lista exakt. Regeln smalnar av dagens rätt (bara egna AO och bara öppen pool) och tas bort när
standardrollerna har de nya behörigheterna (T3-E). `ao_edit` får också ta jobb (arbetsledaren kan redan tilldela).

**Regler i `work_order_patch`** (allt på den radlåsta raden, även idempotensen):
- `ao_edit`/`all`: fri patch utom faktureringsfält. Får en pool-AO personal sätts `poolOpen:false`.
- Fält, bara materialpatch: `ao_material`, tilldelad, olåst AO, bara egna rader (`addedBy` sätts av servern).
- Fält, `{status:'pågående'}`: `ao_start_own`, tilldelad, olåst, källstatus `nytt`/`planerad`/`pool`.
- Fält, `{status:'klar'}` (+ `completedAt`/`completedBy` som ignoreras): `ao_complete_own` på egen tilldelad AO,
  eller `ao_complete` + `ao_view_all`. Källstatus `nytt`/`planerad`/`pool`/`pågående`.
- Fält, v3.4-formen av "Ta jobbet" (`{staff, status:'planerad', log}`): samma regel som `work_order_pool_take`.
- Allt annat från fältet: 403 `forbidden`/`field_not_allowed`.

**Felkoder** (BEHORIGHETSMATRIS §4): `forbidden`/`not_assigned`, `forbidden`/`pool_not_open`,
`forbidden`/`invoice_path_required`, `forbidden`/`not_own_row`, `forbidden`/`field_not_allowed` (ny),
`forbidden`/`invoice_not_linked` (ny), 409 `already_assigned`, `ao_locked`, `invalid_source_status`,
`idempotency_key_conflict`. Avslag utan specifik orsak (behörighet saknas) har ingen `reason`.

**Edge Functions:** `work-orders-list` (poolregel, projektion, inga arkiverade/borttagna för icke-ledare),
`ao-time-write` (regler flyttade till RPC:n; ny åtgärd `take_from_pool`; `create_time` skickar identitet och
behörigheter; `patch_time` ignorerar fältets `hourRate`), `store-key-write` (`stamp-status.ts`: felkoder),
`work-order-checklist-resolve`, `work-order-log-write`, `work-order-image-upload/-delete` (skrivrätt =
tilldelad eller arbetsledare, `ao_locked`), `work-order-image-url` (bilder kräver tilldelning, K-03),
`invoice-write` (`aoBilling`), `service-monitor` (`dueDate`), `_shared/vift-auth.ts` (gemensamma regler,
`aoRuleError`).

**Stämpling när AO:n ändras under ett pågående pass** (punkt 261, T3-B-uppdraget): ny instämpling kräver
tilldelning. Utstämpling av ett pass som **startades legitimt** tillåts alltid: `time_entry_create` godtar
posten om anroparens egen `stamp_status` är aktiv med samma `ao_id` och samma `ts` som postens `startTs`.
Då kan AO:n ha omfördelats, klarmarkerats eller fakturerats under passet utan att det utförda arbetet
försvinner. Ingen annan väg ger tid utan tilldelning. Pass som startades före installationen räknas som
legitima (de kontrollerades inte vid instämplingen). En utstämpling efter fakturering blir en ny okrävd
källa i fakturakön (fakturamotorns befintliga dubbelriktade regel).

**Fakturaflödet:** `invoice-write` `aoBilling` kräver `invoice_create`.
- `invoiced`: underlaget ska finnas, inte vara makulerat och hänvisa till AO:n.
- `restore`: backar bara motorsatta markeringar, till serverns sparade `billingPreviousStatus`.
- Låsordning som `invoice_set_status`: fakturor före AO.
- Klientens `BillingQueueService` använder vägen.

### 2. Klientändringar (VIFT-CRM)

- `WorkOrderService`:
  - `updateStaff` ändrar bara personal, ansvarig och logg och returnerar faktiska tillägg och borttagningar;
  - nya `releaseToPool`, `removeSchedule`, `aoCan`, `isOpenPool` och `serverErrorText`;
  - `takeFromPool` är asynkron via `take_from_pool`.
- `WorkOrderDetailPage`:
  - personaldialogen utan poolruta;
  - notiser efter serverbekräftelse;
  - menyåtgärderna "Ta bort datum" och "Släpp till öppen pool" (bekräftelse som namnger personalen);
  - Klarmarkera och Starta enligt `ao_complete_own`/`ao_start_own`.
- `MyJobsPage`: bara öppen pool med `ao_pool_take`, Starta enligt `ao_start_own`, "Ta jobbet" väntar på servern och hanterar 409.
- `TimePage`: instämplingslistan visar egna tilldelade AO; med `ao_edit` alla aktiva.
- `BillingQueueService`: `aoBilling` i stället för `patch_ao`.
- `ServiceIntervalService` och `RecurringOrderService`: `dueDate`.
- `TimeService`: `idempotency_key_conflict` vid utstämpling = redan registrerad.
- `AOTimeSyncService` (minimalt, för T3-A:s sammanslagning):
  - `reason` skickas vidare;
  - fyra nya slutgiltiga felkoder;
  - fält utan bekräftat loggstöd väljer den atomiska loggvägen.
- `PageShells` (rolleditorns katalog) och `seedData` (demorollen `personal`): de tre nya behörigheterna.
- `index.html`: `?v=` höjt för alla 11 ändrade filer.
- `tools/build-staging-package.sh`: konflikter i `index.html` som bara gäller `?v=` löses med HEAD.

### 3. Fake-backend och STAGING-verktyg

- `tests/e2e/fake-backend.js` speglar T3-B-reglerna:
  - poolregel, projektion och `accessCode` (C-5);
  - `patch_ao` som `work_order_patch`;
  - `take_from_pool`;
  - tid, stämpling, checklista, logg och bilder;
  - serverpris;
  - idempotens bunden till aktör och innehåll;
  - `aoBilling`;
  - ingen autostart i `checklistLegacy`;
  - `logOps` som standard (work-order-log-write är installerad).
- vift-v2:s kopia är synkad.
- STAGING-verktygen i `vift-v2/tests/staging`:
  - `lib.matchSvar` (status, error, reason; 5xx godkänns aldrig) och `lib.effAoPerms`;
  - `authz-read` R1/R1b: bara egna och öppen pool, i projektion;
  - `c5-read`: projektionen;
  - `authz-mutation`: G9 skärpt (403, admin med `invoice_path_required`), samt tagning, start, klar, tid,
    stämpling, logg och checklista på en märkt test-AO i öppen pool. Felkod, `reason` och oförändrad
    test-AO kontrolleras. Förväntan beräknas från kontots faktiska roll.
- Verktygen är provade lokalt mot fake-backend (`staging_tools.test.js`), **inte mot STAGING**.
- VIFT-CRM:s äldre kopior i `tests/staging/` är inte skärpta; vift-v2:s gäller.

### 4. Tester (lokalt, PGHOST=/var/tmp/vift-localpg, PostgreSQL 16.15)

**vift-v2 `tests/run-all.sh` (SKIP_BROWSER=1): 26/26 testfiler gröna, 790 godkända kontroller, 0 fel.**
Webbläsartesterna i `browser/` hoppades över med SKIP_BROWSER=1, som i T3-0, och räknas inte som godkända.
`staging_e2e_real` kör Playwright och ingår i de 26 filerna.

Nya:
- `t3b_ao_karna` **171/0**: SÄK-3/-4/-5/-11/-12/-15/-16, poolprojektion, L6 ingen breddning, tagning,
  start/klar, faktureringsväg och fakturaflöde, tid/stämpling (sommartid, midnatt, nätavbrott),
  checklista/logg/material/bilder, AO-nummer, offert → AO, import, återkommande, `service-monitor`.
  Samtidighet med egna anslutningar:
  - tagning N=2 ×20 och N=10 ×5;
  - borttagning mot klarmarkering ×20;
  - instämpling ×10 och utstämpling ×10;
  - AO-nummer ×10.
- `t3b_rollback` **12/0**: installera → rollback (= STAGING, ingen data ändrad) → installera; STOP vid omkörning.

Ändrade och gröna:
- `baslinje_sakerhet` 38/0 (historisk källa fb71f26, 34 brister bevisade);
- `replica_build` 30/0 (STAGING-baslinjen + kontroll av T3-B-deltat: 3 nya migrationer, 26 registrerade objekt, inga nya funktioner för anon/authenticated);
- `ef_smoke` 39/0;
- `rekonstruerade_rpc_sql` 40/0 (STAGING-kedjan);
- `migrationsmappning` 18/0 (48 filer i migrations/, 3 "ny");
- `migrationskedja` 2/0 (119 identiska, 32 förklarade = 6 tidigare kända + 26 registrerade T3-B-objekt, 0 oförklarade);
- `staging_tools` 44/0;
- `staging_e2e_real` 26/0 (T3-B-klientpaketet).

Övriga oförändrat gröna, bland dem:
- de fyra PostgreSQL-testerna (checklist_progress_sql 32/0, server_rpcs_sql 17/0, offer_attachment_upload 43/0, staging_backup_export 12/0);
- `ao_time_write_paths` 34/0;
- `cloud_stamping` 28/0;
- `service_intervals` 38/0.

**VIFT-CRM `tests/run-all.sh`: 21/21 testfiler gröna** (20 Node-testfiler med 495 godkända kontroller och 0 fel, plus
`browser/offer_total_parity.js` med 120 offerter och 0 avvikelser). Inga överhoppade.
- `sim_parity` 55/0: 54 scenarier, 52 lika och 2 kända avvikelser (KEY-01, AUTH-02);
- `staging_e2e_real` 26/0 (T3-B-klientpaketet);
- `staging_tools` 40/0;
- `v3_ui_logic` 35/0.

**E2E (Playwright mot den simulerade servern):**
- Riktad körning för AO, AOD, AOL, TIME, TE, CHK, FALT, BILL, FLOW, PERM, LOG, IMG, SVC, IMP, ECO, INV, SI, RON och T3B:
  - första körningen: 80 godkända, 17 fel, 1 blockerad (PERM-03, sedan tidigare), 1 känt fel (AO-07, G5);
  - felen hade tre orsaker:
    - standardvärlden saknade work-order-log-write, så fältets loggposter gick via `patch_ao`, som servern nekar;
    - D-03 ger Klarmarkera med `ao_complete_own`, vilket de äldre förväntningarna i AOD-01/07/08/09 inte räknade med;
    - en väntan på modalen i T3B-02;
  - efter rättning: 39/0 och AOD-09 1/0;
  - AO-07 (G5) reproduceras inte längre med den atomiska loggvägen (AO-07B visar samma sak).
- **Hela e2e-sviten en gång, efter rättningarna: 222 godkända, 0 fel, 1 blockerad (PERM-03, sedan tidigare: per-nyckel-regeln för generiska nycklar kan inte modelleras), 0 kända fel, av 223 (1 611 s).**

Inga tester har försvagats.
- Pooltesterna (14, 04, 33) är skärpta: begränsad ser ingen pool, pool med personal, arkiverad och borttagen
  pool syns inte, projektionen kontrolleras och tagningen sker via `take_from_pool`.
- 06 kräver nu att AO:n faktiskt markeras fakturerad. Tidigare noterades bara ett avslag.
- 27 kräver Klarmarkera med `ao_complete_own` och ingen Klarmarkera utan behörigheten.

### 5. Baslinjefynd, vända

`baslinje_sakerhet.test.js` körs nu som **historisk referens** mot källan i commit `fb71f26` (före T3-B,
STAGING-ekvivalent), utläst med `git archive`. Där bevisas fortfarande alla 34 brister (38/0). De rättade
raderna prövas i `t3b_ao_karna.test.js`:

| Baslinje (T3-0) | Godkänt säkerhetstest (T3-B) |
|---|---|
| SÄK-3: P2/P3 lämnas ut; P1 med kontakter/logg/priser; begränsad ser pool | SEC-POOL-01/02/03/04, L6 ingen breddning, L7 bild-URL 403 `not_assigned` |
| SÄK-16: P5/P6 lämnas ut | SEC-POOL-02 (även egna arkiverade/borttagna döljs) |
| SÄK-3: checklista på P2, logg på P1 muterar | W1–W5/SEC-POOL-11/12: 403 `not_assigned`, KS oförändrad, ingen fil |
| SÄK-4: tagning av P2 godtas; samtidig tagning båda 200; RPC utan regel | SEC-POOL-06 409 `already_assigned`; SEC-POOL-09 ×20 + N=10 ×5 exakt en; RPC nekar `field_not_allowed` |
| SÄK-5: klar på fakturerad/annans/avbruten AO, egen completedBy | SEC-AO-05/06/07 (`not_assigned`/`ao_locked`), SEC-AO-08 `ignoredFields`, SEC-AO-14 ×20 |
| SÄK-15: `ao_edit` sätter fakturerad + invoiceId | SEC-AO-15 403 `invoice_path_required` (chef, admin, backa, rensa, billingPreviousStatus) |
| SÄK-12: annan patch med samma nyckel godtas | SEC-AO-20 409 `idempotency_key_conflict` (annat innehåll och annan aktör), RPC direkt |
| SÄK-11: tid på ej tilldelad/fakturerad AO; klientens hourRate; stämpling utan kontroll | SEC-TID-02/03 `not_assigned`, `ao_locked`, `not_found`; SEC-B2-03 serverpris + `ignoredFields` |

Kvar som baslinjefynd: SÄK-2 (T3-D), SÄK-8 och SÄK-13 (T3-C) och GRANTS utan R-E.

### 6. SÄK och D efter T3-B

- **Lokalt åtgärdade:**
  - SÄK-3, -4, -5, -11 (tilldelningen samt serverpriset), -12, -15, -16;
  - SÄK-17 för T3-B:s resurser;
  - D-03, D-07, AP-B, AP-F;
  - AP-A (säkerhetsdelen), AP-G (personaldialogen);
  - K-03, Q3;
  - punkt 245;
  - punkt 269 (samordnat med D-07).
- **Delvis:**
  - punkt 250: `dueDate` och atomisk AO-skapelse; kvar: atomisk skrivning av `vift_properties` och cron-beslut;
  - punkt 261: servern; kvar: klienttest i webbläsare över omställningen;
  - punkt 270: funktionell verifiering av kö → underlag → status; åtgärdsorsakerna oförändrade;
  - D-11: serverpris; kvar till T4-B: tillåtna prisgrupper och belopp dolda för fältet;
  - D-19: egna rader; kvar till T4-B: radvisa RPC:er;
  - Q1: `dueDate` för nya AO; befintliga orörda.
- **Öppna:** SÄK-1, -2, -6, -7, -8, -9, -10, -13, -14.
- **AO-etappen:**
  - notis till arbetsledare när ett jobb tas (AP-D);
  - kategorier och räknare i alla vyer (AP-C);
  - kalenderrutor;
  - `ao_plan_own` (AP-E);
  - `nextStep` per kategori.

### 7. Installationsplan och rollback (STAGING-paketet T3-B, beskrivs, körs inte)

**Förutsättningar:**
- separat GO;
- T3-A installerad först eller samtidigt (testplanen §6), och T3-A:s och T3-B:s ändringar i
  `AOTimeSyncService.js`, `PageShells.js`, `InvoiceService.js` och `index.html` sammanslagna;
- backup enligt testplanen §8: backupschema för `store`, `op_idempotency` och `function_definitions` med
  md5, extern kopia verifierad (`tools/staging-backup-export.js --provata-lokalt`), EF-backup av
  `ao-time-write`, `work-orders-list`, `store-key-write`, `work-order-checklist-resolve`,
  `work-order-log-write`, `work-order-image-*`, `invoice-write` och `service-monitor`.

| Steg | Innehåll |
|---|---|
| 1. Läsande förkontroll | `schema_migrations` lika med `migrationsmappning.json` (41 rader). md5 av `pg_get_functiondef` för de åtta funktioner som ersätts ska matcha facit (samma värden som i STOP-kontrollerna). |
| 2. Databas | `20261128000001`, `…02`, `…03`, en i taget, i den ordningen, var och en i egen transaktion. Ingen `db push`, ingen `migration repair` (MIG-1). |
| 3. Edge Functions, direkt efter steg 2 | `ao-time-write` och `store-key-write` först (de anropar de nya signaturerna), sedan `work-orders-list`, `work-order-checklist-resolve`, `work-order-log-write`, `work-order-image-upload`, `-delete`, `-url`, `invoice-write`, `service-monitor`. `_shared/vift-auth.ts` följer med varje bunt. |
| 4. Klient | Paketet byggs med `tools/build-staging-package.sh` från HEAD (med T3-A sammanslagen) och publiceras på STAGING. `?v=` är höjt för alla ändrade filer. Service Worker är network-first med cache-busting, så nya filer hämtas vid nästa laddning. |
| 5. Storage | Ingen ändring (bucket `workorder-images` oförändrad; bara EF-kontrollen före uppladdning ändras). |
| 6. Efterkontroll (läsande, GO) | md5 av de nya funktionerna = `tests/local/t3-andringar.json`; `authz-read.js` och `c5-read.js` (nivå 1); därefter `authz-mutation.js` (nivå 2, märkta test-AO, inga massprov) med separat GO. |

**Fönstret mellan steg 2 och 3:**
- `ao-time-write` (gammal) anropar `work_order_patch`/`time_entry_create` med de gamla signaturerna. De
  finns inte längre, så svaret blir 500 `write_failed`.
- Klientens utkorg behandlar 500 som tillfälligt och sänder om, så ingen data går förlorad.
- Stämpling, checklista och logg fungerar under fönstret, med de nya kontrollerna i SQL.
- Fönstret ska vara minuter: lugn tid, steg 3 direkt efter steg 2.

**v3.4-klient (Service Worker-cache) mot ny server, tills sidan laddats om:**

| Åtgärd i v3.4 | Ny server svarar | Följd |
|---|---|---|
| AO-lista för fält | Färre AO; öppen pool projicerad | Poolkort utan kund och kontakt; ingen data ändras |
| "Ta jobbet" (`patch_ao` i v3.4-form) | 200 (atomiskt) eller 409 `already_assigned` | v3.4 känner inte koden: posten ligger kvar i utkorgen som osäker tills omladdning; ingen dubbeltagning |
| Personaldialogen med poolrutan (arbetsledare) | 200 (`ao_edit`) | AP-FEL-1 kvarstår i v3.4 tills omladdning; inget nytt fel |
| Faktureringsstatus via `patch_ao` | 403 `forbidden`/`invoice_path_required` | v3.4 backar lokalt och visar "faktureringsstatusen kunde inte sparas"; underlaget påverkas inte; ny klient sätter statusen vid nästa avstämning |
| Klar/Start på egen AO | 200 | Oförändrat |
| Klar/tid/stämpling på annans eller låst AO | 403 `forbidden` (+ `reason`) / 409 `ao_locked` | v3.4 visar generiskt fel; `ao_locked` är tillfälligt i v3.4 (ligger kvar i utkorgen) |
| Fältets loggpost via `patch_ao` (v3.4 utan bekräftat loggstöd) | 403 `field_not_allowed` | Nekades redan av den installerade servern för fältroller |
| Samma nyckel med annat innehåll | 409 `idempotency_key_conflict` | Ligger kvar i v3.4:s utkorg; ny klient behandlar koden som slutgiltig |

**Rollback** (data skrivs aldrig över):
1. `supabase/rollback/T3-B/rollback_t3b.sql` (genererad ur STAGING-facit):
   - tar bort de nya signaturerna och funktionerna;
   - återställer de åtta ersatta funktionerna **exakt** till STAGING-definitionerna, med samma rättigheter;
   - rör ingen tabell, ingen rad och ingen sekvens.
2. Föregående EF-versioner ur EF-backupen.
3. Föregående klientpaket (`staging-release` `90fa360`).

Data som skapats efter installationen ligger kvar och tolereras av den äldre koden (`t3b_rollback.test.js`):
- tagningar och `poolOpen:false`;
- `addedBy`;
- `billingPreviousStatus`;
- `'_fp'` i `op_idempotency.result`;
- tidposter med serverpris;
- den framflyttade AO-nummersekvensen.

Ingen backup återläses över verksamhetsdata. Data återläses bara vid ett separat beslut om ett datafel.

### 8. Kontrollpunkter (BESLUT-2026-11-28)

| Kontrollpunkt | Uppfylld | Belägg |
|---|---|---|
| Obligatoriska tester godkända | Ja | §4 |
| Negativa tester ger rätt felkod och ingen mutation | Ja | `expectReject` (status, error, reason, KS) i alla negativa fall; STAGING-verktygen med `matchSvar` |
| Inga nya oförklarade säkerhetsavvikelser | Ja | Paritet 52/54 lika, 2 kända utanför T3-B; schemat 0 oförklarade (T3-B-objekten md5-registrerade) |
| Samtidighetskritiska kontroller under transaktionslås | Ja | Tagning, start/klar, tilldelning för tid/stämpling, faktureringsstatus, AO-nummer och idempotens under `FOR UPDATE`/`FOR SHARE` i RPC:n. EF-kontrollerna är bara första lager. Bild-EF:erna kontrollerar i EF (Storage är inte transaktionell); bildreferensen skrivs via loggen under lås. |
| Berörda affärsflöden fungerar | Ja | Offert → AO, fakturakö → underlag → status, import, serviceintervall (`service-monitor`), återkommande, stämpling, checklista (lokalt, server + e2e) |
| Avgränsade commits och rollback | Ja | Två commits per repo, se nedan; rollback prövad lokalt |
| Masterplanen visar faktisk nivå | Ja | SÄK-3/4/5/11/12/15/16/17, 245, 250, 261, 269, 270, AP-FEL-1, D-03, D-07: "Lokalt verifierad" eller "Delvis" |

### 9. Kända begränsningar och beslut som behövs

**Begränsningar:**
- PG16 och Node i stället för PG17 och Deno.
- Fältroller i STAGING utan `ao_complete` förlorar öppen pool tills de får `ao_pool_take`.
  - Följer av testplanens övergångsregel.
  - De kunde inte ta jobb tidigare heller.
  - STAGING:s rolldata är inte läst.
- `work_order_create` binder bara nyckeln till operationen, inte till innehållet. `service-monitor` skickar
  nya tidsstämplar vid omkörning med samma deterministiska nyckel, och en innehållsbindning skulle ge
  konflikter. Den som skapar måste ändå ha `ao_create`.
- Bildradering av andras bilder kan inte avgöras ur filvägen (T4).
- Följande ligger i AO-etappen:
  - notis vid tagning;
  - kalenderruta för tilldelade AO utan datum;
  - räknare.
- STAGING-paketet som är installerat i dag (`staging-release`) ger F3/F5 AVVIK mot T3-B-reglerna.
  - Orsak: paketet skriver fältets loggposter via `patch_ao`.
  - Det nekar även den installerade servern för fältroller.
  - `staging_e2e_real` provar därför T3-B-klientpaketet.
- vift-v2:s äldre klientkopia och dess e2e-specar är inte anpassade.
- VIFT-CRM:s kopior av STAGING-verktygen är äldre än vift-v2:s.

**Beslut som behövs (förslag i parentes):**
1. Tid på låst AO (fakturerad, avbruten, arkiverad, borttagen) nekas även för arbetsledare och lönehandläggare.
   Undantaget är legitim utstämpling. (Godta.)
2. Material, checklista och logg på en **klar** AO är tillåtna för den tilldelade, för dokumentation i
   efterhand. Fakturerad AO är låst. (Godta.)
3. `aoBilling` `restore` kontrollerar inte att underlaget slutat hänvisa till AO:n. Fakturamotorns regel
   backar också när nya okrävda källor tillkommer. (Godta; behörigheten är `invoice_create`.)
4. `ao_edit` får ta jobb ur poolen. (Godta, eftersom arbetsledaren redan kan tilldela.)
5. Demorollen `personal` i klientens seed har fått de tre nya behörigheterna. STAGING:s rollregister är orört (T3-E).

### Ändrade filer

**vift-v2** (gren `claude/vift-system-restructure-8fUme`):
- nya:
  - `supabase/migrations/20261128000001_t3b_ao_regler_och_pool.sql`, `…02_t3b_tid_och_stampling.sql`,
    `…03_t3b_ao_nummer.sql`;
  - `supabase/rollback/T3-B/rollback_t3b.sql`;
  - `tests/t3b_ao_karna.test.js`, `tests/t3b_rollback.test.js`;
  - `tests/local/t3-andringar.{js,json}`, `tests/local/t3b-rollback.js`;
- ändrade:
  - `supabase/MIGRATIONSORDNING.txt`, `MIGRATIONSMAPPNING.md`, `migrationsmappning.json`;
  - `supabase/functions/{_shared/vift-auth.ts, ao-time-write, work-orders-list, store-key-write/stamp-status.ts,
    work-order-checklist-resolve, work-order-log-write, work-order-image-upload, work-order-image-delete,
    work-order-image-url, invoice-write, service-monitor}`;
  - tester:
    - `baslinje_sakerhet` (historisk källa);
    - `replica_build`, `ef_smoke`, `rekonstruerade_rpc_sql`;
    - `staging_tools`, `staging_e2e_real`;
    - `tests/local/{jamfor-schema.js, migrationsmappning.js, lib/replik.js, lib/ef.js, lib/paritet.js}`;
    - `tests/e2e/fake-backend.js`;
    - `tests/staging/{lib,authz-read,authz-mutation,c5-read}.js`.

**VIFT-CRM** (gren `claude/vift-v3-major-redesign`):
- ändrade:
  - `index.html`;
  - `src/services/{WorkOrderService,AOTimeSyncService,TimeService,BillingQueueService,ServiceIntervalService,RecurringOrderService}.js`;
  - `src/pages/{WorkOrderDetailPage,MyJobsPage,TimePage,PageShells}.js`;
  - `src/data/seedData.js`;
  - `tools/build-staging-package.sh`;
  - `tests/e2e/fake-backend.js`, `tests/e2e/paritet-kanda-avvikelser.json`;
  - `tests/e2e/specs/{04_workorders,06_economy,14_permissions,27_aodetail,33_falt_pages}.js`;
  - `tests/staging_e2e_real.test.js`;
  - detta dokument, `docs/MASTERPLAN.md`, `docs/qa-2026-11-26/BEHORIGHETSMATRIS.md`;
- ny: `tests/e2e/specs/37_t3b_ao_karna.js`.

### Commits

**vift-v2** (`claude/vift-system-restructure-8fUme`, inte pushad):
- `9ef3164` T3-B server: AO-kärnan och arbetspoolen (SÄK-3/4/5/11/12/15/16, punkt 245/250), nya migrationer, EF och rollback
- `a43da44` T3-B tester: säkerhetstester (vända baslinjefynd), samtidighet, rollback, T3-facit, paritet och skärpta STAGING-verktyg

**VIFT-CRM** (`claude/vift-v3-major-redesign`, inte pushad):
- `e33029e` T3-B klient: personaldialog (AP-FEL-1), Ta jobbet via take_from_pool, faktureringsstatus via invoice-write, felkoder
- `a699246` T3-B tester: fake-backend följer T3-B-reglerna (paritet), skärpta e2e-tester, nya T3B-01–05
- dokumentcommit (detta avsnitt, MASTERPLAN, BEHORIGHETSMATRIS): se `git log` efter `a699246`

## T3-C – roller och superadmin

Verifieringsnivå: **lokalt verifierad** (PostgreSQL 16.15, Edge Functions körda i Node mot den
lokala STAGING-replikan, webbläsartester mot den simulerade servern). Ingenting är installerat
eller verifierat i STAGING. LIVE är inte kontaktad. Inga läsningar mot STAGING behövdes.

### Sammanfattning

| Del | Resultat |
|---|---|
| Eskalering (SÄK-8, D-25) | `store_business_key_write`/`_merge_write` (samma signatur) kör `_vift_authz_check` på det slutliga värdet för `vift_staff` och `vift_roles`, i samma transaktion som skrivningen. 403 `forbidden`/`privilege_escalation`: egen roll ändras, eller någon (post, roll eller inloggad identitet) får behörighet utöver anroparens. 403 `forbidden`/`superadmin_required`: `all`, eller en roll eller post med `all`, tilldelas, ändras eller tas bort av någon utan `all`. `admin_manage` är inte superadmin. Superadmin avgörs bara av `all`, aldrig av roll-id eller namn (SEC-ROLL-08/09). |
| Invarianten "minst en aktiv användare med `all`" | 409 `last_superadmin` i personal- och rollregistret och i `deactivate_vift_user`/`provision_vift_user`. Kontrolleras under ett gemensamt lås (rådgivande lås → `vift_roles` → `vift_staff` → `app_users`). Anroparens behörigheter läses om under låset. SEC-ROLL-05/06: 50 upprepningar vardera, både med egna anslutningar och via EF med barriär. Exakt en vinner, aldrig 0 superadmins. Ingen deadlock mot T3-B:s lås (10 blandade upprepningar). |
| Projektion (D-21, D-14) | Utan `admin_manage` bara den egna effektiva rollen ur `vift_roles` (med `staff_manage` även de roller man får tilldela). Utan `staff_manage`/`admin_manage` tas andras `permissions` bort ur `vift_staff`, och andras `role` utan `staff_view`. REST-läsning av registren stängd för övriga (samma mönster som C-5, `vift_store_full_access`). Hash avser hela servervärdet. |
| F18 / SÄK-13 | Uttrycklig vitlista i RLS (RESTRICTIVE INSERT/UPDATE) och trigger: `vift_notifications` (befintligt innehållsskydd) och `vift_lastChanged` (värdet sätts av servern). DELETE och allt annat: 42501 `direct_write_blocked`. Klientens enda direkta skrivning (`persistNotifs`) fungerar oförändrad. |
| RPC-grants (SEC-REST-03/04) | Alla EF-RPC:er, även T3-B:s nya signaturer och T3-C:s funktioner, har EXECUTE bara för `service_role`. Bara de två RLS-hjälparna (`vift_caller_perms`, `vift_store_full_access`) är körbara för authenticated. |
| Befintliga sessioner | Servern läser behörigheterna vid varje anrop (EF: `checkViftAuth`; RPC: omläsning under låset; RLS: `vift_caller_perms`). Testat på server och i webbläsare: T3C-06, där admin drar in en behörighet i rolleditorn och den redan inloggade fliken nekas vid nästa serveranrop och lämnar sidan. |
| Klient | Rolleditorn och personalsidan erbjuder bara val som servern godtar. De tre felkoderna visas som begripliga meddelanden, och ändringen rullas tillbaka. Personal Inaktivera/Aktivera väntar på serverns bekräftelse (punkt 247). Dagens drift fungerar med projicerat rollregister. `?v=` höjt för fem filer. |
| Fake-backend och paritet | Fake följer T3-C-reglerna. 85 scenarier: 83 lika, 2 kända (KEY-01, AUTH-02, utanför T3-C). 31 nya T3-C-scenarier, inklusive REST och BLOCKER-2. |
| PERM-03 (BLOCKER-2) | Avblockerat. Körs mot serverns `KEY_PERMISSIONS`, utläst ur `store-key-write`-källan (ingen kopia och ingen modell), med exakt felkod och kontrollsumma. |
| Rollback | `supabase/rollback/T3-C/rollback_t3c.sql` (genererad ur STAGING-facit). Installera → rollback → installera är prövat lokalt, och även rollback T3-C + T3-B i omvänd ordning (= exakt STAGING-facit). Ingen data ändras. |

### 1. Inventering före ändringen

**Hur klienten läser personal och roller** (nuvarande klient och v3.4):
- `initState`, `DataSync._poll` och `Auth.refreshAuthorization` använder `Storage.getAllWithHashes` → `store-key-write` `readAllWithHashes` (EF, projicerad).
- `readWithHash` används vid konflikt och omsynk.
- Direkt REST-läsning (`/rest/v1/store`) används bara för `vift_lastChanged`, `vift_notifications` och `vift_ronderingspass`.
- `Storage.getAll` (REST) anropas inte.
- Därför kunde REST-läsningen av `vift_staff`/`vift_roles` stängas utan att någon klient påverkas.

**Var klienten använder andras roller:**
- Personalsidans rollmärke och AO:ns personaldialog (bara visning; faller tillbaka på roll-id).
- Rolleditorn och användningsräknaren (`admin_manage`, får hela registret).
- `OperationsPage` "lediga i fält" (`ao_time` i andras roll). Fick en reserv: utan synlig roll räknas den som är tilldelad någon AO.
- `Auth._resolveUser` och `Auth.can` använder bara den egna posten och rollen.
- Fältet `vift_staff[].permissions` läses aldrig av klienten.

**Klientens direkta REST-skrivningar till `store`** (nuvarande och v3.4, `git grep` på a2549e0):
- Bara `persistNotifs` → `Storage.setRemoteStrict([['notifications', …], ['lastChanged', now]])`, en upsert med två rader.
- `Storage.set`, `Storage.setAll` och `Storage.remove` finns men anropas inte.
- Alla 28 affärsnycklar går via `store-key-write`.
- AO, tid, fakturor, bilagor, rondering och projektdokument har egna EF:er.
- `push_subscriptions` och fastighetsbilder är andra tabeller.
- Alla Edge Functions skriver som service_role och påverkas inte.

**Befintliga policyer** (som STAGING-facit):
- `store_active_write_safe` lät alla aktiva skriva nycklar utan affärsregel.
- `store_admin_write_protected` lät `app_users.is_admin` skriva roller, personal och inställningar, men det blockerades redan av `staging_generic_keys_no_direct_*`.

### 2. Serverändringar (vift-v2, `supabase/`)

| Fil | Innehåll |
|---|---|
| `migrations/20261128000004_t3c_roller_och_superadmin.sql` | Regelfunktionerna `_vift_rec_active`, `_vift_role_perms`, `_vift_identity_perms`, `_vift_superadmin_count`, `_vift_superadmin_lock`, `_vift_reg_bad_count`, `_vift_reg_get`, `_vift_perms_beyond`, `_vift_authz_check` (bara service_role). `store_business_key_write`, `store_business_key_merge_write`, `deactivate_vift_user`, `provision_vift_user` och `vift_store_full_access` med samma signatur. `vift_store_project` och `store_read_all_with_hashes_projected` med ny parameter `p_caller_staff_id` (default null, de gamla signaturerna borttagna). STOP-kontroll mot md5 för de sju ersatta funktionerna (STAGING-facit eller repokedjans version). |
| `migrations/20261128000005_t3c_direkt_rest_vitlista.sql` | Triggerfunktionen `_store_direct_write_guard`, triggern `protect_direct_write_allowlist`, policyerna `store_direct_write_allowlist_insert`/`_update`. STOP om de finns, eller om 0004 saknas. |
| `functions/store-key-write/index.ts` | `forbidden:<reason>` → 403 `{error:'forbidden', reason}`; `last_superadmin` → 409. `p_caller_staff_id` till projektionen. |
| `rollback/T3-C/rollback_t3c.sql` | Genererad av `tests/local/t3c-rollback.js` ur STAGING-facit. |
| `MIGRATIONSORDNING.txt`, `MIGRATIONSMAPPNING.md`, `migrationsmappning.json` | De två filerna, klass "ny", efter T3-B. |

**Regeln i `_vift_authz_check`** (anroparen utan `all`, i den här ordningen; superadmin hoppar till steg 5):
0. Anroparen omläst under låset: första aktiva personalposten med id:t (`p_actor_id` från EF), en aktiv app_users-rad för dess e-post, och rollens behörigheter. Annars, eller om `staff_manage`/`admin_manage` saknas, 403 `forbidden`. Nya element utan id eller med dubbla id ger 400 `invalid_element`.
1. **Egen roll:** rollbyte i den egna personalposten, eller ändrade behörigheter i den egna rollen → `privilege_escalation` (SEC-ROLL-01 förväntar `privilege_escalation` även för `role:'admin'`).
2. **Rollregistret:** en ändrad roll som har `all` före eller efter → `superadmin_required`. Tillagda behörigheter som anroparen saknar → `privilege_escalation`.
3. **Personalregistret:** poster där roll, e-post eller aktiv-status ändras, eller som läggs till eller tas bort. En post vars roll har `all` → `superadmin_required`. En post som blir aktiv med ny roll eller ny e-post och vars roll ligger utöver anroparens → `privilege_escalation`. Inaktivering och telefonändringar är tillåtna.
4. **Inloggade identiteter** (app_users.active → första aktiva personalpost med e-posten → roll; samma regel som `checkViftAuth`): ingen får vinna eller förlora `all` (`superadmin_required`) och ingen får behörighet utöver anroparens (`privilege_escalation`). Fångar e-postkapning och dubbla e-postadresser.
5. **Invarianten** (alla, även superadmin): ≥1 aktiv identitet med `all` före och 0 efter → 409 `last_superadmin`.

### 3. Klientändringar (VIFT-CRM)

- `AuthService`:
  - `isSuperadmin()` (behörigheten `all` i den egna rollen);
  - `rolePerms`, `canAssignRole`, `canManageStaffAuth`, `canEditRolePerms` (samma regler som servern).
- `PageShells`, personalsidan:
  - rollvalet visar bara tilldelningsbara roller;
  - egen roll, superadministratörer och poster vars roll inte syns (projektionen) är låsta med förklaring;
  - e-posten är låst när posten ligger utöver ens behörigheter;
  - Inaktivera/Aktivera visas bara när servern tillåter det och sparas med `commitElementChange` (serverbekräftat, tillbakarullning; punkt 247).
- `PageShells`, rolleditorn:
  - "Alla behörigheter" och behörigheter man saknar är spärrade (borttagning tillåten);
  - egen roll och roller med `all` är låsta;
  - roller med `all` har ingen Spara-knapp för icke-superadmin;
  - `toggleRoleActive`/`removeRole` stoppas med förklaring.
- `state.js`/`storage.js`:
  - `reason` följer med avslag;
  - `persistRefusalText` ger begripliga texter för `privilege_escalation`, `superadmin_required` och `last_superadmin` i `commitElementChange` och `confirmPersist`.
- `OperationsPage`: reserv för "fältpersonal" när rollen inte syns.
- `index.html`: `?v=` höjt för `storage.js`, `state.js`, `AuthService.js`, `PageShells.js` och `OperationsPage.js`.
- `tools/build-staging-package.sh`: efter T3-A:s sammanslagning gav trevägssammanslagningen av `storage.js` konflikt (STAGING:s publicerade fil har skrivtidsgränsen intill T3-A:s rad). Det fångades av vift-v2 `staging_e2e_real`. Nu används HEAD:s fil med exakt de två överläggsraderna `SUPABASE_URL`/`SUPABASE_AKEY`, kontrollerat (fler skillnader än två rader ger avbrott).

### 4. Fake-backend, paritet och PERM-03

- `tests/e2e/fake-backend.js` (båda repona, synkade):
  - `t3cAuthzCheck` (samma steg som `_vift_authz_check`);
  - projektion av registren i `readAllWithHashes`/`readWithHash` och REST GET;
  - REST-vitlistan (F18, DELETE nekas);
  - `vift_staff` kräver `staff_manage` som servern (tidigare räckte `admin_manage` i fake).
- Paritet (`vift-v2/tests/local/lib/paritet.js`, `VIFT-CRM/tests/sim_parity.test.js`): 31 nya scenarier, alla lika.
  - ROLL-02a–d, ROLL-03a–e, ROLL-04a–c, ROLL-07.
  - B3-03/03e/03c, B3-05/05c/05p/05r, B3-06, CUST-22/23.
  - KEY-02–04 (BLOCKER-2) och REST-01/01b/02/02b/02c (F18; ramverket kör nu även REST-scenarier).
  - ROLL-01 nekas nu i båda.
  - Totalt 85 scenarier: 83 lika och 2 kända (KEY-01, AUTH-02; oförändrade, utanför T3-C).
- **PERM-03 (BLOCKER-2) avblockerat:**
  - `tests/e2e/server-key-perms.js` läser `KEY_PERMISSIONS` direkt ur `vift-v2/supabase/functions/store-key-write/index.ts` (KÄLLA-1, via `tests/lib/serverkalla.js`).
  - PERM-03 kör i en värld med den tabellen och serverns egen `activities-policy.ts`.
  - Fält och ekonomi: sex direktanrop (offertpris, kund, annans uppgift, säljchans, hel skrivning av `vift_settings`, artikel) → exakt 403 `forbidden` utan `reason`, och kontrollsumman är oförändrad.
  - Arbetsledare: kund, offert och säljchans godtas; inställningar och artiklar nekas. Annans uppgift godtas, eftersom serverns TASK-01-regel ger `ao_edit` + `ao_view_all` full rätt.
  - Samma utfall i paritetsscenarierna KEY-02–04, mot den faktiska servern.
- Testerna T3C-01–07 (`tests/e2e/specs/38_t3c_roller.js`): personalsidan och rolleditorn för egna roller med bara `staff_manage` respektive bara `admin_manage`, sista superadmin, projektionen i webbläsaren, egen superadminroll med annat id och `admin` utan `all`, indragen behörighet i öppen flik, och F18 från klienten.

### 5. Tester (lokalt, PGHOST=/var/tmp/vift-localpg, PostgreSQL 16.15)

**vift-v2 `tests/run-all.sh` (SKIP_BROWSER=1): 28/28 testfiler gröna, 954 godkända kontroller, 0 fel.**
Webbläsartesterna i `browser/` hoppades över med SKIP_BROWSER=1, som i T3-0 och T3-B. De räknas inte som godkända. `staging_e2e_real` kör Playwright och ingår.

Nya:
- `t3c_roller` **145/0**:
  - SEC-ROLL-01–09 i vägarna E (writeMerge och hel skrivning) och P (RPC direkt);
  - SEC-B3-01/02/03/05/06 (R och E), SEC-REST-01–04, SEC-CUST-18/19/22/23;
  - egna roller (D-26: chef + staff_manage, chef − staff_view, adminhanterare, personalansvarig, tom, okänd roll);
  - e-postkapning, dubbla id, behörigheter lästa vid varje anrop (EF och RPC under låset);
  - deactivate/provision;
  - samtidighet: SEC-ROLL-05 ×50 (P) och ×50 (E), SEC-ROLL-06 ×50 (E) och ×50 (P), låsordning mot T3-B ×10;
  - affärsflöden: ny personal, rolländring, egen roll skapad och borttagen, inställningar.
- `t3c_rollback` **18/0**: installera → rollback (= STAGING + T3-B, ingen data ändrad, äldre kod fungerar) → installera; STOP vid omkörning; T3-C + T3-B i omvänd ordning = STAGING-facit.

Ändrade och gröna:
- `replica_build` 31/0 (5 nya migrationer; 48 registrerade T3-objekt varav 22 T3-C, policyer och triggers md5-kontrollerade);
- `ef_smoke` 39/0;
- `t3b_rollback` 12/0 (T3-B prövas för sig, kedjan utan T3-C);
- `migrationsmappning` 18/0;
- `migrationskedja` 2/0 (113 identiska, 53 förklarade, 0 oförklarade);
- `staging_e2e_real` 26/0 (efter rättningen av paketbyggaren).
- `baslinje_sakerhet` 38/0 (historisk källa fb71f26, oförändrad).

**VIFT-CRM `tests/run-all.sh`: 22/22 testfiler gröna** (21 Node-testfiler med 564 godkända kontroller och 0 fel, plus `browser/offer_total_parity.js` med 120 offerter och 0 avvikelser). Inga överhoppade.
- `sim_parity` 86/0 (85 scenarier, 83 lika, 2 kända);
- `staging_e2e_real` 26/0.

**E2E (Playwright mot den simulerade servern):**
- Riktad körning (AUTH, ADMIN, ROLE, STAFF, PERM, STG, TASK, ACT, ARP, REG, SR, SEC, K, ST, T3C, NOTIF, DASH, T3B): **76 godkända, 0 fel, 0 blockerade av 76**.
  - Under arbetet föll T3C-01/02/06 på testfel: modaler som stängs asynkront, och fel värld i T3C-06. De rättades i testet.
  - PERM-03: första körningen hade fel förväntan på arbetsledarens uppgift. Serverns `activities-policy.ts` ger full rätt, och testet följer nu servern.
- **Hela e2e-sviten en gång, efter alla ändringar: 243 godkända, 0 fel, 0 blockerade, 0 kända fel, av 243 (1 684 s).** Baslinjen efter T3-A+T3-B (68e9cac) var 235 godkända och 1 blockerad (PERM-03) av 236. Skillnaden är de 7 nya T3C-01–07 och PERM-03, som nu körs i stället för att vara blockerat.

Inga negativa tester har försvagats. PERM-03 har gått från blockerad till körd mot serverns faktiska regel.

### 6. Baslinjefynd, vända

`baslinje_sakerhet.test.js` körs fortfarande som historisk referens mot fb71f26. Där bevisas SÄK-8 och SÄK-13. Vända i `t3c_roller.test.js`:

| Baslinje (T3-0) | Godkänt säkerhetstest (T3-C) |
|---|---|
| SÄK-8: personalansvarig ger sig själv `admin` (writeMerge) och får sedan alla AO | SEC-ROLL-01 (E, P, hel skrivning) 403 `privilege_escalation`, KS (vift_staff, vift_roles, app_users) oförändrad; personalansvarig ser fortfarande inga AO |
| SÄK-8: den enda superadministratören tar bort sin egen `all` | SEC-ROLL-04 409 `last_superadmin` (inaktivera, byta roll, byta e-post, ta bort `all`, radera rollen, hel skrivning, `deactivate_vift_user`, RPC) |
| SÄK-13: begränsad skapar och raderar okänd nyckel och skriver `vift_lastChanged` | SEC-REST-02: skapa/uppdatera/radera okänd nyckel 403 42501 `direct_write_blocked`; `vift_lastChanged` får bara servervärde, radering nekas |

Kvar som baslinjefynd: SÄK-2 (T3-D) och GRANTS utan R-E.

### 7. SÄK och D efter T3-C

- **Lokalt åtgärdade:**
  - SÄK-8 (F5), SÄK-13 (F18);
  - D-25, D-21 (rollregistret), Ö5, Ö6/BLOCKER-2 (PERM-03 lokalt);
  - punkt 247 (personalens Inaktivera).
- **Delvis:**
  - D-14: andras `role`/`permissions`. Kvar till T3-D/T4-A: urval av kontaktuppgifter per AO (SEC-B3-04) och skyddade personaluppgifter (`hourlyRate` m.m.).
  - Punkt 243: STAGING-delen (märkta poster) återstår.
- **Öppna:** SÄK-1, -2, -6, -7, -9 (installation), -10 (installation), -14.

### 8. Installationsplan och rollback (STAGING-paketet T3-C, beskrivs, körs inte)

**Förutsättningar:**
- separat GO;
- T3-A och T3-B installerade först (ordningen i `MIGRATIONSORDNING.txt`; klientpaketet bygger på HEAD med T3-A+T3-B+T3-C).

**Backup** (testplanen §8 + T3-C):
- backupschemat för `store`, `op_idempotency` och `function_definitions` (`supabase/manual/staging_backup_och_kontroll_2026-11-24.sql`); **lägg till** de sju ersatta funktionerna, `pg_policies` för `store` och `pg_trigger` för `store`;
- JSON-kopia av `vift_staff` och `vift_roles` med sha256, och export av `app_users` (user_id, active, is_admin) med md5;
- extern kopia verifierad (`tools/staging-backup-export.js --provata-lokalt`);
- EF-backup av `store-key-write`.

| Steg | Innehåll |
|---|---|
| 1. Läsande förkontroll | `schema_migrations` = `migrationsmappning.json` + T3-B. md5 av `pg_get_functiondef` för de sju funktionerna = STOP-värdena. Läsande räkning av aktiva användare med `all` (samma SQL som `_vift_superadmin_count`, som SELECT): ska vara ≥1, annars stoppa och utred. Inga dubbla id i `vift_staff`/`vift_roles` (befintliga dubbletter blockerar inget, men noteras). |
| 2. Databas | `20261128000004`, sedan `…05`, var och en i egen transaktion. Ingen `db push`, ingen `migration repair`. |
| 3. Edge Function, direkt efter steg 2 | `store-key-write` (med `_shared/vift-auth.ts` och T3-B:s `stamp-status.ts`). |
| 4. Klient | `tools/build-staging-package.sh` från HEAD, publiceras på STAGING. `?v=` är höjt. Service Worker är network-first, så nya filer hämtas vid nästa laddning. |
| 5. Storage | Ingen ändring. |
| 6. Efterkontroll (läsande, V3 i testplanen) | md5 av de nya funktionerna, policyerna och triggern = `tests/local/t3-andringar.json`. SEC-B3-03/05 (projektion) med läsande anrop som fält, ekonomi och arbetsledare. SEC-REST-03 (`has_function_privilege`). Inga skrivningar i roll- eller personalregistret i STAGING; invarianten verifieras bara lokalt. |

**Fönstret mellan steg 2 och 3** (gammal `store-key-write` mot ny databas):
- Läsningar anropar projektionen utan identitet, och övergångsvägen gäller: rollregistret oförändrat och `permissions` borttaget ur personalregistret. Inloggning och behörigheter fungerar.
- Eskaleringsförsök nekas av RPC:n men visas som 403 `forbidden` utan `reason`.
- `last_superadmin` blir 500 `write_failed`. Klienten behåller ändringen som osäker; den skickas inte som lyckad.
- Fönstret ska vara minuter.

**v3.4-klient (Service Worker-cache) mot ny server, tills sidan laddats om:**

| Åtgärd i v3.4 | Ny server svarar | Följd |
|---|---|---|
| Inloggning, `Auth.can`, meny | Projicerat register med egen roll | Fungerar; ingen felaktig åtkomst |
| Personalsidan/AO-personaldialogen (icke-admin) | Andras `role` saknas (utan `staff_view`) och roller utan `admin_manage` | Rollmärken visar roll-id eller tomt; inga beslut påverkas |
| Dagens drift (arbetsledare, ekonomi) | Rollregistret projicerat | Listan "lediga" kan bli tom i v3.4 (reserven finns bara i ny klient) |
| Eskalering via personal-/rolleditorn | 403 `forbidden` + `reason` | v3.4 rullar tillbaka och visar "Servern avvisade ändringen — försök igen" (generiskt, ingen ändring) |
| Sista superadmin | 409 `last_superadmin` | v3.4 klassar 409 som avslag, rullar tillbaka och visar generiskt fel |
| Personal Inaktivera (v3.4: `persist()` utan bekräftelse) | 403/409 | v3.4 visar först "inaktiverad", sedan skyddsnätets varning "kunde inte sparas"; servern oförändrad och nästa synk återställer |
| Notiser (`persistNotifs`) | 201 (vitlistan; `vift_lastChanged` får servervärde) | Oförändrat |
| Annan direkt REST-skrivning | – (v3.4 gör ingen) | – |

**Rollback** (ingen data skrivs över):
1. Föregående `store-key-write` ur EF-backupen, **först**. Den gamla EF:en fungerar mot den nya databasen (default-parametern).
2. `supabase/rollback/T3-C/rollback_t3c.sql`:
   - tar bort vitlistan;
   - återställer de sju funktionerna **exakt** till STAGING-definitionerna med samma rättigheter;
   - återskapar de gamla signaturerna;
   - tar bort T3-C:s nya funktioner;
   - rör ingen tabell och ingen rad.
3. Föregående klientpaket.
4. Vid behov därefter T3-B-rollbacken (omvänd ordning, prövat lokalt).

Data som skapats efter installationen ligger kvar och är giltig för den äldre koden: personal- och rolländringar, inaktiveringar, notiser och `vift_lastChanged`-värden (`t3c_rollback.test.js`). JSON-kopian av registren återläses bara vid ett separat beslut om ett datafel, aldrig automatiskt.

### 9. Kontrollpunkter (BESLUT-2026-11-28)

| Kontrollpunkt | Uppfylld | Belägg |
|---|---|---|
| Obligatoriska tester godkända | Ja | §5 (`roles_superadmin` = `t3c_roller`, inklusive 50 upprepningar av SEC-ROLL-05/06) |
| Negativa tester ger rätt felkod och ingen mutation | Ja | `expectReject` (status, error, reason, KS för vift_staff, vift_roles, app_users) i alla negativa EF-fall; RPC-fall med felmeddelande och KS; e2e med kontrollsumma. Undantag, dokumenterat: REST UPDATE/DELETE av rader som RLS döljer ger 0 rader (PostgreSQL), med oförändrad KS |
| Inga nya oförklarade säkerhetsavvikelser | Ja | Paritet 83/85 lika, 2 kända utanför T3-C; schemat 0 oförklarade (22 T3-C-objekt md5-registrerade) |
| Samtidighetskritiska kontroller under transaktionslås | Ja | Eskalering och invariant under det gemensamma låset i RPC:n, med omläsning av anroparen; deactivate/provision under samma lås; fast låsordning utan cykel mot T3-B |
| Berörda affärsflöden fungerar | Ja | Personal- och rollhantering för superadmin, notiser, alla EF-skrivvägar oförändrade; vift-v2 och VIFT-CRM run-all gröna; e2e |
| Avgränsade commits och rollback | Ja | Två commits per repo plus dokument och e2e-rapport; rollback prövad lokalt |
| Masterplanen visar faktisk nivå | Ja | SÄK-8, SÄK-13, D-21, D-25, Ö5, Ö6, punkt 21, 243, 247: "Lokalt verifierad" eller "Delvis" |

### 10. Kända begränsningar och beslut som behövs

**Begränsningar:**
- PG16 och Node i stället för PG17 och Deno (releasevillkor).
- Direkta SQL-ändringar av `app_users` eller registren som `postgres`/service_role (SQL Editor) går förbi kontrollen. Bara RPC:erna och EF:en kontrolleras. Rekommendation: använd alltid `deactivate_vift_user`/`provision_vift_user`.
- REST UPDATE/DELETE av rader som befintliga RESTRICTIVE-policyer döljer ger 0 rader i stället för 42501. Upsert, som klienten använder, ger alltid 42501.
- Rollens `active` påverkar inte behörigheterna i servern (som tidigare, samma som `checkViftAuth`).
- Notiser: vem som helst aktiv kan lägga till en notis åt vem som helst (befintligt innehållsskydd; T3-D/T4).
- Övergångsvägen i `vift_store_project` (null-identitet) finns kvar för det äldre EF-fönstret och tas bort i en senare städning.
- vift-v2:s äldre klientkopia och VIFT-CRM:s kopior av STAGING-verktygen är inte anpassade. Inga nya STAGING-läsverktyg för V3 är byggda; efterkontrollen beskrivs i §8.

**Beslut som behövs (förslag i parentes; det mest restriktiva valet som inte bryter ett flöde är genomfört):**
1. `vift_lastChanged` står kvar på REST-vitlistan, men med servervärde. Matrisen sa "nekas". Att neka den skulle bryta notiserna för v3.4 och nuvarande klient, eftersom raden skickas i samma upsert. (Godta nu. Ge `persistNotifs` en EF-väg, eller låt triggern `store_bump_lastchanged` även gälla `vift_notifications`, och ta bort raden ur vitlistan när ingen v3.4 finns kvar.)
2. Utan `all` får man inte ändra sin egen roll alls, varken byta roll eller ändra den egna rollens behörigheter, inte heller sänka dem. (Godta.)
3. En roll med `staff_manage` kan bara tilldela roller inom sina egna behörigheter och kan inte återaktivera personer med bredare roll. En ren personalansvarig kan alltså inte skapa fältpersonal. (Godta; personalansvariga som ska tilldela fältroller behöver de behörigheterna eller superadmin.)
4. I klienten är personalposter vars roll inte syns för den inloggade, alltså utan `admin_manage`, låsta för roll, e-post och status, trots att servern tillåter vissa ändringar, till exempel inaktivering. (Godta; restriktivt, servern avgör ändå.)
5. `staff_manage` får, utöver den egna rollen, de roller den får tilldela ur `vift_roles`, för att personalformuläret ska fungera. Det är en avvikelse från "bara egen roll" för användare utan `admin_manage`. (Godta.)
6. Arbetsledare (`ao_edit` + `ao_view_all`) får ändra andras uppgifter enligt serverns befintliga TASK-01-regel. Hör till D-15/T3-D. (Avgörs i T3-D.)

### Ändrade filer

**vift-v2** (gren `claude/vift-system-restructure-8fUme`):
- nya:
  - `supabase/migrations/20261128000004_t3c_roller_och_superadmin.sql`, `…05_t3c_direkt_rest_vitlista.sql`;
  - `supabase/rollback/T3-C/rollback_t3c.sql`;
  - `tests/t3c_roller.test.js`, `tests/t3c_rollback.test.js`, `tests/local/t3c-rollback.js`;
- ändrade:
  - `supabase/MIGRATIONSORDNING.txt`, `MIGRATIONSMAPPNING.md`, `migrationsmappning.json`, `functions/store-key-write/index.ts`;
  - `tests/{replica_build,ef_smoke,t3b_rollback}.test.js`, `tests/local/{jamfor-schema.js, t3-andringar.js, t3-andringar.json, lib/paritet.js}`, `tests/e2e/fake-backend.js`.

**VIFT-CRM** (gren `claude/vift-v3-major-redesign`):
- ändrade:
  - `index.html`, `src/data/{state,storage}.js`, `src/services/AuthService.js`, `src/pages/{PageShells,OperationsPage}.js`;
  - `tools/build-staging-package.sh`;
  - `tests/e2e/fake-backend.js`, `tests/e2e/paritet-kanda-avvikelser.json`, `tests/e2e/specs/14_permissions.js`;
  - detta dokument, `docs/MASTERPLAN.md`, `docs/qa-2026-11-26/BEHORIGHETSMATRIS.md`;
- nya: `tests/e2e/server-key-perms.js`, `tests/e2e/specs/38_t3c_roller.js`.

### Commits

**vift-v2** (`claude/vift-system-restructure-8fUme`, inte pushad):
- `c4a9dbb` T3-C server: roller och superadmin (SÄK-8, D-25), projektion av roll- och personalregistret (D-21, D-14) och vitlista för direkt REST-skrivning (F18/SÄK-13)
- `f0e7e44` T3-C tester: säkerhetstester (vända baslinjefynd SÄK-8/SÄK-13), samtidighet SEC-ROLL-05/06 ×50, rollback, T3-facit, paritet och fake-backend

**VIFT-CRM** (`claude/vift-v3-major-redesign`, inte pushad):
- `4bef83c` T3-C klient: rolleditorn och personalsidan erbjuder bara serverns tillåtna val, begripliga felkoder, projicerat rollregister
- `7310411` T3-C tester: fake-backend följer T3-C-reglerna (paritet), PERM-03 avblockerat mot serverns KEY_PERMISSIONS, nya T3C-01–07, paketbyggaren klarar storage.js efter T3-A
- dokumentcommit och e2e-rapport: se `git log` efter `7310411`

## T3-D – informationsåtkomst

Verifieringsnivå: **lokalt verifierad** (PostgreSQL 16.15, Edge Functions körda i Node mot den
lokala STAGING-replikan, webbläsartester mot den simulerade servern). Ingenting är installerat
eller verifierat i STAGING. LIVE är inte kontaktad. Inga läsningar mot STAGING behövdes.

### Sammanfattning

| Del | Resultat |
|---|---|
| Urval per post (SÄK-2, B4, Ö7, D-12–D-15) | `vift_store_project` (samma signatur som T3-C) väljer per post för roller utan full åtkomst: aktivitetslogg, uppgifter, offertreferenser, kunder, fastigheter, objekt, kontakter och personalens kontaktuppgifter. AO-synligheten är **T3-B:s poolregel**, nu också som SQL-funktion (`_vift_ao_visible` = `canViewWorkOrder`, byggd på T3-B:s `_vift_has`/`_vift_ao_assigned`/`_vift_ao_eff_perms`/`_vift_ao_open_pool`); innehåll kräver dessutom tilldelning eller `ao_view_all` (`_vift_ao_content_visible` = `canViewWorkOrderContent`), så öppen pool ger ingen historik, inga kunder och inga kontakter (Q3, K-03). Ingen ny parallell regel. |
| Alla vägar | REST: RLS `store_read_by_role` (via `vift_store_full_access`) ger tom lista för roller utan full åtkomst. EF: `readAllWithHashes`, `readWithHash`, **och svaren från `writeMerge`** (`current` och konflikternas `serverValue`) och `invoice-write` (`activityLog`) projiceras. `work-orders-list` oförändrad (T3-B). Klientens tillstånd, lokala cache och export bygger på serverns svar och innehåller därför bara urvalet (e2e T3D-01/03). |
| `appendActivity` (D-22, F11) | `activity_log_append` får ny signatur med anroparens id och behörigheter. Typ per behörighet → 403 `forbidden`/`type_not_allowed`; varje referens mot det anroparen får se → 403 `forbidden`/`ref_not_visible`, kontrollerat i RPC:n med AO-raden under `FOR SHARE`. Servern sätter aktör och tid och märker posten `klientrapport`. Append-only som tidigare (403 `append_only`; REST nekas av F18-vitlistan). |
| Uppgifter (D-15, F8, T3-C:s beslut 6) | TASK-01-regeln granskad: arbetsledare = `ao_edit` + `ao_view_all` (eller `admin_manage`) får ändra andras; `ao_view_all` ensamt räcker inte. Det är exakt D-15 och matrisens R47 (SEC-TASK-06, SEC-CUST-21), så regeln behålls. Avslag ger nu orsak (`not_own`, `field_<fält>`). Klienten (Uppgifter-sidan, dashboarden, offertens och AO:ns uppföljningar) följer samma regel. |
| Känsliga fält (K-04, K-05, D-05) | Portkoder och nyckelinformation (`doorCode`, `keyInformation`, `accessInformation`, `keyReceipt`, `alarmInformation`, `accessCode`, `keyInfo`) lämnas aldrig ut via projektionen till roller utan `objects_sensitive` — nu även fastigheternas och kundernas fält, som tidigare läckte till alla (fastigheter) respektive till kundregistrets läsare (kunder). `inv.note` når inte roller utan fakturaläsning. Ingen datamigrering. |
| Ingen breddning | För alla 13 aktiva syntetiska användare (5 standardroller, 6 egna roller, okänd roll, egen faktureringsroll) och varje nyckel/svar är utlämningen efter T3-D en delmängd av utlämningen med T3-C-koden (`f0e7e44`, utläst med `git archive`) på samma data. |
| Paritet (SEC-SIM-01) | Fake-backend följer T3-D-reglerna (båda repona). 141 scenarier: 139 lika, 2 kända (KEY-01, AUTH-02, oförändrade, utanför T3). 56 nya T3-D-scenarier, alla lika, inklusive REST-läsning (ramverket kör nu även GET). |
| Rollback | `supabase/rollback/T3-D/rollback_t3d.sql` (genererad ur kedjan utan T3-D). Installera → rollback → installera prövat lokalt, och T3-D + T3-C + T3-B i omvänd ordning = exakt STAGING-facit. Ingen data ändras. |

### 1. Inventering före ändringen

**Klientens läsningar** (nuvarande klient och v3.4, `git grep`):
- Affärsnycklarna läses bara via `Storage.getAllWithHashes` → `store-key-write` `readAllWithHashes` (`initState`, `DataSync._poll`, `Auth.refreshAuthorization`) och `readWithHash` (konflikt/omsynk). `Storage.getAll` (REST) anropas inte; direkt REST-läsning används bara för `vift_lastChanged`, `vift_notifications` och `vift_ronderingspass`.
- `writeMerge`-svarets `current` blir klientens nya tillstånd och baslinje (`state.js` `_doPersist`): **en EF-väg som lämnade ut hela registret** (t.ex. alla uppgifter till en fältanvändare som klarmarkerat sin egen). Projiceras nu.
- `invoice-write` (`setStatus`, `draftDelete`) returnerar hela `activityLog`, som `InvoiceService._applyActivityLog` lägger i tillståndet. Projiceras nu (`approveStaleOverride` kräver `admin_manage` = full åtkomst).
- `work-order-checklist-resolve` returnerar inte längre loggen (protokoll 2, T3-B).
- Uppgifter: `ActivitiesPage` (`_canEditTask` = `ao_edit` ∨ `ao_view_all` ∨ tilldelad — avvek från servern, F8), dashboardens widgetar "Aktiviteter & uppföljningar" och "Mina uppgifter", offertens uppföljningsdialog och AO:ns uppföljning. AO-koppling uttrycks som `relatedType:'workOrder'` + `relatedId` (äldre poster kan ha `workOrderId`; båda stöds).
- Aktivitetslogg: dashboardens "Senaste händelser" (`getRecent`) och AO-detaljens tidslinje (`getByWorkOrder`, statushändelser).
- `ActivitiesService.create` använde `newId` (högsta + 1 i den lokala listan). Med urval per post kan det krocka med en dold uppgifts id → konflikt i stället för ny uppgift. Byts till `newSafeId` (samma som AO och tidposter).
- `initState` har en heuristik som behandlar "kunder och offerter tomma samtidigt" som en degraderad läsning (blockerar skrivningar) om personalen liknar demodata. Med urval per post är tomma listor ett äkta svar för fält; heuristiken gäller nu bara den som får läsa hela kundregistret.
- `staff[].hourlyRate`, `personnr`, `username` för andra än en själv används inte av klienten (bara personalsidan, `staff_manage`).

**Klientens skrivningar av aktivitetslogg** (`ActivityService.log`, 40 anropsplatser): typerna och behörigheterna ligger i tabellen i §2. Fältets typer: `work_order_status`, `work_order_assigned`, `material_added`/`_removed`, `time_entry_created` — alla med `workOrderId` för egen AO.

### 2. Serverändringar (vift-v2, `supabase/`)

| Fil | Innehåll |
|---|---|
| `migrations/20261128000006_t3d_urval_per_post.sql` | Regelfunktionerna `_vift_ao_visible`, `_vift_ao_content_visible`, `_vift_post_refs`, `_vift_kund_las`, `_vift_staff_external`, `_vift_task_ao`, `_vift_activity_ao_type` (bara service_role). `vift_store_full_access` och `vift_store_project` med **samma signatur**. STOP-kontroll: T3-B och T3-C installerade, md5 för de två ersatta funktionerna = T3-C-versionen, andra körning stoppas. |
| `migrations/20261128000007_t3d_aktivitetslogg.sql` | `_vift_activity_type_perms`, `_vift_ref_visible`; `activity_log_append` med **ny signatur** (`p_caller_staff_id`, `p_caller_perms`), den gamla 2-argumentsversionen tas bort. STOP: md5 = STAGING-versionen, 0006 installerad, andra körning stoppas. |
| `functions/store-key-write/index.ts` | `appendActivity` skickar id och behörigheter och mappar `forbidden:<reason>` → 403; typen prövas först i EF:en (`typeAllowed`). `writeMerge` för `vift_activities`: avslagsorsak ur `activitiesRefusal`. Svaret från `writeMerge` projiceras (`projectWriteResult`). |
| `functions/store-key-write/activity-log.ts` | `TYPE_PERMS`/`typeAllowed` (speglar `_vift_activity_type_perms`; testet jämför dem för alla 37 typer). |
| `functions/store-key-write/activities-policy.ts` | `activitiesRefusal`: `new_not_own`/`assign_other`/`remove_not_own`/`not_own` → `not_own`; `field_*`, `immutable_*`, `completed_by_other` behålls. |
| `functions/invoice-write/index.ts` | `activityLog` i svaren projiceras (`projectActivityLog`). |
| `rollback/T3-D/rollback_t3d.sql` | Genererad av `tests/local/t3d-rollback.js`. |
| `MIGRATIONSORDNING.txt`, `MIGRATIONSMAPPNING.md`, `migrationsmappning.json` | De två filerna, klass "ny", efter T3-C (repo-filer: 37 installerade, 7 nya). |

**Urvalet per nyckel** (roller utan full åtkomst; full åtkomst = skrivrätten enligt `KEY_PERMISSIONS`, `all` eller tabellen):

| Nyckel | Full åtkomst (hela värdet, REST läsbar) | Övriga |
|---|---|---|
| `vift_activityLog` | `ao_view_all`, `admin_manage` | AO-händelser (`work_order_*`, `staff_assigned`, `material_*`, `time_entry_created`, `note`) med `workOrderId` för AO som anroparen ser med innehåll; inga poster med offert-, faktura- eller säljreferens |
| `vift_activities` | `admin_manage`, eller `ao_edit` + `ao_view_all` | Skapade av eller tilldelade anroparen, och uppgifter kopplade till AO där anroparen är **tilldelad** |
| `vift_offers` | `offer_manage` | Interna roller (C-5:s lista): alla, utan token/interna fält (oförändrat). Övriga: offerter kopplade till AO som anroparen ser med innehåll, fälten id, titel, status, workOrderId |
| `vift_customers` | `customer_manage`, eller kundregistrets läsare (C-5) **med** `objects_sensitive` | Kundregistrets läsare (C-5): alla, utan portkod/nyckelinformation (personnummer kvar, som tidigare). Roller som skapar AO/återkommande/rapporter: alla utan personnummer och portkod. Övriga: kunder för AO som anroparen ser med innehåll |
| `vift_properties` | `customer_manage`, eller kundregistrets läsare med `objects_sensitive` | Som kunder (utan `accessCode`/`keyInfo`) |
| `vift_propertyObjects` | `customer_manage`, `objects_sensitive` | Som kunder (utan de sju skyddade fälten) |
| `vift_propertyContacts` | `customer_manage`, kundregistrets läsare | Kontakter för AO:ns fastighet (fastighetsnivå eller AO:ns objekt) |
| `vift_staff` | `staff_manage`, `admin_manage` (T3-C) | Egen post oförändrad. Andra: id, namn, titel, aktiv, färg/initialer; `role` med `staff_view`; arbetstelefon/arbets-e-post för interna. Externa (bara D-04:s tilläggsbehörigheter) ser bara personal på egna AO, utan kontaktuppgifter |

Utan identitet (bara en store-key-write äldre än T3-C) ger de nya per-post-nycklarna tom lista; T3-C:s övergångsväg för personal och roller finns kvar.

**Typer per behörighet** (`_vift_activity_type_perms`, någon av; `all` får alla):

| Typer | Kräver |
|---|---|
| `work_order_status`, `work_order_updated`, `work_order_assigned`, `material_added`, `material_removed`, `time_entry_created`, `note` | `ao_view_own` eller `ao_view_all` |
| `work_order_created` | `ao_create` |
| `staff_assigned`, `work_order_archived/restored/deleted/permanent_delete` | `ao_edit` |
| `invoice_created`, `invoice_stale_override_approved` | `invoice_create` |
| `customer_*`, `property_object_*`, `contract_created`, `project_created` | `customer_manage` |
| `offer_created`, `offer_sent`, `offer_status` | `offer_manage` |
| `sales_opportunity_won/lost` | `sales_manage` |
| `recurring_order_created` | `recurring_manage` |
| `rondering_*`, `point_ok`, `point_ej_aktuell`, `deviation_*`, `ao_from_deviation` | `ao_view_all` (rondering är `ao_view_all`-styrd tills T4-D) |

**Referenser** (`_vift_ref_visible`): `workOrderId` — `ao_view_all` (även en AO som ännu inte nått servern) eller AO som anroparen ser med innehåll (inte öppen pool, inte arkiverad/borttagen); `customerId`/`propertyId` — kundregistrets läsare eller urvalet; `offerId` — interna offertroller eller urvalet; `invoiceId`, `salesOpportunityId`, `inspectionId`, `ronderingId`, `deviationId` — full åtkomst till respektive nyckel.

**Låsordning:** `activity_log_append` tar `vift_workOrders` (FOR SHARE) → `vift_activityLog` (FOR UPDATE) → `vift_lastChanged`, samma ordning som fakturavägarna (fakturor → AO → logg). Ingen väg tar loggen före AO. T3-C:s lås rörs inte.

### 3. Klientändringar (VIFT-CRM)

- `ActivitiesService`: `canManageAll`, `canEdit`, `canComplete`, `canDelete`, `assignableStaff` (serverns regel); `create` med `newSafeId`.
- `PageShells`: Uppgifter-sidan använder regeln (redigera = full rätt eller egen; klarmarkera = full rätt eller tilldelad; ta bort = full rätt eller egen); ansvarigväljaren och offertens uppföljningsdialog erbjuder bara en själv utan full rätt; `_save` stoppar annat med begripligt besked.
- `Dashboard`: Klar-knappen i "Aktiviteter & uppföljningar" bara där servern tillåter; "Senaste händelser" märkt "Rapporterade av användarna — inte en revisionslogg" (D-22, SEC-B4-07).
- `WorkOrderDetailPage`: tidslinjens poster ur aktivitetsloggen märkta "klientrapport".
- `state.js`: heuristiken för degraderad läsning gäller bara den som får läsa hela kundregistret.
- `index.html`: `?v=` höjt för `state.js`, `ActivitiesService.js`, `Dashboard.js`, `WorkOrderDetailPage.js`, `PageShells.js`. Ingen redesign.

### 4. Fake-backend och paritet

- `tests/e2e/fake-backend.js` (båda repona, synkade): `t3dFull` (= `vift_store_full_access` för de projicerade nycklarna), `t3dRefs` (= `_vift_post_refs`), `t3dProject` (= `vift_store_project` för personal, roller, logg, uppgifter, offerter, kunder, fastigheter, objekt, kontakter), REST GET döljer samma nycklar, `appendActivity` med typ och referenser, uppgiftsavslag med orsak, projicerade `writeMerge`- och `invoice-write`-svar. Serverns `KEY_PERMISSIONS`, `typeAllowed`, `activitiesWriteAllowed` och `activitiesRefusal` läses ur källan.
- `vift-v2/tests/local/lib/paritet.js`: 56 nya scenarier i T3-D-världen (`lib/t3d-data.js`, samma data för replik och fake): B4/TASK/KUND/B3 per roll (fält, FÄ2, begränsad, ekonomi, arbetsledare, säljare, tom), OFF, B4-04/05/06, TASK-01..06 och radering, REST-läsning (fält, ekonomi) för sex nycklar. Ramverket har nu `varld` (gemensam testvärld) och `restLas` (GET).
- `VIFT-CRM/tests/sim_parity.test.js` 142/0 (141 scenarier, 139 lika, 2 kända); ny `vift-v2/tests/paritet_fake_kopia.test.js` 142/0 för vift-v2:s kopia.
- C-5-projektionen av övriga nycklar (inställningar, fakturor, återkommande m.fl.) är fortfarande inte modellerad i fake (känd begränsning sedan T3-0, inget T3-D-scenario berörs).

### 5. Tester (lokalt, PGHOST=/var/tmp/vift-localpg, PostgreSQL 16.15)

**vift-v2 `tests/run-all.sh` (SKIP_BROWSER=1): 31/31 testfiler gröna, 1 227 godkända kontroller, 0 fel.**
Webbläsartesterna i `browser/` hoppades över med SKIP_BROWSER=1, som i T3-0–T3-C. De räknas inte som godkända. `staging_e2e_real` kör Playwright och ingår.

Nya:
- `t3d_informationsatkomst` **111/0** (testgruppen `projection_per_post`):
  - baslinjefynden SÄK-2 vända (E och R);
  - exakt urval av id i sju nycklar för 13 användare: admin, arbetsledare, ekonomi, fält, FÄ2, begränsad och egna roller (chef_utan_faktura, säljare, faktureringsroll, adminhanterare, personalansvarig, tom, okänd roll), plus `readWithHash`;
  - exakta fält: offertreferens, kund/fastighet/objekt utan portkod och personnummer, personal (SEC-B3-01..04, R40);
  - SEC-B4-01/02/03, Q3 (öppen pool), egen arkiverad AO, `work-orders-list` oförändrad;
  - REST (R) per roll för nio nycklar;
  - ingen breddning mot T3-C-koden (`f0e7e44`) för alla användare och nycklar, och `work-orders-list` identisk;
  - känsliga fält (K-04, K-05) i alla svar per roll, `property_sensitive_access` stängd för REST;
  - `appendActivity`: 18 negativa fall med exakt felkod och KS (typ, AO, öppen pool, tilldelad pool, arkiverad, påhittad, annans kund/offert/faktura/säljchans, begränsad, ogiltig typ/referens), 8 positiva, servern sätter aktör och tid, idempotens, append-only (E, R), RPC-kontrollerna direkt (P), TS-tabellen = SQL-tabellen för alla 37 typer;
  - samtidighet: append under en pågående omfördelning ×20 → alltid `ref_not_visible`, ingen mutation;
  - uppgifter SEC-TASK-01..06, SEC-CUST-21, egna roller, projicerat `writeMerge`-svar och dold konflikt;
  - `invoice-write`: projicerad logg för egen faktureringsroll, hel logg för arbetsledare;
  - grants: inga nya funktioner för anon/authenticated.
- `t3d_rollback` **18/0**: installera → rollback (= STAGING + T3-B + T3-C, ingen data ändrad, äldre kod fungerar) → installera; STOP vid omkörning; T3-D + T3-C + T3-B i omvänd ordning = STAGING-facit.
- `paritet_fake_kopia` **142/0**: vift-v2:s kopia av fake-backend, 141 scenarier, 139 lika, 2 kända.

Ändrade och gröna:
- `replica_build` 32/0 (7 nya migrationer; 59 registrerade T3-objekt varav 13 T3-D, 2 av dem ändrade även av T3-C);
- `t3c_rollback` 19/0 (kedjan utan T3-D; efter ny installation även T3-D; omvänd ordning T3-D + T3-C + T3-B);
- `t3b_rollback` 12/0 (kedjan utan T3-C och T3-D);
- `ef_smoke` 39/0 (fältets kunder = kunderna för egna AO, D-13 — avsiktlig ändring, inte försvagad);
- `migrationsmappning` 18/0, `migrationskedja` 2/0 (112 identiska, 64 förklarade, 0 oförklarade);
- `t3c_roller` 145/0 och `t3b_ao_karna` 171/0 oförändrade;
- `baslinje_sakerhet` 38/0 (historisk källa fb71f26, oförändrad).

**VIFT-CRM `tests/run-all.sh`: 22/22 testfiler gröna** (21 Node-testfiler med 620 godkända kontroller och 0 fel, plus `browser/offer_total_parity.js` med 120 offerter och 0 avvikelser). Inga överhoppade.
- `sim_parity` 142/0 (141 scenarier, 139 lika, 2 kända);
- `staging_e2e_real` 26/0.

**E2E (Playwright mot den simulerade servern):**
- Nya T3D-01–04 (`tests/e2e/specs/39_t3d_informationsatkomst.js`): 4/0.
- Riktad körning (ACT, DASH, FALT, AOD, TASK, PERM, STG, LOG, AUTH, K, SEC, T3B, T3C, SYNC, MYJOBS, REG, CUS, PROP, OBJ, POBJ, OFF, NOTIF, TIME, CHK, SW): **115 godkända, 3 fel av 118**. De tre felen (PERM-03, TASK-02, REG-UI-07) läste annans uppgift eller offert ur fältets klienttillstånd för att göra ett direktanrop; T3-D lämnar inte längre ut dem. Testerna använder nu serverns faktiska post (som en angripare som känner värdet), så nekandet prövas lika hårt, och de kontrollerar dessutom att posten **inte** når klienten. PERM-03 förväntar nu `reason: 'not_own'` för annans uppgift (felkodskatalogen); övriga nycklar fortfarande 403 utan reason. Efter ändringen: 3/0.
- **Hela e2e-sviten en gång, efter alla ändringar: 247 godkända, 0 fel, 0 blockerade, 0 kända fel, av 247 (1 698 s).** Baslinjen efter T3-C var 243 av 243; skillnaden är de 4 nya T3D-01–04.

Inga negativa tester har försvagats.

### 6. Baslinjefynd, vända

`baslinje_sakerhet.test.js` körs oförändrad som historisk referens mot fb71f26 (38/0, SÄK-2 bevisas där). Vända i `t3d_informationsatkomst.test.js`:

| Baslinje (T3-0) | Godkänt säkerhetstest (T3-D) |
|---|---|
| SÄK-2: readAllWithHashes ger fält andras uppgifter (TASK-R2, TASK-R3) | SEC-TASK-04 (E): inga av TASK-R2/R3/D3/D4; exakt urval per roll |
| SÄK-2: readAllWithHashes ger fält hela aktivitetsloggen (LOG-R2 om AO-A8) | SEC-B4-02/03 (E): bara AO-händelser för egna AO; Q3 öppen pool ingen logg |
| SÄK-2: REST: fält läser `vift_activities` med alla poster | SEC-TASK-04/SEC-B4-02 (R): tom lista |
| Observation T3-0: `vift_staff` med telefon och `hourlyRate` till fält | SEC-B3-01/04: bara namn, titel, arbetskontakt; externa bara namn och titel för personal på egna AO |

Kvar som baslinjefynd: GRANTS utan R-E (R-E finns i repot).

### 7. SÄK och D efter T3-D

- **Lokalt åtgärdade:** SÄK-2 (O2), F8, F9, F11; B3, B4, Ö7; D-12, D-14, D-15, D-22; SÄK-17 för T3-D:s resurser; K-04/K-05 i store-projektionen och EF-svaren (export i T4-F).
- **Delvis:** D-13 (urval per uppdrag klart; `personal_data_view` för personnummer är T4-A, SEC-KUND-03..06); SÄK-7 (portkoder bort för alla läsare utan `objects_sensitive`; skrivaren `customer_manage` utan `objects_sensitive` får dem fortfarande — kräver fältvis sammanslagning, T4-A).
- **Öppna:** SÄK-1, -6, -7 (skrivardelen), -9 (installation), -10 (installation), -14.
- **Inte berörda:** D-23 (radering och känsliga uppgifter) ligger i T4-A/T4-C; T3-D ändrar ingen radering och ingen post i `property_sensitive_access`. AP-A–AP-G: T3-B:s poolregel återanvänds oförändrad (ingen ny kategori, ingen statusändring).

### 8. Installationsplan och rollback (STAGING-paketet T3-D, beskrivs, körs inte)

**Förutsättningar:** separat GO; T3-A, T3-B och T3-C installerade först (`MIGRATIONSORDNING.txt`; klientpaketet bygger på HEAD med T3-A–T3-D).

**Backup** (testplanen §8 + T3-D): backupschemat för `store`, `op_idempotency` och `function_definitions` med md5; **lägg till** `vift_store_full_access`, `vift_store_project`, `activity_log_append` och `pg_policies` för `store`; JSON-kopia med sha256 av `vift_activityLog` och `vift_activities` (de enda nycklarna T3-D-koden skriver i, och bara via de vanliga vägarna); extern kopia verifierad (`tools/staging-backup-export.js --provata-lokalt`); EF-backup av `store-key-write` och `invoice-write`.

| Steg | Innehåll |
|---|---|
| 1. Läsande förkontroll | `schema_migrations` = `migrationsmappning.json` + T3-B + T3-C. md5 av `pg_get_functiondef` för `vift_store_full_access`, `vift_store_project` (T3-C-versionen) och `activity_log_append(jsonb,integer)` (STAGING) = STOP-värdena. Läsande antal per typ i `vift_activityLog` (för att se hur stor del av historiken som är i det äldre formatet). |
| 2. Databas | `20261128000006`, sedan `…07`, var och en i egen transaktion. Ingen `db push`, ingen `migration repair`. |
| 3. Edge Functions, direkt efter steg 2 | `store-key-write` (med `_shared/vift-auth.ts`, `activity-log.ts`, `activities-policy.ts`, `stamp-status.ts`) och `invoice-write`. |
| 4. Klient | `tools/build-staging-package.sh` från HEAD, publiceras på STAGING. `?v=` höjt; Service Worker är network-first, nya filer hämtas vid nästa laddning. |
| 5. Storage | Ingen ändring. |
| 6. Efterkontroll (läsande, V4 i testplanen) | md5 av de nya funktionerna = `tests/local/t3-andringar.json`. Läsande per roll med befintliga testkonton: SEC-B4-01..03, SEC-TASK-04, SEC-OFF-01, SEC-KUND-01/02 (readAllWithHashes och REST). SEC-TASK-01..03/05/06 bara på märkta testuppgifter efter separat GO. **Ingen `appendActivity` i STAGING** (append-only). |

**Fönstret mellan steg 2 och 3** (T3-C:s store-key-write mot T3-D-databasen):
- Läsningar: T3-C:s EF skickar redan identiteten, så urvalet per post gäller direkt.
- `appendActivity`: den gamla EF:en anropar 2-argumentsversionen, som inte finns → 500 `append_failed`. Klientens utkorg behandlar 5xx som tillfälligt och sänder om efter steg 3; ingen händelse går förlorad.
- `writeMerge`-svar och `invoice-write`-svar är oprojicerade i fönstret (som före T3-D). Fönstret ska vara minuter.

**v3.4-klient (Service Worker-cache) mot ny server, tills sidan laddats om:**

| Åtgärd i v3.4 | Ny server svarar | Följd |
|---|---|---|
| Inläsning och synk | Projicerade värden | v3.4 cachar bara urvalet (servern lämnar inte ut mer); ingen breddning |
| Fältets Uppgifter | Egna, tilldelade och AO-kopplade | v3.4 visar redigeringsknapp för tilldelade/AO-kopplade (gammal klientregel); ändring av annat än status/datum → 403 `forbidden` + `not_own`/`field_<fält>`, v3.4 rullar tillbaka med generiskt fel |
| Ny uppgift i v3.4 (`newId`) | Konflikt om id:t redan finns som dold uppgift | Uppgiften skapas inte, v3.4 visar konfliktvarning; ingen data skrivs över; löses av omladdning (ny klient använder `newSafeId`) |
| `appendActivity` med otillåten typ/referens | 403 `forbidden` + `type_not_allowed`/`ref_not_visible` | v3.4 tar bort posten ur utkorgen (4xx) med konsolvarning; ingen omsändningsloop |
| Fält utan egna AO: kunder och offerter tomma | 200 med tomma listor | v3.4:s heuristik kan klassa läsningen som degraderad **om** personalens id liknar demodatan; då spärras generiska skrivningar (t.ex. uppgifter) tills omladdning. Ingen data ändras. |
| REST-läsning | – | v3.4 läser inga affärsnycklar via REST |

**Rollback** (ingen data skrivs över):
1. Föregående `store-key-write` och `invoice-write` (T3-C-versionerna) ur EF-backupen, **först** (den nya EF:en anropar 4-argumentsversionen).
2. `supabase/rollback/T3-D/rollback_t3d.sql`: återskapar `activity_log_append(jsonb,integer)` exakt (STAGING), återställer `vift_store_full_access` och `vift_store_project` exakt till T3-C-versionen med samma rättigheter, tar bort T3-D:s nio hjälpfunktioner. Rör ingen tabell och ingen rad.
3. Föregående klientpaket.
4. Vid behov därefter T3-C- och T3-B-rollbacken (omvänd ordning, prövat lokalt = STAGING-facit).

Data som skapats efter installationen (aktivitetsposter med servermärkning, uppgifter med `newSafeId`-id) ligger kvar och fungerar med den äldre koden (`t3d_rollback.test.js`). JSON-kopiorna återläses bara vid ett separat beslut om ett datafel.

### 9. Kontrollpunkter (BESLUT-2026-11-28)

| Kontrollpunkt | Uppfylld | Belägg |
|---|---|---|
| Obligatoriska tester godkända | Ja | §5 (`projection_per_post` = `t3d_informationsatkomst`, `sim_parity`, SEC-B4-05/06 lokalt) |
| Negativa tester ger rätt felkod och ingen mutation | Ja | `expectReject` (status, error, reason, KS) i alla negativa EF-fall; RPC-fall med felmeddelande och KS; e2e med kontrollsumma. Undantag, dokumenterat: konflikt i `writeMerge` (RPC:n skriver tillbaka samma värde och flyttar `updated_at`); där jämförs värdets md5 |
| Inga nya oförklarade säkerhetsavvikelser | Ja | Paritet 139/141 lika, 2 kända utanför T3; schemat 0 oförklarade (13 T3-D-objekt md5-registrerade) |
| Samtidighetskritiska kontroller under transaktionslås | Ja | Referenskontrollen i `activity_log_append` under `FOR SHARE` på AO-raden (×20 mot en pågående omfördelning); uppgiftsregeln prövas mot `previous`, som RPC:n jämför med serverns element under radlås (TASK-01-designen) |
| Berörda affärsflöden fungerar | Ja | Fakturaflödet (`invoice-write` för arbetsledare oförändrat), uppgifter, stämpling, AO-detalj, Mina jobb, dashboard; run-all och e2e gröna |
| Avgränsade commits och rollback | Ja | Två commits per repo plus dokument och e2e-rapport; rollback prövad lokalt |
| Masterplanen visar faktisk nivå | Ja | SÄK-2, B3, B4, Ö7, D-12, D-14, D-15, D-22: "Lokalt verifierad"; D-13: "Delvis"; SÄK-17 uppdaterad |

### 10. Kända begränsningar och beslut som behövs

**Begränsningar:**
- PG16 och Node i stället för PG17 och Deno (releasevillkor).
- Skrivaren `customer_manage` utan `objects_sensitive` får fortfarande portkoder i kund-, fastighets- och objektposterna (SÄK-7). Att ta bort dem kräver fältvis sammanslagning vid skrivning (T4-A); annars tappar skrivningen fälten eller ger konflikt.
- Återkommande ärenden, ronderingar, avvikelser, inspektioner och projekt projiceras inte per post (utanför T3-D:s lista). Återkommande ärenden lämnas ut utan `accessCode` (C-5).
- Äldre aktivitetsposter i ett annat format (t.ex. `refId` i stället för `workOrderId`) visas inte för fält. Inga data skrivs om.
- En legitim utstämpling efter omfördelning (T3-B) sparar tidposten, men händelsen `time_entry_created` nekas med `ref_not_visible` (AO:n syns inte längre). Ingen tid går förlorad.
- `readHashes` och hasharna i `readAllWithHashes` avser hela servervärdet (som C-5/T3-C): en fältanvändare kan se *att* något dolt ändrats, inte vad.
- Fake-backend modellerar inte C-5 för övriga nycklar (sedan T3-0).
- Inga nya STAGING-läsverktyg för V4 är byggda; efterkontrollen beskrivs i §8.

**Beslut som behövs (förslag i parentes; det mest restriktiva valet som inte bryter ett flöde är genomfört):**
1. Uppgifter kopplade till en AO syns för den som är **tilldelad** AO:n, inte för alla med `ao_view_all`. Ekonomi ser alltså bara sina egna uppgifter (R47). (Godta.)
2. "Intern kollega" (arbetskontakt till kollegor, R38) avgörs på behörigheter: den som har någon behörighet utöver D-04:s tilläggslista (`dashboard_view`, `ao_view_own`, `ao_time`, `ao_checklist`, `ao_start_own`, `ao_complete_own`, `objects_access_assigned`, `rondering_utfor`) är intern. (Godta nu; inför gärna en uttrycklig behörighet, t.ex. `staff_contacts_view`, i T3-E.)
3. Hela kundregistret (utan skyddade fält) får, utöver C-5:s läsare, roller med `ao_create`, `recurring_manage` eller `reports_view` (de behöver välja kund). Egna roller med bara `staff_manage`, `admin_manage` eller `article_manage` får inte längre kundregistret. (Godta.)
4. Kundregistrets läsare (C-5: `invoice_view`, `ao_view_all` m.fl.) behåller personnummer som tidigare men förlorar kundpostens portkod/nyckelinformation utan `objects_sensitive`; REST-läsningen av kunder kräver därför `objects_sensitive`. (Godta; personnummer hanteras i T4-A.)
5. Händelsetyperna för rondering kräver `ao_view_all` tills T4-D inför `rondering_utfor` med serverkontroll. (Godta.)
6. Hela aktivitetsloggen följer `ao_view_all` (även egna roller som säljare). (Godta; smalna av i T3-E om säljare inte ska se AO-historik.)

### Ändrade filer

**vift-v2** (gren `claude/vift-system-restructure-8fUme`):
- nya:
  - `supabase/migrations/20261128000006_t3d_urval_per_post.sql`, `…07_t3d_aktivitetslogg.sql`;
  - `supabase/rollback/T3-D/rollback_t3d.sql`;
  - `tests/t3d_informationsatkomst.test.js`, `tests/t3d_rollback.test.js`, `tests/paritet_fake_kopia.test.js`, `tests/local/t3d-rollback.js`, `tests/local/lib/t3d-data.js`;
- ändrade:
  - `supabase/MIGRATIONSORDNING.txt`, `MIGRATIONSMAPPNING.md`, `migrationsmappning.json`;
  - `supabase/functions/store-key-write/{index,activity-log,activities-policy}.ts`, `supabase/functions/invoice-write/index.ts`;
  - `tests/{replica_build,ef_smoke,t3b_rollback,t3c_rollback}.test.js`, `tests/local/{jamfor-schema.js, t3-andringar.js, t3-andringar.json, lib/paritet.js}`, `tests/e2e/fake-backend.js`.

**VIFT-CRM** (gren `claude/vift-v3-major-redesign`):
- ändrade:
  - `index.html`, `src/data/state.js`, `src/services/ActivitiesService.js`, `src/pages/{PageShells,Dashboard,WorkOrderDetailPage}.js`;
  - `tests/e2e/fake-backend.js`, `tests/e2e/specs/{14_permissions,19_staging_rules,34_registers_ui}.js`;
  - detta dokument, `docs/MASTERPLAN.md`, `docs/qa-2026-11-26/BEHORIGHETSMATRIS.md`;
- ny: `tests/e2e/specs/39_t3d_informationsatkomst.js`.

### Commits

**vift-v2** (`claude/vift-system-restructure-8fUme`, inte pushad):
- `8d1eb14` T3-D server: urval per post (SÄK-2, B4, Ö7, D-12–D-15) och aktivitetsloggen (D-22), nya migrationer, EF och rollback
- `5bc9a97` T3-D tester: urval per post och aktivitetslogg (vända baslinjefynd SÄK-2), ingen breddning mot T3-C, samtidighet, rollback, T3-facit, paritet och fake-backend

**VIFT-CRM** (`claude/vift-v3-major-redesign`, inte pushad; ovanpå huvudsessionens `d72b744`, VK-1-raderna orörda):
- `1a2edfe` T3-D klient: Uppgifter och dashboard följer serverns uppgiftsregel (D-15, F8), aktivitetsloggen märkt som klientrapport (D-22), inga id-krockar med dolda uppgifter, ingen falsk degraderad läsning vid urval per post
- `ff60cb0` T3-D tester: fake-backend följer T3-D-reglerna (paritet 139/141), nya T3D-01–04, PERM-03/TASK-02/REG-UI-07 anpassade till urval per post
- dokumentcommit och e2e-rapport: se `git log` efter `ff60cb0`

## T3-E – standardroller

Verifieringsnivå: **lokalt verifierad** (PostgreSQL 16.15, Edge Functions körda i Node mot den
lokala STAGING-replikan, webbläsartester mot den simulerade servern). Ingenting är installerat
eller verifierat i STAGING. Rollregistret i STAGING är inte ändrat. LIVE är inte kontaktad.
En läsande SELECT mot STAGING gjordes (antal aktiv personal per roll-id, inga personuppgifter) för
införandeplanen.

### Sammanfattning

| Del | Resultat |
|---|---|
| Standardrollerna som data (D-02, M9) | `vift-v2/supabase/manual/t3e_standardroller/standardroller.json`: `admin` [`all`], `chef` (Arbetsledare), `ekonomi`, `personal`, `begransad`, exakt matrisen §2 (bara ✔; K-02: `chef` utan `personal_data_view`). Testet `VIFT-CRM/tests/rollnamn_guard.test.js` jämför definitionen med matristabellen. |
| Installationsskript (inte en migration) | Fyra manuella skript i `supabase/manual/t3e_standardroller/`, genererade ur definitionen (`tests/local/t3e-skript.js`): **A** läsande plan (hash, plan per standardroll, antal per roll-id, roller som beror på övergångsregeln, journal), **B** installera, **C** rollback av en journalrad med expectedHash, **D** övergångsregeln uttrycklig för en roll. Körs aldrig av kedjan (`db push`). |
| STOP och journal | B lägger **bara till** saknade roller. STOP (inget ändras, ingen journalrad) vid platshållare eller fel hash, id-krock (även `admin` med andra behörigheter, och egen roll `chef`), dubbla id, aktiv personal som redan har ett roll-id som skulle läggas till, eller ändrat antal superadministratörer. Journal `vift_t3e_journal.rollregister` med förevärde, eftervärde och båda hasharna. Idempotent: en andra körning ändrar ingenting. |
| Rollback | C återställer förevärdet för en journalrad bara om rollregistrets hash är journalens eftervärde (expectedHash) — nyare ändringar skrivs aldrig över; STOP om personal har tilldelats en tillagd roll eller raden redan är återställd. Installera → rollback → installera prövat. |
| Ej verkställda behörigheter (tillägget) | Tio behörigheter vars serverkontroller hör till T4/AO-etappen är **verkningslösa**: servern har registret `_vift_ej_verkstallda()` (ny migration `20261128000008`), ingen regel läser dem. **Fynd i T3-D-koden (bevisat som BASLINJE):** `_vift_staff_external` gjorde en extern användare intern av vilken behörighet som helst, så `begransad` + t.ex. `cost_view` fick alla kollegors arbetstelefon och arbets-e-post. Rättat: de ej verkställda räknas inte. Bevisat: samma användare får exakt samma effektiva åtkomst med och utan varje sådan behörighet (tom roll, `begransad`, `personal`, `chef`, `ekonomi`). |
| Klientens rolleditor | Katalogen (`PageShells.js`) har alla behörigheter i matrisen med beskrivningar; de tio ej verkställda är märkta "verkställs i <paket>". **Klientfynd rättat:** behörigheter som inte fanns i katalogen (t.ex. `customer_view`) tappades tyst när en roll sparades; de visas nu i en egen grupp och sparas. Ingen vy eller knapp använder en ej verkställd behörighet (grep-test). `?v=` höjt. |
| Övergångsregeln (§4.6, T3-B) | **Kvar.** Exakt två STAGING-roller beror på den: `e2e_falt` (2 aktiva) och `v7_sakerhetstest` (1 aktiv). Införandeplan: steg 1 (B) → steg 2 (D per roll) → regeln verkningslös för alla roller (SQL och TS) → steg 3 regeln tas bort i ett senare serverpaket. Effektiv åtkomst identisk för alla sju STAGING-roller efter varje steg (och efter simulerad borttagning). |
| Inga beslut på rollnamn | Grep-test över klient (src/) och server (Edge Functions, T3-migrationerna och alla SQL-funktioner i repliken): inga jämförelser med standardrollernas id; bara uttryckligt tillåtna förval (dashboardlayout, ny personal, import; matrisen §0.2). |
| `standard_roles` | `vift-v2/tests/t3e_standard_roles.test.js`: hela SEC-CUST-01..23 och SEC-* per standardroll mot repliken med standardrollerna installerade av B, ett syntetiskt konto per standardroll (D-26) och 23 egna roller. Negativa fall med `expectReject` (status, error, reason, KS). SEC-CUST-rader vars behörighet verkställs i T4 prövas som "verkningslös nu" (med = utan), inte som godkänd målregel. |
| Fake-backend och e2e | Seedens roller = standardrollerna (seedData), ej verkställda verkningslösa även i fake (paritet 147 scenarier, 145 lika, 2 kända). Nya e2e T3E-01..07 per standardroll: meny, sidor, flöden, ej verkställda, indragen behörighet i två flikar och cache. |

### 1. Inventering före ändringen

**STAGING:s rollregister** (läst med SELECT 2026-11-28, uppgifter i uppdraget) och **aktiv personal per roll-id** (läst med en läsande SELECT 2026-11-28, bara antal): `admin` 2, `e2e_arbetsledare` 1, `e2e_begransad` 1, `e2e_ekonomi` 1, `e2e_falt` 2, `qa_p2_avgransad` 1, `v7_sakerhetstest` 1; 0 inaktiva; ingen personal har `chef`, `ekonomi`, `personal` eller `begransad`. Repliken i testerna har exakt samma register och samma antal (syntetiska konton).

**Var de nya behörigheterna läses i dag:**
- Servern: `ao_start_own`, `ao_complete_own`, `ao_pool_take` (T3-B: `work_order_patch`, `work_order_pool_take`, `vift-auth.ts`, `work-orders-list`). `objects_access_assigned` och `rondering_utfor` bara i T3-D:s `_vift_staff_external` (D-04:s tilläggslista). Inga andra nya behörigheter läses av någon EF eller SQL-funktion.
- Klienten: bara de tre T3-B-behörigheterna (`WorkOrderService.aoCan`, Mina jobb, AO-detaljen). Ingen ej verkställd behörighet används.
- **Fynd 1 (server, T3-D):** `_vift_staff_external` räknade varje behörighet utöver D-04-listan som "intern". En ej verkställd behörighet (t.ex. `cost_view`, `export_data`, `ao_plan_own`) gav därför en extern roll kollegornas kontaktuppgifter — bredare åtkomst. Bevisat som BASLINJE mot kedjan utan `20261128000008`; rättat.
- **Fynd 2 (klient):** rolleditorn sparade bara katalogens kryssrutor, så behörigheter utanför katalogen (i STAGING `customer_view` på `v7_sakerhetstest`) försvann tyst när en roll sparades. Rättat (egen grupp, sparas). e2e T3E-01.
- **Fynd 3 (testverktyg):** EF-adaptern (`tests/local/lib/ef.js`) skrev en tom JS-lista till en `text[]`-kolumn som `''`, så `get-sensitive-fields` nekade läsningar fick ingen revisionsrad i repliken. Rättat i adaptern (bara testverktyg; EF:en oförändrad).

### 2. Standardrollerna som data och installationsskripten (vift-v2)

| Fil | Innehåll |
|---|---|
| `supabase/manual/t3e_standardroller/standardroller.json` | Definitionen (5 roller) och listan `ejVerkstallda` med paket. |
| `A_las_och_plan.sql` | Läsande: A1 projekt, A2 rollregistrets hash (samma som `store-key-write` `readWithHash`), A3 roller, A4 plan per standardroll (LAGGS_TILL / IDENTISK / KROCK), A5 personal per roll-id (bara antal), A6 roller som beror på övergångsregeln, A7 journal. |
| `B_installera.sql` | Rad 1: hash från A2. Rådgivande lås + `FOR UPDATE` i samma ordning som T3-C (roller → personal). Lägger bara till saknade standardroller sist i registret; befintliga element orörda byte för byte. STOP-fallen i sammanfattningen. Flyttar `vift_lastChanged` (som RPC:erna). Journalrad. |
| `C_rollback.sql` | Rad 1: journalradens id. expectedHash = journalens `efter_hash`. STOP-fallen i sammanfattningen. Återställer förevärdet, journalför rollbacken. |
| `D_overgangsregel_uttrycklig.sql` | Rad 1: roll-id, rad 2: hash. Bara om övergångsregeln gäller rollen (`ao_complete` utan `ao_view_all`/`ao_edit`/`all` och utan de tre nya): lägger till exakt `ao_start_own`, `ao_complete_own`, `ao_pool_take`. Journalrad. |
| `tests/local/t3e-skript.js` | Genererar A–D ur definitionen; testet kontrollerar att filerna är aktuella. |

Skripten körs i SQL Editor som `postgres` efter separat GO. De går därför förbi `store-key-write`:s eskaleringsregel, men de lägger bara till roller som ingen har, ändrar aldrig personal och kontrollerar att antalet superadministratörer är oförändrat (`_vift_superadmin_count`).

### 3. Ej verkställda behörigheter

Gemensamt för alla tio: de står i `_vift_ej_verkstallda()` och räknas inte när servern avgör intern/extern (enda stället där en okänd behörighet kunde verka). Ingen EF och ingen annan SQL-funktion läser dem (test). Klienten använder dem bara i rolleditorns katalog och i demorollerna (test). T3-C:s eskaleringsregel gäller dem som alla andra: bara den som själv har behörigheten (eller `all`) kan tilldela den.

| Behörighet | Serverkontroll i dag | Klientkontroll i dag | Verkställs i | Om den tilldelas nu (lokalt bevisat) |
|---|---|---|---|---|
| `ao_plan_own` | Ingen; `work_order_patch` godtar från fältet bara start, klar, egna materialrader och tagning, allt annat ger 403 `field_not_allowed` som förut | Ingen | AO-etappen (AP-E) | Ingen effekt |
| `cost_view` | Ingen; inköpspris/TB följer i dag `work-orders-list`/C-5 (`ao_view_all`, `ao_edit` m.fl.) | Ingen (priser visas efter befintliga regler) | T4-A/T4-B | Ingen effekt (SEC-CUST-01: chef med = utan) |
| `cost_edit` | Ingen; artiklar kräver `article_manage` | Ingen | T4-A/T4-B | Ingen effekt (SEC-CUST-02) |
| `time_view_all` | Ingen; `time-entries-list` ger alla bara med `payroll_view` | Ingen | T4-B (K-01) | Ingen effekt; chef ser bara egna tidposter (SEC-CUST-05, SEC-TID-06) |
| `bankgiro_edit` | Ingen; `vift_settings` skrivs med `admin_manage` (hela nyckeln) | Ingen | T4-A (D-17) | Ingen effekt |
| `personal_data_view` | Ingen; personnummer följer C-5:s kundläsare | Ingen | T4-A (D-13, K-02) | Ingen effekt (SEC-CUST-08/20) |
| `objects_access_assigned` | `get-sensitive-fields` kräver `objects_sensitive` (403 + `denied`-rad) | Ingen | T4-C (D-05) | Ingen effekt: 403 + en `denied`-rad som utan (SEC-CUST-14/17) |
| `rondering_utfor` | `rondering-pass-write` kräver `ao_view_all` | Ronderingssidorna kräver `ao_view_all` | T4-D (Ö3) | Ingen effekt (SEC-CUST-15) |
| `export_data` | Ingen serverexport finns | Exportcenter/snabbexport följer läsrättigheterna, inte `export_data` | T4-F (D-18) | Ingen effekt (SEC-CUST-06, T3E-06: ingen ny meny eller knapp) |
| `export_personal_data` | Ingen serverexport finns | Ingen | T4-F | Ingen effekt |

Bevis: `t3e_standard_roles.test.js` jämför **profiler** (samma provkonto, rollens behörigheter bytta): `work-orders-list`, `time-entries-list`, `readAllWithHashes` för 25 nycklar, REST-läsning av 25 nycklar och 23 skrivande anrop (tagning, start, klar, redigering, material, radering, ny AO, tid, attest, stämpling, checklista, logg, kund, artikelns inköpspris, bankgiro, fakturarad, egen och annans uppgift, händelse, portkod, ny roll) med status, error, reason och vilka resurser som ändrats. Varje ej verkställd behörighet för sig på en tom roll och på `begransad`, alla tio tillsammans på tom roll, `begransad` och `personal`, och `chef`/`ekonomi`/`personal` med och utan dem: **0 skillnader**. Samma i webbläsaren (T3E-06) och i fake-backend (paritet E-B3/E-KUND/E-WOL).

### 4. Serverändringar (vift-v2, `supabase/`)

| Fil | Innehåll |
|---|---|
| `migrations/20261128000008_t3e_ej_verkstallda_behorigheter.sql` | `_vift_ej_verkstallda()` (ny) och `_vift_staff_external` (samma signatur) som räknar bort dem. STOP: redan installerad, T3-D saknas, eller `_vift_staff_external` avviker från T3-D-versionen (md5). Bara `service_role`. Rör inga data. |
| `rollback/T3-E/rollback_t3e.sql` | Genererad av `tests/local/t3e-rollback.js` ur kedjan utan T3-E: T3-D-definitionen exakt, registret bort. |
| `MIGRATIONSORDNING.txt`, `MIGRATIONSMAPPNING.md`, `migrationsmappning.json` | 0008 som klass "ny" efter T3-D; kommentar om att det manuella skriptet inte är en migration. |
| `manual/t3e_standardroller/` | Se §2. |

Ingen Edge Function är ändrad.

### 5. Klientändringar (VIFT-CRM)

- `src/pages/PageShells.js` (rolleditorn): hela katalogen med beskrivningar enligt matrisen §1.1 (`customer_view`, `ao_plan_own`, `rondering_utfor`, `objects_access_assigned`, `personal_data_view`, `cost_view`, `cost_edit`, `time_view_all`, `bankgiro_edit`, `export_data`, `export_personal_data`; nya grupper "Intern ekonomi" och "Tid & Löner"), `_PERM_EJ_VERKSTALLD` med märkningen "verkställs i <paket>", behörigheter utanför katalogen i en egen grupp (sparas), etiketter escapade. Ingen redesign.
- `src/data/seedData.js`: demorollerna = de fem standardrollerna (därmed fake-backendens seed).
- `index.html`: `PageShells.js?v=196`, `seedData.js?v=28`.

### 6. Fake-backend och paritet

- `tests/e2e/fake-backend.js` (båda repona, synkade): `T3E_EJ_VERKSTALLDA` (= serverns register) räknas inte i intern/extern; seedens `begransad` läggs bara till om seeden saknar den (vift-v2:s äldre klientkopia).
- `vift-v2/tests/local/lib/paritet.js`: 6 nya T3-E-scenarier (begransad och tom roll med alla tio: personal, kunder/fastigheter/objekt, work-orders-list), alla lika. `sim_parity` 148/0: 147 scenarier, 145 lika, 2 kända (KEY-01, AUTH-02, oförändrade).

### 7. Övergångsregeln och införandeplanen per STAGING-roll

Övergångsregeln (§4.6) tas **inte** bort nu. Den gäller i dag (efter T3-B) för exakt två roller.

| STAGING-roll | Aktiva | Övergångsregeln i dag | Steg 1: B (standardroller) | Steg 2: D (separat GO per roll) | Steg 3: regeln bort | Steg 4 (valfritt, D-26, separat GO) |
|---|---|---|---|---|---|---|
| `admin` | 2 | Gäller inte (`all`) | IDENTISK, orörd | – | Ingen påverkan | Redan standardrollen |
| `e2e_arbetsledare` | 1 | Gäller inte (`ao_view_all`/`ao_edit`) | Orörd | – | Ingen påverkan | → `chef`: beslutade nya behörigheter, se nedan |
| `e2e_ekonomi` | 1 | Gäller inte (ingen `ao_complete`) | Orörd | – | Ingen påverkan | → `ekonomi`: beslutade nya behörigheter, se nedan |
| `e2e_falt` | 2 | **Gäller** (`ao_complete` + `ao_view_own`) | Orörd | + `ao_start_own`, `ao_complete_own`, `ao_pool_take` (samma effektiva åtkomst) | Ingen påverkan efter steg 2 | → `personal`: identisk |
| `e2e_begransad` | 1 | Gäller inte | Orörd | – | Ingen påverkan | → `begransad`: identisk |
| `qa_p2_avgransad` | 1 | Gäller inte | Orörd | – | Ingen påverkan | Ingen standardmotsvarighet; avvecklas (punkt 262) |
| `v7_sakerhetstest` | 1 | **Gäller** (`ao_complete` + `ao_view_own`) | Orörd | + de tre (samma effektiva åtkomst) | Ingen påverkan efter steg 2 | Ingen standardmotsvarighet; avvecklas (punkt 262) |

**Ordning:**
0. Läsande: A (hash, plan, antal per roll-id, A6). Förväntat i STAGING: admin IDENTISK, fyra LAGGS_TILL, A6 = `e2e_falt` och `v7_sakerhetstest`.
1. Efter att T3-A–T3-D och T3-E:s migration (0008) och klientpaket är installerade, och efter separat GO: B med hashen från A. Ingen användare påverkas (ingen har standardrollernas id; B stoppar annars).
2. Separat GO per roll: D för `e2e_falt`, sedan (ny hash från A) D för `v7_sakerhetstest`. Två respektive en användare berörs; deras effektiva åtkomst är oförändrad. Alternativ utan att ändra egna roller: hoppa över steg 2 och låt regeln stå kvar tills rollerna avvecklats (punkt 262).
3. När A6 är tom i STAGING **och** samma läsande kontroll är gjord mot LIVE:s rollregister (inför LIVE): ett senare serverpaket tar bort regeln (`_vift_ao_eff_perms`, `effectiveAoPerms` i `_shared/vift-auth.ts`, `WorkOrderService.aoCan`, `effAoPerms` i fake-backend och STAGING-verktygen). Lokalt bevisat att regeln då är verkningslös för alla roller i SQL och TS, och att en simulerad borttagning i SQL inte ändrar någon rolls åtkomst.
4. Valfritt, separat GO (D-26): testkontona flyttas till standardrollerna (personalposter för testkonton), därefter avveckling av e2e-rollerna (punkt 262).

**Rollback:** C per journalrad i omvänd ordning (D-raderna, sedan B-raden). Varje steg kräver att rollregistrets hash är journalradens eftervärde (expectedHash); annars STOP och ingenting skrivs över. Personalregistret rörs aldrig.

**Jämförelsetest** (`t3e_installation.test.js`): effektiv åtkomst (samma profil som i §3, 23 skrivande anrop) per STAGING-roll före och efter steg 1, efter steg 2, efter simulerat steg 3 och efter rollback: **identisk för alla sju roller i alla lägen**. Steg 4 jämfört mot e2e-rollen — varje skillnad är en beslutad ny behörighet, ingen oavsiktlig breddning:
- `e2e_arbetsledare` → `chef`: `rest/las vift_recurringOrders` och `get-sensitive-fields` 200 (`objects_sensitive`, D-05); fakturarad 200 (`invoice_create`, D-07). Övriga skillnader: inga (de ej verkställda är verkningslösa).
- `e2e_ekonomi` → `ekonomi`: alla tidposter (`payroll_view`, D-08), attest 200 (`payroll_manage`, D-08); tid på egen/pool-AO är fortfarande 403 men med orsaken `not_assigned` (lönehandläggaren passerar behörighetssteget; tilldelningen nekar) — ingen breddning.
- `e2e_falt` → `personal`, `e2e_begransad` → `begransad`, `admin` → `admin`: identisk.

### 8. Tester (lokalt, PGHOST=/var/tmp/vift-localpg, PostgreSQL 16.15)

**vift-v2 `tests/run-all.sh` (SKIP_BROWSER=1): 34/34 testfiler gröna, 1 403 godkända kontroller, 0 fel.**
Webbläsartesterna i `browser/` hoppades över med SKIP_BROWSER=1, som i T3-0–T3-D. De räknas inte som godkända. `staging_e2e_real` kör Playwright och ingår.

Nya:
- `t3e_standard_roles` **94/0** (testgruppen `standard_roles`):
  - BASLINJE mot kedjan utan `20261128000008`: `begransad` + `cost_view` får 13 kollegors kontaktuppgifter (0 utan);
  - ej verkställda behörigheter verkningslösa: profiler (EF-läsningar av 25 nycklar, `work-orders-list`, `time-entries-list`, REST, 23 skrivande anrop) med och utan varje behörighet — 0 skillnader; ingen EF och ingen annan SQL-funktion läser dem;
  - standardrollerna installerade med B; ett syntetiskt konto per standardroll; 23 egna roller;
  - SEC-CUST-01..23: enforced rader med exakt status/error/reason och KS (03, 04, 07, 09–13, 16, 18, 19, 21, 22, 23); T4-rader som "verkningslös nu" (01, 02, 05, 06, 08, 14, 15, 17, 20) och SEC-CUST-03:s skrivardel och SEC-CUST-20:s personnummer dokumenterade som T4-A, inte godkända som målregel; SEC-CUST-22/23 med de kända C-5-nycklarna (inställningar utan bankgiro, återkommande ärenden utan accessCode, prisgrupper) redovisade;
  - SEC-* per standardroll: SEC-AO-01/02/04/05/09/10/11/15/17, SEC-POOL-03/05/10, SEC-TID-01/02/04/06/07/09, SEC-FAKT-01/02/03, SEC-B3-03/05/06, R40, SEC-B4-01/02, SEC-KUND-01/02, SEC-OFF-01, SEC-REST-03/04, SEC-B5-09, begransad och admin över alla 23 anrop;
  - inga beslut på rollnamn i EF, T3-migrationerna eller någon SQL-funktion.
- `t3e_installation` **59/0**: skripten aktuella; STAGING-likt register och antal per roll-id; A; B:s STOP-fall (platshållare, fel hash, id-krock `admin` och `chef`, dubbla id, aktiv personal med `personal`) utan mutation och utan journalrad; B lägger bara till fyra roller, orörda befintliga, personal orörd, journal, `vift_lastChanged`; idempotens; D med STOP-fall; övergångsregeln verkningslös efter steg 2 (SQL och TS); effektiv åtkomst identisk för alla sju STAGING-roller efter steg 1, 2, simulerat steg 3 och rollback; C:s STOP-fall (nyare ändring via rolleditorn, personal på tillagd roll, dubbel rollback); installera → rollback → installera = samma hash; steg 4 med bara beslutade skillnader.
- `t3e_rollback` **15/0**: migrationen installera → rollback (T3-D-läget, ingen data ändrad, T3-D:s beteende tillbaka) → installera; STOP vid omkörning och vid avvikande T3-D-funktion; T3-E + T3-D + T3-C + T3-B = STAGING-facit.

Ändrade och gröna: `replica_build` 33/0 (8 nya migrationer, 2 T3-E-objekt), `t3b_rollback` 12/0, `t3c_rollback` 19/0, `t3d_rollback` 19/0 (kedjorna utan T3-D utesluter även T3-E; omvänd ordning börjar med T3-E), `migrationskedja` 2/0 (112 identiska, 65 förklarade, 0 oförklarade), `migrationsmappning` 18/0, `paritet_fake_kopia` 148/0, `staging_e2e_real` 26/0, `staging_tools` 44/0, `ef_smoke` 39/0. Oförändrat gröna: `t3b_ao_karna` 171/0, `t3c_roller` 145/0, `t3d_informationsatkomst` 111/0, `baslinje_sakerhet` 38/0 (historisk källa).

Under arbetet: första körningen av `paritet_fake_kopia`, `staging_e2e_real` och `staging_tools` föll eftersom vift-v2:s kopia av fake-backend hade skrivits över med VIFT-CRM:s (som läser serverkällan via `tests/lib/serverkalla`, en sökväg som inte finns i vift-v2). Kopians egen rad återställdes; testerna är oförändrade.

**VIFT-CRM `tests/run-all.sh`: 23/23 testfiler gröna** (22 Node-testfiler med 643 godkända kontroller och 0 fel, plus `browser/offer_total_parity.js` med 120 offerter och 0 avvikelser). Inga överhoppade.
- ny `rollnamn_guard` 17/0;
- `sim_parity` 148/0 (147 scenarier, 145 lika, 2 kända: KEY-01, AUTH-02);
- `staging_e2e_real` 26/0.

**E2E (Playwright mot den simulerade servern):**
- Nya T3E-01..07 (`tests/e2e/specs/40_t3e_standardroller.js`): 7/0 (under arbetet föll T3E-05 på testets förväntan — begransad har fler egna AO i seeden — och rättades i testet).
- Första hela körningen med de nya demorollerna: 247 godkända, 7 fel av 254. Alla sju var äldre förväntningar som byggde på demorollerna före matrisen: arbetsledaren saknade `objects_sensitive` (PROP-01, PERM-02, MISC-PROP-03, REG-UI-10) och `ao_time` (AOD-01), ekonomi saknade `customer_view` (ROLE-01), och etiketten "Tekniker / Personal" (ROLE-02). De negativa fallen "arbetsledare utan portkod" prövas nu med en egen roll `chef` − `objects_sensitive` (D-26, SEC-CUST-03), alltså lika hårt; de beslutade nya behörigheterna förväntas nu. Efter ändringen: 7/0.
- **Hela e2e-sviten en gång, efter alla ändringar: 254 godkända, 0 fel, 0 blockerade, 0 kända fel, av 254 (1 746 s)**. Baslinjen efter T3-D var 247 av 247; skillnaden är de 7 nya T3E-01–07. Rapporten committas separat (`tests/e2e/report/`).

Inga negativa tester har försvagats.

### 9. Baslinjefynd

| Fynd | Bevis i oförändrad kod | Efter T3-E |
|---|---|---|
| Ej verkställd behörighet breddade en extern roll (T3-D `_vift_staff_external`) | `t3e_standard_roles`: BASLINJE mot kedjan utan 0008 — `begransad` + `cost_view` får 13 kollegors arbetstelefon och arbets-e-post (0 utan) | Rättat: profilerna med och utan är identiska; T3-D:s beteende kommer tillbaka efter rollback (`t3e_rollback`) |
| Rolleditorn tappade behörigheter utanför katalogen | Koden (`_saveEditRole` samlade bara katalogens kryssrutor) | Rättat; e2e T3E-01 |

Inga tidigare baslinjefynd ändrade (`baslinje_sakerhet` mot fb71f26 oförändrad).

### 10. SÄK och D efter T3-E

- **Lokalt åtgärdade:** D-02, D-26, Ö2 (standardrollerna definierade), M9; K-01 och K-02 fastställda och genomförda i definitionen (`time_view_all` i `chef`, `personal_data_view` inte i `chef`); tillägget "inga nya behörigheter aktiveras före T4" (verkningslösa, bevisat); "inga säkerhetsbeslut på rollnamn" (grep-test); indragen behörighet med standardrollerna (T3E-07, utöver T3-A/T3C-06); SÄK-17 för T3-E.
- **Delvis:** D-04 (standarddelen och tilläggen tid/checklista/start/klar; rondering och åtkomstinformation i T4-C/T4-D).
- **SÄK-10:** lokalt åtgärdad sedan T3-A; spärren för `personal` gäller fortfarande i STAGING (B körs först när T3-A är installerad, steg 1 ovan).
- **Öppna (T4):** verkställandet av de tio behörigheterna; SEC-CUST-01/02/05/06/08/14/15/17/20 är i dag "verkningslös nu", inte godkända målregler; SEC-CUST-03:s skrivardel (SÄK-7, T4-A).

### 11. Installationsplan och rollback (STAGING-paketet T3-E, beskrivs, körs inte)

**Förutsättningar:** separat GO; T3-A, T3-B, T3-C och T3-D installerade (SÄK-10 före `personal`); testkonton i STAGING först efter separat godkännande (D-26).

**Backup:** backupschemat (testplanen §8) med `_vift_staff_external`; JSON-kopia med sha256 av `vift_roles` och `vift_staff` (testplanen T3-E); journalen i `vift_t3e_journal` är dessutom en före/efter-kopia per steg.

| Steg | Innehåll |
|---|---|
| 1. Läsande förkontroll | `schema_migrations` = mappningen + T3-B–T3-D. md5 av `_vift_staff_external` = T3-D-versionen (samma värde som STOP-kontrollen). A (plan och antal) sparas. |
| 2. Databas | `20261128000008` i egen transaktion. Ingen `db push`, ingen `migration repair`. |
| 3. Edge Functions | Inga. |
| 4. Klient | `tools/build-staging-package.sh` från HEAD (T3-A–T3-E). `?v=` höjt för `PageShells.js` och `seedData.js`. Service Worker är network-first; nya filer hämtas vid nästa laddning. Klientpaketet installeras **före** steg 5, så att ingen administratör redigerar standardrollerna i en v3.4-rolleditor (se nedan). |
| 5. Data (separat GO) | B med hashen från A. Därefter A igen (ny hash, plan IDENTISK för alla fem). Steg 2 i införandeplanen (D) med separat GO per roll. |
| 6. Storage | Ingen ändring. |
| 7. Efterkontroll (läsande, V5) | A: journalen, planen och A6. `authz-read.js`/`c5-read.js` med befintliga testkonton (oförändrad förväntan, eftersom ingen har standardrollerna). Förväntan per standardroll (V5) först när testkonton finns (D-26). |

**Fönster:** migrationen ändrar bara en hjälpfunktion; inget API ändras. Mellan steg 2 och 4 gäller den nya regeln med den gamla klienten (ingen effekt, eftersom ingen har en ej verkställd behörighet ännu).

**v3.4-klient (Service Worker-cache) mot ny server och nytt rollregister:**

| Åtgärd i v3.4 | Följd |
|---|---|
| Inloggning, meny, `Auth.can` | Oförändrat. v3.4 känner inte de nya behörigheterna och ignorerar dem; ingen ny meny eller knapp. |
| Rolleditorn (admin) på en standardroll | **Risk:** v3.4:s katalog saknar bl.a. `customer_view`, `cost_view` och de övriga nya; v3.4 sparar bara katalogens kryssrutor och skulle **tappa** dem (servern tillåter borttagning). Därför klientpaketet före B, och ingen rollredigering i en flik som inte laddats om. Nyare klient tappar inget (T3E-01). |
| Personaldialogen | Standardrollerna visas som valbara (enligt T3-C:s regel); val av en standardroll prövas av servern. |
| Fält med `e2e_falt` efter steg 2 | v3.4 läser `ao_complete` som förut; servern ger samma rätt (övergångsregeln eller de uttryckliga behörigheterna). |
| Felkoder | Inga nya felkoder i T3-E. |

**Rollback (data skrivs aldrig över):**
1. Rollregistret: C per journalrad i omvänd ordning (bara om hashen är journalradens eftervärde; annars STOP). Inget annat data rörs.
2. Databas: `supabase/rollback/T3-E/rollback_t3e.sql` (T3-D-definitionen, registret bort; rör inga data). Därefter vid behov T3-D-, T3-C- och T3-B-rollbacken (omvänd ordning, prövat lokalt = exakt STAGING-facit).
3. Klient: föregående klientpaket.
4. Storage: ingen ändring.

Roller och personaländringar som gjorts efter installationen ligger kvar; C stoppar i stället för att skriva över dem.

### 12. Kontrollpunkter (BESLUT-2026-11-28)

| Kontrollpunkt | Uppfylld | Belägg |
|---|---|---|
| Obligatoriska tester godkända | Ja | §8 (`standard_roles`, installationen, rollback, paritet, e2e) |
| Negativa tester ger rätt felkod och ingen mutation | Ja | `expectReject` (status, error, reason, KS) i alla negativa EF-fall; skript-STOP med KS för `vift_roles`, `vift_staff`, `app_users` och oförändrad journal |
| Inga nya oförklarade säkerhetsavvikelser | Ja | Schemat 0 oförklarade (2 T3-E-objekt md5-registrerade); paritet 145/147, 2 kända utanför T3 |
| Samtidighetskritiska kontroller under transaktionslås | Ja | Skripten tar T3-C:s rådgivande lås och radlås (roller → personal) och kontrollerar hash, krockar och superadministratörer under låset |
| Berörda affärsflöden fungerar | Ja | Rolleditorn, personalsidan, Mina jobb, tid, fakturaunderlag, attest; run-all och hela e2e-sviten |
| Avgränsade commits och rollback | Ja | Två commits per repo plus dokument och e2e-rapport; rollback (migration och data) prövad lokalt |
| Masterplanen visar faktisk nivå | Ja | D-02, D-04, D-26, Ö2, K-01, K-02, SÄK-10, SÄK-17, T3-E (M9), punkt 262 |

### 13. Kända begränsningar och beslut som behövs

**Begränsningar:**
- PG16 och Node i stället för PG17 och Deno (releasevillkor).
- Skripten körs som `postgres` och går förbi `store-key-write`:s kontroller; de lägger bara till roller, ändrar aldrig personal och kontrollerar superadministratörerna, men en manuell redigering av skriptet skulle inte fångas av servern. Därför STOP-kontroller, journal och separat GO.
- `state.js` faller tillbaka på demorollerna om rollregistret helt saknas i svaret (som tidigare; servern avgör ändå).
- Tom behörighetslista och okänd roll (SEC-CUST-22/23) får fortfarande C-5:s projicerade inställningar (utan bankgiro och intern timkostnad), prisgrupper (med timpris, SEC-B2-01, T4-B) och återkommande ärenden (utan `accessCode`, inget urval per post sedan T3-D). Oförändrat av T3-E; redovisat i testet, inte godkänt som målregel.
- LIVE:s rollregister är inte läst; införandeplanen gäller STAGING. Innan övergångsregeln tas bort ska samma läsande A-kontroll göras mot LIVE (med separat GO).
- Profilerna i testerna tar ca 9 s per användare; `t3e_standard_roles` och `t3e_installation` tar därför flera minuter.

**Beslut som behövs (förslag i parentes; det mest restriktiva valet som inte bryter ett flöde är genomfört):**
1. Standardrollerna innehåller redan nu de tio ej verkställda behörigheterna (exakt matrisen §2), verkningslösa tills T4 tar bort dem ur `_vift_ej_verkstallda()`. Då får rollerna åtkomsten utan ny dataändring. (Godta; alternativet är att lägga till dem i rollerna först i T4.)
2. B stoppar om aktiv personal redan har ett roll-id som skulle läggas till (rollen skulle ge dem åtkomst direkt). I STAGING finns ingen sådan personal i dag. (Godta.)
3. Steg 2 (D) ändrar två egna testroller i STAGING genom att lägga till exakt deras effektiva behörigheter. (Godta med separat GO per roll, eller hoppa över och låt regeln stå tills rollerna avvecklats i punkt 262.)
4. T3-D:s förslag `staff_contacts_view` införs inte (inget beslut). T3-E löser den konkreta breddningen genom att ej verkställda behörigheter inte räknas. (Avgör i T4 om "intern kollega" ska bli en uttrycklig behörighet.)
5. T3-D:s förslag att smala av aktivitetsloggen för egna roller med `ao_view_all` (t.ex. säljare) införs inte; standardrollerna påverkas inte (admin, chef och ekonomi ska se hela loggen). (Separat beslut.)
6. Matrisen ger inte `chef` `reports_view`; demorollen "Chef / Projektledare" hade den, så arbetsledaren i demo/fake ser inte längre Rapporter. STAGING:s `e2e_arbetsledare` saknar den också. (Godta matrisen, eller ändra matrisen om arbetsledaren ska se rapporter.)
7. Rolleditorn visar behörigheter utanför katalogen i en egen grupp och bevarar dem vid Spara (tidigare tappades de). (Godta.)
8. Övergångsregeln tas bort först när A6 är tom i STAGING och LIVE. (Godta.)

### Ändrade filer

**vift-v2** (gren `claude/vift-system-restructure-8fUme`):
- nya:
  - `supabase/migrations/20261128000008_t3e_ej_verkstallda_behorigheter.sql`;
  - `supabase/rollback/T3-E/rollback_t3e.sql`;
  - `supabase/manual/t3e_standardroller/{standardroller.json, A_las_och_plan.sql, B_installera.sql, C_rollback.sql, D_overgangsregel_uttrycklig.sql}`;
  - `tests/t3e_installation.test.js`, `tests/t3e_standard_roles.test.js`, `tests/t3e_rollback.test.js`;
  - `tests/local/lib/t3e.js`, `tests/local/t3e-rollback.js`, `tests/local/t3e-skript.js`;
- ändrade:
  - `supabase/MIGRATIONSORDNING.txt`, `MIGRATIONSMAPPNING.md`, `migrationsmappning.json`;
  - `tests/local/{t3-andringar.js, t3-andringar.json, jamfor-schema.js, t3d-rollback.js, lib/ef.js, lib/paritet.js}`;
  - `tests/{replica_build, t3b_rollback, t3c_rollback, t3d_rollback}.test.js`;
  - `tests/e2e/fake-backend.js` (synkad).

**VIFT-CRM** (gren `claude/vift-v3-major-redesign`):
- ändrade:
  - `index.html`, `src/pages/PageShells.js`, `src/data/seedData.js`;
  - `tests/e2e/fake-backend.js`, `tests/e2e/specs/03_registers.js` (PROP-01 med egen roll chef − objects_sensitive; ROLE-01 ekonomi ser kunder enligt matrisen);
  - detta dokument, `docs/MASTERPLAN.md`, `docs/qa-2026-11-26/BEHORIGHETSMATRIS.md`;
- nya: `tests/rollnamn_guard.test.js`, `tests/e2e/specs/40_t3e_standardroller.js`.

### Commits

**vift-v2** (`claude/vift-system-restructure-8fUme`, inte pushad):
- `11ce9de` T3-E server: standardrollerna som manuellt skript (A–D, STOP, journal, rollback med expectedHash) och ej verkställda behörigheter verkningslösa (20261128000008)
- `bd9553e` T3-E tester: standard_roles (SEC-CUST-01..23, SEC-* per standardroll), ej verkställda behörigheter verkningslösa, installationsskriptet och införandeplanen per STAGING-roll, rollback, T3-facit, paritet och fake-backend

**VIFT-CRM** (`claude/vift-v3-major-redesign`, inte pushad):
- `823d086` T3-E klient: rolleditorns katalog och demorollerna = de fem standardrollerna
- `90f5f8f` T3-E tester: rollnamn_guard, fake-backend med standardrollerna, nya T3E-01–07, sju e2e-förväntningar anpassade till matrisen §2
- dokumentcommit och e2e-rapport: se `git log` efter `90f5f8f`
