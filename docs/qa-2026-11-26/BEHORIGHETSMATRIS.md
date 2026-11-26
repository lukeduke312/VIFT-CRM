# VIFT CRM – fastställd behörighetsmatris

**Status: FASTSTÄLLD 2026-11-27** enligt `docs/qa-2026-11-27/BESLUT-2026-11-27.md` (D-01–D-26, AP-A–AP-G, justeringar av säkerhetsplanen).

- Beslutsdokumentet är det auktoritativa underlaget. Vid avvikelse gäller dess ordalydelse.
- Den här matrisen ersätter förslagsversionen från 2026-11-26.

**Avgränsning:**
- Bara dokumentation. Ingen kod, databas, Edge Function eller data är ändrad.
- Serverhänvisningarna bygger på inventeringen av STAGING i `vift-v2/supabase/inventering/staging-2026-11-26/`:
  - `INVENTERING.md`;
  - `schema/functions.sql` (alla 64 funktioner, även `work_order_patch` och `time_entry_*`);
  - `schema/policies.sql` (alla 51 policyer);
  - `functions/<slug>/` (exakta EF-källor, även `invoice-write` och `rondering-pass-write`).
- LIVE är inte läst.

Testplan och paketordning: `SAKERHETSPROVNING-TESTPLAN.md`.

---

## 0. Grundprinciper (fastställda)

1. **Standardrollerna är utgångspunkter.** Varje behörighet ska kunna tas bort från eller läggas till i en standardroll, i en egen roll eller för en enskild person via egen roll.
2. **Inga säkerhetsbeslut på rollnamn eller roll-id.**
   - Servern och klienten frågar alltid efter en behörighet (`hasPerm`/`Auth.can`), aldrig efter `role === 'chef'` eller liknande.
   - Rollnamn får bara styra förval i gränssnittet, till exempel dashboardlayout och förvald roll för ny personal.
   - Ställen där rollnamn i dag används som förval och därför ska granskas:
     - `AuthService.js:379` (reservroll, SÄK-10) — **borttagen i T3-A (lokalt verifierad 2026-11-28)**: ingen reservroll;
     - `DashboardConfig.js:334`, `Dashboard.js:56/558/664` (layoutförval);
     - `ImportExportConfigs.js:520-522` (importmappning);
     - `PageShells.js:9184/9303` (reservlista i personaldialogen).
   - **T3-E (lokalt verifierad):** `VIFT-CRM/tests/rollnamn_guard.test.js` och `vift-v2/tests/t3e_standard_roles.test.js` underkänner varje jämförelse eller nytt förval med ett standardroll-id i klienten, Edge Functions och T3-migrationerna; bara förvalen ovan (och `schema.js` förvald roll för ny personal) är tillåtna, och ingen av dem står på en rad med en behörighetskontroll.
   - Serverpolicyn `store_admin_write_protected` använder flaggan `app_users.is_admin`, inte ett rollnamn. Den är PERMISSIVE och ändrar inte de RESTRICTIVE affärsnyckelreglerna.
3. **Servern bestämmer.** Klientkontroller är presentation och räknas aldrig som skydd. Varje regel nedan har ett angivet verkställande lager.
4. **Kontroller som påverkas av samtidighet görs i RPC:n under radlås** (`SELECT … FOR UPDATE` på berörd `store`-rad, eller `pg_advisory_xact_lock` när flera nycklar berörs). En kontroll i Edge Function före RPC-anropet räcker inte. Det gäller till exempel tilldelning och status i `work_order_patch`, "Ta jobbet", stämpling och tid på tilldelad AO, materialrader, superadmininvarianten och fältvis sammanslagning.
5. **Okänt är aldrig 0.** Okända priser och kostnader markeras som okända och ger ofullständig kalkyl, aldrig ett påhittat värde.

**Verkställande lager:**

| Kod | Lager | Exempel |
|---|---|---|
| **RLS** | PostgreSQL-policy för direkt REST (`/rest/v1/store`, tabeller) | `store_read_by_role`, `store_*_no_direct_*`, `staging_generic_keys_no_direct_*` |
| **PROJ** | Projektion innan data lämnar servern | `vift_store_project()`, redigering i `work-orders-list`/`time-entries-list` |
| **EF** | Edge Function (behörighet, fältlista, identitet ur JWT) | `ao-time-write`, `store-key-write`, `invoice-write`, `get-sensitive-fields` |
| **RPC** | SECURITY DEFINER-funktion som körs under lås. Här görs samtidighetskritiska kontroller. | `work_order_patch`, `store_business_key_merge_write`, `time_entry_create` |
| **TRG** | Trigger på `store` | `_protect_critical_store_keys` |
| **KLIENT** | Visning och dolda knappar (inget skydd) | `Auth.can`, `PAGE_PERMISSIONS` |
| **CACHE** | Klientens `localStorage`/minne | `Auth._clearSession`, `Storage._localAll` |
| **EXP** | Exportvägar | Exportcenter, snabbexport, serverexport |
| **SIM** | Simulerad server (`tests/e2e/fake-backend.js`). Måste spegla samma regler, annars kan e2e-testerna inte bevisa något. | `canViewAO`, `patch_ao` |

**Notation i matrisen:**

| Tecken | Betydelse |
|---|---|
| **S** | Läsa och skriva (skapa, ändra, ta bort) |
| **L** | Läsa hela posten |
| **Lp** | Läsa projicerat (skyddade fält borttagna av servern) |
| **egen** | Egen tilldelad eller ägd post |
| **–** | Ingen åtkomst |
| *(perm)* | Gäller bara med den behörigheten |

---

## 1. Behörighetskatalog

### 1.1 Nya behörigheter (fastställda)

| Behörighet | Betydelse | Beslut | Verkställs | Standard i |
|---|---|---|---|---|
| `cost_view` | Läsa inköpspris, intern timkostnad, marginal, TB och kostnadskalkyl. **Ger inte** individuella löneuppgifter. | D-01 | PROJ (`vift_articles.buyPrice`, `vift_settings.internalHourlyCost`, `materials[].buyPrice*`), EXP | admin*, chef, ekonomi |
| `cost_edit` | Sätta och komplettera inköpspris (artikel och materialrad med okänt pris) | D-01, D-10 | EF + RPC (materialrad), `store-key-write` (`vift_articles`, fältvis) | admin*, chef, ekonomi |
| `ao_start_own` | Starta egen tilldelad AO: `nytt`/`planerad`/`pool` → `pågående` | D-03 | RPC `work_order_patch` (ny transitionsgren under lås) | admin*, chef, personal |
| `ao_complete_own` | Klarmarkera egen tilldelad giltig AO. Servern sätter `completedAt`/`completedBy`. | D-03 | RPC (under lås) | admin*, chef, personal |
| `ao_pool_take` | Se och ta **öppen pool** (AP-A). Atomiskt, exakt en lyckas (AP-F). Kopplas inte till `ao_complete` eller `ao_time`. | D-03, AP-F | PROJ (`work-orders-list`) + RPC (tagning under lås) | admin*, chef, personal |
| `ao_plan_own` | Sätta eller justera planerat datum på egen tilldelad AO. Rör inte personal, status eller ekonomi. | AP-E (**byggs i AO-etappen, inte i T3/T4**) | RPC | admin*, chef, personal (när den byggs) |
| `rondering_utfor` | Se och utföra ronderingspass som är tilldelade en själv | Ö3, D-04 | EF `rondering-pass-write` + RPC `rondering_*` + PROJ `vift_ronderingspass` · **verkställd (T4-D, lokalt)** | admin*, chef, personal |
| `objects_access_assigned` | Få nödvändig åtkomstinformation (portkod, nyckel, tillträde) för **egen tilldelad aktiv** AO eller rondering, via en smal och loggad serverväg | D-05, D-04 | EF `get-sensitive-fields` (ny gren) + `sensitive_access_audit` · **verkställd (T4-C, lokalt)**: RPC `sensitive_fields_read`; ronderingsgrenen aktiv sedan T4-D | admin*, personal (inte `begransad`; kan tilldelas separat) |
| `export_data` | Exportera register som rollen får läsa. Samma regel i snabbexport och Exportcenter. | D-18 | EXP (klient) + PROJ. Skyddade fält bara via serverexport. | admin*, chef, ekonomi |
| `export_personal_data` | Aktivt val att exportera personnummer och org.nr för privatperson. Loggas på servern. | D-18 | EF (ny serverexport) + logg | admin* (övriga bara uttryckligen) |
| `personal_data_view` | Läsa personnummer och motsvarande uppgifter. Följer **inte** av `ao_view_all` eller `sales_manage`. | D-13 | PROJ + RLS + fältvis sammanslagning vid skrivning | admin*, ekonomi (ROT/RUT). Arbetsledare: se K-02. |
| `time_view_all` | Läsa alla tidposter (arbetad och registrerad tid) utan attest och utan lönefält. Ersätter behovet av `payroll_*` för arbetsledare. | D-08 (utredning nedan) | EF `time-entries-list` (urval + projektion) | admin*, chef |
| `bankgiro_edit` | Ändra bankgiro och betalningsuppgifter i `vift_settings` | D-17 | `store-key-write` + RPC (fältvis sammanslagning av settings) | admin* |
| `staff_contacts_view` | Läsa kollegors arbetstelefon och arbets-e-post (interna kollegor, R38). Ersätter T3-D:s härledning av "intern" ur andra behörigheter. | BESLUT-2026-11-28 (T3-D 2, T3-E 4) | PROJ `vift_store_project` (`vift_staff`) | admin*, chef, ekonomi, personal (inte `begransad`) |
| `activity_log_view_all` | Läsa hela aktivitetsloggen. Följer inte av `ao_view_all`; utan den bara händelser för AO där man är tilldelad. | BESLUT-2026-11-28 (T3-D 6) | PROJ + RLS (`vift_store_full_access`, `vift_store_project`) | admin*, chef, ekonomi |

\* admin har `all`.

**Nuläge 2026-11-28 (T3-E, lokalt verifierad):** `ao_start_own`, `ao_complete_own` och `ao_pool_take` verkställs (T3-B). Övriga tio nya behörigheter (`ao_plan_own`, `cost_view`, `cost_edit`, `time_view_all`, `bankgiro_edit`, `personal_data_view`, `objects_access_assigned`, `rondering_utfor`, `export_data`, `export_personal_data`) finns i katalogen och i standardrollerna men är **verkningslösa** tills respektive paket (AO-etappen, T4-A–T4-F) har sin serverkontroll: de står i serverns register `_vift_ej_verkstallda()` (vift-v2 `20261128000008`) och räknas inte i någon regel; en roll som får dem får exakt samma åtkomst som utan dem (bevisat i `vift-v2/tests/t3e_standard_roles.test.js` och e2e T3E-06). Rolleditorn märker dem "verkställs i <paket>". Ett T4-paket som verkställer en behörighet tar bort den ur registret i sin migration.

**Nuläge efter T4-A (2026-11-28, lokalt verifierad, ej installerad i STAGING):** `cost_view`, `cost_edit` (skyddade fält; materialradernas okända pris och prisflödet är T4-B), `personal_data_view` och `bankgiro_edit` är verkställda och borttagna ur `_vift_ej_verkstallda()` (vift-v2 `20261128000009`); varje behörighet ger exakt den beslutade åtkomsten och inget mer (`t4a_skyddade_falt`, T3-E-testets SEC-CUST-01/08/20). Kvar som ej verkställda: `ao_plan_own`, `time_view_all`, `objects_access_assigned`, `rondering_utfor`, `export_data`, `export_personal_data`. Nya uttryckliga behörigheter `staff_contacts_view` och `activity_log_view_all` (BESLUT-2026-11-28, T3-D 2/6, T3-E 4) är verkställda med en övergångsregel för roller som saknar båda (se R38/R44). En inaktiverad roll (`active: false`) ger inga behörigheter, och en anropare utan någon giltig behörighet får inga verksamhetsdata.

**Superadmin (D-25):**
- Superadmin = aktiv personal vars roll innehåller `all`.
- `admin_manage` är **inte** superadmin.
- Bara en anropare med `all` får lägga till eller ta bort `all` i en roll, eller tilldela personal en roll som innehåller `all`.
- **Ingen eskalering:** den som har `staff_manage` eller `admin_manage` får bara tilldela och redigera roller vars behörigheter är en delmängd av de egna. Ingen får byta sin egen roll eller lägga till behörigheter i den egna rollen. Gäller i RPC under lås.
- Invariant: minst en aktiv personal med `all`. Den kontrolleras atomiskt vid varje skrivning av `vift_staff` och `vift_roles`, med gemensamt transaktionslås.

**D-08, utredning av tidläsning:**
- Dagens enda läsväg är `time-entries-list`. Där ser `payroll_view` alla tidposter och övriga bara sina egna.
- `payroll_view` öppnar även Löneunderlag (`PAGE_PERMISSIONS['pg-payroll']`) och lönexporten. En separat `time_view_all` behövs därför för att arbetsledaren ska följa arbetstid utan löneåtkomst.
- Tidposterna innehåller i dag inga individuella lönefält, bara tid, AO, kommentar och försäljningstimpris (`hourRate`).
- `time_view_all` får tidposterna utan attestmöjlighet. `hourRate` lämnas bara ut med `cost_view`, `invoice_*` eller `payroll_view`.
- Ett teamurval finns inte i datamodellen. `time_view_all` gäller därför all personal (se K-01).

### 1.2 Befintliga behörigheter: fastställd tolkning

| Behörighet | Fastställd tolkning efter T3/T4 |
|---|---|
| `ao_view_own` | Läsa egna tilldelade AO. **Ger inte längre öppen pool.** Den kräver `ao_pool_take`. |
| `ao_view_all` | Läsa alla AO. Ger **inte** personnummer (D-13), skrivrätt till andras uppgifter (D-15) eller `rondering_utfor`. Rondering administreras som i dag. |
| `ao_complete` | Klarmarkera **valfri** AO som anroparen får se (arbetsledarbehörighet). Utan `ao_view_all`/`ao_edit` tolkas den under övergången som `ao_complete_own` (se SÄK-5). |
| `ao_edit` | Redigera AO. Får **inte** sätta `status:'fakturerad'`, `invoiceId`, `invoicedAt` eller andra faktureringsfält via `patch_ao`. Det går bara genom `invoice-write` (D-07). |
| `ao_material` | Skapa rader samt ändra och ta bort **egna** rader på egen tilldelad redigerbar AO (D-19). Andras rader kräver `ao_edit`. |
| `ao_time` | Egen tid och stämpling, **bara på AO där anroparen är tilldelad** (AP-B). |
| `objects_sensitive` | Full läsning och skrivning av skyddade objektfält i register och API. Standard för chef, men kan tas bort (D-05). Utan den: inga skyddade fält i någon väg, inte heller som skrivare. |
| `customer_manage` / `customer_view` | Kunder, fastigheter och kontrakt. Ger inte personnummer (`personal_data_view` krävs, D-13). |
| `invoice_view` / `invoice_create` | Fakturaunderlag. Standard även för chef (D-07). Skrivning bara via `invoice-write`. |
| `payroll_view` / `payroll_manage` | Löneunderlag och lönexport, respektive attest. Standard för ekonomi och admin (D-08). |
| `admin_manage` | Inställningar (utom bankgiro), titlar, mallar, importlogg, rollregister (inom eskaleringsregeln). Får läsa andras roll- och behörighetslistor (D-21). Är inte superadmin. |
| `staff_view` / `staff_manage` | Personal. `staff_manage` får inte ändra egen roll eller tilldela roller utöver de egna behörigheterna (D-25). |
| `article_manage` | Artiklar och prisgrupper. Skrivning av `buyPrice` kräver dessutom `cost_edit`. |

---

## 2. Standardroller (fastställda utgångspunkter, D-02)

Id: `admin`, `chef` (etikett "Arbetsledare"), `ekonomi`, `personal`, `begransad`. Befintliga personalposter migreras inte.

**Förutsättningar för att införa rollen `personal` i rollregistret:**
- SÄK-10 är rättad;
- de nya behörigheterna är införda i servern (T3-paketen).

