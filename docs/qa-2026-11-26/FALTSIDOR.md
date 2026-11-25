# Fältsidor – Mina jobb, Tid & stämpla, Dagens drift, Återkommande (QA 2026-11-26)

Arbetsblock **falt**. Filer: `src/pages/MyJobsPage.js`, `src/pages/TimePage.js`, `src/pages/OperationsPage.js`, `src/pages/RecurringPage.js`, `src/styles/v3-falt.css` (ny, laddas efter `system.css`), `index.html` (endast `?v` för dessa fem filer), test `tests/e2e/specs/33_falt_pages.js`.

Mål från produktägaren: en fältarbetare ska kunna öppna sina jobb, förstå uppdraget, registrera tid och avsluta utan att leta; en arbetsledare ska snabbt se vad som händer. Arbetet följer `docs/V3-KOMPONENTSTANDARD.md` (sidtitel bara i topbaren, en primärknapp per vy/sektion, `.ftabs`/`.chip`, sök med ikon bredvid fältet, faktarutor `dl/dt/dd`, svenska format, `esc()` på all data, ikoner aldrig på egen rad).

Granskningen gjordes med **realistiskt innehåll** (hjälpfunktionen `richData()` i specen): elva jobb samma dag för en tekniker, försenade jobb, pausade jobb (`substatus`), jobb som inväntar material, långa titlar och mycket långa adresser, sex pooljobb, 24 tidposter över tolv dagar (varav attesterade), arbetsledarvy med 44 öppna arbetsorder, och 20 återkommande ärenden i alla lägen (förfallet, idag, om 1 dag, pausat, avslutat). Tomlägen kontrollerades också.

## 1. Mina jobb (`pg-myjobs`)

**Före:** en lång kolumn med fullbreddskort (på 1366/1920 px var "Stämpla in" och poolens gröna "Ta jobbet" ~1 030 px breda – F-18), sex sektioner i följd där poolen hamnade efter alla egna jobb, samma AO kunde visas två gånger (pågående med passerat datum låg både under "Pågående" och "Försenade"), en grön gradientbanderoll för stämpling med egna inline-stilar, emoji för understatus och kategorichips som tog tre rader på mobil.

**Efter:**
- **Tre vyer i en segmentkontroll** (`.ftabs`): *Idag* · *Kommande* · *Arbetspool*, med antal (`.ft-n`).
- **Idag** börjar med **nästa jobb** (stort kort, märkt "Nästa jobb"): det instämplade jobbet, annars dagens pågående, dagens akuta, dagens första enligt klockslag, därefter försenade/pågående/odaterade. Sedan *Försenade*, *Resten av dagen* (med datum), *Pågående sedan tidigare* och *Tilldelade utan datum*. Inga dubbletter: en pågående AO med passerat datum visas bara som försenad, en med framtida datum bara som pågående.
- **Kommande** grupperas per dag ("Imorgon", "Tor 26 nov", …) med kompakta kort.
- **Arbetspool**: kort med prioritet, kund, adress, beskrivning och **Ta jobbet** (sekundärknapp, inte fullbredd).
- **Kortrutnät** med maxbredd (`repeat(auto-fill, minmax(330px, 1fr))`, sidan max 1 440 px) – 1 kolumn på mobil, 3 på 1366, 4 på 1920 (F-18).
- **Stämpling:** när man är instämplad visas *en* status överst (ljusgrön, "Instämplad · 12 min", "Sedan 08:02 · AO-015 · …", *Öppna jobbet*, *Stämpla ut* som primärknapp). Inga andra "Stämpla in" visas då, och det instämplade jobbet märks "Pågår nu".
- **"Stämpla in" och "Starta jobb" är tydligt åtskilda:** olika ikon (logga in / spela), förklarande `title`, och på nästa jobb en rad "*Stämpla in* mäter din tid. *Starta jobb* ändrar bara status till Pågående." Bara nästa jobb har primärknapp; övriga kort har sekundära knappar. Navigering (*Karta* = vägbeskrivning, *Ring* = `tel:` med bara siffror, *Öppna*) på egen rad.
- Kategorifilter: chips med antal på dator, rullista på mobil, *Rensa filter* när ett filter är aktivt.
- Understatus med ikon + text (Pausad, Inväntar material …) i stället för emoji; tid mot plan i timmar med decimalkomma ("Plan 1,5 h · Registrerat 2,25 h (150 %)").
- Säkerhet: inline-händelser läser `data-ao` i stället för att bädda in id i JS-strängar; all data via `esc()`; `pbdg()` bara för kända prioriteter.
- **Oförändrat:** `clockIn`, `clockOut`, `startJob`, `takeFromPool` och deras serverbekräftelser (bytewise samma kod), behörigheten `ao_time` för stämpling.

