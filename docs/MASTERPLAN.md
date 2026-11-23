# VIFT CRM — Masterplan

Spårar all planerad och genomförd utveckling. Status uppdateras per commit.

**Legenda:**
- `EJ PÅBÖRJAD` — ej startat
- `DELVIS BYGGD` — påbörjad, ofullständig
- `BYGGD – BEHÖVER TEST` — kod finns + UI fungerar, men ej verifierad mot realistisk data i stagingmiljö
- `TESTAD` — verifierad i stagingmiljö med realistisk data
- `BLOCKERAD` — blockeras av annan punkt
- `DEPLOYAD OCH TESTAD` — deploy gjord, verifierad i produktion
- `UPPSKJUTEN TILL V2` — medvetet utskjutet till nästa version
- `KLAR` (äldre poster) — commit finns + UI fungerar, ännu ej omklassificerad

**Totalt antal punkter: 153** (punkt 92 förekommer i Fas 4 = den enda definitionen; punkterna 132-133 är platshållare utan nummer-"gap" — se avsnittet om dem; 140–153 tillkom 2026-11-23, se Leverans H)

**OBS — avstämning mot `docs/PROJECT_STATUS.md` (2026-11-20):** `PROJECT_STATUS.md`:s EGEN "Modulstatus"-tabell (dess översta sektion, punkt 1–92) är en ENGÅNGS-ögonblicksbild som aldrig uppdaterats sedan filen skapades — den säger t.ex. "EJ BYGGD" för punkt 12/13/40–42/62–64/67/72, trots att denna masterplan (uppdaterad iterativt över flera senare commits) och en direkt läsning av den faktiska källkoden DENNA session (`WorkOrdersPage.js`, `supabase/functions/service-monitor/index.ts`) bekräftar att dessa punkter FAKTISKT är byggda. **Denna masterplans tabeller nedan är auktoritativa för modulstatus — inte `PROJECT_STATUS.md`:s översta tabell.** `PROJECT_STATUS.md`:s EGET värde ligger i dess SENARE, additiva sektioner (R9B-fakturaarkitektur, BLOCKER-1/BLOCKER-2-säkerhetsfynd, cross-tab-auth-rättelser rond 1–4, LIVE/STAGING-paritetsfynd) — innehåll som INTE finns någonstans i denna fil. Se ny punkt `R9B-POINTER` nedan.

---

## Fas 0 — Kärninfrastruktur

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 1 | Vanilla JS SPA, hash-routing, pushState/popstate | KLAR | 9b39b63 | Router.js |
| 2 | Supabase single-table blob store (vift_* nycklar) | KLAR | 9b39b63 | Storage.js |
| 3 | Auth (login, roller, RLS, Auth.can()) | KLAR | 9b39b63 | Auth.js |
| 4 | Service Worker v10 (network-first, cache-busting) | KLAR | 9b39b63 | sw.js |
| 5 | DataSync — polling var 15:e sekund | KLAR | 9b39b63 | DataSync.js |
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
| 40 | Schemalagd Edge Function (server-side daglig körning) | BYGGD – BEHÖVER DEPLOY | — | supabase/functions/service-monitor/index.ts |
| 41 | Server-side dubblettskydd (atomisk idempotens) | BYGGD – BEHÖVER DEPLOY | — | supabase/functions/service-monitor/index.ts (duePeriodKey, lastNotificationSentForDueDate, lastAOGeneratedForDueDate) |
| 42 | Web-push för serviceintervall per ansvarig | BYGGD – BEHÖVER DEPLOY | — | supabase/functions/service-monitor/index.ts (riktad via staff-email → auth user, fallback broadcast) |
| 43 | Automatisk AO via Edge Function | BYGGD – BEHÖVER DEPLOY | — | supabase/functions/service-monitor/index.ts (buildWorkOrder, nextWorkOrderId) |

### Punkt 40–43 — Driftsättning

Edge Function byggs med `supabase deploy`:
```bash
supabase functions deploy service-monitor --no-verify-jwt
```

Cron via pg_cron (kör dagligen 06:00 UTC):
```sql
SELECT cron.schedule(
  'service-monitor-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/service-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Alternativt via Supabase Dashboard → Edge Functions → Schedules: lägg till `0 6 * * *`.

Secrets som måste sättas i Supabase:
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` (samma som send-push)
- `SERVICE_MONITOR_SECRET` (valfri extra autentisering)

**VAPID private key läggs aldrig i config.js eller frontend — bara i Supabase Secrets.**

Körlogg lagras som `vift_serviceMonitorLog` i store-tabellen (senaste 90 körningar).
Manuell testkörning: `POST /functions/v1/service-monitor` med `Authorization: Bearer <service_role_key>`.

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
| 59 | Raderingsskydd — blockeras vid aktiva AO eller aktiva serviceintervall | BYGGD – BEHÖVER TEST | 53862af | PropertyObjectService.js v2 — fix: SI lagras i property.serviceIntervals[], inte state.serviceIntervals[] |
| 60 | PropertyDetailPage — Objekt-flik med filter (typ/status/sökning) och CRUD-modaler | KLAR | 9ef6d01 | PropertyDetailPage v18 |
| 61 | PropertyObjectPage v1 — detaljkort (info, access, kontakter, AO, utrustning) | KLAR | 9ef6d01 | PropertyObjectPage.js |
| 62 | Objektskortet — serviceintervall kopplade till objekt | BYGGD – BEHÖVER TEST | aa70444 | PropertyObjectPage.js v3 — läser property.serviceIntervals[], visar status-badge + SI-länk |
| 63 | Objektskortet — avvikelser kopplade till objekt | BYGGD – BEHÖVER TEST | aa70444 | PropertyObjectPage.js v3 — filtrerar state.avvikelser[].objectId |
| 64 | Objektskortet — bilder och dokument | BYGGD – BEHÖVER TEST | aa70444 | PropertyObjectPage.js v3 — asynkron laddning via PropertyImageService, tech_section='obj:'+id |
| 65 | Router — pg-propobj-detail + /objekt/:objId | KLAR | 9ef6d01 | Router.js v17 |
| 66 | AO-wizard — objektväljare (filtrerad per fastighet) + autofill portkod | KLAR | 0135856 | WorkOrdersPage v34 |
| 67 | AO-wizard — prefill adress, kontakt, telefon, e-post från objekt | KLAR | — | WorkOrdersPage v38 (entrance/stairwell/floor/apartmentNumber/contactEmail) |
| 68 | AO-detalj — visar kopplat objekt med länk | KLAR | 0135856 | WorkOrderDetailPage v47 |
| 69 | Serviceintervall-formulär — objectId-väljare | KLAR | f61b26a | PropertyDetailPage v19 |
| 70 | Avvikelse — objectId-väljare i ronderingsvyn | KLAR | f61b26a | RonderingUtforandePage v10 |
| 71 | Kontakter/hyresgäster — CRUD (namn, telefon, e-post, roll, primär, giltighet, anteckning) | BYGGD – BEHÖVER TEST | aa70444 | PropertyObjectPage.js v3 — _addTenantContact, _editTenantContact, _removeTenantContact, sparas i obj.contacts[] |
| 72 | Rollbaserad åtkomstkontroll för portkod/nyckelinformation | BYGGD – BEHÖVER TEST | e8edf00 | Fullständig implementation: PropertyObjectPage, PropertyDetailPage, WorkOrdersPage, WorkOrderDetailPage, ExportCenterPage, PageShells (AdminPage rollredigering) |

---

## Fas 4 — Avancerade funktioner (planerat)

