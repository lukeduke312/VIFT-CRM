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

*(Fylls i av T3-C.)*

## T3-D – informationsåtkomst

*(Fylls i av T3-D.)*

## T3-E – standardroller

*(Fylls i av T3-E.)*
