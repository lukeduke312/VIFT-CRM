# Dashboard — Anpassa-läge, widgetöversyn och kartan (2026-11-26)

**Gren:** arbetsträd från `claude/vift-v3-major-redesign` (05058e8). **Miljö:** lokal statisk server + simulerad Supabase (`tests/e2e`). Ingen trafik till STAGING, LIVE eller något Supabase-projekt.
**Filer:** `src/pages/Dashboard.js` (v60), `src/data/DashboardConfig.js` (v14), `src/styles/v3-dashboard.css` (v2), `index.html` (bara dessa tre `?v=`), `tests/e2e/specs/25_dashboard.js` (ny).
Inga andra filer är ändrade. Inga affärsregler, statusar, behörighetskontroller eller serverskrivvägar är ändrade.

---

## 1. Anpassa dashboard — ett tydligt, separat läge

**Problem (före):** små draghandtag (tre prickar utan text), upp/ned-pilar, en bråktalsväljare (¼ ½ ¾ Hel), ögonikoner utan text, en stor streckad yta med två rader kontroller runt varje widget. På mobil hamnade "Dolda widgets" överst och hjälptexten bröts av en ikon (`fore-anpassa-390.png`, `fore-anpassa-1366-hel.png`).

**Nu:**

- **Knappen "Anpassa"** (ikon + text) i dashboardens huvud ersätter det omärkta kugghjulet.
- **Sticky verktygsrad** "Anpassa dashboard" med **Spara** (primär), **Avbryt** och **Återställ standard**, plus status **"Inga ändringar ännu" / "Osparade ändringar"** och senaste åtgärden i klartext. På mobil ligger knapparna i en rad med tre lika breda knappar (Återställ / Avbryt / Spara).
- **Kort hjälprad:** "Dra i Flytta …", "Storlek: Liten, Halv eller Hel", "Dölj flyttar widgeten till Dolda widgets", genväg **"Dolda widgets (N)"**. En rad förklarar att layouten sparas bara för dig på den här enheten och att dagens tavla överst är fast.
- **Varje widget** får en kompakt redigeringsrad: **Flytta**-handtag (ikon + text), widgetens namn och **"Plats 3 av 12"**, storleksknappar **Liten / Halv / Hel** (segmenterad knappgrupp med `aria-pressed`) och **Dölj** (ikon + text). Under raden visas widgeten som **live-förhandsvisning** (inert — går inte att klicka i, kapas med tonad kant om den är lång). Kortet har en lätt streckad blå ram (heldragen vid hovring/fokus).
- **Storlekar bara där de är relevanta** (`DashboardConfig.MODULES[].sizes`): listor (pool, uppgifter, offerter …) Liten/Halv/Hel; bredare widgetar (karta, nyckeltal, rondering, Kräver åtgärd, aktiviteter) Halv/Hel. En äldre sparad ¾-bredd visas som vald **"Bred"** och tas aldrig bort tyst. På telefon (< 700 px) visas inget storleksval — alla widgets är ändå fullbreda där, och layouten är per enhet.
- **Widgets som bara visas när det finns något** (Försenade aktiviteter, Kräver åtgärd, Aktiviteter) visar i redigeringsläget en förklaring, t.ex. "Visas bara när det finns försenade uppföljningar.", i stället för "Inget att visa just nu".
- **Dolda widgets**: egen sektion med ikon, namn, beskrivning och knappen **Visa** per widget. "Visa" lägger tillbaka widgeten längst ned, rullar dit, markerar den kort och flyttar fokus till den.
- **Återkoppling:** toast vid Dölj/Visa/Spara/Avbryt/Återställ, statusrad i verktygsraden och en **beständig `aria-live`-yta** (`#dash-live`, utanför det som byggs om) som läser upp t.ex. "Rondering flyttad till plats 5 av 12."

### Flytta

- **Dator:** HTML5 dra-och-släpp från **Flytta**-handtaget; hela kortet visas som dragbild, en **blå linje** visar var widgeten hamnar (före/efter, lodrätt eller vågrätt beroende på kortets bredd) och en yta **"Släpp här för att lägga widgeten sist"** visas under dragningen. Släpp utanför ett mål ändrar ingenting. En bakgrundsuppdatering (DataSync) under pågående dragning väntar tills dragningen är klar.
- **Tangentbord:** fokusera Flytta och använd **piltangenterna** (ett steg), **Home/End** (först/sist). Fokus följer widgeten.
- **Mobil och pekskärm** (`max-width: 768px` eller `pointer: coarse`): inget dra-handtag; i stället knapparna **Flytta upp / Flytta ned** (≥ 38 px höga) direkt under widgetens namn. Första/sista knappen är inaktiv där den inte går att använda.

