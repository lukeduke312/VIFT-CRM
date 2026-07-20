# VIFT CRM 1.0.0 RC1 — Slutlig staging-runbook (v4)
Datum: 2026-07-20  
Branch: `claude/vift-system-restructure-8fUme`  
Senaste commit: se `git log --oneline -1`

Markera ✅ när varje punkt är verifierad av en person.
Alla punkter måste vara KLARA och signerade innan RC1-taggen sätts.

---

## Stagingbegränsningar (OBLIGATORISKA)

Staging ska uteslutande använda:
- Separat Supabase-projekt — ALDRIG delat med produktion
- Syntetiska kunder och fastigheter
- Fiktiv personal (inga verkliga personnummer, löner, kontaktuppgifter)
- Inga riktiga löneuppgifter
- Inga riktiga portkoder eller larmkoder
- Inga riktiga kunddokument eller avtal
- Separat testdomän eller staging-URL (inte app.viftfast.se)

---

## STEG 1: Kontrollera branch och senaste commit

```bash
git status
git log --oneline -5
```
→ Verifiera att du är på `claude/vift-system-restructure-8fUme`.  
→ Senaste commit ska vara `5070954` eller nyare.

---

## STEG 2: Kontrollera att projektet är separat staging

```bash
supabase projects list
supabase status
```
→ Projekt-ref och URL ska INTE matcha produktionsprojektet.  
→ Kräver explicit skriftlig bekräftelse av ansvarig innan du går vidare.

---

## STEG 3: Kontrollera Supabase project-ref

```bash
cat supabase/.temp/project-ref 2>/dev/null || supabase link --project-ref <STAGING-REF>
```
→ Verifiera att rätt projekt-ref är länkat.

---

## STEG 4: Säkerhetskopiera stagingdatabasen

Dashboard → Database → Backups → Create backup.  
Spara backup-ID och tidsstämpel i din logg.

---

## STEG 5: Dry-run av migrationerna

```bash
supabase db push --dry-run
```
Förväntat utfall — exakt dessa 9 filer i denna ordning:
```
20260720000000_create_core_tables.sql        ← skapar store + push_subscriptions
20260720000001_rls_store_table.sql           ← RLS + app_users
20260720000002_storage_offer_attachments.sql
20260720000003_pg_cron_service_monitor.sql   ← no-op (avsiktligt tom)
20260720000004_property_sensitive_access.sql
20260720000005_store_key_rls.sql
20260720000006_app_users_lifecycle.sql
20260720000007_sensitive_access_audit.sql
20260720000008_strip_passwords_from_store.sql
```
→ `00000` måste komma först — den skapar grundtabellerna som `00001` förutsätter.  
→ Cron-SQL (`supabase/manual/setup_service_monitor_cron.sql`) ingår inte — hanteras inte av migrationshistoriken.  
→ Om fler eller färre filer visas, eller om ordningen avviker: **avbryt och undersök.**  
→ Ingen `migration repair` används.

---

## STEG 6: Kör migrationer 00000–00008

```bash
supabase db push
```
→ Ska köra exakt de 9 migrationerna från dry-run ovan.  
→ Använd `--include-all` endast om dry-run eller migrationshistoriken visar ett uttryckligt behov — redovisa i så fall orsaken innan kommandot körs.  
→ Granska ALL output. Stoppa vid varje NOTICE om felbetingelse.

Verifiera per migration:

**00000 — store + push_subscriptions**
```sql
-- Tabellerna existerar
SELECT tablename FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename IN ('store', 'push_subscriptions');
-- → 2 rader

-- Primary keys och unique constraint
SELECT conname, contype FROM pg_constraint
  WHERE conrelid IN ('store'::regclass, 'push_subscriptions'::regclass)
  ORDER BY conname;
-- → store_pkey (p), push_subscriptions_pkey (p),
--   push_subscriptions_endpoint_key (u), push_subscriptions_user_id_fkey (f)

-- Tabellerna är tomma (ny staginginstans)
SELECT count(*) FROM store;              -- → 0
SELECT count(*) FROM push_subscriptions; -- → 0
```

**00001 — RLS + app_users**
```sql
-- anon nekas
SET ROLE anon; SELECT count(*) FROM store;
-- → ERROR: permission denied for table store
RESET ROLE;
-- authenticated utan app_users-rad → 0 rader
SET ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000"}';
SELECT count(*) FROM store;
RESET ROLE;
-- → 0 rows
```

