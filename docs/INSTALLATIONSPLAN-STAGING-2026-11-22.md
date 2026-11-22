# VIFT CRM — Samordnad installationsplan för STAGING (2026-11-22)

Detta är den enda, samlade installationsplanen för att föra över denna branchs färdiga klientarbete till den faktiska STAGING-miljön (`yyzljlqyzzcbxmcdbual`), byggd på den direktverifierade jämförelsen i `docs/STAGING-FAKTISK-KOD-DIFF-2026-11-22.md` — inte på antaganden. Namngivning: **VIFT CRM**, ett sammanhängande system. Inga ChatGPT-konversationsnummer används som version/leverans.

**Status:** underlag för beslut. Ingen STAGING- eller LIVE-ändring är utförd av detta dokument. Alla steg i avsnitt 3–4 kräver separat, uttryckligt GO av Lucas Samuelsson innan de körs.

---

## 1. Vad som REDAN finns i STAGING — rör INTE, installera INTE om

Direktverifierat (läsande anslutning mot STAGING, se diff-dokumentet). Dessa ska **lämnas orörda**:

| Objekt | Status i STAGING | Konsekvens för denna plan |
|---|---|---|
| EF `time-entries-list` | v3, GET **och** POST, redan server-sidig payroll-filtrering | Branchens källa är nu återställd att matcha (commit `baeb9b4`) — ingen ny deploy av denna EF i sig, se §2a för varför klienten funkar direkt mot den redan idag |
| RLS-policy `store_timeentries_no_direct_select` | RESTRICTIVE SELECT TO authenticated, `key <> 'vift_timeEntries'` — redan installerad | Vårt eget migrationsförslag `20261120000002_PROPOSAL_timeentries_read_lockdown.sql` är markerat ÖVERSPELAT i filen — **installera inte**, skapar bara en duplicerad policy |
| RLS-policy `store_workorders_no_direct_select` | RESTRICTIVE SELECT TO authenticated, `key <> 'vift_workOrders'` — redan installerad | Bekräftar att arbetsorderdata redan har samma klass av serverskydd som tidposter — ingen åtgärd |
| EF `service-monitor` | **v15**, deployad, kör AO-skapande via atomisk `work_order_create`-RPC (inte batch-upsert) | Branchens källa återställd att matcha exakt (commit `84cbafd`) — **ingen ny deploy** |
| pg_cron-jobb `vift-service-monitor-daily` | Existerar, `schedule = '0 6 * * *'`, **`active = false`** | Redan skapat (manuellt steg, `supabase/manual/setup_service_monitor_cron.sql`, körts tidigare). Återstående beslut är enbart **aktivering** — se §3, egen GO |
| RPC `work_order_create(p_ao jsonb, p_idempotency_key text, p_client_id text)` | Finns i STAGING-databasen (signatur bekräftad) | **Gap, inte en bugg:** denna funktions `CREATE FUNCTION`-SQL finns INTE som migration i detta repo (sökt igenom hela `supabase/migrations/` — inget resultat). Se §5, punkt G1 |
| Storage-bucket `offer-attachments` | Finns, privat, 50 MB-gräns | Orört, obesläktat med denna leverans |

---

## 2. Vad som SKA installeras/uppdateras

### 2a. Klientkod (vanlig frontend-filsynk, INGA Supabase-ändringar)

Dessa filer kan gå till STAGING-repot (`VIFT-CRM-Staging`, branch `staging/gh-pages`) som en vanlig kodsynk — ingen DB/EF-åtgärd krävs för att de ska fungera, eftersom de bara pratar med EF:er/policyer som **redan finns**:

| Fil | Version | Beror på (redan i STAGING) |
|---|---|---|
| `src/data/state.js` | v52 | — (diff-aware persist, ren klientlogik) |
| `src/data/storage.js` | v12 | — (write-path timeout, ren klientlogik) |
| `src/services/AuthService.js` | v17 | — |
| `src/services/TimeEntriesReadService.js` | v1 (ny) | `time-entries-list` EF (redan v3, GET stöds) |
| `src/services/ServiceIntervalService.js` | v5 | — |
| `src/pages/ServiceIntervalsPage.js` | v1 (ny) | — (ren klientsida, återanvänder befintliga modaler) |
| `src/pages/Router.js`, `src/components/Sidebar.js`, `src/pages/PropertyDetailPage.js` | — | — |
| `index.html` | — | alla `?v=N` redan bumpade i denna branch |