### Spara / Avbryt / Återställ standard

- **Inget sparas förrän Spara.** Alla ändringar görs i ett utkast i minnet.
- **Avbryt** kastar utkastet och visar exakt samma sparade layout som innan (testat: samma ordning och oförändrad `localStorage`).
- **Spara utan ändringar** skriver ingenting (tidigare skapades då en personlig layout och sektionsrubrikerna försvann).
- **Återställ standard** frågar först ("Återställ standardlayout?" — *Behåll nuvarande* / *Återställ standard*) och laddar bara rollens standard i utkastet; det sparas vid Spara (då tas den personliga layouten bort, så att rollstandarden med sektionsrubriker visas igen). Avbryt ångrar.
- **Användarbyte:** ett utkast hör till en användare. Loggar någon annan in medan läget är öppet kastas utkastet — det kan aldrig visas eller sparas under fel användare (tidigare kunde ett öppet utkast sparas under nästa användares nyckel).

### Lagring: personlig per användare **och enhet**

Oförändrat sätt att lagra: `DashboardConfig.saveUserLayout()` skriver `localStorage['dashLayoutV2_<staff-id>']`. Layouten är alltså **personlig per användare och per webbläsare/enhet**, synkas inte till servern och påverkar aldrig andra användare. Två användare på samma dator har var sin nyckel. Samma användare på en annan enhet ser rollens standard tills hen anpassar där. (Att synka layouten mellan enheter vore en ny serverlagrad inställning — ett produktbeslut, inte gjort.)

**Bakåtkompatibilitet:** `dashLayout_<id>` (V51A, `size`-strängar) läses fortfarande och migreras i minnet; den skrivs aldrig över. `dashLayoutV2_<id>` läses som förut. Okända/borttagna widget-id ignoreras. Sparade bredder (även ¾) bevaras. Tillfälligt obehöriga widgets behåller sin sparade plats vid Spara (oförändrad sammanslagning från V51B R3).

---

## 2. Widgetöversyn

- **Standardlayout** (bara användare utan sparad layout): endast Liten/Halv/Hel så att raderna fylls. Admin/arbetsledare: Försenade aktiviteter, Kräver åtgärd (hel) → Aktiva jobb — karta (hel, karta och lista sida vid sida) → Arbetspool + Mina uppgifter (halv + halv) → Rondering + Återkommande → Aktiviteter → Säljchanser + Offerter → Senaste händelser + Öppna per kategori. Den tidigare 9+3 (karta ¾ + pool ¼) gav en halvtom rad på 1024–1279 px där ¼ breddas till ½; äldre sparade ¾-layouter visas nu som ½ i det intervallet så att paret fyller raden.
- **Brådskande överst och utan dubblerad rubrik:** sektionsrubriken "KRÄVER ÅTGÄRD" togs bort (den upprepade kortets rubrik "Kräver åtgärd") och den sektionen kan inte längre fällas ihop. Mobilens ordning (nyckeltal → Kräver åtgärd → schema) är oförändrad.
- **Gemensam rubrikrad** för alla widgetar (`Dashboard._head`): ikon + rubrik, antal som märke, och högst **en** länk "Visa alla →" (tidigare olika storlekar 9–11 px, olika knappar, ibland ingen länk).
- **Försenade aktiviteter:** från stor röd banderoll till ett kort i samma stil: antal, de tre äldsta med **"5 dagar sen"**, datum och kund, och knappen **Visa försenade**. Urvalet är samma som Aktiviteter-widgeten (alla för den som ser personal, annars egna/otilldelade) — tidigare räknades alla bolagets försenade aktiviteter även för en fältarbetare.
- **Kräver åtgärd:** raderna är riktiga knappar (tangentbord/skärmläsare), mest brådskande först, tonad överkant (röd vid akut, annars orange).
- **Arbetspool:** sorteras **akut → hög → normal → låg**, inom samma prioritet det som väntat längst; raden visar kund, adress och **"väntat 3 d"**; rubriken "3 väntar" och en röd rad "1 akut jobb väntar på att tilldelas" när det finns akuta.
- Tomma kort som sträcks till radens höjd centrerar sin tomvy i stället för att lämna en stor tom yta under.
- **Ikoner på egen rad** (V3-standard §2) rättade i Öppna per kategori (akut-räknaren) och Rondering ("N avvikelser saknar arbetsorder").
- **Granskat med realistiskt innehåll** (V3-standard §12, test DASH-E-11): 40 försenade aktiviteter, 30 jobb i poolen, 150 aktiva jobb, titlar på ~140 tecken, vid 390 och 1366. Försenade aktiviteter visar 3 rader + antal 40 + "Visa försenade" (kortet 241–274 px högt), Arbetspool visar akut först, 3–4 rader + "Visa alla/Visa fler", kartlistan 25 rader + "Visa alla 190 aktiva jobb", långa titlar kortas av med … i stället för att bryta raden, inget sidledes överspill. Tomlägen kontrollerade med en användare med få egna jobb (begränsad roll).