**00002 — offer-attachments bucket**
```sql
SELECT public FROM storage.buckets WHERE id = 'offer-attachments';
-- → false (privat)
SELECT policyname, cmd FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname LIKE '%offer%';
-- → endast service_role-policyer
```

**00003 — no-op**  
→ Ska ge NOTICE: "Migration 00003: avsiktligt tom."

**00004 — property_sensitive_access**
```sql
-- Känsliga fält borttagna ur store
SELECT jsonb_path_exists(value, '$[*].doorCode')
  FROM store WHERE key = 'vift_propertyObjects';
-- → false
SELECT jsonb_path_exists(value, '$[*].accessCode')
  FROM store WHERE key = 'vift_properties';
-- → false
-- Backup-tabeller finns och är skyddade
SELECT count(*) FROM store_backup_prop_objects_20260720;
SELECT count(*) FROM store_backup_properties_20260720;
-- Authenticated nekas direkt åtkomst till backup
SET ROLE authenticated; SELECT * FROM store_backup_prop_objects_20260720 LIMIT 1;
-- → ERROR: permission denied
RESET ROLE;
-- Migrerade poster
SELECT count(*) FROM property_sensitive_access;
```

**00005 — nyckelbaserad store-RLS**
```sql
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'store';
-- → store_service_role_all, store_active_read, store_active_write_safe, store_admin_write_protected
```

**00006 — app_users lifecycle-funktioner**
```sql
\df provision_vift_user
\df deactivate_vift_user
\df check_app_users_health
SELECT * FROM check_app_users_health();
```

**00007 — sensitive_access_audit**
```sql
SELECT * FROM sensitive_access_audit LIMIT 1;
-- → tom tabell
SET ROLE authenticated;
INSERT INTO sensitive_access_audit (action, status) VALUES ('read','allowed');
-- → ERROR: permission denied
RESET ROLE;
```

**00008 — strip lösenordsfält ur vift_staff**
```sql
SELECT jsonb_path_exists(value, '$[*].passwordHash') FROM store WHERE key = 'vift_staff';
-- → false
SELECT jsonb_path_exists(value, '$[*].password') FROM store WHERE key = 'vift_staff';
-- → false
```

---

## STEG 8: Provisionera och verifiera första admin

```sql
-- Hitta admin-UID i Dashboard → Authentication → Users
SELECT provision_vift_user(
  '<admin-auth-uid>',
  'ST-001',
  'admin',
  true
);
SELECT * FROM check_app_users_health();
-- → admins: OK, omappade auth: 0 (eller antal ej provisionerade)
```

Provisionera alla övriga användare med syntetiska konton:
```sql
SELECT provision_vift_user('<uid>', '<staff_id>', '<role_id>', false);
-- Upprepa per användare
SELECT * FROM check_app_users_health();
-- → omappade auth: 0
```

---

## STEG 9: Verifiera login och DataSync

Logga in i CRM med admin-konto.  
- Data laddas utan fel
- DataSync polling fungerar (kontrollera Network i DevTools)
- Sidebar visar korrekt roll och namn
- `state.currentUser` i DevTools Console innehåller korrekt staff-post

---

## STEG 10: Verifiera RLS med aktiv, inaktiv och omappad användare

```sql
-- Aktiv användare med app_users-rad kan läsa
-- (testa via CRM-appen — bör se data)

-- Inaktivera testanvändare
SELECT deactivate_vift_user('<test-uid>');
-- Logga in som den inaktiverade användaren i CRM
-- → Bör nekas (inga store-rader returneras)

-- Omappad auth-användare (finns i auth.users men ej i app_users)
-- → Bör nekas direkt
```

---

## STEG 11: Verifiera att lösenordsfält är borta

```sql
SELECT jsonb_path_exists(value, '$[*].passwordHash') FROM store WHERE key = 'vift_staff';
-- → false
SELECT jsonb_path_exists(value, '$[*].password') FROM store WHERE key = 'vift_staff';
-- → false
SELECT jsonb_path_exists(value, '$[*].pin') FROM store WHERE key = 'vift_staff';
-- → false
SELECT jsonb_path_exists(value, '$[*].email') FROM store WHERE key = 'vift_staff';
-- → true (övriga fält bevarade)
```

---

## STEG 12: Verifiera sensitive-data-migreringen

