# VIFT CRM — Designstandard

Gäller från 2026-11-23. Mål: ett kompakt, lugnt och professionellt affärssystem. VIFT:s logotyp, marinblå/blå färgidentitet och befintliga komponenter behålls. Standarden konsoliderar det som finns och är ingen ny design. Token-värden finns i `src/styles/tokens.css`. De gemensamma reglerna ligger samlade sist i `src/styles/components.css` (avsnittet "DESIGNSTANDARD 2026-11"), plus formulärrytmen i `forms.css`.

## Typografi

| Token | Storlek | Användning |
|---|---|---|
| `--fs-2xs` | 10 px | Statusmärken, mikroetiketter. **Minsta tillåtna storlek.** |
| `--fs-xs` | 11 px | Metadata, tabellhuvuden |
| `--fs-sm` | 12 px | Sekundär text, filter, verktygsrader |
| `--fs-md` | 13 px | Brödtext, formulär, korttitlar (`.card-header h3`) |
| `--fs-lg` | 15 px | Rubriken i en detaljsidas åtgärdsrad, sektionsrubriker |
| `--fs-xl` | 18 px | Sidrubrik i innehåll |
| `--fs-2xl` | 24 px | Nyckeltal |

Ny kod använder tokens, inte egna px-värden. 9 px är förbjudet: en övergångsregel lyfter befintliga inline-9px till 10 px tills de flyttats till klasser.

## Avstånd

