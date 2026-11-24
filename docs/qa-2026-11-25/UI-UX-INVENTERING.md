# UI/UX-inventering V3 — VIFT CRM (QA 2026-11-25)

**Typ:** läsande inventering, ingen kod ändrad. **Gren:** `claude/vift-v3-major-redesign`, HEAD `335caa4` vid slutmätningen (identiska mätvärden som körningen på `d0724cf`).
**Miljö:** lokal statisk server + simulerad Supabase (`tests/e2e/lib.js` / `fake-backend.js`). Ingen trafik till LIVE eller till något Supabase-projekt. Inloggad som `admin` (demodata). För detaljsidorna skapades ett projekt (`PRJ-001`) och ett objekt (`Lgh 1001`) i den simulerade servern, eftersom demodatan saknar sådana.
**Bredder:** 390 × 664 (iPhone 13-profil, skala 1), 1366 × 768, 1920 × 1080 (huvudlistor). Skärmbilderna visar det synliga fönstret (inte hela sidan); mätningarna gäller hela sidan.
**Skärmbilder:** `docs/qa-2026-11-25/ui/` — 65 PNG. `NN_<sida>.png` = 1366 (vänster) och 390 (höger) sida vid sida; `NN_<sida>_1920.png` = 1920; `60–65_*.png` = riktade bilder för enskilda fynd.

---

## 1. Sammanfattning

| Klassning | Antal sidor | Sidor |
|---|---|---|
| **V3** (system.css/UiKit-komponenter genomgående) | **4** | Dashboard, Arbetsorder (lista), Arbetsorder (detalj), Säljchanser |
| **Delvis V3** (äldre markup som ärver V3 via delade klasser, blandat med inline-stil) | **24** | Kunder, Kundkort, Fastigheter, Fastighetskort, Serviceintervall, Offerter, Offert detalj, Fakturering, Fakturaunderlag detalj, Mina jobb, Dagens drift, Tid & stämpla, Kalender, Projektkort, Rondering, Artiklar, Prisgrupper, Personal, Återkommande, Objekt, Uppgifter, Offerttjänster, Ny rondering, Utför rondering |
| **Äldre design** (mest inline-stil, egna mönster) | **9** | Kontrakt, Projekt, Löneunderlag, Rapporter, Admin (alla 10 flikar), Importera, Importlogg, Exportcenter, Ronderingsrapport |

Totalt 37 sid-id (alla nycklar i `Auth.PAGE_PERMISSIONS`, inkl. detaljsidorna) + 10 admin-flikar.

**Markup som text (regressionskontroll):** **inga träffar.** Kontrollerat: synlig text, `title`, `placeholder` och `aria-label` i aktiv sida, topprad och öppna dialoger, mot mönstret `<svg|<span|<div|…>` och `&lt; &gt; &amp; &quot; &#39; &nbsp;` samt `undefined`, `NaN`, `null`, `[object Object]`. Omfattning: 37 sidor × 2 bredder, 10 admin-flikar × 2 bredder, 186 klick på flikar/filterchips (99 på 1366, 87 på 390) och 46 dialogöppningar (40 öppnades; `OffersPage.openCreate/openEdit` och `InvoiceDetailPage.openEditMeta` öppnade ingen modal i detta läge — ej kontrollerade).

**Inget horisontellt sidöverflöd** (`documentElement.scrollWidth > innerWidth`) på någon sida i någon bredd, och **inga knappar med avklippt text** (`scrollWidth > clientWidth`). Observera att `#content-scroll` har `overflow-x: hidden`, så innehåll som är för brett **klipps** i stället för att ge sidrullning — därför mättes även element som sticker ut ur fönstret (se F-03, F-05).

### Tio viktigaste fynden

| # | Fynd | Allvar |
|---|---|---|
| F-01 | Rapporter: vald period ("Denna mån") är vit text på ljusblått, kontrast 1,1:1 — valet syns inte | P1 |
| F-02 | Ikoner bryter rad: `svg { display:block }` i `reset.css:37` lägger ikonen på egen rad ovanför texten i 18 vyer (58 ställen) | P2 |
| F-03 | Importera (390): guiden är 860 px bred, klipps till höger utan rullning (rubrik, steg, släppyta) | P2 |
| F-04 | Löneunderlag: tabellceller saknar utfyllnad (`td` padding 0) — "3 475 krTätning av…"; timmar med punkt ("26.50", "5.00 h") | P2 |
| F-05 | Rapporter → Offerter (390): tabellen "Topp kunder" 406 px bredare än kortet, kolumner klipps | P2 |
| F-06 | Flikrader som döljer flikar: Fastighetskort 1366 (7 av 11 syns, "Ronder…" klipps), Admin 390 (5 av 10 syns) | P2 |
| F-07 | Fem olika flik-/filterstilar och fyra olika nyckeltalskort-stilar i appen | P2 |
| F-08 | Kalender veckovy (390): sju kolumner pressas — titlar bryts per bokstav ("By te ka b…"), lör–sön utanför | P2 |
| F-09 | Låg kontrast i rondering: stegetiketter 2,1–2,3:1, grön statustext 3,1–3,3:1, "Ej aktuell" 2,5:1 | P2 |
| F-10 | Detaljsidornas sidhuvud på mobil: knapparna bryts över 3–4 rader (Kundkort, Fastighetskort, Projektkort, Objekt) | P2 |

Inget av fynden är en bekräftad **V3-regression**: F-01 finns sedan 2026-07 (`ReportsPage.js:268`, commit `c24c54a`), `--acc` har alltid varit ljus (`tokens.css:12`). F-02 kommer från `reset.css` som inte ändrats i V3.

---

## 2. Metod och definitioner

- **Render-funktion** (file:line) är den funktion `Router.showPage` anropar (`src/pages/Router.js:133–171`).
- **V3-unika klasser** = klasser som bara förekommer i selektorer i `src/styles/system.css` (t.ex. `aol-*`, `aod-*`, `dt-*`, `so-*`, `doc-*`, `chip`, `av`, `ibtn`, `cat-tag`, `st-dot`). **Delade** = klasser som finns både i system.css och i äldre CSS och alltså restylas av V3 (`btn`, `bp`, `bs`, `card`, `bdg`, `ftabs/ft`, `list-item`, `crow`, `dr/dk/dv` …). **Äldre-unika** = bara i `components.css`, `layout.css`, `dashboard.css`, `responsive.css`, `forms.css`. Klassuppsättningarna lästes ur `document.styleSheets` i webbläsaren. Siffran är antal synliga element med minst en sådan klass.
- **inline-style** = synliga element med `style="…"` (andel av synliga element i sidan).
- **teckenstorl./textfärger** = antal distinkta beräknade `font-size`/`color` på synliga element med egen text. **knappvar.** = antal distinkta kombinationer (bakgrund, textfärg, kant, höjd, storlek, radie) bland synliga knappar.
- **ikon-radbr.** = synliga `svg` med `display:block` i ett icke-flex/grid-element som också innehåller text (= ikonen hamnar på egen rad).
- **låg kontrast** = text under 4,5:1 (3:1 för stor text) mot närmaste ogenomskinliga bakgrund, eller opacitet < 0,6. Förenklad beräkning (ingen alfablandning, gradienter eller bilder); värden på exakt "4,5:1" är gränsfall (4,45–4,49).
- **Rubrikmönster** = förekomst av V3-huvuden (`.ph`, `.doc-head`, `.off-detail-hero`, `.aod-head`, `.dt-head`, `.aol-bar`) eller äldre `.page-hero`. Notera: `.ph`/`.ph-title` (system.css:204, "används av nya vyer") används **inte av någon sida** — sidrubriken ligger i toppraden.
- Klassningen bygger på både kodinspektion (tabell 4) och skärmbilderna. Kodsiffrorna räknar hela modulen (objektet) som render-funktionen tillhör; för `PageShells.js` är omfånget approximativt (till nästa toppnivådeklaration).

