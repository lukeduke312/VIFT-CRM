# Fakturering — faktureringskön (6A) och fakturaunderlagets detalj (6B)

Nattkörning 2026-11-26, arbetsblock **billing**. Filer: `src/pages/InvoicesPage.js` (v40 → v41),
`src/styles/v3-billing.css` (v1 → v2), `index.html` (endast de två versionsnumren). Nya tester:
`tests/e2e/specs/28_billing.js` (BILL-01 … BILL-11). Allt är verifierat mot den simulerade
backenden (fake-backend) — inget är kört mot STAGING eller LIVE, och inga datamängder har lagts i
STAGING. Följer `docs/V3-KOMPONENTSTANDARD.md` (se avsnittet längst ner).

**Ingen affärslogik är ändrad.** `BillingQueueService.js` och `InvoiceService.js` är orörda:
kandidatbyggandet, anspråken (sourceKey), beloppen, momsen, prislogiken, idempotensen, statusarna
och statusövergångarna är desamma. Summeringen (`calcSummary`) räknar inte fel — den avrundar en
gång på radernas exakta summa; det som saknades var etiketter och en synlig öresavrundning
(se 6B.1). Ändringarna är presentation, markering och hur bekräftelsedialogen skickar vidare
urvalet (6A.7).

---

## 6A — Faktureringskön ("Att fakturera")

### 6A.1 Kompakt standardläge
*Före:* kund → fastighet → AO → varje tidpost/materialrad var alltid utfällt (`fore-ko-1366.png`:
1 963 px hög sida för 5 kunder, `fore-ko-390.png`: 2 302 px).
*Efter:* en rad per kund med kryssruta, pil, namn, **antal AO**, **antal underlag**, **antal som
kräver åtgärd**, **"x av y valda"** och **belopp exkl. moms** (`efter-ko-1366.png`: 810 px,
`efter-ko-390.png`: ~1 000 px). Pilen (eller klick på raden) fäller ut fastighet → AO-rader (antal
underlag, timmar med decimalkomma, material, senaste datum, "Öppna AO") → enskilda underlag (typ,
datum, personal, "Ej attesterad", antal × à-pris, moms %). "Visa alla rader" / "Fäll ihop".
Pilknapparna är riktiga knappar (`aria-expanded`, `aria-label`, `title`, fokus står kvar).

### 6A.2 Markering och klistrad summering av VALT underlag
- Valda rader och grupper markeras; varje grupp visar "3 av 7 valda".
- Klistrad ruta **"Valt underlag"**: antal valda, antal kunder → antal fakturautkast, **Exkl. moms**,
  **Moms**, **Inkl. moms**, "Avmarkera" och **"Skapa fakturautkast"** (endast `invoice_create`).
- Summan räknas som de utkast som skapas: ett per kund, rader = antal × à-pris med kandidatens
  momssats, summerat med `InvoiceService.calcSummary()` (samma funktion som detaljvyn).
- Hela köns total står i huvudet, märkt **"Hela kön · redo att fakturera … exkl. moms"**.
- Appens delade flytande markeringsrad (`#_selbar`) döljs med CSS när kön visas
  (`body:has(#pg-invoices.active #bq-list)`) — rutan har samma åtgärder. Dess text säger nu
  "… kr exkl. moms" (förut belopp utan moms-etikett).
- Mobil: rutan ligger ovanför bottenmenyn (`--mobile-bottom-reserve`), knapparna är 44 px.

### 6A.3 Filter, sök, sortering, volymer
- Sök (fältet ritas aldrig om, 150 ms fördröjning), visa-chips **Alla / Redo att fakturera / Kräver
  åtgärd** med antal (`.chip`/`.chip-n`/`.chip-danger`), filter Kund/Fastighet/Typ/Period (samma
  logik som förut), ny **Sortera** (belopp — standard som förut, kund A–Ö med numerisk ordning,
  datum äldst först, kräver åtgärd). "Visar X av Y underlag" står alltid; "Rensa filter" när något
  filter är aktivt. Mobil: filtren bakom "Filter och sortering (n)".
- Progressiv rendering: 30 kundgrupper/åtgärdskort åt gången + "Visa fler kunder (N kvar)".
- Uppmätt (BILL-06, lokal Chromium, simulerad backend, inklusive `getCandidates()`; demodatat ger
  +17 kandidater):

