# AO-listan (pg-ao) – nattkörning 2026-11-26

Arbetsblock: AO-lista. Filer: `src/pages/WorkOrdersPage.js` (v74), `src/styles/v3-aolist.css` (v2), `index.html` (endast `?v=`), nytt test `tests/e2e/specs/26_aolist.js`, selektor i `tests/e2e/specs/18_checklist.js` (CHK-03).
`src/services/SelectionModel.js` är **inte** ändrad.

Allt är prövat mot den simulerade servern (`tests/e2e`). Ingen trafik mot STAGING eller LIVE, inga data ändrade.

Grundstrukturen är kvar: verktygsrad, statusflikar, snabbval, tabell som blir kompakta kort på mobil, kortvy och statusbyte direkt i listan. Ingen funktion är borttagen.

## 1. Begränsad lista (150 rader) – tydlig och nåbar

**Före**
- Listan ritade högst 150 rader (`PAGE = 150`).
- Rubriken: "356 ordrar · visar 150". Längst ned: "Visa fler (206 av 206 till)".
- "Välj alla" markerade alla som matchade, även de 206 som inte var utritade. Det syntes inte.

**Efter**
- Resultatraden säger "Visar X av Y" (V3-komponentstandarden §5):
  - "Visar alla 14 aktiva arbetsordrar"
  - "Visar 150 av 356 aktiva arbetsordrar"
  - "Visar 12 av 356 aktiva arbetsordrar" (filter/sökning)
  - "Visar 150 av 300 som matchar (av 356 aktiva arbetsordrar)"
- Sidfoten när listan har fler än 150:
  - "Visar 150 av 800 arbetsordrar"
  - knapparna "Visa 300 till" och "Visa alla 800" (eller "Visa alla 356 (206 till)")
  - när allt visas: "Visar alla 800 arbetsordrar"
- "Välj alla":
  - Gäller nu de rader som visas: "Välj de 150 som visas", eller "Välj alla (14)" när allt visas.
  - Hela urvalet markeras med en egen knapp: "Markera alla 356 som matchar".
  - Bulk-baren säger då "356 arbetsordrar markerade · 206 ej utritade i listan".
- Sök, filter och antal gäller alltid hela urvalet, som förut.

**Prestanda (AOL-06, headless Chromium, simulerad server)**

Datorn delades med andra agenters testkörningar (4 kärnor, belastning ~4,5), så tiderna varierar upp till ca 2×.

| Mätning (ms) | 10 AO | 100 AO | 1 000 AO |
|---|---|---|---|
| Första rendering av listan | 27 | 52 | 176 |
| Statusbyte | 7 | 16 | 98 |
| Snabbval på | 13 | 22 | 61 |
| Sökning, 6 tecken: från sista tecknet till uppdaterad lista (inkl. 120 ms paus) | 137 | 151 | 202 |
| Antal omritningar för 6 tecken | 1 | 1 | 1 |
| Endast rendering av sökresultat | 17 | 35 | 68 |
| Visa alla (834 aktiva rader vid 1 000) | 21 | 78 | 412 |

Siffrorna kommer från den sista hela körningen (§9). En separat körning av AOL-06 gav vid 1 000 AO: rendering 92 ms, sökning 186 ms och Visa alla 303 ms.

- Budget vid 1 000 AO: rendering < 1 500 ms och sökning < 300 ms. Båda klarades.
- Jämförelse före ändringen (samma typ av data, mätskript i scratchpad):
  - 1 000 AO: rendering 80 ms, statusbyte 72 ms.
  - Sökningen ritade om listan **en gång per tangent**: 6 omritningar, 135 ms totalt.
  - Nu: en omritning efter 120 ms paus. Fördröjningen 120–200 ms följer komponentstandarden.

Övriga förbättringar:
- Uppslag via index (`getCu`/`getObj`/`getStaff`) i stället för `state.properties.find` per rad.
- Sorteringsnycklar räknas en gång per post, inte per jämförelse.
- Synligt AO-nummer (`displayNumber`) är nu sökbart. Förut söktes bara `id`, så "AO-345" hittades inte för AO med UUID-id.

## 2. Filterhierarki

**Före**
- Statusflikar och snabbval låg i två rader utan rubrik.
- Aktiva avancerade filter låg i en egen rad. "Rensa" rensade bara en del.

**Efter**
- **Status** (märkt rad): segmentkontroll på dator och `select` på mobil.
  - Statusarna: Aktiva, Nytt, Pool, Planerad, Pågående, Klar, Fakturerad.
  - Arkiv och Papperskorg är lägen och står avskilda efter ett streck. I `select` ligger de i gruppen "Övrigt".
