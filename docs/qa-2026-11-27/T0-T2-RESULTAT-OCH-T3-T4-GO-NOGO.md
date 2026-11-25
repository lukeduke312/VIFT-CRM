# Omgång T0–T2: resultat och GO/NO-GO-underlag för T3/T4 (2026-11-27)

Omgången omfattade dokumentation, repoarbete och lokal testning. STAGING lästes bara med SELECT, inget installerades och ingen data ändrades. LIVE har inte kontaktats.

## Leveranser

| # | Leverans | Var | Status |
|---|---|---|---|
| 1 | Masterplanen med korrekta statusar | `docs/MASTERPLAN.md` | Uppdaterad |
| 2 | Fastställd behörighetsmatris (63 regler, nya behörigheter, felkodskatalog, negativa fall som kräver rätt orsak och oförändrad kontrollsumma) | `docs/qa-2026-11-26/BEHORIGHETSMATRIS.md` | Klar |
| 3 | Arbetspoolsutredning v2 med gemensam kategoridefinition | `docs/qa-2026-11-26/ARBETSPOOL-UTREDNING.md` | Klar |
| 4 | G1/G4 del 2 | `vift-v2` commit `168554b`, `supabase/inventering/G1-G4-DEL2-RESULTAT.md` | Klar lokalt |
| 5 | Lokala databastester | Nedan | Gröna |
| 6 | Kvarstående hinder för reproducerbar serverarkitektur | Nedan | — |
| 7 | Korrigerad säkerhets-, test- och installationsordning | `docs/qa-2026-11-26/SAKERHETSPROVNING-TESTPLAN.md` | Klar |
| 8 | GO/NO-GO för T3/T4 | Nedan | — |

Besluten finns ordagrant i `docs/qa-2026-11-27/BESLUT-2026-11-27.md`.

## G1/G4 del 2

**Migrationer** (28 nya filer i `vift-v2/supabase/migrations/`):
- **17 exakta:** återställda ur STAGING:s migrationshistorik, md5-verifierade.
- **3 kandidater:** för de tomma historikposterna. Märkta "inte bevisad historisk SQL".
- **5 rekonstruerade** ur STAGING-schemat (R-A–R-E): 13 funktioner, 14 begränsande policyer, skyddstrigger och grants.
- **Säkerhetsfynd:** utan R-E skulle en ny installation låta `anon` och `authenticated` anropa `provision_vift_user`, `deactivate_vift_user` och `check_app_users_health`. I STAGING är rättigheterna återkallade utanför migrationerna.

**Migrationskedjan:**
- Hela kedjan går igenom på tom lokal databas med Supabase-stubbar.
- Resultat: 126 identiska objekt, 7 förklarade avvikelser, 0 oförklarade.
- Körbar via `tests/local/migrationskedja.sh`.

**Edge Functions:**
- De fem som var nyare i STAGING är synkade. Repo-funktionalitet som saknades där är bevarad och märkt.
- send-push är manuellt sammanslagen.
- vift-admin-storage är avstängd och ligger bland STAGING-only.

**Miljö och separering:**
- `PUBLIC_BASE_URL` är miljöspecifik utan reservvärde. Saknas den svarar funktionen tydligt fel, och STAGING-domänen avvisas i LIVE.
- Allt som bara hör till STAGING ligger i `supabase/staging-only/` med exkluderingslista. Kedjeskriptet fallerar om något därifrån hamnar i den aktiva kedjan.

**Auktoritativ källa:** server = `vift-v2/supabase/`, klient = VIFT-CRM `claude/vift-v3-major-redesign`.

## Lokala tester (PostgreSQL 16.15, isolerat kluster, bara unix-socket)

| Test | Resultat |
|---|---|
| checklist_progress_sql | 32 godkända / 0 fel |
| server_rpcs_sql | 17 / 0 |
| offer_attachment_upload | 43 / 0 |
| staging_backup_export | 12 / 0 |
| rekonstruerade_rpc_sql (nytt) | 40 / 0 |
| public_base_url (nytt) | 16 / 0 |
| edge_functions_syntax (nytt) | 32 / 0 |
| migrationskedja (nytt) | Grön: 126 identiska, 7 förklarade, 0 oförklarade |
| vift-v2 `run-all.sh` | 19/20 filer, 477 godkända, 1 fel |

Kedjan och de sex databastesterna är omkörda och bekräftade av mig, utöver agentens körning.

**Fel och överhoppade:**
- Det enda felet är `staging_e2e_real`. Det fallerade likadant före ändringarna: den simulerade servern saknar `e2e-test-cleanup`.
- Webbläsartesterna hoppades över och räknas inte som godkända.
- Inga befintliga tester är ändrade för att bli gröna.

## Skillnader mellan lokal miljö och Supabase

- **Version:** STAGING kör PostgreSQL 17.6, lokalt kördes 16.15. PG17 gick inte att installera i miljön, eftersom paketkällan nekades. Ingen PG17-specifik syntax hittades i migrationerna, och md5-kontrollerna räknade på PG17 stämmer lokalt. Kedjan och SQL-testerna ska ändå köras en gång på PG17 före LIVE.
- **Stubbar:** Vault, pg_net, pg_cron, Storage-API och Auth är stubbade lokalt. RLS är provad med rollerna anon, authenticated och service_role.
- **Edge Functions** är bara syntaxkontrollerade, inte körda i Deno eller STAGING.

