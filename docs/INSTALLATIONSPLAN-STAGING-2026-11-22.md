# VIFT CRM — Samordnad installationsplan för STAGING

Senast uppdaterad 2026-11-23 (ersätter versionen från 2026-11-22; historik i git). En enda plan — ingen annan installationsplan gäller.

**Status:** underlag för beslut. Ingenting i denna plan är utfört i STAGING eller LIVE. Varje rad i §6 kräver separat GO från Lucas Samuelsson.

---

## Oberoende kontroll 2026-11-23 – korrigerar beslutsunderlaget (endast läsning)

Direktkontroll mot Supabase STAGING `yyzljlqyzzcbxmcdbual` efter Claudes slutrapport (inga data eller inställningar ändrade):

- **AKTIVITETSLOGG: den tidigare dubblettuppgiften är INTE aktuell i databasen.** `vift_activityLog` har **150 poster**, **0 grupper med duplicerade `id`**, och det specifika `ACT-1793611007122` förekommer **en gång**. Senaste `timestamp` i registret är `2026-11-17T11:58:49.927Z`. Därmed motsägs påståendet att varje skrivning har blockerats av just detta dubblett-ID sedan 2 november. Det kan fortfarande finnas andra skrivfel – endast ett autentiserat skrivtest kan bekräfta hälsan. **NO-GO för §2c:s föreslagna dedup/städning baserat på den gamla diagnosen.** Kör inte en datamutation innan ny, reproducerad verifiering och separat GO.
- **STAGING backend:** `ao-time-write` v3 och `store-key-write` v3 finns. Deras faktiskt deployade källfiler är direkt tillgängliga via Supabase-projektets Edge Function-hämtning, inklusive `stamp-status.ts`; källmaterial kan därför hämtas och jämföras utan manuellt filutbyte. G4 är ett **repo-fullständighetsgap**, inte brist på åtkomst till de deployade två funktionerna. Pusha inte oavgranskade bundles eller hemligheter; avstäm filvägar/importer och migrationskedjan före källkodsimport.
- **AO-bilder:** `workorder-images`-bucket finns inte ännu. Nya bild-EF:er är inte deployade; §2b kräver fortsatt separat GO.
- **Push-index:** `public.push_subscriptions` har idag bara `push_subscriptions_endpoint_key` och `push_subscriptions_pkey`; ett eventuellt föreslaget extra index är **inte installerat**. Bedöm nytta och migration innan beslut.
- **STAGING skrivskydd:** `stamp_status` finns och `store_ao_time_no_direct_update` finns; detta överensstämmer med klientens avsedda serverbaserade AO/tid-väg.

**Ingen av dessa läskontroller verifierar Claudes klienttester mot riktiga autentiserade STAGING-anrop.** Rekommendationen är fortsatt separat GO för kontrollerad STAGING-testning, inte LIVE. Övriga textavsnitt nedan återger den ursprungliga planen; eventuella motstridiga formuleringar om aktivitetsloggens dubblett och dess §2c ska läsas som **ersatta av denna kontroll**.

## 0. Vad som har ändrats sedan förra versionen

**2026-11-23 (sen kväll) — rättelse av testverktygen (§4a).** Det tidigare `tests/e2e/staging-authz.js` kallades "ändrar inga data". Det stämde inte:
- En tillåten `writeMerge` uppdaterar `store.updated_at` och `vift_lastChanged`, även utan faktisk post.
- G9-kontrollen gjorde en no-op-`patch_ao` på en befintlig AO, vilket kan uppdatera AO:ns `updatedAt` och synksignaturen.

Detta är verifierat av Lucas/ChatGPT mot de installerade RPC:erna. Verktyget är ersatt av tre nivåer: oinloggad, autentiserad läsning och mutationstest med egna märkta testposter. Det har miljöspärrar, journal, före/efter-verifiering och städning. Installationsordningen och GO/NO-GO (§6) är uppdaterade.

**2026-11-23 (kväll) — releasekandidat (Leverans J).** G5 (klient), G12, G10, G8, döda dialoger, bilagornas metadata, karta, kalender och designstandard är byggda och lokalt testade. §2a har nytt exakt filomfång (45 filer + `index.html` + `public-offer.html`). Nytt: §2e (`offer-attachment-upload` PATCH), §2f (G5-serverförslag, ej installerbart före G4), §4 STAGING-verifiering med `tests/e2e/staging-authz.js` *(ersatt senare samma kväll, se ovan)*. Samlad rapport och GO/NO-GO: `docs/RELEASEKANDIDAT-2026-11-23.md`.

**2026-11-23 (eftermiddag) — fullständigt webbläsartest.** Hela klienten är testad i Chromium mot en simulerad backend (88 tester, alla 32 moduler, 7 kritiska arbetsflöden: 86 godkända, 0 misslyckade, 1 blockerad, 1 känt fel). 20 verifierade fel är rättade i branchen, vart och ett med ett regressionstest som underkänns mot föregående kod. Resultat, kvarstående fel och exakt vad som måste upprepas mot STAGING: `docs/E2E-RAPPORT-2026-11-23.md`. Filomfånget i §2a är uppdaterat utifrån en läsande jämförelse mot den driftsatta STAGING-klienten (`tests/e2e/staging-readonly.js`, inga ändringar i STAGING).

**Rättelse — aktivitetsloggen (§2c):** min tidigare uppgift att `vift_activityLog` i STAGING innehöll ett dubblett-id som blockerade varje skrivning byggde på en kommentar i koden, inte på verifierad data. Lucas läsande kontroll (ovan) visar 0 dubbletter. Uppgiften var fel; §2c utgår.

`docs/STAGING-AO-TID-SKRIVVAG-BLOCKERARE-2026-11-22.md` gav NO-GO för en filsynk från denna branch. Orsaken visade sig vara att branchen var en **äldre kodlinje** än den deployade STAGING-klienten (se `docs/KODBAS-STAGING-BASLINJE-2026-11-23.md`). Åtgärd i branchen (commit `56a943d`): STAGING-klienten är nu baslinje, med LIVE-miljööverlägg, och branchens egna förbättringar är portade ovanpå i separata commits. Blockeraren är därmed löst i kod: alla AO-/tidskrivningar går via redan installerad `ao-time-write` v3; `workOrders`/`timeEntries` skrivs aldrig via generisk `persist()`.

