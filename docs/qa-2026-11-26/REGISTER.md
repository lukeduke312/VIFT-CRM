# Register — V3-omarbetning (arbetsblock "register", 2026-11-26)

**Gren/arbetskopia:** isolerad worktree från `claude/vift-v3-major-redesign` (HEAD `9bdb701`). Ingen push, ingen trafik till STAGING/LIVE — allt är provat i den lokala simulerade servern (`tests/e2e`).
**Sidor:** Kunder (`pg-crm`, listan), Fastigheter (`pg-objects`), Artiklar (`pg-articles`), Prisgrupper (`pg-pricegroups`), Personal (`pg-staff`), Offerttjänster (`pg-service-templates`), Uppgifter (`pg-activities`).
**Filer:** `src/pages/CustomersPage.js` (bara listdelen: `render`/`renderList` + filterhjälpare), `src/pages/PageShells.js` (bara objekten `PropertiesPage`, `ArticlesPage`, `PriceGroupsPage`, `StaffPage`, `ServiceTemplatesPage`, `ActivitiesPage` och det nya hjälpobjektet `RegisterUi` mellan `PropertiesPage` och `ArticlesPage`), `src/styles/v3-register.css`, `index.html` (bara `?v=` för de tre filerna), `tests/e2e/specs/34_registers_ui.js`.
**Underlag:** `docs/qa-2026-11-25/UI-UX-INVENTERING.md` (F-02, F-19, F-20, F-23, S-01–S-12), `docs/V3-KOMPONENTSTANDARD.md`, tillägg från användaren (bredd, mobil utifrån uppgifter, realistisk data, komponentstandard).

---

## 1. Gemensamt mönster för alla register

Alla sju sidor byggs nu av samma delar (`RegisterUi` i `PageShells.js` + `v3-register.css`), så att samma sak ser ut och beter sig likadant:

| Del | Hur | Krav |
|---|---|---|
| Sidrubrik | Bara i toppraden. Uppgifters egna h2 "Uppgifter", Offerttjänsters korthuvud "Offerttjänster & Prismodeller" och Prisgruppers h3 "Prisgrupper"/"Prisprofiler" är borttagna. | S-03, standard §1 |
| Verktygsrad | Sök till vänster (`type="search"`, `aria-label`, ikon som eget element) · "⋮" (`.ibtn`, "Fler åtgärder") med Importera/Exportera · **en** primär åtgärd "+ Ny …" längst till höger. Importera/Exportera ligger i "⋮" på alla bredder (tidigare som knappar på dator och radbrutna på mobil). | S-04, standard §1–§3 |
| Mobil verktygsrad (< 640 px) | Sök på egen rad, primär åtgärd i full bredd + "⋮" bredvid, filter under. Sökfältet har 16 px text (iOS zoomar annars). | standard §1, §2 |
| Filter | `.ftabs/.ft` för status/vy (Aktiva/Inaktiva/Arkiverade, Prisgrupper/Prisprofiler) med antal i `.ft-n`; `UiKit.chip` (`.chip` + `.chip-n`) för typ, kategori och snabbval. Mörka piller (`.filter-panel-chip`) och "(N)" i flikarna används inte längre. | S-01, standard §4 |
| Sök | Tvåfasrendering: `render()` bygger verktygsraden en gång, `renderList()` bygger bara om filter, räknare och lista — fältet tappar aldrig fokus. 150 ms fördröjning. Rättar fokusfelet i Offerttjänster (hela sidan renderades om per tangent) och Uppgifter (fokus återställdes manuellt). | standard §5 |
| Räknare | "N kunder" eller "Visar X av Y kunder" + "Rensa filter" när sök/filter är aktivt + "Välj alla" (markering för bulkåtgärder som förut). | standard §4, §5 |
| Lista | Tabell i kort (`.dt-wrap > .dt-scroll > table.dtab.rg-tbl`) med versala kolumnrubriker, högerställda tal (`tabular-nums`), hela raden klickbar, Enter öppnar raden (tangentbord), "›" (Öppna) med `aria-label`. | standard §7 |
| Mobil lista | Samma markup blir **ett kort per rad** när innehållet är smalare än 640 px (container query på `.rg`; reserv med `@media` för äldre webbläsare). Kolumner som inte ryms döljs efter *innehållets* bredd (1 300/1 000/900 px), inte fönstrets — på 1 024 px med sidomeny är innehållet bara ca 720 px. | standard §7 |
| Bredd | `.rg` max 1 440 px. På 1920 är listan 1 440 px med fler kolumner i stället för 1 560 px breda rader med tomrum. | F-23 |
| Radmeny | "⋮" per rad (Personal, Offerttjänster) med ikon + text; destruktiv post sist, avskild och röd; bekräftelsedialog. Menyn placeras `position:fixed` intill knappen så att den aldrig klipps av tabellens rullbehållare och öppnas uppåt om det saknas plats. Escape stänger (befintlig `aoToggleOverflow`). | F-19, F-20, standard §3 |
| Status | `.bdg.st` (punkt + text): Aktiv (grön) / Inaktiv (grå). | S-06, standard §8 |
| Tomlägen | `.empty`: ikon, rubrik, en mening och en åtgärd (Rensa sökning/filter eller "+ Ny …" om behörighet finns). | S-07, standard §6 |
| Ikoner | `.rg svg { display:inline-block }` — ingen ikon på egen rad i registervyerna (lokal rättning). Uppgifters metarad hade tre ikoner på egen rad. | F-02 |
| Belopp | "exkl. moms" utskrivet: Artiklar "Pris exkl. moms", Prisgrupper "Timpris exkl. moms", Offerttjänster "Minsta debitering exkl. moms". | standard §10 |

