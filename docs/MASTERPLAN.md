# VIFT CRM — Masterplan

Spårar all planerad och genomförd utveckling. Status uppdateras per commit.

**Legenda:** `KLAR` = commit finns + UI fungerar · `DELVIS` = påbörjad, men ofullständig · `FÖRBEREDD` = fält/kod finns, ingen UI · `EJ BYGGD` = ej startat

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
| 11 | AO — objectId + objectName i wizard och detalj | KLAR | 0135856 | WorkOrdersPage v34, WorkOrderDetailPage v47 |
| 12 | AO — snapshot-fält (customerName, objectNumber, contactId, contactName, accessInformation) | EJ BYGGD | — | WorkOrdersPage, schema.js — planeras i stabilisering |
| 13 | AO — sökning på objektnamn/objektnummer/port/trapphus | EJ BYGGD | — | WorkOrdersPage haystack — planeras i stabilisering |
| 14 | Kundregister — CRUD, kontaktpersoner | KLAR | 9b39b63 | CustomersPage, CustomerService |
| 15 | Fastighetsregister — CRUD, teknisk info, bilder | KLAR | 9b39b63 | PropertyDetailPage, PageShells |
| 16 | Offertmodul | KLAR | 9b39b63 | OffersPage, OfferDetailPage |
| 17 | Fakturaunderlag | KLAR | 9b39b63 | InvoicesPage, InvoiceDetailPage |
| 18 | Tidrapportering & stämpling | KLAR | 9b39b63 | TimePage |
| 19 | Återkommande ärenden | KLAR | 9b39b63 | RecurringPage |
| 20 | Säljchanser / CRM-pipeline | KLAR | 9b39b63 | SalesPage |
| 21 | Personalregister | KLAR | 9b39b63 | StaffPage |
| 22 | Artikelregister | KLAR | 9b39b63 | ArticlesPage |
| 23 | Prisgrupper | KLAR | 9b39b63 | PriceGroupsPage |
| 24 | Admin-sida (roller, inställningar) | KLAR | 9b39b63 | AdminPage |
| 25 | Dashboard — KPI-kort, öppna AO, avvikelser | KLAR | 9b39b63 | Dashboard.js |
| 26 | Sidebar med badges | KLAR | 9b39b63 | Sidebar.js |

---

## Fas 2 — Rondering

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 27 | Ronderingsmallar (CRUD, kontrollpunkter, kategorier) | KLAR | 9b39b63 | RonderingPage, RonderingWizardPage |
| 28 | Ronderingspass (planera, utföra, slutföra) | KLAR | 9b39b63 | RonderingUtforandePage, RonderingService |
| 29 | Avvikelser (öppen/åtgärdad/avskriven, kopplad AO) | KLAR | 9b39b63 | RonderingService |
| 30 | Ronderingsrapport (sammanfattning, historik) | KLAR | 9b39b63 | RonderingRapportPage |
| 31 | Avvikelse — objectId-koppling (väljarе i modal) | KLAR | f61b26a | schema.js, RonderingUtforandePage v10 |

---

## Leverans 1 — Serviceintervall

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 32 | ServiceIntervalService v3 — 8 intervalltyper, 16 kategorier | KLAR | b8842db | ServiceIntervalService.js |
| 33 | Kalenderbaserad datumberäkning | KLAR | b8842db | ServiceIntervalService.js |
| 34 | Service-flik i fastighetskort (filter, sortering, status-chips) | KLAR | 9ca18d7 | PropertyDetailPage v17 |
| 35 | Markera utförd (historik, staffId, kommentar, AO-länk) | KLAR | 9ca18d7 | PropertyDetailPage |
| 36 | Pausa/återuppta serviceintervall | KLAR | 9ca18d7 | PropertyDetailPage |
| 37 | Stäng relaterade Att göra-poster vid markera utförd | KLAR | b8842db | ServiceIntervalService v3 |
| 38 | Ansvarig personal visas i Dagens drift | KLAR | b8842db | OperationsPage v9 |
| 39 | Daglig klientkörning (runDailyCheck, idempotent, duePeriodKey) | KLAR | b8842db | ServiceIntervalService.js |
| 40 | Schemalagd Edge Function (server-side daglig körning) | EJ BYGGD | — | supabase/functions/service-monitor |
| 41 | Server-side dubblettskydd (atomisk idempotens) | EJ BYGGD | — | supabase/functions/service-monitor |
| 42 | Web-push för serviceintervall per ansvarig | EJ BYGGD | — | PushService, send-push Edge Function |
| 43 | Automatisk AO via Edge Function | FÖRBEREDD | b8842db | ServiceIntervalService.js (koden finns) |

