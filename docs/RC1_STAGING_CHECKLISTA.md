# VIFT CRM 1.0.0 RC1 — Staging-checklista
Datum: 2026-07-20  
Branch: `claude/vift-system-restructure-8fUme`

Markera ✅ när varje punkt är verifierad. Alla punkter måste vara KLARA
innan RC1-taggen sätts och main/gh-pages synkas.

---

## Del 1: Infrastruktur (kräver Supabase-åtkomst)

- [ ] **1. RLS + app_users på `store`-tabellen**  
  Kör `supabase/migrations/20260720000001_rls_store_table.sql` i SQL Editor.  
  Skapar `app_users`-tabellen (user_id UUID → auth.users, active BOOLEAN).  
  RLS på `store` kräver `EXISTS (SELECT 1 FROM app_users WHERE user_id = auth.uid() AND active = true)`.  
  Verifiera:  
  - `SET ROLE anon; SELECT count(*) FROM store;` → `ERROR: permission denied`  
  - `SET ROLE authenticated; SELECT count(*) FROM store;` (ej i app_users) → `0 rows`  
  - Inloggad aktiv användare → data returneras  
  - `SELECT rolname FROM pg_roles WHERE rolname = 'anon';` + `\z store` → anon har inga rättigheter

- [ ] **2. RLS aktiverat på `push_subscriptions`-tabellen**  
  Ingår i migration 00001. Verifiera att anon nekas och authenticated ser bara egna rader (app_users-check).

- [ ] **3. `property_sensitive_access`-tabellen skapad**  
  Kör `supabase/migrations/20260720000004_property_sensitive_access.sql`.  
  - Tabell skapad med kolumner: property_id, object_id, door_code, key_information, key_receipt, alarm_information, access_information, access_code  
  - RLS: anon och authenticated har NOLL direkt åtkomst — service_role only  
  - Datamigrering: befintliga doorCode/keyInformation ur vift_propertyObjects och accessCode/keyInfo ur vift_properties kopierade hit  
  - Strip: känsliga fält borttagna ur store-blob  
  Verifiera: `SET ROLE authenticated; SELECT * FROM property_sensitive_access;` → `ERROR: permission denied`

- [ ] **4. `offer-attachments`-bucketen är privat**  
  Kör `supabase/migrations/20260720000002_storage_offer_attachments.sql`.  
  Verifiera: `SELECT public FROM storage.buckets WHERE id = 'offer-attachments';` → `false`.  
  Verifiera storage-policies via:  
  ```sql
  SELECT policyname, cmd, roles, qual
  FROM pg_policies
  WHERE schemaname = 'storage' AND tablename = 'objects';
  ```  
  → policy kräver authenticated för upload; anon kan inte lista eller läsa filer.

- [ ] **5. Alla 10 Edge Functions deployade med korrekt JWT-inställning**  
  `supabase/config.toml` styr verify_jwt per funktion. Deploykommandon:  
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
  Verifiera att config.toml och --no-verify-jwt är konsistenta (båda false för samma funktion).

- [ ] **6. Secrets satta i Supabase Dashboard**  
  Dashboard → Project Settings → Edge Functions → Secrets:  
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `RESEND_API_KEY`
  - `FROM_EMAIL`
  - `FROM_NAME`
  - `PUBLIC_BASE_URL`
  - `VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`
  - `VAPID_EMAIL`
  - `SERVICE_MONITOR_SECRET` (**obligatorisk** — service-monitor blockerar alla anrop om tom)

- [ ] **7. pg_cron aktiverat och service-monitor schemalagd**  
  Dashboard → Database → Extensions → pg_cron: ON.  
  Kör `supabase/migrations/20260720000003_pg_cron_service_monitor.sql`  
  (pg_cron skickar `X-Monitor-Secret: <SERVICE_MONITOR_SECRET>` i headern).  
  Notera: Authorization: Bearer service_role används INTE längre som inkommande credential.

---

## Del 2: Funktionalitet

- [ ] **8. objects_sensitive-rättigheten fungerar end-to-end via EF**  
  - Inloggad som fastighetsskötare (utan objects_sensitive): portkod-sektion visas ej i objektvy, AO-wizard, AO-detalj  
  - Inloggad som admin/objects_sensitive: sektion visas och kallar get-sensitive-fields EF; data laddas via EF (ej från global state)  
  - Export: känsliga fält kräver explicit toggle + objects_sensitive (customer_manage räcker INTE)  
  - Känsliga fält finns INTE i DataSync-payload (state.propertyObjects innehåller ej doorCode etc.)