- **Snabbval** (märkt rad): chips (Mina, Idag, Försenade, Akuta, Otilldelade, Att fakturera) med antal och tydligt på/av-läge.
- **"Visar bara:"** visas när något avgränsar listan. Där står status (om annan än Aktiva), snabbval, personal, kund, fastighet, kategori och sökningen.
  - Varje filter har ett × för att ta bort det.
  - "Rensa filter" återställer till Aktiva, utan snabbval, filter eller sökning. Sorteringen behålls.
- Kombinationerna fungerar som förut. Logiken är flyttad oförändrad till `_statusFilter`, `_narrowFilter` och `_searchFilter`:
  - "Mina" och "Otilldelade" utesluter varandra.
  - Navigering från dashboarden med `filter=akut` m.fl. fungerar som förut.
- Filterpanelen ("Filter") har samma innehåll. Rubriken heter nu "Snabbval", och "Försenade" räknas med samma regel som chipset (`isOverdue`). Förut användes `scheduledDate < idag`, vilket gav ett annat antal.
- "⋮"-menyn (Importera, Exportera hela listan) syns nu på alla bredder.
  - Förut doldes den från 640 px av `responsive.css`. Då fanns import och export av hela listan inte alls på dator.
  - Ikonen är "⋮" och `aria-label` är "Fler åtgärder".

## 3. Massmarkering och massåtgärder

Regel: **en massåtgärd omfattar aldrig tyst rader som filtret eller sökningen döljer.**

Markeringen ligger kvar över filterbyten, som förut (SPRINT1 §7, SelectionModel oförändrad). Men varje åtgärd delar markeringen i två delar:
- markerade som matchar nuvarande filter och sökning: ingår;
- dolda: ingår inte.

Urvalet räknas om vid åtgärden, inte från en gammal rendering.

Vad användaren ser:
- **Bulk-baren:** "3 arbetsordrar markerade · 1 dold av filtret ingår inte". Baren uppdateras vid varje filterbyte.
- **Ändra status:**
  - Dialogen: "Ändra status på 2 arbetsordrar". Den visar "Gäller 2 arbetsordrar: AO-003, AO-006" och, i en gul ruta, "1 markerad döljs av nuvarande filter och ingår inte: AO-007".
  - Bekräftelsen:
    - titeln "Ändra status på 2 arbetsordrar";
    - "Ny status: [Pågående]" och "Ändras (2): …";
    - vilka som redan har statusen och vilka som hoppas över (låsta eller utanför behörighet);
    - knappen "Ändra status på 2".
  - Antalet räknas med en läsande förhandsvisning (`_bulkStatusPlan`) med exakt samma villkor och ordning som `_bulkSetStatus`. Beskedet efteråt ("2 arbetsorder uppdaterade till "Pågående".") stämmer därför med bekräftelsen.
  - Om inget ändras visas "Ingen ändring" med orsak och bara knappen Stäng.
- **Lägg till personal:** "Lägg till personal på N arbetsordrar". Dialogen visar vilka AO som ingår och vilka som döljs. Knappen heter "Lägg till på N arbetsordrar".
- **Export:** gäller bara markerade som matchar. Ett besked säger hur många som inte exporteras.
- **Alla markerade dolda:** beskedet "Ingen av de markerade arbetsordrarna syns med nuvarande filter — inget ändras", och ingen dialog öppnas.
- **Skrivvägarna är oförändrade:** `_bulkSetStatus`, `_bulkAddStaff`, `AOTimeSyncService.bulkPatch` och `_reportBulkRejections`. "Klar" går fortfarande inte att sätta i bulk.

Mobil:
- "Markera" (även i kortvyn på dator) visar kryssrutor till vänster på varje rad, med 44 × 44 px tryckyta. Förut lades kryssrutan ovanpå avatarerna.
  - Ett tryck på raden markerar i stället för att öppna.
  - "Välj alla" visas i markeringsläget.
- Bulk-baren radbryter sin text i stället för att klippa den med "…".
- Baren läggs under öppna dialoger. Förut låg den (z-index 8000) ovanpå dialogens statusval på mobil.
- Listan får luft nedtill så att sista raden och sidfoten inte hamnar under baren.

Tangentbord:
- Enter på en rad öppnar AO:n, som förut.
- Mellanslag markerar eller avmarkerar raden.

## 4. Dubblerade AO-nummer

**Så tas det synliga numret fram**

