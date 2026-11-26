# T4-resultat (säkerhetsomgången T4)

Ett avsnitt per paket, i ordningen T4-A + T4-B (samordnat), T4-C, T4-D, T4-E, T4-F. Varje paket uppdaterar sitt eget avsnitt; inga nya dokument.
Styrande beslut: `BESLUT-2026-11-28.md`, avsnittet "Tillägg efter T3-leveransen".
Verifieringsnivån är **lokalt verifierad**: lokal PostgreSQL 16.15, Edge Functions körda i Node, webbläsartester mot den simulerade servern.
Ingenting är installerat eller verifierat i STAGING. LIVE är inte kontaktad. PostgreSQL 17 och Deno kunde inte hämtas i miljön (paketkällorna saknar DNS-uppslag); de kvarstår som releasevillkor.

### Läge och återupptagning

- **T4-A** (inkl. tilläggsdel notiser): lokalt klar (vift-v2 `2060b8f`, VIFT-CRM `64a4e2b`); notisbesluten fastställda 2026-11-28 (läsläckan P1).
- **T4-B**: lokalt klar — se avsnittet "T4-B" nedan (commits och testsiffror där). Installeras i samma serveromgång som T4-A (samlad plan: T4-B §11).
- **Nästa:** T4-C → T4-D → T4-E → T4-F i oförändrad ordning, därefter samlad regression och T4-leveransen.

---

## T4-A – skyddade fält och projektion (B5 + B1-projektion)

Verifieringsnivå: **lokalt verifierad** (PostgreSQL 16.15, Edge Functions körda i Node mot den lokala
STAGING-replikan, webbläsartester mot den simulerade servern). Ingenting är installerat eller verifierat
i STAGING. LIVE är inte kontaktad. Inga läsningar mot STAGING behövdes (STAGING:s rollregister ur
T3-E:s läsning 2026-11-28 används i införandeanalysen). T4-A installeras i **samma serveromgång som
T4-B**; T4-B kompletterar installations- och rollbackdelen nedan.

### Sammanfattning

| Del | Resultat |
|---|---|
| Projektion även för skrivare (C-5 regel 1 ersatt, SÄK-7 P1) | `vift_store_full_access` ger hela värdet (och direkt REST-läsning) bara när anroparen får **läsa alla skyddade fält** i nyckeln — även skrivaren. `vift_store_project` tar bort de skyddade fält som anroparen inte får läsa: portkod och nyckelinformation (`objects_sensitive`) i kunder, fastigheter, objekt, kontakter och återkommande ärenden; personnummer och privatpersoners org.nr (`personal_data_view`, D-13 slutförd); artiklarnas inköpspris och påslag (`cost_view`); intern timkostnad (`cost_view`) och bankgiro (interna roller) i inställningarna. `work-orders-list` och AO i **alla** skrivsvar (ao-time-write, work-order-log-write, work-order-checklist-resolve, invoice-write) projiceras med `projectWorkOrder`: portkod bara med `objects_sensitive` (C-5-undantaget för `ao_edit` borttaget), `materials[].buyPrice` bara med `cost_view`, AO-ekonomi (`fixedPrice`) inte till fältroller (D-06). |
| Fältvis sammanslagning under radlås (B5) | `store_business_key_write` och `_merge_write` (ny parameter `p_klient`, default null) och `work_order_patch` (samma signatur) prövar skyddade fält på den låsta raden med anroparens behörigheter lästa i samma transaktion. Ett fält som anroparen inte får skriva **bevaras** när det saknas (projicerat värde raderar aldrig) och **nekas** med 403 `forbidden`/`field_protected` när det skickas (tomt mot tomt godtas; ett oläsbart fält jämförs aldrig mot det lagrade — inget orakel). `previous` i `writeMerge` jämförs med elementet så som anroparen får se det. Ny materialrad med inköpspris utan `cost_edit`: priset ignoreras (`ignoredFields`, serverpris i T4-B). |
| Inställningar konfliktsäkert (D-17) | `writeMerge` för `vift_settings` fält för fält (`{id: fältnamn, data, previous}`) under radlås: samtidiga ändringar av olika fält tappas aldrig (SEC-INST-05 ×20), samma fält ger konflikt (exakt en vinner ×20). Bankgiro kräver `bankgiro_edit`, intern timkostnad `cost_edit`. T4-klienten sparar inställningarna fält för fält; v3.4 skriver hela värdet och de skyddade fälten bevaras ändå. |
| Verkställda behörigheter | `cost_view`, `cost_edit` (skyddade fält; prisflödet är T4-B), `personal_data_view` och `bankgiro_edit` borttagna ur `_vift_ej_verkstallda()`, `standardroller.json` och fake-backendens lista. Varje behörighet ger exakt den beslutade åtkomsten och inget mer (profiltest i `t4a_skyddade_falt` och T3-E-testets SEC-CUST-01/08/20). `time_view_all` lämnad till T4-B. |
| `staff_contacts_view`, `activity_log_view_all` (T3-D 2/6, T3-E 4) | Uttryckliga behörigheter i katalogen, matrisen, standardrollerna, seed och fake. Arbetskontakt till kollegor kräver `staff_contacts_view` (standard: admin, chef, ekonomi, personal; inte begransad). Hela aktivitetsloggen kräver `activity_log_view_all` (admin, chef, ekonomi); utan den bara händelser för AO där man är tilldelad. **Övergångsregel** (som T3-B §4.6): en roll som saknar båda behåller T3-D/T3-E:s härledning, så att ingen befintlig STAGING-roll tappar åtkomst vid installationen. |
| `chef` + `reports_view` (T3-E 5) | Matrisen §2, `standardroller.json` (version `t4a-2026-11-28`, skript A–D omgenererade), seed och fake. Rapporter följer den underliggande behörigheten: servern lämnar inte ut personnummer, portkoder, inköpspris eller intern timkostnad utan respektive behörighet, och `time-entries-list` ger chef bara egna tidposter tills `time_view_all` verkställs i T4-B; löneunderlaget kräver fortfarande `payroll_view` (e2e T4A-06, T3E-02). |
| Äldre klienters rollskrivning (T3-E-beslutet) | En rollskrivning **utan katalogmarkör** (v3.4 och T3-klienten) kan bara ta bort behörigheter som v3.4-rolleditorn känner (24 st); övriga som fanns i rollen bevaras (`_vift_t4a_roller_bevara`, under T3-C:s lås, även i `write`). T4-klienten skickar `klient: {behorighetskatalog: 4}`. Prövat med v3.4-formen och T3-formen (cost_view bevaras) och T4-formen (tas bort). |
| Okänd, tom, inaktiverad roll (punkt 7) | Utan minst en verkställd behörighet ur katalogen: inga verksamhetsdata (inställningar, prisgrupper, återkommande ärenden, artiklar …), bara den egna personalposten och rollen. En **inaktiverad roll** (`active:false`) ger inga behörigheter i `checkViftAuth`, `vift_caller_perms`, `_vift_role_perms` (därmed även superadmininvarianten: att inaktivera den enda `all`-rollen ger 409 `last_superadmin`), `_vift_auth_staff` och klienten (`no_role`). |
| Åtkomst per post (punkt 7) | Återkommande ärenden, projekt och avvikelser: kundregistrets läsare får alla (återkommande utan portkod utan `objects_sensitive`); övriga bara poster som hör till AO de ser med innehåll; inspektioner (ingen AO-koppling) bara för kundregistrets läsare. Rondering (pass, mallar) lämnas till T4-D. |
| Ägarkontroll vid bildradering (punkt 7) | `work-order-image-delete`: utan `ao_edit` får en bild bara raderas om ingen annans loggpost/anteckning eller någon checklistpunkt refererar den; annars 403 `forbidden`/`not_own`. |
| Nytt fynd (baslinje) | `work-order-log-write`, `work-order-checklist-resolve` och `invoice-write` (`aoBilling`) returnerade hela AO:n — fältet fick portkod och inköpspriser i skrivsvaret trots att `work-orders-list` tog bort dem. Bevisat som BASLINJE och rättat. |
| Paritet (SÄK-17) | Fake-backend följer T4-A (`tests/e2e/t4a-regler.js`, samma fil i båda repona): C-5-projektionen modelleras nu för de nycklar T4-A ändrar (inställningar, artiklar, återkommande, projekt, avvikelser, inspektioner, kunder m.fl.). 172 scenarier: 170 lika, 2 kända (KEY-01, AUTH-02, oförändrade). 25 nya T4-A-scenarier, alla lika. |
| Rollback | `supabase/rollback/T4-A/rollback_t4a.sql` (genererad ur kedjan utan T4-A). Installera → rollback → installera prövat; T4-A + T3-E + T3-D + T3-C + T3-B i omvänd ordning = exakt STAGING-facit. Ingen data ändras. |

### 1. Inventering före ändringen

- **Var skrivare fick hela värdet:** `vift_store_full_access` returnerade sant för skrivrätten (`KEY_PERMISSIONS`), så `customer_manage` utan `objects_sensitive` fick objektens portkoder, C-5:s kundläsare personnummer, `admin_manage` intern timkostnad och `article_manage` inköpspris; `work-orders-list` lämnade portkoden till `ao_edit` (C-5:s motivering: "annars skriver den tillbaka posten utan fältet").
- **Skrivvägarna:** `writeMerge` jämförde `previous` med hela serverelementet; `write` ersatte hela värdet; `work_order_patch` för `ao_edit` gjorde `v_ao || patch` (saknad portkod bevarades redan, men en skickad skrevs) och materiallistan ersattes helt (saknat inköpspris raderades).
- **Klienten:** kundformuläret skickade alltid `personnr`; återkommande-formuläret kopierade portkod från fastighet/kund; AO-guiden visade portkodsfältet för alla; artikelformuläret skickade `buyPrice: 0`; inställningarna sparades som hela värdet med hash (sista vinner vid omförsök); Admin visade "250 kr/h" när värdet saknades.
- **Skrivsvar:** se "Nytt fynd" ovan.
- **Notiser:** `vift_notifications` är en gemensam lista som läses (REST) och skrivs (REST-upsert av hela listan) av alla inloggade; se §9.

### 2. Serverändringar (vift-v2, `supabase/`)

| Fil | Innehåll |
|---|---|
| `migrations/20261128000009_t4a_skyddade_falt.sql` | Regelfunktionerna `_vift_t4a_*` (18 st, bara service_role): katalogen över skyddade fält (`_falt`, `_kan_lasa`, `_kan_skriva`, `_alla_lasbara`), `_projicera_elem`, `_sammanfoga`/`_sammanfoga_lista`, `_aktor_perms`, `_giltig`, `_legacy`/`_kontakt`/`_logg_full`, `_roller_bevara`, `_ao_patch`, `_ao_ref`, `_roll_aktiv`, `_privat`, `_tom`. Ändrade med samma signatur: `vift_store_full_access`, `vift_store_project`, `work_order_patch`, `_vift_role_perms`, `vift_caller_perms`, `_vift_auth_staff`, `_vift_ej_verkstallda`. Ny signatur (extra `p_klient jsonb default null`; 5-parametersversionerna borttagna): `store_business_key_write`, `store_business_key_merge_write`. STOP: T3-E installerad, T4-A inte installerad, md5 för varje ersatt funktion = T3-versionen (repokedjan) respektive STAGING (`vift_caller_perms`). Rör inga data. |
| `functions/_shared/vift-auth.ts` | `checkViftAuth`: inaktiverad roll = inga behörigheter (`isRoleActive`). `projectWorkOrder` (portkod, inköpspris, AO-ekonomi). |
| `functions/work-orders-list/index.ts` | `projectWorkOrder` i stället för C-5:s `redact` (undantaget för `ao_edit` borttaget). |
| `functions/ao-time-write/index.ts` | AO i svaren projiceras; `create_ao`: portkod utan `objects_sensitive` → 403 `field_protected`, inköpspris i nya rader utan `cost_edit` → `ignoredFields`. |
| `functions/work-order-log-write`, `work-order-checklist-resolve`, `invoice-write` (`index.ts`) | AO i svaret projiceras (`projectWorkOrder`). |
| `functions/store-key-write/index.ts` | `klient` (bara `behorighetskatalog` som heltal) vidare till RPC:erna som `p_klient`; dokumentation. Felkoden `field_protected` mappas av T3-C:s befintliga regex. |
| `functions/work-order-image-delete/index.ts` | Ägarkontroll (`not_own`). |
| `rollback/T4-A/rollback_t4a.sql` | Genererad av `tests/local/t4a-rollback.js`. |
| `manual/t3e_standardroller/standardroller.json` + A–D | Version `t4a-2026-11-28`: `ejVerkstallda` utan de fyra; `chef` + `reports_view`, `staff_contacts_view`, `activity_log_view_all`; `ekonomi` + `staff_contacts_view`, `activity_log_view_all`; `personal` + `staff_contacts_view`. Skripten omgenererade (`tests/local/t3e-skript.js`). |
| `MIGRATIONSORDNING.txt`, `MIGRATIONSMAPPNING.md`, `migrationsmappning.json` | 0009 som klass "ny – ej installerad i STAGING" efter T3-E. |

**Låsordning** (oförändrad mot T3): store-nyckelns rad `FOR UPDATE` (för personal/roller efter T3-C:s rådgivande lås) → `vift_lastChanged` sist. Anroparens behörigheter läses (MVCC) i samma transaktion. `work_order_patch`: `vift_workOrders FOR UPDATE` som T3-B; T4-A:s kontroll görs efter behörighetsgrinden i respektive gren (ao_edit-grenen och fältets materialgren) och före T3-B:s radjämförelse (`not_own_row`).

**Felkoder** (BEHORIGHETSMATRIS §4): 403 `forbidden`/`field_protected` (skyddat fält), 403 `forbidden`/`not_own` (bildradering), 200 `ignoredFields:['materials[].buyPrice']`. Inga nya 409.

### 3. Klientändringar (VIFT-CRM)

- `AuthService.js`: inaktiverad roll → `no_role` (som servern).
- `storage.js`: `klient: {behorighetskatalog: 4}` i `write`/`writeMerge` för `vift_roles`.
- `state.js`: inställningarna sparas fält för fält (`writeMerge`, konflikt per fält, serverns projicerade värde blir tillstånd och baslinje); begripligt meddelande för `field_protected`.
- `CustomersPage.js`: utan `personal_data_view` visas inget personnummerfält och varken personnummer eller privatpersonens org.nr skickas.
- `RecurringPage.js`: utan `objects_sensitive` skickas ingen portkod.
- `WorkOrdersPage.js`: AO-guidens portkodsfält bara med `objects_sensitive` (annars skickas tom portkod).
- `PageShells.js`: artikelns inköpspris visas bara med `cost_view` och skickas bara med `cost_edit`; Admin → Ekonomi visar intern timkostnad bara med `cost_view` (inget påhittat 250 kr/h), redigering kräver `cost_edit`; rolleditorns katalog med `staff_contacts_view` och `activity_log_view_all`, `_PERM_EJ_VERKSTALLD` utan de fyra verkställda.
- `seedData.js`: demorollerna = `standardroller.json` (t4a).
- `index.html`: `?v=` höjt för `storage.js` (25), `seedData.js` (29), `state.js` (82), `AuthService.js` (26), `CustomersPage.js` (45), `WorkOrdersPage.js` (75), `RecurringPage.js` (20), `PageShells.js` (197). Ingen redesign.

### 4. Fake-backend och paritet (SÄK-17, punkt 13)

- `tests/e2e/t4a-regler.js` (ny, identisk i båda repona) speglar `_vift_t4a_*` och `projectWorkOrder`. `fake-backend.js` (båda repona, synkade; bara källsökvägen skiljer): `t3dFull`/`t3dProject` med T4-A:s regler och fler nycklar (inställningar, artiklar, återkommande, projekt, avvikelser, inspektioner; ingen data utan giltig behörighet), fältvis sammanslagning i `write`/`writeMerge` (inkl. inställningar fält för fält och bevarade behörigheter), `work_order_patch`-kontrollen, projicerade AO-svar, inaktiverad roll, bildradering. Konfliktsvaret i `write` lämnar inte längre ut hela värdet.
- `vift-v2/tests/local/lib/paritet.js`: 25 nya T4-A-scenarier (skrivning med och utan skyddade fält, äldre klients form, inställningar fält för fält och konflikt, AO-patch, tom/okänd roll, åtkomst per post, REST, rollskrivning med och utan markör). MAT-01/02 och KEY-03 skickar nu raderna/kunden i den form T4-klienten läser dem (utan inköpspris respektive personnummer); den äldre formen prövas i T4-MAT-GAMMAL och T4-KUND-03.

### 5. Tester (lokalt, PGHOST=/var/tmp/vift-localpg, PostgreSQL 16.15)

#### 5.1 Resultat

