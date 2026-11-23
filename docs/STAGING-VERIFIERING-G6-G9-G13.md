# STAGING-verifiering: serverbehörigheter (G13/BLOCKER-2), ekonomirollens AO-status (G9), dubbel utstämpling (G6)

Status 2026-11-23: **FÖRBEREDD — inte körd.** Kräver separat GO och isolerade testkonton.

> **Rättelse 2026-11-23 (kväll):** det tidigare skriptet `tests/e2e/staging-authz.js` beskrevs som ett test som inte ändrar data utan `--med-testdata`. **Det stämde inte.** Lucas och ChatGPT har läst de installerade STAGING-RPC:erna:
> - `store_business_key_merge_write` uppdaterar `store.updated_at` och `vift_lastChanged` även när en tillåten `writeMerge` varken lägger till eller tar bort någon post.
> - `work_order_patch` kan uppdatera AO:ns `updatedAt` och synksignaturen trots oförändrade fältvärden. G9-kontrollen gjorde en sådan no-op-patch på en **befintlig** AO.
>
> Skriptet är ersatt (det vägrar nu köra) av tre nivåer:
>
> | Nivå | Verktyg | Vad det skriver | GO |
> |---|---|---|---|
> | 0 | `tests/e2e/staging-readonly.js` | Inget. Anropen är oinloggade och nekas innan något läses eller skrivs. | Redan tillåtet (läsande) |
> | 1 | `tests/staging/authz-read.js` | Inga affärsdata. Inloggningen skriver i Supabase auth-schemat (session, refresh-token, `last_sign_in_at`). För EF:er utan källa i repot (G4) bygger "läsande" på kontraktet, inte på granskad kod. | Kräver GO + testkonton |
> | 2 | `tests/staging/authz-mutation.js` | Skapar och tar bort **egna, märkta testposter** (`E2E-AUTHZ-<tid>-<slump>`, "[E2E-TEST]"). Rör aldrig befintliga poster. `vift_lastChanged` och `store.updated_at` ändras (känd sidoeffekt). | Kräver uttryckligt GO för mutationstest + testkonton |
>
> Texten nedan om "testmetod som aldrig ändrar data" är **ersatt** och står kvar överstruken som historik.

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

~~**Testmetod som aldrig ändrar data:**~~ *(felaktigt — se rättelsen)* varje roll skickar en `writeMerge` som bara tar bort ett id som inte finns (`E2E-AUTHZ-PROBE-…`). En behörig server svarar 200 utan ändring. En obehörig svarar 401/403. Svarar servern 200 för en roll som inte ska skriva registret är det ett säkerhetsfel, även om inget skrevs. Kontrollerat mot den simulerade servern: inga affärsdata ändras; endast pollsignalen `vift_lastChanged` kan uppdateras. *(I STAGING uppdateras även `store.updated_at`. Detta är en skrivning.)*

**Ny metod (nivå 2):** varje roll gör `writeMerge` med en **märkt testpost** (inaktiv, `deleted: true`, rubrik "[E2E-TEST] …") och tar bort den direkt. Om rollen inte får skriva ska servern neka (401/403). Om servern ändå tillåter det rapporteras en avvikelse (BLOCKER-2), och posten tas bort av rollen själv eller av adminkontot. Register som inte är arrayer (t.ex. inställningar) prövas inte med testpost; där görs ingen skrivning alls.

## G9 — ekonomirollen och AO-status "fakturerad"

När ett fakturautkast skapas sätter klienten AO:ns `status: 'fakturerad'`, `invoiceId` och `billingPreviousStatus` via `ao-time-write` `patch_ao` (`BillingQueueService._syncBillingFields`). Den simulerade servern kräver AO-mutationsrätt (`ao_edit`/`ao_complete`/…), som ekonomirollen saknar. Därför nekas statusändringen. Klienten säger det och rullar tillbaka, och fakturan påverkas inte.

~~**Testmetod som aldrig ändrar data:** ekonomikontot skickar `patch_ao` med AO:ns nuvarande värden på en befintlig AO.~~ *(Felaktigt: en no-op-patch kan uppdatera AO:ns `updatedAt` och synksignaturen.)*

**Ny metod (nivå 2):** adminkontot skapar en egen test-AO (`<runId>-AO`, "[E2E-TEST] …", status `klar`). Ekonomikontot försöker sätta den till `fakturerad`. Utfallet (tillåtet eller nekat) redovisas som underlag för beslutet; inget räknas som godkänt eller underkänt. Test-AO:n tas bort efteråt. **Ingen befintlig AO patchas.**

**Om G9 bekräftas — föreslagen åtgärd (beslut krävs, öppna inte behörigheter generellt):** en smal serverregel i `ao-time-write` som låter `invoice_create` ändra **endast** fälten `status` (bara `klar` ↔ `fakturerad`), `invoiceId` och `billingPreviousStatus`. Alternativt en egen åtgärd `set_billing_status`. Inga andra AO-fält.

## G6 — dubbel utstämpling

Klienten skickar utstämplingens tidpost med en idempotensnyckel som är densamma från alla enheter för samma pass (`TimeService`, molnstämpling). Servern förväntas returnera samma resultat för samma nyckel (`op_idempotency`) eller `id_collision`, aldrig två tidposter.

**Testmetod (nivå 2):** fältkontot skickar två samtidiga `create_time` med samma idempotensnyckel mot **körningens egen test-AO**, med tidpost-id `<runId>-T1`. Testet räknar tidposterna (ska vara 1) och tar sedan bort dem. Det tidigare kravet att en märkt AO redan skulle finnas är borta.

## Körning (efter GO)

Se filhuvudena i `tests/staging/authz-read.js` och `tests/staging/authz-mutation.js`.

**Spärrar.** Alla kontrolleras innan första anropet. Varje spärr ger utgångskod 2 och inga anrop:
- `--jag-har-go`
- `--bekrafta-projekt=<ref>` måste vara exakt projektet i `VIFT_SUPABASE_URL`
- LIVE-projektet nekas alltid
- testkontonas e-post måste matcha testkontomönstret (standard: "e2e" i lokaldelen)
- nivå 2 kräver dessutom `--mutationstest` och `VIFT_MILJO=staging`

**Nivå 2 före körning:** ögonblicksbild av berörda register, alla AO och alla tidposter via adminkontot. Om testposter från en tidigare körning finns kvar avbryts körningen.

**Nivå 2 under körning:** en journal (`tests/staging/rapport/<runId>.journal.json`) skrivs **före** varje mutation.

**Nivå 2 efter körning:**
- Städning görs alltid, även om körningen avbryts.
- Verifiering att inga testposter finns kvar.
- Verifiering att alla befintliga register-element, AO (inklusive `updatedAt`) och tidposter är identiska med ögonblicksbilden.

**Lägen:** `--torrkorning` kör bara spärrar, inloggning och ögonblicksbild. `--stada=<runId>` tar bort kvarvarande testposter från en körning.

**Utgångskoder:** 0 OK · 1 säkerhetsavvikelse · 2 spärr · 3 testposter kvar (kör `--stada`) · 4 osäkert (en befintlig post ändrades under körningen, troligen av annan användare; granska).

**Lokalt prövat** (`tests/staging_tools.test.js`, 30/30) mot den simulerade servern bakom en lokal HTTP-server. Det bevisar verktygets spärrar, självkontroll, städning och efterkontroll, **inte** serverns verkliga behörigheter.
