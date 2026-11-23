# VIFT CRM — Visuell granskning 2026-11-23

Metod: skärmbilder tagna med `tests/e2e/visual.js`. Laptop är 1366 px bred med fönstret förlängt till innehållets höjd; mobil är iPhone 13 (390 px, 3×). Data är realistisk demodata mot simulerad backend. Bilderna har **öppnats och bedömts visuellt**, på samma sätt som en användare ser sidan.

**Granskningsnivå per vy:**
- **Detalj:** fullstor bild öppnad och bedömd rad för rad.
- **Översikt:** bedömd i ett kontaktark med 3 vyer per ark. Det räcker för layout, proportioner och tomrum, men inte för text och detaljer.
- **Ej granskad visuellt:** bara automatiska layoutkontroller (RESP-*). Ingen sådan vy räknas som granskad.

Safari/WebKit finns inte i miljön; alla bilder kommer från Chromium. Riktig iPhone/Safari är **ej verifierad**.

| # | Vy | Nivå | Fynd | Åtgärd |
|---|---|---|---|---|
| 1 | Dashboard (laptop) | Detalj | Rubriken "Kräver åtgärd" upprepas (avsnitt + kort). En ensam liten widget på sista raden lämnar stort tomrum (följer användarens sparade layout). Widgetar i samma rad har olika höjd. Kartan överlappade markörer (Vasaplatsen 8). | Kartgruppering byggd (§C). Layout och rubriker kvar, se "Återstår". |
| 2 | Kundregister | Detalj | Rent och proportionerligt. En rad har blå ram utan förklaring (senast öppnad?). | Ingen ändring; noterat. |
| 3 | Kundkort | Detalj, före och efter | Värden långt till höger om etiketten (~1 050 px). Huvudåtgärden "Ny arbetsorder" låg längst ner. | Värden intill etiketten (`kv`); åtgärder flyttade upp. "Redigera" sekundär (efterbilden visade två primärknappar). |
| 4 | Fastigheter (lista) | Översikt | Inga avvikelser i översikt. | — |
| 5 | Fastighetskort | Detalj, före och efter | Namnet fanns bara i sidokolumnen. Fliken "Ansvariga" hade ikonen ovanför texten. "Inaktivera" var orange som en huvudåtgärd. Värden långt från etiketter. | Namnet i åtgärdsraden, ikon i linje, "Inaktivera" sekundär, `kv`. Kvar: sista fliken kapas i kanten; "Snabböversikt" upprepar uppgifter. |
| 6 | Objekt (flik) | Översikt | Inga avvikelser i översikt. | — |
| 7 | Arbetsorderlista | Detalj | Höga rader med mycket tomrum till höger. Märket "Redo fakturering" är fyllt marinblått, avvikande från övriga märken. | "Redo fakturering" är ett ljust `.bdg`-märke. Rättat först i slutkontrollen: den gemensamma `.bdg`-regeln träffade inte märket, som var ett filterchip. Radhöjden står kvar under "Återstår". |
| 8 | Arbetsorderdetalj (laptop) | Detalj, före | Stämpelknappen var grön och ~1 030 px bred. "Uppföljning" var grön som en huvudhandling. | Normal bredd på dator; "Uppföljning" sekundär. |
| 8m | Arbetsorderdetalj (mobil) | Detalj, före och efter | "Starta arbete" och "Klocka in" var två gröna knappar med olika ord för stämpling. "Fler åtgärder" hamnade ensam på en rad. | Ordvalet "Stämpla in" enhetligt; tvåkolumnsrutnät för åtgärderna (rättat efter att efterbilden visade att första regeln träffade fel behållare). |
| 9 | Arbetsorderguide | Översikt | — | — |
| 10 | Mina jobb (mobil) | Detalj | Rubriken "Kommande jobb" var nästan osynlig (färgad med kantfärgen). | Läsbar färg. |
| 11 | Tid & stämpla (mobil) | Detalj, före och efter (mätt) | Fältavståndet växlade mellan 22 och 0 px, så etiketter klistrade sig mot fältet ovanför. Start- och sluttid staplades. "Klocka in" i stället för "Stämpla in". | Jämn 12 px-rytm i alla formulär; start/slut sida vid sida; enhetligt ord. |
| 12 | Personal | Översikt | — | — |
| 13 | Offerter | Översikt | — | — |
| 14 | Offertguide | Detalj | Kundväljaren är högre än övriga fält. "Uppdragsbeskrivning" finns två gånger. Datumformat beror på webbläsarens språk. | Noterat ("Återstår"). |
| 15–16 | Fakturering / fakturakö | Detalj, före och efter | Fyra filterväljare staplades i full bredd (~150 px slöseri). Etiketten "Fastpris · Fastpris" var dubblerad. | Filter på en rad; dubbletten borttagen. |
| 17 | Projekt (tomt läge) | Detalj | Röda "0"-märken på alla statuschips. Filtren hade olika höjd. Tomläget sa "matchar filtret" fast inga projekt finns. | Neutrala räknare, samma höjd, riktigt tomläge med "Skapa första projektet". |
| 18 | Rondering | Översikt | — | — |
| 19 | Avvikelser (rapport) | Översikt | Många ljusblå kort med lite innehåll. | Noterat. |
| 20 | Serviceintervall (tomt läge) | Översikt | Tomläget saknar vägledning om att intervall läggs upp på fastighetskortet. | Noterat. |
| 21 | Kalender (vecka) | Detalj, före och efter | Överlappande AO ritades ovanpå varandra. | Kolumner sida vid sida; titlar radbryts. |
| 22 | Att göra (tomt läge) | Översikt | Bra tomläge med åtgärd. | — |
| 23 | Säljchanser | Översikt | Mycket höga kort; värden långt från etiketter. | `kv`. |
| 24 | Rapporter | Översikt | — | — |
| 25 | Exportcenter | Översikt | Fungerar efter rättningen 2026-11-23 (tidigare helt obrukbart). | — |
| 26 | Admin | Översikt | Företagsuppgifter: värden långt till höger. | Noterat. |
| 27–30 | Dialoger (ny kund, ny tid), faktura- och offertdetalj | Översikt | — | — |

