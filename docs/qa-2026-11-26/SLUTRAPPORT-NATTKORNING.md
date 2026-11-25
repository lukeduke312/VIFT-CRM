# VIFT CRM – nattkörningen UI/UX, funktionalitet och kvalitet: slutrapport (2026-11-26)

**Miljö:**
- STAGING: `staging-crm.viftfast.se`, Supabase `yyzljlqyzzcbxmcdbual`.
- **LIVE är inte läst, ändrad eller publicerad.**

**Klientgren:** `claude/vift-v3-major-redesign`, se commit i paketets manifest.

**Leverans:** paket **v3.4** (se avsnitt 8). Det är inte uppladdat; uppladdning görs av dig via WinSCP.

## 1. Sammanfattning

| | |
|---|---|
| Omarbetade vyer | 34 av 37 sidor, plus dialoger, guider och kort. Se avsnitt 3. |
| Högst prioriterat | **AO-detalj:** en primär åtgärd per status, kompakt stämpling, Uppdrag & utförande med checklista, eget prissättningskort. **Fakturering:** kompakt kö per kund, tydliga belopp exkl./inkl. moms. |
| Rättade fel | 5 funktionsfel (avsnitt 4.2), alla med regressionstest som underkänns mot gammal kod. Dessutom XSS-härdning i mallar och fel som respektive arbetsblock rättat. |
| Simulerade tester | **216 av 218 godkända, 0 misslyckade** (hela sviten på slutkoden e08ea75; 1 blockerad PERM-03, 1 känt fel AO-07). `tests/run-all.sh`: 15/19 gröna, 0 misslyckade, 4 överhoppade (ingen lokal PostgreSQL). |
| Riktig STAGING | **Alla flöden gröna** med paket v3.4: R0 (6 roller), X1 (4 roller), A1 (dator+mobil), F2–F5, F6 hela affärsflödet (28 kontroller), F7, F8; C-5 26/26. Städning fullständig, affärsposter identiska. |
| Data mot referensläget | Identisk, efter återställning av en oavsiktlig ändring som mitt eget skript orsakade (avsnitt 6). |
| Säkerhet | Inget försvagat. XSS-skyddet är kvar och har utökats. C-5 26/26 mot riktig STAGING. Fem beslutspunkter (B1–B5). |
| Beslut | **GO** för uppladdning av v3.4 till STAGING. **NO-GO** för LIVE tills en separat LIVE-plan är godkänd. |

## 2. Före- och efterbilder

Alla bilder finns i `docs/qa-2026-11-26/fore-efter/<område>/`, med före och efter vid 390/1366 px och för de flesta även 360/768/1920 px. Varje område har bilder med realistiskt innehåll: många poster, långa namn, alla statusar och flera roller.

| Område | Mapp | Beskrivning |
|---|---|---|
| Publicerad STAGING före (referens) | `publicerad-fore/` | Från den publicerade v3.3 |
| Dashboard | `dashboard/` | Anpassa-läget, widgetar, kartans orsaker |
| AO-lista | `aolist/` | 10/100/1 000 AO, massändring, dubblettnummer |
| AO-detalj | `aodetail/` | Alla statusar × 4 roller, fältflödet steg för steg på 390 px |
| Fakturering | `billing/` | Kö 100/1 000 kandidater, Kräver åtgärd, underlag i alla statusar |
| Offerter | `offers/` | Detalj i alla statusar, guiden steg 1–4 dator och mobil |
| Serviceintervall | `service/` | Före: trasigt sökfält, mörka kort. Efter: rättat. |
| Register | `register/` | 7 register vid 1920/1366/390 |
| Övriga sidor | `misc/` | Fastighetskort, kalender, rondering, projekt, kontrakt, import/export |
| Fältsidor | `falt/` | Mina jobb, Tid & stämpla, Dagens drift, Återkommande |
| Admin, rapporter, lön | `admin/` | 11 avsnitt, rapporter, löneunderlag |

## 3. UI/UX-status per vy

Gradering:
- **Genomarbetad:** omarbetad enligt V3-komponentstandarden, granskad med realistiskt innehåll, mobil och dator, och har egna tester.
- **Användbar:** fungerar och är konsekvent, men inte omarbetad i den här körningen.
- **Kvar:** behöver arbete.