| Kandidater | Kompakt rendering (median) | Välj alla / avmarkera | Visa alla rader |
|---|---|---|---|
| 10 (27) | 2 ms | 15 / 8 ms | 17 ms (27 rader) |
| 100 (117) | 3,9 ms | 14 / 4 ms | 26 ms (117 rader) |
| 1000 (1017) | 10 ms | 31 / 4 ms | 54 ms (282 rader, 30 kunder) |

  Budget i testet: kompakt ≤ 400 ms, markering/utfällning ≤ 1 500 ms vid 1 000 kandidater.
  Granskat visuellt med 100 och 1 000 kandidater (`efter-ko-100-kandidater-*`,
  `efter-ko-1000-kandidater-*`, `efter-ko-expanderad-markerad-1000-kandidater-*`).

### 6A.4 Delvis markerade grupper och bulkmarkering
- Kund-, fastighets- och AO-kryssrutor har tre lägen och texten "x av y valda". Klick på en delvis
  markerad grupp markerar alla gruppens underlag (samma beteende som förut).
- En grupps kryssruta omfattar gruppens **valbara underlag som matchar filtret**.
- "Välj alla" heter **"Välj alla N som matchar filtret"** (utan filter "… som kan faktureras") och
  markerar exakt de N — även i ihopfällda grupper och efter de 30 första.
- Markeringen ligger kvar när filtret ändras (som förut), men valda som inte syns sägs ut:
  "2 av de valda syns inte med nuvarande filter men ingår" + **"Avmarkera dolda"**; dialogen säger
  detsamma. Valda som inte längre kan faktureras räknas separat.

### 6A.5 Kräver åtgärd
"N poster kräver åtgärd" i huvudet och chipet filtrerar med ett klick. Varje post är ett kort med
typ, beskrivning, kund, AO, datum, personal, **orsakerna** (exakt strängarna från
`BillingQueueService.getCandidates()`), en förklaring och direkta åtgärder:

| Orsak (beräknas i koden) | Förklaring | Direkt åtgärd (befintlig funktion, behörighet) |
|---|---|---|
| Väntar på serverbekräftelse | Inte bekräftad av servern; kön uppdateras själv | Öppna AO |
| Saknar arbetsorder (tid) | Tidposten är inte kopplad till någon AO | Öppna Tid & stämpla (om sidan får visas) |
| Arbetsorder hittades inte | AO:n finns inte längre | — |
| AO saknar prismodell | Varken löpande eller fast pris | **Sätt prissättning** → `WorkOrderDetailPage.openPricingModal()` (`ao_edit` eller `invoice_create`, AO som inte redan har ett fakturaunderlag) + Öppna AO |
| AO saknar kund | Underlag skapas per kund | Öppna AO |
| Saknar timpris | 0 kr/tim | Sätt prissättning + Öppna AO |
| Ogiltigt belopp | 0 kr eller ogiltigt | Öppna AO |
| Saknar försäljningspris (material) | 0 kr | **Ändra materialpris** → `WorkOrderDetailPage.openEditMaterial()` (`ao_material`) + Öppna AO |
| Ogiltig momssats (material) | Måste vara 0–100 % | Öppna AO |
| Saknar fastpris | Fast pris utan belopp | Sätt prissättning + Öppna AO |

**Beräknas INTE av logiken och visas därför inte som spärr:** "redan fakturerad" (anspråkade
underlag tas bort ur kön), dubbletter, fel kund, attest. "Ej attesterad" är bara information på
tidraden. AO:er med äldre (icke källmedvetna) fakturor döljs helt av `_legacyExcludedAoIds()`.
Åtgärdsposter ingår aldrig i någon summa (beloppet överstruket, "ingår ej").

### 6A.6 Summor
- Huvudet: Tid + Material + Fastpris = totalen (öre), samma tal som `getSummary()` (BILL-01).
- Kundraderna summerar till totalen; varje kundrad = summan av kundens valbara underlag (BILL-01).
- Filtrerat urval: "**Summa för filtrerat urval: … exkl. moms**"; köns total ändras inte (BILL-01).
- Belopp visas med öre i kön, dialogen och detaljen (förut `fkr()` = hela kronor: 3,5 h × 695 kr
  visades 2 433 kr och delsummorna gick inte att stämma av). Antal med decimalkomma ("3,5 tim").

