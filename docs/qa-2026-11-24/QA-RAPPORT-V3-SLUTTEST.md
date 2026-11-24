# VIFT CRM V3 – QA-rapport, stort sluttest (STAGING, 2026-11-24)

**Miljö:** https://staging-crm.viftfast.se mot Supabase STAGING `yyzljlqyzzcbxmcdbual`. LIVE har inte lästs, ändrats eller publicerats till.

**Källor:**
- V3-klienten: grenen `claude/vift-v3-major-redesign`, senast 8cab8ac.
- Server och testverktyg: grenen `claude/vift-system-restructure-8fUme`, senast 2ad290a.

**Bilagor:**
- `LASANDE-QA.md` med `bilder/` (läsande granskning med skärmbilder).
- `loggar/` med körrapporter i JSON.
- `../../release/staging-2026-11-24-v3.1/` med manifest för uppdateringspaketet.

---

## A. Sammanfattning

**Är V3 på STAGING stabil?**
Ja, för de flöden vi har kört. Den publicerade V3:n (21/21 filer verifierade) gav:
- inga JavaScript-fel för sex roller (R0, 6 × 6–37 sidor);
- grönt affärsflöde från kund till fakturaunderlag (F6), inklusive belopp, moms och kundkoppling;
- inga dubbletter vid omförsök;
- ett referensläge som återställdes efter varje körning.

**Fungerar huvudflödena?**
Ja. Testet hittade dock tre allvarliga fel som nu är rättade:
- **P0 – fältpersonalens material sparades aldrig på servern** (avvisades med 403). Rättat i STAGING-backend.
- **P0 – lagrad XSS.** Skript i kundnamn, tidkommentarer, adresser m.m. kördes i andra användares webbläsare. Rättat i klienten, men **finns inte på STAGING förrän paket v3.1 laddats upp.**
- **P1 – kundens offertsvar syntes inte för personalen** förrän någon annan ändring skedde. Rättat i STAGING-backend.

**Redo för nästa steg?**
- Fortsatt produktionsförberedelse: **GO**, efter att paket v3.1 laddats upp och verifierats.
- **LIVE: NO-GO**, se F. Den största kvarvarande blockeraren är att alla inloggade roller kan läsa all affärsdata via REST, inklusive offerternas publika tokens.

---

## B. Testresultat

### B1. Verkliga tester mot STAGING i dag (publicerad V3 och riktig Supabase)

| Test | Utfall | Kommentar |
|---|---|---|
| Publicering mot `MANIFEST-v3.txt` | **21/21 identiska** | Omkontrollerat i slutet av dagen. v3.1: 0/18 (inte uppladdat – väntat). |
| R0 – alla sidor per roll, 6 konton | 6/6 utan JS-fel | admin 37, chef 28, ekonomi 15, falt 7, falt2 7, begränsad 6 sidor |
| F6 – kund → offert → kundgodkännande → AO → tid/material/checklista/bild → fakturaunderlag | Sista helgröna körningen: 30/30 (`193024`). Sista körningen totalt: 33 OK / 1 avvikelse (`201233`, F6.16, se C-6). | Varje led beloppskontrolleras (se B3). |
| F7 – kund nekar offert | 2/2 | Status `nekad` med skäl; ingen AO |
| F8 – kund begär ändring | 2/2 | Status `ändring-begärd`; ingen AO |
| F2–F5 – checklista mobil, stämpling mobil → dator, samtidiga loggposter, nätavbrott | Gröna (`172831`) | Exakt en tidpost; inga förlorade loggposter; aldrig "sparad" offline |
| `qa-ao-material` – fältrollens material/start/pool (ny) | 17/17 | Regressionstest för C-1 och C-2 |
| `authz-mutation` – skrivbehörighet per roll | 51 OK / 0 fel | Efter dagens serverändringar |
| `authz-read` – läsbehörighet per roll | 22 OK / 0 fel | AO och tid skyddade; inga skrivningar |
| GO-7 – AO-logg, samtidighet | 11/11 | |
| GO-8a–d – bilagor, AO-bilder, publik offert-PDF, projektdokument | Gröna (körda tidigare i dag, samma backend) | Token A ger bara offert A; återkallad 403; utgången 410; okänd 404; privata buckets |
| Paket v3.1, lokalt serverat mot riktig STAGING | R0 6/6, F6 t.o.m. kundgodkännande | F6.11b-avvikelsen ledde till fynd C-4 |
| Läsande granskning (bredder 360–1920, roller, lagring, prestanda) | 72 sidvisningar, 9 fynd | `LASANDE-QA.md` |

### B2. Simulerade tester (lokal simulerad server, inte STAGING)

