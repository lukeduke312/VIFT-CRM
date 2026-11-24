# VIFT CRM – V3 komponentstandard (bindande, 2026-11-26)

Samma slags funktion ska se ut och bete sig likadant i hela systemet. Grunden är tokens och klasser i `src/styles/system.css` och hjälpfunktionerna i `src/components/UiKit.js`.

Förebilder:
- arbetsorderlistan (`aol-*`);
- arbetsorderdetaljens huvud (`aod-*`);
- fakturaunderlagets huvud (`doc-*`);
- säljchanser (`so-*`);
- dashboardens tavla (`dt-*`).

## 1. Sidstruktur
- **Rubrik:** sidtiteln visas i topbaren (`.topbar-title`). Sidan upprepar den inte som egen h1/h2.
- **Verktygsrad överst:** sök till vänster, filter, och **en** primär åtgärd ("+ Ny …") till höger.
  - På mobil: sök på egen rad, filter under.
  - Import, Export och andra sekundära åtgärder ligger i en "⋮"-meny.
- **Innehållsbredd:** registerlistor och kortgrid begränsas på breda skärmar, ca 1 280–1 440 px för listor. Alternativt används flera kolumner, så att raderna inte blir 1 500 px breda med tomrum.

## 2. Knappar
| Roll | Klass | Regel |
|---|---|---|
| Primär | `btn bp` | Högst en per vy eller sektion |
| Sekundär | `btn bs` | – |
| Tertiär/länkartad | `btn bghost` | – |
| Destruktiv | `btn bd` | Alltid med bekräftelse |
| Liten storlek | `bsm` | – |
| Mycket liten storlek | `bxs` | – |

- Ikon och text. Ikonen är `ic(...)` som betrodd markup, texten escapas.
- Enbart ikon (`.ibtn`) bara där betydelsen är självklar, och alltid med `aria-label` och `title`.
- Tryckyta ≥ 40 px på mobil.
- Ikoner får aldrig hamna på egen rad (globalt `svg{display:block}`). Lägg knappinnehåll i inline-flex med `gap`.

## 3. Åtgärdsmeny
- "⋮" (`.ibtn`, `aria-label="Fler åtgärder"`) öppnar en meny enligt mönstret `aoToggleOverflow`/`.ao-overflow-wrap`.
- Menyposterna har ikon och text och är grupperade.
- Destruktiva poster ligger sist, avskilda, i röd text och med bekräftelse.
- Inga funktioner får försvinna. Det som inte syns som knapp ska finnas i menyn.

## 4. Flikar och filter
- **Byte mellan vyer eller sektioner:** `.ftabs` + `.ft` (segment), med aktiv `.ft.on`.
  - Får aldrig dölja flikar.
  - Fler än ca 5 flikar på mobil: radbryt, eller visa en `select`/meny med aktuell flik.
  - Antal visas i `.ft-n`.
- **Snabbfilter:** `.chip` med `.chip-n` för antal, aktiv `.chip.on`, `.chip-danger` för förfallet/akut.
- **Statusfilter:** samma chips, eller en `select` om de är många.
- Snabbval (Mina, Idag, Försenade …) och statusfilter är olika typer. De visas som separata grupper.
- "Rensa filter" visas när något filter är aktivt.
- Mörka pillerknappar och `btn bp/bs` som flikar används inte.

## 5. Sök
- Ikon som eget element bredvid fältet, inte i placeholder (jfr Serviceintervall-felet). Fältet har `type="search"` och `aria-label`.
- Sökningen renderar bara om resultatlistan, aldrig fältet självt (fokus ska behållas). Fördröjning 120–200 ms.
- Antal visas: "Visar X av Y".

## 6. Kort och listor
- **Kort:** `.card` > `.card-header` (h3 + ev. åtgärd till höger) > `.card-body`.
- **Rader:** `.list-item` med titel (`.list-item-v2-title`), metarad (`.list-item-v2-meta`) och märken till höger.
- **Faktarutor:** `dl` med `dt` (versaler, 11–12 px, `--muted`) och `dd` (14 px, `--ink`). Mönstret finns i `aod-fact` och `si2-facts`.
- **Tomläge:** `.empty` med ikon, h3, en mening och en åtgärd om sådan finns.

## 7. Tabeller
- Dator: tabell i ett kort med egen `overflow-x:auto`-behållare. Sidan scrollar aldrig horisontellt.
- Rubrikrad i `--muted` versaler, cellutfyllnad ≥ 8 × 12 px, siffror högerställda med `font-variant-numeric: tabular-nums`.
- Mobil (≤ 600 px): kort per rad, i stället för en smal tabell.

## 8. Status och prioritet
- AO-status: `sbdg(status)`. Prioritet: `pbdg(prio)`. Övrigt: `.bdg .bdg-*`.
- Semantiska färger: ok = grön, warn = orange, danger = röd. Accentfärgen används inte för status.
- Statustext ska vara läsbar: kontrast ≥ 4,5:1 för text och ≥ 3:1 för UI-gränser.

## 9. Formulär och dialoger
- Fält: `.fg` > `label` + kontroll. Validering visas vid fältet och i en sammanfattning vid sparning.
- **Sparning:** knappen visar "Sparar…". Beskedet "Sparat" kommer först när servern bekräftat. Fel visas tydligt med orsak och vad användaren kan göra.
- **Dialog (`Modal.open`):** titel = ikon + text. Primärknappen till höger, "Avbryt" sekundär. Destruktiv åtgärd kräver bekräftelse.

## 10. Format
- Datum: `fmtDate` ("26 nov. 2026"). Tid: "08:00".
- Belopp: "1 234 kr", alltid med **exkl. moms** eller **inkl. moms** utskrivet.
- Timmar: svensk decimal ("26,5 h").

## 11. Säkerhet i mallar
- All data-härledd text i HTML ska gå genom `esc()`.
- Betrodd ikonmarkup (`ic()`) får aldrig ligga inne i ett attribut (placeholder, title, value) och får aldrig escapas.
- Regressionstesterna RENDER-01, XSS-01 och SVC-UI-01 ska vara gröna.

## 12. Testa med verkligt innehåll
- En vy är inte granskad förrän den visats med realistiskt innehåll i **alla relevanta statusar**: tom, få, många (100–1 000), långa namn, saknade fält och olika roller.
- Tomlägesbilder räcker inte. Serviceintervall såg rätt ut tom men var trasig med data.
