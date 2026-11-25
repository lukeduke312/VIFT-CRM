# VIFT CRM – behörighetsmatris för nästa säkerhetsomgång

2026-11-26. Underlag för beslut och implementation. **Ingen kod, ingen databas och ingen Edge Function är ändrad.** Allt nedan bygger på källkod (klient i `VIFT-CRM`, server i `vift-v2/supabase`) och tidigare QA-dokument. LIVE är inte läst.

**Utgångsdokument:**
- `BEHORIGHETER-BESLUTSUNDERLAG.md` (B1–B5, Ö1–Ö10)
- `SAKERHET-DEL10.md`
- `KVARSTAENDE-PROBLEM.md`
- `../qa-2026-11-25/C5-LASBEHORIGHET.md`

Testplanen för omgången finns i `SAKERHETSPROVNING-TESTPLAN.md`.

**Beslutad inriktning (användaren), sammanfattad:**

| Nr | Beslut |
|---|---|
| B1 | Inköpspriser, marginaler och intern ekonomi bara för särskilt behöriga roller. Fältet registrerar material utan att se inköpspris. Fritextmaterial ska gå. Okänt inköpspris är inte 0 kr: det markeras som okänt och kan kompletteras av en behörig roll. |
| B2 | Försäljningspriser behålls där de behövs i arbetet. Reglerna samordnas med Ö4 (timpris i fältets tidposter och i stämpla-ut), så att försäljningspris, timpris och intern personalkostnad inte motsäger varandra. |
| B3 | Fältet ser namn, titel och nödvändiga kontaktuppgifter. Inte andras behörigheter, inte skyddade personaluppgifter. |
| B4 | Fältet ser bara händelser för egna eller tilldelade uppdrag. Inga ovidkommande offerter, fakturor eller ekonomiuppgifter. |
| B5 | Portkod och nyckelinformation skyddas på servern. Servern slår ihop fält för fält, så att en användare aldrig kan skriva över ett skyddat fält som hen saknar rätt att ändra. |
| Övrigt | Tilldelad fältpersonal får starta och klarmarkera egna tilldelade AO, men inte attestera, fakturera eller ändra skyddade ekonomifält. Egen smal behörighet för att utföra tilldelade ronderingar. Uppgifter filtreras på servern. Standardrollerna definieras korrekt. Sista superadmin skyddas. Intern kommentar hamnar aldrig på kundens faktura-PDF. |
| Arbetspool | Öppen pool (otilldelad) kan tas av behörig fältpersonal. Tilldelad men oplanerad AO får inte tas eller ses av annan fältpersonal. Utreds parallellt. |

**Notation i matrisen:**

| Tecken | Betydelse |
|---|---|
| **S** | Läsa och skriva (skapa, ändra, ta bort) |
| **L** | Läsa hela posten |
| **Lp** | Läsa projicerat: servern tar bort de skyddade fälten innan svaret skickas |
| **egen** | Bara poster där användaren själv är tilldelad, skapare eller ägare (anges per rad) |
| **–** | Ingen åtkomst. Servern lämnar inte ut något, och skrivning nekas. |
| **(B)** | Kräver affärsbeslut, se avsnitt 4 |
| ⚠ | Nuläget i STAGING avviker från målet |

**Verkställande** anger *var* regeln måste sitta för att räknas som skydd:

| Lager | Var | Kommentar |
|---|---|---|
| **RLS** | Policyn `store_read_by_role` och RLS på `store` | Gäller direkt REST |
| **PROJ** | Funktionen `vift_store_project()` | Används av `readAllWithHashes` och `readWithHash` |
| **EF** | Edge Function, med namn | Den enda skrivvägen eller läsvägen för nyckeln |
| **RPC** | SQL-funktion som EF:en anropar under radlås | |
| **KLIENT** | Bara presentation | **Räknas aldrig som skydd** |

---

## 1. Förslag på standardroller

### 1.1 Nya behörigheter som föreslås

Fältrollens arbete kan inte uttryckas säkert med dagens behörigheter.

**`ao_complete` är för bred.** Den styr i dag tre saker i `ao-time-write` (`patch_ao`):
- klarmarkering;
- "Starta";
- "Ta jobbet".

Klarmarkeringen kontrolleras inte mot tilldelning (se F1 i avsnitt 5).

**`ao_view_own` styr både egna AO och hela poolen.** Det sker via `canViewWorkOrder()` i `_shared/vift-auth.ts` och via `work-orders-list`.

| Ny behörighet | Betydelse | Var den kontrolleras | Ersätter eller avgränsar |
|---|---|---|---|
| `ao_start_own` | Sätta egen tilldelad AO till `pågående` | `ao-time-write` `patch_ao`, gren A (finns, men villkoras i dag av `ao_complete`) | Del av `ao_complete` |
| `ao_complete_own` | Sätta egen tilldelad AO till `klar` (bara från `nytt`, `planerad` eller `pågående`) | `ao-time-write` `patch_ao`: ny kontroll av tilldelning och källstatus | Del av `ao_complete` |
| `ao_pool_take` | Se och ta **öppen** pool (`status = pool` och tom `staff`) | `work-orders-list` (urval), `ao-time-write` gren B, `canViewWorkOrder()` | Del av `ao_view_own` |
| `rondering_utfor` | Se och utföra ronderingspass som är tilldelade en själv | `rondering-pass-write` (källa saknas, G4), läsprojektion av `vift_ronderingspass` | Ö3. Ersätter `ao_view_all` på utförandesidan |
| `cost_view` | Se inköpspris, intern timkostnad, marginal och TB | PROJ: `vift_articles.buyPrice`, `vift_settings.internalHourlyCost`, `materials[].buyPrice` i `work-orders-list` | B1 |
| `cost_edit` | Komplettera eller ändra inköpspris på materialrad och artikel | `ao-time-write` (materialväg), `store-key-write` (`vift_articles`) | B1, "okänt inköpspris" |
| `export_personal_data` (B) | Exportera personnummer och org.nr för privatpersoner | KLIENT (Exportcenter), plus att servern bara lämnar ut till rätt roll (PROJ) | Observation O1 |

**Tolkning av befintlig `ao_complete` efter införandet:** "Klarmarkera **valfri** AO" för arbetsledare. Rollen ska ha `ao_view_all`, och servern ska kräva `ao_view_all` eller `ao_edit` för att `ao_complete` ska gälla andras AO.

**Migrering:** Befintliga roller som har `ao_complete` men saknar `ao_view_all` och `ao_edit` (STAGING:s fältroll) får i stället `ao_start_own`, `ao_complete_own` och `ao_pool_take`. Det kräver beslut D-03.

### 1.2 Standardroller

Rollernas **id** föreslås följa det som klienten och personalregistret redan använder:
- `admin`, `chef`, `personal` och `ekonomi` (seed, `PageShells.js` StaffPage, `Schema.staff().role = 'personal'`);
- ny `begransad`.

Etiketten för `chef` blir "Arbetsledare". Då behöver inga personalposter migreras (beslut D-02).

| Behörighet | Administratör `admin` | Arbetsledare `chef` | Ekonomi `ekonomi` | Fält/personal `personal` | Begränsad/extern `begransad` |
|---|---|---|---|---|---|
| `all` | ✔ | | | | |
| `dashboard_view` | (all) | ✔ | ✔ | ✔ | ✔ |
| `ao_view_all` | (all) | ✔ | ✔ | | |
| `ao_view_own` | (all) | ✔ | | ✔ | ✔ |
| `ao_pool_take` (ny) | (all) | ✔ | | ✔ | (B) D-04 |
| `ao_create`, `ao_edit` | (all) | ✔ | | | |
| `ao_complete` (valfri AO) | (all) | ✔ | | | |
| `ao_start_own`, `ao_complete_own` (nya) | (all) | ✔ | | ✔ | (B) D-04 |
| `ao_time` | (all) | ✔ | | ✔ | (B) |
| `ao_material` | (all) | ✔ | | ✔ | |
| `ao_checklist` | (all) | ✔ | | ✔ | (B) |
| `rondering_utfor` (ny) | (all) | ✔ | | ✔ | |
| `customer_manage` | (all) | ✔ | | | |
| `customer_view` | (all) | (ingår via manage) | ✔ (B) | | |
| `offer_manage` | (all) | ✔ | | | |
| `sales_manage` | (all) | ✔ | | | |
| `recurring_manage` | (all) | ✔ (B, seed har den, underlaget inte) | | | |
| `invoice_view` | (all) | (B) D-07 | ✔ | | |
| `invoice_create` | (all) | (B) D-07 | ✔ | | |
| `reports_view` | (all) | | ✔ | | |
| `payroll_view` | (all) | | ✔ (B) D-08 | | |
| `payroll_manage` | (all) | | ✔ (B) D-08 | | |
| `cost_view` (ny) | (all) | (B) D-01 | ✔ | | |
| `cost_edit` (ny) | (all) | (B) D-01 | ✔ (B) | | |
| `staff_view` | (all) | ✔ | | | |
| `staff_manage` | (all) | | | | |
| `admin_manage` | (all) | | | | |
| `article_manage` | (all) | | (B) | | |
| `objects_sensitive` | (all) | (B) D-05 | | | |
| `export_personal_data` (ny, B) | (all) | (B) | (B) | | |