| Svit | Utfall |
|---|---|
| E2E, hela sviten (`tests/e2e/run.js`) | 116 godkända, 0 misslyckade, 1 känt gap (AO-07: G5 utan serverstöd i simulatorn), 1 blockerad (PERM-03) |
| XSS-01 (ny) – alla fritextfält förgiftade, 94 sidvisningar för admin/fält/ekonomi | Godkänd efter rättning (före rättning: skript körde på 12 sidtyper) |
| VAT-01 (ny) – momsspärr offert→AO | Godkänd. 25 % blir AO med fastpris 2000 och rätt kund; 12 %, 0 % och blandad moms nekas med förklaring och ingen AO skapas |
| Enhetstester (`tests/run-all.sh`) | 15/19 filer gröna, 0 röda, 4 överhoppade (kräver lokal PostgreSQL; inte godkända) |

### B3. Beloppskontroll i affärsflödet (verklig STAGING)

- **Offert:** 3 952 kr exkl. moms + 988 kr moms = 4 940 kr. Samma i guiden, detaljvyn, kund-PDF:en och kundsidan.
- **AO från offerten:** exakt en, med rätt kund, fastighet och fastpris 3 952. Ett andra försök gav ingen dubblett.
- **Med fältpersonalens material** (2 st × 150 kr): faktureringskön gav 3 952 + 300. Underlaget blev 4 252 kr exkl. moms + 1 063 kr moms (25 %) = 5 315 kr, med rätt kund. Det visade samma summa när det öppnades igen, och erbjöds inte en gång till i kön.
- **Ingen avvikelse** av typen "gamla eller orimligt stora belopp" eller "AO med fel kund" hittades.

### B4. Täckning per modul och roll

| Område | Verkligt STAGING | Simulerat | Inte verifierat |
|---|---|---|---|
| Kunder, fastigheter, kontakter | Skapa via UI, koppla (F6) | CRUD, sök | Redigering och filter i UI mot STAGING |
| Offerter | Skapa (flera rader), bilaga, länk, PDF, godkänn/neka/ändring | Momsspärr | Utskick via e-post (avsiktligt inte testat) |
| Arbetsordrar | Skapa från offert, tilldela, starta, material, checklista, logg, bild, klar; behörigheter | Filter, mass-åtgärder, mobil, logg | Massåtgärder och filterkombinationer mot STAGING |
| Tid och stämpling | In på mobil, ut på dator, en tidpost, rätt kund | Midnatt och sommartid (datumlogik) | Stämpling som pågår *över* sommartidsövergången |
| Fakturering | Kö, underlag, moms, ingen dubbelfakturering, radering av utkast | Moms 25/12/0 per rad, rabatt, ROT/RUT | Delvis markerade grupper mot STAGING |
| Projekt och dokument | GO-8d (uppladdning, URL, behörighet) | – | – |
| Rondering, serviceintervall, återkommande, kalender, sälj, rapporter, import/export | R0 (sidor öppnas utan fel) | Moduler 07–12 i E2E-sviten | Funktionella flöden mot STAGING |
| Roller | Alla sex | Alla | – |

---

## C. Identifierade fel