---

## Leverans B — Kundimport och -export

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 44 | Schema: customerNumber, externalId, externalSystem, paymentTerms på kund | KLAR | 9910cda | schema.js v17 |
| 45 | ImportExportService.js — CSV-parser, XLSX-reader/writer (rent JS, ingen extern lib) | KLAR | 9910cda | ImportExportService.js v1 |
| 46 | Importlogg-schema (Schema.importLog(), state.importLogs[]) | KLAR | 9910cda | schema.js v17, state.js v27 |
| 47 | ImportWizardPage.js — 6-stegsguide (välj fil, förhandsgranskning, matchning, validering, bekräftelse, resultat) | KLAR | d3b5117 | ImportWizardPage.js v1 |
| 48 | Kolumnmatchning (auto-förslag, Bokio-profil, "Importera inte") | KLAR | d3b5117 | ImportWizardPage.js, ImportExportService.js |
| 49 | Dubblettdetektering (org-nr, ext-ID, kundnr, e-post, namn+ort) | KLAR | d3b5117 | ImportWizardPage.js._validateRows() |
| 50 | Konfliktlösning per rad (hoppa/skapa/uppdatera) | KLAR | d3b5117 | ImportWizardPage.js steg 4–5 (diff-vy EJ BYGGD) |
| 51 | Kundexport — CSV (alla/filtrerade) | KLAR | 33872a1 | CustomersPage v10 |
| 52 | Kundexport — XLSX (flerblads: Kunder, Kontaktpersoner, Fastigheter) | KLAR | 33872a1 | CustomersPage v10, ImportExportService.js |
| 53 | Importlogg med ångra (skapade ID:n + pre-import snapshot, ImportLogPage) | KLAR | fb9ff35 | ImportLogPage.js v1, ImportExportService.undoImport() |
| 54 | Behörighetskontroll (bara admin importerar), portkod/nyckel aldrig i export | KLAR | d3b5117 33872a1 | ImportWizardPage + ImportLogPage Auth.can('admin'), buildCustomerExportRows() |

---

## Leverans C — Objekt, lägenheter och lokaler

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 55 | Schema — PROPERTY_OBJECT_TYPES (11 typer) + PROPERTY_OBJECT_STATUSES (6) | KLAR | f917fdb | schema.js |
| 56 | Schema — Schema.propertyObject() (30+ fält inkl. contacts[], equipment[]) | KLAR | f917fdb | schema.js |
| 57 | State — state.propertyObjects[], initState, persist, getPropObj() | KLAR | f917fdb | state.js |
| 58 | PropertyObjectService v1 — CRUD, kontakter, utrustning, sökning, typetiketter | KLAR | f917fdb | PropertyObjectService.js |
| 59 | Raderingsskydd — blockeras vid aktiva AO eller aktiva serviceintervall | DELVIS | f917fdb | PropertyObjectService.js (aktivt SI och ej-arkiverade AO, ej stängda AO) |
| 60 | PropertyDetailPage — Objekt-flik med filter (typ/status/sökning) och CRUD-modaler | KLAR | 9ef6d01 | PropertyDetailPage v18 |
| 61 | PropertyObjectPage v1 — detaljkort (info, access, kontakter, AO, utrustning) | KLAR | 9ef6d01 | PropertyObjectPage.js |
| 62 | Objektskortet — serviceintervall kopplade till objekt | EJ BYGGD | — | PropertyObjectPage.js — planeras i stabilisering |
| 63 | Objektskortet — avvikelser kopplade till objekt | EJ BYGGD | — | PropertyObjectPage.js — planeras i stabilisering |
| 64 | Objektskortet — bilder och dokument | EJ BYGGD | — | PropertyObjectPage.js — planeras i stabilisering |
| 65 | Router — pg-propobj-detail + /objekt/:objId | KLAR | 9ef6d01 | Router.js v17 |
| 66 | AO-wizard — objektväljare (filtrerad per fastighet) + autofill portkod | KLAR | 0135856 | WorkOrdersPage v34 |
| 67 | AO-wizard — prefill adress, kontakt, telefon, e-post från objekt | EJ BYGGD | — | WorkOrdersPage — planeras i stabilisering |
| 68 | AO-detalj — visar kopplat objekt med länk | KLAR | 0135856 | WorkOrderDetailPage v47 |
| 69 | Serviceintervall-formulär — objectId-väljare | KLAR | f61b26a | PropertyDetailPage v19 |
| 70 | Avvikelse — objectId-väljare i ronderingsvyn | KLAR | f61b26a | RonderingUtforandePage v10 |
| 71 | Kontakter/hyresgäster — primaryContactId + contacts[]-lista med roller och giltighetstid | FÖRBEREDD | f917fdb | Schema.propertyObject() (fälten finns, ingen CRUD-UI för contacts) |
| 72 | Rollbaserad åtkomstkontroll för portkod/nyckelinformation | EJ BYGGD | — | PropertyObjectPage.js — planeras i stabilisering |