## 2. Tid & stämpla (`pg-tid`)

**Före:** stor grön knapp utan sammanhang, formulär med datum/prisgrupp först, rå ISO-datum i listan ("2026-11-24 08:00–16:00"), alla tidposter i en lång lista utan dagsgruppering, och ingen validering förrän servern/TimeService svarade med en toast.

**Efter:**
- **Status överst:** *Inte instämplad* / *Instämplad · 1t 12m* med "Sedan 08:02 · AO-015 – …", plus **Idag** och **Denna vecka** (egna poster, svensk decimal "7,75 h"). Primärknapp *Stämpla in*/*Stämpla ut*.
- **Manuell registrering:** Datum · Starttid · Sluttid på en rad (datum på egen rad på mobil), sedan Arbetsorder (fyller i kunden som förut), Kund, Prisgrupp ("… kr/tim exkl. moms"), Kommentar, Debiterbar.
  - **Validering vid fälten** och sammanfattning vid sparning: "Välj datum.", "Ange starttid.", "Ange sluttid.", "Sluttid måste vara efter starttid. Ett pass över midnatt registreras som två poster (före och efter 00:00)." Fälten får `aria-invalid` och röd ram; inget skickas till servern. Samma regler och samma minutberäkning som `TimeService.saveManual()` – ingen ny affärsregel, midnatt/sommartid oförändrat.
  - **Svensk sammanfattning** under fälten: "Fredag 20 nov. 2026 · 08:00–09:30 · 1,5 h" – oberoende av vilket språk webbläsaren visar i de inbyggda datum-/tidsfälten (F-24, se nedan). Varning (ej spärr) om passet är längre än 12 timmar.
  - **Sparning:** knappen visar *Sparar…* och är spärrad tills servern svarat; statusraden visar *Sparad: Fre 20 nov. 2026 08:00–09:30 (1,5 h)*, *Ej bekräftad … skickas automatiskt* eller felet. Toasterna ("Sparar tiden…", "Tid sparad", "Tiden kunde INTE sparas …") är oförändrade.
- **Redigera tid** har samma validering. Fynd: `TimeService.update()` räknar om minuterna men kontrollerade aldrig att sluttiden ligger efter starttiden – en redigering kunde ge negativ tid. Dialogen nekar nu det innan något skickas.
- **Registrerad tid grupperad per dag** (senaste dagen först, passen i tidsordning) med **dagssumma**: "Idag · tisdag 24 nov. 2026 … 7,75 h". Rad: klockslag, AO/kund, prisgrupp, kommentar, timmar, märken *Debiterbar/Intern*, *Attesterad*, *Sparas…*/*Ej sparad* (serverstatus), redigera/ta bort som ikonknappar med `aria-label` – bara där det redan var tillåtet (samma villkor; `TimeService._guardMutation()` avgör ändå). "Visar X av Y poster" och *Visa fler*.
- Den som ser andras poster (löneroll/superadmin) får *Min tid / Alla*; standard är *Min tid* (sidans syfte). Ingen funktion borttagen.
- *Importera/Exportera* ligger i ⋮-menyn (komponentstandard §1).
- Stämpla in-dialogen listar *Mina jobb idag* först (optgroup). Stämpla ut-dialogen visar instämplad tid, sedan-klockslag, arbetsorder och kund som faktarutor. Toasterna säger nu *Utstämplad* (tidigare "Utloggad", som lät som utloggning) – samma ord som Mina jobb.
- `TimePage.onSyncStatusChanged()` (anropas redan av TimeService men fanns inte) uppdaterar listan när en post blir bekräftad eller nekad.
- **F-24:** de inbyggda `<input type="date/time">` visar webbläsarens/OS:ets format (i headless Chromium "11/24/2026", "08:00 AM"). Det försöker vi inte ändra; all text sidan själv skriver är svensk, och sammanfattningen under fälten visar passet på svenska. Bör kontrolleras på riktig enhet (svenska iOS/Android visar 24-timmarsformat).