| Vy | Status | Kommentar / test |
|---|---|---|
| Dashboard | Genomarbetad | Anpassa-läge med Spara/Avbryt/Återställ, dra och släpp, Flytta upp/ned på mobil, Liten/Halv/Hel. Personligt per användare och enhet. Kartan redovisar orsakerna separat. DASH-E-01–11. |
| Arbetsorder-lista | Genomarbetad | "Visar 150 av 356" med Visa fler/Visa alla. Status och snabbval i separata grupper. Massändring bara på synliga rader. Sorterbara kolumner. AOL-01–09. |
| Arbetsorder-detalj | Genomarbetad | 5A–5E. Inga åtgärder borttagna, 155 par jämförda. AOD-01–09 inkl. fältflöde 390 px. |
| Fakturering – kö | Genomarbetad | Per kund → fastighet → AO → underlag, med kryssruta i tre lägen. Vald summa skild från köns total. Filtret Kräver åtgärd visar orsak. BILL-01–11. |
| Fakturaunderlag | Genomarbetad | Rader exkl. moms med momssats, avstämning mot summor, öresavrundning, statushjälp. BILL-05/09. |
| Offerter – detalj | Genomarbetad | En primär åtgärd per status, belopp exkl./moms per sats/inkl. 32_offers. |
| Offertguide | Genomarbetad | Fyra steg med granskning och livesummering. Alla radtyper, BRF, RUT/ROT. OFFW-01–03. |
| Offerter – lista | Användbar | Bara XSS-rättning (titel). |
| Serviceintervall | Genomarbetad | Sökfältet, fokus och mörka kort rättade. SVC-UI-01. |
| Kunder, Fastigheter, Artiklar, Prisgrupper, Personal, Offerttjänster, Uppgifter | Genomarbetad | Gemensam verktygsrad, högst 1 440 px bred på 1920, tabell som blir kort per rad. REG-UI-01–11. |
| Kundkort | Genomarbetad (huvud, kontakt) | Kompakt huvud, ring/maila med ett tryck (MISC-CUS-REACH-01). Brödtexten är äldre layout. |
| Fastighetskort | Genomarbetad | Hierarki, flikarna radbryts i stället för att döljas, portkod enligt behörighet. MISC-PROP-*. |
| Objekt, Projektkort, Projekt, Kontrakt | Genomarbetad | Gemensamt detaljhuvud, V3-listor. |
| Kalender | Genomarbetad | Vecka och dag som läsbar lista på mobil. |
| Rondering, Ny rondering, Utför rondering | Genomarbetad | Kontrast ≥ 4,5:1, stegindikator. |
| Ronderingsrapport | Kvar | Inte omarbetad. |
| Importera, Importlogg, Exportcenter | Genomarbetad | Ryms på 360 px. AO-importens id-dubbletter rättade (IMP-03). |
| Mina jobb, Tid & stämpla, Dagens drift, Återkommande | Genomarbetad | Idag/Kommande/Arbetspool, stämpling skild från start, validering vid fälten. FALT-01–10. |
| Admin | Genomarbetad | 11 avsnitt i 6 grupper. Teknik och underhåll skilt från användarinställningar. ARP-*. |
| Rapporter, Löneunderlag | Genomarbetad | Kontrast 6,1:1, tabeller blir kort per rad på mobil, "Debiterbart värde" i stället för "lönekostnad". |
| Säljchanser | Användbar | V3 sedan tidigare, inte ändrad. |

Komponentstandard: `docs/V3-KOMPONENTSTANDARD.md`. Medvetna avvikelser:
- Admin har grupperad sidomeny på dator.
- Belopp i fakturering visas med öre, för avstämning.

## 4. Tester

### 4.1 Simulerad server (lokal testmiljö)

