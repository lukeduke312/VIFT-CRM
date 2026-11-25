# VIFT CRM — Masterplan

Spårar all planerad och genomförd utveckling. Status uppdateras per commit.

## Styrning (gäller från 2026-11-26)

- **Denna fil är den enda auktoritativa masterplanen och statuslistan.**
  - `docs/MASTERPLAN-STATUS-2026-11-26.md` är underlag: statusgranskningen 2026-11-26 med beläggsdiskussion. Den konkurrerar inte med denna fil. Vid avvikelse gäller denna fil.
  - `docs/PROJECT_STATUS.md` är fortsatt källan till R9B- och BLOCKER-historiken (se R9B-pekaren i Leverans G).
- **Ny återkoppling registreras i backloggen** (avsnitten "Beslut 2026-11-26", "Backlog – senare UX-etapp" och "Säkerhetsomgången") och hanteras i rätt fas. Den utlöser inte automatiskt nya utvecklingsuppdrag.
- **Nästa tekniska huvuduppgift är G1/G4: serverkällkod i repot (punkt 242).** Därefter kommer **säkerhetsomgången** (eget avsnitt).
  - **Uppdatering 2026-11-27:** G1/G4 är byggt och lokalt verifierat (punkt 242), och de fyra PostgreSQL-testerna är gröna lokalt (punkt 244). Säkerhetsomgången genomförs nu som paketen T3-0–T4-F i den **fastställda arbetsordningen** (avsnittet "Fastställd arbetsordning T3/T4"). Nästa paket är **T3-0**.
- *(2026-11-27: ordningen inom säkerhetsomgången är nu fastställd, se "Fastställd arbetsordning T3/T4". Ordningen nedan efter säkerhetsomgången är fortfarande ett förslag.)*
- Ordningen efter säkerhetsomgången är **föreslagen, inte beslutad**. Underlag finns i `docs/MASTERPLAN-STATUS-2026-11-26.md` §6. Förslaget:
  1. AO-etappen (nummergenerator 245, arbetspoolens affärsregel AP);
  2. funktionell STAGING-verifiering av de moduler som bara är simulerat testade;
  3. LIVE-plan (241);
  4. kartan (249);
  5. UX-etappen;
  6. framtida moduler.
- **LIVE är NO-GO** tills en separat LIVE-plan (punkt 241) är godkänd av Lucas Samuelsson.
- **Fastställda beslut 2026-11-27:** D-01–D-26 och AP-A–AP-G har sin auktoritativa ordalydelse i `docs/qa-2026-11-27/BESLUT-2026-11-27.md`. Masterplanen sammanfattar och hänvisar; vid avvikelse gäller beslutsdokumentet. Behörighetsmatrisen (`docs/qa-2026-11-26/BEHORIGHETSMATRIS.md`) och testplanen (`docs/qa-2026-11-26/SAKERHETSPROVNING-TESTPLAN.md`) är fastställda.
- **Auktoritativ källa** (`vift-v2/supabase/AUKTORITATIV-KALLA.md`):
  - **server** = arbetskopian `vift-v2`, gren `claude/vift-system-restructure-8fUme`, katalogen `supabase/` (`migrations/` med `MIGRATIONSORDNING.txt`, `functions/`, `config.toml`, `staging-only/`, `manual/`);
  - **klient** = VIFT-CRM, gren `claude/vift-v3-major-redesign`.
  - VIFT-CRM:s tidigare `supabase/`-spegel är **borttagen** (KÄLLA-1, alternativ A, lokalt genomfört i T3-0 2026-11-28): `supabase/README.md` hänvisar till vift-v2, klienttesterna läser `VIFT_SERVER_ROOT` och `tests/serverkalla_guard.test.js` underkänner återinförd serverkod. *(Tidigare: inaktuell spegel, 21 migrationer; "saknar 28 filer" var fel räknat, se `G1-G4-DEL2-RESULTAT.md` §11.)*

## Statusförklaring (från 2026-11-26)

Varje punkt anges med den **högsta uppnådda nivån**:

| Nivå | Betyder |
|---|---|
| **Byggd** | Koden eller leveransen finns. Inget automatiskt test av kärnfunktionen har hittats, eller funktionen är installerad men inte prövad. |
| **Simulerat testad** | Ett automatiskt test är grönt: Chromium mot simulerad server, enhetstest eller SQL mot lokal PostgreSQL. Inte prövat mot riktig STAGING. |
| **Lokalt verifierad** | (Från 2026-11-27.) Samma nivå som Simulerat testad, men prövat mot lokal PostgreSQL med STAGING:s faktiska schema och källa (inventering eller migrationskedja). "Byggd + lokalt verifierad" används för en leverans där även källan jämförts mot STAGING. Inte prövat mot riktig STAGING. |
| **Verifierad i STAGING** | Kärnfunktionen är prövad mot riktig STAGING (`yyzljlqyzzcbxmcdbual`, `staging-crm.viftfast.se`) med belägg. |
| **Verifierad i LIVE** | Prövad i produktion (`crm.viftfast.se`). **Ingen punkt har denna nivå i dag.** |

För det som inte är fullt byggt används kompletterande lägen:
- **Delvis byggd**: cellen anger vad som saknas.
- **Ej påbörjad.**
- **Uppskjuten.**
- **Beslutad, ej byggd.**
- **Registrerad, ej påbörjad.**
- **Beslut krävs**: en öppen affärsfråga, inget beslut fattat.

"(genom ersättning)" betyder att punktens syfte uppfylls av en annan, verifierad punkt.

**Statuscellens format:** **nivå** · belägg · *tidigare: gammal status*. Den gamla statusen behålls som historik.

**Belägg:**
- [S] = riktig STAGING;
- [T] = automatiskt test;
- [D] = dokument eller kodgranskning.

Källorna är QA-rapporterna 2026-11-24–26 (`docs/qa-2026-11-24/`, `docs/qa-2026-11-25/`, `docs/qa-2026-11-26/`) och `INSTALLATIONSPLAN-STAGING-2026-11-22.md` §6.6–§6.10 (i `vift-v2`). Statusgranskningen 2026-11-26 körde inga nya tester. Uppdateringen 2026-11-27 bygger på `BESLUT-2026-11-27.md`, `BEHORIGHETSMATRIS.md`, `SAKERHETSPROVNING-TESTPLAN.md`, `ARBETSPOOL-UTREDNING.md` version 2, `vift-v2/supabase/inventering/G1-G4-DEL2-RESULTAT.md` och `vift-v2/supabase/AUKTORITATIV-KALLA.md` (omgången T0–T2: bara repo och lokal testning, inget i STAGING eller LIVE).

**LIVE** har **inget** av arbetet efter 2026-11-22. Det gäller både klient (v2, V3–V3.4) och serverändringar: C-5, `ao-time-write` v5, lastChanged-triggern, GO-5–GO-8, `time-entries-list` med flera. Fas 0–2 finns i LIVE:s äldre klient (`2b01cea` enligt brief), men vilken version av varje punkt LIVE har är inte inventerat.

**Statusräkning (uppdaterad 2026-11-27)** (numrerade punkter 1–271 och E2b-1–E2b-6):

| Nivå/läge | Antal |
|---|---|
| Verifierad i LIVE | 0 |
| Verifierad i STAGING | 109 |
| Lokalt verifierad | 2 |
| Simulerat testad | 69 |
| Byggd | 51 |
| Delvis byggd | 10 |
| Ej påbörjad | 34 |
| Uppskjuten | 2 |
| **Summa** | **277** |

"Lokalt verifierad" omfattar 242 (Byggd + lokalt verifierad) och 244. Jämfört med 2026-11-26 har 242 flyttats från Delvis byggd och 244 från Byggd.

**Id utanför nummerserien (2026-11-27):** 49 beslut med status Beslutad, ej byggd (D-01–D-26, AP-A–AP-G, B1–B5, Ö1–Ö10, B-FAKT-1); 17 säkerhetsfynd SÄK-1–SÄK-17 (Registrerad, ej påbörjad; 11 av dem P1, varav SÄK-8 och SÄK-9 P1 inför LIVE); 14 öppna frågor (Beslut krävs); 12 paket T3-0–T4-F (lokal GO, STAGING NO-GO, LIVE NO-GO).

<details><summary>Statusräkning 2026-11-26 (historik)</summary>

**Statusräkning 2026-11-26** (numrerade punkter 1–271 och E2b-1–E2b-6):

| Nivå/läge | Antal |
|---|---|
| Verifierad i LIVE | 0 |
| Verifierad i STAGING | 109 |
| Simulerat testad | 69 |
| Byggd | 52 |
| Delvis byggd | 11 |
| Ej påbörjad | 34 |
| Uppskjuten | 2 |
| **Summa** | **277** |

</details>

Till detta kommer F4-delarna (avsnittet Leverans F4), blockerarna A1–C2 och de egna id:na B1–B5, Ö1–Ö10 och B-FAKT-1 (status per id), AP-1–AP-6 (Beslutad), AP-FEL-1, UX-1–UX-8 och SÄK-1–SÄK-17 (Registrerad, ej påbörjad), D-01–D-26 och AP-A–AP-G (Beslutad, ej byggd, 2026-11-27) samt de öppna frågorna K-01–K-06, Q1–Q4, OR-1, OR-2, MIG-1 och KÄLLA-1 (Beslut krävs). Den tidigare statusgranskningen (`MASTERPLAN-STATUS-2026-11-26.md`) räknade bara punkt 1–210 och E2b, med fyra andra kategorier. Siffrorna är inte direkt jämförbara.


**Äldre legend (före 2026-11-26; behålls som historik för statusarna märkta "tidigare"). Gällande statusförklaring finns ovan.**
- `EJ PÅBÖRJAD` — ej startat
- `DELVIS BYGGD` — påbörjad, ofullständig
- `BYGGD – BEHÖVER TEST` — kod finns + UI fungerar, men ej verifierad mot realistisk data i stagingmiljö
- `TESTAD` — verifierad i stagingmiljö med realistisk data
- `BLOCKERAD` — blockeras av annan punkt
- `DEPLOYAD OCH TESTAD` — deploy gjord, verifierad i produktion
- `UPPSKJUTEN TILL V2` — medvetet utskjutet till nästa version
- `KLAR` (äldre poster) — commit finns + UI fungerar, ännu ej omklassificerad

**Totalt antal punkter: 153** *(historisk uppgift — se uppdateringen nedan)* (punkt 92 förekommer i Fas 4 = den enda definitionen; punkterna 132-133 är platshållare utan nummer-"gap" — se avsnittet om dem; 140–153 tillkom 2026-11-23, se Leverans H)

**Uppdatering 2026-11-26:** de numrerade punkterna är nu **1–271 plus E2b-1–E2b-6 (277)**. 154–210 tillkom 2026-11-23–25 (Leverans I–J), 211–240 är genomfört arbete 2026-11-24–26 (Leverans K) och 241–271 är riskregister och kvarstående arbete (Leverans L). Beslut och backlog har egna id: B1–B5, Ö1–Ö10 (numrering enligt `docs/qa-2026-11-26/BEHORIGHETER-BESLUTSUNDERLAG.md`), B-FAKT-1, AP-1–AP-6, AP-FEL-1, UX-1–UX-8, SÄK-1–SÄK-10 och AP-A–AP-G. Inget punktnummer har tagits bort eller återanvänts.

**Uppdatering 2026-11-27:** inga nya numrerade punkter. Nya id: D-01–D-26, SÄK-11–SÄK-17, paketen T3-0–T4-F och V1–V11, samt de öppna frågorna K-01–K-06, Q1–Q4, OR-1, OR-2, MIG-1 och KÄLLA-1.

**Uppdatering 2026-11-28 (T3-0, lokalt):** inga nya numrerade punkter. KÄLLA-1 och MIG-1: Beslutad, lokalt genomförd. SÄK-2, -3, -4, -5, -8, -11, -12, -13, -15 och -16: baslinje bevisad lokalt (ej åtgärdade). SÄK-17: paritet förberedd. Detaljer: `docs/qa-2026-11-28/T3-RESULTAT.md`.

**OBS — avstämning mot `docs/PROJECT_STATUS.md` (2026-11-20):** `PROJECT_STATUS.md`:s EGEN "Modulstatus"-tabell (dess översta sektion, punkt 1–92) är en ENGÅNGS-ögonblicksbild som aldrig uppdaterats sedan filen skapades — den säger t.ex. "EJ BYGGD" för punkt 12/13/40–42/62–64/67/72, trots att denna masterplan (uppdaterad iterativt över flera senare commits) och en direkt läsning av den faktiska källkoden DENNA session (`WorkOrdersPage.js`, `supabase/functions/service-monitor/index.ts`) bekräftar att dessa punkter FAKTISKT är byggda. **Denna masterplans tabeller nedan är auktoritativa för modulstatus — inte `PROJECT_STATUS.md`:s översta tabell.** `PROJECT_STATUS.md`:s EGET värde ligger i dess SENARE, additiva sektioner (R9B-fakturaarkitektur, BLOCKER-1/BLOCKER-2-säkerhetsfynd, cross-tab-auth-rättelser rond 1–4, LIVE/STAGING-paritetsfynd) — innehåll som INTE finns någonstans i denna fil. Se ny punkt `R9B-POINTER` nedan.

---

## Fas 0 — Kärninfrastruktur

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 1 | Vanilla JS SPA, hash-routing, pushState/popstate | **Verifierad i STAGING** · [S] R0 sex roller, alla sidor utan JS-fel; [T] PAGES-01/02 · *tidigare: KLAR* | 9b39b63 | Router.js |
| 2 | Supabase single-table blob store (vift_* nycklar) | **Verifierad i STAGING** · [S] F6, nivå 0–2, md5-kontroller före och efter GO · *tidigare: KLAR* | 9b39b63 | Storage.js |
| 3 | Auth (login, roller, RLS, Auth.can()) | **Verifierad i STAGING** · [S] R0, c5-read 26/26, authz-read 22/0, authz-mutation 51/0 (QA V3 B1) · *tidigare: KLAR* | 9b39b63 | Auth.js |
| 4 | Service Worker v10 (network-first, cache-busting) | **Verifierad i STAGING** · [S] installationsplan §6.4b: SW aktiv, versionsjämförelse 0 avvikelser; [T] SW-01 · *tidigare: KLAR* | 9b39b63 | sw.js |
| 5 | DataSync — polling var 15:e sekund | **Verifierad i STAGING** · [S] F6.11b: kundens godkännande syns i arbetsledarens klient (efter C-4). Kvar: G11 · *tidigare: KLAR* | 9b39b63 | DataSync.js |
| 6 | ActivityService — revisionslogg | **Delvis byggd** · [S] aktivitetsflödet (punkt 195) installerat, GO-6 19/19. Det är klientrapporterat. Verifierad revisionslogg (punkt 200) är inte byggd. · *tidigare: KLAR* | 9b39b63 | ActivityService.js |
| 7 | ActivitiesService — Att göra-uppgifter | **Verifierad i STAGING** · [S] GO-6 19/19 (egen uppgift tillåten, annans nekad) · *tidigare: KLAR* | 9b39b63 | ActivitiesService.js |
| 8 | Push-notiser (PushService, send-push Edge Function, VAPID) | **Byggd (installerad i STAGING, ej prövad)** · send-push v9 i STAGING (`REFERENSLAGE.md`); [T] NOTIF-01; riktig push-leverans aldrig prövad (E2E §7) · *tidigare: KLAR* | 9b39b63 | PushService.js, supabase/functions/send-push |

---

## Fas 1 — CRM-kärna

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 9  | Arbetsorder (AO) — fullständig CRUD, wizard, statusflöde | **Verifierad i STAGING** · [S] F6.12–F6.19 · *tidigare: KLAR* | 9b39b63 | WorkOrdersPage, WorkOrderDetailPage, WorkOrderService |
| 10 | AO — checklist, material, tidsstämpel, fakturering | **Verifierad i STAGING** · [S] F2, F6.15–F6.23, GO-5 8/8, qa-ao-material 17/17 · *tidigare: KLAR* | 9b39b63 | WorkOrderDetailPage |
| 11 | AO — objectId + objectName i wizard och detalj | **Byggd** · Riktat test: Källa saknas · *tidigare: KLAR* | 0135856 | WorkOrdersPage v34, WorkOrderDetailPage v47 |
| 12 | AO — snapshot-fält (customerName, objectNumber, contactId, contactName, accessInformation) | **Byggd** · Riktat test: Källa saknas · *tidigare: KLAR* | — | schema.js v20, WorkOrdersPage v38 |
| 13 | AO — sökning på objektnamn/objektnummer/port/trapphus | **Simulerat testad** · [T] PERF-01 och AOL (sökning generellt); objektfälten: Källa saknas · *tidigare: KLAR* | — | WorkOrdersPage v38 haystack |
| 14 | Kundregister — CRUD, kontaktpersoner | **Verifierad i STAGING** · [S] F6.1, F6.3; [T] CUS-01–03 · *tidigare: KLAR* | 9b39b63 | CustomersPage, CustomerService |
| 15 | Fastighetsregister — CRUD, teknisk info, bilder | **Byggd (delvis prövad i STAGING)** · [S] F6.2 (skapa). Bilder (`property_images`) aldrig prövade (E2E §7). · *tidigare: KLAR* | 9b39b63 | PropertyDetailPage, PageShells |
| 16 | Offertmodul | **Verifierad i STAGING** · [S] F6.4–F6.11, F7, F8 · *tidigare: KLAR* | 9b39b63 | OffersPage, OfferDetailPage |
| 17 | Fakturaunderlag | **Verifierad i STAGING** · [S] F6.20–F6.23 (belopp, 25 % moms, rätt kund, ingen dubbelfakturering). Öppet: intern kommentar skrivs ut på PDF:en · *tidigare: KLAR* | 9b39b63 | InvoicesPage, InvoiceDetailPage |
| 18 | Tidrapportering & stämpling | **Verifierad i STAGING** · [S] F3, F6.15, GO-3 G6 (1 tidpost), time-entries-list per person · *tidigare: KLAR* | 9b39b63 | TimePage |
| 19 | Återkommande ärenden | **Simulerat testad** · [T] REC-01, FALT; inget flöde mot STAGING (QA V3 åtgärd 6). Automatisk skapning finns inte (`FALTSIDOR.md`). · *tidigare: KLAR* | 9b39b63 | RecurringPage |
| 20 | Säljchanser / CRM-pipeline | **Simulerat testad (delvis prövad i STAGING)** · [T] SALES-01; [S] bara skrivbehörighet (G13 `vift_salesOpps`). Vyn är inte omarbetad. · *tidigare: KLAR* | 9b39b63 | SalesPage |
| 21 | Personalregister | **Simulerat testad** · [T] STAFF-01/02, T3C-01/03. Skydd mot att inaktivera sista superadmin och mot eskalering: **lokalt verifierat** (T3-C, 2026-11-28, server + klient). · *tidigare: KLAR* | 9b39b63 | StaffPage |
| 22 | Artikelregister | **Simulerat testad** · [T] ART-01. Beslut B1 om inköpspris öppet. · *tidigare: KLAR* | 9b39b63 | ArticlesPage |
| 23 | Prisgrupper | **Simulerat testad** · [T] ART-01. Aktivera/inaktivera utan serverbekräftelse (`REGISTER.md`). · *tidigare: KLAR* | 9b39b63 | PriceGroupsPage |
| 24 | Admin-sida (roller, inställningar) | **Simulerat testad (delvis prövad i STAGING)** · [S] A1 (bara visning); [T] ROLE-01/02, ARP-01–07. `vift_settings` skrivs som helhet. · *tidigare: KLAR* | 9b39b63 | AdminPage |
| 25 | Dashboard — KPI-kort, öppna AO, avvikelser | **Verifierad i STAGING** · [T] DASH-01, DASH-E-01–11; [S] R0 laddar per roll. (Kartan: se 181.) · *tidigare: KLAR* | 9b39b63 | Dashboard.js |
| 26 | Sidebar med badges | **Byggd (delvis prövad i STAGING)** · [S] R0 menyer per roll; badge-räkning: Källa saknas · *tidigare: KLAR* | 9b39b63 | Sidebar.js |

---

## Fas 2 — Rondering

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 27 | Ronderingsmallar (CRUD, kontrollpunkter, kategorier) | **Simulerat testad** · [T] RON-01–03; inget flöde mot STAGING · *tidigare: KLAR* | 9b39b63 | RonderingPage, RonderingWizardPage |
| 28 | Ronderingspass (planera, utföra, slutföra) | **Simulerat testad** · [T] RON-01; `rondering-pass-write` v3 finns i STAGING, men källan finns inte i repot (G4). Fältrollen når inte rondering (saknar `ao_view_all`). · *tidigare: KLAR* | 9b39b63 | RonderingUtforandePage, RonderingService |
| 29 | Avvikelser (öppen/åtgärdad/avskriven, kopplad AO) | **Simulerat testad** · [T] RON-01 · *tidigare: KLAR* | 9b39b63 | RonderingService |
| 30 | Ronderingsrapport (sammanfattning, historik) | **Byggd** · Ingen riktad test. Vyn står som "Kvar" i nattkörningen. · *tidigare: KLAR* | 9b39b63 | RonderingRapportPage |
| 31 | Avvikelse — objectId-koppling (väljarе i modal) | **Byggd** · Riktat test: Källa saknas · *tidigare: KLAR* | f61b26a | schema.js, RonderingUtforandePage v10 |

---

## Leverans 1 — Serviceintervall

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 32 | ServiceIntervalService v3 — 8 intervalltyper, 16 kategorier | **Simulerat testad** · [T] `service_intervals.test.js` (36 kontroller, ren beräkning) · *tidigare: KLAR* | b8842db | ServiceIntervalService.js |
| 33 | Kalenderbaserad datumberäkning | **Simulerat testad** · [T] samma test (datumgränser, skottår) · *tidigare: KLAR* | b8842db | ServiceIntervalService.js |
| 34 | Service-flik i fastighetskort (filter, sortering, status-chips) | **Simulerat testad** · [T] SVC-UI-01, MISC-PROP-01/02 · *tidigare: KLAR* | 9ca18d7 | PropertyDetailPage v17 |
| 35 | Markera utförd (historik, staffId, kommentar, AO-länk) | **Simulerat testad** · [T] SVC-01; inget flöde mot STAGING · *tidigare: KLAR* | 9ca18d7 | PropertyDetailPage |
| 36 | Pausa/återuppta serviceintervall | **Simulerat testad** · [T] pausning i `service_intervals.test.js` · *tidigare: KLAR* | 9ca18d7 | PropertyDetailPage |
| 37 | Stäng relaterade Att göra-poster vid markera utförd | **Simulerat testad** · [T] SVC-01 · *tidigare: KLAR* | b8842db | ServiceIntervalService v3 |
| 38 | Ansvarig personal visas i Dagens drift | **Simulerat testad** · [T] FALT (Dagens drift); riktat: Källa saknas · *tidigare: KLAR* | b8842db | OperationsPage v9 |
| 39 | Daglig klientkörning (runDailyCheck, idempotent, duePeriodKey) | **Simulerat testad** · [T] idempotens (punkt 146) · *tidigare: KLAR* | b8842db | ServiceIntervalService.js |
| 40 | Schemalagd Edge Function (server-side daglig körning) | **Byggd (installerad i STAGING, ej aktiverad)** · v15 installerad i STAGING, pg_cron `active=false`. Testlistan i installationsplan §3 är inte körd. · *tidigare: BYGGD – BEHÖVER DEPLOY* | — | supabase/functions/service-monitor/index.ts |
| 41 | Server-side dubblettskydd (atomisk idempotens) | **Byggd (installerad i STAGING, ej aktiverad)** · Som 40 · *tidigare: BYGGD – BEHÖVER DEPLOY* | — | supabase/functions/service-monitor/index.ts (duePeriodKey, lastNotificationSentForDueDate, lastAOGeneratedForDueDate) |
| 42 | Web-push för serviceintervall per ansvarig | **Byggd (installerad i STAGING, ej aktiverad)** · Som 40. Riktig push aldrig prövad. · *tidigare: BYGGD – BEHÖVER DEPLOY* | — | supabase/functions/service-monitor/index.ts (riktad via staff-email → auth user, fallback broadcast) |
| 43 | Automatisk AO via Edge Function | **Byggd (installerad i STAGING, ej aktiverad)** · Som 40 (atomisk `work_order_create`) · *tidigare: BYGGD – BEHÖVER DEPLOY* | — | supabase/functions/service-monitor/index.ts (buildWorkOrder, nextWorkOrderId) |

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
| 44 | Schema: customerNumber, externalId, externalSystem, paymentTerms på kund | **Byggd** · Riktat test: Källa saknas · *tidigare: KLAR* | 9910cda | schema.js v17 |
| 45 | ImportExportService.js — CSV-parser, XLSX-reader/writer (rent JS, ingen extern lib) | **Simulerat testad** · [T] IMP-01 (CSV). XLSX med riktiga filer aldrig prövat (F4-13). · *tidigare: KLAR* | 9910cda | ImportExportService.js v1 |
| 46 | Importlogg-schema (Schema.importLog(), state.importLogs[]) | **Simulerat testad** · [T] IMP-01 · *tidigare: KLAR* | 9910cda | schema.js v17, state.js v27 |
| 47 | ImportWizardPage.js — 6-stegsguide (välj fil, förhandsgranskning, matchning, validering, bekräftelse, resultat) | **Simulerat testad** · [T] IMP-01, MISC-IMP-01 · *tidigare: KLAR* | d3b5117 | ImportWizardPage.js v1 |
| 48 | Kolumnmatchning (auto-förslag, Bokio-profil, "Importera inte") | **Byggd** · Bokio-fil aldrig prövad (F4-13) · *tidigare: KLAR* | d3b5117 | ImportWizardPage.js, ImportExportService.js |
| 49 | Dubblettdetektering (org-nr, ext-ID, kundnr, e-post, namn+ort) | **Simulerat testad** · [T] IMP-01 · *tidigare: KLAR* | d3b5117 | ImportWizardPage.js._validateRows() |
| 50 | Konfliktlösning per rad (hoppa/skapa/uppdatera) | **Byggd** · Diff-vyn byggd i F4-6 (22e8ed3); motsägelsen mot "diff-vy EJ BYGGD" rättad 2026-11-26. Test: Källa saknas. · *tidigare: KLAR* | d3b5117 | ImportWizardPage.js steg 4–5 (diff-vy EJ BYGGD — *rättat 2026-11-26: diff-vyn byggdes senare i F4-6, 22e8ed3; uppgiften "EJ BYGGD" gällde före F4-6*) |
| 51 | Kundexport — CSV (alla/filtrerade) | **Simulerat testad** · [T] EXP-01 · *tidigare: KLAR* | 33872a1 | CustomersPage v10 |
| 52 | Kundexport — XLSX (flerblads: Kunder, Kontaktpersoner, Fastigheter) | **Simulerat testad** · [T] EXP-01 · *tidigare: KLAR* | 33872a1 | CustomersPage v10, ImportExportService.js |
| 53 | Importlogg med ångra (skapade ID:n + pre-import snapshot, ImportLogPage) | **Simulerat testad** · [T] IMP-01 ("ångra återställer servern", simulerat) · *tidigare: KLAR* | fb9ff35 | ImportLogPage.js v1, ImportExportService.undoImport() |
| 54 | Behörighetskontroll (bara admin importerar), portkod/nyckel aldrig i export | **Simulerat testad** · [T] EXP-01. `SAKERHET-DEL10.md`: "kontrolleras i paketets regression", men inget STAGING-belägg. · *tidigare: KLAR* | d3b5117 33872a1 | ImportWizardPage + ImportLogPage Auth.can('admin'), buildCustomerExportRows() |