Den gamla §2a ("synka klientfiler från branchen") gäller inte längre i sin gamla form — se §2.

---

## 1. Redan i STAGING — rör inte

Direktverifierat (läsande) i `docs/STAGING-FAKTISK-KOD-DIFF-2026-11-22.md` och `docs/STAGING-AO-TID-SKRIVVAG-BLOCKERARE-2026-11-22.md`, samt genom läsning av den publika STAGING-deployen 2026-11-23:

| Objekt | Läge |
|---|---|
| `ao-time-write` v3 + RPC:erna `work_order_create/patch`, `time_entry_create/patch` m.fl. | Installerade. Klienten i branchen använder dem (oförändrat kontrakt). |
| RESTRICTIVE `store_ao_time_no_direct_{insert,update,delete}`, `store_timeentries_no_direct_select`, `store_workorders_no_direct_select`, `staging_generic_keys_no_direct_*` | Installerade. Ingen ny RLS behövs. `20261120000002_PROPOSAL_…` är markerad överspelad — installera inte. |
| `time-entries-list` v3 (GET+POST), `work-orders-list`, `store-key-write`, `invoice-write`, `rondering-pass-write` | Installerade. Källkod för `ao-time-write`, `store-key-write`, `work-orders-list`, `invoice-write`, `rondering-pass-write` finns **inte** i detta repo (se §5, G4). |
| `service-monitor` v15 (atomisk AO via `work_order_create`) | Installerad; repots källa matchar. |
| pg_cron `vift-service-monitor-daily` (06:00 UTC) | Finns, `active=false`. Rör inte utan separat GO (§3). |
| `stamp_status`-tabellen + `getStampStatus`/`setStampStatus` i `store-key-write` | Installerade. Klientens molnstämpling bygger på dessa — ingen ny tabell. |
| Bucket `offer-attachments` | Orörd. |

---

## 2. Vad som ska installeras i STAGING

### 2a. Klientfiler (kodsynk till staging-repot, inga Supabase-ändringar)

**Exakt omfång (läsande jämförelse mot driftsatt STAGING, körd igen 2026-11-23 kväll: 77 versionsatta filer driftsatta, 40 nyare i repot, 0 äldre, 5 bara i repot):**

*Nyare i repot (STAGING-version → repo-version):*
- Stilar: `src/styles/components.css` 103→107, `forms.css` 13→14, `dashboard.css` 30→31
- Data: `src/data/storage.js` 20→22, `state.js` 63→72, `DashboardConfig.js` 11→12
- Delat: `src/shared/OfferCalc.js` 1→2
- Tjänster: `AuthService.js` 22→23, `WorkOrderService.js` 24→29, `TimeService.js` 20→22, `AOTimeSyncService.js` 3→9, `InvoiceService.js` 17→18, `BillingQueueService.js` 9→10, `RecurringOrderService.js` 6→7, `ServiceIntervalService.js` 3→5, `ImportExportConfigs.js` 11→12
- Komponenter: `Modal.js` 8→11, `Sidebar.js` 31→32, `MobileShell.js` 6→7
- Sidor: `ImportWizardPage.js` 10→11, `ExportCenterPage.js` 5→6, `Router.js` 30→31, `Dashboard.js` 54→55, `CustomersPage.js` 36→39, `WorkOrdersPage.js` 66→69, `WorkOrderDetailPage.js` 81→88, `TimePage.js` 13→15, `ContractsPage.js` 2→3, `ProjectsPage.js` 4→6, `InvoicesPage.js` 34→37, `RecurringPage.js` 15→17, `SalesPage.js` 8→10, `PropertyDetailPage.js` 30→35, `PageShells.js` 173→182, `RonderingPage.js` 10→11, `ReportsPage.js` 9→10, `CalendarPage.js` 2→3, `MyJobsPage.js` 15→17, `RonderingUtforandePage.js` 12→13, `RonderingWizardPage.js` 9→11

*Bara i repot (nya filer):* `src/styles/tokens.css`, `src/styles/reset.css` (fick `?v=1`), `src/services/WorkOrderImageService.js`, `src/services/MapGrouping.js`, `src/pages/ServiceIntervalsPage.js`

*Ej versionsatta:* `index.html` (versionsnummer, nya script-taggar) och `public-offer.html` (OfferCalc v2 med G8-validering).

Webbläsartestets rättningar listas i `docs/E2E-RAPPORT-2026-11-23.md` §3; Leverans J:s rättningar i `docs/RELEASEKANDIDAT-2026-11-23.md` §A. Kopiera **hela** listan i ett steg — filerna beror på varandra (t.ex. `confirmPersist` i `state.js` används av nästan alla sidor; `OfferCalc.validate` av `PageShells.js` och `public-offer.html`).

Jämfört med den deployade STAGING-klienten skiljer sig följande filer. Vid synk till staging-repot ska **STAGING-överlägget** läggas tillbaka i fyra punkter: `config.js` (STAGING-VAPID-nyckel), `src/data/storage.js` (STAGING `SUPABASE_URL`/anon-nyckel), `src/services/AuthService.js` (STAGING-posten i `_ENV_REDIRECT_BY_PROJECT_REF`), `index.html` (STAGING-miljöindikatorn).

