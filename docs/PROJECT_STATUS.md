# PROJECT_STATUS.md — VIFT CRM

Uppdaterad: 2026-07-26. Komplement till `docs/MASTERPLAN.md`.

---

## Aktuell release

| | |
|---|---|
| **Version** | 1.0.0 RC1 |
| **Produktions-commit** | `2b01cea` (per brief 2026-07-26) |
| **Staging-commit** | `54ebd01` (per brief 2026-07-26) |
| **Produktions-URL** | https://crm.viftfast.se |
| **Staging-URL** | https://staging-crm.viftfast.se |
| **Supabase prod** | `hjplzjsbbowiyoyhdghc` |
| **Supabase staging** | `yyzljlqyzzcbxmcdbual` |

---

## Modulstatus

### Fas 0 — Kärninfrastruktur

Alla 8 funktioner: **KLAR** (commit `9b39b63`)

- Router.js (hash-routing, pushState/popstate)
- Storage.js (Supabase single-table store, localStorage-cache)
- Auth.js (JWT, roller, RLS, `Auth.can()`)
- sw.js v10 (Service Worker, network-first, cache-busting)
- DataSync.js (30-sekunders polling)
- ActivityService.js (revisionslogg)
- ActivitiesService.js (att-göra-uppgifter)
- PushService.js + `send-push` Edge Function (Web Push, VAPID)

### Fas 1 — CRM-kärna

| # | Funktion | Status |
|---|---|---|
| 9–10 | Arbetsorder CRUD, wizard, checklist, material, tid, fakturering | KLAR |
| 11 | AO — objectId + objectName i wizard och detalj | KLAR |
| **12** | AO — snapshot-fält (customerName, objectNumber, contactId, contactName, accessInformation) | **EJ BYGGD** |
| **13** | AO — sökning på objektnamn/objektnummer/port/trapphus | **EJ BYGGD** |
| 14–26 | Kunder, fastigheter, offerter, fakturaunderlag, tid, återkommande, säljchanser, personal, artiklar, prisgrupper, admin, dashboard, sidebar | KLAR |

### Fas 2 — Rondering

Alla 5 funktioner (27–31): **KLAR**

### Leverans 1 — Serviceintervall

| # | Funktion | Status |
|---|---|---|
| 32–39 | Serviceintervall — 8 typer, 16 kategorier, kalenderberäkning, markera utförd, pausa, AO-länk, daglig klientkörning | KLAR |
| **40** | Schemalagd Edge Function `service-monitor` (server-side daglig körning) | **EJ BYGGD** — EF deployd i production men inte aktiverad med cron |
| **41** | Server-side dubblettskydd (atomisk idempotens) | **EJ BYGGD** |
| **42** | Web Push för serviceintervall per ansvarig | **EJ BYGGD** |
| 43 | Automatisk AO via Edge Function | FÖRBEREDD (koden finns i ServiceIntervalService.js) |

**OBS om punkt 40**: `service-monitor` EF är deployd i produktion (per brief). Cron-schemaläggning kräver att `supabase/manual/setup_service_monitor_cron.sql` körs manuellt i SQL Editor och kräver explicit godkännande av Lucas.

### Leverans B — Kundimport och -export

Alla 11 funktioner (44–54): **KLAR** (commits `9910cda`, `d3b5117`, `33872a1`, `fb9ff35`)

Notering: Diff-vy vid konfliktlösning (punkt 50) är EJ BYGGD men konfliktlösningslogiken finns.

### Leverans C — Objekt, lägenheter och lokaler

| # | Funktion | Status |
|---|---|---|
| 55–61, 65–70 | Schema, state, CRUD, sidor, router, AO-wizard-koppling, SI-koppling, rondering-koppling | KLAR |
| 59 | Raderingsskydd | DELVIS (aktiva SI + ej arkiverade AO, ej stängda AO) |
| **62** | Objektskortet — serviceintervall | **EJ BYGGD** |
| **63** | Objektskortet — avvikelser | **EJ BYGGD** |
| **64** | Objektskortet — bilder och dokument | **EJ BYGGD** |
| **67** | AO-wizard — prefill adress, kontakt, telefon från objekt | **EJ BYGGD** |
| 71 | Kontakter/hyresgäster i objekt | FÖRBEREDD (schema finns, ingen CRUD-UI) |
| **72** | Rollbaserat döljande av portkod | **EJ BYGGD** |

---

## R9B — Statusuppdatering 2026-10-25 (säkerhetsfynd STAGING/LIVE, ej åtgärdade)

Loggat enligt projektdirektivet: miljö, exakt ändring/berörda funktioner, datum/syfte, verifieringsresultat, påverkan på nästa release, status. **Ingen kod eller databas har ändrats till följd av denna loggning** — rent dokumentationsarbete, inget kommittat/pushat/kört mot Supabase.

