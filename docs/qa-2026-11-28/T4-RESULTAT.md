# T4-resultat (säkerhetsomgången T4)

Ett avsnitt per paket, i ordningen T4-A + T4-B (samordnat), T4-C, T4-D, T4-E, T4-F. Varje paket uppdaterar sitt eget avsnitt; inga nya dokument.
Styrande beslut: `BESLUT-2026-11-28.md`, avsnittet "Tillägg efter T3-leveransen".
Verifieringsnivån är **lokalt verifierad**: lokal PostgreSQL 16.15, Edge Functions körda i Node, webbläsartester mot den simulerade servern.
Ingenting är installerat eller verifierat i STAGING. LIVE är inte kontaktad. PostgreSQL 17 och Deno kunde inte hämtas i miljön (paketkällorna saknar DNS-uppslag); de kvarstår som releasevillkor.

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
- **Öppna:** SÄK-1 (T4-F), SÄK-6 (T4-B), SÄK-7 tilldelningsvägen (T4-C), SÄK-14 (T4-D); notisernas säkra skrivväg (§9).

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
| Notiser: åt andra användare utan kontroll av aktör, mottagare och referens; dessutom läser varje inloggad hela `vift_notifications` (REST och EF), även andras notiser (AO-titlar m.m.) | **Bedömd, inte byggd.** Läs- och skrivvägen hänger ihop: klientens `persistNotifs` läser hela listan via REST och skriver tillbaka den (REST-vitlistan, T3-C). Att projicera listan per mottagare utan ny skrivväg bryter både v3.4 och T4-klienten. Säker väg: EF-åtgärderna `appendNotification` (servern sätter avsändare och tid, mottagaren måste vara aktiv personal, referensen prövas med `_vift_ref_visible`, typ per behörighet) och `markNotificationsRead` (bara egna), RPC under radlås, projektion per mottagare (`userId`), därefter REST-läsning och -skrivning av `vift_notifications` stängd och `vift_lastChanged` bort från vitlistan (punkt 275). | **Placering:** eget litet serverpaket **"T4-N Notiser"** direkt efter T4-F (före STAGING-verifieringen V1–V11), samordnat med AP-D (AO-etappen). **Verifiering:** lokalt `notifications_write` (aktör, mottagare, referens, egna markeringar, ×20 samtidighet), paritet och e2e NOTIF; STAGING V3. **Releasevillkor:** före LIVE (P2-klassning föreslås; läckan av andras notiser kan vara P1 om notiserna innehåller kunduppgifter — beslut behövs). |

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
- Notisernas säkra väg är inte byggd (§9).

**Beslut som behövs (förslag i parentes; det mest restriktiva valet som inte bryter ett flöde är genomfört):**
1. Övergångsregel för T4:s två nya behörigheter (roll utan båda = T3-E:s härledning) tills alla aktiva roller i STAGING och LIVE har fått dem uttryckligen. (Godta; alternativet — införa dem som data i STAGING:s roller vid installationen — kräver GO per roll.)
2. Utan `activity_log_view_all` får en roll med `ao_view_all` bara händelser för AO där den är **tilldelad** (inte alla AO den ser). (Godta; mest restriktivt; fält behåller sin historik.)
3. `staff_view` ger inte arbetskontakt utan `staff_contacts_view` (för nya roller). (Godta.)
4. AO-ekonomi (`fixedPrice`) läses av `ao_edit`, `ao_view_all`, `invoice_*` och `cost_view`; fält får debiteringskategorin. (Godta; D-06.)
5. Inaktiverad roll ger inga behörigheter (tidigare ignorerades `active`), även för superadmininvarianten. (Godta; A-kontroll före installation.)
6. En kunds typbyte från privatperson med lagrat org.nr nekas utan `personal_data_view` (annars skulle numret bli läsbart). (Godta.)
7. Notiserna: eget serverpaket "T4-N" efter T4-F, före STAGING-verifieringen; klassning P1 eller P2. (Ditt beslut.)
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