| Fil | Innehåll | Beror på |
|---|---|---|
| `src/data/storage.js` | skrivtimeout (20 s) på alla skrivvägar | — |
| `src/services/AOTimeSyncService.js` | timeout; centralt besked + omläsning vid avslag; `createTime` med egen idempotensnyckel; `findPendingIntent` | `ao-time-write` (finns) |
| `src/services/TimeService.js` | manuell tid/radering med ACK + återställning; molnstämpling (uppdatering mellan enheter, en tidpost per pass, omladdningssäker utstämpling) | `ao-time-write`, `store-key-write` stamp (finns) |
| `src/services/WorkOrderService.js` | arkiv/papperskorg/permanent radering med ACK + återställning; centralt avslagsbesked | `ao-time-write` (finns) |
| `src/services/BillingQueueService.js` | köns belopp = fakturerat belopp | — |
| `src/services/ServiceIntervalService.js` | separata idempotensnycklar klient/server; `getAllAcrossProperties` | — |
| `src/data/state.js` | `isSafeImageDataUrl`; molnstämpling vid start | — |
| `src/pages/WorkOrderDetailPage.js` | loggbilder via Storage; ACK-styrda besked; säkra bilder; komprimerade avvikelsebilder | §2b för bilddelen |
| `src/pages/TimePage.js`, `src/pages/WorkOrdersPage.js` | ACK-styrda besked / avslagsrapport vid massändring | — |
| `src/pages/PropertyDetailPage.js` | döda modalknappar lagade; uppdatering av översikten | — |
| `src/pages/ServiceIntervalsPage.js` (ny), `Router.js`, `Sidebar.js`, `AuthService.js` | serviceintervallöversikt `#/serviceintervall` (`customer_manage`) | — |
| `src/services/WorkOrderImageService.js` (ny) | EF-klient för bilder | §2b |
| `src/pages/RonderingUtforandePage.js` | säker bildrendering | — |
| `public-offer.html` | kundsidan räknar med samma `OfferCalc` som CRM:et; CSP `script-src 'self' 'unsafe-inline'` | `src/shared/OfferCalc.js` (finns i STAGING) |
| `index.html` | versionsnummer + nya script-taggar + sidcontainer | — |

**Kan installeras oberoende av §2b.** Utan §2b fungerar allt utom nya bilduppladdningar i AO-loggen (uppladdningen misslyckas med ett tydligt felmeddelande och loggposten sparas inte — ingen tyst dataförlust). Äldre inbäddade bilder visas som förut.

**`public-offer.html` — observera:** branchens version (PDF-nedladdning, sektionsordning, RUT-/faktureringsdetaljer) och STAGING:s version (OfferCalc) hade divergerat. Repot har nu branchens funktioner + OfferCalc. Verifiera i STAGING enligt testfall O1–O3 nedan innan den ersätter STAGING:s fil.

### 2b. Nya Supabase-objekt för AO-loggbilder (separat GO, i denna ordning)

1. Bucket `workorder-images` (privat, 10 MB, `image/jpeg|jpg|png|webp`) — SQL i `src/services/WorkOrderImageService.js` filhuvud.
2. Storage-policies SELECT/INSERT/DELETE — alla `service_role`-only (samma filhuvud).
3. `supabase functions deploy work-order-image-url`
4. `supabase functions deploy work-order-image-upload`
5. `supabase functions deploy work-order-image-delete`
6. Därefter (eller samtidigt med) §2a.

### 2c. ~~Databasstädning `vift_activityLog`~~ — UTGÅR

~~`vift_activityLog` i STAGING innehåller ett dubblett-id …~~ Felaktig uppgift (byggde på en kodkommentar, inte på data). Verifierat 2026-11-23: 150 poster, 0 dubbletter. Ingen datafix ska göras. Om aktivitetsloggen inte sparas i STAGING ska det först reproduceras med ett autentiserat skrivtest (E2E-rapporten §6, punkt S-AKT).

### 2d. Migrationer

Ingen ny migration behövs för §2a–2b eller §2e. §2g har en egen migration (`20261123000002_work_order_checklist_progress.sql`). `20261120000001_PROPOSAL_push_subscriptions_index.sql` är fortfarande overifierat mot STAGING:s indexlista — kontrollera `pg_indexes` först. `20261123000001_PROPOSAL_work_order_log_ops.sql` hör till §2f och ska **inte** köras nu.

### 2e. `offer-attachment-upload` — PATCH för bilagornas metadata (separat GO)

Källan i repot (`supabase/functions/offer-attachment-upload/index.ts`) har en ny PATCH-hanterare (fälten `displayName`, `description`, `includeInPublicView`, `includeInCombinedPdf`; samma `checkViftAuth` + `offer_manage` som uppladdningen) och CORS som tillåter PATCH. Utan deploy fungerar allt som förut, men att ändra en bilagas metadata ger ett tydligt felbesked ("sparades inte") och dialogen stängs inte — ingen tyst förlust. Innan deploy: jämför repots källa med den deployade STAGING-versionen (den kan skilja sig, G4).

1. Läs deployad källa för `offer-attachment-upload` i STAGING och jämför. Avvikelse utöver PATCH-blocket → stoppa och stäm av.
2. `supabase functions deploy offer-attachment-upload --project-ref <STAGING>` (verify_jwt = true).
3. Test: ändra namn och synlighet på en bilaga → "Sparat" först efter svar; omladdning visar ändringen; som roll utan `offer_manage` → 403.

Rollback: deploya föregående version.

### 2g. Checklista med tre statuslägen (separat GO, i denna ordning)

Beslut Lucas 2026-11-23: ingen autostart av AO från checklistan; egen åtgärd återställs med ao_checklist, annans/äldre punkt kräver ao_edit (kontroll i RPC:n). Detaljer: masterplan punkt 186.

1. Backup: `select value from store where key='vift_workOrders'` (spara utanför databasen) och notera `pg_get_functiondef('public.work_order_checklist_resolve'::regproc)`.
2. Kontrollera att deployad `work-order-checklist-resolve` i STAGING motsvarar repots äldre version (före denna ändring). Avvikelse → stoppa och stäm av.
3. Migration `supabase/migrations/20261123000002_work_order_checklist_progress.sql` (skapar `work_order_checklist_set_state`, ersätter `work_order_checklist_resolve` med en delegerande version utan autostart). Ändrar **inga** befintliga data eller AO-statusar.
4. Direkt därefter: `supabase functions deploy work-order-checklist-resolve` (verify_jwt som idag). Mellan steg 3 och 4 nekas återställning av annans åtgärd (fail-closed) — håll fönstret kort.
5. §2a-klienten (WorkOrderService/WorkOrderDetailPage m.fl.) sonderar själv stödet; före steg 3–4 visas checklistan som förut utan "Påbörja".

**Äldre klienter:** en webbläsare som fortfarande kör den gamla klienten visar pågående punkter som ej påbörjade (de nya fälten ignoreras, inget skrivs över — den gamla klienten skickar bara OK/avvikelse/återställ via samma RPC). Hårdladdning efter §2a löser det.