---

## Leverans C — Objekt, lägenheter och lokaler

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 55 | Schema — PROPERTY_OBJECT_TYPES (11 typer) + PROPERTY_OBJECT_STATUSES (6) | **Simulerat testad** · [T] OBJ-01 · *tidigare: KLAR* | f917fdb | schema.js |
| 56 | Schema — Schema.propertyObject() (30+ fält inkl. contacts[], equipment[]) | **Simulerat testad** · [T] OBJ-01 · *tidigare: KLAR* | f917fdb | schema.js |
| 57 | State — state.propertyObjects[], initState, persist, getPropObj() | **Simulerat testad (delvis prövad i STAGING)** · [S] bara läsprojektion per roll (c5-read); [T] OBJ-01 · *tidigare: KLAR* | f917fdb | state.js |
| 58 | PropertyObjectService v1 — CRUD, kontakter, utrustning, sökning, typetiketter | **Simulerat testad** · [T] OBJ-01 · *tidigare: KLAR* | f917fdb | PropertyObjectService.js |
| 59 | Raderingsskydd — blockeras vid aktiva AO eller aktiva serviceintervall | **Byggd** · Masterplanen: "BEHÖVER TEST". Test: Källa saknas. · *tidigare: BYGGD – BEHÖVER TEST* | 53862af | PropertyObjectService.js v2 — fix: SI lagras i property.serviceIntervals[], inte state.serviceIntervals[] |
| 60 | PropertyDetailPage — Objekt-flik med filter (typ/status/sökning) och CRUD-modaler | **Simulerat testad** · [T] OBJ-01, MISC-PROP-01 · *tidigare: KLAR* | 9ef6d01 | PropertyDetailPage v18 |
| 61 | PropertyObjectPage v1 — detaljkort (info, access, kontakter, AO, utrustning) | **Simulerat testad (delvis prövad i STAGING)** · [T] OBJ-01; [S] vyn öppnas i publicerad v3.4 (skärmbild 1366_29) · *tidigare: KLAR* | 9ef6d01 | PropertyObjectPage.js |
| 62 | Objektskortet — serviceintervall kopplade till objekt | **Byggd** · "BEHÖVER TEST"; Källa saknas · *tidigare: BYGGD – BEHÖVER TEST* | aa70444 | PropertyObjectPage.js v3 — läser property.serviceIntervals[], visar status-badge + SI-länk |
| 63 | Objektskortet — avvikelser kopplade till objekt | **Byggd** · "BEHÖVER TEST"; Källa saknas · *tidigare: BYGGD – BEHÖVER TEST* | aa70444 | PropertyObjectPage.js v3 — filtrerar state.avvikelser[].objectId |
| 64 | Objektskortet — bilder och dokument | **Byggd** · "BEHÖVER TEST"; bilduppladdning aldrig prövad · *tidigare: BYGGD – BEHÖVER TEST* | aa70444 | PropertyObjectPage.js v3 — asynkron laddning via PropertyImageService, tech_section='obj:'+id |
| 65 | Router — pg-propobj-detail + /objekt/:objId | **Verifierad i STAGING** · [S] vyn öppnas i publicerad v3.4 (BILDPAKET-INDEX rad 9) · *tidigare: KLAR* | 9ef6d01 | Router.js v17 |
| 66 | AO-wizard — objektväljare (filtrerad per fastighet) + autofill portkod | **Simulerat testad** · [T] PROP-01/02 (portkodsläcka rättad) · *tidigare: KLAR* | 0135856 | WorkOrdersPage v34 |
| 67 | AO-wizard — prefill adress, kontakt, telefon, e-post från objekt | **Byggd** · Riktat test: Källa saknas · *tidigare: KLAR* | — | WorkOrdersPage v38 (entrance/stairwell/floor/apartmentNumber/contactEmail) |
| 68 | AO-detalj — visar kopplat objekt med länk | **Byggd** · Riktat test: Källa saknas · *tidigare: KLAR* | 0135856 | WorkOrderDetailPage v47 |
| 69 | Serviceintervall-formulär — objectId-väljare | **Byggd** · Riktat test: Källa saknas · *tidigare: KLAR* | f61b26a | PropertyDetailPage v19 |
| 70 | Avvikelse — objectId-väljare i ronderingsvyn | **Byggd** · Riktat test: Källa saknas · *tidigare: KLAR* | f61b26a | RonderingUtforandePage v10 |
| 71 | Kontakter/hyresgäster — CRUD (namn, telefon, e-post, roll, primär, giltighet, anteckning) | **Byggd** · "BEHÖVER TEST"; Källa saknas · *tidigare: BYGGD – BEHÖVER TEST* | aa70444 | PropertyObjectPage.js v3 — _addTenantContact, _editTenantContact, _removeTenantContact, sparas i obj.contacts[] |
| 72 | Rollbaserad åtkomstkontroll för portkod/nyckelinformation | **Verifierad i STAGING** · [S] c5-read med syntetiska portkoder, rätt för 7 roller. Kvar: B5 (skrivare utan `objects_sensitive` ser portkoder i data). · *tidigare: BYGGD – BEHÖVER TEST* | e8edf00 | Fullständig implementation: PropertyObjectPage, PropertyDetailPage, WorkOrdersPage, WorkOrderDetailPage, ExportCenterPage, PageShells (AdminPage rollredigering) |

---

## Fas 4 — Avancerade funktioner (planerat)

| # | Funktion | Status | Prioritet | Beroenden |
|---|----------|--------|-----------|-----------|
| 73 | Generell import/export — alla register, exportcenter, diff/conflict-UI | **Delvis byggd** · Se Leverans F4. Filtrerad export och Åter.ronderingar är inte byggda; F4-13 inte gjord. · *tidigare: DELVIS BYGGD* | Hög | 18 register konfigurerade (inkl. Rapporter exportonly); markerad export klar (5 sidor); disambiguering klar; historicalImport-guard klar; webbläsarverifiering återstår |
| 74 | Rondering — visningsrapport (PDF, dela) | **Byggd** · Ingen test. Ronderingsrapporten står som "Kvar". · *tidigare: KLAR* | — | RonderingRapportPage v1 (skriv ut + dela via länk) |
| 75 | Kalender — schemaläggning, dra-och-släpp | **Simulerat testad** · [T] CAL-01/02, MISC-CAL-01; pekskärm på riktig enhet aldrig prövad · *tidigare: BYGGD – BEHÖVER TEST* | 77ed695 | CalendarPage v2 — Pointer Events DnD (long-press 480ms, scroll blockeras ej); desktop HTML5 DnD kvar |
| 76 | Löneunderlag — export, perioder | **Simulerat testad** · [T] ARP. Lönedata saknas; beslut om CSV-kolumnen "Kostnad (SEK)" behövs. · *tidigare: BYGGD – BEHÖVER TEST* | 481b323 | PayrollPage.js v2: auth-guard i render/export/attest (Auth.can('reports_view')); direkt URL-åtkomst blockeras |
| 77 | Rapporter — statistik, diagram (AO, tid, objekt) | **Simulerat testad** · [T] REP-01. Masterplanens testlista (7 punkter) är obockad. · *tidigare: BYGGD – BEHÖVER TEST* | — | ReportsPage v4: se detaljer nedan |
| 78 | Mina jobb — tilldelade uppdrag per inloggad personal | **Verifierad i STAGING** · [S] R0 fältroller, qa-ao-material 17/17 (Starta, Ta jobbet) · *tidigare: KLAR* | (befintlig) | MyJobsPage (existerar, fel status i MASTERPLAN) |
| 79 | Avancerat behörighetssystem (per fastighet, per kundgrupp) | **Uppskjuten** · Uppskjuten · *tidigare: UPPSKJUTET* | Låg | Kräver ombyggnad av Auth.js — planeras ej i nuvarande fas |
| 80 | E-post-sändning via Edge Function (Resend) | **Byggd (installerad i STAGING, ej prövad)** · send-offer-email v11 i STAGING (`REFERENSLAGE.md`). Secrets: Källa saknas. F6 körs "utan mejl". · *tidigare: BYGGD – BEHÖVER DEPLOY* | 0f70a0f | supabase/functions/send-offer-email/index.ts; PageShells.js v89 — showSendModal med recipients/CC/BCC/mall/offerLink/bilagor/tidslinje-log; mailto fallback |
| 81 | Kontrakthantering (avtal, betalningsplan, villkor) | **Simulerat testad** · [T] MISC. Momsbas för belopp kräver beslut. · *tidigare: KLAR* | Medel | ContractsPage.js v1: CRUD, filter, årstotal, tillsvidara/auto-förnyelse |
| 82 | Mobil-optimerad offline-läge (SW fallback) | **Uppskjuten** · Uppskjuten · *tidigare: UPPSKJUTET* | Låg | Kräver IndexedDB-cachning i SW — planeras ej i nuvarande fas |
| 92 | Push/notiser — använd ansvarig titel vid utskick | **Byggd** · Riktig push aldrig prövad · *tidigare: KLAR* | — | send-push v2 + PushService v5: propertyId → propertyContacts → primär/alla aktiva staff |
| 129 | Klickbara rapportunderlag — öppna filtrerad lista med aktivt filter och period | **Delvis byggd** · Bara AO-staplarna leder till filtrerad AO-lista ([T] DASH-01). Övriga flikar går fortfarande till kort. Motsägelsen rättad 2026-11-26 (se avsnittet om punkt 77); riskregister R-02. · *tidigare: KLAR* | v38→v39 | WorkOrdersPage stöder nu propertyId/customerId via Router. AO-staplarna i ReportsPage navigerar till filtrerad AO-lista. |

---

## Punkt 77 — ReportsPage v4 (detaljer)

**Leveransstatus:** BYGGD – BEHÖVER DATAVERIFIERING OCH WEBBLÄSARTEST  
**Status 2026-11-26:** Simulerat testad ([T] REP-01). Testlistan nedan är obockad (riskregister R-03). Klickbarheten: se punkt 129 och rättelsen nedan.  
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

**Rättelse 2026-11-26 (motsägelse):** punkt 129 stod som KLAR medan detta avsnitt kallade den kvarvarande. Båda var delvis rätt. AO-staplarna leder till filtrerad AO-lista (WorkOrdersPage stöder `propertyId`/`customerId`), men staplarna i övriga flikar (tid, avvikelser, ekonomi, material, serviceintervall) går fortfarande till kund- eller fastighetskort. Punkt 129 har därför status **Delvis byggd**. Texten nedan och begränsningen "Klickbara staplar → fastighetsfiltrerad AO-lista" ovan gäller de flikar som inte är klara.

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

**Status 2026-11-26:** Delvis byggd. Delarna F4-1–F4-12 är byggda eller simulerat testade, F4-13 ej påbörjad. Filtrerad export och Åter.ronderingar är inte byggda (riskregister R-06).  
**Leveransstatus (tidigare):** DELVIS BYGGD — 18 register konfigurerade (rapport exportonly tillagd), markerad export byggd i 5 sidor, disambiguering byggd, historicalImport-guard fixad; webbläsarverifiering ej gjord

| Del | Funktion | Status | Commit |
|-----|----------|--------|--------|
| F4-1 | Kundimport, generisk motor, 6 register, wizard | **Simulerat testad** · [T] IMP-01 · *tidigare: Byggd* | 49b2810 |
| F4-2/3 | Fastigheter, objekt, artiklar, prisgrupper, personal — config + toolbar | **Byggd** · riktat test: Källa saknas · *tidigare: Byggd* | 8398450 |
| F4-4/5 | AO, tid, faktura (historicalImport), ronderingsmall, avvikelse — config | **Simulerat testad** · [T] IMP-03 (AO-id-dubbletter rättade 2026-11-26, punkt 233) · *tidigare: Byggd* | 8398450 |
| F4-6 | Diff/conflict-UI: per-fält before/after, ångra-dialog | **Byggd** · test: Källa saknas · *tidigare: Byggd* | 22e8ed3 |
| F4-7 | Exportcenter (ExportCenterPage), kolumnval, känsliga fält av som standard | **Simulerat testad** · [T] EXP-01; kolumnräknaren rättad 2026-11-26; se SÄK-1 · *tidigare: Byggd* | 328e3bf |
| F4-8 | Stabilisering: logg-pruning, race-condition-skydd | **Byggd** · test: Källa saknas · *tidigare: Byggd* | 0adbf27 |
| F4-9 | 6 saknade register (kontaktpersoner, materialrader, ronderingspass, ronderingSchema, serviceintervall) | **Byggd** · test: Källa saknas · *tidigare: Byggd* | 4df7b19 |
| F4-10 | Import/export UI på AO, Tid, Faktura, Rondering | **Simulerat testad** · [T] MISC-IMP-01 · *tidigare: Byggd* | 4df7b19 |
| F4-11 | Markerad export — SelectionModel, checkboxar i Kunder, AO, Personal, Fastigheter, Artiklar | **Simulerat testad** · [T] AOL (massmarkering) · *tidigare: Byggd* | 1cfc543 |
| F4-12 | Relationsdialog för ambiguösa träffar — ej auto-val, manuell picker i steg 4 | **Byggd** · test: Källa saknas · *tidigare: Byggd* | 222e976 |
| F4-historicalImport | PushService-guard i WorkOrderService.create() för historiska importer | **Byggd** · test: Källa saknas · *tidigare: Byggd* | 5bfa59c |
| F4-13 | Webbläsarverifiering med riktiga filer (Bokio, Excel, Numbers, Safari iOS) | **Ej påbörjad** · riskregister R-06 · *tidigare: Ej testad* | — |

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

**Rättelse 2026-11-26 (motsägelse):** rubriken sa "DELVIS BYGGD" medan raderna sa KLAR. Korrekt läge: alla punkter 83–91 är **byggda**, flera simulerat testade. Ingen är verifierad i STAGING utöver att lägga till en kontakt (F6.3). Push till ansvarig (92) är aldrig prövad. Se status per punkt och riskregister R-04.

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 83 | Schema — Schema.propertyRole() (titelregister: förvaltare, skötare, m.fl.) | **Byggd** · Riktat test: Källa saknas · *tidigare: KLAR* | — | schema.js v18 |
| 84 | Schema — Schema.propertyContact() (koppling person↔fastighet/objekt) | **Simulerat testad** · [T] CON-01 · *tidigare: KLAR* | — | schema.js v18 |
| 85 | State — state.propertyRoles[], state.propertyContacts[], persist, DataSync | **Byggd** · Blockerare B2 (DataSync för övriga entiteter) är inte verifierad · *tidigare: KLAR* | af97e9f | state.js v30 |
| 86 | Titelregister — CRUD i Admin (skapa/redigera titlar, scope, onlyOnePrimary) | **Byggd** · Riktat test: Källa saknas · *tidigare: KLAR* | af97e9f | PageShells v81 |
| 87 | Fastighetskortet — flik "Ansvariga & kontakter" (CRUD, primär, giltighet) | **Byggd (delvis prövad i STAGING)** · [S] F6.3 (lägg till kontakt). Primär, giltighet och redigering är inte prövade. · *tidigare: KLAR* | af97e9f | PropertyDetailPage v20 |
| 88 | Objektskortet — kontakter på objektnivå (hyresgäst, lokalansvarig) | **Byggd** · "BEHÖVER TEST" (punkt 71) · *tidigare: BYGGD – BEHÖVER TEST* | aa70444 | PropertyObjectPage v3 — full CRUD för hyresgästkontakter (punkt 71) |
| 89 | AO-wizard — föreslå kontakt baserat på fastighet + kategori + titel | **Byggd** · Riktat test: Källa saknas · *tidigare: KLAR* | — | WorkOrdersPage v37 |
| 90 | Dagens drift — visa ansvariga per fastighet | **Simulerat testad** · [T] FALT · *tidigare: KLAR* | — | OperationsPage v10 |
| 91 | PropertyContactService — CRUD, primärkontroll, historikvy | **Simulerat testad** · [T] CON-01 · *tidigare: KLAR* | af97e9f | PropertyContactService.js v1 |
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
**Rättelse 2026-11-26 (motsägelse):** rubriken sa att E5–E7 återstod medan raderna sa KLAR. Korrekt läge:
- **E1–E4 och E6** är i huvudsak **verifierade i STAGING** (F6–F8, GO-8a–d).
- **E5** är **byggd** (riktig push aldrig prövad).
- **E7 (124–127)** är **byggd** utan test.
- **128** är **delvis byggd** (rate-limit aldrig prövad).

Se status per punkt och riskregister R-05.  
**Prioritet i arbetsordning:** Byggs efter kvarvarande Leverans D, serviceintervall-motor, push och auto-AO. Inget i Leverans E ersätter eller skjuter upp tidigare planerade funktioner.  
**Säkerhetsregel (permanent):** Tokenkontroll, godkännande, ändringsbegäran och nekande valideras och sparas enbart via säker backend-funktion (Supabase Edge Function). Kunden kan aldrig manipulera offert­status eller belopp via frontendkod. Känsliga interna fält (inköpspris, marginal, TB, interna noter, personalinfo, andra kunder) exponeras aldrig i kundvyn.

### Del E1 — Offertversioner och låsta snapshots

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 93 | Schema — Schema.offerEvent(), token-fält på offer (publicToken, tokenCreatedAt, tokenExpiresAt, tokenRevokedAt, openCount, openedAt, lockedSnapshotJSON) | **Verifierad i STAGING** · [S] F6.8 (token ≥ 32 tecken, låst snapshot) · *tidigare: KLAR* | — | schema.js v21 |
| 94 | Schema — Schema.offerEvent(): händelselogg per offert/version | **Verifierad i STAGING** · [S] F6 (14 händelser städade), c5-read · *tidigare: KLAR* | — | schema.js v21 |
| 95 | State — state.offerEvents[], persist, DataSync | **Verifierad i STAGING** · [S] F6.11b · *tidigare: KLAR* | — | state.js v31 |
| 96 | OffertUI — Digital länk-panel i offertkortet (generera, kopiera, statusindikator, återkalla, förläng) | **Verifierad i STAGING** · [S] F6.8; GO-8c: återkallad och utgången nekas · *tidigare: KLAR* | — | PageShells.js v82 (_digitalLinkPanel, generateDigitalLink, revokeDigitalLink, extendDigitalLink) |
| 97 | Låsning vid utskick — lockedSnapshotJSON sparas vid tokengenerering | **Verifierad i STAGING** · [S] F6.8 `lockedSnapshotJSON` · *tidigare: KLAR* | — | PageShells.js v82 (generateDigitalLink) |

**Statusar för offerter:**
`Utkast` · `Klar att skicka` · `Skickad` · `Öppnad` · `Ändring begärd` · `Reviderad` · `Godkänd` · `Nekad` · `Utgången` · `Återkallad` · `Ersatt av ny version`

**Versionsregel:** Godkännande kopplas alltid till ett specifikt offerId + offerVersionId + versionNumber + låst snapshot. Ett tidigare godkännande flyttas aldrig automatiskt till ny version.

---

### Del E2 — Säker publik offertlänk

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 98 | Schema — publicToken, tokenCreatedAt, tokenExpiresAt, tokenRevokedAt, openedAt, openCount på offer | **Verifierad i STAGING** · [S] F6.8 · *tidigare: KLAR* | — | schema.js v21 |
| 99 | Edge Function — offer-token-validate: rate-limit 30/min, validerar token/giltighetstid/återkallning, returnerar publika fält (inga interna), uppdaterar openCount/openedAt | **Verifierad i STAGING** · [S] F6.10, GO-8c 9/9 (v11). Rate-limit aldrig prövad. · *tidigare: KLAR* | — | supabase/functions/offer-token-validate/index.ts |
| 100 | Edge Function — offer-respond: godkänn/ändring/neka, rate-limit 5/min, validerar token+version, sparar auditlogg, uppdaterar status, push-notis till VIFT | **Verifierad i STAGING** · [S] F6.11, F7, F8 · *tidigare: KLAR* | — | supabase/functions/offer-respond/index.ts |
| 101 | CRM-UI — Generera digital länk: token, giltighetstid, visningslänk + kopiering, statusindikator | **Verifierad i STAGING** · [S] F6.8 · *tidigare: KLAR* | — | PageShells.js v82 (generateDigitalLink, _digitalLinkPanel) |
| 102 | CRM-UI — Återkalla länk / förläng giltighetstid / generera ny token | **Simulerat testad (delvis prövad i STAGING)** · [T] OFF-04. Serverns nekande av återkallad token är [S] GO-8c, men UI-flödet är inte prövat mot STAGING. · *tidigare: KLAR* | — | PageShells.js v82 (revokeDigitalLink, extendDigitalLink) |

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
| E2b-1 | Schema — Schema.offerAttachment(): storagePath, checksum, lockedInVersion, includeInPublicView m.m. State.offerAttachments | **Verifierad i STAGING** · [S] F6.5, GO-8a 11/11 · *tidigare: KLAR* | 952508d | schema.js v22, state.js v32 |
| E2b-2 | CRM-UI — dropzone, fillista, redigering (namn/beskrivning/kundvy/PDF), borttagning. offer-attachment-upload Edge Function | **Verifierad i STAGING** · [S] F6.5, GO-8a (v13 med PATCH) · *tidigare: KLAR* | 2ab4413 | PageShells.js v85, components.css, offer-attachment-upload/index.ts |
| E2b-3 | Kundåtkomst — offer-attachment-url ger signerade Supabase Storage-URL:er (3600s). offer-token-validate returnerar public attachments | **Verifierad i STAGING** · [S] GO-8a–d (QA V3 B1: token A ger bara A, återkallad 403, utgången 410) · *tidigare: KLAR* | 0a5b7f8 | offer-attachment-url/index.ts, offer-token-validate/index.ts v2, public-offer.html v2 |
| E2b-4 | Samlad PDF — offer-pdf kombinerar offertinnehåll + inbäddningsbara bilagor (PDF, JPEG, PNG). DOCX/XLSX listas separat | **Byggd** · offer-pdf v10 i STAGING. F6.9 prövar kund-PDF:en (`offer-public-pdf`), inte den samlade PDF:en. · *tidigare: KLAR* | 9172c26 | offer-pdf/index.ts |
| E2b-5 | Versionslåsning — bilagor markeras lockedInVersion vid digital länk-generering | **Byggd** · `lockedInVersion` inte kontrollerat; Källa saknas · *tidigare: KLAR* | 57a691e | PageShells.js (generateDigitalLink) |
| E2b-6 | Token-kontroll — storagePath exponeras aldrig; offer-attachment-url validerar token/revokering/giltighetstid/includeInPublicView | **Verifierad i STAGING** · [S] GO-8a–d · *tidigare: KLAR* | 0a5b7f8 | offer-attachment-url/index.ts |

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
| 103 | PublicOfferPage — extern kundvy med VIFT-logotyp, offertnummer, kund, datum, giltighetstid, rubrik, beskrivning | **Verifierad i STAGING** · [S] F6.10 · *tidigare: KLAR* | — | public-offer.html |
| 104 | Kundvy — offertposter: namn, à-pris inkl. moms, RUT/ROT-märkning, tillägg, rad-detaljer | **Verifierad i STAGING** · [S] F6.10; [T] paritet 120/120 i riktig webbläsare (punkt 147) · *tidigare: KLAR* | — | public-offer.html |
| 105 | Kundvy — summering: exkl. moms, moms, RUT/ROT-avdrag, kundpris | **Verifierad i STAGING** · [S] F6.10 (4 940 kr); [T] G8-01 · *tidigare: KLAR* | — | public-offer.html |
| 106 | Kundvy — villkor, betalningsvillkor, omfattning, ingår/ingår ej, allmänna villkor | **Byggd** · Riktat test: Källa saknas · *tidigare: KLAR* | — | public-offer.html |
| 107 | Kundvy — statusmeddelanden (godkänd/nekad/ändring), utgångspåminnelse | **Byggd (delvis prövad i STAGING)** · [S] serverstatus i F7/F8; meddelandena på kundsidan: Källa saknas · *tidigare: KLAR* | — | public-offer.html |
| 108 | Kundvy — Skriv ut (window.print()), responsiv (mobil/desktop/iOS Safari/Chrome) | **Byggd** · Safari och riktiga telefoner aldrig prövade (E2E §7) · *tidigare: KLAR* | — | public-offer.html |