| Behörighet | `admin` | `chef` | `ekonomi` | `personal` | `begransad` |
|---|---|---|---|---|---|
| `all` | ✔ | | | | |
| `dashboard_view` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `ao_view_all` | ✔ | ✔ | ✔ | | |
| `ao_view_own` | ✔ | ✔ | | ✔ | ✔ |
| `ao_pool_take` | ✔ | ✔ | | ✔ | (separat, D-04) |
| `ao_start_own`, `ao_complete_own` | ✔ | ✔ | | ✔ | (separat) |
| `ao_plan_own` (AO-etappen) | ✔ | ✔ | | ✔ | |
| `ao_create`, `ao_edit`, `ao_complete` | ✔ | ✔ | | | |
| `ao_time` | ✔ | ✔ | | ✔ | (separat) |
| `ao_material` | ✔ | ✔ | | ✔ | |
| `ao_checklist` | ✔ | ✔ | | ✔ | (separat) |
| `rondering_utfor` | ✔ | ✔ | | ✔ | (separat) |
| `objects_access_assigned` | ✔ | (har `objects_sensitive`) | | ✔ | (separat) |
| `objects_sensitive` | ✔ | ✔ (kan tas bort) | | | |
| `customer_manage` | ✔ | ✔ | | | |
| `customer_view` | ✔ | | ✔ | | |
| `personal_data_view` | ✔ | K-02 | ✔ | | |
| `offer_manage`, `sales_manage`, `recurring_manage` | ✔ | ✔ | | | |
| `invoice_view`, `invoice_create` | ✔ | ✔ | ✔ | | |
| `reports_view` | ✔ | ✔ (T3-E 5, 2026-11-28) | ✔ | | |
| `cost_view`, `cost_edit` | ✔ | ✔ (kan tas bort) | ✔ | | |
| `time_view_all` | ✔ | ✔ | (via `payroll_view`) | | |
| `payroll_view`, `payroll_manage` | ✔ | | ✔ | | |
| `staff_view` | ✔ | ✔ | | | |
| `staff_contacts_view` (T4-A) | ✔ | ✔ | ✔ | ✔ | |
| `activity_log_view_all` (T4-A) | ✔ | ✔ | ✔ | | |
| `staff_manage`, `admin_manage`, `article_manage`, `bankgiro_edit` | ✔ | | | | |
| `export_data` | ✔ | ✔ | ✔ | | |
| `export_personal_data` | ✔ | | | | |

"(separat)" betyder att behörigheten **inte** ingår som standard men kan läggas till för en enskild person eller en egen roll (D-04).

**Nuläge 2026-11-28 (T3-E, lokalt verifierad):** tabellen finns som installerbar definition `vift-v2/supabase/manual/t3e_standardroller/standardroller.json` (testet `VIFT-CRM/tests/rollnamn_guard.test.js` jämför den med tabellen ovan, bara ✔). Installationen är ett manuellt skript (A läsande plan, B installera, C rollback med expectedHash, D övergångsregeln) som bara lägger till saknade roller, aldrig skriver över eller tar bort roller och aldrig ändrar personalposter. Inget är installerat i STAGING. Klientens demoroller och den simulerade serverns seed är samma fem roller.

**T4-A (2026-11-28):** `chef` har `reports_view` (matrisändring T3-E 5); `staff_contacts_view` för admin, chef, ekonomi och personal; `activity_log_view_all` för admin, chef och ekonomi. Definitionen (`standardroller.json`, version `t4a-2026-11-28`) och skripten A–D är omgenererade; rapporter följer den underliggande behörigheten (inga personnummer, portkoder, inköpspriser eller lönefält utan respektive behörighet).

---

## 3. Fastställd behörighetsmatris

Kolumnerna visar standardrollerna. Regeln följer alltid av **behörigheten** i parentes, inte av rollnamnet.

### 3.1 Arbetsordrar och arbetspool (D-03, D-04, D-07, D-24, AP-A–AP-G)

**Definitioner (AP-A).** Lagrad data ändras inte. Kategorin härleds vid läsning.

| Kategori | Villkor |
|---|---|
| Aktiv | `!deleted && !archived && status ∉ {klar, fakturerad, avbruten}` |
| Öppen pool | Aktiv, `status = 'pool'`, `staff` tom. Datum påverkar inte, så säkerhetsrättningen inte breddar dagens utlämning. En ny AO med `status = 'nytt'` utan personal och datum exponeras **inte** som pool. |
| Tilldelad pool | Aktiv, `staff` ej tom, `scheduledDate` tom. Giltig, och kan ligga kvar i arbetspoolen (D-24). |
| Planerad | `scheduledDate` satt. Förfallodatum (serviceintervall) räknas **inte** som `scheduledDate`. |

| # | Resurs/åtgärd | admin | chef | ekonomi | personal | begransad | Verkställs | Beslut | Nu (STAGING) |
|---|---|---|---|---|---|---|---|---|---|
| R01 | Egna tilldelade AO | S | S | L | L egen | L egen | PROJ `work-orders-list`; SIM | D-03 | Som målet |
| R02 | Andras AO (ej öppen pool) | S | S | L | – | – | PROJ `work-orders-list`, `canViewWorkOrder` (EF), SQL-urval i `work_order_checklist_*`/`work_order_log_*` (RPC); SIM | D-24 | SÄK-3: `status=pool` lämnas ut oavsett `staff` · **Lokalt verifierad rättning (T3-B, 2026-11-28)**, ej installerad i STAGING |
| R03 | Öppen pool: se (begränsad projektion, D-13) | L | L | L | Lp *(ao_pool_take)* | – | PROJ `work-orders-list` (poolprojektion); SIM | AP-A, D-04, D-13 | Alla med `ao_view_own` ser hela poolen med fullständig post · **Lokalt verifierad rättning (T3-B, 2026-11-28)**, ej installerad i STAGING |
| R04 | Öppen pool: ta jobbet | S | S | – | S *(ao_pool_take)*, bara sig själv, atomiskt | – | RPC `work_order_patch` (ny transition under lås), 409 `already_assigned` | AP-F | SÄK-4: utan lås, tillåter AO med personal, kräver `ao_complete` · **Lokalt verifierad rättning (T3-B, 2026-11-28)**, ej installerad i STAGING |
| R05 | Tilldelad pool: se och ta | S | S | L | L bara om tilldelad; tagning nekas | L bara om tilldelad | PROJ + RPC | D-24, AP-A | SÄK-3/4 · **Lokalt verifierad rättning (T3-B, 2026-11-28)**, ej installerad i STAGING |
| R06 | Öppen pool, skriva **före** tilldelning: material, bilder, checklista, logg, tid, stämpling | S | S | – | – | – | RPC (`work_order_*`, `time_entry_create`, `store_write_stamp_status`), EF (`work-order-image-*`), `canViewWorkOrder` delas upp i `canView` och `canWrite` | Plan-justering, AP-B | `canViewWorkOrder` släpper igenom pool. Tid och stämpling kontrolleras inte alls (F16/F23). · **Lokalt verifierad rättning (T3-B, 2026-11-28)**, ej installerad i STAGING |
| R07 | Starta egen | S | S | – | S *(ao_start_own)* | (separat) | RPC under lås: tilldelad, källstatus `nytt`/`planerad`/`pool`, inte arkiverad eller borttagen | D-03 | Gren A i EF före lås, villkoras av `ao_complete` · **Lokalt verifierad rättning (T3-B, 2026-11-28)**, ej installerad i STAGING |
| R08 | Klarmarkera | S | S *(ao_complete)* valfri synlig | – | S *(ao_complete_own)* egen | (separat) | RPC under lås: tilldelad, källstatus `nytt`/`planerad`/`pool`/`pågående`. Servern sätter `completedAt`/`completedBy`. | D-03 | **SÄK-5 (P1):** valfri AO, även `fakturerad` → `klar` · **Lokalt verifierad rättning (T3-B, 2026-11-28)**, ej installerad i STAGING |
| R09 | Planera egen (AO-etappen) | S | S | – | S *(ao_plan_own)* | – | RPC | AP-E | Finns inte |
| R10 | Fakturering: `status:'fakturerad'`, `invoiceId`, `invoicedAt` | via `invoice-write` | via `invoice-write` | via `invoice-write` | – | – | EF `invoice-write` (`invoice_create`) + RPC `invoice_set_status`. `ao-time-write`/`work_order_patch` avvisar fälten för **alla** roller. | D-07 | `ao_edit` kan sätta `fakturerad` i `patch_ao` (F21) · **Lokalt verifierad rättning (T3-B, 2026-11-28)**, ej installerad i STAGING |
| R11 | Ändra AO (fält, personal, pris), arkivera, mjuk och permanent radering | S | S *(ao_edit)* | – | – | – | EF + RPC | D-23 | Som målet |
| R12 | AO-ekonomi: fastpris, prisbelopp, TB | S | S *(cost_view)* | L | – (debiteringskategori utan belopp) | – | PROJ `work-orders-list` | D-06 | `fixedPrice` m.m. skickas till fält, klienten döljer · **Lokalt verifierad (T4-A, 2026-11-28):** `work-orders-list` och AO i skrivsvaren (ao-time-write, work-order-log-write, work-order-checklist-resolve, invoice-write) utan `fixedPrice`/`amount` för roller utan `ao_edit`, `ao_view_all`, `invoice_*` eller `cost_view`; debiteringskategorin (`priceType`, `priceGroupId`) finns kvar. Ej installerad i STAGING. |

### 3.2 Material, priser och kostnader (D-01, D-06, D-09, D-10, D-11, D-19)

| # | Resurs/åtgärd | admin | chef | ekonomi | personal | begransad | Verkställs | Beslut | Nu |
|---|---|---|---|---|---|---|---|---|---|
| R13 | Ny materialrad (artikel + mängd, eller fritext + mängd, enhet, dokumentation) | S | S | – | S *(ao_material)* egen tilldelad redigerbar AO | – | Ny radvis RPC (`work_order_material_add`), servern sätter `id`, `addedBy`, `addedAt` och pris från artikel | D-10, D-19 | SÄK-6: hela listan ersätts, priser från klienten · **Lokalt verifierad (T4-B, 2026-11-28):** `work_order_material_add` (EF `add_material`) under lås; servern sätter `id`, `addedBy`, `addedAt`, `performedDate` och pris (artikel → ögonblicksbild, fritext → okänt); fältets hela lista nekas (403 `row_path_required`). Ej installerad i STAGING. |
| R14 | Ändra och ta bort **egen** materialrad | S | S | – | S egen rad på egen redigerbar AO | – | RPC `work_order_material_update/remove` under lås | D-19 | Hela listan · **Lokalt verifierad (T4-B, 2026-11-28):** egna rader på tilldelad AO, annars 403 `not_own_row`; radversion (`stale_write`); källrad i faktura låst (`invoiced_locked`). Ej installerad i STAGING. |
| R15 | Ändra och ta bort **annans** materialrad | S | S *(ao_edit)* | – | – | – | RPC | D-19 | Fält kan · **Lokalt verifierad (T4-B, 2026-11-28):** bara `ao_edit` (fält 403 `not_own_row`). Ej installerad i STAGING. |
| R16 | Inköpspris (`articles.buyPrice`, `materials[].buyPrice`): läsa | L | L *(cost_view)* | L | – | – | PROJ (store och `work-orders-list`), EXP | D-01 | Alla läser artiklar. Artikelväljaren visar "Ink:". · **Lokalt verifierad (T4-A, 2026-11-28):** artiklarnas `buyPrice`/`markup` och materialradernas `buyPrice` bara med `cost_view`, även för skrivaren `article_manage`/`ao_edit`; REST-raden för artiklar döljs utan `cost_view`. Artikelväljaren i klienten visar inget inköpspris utan `cost_view`. Ej installerad i STAGING. |
| R17 | Inköpspris: sätta och komplettera okänt | S | S *(cost_edit)* | S | – | – | RPC (materialrad), `store-key-write` (fältvis för artiklar) | D-01, D-10 | Klienten sätter `\|\| 0` · **Lokalt verifierad (T4-A, 2026-11-28):** (fältdelen) `buyPrice` i artiklar och befintliga materialrader kräver `cost_edit` (403 `field_protected`); saknat värde bevaras vid sparning; inköpspris i en ny materialrad utan `cost_edit` ignoreras (`ignoredFields`). Komplettering av okänt pris och serverpris: T4-B. Ej installerad i STAGING. · **Lokalt verifierad (T4-B, 2026-11-28):** okänt inköpspris (`buyPriceUnknown`) kompletteras radvis med `cost_view`+`cost_edit`; 0 över okänt från äldre klient ignoreras. Ej installerad i STAGING. |
| R18 | Försäljningspris material: läsa | L | L | L | – (dolt konsekvent överallt) | – | PROJ (`articles.sellPrice`, `materials[].sellPrice`), KLIENT | D-09 | Skickas till fält, artikelväljaren visar · **Lokalt verifierad (T4-B, 2026-11-28):** försäljningspriset bara med prisläsrätt (`ao_edit`, `ao_view_all`, `invoice_*`, `cost_view`, `article_manage`, `offer_manage`) i alla läs- och skrivsvar och REST; artikelväljaren och materialraderna visar inga belopp för fält. Ej installerad i STAGING. |
| R19 | Försäljningspris material: sätta | S | S | S | – (servern sätter från artikel; fritext = okänt) | – | RPC | D-09, D-10 | Klienten sätter · **Lokalt verifierad (T4-B, 2026-11-28):** servern sätter (artikel/prisupplösning); fritext pris bara med `invoice_create`/`cost_edit`; annars 403 `field_protected` vid ändring. Ej installerad i STAGING. |
| R20 | Okänt pris → fakturaunderlag | – | Flagga och komplettera | Flagga och komplettera | – | – | RPC `invoice_*` / `_invoice_financial_check` stoppar eller flaggar. TB = ofullständig. | D-10 | Okänt = 0 kr · **Lokalt verifierad (T4-B, 2026-11-28):** `invoice_append_checked` 409 `price_unknown` (och `price_mismatch`, `source_not_found`, `source_not_billable`); `invoice_set_status` stoppar utskick med okänt pris; kön visar "Pris saknas"; TB ofullständigt. Ej installerad i STAGING. |
| R21 | Fastpris-AO: material | Ingår i fastpris om inte uttryckligen markerat som tillägg (av `ao_edit`/`invoice_create`) | | | | | RPC (fakturaunderlag) | D-10 | Ej definierat · **Lokalt verifierad (T4-B, 2026-11-28):** material och tid på fastpris-AO → 409 `included_in_fixed_price`; tillägg (`extra`) sätts av `ao_edit`/`invoice_create` och debiteras separat. Ej installerad i STAGING. |
| R22 | Prisgrupp: välja | S | S | S | Namn utan belopp, bara tillåtna grupper | – | EF `ao-time-write` + RPC `time_entry_create` validerar grupp och sätter `hourRate` | D-11 | Fält ser belopp, klienten skickar `hourRate` (F16) · **Lokalt verifierad (T4-B, 2026-11-28):** fält: bara aktiva grupper, AO:ns grupp när den finns, namn utan belopp; 403 `price_group_not_allowed`; servern sätter `hourRate` (okänt = null). Ej installerad i STAGING. |
| R23 | Timpris (`priceGroups.hourRate`, `timeEntries.hourRate`): läsa | L | L | L | – | – | PROJ (store, `time-entries-list`), KLIENT (stämpla ut, Tid-sidan, AO-detalj) | D-11 | Fält ser · **Lokalt verifierad (T4-B, 2026-11-28):** `priceGroups.hourRate` och `timeEntries.hourRate` bara med prisläsrätt; klienten visar inga timpriser för fält. Ej installerad i STAGING. |
| R24 | Historiskt bekräftat pris | Oförändrat vid prisliständring | | | | | RPC (ögonblicksbild i tidpost och materialrad) | D-11 | Ögonblicksbild finns för tidposter · **Lokalt verifierad (T4-B, 2026-11-28):** även materialrader (pris, inköp, moms, priskälla); ändrad artikel/prisgrupp ändrar inga befintliga rader. Ej installerad i STAGING. |
| R25 | Intern timkostnad `settings.internalHourlyCost` | S | L *(cost_view)* | L | – | – | PROJ | D-01 | `ao_view_all`/`ao_edit`/`offer_manage` får fullt värde · **Lokalt verifierad (T4-A, 2026-11-28):** `internalHourlyCost` bara med `cost_view` (även för `admin_manage`), ändring kräver `cost_edit`; bevaras vid sparning. Ej installerad i STAGING. |

### 3.3 Tid, fakturering, offerter, kunder (D-07, D-08, D-12, D-13, D-20)

