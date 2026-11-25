# VIFT CRM – sammanställning och GO/NO-GO inför nästa steg (2026-11-26)

Omgången innehöll bara dokumentation och läsande inventering. Ingen server, migration eller data är ändrad, och LIVE är inte kontaktat.

## Leveranser

| # | Leverans | Fil |
|---|---|---|
| 1 | Uppdaterad auktoritativ masterplan: fyra verifieringsnivåer, punkt 211–271, riskregister R-01–R-18, beslut 2026-11-26, SÄK-1–SÄK-10, AP-A–AP-G, backlog UX-1–UX-8 | `docs/MASTERPLAN.md` (statusgranskningen är märkt som ersatt underlag) |
| 2 | Behörighetsmatris med 5 standardroller, 47 rader, cirka 200 positiva och negativa testfall och beslut D-01–D-26 | `docs/qa-2026-11-26/BEHORIGHETSMATRIS.md` |
| 3 | Återställd serverkällkod: 38/38 migrationer md5-verifierade, 26 Edge Functions, schemaögonblicksbild; `invoice-write` och `rondering-pass-write` återställda i repot | `vift-v2` commit `c011aa6`, `supabase/inventering/staging-2026-11-26/INVENTERING.md` |
| 4 | Saknade källor och vad som bara hör till STAGING | Nedan, samt `INVENTERING.md` och `STAGING-ONLY.md` |
| 5 | Utredning av arbetspoolen | `docs/qa-2026-11-26/ARBETSPOOL-UTREDNING.md` |
| 6 | Test- och installationsplan för säkerhetsomgången | `docs/qa-2026-11-26/SAKERHETSPROVNING-TESTPLAN.md` |

## Saknade källor och beroenden (G1/G4)

**Återskapat exakt från STAGING:**
- Alla Edge Functions.
- 38 körda migrationer, inklusive `ao_display_number`, som innehåller `work_order_create` och nummergeneratorn.
- Alla funktioner, policyer och triggers som ögonblicksbild.

**Finns bara i ögonblicksbilden** och behöver göras om till riktiga migrationer innan LIVE:
- 13 databasfunktioner:
  - `invoice_line_*`, `invoice_meta_update`, `invoice_discount_set`, `invoice_tax_reduction_set`;
  - `time_entry_create`, `time_entry_patch`, `time_entry_soft_delete`, `time_entry_set_attested`;
  - `_invoice_calc_financial`, `_invoice_financial_check`, `_protect_critical_store_keys`.
- De begränsande policyerna `store_*_no_direct_*`.
- Innehållet i 3 migrationer som kördes utan sparade satser.

**Kan inte återskapas från källkod:**
- Vault- och EF-hemligheter: SERVICE_MONITOR_SECRET, VAPID, RESEND, FROM_*, PUBLIC_BASE_URL.
- Cron-headerns hemliga värde.

Dessa sätts manuellt vid installation.

**Kräver beslut innan LIVE:**
- 5 EF där STAGING är nyare än repot: offer-respond, offer-token-validate, send-offer-email, get-/set-sensitive-fields. Rekommendation: uppdatera repot från STAGING.
- send-push måste slås ihop manuellt.
- vift-admin-storage: 410-stubbe eller borttagning?
- PUBLIC_BASE_URL måste sättas explicit i LIVE.

**Får aldrig till LIVE:**
- `e2e-test-cleanup`, `vift-admin-storage` (stubben).
- Migrationerna 20261117085418 och 20261124211128.
- Backup-scheman, `_qa_cleanup_journal_*`, testroller och E2E-konton.

**AO-numrens dubblett är förklarad:**
- Startvärdet för nummerserien sattes bara om högsta gamla nummer var *större* än 1. Med exakt ett gammalt AO-001 gav första nya AO nummer 1 igen.
- Det är den enda dubbletten i STAGING. Serien står nu på 412.
- Generatorn kontrollerar inte heller att numret är unikt.
- En rättning är föreslagen men inte gjord.

## Säkerhetsfynd i den här omgången (registrerade som SÄK i masterplanen)

| Id | Allvar | Kort |
|---|---|---|
| SÄK-5 | **P1** | Fält med `ao_complete` kan sätta "klar" på vilken AO som helst vars id är känt, även fakturerad. Servern kontrollerar varken tilldelning eller status. Bekräftat i källkod. |
| SÄK-3 | **P1** | Arbetspoolen: varje AO med status `pool` lämnas ut till all fältpersonal, även tilldelade AO. |
| SÄK-4 | P1 | "Ta jobbet" fungerar även om AO:n redan har personal, och samtidiga tagningar skyddas inte. |
| SÄK-2 | **P1** | Fältrollens Uppgifter visar andras uppgifter, eftersom servern lämnar ut hela `vift_activities`. |
| SÄK-6 | P1 | Materialpriser kommer från klienten. Okänt inköpspris sparas som 0 kr. |
| SÄK-1 | P2 | Exportcenter: Personnummer är förvalt (`sensitiveFields: []`). Exporten följer ändå serverns läsrätt, så ingen ny läcka. |
| SÄK-7–10 | P2 | Portkodsvägen, `staff_manage` kan ge sig själv admin, cache kvar efter utloggning, reservrollen `personal`. |

## Beroenden (förenklat)

1. **G1/G4: källa i repot** (klart som ögonblicksbild).
   - Kräver: konvertering av de 13 funktionerna och policyerna till migrationer.
   - Möjliggör: databastesterna, AO-nummerrättningen och LIVE-planen.
2. **Affärsbeslut:**
   - D-01–D-26 från behörighetsmatrisen. Mest brådskande: D-01, D-02, D-03, D-05, D-09–D-11, D-13, D-15, D-24, D-25.
   - AP-A, AP-E och AP-F från arbetspoolsutredningen.
   - Behövs före behörighetsimplementationen och vyerna för arbetspoolen.
3. **SÄK-5, SÄK-3 och SÄK-4 (serverregler):** kräver inga affärsbeslut. B4 och Ö7 (aktivitetslogg, uppgifter) bygger på den rättade poolregeln.
4. **B1/B5 (projektion och fältvis sammanslagning):** kräver beslut, källa och databastester.
5. **LIVE-plan:** kräver allt ovan, plus funktionell STAGING-verifiering av de moduler som bara testats simulerat.

## GO/NO-GO

| Nästa steg | Bedömning |
|---|---|
| Fatta affärsbesluten (D-, AP-, B-FAKT-1) | **GO.** Underlaget är klart. |
| G1/G4 del 2: gör ögonblicksbildens funktioner och policyer till migrationer i repot, synka de 5 nyare EF:erna och send-push till repot (endast repo, ingen installation) | **GO** |
| Köra de 4 PostgreSQL-testerna lokalt (container) mot den återskapade källan | **GO** efter del 2 |
| Rätta SÄK-5, SÄK-3, SÄK-4 och AP-FEL-1 i STAGING (serverregler och personaldialogen) | **GO efter ditt separata godkännande** av serveromgången. Kräver inga affärsbeslut. Med backup, rollback och testplanens faser. |
| Implementera B1–B5, Ö-besluten och standardrollerna | **NO-GO** tills besluten D-01–D-26 och AP-A/E/F är fattade |
| Större UI/UX-omgång (UX-1–UX-8) | **NO-GO** för nu. Ligger i backloggen, rätt etapp senare. |
| LIVE | **NO-GO** |