**Test (J9–J12 i §4).** **Rollback:** kör om `20260917000001_work_order_checklist_atomic_rpc.sql` (återställer den äldre RPC:n med autostart), `drop function public.work_order_checklist_set_state(text,text,text,text,text,text,text,text,text,boolean,boolean);` och deploya föregående EF-version. De nya fälten i punkterna kan ligga kvar (ignoreras); ingen datafix.

### 2f. G5 serverdel — append_log/remove_log (FÖRSLAG, ej installerbart nu)

Klienten (§2a) sonderar själv om `ao-time-write` stöder `append_log`; svarar servern `400 unknown_action` (som i STAGING idag) används den gamla vägen med hela loggen — oförändrat beteende. Serverdelen (RPC-förslag i `supabase/migrations/20261123000001_PROPOSAL_work_order_log_ops.sql`, ändring i `ao-time-write` beskriven i `docs/G5-APPEND-LOG.md`) kan inte färdigställas förrän `ao-time-write`:s källa finns i repot (G4).

---

## 3. service-monitor — endast aktiveringsbeslut

EF:en (v15) och cron-jobbet finns. Testa manuellt (anrop med `X-Monitor-Secret` ur Vault — aldrig i klartext) innan `SELECT cron.alter_job(<jobid>, active := true);`:

- [ ] Inget förfallet intervall → `notified: 0`, `aoCreated: 0`.
- [ ] Intervall inom `reminderDays` → push till ansvarig. Samma anrop igen → ingen dubbelpush.
- [ ] `autoCreateAO` vid tröskel → en AO via `work_order_create`; omkörning → ingen andra AO.
- [ ] Inloggning efter körning → klientens Att göra-post OCH serverns push båda kvar (separata nycklar, §2a).
- [ ] Ansvarig utan konto → broadcast — bekräfta att det är avsett.

Känd begränsning: `vift_properties` skrivs fortfarande som hel rad av service-monitor (läs-ändra-skriv). Låg risk (en körning/dag).

---

## 4. Testfall i STAGING (efter §2a; bilddelen efter §2b)

Automatiska lokala tester (`bash tests/run-all.sh`: 7 filer med 172 kontroller + 120 offertjämförelser i riktig webbläsare) täcker klientlogiken mot simulerade servrar. De ersätter inte detta.

**AO/tid (blockerarens obligatoriska tester)**
- [ ] A1 Skapa AO → syns på annan enhet efter omladdning; upprepat anrop ger ingen dubblett.
- [ ] A2 Ändra AO inkl. loggpost → serverbekräftat; ingen annan användares ändring bortskriven (se G5).
- [ ] A3 Nekad ändring (t.ex. användare utan `ao_edit` via direktanrop/rollbyte) → besked "sparades inte", värdet återgår.
- [ ] A4 Arkivera/papperskorg/permanent radering → "…" sedan bekräftelse; nekad → AO:n återställs.
- [ ] T1 Manuell tid → "Sparar tiden…" → "Tid sparad"; syns för behörig på annan enhet.
- [ ] T2 Radera attesterad tid (som payroll_manage via direktanrop) → nekas, posten finns kvar.
- [ ] T3 Nätverk av mitt i en sparning (devtools offline) → aldrig "sparad"; efter återanslutning skickas den en gång.
- [ ] T4 Avstannad anslutning (throttling) → felbesked inom ~20 s, ingen evig väntan.

**Molnstämpling**
- [ ] S1 Stämpla in på mobil → datorn visar instämplad efter flikbyte (eller inom 90 s).
- [ ] S2 Stämpla ut på datorn → en tidpost; mobilen visar utstämplad.
- [ ] S3 Stämpla ut samtidigt på två enheter → **exakt en** tidpost. Kräver att `ao-time-write` deduplicerar `create_time` på idempotensnyckel över enheter (eller ger `id_collision`) — se G6.
- [ ] S4 Stäng fliken direkt efter utstämpling (innan svar) → vid nästa inloggning: utstämplad, en tidpost, serverns stämpling rensad.
- [ ] S5 Byt användare på samma enhet → ingen stämpling följer med.

**Bilder (efter §2b)**
- [ ] B1 Ladda upp bild i AO-logg → visas; ingen base64 i `vift_workOrders`.
- [ ] B2 Direktanrop till `work-order-image-upload/-url/-delete` för AO utan behörighet → 403.
- [ ] B3 Fil med förfalskad `Content-Type: image/jpeg` → 400.
- [ ] B4 Radera loggpost med bild → bildfilen tas bort först efter bekräftad radering; vid nekad radering finns bild och post kvar.
- [ ] B5 Äldre inbäddade bilder visas som förut.

**Offert och fakturering**
- [ ] O1 Samma offert: totalsumma i CRM = kundsidan = PDF.
- [ ] O2 Offert med äldre rader (`price` utan `unitPrice`) → samma summa på kundsidan som i CRM.
- [ ] O3 Godkänn/neka/begär ändring på kundsidan fungerar som förut; PDF-nedladdning fungerar.
- [ ] F1 Fakturaunderlag för tid (t.ex. 50 min) → köns belopp = fakturautkastets belopp.

**Serviceintervall**
- [ ] I1 `#/serviceintervall` listar intervall från alla fastigheter; filter fungerar; dold för roller utan `customer_manage`.
- [ ] I2 "Markera utförd"/"Redigera"/"Lägg till" sparar (knapparna var tidigare döda) och uppdaterar historik och nästa datum.

