# STAGING-verifiering: serverbehörigheter (G13/BLOCKER-2), ekonomirollens AO-status (G9), dubbel utstämpling (G6)

Status 2026-11-23: **FÖRBEREDD — inte körd.** Kräver separat GO och isolerade testkonton. Skript: `tests/e2e/staging-authz.js`.

## Varför detta inte kan avgöras lokalt

Källkoden till `store-key-write`, `ao-time-write`, `work-orders-list`, `invoice-write` och `rondering-pass-write` finns varken i detta repo eller i någon branch av `vift-crm-staging` (kontrollerat 2026-11-23: `gh-pages`, `chatgpt/staging-all-blockers-2026-11-17`, `claude/staging-fixround-2026-11-16`, `claude/staging-integration-2026-11-08`). De finns bara som driftsatta funktioner i Supabase. Att hämta dem kräver en Supabase-åtkomsttoken, som ger skrivrätt till projektet. Den har inte begärts.

**Det som behövs:** att Lucas (eller den som har åtkomst) exporterar de driftsatta källorna, till exempel med `supabase functions download <namn> --project-ref <staging>`, och committar dem under `supabase/functions/` (gap G4). Därefter kan reglerna granskas direkt och simuleringen i `tests/e2e/fake-backend.js` jämföras med verkligheten.

## G13 / BLOCKER-2 — behörighet per register i `store-key-write`

**Klientens kontrakt (det klienten förutsätter):** generiska register skrivs med `store-key-write` `writeMerge {key, upserts:[{id,data,previous}], removals:[{id,previous}]}`. Klienten döljer knappar per behörighet, men **servern måste neka** skrivningar som rollen saknar rätt till. Förväntad matris (från `AuthService` och sidornas `Auth.can`):

| Register | admin | arbetsledare | fältarbetare | ekonomi | begränsad |
|---|---|---|---|---|---|
| kunder, fastigheter, offerter, säljchanser, avtal | ja | ja | nej | nej | nej |
| roller, personal, inställningar | ja | nej | nej | nej | nej |
| artiklar, prisgrupper | ja (article_manage) | nej | nej | nej | nej |
| att göra | egna uppgifter | ja | egna | egna | egna |

**Testmetod som aldrig ändrar data:** varje roll skickar en `writeMerge` som bara tar bort ett id som inte finns (`E2E-AUTHZ-PROBE-…`). En behörig server svarar 200 utan ändring. En obehörig svarar 401/403. Svarar servern 200 för en roll som inte ska skriva registret är det ett säkerhetsfel, även om inget skrevs. Kontrollerat mot den simulerade servern: inga affärsdata ändras; endast pollsignalen `vift_lastChanged` kan uppdateras.

## G9 — ekonomirollen och AO-status "fakturerad"

När ett fakturautkast skapas sätter klienten AO:ns `status: 'fakturerad'`, `invoiceId` och `billingPreviousStatus` via `ao-time-write` `patch_ao` (`BillingQueueService._syncBillingFields`). Den simulerade servern kräver AO-mutationsrätt (`ao_edit`/`ao_complete`/…), som ekonomirollen saknar. Därför nekas statusändringen. Klienten säger det och rullar tillbaka, och fakturan påverkas inte.

**Testmetod som aldrig ändrar data:** ekonomikontot skickar `patch_ao` med AO:ns **nuvarande** `status` och `invoiceId` (oförändrade värden). 403 = rollen får inte sätta faktureringsstatus (bekräftar G9). 200 = tillåtet (ingen ändring).

**Om G9 bekräftas — föreslagen åtgärd (beslut krävs, öppna inte behörigheter generellt):** en smal serverregel i `ao-time-write` som låter `invoice_create` ändra **endast** fälten `status` (bara `klar` ↔ `fakturerad`), `invoiceId` och `billingPreviousStatus`. Alternativt en egen åtgärd `set_billing_status`. Inga andra AO-fält.

## G6 — dubbel utstämpling

Klienten skickar utstämplingens tidpost med en idempotensnyckel som är densamma från alla enheter för samma pass (`TimeService`, molnstämpling). Servern förväntas returnera samma resultat för samma nyckel (`op_idempotency`) eller `id_collision`, aldrig två tidposter.

**Testmetod (ändrar data — kräver GO för testdata):** `--med-testdata` skickar två samtidiga `create_time` med samma nyckel för en märkt test-AO (titel innehåller "E2E"), räknar tidposterna (ska vara 1) och tar bort posten med `delete_time`.

## Körning (efter GO)

Se filhuvudet i `tests/e2e/staging-authz.js`. Miljövariabler: STAGING-adress, Supabase-adress, publik anon-nyckel, testlösenord och e-post per roll. Skriptet avbryter om adressen pekar på LIVE och om `--jag-har-go` saknas.
