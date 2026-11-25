# Offerter — offertdetalj och offertguide (QA 2026-11-26)

Område: offertdetaljen (`OfferDetailPage`), offertguiden (`OffersPage` – skapa/redigera) och deras hjälpfunktioner i `src/pages/PageShells.js`, ny stilmall `src/styles/v3-offers.css` (länkad i `index.html` direkt efter `v3-service.css`). `AdminPage` och övriga objekt i PageShells är inte rörda. `OfferCalc`, momsregler, AO-spärrar, publika offertsidan och Edge Functions är oförändrade.

Allt är prövat mot den simulerade servern i `tests/e2e` — inget mot STAGING eller LIVE.

## 1. Offertdetalj (krav 2)

Tidigare: mörkt "hero"-huvud med två CTA-rader (bl.a. både "Skapa arbetsorder" och "Skapa AO" bredvid varandra), en faktaremsa, fyra hopfällda sektioner längst ned och en kolumn med kort i full bredd. Radernas belopp visades *inkl. moms* medan summeringen räknade *exkl. moms*.

Nu (samma mönster som arbetsorderdetaljens `aod-*`):

- **Huvud:** Tillbaka · offertnummer · "Version N" (och länk "Ersätter OFF-xxx" när den finns) · statusmärke med statusmeny (oförändrad) · titel · kund (länk) + kundtyp (BRF/Fastighetsägare/Företag/Privatperson) · fastighet · "Giltig t.o.m." (orange ≤ 7 dagar, röd när passerad, endast för aktiva statusar) · skapad.
- **Beloppsrad (`dl`):** "Exkl. moms", "Moms" (med satserna, t.ex. "25 % / 6 %"), "Totalt inkl. moms"; vid RUT/ROT även "Kund betalar inkl. moms"; vid återkommande rader "Fast kostnad per månad … exkl. moms". Alla värden är fält direkt ur `_offerCalcTotals()` (= `OfferCalc.totals`).
- **Åtgärdsrad:** en primär knapp per status, ett par sekundära, resten i "⋮"-menyn (`.ao-overflow-wrap`/`aoToggleOverflow`, grupperad, destruktiva poster sist i rött). Menyn hålls alltid inom skärmen och får fokus vid öppning; Escape/klick utanför stänger.
- **Lägesrad** (vad gäller nu?): t.ex. "Skickad 21 nov. · väntar på svar sedan 3 dagar · Kunden har öppnat länken 2 gånger · Nästa uppföljning …".
- **Innehåll (vänster), i kundens ordning (`sectionOrder`):** Uppdragsbeskrivning, **Offertinnehåll** (tabell på dator, ett kort per rad på mobil ≤ 600 px; kolumner Beskrivning/Antal/À-pris exkl. moms/Moms/Belopp exkl. moms; textblock på sin plats; tjänster med "Visa beräkning"; rörliga à-priser "Ingår ej"; tillval med "Ingår i/ej i summan"), summering, Offertvillkor, Allmänna villkor. Historik och säljarbete sist.
- **Sidokolumn (höger):** Kundens svar (digitalt godkännande, registrerat godkännande, nekande med kundens kommentar, ändringsbegäran), Arbetsorder (länk med AO-status, eller förklaring när momsspärren hindrar konvertering), Digital offertlänk (alltid synlig; "Länken gäller till …" så den inte förväxlas med offertens giltighet), Kund (e-post/telefon som länkar, varning om e-post saknas), Intern anteckning, Bilagor, Säljtips. På skärmar < 1200 px blir det en kolumn med svar/AO först.

### Åtgärder per status (endast befintliga funktioner och övergångar)

