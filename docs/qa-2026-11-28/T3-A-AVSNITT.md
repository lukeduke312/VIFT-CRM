# T3-A – klientskydd (SÄK-10/F7 och SÄK-9/F6)

Avsnitt för `T3-RESULTAT.md`. Skrivet i T3-A:s worktree, gren `worktree-agent-abae39c66de5b869d` med bas `113a656` (`claude/vift-v3-major-redesign`). Huvudsessionen sammanfogar.

**Verifieringsnivå: lokalt verifierad** mot den simulerade servern (`tests/e2e/fake-backend.js`) och i vm-sandlådor. Inget är verifierat i STAGING. Ingen serverkod, ingen `supabase/`-katalog och inget i `vift-v2` har ändrats. T3-A är bara klient.

## 1. Vad som gjorts

### SÄK-10 / F7: ingen reservroll (`AuthService.js`, tidigare rad 379)

- `Auth._resolveUser()` ger inte längre `role:'personal'` till en omatchad inloggning. Åtkomsten blir fail-closed:

  | Fall | `Auth.accessState()` |
  |---|---|
  | Servern nekar inläsningen (403, t.ex. ingen aktiv personalpost) | `no_staff` |
  | Ingen aktiv personalpost med inloggningens e-post | `no_staff` |
  | Personalpostens roll-id finns inte i `state.roles`, eller rollen saknar `permissions`-lista | `no_role` |
  | Personal och roller kommer bara från `SeedData`, alltså inte från servern eller användarens egen cache (nätfel utan egen cache) | `unverified` |

  I alla dessa fall gäller samma sak: `state.currentUser` är `null`, `Auth.can()`, `canAny()` och `canViewPage()` är `false`, och all data töms ur minnet, DOM och lokal cache. Sidan **"Ditt konto saknar behörighet i VIFT – kontakta administratören."** visas med knappen Logga ut. För `unverified` står i stället att behörigheten inte kunde kontrolleras, och knappen Försök igen finns. Meny, sidor och data visas inte.
- Åtkomsten avgörs i `initState()` direkt efter att personal och roller lästs in. Det sker innan baslinjer sätts, osparade ändringar spelas upp, stämpling hämtas, migreringar körs och utkorgen återupptas. En användare utan åtkomst utlöser därför inga skrivningar.
- Inga beslut fattas på rollnamn. Behörigheter hämtas bara ur rollregistret, med samma matchningsregel som servern (`_shared/vift-auth.ts`). Reserven via `user.permissions` är borttagen. Superadmin `'all'` fungerar som tidigare.
- `canViewPage()` är fail-closed: en sida som saknas i `PAGE_PERMISSIONS` nekas. Alla 37 sid-id i `index.html` och `Router.js` finns i tabellen. `Router.showPage()` renderar ingenting utan inloggning med fungerande roll.
- Kvarvarande läsare av rollnamn är bara förval i gränssnittet: dashboardlayout (`Dashboard.js:56/558/664`, `DashboardConfig`), rollvisning i `Sidebar` och förvald roll i personaldialogen. Det är tillåtet enligt matrisens §0.2. Ingen av dem påverkar behörighet.

### SÄK-9 / F6: utloggning, kontobyte, cache och flikar

**Cache.** All användarspecifik lokal cache rensas vid utloggning, när sessionen upphör, vid start utan session, när åtkomst saknas eller dras in, och vid inloggning när cachen tillhör någon annan. Det gäller `localStorage` `vift_*` (alla register, `lastChanged`, AO/tid, sökhistorik, stämplingscache) och hela `sessionStorage`. Följande behålls uttryckligen (`Storage._KEEP_RE`); allt annat med prefixet `vift_` rensas, även framtida nycklar:

| Behålls | Varför |
|---|---|
| `vift_auth_v2` | Sessionen. Tas bort separat. |
| `vift_outbox*`, `vift_settleIntents*`, `vift_persistJournal*`, `vift_activityOutbox*` | Osynkat arbete. Ägarnycklat, rensas aldrig tyst. |
| `vift_pendingStampClear_*` | En serverrensning som är skyldig ägaren. |
| `vift_logo_light`, `vift_logo_dark` | Företagets logotyp. Ingen användardata. |
| `vift_prefs_<id>`, `vift_push_onboarding_dismissed_<id>` | UI-val per användar-id. Ingen verksamhetsdata. |

Nycklar utan prefixet `vift_` (`dashLayout*`, `view-ao`, `vift-logops-supported`) är UI-val eller serverns förmåga och innehåller inga register. Undantaget är `offerDraft_v1_new_<id>`, ett osparat offertutkast per användar-id, som behålls som osynkat arbete. Se §6.

**Cachens ägare.** `vift_cacheOwner` är `<Supabase-projektets ref>|<e-post>`. Ref:en härleds ur deploymentens egen `SUPABASE_URL` och skrivs aldrig in i koden. Degraderad inläsning (`Storage._localAll()`, `state.js` cirka rad 983), `Storage.get`-reserven och alla cacheskrivningar (`Storage._writeCache`, även i `InvoiceService`, `RonderingSyncService`, läs-tjänsterna, `DataSync` och `persist`) gäller bara cachens ägare. Offline-läget visar därför aldrig en annan användares data.

**Minne och DOM.** `Auth._endClientSession()` och `_vfResetClientState()` tömmer alla register, baslinjer, konfliktutkast, index, stämplingsläge, synk, pågående läsningar, utkorgen i minnet, markeringar, dialoger, renderade sidor, meny och sökresultat. Läget sätts också till degraderat, så att `persist()` aldrig kan skicka det tömda läget.

**Identitetskontroll före sändning.** `Auth.assertSessionCurrent()` jämför fliken med den delade sessionen och körs:
- i `Storage._authFetch` före varje anrop och före en omsändning efter 401;
- i `persist()`, som också spärrar om identiteten bytts sedan ändringen gjordes;
- i utkorgens `enqueue` och `_sendOne`;
- i `Auth.getAccessToken()`. Det täcker tjänster som anropar `fetch` direkt (bilder, rondering, fakturor, push).

En flik vars delade session bytts eller loggats ut skickar alltså ingenting, även om storage-händelsen inte hunnit fram. En flik utan session kan inte längre via `_signalAuthFailure` ta bort en annan fliks nya session. `_clearSession` tar bara bort den delade nyckeln om den fortfarande är fliken egen.

**Utkorgar och journaler.** Allt osynkat isoleras per användare och miljö:

| Kö | Ny nyckel |
|---|---|
| AO/tid-utkorgen | `vift_outbox::<ref>::<e-post>` |
| Intents | `vift_settleIntents::<ref>::<e-post>` |
| Persist-journalen | `vift_persistJournal::<ref>::<e-post>` |
| Aktivitetskön | `vift_activityOutbox::<ref>::<e-post>` |

Utkorgsposter bär `owner`, `ownerUid` och `env`. Bara ägarens aktuella session får skicka (`Auth.ownsEntry` plus ägarkontroll i `_authFetch`). En post som tillhör någon annan ligger kvar oförändrad och räknas inte som ett försök. Nästa användare ser, räknar och skickar inte föregående användares poster. När rätt användare loggar in skickas de.

Aktivitetskön lagrades tidigare aldrig, eftersom `state.currentUser.email` saknades, och kunde efter ett kontobyte i samma flik skickas med nästa användares session. Nu sparas den under sin ägare och töms ur minnet vid kontobyte.

**Utloggning med osynkat.** `Auth.requestLogout()` används av menyns Logga ut. Finns osynkat visas en dialog med antalet per slag och tre val:
- Synka nu: skickar allt eget, även poster som nått taket för automatiska försök. Lyckas inte allt visas dialogen igen med det som återstår.
- Logga ut ändå: ändringarna ligger kvar för kontot på enheten.
- Avbryt.

Ingenting rensas tyst. När en flik saknar giltig session köas ingenting nytt; användaren får beskedet "Du är inte inloggad — ändringen sparades inte".