Det sker alltid via `WorkOrderService.displayNumberOrPending(ao)` (`src/services/WorkOrderService.js`, rad ~63):
1. `ao.displayNumber`, som servern tilldelar vid skapandet i RPC:n `work_order_create`. Enligt kodkommentarerna sker det i migreringen `20261020000001_ao_display_number.sql`.
2. Annars "AO-(sparas…)" medan skapandet väntar på servern (`_pendingSync`).
3. Annars `ao.id`. Äldre AO har korta id som "AO-001", nyare har `AO-<uuid>`.

Klienten räknar aldrig fram något displayNumber. Två olika AO kan visa samma etikett om:
- (a) två poster har samma `displayNumber`, eller
- (b) en äldre post utan displayNumber har id "AO-001" medan en nyare har displayNumber "AO-001", eller
- (c) två poster har samma id.

**STAGING** (uppgift från samordnaren, läst utan ändring): exakt ett par.
- id `AO-001` (titel "GTE", skapad 2026-07-23)
- id `AO-bfc37f77-…` ("TEST-R9B – Kontroll av arbetsorder", skapad 2026-10-22)
- Båda har `displayNumber` "AO-001". Det är fall (a).

**Generatorn**
- Källan till nummergeneratorn (migreringen och `ao-time-write`/`work_order_create`) finns **inte** i repot (gap G4). Den kan därför inte granskas eller testas här.
- Mönstret i STAGING tyder på detta:
  - Bakfyllningen gav den äldre posten numret från dess id ("AO-001").
  - Den nya serien började på 1 utan att ta hänsyn till redan använda nummer.
- Detta är en slutsats, inte verifierat.
- Förslag (kräver serverändring och test, **inte gjort**):
  - en unik constraint på display_number;
  - en sekvens som startar över högsta befintliga nummer;
  - kontroll mot befintliga id-nummer.
- Befintliga nummer ska inte ändras.

**Åtgärd i listan (visning, inget lagrat ändras)**
- När samma synliga nummer förekommer på flera AO som användaren får se, visas ett kort internt id bredvid numret:
  - "AO-001 **id AO-001**"
  - "AO-001 **id bfc37f**"
- Bara vid kollision. Övriga rader ser ut som förut.
- Om sex tecken inte räcker förlängs id:t (10 tecken, sedan hela id:t).
- Om två poster har exakt samma interna id (fall c) blir märket rött och tooltipen säger att det är ett datafel.
- Märket finns i tabellen, i kortvyn och i mobilens datumrad. Det kommer också med i dialogernas listor ("AO-001 (id bfc37f)").
- Söker man på det korta id:t hittar man rätt post.
- `WorkOrdersPage.labelInfo(ao)` returnerar `{ label, tag }` för andra vyer. AO-detaljens rubrik ägs av ett annat arbetsblock och är inte ändrad (se §8).

**Annan risk funnen i koden (inte ändrad, inte min fil)**
- `ImportWizardPage._createNew` ger arbetsordrar id med `newId(arr, 'AO')`, som läser alla siffror i varje id som ett tal.
- När en AO med UUID-id finns blir resultatet samma id, t.ex. `AO-3.777479345946342e+21`, för **varje** importerad rad. Det är återskapat i Node med `AO-001` och `AO-bfc37f77-…`.
- Det ger riktiga id-dubbletter, inte bara visningsdubbletter.
- Förslag: använd `WorkOrderService._newAoId()` för `workOrders` i importen, på samma sätt som kunder, fastigheter och objekt redan använder `newSafeId()`.

## 5. Kolumner, sortering, tilldelning, märken, kort/lista

- **Sorterbara kolumnrubriker:** Uppdrag (AO-nummer, numeriskt), Kund och plats, Planerat och Status.
  - Pilen ↑ eller ↓ visas och `aria-sort` sätts.
  - Ett andra klick vänder ordningen.
  - AO utan datum, kund eller nummer hamnar sist i båda riktningarna.
- **Sorteringsväljaren** följer med och har korta etiketter (Standard, Datum ↑/↓, Ändrad, Prioritet, AO-nr ↑/↓, Kund A–Ö/Ö–A, Status). Förut klipptes "Planerat datum" i väljaren på 360/390 px. Standardsorteringen är oförändrad: prioritet, sedan senast skapad.
- **Personal (F-22):** avatarerna överlappar inte längre. Förut klipptes "SL" bakom "EA".
  - Upp till tre syns. Fler visas som två plus "+N", så kolumnen räcker alltid.
  - Otilldelad AO visar "Ingen" på dator.
- **Märken:**
  - Status: `sbdg`. Prioritet: Akut/Hög som märke och färgad vänsterkant.
  - Kortvyn hade en blå vänsterkant på AO med normal eller låg prioritet, vilket inte motsvarade något. Den är borttagen, så kanten betyder samma sak i lista och kort.
