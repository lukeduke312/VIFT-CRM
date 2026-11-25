# AO-detalj — V3-omarbetning (nattkörning 2026-11-26)

Arbetsblock: **aodetail**. Filer: `src/pages/WorkOrderDetailPage.js` (v93 → v94),
`src/styles/v3-aodetail.css` (v1 → v2), nya testet `tests/e2e/specs/27_aodetail.js`
och en ändrad textkontroll i `tests/e2e/specs/18_checklist.js` (CHK-02).
Det är presentation: samma funktioner, samma behörighetskontroller och samma
skrivvägar (WorkOrderService, TimeService/stämpling, checklist-EF, InvoiceService).
Inga priser, statusar, statusövergångar eller affärsregler är ändrade. Ett
tillägg kräver ett beslut: *Starta arbete* för tilldelad fältarbetare, se 5C och
*Öppna frågor* punkt 1. Inget är publicerat eller pushat. Allt är prövat mot
den simulerade servern i `tests/e2e`.

Mål (produktägaren): en fältarbetare ska kunna öppna en AO, förstå uppdraget,
följa checklistan, registrera tid och material och avsluta utan att leta. En
arbetsledare ska snabbt se läget och agera. Sidan följer
`docs/V3-KOMPONENTSTANDARD.md`, se avsnittet om komponentstandarden nedan.

## Ny sidordning

**Sidhuvud:** tillbaka · nummer · status/prioritet/kategori → rubrik → kund,
adress, när, vem → **åtgärdsrad** (en primär åtgärd, några sekundära, **⋮**) →
**Din arbetstid** (kompakt stämplingsrad, bara roller med `ao_time`). Därefter
kommer *Nästa steg*.

**Huvudkolumn (dator):**
1. Uppdrag & utförande (med checklistan)
2. Material och kostnader
3. Arbetstid (med *Tid mot plan* för ekonomiroller)
4. Bilder
5. Aktivitetshistorik

**Sidokolumn (dator):**
1. Prissättning (bara roller som ser pris)
2. Intern lönsamhet (som förut, hopfälld)
3. Var
4. När
5. Vem
6. Kund och kontakt
7. Detaljer (metadata)
8. Gör återkommande

Sidokolumnen är inte längre "sticky". Med prissättningskortet blev den högre än
fönstret, och en klistrad kolumn gömde då sin nederdel.

**Surfplatta 768–1199:** uppdrag → prissättning → lönsamhet → Var/När/Vem/Kund
två och två → material → arbetstid → bilder → historik → detaljer.

**Mobil < 768:** sidhuvud → nästa steg → plats och kontakt
(Vägbeskrivning/Ring) → Uppdrag & utförande → material → arbetstid →
(prissättning) → bilder → historik → detaljer (hopfälld). Snabbåtgärdsraden
`.aod-qbar` (Stämpla in/ut, Checklista N/M, Material, Foto/anteckn.) är kvar.

## 5A — Uppdrag & utförande

* Kortet "Uppdrag" och den separata hopfällbara "Checklista" är nu **ett** kort,
  *Uppdrag & utförande*. Det innehåller:
  * **utförandestatus**, härledd ur befintlig status: Ej påbörjat / Pågår +
    substatus (t.ex. "Pausad") / Utfört + datum och vem som klarmarkerade /
    Avbrutet;
  * *Vad ska göras* (beskrivningen);
  * den interna anteckningen, för exakt samma roller som förut (alla som får
    öppna ordern);
  * **checklistan, direkt i kortet**.
* Checklistan kan inte fällas ihop. Överst finns:
  * **"N av M klara"** — klara = utförda + avvikelse, samma definition som
    *Nästa steg* och klarmarkeringens kontroll;
  * "K kvar";
  * en stapel med segment för utförda, avvikelse och pågående
    (`role=progressbar` med aria-värden);
  * en teckenförklaring per läge.
* Under listan samlas **avvikelserna** (punkt, kommentar, vem).
* De tre lägena är **oförändrade**: Ej påbörjad / Pågående / Utförd + Avvikelse.
  Det gäller också knapparna per rad och serverreglerna:
  * `work-order-checklist-resolve` och `forbidden_other`;
  * egen återställning med `ao_checklist`, annans eller äldre punkt kräver
    `ao_edit`;
  * "Sparar…" tills servern svarat (ACK).

  Det är samma `_renderChecklist()`/`chkAction()` som förut.
