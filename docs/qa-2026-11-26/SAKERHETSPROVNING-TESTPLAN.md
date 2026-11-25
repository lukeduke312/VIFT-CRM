# VIFT CRM – test- och installationsplan för nästa säkerhetsomgång

2026-11-26. Planen samlar allt som ska prövas och installeras i nästa säkerhetsomgång, i vilken ordning, och vad som krävs för GO.

**Det här dokumentet kör ingenting.** Inga kommandon nedan är körda. Inga anrop har gjorts mot Supabase (varken STAGING eller LIVE).

**Hör ihop med:**
- `BEHORIGHETSMATRIS.md`: roller, målmatrisen R01–R47, testfallen `SEC-*`, besluten D-01…D-26 och fynden F1–F16;
- `BEHORIGHETER-BESLUTSUNDERLAG.md`, `SAKERHET-DEL10.md`, `KVARSTAENDE-PROBLEM.md`;
- `../qa-2026-11-25/C5-LASBEHORIGHET.md`.

---

## 1. Gränser som gäller hela omgången

| Regel | Hur den upprätthålls |
|---|---|
| **LIVE körs aldrig.** Ingen läsning, inga skrivningar, inga tester. | `tests/staging/lib.js` `guard()` nekar LIVE:s projekt-ref och godtar bara det hashlåsta STAGING-projektet (eller `127.0.0.1` i lokalt testläge) |
| Mutationstester bara mot **egna märkta testposter**: id börjar med körningens `runId` (`E2E-AUTHZ-<tid>-<slump>`), och text eller rubrik innehåller `[E2E-TEST]` | `authz-mutation.js` `testElement()`, `recovery.js` `isTest()` |
| **Befintliga verksamhetsposter rörs aldrig**, inte ens med en skrivning som förväntas nekas | Se §5.2: "befintlig post" i testet = testpost som ADM skapat tidigare i samma körning |
| Journal **före** varje mutation. Städning från journalen. "Återställt" påstås bara efter efterkontroll. | `recovery.js` (journal, högst 3 försök, efterkontroll) |
| Ostädad körning blockerar nya körningar | Spärrfil `rapport/OSTADAT-<runId>.lock`, `assertNoOpenLocks()` |
| Varje nivå 2-körning kräver uttryckligt GO, `--mutationstest`, `--bekrafta-projekt=<ref>`, `VIFT_MILJO=staging` och testkontomönster | `lib.js` `guard(2)`, `accounts()` |
| Inga hemligheter, personnummer, portkoder eller lösenord i rapporter, chatt eller git | Rapporterna redovisar fältnamn och ja/nej, aldrig värden (mönstret i `c5-read.js`). Exportfiler raderas efter kontroll (§6.4). |
| Serverändringar, migrationer och EF-installationer i STAGING kräver Lucas godkännande per steg. I LIVE ingår de inte i den här planen. | CLAUDE.md |

---

## 2. Nuläge: vad som är prövat och vad som inte är det

| Område | Prövat | Resultat | Inte prövat |
|---|---|---|---|
| C-5 läsbehörighet (`c5-read.js`) | REST, `readAllWithHashes`, `readWithHash` och `work-orders-list`-portkod för admin, chef, ekonomi, fält 1, fält 2 och begränsad | Grönt i STAGING 2026-11-25 | Artiklarnas `buyPrice`, `staff.permissions`, `activityLog`, `activities`, offertstubbar för fält (allt utanför C-5) |
| AO- och tidläsning (`authz-read.js` R1–R4) | Urval per roll, REST-lås, `readWithHash` på AO | Grönt | Tilldelad pool (`status=pool` + `staff`), F4 |
| PERM-03/G13 (`authz-mutation.js`) | **Bara "skapa ny post"** via `writeMerge`: 9 array-register × 4 roller | 36/36 som förväntat | Ändring och radering av befintlig post, hel nyckel (`write`), `vift_settings` (objekt), fältnivå, per-post-regler, 17 av de 28 nycklarna i `KEY_PERMISSIONS` |
| G9 / G6 / checklista | Ekonomi → `fakturerad`; dubbel `create_time`; tre lägen och ägarkontroll | Se `vift-v2/docs/STAGING-VERIFIERING-G6-G9-G13.md` | `ao_complete` på annans AO (F1) |
| Uppgifter (GO-6) | Skrivregler (`activities-policy.ts`), lokalt + STAGING | Grönt för skrivning | **Läsning** (O2) |
| 4 PostgreSQL-tester | – | **Aldrig körda**: `HOPPAS ÖVER` i `tests/run-all.sh` | Allt (§3) |
| Databasregler för B5, superadmin, `staff.role` | – | Finns inte än | – |

**Kända luckor i underlaget:**
- **G4 (serverkällor saknas)**, se F16 och G4 i matrisen:
  - `_staging_business_key_required_perm`;
  - `store_business_key_write` och `store_business_key_merge_write`;
  - `store_read_all_with_hashes`;
  - `work_order_create`/`_patch`/`_soft_delete`, `time_entry_*`;
  - Edge Functions `invoice-write` och `rondering-pass-write`.

  Ingen av dem finns i något av repona. Bara anropen finns.
