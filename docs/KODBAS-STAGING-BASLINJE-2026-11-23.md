# VIFT CRM — En kodbas: STAGING-klienten som baslinje (2026-11-23)

## Varför

`docs/STAGING-AO-TID-SKRIVVAG-BLOCKERARE-2026-11-22.md` visade att denna branch skrev `vift_workOrders`/`vift_timeEntries` via generisk `persist()` medan STAGING blockerar det med RESTRICTIVE-policyer och redan har `ao-time-write` v3. En läsande jämförelse (HTTP GET av den publika STAGING-deployen, ingen ändring i STAGING) visade orsaken: **denna branch var en äldre kodlinje**.

- STAGING-klienten innehöll denna branchs sista commits före november (stickprov: 23/24 tillagda rader från `fe8de5d`, `076f281`, `ecf9bb4` fanns i STAGING).
- STAGING hade ~2 månaders ytterligare arbete: `AOTimeSyncService` (durable outbox, idempotensnycklar, ACK-före-"Sparat", ordning per post), per-element trevägsmerge i `persist()` via `store-key-write`, degraded-load-spärr, `WorkOrdersReadService`, `RonderingSyncService`, `OfferCalc`, m.m. 40 filer skilde sig, 4 fanns bara i STAGING.
- `workOrders`/`timeEntries` (och invoices, ronderingspass, offerAttachments, projectDocuments, offerEvents) är redan borttagna ur den generiska `persist()`-vägen i STAGING-klienten (`VIFT_BUSINESS_KEYS` i `state.js`).

En "§2a-filsynk" från denna branch hade alltså regresserat STAGING. Lösningen är en kodbas: STAGING-klienten importeras som baslinje, och denna branchs unika förbättringar portas ovanpå (separata commits).

## Vad som importerades

Alla filer som STAGING:s `index.html` laddar (72 skript, 7 stilmallar), `index.html`, `service-worker.js` (v14), `manifest.json` och refererade bildtillgångar (`assets/`). Hämtat 2026-11-23 från `https://staging-crm.viftfast.se` med vanlig GET. Branchens läge före importen är commit `1b08333`.

## Miljööverlägg (produktionsrepo)

CLAUDE.md förbjuder STAGING:s ref/domän i produktionsfrontend. Vid import (och varje framtida synk STAGING → detta repo):

| Fil | Överlägg |
|---|---|
| `config.js` | Behåll repots (LIVE `vapidPublicKey`). Inte importerad. |
| `src/data/storage.js` | `SUPABASE_URL`/`SUPABASE_AKEY` = LIVE (`hjplzjsbbowiyoyhdghc`, publik anon-nyckel). |
| `src/services/AuthService.js` | `_ENV_REDIRECT_BY_PROJECT_REF` innehåller bara LIVE-posten (fail-closed bevarat). |
| `index.html` | STAGING-miljöindikatorn (`vift-staging-environment-indicator`) borttagen. |

Omvänt, vid synk detta repo → staging-repot: lägg tillbaka STAGING-värdena i samma fyra punkter.

`tests/env_overlay_guard.test.js` kontrollerar att inga STAGING-identifierare eller service_role-nycklar finns i någon fil som `index.html` laddar.

## Branchens egna förbättringar — status efter importen

| Branch-commit | Innehåll | Status |
|---|---|---|
| `b8a95d0` | diff-aware `persist()` | **Överspelad** — STAGING har per-nyckel-diff + per-element trevägsmerge (starkare). Portas inte. |
| `faa43e6`, `a0d02e3`, `07e46e5`, `60b320f` | AO-loggbilder i Storage, säker radering, EF-klienter, write-timeout | Portas (separata commits). |
| `a0d02e3` | Tidpostfilter i klienten | STAGING löser via `TimeEntriesReadService` v2 + RLS. Verifieras, portas inte i onödan. |
| `a0d02e3` | Serviceintervall: idempotensnyckel klient/server | Portas. |
| `06ff5b1` | `TimeEntriesReadService` v1 | **Överspelad** av STAGING v2. |
| `8844515` | Serviceintervallöversikt + `fn`→`onClick`-fix | Portas. |

## Saknas i detta repo (backend)

Klienten anropar fem Edge Functions vars källkod bara finns i staging-repot: `ao-time-write`, `store-key-write`, `work-orders-list`, `invoice-write`, `rondering-pass-write`, samt migrationerna för deras RPC:er (bl.a. `20261017000001_ao_time_atomic_rpc.sql`, `20261021000001_ao_time_rls_lockdown.sql`, `work_order_create`). Repot är därför inte en komplett, återskapbar källa för backend. **Åtgärd (kräver Lucas):** pusha staging-repots `supabase/`- och `tests/`-mappar till denna branch, eller ge sessionen läsåtkomst till staging-repot.

Konsekvens för LIVE: LIVE-databasen saknar sannolikt dessa EF:er/RPC:er. Denna klient kan inte gå till LIVE förrän de är installerade där (separat GO, se installationsplanen).