* Framsteget, avvikelselistan och snabbåtgärdsradens "Checklista N/M"
  uppdateras direkt efter varje checklisthandling. Tidigare uppdaterades
  räknaren i snabbåtgärdsraden först vid nästa fulla omritning.
* "Tillägg" visas inte, eftersom det saknas datamodell för det. Se *Öppna frågor*.

## 5B — Stämpling

* Det stora kortet med en stor grön knapp mitt i sidan är borta. I stället
  finns en kompakt rad **"Din arbetstid · AO-nnn"** i sidhuvudet, under
  åtgärdsraden:
  * inte instämplad: "Inte instämplad" + **Stämpla in**;
  * instämplad: grön rad med "Instämplad sedan 08:12 · **0:45:12**" och en
    **levande tidräknare** (uppdateras varje sekund, bara medan sidan visar
    ordern man är instämplad på) + **Stämpla ut**.
* **Instämplad på en *annan* order:** raden säger "Du är instämplad på AO-xxx —
  stämpla ut där först" och har knappen *Öppna AO-xxx*. Tidigare fanns en grå
  ruta under en Stämpla in-knapp som bara gav ett felmeddelande.
* Raden visas även om ordern hunnit klarmarkeras medan man är instämplad på den.
  Tidigare försvann stämplingen för klara ordrar, så man fick stämpla ut från
  Mina jobb/Tid.
* **Starta arbete ≠ Stämpla in.** Etikett, plats och färg skiljer dem åt:
  * *Starta arbete* är en statusändring. Den är den primära knappen i
    åtgärdsraden (marinblå `bp`).
  * *Stämpla in* är tidregistrering (`ao_time`). Den sitter i den egna raden
    *Din arbetstid* (grön ikon) och, på mobil, i snabbåtgärdsraden.

  Ingen av dem utlöser den andra. AOD-01, AOD-04 och AOD-09 visar det mot
  servern.
* Mobil och surfplatta under 1024 px: knappen finns i snabbåtgärdsraden som
  förut. Raden *Din arbetstid* visas där bara när man är instämplad (med
  tidräknaren) eller instämplad på en annan order.
* Dator från 1024 px: raden syns alltid. QBAR-01:s krav på
  `.aod-stamp .ao-stamp-btn` vid 1024 px är uppfyllt.
* `toggleStamp()`, `_openClockOutModal()` och TimeService/StampService/MyJobsPage
  är oförändrade: serverbekräftelse, dubbelstämplingsskydd och återhämtning
  fungerar exakt som förut.

## 5C — Åtgärdsraden

Tabellen visar de tidigare åtgärderna (inventerade i koden före ändringen,
`_primaryActionBtns` + `_secondaryActions`) och var de finns nu:

| Åtgärd (oförändrad etikett) | Anrop (oförändrat) | Villkor (oförändrat) | Nu |
|---|---|---|---|
| Starta arbete | `setStatus('pågående')` | `ao_edit`, nytt/pool/planerad | **primär** |
| Klarmarkera | `markComplete()` | `ao_complete`, pågående | **primär** |
| Substatus-väljare | `setSubstatus(value)` | `ao_edit`, pågående, substatus satt | synlig bredvid primär |
| Skapa fakturaunderlag | `InvoicesPage.createFromAO(id)` | `invoice_create`, klar utan faktura | **primär** |
| Återaktivera | `openReactivateModal()` | `ao_edit`, avbruten, ej arkiv/papperskorg | **primär** |
| Återställ (papperskorg) | `_restoreFromTrash(id)` | i papperskorgen | **primär** |
| Byt status | `openStatusModal()` | `ao_edit`, ej klar/fakt./avbruten/arkiv/papperskorg | synlig (dator), ⋮ *Status* (mobil) |
| Kontakt | `openContact()` | alltid | synlig |
| Ny uppgift | `ActivitiesPage.openCreate({…})` | sidan Uppgifter får visas | ⋮ *Arbetsorder* |
| Planera | `setStatus('planerad')` | `ao_edit`, nytt/pool | ⋮ *Planering och personal* |
| Till pool | `setStatus('pool')` | `ao_edit`, nytt | ⋮ *Planering och personal* |
| Omplanera | `openReschedule()` | `ao_edit`, planerad | ⋮ *Planering och personal* (även i När-kortet) |
| Pausa | `setStatus('planerad')` | `ao_edit`, pågående | ⋮ *Status* |
| Visa fakturaunderlag | `Router.showPage('pg-inv-detail',…)` | klar med faktura | synlig (dator), ⋮ (mobil) |
| Redigera | `openEdit()` | `ao_edit` | synlig (dator), ⋮ (mobil) |
| Personal | `manageStaff(id)` | `ao_edit` | ⋮ (även "Ändra" i Vem-kortet) |
| Ändra prissättning | `openPricingModal()` | `ao_edit` eller `invoice_create` | ⋮ (även "Ändra" i Prissättning) |
| Arkivera | `openArchiveModal()` | `ao_edit`, ej arkiv/papperskorg | ⋮ *Arkiv och borttagning* |
| Ta bort | `openDeleteModal()` | samma | ⋮, sist, röd, med bekräftelse |
| Återställ från arkiv | `_restoreFromArchive(id)` | arkiverad | **primär** för arkiverad order |
| Radera permanent | `_confirmPermanentDelete(id)` | i papperskorgen | ⋮, sist, röd, med bekräftelse |

