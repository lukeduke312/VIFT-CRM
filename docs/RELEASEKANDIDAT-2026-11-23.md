# VIFT CRM — Releasekandidat för STAGING (2026-11-23)

Branch: `claude/vift-system-restructure-8fUme`. Allt nedan är byggt och testat **lokalt**: Chromium mot en simulerad backend, enhetstester och en läsande kontroll av den publika STAGING-deployen. **Inget är installerat, deployat eller verifierat i STAGING eller LIVE.** Ingen databas, RLS, schemalagt jobb eller e-post har rörts.

Utvecklingsomgången avslutas här. Efter att Etapp B/C frystes gjordes bara tre rättningar, alla med dokumenterat skäl. Slutkontrollens visuella regression visade tre fel som mina egna UI-ändringar hade orsakat (se A1, UI-*). Inga nya funktioner har lagts till.

Statusord i rapporten:
- **BYGGD** — kod finns i branchen.
- **LOKALT TESTAD** — automatiskt test som underkänns mot föregående kod.
- **STAGING-VERIFIERAD** — prövad mot riktig STAGING-backend. Ingen punkt har den statusen.
- **LIVE** — driftsatt i produktion. Ingen punkt har den statusen.

---

## A. Funktioner

### A1. Rättat

Varje rättning nedan reproducerades först. Varje rättning har ett regressionstest som underkänns mot den gamla koden.

| Id | Problem (reproducerat) | Rättning | Test | Status |
|---|---|---|---|---|
| G12 | Många sparvägar sa "Sparat" innan servern svarat: kontakter, teknisk info, besiktningar, anteckningar, offerter, artiklar, prisgrupper, admin, uppgifter, avtal, projekt, säljchanser, återkommande ärenden och ronderingsutkast. Ett serveravslag syntes som en sen varning. | `confirmPersist` (ändring redan gjord i state) och `commitElementChange` (ändra, sedan vänta). Båda visar "Sparar…" och ger besked först efter ACK. Vid avslag återställs serverns version, och osäkra utfall hålls kvar med Återuppta/Kasta. Ett busy-skydd per post stoppar dubbelklick. `_vfWarnUnconfirmed` varnar för vägar som inte konverterats. | G12-01 + tidigare OFF-04, ROLE-02, STAFF-02, ADMIN-01, SVC-* | LOKALT TESTAD |
| G10 | ROT/RUT från en godkänd offert försvann tyst på fakturautkastet. | Fakturan visar offertens avdrag och kan förifylla det. "Skickad" spärras (`tax_reduction_review`) tills avdraget lagts till eller "Kontrollerat: inget avdrag" valts. Systemet gör inga antaganden om avdragsrätt; ekonomi beslutar. Dessutom räknas fakturans ROT nu på arbete inkl. moms, som i offerten (ECO-01). | G10-01, ECO-01 | LOKALT TESTAD |
| G8 | Offert med RUT/ROT-rader större än totalen gav negativt "att betala". Det syntes både i CRM och på kundsidan. | `OfferCalc.validate()` stoppar sparande och utskick med ett tydligt besked. Kundsidan (`public-offer.html`) visar en varning i stället för totaler och ingen Godkänn-knapp. Samma kod används i CRM, kundvy och faktura. | G8-01; paritet 120 offerter (10 ogiltiga får varning, 0 avvikelser) | LOKALT TESTAD |
| G5 | Två enheter som lägger till loggposter i samma AO kan tappa en, eftersom hela `log`-arrayen skickas. | Klienten använder `append_log`/`remove_log` och sonderar stödet en gång per session. Om servern svarar `400 unknown_action`, som STAGING gör idag, används den gamla vägen och beteendet är oförändrat. | AO-07B (atomisk väg), AO-07 (gamla vägen: känt fel kvar) | Klient LOKALT TESTAD. **Serverdel saknas**, se A3. |
| MODAL-01 | Avtal och e-postmallar gick inte att skapa: `Modal.open` ignorerade `ok`/`okLabel`, så OK-knappen var död. | `Modal.open` gör om `ok` till en knapp. | MODAL-01 | LOKALT TESTAD |
| ATT-01/02 | Bilagornas metadata (namn, beskrivning, synlighet, PDF) sparades aldrig. Radering var död eftersom `Modal.confirm` inte gick att vänta på. | `_patchAttachment` (PATCH till `offer-attachment-upload`); dialogen stängs bara vid lyckad sparning. `Modal.confirm` returnerar ett löfte. | ATT-01, ATT-02 | Klient LOKALT TESTAD. EF-ändringen är **inte deployad**. |
| MAP-01 | Två AO på Vasaplatsen 8 ritades på exakt samma punkt, så den ena doldes. | `MapGrouping`: samma normaliserade adress ger en markör med antal och en lista med status och Öppna-knapp. Olika adresser grupperas aldrig ihop. Platser närmare än 25 m sprids 18 m isär. Räknaren visar jobb, platser och hur många som saknar position. | MAP-01, `map_grouping.test.js` (9) | LOKALT TESTAD |
| CAL-02 | Överlappande AO i kalendern ritades ovanpå varandra. | Banor sida vid sida; titlar radbryts. | CAL-02 | LOKALT TESTAD |
| RESP-ANDROID | Min första tabbregel kapade fliken "Serviceintervall" på Android; regressionstestet fångade det. | Regeln gäller bara från 640 px och uppåt. | RESP-* 5/5 | LOKALT TESTAD |
| UI-KV-01 | Funnet i slutkontrollen: `kv` staplade etikett och värde på mobil, så säljkorten blev ~20 % högre. | `kv` gäller bara från 768 px. | UI-KV-01 | LOKALT TESTAD |
| UI-PROP-01 | Funnet i slutkontrollen: rubriken i fastighetskortets åtgärdsrad kapades på mobil. | På mobil visas bara numret; namnet visas på dator. | UI-PROP-01 | LOKALT TESTAD |
| UI-BDG-01 | Funnet i slutkontrollen: "Redo fakturering" var fortfarande ett fyllt chip, trots att granskningsloggen sa att det var rättat. | Ljust statusmärke. | UI-BDG-01 | LOKALT TESTAD |

