# Arbetspool, tilldelning och planering: utredning

**Version 2, 2026-11-27.** Uppdaterad efter de fastställda besluten D-24 och AP-A–AP-G (`docs/qa-2026-11-27/BESLUT-2026-11-27.md`, som är auktoritativ) och efter serverinventeringen av STAGING 2026-11-26.

Underlaget bygger bara på läsning av kod. Ingen kod, ingen data och ingen server har ändrats. Inga nätverksanrop är gjorda.

**Källor.** Förkortningen `INV/` betyder `/home/user/vift-v2/supabase/inventering/staging-2026-11-26/`. Det är den installerade källan i STAGING och gäller före repokopiorna.

| Källa | Sökväg |
|---|---|
| Installerade Edge Functions | `INV/functions/<namn>/<namn>/index.ts` och `INV/functions/<namn>/_shared/vift-auth.ts` |
| Installerade SQL-funktioner | `INV/schema/functions.sql` |
| Klient (STAGING v3.4) | `/home/user/VIFT-CRM`, gren `claude/vift-v3-major-redesign` |
| Simulerad server | `/home/user/VIFT-CRM/tests/e2e/fake-backend.js` |

**Rättat sedan version 1.** Antagandena om `work_order_patch` är nu verifierade (avsnitt 3.3). Den installerade `ao-time-write` är version 5 och har samma logik som repokopian men andra radnummer; nedan anges installerade rader. `work-orders-list` har samma regel i installerad version och i repot.

---

## 0. Kort svar

1. **Det rapporterade felet (AP-FEL-1):** rutan "Flytta till arbetspool" är redan ikryssad när ordern har status `pool`, och då tömmer sparningen personal och ansvarig (`WorkOrderDetailPage.js:3167`, `:3196`, `:3223`; `WorkOrderService.js:1322-1326`). Notiser och historikposten "Personal tilldelad" skickas ändå (`WorkOrderDetailPage.js:3233-3249`).
2. **Läckan (SÄK-3) är verifierad i installerad källa.** `work-orders-list` lämnar ut varje AO med `status === 'pool'` till alla med `ao_view_own` (`INV/functions/work-orders-list/work-orders-list/index.ts:71`). Det gäller även tilldelade, arkiverade och borttagna AO.
3. **Utlämningen kan rättas utan att breddas.** Den nya regeln är strikt snävare än dagens för varje AO och användare (bevis i avsnitt 5.4). Ingen historisk AO behöver skrivas om.
4. **Öppen pool ger i dag skrivrätt.** Utan tilldelning kan man skriva material, ladda upp och radera bilder, ändra checklista och skriva i AO-loggen. Tidposter och stämpling kontrolleras inte alls mot AO:n. Därtill kan den som har `ao_complete` klarmarkera vilken AO som helst (SÄK-5). Se avsnitt 8.
5. **"Ta jobbet" (SÄK-4) måste flyttas in i en RPC med radlås.** `work_order_patch` jämför `expectedUpdatedAt` under låset (`INV/schema/functions.sql:4806`, `:4831-4833`). Klientens lokala `updatedAt` stämmer dock aldrig med serverns värde, så `expectedUpdatedAt` från klienten räcker inte (avsnitt 3.3). En egen `work_order_pool_take` med kontrollen under `FOR UPDATE` ger exakt en vinnare.

---

## 1. Nuläge

### 1.1 Fält och statusmodell

| Fält | Källa | Betydelse i dag |
|---|---|---|
| `status` | `src/data/schema.js:184` (`nytt \| pool \| planerad \| pågående \| klar \| fakturerad \| avbruten`) | Blandar arbetsläge, "släppt till poolen" och "har datum". `pool` är ett statusvärde. Något separat poolfält finns inte. |
| `staff[]`, `responsibleStaffId` | `schema.js:192` | Tilldelning. |
| `scheduledDate`, `scheduledStart`, `scheduledEnd` | `schema.js:193-195` | Används både som utförandedatum och som förfallodatum (avsnitt 1.4). |
| `log[]`, `updatedAt` | | Historik och versionsfält. |

AO har inget fält för förfallodatum. `dueDate` finns bara på fakturor och uppgifter (`schema.js:305`, `:480`).

### 1.2 Var kombinationerna uppstår

| Väg | Kod | Personal | Datum |
|---|---|---|---|
| Ny AO-guide, "Arbetspool" | `WorkOrdersPage.js:2252` (status `pool`, datum rensas). Personal kan väljas i båda lägena (`:1728-1736`, sparas `:2497`). | Kan vara satt | Tomt |
| Serviceintervall, klient | `ServiceIntervalService.js:564-576`: `status:'pool'`, `staff: si.aoStaff`, `scheduledDate: si.nextDue`. Ingen `source`-markering. | Kan vara satt | Förfallodag |
| Serviceintervall, server (cron) | `INV/functions/service-monitor/service-monitor/index.ts:483-493`: samma fält, plus `source:'service_interval'` och `sourceIntervalId` | Kan vara satt | Förfallodag |
| Återkommande | `RecurringOrderService.js:121-122`, `:130`: `staff: ro.staff`, `scheduledDate: ro.nextDate \|\| tdy()`, `recurringOrderId`. Status saknas, så standardvärdet `nytt` gäller. | Kan vara satt | Tillfällets datum |
| "Till pool", statusbyte, massändring av status | `WorkOrderDetailPage.js:469-470`, `:2449-2459`; `WorkOrdersPage.js:2785-2787`. Bara status ändras. | Behålls | Behålls |
| Personaldialogen med poolrutan ikryssad | `WorkOrderService.js:1322-1326` | Rensas | Behålls |
| Planering av en pool-AO | `WorkOrderDetailPage.js:316`, `:663-697`. Status förblir `pool`. | Behålls | Sätts |
| "Ta jobbet" | `WorkOrderService.js:1350-1374` (`pool` blir `planerad`) | Anroparen läggs till | Behålls |
| Tilldelning i dialogen eller via massändring | `WorkOrderService.js:1333`; `WorkOrdersPage.js:2939` (`pool` blir `planerad`) | Sätts | Behålls |
| "Planera"-knappen | `WorkOrderDetailPage.js:467-468` (`planerad` utan datum) | Behålls | Behålls |
| Import | `ImportExportConfigs.js:588` tar emot alla statusar | Godtyckligt | Godtyckligt |
| Server, `work_order_create` | `INV/schema/functions.sql:4596-4689`. Klientens AO slås ihop i sin helhet (`:4668`) utan kontroll av status eller personal. | Godtyckligt | Godtyckligt |

Datum kan inte tas bort i dag, eftersom "Omplanera" kräver ett datum (`WorkOrderDetailPage.js:689`).

### 1.3 Orsaken till AP-FEL-1