* **En** primär åtgärd (`btn bp`):
  * papperskorg → *Återställ*;
  * arkiverad → *Återställ från arkiv*;
  * annars statusens nästa steg: Starta arbete / Klarmarkera / Skapa
    fakturaunderlag / Återaktivera.

  Övriga åtgärder som tidigare var "primära" ligger kvar i ⋮. Ett exempel är
  Starta arbete på en order i papperskorgen, som den gamla raden också visade.
* **Dator:** primär + upp till tre synliga sekundära (`btn bs`: Byt status,
  Kontakt, Redigera / Visa fakturaunderlag) + **⋮**.
* **Mobil:** primär i full bredd, sedan *Kontakt* och ⋮ (44 × 44 px).
* ⋮ följer komponentstandarden §3. Det är en ikonknapp med `aria-label` och
  `title` "Fler åtgärder" som öppnar den delade overflow-menyn
  (`aoToggleOverflow`). Menyn:
  * är grupperad: Status / Planering och personal / Arbetsorder / Arkiv och
    borttagning (destruktiva poster sist och röda);
  * har ikon + text och 40–44 px tryckytor;
  * stängs med Esc eller klick utanför;
  * placeras fast mot knappen och är begränsad till fönstret. Den öppnas uppåt
    om det finns mer plats där och vänsterjusteras om knappen hamnat långt till
    vänster (radbruten rad på surfplatta). AOD-06 hittade det felet, som nu är
    rättat;
  * rullar inuti sig själv och stängs vid sidrullning eller storleksändring;
  * ger första posten fokus.
* **Ingen åtgärd har försvunnit.** AOD-02 jämför 155 tidigare
  [etikett, anrop]-par (10 lägen × roller) mot den nya raden och ⋮ på både
  dator och mobil.
* **Tillägg — Starta arbete för den som är tilldelad men saknar `ao_edit`**
  (rollen fält/`personal`):
  * Mina jobb erbjuder redan samma person *Starta* för samma order
    (`MyJobsPage.startJob` → `WorkOrderService.setStatus(id,'pågående')`, utan
    klientspärr, servern avgör).
  * AO-detaljen visar nu samma knapp under exakt samma villkor: sidan Mina jobb
    får visas, ordern är ens egen, den är inte arkiverad eller borttagen och
    statusen är nytt/pool/planerad (`_canStartOwn`, `startOwnJob`). Anropet och
    beskedet är desamma som i Mina jobb.
  * Ingen ny behörighet och ingen ny statusövergång. AOD-02 säkerställer att det
    enda nya statusanropet är just detta, under just dessa villkor. Se *Öppna
    frågor* 1.
* **Slutför (Klarmarkera)** kräver `ao_complete` som förut. Rollen `personal`
  har inte den behörigheten i dagens rolldata, så fältarbetaren får ingen
  Klarmarkera. AOD-09 visar att flödet fungerar ända till klarmarkering om
  rollen får `ao_complete`. Rollerna är data, inte kod.

## 5D — Prissättning

* **Placering:** det nya kortet **Prissättning** ligger överst i sidokolumnen på
  dator och syns i första skärmbilden på 1366×768 (AOD-05). På surfplatta ligger
  det direkt efter uppdraget, på mobil efter arbetstiden.
* **Prismodell** som märke: **Fastpris** / **Löpande timpris** / **Ej satt**.
  *Ej satt* har en varning om att fakturaunderlag inte kan skapas och länken
  *Sätt prissättning*.