**Dessa kan testas i STAGING OMEDELBART efter filsynk**, utan att vänta på §2b, förutom bilddelen av §2c nedan (se testfall i §4).

### 2b. Nya Supabase-objekt — kräver separat GO, körs i DENNA ordning

STAGING-diffen bekräftar: bucketen `workorder-images` finns **inte** ännu. Detta är den enda delen av hela leveransen som kräver en faktisk ny installation i Supabase (inte bara en kodsynk):

1. **Skapa privat bucket** `workorder-images` (10 MB-gräns, `image/jpeg|jpg|png|webp`) — SQL i `src/services/WorkOrderImageService.js`s filhuvud.
2. **Storage-policies** — alla tre `service_role`-only (SELECT/INSERT/DELETE), samma filhuvud, senast uppdaterat 2026-11-22 (DELETE är nu också `service_role`-only, inte `TO authenticated`).
3. **Deploy EF `work-order-image-url`** (`supabase functions deploy work-order-image-url`).
4. **Deploy EF `work-order-image-upload`** (`supabase functions deploy work-order-image-upload`).
5. **Deploy EF `work-order-image-delete`** (`supabase functions deploy work-order-image-delete`, ny denna omgång).
6. **Synka klientkoden** `src/services/WorkOrderImageService.js` (v3) + `src/pages/WorkOrderDetailPage.js` (v76) — dessa MÅSTE gå ut samtidigt som/efter steg 1–5, annars pratar klienten mot EF:er som inte finns än.

Ordningen 1→6 är vald så att ingen mellanliggande deploy lämnar klienten pratande mot ett halvfärdigt backend-läge.

### 2c. Migrationer

**Ingen ny migration behöver köras i STAGING för tidposter/arbetsordrar** — skyddet finns redan (§1). De två migrationsförslagen i detta repo:

- `20261120000001_PROPOSAL_push_subscriptions_index.sql` — **status okänd mot STAGING**, inte del av den genomförda diffen (den täckte bara tidposter/service-monitor/_shared). Kräver en egen, separat kontroll (`SELECT indexname FROM pg_indexes WHERE tablename='push_subscriptions'`) innan GO — gissa inte.
- `20261120000002_PROPOSAL_timeentries_read_lockdown.sql` — markerad ÖVERSPELAD i filen (se §1). **Installera inte.**

---

## 3. service-monitor — aktiveringsberedskap (INGEN ny installation, bara ett aktiveringsbeslut)

EF:en och cron-jobbet finns redan. Det som krävs innan `active` sätts till `true` är ett kontrollerat test, inte en deploy:

### Förutsättningar (redan uppfyllda eller att bekräfta)
- [x] Idempotenskonflikten med klientens `runDailyCheck()` är löst (denna branch, punkt 136 i MASTERPLAN.md) — tidigare hade en inloggning kunnat tysta service-monitors push samma dag.
- [ ] Bekräfta i Supabase Dashboard att secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`, `SERVICE_MONITOR_SECRET` är satta för STAGING-projektet (inga värden i denna plan, bara en närvarokontroll).

### Manuellt, kontrollerat testanrop (INNAN aktivering, secret aldrig i klartext i denna plan)
```
POST /functions/v1/service-monitor
Header: X-Monitor-Secret: <ur Vault, aldrig i kod/chatt>
```

### Testchecklista (manuell, i STAGING, före aktivering av cron)
- [ ] Anrop utan förfallet serviceintervall → `notified: 0`, `aoCreated: 0`, ingen push.
- [ ] Ett intervall inom `reminderDays` → riktig push till `responsibleStaffId` (verifiera på enhet).
- [ ] SAMMA anrop en gång till utan ändring → `notified: 0` för samma period (idempotens via `lastNotificationSentForDueDate`) — ingen dubblettpush.
- [ ] Ett intervall med `autoCreateAO: true` och nådd tröskel → en AO skapas via `work_order_create`-RPC:n (atomiskt, bekräftat i källan) — kör igen, ingen andra AO för samma period.
- [ ] En ansvarig utan matchande `auth.users`-konto → broadcast-fallback till alla aktiva prenumerationer — bekräfta att detta är avsett beteende för er.
- [ ] `vift_serviceMonitorLog` fylls, trimmas vid 90 poster.
- [ ] En riktig inloggning direkt efter en körning → klientens egen `runDailyCheck()`-notis OCH service-monitorens push samexisterar, ingen tystar den andra (verifierar punkt 136).

### Känd, oförändrad, lägre-prioriterad begränsning
`service-monitor`s skrivning av `vift_properties` (notismarkeringar) är fortfarande ett olåst läs-ändra-skriv-block (bara AO-skapandet självt gick via atomisk RPC i v15, inte denna del) — en samtidig redigering av SAMMA fastighet exakt under det dagliga cronfönstret kan i teorin tappas bort. Låg sannolikhet (en körning/dag). Föreslås som framtida, egen atomisk-RPC-uppgift — inte en blockerare för aktivering.

**Efter godkänd testchecklista:** aktivering är `SELECT cron.alter_job(<jobid>, active := true);` (toggle av det redan existerande jobbet — inte ett nytt `cron.schedule`-anrop). Kräver egen, separat GO, skild från filsynken i §2a/§2b.

---

## 4. Testfall för STAGING-funktionstest (efter §2a + §2b)

### Behörigheter
- [ ] Fältarbetare utan `payroll_view`: `time-entries-list` returnerar bara egna poster (redan EF-sidigt, bekräfta klienten inte längre läser `vift_timeEntries` via `Storage.getAll()` direkt — ska ge `null`/saknas för den nyckeln, blockerat av den redan installerade RLS-policyn).
- [ ] Samma användare loggar ut/in som en ANNAN roll (med `payroll_view`) → ser alla poster, ingen kvarbliven cache från förra användaren (`_lastWrittenJSON`/localStorage rensas korrekt vid `Auth._resolveUser()`).

### Bildhantering (kräver §2b installerat)
- [ ] Ladda upp en bild på en AO man har `ao_edit`/`ao_checklist` och synlighet för → lyckas, `imagePath` sparas.
- [ ] Försök (via ett eget, direkt API-anrop med giltig JWT, inte via UI) ladda upp till en AO man INTE har synlighet för → 403 från `work-order-image-upload`.
- [ ] Ladda upp en fil som INTE är en bild med förfalskad `Content-Type: image/jpeg` → 400 `invalid_file_type` (verifierar sniffMime-fixen).
- [ ] Hämta signerad URL för en bild på en AO man inte ser → `work-order-image-url` utelämnar den (tyst, inte en krasch).
- [ ] Radera en loggpost med bild → bilden försvinner i Storage ENDAST efter bekräftad DB-skrivning (verifiera ordningen genom att simulera ett nätverksfel mellan stegen, t.ex. koppla från nätet precis efter klick).
- [ ] Försök (direkt API-anrop) radera en bild som hör till en AO man saknar `ao_edit`/`ao_checklist` för → 403 från `work-order-image-delete`.

### Arbetsordrar
- [ ] Vanlig AO-redigering (byt titel) → endast `workOrders`-nyckeln skickas i `Storage.setAll()` (diff-aware persist, kontrollera nätverksfliken/loggen — INTE alla ~34 nycklar).
- [ ] Simulera en avstannad anslutning vid `deleteLogEntry()` (t.ex. nätverksthrottling i devtools) → UI visar felmeddelande inom ~20s, hänger inte längre obegränsat.

### Tidregistrering
- [ ] Stämpla tid som fältarbetare → syns korrekt i egen vy, syns INTE i en annan fältarbetares vy.
- [ ] `payroll_view`-roll ser allas tid, inkl. nyss stämplad.

### Serviceintervall
- [ ] Ny sida `#/serviceintervall` listar intervall från ALLA fastigheter, filter/sök fungerar.
- [ ] "Markera utförd"/"Redigera"/"Lägg till" från den nya sidan sparar korrekt (verifierar att den tidigare dolda `fn:`-knappbuggen i `PropertyDetailPage` är fixad) och synkar tillbaka till fastighetskortets egen flik.

---

## 5. Backup, kontrollpunkter, rollback, kvarstående gap