| # | Funktion | Status | Prioritet | Beroenden |
|---|----------|--------|-----------|-----------|
| 73 | Generell import/export — alla register, exportcenter, diff/conflict-UI | DELVIS BYGGD | Hög | 18 register konfigurerade (inkl. Rapporter exportonly); markerad export klar (5 sidor); disambiguering klar; historicalImport-guard klar; webbläsarverifiering återstår |
| 74 | Rondering — visningsrapport (PDF, dela) | KLAR | — | RonderingRapportPage v1 (skriv ut + dela via länk) |
| 75 | Kalender — schemaläggning, dra-och-släpp | BYGGD – BEHÖVER TEST | 77ed695 | CalendarPage v2 — Pointer Events DnD (long-press 480ms, scroll blockeras ej); desktop HTML5 DnD kvar |
| 76 | Löneunderlag — export, perioder | BYGGD – BEHÖVER TEST | 481b323 | PayrollPage.js v2: auth-guard i render/export/attest (Auth.can('reports_view')); direkt URL-åtkomst blockeras |
| 77 | Rapporter — statistik, diagram (AO, tid, objekt) | BYGGD – BEHÖVER TEST | — | ReportsPage v4: se detaljer nedan |
| 78 | Mina jobb — tilldelade uppdrag per inloggad personal | KLAR | (befintlig) | MyJobsPage (existerar, fel status i MASTERPLAN) |
| 79 | Avancerat behörighetssystem (per fastighet, per kundgrupp) | UPPSKJUTET | Låg | Kräver ombyggnad av Auth.js — planeras ej i nuvarande fas |
| 80 | E-post-sändning via Edge Function (Resend) | BYGGD – BEHÖVER DEPLOY | 0f70a0f | supabase/functions/send-offer-email/index.ts; PageShells.js v89 — showSendModal med recipients/CC/BCC/mall/offerLink/bilagor/tidslinje-log; mailto fallback |
| 81 | Kontrakthantering (avtal, betalningsplan, villkor) | KLAR | Medel | ContractsPage.js v1: CRUD, filter, årstotal, tillsvidara/auto-förnyelse |
| 82 | Mobil-optimerad offline-läge (SW fallback) | UPPSKJUTET | Låg | Kräver IndexedDB-cachning i SW — planeras ej i nuvarande fas |
| 92 | Push/notiser — använd ansvarig titel vid utskick | KLAR | — | send-push v2 + PushService v5: propertyId → propertyContacts → primär/alla aktiva staff |
| 129 | Klickbara rapportunderlag — öppna filtrerad lista med aktivt filter och period | KLAR | v38→v39 | WorkOrdersPage stöder nu propertyId/customerId via Router. AO-staplarna i ReportsPage navigerar till filtrerad AO-lista. |

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
| 88 | Objektskortet — kontakter på objektnivå (hyresgäst, lokalansvarig) | BYGGD – BEHÖVER TEST | aa70444 | PropertyObjectPage v3 — full CRUD för hyresgästkontakter (punkt 71) |
| 89 | AO-wizard — föreslå kontakt baserat på fastighet + kategori + titel | KLAR | — | WorkOrdersPage v37 |
| 90 | Dagens drift — visa ansvariga per fastighet | KLAR | — | OperationsPage v10 |
| 91 | PropertyContactService — CRUD, primärkontroll, historikvy | KLAR | af97e9f | PropertyContactService.js v1 |
| ~~92~~ | *(Se punkt 92 i Fas 4 — Push/notiser ansvarig titel. Dublett borttagen.)* | — | — | — |

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

**Leveransstatus:** DELVIS BYGGD (E1+E2+E3+E4 klara — E5 notiser, E6 konvertering, E7 påminnelser/analys återstår)  
**Prioritet i arbetsordning:** Byggs efter kvarvarande Leverans D, serviceintervall-motor, push och auto-AO. Inget i Leverans E ersätter eller skjuter upp tidigare planerade funktioner.  
**Säkerhetsregel (permanent):** Tokenkontroll, godkännande, ändringsbegäran och nekande valideras och sparas enbart via säker backend-funktion (Supabase Edge Function). Kunden kan aldrig manipulera offert­status eller belopp via frontendkod. Känsliga interna fält (inköpspris, marginal, TB, interna noter, personalinfo, andra kunder) exponeras aldrig i kundvyn.

### Del E1 — Offertversioner och låsta snapshots

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 93 | Schema — Schema.offerEvent(), token-fält på offer (publicToken, tokenCreatedAt, tokenExpiresAt, tokenRevokedAt, openCount, openedAt, lockedSnapshotJSON) | KLAR | — | schema.js v21 |
| 94 | Schema — Schema.offerEvent(): händelselogg per offert/version | KLAR | — | schema.js v21 |
| 95 | State — state.offerEvents[], persist, DataSync | KLAR | — | state.js v31 |
| 96 | OffertUI — Digital länk-panel i offertkortet (generera, kopiera, statusindikator, återkalla, förläng) | KLAR | — | PageShells.js v82 (_digitalLinkPanel, generateDigitalLink, revokeDigitalLink, extendDigitalLink) |
| 97 | Låsning vid utskick — lockedSnapshotJSON sparas vid tokengenerering | KLAR | — | PageShells.js v82 (generateDigitalLink) |

**Statusar för offerter:**
`Utkast` · `Klar att skicka` · `Skickad` · `Öppnad` · `Ändring begärd` · `Reviderad` · `Godkänd` · `Nekad` · `Utgången` · `Återkallad` · `Ersatt av ny version`

**Versionsregel:** Godkännande kopplas alltid till ett specifikt offerId + offerVersionId + versionNumber + låst snapshot. Ett tidigare godkännande flyttas aldrig automatiskt till ny version.

---

### Del E2 — Säker publik offertlänk

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 98 | Schema — publicToken, tokenCreatedAt, tokenExpiresAt, tokenRevokedAt, openedAt, openCount på offer | KLAR | — | schema.js v21 |
| 99 | Edge Function — offer-token-validate: rate-limit 30/min, validerar token/giltighetstid/återkallning, returnerar publika fält (inga interna), uppdaterar openCount/openedAt | KLAR | — | supabase/functions/offer-token-validate/index.ts |
| 100 | Edge Function — offer-respond: godkänn/ändring/neka, rate-limit 5/min, validerar token+version, sparar auditlogg, uppdaterar status, push-notis till VIFT | KLAR | — | supabase/functions/offer-respond/index.ts |
| 101 | CRM-UI — Generera digital länk: token, giltighetstid, visningslänk + kopiering, statusindikator | KLAR | — | PageShells.js v82 (generateDigitalLink, _digitalLinkPanel) |
| 102 | CRM-UI — Återkalla länk / förläng giltighetstid / generera ny token | KLAR | — | PageShells.js v82 (revokeDigitalLink, extendDigitalLink) |

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
| E2b-1 | Schema — Schema.offerAttachment(): storagePath, checksum, lockedInVersion, includeInPublicView m.m. State.offerAttachments | KLAR | 952508d | schema.js v22, state.js v32 |
| E2b-2 | CRM-UI — dropzone, fillista, redigering (namn/beskrivning/kundvy/PDF), borttagning. offer-attachment-upload Edge Function | KLAR | 2ab4413 | PageShells.js v85, components.css, offer-attachment-upload/index.ts |
| E2b-3 | Kundåtkomst — offer-attachment-url ger signerade Supabase Storage-URL:er (3600s). offer-token-validate returnerar public attachments | KLAR | 0a5b7f8 | offer-attachment-url/index.ts, offer-token-validate/index.ts v2, public-offer.html v2 |
| E2b-4 | Samlad PDF — offer-pdf kombinerar offertinnehåll + inbäddningsbara bilagor (PDF, JPEG, PNG). DOCX/XLSX listas separat | KLAR | 9172c26 | offer-pdf/index.ts |
| E2b-5 | Versionslåsning — bilagor markeras lockedInVersion vid digital länk-generering | KLAR | 57a691e | PageShells.js (generateDigitalLink) |
| E2b-6 | Token-kontroll — storagePath exponeras aldrig; offer-attachment-url validerar token/revokering/giltighetstid/includeInPublicView | KLAR | 0a5b7f8 | offer-attachment-url/index.ts |

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
| 103 | PublicOfferPage — extern kundvy med VIFT-logotyp, offertnummer, kund, datum, giltighetstid, rubrik, beskrivning | KLAR | — | public-offer.html |
| 104 | Kundvy — offertposter: namn, à-pris inkl. moms, RUT/ROT-märkning, tillägg, rad-detaljer | KLAR | — | public-offer.html |
| 105 | Kundvy — summering: exkl. moms, moms, RUT/ROT-avdrag, kundpris | KLAR | — | public-offer.html |
| 106 | Kundvy — villkor, betalningsvillkor, omfattning, ingår/ingår ej, allmänna villkor | KLAR | — | public-offer.html |
| 107 | Kundvy — statusmeddelanden (godkänd/nekad/ändring), utgångspåminnelse | KLAR | — | public-offer.html |
| 108 | Kundvy — Skriv ut (window.print()), responsiv (mobil/desktop/iOS Safari/Chrome) | KLAR | — | public-offer.html |

**Designkrav:** Ren, professionell, VIFT-profilerad. Fungerar på mobil, iPhone, iPad, desktop, Safari, Chrome. Inga interna fält, noteringar, inköpspris, marginal, TB, annan kundinformation eller personaldata visas.