**Från webbläsartestet 2026-11-23 (upprepas mot STAGING med testkonton — fullständig lista i `docs/E2E-RAPPORT-2026-11-23.md` §6)**
- [ ] E1 Behörighet vid direktanrop (PERM-01/02): fältarbetare mot annans AO, fakturarad, rolländring, portkod, attestering → 403; arbetsledare får bara egna tidposter.
- [ ] E2 `store-key-write` per nyckel (PERM-03, BLOCKER-2): fältarbetare försöker `writeMerge` på `vift_offers`, `vift_customers`, `vift_activities` → ska nekas.
- [ ] E3 Ekonomirollen skapar fakturautkast → AO blir "fakturerad" (i simuleringen nekades statusändringen; klienten säger det och rullar tillbaka).
- [ ] E4 Serverfel/timeout vid sparning (serviceintervall, offertlänk, roller, rondering, import) → aldrig "sparat"; tydligt fel.
- [ ] E5 ROT/RUT: samma arbete ger samma avdrag i offert och faktura (30 %/50 % av arbetskostnad inkl. moms).
- [ ] E6 Rapporter → "Fakturerat" = summan av utställda fakturor exkl. moms.
- [ ] E7 Exportcentret: register, format, kolumner och Exportera-knapp visas; fastighets-/objektexport utan portkoder.
- [ ] E8 Tappa nätet på mobilen mitt i loggpost → skickas automatiskt när nätet kommer tillbaka.
- [ ] E9 Rondering: guide → tillfälle → utförande på mobil → anmärkning med AO → slutför → server sätter "har_avvikelser" → AO klar → avvikelse åtgärdad.
- [ ] E10 Samtidiga loggposter från två enheter (G5) — förväntas fortfarande tappa en post tills §2f är installerad.

**Regel för alla manuella tester som skriver (J2–J12, A1–A4, T1–T4, S1–S5, B1–B5, O1–O3, F1, I1–I2, E1–E10):** använd testkonton och egna testposter märkta "[E2E-TEST]" (test-AO, testkund, testoffert). Ändra aldrig befintliga poster. Ta bort testposterna efteråt, eller arkivera dem om de inte kan tas bort (t.ex. attesterad tid). Notera vilka som skapats.

**Från Leverans J (releasekandidat)**
- [ ] J1a Nivå 1: `node tests/staging/authz-read.js --jag-har-go --bekrafta-projekt=<ref>`.
  - Kontrollerar att varje roll bara ser det den ska: AO-lista, tidposter, direkt REST-läsning, `readWithHash` på AO. Skickar inga åtgärder som kan mutera, inte heller sådana som normalt nekas. Checklistans sondering görs i nivå 2.
  - Inga affärsdata skrivs. Inloggningen skriver i auth-schemat.
  - Kräver GO + testkonton.
- [ ] J1b Nivå 2: `node tests/staging/authz-mutation.js --jag-har-go --mutationstest --bekrafta-projekt=<ref>`, med `VIFT_MILJO=staging`. Kör först `--torrkorning`.
  - Täcker G13 **delvis** (ny testpost per array-register och roll; se §4a), G9 (ekonomi försöker sätta testkörningens egen AO till "fakturerad"), G6 (dubbel `create_time` på samma test-AO) sondering av checklistans serverstöd och, efter §2g, checklistans ägarkontroll.
  - Skriver bara egna märkta testposter och städar dem. Befintliga poster verifieras oförändrade.
  - Kräver uttryckligt GO för mutationstest.
- [ ] J1c Om J1b slutar med kod 3 eller 5: kör `--stada=<runId>` och bekräfta kod 0 innan något annat görs.
- **Simulerade tester räknas inte som bevis.** Bara J1a och J1b avgör G13, G9 och G6.
- [ ] J2 Sparbesked (G12): ändra kontaktperson, teknisk info, artikel, prisgrupp, säljchans, avtal, projekt och admininställning → "Sparar…" och sedan "Sparat" först efter svar. Med nätet avstängt (devtools) → "sparades inte" och värdet återgår eller hålls som osparad ändring.
- [ ] J3 Avtal och e-postmall går att skapa (dialogknapparna var döda).
- [ ] J4 ROT/RUT (G10): godkänd offert med ROT → fakturautkast visar offertens avdrag; "Skickad" nekas tills avdraget lagts till eller "Kontrollerat: inget avdrag" valts.
- [ ] J5 Offert där RUT/ROT-raderna överstiger totalen (G8) → kan inte sparas eller skickas; kundsidan visar varning och ingen Godkänn-knapp.
- [ ] J6 Karta: två AO på samma adress → en markör med "2" och lista; två olika adresser nära varandra → två markörer.
- [ ] J7 Mobil (riktig iPhone/Safari och Android): AO-detaljens åtgärder i två kolumner, Tid & stämpla, Mina jobb, fakturakön — inget klipps, inga knappar utanför skärmen.
- [ ] J8 Hårdladda efter installation → nya versionsnummer laddas (Service Worker).
- [ ] J9 Checklista (efter §2g, **på en märkt test-AO**): fältarbetare A trycker "Påbörja" på punkt 1 och B på punkt 2 på samma AO från två enheter → båda "Pågår" med rätt namn/tid på båda enheterna (inom en synkcykel); AO:ns status oförändrad.
- [ ] J10 "Utförd" på en pågående punkt → vem/när visas; progressindikatorn skiljer utförda och pågående (AO-detalj, AO-lista, Mina jobb).
- [ ] J11 Återställ: egen punkt med ao_checklist → tillåtet; annans och äldre punkt → nekas med tydligt besked; direktanrop till EF:en med fältarbetarens JWT → 403 `forbidden_other`; arbetsledare (ao_edit) → tillåtet. `history` på punkten visar kedjan.
- [ ] J12 Nätet av mitt i "Påbörja" → raden visar "Sparar…" och sedan fel; aldrig "Pågår" utan serverns svar. Befintliga AO med äldre utförda punkter visas oförändrade ("äldre punkt — uppgift om vem saknas").

### 4a. Testnivåer och regler för mutationstester i STAGING

Ett anrop som **kan** uppdatera databasen kallas aldrig läsande.

| Nivå | Verktyg | Skriver | Krav |
|---|---|---|---|
| 0 | `tests/e2e/staging-readonly.js` | Inget. Oinloggat; anropen nekas innan något läses eller skrivs. Källverifierat för EF:er i repot; ogiltig offerttoken ger 404 före skrivning. | Tillåtet (läsande) |
| 1 | `tests/staging/authz-read.js` | Inga affärsdata. Skickar bara läsåtgärder (`readWithHash`, `readHashes`, `readAllWithHashes`, GET); allt annat underkänner körningen. Inloggningen skriver i auth-schemat (session, refresh-token, `last_sign_in_at`). För `work-orders-list`/`store-key-write` (G4) bygger "läsande" på kontraktet, inte på granskad kod. En självkontroll avbryter med avvikelse om en skrivåtgärd skulle ha skickats. | GO + testkonton |
| 2 | `tests/staging/authz-mutation.js` | Skapar och tar bort egna märkta testposter. Metadata ändras och återställs inte (se nedan). | Uttryckligt GO för mutationstest + testkonton |