- **Saknade fält:** "Utan titel" (grå kursiv) och "—" för kund. Långa kundnamn och adresser kapas med "…" och visas i sin helhet som tooltip.
- **Lista/Kort:** växlaren står i resultatraden på alla bredder, med text på dator och ikoner med `aria-label` på mobil. Förut fanns den bara i verktygsraden på dator och var dold på mobil.
- **Tryckytor på mobil:** minst 40 px (komponentstandarden §2). Det gäller:
  - verktygsraden (Filter, ⋮, Ny order, sortering);
  - snabbval, statusväljare, "Visar bara"-chipsens ×, Rensa filter;
  - Markera, Lista/Kort och kryssrutorna (44 px).
  - På 360 px döljs Filter-knappens ikon så att sorteringsvalet ryms.
- **Snabb öppning är oförändrad:** ett klick eller tryck öppnar AO:n direkt (AOL-08: 56–63 ms från klick till detaljvy). Tillbaka ger samma status, filter och sökning.
- **Säkerhet:**
  - AO-id skrivs inte längre in i inline-hanterare (`onclick="…('AO-…')"`). Det läses ur `data-sel-row-id`.
  - Statusmenyn binder med `addEventListener`.
  - Filterpanelens personal- och kategori-id läses ur data-attribut.
  - Synligt AO-nummer och datum escapas.

## 6. Skärmbilder

Katalog: `docs/qa-2026-11-26/fore-efter/aolist/`, 390 och 1366 px, deviceScaleFactor 1, simulerad server.

| Vy | Före | Efter |
|---|---|---|
| Lista (demodata) | `fore-{390,1366}-lista.png` | `efter-{390,1366}-lista.png` |
| Kortvy | `fore-*-kortvy.png` | `efter-*-kortvy.png` |
| Filter (Klar + Att fakturera) | `fore-*-filter.png` | `efter-*-filter.png` |
| Markering (3 rader) | `fore-*-markering.png` | `efter-*-markering.png` |
| Statusdialog i bulk | `fore-*-massandring.png` | `efter-*-massandring.png` |
| Stor lista (356 aktiva) | `fore-*-stor-lista.png`, `fore-*-stor-lista-slut.png` | `efter-*-stor-lista.png`, `efter-*-stor-lista-slut.png` |
| Dubblerat AO-nummer (sök "AO-001") | `fore-*-dubblettnummer.png` | `efter-*-dubblettnummer.png` |

Bara efter:
- `efter-*-markering-dold.png`: en markerad dold av filtret.
- `efter-*-massandring-bekrafta.png`: bekräftelsen "Ändra status på 2".
- `efter-*-realistisk-{lista,slut,markera}.png`: 360 AO med alla statusar, långa titlar och kundnamn, saknade fält och dubblettnummer.
- `efter-*-sortering.png`
- `efter-*-kortvy-realistisk.png`

## 7. Tester

Nya i `tests/e2e/specs/26_aolist.js`:

| Id | Vad |
|---|---|
| AOL-01 | 800 aktiva: "Visar 150 av 800", sidfot, Visa 300 till → 450, Visa alla → varje aktiv AO nåbar. "Välj de 150 som visas" markerar exakt 150. "Markera alla 800 som matchar" markerar 800 (inga fakturerade eller arkiverade). Sökning med och utan begränsning. Litet urval utan sidfot. |
| AOL-02 | Hierarkin (etiketter, flikar och chips i var sin grupp). Planerad + Akuta + sökning ger rätt antal (beräknat i testet från indata). Ta bort enskilda filter. Mina/Otilldelade utesluter varandra. Rensa filter. Navigering med `filter=akut`. |
| AOL-03 (arbetsflöde) | Tre markerade, filtret döljer en. Bulk-baren och dialogen säger vilka. Bekräftelsen "Ändra status på 2". **Servern** ändrar bara de två. Fallet "har redan statusen" ger "Ändra status på 1". Alla dolda → ingen dialog. Lägg till personal på 1 av 2 (servern kontrolleras). Exportens avgränsning. |
| AOL-04 | Sortering via rubriker (Planerat, Uppdrag, Status) och väljare (Kund), riktning, pil, `aria-sort`, tomma sist. |
| AOL-05 | STAGING-fallet AO-001 ×2 och två UUID med samma prefix → unika synliga etiketter i lista, kort och mobil. Sök på kort-id. `labelInfo()`. Servern har oförändrade `id` och `displayNumber`, och inga AO-skrivningar sker. |
| AOL-06 | Prestanda 10/100/1 000 AO (tabellen i §1), budget vid 1 000. |
| AOL-07 | 360, 390, 768, 1024, 1366 och 1920 med 100 realistiska AO: ingen sidledsrullning i lista, kort, filter, arkiv, papperskorg eller markeringsläge. Vy-växlare och ⋮ finns överallt. Sorteringsvalen ryms. Avatarer överlappar inte. Kryssrutor ≥ 40 px och inte ovanpå avatarer. "Utan titel". |
| AOL-08 | Klick och Enter öppnar AO:n, Tillbaka behåller filter och sökning, mellanslag markerar. |
| AOL-09 (arbetsflöde) | 390 och 360, arbetsledare, 100 realistiska AO: hitta sitt jobb (Mina + sök), öppna och tillbaka, filtrera (statusväljare + Idag), Markera tre, filter döljer två, bulk-baren klipps inte, Åtgärder-menyn och dialogen ryms, knappar ≥ 40 px. Servern ändrar exakt de synliga. |

