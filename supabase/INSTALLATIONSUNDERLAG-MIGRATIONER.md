# Installationsunderlag för databasmigrationer (MIG-1, 2026-11-28)

**Status: underlag. Ingenting i detta dokument är utfört mot STAGING eller LIVE.**
Varje steg mot en riktig miljö kräver separat godkännande av Lucas Samuelsson
(CLAUDE.md, BESLUT-2026-11-28 MIG-1). Det gäller till exempel `db push`, `migration repair`,
`apply_migration`, SQL Editor och deploy.

Underlaget bygger på den verifierade mappningen i `MIGRATIONSMAPPNING.md` och
`migrationsmappning.json`. Verifieringen görs med `node tests/local/migrationsmappning.js`.

## 1. Grundregel: redan installerad SQL körs aldrig igen

| Klass i mappningen | Mot STAGING | Mot en tom databas (LIVE-nyinstallation, replik) |
|---|---|---|
| installerad – får ALDRIG köras igen (36 versioner, 37 filer) | **Körs aldrig.** | Körs i ordningen i `MIGRATIONSORDNING.txt`. |
| kandidat (3) | **Körs aldrig.** Versionen är registrerad som tom. | Körs. Ger exakt driftobjekten. |
| rekonstruerad R-A–R-E (5) | **Körs aldrig som ny.** Objekten finns redan i STAGING (facit-kontrollerat). | Körs på sina platser (R-A före J1/A3a, R-B–R-E sist). |
| staging-only (2) | Redan installerade. Körs aldrig igen. | **Aldrig LIVE.** |
| ny – ej installerad i STAGING | Körs, efter godkännande, som en ny version. | Körs sist i ordningen. |

## 2. Nya ändringar (T3-B och senare)

1. Varje ny serverändring läggs som en **ny migrationsfil** i `supabase/migrations/`.
   - Filnamnet får versionsnummer **efter STAGING:s senaste installerade version, 20261124211128**,
     och efter de rekonstruerade filerna. I praktiken betyder det `2026112800000x_…` eller senare.
   - Ändra aldrig en befintlig fil i `migrations/`. En redan installerad fil som ändras skulle
     ge en annan md5 än i STAGING, och `migrationsmappning.js` underkänner det.
2. Lägg till filen sist i `MIGRATIONSORDNING.txt` som `NY  migrations/<fil>`, eller med sin
   framtida STAGING-version när den är installerad. Kör sedan:
   - `node tests/local/migrationsmappning.js --skriv` (filen klassas som "ny");
   - `tests/local/migrationskedja.sh bada`;
   - `node tests/replica_build.test.js`.
3. Den nya filen ska själv vara säker att köra **en gång** ovanpå STAGING:s nuvarande läge:
   - `create or replace` för funktioner;
   - `drop policy if exists` följt av `create policy`;
   - REVOKE/GRANT uttryckligen;
   - en STOP-kontroll (`raise exception`) om förutsättningen inte stämmer, till exempel md5 av den
     funktionsdefinition som ersätts. Mönstret finns i A3a/N2/CRM12.
4. En ny funktion som ersätter en rekonstruerad funktion (t.ex. `work_order_patch` i T3-B)
   ska ha en STOP-kontroll mot md5 av driftversionen enligt `inventering/.../schema/functions.sql`.

## 3. Installation i STAGING (beskrivning, utförs inte nu)

Förutsättningar: separat GO, och backup enligt testplanen §8. Backupen ska omfatta
`function_definitions` med md5 och policyer.

1. **Läsande förkontroll** (SELECT, GO krävs):
   - `select version, name, md5(array_to_string(statements, E';\n')) from supabase_migrations.schema_migrations order by version`
     ska ge exakt de 41 raderna och md5-värdena i `migrationsmappning.json`
     (`versioner[].md5Applicerad`). Avvikelse ger stopp.
   - `md5(pg_get_functiondef(oid))` för de funktioner den nya migrationen ersätter ska matcha facit.
2. **Applicera BARA de nya filerna** (klass "ny"), en i taget, i ordning.
   - **Inte** med `supabase db push`. `db push` jämför filnamn med `schema_migrations`, och
     11 filer för redan installerade versioner har ett annat nummer i filnamnet (listan finns i
     `MIGRATIONSMAPPNING.md`), och de 5 rekonstruerade filerna saknar STAGING-version.
     `db push` skulle därför försöka köra 16 filer igen, trots att deras objekt redan är installerade.
   - Utan repair-beslut används en kontrollerad väg, till exempel `apply_migration` med den nya
     filens innehåll och versionsnummer, efter GO. Den registrerar bara den nya versionen.
3. **Efterkontroll:** `schema_migrations` ska ha exakt en rad till per ny fil, och de 41 gamla
   ska vara oförändrade. Jämför funktions-md5, policyer och grants mot replikan
   (`tests/replica_build.test.js` plus den nya filen).

## 4. Hantering av `supabase migration list`-avvikelser

`supabase migration list` mot STAGING kommer att visa (räknat på filnamnen 2026-11-28):
- **12 versioner som bara finns remote**: de 10 vars repo-filer har andra nummer
  (20261116094016, 20261124145455, …145958, …150357, …150650, …151118, …160425, …201228,
  …210432, …210747) och de 2 STAGING-only-versionerna (20261117085418, 20261124211128), som
  ligger i `staging-only/`;
- **16 filer som bara finns lokalt**: 11 med andra nummer än STAGING-versionen och 5 rekonstruerade (R-A–R-E).

Det är **väntat och dokumenterat**. Hantering:
- **Ingen `supabase migration repair` och ingen `db push` mot STAGING** förrän ett uttryckligt
  beslut finns (MIG-1).
- Alternativ för ett senare beslut:
  - (a) markera de 16 lokala filerna som applicerade med repair (och lämna de 12 remote-versionerna);
  - (b) döp om de 11 filerna till sina STAGING-versioner. Det ändrar inte innehållet, men md5 och
    mappningen måste köras om;
  - (c) fortsätt med kontrollerad applicering per ny fil.
  Mappningen (`migrationsmappning.json`) är facit oavsett vilket alternativ som väljs.

## 5. LIVE (tom databas, senare)

- Kör alla filer i `supabase/migrations/` i ordningen i `MIGRATIONSORDNING.txt`.
  Filnamnsordningen fungerar också, verifierat lokalt med `migrationskedja.sh filnamn`.
- R-D-policyerna (RESTRICTIVE) installeras först när den klient som använder EF-vägarna är
  installerad (G1-G4-DEL2-RESULTAT §10.3).
- STAGING-only (`staging-only/`) installeras **aldrig**.
- Före LIVE ska kedjan och SQL-testerna ha körts på PostgreSQL 17 (STAGING kör 17.6, lokalt finns 16.15).

## 6. Rollback

- **Repo:** gren och commit.
- **STAGING-migration:** varje ny fil ska ha en återställningssektion som återställer
  driftversionen ur backupens `function_definitions` (exakt text och md5) och ur `policies.sql`.
  En rollback rör aldrig `store`-data som skapats efter backupen.
- Rollback av data görs aldrig genom att skriva över hela `store`. Bara märkta testposter får
  återställas, enligt testplanen §5.