**Medveten tolkning av standarden:** status (Aktiva/Inaktiva/Arkiverade) visas som `.ftabs`-segment — samma som förebilden arbetsorderlistan — och snabbval/typ/kategori som chips i en separat grupp. Statussegmenten är filterknappar (`aria-pressed`), inte ARIA-flikar; bara Prisgrupper/Prisprofiler (byte av vy) är `role="tab"`.

## 2. Per sida

### Kunder (`CustomersPage.render/renderList`)
- Kolumner på dator: Kund (namn, typ · kundnr), Org.nr (inte personnummer för privatpersoner), Kontakt (kontaktperson + telefon · e-post), Ort, Fastigheter (antal aktiva), Öppna AO. Mobilkort: namn, typ · kundnr, telefon · ort, "N AO".
- Status (Aktiva/Inaktiva) är egen flikgrupp; kundtyp är chips med antal. Urvalen är desamma som förut (Aktiva + Alla typer = tidigare "Alla"; Inaktiva + Alla typer = tidigare "Inaktiva"); nytt är att typ kan kombineras med Inaktiva. Legacy-typer (t.ex. `company`) räknas som Företag (`normalizeType`, oförändrat). Äldre anrop med `_typeFilter='inaktiva'` tolkas som statusen Inaktiva.
- Antal fastigheter och öppna AO räknas en gång per rendering (inte per rad) — samma definition av "öppen" som `CustomerService.getActiveAOs`.
- Behörighet oförändrad: "Ny kund" och Importera kräver `customer_manage`.

### Fastigheter (`PropertiesPage`)
- Kolumner: Fastighet (namn, nummer), Adress (gata / postnr ort), Kund, Typ och yta, Objekt (antal), Öppna AO. Tidigare visade märket "N AO" *alla* arbetsorder för fastigheten; nu visas öppna AO med samma definition som i kundregistret och kolumnen heter "Öppna AO".
- Aktiva/Arkiverade som flikar; bulkåtgärderna Arkivera/Återaktivera oförändrade.

### Artiklar (`ArticlesPage`)
- Kolumner: Art.nr, Benämning, Kategori, Enhet, Pris exkl. moms (+ "per st · 25 % moms"), Marginal, Status.
- **Rättad felmärkning:** listan skrev "145 kr/st inkl 25% moms", men priset är exkl. moms (fältet heter "Försäljningspris ex moms" och `ProfitabilityService` räknar `sellPrice` som exkl.). Inga priser eller beräkningar är ändrade — bara texten.
- Ny statusgrupp Alla/Aktiva/Inaktiva (standard Alla = samma urval som förut) + kategorichips; kan kombineras. Sök på art.nr är nu skiftlägesokänslig.
- Bulk Aktivera/Inaktivera och Inaktivera i redigeringsdialogen oförändrade.

