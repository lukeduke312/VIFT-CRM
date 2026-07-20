# VIFT CRM 1.0.0 RC1 — Staging-checklista (v3)
Datum: 2026-07-20  
Branch: `claude/vift-system-restructure-8fUme`

Markera ✅ när varje punkt är verifierad av en person.
Alla punkter måste vara KLARA och signerade innan RC1-taggen sätts.

---

## Preflight — INNAN migration körs

- [ ] **P1. Kör app_users-hälsokontroll**
  ```sql
  SELECT * FROM check_app_users_health();
  ```
  → `admins`-raden ska visa `OK` (minst en aktiv admin med `is_admin = true`).  
  Provisionera annars: `SELECT provision_vift_user('<uid>', 'ST-001', 'admin', true);`

- [ ] **P2. Kontrollera att projektet är länkat till STAGING, inte produktion**
  ```bash
  supabase projects list
  supabase status
  ```
  → Verifiera projekt-ref och URL. Kräver explicit bekräftelse.

- [ ] **P3. Ta databasbackup i Supabase Dashboard**
  Dashboard → Database → Backups → Create backup.  
  Spara backup-ID och tidsstämpel.

- [ ] **P4. Dry-run av migrationerna**
  ```bash
  supabase db push --dry-run
  ```
  → Kontrollera exakt vilka 7 migrationsfiler som ska köras.  
  Förväntat: 00001–00007 i ordning.

---

## Del 1: Infrastruktur (migrationer i ordning)

- [ ] **1. Kör migration 00001 — RLS + app_users**
  ```bash
  # Kör specifikt via Supabase SQL Editor eller
  supabase db push --include-all
  ```
  Verifiera:
  - `SELECT * FROM check_app_users_health();` → admins = OK
  - `SET ROLE anon; SELECT count(*) FROM store;` → ERROR: permission denied
  - `SET ROLE authenticated; SELECT count(*) FROM store;` (utan app_users-rad) → 0 rows

- [ ] **2. Kör migration 00002 — offer-attachments bucket**  
  Verifiera:
  - `SELECT public FROM storage.buckets WHERE id = 'offer-attachments';` → `false`
  - `SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';`
  → service_role-policyer finns, inga anon/authenticated-policyer för offer-attachments

- [ ] **3. Kör migration 00003 — pg_cron (senast, efter EF är verifierade)**
  Skjuts upp till steg 19.

- [ ] **4. Kör migration 00004 — property_sensitive_access (reversibel)**  
  Verifiera INNAN:
  ```sql
  -- Kontrollera att känsliga fält finns i store att migrera
  SELECT jsonb_path_exists(value, '$[*].doorCode')
    FROM store WHERE key = 'vift_propertyObjects';
  -- → true om data finns (migreringsbara poster)
  ```
  Kör migration. Kontrollera NOTICE-meddelanden:  
  `Förväntar X objektposter och Y fastighetsposter`  
  `Infogade: X objektposter, Y fastighetsposter`  
  Verifiera EFTER:
  - `SELECT count(*) FROM property_sensitive_access;` → > 0
  - `SELECT count(*) FROM store_backup_prop_objects_20260720;` → > 0
  - `SELECT jsonb_path_exists(value, '$[*].doorCode') FROM store WHERE key = 'vift_propertyObjects';` → false

- [ ] **5. Kör migration 00005 — key-baserad store-RLS**  
  Verifiera:
  - `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'store';`
  → `store_service_role_all`, `store_active_read`, `store_active_write_safe`, `store_admin_write_protected`
  - Icke-admin kan inte skriva vift_roles (test-SQL i migrations-kommentarerna)

- [ ] **6. Kör migration 00006 — app_users livscykel**  
  Verifiera:
  - `\df provision_vift_user` → funktion finns
  - `SELECT * FROM check_app_users_health();` → alla checks OK

- [ ] **7. Kör migration 00007 — sensitive_access_audit**  
  Verifiera:
  - `SELECT * FROM sensitive_access_audit LIMIT 1;` → tom tabell (inga poster än)
  - `SET ROLE authenticated; INSERT INTO sensitive_access_audit (action,status) VALUES ('read','allowed');` → ERROR: permission denied

---

## Del 2: app_users provisionering