| # | Miljö | Exakt fynd / berörda funktioner | Datum | Verifieringsresultat | Påverkan på nästa release (R9B) | Status |
|---|---|---|---|---|---|---|
| 1 | STAGING | Faktura-RPC:erna (`invoice_line_add`, `invoice_line_update`, m.fl.) har fortfarande sina GAMLA signaturer, utan R9B:s `expectedRevision`. R9B-migrationen är INTE installerad i STAGING. | 2026-10-25 | Verifierat (läst mot faktisk STAGING-databas) | R9B:s konfliktskydd/precisionskontroller kan inte testas förrän migrationen installeras — blockerar punkt 3/4/5 i den prioriterade ordningen. | **Planerad** (installation ännu ej genomförd) |
| 2 | STAGING | `public.store` har RLS aktiverad, men policyn `store_active_write_safe` tillåter `authenticated`-roller `SELECT`/`INSERT`/`UPDATE`/`DELETE` direkt på `vift_invoices`, `vift_workOrders`, `vift_timeEntries` — kringgår hela RPC-lagret. | 2026-10-25 | Verifierat (läst RLS-policy i STAGING) | Direkt motsvarighet till BLOCKER-2 nedan, men nu bekräftat i STAGING:s FAKTISKA policy (inte en antagen risk). Måste åtgärdas, eller medvetet accepteras av Lucas, innan R9B-installation ger fullt skydd. | **Verifierad** (fyndet — inte en åtgärd) |
| 3 | STAGING | Ingen egen trigger finns på `public.store`. Det tidigare föreslagna, EJ installerade triggerförslaget (`20261024000002_PROPOSAL_direct_write_trigger_guard.sql`) är alltså fortfarande endast ett lokalt bevisat förslag — inget skydd finns i STAGING idag utöver RLS-policyn i punkt 2. | 2026-10-25 | Verifierat | Samma blockering som punkt 2 — ingen teknisk spärr mot direktskrivning finns ännu i STAGING. | **Verifierad** (frånvaro bekräftad) |
| 4 | STAGING | Tre `SECURITY DEFINER`-funktioner är anropbara av `anon` OCH `authenticated`: `provision_vift_user`, `deactivate_vift_user`, `check_app_users_health`. | 2026-10-25 | Verifierat (`has_function_privilege()`-typ av behörighetskontroll, läst mot STAGING) | Utanför R9B:s egna fakturafunktioner, men en direkt, allvarlig skrivväg i samma databas — måste räknas in i "andra SECURITY DEFINER-funktioner som alternativ skrivväg"-granskningen som redan efterfrågades i triggerförslaget. | **Verifierad** |
| 5 | STAGING | `provision_vift_user` och `deactivate_vift_user`s källkod saknar INTERNA behörighetskontroller (ingen `checkViftAuth()`/motsvarande innan de utför sin åtgärd). | 2026-10-25 | Verifierat (källkoden läst i STAGING) | En `anon`/`authenticated`-anropare kan sannolikt provisionera/avaktivera användarkonton utan behörighetskontroll — en allvarlig, konkret säkerhetsrisk, oberoende av R9B:s fakturaarbete men i SAMMA databas. | **Verifierad — KRITISK, ej åtgärdad** |
| 6 | LIVE | Samma tre funktioner (`provision_vift_user`, `deactivate_vift_user`, `check_app_users_health`) var ÄVEN anropbara av `anon`/`authenticated` i LIVE. | 2026-10-25 | Verifierat (behörighet, FÖRE åtgärden i punkt 10 nedan). LIVE-funktionernas källkod jämfördes ALDRIG mot STAGING:s innan behörigheten stängdes — okänt om samma kodbrist (punkt 5) även gällde i LIVE, men frågan är numera mindre akut eftersom `anon`/`authenticated` inte längre kan anropa funktionerna alls (se punkt 10). | Risken för obehörig anropsväg är stängd (se punkt 10) oavsett om koden i sig hade samma brist. | **Ersatt av punkt 10** |
| 7 | LIVE | Ett förslag till riktad `REVOKE`/`GRANT`-säkerhetsåtgärd (begränsa `EXECUTE` på de tre funktionerna i punkt 4/6 till avsedd roll) hade tagits fram. | 2026-10-25 | Åtgärden är nu BEKRÄFTAT genomförd och behörighetsverifierad — se punkt 10. | Punkt 1 i den prioriterade ordningen (stäng verifierade kritiska säkerhetsrisker i LIVE) är nu uppfylld FÖR DENNA SPECIFIKA RISK. | **Genomfört och verifierat** (se punkt 10) |
| 8 | STAGING | R9B:s fullständiga paket (SQL-migration, Edge Function, klientfiler, tester) är förberett (lokalt, i detta arbetsflöde) men INTE publicerat/installerat i STAGING. | 2026-10-25 | Paketet är internt testat (324 lokala kontroller, se tidigare leveransrapporter) men inte körd mot STAGING. | Motsvarar punkt 3 i den prioriterade ordningen — ej påbörjad i den riktiga miljön. | **Förberedd, EJ installerad** |
| 9 | STAGING ↔ LIVE | Fullständig filparitet mellan LIVE och STAGING (klientfiler, SQL-funktioner, Edge Functions) är ÄNNU INTE verifierad. | 2026-10-25 | Ej genomförd. | Krävs enligt punkt 2 i den prioriterade ordningen innan R9B installeras i STAGING, för att undvika att installera R9B ovanpå en STAGING-baseline som redan avviker från LIVE på okända sätt. | **Ej påbörjad** |
| 10 | LIVE | **Bekräftad genomförd ändring**: behörigheterna för `public.check_app_users_health()`, `public.deactivate_vift_user(uuid)`, `public.provision_vift_user(uuid, text, text, boolean)` har begränsats. Syfte: stänga den i punkt 4/5/6 identifierade obehöriga anropsvägen i LIVE. | 2026-10-25 (genomfört och rapporterat samma dag som punkt 1–9 loggades) | Effektiva behörigheter kontrollerade EFTER ändringen, samtliga tre funktioner: `anon`=false, `authenticated`=false, `service_role`=true. Behörighetsverifiering bekräftad. **Ordinarie CRM-inloggning och funktionstest EFTER ändringen är ÄNNU INTE bekräftat** (se punkt 11). | Stänger den akuta, verifierade LIVE-risken i punkt 6/7. Utgör nu LIVE:s nya säkerhetsbaseline inför R9B — se punkt 12 för STAGING-paritet. | **Genomfört och behörighetsverifierat i LIVE.** Funktionell regression ej bekräftad. |
| 11 | LIVE | Uppföljning till punkt 10: bekräftelse att ordinarie inloggning och normal funktion i VIFT CRM fortfarande fungerar EFTER behörighetsändringen. | 2026-10-25 | **Genomfört av Lucas Samuelsson**: LIVE-smoketest godkänt — inloggning, navigering och faktureringsvyn kontrollerade och fungerar. Ersätter INTE R9B:s kommande samlade sluttest. | Punkt 10 kan nu räknas som en riskfri, fullständigt avslutad åtgärd i LIVE — behörighetsändringen bröt inte någon observerad, legitim anropsväg. | **Genomfört och godkänt** |
| 12 | STAGING | **Bekräftad genomförd ändring**: samma behörighetsbegränsning som punkt 10 (`check_app_users_health()`, `deactivate_vift_user(uuid)`, `provision_vift_user(uuid, text, text, boolean)`) är nu genomförd även i STAGING. Syfte: stänga samma obehöriga anropsväg i STAGING som i LIVE (punkt 10). | 2026-10-25 | Effektiva behörigheter kontrollerade EFTER ändringen, samtliga tre funktioner, i STAGING: `anon`=false, `authenticated`=false, `service_role`=true. Behörighetsverifiering bekräftad för BÅDA miljöerna. Funktionellt smoketest — se punkt 13. | STAGING har nu samma behörighetsbaseline som LIVE för dessa tre funktioner. | **Genomfört och behörighetsverifierat i STAGING.** |
| 13 | STAGING | Uppföljning till punkt 12: bekräftelse att ordinarie inloggning och normal funktion i VIFT CRM fortfarande fungerar i STAGING EFTER behörighetsändringen. | 2026-10-25 | **Genomfört av Lucas Samuelsson**: STAGING-smoketest godkänt. Ersätter INTE R9B:s kommande samlade sluttest. | Punkt 12 kan nu räknas som en riskfri, fullständigt avslutad åtgärd i STAGING — behörighetsändringen bröt inte någon observerad, legitim anropsväg. Behörighetsåtgärden är nu stängd OCH funktionsbekräftad i BÅDA miljöerna. | **Genomfört och godkänt** |

