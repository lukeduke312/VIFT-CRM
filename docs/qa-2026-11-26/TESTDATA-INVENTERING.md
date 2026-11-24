# Testdata i STAGING – inventering 2026-11-26 (endast läsning, inget raderat)

Källa: SQL-läsning mot `public.store` 2026-11-24 22:3x UTC. Personnamn redovisas inte här, bara id.

## Omfattning

Tabellen räknar poster vars titel, namn, beskrivning eller id innehåller mönstret.

| Register | Totalt | QA-LOAD | QA-STRESS | QA-FINAL | QA-FIXVERIFY | TEST-… | ZZZ-QA | E2E | Utan testmarkering |
|---|---|---|---|---|---|---|---|---|---|
| Kunder | 543 | 503 | 11 | 5 | 11 | 1 | 2 | 2 | 2 (K-002, K-003) |
| Fastigheter | 131 | 120 | 0 | 3 | 1 | 1 | 1 | 1 | 0 |
| Arbetsordrar | 363 | 300 | 11 | 10 | 4 | 16 | 2 | 9 | 6 (AO-001, AO-04bc…, AO-f45d…, AO-55bc…, AO-faeb…, AO-d5e0…) |
| Offerter | 74 | 50 | 1 | 8 | 1 | 2 | 1 | 1 | 5 (OFF-001, -002, -003, -004, -007) |
| Fakturaunderlag | 87 | 52 | 6 | 7 | 1 | 7 | 2 | 2 | 4 |
| Tidposter | 1 122 | – | – | – | – | – | – | 7 | Övriga kopplade till AO ovan (ej klassade här) |

Projekt (3), återkommande (1) och säljchanser (1) är alla QA-märkta.

## Klassning enligt uppdraget

1. **Säkert raderbara testposter.** Bara sådant som e2e-verktygen själva skapat och journalfört.
   - Efter dagens städning finns inga sådana kvar.
   - `e2e-real` städar numera automatiskt kunder, fastigheter, offerter, AO, tidposter, fakturautkast, bilagor, händelser och filer.
2. **Behövs för fortsatta automatiska tester.**
   - De sex E2E-kontona med personalposter och e2e-rollerna.
   - QA-kunden `ZZZ-QA-E2E-20261117-XSS` (används av X1 som verklig lagrad-XSS-kontroll).
   - De två E2E-märkta kunderna och fastigheten.
3. **Referensdata som ska bevaras.**
   - Prisgrupper (PG-001–PG-005), artiklar, roller, titlar, kategorier, servicemallar, e-postmallar, inställningar, personal (utom E2E).
4. **Verksamhetsliknande poster som inte får påverkas.**
   - De omärkta posterna: kunder K-002 och K-003 (personnamn), AO och offerter utan testmärkning.
   - De kan vara skapade manuellt vid testning, men går inte att avgöra med säkerhet.
5. **Ursprung som inte kan säkerställas.**
   - Serierna QA-LOAD (503 kunder, 300 AO, 50 offerter, 52 underlag), QA-STRESS, QA-FINAL, QA-FIXVERIFY och TEST-R9B m.fl.
   - De är skapade av tidigare QA-omgångar. **Inget skapandeskript eller journal finns i något av repona**, så de kan inte verifieras som rena testposter.
   - De kan också vara refererade av underlag med status skickad/betald. Ett exempel: F-089, skapat av administratörssessionen 21:51.

## Beslut i denna körning

- **Ingenting raderas.** Kategori 5 kan inte styrkas som säker att radera, och massradering per namnmönster är uttryckligen förbjudet.
- För att bedöma gränssnittet utan testbrus används isolerade, simulerade datamängder (10, 100 och 1 000 AO; 10–1 000 fakturakandidater) i den lokala testmiljön. Inga stora datamängder skapas i STAGING.

## Förslag för separat beslut

En verifierad rensning av QA-LOAD kräver:
1. Export av berörda element till en backup-tabell, med samma journalmönster som i dagens städning.
2. Kontroll att inga underlag med status skickad eller betald, och inga tidposter eller AO utanför serien, refererar posterna.
3. Radering via de officiella vägarna där sådana finns. Övrigt via journalförd SQL.
4. Kontrollsummor före och efter.

Detta kräver ditt uttryckliga beslut, eftersom det berör ca 1 000 poster.
