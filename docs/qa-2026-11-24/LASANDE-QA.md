# Läsande QA — VIFT CRM V3 på STAGING (2026-11-24)

- **Mål:** `https://staging-crm.viftfast.se` mot Supabase STAGING (`yyzljlqyzzcbxmcdbual`). LIVE (`crm.viftfast.se`) har inte rörts.
- **Verktyg:** Playwright/Chromium (headless) via `/home/user/vift-v2/tests/e2e/lib.js` i riktigt läge, egna läsande skript i sessionens scratch-katalog. Service Worker blockerad av harnessen. Externa resurser (Google Fonts, Mapbox) blockeras av harnessen, så "Kartan kunde inte laddas" på dashboarden är **inte** ett appfel.
- **Konton:** e2e-admin, e2e-falt1 (falt), e2e-begransad, e2e-ekonomi. chef och falt2 användes inte.
- **Inga skrivningar gjordes.** Inga spara-, skicka-, radera- eller stämpla-knappar klickades. Inloggningen skickar själv tre POST-anrop: `store-key-write` med `action=readAllWithHashes` och `action=getStampStatus` (läsningar), och `work-order-log-write` med `action=append_log, aoId:''`. Det sista är appens egen kapacitetssondering (`AOTimeSyncService.supportsLogOps`) med tomt AO-id. Den svarar 400 och skriver ingenting.
- **Parallell aktivitet:** en annan process skrev testdata under körningen (offerter 74 → 75, fastigheter 131 → 132). Antal kan därför skilja något mellan avsnitten.

## Miljöproblem (inte appfel)

- Den utgående proxyn tappar ofta enskilda CSS- och JS-filer: `net::ERR_ABORTED`, eller 502 med `text/plain` som Chromium vägrar köra. Jag mätte det med ren Chromium utan harnessens routing: **4 av 8 sidladdningar saknade minst en CSS-fil**. Seriella `curl`-hämtningar av samma fil lyckades 20 av 20 gånger. Ibland svarade proxyn "upstream request failed" även på själva sidan.
- **Följd:** första responsivitetskörningen gav falska larm. Exempel: vid 360 px saknades `responsive.css`, och innehållsytan blev 93 px bred. Skärmbild: `bilder/miljo-css-saknas-360-admin-dashboard.png`.
- **Åtgärd:** alla resultat nedan kommer från omkörningar med en integritetskontroll. Varje egen `<script>`/`<link>` måste ha svarat 200, varje CSS-fil måste ha regler, och centrala globala objekt (Router, Auth, SelectionModel med flera) måste finnas. Annars laddades sidan om, högst 8 gånger.

---

## Sammanfattning av fynd