**Sammanfattning, uppdaterad 2026-10-25 (efter punkt 10–13)**: Behörighetsbegränsningen för de tre `SECURITY DEFINER`-funktionerna är nu BEKRÄFTAT GENOMFÖRD, BEHÖRIGHETSVERIFIERAD OCH FUNKTIONSBEKRÄFTAD i BÅDA miljöerna (LIVE: punkt 10–11, STAGING: punkt 12–13) — `anon`=false, `authenticated`=false, `service_role`=true i båda, och smoketest godkänt av Lucas Samuelsson i båda. `store_active_write_safe`-policyn (punkt 2) och avsaknaden av en skyddande trigger (punkt 3) kvarstår OFÖRÄNDRADE i STAGING, och direktskrivningsskyddet för `vift_invoices`/`vift_workOrders`/`vift_timeEntries` (AO, tidposter, fakturor) återstår helt, i BÅDA miljöerna. R9B är fortsatt inte installerat i STAGING (punkt 1/8), och LIVE/STAGING-paritet (punkt 9) är fortsatt overifierad — nu nästa prioritet. Backloggpunkt #83 (UI/UX, faktureringsvyn) kvarstår registrerad, oförändrad, prioriterad EFTER R9B:s releasekritiska arbete — ingen UI-ändring genomförd.

**Enligt den prioriterade ordningen i direktivet**: punkt 1 (stäng verifierade kritiska säkerhetsrisker, behörighet OCH funktion) är nu **HELT uppfylld i BÅDA miljöerna** för den specifika risken i punkt 4–7.

### Punkt 9 (LIVE/STAGING-paritet), uppdaterad 2026-10-25 — betydande skillnad funnen

| Miljö | Fynd | Status |
|---|---|---|
| LIVE | Sökning efter `invoice_*`/`work_order_*`/`time_entry_*` i `public` visar ENDAST `work_order_checklist_resolve`. Inga `invoice_*`, inga `time_entry_*`. | **Verifierat** |
| STAGING | 9 `invoice_*`-funktioner finns, med de GAMLA signaturerna (utan R9B:s `expectedRevision`). | **Verifierat** |

**Rotorsak (kartlagd mot migrationshistoriken i detta arbetsområde)**: LIVE:s deployade commit (`2b01cea`, per brief 2026-07-26) föregår de migrationer (daterade 18 oktober 2026) som skapar hela den atomiska fakturerings-RPC-arkitekturen STAGING nu har. LIVE kör sannolikt fortfarande en ÄLDRE, annorlunda faktureringsmekanism (utan atomiska RPC:er) — inte bara en äldre VERSION av samma mekanism. **Detta är en slutsats dragen från verifierade fakta (LIVE:s commit-datum + migrationernas datum), inte en direkt observation av LIVE:s klientkod.**

**Tre fakta saknas fortfarande och måste verifieras innan LIVE rörs**:
1. Använder LIVE:s faktiskt deployade klientkod (`index.html`/`InvoiceService.js`) RPC-anrop (`invoice-write`-EF) eller den äldre `persist()`-vägen?
2. Finns en `invoice-write`- (eller äldre `invoice-set-status`-) Edge Function deployad i LIVE?
3. Matchar STAGING:s faktiska klientkod den bas R9B-paketet bygger vidare på?