---

## 3. Klassning per sida

| # | Sida (id) | Render-funktion | Klass | Underlag (kod + bild) | Skärmbild |
|---|---|---|---|---|---|
| 01 | Dashboard (`pg-dash`) | `src/pages/Dashboard.js:50` | V3 | `dt-*`-tavla (system.css:820), UiKit-avatarer, klickbara nyckeltal. Äldre widgetar under vecket (179 äldre-unika element, 147 `style=` i modulen) | 01_pg-dash.png, 01_pg-dash_1920.png |
| 02 | Arbetsorder (`pg-ao`) | `src/pages/WorkOrdersPage.js:106` | V3 | `aol-*` tabell/kort, `UiKit.chip`, `sbdg/pbdg`, 356 V3-element, 8 % inline | 02_pg-ao.png, 02_pg-ao_1920.png |
| 03 | Arbetsorder detalj (`pg-ao-detail`) | `src/pages/WorkOrderDetailPage.js:48` | V3 | `aod-*` huvud/nästa steg/snabbåtgärdsrad. Kvar: 214 `style=`, 58 `dr/dk/dv` i modulen, 13 teckenstorlekar (9–24 px) | 03_pg-ao-detail.png |
| 04 | Kunder (`pg-crm`) | `src/pages/CustomersPage.js:83` | Delvis V3 | `.list-item`/`.ftabs` restylade av V3, ser V3 ut; 0 UiKit, egen radmarkup | 04_pg-crm.png, 04_pg-crm_1920.png |
| 05 | Kundkort (`pg-crm-detail`) | `src/pages/CustomersPage.js:824` | Delvis V3 | `.card`/`.dr`-par restylade; huvudet är egen layout (inte `doc-head`) och bryts dåligt på mobil (F-10) | 05_pg-crm-detail.png |
| 06 | Fastigheter (`pg-objects`) | `src/pages/PageShells.js:7870` | Delvis V3 | samma mönster som Kunder | 06_pg-objects.png, 06_pg-objects_1920.png |
| 07 | Fastighetskort (`pg-obj-detail`) | `src/pages/PropertyDetailPage.js:11` | Delvis V3 | 306 `style=`, 130 inline `font-size`, egen hero; flikrad klipps (F-06) | 07_pg-obj-detail.png |
| 08 | Serviceintervall (`pg-service-intervals`) | `src/pages/ServiceIntervalsPage.js:56` | Delvis V3 | kort + streckat tomläge utan åtgärd (inte `.empty`) | 08_pg-service-intervals.png |
| 09 | Offerter (`pg-offer`) | `src/pages/PageShells.js:1138` | Delvis V3 | nyckeltal + `.ftabs` (system.css:1306 "omgång 2"); kortens metarad med inline 10 px-text och ikon på egen rad | 09_pg-offer.png, 09_pg-offer_1920.png |
| 10 | Offert detalj (`pg-offer-detail`) | `src/pages/PageShells.js:4504` | Delvis V3 | huvud via `.off-detail-hero` (system.css:1032); modulen har 186 `style=` och 88 hårdkodade hex-färger | 10_pg-offer-detail.png |
| 11 | Fakturering (`pg-invoices`) | `src/pages/InvoicesPage.js:14` | Delvis V3 | `bq-*` (system.css:937, 1266) ger V3-utseende; 111 äldre-unika element | 11_pg-invoices.png, 11_pg-invoices_1920.png |
| 12 | Fakturaunderlag detalj (`pg-inv-detail`) | `src/pages/InvoicesPage.js:590` | Delvis V3 | V3-huvud `.doc-head`; brödtext med 64 `dr/dk/dv`, 37 hex-färger | 12_pg-inv-detail.png |
| 13 | Säljchanser (`pg-sales`) | `src/pages/SalesPage.js:19` | V3 | `so-*`-kort (system.css:1059), 96 V3-element, 9 % inline | 13_pg-sales.png, 13_pg-sales_1920.png |
| 14 | Mina jobb (`pg-myjobs`) | `src/pages/MyJobsPage.js:14` | Delvis V3 | `job-card-v2` restylad; rubrikrad och tomläge i äldre stil | 14_pg-myjobs.png |
| 15 | Dagens drift (`pg-operations`) | `src/pages/OperationsPage.js:7` | Delvis V3 | 45 % inline (223/493), egna nyckeltalskort, 16 ikoner på egen rad | 15_pg-operations.png |
| 16 | Tid & stämpla (`pg-tid`) | `src/pages/TimePage.js:7` | Delvis V3 | formulär i `.card` + V3-kontroller; 0 V3-unika klasser | 16_pg-tid.png |
| 17 | Kalender (`pg-calendar`) | `src/pages/CalendarPage.js:29` | Delvis V3 | egen kalenderlayout med `var(--…)` (82), `.ftabs` för vy; mobil veckovy oanvändbar (F-08) | 17_pg-calendar.png, 17_pg-calendar_1920.png |
| 18 | Kontrakt (`pg-contracts`) | `src/pages/ContractsPage.js:58` | Äldre design | egen h1 (`ContractsPage.js:87`), statusfilter som `.btn bp/bs` (rad 73), native select med inline-stil (rad 95), tomläge som ren text | 18_pg-contracts.png, 18_pg-contracts_1920.png |
| 19 | Projekt (`pg-projects`) | `src/pages/ProjectsPage.js:32` | Äldre design | egen rubrik, mörka pill-filter, två native selects (rad 103, 107) bredvid en CustomSelect, status som blå text | 19_pg-projects.png, 19_pg-projects_1920.png |
| 20 | Projektkort (`pg-project-detail`) | `src/pages/ProjectDetailPage.js:32` | Delvis V3 | `.ftabs`, kort; 142 `style=`, status som text, mobilhuvud på 3 rader | 20_pg-project-detail.png |
| 21 | Rondering (`pg-rondering`) | `src/pages/RonderingPage.js:12` | Delvis V3 | `.list-item` + `.ftabs`, men "Ronderingar/Mallar" som `bp/bs`-knappar och metarad med ikoner på egen rad | 21_pg-rondering.png |
| 22 | Artiklar (`pg-articles`) | `src/pages/PageShells.js:8118` | Delvis V3 | restylad lista; 50 % inline (207/413) i raderna | 22_pg-articles.png, 22_pg-articles_1920.png |
| 23 | Prisgrupper (`pg-pricegroups`) | `src/pages/PageShells.js:8340` | Delvis V3 | restylad lista, `.ftabs` | 23_pg-pricegroups.png |
| 24 | Löneunderlag (`pg-payroll`) | `src/pages/PayrollPage.js:41` | Äldre design | 74 % inline (130/176), egen h1 (rad 106), otypad `<table style=…>` (rad 167) utan cellutfyllnad, `toFixed(2)` (rad 31) | 24_pg-payroll.png, 61_*, 65_* |
| 25 | Rapporter (`pg-reports`) | `src/pages/ReportsPage.js:1172` | Äldre design | 151 `style=`, 0 V3-/0 äldre-unika klasser, egna ljusblå KPI-rutor, egen periodväljare med kontrastfel (F-01) | 25_pg-reports.png, 60_*, 64_* |
| 26 | Personal (`pg-staff`) | `src/pages/PageShells.js:8537` | Delvis V3 | restylad lista + UiKit-liknande initialer (egna) | 26_pg-staff.png, 26_pg-staff_1920.png |
| 27 | Admin (`pg-admin`) | `src/pages/PageShells.js:9297` | Äldre design | flikar som `.btn bsm admin-tab bp/bs` (rad 9327), 254 `style=`, 53 `dr/dk/dv`, ikoner på egen rad i 6 flikar | 27_pg-admin.png, 38–47_admin-*.png |
| 28 | Återkommande (`pg-recurring`) | `src/pages/RecurringPage.js:8` | Delvis V3 | restylad lista, `sbdg`; infobox i äldre stil | 28_pg-recurring.png |
| 29 | Objekt (`pg-propobj-detail`) | `src/pages/PropertyObjectPage.js:11` | Delvis V3 | 126 `style=`, 73 inline `font-size`; en primärknapp per sektion | 29_pg-propobj-detail.png |
| 30 | Importera (`pg-import-wizard`) | `src/pages/ImportWizardPage.js:60` | Äldre design | egen `imp-*`-stil (components.css:4304), stor ikon ovanför rubrik, osynlig inaktiv "Nästa", 860 px på mobil (F-03) | 30_pg-import-wizard.png |
| 31 | Importlogg (`pg-import-log`) | `src/pages/ImportLogPage.js:11` | Äldre design | egen h2 med ikon på egen rad (rad 35), tomläge med vänsterställd ikon/centrerad text | 31_pg-import-log.png |
| 32 | Exportcenter (`pg-export-center`) | `src/pages/ExportCenterPage.js:89` | Äldre design | 65 % inline (60/92), egen h2 (rad 121), smal centrerad kolumn | 32_pg-export-center.png |
| 33 | Uppgifter (`pg-activities`) | `src/pages/PageShells.js:11149` | Delvis V3 | tomläge enligt V3 (ikon, rubrik, mening, åtgärd); egen h2 (rad 11266) dubblerar topprad; mörka pill-filter | 33_pg-activities.png |
| 34 | Offerttjänster (`pg-service-templates`) | `src/pages/PageShells.js:8840` | Delvis V3 | `.ftabs`, 11 hex-färger; fyra ikonknappar per rad | 34_pg-service-templates.png |
| 35 | Ny rondering (`pg-rondering-wizard`) | `src/pages/RonderingWizardPage.js:20` | Delvis V3 | V3-formulärkontroller, egen stegindikator med 24 hex-färger och låg kontrast | 35_pg-rondering-wizard.png |
| 36 | Utför rondering (`pg-rondering-utfor`) | `src/pages/RonderingUtforandePage.js:65` | Delvis V3 | kortlista OK; statusrad med inline-färger (`#16a34a`, rad 161), ikoner på egen rad, låg kontrast | 36_pg-rondering-utfor.png |
| 37 | Ronderingsrapport (`pg-rondering-rapport`) | `src/pages/RonderingRapportPage.js:8` | Äldre design | 65 % inline (135/208), egna KPI-rutor, `kv`-liknande sammanfattning med inline-stil | 37_pg-rondering-rapport.png |