| # | Resurs/åtgärd | admin | chef | ekonomi | personal | begransad | Verkställs | Beslut | Nu |
|---|---|---|---|---|---|---|---|---|---|
| R26 | Egen tid och stämpling | S | S | S | S *(ao_time)* bara på tilldelad AO | (separat) | RPC `time_entry_create` + `store_write_stamp_status` under lås kontrollerar tilldelning | AP-B | Ingen AO-kontroll (F16/F23) · **Lokalt verifierad rättning (T3-B, 2026-11-28)**, ej installerad i STAGING |
| R27 | Andras tid: läsa | L | L *(time_view_all)* | L *(payroll_view)* | – | – | EF `time-entries-list` | D-08 | Bara `payroll_view` · **Lokalt verifierad (T4-B, 2026-11-28):** `time_view_all` ger all personals tid utan löneuppgifter (attest, revisioner); `payroll_view` krävs för lön/attest (K-01). Ej installerad i STAGING. |
| R28 | Attest | S | – | S *(payroll_manage)* | – | – | EF + RPC `time_entry_set_attested` | D-08 | Som målet |
| R29 | Löneunderlag och lönexport | L | – | L *(payroll_view)* | – | – | KLIENT + EF (`time-entries-list`) + EXP | D-08 | Som målet |
| R30 | Fakturaunderlag | S | S *(invoice_*)* | S | – | – | RLS + PROJ (läsning), EF `invoice-write` (`invoice_create`) + RPC | D-07 | Som målet för läsning |
| R31 | Faktura: intern kommentar | S | S | S | – | – | Nytt fält `internalNote`. PDF (klient `InvoicesPage.js:2223` och offer/invoice-PDF på servern) tar **aldrig** med det. | D-20 | `inv.note` skrivs ut |
| R32 | Faktura: kundsynlig kommentar | S | S | S | – | – | Nytt fält `customerNote`. Äldre `note` skrivs **inte** ut utan uttrycklig klassificering. | D-20 | – |
| R33 | Offerter: fullständiga (belopp, rader) | S | S *(offer_manage)* | Lp (utan token och interna fält) | – | – | RLS + PROJ | D-12 | Som målet |
| R34 | Offerter: referens till tilldelad AO | L | L | L | Lp: bara id, titel, status för offert kopplad till egen AO | Lp samma | PROJ (urval per post) | D-12 | **Lokalt verifierad (T3-D):** bara offerter kopplade till AO som anroparen ser med innehåll (AO:ns `offerId` eller offertens `workOrderId`), fälten id, titel, status och workOrderId; REST tom lista. Ej installerad i STAGING. · *tidigare: Stubb för **alla** offerter (F9)* |
| R35 | Offerttoken, godkännande, intern anteckning | S | S *(offer_manage)* | – | – | – | RLS + PROJ. Publik väg: `offer-token-validate`/`offer-respond`. | D-12 | Som målet |
| R36 | Kunder, fastigheter, objekt, kontakter | S | S | L | Lp: bara de som hör till egna AO, och begränsat för öppen pool | Lp: bara egna AO | PROJ (urval per post med samma regel som `work-orders-list`) | D-13 | **Lokalt verifierad (T3-D):** fält och begränsad får bara poster som hör till AO de ser med innehåll (öppen pool ger inga; adressen finns i poolprojektionen); portkoder och nyckelinformation aldrig i projektionen för roller utan `objects_sensitive` (skrivaren `customer_manage` undantagen, SÄK-7/T4-A); REST tom lista. Ej installerad i STAGING. · *tidigare: Fält läser hela registret* · **T4-A (lokalt verifierad):** portkoder och nyckelinformation lämnas inte heller ut till skrivaren `customer_manage` utan `objects_sensitive` (SÄK-7 stängd lokalt); fältvis sammanslagning bevarar dem vid sparning och nekar en ändring (403 `field_protected`). REST-läsning av kunder, fastigheter, objekt och kontakter kräver läsrätt till alla skyddade fält. Ej installerad i STAGING. |
| R37 | Personnummer, org.nr för privatperson | S | (K-02) | L *(personal_data_view)* | – | – | PROJ + RLS. Skrivning: fältvis sammanslagning. EXP. | D-13 | `customer_manage`/`invoice_*`/`offer_manage`/`sales_manage`/`ao_view_all` · **Lokalt verifierad (T4-A, 2026-11-28):** personnummer och privatpersoners org.nr bara med `personal_data_view` (även för `customer_manage` och C-5:s kundläsare); saknat värde bevaras, ändring nekas (403 `field_protected`), typbyte från privatperson med lagrat org.nr nekas. Export (EXP): T4-F. Ej installerad i STAGING. |

### 3.4 Personal, roller, logg, uppgifter (D-14, D-15, D-21, D-22, D-25)

| # | Resurs/åtgärd | admin | chef | ekonomi | personal | begransad | Verkställs | Beslut | Nu |
|---|---|---|---|---|---|---|---|---|---|
| R38 | Personal: namn, titel, arbetstelefon, arbets-e-post (interna kollegor) | S | L | L | L | Lp: namn och titel för personal på egna AO | PROJ | D-14 | **Lokalt verifierad (T3-D):** andra än en själv: namn, titel och (för interna) arbetstelefon och arbets-e-post; externa (bara D-04:s tilläggsbehörigheter) bara namn och titel för personal på egna AO; timpris, personnummer, användarnamn m.m. lämnas inte ut. Ej installerad i STAGING. · *tidigare: Alla läser hela posten* · **Lokalt verifierad (T4-A, 2026-11-28):** arbetskontakt till kollegor kräver `staff_contacts_view` (standard: admin, chef, ekonomi, personal; inte begransad). Övergångsregel: en roll utan både `staff_contacts_view` och `activity_log_view_all` behåller T3-E:s härledning tills införandeplanen är genomförd. Ej installerad i STAGING. |
| R39 | Egen personalpost (inkl. e-post för inloggning) | L | L | L | L | L | PROJ (egen post fullständig). KLIENT `Auth._resolveUser`. | D-14 | Som målet |
| R40 | Andras `role`/`permissions` och skyddade personaluppgifter | S | L *(staff_view)*, utan `permissions` | – | – | – | PROJ | D-14, D-21 | **Lokalt verifierad (T3-C):** andras `permissions` bort för alla utom `staff_manage`/`admin_manage`; andras `role` bara med `staff_view`; REST döljer raden. Skyddade personaluppgifter: **lokalt verifierad (T3-D)** — timpris m.m. lämnas inte ut till den som inte hanterar registret; arbetstelefon bara till interna kollegor. · *tidigare: Alla läser* |
| R41 | Rollregister: egen effektiv behörighet | L | L | L | L | L | PROJ `vift_roles` (egen roll) | D-21 | **Lokalt verifierad (T3-C):** egen roll via store-key-write. · *tidigare: Alla läser alla roller* |
| R42 | Rollregister: andras roller | S | – | – | – | – | PROJ + RLS *(admin_manage)* | D-21 | **Lokalt verifierad (T3-C):** bara `admin_manage` (och `all`); `staff_manage` får de roller den får tilldela. · *tidigare: Alla läser* |
| R43 | Personal: skriva `role`/`active`, och roller: skriva `permissions` | S (superadmin) | – | – | – | – | RPC under gemensamt lås: eskaleringsregeln och invarianten "≥1 aktiv `all`" | D-25 | **Lokalt verifierad (T3-C):** SÄK-8 åtgärdad lokalt (eskaleringsregel + invariant under gemensamt lås). Ej installerad i STAGING. · *tidigare: **SÄK-8 (P1):** `staff_manage` kan ge sig själv admin. Inget skydd för sista superadmin.* |
| R44 | Aktivitetslogg: läsa | L | L | L | Lp: händelser på egna AO | Lp: egna AO | PROJ per post (samma urval som rättad `work-orders-list`). RLS nekar direkt REST för roller utan full åtkomst. | B4, D-22 | **Lokalt verifierad (T3-D):** hela loggen med `ao_view_all` (eller `admin_manage`); övriga AO-händelser för AO de ser med innehåll (inte öppen pool, Q3), inga offert-, faktura-, kund- eller säljposter; REST tom lista; även i `invoice-write`-svaret. Ej installerad i STAGING. · *tidigare: Alla läser alla* · **Lokalt verifierad (T4-A, 2026-11-28):** hela loggen kräver `activity_log_view_all` (standard: admin, chef, ekonomi); en ny roll med `ao_view_all` utan den får bara händelser för AO där den är tilldelad. Övergångsregel som R38 (äldre roller med `ao_view_all`/`admin_manage` behåller hela loggen). Ej installerad i STAGING. |
| R45 | Aktivitetslogg: rapportera | `appendActivity` | inom behörighet | inom behörighet | Typer och referenser för egna AO | samma | EF `store-key-write` `appendActivity` (typlista per behörighet, referens kontrolleras), RPC `activity_log_append` | D-22 | **Lokalt verifierad (T3-D):** typ per behörighet (403 `type_not_allowed`) och referenser mot det anroparen ser (403 `ref_not_visible`) i RPC:n, AO-raden under lås; servern sätter aktör och tid. Ej installerad i STAGING. · *tidigare: Alla typer och referenser tillåtna (F11)* |
| R46 | Uppgifter: egna och tilldelade | S | S | S | S | S | EF `activities-policy.ts` (skrivning), PROJ per post (läsning) | D-15, Ö7 | **Lokalt verifierad (T3-D):** läsning = egna, tilldelade och uppgifter på AO där man är tilldelad; skrivning som tidigare med orsak (`not_own`, `field_<fält>`). Ej installerad i STAGING. · *tidigare: Skrivning som målet, läsning av alla* |
| R47 | Uppgifter: andras | S | S *(ao_edit + ao_view_all, eller admin_manage)* | – (`ao_view_all` räcker inte) | – | – | EF + PROJ + KLIENT med samma regel | D-15 | **Lokalt verifierad (T3-D):** SÄK-2 åtgärdad lokalt — andras uppgifter bara med `admin_manage` eller `ao_edit` + `ao_view_all` i läsning, skrivning och klient (F8). Ej installerad i STAGING. · *tidigare: **SÄK-2 (P1):** fält läser alla. Klient och server följer olika regler (F8).* |
| R47a | Notiser: läsa | L egna | L egna | L egna | L egna | L egna | PROJ per mottagare (`vift_store_project` → `_vift_notis_projicera`: `userId` = anroparens personal-id); RLS: `vift_store_full_access('vift_notifications')` falskt för alla, även `all` | Punkt 7 (tillägg efter T3) | **Lokalt verifierad (T4-A, tilläggsdel notiser, 2026-11-28):** bara egna notiser i `readAllWithHashes` (även superadmin); direkt REST-läsning ger 0 rader; äldre poster utan mottagarfält lämnas inte ut till någon; utan giltig behörighet inga. Ej installerad i STAGING. · *tidigare: varje inloggad läste hela listan, även andras notiser (REST och EF)* |
| R47b | Notiser: skapa åt annan (tilldelningsnotis) | S | S *(ao_edit)* | – | – | – | EF `store-key-write` `appendNotification` → RPC `notification_append` under radlås: servern sätter avsändare, tid och id; typ per behörighet; mottagaren aktiv personal och **tilldelad** AO:n; referensen prövas för avsändaren (`_vift_ref_visible`); text ur AO:n; idempotens bunden till innehåll | Punkt 7, AP-D | **Lokalt verifierad (T4-A, tilläggsdel notiser):** 403 `type_not_allowed` / `recipient_not_allowed` / `recipient_not_assigned` / `ref_not_visible`; 409 `idempotency_key_conflict`; ingen dubblett av oläst tilldelningsnotis. Ej installerad i STAGING. · *tidigare: varje inloggad skapade notiser åt vem som helst via REST, med valfri typ, text, avsändare och tid* |
| R47c | Notiser: egna påminnelser (`service_done`, `service_overdue`, `service_approaching`) och markera lästa | S egna | S egna | S egna | S egna | S egna | `appendNotification` (bara till sig själv, text 1–500 tecken); `markNotificationsRead` → RPC `notifications_mark_read` (bara egna; andras och okända id räknas lika, inget orakel) | Punkt 7 | **Lokalt verifierad (T4-A, tilläggsdel notiser).** Ej installerad i STAGING. · *tidigare: läsmarkering via REST-upsert av hela listan (triggern tillät bara ändring av `read`)* |

### 3.5 Portkoder, ronderingar, inställningar (D-05, D-16, D-17, D-23)

| # | Resurs/åtgärd | admin | chef | ekonomi | personal | begransad | Verkställs | Beslut | Nu |
|---|---|---|---|---|---|---|---|---|---|
| R48 | Skyddade objektfält i register (`propertyObjects.doorCode/keyInformation/accessInformation`, `recurringOrders.accessCode`, `workOrders.accessCode`) | S | S *(objects_sensitive)* | – | – | – | PROJ (även för skrivare), RLS, **fältvis sammanslagning** i `store_business_key_*`/`work_order_patch` | D-05, B5 | **SÄK-7 (P1, läckage):** skrivare utan `objects_sensitive` får fältet · **Lokalt verifierad (T4-A, 2026-11-28):** SÄK-7 (läckaget) stängt lokalt: projektion även för skrivare i `vift_store_project`/`vift_store_full_access` och `work-orders-list` (C-5-undantaget för `ao_edit` borttaget); fältvis sammanslagning i `store_business_key_write`/`_merge_write` och `work_order_patch` under radlås (SEC-B5-01..05). Tilldelningsvägen: **lokalt verifierad (T4-C, 2026-11-28)**, se R49. Ej installerad i STAGING. |
| R49 | `property_sensitive_access` (sanningskälla) | S | S *(objects_sensitive)* | – | L *(objects_access_assigned)*: egen tilldelad aktiv AO eller rondering, loggat | (separat) | EF `get-/set-sensitive-fields` + RPC `sensitive_fields_write` + `sensitive_access_audit` | D-05, D-16 | **Lokalt verifierad (T4-C, 2026-11-28):** `get-sensitive-fields` → RPC `sensitive_fields_read`: kontroll, läsning och revisionsrad (allowed/denied, utan värden) i en transaktion under delade lås på `vift_workOrders`/`vift_ronderingspass`; `objects_access_assigned` bara för objekt/fastighet på egen tilldelad aktiv AO (`nytt`/`planerad`/`pågående`, inte låst, inte pool); ronderingsgrenen (fastighetsnivå, eget aktivt pass) förberedd och aktiv först när `rondering_utfor` verkställs (T4-D). Ej installerad i STAGING |
| R50 | Dubbel lagring av portkod (blob och tabell) | Jämförelserapport, ingen migrering | | | | | Förberedelse: läsande jämförelse. **Ingen datamigrering nu.** | D-16 | Dubbel lagring · **Förberedelsen lokalt verifierad (T4-C):** läsande rapport `supabase/manual/t4c_d16_jamforelse/jamforelse.sql` (bara antal, READ ONLY). Ingen migrering |
| R51 | Radering av objekt med känsliga fält | S | S | – | – | – | RPC: atomisk borttagning av tabellraden vid permanent radering. Revisionsrad utan värde. Arkivering och mjuk radering behåller den. | D-23 | **Lokalt verifierad (T4-C, 2026-11-28):** triggern `vift_t4c_kanslig_radering` tar bort raden i samma transaktion vid permanent radering (objekt/fastighet ur listan), revisionsrad utan värden; arkivering/inaktivering behåller. Ej installerad i STAGING |
| R52 | Ronderingspass tilldelade: se och utföra | S | S | – | S *(rondering_utfor)* egna | (separat) | EF `rondering-pass-write` (ny gren per pass under lås i `rondering_*`-RPC) + PROJ | Ö3, D-04 | **Lokalt verifierad (T4-D, 2026-11-28):** passåtgärderna prövar per pass under radlåset (`ao_view_all` alla, `rondering_utfor` egna ej avslutade: 403 `not_assigned`/409 `pass_completed`); projektion per pass (egna pass, ronderingen utan pris och intern anteckning, inga mallar; REST bara `ao_view_all`); ronderingshändelser för egna pass. Ej installerad i STAGING |
| R53 | Ronderingar: mallar, schema, skapa pass, avvikelser | S | S *(ao_view_all)* | L | – | – | `store-key-write` + `rondering-pass-write` | Ö3 | Som målet för skrivning · **T4-D:** skapa pass, massskapa, migrera, mallar och ronderingar kräver `ao_view_all` (403 `forbidden`); läsning av ronderingar/pass/mallar i sin helhet bara `ao_view_all` (lokalt verifierad) |
| R54 | Inställningar: bankgiro (läsa) | L | L | L | – | – | PROJ | D-17 | Som målet (via intern-listan) · **Lokalt verifierad (T4-A, 2026-11-28):** bankgiro för interna roller (och `bankgiro_edit`); roller utan giltiga behörigheter får inga inställningar. Ej installerad i STAGING. |
| R55 | Inställningar: bankgiro (ändra) | S *(bankgiro_edit)* | – | – | – | – | RPC fältvis sammanslagning av settings | D-17 | `admin_manage` skriver hela nyckeln · **Lokalt verifierad (T4-A, 2026-11-28):** ändring kräver `bankgiro_edit` (403 `field_protected` i både `write` och `writeMerge`); utan den bevaras bankgiro. Ej installerad i STAGING. |
| R56 | Inställningar: övrigt | S *(admin_manage)* | L | L | Lp | Lp | RPC fältvis sammanslagning (konfliktsäker) | D-17 | Hela nyckeln skrivs, sista vinner vid 409-omförsök · **Lokalt verifierad (T4-A, 2026-11-28):** `writeMerge` för `vift_settings` fält för fält under radlås (D-17): olika fält från samtidiga sessioner tappas aldrig (SEC-INST-05 ×20), samma fält ger konflikt. Klienten (T4) sparar fält för fält; v3.4 skriver hela värdet med hash, skyddade fält bevaras då ändå. Ej installerad i STAGING. |