### V3-komponentstandarden (docs/V3-KOMPONENTSTANDARD.md)
- Kort: `.card` > `.card-header` (h3 + en åtgärd till höger) > `.card-body` i alla widgetar (§6). Tomläge i kartan: ikon, h3, en mening och en åtgärd.
- Knappar: en primär per vy/sektion — i Anpassa-läget bara **Spara**; ikon + text överallt (Flytta, Dölj, Visa, Flytta upp/ned, Anpassa); ikon-only bara för "Mina inställningar" (med `aria-label` och `title`) (§2).
- Tryckytor ≥ 40 px på mobil/pekskärm för dashboardens egna knappar (§2). Dialogen "Återställ standardlayout?": titel ikon + text, primärknappen till höger (§9).
- Datum via `fmtDate`; all data via `esc()`; `ic()` aldrig i attribut (§10–11). RENDER-01 och XSS-01 gröna.
- Semantiska färger: brådskande = röd/orange överkant, accentfärgen används bara för markering (vald storlek), inte för status (§8).

---

## 3. Aktiva jobb — karta: varför jobben inte placeras

### Fakta från riktig STAGING (SQL-läsning av koordinatorn, inte av mig)
- 363 AO: **0 med lat/lng**, 337 med adress, 322 med `propertyId`, 28 med `geocodedAddress` men utan koordinater. 131 fastigheter: 0 med lat/lng.
- 205 aktiva jobb (nytt/pool/planerad/pågående), **0** med lat/lng: 190 har egen adress med postnummer eller ort, 1 har adress utan ort, 14 saknar egen adress (och ingen kopplad fastighet har ort). 179 av de aktiva är QA-LOAD-data inlagd utan geokodning.
- Användarens skärmbild: "206 kunde inte placeras" — alltså även de upp till 20 som kartan själv sökte (nästan alla med ortskontext).

### Orsak i koden
1. **Kartan visar bara jobb med koordinater** — `ao.lat/ao.lng` sparade på arbetsordern, eller kartans egen adressökning (`Dashboard._initOpsMap`).
2. **Koordinater sparas bara när en AO skapas eller ändras i appen:** `WorkOrderService.create()`/`update()` anropar `geocodeAddressIfNeeded()` (WorkOrderService.js ~506–554). Den kräver Mapbox-token och nätverk. Det finns **ingen massgeokodning** av befintliga AO.
3. **Data som läggs in på annat sätt får aldrig koordinater:** AO-importen (`ImportWizardPage`) skapar AO direkt i `state.workOrders` utan `WorkOrderService.create()` och har bara fältet Adress (inget postnummer/ort i `ImportExportConfigs`). Detsamma gäller data som lagts in direkt i databasen (QA-LOAD).
4. **Postnummer/ort krävs:** `AddressService.resolveWorkOrderQuery()` ger "ortskontext" bara om AO:n har `zip`/`city`, eller om AO:ns gata exakt matchar den kopplade fastighetens/kundens gata. Annars returnerar `geocodeTrusted()` null **utan att fråga Mapbox** (medvetet: hellre ingen nål än nål i fel stad).
5. **Varför `geocodedAddress` finns utan lat/lng (de 28):** `geocodeAddressIfNeeded()` sparar `geocodedAddress = query` och `lat/lng = null` när försöket gav null — oavsett om orsaken var saknad ortskontext, ingen träff, saknad token eller ett nätverks-/tokenfel. `AddressService.search()` fångar alla fel (även HTTP 401/403) och returnerar `[]`, så ett fel ser ut som "ingen träff". `geocodedAddress` betyder alltså "försökt", inte "lyckats".
6. **Kartans egen geokodning** (`MAX_LOOKUPS = 20`): högst 20 nya sökningar per rendering, bara adresser med ortskontext, resultatet bara i minnet (`_geoCache`, nollställs vid omladdning). Tidigare räknades sökfel ihop med "kunde inte placeras".
7. **Trolig orsak till att även sökningarna misslyckas i STAGING (härledd, inte verifierad):** `config.js` säger att token begränsas till `https://crm.viftfast.se`. Då svarar Mapbox 401/403 från STAGING-domänen — både adressökningen och kartbakgrunden. Det går inte att kontrollera härifrån (api.mapbox.com är blockerat). Med den nya widgeten syns det direkt: "geokodning misslyckades" + för admin "Kartnyckeln nekas för den här domänen".

