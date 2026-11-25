# Arbetspool, tilldelning och planering: utredning

2026-11-26. Underlaget bygger bara på läsning av kod. Ingen kod, ingen data och ingen server har ändrats. Inga nätverksanrop är gjorda.

**Kodbaser som lästs**

- Klient: `/home/user/VIFT-CRM`, gren `claude/vift-v3-major-redesign` (publicerad STAGING v3.4).
- Server: `/home/user/vift-v2/supabase/functions` (work-orders-list, ao-time-write, _shared, service-monitor) och migreringarna i `/home/user/vift-v2/supabase/migrations`. `_shared/vift-auth.ts` är identisk i båda repona.
- Simulerad server: `/home/user/VIFT-CRM/tests/e2e/fake-backend.js`.

**Förbehåll.** SQL-källan till `work_order_patch` och `work_order_create` finns inte i något av repona (G4, se `supabase/migrations/20261123000001_PROPOSAL_work_order_log_ops.sql:4`). Hur servern slår ihop en patch och hur den jämför `p_expected_updated_at` är därför antaget utifrån kommentarerna i ao-time-write, inte verifierat.

---

## 0. Kort svar

1. **Det rapporterade felet beror på att rutan "Flytta till arbetspool" redan är ikryssad när ordern har status `pool`.** Om man väljer personal och sparar körs grenen som tömmer `staff` och `responsibleStaffId` (`WorkOrderDetailPage.js:3167`, `:3196`, `:3223`; `WorkOrderService.js:1322-1326`). På en pool-AO går det alltså inte att tilldela personal i dialogen utan att först kryssa ur rutan. Dessutom loggar dialogen "Personal tilldelad" och skickar notis och push till personalen, trots att personalen just rensats (`WorkOrderDetailPage.js:3233-3249`).
2. **Ja, dagens poolregel läcker.** `work-orders-list` lämnar ut varje AO med `status === 'pool'` till alla med `ao_view_own`, oavsett vem som är tilldelad (`work-orders-list/index.ts:88-91`). Samma regel finns i `canViewWorkOrder` (`_shared/vift-auth.ts:121-131`), i tre SQL-funktioner och i fake-backend (`fake-backend.js:122-127`). Kombinationen status `pool` med personal skapas dessutom regelbundet av systemet självt: serviceintervall, guiden i pool-läge med personal, "Till pool" och statusbyte.
3. **"Ta jobbet" nekas inte när AO:n redan har personal.** Kontrollen i `ao-time-write` kräver bara `status === 'pool'` och att anroparen läggs till (`ao-time-write/index.ts:241-257`). En fältanvändare med `ao_complete` kan alltså lägga till sig på någon annans pool-AO. Kontrollen läser dessutom AO:n utanför RPC-låset, och klienten skickar inget `expectedUpdatedAt` (`WorkOrderService.js:1369`). Två samtidiga "Ta jobbet" kan därför båda godkännas, och den sista skrivningen vinner.
4. **Dimensionerna är inte separata i dag.** Vy och behörighet styrs av statusvärdet `pool`, inte av personal och datum. Det ger flera felaktigheter:
   - "Planerad" kan sakna datum (`takeFromPool`, `updateStaff` och knappen "Planera").
   - En pool-AO kan ha datum. Kalendern visar den ändå som "ej schemalagd", och Mina jobb visar den dubbelt.
   - En tilldelad AO utan datum med status `planerad` eller `nytt` syns inte alls i kalendern.
   - Räknarna för "Otilldelade" skiljer sig mellan AO-listan och dashboard/Dagens drift.
5. **Rekommendation:** gör en serverfix först. Poolgrenen ska kräva tom `staff`, och "Ta jobbet" ska nekas om personal redan finns. Rätta sedan dialogen och notiserna. Inför därefter en gemensam härledd poolkategori (öppen pool, tilldelad pool, planerad) från `staff` och `scheduledDate` i alla vyer. Lagrad data ändras inte: status `pool` tolkas vid läsning.

---

## 1. Datamodell och statusmodell i dag

### 1.1 Fält

| Fält | Källa | Betydelse i dag |
|---|---|---|
| `status` | `schema.js:184` (`nytt \| pool \| planerad \| pågående \| klar \| fakturerad \| avbruten`) | Blandar tre saker: arbetsläge, "ligger i poolen" och "har ett datum". `pool` är ett **statusvärde**. Det finns inget separat poolfält. |
| `staff` | string[] med personal-id | Vilka som är tilldelade. Tom lista betyder otilldelad. |
| `responsibleStaffId` | string | Ansvarig. Dialogen lägger alltid till ansvarig i `staff` (`WorkOrderDetailPage.js:3226-3229`). |
| `scheduledDate`, `scheduledStart`, `scheduledEnd` | ISO-datum och tider | Planering. Saknas ofta trots status `planerad`. |
| `log[]` | Poster i AO:n (`staff_changed`, `staff_added`, `staff_removed`, `staff_responsible`, `taken_from_pool` …) | AO-historik. |
| `updatedAt` | Sätts av klient och server | Kan användas för konfliktkontroll (`expectedUpdatedAt`), men görs inte i tilldelningsflödena. |

Statusetiketten `pool` visas som "Arbetspool" (`state.js:2385`).

### 1.2 Var status `pool` sätts, med eller utan personal och datum