| # | Allv. | Fynd | Sida | Viewport | Roll | Skärmbild |
|---|---|---|---|---|---|---|
| 1 | **P0** | **Lagrad XSS: ett kundnamn renderas som HTML och JavaScript körs** (`alert(1)` exekverade) | Kunder (lista), Kunddetalj, Tid & stämpla (kundvalet `#mt-customer`) | alla (testat 360 + 1366) | admin; falt på Tid | `bilder/xss-admin-pg-crm-360.png`, `bilder/xss-admin-pg-crm-laptop.png`, `bilder/xss-admin-pg-crm-detail-laptop.png`, `bilder/xss-admin-pg-tid-laptop.png`, `bilder/xss-falt-pg-tid-laptop.png` |
| 2 | **P1** | Alla inloggade roller, även `begransad`, kan via REST läsa 38 store-nycklar. Bland dem: alla offerter med `publicToken` (5 aktiva, 64 tecken), fakturor (86), kunder (543 st, med e-post och telefon), `vift_settings` (bl.a. `internalHourlyCost`, bankgiro) och personal (e-post, telefon). Datan laddas också in i klientens `state` för falt och begransad. | REST `/rest/v1/store` | – | falt, begransad, ekonomi | – |
| 3 | P2 | Inloggningen gör fem anrop i följd: token → readAllWithHashes → getStampStatus → time-entries-list → work-orders-list. Det tar ca 5–6 s till `state.currentUser`. | Inloggning | 1366 / 390 | admin, falt | – |
| 4 | P2 | AO-nummer visas som rått UUID (`AO-faeb91ef-7578-…`) och bryts över två rader på mobil. Två olika AO visas båda som `AO-001`. | Mina jobb, AO-lista, Fakturering | 360, 1024, 1366 | falt, admin | `bilder/uuid-aonummer-360-falt-minajobb.png`, `bilder/oversikt-1024-admin-ao-lista.png`, `bilder/oversikt-1366-admin-fakturering.png` |
| 5 | P2 | Utloggning lämnar kvar `vift_stampActive_<e-post>`, `vift_stampAoId_<e-post>` och `vift_stampTs_<e-post>` i localStorage. Nästa användare på enheten kan se föregående användares e-post och stämplingsstatus. `state.customers/offers/invoices/staff` ligger också kvar i minnet efter utloggning; det syns inte i gränssnittet. | Utloggning | 1366 | alla | – |
| 6 | P2 | Etiketten "STAGING · TESTMILJÖ" täcker sidrubriken på mobil och sökfältet på dator. Gäller bara STAGING. | Alla | 360–1920 | alla | `bilder/oversikt-360-admin-dashboard.png`, `bilder/oversikt-1920-admin-dashboard.png` |
| 7 | P2 | Ändrad `location.hash` i en pågående session byter inte sida. Efter en nekad djuplänk står den förbjudna hashen (t.ex. `#/loneunderlag`) kvar i adressfältet medan dashboarden visas. | Router | 1366 | falt, begransad, ekonomi | – |
| 8 | P2 | Varje session loggar konsolfelet "Failed to load resource: 400" från sonderingen av `work-order-log-write`. Felet är avsiktligt men ger brus i konsolen. | Inloggning | alla | alla | – |
| 9 | P2 | Platshållaren i sökfältet är avklippt ("Sök kund, fa…"). | Fakturering | 1366 | admin | `bilder/oversikt-1366-admin-fakturering.png` |

---

## 1. Responsivitet

Bredder: 360 (android), 390 (iphone), 768, 1024, 1366 och 1920. deviceScaleFactor 1.

Sidor per roll:
- **admin:** pg-dash, pg-ao, pg-ao-detail (AO-001), pg-tid, pg-invoices, pg-offer, pg-crm
- **falt:** pg-dash, pg-ao, pg-ao-detail, pg-myjobs, pg-tid

Sammanlagt 72 sidvisningar efter omkörning.

Kontroller per sida:
- `documentElement.scrollWidth` och `#content-scroll.scrollWidth` jämfört med fönstrets bredd.
- Knappar som ligger helt eller delvis utanför skärmen (utom i horisontella scrollytor).
- Avklippt text i knappar och badges.
- Om `.aod-qbar` överlappar `#mobile-bottom-nav` eller `#mobile-clock-status`.
- Knappar som döljs bakom snabbåtgärdsraden eller bottenmenyn när AO-detaljen är rullad till slutet.
- `pageErrors`.

| Bredd | admin | falt | Snabbåtgärdsrad (AO-detalj, sidans slut) |
|---|---|---|---|
| 360 | OK (7/7) | OK (5/5) | rad 603–667, meny från 683 – ingen överlappning, inga dolda knappar |
| 390 | OK (7/7) | OK (5/5) | admin: rad 527–591, meny 607; falt: rad 493–557, meny 607 – OK |
| 768 | OK (7/7) | OK (5/5) | rad 889–949, meny 967 – OK |
| 1024 | OK (7/7) | OK (5/5) | ingen rad (avsett), ingen bottenmeny |
| 1366 | OK (7/7) | OK (5/5) | ingen rad |
| 1920 | OK (7/7) | OK (5/5) | ingen rad |