* **Fastpris:**
  * **Avtalat pris** (kr exkl. moms);
  * *Priset kommer från*: "Satt på arbetsordern" eller *Offert OFF-nnn
    (offertens summa exkl. moms efter rabatt)*.
* **Löpande timpris:**
  * **Prisgrupp** och **Timpris** (kr/tim exkl. moms);
  * *Priset kommer från*: "Prisgruppen i prisregistret, vald på arbetsordern.
    Tidposter faktureras med sitt sparade timpris";
  * varning om prisgruppen saknar giltigt timpris eller inte längre finns.
* **Länkar:** till offerten, och till avtalet om fältet `contractId` finns. Det
  finns inte i dagens AO-modell, se *Öppna frågor*.
* **Material:** antal rader, försäljning exkl. moms, samt *Inköp* och *Påslag*
  exkl. moms (märkta "internt").
* **Arbetstid:**
  * registrerad och debiterbar tid, i timmar ("8,5 h");
  * **tidposternas sparade timpris**, t.ex. "Akut / kväll / helg – 695 kr/tim
    exkl. moms (1 st)";
  * en notis när det sparade priset skiljer sig från orderns prisgrupp;
  * antal tidposter som saknar prissättning.
* **Fakturering** (tidigare eget kort, samma villkor): Skapa fakturaunderlag,
  länk till fakturaunderlaget, arbetsunderlaget från offerten och länk till
  offerten.
* *Detaljer* innehåller nu bara metadata: kategori, tekniskt, ansvarig, projekt,
  skapad, senast ändrad och klarmarkerad. Kortet är öppet på bred skärm
  (≥ 1200 px) och hopfällt på mobil och surfplatta, med rubriken "Detaljer —
  Skapad, ändrad, ansvarig".

**Säkerhet (oförändrad):**
* Kortet ritas bara när `canSeePrice` är uppfyllt (`invoice_view`,
  `invoice_create` eller `reports_view`). Det är exakt samma spärr som
  prisraden i Detaljer, materialpriserna och Fakturering-kortet hade.
* *Ändra* = `_canEditPricing()` (`ao_edit` eller `invoice_create`) som förut.
* Fältarbetare (`personal`) och begränsad roll ser inget prissättningskort,
  inga materialpriser, ingen intern lönsamhet och ingen *Tid mot plan*
  (AOD-05/07/08, dator och mobil).
* Inköp och påslag visas bara för `canSeePrice`, som redan såg inköpspriset
  bakom "Intern" i materiallistan.

**Var 430 kr/tim kommer ifrån (STAGING).** Värdet läses ur prisregistret, inte
ur arbetsordern:
* Arbetsordern sparar bara `priceType: 'timpris'` och `priceGroupId`.
* Sidan slår upp gruppen med
  `(state.priceGroups||[]).find(p => p.id === ao.priceGroupId)` och visar
  `pg.hourRate`, i `_priceLabel(ao)` och nu även i `_pricingCard(ao)`.
* I demodatan (`src/data/seedData.js` rad 210) är **PG-002 "Fastighetsservice
  standard" `hourRate: 430`**, och AO-015 har `priceGroupId: 'PG-002'`.
* Samma uppslag förväljer prisgruppen i utstämplingsdialogen
  (`_openClockOutModal`, `aoPgId`) och i *Registrera tid*.
* Tidposten sparar sedan gruppens namn och timpris som ögonblicksbild
  (`t.priceGroupName`, `t.hourRate`). Det är **tidpostens** `hourRate` som
  faktureras (`BillingQueueService`: `var rate = t.hourRate`).

Inga priser är ändrade. Demodatan har för övrigt en tidpost (TE-001) med
`priceGroupId: 'PG-001'` men sparat namn "Standard" och 695 kr/tim. Kortet visar
den skillnaden (se `efter-admin…`/`efter-chef…`).

## 5E — Övriga kort