---

## 4. Mätvärden

### 4.1 Sidor (1366 om inget annat anges)

| # | Sida | 1366: synl. el. | inline-style | V3-unika kl. | delade (restylade) | äldre-unika kl. | teckenstorl. | textfärger | knappvar. | ikon-radbr. | låg kontrast | 390: överflöd/breda el. | 390: avklippta knappar | rubrikmönster |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 01 | `pg-dash` Dashboard | 639 | 139 (22 %) | 115 | 103 | 179 | 12 | 9 | 11 | 2 | 1 | nej / 0 | 0 | .dt-head |
| 02 | `pg-ao` Arbetsorder | 564 | 47 (8 %) | 356 | 75 | 54 | 7 | 9 | 7 | 0 | 9 | nej / 0 | 0 | .aol-bar |
| 03 | `pg-ao-detail` Arbetsorder detalj | 611 | 139 (23 %) | 74 | 142 | 51 | 13 | 15 | 13 | 3 | 1 | nej / 0 | 0 | .aod-head |
| 04 | `pg-crm` Kunder | 120 | 26 (22 %) | 1 | 35 | 38 | 4 | 6 | 5 | 0 | 0 | nej / 0 | 0 | – |
| 05 | `pg-crm-detail` Kundkort | 89 | 13 (15 %) | 0 | 48 | 1 | 6 | 6 | 7 | 0 | 0 | nej / 0 | 0 | – |
| 06 | `pg-objects` Fastigheter | 75 | 21 (28 %) | 1 | 20 | 23 | 4 | 5 | 5 | 0 | 0 | nej / 0 | 0 | – |
| 07 | `pg-obj-detail` Fastighetskort | 132 | 43 (33 %) | 0 | 52 | 12 | 10 | 10 | 7 | 1 | 0 | nej / 0 | 0 | – |
| 08 | `pg-service-intervals` Serviceintervall | 12 | 4 (33 %) | 0 | 5 | 0 | 2 | 2 | 0 | 0 | 0 | nej / 0 | 0 | – |
| 09 | `pg-offer` Offerter | 202 | 43 (21 %) | 10 | 45 | 40 | 8 | 9 | 5 | 2 | 0 | nej / 0 | 0 | – |
| 10 | `pg-offer-detail` Offert detalj | 160 | 13 (8 %) | 2 | 32 | 53 | 12 | 9 | 6 | 2 | 0 | nej / 0 | 0 | .off-detail-hero |
| 11 | `pg-invoices` Fakturering | 356 | 50 (14 %) | 37 | 125 | 111 | 9 | 5 | 2 | 0 | 0 | nej / 0 | 0 | – |
| 12 | `pg-inv-detail` Fakturaunderlag detalj | 174 | 60 (34 %) | 19 | 53 | 9 | 11 | 11 | 3 | 2 | 0 | nej / 0 | 0 | .doc-head |
| 13 | `pg-sales` Säljchanser | 402 | 37 (9 %) | 96 | 140 | 7 | 8 | 7 | 7 | 0 | 12 | nej / 0 | 0 | – |
| 14 | `pg-myjobs` Mina jobb | 113 | 22 (19 %) | 0 | 19 | 32 | 5 | 7 | 2 | 0 | 1 | nej / 0 | 0 | – |
| 15 | `pg-operations` Dagens drift | 493 | 223 (45 %) | 20 | 66 | 110 | 8 | 11 | 2 | 16 | 0 | nej / 0 | 0 | – |
| 16 | `pg-tid` Tid & stämpla | 151 | 42 (28 %) | 0 | 41 | 5 | 7 | 7 | 4 | 0 | 0 | nej / 0 | 0 | – |
| 17 | `pg-calendar` Kalender | 113 | 30 (27 %) | 0 | 11 | 0 | 6 | 5 | 4 | 0 | 0 | nej / 0 | 0 | – |
| 18 | `pg-contracts` Kontrakt | 31 | 14 (45 %) | 0 | 7 | 12 | 5 | 4 | 3 | 0 | 0 | nej / 0 | 0 | – |
| 19 | `pg-projects` Projekt | 46 | 20 (43 %) | 0 | 6 | 18 | 6 | 6 | 3 | 0 | 0 | nej / 0 | 0 | – |
| 20 | `pg-project-detail` Projektkort | 100 | 55 (55 %) | 0 | 38 | 5 | 8 | 5 | 4 | 0 | 0 | nej / 0 | 0 | – |
| 21 | `pg-rondering` Rondering | 56 | 11 (20 %) | 0 | 20 | 7 | 5 | 6 | 4 | 3 | 0 | nej / 0 | 0 | – |
| 22 | `pg-articles` Artiklar | 413 | 207 (50 %) | 1 | 65 | 130 | 4 | 6 | 5 | 0 | 0 | nej / 0 | 0 | – |
| 23 | `pg-pricegroups` Prisgrupper | 62 | 28 (45 %) | 0 | 17 | 15 | 5 | 6 | 4 | 0 | 0 | nej / 0 | 0 | – |
| 24 | `pg-payroll` Löneunderlag | 176 | 130 (74 %) | 0 | 16 | 12 | 6 | 4 | 3 | 0 | 0 | nej / 0 | 0 | – |
| 25 | `pg-reports` Rapporter | 150 | 86 (57 %) | 0 | 26 | 0 | 5 | 6 | 5 | 2 | 24 | nej / 0 | 0 | – |
| 26 | `pg-staff` Personal | 137 | 34 (25 %) | 1 | 25 | 30 | 5 | 9 | 6 | 0 | 0 | nej / 0 | 0 | – |
| 27 | `pg-admin` Admin | 109 | 39 (36 %) | 0 | 35 | 16 | 7 | 6 | 4 | 0 | 0 | nej / 0 | 0 | – |
| 28 | `pg-recurring` Återkommande | 63 | 35 (56 %) | 0 | 13 | 15 | 6 | 6 | 1 | 0 | 0 | nej / 0 | 0 | – |
| 29 | `pg-propobj-detail` Objekt | 98 | 36 (37 %) | 0 | 31 | 4 | 7 | 7 | 3 | 0 | 0 | nej / 0 | 0 | – |
| 30 | `pg-import-wizard` Importera | 40 | 9 (22 %) | 0 | 2 | 16 | 5 | 4 | 1 | 1 | 1 | ja / 1 | 0 | – |
| 31 | `pg-import-log` Importlogg | 17 | 5 (29 %) | 0 | 2 | 0 | 3 | 2 | 1 | 2 | 0 | nej / 0 | 0 | – |
| 32 | `pg-export-center` Exportcenter | 92 | 60 (65 %) | 0 | 5 | 0 | 4 | 4 | 3 | 0 | 0 | nej / 0 | 0 | – |
| 33 | `pg-activities` Uppgifter | 28 | 8 (29 %) | 0 | 6 | 9 | 5 | 4 | 4 | 0 | 0 | nej / 0 | 0 | – |
| 34 | `pg-service-templates` Offerttjänster | 196 | 49 (25 %) | 0 | 46 | 0 | 5 | 4 | 5 | 0 | 0 | nej / 0 | 0 | – |
| 35 | `pg-rondering-wizard` Ny rondering | 60 | 24 (40 %) | 0 | 11 | 9 | 6 | 6 | 3 | 0 | 6 | nej / 0 | 0 | – |
| 36 | `pg-rondering-utfor` Utför rondering | 218 | 59 (27 %) | 0 | 5 | 59 | 8 | 8 | 4 | 7 | 15 | nej / 0 | 0 | – |
| 37 | `pg-rondering-rapport` Ronderingsrapport | 208 | 135 (65 %) | 0 | 11 | 22 | 9 | 8 | 2 | 0 | 0 | nej / 0 | 0 | – |