| Väg | Kod | Personal | Datum |
|---|---|---|---|
| Ny AO-guide, "Arbetspool" | `WorkOrdersPage.js:2252` sätter status `pool` och rensar datum. "Personal (valfritt)" visas i båda lägena (`:1728-1736`) och sparas (`:2497`). | **Kan vara satt** | Tomt |
| Serviceintervall, klient | `ServiceIntervalService.js:564-576`: `status:'pool'`, `staff: si.aoStaff`, `scheduledDate: si.nextDue` | **Kan vara satt** | **Satt** |
| Serviceintervall, server (cron) | `service-monitor/index.ts:483-490`, samma fält | **Kan vara satt** | **Satt** |
| "Till pool" i AO-detaljen (bara från `nytt`) | `WorkOrderDetailPage.js:469-470` → `WorkOrderService.setStatus` (`:619-660`) ändrar **bara** status | Behålls | Behålls |
| Statusbyte i dialogen (alla aktiva statusar) | `WorkOrderDetailPage.js:2449-2459` | Behålls | Behålls |
| Massändring av status | `WorkOrdersPage.js:2642`, `:2785-2787` | Behålls | Behålls |
| Dialogen "Hantera personal" med poolrutan ikryssad | `WorkOrderService.js:1322-1326` | **Rensas** | Behålls |
| "Omplanera" eller "Planera" på en pool-AO | `WorkOrderDetailPage.js:316`, `:663-697` (`update({scheduledDate…})`, status orörd) | Behålls | **Sätts**, status förblir `pool` |
| CSV/XLSX-import | `ImportExportConfigs.js:588` tar emot `pool` | Godtyckligt | Godtyckligt |

Status lämnar `pool` på tre sätt:

- `updateStaff` utan poolruta men med personal ger `planerad` (`WorkOrderService.js:1333`).
- `takeFromPool` ger `planerad` (`:1350-1374`).
- `_bulkAddStaff` ger `planerad` (`WorkOrdersPage.js:2939`).

Inget av dessa sätter datum. **Status `planerad` utan datum är därmed normalt.** Knappen "Planera" (`WorkOrderDetailPage.js:467-468`) sätter också `planerad` utan att fråga efter datum.

Datum kan inte tas bort via "Omplanera", eftersom ett tomt datum avvisas med "Välj datum" (`WorkOrderDetailPage.js:689`). Det enda sättet att "avplanera" i dag är att flytta ordern till poolen. Det behåller datumet men rensar personalen, alltså raka motsatsen till affärsregeln.

### 1.3 Exakt orsak till det rapporterade felet

`WorkOrderDetailPage.manageStaff()` (`WorkOrderDetailPage.js:3159-3212`):

```js
const isPool = ao.status === 'pool';                                   // :3167
<input type="checkbox" id="sm-pool" ${isPool?'checked':''}>            // :3196
"Rensar personal och sätter status till Pool"                          // :3199
```

`_saveStaff()` (`:3214-3256`) läser rutan och skickar `moveToPool` (`:3223`, `:3231`). `WorkOrderService.updateStaff()` (`WorkOrderService.js:1312-1348`):

```js
if (moveToPool) {
  ao.staff = [];                 // :1323  vald personal ignoreras helt
  ao.status = 'pool';            // :1324
  ao.responsibleStaffId = '';    // :1325
  ao.log.push({ type:'staff_changed', text:`${by} flyttade ordern till arbetspoolen` }); // :1326
}
```

Följdfel i samma flöde:

- **Falsk historik och falska notiser.** `_saveStaff` räknar `added` från de **valda** id:na, inte från resultatet (`:3233`). Därför körs `ActivityService.log('staff_assigned', …)` (`:3236`), `NotificationsService.push(id, 'ao_assigned', …)` (`:3240`) och `PushService.notifyStaffAssigned(ao, added)` (`:3248`) fast personalen just rensats.
- **Historik saknas.** Vid poolflytten loggas inte vilka som togs bort och inte att ansvarig nollställdes. Det skrivs bara en generisk post (`:1326`).
- **Ingen konfliktkontroll.** Hela `staff`-listan skrivs utan `expectedUpdatedAt` (`WorkOrderService.js:1345` → `_syncAO` → `AOTimeSyncService.patchAO(…, expected=null)`). En samtidig ändring från någon annan skrivs över tyst.
- **Status ändras som sidoeffekt.** `pool` blir `planerad` vid tilldelning även utan datum (`:1333`).

---

## 2. Servern: vilka AO en fältanvändare ser (`work-orders-list`)

### 2.1 Regeln

`/home/user/vift-v2/supabase/functions/work-orders-list/index.ts`:

```ts
if (hasPerm(perms, 'ao_view_all') || hasPerm(perms, 'all')) return json({ workOrders: redact(all, perms) })  // :78-80
if (!hasPerm(perms, 'ao_view_own')) return json({ workOrders: [] })                                         // :82-84
const filtered = all.filter(ao => {
  const staff = Array.isArray(ao.staff) ? ao.staff : []
  return staff.includes(myStaffId) || ao.status === 'pool'                                                  // :88-91
})
```

### 2.2 Svar på den kritiska frågan

**Ja.** Varje AO med `status === 'pool'` lämnas ut till **alla** användare med `ao_view_own`, även när `staff` innehåller andra medarbetare och även när ordern har datum. Personal och datum ingår inte i villkoret. Svaret innehåller hela AO-posten utom `accessCode` för roller utan `objects_sensitive`/`ao_edit` (`:46-55`), alltså kund, adress, beskrivning, checklista, material, anteckningar, logg och personal-id.

Läckan är inte teoretisk. Kombinationen `pool` + personal uppstår i normal drift (avsnitt 1.2): serviceintervall med `aoStaff`, guiden i pool-läge med vald personal, "Till pool" och statusbyte på en tilldelad order.

### 2.3 Samma regel på andra ställen

Ändras regeln måste den ändras på alla dessa ställen samtidigt:

| Ställe | Fil:rad | Effekt för någon annans tilldelade pool-AO |
|---|---|---|
| `canViewWorkOrder` | `_shared/vift-auth.ts:121-131` | Används av `work-order-image-url`, `-upload` och `-delete` (`work-order-image-delete/index.ts:90`) samt ao-time-write (materialgrenen `:210`, "Ta jobbet" `:256`). Andra kan se, ladda upp och radera bilder och lägga till material. |
| `work_order_checklist_resolve` | `migrations/20260917000001_…sql:145-149` | Andra kan bocka av och markera avvikelse i checklistan. |
| Checklistans framsteg | `migrations/20261123000002_…sql:107-112` | Samma. |
| `work_order_log_append` och `_remove` | `migrations/20261124000002_work_order_log_ops.sql:38-42`, `:74-78` | Andra kan skriva i AO-loggen. |
| Fake-backend `canViewAO` | `tests/e2e/fake-backend.js:122-127` (används i `:234`, `:424`, `:597`, `:659`, `:682`, `:692`, `:701`) | Den simulerade servern har samma läcka. |
| Klientspeglar | `WorkOrdersPage.js:419`, `:2618`; `Dashboard.js:381`; `WorkOrderDetailPage.js:59-62` | Bara visning. Skyddar inget. |

`time-entries-list` filtrerar på egen `staffId` (`time-entries-list/index.ts:127`) och berörs inte. Tillägget `create_time` i ao-time-write kontrollerar inte att anroparen får se AO:n (`:304-…`). En fältanvändare kan alltså stämpla in på vilken AO som helst som finns i hens lista, inklusive pool-AO tilldelade andra. Instämplingslistan tar med alla statusar `pool`, `nytt`, `planerad` och `pågående` (`TimePage.js:173`).

### 2.4 Befintliga tester bekräftar den gamla regeln

- `tests/e2e/specs/14_permissions.js:57-60` och `tests/e2e/specs/04_workorders.js:384-389` godkänner allt som är "eget eller `status === 'pool'`".
- `tests/staging/authz-read.js:62-63` (riktig STAGING) godkänner samma villkor.

Testerna kan alltså inte upptäcka läckan och måste skärpas.

---

## 3. `ao-time-write`: "Ta jobbet" och statusövergångar

### 3.1 Gren för fältroll utan `ao_edit` (`ao-time-write/index.ts:162-273`)

- Utan `ao_edit` och utan `ao_complete` nekas allt utom en ren materialpatch (`:214-215`). **Begränsad** (bara `ao_view_own`) ser poolen och knappen "Ta jobbet" i Mina jobb (`MyJobsPage.js:347`), men servern svarar 403.
- Gren A, "Starta" (`:236-240`): bara `{status:'pågående'}`. Anroparen måste finnas i `staff`, och status måste vara `nytt`, `planerad` eller `pool`.
- Gren B, "Ta från poolen" (`:241-257`):

```ts
const expStaff = curStaff.includes(callerStaffId) ? curStaff : curStaff.concat([callerStaffId])   // :243
const okB = keys.every(k => k === 'staff' || k === 'status' || k === 'log') &&
  target.status === 'pool' && sameStaff && logOk && canViewWorkOrder(target, perms, callerStaffId)  // :255-256
```

**Om AO:n redan har personal** godkänns tagningen ändå. Ny `staff` blir befintlig plus anroparen, och status blir `planerad`. Det finns ingen kontroll av att `curStaff` är tom. Den som är tilldelad behåller sin plats, men en annan fältanvändare kan alltså "ta" en tilldelad-men-oplanerad order, vilket bryter mot affärsregeln. Klienten lägger till på samma sätt (`WorkOrderService.js:1354-1356`). Datum kontrolleras inte heller.

- **`ao_edit`-innehavare** (arbetsledare, admin) har ingen begränsning alls. Hela patchen går rakt in i `work_order_patch` (`:268-272`).

### 3.2 Samtidighet

- Gren B läser `vift_workOrders` **utanför** RPC-låset (`:230`) och anropar `work_order_patch` först efteråt. Två fältanvändare som trycker "Ta jobbet" samtidigt kan båda passera `target.status === 'pool'`.
- Klienten skickar inget `expectedUpdatedAt`. `takeFromPool` anropar `_syncAO` utan opts (`WorkOrderService.js:1369`), och `_syncAO` skickar `null` (`:132-134`).
- Patchen innehåller hela `staff` och hela `log`. Den andra skrivningen ersätter då sannolikt den förstas `staff` (`[A]` blir `[B]`) och `taken_from_pool`-posten. Båda klienterna har redan visat "Du är nu tilldelad" (`MyJobsPage.js:527-533`), utan att vänta på serverns svar.
- Samma sak gäller arbetsledare som ändrar personal samtidigt i `updateStaff`: sista skrivningen vinner, utan varning.
- Fake-backend stöder `expectedUpdatedAt` (`fake-backend.js:425`), men dess `patch_ao` (`:421-427`) saknar **hela** fältbegränsningen. Vem som helst med någon AO-behörighet som ser AO:n kan patcha vad som helst, även `staff`. Den simulerade servern kan därför inte testa "Ta jobbet"-reglerna i dag. Kommentaren "källan saknas i repot" (`:395`) är inaktuell: källan finns nu i `vift-v2`.

---

## 4. Klienten, vy för vy