Tidigare samma dag (Leverans I, se `docs/E2E-RAPPORT-2026-11-23.md`) rättades 20 verifierade fel, bland annat portkodsläckor, dubbla AO-skrivningar, kö vid återanslutning, exportcentret, rapporternas "Fakturerat" och inloggningens autofokus. De ingår i releasekandidaten.

### A2. Byggt

- Designstandard (`docs/DESIGNSTANDARD.md`) med tokens och gemensamma regler. Se B.
- STAGING-verifieringsskript `tests/e2e/staging-authz.js` för G13, G9 och G6. Se A4.
- Visuellt verktyg `tests/e2e/visual.js`: `capture` (30 vyer × laptop och mobil, även tomma lägen med `VIFT_VISUAL_EMPTY=1`), `compare` (pixeljämförelse) och `sheet` (kontaktark).
- Serverförslag för G5 (migration + beskrivning) och PATCH i `offer-attachment-upload`. Båda finns bara i repot.

### A3. Kritiska problem som kvarstår

| Id | Problem | Varför det inte är löst |
|---|---|---|
| **G13 / BLOCKER-2** | Okänt om `store-key-write` kontrollerar behörighet per register. En fältarbetare kan i värsta fall skriva till `vift_offers`/`vift_customers` via direktanrop. | Serverkällan finns inte i repot (G4). Det kan bara avgöras mot den riktiga servern. Simulerade tester räknas inte som bevis. PERM-03 är därför **blockerad**. |
| **G9** | Ekonomirollen fick inte sätta AO-status "fakturerad" i simuleringen. Det verkliga beteendet är okänt. | Samma som ovan. Klienten säger nu tydligt till och rullar tillbaka. Behörigheter har **inte** öppnats. |
| **G6** | Dubbel utstämpling från två enheter ska ge exakt en tidpost. Det bygger på att servern deduplicerar `create_time` på idempotensnyckel. | Overifierat mot servern. |
| **G5 (server)** | Atomisk loggpost kräver en ändring i `ao-time-write`. | **Exakt vad som saknas:** källkoden för `ao-time-write` (och dess `_shared`-moduler och migrationskedja) finns inte i detta repo eller i någon gren av staging-repot (G4). Förslaget finns i `supabase/migrations/20261123000001_PROPOSAL_work_order_log_ops.sql` och `docs/G5-APPEND-LOG.md`. |
| G4 | Backendkällor (`ao-time-write`, `store-key-write`, `work-orders-list`, `invoice-write`, `rondering-pass-write`) finns bara deployade. | Kräver att källorna hämtas och committas efter granskning. Ingen hemlighet får följa med. |
| G7 | Historiska inbäddade bilder gör varje AO-ändring ~46× dyrare i WAL. | Kräver egen migreringsplan, backup och GO. |
| G11 | DataSync pausar medan fokus står i ett sökfält. | Planerad; inte prioriterad i denna omgång. |
| BLOCKER-1 | Lönedata. | Serverläsvägen är stängd i STAGING (RESTRICTIVE-policy). Ingen ändring i denna omgång. |