### 3.6 Export, cache, direkta vägar (D-18)

| # | Resurs/åtgärd | admin | chef | ekonomi | personal | begransad | Verkställs | Beslut | Nu |
|---|---|---|---|---|---|---|---|---|---|
| R57 | Export av register | S | *(export_data)* inom läsrätt | *(export_data)* | – | – | EXP (samma regel i snabbexport och Exportcenter) + PROJ | D-18 | Snabbexport saknar spärr (F12) |
| R58 | Export av personnummer | Aktivt val *(export_personal_data + personal_data_view)*, loggas | – | – (om inte tilldelat) | – | – | **EF (ny serverexport)** + logg. Klientspärren är bara presentation. | D-18, D-13 | **SÄK-1:** förvalt ikryssat |
| R59 | Export av portkod och nyckelinformation | Inte i normal export. Bara serverexport *(objects_sensitive + export_data)* med aktivt val och logg. | | | | | EF + logg | D-18 | Klientval med `objects_sensitive` |
| R60 | Export av lösenord, token, autentiseringsuppgifter, hemliga nycklar | Aldrig | | | | | EXP (konfiguration) + PROJ | D-18 | `sensitiveFields` för personal. Token tas bort av PROJ. |
| R61 | Lokal cache efter utloggning eller kontobyte | – | – | – | – | – | CACHE: alla `vift_*`-affärsnycklar rensas. Degraderad inläsning använder aldrig en annan användares cache. | – | **SÄK-9 lokalt åtgärdad (T3-A, 2026-11-28):** all användarspecifik cache rensas (uttrycklig behållningslista), cachen har en ägare (miljö + e-post), utkorgar ägarnycklade. Ej installerad i STAGING. |
| R62 | Direkt REST-skrivning till `store` | – (alla nycklar) | | | | | RLS `staging_generic_keys_no_direct_*`, `store_*_no_direct_*`, `store_direct_write_allowlist_*` (WITH CHECK false), TRG `protect_direct_write_allowlist` | – | **Lokalt verifierad (T4-A, tilläggsdel notiser, punkt 275):** vitlistan är avvecklad — även `vift_notifications` och `vift_lastChanged` nekas med 42501 `direct_write_blocked`; klienten gör inga direkta REST-skrivningar (notiser via `appendNotification`). Direkt REST-**läsning** av `vift_lastChanged` (pollsignalen) finns kvar. Ej installerad i STAGING. · *T3-C: vitlista `vift_notifications` + `vift_lastChanged` (servervärde)* · *tidigare: Nycklar utan affärsregel (t.ex. `vift_lastChanged`, okända nycklar) kan skrivas av alla aktiva via `store_active_write_safe` (F18)* |
| R63 | Direkt anrop av SECURITY DEFINER-RPC (`/rest/v1/rpc/...`) | – | – | – | – | – | Grants: EXECUTE bara för service_role. Undantag: `vift_caller_perms` och `vift_store_full_access` (RLS-hjälp). | – | Som målet enligt inventeringen §6 |

---

## 4. Felkodskatalog för negativa tester

Ett negativt test är **godkänt först när två villkor gäller:**
1. Svaret har exakt den angivna statuskoden och felkoden (`error`, och `reason` där det anges).
2. Kontrollsummorna (KS, §5.1) visar att ingen mutation skett.

Ett generiskt fel (500, `write_failed`, nätverksfel, `forbidden` utan `reason` där en `reason` krävs) är **underkänt**.

**Befintliga koder** (källor: `ao-time-write`, `store-key-write`, `invoice-write`, `work-order-checklist-resolve`, RLS):

| Status | `error` | Betydelse |
|---|---|---|
| 401 | `unauthorized` / `Unauthorized` | JWT saknas eller är ogiltig |
| 403 | `forbidden` | Behörighet saknas |
| 403 | `Forbidden` | Inte aktiv användare (`checkViftAuth`) |
| 403 | `forbidden_other` | Annans checklistpunkt eller loggpost |
| 403 | `append_only` | `vift_activityLog` via `write`/`writeMerge` |
| 400 | `key_not_allowlisted` | Nyckel utanför `KEY_PERMISSIONS` |
| 400 | `invalid_element`, `missing_fields`, `invalid_json`, `comment_required`, `invalid_type`, `invalid_reference`, `invalid_id` | Ogiltig indata |
| 400 | `forbidden_field` | `invoice-write`: otillåtet fält |
| 404 | `not_found` | Post saknas |
| 409 | `stale_write`, `missing_expected_hash`, `mass_wipe_blocked`, `duplicate_id_in_store`, `attested_locked`, `idempotency_key_conflict`, `id_collision` | Konflikt |
| 429 | `rate_limited` | Gräns |
| 410 | `disabled` | Avaktiverad EF |
| PostgREST 401/403, kod `42501` | – | RLS eller grant nekar (skrivning). SELECT som nekas ger **tom lista** med 200. |
| PostgREST, `P0001` med `direct_write_blocked` | – | TRG `_protect_critical_store_keys` |
| PostgREST 403, kod `42501`, meddelande `direct_write_blocked` | – | T3-C (F18): TRG `protect_direct_write_allowlist` + RESTRICTIVE `store_direct_write_allowlist_*` — direkt REST-skrivning utanför vitlistan. T4-A notiser (punkt 275): vitlistan är tom, så **all** direkt skrivning (även `vift_notifications`, `vift_lastChanged`) ger koden. UPDATE/DELETE av en rad som en RLS-policy döljer ger i stället 0 rader (PostgreSQL). |

**Nya koder som införs i T3/T4.** Felet bär alltid `error` + `reason`, så att testet kan skilja orsakerna åt. Den interna regelorsaken i `activities-policy.ts` (t.ex. `not_own`) returneras i dag inte till klienten. Det ändras. *(T3-D, lokalt: `not_own`, `field_<fält>`, `type_not_allowed` och `ref_not_visible` returneras nu.)*

| Status | `error` / `reason` | Används för |
|---|---|---|
| 403 | `forbidden` / `not_assigned` | Åtgärd på AO där anroparen inte är tilldelad (start, klar, material, tid, stämpling, bild, checklista, logg, åtkomstinformation) |
| 403 | `forbidden` / `pool_not_open` | Tagning eller poolprojektion av AO som inte är öppen pool |
| 409 | `already_assigned` | Tagning av AO som har personal (även när en samtidig tagning hann först) |
| 409 | `invalid_source_status` | Start eller klarmarkering från otillåten status |
| 409 | `ao_locked` | AO är `fakturerad`/`avbruten`/arkiverad/borttagen |
| 403 | `forbidden` / `invoice_path_required` | Faktureringsfält i `patch_ao` |
| 403 | `forbidden` / `not_own_row` | Annans materialrad |
| 200 | `ignoredFields:[…]` | Serverägda fält (pris, identitet, tid) som skickats av klienten ignoreras och redovisas. Lagrat värde = serverns. |
| 403 | `forbidden` / `field_protected` | Skrivning av skyddat fält utan rätt (portkod, personnummer, bankgiro, `buyPrice`) |
| 403 | `forbidden` / `privilege_escalation` | Tilldela eller skapa roll med behörighet utöver anroparens, eller ändra egen roll |
| 403 | `forbidden` / `superadmin_required` | Lägga till eller ta bort `all` utan `all` |
| 409 | `last_superadmin` | Ändring som ger 0 aktiva med `all` |
| 403 | `forbidden` / `not_own` | Uppgift som varken är egen eller tilldelad (D-15). T4-A: även bildradering av en bild som annans loggpost eller en checklistpunkt refererar (utan `ao_edit`). |
| 403 | `forbidden` / `type_not_allowed`, `ref_not_visible` | `appendActivity` (D-22). T4-A notiser: även `appendNotification` (typ som klienten inte får skapa; AO-referens som avsändaren inte ser eller som inte finns) |
| 403 | `forbidden` / `recipient_not_allowed` | `appendNotification`: mottagaren är inte aktiv personal, eller en egen påminnelse till någon annan (T4-A notiser) |
| 403 | `forbidden` / `recipient_not_assigned` | `appendNotification` `ao_assigned`: mottagaren är inte tilldelad AO:n (ingen falsk tilldelningsnotis, AP-D) |
| 400 | `invalid_entry` | `appendNotification`/`markNotificationsRead`: ogiltig indata (saknat eller för långt `requestId`, text över 500 tecken, fler än 500 id) |
| 403 | `forbidden` / `export_not_allowed`, `personal_data_not_allowed` | Serverexport (D-18) |
| 403 | `forbidden` / `price_group_not_allowed` | Prisgrupp som fältet inte får välja (D-11). T4-B: inaktiv grupp, annan än AO:ns grupp (fält), okänd grupp (alla) |
| 403 | `forbidden` / `row_path_required` | T4-B (D-19): fältets hela materiallista i `patch_ao` — fältet skriver radvis (`add_material`/`update_material`/`remove_material`) |
| 409 | `invoiced_locked` | T4-B (T3-B beslut 2): materialrad eller tidpost som en icke makulerad faktura (även utkast) gör anspråk på |
| 409 | `price_unknown` | T4-B (D-10): källrad med okänt pris i nytt underlag, eller utskick av underlag med rad utan à-pris |
| 409 | `price_mismatch` | T4-B: fakturaradens à-pris ≠ källans serverpris (eller grupperad rad med olika priser) |
| 409 | `included_in_fixed_price` | T4-B (D-10, R21): material (utan tillägg) eller tid på fastpris-AO som egen fakturarad |
| 409 | `source_not_billable`, `source_not_found`, `performed_date_required` | T4-B: ej debiterbar källa (t.ex. tid i ej löpande läge), saknad källa/borttagen AO, insats utan utförandedatum (VK-1) |
| 400 | `invalid_row`, `reason_required` | T4-B: ogiltig materialrad (antal, benämning, enhet, datum); rättning av tid utan orsak (5–500 tecken) |

---

## 5. Testfall

### 5.1 Gemensamma regler

**KS (kontrollsumma)** för varje berörd resurs, före och efter varje negativt anrop:
- **Store-nyckel:** SHA-256 av kanoniskt JSON (sorterade nycklar) för hela värdet, plus serverns hash från `readAllWithHashes`/`readHashes`.
- **AO och tid:** elementet plus `updatedAt` via `work-orders-list`/`time-entries-list` (ADM).
- **Tabeller:** `property_sensitive_access`, `sensitive_access_audit`, `op_idempotency` och `stamp_status`: antal rader och hash. Lokalt hela tabellen. I STAGING bara de märkta testraderna.
- **Lokalt även:** `vift_lastChanged` och `store.updated_at` ska vara oförändrade efter ett nekat anrop. I STAGING redovisas de som information, eftersom verkliga användare kan ändra dem samtidigt.

**Godkänt utfall:**
- **Negativt test (−):** rätt felkod och orsak enligt §4, och KS oförändrad. Undantag: en nekad åtkomst till känsliga fält *ska* ge exakt en revisionsrad `status='denied'` i `sensitive_access_audit`, och ingenting annat.
- **Positivt test (+):** rätt svar, och KS visar bara den avsedda ändringen.

**Vägar.** Varje rad prövas i de vägar som anges:

| Kod | Väg |
|---|---|
| R | REST/RLS direkt |
| E | Edge Function |
| P | RPC, lokalt direkt och via EF |
| K | Klient (UI) |
| C | Cache |
| X | Export |
| S | Simulerad server |

**Miljö:**

| Kod | Miljö |
|---|---|
| L | Lokal PostgreSQL med STAGING-replik (§2 i testplanen) |
| SG | STAGING, bara märkta testposter, med separat GO |
| W | Webbläsare (Playwright) mot den simulerade servern eller mot STAGING |

Destruktiva scenarier (hel nyckel, rollregister, inställningar, append-only-loggar) körs **bara i L**.

**Roller:**
- ADM, AL (`chef`), EK, FÄ, FÄ2 (`personal`), BE (`begransad`);
- egna anpassade roller enligt §5.13.

### 5.2 Arbetsordrar (R01–R12)

| ID | ± | Roll | Åtgärd | Vägar | Miljö | Förväntat (− = felkod + KS oförändrad) |
|---|---|---|---|---|---|---|
| SEC-AO-01 | + | FÄ | `work-orders-list` | E,S | L,SG | Bara egna + öppen pool (poolprojektion) |
| SEC-AO-02 | − | BE | `work-orders-list` | E,S | L,SG | Ingen öppen pool och inga andras AO |
| SEC-AO-03 | − | FÄ | REST `store?key=eq.vift_workOrders`, `readWithHash vift_workOrders` | R,E | L,SG | REST: 200 tom lista. EF: 400 `key_not_allowlisted`. Inga data. |
| SEC-AO-04 | + | AL, EK | `work-orders-list` | E | L,SG | Alla AO. EK utan pris-/TB-fält om `cost_view` saknas. |
| SEC-AO-05 | − | FÄ | `patch_ao {status:'klar'}` på ej tilldelad test-AO | E,P,S | L,SG | 403 `forbidden`/`not_assigned`, AO-KS oförändrad |
| SEC-AO-06 | − | FÄ | Samma på egen AO med status `fakturerad` | E,P,S | L,SG | 409 `ao_locked` |
| SEC-AO-07 | − | FÄ | Samma på egen AO med status `avbruten`, arkiverad, borttagen | E,P | L | 409 `ao_locked` |
| SEC-AO-08 | − | FÄ | `{status:'klar', completedBy:FÄ2, completedAt:'2000-01-01'}` på egen AO | E,P | L,SG | 200 med `ignoredFields:['completedBy','completedAt']`. Lagrat `completedBy` = FÄ och servertid. |
| SEC-AO-09 | + | FÄ | Klarmarkera egen AO med status `pågående` | E,P,S | L,SG | 200 |
| SEC-AO-10 | + | FÄ | Starta egen AO med status `planerad` | E,P,S | L,SG | 200, `pågående` |
| SEC-AO-11 | − | FÄ | Starta ej tilldelad AO | E,P | L,SG | 403 `not_assigned` |
| SEC-AO-12 | − | FÄ | Starta egen AO med status `klar` | E,P | L | 409 `invalid_source_status` |
| SEC-AO-13 | − | FÄ | `{status:'pågående', title:'x'}` | E | L,SG | 403 `forbidden` (otillåten fältkombination), KS oförändrad |
| SEC-AO-14 | − | FÄ + AL | Samtidigt: AL tar bort FÄ från AO:n, FÄ klarmarkerar | P | L | Kontrollen sker under lås. Antingen lyckas AL:s ändring först och FÄ får 403 `not_assigned`, eller tvärtom. Aldrig "klar" av en person som inte är tilldelad. |
| SEC-AO-15 | − | ADM, AL | `patch_ao {status:'fakturerad'}` / `{invoiceId:'X'}` | E,P,S | L,SG | 403 `invoice_path_required` |
| SEC-AO-16 | + | AL | Fakturering via `invoice-write` (`appendChecked`, `setStatus`) av test-AO | E,P | L | 200. AO-status enligt fakturaflödet. |
| SEC-AO-17 | − | FÄ, BE, EK | `delete_ao`, `permanent_delete_ao` | E | L,SG | 403 `forbidden` |
| SEC-AO-18 | − | FÄ | `work-orders-list`: `fixedPrice`, prisbelopp, `materials[].buyPrice/sellPrice` | E,S | L,SG | Fälten saknas. Debiteringskategori finns. |
| SEC-AO-19 | − | FÄ | `{fixedPrice:1}` på egen AO | E | L,SG | 403 `forbidden` |
| SEC-AO-20 | − | FÄ | Återanvänd idempotensnyckel från en lyckad patch med annan patch | P | L | 409 `idempotency_key_conflict` (F17, i dag returneras det sparade resultatet) |