Fullständig analys, beroendekedja, riskbedömning och plan: se `PLAN-LIVE-STAGING-UPPGRADERING.md` (levererad separat 2026-10-25). Konsekvens: en LIVE-uppgradering är sannolikt STÖRRE än en STAGING-uppgradering (kan kräva hela RPC-basen, inte bara R9B:s tillägg) — de två miljöerna behandlas som SEPARATA installationsbeslut, inte ett gemensamt steg.

### Punkt 14 — RPC-ägarroll och alternativ skrivväg, verifierad mot STAGING (2026-10-25)

| Fynd | Resultat |
|---|---|
| Ägarroll för samtliga 23 relevanta RPC:er (9 `invoice_*`, 4 `work_order_*`, 3 `time_entry_*`, 7 `rondering_*`) | **Verifierat**: EN ENDA roll, `postgres`, för samtliga 23. |
| Behörighet (`anon`/`authenticated`/`service_role`) för samtliga 23 | **Verifierat**: `anon`=false, `authenticated`=false, `service_role`=true för alla. |
| Ytterligare `public`-schema SECURITY DEFINER-funktioner med effektiv EXECUTE för `anon`/`authenticated`, utöver de 23 ovan och de tre tidigare åtgärdade (`check_app_users_health`/`deactivate_vift_user`/`provision_vift_user`) | **Verifierat**: inga ytterligare hittades. |

**Konsekvens**: den tidigare öppna frågan ("kräver direktskrivningsskyddets trigger en lösning med flera ägarroller?") är nu stängd — EN roll (`postgres`) räcker. Triggerförslaget (`20261024000002...sql`) är nu färdigställt för installation med denna roll ifylld (ny fil: `20261024000002_READY_direct_write_trigger_guard.sql`, syntaxkontrollerad lokalt, EJ körd mot STAGING). Fullständig, rättad installationsorder: se `INSTALLATIONSORDER-R9B-STAGING-SLUTLIG.md` (levererad separat 2026-10-25).

### Punkt 15 — R9B INSTALLERAD OCH GODKÄND I STAGING (2026-10-25)

**Bekräftad genomförd installation**: SQL-migration (transaktion slutförd), PostgREST-schemaomladdning, riktad direktskrivningstrigger, uppdaterad `invoice-write`-EF, fem uppdaterade klientfiler (`index.html`, `service-worker.js`, `state.js`, `InvoiceService.js`, `InvoicesPage.js` — `TimeEntriesReadService.js` oförändrad).

**Sex manuella funktionstester, samtliga godkända**:
1. Fakturaradändring kvarstår efter omladdning.
2. Två sessioner (samma konto), samma faktura: första sparningen lyckades, andra stoppades med korrekt konfliktvarning + aktuell serverversion.
3. AO-001-uppdatering kvarstår efter omladdning.
4. Tidregistrering sparades korrekt, inga oavsiktliga ändringar av timmar/pris.
5. Direktuppdatering av `vift_invoices` (som `service_role`) blockerades med `direct_write_blocked` — triggern verifierad fungerande mot en RIKTIG skrivförsök, inte bara lokalt.
6. Fast rabatt `0,005 kr` avvisad med tydligt fel; totalsumma oförändrad efter omladdning.

**Redovisade avgränsningar i testerna** (per er egen notering, inte dolda): tvåsessionstestet (punkt 2) användes med SAMMA konto, inte två olika användare — en riktig multi-användar-konflikt är därför ÄNNU INTE testad, bara samma-konto-dubbelsessionen. Rollkontroll och klientvalidering för rabatten hade begränsad täckning i detta testpass.

**Status: R9B:s planerade STAGING-testomgång är GODKÄND.** Ingen ny funktionsutveckling på grund av detta. Nästa steg: LIVE-release, se nedan.

### LIVE-releaseplan (2026-10-25)

LIVE är INTE "STAGING minus R9B" — två separata, motsatta gap är bekräftade: LIVE saknar hela den atomiska fakturerings-RPC-arkitekturen (Oct18-migrationerna + `invoice-write`-EF, som STAGING fick i en separat, senare insats LIVE aldrig fick), MEN har enligt uppgift egna, senare klientändringar STAGING saknar (exakt vilka är ännu inte verifierat i denna session).

**Tre öppna krav innan en LIVE-installation kan beslutas** (se fullständig plan i `PLAN-LIVE-RELEASE.md`, levererad separat 2026-10-25):
1. En faktisk fil-för-fil-diff mellan LIVE:s och STAGING:s klientfiler — kan INTE göras utan LIVE:s faktiska, aktuella filer.
2. **BLOCKER-1 (obehörig läsåtkomst till tidposter/löneuppgifter)**: kräver en GENUINT NY mekanism (per-nyckel RLS SELECT-policy ELLER en separat, filtrerad server-side läsväg) — finns INTE i något befintligt paket. Kräver ett beslut av Lucas om behörighetsregeln INNAN implementation. Om detta inte hinns med/beslutas före LIVE-release: ska redovisas explicit som en KVARSTÅENDE, KÄND, ACCEPTERAD RISK — INTE som löst och inte dolt i gränssnittet, enligt uttrycklig instruktion.
3. En separat RPC-ägarrollskontroll körd mot LIVE (samma fråga som redan användes för STAGING, punkt 14 — inget antagande att LIVE:s roll är samma).

Installationsordning, backup och rollback för LIVE är framtagna men SKILJER SIG från STAGING:s (LIVE behöver även basen, Oct18-migrationerna, som en NY installation snarare än en idempotent omkörning; en LIVE-rollback har ingen symmetrisk "ursprunglig signatur" att återgå till). Se `PLAN-LIVE-RELEASE.md` för fullständig detalj.

### Punkt 16 — Rättelse: LIVE/STAGING-filjämförelse redan genomförd + BLOCKER-1-komponenter redan byggda (2026-10-25)