## 3. Dagens drift (`pg-operations`)

**Före:** 45 % inline-stilar, fyra egna nyckeltalskort där "Kräver åtgärd" = försenade + akuta (samma AO räknades två gånger), ikoner på egen rad (F-02), tio sektioner i en kolumn, nyckeltalen ledde ingenstans (`Router.showPage('pg-operations',{filter})` lästes aldrig), "1 inklockad" som bara kunde gälla den inloggade själv.

**Efter:**
- Rubrikrad med datum ("Tisdag 24 november 2026"), antal öppna, uppdateringstid och åtgärder (*Arbetsorder*, *Ny arbetsorder* som enda primärknapp, bara med `ao_create`).
- **Sex nyckeltal** i samma `dt-tile` som dashboarden (S-02): *Jobb idag*, *Pågående*, *Försenade*, *Akuta*, *Otilldelade*, *Klara, ej fakturerade*. **Rutan väljer listan** under den, och antalet på rutan är exakt antalet rader. Urvalen är oförändrade (försenad = `isOverdue`-definitionen, otilldelad = aktiv utan personal och inte i poolen, ej fakturerad = klar utan fakturaunderlag). *Med anteckningar* finns som chip.
- **Dagens jobb grupperade per status** (pågående, nya, planerade, pool) med klockslag, AO-nummer, titel, kund · adress, understatus, checklista "2 av 4", tid mot plan, personal (avatarer) eller *Ingen personal*, status och prioritet. Klara ej fakturerade har *Skapa underlag* (med `invoice_create`, samma `_createInvoice`).
- **Personal idag – vem gör vad:** per person *Arbetar med AO-… (+n)*, annars *Nästa 10:00: AO-…*, annars *Inget planerat idag*; antal idag och försenade. Fältpersonal utan öppna jobb listas på en rad. Stämpling visas bara för den inloggade ("Instämplad (du)") – andras stämpling finns inte i klienten.
- *Tid på dagens jobb* (faktarutor), *Öppna per kategori* (med stapel och akuta), *Serviceintervall att åtgärda*, *Kommande 7 dagar* (per dag). Fynd: *Kommande 7 dagar* räknade dagar med `toISOString()` (UTC) – fel dag mellan midnatt och 01/02 svensk tid. Nu lokala datum.
- Inga inline-stilar kvar utom avatarfärg och stapelbredd; ikoner på samma rad som texten.
- Layout: två kolumner på dator (lista + personal/tid/kategori/service), en kolumn under 1 200 px.

## 4. Återkommande (`pg-recurring`)

**Före:** gul infobox som påstod att "systemet skapar automatiskt arbetsorder när det är dags" (det gör det inte – arbetsorder skapas bara med *Skapa AO nu*), egen rubrik som upprepade topbaren, "Om 1 dagar" (F-12), "Förfallen 2 d sedan", ingen sök eller filtrering, pausade ärenden såg nästan likadana ut som aktiva.

