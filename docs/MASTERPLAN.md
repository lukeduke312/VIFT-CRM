# VIFT CRM — Masterplan

Spårar all planerad och genomförd utveckling. Status uppdateras per commit.

**Legenda:** `KLAR` = commit finns · `DELVIS` = påbörjad · `FÖRBEREDD` = fält/kod finns, ingen UI · `EJ BYGGD` = ej startat

---

## Fas 0 — Kärninfrastruktur

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 1 | Vanilla JS SPA, hash-routing, pushState/popstate | KLAR | 9b39b63 | Router.js |
| 2 | Supabase single-table blob store (vift_* nycklar) | KLAR | 9b39b63 | Storage.js |
| 3 | Auth (login, roller, RLS, Auth.can()) | KLAR | 9b39b63 | Auth.js |
| 4 | Service Worker v10 (network-first, cache-busting) | KLAR | 9b39b63 | sw.js |
| 5 | DataSync — polling var 30:e sekund | KLAR | 9b39b63 | DataSync.js |
| 6 | ActivityService — revisionslogg | KLAR | 9b39b63 | ActivityService.js |
| 7 | ActivitiesService — Att göra-uppgifter | KLAR | 9b39b63 | ActivitiesService.js |
| 8 | Push-notiser (PushService, send-push Edge Function, VAPID) | KLAR | 9b39b63 | PushService.js, supabase/functions/send-push |

---

## Fas 1 — CRM-kärna

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 9  | Arbetsorder (AO) — fullständig CRUD, wizard, statusflöde | KLAR | 9b39b63 | WorkOrdersPage, WorkOrderDetailPage, WorkOrderService |
| 10 | AO — checklist, material, tidsstämpel, fakturering | KLAR | 9b39b63 | WorkOrderDetailPage |
| 11 | AO — objectId (schema + wizard-UI) | KLAR | 0135856 | WorkOrdersPage v34, WorkOrderDetailPage v47 |
| 12 | Kundregister — CRUD, kontaktpersoner | KLAR | 9b39b63 | CustomersPage, CustomerService |
| 13 | Fastighetsregister — CRUD, teknisk info, bilder | KLAR | 9b39b63 | PropertyDetailPage, PageShells |
| 14 | Offertmodul | KLAR | 9b39b63 | OffersPage, OfferDetailPage |
| 15 | Fakturaunderlag | KLAR | 9b39b63 | InvoicesPage, InvoiceDetailPage |
| 16 | Tidrapportering & stämpling | KLAR | 9b39b63 | TimePage |
| 17 | Återkommande ärenden | KLAR | 9b39b63 | RecurringPage |
| 18 | Säljchanser / CRM-pipeline | KLAR | 9b39b63 | SalesPage |
| 19 | Personalregister | KLAR | 9b39b63 | StaffPage |
| 20 | Artikelregister | KLAR | 9b39b63 | ArticlesPage |
| 21 | Prisgrupper | KLAR | 9b39b63 | PriceGroupsPage |
| 22 | Admin-sida (roller, inställningar) | KLAR | 9b39b63 | AdminPage |
| 23 | Dashboard — KPI-kort, öppna AO, avvikelser | KLAR | 9b39b63 | Dashboard.js |
| 24 | Sidebar med badges | KLAR | 9b39b63 | Sidebar.js |

---

## Fas 2 — Rondering

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 25 | Ronderingsmallar (CRUD, kontrollpunkter, kategorier) | KLAR | 9b39b63 | RonderingPage, RonderingWizardPage |
| 26 | Ronderingspass (planera, utföra, slutföra) | KLAR | 9b39b63 | RonderingUtforandePage, RonderingService |
| 27 | Avvikelser (öppen/åtgärdad/avskriven, kopplad AO) | KLAR | 9b39b63 | RonderingService |
| 28 | Ronderingsrapport (sammanfattning, historik) | KLAR | 9b39b63 | RonderingRapportPage |
| 29 | Avvikelse — objectId-koppling | KLAR | f61b26a | schema.js, RonderingUtforandePage v10 |

---

## Leverans 1 — Serviceintervall

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 30 | ServiceIntervalService v3 — 8 intervalltyper, 16 kategorier | KLAR | b8842db | ServiceIntervalService.js |
| 31 | Kalenderbaserad datumberäkning (ej dagar-approximation) | KLAR | b8842db | ServiceIntervalService.js |
| 32 | Service-flik i fastighetskort (filter, sortering, status-chips) | KLAR | 9ca18d7 | PropertyDetailPage v17 |
| 33 | Markera utförd (historik, staffId, kommentar, AO-länk) | KLAR | 9ca18d7 | PropertyDetailPage |
| 34 | Pausa/återuppta serviceintervall | KLAR | 9ca18d7 | PropertyDetailPage |
| 35 | Stäng relaterade Att göra-poster vid markera utförd | KLAR | b8842db | ServiceIntervalService v3 |
| 36 | Ansvarig personal visas i Dagens drift | KLAR | b8842db | OperationsPage v9 |
| 37 | Daglig klientkörning (runDailyCheck, idempotent, duePeriodKey) | KLAR | b8842db | ServiceIntervalService.js |
| 38 | Automatisk AO-mall (fält förberett, ej ansluten till server) | FÖRBEREDD | b8842db | ServiceIntervalService.js |
| 39 | Schemalagd Edge Function (server-side daglig körning) | EJ BYGGD | — | supabase/functions/service-monitor |
| 40 | Server-side dubblettskydd (atomisk idempotens) | EJ BYGGD | — | supabase/functions/service-monitor |
| 41 | Web-push för serviceintervall per ansvarig | EJ BYGGD | — | PushService, send-push Edge Function |