**Hela appen (1366, 37 sidor):** 22 olika teckenstorlekar (9–28 px: 9, 9,5, 10, 10,5, 11, 11,5, 12, 12,5, 13, 13,5, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28) och 20 olika klasskombinationer på knappar (`btn bp`, `btn bp bsm`, `btn bp bxs`, `btn bp bfull`, `btn bs`, `btn bs bsm`, `btn bs bxs`, `btn bghost …` ×4, `btn bsu …` ×2, `btn bd bxs`, `btn bw bxs`, `btn`, `ibtn`, `chip`, `ft`, knappar helt utan klass). 390 px: alla sidor saknar horisontellt sidöverflöd; enda element utanför fönstret är `div.imp-wizard` 860 px (Importera) och — efter klick på fliken Offerter — `table` 406 px (Rapporter).

### 4.2 Admin-flikar

| # | Admin-flik | synl. el. | inline-style | V3-unika | delade | äldre-unika | teckenstorl. | ikon-radbr. | låg kontrast | 390 överflöd |
|---|---|---|---|---|---|---|---|---|---|---|
| 38 | admin/foretag | 109 | 39 (36 %) | 0 | 35 | 16 | 7 | 0 | 0 | nej |
| 39 | admin/ekonomi | 46 | 5 (11 %) | 0 | 15 | 16 | 6 | 0 | 0 | nej |
| 40 | admin/personal | 449 | 187 (42 %) | 0 | 101 | 16 | 7 | 5 | 10 | nej |
| 41 | admin/priser | 139 | 51 (37 %) | 0 | 30 | 16 | 7 | 3 | 0 | nej |
| 42 | admin/system | 77 | 12 (16 %) | 0 | 32 | 16 | 4 | 0 | 0 | nej |
| 43 | admin/fastighetskort | 303 | 128 (42 %) | 0 | 66 | 16 | 7 | 0 | 0 | nej |
| 44 | admin/ansvariga | 40 | 1 (2 %) | 0 | 12 | 15 | 4 | 1 | 0 | nej |
| 45 | admin/avvikelse | 38 | 1 (3 %) | 0 | 12 | 15 | 4 | 1 | 0 | nej |
| 46 | admin/notiser | 84 | 23 (27 %) | 0 | 17 | 11 | 6 | 4 | 0 | nej |
| 47 | admin/epost | 113 | 35 (31 %) | 0 | 27 | 15 | 7 | 1 | 0 | nej |