**Rättelse av punkt 9/15 ovan**: en oberoende, extern filjämförelse (LIVE-backup `CRM Backup 261025.zip` mot STAGING+R9B) var redan genomförd INNAN denna session bad om den på nytt. Resultat: LIVE 116 filer, STAGING 98, 94 gemensamma (36 olika), 22 endast-LIVE (branding/ikoner/diagnostik/`*Page2.js`-varianter), 4 endast-STAGING (`AOTimeSyncService.js`, `RonderingSyncService.js`, `TimeEntriesReadService.js`, `staging-banner.js`). Denna diff görs INTE om.

**Rättelse av punkt 15 (BLOCKER-1)**: tidigare rapporterat som "kräver en genuint ny mekanism, finns inte i något befintligt paket" — FELAKTIGT. En redan färdigbyggd, dokumenterad lösning HITTADES och VERIFIERADES (kod faktiskt läst, inte bara antagen) i detta arbetsområde (`r6-verified-base/`, motsvarar `VIFT-CRM-P0-FINAL-INTEGRATION-PACKAGE-R6.zip`):
- `supabase/migrations_phase2_rls/20261021000003_timeentries_payroll_read_lockdown.sql` — RESTRICTIVE SELECT-policy, blockerar direkt läsning av `vift_timeEntries` för `authenticated`.
- `supabase/functions/time-entries-list/index.ts` — server-filtrering, bekräftad regel: `payroll_view`/`all` ser alla poster, övriga ser endast egna (verifierat i `_shared/vift-auth.ts`s `hasPerm()`).
- `src/services/TimeEntriesReadService.js` + additiv integration i `state.js` (`initState()`/`DataSync._poll()`).

**Fortsatt INTE installerat eller verifierat i STAGING** — endast filerna existerar. Konkret, begränsat förslag att slutföra detta i STAGING (fem tester: egen-läsning, payroll_view-läsning, direkt REST blockerad, oskyddad nyckel opåverkad, TimePage oförändrad) + en sammanslagen LIVE-releaseplan (inkl. AO-/tid-/rondering-beroenden, bevarande av LIVE-specifika filer, skrivstopp FÖRE första inkompatibla migration till EFTER godkända tester): se `BLOCKER1-OCH-LIVE-RELEASE-SLUTGILTIG.md` (levererad separat 2026-10-25). **`PLAN-LIVE-STAGING-UPPGRADERING.md` och `PLAN-LIVE-RELEASE.md` (punkt 9/15 ovan) är därmed ERSATTA av detta nyare, mer kompletta dokument** — inte bortslängda (de innehåller fortfarande giltig bakgrund), men det ERSÄTTANDE dokumentet är det som ska följas.

**Viktigt avgränsning, explicit**: den hittade lösningen är EN fil ur en tidigare paketerad batch kallad `migrations_phase2_rls/` — en benämning som sammanfaller med den "RLS Fas 2" som genomgående varit förbjuden i detta uppdrag. Tolkningen är att ni nu gett ett RIKTAT, medvetet undantag för just denna fil (löneläckan) — INTE en generell aktivering av hela den batchen (som även omfattar AO-, rondering-, offert- och fakturalåsningar). De övriga fyra filerna i den batchen rörs INTE utan ett lika explicit, separat beslut.

### Punkt 17 — BLOCKER-1, ytterligare verifierad kvarstående läcka: lokal cache efter utloggning (2026-10-26)

**Nytt, bekräftat fynd** (verklig skärmbild från STAGING, efter installation av RLS-policyn i punkt 16): `localStorage['vift_timeEntries']` låg KVAR efter utloggning och omladdning. Grundorsak, verifierad genom kodläsning: `AuthService._clearSession()` rensade endast JWT-sessionen (`vift_auth_v2`), aldrig `vift_timeEntries`; `TimeEntriesReadService.fetchAndApply()` skriver den nyckeln vid varje lyckad hämtning utan koppling till inloggningsstatus.

**Minimal korrigering levererad** (`BLOCKER1-LOKAL-CACHE-RATTELSE.md`, separat fil): två ändrade filer.
- `TimeEntriesReadService.js`: ny `_accountEpoch`-räknare (separat från det befintliga `_seq`/`_appliedSeq`-skyddet mot omkastad svarsordning) + `resetForAccountChange()`; `fetchAndApply()` kasserar tyst ett svar vars epok redan hunnit ändras (utloggning/kontobyte MEDAN anropet var i flykt).
- `AuthService.js`: `_clearSession()`, `login()` och `init()` anropar nu `resetForAccountChange()` — täcker utloggning, kontobyte utan föregående explicit logout, och app-start utan giltig session.

**17 nya tester, samtliga gröna**, mot en riktig minnesbaserad `localStorage`-mock (som kastar fel om `.clear()` skulle anropas — garanterar kravet att aldrig använda den): rensning vid logout, vid login utan föregående logout, vid app-start utan session; INGEN rensning vid en fortsatt giltig sessions omladdning (regression); ett i-flykt-anrop som korsar en utloggning skriver ingenting; `vift_outbox`/`vift_settleIntents` (AOTimeSyncService:s outbox för osynkroniserade AO-/tidposter) helt OFÖRÄNDRADE; det befintliga sekvensskyddet oförändrat.

**Kvarstående, OADRESSERAD, redovisad exponering** (medvetet INTE löst här — skulle vara en bred ombyggnad): samma "ingen rensning vid utloggning"-mönster gäller även `vift_invoices`, `vift_activityLog`, `vift_ronderingspass` och stämpelstatusnycklarna, via den generiska per-nyckel-cachningen i `state.js`. Lägre allvarlighetsgrad än tidposter/löneuppgifter (redan synliga i UI:t för de flesta roller), men en kvarstående risk vid delade enheter. Föreslagen som en egen, framtida, avgränsad post — inte löst i denna rättelse.