**Flera flikar.** Utloggning eller kontobyte i en flik slår igenom i andra flikar via storage-händelsen: fliken töms helt och visar inloggning. Behörighetsändringar i en flik når andra flikar för samma användare via `BroadcastChannel('vift-auth')`. Reserven är en storage-ping om kanalen saknas.

**Session som upphör.** Om JWT:n har gått ut och förnyelsen misslyckas gäller fail-closed: fliken töms, den delade cachen rensas och inloggningen visas med beskedet "Din session har upphört — logga in igen …". Inget skickas med den utgångna identiteten. En osparad registerändring ligger kvar i ägarens journal och skickas när samma användare loggar in igen.

**Indragna behörigheter.** Efter varje `DataSync`-poll som läser personal och roller körs `Auth.applyAuthorizationChange('sync')`. Vid HTTP 403 körs `Auth.onServerForbidden()`, som efter 300 ms läser om `vift_staff` och `vift_roles`, med samma atomiska läsväg som `initState`. Den kan också utlösas av ett meddelande från en annan flik. Behörigheterna tillämpas direkt: en otillåten sida lämnas med ett besked och menyn ritas om. Saknas åtkomst helt, till exempel när personalposten inaktiverats och servern svarar 403, töms allt och no-access-sidan visas. Admin- och personaldialogen använder samma väg när användaren ändrar sin egen roll.

**Service Worker.** Ingen ändring behövs. `service-worker.js` (`vift-crm-v14`) släpper alltid igenom `supabase.co` och cachar bara statiska filer från samma ursprung: `?v=`, `/assets/` och HTML. Det finns ingen API-data i CacheStorage och inget IndexedDB används. Statiska filer får ligga kvar.

## 2. Ändrade filer

**Klient** (`?v=` höjt för varje fil):

| Fil | `?v=` |
|---|---|
| `src/data/storage.js` | 22→23 |
| `src/data/state.js` | 78→79 |
| `src/services/AuthService.js` | 23→24 |
| `src/services/AOTimeSyncService.js` | 11→12 |
| `src/services/ActivityService.js` | 6→7 |
| `src/services/TimeEntriesReadService.js` | 2→3 |
| `src/services/WorkOrdersReadService.js` | 2→3 |
| `src/services/InvoiceService.js` | 19→20 |
| `src/services/RonderingSyncService.js` | 1→2 |
| `src/components/Sidebar.js` | 33→34 |
| `src/pages/Router.js` | 32→33 |
| `src/pages/PageShells.js` | 191→192 |

`index.html` har fått no-access-panelen, `App.showNoAccess`, åtkomstkontrollen efter `initState` och varningen för äldre utkorgsposter.

**Tester:**
- `tests/e2e/specs/36_client_security.js` (ny);
- `tests/e2e/lib.js` (`World.tab()`: flera flikar i samma webbläsarkontext);
- `tests/client_security.test.js` (ny).

**Dokument:**
- detta avsnitt;
- `docs/MASTERPLAN.md`: raderna SÄK-9, SÄK-10, 265 och T3-A;
- `docs/qa-2026-11-26/BEHORIGHETSMATRIS.md`: §0.2, R61, SEC-ROLL-10, SEC-CUST-23, SEC-CACHE och F6/F7.

## 3. Commits (bara VIFT-CRM, worktree-grenen; inte pushade)

| Commit | Innehåll |
|---|---|
| `4b43ee9` | Klientkoden och `?v=` |
| `63e94a4` | Testerna |
| `77b8e1a` | Detta avsnitt, statusraderna och e2e-rapporten |

Inga commits i `vift-v2`.

## 4. Tester

### Baslinje, oförändrad kod (`113a656`): fynden bevisade

Den nya specen kördes före rättningen: **12 av 13 misslyckades**. Det enda som gick igenom var SEC-CACHE-04, det positiva fallet där samma användare använder sin egen cache.