### Vad widgeten gör nu (bara presentation — ingen ny geokodning, ingen skrivning)
Orsakerna redovisas **var för sig, med antal**, och inga tal döljs:

| Typ | Visas som | När |
|---|---|---|
| Kartfel | **"Kartan kunde inte laddas"** i kartytan | bara när Mapbox GL inte laddas |
| Kartfel | "Kartan är inte konfigurerad" / "Kartan kunde inte visas" | token saknas / JS-fel vid ritning |
| Kartfel | rad ovanpå kartan: "Kartbakgrunden kunde inte laddas" (admin: "… kartnyckeln nekas för den här domänen") | GL laddat men kartbakgrunden nekas (401/403) eller fallerar före laddning — markörerna står kvar |
| Geokodning saknas | **N inte geokodade ännu** | adress med postnummer/ort, inga koordinater; inte sökt (max 20 per visning) |
| Geokodning saknas | **N geokodning misslyckades** (+ admin: "Kartnyckeln nekas för den här domänen (Mapbox svarar 401/403)") | sökningen gav 401/403 eller nätverksfel; inga nya sökningar på 5 min (inget hamrande) |
| Adressen behöver kompletteras | **N adress saknar ort/postnummer** · **N saknar adress** · **N adressen hittades inte** | ingen ortskontext / ingen adress alls / sökningen gav ingen träff |

- **Räknaren** ovanför kartan: `205 aktiva jobb · 0 med koordinater · 205 saknar koordinater` (synkront, utan nätverk); efter kartritning `… · 40 platser på kartan · 14 saknar koordinater`.
- **Sammanfattning** under kartan: "205 av 205 aktiva jobb visas inte på kartan", raderna "Geokodning saknas: …" och "Adressen behöver kompletteras: …" med antal, och **Visa vilka**: grupperad lista med förklaring, AO-titel, adress och orsak per rad; varje rad öppnar arbetsordern.
- **Tomläge** när kartan fungerar men inget jobb kan placeras: "Inga av de 205 aktiva jobben har koordinater" + "190 inte geokodade ännu · 1 adress saknar ort/postnummer · 14 saknar adress. Adresserna behöver geokodas." + **Visa jobb utan plats (205)**.
- Fel och "ingen träff" skiljs åt utan att ändra `AddressService`: kartan anropar `AddressService._fetchMapbox()` direkt (den kastar `Mapbox HTTP 403`), med samma beslut som `geocodeTrusted()` (ingen sökning utan ortskontext, första träffen). `AddressService.search()` och övriga anropare är oförändrade.
- Koordinater sparade som text (`"57.70"`) godtas; ogiltiga värden och 0,0 ignoreras. Listan bredvid kartan visar högst 25 jobb + "Visa alla N aktiva jobb". Karta och lista läggs sida vid sida efter widgetens bredd (container query).

**Vilket läge gäller var:**
- **Testmiljön (harnessen):** api.mapbox.com blockeras med route-abort → Mapbox GL laddas inte → "Kartan kunde inte laddas" + 10 av 10 seed-jobb utan koordinater (4 inte geokodade ännu, 6 adress saknar ort/postnummer). Testerna simulerar dessutom med route-stubbar: GL laddat + geokodning 403, GL laddat + träffar (över 20 jobb), kartbakgrund nekad.
- **Riktig STAGING (förväntat, ej verifierat av mig):** GL laddas (skriptet hämtas utan token) → inget "Kartan kunde inte laddas". Om token nekas för domänen: 1 (ev. några) "geokodning misslyckades" + admintexten, resten "inte geokodade ännu", plus 1 adress saknar ort/postnummer och 14 saknar adress; kartbakgrunden visar raden ovanpå kartan. Om token fungerar: upp till 20 placeras per visning, resten "inte geokodade ännu". Koordinatorn kontrollerar riktig STAGING vid integrationen.

