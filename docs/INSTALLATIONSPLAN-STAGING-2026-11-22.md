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

**2026-11-24 — slutuppdrag inför STAGING (allt i repot, inget installerat).**
- **TASK-01:** per-post-regel för uppgifter i `store-key-write` (§2i).
- **Aktivitetsloggen:** serverstyrd och append-only, via `appendActivity` och en ny RPC (§2i).
- **G5:** ny Edge Function `work-order-log-write` med en atomisk RPC (§2j). `ao-time-write` ändras inte.
- **Bildbucket:** som migrationsfil (§2b).
- **Projektdokument:** inventerade (§2k).
- **Testverktyg:** `tests/staging/e2e-real.js` för riktig STAGING (§4a).
- **Paket:** publiceringspaket v2 ersätter v1. WinSCP-instruktion: `docs/WINSCP-STAGING-PUBLICERING.md`. Backup-SQL: `supabase/manual/staging_backup_och_kontroll_2026-11-24.sql`.
- **§6** är omskriven till det samlade GO-underlaget.

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

### 2a. Klientfiler (inga Supabase-ändringar)

**Publiceringsväg — verifierad 2026-11-23, ersätter antagandet om GitHub Pages:**
- `staging-crm.viftfast.se` ligger på **Loopia**: `Server: nginx`, `X-Loopia-Node`, IP 93.188.2.53.
- Den publicerade sidan motsvarar fil för fil branchen `chatgpt/staging-all-blockers-2026-11-17` (`26ce058`) i STAGING-repot, inte `gh-pages`. `gh-pages` står på `58a23d4`; dess CNAME är inaktuellt, och enligt `DEPLOY_RESULT_20261117.md` byggdes Pages aldrig.
- **En push till `gh-pages` ändrar alltså inte webbplatsen.** Publicering görs genom att filerna laddas upp till Loopia med FileZilla, på samma sätt som för LIVE.
- Loopia-FTP går inte att nå från Claudes miljö. Lucas laddar upp, och Claude gör efterkontrollen.

**Paket:**
- Byggs med `tools/build-staging-package.sh <STAGING-arbetskopia> origin/chatgpt/staging-all-blockers-2026-11-17`.
- Grunden är den publicerade versionen, med klientfilerna från detta repos HEAD.
- STAGING-överlägget återinförs genom trevägssammanslagning. Bygget avbryter vid konflikt eller om en LIVE-referens finns kvar.
- Resultatet är en release-commit på den lokala branchen `release/staging-2026-11-24` i STAGING-repot, plus två zip-filer (publicering och återställning) och `MANIFEST.txt` med SHA-256 per fil.

**Uppladdning:** alla filer under `src/` först, därefter `index.html` och `public-offer.html`. `config.js`, `staging-banner.js` och övriga filer på servern rörs inte.

**Efterkontroll:** `tools/verify-staging-deploy.sh MANIFEST.txt` hämtar varje fil som webbplatsen faktiskt levererar och jämför SHA-256. Därefter körs nivå 0, där versionsjämförelsen ska visa "0 nyare i repot".

**Återställning:** ladda upp återställnings-zippen (filerna från `26ce058`), med `index.html` sist. Före paketbygget verifierades att Loopia idag levererar exakt `26ce058` för alla 43 berörda filer.


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

1–2. Kör `supabase/migrations/20261124000003_workorder_images_bucket.sql`. Den skapar en privat bucket (10 MB, jpeg/png/webp) och policies som bara gäller `service_role`. Migrationen är idempotent och innehåller samma SQL som tidigare stod i filhuvudet i `WorkOrderImageService.js`.
3. `supabase functions deploy work-order-image-url`
4. `supabase functions deploy work-order-image-upload`
5. `supabase functions deploy work-order-image-delete`
6. Därefter (eller samtidigt med) §2a.

### 2c. ~~Databasstädning `vift_activityLog`~~ — UTGÅR

~~`vift_activityLog` i STAGING innehåller ett dubblett-id …~~ Felaktig uppgift (byggde på en kodkommentar, inte på data). Verifierat 2026-11-23: 150 poster, 0 dubbletter. Ingen datafix ska göras. Om aktivitetsloggen inte sparas i STAGING ska det först reproduceras med ett autentiserat skrivtest (E2E-rapporten §6, punkt S-AKT).