| Test | Fynd i oförändrad kod |
|---|---|
| SEC-CACHE-01 | 36 `vift_*`-nycklar låg kvar efter utloggning, bland annat `vift_customers`, `vift_staff`, `vift_roles`, `vift_invoices`, `vift_offers`, `vift_settings` och ADM:s sökhistorik. |
| SEC-CACHE-02 | FÄ såg ADM:s cachade kund `K-FRAMMANDE` vid nätfel. |
| SEC-CACHE-03 | Den andra fliken behöll 7 kunder, 6 personal, 5 roller, 5 offerter och 5 fakturor i minnet efter utloggning i den första fliken. |
| SEC-TAB-02 | Efter kontobyte i den delade sessionen skrev fliken med den gamla identiteten: `persist` gav `true` och `patchAO` gav `ok`. |
| SEC-SESS-01 | När sessionen upphört låg all data och `currentUser` kvar i minnet. |
| SEC-OUTBOX-02 | En utkorgspost utan ägare från en äldre version skickades under en annan användare. |
| SEC-ROLL-10 och SEC-CUST-23 | Ingen no-access-sida. Omatchad användare fick reservrollen. |
| SEC-PERM-01 och SEC-PERM-02 | Otillåten sida låg kvar. Inaktiverad personal behöll åtkomsten i den öppna sessionen. |
| SEC-NORM-01 och SEC-OUTBOX-01 | Ingen utloggningsvarning fanns (`requestLogout` saknades). |

Märkning: BASLINJE. Underlag: `t3a-baseline-sec.json` i scratchpad, inte i repot.

### Efter rättning

| Körning | Resultat |
|---|---|
| `tests/e2e/specs/36_client_security.js` | **13/13 godkända**. Varje negativt fall kontrollerar md5-kontrollsumman över den simulerade serverns store, stämpling, känsliga fält och idempotens, att inga skrivanrop gjorts, samt det förväntade klientbeteendet. |
| `tests/client_security.test.js` | **38/38 godkända** |
| Relevanta befintliga e2e-specar (AUTH, PERM, TIME, SYNC, RES, SW, RENDER-01, XSS-01, ROLE, ARP, STAFF, MYJOBS, SEC) | **54 godkända, 0 misslyckade, 1 blockerad** (PERM-03, sedan tidigare blockerad: G4/BLOCKER-2, inte T3-A). Efter den sista mindre rättningen kördes SEC och AUTH igen: 19/19 godkända. |
| Hela e2e-sviten | **229 godkända, 0 misslyckade, 1 blockerad, 1 känt fel av 231** (§4.1) |
| `bash tests/run-all.sh` med lokal PostgreSQL (`PGHOST=/var/tmp/vift-localpg`) | **20/20 testfiler gröna, 0 överhoppade** |

De 13 e2e-fallen:

| Test | Innehåll |
|---|---|
| SEC-NORM-01 | Normalläge |
| SEC-CACHE-01 | ADM loggar ut, FÄ loggar in: inga affärsnycklar, inget sessionStorage, tomt minne och tom DOM |
| SEC-CACHE-02 | Nätavbrott efter kontobyte med en främmande cache från v3.4 |
| SEC-CACHE-03 | Utloggning och kontobyte i annan flik |
| SEC-CACHE-04 | Positivt fall: egen cache vid nätfel. Skrivning blockerad. |
| SEC-TAB-02 | Kontobyte innan storage-händelsen kommit fram. Ingen token lämnas ut. |
| SEC-SESS-01 | Utgången session. Journalen behålls och skickas av ägaren. |
| SEC-OUTBOX-01 | Varningsdialogen och utkorg vid kontobyte |
| SEC-OUTBOX-02 | Migrering av v3.4-nycklar |
| SEC-ROLL-10 | Omatchad användare |
| SEC-CUST-23 | Okänt roll-id |
| SEC-PERM-01 | Indragen behörighet i öppen session och i annan flik utan egen synk |
| SEC-PERM-02 | Inaktiverad personal under session: 403 leder till no-access |

### 4.1 Hela e2e-sviten