**Ingen "Geokoda adresser"-knapp och ingen massgeokodning:** det finns ingen befintlig, säker massfunktion. `geocodeAddressIfNeeded()` finns per AO men skriver en serveruppdatering per arbetsorder; att köra den för 205 AO från dashboarden vore en ny serverskrivväg (se §6).

---

## 4. Skärmbilder

`docs/qa-2026-11-26/fore-efter/dashboard/` (deviceScaleFactor 1, admin, simulerad server; Mapbox blockerat i harnessen):

| Före | Efter | Innehåll |
|---|---|---|
| `fore-dash-1366.png`, `fore-dash-1366-hel.png` | `efter-dash-1366.png`, `efter-dash-1366-hel.png` | dashboard 1366 (fönster / hela sidan) |
| `fore-dash-390.png`, `fore-dash-390-hel.png` | `efter-dash-390.png`, `efter-dash-390-hel.png` | dashboard 390 |
| `fore-anpassa-1366.png`, `fore-anpassa-1366-hel.png` | `efter-anpassa-1366.png`, `efter-anpassa-1366-hel.png` | Anpassa-läget 1366 |
| `fore-anpassa-390.png`, `fore-anpassa-390-hel.png` | `efter-anpassa-390.png`, `efter-anpassa-390-hel.png` | Anpassa-läget 390 |
| — | `efter-anpassa-dolda-1366.png`, `efter-anpassa-dolda-390.png` | Dolda widgets |
| — | `efter-karta-blockerad-1366.png`, `efter-karta-blockerad-390.png` | kartan när Mapbox GL inte laddas (harnessens läge) |
| — | `efter-karta-utan-plats-lista-1366.png`, `efter-karta-utan-plats-lista-390.png` | "Visa vilka": jobb utan plats per orsak |
| — | `efter-karta-geokodning-403-1366.png`, `efter-karta-geokodning-403-390.png` | GL laddat (route-stubbe), geokodningen svarar 403: tomläge + admintext |

---

## 5. Tester

**Nya (`tests/e2e/specs/25_dashboard.js`):**

| Id | Vad |
|---|---|
| DASH-E-01 | Separat läge: verktygsrad (Spara primär/Avbryt/Återställ), sticky vid rullning, Flytta/Dölj på varje widget, storleksnamn och exakt ett valt, karta utan "Liten", Dolda widgets med beskrivning; dölj + storlek + pil upp ger "Osparade ändringar", inget i localStorage, fokus och aria-live; **Avbryt återställer exakt** |
| DASH-E-02 | **Dra och släpp** (riktiga musrörelser, HTML5 DnD) med synlig släppmarkering, "lägg sist"-ytan, storlek Liten, Spara → **samma ordning och storlek efter omladdning** |
| DASH-E-03 | **Dölj + Visa** dold widget (hamnar sist, fokus), Spara; **Återställ standard**: bekräftelse, "Behåll nuvarande" ändrar inget, bekräftat = bara utkast (ej sparat), Spara tar bort personlig layout och sektionsrubrikerna kommer tillbaka |
| DASH-E-04 | **Två användare** i samma webbläsare: admins layout påverkar inte arbetsledarens och tvärtom; ett osparat utkast följer inte med vid användarbyte; **annan enhet** = standard |
| DASH-E-05 | **Bakåtkompatibilitet**: v1-layout (size-strängar + okänd widget) visas rätt, ¾ visas som vald "Bred" och bevaras vid Spara, v1-nyckeln orörd, kvar efter omladdning |
| DASH-E-06 | **Mobil 390**: Flytta upp/ned med tryck, inget handtag/storleksval, tryckytor ≥ 40 px, inget överspill, sparad ordning gäller |
| DASH-E-07 | **Inget sidledes överspill** eller knappar utanför skärmen/avklippt text: dashboard, "jobb utan plats"-listan och Anpassa vid **360/390/768/1024/1366/1920** |
| DASH-E-08 | **Kartfel skiljs från geokodning/adress** (route-stubbar, ingen riktig Mapbox-trafik): (A) Mapbox blockerat → "Kartan kunde inte laddas" + alla tal, orsakerna summerar till alla jobb, "Visa vilka" grupperar och öppnar AO; (B) GL laddat, geokodning 403 → inget "Kartan kunde inte laddas", tomläget räknar upp "inte geokodade ännu · geokodning misslyckades · adress saknar ort/postnummer", högst 1–2 sökningar (inget hamrande), admintext "Kartnyckeln nekas för den här domänen"; (C) kartbakgrunden nekas → rad ovanpå kartan, jobb med sparade koordinater har markör |
| DASH-E-10 | **Geokodning med träffar**: 41 extra jobb utan koordinater → högst 20 sökningar per visning, resten "inte geokodade ännu"; "adressen hittades inte", "adress saknar ort/postnummer", "saknar adress" var för sig; koordinater som text placeras; placerade + saknade = alla |
| DASH-E-11 | **Realistiskt innehåll** (se §2) vid 390/1366 + tomlägen för begränsad roll |
| DASH-E-09 | Försenade aktiviteter (antal, "5 dagar sen", Visa försenade → Aktiviteter), Arbetspool (akut först, väntetid), Kräver åtgärd utan dubblerad rubrik, rader som knappar (Enter öppnar), brådskande före kartan, högst en "Visa alla" per widget |