### A4. Kräver test i riktig STAGING

1. **J1** `node tests/e2e/staging-authz.js --jag-har-go`, med testkonton för fält, chef, ekonomi och en begränsad roll. Det ger svaret på G13 och G9.
   - Inga data ändras. G13 tar bort ett id som inte finns. G9 skickar `patch_ao` med oförändrade värden.
   - Undantag: en tillåten skrivning kan uppdatera tidsstämpeln `updated_at`, och möjligen aktivitetsloggen beroende på serverns implementation.
   - G6 körs bara med `--med-testdata`. Den skapar en märkt testtidpost och tar bort den med `delete_time`.
2. Testfallen J2–J8 och tidigare A1–A4, T1–T4, S1–S5, O1–O3, F1, I1–I2 och E1–E10 i `docs/INSTALLATIONSPLAN-STAGING-2026-11-22.md` §4.
3. Riktig iPhone/Safari och Android. WebKit finns inte i testmiljön.

---

## B. UI/UX

Fullständig logg per vy: `docs/UI-GRANSKNING-2026-11-23.md`. Standard: `docs/DESIGNSTANDARD.md`.

**Metod och ärlig begränsning:**
- Skärmbilderna togs i Chromium och **öppnades och bedömdes visuellt**, inte bara mättes. Varje vy har en angiven granskningsnivå:
  - **Detalj:** fullstor bild.
  - **Översikt:** kontaktark. Räcker för layout och proportioner, inte för text.
  - **Ej granskad:** bara automatiska layoutkontroller. Räknas inte som granskad.
- Data var både realistiskt ifylld (demodata) och tom (alla affärsregister tömda).
- Safari/WebKit och riktiga telefoner är **inte** prövade.

**Granskade sidor:** 30 vyer i laptop (1366 px) och iPhone 13 (390 px), i två omgångar:
- **Detalj:** dashboard, kundregister, kundkort, fastighetskort, AO-lista, AO-detalj (laptop och mobil), Mina jobb (mobil), Tid & stämpla (mobil), offertguide, fakturering och fakturakö, projekt, kalender.
- **Översikt:** övriga vyer, samt tomma lägen (6 laptop, 3 mobil).
- **Mobil:** endast AO-detalj, Mina jobb och Tid & stämpla är detaljgranskade. Resten är översikt eller bara automatiskt kontrollerade.