Hela sviten kördes en gång efter commit `63e94a4`: `node tests/e2e/run.js`, 1656 s. Resultatet står i `tests/e2e/report/REPORT.md` och `results.json`.

**231 tester: 229 godkända, 0 misslyckade, 1 blockerad, 1 känt fel.** Förra fulla körningen (2026-11-25) hade 218 tester. Skillnaden är de 13 nya SEC-testerna.

| Test | Status | Kommentar |
|---|---|---|
| PERM-03 | Blockerad, som tidigare | G4/BLOCKER-2, kan inte prövas mot den simulerade servern |
| AO-07 | Känt fel, som tidigare | G5: loggen skickas som hel array |

Ingen regression. Inget test har ändrats för att bli grönt. Den enda ändringen i befintlig testinfrastruktur är `World.tab()` i `lib.js`, som är additiv.

## 5. SÄK-status

| Id | Status |
|---|---|
| SÄK-10 / F7 | **Lokalt åtgärdad.** Förutsättningen "SÄK-10 är rättad" för att införa standardrollen `personal` (matrisen §2) är uppfylld lokalt. Den måste fortfarande installeras i STAGING före T3-E. |
| SÄK-9 / F6 | **Lokalt åtgärdad.** Gäller R61, SEC-CACHE-01..03, flikar, utgången session, utkorgar och indragna behörigheter. P1 inför LIVE kvarstår tills den är installerad och verifierad i STAGING (SEC-CACHE-01..03 i webbläsare med testkonton). |
| Punkt 265 (C-7) | **Delvis.** Stämplingsnycklarna med e-post rensas nu vid utloggning. Kvar: fem seriella anrop vid inloggning och STAGING-etiketten. |
| Serverdelen | **Öppen** (andra paket). Klienten är bara presentation. Servern måste fortsätta neka (403 `Forbidden` för omatchad användare enligt `vift-auth.ts`), och direkta REST-vägar (F18) och behörighetsgenomslag på servern (T3-C) ligger utanför T3-A. |

## 6. Bakåtkompatibilitet: användare med v3.4 i cachen

**Service Worker.** `index.html` hämtas alltid network-first med `no-store`. Vid nästa uppkopplade sidladdning laddas de nya `?v=`-filerna. Vid en offlinestart innan dess körs v3.4 från cachen, med v3.4:s beteende, tills användaren är uppkopplad igen.

**Server.** Ingen serverändring, så en v3.4-klient får inga nya felkoder. Den saknar bara klientskydden tills den uppdateras.

**Cache utan ägare.** Cache från v3.4 saknar ägarmarkör och rensas vid den första starten eller inloggningen med T3-A. Den första offlinestarten efter uppgraderingen har därför ingen offline-cache: användaren får `unverified` med Försök igen, aldrig någon annans data. Det sker en gång.

**Utkorgen (`vift_outbox`, gemensam i v3.4).** Poster där ägaren (`owner`) står flyttas till `vift_outbox::<ref>::<owner>`. Miljön är given eftersom samma ursprung är samma Supabase-projekt. Poster utan ägare, från versioner äldre än v3.4, ligger kvar i den gamla nyckeln. De skickas aldrig automatiskt, och varningen "N osynkade ändringar från en äldre version … saknar känd ägare och skickas inte automatiskt. Kontakta administratören." visas vid inloggning. Ingenting raderas. Testat i SEC-OUTBOX-02 och i enhetstestet: 3 poster före och 3 efter.

**Intents (`vift_settleIntents`).** De följer ägaren till sin utkorgspost. En intent utan känd ägare behålls i den gamla nyckeln och räknas i varningen.

**Journalen (`vift_persistJournal:<e-post>`, v3.4).** Den flyttas till `vift_persistJournal::<ref>::<e-post>` när ägaren läser den. Den äldre gemensamma `vift_persistJournal` hanteras som tidigare: den spelas bara upp för den användare som står i `j.user`.

**Aktivitetskön.** v3.4 lagrade den aldrig, så det finns inget att migrera.