### 5.3 Arbetspool (R03–R06, AP-A–AP-G)

Testdata, alla [E2E-TEST]:

| Id | `status` | `staff` | Datum | Övrigt |
|---|---|---|---|---|
| P1 | `pool` | `[]` | inget | |
| P2 | `pool` | `[FÄ2]` | inget | |
| P3 | `pool` | `[FÄ2]` | satt | |
| P4 | `pool` | `[]` | satt | |
| P5 | `pool` | `[]` | – | arkiverad |
| N1 | `planerad` | `[FÄ]` | inget | |
| N2 | `nytt` | `[]` | inget | |
| SI1 | `pool` | `[]` | inget | förfallodatum satt |

| ID | ± | Roll | Åtgärd | Vägar | Miljö | Förväntat |
|---|---|---|---|---|---|---|
| SEC-POOL-01 | + | FÄ | Lista | E,S,K | L,SG,W | P1, P4 och SI1 (öppen pool). N1 (egen). |
| SEC-POOL-02 | − | FÄ | Lista | E,S | L,SG | P2, P3, P5 och N2 syns **inte** |
| SEC-POOL-03 | − | BE, och egen roll "personal utan `ao_pool_take`" | Lista | E,S | L,SG | Ingen öppen pool |
| SEC-POOL-04 | − | FÄ | Poolpost P1: kundkontakt, telefon, e-post, `accessCode`, logg, material, checklista, bilder | E | L,SG | Saknas (poolprojektion, D-13) |
| SEC-POOL-05 | + | FÄ | Ta P1 | E,P,S | L,SG | 200. `staff=[FÄ]`, en `taken_from_pool`-post. P1 försvinner från FÄ2:s pool. |
| SEC-POOL-06 | − | FÄ | Ta P2 | E,P,S | L,SG | 409 `already_assigned` |
| SEC-POOL-07 | − | FÄ | Ta N2 / P5 | E,P | L | 403 `pool_not_open` |
| SEC-POOL-08 | − | FÄ | Ta P1 med `staff:[FÄ2]` | E,P | L,SG | 403 `forbidden` |
| SEC-POOL-09 | − | FÄ + FÄ2 | Samtidig tagning av P1 (olika nycklar, 20 upprepningar) | P | L | Varje gång: exakt en 200 och en 409 `already_assigned`. Slutläge: en person och en loggpost. |
| SEC-POOL-10 | − | EK, BE | Ta P1 | E | L,SG | 403 `forbidden` |
| SEC-POOL-11 | − | FÄ | **Före** tagning av P1: material, bilduppladdning, checkliststeg, loggpost, `create_time`, `setStampStatus` med `aoId`=P1 | E,P,S | L,SG | 403 `not_assigned` för alla. KS för AO, tid och `stamp_status` oförändrad. |
| SEC-POOL-12 | − | FÄ | Samma åtgärder på P2 | E,P | L,SG | 403 `not_assigned` |
| SEC-POOL-13 | + | FÄ | Efter tagning av P1: samma åtgärder | E,P | L,SG | 200 |
| SEC-POOL-14 | − | FÄ | Ta P1 som just tagits av FÄ2 (inaktuell klient) | E,P | L | 409 `already_assigned`. Klienten visar besked först efter serversvar (K). |
| SEC-POOL-15 | + | AL | Tilldela FÄ på P1 via personaldialogen | K,E | W,L | Bara `staff`/`responsibleStaffId` ändras. Status och datum oförändrade. Notis bara till faktiskt tillagd personal (AP-D, AP-G). |

### 5.4 Material och priser (R13–R25)

| ID | ± | Roll | Åtgärd | Vägar | Miljö | Förväntat |
|---|---|---|---|---|---|---|
| SEC-B1-01 | + | FÄ | Materialrad med artikel och mängd på egen AO | E,P,S | L,SG | 200. Servern sätter `sellPrice`/`buyPrice` från artikeln och `addedBy` = FÄ. **Lokalt grön (T4-B, `t4b_material_priser` E, P; S paritet B-ADD-art; K e2e T4B-01).** |
| SEC-B1-02 | + | FÄ | Fritextrad med benämning, mängd, enhet och dokumentation | E,P | L,SG | 200. `buyPrice=null`, `buyPriceUnknown`, `sellPrice=null`, `sellPriceUnknown`. Aldrig 0. **Lokalt grön (T4-B).** |
| SEC-B1-03 | − | FÄ | Materialrad med `buyPrice:1`, `sellPrice:1` | E,P | L,SG | 200 `ignoredFields:['buyPrice','sellPrice']`. Lagrat = artikel eller okänt. **Lokalt grön (T4-B).** |
| SEC-B1-04 | + | FÄ | Ändra och ta bort egen rad | E,P | L,SG | 200 **Lokalt grön (T4-B).** |
| SEC-B1-05 | − | FÄ | Ändra och ta bort FÄ2:s eller AL:s rad på egen AO | E,P | L,SG | 403 `not_own_row`, AO-KS oförändrad **Lokalt grön (T4-B).** |
| SEC-B1-06 | − | FÄ | Gammal väg: `patch_ao {materials:[…]}` (hel lista) | E | L,SG | 403 `forbidden` (hel lista nekas för fältet, D-19) **Lokalt grön (T4-B): 403 `forbidden`/`row_path_required`.** |
| SEC-B1-07 | − | FÄ + AL | Samtidigt: FÄ lägger till, AL tar bort annan rad | P | L | Båda ändringarna finns kvar. Ingen rad försvinner tyst. **Lokalt grön (T4-B, ×20).** |
| SEC-B1-08 | − | FÄ | Rad på fakturerad, arkiverad eller borttagen AO | E,P | L | 409 `ao_locked` **Lokalt grön (T4-B).** |
| SEC-B1-09 | − | FÄ, BE | `articles[].buyPrice`, `articles[].sellPrice` | R,E,S | L,SG | REST: ingen rad. EF: fälten saknas. **Lokalt grön (T4-A, `t4a_skyddade_falt` E, R; S paritet T4-ART-01/T4-REST-art; K e2e T4A-04).** Försäljningspriset för fält: **lokalt grönt (T4-B, E, R, S B-PG-falt, K T4B-01)**. |
| SEC-B1-10 | − | FÄ | Artikelväljare och materialrad | K | W | Inga belopp (inköp och försäljning) **Lokalt grön (T4-B, e2e T4B-01).** |
| SEC-B1-11 | + | AL, EK | `buyPrice`, TB | E | L,SG | Finns **Lokalt grön (T4-A, `t4a_skyddade_falt` E).** |
| SEC-B1-12 | − | Egen roll "chef utan `cost_view`" | Samma | E,K,X | L,W | Saknas i alla vägar, även export av `materialRow` **Lokalt grön (T4-A, `t4a_skyddade_falt` E; T3-E-testet SEC-CUST-01 exakt).** Export: T4-F. |
| SEC-B1-13 | + | EK | Komplettera okänt inköpspris | E,P | L,SG | 200. Flaggan tas bort. Logg. **Lokalt grön (T4-A, `t4a_skyddade_falt` E, för artikeln).** Materialradens okända pris: **lokalt grönt (T4-B, E, P; loggas i AO:n)**. |
| SEC-B1-14 | − | FÄ; egen roll "chef utan `cost_edit`" | Samma | E,P | L | 403 `field_protected` **Lokalt grön (T4-A, `t4a_skyddade_falt` E, artikel och materialrad; SEC-CUST-02).** |
| SEC-B1-15 | + | EK | Fakturaunderlag med okänt försäljningspris | P | L | Stoppat eller flaggat (`_invoice_financial_check`). Ingen summa 0. **Lokalt grön (T4-B): skapande 409 `price_unknown`, utskick 409 `price_unknown`.** |
| SEC-B1-16 | + | EK | Fastpris-AO med fältmaterial | P | L | Materialet debiteras inte separat om det inte uttryckligen är markerat som tillägg **Lokalt grön (T4-B): 409 `included_in_fixed_price`; tillägg debiteras.** |
| SEC-B1-17 | − | FÄ | `writeMerge vift_articles` (testartikel) | E | L,SG | 403 `forbidden` **Lokalt grön (T4-A, `t4a_skyddade_falt` E).** |
| SEC-B2-01 | − | FÄ | `priceGroups[].hourRate`, `timeEntries[].hourRate` | R,E,S | L,SG | Saknas. Gruppnamn finns. **Lokalt grön (T4-B).** |
| SEC-B2-02 | − | FÄ | Stämpla ut, Tid-sidan, AO-detaljens tidrader | K | W | Inga belopp **Lokalt grön (T4-B, e2e T4B-04).** |
| SEC-B2-03 | − | FÄ | `create_time` med `hourRate:9999` | E,P | L,SG | 200 `ignoredFields:['hourRate']`. Lagrat = prisgruppens timpris. **Lokalt grön (T4-B).** |
| SEC-B2-04 | − | FÄ | `create_time` med en prisgrupp som inte är tillåten för fält | E,P | L | 403 `price_group_not_allowed` **Lokalt grön (T4-B).** |
| SEC-B2-05 | + | ADM | Ändra prisgruppens timpris efter registrerad tid | E | L | Befintliga tidposters `hourRate` oförändrat **Lokalt grön (T4-B).** |
| SEC-B2-06 | − | FÄ, BE, egen roll "chef utan `cost_view`" | `settings.internalHourlyCost` | R,E | L,SG | Saknas **Lokalt grön (T4-A, `t4a_skyddade_falt` E, R; S paritet T4-INST-03).** |

### 5.5 Tid, fakturering (R26–R32)

| ID | ± | Roll | Åtgärd | Vägar | Miljö | Förväntat |
|---|---|---|---|---|---|---|
| SEC-TID-01 | + | FÄ | `create_time` på egen tilldelad AO | E,P | L,SG | 200, `staffId`=FÄ |
| SEC-TID-02 | − | FÄ | `create_time` på ej tilldelad AO, öppen pool eller påhittat `aoId` | E,P,S | L,SG | 403 `not_assigned` (påhittat: 404 `not_found`). Tid-KS och AO-KS oförändrade. I dag läggs id:t även in i AO:ns `timeEntries` (F16). |
| SEC-TID-03 | − | FÄ | `setStampStatus {active:true, aoId:<ej tilldelad>}` | E,P | L,SG | 403 `not_assigned`, `stamp_status`-KS oförändrad (F23) |
| SEC-TID-04 | − | FÄ | `create_time` med `staffId`=FÄ2 | E | L,SG | 403 `forbidden` |
| SEC-TID-05 | − | FÄ | `patch_time` på FÄ2:s post / egen attesterad post | E,P | L,SG | 403 `forbidden` / 409 `attested_locked` |
| SEC-TID-06 | + | AL | `time-entries-list` | E | L,SG | Alla tidposter. Utan `hourRate` om `cost_view`/`invoice_*` saknas. **Lokalt grön (T4-B): all personals tid utan attest/löneuppgifter.** |
| SEC-TID-07 | − | AL | `attest_time` | E | L,SG | 403 `forbidden` **Lokalt grön (T4-B).** |
| SEC-TID-08 | − | AL | Sidan Löneunderlag och lönexport | K,X | W | Ej åtkomlig (`payroll_view` saknas) |
| SEC-TID-09 | − | FÄ, BE | `time-entries-list` | E,S | L,SG | Bara egna **Lokalt grön (T4-B), utan `hourRate`.** |
| SEC-FAKT-01 | − | FÄ, BE | `invoices` via REST, `readAllWithHashes` | R,E,S | L,SG | REST: tom lista. EF: tom array. |
| SEC-FAKT-02 | + | AL, EK | Samma | R,E | L,SG | Finns |
| SEC-FAKT-03 | − | FÄ, egen roll "chef utan `invoice_create`" | `invoice-write` (alla åtgärder) | E | L | 403 `forbidden` |
| SEC-FAKT-04 | − | alla | `writeMerge vift_invoices` | E | L,SG | 400 `key_not_allowlisted` |
| SEC-FAKT-05 | − | alla | REST PATCH `store?key=eq.vift_invoices` | R | L | `42501`. KS oförändrad. |
| SEC-FAKT-06 | + | EK | Underlag med `internalNote` "INTERN-[runId]" och `customerNote` "KUND-[runId]" → kund-PDF | K/E | L,W | PDF:en innehåller KUND, **inte** INTERN |
| SEC-FAKT-07 | − | EK | Äldre underlag med bara `note` → ny kund-PDF | K/E | L,W | `note` finns inte i PDF:en. Ingen data ändrad (D-20). |
| SEC-FAKT-08 | + | EK | Ett redan utfärdat underlag | K | L | Historisk text och historiskt dokument oförändrade |

### 5.6 Offerter, kunder (R33–R37)

| ID | ± | Roll | Åtgärd | Vägar | Miljö | Förväntat |
|---|---|---|---|---|---|---|
| SEC-OFF-01 | − | FÄ, BE | `offers` | R,E,S | L,SG | Bara offerter kopplade till egen AO, med id, titel och status. Övriga saknas. **Lokalt grön (T3-D, `t3d_informationsatkomst` E, R; S paritet OFF-falt/OFF-begransad, REST; K e2e T3D-03).** |
| SEC-OFF-02 | − | FÄ | `offers[].lines`, belopp, token | E | L,SG | Saknas **Lokalt grön (T3-D, `t3d_informationsatkomst` E; K e2e T3D-03).** |
| SEC-OFF-03 | − | EK | `publicToken`, `customerApproval`, `lockedSnapshotJSON`, `internalNote` | R,E | L,SG | Saknas |
| SEC-OFF-04 | − | FÄ, EK | `writeMerge vift_offers` (testoffert) | E | L,SG | 403 `forbidden` |
| SEC-OFF-05 | − | FÄ | `offer-pdf`, `send-offer-email`, `offer-attachment-url` | E | L | 403 `forbidden` |
| SEC-OFF-06 | − | oinloggad | `offer-respond` med ogiltig eller utgången token | E | L | 4xx enligt EF. Offert-KS oförändrad. |
| SEC-KUND-01 | − | FÄ | `customers`, `properties`, `propertyObjects`, `propertyContacts` | E,S | L,SG | Bara poster kopplade till egna AO, och begränsat för öppen pool **Lokalt grön (T3-D, `t3d_informationsatkomst` E för fält, FÄ2, begränsad och egna roller; S paritet KUND-*).** |
| SEC-KUND-02 | − | FÄ, BE | REST `vift_customers` | R | L,SG | Tom lista **Lokalt grön (T3-D, `t3d_informationsatkomst` R för fält, begränsad och tom roll; S paritet REST-*).** |
| SEC-KUND-03 | − | Egen roll med `ao_view_all` + `sales_manage` utan `personal_data_view` | `customers[].personnr`, `orgNr` för privatperson | R,E,X | L,SG | Saknas i alla vägar (D-13) **Lokalt grön (T4-A, `t4a_skyddade_falt` E, R; T3-E-testet SEC-CUST-20 exakt; S paritet T4-KUND-LAS).** Export (X): T4-F. |
| SEC-KUND-04 | + | EK | Samma | E | L,SG | Finns **Lokalt grön (T4-A, `t4a_skyddade_falt` E; K e2e T4A-02).** |
| SEC-KUND-05 | − | AL utan `personal_data_view` | Spara testkund utan `personnr` | E,P | L | Lagrat `personnr` oförändrat (fältvis sammanslagning) **Lokalt grön (T4-A, `t4a_skyddade_falt` E, P; S paritet T4-KUND-01; K e2e T4A-02).** |
| SEC-KUND-06 | − | AL utan `personal_data_view` | Spara testkund med `personnr:'X'` | E,P | L | 403 `field_protected` **Lokalt grön (T4-A, `t4a_skyddade_falt` E; S paritet T4-KUND-02).** |

### 5.7 Personal och roller (R38–R43, D-21, D-25)

**Alla SEC-ROLL körs bara lokalt.** Rollregistret och personalregistret är destruktiva scenarier.