### Backup (innan §2b)
- [ ] Exportera `vift_workOrders`-raden (`SELECT value FROM store WHERE key='vift_workOrders'`) till en lokal fil — bilddata berörs inte av denna leverans (ingen befintlig bild flyttas/skrivs över), men en ordinarie backup-punkt innan nya Storage-policyer installeras är god praxis.
- [ ] Notera bucket-listan (`SELECT * FROM storage.buckets`) och policy-listan (`SELECT * FROM pg_policies WHERE tablename='objects'`) FÖRE §2b, för en exakt rollback-referens.

### Kontrollpunkter (stoppa och eskalera till Lucas om något av detta inte stämmer)
- Efter §2b steg 1–2: `SELECT * FROM storage.buckets WHERE id='workorder-images'` → `public = false`.
- Efter varje EF-deploy: ett `OPTIONS`-anrop mot EF:en ska ge 200 (sanity, inte ett riktigt test).
- Efter §2a+§2b: en fullständig inloggning + en vanlig AO-öppning ska INTE visa något JS-fel i konsolen.

### Rollback
- §2a (klientkod): återställ föregående commit på STAGING-repot — inga serverobjekt att rulla tillbaka.
- §2b (Supabase-objekt): `DROP POLICY`/`DELETE FROM storage.buckets WHERE id='workorder-images'` (endast om bucketen är tom — kontrollera innan) + `supabase functions delete <namn>` för de tre nya EF:erna. Befintliga bilder (det finns inga ännu, bucketen är ny) påverkas inte.
- §3 (aktivering): `SELECT cron.alter_job(<jobid>, active := false);` — omedelbar, ofarlig, återställer till dagens läge.

### Kvarstående gap (flaggat, inte löst här — kräver separat beslut)
- **G1 — `work_order_create`-RPC saknar committed migration.** Funktionen finns i STAGING (signatur bekräftad) men dess `CREATE FUNCTION`-SQL finns inte i `supabase/migrations/`. Behövs INTE för att denna leverans ska fungera i STAGING (RPC:n finns redan där), men är ett repo-fullständighetsgap: en framtida ny miljö (eller en eventuell LIVE-installation senare) kan INTE återskapas från detta repos migrationer ensamma. Åtgärd: hämta `SELECT pg_get_functiondef('work_order_create'::regproc)` från STAGING och committa som en egen migration — kräver STAGING-åtkomst ingen i denna session har.
- **G2 — `push_subscriptions`-indexförslaget** är overifierat mot STAGINGs faktiska indexlista (se §2c).
- **G3 — rondering/avvikelse-bilder** (samma inbäddade-bas64-mönster som arbetsorderbilder hade) är fortfarande oflyttade — flaggat tidigare, inte byggt, väntar på prioritering.

---

## 6. GO/NO-GO per del

| Del | Status | GO krävs för |
|---|---|---|
| §2a Klientkod (persist-diff, tidposter, serviceintervall-sida, write-timeout) | **Klar, testad lokalt/isolerat (73/73 egna test), redo för STAGING-filsynk** | Filsynk till STAGING-repot |
| §2b Nya Supabase-objekt (bucket + 3 policies + 3 EF-deploys) | **Kodklart (`tsc --strict` OK), EJ installerat** | Separat GO: bucket-skapande + policy-installation + EF-deploy, i den ordning som anges |
| §3 service-monitor-aktivering | **Redan deployad (v15), redan korrekt i repo** — endast testchecklistan i §3 återstår | Separat GO: dels för testanropen, dels (efter godkänd checklista) för `cron.alter_job(active:=true)` |
| §4 Funktionstest | Kan köras i STAGING så snart §2a (+ §2b för bilddelen) är installerat | Ingen ytterligare GO utöver ovanstående |
| G1–G3 (gap) | Flaggade, ej åtgärdade | Kräver STAGING-åtkomst Lucas/ChatGPT redan har, inte denna session |

**Sammanfattning:** inget i denna plan kräver att vi gissar oss fram längre — allt i §1 är direktverifierat mot STAGING, allt i §2–3 är kodklart i denna branch. Nästa steg är Lucas' GO per rad i tabellen ovan, inte mer utvecklingsarbete för att nå hit.