**Designkrav:** Ren, professionell, VIFT-profilerad. Fungerar på mobil, iPhone, iPad, desktop, Safari, Chrome. Inga interna fält, noteringar, inköpspris, marginal, TB, annan kundinformation eller personaldata visas.

---

### Del E4 — Godkänn / Begär ändring / Neka

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 109 | Godkänn offert — formulär: namn, e-post, telefon, befattning, kommentar, villkors-checkbox | **Verifierad i STAGING** · [S] F6.10–F6.11 · *tidigare: KLAR* | — | public-offer.html (showForm approve) |
| 110 | Godkänn offert — Edge Function: validerar token+version, sparar datum/tid/namn/e-post/IP, sätter status → godkänd, offerEvent | **Verifierad i STAGING** · [S] F6.11 (`approvedByName`) · *tidigare: KLAR* | — | offer-respond (action=approve) |
| 111 | Begär ändring — formulär: kategori (pris/omfattning/tidplan/villkor/offertpost/annat), fritext | **Verifierad i STAGING** · [S] F8 · *tidigare: KLAR* | — | public-offer.html (showForm change_request) |
| 112 | Begär ändring — Edge Function: validerar, sparar invändning + kategori, sätter status → ändring-begärd, offerEvent | **Verifierad i STAGING** · [S] F8 (status `ändring-begärd`) · *tidigare: KLAR* | — | offer-respond (action=change_request) |
| 113 | Neka offert — formulär: anledning (för dyrt/annan leverantör/genomförs ej/tidplan/omfattning/annat), valfri kommentar | **Verifierad i STAGING** · [S] F7 · *tidigare: KLAR* | — | public-offer.html (showForm decline) |
| 114 | Neka offert — Edge Function: validerar, sparar anledning + kommentar, sätter status → nekad, offerEvent | **Verifierad i STAGING** · [S] F7 (status `nekad` med skäl) · *tidigare: KLAR* | — | offer-respond (action=decline) |
| 115 | Kundbekräftelse — tydlig bekräftelsebox efter godkänn/ändring/neka, push-notis till VIFT-personal | **Byggd** · Pushen aldrig prövad; bekräftelseboxen: Källa saknas · *tidigare: KLAR* | — | public-offer.html (po-success-box), offer-respond (sendPushToVift) |

**Godkännandespårbarhet:** Datum, tid, IP (om tillgänglig), namn och e-post sparas. Beskrivs inte som avancerad e-signatur eller BankID eftersom ingen sådan tjänst används — godkännandet är ett spårbart digitalt samtycke.

---

### Del E5 — Notiser och tidslinje

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 116 | Notiser — push till VIFT vid godkännande, ändringsbegäran, nekande | **Byggd** · Riktig push aldrig prövad · *tidigare: KLAR* | — | offer-respond (sendPushToVift — broadcast till alla aktiva) |
| 117 | Notiser — format: "Offert godkänd" / "Ändring begärd" / "Offert nekad" + kundens namn + offertid | **Byggd** · Som 116 · *tidigare: KLAR* | — | offer-respond |
| 118 | Tidslinje-UI — offerEvents (öppnat/godkänt/ändring/nekat) visas i _timelineHtml kombinerat med interna händelser | **Simulerat testad** · [T] OFFD; riktat mot STAGING: Källa saknas · *tidigare: KLAR* | — | PageShells.js v83 (_timelineHtml — slår ihop off.timeline + state.offerEvents) |
| 119 | Visningsstatistik — öppningsantal, openedAt, openCount visas i digital länk-panel | **Byggd** · Källa saknas · *tidigare: KLAR* | — | PageShells.js (_digitalLinkPanel) |

---

### Del E6 — Konvertering till AO

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 120 | Konvertering — "Skapa arbetsorder från godkänd offert"-knapp (status=godkänd && !workOrderId) | **Verifierad i STAGING** · [S] F6.12 · *tidigare: KLAR* | — | PageShells.js (OfferDetailPage.createAO CTA) |
| 121 | Konvertering — AO ärver kund, fastighet, titel, beskrivning, offertposter, priser, checklista | **Verifierad i STAGING** · [S] F6.13 (kund, fastighet, belopp); checklistans arv inte kontrollerat · *tidigare: KLAR* | — | PageShells.js (OfferDetailPage.createAO) |
| 122 | Konvertering — off.workOrderId + convertedAt ↔ ao.sourceOfferId + sourceOfferVersionId + sourceOfferNumber | **Verifierad i STAGING** · [S] F6.12 (`offerId` på AO) · *tidigare: KLAR* | — | PageShells.js v83 (createAO) |
| 123 | Dubbelkonverteringsskydd — kontroll + toast om workOrderId redan satt | **Verifierad i STAGING** · [S] F6.12b · *tidigare: KLAR* | — | PageShells.js v83 (createAO — tidig return med toast) |

---

### Del E7 — Påminnelser, analys och stabilisering

| # | Funktion | Status | Commit | Filer |
|---|----------|--------|--------|-------|
| 124 | Påminnelseflaggor — CRM visar offerter som: skickade men ej öppnade, öppnade men obesvarade, snart utgångna (konfig. dagar), utgångna, kräver svar på ändringsbegäran | **Byggd** · Ingen test funnen · *tidigare: KLAR* | E7 | PageShells.js — _offerInsight() + "Behöver åtgärd"-tab |
| 125 | Påminnelse — ansvarig kan skicka manuell påminnelse (uppdaterar tokenExpiresAt vid behov). Inga påminnelser skickas efter godkännande, nekande eller återkallande. | **Byggd** · Ingen test funnen (mailto) · *tidigare: KLAR* | v84 | PageShells.js — sendReminder() med mailto + valfri tokenExpiresAt-förlängning |
| 126 | Analysdata — sparas strukturerat för framtida rapportering: antal skickade, öppningsgrad, godkännandegrad, nekandegrad, svarstid, vanligaste nekandeanledning, offertvärde, vunnet/förlorat värde per kund/ansvarig | **Byggd** · Ingen test funnen · *tidigare: KLAR* | v6 | offerEvents (E1/E5) + ReportsPage Offert-flik (punkt 127) |
| 127 | ReportsPage — Offert-flik: öppningsgrad, godkännandegrad, vanligaste invändningar, offertvärde vunnet/förlorat, per kund och ansvarig | **Byggd** · Ingen riktad test funnen · *tidigare: KLAR* | v6 | ReportsPage.js |
| 128 | Säkerhetsverifiering — fullständig kontroll: inga interna fält i kundvy, tokenkontroll fungerar, rate-limit testad, dubbelkonverteringsskydd verifierat, inga XSS-risker i offertposter | **Delvis byggd** · [S] interna fält (GO-8c), token (GO-8a–d), dubbelkonvertering (F6.12b), XSS (X1). Rate-limit aldrig prövad. · *tidigare: KLAR* | — | Automatisk audit (7/8 PASS). Fix: already_answered blockerar nu ALLA svar (inte bara approve) efter godkänd/nekad offert. |

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
| 130 | `persist()` skickar nu endast de store-nycklar vars värde faktiskt ändrats sedan senaste bekräftade skrivning (diff mot `_lastWrittenJSON`, uppdateras endast efter bekräftad framgång — ingen tyst dataförlust vid misslyckad skrivning) | **Verifierad i STAGING (genom ersättning)** · Överspelad. STAGING-klientens per-element-merge används ([S] F6, md5 oförändrade efter GO). · *tidigare: KLAR — verifierat lokalt (5/5 sandlådetest mot den faktiska filen), EJ TESTAT i STAGING* | b8a95d0 | state.js v50 |
| 131 | Nya arbetsorder-loggfoton laddas upp till Supabase Storage (`workorder-images`, privat bucket, samma åtkomstmodell som befintlig `PropertyImageService`) istället för att bäddas in som base64 i `vift_workOrders`. Befintliga, historiska bilder orörda (bakåtkompatibel rendering). Avvikelse-/checklistefoto komprimeras (900px/JPEG 0.75) men flyttas INTE till Storage denna omgång (EF-kontraktet oförändrat) | **Verifierad i STAGING** · [S] GO-8b 14/14, F6.18 · *tidigare: KLAR — verifierat lokalt (4/4 isolerade logiktest), EJ TESTAT i STAGING. Bucket/RLS-policy EJ installerad (kräver separat GO)* | faa43e6 | WorkOrderImageService.js (ny), WorkOrderDetailPage.js v74 |
| 134 | Säker bildradering — `deleteLogEntry()` raderade tidigare Storage-filen INNAN databasen bekräftat att loggposten själv raderats; ett misslyckat/osäkert nätverksanrop kunde lämna en loggpost kvar med en redan borttagen bild. Ordningen är nu: mutera lokalt → `await persist()` → ENDAST vid bekräftad framgång rörs Storage-filen; vid misslyckande rullas den lokala mutationen tillbaka | **Verifierad i STAGING** · [S] GO-8b (borttagning); [T] IMG-03 · *tidigare: KLAR — kod granskad + syntaxkontrollerad, EJ automatiserat testad (DOM-beroende), EJ TESTAT i STAGING* | — | WorkOrderDetailPage.js v75 |
| 135 | Tidregistrerings-integritet, hela dataflödet — tre separata brister rättade: (1) `DataSync._poll()`:s ovillkorliga "uppdatera localStorage"-block skrev tidigare RÅA, ofiltrerade `remote.timeEntries`/`remote.staff` till localStorage trots att `state.X` redan var filtrerat/sanerat; (2) `initState()` (körs FÖRE identiteten är känd) satte ALDRIG något payroll-filter alls — `state.timeEntries` var fullt ofiltrerat i minnet från appstart tills FÖRSTA poll-cykeln råkade upptäcka en fjärrändring; (3) ny, delad `_applyTimeEntriesPayrollFilter()` anropas nu från BÅDE `Auth._resolveUser()` (appstart/inloggning/rollbyte — stänger lucka 2) OCH `DataSync._poll()` (stänger lucka 1) | **Verifierad i STAGING** · Ersatt av `time-entries-list` och RESTRICTIVE-policy ([S] verifierat: egna tidposter, `payroll_view` ser alla) · *tidigare: KLAR — verifierat lokalt (4/4 sandlådetest mot de faktiska filerna, inkl. fail-closed för okänd identitet), EJ TESTAT i STAGING. **Kvarstående, oförändrad, redan dokumenterad begränsning** (ej löst här): ingen server-side RLS-nivå-filtrering finns ännu (BLOCKER-1:s fullständiga fix) — se egen notis nedan* | — | state.js v51, AuthService.js v17 |
| 136 | Idempotenskonflikt mellan `runDailyCheck()` och `service-monitor` — RÄTTELSE av ett eget tidigare felaktigt påstående (se notis ovan): `runDailyCheck()` anropas FAKTISKT vid varje inloggning (`index.html` `App.showApp()`), och delade TIDIGARE idempotensnyckel med service-monitors push-logik — en REDAN AKTIV bugg, inte en hypotetisk framtida risk. Ny, egen nyckel `lastActivityNotifiedForDueDate` införd för `runDailyCheck()`; `lastNotificationSentForDueDate` nu reserverad enbart för service-monitor (orört) | **Simulerat testad** · [T] `service_intervals.test.js`. `service-monitor` är inte aktiverad, och §3 är inte körd. · *tidigare: KLAR — kod granskad + syntaxkontrollerad, EJ TESTAT i STAGING* | — | ServiceIntervalService.js v4 |
| 137 | Arbetsorderbilder — serverbaserad åtkomstkontroll istället för enbart frontend-kontroll. Två nya Edge Functions, `work-order-image-url` och `work-order-image-upload`, ersätter direkt klient→Storage-anrop: båda kör `checkViftAuth()` och en ny, delad `canViewWorkOrder(ao, perms, callerStaffId)`-regel i `_shared/vift-auth.ts` (källverifierad mot exakt samma synlighetsregel som redan används av `WorkOrdersPage.js`: `ao_view_all`/`all` → allt, annars `ao_view_own` OCH (tilldelad ELLER `status==='pool'`), fail-closed vid okänd `callerStaffId`). Ny `isPathUnderAo()` stoppar IDOR — en anropare behörig för EN arbetsorder kan inte begära en signerad URL för en ANNAN arbetsorders bildsökväg genom att skicka in fel `aoId`. Uppladdning kräver dessutom `ao_checklist`/`ao_edit`, sniffar faktiska magic bytes (JPEG/PNG/WebP) istället för att lita på klientens Content-Type, och begränsar till 10 MB. `WorkOrderImageService.js` uppdaterad att anropa dessa EF:er istället för Storage direkt för `upload()`/`getSignedUrls()`; `remove()` går fortfarande direkt mot Storage under en ÄNNU EJ installerad, smalare DELETE-policy — kvarstående, dokumenterad, mindre risk. `WorkOrderDetailPage.js` INTE rörd av denna ändring (bekräftat via `git diff --stat`) | **Verifierad i STAGING** · [S] GO-8b 14/14 · *tidigare: KLAR — `tsc --strict` exit 0, 18/18 egna, oberoende sandlådetest mot den faktiska transpilerade källkoden (inkl. IDOR- och fail-closed-fall), EJ TESTAT i STAGING. Storage-bucketns SELECT/INSERT-policy (förslag i filens headerkommentar: begränsa till `service_role` only) EJ installerad — kräver separat GO* | 07e46e5 | `_shared/vift-auth.ts`, `work-order-image-url/index.ts` (ny), `work-order-image-upload/index.ts` (ny), WorkOrderImageService.js v2 |
| 138 | Installationsavstämning (2026-11-22) — tre kvarstående, konkreta fynd från punkt 137 åtgärdade: **(a)** den föreslagna `wo_images_storage_delete`-policyn tillät fortfarande `TO authenticated` DELETE på HELA bucketen — stängd med en tredje EF, `work-order-image-delete` (samma mönster: `checkViftAuth` + `ao_checklist`/`ao_edit` + `canViewWorkOrder` + `isPathUnderAo`, service_role-radering); bucket-förslaget ändrat så ALLA tre operationer (SELECT/INSERT/DELETE) nu är `service_role`-only, ingen `authenticated`-policy kvar. `WorkOrderImageService.remove()` anropar nu denna EF (signatur ändrad till `remove(aoId, storagePath)`); enda anropsplatsen (`WorkOrderDetailPage.deleteLogEntry()`) uppdaterad. **(b)** verifierat en REDAN EXISTERANDE sårbarhet i `work-order-image-upload`: `effectiveMime = sniffed ?? claimed` föll tillbaka på klientens (trivialt förfalskningsbara) Content-Type när magic-byte-sniffningen inte kände igen filen — gjorde hela innehållskontrollen verkningslös. Rättat så `sniffed` ensamt är auktoritativt; en fil vars faktiska bytes inte matchar en känd bildsignatur avvisas alltid, oavsett deklarerad Content-Type. **(c)** verifierat att `Storage._authFetch()`/`setAll()` (skrivvägen `persist()` använder, inkl. `deleteLogEntry()`s två sekventiella anrop) saknade ALL timeout-hantering — ett hängande `fetch()` kunde låta `await persist()` vänta obegränsat, utan feedback. Ny, opt-in `timeoutMs`-parameter (AbortController) i `_authFetch()`; `setAll()` sätter 20000ms. Läsvägarna (`get`/`getAll`, `initState()`s egen 8s-fallback) är OBERÖRDA (`timeoutMs` default = inget, exakt tidigare beteende). Verifierat: `_persistQueue` serialiserar `WorkOrderService.update()`s interna (fire-and-forget) persist() och `deleteLogEntry()`s explicita `await persist()` strikt sekventiellt, och `_lastWrittenJSON`-cachen uppdateras ENDAST vid bekräftad framgång — en "delvis lyckad skrivning" kan inte uppstå på SQL-nivå (`Storage.setAll()` är ETT enda PostgREST-upsert-anrop, atomiskt), och ett timeout-fel fångas av samma redan korrekta `catch` som returnerar `false` (aldrig `true`, aldrig ett okontrollerat hängande löfte) | **Verifierad i STAGING** · [S] GO-8b; [T] `write_timeout.test.js` · *tidigare: KLAR — `tsc --strict` exit 0 (alla tre EF:er), 10/10 test mot den riktiga, rättade `sniffMime`-logiken (inkl. simulerad förfalskad Content-Type-attack), 5/5 test av timeout-mekanismen mot den riktiga `storage.js` (inkl. ett verkligt 20 024 ms end-to-end-test av `setAll()` mot en hängande `fetch()`, som bekräftar `false` — ALDRIG hängande/`true`), EJ TESTAT i STAGING. Bucket-policyerna (alla tre nu `service_role`-only) EJ installerade — kräver separat GO* | — | `work-order-image-delete/index.ts` (ny), `work-order-image-upload/index.ts`, `WorkOrderImageService.js` v3, `WorkOrderDetailPage.js` v76, `storage.js` v12 |
| 139 | STAGING-reconciliation (2026-11-22) — en direkt, läsande jämförelse mot faktisk installerad STAGING-kod (`docs/STAGING-FAKTISK-KOD-DIFF-2026-11-22.md`) hittade att denna branchs `service-monitor/index.ts` hade REGRESSERAT till en äldre, batch-upsert-baserad (icke-atomisk) version av AO-skapandet — den redan installerade, verifierat körande STAGING v15 använder den säkrare, atomiska `work_order_create`-RPC:n. Branchens källa återställd att matcha exakt (commit `84cbafd`). Samtidigt bekräftat: `time-entries-list` är redan installerad som v3 med GET+POST — branchens nyare GET-only-variant (denna sessions BLOCKER-1-arbete) hade tappat POST-kompatibiliteten; återställd att stödja båda METHODS igen, med denna sessions server-sidiga filtrering/rate-limit bevarad (commit `baeb9b4`). Vidare bekräftat REDAN installerat i STAGING (ingen ny åtgärd): `store_timeentries_no_direct_select` och `store_workorders_no_direct_select` (båda RESTRICTIVE SELECT TO authenticated) samt `service-monitor`s pg_cron-jobb (`vift-service-monitor-daily`, `active=false`, väntar på separat aktiveringsbeslut). Denna sessions redundanta migrationsförslag `20261120000002_PROPOSAL_timeentries_read_lockdown.sql` markerad ÖVERSPELAD (ej raderad, historik bevarad) eftersom STAGING redan har en likvärdig policy. Nytt, flaggat (ej löst) gap: RPC:n `work_order_create` finns i STAGING men saknar en committed migration i detta repo. Allt sammanställt i en enda installationsplan, `docs/INSTALLATIONSPLAN-STAGING-2026-11-22.md` | **Byggd (dokument/leverans)** · [D] `STAGING-FAKTISK-KOD-DIFF`. Följdgapet G1 är öppet (punkt 242). · *tidigare: KLAR — `tsc --strict` OK på båda återställda EF:erna (en enda, pre-existerande, oförändrad kosmetisk `implicit any` i den overifierat matchande STAGING-koden, ej åtgärdad för att inte avvika från den bekräftat körande källan), 73/73 ackumulerat regressionstest oförändrat gröna efter fast-forward-merge. Installationsplanen EJ körd — väntar på GO per rad* | 84cbafd, baeb9b4, f2fbcab, a6b1e30 | `service-monitor/index.ts`, `time-entries-list/index.ts`, `docs/STAGING-FAKTISK-KOD-DIFF-2026-11-22.md` (ny), `docs/INSTALLATIONSPLAN-STAGING-2026-11-22.md` (ny) |

**RÄTTELSE av tidigare felaktigt påstående i denna fil (2026-11-20):** föregående version av denna punkt påstod att `ServiceIntervalService.runDailyCheck()` "anropas ALDRIG någonstans i kodbasen" — FELAKTIGT. Den sökningen var av misstag begränsad till `src/`-mappen och missade `index.html`:s egen inline-`<script>`, där `App.showApp()` (rad ~636-639) FAKTISKT anropar `runDailyCheck()` via `setTimeout(...,2000)` VARJE gång en användare loggar in/appen visas. Idempotenskonflikten med `service-monitor` (punkt 42) var alltså INTE en hypotetisk, framtida risk — det var en REDAN AKTIV bugg: varje inloggning kunde tysta service-monitors riktiga push-notis för en förfallen period, redan innan funktionen ens deployats. **ÅTGÄRDAT (punkt 134 nedan)**, inte längre öppet.

**Nytt fynd, ej åtgärdat (lägre allvarlighet, ej brådskande):** `service-monitor`/index.ts:s egen skrivning tillbaka till `vift_properties`/`vift_workOrders` (rad ~303–319) är ett olåst läs-ändra-skriv av hela blobben, samma mönster som punkt 130 ovan rättar för klientvägen — men körs bara en gång dagligen via cron och är ännu inte deployad, så prioriteras lägre. Bör ges samma atomiska-RPC-behandling före produktionsdeploy om det är praktiskt genomförbart.

### Platshållare — väntar på specifikation (ingen spår hittad i detta repo)

Följande två områden efterfrågades uttryckligen som "tidigare beslutade utvecklingsområden" som ska finnas kvar i masterplanen. En grundlig sökning i hela detta repo (kod + samtliga `docs/*.md`) denna session hittade INGEN tidigare specifikation, kod eller dokumentation för dem — de finns sannolikt bara i en extern ChatGPT-konversation som aldrig synkroniserats hit. Registrerade här som uttryckliga platshållare, INTE uppfunna/gissade specifikationer:

| # | Funktion | Status | Prioritet |
|---|----------|--------|-----------|
| 132 | AI-arbetsorderinkorg — ingen specifikation hittad i detta repo. Kräver en konkret kravbeskrivning (vad ska AI:n göra: triagera inkommande ärenden? Föreslå arbetsorder-fält? Från vilken källa — e-post, formulär, chatt?) innan den kan planeras eller byggas. | **Ej påbörjad** · Specifikation saknas · *tidigare: EJ PÅBÖRJAD — väntar på specifikation* | Okänd — ange vid nästa tillfälle |
| 133 | Integrationer (externa system) — ingen specifikation hittad i detta repo (vilka system — bokföring, kalender, e-post, annat? Vilken riktning — import, export, realtid?). | **Ej påbörjad** · Specifikation saknas · *tidigare: EJ PÅBÖRJAD — väntar på specifikation* | Okänd — ange vid nästa tillfälle |

---

## Leverans H — En kodbas, säker skrivväg och molnstämpling (2026-11-23)

Bakgrund: `docs/STAGING-AO-TID-SKRIVVAG-BLOCKERARE-2026-11-22.md`. Branchen visade sig vara en äldre kodlinje än den deployade STAGING-klienten; STAGING-klienten är nu baslinje (detaljer: `docs/KODBAS-STAGING-BASLINJE-2026-11-23.md`). Installationsläge per del: `docs/INSTALLATIONSPLAN-STAGING-2026-11-22.md` (uppdaterad 2026-11-23). "BYGGD" nedan = kodklart och lokalt testat, **inte** installerat eller verifierat i STAGING. *(Gällde 2026-11-23. Aktuell nivå per punkt: se statuscellen, uppdaterad 2026-11-26.)*