Se kort svar punkt 1. Därutöver gäller:

- `added` räknas från de valda id:na, inte från resultatet (`WorkOrderDetailPage.js:3233`). Därför loggas `staff_assigned` (`:3236`), och in-app-notis (`:3240`) och push (`:3248`) skickas även när personalen rensats.
- Poolflytten loggar inte vilka som togs bort (`WorkOrderService.js:1326`).
- Ingen konfliktkontroll görs (`:1345` anropar `_syncAO` utan `expectedUpdatedAt`).

### 1.4 Blandar `scheduledDate` utförandedatum och förfallodatum?

**Ja.**

- **Serviceintervall** skriver förfallodagen (`si.nextDue`) i `scheduledDate`, i klienten (`ServiceIntervalService.js:575`) och i cron (`service-monitor/index.ts` i `buildWorkOrder`, fältet `scheduledDate: si.nextDue`). Intervallets egen terminologi är "förfaller" (`ServiceIntervalService.js:130-143`, `:485-495`). AO:n får status `pool`, och just därför visar kalendern den inte som bokad och `isOverdue` räknar den inte som försenad (`CalendarPage.js:340`, `WorkOrderService.js:918`). Systemet behandlar alltså redan i dag `scheduledDate` på en pool-AO som "inte bokat".
- **Återkommande** skriver tillfällets datum i `scheduledDate` med status `nytt`. Kalendern visar det som bokat. Datumet används också för att undvika dubbletter av samma tillfälle (`RecurringOrderService.js:80`). Om det är ett utförandedatum eller ett förfallodatum framgår inte av koden (se öppen fråga Q2).
- Klientskapade AO från serviceintervall saknar markering. Bara cron-vägen sätter `source:'service_interval'`.

---

## 2. Servern: utlämning till fältanvändare i dag

| Ställe | Installerad källa | Regel |
|---|---|---|
| `work-orders-list` | `INV/functions/work-orders-list/work-orders-list/index.ts:59-71` | `ao_view_all`/`all`: allt. `ao_view_own`: `staff.includes(me) \|\| ao.status === 'pool'`. Ingen kontroll av `deleted` eller `archived`. |
| `canViewWorkOrder` | `INV/functions/ao-time-write/_shared/vift-auth.ts:32-38`, samma i bild-funktionerna | Samma regel. |
| `work_order_checklist_set_state`, som anropas av `work_order_checklist_resolve` och `work-order-checklist-resolve` | `INV/schema/functions.sql:4457` | `staff ? me` eller `status = 'pool'`, under `FOR UPDATE` (`:4442`). |
| `work_order_log_append` och `work_order_log_remove` | `functions.sql:4714`, `:4755` | Samma regel, under `FOR UPDATE` (`:4708`, `:4749`). |
| Fake-backend `canViewAO` | `fake-backend.js:122-127`, används på `:234`, `:424`, `:438`, `:597`, `:659`, `:682`, `:692`, `:701` | Samma regel. |

**Svar:** ja. Andras tilldelade-men-oplanerade AO med status `pool` lämnas ut till alla fältanvändare, liksom arkiverade och borttagna AO med status `pool`.

---

## 3. "Ta jobbet", statusövergångar och samtidighet

### 3.1 Installerad gren (`INV/functions/ao-time-write/ao-time-write/index.ts`)

- `patch_ao` kräver `ao_edit`, `ao_complete`, `ao_material` eller `all` (`:97`). Utan `ao_edit` och `ao_complete` tillåts bara ren materialpatch (`:121`).
- **Gren A, "Starta"** (`:131-134`): bara `{status:'pågående'}`. Anroparen måste finnas i `staff`, och status måste vara `nytt`, `planerad` eller `pool`.
- **Gren B, "Ta jobbet"** (`:135-151`): ny `staff` = befintlig + anroparen (`:137`). Status måste vara `pool` och `canViewWorkOrder` gälla (`:149-150`). **Kontroll av att `staff` är tom saknas.** Grenen kräver `ao_complete`, eftersom `:121` stoppar alla andra.
- **Endast `ao_complete`** (`:153-160`): fälten `status:'klar'`, `completedAt`, `completedBy` och `updatedAt` tillåts **utan kontroll av synlighet, tilldelning eller status**. Det är SÄK-5.
- **`ao_edit` och `all`**: ingen fältbegränsning. Hela patchen går till `work_order_patch` (`:162-165`).

### 3.2 Läsning utanför låset

Gren B och materialgrenen läser `vift_workOrders` med en vanlig `select` (`:113`, `:124`), innan RPC:n tar sitt lås. Behörighetsbeslutet fattas alltså på en ögonblicksbild som kan ha ändrats när skrivningen sker.

### 3.3 `work_order_patch`, verifierat (`INV/schema/functions.sql:4779-4849`)

- Raden låses med `SELECT … FOR UPDATE` (`:4806`).
- `p_expected_updated_at` jämförs med AO:ns lagrade `updatedAt` under låset och ger `stale_write` (`:4831-4833`).
- Sammanslagningen är grund: `v_ao || p_patch` (`:4835`). `staff` och `log` ersätts därför i sin helhet.
- Servern sätter alltid ett eget `updatedAt` (`:4835`).

**Följd för samtidig tagning.** Klienten skickar inget `expectedUpdatedAt` från `takeFromPool` (`WorkOrderService.js:1369` → `_syncAO` `:132-134`). Två fältanvändare kan då båda passera kontrollen i `:149-150` med samma ögonblicksbild. Den andra skrivningen ersätter den förstas `staff` och `log`.

**Följd för `expectedUpdatedAt` i klienten.** Klienten sätter sitt eget lokala `updatedAt` (`WorkOrderService.js:638`, `:1359`, `:458`) och tar aldrig över serverns värde efter bekräftelse; `AOTimeSyncService` läser inte `workOrder.updatedAt` ur svaret. Ett `expectedUpdatedAt` hämtat från klientens lokala objekt ger därför falsk `stale_write` efter varje egen ändring, tills nästa avläsning från `work-orders-list`. **Tagning och tilldelning ska därför avgöras under radlåset, inte genom `expectedUpdatedAt` från klienten.**

### 3.4 Övriga verifierade fakta

- `work_order_checklist_set_state` startar inte AO:n automatiskt (ingen statusändring i `functions.sql:4404-4594`). Fake-backend gör det (`fake-backend.js:611`). Det är en avvikelse i den simulerade servern.
- Fake-backendens `patch_ao` (`:421-427`) saknar fältbegränsningen i `ao-time-write`: vem som helst med någon AO-behörighet som ser AO:n kan patcha vad som helst. Kommentaren "källan saknas i repot" (`:395`) är inaktuell.

---

## 4. Klienten i dag

Oförändrat från version 1. Kortfattat:

