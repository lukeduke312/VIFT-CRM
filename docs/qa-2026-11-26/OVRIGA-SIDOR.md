# Övriga sidor (arbetsblock "misc") — V3 nattkörning 2026-11-26

**Gren/worktree:** utgår från `claude/vift-v3-major-redesign` @ `05058e8`. Allt arbete är lokalt, inga push. Ingen trafik till STAGING, LIVE eller något Supabase-projekt — all granskning och alla tester mot den simulerade servern i `tests/e2e`.

**Versioner i index.html (05058e8 → nu):** v3-misc.css 1→10, ImportWizardPage 11→12, ImportLogPage 2→3, ExportCenterPage 7→8, CustomersPage 40→42, ContractsPage 4→5, ProjectsPage 7→9, ProjectDetailPage 7→11, PropertyDetailPage 36→39, PropertyObjectPage 4→7, RonderingPage 11→12, CalendarPage 3→5, RonderingUtforandePage 13→14, RonderingWizardPage 12→13.

**Filer:** `src/pages/` ProjectsPage, ProjectDetailPage, ContractsPage, ImportWizardPage, ImportLogPage, ExportCenterPage, CalendarPage, PropertyDetailPage, PropertyObjectPage, CustomersPage (bara kundkortets huvud/flikrad), RonderingPage, RonderingWizardPage, RonderingUtforandePage; `src/styles/v3-misc.css`; `tests/e2e/specs/30_misc_ui.js`; testuppdateringar i `tests/e2e/specs/17_map.js` (UI-PROP-01) och `23_render.js` (RENDER-01 per roll), se §6. `?v=` höjt i `index.html` för varje ändrad fil.

Underlag: `docs/qa-2026-11-25/UI-UX-INVENTERING.md` (F-02, F-03, F-06, F-08, F-09, F-10, F-11) och `docs/V3-KOMPONENTSTANDARD.md`.

---

## 1. Kända fel (inventeringen)