- **Horisontell överflöd:** ingen på någon sida eller bredd. **Avklippta knappar:** inga. **JS-fel (`pageerror`):** inga på någon testad sida när sidan laddats komplett.
- **Konsolfel:** på pg-tid och pg-crm loggas `404 /x`. Det kommer från XSS-bilden i fynd 1 (`<img src="x">`).
- **Översiktsbilder:** `bilder/oversikt-360-admin-dashboard.png`, `bilder/oversikt-390-falt-ao-detalj-slut.png`, `bilder/oversikt-768-admin-dashboard.png`, `bilder/oversikt-768-falt-ao-detalj.png`, `bilder/oversikt-1024-admin-ao-lista.png`, `bilder/oversikt-1366-admin-fakturering.png`, `bilder/oversikt-1920-admin-dashboard.png`.

## 2. Rollåtkomst (läsande)

### Direktnavigering med `Router.showPage(...)` på 1366

| Sida | falt | begransad | ekonomi |
|---|---|---|---|
| pg-admin | nekad → dashboard + toast "Du saknar behörighet för den sidan" | nekad | nekad |
| pg-staff | nekad | nekad | nekad |
| pg-invoices | nekad | nekad | **tillåten** (har `invoice_view`) |
| pg-reports | nekad | nekad | **tillåten** (har `reports_view`) |
| pg-payroll | nekad | nekad | nekad |
| pg-offer | nekad | nekad | nekad |
| pg-crm | nekad | nekad | nekad |
| pg-export-center | nekad | nekad | **tillåten** |
| pg-import-wizard | nekad | nekad | nekad |
| pg-articles | nekad | nekad | nekad |
| pg-sales | nekad | nekad | nekad |

Rollernas behörigheter enligt `state.roles`:
- **falt:** dashboard_view, ao_view_own, ao_time, ao_material, ao_checklist, ao_complete
- **begransad:** dashboard_view, ao_view_own
- **ekonomi:** dashboard_view, invoice_view, invoice_create, ao_view_all, reports_view

**Djuplänk före inloggning:**
- falt `#/loneunderlag` → dashboard + toast (nekad).
- begransad `#/admin` → nekad.
- falt `#/fakturaunderlag` → nekad.
- ekonomi `#/fakturaunderlag` → pg-invoices (korrekt).

### REST med rollens token

Anropen var `GET /rest/v1/store?select=key,value&key=eq.<nyckel>` med anon-nyckel och rollens JWT. Endast status och antal redovisas, inga värden.

| Nyckel | falt | begransad | ekonomi |
|---|---|---|---|
| vift_timeEntries | 200, **0 rader** | 200, 0 rader | 200, 0 rader |
| vift_workOrders | 200, **0 rader** | 200, 0 rader | 200, 0 rader |
| vift_staff | 200, 1 rad (9 personer, fälten email/phone) | 200, 1 rad | 200, 1 rad |
| alla nycklar (`select=key`) | 200, 38 nycklar | 200, 38 nycklar | 200, 38 nycklar |

- **Tid och arbetsordrar är skyddade.** RLS blockerar vift_timeEntries och vift_workOrders; datan hämtas i stället via Edge Functions.
  - `time-entries-list` som falt: 200, 0 poster, 0 från annan personal.
  - `work-orders-list` som falt: 200, 53 AO (egna och pool). begransad ser också 53, ekonomi 363.
  - Därmed verkar BLOCKER-1 (lönedata via store) åtgärdad på STAGING.
- **Fynd 2:** de 38 nycklarna som alla roller kan läsa inkluderar `vift_offers`, `vift_invoices`, `vift_customers`, `vift_settings`, `vift_emailTemplates`, `vift_salesOpps`, `vift_contracts`, `vift_priceProfiles`, `vift_properties` och `vift_projects`.
  - Mätt som begransad: 75 offerter, varav 11 har `publicToken` och 5 har en aktiv token (inte återkallad och inte utgången). Det bör bedömas om publik token räcker för att svara på offerten via `offer-respond`.
  - `vift_settings.internalHourlyCost` och bankgiro är satta.
  - `vift_properties.accessCode` och `keyInfo` är tomma i alla 132 fastigheter, så portkoder läcker inte via storen.

