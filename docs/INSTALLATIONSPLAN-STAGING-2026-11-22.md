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

**Exakt omfång (läsande jämförelse mot driftsatt STAGING 2026-11-23):** 27 versionsatta filer är nyare i repot och 4 finns bara i repot; ingen fil är äldre i repot än i STAGING. Nyare: `components.css`, `storage.js`, `state.js`, `AuthService.js`, `WorkOrderService.js`, `TimeService.js`, `AOTimeSyncService.js`, `BillingQueueService.js`, `RecurringOrderService.js`, `ServiceIntervalService.js`, `ImportExportConfigs.js`, `ImportWizardPage.js`, `ExportCenterPage.js`, `Modal.js`, `Sidebar.js`, `Router.js`, `CustomersPage.js`, `WorkOrdersPage.js`, `WorkOrderDetailPage.js`, `TimePage.js`, `InvoicesPage.js`, `RecurringPage.js`, `PropertyDetailPage.js`, `PageShells.js`, `ReportsPage.js`, `RonderingUtforandePage.js`, `RonderingWizardPage.js`. Bara i repot: `tokens.css`, `reset.css` (fick `?v=1`), `WorkOrderImageService.js`, `ServiceIntervalsPage.js`. Dessutom `index.html` och `public-offer.html`. Webbläsartestets rättningar i dessa filer listas i `docs/E2E-RAPPORT-2026-11-23.md` §3.

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

Ingen ny migration behövs för §2a–2b. `20261120000001_PROPOSAL_push_subscriptions_index.sql` är fortfarande overifierat mot STAGING:s indexlista — kontrollera `pg_indexes` först.

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
- [ ] E10 Samtidiga loggposter från två enheter (G5) — förväntas fortfarande tappa en post.

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
- **G5** En loggändring skickas som `patch_ao` med AO:ns **hela** `log`-array. Två enheter som lägger till loggposter i samma AO samtidigt kan tappa en. Kräver en `append_log`-åtgärd i `ao-time-write` (kan inte byggas utan G4).
- **G6** Dubbel utstämpling (S3) bygger på att servern deduplicerar `create_time` per idempotensnyckel över enheter — dokumenterat i klientkoden men inte verifierat mot servern.
- **G7** Historiska inbäddade bilder i `vift_workOrders` gör varje AO-ändring ~46× dyrare i WAL (uppmätt lokalt). Migrering kräver egen plan + GO.
- **G8** Negativt "att betala" är möjligt i offert om radernas RUT/ROT-belopp överstiger totalen (OfferCalc har ingen spärr; fakturan har det). Kräver beslut om valideringsregel i offertredigeringen.
- **G9** Ekonomirollen (`invoice_create` utan AO-behörighet): att sätta AO-status "fakturerad" nekades av den simulerade `ao-time-write`. Verkligt serverbeteende okänt (G4) — testfall E3.
- **G10** ROT/RUT från en godkänd offert följer inte med till fakturautkastet; ekonomi måste lägga till avdraget manuellt och inget varnar. Kräver beslut (automatisk överföring eller varning).
- **G11** DataSync pausar medan fokus står i ett inmatningsfält — även sökfält. Uppdateringar från andra enheter syns först när fokus lämnas.
- **G12** ~35 äldre sparvägar (persist() utan argument: t.ex. kontaktpersoner, teknisk info, artikelkategorier, säljchansstatus) visar fortfarande "Sparat" innan servern svarat. Ett globalt skyddsnät visar nu en tydlig varning om servern nekar, men framgångsbeskedet hinner synas först. Kritiska vägar (serviceintervall, offertlänk, roller, personal, rondering, import) är rättade.
- **G13** `store-key-write`:s behörighet per generisk nyckel är okänd (BLOCKER-2) — PERM-03 är blockerad tills den prövats mot STAGING (E2).

---

## 6. GO/NO-GO per del

| Del | Status |
|---|---|
| §2a Klientfiler | **GO för STAGING-installation (efter separat GO)** — 88 webbläsartester i Chromium (alla 32 moduler; 86 godkända, 0 misslyckade, 1 blockerad i väntan på STAGING, 1 känt serverberoende gap G5), 20 verifierade fel rättade, enhetstester gröna, läsande STAGING-kontroll 11/11. Klientsidan är redo att prövas mot riktig backend; den är **inte** verifierad mot riktiga serversvar. |
| §2b Bildobjekt + 3 EF | **GO för STAGING-granskning** — `tsc --strict` OK. Kräver separat GO. |
| §2c activityLog-städning | **UTGÅR** — uppgiften om dubblett var felaktig (verifierat 0 dubbletter). |
| §3 service-monitor-aktivering | **VÄNTAR PÅ TEST** — testlista ovan. |
| Molnstämpling S3 (dubbel utstämpling) | **VÄNTAR PÅ TEST** — serverbeteende G6. |
| G4/G5 append-log | **BLOCKERAD** — backendkälla saknas i repot. |
| G7 historisk bildmigrering | **PLANERAD** |

## 7. LIVE senare

LIVE (`hjplzjsbbowiyoyhdghc`, Loopia) kör en äldre klient och saknar sannolikt allt i §1 (ao-time-write, RPC:er, RESTRICTIVE-policyer, stamp_status, store-key-write, work-orders-list m.fl.). Denna klient kan **inte** gå till LIVE förrän samma backend är installerad där, i samma ordning som STAGING fick den, med backup före varje migration. Det kräver G4 (källorna i repot) och en egen LIVE-plan.