**Testkonton (nivå 1–2):**
- Ett konto per roll: admin (ao_create + ao_edit + ao_view_all + tidadmin), fältarbetare, valfritt en andra fältarbetare, arbetsledare, ekonomi och begränsad.
- E-postadressen ska ha "e2e" i lokaldelen. Det kan ändras med `VIFT_TESTKONTO_MONSTER`.
- Varje konto ska ha en personalpost med samma e-post.
- Lösenordet ges i `VIFT_PW` och skrivs aldrig i repo, chatt eller rapport.

**Miljöspärrar (före första anropet; utgångskod 2 och inga anrop):**
- `--jag-har-go`
- `--bekrafta-projekt=<ref>` måste vara exakt projektet i `VIFT_SUPABASE_URL`
- **projektlås:** nivå 1 och 2 körs bara mot VIFT CRM:s godkända STAGING-projekt. Projektet kontrolleras mot en SHA-256-hash i `tests/staging/lib.js`, så projekt-id:t står inte i klartext i repot. Det räcker alltså inte att utesluta LIVE och bekräfta ett godtyckligt projekt-id. Byte av STAGING-projekt kräver ett beslut och en kodändring.
- LIVE-projektet nekas alltid
- testkontomönstret
- nivå 2 kräver dessutom `--mutationstest` och `VIFT_MILJO=staging`
- ett runId för städning måste ha rätt format

**Nivå 2 — isolering, verifiering och återställning:**
1. **Före:** ögonblicksbild via adminkontot av berörda register, alla AO och alla tidposter. Om testposter från en tidigare körning finns kvar avbryts körningen.
2. **Under:**
   - Alla skrivningar görs mot egna poster med id `E2E-AUTHZ-<tid>-<slump>…` och texten "[E2E-TEST]".
   - Register-testposterna är inaktiva (`active: false`, `deleted: true`).
   - Journalen skrivs **före** varje mutation.
   - Ingen befintlig AO patchas, alltså ingen no-op-patch på skarp AO.
   - Register som inte är arrayer prövas inte.
   - Journalen innehåller exakt vad som skrevs.
3. **Efter (återhämtning):**
   - Städningen utgår från **journalen** och fungerar även när ögonblicksbilden eller AO-listan inte går att läsa.
   - Varje städåtgärd har högst 3 försök, med paus mellan försöken. Inga oändliga loopar.
   - Därefter görs en **efterkontroll** med en ny ögonblicksbild. Om den hittar testposter kompletteras städningen genom sökning på runId, och kontrollen görs igen.
   - "Återställt" påstås **bara** efter en lyckad efterkontroll. Om efterkontrollen inte kan göras rapporteras det som osäkert, med kod 3.
   - `--stada=<runId>` läser journalen och gör om städning och efterkontroll. Den kan köras igen tills den ger kod 0.
   - Rapporten sparas alltid.
4. **Utgångskoder:**
   - 0 OK
   - 1 säkerhetsavvikelse (t.ex. en roll fick skriva ett register den inte ska)
   - 3 testposter kvar: kör `--stada=<runId>`, och felsök manuellt om det inte räcker
   - 4 osäkert: en befintlig post ändrades under körningen, troligen av annan användare. Granska listan i rapporten.
   - 5 körningen avbröts: städningen är efterkontrollerad, men testerna är ofullständiga. Kör om.
   - Kod 3 omfattar nu även fallet "efterkontrollen kunde inte göras".
5. **Rapport:** `tests/staging/rapport/<verktyg>-<runId>.json` och journalen ligger lokalt och checkas inte in. De innehåller inga lösenord eller tokens.
6. **Rekommendation:** kör nivå 2 när ingen annan arbetar i STAGING, så att kod 4 blir entydig.

**Återställda affärsposter är inte detsamma som full databasidentitet.** Rapporten skiljer på två rader:
- **AFFÄRSPOSTER:** testposterna är borta, och befintliga register-element, AO (inklusive `updatedAt`) och tidposter är identiska med ögonblicksbilden.
- **DATABASIDENTITET:** är **inte** fullständig, och det är förväntat. Följande ligger kvar och återställs inte:
  - `vift_lastChanged` och `store.updated_at` för berörda nycklar. Det gäller även borttagningar och nekade försök, om servern stämplar dem.
  - Serverns idempotensposter för ao-time-write-anropen (`create_ao`, `patch_ao`, `create_time`, `delete_time`, `delete_ao`, `permanent_delete_ao`).
  - Eventuella aktivitetsloggposter om testkörningen. Servern kan skriva sådana (källa saknas, G4). Verktyget jämför loggen om den går att läsa och redovisar nya poster, men tar inte bort dem eftersom loggen är historik.
  - Inloggningar i auth-schemat och Edge Function-loggar.
  - WAL och backup-historik som innehåller testposterna.

**G13-täckning — delvis, inte heltäckande:**
- **Prövat:** om varje roll får lägga till en **ny** post i varje **array**-register.
- **Inte prövat:**
  - objektformade register, t.ex. inställningar (markeras "INTE prövat"; ingen skrivning görs)
  - per-post-regler, t.ex. egna och andras uppgifter i `vift_activities`
  - ändring eller borttagning av befintliga poster
  - fältnivå
  - hel-nyckel-skrivning (`write`)
- Ett grönt G13 betyder därför inte att BLOCKER-2 är löst i sin helhet. Rapporten säger det uttryckligen.

**Lokalt prövat:** `tests/staging_tools.test.js` (40/40) kör verktygen som riktiga processer mot den simulerade servern bakom en lokal HTTP-server. Det visar:
- Varje spärr stoppar före första anropet.
- Nivå 1 skickar inga skrivåtgärder och lämnar databasen bitidentisk.
- Torrkörningen skriver inget.
- Nivå 2 rör ingen befintlig AO, inte heller `updatedAt`, och städar så att registren blir bitidentiska. Den upptäcker också en server som tillåter otillåtna skrivningar.
- Misslyckad städning ger kod 3 och en lista. En ny körning vägrar starta, och `--stada` städar upp.
- Projektlåset stoppar ett godtyckligt projekt även när det är bekräftat.
- Nivå 1 skickar ingen checklist-sondering.
- Om nätet eller ögonblicksbilden fallerar efter mutationerna städas testposterna ändå bort via journalen. Verktyget påstår **inte** att allt är återställt och ger kod 3. `--stada` slutför sedan efterkontrollen med kod 0.
- Rapporten redovisar metadata som ligger kvar och att G13 bara är delvis prövat.