**vift-v2 `tests/run-all.sh` (SKIP_BROWSER=1): 35 testfiler, 1 572 godkända kontroller, 0 fel** efter rättning. Den fulla körningen gav 34/35 gröna (1 559 kontroller): `t3e_installation` föll på en ny beslutad skillnad i steg 4 (profilens materialanrop för `e2e_arbetsledare` utan `cost_view`, se §5.2) och kördes om efter att skillnaden förklarats: 59/0. Under granskningen upptäcktes att `t3c_roller` hade kraschat i full kedja (en hårdkodad 5-parametersignatur) men ändå rapporterats grön (krasch räknades inte som fel, ett äldre testfel): signaturen och felhanteringen är rättade, omkörning 145/0 (= samma antal som före T4-A, kontrollerat mot `bd9553e`). Webbläsartesterna i `browser/` hoppades över (SKIP_BROWSER=1) och räknas inte som godkända; `staging_e2e_real` kör Playwright och ingår (26/0).

Nya:
- `t4a_skyddade_falt` **138/0** (testgruppen `merge_protected`): 10 BASLINJE-fynd mot T3-E-koden (`bd9553e`) bevisade och vända; projektion per behörighet för 23 användare (E) och REST (R); skrivning E och P (RPC direkt, hel lista) med exakt status/error/reason och KS: SEC-B5-01..05, SEC-KUND-03..06 inkl. typbyte, SEC-INST-01..07, SEC-B1-09/11/13/14/17, SEC-B2-06, AO-patch och create_ao (SÄK-7, B1), projicerade skrivsvar; samtidighet SEC-B5-04 ×20, SEC-INST-05 ×20 och samma fält ×20 (exakt en vinner); rollskrivning v3.4-, T3- och T4-form (även `write`); invarianten vid inaktiverad superadminroll (409); bildradering (`not_own`); registret `_vift_ej_verkstallda` och "exakt beslutad åtkomst" per nyverkställd behörighet; ingen breddning för 15 användare utan nya behörigheter (≥250 nycklar/svar, delmängd) och förklarade utökningar för 10 med nya; läsande införandeanalys per STAGING-roll; äldre EF mot ny databas; affärsflöden; rollback installera → rollback → installera, STOP, och T4-A + T3-E + T3-D + T3-C + T3-B = STAGING-facit; grants.
- `paritet_fake_kopia` 173/0 (172 scenarier, 170 lika, 2 kända).

Ändrade och gröna: `replica_build` 39/0, `ef_smoke` 39/0, `t3b_ao_karna` 171/0, `t3b_rollback` 12/0, `t3c_rollback` 19/0, `t3c_roller` 145/0, `t3d_informationsatkomst` 111/0, `t3d_rollback` 19/0, `t3e_installation` 59/0, `t3e_rollback` 15/0, `t3e_standard_roles` 94/0, `migrationskedja` 2/0 (111 identiska, 86 förklarade, 0 oförklarade), `migrationsmappning` 18/0. Oförändrat gröna: `baslinje_sakerhet` 38/0 m.fl.

**VIFT-CRM `tests/run-all.sh`: 23/23 testfiler gröna** (22 Node-testfiler med 668 godkända kontroller och 0 fel, plus `browser/offer_total_parity.js` med 120 offerter och 0 avvikelser). Inga överhoppade. `sim_parity` 173/0 (172 scenarier, 170 lika, 2 kända: KEY-01, AUTH-02), `rollnamn_guard` 17/0.

**E2E (Playwright mot den simulerade servern):**
- Nya T4A-01..07 (`tests/e2e/specs/41_t4a_skyddade_falt.js`): 7/0 (T4A-07 skrevs om under arbetet: inloggningen med inaktiverad roll ska stanna på "saknar behörighet", inte i appen).
- Riktad körning T3E + T4A: 14/14.
- **Hela e2e-sviten en gång efter alla ändringar: 261 godkända, 0 fel, 0 blockerade, 0 kända fel av 261 (1 724 s).** Baslinjen efter T3-E var 254 av 254; skillnaden är de 7 nya T4A-01–07. Rapporten committas separat (`tests/e2e/report/`).

Inga negativa tester har försvagats.

#### 5.2 Ändrade äldre tester (varje ändring förklarad; inget negativt fall borttaget)

| Test | Ändring | Skäl |
|---|---|---|
| `t3b_ao_karna` (SEC-B1-01/04/05, FÄ/FÄ2-raderna) | Fältets materialpatch skickas i fältets vy (utan inköpspris) | Fältet läser raderna utan inköpspris efter T4-A och T4-klienten skickar dem så; `not_own_row`-prövningen är oförändrad. Den äldre formen (med inköpspris) ger 403 `field_protected` och prövas i `t4a_skyddade_falt` |
| `t3d_informationsatkomst` (REST, ingen breddning) | REST-förväntan: ekonomi/säljare utan kontakter, arbetsledaren utan kunder; `work-orders-list` jämförs som delmängd (samma AO, varje AO och materialrad en delmängd) i stället för identisk | Beslutade T4-A-avsmalningar (hela värdet kräver läsrätt till alla skyddade fält; AO-projektionen); jämförelsen är fortfarande "ingen breddning" |
| `t3e_standard_roles` | SEC-CUST-01/08/20 prövar nu exakt de beslutade skillnaderna (tidigare "verkningslös nu"); SEC-CUST-03:s skrivardel kräver att portkoden **saknas**; SEC-CUST-22/23 kräver att inställningar, prisgrupper, återkommande och artiklar är tomma (tidigare kända undantag); SQL-grep robust mot aggregat (`prokind`) och `_vift_t4a_kontakt` (övergångsregelns fasta lista) undantagen | Behörigheterna är verkställda; strängare kontroller |
| `t3e_installation` (steg 4) | Beslutade T4-A-skillnader (`cost_view`, `personal_data_view`) tillagda i förklaringslistan | Standardrollerna har dem enligt matrisen |
| `t3b/t3c/t3d/t3e_rollback`, `t3-andringar.js`, `t3d-/t3e-rollback.js` | Kedjan byggs utan T4-migrationerna | T4-A:s STOP kräver T3-E; T3-rollbackerna prövas som förut; T4-A:s rollback och hela den omvända ordningen prövas i `t4a_skyddade_falt` |
| `replica_build`, `ef_smoke` | T4-registret (`t4-andringar.json`) räknas; T3-registret prövas på kedjan utan T4 | Nytt register |
| `jamfor-schema.js` | Läser även T4-registret | Som ovan |
| `paritet.js` MAT-01/02, KEY-03 | Skickar T4-klientens form | Den äldre formen prövas i nya T4-MAT-GAMMAL, T4-KUND-03 |
| VIFT-CRM `rollnamn_guard` | Migrationsräkningen tillåter T4-migrationer; listan över ej verkställda läses ur registret; katalogen ska innehålla `staff_contacts_view` och `activity_log_view_all` | Strängare/aktuell |
| VIFT-CRM e2e T3E-01/02 | Sex märkta ej verkställda (inte tio); `chef` når Rapporter | Matrisändringen och T4-A |

### 6. Baslinjefynd, vända

Bevisade i oförändrad kod (T3-E, `bd9553e`, utläst med `git archive`) på samma data i `t4a_skyddade_falt.test.js`, och vända i samma test:

| Baslinje (T3-E-koden) | Godkänt säkerhetstest (T4-A) |
|---|---|
| SÄK-7 (P1): skrivaren `customer_manage` utan `objects_sensitive` får portkoder och nyckelinformation i objektregistret | SEC-B5-01/SEC-CUST-03 (E, R, S, K): inga portkoder; SEC-B5-02/03 (E, P): sparning bevarar, skickad portkod 403 `field_protected` |
| D-13: `ao_view_all` + `sales_manage` utan `personal_data_view` får personnummer | SEC-KUND-03 (E, R): saknas; SEC-KUND-05/06 |
| D-01: fältet får artiklarnas inköpspris; `admin_manage` utan `cost_view` får intern timkostnad | SEC-B1-09, SEC-B2-06 (E, R, S, K) |
| Punkt 7: tom behörighetslista får inställningar och återkommande ärenden; inaktiverad roll får alla AO | SEC-CUST-22/23 + inaktiverad roll (E, R, K) |
| SÄK-7 (AO): `ao_edit` utan `objects_sensitive` får AO:ns portkod i `work-orders-list` | SEC-AO-18 (E, S, K) |
| **Nytt:** fältet får portkod och inköpspris i svaret från `work-order-log-write` | projicerade skrivsvar (E) |
| T3-E-beslutet: en rollskrivning med v3.4-katalogen tar bort `customer_view` | behörigheten bevaras utan katalogmarkör (E, S, K) |
| Punkt 7: fältet raderar en bild som annans loggpost refererar | 403 `not_own` (E, S) |

`baslinje_sakerhet` (historisk källa fb71f26) oförändrad.

### 7. SÄK och D efter T4-A

- **Lokalt åtgärdade:** SÄK-7 läckaget (P1) — skrivare och AO-vägar; B5 (fältvis sammanslagning, under radlås); B1 projektionsdelen; D-01 (`cost_view`/`cost_edit` för skyddade fält); D-06; D-13 (slutförd, export T4-F); D-17; T3-D 2/6 och T3-E 4/5 och T3-E:s beslut om äldre klienters rollskrivning; punkt 7: okända/tomma/inaktiverade roller, åtkomst per post (återkommande, projekt, avvikelser, inspektioner), ägarkontroll vid bildradering; SÄK-17 för T4-A:s nycklar; punkt 243 fältnivå och objektformad nyckel lokalt (inställningar fält för fält).
- **Delvis:** D-05 (skrivare och register stängda; tilldelningsvägen T4-C); B1 (fältmaterial utan pris och okänt ≠ 0: T4-B); SÄK-17 (fakturor, offerter internt, prisgrupper m.fl. fortfarande inte fullt modellerade i fake; inga T4-A-scenarier berörs).
- **Öppna:** SÄK-1 (T4-F), SÄK-6 (T4-B), SÄK-7 tilldelningsvägen (T4-C), SÄK-14 (T4-D). Notisernas säkra skrivväg (§9) är lokalt genomförd i tilläggsdelen nedan ("T4-A, tilläggsdel: notiser").

### 8. Införandeplan: `staff_contacts_view`, `activity_log_view_all` och övriga T4-A-effekter per STAGING-roll

Läsande analys i `t4a_skyddade_falt.test.js` (STAGING:s sju roller ur T3-E:s läsning, ingen ändring i STAGING): för varje roll är utlämningen efter T4-A en delmängd av före; avsmalningarna gäller bara skyddade fält och urval per post. Ingen roll tappar kollegors arbetskontakt eller aktivitetsloggen (övergångsregeln). Utfall (nycklar som smalnar av): `e2e_arbetsledare` artiklar, kunder, objekt, inställningar, work-orders-list; `e2e_ekonomi` artiklar, kunder, inställningar, work-orders-list; `e2e_falt` och `e2e_begransad` artiklar, återkommande, projekt, avvikelser, inspektioner; `qa_p2_avgransad` artiklar, kunder, objekt, inställningar; `v7_sakerhetstest` artiklar, kunder, inställningar.

| STAGING-roll | Aktiva | Övergångsregeln (T4) gäller | Smalnar av vid installationen (beslutat) | Steg 2: uttryckligt införande (separat GO per roll) |
|---|---|---|---|---|
| `admin` | 2 | Nej (`all`) | Inget | – |
| `e2e_arbetsledare` | 1 | Ja: intern (härledd), hela loggen (`ao_view_all`) | Portkoder i register och AO (saknar `objects_sensitive`, SÄK-7), personnummer (D-13), intern timkostnad och inköpspris (D-01) | `staff_contacts_view` + `activity_log_view_all` (samma åtkomst); eller steg 4 (D-26): kontot till standardrollen `chef` (får `objects_sensitive`, `cost_view` m.fl. enligt matrisen) |
| `e2e_ekonomi` | 1 | Ja: intern, hela loggen | Personnummer (ROT/RUT-flödet i STAGING kräver `personal_data_view`), intern timkostnad, inköpspris | `staff_contacts_view` + `activity_log_view_all`, och `personal_data_view` + `cost_view` om ekonomitesterna ska fortsätta; eller steg 4 → standardrollen `ekonomi` |
| `e2e_falt` | 2 | Ja: intern (härledd av `ao_complete` m.fl.) | Inköpspris i AO och artiklar, fastpris (D-06), bankgiro och intern timkostnad i inställningarna | `staff_contacts_view`; eller steg 4 → `personal` |
| `e2e_begransad` | 1 | Ja: extern (oförändrat) | Inköpspris, fastpris, inställningarnas bankgiro | Inget (begransad saknar `staff_contacts_view`) |
| `qa_p2_avgransad` | 1 | Ja: intern (härledd) | Portkoder och personnummer i kundregistret (skrivare utan `objects_sensitive`/`personal_data_view`) | Avvecklas (punkt 262); annars `staff_contacts_view` |
| `v7_sakerhetstest` | 1 | Ja: intern (härledd) | Personnummer (`customer_view`), inköpspris, fastpris | Avvecklas (punkt 262); annars `staff_contacts_view` |

**Ordning:** 0) läsande A-kontroll (som T3-E A6): vilka aktiva roller saknar både `staff_contacts_view` och `activity_log_view_all` (förväntat i STAGING: de sex ovan), och att **ingen roll med aktiv personal har `active:false`** (inaktiverad roll ger efter T4-A inga behörigheter). 1) T4-A + T4-B installeras: ingen roll tappar kontakter eller logg. 2) Separat GO per roll: uttryckliga behörigheter (rolleditorn i T4-klienten eller ett D-liknande skript med journal). 3) När A-kontrollen visar att ingen aktiv roll beror på övergångsregeln i STAGING **och** LIVE: ett senare serverpaket tar bort den (`_vift_t4a_legacy`, `_vift_t4a_kontakt`, `_vift_t4a_logg_full`, fake). Fram till dess kan en **egen roll** som saknar båda nya behörigheterna inte begränsas från kontakter/logg (begränsningen kräver att rollen får minst en av dem) — se "Beslut som behövs".

### 9. Kvarstående säkerhetsluckor (beslutets punkt 7)

| Lucka | T4-A | Ansvarig etapp, verifiering, releasevillkor |
|---|---|---|
| Okända roller, tomma listor, inaktiverade roller | **Stängd lokalt** (§ sammanfattning) | Verifiering V6 i STAGING; releasevillkor: A-kontrollen "ingen aktiv personal på inaktiverad roll" i STAGING och LIVE |
| Ägarkontroll vid bildradering | **Stängd lokalt** (loggposter, anteckningar, checklistans avvikelsebilder) | Kvar: Storage-raderingen är inte transaktionell med store (filvägen är slumpad; risken dokumenterad) |
| Åtkomst per post: återkommande, avvikelser, inspektioner, projekt | **Stängd lokalt** (kundregistrets läsare alla; övriga per AO) | Rondering (pass, mallar): T4-D |
| C-5 i den simulerade servern (SÄK-17) | **Modellerad** för T4-A:s nycklar; 25 paritetsscenarier | Fakturor, offerternas interna projektion, prisgrupper: respektive paket (T4-B prisgrupper, T4-E fakturor) |
| Äldre cachade klienter | **Stängd lokalt** för rollskrivning (katalogmarkör) och skyddade fält (fältvis sammanslagning, oberoende av klient) | §12 |
| Notiser: åt andra användare utan kontroll av aktör, mottagare och referens; dessutom läser varje inloggad hela `vift_notifications` (REST och EF), även andras notiser (AO-titlar m.m.) | **Stängd lokalt (tilläggsdel notiser, 2026-11-28)** i befintligt paket T4-A (beslutets punkt 7: "placeras i befintliga paket"; det tidigare förslaget om ett eget paket "T4-N" är ersatt). `appendNotification`/`markNotificationsRead` → RPC `notification_append`/`notifications_mark_read` under radlås (servern sätter avsändare och tid, mottagaren aktiv personal, referensen prövas för avsändaren med `_vift_ref_visible`, typ per behörighet, tilldelad mottagare, bara egna markeras), projektion per mottagare i alla läsvägar, REST-läsning och -skrivning av `vift_notifications` stängd och `vift_lastChanged` borta från vitlistan (punkt 275). Migration `20261128000010`. Se "T4-A, tilläggsdel: notiser". | **Verifiering:** lokalt `t4a_notiser` (testgruppen `notifications_write`), paritet (22 N-scenarier) och e2e NOTIF-02–06; STAGING V6 (installeras med T4-A + T4-B). **Releasevillkor:** före LIVE; klassning P2 (läsläckan P1 om notiserna innehåller kunduppgifter) — beslut 7 nedan. |

### 10. Gränssnitt till T4-B

