# Admin, Rapporter och Löneunderlag — V3 (arbetsblock admin, 2026-11-26)

**Gren/worktree:** arbetsblockets worktree från `claude/vift-v3-major-redesign` (05058e8). Inget är pushat.
**Filer:** `src/pages/PageShells.js` (endast objektet `AdminPage`), `src/pages/ReportsPage.js`, `src/pages/PayrollPage.js`, `src/styles/v3-admin.css`, `index.html` (bara `?v=` för dessa fyra), nytt test `tests/e2e/specs/29_admin_reports.js`.
**Underlag:** `docs/qa-2026-11-25/UI-UX-INVENTERING.md` (F-01, F-02, F-04, F-05, F-07, F-15, F-21, S-01–S-12) och `docs/V3-KOMPONENTSTANDARD.md` (huvudrepot). All provning mot den simulerade servern (`tests/e2e`), ingen trafik till STAGING, LIVE eller något Supabase-projekt.

De tre sidorna klassades som "Äldre design". Nu bygger de på V3-systemet: kort (`.card`), nyckeltal, segmentkontroll, tabell och faktarutor. Funktioner, data, behörigheter och affärsregler är kvar. Undantagen står under "Beteendeändringar" och "Beslutspunkter".

---

## 1. Admin (`pg-admin`)

| Krav / fynd | Före | Efter |
|---|---|---|
| **F-07** flikar dolda på 360/390 | 10 knappar (`btn bp/bs`) i en rullande rad; 5 av 10 syntes på 390 px | **Dator (≥ 900 px):** grupperad meny till vänster, sex grupper: Företag & profil · Ekonomi & priser · Personal & behörighet · Fastighetskort · Notiser & e-post · System. **Mobil/surfplatta:** en rullista (44 px, 16 px text) med samma grupper som `optgroup`. Inget avsnitt kan hamna utanför skärmen. E2E ARP-01 provar 360, 390 och 1366. |
| Antal avsnitt | 10 | 11. Nytt: **Teknik & underhåll**, sist i menyn, se nedan. |
| **A1/RENDER-01** | ikon i etiketten escapades till text | Oförändrad princip. Ikonen är betrodd `ic()`-markup (fältet `icon`), etiketten escapas. Knapparna behåller `.admin-tab` och `onclick="AdminPage._tab='…'"`. |
| Sektioner med inline-stil | 254 `style=` i modulen, egna rubriker, `dr/dk/dv` | V3-kort (`.card` > `.card-header` > `.card-body`). Avsnittsrubrik som h2 (sidans h1 finns i toppraden). Listrader `.adm-row` med märke och ikonknappar (`aria-label` och `title`). Faktarutor (`dl`) för företagsuppgifter och notisstatus. |
| **F-02** ikon på egen rad | 6 flikar | Ikoner ligger i flex-behållare. Dessutom finns en lokal regel i `v3-admin.css` för inline-ikoner på de tre sidorna. `reset.css` är orörd. |
| **F-21** teknisk push-diagnostik | visades som huvudinnehåll i Notiser | Notiser visar bara status, behörighet, appläge och åtgärder. Diagnostiken ligger i **Teknik & underhåll**. Testnotisens serverdetaljer ligger i en ihopfälld ruta. |
| Hierarki, Personal | titlar först, roller sist | **Roller & behörigheter** först, eftersom de styr åtkomst. Titlar därefter. "Personalregistret" är en sekundär länk i rubriken. |
| Titelsökning | hela sidan ritades om per tangent, så fokus försvann efter ett tecken | Fördröjning 150 ms. Bara listan ritas om, och "Visar X av Y" visas (standard §5). Provas i ARP-01. |
| Priser | genvägar som `dr`-rader med knappar | Klickbara registerrader med ikon, antal aktiva och chevron. De inbyggda kalkylatormallarna har en egen lista. |
| Logotyper | statusen visade alltid "Använder standardlogga" (läste `settings.logoLight`, men loggan ligger i `localStorage`) | Statusen läser `BrandingService`-nycklarna. "Återställ" visas när det finns en uppladdad logga. |