| # | Funktion | Status | Commit |
|---|----------|--------|--------|
| 140 | En kodbas: deployad STAGING-klient som baslinje med LIVE-miljööverlägg; miljöskyddstest | **Verifierad i STAGING** · [T] `env_overlay_guard`; [S] rätt projekt i STAGING vid v2 och v3.4 · *tidigare: KLAR i repo (inte en driftsättning)* | 56a943d |
| 141 | AO/tid: inget "sparat" före serverns ACK; nekad ändring återställs (manuell tid, radering, arkiv/papperskorg/permanent radering, prissättning); centralt besked + omläsning när fire-and-forget-ändringar nekas; massändringar rapporterar definitiva avslag | **Verifierad i STAGING** · [S] F5 (aldrig "sparad" offline), F3 · *tidigare: BYGGD — 34 lokala kontroller* | f94f131, c4e8436 |
| 142 | Molnbaserad instämpling på befintlig `stamp_status`: uppdatering mellan enheter (flikfokus + var 90:e s), en tidpost per pass vid utstämpling från två enheter, omladdningssäker utstämpling via varaktig intent | **Verifierad i STAGING** · [S] F3, GO-3 G6 (1 tidpost) · *tidigare: BYGGD — 28 lokala kontroller; VÄNTAR PÅ STAGING-test av serverns idempotens (G6)* | 7868335 |
| 143 | Skrivtimeout (20 s) på alla skrivvägar, även ao-time-write; timeout = osäkert utfall, aldrig "sparat" | **Verifierad i STAGING** · [S] F5; [T] `write_timeout` · *tidigare: BYGGD — 22 kontroller* | 37fc1ca |
| 144 | AO-loggbilder i Storage portade till baslinjen; ACK-styrd sparning/radering; föräldralösa filer städas bara när inget annat väntar | **Verifierad i STAGING** · [S] GO-8b, F6.18 · *tidigare: BYGGD — 22 kontroller; kräver bucket + 3 EF (separat GO)* | 0eae23e |
| 145 | Säker rendering av inbäddade bilder (stored XSS via `src=`) i AO-logg, checklista, rondering; avvikelsebilder komprimeras 900px/JPEG 0.75 | **Verifierad i STAGING** · [S] X1 (4 roller, 91 sidvisningar); [T] XSS-01 · *tidigare: BYGGD* | 0eae23e |
| 146 | Serviceintervall: idempotensnycklar portade + skydd mot dubbel Att göra vid övergången; översiktssidan portad och registrerad i `PAGE_PERMISSIONS`; döda modalknappar lagade | **Simulerat testad** · [T] 36 kontroller, SVC-UI-01; inget flöde mot STAGING · *tidigare: BYGGD — 36 kontroller (datumgränser, skottår, pausning)* | 30bd21c |
| 147 | Kundsidans offerttotal räknas med CRM:ets `OfferCalc` (22 av 120 slumpade offerter skilde före, bl.a. negativt "att betala") | **Verifierad i STAGING** · [T] 120/120 i riktig webbläsare; [S] F6.10 · *tidigare: BYGGD — 120/120 i riktig webbläsare* | 423f9f0 |
| 148 | Faktureringskö: visat belopp för tid = fakturerat belopp | **Verifierad i STAGING** · [S] F6.21 · *tidigare: BYGGD — 23 kontroller* | 14d62df |
| 149 | Automatisk testsvit i repot (`tests/`, `bash tests/run-all.sh`) + lokal WAL-mätning (`tests/perf/`) | **Byggd (i bruk)** · [T] `run-all.sh` 15/19 gröna, 4 överhoppade (PostgreSQL saknas) · *tidigare: KLAR* | flera |
| 150 | Aktivitetslogg som egen tabell (en rad per händelse) i stället för en 500-posters JSONB-rad: uppmätt 40,3 → 0,4 kB WAL per åtgärd | **Ej påbörjad** · Planerad · *tidigare: PLANERAD — kräver migration + store-key-write-ändring (G4)* | — |
| 151 | `append_log`/`remove_log` i ao-time-write så samtidiga loggposter från två enheter inte skriver över varandra (G5) | **Verifierad i STAGING (genom ersättning, 196)** · Löst via 196: [S] GO-7 11/11, F4 · *tidigare: BLOCKERAD — backendkälla saknas i repot (G4)* | — |
| 152 | Historisk bildmigrering ur `vift_workOrders` (G7): varje AO-ändring är ~46× dyrare i WAL så länge inbäddade bilder finns kvar | **Ej påbörjad** · Planerad; kräver egen plan och GO · *tidigare: PLANERAD — egen plan + backup + GO* | — |
| 153 | Prisintegrationer Solar och Ahlsell (kundunika nettopriser, artikelnummer, prisdatum, uppdateringar). Alltid åtskilt: leverantörens inköpspris, vårt kundpris, påslag, moms, historiskt överenskomna villkor; kundspecifika påslag aldrig globalt. Första kostnadsfria steg att utreda: artikelprisimport via CSV/XLSX med befintlig importmotor | **Ej påbörjad** · Planerad; första steg CSV-prisimport · *tidigare: PLANERAD — inga API-anrop utan avtal/credentials* | — |

Statusändringar för äldre punkter (identifierare behålls):
- **130** (diff-aware `persist()`): ÖVERSPELAD av STAGING-klientens per-nyckel-diff med per-element trevägsmerge (starkare). Branchens version är ersatt.
- **131/134/137/138** (bilder i Storage, säker radering, server-verifierad åtkomst): kvar; klientdelen portad till baslinjen (punkt 144).
- **135** (tidpostfilter i klienten): ersatt av STAGING:s `TimeEntriesReadService` v2 + RESTRICTIVE-policy.
- **136** (idempotenskonflikt serviceintervall): fanns kvar i STAGING-klienten; portad (punkt 146).
- **133** (Integrationer): Bokio och Momentum kvarstår som framtida integrationsområden; AI-arbetsorderinkorg (132) kvarstår. Ingen specifikation hittad — inget arbetsflöde uppfunnet.

## Leverans I — Fullständigt webbläsartest av hela systemet (2026-11-23)

Rapport: `docs/E2E-RAPPORT-2026-11-23.md`. Svit: `node tests/e2e/run.js` (Chromium mot simulerad backend; se `tests/e2e/README.md`). "BYGGD" = kodklart och testat i webbläsare mot simulerad backend, **inte** installerat eller verifierat i STAGING. *(Gällde 2026-11-23. Aktuell nivå per punkt: se statuscellen, uppdaterad 2026-11-26.)* Varje rättning har ett regressionstest som underkänns mot föregående kod.

| # | Funktion / rättning | Status | Test | Commit |
|---|---|---|---|---|
| 154 | E2E-svit: 32 moduler, 8 kritiska arbetsflöden, 5 skärmstorlekar, felinjektion, två enheter/användare, rapport + skärmbilder | **Byggd (i bruk)** · [T] 216/218 (0 misslyckade) 2026-11-26 · *tidigare: KLAR* | alla | 0a664b3 m.fl. |
| 155 | Verktygsrader klipptes av på mobil; osanerade sökvärden | **Simulerat testad** · [T] RESP-*, PAGES-01 · *tidigare: BYGGD* | RESP-*, PAGES-01 | 0a664b3 |
| 156 | Portkod läckte via fastighetslistans formulär och återkommande ärenden | **Verifierad i STAGING** · [S] c5-read; [T] PROP-01/02 · *tidigare: BYGGD* | PROP-01/02 | 07810e9 |
| 157 | Dubbel AO-skrivning vid geokodning | **Simulerat testad** · [T] AO-09 · *tidigare: BYGGD* | AO-09 | 07810e9 |
| 158 | Osynkad tid tappades / skickades i fel namn vid användarbyte (utkorg per användare) | **Simulerat testad** · [T] TIME-05 · *tidigare: BYGGD* | TIME-05 | 76d36df |
| 159 | Rabattfältet i offertguiden visades aldrig för nya offerter | **Simulerat testad** · [T] OFF-03 · *tidigare: BYGGD* | OFF-03 | 2d6cd32 |
| 160 | Serviceintervall: "utförd/tillagd" före serverns svar; dubbelklick; Att göra stängdes före sparning | **Simulerat testad** · [T] SVC-01–03 · *tidigare: BYGGD* | SVC-01..03 | 2fd247c |
| 161 | Offertlänk "återkallad" medan länken fungerade; roller/personal "Sparat" vid serverfel; globalt skyddsnät för äldre sparvägar; toast-timer | **Simulerat testad** · [T] OFF-04, ROLE-02, STAFF-02, ADMIN-01 · *tidigare: BYGGD* | OFF-04, ROLE-02, STAFF-02, ADMIN-01 | 6bf1343 |
| 162 | Rondering: pass skapades för rondering som servern saknade | **Simulerat testad** · [T] RON-01–03 · *tidigare: BYGGD* | RON-01..03 | 2c8fe3b |
| 163 | Återkommande: två AO för samma tillfälle vid dubbelklick | **Simulerat testad** · [T] REC-01 · *tidigare: BYGGD* | REC-01 | 9f00c34 |
| 164 | Exportcentret obrukbart (operatorprioritet); importen sa "slutförd" vid serverfel | **Simulerat testad** · [T] EXP-01, IMP-02 · *tidigare: BYGGD* | EXP-01, IMP-02 | b59afa5 |
| 165 | Rapporter: "Fakturerat" alltid tomt (fält som inte finns); tid kopplades inte till AO | **Simulerat testad** · [T] REP-01 · *tidigare: BYGGD* | REP-01 | 866d912 |
| 166 | Kön skickades inte vid återanslutning; verifieringsläsning utan tidsgräns; osparade ändringar kastades vid användarbyte | **Verifierad i STAGING** · [S] F5; [T] RES-01–04 · *tidigare: BYGGD* | RES-01..04 | 4113390 |
| 167 | Snabbare id-uppslag (AO-lista 2,0 → 0,87 s med 3 000 AO) | **Simulerat testad** · [T] PERF-01 · *tidigare: BYGGD* | PERF-01 | 6d849ac |
| 168 | Faktura-ROT räknades på arbete exkl. moms (offerten inkl. moms) | **Simulerat testad** · [T] ECO-01 · *tidigare: BYGGD* | ECO-01 | 80671b7 |
| 169 | Cachebuster saknades på två stilmallar; statisk kontroll mot STAGING-baslinjen; Service Worker-test | **Verifierad i STAGING** · [S] nivå 0, 0 versionsskillnader; [T] SW-01 · *tidigare: BYGGD* | SW-01, static_checks | 3c663f8 |
| 170 | Fördröjd autofokus flyttade lösenordet till e-postfältet (sporadiskt "inloggning fastnade") | **Simulerat testad** · [T] AUTH-06 · *tidigare: BYGGD* | AUTH-06 | 80847a8 |
| 171 | Läsande STAGING-kontroll (`tests/e2e/staging-readonly.js`) — 11/11 OK | **Verifierad i STAGING** · [S] 11/11 · *tidigare: KLAR* | — | 80847a8 |
| 172 | ROT/RUT från offert följer inte med till fakturan (G10); ekonomirollens AO-statusändring (G9); DataSync pausar vid fokus i sökfält (G11); ~35 äldre sparvägar med tidig "Sparat" (G12) | **Delvis byggd** · G10 → 178 och G12 → 175 klara. G9: [S] ekonomi nekas (403), men serverregeln kräver beslut. G11 är öppen (punkt 246). · *tidigare: PLANERAD — kräver beslut* | — | — |
| 173 | Upprepa E2E-kontrollerna mot STAGING med isolerade testkonton (lista i rapporten §6) | **Delvis byggd** · [S] GO-1, GO-3, GO-9, F6–F8. Rondering, serviceintervall, återkommande, import/export och massåtgärder är inte körda (QA V3 åtgärd 6). · *tidigare: VÄNTAR PÅ GO* | — | — |

Rättelse: uppgiften om ett dubblett-id i STAGING:s `vift_activityLog` (tidigare §2c) var felaktig — verifierat 0 dubbletter. Punkten utgår.

## Leverans J — Stabilisering, UI/UX och releasekandidat (2026-11-23)

Slutrapport: `docs/RELEASEKANDIDAT-2026-11-23.md`. Visuell granskning: `docs/UI-GRANSKNING-2026-11-23.md`. Designstandard: `docs/DESIGNSTANDARD.md`.

**Statuskategorier (gäller denna och kommande leveranser):** **BYGGD** = kod i branchen · **LOKALT TESTAD** = automatiskt test i Chromium mot simulerad backend och/eller enhetstest, underkänns mot föregående kod · **STAGING-VERIFIERAD** = prövad mot riktig STAGING-backend · **LIVE** = driftsatt på crm.viftfast.se. Ingen punkt nedan är STAGING-verifierad eller LIVE. *(Gällde när leveransen registrerades. Efter GO-1–GO-9 och V3.x är många punkter verifierade i STAGING; se statuscellen, uppdaterad 2026-11-26. Ingen är LIVE.)*

| # | Funktion / rättning | Status | Test | Commit |
|---|---|---|---|---|
| 174 | G5: atomisk loggpost — klienten använder `append_log`/`remove_log` när servern stöder det (sondering via `400 unknown_action`), annars som förut | **Verifierad i STAGING** · [S] F4, GO-7 · *tidigare: BYGGD, LOKALT TESTAD. Serverdelen är **förslag** (`supabase/migrations/20261123000001_PROPOSAL_work_order_log_ops.sql` + beskrivning för `ao-time-write` i `docs/G5-APPEND-LOG.md`); kräver G4 + GO* | AO-07B | a707b22 |
| 175 | G12: bekräftad sparning i hela CRM (`confirmPersist`/`commitElementChange`): "Sparar…" → besked först efter serverns ACK, återställning vid avslag, varning för okonverterade vägar | **Delvis byggd** · [T] G12-01. Kvar utan serverbekräftelse: Personal inaktivera, Prisgrupper aktivera/inaktivera, "Ta jobbet" (`REGISTER.md`, `FALTSIDOR.md`); se punkt 247. · *tidigare: BYGGD, LOKALT TESTAD* | G12-01 m.fl. | 6b63267 |
| 176 | Döda dialogknappar: avtal och e-postmallar gick inte att skapa (`Modal.open` ignorerade `ok`) | **Simulerat testad** · [T] MODAL-01 · *tidigare: BYGGD, LOKALT TESTAD* | MODAL-01 | 6b63267 |
| 177 | Bilagornas metadata (namn, beskrivning, synlighet) sparades aldrig; `Modal.confirm` gjorde radering död | **Verifierad i STAGING** · [S] GO-8a 11/11 · *tidigare: BYGGD, LOKALT TESTAD. Kräver deploy av `offer-attachment-upload` (PATCH) — separat GO* | ATT-01/02 | 6b63267, f5d3f78 |
| 178 | G10: ROT/RUT från offert försvinner inte tyst — fakturan visar offertens avdrag, förifyller det, och "Skickad" spärras tills avdraget lagts till eller uttryckligen kontrollerats | **Simulerat testad** · [T] G10-01 · *tidigare: BYGGD, LOKALT TESTAD. Inga antaganden om avdragsrätt* | G10-01 | f5d3f78 |
| 179 | G8: inget negativt "att betala" — `OfferCalc.validate` spärrar sparande/utskick; kundsidan visar varning i stället för totaler och ingen Godkänn | **Simulerat testad** · [T] G8-01, paritet 120 · *tidigare: BYGGD, LOKALT TESTAD (120 offerter i paritetstest)* | G8-01, paritet | f5d3f78 |
| 180 | G13/G9/G6: STAGING-verifiering förberedd. ~~`tests/e2e/staging-authz.js` ("minimala, icke-förändrande anrop")~~ — **rättat 2026-11-23:** anropen kunde ändra `updated_at`/`vift_lastChanged` och en befintlig AO:s `updatedAt`; ersatt av punkt 188 | **Verifierad i STAGING** · [S] GO-3: G13 36/36, G9 nekad, G6 1 tidpost. Täckningen för G13 är delvis, se punkt 243. · *tidigare: FÖRBEREDD — EJ KÖRD (kräver GO + testkonton)* | — | f5d3f78 |
| 181 | Karta: flera AO på samma adress = en markör med antal och lista; olika adresser grupperas aldrig; nära platser sprids; räknare för jobb/platser/ej placerade | **Simulerat testad** · [T] MAP-01 och `map_grouping` (9). I STAGING placeras 0 av 205 jobb (0 koordinater, troligen domänlåst Mapbox-token). · *tidigare: BYGGD, LOKALT TESTAD* | MAP-01, map_grouping (9) | 88b5f36 |
| 182 | Kalender: överlappande händelser sida vid sida | **Simulerat testad** · [T] CAL-02 · *tidigare: BYGGD, LOKALT TESTAD* | CAL-02 | 88b5f36 |
| 183 | Designstandard (tokens för typografi/avstånd/kontrollhöjd, knapphierarki, `.bdg`, `kv`, filterhöjd, 12 px formulärrytm, fokusring, ordvalet "Stämpla in/ut") + rättningar i 10 vyer | **Byggd (dokument/leverans)** · [D] visuellt granskad; vidareförd i `V3-KOMPONENTSTANDARD.md` · *tidigare: BYGGD, visuellt granskad (se granskningsnivå per vy)* | RESP-*, visuell jämförelse | 88b5f36 |
| 184 | UI som återstår: "klocka"/"inklockad" kvar i ~10 toast-/felmeddelanden och Dagens drift, instabil ordning i AO-listan vid lika sorteringsnyckel, dashboard-rubrik/widgethöjder, AO-radhöjd, fastighetskortets kapade flik och dubblerade "Snabböversikt", offertguidens fälthöjder, admin/avvikelser etikett-värde, fastighetslistans tomläge utan förklaring, "Välj alla" i tom lista, ~1 300 inline-`font-size`, tomläge serviceintervall | **Delvis byggd** · Fastighetskortets flikar (F-06) och flera tomlägen är rättade i nattkörningen. "Klocka"-texter, inline `font-size` m.m.: Källa saknas. · *tidigare: PLANERAD* | — | — |
| 185 | Slutkontrollens visuella regressioner (mobil): `kv` staplade rader (säljkort ~20 % högre); kapad rubrik i fastighetskortets åtgärdsrad; "Redo fakturering" fyllt chip | **Simulerat testad** · [T] UI-KV-01, UI-PROP-01, UI-BDG-01 · *tidigare: BYGGD, LOKALT TESTAD, visuellt granskad före/efter* | UI-KV-01, UI-PROP-01, UI-BDG-01 | (denna commit) |
| 186 | Checklista på arbetsorder med tre statuslägen: Ej påbörjad / Pågående / Utförd (+ befintlig Avvikelse). "Påbörja" per punkt, flera pågående samtidigt, vem/när för påbörjad, utförd och avvikelse, historik per punkt (20 senaste), progressindikator som skiljer utförda/pågående/avvikelser (AO-detalj, AO-lista, Mina jobb). **Beslut Lucas 2026-11-23:** checklistan startar/stoppar aldrig AO:n (R1-autostarten tas bort); egen åtgärd återställs med ao_checklist, annans eller äldre punkt utan "vem" kräver ao_edit — kontrollerat i RPC:n. Bygger på befintlig `work-order-checklist-resolve` + RPC (atomiskt per punkt-id, radlås); lägg till/ta bort går samma väg. Klienten sonderar serverstödet; mot dagens server visas checklistan som förut (ingen Påbörja) | **Verifierad i STAGING** · [S] GO-5 8/8, F2, F6.17 · *tidigare: BYGGD, LOKALT TESTAD (SQL mot riktig PostgreSQL 32/32; E2E CHK-02..07). Migration `20261123000002_work_order_checklist_progress.sql` + EF **EJ installerade** — kräver GO* | CHK-02..07, `checklist_progress_sql` | (denna commit) |
| 187 | Synk mellan enheter: en annan enhets AO-ändring syntes inte förrän nästa omritning (AO-hämtningen i DataSync blev klar efter sidans omritning) — ritas nu om när hämtningen tillämpats | **Verifierad i STAGING** · [T] SYNC-AO-01; [S] F6.11b · *tidigare: BYGGD, LOKALT TESTAD* | SYNC-AO-01 | (denna commit) |
| 188 | STAGING-testverktyg i tre nivåer: 0 `staging-readonly.js` (oinloggad, inga skrivningar), 1 `tests/staging/authz-read.js` (inloggad läsning; auth-poster skrivs, inga affärsdata; självkontroll), 2 `tests/staging/authz-mutation.js` (mutationstest med egna märkta testposter `E2E-AUTHZ-…`, journal före varje mutation, ögonblicksbild före/efter, alltid städning, `--torrkorning`, `--stada=<runId>`, utgångskoder 0/1/2/3/4). Miljöspärrar före första anropet: `--jag-har-go`, `--bekrafta-projekt=<ref>`, LIVE nekas, testkontomönster, nivå 2 även `--mutationstest` + `VIFT_MILJO=staging`. Ingen no-op-patch på befintlig AO | **Verifierad i STAGING** · [S] körda (GO-3, GO-9) · *tidigare: BYGGD, LOKALT TESTAD (40/40 mot simulerad server via lokal HTTP); **EJ KÖRD i STAGING** — kräver GO. **Korrigerat 2026-11-23 (sist):** checklist-sonderingen flyttad från nivå 1 till nivå 2; nivå 1–2 låsta till det godkända STAGING-projektet (hash); återställning utgår från journalen med efterkontroll (aldrig "återställt" utan efterkontroll, `--stada` återupptar); kvarvarande metadata redovisas separat från affärsposter; G13 redovisas som DELVIS prövad* | `staging_tools` | (denna commit) |
| 189 | STAGING-publiceringsväg verifierad: `staging-crm.viftfast.se` ligger på **Loopia** (inte GitHub Pages) och motsvarar STAGING-repots `chatgpt/staging-all-blockers-2026-11-17` (`26ce058`). Paket byggs med `tools/build-staging-package.sh` (grund = publicerad version, STAGING-överlägg via trevägssammanslagning, spärr mot LIVE-referenser) och efterkontrolleras med `tools/verify-staging-deploy.sh` (SHA-256 mot det Loopia levererar). E2E-sviten kan köras mot paketet (`VIFT_E2E_ROOT`/`VIFT_E2E_SUPA`; anrop till annan Supabase-adress underkänner) | **Verifierad i STAGING** · [S] v2 47/47, v3.4 40/40 · *tidigare: BYGGD; paket LOKALT TESTAT (109 tester, 107 godkända, 0 misslyckade); **EJ PUBLICERAT** — uppladdning kräver GO + FileZilla (Lucas)* | E2E mot paket | d61e14d |
| 190 | Rättat: fältarbetare fick varning "servern bekräftade inte … (aktivitetslogg)" efter varje åtgärd mot STAGING:s regel (`vift_activityLog` kräver admin_manage i store-key-write v3) — aktivitetsloggen undantas från varningen | **Verifierad i STAGING** · [T] STG-01; [S] GO-6 · *tidigare: BYGGD, LOKALT TESTAD (STG-01 mot STAGING:s nyckelregler)* | STG-01 | d61e14d |
| 191 | Rättat: AO-loggposter fick id `prefix+Date.now()` — två enheter under samma millisekund fick samma id och servern behöll bara den ena trots "sparad" (även stämpelnoteringar). Ny `newEntryId()` | **Verifierad i STAGING** · [S] F4; [T] AO-07C · *tidigare: BYGGD, LOKALT TESTAD* | AO-07C | d61e14d |
| 192 | Fynd (serverregel, ej klientfel): STAGING:s store-key-write v3 kräver `admin_manage` för `vift_activities` — fältarbetare, ekonomi och arbetsledare kan inte skapa eller klarmarka uppgifter (Att göra) i STAGING (E2E TASK-01 underkänns mot STAGING:s regler). Kräver beslut: per-post-regel (egna uppgifter) på servern | **Verifierad i STAGING (genom ersättning, 194)** · Löst via 194 ([S] GO-6 19/19) · *tidigare: PLANERAD — kräver beslut och serverändring* | TASK-01 (strikt läge) | — |
| 193 | Saknas i STAGING: `offer-public-pdf` (kundsidans PDF; ny i klienten — tydligt fel utan deploy, installationsplan §2h) och `project-document-upload`/`-url` (projektdokument; saknas även för nuvarande STAGING-klient) | **Verifierad i STAGING** · [S] GO-8c 9/9, GO-8d 13/13 · *tidigare: PLANERAD — deploy kräver GO* | — | — |
| 194 | TASK-01 rättat på servern: per-post-regel för `vift_activities` i store-key-write (ansvarig klarmarkerar/öppnar/flyttar datum på egen tilldelad uppgift; skapare ändrar egen; ny/radering bara egen; arbetsledare ao_edit+ao_view_all och admin fullt; bedöms på `previous` som RPC:n verifierar). Installerad store-key-write v3-källa införd i repot (G4 delvis) | **Verifierad i STAGING** · [S] GO-6 19/19 (`store-key-write` v4, nu v5) · *tidigare: BYGGD, LOKALT TESTAD (policy 26/26 mot riktig TS; E2E TASK-01 + TASK-02 mot STAGING-regler efter installation); **kräver GO** (installationsplan §2i)* | edge_policies, TASK-02 | 5b239b8, 432f191 |
| 195 | Aktivitetsflöde (KLIENTRAPPORTERAT — avgränsat 2026-11-25: posterna märks `source: 'klientrapport'`, `verifiedFields: ['userId','timestamp']`; referenser bara i id-format; högst 60/min per användare) och append-only: `appendActivity` (typ-allowlist, userId/tid ur JWT, längdgränser), RPC `activity_log_append` (atomisk, idempotent, kapad 500); generisk skrivning av vift_activityLog nekas; klienten skickar en post i taget via utkorg. Ersätter i praktiken punkt 150:s syfte för säkerheten (egen tabell kvarstår som kostnadsförbättring) | **Verifierad i STAGING** · [S] GO-6. Klientrapporterat och inget revisionsbevis (se 200). · *tidigare: BYGGD, LOKALT TESTAD (SQL 5/5 mot PostgreSQL, ACT-01); **kräver GO** (§2i)* | server_rpcs_sql, ACT-01 | 432f191, cfdf6a0 |
| 196 | G5 serverdel klar: ny EF `work-order-log-write` + RPC:er (radlås, idempotent omsändning, id_collision, staffId-stämpel, borttagning egen/ao_edit, inga andra AO-fält). ao-time-write oförändrad — G4 blockerar inte längre G5. Klientens utkorg routar loggåtgärder dit (404 = gamla vägen) | **Verifierad i STAGING** · [S] GO-7 11/11, F4 · *tidigare: BYGGD, LOKALT TESTAD (SQL 12/12 inkl. samtidighet; E2E AO-07/07B/07C/07D och LOG-01..05 på båda vägarna); **kräver GO** (§2j)* | server_rpcs_sql, AO-07D | 432f191, cfdf6a0 |
| 197 | Testverktyg för riktig STAGING: `tests/staging/e2e-real.js` (R0 sidor per roll, F2 checklista, F3 stämpling två enheter, F4 samtidiga loggposter, F5 nätavbrott) via E2E-bibliotekets riktiga läge (spärrnyckel, godkänt STAGING-projekt, annat Supabase-projekt underkänner). Ekonomikedjan som manuella testfall | **Verifierad i STAGING** · [S] körd (R0, F2–F8) · *tidigare: BYGGD, LOKALT TESTAD (15/15 mot paketet + simulerad server); **ej körd mot STAGING*** | staging_e2e_real | bc8891c |
| 198 | Publiceringspaket v2 (47 filer) + MANIFEST-v2 + återställningsmanifest (verifierat 44/44 mot det STAGING levererar idag); v1 märkt ERSATT; WinSCP-instruktion; backup-SQL (del A läsande, B kräver GO, C efterkontroll); bildbucket som migrationsfil (20261124000003) | **Verifierad i STAGING** · [S] 47/47 · *tidigare: KLART för uppladdning efter GO* | verify-staging-deploy | 09d1129 + release 90fa360 |
| 199 | Kvar efter denna omgång: ekonomikedjan automatiserad mot riktig server; `ao-time-write`-källan i repot (granskning/återskapbarhet); typdefinitionsvarning `crypto.subtle.digest` i offer-attachment-upload/project-document-upload (körs korrekt i Deno) | **Delvis byggd** · Ekonomikedjan automatiserad ([S] F6). `ao-time-write` finns i `vift-v2` (16946d1). Typvarningen: Källa saknas. · *tidigare: PLANERAD* | — | — |
| 200 | Verifierad revisionslogg (affärshändelser skrivna av de skrivande RPC:erna i samma transaktion som ändringen — ao-time-write, invoice-write, store-key-write m.fl.). Aktivitetsflödet (195) verifierar bara vem och när, inte att händelsen inträffat, och ska inte användas som revisionsbevis | **Ej påbörjad** · Planerad · *tidigare: PLANERAD — kvarstående gap* | — | — |
| 201 | Nivå 2-verktygen delar `tests/staging/recovery.js` (utbruten ur authz-mutation utan ändrad logik): journal före mutation, städning från journal även vid nätfel/avbrott, efterkontroll, spärrfil som blockerar alla nivå 2-körningar tills `--stada` efterkontrollerat, ändrade befintliga poster = kod 4 (aldrig godkänt). e2e-real har samma återhämtning som authz-mutation | **Verifierad i STAGING** · [T] 40/40, 26/26; [S] använd i körningar · *tidigare: BYGGD, LOKALT TESTAD (staging_tools 40/40, staging_e2e_real 26/26 inkl. nätfel, misslyckad städning, ändrad post, avbrott)* | staging_e2e_real | (denna commit) |
| 202 | **Releasekandidat FRUSEN 2026-11-25**: klient = paket v2 (källa 09d1129, oförändrad); server = migrationer 20261123000002, 20261124000001–3 + EF store-key-write, work-order-log-write, work-order-checklist-resolve m.fl.; testverktyg nivå 0–2. Nästa steg = GO-1/GO-2/GO-4 enligt installationsplan §6 | **Byggd (dokument/leverans)** · [D] genomförd; ersatt av v3.x · *tidigare: FRUSEN — väntar på GO* | — | — |
| 203 | **STAGING-klient publicerad och verifierad 2026-11-25** (paket v2; v1 laddades först upp av misstag och kompletterades med 4 filer): 47/47 SHA-256 mot det Loopia levererar, nivå 0 11/11 (0 versionsskillnader mot repot), rätt projekt (inte LIVE), STAGING-etikett, inloggning, 85 resurser utan fel, nya klientfunktioner laddade | **Verifierad i STAGING** · [S] 47/47, nivå 0 11/11 · *tidigare: **STAGING-VERIFIERAD (klientleverans)** — funktioner bakom inloggning ännu inte STAGING-testade (kräver GO-1/GO-9); serverändringar ej installerade* | verify-staging-deploy, staging-readonly | — |
| 204 | **V3 (gren `claude/vift-v3-major-redesign`, ej publicerad)** — designsystem `src/styles/system.css` + `src/components/UiKit.js` (palett, knappar, kort, flikar, statusmärken med punkt, kategorietikett, formulär, dialoger, tabell, chips, avatarer, tomma lägen); dokumenterat i `docs/DESIGNSTANDARD.md` (avsnitt V3). | **Verifierad i STAGING** · [S] publicerad (v3 → v3.4), R0, A1 · *tidigare: Klar (lokalt testad)* |
| 205 | V3 arbetsorderlista: tabell (uppdrag, kund och plats, planerat, personal, checklista, status, fakturering), antal per statusflik, snabbfilter Mina/Idag/Försenade/Akuta/Otilldelade/Att fakturera, sortering, kompakta kort på mobil, stegvis visning (150 + 300) för stora listor. | **Verifierad i STAGING** · [S] R0, F6; [T] AOL-01–09 · *tidigare: Klar (lokalt testad)* |
| 206 | V3 arbetsorderdetalj: vad/var/när/vem i sidhuvudet, Nästa steg (`WorkOrderService.nextStep`), huvudspalt + sidospalt (Var, När, Vem, Kund och kontakt, Detaljer, Fakturering), mobil i fältordning; alla befintliga funktioner och id:n kvar. | **Verifierad i STAGING** · [S] F6 via UI; [T] AOD-01–09 · *tidigare: Klar (lokalt testad)* |
| 207 | V3 dashboard: dagens tavla (klickbara nyckeltal med samma definitioner som listan, dagens schema, personal idag); dubblerade widgetar dolda i standardlayout; tunga sektioner hopfällda på mobil. Mina jobb: vägbeskrivning/ring direkt på kortet. Säljchanser: kompakta kort. Fakturakö, registerlistor, dokumenthuvuden i nya stilen. | **Verifierad i STAGING** · [S] R0; [T] DASH-E, FALT · *tidigare: Klar (lokalt testad)* |
| 208 | V3 rättade fel (regressionstester): "försenad" en definition (`isOverdue`) — AO-listan räknade klara ordrar; `tdy()`/`_ds()` gav gårdagens datum 00–01 (UTC) → lokalt datum (`tests/local_date.test.js`), även export/rapport/offert-datum; manuell tid med AO men utan kund sparades utan kund (E2E TIME-07); säljkort escapade inte titel/åtgärd/tips/kund. | **Simulerat testad** · [T] `local_date`, TIME-07 · *tidigare: Klar (lokalt testad)* |
| 209 | **V3 omgång 2 (efter extern granskning)**: mobil AO-lista (statusrullista, radbrutna snabbfilter, kompakta kort) och AO-detalj (fältkort, fast snabbåtgärdsrad stämpla/checklista/material/foto, fältordning, surfplatteordning); AO-tabellens rubrikfel (klassen .dt krockade med dashboardens .dt → .dtab), tvåradstitlar, akut visas en gång; dashboardens rollstandard utan dubbletter, fyllda rader, lika höjd, Kräver åtgärd utan upprepning; ljusa dokumenthuvuden för faktura och offert, kompakt fakturakö; kontrast (faint 2,97 → 4,69:1, info 4,28 → 5,34:1). Mätverktyg tests/e2e/measure.js. | **Verifierad i STAGING** · [T] DASH-M-01 m.fl.; [S] publicerad · *tidigare: Klar (lokalt testad)* |
| 210 | **V3 slutpolering (avslutar V3:s designarbete)**: mobildashboard kompakt (Kräver åtgärd direkt efter nyckeltalen, Visa fler/Visa karta, inga sparade inställningar ändras); snabbåtgärdsraden verifierad på 360/390/768/1024 px inkl. instämplad, sidans slut, dialog och tangentbord; offertdetaljen utan upprepad kund/status/belopp/giltighet; fakturaunderlagets statusväljare får plats och tillbakaknappen syns (var vit på ljust huvud); fakturakön med AO-kort, nivåindrag och delvis markerade grupper, oförändrad urvalslogik | **Verifierad i STAGING** · [T] QBAR-01, ECO-V3-01/02; [S] publicerad · *tidigare: Klar (simulerad server, ej publicerad)* | QBAR-01, ECO-V3-01, ECO-V3-02, DASH-M-01 | gren `claude/vift-v3-major-redesign` |