Ändrat befintligt test:
- **CHK-03** (`18_checklist.js`) letade upp AO-listans rad via `onclick`-attributet som innehöll AO-id:t. Id:t ligger nu i `data-sel-row-id`, så testet letar via det. Kontrollen av pågående-segmentet i raden är densamma.

Körda delmängder under arbetet, alla godkända:
- 04_workorders: 20 godkända + AO-07 känt fel (G5).
- 16_stabilization, 18_checklist, 20_v3_mobil.
- 17_map (UI-BDG-01), PERF-01, XSS-01, RENDER-01, BRAND-01, VAT-01.
- AOL-01–09.

Hela sviten och `tests/run-all.sh`: se §9. Den hela körningen innehåller alla specar ovan (AOL-01–09, 04, 16, 17, 18, 20, RENDER-01, XSS-01, BRAND-01, VAT-01, PERF-01), körda mot slutlig kod.

## 8. Inte gjort / beslut som behövs / förslag till andra arbetsblock

- **Nummergeneratorn i servern (§4):** kräver serverändring, migrering och test. Inte gjort. Inga befintliga nummer är ändrade.
- **AO-detaljens rubrik** (annat arbetsblock): kan visa samma kort-id vid kollision via `WorkOrdersPage.labelInfo(getAO(id)).tag`.
- **ImportWizardPage `newId` för AO** (§4): riktig id-kollision vid import när UUID-AO finns. Inte min fil.
- **Bulk-baren på andra sidor:** samma problem med z-index över dialoger och "…"-klippning på mobil finns på alla listsidor. Här är det åtgärdat bara för `pg-ao`, med CSS i `v3-aolist.css`. En gemensam rättning hör hemma i `components.css` och `responsive.css`.
- **`responsive.css`** döljer `.ao-overflow-btn` från 640 px på alla sidor. Här är det upphävt bara för AO-listan.
- **`WorkOrderService` anropar `WorkOrdersPage.onSyncStatusChanged`**, som inte finns. Listan ritas därför inte om när servern bekräftat en ny AO, och "AO-(sparas…)" står kvar till nästa omritning. Inte ändrat (beteendeändring utanför uppdraget).
- **Bredd på 1920 px:** tabellen använder hela bredden. Med 8 kolumner blir det inte tomt (`efter`-bilderna togs bara i 390 och 1366; 1920 är kontrollerad i AOL-07 och med en separat skärmbild under arbetet).
- **Prestandasiffrorna** är från headless Chromium på en delad maskin utan nätverkslatens. De är inte uppmätta i STAGING.

## 9. Slutkörning

Körd mot slutlig kod (commit `4b1bee1`; efter den har bara dokumentation och skärmbilder ändrats).

- **Hela E2E-sviten** (`node tests/e2e/run.js`): 130 tester.
  - 128 godkända, 0 misslyckade.
  - 1 blockerad: PERM-03, känd (BLOCKER-2, kräver STAGING).
  - 1 känt fel: AO-07, gap G5.
  - Tid 979 s.
- **PERF-01** (3 000 AO) i samma körning: AO-listan 250 ms.
- **`bash tests/run-all.sh`:** 15 av 19 testfiler gröna, 0 misslyckade.
  - 4 hoppades över eftersom det inte finns någon lokal PostgreSQL: `checklist_progress_sql`, `server_rpcs_sql`, `staging_backup_export` och del 2–3 av `offer_attachment_upload`.
  - De är alltså inte körda, och inte godkända.
- **`index.html`:** `src/pages/WorkOrdersPage.js?v=74` (förut 73) och `src/styles/v3-aolist.css?v=2` (förut 1). `static_checks.test.js`: 5/5.
- `tests/e2e/report/*` är inte committade.