| Vy | Kod | Hur pool, tilldelning och datum avgörs | Problem |
|---|---|---|---|
| **Mina jobb**, grupper | `MyJobsPage.js:43-58` | Egna: `staff.includes(me)`, delade på datum: idag, försenade, utan datum ("Tilldelade utan datum", `:192`), kommande. **Pool: `status === 'pool'`**, oavsett personal och datum (`:56`). | Andras tilldelade pool-AO visas i fliken Arbetspool med "Ta jobbet". En pool-AO tilldelad mig visas **dubbelt**, både under Idag/Kommande och i Arbetspool. Försenade (`:50`) tar med `pool`, men `isOverdue` utesluter `pool`. Det är inkonsekvent. Tom-text: "kan tas av vem som helst i teamet" (`:219`). |
| Mina jobb, "Ta jobbet" | `MyJobsPage.js:347`, `:527-533` | Visas för alla pool-AO. | Visas även för egen eller annans tilldelade AO och för roller som servern nekar. Lyckat-besked ges före serverns svar. |
| **AO-lista**, statusflik "Pool" | `WorkOrdersPage.js:253-256`, `:577-583` | `status === 'pool'` | Blandar öppen och tilldelad pool. Tilldelade AO med status `planerad`/`nytt` utan datum hamnar inte här. |
| AO-lista, snabbfilter "Otilldelade" | `WorkOrdersPage.js:182`, `:599-600` | `!staff.length`, **inklusive pool** | Dashboardens ruta "Otilldelade" (`Dashboard.js:289`, utan pool) och Dagens drift (`OperationsPage.js:48`, utan pool) länkar hit med `filter:'unassigned'` (`Dashboard.js:358`, `OperationsPage.js:23`). Siffran på rutan stämmer då inte med listan man landar i. |
| AO-lista, behörighetsfilter | `WorkOrdersPage.js:414-421` (`_permittedList`), `:2612-2621` (`_canAccessAo`, används av massändring och export) | Eget eller `status==='pool'` | Följer serverns läcka. Fältet kan exportera andras pool-AO. |
| **AO-detalj** | `WorkOrderDetailPage.js:59-62` (åtkomst), `:109` (utförandetext), `:447-472` (åtgärder), `WorkOrderService.nextStep` `:938` | Status `pool` ger "väntar på att någon tar uppdraget" (`action:'take'`) | Gäller även när personal finns. "Till pool" och statusbyte behåller personal, så resultatet blir "pool + personal". "Planera" ger `planerad` utan datum. "Omplanera" kan inte ta bort datum (`:689`). |
| **Kalender** | `CalendarPage.js:159-160`, `:191-194` (vecka), `:293-296`, `:316-323` (agenda), `:340` (händelser) | Status `pool` ritas bara i rutan "Arbetspool (N ej schemalagda)". Övriga AO bara på `scheduledDate`. | En pool-AO **med datum** visas inte på sin dag utan som "ej schemalagd". En tilldelad AO **utan datum** och status `planerad`/`nytt` syns **ingenstans**. Poolrutan filtreras inte på personalfiltret (`f.staffId`). Pool-chips går inte att dra till en dag (`_poolChip` `:538-544` saknar drag). |
| **Dagens drift** | `OperationsPage.js:38-51`, `:118` | Försenade utesluter `pool`, och "Otilldelade" utesluter `pool`. Grupp "pool": "ingen har tagit jobbet". | Texten stämmer inte för pool + personal. Personalvyn (`:144-153`) räknar pool-AO som "mina" men inte som försenade. |
| **Dashboard** | `_scopeWorkOrdersForCurrentUser` `Dashboard.js:371-384`, widget Arbetspool `:1891-1926`, dagens tavla `:274-292`, karta `:1296-1306`, `Sidebar.js:333-343` | Poolwidgeten visar `status === 'pool'` med texten "jobb väntar på att tilldelas" (`:1910`). Kommentaren `:247-248` **antar** att pool betyder "ingen tilldelad resurs", men koden kontrollerar det inte. | Tilldelade pool-AO räknas som "väntar på att tilldelas". För fältanvändare tar KPI, hero och "Kräver åtgärd" med alla pool-AO (`includeSharedPool:true`, `:277`, `:1203`, `:2273`, `:2314`), även andras. |
| **Notiser** | `WorkOrderDetailPage.js:3233-3249`; `PushService.notifyStaffAssigned` `PushService.js:588-628`; massändring `WorkOrdersPage.js:2925-2950`; guiden `WorkOrderService.create` → `notifyNewAO` (`:317-325`, riktad till fastighet eller broadcast) | Tilldelningsnotis bara från dialogen och massändringen. | Falsk notis vid poolflytt (avsnitt 1.3). Ingen tilldelningsnotis när AO skapas med personal (guide, serviceintervall, återkommande) eller vid "Ta jobbet" (ingen notis till arbetsledaren). Typen `ao_pool` finns i ikonmappningen (`NotificationsService.js:79`) men skickas ingenstans. |
| **Historik** | `ao.log` (`WorkOrderService.js:1326-1340`, `:1361-1365`); `ActivityService.log` (`:1344`, `:1366-1368`; `WorkOrderDetailPage.js:3236`) | `staff_added`, `staff_removed`, `staff_responsible`, `staff_changed` och `taken_from_pool` | Poolflytten loggar inte vilka som togs bort. `staff_assigned` loggas felaktigt. `ActivityService` loggar "Personal ändrad" även när inget ändrats. |
| **Samtidiga ändringar** | `WorkOrderService.update` `:445-458` (medvetet utan `expectedUpdatedAt`); `_syncAO` `:123-160` | Ingen tilldelningsväg skickar `expectedUpdatedAt`. | Sista skrivningen vinner, utan varning (avsnitt 3.2). |

---

## 5. Rekommenderad lösning

### 5.1 Princip: härled kategorin, rensa ingen data

En enda delad funktion, samma logik i klient, Edge Functions, SQL och fake-backend:

```
aktiv(ao)        = !deleted && !archived && status ∉ {klar, fakturerad, avbruten}
harPersonal(ao)  = (staff ?? []).length > 0
harDatum(ao)     = !!scheduledDate

poolKategori(ao) =
  !aktiv(ao) || status == 'pågående'   → null            (inte pool; pågående visas som pågående)
  !harPersonal && !harDatum            → 'oppen_pool'
   harPersonal && !harDatum            → 'tilldelad_pool' (visas även i Mina jobb för de tilldelade)
   harDatum                            → 'planerad'       (planeringsvyer; utan personal = "planerad, otilldelad")
```