---

## Fas 4 — Avancerade funktioner (planerat)

| # | Funktion | Status | Prioritet | Beroenden |
|---|----------|--------|-----------|-----------|
| 73 | Generell import/export — alla register, exportcenter, diff/conflict-UI | DELVIS BYGGD | Hög | 17 register konfigurerade; markerad export klar (5 sidor); disambiguering klar; historicalImport-guard klar; webbläsarverifiering återstår |
| 74 | Rondering — visningsrapport (PDF, dela) | EJ BYGGD | Hög | RonderingRapportPage |
| 75 | Kalender — schemaläggning, dra-och-släpp | EJ BYGGD | Hög | CalendarPage |
| 76 | Löneunderlag — export, perioder | EJ BYGGD | Medel | PayrollPage |
| 77 | Rapporter — statistik, diagram (AO, tid, objekt) | KLAR | d8bd9bc | ReportsPage v2 + export |
| 78 | Mina jobb — tilldelade uppdrag per inloggad personal | EJ BYGGD | Hög | MyJobsPage |
| 79 | Avancerat behörighetssystem (per fastighet, per kundgrupp) | EJ BYGGD | Låg | Auth.js |
| 80 | E-post-mallar och automatiska utskick | EJ BYGGD | Medel | emailTemplates, supabase/functions |
| 81 | Kontrakthantering (avtal, betalningsplan, villkor) | EJ BYGGD | Medel | ContractsPage |
| 82 | Mobil-optimerad offline-läge (SW fallback) | EJ BYGGD | Låg | sw.js, IndexedDB |

---

## Leverans F4 — Generell import/export (punkt 73)

**Leveransstatus:** DELVIS BYGGD — 17 register konfigurerade, markerad export byggd i 5 sidor, disambiguering byggd, historicalImport-guard fixad; webbläsarverifiering ej gjord

| Del | Funktion | Status | Commit |
|-----|----------|--------|--------|
| F4-1 | Kundimport, generisk motor, 6 register, wizard | Byggd | 49b2810 |
| F4-2/3 | Fastigheter, objekt, artiklar, prisgrupper, personal — config + toolbar | Byggd | 8398450 |
| F4-4/5 | AO, tid, faktura (historicalImport), ronderingsmall, avvikelse — config | Byggd | 8398450 |
| F4-6 | Diff/conflict-UI: per-fält before/after, ångra-dialog | Byggd | 22e8ed3 |
| F4-7 | Exportcenter (ExportCenterPage), kolumnval, känsliga fält av som standard | Byggd | 328e3bf |
| F4-8 | Stabilisering: logg-pruning, race-condition-skydd | Byggd | 0adbf27 |
| F4-9 | 6 saknade register (kontaktpersoner, materialrader, ronderingspass, ronderingSchema, serviceintervall) | Byggd | 4df7b19 |
| F4-10 | Import/export UI på AO, Tid, Faktura, Rondering | Byggd | 4df7b19 |
| F4-11 | Markerad export — SelectionModel, checkboxar i Kunder, AO, Personal, Fastigheter, Artiklar | Byggd | 1cfc543 |
| F4-12 | Relationsdialog för ambiguösa träffar — ej auto-val, manuell picker i steg 4 | Byggd | 222e976 |
| F4-historicalImport | PushService-guard i WorkOrderService.create() för historiska importer | Byggd | 5bfa59c |
| F4-13 | Webbläsarverifiering med riktiga filer (Bokio, Excel, Numbers, Safari iOS) | Ej testad | — |

### Registermatris — import/export-status