| ID | ± | Roll | Åtgärd | Vägar | Miljö | Förväntat |
|---|---|---|---|---|---|---|
| SEC-B3-01 | + | FÄ | Kollegors namn, titel och arbetskontakt | E | L,SG | Finns **Lokalt grön (T3-C, `t3c_roller`, E).** **T3-D:** bara namn, titel och arbetskontakt (inga skyddade personaluppgifter), `t3d_informationsatkomst` E, S paritet B3-falt. |
| SEC-B3-02 | + | FÄ | Egen post med e-post. Inloggning löser rätt användare. | E,K | L,W | Ja **Lokalt grön (T3-C: `t3c_roller` E, e2e T3C-04 K).** |
| SEC-B3-03 | − | FÄ, EK | Andras `permissions` och `role` | R,E,S | L,SG | Saknas **Lokalt grön (T3-C: R tom lista, E projektion, S paritet B3-03/03e).** AL (staff_view) får andras `role` men inte `permissions` (R40). |
| SEC-B3-04 | − | BE | Kontaktuppgifter till personal som inte finns på egna AO | E | L,SG | Saknas **Lokalt grön (T3-D, `t3d_informationsatkomst` E; S paritet B3-begransad).** |
| SEC-B3-05 | − | FÄ, AL | `vift_roles`: andras roller | R,E | L,SG | Bara egen effektiv roll **Lokalt grön (T3-C: R tom lista, E bara egen roll, även readWithHash).** Med `staff_manage` även de roller man får tilldela. |
| SEC-B3-06 | + | Egen roll med `admin_manage` | `vift_roles` | E | L | Alla roller **Lokalt grön (T3-C, E och R).** |
| SEC-ROLL-01 | − | Egen roll med `staff_manage` | Sätta egen `role:'admin'` | E,P | L | 403 `privilege_escalation` **Lokalt grön (T3-C: E, P, S; klient T3C-01).** |
| SEC-ROLL-02 | − | Egen roll med `staff_manage` | Ge annan en roll med `all` eller med behörighet utöver anroparens | E,P | L | 403 `privilege_escalation` / `superadmin_required` **Lokalt grön (T3-C: E, P, S; även nyskapad post, inaktivering/e-postbyte av superadmin och e-postkapning).** |
| SEC-ROLL-03 | − | Egen roll med `admin_manage` (utan `all`) | Lägga till `all` i en roll, eller lägga till behörighet i egen roll | E,P | L | 403 `superadmin_required` / `privilege_escalation` **Lokalt grön (T3-C: E, P, S; klient T3C-02).** |
| SEC-ROLL-04 | − | ADM (ensam aktiv `all`) | Inaktivera sig själv / byta egen roll / ta bort `all` från rollen / radera rollen | E,P | L | 409 `last_superadmin` **Lokalt grön (T3-C: E (merge och hel skrivning), P (`deactivate_vift_user`, RPC), S; klient T3C-03).** |
| SEC-ROLL-05 | − | ADM + ADM2 | Samtidigt inaktivera varandra (50 upprepningar) | P | L | Aldrig 0 aktiva med `all`. Exakt en lyckas. **Lokalt grön (T3-C: 50 × `deactivate_vift_user` med egna anslutningar och 50 × via store-key-write med barriär).** |
| SEC-ROLL-06 | − | ADM + ADM2 | Samtidigt: en ändrar rollens behörigheter, en byter roll på sista superadmin | P | L | Invarianten håller (gemensamt lås för `vift_staff` + `vift_roles`) **Lokalt grön (T3-C: 50 × E med barriär och 50 × P mot `deactivate_vift_user`).** |
| SEC-ROLL-07 | + | ADM | Inaktivera ADM2 när ADM finns kvar | E,P | L | 200 **Lokalt grön (T3-C: E, P, S).** |
| SEC-ROLL-08 | + | Egen superadminroll med annat id än `admin` | Allt som ADM får | E | L | Fungerar (ingen hårdkodning på roll-id) **Lokalt grön (T3-C: E; klient T3C-05).** |
| SEC-ROLL-09 | − | Roll med id `admin` **utan** `all` | Superadminåtgärder | E,P,K | L,W | Nekas. Klienten visar inga superadminval. **Lokalt grön (T3-C: E; klient T3C-05).** |
| SEC-ROLL-10 | − | Inloggning utan personalpost | Klientens meny | K,C | W | Ingen fältbehörighet (SÄK-10). Servern svarar 403 `Forbidden`. **Lokalt grön (T3-A, `36_client_security`).** |

### 5.8 Aktivitetslogg och uppgifter (R44–R47)

`appendActivity` är append-only och kapas vid 500 poster. Därför körs SEC-B4-05/06 bara lokalt.

| ID | ± | Roll | Åtgärd | Vägar | Miljö | Förväntat |
|---|---|---|---|---|---|---|
| SEC-B4-01 | + | AL, EK, ADM | `activityLog` | E | L,SG | Alla poster **Lokalt grön (T3-D, `t3d_informationsatkomst` E).** |
| SEC-B4-02 | − | FÄ | `activityLog` | R,E,S | L,SG | Bara poster med `workOrderId` för egna AO. Inga offert-, faktura-, kund- eller personalposter. REST: tom lista. **Lokalt grön (T3-D, `t3d_informationsatkomst` E, R; S paritet B4-*, REST-*).** |
| SEC-B4-03 | − | FÄ | Poster om AO i **tilldelad pool** för FÄ2 | E | L,SG | Saknas (bygger på rättad poolregel) **Lokalt grön (T3-D, `t3d_informationsatkomst` E; S paritet B4-falt).** |
| SEC-B4-04 | − | alla | `write`/`writeMerge vift_activityLog` | E | L | 403 `append_only` **Lokalt grön (T3-D, `t3d_informationsatkomst` E, även admin, och R via F18-vitlistan; S paritet B4-04).** |
| SEC-B4-05 | − | FÄ | `appendActivity` med typ `invoice_created` | E | L | 403 `type_not_allowed`. Logg-KS oförändrad. **Lokalt grön (T3-D, `t3d_informationsatkomst` E och P; S paritet B4-05; K e2e T3D-04).** |
| SEC-B4-06 | − | FÄ | `appendActivity` med `workOrderId` för en ej tilldelad AO | E | L | 403 `ref_not_visible` **Lokalt grön (T3-D, `t3d_informationsatkomst` E och P, även öppen pool, annans kund/offert/faktura; samtidighet ×20 under lås; S paritet B4-06*; K e2e T3D-04).** |
| SEC-B4-07 | − | FÄ | UI: dashboardens senaste händelser och AO-historik | K | W | Bara egna. Klientrapporterade poster märks inte som revisionshistorik (D-22). **Lokalt grön (T3-D, e2e T3D-01/03: dashboard och AO-historik visar bara egna, märkta "inte en revisionslogg"/"klientrapport").** |
| SEC-TASK-01 | + | FÄ | Skapa egen uppgift, klarmarkera tilldelad, radera egen | E | L,SG | 200 **Lokalt grön (T3-D, `t3d_informationsatkomst` E; S paritet TASK-01; K e2e T3D-01).** |
| SEC-TASK-02 | − | FÄ | Skapa uppgift tilldelad FÄ2 | E | L,SG | 403 `not_own` (i dag `forbidden` utan orsak). KS oförändrad. **Lokalt grön (T3-D, `t3d_informationsatkomst` E 403 `not_own`; S paritet TASK-02; K e2e T3D-01).** |
| SEC-TASK-03 | − | FÄ | Ändra titel på tilldelad uppgift skapad av AL | E | L,SG | 403 `forbidden`/`field_title` **Lokalt grön (T3-D, `t3d_informationsatkomst` E 403 `field_title`; S paritet TASK-03).** |
| SEC-TASK-04 | − | FÄ | `activities`: FÄ2:s och offertkopplade uppgifter | R,E,S,K | L,SG,W | Saknas. **SÄK-2.** **Lokalt grön (T3-D, `t3d_informationsatkomst` R, E; S paritet TASK-*; K e2e T3D-01). SÄK-2 åtgärdad lokalt.** |
| SEC-TASK-05 | − | EK | Ändra annans uppgift | E,K | L,W | 403 `not_own`. Klienten visar ingen redigeringsknapp (D-15). **Lokalt grön (T3-D, `t3d_informationsatkomst` E 403 `not_own`; S paritet TASK-05; K e2e T3D-02: ingen redigeringsknapp).** |
| SEC-TASK-06 | + | AL | Ändra FÄ:s uppgift | E | L,SG | 200 **Lokalt grön (T3-D, `t3d_informationsatkomst` E; S paritet TASK-06; K e2e T3D-02).** |
| SEC-NOTIF-01 | − | alla, även ADM | `notifications` | R,E,S,K | L,SG,W | Bara egna (`userId` = egen personalpost); REST 0 rader; poster utan mottagarfält till ingen. **Lokalt grön (T4-A notiser, `t4a_notiser` E för 12 användare, R; S paritet N-LAS-*, N-REST-LAS*; K e2e NOTIF-05).** |
| SEC-NOTIF-02 | + | AL | `appendNotification` `ao_assigned` till tilldelad FÄ efter bekräftad tilldelning | E,K | L,W | 200; servern sätter `createdBy`, `createdAt`, `id`, `read:false`, text ur AO:n; bara mottagaren ser den. **Lokalt grön (`t4a_notiser` E; S N-APP-chef; K e2e NOTIF-02 personaldialog och bulk).** |
| SEC-NOTIF-03 | − | FÄ | `appendNotification` `ao_assigned` åt FÄ2 | E,S,K | L,W | 403 `type_not_allowed`. KS oförändrad. **Lokalt grön (`t4a_notiser`; S N-APP-falt; K e2e NOTIF-04).** |
| SEC-NOTIF-04 | − | AL | `ao_assigned` till inaktiv/okänd personal; egen påminnelse åt annan | E,S | L | 403 `recipient_not_allowed`. KS oförändrad. **Lokalt grön.** |
| SEC-NOTIF-05 | − | AL | `ao_assigned` åt FÄ2 för AO där FÄ2 inte är tilldelad | E,S | L | 403 `recipient_not_assigned` (AP-D). **Lokalt grön.** |
| SEC-NOTIF-06 | − | egen roll med `ao_edit` utan `ao_view_all` | `ao_assigned` för AO som avsändaren inte ser | E,S | L | 403 `ref_not_visible`. **Lokalt grön.** |
| SEC-NOTIF-07 | − | FÄ, ADM | `markNotificationsRead` med andras och okända id | E,S,K | L,W | 200 `marked:0`, `ignored:n`; andras notiser orörda (inget orakel). **Lokalt grön (`t4a_notiser`; S N-MARK-*; K e2e NOTIF-03).** |
| SEC-NOTIF-08 | − | alla | REST-upsert `[vift_notifications, vift_lastChanged]` (v3.4/T3/T4-A `persistNotifs`) | R,K | L,W | 403 `42501` `direct_write_blocked`; ingen dataförlust; andra flöden fungerar. **Lokalt grön (`t4a_notiser` R; S N-REST-*; K e2e NOTIF-04/06, T3C-07).** |
| SEC-NOTIF-09 | − | AL ×2, FÄ | Samtidighet ×20: samma `requestId`; samma mottagare och AO från två avsändare; ny notis medan mottagaren markerar alla lästa; 20 parallella anslutningar | E | L | Exakt en post skapas; inga förlorade uppdateringar; inga deadlocks (låsordning AO → notiser → `vift_lastChanged`). **Lokalt grön (`t4a_notiser`).** |

### 5.9 Portkoder (R48–R51)

| ID | ± | Roll | Åtgärd | Vägar | Miljö | Förväntat |
|---|---|---|---|---|---|---|
| SEC-B5-01 | − | Egen roll "chef utan `objects_sensitive`" | `propertyObjects`, `recurringOrders`, `workOrders` → skyddade fält | R,E,S,X | L,SG | Saknas i alla vägar, även som skrivare. **SÄK-7.** **Lokalt grön (T4-A, `t4a_skyddade_falt` E, R; S paritet T4-OBJ-LAS/T4-WOL-01; K e2e T4A-01).** Export (X): T4-F. |
| SEC-B5-02 | + | Samma | Spara testobjekt utan skyddade fält | E,P | L,SG | 200. Skyddade fält oförändrade. **Lokalt grön (T4-A, `t4a_skyddade_falt` E, P; S paritet T4-OBJ-01; K e2e T4A-01).** |
| SEC-B5-03 | − | Samma | Spara med `doorCode:''` / `'1234'` | E,P | L,SG | 403 `field_protected`. Objekt-KS oförändrad. **Lokalt grön (T4-A, `t4a_skyddade_falt` E, P, även tomt värde, samma värde (inget orakel) och ny post; S paritet T4-OBJ-02; K e2e T4A-01).** |
| SEC-B5-04 | − | ADM + AL samtidigt | ADM ändrar portkod, AL ändrar namn | P | L | Båda ändringarna kvar **Lokalt grön (T4-A, `t4a_skyddade_falt` ×20 parallella anrop med barriär: ingen bekräftad ändring förlorad, portkoden aldrig raderad; ADM:s inaktuella element nekas som konflikt utan mutation).** |
| SEC-B5-05 | − | AL med inaktuell läsning | Sparar namn efter ADM:s portkodsändring | P | L | Portkoden är ADM:s nya värde **Lokalt grön (T4-A, `t4a_skyddade_falt` P under radlås).** |
| SEC-B5-06 | + | FÄ | `get-sensitive-fields` för objekt på egen tilldelad aktiv AO | E | L,SG | 200, en revisionsrad `allowed` utan värden  **Lokalt grön (T4-C, `t4c_atkomstinformation` E, P ×20; S paritet C-AO-egen/C-FAST; K e2e T4C-01).** |
| SEC-B5-07 | + | FÄ | Samma för tilldelad rondering | E | L | 200 + revisionsrad **T4-C: grenen förberedd. Lokalt grön (T4-D, 2026-11-28): aktiv — eget aktivt pass 200 + allowed-rad; annans/avslutat pass, objektnivå och utan `rondering_utfor` 403 `not_assigned` (S C-PASS-D/klar).** |
| SEC-B5-08 | − | FÄ | Objekt på annans AO, öppen pool, klar AO | E | L,SG | 403 `not_assigned`. Exakt en revisionsrad `denied`, inget annat ändrat.  **Lokalt grön (T4-C: 13 fall + TOCTOU ×20; S paritet C-AO-annans/klar/pool, C-OBJ-annat; K e2e T4C-02).** |
| SEC-B5-09 | − | BE (utan `objects_access_assigned`) | Egen AO | E | L,SG | 403 `forbidden`, en `denied`-rad  **Lokalt grön (T4-C: begränsad, egen roll utan `objects_access_assigned`, tom lista; S paritet C-BE; K e2e T4C-02).** |
| SEC-B5-10 | − | AL, EK, FÄ | `set-sensitive-fields` | E,P | L | 403, en `denied`-rad  **Lokalt grön (T4-C, oförändrad EF: 403 `Forbidden` + en denied-rad).** |
| SEC-B5-11 | − | alla | REST `property_sensitive_access`, ändra eller radera `sensitive_access_audit` | R | L,SG | Tom lista / `42501`  **Lokalt grön (T4-C).** |
| SEC-B5-12 | + | ADM | Permanent radering av testobjekt | P | L | Tabellraden borttagen i samma transaktion. Revisionsrad utan portkod. Vid arkivering finns raden kvar (D-23).  **Lokalt grön (T4-C, även ×20 radering/läsning; K e2e T4C-03).** |
| SEC-B5-13 | + | ADM (läsande, lokalt mot replik) | Jämförelse blob mot tabell | P | L | Rapport med antal: lika, olika, saknas. Inga värden, ingen ändring (D-16).  **Lokalt grön (T4-C).** |

### 5.10 Rondering (R52–R53)

| ID | ± | Roll | Åtgärd | Vägar | Miljö | Förväntat |
|---|---|---|---|---|---|---|
| SEC-ROND-01 | + | FÄ | Läsa och utföra eget testpass (`rondering_point_patch`, `rondering_pass_complete`) | E,P | L,SG | 200  **Lokalt grön (T4-D, `t4d_rondering` E, P ×20; S paritet R-*-egen; K e2e T4D-01).** |
| SEC-ROND-02 | − | FÄ | Samma på FÄ2:s pass | E,P | L,SG | 403 `not_assigned`, pass-KS oförändrad  **Lokalt grön (T4-D: 6 fall + TOCTOU ×20; S R-PATCH-annans/okand; K T4D-02).** |
| SEC-ROND-03 | − | FÄ | `rondering_pass_create`, `rondering_passes_bulk_create`, mallar | E | L | 403 `forbidden`  **Lokalt grön (T4-D: create, bulkCreate, migrateLegacy, mallar, ronderingar; S R-CREATE/BULK-falt; K T4D-02).** |
| SEC-ROND-04 | − | BE, egen roll "personal utan `rondering_utfor`" | Eget pass | E | L,SG | 403 `forbidden`  **Lokalt grön (T4-D: begränsad, egen roll utan `rondering_utfor` på eget pass, tom lista; S R-BE; K T4D-02).** |
| SEC-ROND-05 | − | alla | REST-skrivning `vift_ronderingspass` | R | L | `42501`  **Lokalt grön (T4-D; REST-läsning 0 rader utan `ao_view_all`).** |

