# VIFT CRM — Slutrapport för utvecklingsomgången 2026-11-23

Allt nedan är utvecklat, testat lokalt, committat och pushat till `claude/vift-system-restructure-8fUme`. **Inget är installerat i STAGING eller LIVE.** Installationsunderlaget är den uppdaterade `docs/INSTALLATIONSPLAN-STAGING-2026-11-22.md`.

## Det viktigaste fyndet

Branchen var en **äldre kodlinje** än den deployade STAGING-klienten. STAGING hade redan löst det mesta i Etapp A (AO/tid via `ao-time-write` med varaktig outbox, idempotensnycklar och ACK-före-sparat; per-element-merge i `persist()`; server-baserad `stamp_status`). En "§2a-filsynk" från branchen hade regresserat STAGING i ~40 filer. Jag läste den publika STAGING-deployen (endast GET), gjorde den till baslinje i repot med LIVE-miljööverlägg, och portade branchens egna förbättringar ovanpå. Därmed finns en kodbas, och blockeraren från 2026-11-22 är löst i kod.

## A. Vad som byggts

| Del | Beskrivning | Filer | Commit | Tester | STAGING-redo |
|---|---|---|---|---|---|
| En kodbas | STAGING-klienten som baslinje, LIVE-överlägg (config, storage-URL, reset-redirect, ingen STAGING-indikator), miljöskyddstest | 55 klientfiler, `tests/` | 56a943d | 7 | Ja (repo-ändring, ingen deploy) |
| Serviceintervall | Separata idempotensnycklar klient/server + skydd mot dubbel Att göra vid övergången; översiktssida `#/serviceintervall` i `PAGE_PERMISSIONS`; lagade döda modalknappar | ServiceIntervalService, ServiceIntervalsPage, PropertyDetailPage, Router, Sidebar, AuthService | 30bd21c | 36 | GO för granskning |
| Skrivtimeout | 20 s på alla skrivvägar inkl. ao-time-write; timeout = osäkert utfall | storage.js, AOTimeSyncService | 37fc1ca | 22 | GO för granskning |
| AO-loggbilder | Uppladdning via EF före DB-skrivning, bara `imagePath` i AO; ACK-styrd sparning/radering; städning av föräldralösa filer bara när inget annat väntar | WorkOrderDetailPage, WorkOrderImageService | 0eae23e | 22 | GO för granskning; kräver bucket + 3 EF |
| Säker bildrendering | Inbäddade data-URL-bilder renderades oescapeade i `src=` (stored XSS); nu bara äkta base64-bilder. Avvikelsebilder komprimeras | state.js, WorkOrderDetailPage, RonderingUtforandePage | 0eae23e | 5 av 22 | GO för granskning |
| AO/tid-skrivvägar | Inget "sparat" före ACK; nekad ändring återställs (manuell tid, tidradering, arkiv, papperskorg, permanent radering, prissättning); centralt besked + omläsning när de ~20 fire-and-forget-ändringarna nekas; massändringar rapporterar avslag | TimeService, WorkOrderService, AOTimeSyncService, TimePage, WorkOrderDetailPage, WorkOrdersPage | f94f131, c4e8436 | 34 | GO för granskning |
| Molnstämpling | Uppdatering mellan enheter (flikfokus + var 90:e s); en tidpost per pass även vid utstämpling från två enheter; utstämpling överlever omladdning (varaktig intent) | TimeService, AOTimeSyncService, state.js | 7868335 | 28 | VÄNTAR PÅ TEST (serverns idempotens, G6) |
| Offertsumma kundsida | Kundsidan räknar med CRM:ets `OfferCalc` — 22 av 120 offerter skilde tidigare (äldre `price`-rader, ett negativt "att betala") | public-offer.html | 423f9f0 | 120 webbläsarjämförelser | GO för granskning (test O1–O3) |
| Faktureringskö | Visat belopp för tid = fakturerat belopp (50 min à 650: 541,67 visat, 539,50 fakturerat tidigare) | BillingQueueService | 14d62df | 23 | GO för granskning |
| WAL-mätning | Lokalt mätskript | tests/perf | 038b04f | — | — |
| Dokumentation | Installationsplan, MASTERPLAN 140–153, status, baslinjedokument | docs/ | 4e937d0, da233e3 | — | — |

## B. Masterplan

153 numrerade punkter (var 139). Enligt statuskolumnen: **112** markerade klara, **32** byggda men inte funktionstestade, **7** ej påbörjade/planerade/uppskjutna, **1** blockerad (151), **1** överspelad (130). De 112 är masterplanens registrerade status; denna omgång har omverifierat mot koden endast de punkter den rört.

