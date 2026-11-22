# VIFT CRM – verifierad installationsblockerare: arbetsorder- och tid-skrivväg

Datum: 2026-11-22. Gäller för `docs/INSTALLATIONSPLAN-STAGING-2026-11-22.md`. Detta är **läsande käll- och databasgranskning**, ingen kod-/Supabase-deployment. Läs innan GO till §2a (klientfilsynk).

## 1. Verifierade STAGING-fakta

Supabase STAGING-projekt `yyzljlqyzzcbxmcdbual`:

- `public.store` har RESTRICTIVE INSERT/UPDATE/DELETE-policyer `store_ao_time_no_direct_{insert,update,delete}` som explicit blockerar `vift_workOrders` och `vift_timeEntries` för `authenticated`. Ytterligare `staging_generic_keys_no_direct_*` finns.
- `ao-time-write` **version 3 finns redan installerad** och använder serverstyrda atomiska RPC:er med idempotensnycklar. Åtgärder omfattar `create_ao`, `patch_ao`, `delete_ao`, `permanent_delete_ao`, `create_time`, `patch_time`, `delete_time`, `attest_time`.
- RPC-funktionerna `work_order_create`, `work_order_patch`, `time_entry_create`, `time_entry_patch` med flera finns redan. **Återanvänd befintlig serverväg. Ingen ny RLS-migration, inget extra projekt.**

## 2. Verifierade källfakta i nuvarande utvecklingsbranch

- `src/services/TimeService.js` `clockOut()` (rad ca 32–93): ändrar lokal `state.timeEntries`, tömmer instämplingen och anropar `persist()` utan `await`/serverbekräftelse; returnerar posten direkt. `saveManual()` (kring rad 164–176) och update/delete använder också `persist()`.
- `src/services/WorkOrderService.js` `create()`, `_update_internal()`, m.fl. använder generisk `persist()`.
- `src/data/state.js` `_doPersist()` (kring rad 370–383) inkluderar fortfarande `workOrders` och `timeEntries` när dessa värden avviker från diff-cachen; diff-aware reducerar volym, **men byter inte skrivväg**.
- `src/data/storage.js` `setAll()` POST:ar förändrade nycklar direkt till `/rest/v1/store`. När skyddad nyckel inkluderas kan RLS blockera skrivningen. `TimeService.clockOut()` väntar inte på returvärdet och kan därför visa en lokalt skapad post som om den vore sparad även om databasen avvisar skrivningen.
- `TimeService.clockIn()` skriver `stampActive`, `stampTs`, `stampAoId` via `Storage.set()` med generiska, användarodelade nycklar; `initState()` i `state.js` läser instämplingsläget från enhetens `localStorage`. Detta är inte tillförlitlig per-person-molnsynk och uppfyller ännu inte masterplanskravet på mobil → dator.

## 3. Slutsats / omedelbar åtgärd

**NO-GO för en okontrollerad, fullständig filsynk av §2a tills kompatibiliteten med redan installerad `ao-time-write` verifierats och vid behov korrigerats.** De 73/73 lokala testerna är inte evidens för fungerande skrivningar mot de faktiska STAGING-policyerna.

Be Claude inventera befintliga klient-anropsvägar i den **faktiskt nu deployade STAGING-klienten** (som kan skilja sig från GitHub-branch), och bevara/återanvänd dem i den samordnade releasekandidaten. Gör INTE ett generellt RLS-upplås för att få gamla direkta writes att fungera.

### Obligatoriska STAGING-acceptanstester

1. Skapa AO → serverbekräftad, syns i annan enhet efter reload, utan duplicering vid upprepat anrop.
2. Ändra AO, inklusive loggpost → serverbekräftad ändring; ingen bortskriven annan användares ändring.
3. Stämpla in → se tydligt server-/lokalt statusläge. Kravet på per-person molnsynk av pågående session är en **öppen masterplanspunkt**, inte något att falskt markera klart i denna release.
4. Stämpla ut → serverbekräftad tidpost i `vift_timeEntries`, syns efter reload och för behörig användare på annan enhet; avvisning/timeout får ALDRIG visa falskt `Sparat`.
5. Manuell tid → korrekt behörighet och serverbekräftelse.
6. Testa samma mutation efter osäkert nätverksutfall (server kan ha hunnit committa) → inget dubbelsparande.
7. Säkerställ att tidigare installerade offert- och fakturaflöden inte byts ut eller regressar.

Denna notering är en riktad kontroll av **faktiskt påvisad versions-/arkitekturkonflikt**, inte en begäran om bred ny säkerhetsrevision. Inga ändringar har gjorts i STAGING eller LIVE.