### Rollbyte i samma flik

Ordning: admin → utloggning → falt → utloggning → ekonomi → utloggning → begransad.
- Efter varje inloggning är `state.currentUser` rätt användare. Föregående användares tidposter och AO visas inte:
  - admin: 1122 tidposter (alla)
  - falt: 0 tidposter, 53 AO
  - ekonomi: 0 tidposter, 363 AO
  - begransad: 0 tidposter, 53 AO
- Efter utloggning är `currentUser` null, tidposter och AO är 0, och `vift_timeEntries`, `vift_workOrders` och `vift_auth_v2` är borttagna ur localStorage.
- Kvar efter utloggning finns stämplingsnycklarna med e-post i nyckelnamnet samt kunder, offerter, fakturor och personal i minnet (fynd 5).

## 3. Lagring (oautentiserat)

| Bucket | `GET /storage/v1/object/public/<b>/x` | `GET …/public/<b>/` | Lista med enbart anon (POST `object/list`) |
|---|---|---|---|
| offer-attachments | 400 "Bucket not found" | 400 InvalidKey | 200 `[]` |
| workorder-images | 400 "Bucket not found" | 400 InvalidKey | 200 `[]` |
| project-documents | 400 "Bucket not found" | 400 InvalidKey | 200 `[]` |
| vift-branding | 400 "Bucket not found" | 400 InvalidKey | 200 `[]` |

- Inga buckets är publika och inga filer returnerades.
- `GET /storage/v1/bucket` med anon-nyckel ger 400 (kräver authorization).
- Lista som inloggad falt, begransad eller ekonomi gav 200 och 0 objekt i alla fyra buckets. Jag kan inte avgöra om det beror på RLS eller på att buckets saknar objekt i roten.

## 4. Prestanda

Mätt på 1366 (laptop) och 390 (iphone). Väggklocka i testprocessen. Nätet går via testmiljöns proxy, så absoluta tider är högre än för en vanlig användare.

| Mått | laptop admin | laptop falt | iphone admin | iphone falt |
|---|---|---|---|---|
| Kall laddning → inloggningsformulär (inkl. omladdningar vid proxyfel) | 14,6 s | 13,9 s | 3,3 s | 47,5 s* |
| Inloggning: klick → `state.currentUser` | 6,2 s | 5,6 s | 5,7 s | 6,1 s |
| Klick → dashboard renderad | 6,2 s | 5,6 s | 5,7 s | 6,1 s |
| Navigering till pg-ao (lista renderad) | 111 ms | 36 ms | 91 ms | 40 ms |
| Sök i AO-listan ("AO-0", 60 ms/tecken): uppdatering efter sista tecknet | 4 ms | 2 ms | 4 ms | 5 ms |
| Öppna AO-detalj | 36 ms | 20 ms | 31 ms | 20 ms |
| Supabase-anrop vid inloggning | 5 | 5 | 6 (inkl. sondering 400) | 5 |
| Anrop vid pg-ao / sök / AO-detalj | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Misslyckade anrop (≥400), exkl. sondering och `/x` | 0 | 0 | 0 | 0 |
| Dubbletter i samma navigering | inga | inga | inga | inga |
| JS-heap efter tvingad GC före → efter 20 sidbyten (CDP `usedSize`) | 7,39 → 7,92 MB (+0,53) | 5,74 → 5,90 MB (+0,16) | 7,46 → 7,99 MB (+0,53) | 5,79 → 5,96 MB (+0,17) |
| `performance.memory.usedJSHeapSize` (kvantiserat) | 11,2 → 11,2 MB | 10,0 → 10,0 MB | 11,2 → 11,2 MB | 10,0 → 10,0 MB |

\* 4 omladdningar på grund av "upstream request failed" och tappade filer (miljöfel).

