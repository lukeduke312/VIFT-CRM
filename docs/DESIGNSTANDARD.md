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

En term per handling. **"Stämpla in / Stämpla ut / Instämplad"** gäller överallt (tidigare blandades "Klocka in", "Inklockat" och "Stämpla in").

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
