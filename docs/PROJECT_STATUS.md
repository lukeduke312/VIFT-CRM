# PROJECT_STATUS.md — VIFT CRM

Uppdaterad: 2026-07-26. Komplement till `docs/MASTERPLAN.md`.

---

## Aktuell release

| | |
|---|---|
| **Version** | 1.0.0 RC1 |
| **Produktions-commit** | `2b01cea` (per brief 2026-07-26) |
| **Staging-commit** | `54ebd01` (per brief 2026-07-26) |
| **Produktions-URL** | https://crm.viftfast.se |
| **Staging-URL** | https://staging-crm.viftfast.se |
| **Supabase prod** | `hjplzjsbbowiyoyhdghc` |
| **Supabase staging** | `yyzljlqyzzcbxmcdbual` |

---

## Modulstatus

### Fas 0 — Kärninfrastruktur

Alla 8 funktioner: **KLAR** (commit `9b39b63`)

- Router.js (hash-routing, pushState/popstate)
- Storage.js (Supabase single-table store, localStorage-cache)
- Auth.js (JWT, roller, RLS, `Auth.can()`)
- sw.js v10 (Service Worker, network-first, cache-busting)
- DataSync.js (30-sekunders polling)
- ActivityService.js (revisionslogg)
- ActivitiesService.js (att-göra-uppgifter)
- PushService.js + `send-push` Edge Function (Web Push, VAPID)

### Fas 1 — CRM-kärna

| # | Funktion | Status |
|---|---|---|
| 9–10 | Arbetsorder CRUD, wizard, checklist, material, tid, fakturering | KLAR |
| 11 | AO — objectId + objectName i wizard och detalj | KLAR |
| **12** | AO — snapshot-fält (customerName, objectNumber, contactId, contactName, accessInformation) | **EJ BYGGD** |
| **13** | AO — sökning på objektnamn/objektnummer/port/trapphus | **EJ BYGGD** |
| 14–26 | Kunder, fastigheter, offerter, fakturaunderlag, tid, återkommande, säljchanser, personal, artiklar, prisgrupper, admin, dashboard, sidebar | KLAR |

### Fas 2 — Rondering

Alla 5 funktioner (27–31): **KLAR**

### Leverans 1 — Serviceintervall

| # | Funktion | Status |
|---|---|---|
| 32–39 | Serviceintervall — 8 typer, 16 kategorier, kalenderberäkning, markera utförd, pausa, AO-länk, daglig klientkörning | KLAR |
| **40** | Schemalagd Edge Function `service-monitor` (server-side daglig körning) | **EJ BYGGD** — EF deployd i production men inte aktiverad med cron |
| **41** | Server-side dubblettskydd (atomisk idempotens) | **EJ BYGGD** |
| **42** | Web Push för serviceintervall per ansvarig | **EJ BYGGD** |
| 43 | Automatisk AO via Edge Function | FÖRBEREDD (koden finns i ServiceIntervalService.js) |

**OBS om punkt 40**: `service-monitor` EF är deployd i produktion (per brief). Cron-schemaläggning kräver att `supabase/manual/setup_service_monitor_cron.sql` körs manuellt i SQL Editor och kräver explicit godkännande av Lucas.

### Leverans B — Kundimport och -export

Alla 11 funktioner (44–54): **KLAR** (commits `9910cda`, `d3b5117`, `33872a1`, `fb9ff35`)

Notering: Diff-vy vid konfliktlösning (punkt 50) är EJ BYGGD men konfliktlösningslogiken finns.

### Leverans C — Objekt, lägenheter och lokaler

| # | Funktion | Status |
|---|---|---|
| 55–61, 65–70 | Schema, state, CRUD, sidor, router, AO-wizard-koppling, SI-koppling, rondering-koppling | KLAR |
| 59 | Raderingsskydd | DELVIS (aktiva SI + ej arkiverade AO, ej stängda AO) |
| **62** | Objektskortet — serviceintervall | **EJ BYGGD** |
| **63** | Objektskortet — avvikelser | **EJ BYGGD** |
| **64** | Objektskortet — bilder och dokument | **EJ BYGGD** |
| **67** | AO-wizard — prefill adress, kontakt, telefon från objekt | **EJ BYGGD** |
| 71 | Kontakter/hyresgäster i objekt | FÖRBEREDD (schema finns, ingen CRUD-UI) |
| **72** | Rollbaserat döljande av portkod | **EJ BYGGD** |

---

## Kritiska produktionsblockerare

### BLOCKER-1: timeEntries läcker lönedata

`state.timeEntries` laddas av DataSync för alla inloggade användare. RLS på `store`-tabellen kontrollerar inte på nyckelkolumnen — alla inloggade kan läsa alla nyckelns data inklusive tidstämplar och löneunderlag för all personal.

**Påverkan**: Alla inloggade fältarbetare kan potentiellt läsa andras tidsdata.
**Plats**: `src/data/storage.js` + Supabase RLS-policy på `store`.
**Kräver**: Per-nyckel RLS-kontroll eller separata tabeller för känslig data.

### BLOCKER-2: Store-skrivning saknar per-nyckel-kontroll

RLS-policyn på `store` tillåter varje autentiserad användare att skriva valfri nyckel. En inloggad fältarbetare kan i teorin skriva `vift_staff` eller `vift_roles`.