### 2d. Migrationer

Ingen ny migration behövs för §2a–2b eller §2e. §2g har en egen migration (`20261123000002_work_order_checklist_progress.sql`). `20261120000001_PROPOSAL_push_subscriptions_index.sql` är fortfarande overifierat mot STAGING:s indexlista — kontrollera `pg_indexes` först. `20261123000001_PROPOSAL_work_order_log_ops.sql` hör till §2f och ska **inte** köras nu.

### 2e. `offer-attachment-upload` — PATCH för bilagornas metadata (separat GO)

**Regression upptäckt och rättad (2026-11-25).** Den installerade STAGING-versionen v12 var *nyare* än repots källa. Den har atomiska `offer_attachment_append`, `offer_attachment_soft_delete` och `offer_events_append`, och `apikey` i CORS. Repots tidigare källa hade återinfört läs-hela-arrayen-skriv-tillbaka och saknade `apikey`, vilket skulle ha brutit klientens uppladdningar.

Repots källa bygger nu på v12, byte för byte, plus ett PATCH-block och `PATCH` i CORS-metoderna. PATCH går via en ny radlåst RPC, `offer_attachment_patch`, i migration `20261125000001`. Den vitlistar fyra fält, är bara körbar av service_role och har samma mönster som v12:s RPC:er. `tests/offer_attachment_upload.test.js` (43/43) kontrollerar följande:
- Alla 375 rader i v12 finns kvar i ordning.
- Fixturen med de installerade RPC:erna har samma md5 som i STAGING.
- Vitlistning, not_found och behörighet fungerar.
- Samtidig PATCH, uppladdning och borttagning tappar ingenting (riktig PostgreSQL).
- Själva EF-källan körs i Node mot samma databas.

Samma test mot den gamla källan ger 9 fel.

1. Migration `20261125000001_offer_attachment_patch.sql`.
2. Deploy `offer-attachment-upload` (verify_jwt = true) med `_shared/vift-auth.ts`.
3. Test: ändra namn och synlighet på en bilaga, ladda upp och ta bort. Som roll utan `offer_manage` → 403.

Rollback: deploya `supabase/backup/staging-ef-fore-installation/offer-attachment-upload-v12/` och kör `drop function public.offer_attachment_patch(text, jsonb);`.

### 2g. Checklista med tre statuslägen (separat GO, i denna ordning)

Beslut Lucas 2026-11-23: ingen autostart av AO från checklistan; egen åtgärd återställs med ao_checklist, annans/äldre punkt kräver ao_edit (kontroll i RPC:n). Detaljer: masterplan punkt 186.

1. Backup: `select value from store where key='vift_workOrders'` (spara utanför databasen) och notera `pg_get_functiondef('public.work_order_checklist_resolve'::regproc)`.
2. Kontrollera att deployad `work-order-checklist-resolve` i STAGING motsvarar repots äldre version (före denna ändring). Avvikelse → stoppa och stäm av.
3. Migration `supabase/migrations/20261123000002_work_order_checklist_progress.sql` (skapar `work_order_checklist_set_state`, ersätter `work_order_checklist_resolve` med en delegerande version utan autostart). Ändrar **inga** befintliga data eller AO-statusar.
4. Direkt därefter: `supabase functions deploy work-order-checklist-resolve` (verify_jwt som idag). Mellan steg 3 och 4 nekas återställning av annans åtgärd (fail-closed) — håll fönstret kort.
5. §2a-klienten (WorkOrderService/WorkOrderDetailPage m.fl.) sonderar själv stödet; före steg 3–4 visas checklistan som förut utan "Påbörja".

**Äldre klienter:** en webbläsare som fortfarande kör den gamla klienten visar pågående punkter som ej påbörjade (de nya fälten ignoreras, inget skrivs över — den gamla klienten skickar bara OK/avvikelse/återställ via samma RPC). Hårdladdning efter §2a löser det.