- **Skyddade fält och behörigheter** (`_vift_t4a_kan_lasa`/`_kan_skriva`, `t4a-regler.js`): portkodsfälten — `objects_sensitive`; `personnr`, `orgNr` för privatperson — `personal_data_view`; `vift_articles.buyPrice`, `markup` — läsa `cost_view`, skriva `cost_edit`; `vift_settings.internalHourlyCost` — läsa `cost_view`, skriva `cost_edit`; `bankgiro` (m.fl. betalningsfält) — läsa interna roller, skriva `bankgiro_edit`; `vift_workOrders.materials[].buyPrice` — läsa `cost_view`, skriva `cost_edit`; AO-ekonomi (`fixedPrice`, `amount`) — läsas av `ao_edit`, `ao_view_all`, `invoice_*`, `cost_view` (D-06).
- **Projektionsfunktioner:** SQL `vift_store_project` → `_vift_t4a_projicera_elem`; TS `projectWorkOrder` (`_shared/vift-auth.ts`), används av `work-orders-list` och alla EF som returnerar en AO. **T4-B måste** projicera varje nytt svar som innehåller AO, materialrader eller prisgrupper med samma regler, och utöka `AO_ECONOMY_FIELDS`/projektionen med `materials[].sellPrice` för fält (D-09) och `priceGroups.hourRate`/`timeEntries.hourRate` (D-11) — **först när serverpriset finns**, annars tappar fältets nya rader priset.
- **Sammanslagning:** `_vift_t4a_sammanfoga(_lista)` för store-nycklar, `_vift_t4a_ao_patch` i `work_order_patch` (ao_edit-grenen och fältets materialgren). De radvisa material-RPC:erna i T4-B ska anropa samma regel (eller ersätta den för materialrader) och behålla: saknat skyddat fält raderar aldrig; skickat fält utan rätt → `field_protected` för befintlig rad, `ignoredFields` för ny rad där servern sätter priset.
- **Låsordning:** som T3: store-nyckelns rad `FOR UPDATE` → `vift_lastChanged` sist; `vift_workOrders FOR UPDATE` i AO-vägarna; anroparens behörigheter läses i transaktionen. T4-B:s material-RPC:er ska ta `vift_workOrders` och sedan `vift_articles`/`vift_priceGroups` **utan** `FOR UPDATE` på de senare (läsning), eller i fast ordning AO → artiklar.
- **Ändrade EF:er** (installeras i samma bunt): `store-key-write`, `work-orders-list`, `ao-time-write`, `work-order-log-write`, `work-order-checklist-resolve`, `invoice-write`, `work-order-image-delete` (+ `_shared/vift-auth.ts`).
- **Ändrade signaturer:** `store_business_key_write`/`_merge_write` har `p_klient` (default null). T4-B:s STOP-kontroller ska läsa T4-A-versionernas md5 ur `tests/local/t4-andringar.json`.
- **Ej verkställt kvar:** `time_view_all` (T4-B). `cost_edit` är verkställd för artiklar och befintliga materialrader; kompletteringen av okänt pris och `*Unknown`-flaggorna är T4-B.
- **Klient:** `ProfitabilityService.internalRate()` har fortfarande `|| 250` och artikelformuläret `|| 0` (F13, okänt ≠ 0: T4-B). Materialformuläret skickar fortfarande klientens pris; servern ignorerar inköpspris i nya rader utan `cost_edit`.
- **Registret:** T4-B registrerar sina objekt i `tests/local/t4-andringar.json` (paket `T4-B`; objekt som både T4-A och T4-B ändrar registreras med T4-B:s md5) och lägger sin rollback i `supabase/rollback/T4-B/` (körs **före** T4-A:s).

### 11. Installationsplan och rollback (T4-A-delen av omgången T4-A + T4-B; beskrivs, körs inte)

**Förutsättningar:** separat GO; T3-A–T3-E installerade (T3-E:s migration 0008; standardrollernas data är inte en förutsättning); klientpaketet med T4-klienten installeras **i samma omgång** som EF:erna (se §12).

**Backup** (testplanen §8 + T4-A): backupschemat för `store`, `op_idempotency` och `function_definitions` med md5; lägg till de ersatta funktionerna (§2) och `pg_policies` för `store`; JSON-kopia med sha256 av `vift_customers`, `vift_properties`, `vift_propertyObjects`, `vift_propertyContacts`, `vift_recurringOrders`, `vift_settings`, `vift_articles`, `vift_roles`, `vift_workOrders`; extern kopia verifierad (`tools/staging-backup-export.js --provata-lokalt`); EF-backup av de sju EF:erna.

| Steg | Innehåll |
|---|---|
| 1. Läsande förkontroll | `schema_migrations` = mappningen + T3-B–T3-E. md5 av de ersatta funktionerna = STOP-värdena. Läsande: aktiva roller med `active:false` och aktiv personal på dem (ska vara 0), roller som beror på T4:s övergångsregel (§8), antal kunder med personnummer och objekt med portkod i bloben (bara antal). |
| 2. Databas | `20261128000009` (därefter T4-B:s migrationer) var och en i egen transaktion. Ingen `db push`, ingen `migration repair`. |
| 3. Edge Functions, direkt efter steg 2 | `store-key-write`, `work-orders-list`, `ao-time-write`, `work-order-log-write`, `work-order-checklist-resolve`, `invoice-write`, `work-order-image-delete` med `_shared/vift-auth.ts` (+ T4-B:s). |
| 4. Klient | `tools/build-staging-package.sh` från HEAD; `?v=` höjt (§3). |
| 5. Storage | Ingen ändring. |
| 6. Efterkontroll (läsande, V6) | md5 av de nya funktionerna = `tests/local/t4-andringar.json`. Läsande per roll med befintliga testkonton: SEC-B5-01, SEC-KUND-03/04, SEC-B1-09/11, SEC-AO-18 (readAllWithHashes, REST, work-orders-list). Skrivande SEC-B5-02/03 och SEC-KUND-05 bara på märkta testposter efter separat GO. **Inga skrivningar av `vift_settings` i STAGING** (SEC-INST bara lokalt). |

**Fönstret mellan steg 2 och 3** (T3-E-EF:er mot T4-A-databasen): EF:erna anropar `store_business_key_*` med fem namngivna argument → `p_klient` default null; projektionen och fältskyddet gäller redan i RPC:n (prövat: T3-E:s `store-key-write` mot T4-A-databasen ger 403 `field_protected` via T3-C:s regex och bevarar personnumret). `work-orders-list` och AO-svaren är oprojicerade i fönstret (som före). Fönstret ska vara minuter.

**Rollback** (ingen data skrivs över): 1) T4-B:s rollback; 2) föregående versioner av de sju EF:erna ur EF-backupen (T3-E:s `store-key-write` fungerar mot T4-A-databasen; efter steg 3 nedan behövs den gamla igen); 3) `supabase/rollback/T4-A/rollback_t4a.sql` (återställer 5-parametersversionerna och de sju ersatta funktionerna exakt, tar bort hjälpfunktionerna; rör ingen tabell och ingen rad); 4) föregående klientpaket; 5) vid behov T3-E-, T3-D-, T3-C- och T3-B-rollbacken. Data som skapats efter installationen (inställningar sparade fält för fält, kunder/objekt med bevarade skyddade fält, roller med bevarade behörigheter) är giltig för den äldre koden. JSON-kopiorna återläses bara vid ett separat beslut om ett datafel. Standardrollernas data (T3-E B) rullas tillbaka separat med C (expectedHash).

### 12. Gammal klient (Service Worker-cache) mot ny server

| Åtgärd | v3.4-klient | T3-klient | Följd |
|---|---|---|---|
| Läsning | Projicerade värden (inga skyddade fält utan behörighet) | Samma | Ingen breddning; cachen innehåller bara det servern lämnar ut |
| Spara kund/objekt/återkommande (writeMerge) med fält den läst | `previous` = projicerat element → godtas; saknade skyddade fält bevaras | Samma | Inget raderas |
| Spara med cache från före uppgraderingen (hela elementet med skyddade fält som `previous`) | Konflikt (`changed_by_other_session`), inget skrivs, serverValue projicerat | Samma | Klienten läser om; ingen läcka |
| Kundformuläret skickar `personnr: ''` (fältet visas i v3.4) för en kund med personnummer | 403 `field_protected`, generiskt felmeddelande, ändringen rullas tillbaka | Samma (T3 hade samma formulär) | Inget raderas; omladdning ger T4-formuläret |
| Återkommande ärende i fastighets-/kundläge (kopierar tom portkod) | 403 `field_protected` om ärendet har en lagrad portkod | Samma | Som ovan |
| Inställningar (hela värdet med hash) | Godtas; intern timkostnad och bankgiro bevaras (fältvis sammanslagning); sista vinner för övriga fält vid 409-omförsök (som förut) | Samma | Skyddade fält aldrig förlorade; konfliktsäkerheten gäller fullt ut först i T4-klienten |
| Rolleditorn | Kan bara ta bort behörigheter ur v3.4-katalogen; övriga bevaras | Kan inte ta bort `cost_view` m.fl. (bevaras) | Inga tappade behörigheter; manuell omladdning behövs inte för skyddet |
| Fältets materialrader (hela listan med andras inköpspris från gammal cache) | 403 `field_protected` | Samma | Nästa poll ger projicerade rader; därefter fungerar det |
| Admin → Ekonomi utan `cost_view` | Visar 250 kr/h (v3.4:s standardvärde, inget verkligt värde lämnas ut) | Samma | Presentationsfel tills omladdning; Spara skickar 250 → 403 `field_protected` (inget skrivs) |
| Inaktiverad roll | v3.4 släpper in användaren men servern ger inga data (alla EF 200 tomt/403) | Samma | Fail-closed på servern |
| Nya felkoder | `field_protected`, `not_own` (bild) visas som generellt fel | `field_protected` visas generiskt i T3 | – |

### 13. Kontrollpunkter (BESLUT-2026-11-28)

| Kontrollpunkt | Uppfylld | Belägg |
|---|---|---|
| Obligatoriska tester godkända | Ja | §5 (`merge_protected` = `t4a_skyddade_falt`, `sim_parity`, SEC-B5-04/05, SEC-INST-05 lokalt) |
| Negativa tester: rätt felkod och ingen mutation | Ja | `expectReject` (status, error, reason, KS) i alla negativa EF-fall; RPC-fall med felmeddelande och KS; konflikt i `writeMerge` jämförs på värdets innehåll (RPC:n skriver tillbaka samma värde, som T3-D dokumenterat) |
| Atomiska samtidighetskontroller | Ja | Fältvis sammanslagning i RPC:n på den låsta raden; ×20 parallella anrop med barriär (objekt, inställningar olika fält och samma fält) |
| Ingen oavsiktligt utökad informationsåtkomst | Ja | Delmängd mot T3-E-koden för 15 användare utan nya behörigheter och per STAGING-roll; utökningar för roller med nya/nyverkställda behörigheter förklarade per behörighet |
| Verksamhetskritiska flöden | Ja | Kundregister, objekt, återkommande, AO (skapa, patch, material), offert → AO, inställningar, rolleditor, personal, fakturaunderlag, tid/stämpling, checklista, logg; run-all och hela e2e-sviten gröna |
| Avgränsade commits | Ja | Server, tester per repo; klient, tester, dokument och e2e-rapport separat |
| Prövad rollback | Ja | `t4a_skyddade_falt`: installera → rollback → installera, STOP, omvänd ordning hela vägen = STAGING-facit, ingen data ändrad |
| Faktisk verifieringsnivå i masterplanen | Ja | SÄK-7, B1, B5, D-01, D-05, D-06, D-13, D-17, 243, 275, T4-raden: "lokalt verifierad" eller "delvis" |
| PG17 och Deno | Nej (miljön) | Kvarstår som releasevillkor |

### 14. Kända begränsningar och beslut som behövs

**Begränsningar:**
- PG16 och Node i stället för PG17 och Deno (releasevillkor).
- Övergångsregeln för `staff_contacts_view`/`activity_log_view_all`: en egen roll som saknar båda kan inte begränsas från kontakter och hela loggen förrän regeln tas bort (§8).
- `readHashes`/`readAllWithHashes` ger hash av hela servervärdet (som C-5): den som saknar läsrätt kan se *att* ett skyddat fält ändrats, inte vad.
- Ett tomt skyddat fält mot ett tomt lagrat godtas även för en anropare som inte får läsa fältet (behövs för klientens scheman); det avslöjar bara att fältet är tomt, aldrig ett värde.
- Bildraderingen i Storage är inte transaktionell med store.
- Fake-backend modellerar fortfarande inte C-5 för fakturor, offerternas interna fält och prisgrupper (T4-B/T4-E).
- Notisernas säkra väg: lokalt genomförd i tilläggsdelen (se "T4-A, tilläggsdel: notiser", §11 där).

**Beslut som behövs (förslag i parentes; det mest restriktiva valet som inte bryter ett flöde är genomfört):**
1. Övergångsregel för T4:s två nya behörigheter (roll utan båda = T3-E:s härledning) tills alla aktiva roller i STAGING och LIVE har fått dem uttryckligen. (Godta; alternativet — införa dem som data i STAGING:s roller vid installationen — kräver GO per roll.)
2. Utan `activity_log_view_all` får en roll med `ao_view_all` bara händelser för AO där den är **tilldelad** (inte alla AO den ser). (Godta; mest restriktivt; fält behåller sin historik.)
3. `staff_view` ger inte arbetskontakt utan `staff_contacts_view` (för nya roller). (Godta.)
4. AO-ekonomi (`fixedPrice`) läses av `ao_edit`, `ao_view_all`, `invoice_*` och `cost_view`; fält får debiteringskategorin. (Godta; D-06.)
5. Inaktiverad roll ger inga behörigheter (tidigare ignorerades `active`), även för superadmininvarianten. (Godta; A-kontroll före installation.)
6. En kunds typbyte från privatperson med lagrat org.nr nekas utan `personal_data_view` (annars skulle numret bli läsbart). (Godta.)
7. Notiserna: **genomfört lokalt i befintligt paket T4-A** (tilläggsdel, migration `20261128000010`, installeras i samma serveromgång som T4-A + T4-B) i stället för ett eget paket "T4-N". Klassning: P2, med läsläckan som P1 om notiserna innehåller kunduppgifter (offertnotiserna innehåller kundnamn). (Godta placeringen; ditt beslut om klassningen. Se tilläggsdelens "Beslut som behövs".) **Fastställt 2026-11-28** (BESLUT-2026-11-28 "Beslut under T4"): placeringen och förslagen godkända, läsläckan P1.
8. Inspektioner (ingen AO-koppling) bara för kundregistrets läsare. (Godta.)

### Ändrade filer

**vift-v2** (gren `claude/vift-system-restructure-8fUme`):
- nya: `supabase/migrations/20261128000009_t4a_skyddade_falt.sql`; `supabase/rollback/T4-A/rollback_t4a.sql`; `tests/t4a_skyddade_falt.test.js`; `tests/local/t4a-rollback.js`, `tests/local/t4-andringar.js`, `tests/local/t4-andringar.json`; `tests/e2e/t4a-regler.js`;
- ändrade: `supabase/MIGRATIONSORDNING.txt`, `MIGRATIONSMAPPNING.md`, `migrationsmappning.json`; `supabase/functions/{_shared/vift-auth.ts, store-key-write, work-orders-list, ao-time-write, work-order-log-write, work-order-checklist-resolve, invoice-write, work-order-image-delete}/index.ts`; `supabase/manual/t3e_standardroller/{standardroller.json, A–D}`;
  `tests/local/{jamfor-schema.js, t3-andringar.js, t3d-rollback.js, t3e-rollback.js, lib/paritet.js}`, `tests/e2e/fake-backend.js`;
  `tests/{ef_smoke, replica_build, t3b_ao_karna, t3b_rollback, t3c_rollback, t3d_informationsatkomst, t3d_rollback, t3e_installation, t3e_rollback, t3e_standard_roles}.test.js` (se §5.2).

**VIFT-CRM** (gren `claude/vift-v3-major-redesign`):
- ändrade: `index.html`, `src/data/{seedData,state,storage}.js`, `src/services/AuthService.js`, `src/pages/{CustomersPage,PageShells,RecurringPage,WorkOrdersPage}.js`; `tests/e2e/fake-backend.js`, `tests/e2e/specs/40_t3e_standardroller.js`, `tests/rollnamn_guard.test.js`; detta dokument, `docs/MASTERPLAN.md`, `docs/qa-2026-11-26/BEHORIGHETSMATRIS.md`;
- nya: `tests/e2e/t4a-regler.js`, `tests/e2e/specs/41_t4a_skyddade_falt.js`.

### Commits

**vift-v2** (`claude/vift-system-restructure-8fUme`, inte pushad):
- `ec5a471` T4-A server: skyddade fält med projektion även för skrivare och fältvis sammanslagning under radlås, staff_contacts_view och activity_log_view_all, äldre klienters rollskrivning, inaktiverade/tomma roller, åtkomst per post, bildradering
- `0d8cea9` T4-A tester: merge_protected, T4-registret, paritet, fake-backend, anpassade T3-tester

**VIFT-CRM** (`claude/vift-v3-major-redesign`, inte pushad):
- `d13b023` T4-A klient
- `351939d` T4-A tester (fake-backend, e2e T4A-01–07, T3E-01/02, rollnamn_guard)
- `e0af8b8` e2e-rapport (261/0/0)
- dokumentcommit: se `git log` efter `e0af8b8`

---

### T4-A, tilläggsdel: notiser