**Problem som hittades:** se tabellen i UI-granskningen. De viktigaste var:
- Värden långt från sina etiketter i breda kort (~1 050 px).
- Flera primärknappar per vy; grönt och orange användes för sekundära handlingar.
- Tre ord för samma handling: "Klocka in", "Inklockat" och "Stämpla in".
- Formulärens fältavstånd växlade mellan 0 och 22 px.
- Filterväljare staplades i full bredd.
- Röda "0"-räknare.
- Tomläget sa "matchar filtret" fast inga poster fanns.
- En nästan osynlig rubrik i Mina jobb.
- Överlappande kalender- och kartmarkörer.
- Mobilens AO-åtgärder: en ensam knapp på egen rad.

**Problem som rättades** (CSS-tokens och gemensamma regler sist i `components.css`, plus riktade ändringar, ingen total omskrivning):
- Etikett och värde intill varandra (`kv`).
- En primärknapp per område.
- "Stämpla in/ut" överallt.
- Jämn 12 px formulärrytm.
- Filter på en rad med samma höjd.
- Neutrala räknare.
- Riktigt tomläge i Projekt.
- Läsbar rubrik i Mina jobb.
- Tvåkolumnsrutnät för AO-åtgärder på mobil; stämpelknappen har normal bredd på dator.
- Enhetliga statusmärken (`.bdg`), minsta textstorlek 10 px och synlig fokusring.
- Kalender och karta enligt A1.

**Före/efter-bilder** (`docs/ui-fore-efter/`, vänster före, höger efter): kundkort, fastighetskort, fakturakö, projekt (tomt), kalender, AO-detalj mobil, Mina jobb mobil och Tid & stämpla mobil. Från slutkontrollen finns också `slutkontroll-mobil-23-saljchanser.png` (regression → rättat), `slutkontroll-mobil-05-fastighetskort.png` (regression → rättat) och `slutkontroll-laptop-07-arbetsorderlista.png` (före → efter).

**Slutkontroll:** alla 60 bilder jämfördes pixel för pixel, från första före-bilden till slutläget. Vyer med oväntat stor skillnad öppnades sida vid sida. Den kontrollen hittade tre fel som jag själv hade orsakat i mobilvyer som tidigare bara var översiktsgranskade: säljkort, fastighetskortets rubrik och märket "Redo fakturering". De är rättade och efterbilderna är granskade. Det visar varför granskningsnivån "översikt" inte räcker som slutgiltig bedömning.

**Problem som återstår** (punkt 184 i masterplanen):
- AO-lista: poster med lika sorteringsnyckel kan byta plats mellan laddningar.
- Ordval: knappar och statusetiketter säger "Stämpla in/ut", men ett tiotal toast-/felmeddelanden och Dagens drift säger fortfarande "klocka"/"inklockad".
- Dashboard: dubblerad rubrik "Kräver åtgärd" och olika widgethöjder i samma rad.
- AO-lista: radhöjd.
- Fastighetskort: kapad sista flik och dubblerad "Snabböversikt".
- Offertguide: fälthöjder och dubblerad "Uppdragsbeskrivning".
- Admin och avvikelser: etikett/värde-layout och tunna kort.
- Tomlägen: fastighetslistan saknar förklaring; "Välj alla" visas i tom lista; serviceintervall saknar vägledning.
- ~1 300 inline-`font-size` som ska flyttas till klasser.

---

## C. Tester

Sista körningen gjordes efter att all kod frysts:

| Svit | Antal | Godkända | Misslyckade | Blockerade | Kända fel |
|---|---|---|---|---|---|
| E2E, Chromium mot simulerad backend (`node tests/e2e/run.js`) | 100 | 98 | 0 | 1 (PERM-03) | 1 (AO-07) |
| Enhetstester (`bash tests/run-all.sh`) | 10 filer, 188 kontroller | 188 | 0 | — | — |
| Offertparitet i webbläsare | 120 offerter | 120 (10 ogiltiga visar varning) | 0 | — | — |
| Läsande STAGING-kontroll (`staging-readonly.js`) | 11 | 11 | 0 | — | 1 info (proxyfel för extern resurs) |