* Samma visuella språk i alla kort (`.card` > `.card-header` med h3 + åtgärd >
  innehåll), och textade knappar ("+ Lägg till", "+ Registrera tid", "Foto eller
  anteckning").
* **Tomlägen** följer komponentstandarden §6: `.empty` med ikon, rubrik, en
  mening och en åtgärd om rollen har en. Kortets rubrikknapp döljs medan
  tomläget visas, så att det inte blir två likadana knappar.
* **Material och kostnader** och **Arbetstid** är inte längre hopfällbara.
  Tidigare var de stängda när de var tomma, och man fick leta efter +.
* **Material** visas som rader i stället för tabell, så att 360 px klarar sig
  utan sidledsrullning (komponentstandarden §7). Varje rad visar:
  * namn och antal/enhet (svensk decimal);
  * för `canSeePrice`: à-pris exkl. moms och summa inkl. moms;
  * *Intern* (inköp/marginal) som förut;
  * 40 px-knappar för redigera och ta bort, med etiketter för skärmläsare.
* **Tid mot plan** är ett kompakt block inne i Arbetstid (tidigare ett eget kort).
* **Bilder** (nytt kort): miniatyrer av foton i loggen och av äldre anteckningar
  med inbäddad bild. Klick visar bilden större. Bilder i Storage hämtas med samma
  serverkontrollerade signerade URL:er som tidslinjen, en hämtning per
  renderingsomgång. AO har ingen bilagemodell, därför heter kortet "Bilder".
* **Aktivitetshistorik** (tidigare "Logg och bilder"): samma tidslinje och samma
  knappar, *Uppföljning* och *Anteckning*.
* **Var / När / Vem / Kund och kontakt:** innehållet är oförändrat.
* **Intern lönsamhet** ligger direkt under Prissättning, så att ekonomin är
  samlad. Den är fortfarande hopfälld och har samma behörighet
  (`reports_view`/`staff_view`).

## Komponentstandarden (`docs/V3-KOMPONENTSTANDARD.md`)

* **§2 Knappar:** en `btn bp` per vy (primär), `btn bs` för sekundära,
  `bghost` för länkartade och `bd` för destruktiva med bekräftelse. Ikon och
  text står i samma rad. Tryckytor är ≥ 40 px på mobil (AOD-02 mäter).
* **§3 Åtgärdsmeny:** ⋮-ikonknapp och grupperade poster med ikon och text.
  Destruktiva poster ligger sist, röda och med bekräftelse. Inga funktioner har
  försvunnit (AOD-02).
* **§6 Kort och tomlägen:** se 5E. Faktarader följer `aod-fact`-mönstret, även
  i Prissättning.
* **§8 Status:** `sbdg`/`pbdg`; semantiska färger för utförande och framsteg
  (ok grön, warn orange, danger röd).
* **§10 Format:**
  * belopp alltid med **exkl. moms** eller **inkl. moms** utskrivet: material,
    prissättning, offertrader, lönsamhet och sidans prisgruppslistor;
  * timmar med svensk decimal ("2,5 h", "8,5 h") i arbetstid, När, Tid mot
    plan, prissättning och historik;
  * materialantal med svensk decimal ("1,5 l").
* **§11 Säkerhet:** all data-härledd text går genom `esc()`. `ic()` escapas
  inte och ligger aldrig i attribut. RENDER-01 och XSS-01 är gröna.
* **§12 Verkligt innehåll:** se nästa avsnitt.

## Granskning med realistiskt innehåll — alla statusar och roller

AOD-07 (390 px) och AOD-08 (1366 px) seedar sju ordrar med realistiskt innehåll,
en per status: ny, planerad, pågår, **pausad** (pågående + substatus pausad),
klar, fakturerad och avbruten. Varje order har:
* lång rubrik och beskrivning med stycken, och lång intern anteckning;
* **22 checkpunkter** i blandade lägen, avvikelser med kommentar och bild;
* sex materialrader med långa namn och decimalantal;
* fem tidposter: olika personer, en ej debiterbar, en attesterad och en med
  annat sparat timpris;
* fyra foton, anteckningar och en uppföljning.

Dessutom finns en order med **saknade fält**: ingen beskrivning, adress, kund,
kontakt, datum, kategori, prismodell, checklista eller material.

Varje order öppnas som fält, arbetsledare, ekonomi och admin (4 roller × 8
ordrar × 2 bredder = 64 visningar). Kontrollerna:
* inget klipps och ingen sidledsrullning;
* inga "undefined"/"NaN";
* rätt primär åtgärd per roll och status (befintlig funktion);
* 22 synliga checkpunkter med rätt "N av 22 klara";
* 6 materialrader, med priser inkl. moms bara för prisroller;
* tidposter per roll — servern ger fält och arbetsledare bara egna poster;
  ekonomi och admin får alla;
* 4 bilder;
* prissättning med timpris exkl. moms och tidposternas sparade pris för
  prisroller, och ingen ekonomi alls för fält;
* *Din arbetstid* bara där rollen har `ao_time` och ordern inte är avslutad;
* tomlägen och "Ingen beskrivning angiven"/"Ej planerad"/prismodell "Ej satt"
  för ordern med saknade fält.

Granskningsbilderna finns i `docs/qa-2026-11-26/fore-efter/aodetail/`
(prefix `efter-rik-…`, se *Skärmbilder*).

## Fältflödet på mobil (390 px) — AOD-09

Fältarbetaren (rollen `personal`, falt2) gör hela flödet utan att något klipps.
Varje steg kontrolleras med `layoutIssues()`, och varje knapp klickas som en
användare gör (Playwright vägrar klicka på en knapp som täcks):

1. Öppnar jobbet från **Mina jobb**.
2. **Starta arbete** (primär i full bredd) → servern visar pågående. Ingen
   tidpost och ingen stämpling skapas.
3. **Stämpla in** i snabbåtgärdsraden → raden *Din arbetstid* med tidräknare
   visas i sidhuvudet.
4. **Checklista** i snabbåtgärdsraden rullar till listan → *Markera utförd* →
   servern sparar vem som utförde punkten, och "1 av 22" uppdateras både i
   kortet och i snabbåtgärdsraden.
5. **Material** → dialog → raden sparas på servern och syns direkt.
   **Foto/anteckn.** → bild + text → loggposten sparas med bild i Storage och
   syns i *Bilder*.
6. **Stämpla ut** → exakt en tidpost.
7. **Slutför:** utan `ao_complete` finns ingen Klarmarkera (oförändrad
   behörighet). När rollen får `ao_complete` blir *Klarmarkera* primär;
   "Klarmarkera ändå" (ofullständig checklista) → servern visar klar.

Stegbilderna heter `efter-flode-390-1-mina-jobb.png` … `-8-stampla-ut.png`.

## Säkerhet och robusthet

* Alla data-härledda strängar i den nya markupen går genom `esc()`.
  `ic()`-ikoner escapas inte.
* Id:n i inline-handlare (`onclick="…('${id}')"`) går genom `_id()`. Den släpper
  bara igenom tecken som förekommer i systemets id:n (`A–Z a–z 0–9 _ . : -`).
  Normala id:n blir oförändrade, därför är anropen i tabellen ovan identiska med
  de gamla.
* Id:n för material-, tid- och loggposter skickas nu via `data-id` +
  `this.dataset.id`, i stället för att klistras in i JavaScript-strängen.
* Tidpostraderna escapar nu personnamn, datum, tider, prisgrupp och "registrerat
  av". Tidigare var de inte escapade.
* `_refreshTimeSection()` ritade om *Tid mot plan* utan rollspärr efter en
  tidsändring, så en fältarbetare kunde då se blocket. Nu gäller samma spärr som
  vid full rendering.
* Mobilens plats- och kontaktkort ritas bara när det finns något att visa.
  Granskningen med saknade fält visade annars ett tomt kort.
* Stängda `<details>` får `display:none` på innehållet. Annars gav Chromes
  `content-visibility` osynliga rutor under snabbåtgärdsraden, vilket QBAR-01
  upptäckte.

## Skärmbilder

Alla ligger i `docs/qa-2026-11-26/fore-efter/aodetail/` och är tagna mot den
simulerade servern med deviceScaleFactor 1.

**Före/efter (390 och 1366 px).** Varje vy finns som första skärmbild
(`…-390.png`, `…-1366.png`) och som hel sida (`…-hel.png`):

| Vy | Före | Efter |
|---|---|---|
| Admin, AO-007 planerad (fastpris) | `fore-admin-planerad-{390,1366}[-hel].png` | `efter-admin-planerad-…` |
| Arbetsledare, AO-001 pågående (timpris, material) | `fore-chef-pagaende-…` | `efter-chef-pagaende-…` |
| Fältarbetare (falt2), AO-015 nytt/akut | `fore-falt-nytt-…` | `efter-falt-nytt-…` |
| Ekonomi, AO-011 klar (timpris, material, tid) | `fore-ekonomi-klar-…` | `efter-ekonomi-klar-…` |

**Realistiskt innehåll (bara efter).** Före-versionen har inte tagits med samma
seed:
* 390 px: `efter-rik-falt-planerad`, `-falt-pagaende`, `-chef-pausad`,
  `-ekonomi-klar`, `-falt-saknade-falt`;
* 1366 px: `efter-rik-chef-pagaende`, `-admin-ny`, `-ekonomi-fakturerad`,
  `-admin-avbruten`, `-falt-pagaende`, `-chef-saknade-falt`.

Varje bild finns som första skärmbild och som `-hel`.

**Fältflödet:** `efter-flode-390-1…8-*.png`.

## Tester

Nya tester i `tests/e2e/specs/27_aodetail.js` (simulerad server):

| Id | Vad |
|---|---|
| AOD-01 | Primär åtgärd per status och roll. Admin/chef: planerad → Starta arbete (`setStatus('pågående')`), pågående → Klarmarkera (`markComplete()`), klar → Skapa fakturaunderlag (`InvoicesPage.createFromAO`). Ekonomi: bara fakturaunderlag. Fält: Starta (Mina jobb-vägen) på egen planerad order, annars ingen. Högst en primär. Stämplingsraden visas bara med `ao_time` och inte på klar order. Klick på Starta arbete → servern pågående, ingen tidpost, ingen stämpling; primär blir Klarmarkera. |
| AOD-02 | Ingen förlorad åtgärd. Den gamla raden är avskriven villkor för villkor: 155 [etikett, anrop]-par i lägena nytt, pool, planerad, pågående+substatus, klar, klar+faktura, avbruten, arkiverad och papperskorg, för admin (dator+mobil), chef, ekonomi, fält och begränsad. Varje par finns i både dator- och mobilvarianten. Det enda nya statusanropet är Mina jobb-starten för tilldelad utan `ao_edit`. Synliga knappar ligger inom skärmen (≥ 40 px på mobil), alla poster i ⋮ inom fönstret. Redigera/Ändra prissättning/Personal öppnar sina dialoger. |
| AOD-03 | Checklistan ligger i Uppdrag & utförande och är inte hopfällbar. Kontroller: "3 av 5 klara", "2 kvar", stapel 3/5, teckenförklaring, avvikelselista, snabbåtgärd 3/5. Återställningsregler: egen ja, annans nej, servern svarar `forbidden_other`. Påbörja → Utförd → återställ: framsteget uppdateras utan omladdning, servern registrerar rätt person, AO-status orörd. Snabbåtgärden rullar till checklistan. |
| AOD-04 | Starta arbete → status, ingen tid eller stämpling. Stämpla in via den kompakta raden → serverstämpling, ingen status- eller tidändring, levande tidräknare. Annan AO visar "instämplad på AO-T1" och nekar dubbelstämpling. Stämpla ut efter 30 min → **exakt en** tidpost (~30 min), ordern är kvar som pågående. Mobil: rad med tidräknare när man är instämplad. |
| AOD-05 | Prissättningskortet: admin fastpris 3 800 kr / Satt på arbetsordern; chef Fastighetsservice avtal 392 kr/tim; ekonomi 430 kr/tim + inköp/påslag. Kortet syns i första skärmbilden på 1366×768, Ändra finns och Detaljer saknar pris; kortet syns även för ekonomi på mobil. Fält och begränsad (dator + mobil): inget kort, ingen pris- eller ekonomitext, inga materialpriser och ingen "Ändra prissättning". |
| AOD-06 | Ingen horisontell överbredd och inget element utanför skärmen vid 360, 390, 768, 1024, 1366 och 1920 px, för admin, arbetsledare (lång rubrik + substatus) och fält. ⋮ öppnas och ryms. |
| AOD-07 | Realistiskt innehåll, 390 px: 7 statusar + saknade fält × 4 roller (se ovan). |
| AOD-08 | Samma kontroller som AOD-07 vid 1366 px. |
| AOD-09 | Fältflödet på 390 px (se ovan). |

**Ändrat befintligt test: CHK-02.** Testet kontrollerade texten "1/4 utförda|2/4
utförda" i `#ao-chk-counter`. Indikatorn säger nu "N av 4 klara" + "N utförda".
Kontrollen är densamma (att utförda räknas); regexen följer den nya texten:
`/[12] av 4 klara/` **och** `/[12] utförda/`. CHK-03 (`/2 pågår/`) gäller
oförändrad.

Körningarna gjordes mot den simulerade servern. Maskinen kördes samtidigt av
andra arbetsblocks testsviter, vilket gav hög last.

| Körning | Kod | Resultat |
|---|---|---|
| Riktad: `--grep "^(AOD-\|QBAR-01\|AO-\|CHK-\|SYNC-AO\|TIME-\|MYJOBS-\|RENDER-01\|XSS-01\|VAT-01\|BRAND-01)"` | slutlig (9a6462d) | **41 godkända, 0 misslyckade, 1 känt fel (AO-07, G5) av 42** (385 s) |
| **Hela sviten** `node tests/e2e/run.js` | slutlig (9a6462d) | **126 godkända, 2 misslyckade, 1 blockerad (PERM-03), 1 känt fel (AO-07) av 130** (994 s) |
| Omkörning av de två misslyckade, 3 gånger | slutlig | PROP-01 och MAT-01: **godkända 3 av 3** |
| Hela sviten, tidigare körning | 1435fc9 (före ändringen av plats- och kontaktkortet) | 127 godkända, 1 misslyckad (RENDER-01: tidsgräns 90 s under last; godkänd i alla riktade körningar), 1 blockerad, 1 känt fel av 130 |
| `bash tests/run-all.sh` | slutlig | 15 av 19 testfiler gröna, **0 misslyckade**, 4 överhoppade (ingen lokal PostgreSQL) |

**De två misslyckade testerna i hela sviten:**
* *PROP-01* (fastighetsregistret, inte AO-detaljen) gav en tidsgräns i
  `waitForFunction`.
* *MAT-01* sparade antal 1 i stället för 3. Materialdialogen och
  `_saveMaterial()` är oförändrade i detta block.

Båda var godkända i den tidigare hela körningen och 3 av 3 gånger när de kördes
ensamma. Felbilden tyder på last från de parallella körningarna, inte på ett fel
i koden. De bör ändå bevakas i nästa hela körning.

## Öppna frågor / kräver affärsbeslut

1. **Starta arbete för fältarbetare på AO-detaljen.** Funktionen och villkoret
   finns redan i Mina jobb, och detaljsidan använder samma. Lucas bör bekräfta
   att det är önskat att knappen även syns i detaljvyn. Om inte: ta bort
   `_canStartOwn`-grenen i `_actionModel()` (en rad); AOD-01/07/09 ska då
   uppdateras.
2. **Slutföra som fältarbetare** kräver `ao_complete`, som rollen `personal`
   saknar i dag. Det är ett rollbeslut (Admin → Roller), ingen kodändring.
3. **"Tillägg"** (kravtexten nämner avvikelser och tillägg i utförandet): det
   finns ingen datamodell för tillägg eller tilläggsarbete på en AO. Avvikelser
   visas. Tillägg kan inte visas förrän det finns ett fält eller en rutin.
4. **Bilagor:** AO har bara bilder i loggen, inga bilagor (dokument). Kortet
   heter därför "Bilder".
5. **Avtal (`contractId`)** finns inte på arbetsordern i dag. Kortet visar en
   avtalslänk om fältet sätts.
6. **Fältarbetare ser timpris (befintligt, oförändrat).** Tidpostraderna visar
   "Prisgrupp – N kr/tim exkl. moms" för egna tidposter, och utstämplings- och
   tidsdialogen listar prisgrupper med timpris. Det är kundpris, inte
   inköpspris, och fältarbetaren väljer prisgrupp vid utstämpling. Det är ändå
   inkonsekvent med att prissättningen i övrigt är dold för fält. Det behövs ett
   beslut om fält ska se timpriser; synligheten är inte ändrad.
7. **Redigera och ta bort material** visas för alla som ser ordern (befintligt);
   servern avgör. Det är inte ändrat.
8. **Substatus** kan bara bytas när en substatus redan är satt (befintligt
   villkor, oförändrat). Sidan har ingen väg att sätta en första substatus.
9. **Timformat:** sidan visar timmar som "2,5 h" enligt komponentstandarden.
   Dialogrutor, loggtexter, Mina jobb och Tid använder fortfarande
   `TimeService.fmtDuration` ("2t 30m"), som delas av andra sidor och inte är
   ändrad.

## Kvar / kända begränsningar

* Inget är verifierat mot riktig STAGING (förbjudet i detta uppdrag). Allt är
  prövat mot den simulerade servern.
* `bash tests/run-all.sh`: 4 testfiler hoppas över eftersom miljön saknar lokal
  PostgreSQL (checklist_progress_sql, offer_attachment_upload del 2–3,
  server_rpcs_sql, staging_backup_export). De räknas inte som godkända.
