# Händelse: två aktiviteter markerades oavsiktligt som klara i STAGING (åtgärdad)

**Vad:** ACT-006 och ACT-007 i `vift_activities` fick status "klar" 2026-11-24 22:28:36 och 22:29:11 UTC. Bägge är öppna uppföljningar som STAGING-administratören skapat, och bägge var förfallna sedan 2026-11-17.

**Vem/vad:** testkontot `e2e-admin`, alltså mitt eget skärmbildsskript. Före-bilderna av den publicerade dashboarden togs då, vid två skärmbredder. För att stänga dashboardens anpassningsläge klickade skriptet på första knappen på sidan med texten "Avbryt", "Klar" eller "Stäng". Den första sådana knappen var "Klar" på en försenad aktivitet i widgeten "Försenade aktiviteter".

**Upptäckt:** vid kontroll av STAGING-datan mot referensläget 2026-11-25 07:5x UTC. Endast `vift_activities` avvek. Övriga 34 nycklar var identiska.

**Återställning (2026-11-25 07:55 UTC):**
1. Det fullständiga nuvarande värdet journalfördes i `_qa_cleanup_journal_20261124` med nyckeln `vift_activities#before-restore-ACT-006-007`.
2. Bara ACT-006 och ACT-007 ändrades: `status` sattes till `open` och `completedAt`/`completedBy` till `null`. Det är exakt vad appens egen funktion "Öppna igen" (`ActivitiesService.reopen`) gör.
3. Före skrivningen kontrollerades att det återställda värdet ger referenslägets md5 `5b55cf10f640`. Efter skrivningen var md5 densamma.
4. `vift_lastChanged` sattes till aktuell tid så att öppna klienter läser om datan. Triggern uppdaterar den bara för offerter och fakturor.

**Förebyggande:**
- Skriptet är inte längre i bruk.
- Testverktygen som körs mot riktig STAGING (`e2e-real`) rör bara poster märkta `[E2E-TEST]`.
- Testverktygen jämför verksamhetsdata före och efter varje körning.
- Widgeten "Aktiviteter & uppföljningar" har fortfarande en "Klar"-knapp per rad. Det är en avsiktlig snabbfunktion och är inte borttagen.
- Ett skript mot verklig miljö får därför aldrig klicka på knappar som hittas via text.

**Lärdom:** klicka aldrig på knappar via löst textmönster i verklig miljö. Använd entydiga väljare, till exempel verktygsradens `data-`attribut.