Verifieringsnivå: **lokalt verifierad** (PostgreSQL 16.15, `store-key-write` körd i Node mot den lokala
STAGING-replikan, webbläsartester mot den simulerade servern). Ingenting är installerat eller verifierat
i STAGING. LIVE är inte kontaktad. Inga läsningar mot STAGING behövdes. Tilläggsdelen hör till T4-A
(beslutets punkt 7: luckorna placeras i **befintliga** paket) och installeras i **samma serveromgång som
T4-A + T4-B**, direkt efter `20261128000009`. Inget nytt paket.

#### Sammanfattning

| Del | Resultat |
|---|---|
| Skrivning (punkt 7: aktör, mottagare, referens) | `store-key-write` `appendNotification` → RPC `notification_append` (SECURITY DEFINER, bara service_role). Anroparen omläses i transaktionen (`_vift_t4a_aktor_perms`; utan giltig behörighet 403 `forbidden`). **Servern sätter** avsändare (`createdBy`), tid (`createdAt`), id, `read:false` och `source:'server'`; klientens värden för dessa (och `offerId`) ignoreras. **Typ per behörighet** (`_vift_notis_kategori`): `ao_assigned` kräver `ao_edit`; egna påminnelser (`service_done`, `service_overdue`, `service_approaching`) bara till en själv; alla andra typer (även `offer_approved`, som bara `offer-respond` skapar med service_role) → 403 `type_not_allowed`. **Mottagaren** måste vara aktiv personal → annars 403 `recipient_not_allowed`. **Referensen** (`aoId`) prövas för **avsändaren** med T3-D:s `_vift_ref_visible` på AO-raden under `FOR SHARE` → 403 `ref_not_visible`; för `ao_assigned` måste mottagaren vara tilldelad AO:n → 403 `recipient_not_assigned` (AP-D: ingen falsk tilldelningsnotis). Texten för `ao_assigned` byggs av servern ur AO:n. **Idempotens bunden till innehåll** (`op_idempotency`, anropare + `requestId`, fingeravtryck av mottagare, typ, AO och text; annat innehåll → 409 `idempotency_key_conflict`) och **dubblettskydd** (ingen ny oläst tilldelningsnotis för samma mottagare och AO). **Storleksgräns:** text 1–500 tecken, `requestId` ≤ 100, listan kapas vid 5 000 (de äldsta tas bort, aldrig den nya). |
| Egen markering | `markNotificationsRead` (`ids` ≤ 500, eller `all:true`) → RPC `notifications_mark_read` under `FOR UPDATE`: bara poster med `userId` = anroparen markeras (`read:true`, `readAt`); andras och okända id räknas lika som `ignored` (inget orakel). Inga ändringar → ingen skrivning. |
| Läsning | `vift_store_full_access('vift_notifications')` är falskt för **alla** (även `all`): direkt REST-läsning ger 0 rader. `vift_store_project` → `_vift_notis_projicera`: bara poster vars `userId` är en sträng lika med anroparens personal-id. Gäller `readAllWithHashes` (`store_read_all_with_hashes_projected`) och skrivsvar; `readWithHash` nekar nyckeln som tidigare (400 `key_not_allowlisted`). Utan giltig behörighet: inga notiser (T4-A punkt 7). |
| Historiska notiser | Skrivs inte om (ingen datamigrering). Poster **utan mottagarfält** (eller med `userId` som inte är en sträng) lämnas inte ut till någon — restriktivt och dokumenterat; de ligger kvar i lagret och kapas bort när listan når 5 000. |
| REST-vitlistan (punkt 275, T3-C beslut 1) | **Avvecklad.** `_store_direct_write_guard` nekar all direkt skrivning från authenticated/anon (42501 `direct_write_blocked`, även `vift_notifications` och `vift_lastChanged`); `store_direct_write_allowlist_insert/_update` har `WITH CHECK (false)`. Klienten gör inga direkta REST-skrivningar längre. **Kvar (inte en del av punkt 275):** direkt REST-**läsning** av `vift_lastChanged` (klientens pollsignal, `DataSync._poll`), som bara innehåller en tidsstämpel; den kan ersättas av en EF-läsning i ett senare paket om man vill stänga REST helt. |
| Klient | `NotificationsService.push` → `Storage.appendNotification` (samma `requestId` vid omförsök); en egen notis läggs in först när servern bekräftat den, ingen lokal notis åt andra. `markRead`/`markAllRead` → `Storage.markNotificationsRead` (bara egna). `persistNotifs` (REST-läsning av hela listan + upsert med `vift_lastChanged`) är borttagen. Bulkåtgärden "Lägg till personal" skickar notis och push först efter `bulkPatch` → `succeeded` (tidigare direkt, före serverbekräftelsen). `?v=` höjt. |
| Fake-backend och paritet | Fake följer reglerna (båda repona, synkade). 22 nya paritetsscenarier (N-*), alla lika; totalt 194 scenarier, 192 lika, 2 kända (KEY-01, AUTH-02, oförändrade). |
| Rollback | `supabase/rollback/T4-A-notiser/rollback_t4a_notiser.sql` (genererad ur kedjan utan `20261128000010`). Installera → rollback → installera prövat; notiser + T4-A + T3-E + T3-D + T3-C + T3-B i omvänd ordning = exakt STAGING-facit. Ingen data ändras. |

#### 1. Inventering före ändringen

- **Skrivare av `vift_notifications`:** klientens `persistNotifs` (v3.4, T3 och T4-A) läste hela listan via REST och skrev tillbaka den i **en** upsert tillsammans med `vift_lastChanged` (T3-C-vitlistan). `NotificationsService.push` anropades för `ao_assigned` åt andra (AO-detaljens personaldialog efter serverbekräftelse, bulkåtgärden **före** serverbekräftelse) och för egna påminnelser (`ServiceIntervalService`: `service_done` och `runDailyCheck` `service_overdue`/`service_approaching`). På servern skriver bara `offer-respond` (service_role, villkorad uppdatering på `updated_at`) `offer_approved` till personal med `offer_manage`/`all`. Inga andra EF:er eller RPC:er skriver nyckeln.
- **Läsare:** `initState`/`DataSync._poll` via `readAllWithHashes` (nyckeln står i `VIFT_READONLY_EXTRA_KEYS`/`READONLY_EXTRA_KEYS`), `persistNotifs` via REST. `vift_store_full_access` gav `else true` → hela listan till alla med giltig roll, och REST-raden till alla.
- **Skydd:** triggern `_protect_notifications_and_legacy_keys` (2026-11-17) skyddade bara befintliga posters innehåll (utom `read`) och förbjöd radering under 5 000 poster; nya poster var fria ("pre-existing, accepted application behavior").
- **`vift_lastChanged`:** skrevs direkt bara av `persistNotifs`; alla RPC:er sätter den själva och `store_bump_lastchanged` sätter den för offerter och fakturor.

#### 2. Serverändringar (vift-v2, `supabase/`)

| Fil | Innehåll |
|---|---|
| `migrations/20261128000010_t4a_notiser.sql` | Nya: `_vift_notis_kategori`, `_vift_notis_projicera`, `notification_append(text,jsonb,text,integer)`, `notifications_mark_read(text,jsonb,boolean)` (bara service_role). Ändrade med samma signatur: `vift_store_full_access` (nyckeln falsk för alla), `vift_store_project` (projektion per mottagare), `_store_direct_write_guard` (vitlistan avvecklad). Policyer: `store_direct_write_allowlist_insert/_update` `WITH CHECK (false)`. **STOP:** T4-A installerad, notisdelen inte installerad, md5 för de tre ersatta funktionerna = T4-A-/T3-C-versionen, T3-C:s vitlistepolicyer finns. Rör inga data. |
| `functions/store-key-write/index.ts` | Åtgärderna `appendNotification` (bara `userId`, `type`, `aoId`, `message` vidare till RPC:n; indatakontroll) och `markNotificationsRead`; felmappning `mapNotisError` (403 `forbidden`+`reason`, 403 `forbidden`, 400 `invalid_entry`, 409 `idempotency_key_conflict`). |
| `rollback/T4-A-notiser/rollback_t4a_notiser.sql` | Genererad av `tests/local/t4a-notiser-rollback.js`. |
| `MIGRATIONSORDNING.txt`, `MIGRATIONSMAPPNING.md`, `migrationsmappning.json` | `20261128000010` som klass "ny – ej installerad i STAGING" efter T4-A (MIG-1: installerad 37, ny 10). |

**Låsordning** (samma som T3-D:s `activity_log_append`): `vift_workOrders` `FOR SHARE` (bara när en AO-referens prövas) → `vift_notifications` `FOR UPDATE` → `vift_lastChanged` sist. Ingen väg tar `vift_notifications` före `vift_workOrders`. `offer-respond` gör en villkorad uppdatering på `updated_at` och läser om vid konflikt; RPC:erna sätter `updated_at`, så inget går förlorat. Kontroller av mottagare och referens görs efter låsen, i samma transaktion som skrivningen.

**Felkoder** (BEHORIGHETSMATRIS §4, nya `reason`): 403 `forbidden`/`recipient_not_allowed`, 403 `forbidden`/`recipient_not_assigned`; återanvända 403 `type_not_allowed`, `ref_not_visible`, 400 `invalid_entry`, 409 `idempotency_key_conflict`; inaktiv användare 403 `Forbidden` (`checkViftAuth`, oförändrat).

#### 3. Klientändringar (VIFT-CRM)

- `storage.js` (`?v=26`): `appendNotification`, `markNotificationsRead` (EF `store-key-write`).
- `NotificationsService.js` (`?v=8`): `push` via servern med `requestId` och omförsök vid nätverks-/5xx-fel; egen notis in i tillståndet efter bekräftelse; `markRead`/`markAllRead` bara egna, via servern. Ett avslag loggas och påverkar inget annat flöde.
- `state.js` (`?v=83`): `persistNotifs`/`_doNotifPersist` borttagna (inga direkta REST-skrivningar kvar; `Storage.setRemoteStrict`/`getRemoteStrict` anropas inte längre).
- `WorkOrdersPage.js` (`?v=76`): bulkåtgärdens notis och push först efter serverbekräftelse, bara för bekräftade AO.
- `WorkOrderDetailPage.js` och `ServiceIntervalService.js` oförändrade (anropar `NotificationsService.push` som förut). Ingen redesign.

#### 4. Fake-backend och paritet

- `tests/e2e/fake-backend.js` (båda repona; skiljer bara i källsökvägen): `notisAppend`/`notisMarkera` med samma ordning som RPC:n, projektion per mottagare i `t3dProject`, REST GET döljer `vift_notifications`, `REST_ALLOW = []`.
- `vift-v2/tests/local/lib/paritet.js`: 22 nya scenarier (läsning per mottagare E och R, även `all`; REST-skrivning av notiser och `vift_lastChanged`; tilldelningsnotis; dubblett; fält åt annan; fel typ; inaktiv mottagare; ej tilldelad mottagare; referens som avsändaren inte ser; egen påminnelse till sig själv och åt annan; tom roll; för lång text; idempotens; egen markering, andras id, markera alla). Alla lika. REST-02b/02c (T3-C) ger nu 403 i båda.

#### 5. Tester (lokalt, PGHOST=/var/tmp/vift-localpg, PostgreSQL 16.15)

**Ny testfil `vift-v2/tests/t4a_notiser.test.js` (testgruppen `notifications_write`): 93/0.** Innehåll:
- BASLINJE mot T4-A-koden (`0d8cea9`, `git archive`) på samma data: fältet läser andras notiser via `readAllWithHashes`; begränsad läser hela listan via REST; fältet (utan `ao_edit`) skapar via REST en notis åt FÄ2 med typ `offer_approved`, valfri text, påhittad avsändare och tid; `vift_lastChanged` står på vitlistan.
- Projektion per mottagare för 12 användare (alla standardroller, egna roller, superadmin), REST 0 rader för alla, poster utan mottagare till ingen, historiska poster orörda.
- Tilldelningsnotis: servern sätter avsändare, tid, id, källa och text; mottagaren ser den, avsändaren inte; idempotens (samma innehåll → samma svar, KS oförändrad; annat innehåll → 409); dubblettskydd; superadmin; egna påminnelser.
- 23 negativa fall med exakt status, `error`, `reason` och oförändrad KS (`vift_notifications`, `vift_workOrders`, `vift_staff`, `vift_activityLog`, `vift_lastChanged`, `op_idempotency`): `type_not_allowed` (fält, begränsad, `offer_approved`, okänd typ, `ao_pool` även för `all`), `recipient_not_allowed` (inaktiv, okänd, egen påminnelse åt annan även för `all`), `recipient_not_assigned`, `ref_not_visible` (egen roll med `ao_edit` utan `ao_view_all`, okänd AO, egen påminnelse med osynlig AO), 403 `forbidden` (tom roll, okänd roll), 403 `Forbidden` (avstängd), 400 `invalid_entry` (text > 500, tom text, saknat/för långt `requestId`, `userId` som tal, `ao_assigned` utan AO); klientens id/avsändare/tid/läsläge ignoreras.
- Markering: egen → 200; andras, poster utan mottagare och okända id → 200 `marked:0`, `ignored:4`, KS oförändrad; superadmin kan inte markera andras; "alla" bara egna; indatagränser; tom roll 403; inget att markera → ingen skrivning.
- REST: v3.4/T3/T4-A-upserten, superadmin, `vift_lastChanged` ensam, DELETE och okänd nyckel → 403 42501 med oförändrad KS; UPDATE av notiser → 0 rader (dold rad); policyerna `WITH CHECK (false)`.
- Gammal klient: REST-läsning 0 rader, upserten nekas utan dataförlust (alla 7 poster kvar), `readAllWithHashes` bara egna, tilldelning (`patch_ao`), uppgifter (`writeMerge`) och aktivitetslogg (`appendActivity`) fungerar, därefter skapar den nya klientens väg notisen.
- Installationsfönstret: T4-A:s `store-key-write` mot den nya databasen ger redan projicerade notiser; `appendNotification` → 400 `unknown_action` utan skrivning.
- Storleksgräns 5 000 (den äldsta tas bort, aldrig den nya).
- **Samtidighet** (EF med barriär, varje RPC i egen anslutning): ×20 samma `requestId` två samtidiga → exakt en post; ×20 två avsändare samma mottagare och AO → exakt en oläst; 20 samtidiga anslutningar med olika notiser → alla 20 sparas; ×20 ny notis samtidigt som mottagaren markerar alla → båda effekterna består; ×10 tilldelning + notis + aktivitetslogg + markering samtidigt → alla 200, inga deadlocks.
- **Ingen breddning:** för 12 användare och för STAGING:s sex roller utöver admin (läsande, provkonto byter roll) är **alla nycklar utom notiserna identiska** före (T4-A-koden) och efter, via EF och REST; notiserna är en delmängd = de egna; REST-skrivningen av notiser gick före (201 för alla roller med giltig behörighet) och nekas efter (403 för alla).
- Affärsflöden: tilldelning → notis; offert → AO med personal → notis med serverns text; uppgifter; AO-listan.
- Grants (bara service_role; authenticated 42501), RPC utan identitet → `forbidden`.
- Rollback: installera → rollback (schemat = T4-A-läget med `T4_LAGE=T4-A`, 0 oförklarade; data oförändrade; T4-A-klientens REST-väg fungerar igen) → installera (0 oförklarade) → STOP vid andra körning; STOP utan T4-A; omvänd ordning hela vägen = STAGING-facit utan dataändring.

**Ändrade äldre tester (varje ändring förklarad; inget negativt fall borttaget):**

| Test | Ändring | Skäl |
|---|---|---|
| `t3c_roller` (F18-blocket) | Lägesmedvetet: utan notisdelen prövas T3-C:s vitlista som förut; med den (hela kedjan) samma fall med strängare utfall — `vift_lastChanged` UPDATE och "smuggeldata" → 42501, `persistNotifs`-upserten → 42501 utan ändring, nyckelbyte och innehållsändring av notiser → 0 rader (dold rad); nyckelbyte prövas dessutom på den synliga raden `vift_lastChanged` → 42501 | Vitlistan avvecklas avsiktligt (punkt 275) |
| `t4a_skyddade_falt` (rollbackdelen) | Notisdelens rollback körs före T4-A:s; ominstallationen kör 0009 och 0010; omvänd ordning börjar med notisdelen | Omvänd installationsordning |
| `replica_build` | 10 nya migrationer; notisdelens 9 registrerade objekt (2 med `md5_t4a`); grants även för notisfunktionerna | Ny migration |
| `tests/local/t4-andringar.js`, `jamfor-schema.js` | Registret byggs ur två kedjor (med och utan 0010) och får paketet `T4-A-notiser`, md5 även för policyer och triggers, och `md5_t4a` för objekt som T4-A och notisdelen ändrar; `T4_LAGE=T4-A` godtar T4-A-versionen (som `T3_LAGE`) | Samma mönster som T3-registret |
| VIFT-CRM e2e NOTIF-01 | Fältet skapar en egen påminnelse (`service_done`) i stället för `ao_assigned` åt sig själv | `ao_assigned` kräver `ao_edit` och verklig tilldelning (prövas i NOTIF-02) |
| VIFT-CRM e2e T3C-07 | Notisvägen: REST-upserten nekas 42501 och en notis åt annan med okänd typ nekas (`type_not_allowed`), inget sparas | Tidigare påstods "notisvägen via vitlistan fungerar" — det är exakt den väg som stängts |
| `paritet.js` REST-02b/02c | Oförändrade scenarier; utfallet är nu 403 i både replik och fake | Vitlistan avvecklad |