| Körning | Resultat |
|---|---|
| Hela sviten, slutkod e08ea75 (= paketets kod) | **216 godkända, 0 misslyckade, 1 blockerad, 1 känt fel av 218** (1 588 s) |
| Blockerad PERM-03 | Per-nyckel-skrivbehörighet i `store-key-write` för generiska nycklar kan inte modelleras i den simulerade servern (känt sedan tidigare, BLOCKER-2) |
| Känt fel AO-07 | Samtidiga loggposter (G5) i den simulerade modellen. Mot riktig STAGING är det grönt (F4). |
| `tests/run-all.sh` | 15/19 filer gröna, 0 misslyckade, 4 överhoppade (kräver PostgreSQL). Offertparitet 120 offerter, 0 avvikelser. |
| Under sammanfogningen | Efter varje sammanfogning kördes riktade specar. Hela sviten kördes efter 4 och 8 block (168/170 respektive 203/206). Felet efter 8 block (AOD-09) var en väljarkrock mellan två block och är rättat. |

- Nya tester i natt: ett 100-tal. Flaggor: DASH-E, AOL, AOD, BILL, OFFD/OFFW, REG-UI, MISC, FALT, ARP, SVC-UI, IMP-03, SYNC-ED-01, TIME-08, MISC-CUS-REACH-01.
- Volymer simulerades:
  - 10/100/1 000 AO: rendering 176 ms och sökning 202 ms vid 1 000.
  - 100/1 000 fakturakandidater: kompakt rendering 9,9 ms vid 1 000.
  - 100+ poster per register.
- Inga stora datamängder har skapats i STAGING.

### 4.2 Fel som hittades och rättades (alla med regressionstest som underkänns mot tidigare kod)

| Fel | Följd | Test |
|---|---|---|
| Serviceintervall: SVG i sökfältets placeholder-attribut | Attribut och SVG syntes som text, fältet var trasigt. Sökningen tappade fokus och korten var mörka i mörkt läge. | SVC-UI-01, RENDER-01 |
| AO-import: alla importerade AO fick samma id när ett UUID-id fanns | Riktiga id-dubbletter. STAGING hade inga sådana i dag (kontrollerat). | IMP-03 |
| Synken ritade om offertguiden var 15:e sekund | Osparade ändringar i en befintlig offert försvann. | SYNC-ED-01 |
| Stämpling på annan enhet ritade inte om Tid & stämpla | Fel sid-id, så sidan visade "Inte instämplad". | TIME-08 |
| Lagrad XSS i offertlistan (titel) och fler mallar | Skript kunde köras från fritext. | XSS-01, RENDER-01 |

### 4.3 Riktig STAGING (paketet v3.4 serverat lokalt mot riktig STAGING-server)

Paket v3.4 serverat lokalt, med all datatrafik mot riktig STAGING-server. LIVE är inte kontaktat (kontrollerat: "inga anrop till andra Supabase-projekt").

| Flöde | Resultat |
|---|---|
| R0 sex roller (admin 37, chef 28, ekonomi 15, fält 7+7, begränsad 6 sidor) | 6/6, inga JS-fel |
| X1 lagrad XSS (riktig QA-kund med HTML), 4 roller, 91 sidvisningar | Inget skript kördes |
| A1 Admin, dator och mobil | 11 avsnitt, ikoner som SVG, ingen markup som text |
| F2 checklista · F3 stämpling två enheter · F4 samtidiga loggposter · F5 nätavbrott | Gröna |
| F6 kund → fastighet → kontakt → offert via nya guiden → bilaga → PDF → kundgodkännande → AO (ingen dubblett) → tilldelning → stämpling → material → checklista → bild → klar → fakturakö → underlag → ingen dubbelfakturering | 28/28. Offert 3 952 + 988 = 4 940 kr. Underlag 4 252 + 1 063 = 5 315 kr, rätt kund. |
| F7 kunden nekar · F8 kunden begär ändring | Gröna, ingen AO skapad |
| C-5 läsbehörighet (`c5-read`) | 26/26 |

**Avvikelse under arbetet (öppet redovisad):**
- Första körningen av F6 avbröts vid F6.4. Testverktyget letade efter "Spara offert" i steg 3, men den nya guiden har knappen i steg 4 (Granska).
- Testverktyget är uppdaterat (`vift-v2` f82419f, även för den kompakta fakturakön) och omkört: grönt.
- Det var ett fel i testverktyget, inte i produkten.

## 5. Säkerhet

Se `SAKERHET-DEL10.md`.