---

### Del E4 — Godkänn / Begär ändring / Neka

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 109 | Godkänn offert — formulär: namn, e-post, telefon, befattning, kommentar, villkors-checkbox | KLAR | — | public-offer.html (showForm approve) |
| 110 | Godkänn offert — Edge Function: validerar token+version, sparar datum/tid/namn/e-post/IP, sätter status → godkänd, offerEvent | KLAR | — | offer-respond (action=approve) |
| 111 | Begär ändring — formulär: kategori (pris/omfattning/tidplan/villkor/offertpost/annat), fritext | KLAR | — | public-offer.html (showForm change_request) |
| 112 | Begär ändring — Edge Function: validerar, sparar invändning + kategori, sätter status → ändring-begärd, offerEvent | KLAR | — | offer-respond (action=change_request) |
| 113 | Neka offert — formulär: anledning (för dyrt/annan leverantör/genomförs ej/tidplan/omfattning/annat), valfri kommentar | KLAR | — | public-offer.html (showForm decline) |
| 114 | Neka offert — Edge Function: validerar, sparar anledning + kommentar, sätter status → nekad, offerEvent | KLAR | — | offer-respond (action=decline) |
| 115 | Kundbekräftelse — tydlig bekräftelsebox efter godkänn/ändring/neka, push-notis till VIFT-personal | KLAR | — | public-offer.html (po-success-box), offer-respond (sendPushToVift) |

**Godkännandespårbarhet:** Datum, tid, IP (om tillgänglig), namn och e-post sparas. Beskrivs inte som avancerad e-signatur eller BankID eftersom ingen sådan tjänst används — godkännandet är ett spårbart digitalt samtycke.

---

### Del E5 — Notiser och tidslinje

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 116 | Notiser — push till VIFT vid godkännande, ändringsbegäran, nekande | KLAR | — | offer-respond (sendPushToVift — broadcast till alla aktiva) |
| 117 | Notiser — format: "Offert godkänd" / "Ändring begärd" / "Offert nekad" + kundens namn + offertid | KLAR | — | offer-respond |
| 118 | Tidslinje-UI — offerEvents (öppnat/godkänt/ändring/nekat) visas i _timelineHtml kombinerat med interna händelser | KLAR | — | PageShells.js v83 (_timelineHtml — slår ihop off.timeline + state.offerEvents) |
| 119 | Visningsstatistik — öppningsantal, openedAt, openCount visas i digital länk-panel | KLAR | — | PageShells.js (_digitalLinkPanel) |

---

### Del E6 — Konvertering till AO

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 120 | Konvertering — "Skapa arbetsorder från godkänd offert"-knapp (status=godkänd && !workOrderId) | KLAR | — | PageShells.js (OfferDetailPage.createAO CTA) |
| 121 | Konvertering — AO ärver kund, fastighet, titel, beskrivning, offertposter, priser, checklista | KLAR | — | PageShells.js (OfferDetailPage.createAO) |
| 122 | Konvertering — off.workOrderId + convertedAt ↔ ao.sourceOfferId + sourceOfferVersionId + sourceOfferNumber | KLAR | — | PageShells.js v83 (createAO) |
| 123 | Dubbelkonverteringsskydd — kontroll + toast om workOrderId redan satt | KLAR | — | PageShells.js v83 (createAO — tidig return med toast) |

---

### Del E7 — Påminnelser, analys och stabilisering

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 124 | Påminnelseflaggor — CRM visar offerter som: skickade men ej öppnade, öppnade men obesvarade, snart utgångna (konfig. dagar), utgångna, kräver svar på ändringsbegäran | KLAR | E7 | PageShells.js — _offerInsight() + "Behöver åtgärd"-tab |
| 125 | Påminnelse — ansvarig kan skicka manuell påminnelse (uppdaterar tokenExpiresAt vid behov). Inga påminnelser skickas efter godkännande, nekande eller återkallande. | KLAR | v84 | PageShells.js — sendReminder() med mailto + valfri tokenExpiresAt-förlängning |
| 126 | Analysdata — sparas strukturerat för framtida rapportering: antal skickade, öppningsgrad, godkännandegrad, nekandegrad, svarstid, vanligaste nekandeanledning, offertvärde, vunnet/förlorat värde per kund/ansvarig | KLAR | v6 | offerEvents (E1/E5) + ReportsPage Offert-flik (punkt 127) |
| 127 | ReportsPage — Offert-flik: öppningsgrad, godkännandegrad, vanligaste invändningar, offertvärde vunnet/förlorat, per kund och ansvarig | KLAR | v6 | ReportsPage.js |
| 128 | Säkerhetsverifiering — fullständig kontroll: inga interna fält i kundvy, tokenkontroll fungerar, rate-limit testad, dubbelkonverteringsskydd verifierat, inga XSS-risker i offertposter | KLAR | — | Automatisk audit (7/8 PASS). Fix: already_answered blockerar nu ALLA svar (inte bara approve) efter godkänd/nekad offert. |

### Arbetsordning Leverans E (7 commits)
1. **E1** — Offertversioner + låsta snapshots (schema, state, versionshistorik i UI, låslogik)
2. **E2** — Säker publik länk (token-schema, Edge Functions offer-token-validate + offer-respond, CRM send-UI, återkalla)
3. **E3** — Kundvy / PublicOfferPage (alla offertuppgifter, responsiv, VIFT-profilerad, print/PDF)
4. **E4** — Godkänn / Begär ändring / Neka (dialoger i kundvy, Edge Function-validering, CRM-statusuppdatering)
5. **E5** — Notiser + tidslinje (pushnotiser vid kundsvar, strukturerade events, visningsstatistik)
6. **E6** — Konvertering till AO (ärvning av alla fält, bi-direktionell länk, dubbelskydd)
7. **E7** — Påminnelser, analys, ReportsPage-offertflik, säkerhetsverifiering

---

## Leverans G — Driftsstabilitet, prestandaoptimering och R9B-pekare (2026-11-20)

**OBS om namngivning:** "CRM 12"/"CRM 13" m.fl. är ENDAST namn på externa ChatGPT-konversationer där delar av detta arbete togs fram — INGET projekt-, versions- eller leveransnamn i detta system. VIFT CRM är ett enda sammanhängande system; denna sektion fortsätter samma numrerade punktserie som resten av filen.

### R9B-pekare — fakturaarkitektur och säkerhetsfynd (full detalj i `docs/PROJECT_STATUS.md`)

`PROJECT_STATUS.md` innehåller en omfattande, löpande logg (punkt 1–20) som INTE finns här: en ny, atomisk fakturerings-RPC-arkitektur (R9B, installerad och godkänd i STAGING, EJ i LIVE), två kritiska säkerhetsfynd (**BLOCKER-1**: `timeEntries`/lönedata läsbart av alla inloggade — serverläsvägen nu blockerad i STAGING via en riktad RLS-policy, se fynd nedan om en relaterad, KVARSTÅENDE lucka; **BLOCKER-2**: `store`-tabellens skrivpolicy saknar per-nyckel-kontroll — KVARSTÅR, oåtgärdad), samt fyra rondor av cross-tab-sessionsrättelser. Denna fil lägger INTE till några nya numrerade punkter för det arbetet — det vore att duplicera, inte komplettera. `docs/PROJECT_STATUS.md` är den auktoritativa källan för den delen; denna fil är auktoritativ för modulstatus (se avstämningsnotisen högst upp i detta dokument).

### Driftsstabilitet och prestandaoptimering — verifierat orsaksfynd och åtgärder