4-px-steg: `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 · `--sp-6` 24. Kort har 12–16 px innerluft. Formulär har **12 px** mellan fält, alltid. Gruppen (`.g2`/`.g3`) bär marginalen; fälten i en grupp har ingen egen.

## Knappar

- **En primärknapp (fylld marinblå) per vy eller område.** Övriga är sekundära (`bs`) eller spökknappar (`bghost`).
- Grönt (`bsu`) bara för huvudhandlingen i ett fältflöde: "Starta arbete", "Stämpla in". Inte för sekundära saker som "Uppföljning".
- Rött (`bd`) bara för destruktivt. "Inaktivera" är inte destruktivt och är sekundär.
- Mobil: minsta tryckyta `--ctl-h-touch` (44 px). Åtgärdsknappar i AO-detaljen ligger i ett tvåkolumnsrutnät utan ensamma rader.
- Dator: höjd `--ctl-h` (34 px) i verktygsrader. Stora fullbreddsknappar bara på mobil (stämpelknappen har normal bredd på dator).

## Ordval

En term per handling: **"Stämpla in / Stämpla ut / Instämplad"** (tidigare blandades "Klocka in", "Inklockat" och "Stämpla in"). Genomfört i knappar och statusetiketter (AO-detalj, Tid & stämpla, Mina jobb, mobilmenyn, dashboardens snabbknapp). **Ej genomfört än:** ett tiotal toast- och felmeddelanden ("Inklockat", "Kunde inte klocka in/ut", "Du är inklockat på ett annat jobb") i AO-detalj, Tid & stämpla och Mina jobb, samt "inklockad" i Dagens drift. Förs som återstående punkt.

## Kort, listor och uppgiftsrader

- Etikett/värde i breda kort: klassen `kv` placerar värdet direkt efter etiketten (tidigare längst ut till höger, med lång ögonrörelse). Summeringar (fakturans totaler) behåller högerjustering.
- Listor: en rad per post, status som märke till höger, chevron för "öppna".

## Filter och sökning

- Sökfält först och brett. Väljare i naturlig bredd (140–220 px) på samma rad, radbrytning vid behov. Aldrig fullbreddsväljare staplade under varandra.
- Alla filterväljare har samma höjd, oavsett komponent (`select`, `CustomSelect`, `CustomerPicker`) (`.filter-panel-row`).
- Räknare i filterchips är neutrala. Röd räknare betyder "kräver åtgärd" och används bara där det stämmer.

## Statusmärken

En form: ljus bakgrund, färgad text, 10 px, halvfet (`.bdg`). Semantiska färger: grönt = klart/aktiv, orange = pågår/varning, rött = akut/fel, blått = planerad/info, grått = neutralt.

## Tomma lägen

Förklara vad sidan är till för och erbjud nästa steg ("Inga projekt ännu" + "Skapa första projektet"). "Inga träffar" används bara när ett filter är aktivt.

## Sparstatus

"Sparar…" → besked först efter serverns bekräftelse (`confirmPersist`, `commitElementChange`, AO-utkorgens `onSettled`). Vid avslag: tydligt fel och återställning. Osäkra utfall hålls kvar som "osparad ändring" med Återuppta/Kasta.

## Fokus och tillgänglighet

Synlig fokusring (2 px, `--sky`) på alla knappar och fält vid tangentbordsnavigering.

## Kalender och karta

- Överlappande händelser ritas sida vid sida och titlar radbryts.
- Flera AO på samma plats visas som en markör med antal; olika adresser grupperas aldrig ihop.

## Arbetssätt

Före och efter en större UI-ändring: `node tests/e2e/visual.js capture <katalog>` och `compare <före> <efter>`. Bilderna **granskas visuellt**. En vy räknas inte som granskad bara för att ett automatiskt layouttest är grönt.

---

## V3 — designsystem (gren `claude/vift-v3-major-redesign`)

Allt nedan finns i `src/styles/system.css` (laddas sist) och `src/components/UiKit.js`. Sidspecifika stilar ärver härifrån; ändra i systemet först, inte på varje sida.

**Identitet.** Sidomenyn är kvar i VIFT-marinblått. Topprad, innehåll och kort är ljusa och lugna: kall neutral bakgrund (`--canvas`), vita ytor (`--surface`) med tunn kant (`--line`), en accent (`--accent`) för fokus och länkar. Semantiska färger (`--ok`, `--warn`, `--danger`, `--info`, `--violet`) är fristående från accenten och används bara för status.

**Variabler.** Färg: `--ink`, `--ink-2`, `--muted`, `--faint`, `--line`, `--line-2`, `--canvas`, `--surface`, `--surface-2`, `--hover`. Form: `--radius-lg` 12, `--radius` 10, `--radius-sm` 8. Kontroller: `--ctl-h` 36, `--ctl-h-sm` 30, `--ctl-h-xs` 24 (på mobil minst 36). De gamla namnen (`--tx`, `--mt`, `--br`, `--bg`, `--sky`, `--rd` …) pekar på de nya, så äldre stilar följer med.

**Komponenter.**
- Knappar: `.btn.bp` (en primär åtgärd per vy, solid marinblå), `.bs` (sekundär, vit med kant), `.bghost` (tertiär), `.bd` (destruktiv), `.ibtn` (ikonknapp).
- Statusmärke: `sbdg()` ger punkt + text (`.bdg.st`). Kategori: `catBadge()` ger neutral etikett med färgruta (`.cat-tag`). Prioritet: `pbdg()`; akut har röd markering.
- Flikar: `.ftabs/.ft` är en segmenterad kontroll; antal visas med `.ft-n`.
- Snabbfilter: `UiKit.chip(label, onclick, {on, n, icon, tone})` → `.chip`.
- Personal: `UiKit.avatar(staff)`, `UiKit.avatarStack(ids, max)` (tom → streckad ring "Ingen tilldelad").
- Datum: `UiKit.dayLabel('YYYY-MM-DD')` → "Idag", "Imorgon", "Igår", "ons 26 nov", "3 mar 2027". `UiKit.localDate()` använder lokal tid.
- Tabell: `.dt-wrap > .dt-scroll > table.dt` med `.c-num`, `.c-shrink`. Raden blir kort på smal skärm (se arbetsorderlistan).
- Tomt läge: `.empty` med ikon, rubrik, en mening och en åtgärd.

**Regler.**
- En definition per begrepp: "försenad" = `WorkOrderService.isOverdue()`, "aktiv" = `isAlive()`, "nästa steg" = `nextStep()`. Dashboard, listor och detaljvyer använder samma funktioner så att siffror och listor alltid stämmer överens.
- Nyckeltal ska vara klickbara och leda till exakt det urval de räknar.
- Info som hör ihop visas ihop: arbetsordern svarar på vad, var, när, vem och nästa steg innan detaljer.
- Mobil: fältordning (vad → var → när → vem → stämpla → checklista), tryckytor minst 36 px, ingen vågrät scroll.

**Kontrast.** All text klarar WCAG AA (4,5:1) mot vit yta: `--ink` 17,1, `--ink-2` 11,5, `--muted` 5,1, `--faint` 4,7 (omgång 2, tidigare 3,0); märken mot sin bakgrund 4,5–5,5.

**Mobila arbetsordrar (omgång 2).** Snabbåtgärdsraden `.aod-qbar` sitter fast ovanför bottenmenyn (`--mobile-bottom-reserve`) under 1 024 px. Sidans primära åtgärd har full bredd; sekundära är diskreta. Filter och flikar får aldrig ligga dolda utanför skärmen på 360–390 px — använd rullista eller radbrytning.

**Granskning.** `node tests/e2e/measure.js` mäter sidhöjd och scrollavstånd till viktiga åtgärder. `VIFT_VISUAL_SIZES=alla node tests/e2e/visual.js capture <katalog>` tar alla vyer i 1920, 1366, 1024, 768, 390 och 360 px; `compare <före> <efter>` ger pixeldiff och `sheet` kontaktark.