---

## Leverans B — Kundimport och -export

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 42 | Import — CSV (förhandsgranska, kolumnmatchning, validering) | EJ BYGGD | — | CustomersPage, ImportEngine (ny) |
| 43 | Import — XLSX (samma flöde som CSV) | EJ BYGGD | — | ImportEngine |
| 44 | Import — duplikatkontroll (matcha namn/org-nr, val) | EJ BYGGD | — | ImportEngine |
| 45 | Import — fellogg och resultatrapport | EJ BYGGD | — | ImportEngine |
| 46 | Export — CSV (alla/filtrerade/markerade, valbara kolumner) | EJ BYGGD | — | CustomersPage, CustomerService |
| 47 | Export — XLSX (inkl. kontaktpersoner och fastigheter) | EJ BYGGD | — | CustomerService |

---

## Leverans C — Objekt, lägenheter och lokaler

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 48 | Schema — PROPERTY_OBJECT_TYPES (11 typer) | KLAR | f917fdb | schema.js |
| 49 | Schema — PROPERTY_OBJECT_STATUSES (6 statusar) | KLAR | f917fdb | schema.js |
| 50 | Schema — Schema.propertyObject() (30+ fält) | KLAR | f917fdb | schema.js |
| 51 | State — state.propertyObjects[], initState, persist, getPropObj() | KLAR | f917fdb | state.js |
| 52 | PropertyObjectService v1 — CRUD, kontakter, utrustning, sökning | KLAR | f917fdb | PropertyObjectService.js |
| 53 | PropertyDetailPage — Objekt-flik med filter och CRUD | KLAR | 9ef6d01 | PropertyDetailPage v18 |
| 54 | PropertyObjectPage v1 — detaljkort (info, access, AO, utrustning) | KLAR | 9ef6d01 | PropertyObjectPage.js |
| 55 | Router — pg-propobj-detail, /objekt/:objId | KLAR | 9ef6d01 | Router.js v17 |
| 56 | AO-wizard — objektväljare (filtrerad per fastighet) | KLAR | 0135856 | WorkOrdersPage v34 |
| 57 | AO-detalj — visar kopplat objekt med länk | KLAR | 0135856 | WorkOrderDetailPage v47 |
| 58 | Serviceintervall-formulär — objectId-väljare | KLAR | f61b26a | PropertyDetailPage v19 |
| 59 | Avvikelse — objectId-väljare i ronderingsvyn | KLAR | f61b26a | RonderingUtforandePage v10 |

---

## Fas 4 — Avancerade funktioner (planerat)

| # | Funktion | Status | Prioritet | Beroenden |
|---|----------|--------|-----------|-----------|
| 60 | Rondering — visningsrapport (PDF, dela) | EJ BYGGD | Hög | RonderingRapportPage |
| 61 | Kalender — schemaläggning, dra-och-släpp | EJ BYGGD | Hög | CalendarPage |
| 62 | Löneunderlag — export, perioder | EJ BYGGD | Medel | PayrollPage |
| 63 | Rapporter — statistik, diagram (AO, tid, objekt) | EJ BYGGD | Medel | ReportsPage |
| 64 | Mina jobb — tilldelade uppdrag per inloggad personal | EJ BYGGD | Hög | MyJobsPage |
| 65 | Avancerat behörighetssystem (per fastighet, per kundgrupp) | EJ BYGGD | Låg | Auth.js |
| 66 | E-post-mallar och automatiska utskick | EJ BYGGD | Medel | emailTemplates, supabase/functions |
| 67 | Kontrakthantering (avtal, betalningsplan, villkor) | EJ BYGGD | Medel | ContractsPage |
| 68 | Mobil-optimerad offline-läge (SW fallback) | EJ BYGGD | Låg | sw.js, IndexedDB |

---

## Säkerhetsprinciper (gäller alltid)

- Service role key får **aldrig** ligga i frontend
- API-nycklar som kräver hemlighet går via Edge Function, inte direkt i frontend
- VAPID private key läggs **aldrig** i config.js eller frontend
- Bygg inte mot tjänst som inte tillåter autocomplete
- Ta inte bort befintliga funktioner utan explicit godkännande
- Bygg inte stora nya funktioner förrän deploy/cache/GitHub och AO-filter fungerar stabilt live
- Alla produktionskritiska ändringar görs i separata commits med versionsnummer och rollback-punkter