**Bakgrund:** Supabase LIVE har haft bekräftade problem med Disk IO, RAM och swap (bekräftat av Supabase Support), samt en mätt ~16 GB WAL-volym från en specifik frågegrupp om 2 928 skrivningar till `public.store`. En egen, riktad undersökning denna session verifierade grundorsaken direkt mot källkoden (inte antagande): `persist()`/`_doPersist()` i `src/data/state.js` skickade **samtliga ~34 store-nycklar** till Supabase vid VARJE anrop, oavsett vilken nyckel som faktiskt ändrats — en kundredigering skrev alltså om hela den ~13,5 MB stora `vift_workOrders`-raden i onödan. Tre bilder inbäddade som okomprimerad base64 i en enda arbetsorders loggpost dominerade den radens storlek. En äkta WAL-mätning mot lokal PostgreSQL 16 (före/efter, extrapolerad till 2 928 skrivningar) gav ~16,24 GB för "före"-beteendet — inom ~1,5 % av det rapporterade, verkliga talet.

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 130 | `persist()` skickar nu endast de store-nycklar vars värde faktiskt ändrats sedan senaste bekräftade skrivning (diff mot `_lastWrittenJSON`, uppdateras endast efter bekräftad framgång — ingen tyst dataförlust vid misslyckad skrivning) | KLAR — verifierat lokalt (5/5 sandlådetest mot den faktiska filen), EJ TESTAT i STAGING | b8a95d0 | state.js v50 |
| 131 | Nya arbetsorder-loggfoton laddas upp till Supabase Storage (`workorder-images`, privat bucket, samma åtkomstmodell som befintlig `PropertyImageService`) istället för att bäddas in som base64 i `vift_workOrders`. Befintliga, historiska bilder orörda (bakåtkompatibel rendering). Avvikelse-/checklistefoto komprimeras (900px/JPEG 0.75) men flyttas INTE till Storage denna omgång (EF-kontraktet oförändrat) | KLAR — verifierat lokalt (4/4 isolerade logiktest), EJ TESTAT i STAGING. Bucket/RLS-policy EJ installerad (kräver separat GO) | faa43e6 | WorkOrderImageService.js (ny), WorkOrderDetailPage.js v74 |
| 134 | Säker bildradering — `deleteLogEntry()` raderade tidigare Storage-filen INNAN databasen bekräftat att loggposten själv raderats; ett misslyckat/osäkert nätverksanrop kunde lämna en loggpost kvar med en redan borttagen bild. Ordningen är nu: mutera lokalt → `await persist()` → ENDAST vid bekräftad framgång rörs Storage-filen; vid misslyckande rullas den lokala mutationen tillbaka | KLAR — kod granskad + syntaxkontrollerad, EJ automatiserat testad (DOM-beroende), EJ TESTAT i STAGING | — | WorkOrderDetailPage.js v75 |
| 135 | Tidregistrerings-integritet, hela dataflödet — tre separata brister rättade: (1) `DataSync._poll()`:s ovillkorliga "uppdatera localStorage"-block skrev tidigare RÅA, ofiltrerade `remote.timeEntries`/`remote.staff` till localStorage trots att `state.X` redan var filtrerat/sanerat; (2) `initState()` (körs FÖRE identiteten är känd) satte ALDRIG något payroll-filter alls — `state.timeEntries` var fullt ofiltrerat i minnet från appstart tills FÖRSTA poll-cykeln råkade upptäcka en fjärrändring; (3) ny, delad `_applyTimeEntriesPayrollFilter()` anropas nu från BÅDE `Auth._resolveUser()` (appstart/inloggning/rollbyte — stänger lucka 2) OCH `DataSync._poll()` (stänger lucka 1) | KLAR — verifierat lokalt (4/4 sandlådetest mot de faktiska filerna, inkl. fail-closed för okänd identitet), EJ TESTAT i STAGING. **Kvarstående, oförändrad, redan dokumenterad begränsning** (ej löst här): ingen server-side RLS-nivå-filtrering finns ännu (BLOCKER-1:s fullständiga fix) — se egen notis nedan | — | state.js v51, AuthService.js v17 |
| 136 | Idempotenskonflikt mellan `runDailyCheck()` och `service-monitor` — RÄTTELSE av ett eget tidigare felaktigt påstående (se notis ovan): `runDailyCheck()` anropas FAKTISKT vid varje inloggning (`index.html` `App.showApp()`), och delade TIDIGARE idempotensnyckel med service-monitors push-logik — en REDAN AKTIV bugg, inte en hypotetisk framtida risk. Ny, egen nyckel `lastActivityNotifiedForDueDate` införd för `runDailyCheck()`; `lastNotificationSentForDueDate` nu reserverad enbart för service-monitor (orört) | KLAR — kod granskad + syntaxkontrollerad, EJ TESTAT i STAGING | — | ServiceIntervalService.js v4 |
| 137 | Arbetsorderbilder — serverbaserad åtkomstkontroll istället för enbart frontend-kontroll. Två nya Edge Functions, `work-order-image-url` och `work-order-image-upload`, ersätter direkt klient→Storage-anrop: båda kör `checkViftAuth()` och en ny, delad `canViewWorkOrder(ao, perms, callerStaffId)`-regel i `_shared/vift-auth.ts` (källverifierad mot exakt samma synlighetsregel som redan används av `WorkOrdersPage.js`: `ao_view_all`/`all` → allt, annars `ao_view_own` OCH (tilldelad ELLER `status==='pool'`), fail-closed vid okänd `callerStaffId`). Ny `isPathUnderAo()` stoppar IDOR — en anropare behörig för EN arbetsorder kan inte begära en signerad URL för en ANNAN arbetsorders bildsökväg genom att skicka in fel `aoId`. Uppladdning kräver dessutom `ao_checklist`/`ao_edit`, sniffar faktiska magic bytes (JPEG/PNG/WebP) istället för att lita på klientens Content-Type, och begränsar till 10 MB. `WorkOrderImageService.js` uppdaterad att anropa dessa EF:er istället för Storage direkt för `upload()`/`getSignedUrls()`; `remove()` går fortfarande direkt mot Storage under en ÄNNU EJ installerad, smalare DELETE-policy — kvarstående, dokumenterad, mindre risk. `WorkOrderDetailPage.js` INTE rörd av denna ändring (bekräftat via `git diff --stat`) | KLAR — `tsc --strict` exit 0, 18/18 egna, oberoende sandlådetest mot den faktiska transpilerade källkoden (inkl. IDOR- och fail-closed-fall), EJ TESTAT i STAGING. Storage-bucketns SELECT/INSERT-policy (förslag i filens headerkommentar: begränsa till `service_role` only) EJ installerad — kräver separat GO | 07e46e5 | `_shared/vift-auth.ts`, `work-order-image-url/index.ts` (ny), `work-order-image-upload/index.ts` (ny), WorkOrderImageService.js v2 |
| 138 | Installationsavstämning (2026-11-22) — tre kvarstående, konkreta fynd från punkt 137 åtgärdade: **(a)** den föreslagna `wo_images_storage_delete`-policyn tillät fortfarande `TO authenticated` DELETE på HELA bucketen — stängd med en tredje EF, `work-order-image-delete` (samma mönster: `checkViftAuth` + `ao_checklist`/`ao_edit` + `canViewWorkOrder` + `isPathUnderAo`, service_role-radering); bucket-förslaget ändrat så ALLA tre operationer (SELECT/INSERT/DELETE) nu är `service_role`-only, ingen `authenticated`-policy kvar. `WorkOrderImageService.remove()` anropar nu denna EF (signatur ändrad till `remove(aoId, storagePath)`); enda anropsplatsen (`WorkOrderDetailPage.deleteLogEntry()`) uppdaterad. **(b)** verifierat en REDAN EXISTERANDE sårbarhet i `work-order-image-upload`: `effectiveMime = sniffed ?? claimed` föll tillbaka på klientens (trivialt förfalskningsbara) Content-Type när magic-byte-sniffningen inte kände igen filen — gjorde hela innehållskontrollen verkningslös. Rättat så `sniffed` ensamt är auktoritativt; en fil vars faktiska bytes inte matchar en känd bildsignatur avvisas alltid, oavsett deklarerad Content-Type. **(c)** verifierat att `Storage._authFetch()`/`setAll()` (skrivvägen `persist()` använder, inkl. `deleteLogEntry()`s två sekventiella anrop) saknade ALL timeout-hantering — ett hängande `fetch()` kunde låta `await persist()` vänta obegränsat, utan feedback. Ny, opt-in `timeoutMs`-parameter (AbortController) i `_authFetch()`; `setAll()` sätter 20000ms. Läsvägarna (`get`/`getAll`, `initState()`s egen 8s-fallback) är OBERÖRDA (`timeoutMs` default = inget, exakt tidigare beteende). Verifierat: `_persistQueue` serialiserar `WorkOrderService.update()`s interna (fire-and-forget) persist() och `deleteLogEntry()`s explicita `await persist()` strikt sekventiellt, och `_lastWrittenJSON`-cachen uppdateras ENDAST vid bekräftad framgång — en "delvis lyckad skrivning" kan inte uppstå på SQL-nivå (`Storage.setAll()` är ETT enda PostgREST-upsert-anrop, atomiskt), och ett timeout-fel fångas av samma redan korrekta `catch` som returnerar `false` (aldrig `true`, aldrig ett okontrollerat hängande löfte) | KLAR — `tsc --strict` exit 0 (alla tre EF:er), 10/10 test mot den riktiga, rättade `sniffMime`-logiken (inkl. simulerad förfalskad Content-Type-attack), 5/5 test av timeout-mekanismen mot den riktiga `storage.js` (inkl. ett verkligt 20 024 ms end-to-end-test av `setAll()` mot en hängande `fetch()`, som bekräftar `false` — ALDRIG hängande/`true`), EJ TESTAT i STAGING. Bucket-policyerna (alla tre nu `service_role`-only) EJ installerade — kräver separat GO | — | `work-order-image-delete/index.ts` (ny), `work-order-image-upload/index.ts`, `WorkOrderImageService.js` v3, `WorkOrderDetailPage.js` v76, `storage.js` v12 |
| 139 | STAGING-reconciliation (2026-11-22) — en direkt, läsande jämförelse mot faktisk installerad STAGING-kod (`docs/STAGING-FAKTISK-KOD-DIFF-2026-11-22.md`) hittade att denna branchs `service-monitor/index.ts` hade REGRESSERAT till en äldre, batch-upsert-baserad (icke-atomisk) version av AO-skapandet — den redan installerade, verifierat körande STAGING v15 använder den säkrare, atomiska `work_order_create`-RPC:n. Branchens källa återställd att matcha exakt (commit `84cbafd`). Samtidigt bekräftat: `time-entries-list` är redan installerad som v3 med GET+POST — branchens nyare GET-only-variant (denna sessions BLOCKER-1-arbete) hade tappat POST-kompatibiliteten; återställd att stödja båda METHODS igen, med denna sessions server-sidiga filtrering/rate-limit bevarad (commit `baeb9b4`). Vidare bekräftat REDAN installerat i STAGING (ingen ny åtgärd): `store_timeentries_no_direct_select` och `store_workorders_no_direct_select` (båda RESTRICTIVE SELECT TO authenticated) samt `service-monitor`s pg_cron-jobb (`vift-service-monitor-daily`, `active=false`, väntar på separat aktiveringsbeslut). Denna sessions redundanta migrationsförslag `20261120000002_PROPOSAL_timeentries_read_lockdown.sql` markerad ÖVERSPELAD (ej raderad, historik bevarad) eftersom STAGING redan har en likvärdig policy. Nytt, flaggat (ej löst) gap: RPC:n `work_order_create` finns i STAGING men saknar en committed migration i detta repo. Allt sammanställt i en enda installationsplan, `docs/INSTALLATIONSPLAN-STAGING-2026-11-22.md` | KLAR — `tsc --strict` OK på båda återställda EF:erna (en enda, pre-existerande, oförändrad kosmetisk `implicit any` i den overifierat matchande STAGING-koden, ej åtgärdad för att inte avvika från den bekräftat körande källan), 73/73 ackumulerat regressionstest oförändrat gröna efter fast-forward-merge. Installationsplanen EJ körd — väntar på GO per rad | 84cbafd, baeb9b4, f2fbcab, a6b1e30 | `service-monitor/index.ts`, `time-entries-list/index.ts`, `docs/STAGING-FAKTISK-KOD-DIFF-2026-11-22.md` (ny), `docs/INSTALLATIONSPLAN-STAGING-2026-11-22.md` (ny) |