```sql
-- Antal migrerade poster
SELECT count(*) FROM property_sensitive_access;

-- Känsliga fält borttagna ur store
SELECT jsonb_path_exists(value, '$[*].doorCode') FROM store WHERE key = 'vift_propertyObjects';
-- → false
SELECT jsonb_path_exists(value, '$[*].keyInformation') FROM store WHERE key = 'vift_propertyObjects';
-- → false

-- Korrekt rollback-SQL är dokumenterad om återgång behövs:
-- UPDATE store SET value = (SELECT value FROM store_backup_prop_objects_20260720 LIMIT 1)
--   WHERE key = 'vift_propertyObjects';
```

---

## STEG 13: Verifiera backup-tabellernas skydd

```sql
-- Authenticated kan inte läsa backup-tabeller
SET ROLE authenticated;
SELECT * FROM store_backup_prop_objects_20260720 LIMIT 1;
-- → ERROR: permission denied
SELECT * FROM store_backup_properties_20260720 LIMIT 1;
-- → ERROR: permission denied
RESET ROLE;

-- RLS är aktiverat
SELECT tablename, rowsecurity FROM pg_tables
  WHERE tablename IN (
    'store_backup_prop_objects_20260720',
    'store_backup_properties_20260720'
  );
-- → rowsecurity: true, true
```

---

## STEG 14: Verifiera privat Storage-bucket

```sql
SELECT id, name, public FROM storage.buckets WHERE id = 'offer-attachments';
-- → public: false
```

Testa att anon inte kan läsa:
```bash
curl "https://<SUPABASE-URL>/storage/v1/object/offer-attachments/test"
# → 400 eller 403
```

---

## STEG 15: Sätt Secrets i Dashboard + Vault-secret

Dashboard → Project Settings → Edge Functions → Secrets:
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `FROM_EMAIL`
- `FROM_NAME`
- `PUBLIC_BASE_URL`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_EMAIL`
- `SERVICE_MONITOR_SECRET` (**obligatorisk** — tom sträng blockerar service-monitor)

Skapa Vault-secret för cron-jobbet (kör i SQL Editor):
```sql
SELECT vault.create_secret(
  '<samma-värde-som-SERVICE_MONITOR_SECRET>',
  'SERVICE_MONITOR_SECRET',
  'Cron-hemlighet för service-monitor Edge Function'
);
-- Verifiera att den finns (visar EJ decrypterat värde):
SELECT id, name, description FROM vault.secrets WHERE name = 'SERVICE_MONITOR_SECRET';
```

---

## STEG 16: Deploya samtliga Edge Functions

```bash
# JWT-skyddade (verify_jwt = true, standard)
supabase functions deploy get-sensitive-fields
supabase functions deploy set-sensitive-fields
supabase functions deploy send-push
supabase functions deploy offer-attachment-upload
supabase functions deploy offer-pdf
supabase functions deploy send-offer-email

# Publika / cron (verify_jwt = false i config.toml)
supabase functions deploy offer-token-validate --no-verify-jwt
supabase functions deploy offer-respond --no-verify-jwt
supabase functions deploy offer-attachment-url --no-verify-jwt
supabase functions deploy service-monitor --no-verify-jwt
```

Verifiera att 10 EF:er visas i Dashboard → Edge Functions.

---

## STEG 17: Testa varje Edge Function manuellt

**service-monitor (Model B auth):**
```bash
# Utan X-Monitor-Secret → 401
curl -X POST <URL>/functions/v1/service-monitor
# → {"error":"Unauthorized"}

# Med fel secret → 401
curl -X POST <URL>/functions/v1/service-monitor -H "X-Monitor-Secret: fel"
# → {"error":"Unauthorized"}

# Med Authorization: Bearer service_role → 401 (räcker inte)
curl -X POST <URL>/functions/v1/service-monitor \
  -H "Authorization: Bearer <service_role_key>"
# → {"error":"Unauthorized"}

# Med korrekt secret → 200
curl -X POST <URL>/functions/v1/service-monitor \
  -H "X-Monitor-Secret: <SERVICE_MONITOR_SECRET>"
# → {"checked": N, "notified": M, "aoGenerated": K}
```

**get-sensitive-fields:**
```bash
# Utan objects_sensitive → 403
curl -X POST <URL>/functions/v1/get-sensitive-fields \
  -H "Authorization: Bearer <JWT-utan-objects_sensitive>" \
  -H "Content-Type: application/json" -d '{"objectId":"OBJ-001"}'