Statusändringar för äldre punkter (identifierare behålls):
- **151** (G5): från BLOCKERAD till **klient BYGGD** (punkt 174); serverdelen **BYGGD 2026-11-24 som egen EF** (punkt 196) — inte längre blockerad av G4.
- **192** (TASK-01): serverrättning BYGGD (punkt 194), kräver GO.
- **193** (saknade EF:er): `offer-public-pdf` (§2h) och projektdokument (§2k) förberedda för GO.
- **AO-CHECKLIST-AUTOSTART R1/R1.1/R1.2** (checklistpunkt OK/avvikelse startar ostartad AO): **ÄNDRAT genom beslut 2026-11-23** — autostarten tas bort i migration 20261123000002 (punkt 186). Gäller i STAGING/LIVE först när migrationen installerats; till dess beter sig servern som förut. Den atomiska vägen (R1.2/R1.3) behålls och byggs vidare på.
- **172**: G10 → punkt 178, G12 → punkt 175, G9 → förberedd (punkt 180). **G11** (DataSync pausar vid fokus i sökfält) kvarstår PLANERAD.
- **173**: oförändrad, VÄNTAR PÅ GO; testlistan är utökad med nivå 1–2-verktygen (punkt 188; `staging-authz.js` är ersatt).

Tidigare beslutade framtida områden finns kvar oförändrade och byggs inte nu: teknisk underhållsplanering (`ROADMAP-UNDERHALL-2026-10-23`), integrationer (133: Bokio, Momentum), artikelpriser/prisintegrationer (153: Solar, Ahlsell), AI-arbetsorderinkorg (132).

## Leverans K — STAGING-installation, QA och V3.x (genomfört 2026-11-24–26)

**Källor:**
- `docs/qa-2026-11-24/QA-RAPPORT-V3-SLUTTEST.md` (C-1–C-8);
- `docs/qa-2026-11-25/QA-RAPPORT-2026-11-25.md` och `C5-LASBEHORIGHET.md`;
- `docs/qa-2026-11-26/SLUTRAPPORT-NATTKORNING.md` med blockdokument;
- `vift-v2/docs/INSTALLATIONSPLAN-STAGING-2026-11-22.md` §6.4c–§6.10;
- `vift-v2` git-logg.

**Ingen punkt här finns i LIVE.** Flera punkter är installationer av redan numrerade punkter. Kolumnen "Relation" pekar på dem, så att inget räknas dubbelt i sak.

| # | Funktion / genomfört | Status | Källa / commit | Relation |
|---|---|---|---|---|
| 211 | **C-1 (P0):** fältpersonalens material sparades aldrig (403). `ao-time-write` v5: `ao_material` får patcha exakt `materials` på en synlig AO. | **Verifierad i STAGING** · [S] qa-ao-material 17/17, F6.16 | QA V3 C-1; `vift-v2` 16946d1 | 10, 241 |
| 212 | **C-2 (P1):** "Starta" (Mina jobb) och "Ta jobbet" (arbetspool) misslyckades för fältrollen. Nu tillåtet på egen AO från rätt status; "Ta jobbet" bara för sig själv. | **Verifierad i STAGING** · [S] qa-ao-material 17/17 | QA V3 C-2; 16946d1 | 78, Ö1, AP |
| 213 | **C-3 (P0):** lagrad XSS i cirka 180 HTML-sänkor. `esc()` i alla sänkor; levererat i V3.1. | **Verifierad i STAGING** · [S] X1 (4 roller, 91 sidvisningar); [T] XSS-01, RENDER-01 | QA V3 C-3; 098b528 | 145, 230, 237 |
| 214 | **C-4 (P1):** kundens offertsvar syntes inte för personalen. lastChanged-trigger, migration `20261125000002`; dessutom `vift_lastChanged` vid offert- och fakturaändringar. | **Verifierad i STAGING** · [S] F6.11b | QA V3 C-4; 2ad290a | 5, 100 |
| 215 | **C-5:** läsbehörighet per roll. `store_read_by_role` (RESTRICTIVE), `store-key-write` v5 (`readAllWithHashes`/`readWithHash` projiceras), `work-orders-list` v3 (portkod bara till `objects_sensitive`/`ao_edit`), migration `20261125000003`. Kvarstående avvägningar → B1–B5. | **Verifierad i STAGING** · [S] c5-read 26/26; syntetiska värden rätt för 7 roller | `C5-LASBEHORIGHET.md`; e3fca8b, 921d205 | 3, 72, B1–B5, 241 |
| 216 | **Tidposter per person** (BLOCKER-1 i STAGING): `time-entries-list` v3 och RESTRICTIVE-policy. `payroll_view`/`all` ser alla, övriga bara sina egna. | **Verifierad i STAGING** · [S] authz-read, `SAKERHET-DEL10.md` | `PROJECT_STATUS.md` (Läge 2026-11-23) | 135, 241 |
| 217 | **GO-1/GO-1b:** sex E2E-testkonton och testrollerna `e2e_falt`, `e2e_arbetsledare`, `e2e_ekonomi`, `e2e_begransad` | **Verifierad i STAGING** · [S] nivå 1 22 OK | §6.6, §6.9; 3c7b90c, 30830ce | 262 |
| 218 | **GO-2:** backup i STAGING (`vift_staging_backup_20261124`) och extern kopia; återställning provad lokalt | **Verifierad i STAGING** · [S] store 40/40, idempotens 2 146/2 146, funktioner 50/50 | §6.4c; 70ebfc1 | 241 (mönster för LIVE) |
| 219 | **GO-3:** behörighetstest mot riktig server (`authz-mutation`) | **Verifierad i STAGING** · [S] G13 36/36, G9 nekad (403), G6 1 tidpost, 0 säkerhetsavvikelser | §6.7 | 180, 243, 269 |
| 220 | **GO-4:** klient v2 publicerad på STAGING | **Verifierad i STAGING** · [S] 47/47 SHA-256, nivå 0 11/11 | §6.4b; d235e3f | 203 |
| 221 | **GO-5:** checklistans tre lägen installerade (`work-order-checklist-resolve` v2, `work_order_checklist_set_state`) | **Verifierad i STAGING** · [S] 8/8 (J9–J12) | §6.9 | 186 |
| 222 | **GO-6:** `store-key-write` v4 (uppgifter per post, `activity_log_append`) | **Verifierad i STAGING** · [S] 19/19 | §6.9; 3e44ec7 | 194, 195 |
| 223 | **GO-7:** `work-order-log-write` v1 (G5 atomisk) | **Verifierad i STAGING** · [S] 11/11, F4 | §6.9; 3e44ec7 | 151, 174, 196 |
| 224 | **GO-8a:** bilagornas PATCH (`offer-attachment-upload` v13) | **Verifierad i STAGING** · [S] 11/11 | §6.9 | 177 |
| 225 | **GO-8b:** privat bucket `workorder-images` och tre bild-EF:er (CORS `apikey` rättad före deploy) | **Verifierad i STAGING** · [S] 14/14 | §6.9 | 131, 137, 138, 144 |
| 226 | **GO-8c:** `offer-public-pdf` v1, logotyp i privat bucket `vift-branding` | **Verifierad i STAGING** · [S] 9/9 | §6.10; 4719d81 | 193 |
| 227 | **GO-8d:** projektdokument (privat bucket, 3 RPC:er, RESTRICTIVE-policyer, `project-document-url`/`-upload` v1) | **Verifierad i STAGING** · [S] 13/13 | §6.10; 4719d81 | 193 |
| 228 | **GO-9:** `e2e-real` i riktig webbläsare (R0, F2–F5). Rättningar: F3 (stämplingens loggpost via `work-order-log-write`) och F5 (sondering medan nätet finns, senast bekräftat svar sparas) | **Verifierad i STAGING** · [S] R0, F2–F5 gröna | §6.10; a01f38d | 141, 142, 197 |
| 229 | **Testverktygets städning (C-8):** STAGING-only EF `e2e-test-cleanup` v1 och migration `20261125000004`. Spärrar: bara STAGING, kräver `all`, bara `[E2E-TEST]`-poster. **Får aldrig till LIVE.** Den tillfälliga `vift-admin-storage` är avaktiverad (410). | **Verifierad i STAGING** · [S] spärrarna prövade (QA 2026-11-25 §4) | QA 2026-11-25 §4; 1f13324 | 241 (undantas) |
| 230 | **V3 och V3.1:** V3 (21 filer) publicerad 2026-11-24. V3.1 (XSS-rättning C-3, 18 filer) publicerad och verifierad. V3.2 ersatt, aldrig publicerad. | **Verifierad i STAGING** · [S] 21/21, 18/18, X1, R0 | QA V3; 098b528 | 204–210, 213 |
| 231 | **V3.3:** Admin-flikarnas råa SVG (regression efter XSS-rättningen) rättad; färgväljaren skrev hela `vift_settings` vid varje input-händelse, nu en sparning vid change | **Verifierad i STAGING** · [S] A1 dator och mobil; [T] RENDER-01, BRAND-01 | QA 2026-11-25 §2; 39dbe4f | 24, 248 |
| 232 | **V3.4 / nattkörningen 2026-11-26:** 34 av 37 vyer omarbetade; ett hundratal nya tester. Kvar: Ronderingsrapport, Offertlista, Säljchanser; kundkortets brödtext bara delvis. | **Verifierad i STAGING** · [S] 40/40 filer, R0 (6 roller), X1, A1, F2–F8 (F6 28/28), C-5 26/26; [T] 216/218 (0 misslyckade) | `SLUTRAPPORT-NATTKORNING.md`; 4422efa | 30, UX-4 |
| 233 | **IMP-03:** AO-importen gav alla importerade AO samma id när en AO med UUID-id fanns. Nu får varje importerad AO och tidpost ett eget kollisionssäkert id. | **Simulerat testad** · [T] IMP-03. Import är inte prövad mot STAGING; STAGING hade inga sådana dubbletter. | acd8925 | 73, F4-4/5 |
| 234 | **SYNC-ED-01:** synken ritade om offertguiden var 15:e sekund, och osparade ändringar i en befintlig offert försvann. Redigeringsvyer ritas inte längre om. | **Simulerat testad** · [T] SYNC-ED-01 | 33bce1d | 5, 16 |
| 235 | **TIME-08:** stämpling på annan enhet ritade inte om Tid & stämpla och dashboarden (fel sid-id `pg-time`/`pg-dashboard`) | **Simulerat testad** · [T] TIME-08; F3 grön mot STAGING med v3.4 | da94bc8 | 142 |
| 236 | **Serviceintervallets sökfält (SVC-UI-01):** SVG i placeholder bröt fältet, sökningen tappade fokus, korten var mörka i mörkt läge | **Simulerat testad** · [T] SVC-UI-01, RENDER-01; vyn öppnas i publicerad v3.4 | `SLUTRAPPORT-NATTKORNING.md` §4.2 | 34, 146 |
| 237 | **XSS i mallar:** offertlistans titel och fler mallar (kontakter, bildkategori, felmeddelanden, personalnamn, AO-id i onclick, ronderingsmärken) | **Verifierad i STAGING** · [S] X1 mot publicerad v3.4 (4 roller, 91 sidvisningar); [T] XSS-01, RENDER-01 | nattkörningen §4.2, `OVRIGA-SIDOR.md` | 145, 213 |
| 238 | **Nattkörningens säkerhets- och etikettåtgärder:** Inaktivera personal kräver `staff_manage`; "Rensa lokal cache" kräver `admin_manage` och varnar för osynkade ändringar; push-diagnostiken visar inga nycklar; Löneunderlag visar "Debiterbart värde" i stället för "lönekostnad" | **Simulerat testad** · [T] ARP-*, REG-UI-* | nattkörningen §5, `SAKERHET-DEL10.md` | 21, 76, 266 |
| 239 | **Händelse ACT-006/007:** ett skärmbildsskript markerade två STAGING-uppgifter som klara (2026-11-24 22:28–22:29 UTC, konto `e2e-admin`). Återställt med journal, kontrollsumma lika med referens `5b55cf10f640`; skriptet är avstängt. | **Verifierad i STAGING** (återställningen) · [S] md5 | `HANDELSE-ACT-006-007.md`; 84f1ea3 | 7 |
| 240 | **Underlag 2026-11-25/26:** UI-UX-inventering (65 bilder); `SAKERHET-DEL10.md` (B1–B5); `KARTA-UTREDNING.md`; `TESTDATA-INVENTERING.md`; `REFERENSLAGE.md`; händelsen med `vift_settings` (23 skrivningar på 15 s, färgväljaren); `BILDPAKET-INDEX.md`; `MASTERPLAN-STATUS-2026-11-26.md` | **Byggd** (dokument) · [D] | `docs/qa-2026-11-25/`, `docs/qa-2026-11-26/` | 248, 249, 263 |

## Leverans L — Riskregister och kvarstående arbete (registrerat 2026-11-26)

**Källor:**
- `docs/MASTERPLAN-STATUS-2026-11-26.md` §4–§5;
- blockdokumenten i `docs/qa-2026-11-26/`;
- QA V3 C-6/C-7.

Inget här är byggt om inte annat anges.

