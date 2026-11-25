# VIFT CRM – kvarstående kända problem, prioriterade (2026-11-26)

Läget gäller STAGING med v3.4. LIVE saknar alla serverändringar sedan 2026-11-24.

**Prioritet:**
- **P1:** kan ge fel data, läcka information eller blockera LIVE.
- **P2:** påverkar vardagsarbete eller förtroende.
- **P3:** förbättring eller teknisk skuld.

**Insats:**
- **S:** under en dag.
- **M:** 1–3 dagar.
- **L:** mer än 3 dagar eller kräver serveromgång med full testning.

## P1 – ska lösas före LIVE

| # | Problem | Följd | Rekommenderad åtgärd | Insats | Beroende |
|---|---|---|---|---|---|
| 1 | **LIVE saknar alla serverändringar**: C-5, ao-time-write v5, time-entries-list, lastChanged-trigger, GO-5–8, store-key-write v5, work-orders-list v3. | v3.x-klienten kräver dem. I LIVE kan alla användare läsa alla nycklar. | Separat LIVE-plan: backup, migrationsordning, EF-versioner, klientpaket, rollback och verifiering. `e2e-test-cleanup` får aldrig följa med. | L | Ditt beslut |
| 2 | **Dubbla AO-nummer**: paret "AO-001" i STAGING. Koden som delar ut numret (`work_order_create`/migration) finns inte i det här repot. | Fel referenser mot kund och faktura. | Hämta in serverkoden. Lägg till unik kontroll och en serie som börjar över högsta befintliga nummer. Historiska nummer ändras inte. Listan visar redan kort id vid krock. | M | Serverkällan |
| 3 | **Intern kommentar skrivs ut på faktura-PDF** trots etiketten "visas ej på faktura". Etiketten är nu ändrad så att den stämmer med beteendet. | Interna anteckningar når kunden. | Besluta: ska den med på PDF:en eller inte? Rätta PDF-genereringen och lägg till ett test. | S | Beslut |
| 4 | **Inget skydd mot att inaktivera sig själv eller sista superadministratören.** | Utelåsning, återställning kräver databasingrepp. | Serverregel i skrivvägen för personal och roller: neka om 0 aktiva med `all` blir kvar. Klientvarning. | S–M | – |
| 5 | **`vift_settings` skrivs som en helhet.** | Två administratörer som ändrar samtidigt skriver över varandra, till exempel färg och bankgiro. | Fältvis sammanslagning eller hash-kontroll för settings i `store-key-write`, samma mekanism som B5. | M | B5 |
| 6 | **Behörighetsbeslut B1–B5** och Ö1–Ö7 (se `BEHORIGHETER-BESLUTSUNDERLAG.md`). | Inköpspriser, aktivitetslogg och portkoder för vissa roller är läsbara. | Beslut, sedan en serveromgång. | M–L | Beslut |
| 7 | **PERM-03/BLOCKER-2**: bara "skapa ny post" är prövat mot riktig STAGING (36/36: 9 register × 4 roller). Ändring och borttagning, hel nyckel, fältnivå och `vift_settings` är inte prövade. **4 databastester (PostgreSQL) har aldrig körts** i testmiljön. | Okänd skrivrätt. Databasregler är bara testade indirekt. | Riktigt rolltest mot STAGING (skriv och återställ per nyckel och roll). Kör PostgreSQL-testerna i en miljö med Postgres, eller mot en STAGING-gren. | M | – |
| 8 | **Standardrollerna saknas i STAGING:s rollregister.** Nya personalposter får rollen `personal`, som inte finns där. | Nya användare får inga behörigheter (felet stänger åtkomsten i stället för att öppna den). Skiljer sig troligen från LIVE. | Definiera rollerna personal, arbetsledare och ekonomi i STAGING och jämför med LIVE (läsning kräver ditt OK). | S | – |

## P2 – påverkar vardagen