### 4.3 Kodinspektion per modul

\* Hela modulen som render-funktionen tillhör (inte bara `render()`); för `PageShells.js` approximativt omfång.

| Modul (render) | rader i modul* | `style="` | hårdkodade hex | `var(--…)` | `UiKit.` | sbdg/pbdg/catBadge | `.ftabs` | `class="empty` | `.dr/.dk/.dv/.kv/.crow` | `font-size:` inline |
|---|---|---|---|---|---|---|---|---|---|---|
| Dashboard (`src/pages/Dashboard.js:50`) | 2030 | 147 | 17 | 90 | 3 | 6 | 0 | 9 | 25 | 62 |
| WorkOrdersPage (`src/pages/WorkOrdersPage.js:106`) | 2442 | 81 | 1 | 41 | 9 | 7 | 1 | 1 | 1 | 33 |
| WorkOrderDetailPage (`src/pages/WorkOrderDetailPage.js:48`) | 3460 | 214 | 9 | 114 | 6 | 5 | 0 | 3 | 58 | 77 |
| CustomersPage (`src/pages/CustomersPage.js:83`) | 815 | 28 | 0 | 18 | 0 | 0 | 1 | 2 | 3 | 13 |
| CustomerDetailPage (`src/pages/CustomersPage.js:824`) | 348 | 19 | 0 | 4 | 0 | 7 | 1 | 5 | 7 | 6 |
| PropertiesPage (`src/pages/PageShells.js:7870`) | 249 | 9 | 0 | 4 | 0 | 0 | 1 | 1 | 0 | 3 |
| PropertyDetailPage (`src/pages/PropertyDetailPage.js:11`) | 2956 | 306 | 16 | 121 | 0 | 4 | 1 | 6 | 34 | 130 |
| ServiceIntervalsPage (`src/pages/ServiceIntervalsPage.js:56`) | 175 | 19 | 0 | 7 | 0 | 0 | 0 | 2 | 0 | 9 |
| OffersPage (`src/pages/PageShells.js:1138`) | 3614 | 44 | 8 | 21 | 0 | 2 | 1 | 1 | 0 | 19 |
| OfferDetailPage (`src/pages/PageShells.js:4504`) | 3358 | 186 | 88 | 130 | 0 | 1 | 0 | 1 | 7 | 119 |
| InvoicesPage (`src/pages/InvoicesPage.js:14`) | 581 | 30 | 0 | 13 | 0 | 1 | 2 | 4 | 2 | 9 |
| InvoiceDetailPage (`src/pages/InvoicesPage.js:590`) | 1112 | 87 | 37 | 41 | 0 | 1 | 0 | 1 | 64 | 47 |
| SalesPage (`src/pages/SalesPage.js:19`) | 497 | 21 | 0 | 8 | 0 | 0 | 1 | 1 | 15 | 11 |
| MyJobsPage (`src/pages/MyJobsPage.js:14`) | 456 | 25 | 4 | 17 | 1 | 4 | 0 | 2 | 0 | 7 |
| OperationsPage (`src/pages/OperationsPage.js:7`) | 463 | 98 | 3 | 72 | 0 | 2 | 0 | 3 | 12 | 39 |
| TimePage (`src/pages/TimePage.js:7`) | 504 | 19 | 0 | 7 | 0 | 0 | 0 | 0 | 6 | 9 |
| CalendarPage (`src/pages/CalendarPage.js:29`) | 1062 | 31 | 8 | 82 | 0 | 0 | 1 | 1 | 0 | 31 |
| ContractsPage (`src/pages/ContractsPage.js:58`) | 273 | 44 | 0 | 28 | 0 | 0 | 0 | 0 | 0 | 20 |
| ProjectsPage (`src/pages/ProjectsPage.js:32`) | 339 | 30 | 0 | 23 | 0 | 0 | 0 | 2 | 0 | 15 |
| ProjectDetailPage (`src/pages/ProjectDetailPage.js:32`) | 1233 | 142 | 6 | 53 | 0 | 3 | 1 | 3 | 21 | 68 |
| RonderingPage (`src/pages/RonderingPage.js:12`) | 484 | 62 | 4 | 26 | 0 | 0 | 1 | 3 | 0 | 23 |
| ArticlesPage (`src/pages/PageShells.js:8118`) | 229 | 14 | 0 | 6 | 0 | 0 | 1 | 1 | 0 | 3 |
| PriceGroupsPage (`src/pages/PageShells.js:8340`) | 197 | 14 | 0 | 4 | 0 | 0 | 1 | 2 | 0 | 5 |
| PayrollPage (`src/pages/PayrollPage.js:41`) | 316 | 44 | 0 | 15 | 0 | 0 | 0 | 1 | 0 | 22 |
| ReportsPage (`src/pages/ReportsPage.js:1172`) | 1222 | 151 | 5 | 133 | 0 | 0 | 1 | 0 | 0 | 91 |
| StaffPage (`src/pages/PageShells.js:8537`) | 297 | 33 | 1 | 26 | 0 | 0 | 1 | 1 | 1 | 13 |
| AdminPage (`src/pages/PageShells.js:9297`) | 1790 | 254 | 26 | 124 | 0 | 0 | 0 | 1 | 53 | 119 |
| RecurringPage (`src/pages/RecurringPage.js:8`) | 681 | 68 | 4 | 37 | 0 | 3 | 0 | 1 | 26 | 27 |
| PropertyObjectPage (`src/pages/PropertyObjectPage.js:11`) | 679 | 126 | 0 | 74 | 0 | 0 | 0 | 1 | 0 | 73 |
| ImportWizardPage (`src/pages/ImportWizardPage.js:60`) | 1098 | 86 | 0 | 51 | 0 | 0 | 0 | 2 | 0 | 30 |
| ImportLogPage (`src/pages/ImportLogPage.js:11`) | 139 | 15 | 0 | 8 | 0 | 0 | 0 | 1 | 0 | 2 |
| ExportCenterPage (`src/pages/ExportCenterPage.js:89`) | 382 | 31 | 0 | 23 | 0 | 0 | 0 | 1 | 0 | 14 |
| ActivitiesPage (`src/pages/PageShells.js:11149`) | 733 | 24 | 0 | 16 | 0 | 0 | 0 | 3 | 0 | 10 |
| ServiceTemplatesPage (`src/pages/PageShells.js:8840`) | 462 | 89 | 11 | 44 | 0 | 0 | 1 | 0 | 1 | 34 |
| RonderingWizardPage (`src/pages/RonderingWizardPage.js:20`) | 897 | 84 | 24 | 30 | 0 | 0 | 0 | 0 | 0 | 34 |
| RonderingUtforandePage (`src/pages/RonderingUtforandePage.js:65`) | 563 | 44 | 11 | 19 | 0 | 1 | 0 | 1 | 0 | 21 |
| RonderingRapportPage (`src/pages/RonderingRapportPage.js:8`) | 163 | 52 | 0 | 34 | 0 | 0 | 0 | 1 | 0 | 31 |