### Färgkedjan (Företag & varumärke)
- **Förvalda färger:** sex per fält. Den första är standard (VIFT marinblå `#0f3763` / blå `#1d75d8`). Alla primärförval klarar vit text (≥ 8,6:1).
- **Egen färg:** fri färgruta, och ett HEX-fält som godtar `#rgb`/`#rrggbb`. HEX-fältet normaliseras till gemener.
- **Standard:** knappen visas bara när en annan färg är vald.
- **Förhandsvisning:** när man drar, skriver eller trycker på ett förval ändras bara CSS-variablerna, och inget skrivs. Förhandsrutan visar sidomenyn, en primärknapp, ett aktivt filter och ett räknarmärke med de verkliga V3-klasserna.
- **Sparning:** exakt en sparning per valt värde, via samma `_saveColor` → `BrandingService.update` (den är oförändrad). Förval sparas vid klick, färgrutan vid `change` och HEX vid Enter eller när fältet lämnas. Ett oförändrat värde sparas inte.
- **Ogiltig HEX:** fältet markeras och den sparade färgen gäller igen. Inget skrivs.
- **Kontrast:** en upplysning visar kontrasten för vit text på vald färg (t.ex. "12:1 — läsbart" eller "Låg kontrast … 1,2:1"). Den ändrar inga färger, eftersom automatisk textfärg ligger i backloggen.
- **Verifierat i ARP-02 (simulerad server):**
  - förval, egen HEX, ogiltig HEX, ljus färg och Standard ger 3 skrivningar för 3 sparade ändringar;
  - `companyName`, `bankgiro`, sekundärfärg och alla andra nycklar är oförändrade;
  - efter omladdning, ny inloggning och på en annan enhet har sidomenyn (`#bottom-nav`), primärknappen, aktivt filter och räknarmärket samma färg;
  - omladdning och inloggningar skriver inte `vift_settings`.
- **BRAND-01** (drag skriver inget, change sparar en gång, oförändrat värde sparas inte) är grön. `BrandingService` är inte ändrad.

### Teknik & underhåll (QA-tillägg)
- **Push-diagnostik för den här enheten:**
  - status för Push API;
  - om den **publika** VAPID-nyckeln är konfigurerad (bara ja/nej);
  - behörighet, enhet och PWA-diagnostiken från `PushService.getDiagnostics()`.
  - Inga nycklar, JWT eller andra användares endpoints visas. Diagnostiken visar bara den här enhetens endpoint-suffix, som tidigare.
  - Steg-för-steg-hjälpen för en saknad VAPID-nyckel finns kvar.
- **"Rensa lokal cache på den här enheten"** (tidigare "Återställ demodata", som körde `localStorage.clear(); location.reload()`).
  - Texten säger nu: serverns data påverkas inte, du förblir inloggad, uppladdade logotyper behålls, och osparade ändringar försvinner.
  - Inloggningen (`vift_auth_v2`) och de lokala logotypnycklarna behålls. De finns bara på enheten och skulle annars försvinna för gott. Allt annat i `localStorage` rensas, bland annat dashboardlayout, sparade filter och cachade register.
  - **Kön kontrolleras först.** Avsnittet visar antalet osparade ändringar ur fyra källor:
    - `AOTimeSyncService.pendingCount()` (`vift_outbox`);
    - `_vfJournalPendingCount()` (`vift_persistJournal:*`);
    - `DataSync._pendingWrites`;
    - `ActivityService._outbox`.
  - Finns osparade ändringar krävs **två** bekräftelser, och båda visar antalet. Finns inga räcker en.
  - Kräver `admin_manage` (eller `all`) via `Auth.require`.
  - E2E ARP-07 provar alla fallen, kontrollerar att serverns data är oförändrad och att fältarbetaren nekas.

### Ekonomi
Ett nytt kort, **"Tre olika timvärden"**, skiljer begreppen åt:
- **Intern timkostnad:** `internalHourlyCost`.
- **Försäljningspris:** prisgruppernas timpris (PG-001 392, PG-002 430, PG-003 595, PG-004 695 kr/h i demodatan).
- **Lönekostnad:** finns inte i systemet.

Se också avsnitt 3.

---

## 2. Rapporter (`pg-reports`)