| Status | Primär | Sekundär | I "⋮"-menyn |
|---|---|---|---|
| Utkast | Skicka offert (`showSendModal`) | Generera länk (om ingen aktiv), Redigera | PDF, Ny version, Duplicera, Arkivera, Papperskorgen |
| Skickad/påmind/väntar | Boka uppföljning (`_quickAction('followup')`, samma som tidigare "Logga uppföljning") | Skicka påminnelse, Registrera godkännande | Redigera, PDF, Ny version, Duplicera, Status: Markera som nekad/väntar svar/utgången, Arkivera, Papperskorgen |
| Ändring begärd | Skapa ny version | Redigera | PDF, Duplicera, Arkivera, Papperskorgen |
| Godkänd utan AO | Skapa arbetsorder (`createAO`) — vid spärr (blandad moms, ≠ 25 %, återkommande …) samma spärrtext som tidigare från `_offAOBlockedCtaText`, gul knapp | — | Redigera, PDF, Ny version, Duplicera, Arkivera, Papperskorgen |
| Godkänd med AO | Öppna arbetsorder | — | samma som ovan |
| Nekad | Skapa ny version | Registrera godkännande | Redigera, PDF, Duplicera, Status: Återöppna, Arkivera, Papperskorgen |
| Utgången | Förnya offert (`duplicate`) | Återöppna offert (`setStatus('väntar')`) | Redigera, PDF, Ny version, Arkivera, Papperskorgen |
| Arkiverad/borttagen | Återställ offert | — | PDF, Ny version/Duplicera (ej borttagen), Radera permanent (borttagen) |

Inventering av den gamla vyn (alla finns kvar): huvud-CTA per status, "Skicka påminnelse", "Skapa AO" (dubblett, ersatt av den primära), AO-länk, Återställ, "Fler åtgärder" (Redigera, PDF, Ny version, Duplicera, Arkivera, Papperskorgen, Radera permanent), statusmenyn (Registrera godkännande, Markera som nekad/väntar/utgången, Återöppna), länkpanelen (generera, återkalla, förläng, ny länk, kopiera), bilagor (ladda upp, samlad PDF, visa, ladda ned, redigera, ta bort), säljtips, historik (snabbloggning, intern kommentar, uppföljningar klar/flytta). Statusmenyns val upprepas i "⋮"-menyn under rubriken Status. `openFlerAtgarder()` finns kvar och visar nu samma poster som menyn.

## 2. Skapa/redigera offert (krav 3)

All tidigare funktionalitet finns kvar: tjänst/kalkyl med VIFT:s prismodell (samma kalkylator), fastpris, löpande rad, fritext, tillval (i/utanför summan), rabatt, RUT/ROT per rad, återkommande och rörliga à-priser, radordning (dra/pilar), avsnittsordning, textförslag, snabbskapa kund, fastighetsval, projektkoppling, lokalt utkast och samma sparning (`_save`, samma rensning och samma fält).

- **Fyra steg i stället för tre:** 1 Kund & uppdrag · 2 Tjänster & priser · 3 Villkor · 4 Granska & spara. Stegvisaren är klickbar (bakåt fritt, framåt bara om stegen emellan är giltiga). Valideringen är densamma som förut (kund i steg 1, minst en prisrad i steg 2) men visas nu även som ett besked vid knapparna (`#offw-msg`), inte bara som toast.
- **Steg 1:** kund med kundtyp och kontaktuppgifter direkt när den väljs (privatperson får en upplysning om RUT/ROT), fastighet, rubrik, datum, giltighet; uppdragsbeskrivningen är alltid synlig (tidigare dold bakom två hopfällda block).
- **Steg 2:** fem tydliga ingångar (Tjänst/kalkyl, Fastpris, Löpande rad, Fritext, **Tillval**); radkorten visas i läsläge med "Redigera" även på dator (nya rader öppnas direkt i redigeringsläge); tillvalen har synliga fältetiketter och egen layout. **Livesummering** med radlista och samma summering som detaljvyn: Summa exkl. moms, Rabatt, Moms med "varav moms 25 % / 6 %", Totalt inkl. moms, RUT/ROT och "Kund betalar inkl. moms". Den uppdateras vid varje ändring (även benämningar, via en delegerad lyssnare). På mobil ligger en kompakt summeringsrad kvar nederst medan raderna redigeras och kan fällas ut.
- **Steg 4 Granska & spara:** exakt det som sparas (samma rensning av tomma rader som `_save`), renderat med samma funktioner som offertdetaljen, med "Ändra" per del. Kontroller: kund saknas, prisrad saknas, `OfferCalc.validate` (RUT/ROT större än totalen) — samma regler som spärrar sparningen; samt upplysningar som inte hindrar: rubrik saknas, kunden saknar e-post, "Giltig till" före offertdatum, RUT/ROT på en kund som inte är privatperson, och att blandad/annan moms inte kan bli arbetsorder automatiskt (samma `_offAOConversionDecision`).
- **Sparknappen** visar "Sparar…" och är inaktiv tills servern svarat; fel visas som besked i guiden och som toast.
- **Utkast:** det befintliga lokala utkastet (localStorage, per användare, 7 dagar, bara för ny fristående offert) används oförändrat — ingen serverlagring har lagts till. Rättat: ett utkast som sparats i steg 4 kastades tidigare tyst vid återställning (`_draftRead` godtog bara steg 1–3); nu godtas steg 1–4.