**Resultat:** se §5.1 nedan.

#### 5.1 Resultat

**vift-v2 `tests/run-all.sh` (SKIP_BROWSER=1), slutkörning efter commit `2060b8f`: 36/36 testfiler gröna, 1 688 godkända kontroller, 0 fel.** Webbläsartesterna i `browser/` hoppades över (SKIP_BROWSER=1) och räknas inte som godkända; `staging_e2e_real` kör Playwright och ingår (26/0). En första körning före rättningarna gav 32/36: de fyra felen var förväntade och förklarade — `migrationsmappning` (MIG-1 inte omgenererad), `paritet_fake_kopia` REST-02b/02c (kördes mot den gamla fake-kopian), `replica_build` (räknade 9 nya migrationer) och `t3c_roller` (T3-C:s vitlista, se tabellen ovan); alla rättade och omkörda.

Nya: `t4a_notiser` **93/0**. Ändrade och gröna: `t3c_roller` 145/0, `t4a_skyddade_falt` 138/0, `replica_build` 40/0, `paritet_fake_kopia` 195/0 (194 scenarier, 192 lika, 2 kända: KEY-01, AUTH-02), `migrationsmappning` 18/0, `migrationskedja` (111 identiska, 90 förklarade, 0 oförklarade). Registret: `t4-andringar.js` PASS (36 objekt), `t4a-notiser-rollback.js` PASS, `t4a-rollback.js` PASS.

**VIFT-CRM `tests/run-all.sh`: 23/23 testfiler gröna** (22 Node-testfiler med 690 godkända kontroller och 0 fel, plus `browser/offer_total_parity.js` med 120 offerter och 0 avvikelser). Inga överhoppade. `sim_parity` 195/0, `rollnamn_guard` 17/0, `service_intervals` 38/0.

**E2E (Playwright mot den simulerade servern):** nya NOTIF-02–06 (`tests/e2e/specs/42_t4a_notiser.js`) och ändrade NOTIF-01, T3C-07 samt T3B-01 i riktad körning: 8/8. **Hela e2e-sviten en gång efter alla ändringar: 266 godkända, 0 fel, 0 blockerade, 0 kända fel av 266 (1 716 s).** Baslinjen efter T4-A var 261 av 261; skillnaden är de fem nya NOTIF-02–06. Rapporten är committad separat (`tests/e2e/report/`, `e66e8a0`).

Inga negativa tester har försvagats eller tagits bort.

#### 6. Baslinjefynd, vända

| Baslinje (T4-A-koden, `0d8cea9`) | Godkänt säkerhetstest (tilläggsdelen) |
|---|---|
| Fältet läser andras notiser (FÄ2:s tilldelning med kunduppgifter, chefens offertnotis) via `readAllWithHashes` | Projektion per mottagare för 12 användare (E), N-LAS-* (S), NOTIF-05 (K) |
| Begränsad läser hela `vift_notifications` via REST | REST 0 rader för alla, även `all` (R, S N-REST-LAS*) |
| Fältet (utan `ao_edit`) skapar via REST en notis åt FÄ2 med valfri typ, text, avsändare och tid | 403 `type_not_allowed`/`recipient_not_*`/`ref_not_visible` (E), REST 42501 (R), NOTIF-04 (K); servern sätter avsändare och tid |
| `vift_lastChanged` står kvar på REST-vitlistan (punkt 275) | 42501 för alla (R, S N-REST-LC, K T3C-07) |

#### 7. SÄK och D efter tilläggsdelen

- **Lokalt åtgärdade:** beslutets punkt 7 "Notiser som kan skapas åt andra användare utan korrekt kontroll av aktör, mottagare och referens" (även läsläckan); punkt 275 (REST-vitlistan avvecklad); SÄK-13:s kvarstående avvikelse (`vift_lastChanged` på vitlistan); AP-D:s del "ingen falsk tilldelningsnotis" även på servern och i bulkåtgärden; SÄK-17 för notiserna (22 scenarier).
- **Kvar:** REST-läsning av `vift_lastChanged` (pollsignal, inte en del av punkt 275); AP-D:s övriga notiser (när någon tar ett jobb, nytt pooljobb) i AO-etappen; push-notiserna (`send-push`, `offer-respond`) är oförändrade och ingår inte (ingen ny lucka hittad: `send-push` kräver inloggning och skickar till angivna personal-id — granskas i AO-etappen tillsammans med AP-D).

#### 8. Gammal klient (Service Worker-cache) mot ny server

| Åtgärd | v3.4-klient | T3- och T4-A-klient | Följd |
|---|---|---|---|
| Läsa notiser (`readAllWithHashes`) | Bara egna | Samma | Kan aldrig läsa andras notiser |
| `persistNotifs`: REST-läsning | 0 rader (`found:false`) | Samma | – |
| `persistNotifs`: upsert av `[notiser, lastChanged]` (ny notis åt kollega, egen påminnelse eller lästmarkering) | 403 42501, loggas som varning i konsolen | Samma; 403 utlöser dessutom `Auth.onServerForbidden` → omläsning av personal och roller (oförändrad behörighet → ingen åtgärd) | **Inga notiser åt andra skapas**; ingen dataförlust (upserten är atomisk och nekas helt, den lokala listan ersätter aldrig serverns); andra flöden påverkas inte (notisskrivningen ligger i en egen kö efter tilldelningen) |
| Tilldelning, uppgifter, AO, offert, fakturering | Fungerar (andra EF-vägar) | Samma | Prövat i `t4a_notiser` och e2e NOTIF-06 |
| Lästmarkering | Visas läst lokalt, återställs vid nästa synk | Samma | Presentationsfel tills omladdning |
| Tilldelningsnotis till kollega | Uteblir | Uteblir | Accepterad följd tills omladdning; Service Workern är network-first och `?v=` är höjt, så en omladdning ger den nya klienten. Push (`send-push`) går fortfarande ut. Skyddet är serverns, inte omladdningen |
| Nya felkoder | Visas inte (bara konsollogg) | Samma | – |

#### 9. Kontrollpunkter (BESLUT-2026-11-28)

| Kontrollpunkt | Uppfylld | Belägg |
|---|---|---|
| Obligatoriska tester godkända | Ja | §5.1 |
| Negativa tester: rätt felkod och ingen mutation | Ja | `expectReject` (status, error, reason, KS) i alla negativa EF-fall; REST-fall med kod och KS |
| Atomiska samtidighetskontroller | Ja | Kontrollerna i RPC:n under `FOR UPDATE`/`FOR SHARE`; ×20 med egna anslutningar och barriär (exakt en vinner där det ska, inga förlorade uppdateringar) |
| Ingen oavsiktligt utökad informationsåtkomst | Ja | Alla nycklar utom notiserna identiska före/efter för 12 användare och STAGING:s sex roller; notiserna en delmängd |
| Verksamhetskritiska flöden | Ja | Tilldelning (dialog och bulk), uppgifter, AO, offert → AO, aktivitetslogg; run-all och hela e2e-sviten (§5.1) |
| Avgränsade commits | Ja | Server, tester, klient, tester/e2e, dokument, e2e-rapport |
| Prövad rollback | Ja | Installera → rollback → installera, STOP, omvänd ordning = STAGING-facit |
| Faktisk verifieringsnivå i masterplanen | Ja | Punkt 275, SÄK-13, SÄK-17, AP-D, T4-raden, V6: "lokalt verifierad"/"lokalt genomförd" |
| PG17 och Deno | Nej (miljön) | Kvarstår som releasevillkor |

#### 10. Installationsplan och rollback (komplement till T4-A §11; beskrivs, körs inte)

**Förutsättningar:** som T4-A §11; notisdelen installeras i **samma omgång** som T4-A + T4-B och klientpaketet med den nya klienten (`NotificationsService` v8 m.fl.).

**Backup (tillägg):** JSON-kopia med sha256 av `vift_notifications` och `vift_lastChanged`; `pg_policies` för `store`; definitionerna av `vift_store_full_access`, `vift_store_project` och `_store_direct_write_guard` (md5 = STOP-värdena).

| Steg | Innehåll |
|---|---|
| 1. Läsande förkontroll | Som T4-A, plus: md5 av de tre funktionerna = STOP-värdena (T4-A-/T3-C-versionen); vitlistepolicyerna finns; antal notiser och antal poster utan sträng-`userId` (bara antal, inget innehåll) |
| 2. Databas | Efter `20261128000009` (och före eller efter T4-B:s migrationer, de rör inte samma objekt): `20261128000010` i egen transaktion. Ingen `db push`, ingen `migration repair` |
| 3. Edge Functions, direkt efter steg 2 | `store-key-write` (samma bunt som T4-A:s EF:er) |
| 4. Klient | Samma klientpaket som T4-A + T4-B (`tools/build-staging-package.sh` från HEAD; `?v=` höjt) |
| 5. Storage | Ingen ändring |
| 6. Efterkontroll (V6) | md5 av de nya/ändrade funktionerna = `tests/local/t4-andringar.json`; läsande per testkonto: SEC-NOTIF-01 (bara egna notiser via `readAllWithHashes`, REST 0 rader); en REST-skrivning av `vift_lastChanged` (SEC-NOTIF-08, nekas, ändrar inget); skrivande SEC-NOTIF-02/03 bara med märkta testposter efter separat GO |

**Fönstret mellan steg 2 och 4:** T4-A:s `store-key-write` mot den nya databasen ger redan projicerade notiser (regeln ligger i RPC:n) men känner inte `appendNotification` (400 `unknown_action`); gamla klienter får 42501 på notisskrivningen (§8). Inga data förloras; under fönstret skapas inga tilldelningsnotiser. Fönstret ska vara minuter.

**Rollback (ingen data skrivs över):** 1) T4-B:s rollback; 2) föregående `store-key-write` och föregående klientpaket (med `persistNotifs`) — samtidigt med steg 3 så att den gamla klienten får tillbaka sin REST-väg; 3) `supabase/rollback/T4-A-notiser/rollback_t4a_notiser.sql` (återställer de tre funktionerna och policyerna exakt, tar bort de fyra nya funktionerna; rör ingen tabell och ingen rad); 4) T4-A:s rollback (§11) osv. Notiser som skapats via den nya vägen (med `createdBy`, `source`, `readAt`) är giltiga för den äldre koden: triggern `_protect_notifications_and_legacy_keys` godtar listan och den gamla klienten läser fälten den känner. JSON-kopian återläses bara vid ett separat beslut om ett datafel.

#### 11. Kända begränsningar och beslut som behövs

**Begränsningar:**
- PG16 och Node i stället för PG17 och Deno (releasevillkor).
- Gamla klienter (v3.4/T3/T4-A i cachen) skapar inga notiser åt andra och kan inte markera lästa förrän omladdning (§8). Skyddet är serverns.
- `readAllWithHashes` ger hash av hela listan (som C-5/T4-A): en användare kan se *att* någon fått en notis, inte vilken.
- Äldre poster utan mottagarfält visas inte för någon (restriktivt; ingen migrering).
- REST-läsningen av `vift_lastChanged` finns kvar (pollsignal).
- `offer-respond` skriver fortfarande `offer_approved` direkt med service_role (utanför RPC:n, villkorad uppdatering); mottagarna är personal med `offer_manage`/`all` och posterna har `userId`, så de projiceras korrekt. Att flytta den till `notification_append`-mönstret är inte nödvändigt för punkt 7.
- Ingen hastighetsgräns per avsändare: flödet begränsas av typregeln (åt andra bara `ao_assigned` med verklig tilldelning), dubblettskyddet och listans tak.

**Beslut (FASTSTÄLLDA 2026-11-28 av Lucas Samuelsson, BESLUT-2026-11-28.md "Beslut under T4": förslagen nedan godkända, läsläckan klassad P1):**
1. Placering i befintligt paket T4-A (tilläggsdel, migration `20261128000010`) i stället för ett eget paket "T4-N". (Godta; följer punkt 7 "befintliga paket".)
2. Klassning: P2; läsläckan P1 eftersom offertnotiserna innehåller kundnamn. (**Fastställt:** läsläckan P1.)
3. Åt andra får en klient bara skapa `ao_assigned`, och bara när mottagaren är tilldelad AO:n; texten sätts av servern. (Godta; AP-D.)
4. Egna påminnelser bara till sig själv, för alla med giltig roll. (Godta.)
5. Superadmin (`all`) läser bara egna notiser. (Godta; notiser är personliga.)
6. Poster utan mottagarfält lämnas inte ut till någon. (Godta; ingen migrering.)
7. Gamla klienter tappar notisskrivningen utan dataförlust. (Godta; servern skyddar, omladdning ger den nya vägen.)
8. REST-läsningen av `vift_lastChanged` får finnas kvar. (Godta; flytta till EF i ett senare paket om REST ska stängas helt.)

#### Ändrade filer

**vift-v2** (`claude/vift-system-restructure-8fUme`):
- nya: `supabase/migrations/20261128000010_t4a_notiser.sql`; `supabase/rollback/T4-A-notiser/rollback_t4a_notiser.sql`; `tests/t4a_notiser.test.js`; `tests/local/t4a-notiser-rollback.js`;
- ändrade: `supabase/functions/store-key-write/index.ts`; `supabase/MIGRATIONSORDNING.txt`, `MIGRATIONSMAPPNING.md`, `migrationsmappning.json`; `tests/local/{t4-andringar.js, t4-andringar.json, jamfor-schema.js, lib/paritet.js}`; `tests/e2e/fake-backend.js`; `tests/{replica_build, t3c_roller, t4a_skyddade_falt}.test.js`.

**VIFT-CRM** (`claude/vift-v3-major-redesign`):
- ändrade: `index.html`, `src/data/{storage,state}.js`, `src/services/NotificationsService.js`, `src/pages/WorkOrdersPage.js`; `tests/e2e/fake-backend.js`, `tests/e2e/specs/{12_reports_dashboard,38_t3c_roller}.js`; detta dokument, `docs/MASTERPLAN.md`, `docs/qa-2026-11-26/BEHORIGHETSMATRIS.md`;
- nya: `tests/e2e/specs/42_t4a_notiser.js`.

#### Commits

**vift-v2** (`claude/vift-system-restructure-8fUme`, inte pushad):
- `e732555` T4-A tilläggsdel notiser, server (migration `20261128000010`, `store-key-write`, rollback, MIGRATIONSORDNING, MIG-1)
- `2060b8f` T4-A tilläggsdel notiser, tester (`t4a_notiser`, registret, paritet, fake-kopia, anpassade T3-C/T4-A-tester)

**VIFT-CRM** (`claude/vift-v3-major-redesign`, inte pushad):
- `d00ad5e` klient (storage, NotificationsService, state, WorkOrdersPage, `?v=`)
- `aed7285` tester (fake-backend, e2e NOTIF-02–06, NOTIF-01, T3C-07)
- `e66e8a0` e2e-rapport (266/0/0)
- dokumentcommit: se `git log` efter `e66e8a0`

---

## T4-B – material, priser och tid (B1 resten, SÄK-6, SÄK-11:s prisdel, D-08–D-11, D-19)

Verifieringsnivå: **lokalt verifierad** (PostgreSQL 16.15, Edge Functions körda i Node mot den lokala
STAGING-replikan, webbläsartester mot den simulerade servern). Ingenting är installerat eller verifierat
i STAGING. LIVE är inte kontaktad. Inga läsningar mot STAGING behövdes (STAGING:s rollregister ur T3-E:s
läsning 2026-11-28 används i införandeanalysen). T4-B installeras i **samma serveromgång som T4-A och
notisdelen**, direkt efter `20261128000010`; §11 nedan kompletterar T4-A:s plan till **en samlad
T4-A + B-omgång**.

### Sammanfattning