| # | Funktion / kvarstående | Status | Beroenden | Källa |
|---|---|---|---|---|
| 241 | **LIVE-plan.** Innehåll: fil-diff mellan LIVE och STAGING, backup och återställning per steg, kontroll av RPC-ägarrollen i LIVE. Ordning: grunden först (R9B/Oct18-migrationer och `invoice-write`, `ao-time-write`, RPC:er, RESTRICTIVE-policyer), sedan C-5, lastChanged, GO-5–GO-8 och `time-entries-list`, sist klient v3.x via FTP (Lucas). `e2e-test-cleanup` följer aldrig med. Ställningstagande till G7 (152) på grund av LIVE:s IO-problem. `PLAN-LIVE-RELEASE.md` ("levererad separat 2026-10-25") finns inte i repot: Källa saknas. | **Ej påbörjad** | 242, 243, 244, 245, 250; beslut B1–B5, Ö1–Ö10 och B-FAKT-1; godkännande av Lucas. **2026-11-27:** dessutom alla T3/T4-paket installerade och verifierade i STAGING, SÄK-8 och SÄK-9 stängda (testplanen §9.4), samt hindren i `G1-G4-DEL2-RESULTAT.md` §10: installation i ordningen i `MIGRATIONSORDNING.txt` (R-D-policyerna först när klienten använder EF-vägarna), körning på PG17, `migration repair`/mappning (MIG-1), Vault, secrets och cron per miljö, logotypen i `vift-branding` som separat data | `PROJECT_STATUS.md` LIVE-releaseplan; installationsplan §7 |
| 242 | **G1/G4 – serverkällkod i repot.** Saknas: `work_order_create` och displayNumber-migrationen (`20261020000001`), `invoice-write` (v9) och `rondering-pass-write` (v3). Dessutom ska `20261125000002`–`03`, `ao-time-write` och `work-orders-list` synkas till denna arbetskopia: V3-grenen har 21 migrationer, `vift-v2` har 24. CLAUDE.md påstår att katalogen saknas. **Nästa tekniska huvuduppgift.** *(2026-11-27: allt som räknas upp finns nu i `vift-v2/supabase/`; se status.)* | **Byggd + lokalt verifierad** (2026-11-27; inte STAGING-verifierad) · [T] Källan exakt mot STAGING: 38/38 md5. 25 nya filer i `supabase/migrations/` (rättat 2026-11-28 från "28", se `G1-G4-DEL2-RESULTAT.md` §11): 17 exakta ur STAGING:s migrationshistorik, 3 kandidater för de tomma migrationerna, 5 rekonstruerade (R-A–R-E); dessutom 1 återställd STAGING-only-migration i `staging-only/` och 4 filer flyttade ut (3 PROPOSAL-filer till `forslag-ej-applicerade/`, 1 STAGING-only-migration till `staging-only/`). **2026-11-28 (T3-0):** KÄLLA-1 lokalt genomförd (klientgrenens `supabase/` borttagen, hänvisning + kontroll; inga unika källor fanns). MIG-1 lokalt verifierad: `vift-v2/supabase/MIGRATIONSMAPPNING.md`/`migrationsmappning.json` mappar alla 41 STAGING-versioner (36 installerade, 3 kandidater, 2 STAGING-only; 28/38 exakt md5, 41/41 samma objekt i lokal kedja med applicerad SQL respektive repo-filer), R-A–R-E:s objekt finns redan i STAGING; installationsunderlag `INSTALLATIONSUNDERLAG-MIGRATIONER.md` (ingen `db push`/repair mot STAGING utan beslut). Lokal STAGING-replik och körbara EF-tester finns (`T3-RESULTAT.md`). Migrationskedjan lokalt på PostgreSQL 16.15, både i STAGING-ordning och filnamnsordning: 126 identiska objekt, 7 förklarade avvikelser, 0 oförklarade. `invoice-write` och `rondering-pass-write` återställda. EF-synken (fem funktioner där STAGING var nyare) och den manuella sammanslagningen av `send-push` är **bara syntaxkontrollerade**. `PUBLIC_BASE_URL` har inget reservvärde. STAGING-only separerat i `supabase/staging-only/`. **Säkerhetsfynd:** EXECUTE för `anon`/`authenticated` på `provision_vift_user` (och `deactivate_vift_user`, `check_app_users_health`) återkallades i STAGING utanför migrationerna; en ny installation hade gett rättigheterna. R-E rättar det i källan. · *tidigare: **Delvis byggd** · `ao-time-write`, `store-key-write` och `work-orders-list` finns i `vift-v2`* | Kvarstående hinder enligt `G1-G4-DEL2-RESULTAT.md` §10: ~~beslut om auktoritativ källa (KÄLLA-1)~~ (beslutad och lokalt genomförd 2026-11-28); kandidaterna för de tre tomma migrationerna är inte bevisat historiska; rekonstruerad SQL är inte historisk; EF-ändringarna är otestade i Deno och STAGING; `offer-respond` kräver ny RPC-version (OR-1, OR-2); körning på PG17; Vault, secrets och cron per miljö; off-by-one i AO-nummerseriens backfill (245); logotypen i Storage; ~~`migration repair`/mappning (MIG-1)~~ (mappning lokalt verifierad 2026-11-28; repair/db push mot STAGING kräver fortfarande beslut). *Tidigare: Nedladdning av deployade källor kräver Supabase-åtkomst (Lucas/GO)* | installationsplan §5; `AO-LISTA.md` §4; `vift-v2/supabase/inventering/G1-G4-DEL2-RESULTAT.md`; `vift-v2/supabase/AUKTORITATIV-KALLA.md` |
| 243 | **PERM-03/BLOCKER-2, utökad täckning:** objektformade nycklar (`vift_settings`), ändring och borttagning av befintliga poster, skrivning av hel nyckel, fältnivå | **Delvis byggd** · [S] skapa ny post 36/36 (9 register × 4 roller); [T] PERM-03 **lokalt verifierad** (T3-C, 2026-11-28: avblockerad, körs mot serverns `KEY_PERMISSIONS` ur källan: kunder, offerter, säljchanser, uppgifter, `vift_settings` (hel nyckel) och artiklar per roll, exakt felkod och kontrollsumma); STAGING-delen kvar | 242; säkerhetsomgången; 2026-11-27: lokala sviter i T3-C (`roles_superadmin`, F18) och felkod/kontrollsumma i testverktygen (T3-0); STAGING-delen bara märkta poster efter separat GO | installationsplan §6.7 |
| 244 | **De fyra PostgreSQL-testerna** körs gröna: `checklist_progress_sql`, `server_rpcs_sql`, `staging_backup_export`, `offer_attachment_upload` del 2–3 | **Lokalt verifierad** (2026-11-27, PostgreSQL 16.15) · [T] `checklist_progress_sql` 32/0, `server_rpcs_sql` 17/0, `offer_attachment_upload` 43/0 (alla tre delarna), `staging_backup_export` 12/0. Nya: `rekonstruerade_rpc_sql` 40/0, `public_base_url` 16/0, `edge_functions_syntax` 32/0, `migrationskedja` 2/0. `vift-v2` `run-all` (SKIP_BROWSER=1): 19/20 testfiler gröna; `staging_e2e_real` fallerar likadant före ändringarna, eftersom fake-backend saknar `e2e-test-cleanup` (SÄK-17). **2026-11-28 (T3-0):** `e2e-test-cleanup` modellerad i fake-backend, `staging_e2e_real` 26/0 (testet oförändrat); `vift-v2` `run-all` 24/24 testfiler gröna (599 kontroller, 0 fel). VIFT-CRM:s fyra PostgreSQL-tester läser nu den auktoritativa källan (KÄLLA-1) och är gröna. Playwright hoppades över och räknas inte som godkänt. STAGING kör PostgreSQL 17.6; körning på PG17 återstår före LIVE. · *tidigare: **Byggd** · överhoppade 2026-11-26 (ingen lokal PostgreSQL); tidigare gröna enligt 186, 195 och 196* | Körning på PG17 före LIVE; Playwright-miljö för webbläsartesterna; `e2e-test-cleanup` modelleras i fake-backend. *Tidigare: Miljö med PostgreSQL; säkerhetsomgången* | `SLUTRAPPORT-NATTKORNING.md` §4.1 |
| 245 | **AO-nummergenerator:** unik constraint på `display_number`, serie över högsta nummer, kontroll mot id-nummer. Befintliga nummer ändras inte. STAGING-paret "AO-001" visas redan åtskilt. | **Lokalt verifierad** (T3-B, 2026-11-28): `20261128000003` — nästa nummer = max(sekvens, högsta befintliga AO-nummer + 1) under radlåset, kontroll mot displayNumber och id, ingen avkortning över AO-999, ingen unik index och ingen omnumrering (historiska AO-001 orörda); 10 samtidiga skapanden ger unika nummer. Ej installerad i STAGING · *tidigare: **Ej påbörjad*** | 242; AO-etappen; ska ingå i 241; 2026-11-27: källan finns nu (242). Off-by-one-felet i backfill-steget i `20261020000001` ligger kvar som historisk SQL och är inte rättat för LIVE (`G1-G4-DEL2-RESULTAT.md` §10.8) | `AO-LISTA.md` §4 |
| 246 | **G11:** DataSync pausar medan fokus står i ett sökfält | **Ej påbörjad** (från 172) | Beslut om pollning | E2E-rapport §6 |
| 247 | **G12-rester:** Personal Inaktivera sparar utan serverbekräftelse; Prisgrupper aktivera/inaktivera likaså; "Ta jobbet" visar beskedet före servern | **Delvis** (2026-11-28): Personal Inaktivera/Aktivera väntar på serverns bekräftelse och rullas tillbaka vid avslag (T3-C); "Ta jobbet" väntar på servern (T3-B); Prisgrupper kvar | `WorkOrderService.takeFromPool`; 175; Ö5 | `REGISTER.md` §8, `FALTSIDOR.md` |
| 248 | **`vift_settings` skrivs som helhet** (`BrandingService.update`): samtidiga administratörer kan skriva över varandra. Per-nyckel-skydd behövs. | **Ej påbörjad** | Server/`state.js`; säkerhetsomgången | `ADMIN-RAPPORTER-LON.md` §6.4 |
| 249 | **Kartan:** 0 av 205 aktiva jobb har koordinater. Steg: kontrollera Mapbox-tokenens domän för STAGING; engångsgeokodning med backup och journal; AddressService ska skilja fel från "ingen träff"; AO-importen ska få postnummer och ort. | **Ej påbörjad** | Lucas (Mapbox-kontot) och beslut; 181 | `KARTA-UTREDNING.md`, `DASHBOARD.md` §6 |
| 250 | **`service-monitor`:** atomisk skrivning av `vift_properties`/`vift_workOrders` (i dag läs-ändra-skriv av hela blobben), manuella tester enligt installationsplan §3 och beslut om att aktivera cron | **Delvis lokalt verifierad** (T3-B, 2026-11-28): `service-monitor` skriver förfallodagen i `dueDate` (med personal ingen `scheduledDate`, `poolOpen:false`) och skapar AO bara via atomiska `work_order_create` (kört lokalt i Node). Kvar: atomisk skrivning av `vift_properties`, cron-beslut · *tidigare: **Ej påbörjad*** | 40–43; före 241 | Leverans G "Nytt fynd"; installationsplan §3 |
| 251 | **Tillägg/tilläggsarbete på AO** (datamodell saknas) | **Ej påbörjad** | Produktbeslut | `AO-DETALJ.md` fråga 3 |
| 252 | **AO-bilagor (dokument).** I dag finns bara bilder i loggen. | **Ej påbörjad** | Storage-modell som i GO-8d | `AO-DETALJ.md` fråga 4 |
| 253 | **Avtal (`contractId`) på AO** | **Ej påbörjad** | 81 | `AO-DETALJ.md` fråga 5 |
| 254 | **Fastighetsdokument** | **Ej påbörjad** | Produktbeslut | `OVRIGA-SIDOR.md` §2, §7 |
| 255 | **Automatisk skapning av återkommande AO** (server/cron) | **Ej påbörjad** | 19; mönstret från 250 | `FALTSIDOR.md` |
| 256 | **Andras stämplingsstatus i Dagens drift** | **Ej påbörjad** | Serverstöd och behörighetsbeslut | `FALTSIDOR.md` |
| 257 | **Synk av dashboardlayout mellan enheter** (serverlagrad) | **Ej påbörjad** | Produktbeslut; UX-7 | `DASHBOARD.md` §6 |
| 258 | **Serverlagrade logotyper** (i dag bara localStorage) | **Ej påbörjad** | Beslut om lagring | `ADMIN-RAPPORTER-LON.md` §6.5 |
| 259 | **Eget fakturadatumfält** (i dag samma som skapandedatum) | **Ej påbörjad** | `invoice-write` (242) | `FAKTURERING.md` |
| 260 | **UI-rester:** tryckytor 36–38 px under kravet 40 px på mobil; F-12 "Om 1 dagar"; F-02 ikoner på egen rad globalt (`reset.css`); V3 ignorerar `--brand-primary-text`, så ljusa varumärkesfärger blir oläsliga; sidomenyns rubriker har 3,4:1 i kontrast | **Ej påbörjad** | UX-etappen; 184 | `FALTSIDOR.md`, `OVRIGA-SIDOR.md`, `ADMIN-RAPPORTER-LON.md` |
| 261 | **Test av stämpling över sommartidsövergången** | **Lokalt verifierad på servern** (T3-B, 2026-11-28): pass över sommartidsomställningen och över midnatt lagras oförändrat; nätavbrott (omsänd utstämpling) och samtidiga stämplingsförsök prövade i `vift-v2/tests/t3b_ao_karna.test.js`. Kvar: klienttest i webbläsare över omställningen · *tidigare: **Ej påbörjad*** | – | QA V3 åtgärd 7 |
| 262 | **Avveckla de sex E2E-kontona och e2e-rollerna** via Auth-administrationen | **Ej påbörjad** | Efter sista STAGING-test; `supabase/manual/staging_go1_e2e_konton_borttagning.sql` | QA V3 F.3 |
| 263 | **Verifierad rensning av QA-LOAD** (cirka 1 000 poster) | **Ej påbörjad** | Beslut av Lucas, backup, referenskontroll mot skickade och betalda underlag | `TESTDATA-INVENTERING.md` |
| 264 | **C-6:** materialrad sparad med 0 kr (1 av 3 körningar; inte reproducerad). Bevakas. | **Ej påbörjad** (bevakning) | B1 (okänt pris är inte 0 kr) | QA V3 C-6 |
| 265 | **C-7:** stämplingsnycklar med e-post ligger kvar i localStorage efter utloggning; inloggningen gör fem seriella anrop; STAGING-etiketten täcker rubriken | **Delvis (T3-A, lokalt verifierad 2026-11-28):** stämplingsnycklarna rensas vid utloggning. Kvar: seriella anrop, etiketten | Säkerhetsomgången | QA V3 C-7, `LASANDE-QA.md` |
| 266 | **Löneunderlag:** verklig lönekostnad kräver lönedata i egen tabell (B3); beslut behövs om CSV-kolumnen "Kostnad (SEK)" | **Ej påbörjad** | B3; beslut; 76 | `ADMIN-RAPPORTER-LON.md` §6 |
| 267 | **Kontraktsbelopp:** datamodellen anger inte om beloppet är exkl. eller inkl. moms | **Ej påbörjad** | Beslut; 81 | `OVRIGA-SIDOR.md` §7 |
| 268 | **RUT/ROT för BRF och företag:** i dag bara upplysning. Ska det bli en regel? | **Ej påbörjad** | Affärsbeslut | `OFFERTER.md` §7 |
| 269 | **G9:** serverregel så att ekonomi kan sätta `klar` ↔ `fakturerad` (bara `status`, `invoiceId`, `billingPreviousStatus`) | **Lokalt verifierad** (T3-B, 2026-11-28, samordnat med D-07): `invoice-write` `aoBilling` med `invoice_create` sätter `klar` ↔ `fakturerad` (status, `invoiceId`, `billingPreviousStatus`); ingen generell statusändring kringgår vägen · *tidigare: **Ej påbörjad** · [S] i dag nekas ekonomi (403)* | Beslut; `ao-time-write` (242) | `STAGING-VERIFIERING-G6-G9-G13.md` |
| 270 | **Faktureringskön:** attest spärrar inte fakturering; "redan fakturerad", dubbletter och "fel kund" saknas som åtgärdsorsaker; AO med äldre fakturor utan källreferenser döljs ur kön | **Delvis lokalt verifierad** (T3-B, 2026-11-28): kö → underlag (`appendChecked`) → AO-status (`aoBilling`) och backning vid borttaget utkast/makulering funktionellt prövade lokalt; åtgärdsorsakerna (attest, dubbletter, fel kund) är oförändrade · *tidigare: **Ej påbörjad*** | Beslut | `FAKTURERING.md` |
| 271 | **`WorkOrderService` anropar `WorkOrdersPage.onSyncStatusChanged`, som inte finns.** "AO-(sparas…)" står kvar till nästa omritning. | **Ej påbörjad** | AO-etappen | `AO-LISTA.md` §8 |

### Riskregister R-01–R-18

Detta är beslutade ambitioner och kända gap som riskerar att tappas. Varje rad pekar på punkten där status följs.

| R | Område | Punkt(er) | Status | Beroenden |
|---|---|---|---|---|
| R-01 | Teknisk underhållsplanering | Framtida modul `ROADMAP-UNDERHALL-2026-10-23` (se nedan) | Ej påbörjad | Godkänd LIVE-release (241), RLS fas 2, produktbeslut |
| R-02 | Klickbara rapportunderlag | 129 | Delvis byggd | – |
| R-03 | Rapporternas testlista (7 punkter) | 77 | Simulerat testad | Funktionell STAGING-verifiering |
| R-04 | Leverans D (ansvariga och kontakter) | 83–91, 92 | Byggd / Simulerat testad | STAGING-flöde; riktig push |
| R-05 | E7 påminnelser, analys, säkerhetsverifiering | 124–128 | Byggd; 128 delvis byggd | STAGING-flöde; test av rate-limit |
| R-06 | F4-registermatrisen och F4-13 | 73, F4-13 | Delvis byggd / Ej påbörjad | Riktiga exportfiler (Bokio, Excel, Numbers) |
| R-07 | Platshållare | 132, 133 | Ej påbörjad | Specifikation |
| R-08 | Solar/Ahlsell och CSV-prisimport | 153 | Ej påbörjad | F4-13; avtal |
| R-09 | Kostnad och spårbarhet | 150, 152, 200 | Ej påbörjad | 242 (för 200); egen plan och GO (för 152) |
| R-10 | Uppskjutet | 79, 82 | Uppskjuten | – |
| R-11 | `service-monitor` | 40–43, 250 | Byggd (ej aktiverad) | Tester enligt §3, beslut |
| R-12 | G11 | 246 | Ej påbörjad | Beslut |
| R-13 | G1/G4 | 242 | Byggd + lokalt verifierad *(tidigare: Delvis byggd)* | PG17, STAGING-test av synkade EF:er efter GO; beslut om repair/db push mot STAGING. KÄLLA-1 och MIG-1 lokalt genomförda 2026-11-28 *(tidigare: KÄLLA-1, MIG-1; Supabase-åtkomst)* |
| R-14 | LIVE-plan/R9B i LIVE | 241 | Ej påbörjad | 242–245, beslut; alla T3/T4-paket verifierade i STAGING; SÄK-8/SÄK-9 stängda |
| R-15 | Funktioner som saknas helt | 251–259 | Ej påbörjad | Produktbeslut |
| R-16 | UI-rester | 184, 260 | Delvis byggd / Ej påbörjad | UX-etappen |
| R-17 | Sommartid vid stämpling | 261 | Ej påbörjad | – |
| R-18 | Testkonton och QA-LOAD | 262, 263 | Ej påbörjad | Sista STAGING-test; beslut |

## Säkerhetsomgången (nästa efter G1/G4, punkt 242)

**Uppdatering 2026-11-27:** G1/G4 är lokalt klart. Säkerhetsomgången genomförs som paketen T3-0–T4-F enligt avsnittet "Fastställd arbetsordning T3/T4" nedan. SÄK-klassningen följer `SAKERHETSPROVNING-TESTPLAN.md` §2.1, fastställd 2026-11-27: SÄK-8 och SÄK-9 är P1 inför LIVE, informationsläckaget i SÄK-7 är P1, och SÄK-10 blockerar standardrollen `personal`. Fynden F1–F23 finns i `BEHORIGHETSMATRIS.md` §7.

**Omfattning:**
- 243 (PERM-03 utökad) och 244 (PostgreSQL-testerna);
- genomförande av besluten B1–B5, Ö1–Ö7 och B-FAKT-1 samt C-5:s avvägningar (se 215); *(2026-11-27: även D-01–D-26 och AP-B/AP-F i den del som tillhör T3/T4)*;
- 248 (`vift_settings`) och 265 (C-7);
- SÄK-3 och SÄK-4 (arbetspoolens synlighet och "Ta jobbet"), som ska rättas innan B4 och Ö7 byggs;
- observationerna nedan.

Varje serverändring görs i STAGING med backup, test per roll och återställning, enligt mönstret från GO-5–GO-8. *(2026-11-27: först lokalt; installation i STAGING kräver separat GO per paket, se testplanen §8–§9.)*

**Nya säkerhetsobservationer (backlog, registrerade 2026-11-26):**