| Fynd | Vad som gjordes | Test |
|---|---|---|
| **F-03** Importera 860 px bred på 390 | `.imp-wizard` fick `width:100%; min-width:0` (flexbarnet tog stegradens bredd). Stegraden är nu ett rutnät med sex lika steg på dator och "Steg N av 6" + stapel på mobil — inget kan sticka ut. | MISC-IMP-01 (360/390/1366: guiden ≤ fönstret, inget klipps till höger) |
| **F-11** Inaktiv "Nästa" osynlig | Klasserna `btn-primary/btn-ghost` saknade stil helt. Knapparna är nu `btn bp`/`btn bs` (krokklassen `btn-primary` finns kvar för IMP-01). Inaktiv knapp: fylld, opacitet 0,5, `not-allowed`, med hjälptexten "Välj en fil för att fortsätta". Släppytan centrerad och tangentbordsnåbar, rätt uppladdningsikon (tidigare visades mappikonen, `upload-cloud` finns inte). | MISC-IMP-01 (fylld bakgrund, höjd ≥ 34, blir aktiv efter filval) |
| **F-06** Fastighetskortets flikar dolda på 1366 | Elva flikar blev **åtta grupper** (Översikt, Kontakter & åtkomst, Teknik & besiktning, Service, Arbetsorder, Rondering, Objekt, Bilder & anteckningar) som radbryts i stället för att rulla. Tydlig aktiv flik (`.ft.on` + `aria-selected`), antal i `.ft-n`, varningsprick på Service/Teknik vid försenat. `switchTab()` tar fortfarande de gamla nycklarna (`ansvariga`, `recurring`, `notes`). | MISC-PROP-01 (360/390/1366/1920: alla flikar inom raden, ingen sidledsrullning; klick på varje grupp visar rätt paneler med innehåll); PROP-03 oförändrad och grön |
| **F-08** Kalender vecka oanvändbar på 390 | Under 768 px visas veckan som **sju dagkort** med händelserna som agendarader (tid, titel, kund/plats, personal, status) och dagen som tidsordnad lista. Långtryck på en AO öppnar "Flytta till…" som tidigare (raderna har `data-aoid`). Vyväljaren står på en rad. Datorns rutnät och dra-och-släpp är oförändrade. | MISC-CAL-01, MISC-TASK-02 (nio jobb samma dag, titlar ≥ 150 px breda, ≤ 3–4 rader), CAL-01/02 gröna |
| **F-09** Låg kontrast i rondering | Stegetiketter (9 px `#94a3b8`, 2,1–2,3:1) → 12 px i `--muted/--ink/--ok`; grön statustext `#16a34a` (3,1–3,3:1) → `--ok`; "Ej aktuell" `#9ca3af` (2,5:1) → `--muted`; röd → `--danger`; knappar i utförandet via tokens; "Starta utförande" `bsu`. Korta stegetiketter på mobil (kapades förut till "Rondering…"). | MISC-RON-01 (kontrast beräknad från faktiska färger, alla ≥ 4,5:1 på 390 och 1366) |
| **F-10** Detaljhuvuden 3–4 rader på mobil | Gemensamt huvud `MxUi.detailHead` (i PropertyDetailPage.js) för Fastighetskort, Objekt, Kundkort och Projektkort: tillbaka + namn på en rad (två rader vid mycket långt namn), nummer under, status som märke, **en** primär åtgärd synlig, övriga i "⋮" (`.ibtn` + `aoToggleOverflow`, destruktiva poster sist och avskilda, bekräftelse). På dator visas Redigera/Ny uppgift som knappar. Namnet upprepas inte längre i snabbrad och kort. | MISC-HEAD-01 (390: höjd ≤ 132 px, tillbaka+rubrik samma rad, primär synlig, menyn öppnas med Redigera; 1366: ≤ 96 px), MISC-TASK-03 (långt namn ≤ 156 px), UI-PROP-01 (uppdaterad) |
| **F-12** "Om 1 dagar" | **Ej gjort** — finns i RecurringPage.js som inte ingår i blocket. | – |
| **F-02** Ikon på egen rad | Lokal regel i `v3-misc.css` för blockets sidor (`svg` inline i löptext); `reset.css` orörd. Knappinnehåll i inline-flex. | MISC-ICON-01 (13 vyer × 390/1366: ingen ikon på egen rad) |

**Extra fel som hittades och rättades i blockets filer**
- **Fastighetskortet, Serviceintervall:** `placeholder="${ic('search',11)} Sök…"` lade SVG med citattecken i attributet så att input-taggen bröts och attribut/SVG syntes som text. Nu ren platshållare och ikonen som eget element bredvid fältet (samma i Objekt-fliken). Kontroll i MISC-PROP-02 (ingen synlig text med `="`, `oninput=`, `value=` i någon flik, ingen placeholder med `<`). **Samma fel finns i `ServiceIntervalsPage.js:122`** (inte blockets fil) — bör rättas av ägaren.
- Sökfält som ritades om vid varje tangent tappade fokus efter första tecknet (Fastighetskortets Service/Objekt, Rondering, Projekt, Kontrakt). Nu behålls fokus (Projekt/Kontrakt ritar bara om resultatet, 150 ms fördröjning).
- Fastighetskortet: att spara/ta bort en ansvarig ritade om sidan med `{propertyId}` i stället för `{propId}` → "Välj en fastighet". Bildladdningen skrev över flik nr 7 (Återkommande) med "Bilder (N)".
- Exportcenter: kolumnräknaren uppdaterades aldrig (selektorn `[style*="Kolumner ("]` matchade inget).
- Projektkortet: urvalsknapparna (Alla/Öppna/Klara, dokumenttyper) bytte inte markering vid klick.
- Objektstatusens märke använde odefinierade klasser (`badge-*`) — nu `bdg-*`.
- Saknade ikoner (`upload-cloud`, `tool`, `layout`, `edit-2`, `file`, `cpu`, `share-2` m.fl.) visade mappikonen — ersatta med befintliga.
- Ej escapad data i mallar: telefon/e-post på kontakter, bildkategori/URL, felmeddelanden, personalnamn, AO-id i onclick, ronderingens märken m.m. → `esc()`.