| Del | Resultat |
|---|---|
| Radvisa materialoperationer (D-19, R13–R15) | Nya RPC:er `work_order_material_add/update/remove` (via `ao-time-write` `add_material`/`update_material`/`remove_material`) under radlås. **Servern sätter** id, `addedBy`, `addedAt`, `updatedAt/By`, utförandedatum (`performedDate`, standard i dag, aldrig i framtiden) och pris. Fältet (`ao_material`) ändrar och tar bort bara **egna** rader på tilldelad AO (403 `not_own_row`/`not_assigned`); `ao_edit` alla. Låst AO → 409 `ao_locked`. Radversion: `expectedUpdatedAt` → 409 `stale_write`. Idempotens bunden till aktör och innehåll. **Fältets hela materiallista nekas** i `work_order_patch` (403 `forbidden`/`row_path_required`, SEC-B1-06). |
| Serverbaserad prissättning (SÄK-6 P1, D-09, D-10) | Artikelrad → **ögonblicksbild** av försäljnings- och inköpspris och moms ur den gemensamma prisupplösningen (generell → kund → fastighet → avtal); klientens priser ignoreras och redovisas (`ignoredFields`). Fritext → **okänt** pris (`sellPrice: null`, `sellPriceUnknown: true`, samma för inköp) — **aldrig 0 kr**; en artikel med pris 0 (schemats standard) ger också okänt. Pris får anges/kompletteras bara av `invoice_create`/`cost_edit` (försäljning, moms) respektive `cost_view`+`cost_edit` (inköp) — annars 403 `field_protected`. Komplettering av okänt pris loggas i AO:ns logg (utan belopp, SEC-B1-13). Arbetsledarens **hela lista** (v3.4/T3/T4-A-klient) godtas men nya rader prissätts av servern, serverägda fält behåller serverns värde och ett **0 eller tomt pris från klientens "\|\| 0" på en rad med okänt pris ignoreras** — ingen 0-kronorsrad. Historiska priser bevaras: ändrad artikel eller prisgrupp ändrar inga befintliga rader/tidposter (R24). |
| Fakturavägen (D-10, R20, R21) | `invoice_append_checked` prövar varje källrad mot sin källa i det **gemensamma radformatet** under låsen: okänt pris → 409 `price_unknown`; material eller tid som **ingår i fastpris** → 409 `included_in_fixed_price` (material debiteras separat bara om det uttryckligen markerats som **tillägg** `extra` av `ao_edit`/`invoice_create`); ej debiterbar källa → 409 `source_not_billable`; saknad källa/borttagen AO → 409 `source_not_found`; radens à-pris ≠ källans serverpris → 409 `price_mismatch`; AO med äldre icke källmedveten faktura → 409 `source_collision`. `invoice_set_status` stoppar **utskick** av ett underlag med en rad utan numeriskt à-pris eller markerad `priceUnknown` (409 `price_unknown`); utkastet kan kompletteras av ekonomi (`lineUpdate`) och skickas sedan. Atomisk väg och D-07/G9 bevarade (`aoBilling`, `work_order_billing_set` oförändrade). |
| Fakturerade källrader låsta (T3-B beslut 2) | En materialrad eller tidpost som en **icke makulerad** faktura gör anspråk på (även utkast) får inte ändras eller tas bort — radvis, via arbetsledarens hela lista, `patch_time`, `delete_time` eller `correct_time` → 409 `invoiced_locked`. Val och motivering: **neka** ändringen (inte markera utkastet inaktuellt) — utkastet blir aldrig felaktigt, beslutet är atomiskt under samma lås som anspråket (exakt en vinner, prövat ×20), och användaren tar bort raden ur utkastet för att släppa anspråket (då kan raden ändras och tas in igen). Nya rader, checklista, logg och dokumentation på klar men ej fakturerad AO tillåts (blir nya källor i kön; utkastet ändras inte). |
| Tid (D-11, SÄK-11:s prisdel, R22–R24) | `time_entry_create` sätter `hourRate` från en **tillåten** prisgrupp: fältroller (utan `ao_edit`/`invoice_create`/`payroll_manage`) bara en aktiv grupp och AO:ns grupp när AO:n har en (403 `forbidden`/`price_group_not_allowed`); okänd grupp nekas för alla. **Legitim utstämpling faller aldrig** på prisgruppen: AO:ns grupp används och valet redovisas. Utan grupp är timpriset **okänt** (`hourRate: null`, `hourRateUnknown: true`), aldrig 0. `patch_time` från fältet: samma regel i EF:en. |
| Tidlås på klar AO (T3-B beslut 1, punkt 276) | `time_entry_create`, `time_entry_patch`, `time_entry_soft_delete` och **instämpling** (`store_write_stamp_status`) nekas på `klar` (och som förut låst) AO med 409 `ao_locked`; **legitim utstämpling** (pågående stämpling på samma AO och starttid) slutförs alltid, även över midnatt och sommartidsskiftet. Ny **`time_entry_correct`** (`ao-time-write` `correct_time`): behörig (`payroll_manage`), **loggad** rättning eller komplettering av glömd tid på klar AO med **obligatorisk orsak** (400 `reason_required`), revisionsrad i posten (`corrections[]`: vem, när, typ, orsak, före/efter) och loggpost i AO:n (utan belopp); timpriset sätts av servern. Fakturerade (`invoiced_locked`) och attesterade (`attested_locked`) poster och fakturerad/låst AO (`ao_locked`) ändras inte här — de kräver fakturans respektive attestens korrigeringsflöde. Återöppningsutredningen: §9. |
| `time_view_all` verkställd (K-01, D-08) | `time-entries-list`: `time_view_all` ger **all personals** tidposter; en annans post lämnas ut **utan löneuppgifter** (vitlista: id, AO, personal, datum, tider, minuter, kommentar, prisgrupp, debiterbar …; inga attestfält, inga revisionsrader). `payroll_view` krävs fortfarande för lön/attest per person (oförändrat). `time_view_all` ger ingen annan verksamhetsdata (prövat: `readAllWithHashes` identiskt med samma roll utan den). Borttagen ur `_vift_ej_verkstallda()`, `standardroller.json` (`ejVerkstallda`, version `t4b-2026-11-28`, skripten omgenererade), fake-backendens lista och rolleditorns `_PERM_EJ_VERKSTALLD`. |
| Projektion av priser (D-09, D-11, SEC-B1-09/10, SEC-B2-01) | Prisläsrätt (`_vift_t4b_pris_las` = TS `canReadPrices`): `ao_edit`, `ao_view_all`, `invoice_view`, `invoice_create`, `cost_view`, `article_manage`, `offer_manage` (eller `all`). Utan den: inga `materials[].sellPrice` i `work-orders-list` och alla AO-svar, inga `articles.sellPrice`, inga tidposters `hourRate` (även egna) i `time-entries-list` och tidsvaren, och **prisgrupperna bara som aktiva (valbara) grupper med namn och typ** — utan timpris och beskrivning; REST-raderna för artiklar och prisgrupper döljs. |
| Prisgrupper (punkt 247/G12) | Aktivera/inaktivera väntar på serverbekräftelse (`confirmPersist`) och rullas tillbaka vid avslag; beskedet visas först efter bekräftelsen (e2e T4B-05). C-5-projektionen av prisgrupper modelleras i fake-backenden. |
| Klient (F13) | Inga belopp för fält i artikelväljare, materialformulär och -rader, stämpla ut, Tid och AO-detaljens tidrader; inga `\|\| 0`/`\|\| 250` för priser (okänt visas "Pris saknas"); `ProfitabilityService` utan påhittade standardvärden (intern timkostnad saknas → "Saknas", TB markerat **ofullständigt** utan procent). Materialrader skrivs radvis. `?v=` höjt. |
| VK-1-arkitekturen (punkt 272) | Gemensam prisupplösning och gemensamt radformat/fakturastatus per källrad (material, tid, fastpris, **framtida insats**) som materialvägen och fakturavägen använder; grupperade rader, delfakturering och atomiskt anspråk per registrering prövade med injicerade insatsregistreringar. Inga vyer, inget registreringsgränssnitt. §8. |
| Paritet (SÄK-17) | `tests/e2e/t4b-regler.js` (ny, identisk i båda repona) speglar T4-B; fake-backenden följer reglerna. 38 nya scenarier (B-*), alla lika; totalt 233 scenarier, 231 lika, 2 kända (KEY-01, AUTH-02, oförändrade). |
| Rollback | `supabase/rollback/T4-B/rollback_t4b.sql` (genererad ur kedjan utan T4-B). Installera → rollback → installera prövat; T4-B + notiser + T4-A + T3-E + T3-D + T3-C + T3-B i omvänd ordning = exakt STAGING-facit. Ingen data ändras. |

### 1. Inventering före ändringen

- **Materialvägen (SÄK-6):** fältet och arbetsledaren skrev hela `materials` via `patch_ao`; klientens `sellPrice`/`buyPrice` sparades (fältet kunde sätta 1 kr på en artikel för 100 kr), fritext fick `|| 0` (okänt = 0 kr), T3-B:s `_vift_ao_material_merge` skyddade bara andras rader, och T4-A bara inköpspriset. Ingen radversion; id från klienten (`'M'+Date.now()`).
- **Priser till fältet:** artiklarnas försäljningspris (`vift_store_project`), prisgruppernas timpris (`vift_priceGroups` var "else true" för alla), materialradernas försäljningspris i `work-orders-list` och tidposternas `hourRate` (även egna) lämnades ut; klienten visade dem i artikelväljaren, stämpla ut, Tid och AO-detaljen.
- **Fakturavägen:** `invoice_append_checked` prövade bara källkollision; à-priset kom från klienten (`m.sellPrice || 0`, `t.hourRate || 0`), fastpris-AO fakturerades med fastpriset **och** fältmaterialet (klientens V34-regel), okänt pris = 0-kronorsrad, och en materialrad i ett utkast kunde ändras efteråt (utkastet blev inaktuellt).
- **Tid:** `time_entry_create` satte timpriset ur valfri grupp (även inaktiv), 0 utan grupp, och tillät normal tid på `klar` AO; `time_view_all` gav inget (bara `payroll_view` såg andras tid).
- **Klient:** `ProfitabilityService.internalRate()` `|| 250`, materialsummor och kön med `|| 0`; prisgruppernas aktivera/inaktivera sparade utan serverbekräftelse (`persist()` + direkt besked).

### 2. Serverändringar (vift-v2, `supabase/`)

| Fil | Innehåll |
|---|---|
| `migrations/20261128000011_t4b_material_priser_tid.sql` | **Nya (24, bara service_role):** regelfunktionerna `_vift_t4b_pris_las`, `_pris_satta`, `_inkop_satta`, `_tillagg_satta`, `_kontor`, `_tal`, `_idag`, `_datum_ok`, `_tid_last`, `_lage`, **`_vift_t4b_pris`** (prisupplösningen), **`_vift_t4b_kallrad`**, **`_vift_t4b_kalla_status`**, `_anspraak`, `_rad_kant`, `_faktura_kallor`, `_faktura_pris_kontroll`, `_ny_rad`, `_material_lista`, `_rad_kontroll`; RPC:erna `work_order_material_add/update/remove` och `time_entry_correct`. **Ändrade med samma signatur (10):** `work_order_patch`, `time_entry_create`, `time_entry_patch`, `time_entry_soft_delete`, `store_write_stamp_status`, `invoice_append_checked`, `invoice_set_status`, `vift_store_full_access`, `vift_store_project`, `_vift_ej_verkstallda`. **STOP:** T4-A och notisdelen installerade, T4-B inte installerad, md5 för varje ersatt funktion = föregående version (repokedjan). Rör inga data. |
| `functions/_shared/vift-auth.ts` | `PRICE_READ_PERMS`, `canReadPrices`, `projectTimeEntry` (timpris och time_view_all-vitlistan), `projectWorkOrder` utan `materials[].sellPrice` (och framtida `insatser[].unitPrice`) utan prisläsrätt; `aoRuleError` känner `invoiced_locked` (409). |
| `functions/ao-time-write/index.ts` | `add_material`, `update_material`, `remove_material`, `correct_time`; tidposter och materialrader i alla svar projiceras; `create_ao` sätter okänt försäljningspris för rader utan prissättningsrätt eller pris ≤ 0; `patch_time` prövar fältets prisgrupp (`price_group_not_allowed`); felkoder `invalid_row`, `invalid_reference`, `reason_required`. |
| `functions/time-entries-list/index.ts` | `time_view_all` + `projectTimeEntry`. |
| `functions/invoice-write/index.ts` | Felkoder `price_unknown`, `price_mismatch`, `included_in_fixed_price`, `source_not_billable`, `performed_date_required`, `source_not_found` (409). |
| `rollback/T4-B/rollback_t4b.sql` | Genererad av `tests/local/t4b-rollback.js`. |
| `manual/t3e_standardroller/standardroller.json` + A–D | Version `t4b-2026-11-28`: `ejVerkstallda` utan `time_view_all`; rollernas behörigheter oförändrade. Skripten omgenererade. |
| `MIGRATIONSORDNING.txt`, `MIGRATIONSMAPPNING.md`, `migrationsmappning.json` | `20261128000011` som klass "ny – ej installerad i STAGING" direkt efter notisdelen (MIG-1: installerad 37, ny 11). |

**Låsordning** (en gemensam ordning för alla T3/T4-vägar, inga cykler): `vift_invoices` → `vift_timeEntries` → `vift_workOrders` → `vift_activityLog` → `vift_lastChanged`. Material-RPC:erna och `work_order_patch` (med `materials`) tar `vift_invoices` FOR SHARE före `vift_workOrders` FOR UPDATE (samma som `work_order_billing_set`); tidvägen `vift_invoices` FOR SHARE → `vift_timeEntries` FOR UPDATE → `vift_workOrders`; fakturavägen `vift_invoices` FOR UPDATE → `vift_timeEntries`/`vift_workOrders` FOR SHARE (som `invoice_set_status`). Artiklar, prisgrupper och prisöverenskommelser läses utan lås (MVCC). Alla regelkontroller görs efter låsen, i samma transaktion som skrivningen.

**Felkoder** (BEHORIGHETSMATRIS §4, nya): 403 `forbidden`/`row_path_required`; 409 `invoiced_locked`, `price_unknown`, `price_mismatch`, `included_in_fixed_price`, `source_not_billable`, `source_not_found`, `performed_date_required`; 400 `invalid_row`, `reason_required`. Återanvända: 403 `not_own_row`, `not_assigned`, `field_protected`, `price_group_not_allowed` (fanns i katalogen, nu verkställd); 409 `ao_locked`, `stale_write`, `attested_locked`, `idempotency_key_conflict`; 400 `invalid_reference`, `invalid_source_ref`.

### 3. Klientändringar (VIFT-CRM)

- `AOTimeSyncService.js` (`?v=14`): `addMaterial`/`updateMaterial`/`removeMaterial`; `invoiced_locked`, `invalid_row`, `invalid_reference`, `reason_required` är slutgiltiga avslag.
- `WorkOrderService.js` (`?v=33`): materialrader radvis (preliminär lokal ändring; serverns projicerade rader ersätter de lokala; slutgiltigt avslag backar), `canReadPrices`/`canSetSalePrice`/`canSetBuyPrice`; priser skickas bara med prissättningsrätt; `materialTotal` utan okända priser.
- `WorkOrderDetailPage.js` (`?v=98`): artikelväljare, materialformulär (dokumentationsfält, inga prisfält för fält), materialrader ("Pris saknas", "Tillägg", inga knappar på andras rader för fält), tidrader och prisgruppsval utan belopp utan prisläsrätt; inga `|| 0`; lönsamhetskortet visar "Ofullständig" och "Saknas".
- `TimeService.js` (`?v=25`): `priceGroupOptions` (fält: aktiva grupper, AO:ns grupp; belopp bara med prisläsrätt). `TimePage.js` (`?v=20`): stämpla ut, manuell tid och redigering använder den.
- `BillingQueueService.js` (`?v=12`): D-10 — material på fastpris-AO är ingen egen källa om det inte är tillägg; okänt pris (null) är en åtgärdsorsak, aldrig 0; `_ensureMaterialIds` skriver bara med `ao_edit`.
- `InvoicesPage.js` (`?v=42`): okänt belopp visas "Pris saknas"; intern ekonomi visar "Ofullständig".
- `ProfitabilityService.js` (`?v=4`): inga påhittade standardvärden (F13).
- `PageShells.js` (`?v=198`): prisgruppernas aktivera/inaktivera med `confirmPersist` (G12); `_PERM_EJ_VERKSTALLD` utan `time_view_all`.
- Ingen redesign, inga nya vyer.

### 4. Fake-backend och paritet (SÄK-17)

- `tests/e2e/t4b-regler.js` (ny, identisk i båda repona) speglar SQL-reglerna (prisupplösning, källrad, fakturastatus, ny rad, hela listan, radkontroll, projektioner). `fake-backend.js` (båda repona, synkade): radvisa materialåtgärder, `correct_time`, fältets hela lista nekas, arbetsledarens lista prissätts, `create_time`/`patch_time`/`delete_time`/stämpling med tidlås, prisgrupp och okänt timpris, `time-entries-list` med `time_view_all` och projektion, fakturavägens källkontroll och utskicksstopp, C-5-projektion av artiklar och **prisgrupper**.
- `vift-v2/tests/local/lib/paritet.js`: 38 nya scenarier (B-ADD/UPD/RM/PATCH, B-TID, B-STAMP, B-TEL, B-PG, B-REST, B-WOL, B-FAKT, B-INVLOCK, B-SEND, B-KORR); de äldre MAT-scenarierna ger nu 403 `row_path_required` i både replik och fake.

### 5. Tester (lokalt, PGHOST=/var/tmp/vift-localpg, PostgreSQL 16.15)

#### 5.1 Resultat

