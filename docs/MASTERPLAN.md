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
| 12 | AO — snapshot-fält (customerName, objectNumber, contactId, contactName, accessInformation) | KLAR | — | schema.js v20, WorkOrdersPage v38 |
| 13 | AO — sökning på objektnamn/objektnummer/port/trapphus | KLAR | — | WorkOrdersPage v38 haystack |
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
| 67 | AO-wizard — prefill adress, kontakt, telefon, e-post från objekt | KLAR | — | WorkOrdersPage v38 (entrance/stairwell/floor/apartmentNumber/contactEmail) |
| 68 | AO-detalj — visar kopplat objekt med länk | KLAR | 0135856 | WorkOrderDetailPage v47 |
| 69 | Serviceintervall-formulär — objectId-väljare | KLAR | f61b26a | PropertyDetailPage v19 |
| 70 | Avvikelse — objectId-väljare i ronderingsvyn | KLAR | f61b26a | RonderingUtforandePage v10 |
| 71 | Kontakter/hyresgäster — primaryContactId + contacts[]-lista med roller och giltighetstid | FÖRBEREDD | f917fdb | Schema.propertyObject() (fälten finns, ingen CRUD-UI för contacts) |
| 72 | Rollbaserad åtkomstkontroll för portkod/nyckelinformation | EJ BYGGD | — | PropertyObjectPage.js — planeras i stabilisering |

---

## Fas 4 — Avancerade funktioner (planerat)

| # | Funktion | Status | Prioritet | Beroenden |
|---|----------|--------|-----------|-----------|
| 73 | Generell import/export — alla register, exportcenter, diff/conflict-UI | DELVIS BYGGD | Hög | 18 register konfigurerade (inkl. Rapporter exportonly); markerad export klar (5 sidor); disambiguering klar; historicalImport-guard klar; webbläsarverifiering återstår |
| 74 | Rondering — visningsrapport (PDF, dela) | KLAR | — | RonderingRapportPage v1 (skriv ut + dela via länk) |
| 75 | Kalender — schemaläggning, dra-och-släpp | KLAR | — | CalendarPage v1 (dag/vecka/månad/agenda, DnD, filter, krockar, pool) |
| 76 | Löneunderlag — export, perioder | EJ BYGGD | Medel | PayrollPage |
| 77 | Rapporter — statistik, diagram (AO, tid, objekt) | BYGGD – BEHÖVER TEST | — | ReportsPage v4: se detaljer nedan |
| 78 | Mina jobb — tilldelade uppdrag per inloggad personal | KLAR | (befintlig) | MyJobsPage (existerar, fel status i MASTERPLAN) |
| 79 | Avancerat behörighetssystem (per fastighet, per kundgrupp) | EJ BYGGD | Låg | Auth.js |
| 80 | E-post-mallar och automatiska utskick | EJ BYGGD | Medel | emailTemplates, supabase/functions |
| 81 | Kontrakthantering (avtal, betalningsplan, villkor) | EJ BYGGD | Medel | ContractsPage |
| 82 | Mobil-optimerad offline-läge (SW fallback) | EJ BYGGD | Låg | sw.js, IndexedDB |
| 129 | Klickbara rapportunderlag — öppna filtrerad lista med aktivt filter och period | EJ BYGGD | Medel | WorkOrdersPage (behöver propertyId/objectId-filter via Router), avvikelselista, serviceintervallista |

---

## Punkt 77 — ReportsPage v4 (detaljer)

**Leveransstatus:** BYGGD – BEHÖVER DATAVERIFIERING OCH WEBBLÄSARTEST  
**Commit:** 4947923 (v3 bas) + ny commit (v4)

### Vad som är byggd (v4)
| Funktion | Status | Kommentar |
|----------|--------|-----------|
| Gemensamt periodfilter (7 preset + eget intervall) | Byggd | Alla flikar respekterar vald period |
| 7 flikar: Översikt, Arbetsordrar, Tid, Avvikelser, Ekonomi, Material, Serviceintervall | Byggd | — |
| Stapeldiagram klickbara till kundkort / fastighetskort / AO-detalj | Byggd | Se kända begränsningar nedan |
| Datakvalitetsvarning per flik (orange banner) | Byggd | Visar poster utan kundkoppling, pris, personal m.m. |
| Personalbeläggning (färgkodad med förklaringstext) | Byggd | Estimat baserat på 160 h/mån |
| Intäkt uppdelat: Fakturerat / Klara ej fakturerade / Pågående | Byggd | Se intäktsdefinitioner nedan |
| Export-knapp (XLSX, respekterar vald period) | Byggd | Period skickas till exportFn via _currentRange |