### Prisgrupper (`PriceGroupsPage`)
- Flikar Prisgrupper/Prisprofiler (med antal); primär åtgärd följer fliken ("Ny prisgrupp"/"Ny prisprofil"); "⋮" (Importera/Exportera) bara på prisgruppsfliken (som förut fanns det bara där). Ny sökning.
- Prisprofilernas rad öppnar nu redigeringen (förut bara via en pennknapp utan namn); pennan finns kvar med `aria-label`.

### Personal (`StaffPage`) — F-19
- Kolumner: Namn (avatar via `UiKit.avatar`), Titel, Roll, Telefon, E-post (breda skärmar), Status. Ny sökning.
- "Inaktivera"/"Aktivera" stod som knapp på varje rad och pressade ihop namnen. Nu: radens "⋮" → Redigera / Inaktivera (sist, röd, **med bekräftelse**) eller Aktivera; funktionen finns som förut även i redigeringsdialogen.
- Utan `staff_manage` (t.ex. arbetsledare med `staff_view`): ingen radmeny, ingen "Ny personal", inget Importera; raden öppnar inte längre en dialog som ändå nekas.

### Offerttjänster (`ServiceTemplatesPage`) — F-20
- Fyra ikonknappar per rad (Testkalkyl, Duplicera, Aktivera/Inaktivera, Redigera — den sista utan namn) ersatta av en "⋮" med text; klick på raden öppnar redigeringen. Inaktivera har bekräftelse. Kolumner: Tjänst (ikon, namn, kategori), Prismodell, Minsta debitering exkl. moms, Status.

### Uppgifter (`ActivitiesPage.render/renderList/setFilter/setSearch`)
- Egen h2 + sammanfattningsrad borttagen (S-03); antal visas i chipsen och räknaren.
- Mörka piller → V3-chips i två grupper: öppna snabbval (Alla öppna, Mina, Försenade [röd], Idag, Kommande) | Klart och kopplingar (Klart, Offerter, Arbetsorder). Urvalen är identiska med förut (Offerter/Arbetsorder matchar fortfarande alla statusar).
- Tabell: klar-knapp, Uppgift (titel, märken Försenad/Idag/prioritet, kopplingar), Typ, Ansvarig (avatar), Förfaller (röd/orange). Kopplingarna (kund, fastighet, offert, AO) är nu riktiga knappar (tangentbord) i stället för klickbara `span`.
- Klar-knappen är en `button role="checkbox"` med `aria-label`. **Per-post-regeln är oförändrad**: `_canCompleteTask/_canEditTask/_canDeleteTask` styr som förut; saknas behörighet är knappen inaktiverad och utan anrop, och `toggleComplete()` nekar själv.

## 3. Säkerhet och behörighet
- All data i mallarna går genom `esc()`. Rättade sänkor i mina objekt: dialogtitlar (`Modal.open` sätter `innerHTML`) för artikel, prisgrupp, prisprofil, personal och offerttjänst; formulärvärden i artikel-, prisgrupps- och personalformulären; vald titel i personalformuläret; titelväljarens `onclick` (citattecken kunde bryta attributet) går nu via `RegisterUi.arg()`; prisprofilens standardprisgrupp i listan.
- Post-id i inline-anrop går via `RegisterUi.arg()` (JSON + `esc`).
- `StaffPage._toggleActive()` kräver nu `staff_manage` (samma som redigeringen) eftersom den nås från radmenyn; direktanrop utan behörighet nekas med besked (E2E REG-UI-04). Inga andra regler, statusar eller sparvägar är ändrade.