**BLOCKER-1 kan nu, efter detta tillägg installerat och testat i STAGING, räknas som FAKTISKT stängt** (server-läsvägen redan blockerad sedan punkt 16 + nu även den lokala cache-läckan efter utloggning).

### Punkt 18 — Rättelse av tre fel i punkt 17:s cache-fix, oberoende granskning (2026-10-26)

**Fel 1 (allvarligast)**: punkt 17:s `AuthService.js` byggde av misstag på en ÄLDRE kopia från ett annat arbetsområde — INTE den faktiska, verifierade STAGING-filen. Den saknade därmed Round 8-korrigeringen (`_ENV_REDIRECT_BY_PROJECT_REF`/`_resolveEnvRedirect()`, miljöberoende lösenordsåterställning). **Rättat**: byggd om från er angivna, verifierade fil (SHA-256 `d41cf4784e6dd75f25d5d6a30620010a404b3adb05c5408cb71390024933c872`, bekräftat identisk innan ändring). Round 8-korrigeringen nu bevarad, bekräftad med test.

**Fel 2**: `_accountEpoch` (punkt 17) fanns bara i varje flikens eget minne — en läcka mellan öppna flikar REPRODUCERADES (flik B:s pågående anrop skrev tillbaka data efter att flik A loggat ut). **Rättat**: `TimeEntriesReadService.js` lyssnar nu på webbläsarens `storage`-event för `vift_auth_v2` (avfyras av webbläsaren i ANDRA flikar vid utloggning ELLER en ersatt session/inloggning) och nollställer sin egen epok + cache. Verifierat: läckan reproducerad UTAN lyssnaren, stängd MED den, i båda riktningarna (logout och inloggning som annan användare i en annan flik).

**Fel 3**: `Auth.init()`s `catch`-gren (korrupt/oläsbar sparad session) rensade inte `vift_timeEntries` — REPRODUCERAT. **Rättat**: samma rensning tillagd i `catch`-grenen.

**Verifiering**: samtliga 17 tidigare tester + 11 nya (reproduktion-sedan-fix för alla tre fel) — 28 totalt, 0 failed. Fullständig rättelse, minimal diff, SHA-256-manifest och WinSCP-installationsinstruktion: `BLOCKER1-RATTELSE-RONDA2.md` (levererad separat 2026-10-26). **Ersätter `BLOCKER1-LOKAL-CACHE-RATTELSE.md` (punkt 17) som den fil som faktiskt ska installeras** — punkt 17:s dokument innehöll fel bas och ska INTE användas för installation.

**Cacheversioner**: `index.html` bekräftat laddar `AuthService.js?v=17`/`TimeEntriesReadService.js?v=2` i STAGING → höjs till `?v=18`/`?v=3`. Service Worker (`service-worker.js`, cache-first för versionssatta filer, hela URL:en inkl. `?v=` är cache-nyckeln) behöver INTE versionshöjas — en höjd `?v=` är redan en ny cache-nyckel.

### Punkt 19 — Rättelse av den sista verifierade tvåfliksbristen i punkt 18:s cross-tab-skydd (2026-10-26)

**Nytt, bekräftat fynd (reproducerat av oberoende granskning)**: punkt 18:s cross-tab-lyssnare rensade cachen/epoken i andra flikar, men rörde ALDRIG den flikens `Auth._session` — fliken "trodde" sig fortfarande inloggad. Ett HELT NYTT `fetchAndApply()`-anrop (inte bara ett redan i-flykt) startat EFTER en utloggning ELLER ett kontobyte i en annan flik kunde då fortfarande lyckas och återskapa känslig data.

**Rättat**: cross-tab-lyssnaren flyttad från `TimeEntriesReadService.js` till `AuthService.js` (som redan äger sessionslivscykeln). Jämför `user_email` i gammalt/nytt sessionsvärde — SAMMA användare (en normal bakgrunds-token-refresh) ger INGEN invalidering (explicit krav: skilj refresh från verklig utloggning/kontobyte); annan e-post eller `null` nollställer DENNA flikens `Auth._session` OCH visar inloggningsskärmen, UTAN att själv skriva till `localStorage` (skulle annars kunna logga ut den ANDRA fliken som precis loggat in). Ett andra, oberoende lager tillagt i `TimeEntriesReadService.fetchAndApply()`: kontrollerar sessionsidentiteten BÅDE före anropet (vägrar starta utan session) och efter svaret (kasserar om identiteten ändrats).

**Verifiering**: 20 nya tester (reproduktion-sedan-fix för BÅDA scenarierna: utloggning i annan flik, kontobyte i annan flik; plus ett explicit test att en ren token-refresh INTE triggar onödig utloggning) + de tidigare 17 — **37 totalt, 0 failed**. Punkt 18:s `blocker1_round2_tests.js`-tester (FEL 2/2b) är PENSIONERADE (byggde på en arkitektur som inte längre finns) — FEL 1/FEL 3-täckningen återskapad, oförändrad, i de nya testerna; ingen täckning förlorad. Fullständig rättelse: `BLOCKER1-RATTELSE-RONDA3.md` (levererad separat 2026-10-26) — **ersätter `BLOCKER1-RATTELSE-RONDA2.md` (punkt 18) som den version som faktiskt ska installeras.**

Ingen installation eller kodändring sker förrän detta är bekräftat.

---

### Punkt 20 — Rättelse av tre ytterligare fel i punkt 19:s cross-tab-skydd, oberoende granskning (2026-10-26)