| Id | Observation | Status | Relation |
|---|---|---|---|
| SÄK-1 | Exportcentret visar Personnummer som förvalt markerat fält, trots att känsliga fält ska vara avstängda som standard (F4-7, CLAUDE.md). Undersöks. | **Registrerad, ej påbörjad** (undersöks) · Klassning 2026-11-27: P2 · paket T4-F | 54, F4-7, 215 |
| SÄK-2 | Fältrollens uppgiftssida visar uppgifter kopplade till andra användare | **Baslinje bevisad lokalt** (T3-0, 2026-11-28: `vift-v2/tests/baslinje_sakerhet.test.js` visar bristen i oförändrad kod; ej åtgärdad, vänds till säkerhetstest i T3-D) · *tidigare: Registrerad, ej påbörjad* (undersöks) · Klassning 2026-11-27: **P1** · paket T3-D | 7, 194 (per-post-regeln gäller skrivning), Ö7 |
| SÄK-3 | `work-orders-list` lämnar ut varje AO med status `pool` till alla med `ao_view_own`, oavsett tilldelning och datum (`vift-v2` `work-orders-list/index.ts:88-91`). Samma regel finns i `canViewWorkOrder` (`_shared/vift-auth.ts:121-131`), i SQL-funktionerna för checklista, framsteg och logg samt i fake-backend. Följd: fältpersonal ser andras tilldelade men oplanerade AO. | **Lokalt verifierad** (T3-B, 2026-11-28): poolregeln "egen tilldelad, eller öppen pool (status pool, poolOpen ≠ false, ingen personal, inte arkiverad/borttagen) med ao_pool_take" i `work-orders-list`, `canViewWorkOrder`, SQL-funktionerna och fake-backend; öppen pool i begränsad projektion (K-03); öppen pool ger ingen skrivrätt. Ingen breddning (bevis per användare och AO). Baslinjen vänd till godkända tester i `vift-v2/tests/t3b_ao_karna.test.js`. Ej installerad i STAGING · *tidigare: **Baslinje bevisad lokalt** (T3-0, 2026-11-28: `vift-v2/tests/baslinje_sakerhet.test.js` visar bristen i oförändrad kod; ej åtgärdad, vänds till säkerhetstest i T3-B) · tidigare: Registrerad, ej påbörjad* · Klassning 2026-11-27: **P1** · paket T3-B* | AP-2, AP-5; B4 och Ö7 ärver felet om de byggs före rättningen; 137, 242. Källa: `ARBETSPOOL-UTREDNING.md` §2 |
| SÄK-4 | "Ta jobbet" (`ao-time-write` `patch_ao`, `index.ts:241-257`) kräver bara status `pool`, så en fältanvändare kan lägga till sig på en AO som redan har personal. Kontrollen görs utan lås och utan `expectedUpdatedAt`; två samtidiga tagningar kan båda godkännas. Fake-backend saknar fältbegränsningen och kan inte testa detta. | **Lokalt verifierad** (T3-B, 2026-11-28): ny RPC `work_order_pool_take` under radlås, `ao-time-write` `take_from_pool`; exakt en vinner (N=2 ×20, N=10 ×5), förloraren 409 `already_assigned` utan mutation; v3.4-formen via `patch_ao` går genom samma regel. Ej installerad i STAGING · *tidigare: **Baslinje bevisad lokalt** (T3-0, 2026-11-28: `vift-v2/tests/baslinje_sakerhet.test.js` visar bristen i oförändrad kod; ej åtgärdad, vänds till säkerhetstest i T3-B) · tidigare: Registrerad, ej påbörjad* · Klassning 2026-11-27: **P1** · paket T3-B* | 212, AP-5, beslut F, Ö2; åtgärd enligt AP-ordningen steg 1 (409 `already_assigned`). Källa: `docs/qa-2026-11-26/ARBETSPOOL-UTREDNING.md` §3 |
| SÄK-5 | **P1.** `ao-time-write` `patch_ao`: grenen för `ao_complete` utan `ao_edit` (`index.ts:258-264`) slår inte upp AO:n. Den kontrollerar varken tilldelning eller nuvarande status. Fält med `ao_complete` kan sätta `klar` på vilken AO som helst vars id är känt, även `fakturerad`. **Bekräftat i återskapad källkod 2026-11-26:** `work_order_patch` kontrollerar bara att posten finns, idempotensen och att posten inte ändrats sedan den lästes, inte tilldelning eller status (`vift-v2/supabase/inventering/staging-2026-11-26/schema/functions.sql`). Inte prövat mot STAGING, eftersom det skulle ändra data. | **Lokalt verifierad** (T3-B, 2026-11-28): start/klar bara på egen tilldelad AO (`ao_start_own`/`ao_complete_own`, övergångsregel från `ao_complete`), källstatus (409 `invalid_source_status`), låsta AO (409 `ao_locked`), servern sätter `completedBy`/`completedAt` (`ignoredFields`), allt i `work_order_patch` under radlås; samtidig borttagning/klarmarkering ×20. Ej installerad i STAGING · *tidigare: **Baslinje bevisad lokalt** (T3-0, 2026-11-28: `vift-v2/tests/baslinje_sakerhet.test.js` visar bristen i oförändrad kod; ej åtgärdad, vänds till säkerhetstest i T3-B) · tidigare: Registrerad, ej påbörjad*. Högsta prioritet i säkerhetsomgången. · Klassning 2026-11-27: **P1** · paket T3-B* | Ö1, Ö2, 242. Källa: `docs/qa-2026-11-26/BEHORIGHETSMATRIS.md` F1 |
| SÄK-6 | Materialvägen ersätter hela `materials` och tar priser från klienten. Okänt inköpspris sparas som 0 kr, och artikelväljaren visar inköpspris även för fält. | **Registrerad, ej påbörjad** · Klassning 2026-11-27: **P1** · paket T4-B | B1, D-09/D-10. Källa: BEHORIGHETSMATRIS F2 |
| SÄK-7 | `get-sensitive-fields` kräver `objects_sensitive` och har ingen väg för tilldelad AO. Portkoder ligger dubbelt: i store-bloben och i tabellen `property_sensitive_access`. | **Registrerad, ej påbörjad** · Klassning 2026-11-27: **P1** för informationsläckaget (T4-A), P2 för den saknade tilldelningsvägen (T4-C) | B5, D-05/D-16. Källa: BEHORIGHETSMATRIS F3 |
| SÄK-8 | En användare med `staff_manage` kan ge sig själv rollen `admin`. Det finns inget skydd för sista superadmin. | **Lokalt verifierad** (T3-C, 2026-11-28): eskaleringsregeln i `store_business_key_write`/`_merge_write` (samma signatur) under ett gemensamt lås för `vift_staff` + `vift_roles` + `app_users`: 403 `privilege_escalation` (egen roll, behörighet utöver anroparens, även via e-postbyte), 403 `superadmin_required` (`all` och roller/poster med `all`), 409 `last_superadmin` (även `deactivate_vift_user`/`provision_vift_user`); superadmin = behörigheten `all`, aldrig roll-id; anroparens behörigheter läses om under låset. SEC-ROLL-05/06 ×50 med egna anslutningar: exakt en vinner, aldrig 0 superadmins. Baslinjen vänd i `vift-v2/tests/t3c_roller.test.js`. Ej installerad i STAGING · *tidigare: **Baslinje bevisad lokalt** (T3-0) · Registrerad, ej påbörjad* · Klassning 2026-11-27: **P1 inför LIVE** · paket T3-C | Ö5, D-25. Källa: BEHORIGHETSMATRIS F5 |
| SÄK-9 | Utloggning rensar bara tidposter och AO ur localStorage. Övriga cachade nycklar ligger kvar och används vid nätfel, vilket är en risk på delade enheter. | **Lokalt åtgärdad (T3-A, 2026-11-28)**, ej installerad i STAGING · Klassning 2026-11-27: **P1 inför LIVE** (kvarstår tills verifierad i STAGING) · paket T3-A | Källa: BEHORIGHETSMATRIS F6. Underlag: `docs/qa-2026-11-28/T3-A-AVSNITT.md` |
| SÄK-10 | Klientens reservroll `role:'personal'` (`AuthService.js:379`) måste ändras innan rollen `personal` definieras. Annars får okända inloggningar fältbehörighet. | **Lokalt åtgärdad (T3-A, 2026-11-28)**, ej installerad i STAGING · Klassning 2026-11-27: **Blockerar standardrollen `personal`** tills installerad; rättas före standardrollerna · paket T3-A (före T3-E) | Ö2, D-02. Källa: BEHORIGHETSMATRIS F7. Underlag: `docs/qa-2026-11-28/T3-A-AVSNITT.md` |
| SÄK-11 | **F16/F23:** tid och stämpling kontrolleras inte mot AO-tilldelning. `time_entry_create` kontrollerar inte tilldelning, tar `hourRate` från klienten och skriver tidpostens id i målets `timeEntries`; stämplingen (`store-key-write/stamp-status.ts:56-70`) kräver bara `ao_time`. | **Lokalt verifierad** (T3-B, 2026-11-28): `time_entry_create` och `store_write_stamp_status` kräver tilldelning (eller `ao_edit`/`payroll_manage` för andras räkning) under lås, 403 `not_assigned`/409 `ao_locked`/404 `not_found`; `hourRate` sätts av servern ur prisgruppen; legitim utstämpling tillåts efter omfördelning/klarmarkering/fakturering. Ej installerad i STAGING · *tidigare: **Baslinje bevisad lokalt** (T3-0, 2026-11-28: `vift-v2/tests/baslinje_sakerhet.test.js` visar bristen i oförändrad kod; ej åtgärdad, vänds till säkerhetstest i T3-B) · tidigare: Registrerad, ej påbörjad* · **P1** · paket T3-B (tilldelning), T4-B (pris)* | AP-B, D-11, 18, 142. Källa: BEHORIGHETSMATRIS F16, F23 |
| SÄK-12 | **F17:** `work_order_patch` returnerar sparat resultat vid återanvänd idempotensnyckel, oavsett payload (en annan patch med samma nyckel godkänns tyst). | **Lokalt verifierad** (T3-B, 2026-11-28): idempotensnyckeln binds till aktör, operation och innehåll i `work_order_patch`, `work_order_pool_take` och `time_entry_create` (409 `idempotency_key_conflict` utan mutation; samma nyckel och innehåll återspelas). `work_order_create` binds bara till operationen (service-monitor). Ej installerad i STAGING · *tidigare: **Baslinje bevisad lokalt** (T3-0, 2026-11-28: `vift-v2/tests/baslinje_sakerhet.test.js` visar bristen i oförändrad kod; ej åtgärdad, vänds till säkerhetstest i T3-B) · tidigare: Registrerad, ej påbörjad* · P3 · paket T3-B* | 242. Källa: BEHORIGHETSMATRIS F17 |
| SÄK-13 | **F18:** direkt REST-skrivning av nycklar utan affärsregel (`vift_lastChanged` och okända nycklar) är tillåten för alla aktiva (`store_active_write_safe`; spärrarna `staging_generic_keys_no_direct_*` gäller bara affärsnycklar). | **Lokalt verifierad** (T3-C, 2026-11-28): direkt REST-skrivning till `store` bara för en uttrycklig vitlista i RLS (RESTRICTIVE INSERT/UPDATE) och trigger: `vift_notifications` (befintligt innehållsskydd) och `vift_lastChanged` (värdet sätts av servern, klientens värde sparas aldrig); DELETE och allt annat 42501 `direct_write_blocked`. Klientens enda direkta skrivning (`persistNotifs`) fungerar oförändrad. `vift_lastChanged` står kvar på vitlistan av kompatibilitetsskäl (se Beslut som behövs i T3-RESULTAT). Ej installerad i STAGING · *tidigare: **Baslinje bevisad lokalt** (T3-0) · Registrerad, ej påbörjad* · P2 · paket T3-C | 243, A2. Källa: BEHORIGHETSMATRIS F18 |
| SÄK-14 | **F19:** `rondering-pass-write` kräver `ao_view_all` för allt och kontrollerar inte per pass. | **Registrerad, ej påbörjad** · P2 · paket T4-D | Ö3, `rondering_utfor`, 28. Källa: BEHORIGHETSMATRIS F19 |
| SÄK-15 | **F21:** `ao_edit` kan sätta `status:'fakturerad'` och `invoiceId` via `patch_ao` (ingen fältbegränsning för `callerHasEdit`), vilket kringgår fakturaintegriteten. | **Lokalt verifierad** (T3-B, 2026-11-28): `patch_ao` avvisar faktureringsfält för alla roller (403 `forbidden`/`invoice_path_required`); bara `invoice-write` `aoBilling` (`work_order_billing_set`) sätter/backar status, `invoiceId` och `billingPreviousStatus`. Fakturaflödet kö → underlag → status → borttaget utkast/makulering lokalt verifierat. Ej installerad i STAGING · *tidigare: **Baslinje bevisad lokalt** (T3-0, 2026-11-28: `vift-v2/tests/baslinje_sakerhet.test.js` visar bristen i oförändrad kod; ej åtgärdad, vänds till säkerhetstest i T3-B) · tidigare: Registrerad, ej påbörjad* · **P1** (D-07) · paket T3-B* | D-07, 269, 17. Källa: BEHORIGHETSMATRIS F21 |
| SÄK-16 | **`work-orders-list` filtrerar inte `deleted`/`archived` i poolgrenen** (installerad källa `index.ts:71`): även arkiverade och borttagna pool-AO lämnas ut till alla med `ao_view_own`. | **Lokalt verifierad** (T3-B, 2026-11-28): `work-orders-list` lämnar inte ut arkiverade eller borttagna AO till icke-ledare (även egna). Ej installerad i STAGING · *tidigare: **Baslinje bevisad lokalt** (T3-0, 2026-11-28: `vift-v2/tests/baslinje_sakerhet.test.js` visar bristen i oförändrad kod; ej åtgärdad, vänds till säkerhetstest i T3-B) · tidigare: Registrerad, ej påbörjad* · **P1** (del av poolläckan) · paket T3-B* | SÄK-3, AP-A. Källa: `ARBETSPOOL-UTREDNING.md` v2 §0 och §1 |
| SÄK-17 | **Fake-backend avviker från STAGING:** checklistan startar AO:n (`fake-backend.js:611`; STAGING:s `work_order_checklist_set_state` gör det inte), `patch_ao` saknar fältbegränsningen, poolläckan finns även där, och `e2e-test-cleanup` saknas. Simulerade tester kan därför ge fel utfall. | **Lokalt verifierad för T3-B** (2026-11-28): fake-backend följer T3-B-reglerna; AO-04, AO-05, AO-13, AO-19 och CHK-LEGACY åtgärdade; 54 scenarier, 52 lika, 2 kända (KEY-01, AUTH-02, utanför T3-B) · *tidigare: **Delvis åtgärdad / paritet förberedd** (T3-0, 2026-11-28): paritetsramverk `VIFT-CRM/tests/sim_parity.test.js` (29 scenarier mot lokal replik och fake-backend, 22 lika, 7 kända avvikelser i `tests/e2e/paritet-kanda-avvikelser.json`); `e2e-test-cleanup` modellerad i fake-backend (`staging_e2e_real` 26/0). Kvar: fältbegränsningen i fake `patch_ao` och autostarten i fake:s legacy-läge (standardläget startar inte), följer serverrättningarna i T3-B · tidigare: Registrerad, ej påbörjad* · klass ej fastställd; paritet med den simulerade servern (SEC-SIM-01) krävs för GO · paket T3-0/T3-B (`sim_parity`)* | 244, SÄK-3, SÄK-4. Källa: `ARBETSPOOL-UTREDNING.md` v2 §1 och §8; `G1-G4-DEL2-RESULTAT.md` §9 |

## Fastställd arbetsordning T3/T4 (2026-11-27)

**Källa:** `docs/qa-2026-11-26/SAKERHETSPROVNING-TESTPLAN.md` §6–§9 (korrigerad och fastställd 2026-11-27), byggd på `BESLUT-2026-11-27.md` och `BEHORIGHETSMATRIS.md`. Detta är den fastställda arbetsordningen för nästa omgångar.

**Status för samtliga paket:**
- lokal utveckling och test: **GO, i tur och ordning**;
- installation i STAGING: **NO-GO** tills Lucas ger separat godkännande per paket (villkor i testplanen §9.2);
- LIVE: **NO-GO** (testplanen §9.4, punkt 241).

**Ordning:** T3-0 → T3-A → T3-B → T3-C → T3-D → T3-E → T4-A + T4-B (samordnat) → T4-C → T4-D → T4-E → T4-F. Därefter verifiering V1–V11 i STAGING. T3-A är bara klient och kan utvecklas parallellt med T3-B, men installeras först.

| Paket | Innehåll | SÄK / beslut | Beroenden | Status |
|---|---|---|---|---|
| T3-0 | Grund: versionerade migrationer för de 13 funktionerna och cutover-policyerna, EF-synk, lokal STAGING-replik, testverktyg som kontrollerar felkod, `reason` och kontrollsumma | 242, 244, SÄK-17 | Inventeringen (klar) | **Lokalt genomförd 2026-11-28** (`docs/qa-2026-11-28/T3-RESULTAT.md`): replik, testverktyg, EF-smoke, baslinje (34 brister), paritet, KÄLLA-1, MIG-1. Kvar: PG17/Deno (miljö), skärpning av STAGING-verktygen (flyttad till T3-B). STAGING: inget installerat |
| T3-A | Klientskydd: reservrollen fail-closed, rensning av alla `vift_*`-nycklar vid utloggning | SÄK-10, SÄK-9, 265 | Inga; installeras före T3-E | Lokal GO · **2026-11-28: lokalt verifierad** (36_client_security 13/13, client_security.test.js 38/38); STAGING NO-GO tills installerad |
| T3-B | AO-kärna och arbetspool: regelkontroll i `work_order_patch` under lås, poolregeln, "Ta jobbet" atomiskt (409 `already_assigned`), tid och stämpling mot tilldelning, nya AO-behörigheter | SÄK-5, SÄK-3, SÄK-4, SÄK-15 (F21), SÄK-11 (F16/F23), SÄK-12 (F17), SÄK-16; D-03, D-07, D-24, AP-A, AP-B, AP-F, AP-G | T3-0 | Lokal GO efter T3-0 |
| T3-C | Superadmin, roller och direkta vägar: eskaleringsregel, invarianten "≥1 aktiv `all`" under lås | SÄK-8, SÄK-13 (F18), 243; D-25, D-21; Ö5 | T3-0 (T3-B rekommenderas först) | Lokal GO efter T3-0 |
| T3-D | Urval per post: aktivitetslogg, uppgifter, offertreferens, kunder/fastigheter per uppdrag, personal | SÄK-2; B4, Ö7, D-12–D-15, D-22 | **T3-B installerat först** | Lokal GO efter T3-B |
| T3-E | Standardroller (M9) | D-02, D-26, Ö2 | **T3-A installerat**; T3-B–D; K-01, K-02 | Lokal GO (replik); STAGING NO-GO tills T3-A–D installerade och testkonton godkända |
| T4-A + T4-B | Samordnat B1 + B5: skyddade fält med fältvis sammanslagning, `cost_view`; material, priser och tid radvis, okänt ≠ 0, `cost_edit`, `time_view_all` | SÄK-7 (läckage), SÄK-6, SÄK-11 (pris); B1, B5, D-01, D-05, D-06, D-09–D-11, D-13, D-17, D-19 | T3-B, T3-C, T3-E; K-03 | Lokal GO efter T3-B/C |
| T4-C | Åtkomstinformation till tilldelad personal (`objects_access_assigned`), förberedelse för D-16, D-23 | SÄK-7 (vägen) | T3-B, T4-A, T4-D för rondering | Lokal GO |
| T4-D | Rondering per pass (`rondering_utfor`) | SÄK-14 (F19); Ö3 | T3-E, T3-D | Lokal GO |
| T4-E | **M8:** faktura-PDF och kommentarer (`internalNote`/`customerNote`) | B-FAKT-1, D-20; K-05 | T3-0 (kan tidigareläggas) | Lokal GO |
| T4-F | Export (`export_data`, `export_personal_data`, serverexport) | SÄK-1 (F12); D-18; K-04 | T3-E, T4-A | Lokal GO efter T4-A |

**Verifiering i STAGING efter installation** (senare omgång, separat GO per paket; testplanen §7):

| Steg | Efter paket | Verifiering |
|---|---|---|
| V1 | T3-A | SEC-CACHE-01..03, SEC-ROLL-10 |
| V2 | T3-B | T3-B:s STAGING-lista, därefter `c5-read.js` och `authz-read.js` med ny förväntan |
| V3 | T3-C | SEC-B3-03/05, SEC-REST-03 (läsande) |
| V4 | T3-D | SEC-B4-01..03, SEC-TASK-01..06, SEC-OFF-01, SEC-KUND-01/02 |
| V5 | T3-E | Ny förväntan per standardroll; testkonton enligt D-26 efter GO |
| V6 | T4-A + T4-B | Listorna i testplanen §6, full regression `e2e-real.js`, manuell mobilkontroll av materialflödet |
| V7 | T4-C | SEC-B5-06/08/09 |
| V8 | T4-D | SEC-ROND-01/02/04 |
| **V9** | **T4-E (M8)** | **SEC-FAKT-06/07:** kund-PDF utan intern kommentar, äldre `note` inte med |
| V10 | T4-F | SEC-EXP-03..05 |
| V11 | Alla | Slutregression: `tests/run-all.sh`, lokala sviter mot replikan, `e2e-real.js`, kontrollsummor och städning med kod 0 |

**Utanför T3/T4 (AO-etappen):** `ao_plan_own` (AP-E), räknare (AP-C), notiser utöver "inga falska tilldelningsnotiser" (AP-D), avveckling av status `pool` (AP-G), kategorierna i alla vyer, AO-nummergeneratorn (245) och UX-etappen.

## Beslut 2026-11-26 (fastställda 2026-11-27)

**Status för samtliga:** Beslutad, ej byggd. Besluten ersätter inte tidigare punkter; de anger hur öppna frågor ska lösas.

**Uppdatering 2026-11-27:** Lucas Samuelsson fastställde D-01–D-26 och AP-A–AP-G. Den auktoritativa ordalydelsen finns i `docs/qa-2026-11-27/BESLUT-2026-11-27.md`; tabellerna här är sammanfattningar. B1–B5, Ö1–Ö10 och B-FAKT-1 har status **Beslutad, ej byggd** och verkställs genom D-besluten i paketen T3/T4. **Grundprincip:** standardrollerna är utgångspunkter; behörigheter ska kunna anpassas individuellt eller genom egna roller och hårdkodas inte efter rollens namn.

### D-01–D-26 (fastställda 2026-11-27)

**Status för samtliga:** Beslutad, ej byggd. Kort sammanfattning. Ordalydelsen i `docs/qa-2026-11-27/BESLUT-2026-11-27.md` gäller; genomslaget i matrisen står i `BEHORIGHETSMATRIS.md` §6.

| Id | Sammanfattning | Status | Paket |
|---|---|---|---|
| D-01 | Intern ekonomi: `cost_view`/`cost_edit` standard för admin, arbetsledare och ekonomi, kan tas bort; ger inte löneuppgifter; fält och externa ser inte intern ekonomi | **Beslutad, ej byggd** | T4-A/T4-B |
| D-02 | Roll-id: behåll `chef` (etikett Arbetsledare), `admin`, `personal`, `ekonomi`; inför `begransad`; ingen onödig migrering | **Beslutad, ej byggd** | T3-E |
| D-03 | Fältets AO: `ao_start_own`, `ao_complete_own`, `ao_pool_take`; bara egen tilldelad giltig AO; låsta statusar; servern sätter identitet och tid | **Lokalt verifierad** (T3-B, 2026-11-28): `ao_start_own`, `ao_complete_own`, `ao_pool_take` med övergångsregel; servern sätter identitet och tid · *tidigare: **Beslutad, ej byggd*** | T3-B |
| D-04 | Begränsad/extern: bara egna tilldelade AO, ingen öppen pool, ingen ekonomi; tillägg tilldelas separat | **Beslutad, ej byggd** | T3-E |
| D-05 | Portkoder: `objects_sensitive` standard för arbetsledare (kan tas bort); fält får åtkomstinformation för egna tilldelade aktiva uppdrag via smal loggad serverväg, även vid rondering | **Beslutad, ej byggd** | T4-A, T4-C |
| D-06 | AO-ekonomi: inga fastpriser, marginaler eller inköpspriser till fält; omfattning och debiteringskategori utan belopp | **Beslutad, ej byggd** | T4-A |
| D-07 | Fakturaunderlag: arbetsledare läser och skapar; bara via atomisk faktureringsväg; ingen kan sätta `fakturerad` via generell AO-patch | **Lokalt verifierad** (T3-B, 2026-11-28): faktureringsfält bara via `invoice-write` · *tidigare: **Beslutad, ej byggd*** | T3-B (SÄK-15) |
| D-08 | Tid och lön: ekonomi och admin får löneunderlag och attest; arbetsledare följer tid utan löneåtkomst (`time_view_all`) | **Beslutad, ej byggd** | T4-B; K-01 |
| D-09 | Materialets försäljningspris döljs för fält; servern sätter priset | **Beslutad, ej byggd** | T4-B |
| D-10 | Fritextmaterial; okänt pris markeras okänt, aldrig 0 kr; saknat försäljningspris stoppar eller flaggar fakturering; fastpris utan dubbeldebitering | **Beslutad, ej byggd** | T4-B |
| D-11 | Timpriser: fält ser inte belopp, bara gruppnamn; servern validerar och sätter priset; historiska priser oförändrade | **Beslutad, ej byggd** | T4-B |
| D-12 | Offerter för fält: bara minsta referensinformation för tilldelad AO | **Beslutad, ej byggd** | T3-D |
| D-13 | Kunder och fastigheter per behörigt uppdrag; begränsad poolinformation; personnummer bara med `personal_data_view` | **Beslutad, ej byggd** | T3-D, T4-A; K-02, K-03 |
| D-14 | Personalens kontaktuppgifter: namn, titel, arbetskontakt; egen identitet fungerar; andras behörigheter och skyddade uppgifter exponeras inte | **Beslutad, ej byggd** | T3-D |
| D-15 | Uppgifter: `ao_view_all` räcker inte för att ändra andras; samma regel i server och klient | **Beslutad, ej byggd** | T3-D |
| D-16 | `property_sensitive_access` blir sanningskälla för portkoder; bara förberedelse nu, ingen migrering | **Beslutad, ej byggd** | T4-C |
| D-17 | Bankgiro: interna roller läser, ändring kräver `bankgiro_edit`; konfliktsäkra inställningar | **Beslutad, ej byggd** | T4-A; 248 |
| D-18 | Export: `export_data`, `export_personal_data`; samma regel i snabbexport och Exportcenter; känsliga fält av som standard; serverkontrollerad och loggad export av skyddade uppgifter | **Beslutad, ej byggd** | T4-F; K-04 |
| D-19 | Materialrader: fält ändrar egna rader på tilldelad redigerbar AO; radvisa serveroperationer | **Beslutad, ej byggd** | T4-B |
| D-20 | Intern kommentar aldrig på kundens faktura eller kund-PDF; separata fält; gamla `inv.note` klassas inte automatiskt som kundsynliga; ingen historisk dataändring | **Beslutad, ej byggd** | T4-E (M8); K-05 |
| D-21 | Rollregister: egen effektiv behörighet; andras listor kräver särskild rättighet | **Lokalt verifierad** (T3-C, 2026-11-28): utan `admin_manage` bara den egna rollen ur `vift_roles` (med `staff_manage` även de roller man får tilldela); REST-läsning av registret stängd för övriga · *tidigare: **Beslutad, ej byggd*** | T3-C, T3-D |
| D-22 | Aktivitetslogg: typer och referenser per behörighet; servern sätter identitet och tid; klientrapporterat är inte revisionshistorik | **Beslutad, ej byggd** | T3-D |
| D-23 | Radering och känsliga uppgifter: atomiskt med överordnad post; revision utan portkod; skilj arkivering, mjuk och permanent radering | **Beslutad, ej byggd** | T4-C |
| D-24 | Arbetspool: följ AP-A–AP-G; tilldelad men oplanerad AO är giltig i poolen | **Beslutad, ej byggd** | T3-B, AO-etappen |
| D-25 | Superadmin: `admin_manage` är inte superadmin; bara superadmin hanterar `all`; atomisk invariant "minst en aktiv superadmin" | **Lokalt verifierad** (T3-C, 2026-11-28): se SÄK-8 · *tidigare: **Beslutad, ej byggd*** | T3-C |
| D-26 | Testkonton motsvarar standardrollerna, plus negativa fall för egna roller; skapas i STAGING först efter separat godkännande | **Beslutad, ej byggd** | T3-E; 262 |

### Behörigheter

Ö-numreringen följer `docs/qa-2026-11-26/BEHORIGHETER-BESLUTSUNDERLAG.md` (Ö1–Ö10). Användarens beslut under "Övrigt" är mappade till dem: starta och klarmarkera egna AO → Ö1 och Ö2; rondering → Ö3; uppgifter → Ö7; standardroller → Ö2; sista superadmin → Ö5. Beslutet om intern kommentar på faktura-PDF har eget id, B-FAKT-1.