### 6A.7 Skapa underlag från urval — ingen dubbelfakturering
- Dialogen (titel med ikon) visar per kund exkl. moms och totalt exkl./moms/inkl.; knappen visar
  "Skapar…" medan servern svarar.
- `_confirmCreate()` skickar **exakt de id:n som förhandsgranskades** (förut: markeringen vid
  klicket — samma i praktiken). Ogiltiga id:n filtreras inte bort i UI:t: BillingQueueService
  revaliderar och skapar inget alls om något underlag inte längre kan faktureras (oförändrat).
- BILL-04: tre underlag från två kunder → två utkast med exakt de tre sourceKeys; utkastens
  `calcSummary()` = summeringen; raderna försvinner ur kön, övriga ligger kvar, totalen minskar med
  exakt exkl.-summan; samma urval igen nekas och inget skapas.

### 6A.8 Mobil 390 px (uppgiftsbaserat, BILL-10)
Välja underlag per kund eller fastighet, se vald summa (exkl./moms/inkl.) ovanför bottenmenyn,
skapa underlaget, öppna det och läsa raderna utan sidscroll (ett kort per rad med märkta värden),
och byta status via "Byt status" — hela flödet körs i BILL-10 på 390 px. BILL-07 kontrollerar
360/390/768/1024/1366/1920 px utan överbredd och utan klippt innehåll i rader, kort och huvud.

---

## 6B — Fakturaunderlagets detalj (pg-inv-detail)

### 6B.1 Radbelopp mot summor — "1 tim × 430 kr = 537,50 kr"
Radrenderaren visade **ex + moms** som radens stora belopp utan etikett (litet "ex 430 kr" bredvid):
1 tim × 430 kr blev 537,50 kr (= 430 kr exkl. + 25 % moms), medan summeringen visade 860 kr exkl.
och 1 075 kr inkl. (två sådana rader). Beloppen stämde, etiketterna saknades.
`calcSummary()`: `linesEx = Σ antal × à-pris`, `vat = round(Σ rad × sats × (1 − rabatt/linesEx))`,
`exVat = round(linesEx − rabatt)`, `totalInclVat = exVat + vat` — **oförändrad**.

*Efter:* tabell (dator) / kort per rad (smal kolumn, via container query ≤ 600 px) med
**Beskrivning · Antal · À-pris exkl. moms · Moms (%) · Belopp exkl. moms** — varje rad har samma
bas som rubriken. Under raderna: **Summa exkl. moms** (vid rabatt: Summa rader exkl. moms − Rabatt
= Summa exkl. moms efter rabatt), **Moms** (vid flera satser "varav 25 % av …", "varav 12 % av …",
"varav 0 % av …"), **Totalt inkl. moms**, ROT/RUT och "Kunden betalar", samt texten "Radbeloppen
ovan är exkl. moms. Momsen läggs på per momssats och räknas på radernas exakta belopp."
- **Öresavrundning:** radbelopp visas i hela ören, summan räknas på radernas exakta värden. När det
  skiljer (t.ex. 2 × 2,5 m × 19,99 kr = 2 × 49,975 kr) visas en märkt rad "Öresavrundning
  (radbeloppen visas i hela ören) + 0,01 kr", så att raderna alltid går att stämma av. Samma för
  momsen per sats ("varav öresavrundning") om den skulle skilja.
- Tester: BILL-05 (blandad 25/12/0 %, med och utan 10 % rabatt, dator och 360 px) och **BILL-09**
  (decimaler och avrundning: 1,33 tim × 595, 1 tim × 430, 3 × 33,33, 2 × 2,5 × 19,99,
  0,75 × 133,33 @12 %): varje radbelopp = antal × à-pris, radens momssats = radens sats, radbelopp +
  öresavrundning = Summa exkl. moms = `calcSummary().exVat`, moms = Σ rad × sats, momsen per sats =
  satsen × satsens underlag, endast-25 %-fallet: moms ≈ 25 % av exkl. (±0,005 — räknas på exakt
  summa), totalt = exkl. + moms, och att 1 tim × 430 kr visas som 430,00 kr exkl. (inte 537,50).