- **Mina jobb:** fliken Arbetspool visar `status === 'pool'` oavsett personal (`MyJobsPage.js:56`). Det ger dubbletter för egna pool-AO och knappen "Ta jobbet" för andras. Beskedet visas före serverns svar (`:527-533`).
- **AO-lista:** statusfliken "Pool" (`WorkOrdersPage.js:253-256`). Snabbfiltret "Otilldelade" är `!staff.length` och tar därmed med pool och avslutade i fliken "Aktiva" (`:182`, `:599-600`, `:853`).
- **Kalender:** pool-AO visas bara i rutan "ej schemalagda" (`CalendarPage.js:160`, `:293-296`, `:340`). Tilldelade AO utan datum med annan status än `pool` syns inte alls.
- **Dashboard och Dagens drift:** "Otilldelade" utesluter pool (`Dashboard.js:289`, `:1166`; `OperationsPage.js:48`; `Sidebar.js:341`). AO-listan, dit de länkar, tar med pool.
- **AO-detalj:** `nextStep` säger "väntar på att någon tar uppdraget" även när personal finns (`WorkOrderService.js:938`).

Avsnitt 6 har den fullständiga räknarlistan.

---

## 5. Gemensam kategoridefinition (AP-A, AP-G, D-24)

### 5.1 Grundbegrepp (härledda, inget skrivs om)

```
avslutad(ao)       = ao.deleted || ao.archived || status ∈ {klar, fakturerad, avbruten}
ejPåbörjad(ao)     = status ∈ {nytt, pool, planerad}
harPersonal(ao)    = (staff ?? []).length > 0

tillgängliggjord(ao) = status == 'pool' && ao.poolOpen !== false
      -- Status `pool` ÄR i dag den uttryckliga markeringen "släppt till poolen".
      -- `poolOpen` är ett NYTT valfritt fält. Det sätts bara av nya skrivningar
      -- (false vid tilldelning, true vid "Släpp till öppen pool"). Saknas fältet
      -- gäller dagens tolkning.

utförandedatum(ao) = status == 'pool' ? '' : (scheduledDate || '')
      -- På en pool-AO har scheduledDate aldrig betytt en bokning
      -- (CalendarPage.js:340, WorkOrderService.js:918).
förfallodatum(ao)  = ao.dueDate || (status == 'pool' ? scheduledDate : '') || ''
      -- `dueDate` är ett NYTT fält för serviceintervall och, enligt fråga Q2,
      -- återkommande ärenden.
```

### 5.2 Kategorier

Kategorierna är ömsesidigt uteslutande och prövas i ordning.

| # | Kategori | Villkor | Var den visas |
|---|---|---|---|
| 1 | **Avslutade** | `avslutad(ao)` (arkiv och papperskorg är egna lägen inom kategorin) | Statusflikarna Klar, Fakturerad, Arkiv, Papperskorg |
| 2 | **Öppen pool** | `!avslutad && tillgängliggjord && !harPersonal` | Mina jobb, fliken "Öppen pool" (vid `ao_pool_take`). Arbetsledarens poolvy. Kalenderns ruta "Öppen pool". Ett eventuellt förfallodatum visas som "Förfaller …". |
| 3 | **Planerad** | `!avslutad && ejPåbörjad && utförandedatum != ''` (med eller utan personal) | Kalenderns dag, Idag, Kommande, Försenade, Dagens drift |
| 4 | **Tilldelad pool** | `!avslutad && ejPåbörjad && harPersonal && utförandedatum == ''` | Mina jobb, "Tilldelade utan datum" för de tilldelade. Arbetsledarens vy "Tilldelade, oplanerade". Kalenderns ruta "Tilldelade, oplanerade". Ett eventuellt förfallodatum visas. |
| 5 | **Övriga aktiva** | Allt annat som inte är avslutat: `pågående`, okända statusvärden, samt ej påbörjade utan personal och utan utförandedatum som inte är tillgängliggjorda. Den sista gruppen är t.ex. en ny AO med status `nytt`, eller en pool-AO med `poolOpen === false`. | AO-listan. För arbetsledare markerade "Otilldelad, ej i pool" när personal saknas. |

Följder:

- En ny AO utan personal och datum med status `nytt` hamnar i kategori 5. Den exponeras alltså **inte** automatiskt, enligt AP-A.
- Att tilldela personal ändrar aldrig `utförandedatum`, och att ta bort datum ändrar aldrig `staff`. Dimensionerna är separata, enligt D-24.

### 5.3 Klassning av alla befintliga kombinationer

Inga poster skrivs om. Kolumnen "Fält ser i dag" gäller en fältanvändare (`ao_view_own`) som **inte** är tilldelad. Den tilldelade ser sina egna AO i alla rader, både i dag och efter rättningen.

| # | Status | Personal | `scheduledDate` | `deleted`/`archived` | Kategori | Fält ser i dag | Fält ser efter |
|---|---|---|---|---|---|---|---|
| 1 | nytt | – | – | nej | Övriga aktiva (otilldelad, ej i pool) | Nej | Nej |
| 2 | nytt | – | ✓ | nej | Planerad, otilldelad | Nej | Nej |
| 3 | nytt | ✓ | – | nej | Tilldelad pool | Nej | Nej |
| 4 | nytt | ✓ | ✓ | nej | Planerad | Nej | Nej |
| 5 | pool | – | – | nej | **Öppen pool** | Ja | Ja, med `ao_pool_take` (5.5) |
| 6 | pool | – | ✓ (förfallodag, t.ex. serviceintervall) | nej | **Öppen pool** med förfallodatum | Ja | Ja, med `ao_pool_take` |
| 7 | pool | ✓ | – | nej | **Tilldelad pool** | **Ja (läcka)** | **Nej** |
| 8 | pool | ✓ | ✓ (förfallodag) | nej | **Tilldelad pool** med förfallodatum | **Ja (läcka)** | **Nej** |
| 9 | planerad | – | – | nej | Övriga aktiva (otilldelad, ej i pool) | Nej | Nej |
| 10 | planerad | – | ✓ | nej | Planerad, otilldelad | Nej | Nej |
| 11 | planerad | ✓ | – | nej | Tilldelad pool | Nej | Nej |
| 12 | planerad | ✓ | ✓ | nej | Planerad | Nej | Nej |
| 13 | pågående | alla | alla | nej | Övriga aktiva | Nej | Nej |
| 14 | klar, fakturerad, avbruten | alla | alla | nej | Avslutade | Nej | Nej |
| 15 | pool | alla | alla | **ja** | Avslutade (arkiv/papperskorg) | **Ja (läcka)** | **Nej** |
| 16 | övriga statusar | alla | alla | ja | Avslutade | Nej | Nej |
| 17 | okänt eller tomt statusvärde (import, äldre data) | alla | alla | nej | Övriga aktiva | Nej | Nej |
| 18 | pool, med det nya `poolOpen:false` | – | alla | nej | Övriga aktiva (otilldelad, ej i pool) | (finns inte i dag) | Nej |