---

## 5. Fynd

Allvar: **P1** = information går inte att läsa/använda; **P2** = tydligt fel eller hinder i ett vanligt flöde, eller systematisk inkonsekvens; **P3** = kosmetiskt/polering. "Bild" avser filer i `docs/qa-2026-11-25/ui/`. I de sammansatta bilderna är 1366 vänster och 390 höger.

### 5.1 Funktionella och visuella fel

| ID | Sida | Bredd | Allvar | Fynd | Belägg | Bild |
|---|---|---|---|---|---|---|
| F-01 | Rapporter | alla | P1 | Aktiv periodknapp "Denna mån" syns inte: inline `background:var(--acc);color:#fff` där `--acc` = `#E8F4FD` → 1,1:1. Användaren ser inte vilken period som är vald. Fanns före V3. | `ReportsPage.js:268`, `tokens.css:12`; uppmätt rgb(255,255,255) på rgb(232,241,252) | 25_pg-reports.png, 64_pg-reports-period_1366.png |
| F-02 | 12 sidor + 6 admin-flikar | alla | P2 | Ikon hamnar på egen rad ovanför texten (t.ex. "✓" över "10 godkända", klocka över "Ingen uppföljning bokad", kalender över "1 dec. 2026", "→" under "1 person – Visa", ikon ovanför rubriken i Importlogg/Importera/Notiser). 58 förekomster. Orsak: `img, svg { display:block }` och `ic()` används i inline-element utan flex. | `reset.css:37`; mätt per sida i kolumnen "ikon-radbr." | 15_pg-operations.png, 21_pg-rondering.png, 36_pg-rondering-utfor.png, 09_pg-offer.png, 40_admin-personal.png, 41_admin-priser.png, 46_admin-notiser.png, 31_pg-import-log.png |
| F-03 | Importera | 390 | P2 | Guiden är 860 px bred: rubrik, stegrad och släppyta klipps till höger och kan inte nås (innehållsytan har `overflow-x:hidden`). Orsak: `.imp-wizard` är flex-barn i `#pg-import-wizard-content` (display:flex) med `min-width:auto`; stegraden (892 px) sätter minsta bredd. | `components.css:4304`; uppmätt kedja imp-wizard 860 px → content 390 px | 30_pg-import-wizard.png |
| F-04 | Löneunderlag | alla | P2 | Tabellen saknar cellutfyllnad (`td` padding 0): datum ligger mot kortkanten, "Kostnad" och "Kommentar" flyter ihop ("3 475 krTätning av läckor…"). Timmar visas med punkt och två decimaler ("26.50", "5.00 h", "0.00 / 26.50") medan resten av appen använder svensk form. På 390 radbryts tid och summa ("10:00– / 15:00", "12.50 / h"). | `PayrollPage.js:167` (`<table style=…>` utan klass), `PayrollPage.js:31` (`toFixed(2)`) | 24_pg-payroll.png, 65_pg-payroll-tabell_1366.png, 61_pg-payroll-tabell_390.png |
| F-05 | Rapporter → Offerter | 390 | P2 | Tabellen "Topp kunder" är 406 px bredare än kortet; kolumnen "Godkänt återkommande…" klipps utan rullning. | uppmätt `table` 406 px utanför fönstret efter flikklick | 60_pg-reports-offerter_390.png |
| F-06 | Fastighetskort | 1366 | P2 | Flikraden (11 flikar) har `overflow-x:auto` och 1 059 px innehåll i 766 px: bara 7 flikar syns, "Ronder…" klipps, Objekt/Bilder/Anteckningar är dolda utan indikator. | uppmätt `.ftabs` scrollWidth 1059 / clientWidth 766 | 07_pg-obj-detail.png |
| F-07 | Admin (alla flikar) | 390 | P2 | Flikraden (10 knappar) rullar i sidled; 5 syns, resten dolda. Strider mot V3-regeln "filter och flikar får aldrig ligga dolda utanför skärmen på 360–390 px" (DESIGNSTANDARD, V3). | `PageShells.js:9326–9327`, `components.css:3545` | 27_pg-admin.png, 38–47_admin-*.png |
| F-08 | Kalender (vecka) | 390 | P2 | Sju dagkolumner pressas in: händelsetitlar bryts per bokstav ("By / te / ka / b…", "Lä / ck / ag / e…"), lördag–söndag hamnar utanför. Vyväljaren bryter "Agenda" till egen rad. | skärmbild | 17_pg-calendar.png |
| F-09 | Ny rondering, Utför rondering | alla | P2 | Låg kontrast: stegetiketter/siffror för kommande steg 2,1–2,3:1; grön statustext ("10 godkända", "Godkänd", "Klar") 3,1–3,3:1; "Ej aktuell — …" 2,5:1. | `RonderingUtforandePage.js:161` (`color:#16a34a`); RonderingWizardPage har 24 hex-färger | 35_pg-rondering-wizard.png, 36_pg-rondering-utfor.png |
| F-10 | Kundkort, Fastighetskort, Projektkort, Objekt | 390 | P2 | Sidhuvudets knappar bryts över 3–4 rader (Kundkort: Tillbaka+namn+Inaktivera / Redigera / ID-märken+Ny arbetsorder / Ny uppgift; Projektkort: "⋮" ensam på rad). Innehållet börjar först halvvägs ned. Fastighetskortet visar dessutom namnet tre gånger (huvud, rad "Solgläntan Hus A 3 AO Aktiv", kort). | skärmbilder | 05_pg-crm-detail.png, 07_pg-obj-detail.png, 20_pg-project-detail.png, 29_pg-propobj-detail.png |
| F-11 | Importera | alla | P3 | Inaktiverad "Nästa" saknar knappform och är nästan osynlig; stor ikon ovanför rubriken; släppytans ikon vänsterställd medan texten är centrerad. | skärmbild | 30_pg-import-wizard.png |
| F-12 | Återkommande | alla | P3 | "Om 1 dagar" (singular saknas). | `RecurringPage.js:51–52` | 28_pg-recurring.png |
| F-13 | Offerter | alla | P3 | Offert utan titel visar numret två gånger ("OFF-002" / "OFF-002"); detaljsidans rubrik blir "Offert" (`off.title\|\|'Offert'`). Data-beroende (demodatan saknar titlar). | `PageShells.js:4699` | 09_pg-offer.png, 10_pg-offer-detail.png |
| F-14 | Offerter | alla | P3 | Nyckeltalen visar "exkl. moms", korten "inkl. moms" i samma vy; undertexten i nyckeltalen är centrerad medan beloppet är vänsterställt. | skärmbild | 09_pg-offer.png |
| F-15 | Rapporter | alla | P3 | Periodetikett "nov 26 2026" / "Tim nov 26 2026" (otydligt datumformat); statusnamn i gemener och understrukna ("pool", "planerad"); KPI-etiketter centrerade, värden vänsterställda. | skärmbild | 25_pg-reports.png |
| F-16 | Dashboard | 390 | P3 | Inställningsknappen (kugghjul) hamnar ensam på egen rad under snabbknapparna. | skärmbild | 01_pg-dash.png |
| F-17 | Arbetsorder detalj | 1366 | P3 | "Kontakt" i huvudets åtgärdsrad har kant, övriga åtgärder är ghost-knappar. | skärmbild | 03_pg-ao-detail.png |
| F-18 | Mina jobb | 1366/1920 | P3 | "Ta jobbet" är en grön fullbreddsknapp (~1 030 px) på dator; korten har ingen maxbredd. | skärmbild | 14_pg-myjobs.png |
| F-19 | Personal | 390 | P3 | Namn bryts ("Erik / Andersson") eftersom rollmärke och en "Inaktivera"-knapp står på varje rad; en ändrande åtgärd direkt i listan. | skärmbild | 26_pg-staff.png |
| F-20 | Offerttjänster | 390 | P3 | Fyra ikonknappar per rad pressar beskrivningen till 3–4 rader. Ikonknappar utan synlig text — `aria-label`/`title` ej kontrollerat. | skärmbild | 34_pg-service-templates.png |
| F-21 | Admin → Notiser | alla | P3 | Teknisk diagnostik (Notification.permission, scriptURL, registration.pushManager …) visas för slutanvändaren. | skärmbild | 46_admin-notiser.png |
| F-22 | Arbetsorder (lista) | alla | P3 | Avatarstapeln överlappar så att initialer klipps ("SL" bakom "EA"). | skärmbild | 02_pg-ao_1920.png |
| F-23 | Kunder, Fastigheter | 1920 | P3 | Listraderna blir ~1 560 px breda med stort tomrum mellan namn och märken. | skärmbild | 04_pg-crm_1920.png, 06_pg-objects_1920.png |
| F-24 | Tid & stämpla | alla | P3, ej verifierat | Datum/tid visas som "11/24/2026" och "08:00 AM" i headless Chromium trots `locale: sv-SE`. Native `<input type=date/time>` följer troligen webbläsarens/OS:ets språk — kontrollera på riktig enhet innan åtgärd. | skärmbild | 16_pg-tid.png |