**Ny testfil `vift-v2/tests/t4b_material_priser.test.js` (testgruppen `material_pricing`): 152/0.** Innehåll:
- BASLINJE mot T4-A + notisdelen (`2060b8f`, `git archive`) på samma data: se §6 (8 fynd).
- Radvisa materialoperationer: SEC-B1-01..05, 08, 13, 14 med exakt status/error/reason och KS (`vift_workOrders`, `vift_timeEntries`, `vift_invoices`, `vift_articles`, `vift_priceGroups`, `vift_activityLog`, `op_idempotency`, `stamp_status`), indata (antal, benämning, okänd artikel, framtida datum), ej tilldelad, roller utan `ao_material`, idempotens (omförsök → samma rad; annat innehåll → 409).
- Hela listan: SEC-B1-06 (fält, även oförändrad lista), arbetsledarens lista (serverpris på nya rader, 0 över okänt ignoreras, komplettering med rätt, `field_protected` utan rätt, serverägda fält bevaras).
- Projektion för 14 användare (fält, begränsad, tom, egna roller, `time_view_all`, admin, chef, ekonomi, `ao_edit`, `article_manage`, `invoice_view`, säljare med `ao_view_all`) i `readAllWithHashes`, `work-orders-list`, `time-entries-list` och REST.
- `time_view_all`: chef ser all tid utan attest/revisioner; egen roll med bara `time_view_all` ser all tid utan belopp och **ingen annan data** (identiskt med samma roll utan behörigheten); ekonomi oförändrad; SEC-TID-07/08; registret och speglingen.
- Tid: SEC-B2-03/04/05, okänt timpris, ögonblicksbild för material (R24), tidlås på klar/fakturerad AO (create, patch, delete, flytt, instämpling), legitim utstämpling över midnatt och sommartidsskiftet på en AO som blivit klar, checklista och logg på klar AO.
- Rättning (punkt 276): komplettering och rättning med revisionsrad och AO-logg; `reason_required`, fält och arbetsledare nekas, `attested_locked`, `ao_locked` på fakturerad AO, `stale_write`.
- Fakturavägen: SEC-B1-15/16, tid på fastpris, `price_mismatch`, `source_not_found`, `source_not_billable`, `invalid_source_ref`, tillägg (R21), `invoiced_locked` (radvis, hela listan, borttagning, tid patch/delete/rättning), anspråket släpps när raden tas bort ur utkastet, utskicksstopp och komplettering.
- VK-1: prisupplösningen i fyra nivåer med giltighet och moms, tjänst utan pris = okänt, gemensamt radformat (material/tid/insats), grupperad rad, dubbelfakturering per registrering, olika à-pris i grupp, okänt pris och saknat utförandedatum på insats, tid i insatsläge = intern.
- Grants (bara service_role; authenticated 42501), RPC utan identitet → `forbidden`.
- **Samtidighet** (egna anslutningar): ×20 FÄ lägger till samtidigt som AL tar bort en annan rad → båda effekterna består (SEC-B1-07); ×20 två ändringar av samma rad med samma radversion → exakt en vinner (`stale_write`); ×20 prisändring samtidigt som raden tas in i ett underlag → exakt en vinner (`price_mismatch` eller `invoiced_locked`), utkastet aldrig inaktuellt; 20 samtidiga tillägg → alla 20 sparas; ×20 två samtidiga rättningar av samma tidpost → exakt en, en revisionsrad.
- **Gamla klienter:** fältets hela lista med "|| 0" → 403 utan 0-kronorsrad; klientens `hourRate`/gruppnamn ignoreras; gammal faktureringskö med 0-kronorsrad → `price_unknown`; v3.4:s fastprisregel → `included_in_fixed_price`; installationsfönstret (T4-A:s EF mot T4-B-databasen).
- **Affärsflöden:** offert → AO (avtalat materialpris följer med), `create_ao` utan prisrätt, fakturakö → underlag → AO fakturerad → skickad → makulerad → AO backad, import/återkommande, stämpling, checklista och klarmarkering, lönsamhet (ekonomi ser TB-underlag).
- **Ingen breddning:** för 13 användare (≈990 nycklar/svar) och STAGING:s sju roller är varje skillnad mot T4-A-koden beslutad (§10).
- **Rollback:** installera → rollback (schemat = läget efter notisdelen med `T4_LAGE=T4-A-notiser`, 0 oförklarade; data oförändrade; T4-A-klientens väg fungerar på T4-B-data) → installera → STOP vid andra körning; STOP utan notisdelen och vid drift i en ersatt funktion; omvänd ordning hela vägen = STAGING-facit utan dataändring.

**vift-v2 `tests/run-all.sh` (SKIP_BROWSER=1): 37/37 testfiler gröna, 1 883 godkända kontroller, 0 fel** (slutkörning efter commit `3bb0874`). Nya: `t4b_material_priser` 152/0. Ändrade och gröna: `t3b_ao_karna` 174/0, `t3e_standard_roles` 94/0, `t3e_installation` 59/0, `t4a_skyddade_falt` 138/0, `t4a_notiser` 93/0, `replica_build` 41/0, `paritet_fake_kopia` 234/0, `staging_tools` 44/0, `migrationskedja` (108 identiska, 117 förklarade, 0 oförklarade), `migrationsmappning` 18/0; registret `t4-andringar.js` PASS (66 objekt), `t4b-rollback.js` PASS. En första körning under arbetet gav 29/36 med förväntade, förklarade avvikelser (§5.2) som rättades. Webbläsartesterna i `browser/` hoppades över (SKIP_BROWSER=1) och räknas inte som godkända; `staging_e2e_real` kör Playwright och ingår.

**VIFT-CRM `tests/run-all.sh`: 23/23 testfiler gröna** (22 Node-testfiler med 729 godkända kontroller och 0 fel, plus `browser/offer_total_parity.js` med 120 offerter och 0 avvikelser). Inga överhoppade. `sim_parity` 234/0 (233 scenarier, 231 lika, 2 kända: KEY-01, AUTH-02), `rollnamn_guard` 17/0, `staging_tools` 40/0.

**E2E (Playwright mot den simulerade servern):** nya T4B-01–08 (`tests/e2e/specs/43_t4b_material_priser.js`) i riktad körning: 8/8. **Hela e2e-sviten en gång efter alla ändringar: 274 godkända, 0 fel, 0 blockerade, 0 kända fel av 274 (1 778 s).** Baslinjen efter T4-A var 266 av 266; skillnaden är de åtta nya T4B-01–08. En tidigare upptäcktskörning under arbetet gav 269/5 (MAT-01, PERM-02, AOD-07/08, T3E-01: förväntade, beslutade ändringar, §5.2); de rättades och prövades med `--grep` (6/6) före slutkörningen. Rapporten är committad separat (`tests/e2e/report/`).

Inga negativa tester har försvagats eller tagits bort.

#### 5.2 Ändrade äldre tester (varje ändring förklarad; inget negativt fall borttaget)

| Test | Ändring | Skäl |
|---|---|---|
| `t4a_skyddade_falt`, `t4a_notiser` | Prövar T4-A-paketet **så som det levererades**: kedjan utan `20261128000011` (schemajämförelse `T4_LAGE=T4-A-notiser`) och Edge Functions ur T4-A-commiten `2060b8f`; rollbacksektionernas ominstallation godtar att bara T4-B:s objekt saknas; registret i T4-A-läget innehåller `time_view_all` | T4-B ändrar samma vägar avsiktligt; samspelet och hela kedjan prövas i `t4b_material_priser` |
| `t3b_ao_karna` | Fakturaflödet fakturerar fastpriset (`fixed:AO-A3`, 4 500 kr) i stället för tidposten på fastpris-AO:n; fältets materialregler (W1, SEC-B1-01/04/05/08, FÄ2) prövas via de radvisa åtgärderna med samma förväntade avslag, och hela listan prövas uttryckligen (403 `row_path_required`); utstämplingsfallet startar passet medan AO:n är pågående | D-10 (tid ingår i fastpris), D-19 (hela listan nekas för fält), T3-B beslut 1 (instämpling på klar AO låst) |
| `t3e_standard_roles` | SEC-CUST-05 och SEC-TID-06 prövar nu exakt den beslutade åtkomsten (tidigare "verkningslös nu") | `time_view_all` verkställd |
| `t3e_installation` (steg 4) | `tel` för e2e_arbetsledare → chef tillagd i förklaringslistan | `time_view_all` (K-01) |
| `replica_build` | 11 nya migrationer; T4-B:s 34 registrerade objekt; grants även för T4-B:s funktioner | Ny migration |
| `tests/local/t4-andringar.js`, `jamfor-schema.js` | Registret byggs ur tre kedjor (hela, utan T4-B, utan T4-B och notiser); paketet `T4-B`, `md5_t4an` (läget T4-A + notiser) och `md5_t4a`; `T4_LAGE=T4-A-notiser` | Samma mönster som T3-/T4-A-registret |
| `paritet.js` MAT-01/02, T4-MAT-* | Oförändrade scenarier; utfallen är nu 403 `row_path_required` i både replik och fake (T4-MAT-NY robust mot att raden saknas) | D-19 |
| `tests/staging/authz-read.js`, `authz-mutation.js` (båda repona) | R2: `time_view_all` får se andras tid men utan löneuppgifter; test-AO:n är `pågående` (G6 prövar create_time) | K-01; T3-B beslut 1 |
| VIFT-CRM e2e MAT-01 | Fältet lägger till material utan prisfält (raden får okänt pris på servern); arbetsledaren anger pris och moms | D-09/D-10 — tidigare satte fältet försäljningspriset (exakt SÄK-6-bristen) |
| VIFT-CRM e2e PERM-02 | Arbetsledaren får all personals tid men inga löneuppgifter i andras poster (tidigare "bara egna") | K-01 (`time_view_all` verkställd) |
| VIFT-CRM e2e AOD-07/08 | Förväntat antal tidrader för arbetsledaren 5 (alla) i stället för 1 (egna) | K-01 |
| VIFT-CRM e2e T3E-01, T3E-06 | Fem ej verkställda behörigheter (tidigare sex); T3E-06:s namn utan `time_view_all` | `time_view_all` verkställd |

### 6. Baslinjefynd, vända

Bevisade i oförändrad kod (T4-A + notisdelen, `2060b8f`) på samma data i `t4b_material_priser.test.js` och vända i samma test:

| Baslinje (T4-A-koden) | Godkänt säkerhetstest (T4-B) |
|---|---|
| **SÄK-6 (P1):** fältet sätter försäljningspriset själv (1 kr i stället för artikelns 100 kr) via hela materiallistan | SEC-B1-01/03 (E, P, S): servern sätter priset, klientens ignoreras; SEC-B1-06: hela listan nekas (E, S, K) |
| **D-10:** fritext utan pris lagras som 0 kr och faktureras som en 0-kronorsrad | SEC-B1-02 (okänt, null + flagga), SEC-B1-15 (`price_unknown`) (E, P, S, K) |
| **D-10:** fastpris-AO faktureras med fastpriset och fältmaterialet separat (dubbeldebitering) | SEC-B1-16 (`included_in_fixed_price`), R21 tillägg (E, S, K) |
| **D-09/D-11:** fältet läser försäljningspris (artiklar, AO:ns materialrader) och timpris (prisgrupper, egna tidposter) | SEC-B1-09/10, SEC-B2-01 (E, R, S, K) |
| **T3-B beslut 1:** fältet registrerar normal tid på klar AO | 409 `ao_locked` (E, S, K); rättning via `correct_time` |
| **D-11:** fältet väljer en inaktiv prisgrupp (ingen kontroll) | SEC-B2-04 `price_group_not_allowed` (E, S, K) |
| **T3-B beslut 2:** en materialrad i ett fakturautkast kan ändras (utkastet blir inaktuellt) | 409 `invoiced_locked` (E, P ×20, S, K) |
| **K-01 (funktion):** `time_view_all` inte verkställd — arbetsledaren ser bara egen tid | SEC-TID-06 (E, S, K) |

`baslinje_sakerhet` (historisk källa fb71f26) oförändrad.

### 7. SÄK och D efter T4-B

- **Lokalt åtgärdade:** SÄK-6 (P1); SÄK-11:s prisdel (tillåten prisgrupp, okänt ≠ 0); B1 (fritext, okänt inköpspris, komplettering av behörig); D-08 (`time_view_all`, K-01); D-09; D-10 (okänt ≠ 0, utskicksstopp, fastpris och tillägg, serverpris); D-11 (gruppnamn utan belopp, servern validerar och sätter priset, historik); D-19 (radvisa RPC:er, egna rader, hela listan nekas för fält); Ö4 (via D-11); punkt 247 (prisgrupper, G12 — punkten därmed klar lokalt); punkt 276 serverdelen; T3-B beslut 1 och 2; F13; SÄK-17 för T4-B:s vägar (38 scenarier).
- **Delvis:** punkt 270 (källkontroll, okänt pris och "redan fakturerad" stoppas nu av servern; åtgärdsorsakerna attest/fel kund i kön oförändrade); punkt 272 (arkitekturen gjord, VK-1a/b i AO-etappen).
- **Öppna:** SÄK-1 (T4-F), SÄK-7 tilldelningsvägen (T4-C), SÄK-14 (T4-D); UI för rättning av tid (punkt 276, AO-etappen); korrigeringsflöde för fakturerade och attesterade tidposter (kreditering/omattest: T4-E respektive löneflödet).

### 8. VK-1-kompatibilitet (punkt 272; inga vyer, inget registreringsgränssnitt)

**Byggt nu (server, lokalt verifierat):**

| VK-1-krav | Arkitekturval i T4-B | Där |
|---|---|---|
| Tillfälle, styck, m², löpmeter och andra enheter | Enheten är fri text (≤ 20 tecken) på varje registrering; inget enhetsregister i koden; prisupplösningen bär enhet per pris | `_vift_t4b_ny_rad`, `_vift_t4b_pris` |
| Flera insatser och flera registreringar av samma insats på samma AO | Varje registrering är en egen rad med eget id och egen källnyckel (`insats:<AO>:<rad>`, som `material:` och `time:`) | `_vift_t4b_kallrad` |
| Obligatoriskt faktiskt utförandedatum | `performedDate` på varje rad (material: standard i dag, aldrig i framtiden; insats: **krävs** för fakturering, annars `performed_date_required`) | `_vift_t4b_ny_rad`, `_vift_t4b_kallrad` |
| Kund-, fastighets- och avtalsspecifika priser | En gemensam prisupplösning: generell (artikel/prisgrupp/tjänst) → kund → fastighet → avtal, mest specifik giltig på utförandedatumet vinner; överenskommelser i `vift_priceAgreements` (`scope`, `scopeId`, `type`, `ref`, `unitPrice`, `vatRate`, `unit`, `validFrom`, `validTo`, `active`) | `_vift_t4b_pris` (materialvägen och tidvägen använder den) |
| Historiska prissnapshots och momssatser | Pris, inköpspris, moms och priskälla (`priceSource`, `priceSourceId`) kopieras till raden vid registreringen; ändrad artikel/prisgrupp/överenskommelse ändrar inga befintliga rader | R24-testerna |
| Spårbarhet utförd insats ↔ fakturarad | Fakturaraden bär `sourceRefs[]` med källnyckeln; fakturastatus per källrad härleds (`ofakturerad`/`utkast`/`fakturerad`) | `_vift_t4b_kalla_status` |
| Individuell eller grupperad fakturering per period | En fakturarad kan bära flera källor (grupperad per tjänst och period) — alla med samma serverpris, annars `price_mismatch` | `_vift_t4b_faktura_kallor` |
| Delfakturering utan att AO avslutas | Fakturering per källrad, ingen statuskrav på AO:n; AO markeras fakturerad först när inga ofakturerade källor finns (klientens reconcile, oförändrad) | `invoice_append_checked` |
| Atomiskt skydd mot dubbelfakturering per registrering | Anspråket per källnyckel prövas under `vift_invoices`-låset (`source_collision`, `duplicate_source_key`); källraden låst när den gjorts anspråk på (`invoiced_locked`) | `invoice_append_checked`, `_vift_t4b_rad_kontroll` |
| Tid för intern uppföljning utan automatisk dubbeldebitering | Tid debiteras bara i löpande läge (`timpris`/`prisgrupp`); i fastpris ingår den (`included_in_fixed_price`) och i ett framtida insatsläge (`priceType` `insats`/`enhet`/`tillfalle`) är den intern (`source_not_billable`) | `_vift_t4b_lage`, `_vift_t4b_kallrad` |
| Fältpersonal utan belopp | Projektion av alla belopp utan prisläsrätt (även framtida `insatser[].unitPrice`) | `projectWorkOrder` |

**AO-etappen bygger på detta (punkt 273–274, ej byggt nu):** registreringsvägen för insatser (`work_order_insats_add/update/remove` efter mönstret i `work_order_material_*`, servern sätter pris via `_vift_t4b_pris('service', …)`), insatskatalogen (`vift_services`, generellt pris) och skrivvägen/UI för `vift_priceAgreements`, mobilregistrering utan belopp, fakturaunderlag per registrering/grupperat i klienten, delfakturering i kön, klockslag, utförd av, kommentar och bilder per registrering. Prövat lokalt med insatsrader injicerade direkt i databasen (VK-1-blocket i testet).

### 9. Återöppningsutredning (punkt 276, T3-B beslut 1)

