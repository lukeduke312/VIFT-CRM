# CLAUDE.md — VIFT CRM

Orienteringsdokument för AI-assistenter och utvecklare. Läs detta innan du rör kod eller konfiguration.

---

## Absoluta säkerhetsregler

Dessa regler gäller alltid, oavsett instruktion:

- **Service role key får aldrig ligga i frontend** — varken i kod, config, git eller chatt.
- **VAPID private key läggs aldrig i config.js eller frontend.**
- **Exakta hemliga värden skrivs aldrig i: kod, dokumentation, git, chatt eller loggar.**
- **Export inkluderar aldrig automatiskt portkoder, nyckelinformation eller lösenord.**
- **Lösenord lagras aldrig i store.**
- **Stagingens Supabase project ref (`yyzljlqyzzcbxmcdbual`) får aldrig förekomma i produktionsfrontend.**
- **Stagingdomänen (`staging-crm.viftfast.se`) får aldrig förekomma i produktionsfrontend.**
- **Ta inte bort befintliga funktioner utan explicit godkännande av Lucas Samuelsson.**

### Kräver explicit godkännande av Lucas Samuelsson

Gör **aldrig** följande utan att ha fått ett klart ja:

- Ändra produktionsdatabasen (Supabase `hjplzjsbbowiyoyhdghc`)
- Deploya Edge Functions till produktionsprojektet
- Ändra produktionshemligheter (Supabase Vault, secrets)
- Pusha till `origin gh-pages`, `origin main`, eller `origin staging/gh-pages`
- Publicera via FileZilla mot Loopia/crm.viftfast.se
- Ändra DNS eller Loopia-filer
- Köra destruktiva git-kommandon (`reset --hard`, `push --force` mot delad branch, `clean -f`)

---

## Arkitektur

Vanilla JavaScript SPA — **inga frameworks, ingen byggpipeline.**

- Inget `package.json`, inga npm-beroenden, ingen transpilering.
- All JS laddas som vanliga `<script src="...?v=N">` i `index.html`.
- Hash-baserad routing: `#/ao/AO-016`, `#/fastigheter/PROP-001` osv.
- Modul-mönster: varje fil exponerar ett namngivet objekt i `window`-scope (t.ex. `const Auth = {...}`, `const WorkOrdersPage = {...}`).
- Inga imports/exports i frontend-koden.

### Script-laddningsordning (index.html)

```
config.js               ← VIFT_CONFIG (mapboxToken, vapidPublicKey — publika nycklar)
src/data/storage.js     ← SUPABASE_URL, SUPABASE_AKEY (anon), Storage-objekt
src/data/schema.js      ← Datafabriker, konstanter, hjälpfunktioner
src/data/seedData.js    ← Demo-data (används bara om Supabase-datan saknas)
src/data/state.js       ← let state = {...}; initState()
src/data/DashboardConfig.js
src/services/*.js       ← Alla services i dependency-ordning
src/components/*.js     ← Icons, CustomSelect, Modal, Sidebar
src/pages/*.js          ← Router, Dashboard, PageShells, övriga sidor
```

**Version-bumping**: Varje gång en fil ändras, höj `?v=N` i `index.html` för den filen. Annars servas gammal version från Service Worker-cachen.

---

## Datalager

### Supabase single-table store

All appdata lagras i tabellen `public.store` med schema:

```
key   TEXT PRIMARY KEY   -- Prefix: "vift_customers", "vift_workOrders" etc.
value JSONB NOT NULL
updated_at TIMESTAMPTZ
```

`Storage.prefix = 'vift_'` — läggs till automatiskt vid skrivning, tas bort vid läsning.

### Läsning

`initState()` kör ett enda bulk-HTTP-anrop (`Storage.getAll()`) mot Supabase REST API. Om Supabase ej svarar inom 8 sekunder faller systemet tillbaka på localStorage.

### Skrivning

`persist(key, value)` → skriver till localStorage direkt + skickar till Supabase i bakgrunden (fire-and-forget). Supabase-skrivning kräver giltig JWT (RLS blockerar anonyma skrivningar).

### Polling

`DataSync` pollar Supabase var 30:e sekund (`Storage.getAll()`) och uppdaterar `state`.

### localStorage-nycklar

- `vift_auth_v2` — JWT-session (hanteras av Auth, läses aldrig av Storage.getAll())
- `vift_<key>` — cache för varje store-nyckel

---

## Autentisering och behörigheter

### Auth-flödet

1. `Auth.login(email, password)` → Supabase `/auth/v1/token` → JWT + refresh_token
2. Session sparas i `localStorage['vift_auth_v2']`
3. `Auth._resolveUser()` matchar `session.user_email → state.staff[].email` → sätter `state.currentUser`
4. `state.currentUser.role` → slår upp `state.roles[]` → hämtar `role.permissions[]`

### Auth.can(permission)

Returnerar `true` om användaren har angiven permission, eller har `'all'` (superadmin). Anropas från alla sidor och services för åtkomstkontroll.