### Kända begränsningar och estimat (dokumenteras inline i rapporten)
- **Beläggning:** 160 h/mån är ett standardvärde. Individuell kapacitet (sysselsättningsgrad, frånvaro, deltid) saknas. Visas som "estimat" med förklaringstext direkt i rapporten.
- **"Bidrag före lönekostnad"** = Fakturerat (period) − materialkostnad (alla AO, alla perioder). Inte ett fullständigt täckningsbidrag — lönekostnad, underentreprenörer, OH saknas. Benämns tydligt för att skilja sig från TB.
- **Faktureringsgrad** mäts som antal AO (fakturerade / klara+fakturerade), inte som andel av fakturerbart värde. Beloppsbaserad faktureringsgrad kräver timpris per personal + prissättning per AO.
- **Klara ej fakturerade AO** visas som antal — belopp kräver summering av material + tid × timpris.
- **Klickbara staplar → fastighetsfiltrerad AO-lista:** Klick navigerar till fastighetskort (pg-property-detail), inte till filtrerad AO-lista, eftersom WorkOrdersPage saknar propertyId-filterparameter via Router.
- **Intäktkälla:** `state.invoices[].amount` med `invoiceDate` i period, exkl. makulerade. Inte `workOrders` eller `quotes`.

### Datumfält per register (dokumenterat i kod och exportFn)
| Register | Datumfält för period-filter | Kommentar |
|----------|-----------------------------|-----------|
| Arbetsordrar (AO) | `scheduledDate` → `createdAt` → `date` | Utförandedatum i första hand |
| Tidsregistreringar | `date` → `startDate` | Utförandedatum |
| Fakturor (intäkt) | `invoiceDate` → `date` | Fakturadatum, exkl. makulerade |
| Avvikelser | `date` → `createdAt` | Rapportdatum |
| Serviceintervall | `nextDate` | Förfallodatum (ej period-filtrerat — visas alltid) |

### Klickbara rapportunderlag (kvarvarande uppgift, punkt 129)
Staplarna i ReportsPage navigerar i nuläget till kundkort/fastighetskort, inte till filtrerade listor.
Se punkt 129 nedan för fullständig spec.

### Vad som behöver testas
- [ ] Webbläsarverifiering (Chrome, Safari, iOS, iPad, Edge)
- [ ] Periodfilter testat med verkliga data (flera månader, kvartal, år)
- [ ] Datakvalitetsbanners med "Visa poster"-funktion fungerar
- [ ] Klick på staplar navigerar till rätt sida
- [ ] Export (XLSX) respekterar vald period, korrekt filnamn (VIFT_rapport_{flik}_{from}_{to}.xlsx)
- [ ] Beläggningsfärger fungerar korrekt vid >100%
- [ ] Ekonomi-beräkningar verifierade mot faktiska fakturor i test-data

---

## Leverans F4 — Generell import/export (punkt 73)

**Leveransstatus:** DELVIS BYGGD — 18 register konfigurerade (rapport exportonly tillagd), markerad export byggd i 5 sidor, disambiguering byggd, historicalImport-guard fixad; webbläsarverifiering ej gjord

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

## Leverans D — Ansvariga & kontakter per fastighet/objekt (DELVIS BYGGD)

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

## Leverans E — Digitala offerter och kundsvar

**Leveransstatus:** EJ BYGGD  
**Prioritet i arbetsordning:** Byggs efter kvarvarande Leverans D, serviceintervall-motor, push och auto-AO. Inget i Leverans E ersätter eller skjuter upp tidigare planerade funktioner.  
**Säkerhetsregel (permanent):** Tokenkontroll, godkännande, ändringsbegäran och nekande valideras och sparas enbart via säker backend-funktion (Supabase Edge Function). Kunden kan aldrig manipulera offert­status eller belopp via frontendkod. Känsliga interna fält (inköpspris, marginal, TB, interna noter, personalinfo, andra kunder) exponeras aldrig i kundvyn.