Rad 6 och 8: om en pool-AO har fått datumet genom "Omplanera" och alltså var avsedd som bokning, klassas den ändå som förfallodatum. Kalendern visar den redan i dag som "ej schemalagd", så klassningen ändrar inget synligt. Om den ska ses som planerad avgörs i fråga Q1.

### 5.4 Bevis: ingen fältanvändare ser fler AO än i dag

```
I dag:  V_idag(ao, me)  = me ∈ staff  ∨  status = 'pool'
Efter:  V_efter(ao, me) = me ∈ staff  ∨  (status = 'pool' ∧ poolOpen ≠ false ∧ staff = ∅
                                          ∧ ¬deleted ∧ ¬archived ∧ har(ao_pool_take))
```

Varje led i `V_efter` medför motsvarande led i `V_idag`. Det första ledet är identiskt, och det andra innehåller `status = 'pool'` som en av sina konjunkter. Alltså gäller `V_efter ⊆ V_idag` för varje AO och varje användare. Ingen bredning är möjlig, oavsett vilka data som finns.

Det håller också över tid:

- Klassningen kräver `status = 'pool'` så länge statusvärdet finns kvar (AP-G).
- Det nya fältet `poolOpen` kan bara **ta bort** en AO ur öppen pool, aldrig lägga till.
- "Släpp till öppen pool" sätter status `pool`, alltså samma markering som i dag.

Samma begränsning ska gälla `canViewWorkOrder`, de tre SQL-funktionerna och fake-backend. Där ska poolgrenen dessutom bara ge **läsrätt** (avsnitt 8).

### 5.5 Behörighet för att se öppen pool

D-04 anger att begränsad roll som standard inte ska se öppen pool. Dagens regel ger dock alla med `ao_view_own` poolen. Eftersom behörigheter inte får hårdkodas på rollnamn knyts synligheten till behörigheten **`ao_pool_take`** (AP-F). Den som inte får ta jobb har ingen anledning att se poolen.

Följder:

- Detta snävar in synligheten ytterligare och bryter alltså inte mot 5.4.
- När regeln införs måste fältrollerna få `ao_pool_take` i samma omgång, annars förlorar fältet poolen.
- D-13 kräver att öppna pooljobb bara innehåller begränsad information. Det innebär en projektion av öppen-pool-AO för icke tilldelade, som snävar in ytterligare.

### 5.6 Nya skrivningar under övergången (AP-G)

| Åtgärd | Skrivning |
|---|---|
| Personaldialogen | Bara `staff`, `responsibleStaffId` och loggposterna `staff_added`/`staff_removed`/`staff_responsible`. Rör inte status eller datum. Om AO:n har status `pool` och personal läggs till sätts `poolOpen:false`, så att den inte återvänder till öppen pool om personalen senare tas bort. |
| "Ta bort datum" | Rensar `scheduledDate`, `scheduledStart` och `scheduledEnd`. Loggposten `schedule_removed`. Rör inte personal, ansvarig, status eller `poolOpen`. |
| "Släpp till öppen pool" (arbetsledare) | Kräver bekräftelse som namnger personalen. Tar bort personal (loggposten `staff_removed` per person) och utförandedatum. Sätter status `pool` och `poolOpen:true`. Loggposten `released_to_pool`. |
| "Ta jobbet" | Se avsnitt 9. Lägger till anroparen och sätter `poolOpen:false`. Behåller övergången `pool` → `planerad` under övergången, för kompatibilitet med v3.4-klienter som fortfarande är i bruk. Klassningen ger "tilldelad pool" oavsett. |
| Guiden "Arbetspool" | Utan personal: status `pool`, alltså öppen pool. Med personal: status `nytt`, alltså tilldelad pool, inte `pool` med personal. |
| Serviceintervall (klient och cron) | Förfallodagen skrivs till **`dueDate`**. Under övergången skrivs den också till `scheduledDate`, för gamla klienter. Status `pool` sätts bara om `aoStaff` är tom; annars `nytt`. Lägg till `source:'service_interval'` även i klientvägen. |

---

## 6. Räknare och vyer (AP-C)

**Definition:**

- "Otilldelade" = aktiva (`!avslutad`) utan personal = kategorierna 2 + 5 utan personal + "Planerad, otilldelad". Öppen pool är en delmängd.
- Om en räknare utesluter öppen pool ska etiketten säga det, t.ex. "Otilldelade (utom öppen pool)".