Statusdimensionen (hur långt ordern har kommit) tolkas så att `nytt`, `pool` och `planerad` alla betyder **"Ej påbörjad"**. Etiketten under kategorin visar sedan *var* ordern ligger. Lagrade statusvärden ändras inte.

**Läsregel för befintliga AO, utan migrering:**

| Lagrat | Tolkas som |
|---|---|
| `pool`, ingen personal, inget datum | Öppen pool |
| `pool`, personal, inget datum | **Tilldelad pool** (inte öppen, och kan inte tas av andra) |
| `pool`, personal, datum | Planerad (tilldelad) |
| `pool`, ingen personal, datum | Se beslut A nedan |
| `planerad` eller `nytt`, personal, inget datum | Tilldelad pool |
| `planerad` eller `nytt`, ingen personal, inget datum | Se beslut A nedan |

### 5.2 Server (först, säkerhetsfix)

1. **`work-orders-list`** (`index.ts:88-91`), **`canViewWorkOrder`** (`vift-auth.ts:130`) och **fake-backend `canViewAO`** (`:126`) ändras till:

   ```
   staff.includes(me) || (ao.status === 'pool' && staff.length === 0)
   ```

   Konsekvens: öppen pool syns för `ao_view_own`. Tilldelad pool syns bara för de tilldelade och för `ao_view_all`. Detta är den minsta ändring som stänger läckan och behåller dagens beteende för öppen pool. Se beslut A om `nytt` utan personal och datum ska räknas in.

2. **SQL-funktionerna** med samma villkor behöver en ny migrering som kör `CREATE OR REPLACE`, med enbart det ändrade villkoret `and jsonb_array_length(coalesce(v_ao->'staff','[]')) = 0`:
   - `work_order_checklist_resolve`
   - checklistans framsteg
   - `work_order_log_append` och `work_order_log_remove`

   Gör ingen annan ändring där. Kör i STAGING först. LIVE kräver Lucas godkännande.

3. **`ao-time-write`, gren B** (`:241-257`):
   - **Neka** när `curStaff.length > 0`. Använd en egen felkod, t.ex. `already_assigned` (409), så att klienten kan säga "Jobbet har redan tagits av …".
   - Kräv också öppen pool enligt den nya regeln, så att den stämmer med punkt 1.
   - Arbetsledare och admin (`ao_edit`) påverkas inte. De tilldelar via dialogen.
   - Låt `staff` vara oförändrad och lägg bara till anroparen. Ändra inte status (se 5.4), eller behåll `planerad` en övergångsperiod för kompatibilitet. Grenens krav på `status:'planerad'` (`:216`) måste i så fall breddas till "staff + log, status utelämnad eller oförändrad".
   - **Samtidighet:** kräv `expectedUpdatedAt` i gren B, och flytta helst kontrollen "staff tom" in i RPC:n under radlåset. Tills det är gjort minskar `expectedUpdatedAt` fönstret, förutsatt att `work_order_patch` jämför under låset (G4, källan saknas och det måste verifieras).

4. **`create_time`**: beslut B. Ska stämpling på AO kräva att anroparen får se AO:n enligt den nya regeln?

### 5.3 Klient

1. **Dialogen "Hantera personal"** (`WorkOrderDetailPage.js:3159-3256`, `WorkOrderService.updateStaff` `:1312-1348`):
   - Ta bort poolrutan ur personaldialogen. Dialogen ska bara ändra `staff` och `responsibleStaffId` och logga `staff_added`, `staff_removed` och `staff_responsible`. Status och datum rörs inte.
   - Om rutan behålls under en övergång: aldrig förikryssad, och den får aldrig rensa vald personal. Betydelsen blir "ta bort datum" (avplanera) och inget annat.
   - Beräkna `added` från **resultatet** (`ao.staff` efter sparning minus före). Skicka notis, push och `staff_assigned` bara då, och helst först efter serverns bekräftelse.
   - Skicka `expectedUpdatedAt` (värdet *före* den lokala ändringen). Vid `stale_write`: ladda om AO:n och visa "Någon annan ändrade personalen. Kontrollera och spara igen."
2. **"Ta bort datum"**: egen åtgärd i rutan "När" och i "Omplanera". Tillåt tomt datum (`:689`) och rensa `scheduledDate`, `scheduledStart` och `scheduledEnd`. Personal och status behålls. Logga posten `schedule_removed`. Det ersätter dagens "flytta till pool".
3. **"Släpp till öppen pool"** (för arbetsledare och admin): kräver uttrycklig bekräftelse som namnger vilka som tas bort. Ta bort personal **och** datum, och logga en `staff_removed`-post per person plus `released_to_pool`. Det här är det enda sättet personal får rensas i poolsammanhang.
4. **"Till pool"**, statusbyte och massändring av status: ett statusbyte ändrar bara status, som i dag. Inför en varning när `pool` väljs på en tilldelad AO, eller ta bort `pool` som valbar status när kategorin är härledd (se 5.4).
5. **"Planera"** (`:467-468`): öppna datumvalet (`openReschedule`) i stället för att sätta `planerad` utan datum.
6. **Mina jobb**:
   - Fliken Arbetspool visar bara `oppen_pool` ("Lediga jobb").
   - "Tilldelade utan datum" finns redan (`:53`, `:192`) och täcker tilldelad pool för den inloggade.
   - Ta bort dubbletterna.
   - Visa "Ta jobbet" bara när servern skulle godkänna, och visa beskedet först efter serverns svar.