**Test (J9–J12 i §4).** **Rollback:** kör om `20260917000001_work_order_checklist_atomic_rpc.sql` (återställer den äldre RPC:n med autostart), `drop function public.work_order_checklist_set_state(text,text,text,text,text,text,text,text,text,boolean,boolean);` och deploya föregående EF-version. De nya fälten i punkterna kan ligga kvar (ignoreras); ingen datafix.

### 2h. `offer-public-pdf` — kundsidans PDF-nedladdning (separat GO, valfri)

Den nya `public-offer.html` har knappen "Ladda ner PDF", som anropar `offer-public-pdf`. Funktionen finns i repot (`supabase/functions/offer-public-pdf/`) men **inte i STAGING**; en CORS-förfrågan ger 404 (2026-11-23).

Utan deploy får kunden ett tydligt felmeddelande ("Kunde inte ladda ner PDF"), och ingenting annat påverkas.

Funktionen är skrivfri: den läser offerten via token och har rate-limit i minnet, men inga skrivningar.

- Deploy: `supabase functions deploy offer-public-pdf --no-verify-jwt`. Den är publik på samma sätt som `offer-token-validate`.
- Rollback: ta bort funktionen.

**Övrigt som saknas i STAGING (oförändrat, ingen regression):** `project-document-upload` och `project-document-url` anropas av den nuvarande STAGING-klienten också. Projektdokument fungerar därför inte i STAGING, varken före eller efter. Detta förs till masterplanen.

### 2f. ~~G5 serverdel i ao-time-write~~ — ERSATT av §2j (2026-11-24)

Lösningen kräver inte längre källan till `ao-time-write` (G4). I stället finns en egen Edge Function (§2j), byggd på samma mönster som `work-order-checklist-resolve`. Förslaget `20261123000001_PROPOSAL_…` är märkt som ersatt och ska inte köras.

### 2i. store-key-write: uppgifter (TASK-01) och serverstyrd aktivitetslogg (separat GO)

**Problem:**
- `store-key-write` v3 kräver `admin_manage` för `vift_activities`. Fältarbetare kan därför inte klarmarka sina uppgifter (E2E TASK-01 mot STAGING-reglerna).
- Samma behörighet krävs för `vift_activityLog`. Vanliga användares händelser sparas aldrig, och den som har skrivrätt kan skriva om historiken.

**Lösning:** källan är `supabase/functions/store-key-write/`. Den installerade v3 är införd oförändrad i commit `5b239b8`, och ändringarna ligger i senare commits.

- **Per-post-regel för uppgifter** (`activities-policy.ts`):
  - Admin och arbetsledare (`ao_edit` + `ao_view_all`) har full åtkomst.
  - **Ansvarig** får ändra status, klardatum, "klar av" (bara sig själv) och förfallodatum på sin egen tilldelade uppgift.
  - **Skapare** får ändra sin egen uppgift, men inte flytta den till någon annan.
  - Att skapa eller radera en uppgift är bara tillåtet för egna uppgifter.
  - Allt annat nekas, och en enda otillåten post nekar hela anropet.
  - Regeln bedöms på `previous`. Den installerade RPC:n tillämpar en ändring bara när serverns aktuella post exakt motsvarar `previous` (kontrollerat i `20261108000001`), så ett förfalskat `previous` ger konflikt och ingen skrivning.
  - Ingen databasändring krävs för regeln.
- **Aktivitetsflöde (klientrapporterat, INTE en verifierad revisionslogg)** (`activity-log.ts` + migration `20261124000001_activity_log_append.sql`):
  - Ny åtgärd `appendActivity`.
  - **Det servern verifierar:** vem som rapporterar (`userId` från den verifierade JWT:n) och när (servertid). Klientens värden ignoreras.
  - **Det servern INTE verifierar:** att händelsen faktiskt inträffat. Typ, beskrivning och objektreferenser är klientens rapport. Posterna märks `source: 'klientrapport'` och `verifiedFields: ['userId','timestamp']`; det tidigare `serverVerified` är borttaget, eftersom det antydde mer än det betydde.
  - **Begränsningar:** typ-allowlist, referenser bara i id-format (annars `invalid_reference`), längdgränser och högst 60 poster per användare och minut (in-memory per EF-instans).
  - Posten läggs till atomiskt först under radlås, omsändning är idempotent och loggen kapas till 500 poster.
  - `write`/`writeMerge` av `vift_activityLog` nekas för alla (append-only).
  - **Kvarstående gap (masterplan 200):** en verifierad revisionslogg kräver att de skrivande RPC:erna själva skriver händelsen i samma transaktion som affärsändringen. Det byggs inte i denna omgång. Flödet ska därför inte användas som bevis i tvister eller revision.
