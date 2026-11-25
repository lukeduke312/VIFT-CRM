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

## T3-A – klientskydd (SÄK-10, SÄK-9)

*(Fylls i av T3-A.)*

## T3-B – AO-kärna och arbetspool

*(Fylls i av T3-B.)*

## T3-C – roller och superadmin

*(Fylls i av T3-C.)*

## T3-D – informationsåtkomst

*(Fylls i av T3-D.)*

## T3-E – standardroller

*(Fylls i av T3-E.)*