7. **AO-lista**: snabbfilter enligt kategori: "Öppen pool", "Tilldelad, oplanerad" och "Otilldelade". En gemensam definition av "Otilldelade" gäller överallt: utan personal och aktiv, med eller utan öppen pool enligt beslut C. Statusfliken "Pool" ersätts av eller kompletteras med kategorierna.
8. **Kalender**: AO med datum ritas på sin dag oavsett status. Under veckan visas två rutor, "Öppen pool" och "Tilldelade, oplanerade" (den sista filtreras av personalfiltret). Gör chipsen dragbara till en dag; drag sätter bara datum.
9. **Dagens drift och dashboard**:
   - Använd samma `poolKategori`.
   - Poolwidgeten räknar bara öppen pool ("väntar på att tas"). En ny eller utökad ruta visar "Tilldelade, oplanerade" för arbetsledare.
   - Fältanvändare får `includeSharedPool` = bara öppen pool.
   - Rätta texten i `Dashboard.js:247-248` och `:1910`.
10. **AO-detalj**: `nextStep` ska bygga på kategorin. Tilldelad pool ger "Tilldelad – välj datum", öppen pool ger "Ligger i öppen pool". Texten i `_execStatus` (`:109`) ska visa kategorin.
11. **Notiser**:
    - Tilldelningsnotis vid alla vägar som *lägger till* personal: dialogen, massändringen, AO som skapas med personal i guide och serviceintervall, och arbetsledare som tilldelar en pool-AO.
    - Vid "Ta jobbet" en valfri notis till ansvarig eller arbetsledare.
    - Ingen notis vid avplanering.
    - Typen `ao_pool` kan användas för "ny AO i öppen pool" om det önskas (beslut D).
12. **Historik**: varje ändring loggas per dimension: personal (`staff_added`/`staff_removed`/`staff_responsible`), planering (`schedule_set`/`schedule_removed`) och status (`work_order_status`). Inget skrivs om och inget tas bort.

### 5.4 Status `pool` på sikt

- **Fas 1:** Behåll lagrade värden. Sluta skapa `pool` + personal:
  - Guiden i pool-läge med personal sparar status `nytt` eller behåller `pool`. Det spelar ingen roll när läsregeln gäller, men undvik det nya.
  - Serviceintervall med `aoStaff`: samma sak.
- **Fas 2:** Om kategorin är härledd överallt kan `pool` lämnas som ett legacyvärde som betyder "Ej påbörjad, släppt till poolen", utan att ändra gamla poster. Nya AO får `nytt` och placeras av `staff`/datum. Detta förutsätter beslut A.

### 5.5 Vad som inte ändras

- Ingen migrering av `vift_workOrders`. Ingen historisk post skrivs om.
- Stämpling, alltså tidsposter (`TimeService`/`create_time`), är en separat dimension och berörs inte, utom eventuellt beslut B.
- `ao_view_all` och `all` ser allt som i dag.

---

## 6. Beroenden mot behörighetsarbetet och ordning

| Arbete | Beroende |
|---|---|
| **B4, urval i aktivitetsloggen** (`BEHORIGHETER-BESLUTSUNDERLAG.md:55-63`) | B4 föreslår "samma urval som `work-orders-list`". Byggs B4 på dagens regel får fältet även andras pool-AO-händelser. **Poolregeln ska alltså rättas före eller samtidigt med B4**, och B4 ska använda samma delade funktion (`canViewWorkOrder`). Grundprincip 3 i underlaget ("egna och delade pool-AO") behöver formuleras om till "egna och öppen pool". |
| **Ö7, uppgifter** (`vift_activities`) | Samma urval som B4, och därmed samma beroende. |
| **Ö2, fältets klarmarkering och `ao_complete`** | "Ta jobbet" kräver i dag `ao_complete` (`ao-time-write/index.ts:214-216`). Beslut behövs om tagning ska följa `ao_complete` eller en egen behörighet (t.ex. `ao_take_pool`), eller räcka med `ao_view_own` + `ao_time`. Begränsad ser i dag poolen men kan inte ta något. |
| **Ö1, "Starta arbete" för tilldelad** | Gren A tillåter start från `pool` när anroparen är tilldelad, och det stämmer med den nya modellen. Ingen konflikt. |
| **"Tilldelad personal kan planera enligt behörighet"** | Fältrollen saknar `ao_edit`, så planering (datum) är spärrad både i klient och på server. Om fältet ska få sätta datum på sin egen tilldelade AO behövs en smal servergren i `patch_ao`: `{scheduledDate, scheduledStart, scheduledEnd}` på en AO där anroparen finns i `staff` (beslut E). |
| **G4** (källa till `work_order_patch` saknas) | Måste lösas för att verifiera konfliktkontrollen i 3.2. |
| **B5 och fältvis sammanslagning** | Inget direkt beroende. |

**Ordning:**

1. Serverfix: läsregel (`work-orders-list`, `canViewWorkOrder`, fake-backend) och gren B, inklusive SQL-funktionerna, i STAGING.
2. Klientfix: dialogen, notiserna och `expectedUpdatedAt`.
3. B4 och Ö7 på den rättade regeln.
4. `poolKategori` i alla vyer.
5. Valfritt: fältets egen planering (beslut E) och avveckling av status `pool` (fas 2).

---

## 7. Testfall

Alla STAGING-tester använder bara poster märkta `[E2E-TEST]`, skapade och borttagna av testet (mönster: `tests/staging/authz-mutation.js:100-101`, borttagning via `e2e-test-cleanup`). Fake-backend måste först få samma regler som den riktiga servern: poolregeln och fältbegränsningen i `patch_ao` från `ao-time-write`.