## 3. Belopp och moms

Ingen beräkning är ändrad. Ny ren presentationshjälpare `_offVatBreakdown(off)` delar upp momsen per sats med exakt OfferCalc:s underlag (per-rad-moms för engångsrader och tillval i summan, samma rabattkvot) och fördelar avrundningsresten så att raderna **alltid summerar till `totals.vatAmount`**. Radbelopp visas exkl. moms ur `_lineExVat` (samma underlag som summan). Etiketter: alltid "exkl. moms"/"inkl. moms" (tidigare blandat "ex. moms").

## 4. Säkerhet (hittat och rättat)

- **Lagrad XSS i offertlistan:** offertens titel renderades oescapad (`off-offer-card-title`). Nu `esc()`. Upptäckt av nya testet OFFD-04 (XSS-01 såg det inte eftersom demodatan saknar titlar).
- Allmänna villkor i detaljen renderades oescapade — nu `esc()` med bevarade radbrytningar.
- Tjänstekortet i guiden: mallnamn, prisnivå och kalkylrader oescapade — nu `esc()`.
- Bilagornas metarad (filändelse ur filnamnet) oescapad — nu `esc()`.
- Historiken escapades två gånger ("&" syntes som "&amp;") — nu en gång.
- Id:n i nya inline-händelser går via `_offSafeId()` (endast `[A-Za-z0-9_-]`).

## 5. Före/efter-bilder

`docs/qa-2026-11-26/fore-efter/offers/` — `fore-*` togs från HEAD före ändringarna med samma realistiska fixturer (många rader av alla typer, blandad moms, långa villkor, bilagor, kundsvar), `efter-*` efter. 1366 px och 390 px (deviceScaleFactor 1, hela sidhöjden):

- Detalj: `*-detalj-utkast`, `-skickad`, `-skickad-privat-rut`, `-andring-begard`, `-godkand`, `-godkand-med-ao`, `-nekad`, `-utgangen` (`-1366.png`, `-390.png`).
- Guide: `*-guide-steg1..3` (före, tre steg) och `efter-guide-steg1..4` (efter, fyra steg).

## 6. Tester

Ny spec `tests/e2e/specs/32_offers.js` (fixturerna exporteras som `module.exports.fixtures`):

| Id | Vad |
|---|---|
| OFFW-01 | BRF-kund: stegvalidering (kund, prisrad, stegvisaren hoppar inte förbi), alla radtyper via gränssnittet (tjänst via kalkylatorn, fastpris, två löpande varav en 6 %, fritext, tillval i och utanför summan), livesummering = OfferCalc inkl. moms per sats, ändring slår igenom direkt, granskningen visar alla 7 rader och momsspärrsupplysning, sparad offert = guidens belopp, detaljvyn = OfferCalc, återöppnad i guiden = samma |
| OFFW-02 | 390 px, privatkund: hela flödet via "Lägg till arbete", tjänst med RUT, mobilens summeringsrad = kund betalar, utfälld summering = OfferCalc, ingen sidscroll/klippning i något steg, stegvisarens knappar ≥ 40 px, primärknapp i full bredd ≥ 44 px |
| OFFW-03 | Utkast återställs i steg 4; varningar RUT/ROT på BRF och kund utan e-post; "Sparar…" under fördröjt serversvar |
| OFFD-01 | Per status (utkast, skickad, ändring begärd, godkänd, godkänd med AO, nekad, utgången, arkiverad, borttagen) på dator och mobil: rätt primär funktion, högst en primärknapp, alla tidigare åtgärder går att nå, otillåtna saknas, menyn öppnas inom skärmen med fokus, destruktiv post sist, Escape stänger |
| OFFD-02 | Alla offerter (demodata + fixturer inkl. rabatt och återkommande): huvud, varje radbelopp och summering = OfferCalc; moms per sats summerar; etiketter med exkl./inkl.; ingen markup som text; historiken visar "&" och "<…>" som skrivet |
| OFFD-03 | Generera länk via bekräftelsedialog, registrera godkännande via statusmenyn, momsspärr (ingen AO, förklarande dialog), Skapa arbetsorder ger exakt en AO och primärknappen blir "Öppna arbetsorder", kundens nekande/ändring visas, Förnya skapar kopia |
| OFFD-04 | HTML-nyttolast i titel, beskrivningar, rader, tillval, villkor, anteckning, kundsvar, bilagenamn: inget skript körs (detalj, menyer, hopfällda kort, guidens fyra steg) |
| OFFD-05 | Ingen sidscroll eller klippta knappar på 360/390/768/1024/1366/1920 px för sju statusar och guidens fyra steg; ingen markup som text |