- **Klienten (§2a):**
  - sonderar stödet och skickar en post i taget via en liten utkorg;
  - skickar aldrig hela listan;
  - beter sig som förut mot en äldre server.

**Installation:**
1. Backup enligt §6.1 F2.
2. Jämför den deployade `store-key-write` med commit `5b239b8` (`supabase functions download store-key-write`). Finns det andra skillnader: stoppa och stäm av.
3. Kör migrationen `20261124000001`.
4. `supabase functions deploy store-key-write`. Den tar med `stamp-status.ts`, `activities-policy.ts`, `activity-log.ts` och `../_shared/vift-auth.ts`, där repots version är en ren utökning av den installerade.

**Test:**
- J1b (`authz-mutation`): `vift_activities` för fältarbetare. Ny post åt annan och ändring av annans uppgift ska nekas.
- TASK-01 manuellt.
- J13: aktivitetslogg. En fältarbetares åtgärd syns i loggen med rätt användare.

**Rollback:** deploya den sparade versionen av `store-key-write` och kör `drop function public.activity_log_append(jsonb,int);`.

### 2j. work-order-log-write — atomiska AO-loggposter, G5 (separat GO)

Ny Edge Function `supabase/functions/work-order-log-write/` med migration `20261124000002_work_order_log_ops.sql`.

- **`append_log`** lägger till en post under radlås. Samma id med samma innehåll räknas som omsändning och ger ingen ändring. Samma id med annat innehåll ger `id_collision`.
- **`remove_log`** tar bort en post. Saknas posten görs ingen skrivning.
- Servern stämplar `staffId` på nya poster. Borttagning tillåts för den egna posten eller med `ao_edit`; äldre poster utan `staffId` kräver `ao_edit`.
- Synlighet: `ao_view_all`, annars tilldelad eller pool.
- Inga andra AO-fält än `log` och `updatedAt` ändras.
- Klienten skickar `append_log`/`remove_log`, även från utkorgen, hit när funktionen finns. En 404 betyder att den gamla vägen används.

**Installation:**
1. Kör migrationen.
2. `supabase functions deploy work-order-log-write`.

**Test:** E10, som förväntas lyckas efter installationen, och F4 i `e2e-real.js`.

**Rollback:** ta bort funktionen och kör `drop function` för de två RPC:erna. Klienten faller då tillbaka automatiskt.

### 2k. Projektdokument — saknas i STAGING (separat GO, valfri)