# → {"error":"Forbidden: objects_sensitive required"}

# Med objects_sensitive → 200
curl -X POST <URL>/functions/v1/get-sensitive-fields \
  -H "Authorization: Bearer <JWT-med-objects_sensitive>" \
  -H "Content-Type: application/json" -d '{"objectId":"OBJ-001"}'
# → {"doorCode":"...", ...}
```

**set-sensitive-fields — customer_manage räcker inte:**
```bash
curl -X POST <URL>/functions/v1/set-sensitive-fields \
  -H "Authorization: Bearer <JWT-med-customer_manage-UTAN-objects_sensitive>" \
  -H "Content-Type: application/json" \
  -d '{"objectId":"OBJ-001","doorCode":"9999"}'
# → {"error":"Forbidden"}  HTTP 403
```

**offer-attachment-url — 7 testfall (se filhuvudet i EF:en):**
1. JWT utan offer_manage → 403
2. Inaktiv användare → 403
3. Manipulerat attachmentId (annan offert) → 403
4. offerId matchar ej bilagan → 403
5. Borttagen bilaga → 404
6. Korrekt intern åtkomst → 200 + signerad URL
7. Korrekt publik tokenåtkomst → 200 + signerad URL

**Kontrollera HTTP-säkerhetsrubriker på publika EF:er:**
```bash
curl -I -X POST <URL>/functions/v1/offer-token-validate \
  -H "Content-Type: application/json" -d '{"t":"dummy"}'
# Förväntat i svarshuvuden:
# Cache-Control: no-store, no-cache
# Referrer-Policy: no-referrer
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY
```

---

## STEG 18: Testa public-offer, bilagor, PDF och kundsvar

1. Öppna offertlänk med `?t=<token>`
2. → URL ändras omedelbart till `#t=<token>` i adressfältet
3. `F5` (uppdatera sidan) → laddas korrekt med `#t=` fragment
4. Bakåt-knapp → fragment kvarstår
5. Ladda ned bilaga → fungerar (signerad URL, TTL 10 min)
6. Skriv ut → fungerar (token syns i adressfält men skickas inte som Referer)
7. Svara på offert → fungerar
8. DevTools → Network → inga externa domäner kontaktas
9. Generera PDF → 200, korrekt PDF returneras
10. Kontrollera att auditloggen registrerar känsliga fältåtkomster:
    ```sql
    SELECT action, status, fields, ts FROM sensitive_access_audit
    ORDER BY ts DESC LIMIT 5;
    ```

---

## STEG 19: Testa e-post

Skicka testoffert från CRM till syntetisk e-postadress.  
Verifiera:
- E-post mottagen med offertlänk i `#t=`-format
- Från-adress korrekt (`FROM_EMAIL`)
- Bilagor inkluderade om valda

---

## STEG 20: Testa push-notiser

Testa från CRM med ett konto med push-prenumeration.  
- Enskild notis till eget konto → fungerar
- Broadcast (admin-behörighet) → fungerar
- Notis till annan användare med JWT utan admin → nekas (IDOR-fix verifierad)

---

## STEG 21: Testa service-monitor manuellt

```bash
curl -X POST <URL>/functions/v1/service-monitor \
  -H "X-Monitor-Secret: <SERVICE_MONITOR_SECRET>"
# → {"checked": N, "notified": M, "aoGenerated": K}
```
Notera svaret. Kontrollera att lämpliga store-uppdateringar sker.

---

## STEG 22: Skapa cron-jobbet sist (MANUELLT i SQL Editor)

Cron-installationen hanteras **inte** av migrationshistoriken.  
Ingen `migration repair` används. Migrationshistoriken i databasen berörs inte.

**Förutsättningar — samtliga ska vara avbockade:**
- [ ] Vault-secret `SERVICE_MONITOR_SECRET` skapad (steg 15)
- [ ] `service-monitor` deployad (steg 16)
- [ ] Felaktig secret testad → 401 (steg 17)
- [ ] Korrekt secret testad → 200 (steg 17)
- [ ] Automatisk AO och dubblettskydd verifierade (steg 21)
- [ ] Stagingprojektet verifierat i föregående steg

Öppna `supabase/manual/setup_service_monitor_cron.sql` och kör hela innehållet i Supabase SQL Editor.