- [ ] **8. Provisionera alla användare**
  ```sql
  SELECT provision_vift_user('<uid>', '<staff_id>', '<role_id>', <is_admin>);
  -- Upprepa per Supabase Auth-användare
  ```
  Verifiera: `SELECT * FROM check_app_users_health();` → omappade auth = 0

- [ ] **9. Verifiera login och DataSync**
  Logga in i CRM-appen med admin-konto.  
  Verifiera: data laddas, DataSync polling fungerar, sidebar visar korrekt.

---

## Del 3: Edge Functions

- [ ] **10. Sätt Secrets i Dashboard**
  Dashboard → Project Settings → Edge Functions → Secrets:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `RESEND_API_KEY`, `FROM_EMAIL`, `FROM_NAME`, `PUBLIC_BASE_URL`
  - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`
  - `SERVICE_MONITOR_SECRET` (**obligatorisk** — tom sträng blockerar service-monitor)

- [ ] **11. Deploya alla 10 EF:er**
  ```bash
  # JWT-skyddade (verify_jwt = true, default)
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

- [ ] **12. Testa get-sensitive-fields**
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

- [ ] **13. Testa set-sensitive-fields — customer_manage nekas**
  ```bash
  # customer_manage räcker INTE för skrivning
  curl -X POST <URL>/functions/v1/set-sensitive-fields \
    -H "Authorization: Bearer <JWT-med-customer_manage-UTAN-objects_sensitive>" \
    -H "Content-Type: application/json" \
    -d '{"objectId":"OBJ-001","doorCode":"9999"}'
  # → {"error":"Forbidden"}
  ```
  Verifiera: auditlogg visar `status = 'denied'` för detta anrop.

- [ ] **14. Testa service-monitor auth (Model B)**
  ```bash
  # Utan X-Monitor-Secret → 401
  curl -X POST <URL>/functions/v1/service-monitor
  # Med fel secret → 401
  curl -X POST <URL>/functions/v1/service-monitor -H "X-Monitor-Secret: fel"
  # Med Authorization: Bearer service_role_key → 401 (räcker INTE längre)
  curl -X POST <URL>/functions/v1/service-monitor -H "Authorization: Bearer <service_role_key>"
  # Med korrekt X-Monitor-Secret → 200
  curl -X POST <URL>/functions/v1/service-monitor -H "X-Monitor-Secret: <SERVICE_MONITOR_SECRET>"
  ```

- [ ] **15. Testa signerade URL:er**
  Ladda ned en offertbilaga via public-offer-sidan.  
  Verifiera: nedladdning fungerar.  
  Verifiera TTL: `expiresAt` i svaret är ca 10 minuter framåt.  
  Verifiera att URL:en inte finns i `sensitive_access_audit` eller `vift_offerEvents`.

---

## Del 4: Funktionalitet

- [ ] **16. objects_sensitive end-to-end via EF**
  - Teknikerkonto (utan objects_sensitive): känsliga fält-sektion visas INTE i objektvy
  - Adminkonto: sektion visas, data laddas via nätverksanrop (EF, ej DataSync)
  - DevTools → Application: `state.propertyObjects[0]` innehåller INTE `doorCode`
  - Export: "Inkludera känsliga fält"-toggle visas bara med objects_sensitive

- [ ] **17. Payroll-behörigheter**
  - Enbart `reports_view` (utan payroll_view) → Löneunderlag saknas i sidomenyn
  - `payroll_view` → sidan visas, CSV-export fungerar, attestera-knappar syns EJ
  - `payroll_manage` → attestering och bulk-attestering fungerar
  - Teknikerkonto utan `payroll_view`: DevTools → `state.timeEntries` innehåller BARA egna poster
    (notera: rådata i HTTP-svar kan fortfarande innehålla alla poster — se kända risker)

- [ ] **18. E2E-testprotokoll**
  `docs/RC1_E2E_TESTPROTOKOLL.md` — alla A–F testfall: GODKÄND

- [ ] **19. public-offer-flöde (med fragment-token)**
  1. Öppna offertlänk med `?t=<token>`
  2. → URL i adressfältet ändras till `#t=<token>` omedelbart
  3. Uppdatera sidan (`F5`) → sidan laddas korrekt med `#t=` fragmentet
  4. Klicka Bakåt → fragment fortfarande kvar
  5. Ladda ned bilaga → fungerar
  6. Skriv ut → fungerar (token syns i adressfält vid utskrift men skickas ej som Referer)
  7. Svara på offert → fungerar
  8. DevTools → Network → inga externa domäner kontaktas