- `project-document-upload` och `project-document-url` ger 404 i STAGING, men både dagens och den nya klienten anropar dem. Projektdokument fungerar därför inte i STAGING i dag, och det är ingen regression.
- Källa och migrationer finns i repot: `20260907000001_storage_project_documents.sql`, `20260908000001_project_documents_atomic_rpc.sql` och `20260908000002_project_documents_r2_lastchanged_and_rls.sql`.
- **Före GO:** kör del A i backup-SQL:en (A2/A3) för att se om RPC:n och bucketen redan finns. Kör bara de migrationer som saknas, och deploya sedan de två funktionerna.
- `tsc`: `project-document-upload` har samma typvarning för `crypto.subtle.digest` som `offer-attachment-upload`. Det är en typdefinitionsfråga; Deno kör koden.


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
| 2 | `tests/staging/authz-mutation.js` | Skapar och tar bort egna märkta testposter. Metadata ändras och återställs inte (se nedan). |
| 2 | `tests/staging/e2e-real.js` (återhämtning via `tests/staging/recovery.js`, samma modul som `authz-mutation`) | Webbläsartest mot den publicerade webbplatsen och riktig server:<br>• R0: sidor per roll<br>• F2: checklista<br>• F3: stämpling på två enheter, exakt en tidpost<br>• F4: samtidiga loggposter<br>• F5: nätavbrott<br>Skapar egna test-AO och tidposter, med journal, städning och redovisning av automatiska ändringar. Det kan förekomma även vid inloggning, eftersom serviceintervallens dagliga kontroll kan skapa uppgifter. Ekonomikedjan körs som manuella testfall (O1–O3, F1, J4, J5). Lokalt prövat 26/26 mot paketet och den simulerade servern (`tests/staging_e2e_real.test.js`), inklusive felvägarna:<br>• nätfel som gör efterkontrollen omöjlig: kod 3 och spärrfil, nästa körning blockeras med 0 anrop, och `--stada` ger kod 0;<br>• misslyckad borttagning: kod 3, därefter `--stada`;<br>• en ändrad befintlig post: kod 4, aldrig godkänt;<br>• avbrott: kod 5 med efterkontrollerad städning. | Uttryckligt GO för mutationstest + testkonton |

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
   - **Spärrfil (2026-11-25):** vid kod 3 skrivs `tests/staging/rapport/OSTADAT-<runId>.lock`. Så länge den finns vägrar **alla** nivå 2-körningar (`authz-mutation`, `e2e-real`) att starta, med kod 2 och 0 anrop. Undantaget är `--stada=<det runId:t>`, som tar bort spärrfilen först när efterkontrollen visar att inga testposter finns kvar.
   - **Ändrade befintliga affärsposter räknas aldrig som godkänt** (AFFÄRSPOSTER = AVVIK, kod 4), oavsett orsak: automatik vid inloggning, en annan användare eller testet.
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

**Det här är det enda gällande GO/NO-GO-underlaget.** Det uppdaterades 2026-11-25. **Releasekandidaten är frusen** (klient: paket v2 från `09d1129`; server och testverktyg: commit enligt rapporten). Efter frysningen görs bara ändringar med dokumenterat skäl. **Inget av stegen är utfört.** Varje steg som ändrar något i STAGING kräver ett eget, uttryckligt GO från Lucas. Allt nedan rör bara STAGING (`yyzljlqyzzcbxmcdbual`); LIVE rörs aldrig.

### 6.1 Förutsättningar

**F1 Testkonton (6 st). Lucas skapar dem efter GO-1; ingen bred åtkomsttoken behövs.**
1. Supabase Dashboard (STAGING) → Authentication → Add user → "Auto confirm". Skapa sex användare med "e2e" i e-postens lokaldel:

   | Konto | Roll i CRM | Behörigheter |
   |---|---|---|
   | e2e-admin | Superadmin | `all` |
   | e2e-falt1 | Fältarbetare | `ao_view_own`, `ao_time`, `ao_material`, `ao_checklist` |
   | e2e-falt2 | Fältarbetare | samma som e2e-falt1 |
   | e2e-chef | Arbetsledare | enligt rollen i STAGING |
   | e2e-ekonomi | Ekonomi | enligt rollen i STAGING |
   | e2e-begransad | E2E begränsad | `dashboard_view`, `ao_view_own` |

   Alla får samma lösenord.
2. I STAGING-appen som admin:
   - Personal → lägg till en personalpost per konto med **samma e-post** och rätt roll.
   - Admin → Roller → skapa rollen "E2E begränsad" om den saknas.
3. Lösenordet anges **aldrig i chatten**. Lucas lägger in det som miljövariabeln `VIFT_PW`, tillsammans med `VIFT_USER_ADMIN`, `VIFT_USER_FALT`, `VIFT_USER_FALT2`, `VIFT_USER_CHEF`, `VIFT_USER_EKONOMI`, `VIFT_USER_BEGRANSAD` och `VIFT_SUPABASE_ANON` (publik nyckel), i Claude-miljöns inställningar. Variabeln är synlig för den som kan se miljön, så den ska bara användas för dessa isolerade testkonton och bytas efter testomgången.
4. Kontroll: del A5 i backup-SQL:en ska ge 6 rader, och nivå 1 ska rapportera rätt synlighet per roll.