Verifiera efter körning:
```sql
SELECT jobname, schedule, command FROM cron.job
  WHERE jobname = 'vift-service-monitor-daily';
-- → 1 rad

SELECT invoke_service_monitor();
-- → NOTICE om anrop skickat
```

**Rollback vid behov:**
```sql
SELECT cron.unschedule('vift-service-monitor-daily');
DROP FUNCTION IF EXISTS invoke_service_monitor();
-- Vault-hemligheten tas bort manuellt i Dashboard → Vault.
```

---

## STEG 23: Verifiera första cron-körningen

Dagen efter (06:00 UTC):
```sql
SELECT jobid, status, return_message, start_time
  FROM cron.job_run_details
 WHERE jobid = (
   SELECT jobid FROM cron.job WHERE jobname = 'vift-service-monitor-daily'
 )
 ORDER BY start_time DESC LIMIT 5;
-- → status: succeeded (inte 'failed')
```

Om status är 'failed': kontrollera att Vault-secret är korrekt och att service-monitor svarar.

---

## STEG 24: Kör hela E2E-testprotokollet

`docs/RC1_E2E_TESTPROTOKOLL.md` — alla testfall A–F: GODKÄND.

---

## STEG 25: Kör mobiltest

Testa på mobil (iOS/Android) med testanvändare:
- Login
- Ladda data
- Se offert via public-offer-länk
- Ladda ned bilaga
- Ta emot push-notis

---

## STEG 26: Dokumentera resultat

Fyll i testprotokoll, notera:
- Datum och klockslag för varje verifierat steg
- Eventuella avvikelser och hur de åtgärdades
- Backup-ID från steg 4

---

## STEG 27: Tagga v1.0.0-rc1

**Taggas ENDAST om alla steg 1–26 är avbockade och signerade.**

```bash
git tag -a v1.0.0-rc1 -m "VIFT CRM 1.0.0 RC1"
git push origin v1.0.0-rc1
```

Synka INTE main eller gh-pages förrän alla stagingblockerare är avbockade.

---

## PRODUKTIONSBLOCKERARE — måste åtgärdas INNAN produktionsrelease

Dessa risker är kända och **acceptabla för staging med syntetisk testdata**.  
De **BLOCKAR produktion** och kräver ett separat beslut.

### BLOCKER-1: Lönedata läcks i HTTP-svar till alla aktiva användare

**Beskrivning:** `vift_timeEntries` hämtas i ett enda `Storage.getAll()`-anrop och skickas till ALLA aktiva användare i HTTP-svaret. Filtreringen är client-side i `DataSync._poll()`.

**Konsekvens i produktion:** En tekniker kan se alla kollegors tidrapporter i DevTools → Network, utan att appen visar dem.

**Krav för produktion (v1.1):** Normaliserat `time_entries`-schema med per-rad RLS eller separat EF för filtrerade poster.

---

### BLOCKER-2: Operativa store-nycklar saknar server-side skrivkontroll per behörighet

**Beskrivning:** Aktiva användare kan skriva till `vift_workOrders`, `vift_offers` m.fl. direkt via Supabase REST utan server-side behörighetskontroll.

**Krav för produktion (v1.1):** Normaliserat schema med per-tabell RLS, eller EF-gating för skrivoperationer.

---

## Kvarvarande staging- och produktionsrisker

| Risk | Allvarlighet | Kategori | Mitigation i RC1 | Plan |
|---|---|---|---|---|
| `vift_timeEntries` läcks i HTTP-svar | **HÖG** | **PRODUKTIONSBLOCKER** | Client-side filter; syntetisk stagingdata | v1.1: per-rad RLS |
| Operativa store-nycklar utan server-side skrivkontroll | **HÖG** | **PRODUKTIONSBLOCKER** | app_users.active; kritiska register EF-gated | v1.1: normaliserat schema |
| `app_users.is_admin` synkroniseras ej automatiskt | Låg | Drift | Manuell uppdatering; `provision_vift_user()` finns | v1.1: trigger/EF |
| Signerade URL:er reusable under TTL (10 min) | Låg | Design | Kort TTL; ny URL per anrop | Inget ytterligare |
| Offerttoken i `#t=` kan kopieras av kunden | Låg | Design | TTL; revokering blockerar ny URL-generering | Inget ytterligare |

---

Signatur (staging-godkänd): ____________________  Datum: __________
