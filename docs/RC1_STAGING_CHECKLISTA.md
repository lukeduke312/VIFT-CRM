# VIFT CRM 1.0.0 RC1 — Staging-checklista
Datum: 2026-07-20  
Branch: `claude/vift-system-restructure-8fUme`

Markera ✅ när varje punkt är verifierad. Alla 16 punkter måste vara KLARA
innan RC1-taggen sätts och main/gh-pages synkas.

---

## Del 1: Infrastruktur (kräver Supabase-åtkomst)

- [ ] **1. RLS aktiverat på `store`-tabellen**  
  Kör `supabase/migrations/20260720000001_rls_store_table.sql` i SQL Editor.  
  Verifiera: `SET ROLE anon; SELECT count(*) FROM store;` → permission denied.

- [ ] **2. RLS aktiverat på `push_subscriptions`-tabellen**  
  Ingår i samma migration. Verifiera att anon nekas och authenticated ser bara egna rader.

- [ ] **3. `offer-attachments`-bucketen är privat**  
  Kör `supabase/migrations/20260720000002_storage_offer_attachments.sql`.  
  Verifiera: `SELECT public FROM storage.buckets WHERE id = 'offer-attachments';` → `false`.

- [ ] **4. Alla 8 Edge Functions deployade**  
  ```
  supabase functions deploy service-monitor
  supabase functions deploy send-push
  supabase functions deploy offer-token-validate
  supabase functions deploy offer-respond
  supabase functions deploy offer-attachment-upload
  supabase functions deploy offer-attachment-url
  supabase functions deploy offer-pdf
  supabase functions deploy send-offer-email
  ```

- [ ] **5. Secrets satta i Supabase Dashboard**  
  Gå till Project Settings → Edge Functions → Secrets. Sätt:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `RESEND_API_KEY`
  - `FROM_EMAIL`
  - `FROM_NAME`
  - `PUBLIC_BASE_URL`
  - `VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`
  - `VAPID_EMAIL`
  - `MONITOR_SECRET` (valfri — alternativ auth för service-monitor)

- [ ] **6. pg_cron aktiverat och service-monitor schemalagd**  
  Dashboard → Database → Extensions → pg_cron: ON.  
  Kör `supabase/migrations/20260720000003_pg_cron_service_monitor.sql`  
  eller konfigurera Scheduled Function via Dashboard.

---

## Del 2: Funktionalitet

- [ ] **7. objects_sensitive-rättigheten fungerar end-to-end**  
  - Portkod dold för obehöriga i: objektvy, AO-wizard, AO-detalj, export  
  - Rättigheten synlig och tilldelningsbar i AdminPage → Roller

- [ ] **8. E2E-testprotokoll genomfört**  
  Testprotokoll: `docs/RC1_E2E_TESTPROTOKOLL.md`  
  Alla A–F testfall: GODKÄND (inga UNDERKÄND får kvarstå).

- [ ] **9. send-offer-email testad mot Resend staging**  
  Skicka testoffert till intern testadress.  
  Verifiera: e-post mottagen, offertlänk korrekt, bilagor bifogade.  
  Verifiera: händelse sparad i `vift_offerEvents` (ej `vift_main`).

- [ ] **10. DataSync 2-fönster-test**  
  Öppna appen i två webbläsarfönster. Ändra data i fönster A.  
  Verifiera: fönster B uppdateras inom ~15 sekunder (DataSync-poll).

---

## Del 3: Säkerhet

- [ ] **11. Inga hemliga värden i frontend-kod**  
  ```
  grep -rn "SUPABASE_SERVICE_ROLE_KEY\|RESEND_API_KEY\|VAPID_PRIVATE" src/
  ```  
  → Noll träffar. (SUPABASE_URL och anon-key är ok — de är publika.)

- [ ] **12. Anon-key exponeras aldrig i EF-autentisering**  
  Sök i alla EF-filer:  
  ```
  grep -rn "SUPABASE_AKEY\|ANON_KEY" supabase/functions/
  ```  
  → Noll träffar (borttagna i EF-säkerhetscommit).

- [ ] **13. Export inkluderar aldrig känsliga fält utan aktiv toggle**  
  Kör export som fastighetsskötare → CSV/XLSX ska sakna portkod.  
  Känsliga fält kräver: aktiv toggle + admin/objects_sensitive/customer_manage.

---

## Del 4: Kodkvalitet

- [ ] **14. Konsol rent — inga JavaScript-fel på startsida**  
  Öppna DevTools → Console efter inloggning.  
  Inga `Uncaught`-fel, inga röda 404:or (utom eventuellt EF-anrop om ej driftsatt).

- [ ] **15. MASTERPLAN.md uppdaterad**  
  `docs/MASTERPLAN.md` reflekterar nuläget:  
  - Blockerarlista A–C är tom (alla åtgärdade)  
  - Statusar för punkt 72, 80, 88, 96 uppdaterade

---

## Del 5: Release

- [ ] **16. Taggning och distribution**  
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