| Räknare eller vy | Fil:rad | Räknar i dag | Ska räkna | Etikett |
|---|---|---|---|---|
| AO-lista, snabbfilter "Otilldelade", antal | `WorkOrdersPage.js:182`, chip `:192` | `!staff` i aktuell flik, inklusive pool och, i fliken "Aktiva", även klar och avbruten | Aktiva utan personal | "Otilldelade" |
| AO-lista, filtret "Otilldelade" | `WorkOrdersPage.js:599-600` | `!staff` | Samma som ovan | – |
| AO-lista, filterpanelens antal | `WorkOrdersPage.js:853`, `:859` | `!staff` | Samma som ovan | – |
| AO-lista, statusflik "Pool" | `WorkOrdersPage.js:253-256`, antal `:171` | `status === 'pool'` | Ersätts av kategorifiltren "Öppen pool" och "Tilldelade, oplanerade". Statusfliken kan finnas kvar som en ren statusvy. | "Öppen pool" och "Tilldelade, oplanerade" |
| Dashboard, dagens tavla "Otilldelade" | `Dashboard.js:289`, ruta `:358` | Utan personal, utom pool | Aktiva utan personal, eller utan öppen pool | "Otilldelade", eller "Otilldelade (utom öppen pool)" |
| Dashboard, driftwidget "Sakn. personal" | `Dashboard.js:1166`, `:1186` | Utan personal, utom pool och avbruten | Samma val som ovan | "Otilldelade" eller "Otilldelade (utom öppen pool)" |
| Dagens drift, fokus "Otilldelade" | `OperationsPage.js:23`, `:48` | Utan personal, utom pool och avbruten. Länkar till AO-listans `unassigned`, som räknar annorlunda. | Samma definition som målet för länken | Samma etikett som AO-listan |
| Sidomenyns larmbricka för driften | `Sidebar.js:339-341` | Utan personal, utom pool | Samma som Dagens drift | – |
| Dashboard, widget "Arbetspool" | `Dashboard.js:1897`, text `:1910` | `status === 'pool'`. Texten "väntar på att tilldelas". | Öppen pool. För arbetsledare även en separat siffra för "Tilldelade, oplanerade". | "Öppen pool – väntar på att tas" |
| Dashboard, delad pool i fältets KPI, hero och "Kräver åtgärd" | `Dashboard.js:277`, `:381`, `:1203`, `:2273`, `:2314` | Egna AO plus alla med status `pool` | Egna AO plus öppen pool (vid `ao_pool_take`) | – |
| Dashboard, aktiva ordrar | `Dashboard.js:2275` | Status `nytt`, `pool`, `planerad` och `pågående` | Oförändrat (aktiva) | – |
| Mina jobb, fliken Arbetspool | `MyJobsPage.js:56`, `:102` | `status === 'pool'` | Öppen pool | "Öppen pool" |
| Mina jobb, "Tilldelade utan datum" | `MyJobsPage.js:53`, `:192` | Egna utan datum, inte pågående | Egna i tilldelad pool | Oförändrad |
| Mina jobb, "Försenade" | `MyJobsPage.js:50` | Egna med datum före idag, inklusive pool | Egna planerade med utförandedatum före idag | – |
| Kalender, poolrutor | `CalendarPage.js:160`, `:192`; agendan `:293-296`, `:317` | `status === 'pool'`, "ej schemalagda" | Två rutor: "Öppen pool" och "Tilldelade, oplanerade". Den senare följer personalfiltret. | Enligt kategori |
| Kalender, händelser per dag | `CalendarPage.js:340` | Utesluter status `pool` | `utförandedatum == dag` | – |
| Dagens drift, gruppen "pool" | `OperationsPage.js:118` | Status `pool`, "ingen har tagit jobbet" | Öppen pool | "Öppen pool" |
| Försenad | `WorkOrderService.js:918`; `OperationsPage.js:46`, `:149`; `Dashboard.js:1164`; `Sidebar.js:339` | Datum före idag, inte pool | Utförandedatum före idag. Samma resultat för befintlig data. | – |
| Förfallna (ny) | – | – | Aktiva med förfallodatum före idag och utan utförandedatum | "Förfallna, ej planerade" |
| AO-detalj, nästa steg | `WorkOrderService.js:938`, `:946-948` | Status `pool` ger "väntar på att någon tar uppdraget" | Enligt kategori. Tilldelad pool ger "Tilldelad – välj datum". | – |
| Rapporter, statusdiagram | `ReportsPage.js:392` | Status | Oförändrat. Det är statusdimensionen. | – |
| Simulerade testförväntningar | `tests/e2e/specs/33_falt_pages.js:312-314` | Som Dagens drift | Följer den nya definitionen | – |

---

## 7. Stämpling kräver tilldelning (AP-B)

**Server, alla tre ställena saknar kontroll i dag:**

| Ställe | Installerad källa | Ändring |
|---|---|---|
| Instämpling med AO | `INV/functions/store-key-write/store-key-write/stamp-status.ts:23-38`: `aoId` tas emot okontrollerat (`:33`) och skrivs av `store_write_stamp_status` (`functions.sql:3642-3714`) | Om `active && aoId`: kräv att AO:n finns, inte är avslutad och har anroparen i `staff`. Annars `forbidden` med orsaken `not_assigned`. Instämpling utan AO ("Utan arbetsorder") fungerar som i dag. |
| `create_time` (stämpla ut, registrera tid) | `INV/functions/ao-time-write/ao-time-write/index.ts:188-224` (ingen kontroll av `aoId`); `time_entry_create`, `functions.sql:3789-3809`, lägger tidpostens id i **vilken AO som helst** | Kontrollen görs i `time_entry_create` under AO-låset (`FOR UPDATE`, `:3795`). En post för egen räkning med `aoId` kräver att anroparen finns i AO:ns `staff`, att AO:n inte är avslutad och att den inte är fakturerad. Registrering åt annan (`payroll_manage`) undantas. Fel: `not_assigned`, ingen mutation. |
| `patch_time` | `ao-time-write/index.ts:226-242` | Om patchen byter `aoId` gäller samma kontroll för den nya AO:n. |

**Klient:**

- Instämplingslistan visar i dag alla AO med status `pool`, `nytt`, `planerad` och `pågående` (`TimePage.js:173`). Den ska bara visa egna tilldelade.
- Stämpelknappen i AO-detaljen (`WorkOrderDetailPage.js:190`, `:373`) och "Registrera tid" (`:262`, `:1618`) ska bara visas när anroparen är tilldelad, eller har `payroll_manage` för registrering åt andra.
- Mina jobb visar redan bara stämpling på egna jobbkort (`MyJobsPage.js:293`). Poolkorten saknar stämpling (`:347`) och ska fortsatt göra det.
- Ingen automatisk tagning vid stämpling (AP-B).

---

## 8. Öppen pool ger ingen skrivrätt

Alla ställen där poolregeln eller `canViewWorkOrder` i dag ger **skrivrätt** utan tilldelning:

| Ställe | Installerad källa | Ger i dag | Ändring |
|---|---|---|---|
| `ao-time-write`, materialgrenen | `ao-time-write/index.ts:108-120`; synlighet `:117` | Ersätter hela materiallistan på öppen pool-AO | Kräv `me ∈ staff` (eller `ao_view_all` + `ao_edit`). Radvisa operationer enligt D-19 i en senare etapp. |
| `ao-time-write`, gren B (ta) | `:135-151`, `:150` | Tagning även när personal finns | Ersätts av `work_order_pool_take` (avsnitt 9). |
| `ao-time-write`, endast `ao_complete` | `:153-160` | Klarmarkering av **vilken AO som helst**, även fakturerad (SÄK-5) | `ao_complete_own`: `me ∈ staff`, status `pågående` (eller enligt D-03), inte fakturerad, avbruten, arkiverad eller borttagen. Kontrolleras under lås, med en smal RPC eller kontrollen i en `work_order_patch`-variant. |
| `work-order-image-upload` | `INV/functions/work-order-image-upload/work-order-image-upload/index.ts:83`, `:96`, `:107`, `:137` | Uppladdning till AO:ns lagringsyta | Kräv `me ∈ staff` (eller `ao_view_all`). |
| `work-order-image-delete` | `INV/functions/work-order-image-delete/work-order-image-delete/index.ts:78`, `:83`, `:90`, `:94` | Radering av bilder på öppen pool-AO | Kräv `me ∈ staff`. Radering av andras bilder kräver `ao_edit`. |
| `work_order_checklist_set_state`, via `work-order-checklist-resolve` (`…/index.ts:81`, `:137`) | `functions.sql:4457` | Bocka av, markera avvikelse, återställa | Byt villkoret till `staff ? me`, under det befintliga låset (`:4442`). Poolgrenen tas bort för skrivning. |
| `work_order_log_append` | `functions.sql:4714`; EF `INV/functions/work-order-log-write/work-order-log-write/index.ts:58`, `:74` | Loggposter, anteckningar och bildreferenser | Samma ändring. |
| `work_order_log_remove` | `functions.sql:4755`; EF `:78` | Borttagning av egna loggposter | Samma ändring. |
| `create_time` och `time_entry_create` | Avsnitt 7 | Tid på vilken AO som helst | Avsnitt 7. |
| Stämpling | Avsnitt 7 | Instämpling på vilken AO som helst | Avsnitt 7. |
| Fake-backend | `fake-backend.js:424` (`patch_ao`), `:438` (logg), `:597` och `:611` (checklista, startar dessutom AO:n), `:659` (`logWrite`), `:682` (bilduppladdning), `:701` (bildradering) | Samma som servern, och `patch_ao` utan fältbegränsning | Spegla installerad källa: separera `canViewAO` (läsning) från `isAssigned` (skrivning), lägg in ao-time-writes fältregler och `work_order_pool_take`, ta bort autostarten i checklistan. |