### 5.2 Systematiska inkonsekvenser

| ID | Område | Allvar | Beskrivning | Exempel (bild-nr) |
|---|---|---|---|---|
| S-01 | Flikar/filter | P2 | Fem varianter: (1) V3 `.ftabs` segmentkontroll (Kunder, Fastigheter, Offerter, Artiklar, Personal, Kundkort, Fastighetskort, Rapporter); (2) `.btn bp/bs` som flikar (Admin, Kontrakt-status, Rondering "Ronderingar/Mallar"); (3) mörka pill-filter med antal (Projekt, Uppgifter); (4) ljusa `UiKit.chip` (Arbetsorder); (5) rullista för status på mobil (Arbetsorder, Offerter). Två stilar på samma sida: Rondering, Kontrakt. | 21, 18, 19, 33, 02, 27 |
| S-02 | Nyckeltalskort | P2 | Fyra stilar: Dashboard `dt-tile` (ikon + tal + etikett), Offerter (vänsterställt belopp, centrerad undertext, färgad vänsterkant), Dagens drift (centrerat tal, färgad överkant, ikon fristående till vänster), Rapporter (ljusblå yta, centrerad etikett). Kontrakt/Löneunderlag/Projektkort/Ronderingsrapport har ytterligare enkla varianter. | 01, 09, 15, 25, 18, 24, 37 |
| S-03 | Sidrubrik | P3 | Toppraden visar titel + undertitel; Kontrakt, Projekt, Löneunderlag, Uppgifter, Importlogg, Exportcenter och Importera upprepar titeln som egen h1/h2. V3:s `.ph`-huvud används inte någonstans. | 18, 19, 24, 33, 31, 32, 30 |
| S-04 | Knappar | P2 | 20 klasskombinationer. Flera primärknappar per vy trots V3-regeln "en primär åtgärd per vy" (Säljchanser: "Skapa offert" + "Skapa AO" per kort; Objekt: "Lägg till" i varje sektion). "+ Ny rondering" har textplus och annan höjd än grannknapparna. Mobila listhuvuden: Kunder/Fastigheter samlar Importera/Exportera i "⋮", Artiklar/Personal/Prisgrupper/Rondering radbryter dem. | 13, 29, 21, 22, 26, 23 |
| S-05 | Formulärkontroller | P3 | Native `<select>` med inline-stil och utan pil (Kontrakt "Alla typer", Projekt "Alla ansvariga"/"Alla fastigheter" bredvid en CustomSelect med pil, Löneunderlag "Alla personal", Exportcenter "Register"). | 18, 19, 24, 32 |
| S-06 | Status | P3 | Status som färgad text i stället för `sbdg()`-märke (Projekt "Planerad", Projektkort, Objekt "Aktiv"). | 19, 20, 29 |
| S-07 | Tomlägen | P3 | V3 `.empty` med åtgärd används på Uppgifter; övriga: streckad ruta utan åtgärd (Serviceintervall, Mina jobb), ren text (Kontrakt "Inga avtal matchar filtret."), vänsterställd ikon + centrerad text (Importlogg, Importera). | 33, 08, 14, 18, 31 |
| S-08 | Typografi | P3 | 22 teckenstorlekar i appen; per vy upp till 13 (AO-detalj 9–24 px), 12 (Dashboard, Offertdetalj). 9–10 px text förekommer (AO-detalj, Offerter "Ingen uppföljning bokad" 10 px). Inline `font-size:` i kod: PropertyDetailPage 130, AdminPage 119, OfferDetailPage 119, ReportsPage 91. | tabell 4.1, 4.3 |
| S-09 | Färger | P3 | Hårdkodade hex-färger i render-kod: OfferDetailPage 88, InvoiceDetailPage 37, AdminPage 26, RonderingWizardPage 24, Dashboard 17, PropertyDetailPage 16 — ofta Tailwind-palett (`#16a34a`, `#ef4444`, `#7c3aed`, `#c2410c`) i stället för `--ok/--danger/--violet/--warn`. AO-detalj: 10 distinkta inline-färger, 15 textfärger. | tabell 4.3 |
| S-10 | Tal och datum | P2 | Tre talformat: heltal med mellanslag ("12 688 kr"), decimal med komma ("5 212,5 kr", Fakturaunderlag) och punkt med två decimaler ("26.50", Löneunderlag). Datum: "ons 26 nov" (UiKit), "15 nov. 2026", "2026-11-24", "nov 26 2026" (Rapporter). | 12, 24, 25 |
| S-11 | Responsivitet | P2 | Ingen sida ger sidrullning i sidled, men tre mönster döljer innehåll i stället: klippning under `overflow-x:hidden` (Importera, Rapporter-tabell), dolda flikar i rullande rad (Admin 390, Fastighetskort 1366) och sammanpressade kolumner (Kalender vecka). Tabeller utan V3-omslaget `.dt-wrap > .dt-scroll` (Löneunderlag, Rapporter). | 30, 60, 27, 07, 17, 61 |
| S-12 | Kontrast (gränsfall) | P3 | Grå/blå hjälptext på färgade rutor mäter 4,2–4,5:1: Säljchanser "Nästa åtgärd"/"Senast …", Rapporter KPI- och periodtext, Admin → Personal "1 person – Visa", Arbetsorder antal i statusflikar. | 13, 25, 40, 02 |