**RÄTTELSE av tidigare felaktigt påstående i denna fil (2026-11-20):** föregående version av denna punkt påstod att `ServiceIntervalService.runDailyCheck()` "anropas ALDRIG någonstans i kodbasen" — FELAKTIGT. Den sökningen var av misstag begränsad till `src/`-mappen och missade `index.html`:s egen inline-`<script>`, där `App.showApp()` (rad ~636-639) FAKTISKT anropar `runDailyCheck()` via `setTimeout(...,2000)` VARJE gång en användare loggar in/appen visas. Idempotenskonflikten med `service-monitor` (punkt 42) var alltså INTE en hypotetisk, framtida risk — det var en REDAN AKTIV bugg: varje inloggning kunde tysta service-monitors riktiga push-notis för en förfallen period, redan innan funktionen ens deployats. **ÅTGÄRDAT (punkt 134 nedan)**, inte längre öppet.

**Nytt fynd, ej åtgärdat (lägre allvarlighet, ej brådskande):** `service-monitor`/index.ts:s egen skrivning tillbaka till `vift_properties`/`vift_workOrders` (rad ~303–319) är ett olåst läs-ändra-skriv av hela blobben, samma mönster som punkt 130 ovan rättar för klientvägen — men körs bara en gång dagligen via cron och är ännu inte deployad, så prioriteras lägre. Bör ges samma atomiska-RPC-behandling före produktionsdeploy om det är praktiskt genomförbart.

### Platshållare — väntar på specifikation (ingen spår hittad i detta repo)

Följande två områden efterfrågades uttryckligen som "tidigare beslutade utvecklingsområden" som ska finnas kvar i masterplanen. En grundlig sökning i hela detta repo (kod + samtliga `docs/*.md`) denna session hittade INGEN tidigare specifikation, kod eller dokumentation för dem — de finns sannolikt bara i en extern ChatGPT-konversation som aldrig synkroniserats hit. Registrerade här som uttryckliga platshållare, INTE uppfunna/gissade specifikationer:

| # | Funktion | Status | Prioritet |
|---|----------|--------|-----------|
| 132 | AI-arbetsorderinkorg — ingen specifikation hittad i detta repo. Kräver en konkret kravbeskrivning (vad ska AI:n göra: triagera inkommande ärenden? Föreslå arbetsorder-fält? Från vilken källa — e-post, formulär, chatt?) innan den kan planeras eller byggas. | EJ PÅBÖRJAD — väntar på specifikation | Okänd — ange vid nästa tillfälle |
| 133 | Integrationer (externa system) — ingen specifikation hittad i detta repo (vilka system — bokföring, kalender, e-post, annat? Vilken riktning — import, export, realtid?). | EJ PÅBÖRJAD — väntar på specifikation | Okänd — ange vid nästa tillfälle |

---

## Leverans H — En kodbas, säker skrivväg och molnstämpling (2026-11-23)

Bakgrund: `docs/STAGING-AO-TID-SKRIVVAG-BLOCKERARE-2026-11-22.md`. Branchen visade sig vara en äldre kodlinje än den deployade STAGING-klienten; STAGING-klienten är nu baslinje (detaljer: `docs/KODBAS-STAGING-BASLINJE-2026-11-23.md`). Installationsläge per del: `docs/INSTALLATIONSPLAN-STAGING-2026-11-22.md` (uppdaterad 2026-11-23). "BYGGD" nedan = kodklart och lokalt testat, **inte** installerat eller verifierat i STAGING.

| # | Funktion | Status | Commit |
|---|----------|--------|--------|
| 140 | En kodbas: deployad STAGING-klient som baslinje med LIVE-miljööverlägg; miljöskyddstest | KLAR i repo (inte en driftsättning) | 56a943d |
| 141 | AO/tid: inget "sparat" före serverns ACK; nekad ändring återställs (manuell tid, radering, arkiv/papperskorg/permanent radering, prissättning); centralt besked + omläsning när fire-and-forget-ändringar nekas; massändringar rapporterar definitiva avslag | BYGGD — 34 lokala kontroller | f94f131, c4e8436 |
| 142 | Molnbaserad instämpling på befintlig `stamp_status`: uppdatering mellan enheter (flikfokus + var 90:e s), en tidpost per pass vid utstämpling från två enheter, omladdningssäker utstämpling via varaktig intent | BYGGD — 28 lokala kontroller; VÄNTAR PÅ STAGING-test av serverns idempotens (G6) | 7868335 |
| 143 | Skrivtimeout (20 s) på alla skrivvägar, även ao-time-write; timeout = osäkert utfall, aldrig "sparat" | BYGGD — 22 kontroller | 37fc1ca |
| 144 | AO-loggbilder i Storage portade till baslinjen; ACK-styrd sparning/radering; föräldralösa filer städas bara när inget annat väntar | BYGGD — 22 kontroller; kräver bucket + 3 EF (separat GO) | 0eae23e |
| 145 | Säker rendering av inbäddade bilder (stored XSS via `src=`) i AO-logg, checklista, rondering; avvikelsebilder komprimeras 900px/JPEG 0.75 | BYGGD | 0eae23e |
| 146 | Serviceintervall: idempotensnycklar portade + skydd mot dubbel Att göra vid övergången; översiktssidan portad och registrerad i `PAGE_PERMISSIONS`; döda modalknappar lagade | BYGGD — 36 kontroller (datumgränser, skottår, pausning) | 30bd21c |
| 147 | Kundsidans offerttotal räknas med CRM:ets `OfferCalc` (22 av 120 slumpade offerter skilde före, bl.a. negativt "att betala") | BYGGD — 120/120 i riktig webbläsare | 423f9f0 |
| 148 | Faktureringskö: visat belopp för tid = fakturerat belopp | BYGGD — 23 kontroller | 14d62df |
| 149 | Automatisk testsvit i repot (`tests/`, `bash tests/run-all.sh`) + lokal WAL-mätning (`tests/perf/`) | KLAR | flera |
| 150 | Aktivitetslogg som egen tabell (en rad per händelse) i stället för en 500-posters JSONB-rad: uppmätt 40,3 → 0,4 kB WAL per åtgärd | PLANERAD — kräver migration + store-key-write-ändring (G4) | — |
| 151 | `append_log`/`remove_log` i ao-time-write så samtidiga loggposter från två enheter inte skriver över varandra (G5) | BLOCKERAD — backendkälla saknas i repot (G4) | — |
| 152 | Historisk bildmigrering ur `vift_workOrders` (G7): varje AO-ändring är ~46× dyrare i WAL så länge inbäddade bilder finns kvar | PLANERAD — egen plan + backup + GO | — |
| 153 | Prisintegrationer Solar och Ahlsell (kundunika nettopriser, artikelnummer, prisdatum, uppdateringar). Alltid åtskilt: leverantörens inköpspris, vårt kundpris, påslag, moms, historiskt överenskomna villkor; kundspecifika påslag aldrig globalt. Första kostnadsfria steg att utreda: artikelprisimport via CSV/XLSX med befintlig importmotor | PLANERAD — inga API-anrop utan avtal/credentials | — |