- PDF/utskrift: radbeloppet med öre (förut avrundat till hela kronor), kolumnerna "À-pris exkl. moms"
  och "Belopp exkl. moms"; "Summa exkl. moms".
- Radformuläret: "Timpris/À-pris/Fast pris exkl. moms (kr)", "Summa exkl. moms", "Summa inkl. moms".

### 6B.2 Identitet, status och övrigt
- Huvudet behåller V3-looken och visar **Summa exkl. moms**, **Totalt inkl. moms** och
  förfallodatum; långa underlagsnummer kortas med … på mobil så statusväljaren alltid ryms.
- **Statushjälp** (endast text, statuslogiken är orörd):
  - *Utkast* — kan ändras; rader från kön är reserverade och syns inte i kön; inget har skickats,
    "Markera skickad" registrerar bara att underlaget/PDF:en skickats (VIFT skickar ingen e-post).
  - *Skickad* — markerat som skickat; raderna låsta; markera betald när betalningen kommit.
  - *Förfallen* — skickat men inte betalt efter förfallodatum; sätts manuellt (ingen automatik).
  - *Betald* — betalningen registrerad manuellt; låst.
  - *Makulerad* — ogiltigförklarat; underlagen släpps tillbaka till kön; kan återställas till utkast.
  Bekräftelsedialogerna för skickad/betald/makulerad säger samma sak (BILL-11 kontrollerar
  hjälptext, låsta radknappar och att statusväljaren = tillåtna övergångar för alla fem statusar).
- **Datum och villkor** (faktarutor `dl`): Fakturadatum (= skapad, samma som på PDF:en),
  Förfallodatum (passerat markeras), Betalningsvillkor, Skickad, Betald.
- **Faktureras till** (faktarutor): kund, adress (fakturaadress först, som PDF:en), org.nr, offert,
  referens, OCR.
- **Att kontrollera** (endast utkast, spärrar inget): kund saknas, kunden saknar adress, inga rader,
  rader på 0 kr, förfallodatum saknas.
- Länkar och radknappar läser id ur data-attribut (inga data i inline-hanterare); statusalternativ
  escapas.

### 6B.3 Fakturaunderlag-listan (fliken "Fakturaunderlag")
Inte omgjord, men granskad med alla statusar (`efter-lista-statusar-*`): belopp märkta "inkl. moms"
(rad och KPI), AO-ikonen på samma rad som texten, flikantal i `.ft-n`, id:n via data-attribut i
radernas klickhanterare.

---

## Skärmbilder (`docs/qa-2026-11-26/fore-efter/billing/`, 390 och 1366 px, deviceScaleFactor 1)
- `fore-ko-*` / `efter-ko-*` — kön med demodata (före: allt utfällt; efter: kompakt).
- `fore-ko-kraver-atgard-qadata-*` / `efter-ko-kraver-atgard-qadata-*` — två åtgärdsposter.
- `efter-ko-expanderad-markerad-qadata-*` — utfälld, delvis markerad, klistrad summering (ingen
  före-bild: före var allt alltid utfällt).
- `efter-ko-100-kandidater-*`, `efter-ko-1000-kandidater-*`, `efter-ko-kraver-atgard-1000-kandidater-*`,
  `efter-ko-expanderad-markerad-1000-kandidater-*` — volymer.
- `fore-detalj-*` / `efter-detalj-*` — INV-003 (demodata).
- `fore-detalj-qadata-*` / `efter-detalj-qadata-*` — blandad moms 25/12/0 % (före: "2 tim × 430 kr"
  med 1 075 kr utan etikett; efter: 860,00 kr exkl. moms + momskolumn).
- `efter-detalj-dec-*` — decimaler med synlig öresavrundning; `efter-detalj-skickad-*`,
  `efter-detalj-mak-*` — skickad och makulerad.
- `efter-lista-statusar-*` — Fakturaunderlag-listan med utkast/skickade/betalda/förfallna/makulerade.