## 4. Mobil utifrån uppgifter (kundkort och fastighetskort, 390 px)
E2E REG-UI-10 går igenom: hitta kunden i registret (sök) → kundkortet; hitta fastigheten på adress → fastighetskortet; adress, "Ny AO", portkod under Kontakt (admin med `objects_sensitive` ser den, arbetsledaren inte), flikarna Objekt och Service. Inga åtgärder eller flikar ligger utanför skärmen och ingen sidrullning i sidled.
**Fynd i andra arbetsblocks filer (inte ändrade här):**
- Kundkortet: telefon och e-post är vanlig text, inte `tel:`/`mailto:`-länkar — det går inte att ringa eller maila med ett tryck (finns redan på fastighetskortets kontakter). Testet noterar detta i stället för att underkänna.
- Kundkortets och fastighetskortets huvud radbryter knapparna över 3–4 rader på 390 px (F-10).
- Portkoden visas bara under fliken Kontakt, inte i översikten.

## 5. Före/efter-bilder
`docs/qa-2026-11-26/fore-efter/register/` — skala 1, simulerad server, admin.
- `fore-<sida>-<bredd>.png` / `efter-<sida>-<bredd>.png`: demodata, 390 och 1366 för alla sju sidor, 1920 för kunder, fastigheter, artiklar och personal.
- `fore-data-…` / `efter-data-…`: samma vyer med realistisk data (100+ poster, långa namn, saknade fält, inaktiva) — "före" är tagen mot baslinjen `9bdb701`.

## 6. Tester
Ny spec `tests/e2e/specs/34_registers_ui.js` (11 test, realistisk data i den simulerade servern):

| Test | Vad |
|---|---|
| REG-UI-01 | Kunder, 150 kunder: räknare och typfilter (inkl. legacy-typ), "Visar X av Y", sök med bibehållet fokus, Rensa filter, Inaktiva + typ, bakåtkompatibelt `_typeFilter`, "⋮" Importera/Exportera, en primär åtgärd, "Ny kund" öppnar formuläret |
| REG-UI-02 | Fastigheter: kolumner, sök på ort, tomläge "Inga träffar" + Rensa, Arkiverade, Enter öppnar fastighetskortet, markering/Välj alla, "Ny fastighet" |
| REG-UI-03 | Artiklar: status + kategori kombinerade, sök art.nr, "exkl. moms" och inget "inkl", radklick och "Ny artikel" |
| REG-UI-04 | Personal (F-19): ingen Inaktivera-knapp i raderna, namn på en rad på 390 px, ⋮ med namn, Inaktivera med bekräftelse → servern, Aktivera → servern, arbetsledare utan meny/primär och nekat direktanrop |
| REG-UI-05 | Prisgrupper: flikar, primär följer fliken, sök, exkl. moms, profilrad öppnar redigering, ⋮ bara för prisgrupper |
| REG-UI-06 | Offerttjänster (F-20): en namngiven ⋮ per rad på mobil, Duplicera, Testkalkyl, Inaktivera med bekräftelse, sök med bibehållet fokus |
| REG-UI-07 | Uppgifter: ingen egen rubrik, chips i två grupper räknar rätt, sök + Rensa, per-post-regeln för fältarbetare (egen kan klarmarkeras → servern, annans är inaktiverad och orörd) |
| REG-UI-08/09 | 7 sidor × 360/390/768/1024/1366/1920 px: ingen sidrullning i sidled, ingen avklippt text, knappar inom skärmen, ikonknappar har namn, inga ikoner på egen rad, ingen markup som text, ingen upprepad h1/h2, kort per rad när innehållet < 640 px, innehåll ≤ 1 440 px på 1920, radmenyer syns helt |
| REG-UI-10 | Mobila uppgifter på kundkort och fastighetskort (se §4) |
| REG-UI-11 | Varje flik- och filterläge på 390 och 1366 px: ingen markup som text, ingen avklippt text, inga ikoner på egen rad |

Resultat: se §7.