**Påverkan**: Behörigheteseskalering möjlig om en inloggad användare känner till store-nycklarna.
**Plats**: Supabase RLS-policy för UPDATE/INSERT på `store`.
**Kräver**: Rollbaserad write-policy (t.ex. bara `admin`-roll kan skriva `vift_staff`, `vift_roles`).

---

## Säkerhetsarbete genomfört (Commits 17–27, säkerhetssprinten)

Följande genomfördes i säkerhetssprinten (commit-serien i staging-repo / annan workspace-instans):

| Commit | Åtgärd |
|---|---|
| 17 | `passwordHash` borttaget från schema.js + migration 00008 strippar lösenord från store-blob |
| 18 | `SET search_path` pinnat i alla SECURITY DEFINER-funktioner (00006) |
| 19 | REVOKE + RLS på backup-tabeller (00004) |
| 20 | Migration 00003 → no-op; cron-SQL flyttad till `supabase/manual/setup_service_monitor_cron.sql` |
| 21 | `_shared/vift-auth.ts` — gemensam auth-helper `checkViftAuth()` + `hasPerm()`; send-push/offer-attachment-upload/offer-pdf/send-offer-email uppdaterade |
| 22 | HTTP-säkerhetsheaders till offer-token-validate och offer-respond |
| 23 | MASTERPLAN + stagingchecklista uppdaterade (v5) |
| 24 | `offer-attachment-url` fullständigt omskriven — publik token-path + intern JWT-path med full auktorisering |
| 25 | Säkerhetsrapport och produktionsblockerare dokumenterade |
| 26 | `supabase/manual/setup_service_monitor_cron.sql` — Vault-baserad cron-setup |
| 27 | Migration `20260720000000_create_core_tables.sql` — skapar `store` och `push_subscriptions` för tom staging-DB |

**OBS**: Dessa commits är **inte** synliga i git log på branch `claude/vift-system-restructure-8fUme` i detta workspace (senaste commit: `227bc12`). De gjordes i en annan session-instans/workspace. Status ovan baseras på sessionens dokumentation.

---

## Fas 4 — Planerade funktioner (ej påbörjade)

| # | Funktion | Prioritet |
|---|---|---|
| 73 | Generell import/export för fastigheter, objekt, artiklar, personal | Hög |
| 74 | Rondering — PDF-rapport | Hög |
| 75 | Kalender — schemaläggning, dra-och-släpp | Hög |
| 76 | Löneunderlag — export, perioder | Medel |
| 77 | Rapporter — statistik, diagram | Medel |
| 78 | Mina jobb — tilldelade uppdrag per inloggad personal | Hög |
| 79 | Avancerat behörighetssystem (per fastighet, per kundgrupp) | Låg |
| 80 | E-postmallar och automatiska utskick | Medel |
| 81 | Kontrakthantering | Medel |
| 82 | Mobil-optimerad offline-läge (SW fallback) | Låg |

Sidor för kalender (`pg-calendar`) och kontrakt (`pg-contracts`) finns redan i Router och PageShells som tomma stubs. Löneunderlag (`pg-payroll`) och rapporter (`pg-reports`) likaså.

---

## Kända begränsningar (per MASTERPLAN.md)

### AO-snapshot-fält (punkt 12)
Wizard sparar `propertyName` och `objectName` men saknar: `customerName`, `objectNumber`, `contactId`, `contactName`, `accessInformation`. AO-sökning inkluderar inte heller dessa fält.

### Objektskortet historik (punkt 62–64)
PropertyObjectPage visar arbetsordrar och utrustning men saknar sektioner för serviceintervall, avvikelser, bilder och dokument.

### Prefill från objekt vid AO-skapande (punkt 67)
`openCreateAO()` skickar `objectId`/`objectName` men inte adress, kontaktperson, telefon, e-post eller accessInformation från objektet.

### Kontakter/hyresgäster (punkt 71)
`contacts[]`-arrayen finns i schema, kan sparas via `PropertyObjectService.update()`, men saknar CRUD-UI direkt i objektskortet.

### Rollbaserat döljande av portkod (punkt 72)
`doorCode` och `keyInformation` visas för alla inloggade. Kräver rollkontroll (`Auth.can('objects_sensitive')`) innan det är säkert för mobila fältarbetare.

### Importdiff-vy (punkt 50)
Konfliktlösning har tre val (hoppa/uppdatera/skapa ny) per rad men saknar sida-vid-sida diff-vy.

### Kundexport — markerade kunder (punkt 51)
Export stöder "alla" och "filtrerade" men inte manuellt checkade rader.

### Generell import för övriga register (punkt 73)
`ImportExportService.js` är byggd som återanvändbar motor men ImportWizard stöder bara `entityType='customer'` idag.

---

## Användare i produktion (per brief)

| ID | Namn | Roll |
|---|---|---|
| ST-001 | Lucas Samuelsson | Admin (superadmin) |
| ST-008 | Christoffer | Chef |

---

## Hemligheter i Supabase Vault (prod + staging)

*(Inga värden dokumenteras här — enbart nyckelnamn)*

- `VAPID_PRIVATE_KEY` — Web Push
- `RESEND_API_KEY` — e-postutskick
- `SERVICE_MONITOR_SECRET` — cron-autentisering (Model B)
- `MAPBOX_TOKEN` — karta (publikt värde finns även i config.js)

`PUBLIC_BASE_URL` = `https://crm.viftfast.se`
`FROM_EMAIL` = `info@viftfast.se`
