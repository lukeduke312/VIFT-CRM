# VIFT CRM — webbläsartester (E2E)

Riktiga webbläsartester av hela klienten: Chromium (Playwright) klickar i
gränssnittet, fyller i formulär, öppnar och stänger dialoger, byter
användare och enheter. Inga mockade sidor — klienten är repots egen kod.

## Köra

```bash
node tests/e2e/run.js                       # hela sviten (~8–9 min)
node tests/e2e/run.js --grep "^(FLOW|ECO)"  # urval (regex på test-id)
node tests/e2e/run.js --module Kalender     # en modul
bash tests/run-all.sh                       # enhets-/statiska tester
```

Resultat: `tests/e2e/report/REPORT.md` och `results.json` (vid hel körning),
skärmbilder av misslyckade tester i `tests/e2e/report/screenshots/`.
Delkörningar skriver `report/last-partial.json` (ignoreras i git).
Kräver Playwright + Chromium (förinstallerat i utvecklingsmiljön; kör aldrig
`playwright install`).

## Vad som är simulerat

All trafik till Supabase dirigeras till `fake-backend.js` i testprocessen.
Den modellerar auth, `store` (REST), `store-key-write` (läs/skriv/
trevägsmerge, stämpelstatus), `ao-time-write`, `work-orders-list`,
`time-entries-list`, `invoice-write`, `rondering-pass-write`, checklistor,
bilder, känsliga fält och de publika offert-EF:erna. Utskick (e-post, push,
PDF) registreras bara i en simulerad utkorg — **inget lämnar maskinen**.
Externa resurser (typsnitt, kartor) blockeras.

Modellen bygger på klientens dokumenterade kontrakt. Källkoden till
`ao-time-write`, `store-key-write`, `work-orders-list`, `invoice-write` och
`rondering-pass-write` finns **inte** i repot (gap G4). Därför:

- Tester märkta `kind: 'contract'` (PERM-01/02) prövar den simulerade
  serverns behörighetsmodell — de måste upprepas mot STAGING.
- PERM-03 (generiska nycklar per roll i `store-key-write`) är **blockerad**:
  den riktiga regeln är okänd (BLOCKER-2).
- Felinjektion (`fake.addFault`) simulerar serverfel, tidsgränser, tappade
  svar och nätavbrott — samma klientkod, men felbilden är konstruerad.

Testkonton (påhittade, `@example.test`): admin, arbetsledare (chef),
två fältarbetare, ekonomi, begränsad AO-användare. Inga riktiga
kunduppgifter används.

## Läsande kontroll av befintlig STAGING

```bash
VIFT_STAGING_URL=https://<staging-domän> node tests/e2e/staging-readonly.js
```

Ingen inloggning, inga skrivningar (sidans POST/PUT/PATCH/DELETE blockeras),
inga utskick. Kontrollerar startsida utan JS-fel, att klienten pekar på
STAGING-projektet (inte LIVE), driftsatta versionsnummer mot repot,
oinloggad åtkomst (REST/EF nekas) och publik offertsida med ogiltig token.
STAGING-domän och projektreferens skrivs inte in i repot eller rapporten.

## Upprepa mot riktig STAGING (kräver GO, isolerade testkonton)

Sviten kör i dag mot den simulerade backenden: många kontroller läser
serverns läge direkt ur simuleringen (`t.fake.get(...)`). Mot STAGING ska
motsvarande kontroller göras med testkonton via de vanliga läsvägarna
(`work-orders-list`, `time-entries-list`, `store-key-write:readWithHash`)
och testdata som är märkt och städas. Listan över vad som måste upprepas
står i `docs/E2E-RAPPORT-2026-11-23.md` (avsnittet "Upprepa mot STAGING").