### 5.11 Inställningar (R54–R56), bara lokalt

| ID | ± | Roll | Åtgärd | Förväntat |
|---|---|---|---|---|
| SEC-INST-01 | − | FÄ, BE | Läsa `bankgiro`, `internalHourlyCost` | Saknas **Lokalt grön (T4-A, `t4a_skyddade_falt` E).** |
| SEC-INST-02 | + | AL, EK | Läsa `bankgiro` | Finns **Lokalt grön (T4-A, `t4a_skyddade_falt` E).** |
| SEC-INST-03 | − | Egen roll med `admin_manage` utan `bankgiro_edit` | Ändra `bankgiro` | 403 `field_protected`. Settings-KS oförändrad. **Lokalt grön (T4-A, `t4a_skyddade_falt` E, write och writeMerge; S paritet T4-INST-01; K e2e T4A-03).** |
| SEC-INST-04 | − | Samma | Spara annan inställning med projicerat värde utan `bankgiro` | 200. `bankgiro` oförändrat. **Lokalt grön (T4-A, `t4a_skyddade_falt` E, write och writeMerge; S paritet T4-INST-02; K e2e T4A-03).** |
| SEC-INST-05 | − | ADM + ADM2 samtidigt | Olika fält | Båda finns kvar **Lokalt grön (T4-A, `t4a_skyddade_falt` ×20 parallella anrop; samma fält ×20: exakt en vinner; K e2e T4A-03).** |
| SEC-INST-06 | − | AL, EK, FÄ | `write vift_settings` | 403 `forbidden` **Lokalt grön (T4-A, `t4a_skyddade_falt` E).** |
| SEC-INST-07 | − | ADM | `write` utan eller med inaktuell hash | 409 `missing_expected_hash` / `stale_write` **Lokalt grön (T4-A, `t4a_skyddade_falt` E).** |

### 5.12 Export, cache, direkta vägar, simulerad server (R57–R63)

| ID | ± | Roll | Åtgärd | Vägar | Miljö | Förväntat |
|---|---|---|---|---|---|---|
| SEC-EXP-01 | − | FÄ, BE, egen roll "chef utan `export_data`" | Exportcenter, snabbexport (alla listsidor), serverexport | K,X,E | W,L | Ingen export. Serverexport: 403 `export_not_allowed`. |
| SEC-EXP-02 | + | AL | Export av AO, kunder, material | X | W | Bara fält och poster som AL får läsa |
| SEC-EXP-03 | − | ADM | Kunder: startläge i Exportcenter och snabbexport | K,X | W | Personnummer är **inte** valt (SÄK-1) |
| SEC-EXP-04 | − | Egen roll med `export_data` + `personal_data_view` utan `export_personal_data` | Välja personnummer / serverexport | K,X,E | W,L | Valet saknas. Serverexport: 403 `personal_data_not_allowed`. |
| SEC-EXP-05 | + | ADM | Aktivt val av personnummer | E,X | L,W | Finns, och exporthändelsen loggas på servern |
| SEC-EXP-06 | − | alla | Lösenord, token, `publicToken`, autentiseringsuppgifter | X | W | Finns aldrig |
| SEC-EXP-07 | − | ADM | Normal export av objekt och AO | X | W | Ingen portkod och ingen nyckelinformation |
| SEC-EXP-08 | − | FÄ | Snabbexport av AO via konsolen | X,C | W | Bara egna AO. Inga prisfält, ingen portkod. |
| SEC-CACHE-01 | − | ADM → utloggning → FÄ på samma profil | `localStorage` | C | W | Inga `vift_*`-affärsnycklar från ADM (fältnamnskontroll). **SÄK-9.** Lokalt grön (T3-A). |
| SEC-CACHE-02 | − | FÄ, nätet avstängt vid inloggning | Degraderad inläsning | C | W | Ingen data från föregående användare. Lokalt grön (T3-A). |
| SEC-CACHE-03 | − | Kontobyte i annan flik | Lyssnaren för flikbyte | C | W | Samma rensning. Lokalt grön (T3-A). |
| SEC-REST-01 | − | FÄ | REST INSERT/UPDATE/DELETE för affärsnycklar (alla 28), AO, tid, fakturor, `offerAttachments`, `ronderingspass`, `projectDocuments` | R | L | `42501` eller `direct_write_blocked`. KS oförändrad. **Lokalt grön (T3-C):** upsert (INSERT … ON CONFLICT) av alla 28 + 6 nycklar → 42501 `direct_write_blocked` (AO/tid/fakturor: P0001 från befintlig trigger); UPDATE/DELETE av rader som befintliga RESTRICTIVE-policyer döljer ger 0 rader (PostgreSQL rapporterar inget fel för dolda rader); KS oförändrad. |
| SEC-REST-02 | − | FÄ | REST INSERT av okänd nyckel `vift_e2e_<runId>` och UPDATE av `vift_lastChanged` | R | L | Nekas efter T3 (F18). I dag tillåtet, vilket dokumenteras i baslinjen. **Lokalt grön (T3-C):** okänd nyckel 42501 (INSERT, UPDATE, DELETE). **Avvikelse (Beslut som behövs):** `vift_lastChanged` står kvar på vitlistan för klientens notisväg, men värdet sätts av servern (klientens värde sparas aldrig); DELETE nekas. | **T4-A notiser (punkt 275): avvikelsen stängd lokalt** — `vift_lastChanged` och `vift_notifications` nekas nu med 42501 (`t4a_notiser` R; S N-REST-LC).
| SEC-REST-03 | − | FÄ | REST `rpc/work_order_patch`, `rpc/store_business_key_write`, `rpc/sensitive_fields_write`, `rpc/time_entry_create` | R | L | `42501` (EXECUTE saknas) **Lokalt grön (T3-C):** även T3-B:s nya signaturer, `work_order_pool_take`, `work_order_billing_set` och T3-C-funktionerna; bara de två RLS-hjälparna är körbara för authenticated. |
| SEC-REST-04 | + | FÄ | REST `rpc/vift_caller_perms` | R | L | Bara egna behörigheter **Lokalt grön (T3-C).** |
| SEC-SIM-01 | + | – | Hela SEC-AO, SEC-POOL, SEC-B1, SEC-TASK och SEC-B4 mot `fake-backend.js` | S | L | Samma utfall och felkoder som den lokala replikan (paritet). Avvikelse = fel i den simulerade servern. |

### 5.13 Egna anpassade roller (D-26)

Varje rad är en **egen roll** = standardroll minus en enskild behörighet, eller en minimal roll. Den saknade behörigheten ska stängas i **alla** vägar.

| ID | Egen roll | Prövas | Förväntat |
|---|---|---|---|
| SEC-CUST-01 | `chef` − `cost_view` | Inköpspris och TB i EF, UI och export | Saknas (SEC-B1-12) ~~T3-E: verkningslös nu~~ **Lokalt grön (T4-A): exakt de beslutade skillnaderna (artiklar, inställningar, materialradernas inköpspris, REST).** Export: T4-F. |
| SEC-CUST-02 | `chef` − `cost_edit` | Komplettera inköpspris | 403 `field_protected` **Lokalt grön (T4-A) för artikel och materialrad (`t4a_skyddade_falt`); materialradens okända pris och prisflödet: T4-B.** |
| SEC-CUST-03 | `chef` − `objects_sensitive` | Portkod i register, AO, export och som skrivare | Saknas (SEC-B5-01..03) **T3-E: lokalt grön för get-sensitive-fields (403 + denied-rad) och läsprojektionen; skrivaren (`customer_manage`) får fortfarande portkoden i registret — T4-A (SÄK-7).** **T4-A: lokalt grön även som skrivare (projektion + fältvis sammanslagning); export T4-F.** |
| SEC-CUST-04 | `chef` − `invoice_create` | `invoice-write` | 403 `forbidden` **Lokalt grön (T3-E, standardroll − behörighet).** |
| SEC-CUST-05 | `chef` − `time_view_all` | `time-entries-list` | Bara egna **T3-E: verkningslös nu (chef ser bara egna med och utan `time_view_all`), verkställs i T4-B (K-01).** |
| SEC-CUST-06 | `chef` − `export_data` | All export | SEC-EXP-01 **T3-E: verkningslös nu på servern (ingen serverexport); klientexporten följer inte `export_data` förrän T4-F.** |
| SEC-CUST-07 | `ekonomi` − `payroll_manage` | `attest_time` | 403 `forbidden` **Lokalt grön (T3-E).** |
| SEC-CUST-08 | `ekonomi` − `personal_data_view` | Personnummer | Saknas **Lokalt grön (T4-A): bara kundregistrets personnummer skiljer.** |
| SEC-CUST-09 | `personal` − `ao_pool_take` | Poolprojektion, tagning | Ingen pool. 403 `forbidden`. **Lokalt grön (T3-B, T3-E).** |
| SEC-CUST-10 | `personal` − `ao_complete_own` | Klarmarkera egen | 403 `forbidden` **Lokalt grön (T3-B, T3-E).** |
| SEC-CUST-11 | `personal` − `ao_start_own` | Starta egen | 403 `forbidden` **Lokalt grön (T3-B, T3-E).** |
| SEC-CUST-12 | `personal` − `ao_time` | `create_time`, stämpling | 403 `forbidden` **Lokalt grön (T3-E: tid och stämpling).** |
| SEC-CUST-13 | `personal` − `ao_material` | Materialrad | 403 `forbidden` **Lokalt grön (T3-E: 403 `forbidden`).** |
| SEC-CUST-14 | `personal` − `objects_access_assigned` | `get-sensitive-fields` för egen AO | 403 + `denied`-rad **T3-E: verkningslös nu (403 + denied-rad med och utan), verkställs i T4-C.** **Lokalt grön (T4-C): utan → 403 `forbidden` + denied-rad; med → 200 + allowed-rad för egen aktiv AO (`t3e_standard_roles`, `t4c_atkomstinformation`).** |
| SEC-CUST-15 | `personal` − `rondering_utfor` | Eget pass | 403 `forbidden` **T3-E: verkningslös nu, verkställs i T4-D.** **Lokalt grön (T4-D): egen roll utan `rondering_utfor` på eget pass → 403 `forbidden` (`t4d_rondering`, SEC-ROND-04).** |
| SEC-CUST-16 | `begransad` + `ao_time` | Tid på egen AO / på öppen pool | 200 / 403 `not_assigned` **Lokalt grön (T3-B, T3-E).** |
| SEC-CUST-17 | `begransad` + `objects_access_assigned` | Åtkomstinformation för egen AO | 200 + `allowed`-rad **T3-E: verkningslös nu (ingen åtkomstinformation, inga kollegors kontaktuppgifter), verkställs i T4-C.** **Lokalt grön (T4-C): med behörigheten prövas tilldelningen (200 för egen aktiv AO, annars 403 `not_assigned`); kontaktuppgifter ges fortfarande inte.** |
| SEC-CUST-18 | Endast `staff_manage` | Eskalering | SEC-ROLL-01/02 **Lokalt grön (T3-C).** **T3-E: grön även med standardrollerna.** |
| SEC-CUST-19 | Endast `admin_manage` | `all`, `bankgiro_edit` | SEC-ROLL-03, SEC-INST-03 **Lokalt grön (T3-C)** för `all` och `bankgiro_edit` som tillägg i en roll; SEC-INST-03 är T4. **T3-E: grön även med standardrollerna.** |
| SEC-CUST-20 | `ao_view_all` + `sales_manage` (utan `personal_data_view`) | Personnummer | Saknas (SEC-KUND-03) **T3-E: verkningslös nu; personnumret lämnas i dag ut till kundregistrets läsare (C-5) — T4-A.** **Lokalt grön (T4-A).** |
| SEC-CUST-21 | `ao_view_all` utan `ao_edit` | Ändra annans uppgift | 403 `not_own` (D-15) **Lokalt grön (T3-D: ekonomi och egen roll säljare, E och S).** **T3-E: grön även med standardrollerna.** |
| SEC-CUST-22 | Tom behörighetslista | Alla EF | 200 med tomma listor, eller 403. Ingen data. **Lokalt grön (T3-C):** store-key-write, work-orders-list, time-entries-list, ao-time-write, invoice-write. **T3-E: grön även med standardrollerna.** **T4-A: inga inställningar, prisgrupper, återkommande ärenden eller artiklar längre (punkt 7 stängd lokalt).** |
| SEC-CUST-23 | Roll som saknas i registret (personalpost med okänt roll-id) | Alla EF och klienten | Inga behörigheter (fail-closed). Klienten: lokalt grön (T3-A). **Lokalt grön (T3-C)** i samma EF:er; klienten sedan T3-A. **T3-E: grön även med standardrollerna.** **T4-A: som SEC-CUST-22; dessutom inaktiverad roll = inga behörigheter (server och klient).** |

---

## 6. Beslut (alla FASTSTÄLLDA 2026-11-27)

Ordalydelse: `BESLUT-2026-11-27.md`. Kolumnen visar hur beslutet slår igenom i matrisen.

| Beslut | Status | Genomslag i matrisen |
|---|---|---|
| D-01 | **Fastställt** · lokalt verifierad (T4-A): `cost_view`/`cost_edit` verkställda för skyddade fält; prisflödet T4-B | `cost_view`/`cost_edit` standard för admin, chef och ekonomi, och kan tas bort. Ger inte löneuppgifter. R16, R17, R25. |
| D-02 | **Fastställt** · lokalt verifierad (T3-E) | Id `admin`/`chef`/`ekonomi`/`personal`/`begransad`, ingen migrering av personal. §2. |
| D-03 | **Fastställt** | `ao_start_own`/`ao_complete_own`/`ao_pool_take`. Låsta statusar. Servern sätter identitet och tid. R07, R08, R04. |
| D-04 | **Fastställt** | Begränsad: egna AO. Tilläggsbehörigheter separat. §2, SEC-CUST-16/17. |
| D-05 | **Fastställt** · lokalt verifierad (T4-A + T4-C): skrivare utan `objects_sensitive` får inga portkoder (T4-A); tilldelningsvägen för egen aktiv AO (T4-C); rondering aktiveras i T4-D | `objects_sensitive` standard för chef, kan tas bort. `objects_access_assigned` för fält, även vid rondering. R48, R49. |
| D-06 | **Fastställt** · lokalt verifierad (T4-A): AO-ekonomi projiceras bort för fält i `work-orders-list` och skrivsvaren | Ingen AO-ekonomi till fält. Debiteringskategori utan belopp. R12. |
| D-07 | **Fastställt** | Chef får `invoice_*`. Fakturering bara via `invoice-write`. Faktureringsfält avvisas i `patch_ao` för alla. R10, R30. |
| D-08 | **Fastställt** (utredning §1.1) · lokalt verifierad (T4-B): `time_view_all` verkställd utan löneuppgifter | `time_view_all` för chef. `payroll_*` för ekonomi och admin. R27–R29. |
| D-09 | **Fastställt** · lokalt verifierad (T4-B) | Inga försäljningspriser för fält i någon vy. R18, R19. |
| D-10 | **Fastställt** · lokalt verifierad (T4-B) | Fritext. Okänt ≠ 0. Faktureringsstopp. Fastpris utan dubbeldebitering. R13, R20, R21. |
| D-11 | **Fastställt** · lokalt verifierad (T4-B) | Gruppnamn utan belopp. Servern validerar och sätter priset. Historik oförändrad. R22–R24. |
| D-12 | **Fastställt** | Minimal offertreferens för tilldelad AO. R34. |
| D-13 | **Fastställt** · lokalt verifierad (T3-D + T4-A): `personal_data_view` verkställd; export T4-F | Urval per uppdrag, begränsad poolprojektion, `personal_data_view`. R36, R37, R03. |
| D-14 | **Fastställt** | Arbetskontakt för interna kollegor. Egen post fullständig. R38–R40. |
| D-15 | **Fastställt** | `ao_view_all` räcker inte. Samma regel i klient och server. R47. |
| D-16 | **Fastställt** · förberedelsen lokalt verifierad (T4-C) | Tabellen är sanningskälla. Bara förberedelse, ingen migrering. R50. |
| D-17 | **Fastställt** · lokalt verifierad (T4-A): `bankgiro_edit`, fältvis sammanslagning av inställningar | Läsning för interna roller. Ändring kräver `bankgiro_edit`. Fältvis sammanslagning. R54–R56. |
| D-18 | **Fastställt** | `export_data`, `export_personal_data`. Serverexport för skyddade fält. R57–R60. |
| D-19 | **Fastställt** · lokalt verifierad (T4-B) | Radvisa RPC:er. Egna rader. Hela listan nekas för fält. R13–R15. |
| D-20 | **Fastställt** | `internalNote`/`customerNote`. Gammalt `note` skrivs inte ut. Ingen dataändring. R31, R32. |
| D-21 | **Fastställt** | Egen effektiv behörighet. Andras kräver `admin_manage`. R41, R42. |
| D-22 | **Fastställt** | Typer och referenser per behörighet. Servern sätter identitet och kontrollerar referensen. R45. |
| D-23 | **Fastställt** · lokalt verifierad (T4-C) | Atomisk borttagning vid permanent radering. Revision utan värde. R51. |
| D-24 | **Fastställt** | AP-A–AP-G. Tilldelad pool är giltig. §3.1. |
| D-25 | **Fastställt** | Superadmin = `all`. Eskaleringsregel. Atomisk invariant. R43. |
| D-26 | **Fastställt** · lokalt verifierad (T3-E) | Testkonton = standardroller, plus egna roller (§5.13). Skapas i STAGING först efter separat godkännande. |
| AP-A | **Fastställt** | Kategoridefinitioner §3.1. Ingen breddning. |
| AP-B | **Fastställt** | Tid och stämpling bara på tilldelad AO. R06, R26. |
| AP-C | **Fastställt** | Gemensamma räknardefinitioner (AO-etappen, inte säkerhetsomgången) |
| AP-D | **Fastställt** | Notiser först efter serverbekräftelse, inga falska tilldelningsnotiser (SEC-POOL-15; resten i AO-etappen) |
| AP-E | **Fastställt** | `ao_plan_own` (AO-etappen) |
| AP-F | **Fastställt** | `ao_pool_take`, atomisk tagning. R04. |
| AP-G | **Fastställt** | `pool` avvecklas inte nu. Personaldialogen rör bara personal. |