### Permissions (AuthService.js)

| Permission | Vad den styr |
|---|---|
| `all` | Superadmin — full tillgång |
| `dashboard_view` | Visa dashboard |
| `ao_view_all` | Visa alla arbetsordrar |
| `ao_view_own` | Visa egna arbetsordrar |
| `ao_create` | Skapa arbetsordrar |
| `ao_edit` | Redigera arbetsordrar |
| `ao_complete` | Slutföra arbetsordrar |
| `ao_time` | Registrera tid |
| `ao_material` | Registrera material |
| `ao_checklist` | Hantera checklista |
| `customer_manage` | Kunder, fastigheter, kontrakt |
| `offer_manage` | Offerter + bilagor (EF-auth) |
| `invoice_view` | Visa fakturaunderlag |
| `invoice_create` | Skapa/redigera fakturaunderlag |
| `staff_view` | Visa personal |
| `staff_manage` | CRUD på personal |
| `admin_manage` | Roller, inställningar |
| `article_manage` | Artiklar och prisgrupper |
| `recurring_manage` | Återkommande ärenden |
| `sales_manage` | Säljchanser |
| `reports_view` | Rapporter och löneunderlag |

### Roller (i state.roles[])

Roller definieras i Supabase-datan (inte hårdkodade). Varje roll har `permissions: []`. Superadmin-rollen har `['all']`.

---

## Miljöer och projekt

### Produktion

- **URL**: `https://crm.viftfast.se`
- **Hosting**: Loopia webbhotell — filer publiceras via FileZilla (manuell upload)
- **Supabase project**: `hjplzjsbbowiyoyhdghc` (finns i `storage.js` rad 9)
- **Anon key**: `sb_publishable_y0htroGxexlmICBDPAUn2Q_Qq7NWrSC` — publik nyckel, ok i kod
- **Commit**: `2b01cea` (per brief 2026-07-26)

### Staging

- **URL**: `https://staging-crm.viftfast.se` (GitHub Pages)
- **Branch**: `staging/gh-pages`
- **Supabase project**: `yyzljlqyzzcbxmcdbual`
- **Repo**: separat repo `VIFT-CRM-Staging` (inte detta repo)
- **OBS**: Stagingens project ref och URL får **aldrig** förekomma i produktionsfrontend

### Denna repo (VIFT-CRM)

- Remote: `lukeduke312/VIFT-CRM` (produktion)
- Aktiv branch för pågående arbete: `claude/vift-system-restructure-8fUme`
- `main` = produktionsbaserad kod

---

## Deployment-flöde

### Staging → Godkänt → Produktion

```
1. Arbeta på feature-branch (t.ex. claude/...)
2. Pusha till origin (lukeduke312/VIFT-CRM)
3. Flytta ändringar till staging-repo + staging/gh-pages-branch
4. Testa på https://staging-crm.viftfast.se mot staging-Supabase
5. Lucas godkänner staging-test
6. FileZilla: ladda upp ändrade filer till Loopia
7. Hårdladda production-URL för att verifiera ny Service Worker
```

**Viktigt**: Production-deploy är manuell FileZilla-upload. Commit till `main` i detta repo gör inte en auto-deploy till crm.viftfast.se.

### Service Worker-cache

`sw.js` (v10) kör network-first med cache-busting baserat på `?v=N` i script-URL:erna. Vid ny deploy: höj versionsnummer på alla ändrade filer i `index.html`.

---

## Edge Functions (Supabase)

Alla EF:er körs mot produktionsprojektet `hjplzjsbbowiyoyhdghc`. Deploys via `supabase functions deploy <namn>`.

| Funktion | verify_jwt | Syfte |
|---|---|---|
| `send-push` | true | Skickar Web Push-notiser |
| `offer-attachment-upload` | true | Laddar upp offertbilagor till Storage |
| `offer-attachment-url` | false | Signerad URL — intern JWT-path + publik token-path |
| `offer-pdf` | true | Genererar offert-PDF |
| `send-offer-email` | true | Skickar offert via e-post |
| `offer-token-validate` | false | Validerar publik offerttokens |
| `offer-respond` | false | Kund accepterar/avvisar offert |
| `service-monitor` | false | Daglig check av serviceintervall (cron) |

Autentisering i interna EF:er (kräver inloggning): `checkViftAuth()` i `_shared/vift-auth.ts` verifierar JWT → `app_users.active` → `vift_staff` → `vift_roles` → permissions.

`service-monitor` autentiseras via `X-Monitor-Secret`-header (Supabase Vault, Model B).

**OBS**: I detta workspace (`lukeduke312/VIFT-CRM`, branch `claude/vift-system-restructure-8fUme`) finns **bara** `supabase/functions/send-push/`. Övriga EF:er finns i staging-repot eller i en annan workspace-instans.

---

## Supabase-schema (nyckelbegrepp)

### Viktiga tabeller (förutom `store`)