Statusändringar för äldre punkter (identifierare behålls):
- **130** (diff-aware `persist()`): ÖVERSPELAD av STAGING-klientens per-nyckel-diff med per-element trevägsmerge (starkare). Branchens version är ersatt.
- **131/134/137/138** (bilder i Storage, säker radering, server-verifierad åtkomst): kvar; klientdelen portad till baslinjen (punkt 144).
- **135** (tidpostfilter i klienten): ersatt av STAGING:s `TimeEntriesReadService` v2 + RESTRICTIVE-policy.
- **136** (idempotenskonflikt serviceintervall): fanns kvar i STAGING-klienten; portad (punkt 146).
- **133** (Integrationer): Bokio och Momentum kvarstår som framtida integrationsområden; AI-arbetsorderinkorg (132) kvarstår. Ingen specifikation hittad — inget arbetsflöde uppfunnet.

## Leverans I — Fullständigt webbläsartest av hela systemet (2026-11-23)

Rapport: `docs/E2E-RAPPORT-2026-11-23.md`. Svit: `node tests/e2e/run.js` (Chromium mot simulerad backend; se `tests/e2e/README.md`). "BYGGD" = kodklart och testat i webbläsare mot simulerad backend, **inte** installerat eller verifierat i STAGING. Varje rättning har ett regressionstest som underkänns mot föregående kod.

| # | Funktion / rättning | Status | Test | Commit |
|---|---|---|---|---|
| 154 | E2E-svit: 32 moduler, 8 kritiska arbetsflöden, 5 skärmstorlekar, felinjektion, två enheter/användare, rapport + skärmbilder | KLAR | alla | 0a664b3 m.fl. |
| 155 | Verktygsrader klipptes av på mobil; osanerade sökvärden | BYGGD | RESP-*, PAGES-01 | 0a664b3 |
| 156 | Portkod läckte via fastighetslistans formulär och återkommande ärenden | BYGGD | PROP-01/02 | 07810e9 |
| 157 | Dubbel AO-skrivning vid geokodning | BYGGD | AO-09 | 07810e9 |
| 158 | Osynkad tid tappades / skickades i fel namn vid användarbyte (utkorg per användare) | BYGGD | TIME-05 | 76d36df |
| 159 | Rabattfältet i offertguiden visades aldrig för nya offerter | BYGGD | OFF-03 | 2d6cd32 |
| 160 | Serviceintervall: "utförd/tillagd" före serverns svar; dubbelklick; Att göra stängdes före sparning | BYGGD | SVC-01..03 | 2fd247c |
| 161 | Offertlänk "återkallad" medan länken fungerade; roller/personal "Sparat" vid serverfel; globalt skyddsnät för äldre sparvägar; toast-timer | BYGGD | OFF-04, ROLE-02, STAFF-02, ADMIN-01 | 6bf1343 |
| 162 | Rondering: pass skapades för rondering som servern saknade | BYGGD | RON-01..03 | 2c8fe3b |
| 163 | Återkommande: två AO för samma tillfälle vid dubbelklick | BYGGD | REC-01 | 9f00c34 |
| 164 | Exportcentret obrukbart (operatorprioritet); importen sa "slutförd" vid serverfel | BYGGD | EXP-01, IMP-02 | b59afa5 |
| 165 | Rapporter: "Fakturerat" alltid tomt (fält som inte finns); tid kopplades inte till AO | BYGGD | REP-01 | 866d912 |
| 166 | Kön skickades inte vid återanslutning; verifieringsläsning utan tidsgräns; osparade ändringar kastades vid användarbyte | BYGGD | RES-01..04 | 4113390 |
| 167 | Snabbare id-uppslag (AO-lista 2,0 → 0,87 s med 3 000 AO) | BYGGD | PERF-01 | 6d849ac |
| 168 | Faktura-ROT räknades på arbete exkl. moms (offerten inkl. moms) | BYGGD | ECO-01 | 80671b7 |
| 169 | Cachebuster saknades på två stilmallar; statisk kontroll mot STAGING-baslinjen; Service Worker-test | BYGGD | SW-01, static_checks | 3c663f8 |
| 170 | Fördröjd autofokus flyttade lösenordet till e-postfältet (sporadiskt "inloggning fastnade") | BYGGD | AUTH-06 | 80847a8 |
| 171 | Läsande STAGING-kontroll (`tests/e2e/staging-readonly.js`) — 11/11 OK | KLAR | — | 80847a8 |
| 172 | ROT/RUT från offert följer inte med till fakturan (G10); ekonomirollens AO-statusändring (G9); DataSync pausar vid fokus i sökfält (G11); ~35 äldre sparvägar med tidig "Sparat" (G12) | PLANERAD — kräver beslut | — | — |
| 173 | Upprepa E2E-kontrollerna mot STAGING med isolerade testkonton (lista i rapporten §6) | VÄNTAR PÅ GO | — | — |

Rättelse: uppgiften om ett dubblett-id i STAGING:s `vift_activityLog` (tidigare §2c) var felaktig — verifierat 0 dubbletter. Punkten utgår.

## Leverans J — Stabilisering, UI/UX och releasekandidat (2026-11-23)

Slutrapport: `docs/RELEASEKANDIDAT-2026-11-23.md`. Visuell granskning: `docs/UI-GRANSKNING-2026-11-23.md`. Designstandard: `docs/DESIGNSTANDARD.md`.

**Statuskategorier (gäller denna och kommande leveranser):** **BYGGD** = kod i branchen · **LOKALT TESTAD** = automatiskt test i Chromium mot simulerad backend och/eller enhetstest, underkänns mot föregående kod · **STAGING-VERIFIERAD** = prövad mot riktig STAGING-backend · **LIVE** = driftsatt på crm.viftfast.se. Ingen punkt nedan är STAGING-verifierad eller LIVE.