**Läsning** på öppen pool-AO (`work-orders-list`, `work-order-image-url` `INV/…/work-order-image-url/index.ts:93`) är tillåten, men begränsad enligt D-13 (projektion i en senare etapp).

Gemensam hjälpfunktion: `canWriteWorkOrderContent(ao, perms, me) = hasPerm('all') || (hasPerm('ao_view_all') && <skrivbehörighet>) || me ∈ staff`. I SQL ska motsvarande kontroll ligga under radlåset (beslutets regel om transaktionslås).

---

## 9. "Ta jobbet" med `ao_pool_take` (AP-F)

**Ny RPC: `work_order_pool_take(p_ao_id, p_caller_staff_id, p_entry_id, p_idempotency_key)`**, med `SECURITY DEFINER` och körbar bara av `service_role`.

1. Idempotens via `op_idempotency` med `fn_name = 'work_order_pool_take'` (samma mönster som `functions.sql:4800-4804` och `:4844-4845`). Samma nyckel ger samma svar.
2. `SELECT value … WHERE key = 'vift_workOrders' FOR UPDATE`. Därefter sker alla kontroller på den låsta raden:
   - AO saknas: `not_found` (404).
   - `deleted`, `archived` eller avslutad: `not_available` (409).
   - Inte öppen pool (`status <> 'pool'`, `poolOpen = false` eller `staff` inte tom): **`already_assigned`** (409) om `staff` inte är tom, annars `not_in_pool` (409).
   - Anroparen finns inte i `vift_staff` eller är inaktiv: `forbidden` (403).
3. Skriv: `staff = [anroparen]`, `poolOpen = false`, status `planerad` (övergångsregeln i 5.6) och loggposten `{id: p_entry_id, type:'taken_from_pool', staffId, at}` **tillagd** sist i `log`, inte ersatt. `updatedAt` sätts av servern.
4. Returnera `{workOrder, takenBy}`.

**Edge Function** (en ny gren eller ny `ao-time-write`-åtgärd `take_from_pool`):

- Kräv `ao_pool_take` (eller `all`) och `ao_view_own`/`ao_view_all`. Kopplas inte till `ao_complete` eller `ao_time`.
- Identiteten tas från `checkViftAuth`. Klienten skickar bara `aoId` och idempotensnyckel.
- Ta bort gren B (`ao-time-write/index.ts:123`, `:135-151`), så att det inte finns två vägar.

**Samtidighet:** två anrop serialiseras av radlåset. Det första får 200. Det andra ser `staff` som inte är tom och får 409 `already_assigned` utan att något ändras. Dagens `expectedUpdatedAt` behövs inte här (avsnitt 3.3).

**Klient** (`WorkOrderService.takeFromPool`, `:1350-1374`; `MyJobsPage.takeFromPool`, `:527-533`):

- Ingen lokal mutation före serverns svar.
- Vid 409 `already_assigned` visas "Jobbet har redan tagits", och listan uppdateras.
- Knappen visas bara med `ao_pool_take` och bara för öppen pool.

---

## 10. Notiser (AP-D)

| Krav | Lösning |
|---|---|
| Efter bekräftad serverändring | Notiser skapas av **servern** i samma transaktion som ändringen, som en utkorg: en ny post i en egen tabell eller nyckel med `{event, aoId, staffId, dedupeKey, createdAt}`. Push skickas därifrån, eller av klienten efter bekräftelse med samma `dedupeKey`. Klientens lokala `NotificationsService.push` (`NotificationsService.js:7-22`) skriver i dag en delad lista direkt och räknas inte som bekräftad. |
| Utlösare: personal tilldelad | Alla vägar som faktiskt **lägger till** id i `staff`: personaldialogen, massändring, AO skapad med personal (guide, serviceintervall, återkommande, offert till AO, import om det önskas) och `work_order_pool_take` (själv-tilldelning ger ingen notis till sig själv). Diffen beräknas på servern mellan låst före-värde och efter-värde. |
| Dubblettskydd | `dedupeKey = aoId \| staffId \| 'assigned' \| <id för loggposten som lade till personen>`, unik. Upprepade försök med samma idempotensnyckel skapar ingen ny notis. |
| Notis till arbetsledare när ett jobb tas | Händelsen `pool_taken`. Mottagare enligt konfiguration: ansvarig på AO:n, eller personal med en ny notisbehörighet. Den hårdkodas inte på rollnamn. |
| Nytt öppet pooljobb | Konfigurerbar och av som standard: en inställning per organisation eller användare ("notis om nya pooljobb"). Mottagare bara bland de som har `ao_pool_take`. Händelsen `pool_released` från "Släpp till öppen pool" och från guiden. |
| Ingen falsk notis vid avplanering | "Ta bort datum" skapar ingen tilldelningshändelse. Personaldialogen skapar händelser bara för faktiskt tillagda personer (rättar `WorkOrderDetailPage.js:3233-3249`). |

---

## 11. Egen planering med `ao_plan_own` (AP-E, senare etapp)

**Serverfunktion `work_order_plan_own(p_ao_id, p_caller_staff_id, p_date, p_start, p_end, p_mode, p_idempotency_key)`**, med radlås:

- Kräver `ao_plan_own` och `me ∈ staff`. AO:n får inte vara avslutad eller pågående; bara `nytt`, `pool` eller `planerad`.
- **Får bara ändra** `scheduledDate`, `scheduledStart` och `scheduledEnd`, plus loggposten `schedule_set_own`. Personal, ansvarig, status, `poolOpen`, ekonomiska fält och `dueDate` rörs aldrig.
- Oplanerad AO (tilldelad pool): tillåten för alla tilldelade.
- Redan planerad AO: ändring kräver ett eget beslut. Förslag: en separat behörighet `ao_replan_own`, eller att datumet sattes av anroparen själv (loggens senaste `schedule_set*` är anroparens).
- **Flerpersonsuppdrag**, förslag:
  - Om `responsibleStaffId` är satt får bara ansvarig planera.
  - Annars får första planeringen göras av vilken tilldelad som helst. En senare ändring kräver ansvarig eller arbetsledare.
  - Varje ändring loggas och ger en notis (`schedule_changed`) till de andra tilldelade.
