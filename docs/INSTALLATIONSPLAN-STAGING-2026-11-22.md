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

### 2c. Databasstädning `vift_activityLog` (separat GO)

`vift_activityLog` i STAGING innehåller ett dubblett-id (`ACT-1793611007122`) som gör att **varje** skrivning av aktivitetsloggen avvisas av `store-key-write` (`duplicate_id_in_store`). Följd: aktivitetsloggen har inte sparats i STAGING sedan 2026-11-02 och varje användaråtgärd skickar ett anrop som alltid misslyckas. Orsaken i koden är redan rättad (id med slumpsuffix). Städningen kräver en riktad datafix enligt staging-repots `PLAN_activitylog_dedup_2026-11-12.md` (finns inte i detta repo).

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

---

## 6. GO/NO-GO per del

| Del | Status |
|---|---|
| §2a Klientfiler | **GO för STAGING-granskning** — kodklart, 172 lokala kontroller + 120 offertjämförelser gröna, webbläsarsmoke utan JS-fel. Installation kräver separat GO. |
| §2b Bildobjekt + 3 EF | **GO för STAGING-granskning** — `tsc --strict` OK. Kräver separat GO. |
| §2c activityLog-städning | **VÄNTAR PÅ TEST** — plan finns i staging-repot, inte granskad här. |
| §3 service-monitor-aktivering | **VÄNTAR PÅ TEST** — testlista ovan. |
| Molnstämpling S3 (dubbel utstämpling) | **VÄNTAR PÅ TEST** — serverbeteende G6. |
| G4/G5 append-log | **BLOCKERAD** — backendkälla saknas i repot. |
| G7 historisk bildmigrering | **PLANERAD** |

## 7. LIVE senare

LIVE (`hjplzjsbbowiyoyhdghc`, Loopia) kör en äldre klient och saknar sannolikt allt i §1 (ao-time-write, RPC:er, RESTRICTIVE-policyer, stamp_status, store-key-write, work-orders-list m.fl.). Denna klient kan **inte** gå till LIVE förrän samma backend är installerad där, i samma ordning som STAGING fick den, med backup före varje migration. Det kräver G4 (källorna i repot) och en egen LIVE-plan.