Detta bevisar verktyget, **inte** serverns verkliga behörigheter.

---

## 5. Backup, kontrollpunkter, rollback, kvarstående gap

**Före §2b:** notera `select * from storage.buckets` och `select * from pg_policies where tablename='objects'`.
**Kontrollpunkter:** efter varje steg — inloggning utan konsolfel; `OPTIONS` mot varje ny EF → 200; bucket `public = false`.
**Rollback:**
- §2a: återställ staging-repots föregående commit (inga serverobjekt).
- §2b: ta bort de tre EF:erna och policies; radera bucketen endast om den är tom.
- §2c: enligt dedup-planens egen återställning (görs inte utan GO).
- §3: `cron.alter_job(<jobid>, active := false)`.

**Kvarstående gap (kräver beslut/åtkomst):**
- **G1** `work_order_create` saknar committad migration i detta repo.
- **G4** Backend-källor (`ao-time-write`, `store-key-write`, `work-orders-list`, `invoice-write`, `rondering-pass-write`, deras migrationer och staging-repots `tests/`) finns bara i staging-repot. Repot är därför inte en komplett, återskapbar källa. Åtgärd: pusha staging-repots `supabase/` och `tests/` till denna branch.
- **G5** Klienten är byggd (§2f): den använder `append_log`/`remove_log` så fort servern stöder dem. Tills dess skickas loggen som förut (`patch_ao` med hela `log`-arrayen), och samtidiga loggposter från två enheter kan tappa en. Serverdelen är ett förslag som kräver G4.
- **G6** Dubbel utstämpling (S3) bygger på att servern deduplicerar `create_time` per idempotensnyckel över enheter — dokumenterat i klientkoden men inte verifierat mot servern.
- **G7** Historiska inbäddade bilder i `vift_workOrders` gör varje AO-ändring ~46× dyrare i WAL (uppmätt lokalt). Migrering kräver egen plan + GO.
- **G8** ~~Negativt "att betala" möjligt i offert~~ — **rättat i klienten** (Leverans J): `OfferCalc.validate` spärrar sparande och utskick, och kundsidan visar en varning i stället för totaler. Offerter som redan finns i STAGING med för stora avdrag visas med varning tills de rättas; ingen data ändras automatiskt.
- **G9** Ekonomirollen (`invoice_create` utan AO-behörighet): att sätta AO-status "fakturerad" nekades av den simulerade `ao-time-write`. Det verkliga serverbeteendet är okänt (G4). Klienten säger nu tydligt till och rullar tillbaka. Verifieras med J1b på en egen test-AO. **Behörigheter öppnas inte generellt** — beslut tas efter J1b.
- **G10** ~~ROT/RUT försvinner tyst mellan offert och faktura~~ — **rättat i klienten**: fakturan visar offertens avdrag, kan förifylla det, och "Skickad" spärras tills avdraget lagts till eller uttryckligen markerats som kontrollerat. Inga antaganden om avdragsrätt görs; beslutet ligger kvar hos ekonomi.
- **G11** DataSync pausar medan fokus står i ett inmatningsfält — även sökfält. Uppdateringar från andra enheter syns först när fokus lämnas. Oförändrad, planerad.
- **G12** ~~Äldre sparvägar visar "Sparat" före svar~~ — **rättat**: alla kända sparvägar går via `confirmPersist`/`commitElementChange` (besked efter ACK, återställning vid avslag). Ett globalt skyddsnät (`_vfWarnUnconfirmed`) fångar eventuella kvarvarande vägar.
- **G13** `store-key-write`:s behörighet per generisk nyckel är okänd (BLOCKER-2) — PERM-03 är fortfarande blockerad. Prövas med J1b (märkta testposter); **simulerade tester räknas inte som bevis**.

---

## 6. Samlat GO/NO-GO-underlag — STAGING-installation och integrationstester

**Detta är det enda gällande GO/NO-GO-underlaget.** `docs/RELEASEKANDIDAT-2026-11-23.md` hänvisar hit. **Inget av stegen är utfört.** Varje steg som ändrar något i STAGING kräver ett eget, uttryckligt GO från Lucas. Ett GO för ett steg gäller inte nästa.

### 6.1 Förutsättningar (före första GO)

**Testkonton (F1)** skapas av Lucas i STAGING. Varje konto ska ha "e2e" i e-postens lokaldel och en personalpost med samma e-post. Alla delar samma lösenord, som bara finns i `VIFT_PW` på den maskin som kör testerna.

| Miljövariabel | Roll | Behörigheter som krävs |
|---|---|---|
| `VIFT_USER_ADMIN` | admin | `ao_create`, `ao_edit`, `ao_view_all`, tidadministration (`all` räcker) |
| `VIFT_USER_FALT` | fältarbetare | `ao_view_own`, `ao_time`, `ao_checklist` |
| `VIFT_USER_FALT2` | andra fältarbetare (för checklistans ägarkontroll) | som ovan |
| `VIFT_USER_CHEF` | arbetsledare | enligt rollen i STAGING |
| `VIFT_USER_EKONOMI` | ekonomi | enligt rollen i STAGING |
| `VIFT_USER_BEGRANSAD` | begränsad | endast `dashboard_view`, `ao_view_own` |

Dessutom krävs:
- `VIFT_SUPABASE_URL`: det godkända STAGING-projektet. Projektlåset nekar alla andra.
- `VIFT_SUPABASE_ANON`: den publika nyckeln.
- `VIFT_MILJO=staging`, för nivå 2.