- [ ] **20. send-offer-email + auditlogg**
  Skicka testoffert → e-post mottagen med länk i `#t=`-format (om e-postmall uppdaterad).
  Verifiera: `SELECT * FROM sensitive_access_audit ORDER BY ts DESC LIMIT 5;`

---

## Del 5: Säkerhet

- [ ] **21. Inga hemliga värden i frontend**
  ```bash
  grep -rn "SUPABASE_SERVICE_ROLE_KEY\|RESEND_API_KEY\|VAPID_PRIVATE" src/
  ```
  → Noll träffar.

- [ ] **22. Privilege escalation blockerad (vift_roles)**
  ```bash
  # Autentiserad icke-admin kan INTE skriva vift_roles:
  curl -X PATCH "https://<proj>.supabase.co/rest/v1/store?key=eq.vift_roles" \
    -H "Authorization: Bearer <JWT-icke-admin>" \
    -H "apikey: <anon-key>" \
    -H "Content-Type: application/json" \
    -d '{"value": [{"id":"tekniker","permissions":["all"]}]}'
  # → 0 rows (RLS store_admin_write_protected blockerar)
  ```

- [ ] **23. Public signup inaktiverat**
  Dashboard → Authentication → Providers → Email → Disable sign ups: ON  
  ```bash
  curl -X POST https://<proj>.supabase.co/auth/v1/signup \
    -d '{"email":"x@x.se","password":"test123456"}' \
    -H "apikey: <anon-key>"
  # → {"error":"Signups not allowed"}
  ```

- [ ] **24. Auditlogg fungerar**
  Hämta känsliga fält som admin → `SELECT * FROM sensitive_access_audit ORDER BY ts DESC LIMIT 1;`  
  → En rad med `action = 'read'`, `status = 'allowed'`, fältnamn (ej värden) i `fields[]`.

---

## Del 6: Cron + release

- [ ] **25. Schemalägg service-monitor (migration 00003)**
  Kör SIST, efter att EF och `SERVICE_MONITOR_SECRET` är verifierade.  
  Verifiera att cron-jobbet skickar `X-Monitor-Secret` (inte Bearer service_role).

- [ ] **26. E2E-testprotokoll slutstatus**
  Alla testfall: GODKÄND. Testledare signerar.

- [ ] **27. Tagga RC1**
  ```bash
  git tag -a v1.0.0-rc1 -m "VIFT CRM 1.0.0 RC1"
  git push origin v1.0.0-rc1
  ```
  Synka INTE main eller gh-pages förrän alla punkter ovan är avbockade.

---

## Kända risker och begränsningar (RC1)

| Risk | Allvarlighet | Mitigation i RC1 | Plan v1.1 |
|---|---|---|---|
| `vift_timeEntries` laddas för alla aktiva användare i HTTP-svar | Medel | Client-side filter i DataSync; `state.timeEntries` filtreras per roll | Normaliserat timeEntries-schema med per-rad RLS |
| Operativ data (workOrders m.fl.) kan skrivas av alla aktiva användare via REST | Medel | app_users.active-krav; vift_roles/staff/settings admin-skyddade | Per-behörighet write-kontroll kräver normaliserat schema |
| `app_users.is_admin` synkroniseras ej automatiskt vid rolländring | Låg | Manuell uppdatering + dokumentation; `provision_vift_user()` finns | Trigger eller EF för automatisk synk |
| Signerade URL:er är reusable under TTL (10 min) | Låg | Kort TTL; ny URL per anrop; URL loggas ej | Inget ytterligare planerat |
| Offerttoken i `#t=` fragment kan kopieras av kunden | Låg | Tokens har TTL; revokering blockerar ny URL-generering | Inget ytterligare planerat |

---

## Vad som är sparat till v1.1

- Normaliserat timeEntries-schema med per-rad RLS
- Per-permission write-kontroll på operativa store-nycklar
- Automatisk `is_admin`-synk vid rolländring via trigger/EF
- Central dokumenthantering
- Ytterligare rapporttyper, automatisk fakturering

---

Signatur (staging-godkänd): ____________________  Datum: __________