**Körda (simulerad server, 2026-11-26):**

| Körning | Resultat |
|---|---|
| `node tests/e2e/run.js --grep "^(DASH\|MAP-01\|RENDER-01\|XSS-01\|BRAND-01\|VAT-01)"` (DASH-01, DASH-M-01, DASH-E-01…11, MAP-01, RENDER-01, XSS-01, BRAND-01, VAT-01) | **18 godkända, 0 misslyckade** |
| Hela sviten `node tests/e2e/run.js` på slutlig kod | **130 godkända, 0 misslyckade, 1 blockerad (PERM-03), 1 känt fel (AO-07)** av 132 |
| `bash tests/run-all.sh` | **15/19 gröna, 0 misslyckade**, 4 överhoppade (ingen lokal PostgreSQL — inte godkända, inte körda) |

Befintliga dashboardtester (DASH-01, DASH-M-01, MAP-01) är **oförändrade** och gröna — inga selektorer behövde ändras. DASH-E-02 behövde i testet en extra liten musrörelse efter släppmålet (Chromium skickar `dragover` först vid nästa rörelse) och att släppytan rullas till mitten av fönstret (nära kanten autorullar webbläsaren under dragning) — inget i appen ändrades för det.

---

## 6. Inte gjort / kräver beslut

1. **Massgeokodning av befintliga AO** (205 aktiva i STAGING): behövs för att kartan ska bli användbar. Förslag: ett admin-verktyg som går igenom AO utan koordinater med postnummer/ort, med hastighetsbegränsning och en serverskrivning per AO (befintlig `geocodeAddressIfNeeded`), körs först i STAGING. Kräver beslut — inte gjort.
2. **AO-importen** bör få fälten Postnummer/Ort och gå via samma adress-snapshot som `WorkOrderService.create()` (`AddressService.resolveCreateAddressSnapshot`) — annars får importerade AO aldrig koordinater. Ägs av import-/AO-blocket.
3. **`AddressService.search()` sväljer fel** och `geocodeAddressIfNeeded()` sparar `geocodedAddress` även när försöket misslyckades — ett token-/nätverksfel ser ut som "ingen träff". Dashboarden skiljer dem utan att ändra AddressService (anropar `_fetchMapbox` direkt, som kastar `Mapbox HTTP <status>`). Föreslagen liten ändring utanför mina filer: en `lastError`/separat metod i AddressService, och att `geocodeAddressIfNeeded()` inte sparar `geocodedAddress` vid fel (då försöker nästa ändring igen och felet syns).
4. **Ingen massgeokodning har startats** mot STAGING eller någon annan miljö. Inget i denna ändring skriver koordinater.
5. **Mapbox-tokenens domänbegränsning** bör kontrolleras för STAGING-domänen (eller en egen STAGING-token).
6. Synk av dashboardlayout mellan enheter (serverlagrad inställning) — produktbeslut.
7. Övriga widgetar (Rondering, Säljchanser, Offerter, Öppna per kategori, Aktiviteter) har fått gemensam rubrikrad men innehållet har kvar en del inline-stil från tidigare omgångar.