**F2 Backup** (före steg 4 och före steg 6–9), med `supabase/manual/staging_backup_och_kontroll_2026-11-24.sql`:
- Del A är bara läsning och kan köras direkt.
- Del B (backupschemat `vift_staging_backup_20261124`) kräver GO-2.
- Del C är efterkontrollen. Ladda dessutom ner backupen som CSV/JSON, så att en kopia finns utanför Supabase.
- Spara de deployade versionerna av `store-key-write`, `work-order-checklist-resolve` och `offer-attachment-upload` (`supabase functions download …`).
- Klienten återställs med `VIFT-CRM-STAGING-2026-11-24-aterstallning.zip`. Den är verifierad 44/44 mot det STAGING levererar idag.

**F3** Ingen annan arbetar i STAGING under steg 4, 10 och 11.

**F4** Lokala tester är gröna på den commit som installeras (se rapporten §C).

### 6.2 Steg i ordning

| # | Steg | Ändrar i STAGING | GO | Stoppa om | Rollback |
|---|---|---|---|---|---|
| 1 | Nivå 0 (`staging-readonly.js`) | Inget | — (tillåtet) | Någon kontroll avviker | — |
| 2 | F1 testkonton (Lucas) + nivå 1 (`authz-read.js`) | Auth-användare, personalposter, en roll | **GO-1** | En roll ser data den inte ska | Ta bort testkonton och personalposter |
| 3 | F2 backup del B + kopia utanför Supabase + EF-nedladdning | Backupschema | **GO-2** | Del C visar skillnad | `drop schema vift_staging_backup_20261124 cascade` |
| 4 | Nivå 2 mot **nuvarande** server: `authz-mutation.js`, först `--torrkorning` | Egna märkta testposter; metadata (se §4a) | **GO-3** | Kod 3 eller 5: kör `--stada`. Kod 1 för G13: dokumentera; LIVE förblir NO-GO | `--stada=<runId>` |
| 5 | **Publicering**: Lucas laddar upp v2 med WinSCP (`docs/WINSCP-STAGING-PUBLICERING.md`); Claude kör `verify-staging-deploy.sh MANIFEST-v2.txt` och nivå 0 | Filer på Loopia (47 st) | **GO-4** | En fil avviker, eller inloggning ger konsolfel | Ladda upp återställnings-zippen |
| 6 | §2g checklistans migration och EF | 2 DB-funktioner och 1 EF | **GO-5** | Fel vid migration eller deploy | Enligt §2g |
| 7 | §2i store-key-write (TASK-01 + aktivitetslogg) | 1 DB-funktion och 1 EF | **GO-6** | Den deployade källan avviker från `5b239b8`, eller deployen misslyckas | Föregående EF och `drop function` |
| 8 | §2j work-order-log-write | 2 DB-funktioner och 1 ny EF | **GO-7** | Fel vid migration eller deploy | `drop function` och ta bort EF:en |
| 9 | §2e bilagor (PATCH), §2h `offer-public-pdf`, §2b bilder, §2k projektdokument | EF:er, bucket och policies | **GO-8** (delbart) | Avvikande källa; en bucket blir publik | Enligt respektive avsnitt |
| 10 | Efterkontroll: nivå 0, nivå 1 och nivå 2 igen | Testposter | GO-3 gäller | Som steg 1, 2 och 4 | Som steg 4 |
| 11 | `e2e-real.js` (R0, F2–F5) och manuella testfall i §4 på märkta testposter, plus visuell granskning av den publicerade sidan | Testposter | **GO-9** | Ett test skriver till en befintlig post | `--stada` och borttagning av testposter |

Steg 5 kan göras före steg 4 om Lucas vill se klienten först. Klienten fungerar mot den nuvarande servern, eftersom alla nya vägar har reserv. Den rekommenderade ordningen är ändå 1–4 först, så att G13, G9 och G6 är kända innan något ändras.

### 6.3 Utanför denna omgång

| Del | Beslut | Skäl |
|---|---|---|
| LIVE | **NO-GO** | LIVE saknar STAGING:s backend (§7). Inget är STAGING-verifierat. G13 är oavgjord. |
| §3 aktivering av service-monitor | **NO-GO nu** | Separat beslut |
| G7 historisk bildmigrering | **NO-GO nu** | Kräver egen plan, backup och GO |
| `ao-time-write`-källan (G4) | Kvar | Behövs inte längre för G5. Övriga skäl (granskning, återskapbarhet) kvarstår. |
| Det ersatta `tests/e2e/staging-authz.js` | Får inte användas | Kunde ändra data |