**Efter:**
- Verktygsrad: **sök** (ikon bredvid fältet, `type="search"`, `aria-label`; ritar bara om listan efter 150 ms så att fokus behålls), **snabbval** *Dags att skapa* (antal, röd när > 0) och **statusfilter** *Alla/Aktiva/Pausade/Avslutade* som separata grupper, *Rensa filter*, "Visar X av Y", och en primärknapp *+ Nytt ärende*.
- Korrekt infotext: "Arbetsordern skapas när du väljer **Skapa AO nu** … Pausade och avslutade ärenden skapar inga arbetsorder."
- Lista sorterad: aktiva efter nästa datum, sedan pausade och avslutade. Varje rad: titel, kund, intervall, adress, **Nästa tillfälle** ("27 nov. 2026") och läge: *Idag*, *Om 1 dag*, *Om 3 dagar*, *Förfallen sedan 1 dag / 2 dagar* (F-12), *Pausad – skapar inga arbetsorder*, *Avslutad*; personal som avatarer; statusmärke med ikon. Ärenden där det är dags har *Skapa AO nu* direkt i raden (samma `_createAO`).
- **Detaljdialog:** status/prioritet/intervall, en ruta *Nästa tillfälle* som säger vad *Skapa AO nu* gör (eller att ärendet är pausat/avslutat), faktarutor (kund, fastighet, adress, portkod med `objects_sensitive`, personal, intervall, start/slut, senast skapad), beskrivning, checklistemall och skapade arbetsorder. *Redigera* och *Pausa/Aktivera* i dialogen; sidfoten har *Stäng* och – bara för aktiva ärenden – *Skapa AO nu* (en pausad/avslutad gav tidigare bara felet "Ärende ej aktivt").
- **Pausa/Aktivera** ger besked först efter serverns bekräftelse (`confirmPersist`, samma mönster som Spara) – tidigare visades "Pausat" direkt.
- **Fynd/rättning:** `_save()` satte alltid `status: 'aktiv'`, så att spara en ändring i ett pausat eller avslutat ärende tyst återaktiverade det. Redigering behåller nu status; nya ärenden är aktiva som förut.
- Personalnamn i chips och adresser i formuläret escapas nu.

## Gemensamt

- `v3-falt.css`: alla stilar för de fyra sidorna (prefix `mj-`, `tp-`, `ops2-`, `rc-`, dialogtitlar `fm-mt`); ikoner inline på de fyra sidorna (F-02 lokalt), tryckytor ≥ 40 px på mobil/pekskärm, fokusmarkering.
- Dialoger: titel med ikon, *Avbryt/Stäng* först och primärknappen sist (till höger på dator).
- `index.html`: `MyJobsPage v22`, `TimePage v18`, `OperationsPage v12`, `RecurringPage v19`, `v3-falt.css v2`.

## Före/efter-bilder

`docs/qa-2026-11-26/fore-efter/falt/` – simulerad server, deviceScaleFactor 1, hela sidans höjd:

| Vy | Före | Efter |
|---|---|---|
| Mina jobb (demodata) | `fore-minajobb-390.png`, `fore-minajobb-1366.png` | `efter-minajobb-390.png`, `efter-minajobb-1366.png` |
| Mina jobb, instämplad | `fore-minajobb-instamplad-{390,1366}.png` | `efter-minajobb-instamplad-{390,1366}.png` |
| Mina jobb, många jobb | `fore-minajobb-mycket-{390,1366}.png` | `efter-minajobb-mycket-{390,1366}.png` |
| Tid & stämpla | `fore-tid-{390,1366}.png`, `fore-tid-mycket-{390,1366}.png` | `efter-tid-…` (samma namn) |
| Dagens drift | `fore-drift-{390,1366}.png`, `fore-drift-mycket-{390,1366}.png` | `efter-drift-…` |
| Återkommande | `fore-aterkommande-{390,1366}.png`, `fore-aterkommande-mycket-{390,1366}.png` | `efter-aterkommande-…` |
| Återkommande, detaljdialog | `fore-aterkommande-detalj-{390,1366}.png` | `efter-aterkommande-detalj-{390,1366}.png` |

## Tester

Ny spec `tests/e2e/specs/33_falt_pages.js` (FALT-01 … FALT-10), alla mot simulerad server:

| Id | Vad |
|---|---|
| FALT-01 | Mina jobb med många jobb: antal i flikarna = data, nästa jobb = dagens pågående, en primärknapp, varje Idag-jobb exakt en gång, Försenade/Resten av dagen/Utan datum med rätt antal, inga andras jobb, Kommande per dag (Imorgon först), poolen med Ta jobbet utan stämpling; Ta jobbet → tilldelad och planerad på servern. |
| FALT-02 | Stämpla in → exakt en stämplingsstatus, ett aktivt kort, ingen Stämpla in, exakt en Stämpla ut, serverns stämpling aktiv, AO-status oförändrad; Stämpla ut → exakt en ny tidpost (45 min) och markeringen borta; Tid-sidan visar Inte instämplad. |
| FALT-03 | Starta jobb → status pågående på servern, ingen tidpost, ingen stämpling; knapparnas förklaringar. |
| FALT-04 | Manuell tid: fältfel + sammanfattning, inget anrop till servern; rättat → felen borta, svensk sammanfattning; Sparar… och spärrad knapp tills ACK, Sparad-status, 90 min på servern, posten under "Fredag 20 nov. 2026" med dagssumma; Redigera med sluttid före starttid nekas och inget skickas. |
| FALT-05 | Dagens drift (arbetsledare, 44 öppna AO): sex nyckeltal = oberoende beräkning från data; varje ruta visar exakt så många rader; Med anteckningar; dagens jobb per status summerar till Jobb idag; personal idag ("Arbetar med AO-R103", "11 idag", "3 försenade"); inga inline-stilar. |
| FALT-06 | Återkommande: Om 1 dag / Om 2 dagar / Förfallen sedan 2 dagar / Idag, aldrig "1 dagar"; pausat tydligt; Skapa AO nu bara där det är dags; infotexten; snabbval/statusfilter/Rensa filter; sök behåller fokus; Pausa → serverbekräftat; redigering behåller pausad; Aktivera. |
| FALT-07 | Svenska format i alla vyer/flikar/dialoger: inga ISO-datum, m/d/y, AM/PM, engelska dag-/månadsnamn, decimalpunkt i timmar eller ensiffriga timmar. |
| FALT-08 | 360, 390, 768, 1024, 1366, 1920 px, med pågående stämpling och realistiskt innehåll: ingen sidledsrullning, inga knappar utanför skärmen eller med avklippt text, tryckytor ≥ 40 px på 360/390. |
| FALT-09 | RENDER-01-kontrollen på alla vyer, filter, valideringsfel och dialoger (stämpla ut, manuell tid, redigera, återkommande detalj/formulär). |
| FALT-10 | Fältpersonalens dag på 360 px: nästa jobb högt upp, Karta = vägbeskrivning till adressen, stämpla in/ut, inget klipps. |

**Ändrad befintlig spec:** `23_render.js` — RENDER-01 delades i RENDER-01 (admin, arbetsledare) och RENDER-01B (ekonomi, fält) med en gemensam funktion. Samma roller, sidor, flikar, admin-flikar och dialoger kontrolleras; inget är borttaget. Orsak: fältsidorna har nu flikar/chips som testet klickar igenom, och hela testet med fyra roller gick över 90 s-gränsen per test på den belastade maskinen (87 s före blocket, 93 s efter, mätt med `--timeout 300000`).

### Resultat (simulerad server, 2026-11-25)