**Läget i STAGING:** tidposter, fakturor, offerttoken, personnummer, intern timkostnad, bankgiro och portkoder är skyddade på servern (C-5 och time-entries-list).

**Gjort i natt:**
- Mer escaping i mallar.
- Personalens Inaktivera kräver nu `staff_manage`.
- "Rensa lokal cache" kräver `admin_manage` och varnar för osynkade ändringar.
- Push-diagnostiken visar inga nycklar.

**Inget försvagat:** XSS-skyddet är kvar, och inga behörigheter är breddade.

**Beslutspunkter:**
- B1: inköpspriser för fält.
- B2: timpriser (behåll).
- B3: personalregister.
- B4: aktivitetslogg.
- B5: fältvis sammanslagning för portkoder.

**Att bekräfta:**
- "Starta arbete" i AO-detaljen för tilldelad fältarbetare. Det är samma villkor och samma serveranrop som Mina jobb, ingen ny behörighet.
- Fältrollen saknar `ao_complete` och `ao_view_all` (rondering), vilket är ett rollbeslut.

## 6. Data mot referensläget

- **Före paketproven:** 35 av 36 nycklar var identiska med referensläget (`REFERENSLAGE.md`).
- **Avvikelsen:** `vift_activities`. Mitt eget skärmbildsskript hade markerat ACT-006 och ACT-007 som klara (2026-11-24 22:28–22:29 UTC, konto `e2e-admin`).
  - Återställt med journal: posterna öppnades igen exakt som appens "Öppna igen".
  - Kontrollsumman är verifierad lika med referensen (`5b55cf10f640`).
  - Se `HANDELSE-ACT-006-007.md`. Skriptet är avstängt.
- **Efter alla prov:** - **Verksamhetsnycklar:** alla identiska med referensläget (md5 per nyckel).
- **`vift_activityLog`:** +14 poster, alla från testkörningarna. Det är händelser för `[E2E-TEST]`-poster från testkontona och revisionsposten för det raderade testutkastet F-090. De behålls som revisionsspår, som vid tidigare körningar.
- **Övrigt:** `vift_lastChanged` och `updated_at` är metadata. Testfilerna i lagringen (offertbilaga, AO-bild) är städade.
- **Testdata:** ingenting har raderats (`TESTDATA-INVENTERING.md`). Rensning av QA-LOAD är ett separat beslut.

## 7. Prestanda

Mätt med samma läsande skript mot riktig STAGING-data: publicerad v3.3 före, paket v3.4 efter.

| Mått (riktig STAGING-data: 363 AO, 543 kunder, 87 underlag, 1 122 tidposter) | v3.3 publicerad | v3.4 paket |
|---|---|---|
| Inloggning admin / fält | 19,5 s / 16,5 s | 7,7 s / 6,8 s (*) |
| Dashboard | 28 ms | 26 ms |
| AO-lista | 62 ms | 79 ms |
| Fakturering | 257 ms | **36 ms** |
| Kunder | 76 ms | **192 ms** (**) |
| Offerter | 53 ms | 67 ms |
| Serviceintervall | 17 ms | 9 ms |
| AO-detalj / fakturaunderlag | 36 / 20 ms | 38 / 21 ms |
| Fält: Mina jobb / Tid | 22 / 21 ms | 3 / 14 ms |
| Minne (heap) | 20 MB | 14 MB |
| JS-fel | 0 | 0 |

(*) Går inte att jämföra. v3.4 serverades lokalt och v3.3 via webbhotellet och testmiljöns proxy. Inloggningen domineras av nätet.

(**) Kundlistan ritar nu alla 543 rader med fler kolumner (org.nr, kontakt, fastigheter, öppna AO). Räkningen är linjär, en gång per visning. Tiden ligger under 200 ms. Stegvis rendering är en möjlig förbättring.

Simulerade volymer:
- 1 000 AO: rendering 176 ms, sökning 202 ms inklusive 120 ms paus.
- 1 000 fakturakandidater: kompakt rendering 9,9 ms och Välj alla 17 ms.

## 8. Leverans

**Paket:** `VIFT-CRM-STAGING-v3.4.zip` med:
- `webbplats/`, som innehåller bara de ändrade klientfilerna;
- `MANIFEST-v3.4.txt` med SHA-256 per fil;
- `LAS-MIG.txt`.