## 7. Körningar (simulerad server, 2026-11-25)
| Körning | Resultat |
|---|---|
| Ny spec `34_registers_ui.js` (REG-UI-01–11) | **11/11 godkända** (även i helsviten) |
| Berörda befintliga spec (PAGES-01/02, RESP-*, CUS-01–03, PROP-01–03, STAFF-01/02, ROLE-01/02, ART-01, FLOW-01, ADMIN-01, TASK-01/02, PERM-04, PERF-01, G12-01, XSS-01, VAT-01, BRAND-01, RENDER-01) | 28/29 godkända; RENDER-01 överskred 90 s (se nedan) — godkänd efter uppdelningen |
| **Hela sviten**, en gång (`node tests/e2e/run.js`, 944 s, maskinen delad med andra arbetsblock) | 133 test: **129 godkända, 2 misslyckade, 1 blockerad (PERM-03), 1 känt fel (AO-07)**. Misslyckade: RENDER-01 (tidsgräns 90 s, se nedan) och IMG-03 (`waitForFunction` 6 s under last; godkänd vid omkörning ensam, 3,3 s — arbetsorderloggens bilder, inte registren). Helsviten kördes före uppdelningen av RENDER-01 och har inte körts om. |
| RENDER-01 efter uppdelning | **RENDER-01 godkänd 61 s** (admin, arbetsledare) + **RENDER-01B godkänd 32 s** (ekonomi, fält) |
| `bash tests/run-all.sh` | **15/19 gröna, 0 misslyckade**, 4 överhoppade (ingen lokal PostgreSQL i miljön: checklist_progress_sql, offer_attachment_upload del 2–3, server_rpcs_sql, staging_backup_export) |

**RENDER-01 och tidsgränsen.** `run.js` har en gemensam gräns på 90 s per test och läser inte testens egen `timeout`. RENDER-01 klickar varje flik och filterchip på varje sida för fyra roller. Mätt utan annan last: baslinjen `9bdb701` 85 s, med registerändringarna 93 s (fler chips i Kunder, Artiklar och Uppgifter samt flikarna i Prisgrupper). Under last från parallella körningar: 91 s på baslinjen. Därför är testet delat per roll i `23_render.js` (RENDER-01 admin/arbetsledare, RENDER-01B ekonomi/fält). Kontrollerna är exakt desamma. Statusfiltren i registren är `aria-pressed`-knappar och klass-namnet för tabellen är `rg-tbl`, så RENDER-01:s väljare `[class*="-tab"]` inte klickar på hela tabellen. Alla flik- och filterlägen i registren kontrolleras dessutom av REG-UI-11. **Förslag (inte gjort, fil utanför blocket):** låt `run.js` använda `t.timeout || TIMEOUT`.

## 8. Öppet / kräver beslut
- **Personal:** `_toggleActive()` saknar fortfarande skydd mot att inaktivera sig själv eller sista superadmin (känt sedan SPRINT1 §15) och sparar med `persist()` utan serverbekräftelse före beskedet. Affärsregel — inte ändrad.
- **Offerttjänster:** "Ny tjänst" skapar posten direkt (före Spara); Avbryt lämnar en "Ny tjänst" kvar. Befintligt beteende — inte ändrat.
- **Prisgrupper:** Aktivera/Inaktivera i redigeringsdialogen sker utan bekräftelse och utan serverbekräftelse (befintligt).
- **Kundkortet** (annat arbetsblock): `tel:`/`mailto:` saknas; huvudets knappar radbryts på mobil (F-10).
- **RENDER-01** (befintlig spec, uppdelad här): tidsgränsen i `run.js` borde respektera testens egen `timeout` (§7). När flera arbetsblock lägger till flikar/chips växer körtiden igen.
- **Sammanfogning:** `CustomersPage.js` ändras också av kundkortsblocket. Mina ändringar ligger bara i `CustomersPage.render/renderList` (+ `_status`, `_normFilters`, `_setStatus`, `_setType`, `_clearFilters`) före `_bulkSetInactive` — inget i `CustomerDetailPage`. I `PageShells.js` ligger alla ändringar inom mina sex objekt och i `RegisterUi` (mellan `PropertiesPage` och `ArticlesPage`). `PropertyDetailPage.js` är inte ändrad.
- **index.html:** `PageShells.js?v=189` (från 188), `CustomersPage.js?v=41` (från 40), `v3-register.css?v=2` (från 1). Kommer andra block att höja samma filer måste numret vid sammanfogningen bli högre än alla grenars.