| Register | Config | Wizard | CSV-imp | XLSX-imp | Valid | Dubblett | Relation | Hist.imp | CSV-exp | XLSX-exp | Alla | Filtr | Markerade | UI sida | Testad |
|----------|--------|--------|---------|----------|-------|----------|----------|----------|---------|----------|------|-------|-----------|---------|--------|
| Kunder | Byggd | Byggd | Byggd | Byggd | Byggd | Byggd | — | — | Byggd | Byggd | Byggd | Ej byggd | Byggd | Byggd | Ej testad |
| Kontaktpersoner | Byggd | Ej import | — | — | — | — | → Kund | — | Byggd | Byggd | Byggd | Ej byggd | Ej byggd | Ej byggd | Ej testad |
| Fastigheter | Byggd | Byggd | Byggd | Byggd | Byggd | Byggd | → Kund | — | Byggd | Byggd | Byggd | Ej byggd | Byggd | Byggd | Ej testad |
| Objekt | Byggd | Byggd | Byggd | Byggd | Byggd | Byggd | → Kund, Fastighet | — | Byggd | Byggd | Byggd | Ej byggd | Ej byggd | Ej byggd | Ej testad |
| Artiklar | Byggd | Byggd | Byggd | Byggd | Byggd | Byggd | — | — | Byggd | Byggd | Byggd | Ej byggd | Byggd | Byggd | Ej testad |
| Prisgrupper | Byggd | Byggd | Byggd | Byggd | Byggd | Byggd | — | — | Byggd | Byggd | Byggd | Ej byggd | Ej byggd | Byggd | Ej testad |
| Personal | Byggd | Byggd | Byggd | Byggd | Byggd | Byggd | — | — | Byggd | Byggd | Byggd | Ej byggd | Byggd | Byggd | Ej testad |
| Arbetsordrar | Byggd | Byggd | Byggd | Byggd | Byggd | Byggd | → Kund, Fastighet, Obj, Personal, PG | Byggd | Byggd | Byggd | Byggd | Ej byggd | Byggd | Byggd | Ej testad |
| Arbetad tid | Byggd | Byggd | Byggd | Byggd | Byggd | Byggd | → AO, Personal | Byggd | Byggd | Byggd | Byggd | Ej byggd | Ej byggd | Byggd | Ej testad |
| Materialrader | Byggd | Ej import | — | — | — | — | → AO, Artikel | Byggd | Byggd | Byggd | Byggd | Ej byggd | Ej byggd | Ej byggd | Ej testad |
| Fakturaunderlag | Byggd | Ej import | — | — | — | — | → Kund, AO | Byggd | Byggd | Byggd | Byggd | Ej byggd | Ej byggd | Byggd | Ej testad |
| Ronderingsmallar | Byggd | Byggd | Byggd | Byggd | Byggd | Byggd | — | — | Byggd | Byggd | Byggd | Ej byggd | Ej byggd | Byggd | Ej testad |
| Åter.ronderingar | Ej byggd | — | — | — | — | — | — | Ej byggd | Ej byggd | Ej byggd | Ej byggd | — | — | Ej byggd | Ej testad |
| Ronderingspass | Byggd | Byggd | Byggd | Byggd | Byggd | Byggd | → Mall, Fastighet, Kund | Byggd | Byggd | Byggd | Byggd | Ej byggd | Ej byggd | Byggd | Ej testad |
| Avvikelser | Byggd | Byggd | Byggd | Byggd | Byggd | Byggd | → Fastighet, Obj | Byggd | Byggd | Byggd | Byggd | Ej byggd | Ej byggd | Byggd | Ej testad |
| Serviceintervall | Byggd | Ej import | — | — | — | — | → Fastighet | — | Byggd | Byggd | Byggd | Ej byggd | Ej byggd | Ej byggd | Ej testad |
| Rapporter | Byggd | Exportonly | — | — | — | — | — | — | Ej byggd | Byggd | Byggd | — | — | Byggd | Ej testad |

**Säkerhetsregler (permanenta):**
- `historicalImport:true` på AO/tid/faktura/avvikelse/ronderingspass: supprimerar push, auto-AO, billing, notiser
- Känsliga fält (portkod, nyckel, lösenord, PIN) aldrig i standardexport
- Admin-roll sätts ALDRIG automatiskt via import
- Import av lösenord/PIN/token: alltid förbjudet

**Verifieringskrav (XLSX-motor):**
Behöver testas med: Bokio, Microsoft Excel, Apple Numbers, flerblad, svenska tecken, datum, tomma celler, stora filer, Safari iOS, Chrome/Edge. Felaktig fil får inte krascha CRM.

---