## Mobil

Detaljgranskade: AO-detalj, Mina jobb, Tid & stämpla. Översikt (kontaktark): dashboard, kunder, AO-lista, fakturering. Övriga mobilvyer är bara kontrollerade automatiskt (RESP-*: ingen horisontell scroll, inga knappar utanför skärmen). De är **inte** visuellt granskade.

## Tomma lägen (alla affärsregister tömda, `VIFT_VISUAL_EMPTY=1`)

Granskade i kontaktark:
- **Dator (6 vyer per ark):** dashboard, kundregister, fastigheter, AO-lista, offerter, fakturering.
- **Mobil (3 vyer per ark):** kundregister, AO-lista, Mina jobb.

Nivå: översikt. Rubrik och knappar går att läsa i mobilarket, men brödtexten i dator-arket gör det inte.

Helhetsintrycket är rent. Ingen vy visar "undefined", NaN eller trasig layout. Dashboardens nyckeltal visar 0 och korten har egna tomtexter. Offerter har en tydlig knapp ("Ny offert") i tomläget.

Fynd, inte rättade (släppfrysning, kosmetiskt):
- Fastighetslistans tomläge, "Inga fastigheter", saknar förklarande text och knapp. Kundregistret har en undertext men ingen knapp; knappen finns i verktygsraden.
- "Välj alla" visas trots att listan är tom (kunder, AO).

## Slutkontroll (visuell regression, före → slutläge)

Hela uppsättningen (60 bilder) jämfördes pixel för pixel mellan första före-bilden och slutläget. Varje vy med större skillnad än väntat öppnades och granskades sida vid sida. Tre fel hittades som mina egna ändringar hade orsakat i vyer som bara var översiktsgranskade. Alla tre är rättade och har regressionstest som underkänns mot föregående kod.

| Fynd | Orsak | Rättning | Test |
|---|---|---|---|
| Säljchanser (mobil): varje kort ~20 % högre (+1 300 px på sidan) | `kv`-regeln staplade etikett och värde på smala skärmar | `kv` gäller bara från 768 px; på mobil står etikett och värde på samma rad som förut | UI-KV-01 |
| Fastighets-/objektkort (mobil): rubriken i åtgärdsraden kapades ("Solgläntan Hus A o…"), och namnet stod tre gånger | Den nya namnrubriken fick inte plats på 390 px | På mobil visas bara numret, som förut; namnet visas på dator | UI-PROP-01 |
| AO-lista: "Redo fakturering" fortfarande fyllt marinblått | Se rad 7 ovan | Ljust statusmärke (`bdg bdg-blue`) | UI-BDG-01 |

Övriga skillnader mot före-bilden är avsiktliga och granskade: etikett/värde, knapphierarki, flikar med ikon på samma rad (rapporter, fastighetskort), formulärrytm, fakturakön och kalendern. Ett fynd är inte ett fel i ändringarna: AO-listans ordning mellan poster med lika sorteringsnyckel kan skifta mellan laddningar (instabil sortering). Det förs till masterplanen.

## Tillägg: checklista med tre statuslägen

Granskad i detalj, i fullstorlek, på iPhone 13 och laptop med alla fyra lägena och flera användare (`docs/ui-fore-efter/checklista-laptop-fore-efter.png`, `checklista-mobil-efter.png`).

- Före: alla punkter som inte var utförda såg likadana ut. "OK" sa inte vem eller när, och knapparna var 9 px.
- Efter: ikon och etikett per läge (Pågår orange, Utförd grön, Avvikelse röd) samt vem och kompakt tid ("idag 13:35"). Det finns en huvudknapp per läge (Påbörja, eller Utförd när punkten pågår), och återställ och ta bort visas bara för den som får använda dem. På mobil ligger knapparna under texten med minst 36 px tryckyta. Indikatorn visar "2/6 utförda · 2 pågår · 1 avv." med tre färger.
- Ett fynd som rättades före commit: tidsstämpeln "23 nov. 2026 13:34" var för lång för varje rad och visas nu kompakt.
- Visuell regression efter ändringen: bara AO-detaljen ändrades, som avsett. En skillnad på 0,02 % i Offerter är en tidsberoende text som inte har med ändringen att göra.

## Återstår (förs till masterplanen)

- Dashboard: rubriken "Kräver åtgärd" upprepas; olika widgethöjder i samma rad.
- AO-lista: lägre radhöjd och status närmare titeln.
- Fastighetskort: kapad sista flik; dubblerad "Snabböversikt".
- Offertguide: fälthöjder och dubblerad "Uppdragsbeskrivning".
- Admin och avvikelserapport: etikett/värde-layout och tunna kort.
- Ordval: ett tiotal toast-/felmeddelanden säger fortfarande "klocka in/ut"/"inklockat", och Dagens drift säger "inklockad" (knappar och statusetiketter är rättade).
- AO-lista: poster med lika sorteringsnyckel kan byta plats mellan laddningar.
- Tomlägen: fastighetslistan saknar förklaring/åtgärd; "Välj alla" i tom lista. Serviceintervallens tomläge saknar vägledning.
- ~1 300 inline-`font-size` ska flyttas till tokens/klasser (pågående konsolidering; 9 px lyfts redan centralt).