**Backup (F2), före steg 4 och före steg 5–8.** Spara utanför databasen och notera tidpunkten:
- `select key, value, updated_at from public.store where key in ('vift_workOrders','vift_timeEntries','vift_customers','vift_properties','vift_offers','vift_salesOpps','vift_roles','vift_staff','vift_settings','vift_articles','vift_priceGroups','vift_contracts','vift_activities','vift_activityLog')`
- `select pg_get_functiondef('public.work_order_checklist_resolve'::regproc)`
- Deployade källor för `work-order-checklist-resolve` och `offer-attachment-upload`.

**Övrigt:**
- **F3:** ingen annan arbetar i STAGING under steg 3–4 och steg 9.
- **F4:** STAGING-överlägget är klart för §2a.
- **F5:** lokala tester är gröna på den commit som installeras. Det gäller nu: `bash tests/run-all.sh` 12/12 (260 kontroller) och `node tests/e2e/run.js` med 105 godkända, 0 misslyckade, 1 blockerad och 1 känt fel.

### 6.2 Steg, beslut och stoppkriterier

| Steg | Vad | Ändrar i STAGING | GO som krävs | Beslut | Stoppa om | Rollback |
|---|---|---|---|---|---|---|
| 1 | Nivå 0 `staging-readonly.js` | Inget | — | **GO** (tillåtet) | Någon kontroll avviker | — |
| 2 | J1a nivå 1 `authz-read.js` | Inloggningsposter i auth-schemat | GO-1: testkonton får användas | **GO efter GO-1** | R1–R4 visar att en roll ser data den inte ska. Det är ett säkerhetsfynd: dokumentera, fortsätt bara efter beslut. | — |
| 3 | J1b `--torrkorning` | Inloggningsposter | GO-2: mutationstest i STAGING | **GO efter GO-2** | En spärr slår till (t.ex. projektlåset), ögonblicksbilden misslyckas, eller ett testkonto saknar personalpost | — |
| 4 | J1b skarp körning (G13, G9, G6) mot **nuvarande** server | Egna märkta testposter skapas och tas bort; `store.updated_at` och `vift_lastChanged` ändras | GO-2 | **GO efter GO-2** | Kod 3 eller 5: kör `--stada=<runId>` tills den ger kod 0; vidare först då.<br>Kod 4: granska listan.<br>Kod 1 (G13): BLOCKER-2 bekräftad. Installationen av klienten kan fortsätta, eftersom den inte ändrar serverbehörigheter, men LIVE förblir NO-GO och serveråtgärd planeras. | `--stada=<runId>` |
| 5 | §2a klientfiler (+ överlägg) | Staging-repots filer | GO-3 | **GO efter GO-3** | Inloggning ger konsolfel, eller nivå 0 visar fel versioner | Återställ staging-repots föregående commit |
| 6 | §2g checklistans migration och EF | DB-funktioner (`work_order_checklist_set_state`, ersatt `…_resolve`) och EF. Inga data, inga AO-statusar. | GO-4 | **GO efter GO-4** | Migrationen ger fel, eller EF-deploy misslyckas (fönstret mellan dem ska vara kort) | Enligt §2g |
| 7 | §2e `offer-attachment-upload` PATCH | EF | GO-5 | **GO efter GO-5 och källjämförelse** | Den deployade källan avviker utöver PATCH-blocket | Föregående EF-version |
| 8 | §2b bildobjekt + 3 EF *(valfritt i omgången)* | Bucket, policies, 3 EF | GO-6 | **GO för granskning; installation efter GO-6** | Bucket blir publik eller policies avviker | Enligt §5 |
| 9 | Efterkontroll: nivå 0 igen, och J1b igen (nu med checklistans ägarkontroll) | Som steg 1 och 4 | GO-2 gäller i samma omgång | **GO** | Som steg 1 och 4 | Som steg 4 |
| 10 | Manuella integrationstester §4 (A, T, S, B, O, F, I, E, J2–J12) på **märkta testposter** | Testposter | GO-7: testdata för manuella tester | **GO efter GO-7** | Ett test som skriver till en befintlig post. Avbryt och återställ. | Ta bort testposterna |

### 6.3 Utanför denna omgång

| Del | Beslut | Skäl |
|---|---|---|
| LIVE | **NO-GO** | LIVE saknar STAGING:s backend (§7). G13/BLOCKER-2 är oavgjord. Inget är STAGING-verifierat. |
| §2f G5 serverdel (`append_log`) | **NO-GO** | Förslag; kräver källan till `ao-time-write` (G4). |
| §3 service-monitor-aktivering | **NO-GO nu** | Testas och beslutas separat. |
| G7 historisk bildmigrering, aktivitetslogg som tabell | **NO-GO nu** | Planerat; kräver egen plan, backup och GO. |
| Det ersatta `tests/e2e/staging-authz.js` | **Får inte användas** | Det kunde ändra data; vägrar nu köra. |
| §2c activityLog-städning | **UTGÅR** | Uppgiften om dubblett var felaktig. |

### 6.4 Samlad bedömning

- **Klientens releasekandidat är redo för kontrollerad STAGING-installation (steg 5–8) efter respektive GO.** Inga kända klientfel blockerar test. Testverktygen för serverbehörigheter är rättade och lokalt prövade.
- **Rekommenderad start:** steg 1–4 *före* installationen. Då vet vi hur den nuvarande servern beter sig för G13, G9 och G6 innan något ändras.
- **Kända risker:**
  - G13 (serverns behörighet per register) är okänd tills steg 4 är kört.
  - G9 kräver beslut efter steg 4.
  - G6 är overifierad.
  - Äldre cachade klienter visar pågående checklistpunkter som ej påbörjade tills de laddats om.
  - Borttagen autostart: fältarbetare måste starta AO:n själva. Det bör kommuniceras.
- **STAGING-verifierad** blir en punkt först när steg 9–10 är gröna för den. Masterplanens status uppdateras då från LOKALT TESTAD till STAGING-VERIFIERAD, punkt för punkt.

## 7. LIVE senare

LIVE (`hjplzjsbbowiyoyhdghc`, Loopia) kör en äldre klient och saknar sannolikt allt i §1 (ao-time-write, RPC:er, RESTRICTIVE-policyer, stamp_status, store-key-write, work-orders-list m.fl.). Denna klient kan **inte** gå till LIVE förrän samma backend är installerad där, i samma ordning som STAGING fick den, med backup före varje migration. Det kräver G4 (källorna i repot) och en egen LIVE-plan.