## Tester
Nya (`tests/e2e/specs/28_billing.js`): BILL-01 grupper = tjänstens totaler; BILL-02 tre lägen,
filtrerad Välj alla, dolda valda, tangentbord; BILL-03 Kräver åtgärd + behörighetsstyrda åtgärder
(admin/ekonomi); BILL-04 delvis urval → utkast utan dubbelfakturering; BILL-05 moms 25/12/0 % med
och utan rabatt; BILL-06 renderingsbudget 10/100/1000; BILL-07 ingen överbredd/klippning
360–1920; BILL-08 XSS i utfälld kö, åtgärdsvy, dialog och detalj; BILL-09 decimaler och avrundning;
BILL-10 mobilflöde 390 px; BILL-11 alla statusar, lista, långa namn och tom kö på 360 px.

Ändrade befintliga (endast selektorer — inga kontroller borttagna eller försvagade):
- `06_economy.js` FLOW-01, ECO-01 och `16_stabilization.js` G10-01: kön är ihopfälld som standard,
  så testet klickar "Visa alla rader" innan underlagen kryssas och hittar kryssrutan via
  `#bq-list input._sel-cb[data-sel-id="…"]` i stället för `input[onchange*="SelectionModel.toggle('…')"]`
  (radens kryssruta har inte längre inline-onchange med data — händelserna delegeras).
- `20_v3_mobil.js` ECO-V3-02: samma kontroller (rader i sin AO, indrag kund < AO < rad, etiketter,
  tre lägen, Välj alla/avmarkera) mot de nya klasserna efter "Visa alla rader".

Resultat: se "Körningar" nedan.

## Komponentstandard (docs/V3-KOMPONENTSTANDARD.md) — hur den följs
§1 ingen egen sidrubrik, innehållsbredd max 1 440 px; en primär åtgärd per sektion ("Skapa
fakturautkast" i summeringen). §2 knappar `bp/bs/bghost/bd`, ikon + text i inline-flex, ikonknappar
med `aria-label` + `title`, ≥ 40 px på mobil (BILL-07). §4 vybyte `.ftabs/.ft` med `.ft-n`,
snabbfilter `.chip/.chip-n/.chip-danger`, "Rensa filter". §5 sökikonen eget element, `type=search`,
`aria-label`, bara listan ritas om, 150 ms, "Visar X av Y". §6 faktarutor `dl/dt/dd` (versaler,
`--muted` / 14 px `--ink`), tomläge `.empty`. §7 radtabell med egen `overflow-x:auto`-behållare,
versal rubrikrad, högerställda tabulära siffror, kort per rad när smal. §8 `sbdg()`; varning orange.
§9 dialog med ikon i titeln, "Skapar…" under sparning. §10 `fmtDate`, belopp alltid med "exkl. moms"
eller "inkl. moms", svensk decimal. Avvikelse: fakturering visar belopp **med öre** (standardens
exempel är "1 234 kr") — nödvändigt för att rader och summor ska gå att stämma av. §11 `esc()` på
all data, RENDER-01/XSS-01/BILL-08 gröna. §12 granskat tomt, få, 100, 1 000, långa namn, saknade
fält (åtgärdsposter), alla fem statusar och rollerna admin/ekonomi.

## Ej gjort / kräver beslut
1. **Anteckningen på fakturaunderlaget skrivs ut på PDF:en** (`_buildPrintHTML`), men fälten hette
   "Intern kommentar (visas ej på faktura)". Beteendet är oförändrat; etiketterna säger nu sanningen
   ("Anteckning (skrivs i dag ut på PDF:en)"). Beslut: intern (PDF:en ska sluta skriva ut den) eller
   kundsynlig?
2. Attest spärrar inte fakturering; "redan fakturerad", dubbletter och "fel kund" beräknas inte som
   åtgärdsorsaker. Inga nya spärregler har införts.
3. AO:er med äldre fakturor (utan källreferenser) döljs helt ur kön — syns inte under Kräver åtgärd.
4. Fakturaunderlag-listan är bara justerad (etiketter, ikoner, antal), inte omgjord; KPI-korten
   visar hela kronor.
5. Fakturadatum är skapandedatumet — det finns inget eget fakturadatumfält.
6. Den delade markeringsraden döljs med CSS `:has()`; i en äldre webbläsare syns den som förut
   (exkl.-moms-märkt) — ingen funktion försvinner.
7. Knappen heter fortfarande "Skapa fakturautkast" (befintliga tester/dialoger); dialogen förklarar
   att det blir ett fakturaunderlag med status Utkast per kund.
8. `SVC-UI-01` (nämns i komponentstandarden) finns inte i denna gren — inte kört här.