| Körning | Resultat |
|---|---|
| `--grep "FALT-"` (nya specen) | 10 av 10 godkända |
| Fältrelaterade + regressionsurval (TIME-*, MYJOBS-01, REC-01, SALES/PROJ/TASK/CAL-01, RES-01–04, SW-01, MODAL-01, ATT-01/02, G8/G10/G12-01, QBAR-01, ECO-V3-01/02, DASH-M-01, PAGES-01/02, RESP-*, ROLE-01, ECO-01, XSS-01, VAT-01, BRAND-01, RENDER-01, FALT-*) | 50 godkända, 1 misslyckad: RENDER-01 — *Timeout efter 90 000 ms* (inga markupträffar; alla fyra roller hann köras) |
| Hela sviten `node tests/e2e/run.js` (en gång, före uppdelningen av RENDER-01) | **129 godkända, 1 misslyckad, 1 blockerad, 1 känt fel av 132** (901 s). Misslyckad: RENDER-01, *Timeout efter 90 000 ms* (samma orsak). Känt: AO-07 (G5). Blockerad: PERM-03. |
| `--grep "^RENDER-01"` efter uppdelningen | RENDER-01 och RENDER-01B godkända (2 av 2, 90 s totalt) |
| RENDER-01 med `--timeout 300000`, före respektive efter blockets kod | godkänd, 87 s respektive 93 s |
| `bash tests/run-all.sh` | 15 av 19 gröna, 0 misslyckade, 4 överhoppade (kräver lokal PostgreSQL — inte godkända, inte körda) |

Hela sviten kördes inte om efter uppdelningen av RENDER-01; RENDER-01/01B kördes separat (ovan).

## Ej gjort / kräver beslut

- **Rondering för fältpersonal:** rollen *Tekniker / Personal* (`ao_view_own`, `ao_time`, …) har inte `ao_view_all`, som krävs för `pg-rondering`, `pg-rondering-utfor` m.fl. (AuthService). En tekniker kan alltså inte utföra en rondering i demorollerna. Behörighetsfrågan är ett affärsbeslut (och AuthService ägs inte av detta block).
- **Ta jobbet** visar "Du är nu tilldelad …" direkt; `WorkOrderService.takeFromPool()` skickar via `_syncAO()` utan att exponera serverbekräftelse till anroparen. Kräver ändring i WorkOrderService (ej detta block) för att beskedet ska vänta på servern.
- **Automatisk skapning av återkommande arbetsorder finns inte** – texten är nu ärlig. Om automatisk skapning önskas är det en ny funktion (server/cron).
- **Andras stämpling** syns inte i Dagens drift (klienten känner bara den egna). Visning av vem som är instämplad kräver ett serverstöd för att läsa andras stämplingsstatus (behörighetsfråga).
- **F-24** på riktig enhet: kontrollera att datum-/tidsfälten visar svenskt format på svenska iOS/Android.
- **F-02 globalt** (`svg{display:block}` i `reset.css`) är bara rättat lokalt på dessa fyra sidor.
- Avvikelse med bild och AO-detaljen ingår inte i detta block; se utforskande kontroll nedan.

## Utforskande kontroll utanför blocket (fältpersonalens dag, 360/390 px)

Gjord med samma realistiska data, inte som spec (filerna ägs av andra block):

- **AO-detaljen** (`pg-ao-detail`, falt2): ingen sidledsrullning, men tryckytorna är 36–38 px (Tillbaka, Kontakt, Fler åtgärder, Vägbeskrivning, Ring, Påbörja, Markera utförd, Markera avvikelse, Lägg till material, Registrera tid …) — under 40 px-kravet. Orsak: `system.css` sätter `.btn.bsm` 38 px och `.btn.bxs` 36 px på mobil.
- **Rondering**: kan inte nås av fältrollen (se ovan). Som arbetsledare: ingen sidledsrullning i ronderingslistan.
- **TimeService.refreshStampFromServer()** ritar om aktuell sida efter en stämplingsändring från en annan enhet bara för `['pg-time', 'pg-myjobs', 'pg-ao-detail', 'pg-dashboard']` — sidorna heter `pg-tid` och `pg-dash`, så Tid & stämpla (och dashboarden) uppdateras inte förrän man navigerar. Rättning hör hemma i TimeService (ej detta block).
- **RENDER-01-tiden:** testet tog 87 s före och 93 s efter detta block på den delade, belastade maskinen (standardgräns 90 s per test). Fältsidorna har nu flikar och chips som RENDER-01 klickar igenom (≈ 25 klick till). `run.js` läser inte testets egen `timeout` (STG-01 anger 120 000 men den ignoreras); förslag: låt `run.js` använda `t.timeout` och ge RENDER-01 t.ex. 240 000 ms.