Nya punkter 140–153: tio byggda/klara (140–149) och fyra planerade/blockerade (150 aktivitetslogg som tabell, 151 append_log, 152 historisk bildmigrering, 153 Solar/Ahlsell + CSV-prisimport). Ändrad status: 130 överspelad; 135 ersatt av STAGING:s läsväg; 131/134/136/137/138 portade. Bokio, Momentum och AI-arbetsorderinkorg kvar som framtida områden utan uppfunnen specifikation.

## C. Prestanda

Uppmätt lokalt (PostgreSQL 16, syntetiska men varierade data, `tests/perf/wal_per_write.sh`). Extrapolering till LIVE är inte gjord här.

| Skrivning | WAL per skrivning |
|---|---|
| Aktivitetslogg +1 post (500-posters rad) | 40,3 kB — som egen rad: 0,4 kB |
| En kunds telefonnummer (300 kunder) | 56,7 kB |
| En AO:s titel, inga inbäddade bilder (300 AO) | 141,5 kB |
| Samma ändring när en annan AO har 3 inbäddade foton | 6 572,6 kB |

Slutsatser: (1) nya loggfoton i Storage stoppar tillväxten, men **historiska inbäddade bilder gör varje AO-ändring ~46× dyrare** tills de migreras (punkt 152); (2) aktivitetsloggen kostar en extra helradsskrivning per användaråtgärd (punkt 150); (3) STAGING:s per-element-merge undviker redan att oförändrade nycklar skickas. Anrop per åtgärd (härlett ur koden, ej uppmätt): AO-ändring = 1 ao-time-write + 1 aktivitetslogg-merge; kundändring = 1 kund-merge + 1 aktivitetslogg-merge; tidregistrering = 1 ao-time-write + 1 aktivitetslogg-merge. Stämplingsbevakningen lägger till ≤ 40 EF-läsningar per aktiv användare och timme.

Kostnadsrisker: historiska bilder (WAL/disk), aktivitetsloggen, och att aktivitetsloggen i STAGING just nu avvisas på varje skrivning (dubblett-id, §2c) — ett meningslöst anrop per åtgärd tills datan städas.

## D. Kvalitet

`bash tests/run-all.sh`: 8 testfiler, **172 kontroller + 120 offertjämförelser i Chromium, alla gröna**; webbläsarsmoke av hela appen utan JS-fel; `node --check` på alla laddade skript. Alla tester körs mot riktiga källfiler med simulerade servrar — de visar klientlogiken, inte att `ao-time-write`/`store-key-write` beter sig likadant. Ej testat: riktig iPhone/Safari, riktiga Supabase-svar, push-notiser, PDF-generering.

Kvarstående blockerare/gap: G4 (backendkällor bara i staging-repot), G5 (samtidiga loggposter kan skriva över varandra, kräver append_log), G6 (serverns idempotens för dubbel utstämpling), G7 (historiska bilder), G8 (offert kan visa negativt "att betala" om RUT/ROT > total), activityLog-dubbletten i STAGING.

## E. Installation

Se `docs/INSTALLATIONSPLAN-STAGING-2026-11-22.md` (uppdaterad): vad som redan finns, exakt fildiff mot STAGING-deployen med överlägget som ska läggas tillbaka, ordning, testfall, rollback och vad LIVE behöver senare.

## F. GO/NO-GO och rekommendation

| Del | Status |
|---|---|
| Klientfiler (§2a) | GO för STAGING-granskning |
| Bildobjekt + 3 EF (§2b) | GO för STAGING-granskning |
| activityLog-städning (§2c) | VÄNTAR PÅ TEST |
| service-monitor-aktivering (§3) | VÄNTAR PÅ TEST |
| Dubbel utstämpling (S3) | VÄNTAR PÅ TEST |
| append_log (151) | BLOCKERAD |
| Historisk bildmigrering (152), aktivitetslogg som tabell (150), Solar/Ahlsell (153) | PLANERAD |

**Rekommenderat nästa samlade STAGING-GO:** §2a + §2b tillsammans (klientfiler med STAGING-överlägg, sedan bucket → policies → 3 EF), följt av testfallen A1–A4, T1–T4, S1–S5, B1–B5, O1–O3, F1, I1–I2. Parallellt, för att låsa upp nästa omgång: pusha staging-repots `supabase/` och `tests/` till denna branch (G4).