### 7.1 Server: `work-orders-list` per roll och kategori

Testdata (för den simulerade servern och som `[E2E-TEST]` i STAGING): P1 = `pool`, ingen personal, inget datum. P2 = `pool`, [F2], inget datum. P3 = `pool`, [F2], datum. P4 = `pool`, ingen personal, datum. N1 = `planerad`, [F1], inget datum. N2 = `nytt`, ingen personal, inget datum. F1 och F2 är fältanvändare. L = arbetsledare (`ao_view_all`). B = Begränsad.

| # | Roll | Förväntat | Typ |
|---|---|---|---|
| S1 | F1 | Ser P1, och P4 om beslut A tillåter det, samt N1. Ser **inte** P2 eller P3. | Negativ (läcka) |
| S2 | F2 | Ser P1, P2, P3 (egna) och P4 enligt beslut A. | Positiv |
| S3 | L och admin | Ser allt. | Positiv |
| S4 | B | Samma som F1. | Negativ |
| S5 | F1 | Bild-URL, bilduppladdning, checklista, loggpost och material på P2 ger 403. | Negativ |
| S6 | F1 | N2 enligt beslut A (syns inte med rekommendationen). | Beslut |

### 7.2 Server: "Ta jobbet" (gren B)

| # | Fall | Förväntat |
|---|---|---|
| T1 | F1 tar P1 | 200. `staff=[F1]`, loggposten `taken_from_pool` finns. |
| T2 | F1 tar P2 (tilldelad F2) | **409 `already_assigned`**. Ingen ändring på servern. |
| T3 | F2 tar P2 (redan tilldelad sig själv) | 409, eller 200 utan ändring (definiera). |
| T4 | B tar P1 | 403 (ingen `ao_complete`), eller enligt beslut Ö2. |
| T5 | F1 och F2 tar P1 samtidigt (två parallella anrop med olika nycklar) | Exakt en får 200. Den andra får `already_assigned` eller `stale_write`. Slutläget är `staff` med exakt en person och en enda `taken_from_pool`-post. |
| T6 | F1 tar P1 med inaktuellt `expectedUpdatedAt` | 409 `stale_write`. |
| T7 | F1 skickar `staff` med en annan person än sig själv | 403. |
| T8 | F1 "Starta" på P2 | 403. F2 "Starta" på P2 ger 200 (gren A oförändrad). |

### 7.3 Server: arbetsledarens tilldelning och samtidighet

| # | Fall | Förväntat |
|---|---|---|
| A1 | L1 och L2 ändrar personal på samma AO samtidigt med `expectedUpdatedAt` | En får 200, den andra `stale_write`. Ingen tyst överskrivning. |
| A2 | L avplanerar en tilldelad AO | `staff`, `responsibleStaffId`, `status` och `log` är oförändrade. Datumet är tomt. |

### 7.4 Klient (simulerad server och riktig STAGING)

| # | Fall | Förväntat |
|---|---|---|
| K1 | **Det rapporterade felet:** öppna "Hantera personal" på en pool-AO, välj F1 och spara | `staff=[F1]`. Ingen poolruta, eller en oikryssad ruta som inte rensar. Notis bara till F1. |
| K2 | Ta bort en person i dialogen | `staff_removed` loggas. Ingen notis. Status och datum oförändrade. |
| K3 | "Ta bort datum" på en tilldelad AO | Personal kvar. AO:n syns i Mina jobb under "Tilldelade utan datum" för den tilldelade och i kalenderns ruta "Tilldelade, oplanerade". |
| K4 | Mina jobb för F1 | Fliken Arbetspool visar bara öppen pool. P2 syns inte. Inga dubbletter mellan flikarna. Siffrorna i flikarna stämmer med korten. |
| K5 | Mina jobb, "Ta jobbet" när servern svarar 409 | Felbesked. AO:n ligger kvar, eller försvinner efter uppdatering, med rätt ägare. |
| K6 | Räknare | Dashboardens "Otilldelade" = Dagens drift "Otilldelade" = antal rader i AO-listan med filtret "unassigned". Poolwidgeten = antal i öppen pool. |
| K7 | Kalender | P3 visas på sitt datum. P1 visas i rutan "Öppen pool". N1 visas i "Tilldelade, oplanerade". Personalfiltret påverkar rutan. |
| K8 | AO-detalj för P2 sedd av L | `nextStep` visar "Tilldelad – välj datum", inte "väntar på att någon tar uppdraget". |
| K9 | Bakåtkompatibilitet: ladda testdata med alla kombinationer i avsnitt 8 | Ingen post ändras vid laddning, polling eller rendering. Diffen mot servern är tom. |
| K10 | Notiser | Inga in-app-notiser eller push när personal rensas eller vid avplanering. Notis när personal läggs till på alla vägar som beslutats (beslut D). |

Befintliga tester som måste uppdateras till den nya regeln:

- `tests/e2e/specs/14_permissions.js:57-60`
- `tests/e2e/specs/04_workorders.js:384-389`
- `tests/staging/authz-read.js:62-63`
- `tests/v3_ui_logic.test.js:78` (`nextStep` för pool)
- `tests/e2e/specs/33_falt_pages.js:159-195` (pooldata har `staff: []`, så testet bör hålla, men uppdatera dess urval)

---

## 8. Kompatibilitet med befintliga AO

Ingen riktig data är läst. Avsnittet beskriver bara vilka kombinationer koden kan ha skapat.

**Dimensioner:**

- Status, 7 värden.
- Personal: tom eller satt.
- Datum: tomt eller satt.
- Dessutom `responsibleStaffId`, `archived` och `deleted`.

För aktiva AO med status `nytt`, `pool` eller `planerad` ger det **3 × 2 × 2 = 12 kombinationer**. Alla 12 kan uppstå via koden:

| Status | Personal | Datum | Kan uppstå via |
|---|---|---|---|
| pool | – | – | Guiden i pool-läge, poolflytt på odaterad AO, "Till pool" |
| pool | – | ✓ | Poolflytt på daterad AO (datumet behålls), serviceintervall utan `aoStaff`, "Omplanera" på pool-AO, import |
| pool | ✓ | – | Guiden i pool-läge med personal, "Till pool" eller statusbyte på tilldelad AO, import |
| pool | ✓ | ✓ | **Serviceintervall med `aoStaff`** (klient och cron), statusbyte på planerad AO, import |
| planerad | ✓ | – | **"Ta jobbet"**, tilldelning av pool-AO via dialogen eller massändring, "Planera"-knappen |
| planerad | – | – | "Planera" på otilldelad AO, eller borttagen personal efter planering |
| planerad | ✓/– | ✓ | Normal planering |
| nytt | ✓/– | ✓/– | Fastighetens direktskapande (`PropertyDetailPage.js:1795-1806`), rondering (`RonderingService.js:386`), offert till AO (`PageShells.js:5805`), återkommande (alltid datum, status från schemats standard `nytt`), import |

Dessutom kan `pågående`, `klar`, `fakturerad` och `avbruten` förekomma med alla kombinationer av personal och datum. Kategorin för dem är `null`.

**Läsregeln i 5.1 tar hand om alla kombinationer utan att skriva till någon post.** För historiska AO kan klientens och serverns resultat skilja sig på tre punkter:

- **Fältanvändare ser färre AO än i dag:** andras pool-AO med personal. Det är den avsedda säkerhetsrättningen.
- **`planerad` utan datum** syns nu som "tilldelad, oplanerad" i kalender och dashboard, där de tidigare var osynliga.
- **`pool` + datum** syns på sitt datum i kalendern, i stället för som "ej schemalagd".

Gamla loggposter (`staff_changed` "flyttade ordern till arbetspoolen", `taken_from_pool`) behålls och visas som i dag.

Före införandet: gör en läsande räkning per kombination i STAGING (endast `SELECT`, ingen ändring). Gör samma räkning i LIVE bara med Lucas godkännande. Syftet är att veta hur många fältanvändare som förlorar synlighet till andras pool-AO.

---

## 9. Kräver affärsbeslut

| Nr | Fråga | Rekommendation |
|---|---|---|
| **A** | Räknas en otilldelad, odaterad AO med status `nytt` (eller `planerad`) som **öppen pool** och syns för all fältpersonal? Och en otilldelad `pool`-AO **med datum**, t.ex. serviceintervall med förfallodag: öppen pool eller "planerad, otilldelad"? | För fält: öppen pool = `status 'pool'` **och** ingen personal (datum ignoreras, så att serviceintervall utan personal fortfarande kan tas). `nytt` utan personal visas bara för arbetsledare som "Otilldelade". Det breddar inte serverns utlämning. |
| **B** | Får fältet stämpla in på en AO som hen inte är tilldelad, t.ex. en öppen pool-AO, utan att först ta den? | Nej. Kräv tilldelning, alternativt gör "Ta jobbet" automatiskt vid instämpling. |
| **C** | Ska räknaren "Otilldelade" inkludera öppen pool? | Nej. "Otilldelade" = utan personal och inte i öppen pool. Samma definition överallt. |
| **D** | Notiser: tilldelningsnotis även när AO skapas med personal (guide, serviceintervall, återkommande)? Notis till arbetsledare när någon tar ett jobb? Notis "nytt i poolen"? | Ja, ja och valfritt. |
| **E** | Får tilldelad fältpersonal själv sätta eller ändra datum på sin egen AO ("planera enligt behörighet")? | Om ja: ny smal servergren eller behörighet (`ao_plan_own`). Annars bara arbetsledare. |
| **F** | Vilken behörighet krävs för "Ta jobbet": `ao_complete` som i dag, `ao_time` eller en ny? | Koppla till Ö2. Föreslås: `ao_view_own` + `ao_time`. |
| **G** | Ska status `pool` avvecklas för nya AO (fas 2)? | Ja, när den härledda kategorin används överallt. Gamla värden lämnas orörda. |

---

## Sammanfattning och rekommendation

Felet i "Hantera personal" beror på en förikryssad poolruta som tömmer personalen. Det är dock ett symptom på ett större problem: tilldelning, planering och status är sammanflätade i statusvärdet `pool`. Allvarligast är att servern (`work-orders-list` och `canViewWorkOrder` med tre SQL-funktioner) lämnar ut **varje** AO med status `pool` till all fältpersonal, även när andra är tilldelade. Systemet skapar sådana AO självt, särskilt via serviceintervall. "Ta jobbet" kan dessutom lägga till sig på en redan tilldelad AO och saknar skydd mot samtidiga tagningar.

**Rekommendation, i ordning:**

1. Serverregeln blir "eget eller (`pool` och ingen personal)", överallt inklusive fake-backend. "Ta jobbet" nekas när personal finns och kräver `expectedUpdatedAt`.
2. Personaldialogen rör bara personal. "Ta bort datum" och "Släpp till öppen pool" blir egna, loggade åtgärder. Notiser bygger på faktiskt resultat.
3. En gemensam `poolKategori` (öppen pool, tilldelad pool, planerad) från personal och datum används i Mina jobb, AO-listan, kalendern, Dagens drift och dashboarden.
4. B4 och Ö7 byggs på den rättade regeln.

Ingen historisk data ändras. Status `pool` tolkas vid läsning. Beslut A–G (främst A, E och F) behövs innan steg 3 kan slutföras. Steg 1 och 2 kan göras utan beslut.