| # | Prio | Fel | Orsak | Reproduktion | Påverkan | Åtgärd | Status |
|---|---|---|---|---|---|---|---|
| C-1 | **P0** | Fältpersonalens material sparades aldrig | `ao-time-write` `patch_ao` tillät bara klarmarkering för roller utan `ao_edit`, så `{materials}` gav 403 | F6.16 i körning `174555` (0 materialrader på servern) | Material försvann. Kunde inte faktureras. | Snäv regel: `ao_material` får patcha exakt `materials` på en synlig AO som inte är fakturerad, borttagen eller arkiverad | **Installerat i STAGING** (`ao-time-write` v5). Källa i V2-grenen. Test `qa-ao-material` 17/17, F6 grönt. |
| C-2 | P1 | "Starta" (Mina jobb) och "Ta jobbet" (arbetspoolen) misslyckades alltid för fältroll | Samma regel som C-1 | Fältroll: status `pågående` gav 403 | Fältpersonal kunde inte starta jobb eller ta jobb från poolen | Tillåtet bara på egen AO, från rätt status. Vid "Ta jobbet": bara sig själv, och loggen måste innehålla alla befintliga poster. | **Installerat i STAGING.** Ingår i `qa-ao-material`. |
| C-3 | **P0** | Lagrad XSS | Fritext renderades som HTML utan `esc()` på ca 180 ställen | XSS-01 (simulerat). Även verifierat mot STAGING i den läsande granskningen: `alert` kördes. | Fältpersonal (via tidkommentar) eller annan användare kan köra skript i administratörens webbläsare och läsa sessionens JWT | Alla HTML-sänkor går via `esc()`. `esc()` tål tal och kodar apostrof. Text som sparas (logg, toast, export) escapas inte. | **Finns bara i GitHub och paket v3.1 – INTE publicerat** förrän du laddat upp paketet |
| C-4 | P1 | Kundens offertsvar syntes inte för personalen | `offer_respond_commit` (och 4 andra serverfunktioner) uppdaterade inte `vift_lastChanged`, som klienternas synk styrs av | F6.11b: "godkänd" på servern, "utkast" i arbetsledarens klient efter 60 s, så AO gick inte att skapa | Godkännanden, nekanden och ändringsbegäranden syntes inte förrän annan aktivitet skedde | AFTER-trigger på `store` för `vift_offers`, `vift_offerEvents` och `vift_invoices` | **Installerat i STAGING** (migration `20261125000002`). F6–F8 gröna, godkännandet syns direkt. |
| C-5 | P1 (LIVE-blockerare) | Alla roller kan läsa 38 store-nycklar via REST: offerter med publik token, fakturor, kunder, inställningar (bankgiro, internt timpris) | RLS-policyn `store_active_read` släpper igenom alla aktiva användare; `readAllWithHashes` filtrerar inte per roll | `LASANDE-QA.md` fynd 2 (begränsad roll läste 75 offerter, varav 5 med aktiv token) | En fältarbetare kan läsa en offerttoken och svara på offerten "som kunden", och kan läsa kund- och ekonomidata | Förslag: läsbehörighet per nyckel i både RLS och `readAllWithHashes`, och token bort ur store-läsningen för roller utan `offer_manage` | **Inte rättat** (designändring som påverkar alla roller). Se F. |
| C-6 | P2 | Materialrad sparad med 0 kr trots ifyllt pris | Okänd. Ej reproducerad lokalt (10/10 rätt). | 1 av 3 körningar av F6.16 mot STAGING | Liten: faktureringskön spärrar raden ("Saknar försäljningspris"), så ingen felaktig faktura | Följ upp med fler körningar / fältlogg | Öppen |
| C-7 | P2 | STAGING-etiketten täcker rubrik och sökfält; UUID som AO-nummer bryter rader på mobil; stämplingsnycklar med e-post ligger kvar i localStorage efter utloggning; inloggningen gör 5 seriella anrop (5–6 s) | Se `LASANDE-QA.md` fynd 3–9 | – | Kosmetiskt eller liten informationsläcka på delad enhet | – | Öppna |
| C-8 | Testverktyg | e2e-real städar inte fakturautkast, offertbilagor/-händelser och lagringsobjekt | Återställningsmodulen saknar dessa typer | Rest efter F6 | Kräver manuell städning | Städat manuellt med journal (se D3) | Öppen i verktyget |

Tidigare i samma uppdrag rättades två klientfel (F3/F5: stämpling och loggpost i Mina jobb, sondminne). De ingår redan i den publicerade V3:n.

---

## D. Data och säkerhet

### D1. Behörigheter

**Verifierat på servern:**
- AO-synlighet per roll.
- Tidposter: ingen ser andras tid utan lönebehörighet.
- Direkt REST mot AO och tid ger tomt svar.
- Skrivregler per nyckel och roll (51 kontroller).
- Checklistans egen/annans post.
- AO-logg: egen/annans post och samtidighet.
- Material, start och pool per roll.
- Bilagor, AO-bilder och projektdokument per roll, inklusive sökvägsmanipulation och privata buckets.
- Publik PDF: token A ger bara offert A, och återkallad, utgången eller okänd token nekas.
- CORS för de faktiska webbläsaranropen (preflight testad för bild-EF:erna).

**Saknar täckning:**
- Läsning av affärsnycklar per roll (C-5, känd brist).
- `offer-respond` med en token läst av intern användare. Kedjan bygger på verifierade delsteg men kördes inte, eftersom den skulle ändra en offert.
- Rate-limits under last.

### D2. Integritet

Varje skrivande körning tog referenskontrollsummor före och efter. Befintliga affärsposter, inklusive AO med `updatedAt` och tidposter, var identiska efter varje körning ("AFFÄRSPOSTER … identiska").

Slutkontroll mot referensläget från före skrivtesterna (40 nycklar):
- **Identiska (37):** bland annat `workOrders`, `timeEntries`, `customers`, `properties`, `offers`, `invoices`, `offerAttachments`, `offerEvents`, `staff` och `roles`.
- **Lagring:** 14 objekt, samma som i referensen.
- **Stämplingar:** inga aktiva.