**Tre nya, bekräftade fynd** (reproducerade mot punkt 19:s faktiska filer):

1. **Token-refresh-race**: en samma-användare-refresh i en flik ignorerades helt av den andra flikens lyssnare — den andra flikens `Auth._session` behöll då sin GAMLA, redan roterade `refresh_token`. Dennas egna, senare misslyckade förnyelse (401) kunde då radera den FÖRSTA flikens redan NYARE, giltiga session ur den delade `localStorage` — en flik med en fullt giltig session loggades därmed ut i onödan.
2. **`state.currentUser` rensades aldrig** i den mottagande fliken vid en riktig utloggning/kontobyte — bara `Auth._session`.
3. **Asynkront `storage`-event**: identitetskontrollen i `TimeEntriesReadService.fetchAndApply()` byggde på `Auth._session`, som bara uppdateras EFTER att det asynkrona `storage`-eventet körts. Ett försenat API-svar kunde därför tillämpas FÖRE eventet hunnit nollställa sessionen, trots att utloggningen/kontobytet redan var ett FAKTUM i den delade `localStorage`.

**Rättat**:
1. Cross-tab-lyssnaren (`AuthService.js`) ANTAR nu (kopierar in) den nya sessionen vid en samma-användare-händelse, istället för att bara ignorera den. Jämförelsen görs mot DENNA flikens egen `self._session`-e-post (inte mot händelsens `oldValue`) — en uppföljningsfix, verkligt reproducerad under egen testning: annars kunde en flik som ALDRIG loggat in än felaktigt visa inloggningsskärmen i onödan när en ANNAN flik loggade in för första gången.
2. Samma lyssnares utloggnings-/kontobytesgren nollställer nu även `state.currentUser`.
3. `TimeEntriesReadService._currentIdentity()` läser nu den delade `localStorage['vift_auth_v2']` direkt (synkron sanning) — men kräver DESSUTOM att den överensstämmer med `Auth._session`s e-post. Ren `localStorage`-läsning visade sig (verkligt reproducerad under egen testning) INTE räcka ensam: den säger bara att NÅGON flik är inloggad som X, inte att DENNA flik är det — utan det andra villkoret kunde en flik vars egen session redan nollställts likväl hämta/tillämpa en ANNAN fliks helt nya konto.

**Verifiering**: 16 nya tester (reproduktion-sedan-fix för alla tre scenarier, plus ett explicit krav-test att en ren samma-användare-refresh inte triggar onödig utloggning) + de tidigare 37 (punkt 19:s 20 + punkt 18:s 17) — **53 totalt, 0 failed**. Två historiska reproduktionsblock i `blocker1_round3_tests.js` fick en liten, kommenterad isolering (en tillfällig lokal override av `_currentIdentity()` till den äldre, otillräckliga varianten) eftersom det nu levererade, starkare oberoende skyddslagret i `TimeEntriesReadService.js` ensamt redan stänger just den specifika historiska bristen — ingen försvagning, bara ett konstaterande att skyddet nu är mer flerlagrat än testets ursprungliga scenario förutsatte. Round 8-korrigeringen, R9B:s beroenden samt `vift_outbox`/`vift_settleIntents` bekräftat oförändrade.

**Disclosure**: det av granskaren nämnda bifogade testskriptet ("VIFT_BLOCKER1_RONDA3_REVIEW_REGRESSIONS.js") togs INTE emot i det mottagna meddelandet — egna, motsvarande tester byggda direkt från den skriftliga beskrivningen av de tre scenarierna.

Fullständig rättelse: `BLOCKER1-RATTELSE-RONDA4.md` (levererad separat 2026-10-26). Ingen installation eller kodändring sker förrän detta är bekräftat.

---

## Kritiska produktionsblockerare

### BLOCKER-1: timeEntries läcker lönedata

`state.timeEntries` laddas av DataSync för alla inloggade användare. RLS på `store`-tabellen kontrollerar inte på nyckelkolumnen — alla inloggade kan läsa alla nyckelns data inklusive tidstämplar och löneunderlag för all personal.

**Påverkan**: Alla inloggade fältarbetare kan potentiellt läsa andras tidsdata.
**Plats**: `src/data/storage.js` + Supabase RLS-policy på `store`.
**Kräver**: Per-nyckel RLS-kontroll eller separata tabeller för känslig data.

### BLOCKER-2: Store-skrivning saknar per-nyckel-kontroll

RLS-policyn på `store` tillåter varje autentiserad användare att skriva valfri nyckel. En inloggad fältarbetare kan i teorin skriva `vift_staff` eller `vift_roles`.

**Påverkan**: Behörigheteseskalering möjlig om en inloggad användare känner till store-nycklarna.
**Plats**: Supabase RLS-policy för UPDATE/INSERT på `store`.
**Kräver**: Rollbaserad write-policy (t.ex. bara `admin`-roll kan skriva `vift_staff`, `vift_roles`).

---

## Säkerhetsarbete genomfört (Commits 17–27, säkerhetssprinten)

Följande genomfördes i säkerhetssprinten (commit-serien i staging-repo / annan workspace-instans):