### 6.4 Samlad bedömning

**Byggt och lokalt testat:**
- klientens releasekandidat (paket v2);
- serverändringarna §2g, §2i och §2j, med SQL mot riktig PostgreSQL och policyn mot den riktiga TypeScript-källan;
- testverktyg för nivå 0–2 och för webbläsartest mot riktig STAGING.

**Kräver STAGING-GO:** allt i 6.2 från steg 2.

**STAGING-verifierat:** inget ännu.

**Blockerat:** inget tekniskt. Det som återstår är beslut och åtkomst: testkonton, backup, uppladdning och deploy.

### 6.4b STAGING KLIENT – GO (verifierad 2026-11-25)

Steg 5 (GO-4) är **genomfört och verifierat**. Den första uppladdningen innehöll av misstag det ersatta paketet v1 (46/46 enligt v1-manifestet). De fyra filer som skiljer togs fram och laddades upp i en komplettering. Efterkontrollen gav:
- `verify-staging-deploy.sh MANIFEST-v2.txt`: **47/47 identiska** (SHA-256 för det Loopia faktiskt levererar).
- Nivå 0: 11/11 OK. Versionsjämförelsen visar 82 versionsatta filer, 0 nyare i repot och 0 äldre, alltså exakt repots versioner.
- Webbläsarkontroll på laptop och iPhone:
  - STAGING-projektet laddas, inte LIVE, och etiketten "STAGING · TESTMILJÖ" visas.
  - Inloggningssidan fungerar och alla 85 resurser från webbplatsen svarar utan fel.
  - Nya versioner laddas (`state.js?v=74`, `components.css?v=107`) och nya klientfunktioner finns, bland annat `newEntryId`, `MapGrouping`, checklistans statuslägen och den atomiska loggvägen.
  - Service Workern är aktiv. Enda misslyckade anropet är Google Fonts, som testmiljöns proxy blockerar.
- Visuellt granskat på den publicerade sidan: inloggningen på laptop och iPhone. Vyerna bakom inloggningen granskas på den publicerade sidan först med testkonton (GO-1, sedan GO-9). Filerna är byte för byte identiska med paketet, vars vyer granskades före frysningen.

Den nya klienten använder sina reserver mot dagens server tills §2g, §2i och §2j installeras. Ingen serverfunktion är ändrad.

### 6.4c Förkontroll mot det som faktiskt är installerat (2026-11-25, bara läsning via Supabase-anslutningen)

**Backup i databasen (GO-2 del B, skapad av ChatGPT):** kontrollerad oberoende. Inga skillnader mot live, och anon/authenticated har inga rättigheter på schemat.

| Del | Antal | Resultat | Referenssumma |
|---|---|---|---|
| store | 40 | 40/40 fingeravtryck stämmer | `dc85f35f…` |
| op_idempotency | 2146 | 2146/2146 | `ac6f2cd2…` |
| funktionsdefinitioner | 50 | 50/50 identiska med live | `9d8e7676…` |

Inga lösenord, portkoder eller nyckelfält med värden finns i store.

**Kopia utanför Supabase:** saknas ännu (**stopp för GO-1 och framåt**). Verktyget `tools/staging-backup-export.js` exporterar backupen, verifierar varje rad mot databasens md5 och summor, skriver återställnings-SQL och provar återställningen i en tom lokal databas. Det är lokalt provat i `tests/staging_backup_export.test.js` (10/10, en kapad export avvisas). Återställning i databasen: `supabase/manual/staging_restore_from_backup_20261124.sql`.

**Edge Functions före installation:** sparade i `supabase/backup/staging-ef-fore-installation/` med SHA-256 och Supabase `ezbr_sha256`.