| Krav / fynd | Före | Efter |
|---|---|---|
| **F-01** vald period syns inte (vit text på `--acc`, 1,1:1) | `btn bs` med inline `background:var(--acc);color:#fff` | V3-segmentkontroll `.ar-seg`. Vald knapp har `--accent-ink` på vit yta med kant och skugga (6,1:1), ovald har `--ink-2` på grå bana. `aria-pressed` är satt. Den valda perioden skrivs ut i klartext: "Visar **november 2026** · 1–30 nov. 2026". ARP-03 räknar kontrasten ur de beräknade stilarna för alla sex val. |
| **F-15** datumformat | "nov 26 2026", "Tim nov 26 2026" | Etiketter: "november 2026", "Q4 2026", "år 2026", "senaste 12 månaderna". Intervall som "1–30 nov. 2026". Datum som `fmtDate` ("24 nov. 2026"). Kundhändelsernas tid visas i lokal tid, tidigare UTC-klockslaget. |
| **F-15** statusnamn | "pool", "planerad" i gemener, understrukna | `statusLabel()`: Arbetspool, Planerad, Pågående, Klar. Klickbara staplar är hela knappar som stryks under först vid hover. Allvarlighet och feltyp har stor begynnelsebokstav. |
| **F-05** bred tabell på 390 | "Topp kunder" 406 px bredare än kortet | V3-tabell i en egen rullyta. Under 768 px blir varje rad ett kort med etikett och värde. ARP-04: ingen tabell är bredare än sitt kort på 360 och 390. |
| **S-02** nyckeltal | ljusblå `ibox`, centrerad etikett | `.ar-kpi`: ikon, etikett, värde och förklaring, vänsterställt, samma i alla flikar och i löneunderlaget. Klickbara nyckeltal är knappar med fokusring. Ton `danger`/`warn` används när värdet kräver åtgärd. |
| **S-10** talformat | `fmt()` utan kr, "12.5 h", "20%" | Belopp: "12 345 kr" och "kr/mån", med "exkl. moms" utskrivet. Timmar: "26,5 h". Procent: "20 %". Svarstid: "1,5 dagar". |
| Flikar på mobil | 8 flikar i 4 rader | Rullista under 900 px. Export ligger i "⋮" under 640 px (standard §1/§3). |
| Staplar | slumpmässiga färger per kort | En färg (accent) för storlek. Semantiska färger bara där stapeln betyder status (AO-status, allvarlighet, beläggning, försenat). |
| Datakvalitet | orange ruta med inline-stil | V3-upplysning `ar-note is-warn`, med "Visa poster (N)". |
| Intäktsdefinition | lång grå text överst | Ihopfälld "Så räknas siffrorna" under nyckeltalen. Texten är oförändrad. |

**Buggrättning:** staplar för fastigheter i Avvikelser och Serviceintervall gick till `pg-property-detail`, som inte finns. Användaren fick "Du saknar behörighet" och hamnade på dashboarden. De går nu till fastighetskortet (`pg-obj-detail`, `propId`).

**Oförändrat:** alla beräkningar (`_invAmount`, `_entryHours`, perioder, filter) och exportens innehåll. Exportens periodetikett får det nya formatet.

---

## 3. Löneunderlag (`pg-payroll`)

| Krav / fynd | Före | Efter |
|---|---|---|
| **F-04** cellutfyllnad | `td` padding 0: "3 475 krTätning av…" | `.ar-table`: 10 × 14 px utfyllnad, rubrikrad i versaler, zebra, hover. Rubrikraden ligger fast vid ≥ 1 200 px; under det har tabellen en egen rullyta. Siffror är högerställda med `tabular-nums`. |
| **F-04** timmar | "26.50", "5.00 h", "0.00 / 26.50" | Valt format: **decimaltimmar med komma, högst två decimaler, utan avslutande nollor, "h"** ("26,5 h", "5 h", "1,58 h"). Det är samma form som Rapporter och standard §10. Lagrade värden (minuter) och CSV-exportens format ("26.50") är oförändrade. |
| **S-03** dubbel rubrik | egen h1 "Löneunderlag" | Ingen h1/h2, titeln finns i toppraden. Verktygsraden har periodväljaren (‹ november 2026 ›, "Aktuell månad" när man bläddrat bort), en personalväljare (V3-select) och "Exportera CSV". På mobil ligger exporten i "⋮". |
| Mobil | tabell med `min-width:580px` som rullade | Kort per rad: datum + timmar, arbetsorder, tid + värde, kommentar och en attestruta som är 40 px hög. Långa namn och kommentarer bryts. |
| Personkort | egen markering | Avatar (UiKit), namn, attestmärke (`.bdg`), summa och "Attestera alla". |
| **Värdet som kallades "Estimerad lönekostnad"** | timmar × `entry.hourRate` | **Samma beräkning**, med nytt namn: "**Debiterbart värde**" (timmar × prisgruppens timpris, exkl. moms — inte lönekostnad). Kolumnen heter "Debiterbart värde", och varje rad visar sitt timpris. Om `settings.internalHourlyCost` finns och får läsas visas också "**Intern kostnad (uppskattad)**" = timmar × intern timkostnad. Saknas värdet visas raden inte; standardvärdet 250 används inte som påhittat tal. Den ihopfällda rutan "Så räknas värdena — lönekostnad finns inte i systemet" listar prisgrupperna i urvalet. |

