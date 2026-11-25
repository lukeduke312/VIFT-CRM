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
| Simulerade tester | __SIM__ |
| Riktig STAGING | __REAL__ |
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

__SIMDETALJ__

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

__REALDETALJ__

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
- **Efter alla prov:** __DATAEFTER__
- **Testdata:** ingenting har raderats (`TESTDATA-INVENTERING.md`). Rensning av QA-LOAD är ett separat beslut.

## 7. Prestanda

Mätt med samma läsande skript mot riktig STAGING-data: publicerad v3.3 före, paket v3.4 efter.

__PERF__

## 8. Leverans

**Paket:** `VIFT-CRM-STAGING-v3.4.zip` med:
- `webbplats/`, som innehåller bara de ändrade klientfilerna;
- `MANIFEST-v3.4.txt` med SHA-256 per fil;
- `LAS-MIG.txt`.

| | |
|---|---|
| Innehåll | __PAKET__ |
| Inte med | `config.js`, `src/data/storage.js`, `src/services/AuthService.js` (STAGING-överlägg) och allt annat oförändrat |
| Cacheversioner | Varje ändrad fil har nytt `?v=` i `index.html` (kontrollerat mot v3.3) |
| Kontroller | Ingen LIVE-referens utöver det befintliga projektskyddet i `AuthService`. Inga hemligheter. `storage.js` pekar på STAGING. |
| Uppladdning | `src/` först, `index.html` sist. Verifiera därefter med `tools/verify-staging-deploy.sh MANIFEST-v3.4.txt`. |
| Rollback | Ladda upp v3.3-paketet igen (PageShells.js + index.html) ovanpå v3.1-filerna. Alternativt: de 30 ändrade filerna från `VIFT-CRM-STAGING-v3.1` och v3.3 tillsammans med v3.3:s `index.html`. De 10 nya CSS-filerna kan ligga kvar, eftersom gamla `index.html` inte refererar dem. Ingen serverändring ingår, så det finns ingen server-rollback. |

## 9. Max 10 prioriteringar framåt

__PRIO__

## 10. GO / NO-GO

| | Beslut |
|---|---|
| Ladda upp v3.4 till STAGING | **GO** __GOVILLKOR__ |
| LIVE | **NO-GO** tills en separat LIVE-plan (C-5, ao-time-write v5, lastChanged-trigger, GO-5–8 och klient v3.x) är godkänd. `e2e-test-cleanup` får aldrig följa med. |