- **Blockerad:** PERM-03, serverns behörighet per nyckel (G13). Den kan bara avgöras mot STAGING.
- **Känt fel:** AO-07, samtidiga loggposter med den gamla vägen (G5, serverberoende).
- **Instabilt test, rättat:** TIME-01 misslyckades i 1 av 6 körningar under last. Testet kontrollerade serverns stämpling direkt efter beskedet "Utstämplad — tid sparad". Stämplingen rensas i ett eget anrop strax efter tidpostens ACK, vilket är avsiktlig ordning; den varaktiga intentionen täcker en flik som stängs däremellan. Testet väntar nu i högst 5 s. Det var inget appfel. Isolerat godkändes testet 5 av 5 gånger.
- **Antal tester:** 100 i sista körningen mot 97 i förra. De tre nya är regressionstesten UI-KV-01, UI-PROP-01 och UI-BDG-01 från slutkontrollen.

**Visuella regressioner:** Alla 60 bilder (30 vyer × laptop/mobil) i slutläget jämfördes pixel för pixel mot före-bilden och mellan varje rättningsomgång. Tre regressioner, alla orsakade av mina egna UI-ändringar, hittades och rättades (se A1, UI-*). Mellan de två sista uppsättningarna ändrades bara AO-listan, av den avsiktliga märkesrättningen. Tomma lägen fångades separat och granskades i översikt.

**Begränsningar i testerna:**
- Den simulerade backenden är skriven utifrån klientens kontrakt och dokumentationen. Den bevisar inte hur `ao-time-write` och `store-key-write` beter sig i verkligheten, eftersom serverkällorna saknas (G4).
- Endast Chromium. Ingen Safari/WebKit, ingen riktig telefon.
- Push-notiser, PDF-generering, e-postutskick och service-monitor är inte körda.
- STAGING-skripten för G13/G9/G6 är förberedda men **inte körda**.

---

## D. Prestanda

**Förbättringar som ingår:**
- Indexcache för id-uppslag (`_vfFindById`) i stället för linjär sökning: AO-listan med 3 000 AO gick från 2,0 till 0,87 s (PERF-01, mätt i Leverans I).
- Läsning för verifiering har tidsgräns (RES-03), så ingen evig väntan.
- Kön skickas vid återanslutning (RES-01), utan oändliga loopar. Den körs bara när något väntar, när användaren är inloggad och när enheten är online.
- G5-vägen skickar en post i stället för hela loggen, så fort servern stöder det. Det sparar WAL i proportion till loggens storlek.

**Mätt i denna körning (PERF-01, 2 000 kunder, 3 000 fastigheter, 3 000 AO, 20 000 tidposter):** inloggning till klar 1,1–1,3 s; 5 anrop vid start; AO-lista 0,87–1,0 s; AO-detalj 0,09–0,13 s; kundlista 0,4 s; dashboard 0,28–0,34 s; löneunderlag 0,66–0,84 s; kalender 0,13 s. Spannet visar de två sista fullständiga körningarna. Mätvärdena kommer från en lokal maskin mot en simulerad backend utan nätverkslatens. De är jämförbara mellan körningar, inte med LIVE. Mätvärdet `ao_rader` visar 0 både före och efter: testets selektor matchar inte AO-listans markup. Det är ett mätfel i testet, inte ett fel i appen; AO-listans funktionstester är gröna.