**Var värdet kommer ifrån (spårat i koden):**
- `PayrollPage._cost(e) = e.minutes / 60 × e.hourRate`.
- `e.hourRate` sätts i `TimeService` när tidposten skapas (`hourRate: pg ? pg.hourRate : 0`, rad 324 och 554). Det är prisgruppens **försäljningspris**.
- Personalposterna saknar lönefält.
- `ProfitabilityService.internalRate()` använder `internalHourlyCost` (standard 250).
- Rapporter visar ingen lönekostnad: "Bidrag före lönekostnad" = fakturerat − material, med korrekt namn.

**ARP-05** låser nuvarande beräkning:
- varje rad = minuter / 60 × hourRate;
- summa = Σ;
- Intern kostnad = timmar × `internalHourlyCost`, och visas inte när värdet saknas;
- inga nyckeltal kallas "lönekostnad";
- lagrade minuter och timpriser är oförändrade.

---

## 4. V3-komponentstandarden — hur den följts

**Följs:**
- §1 ingen egen h1;
- §2 knappar `bp/bs/bghost/bd` med ikon och text, ikonknappar med `aria-label` och `title`, tryckytor ≥ 40 px på mobil;
- §3 "⋮" (`aoToggleOverflow`) för export på mobil;
- §4 `.ftabs` och rullista (Rapporter), inga `btn bp/bs` som flikar;
- §5 sök;
- §6 `.card` / `.empty` / `dl` faktarutor;
- §7 tabell i kort med rullyta, versala rubriker och kort per rad på mobil (gränsen är ≤ 767 px, inte ≤ 600);
- §8 `.bdg`;
- §10 format;
- §11 `esc()` och `ic()`;
- §12 realistisk data: fem personer, fyra veckor, ett långt namn, fyra prisgrupper, attesterade och ej attesterade rader.

**Medvetna avvikelser:**
- Admin använder på dator en **grupperad sidomeny** i stället för `.ftabs`. Med 11 avsnitt i 6 grupper blir en segmentrad oläslig. Uppdraget nämnde tvånivågruppering som godtagbart mönster.
- "Exportera" (Rapporter) och "Exportera CSV" (Löneunderlag) är synliga knappar på dator och ligger i "⋮" först på mobil. Det är samma mönster som kundregistret (`.ao-import-btn`/`.ao-overflow-btn`). Rapporternas export är dessutom sidans enda åtgärd.

---

## 5. Beteendeändringar (utöver presentation)
1. **Löneunderlag, attestsvar.**
   - Klienten läste bara `r.data.timeEntry`. Den simulerade servern svarar `entry` (källan till `ao-time-write` finns inte i repot).
   - Följden var att en lyckad attestering visades som ej attesterad tills nästa synk, och att "Attestera alla" räknade lyckade poster som "misslyckades".
   - Nu godtas båda formerna. Om posten saknas i svaret sätts bara attestflaggan till det servern bekräftat (`r.ok`).
   - Skrivvägen (`AOTimeSyncService.setAttested`) är oförändrad.