| Serverdel | Installerat i STAGING | Jämförelse | Bedömning |
|---|---|---|---|
| `store-key-write` (GO-6) | v3 | identisk med `5b239b8`; repot lägger bara till 181 rader | OK |
| `work-order-checklist-resolve` (GO-5) | v1 | identisk med repot före `3f2dd7d` (samma låsta `supabase-js@2.118.0`) | OK |
| `work_order_checklist_resolve` (DB, GO-5) | md5 `abb860f9…` | identisk md5 med repots `20260917000001` | OK |
| `offer-attachment-upload` (GO-8) | v12 | repot var äldre, se §2e | **Rättat**, testat |
| `offer_attachment_*`, `offer_events_append` (DB) | finns | fixtur med samma md5 används i testerna | OK |
| `offer-public-pdf` (GO-8) | saknas | samma `publicToken`-, återkallnings-, utgångs- och snapshotregler som installerade `offer-token-validate` v11; skriver inget | OK |
| `activity_log_append`, `work_order_log_*`, `work_order_checklist_set_state`, `offer_attachment_patch` | saknas | inga namnkrockar | OK |
| `project_documents_*` + bucket `project-documents` (GO-8 §2k) | saknas | policynamnen krockar inte med befintliga 21 store- och 3 storage-policyer | OK |
| bucket `workorder-images` (GO-8 §2b) | saknas | enda bucket i dag är `offer-attachments` | OK |

### 6.5 Nästa konkreta GO (2026-11-25)

**Går att göra utan dator, i webbläsaren (även på mobil eller surfplatta):**

| GO | Vad Lucas gör | Vad Claude sedan gör | Ändrar i STAGING | Återställning |
|---|---|---|---|---|
| **GO-1 Testkonton** | 1. Supabase Dashboard för STAGING → Authentication → Add user (Auto confirm): sex konton enligt §6.1 F1.<br>2. I STAGING-appen som admin: personalposter med samma e-post och rätt roll, plus rollen "E2E begränsad".<br>3. I Claude-miljöns inställningar: `VIFT_PW`, `VIFT_USER_*`, `VIFT_SUPABASE_URL` och `VIFT_SUPABASE_ANON`. Aldrig i chatten. | Del A i backup-SQL:en kontrolleras via nivå 1 (`authz-read.js`): sex konton och rätt synlighet per roll. | Auth-användare, personalposter, en roll | Ta bort konton, personalposter och rollen |
| **GO-2 Backup** | SQL Editor: kör del A (bara läsning), del B (`vift_staging_backup_20261124`) och del C med C1–C4 (efterkontroll, md5-fingeravtryck per nyckel, Edge Function-versioner). **Kopia utanför databasen:** med dator `supabase db dump` av backupschemat, verifierad mot md5 i C3. Utan dator: Dashboard → Database → Backups om planen har nedladdning. En kapad SQL-export räknas inte som kopia. **Edge Function-källor:** `supabase functions download` med dator, senast före GO-5–GO-8. | Inget. Claude har ingen databasåtkomst. | Ett nytt backupschema | `drop schema vift_staging_backup_20261124 cascade` |
| **GO-3 Behörighetstest mot nuvarande server** | Ge GO i chatten. | `authz-mutation.js --torrkorning`, därefter den skarpa körningen (G13, G9, G6). Journal, städning, spärrfil och efterkontroll som i §4a. | Egna märkta testposter (tas bort) och metadata | `--stada=<runId>` |

**Kräver dator (väntar):**
- **GO-4 publicering** med WinSCP enligt `docs/WINSCP-STAGING-PUBLICERING.md`.
- Nedladdning av de deployade Edge Functions (backupens EF-del, `supabase functions download`).
- **GO-5–GO-8** migrationer och deploy med Supabase CLI.
- **GO-9** webbläsartestet (`e2e-real.js`) mot den publicerade sidan, efter GO-4.

**Rekommendation:** GO-1, GO-2 och GO-3 nu. Då är behörighetsfrågorna G13, G9 och G6 besvarade mot den riktiga servern innan Lucas är tillbaka vid datorn för publicering och installation.

## 7. LIVE senare

LIVE (`hjplzjsbbowiyoyhdghc`, Loopia) kör en äldre klient och saknar sannolikt allt i §1 (ao-time-write, RPC:er, RESTRICTIVE-policyer, stamp_status, store-key-write, work-orders-list m.fl.). Denna klient kan **inte** gå till LIVE förrän samma backend är installerad där, i samma ordning som STAGING fick den, med backup före varje migration. Det kräver G4 (källorna i repot) och en egen LIVE-plan.