## Kvarstående hinder för reproducerbar serverarkitektur

1. **VIFT-CRM:s `supabase/`** är en inaktuell spegel som fortfarande innehåller PROPOSAL-filerna. Hanteringen kräver beslut; förslag finns i `AUKTORITATIV-KALLA.md`.
2. **13 installerade migrationer** har andra versionsnummer än repots filer. Mot befintliga STAGING skulle `supabase db push` se dem som nya. Det kräver `migration repair` eller en mappning, och ett beslut.
3. **Historisk SQL saknas:** de tre tomma historikposterna och de rekonstruerade objekten är inte historisk SQL. De begränsande R-D-policyerna får aktiveras först när klienten bara använder EF-vägarna.
4. **Edge Functions oprövade:** EF-ändringarna är inte körda i Deno eller STAGING.
5. **`offer_respond_commit`:** två beteenden från repot kräver en ny version av funktionen och ditt beslut (telefon/befattning i godkännandet, och att `ändring-begärd` räknas som besvarad).
6. **PG17-körning** återstår.
7. **Per miljö måste sättas:** Vault, secrets, cron och `PUBLIC_BASE_URL`, samt logotypen.
8. **AO-nummerseriens fel** finns kvar i den historiska migrationen och rättas i en ny migration (T3).

## Nya säkerhetsfynd (registrerade i masterplanen)

- **Tid och stämpling (P1):** `time_entry_create` och stämplingen kontrollerar inte att AO:n är tilldelad. `hourRate` tas från klienten. Strider mot AP-B och D-11.
- **Fakturerad via `patch_ao` (P1):** `ao_edit` kan sätta `fakturerad` och `invoiceId`. Strider mot D-07.
- **Arkiverade och borttagna i poolen:** `work-orders-list` filtrerar inte bort dem för pool-AO.
- **Idempotens:** `work_order_patch` returnerar sparat resultat när en idempotensnyckel återanvänds med en annan patch.
- **Direkt REST-skrivning** till nycklar utan affärsregel, t.ex. `vift_lastChanged`.
- **`rondering-pass-write`** kräver `ao_view_all` och kontrollerar inte per pass.
- **Simulerade servern avviker** från STAGING: checklistan startar AO:n automatiskt, och `patch_ao` saknar fältbegränsningar. Testresultat mot den servern speglar därför inte STAGING på de punkterna.

## Fastställd ordning (T3/T4)

Detaljer per paket finns i testplanen: innehåll, beroenden, lokala tester, STAGING-verifiering med märkta poster, backup, rollback och GO-kriterier.

**T3:**
- **T3-0:** grund. Rekonstruerade migrationer, EF-synk, lokal STAGING-replik, testverktyg som kontrollerar felkod och oförändrad kontrollsumma.
- **T3-A:** SÄK-10 och SÄK-9, i klienten. Före standardrollerna.
- **T3-B:** AO-skrivvägar under RPC-lås:
  - SÄK-5 (klarmarkering utan kontroll), SÄK-3 och SÄK-4 (poolregeln, "Ta jobbet");
  - F21 (fakturerad via `patch_ao`), F16/F23 (tid och stämpling), F17 (idempotens), samt filtrering av arkiverade och borttagna;
  - `ao_*_own` och `ao_pool_take`;
  - nummerseriens rättning.
  - Utlämningen kan rättas utan breddning; det är bevisat i arbetspoolsutredningen.
- **T3-C:** SÄK-8, superadmininvarianten (D-25), rollregistret (D-21) och F18 (REST-skrivning).
- **T3-D:** SÄK-2, B4/Ö7 och D-12–D-15/D-22. Bygger på den rättade poolregeln.
- **T3-E:** standardrollerna, med testkonton enligt D-26.

**T4:**
- **T4-A/B, samordnat:** B1 och B5 (skyddade fält och fältvis sammanslagning), `cost_view`/`cost_edit`, material och priser (D-09–D-11, D-19) och `time_view_all`.
- **T4-C:** åtkomstinformation för fält (D-05), förberedelse för D-16 och D-23.
- **T4-D:** rondering, `rondering_utfor`.
- **T4-E:** M8, faktura-PDF och kommentarer (D-20).
- **T4-F:** export (D-18, SÄK-1).

## GO/NO-GO

| Steg | Bedömning |
|---|---|
| T3-0 och lokal utveckling av T3-A–T3-E i tur och ordning (repo + lokala tester) | **GO** |
| Lokal utveckling av T4 efter T3 | **GO** i tur och ordning, efter svar på K-01–K-06 och Q1–Q4 där de berör paketet |
| Beslut om VIFT-CRM:s `supabase/`-spegel, migrationsmappningen och `offer_respond_commit` | **Beslut krävs** före installation i STAGING |
| PG17-körning av kedjan och SQL-testerna | **GO** om en PG17-miljö kan göras tillgänglig, t.ex. genom att paketkällan tillåts. Annars i samband med en godkänd gren eller installation. |
| Installation av T3-paket i STAGING | **NO-GO** tills separat godkännande per paket, med backup, rollback och märkta testposter |
| Skapa testkonton för standardrollerna i STAGING | **NO-GO** tills separat godkännande (D-26) |
| Datamigrering (portkoder, `inv.note`, `pool`-status) | **NO-GO** |
| UI/UX-omgång, rondering, framtidsmoduler | **NO-GO** i denna etapp |
| LIVE | **NO-GO** |