- **Uppdelade repon:** `vift-v2` har 24 migrationer, bland dem C-5 (`20261125000003`) och `20261125000002`/`…04`, samt `ao-time-write` och `work-orders-list`. `VIFT-CRM` har 21 migrationer och saknar de tre senaste samt EF:erna `ao-time-write` och `work-orders-list`.
- **Testkonton:** STAGING:s ekonomikonto har `customer_manage`/`offer_manage` och motsvarar inte standardrollen Ekonomi (D-26). Rollen `personal` saknas i STAGING:s rollregister (P1 #8).

---

## 3. De fyra PostgreSQL-testerna

### 3.1 Vad de är och vad de prövar

Alla fyra ligger i `VIFT-CRM/tests/` och körs av `tests/run-all.sh`. Var och en börjar med `psql -d postgres -c 'select 1'`. Svarar ingen lokal server skriver testet `RESULT: … (HOPPAS ÖVER — ingen lokal PostgreSQL; INTE godkänt, inte kört)`. `run-all.sh` räknar det som **ÖVERHOPPAT, inte godkänt**.

| Testfil | Vad den prövar | Kräver | Isolering | Förväntat utfall |
|---|---|---|---|---|
| `checklist_progress_sql.test.js` (32 kontroller) | Checklistans tre lägen: RPC `work_order_checklist_set_state` och den äldre `work_order_checklist_resolve`, som delegerar. Kontrollerar att aktivitetsloggen inte skrivs, att `vift_lastChanged` uppdateras, ägarkontroller och pool-AO. | `psql`, lokal server, `supabase/migrations/20260917000001_…` och `20261123000002_…`. Skapar själv `anon`, `authenticated`, `service_role` och `public.store`. | Temporär databas `vift_chk_<pid>`, `drop … with (force)` vid avslut (kräver PostgreSQL ≥ 13) | `RESULT: 32 passed, 0 failed` (antalet kontroller kan variera med grenar) |
| `server_rpcs_sql.test.js` (17) | `activity_log_append` (först i loggen, idempotent, kapas vid `p_max`, kräver id och typ, uppdaterar `vift_lastChanged`) och `work_order_log_append`/`_remove` (samtidighet, noop vid saknad post, att bara `service_role` har EXECUTE) | Migrationerna `20261124000001_…`, `20261124000002_…` | `vift_rpc_<pid>` | `RESULT: 17 passed, 0 failed` |
| `offer_attachment_upload.test.js` (38) | Del 1 (statisk, körs alltid): repots `offer-attachment-upload` jämfört med installerade v12 rad för rad. Del 2: de installerade offert-RPC:erna (fixtur, md5-jämförd mot STAGING) + migrationen `20261125000001`: vitlista, `not_found`, behörighet (bara `service_role`), `SECURITY DEFINER`, samtidighet med `offer_attachment_append`. Del 3: EF-källan transpilerad med `tsc` och körd i Node mot samma databas (uppladdning, PATCH, DELETE, CORS). | Lokal server, **`tsc` i PATH** (annars räknas del 3 som FAIL), `tests/fixtures/staging_offer_rpcs_installed.sql`, `supabase/backup/staging-ef-fore-installation/offer-attachment-upload-v12/` | Egen temporär databas + `os.tmpdir()`-katalog | `RESULT: 38 passed, 0 failed` |
| `staging_backup_export.test.js` (12) | `tools/staging-backup-export.js`: ett backupschema med svåra tecken (citat, `$`, radbrytning, åäö) exporteras som CSV på samma sätt som i SQL Editor, verifieras och återställs i tom databas (`--provata-lokalt`). Kapad export avvisas. LIVE-ref i `--fran-api` avvisas. | Lokal server, `psql --csv` | `vift_bx_<pid>` + temporär katalog | `RESULT: 12 passed, 0 failed` |

**Om den femte filen:** `staging_e2e_real.test.js` hoppar också över, men av andra skäl: publiceringspaketet `/home/user/staging-release` eller Playwright saknas. Den kräver ingen PostgreSQL och ingår inte bland de fyra.

### 3.2 Alternativ A (rekommenderas): lokal PostgreSQL i container

En lokal databas utan Supabase-anslutning. Inga verksamhetsdata och ingen trafik till STAGING eller LIVE.

**Förutsättningar:**
- I sandlådan finns `psql`-klienten och `docker`-binären. Om Docker-daemonen körs är inte kontrollerat.
- Containeravbildningen hämtas från ett containerregister. Om nätverket nekar registret krävs en miljöändring, som godkänns separat.

**Steg (beskrivs, körs inte nu):**

1. Starta en engångsserver med samma huvudversion som Supabase (15), bara på loopback:

   ```bash
   docker run --rm -d --name vift-pg \
     -e POSTGRES_HOST_AUTH_METHOD=trust \
     -p 127.0.0.1:55432:5432 postgres:15
   ```

   `trust` används bara för att containern lyssnar på 127.0.0.1 och tas bort efteråt.

2. Peka `psql` dit utan att ändra testerna. Testerna anropar `psql -d postgres`, och `psql` läser miljövariablerna:

   ```bash
   export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres
   ```

3. Installera `tsc` för del 3 av `offer_attachment_upload`, t.ex. `npm i -g typescript` i sandlådan. Det påverkar inte repot (ingen `package.json`).

4. Kör testerna en i taget och sedan hela sviten:

   ```bash
   node tests/checklist_progress_sql.test.js
   node tests/server_rpcs_sql.test.js
   node tests/offer_attachment_upload.test.js
   node tests/staging_backup_export.test.js
   bash tests/run-all.sh
   ```

5. Städa med `docker stop vift-pg`. `--rm` tar bort containern och all data.

**Godkänt när:**
- alla fyra visar `PASS` i `run-all.sh`;
- `RESULT: N passed, 0 failed` utan `HOPPAS ÖVER`;
- summaraden har inga "ÖVERHOPPADE".

**Vid FAIL:** Ingen serverändring görs förrän felet är förklarat. Felen gäller migrationsfiler som redan är installerade i STAGING, så ett FAIL kan betyda att repot och STAGING skiljer sig. Jämför då med funktionsdefinitionerna (§3.4).

**Rapportera** hur testerna kördes ("lokal PostgreSQL 15 i container, ej STAGING") och testfilernas exakta utdata. Ett lokalt grönt resultat är **inte** ett STAGING-bevis.

### 3.3 Alternativ B: Supabase-gren av STAGING (kräver godkännande)

| | |
|---|---|
| Vad | En Supabase-gren (branch) skapas från STAGING-projektet. Migrationerna i repot körs mot en tom grendatabas. |
| Kräver | **Uttryckligt godkännande av Lucas.** En gren skapar en ny, debiterad resurs under STAGING-projektets organisation. Den får aldrig skapas från eller kopplas till LIVE. |
| Nackdelar | Grenen byggs från **repots** migrationshistorik, som är ofullständig (G4: kärn-RPC:erna saknas). Den motsvarar därför inte STAGING. Grenen har inga data och ger ingen fördel för de fyra testerna, som skapar egna data. Grenen måste tas bort efteråt (separat godkännande). |
| När den är motiverad | När G4-källorna finns i repot och man vill pröva **hela** migrationskedjan, med Supabase:s egna roller, `auth`-schema och RLS, innan installation i STAGING |
| Rekommendation | Använd **A** för de fyra testerna och de nya databastesterna (§3.4). Överväg B först i steg T4 (§7), när migrationshistoriken är komplett. |

### 3.4 Nya lokala databastester som omgången behöver

De här testerna finns inte än. De skrivs i implementationsomgången och körs på samma sätt som i §3.2.

**De flesta kräver G4-källorna.** Mönstret från `offer_attachment_upload` används:
- de installerade funktionsdefinitionerna hämtas **läsande** från STAGING (`pg_get_functiondef`, som i `vift-v2/supabase/manual/staging_backup_och_kontroll_2026-11-24.sql` → `function_definitions`);
- de checkas in som fixtur med md5;
- testet kontrollerar att fixturen fortfarande motsvarar STAGING.

Läsningen kräver GO.

| Nytt test | Prövar | Testfall |
|---|---|---|
| `store_read_by_role_sql` | `vift_store_full_access`/`vift_store_project`/RLS `store_read_by_role` per roll och nyckel, inklusive de nya reglerna (artiklar, personal, roller, offertstubbar, kunder) | SEC-B1-07/15, SEC-B3-06/07, SEC-OFF-01, SEC-KUND-04/07 |
| `store_merge_sensitive_sql` | Fältvis sammanslagning (B5) för `propertyObjects`, `recurringOrders`, `settings`, under radlås och med samtidiga skrivningar (två `psql` i bakgrunden, som i `server_rpcs_sql`) | SEC-B5-02…08, 17, 18; SEC-INST-09/10 |
| `superadmin_invariant_sql` | Minst en aktiv personal med `all` efter varje skrivning av `vift_staff` eller `vift_roles`, även vid samtidiga skrivningar. Fältregel för `role`/`active`. | SEC-ROLL-01…10 |
| `activity_projection_sql` | Urval per post för `activityLog` och `activities` (B4/Ö7) | SEC-B4-01…05, SEC-TASK-07/08 |
| `pool_rule` (Node, mot EF-källan som i `offer_attachment_upload` del 3) | `work-orders-list` + `ao-time-write` gren A/B och klarmarkering, med stubbad `checkViftAuth` | SEC-AO-05…16, SEC-POOL-01…11 |
| `material_pricing` (Node + SQL) | Servern sätter pris från artikel, `buyPriceUnknown`, radvis materialväg | SEC-B1-01…06, 10–14, SEC-B2-04/09 |

---

## 4. Utökad PERM-03/G13: skrivning och radering per roll × register × post × fält

### 4.1 Mål

Ersätta "skapa ny post 36/36" med en heltäckande skrivmatris som avgör BLOCKER-2. Varje kombination ska ge exakt det svar målmatrisen säger, och resultatet redovisas i en tabell.

Två körningar:
- **Baslinje** mot nuvarande server, före ändringarna. Den dokumenterar dagens läge, och de förväntade avvikelserna är listade i §4.5.
- **Efterkontroll** efter installation i STAGING.

### 4.2 Dimensioner

**Roller:** ADM, AL (`chef`), EK, FÄ, FÄ2 och BE, med testkonton som har **exakt standardrollerna** (D-26). Förväntan räknas om från kontots faktiska roll, som `authz-mutation.js` redan gör. Rollen skrivs i rapporten.

**Register:**
- alla 28 nycklar i `KEY_PERMISSIONS` (`store-key-write/index.ts:73-102`);
- de 6 läsbara extranycklarna (`vift_invoices`, `vift_offerEvents`, `vift_offerAttachments`, `vift_notifications`, `vift_ronderingspass`, `vift_projectDocuments`), som alltid ska ge `key_not_allowlisted` vid skrivning;
- `vift_workOrders`/`vift_timeEntries`, som ska nekas via `store-key-write` och bara gå via `ao-time-write`.

**Operationer per register och roll:**

| Op | Beskrivning | Hur den görs utan att röra verksamhetsdata |
|---|---|---|
| O1 Skapa | `writeMerge` med ny testpost, `previous:null` | Som i dag |
| O2 Ändra befintlig | `writeMerge` med `previous` = testpostens lagrade värde och ett ändrat fält | Testposten skapas först av **ADM** (fas 1). För den prövade rollen är den en befintlig post. |
| O3 Radera befintlig | `writeMerge` med `removals:[{id, previous}]` | ADM-skapad testpost |
| O4 Fel `previous` | O2 med inaktuellt `previous` | Ska ge konflikt, aldrig skrivning |
| O5 Radering utan `previous` | `removals:[{id}]` | Ska ge 400 `invalid_element` |
| O6 Hel nyckel (`write`) | `write` med `expectedHash` | **Bara** med värdet = aktuellt servervärde + en testpost (array) eller + en testegenskap (objekt). Aldrig ett reducerat eller ändrat värde, så att även en felaktigt godkänd skrivning bara lägger till testdata. Aktuell hash krävs, så en samtidig verklig ändring ger 409 i stället för att skrivas över. |
| O7 `write` utan hash | Samma som O6 utan `expectedHash` | Ska ge 409 `missing_expected_hash` |
| O8 Fältnivå | Bara för register med skyddade fält (§6.1) | ADM-skapad testpost med skyddade fält satta till testvärden (`[E2E-TEST]-kod`) |

**Per-post-regler** (egen/andras) prövas där de finns:
- `vift_activities`: SEC-TASK-01…11;
- `vift_staff`: egen post och annans post (SEC-ROLL);
- framtida `vift_ronderingspass`.

**Storlek:** ca 36 register × 6 roller × 5–8 operationer ≈ 1 100–1 700 anrop per körning. Körs med en paus mellan anropen (t.ex. 100–200 ms) och utanför arbetstid, så att DataSync hos riktiga användare inte påverkas onödigt. Varje lyckad skrivning uppdaterar `vift_lastChanged`, och alla klienter läser då om.

### 4.3 `vift_settings` och andra objektformade nycklar

- `vift_settings` skrivs bara som **hel nyckel** (`write`).
- Testet lägger till egenskapen `e2eTest_<runId>` (teststräng) och tar bort den igen. Varje steg sker under `expectedHash`.
- Ingen befintlig egenskap ändras någonsin. Varken bankgiro, färger eller villkor.
- **Kontrollsumma:** SHA-256 av kanoniskt JSON (sorterade nycklar) för hela värdet **utan** `e2eTest_*`, före och efter. Dessutom ska serverns hash efter återställningen vara identisk med den före. `jsonb` normaliserar ordningen, så samma innehåll ger samma hash.
- **Risk:** En verklig administratör som sparar inställningar under testfönstret får 409 och måste spara igen. Kör därför utanför arbetstid och meddela i förväg.
- Negativa skrivtester (AL, EK, FÄ, BE) skickar exakt samma värde som O6. En felaktigt godkänd skrivning ändrar därför bara testegenskapen, och den städas från journalen.

### 4.4 Rapport

- Rapporten innehåller en tabell `register × roll × operation → förväntat / faktiskt / OK|AVVIK`. Avvikelser delas upp i:
  - **"felaktigt tillåtet"**: säkerhetsfel, NO-GO;
  - **"felaktigt nekat"**: funktionsfel.
- Verktyget blir en ny fil (förslag: `vift-v2/tests/staging/authz-mutation-full.js`). Den återanvänder `lib.js` och `recovery.js` oförändrade och får samma spärrar och utgångskoder:
  - 0 OK;
  - 1 avvikelse;
  - 2 spärr;
  - 3 testposter kvar;
  - 4 befintlig post ändrad;
  - 5 avbruten.
- Verktyget skrivs i implementationsomgången, inte nu.

### 4.5 Förväntade avvikelser i baslinjen (nuvarande server)

| Fynd | Förväntat i baslinjen | Ska efter omgången vara |
|---|---|---|
| F5 | Roll med `staff_manage` kan ändra `role` på egen personalpost (prövas bara om ett testkonto med en sådan roll finns; ingen standardroll har den) | Nekat |
| F1 | FÄ kan sätta `klar` på test-AO där FÄ inte är tilldelad, och från `fakturerad` | Nekat |
| F4 | FÄ2 kan ta en test-AO med `status:pool` och `staff:[FÄ]` | Nekat |
| B5 | AL utan `objects_sensitive` får `doorCode` i data | Saknas, och skrivning bevarar fältet |
| O2 | FÄ läser andras uppgifter | Saknas |
| B1 | FÄ läser `articles[].buyPrice` och `materials[].buyPrice` | Saknas |

---

## 5. Isolering, journal och kontrollsummor

### 5.1 Testdata

| Typ | Märkning | Skapas av | Tas bort av |
|---|---|---|---|
| Registerpost (array) | `id` = `<runId>-<register>-<roll>-<op>`, `name`/`title`/`text` = `[E2E-TEST] …`, `e2eTest: runId`, `active:false`, `deleted:true` där fälten finns | ADM eller den prövade rollen (O1) | `writeMerge removals` (ADM), från journalen |
| Testegenskap i objekt (`vift_settings`) | `e2eTest_<runId>` | ADM | ADM `write` |
| Test-AO | `id` = `<runId>-AO…`, `title` = `[E2E-TEST] …`, `e2eTest` | ADM `create_ao` | `delete_ao` + `permanent_delete_ao` |
| Tidpost | `<runId>-T…`, kommentar `[E2E-TEST]` | FÄ/ADM | `delete_time` |
| Uppgift | `<runId>-ACT…`, titel `[E2E-TEST]` | respektive roll | `writeMerge removals` |
| Objekt med portkod | `<runId>-OBJ…`, `doorCode:'[E2E-TEST]-0000'` | ADM (+ `set-sensitive-fields` för tabellraden) | ADM, och tabellraden tas bort |
| Kund (exporttest) | `<runId>-KU…`, påhittat personnummer i ett format som inte kan vara verkligt | ADM | ADM |

### 5.2 "Befintliga poster" utan att röra verksamhetsdata

För den prövade rollen är en post "befintlig" om den fanns **innan rollens anrop**. Testet skapar därför posterna med ADM i fas 1, prövar ändring och radering med varje roll i fas 2, och städar i fas 3.

Verkliga poster används **aldrig** som mål, inte heller för negativa tester. En felaktigt godkänd skrivning mot en verklig post vore en verklig ändring.

### 5.3 Kontrollsummor före och efter

Utöver `recovery.js`, som jämför element för element och AO:ns `updatedAt`:

1. **Före** (ögonblicksbild som ADM): per nyckel SHA-256 över kanoniskt JSON för värdet **utan testelement**, plus serverns hash från `readAllWithHashes`. Antal element per nyckel. AO och tidposter via `work-orders-list`/`time-entries-list`.
2. **Efter** städning: samma beräkning. Kraven:
   - kontrollsummorna utan testelement ska vara **identiska**;
   - serverns hash ska vara identisk när inga testelement finns kvar;
   - antalet element ska vara oförändrat.
3. Skillnad i en verklig post ger **utgångskod 4** och NO-GO tills den är förklarad.
4. Kontrollsummorna skrivs i rapporten (hashar och antal, aldrig värden).

**Återställs inte, och redovisas:**
- `vift_lastChanged`, `store.updated_at`;
- `op_idempotency`;
- inloggningar i `auth`;
- EF-loggar;
- poster som skrivs med `appendActivity` (se §6.3).

### 5.4 Ordning inom en körning

| Fas | Innehåll |
|---|---|
| 0 | Spärrar → inloggning → ögonblicksbild före → kontroll att inga gamla testposter finns → plan skrivs ut (`--torrkorning` stannar här) |
| 1 | ADM skapar testposter (journal före varje anrop) |
| 2 | Rolltester (journal före varje anrop) |
| 3 | Städning från journalen + sökning på `runId` |
| 4 | Ögonblicksbild efter → kontrollsummor → rapport. Vid misslyckad efterkontroll: kod 3 + spärrfil. Kör `--stada=<runId>`. |

---

## 6. Särskilda områden

### 6.1 Skyddade fält vid samtidig redigering (B5, `vift_settings`)

**Målet:** En roll utan läsrätt till ett fält kan inte ändra eller tömma det. Två samtidiga skrivare förlorar aldrig varandras ändringar tyst.

| Scenario | Genomförande | Testfall |
|---|---|---|
| Skrivare utan läsrätt sparar posten utan det skyddade fältet | AL (utan `objects_sensitive`) `writeMerge` på ADM:s testobjekt, `doorCode` saknas i `data` | SEC-B5-02 |
| Skrivare försöker tömma eller sätta fältet | `doorCode:''` / `'1234'` | SEC-B5-03/04 |
| Samtidig ändring | `Promise.all([ADM ändrar doorCode, AL ändrar namn])` med samma `previous` | SEC-B5-07 |
| Inaktuell läsning | AL läser → ADM ändrar `doorCode` → AL sparar med gammalt `previous` | SEC-B5-08 |
| Inställningar | ADM och ADM2 ändrar var sin testegenskap samtidigt | SEC-INST-09/10 |
| AO-portkod | `ao_edit` sparar AO utan `accessCode` | Fältet bevaras (samma mekanism i `ao-time-write`) |

**Bedömning efter varje scenario:** ADM läser testposten och jämför skyddade fält mot förväntat testvärde. Utfallet redovisas som ja/nej, aldrig som värde.

**Lokalt först:** Samtliga scenarier körs först i den lokala databasen (§3.4, `store_merge_sensitive_sql`), där riktig samtidighet kan styras.

### 6.2 Materialpriser och marginaler (B1/B2/Ö4)

- **Läsning:** FÄ/BE får aldrig `buyPrice` (artiklar, materialrader), `internalHourlyCost` eller TB. Försäljningspris och timpris följer D-09/D-11. Prövas via EF-svaren, **inte** via UI:t. UI kontrolleras separat i webbläsartestet (`e2e-real.js`, fältroll).
- **Skrivning:** Servern sätter pris från artikel-id. Fritext ger okänt inköpspris (`null` + flagga, **aldrig 0**). Fält kan inte sätta pris och kan inte ändra eller ta bort andras rader (D-19).
- **Komplettering:** Bara `cost_edit`. Fakturakön och rapporter visar okänt pris som okänt (SEC-B1-13/14).
- **Testdata:** En test-AO tilldelad FÄ, två testartiklar (ADM skapar dem i `vift_articles`, med `[E2E-TEST]` och `active:false` så att de inte syns i riktiga materialdialoger) och en fritextrad.
- **Testfall:** SEC-B1-01…19, SEC-B2-01…11.

### 6.3 Aktivitetslogg och uppgifter

**Observation O2 – fältrollens Uppgifter-sida visar andras uppgifter.** Klassificeras som **läckage (P1), inte avsedd regel**.

*Kodreferenser:*
- `src/pages/PageShells.js:11905`: `const acts = state.activities || []`.
- `src/pages/PageShells.js:11931`: standardfiltret "Alla öppna" visar alla öppna uppgifter oavsett `assignedTo`/`createdBy`.
- Servern lämnar ut hela `vift_activities` till alla aktiva:
  - `vift-v2/supabase/migrations/20261125000003_store_read_by_role.sql:93` (`else true`);
  - `store-key-write` `READABLE_KEYS`.
- `activities-policy.ts` gäller bara skrivning.

*Varför det är läckage:* Den beslutade inriktningen (Ö7/B4) kräver att servern filtrerar uppgifter efter behörighet och tilldelning. Uppgifterna innehåller kund, fastighet, offert- och AO-koppling samt fri text.

**Test:**
- SEC-TASK-07…12 och SEC-B4-01…08, via EF-svar per roll;
- testuppgifter skapade av AL och tilldelade FÄ2, med `relatedType: offer` till en testoffert;
- dessutom UI-kontroll av Uppgifter-sidan och dashboardens "Mina uppgifter" och "Senaste händelser" för FÄ.

**Isoleringsvarning för `appendActivity`:**
- Aktivitetsloggen är **append-only**. Testposter kan inte tas bort via klientvägen, och loggen kapas vid 500 poster (äldst först).
- Loggen hade 179 poster 2026-11-26. Varje testpost tar alltså plats, och efter ca 320 poster börjar verkliga poster tryckas ut.
- **Regel:**
  - prövning av `appendActivity` (SEC-B4-07) och urvalet av loggposter görs i första hand **lokalt** (§3.4);
  - i STAGING högst ett fåtal märkta poster (`description` börjar med `[E2E-TEST] <runId>`) med GO;
  - antalet redovisas;
  - inga massprov.

### 6.4 Export och känsliga fält

**Observation O1 – Exportcenter visar Personnummer förvalt ikryssat.** Klassificeras som **P2: brist i dataminimering och standardval. Ingen serverläcka utöver läsrätten.**

*Kodreferenser:*
- `src/services/ImportExportConfigs.js:49`: `sensitiveFields: []` för kunder.
- `src/services/ImportExportConfigs.js:60`: `personnr` är ett vanligt fält.
- `src/pages/ExportCenterPage.js:135-142`: `_initCols()` kryssar i alla icke-känsliga fält.
- `ExportCenterPage.js:123`: texten "Känsliga fält är av som standard" stämmer inte.
- `ExportCenterPage.js:189`: valet för känsliga fält bygger på `objects_sensitive` och gäller bara portkoder och nycklar.
- Snabbexporten `CustomersPage.js:108` → `ImportExportConfigs.js:1406` (`buildExportRowsForType`) tar alltid med personnummer.

*Exporteras personnummer för fel roller?*
- Bara i den mån rollen redan får läsa det. Servern (`vift_store_project`) skickar `personnr` bara till `customer_manage`, `invoice_*`, `offer_manage`, `sales_manage`, `ao_view_all` och `all`.
- För `customer_view` utan någon av dessa blir kolumnen tom.
- Fält och begränsad når inte kundexporten.
- Om `sales_manage`/`ao_view_all` alls ska ha personnummer avgörs av D-13.
- Kvarstående risk: lokal cache från föregående användare på delad enhet (F6, §6.6).

**Test:**
- SEC-EXP-01…13 i webbläsare (Playwright, `e2e-real.js`-mönstret) per roll, med en **testkund** som har påhittat personnummer.
- Exportfilen läses automatiskt i testet. Kontrollen gäller bara om kolumnrubriken finns och om testkundens värde förekommer.
- Filen raderas direkt.
- Exportfiler från STAGING sparas aldrig, checkas aldrig in och klistras aldrig in i chatt. De kan innehålla verkliga uppgifter.

**Krav som ska prövas efter rättningen:**
1. Personnummer och org.nr för privatperson räknas som känsliga fält, av som standard.
2. Aktivt val kräver egen behörighet (D-18).
3. Snabbexport och Exportcenter följer samma regel.
4. Portkod, nyckelinfo och lösenord tas aldrig med automatiskt.

### 6.5 Arbetspoolen

Affärsregeln utreds parallellt. Testerna (SEC-POOL-01…11) är skrivna mot den beslutade inriktningen:
- öppen pool (status `pool` och tom `staff`) kan tas av behörig fältpersonal;
- tilldelad men oplanerad AO får varken ses eller tas av annan fältpersonal.

**Dataregeln måste fastställas först (D-24),** eftersom dagens server behandlar varje `status:pool` som öppen (F4).

**Testdata:** tre test-AO skapade av ADM:
- öppen pool;
- pool med `staff:[FÄ]`;
- `planerad` utan datum med `staff:[FÄ]`.

**Samtidighetsfallet** SEC-POOL-06 prövas med `Promise.all` för FÄ och FÄ2. Exakt en får lyckas.

### 6.6 Lokal cache och delad enhet

`Auth._clearSession()` (`src/services/AuthService.js:628-650`) rensar bara tidposter och AO. Övriga `vift_*` ligger kvar i `localStorage`, och vid degraderad inläsning används `Storage._localAll()` (`src/data/state.js:983`).

**Test i webbläsare:**
- SEC-CACHE-01…04: ADM loggar in, loggar ut, och FÄ loggar in på samma profil.
- `localStorage` kontrolleras med avseende på fältnamn, inte värden.
- Kontrollen görs även med nätet avstängt efter inloggningen.

---

## 7. Ordning, förutsättningar och GO-punkter

| Steg | Innehåll | Förutsättning | GO | Rör STAGING? |
|---|---|---|---|---|
| **T0** | Affärsbeslut D-01…D-26 (minst D-01, D-03, D-05, D-09, D-11, D-13, D-16, D-18, D-24, D-25 före serverkod) | Matrisen | Lucas | Nej |
| **T1** | **G1/G4: hämta serverkällorna** läsande från STAGING. Funktionsdefinitioner för `store_business_key_*`, `_staging_business_key_required_perm`, `store_read_all_with_hashes`, `work_order_*`, `time_entry_*`, `activity_log_append`, displayNumber-logiken. EF-källor för `invoice-write`, `rondering-pass-write` och de installerade versionerna av `ao-time-write`/`store-key-write`/`work-orders-list`. Samla migrationerna i **ett** repo med fullständig historik. | – | Lucas (läsning av STAGING) | Läsning |
| **T2** | Lokal PostgreSQL: de 4 befintliga testerna (§3.2) + nya databastester för **nuvarande** regler (baslinje lokalt) | T1 för de nya testerna. De 4 befintliga kräver inte T1. | Behövs inte (lokalt) | Nej |
| **T3** | Baslinje i STAGING: `c5-read.js`, `authz-read.js`, `authz-mutation.js --torrkorning` och sedan skarpt, samt den nya fullmatrisen (§4) mot nuvarande server. Förväntade avvikelser enligt §4.5. | Testkonton med standardroller (D-26), testverktyget skrivet och lokalt prövat (`VIFT_LOKALT_TESTLAGE=1` mot den simulerade servern) | Lucas: GO för nivå 1 och nivå 2 | Ja, bara testposter |
| **T4** | Implementation av serverändringarna (§8) i gren. Nya lokala tester gröna. Granskning. Eventuellt Supabase-gren (§3.3). | T0, T1, T2 | Lucas för Supabase-gren | Nej (gren: separat resurs) |
| **T5** | Installation i STAGING enligt §8, med backup och återställning | T4 grön. GO/NO-GO §9.1. | Lucas, per migration och EF | Ja |
| **T6** | Efterkontroll i STAGING: alla verktyg från T3 mot målmatrisen + webbläsartest (`e2e-real.js`) per roll + manuell UI-kontroll på mobil för fältrollen | T5 | Lucas: nivå 2 | Ja, bara testposter |
| **T7** | Bedömning enligt §9.2. LIVE-planen (P1 #1) är ett **separat** beslut. | T6 | Lucas | Nej |

**Ordning mellan B-punkterna** (enligt underlaget, justerad):
1. F7 (klientens rollreserv), före standardrollerna.
2. Standardroller och rollregister.
3. B3 och D-21 (projektion av personal och roller).
4. B4/Ö7 (logg och uppgifter per post).
5. F1/F4/F15 (AO- och poolregler).
6. B1/B2/Ö4 (material och priser).
7. B5 + P1 #5 (fältvis sammanslagning, samma mekanism för settings).
8. Sista superadmin och F5.
9. Export (O1) och cache (F6) på klientsidan.

B1 och B5 ändrar skrivvägar och installeras i samma serveromgång med full regression.

---

## 8. Installationssteg för kommande serverändringar (beskrivs, körs inte)

### 8.1 Förväntade ändringar

| Id | Ändring | Typ | Berör |
|---|---|---|---|
| M1 | Utökade läsregler: artiklar (`buyPrice`), personal (`permissions`/`role`/`email` utom egen post), roller (egen), offertstubbar (bara kopplade till egen AO), kunder (D-13), `settings.internalHourlyCost` (`cost_view`) | Migration (ersätter `vift_store_full_access`/`vift_store_project`) | RLS + `store-key-write` |
| M2 | **Urval per post** för `vift_activityLog` och `vift_activities` | Migration + EF | `vift_store_project(key, value, perms)` känner inte anroparens personal-id eller AO-urval. Kräver ny signatur (t.ex. `p_caller_staff_id` + uppsättning synliga AO-id) eller projektion i `store-key-write`. RLS måste neka direkt REST för de här nycklarna för roller utan full åtkomst. |
| M3 | Fältvis sammanslagning för `propertyObjects`, `recurringOrders`, `settings`. Fältregel för `staff.role`/`active`. Invarianten "≥1 aktiv med `all`" (gäller två nycklar, `vift_staff` + `vift_roles`, så samma lås krävs i båda skrivvägarna, t.ex. `pg_advisory_xact_lock`). | Migration (RPC) + `store-key-write` | B5, P1 #4/#5, F5 |
| M4 | `ao-time-write`: nya behörigheter, kontroll av egen AO och källstatus vid klarmarkering, radvis materialväg med serverpris och `buyPriceUnknown`, timpris satt av servern, poolregel | EF (+ ev. RPC) | F1, F2, F4, F15, F16 |
| M5 | `work-orders-list`: poolregel (D-24), projektion av pris (D-06). `time-entries-list`: projektion av `hourRate` (D-11). | EF | |
| M6 | `get-sensitive-fields`: gren för tilldelad AO med revisionslogg (D-05). Eventuell engångsmigrering av portkoder från blob till tabell (D-16). | EF (+ datamigrering, separat GO) | |
| M7 | `rondering-pass-write`: `rondering_utfor`, egna pass | EF (källa från T1) | Ö3 |
| M8 | Faktura: separat `internalNote`, PDF tar bara med kundkommentar | Klient (+ EF om PDF:en genereras på servern) | P1 #3 |
| M9 | Rollregistret: standardroller i `vift_roles` | **Dataändring** (journal + backup av nyckeln) | P1 #8 |
| M10 | Klient: rollreserv (F7), rensning vid utloggning (F6), exportregler (O1/F12), uppgiftsregler (F8), materialdialog, gömda priser, tolerans för projicerade fält | Klientpaket (versionshöjning `?v=N`) | |

### 8.2 Före installation

1. **Backup i databasen:** schema `vift_staging_backup_<datum>` med `store`, `op_idempotency` och `function_definitions`. Mönster: `vift-v2/supabase/manual/staging_backup_och_kontroll_2026-11-24.sql`. Körs i SQL Editor av Lucas eller med hans GO.
2. **Extern kopia:** exportera backupschemat som CSV och verifiera med `tools/staging-backup-export.js --fran-csv=… --provata-lokalt`. Det återställer i en lokal tom databas och avvisar kapade filer. Kopian lagras utanför git.
3. **EF-backup:** ladda ned den installerade versionen av varje EF som ska bytas till `supabase/backup/ef-installerade-<datum>/<namn>-v<N>/`. Mönster: `store-key-write-v4`, `work-orders-list-v2`, `ao-time-write-v3`.
4. **Återställnings-SQL** i varje migrations filhuvud (som i `20261125000003`), **prövad lokalt**: installera, återställ, installera igen.
5. **Kompatibilitet:** varje serverändring ska fungera med **både** gammal och ny klient. En gammal klient finns kvar i Service Worker-cachen tills den laddas om. Exempel:
   - gammal klient som skickar `buyPrice` → servern ignorerar fältet;
   - gammal klient som sparar ett objekt utan `doorCode` → fältet bevaras;
   - projicerad personal utan `permissions` → klienten kraschar inte.
6. Inga öppna spärrfiler (`OSTADAT-*.lock`). Inga [E2E-TEST]-rester.
7. Kontrollsummor (§5.3) för alla nycklar sparas före installationen.

### 8.3 Installationsordning i STAGING

Varje punkt sker med separat GO. Efter varje steg körs `c5-read.js` + `authz-read.js`, som är läsande.

1. **M10 del 1, F7** (klientens rollreserv), om klientpaketet tillåter delpublicering. Annars ingår det i steg 6 och M9 väntar.
2. **M9** rollregistret (dataändring): journal med före- och eftervärde för `vift_roles`. Återställning = skriv tillbaka förevärdet med hash.
3. **M1 + M2** läsregler (migration + `store-key-write`).
4. **M3** skrivregler (migration + `store-key-write`). Därefter fullmatrisen §4 för registren.
5. **M4 + M5 + M6 + M7** EF:er, en i taget, med `authz-mutation`-delarna för AO, tid och pool efter varje.
6. **M10** klientpaket till STAGING (`staging/gh-pages`-flödet).
7. **T6** hela efterkontrollen.

### 8.4 Återställning

| Nivå | Utlöses av | Åtgärd |
|---|---|---|
| EF | Fel svar eller felaktigt tillåtet i efterkontrollen | Installera föregående version från `supabase/backup/ef-installerade-<datum>/` |
| Migration | Fel i läs- eller skrivregel | Kör filhuvudets återställnings-SQL (prövad lokalt). Installera sedan föregående EF-version om den beror på migrationen. |
| Data (M9, M6-migrering) | Fel rollregister eller fel portkodsflytt | Skriv tillbaka nyckelns förevärde från journalen (med hash), eller återställ från backupschemat |
| Klient | UI-regression | Publicera föregående STAGING-paket |
| Allt | Kontrollsumma för verkliga poster avviker (kod 4) | Stoppa omgången. Jämför mot backupschemat. Ingen ny installation förrän orsaken är känd. |

---

## 9. GO/NO-GO-kriterier

### 9.1 GO för installation i STAGING (T5)

Alla villkor ska vara uppfyllda:

- [ ] Besluten som styr ändringen är fattade och inskrivna i matrisen (T0).
- [ ] Serverkällorna (G4) finns i repot och stämmer med STAGING (md5-jämförda funktionsdefinitioner).
- [ ] De **4 PostgreSQL-testerna** visar PASS (inte SKIP) i en dokumenterad lokal miljö.
- [ ] Alla **nya** lokala databastester för ändringen är gröna, även samtidighetsfallen.
- [ ] Hela `tests/run-all.sh` är grön utan överhoppade filer (Playwright-delen dokumenteras om den saknas).
- [ ] Backup gjord. Den externa kopian är verifierad med `--provata-lokalt`. EF-backup finns.
- [ ] Återställnings-SQL är prövad lokalt (installera → återställ → installera).
- [ ] Testkonton med exakt standardrollerna finns. Inga öppna spärrfiler.
- [ ] Baslinjen (T3) är körd, och avvikelserna motsvarar §4.5.

**NO-GO** om något av ovanstående saknas.

### 9.2 Omgången godkänd i STAGING (T6 → T7)

**GO när:**
- `c5-read.js`: 0 avvikelser mot den **nya** förväntan (utökad med B1/B3/B4/O2/D-12/D-13).
- `authz-read.js`: 0 avvikelser.
- Fullmatrisen (§4):
  - **0 felaktigt tillåtna** skrivningar eller raderingar;
  - felaktigt nekade är förklarade och åtgärdade, eller uttryckligen accepterade av Lucas.
- Alla testfall i `BEHORIGHETSMATRIS.md` med rad markerad P1 eller ⚠ är godkända:
  - SEC-AO-05/13/14;
  - SEC-POOL-09/10/11;
  - SEC-B1-03/07/08/09/13;
  - SEC-B3-06;
  - SEC-ROLL-01/05…10 (lokalt);
  - SEC-B4-02…05;
  - SEC-TASK-07/08/12;
  - SEC-B5-01…08;
  - SEC-FAKT-06;
  - SEC-EXP-09/10;
  - SEC-CACHE-01/02.
- Städning:
  - utgångskod 0 i alla nivå 2-körningar;
  - kontrollsummorna (§5.3) för verkliga poster är identiska före och efter;
  - antalet `appendActivity`-testposter är redovisat.
- `e2e-real.js` (webbläsare) grönt för admin, arbetsledare, fält och begränsad. Manuell mobilkontroll av fältets flöden:
  - starta, klarmarkera och ta jobbet;
  - material utan pris;
  - utföra rondering;
  - egna uppgifter.
- Ingen funktion är borttagen utan Lucas godkännande (CLAUDE.md).

**NO-GO direkt vid:**
- ett skyddat fält (inköpspris, intern timkostnad, portkod, nyckelinfo, personnummer, offerttoken, andras behörigheter eller uppgifter) syns för en roll där målmatrisen säger "–";
- en skrivning eller radering lyckas för en roll som ska nekas;
- utgångskod 3 eller 4 som inte är löst;
- ett obligatoriskt test är HOPPAS ÖVER;
- sista superadmin kan inaktiveras i det lokala testet;
- `e2e-test-cleanup` eller STAGING-referenser finns i ett paket avsett för LIVE.

### 9.3 LIVE

**Förblir NO-GO** tills:
- omgången är godkänd i STAGING (§9.2);
- en separat LIVE-plan (P1 #1) är beslutad med backup, migrationsordning, EF-versioner, klientpaket, återställning och verifiering.

Den här planen innehåller inga steg mot LIVE.