- [ ] **9. Löneunderlag-behörigheter separerade från reports_view**  
  - Inloggad som roll med BARA reports_view → sidnavigation visar ej Löneunderlag  
  - Inloggad med payroll_view → kan visa och exportera men ej attestera  
  - Inloggad med payroll_manage → kan attestera enstaka poster och bulk-attestera  
  - Rollredigering i AdminPage → gruppen "Löner" med payroll_view och payroll_manage visas

- [ ] **10. E2E-testprotokoll genomfört**  
  Testprotokoll: `docs/RC1_E2E_TESTPROTOKOLL.md`  
  Alla A–F testfall: GODKÄND (inga UNDERKÄND får kvarstå).

- [ ] **11. send-offer-email testad mot Resend staging**  
  Skicka testoffert till intern testadress.  
  Verifiera: e-post mottagen, offertlänk korrekt, bilagor bifogade.  
  Verifiera: URL-token tas bort från adressfältet (history.replaceState) direkt vid sidladdning.

- [ ] **12. DataSync 2-fönster-test**  
  Öppna appen i två webbläsarfönster. Ändra data i fönster A.  
  Verifiera: fönster B uppdateras inom ~15 sekunder.  
  Verifiera: känsliga fält laddas via EF-anrop, inte från DataSync-payload.

---

## Del 3: Säkerhet

- [ ] **13. Inga hemliga värden i frontend-kod**  
  ```bash
  grep -rn "SUPABASE_SERVICE_ROLE_KEY\|RESEND_API_KEY\|VAPID_PRIVATE" src/
  ```  
  → Noll träffar. (SUPABASE_URL och anon-key är ok — de är publika.)

- [ ] **14. Anon-key exponeras aldrig i EF-autentisering**  
  ```bash
  grep -rn "SUPABASE_AKEY\|ANON_KEY" supabase/functions/
  ```  
  → Noll träffar.

- [ ] **15. Export inkluderar aldrig känsliga fält utan aktiv toggle**  
  Kör export som fastighetsskötare → CSV/XLSX saknar portkod/nycklar/larm.  
  Känsliga fält kräver: aktiv toggle + objects_sensitive (customer_manage räcker INTE).

- [ ] **16. Public signup inaktiverat i Supabase**  
  Dashboard → Authentication → Providers → Email → Disable sign ups: ON.  
  Verifiera: `curl -X POST https://<project>.supabase.co/auth/v1/signup ...` → `"Signups not allowed"`

- [ ] **17. Signerade Storage-URL:er har kort TTL**  
  Granska offer-attachment-url EF: signedUrl genereras med TTL 5–15 minuter.  
  URL:er loggas INTE (varken i EF-output eller i vift_offerEvents.payload).  
  Ny URL genereras per nedladdningsanrop.

- [ ] **18. Offentlig offert-sida (public-offer.html) härdad**  
  - `Cache-Control: no-store` meta-tag finns  
  - `Referrer-Policy: no-referrer` meta-tag finns  
  - CSP meta-tag med `frame-ancestors 'none'` finns  
  - `history.replaceState` tar bort `?t=<token>` från URL direkt vid load  
  - Öppna DevTools → Network → verifiera att ingen tredjepartsresurs laddas

---

## Del 4: Kodkvalitet

- [ ] **19. Konsol rent — inga JavaScript-fel på startsida**  
  Öppna DevTools → Console efter inloggning.  
  Inga `Uncaught`-fel, inga röda 404:or (utom eventuellt EF-anrop om ej driftsatt).

- [ ] **20. MASTERPLAN.md uppdaterad**  
  `docs/MASTERPLAN.md` reflekterar nuläget:  
  - Blockerarlista tom (B1–B5 åtgärdade)  
  - Statusar för punkt 72, 80, 88, 96 uppdaterade

---

## Del 5: Release

- [ ] **21. Taggning och distribution**  
  ```bash
  git tag -a v1.0.0-rc1 -m "VIFT CRM 1.0.0 RC1"
  git push origin v1.0.0-rc1
  ```  
  Synka INTE main eller gh-pages förrän denna punkt är avbockad
  och alla ovanstående punkter är KLARA.

---

## Vad som är sparat till v1.1

Följande punkter ingår INTE i RC1 och ska INTE implementeras nu:
- Central dokumenthantering
- Globala kommentarer
- Ytterligare rapporttyper
- Automatisk fakturering

---

Signatur (staging-godkänd): ____________________  Datum: __________