### Del E1 — Offertversioner och låsta snapshots

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 93 | Schema — Schema.offerVersion(): versionNumber, lockedAt, lockedSnapshotJSON, versionStatus, changedFields | EJ BYGGD | — | schema.js |
| 94 | Schema — Schema.offerEvent(): händelselogg per offert/version (typ, datum, användare/kund, version, kommentar, relatedId) | EJ BYGGD | — | schema.js |
| 95 | State — state.offerVersions[], state.offerEvents[], persist, DataSync | EJ BYGGD | — | state.js |
| 96 | OffertUI — versionshistorik i offertkortet (lista med versionsnummer, status, datum, lås-ikon) | EJ BYGGD | — | OfferDetailPage.js |
| 97 | Låsning vid utskick — skickad version är oföränderlig; redigering skapar ny version automatiskt | EJ BYGGD | — | OffersPage.js, OfferDetailPage.js |

**Statusar för offerter:**
`Utkast` · `Klar att skicka` · `Skickad` · `Öppnad` · `Ändring begärd` · `Reviderad` · `Godkänd` · `Nekad` · `Utgången` · `Återkallad` · `Ersatt av ny version`

**Versionsregel:** Godkännande kopplas alltid till ett specifikt offerId + offerVersionId + versionNumber + låst snapshot. Ett tidigare godkännande flyttas aldrig automatiskt till ny version.

---

### Del E2 — Säker publik offertlänk

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 98 | Schema — publicToken (lång slumpmässig token), tokenCreatedAt, tokenExpiresAt, tokenRevokedAt, accessStatus, openedAt, openCount | EJ BYGGD | — | schema.js |
| 99 | Edge Function — offer-token-validate: validerar token, kontrollerar giltighetstid och återkallning, returnerar offentlig offertdata (utan känsliga interna fält), rate-limit mot automatiserade anrop | EJ BYGGD | — | supabase/functions/offer-token-validate |
| 100 | Edge Function — offer-respond: tar emot kundsvar (godkänn/ändring/neka), validerar token + version, sparar auditlogg, uppdaterar status | EJ BYGGD | — | supabase/functions/offer-respond |
| 101 | CRM-UI — Skicka digital offert: generera token, sätt giltighetstid, visa länk att kopiera/skicka, se aktiv länkstatus | EJ BYGGD | — | OfferDetailPage.js |
| 102 | CRM-UI — Återkalla länk / förläng giltighetstid / generera ny token (ogiltigförklarar gammal) | EJ BYGGD | — | OfferDetailPage.js |

**Länkkrav:**
- Token är lång, slumpmässig och ogissningsbar — aldrig internt offert-ID ensamt i URL
- Länken kan återkallas när som helst
- Utgången offert visar tydligt meddelande, inga offertuppgifter
- Återkallad länk visar inget offertinnehåll
- Kunden har nollåtkomst till övrig CRM-data

---

### Del E2b — Bilagor per offertversion

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| E2b-1 | Schema — offerAttachment: id, offerVersionId, name, fileType, fileSize, url/path, sortOrder, addedAt | EJ BYGGD | — | schema.js |
| E2b-2 | CRM-UI — lägg till / ta bort / sortera bilagor på en offertversion (drag-drop ordning) | EJ BYGGD | — | OfferDetailPage.js |
| E2b-3 | Låsning — exakt bilageuppsättning (inkl. sortOrder) låses per offertversion vid utskick; ändrad bilaga → ny version | EJ BYGGD | — | OfferDetailPage.js |
| E2b-4 | Kundvy — bilagor listas efter offertinnehållet i vald sortordning; varje bilaga kan öppnas separat | EJ BYGGD | — | PublicOfferPage.js |
| E2b-5 | Samlad offert-PDF — möjlighet att generera en PDF med offert + bilagor i en enda fil (via backend/Edge Function) | EJ BYGGD | — | supabase/functions/offer-pdf |
| E2b-6 | Token-kontroll för bilagor — bilagor servas enbart via giltig offerttoken; ingen publik URL utan auth | EJ BYGGD | — | supabase/functions/offer-token-validate |

**Bilage-regler:**
- Bilagor kopplas till en specifik offerVersionId, inte till offerId
- sortOrder-fältet styr visningsordning i kundvy och PDF
- Ändrad bilaga (ny fil, ny ordning, borttagen) = ny offertversion innan utskick
- Tillåtna typer: bilder (JPEG, PNG, WebP), PDF, eventuellt XLSX (konfigurbart)
- Känsliga interna dokument (kalkyl, TB, underlag) ska aldrig ingå i kundbilagor

---