- **Inloggningens anropskedja (laptop admin):**
  - `auth/v1/token` startar efter 48 ms och tar 947 ms.
  - `store-key-write` (readAllWithHashes) startar efter 1000 ms och tar 1761 ms.
  - `store-key-write` (getStampStatus) startar efter 2798 ms och tar 967 ms.
  - `time-entries-list` startar efter 3767 ms och tar 1111 ms.
  - `work-orders-list` startar efter 4896 ms och tar 1177 ms.
  - Anropen körs strikt efter varandra, och dashboarden visas först när alla är klara (fynd 3).
- **Sidbyten (admin, 20 st):** de flesta tar 45–135 ms. **pg-invoices är långsammast med 340–480 ms.**
  - falt: 11–66 ms per sidbyte.
  - Under 20 byten gjordes ett Supabase-anrop (`GET /rest/v1/store`, bakgrundssynk).
- **Minne:** ingen tydlig läcka. Heapen ökar 0,2–0,5 MB efter 20 byten, vilket motsvarar cache av renderade sidor.

## 5. Visuell konsekvens (konkreta defekter)

- **Fynd 1:** trasig bildikon och texten `" onmouseover="alert(2)` syns i kundlistan på mobil. Se `bilder/xss-admin-pg-crm-360.png`.
- **Fynd 4:** UUID som AO-nummer bryts över två rader i Mina jobb på 360 px (`bilder/uuid-aonummer-360-falt-minajobb.png`). Två olika AO visas som `AO-001` i AO-listan på 1024 (`bilder/oversikt-1024-admin-ao-lista.png`).
- **Fynd 6:** STAGING-etiketten täcker sidrubriken ("Dashboard", "Kunder", "Offerter", "Tid & stämpla") på 360 och 390, och sökfältet "Sök i VIFT…" på 1024, 1366 och 1920. Gäller bara STAGING.
- **Fynd 9:** avklippt platshållare i sökfältet på Fakturering vid 1366.
- Inga problem med kontrast eller saknade ikoner hittades på de granskade skärmbilderna. Kartan och typsnittet Inter saknas eftersom harnessen blockerar externa resurser.

## Var XSS-fyndet sitter (för åtgärd)

- Testposten är kund `K-83939dfe-…` med namn `ZZZ-QA-E2E-20261117-XSS…`. Namnet innehåller `<img src=x onerror=alert(1)>` och `" onmouseover="alert(2)`.
- Hittade renderingar, i lokal källkod som motsvarar V3:
  - `src/pages/TimePage.js:260` – `<option …>${CustomerService.displayName(c)}</option>` utan `esc()`. Chromium tolkar `<img>` inuti `<option>`, och `onerror` körs.
  - `src/pages/CustomersPage.js:187` – `<div class="item-title">${name}</div>` utan `esc()`.
  - Kunddetaljen (pg-crm-detail) kör också skriptet. Exakt rad är inte lokaliserad.
- Datafält i `state` som innehåller HTML-taggar: `customers[].name`, `workOrders[].log[].text`, `activityLog[].description`, `activities[].note` och `ronderingspass[].internalNote`.
  - AO-detaljen med loggposten, Aktiviteter, AO-listan, Dashboard och Mina jobb körde **inte** skript i testet.
- Sessionens JWT ligger i `localStorage['vift_auth_v2']` och kan därför läsas av injicerat skript.

## Kunde inte testas / avgränsningar

- Riktiga mobila webbläsare (Safari/iOS, Firefox) – bara Chromium-emulering.
- Service Worker-läge – blockerat av harnessen.
- Mörkt läge och mätning av kontrast i pixlar.
- Detaljsidor för offert och faktura, samt rollerna chef och falt2 – inte inom tidsramen.
- Om publik offerttoken faktiskt räcker för `offer-respond` – det skulle kräva ett skrivande anrop.
- Läsning av konkreta lagringsobjekt med giltiga sökvägar – inga kända sökvägar, och listning gav 0 objekt.
- Absoluta prestandatider – påverkas av testmiljöns proxy, som tappar en stor andel resurser. De relativa måtten är jämförbara: antal anrop, ordningen i anropskedjan och sidbyten utan nät.