| Id | Beslut | Status | Genomförs i / beroenden |
|---|---|---|---|
| B1 | Inköpspriser, marginaler och intern ekonomi visas bara för särskilt behöriga roller. Fältpersonal kan registrera material utan att se inköpspriser. Fritextmaterial ska vara möjligt. Okänt inköpspris ska inte behandlas som en verklig kostnad på 0 kr och ska kunna kompletteras av behörig personal. | **Beslutad, ej byggd** | Säkerhetsomgången. Projektion av `vift_articles` för roller utan `article_manage`/`invoice_*`/`reports_view`; materialformulär utan `buyPrice`; relation 22, 264. **2026-11-27:** D-01, D-09, D-10; T4-A/T4-B |
| B2 | Behåll försäljningspriser där de behövs operativt. B2 samordnas med Ö4 (timpris i fältets tidposter), så att reglerna för försäljningspris, timpris och intern personalkostnad inte motsäger varandra. | **Beslutad, ej byggd** | Säkerhetsomgången; Ö4; 23, 266. **2026-11-27:** D-11 (gruppnamn utan belopp; ersätter samordningsfrågan med Ö4); T4-B |
| B3 | Fältpersonal ser namn, titel och nödvändiga kontaktuppgifter, men inte andras behörighetslistor eller skyddade personaluppgifter. | **Beslutad, ej byggd** | Projektion av `vift_staff`; lön aldrig i `vift_staff` (266); 21. **2026-11-27:** D-14, D-21; T3-D |
| B4 | Fältpersonal ser bara händelser för egna och tilldelade uppdrag. Inga ovidkommande offerter, fakturor eller ekonomiska uppgifter. | **Beslutad, ej byggd** | Radprojektion av `vift_activityLog`, motsvarande `work-orders-list`; 6, 195. **2026-11-27:** D-22, D-12–D-15; T3-D efter T3-B |
| B5 | Portkoder och nyckelinformation skyddas på servernivå. Fältvis sammanslagning får aldrig låta en användare skriva över ett skyddat fält som användaren saknar rätt att ändra. | **Beslutad, ej byggd** | Fältvis sammanslagning i `store-key-write`; konsekvensanalys, backup och rollback; 72, 215. **2026-11-27:** D-05, D-16, D-23; T4-A och T4-C |
| Ö1 | **Underlag:** "Starta arbete" i AO-detaljen för tilldelad fältarbetare. **Beslut** (gemensamt med Ö2): tilldelad fältpersonal får starta och klarmarkera egna tilldelade AO, men inte attestera, fakturera eller ändra skyddade ekonomiska fält. | **Beslutad, ej byggd** | Serverregel i `ao-time-write` (242); Ö2; besvarar `AO-DETALJ.md` fråga 1; 212. **2026-11-27:** D-03 (`ao_start_own`, `ao_complete_own`); T3-B |
| Ö2 | **Underlag:** fältrollen och `ao_complete`; standardrollen `personal` saknas i STAGING:s rollregister. **Beslut:** klarmarkering av egna tilldelade AO enligt Ö1; standardrollerna definieras korrekt. | **Beslutad, ej byggd** | Rolldefinitioner; Ö1, Ö3, B1–B4; besvarar `AO-DETALJ.md` fråga 2; 24. **2026-11-27:** D-02, D-03; T3-B, T3-E |
| Ö3 | **Underlag:** fältrollen och rondering (ronderingssidorna kräver `ao_view_all`). **Beslut:** en separat smal behörighet för att utföra tilldelade ronderingar, `rondering_utfor`, inte `ao_view_all`. | **Beslutad, ej byggd** | Ny permission i `AuthService` och `rondering-pass-write` (242); 27–29; UX-3. **2026-11-27:** D-04, `rondering_utfor`; T4-D |
| Ö4 | **Underlag:** timpris i fältets egna tidposter och i stämpla-ut-dialogen (fältet ser det). **Beslut:** samordnas med B2, så att reglerna för försäljningspris, timpris och intern personalkostnad inte motsäger varandra. | **Beslutad, ej byggd** (D-11: fältet ser prisgruppens namn utan belopp; servern sätter priset) · T4-B · *tidigare: **Beslutad att samordnas med B2**; synlighetsregeln är inte fastställd* | Säkerhetsomgången. Underlagets förslag: dölj i klienten och projicera bort `hourRate` i `time-entries-list` för fält. |
| Ö5 | **Underlag:** personal kan inaktivera sig själv eller sista superadmin. **Beslut:** sista superadministratören kan inte inaktiveras eller fråntas sin behörighet. | **Lokalt verifierad** (T3-C, 2026-11-28): 409 `last_superadmin` i personal- och rollregistret och i `deactivate_vift_user`; `StaffPage`/`AdminPage` visar inga sådana val och förklarar serverns avslag · *tidigare: **Beslutad, ej byggd*** | Serverregel: neka om resultatet blir 0 aktiva med `all`; `StaffPage`/`AdminPage`; 21, 247. **2026-11-27:** D-25; T3-C |
| Ö6 | **Underlag:** PERM-03/BLOCKER-2, skrivbehörighet per nyckel för generiska nycklar. | **Lokalt verifierad** (T3-C, 2026-11-28): PERM-03 avblockerat; e2e mot serverns `KEY_PERMISSIONS` utläst ur `store-key-write`-källan (ingen modell), paritetsscenarierna KEY-02–04 lika i replik och fake; per-nyckel-regeln i RPC:n oförändrad (redan på plats); direkt REST-skrivning stängd (F18) · *tidigare: **Beslutad, ej byggd** (verkställs i T3-C och 243) · Delvis byggd · [S] skapa ny post 36/36* | Säkerhetsomgången; 242, 243 |
| Ö7 | **Underlag:** uppgifter (`vift_activities`) läses av alla. **Beslut:** uppgifter filtreras på servern efter behörighet och tilldelning (samma urval som B4: fält ser egna och tilldelade). | **Beslutad, ej byggd** | Projektion i `store-key-write`; B4; SÄK-2; 7. **2026-11-27:** D-15; T3-D |
| Ö8 | **Underlag:** Admin, "Rensa lokal cache" och push-diagnostik kräver `admin_manage`, varnar för osynkade ändringar och visar inga nycklar. | **Beslutad, ej byggd** som beslutspunkt; själva åtgärden är redan genomförd i 238 (Simulerat testad), inget nytt att bygga · *tidigare: **Simulerat testad** (klar, punkt 238); inget beslut behövs* | 238 |
| Ö9 | **Underlag:** E2E-konton och testroller (`e2e_*`, `v7_sakerhetstest`, `qa_p2_avgransad`). Avvecklas när testuppdraget är slut; får aldrig följa med till LIVE. | **Beslutad, ej byggd** (D-26: testkonton motsvarar standardrollerna, skapas i STAGING först efter separat godkännande; avveckling i 262) · *tidigare: **Ej påbörjad** (punkt 262)* | 262, 241 |
| Ö10 | **Underlag:** inget av skydden ovan finns i LIVE. | **Beslutad, ej byggd** (del av LIVE-planen, punkt 241) · *tidigare: **Ej påbörjad** (del av LIVE-planen, punkt 241)* | 241 |
| B-FAKT-1 | Intern kommentar visas aldrig på kundens faktura-PDF. Kundsynlig kommentar är ett separat fält. (Inget Ö-nummer; motsvarar punkt 3 i `docs/qa-2026-11-26/KVARSTAENDE-PROBLEM.md`.) | **Beslutad, ej byggd** | `_buildPrintHTML`, datamodell för fakturaunderlag; 17. **2026-11-27:** D-20; T4-E (M8), verifiering V9; K-05 |

### Affärsregel: arbetspool, tilldelning och planering

**Status:** Beslutad. Utredning pågår, implementeras inte nu (AO-etappen).

**Uppdatering 2026-11-27:** fastställt genom D-24 och AP-A–AP-G (`BESLUT-2026-11-27.md`). Serverregeln för poolen byggs i T3-B; kategorierna i vyerna, räknarna (AP-C), notiserna (AP-D), `ao_plan_own` (AP-E) och avvecklingen av `pool` (AP-G) hör till AO-etappen.

**Kategoridefinition** (`ARBETSPOOL-UTREDNING.md` version 2, §5; härledd vid läsning, inget lagrat skrivs om). Kategorierna är ömsesidigt uteslutande och prövas i ordning:
1. **Avslutade:** borttagen, arkiverad eller status `klar`/`fakturerad`/`avbruten`.
2. **Öppen pool:** ej avslutad, uttryckligen tillgängliggjord (status `pool` och nytt fält `poolOpen ≠ false`) och utan personal.
3. **Planerad:** ej avslutad, ej påbörjad och med utförandedatum (med eller utan personal).
4. **Tilldelad pool:** ej avslutad, ej påbörjad, med personal men utan utförandedatum.
5. **Övriga aktiva:** allt annat, t.ex. `pågående` eller en ny AO utan personal och datum som inte är tillgängliggjord. En sådan AO exponeras alltså inte automatiskt.

Förfallodatum skiljs från utförandedatum med ett nytt fält `dueDate`; på befintliga pool-AO tolkas `scheduledDate` som förfallodatum.

| Id | Regel |
|---|---|
| AP-1 | Tre separata dimensioner: tilldelning (vem), planering (när) och status (hur långt). |
| AP-2 | Utan personal och utan datum ligger AO:n i den öppna arbetspoolen. Med personal men utan datum ligger den i den tilldelade arbetspoolen och syns även under Mina jobb för de tilldelade. Med datum syns den som planerad. *(Ändrat 2026-11-27 genom AP-A: öppen pool är bara uttryckligen tillgängliggjorda, aktiva och otilldelade uppdrag. En ny AO utan personal och datum exponeras **inte** automatiskt för all fältpersonal.)* |
| AP-3 | Tilldelning kräver inte datum. |
| AP-4 | Att ta bort datum, flytta till poolen eller ändra tilldelning får inte rensa personal, ansvarig, datum, status eller historik. Arbetsstatus och faktisk arbetstid hanteras separat. |
| AP-5 | Tilldelade men oplanerade AO kan inte tas av annan fältpersonal. Arbetsledare och admin ser och hanterar båda kategorierna. |
| AP-6 | Dialogen för tilldelning, ansvarig och planering ska följa AP-1–AP-5 (se UX-8). |

| Id | Fel | Status |
|---|---|---|
| AP-FEL-1 | Rapporterat fel i v3.4: om "Flytta till arbetspool" är ikryssat i dialogen Hantera personal rensas all personal. Ska rättas i AO-etappen. **Orsak (utredd 2026-11-26):** rutan "Flytta till arbetspool" är förikryssad på pool-AO (`WorkOrderDetailPage.js:3167/3196`), och `updateStaff` tömmer då personal och ansvarig (`WorkOrderService.js:1322-1326`). Dessutom loggas och notifieras "Personal tilldelad" fast personalen rensats. Källa: `docs/qa-2026-11-26/ARBETSPOOL-UTREDNING.md`. | **Lokalt verifierad** (T3-B, 2026-11-28): personaldialogen ändrar bara personal och ansvarig, ingen poolruta, notis bara för faktiskt tillagd personal efter serverbekräftelse; "Ta bort datum" och "Släpp till öppen pool" separata åtgärder (e2e T3B-01/02) · *tidigare: **Registrerad, ej påbörjad** (orsak utredd)* |

**Relation:** 9, 78, 212, 245, 271.

#### Affärsbeslut för arbetspoolen A–G

**Status för samtliga:** Beslut krävs. Källa: `docs/qa-2026-11-26/ARBETSPOOL-UTREDNING.md` §9, där även utredningens rekommendation per fråga finns.

**Uppdatering 2026-11-27:** alla sju är fastställda, status **Beslutad, ej byggd**. Ordalydelse i `BESLUT-2026-11-27.md`.

| Id | Fråga | Status |
|---|---|---|
| AP-A | Räknas en otilldelad, odaterad AO med status `nytt` (eller `planerad`) som öppen pool? Är en otilldelad pool-AO med datum öppen pool eller planerad? | **Beslutad, ej byggd** (2026-11-27): Öppen pool = uttryckligen tillgängliggjorda, aktiva, otilldelade uppdrag; tilldelad pool = personal utan planerat datum; planerad = faktiskt utförandedatum. Förfallodatum gör inte en AO schemalagd. Ingen breddning av utlämningen. · T3-B (serverregel), AO-etappen (vyer) · *tidigare: **Beslut krävs*** |
| AP-B | Får fält stämpla på en AO de inte är tilldelade? | **Beslutad, ej byggd** (2026-11-27): Fält måste vara tilldelad AO innan tid och instämpling; öppet pooljobb tas först; ingen automatisk tilldelning via stämpling. · T3-B (SÄK-11) · *tidigare: **Beslut krävs*** |
| AP-C | Ska "Otilldelade" omfatta öppen pool? | **Beslutad, ej byggd** (2026-11-27): "Otilldelade" = aktiva AO utan personal; öppen pool är en delmängd; samma definitioner i alla vyer. · AO-etappen · *tidigare: **Beslut krävs*** |
| AP-D | Vilka vägar ger notis (skapande med personal, när någon tar ett jobb, nytt i poolen)? | **Beslutad, ej byggd** (2026-11-27): Tilldelningsnotis när personal faktiskt tilldelats, först efter serverbekräftelse och utan dubbletter; arbetsledare kan få notis när någon tar ett jobb; notis om nytt pooljobb är konfigurerbar; ingen falsk notis vid avplanering. · AO-etappen (inga falska notiser i T3-B) · *tidigare: **Beslut krävs*** |
| AP-E | Får tilldelad fältpersonal sätta datum själv? | **Beslutad, ej byggd** (2026-11-27): Tilldelad fältpersonal får planera egna oplanerade uppdrag med `ao_plan_own`; tydliga regler vid flera personer; ändrar inte andras tilldelning, ekonomi eller status. · **AO-etappen**, inte T3/T4; K-06, Q4 · *tidigare: **Beslut krävs*** |
| AP-F | Vilken behörighet krävs för "Ta jobbet"? Hänger ihop med Ö2. | **Beslutad, ej byggd** (2026-11-27): Separat behörighet `ao_pool_take`, inte kopplad till `ao_complete` eller `ao_time`; atomisk tagning, exakt en lyckas. · T3-B (SÄK-4) · *tidigare: **Beslut krävs*** |
| AP-G | Ska status `pool` avvecklas för nya AO på sikt? | **Beslutad, ej byggd** (2026-11-27): `pool` avvecklas inte förrän import, serviceintervall, kalender, behörigheter och notiser är verifierade; ingen omskrivning av historik; personaldialogen hanterar bara personal och ansvarig, "Ta bort datum" och "Släpp till öppen pool" är separata åtgärder. · AO-etappen (AP-FEL-1) · *tidigare: **Beslut krävs*** |

#### Rekommenderad ordning för arbetspoolen (förslag, ej beslutad)

*(2026-11-27: ersatt av den fastställda arbetsordningen. Steg 1 ingår i T3-B; steg 2–3 i AO-etappen; steg 4 är T3-D efter T3-B.)*

1. Serverregeln "eget eller (`pool` och ingen personal)" överallt (`work-orders-list`, `canViewWorkOrder`, SQL-funktionerna och fake-backend), plus 409 `already_assigned` när "Ta jobbet" träffar en AO som redan har personal. Rättar SÄK-3 och SÄK-4.
2. Personaldialogen ändrar bara personal. Rättar AP-FEL-1.
3. En härledd kategori (öppen pool, tilldelad pool, planerad) vid läsning. Ingen lagrad post ändras.
4. B4 och Ö7 byggs på den rättade regeln.

Steg 1 och 2 kräver inga affärsbeslut. Beslut AP-A, AP-E och AP-F krävs innan vyerna i steg 3.

### Öppna frågor och förtydliganden (registrerade 2026-11-27)

**Status för samtliga:** Beslut krävs. Inga är motsägelser; de ska bekräftas före respektive paket.

| Id | Fråga | Förslag i underlaget | Före paket | Källa |
|---|---|---|---|---|
| K-01 | `time_view_all`: all personal, eller ett framtida teamurval? | All personal (teamurval finns inte i datamodellen) | T4-B, T3-E | `BEHORIGHETSMATRIS.md` §6 |
| K-02 | Ska arbetsledaren ha `personal_data_view` som standard för offerter med ROT/RUT? | Inte standard; läggs till per roll vid behov | T3-E | Matrisen §6 |
| K-03 | Exakt fältlista för poolprojektionen (D-13) | Titel, beskrivning, kategori, prioritet, gatuadress och ort, förfallodatum, uppskattad tid; inte kontaktuppgifter, portkod, logg, material, checklista, bilder eller pris | T3-B/T4-A | Matrisen §6 |
| K-04 | Portkod i export (D-18) | Bara via serverexport med `objects_sensitive` + `export_data`, aktivt val och logg | T4-F | Matrisen §6 |
| K-05 | Klassificering av gamla `inv.note` (D-20) | Separat genomgång; tills dess aldrig med i ny kund-PDF | T4-E | Matrisen §6 |
| K-06 | Konfliktregler för `ao_plan_own` vid flerpersonsuppdrag (AP-E) | Avgörs i AO-etappen | AO-etappen | Matrisen §6 |
| Q1 | Pool-AO som fått datum via "Omplanera": förfallodatum eller planerad? | Godta förfallodatum (ändrar ingen visning, breddar inte) | AO-etappen | `ARBETSPOOL-UTREDNING.md` v2 |
| Q2 | Återkommande ärendens datum: utförandedatum eller förfallodatum? | Behåll utförandedatum för befintliga; val per återkommande ärende för nya AO | AO-etappen | Arbetspoolsutredningen v2 |
| Q3 | Ska fältets logg- och historikurval (B4) innehålla öppna pool-AO? | Nej | T3-D | Arbetspoolsutredningen v2 |
| Q4 | Vem får planera om ett flerpersonsuppdrag med `ao_plan_own`? | Ansvarig, annars den som planerade först | AO-etappen | Arbetspoolsutredningen v2 §11 |
| OR-1 | `offer_respond_commit` sparar inte `approvedByPhone`/`approvedByPosition` (telefon och befattning) | Kräver ny RPC-migration; beslut om den ska göras | Före STAGING-test av `offer-respond` | `G1-G4-DEL2-RESULTAT.md` §5, §10.5 |
| OR-2 | Repots regel att `ändring-begärd` räknas som besvarad saknas i `offer_respond_commit`; en EF-förkontroll skulle bryta requestId-reprisen | Kräver ny RPC-migration; beslut | Som OR-1 | Som OR-1 |
| MIG-1 | 13 migrationer har andra versionsnummer i repot än i STAGING (t.ex. `20261124000001` mot `20261124145958`). En `supabase db push` mot STAGING skulle se dem som nya. | **Beslutad, lokalt genomförd** (BESLUT-2026-11-28 MIG-1; T3-0): verifierbar mappning `vift-v2/supabase/MIGRATIONSMAPPNING.md` + `migrationsmappning.json` (`tests/local/migrationsmappning.js`) och installationsunderlag `INSTALLATIONSUNDERLAG-MIGRATIONER.md`; ingen repair/db push. Rättelse: 11 repo-filer (för 10 versioner + policydelen 20261124210747) har andra nummer, inte 13. *Tidigare förslag: `supabase migration repair` eller en mappning; mot tom LIVE fungerar filnamnsordningen (verifierat lokalt)* | Före varje push mot STAGING; 241 | `G1-G4-DEL2-RESULTAT.md` §10.10 |
| KÄLLA-1 | Hantering av VIFT-CRM:s inaktuella `supabase/`-spegel | **Beslutad, lokalt genomförd** (BESLUT-2026-11-28 KÄLLA-1, alternativ A; T3-0): spegeln borttagen (`git rm`, historiken kvar), `supabase/README.md` med remote/gren/commit, testerna via `VIFT_SERVER_ROOT`, kontroll `tests/serverkalla_guard.test.js`. *Tidigare förslag: A: ta bort katalogen ur klientgrenen (eller ersätt med README) och lägg till en kontroll som fallerar om den fylls; B: döp om till `supabase-spegel/` och synka bara med skript och sha256* | Före T3-0 avslutas | `vift-v2/supabase/AUKTORITATIV-KALLA.md` |

## Backlog – senare UX-etapp

**Status för samtliga:** Registrerad, ej påbörjad.

| Id | Önskemål | Relation |
|---|---|---|
| UX-1 | Tydligare, konsekvent färgmarkerad instämplingsknapp | 18, 142 |
| UX-2 | Bättre samspel mellan Starta arbete och Stämpla in | 18, 78, Ö1 |
| UX-3 | Genomgripande förbättring av rondering, särskilt på mobil: mallar, kontrollpunkter, avvikelser, bilder och kundrapporter. Referens: https://app.opsynk.com/shareable/SV2FGQ3CMO och användarens skärmbilder. | 27–31, 74, Ö3 |
| UX-4 | Bättre offertlista, kundkort, fastighetskort och övriga kvarvarande vyer (Ronderingsrapport, Säljchanser, kundkortets brödtext) | 20, 30, 232 |
| UX-5 | Enhetliga svenska datum- och tidsformat (t.ex. "2,5 h" kontra "2t 30m") | 260 |
| UX-6 | Begripliga AO-referenser i stället för interna id | 245 |
| UX-7 | Enklare dashboardanpassning | 25, 257 |
| UX-8 | Tydligare dialog för tilldelning, ansvarig och planering enligt affärsregeln AP | AP, AP-FEL-1 |

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
*Rättelse 2026-11-26: diff-vyn byggdes i F4-6 (22e8ed3). Texten nedan beskriver läget före F4-6.*
Konfliktlösning har tre val (hoppa/uppdatera/skapa ny) per rad, men saknar en sida-vid-sida diff-vy som jämför importvärdena mot befintliga värden.

### Kundexport — markerade kunder (punkt 51)
*Rättelse 2026-11-26: markerad export byggdes i F4-11 (1cfc543). Texten nedan beskriver läget före F4-11.*
Export stöder "alla" och "filtrerade" (aktiv sökning + typfiler), men inte manuellt markerade kunder (checkbox per rad).

### XLSX-import — deflate-komprimerade celler
Läsaren hanterar DEFLATE-komprimerade ZIP-poster via DecompressionStream('deflate-raw'). Om Excel-filer exporteras med metod=6 (DEFLATE64) faller läsaren. Ovanligt i Sverige-marknad, men oklart i framtiden.

### Generell import för övriga register (punkt 73)
*Rättelse 2026-11-26: övriga register byggdes i F4-2–F4-10. Texten nedan beskriver läget före Leverans F4; aktuell status finns under Leverans F4.*
ImportExportService.js är byggd som återanvändbar motor för alla register.
ImportWizard och kolumnmatchning stöder bara entityType='customer' idag. Fastigheter, objekt, artiklar och personal kräver egna fältmappningar och CRUD-logik — byggs i Fas 4.

---

## Blockerare kvarstående inför v1.0 staging

| Blockerare | Status | Åtgärd |
|------------|--------|---------|
| A1. objects_sensitive ej tilldelad i roller | **Verifierad i STAGING** · [S] c5-read per roll · *tidigare: ✅ ÅTGÄRDAD (e8edf00)* | AdminPage rollredigering: gruppen "Säkerhet & Åtkomst" tillagd |
| A2. Supabase store RLS — SQL-policy dokumenterad | **Verifierad i STAGING** · [S] `store_read_by_role` och RESTRICTIVE-skrivspärrar (punkt 215); LIVE: nej · *tidigare: ✅ ÅTGÄRDAD (b56a705)* | supabase/migrations/20260720000001_rls_store_table.sql — kräver körning i SQL Editor |
| A3. Storage offer-attachments — privat bucket + policies | **Verifierad i STAGING** · [S] GO-8a (punkt 224) · *tidigare: ✅ ÅTGÄRDAD (b56a705)* | supabase/migrations/20260720000002_storage_offer_attachments.sql — kräver körning |
| A4. EF-säkerhet: anon-key-autentisering i 3 EF:er | **Verifierad i STAGING** · [S] oinloggad REST och EF ger 401 (QA 2026-11-25) · *tidigare: ✅ ÅTGÄRDAD (dd7c5df)* | offer-attachment-upload/url/pdf: JWT-auth; send-push: rollkontroll+rate-limit; send-offer-email: korrekt store-åtkomst |
| B1. offerEvents/offerAttachments DataSync | **Verifierad i STAGING** · [S] F6.11b · *tidigare: BYGGD – BEHÖVER TEST* | 53862af: lagt till i DataSync._poll(). Verifiera 2-fönster-sync |
| B2. Övriga 5 entiteter vs DataSync | **Byggd** · verifiering: Källa saknas · *tidigare: BYGGD – BEHÖVER TEST* | contracts/inspections/recurringOrders/propertyContacts/propertyRoles — verifiera merge/delete/reload |
| C1. Edge Functions deploy | **Delvis byggd** · alla åtta EF:er i tabellen nedan finns i STAGING (`REFERENSLAGE.md`); LIVE: Källa saknas · *tidigare: EJ DEPLOYAD — KRÄVER SUPABASE-ÅTKOMST* | Kräver `supabase functions deploy` + secrets. Se RC1_STAGING_CHECKLISTA.md |
| C2. send-offer-email secrets | **Byggd (installerad i STAGING, ej prövad)** · send-offer-email v11 finns; secrets och utskick: Källa saknas · *tidigare: EJ KONFIGURERAT — KRÄVER SUPABASE-ÅTKOMST* | RESEND_API_KEY, FROM_EMAIL, FROM_NAME, PUBLIC_BASE_URL i Supabase Secrets |

## Edge Functions deploy-checklista (8 funktioner)

| Funktion | Säkerhetsstatus | Deploy-status | Secrets |
|----------|-----------------|---------------|---------|
| service-monitor | ✅ Säker | Installerad i STAGING (v15, cron av, punkt 250); LIVE: Källa saknas · *tidigare: EJ DEPLOYAD* | VAPID_*, MONITOR_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY |
| offer-token-validate | ✅ Säker | Installerad i STAGING (v11); LIVE: Källa saknas · *tidigare: EJ DEPLOYAD* | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY |
| offer-respond | ✅ Säker | Installerad i STAGING (v10); LIVE: Källa saknas · *tidigare: EJ DEPLOYAD* | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_* |
| offer-attachment-upload | ✅ Fixad (dd7c5df) | Installerad i STAGING (v13); LIVE: Källa saknas · *tidigare: EJ DEPLOYAD* | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY |
| offer-attachment-url | ✅ Fixad (dd7c5df) | Installerad i STAGING (v11); LIVE: Källa saknas · *tidigare: EJ DEPLOYAD* | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY |
| offer-pdf | ✅ Fixad (dd7c5df) | Installerad i STAGING (v10); LIVE: Källa saknas · *tidigare: EJ DEPLOYAD* | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY |
| send-push | ✅ Fixad (dd7c5df) | Installerad i STAGING (v9); LIVE: Källa saknas · *tidigare: EJ DEPLOYAD* | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL |
| **send-offer-email** | ✅ Fixad (dd7c5df) | Installerad i STAGING (v11); LIVE: Källa saknas · *tidigare: EJ DEPLOYAD* | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, **RESEND_API_KEY**, FROM_EMAIL, FROM_NAME, PUBLIC_BASE_URL |

**VAPID private key och RESEND_API_KEY läggs ALDRIG i config.js eller frontend — enbart i Supabase Secrets.**

## RC1-dokumentation

- `docs/RC1_E2E_TESTPROTOKOLL.md` — fullständigt E2E-testprotokoll A–F (74+ testfall)
- `docs/RC1_STAGING_CHECKLISTA.md` — 16-punkts staging-checklista med deploy-instruktioner
- `supabase/migrations/` — tre SQL-migreringar (RLS, Storage, pg_cron) *(historisk uppgift. 2026-11-26 har V3-grenen i denna arbetskopia 21 migrationer och `vift-v2` 24; synkningen ingår i punkt 242)*

---

## Framtida modul — Teknisk underhållsplanering (EJ PÅBÖRJAD)

| Roadmap-ID | Status | Prioritet | Dokument |
|---|---|---|---|
| `ROADMAP-UNDERHALL-2026-10-23` | 🔴 EJ PÅBÖRJAD / PLANERAD FRAMTIDA MODUL *(bekräftat 2026-11-26: Ej påbörjad; separat framtida modul; riskregister R-01; beroende: godkänd LIVE-release, punkt 241)* | Efter aktuell R6/R9B-stabilisering, centrala flödestester, RLS Fas 2 och godkänd LIVE-release | `docs/MASTERPLAN-UNDERHALLSPLAN.md` |

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