## Leverans D — Ansvariga & kontakter per fastighet/objekt

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 83 | Schema — Schema.propertyRole() (titelregister: förvaltare, skötare, m.fl.) | KLAR | — | schema.js v18 |
| 84 | Schema — Schema.propertyContact() (koppling person↔fastighet/objekt) | KLAR | — | schema.js v18 |
| 85 | State — state.propertyRoles[], state.propertyContacts[], persist, DataSync | KLAR | af97e9f | state.js v30 |
| 86 | Titelregister — CRUD i Admin (skapa/redigera titlar, scope, onlyOnePrimary) | KLAR | af97e9f | PageShells v81 |
| 87 | Fastighetskortet — flik "Ansvariga & kontakter" (CRUD, primär, giltighet) | KLAR | af97e9f | PropertyDetailPage v20 |
| 88 | Objektskortet — kontakter på objektnivå (hyresgäst, lokalansvarig) | KLAR | — | PropertyObjectPage v2 |
| 89 | AO-wizard — föreslå kontakt baserat på fastighet + kategori + titel | KLAR | — | WorkOrdersPage v37 |
| 90 | Dagens drift — visa ansvariga per fastighet | KLAR | — | OperationsPage v10 |
| 91 | PropertyContactService — CRUD, primärkontroll, historikvy | KLAR | af97e9f | PropertyContactService.js v1 |
| 92 | Push/notiser — använd ansvarig titel vid utskick | EJ BYGGD | — | PushService (kräver Edge Function) |

### Datamodell — persontyper
- `staff` → state.staff[].id
- `customerContact` → state.customers[].contacts[].id
- `objectContact` → state.propertyObjects[].contacts[].id
- `externalOther` → fritext, inget internt ID

### Datamodell — scope
- `scope: 'property'` → kopplas till fastighet (objectId='')
- `scope: 'object'` → kopplas till objekt (objectId satt)
- `scope: 'both'` → kan kopplas på båda nivåer

### Säkerhetsprinciper (Leverans D)
- Gamla ansvars­kopplingar raderas aldrig — avslutas med validTo eller active: false
- Snapshot-fält (roleNameSnapshot, personNameSnapshot, m.fl.) bevarar historik oavsett framtida namnändringar
- Historiska AO-poster behåller rätt kontaktnamn via egna snapshotfält (contactPerson, phone)

---

## Kända begränsningar och planerade stabiliseringar

### AO-snapshot-fält (punkt 12)
Wizard sparar `propertyName` och `objectName` men saknar: `customerName`, `objectNumber`, `contactId`, `contactName`, `accessInformation` från objektet.
AO-sökning (punkt 13) inkluderar inte objectId/objectName/objectNumber i haystack.

### Objektskortet historik (punkt 62–64)
PropertyObjectPage visar arbetsordrar och utrustning, men saknar sektioner för serviceintervall, avvikelser, bilder och dokument.

### Prefill från objekt vid AO-skapande (punkt 67)
openCreateAO() skickar objectId/objectName men inte adress, kontaktperson, telefon, e-post eller accessInformation från objektet.

### Kontakter/hyresgäster (punkt 71)
contacts[]-arrayen finns i schema och kan sparas via PropertyObjectService.update(), men det saknas CRUD-UI för att lägga till/ta bort kontakter direkt i objektskortet.

### Rollbaserat döljande av portkod (punkt 72)
doorCode och keyInformation visas för alla inloggade användare. Kräver rollkontroll (t.ex. Auth.can('objects_sensitive')) innan det är säkert för mobila fältarbetare.

### Importera per rad — diff-vy (punkt 50)
Konfliktlösning har tre val (hoppa/uppdatera/skapa ny) per rad, men saknar en sida-vid-sida diff-vy som jämför importvärdena mot befintliga värden.

### Kundexport — markerade kunder (punkt 51)
Export stöder "alla" och "filtrerade" (aktiv sökning + typfiler), men inte manuellt markerade kunder (checkbox per rad).

### XLSX-import — deflate-komprimerade celler
Läsaren hanterar DEFLATE-komprimerade ZIP-poster via DecompressionStream('deflate-raw'). Om Excel-filer exporteras med metod=6 (DEFLATE64) faller läsaren. Ovanligt i Sverige-marknad, men oklart i framtiden.

### Generell import för övriga register (punkt 73)
ImportExportService.js är byggd som återanvändbar motor för alla register.
ImportWizard och kolumnmatchning stöder bara entityType='customer' idag. Fastigheter, objekt, artiklar och personal kräver egna fältmappningar och CRUD-logik — byggs i Fas 4.

---

## Säkerhetsprinciper (gäller alltid)

- Service role key får **aldrig** ligga i frontend
- API-nycklar som kräver hemlighet går via Edge Function, inte direkt i frontend
- VAPID private key läggs **aldrig** i config.js eller frontend
- Bygg inte mot tjänst som inte tillåter autocomplete
- Ta inte bort befintliga funktioner utan explicit godkännande
- Bygg inte stora nya funktioner förrän deploy/cache/GitHub och AO-filter fungerar stabilt live
- Alla produktionskritiska ändringar görs i separata commits med versionsnummer och rollback-punkter
- Export får aldrig automatiskt inkludera portkoder, nyckelinformation eller lösenord