- **Konflikt:** valfritt `p_expected_schedule` (förra datumet och tiden) jämförs under låset och ger `schedule_conflict` (409).

---

## 12. Beroenden och ordning

| Arbete | Beroende |
|---|---|
| **SÄK-3** (läcka) | Avsnitt 5.4 och 8. Måste ändras samtidigt i `work-orders-list`, `canViewWorkOrder` (alla EF-buntar som har `_shared/vift-auth.ts`), tre SQL-funktioner och fake-backend. |
| **SÄK-4** ("Ta jobbet") | Avsnitt 9. Kräver behörigheten `ao_pool_take` i rollregistret och klientändringen samtidigt. |
| **SÄK-5** (`ao_complete`) | Avsnitt 8. Hör ihop med D-03 (`ao_complete_own`). Samma serveromgång. |
| **D-03 `ao_start_own`, `ao_complete_own`, `ao_pool_take`** | De nya behörigheterna måste finnas i standardrollerna (D-02, D-26) innan den gamla grenen tas bort. Annars förlorar fältet start, klarmarkering och tagning. |
| **B4 (aktivitetslogg) och Ö7 (uppgifter)** | Enligt beslutet rättas poolregeln **före eller samtidigt**. B4:s urval för fältet = AO där `me ∈ staff`, plus öppen pool om det beslutas (förslag: inte för loggen, eftersom öppen pool ska ha begränsad information enligt D-13). Testplanens ordning (B4/Ö7 före F1/F4/F15) ska rättas. |
| **D-22** | Notisutkorg och loggposter skrivs med serversatt aktör och tid. Samma mönster som för B4. |
| **D-19** (radvisa materialrader) | Skrivregeln i avsnitt 8 (`me ∈ staff`) är förutsättning. |
| **AP-E** | Senare etapp, efter avsnitt 5 och 9. |
| **AP-G** | Avvecklingen av `pool` först när import, serviceintervall, kalender, behörigheter och notiser är verifierade med kategorierna. |

**Ordning:**

1. Server, en omgång i STAGING efter separat godkännande:
   - läsregeln enligt 5.4;
   - skrivregeln enligt 8 (EF och SQL);
   - `work_order_pool_take`;
   - SÄK-5;
   - `create_time` och stämplingskontroll;
   - fake-backend speglas i samma ändring;
   - behörigheterna `ao_pool_take`, `ao_start_own` och `ao_complete_own` i rollerna.
2. Klient:
   - personaldialogen (AP-FEL-1, AP-G);
   - "Ta bort datum" och "Släpp till öppen pool";
   - "Ta jobbet" som väntar på serverns svar;
   - stämplingsurvalet.
3. B4 och Ö7 på den rättade regeln. Får göras samtidigt med steg 1.
4. `poolKategori` och räknarna (avsnitt 5 och 6) i alla vyer. `dueDate` för serviceintervall.
5. Notisutkorgen (avsnitt 10).
6. AP-E (`ao_plan_own`).
7. AP-G: avveckling av status `pool` för nya AO.

---

## 13. Testfall

**Gemensamma krav:**

- Varje negativt fall kontrollerar **felorsaken** (HTTP-status och `error`-kod) **och** att ingen mutation skett. Läs posten före och efter: samma `updatedAt`, `staff` och `log`, och inga nya tidposter, filer eller notiser.
- STAGING-tester använder bara poster märkta `[E2E-TEST]`. De skrivande STAGING-testerna körs inte i omgången T0–T2.

**Roller:**

| Kod | Behörigheter |
|---|---|
| FA, FB | Fält: `ao_view_own`, `ao_pool_take`, `ao_time`, `ao_checklist`, `ao_material`, `ao_start_own`, `ao_complete_own` |
| BG | Begränsad: `ao_view_own` |
| AL | Arbetsledare: `ao_view_all`, `ao_edit` |
| EGEN | Anpassad roll som saknar en enskild behörighet (D-26) |

**Data:** rad 1–18 i avsnitt 5.3. FB är tilldelad i de rader som har personal.

### 13.1 Läsning (`work-orders-list` och `work-order-image-url`)

| # | Fall | Förväntat |
|---|---|---|
| L1 | FA listar | Rad 5 och 6 (öppen pool) och inga andra än egna. **Inte** rad 7, 8 eller 15. |
| L2 | FB listar | Egna rader (3, 4, 7, 8, 11, 12) samt 5 och 6. |
| L3 | BG listar | Bara egna. Ingen öppen pool (D-04). |
| L4 | EGEN utan `ao_pool_take` | Ingen öppen pool. |
| L5 | AL listar | Allt. |
| L6 | Delmängdsbevis | För varje roll och testdatamängd: antal och id efter ⊆ före (jämför med dagens regel i en simulerad körning). |
| L7 | FA hämtar bild-URL på rad 7 | 403 `forbidden`. |

### 13.2 Skrivning utan tilldelning (FA på rad 5, öppen pool)

| # | Åtgärd | Förväntat |
|---|---|---|
| W1 | Materialpatch | 403. Ingen ändring. |
| W2 | Bilduppladdning | 403. Ingen fil skapad. |
| W3 | Bildradering | 403. Filen finns kvar. |
| W4 | Checklistpunkt | 403 `forbidden`. Checklistan oförändrad. |
| W5 | Loggpost, tillägg och borttagning | 403. |
| W6 | `create_time` med `aoId` | 403 `not_assigned`. Ingen tidpost och inget nytt id i `ao.timeEntries`. |
| W7 | Instämpling med `aoId` | 403 `not_assigned`. Stämpelraden oförändrad. |
| W8 | Klarmarkering (SÄK-5) av rad 5, rad 12 med annan tilldelad, och en fakturerad AO | 403. Status oförändrad. |
| W9 | FB (tilldelad) gör W1–W7 på sin egen AO | 200. Positivt fall. |

### 13.3 Tagning (`work_order_pool_take`)