Avvikelser:
- `vift_activityLog`: +3 serverskrivna revisionsposter ("Fakturautkast F-089/090/091 raderat") från städningen av testutkasten. Behålls avsiktligt som spår.
- `vift_settings`: ändrades 20:11 UTC av **STAGING-administratörens egen inloggade webbläsarsession** (Windows/Chrome, 23 skrivningar på ca 15 s). Den kom inte från testerna och har inte ändrats tillbaka. Kontrollera att det var du.
- `vift_lastChanged`: metadata.
- `op_idempotency`: +82 poster (idempotenshistorik från testanropen, tas inte bort).

### D3. Städat

- 1 kvarglömd tidpost (via `delete_time`).
- 4 fakturautkast: F-089 från första körningen (journalförd SQL), därefter F-089, F-090 och F-091 (via `invoice-write draftDelete`).
- 8 bilageposter.
- 32 offerthändelser.
- 39 testposter i aktivitetsloggen.
- 12 lagringsobjekt. Borttagna via en tillfällig funktion med exakt sökvägslista, som direkt därefter ersattes med 410-stubben (`vift-admin-storage` v6).

Alla SQL-borttagningar journalfördes först i `public._qa_cleanup_journal_20261124` (RLS på, ingen åtkomst för anon eller authenticated).

**Kvar:** testkunder, testoffert-ID:n och testfastigheter tas bort av e2e-real (verifierat). De sex E2E-kontona finns kvar enligt instruktion.

### D4. Kända säkerhetsluckor

- C-5 (läsåtkomst för alla roller).
- C-3 tills v3.1 är uppladdat.
- JWT i localStorage (kan läsas vid XSS; mildras av C-3).
- Stämplingsnycklar i localStorage efter utloggning (C-7).

---

## E. Publicering

- **På STAGING nu:** V3, alla 21 filer identiska med `release/staging-2026-11-24-v3/MANIFEST-v3.txt`.
- **Nytt paket att ladda upp:** `VIFT-CRM-STAGING-v3.1.zip`
  - 18 filer (index.html + 17 i `src/`).
  - Manifest: `release/staging-2026-11-24-v3.1/MANIFEST-v3.1.txt`.
  - Instruktion: `LAS-MIG.txt` (src/ först, index.html sist).
  - Förprövat som lokalt serverat paket mot riktig STAGING.
  - Innehåller inga LIVE-referenser eller hemligheter. `storage.js`, `AuthService.js` och `config.js` ingår inte.
- **Backend redan installerat i STAGING (behöver ingen uppladdning):**
  - `ao-time-write` v5 (återställningspunkt v3 i `supabase/backup/ef-installerade-2026-11-24/`).
  - Migration `20261125000002_store_lastchanged_bump` (återställning: `DROP TRIGGER store_bump_lastchanged ON public.store`).
  - `vift-admin-storage` är tillbaka som 410-stubb.

---

## F. Slutbeslut

**Fortsatt produktionsförberedelse: GO**, under förutsättning att v3.1 laddas upp och verifieras.

**LIVE: NO-GO.** Kvarvarande blockerare:
1. **C-5:** läsbehörighet per nyckel och roll i store (RLS och `readAllWithHashes`), och publika offerttoken bort från roller utan `offer_manage`.
2. **C-3:** v3.1 måste vara publicerat och XSS-01 grönt mot den publicerade klienten.
3. **Avveckla de sex E2E-kontona och e2e-rollerna** korrekt via Auth-administrationen efter testuppdraget (de skapades via SQL, avvikelse dokumenterad).
4. **Allt som installerats i STAGING i dag måste föras till LIVE** i en separat, godkänd LIVE-plan: `ao-time-write` v5, migrationen för `lastChanged`, GO-5–GO-8-funktionerna.

**Prioriterade åtgärder (max 10):**
1. Ladda upp v3.1 till STAGING. Därefter verifierar jag 18/18 och kör XSS-01, R0 och F6 mot den publicerade versionen.
2. Bekräfta att ändringen av `vift_settings` 20:11 UTC var din egen.
3. Rätta C-5 (läsbehörighet per roll) i STAGING med tester per roll.
4. Låt e2e-real städa fakturautkast, bilagor, händelser och lagringsobjekt automatiskt (C-8).
5. Utred C-6 (materialpris 0 kr) med fler körningar mot STAGING.
6. Funktionella flöden mot STAGING för rondering, serviceintervall, återkommande, import/export och massåtgärder i AO-listan.
7. Ett test för stämpling över sommartidsövergången.
8. Rensa stämplingsnycklarna i localStorage vid utloggning, och parallellisera inloggningens anropskedja (C-7).
9. Avveckla testkonton och e2e-roller när uppdraget är klart.
10. Ta fram en LIVE-installationsplan med backup och återställningsväg för samtliga STAGING-ändringar. Kräver ditt separata beslut.