**Motsägelser som tidigare listats och nu är lösta:**

| Motsägelse | Löst genom |
|---|---|
| Arbetsledaren och intern ekonomi | D-01 |
| Seed, underlag och C-5 om fakturor | D-07 |
| Ö4 mot B2 | D-11 |
| Klient mot server för uppgifter | D-15 |
| `email`-projektion mot inloggningen | D-14 |
| Pool med personal | D-24/AP-A |
| `admin_manage` som superadmin | D-25 |

**Kvarstående förtydliganden** (inte motsägelser, kräver bekräftelse före respektive paket):

| Nr | Fråga | Förslag i matrisen |
|---|---|---|
| K-01 | `time_view_all`: all personal, eller ett framtida teamurval? | **Fastställt 2026-11-28:** all personal. Verkställs i T4-B. |
| K-02 | Behöver arbetsledaren `personal_data_view` som standard för offerter med ROT/RUT? D-13 nämner ROT/RUT som exempel på verkligt behov, och arbetsledaren skapar offerter. | **Fastställt 2026-11-28:** inte standard; tilldelas separat. `chef` saknar den (T3-E). Verkställs i T4-A. |
| K-03 | Exakt fältlista för poolprojektionen (D-13: "begränsad information för att bedöma om jobbet kan tas") | Titel, beskrivning, kategori, prioritet, gatuadress och ort, förfallodatum, uppskattad tid. Inte kundens kontaktuppgifter, portkod, logg, material, checklista, bilder eller pris. |
| K-04 | Portkod i export (D-18: "ingår inte i normal export") | Bara via serverexport med `objects_sensitive` + `export_data`, aktivt val och logg |
| K-05 | Klassificering av gamla `inv.note` (D-20) | Separat genomgång. Tills dess tas `note` aldrig med i ny kund-PDF. |
| K-06 | Konfliktregler för `ao_plan_own` vid flerpersonsuppdrag (AP-E) | Avgörs i AO-etappen |

---

## 7. Fynd och SÄK-koppling, uppdaterat efter serverinventeringen

Källor: `vift-v2/supabase/inventering/staging-2026-11-26/`.

| Fynd | SÄK | Allvar | Bekräftelse och kodreferens | Paket (testplanen) |
|---|---|---|---|---|
| F1: `ao_complete`-grenen kontrollerar inte tilldelning eller status | SÄK-5 | **P1** | EF `ao-time-write/index.ts:259-265`. `work_order_patch` (`schema/functions.sql`) kontrollerar bara att posten finns, idempotens och `p_expected_updated_at`. Patchen slås ihop med `v_ao \|\| p_patch` utan regelkontroll. | T3-B · nuläge 2026-11-28: **lokalt verifierad** (T3-B; baslinjen T3-0 vänd till godkända tester i `vift-v2/tests/t3b_ao_karna.test.js`), ej installerad i STAGING |
| F2: hel materiallista, priser från klienten, okänt = 0 | SÄK-6 | P1 | `ao-time-write/index.ts:199-213`; `WorkOrderDetailPage.js:2053`, `:2248` | T4-B · nuläge 2026-11-28: **lokalt verifierad** (T4-B; baslinjen bevisad och vänd i `vift-v2/tests/t4b_material_priser.test.js`), ej installerad i STAGING |
| F3: ingen tilldelningsväg för åtkomstinformation, dubbel lagring. Skrivare utan `objects_sensitive` får fältet (informationsläckage). | SÄK-7 | **P1** (läckaget), P2 (vägen) | STAGING `get-sensitive-fields` v9 är **nyare** än repot (fail-closed audit, låst supabase-js) och `set-sensitive-fields` v9 använder RPC `sensitive_fields_write`. Repot uppdateras från inventeringen före ändring. Projektionen i `vift_store_full_access` ger skrivare fullt värde. | T4-A, T4-C · **Lokalt åtgärdat** (läckaget T4-A, vägen T4-C 2026-11-28); ej installerat i STAGING |
| F4: poolregeln och "Ta jobbet" | SÄK-3, SÄK-4 | P1 | `work-orders-list/index.ts:88-91`, `_shared/vift-auth.ts:121-131`, SQL-urval i `work_order_checklist_resolve`/`_set_state`/`work_order_log_*`, `fake-backend.js:122-127`. Gren B läser utanför låset. | T3-B · nuläge 2026-11-28: **lokalt verifierad** (T3-B; baslinjen T3-0 vänd till godkända tester i `vift-v2/tests/t3b_ao_karna.test.js`), ej installerad i STAGING |
| F5: eskalering via `staff_manage`, inget skydd för sista superadmin | SÄK-8 | **P1** | `store-key-write/index.ts:89`. `store_business_key_merge_write` har bara `p_caller_authorized`. | T3-C · nuläge 2026-11-28: **lokalt verifierad** (T3-C: `vift-v2/tests/t3c_roller.test.js`; baslinjen T3-0 vänd), ej installerad i STAGING |
| F6: cache kvar efter utloggning | SÄK-9 | **P1** | `AuthService.js:628-650`, `state.js:983` — lokalt åtgärdad 2026-11-28 | T3-A |
| F7: reservroll `personal` | SÄK-10 | Blockerar `personal` | `AuthService.js:379` — lokalt åtgärdad 2026-11-28 | T3-A |
| F8: uppgiftsregler klient mot server | (SÄK-2) | P2 | `PageShells.js:11861-11869`, `activities-policy.ts` | T3-D · nuläge 2026-11-28: **lokalt verifierad** (T3-D: klienten använder serverns regel, `ActivitiesService.canEdit/canComplete/canDelete`; e2e T3D-01/02), ej installerad i STAGING |
| F9: offertstubbar för alla offerter | – | P2 | `vift_store_project` (`schema/functions.sql`) | T3-D · nuläge 2026-11-28: **lokalt verifierad** (T3-D: bara offerter kopplade till egna AO), ej installerad i STAGING |
| F10: e-post krävs för inloggningen | – | Krav | `AuthService.js:366-372` | T3-D · nuläge 2026-11-28: **uppfyllt lokalt** (T3-C/T3-D: den egna personalposten lämnas oförändrad, med e-post) |
| F11: `appendActivity` tillåter alla typer och referenser | – | P2 | `activity-log.ts` | T3-D · nuläge 2026-11-28: **lokalt verifierad** (T3-D: `type_not_allowed`/`ref_not_visible` i RPC:n), ej installerad i STAGING |
| F12: snabbexport utan spärr | (SÄK-1) | P2 | `ImportExportConfigs.js` `showExportMenu` | T4-F |
| F13: `ProfitabilityService` använder 250 kr/h som standard | – | P3 | `ProfitabilityService.js:10` | T4-B · nuläge 2026-11-28: **lokalt verifierad** (T4-B: inga påhittade standardvärden, TB ofullständigt när värden saknas; e2e T4B-08) |
| F16: `time_entry_create` kontrollerar inte AO-tilldelning, tar `hourRate` från klienten och skriver in tidpostens id i målets `timeEntries` | (AP-B) | **P1** | `schema/functions.sql` `time_entry_create` (kroppen finns bara i ögonblicksbilden) | T3-B (tilldelning), T4-B (pris) · nuläge 2026-11-28: **lokalt verifierad** (T3-B; baslinjen T3-0 vänd till godkända tester i `vift-v2/tests/t3b_ao_karna.test.js`; prisdelen T4-B: tillåten prisgrupp, okänt timpris ≠ 0, `t4b_material_priser`), ej installerad i STAGING |
| F17: `work_order_patch` returnerar sparat resultat vid återanvänd idempotensnyckel, oavsett payload | – | P3 | `schema/functions.sql` | T3-B · nuläge 2026-11-28: **lokalt verifierad** (T3-B; baslinjen T3-0 vänd till godkända tester i `vift-v2/tests/t3b_ao_karna.test.js`), ej installerad i STAGING |
| F18: direkt REST-skrivning av nycklar utan affärsregel (`vift_lastChanged`, okända nycklar) för alla aktiva | – | P2 | `schema/policies.sql` `store_active_write_safe` + `staging_generic_keys_no_direct_*` (gäller bara affärsnycklar) | T3-C · nuläge 2026-11-28: **lokalt verifierad** (T3-C: vitlista i RLS + trigger; `vift_lastChanged` med servervärde, se T3-RESULTAT), ej installerad i STAGING |
| F19: `rondering-pass-write` kräver `ao_view_all` för allt, ingen kontroll per pass | (Ö3) | P2 | `inventering/.../functions/rondering-pass-write/rondering-pass-write/index.ts:82` | T4-D · **Lokalt åtgärdat (2026-11-28)**; ej installerat i STAGING |
| F21: `ao_edit` kan sätta `status:'fakturerad'`/`invoiceId` via `patch_ao` | – | **P1** (D-07) | `ao-time-write/index.ts` (ingen fältbegränsning för `callerHasEdit`) + `work_order_patch` | T3-B · nuläge 2026-11-28: **lokalt verifierad** (T3-B; baslinjen T3-0 vänd till godkända tester i `vift-v2/tests/t3b_ao_karna.test.js`), ej installerad i STAGING |
| F23: stämpling kontrollerar inte AO-tilldelning | (AP-B) | P1 | `store-key-write/stamp-status.ts:56-70` (bara `ao_time`) | T3-B · nuläge 2026-11-28: **lokalt verifierad** (T3-B; baslinjen T3-0 vänd till godkända tester i `vift-v2/tests/t3b_ao_karna.test.js`), ej installerad i STAGING |
| F24 (punkt 7, tillägg efter T3): notiser kan skapas åt andra utan kontroll av aktör, mottagare och referens, och varje inloggad läser hela `vift_notifications` (även andras notiser med AO-titlar och kundnamn) | – | P2 (läsläckan P1 om notiserna innehåller kunduppgifter; beslut 7 i T4-RESULTAT) | Klientens `persistNotifs` (REST-upsert av hela listan, T3-C-vitlistan); `vift_store_full_access` `else true` för nyckeln; triggern `_protect_notifications_and_legacy_keys` skyddar bara befintliga posters innehåll | T4-A (tilläggsdel notiser) · nuläge 2026-11-28: **lokalt verifierad** (`notification_append`/`notifications_mark_read`, projektion per mottagare, REST-vitlistan avvecklad; BASLINJE bevisad i `vift-v2/tests/t4a_notiser.test.js`), ej installerad i STAGING |
| O1: Exportcenter, personnummer förvalt | SÄK-1 | P2 | `ImportExportConfigs.js:49/60`, `ExportCenterPage.js:123/135-142/189` | T4-F |
| O2: fältets Uppgifter visar andras | SÄK-2 | **P1** | `PageShells.js:11905/11931`, `vift_store_full_access` `else true` | T3-D · nuläge 2026-11-28: **lokalt verifierad** (T3-D; baslinjen T3-0 vänd till godkända tester i `vift-v2/tests/t3d_informationsatkomst.test.js`), ej installerad i STAGING |

**Nuläge 2026-11-28 (T3-B, lokalt):** F1 (SÄK-5), F4 (SÄK-3/4), F16/F23 (SÄK-11, tilldelningsdelen samt serverpris), F17 (SÄK-12) och F21 (SÄK-15) är rättade i `vift-v2` (migrationerna `20261128000001–03`, ändrade EF) och **lokalt verifierade** (`vift-v2/tests/t3b_ao_karna.test.js`, `t3b_rollback.test.js`, paritet `VIFT-CRM/tests/sim_parity.test.js`). R02–R08, R10 och R26 följer målet lokalt. Övergångsregeln (§4.6 i testplanen) gäller tills T3-E. Inget är installerat i STAGING; kolumnen "Nu (STAGING)" beskriver fortfarande STAGING. Kvar till T4: radvisa materialrader (D-19 fullt), prisgruppsbehörighet (`price_group_not_allowed`), AO-ekonomi i projektionen för fält (R12).

**Nuläge 2026-11-28 (T4-B, lokalt):** F2 (SÄK-6), F13 och prisdelen av F16 (SÄK-11) är åtgärdade och lokalt verifierade (`vift-v2/tests/t4b_material_priser.test.js` 152/0; paritet 233 scenarier, 231 lika, 2 kända; e2e T4B-01–08). R13–R15, R17–R24, R27 följer målet lokalt (D-08–D-11, D-19); `time_view_all` verkställd (K-01). Inget är installerat i STAGING.

**Nuläge 2026-11-28 (T3-D, lokalt):** O2/SÄK-2, F8, F9 och F11 är åtgärdade och lokalt verifierade (`vift-v2/tests/t3d_informationsatkomst.test.js`, `t3d_rollback.test.js`; paritet 141 scenarier, 139 lika, 2 kända utanför T3-D). R34, R36, R38, R40 (skyddade personaluppgifter), R44–R47 följer målet lokalt. Inget är installerat i STAGING.

**Nuläge 2026-11-28 (T3-C, lokalt):** F5 och F18 är åtgärdade och lokalt verifierade (`vift-v2/tests/t3c_roller.test.js`, `t3c_rollback.test.js`; paritet 85 scenarier, 83 lika, 2 kända utanför T3-C). Inget är installerat i STAGING.

**Nuläge 2026-11-28 (T3-0, lokalt):** bristerna F1, F4, F5, F16, F17, F18, F21, F23 och O2 är bevisade i oförändrad kod mot den lokala STAGING-replikan (`vift-v2/tests/baslinje_sakerhet.test.js`, 34 BASLINJE-rader; tabell i `docs/qa-2026-11-28/T3-RESULTAT.md` §7). Utan R-E skulle dessutom anon kunna köra `provision_vift_user` (bevisat lokalt). Ingen rad är åtgärdad. Testverktygen för felkod + `reason` + KS finns (`vift-v2/tests/local/lib/kontroll.js`). SEC-SIM-01: paritetsramverket finns (`VIFT-CRM/tests/sim_parity.test.js`, 7 kända avvikelser).

**Inaktuella hänvisningar som rättats:**
- "G4 – källa saknas" gäller **inte** längre `work_order_create`, `work_order_patch`, `time_entry_*`, `invoice-write`, `rondering-pass-write`, `store_business_key_*`, `_staging_business_key_required_perm` eller `store_read_all_with_hashes`. Alla finns i inventeringen.
- Kvarstår: 13 funktioner (bland dem `time_entry_*`, `invoice_line_*`, `_protect_critical_store_keys`) och de RESTRICTIVE cutover-policyerna finns **bara** i ögonblicksbilden (`schema/functions.sql`, `schema/policies.sql`). De ska bli versionerade migrationer i repot (T3-0).
- `invoice-write` och `rondering-pass-write` är återställda till `vift-v2/supabase/functions/`.
- Fyra EF:er är nyare i STAGING än i repot: `get-sensitive-fields`, `set-sensitive-fields`, `offer-respond`, `offer-token-validate`. `send-offer-email` hör till samma grupp. Repot synkas från inventeringen innan de ändras.