| Commit | Åtgärd |
|---|---|
| 17 | `passwordHash` borttaget från schema.js + migration 00008 strippar lösenord från store-blob |
| 18 | `SET search_path` pinnat i alla SECURITY DEFINER-funktioner (00006) |
| 19 | REVOKE + RLS på backup-tabeller (00004) |
| 20 | Migration 00003 → no-op; cron-SQL flyttad till `supabase/manual/setup_service_monitor_cron.sql` |
| 21 | `_shared/vift-auth.ts` — gemensam auth-helper `checkViftAuth()` + `hasPerm()`; send-push/offer-attachment-upload/offer-pdf/send-offer-email uppdaterade |
| 22 | HTTP-säkerhetsheaders till offer-token-validate och offer-respond |
| 23 | MASTERPLAN + stagingchecklista uppdaterade (v5) |
| 24 | `offer-attachment-url` fullständigt omskriven — publik token-path + intern JWT-path med full auktorisering |
| 25 | Säkerhetsrapport och produktionsblockerare dokumenterade |
| 26 | `supabase/manual/setup_service_monitor_cron.sql` — Vault-baserad cron-setup |
| 27 | Migration `20260720000000_create_core_tables.sql` — skapar `store` och `push_subscriptions` för tom staging-DB |

**OBS**: Dessa commits är **inte** synliga i git log på branch `claude/vift-system-restructure-8fUme` i detta workspace (senaste commit: `227bc12`). De gjordes i en annan session-instans/workspace. Status ovan baseras på sessionens dokumentation.

---

## Fas 4 — Planerade funktioner (ej påbörjade)

| # | Funktion | Prioritet |
|---|---|---|
| 73 | Generell import/export för fastigheter, objekt, artiklar, personal | Hög |
| 74 | Rondering — PDF-rapport | Hög |
| 75 | Kalender — schemaläggning, dra-och-släpp | Hög |
| 76 | Löneunderlag — export, perioder | Medel |
| 77 | Rapporter — statistik, diagram | Medel |
| 78 | Mina jobb — tilldelade uppdrag per inloggad personal | Hög |
| 79 | Avancerat behörighetssystem (per fastighet, per kundgrupp) | Låg |
| 80 | E-postmallar och automatiska utskick | Medel |
| 81 | Kontrakthantering | Medel |
| 82 | Mobil-optimerad offline-läge (SW fallback) | Låg |
| **83** | **UI/UX — Faktureringsvyn "Att fakturera", förbättrad layout** (registrerad 2026-10-25, se nedan) | **Efter R9B releasekritiska arbete** |

Sidor för kalender (`pg-calendar`) och kontrakt (`pg-contracts`) finns redan i Router och PageShells som tomma stubs. Löneunderlag (`pg-payroll`) och rapporter (`pg-reports`) likaså.

### Punkt 83 — UI/UX, faktureringsvyn "Att fakturera" (registrerad 2026-10-25)

**Konstaterade problem** (från skärmbild):
- Sökfältet är för smalt.
- Kund-, fastighets-, typ- och periodfilter staplas vertikalt och tar onödigt mycket plats.
- Sökfält och filter är dåligt balanserade.
- Stora tomma ytor försämrar överblicken.
- Layouten behöver förbättras för både desktop och mobil.

**Mål**: en kompakt, professionell och lättöverskådlig faktureringsvy med tydliga filter, sökning och grupperade fakturaunderlag.

**Krav vid genomförande**: befintlig faktureringslogik, belopp, urval och funktionalitet ska bevaras oförändrade — detta är en ren layout-/UI-förbättring, ingen ändring av beräkningar, filtrering eller datamodell.

**Status 2026-10-25**: Registrerad i backlog. **Ingen UI-ändring genomförd.** Prioritet: efter R9B:s releasekritiska arbete (se den prioriterade ordningen för R9B-slutförande ovan).

---

## Kända begränsningar (per MASTERPLAN.md)

### AO-snapshot-fält (punkt 12)
Wizard sparar `propertyName` och `objectName` men saknar: `customerName`, `objectNumber`, `contactId`, `contactName`, `accessInformation`. AO-sökning inkluderar inte heller dessa fält.

### Objektskortet historik (punkt 62–64)
PropertyObjectPage visar arbetsordrar och utrustning men saknar sektioner för serviceintervall, avvikelser, bilder och dokument.

### Prefill från objekt vid AO-skapande (punkt 67)
`openCreateAO()` skickar `objectId`/`objectName` men inte adress, kontaktperson, telefon, e-post eller accessInformation från objektet.

### Kontakter/hyresgäster (punkt 71)
`contacts[]`-arrayen finns i schema, kan sparas via `PropertyObjectService.update()`, men saknar CRUD-UI direkt i objektskortet.

### Rollbaserat döljande av portkod (punkt 72)
`doorCode` och `keyInformation` visas för alla inloggade. Kräver rollkontroll (`Auth.can('objects_sensitive')`) innan det är säkert för mobila fältarbetare.

### Importdiff-vy (punkt 50)
Konfliktlösning har tre val (hoppa/uppdatera/skapa ny) per rad men saknar sida-vid-sida diff-vy.

### Kundexport — markerade kunder (punkt 51)
Export stöder "alla" och "filtrerade" men inte manuellt checkade rader.

### Generell import för övriga register (punkt 73)
`ImportExportService.js` är byggd som återanvändbar motor men ImportWizard stöder bara `entityType='customer'` idag.

---

## Användare i produktion (per brief)

| ID | Namn | Roll |
|---|---|---|
| ST-001 | Lucas Samuelsson | Admin (superadmin) |
| ST-008 | Christoffer | Chef |

---

## Hemligheter i Supabase Vault (prod + staging)

*(Inga värden dokumenteras här — enbart nyckelnamn)*

- `VAPID_PRIVATE_KEY` — Web Push
- `RESEND_API_KEY` — e-postutskick
- `SERVICE_MONITOR_SECRET` — cron-autentisering (Model B)
- `MAPBOX_TOKEN` — karta (publikt värde finns även i config.js)

`PUBLIC_BASE_URL` = `https://crm.viftfast.se`
`FROM_EMAIL` = `info@viftfast.se`