2. **Löneunderlag, behörighet i gränssnittet.** Utan `payroll_manage` är attestrutorna avstängda och "Attestera alla" visas inte. Tidigare gav de bara ett felbesked. Kontrollerna i funktionerna finns kvar.
3. **Rensa lokal cache.** Den behåller inloggning och logotyper och spärrar med dubbel bekräftelse vid osparade ändringar (se 1).
4. **Rapporter.** Fastighetslänkarna är rättade (se 2). Kundhändelsernas tid visas i lokal tid.
5. **Säkerhet.**
   - Data i Admin-vyerna escapas nu även där det tidigare saknades: slogan, telefon, e-post, adress, webbsida och moms-nr i vyn och i redigeringsdialogen, titel- och rollnamn i dialogrubriker, e-post i titeldialogen, sökordet.
   - Id:n skickas via `data-id` i stället för att klistras in i `onclick`.
   - Avvikelsekategoriernas färg valideras som hex.
   - I Rapporter escapas hela `onclick`-attributet, och id:n citeras med `_jsq()`.

---

## 6. Beslutspunkter och fynd (inte åtgärdade)
1. **Lönekostnad finns inte i systemet.** Verklig lönekostnad (lön/timlön + sociala avgifter) kräver lönedata per person, och den finns inte i dag. Löneunderlaget visar nu "Debiterbart värde" och en uppskattad intern kostnad.
2. **CSV-exporten från löneunderlaget** har kvar kolumnen "Kostnad (SEK)" (= debiterbart värde) och timmar som "26.50". Den är oförändrad eftersom ett lönesystem eller kalkylark kan läsa filen efter kolumnnamn och format. Vill ni byta namn eller format är det ett beslut.
3. **Kontrast med egna varumärkesfärger (rapporteras, inte åtgärdat):**
   - **V3 ignorerar `--brand-primary-text`.** `system.css` ritar `.bp`, `.chip.on`, `.aol-badge` och sidomenyn med fast vit text. `BrandingService` räknar ut en läsbar textfärg (YIQ), men den används inte. En ljus primärfärg ger därför oläslig text:

     | Färg | Vit text | Sidomenyns text (74 % vit) |
     |---|---|---|
     | `#f0f0a0` | 1,2:1 | 1,1:1 |
     | `#1d75d8` | 4,6:1 | 3,2:1 |
     | `#0f3763` (standard) | 12:1 | 7,3:1 |

     Gränssnittet varnar nu vid < 4,5:1.
   - **Sidomenyns sektionsrubriker** (42 % vit) ger 3,4:1 redan med standardfärgen, under 4,5:1 för 10,5 px text.
   - **Sekundärfärgen syns nästan inte i V3**, eftersom topprad och primärknapp har V3-färger. Texten vid fältet säger det.
   - `logoForBg` byter till mörk logga på ljus bakgrund, medan menytexten förblir vit. Det blir inkonsekvent.
4. **`vift_settings` skrivs som en helhet.** `BrandingService.update` slår ihop med klientens `state.settings` och skriver hela objektet. Om en annan admin ändrat t.ex. företagsnamnet och klienten inte hunnit synka kan det skrivas över. I samma session är övriga nycklar oförändrade (ARP-02). Ett per-nyckel-skydd hör till server/`state.js` och ligger utanför blocket.
5. **Logotyperna finns bara i `localStorage` på enheten** (`BrandingService`). De syns inte på andra enheter och försvinner om webbplatsdatan rensas. Det kräver ett beslut om serverlagring.
6. **Attestsvarets form** (`timeEntry` eller `entry`) bör bekräftas mot den riktiga `ao-time-write`. Klienten tål nu båda.
7. **RENDER-01 tar cirka 85 s redan på oförändrad HEAD** (84,7 s, uppmätt med `VIFT_E2E_ROOT` mot HEAD), nära körarens tidsgräns på 90 s.
   - Två saker i blocket förlängde testet, och båda är åtgärdade:
     - rapportflikar som `role="tab"` (91 s) — flikarna använder `aria-pressed` i stället;
     - tabellklassen `ar-table`, som matchade testets väljare `[class*="-tab"]` och gav extra klick — den heter nu `ar-tbl`/`pay-tbl`.
   - Efter åtgärden: 84,9 s.
   - I en full körning under last föll testet ändå på tidsgränsen en gång (90 s), trots att alla 140 sidvisningar var gjorda.
   - Testet bör få längre tidsgräns, eller delas per roll. Det ligger utanför blocket.