**Blandade flikar.** En v3.4-flik som är öppen samtidigt kan fortsätta skriva till den gamla `vift_outbox`. De posterna migreras vid nästa sidladdning eller inloggning och går inte förlorade.

**Rensa lokal cache (admin).** Funktionen behåller nu utkorgar och journaler som tillhör andra användare eller saknar ägare. Bara den egna kön kan rensas, efter dubbel bekräftelse.

## 7. Installation (STAGING-klientpaketet) och rollback

T3-A är bara klient. Ingen databas, inga Edge Functions, ingen Storage och inga hemligheter berörs.

**Installation (kräver GO):**
1. Spara föregående STAGING-klientpaket som backup.
2. Bygg paketet från grenen (`tools/build-staging-package.sh`) med STAGING-överlägget.
3. Publicera alla ändrade filer i §2 tillsammans med `index.html`. `?v=` är redan höjt.
4. Hårdladda och verifiera de nya versionerna (`tools/verify-staging-deploy.sh`).
5. Verifiera i webbläsare med testkonton (D-26), bara läsande:
   - SEC-CACHE-01..03;
   - SEC-ROLL-10 med ett konto utan personalpost, om ett sådant godkänns;
   - kontroll av utloggningsdialogen.

**Rollback:** publicera det föregående paketet. Ingen verksamhetsdata skrivs över, eftersom servern inte berörs. Observera två saker:
- Osynkade poster som köats under T3-A ligger i de ägarnycklade nycklarna (`vift_outbox::…`, `vift_persistJournal::…`). v3.4 läser inte dem. De finns kvar i webbläsaren och skickas när T3-A installeras igen, men inte under tiden.
- Be därför fältet logga ut med "Synka nu" före en rollback. Dialogen visar osynkat.

Ett alternativ är ett litet rollback-tillägg som flyttar posterna tillbaka till `vift_outbox`. Det är inte byggt och får beslutas vid behov.

## 8. GO-kriterier (testplanen T3-A)

| Kriterium | Uppfyllt lokalt |
|---|---|
| SEC-CACHE-01..03 gröna | **Ja** (plus SEC-CACHE-04 som positivt fall) |
| SEC-ROLL-10 grön | **Ja** (och SEC-CUST-23) |
| Ingen förlust av osynkade ändringar, utkorgen orörd | **Ja**. Utkorg, journal, intents och aktivitetskö behålls ägarnycklade (SEC-OUTBOX-01/02, SEC-SESS-01). Poster utan känd ägare behålls. |
| `tests/run-all.sh` (regression) | **Ja**, 20/20 |
| Hela e2e-sviten | **Ja**: 229/231 godkända, 0 misslyckade. 1 blockerad och 1 känt fel, båda sedan tidigare. |

## 9. Begränsningar

- Klientskyddet är presentation och dataskydd på enheten, inte ett behörighetsskydd. Servern bestämmer. Allt är lokalt verifierat mot den simulerade servern, inget i STAGING.
- En uppringning som redan skickats innan ett kontobyte i en annan flik fullföljs med sin token. Skyddet gäller allt som skickas efter bytet.
- Data i `localStorage` som behålls (utkorgar och journaler) innehåller ägarens osynkade ändringar och kan läsas med utvecklarverktyg på en delad enhet. De visas och skickas aldrig av appen för någon annan. Detsamma gäller offertutkastet `offerDraft_v1_new_<id>`.
- Sökhistorik och påminnelsetid för 8-timmarsstämpling rensas vid utloggning, alltså också för samma användare.
- Den första offlinestarten efter uppgraderingen har ingen cache (§6).
- `role.active` påverkar inte behörigheten, i paritet med servern (`vift-auth.ts`).
- 403 utlöser en omläsning av personal och roller, debouncad till 300 ms. En behörighetsändring som servern inte signalerar syns vid nästa poll, som körs var 15:e sekund när fliken är synlig, eller via en annan flik.
- När en session upphör utan att användaren loggat ut kan ingen varning om osynkat visas, eftersom sessionen redan är borta. Ändringarna ligger kvar för ägaren.