| | |
|---|---|
| Innehåll | 40 filer: `index.html`, 29 ändrade JS/CSS-filer och 10 nya CSS-filer (`src/styles/v3-*.css`). ZIP-filen innehåller också `aterstallning-v3.3/`, de 30 filer som ersätts, kontrollerade 30/30 identiska med publicerade STAGING. ZIP SHA-256 `b3d7333bad9c9448e3542f35d2837ac43a0b03e99e520793dca51580e7277ad2`. Finns i `release/staging-2026-11-26-v3.4/`. |
| Inte med | `config.js`, `src/data/storage.js`, `src/services/AuthService.js` (STAGING-överlägg) och allt annat oförändrat |
| Cacheversioner | Varje ändrad fil har nytt `?v=` i `index.html` (kontrollerat mot v3.3) |
| Kontroller | Ingen LIVE-referens utöver det befintliga projektskyddet i `AuthService`. Inga hemligheter. `storage.js` pekar på STAGING. |
| Uppladdning | `src/` först, `index.html` sist. Verifiera därefter med `tools/verify-staging-deploy.sh MANIFEST-v3.4.txt`. |
| Rollback | Ladda upp `aterstallning-v3.3/webbplats/` ur ZIP-filen: `src/` först, `index.html` sist. Det är exakt de filer som ligger publicerade i dag (verifierat 30/30). De 10 nya CSS-filerna kan ligga kvar. Ingen serverändring ingår, så ingen server-rollback behövs. |

## 9. Max 10 prioriteringar framåt

1. **Ladda upp v3.4.** Säg till, så verifierar jag 40/40 mot manifestet och kör R0/A1/X1 mot den publicerade versionen.
2. **Kartan:** kontrollera Mapbox-tokenens domänbegränsning för STAGING. Besluta om en engångsgeokodning, eftersom inget aktivt jobb har sparade koordinater (`KARTA-UTREDNING.md`).
3. **Behörighetsbeslut:**
   - B1–B5 i `SAKERHET-DEL10.md`;
   - fältrollens `ao_complete`/`ao_view_all`;
   - "Starta arbete" i AO-detaljen för tilldelad fältarbetare.
4. **LIVE-plan** för alla STAGING-serverändringar och klient v3.x, med backup och återställning. Kräver ditt separata beslut.
5. **AO-nummer:** servern delar ut dubbletter (paret "AO-001"). Unik kontroll och en serie som börjar över högsta befintliga nummer behövs. Visningen skiljer dem redan åt.
6. **Löneunderlag:** verklig lönekostnad kräver lönedata. Besluta om CSV-exportens kolumnnamn "Kostnad (SEK)", eftersom ett lönesystem kan läsa filen.
7. **Kvarvarande vyer:**
   - Ronderingsrapport;
   - offertlistan;
   - kundkortets brödtext;
   - stegvis rendering av långa registerlistor.
8. **Inställningar:**
   - ljusa varumärkesfärger ger oläslig vit text (automatisk textfärg står på backloggen);
   - `vift_settings` skrivs som en helhet, så samtidiga administratörer kan skriva över varandra;
   - logotyper finns bara lokalt.
9. **Affärsregler att besluta:**
   - kontraktsbelopp exkl. eller inkl. moms;
   - skydd mot att inaktivera sig själv eller sista superadmin;
   - RUT/ROT på BRF/företag (i dag bara upplysning);
   - "Intern kommentar" som skrivs ut på faktura-PDF.
10. **Testdata:** besluta om verifierad rensning av QA-LOAD (`TESTDATA-INVENTERING.md`). Avveckla E2E-kontona när uppdraget är avslutat.

## 10. GO / NO-GO

| | Beslut |
|---|---|
| Ladda upp v3.4 till STAGING | **GO** — prövat mot riktig STAGING (alla flöden gröna), 0 misslyckade simulerade tester, ingen serverändring, återställningsfiler verifierade 30/30 |
| LIVE | **NO-GO** tills en separat LIVE-plan (C-5, ao-time-write v5, lastChanged-trigger, GO-5–8 och klient v3.x) är godkänd. `e2e-test-cleanup` får aldrig följa med. |