- **Finns det en återöppningsfunktion?** I klienten finns ingen "återöppna" för en `klar` AO: "Byt status" visas bara för levande statusar, "Återaktivera" bara för `avbruten` (→ nytt/planerad/pågående). På servern kan `ao_edit` sätta status `klar` → `pågående` via `patch_ao` (`work_order_patch`, ao_edit-grenen), utan särskild loggning; `fakturerad` kan bara backas av faktureringsmotorn (`aoBilling restore`).
- **Kan den återanvändas för glömd tid?** Inte som säker väg: återöppning kräver `ao_edit` (inte ekonomi), öppnar AO:n för **all** normal registrering under fönstret (även andras), skriver över `completedAt/By` vid ny klarmarkering, loggar inte orsaken och fungerar inte för fakturerad AO.
- **Byggt i stället:** `time_entry_correct` (`correct_time`) — uttrycklig behörighet (`payroll_manage`), obligatorisk orsak, revisionsrad i posten och loggpost i AO:n, timpris från servern, nekar fakturerade/attesterade poster och fakturerad/låst AO. AO:ns status påverkas inte.
- **Kvar till AO-etappen (punkt 276):** UI för rättning/komplettering (dialog med orsak i Tid/AO-detaljen); om arbetsledaren också ska få rätta (se beslut 2 nedan). Den befintliga återöppningen (ao_edit `klar` → `pågående`) är oförändrad och fortsatt en verksamhetsfunktion, inte en rättningsväg.

### 10. Införandeplan per STAGING-roll (läsande analys, ingen ändring i STAGING)

För STAGING:s sju roller (provkonto byter roll i båda replikerna) är varje skillnad mellan T4-A-koden och T4-B beslutad; ingen roll får mer. Antal skillnader per roll: admin 0, e2e_arbetsledare 0, e2e_ekonomi 0, qa_p2_avgransad 0, v7_sakerhetstest 0, **e2e_falt 6** och **e2e_begransad 5** (försäljningspris och timpris borttagna i AO, tidposter, artiklar och prisgrupper; inaktiva prisgrupper dolda; REST-raden för prisgrupper dold; fältets hela materiallista nekas). Konsekvens vid installationen: STAGING:s fältkonton kan inte längre lägga till material med en **gammal** klient (403 `row_path_required`) förrän klienten laddats om — klientpaketet installeras därför i samma omgång (§11). Ingen roll tappar åtkomst till något annat. `time_view_all` finns inte i någon STAGING-roll (bara i standardrollen `chef`, som inte är installerad i STAGING).

### 11. Installationsplan och rollback — samlad omgång T4-A + notisdelen + T4-B (beskrivs, körs inte)

**Förutsättningar:** separat GO; T3-A–T3-E installerade; **en** serveromgång för `20261128000009` → `20261128000010` → `20261128000011` med EF:erna och klientpaketet i samma fönster.

**Backup (tillägg till T4-A §11 och notisdelens §10):** definitionerna av de tio funktioner T4-B ersätter (md5 = STOP-värdena i migrationen); JSON-kopia med sha256 av `vift_workOrders`, `vift_timeEntries`, `vift_invoices`, `vift_articles`, `vift_priceGroups`; EF-backup av `ao-time-write`, `time-entries-list`, `invoice-write`, `work-orders-list` (+ `_shared/vift-auth.ts`).

| Steg | Innehåll |
|---|---|
| 1. Läsande förkontroll | Som T4-A och notisdelen, plus: md5 av T4-B:s tio ersatta funktioner = STOP-värdena; antal AO per `priceType`; antal materialrader med `sellPrice` 0/saknat (blir "okänt" i tolkningen, inga data ändras); antal tidposter med `hourRate` 0 på löpande AO; antal fakturautkast med källrader (de låser sina källor från installationen); öppna stämplingar på `klar` AO (utstämplingen fungerar; ingen ny instämpling) |
| 2. Databas | `20261128000009`, `20261128000010`, `20261128000011` var och en i egen transaktion, i den ordningen. Ingen `db push`, ingen `migration repair` |
| 3. Edge Functions, direkt efter steg 2 | T4-A:s sju + `store-key-write` (notisdelen) + T4-B: `ao-time-write`, `time-entries-list`, `invoice-write`, `work-orders-list` med `_shared/vift-auth.ts` (en bunt, samma `_shared`) |
| 4. Klient | Samma klientpaket (`tools/build-staging-package.sh` från HEAD; `?v=` höjt för T4-A, notisdelen och T4-B) |
| 5. Storage | Ingen ändring |
| 6. Efterkontroll (V6, läsande) | md5 av nya/ändrade funktioner = `tests/local/t4-andringar.json`; per testkonto: SEC-B1-09/10 och SEC-B2-01 (fältet ser inga priser i `readAllWithHashes`, `work-orders-list`, `time-entries-list`, REST); SEC-TID-06/09; T4-A:s och notisdelens kontroller. Skrivande SEC-B1-01..05/08, SEC-B1-13, SEC-B2-03 och fakturaflaggan med ett märkt testunderlag (SEC-B1-15) bara på märkta test-AO/testartiklar efter separat GO |

**Fönstret mellan steg 2 och 3** (gamla EF:er mot T4-B-databasen; prövat): fältets hela materiallista nekas redan i RPC:n (403 `row_path_required`) och `add_material` finns inte (400 `unknown_action`) — fältet kan inte registrera material under fönstret; tid, stämpling och fakturering följer redan de nya reglerna i RPC:erna; **`time-entries-list` och AO-svaren lämnar fortfarande ut priser till fältet** (projektionen ligger i EF:en) tills steg 3. Fönstret ska vara minuter.

**Fönstret mellan steg 3 och 4** (gamla klienter i Service Worker-cachen): §12.

**Rollback (ingen data skrivs över), omvänd ordning:** 1) föregående EF-versioner för `ao-time-write`, `time-entries-list`, `invoice-write`, `work-orders-list` (+ `_shared`) och föregående klientpaket; 2) `supabase/rollback/T4-B/rollback_t4b.sql` (återställer de tio funktionerna exakt, tar bort T4-B:s 24 nya; rör ingen tabell och ingen rad); 3) notisdelens rollback (§10 i tilläggsdelen); 4) T4-A:s rollback (§11); 5) vid behov T3-E-, T3-D-, T3-C- och T3-B-rollbacken. Data som skapats efter installationen är giltig för den äldre koden: materialrader med `sellPrice: null` och flaggor (den äldre klienten visar "Saknar försäljningspris" i kön och kan inte fakturera dem utan komplettering — inga 0-kronorsrader), `performedDate`, `extra`, `updatedBy` (ignoreras), tidposter med `hourRate: null`/`hourRateUnknown`/`corrections` (den äldre kön visar "Saknar timpris"). Prövat: efter rollback fungerar T4-A-klientens väg på T4-B-data. JSON-kopiorna återläses bara vid ett separat beslut om ett datafel.

### 12. Gammal klient (v3.4, T3, T4-A i Service Worker-cache) mot ny server

| Åtgärd | v3.4-klient | T3- och T4-A-klient | Följd |
|---|---|---|---|
| Läsning (`work-orders-list`, `time-entries-list`, `readAllWithHashes`) | Projicerade värden: fältet får inga priser; prisgrupper utan timpris | Samma | Ingen breddning; gamla vyer visar "0 kr"/tomt där beloppet saknas (presentationsfel, inget läckage) tills omladdning |
| Fältets materialrad (hela listan, "\|\| 0"-priser) | 403 `row_path_required` (definitivt avslag; raden försvinner lokalt vid nästa synk, felmeddelande) | Samma | **Inga rader förstörs, inga priser sätts, ingen 0-kronorsrad.** Fältet kan inte lägga till material förrän omladdning; servern skyddar |
| Arbetsledarens materialformulär (hela listan) | Godtas; nya rader serverprissätts; 0 över okänt ignoreras (`ignoredFields`); prisändring med prisrätt godtas | Samma | Inga 0-kronorsrader; okända priser förblir okända |
| Material eller tid i ett fakturautkast | 409 `invoiced_locked` (v3.4 och T3 behandlar okänd 409 som tillfällig och försöker igen begränsat antal gånger; ingen dataförlust) | T4-A: samma | Ändringen nekas, utkastet förblir korrekt |
| `create_time` med klientens `hourRate` | Ignoreras; servern sätter grupps pris; utan grupp okänt (null) | Samma | Inget klientpris lagras |
| Stämpla ut med en annan prisgrupp än AO:ns | Utstämplingen slutförs med AO:ns grupp (`ignoredFields: ['priceGroupId']`) | Samma | Utfört arbete går aldrig förlorat |
| Normal tid eller instämpling på klar AO | 409 `ao_locked` (definitivt i T3/T4-A; v3.4 som felmeddelande) | Samma | Rättning via `correct_time` (servern; UI i AO-etappen) |
| Faktureringskö med okänt pris som 0 kr / fastpris + material (v3.4-regeln) | 409 `price_unknown` / `included_in_fixed_price` — ingen faktura skapas | Samma | Kön visar felet; omladdning ger T4-B-kön (okänt = åtgärdsorsak, fastpris-material ingen källa) |
| Prisgrupp aktivera/inaktivera | Sparar via `write` som förut (besked före bekräftelse) | Samma | Serverns svar avgör; presentationsfel tills omladdning |
| Nya felkoder | Visas som generellt fel | Samma | – |

Skyddet ligger på servern; manuell omladdning behövs inte för skyddet, bara för att fältet ska kunna registrera material igen. Service Workern är network-first och `?v=` är höjt.

### 13. Kontrollpunkter (BESLUT-2026-11-28)

| Kontrollpunkt | Uppfylld | Belägg |
|---|---|---|
| Obligatoriska tester godkända | Ja | §5 (`material_pricing` = `t4b_material_priser`, `sim_parity`, fakturaunderlag med okänt pris i `invoice-write` lokalt) |
| Negativa tester: rätt felkod och ingen mutation | Ja | `expectReject` (status, error, reason, KS) i alla negativa EF-fall; RPC-fall med felmeddelande |
| Atomiska samtidighetskontroller | Ja | Kontrollerna i RPC:erna under en gemensam låsordning; fem ×20-fall med egna anslutningar (exakt en vinner där det ska, inget tappas) |
| Ingen oavsiktligt utökad informationsåtkomst | Ja | 13 användare och sju STAGING-roller: varje skillnad beslutad (avsmalning eller `time_view_all`) |
| Verksamhetskritiska flöden | Ja | Offert → AO, fakturakö → underlag → status → backning, import/återkommande, stämpling (även midnatt/sommartid), checklista, material, lönsamhet; run-all och e2e |
| Avgränsade commits | Ja | Server, tester, klient, tester/e2e, e2e-rapport, dokument |
| Prövad rollback | Ja | Installera → rollback → installera, STOP, omvänd ordning = STAGING-facit |
| Faktisk verifieringsnivå i masterplanen | Ja | SÄK-6, SÄK-11, D-08–D-11, D-19, B1, Ö4, 247, 270, 272, 276, F13, T4-raden: "lokalt verifierad"/"delvis" |
| PG17 och Deno | Nej (miljön) | Kvarstår som releasevillkor |

**GO-kriterier T4-B (testplanen §6):** okänt ≠ 0 överallt — **ja** (material, tid, kö, lönsamhet, faktura); fältet ser inga belopp — **ja** (E, R, S, K); fakturaunderlag med okänt pris stoppas — **ja** (skapande och utskick); ingen dubbeldebitering vid fastpris — **ja** (material och tid; tillägg uttryckligen).

### 14. Kända begränsningar och beslut som behövs

**Begränsningar:**
- PG16 och Node i stället för PG17 och Deno (releasevillkor).
- Gamla klienter: fältet kan inte lägga till material förrän omladdning (§12).
- `invoice_line_update` kan fortfarande ändra à-priset på en källrad i ett **utkast** (ekonomins justering, oförändrat); `price_mismatch` prövas vid skapandet. Utskick stoppas bara för okänt pris.
- Prisöverenskommelser (`vift_priceAgreements`) och insatser saknar skrivväg (AO-etappen); prövade med data injicerade i databasen.
- Fakturerade och attesterade tidposter kan inte rättas alls utan fakturans korrigeringsflöde (T4-E) respektive attestens (omattest i löneflödet); `time_entry_correct` nekar dem.
- `readAllWithHashes` ger hash av hela servervärdet (som T4-A).
- Fake-backenden modellerar fortfarande inte C-5 för fakturor och offerternas interna fält (T4-E).

**Beslut som behövs (förslag i parentes; det mest restriktiva valet som inte bryter ett flöde är genomfört):**
1. Prisläsrätt = `ao_edit`, `ao_view_all`, `invoice_view`, `invoice_create`, `cost_view`, `article_manage`, `offer_manage` (`reports_view`, `customer_manage`, `sales_manage`, `recurring_manage` ensamma ger inte priser). (Godta; samma mängd som D-06 utvidgad med artikel- och offertansvar.)
2. Rättning av tid i efterhand kräver `payroll_manage` (ekonomi, admin); arbetsledaren nekas. (Ditt beslut: godta, eller ge `ao_edit` kompletteringsrätt, eller inför en uttrycklig behörighet `time_correct` i AO-etappen.)
3. Normal tidregistrering, ändring och borttagning av tid är låst på `klar` AO för **alla** roller, även `payroll_manage` — de använder `correct_time`. Tills UI finns (AO-etappen) kan ekonomi inte rätta tid på klar AO i klienten. (Godta som restriktivt; alternativet är att låta `patch_time` från `payroll_manage` gå igenom med automatisk revisionsrad.)
4. En källrad i ett fakturautkast låses (nekas) i stället för att utkastet markeras inaktuellt. (Godta; atomiskt och enklast att förstå.)
5. Fritext får pris bara från `invoice_create`/`cost_edit`; artikelrader alltid serverpris vid registrering (justeras sedan radvis med rätt). Ett manuellt pris 0 räknas som känt bara när det satts radvis av en behörig. (Godta.)
6. `create_ao` (offert → AO, import) behåller klientens försäljningspris bara från en roll med prissättningsrätt och bara > 0; annars okänt. (Godta.)
7. Fältets prisgruppsval begränsas till AO:ns grupp när AO:n har en. (Godta; D-11 "bara tillåtna grupper".)
8. `time_view_all` ger inte `hourRate` för andras poster utan prisläsrätt (chef har `cost_view`). (Godta.)

### Ändrade filer

**vift-v2** (`claude/vift-system-restructure-8fUme`):
- nya: `supabase/migrations/20261128000011_t4b_material_priser_tid.sql`; `supabase/rollback/T4-B/rollback_t4b.sql`; `tests/t4b_material_priser.test.js`; `tests/local/t4b-rollback.js`; `tests/e2e/t4b-regler.js`;
- ändrade: `supabase/functions/{_shared/vift-auth.ts, ao-time-write, time-entries-list, invoice-write}/index.ts`; `supabase/MIGRATIONSORDNING.txt`, `MIGRATIONSMAPPNING.md`, `migrationsmappning.json`; `supabase/manual/t3e_standardroller/{standardroller.json, A–D}`; `tests/local/{t4-andringar.js, t4-andringar.json, jamfor-schema.js, lib/paritet.js}`; `tests/e2e/fake-backend.js`; `tests/staging/{authz-read,authz-mutation}.js`; `tests/{replica_build, t3b_ao_karna, t3e_installation, t3e_standard_roles, t4a_notiser, t4a_skyddade_falt}.test.js` (se §5.2).

**VIFT-CRM** (`claude/vift-v3-major-redesign`):
- ändrade: `index.html`, `src/services/{AOTimeSyncService,WorkOrderService,TimeService,BillingQueueService,ProfitabilityService}.js`, `src/pages/{WorkOrderDetailPage,TimePage,InvoicesPage,PageShells}.js`; `tests/e2e/fake-backend.js`, `tests/staging/{authz-read,authz-mutation}.js`; detta dokument, `docs/MASTERPLAN.md`, `docs/qa-2026-11-26/BEHORIGHETSMATRIS.md`;
- nya: `tests/e2e/t4b-regler.js`, `tests/e2e/specs/43_t4b_material_priser.js`.

### Commits

**vift-v2** (`claude/vift-system-restructure-8fUme`, inte pushad):
- `bee3288` T4-B server (migration `20261128000011`, EF, rollback, MIGRATIONSORDNING, MIG-1, standardroller)
- `3bb0874` T4-B tester (`t4b_material_priser`, registret, `t4b-rollback`, paritet, fake-kopia, `t4b-regler`, anpassade T3/T4-A-tester och STAGING-verktyg)

**VIFT-CRM** (`claude/vift-v3-major-redesign`, inte pushad):
- `953ad19` klient (material radvis, inga belopp för fält, okänt ≠ 0, F13, G12, `?v=`)
- `5ffc7e6` tester (fake-backend, `t4b-regler`, e2e T4B-01–08, anpassade specar, STAGING-verktyg)
- `687f1b2` dokument
- e2e-rapport (274/0/0) och dokumenttillägg: se `git log` efter `687f1b2`