| # | Funktion / rättning | Status | Test | Commit |
|---|---|---|---|---|
| 174 | G5: atomisk loggpost — klienten använder `append_log`/`remove_log` när servern stöder det (sondering via `400 unknown_action`), annars som förut | BYGGD, LOKALT TESTAD. Serverdelen är **förslag** (`supabase/migrations/20261123000001_PROPOSAL_work_order_log_ops.sql` + beskrivning för `ao-time-write` i `docs/G5-APPEND-LOG.md`); kräver G4 + GO | AO-07B | a707b22 |
| 175 | G12: bekräftad sparning i hela CRM (`confirmPersist`/`commitElementChange`): "Sparar…" → besked först efter serverns ACK, återställning vid avslag, varning för okonverterade vägar | BYGGD, LOKALT TESTAD | G12-01 m.fl. | 6b63267 |
| 176 | Döda dialogknappar: avtal och e-postmallar gick inte att skapa (`Modal.open` ignorerade `ok`) | BYGGD, LOKALT TESTAD | MODAL-01 | 6b63267 |
| 177 | Bilagornas metadata (namn, beskrivning, synlighet) sparades aldrig; `Modal.confirm` gjorde radering död | BYGGD, LOKALT TESTAD. Kräver deploy av `offer-attachment-upload` (PATCH) — separat GO | ATT-01/02 | 6b63267, f5d3f78 |
| 178 | G10: ROT/RUT från offert försvinner inte tyst — fakturan visar offertens avdrag, förifyller det, och "Skickad" spärras tills avdraget lagts till eller uttryckligen kontrollerats | BYGGD, LOKALT TESTAD. Inga antaganden om avdragsrätt | G10-01 | f5d3f78 |
| 179 | G8: inget negativt "att betala" — `OfferCalc.validate` spärrar sparande/utskick; kundsidan visar varning i stället för totaler och ingen Godkänn | BYGGD, LOKALT TESTAD (120 offerter i paritetstest) | G8-01, paritet | f5d3f78 |
| 180 | G13/G9/G6: STAGING-verifiering förberedd. ~~`tests/e2e/staging-authz.js` ("minimala, icke-förändrande anrop")~~ — **rättat 2026-11-23:** anropen kunde ändra `updated_at`/`vift_lastChanged` och en befintlig AO:s `updatedAt`; ersatt av punkt 188 | FÖRBEREDD — EJ KÖRD (kräver GO + testkonton) | — | f5d3f78 |
| 181 | Karta: flera AO på samma adress = en markör med antal och lista; olika adresser grupperas aldrig; nära platser sprids; räknare för jobb/platser/ej placerade | BYGGD, LOKALT TESTAD | MAP-01, map_grouping (9) | 88b5f36 |
| 182 | Kalender: överlappande händelser sida vid sida | BYGGD, LOKALT TESTAD | CAL-02 | 88b5f36 |
| 183 | Designstandard (tokens för typografi/avstånd/kontrollhöjd, knapphierarki, `.bdg`, `kv`, filterhöjd, 12 px formulärrytm, fokusring, ordvalet "Stämpla in/ut") + rättningar i 10 vyer | BYGGD, visuellt granskad (se granskningsnivå per vy) | RESP-*, visuell jämförelse | 88b5f36 |
| 184 | UI som återstår: "klocka"/"inklockad" kvar i ~10 toast-/felmeddelanden och Dagens drift, instabil ordning i AO-listan vid lika sorteringsnyckel, dashboard-rubrik/widgethöjder, AO-radhöjd, fastighetskortets kapade flik och dubblerade "Snabböversikt", offertguidens fälthöjder, admin/avvikelser etikett-värde, fastighetslistans tomläge utan förklaring, "Välj alla" i tom lista, ~1 300 inline-`font-size`, tomläge serviceintervall | PLANERAD | — | — |
| 185 | Slutkontrollens visuella regressioner (mobil): `kv` staplade rader (säljkort ~20 % högre); kapad rubrik i fastighetskortets åtgärdsrad; "Redo fakturering" fyllt chip | BYGGD, LOKALT TESTAD, visuellt granskad före/efter | UI-KV-01, UI-PROP-01, UI-BDG-01 | (denna commit) |
| 186 | Checklista på arbetsorder med tre statuslägen: Ej påbörjad / Pågående / Utförd (+ befintlig Avvikelse). "Påbörja" per punkt, flera pågående samtidigt, vem/när för påbörjad, utförd och avvikelse, historik per punkt (20 senaste), progressindikator som skiljer utförda/pågående/avvikelser (AO-detalj, AO-lista, Mina jobb). **Beslut Lucas 2026-11-23:** checklistan startar/stoppar aldrig AO:n (R1-autostarten tas bort); egen åtgärd återställs med ao_checklist, annans eller äldre punkt utan "vem" kräver ao_edit — kontrollerat i RPC:n. Bygger på befintlig `work-order-checklist-resolve` + RPC (atomiskt per punkt-id, radlås); lägg till/ta bort går samma väg. Klienten sonderar serverstödet; mot dagens server visas checklistan som förut (ingen Påbörja) | BYGGD, LOKALT TESTAD (SQL mot riktig PostgreSQL 32/32; E2E CHK-02..07). Migration `20261123000002_work_order_checklist_progress.sql` + EF **EJ installerade** — kräver GO | CHK-02..07, `checklist_progress_sql` | (denna commit) |
| 187 | Synk mellan enheter: en annan enhets AO-ändring syntes inte förrän nästa omritning (AO-hämtningen i DataSync blev klar efter sidans omritning) — ritas nu om när hämtningen tillämpats | BYGGD, LOKALT TESTAD | SYNC-AO-01 | (denna commit) |
| 188 | STAGING-testverktyg i tre nivåer: 0 `staging-readonly.js` (oinloggad, inga skrivningar), 1 `tests/staging/authz-read.js` (inloggad läsning; auth-poster skrivs, inga affärsdata; självkontroll), 2 `tests/staging/authz-mutation.js` (mutationstest med egna märkta testposter `E2E-AUTHZ-…`, journal före varje mutation, ögonblicksbild före/efter, alltid städning, `--torrkorning`, `--stada=<runId>`, utgångskoder 0/1/2/3/4). Miljöspärrar före första anropet: `--jag-har-go`, `--bekrafta-projekt=<ref>`, LIVE nekas, testkontomönster, nivå 2 även `--mutationstest` + `VIFT_MILJO=staging`. Ingen no-op-patch på befintlig AO | BYGGD, LOKALT TESTAD (40/40 mot simulerad server via lokal HTTP); **EJ KÖRD i STAGING** — kräver GO. **Korrigerat 2026-11-23 (sist):** checklist-sonderingen flyttad från nivå 1 till nivå 2; nivå 1–2 låsta till det godkända STAGING-projektet (hash); återställning utgår från journalen med efterkontroll (aldrig "återställt" utan efterkontroll, `--stada` återupptar); kvarvarande metadata redovisas separat från affärsposter; G13 redovisas som DELVIS prövad | `staging_tools` | (denna commit) |
| 189 | STAGING-publiceringsväg verifierad: `staging-crm.viftfast.se` ligger på **Loopia** (inte GitHub Pages) och motsvarar STAGING-repots `chatgpt/staging-all-blockers-2026-11-17` (`26ce058`). Paket byggs med `tools/build-staging-package.sh` (grund = publicerad version, STAGING-överlägg via trevägssammanslagning, spärr mot LIVE-referenser) och efterkontrolleras med `tools/verify-staging-deploy.sh` (SHA-256 mot det Loopia levererar). E2E-sviten kan köras mot paketet (`VIFT_E2E_ROOT`/`VIFT_E2E_SUPA`; anrop till annan Supabase-adress underkänner) | BYGGD; paket LOKALT TESTAT (109 tester, 107 godkända, 0 misslyckade); **EJ PUBLICERAT** — uppladdning kräver GO + FileZilla (Lucas) | E2E mot paket | d61e14d |
| 190 | Rättat: fältarbetare fick varning "servern bekräftade inte … (aktivitetslogg)" efter varje åtgärd mot STAGING:s regel (`vift_activityLog` kräver admin_manage i store-key-write v3) — aktivitetsloggen undantas från varningen | BYGGD, LOKALT TESTAD (STG-01 mot STAGING:s nyckelregler) | STG-01 | d61e14d |
| 191 | Rättat: AO-loggposter fick id `prefix+Date.now()` — två enheter under samma millisekund fick samma id och servern behöll bara den ena trots "sparad" (även stämpelnoteringar). Ny `newEntryId()` | BYGGD, LOKALT TESTAD | AO-07C | d61e14d |
| 192 | Fynd (serverregel, ej klientfel): STAGING:s store-key-write v3 kräver `admin_manage` för `vift_activities` — fältarbetare, ekonomi och arbetsledare kan inte skapa eller klarmarka uppgifter (Att göra) i STAGING (E2E TASK-01 underkänns mot STAGING:s regler). Kräver beslut: per-post-regel (egna uppgifter) på servern | PLANERAD — kräver beslut och serverändring | TASK-01 (strikt läge) | — |
| 193 | Saknas i STAGING: `offer-public-pdf` (kundsidans PDF; ny i klienten — tydligt fel utan deploy, installationsplan §2h) och `project-document-upload`/`-url` (projektdokument; saknas även för nuvarande STAGING-klient) | PLANERAD — deploy kräver GO | — | — |