| # | Fall | Förväntat |
|---|---|---|
| T1 | FA tar rad 5 | 200. `staff=[FA]`, `poolOpen:false`, en enda `taken_from_pool`-post tillagd. Övriga loggposter oförändrade. |
| T2 | FA tar rad 7 (tilldelad FB) | 409 `already_assigned`. Ingen mutation. |
| T3 | FA tar rad 3 eller rad 1 (inte tillgängliggjord) | 409 `not_in_pool`. Ingen mutation. |
| T4 | FA tar en borttagen eller arkiverad pool-AO | 409 `not_available`. |
| T5 | BG eller EGEN utan `ao_pool_take` tar | 403 `forbidden`. |
| T6 | En roll med `ao_complete` men utan `ao_pool_take` tar | 403 (ingen koppling till `ao_complete`). |
| T7 | FA och FB tar rad 5 samtidigt (N=2 och N=10 parallella anrop) | Exakt en 200. Övriga får 409 `already_assigned`. `staff` har längd 1, och det finns exakt en `taken_from_pool`-post. |
| T8 | Samma anrop upprepas med samma idempotensnyckel | Samma svar. Ingen dubbel loggpost och ingen dubbel notis. |
| T9 | FA skickar `staff` eller `status` i kroppen | Ignoreras eller ger 400. Servern sätter allt själv. |

### 13.4 Arbetsledare och dialog

| # | Fall | Förväntat |
|---|---|---|
| A1 | **AP-FEL-1:** AL öppnar "Hantera personal" på rad 5, väljer FA och sparar | `staff=[FA]`, ansvarig enligt val, status och datum oförändrade, `poolOpen:false`. Exakt en tilldelningsnotis till FA efter serverns bekräftelse. |
| A2 | AL tar bort FA | `staff_removed`. AO:n går **inte** tillbaka till öppen pool (rad 18). Ingen notis. |
| A3 | "Ta bort datum" på rad 12 | Bara datumfälten rensas. Kategorin blir tilldelad pool. Ingen notis. |
| A4 | "Släpp till öppen pool" på rad 12 | Bekräftelse krävs. `staff_removed` per person och `released_to_pool`. Status `pool` och `poolOpen:true`. |
| A5 | AL1 och AL2 ändrar personal samtidigt | Ingen tyst förlust. Antingen `stale_write` via ett serverlevererat versionsvärde, eller en radvis operation under lås. |

### 13.5 Klient, räknare och vyer

| # | Fall | Förväntat |
|---|---|---|
| K1 | Mina jobb för FA | Fliken "Öppen pool" = rad 5 och 6. Inga dubbletter. Tilldelad pool under "Tilldelade utan datum". |
| K2 | Räknare | Dashboard "Otilldelade" = Dagens drift "Otilldelade" = AO-listans `unassigned` = aktiva utan personal, eller samma tal med etiketten "(utom öppen pool)" på alla ställen. |
| K3 | Kalender | Rad 4, 10 och 12 på sin dag. Rad 5 och 6 i "Öppen pool". Rad 3, 7, 8 och 11 i "Tilldelade, oplanerade" och följer personalfiltret. |
| K4 | Instämplingslistan | Bara egna tilldelade AO. |
| K5 | Bakåtkompatibilitet | Laddning, polling och rendering av alla 18 rader ändrar ingen post (diff mot servern är tom). |

### 13.6 Befintliga tester som ska skärpas

| Test | Fil:rad | Ändring |
|---|---|---|
| Behörighetstest, simulerat | `tests/e2e/specs/14_permissions.js:57-60` | Godkänner i dag "`status === 'pool'`". Ska kräva öppen pool. Lägg till rad 7, 8 och 15 som negativa fall. |
| Begränsad användare | `tests/e2e/specs/04_workorders.js:384-389` | Samma. Begränsad ska inte se öppen pool (D-04). |
| STAGING-läsning (läsande) | `tests/staging/authz-read.js:62-63` | Samma. |
| Nästa steg | `tests/v3_ui_logic.test.js:78` | `nextStep` per kategori. |
| Mina jobb | `tests/e2e/specs/33_falt_pages.js:159-195`, `:312-314` | Tagning via ny åtgärd. Pooldefinition och räknare enligt avsnitt 6. |
| AO-detalj | `tests/e2e/specs/27_aodetail.js:203-217`, `:326` | Ny åtgärd för "Ta bort datum" och "Släpp till öppen pool". Personaldialogen utan poolruta. |
| Fake-backend | `tests/e2e/fake-backend.js:122-127`, `:395-427`, `:597-611` | Spegla installerad källa (avsnitt 8). |

---

## 14. Öppna frågor

Detta är inte nya affärsbeslut, utan förtydliganden inom AP-A–AP-G.

| Nr | Fråga | Förslag |
|---|---|---|
| Q1 | En pool-AO som fått ett datum via "Omplanera" (rad 6 och 8) klassas som förfallodatum, inte som planerad. Det är så kalendern redan visar den. Godtas det, eller ska en sådan AO räknas som planerad? | Godta. Det ändrar ingen visning jämfört med i dag och breddar inte utlämningen. |
| Q2 | Är återkommande ärendens datum ett utförandedatum (som i dag) eller ett förfallodatum? AP-A nämner återkommande ärenden. | Behåll utförandedatum för befintliga. Inför ett val per återkommande ärende för nya AO ("planera på datum" eller "förfaller datum, lägg i pool"). |
| Q3 | Ska fältets logg- och historikurval (B4) innehålla öppna pool-AO? | Nej. Öppen pool har begränsad information (D-13). |
| Q4 | Vem får planera om ett flerpersonsuppdrag med `ao_plan_own`? | Se avsnitt 11: ansvarig, annars den som planerade först. |

---

## Sammanfattning och rekommendation

- **Kategorier:** Avslutade, Öppen pool, Planerad, Tilldelad pool och Övriga aktiva. De härleds ur personal, utförandedatum, status och den uttryckliga markeringen "tillgängliggjord" (status `pool` och `poolOpen ≠ false`). En ny AO utan personal och datum exponeras inte.
- **Datum:** förfallodatum skiljs från utförandedatum med ett nytt fält `dueDate`. På befintliga pool-AO tolkas `scheduledDate` som förfallodatum, vilket redan är hur kalendern och försenad-regeln behandlar dem.
- **Utlämning:** säkerhetsrättningen är bevisligen en delmängd av dagens utlämning. Den stänger läckan för tilldelade, arkiverade och borttagna pool-AO, kräver `ao_pool_take` för att se öppen pool, och tar bort all skrivrätt via poolgrenen.
- **Tagning:** "Ta jobbet" flyttas till en RPC med radlås och 409 `already_assigned`.
- **Stämpling:** kräver tilldelning, kontrollerad i `time_entry_create` och i stämplingsvägen.
- **Omgångar:** serverrättningen (SÄK-3, SÄK-4, SÄK-5 och skrivreglerna) görs i en omgång, före eller samtidigt med B4 och Ö7. Därefter klienten och sedan kategorierna i alla vyer.
- **Historik:** ingen historisk AO skrivs om.