## 2. Fastighetskortet (produktägarens tillägg)

Ordning: **huvud** (namn, nummer/typ, status och klickbara varningar, Ny AO, ⋮) → **faktarad** (adress med Navigera, ägare, öppna AO, yta, lägenheter, våningar, byggår, objekt — en gång) → **flikar** (åtta grupper) → innehåll.
- **Översikt:** varningar först (försenade besiktningar, service som kräver åtgärd), sedan Grundinformation, Öppna arbetsorder (4 närmaste + "Alla"), Ansvariga och kontakter, Service och besiktningar (de närmaste) — varje kort länkar till sin flik.
- **Kontakter & åtkomst:** Kontaktpersoner + Åtkomst & nycklar till vänster, Ansvariga till höger (en spalt på mobil). Portkod/nyckelinfo laddas som förut bara med `objects_sensitive` via `get-sensitive-fields`; övriga ser "Du saknar behörighet…" och inget anrop görs.
- Högerspalten och mobilens snabbrad är borttagna (de upprepade namn, adress, ägare och öppna AO). All information finns kvar.
- Sektionernas "Lägg till" är sekundära; en primär åtgärd per vy.
- **Dokument:** fastigheter har ingen dokumentfunktion i dag (bara bilder och anteckningar) — ingen ny funktion uppfunnen. Kräver beslut.

Tester: MISC-PROP-01..03 (flikar, ingen markup som text, sök med fokus, admin ser portkod / arbetsledare ser den inte och gör inget anrop / fältarbetare nekas sidan), MISC-TASK-03 (adress, portkod, Ny AO, Lägg till objekt, Lägg till serviceintervall på 360/390).

## 3. Moderniserade sidor

- **Projekt:** verktygsrad (sök + Nytt projekt), statuschips `.chip` med antal + Arkiverade som egen grupp, filter (kund/ansvarig/fastighet), Rensa filter, "Visar X av Y", rader `.list-item` med statusmärke och slutdatum (rött om passerat och projektet inte är klart). Ingen dubblerad h1. Räknesemantiken från V54C1 (Alla reagerar på filter/sök, namngivna statuschips är fasta) är oförändrad.
- **Projektkort:** nytt huvud, faktarad (kund, fastighet, ansvarig, antal AO/offerter), flikar som radbryts, filter som chips.
- **Kontrakt:** nyckeltal, statuschips + typfilter, tabell i kort på dator och kort per rad ≤ 600 px, tomläge med åtgärd, datum `fmtDate`, detaljdialog i kv-form.
- **Importera:** se F-03/F-11; nyckeltal i V3-form, ångra-dialog i V3.
- **Importlogg:** rader med status (Genomförd/Ångrad), statistik som märken, "Visa fel", Ångra som `bd` (bekräftelse som förut), datum "24 nov. 2026 10:12".
- **Exportcenter:** två kort (register/format, kolumner), formatval som tydliga alternativ, känsliga fält oförändrat bakom `objects_sensitive`.
- **Kundkort:** endast huvud och flikrad (resten av CustomersPage ägs inte av blocket).
- **Bredd:** listsidor högst 1 320 px och detaljsidor 1 440 px på stora skärmar.

## 4. Före/efter-bilder

`docs/qa-2026-11-26/fore-efter/misc/` (skala 1, 390 × 664 och 1366 × 768):
- `fore-*.png` / `efter-*.png` — före resp. efter, samma vyer och samma data: projekt, projektkort, kontrakt, importera, importlogg, exportcenter, kalender-vecka, fastighetskort, objekt, kundkort, rondering, ny-rondering, utfor-rondering.
- `data-*-{390,1366,1920}.png` — efter, med realistisk mängd (`seedRealistic`: 120 projekt, 114 avtal, 15 importer, nio jobb samma dag, långt fastighetsnamn), även `kalender-dag` och `fastighetskort-langt-namn`.