---

## 6. Förbättringsplan (ingen stor omdesign nu)

Ordningen är vald så att små, isolerade rättningar kommer först och den stora harmoniseringen sist. Varje fas avslutas med `node tests/e2e/run.js` (simulerad server) och `tests/e2e/visual.js capture/compare` i 1920/1366/1024/768/390/360 så att inget annat flyttat sig. Publicering sker enligt gällande flöde (STAGING först; LIVE kräver Lucas godkännande).

### Fas 0 — punkträttningar (små, en fil i taget, låg risk)
1. **F-01** Rapporter: aktiv periodknapp med `btn bp` (eller `--accent` + vit text) i stället för `--acc` — en rad i `ReportsPage.js:268`.
2. **F-12** "Om 1 dag" / "Om N dagar".
3. **F-03** Importera: `min-width:0` (eller `width:100%`) på `.imp-wizard` så att stegraden rullar inom sig själv.
4. **F-04** Löneunderlag: cellutfyllnad (helst V3-tabellen `.dt-wrap > .dt-scroll > table.dt`) och svensk talform för timmar.
5. **F-05** Rapporter: lägg tabellerna i `.dt-scroll` så att de rullar inne i kortet.
6. **F-09** Rondering: byt hårdkodad grön/grå mot `--ok`/`--muted`/`--faint` (klarar 4,5:1 enligt DESIGNSTANDARD).
7. **F-16, F-17, F-22** små layoutjusteringar (kugghjul, Kontakt-knappens stil, avatarstapelns överlapp).
8. **F-13** Reservtitel för offert utan titel (t.ex. kund eller kategori i stället för numret två gånger).

### Fas 1 — systematiska CSS-rättningar (en regel, många sidor; kräver visuell jämförelse)
1. **F-02** Ikoner på egen rad: ersätt den globala `svg { display:block }` för `ic()`-ikoner med inline-visning (t.ex. `display:inline-block; vertical-align:-2px`, eller en klass som `ic()` sätter) och behåll `block` bara där det behövs. Berör 18 vyer — jämför pixeldiff före/efter.
2. **F-06/F-07/S-11** Flikrader: på smal skärm radbrytning i rutnät (som `.ftabs` redan gör under 640 px) eller rullista; på dator "Mer ▾" när flikarna inte får plats (Fastighetskort, Admin).
3. **S-05** En gemensam stil för native `<select>` (pil, höjd `--ctl-h`, 16 px på mobil) så att filterraderna ser lika ut.
4. **F-10** Detaljsidornas mobilhuvud: en primär åtgärd synlig, övriga i "⋮" (samma mönster som AO-detaljens "Fler åtgärder").
5. **F-08** Kalender: agenda- eller dagvy som standard under 640 px.

### Fas 2 — komponentharmonisering, sida för sida (medel)
1. **S-02** En nyckeltalskomponent (förslagsvis `dt-tile`) för Offerter, Dagens drift, Rapporter, Kontrakt, Löneunderlag, Projektkort, Ronderingsrapport.
2. **S-01** En flikkomponent (`.ftabs`) och en filterkomponent (`UiKit.chip`); ersätt `.btn bp/bs`-flikar (Admin, Kontrakt, Rondering) och mörka pill-filter (Projekt, Uppgifter).
3. **S-03** Ta bort dubblerade h1/h2 där toppraden redan visar titeln; antal och åtgärder i en gemensam verktygsrad.
4. **S-06/S-07** `sbdg()` för all status och `.empty` (ikon, rubrik, mening, åtgärd) för alla tomlägen.
5. **S-04** Mobila listhuvuden: samma mönster överallt (sök + primär + "⋮"); en primärknapp per vy.
6. **S-10** Gemensamma formathjälpare för belopp, timmar och datum i svensk form.

### Fas 3 — större harmonisering (senare, planeras separat)
1. Migrera sidorna i klassen **Äldre design** till V3-komponenter: Rapporter, Löneunderlag, Admin (flikar + sektioner), Kontrakt, Projekt, Importera/Importlogg/Exportcenter, Ronderingsrapport.
2. Minska inline-stil och hårdkodade färger i de stora modulerna (OfferDetailPage, PropertyDetailPage, WorkOrderDetailPage, AdminPage, Dashboard-widgetar) mot tokens (`--ok/--warn/--danger/--violet`, `--muted/--faint`).
3. Typografiskala: från 22 till cirka 7 storlekar som tokens; knappar: en definierad uppsättning (`bp`, `bs`, `bghost`, `bd`, `ibtn` × `bsm/bxs`).
4. Stora skärmar: maxbredd eller fler kolumner i registerlistor (F-23).
5. Mobil: Offerttjänster- och Personal-rader (F-19/F-20) med åtgärder i "⋮".

---

## 7. Begränsningar och ej verifierat

- Endast rollen **admin**; andra roller (arbetsledare, ekonomi, fält) kan se andra knappar och flikar. Endast 390, 1366 och 1920 (768/1024/360 är inte mätta här).
- Skärmbilderna visar fönstret, inte hela sidan; innehåll under vecket är bedömt via mätvärdena och de riktade bilderna 60–65.
- Kontrastberäkningen är förenklad; gränsfall (4,2–4,5:1) bör kontrolleras med verktyg.
- Mörkt läge, utskrift/PDF, e-post och publika offertvyer ingår inte.
- `aria-label` på ikonknappar, tangentbordsnavigering och skärmläsare är inte granskade.
- F-24 (datumformat i native fält) kan vara en artefakt av headless Chromium — ej verifierat på riktig enhet.
- Klassningen V3 / Delvis V3 / Äldre design är en bedömning av både kod och bild; mätvärdena i 4.1–4.3 är underlaget.
- Engångsskripten (mätning, sammansättning av bilder, dialogkontroll) ligger utanför repot i sessionens scratchpad och är inte incheckade. De använder `tests/e2e/lib.js` utan ändringar.