| # | Problem | Följd | Åtgärd | Insats |
|---|---|---|---|---|
| 9 | **Kartan**: 0 av 205 aktiva jobb har koordinater. Mapbox-token är troligen låst till crm.viftfast.se. `AddressService` sväljer 401/403. `geocodedAddress` sparas även när geokodningen misslyckas. AO-importen har inte postnummer och ort. | Kartan visar inga jobb. Kartan visar nu orsakerna. | Kontrollera tokenen (DevTools). Engångsgeokodning med journal (beslut). Rätta felhanteringen i AddressService/WorkOrderService. Lägg till postnummer och ort i AO-importen. | M |
| 10 | **Fältpersonal kan inte utföra rondering** (kräver `ao_view_all`). | Rondering kan bara göras av arbetsledare. | Ny behörighet `rondering_utfor` (Ö3). | M |
| 11 | **Besked före serverbekräftelse:** "Ta jobbet" och sparande av personal. | Användaren tror att det sparats. | Vänta på serversvaret, samma mönster som stämpling och material. | S |
| 12 | **Fakturakön:** attest, redan fakturerad, dubbletter och fel kund räknas inte som åtgärdsorsaker. AO med äldre fakturor utan källreferens döljs helt ur kön. | Underlag kan missas. | Utöka `BillingQueueService` med orsakerna och visa äldre fall under Kräver åtgärd. | M |
| 13 | **Lönedata saknas.** Löneunderlaget visar debiterbart värde. CSV-kolumnen heter "Kostnad (SEK)" med punkt som decimaltecken. | Kan tolkas som lönekostnad i lönesystem. | Besluta kolumnnamn och format. Verklig lönekostnad kräver egen lönetabell (B3). | S + beslut |
| 14 | **AO-detaljens knappar är 36–38 px på mobil** (storlekarna `bsm`/`bxs`). | Svårare att träffa med handskar. | Höj minsta höjd på mobil i systemets knappstil. | S |
| 15 | **Bulk-raden ligger över dialoger** och `responsive.css` döljer ⋮ från 640 px på andra listsidor än AO-listan. | Klippt text, dold meny. | Gemensam rättning i `components.css`/`responsive.css`. | S |
| 16 | **"AO-(sparas…)" står kvar** i listan, eftersom `WorkOrdersPage.onSyncStatusChanged` saknas. | Förvirrande tills nästa omritning. | Lägg till hanteraren. | S |
| 17 | **Ljusa varumärkesfärger ger oläslig vit text**, och sidomenyns rubriker har 3,4:1 i kontrast. Logotyper finns bara i webbläsaren. | Tillgänglighet och logotyp på andra enheter. | Automatisk textfärg (backlog), justerade menyrubriker, logotyper på servern. | M |
| 18 | **Kontraktsbelopp** är inte definierade som exkl. eller inkl. moms. | Risk för fel i avtal och fakturering. | Beslut och fält i datamodellen. | S + beslut |
| 19 | **Ej omarbetade vyer:** Ronderingsrapport, offertlistan, säljchanser, kundkortets brödtext. Sidhuvudena på kundkort och fastighetskort radbryts på mobil. | Ojämn standard. | Nästa UI-omgång. | M |
| 20 | **Prestanda:** kundlistan ritar alla rader (192 ms för 543 kunder). | Blir långsamt vid tusentals poster. | Stegvis rendering, som i AO-listan. | S |

## P3 – förbättringar och teknisk skuld

| # | Problem | Åtgärd |
|---|---|---|
| 21 | Tidsformat "2t 30m" i dialoger, Mina jobb och Tid mot "2,5 h" i AO-detaljen | Gemensam formatering i TimeService |
| 22 | Offerttjänster: "Ny tjänst" skapas innan man sparar (Avbryt lämnar en tom post). Prisgrupper aktiveras utan bekräftelse. | Skapa först vid Spara. Bekräftelse. |
| 23 | RUT/ROT på BRF/företag ger bara en upplysning | Affärsbeslut om spärr |
| 24 | Saknade funktioner: fastighetsdokument, bilagor på AO, "tillägg" på AO, `contractId` på AO | Planera i masterplanen |
| 25 | Dagens drift kan inte visa andras instämpling | Serverstöd (läsning per roll) |
| 26 | Dashboardlayouten är per enhet, inte per konto | Produktbeslut: synk via server |
| 27 | Datum- och tidsfält på riktig svensk telefon (F-24) | Manuell kontroll |
| 28 | Testverktyg: RENDER-01 är långsam. Ögonblicksbilden i `e2e-real` kan läsa "ä" fel (falsklarm 2026-11-25). Proxyn i testmiljön tappar ibland enstaka filer. | Dela upp eller cacha, rätta UTF-8-avkodningen i ögonblicksbilden, upprepa hämtningar |
| 29 | Serverkällor saknas i båda repona: `work_order_create`, displayNumber-migrationen, `invoice-write` och `rondering-pass-write` (G1/G4). Migrationerna finns (21 filer här, 24 i `vift-v2`; 20261125000002–04 bara i `vift-v2`). | Hämta källorna från installerade STAGING (läsning) och samla allt i ett repo med fullständig migrationshistorik. Det är en förutsättning för #2. |
| 30 | Testdata: QA-LOAD med flera (cirka 1 000 poster av okänt ursprung), E2E-konton | Beslut om verifierad rensning. Avveckla E2E-konton när uppdraget är klart. |
| 31 | Materialrad med 0 kr (C-6), inte reproducerad | Bevaka |
| 32 | AO-07 (G5) i den simulerade servermodellen. Riktig STAGING är grön (F4). | Uppdatera den simulerade modellen |