**Kvarstående flaskhalsar och kostnadsrisker (oförändrade, se `docs/SLUTRAPPORT-2026-11-23.md` §C):**
- Historiska inbäddade bilder i `vift_workOrders` (G7): ~46× WAL per AO-ändring, och den största disk- och IO-risken i Supabase.
- Aktivitetsloggen som en enda JSONB-rad: 40,3 kB WAL per åtgärd mot 0,4 kB som egen tabell (punkt 150).
- DataSync hämtar hela `store` var 30:e sekund per öppen klient.
- Stämplingsbevakningen gör högst 40 EF-läsningar per aktiv användare och timme.
- G5-sonderingen kostar ett EF-anrop per session.
- Kartan geokodar adresser utan koordinater via Mapbox. Resultatet sparas på AO:n, och no-op-buggen är rättad (AO-09).

---

## E. Masterplan

`docs/MASTERPLAN.md`, Leverans J, punkt 174–184:
- Statuskategorierna BYGGD / LOKALT TESTAD / STAGING-VERIFIERAD / LIVE används från och med nu.
- Äldre punkter har fått statusändringar med behållna identifierare (151, 172, 173).
- Tidigare beslut och historik är orörda.
- Framtida områden står kvar men byggs inte nu: teknisk underhållsplanering, integrationer (Bokio, Momentum), artikelpriser/prisintegrationer (Solar, Ahlsell) och AI-arbetsorderinkorg.

Ingen konkurrerande masterplan har skapats.

---

## F. Installation

Den enda gällande planen är `docs/INSTALLATIONSPLAN-STAGING-2026-11-22.md` (uppdaterad i kväll). Sammanfattning:

**Exakta filer (§2a):**
- 40 versionsatta filer som är nyare i repot än i STAGING (`components.css` 106, `PropertyDetailPage.js` 35 och `WorkOrdersPage.js` 68 efter slutkontrollen). Listan finns med versionsnummer i planen.
- 5 nya filer: `tokens.css`, `reset.css`, `WorkOrderImageService.js`, `MapGrouping.js` och `ServiceIntervalsPage.js`.
- `index.html` och `public-offer.html`.
- STAGING-överlägget läggs tillbaka i `config.js`, `storage.js`, `AuthService.js` och `index.html`.

**Edge Functions:**
- `offer-attachment-upload` med PATCH (§2e). Jämför först med den deployade källan.
- Tre bild-EF:er (§2b), om bilddelen ska med.
- `ao-time-write`-ändringen för G5 är **inte** installerbar (§2f).

**Migrationer:** inga för §2a/§2e. `20261123000001_PROPOSAL_work_order_log_ops.sql` är ett förslag och ska **inte** köras.

**Ordning:**
1. J1 G13/G9 (ändrar inga data) mot nuvarande STAGING.
2. §2a klientfiler.
3. §2e.
4. (§2b.)
5. Testfallen i §4.
6. J1 G6 med testdata, om det godkänts.

**Efter installationen:**
- Hårdladda sidan och kontrollera de nya versionsnumren.
- Logga in utan konsolfel.
- Kör `staging-readonly.js` igen: "0 nyare i repot" för de installerade filerna.
- Kör J2–J8 och den tidigare testlistan.

**Rollback:**
- §2a: återställ staging-repots föregående commit. Inga serverobjekt påverkas.
- §2e: deploya föregående EF-version.
- §2b: enligt planen.

### GO/NO-GO

| Del | Beslut |
|---|---|
| Klientfiler §2a (releasekandidat) | **GO för kontrollerad STAGING-installation — kräver ditt separata GO.** Inga kända klientfel kvar som blockerar test. Klienten är inte verifierad mot riktiga serversvar. |
| `offer-attachment-upload` PATCH §2e | **GO efter källjämförelse och separat GO.** |
| J1 G13/G9 mot STAGING | **Rekommenderas först**, med separat GO och testkonton. |
| G5 serverdel, G7, aktivitetslogg som tabell | **NO-GO nu** (förslag/planerat; kräver G4). |
| **LIVE** | **NO-GO.** LIVE saknar STAGING:s backend (ao-time-write, RPC:er, RESTRICTIVE-policyer, stamp_status, store-key-write). G13/BLOCKER-2 är oavgjord. Ingenting är STAGING-verifierat. |