---

## 7. Skärmbilder
- **Katalog:** `docs/qa-2026-11-26/fore-efter/admin/`. Bredd 390 (skala 1) och 1366. Bilderna visar hela sidhöjden.
- **Före:** `fore-admin-{foretag,personal,priser,fastighetskort,notiser}-{390,1366}.png`, `fore-rapporter-{oversikt,tid,ekonomi,offerter}-{390,1366}.png`, `fore-loneunderlag-{390,1366}.png`.
- **Efter:** samma namn med `efter-`. Dessutom:
  - `efter-admin-{ekonomi,system,teknik,epost}-*` (nya eller flyttade avsnitt);
  - `efter-loneunderlag-realistisk-{390,1366}.png`: fem personer, fyra veckor, långt namn, fyra prisgrupper, blandad attest.

## 8. Tester
**Nya: `tests/e2e/specs/29_admin_reports.js`, `--grep ARP-`:**
- **ARP-01:** alla elva admin-avsnitt nås på 360, 390 och 1366. Teknik & underhåll ligger sist. Titelsökningen behåller fokus och visar antal.
- **ARP-02:** färgkedjan (se 1).
- **ARP-03:** periodkontrollens kontrast ≥ 4,5:1 och `aria-pressed`. Dessutom svensk periodetikett, läsbara statusnamn, enhetliga nyckeltal och svenska tal, och rapportväljaren på 360.
- **ARP-04:** inga tabeller bredare än kortet på 360 och 390 (realistiskt löneunderlag). På dator: utfyllnad ≥ 8 × 12, fast rubrikrad i versaler, zebra, högerställda timmar, ingen h1.
- **ARP-05:** låser löneberäkningen (se 3). Attestering via kryssruta och "Attestera alla" går till servern utan falska felbesked.
- **ARP-06:** inget sidöverflöd och inget utanför fönstret på 360, 390, 768, 1024, 1366 och 1920. Ingen markup ("<svg") och inget undefined/NaN som text i någon flik. Diagnostiken ligger i Teknik & underhåll och visar inga nycklar.
- **ARP-07:** rensning av lokal cache (se 1).

**Körda:** se avsnitt 9.

## 9. Resultat (simulerad server, 2026-11-25)

**Riktad körning, slutlig kod:**
- `--grep "ARP-|RENDER-01|XSS-01|BRAND-01|VAT-01|ADMIN-01|ROLE-02|REP-01|TIME-01"`: **15/15 godkända**.
- RENDER-01 tog 84,9 s (HEAD utan ändringar: 84,7 s).
- Tidigare samma dag gav en bredare riktad körning (PAGES-01/02, RESP-*, PERM-04, MODAL-01, STAFF-01/02, ROLE-01, DASH-01, NOTIF-01, TIME-06 m.fl.) **30/30 godkända**.

**Hela sviten (`node tests/e2e/run.js`), slutlig kod, en körning:**
- **125 godkända, 1 misslyckad, 1 blockerad (PERM-03), 1 känt fel (AO-07)** av 128, 881 s.
- Det misslyckade testet är **SALES-01** (Säljchanser, utanför blocket): "säljchansen på servern".
  - Det var godkänt i föregående fulla körning och godkänt när det kördes ensamt direkt efter (7 s).
  - Det bedöms som instabilt under last och är inte orsakat av blocket. `SalesPage` är orörd.
- Föregående fulla körning, före klassnamnsbytet:
  - 124 godkända;
  - RENDER-01 föll på tidsgränsen 90 s efter att ha gjort alla sidvisningar (se 6.7);
  - ART-01 föll en gång men var godkänt i omkörning.

**`bash tests/run-all.sh`:**
- 15/19 testfiler gröna, **0 misslyckade**.
- 4 överhoppade (ingen lokal PostgreSQL: checklist_progress_sql, offer_attachment_upload del 2–3, server_rpcs_sql, staging_backup_export). De är inte godkända, bara inte körda.

**Ej gjort:**
- Mörkt läge, utskrift och verklig enhet (iOS) är inte provade.
- Automatisk textfärg för ljusa varumärkesfärger ligger i backloggen (se 6.3).
- CSV-format och lönedata är beslutspunkter (6.1–6.2).