Ändrade befintliga specar (legitim UI-ändring, påståendena oförändrade):
- `06_economy.js` (`createOfferViaWizard`, används av FLOW-01 och OFF-03): etiketten heter nu "Summa exkl. moms" (var "Summa ex. moms") och guiden har steget "Nästa: Granska" före "Spara offert". Jämförelsen guide = OfferCalc är densamma.
- `16_stabilization.js` (G8-01): klick på "Nästa: Granska" före "Spara offert". Samma kontroll av beskedet och att ingen offert sparas.

Resultat: se avsnitt 8.

## 7. Inte gjort / kräver beslut

- **DataSync kan ersätta en öppen guide med offertlistan** (befintligt beteende, ej ändrat): pollningen (var 15:e s) ritar om aktuell sida när annan session ändrat data och inget fält har fokus; för `pg-offer` betyder det `OffersPage.render()` som ersätter guiden. Nya offerter räddas av det lokala utkastet, men osparade ändringar i en *befintlig* offert går förlorade. Rättningen hör hemma i `Router`/`DataSync` (hoppa över omritning när `#pg-offer-content[data-wiz]` finns) — utanför mina filer. Upptäcktes under testarbetet (OFFW-03 skrevs om för att inte trigga det).
- Offertlistan (`pg-offer`) är inte omdesignad — bara XSS-rättningen ovan.
- Publika offertsidan, PDF-mallarna och e-postutskick är orörda.
- Upplysningen om RUT/ROT för andra kundtyper än privatperson är bara information (ingen spärr) — om det ska bli en regel är ett affärsbeslut.
- C-5: vyerna förutsätter `offer_manage` (som förut); inget nytt UI antar att tokens finns för andra roller.

## 8. Testresultat (simulerad server, 2026-11-25)

- **Riktad körning** (`--grep "^(OFFW|OFFD|OFF-0|FLOW-01|G8-01|VAT-01|ECO-V3-01|RENDER-01|XSS-01|BRAND-01)"`): **19 godkända, 0 misslyckade** av 19 (302 s). Omfattar de 8 nya testerna, FLOW-01 (offert → kundlänk → godkännande → AO → fakturakö), OFF-01..04, G8-01, VAT-01 (22_vat_guards), ECO-V3-01, RENDER-01, XSS-01 och BRAND-01.
- **Hela sviten** (`node tests/e2e/run.js`, en körning på slutlig kod): **128 godkända, 0 misslyckade, 1 blockerad, 1 känt fel av 130** (942 s). Blockerad: PERM-03 (känd, kräver STAGING). Känt fel: AO-07 (känt gap G5). Inga andra avvikelser.
- **`bash tests/run-all.sh`**: 0 misslyckade — 15/19 testfiler gröna, 4 överhoppade (kräver lokal PostgreSQL, finns inte i miljön; inte godkända, inte körda). `browser/offer_total_parity.js`: 120 offerter jämförda, 0 avvikelser.
- G8-01 föll en gång i en tidig delkörning under hög belastning och har därefter gått igenom i alla körningar (5 separata plus de två ovan); orsaken kunde inte återskapas.