Bilderna tas med ett skript i sessionens scratchpad som använder `tests/e2e/lib.js` och `seedMisc`/`seedRealistic` ur `30_misc_ui.js` (inte incheckat).

## 5. Tester

**Nya tester (`tests/e2e/specs/30_misc_ui.js`, 13 st, simulerad server):** MISC-IMP-01, MISC-PROP-01, MISC-PROP-02, MISC-PROP-03, MISC-HEAD-01, MISC-CAL-01, MISC-RON-01, MISC-ICON-01, MISC-DATA-01 (120 projekt), MISC-DATA-02 (114 avtal, 15 importer), MISC-TASK-01 (projektkort på mobil), MISC-TASK-02 (kalender, nio jobb samma dag), MISC-TASK-03 (fastighetskort på mobil). Mätbredder 360/390/1366/1920 med skala 1. Kontrasten beräknas från faktiska färger (WCAG-formeln, opacitet inräknad).

**Körningar (2026-11-25, lokal maskin, simulerad server):**
- Hela sviten `node tests/e2e/run.js` på `0366118`: **135 godkända, 0 misslyckade, 1 blockerad (PERM-03), 1 känt fel (AO-07)** av 137, 1 019 s. Där ingår alla 13 MISC-tester, RENDER-01 (fyra roller), XSS-01, BRAND-01, VAT-01, RESP-* (5 bredder), PAGES-01/02 och de befintliga modultesterna för blocket (CUS-01..03, CON-01, PROP-01..03, OBJ-01, RON-01..03, PROJ-01, CAL-01/02, IMP-01/02, EXP-01, MODAL-01, SVC-01..03, UI-PROP-01). Efter körningen ändrades bara namnsträngen i MISC-DATA-02 ("110" → "114 avtal").
- `bash tests/run-all.sh`: **0 misslyckade**, 15/19 testfiler gröna, 4 överhoppade (ingen lokal PostgreSQL — miljön, inte ändringarna; samma fyra som tidigare).
- `tests/service_intervals.test.js`: 38/38 (en kontroll som letar döda `fn:`-knappar träffade först detaljhuvudets åtgärdsbeskrivningar — egenskapen heter nu `onclick`).

**RENDER-01 uppdelad per roll** (`23_render.js`): som ett test tog det 88 s av körarens 90 s-gräns redan på `05058e8` (uppmätt mot ett exporterat paket av basen), och blockets nya flikar/chips (som testet klickar igenom) gav 106 s → timeout. Nu fyra tester (RENDER-01, -CHEF, -EKONOMI, -FALT) med samma kontroller, sidor, flikar och dialoger. Andra block som lägger till flikar/chips påverkar samma budget — samordna vid sammanslagning.

## 6. Ändrade befintliga tester

- **RENDER-01** (`23_render.js`): delad per roll, se §5.
- **UI-PROP-01** (`17_map.js`): mätte den gamla åtgärdsraden (`.ao-action-panel-title`) och krävde att namnet var *dolt* på mobil. Med det nya huvudet är namnet rubrik på alla bredder. Testet kräver nu att rubriken är fastighetens namn, inte kapas, att numret står under och att namnet bara visas **en** gång i sidan (tidigare tre gånger på mobil) — skärpt, inte försvagat.

## 7. Öppet / kräver beslut

- **F-12** och **ServiceIntervalsPage.js:122** (samma placeholder-fel) ligger utanför blocket.
- **Kontraktsbelopp:** standarden kräver "exkl./inkl. moms" vid belopp. Avtalens belopp saknar uppgift om momsbas i datamodellen — inte märkt; kräver beslut.
- **Kontrakt, nyckeltal:** borttagna (deleted) avtal räknas inte längre i Utkast/Avslutade (räknades tidigare).
- **Projektdokument:** uppladdningen anropar EF `project-document-upload` som inte är modellerad i den simulerade servern — testet öppnar dialogen men kan inte slutföra uppladdningen.
- **Fastighetsdokument:** finns inte som funktion (se §2).
- Ronderingsrapport (`RonderingRapportPage.js`) ingår inte i blocket och är inte moderniserad.