Statusändringar för äldre punkter (identifierare behålls):
- **151** (G5): från BLOCKERAD till **klient BYGGD** (punkt 174); serverdelen är fortfarande blockerad av G4.
- **AO-CHECKLIST-AUTOSTART R1/R1.1/R1.2** (checklistpunkt OK/avvikelse startar ostartad AO): **ÄNDRAT genom beslut 2026-11-23** — autostarten tas bort i migration 20261123000002 (punkt 186). Gäller i STAGING/LIVE först när migrationen installerats; till dess beter sig servern som förut. Den atomiska vägen (R1.2/R1.3) behålls och byggs vidare på.
- **172**: G10 → punkt 178, G12 → punkt 175, G9 → förberedd (punkt 180). **G11** (DataSync pausar vid fokus i sökfält) kvarstår PLANERAD.
- **173**: oförändrad, VÄNTAR PÅ GO; testlistan är utökad med nivå 1–2-verktygen (punkt 188; `staging-authz.js` är ersatt).

Tidigare beslutade framtida områden finns kvar oförändrade och byggs inte nu: teknisk underhållsplanering (`ROADMAP-UNDERHALL-2026-10-23`), integrationer (133: Bokio, Momentum), artikelpriser/prisintegrationer (153: Solar, Ahlsell), AI-arbetsorderinkorg (132).

## Kända begränsningar och planerade stabiliseringar

### AO-snapshot-fält (punkt 12 — KLAR)
Wizard sparar nu: `customerName`, `objectNumber`, `contactId`, `contactEmail`, `entrance`, `stairwell`, `floor`, `apartmentNumber` + befintliga fält.
AO-sökning (punkt 13) inkluderar nu alla dessa fält i haystack.

### Objektskortet (punkt 62–64) — BYGGD – BEHÖVER TEST (commit aa70444)
PropertyObjectPage v3 visar nu serviceintervall, avvikelser, bilder och dokument. Bilder laddas asynkront via PropertyImageService med tech_section='obj:'+objectId. Kräver stagingtest.

### Prefill från objekt vid AO-skapande (punkt 67 — KLAR)
_wizObjectChanged() fyller nu i: adress, portkod, entrance, stairwell, floor, apartmentNumber, kontaktperson, telefon, e-post via PropertyContactService eller obj.contacts[].

### Kontakter/hyresgäster (punkt 71) — BYGGD – BEHÖVER TEST (commit aa70444)
Full CRUD implementerat i PropertyObjectPage v3. Sparas i obj.contacts[] med fält: id, name, phone, email, role, isPrimary, validFrom, validTo, notes, active.

### Rollbaserat döljande av portkod (punkt 72) — BYGGD – BEHÖVER TEST (commit e8edf00)
objects_sensitive fullständigt implementerat:
- PropertyObjectPage.js v3: känsliga fält skyddade i objektvyn
- PropertyDetailPage.js: accessCode/keyInfo omsluts av guard
- WorkOrdersPage.js: AO-wizard förfyller ej accessCode utan behörighet
- WorkOrderDetailPage.js: portkod i AO-detalj kräver rätt roll
- ExportCenterPage.js: sensitive-toggle visas för admin/objects_sensitive/customer_manage
- PageShells.js: objects_sensitive tillagd i AdminPage rollredigering (gruppen "Säkerhet & Åtkomst")

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

## Blockerare kvarstående inför v1.0 staging

| Blockerare | Status | Åtgärd |
|------------|--------|---------|
| A1. objects_sensitive ej tilldelad i roller | ✅ ÅTGÄRDAD (e8edf00) | AdminPage rollredigering: gruppen "Säkerhet & Åtkomst" tillagd |
| A2. Supabase store RLS — SQL-policy dokumenterad | ✅ ÅTGÄRDAD (b56a705) | supabase/migrations/20260720000001_rls_store_table.sql — kräver körning i SQL Editor |
| A3. Storage offer-attachments — privat bucket + policies | ✅ ÅTGÄRDAD (b56a705) | supabase/migrations/20260720000002_storage_offer_attachments.sql — kräver körning |
| A4. EF-säkerhet: anon-key-autentisering i 3 EF:er | ✅ ÅTGÄRDAD (dd7c5df) | offer-attachment-upload/url/pdf: JWT-auth; send-push: rollkontroll+rate-limit; send-offer-email: korrekt store-åtkomst |
| B1. offerEvents/offerAttachments DataSync | BYGGD – BEHÖVER TEST | 53862af: lagt till i DataSync._poll(). Verifiera 2-fönster-sync |
| B2. Övriga 5 entiteter vs DataSync | BYGGD – BEHÖVER TEST | contracts/inspections/recurringOrders/propertyContacts/propertyRoles — verifiera merge/delete/reload |
| C1. Edge Functions deploy | EJ DEPLOYAD — KRÄVER SUPABASE-ÅTKOMST | Kräver `supabase functions deploy` + secrets. Se RC1_STAGING_CHECKLISTA.md |
| C2. send-offer-email secrets | EJ KONFIGURERAT — KRÄVER SUPABASE-ÅTKOMST | RESEND_API_KEY, FROM_EMAIL, FROM_NAME, PUBLIC_BASE_URL i Supabase Secrets |

## Edge Functions deploy-checklista (8 funktioner)

| Funktion | Säkerhetsstatus | Deploy-status | Secrets |
|----------|-----------------|---------------|---------|
| service-monitor | ✅ Säker | EJ DEPLOYAD | VAPID_*, MONITOR_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY |
| offer-token-validate | ✅ Säker | EJ DEPLOYAD | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY |
| offer-respond | ✅ Säker | EJ DEPLOYAD | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_* |
| offer-attachment-upload | ✅ Fixad (dd7c5df) | EJ DEPLOYAD | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY |
| offer-attachment-url | ✅ Fixad (dd7c5df) | EJ DEPLOYAD | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY |
| offer-pdf | ✅ Fixad (dd7c5df) | EJ DEPLOYAD | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY |
| send-push | ✅ Fixad (dd7c5df) | EJ DEPLOYAD | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL |
| **send-offer-email** | ✅ Fixad (dd7c5df) | EJ DEPLOYAD | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, **RESEND_API_KEY**, FROM_EMAIL, FROM_NAME, PUBLIC_BASE_URL |

**VAPID private key och RESEND_API_KEY läggs ALDRIG i config.js eller frontend — enbart i Supabase Secrets.**

## RC1-dokumentation

- `docs/RC1_E2E_TESTPROTOKOLL.md` — fullständigt E2E-testprotokoll A–F (74+ testfall)
- `docs/RC1_STAGING_CHECKLISTA.md` — 16-punkts staging-checklista med deploy-instruktioner
- `supabase/migrations/` — tre SQL-migreringar (RLS, Storage, pg_cron)

---

## Framtida modul — Teknisk underhållsplanering (EJ PÅBÖRJAD)

| Roadmap-ID | Status | Prioritet | Dokument |
|---|---|---|---|
| `ROADMAP-UNDERHALL-2026-10-23` | 🔴 EJ PÅBÖRJAD / PLANERAD FRAMTIDA MODUL | Efter aktuell R6/R9B-stabilisering, centrala flödestester, RLS Fas 2 och godkänd LIVE-release | `docs/MASTERPLAN-UNDERHALLSPLAN.md` |

Fullvärdig modul för långsiktig (10–50 år) teknisk underhållsplanering för fastighetsägare, förvaltare och bostadsrättsföreningar — objekthierarki fastighetsbestånd → fastighet → byggnad → byggnadsdel/komponent → underhållsåtgärd, inventering/skickbedömning, ekonomi/budget/prognos, prioritering/riskbedömning, statusflöde, årsprocess med låsta planversioner, underhållsskuld/scenarier, dashboard/rapporter (PDF/Excel) och import/export. Ska återanvända VIFT CRM:s befintliga fastighetsregister, organisationsgränser, användare/roller och arbetsorder — **inget** parallellt register, ingen separat applikation, utan ett nytt uttryckligt produktbeslut.

Fullständig kravspecifikation, kärnkrav/avgränsningar, data- och integrationsprinciper samt genomförandeordning (etapp 1–5) finns bevarade i sin helhet i `docs/MASTERPLAN-UNDERHALLSPLAN.md`. Denna punkt lägger **inte** till några nya numrerade poster i tabellerna ovan och ändrar ingen befintlig status — modulen är helt oimplementerad och påverkar inte pågående R6/R9B-STAGING-arbete.

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