### Del E3 — Kundvy (extern publik sida)

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 103 | PublicOfferPage — extern kundvy med VIFT-logotyp, kontaktuppgifter, offertnummer, kund, kontaktperson, offertdatum, giltighetstid, rubrik, beskrivning | EJ BYGGD | — | src/pages/PublicOfferPage.js |
| 104 | Kundvy — offertposter: artikel, antal, enhet, à-pris exkl. moms, moms, à-pris inkl. moms, rabatt, tillägg, delsumma | EJ BYGGD | — | PublicOfferPage.js |
| 105 | Kundvy — summering: totalbelopp exkl. moms, moms per sats, totalbelopp inkl. moms, ev. ROT/RUT, ev. förskott | EJ BYGGD | — | PublicOfferPage.js |
| 106 | Kundvy — villkor, betalningsvillkor, omfattning, vad som ingår, vad som inte ingår | EJ BYGGD | — | PublicOfferPage.js |
| 107 | Kundvy — bilagor (lista med tillåtna bilagor kunden kan öppna), kontakta ansvarig (mailto-länk/telefon) | EJ BYGGD | — | PublicOfferPage.js |
| 108 | Kundvy — skriv ut (window.print()), spara/ladda ner som PDF | EJ BYGGD | — | PublicOfferPage.js |

**Designkrav:** Ren, professionell, VIFT-profilerad. Fungerar på mobil, iPhone, iPad, desktop, Safari, Chrome. Inga interna fält, noteringar, inköpspris, marginal, TB, annan kundinformation eller personaldata visas.

---

### Del E4 — Godkänn / Begär ändring / Neka

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 109 | Godkänn offert — bekräftelsedialog: namn, företag, e-post, telefon (valfritt), befattning (valfritt), kommentar (valfritt), checkbox "Jag bekräftar att jag tagit del av och godkänner denna offert och dess villkor." | EJ BYGGD | — | PublicOfferPage.js |
| 110 | Godkänn offert — Edge Function: validerar token+version, låser offertversion, sparar datum/tid, namn, e-post, kommentar, sätter status → Godkänd, skapar offerEvent | EJ BYGGD | — | supabase/functions/offer-respond |
| 111 | Begär ändring — formulär: fritext vad som behöver ändras, kategori (pris/omfattning/tidplan/villkor/offertpost/annat), ev. hänvisning till specifik rad, kontaktuppgifter | EJ BYGGD | — | PublicOfferPage.js |
| 112 | Begär ändring — Edge Function: validerar, sparar invändning + kategori + ev. offertpostId, sätter status → Ändring begärd, skapar offerEvent | EJ BYGGD | — | supabase/functions/offer-respond |
| 113 | Neka offert — bekräftelsedialog: välj anledning (för dyrt / valt annan leverantör / projektet genomförs inte / tidplanen fungerar inte / omfattningen passar inte / annat), kommentar valfri | EJ BYGGD | — | PublicOfferPage.js |
| 114 | Neka offert — Edge Function: validerar, sparar anledning + kommentar, sätter status → Nekad, skapar offerEvent | EJ BYGGD | — | supabase/functions/offer-respond |
| 115 | Kundbekräftelse — kunden ser tydligt bekräftelsemeddelande efter varje svar (godkänd/ändring begärd/nekad), möjlighet att skicka bekräftelse-e-post | EJ BYGGD | — | PublicOfferPage.js |

**Godkännandespårbarhet:** Datum, tid, IP (om tillgänglig), namn och e-post sparas. Beskrivs inte som avancerad e-signatur eller BankID eftersom ingen sådan tjänst används — godkännandet är ett spårbart digitalt samtycke.

---

### Del E5 — Notiser och tidslinje

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 116 | Notiser — ansvarig på VIFT får notis vid: första öppning av länk, godkännande, ändringsbegäran, nekande. Ingen notis vid varje återöppning. | EJ BYGGD | — | PushService.js, supabase/functions/offer-respond |
| 117 | Notiser — format: titel ("Offert godkänd"), text ("Kund AB har godkänt offert OFF-2026-0012, version 2."), deep-link till offerten i CRM | EJ BYGGD | — | PushService.js |
| 118 | Tidslinje-UI — strukturerade händelser visas kronologiskt i offertkortet: skapad, redigerad, version skapad, skickad, öppnad, ändring begärd, svar, godkänd, nekad, utgången, återkallad, konverterad till AO | EJ BYGGD | — | OfferDetailPage.js |
| 119 | Visningsstatistik — CRM visar: när länk skickades, när kunden öppnade första gången, senaste visning, antal visningar, vem som svarade, vilket svar, vilken version | EJ BYGGD | — | OfferDetailPage.js |