**Krav på rollregistret** (P1 #8 i problemlistan):
- Rollerna ovan ska finnas i `vift_roles` i STAGING och, efter beslut, i LIVE.
- Klientens reserv i `Auth._resolveUser()` (`AuthService.js:379`) sätter roll `'personal'` när ingen personalpost matchar e-posten. **När `personal` finns i registret ger den reserven fältbehörigheter i klienten.** Servern nekar fortfarande (`checkViftAuth` → 403). Reserven måste därför bytas till ett roll-id som inte finns (t.ex. `'okand'`) **innan** `personal` definieras (F7).

---

## 2. Behörighetsmatris

Kolumnerna Admin, Arbetsledare (AL), Ekonomi (EK), Fält (FÄ) och Begränsad (BE) anger **målet** enligt beslutad inriktning. "Nu" anger STAGING-läget enligt källkoden.

### 2.1 Arbetsordrar och arbetspool

| # | Resurs/fält | Admin | AL | EK | FÄ | BE | Verkställs | Nu (STAGING) | Test |
|---|---|---|---|---|---|---|---|---|---|
| R01 | AO egna/tilldelade (`staff` innehåller användaren) | S | S | L | L egen | L egen | EF `work-orders-list` (urval), `ao-time-write` (skriv) | Som målet | SEC-AO-01…04 |
| R02 | AO andras (ej tilldelade, ej pool) | S | S | L | – | – | EF `work-orders-list` + `canViewWorkOrder()` i alla AO-EF:er | Läsning som målet. ⚠ **Skrivning:** `patch_ao` med bara `ao_complete` kontrollerar inte tilldelning (F1) | SEC-AO-05…08 |
| R03 | Öppen pool (`status=pool`, tom `staff`): se | L | L | L | L (`ao_pool_take`) | – (B) | EF `work-orders-list` | ⚠ Alla med `ao_view_own` ser hela poolen, även begränsad | SEC-POOL-01…03 |
| R04 | Öppen pool: ta jobbet | S | S | – | S (`ao_pool_take`), bara sig själv | – | EF `ao-time-write` gren B | ⚠ Kräver i dag `ao_complete` (inte en poolbehörighet). Sig själv: som målet. | SEC-POOL-04…07 |
| R05 | Tilldelad men oplanerad AO (tilldelad, inget datum, eller `status=pool` med `staff` satt) | S | S | L | L bara om tilldelad | L bara om tilldelad | EF `work-orders-list` (urval), `ao-time-write` gren B | ⚠ `status=pool` visas för **alla** med `ao_view_own` oavsett `staff` (`work-orders-list/index.ts:90`), och gren B låter en annan fältarbetare lägga till sig själv (`ao-time-write/index.ts:244-257`) (F4) | SEC-POOL-08…11 |
| R06 | Starta egen AO (→ `pågående`) | S | S | – | S egen | (B) | EF `ao-time-write` gren A | Som målet för tilldelad. Villkoras av `ao_complete` (F15). | SEC-AO-09…11 |
| R07 | Klarmarkera AO (→ `klar`) | S | S (valfri) | – | S egen (`ao_complete_own`) | (B) | EF `ao-time-write`. Kontroll av tilldelning och källstatus. | ⚠ Valfri AO, valfri källstatus, även `fakturerad` → `klar`; `completedBy` sätts fritt (F1) | SEC-AO-12…16 |
| R08 | Attest, `fakturerad`, `invoiceId`, arkivera, radera | S | S (`ao_edit`) | (B) G9 | – | – | EF `ao-time-write` (`patch_ao`, `delete_ao`, `permanent_delete_ao`), `invoice-write` (källa saknas) | Fält och begränsad nekas (bara fältlistan `AO_COMPLETE_ONLY_FIELDS`). Ekonomi utan `ao_edit` nekas. | SEC-AO-17…20 |
| R09 | AO-ekonomi: `priceType`, `fixedPrice`, `priceGroupId`, TB/täckning | S | S (pris), L (TB, B) | L | – (B) D-06 | – | Skriv: EF `ao-time-write` (`ao_edit`). Läs: ⚠ PROJ saknas | ⚠ `fixedPrice` och prisuppgifter skickas till tilldelad fältpersonal. Klienten döljer dem (`_pricingCard` kräver `invoice_*`/`reports_view`). | SEC-AO-21…23 |
| R10 | AO portkod `accessCode` | L | L (B) D-05 | – | L egen tilldelad, via EF med revisionslogg (B) | – | EF `work-orders-list` (redigering) + `get-sensitive-fields` | Bara `objects_sensitive`/`ao_edit` får fältet. Fält får **inte** portkod alls: `get-sensitive-fields` kräver `objects_sensitive` och har ingen tilldelningsväg (F3). | SEC-B5-10…13 |

### 2.2 Material och priser (B1, B2, Ö4)

| # | Resurs/fält | Admin | AL | EK | FÄ | BE | Verkställs | Nu (STAGING) | Test |
|---|---|---|---|---|---|---|---|---|---|
| R11 | Registrera materialrad (artikel + antal, eller fritext) på egen AO | S | S | – | S egen | – | EF `ao-time-write` (materialväg). Servern slår upp pris från artikel-id. | Patchen ersätter hela `materials`-arrayen. Fält kan ändra och ta bort **andras** rader och deras priser. Pool-AO är tillåtna (F2). | SEC-B1-01…06 |
| R12 | Materialrad inköpspris (`materials[].buyPrice`): läsa | L | (B) D-01 | L | – | – | PROJ i `work-orders-list` (ny) | ⚠ Skickas till fält. Klienten döljer i raden, men **artikelväljaren visar "Ink: … kr" för alla** (`WorkOrderDetailPage.js:2053`). | SEC-B1-07…09 |
| R13 | Materialrad inköpspris: sätta eller komplettera okänt | S | (B) D-01 | S (`cost_edit`) | – | – | EF `ao-time-write`. Servern sätter `buyPrice` från artikel eller `null` + `buyPriceUnknown: true`. | ⚠ Klienten sätter `buyPrice: … \|\| 0` (`WorkOrderDetailPage.js:2248`), så okänt blir 0 kr. Fält kan skicka valfritt inköpspris. | SEC-B1-10…14 |
| R14 | Materialrad försäljningspris (`sellPrice`): läsa | L | L | L | (B) D-09 | – | PROJ i `work-orders-list` | Skickas till fält. Klienten visar det bara med `invoice_*`/`reports_view`, utom i artikelväljaren. | SEC-B2-01…03 |
| R15 | Materialrad försäljningspris: ändra | S | S | S (B) | – (servern sätter från artikeln; fritext: (B) D-10) | – | EF `ao-time-write` | ⚠ Fält kan sätta valfritt `sellPrice` | SEC-B2-04…05 |
| R16 | Artikelregister `vift_articles.buyPrice` | S | (B) | L | – | – | PROJ + RLS (ny nyckelregel) | ⚠ Alla aktiva läser (`else true`, `20261125000003…:93`) | SEC-B1-15…18 |
| R17 | Artikelregister: namn, enhet, försäljningspris | S | L | L | L (D-09) | – | PROJ | Alla aktiva läser | SEC-B1-19 |
| R18 | Prisgrupper `vift_priceGroups.hourRate` (försäljning) | S | L | L | L (B2: behålls) eller – enligt D-11 | – | PROJ | Alla aktiva läser | SEC-B2-06…07 |
| R19 | Timpris i tidpost (`timeEntries[].hourRate`, `priceGroupName`), Ö4 | L | L | L | – i egna tidposter och i stämpla-ut (D-11) | – | EF `time-entries-list` (projektion) + `ao-time-write` (servern sätter timpris) | ⚠ Fält ser timpris i egna tidposter, i stämpla-ut och i AO-detaljens tidrader (`WorkOrderDetailPage.js:1633`) | SEC-B2-08…11 |
| R20 | Intern timkostnad `vift_settings.internalHourlyCost` | S | (B) D-01 | L (`cost_view`) | – | – | PROJ (`vift_settings`) | ⚠ Full läsning även för `ao_view_all`, `ao_edit` och `offer_manage`, alltså arbetsledare (`20261125000003…:89`) | SEC-INST-03…05 |

### 2.3 Tid, fakturering, offerter, kunder

| # | Resurs/fält | Admin | AL | EK | FÄ | BE | Verkställs | Nu (STAGING) | Test |
|---|---|---|---|---|---|---|---|---|---|
| R21 | Tidposter egna | S | S | (B) | S egen (ej attesterade) | (B) | EF `time-entries-list` + `ao-time-write` (RPC kontrollerar ägare) | Som målet. Tid på AO som användaren inte ser är inte prövat (F16). | SEC-TID-01…05 |
| R22 | Tidposter andras, attest | S | (B) D-08 | S (`payroll_*`) | – | – | EF `time-entries-list` (`payroll_view`), `ao-time-write` `attest_time` (`payroll_manage`) | Som målet | SEC-TID-06…09 |
| R23 | Fakturaunderlag `vift_invoices` | S | L (B) D-07 | S | – | – | RLS + PROJ. Skriv: EF `invoice-write` (källa saknas, G4). | L för `invoice_*`, `reports_view`, `ao_view_all` och `ao_edit`. Fält och begränsad: inget. | SEC-FAKT-01…05 |
| R24 | Faktura: intern kommentar och kundsynlig kommentar | S | L | S | – | – | PDF-generering (klient `InvoicesPage.js:2223` och/eller server) | ⚠ `inv.note` skrivs ut på PDF:en. Det finns inget separat internt fält (P1 #3). | SEC-FAKT-06…08 |
| R25 | Offerter, belopp och rader | S | S | Lp (utan token, interna fält) | – (D-12: i dag stubb för **alla** offerter) | – | RLS + PROJ | ⚠ Fält och begränsad får id, titel, status och kund för **alla** offerter (F9) | SEC-OFF-01…04 |
| R26 | Offerttoken, kundgodkännande, låst kundversion, intern anteckning | S | S (`offer_manage`) | – | – | – | RLS + PROJ. Publik väg: `offer-token-validate`, `offer-respond`. | Som målet (C-5) | SEC-OFF-05…08 |
| R27 | Kunder: namn, adress, kontakt | S | S | L | Lp egen (B) D-13 | Lp egen (B) | PROJ | Fält och begränsad läser **alla** kunder (utan personnummer) | SEC-KUND-01…03 |
| R28 | Kunder: personnummer, org.nr för privatperson | S | L | L (ROT/RUT) | – | – | PROJ + RLS | Full läsning för `customer_manage`, `invoice_*`, `offer_manage`, `sales_manage` och `ao_view_all` | SEC-KUND-04…07 |

### 2.4 Personal, roller, logg, uppgifter

| # | Resurs/fält | Admin | AL | EK | FÄ | BE | Verkställs | Nu (STAGING) | Test |
|---|---|---|---|---|---|---|---|---|---|
| R29 | Personal: namn, titel, telefon | S | L | L | L | L (B) | PROJ | Alla läser | SEC-B3-01…02 |
| R30 | Personal: e-post | S | L | L | L **bara egen post** + (B) D-14 | L egen | PROJ. Den egna posten måste behålla `email`, eftersom `Auth._resolveUser` matchar på den (F10). | Alla läser | SEC-B3-03…05 |
| R31 | Personal: `permissions`, `role` (andras) | S | L (`staff_view`) | – | – (egen roll: L) | – | PROJ | ⚠ Alla läser | SEC-B3-06…08 |
| R32 | Personal: skriva roll eller aktiv-flagga | S | – | – | – | – | EF `store-key-write` + ny fältregel för `role` och `active` (bara `all`/`admin_manage`) | ⚠ `staff_manage` kan sätta vilken roll som helst, även på sig själv: eskalering (F5) | SEC-ROLL-01…04 |
| R33 | Roller `vift_roles` och sista superadmin | S (aldrig 0 aktiva med `all`) | L (egen) | L (egen) | L (egen) | L (egen) | EF `store-key-write`, invariant "≥1 aktiv personal med `all`" | ⚠ Inget skydd (P1 #4) | SEC-ROLL-05…10 |
| R34 | Aktivitetslogg `vift_activityLog` | L | L | L | L egen/tilldelad AO | L egen/tilldelad AO | PROJ per post (samma urval som `work-orders-list`). Append via `store-key-write` `appendActivity`. | ⚠ Alla läser alla 500 poster (F-B4) | SEC-B4-01…08 |
| R35 | Uppgifter `vift_activities`: egna (`assignedTo`/`createdBy` = jag) | S | S | S | S (regler i `activities-policy.ts`) | S | EF `store-key-write` (`activities-policy.ts`). Läs: PROJ per post (ny). | Skrivning som målet | SEC-TASK-01…06 |
| R36 | Uppgifter andras | S | S | (B) D-15 | – | – | PROJ per post (ny) | ⚠ **Alla läser alla.** Fältets Uppgifter-sida visar andras (O2). | SEC-TASK-07…12 |

### 2.5 Portkoder, ronderingar, inställningar, export

| # | Resurs/fält | Admin | AL | EK | FÄ | BE | Verkställs | Nu (STAGING) | Test |
|---|---|---|---|---|---|---|---|---|---|
| R37 | Objekt: `doorCode`, `keyInformation`, `accessInformation` (`vift_propertyObjects`) | S | S (fält för fält) + L enligt D-05 | – | – | – | PROJ + RLS + **fältvis sammanslagning i `store-key-write`** (B5) | ⚠ Skrivare (`customer_manage`) får fullt värde. Klienten döljer. | SEC-B5-01…09 |
| R38 | `property_sensitive_access` (tabell) | S | (B) D-05 | – | L egen tilldelad AO (B) | – | EF `get-sensitive-fields` / `set-sensitive-fields` + `sensitive_access_audit` | Bara `objects_sensitive`/`all`. Ingen tilldelningsväg (F3). **Två lagringsplatser** för samma uppgift (F3, D-16). | SEC-B5-10…16 |
| R39 | `vift_recurringOrders.accessCode` | S | S (fält för fält) | – | – | – | PROJ + fältvis sammanslagning | Skrivare (`recurring_manage`) får fullt värde | SEC-B5-17…18 |
| R40 | Ronderingspass tilldelade: se och utföra | S | S | – | S egen (`rondering_utfor`) | – | EF `rondering-pass-write` (källa saknas, G4) + PROJ `vift_ronderingspass` | ⚠ Sidorna kräver `ao_view_all`. Fält kan inte utföra. `vift_ronderingspass` läses av alla. | SEC-ROND-01…05 |
| R41 | Ronderingar andra, mallar, scheman, avvikelser | S | S | L (B) | – | – | `store-key-write` (`ao_view_all`) + PROJ | Skriv kräver `ao_view_all`, läs: alla | SEC-ROND-06…08 |
| R42 | `vift_settings`: bankgiro | S | (B) D-17 | L | – | – | PROJ + RLS. Skriv: `store-key-write` `write` (hel nyckel, `admin_manage`). | Full läsning för `admin_manage`, `invoice_*`, `reports_view`, `offer_manage`, `ao_view_all` och `ao_edit`. Hel nyckel skrivs på en gång (P1 #5). | SEC-INST-01…02, 06…10 |
| R43 | `vift_settings`: övrigt (varumärke, villkor) | S | L | L | Lp | Lp | PROJ | Som målet | SEC-INST-11 |
| R44 | Export: register | Alla | enligt läsrätt | enligt läsrätt | (B) D-18 | – | KLIENT (`EXPORT_PERMISSIONS`). Det verkliga skyddet är att servern bara lämnar ut det rollen får läsa. | Snabbexport på listsidor saknar egen spärr (F12) | SEC-EXP-01…05 |
| R45 | Export: portkod, nyckelinfo, lösenord | Bara aktivt val | Bara aktivt val (B) D-05 | – | – | – | KLIENT `sensitiveFields` + PROJ | Av som standard, kräver `objects_sensitive` | SEC-EXP-06…08 |
| R46 | Export: personnummer, org.nr för privatperson | Aktivt val (`export_personal_data`) | (B) | (B) | – | – | KLIENT + PROJ | ⚠ **Förvalt ikryssat** i Exportcenter och alltid med i snabbexport (O1) | SEC-EXP-09…13 |
| R47 | Lokal cache (`localStorage vift_*`) efter utloggning eller kontobyte | – | – | – | – | – | KLIENT (`Auth._clearSession`) | ⚠ Bara tidposter och AO rensas. Övriga nycklar ligger kvar och används vid nätfel (F6). | SEC-CACHE-01…04 |

---

## 3. Testfall per rad

**ID-format:** `SEC-<grupp>-NN`. Kolumnen ± anger positivt (+, ska lyckas) eller negativt (−, ska nekas). L = läsning, S = skrivning, R = radering.

**Gemensamma villkor för alla skrivtester:**
- Bara [E2E-TEST]-poster.
- Journal, återställning och kontrollsummor enligt testplanen.
- Ett negativt skrivtest är godkänt bara om servern svarar 401, 403, 400 `key_not_allowlisted` eller 409 med *samma* hash före och efter.

**Roller:** ADM, AL, EK, FÄ, FÄ2 (andra fältkonto) och BE.

### 3.1 Arbetsordrar (R01–R10)

| ID | ± | Roll | Typ | Åtgärd | Förväntat |
|---|---|---|---|---|---|
| SEC-AO-01 | + | FÄ | L | `work-orders-list` | Bara AO där FÄ är i `staff`, plus öppen pool om `ao_pool_take` |
| SEC-AO-02 | − | BE | L | `work-orders-list` | Inga AO där BE inte är tilldelad, och ingen pool (D-04) |
| SEC-AO-03 | − | FÄ | L | REST `GET store?key=eq.vift_workOrders` och `readWithHash vift_workOrders` | Tomt / `key_not_allowlisted`, inga data |
| SEC-AO-04 | + | AL, EK | L | `work-orders-list` | Alla AO (antal = ADM) |
| SEC-AO-05 | − | FÄ | S | `patch_ao` `{status:'klar'}` på test-AO där FÄ **inte** är tilldelad | 403 (i dag troligen 200, F1) |
| SEC-AO-06 | − | FÄ | S | `patch_ao` `{materials}` på test-AO där FÄ inte är tilldelad | 403 |
| SEC-AO-07 | − | FÄ | S | `create_time` med `aoId` för en AO FÄ inte ser | 403 (F16, i dag okänt) |
| SEC-AO-08 | − | FÄ | L | `work-order-image-url`, `work-order-checklist-resolve` på andras AO | 403 |
| SEC-AO-09 | + | FÄ | S | `patch_ao {status:'pågående'}` på egen test-AO (`planerad`) | 200, status `pågående` |
| SEC-AO-10 | − | FÄ | S | Samma på AO där FÄ inte är tilldelad | 403 |
| SEC-AO-11 | − | FÄ | S | `{status:'pågående', title:'x'}` på egen | 403, hela patchen nekas |
| SEC-AO-12 | + | FÄ | S | `{status:'klar', completedAt, completedBy:FÄ}` på egen `pågående` | 200 |
| SEC-AO-13 | − | FÄ | S | `{status:'klar'}` på egen AO med status `fakturerad` | 403 (i dag 200, F1) |
| SEC-AO-14 | − | FÄ | S | `{status:'klar', completedBy:<annan>}` | 403 eller servern sätter `completedBy` = FÄ |
| SEC-AO-15 | − | FÄ | S | `{status:'avbruten'}` / `{status:'fakturerad'}` på egen | 403 |
| SEC-AO-16 | + | AL | S | `{status:'klar'}` på valfri test-AO | 200 |
| SEC-AO-17 | − | EK | S | `{status:'fakturerad'}` (G9) | 403 om D-07 inte ger EK `ao_edit` |
| SEC-AO-18 | − | FÄ, BE | S | `delete_ao`, `permanent_delete_ao` på egen test-AO | 403 |
| SEC-AO-19 | − | FÄ | S | `{invoiceId:'X'}`, `{archived:true}` | 403 |
| SEC-AO-20 | + | AL | S, R | `delete_ao` och sedan `permanent_delete_ao` på test-AO | 200 |
| SEC-AO-21 | − | FÄ | L | `work-orders-list`: `fixedPrice`, `priceGroupId`, `materials[].buyPrice` i egen AO | Saknas efter beslut D-06 (i dag finns de) |
| SEC-AO-22 | − | FÄ | S | `{fixedPrice:1}`, `{priceType:'fast'}` på egen | 403 |
| SEC-AO-23 | + | EK | L | AO-ekonomi (pris, TB) | Finns |

### 3.2 Arbetspool (R03–R05)

| ID | ± | Roll | Typ | Åtgärd | Förväntat |
|---|---|---|---|---|---|
| SEC-POOL-01 | + | FÄ | L | Test-AO med `status:pool`, `staff:[]` | Syns för FÄ och FÄ2 |
| SEC-POOL-02 | − | BE | L | Samma | Syns inte (D-04) |
| SEC-POOL-03 | − | EK | L | Samma | Syns (`ao_view_all`), men kan inte ta den (SEC-POOL-07) |
| SEC-POOL-04 | + | FÄ | S | Ta jobbet (`staff:[FÄ]`, `status:'planerad'`, logg + `taken_from_pool`) | 200. Därefter syns AO:n inte för FÄ2. |
| SEC-POOL-05 | − | FÄ | S | Ta jobbet med `staff:[FÄ2]` (lägga till annan) | 403 |
| SEC-POOL-06 | − | FÄ, FÄ2 | S | Samtidigt "ta jobbet" på samma AO | Exakt en lyckas, den andra får 409 `stale_write` eller 403. `staff` innehåller en person. |
| SEC-POOL-07 | − | EK, BE | S | Ta jobbet | 403 |
| SEC-POOL-08 | − | FÄ2 | L | Test-AO tilldelad FÄ, utan datum, `status:'planerad'` | Syns inte för FÄ2 |
| SEC-POOL-09 | − | FÄ2 | L | Test-AO `status:'pool'` med `staff:[FÄ]` (tilldelad pool) | Syns inte (i dag syns den, F4) |
| SEC-POOL-10 | − | FÄ2 | S | Ta jobbet på AO enligt SEC-POOL-09 | 403 (i dag 200, F4) |
| SEC-POOL-11 | − | FÄ2 | S | Material, bild och checklista på AO enligt SEC-POOL-09 | 403 (`canViewWorkOrder` släpper i dag igenom pool) |

### 3.3 B1: inköpspris, material, marginal (R11–R17, R20)

| ID | ± | Roll | Typ | Åtgärd | Förväntat |
|---|---|---|---|---|---|
| SEC-B1-01 | + | FÄ | S | Materialrad med artikel-id + antal på egen AO, utan priser i begäran | 200. Servern sätter `sellPrice` och `buyPrice` från artikeln. |
| SEC-B1-02 | + | FÄ | S | Fritextrad (benämning, antal, enhet), inget pris | 200. `buyPrice` = null och `buyPriceUnknown: true` (aldrig 0). `sellPrice` enligt D-10. |
| SEC-B1-03 | − | FÄ | S | Materialrad med `buyPrice: 1` i begäran | Fältet ignoreras eller avvisas. Lagrat värde = artikelns värde eller okänt. |
| SEC-B1-04 | − | FÄ | S, R | Ta bort eller ändra **annans** materialrad på egen AO | Enligt D-19: 403, eller tillåtet med logg |
| SEC-B1-05 | − | FÄ | S | Ersätta hela `materials` med tom lista på AO med fem rader | 403 eller 409. Ingen tyst massradering. |
| SEC-B1-06 | − | FÄ | S | Material på fakturerad, arkiverad eller borttagen AO | 403 (finns i dag) |
| SEC-B1-07 | − | FÄ, BE | L | `readAllWithHashes`: `articles[].buyPrice` | Fältet saknas |
| SEC-B1-08 | − | FÄ | L | `work-orders-list`: `materials[].buyPrice` | Fältet saknas |
| SEC-B1-09 | − | FÄ | L (UI) | Materialdialogens artikelväljare | Ingen "Ink:"-text och inget Ink-pris-fält |
| SEC-B1-10 | + | EK (`cost_edit`) | S | Komplettera `buyPrice` på rad med `buyPriceUnknown` | 200. Flaggan tas bort. Logg. |
| SEC-B1-11 | − | FÄ | S | Samma | 403 |
| SEC-B1-12 | − | AL | S | Samma | Enligt D-01 |
| SEC-B1-13 | + | EK | L | AO med okänt inköpspris: TB och marginal | Visas som "okänt" eller ofullständigt, **inte** med 0 kr i inköp |
| SEC-B1-14 | + | EK | L | Rapport och fakturakö med okänt inköpspris | Raden markeras. Inga summor tolkas som 0. |
| SEC-B1-15 | − | FÄ, BE | L | REST `GET store?key=eq.vift_articles` | Raden lämnas inte ut (RLS), eller bara via EF projicerat |
| SEC-B1-16 | + | ADM | L | `vift_articles` | `buyPrice` finns |
| SEC-B1-17 | − | AL | L | `vift_articles.buyPrice` | Enligt D-01 |
| SEC-B1-18 | − | FÄ | S | `writeMerge vift_articles` (befintlig artikel, ändrat pris) | 403 |
| SEC-B1-19 | + | FÄ | L | Artikelnamn, enhet (+ försäljningspris enligt D-09) | Finns |

### 3.4 B2 och Ö4: försäljningspris och timpris (R14, R15, R18, R19)

| ID | ± | Roll | Typ | Åtgärd | Förväntat |
|---|---|---|---|---|---|
| SEC-B2-01 | + | AL, EK | L | `materials[].sellPrice` | Finns |
| SEC-B2-02 | ± | FÄ | L | `materials[].sellPrice` | Enligt D-09 |
| SEC-B2-03 | ± | FÄ | L (UI) | Materialraden och artikelväljaren | Enligt D-09, och samma regel i båda vyerna |
| SEC-B2-04 | − | FÄ | S | Materialrad med `sellPrice` ≠ artikelns | Servern använder artikelns pris |
| SEC-B2-05 | + | AL | S | Justera `sellPrice` på rad | 200 |
| SEC-B2-06 | ± | FÄ | L | `priceGroups[].hourRate` | Enligt D-11 |
| SEC-B2-07 | − | FÄ | S | `writeMerge vift_priceGroups` | 403 |
| SEC-B2-08 | ± | FÄ | L | `time-entries-list`: `hourRate`, `priceGroupName` i egna poster | Enligt D-11 (Ö4-förslaget: saknas) |
| SEC-B2-09 | − | FÄ | S | `create_time` med `hourRate: 9999` | Servern sätter timpriset från AO:ns prisgrupp. Klientens värde ignoreras. |
| SEC-B2-10 | ± | FÄ | L (UI) | Stämpla-ut-dialogen, Tid-sidans prisgruppsval, AO-detaljens tidrader | Samma regel som SEC-B2-08 i alla tre |
| SEC-B2-11 | + | EK | L | Löneunderlag: "debiterbart värde" (timpris) skilt från intern kostnad | Etiketterna motsäger inte varandra |

### 3.5 Tid och fakturering (R21–R24)

| ID | ± | Roll | Typ | Åtgärd | Förväntat |
|---|---|---|---|---|---|
| SEC-TID-01 | + | FÄ | S | `create_time` på egen test-AO | 200. `staffId` = FÄ, satt av servern. |
| SEC-TID-02 | − | FÄ | S | `create_time` med `staffId` = FÄ2 | 403 |
| SEC-TID-03 | − | FÄ | S | `patch_time` på FÄ2:s testpost | 403 |
| SEC-TID-04 | − | FÄ | S | `patch_time` på egen **attesterad** testpost | 409 `attested_locked` |
| SEC-TID-05 | − | FÄ | S | `patch_time {attested:true}` | Attestfälten ignoreras |
| SEC-TID-06 | − | FÄ, BE, AL | L | `time-entries-list` | Bara egna poster (AL enligt D-08) |
| SEC-TID-07 | + | EK | L | `time-entries-list` | Alla (`payroll_view`) |
| SEC-TID-08 | − | FÄ, AL | S | `attest_time` | 403 |
| SEC-TID-09 | + | EK | S | `attest_time` på testpost, sedan återställ | 200 |
| SEC-FAKT-01 | − | FÄ, BE | L | `readAllWithHashes` `invoices`, REST `vift_invoices` | Tomt eller inget |
| SEC-FAKT-02 | + | EK | L | Samma | Finns |
| SEC-FAKT-03 | ± | AL | L | Samma | Enligt D-07 |
| SEC-FAKT-04 | − | alla | S | `writeMerge vift_invoices` | 400 `key_not_allowlisted` |
| SEC-FAKT-05 | − | FÄ, AL | S | `invoice-write` (alla åtgärder) | 403. Källan saknas (G4), så testet kan inte konstrueras förrän källan finns. |
| SEC-FAKT-06 | + | EK | S | Fakturaunderlag med intern kommentar "[E2E-TEST] INTERN" och kundkommentar "[E2E-TEST] KUND" → PDF | PDF:en innehåller KUND, **inte** INTERN |
| SEC-FAKT-07 | − | – | – | Äldre underlag med bara `note` | Beslut D-20: tolkas som internt eller kundsynligt. Testet följer beslutet. |
| SEC-FAKT-08 | − | FÄ | L | Intern kommentar i någon läsväg | Saknas |

### 3.6 Offerter och kunder (R25–R28)

| ID | ± | Roll | Typ | Åtgärd | Förväntat |
|---|---|---|---|---|---|
| SEC-OFF-01 | − | FÄ, BE | L | `offers` | Enligt D-12: bara offerter kopplade till egen AO, eller inga |
| SEC-OFF-02 | − | FÄ, BE | L | `offers[].lines`, belopp | Saknas (finns i C-5) |
| SEC-OFF-03 | + | EK | L | `offers[].lines` | Finns, utan `calculationNote`/`inputValues`/`priceRuleRef` |
| SEC-OFF-04 | − | FÄ, EK | S | `writeMerge vift_offers` (befintlig testoffert) | 403 |
| SEC-OFF-05 | − | EK, FÄ, BE | L | `publicToken`, `token*`, `customerApproval`, `lockedSnapshotJSON`, `internalNote` | Saknas (C-5) |
| SEC-OFF-06 | − | FÄ | L | `offerEvents`, `offerAttachments`, `offer-attachment-url` | Tomt eller 403 |
| SEC-OFF-07 | − | oinloggad | S | `offer-respond` med ogiltig eller utgången token | 4xx, ingen ändring |
| SEC-OFF-08 | − | FÄ | S | `offer-pdf`, `send-offer-email` | 403 |
| SEC-KUND-01 | ± | FÄ | L | `customers` | Enligt D-13 (alla utan personnummer, eller bara kunder på egna AO) |
| SEC-KUND-02 | − | FÄ, EK | S | `writeMerge vift_customers` (befintlig testkund) | 403 |
| SEC-KUND-03 | − | FÄ | R | `writeMerge` med `removals` (testkund) | 403 |
| SEC-KUND-04 | − | FÄ, BE | L | `customers[].personnr` + `orgNr` för typen privat | Saknas |
| SEC-KUND-05 | + | EK | L | Samma | Finns (ROT/RUT) |
| SEC-KUND-06 | ± | AL (`sales_manage`/`ao_view_all`) | L | Samma | Enligt D-13 |
| SEC-KUND-07 | − | FÄ | L | REST `vift_customers` | Raden lämnas inte ut |

### 3.7 B3: personal och roller (R29–R33)

| ID | ± | Roll | Typ | Åtgärd | Förväntat |
|---|---|---|---|---|---|
| SEC-B3-01 | + | FÄ | L | `staff[]`: förnamn, efternamn, titel, telefon | Finns |
| SEC-B3-02 | + | FÄ | L (UI) | Tilldelningslistor, kontaktkort | Fungerar |
| SEC-B3-03 | + | FÄ | L | Egen post innehåller `email`, och inloggningen löser rätt användare | Ja (F10) |
| SEC-B3-04 | ± | FÄ | L | Andras `email` | Enligt D-14 |
| SEC-B3-05 | − | BE | L | Andras telefon och e-post | Enligt D-14 |
| SEC-B3-06 | − | FÄ, BE, EK | L | Andras `permissions` och `role` i `staff[]` | Saknas |
| SEC-B3-07 | − | FÄ | L | `vift_roles` | Bara den egna rollen, eller alla roller utan behörighetslistor (D-21) |
| SEC-B3-08 | − | FÄ | S | `writeMerge vift_staff` (ändra egen titel) | 403 |
| SEC-ROLL-01 | − | roll med `staff_manage` utan `admin_manage` | S | Sätta egen `role:'admin'` | 403 (i dag tillåtet, F5) |
| SEC-ROLL-02 | − | samma | S | Sätta annans roll till en roll med `all` | 403 |
| SEC-ROLL-03 | + | ADM | S | Ändra testpersonalens roll mellan `personal` och `chef` | 200 |
| SEC-ROLL-04 | − | AL | S | `writeMerge vift_staff` | 403 |
| SEC-ROLL-05 | − | ADM (enda aktiva med `all` i testscenariot) | S | Inaktivera sig själv | 409 eller 403 `last_superadmin` |
| SEC-ROLL-06 | − | ADM | S | Ta bort `all` från rollen `admin` när den är den enda rollen med `all` | Nekas |
| SEC-ROLL-07 | − | ADM | R | Radera rollen `admin` | Nekas |
| SEC-ROLL-08 | − | ADM | S | Byta egen roll till `chef` när ingen annan har `all` | Nekas |
| SEC-ROLL-09 | + | ADM | S | Inaktivera **annan** admin när minst en aktiv admin finns kvar | 200 |
| SEC-ROLL-10 | − | ADM, ADM2 | S | Två admins inaktiverar varandra samtidigt | Högst en lyckas. Minst en aktiv med `all` finns kvar. |

> SEC-ROLL-05…10 kan **inte** köras säkert mot STAGING:s riktiga admin. De kräver en lokal Postgres- eller grenmiljö med egna testadmins (se testplanen, steg T2). Mot STAGING körs bara varianten där testkontot är den roll som prövas och en annan riktig admin finns kvar.

### 3.8 B4 och Ö7: aktivitetslogg och uppgifter (R34–R36)

| ID | ± | Roll | Typ | Åtgärd | Förväntat |
|---|---|---|---|---|---|
| SEC-B4-01 | + | AL, EK, ADM | L | `activityLog` | Alla poster |
| SEC-B4-02 | + | FÄ | L | `activityLog` | Bara poster vars `workOrderId` är en AO som FÄ ser enligt `work-orders-list` |
| SEC-B4-03 | − | FÄ | L | Poster med `offerId`/`invoiceId`/`salesOpportunityId` utan egen AO | Saknas |
| SEC-B4-04 | − | FÄ | L | Poster utan `workOrderId` (kund, offert, personal) | Saknas |
| SEC-B4-05 | − | FÄ, BE | L | REST `vift_activityLog` | Raden lämnas inte ut |
| SEC-B4-06 | − | alla | S | `write`/`writeMerge vift_activityLog` | 403 `append_only` |
| SEC-B4-07 | ± | FÄ | S | `appendActivity` med typen `invoice_created` och ett främmande `invoiceId` | Enligt D-22 (i dag 200, märkt `klientrapport`) |
| SEC-B4-08 | + | FÄ | L (UI) | Dashboardens "Senaste händelser" och AO-detaljens historik | Bara egna, utan fel |
| SEC-TASK-01 | + | FÄ | S | Skapa egen uppgift (`createdBy` = `assignedTo` = FÄ) | 200 |
| SEC-TASK-02 | − | FÄ | S | Skapa uppgift med `assignedTo` = FÄ2 | 403 `new_not_own` |
| SEC-TASK-03 | + | FÄ | S | Klarmarkera uppgift tilldelad FÄ, skapad av AL | 200. Bara fälten i `ASSIGNEE_FIELDS` ändras. |
| SEC-TASK-04 | − | FÄ | S | Ändra titel på uppgift tilldelad FÄ, skapad av AL | 403 `field_title` |
| SEC-TASK-05 | − | FÄ | R | Radera uppgift tilldelad FÄ, skapad av AL | 403 |
| SEC-TASK-06 | + | FÄ | R | Radera egen uppgift | 200 |
| SEC-TASK-07 | − | FÄ | L | `activities`: uppgift med `assignedTo` = FÄ2 och `createdBy` = AL | **Saknas** (i dag syns den, O2) |
| SEC-TASK-08 | − | FÄ | L | Uppgift kopplad till offert (`relatedType: offer`) som inte är FÄ:s | Saknas |
| SEC-TASK-09 | − | FÄ | S | Klarmarkera FÄ2:s uppgift | 403 `not_own` |
| SEC-TASK-10 | + | AL (`ao_edit` + `ao_view_all`) | S | Ändra FÄ:s uppgift | 200 |
| SEC-TASK-11 | ± | EK (`ao_view_all` utan `ao_edit`) | S | Ändra annans uppgift | Enligt D-15. Klient och server ska ge samma svar (F8). |
| SEC-TASK-12 | − | FÄ | L (UI) | Uppgifter-sidan, filtren "Alla öppna", "Offerter" och "Arbetsorder" | Visar bara egna och tilldelade |

### 3.9 B5: portkod och nyckelinfo (R10, R37–R39)

| ID | ± | Roll | Typ | Åtgärd | Förväntat |
|---|---|---|---|---|---|
| SEC-B5-01 | − | AL utan `objects_sensitive` | L | `readAllWithHashes` `propertyObjects[].doorCode` | Saknas (i dag finns fältet, eftersom AL är skrivare) |
| SEC-B5-02 | + | AL | S | `writeMerge vift_propertyObjects`: ändra namn på testobjekt **utan** `doorCode` i elementet | 200. Lagrat `doorCode`, `keyInformation` och `accessInformation` är oförändrade. |
| SEC-B5-03 | − | AL utan `objects_sensitive` | S | Samma, men med `doorCode:''` | Fältet ignoreras eller ger 403. Lagrat värde är oförändrat. |
| SEC-B5-04 | − | AL utan `objects_sensitive` | S | Samma, men med `doorCode:'1234'` | 403 eller ignoreras. Lagrat värde är oförändrat. |
| SEC-B5-05 | − | AL utan `objects_sensitive` | R | Ta bort testobjekt | Enligt D-23. Den känsliga tabellraden får aldrig bli föräldralös utan logg. |
| SEC-B5-06 | + | ADM | S | Ändra `doorCode` på testobjekt | 200. Logg i `sensitive_access_audit`. |
| SEC-B5-07 | − | ADM + AL samtidigt | S | ADM ändrar `doorCode`, AL ändrar namn på samma objekt i samma sekund | Båda ändringarna finns kvar. Den ena får 409 och gör om, eller så slås fälten ihop. `doorCode` är ADM:s värde. |
| SEC-B5-08 | − | AL (gammal klient), ADM | S | AL har läst objektet före ADM:s ändring av `doorCode` och sparar sedan namn | `doorCode` är fortfarande ADM:s nya värde, inte det gamla |
| SEC-B5-09 | − | FÄ | S | `writeMerge vift_propertyObjects` | 403 |
| SEC-B5-10 | − | FÄ | L | `work-orders-list` `accessCode` | Saknas |
| SEC-B5-11 | ± | FÄ | L | `get-sensitive-fields` för objekt på **egen** tilldelad AO | Enligt D-05/D-16: 200 + revisionslogg (ny väg), eller 403 (i dag) |
| SEC-B5-12 | − | FÄ | L | `get-sensitive-fields` för objekt på **annans** AO | 403 + logg `denied` |
| SEC-B5-13 | + | ADM | L | `get-sensitive-fields` | 200, revisionsrad `allowed` med fälttyper, **utan värden** |
| SEC-B5-14 | − | AL, EK, FÄ | S | `set-sensitive-fields` | 403 + logg `denied` |
| SEC-B5-15 | − | FÄ | L | REST `property_sensitive_access`, `sensitive_access_audit` | Inga rader |
| SEC-B5-16 | − | alla | S | Ändra eller radera rader i `sensitive_access_audit` | Nekas (bara `service_role` skriver, oföränderlig) |
| SEC-B5-17 | − | AL utan `objects_sensitive` | L | `recurringOrders[].accessCode` | Saknas efter B5 |
| SEC-B5-18 | + | AL | S | Ändra titel på återkommande testärende utan `accessCode` | Lagrat `accessCode` är oförändrat |

### 3.10 Rondering (R40–R41)

| ID | ± | Roll | Typ | Åtgärd | Förväntat |
|---|---|---|---|---|---|
| SEC-ROND-01 | + | FÄ (`rondering_utfor`) | L | Ronderingspass tilldelat FÄ | Syns, och sidan Utför rondering öppnas |
| SEC-ROND-02 | − | FÄ | L | Pass tilldelat FÄ2 | Syns inte |
| SEC-ROND-03 | + | FÄ | S | Klarmarkera punkt eller skapa avvikelse i eget testpass | 200 |
| SEC-ROND-04 | − | FÄ | S | Samma i FÄ2:s pass | 403 |
| SEC-ROND-05 | − | FÄ | S | Skapa pass, mall eller schema | 403 |
| SEC-ROND-06 | − | FÄ, EK | S | `writeMerge vift_ronderingar`/`ronderingsmallar`/`avvikelser` | 403 |
| SEC-ROND-07 | + | AL | S | Skapa och ta bort testmall | 200 |
| SEC-ROND-08 | − | BE | L | `ronderingspass` | Tomt |

### 3.11 Inställningar (R20, R42–R43): hela nyckeln och samtidighet

| ID | ± | Roll | Typ | Åtgärd | Förväntat |
|---|---|---|---|---|---|
| SEC-INST-01 | − | FÄ, BE | L | `settings.bankgiro` | Saknas |
| SEC-INST-02 | ± | AL | L | `settings.bankgiro` | Enligt D-17 |
| SEC-INST-03 | − | FÄ, BE | L | `settings.internalHourlyCost` | Saknas |
| SEC-INST-04 | ± | AL | L | `settings.internalHourlyCost` | Enligt D-01 |
| SEC-INST-05 | + | EK | L | Samma | Finns |
| SEC-INST-06 | − | AL, EK, FÄ | S | `write vift_settings` med aktuell hash, oförändrat innehåll | 403 (kräver `admin_manage`) |
| SEC-INST-07 | − | ADM | S | `write vift_settings` utan `expectedHash` | 409 `missing_expected_hash` |
| SEC-INST-08 | − | ADM | S | `write` med inaktuell hash | 409 `stale_write` |
| SEC-INST-09 | − | ADM + ADM2 | S | Samtidigt: ADM ändrar testnyckeln `e2eTestA`, ADM2 ändrar `e2eTestB` | Efter B5-mekanismen finns båda. I dag: en får 409 och ingenting skrivs över tyst. |
| SEC-INST-10 | − | ADM | S | `write` av projicerat värde (utan `bankgiro`) | `bankgiro` är oförändrat (fältvis sammanslagning) |
| SEC-INST-11 | + | FÄ | L | Varumärke, färger, villkor | Finns |

> Skrivtest på `vift_settings` får bara ändra en **egen testnyckel** (`e2eTest_<runId>`) i objektet och ta bort den igen. Befintliga inställningar rörs aldrig. Se testplanen §4.

### 3.12 Export och lokal cache (R44–R47)

| ID | ± | Roll | Typ | Åtgärd | Förväntat |
|---|---|---|---|---|---|
| SEC-EXP-01 | + | ADM | L | Exportcenter: alla register finns | Ja |
| SEC-EXP-02 | − | FÄ | L | Exportcenter | "Inga exporterbara register", eller enligt D-18 |
| SEC-EXP-03 | − | FÄ | L | Snabbexport på AO-listan | Bara egna och tilldelade AO, utan `accessCode` och utan prisfält |
| SEC-EXP-04 | − | FÄ | L | Snabbexport `materialRow` (via konsolen) | Inga `buyPrice`-värden (servern skickar dem inte) |
| SEC-EXP-05 | + | EK | L | Export av tidposter | Alla (`payroll_view`) |
| SEC-EXP-06 | − | AL utan `objects_sensitive` | L | Export av objekt: portkod | Kolumnen finns inte och värdena saknas (efter B5) |
| SEC-EXP-07 | + | ADM | L | Export av objekt med "Inkludera känsliga fält" | Portkod finns. Utan kryss finns den inte. |
| SEC-EXP-08 | − | alla | L | Export av personal: `password`/`passwordHash`/`permissions` | Finns aldrig |
| SEC-EXP-09 | − | ADM | L (UI) | Exportcenter, register Kunder, startläge | Personnummer är **inte** ikryssat (O1) |
| SEC-EXP-10 | − | ADM | L | Snabbexport av kunder (CSV/XLSX) | Personnummer finns inte, utan aktivt val |
| SEC-EXP-11 | − | roll med `customer_view` utan full kundläsning | L | Snabbexport av kunder | Kolumnen Personnummer är tom eller saknas |
| SEC-EXP-12 | ± | EK/AL med `sales_manage`/`ao_view_all` | L | Export av personnummer | Enligt D-13/D-18 |
| SEC-EXP-13 | + | ADM | L | Export med aktivt val av personnummer | Finns. Exporten loggas (D-18). |
| SEC-CACHE-01 | − | ADM loggar ut, FÄ loggar in på samma webbläsare | L | `localStorage` efter utloggning | Inga `vift_customers`/`vift_offers`/`vift_settings`/`vift_propertyObjects`/`vift_invoices` med ADM:s fullständiga värden (F6) |
| SEC-CACHE-02 | − | FÄ, nätet avstängt efter inloggning | L | Degraderad inloggning (`state._degradedLoad`) | Ingen data från föregående användare |
| SEC-CACHE-03 | + | FÄ loggar in igen | L | Normal inloggning efter rensning | Fungerar |
| SEC-CACHE-04 | − | ADM byter konto i annan flik | L | Lyssnaren för flikbyte | Samma rensning som vid utloggning |

---

## 4. Återstående affärsbeslut och motsägelser

Dessa måste avgöras **innan** serverändringarna i nästa omgång skrivs. Varje punkt anger motsägelsen eller frågan, och ett förslag.

| Nr | Fråga / motsägelse | Varför den måste avgöras | Förslag |
|---|---|---|---|
| **D-01** | **Är arbetsledaren "särskilt behörig" för inköpspris, marginal och intern timkostnad?** C-5 ger i dag full läsning av `vift_settings` (inkl. `internalHourlyCost`) till `ao_view_all`, `ao_edit` och `offer_manage`, alltså arbetsledare. Exportcenter ger `materialRow` med "Inpris" till `ao_view_all`. B1 säger "endast särskilt behöriga roller". | Avgör projektionen av `vift_settings`, `vift_articles`, `materials[].buyPrice` och exporten | Ny `cost_view`. Ekonomi och admin får den. Arbetsledaren bara om hen kalkylerar offerter. **Vem får komplettera okänt inköpspris?** Förslag: `cost_edit` = Ekonomi (+ admin), inte fält och inte automatiskt arbetsledare. |
| **D-02** | Rollernas id: `chef` eller `arbetsledare`? | Befintliga personalposter har `role:'chef'`/`'personal'`. Nytt id kräver migrering av personalposter. | Behåll id `chef`, etikett "Arbetsledare". Inför `begransad`. |
| **D-03** | Ska befintliga roller med `ao_complete` men utan `ao_view_all` och `ao_edit` (STAGING:s fältroll) migreras till `ao_start_own` + `ao_complete_own` + `ao_pool_take`? Ö2 är inte besvarad. | Den fältroll som finns i dag kan klarmarkera *valfri* AO (F1). Avgör också om fältet får klarmarkera alls (Ö2). | Ja, fältet får klarmarkera egna. Servern begränsar `ao_complete` för roller utan `ao_view_all` till egna AO redan i övergången. |
| **D-04** | Ska Begränsad/extern se och ta öppen pool, starta och klarmarkera, och registrera tid och checklista? | I dag ser alla med `ao_view_own` hela poolen. Underlagets Begränsad-roll har bara `ao_view_own`. | Begränsad: bara egna tilldelade AO, ingen pool. Tid och checklista efter verksamhetens behov. |
| **D-05** | **Ska arbetsledare utan `objects_sensitive` se portkod?** Ska fält se portkod för egen tilldelad AO? Underlaget säger att fält får portkod via `get-sensitive-fields`, men EF:en kräver `objects_sensitive` och har ingen tilldelningsväg (F3). | Avgör B5-projektionen och om `get-sensitive-fields` behöver en ny tilldelningsgren | AL utan `objects_sensitive`: nej, aldrig i data. Fält: ja, bara för AO där hen är tilldelad och status inte är `klar`/`fakturerad`, varje uttag loggat. Ny gren i `get-sensitive-fields` som kontrollerar mot `work-orders-list`-regeln. |
| **D-06** | Ska tilldelad fältpersonal få AO:ns `fixedPrice`, prismodell och prisgrupp i data? C-5 lämnar dem medvetet ut. B4 säger "ingen ovidkommande ekonomi". | Avgör om `work-orders-list` ska projicera bort pris för fält | Projicera bort `fixedPrice`, `priceGroupId`, `materials[].buyPrice` och (beroende på D-09) `sellPrice` för roller utan `invoice_*`/`reports_view`/`ao_edit`/`cost_view`. |
| **D-07** | Ska arbetsledaren läsa och skapa fakturaunderlag? Seedens `chef` har `invoice_view` och `invoice_create`. Underlagets Arbetsledare har det inte, men C-5 ger fakturaläsning till `ao_view_all`/`ao_edit`. Får ekonomi sätta AO till `fakturerad` (G9)? | Motsägelse mellan seed, underlag och C-5. Avgör SEC-FAKT-03 och SEC-AO-17. | Arbetsledare: läsa ja, skapa (B). Fakturering sker bara via `invoice-write`, aldrig via `patch_ao status`. |
| **D-08** | Lönebehörighet: har Ekonomi `payroll_view`/`payroll_manage` (seed ja, underlag nej)? Ska arbetsledaren se sitt teams tidposter? | `time-entries-list` ger allt eller bara egna. Det finns inget teamurval. | Ekonomi: ja. Arbetsledare: bara egna, eller nytt teamurval (kräver serverstöd). |
| **D-09** | **Ska fält se försäljningspris på material?** B2: "behåll försäljningspriser där operativt nödvändigt". Klienten döljer i dag priset för fält i materialraden men visar det i artikelväljaren. | Motsägelse inom klienten. Avgör PROJ för `articles.sellPrice` och `materials[].sellPrice`. | Nej, fältet behöver inte priset. Servern sätter det. Visas det ändå (t.ex. för att fält säljer på plats) ska det gälla **både** artikelväljaren och raden. |
| **D-10** | Fritextmaterial: vem sätter försäljningspriset? Fält kan i dag ange valfritt `sellPrice`. | Okänt försäljningspris ger ett fakturaunderlag med fel belopp | Fritext från fält får `sellPrice` = okänt och flaggan "pris saknas". Fakturakön stoppar tills behörig sätter pris. Samma princip som okänt inköpspris. |
| **D-11** | **Ö4 mot B2:** B2 säger att timpriser (försäljning) inte är känsliga. Ö4 föreslår att timpriset döljs i fältets egna tidposter och i stämpla-ut. Löneunderlaget visade tidigare timpris som "lönekostnad" (rättad etikett). | Utan beslut blir regeln olika i prisgruppsregistret, tidposten, stämpla-ut och AO-detaljen | **En regel:** fält ser *inte* timpris någonstans (inte i prisgruppsregistret, i tidposter, i stämpla-ut eller i AO-detaljen). Prisgrupp väljs av servern från AO. Försäljningstimpris är fortfarande "inte känsligt" i den meningen att det står på offerter till kund och inte kräver revisionslogg. Intern personalkostnad (`internalHourlyCost`) är alltid `cost_view`. Om fält ska välja prisgrupp själv (t.ex. jour) visas bara namnet. |
| **D-12** | Ska fält och begränsad få offertstubbar? I dag får de id, titel, status och kund för **alla** offerter. | B4: "inga ovidkommande offerter" | Bara offerter med `workOrderId` som är en AO användaren ser. Annars tomt. |
| **D-13** | Kundregistret för fält: alla kunder (utan personnummer) eller bara kunder på egna AO? Vilka interna roller får personnummer (i dag även `sales_manage` och `ao_view_all`)? | Dataminimering. Avgör exportfrågan (O1). | Fält: bara kunder och fastigheter på egna AO (samma urval). Personnummer: `customer_manage` och `invoice_*` (ROT/RUT). `sales_manage`/`ao_view_all` får inte personnummer. |
| **D-14** | B3: vilka kontaktuppgifter är "nödvändiga"? Underlaget föreslår att `email` projiceras bort, men klienten kräver egen e-post (`Auth._resolveUser`, F10). | Projektion per post (egen post fullständig) | Fält: namn, titel och telefon för alla. Egen post fullständig. E-post till andra bara med `staff_view`. |
| **D-15** | Uppgifter: får Ekonomi (`ao_view_all` utan `ao_edit`) ändra andras uppgifter? Klienten säger ja (`PageShells.js:11861`), servern nej (`activities-policy.ts`). | Motsägelse klient/server (F8) | Följ servern. Rätta klienten. |
| **D-16** | Portkod finns på **två** platser: i store-bloben (`vift_propertyObjects.doorCode`, `workOrders.accessCode`, `recurringOrders.accessCode`) och i tabellen `property_sensitive_access`. Vilken är sanningskällan? | B5 blir dubbelt arbete, och en kopia kan läcka. CLAUDE.md beskriver tabellen som platsen för känsliga fält. | Tabellen är sanningskälla. Bloben töms (engångsmigrering med backup) eller fälten projiceras alltid bort. Kräver eget beslut och backup. |
| **D-17** | Bankgiro: vilka roller? C-5 ger fullt värde till `offer_manage`/`ao_view_all`/`ao_edit`. | Bankgiro står på fakturor och syns där. Låg känslighet men ändringskritiskt. | Läsning för de interna rollerna är ok. Skrivning bara `admin_manage`, fält för fält (P1 #5). |
| **D-18** | **Exportbehörighet:** Ska export kräva mer än läsrätt? Ska snabbexporten på listsidor följa samma `EXPORT_PERMISSIONS` som Exportcenter? Ska export av personnummer kräva ett aktivt val, egen behörighet och loggning? | O1, F12 | Ja till alla tre. Snabbexport och Exportcenter använder samma spärr. Personnummer räknas som känsligt fält (av som standard), med egen behörighet `export_personal_data`. Exporthändelsen skrivs i aktivitetsloggen. |
| **D-19** | Får fältpersonal ändra eller ta bort *andras* materialrader på samma AO? | `materials` skrivs som hel array (F2) | Bara egna rader (`addedBy`). Andras rader kan bara arbetsledaren ändra. Kräver radvis materialväg på servern (`add_material`/`remove_material`), inte hel array. |
| **D-20** | Intern kommentar på faktura: befintligt `inv.note` skrivs ut. Ska det fältet bli "kundsynlig kommentar" och ett nytt `internalNote` införas, eller tvärtom? | Historiska underlag har text i `note` som någon kan ha trott var intern | `note` = kundsynlig (oförändrat beteende). Nytt `internalNote` skrivs aldrig ut. Äldre underlag gås igenom manuellt före LIVE. |
| **D-21** | Rollregistret `vift_roles`: läser alla alla roller med behörighetslistor? Klienten behöver den egna rollens behörigheter. | B3, "inte andras behörighetslistor" | Projicera `vift_roles` till den egna rollen för roller utan `staff_view`/`admin_manage`. |
| **D-22** | `appendActivity`: får vem som helst rapportera vilken händelsetyp som helst (t.ex. `invoice_created` från fält)? | Med B4-filtrering kan förfalskade poster med ett främmande `workOrderId` nå andra | Tillåtna typer per behörighet (t.ex. `invoice_*` bara med `invoice_create`). Referenser kontrolleras mot `canViewWorkOrder`. |
| **D-23** | Radering av objekt eller fastighet med känsliga fält: vad händer med raden i `property_sensitive_access`? | Föräldralösa portkoder | Raderas i samma transaktion, med revisionsrad. |
| **D-24** | Arbetspoolens dataregel: är "tilldelad men oplanerad" `status=nytt/planerad` utan datum, eller `status=pool` med `staff` satt? Klienten tömmer `staff` när en AO flyttas till poolen (`WorkOrderService.updateStaff`), men import och `ao_edit` kan skapa `pool` med `staff`. | `work-orders-list` och gren B behandlar `status=pool` som öppen oavsett `staff` (F4) | Öppen pool = `status=pool` **och** tom `staff`. Servern behandlar `pool` med `staff` som tilldelad. `ao_edit` får inte spara `pool` med `staff`, eller sparar då `planerad`. |
| **D-25** | Är `admin_manage` i praktiken superadmin? Den kan skriva `vift_roles` och ge sin egen roll `all`. | Påverkar skyddet för sista superadmin och eskaleringsskyddet | Bara `all` får lägga till eller ta bort `all` i en roll och tilldela en roll som har `all`. |
| **D-26** | Testkonton: STAGING:s ekonomikonto (`qa_p2_avgransad`) har `customer_manage`/`offer_manage`, alltså inte den föreslagna Ekonomi-rollen. | G13-utfallet (36/36) speglar testkontots roll, inte standardrollen | Skapa testkonton med exakt standardrollerna (`e2e_*`) innan nästa körning. Avvecklas efteråt (Ö9). |

---

## 5. Fynd i källkoden som påverkar matrisen

De här fynden kom fram vid genomgången för det här dokumentet. Inget är ändrat. Allvarsgraden följer problemlistans skala.

| Nr | Fynd | Kodreferens | Allvar |
|---|---|---|---|
| F1 | `patch_ao` för roll med `ao_complete` men utan `ao_edit` kontrollerar bara vilka fält som skickas, inte att anroparen är tilldelad eller ser AO:n, och inte AO:ns nuvarande status. En fältarbetare kan klarmarka *vilken AO som helst* via id, även `fakturerad` → `klar`. `completedBy` kan anges fritt. | `vift-v2/supabase/functions/ao-time-write/index.ts:259-265` (jämför gren A/B på rad 223-257 som kontrollerar tilldelning) | **P1** (integritet) |
| F2 | Materialvägen för `ao_material` ersätter hela `materials`. Fält kan ändra pris och ta bort andras rader. `buyPrice`/`sellPrice` kommer från klienten. Pool-AO räknas som synlig. | `ao-time-write/index.ts:199-213`; `WorkOrderDetailPage.js:2053` (Ink-pris i artikelväljaren), `:2084`, `:2248` (`\|\| 0`) | **P1** (B1) |
| F3 | `get-sensitive-fields` kräver `objects_sensitive`. Det finns ingen väg för "tilldelad AO". Portkoder ligger dessutom både i store-bloben och i tabellen. | `get-sensitive-fields/index.ts:87`; `20261125000003_store_read_by_role.sql` (projektion av `vift_propertyObjects`) | P2 (beslut D-05/D-16) |
| F4 | Poolregeln är bara `status === 'pool'`, oavsett `staff`. "Ta jobbet" tillåter att man lägger till sig själv på en pool-AO som redan har personal. | `work-orders-list/index.ts:90`; `ao-time-write/index.ts:244-257`; `_shared/vift-auth.ts` `canViewWorkOrder` | P1 om pool med `staff` förekommer (D-24) |
| F5 | `vift_staff` skrivs med `staff_manage` utan regel för fältet `role`. Den som har `staff_manage` kan ge sig själv rollen `admin`. Inget skydd för sista superadmin. | `store-key-write/index.ts:89` (KEY_PERMISSIONS), `:240-276` (`writeMerge` utan fältregel) | **P1** när någon roll har `staff_manage` utan `all` (ingen standardroll har det i dag) |
| F6 | Utloggning rensar bara tidposter och AO ur `localStorage`. Kunder, offerter, inställningar, objekt och fakturor från föregående användare ligger kvar och används av `Storage._localAll()` vid degraderad inläsning. | `AuthService.js:628-650` (`_clearSession`); `state.js:983` | **P2** (delad surfplatta) |
| F7 | Klientens reserv när ingen personalpost matchar: `role:'personal'`. När `personal` finns i registret får en okänd inloggning fältmenyer i klienten (servern nekar). | `AuthService.js:379` | P3, men måste rättas **före** P1 #8 |
| F8 | Uppgifter: klientens regler (`ao_edit \|\| ao_view_all` för att ändra, `ao_edit \|\| admin_manage` för att radera) skiljer sig från serverns (`admin_manage \|\| (ao_edit && ao_view_all)`). | `PageShells.js:11861-11869`; `store-key-write/activities-policy.ts` `activitiesFullAccess` | P3 |
| F9 | Fält och begränsad får stubbar (titel, kund, status) för alla offerter | `20261125000003_store_read_by_role.sql`, `vift_store_project`, grenen `offer_stub` | P2 (B4) |
| F10 | B3-förslaget att projicera bort `email` bryter inloggningen, som matchar `state.staff[].email` i klienten | `AuthService.js:366-372` | Krav på implementationen |
| F11 | `appendActivity` godtar alla tillåtna typer och referenser från alla aktiva användare | `store-key-write/activity-log.ts` (`TYPES`, `REF_FIELDS`) | P3 (D-22) |
| F12 | `ImportExportService.showExportMenu()` har ingen egen behörighetsspärr. AO-snabbexport finns för `ao_view_own`, medan Exportcenter kräver `ao_view_all`. | `ImportExportConfigs.js` `showExportMenu`; `WorkOrdersPage.js:222`; `CustomersPage.js:108` | P3 (servern skyddar, inkonsekvent) |
| F13 | `ProfitabilityService` använder 250 kr/h när `internalHourlyCost` saknas. Samma mönster som "okänt = ett påhittat värde". Används bara bakom ekonomibehörighet. | `ProfitabilityService.js:10` | P3 |
| F14 | `canViewWorkOrder` (bilder, checklista, material) ger åtkomst till alla pool-AO för `ao_view_own` | `_shared/vift-auth.ts` | Följer D-04/D-24 |
| F15 | Start och "Ta jobbet" kräver i dag `ao_complete`. Det blandar ihop tre olika rättigheter. | `ao-time-write/index.ts:163`, `:214-216` | Löses av nya behörigheter |
| F16 | `create_time` kontrollerar inte i EF:en att anroparen ser AO:n. RPC-källan (`time_entry_create`) finns inte i något repo. | `ao-time-write/index.ts` `create_time` | Okänt, prövas (SEC-AO-07) |
| G4 | Källor saknas för `_staging_business_key_required_perm`, `store_business_key_write`/`_merge_write`, `store_read_all_with_hashes`, `work_order_create`/`_patch`, `time_entry_*`, `invoice-write` och `rondering-pass-write`, i båda repona | Sökning i `VIFT-CRM` och `vift-v2` (bara anrop finns) | **Blockerar** lokala databastester av B5 och skrivregler |

### Observationer från användartest

**O1 – Exportcenter visar Personnummer förvalt ikryssat.**

*Kod:*
- `ImportExportConfigs.js:49`: kundregistret har `sensitiveFields: []`.
- `ImportExportConfigs.js:60`: `personnr` är ett vanligt fält.
- `ExportCenterPage.js:135-142`: `_initCols()` kryssar i alla fält som inte är känsliga.
- `ExportCenterPage.js:123`: texten "Känsliga fält är av som standard" stämmer därför inte för personnummer.
- `ExportCenterPage.js:189`: valet "Inkludera känsliga fält" gäller bara `objects_sensitive` (portkoder) och har inget med personnummer att göra.
- Snabbexporten (`CustomersPage.js:108` → `buildExportRowsForType`, `ImportExportConfigs.js:1406`) tar alltid med personnummer.

*Exporteras personnummer för roller som inte borde få det?*
- **Inte utöver läsrätten.** Servern (`vift_store_project`) tar bort `personnr` (och `orgNr` för privatpersoner) för alla roller utom `customer_manage`, `invoice_*`, `offer_manage`, `sales_manage`, `ao_view_all` och `all`. För övriga roller blir kolumnen tom.
- Fält och begränsad når varken kundsidan eller kundexporten, och har inte värdet.
- Roller med `sales_manage` eller `ao_view_all` (+ `customer_view`) får däremot ut personnummer i snabbexporten utan aktivt val. Om det är fel avgörs av D-13.
- Undantag: lokal cache från föregående användare (F6).

*Klassificering:*
- **P2, brist i dataminimering och standardval (privacy by default).** Inte en serverläcka.
- Rättas genom att personnummer och org.nr för privatpersoner blir känsliga fält med egen spärr (D-18).
- Rättningen ska testas med SEC-EXP-09…13.

**O2 – Fältrollens Uppgifter-sida visar uppgifter kopplade till andra användare.**

*Kod:*
- `PageShells.js:11905` och `:11931`: `renderList()` utgår från hela `state.activities`. Standardfiltret "Alla öppna" visar alla öppna uppgifter, oavsett `assignedTo`/`createdBy`.
- Servern lämnar ut hela `vift_activities` till alla aktiva:
  - `vift_store_full_access` … `else true` (`20261125000003_store_read_by_role.sql:93`);
  - `store-key-write` `READABLE_KEYS`.
- `activities-policy.ts` reglerar bara **skrivning**.
- Sidan är öppen för `ao_view_own` (`AuthService.js:118`).

*Klassificering:*
- **Läckage, inte avsedd regel.** Den beslutade inriktningen (B4/Ö7) säger att uppgifter ska filtreras på servern efter behörighet och tilldelning.
- Uppgifterna bär kund, fastighet och offert-/AO-referenser och fri text.
- **P1** (före LIVE), åtgärd på servern (projektion per post).
- Klientens filter är ingen rättning.
- Testas med SEC-TASK-07…12.