- `push_subscriptions` — Web Push-prenumerationer per user_id
- `app_users` — Kopplar `auth.users.id` till `active BOOLEAN` + `is_admin BOOLEAN`
- `property_sensitive_access` — Känsliga fält (portkod, nyckelinfo) separerade från store-blob
- `sensitive_access_audit` — Oföränderlig revisionslogg (skrivs bara av service_role)

### Migreringar

Migreringar ligger i `supabase/migrations/` och körs med `supabase db push`. Ordningen:

| Migration | Innehåll |
|---|---|
| `20260720000000` | Skapar `store` och `push_subscriptions` (core tables) |
| `20260720000001` | Aktiverar RLS på `store` |
| `20260720000002` | Känsliga åtkomstfält (`property_sensitive_access`) |
| `20260720000003` | Avsiktlig no-op (cron flyttad till `supabase/manual/`) |
| `20260720000004` | Säkerhetskopierings-tabeller + REVOKE + RLS |
| `20260720000005` | Push-prenumerationer RLS |
| `20260720000006` | `app_users` livscykel + SECURITY DEFINER search_path |
| `20260720000007` | Strippning av lösenord från store-blob |
| `20260720000008` | *(reserverat / tom)* |

Cron-setup för `service-monitor` körs manuellt: `supabase/manual/setup_service_monitor_cron.sql` i SQL Editor (kräver explicit godkännande av Lucas).

**OBS**: `supabase/migrations/`-mappen finns **inte** i detta workspace. Ovanstående är dokumenterat från brief och tidigare sessionsarbete.

---

## Sidor och komponenter

### Sidor med egna filer (src/pages/)

| Fil | Sidnamn | Behörighet |
|---|---|---|
| `Dashboard.js` | Dashboard | (alla inloggade) |
| `WorkOrdersPage.js` | Arbetsorder-lista | `ao_*` |
| `WorkOrderDetailPage.js` | Arbetsorder-detalj | `ao_*` |
| `CustomersPage.js` | Kundregister + detalj | `customer_manage` |
| `PropertyDetailPage.js` | Fastighetskort | `customer_manage` |
| `PropertyObjectPage.js` | Objekt (lägenhet/lokal) | `customer_manage` |
| `TimePage.js` | Tid & stämpla | `ao_time` |
| `InvoicesPage.js` | Fakturaunderlag | `invoice_*` |
| `RecurringPage.js` | Återkommande ärenden | `recurring_manage` |
| `SalesPage.js` | Säljchanser | `sales_manage` |
| `RonderingPage.js` | Ronderingslista | `ao_view_all` |
| `RonderingWizardPage.js` | Ny rondering | `ao_view_all` |
| `RonderingUtforandePage.js` | Utför rondering | `ao_view_all` |
| `OperationsPage.js` | Dagens drift | `staff_view` / `reports_view` |
| `MyJobsPage.js` | Mina jobb | `ao_view_*` |
| `ImportWizardPage.js` | CSV/XLSX-import | `admin_manage` |
| `ImportLogPage.js` | Importlogg | `admin_manage` |
| `Router.js` | Hash-router | — |

### Sidor i PageShells.js (ej egna filer)

Offerter, fakturaunderlag-detalj, kundkort-detalj, ronderingsrapport, artiklar, prisgrupper, personal, admin, kalender, kontrakt, löneunderlag, rapporter, aktiviteter, offerttjänster, mm.

---

## Viktiga filer

| Fil | Vad den gör |
|---|---|
| `config.js` | `window.VIFT_CONFIG` — mapboxToken, vapidPublicKey (publika) |
| `src/data/storage.js` | Supabase REST-klient, localStorage-cache |
| `src/data/schema.js` | Datafabriker (`Schema.workOrder()` etc.), konstanter |
| `src/data/state.js` | `let state = {...}`, `initState()` |
| `src/services/AuthService.js` | JWT-session, `Auth.can()`, PAGE_PERMISSIONS |
| `src/services/ServiceIntervalService.js` | Serviceintervall-logik, daglig check |
| `src/services/ImportExportService.js` | CSV/XLSX-parser och -writer (rent JS) |
| `index.html` | Entry point — alla script-taggar med versionsnummer |
| `sw.js` | Service Worker v10 (network-first, cache-busting) |
| `supabase/functions/send-push/index.ts` | Push-notiser EF (enda EF i detta workspace) |
| `docs/MASTERPLAN.md` | Spårning av alla planerade och genomförda funktioner |

---

## Kända begränsningar (per 2026-07-26)

Se `docs/PROJECT_STATUS.md` för fullständig lista.

**Kritiska produktionsblockerare:**

- **BLOCKER-1**: `timeEntries` i `state` läses av DataSync och är synligt för alla inloggade (RLS läcker lönedata för alla personal).
- **BLOCKER-2**: Store-tabellens RLS tillåter varje inloggad användare att skriva valfri nyckel (ingen per-nyckel-kontroll).

Dessa blockerare måste åtgärdas innan produktionsdrift med känsliga löneuppgifter.