---

### Del E6 — Konvertering till AO

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 120 | Konvertering — "Skapa arbetsorder från godkänd offert"-knapp visas efter godkännande (standard: manuell bekräftelse av ansvarig) | EJ BYGGD | — | OfferDetailPage.js |
| 121 | Konvertering — AO ärver: kund, kontakt, fastighet, objekt, offertnummer, offertversion, rubrik, beskrivning, offertposter, priser, material, personal, planering, bilagor, villkor | EJ BYGGD | — | WorkOrderService.js |
| 122 | Konvertering — bi-direktionell länk: Offert.convertedWorkOrderId + convertedAt ↔ AO.sourceOfferId + sourceOfferVersionId + sourceOfferNumber | EJ BYGGD | — | schema.js, WorkOrderService.js, OfferDetailPage.js |
| 123 | Dubbelkonverteringsskydd — offert kan inte konverteras till AO mer än en gång av misstag | EJ BYGGD | — | OfferDetailPage.js |

---

### Del E7 — Påminnelser, analys och stabilisering

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 124 | Påminnelseflaggor — CRM visar offerter som: skickade men ej öppnade, öppnade men obesvarade, snart utgångna (konfig. dagar), utgångna, kräver svar på ändringsbegäran | EJ BYGGD | — | OffersPage.js |
| 125 | Påminnelse — ansvarig kan skicka manuell påminnelse (uppdaterar tokenExpiresAt vid behov). Inga påminnelser skickas efter godkännande, nekande eller återkallande. | EJ BYGGD | — | OfferDetailPage.js |
| 126 | Analysdata — sparas strukturerat för framtida rapportering: antal skickade, öppningsgrad, godkännandegrad, nekandegrad, svarstid, vanligaste nekandeanledning, offertvärde, vunnet/förlorat värde per kund/ansvarig | EJ BYGGD | — | offerEvents (redan i E1/E5) |
| 127 | ReportsPage — Offert-flik: öppningsgrad, godkännandegrad, vanligaste invändningar, offertvärde vunnet/förlorat, per kund och ansvarig | EJ BYGGD | — | ReportsPage.js |
| 128 | Säkerhetsverifiering — fullständig kontroll: inga interna fält i kundvy, tokenkontroll fungerar, rate-limit testad, dubbelkonverteringsskydd verifierat, inga XSS-risker i offertposter | EJ BYGGD | — | — |

### Arbetsordning Leverans E (7 commits)
1. **E1** — Offertversioner + låsta snapshots (schema, state, versionshistorik i UI, låslogik)
2. **E2** — Säker publik länk (token-schema, Edge Functions offer-token-validate + offer-respond, CRM send-UI, återkalla)
3. **E3** — Kundvy / PublicOfferPage (alla offertuppgifter, responsiv, VIFT-profilerad, print/PDF)
4. **E4** — Godkänn / Begär ändring / Neka (dialoger i kundvy, Edge Function-validering, CRM-statusuppdatering)
5. **E5** — Notiser + tidslinje (pushnotiser vid kundsvar, strukturerade events, visningsstatistik)
6. **E6** — Konvertering till AO (ärvning av alla fält, bi-direktionell länk, dubbelskydd)
7. **E7** — Påminnelser, analys, ReportsPage-offertflik, säkerhetsverifiering

---

## Kända begränsningar och planerade stabiliseringar

### AO-snapshot-fält (punkt 12 — KLAR)
Wizard sparar nu: `customerName`, `objectNumber`, `contactId`, `contactEmail`, `entrance`, `stairwell`, `floor`, `apartmentNumber` + befintliga fält.
AO-sökning (punkt 13) inkluderar nu alla dessa fält i haystack.

### Objektskortet historik (punkt 62–64)
PropertyObjectPage visar arbetsordrar och utrustning, men saknar sektioner för serviceintervall, avvikelser, bilder och dokument.

### Prefill från objekt vid AO-skapande (punkt 67 — KLAR)
_wizObjectChanged() fyller nu i: adress, portkod, entrance, stairwell, floor, apartmentNumber, kontaktperson, telefon, e-post via PropertyContactService eller obj.contacts[].

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
