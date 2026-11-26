# VIFT CRM — E2E-resultat

Genererad 2026-11-26T13:15:01.968Z. Mål: simulerad backend (FakeSupabase). Webbläsare: Chromium (Playwright).

**274 tester: 274 godkända, 0 misslyckade, 0 blockerade, 0 kända fel (reproducerade, ej åtgärdade).**

Simulerad backend: klientens beteende mot en modell av Supabase-kontrakten — inte verifierat mot riktig STAGING.

**Modultäckning: 32 av 32 moduler har minst ett godkänt webbläsartest. Kritiska arbetsflöden: 37 av 37 godkända.** Ett godkänt test visar att det beskrivna flödet fungerar — inte att varje knapp på sidan är prövad; se kolumnen Omfattning.

| # | Modul | Tester | Godkända | Misslyckade | Kända fel | Blockerade | Omfattning |
|---|---|---|---|---|---|---|---|
| 1 | Inloggning och utloggning | AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06 | 6 | 0 | 0 | 0 | UI-funktioner |
| 2 | Dashboard | DASH-01, MAP-01, DASH-E-01, DASH-E-02, DASH-E-03, DASH-E-04, DASH-E-05, DASH-E-07, DASH-E-08, DASH-E-10, DASH-E-09, DASH-E-11, FALT-05 | 13 | 0 | 0 | 0 | UI-funktioner |
| 3 | Navigering och menyer | PAGES-01, PAGES-02 | 2 | 0 | 0 | 0 | UI-funktioner |
| 4 | Kundregister | CUS-01, CUS-02, CUS-03, G12-01, MISC-DATA-02, MISC-CUS-REACH-01 | 6 | 0 | 0 | 0 | UI-funktioner |
| 5 | Kontaktpersoner | CON-01 | 1 | 0 | 0 | 0 | UI-funktioner |
| 6 | Fastighetsregister | PROP-01, PROP-02, PROP-03, MISC-PROP-01, MISC-PROP-02, MISC-PROP-03, MISC-TASK-03 | 7 | 0 | 0 | 0 | UI-funktioner |
| 7 | Objekt och lägenheter | OBJ-01 | 1 | 0 | 0 | 0 | UI-funktioner |
| 8 | Arbetsordrar | AO-01, AO-02, AO-03, AO-04, AO-05, AO-06, AO-07, AO-09, AOL-01, AOL-02, AOL-03, AOL-04, AOL-05, AOL-06, AOL-07, AOL-08, AOL-09, AOD-01, AOD-02, AOD-06, AOD-07, AOD-08, AOD-09, T3B-01, T3B-02 | 25 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 9 | Arbetsorderchecklistor | CHK-01, CHK-02, CHK-03, CHK-04, CHK-05, CHK-06, CHK-07, SYNC-AO-01, AOD-03 | 9 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 10 | Arbetsorderloggar | LOG-01, LOG-02, LOG-03, LOG-04, LOG-05, AO-07B, AO-07C, AO-07D | 8 | 0 | 0 | 0 | UI-funktioner |
| 11 | Bilder och dokument | IMG-01, IMG-02, IMG-03 | 3 | 0 | 0 | 0 | UI-funktioner |
| 12 | Materialregistrering | MAT-01 | 1 | 0 | 0 | 0 | UI-funktioner |
| 13 | Tidregistrering och instämpling | TIME-01, TIME-02, TIME-03, TIME-04, TIME-07, TIME-05, TIME-06, TIME-08, AOD-04, ARP-05, FALT-02, FALT-04, T3B-05 | 13 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 14 | Mina jobb | MYJOBS-01, FALT-01, FALT-03, FALT-07, FALT-08, FALT-10, T3B-03 | 7 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 15 | Personalregister | STAFF-01, STAFF-02 | 2 | 0 | 0 | 0 | UI-funktioner |
| 16 | Användarroller och behörigheter | ROLE-01, AO-08, ROLE-02, PERM-01, PERM-02, PERM-03, PERM-04, AOD-05, T3B-04 | 9 | 0 | 0 | 0 | UI + serverkontrakt (simulerat) |
| 17 | Offertmodulen | FLOW-01, OFF-03, OFF-02, ATT-01, ATT-02, G8-01, OFFW-01, OFFW-02, OFFD-01, OFFD-02, OFFD-05, OFFW-03, SYNC-ED-01 | 13 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 18 | Digitala offertlänkar och kundsvar | OFF-04, OFF-01, OFFD-03 | 3 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 19 | Fakturering och fakturaunderlag | INV-01, INV-02, ECO-01, G10-01, BILL-01, BILL-02, BILL-03, BILL-04, BILL-05, BILL-06, BILL-07, BILL-09, BILL-10, BILL-11 | 14 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 20 | Prisgrupper och artiklar | ART-01 | 1 | 0 | 0 | 0 | UI-funktioner |
| 21 | Projekt | PROJ-01, MISC-DATA-01, MISC-TASK-01 | 3 | 0 | 0 | 0 | UI-funktioner |
| 22 | Rondering | RON-01, RON-03, MISC-RON-01 | 3 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 23 | Avvikelser | RON-02 | 1 | 0 | 0 | 0 | UI-funktioner |
| 24 | Serviceintervall | SVC-01, SVC-02, SVC-03, SVC-UI-01 | 4 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 25 | Återkommande AO | REC-01, FALT-06 | 2 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 26 | Att göra | TASK-01, TASK-02 | 2 | 0 | 0 | 0 | UI-funktioner |
| 27 | Kalender | CAL-01, CAL-02, MISC-CAL-01, MISC-TASK-02 | 4 | 0 | 0 | 0 | UI-funktioner |
| 28 | Säljchanser | SALES-01 | 1 | 0 | 0 | 0 | UI-funktioner |
| 29 | Rapporter och statistik | REP-01, ARP-03, ARP-04 | 3 | 0 | 0 | 0 | UI-funktioner |
| 30 | Import och export | IMP-01, IMP-02, EXP-01, IMP-03, MISC-IMP-01 | 5 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 31 | Inställningar och administration | ADMIN-01, MODAL-01, ARP-01, ARP-02, ARP-07 | 5 | 0 | 0 | 0 | UI-funktioner |
| 32 | Push och notifieringsgränssnitt | NOTIF-01 | 1 | 0 | 0 | 0 | UI-funktioner |

**Tvärgående:** Responsiv layout (5/5 godkända: RESP-DESKTOP, RESP-LAPTOP, RESP-TABLET, RESP-IPHONE, RESP-ANDROID); Robusthet (5/5 godkända: RES-01, RES-02, RES-03, RES-04, SW-01); Prestanda (1/1 godkända: PERF-01); Designstandard (5/5 godkända: UI-KV-01, UI-PROP-01, UI-BDG-01, MISC-HEAD-01, MISC-ICON-01); Sparning och synk (1/1 godkända: STG-01); Aktivitetslogg (1/1 godkända: ACT-01); Arbetsorder (mobil) (1/1 godkända: QBAR-01); Ekonomi (V3) (2/2 godkända: ECO-V3-01, ECO-V3-02); Dashboard (mobil) (2/2 godkända: DASH-M-01, DASH-E-06); Säkerhet (49/49 godkända: XSS-01, RENDER-01, RENDER-01-CHEF, RENDER-01-EKONOMI, RENDER-01-FALT, BILL-08, ARP-06, OFFD-04, FALT-09, SEC-NORM-01, SEC-CACHE-01, SEC-CACHE-02, SEC-CACHE-04, SEC-CACHE-03, SEC-TAB-02, SEC-SESS-01, SEC-OUTBOX-01, SEC-OUTBOX-02, SEC-ROLL-10, SEC-CUST-23, SEC-PERM-01, SEC-PERM-02, T3C-01, T3C-02, T3C-03, T3C-04, T3C-05, T3C-06, T3C-07, T3D-01, T3D-02, T3D-03, T3D-04, T3E-01, T3E-02, T3E-03, T3E-04, T3E-05, T3E-06, T3E-07, T4A-01, T4A-02, T4A-03, T4A-04, T4A-05, T4A-06, T4A-07, T4B-01, T4B-02); Offerter (1/1 godkända: VAT-01); Administration (2/2 godkända: BRAND-01, T4B-05); Register (V3) (11/11 godkända: REG-UI-01, REG-UI-02, REG-UI-03, REG-UI-04, REG-UI-05, REG-UI-06, REG-UI-07, REG-UI-08, REG-UI-09, REG-UI-10, REG-UI-11); Notiser (5/5 godkända: NOTIF-02, NOTIF-03, NOTIF-04, NOTIF-05, NOTIF-06); Fakturering (1/1 godkända: T4B-03); Tid (3/3 godkända: T4B-04, T4B-06, T4B-07); Arbetsorder (1/1 godkända: T4B-08).

## Per test

| Id | Modul | Test | Resultat | Tid | Anmärkning |
|---|---|---|---|---|---|
| AUTH-01 | Inloggning och utloggning | Inloggning med giltigt konto visar appen och rätt användare | Godkänd | 1380 ms | Laddade 15 AO och 7 kunder |
| AUTH-02 | Inloggning och utloggning | Fel lösenord ger begripligt fel och ingen inloggning | Godkänd | 390 ms |  |
| AUTH-03 | Inloggning och utloggning | Utloggning via menyn rensar session och skyddad cache | Godkänd | 815 ms |  |
| AUTH-04 | Inloggning och utloggning | Användarbyte på samma enhet: ny användare ser inte föregåendes lönedata | Godkänd | 1370 ms | ekonomi såg 6 poster, fältarbetaren 3 |
| AUTH-05 | Inloggning och utloggning | Sessionen överlever omladdning | Godkänd | 1021 ms |  |
| AUTH-06 | Inloggning och utloggning | Snabb inmatning direkt när inloggningen visas: lösenordet hamnar aldrig i e-postfältet (fördröjd autofokus) | Godkänd | 802 ms |  |
| PAGES-01 | Navigering och menyer | Alla 37 registrerade sidor öppnas utan JS-fel och utan "undefined/NaN" (admin, laptop) | Godkänd | 14421 ms | pg-project-detail: ingen testdata (projectId) — tomt läge; pg-propobj-detail: ingen testdata (objId) — tomt läge |
| PAGES-02 | Navigering och menyer | Sidomenyn: varje synligt menyval öppnar sin sida; tillbaka-knappen fungerar | Godkänd | 8567 ms | 23 menyval klickade |
| RESP-DESKTOP | Responsiv layout | Alla sidor i desktop: ingen horisontell scroll, inga knappar utanför skärmen | Godkänd | 14595 ms | pg-project-detail: ingen testdata (projectId) — tomt läge; pg-propobj-detail: ingen testdata (objId) — tomt läge |
| RESP-LAPTOP | Responsiv layout | Alla sidor i laptop: ingen horisontell scroll, inga knappar utanför skärmen | Godkänd | 14612 ms | pg-project-detail: ingen testdata (projectId) — tomt läge; pg-propobj-detail: ingen testdata (objId) — tomt läge |
| RESP-TABLET | Responsiv layout | Alla sidor i tablet: ingen horisontell scroll, inga knappar utanför skärmen | Godkänd | 14389 ms | pg-project-detail: ingen testdata (projectId) — tomt läge; pg-propobj-detail: ingen testdata (objId) — tomt läge |
| RESP-IPHONE | Responsiv layout | Alla sidor i iphone: ingen horisontell scroll, inga knappar utanför skärmen | Godkänd | 14426 ms | pg-project-detail: ingen testdata (projectId) — tomt läge; pg-propobj-detail: ingen testdata (objId) — tomt läge |
| RESP-ANDROID | Responsiv layout | Alla sidor i android: ingen horisontell scroll, inga knappar utanför skärmen | Godkänd | 14454 ms | pg-project-detail: ingen testdata (projectId) — tomt läge; pg-propobj-detail: ingen testdata (objId) — tomt läge |
| CUS-01 | Kundregister | Ny kund via formulär sparas på servern, syns i listan och hittas med sökning | Godkänd | 3395 ms | besked: Kund skapad |
| CUS-02 | Kundregister | Tomt kundnamn nekas med begripligt besked, inget sparas | Godkänd | 2158 ms |  |
| CUS-03 | Kundregister | Redigera kund (telefon) sparas på servern | Godkänd | 2485 ms |  |
| CON-01 | Kontaktpersoner | Kontaktperson på fastighet läggs till och sparas på servern | Godkänd | 2406 ms |  |
| PROP-01 | Fastighetsregister | Ny fastighet utan objects_sensitive (egen roll chef − objects_sensitive, SEC-CUST-03): portkodsfält visas inte, ingen portkod i registret | Godkänd | 1542 ms |  |
| PROP-02 | Fastighetsregister | Portkod vid ny fastighet (admin) sparas skyddat — aldrig i delade registret; fältarbetare kan inte läsa den | Godkänd | 2493 ms |  |
| PROP-03 | Fastighetsregister | Fastighetskortets alla flikar öppnas utan fel | Godkänd | 2895 ms |  |
| OBJ-01 | Objekt och lägenheter | Lägg till objekt på fastighet och öppna objektkortet | Godkänd | 2775 ms | objektformulär: new-obj-type, new-obj-num, new-obj-name, new-obj-entrance, new-obj-stairwell, new-obj-floor, new-obj-area, new-obj-status, new-obj-access |
| STAFF-01 | Personalregister | Ny personal via formulär sparas; listan visar personen | Godkänd | 2533 ms |  |
| ROLE-01 | Användarroller och behörigheter | Menyn visar bara sidor rollen får se; direktnavigering till otillåten sida nekas | Godkänd | 8645 ms |  |
| ART-01 | Prisgrupper och artiklar | Ny artikel och ny prisgrupp sparas; utan article_manage nekar servern direktskrivning | Godkänd | 5077 ms | serverkontrollen är modellerad — måste upprepas mot riktig STAGING |
| AO-01 | Arbetsordrar | Ny AO via guiden (3 steg) skapas på servern via ao-time-write och får AO-nummer | Godkänd | 2074 ms | besked: AO-(sparas…) skapad |
| AO-02 | Arbetsordrar | Dubbelklick på "Skapa order" ger exakt en AO | Godkänd | 4031 ms |  |
| LOG-01 | Arbetsorderloggar | Loggpost (fältarbetare på egen AO): "Sparar…" och sedan "sparad" först efter serverns ACK | Godkänd | 2696 ms |  |
| LOG-02 | Arbetsorderloggar | Servern nekar loggpost: aldrig "sparad", posten försvinner och fel visas | Godkänd | 1644 ms |  |
| LOG-03 | Arbetsorderloggar | Avbrott mitt i sparning: ingen bekräftelse; efter återanslutning skickas posten exakt en gång | Godkänd | 3268 ms |  |
| LOG-04 | Arbetsorderloggar | Servern svarar inte (timeout): "sparad" visas aldrig före serverns bekräftelse; exakt en post | Godkänd | 4291 ms |  |
| LOG-05 | Arbetsorderloggar | Osäkert utfall (servern sparade, svaret tappades): "sparad" först efter bekräftelse, ingen dubblett vid återförsök | Godkänd | 3056 ms |  |
| CHK-01 | Arbetsorderchecklistor | Admin lägger till kontrollpunkt; fältarbetare bockar av — båda på servern | Godkänd | 5699 ms |  |
| MAT-01 | Materialregistrering | Material läggs till på AO med antal (fält: okänt pris) och med pris och moms (arbetsledare); servern får raderna | Godkänd | 6265 ms |  |
| AO-03 | Arbetsordrar | Starta arbete ändrar status på servern | Godkänd | 2755 ms |  |
| AO-04 | Arbetsordrar | Arkivera med bekräftelse → servern arkiverad; besked först efter ACK; återställ fungerar | Godkänd | 1637 ms |  |
| AO-05 | Arbetsordrar | Arkivering som servern nekar: AO:n återställs lokalt, inget "arkiverad" | Godkänd | 1722 ms |  |
| AO-06 | Arbetsordrar | Två användare redigerar samma AO samtidigt (olika fält): båda ändringarna finns kvar på servern | Godkänd | 3215 ms |  |
| AO-07 | Arbetsordrar | Samtidiga loggposter från två enheter på samma AO (känt gap G5) | Godkänd | 4979 ms | A kvar: true, B kvar: true; Känt fel G5 reproduceras inte längre — kontrollera och stäng |
| AO-07B | Arbetsorderloggar | G5 med serverstöd (append_log): samtidiga loggposter från två enheter bevaras båda; borttagning tar bara bort sin post; ingen hel-array-patch | Godkänd | 3693 ms |  |
| AO-07C | Arbetsorderloggar | Två enheter sparar loggpost under samma millisekund: båda posterna får egna id och finns kvar på servern (tidigare samma id → den ena tappades tyst trots "sparad") | Godkänd | 3103 ms | id: LOG-1795000000000-03c5eafd, LOG-1795000000000-6b5675ac |
| AO-09 | Arbetsordrar | En AO-ändring = en serverskrivning (ingen extra geokodnings-patch när adressen inte kan geokodas) | Godkänd | 3400 ms |  |
| IMG-01 | Bilder och dokument | Foto i AO-logg laddas upp via EF (bara imagePath i AO), visas via signerad URL | Godkänd | 2308 ms |  |
| IMG-02 | Bilder och dokument | Fil som inte är en bild nekas av servern; loggposten sparas inte | Godkänd | 1690 ms |  |
| IMG-03 | Bilder och dokument | Radera loggpost med foto: filen raderas först efter serverbekräftad radering | Godkänd | 2961 ms |  |
| AO-08 | Användarroller och behörigheter | Begränsad användare: servern levererar bara egna AO (ingen öppen pool, D-04); direkt patch av annan AO → 403 | Godkänd | 820 ms |  |
| TIME-01 | Tidregistrering och instämpling | Flöde: fältarbetare stämplar in/ut på AO → serverbekräftad tidpost → löneadmin ser och attesterar → posten låst | Godkänd | 2837 ms |  |
| TIME-02 | Tidregistrering och instämpling | Stämpla in på mobil → datorn visar instämplad vid flikfokus; stämpla ut på datorn → mobilen visar utstämplad | Godkänd | 2552 ms |  |
| TIME-03 | Tidregistrering och instämpling | Dubbel utstämpling av samma pass från två enheter → exakt en tidpost | Godkänd | 4961 ms |  |
| TIME-04 | Tidregistrering och instämpling | Manuell tid på Tid-sidan: "Sparar tiden…" → "Tid sparad" efter ACK; nekad → borttagen och tydligt fel | Godkänd | 2416 ms |  |
| TIME-07 | Tidregistrering och instämpling | Manuell tid med arbetsorder men utan vald kund: kunden fylls i från AO:n och tidposten får kunden på servern (tidigare tom kund → föll bort ur kundrapporter) | Godkänd | 1287 ms |  |
| TIME-05 | Tidregistrering och instämpling | Användarbyte med osynkad utstämpling: tidposten tappas inte och skickas inte i fel användares namn | Godkänd | 8927 ms |  |
| TIME-06 | Tidregistrering och instämpling | Löneskydd: fältarbetare får bara egna tidposter, även vid direktanrop | Godkänd | 927 ms |  |
| MYJOBS-01 | Mina jobb | Mina jobb visar egna tilldelade AO; "Starta" startar jobbet på servern | Godkänd | 2759 ms |  |
| TIME-08 | Tidregistrering och instämpling | Stämpling på annan enhet: Tid & stämpla (pg-tid) ritas om och visar "Instämplad" efter synk | Godkänd | 4319 ms |  |
| FLOW-01 | Offertmodulen | Arbetsflöde kund → fakturaunderlag: samma belopp i offertguide, kundlänk, AO, fakturakö och fakturautkast | Godkänd | 17823 ms | offertguide: 3952 / 988 / 4940 kr; OfferCalc: 3952 / 988 / 4940; AO prismodell fast, fast pris 3952; underlag: [{"id":"fixed:AO-1280fb7f-dd24-4d82-a693-0cdefd718fa2","type":"fixed","amount":3952,"sel":true,"issues":[]}]; |
| OFF-03 | Offertmodulen | Rabatt i offertguiden: kontrollen visas när första engångsraden läggs till; 10 % rabatt ger samma belopp i guide, OfferCalc, PDF och kundlänk | Godkänd | 3512 ms | guide 1890 / 473 / 2363; OfferCalc 2100 − 210 = 1890, moms 473, totalt 2363 |
| OFF-04 | Digitala offertlänkar och kundsvar | Generera och återkalla kundlänk; serverfel vid återkallning ger inget "återkallad"-besked medan länken fortfarande fungerar | Godkänd | 10720 ms | toasts vid serverfel: Sparar… / Länken är INTE återkallad — servern bekräftade inte ändringen och kunden kan fortfarande öppna den — ändringen ligger kvar som osparad; välj Återuppta eller Kasta i meddelandet överst. |
| OFF-01 | Digitala offertlänkar och kundsvar | Kundlänk: ogiltig/återkallad/redan besvarad ger begripligt besked; dubbelt godkännande nekas | Godkänd | 935 ms |  |
| INV-01 | Fakturering och fakturaunderlag | Fakturautkast: rad, rabatt och ROT större än totalen; servern nekar ändring av skickad faktura | Godkänd | 1190 ms |  |
| INV-02 | Fakturering och fakturaunderlag | Utan invoice_create: knappar dolda och servern nekar direktanrop | Godkänd | 792 ms |  |
| OFF-02 | Offertmodulen | Offert-PDF (genereras i webbläsaren) visar samma totalsumma som OfferCalc för samtliga befintliga offerter | Godkänd | 9174 ms | 5 offerter kontrollerade |
| ECO-01 | Fakturering och fakturaunderlag | Löpande AO: 80 min à 595 kr + material 3 × 33,33 kr → fakturakö → fakturautkast → ROT; öresavrundning och ROT på arbete inkl. moms (samma regel som offerten) | Godkänd | 10945 ms | underlag: [{"id":"time:TID-fd08c672-f5f0-460c-b2b5-1786099881bf","type":"time","q":1.33,"p":595,"a":791.35,"sel":true,"issues":[]},{"id":"material:AO-8de60333-6956-4209-b81f-4ac0f11d9d4b:M-24c2427603997e86","type":"mater |
| SVC-01 | Serviceintervall | Flöde: skapa intervall → förfallodatum → Att göra vid uppstart → markera utförd med AO och kommentar → historik, uppgift stängd | Godkänd | 11758 ms |  |
| SVC-02 | Serviceintervall | Serverfel vid "Markera utförd" ger inget definitivt "utfört"-besked och ingen tyst förlust | Godkänd | 6794 ms | toasts: Sparar… / Utförandet kunde inte sparas — den ligger kvar som osparad; välj Återuppta eller Kasta i meddelandet överst. |
| SVC-03 | Serviceintervall | Översikten: filter, sök och paus/återuppta sparas på servern; fältarbetare utan customer_manage nekas sidan | Godkänd | 6197 ms |  |
| ROLE-02 | Användarroller och behörigheter | Ändra rolls behörighet: serverfel → inget "Roll uppdaterad", behörigheten oförändrad; lyckad ändring slår igenom för rollens användare | Godkänd | 5332 ms | toasts: Sparar… / Rollen "Personal" kunde inte sparas — behörigheterna är OFÖRÄNDRADE — den ligger kvar som osparad; välj Återuppta eller Kasta i meddelandet överst. |
| STAFF-02 | Personalregister | Byta roll på en person: serverfel → inget "Sparat"; lyckat byte sparas på servern | Godkänd | 4748 ms | toasts: Sparar… / Ändringen för Sofia Lindgren kunde inte sparas — den ligger kvar som osparad; välj Återuppta eller Kasta i meddelandet överst. |
| ADMIN-01 | Inställningar och administration | Admin-flikarna öppnas utan fel; fältarbetare nekas Admin; äldre sparväg utan bekräftelse ger varning vid serverfel | Godkänd | 6825 ms | toasts: Sparat / Varning: servern bekräftade inte den senaste ändringen (artiklar). Den kan vara osparad — kontrollera och försök igen. |
| RON-01 | Rondering | Flöde: skapa rondering i guiden → tillfälle → utför på mobil (OK, anmärkning med AO, ej aktuell) → slutför → rapport → AO klar → avvikelse åtgärdad | Godkänd | 11934 ms |  |
| RON-02 | Avvikelser | Fältarbetare utan ao_view_all nekas rondering i UI och vid direktanrop; serverfel vid punkt ger tydligt fel och ingen lokal ändring | Godkänd | 4061 ms |  |
| RON-03 | Rondering | Serverfel när ronderingen sparas: inget "Rondering skapad", inga tillfällen skapas för en rondering servern saknar | Godkänd | 5184 ms | toasts: Sparar… / Varning: servern bekräftade inte den senaste ändringen (ronderingar). Den kan vara osparad — kontrollera och försök igen. / Ronderingen kunde inte skapas — den ligger kvar som osparad; välj Återuppta el |
| REC-01 | Återkommande AO | Skapa återkommande ärende (fastighet, checklista, personal) → "Skapa AO nu" → AO på servern med checklista; schemat flyttas fram först efter serverns bekräftelse; dubbelt klick ger en AO | Godkänd | 8628 ms | AO för tillfället: AO-4f03daca-cbeb-4a9a-8b00-43437f802319 2026-11-26 |
| SALES-01 | Säljchanser | Skapa säljchans → skapa offert från den → kopplad först när offerten sparats → markera vunnen; serverfel ger varning | Godkänd | 6812 ms | toasts: Sparar… / Ändringen kunde inte sparas — den ligger kvar som osparad; välj Återuppta eller Kasta i meddelandet överst. |
| PROJ-01 | Projekt | Skapa projekt → koppla befintlig AO → projektets AO-flik visar den; AO:n bär projectId på servern; arkivera/återställ | Godkänd | 6318 ms |  |
| TASK-01 | Att göra | Skapa uppgift åt fältarbetare → fältarbetaren ser och klarmarkerar den på mobilen → servern; fältarbetaren kan inte ta bort andras uppgift | Godkänd | 8453 ms | serverns per-nyckel-behörighet för activities kan inte verifieras i simulerad backend (G4) — upprepa mot STAGING |
| CAL-01 | Kalender | Kalender: dra AO till annan dag (dator) och flytta via långtryck-dialog (mobil) → servern; vyer dag/vecka/månad/agenda öppnas | Godkänd | 6966 ms |  |
| IMP-01 | Import och export | Flöde: importera 3 syntetiska kunder (1 dubblett) → dubbletten uppdateras → serverkontroll → ångra import → servern återställd | Godkänd | 6440 ms |  |
| IMP-02 | Import och export | Import när servern nekar: inget "Import slutförd" utan förbehåll; ogiltig fil ger begripligt fel | Godkänd | 7074 ms | toasts: Varning: servern bekräftade inte den senaste ändringen (kunder, importloggar). Den kan vara osparad — kontrollera och försök igen. |
| EXP-01 | Import och export | Export av fastigheter och objekt innehåller aldrig portkod/nyckelinformation; kunder exporteras som CSV | Godkänd | 4540 ms | property: ﻿Namn;Fastighetsbeteckning;Adress;Postnummer;Ort;Objektnummer;Fastighetstyp;Byggnadsår;Antal lägenheter;Total yta (m²);Förvaltningsform;Driftområde;Status;Antec; propertyObject: ﻿Namn;Objektnummer;Typ (lagenhet |
| IMP-03 | Import och export | AO-import när ett AO med UUID-id finns: varje importerad AO får ett eget, giltigt id (inga dubbletter) | Godkänd | 3842 ms | skapade: AO-2020c1a4-1ca1-48fd-9721-02a59e7638cf, AO-39ddf608-777f-4510-903e-1ddd9a40844f, AO-9cf8c0be-919e-4bcc-9c09-40823b98890a |
| REP-01 | Rapporter och statistik | Ekonomirapporten: "Fakturerat" = summan av utställda fakturor exkl. moms (samma beräkning som fakturavyn); tidrapporten kopplar tid till AO | Godkänd | 4082 ms | förväntat fakturerat (exkl. moms): 17975 |
| DASH-01 | Dashboard | Dashboard per roll: widgets laddar utan fel; klick på AO-räknare leder till filtrerad AO-lista; fältarbetaren ser inga ekonomisiffror | Godkänd | 7426 ms |  |
| NOTIF-01 | Push och notifieringsgränssnitt | Notiser: in-app-notis visas i notislistan, kan markeras läst; push-prenumeration registreras utan att något skickas på riktigt | Godkänd | 2929 ms | simulerade push-utskick: 0 (inga riktiga utskick — send-push registreras bara) |
| RES-01 | Robusthet | Mobilen tappar nätet: loggpost köas; när nätet kommer tillbaka skickas den automatiskt (utan omladdning) exakt en gång | Godkänd | 3469 ms |  |
| RES-02 | Robusthet | Omladdning mitt i sparning (AO-logg och kundändring): båda hamnar på servern exakt en gång efter omladdning | Godkänd | 5449 ms |  |
| RES-03 | Robusthet | Servern svarar inte på kundändring (timeout): inget "uppdaterad", tydligt besked inom rimlig tid | Godkänd | 10550 ms | besked efter 9290 ms: Kunde inte spara kunden. Ändringen ligger kvar som osparad — välj Återuppta eller Kasta i meddelandet överst. |
| RES-04 | Robusthet | Utloggning med osparad kundändring: nästa användare skickar den inte i sitt namn; när ägaren loggar in igen skickas den | Godkänd | 8448 ms |  |
| SW-01 | Robusthet | Service Worker: ny driftsättning (ny ?v=) hämtas vid omladdning — ingen gammal cachad fil; offline-start visar appen från cache | Godkänd | 1355 ms | offline-start: {"hasLogin":true,"hasApp":true,"router":true} |
| PERM-01 | Användarroller och behörigheter | Fältarbetare: direktanrop mot annans AO, faktura, roller, portkod och andras tid nekas av servern | Godkänd | 820 ms |  |
| PERM-02 | Användarroller och behörigheter | Arbetsledare (utan lön/portkod) och begränsad AO-användare: servern nekar det rollen saknar | Godkänd | 3326 ms |  |
| PERM-03 | Användarroller och behörigheter | Generiska nycklar (kunder, offerter, säljchanser, inställningar, att göra) per roll vid direktanrop mot store-key-write: serverns KEY_PERMISSIONS, exakt felkod och oförändrad data | Godkänd | 2386 ms | fält: {"offers_price":{"status":403,"error":"forbidden"},"customers":{"status":403,"error":"forbidden"},"activities_other":{"status":403,"error":"forbidden","reason":"not_own"},"salesOpps":{"status":403,"error":"forbidde |
| PERM-04 | Användarroller och behörigheter | Sidåtkomst per roll (6 roller × alla sidor): otillåten sida nekas med besked, tillåten sida öppnas utan fel | Godkänd | 15030 ms | admin: 26 tillåtna, 0 nekade; chef: 21 tillåtna, 5 nekade; falt: 6 tillåtna, 20 nekade; ekonomi: 12 tillåtna, 14 nekade; begransad: 5 tillåtna, 21 nekade; falt2: 6 tillåtna, 20 nekade |
| PERF-01 | Prestanda | Stor datamängd (2 000 kunder, 3 000 fastigheter, 3 000 AO, 20 000 tidposter): inloggning, AO-lista, AO-detalj, kundsökning, sparning — uppmätta tider och anrop | Godkänd | 39612 ms | observation: pollningen var pausad så länge sökfältet hade fokus; mätvärden: {"inloggning_till_klar_ms":917,"anrop_vid_start":5,"ao_lista_ms":206,"ao_rader":151,"ao_detalj_ms":34,"kundlista_ms":775,"dashboard_ms":147,"ra |
| MODAL-01 | Inställningar och administration | Dialoger som använder okLabel/ok har en Spara-knapp: nytt avtal och ny e-postmall kan skapas och sparas på servern | Godkänd | 3935 ms |  |
| ATT-01 | Offertmodulen | Redigera offertbilaga: med serverstöd sparas "synlig i kundvy" på servern; utan (driftsatt EF i dag) tydligt fel och ingen lokal ändring | Godkänd | 2575 ms |  |
| G12-01 | Kundregister | G12: sparvägar som tidigare sa "Sparat" före serverns svar — vid serverfel inget framgångsbesked och lokal återställning; när servern svarar sparas ändringen | Godkänd | 21648 ms |  |
| ATT-02 | Offertmodulen | Ta bort offertbilaga: Bekräfta tar faktiskt bort bilagan på servern (await Modal.confirm gav tidigare undefined) | Godkänd | 2780 ms |  |
| G10-01 | Fakturering och fakturaunderlag | G10: godkänd offert med ROT → AO → fakturautkast: varning, "skickad" spärras tills avdraget lagts in (förifyllt från offerten) eller "utan avdrag" bekräftats | Godkänd | 5947 ms |  |
| G8-01 | Offertmodulen | G8: RUT-avdrag större än totalen (efter rabatt) — offerten kan inte sparas; kundsidan visar inget negativt belopp och tillåter inte godkännande | Godkänd | 4919 ms |  |
| MAP-01 | Dashboard | Karta: två AO på Vasaplatsen 8 → en markör med "2", popup listar båda med status och Akut; olika adress med samma koordinat grupperas inte ihop; räknaren skiljer jobb/platser/ej placerade | Godkänd | 1982 ms | räknare: 13 aktiva jobb · 2 platser på kartan · 10 saknar koordinater |
| CAL-02 | Kalender | Kalender (veckovy): överlappande arbetsordrar ritas sida vid sida — ingen döljer den andra | Godkänd | 1634 ms | händelser: 4 |
| UI-KV-01 | Designstandard | Etikett/värde (kv): på dator står värdet nära etiketten; på mobil står etikett och värde kvar på samma rad (staplade rader gjorde säljkorten ~20 % högre) | Godkänd | 3138 ms |  |
| UI-PROP-01 | Designstandard | Fastighetskortets huvud: namnet är rubrik och kapas inte på dator eller mobil, numret syns, och namnet upprepas inte i sidan | Godkänd | 3004 ms | laptop: {"text":"Solgläntan Hus A","name":"Solgläntan Hus A","num":"OBJ-001","sub":"OBJ-001\n·\nFlerbostadshus","clipped":false,"nameCount":1}; iphone: {"text":"Solgläntan Hus A","name":"Solgläntan Hus A","num":"OBJ-001" |
| UI-BDG-01 | Designstandard | AO-listan: "Redo fakturering" är ett ljust statusmärke som övriga, inte ett fyllt marinblått filterchip | Godkänd | 3324 ms | laptop: {"cls":"bdg bdg-blue ao-ready-inv","lum":240}; iphone: {"cls":"bdg bdg-blue ao-ready-inv","lum":240} |
| CHK-02 | Arbetsorderchecklistor | Påbörja → "Sparar…" tills servern svarat → Pågår med vem/när; AO:ns status oförändrad; Utförd registrerar vem/när | Godkänd | 2856 ms | badge: 
        2 av 4 klara2 kvar
        
          
        
        2 utförda2 ej påbörjade
       |
| CHK-03 | Arbetsorderchecklistor | Två användare/enheter: flera punkter pågående samtidigt, inget skrivs över; synkas till den andra enheten; indikatorn skiljer pågående från utförda | Godkänd | 3942 ms | badge A: 
        1 av 4 klara3 kvar
        
          
        
        1 utförd2 pågår1 ej påbörjad
       |
| CHK-04 | Arbetsorderchecklistor | Återställ: egen åtgärd med ao_checklist; annans och äldre punkt kräver ao_edit — nekas på servern även vid direktanrop | Godkänd | 3720 ms |  |
| CHK-05 | Arbetsorderchecklistor | Serverfel/timeout: aldrig "Pågår"/"Utförd" utan ACK; tydligt fel; raden tillbaka | Godkänd | 2340 ms | efter synk: utford (servern: utförd) |
| CHK-06 | Arbetsorderchecklistor | Äldre server (före migrationen): ingen Påbörja-knapp, befintlig OK/avvikelse fungerar som förut, inget tolkas som "återställ" | Godkänd | 2097 ms |  |
| CHK-07 | Arbetsorderchecklistor | Mobil: kompakt checklista — knappar under texten, tryckyta ≥ 36 px, ingen horisontell scroll; dator: knappar till höger | Godkänd | 2345 ms | iphone: {"scroll":false,"minBtn":36,"below":true,"right":false,"states":"ej_paborjad,pagaende,utford,avvikelse"}; laptop: {"scroll":false,"minBtn":24,"below":false,"right":true,"states":"ej_paborjad,pagaende,utford,avvik |
| SYNC-AO-01 | Arbetsorderchecklistor | Synk mellan enheter: en annan enhets AO-ändring syns utan ny åtgärd även när AO-hämtningen blir klar efter omritningen | Godkänd | 2490 ms |  |
| STG-01 | Sparning och synk | STAGING-regler: fältarbetarens aktivitetsloggpost nekas av servern (admin_manage) — ingen återkommande falsk varning; en nekad ändring av användarens egna data varnar fortfarande | Godkänd | 22415 ms | aktivitetslogg-skrivningar nekade av servern: 3; toasts: ["","",""] |
| TASK-02 | Att göra | TASK-01-rättningen (per-post-regel): fältarbetaren klarmarkerar sin tilldelade uppgift mot STAGING-regler; direktanrop mot annans uppgift, förfalskad ny uppgift åt annan och radering av annans uppgift nekas av servern | Godkänd | 3223 ms | direktanrop: {"complete_other":403,"forge_new":403,"delete_other":403,"full_write":403} |
| ACT-01 | Aktivitetslogg | Klientrapporterat aktivitetsflöde: fältarbetarens händelser sparas en och en (appendActivity), servern verifierar bara användare och tid (source=klientrapport); hela listan skickas aldrig; generisk skrivning av loggen nekas (append-only) | Godkänd | 5084 ms | poster: [["time_entry_created","ST-004","klientrapport"],["work_order_updated","ST-004","klientrapport"]] |
| AO-07D | Arbetsorderloggar | work-order-log-write: servern stämplar staffId; annans loggpost kan inte tas bort utan ao_edit (direktanrop); egen kan; ingen hel-array-patch | Godkänd | 2087 ms |  |
| QBAR-01 | Arbetsorder (mobil) | Snabbåtgärdsraden täcker aldrig innehåll: ovanför bottenmenyn, fritt vid sidans slut, under dialoger, dold när ett fält har fokus; finns inte på dator | Godkänd | 8509 ms |  |
| ECO-V3-01 | Ekonomi (V3) | Offertdetalj utan upprepning av kund/status/belopp; fakturaunderlagets statusväljare får plats på mobil och tillbakaknappen syns | Godkänd | 8736 ms |  |
| ECO-V3-02 | Ekonomi (V3) | Fakturakön: samma urvalslogik för kund/fastighet/AO/rad som förut; delvis markerade grupper visas; varje AO samlar sina rader | Godkänd | 3550 ms |  |
| DASH-M-01 | Dashboard (mobil) | Mobildashboard: Kräver åtgärd direkt efter nyckeltalen, personal högt upp, långa listor med Visa fler, kartan bakom Visa karta — inget försvinner | Godkänd | 3506 ms |  |
| XSS-01 | Säkerhet | Lagrad XSS: inget skript körs när fritextfält innehåller HTML — alla sidor och detaljsidor för admin, arbetsledare (falt2 som fält), ekonomi | Godkänd | 33477 ms | admin: 48 sidvisningar; falt: 16 sidvisningar; ekonomi: 30 sidvisningar |
| VAT-01 | Offerter | Momsspärr offert→AO: 25 % konverteras med rätt fastpris; 12 %, 0 % och blandad moms nekas med förklaring och skapar ingen AO | Godkänd | 7564 ms | OFF-VAT25: AO skapad; OFF-VAT12: nekad med förklaring; OFF-VAT0: nekad med förklaring; OFF-VATMIX: nekad med förklaring |
| RENDER-01 | Säkerhet | Ingen betrodd markup visas som text efter XSS-escaping: alla sidor, admin-flikar, detaljsidor och vanliga dialoger (admin) | Godkänd | 45280 ms | admin: 49 sidvisningar |
| RENDER-01-CHEF | Säkerhet | Ingen betrodd markup visas som text efter XSS-escaping: alla sidor, admin-flikar, detaljsidor och vanliga dialoger (arbetsledare) | Godkänd | 39319 ms | chef: 44 sidvisningar |
| RENDER-01-EKONOMI | Säkerhet | Ingen betrodd markup visas som text efter XSS-escaping: alla sidor, admin-flikar, detaljsidor och vanliga dialoger (ekonomi) | Godkänd | 25294 ms | ekonomi: 31 sidvisningar |
| RENDER-01-FALT | Säkerhet | Ingen betrodd markup visas som text efter XSS-escaping: alla sidor, admin-flikar, detaljsidor och vanliga dialoger (fält) | Godkänd | 13682 ms | falt: 16 sidvisningar |
| BRAND-01 | Administration | Färgväljaren: drag (input) skriver inget till servern, valt värde (change) sparas exakt en gång, oförändrat värde sparas inte | Godkänd | 4665 ms | skrivningar: drag 0, efter change 1, efter oförändrad change 1; förhandsvisning #aabbcc; sparat #aabbcc |
| DASH-E-01 | Dashboard | Anpassa: separat läge med sticky verktygsrad (Spara primär, Avbryt, Återställ standard), Flytta-handtag, storlek Liten/Halv/Hel, Dölj och Dolda widgets; inget sparas under redigering; Avbryt återställer exakt | Godkänd | 3314 ms |  |
| DASH-E-02 | Dashboard | Dra och släpp (dator) med släppmarkering + "lägg sist"; storleksändring; Spara → samma layout efter omladdning | Godkänd | 5891 ms |  |
| DASH-E-03 | Dashboard | Dölj och visa dold widget; Återställ standard frågar först, ändrar bara utkastet och sparas vid Spara (rollstandard med sektionsrubriker tillbaka) | Godkänd | 4221 ms |  |
| DASH-E-04 | Dashboard | Personlig layout per användare och enhet: admins layout påverkar inte arbetsledarens (samma webbläsare); ny enhet = standard; ett osparat utkast följer aldrig med till nästa användare | Godkänd | 7711 ms |  |
| DASH-E-05 | Dashboard | Bakåtkompatibilitet: äldre sparad layout (v1 med size-strängar, okänd widget) visas; ¾-bredd behålls som "Bred" och bevaras vid Spara; v1-nyckeln skrivs aldrig över | Godkänd | 3901 ms |  |
| DASH-E-06 | Dashboard (mobil) | Mobil 390: Flytta upp/Flytta ned med tryck (inget dra-handtag, inget storleksval), tryckytor ≥ 40 px, inget sidledes överspill; sparas | Godkänd | 3187 ms |  |
| DASH-E-07 | Dashboard | Inget sidledes överspill eller knappar utanför skärmen: dashboard, Anpassa-läget och listan "jobb utan plats" vid 360/390/768/1024/1366/1920 | Godkänd | 16444 ms |  |
| DASH-E-08 | Dashboard | Kartan — kartfel skiljs från geokodning och adress: Mapbox GL blockerat → "Kartan kunde inte laddas" med alla tal; GL laddat men geokodningen svarar 403 → "geokodning misslyckades" + admintext om kartnyckeln; kartbakgrunden nekas → rad ovanpå kartan, markörer kvar | Godkänd | 6300 ms | A (GL blockerat): 10 aktiva jobb · 0 med koordinater · 10 saknar koordinater / Kartan kunde inte laddas Kartbiblioteket (Mapbox GL) gick inte att nå. Det beror inte på jobbens adresser — listan fungerar som vanligt. 0 av |
| DASH-E-10 | Dashboard | Kartan — geokodningen svarar med träffar: över 20 jobb utan koordinater → högst 20 sökningar per visning, resten "inte geokodade ännu"; adress som inte hittas, adress utan ort och jobb utan adress redovisas var för sig; koordinater som text placeras | Godkänd | 2536 ms | status: {"nocity":7,"notfound":1,"geocoded":40,"skipped":5,"noaddr":1,"coords":1} sökningar: 40 / 55 aktiva jobb · 40 platser på kartan · 14 saknar koordinater / 14 av 55 aktiva jobb visas inte på kartan Geokodning sakna |
| DASH-E-09 | Dashboard | Widgetar: Försenade aktiviteter visar de äldsta med dagar sen och leder till listan; Arbetspool sorterar akut först och visar väntetid; Kräver åtgärd utan dubblerad rubrik, raderna är knappar | Godkänd | 3449 ms |  |
| DASH-E-11 | Dashboard | Realistiskt innehåll (V3-standard §12): 40 försenade aktiviteter, 30 jobb i poolen, 150 aktiva jobb och långa titlar → korten visar de viktigaste först och "Visa …", titlar kortas av, inget sidledes överspill vid 390/1366; tomlägen utan NaN/undefined | Godkänd | 6155 ms | d25_390: {"odRows":3,"odCount":"40","odH":274,"odGo":true,"poolVis":3,"poolFirst":"Akut","poolMore":true,"poolCount":"33 väntar","mapRows":25,"mapMore":"Visa alla 190 aktiva jobb ","wrapped":0,"truncated":7,"bad":false}; |
| AOL-01 | Arbetsordrar | Begränsad lista: antal i rubrik och sidfot ("Visar 150 av 800"), Visa 300 till och Visa alla når varje AO; Välj alla gäller de som visas, Markera alla N som matchar gäller hela urvalet | Godkänd | 5060 ms |  |
| AOL-02 | Arbetsordrar | Filterhierarki: Status och Snabbval är skilda kontroller; status + snabbval + sökning ger rätt antal, varje filter kan tas bort i sammanfattningen och Rensa filter återställer allt | Godkänd | 4186 ms |  |
| AOL-03 | Arbetsordrar | Massändring: markerade som filtret döljer ingår aldrig — bulk-baren och dialogerna räknar upp dem, bekräftelsen säger exakt hur många som ändras och servern får bara de synliga | Godkänd | 9192 ms |  |
| AOL-04 | Arbetsordrar | Sortering: kolumnrubrikerna sorterar och vänder ordningen med synlig pil och aria-sort; sorteringsväljaren följer med; utan datum hamnar sist i båda riktningarna | Godkänd | 3371 ms |  |
| AOL-05 | Arbetsordrar | Dubblerade AO-nummer: två olika AO med samma synliga nummer (som AO-001 i STAGING) skiljs åt med kort id i lista, kort och mobil — inget lagrat nummer ändras | Godkänd | 4079 ms |  |
| AOL-06 | Arbetsordrar | Prestanda 10/100/1000 AO: första rendering, statusbyte, snabbval, sökning (med väntan på paus i skrivandet) och Visa alla — budget vid 1000: rendering < 1500 ms, sökning < 300 ms | Godkänd | 4346 ms | mätvärden (ms, lokal headless Chromium, simulerad server): {"10":{"rendering_ms":21,"rader":9,"statusbyte_ms":7,"statusbyte_tillbaka_ms":12,"snabbval_ms":13,"snabbval_av_ms":24,"sokning_ms":139,"sokning_renderingar":1,"s |
| AOL-07 | Arbetsordrar | Layout 360–1920: ingen sidledsrullning i lista, kortvy, med filter och i markeringsläge; vy-växlaren syns överallt; avatarer överlappar inte (F-22); mobilens kryssrutor ≥ 40 px | Godkänd | 33911 ms |  |
| AOL-08 | Arbetsordrar | Snabb öppning från listan: klick och Enter öppnar AO-detaljen direkt; mellanslag markerar raden; Tillbaka ger samma filter och sökning | Godkänd | 2664 ms |  |
| AOL-09 | Arbetsordrar | Mobil 390/360 med 100 realistiska AO: hitta sitt jobb (Mina + sök), filtrera (statusväljare + snabbval), öppna AO, massval och massändring — inget klipps och inget hamnar utanför skärmen | Godkänd | 13033 ms |  |
| AOD-01 | Arbetsordrar | AO-detalj: EN primär åtgärd per status och roll (planerad → Starta arbete, pågående → Klarmarkera, klar → Skapa fakturaunderlag) med befintlig funktion och behörighet; Starta arbete skapar ingen tidpost | Godkänd | 11705 ms |  |
| AOD-02 | Arbetsordrar | AO-detalj: ingen förlorad åtgärd — varje åtgärd i den tidigare raden (samma etikett och anrop) nås i nya raden eller menyn, på dator och mobil, i alla lägen (nytt, pool, planerad, pågående+substatus, klar, klar+faktura, avbruten, arkiverad, papperskorg) och roller | Godkänd | 23858 ms | 155 tidigare åtgärder kontrollerade |
| AOD-03 | Arbetsorderchecklistor | AO-detalj: checklistan ligger i Uppdrag & utförande (aldrig hopfälld) med "N av M klara", stapel, kvar och avvikelser; tre lägen och återställningsregler fungerar som förut | Godkänd | 2394 ms |  |
| AOD-04 | Tidregistrering och instämpling | AO-detalj: Starta arbete (status) och Stämpla in (tid) är skilda; stämpling via den kompakta raden ger levande tidräknare och exakt EN tidpost; ingen dubbelstämpling på annan AO | Godkänd | 7513 ms |  |
| AOD-05 | Användarroller och behörigheter | AO-detalj: prissättningskortet syns för admin/arbetsledare/ekonomi med rätt modell (fastpris / löpande timpris + prisgrupp och timpris) och placering; fält och begränsad ser inget pris, inköp eller påslag | Godkänd | 10831 ms |  |
| AOD-06 | Arbetsordrar | AO-detalj: ingen horisontell överbredd eller knapp utanför skärmen 360–1920 px (admin, arbetsledare med substatus, fält), menyn ryms i fönstret | Godkänd | 29770 ms |  |
| AOD-07 | Arbetsordrar | AO-detalj med realistiskt innehåll, mobil 390 px: alla statusar (ny, planerad, pågår, pausad, klar, fakturerad, avbruten) + saknade fält × fält, arbetsledare, ekonomi, admin — rätt primär åtgärd, 22 checkpunkter, material, tid, bilder, pris per roll, inget klipps | Godkänd | 22105 ms | iphone: 4 roller × 8 ordrar granskade |
| AOD-08 | Arbetsordrar | AO-detalj med realistiskt innehåll, dator 1366 px: alla statusar + saknade fält × fält, arbetsledare, ekonomi, admin (samma kontroller som AOD-07) | Godkänd | 22112 ms | laptop: 4 roller × 8 ordrar granskade |
| AOD-09 | Arbetsordrar | Fältflöde på mobil 390 px utan att något klipps: öppna jobbet från Mina jobb → Starta arbete → Stämpla in → bocka av checklista → lägg till material och bild → Stämpla ut → Klarmarkera (ao_complete_own, D-03; utan den ingen Klarmarkera) | Godkänd | 7835 ms |  |
| BILL-01 | Fakturering och fakturaunderlag | Fakturakön (kompakt): kundgruppernas antal och belopp = BillingQueueService; Tid+Material+Fastpris = totalen; filtrerad summa märkt och skild från köns total | Godkänd | 2481 ms | kö: 19 kandidater, 2 kräver åtgärd, total 61937.5 kr exkl. moms |
| BILL-02 | Fakturering och fakturaunderlag | Fakturakön: kryssruta med tre lägen och "x av y valda"; Välj alla gäller uttryckligen de N som matchar filtret; valda som döljs av filtret sägs ut och kan avmarkeras; tangentbord fäller ut | Godkänd | 4869 ms |  |
| BILL-03 | Fakturering och fakturaunderlag | Kräver åtgärd: ett klick filtrerar; exakt de ej valbara kandidaterna med orsak och förklaring; direkta åtgärder följer behörighet (admin: Ändra materialpris öppnar AO:ns materialdialog) | Godkänd | 4002 ms |  |
| BILL-04 | Fakturering och fakturaunderlag | Delvis urval → fakturautkast: summeringen (exkl. moms/moms/inkl.) = skapade utkast, exakt de valda raderna, de försvinner ur kön och kan inte faktureras igen | Godkänd | 4988 ms | valt: 3 underlag valda · 2 kunder → 2 fakturautkast EXKL. MOMS 5 850,00 kr MOMS 1 462,50 kr INKL. MOMS 7 312,50 kr Avmarkera Skapa fakturautkast |
| BILL-05 | Fakturering och fakturaunderlag | Fakturaunderlagets detalj: rader visas exkl. moms med momssats i egen kolumn och stämmer mot summa exkl. moms, moms per sats och totalt inkl. moms (blandad 25/12/0 %, med och utan rabatt); statushjälp | Godkänd | 4793 ms | INV-QA-MIX (laptop): rader 1660 = ex 1660, moms 275 (25%:215, 12%:60, 0%:0), totalt 1935; INV-QA-DISC: rader 1660 − rabatt 166 = 1494, moms 247.5, totalt 1741.5; INV-QA-MIX (android): rader 1660 = ex 1660, moms 275 (25%: |
| BILL-06 | Fakturering och fakturaunderlag | Fakturakön: renderingstid för 10/100/1000 simulerade kandidater (kompakt vy, Välj alla, Visa alla rader) inom budget; progressiv rendering | Godkänd | 5062 ms | 10: {"cands":27,"median":1.2,"groups":7,"more":false,"selMs":10,"deselMs":2,"selected":27,"expMs":8,"rowsShown":27,"after":0}; 100: {"cands":117,"median":4.7,"groups":25,"more":false,"selMs":18,"deselMs":4,"selected":117 |
| BILL-07 | Fakturering och fakturaunderlag | Fakturakön och fakturadetaljen utan horisontell överbredd 360–1920 px; klistrad summering ovanför bottenmenyn på mobil; mål ≥ 40 px | Godkänd | 18542 ms |  |
| BILL-08 | Säkerhet | Fakturakön utfälld och Kräver åtgärd samt fakturadetaljen: HTML i kund-, AO-, material-, tid- och radtexter körs aldrig och visas som text | Godkänd | 3430 ms |  |
| BILL-09 | Fakturering och fakturaunderlag | Radbelopp mot summor med decimaler och avrundning: radbeloppen (exkl. moms, som rubriken säger) + ev. öresavrundning = Summa exkl. moms; moms = satsen på raderna; totalt = exkl. + moms; 1 tim × 430 kr = 430,00 kr exkl. (537,50 inkl.) | Godkänd | 4712 ms | laptop INV-QA-DEC: rader 1521.28 + avrundning 0.01 = 1521.29, moms 367.32, totalt 1888.61; laptop INV-QA-DEC25: rader 1421.28 + avrundning 0.01 = 1421.29, moms 355.32, totalt 1776.61; iphone INV-QA-DEC: rader 1521.28 + a |
| BILL-10 | Fakturering och fakturaunderlag | Mobil 390 px: välj underlag per fastighet, se vald summa, skapa underlag, läs raderna utan sidscroll och byt status | Godkänd | 3897 ms |  |
| BILL-11 | Fakturering och fakturaunderlag | Statusar och innehåll: underlag i utkast/skickad/betald/förfallen/makulerad visar rätt hjälptext och låsning; listan med alla statusar, tom kö och långa namn utan överbredd på 360 px | Godkänd | 7192 ms |  |
| ARP-01 | Inställningar och administration | Admin: alla elva avsnitt nås på 360, 390 och 1366 — grupperad meny på dator, rullista på mobil, inget avsnitt dolt utanför skärmen; Teknik & underhåll ligger sist | Godkänd | 9234 ms |  |
| ARP-02 | Inställningar och administration | Färgkedjan: förval, egen HEX och Standard förhandsvisas utan skrivning, sparas exakt en gång per ändring, övriga inställningar orörda, samma färg i sidomeny/knappar/märken efter omladdning, ny inloggning och på en annan enhet | Godkänd | 10256 ms | skrivningar av vift_settings: 3 för 3 sparade ändringar |
| ARP-03 | Rapporter och statistik | Rapporter: vald period syns (kontrast ≥ 4,5:1, aria-pressed), svensk periodetikett, läsbara statusnamn, enhetliga nyckeltal och svenska tal; flikarna nås via rullista på mobil | Godkänd | 4711 ms |  |
| ARP-04 | Rapporter och statistik | Tabeller ryms i sina kort på 360 och 390 med realistiskt löneunderlag (Rapporter → Offerter, Löneunderlag: fem personer, fyra veckor, långa namn) och har rubrikrad, cellutfyllnad, zebra och fast rubrik på dator | Godkänd | 5512 ms |  |
| ARP-05 | Tidregistrering och instämpling | Löneunderlag låser nuvarande beräkning: "Debiterbart värde" = timmar × tidpostens prisgruppspris (inte lönekostnad), "Intern kostnad (uppskattad)" = timmar × internalHourlyCost och döljs när värdet saknas; timmar i svensk form; attestering via kryssruta och "Attestera alla" går till servern | Godkänd | 2755 ms | nyckeltal: {"Totalt":"108,42 h","Debiterbart värde":"54 995 kr","Intern kostnad (uppskattad)":"27 104 kr","Tidposter":"27","Attesterat":"33,67 h"} |
| ARP-06 | Säkerhet | Admin, Rapporter och Löneunderlag: inget sidöverflöd och inget utanför fönstret 360–1920; ingen markup (t.ex. "<svg") eller undefined/NaN som text i någon flik; push-diagnostiken ligger i Teknik & underhåll | Godkänd | 16118 ms |  |
| ARP-07 | Inställningar och administration | "Rensa lokal cache på den här enheten": tydlig text (servern påverkas inte, du förblir inloggad), osparade ändringar kräver två bekräftelser med antal, rensning behåller inloggning och logotyper och rör inte serverns data; bara admin | Godkänd | 2660 ms |  |
| MISC-IMP-01 | Import och export | Importera (F-03/F-11): guiden ryms i 360/390/1366 utan att klippas, stegen syns, inaktiv Nästa ser ut som en knapp och aktiveras när fil valts | Godkänd | 5150 ms | mx360 {"w":340,"right":350,"vw":360,"stepsRight":350,"nSteps":1,"disabled":true,"bg":"rgb(15, 55, 99)","border":"1px","nextH":44,"op":0.5,"hint":"Välj en fil för att fortsätta"}; mx390 {"w":370,"right":380,"vw":390,"step |
| MISC-PROP-01 | Fastighetsregister | Fastighetskortet (F-06): alla flikar syns och nås på 360/390/1366/1920, aktiv flik markeras, varje flik visar sitt innehåll; äldre flikgrupper fungerar | Godkänd | 9910 ms |  |
| MISC-PROP-02 | Fastighetsregister | Fastighetskortet: ingen markup/attribut som text i någon flik (sökfältets placeholder var trasig), placeholder utan "<"; sökning tappar inte fokus | Godkänd | 7981 ms |  |
| MISC-PROP-03 | Fastighetsregister | Fastighetskortet: portkod/nyckelinfo visas för admin (objects_sensitive), aldrig för arbetsledare utan behörighet; fältarbetare nekas sidan | Godkänd | 5299 ms |  |
| MISC-HEAD-01 | Designstandard | Detaljhuvuden (F-10) på 390: tillbaka + rubrik på en rad, låg höjd, primär åtgärd synlig, övriga i ⋮-menyn som öppnas — Fastighetskort, Objekt, Kundkort, Projektkort | Godkänd | 7757 ms | mx390 pg-obj-detail {"h":118}; mx390 pg-propobj-detail {"h":108}; mx390 pg-crm-detail {"h":108}; mx390 pg-project-detail {"h":108}; mx1366 pg-obj-detail {"h":68}; mx1366 pg-propobj-detail {"h":68}; mx1366 pg-crm-detail { |
| MISC-CAL-01 | Kalender | Kalender veckovy (F-08): på 360/390 en läsbar dagslista (7 dagar, titlar inte bokstav för bokstav, vyväljaren på en rad, långtryck flyttar AO); på dator oförändrat rutnät | Godkänd | 6778 ms | mx360 {"days":7,"n":5,"minW":228}; mx390 {"days":7,"n":5,"minW":258} |
| MISC-RON-01 | Rondering | Rondering (F-09): stegetiketter, statusrad, punktstatus (Godkänd/Anmärkning/Ej aktuell) och "Klar" har kontrast ≥ 4,5:1 beräknat från faktiska färger; stegetiketterna kapas inte | Godkänd | 6189 ms |  |
| MISC-ICON-01 | Designstandard | Ikoner på samma rad som texten (F-02) i blockets sidor: Projekt, Projektkort, Kontrakt, Importera, Importlogg, Exportcenter, Fastighetskort, Objekt, Kundkort, Kalender, Rondering | Godkänd | 17818 ms |  |
| MISC-DATA-01 | Projekt | Projekt med 120 projekt: statuschips filtrerar och räknar rätt, sök behåller fokus och visar "Visar X av Y", Rensa filter; ingen sidscroll 360–1920 och rader högst ~1320 px breda på 1920 | Godkänd | 8727 ms | mx360 {"rows":113,"count":"Visar 113 av 113 projekt","w":340}; mx390 {"rows":113,"count":"Visar 113 av 113 projekt","w":370}; mx1366 {"rows":113,"count":"Visar 113 av 113 projekt","w":1062}; mx1920 {"rows":113,"count":"V |
| MISC-DATA-02 | Kundregister | Kontrakt (114 avtal) och Importlogg (15 importer): tabell på dator, kort per rad på 360/390, statuschip filtrerar med rätt antal, ingen sidscroll, begränsad bredd på 1920 | Godkänd | 11199 ms | mx360 {"rows":114,"rowDisplay":"grid","headShown":false,"w":340,"count":"Visar 114 av 114 avtal"}; mx390 {"rows":114,"rowDisplay":"grid","headShown":false,"w":370,"count":"Visar 114 av 114 avtal"}; mx1366 {"rows":114,"ro |
| MISC-TASK-01 | Projekt | Projektkort på 360/390 (uppgifter): status och ekonomi syns, AO under projektet, Ladda upp dokument nås och öppnar dialogen; inga åtgärder avklippta | Godkänd | 4847 ms |  |
| MISC-TASK-02 | Kalender | Kalender på 360/390 med nio jobb samma dag: dagens och veckans jobb syns läsbart, ett jobb öppnas, Skapa AO öppnar formuläret | Godkänd | 7386 ms |  |
| MISC-TASK-03 | Fastighetsregister | Fastighetskort på 360/390 (uppgifter): adress, portkod (admin), Ny AO, Lägg till objekt och serviceintervall nås utan avklippta knappar; långt namn kapas inte bort | Godkänd | 6992 ms |  |
| MISC-CUS-REACH-01 | Kundregister | Kundkortet på mobil (390 px): telefon och e-post för kunden och kontaktpersoner är tel:/mailto:-länkar, minst 40 px höga; text escapas | Godkänd | 1726 ms |  |
| SVC-UI-01 | Serviceintervall | Serviceintervall: sökfältet renderas korrekt (ingen markup/attribut som text), sökning behåller fokus och filtrerar, statusfilter räknar rätt, åtgärder med text, läsbart även i mörkt OS-läge, mobil utan överflöd | Godkänd | 8107 ms |  |
| OFFW-01 | Offertmodulen | Offertguiden (BRF): stegvalidering, alla radtyper via guiden (tjänst/kalkyl, fastpris, löpande, fritext, tillval i/utanför summan), blandad moms — livesummering, granskning och sparad offert = OfferCalc; detaljvyn visar samma innehåll och belopp | Godkänd | 5585 ms |  |
| OFFW-02 | Offertmodulen | Offertguiden på mobil (390 px, privatkund): tjänst med RUT, fastpris, löpande, fritext och tillval via "Lägg till arbete" — inget klipps eller scrollar i sidled i något steg; summering med RUT = OfferCalc; sparad offert öppnas i detaljvyn | Godkänd | 5408 ms |  |
| OFFD-01 | Offertmodulen | Offertdetalj per status (utkast, skickad, ändring begärd, godkänd, godkänd med AO, nekad, utgången, arkiverad, borttagen): rätt primär åtgärd (en enda), alla tidigare åtgärder går att nå (knapp, "⋮"-meny eller statusmeny); menyn öppnas, är inom skärmen och stängs med Escape | Godkänd | 24782 ms | utkast: Skicka offert + 5 menyposter; skickad: Boka uppföljning + 9 menyposter; ändring-begärd: Skapa ny version + 4 menyposter; godkänd: Skapa arbetsorder + 6 menyposter; godkänd (AO finns): Öppna arbetsorder + 6 menypo |
| OFFD-02 | Offertmodulen | Offertdetalj: belopp i huvud, rader och summering = OfferCalc för alla offerter (seed + realistiska fixturer: blandad moms, RUT/ROT, rabatt, återkommande och rörliga rader, tillval i/utanför summan); moms per sats summerar till momsen; alltid "exkl./inkl. moms"; ingen markup som text; historikens text visas oförändrad (ingen dubbel escapning) | Godkänd | 10201 ms | 15 offerter kontrollerade |
| OFFD-03 | Digitala offertlänkar och kundsvar | Offertdetalj: generera länk via bekräftelsedialog (utkast), registrera godkännande via statusmenyn, momsspärr vid blandad moms (ingen AO), Skapa arbetsorder skapar exakt en AO och primärknappen blir "Öppna arbetsorder"; kundens svar (nekad/ändring) visas | Godkänd | 8546 ms |  |
| OFFD-04 | Säkerhet | Offerter: HTML i titel, beskrivningar, rader, tillval, villkor, intern anteckning, kundsvar och bilagenamn körs aldrig (detalj, guidens fyra steg, granskning) och visas som text | Godkänd | 3709 ms |  |
| OFFD-05 | Offertmodulen | Offertdetalj och guidens steg utan sidscroll eller klippta knappar på 360, 390, 768, 1024, 1366 och 1920 px; ingen betrodd markup som text i någon status | Godkänd | 37245 ms |  |
| OFFW-03 | Offertmodulen | Offertguiden: utkast återställs i rätt steg (även steg 4), granskningen varnar för RUT/ROT på BRF-kund och kund utan e-post, och sparknappen visar "Sparar…" tills servern svarat | Godkänd | 5512 ms | under sparning: {"t":"Sparar…","d":true} |
| FALT-01 | Mina jobb | Mina jobb med många jobb: Idag (nästa jobb, försenade, resten av dagen, utan datum), Kommande per dag och Arbetspool — rätt gruppering, inga dubbletter, bara egna jobb; Ta jobbet tilldelar på servern | Godkänd | 1915 ms |  |
| FALT-02 | Tidregistrering och instämpling | Mina jobb: Stämpla in → exakt en aktiv markering och en Stämpla ut, statusen oförändrad; Stämpla ut → exakt en tidpost på servern och markeringen borta | Godkänd | 1981 ms |  |
| FALT-03 | Mina jobb | "Starta jobb" ändrar bara status (pågående på servern) — ingen tidpost och ingen stämpling skapas | Godkänd | 1250 ms |  |
| FALT-04 | Tidregistrering och instämpling | Manuell tid: fel visas vid fälten och i en sammanfattning, inget skickas; giltigt pass visar svensk sammanfattning, Sparar… tills servern svarat, och hamnar under rätt dag; redigering med sluttid före starttid nekas | Godkänd | 3932 ms |  |
| FALT-05 | Dashboard | Dagens drift (arbetsledare, många jobb): nyckeltalen = underliggande data, och varje ruta visar exakt så många rader; personal idag visar vem som arbetar med vad | Godkänd | 3062 ms | väntat {"today":21,"ongoing":5,"overdue":4,"urgent":4,"noStaff":4,"bill":4,"notes":1} visat {"today":21,"ongoing":5,"overdue":4,"urgent":4,"noStaff":4,"bill":4} |
| FALT-06 | Återkommande AO | Återkommande: "Om 1 dag"/"Om 2 dagar"/"Förfallen sedan 2 dagar" (F-12), sök behåller fokus, snabbval och statusfilter räknar rätt, pausa/aktivera bekräftas av servern och redigering återaktiverar inte ett pausat ärende | Godkänd | 4708 ms |  |
| FALT-07 | Mina jobb | Svenska format på fältsidorna: datum ("24 nov. 2026"), klockslag 08:00, timmar med decimalkomma — inga ISO-datum, AM/PM, m/d/y eller engelska dag-/månadsnamn i det som visas | Godkänd | 5178 ms |  |
| FALT-08 | Mina jobb | Fältsidorna 360–1920 px med många jobb, långa adresser och pågående stämpling: ingen sidledsrullning, inga knappar utanför skärmen eller avklippta, tryckytor >= 40 px på mobil | Godkänd | 27157 ms |  |
| FALT-09 | Säkerhet | Fältsidorna: ingen betrodd markup visas som text (RENDER-01-kontrollen) i alla vyer, filter och dialoger — med realistiskt innehåll | Godkänd | 8055 ms |  |
| FALT-10 | Mina jobb | Fältpersonalens dag på 360 px: dagens jobb syns direkt med nästa jobb överst, Karta öppnar vägbeskrivning, stämpla in och ut utan att något klipps | Godkänd | 1665 ms |  |
| REG-UI-01 | Register (V3) | Kunder: 150 kunder — sök och typfilter räknar rätt ("Visar X av Y"), status är egen flikgrupp, Rensa filter, sökfältet behåller fokus, ⋮ har Importera/Exportera, "Ny kund" öppnar formuläret | Godkänd | 3984 ms |  |
| REG-UI-02 | Register (V3) | Fastigheter: 120+ fastigheter — sök på adress räknar rätt, Arkiverade, kolumner adress/kund/objekt, tangentbord (Enter) öppnar fastighetskortet, "Ny fastighet" öppnar formuläret | Godkänd | 4737 ms |  |
| REG-UI-03 | Register (V3) | Artiklar: 130+ artiklar — status (Alla/Aktiva/Inaktiva) och kategori kombineras, sök på art.nr, pris visas exkl. moms (aldrig "inkl"), rad och "Ny artikel" öppnar formuläret | Godkänd | 3539 ms |  |
| REG-UI-04 | Register (V3) | Personal (F-19): ingen "Inaktivera"-knapp i raderna; Inaktivera/Aktivera nås via radens ⋮ (med bekräftelse) och sparas på servern; namn bryts inte på 390 px; arbetsledare (staff_view) får ingen meny eller primär åtgärd och nekas direktanrop | Godkänd | 7513 ms |  |
| REG-UI-05 | Register (V3) | Prisgrupper: flikarna Prisgrupper/Prisprofiler (.ftabs), primär åtgärd följer fliken, sök räknar rätt, timpris exkl. moms, profilrad öppnar redigering, ⋮ (Importera/Exportera) bara för prisgrupper | Godkänd | 2618 ms |  |
| REG-UI-06 | Register (V3) | Offerttjänster (F-20): en ⋮ per rad på mobil i stället för fyra ikonknappar; Testkalkyl/Duplicera/Inaktivera nås i menyn (Inaktivera med bekräftelse); sök behåller fokus och räknar rätt | Godkänd | 4213 ms |  |
| REG-UI-07 | Register (V3) | Uppgifter: ingen upprepad rubrik, V3-chips (inte mörka piller) i två grupper räknar rätt, sök + Rensa filter; per-post-regeln: fältarbetaren kan klarmarkera sin egen men inte annans uppgift | Godkänd | 6000 ms |  |
| REG-UI-08 | Register (V3) | Registerlayout 360/390/768 px med 100+ poster: ingen sidrullning i sidled, ingen avklippt text, knappar inom skärmen, ikonknappar har namn, inga ikoner på egen rad, ingen markup som text, kort per rad på mobil, radmenyer syns helt | Godkänd | 14650 ms | 360 px: 7 sidor kontrollerade; 390 px: 7 sidor kontrollerade; 768 px: 7 sidor kontrollerade |
| REG-UI-09 | Register (V3) | Registerlayout 1024/1366/1920 px med 100+ poster: samma kontroller som REG-UI-08, tabellrader på dator och innehållsbredd högst 1 440 px på 1920 (F-23) | Godkänd | 15000 ms | 1024 px: 7 sidor kontrollerade; 1366 px: 7 sidor kontrollerade; 1920 px: 7 sidor kontrollerade |
| REG-UI-10 | Register (V3) | Mobil (390 px) utifrån uppgifter: hitta kunden i registret och öppna kundkortet, hitta fastigheten och se adress, portkod (endast med behörighet), "Ny AO", objekt och serviceintervall — inga dolda flikar eller avklippta åtgärder | Godkänd | 7329 ms |  |
| REG-UI-11 | Register (V3) | Varje flik- och filterläge i registren (390 och 1366 px, 100+ poster): ingen markup som text, ingen avklippt text, inga ikoner på egen rad, ingen sidrullning i sidled | Godkänd | 15679 ms | 66 flik-/filterlägen kontrollerade |
| SYNC-ED-01 | Offertmodulen | Synken ritar inte om offertguiden: osparad ändring i en befintlig offert finns kvar efter en serverändring när inget fält har fokus; andra sidor uppdateras som förut | Godkänd | 4639 ms |  |
| SEC-NORM-01 | Säkerhet | Normalläge: inloggning, sparad ändring, utloggning utan osynkat (ingen varning), ny inloggning fungerar | Godkänd | 1369 ms |  |
| SEC-CACHE-01 | Säkerhet | SÄK-9: ADM → utloggning → FÄ på samma profil: inga vift_*-affärsnycklar, inget sessionStorage, tomt minne | Godkänd | 2905 ms |  |
| SEC-CACHE-02 | Säkerhet | SÄK-9: nätavbrott vid inläsning efter kontobyte — degraderad inläsning visar aldrig föregående användares cache | Godkänd | 1772 ms | FÄ vid nätfel: {"user":null,"app":false,"cus":0} |
| SEC-CACHE-04 | Säkerhet | SÄK-9 (positivt): samma användare vid nätfel efter omladdning får sin egen cache; inga skrivningar tillåts | Godkänd | 2692 ms |  |
| SEC-CACHE-03 | Säkerhet | SÄK-9: utloggning och kontobyte i annan flik slår igenom — fliken tömmer minnet, visar inloggning och kan inte skriva | Godkänd | 3952 ms |  |
| SEC-TAB-02 | Säkerhet | SÄK-9: kontobyte i annan flik innan storage-händelsen hunnit fram — skrivningen med gammal identitet stoppas ändå | Godkänd | 2674 ms |  |
| SEC-SESS-01 | Säkerhet | SÄK-9: sessionen upphör (JWT ogiltig, förnyelse nekas) — fail-closed, data skyddas, osparad ändring finns kvar för ägaren | Godkänd | 5407 ms |  |
| SEC-OUTBOX-01 | Säkerhet | SÄK-9: utloggning med osynkad utkorg varnar (Synka nu / Logga ut ändå / Avbryt); nästa användare skickar inte och ser inte posten; ägaren får den skickad | Godkänd | 9061 ms |  |
| SEC-OUTBOX-02 | Säkerhet | Uppgradering från v3.4: gamla utkorgsnycklar migreras till ägarnycklad form; post utan känd ägare behålls, varnas och skickas aldrig automatiskt | Godkänd | 4440 ms |  |
| SEC-ROLL-10 | Säkerhet | SÄK-10: inloggning utan personalpost ger ingen reservroll — sidan "Ditt konto saknar behörighet", ingen meny, inga sidor, ingen data | Godkänd | 469 ms | accessState=no_staff |
| SEC-CUST-23 | Säkerhet | SÄK-10: personalpost med okänt roll-id ger inga behörigheter (fail-closed), ingen app och ingen data | Godkänd | 414 ms |  |
| SEC-PERM-01 | Säkerhet | Indragen behörighet slår igenom i öppen session (synk) och i annan flik utan egen synk: otillåten sida lämnas | Godkänd | 1984 ms |  |
| SEC-PERM-02 | Säkerhet | Personalpost inaktiveras under pågående session: servern svarar 403 → klienten tar bort åtkomsten direkt (sidan "saknar behörighet") | Godkänd | 2723 ms |  |
| T3B-01 | Arbetsordrar | AP-FEL-1: personaldialogen på en pool-AO — ingen poolruta; bara personal och ansvarig ändras; status och datum oförändrade; notis bara till faktiskt tillagd personal efter serverbekräftelse; borttagning ger ingen notis och AO:n återvänder inte till öppen pool | Godkänd | 3281 ms |  |
| T3B-02 | Arbetsordrar | AP-G: "Ta bort datum" rensar bara datumet; "Släpp till öppen pool" kräver bekräftelse, tar bort personal och datum och sätter öppen pool | Godkänd | 2606 ms |  |
| T3B-03 | Mina jobb | SÄK-4: "Ta jobbet" när någon annan hunnit först → besked "redan tagits", ingen lokal tilldelning, servern orörd, listan omläst | Godkänd | 2049 ms |  |
| T3B-04 | Användarroller och behörigheter | D-07/F21: arbetsledare kan inte sätta status fakturerad via AO-ändring — servern nekar (invoice_path_required) och klienten backar och säger det | Godkänd | 1195 ms |  |
| T3B-05 | Tidregistrering och instämpling | AP-B: instämplingslistan visar bara egna tilldelade AO; instämpling på annans AO nekas av servern med not_assigned och ingen stämpling sparas | Godkänd | 1220 ms |  |
| T3C-01 | Säkerhet | SÄK-8/SEC-ROLL-01/02 (klient): personalansvarig (bara staff_manage) erbjuds bara roller inom egna behörigheter, kan inte ändra egen roll eller superadministratören; serverns avslag visas begripligt och ändras tillbaka | Godkänd | 2706 ms | {"fa":{"ids":["personal"],"email":true,"las":" Personens roll ligger utanför dina behörigheter — bara en superadministratör eller den som har rollens behörigheter kan ändra roll, e-post eller status.","inaktivera":false} |
| T3C-02 | Säkerhet | SEC-ROLL-03/SEC-CUST-19 (klient): egen roll med bara admin_manage — rolleditorn erbjuder inte "Alla behörigheter", inte behörigheter man saknar och låser egen roll och superadminrollen; serverns superadmin_required visas begripligt | Godkänd | 2651 ms |  |
| T3C-03 | Säkerhet | SEC-ROLL-04 (klient): den enda superadministratören inaktiverar sig själv eller tar bort "Alla behörigheter" ur sin roll → servern svarar 409 last_superadmin, klienten förklarar och ingenting ändras | Godkänd | 3218 ms |  |
| T3C-04 | Säkerhet | D-21/D-14 (SEC-B3-02/03/05): fältarbetaren får bara sin egen roll och inte andras role/permissions — inloggning, Auth.can och menyn fungerar; arbetsledaren ser andras roll men inte rollregistret; direkt REST-läsning döljer registren | Godkänd | 6510 ms | {"roller":["personal"],"andraRole":false,"meny":0} |
| T3C-05 | Säkerhet | SEC-ROLL-08/09 (klient): egen superadminroll med annat id fungerar; roll med id "admin" UTAN "Alla behörigheter" ger inga superadminval | Godkänd | 3689 ms |  |
| T3C-06 | Säkerhet | Indragen behörighet (tillägget i BESLUT-2026-11-28): admin drar in en behörighet i rolleditorn — den redan inloggade fliken nekas vid nästa serveranrop och lämnar den otillåtna sidan | Godkänd | 5930 ms |  |
| T3C-07 | Säkerhet | F18 (SEC-REST-01/02, klient): direkt REST-skrivning av affärsnycklar och okända nycklar nekas med 42501 direct_write_blocked; T4-A notiser: vitlistan avvecklad (notiser + lastChanged nekas), notisvägen går via servern | Godkänd | 2513 ms | {"kunder":{"status":403,"code":"42501","error":"direct_write_blocked"},"personal":{"status":403,"code":"42501","error":"direct_write_blocked"},"okand":{"status":403,"code":"42501","error":"direct_write_blocked"},"radera" |
| T3D-01 | Säkerhet | SÄK-2/SEC-TASK-04 (klient, D-15, F8): fältets Uppgifter och dashboard visar bara egna, tilldelade och uppgifter på egna AO; bara egna kan redigeras; Klar bara där servern tillåter; ansvarig kan bara vara en själv; direktanrop mot annans uppgift ger 403 not_own utan ändring | Godkänd | 6787 ms | {"state":"ACT-T3D-AOKOPPLAD,ACT-T3D-EGEN,ACT-T3D-TILLD","egen":{"synlig":true,"klar":true,"oppna":true},"tilld":{"synlig":true,"klar":true,"oppna":false},"ao":{"synlig":true,"klar":false,"oppna":false},"annans":null} |
| T3D-02 | Säkerhet | D-15/SEC-TASK-05/06 (klient): ekonomi (ao_view_all utan ao_edit) ser bara sina egna uppgifter och får inte ändra andras; arbetsledaren ser och ändrar alla | Godkänd | 5488 ms |  |
| T3D-03 | Säkerhet | B4/D-12/D-13/D-22 (klient): fältets dashboard, Mina jobb och AO-detalj fungerar med urvalet per post — kund och kontakt för egen AO, historik märkt som klientrapport, inga andras kunder, offertbelopp eller aktivitetsposter i tillstånd eller cache | Godkänd | 5300 ms | {"cu":"K-001,K-002,K-004,K-007","aoCu":"K-001,K-002,K-004,K-007","logAo":"","logTyper":"","egnaAo":"AO-001,AO-002,AO-005,AO-008,AO-012,AO-013","offerFalt":"","staffFalt":"active,email,firstName,id,lastName,phone,title"} |
| T3D-04 | Säkerhet | D-22/SEC-B4-05/06 (klient): fältets egna händelser sparas (aktör och tid från servern); en otillåten typ eller en referens till annans AO nekas med 403 type_not_allowed/ref_not_visible utan ändring av loggen | Godkänd | 2888 ms |  |
| T3E-01 | Säkerhet | Standardrollen admin (all): hela menyn inklusive admin och löner; rolleditorn visar alla behörigheter och märker de ej verkställda "verkställs i T4" | Godkänd | 4673 ms | ["ao_plan_own=verkställs i AO-etappen","export_data=verkställs i T4-F","export_personal_data=verkställs i T4-F","objects_access_assigned=verkställs i T4-C","rondering_utfor=verkställs i T4-D"] |
| T3E-02 | Säkerhet | Standardrollen chef (Arbetsledare): arbetsorder, kunder, offerter, fakturaunderlag (D-07), personal (läsa), rapporter (T3-E 5), inte löner eller admin; ser alla AO och lägger rad i fakturaunderlag | Godkänd | 2604 ms | pg-activities,pg-ao,pg-ao-detail,pg-calendar,pg-contracts,pg-crm,pg-crm-detail,pg-dash,pg-export-center,pg-import-wizard,pg-inv-detail,pg-invoices,pg-myjobs,pg-obj-detail,pg-objects,pg-offer,pg-offer-detail,pg-operations |
| T3E-03 | Säkerhet | Standardrollen ekonomi: fakturaunderlag, löner, rapporter och kunder (läsa); inte personal, admin eller tidregistrering; attest fungerar, kundändring nekas | Godkänd | 2798 ms | pg-activities,pg-ao,pg-ao-detail,pg-calendar,pg-crm,pg-crm-detail,pg-dash,pg-export-center,pg-import-wizard,pg-inv-detail,pg-invoices,pg-myjobs,pg-operations,pg-payroll,pg-reports,pg-rondering,pg-rondering-rapport,pg-ron |
| T3E-04 | Säkerhet | Standardrollen personal: Mina jobb med öppen pool, tid och egna AO; inga kunder, fakturor eller admin; "Ta jobbet" bekräftas av servern; annans AO nekas med not_assigned | Godkänd | 4415 ms | pg-activities,pg-ao,pg-ao-detail,pg-calendar,pg-dash,pg-myjobs,pg-tid |
| T3E-05 | Säkerhet | Standardrollen begransad (D-04): bara egna tilldelade AO; ingen öppen pool, tid, kunder eller ekonomi; tagning och tid nekas av servern | Godkänd | 1691 ms | pg-activities,pg-ao,pg-ao-detail,pg-calendar,pg-dash,pg-myjobs |
| T3E-06 | Säkerhet | Ej verkställda behörigheter (tillägget i BESLUT-2026-11-28): begransad med de ej verkställda (export_data, objects_access_assigned m.fl.; T4-B: time_view_all verkställd och borttagen ur listan) får exakt samma meny, sidor, AO, personaluppgifter och lokala cache som utan dem | Godkänd | 4465 ms | {"utan":["pg-activities","pg-ao","pg-ao-detail","pg-calendar","pg-dash","pg-myjobs"],"med":["pg-activities","pg-ao","pg-ao-detail","pg-calendar","pg-dash","pg-myjobs"]} |
| T3E-07 | Säkerhet | Indragen behörighet med standardrollen personal: admin tar bort ao_pool_take i rolleditorn — den inloggade fliken och en andra flik nekas vid nästa serveranrop, poolen försvinner ur tillståndet och cachen efter nästa läsning; ingen AO ändras | Godkänd | 7915 ms | {"pool":[],"kan":false,"cache":[]} |
| T4A-01 | Säkerhet | SÄK-7: arbetsledare utan objects_sensitive (egen roll) ser ingen portkod i objekt eller AO och sparar objektet utan att portkoden raderas; skickad portkod nekas (field_protected) utan ändring | Godkänd | 1920 ms |  |
| T4A-02 | Säkerhet | D-13: standardrollen chef (utan personal_data_view) ser inget personnummer, formuläret visar inget personnummerfält och en sparad privatkund behåller sitt personnummer | Godkänd | 5696 ms |  |
| T4A-03 | Säkerhet | D-17: två administratörer ändrar olika inställningar samtidigt — båda finns kvar; admin_manage utan cost_view/bankgiro_edit ser inte intern timkostnad (inget påhittat värde) och bevarar bankgiro och timkostnad | Godkänd | 4331 ms |  |
| T4A-04 | Säkerhet | D-01/D-06: fältet har inga inköpspriser, ingen intern timkostnad, inget bankgiro och ingen AO-ekonomi i tillståndet eller cachen | Godkänd | 1776 ms |  |
| T4A-05 | Säkerhet | T3-E-beslutet: rolleditorn (katalogmarkör) tar bort en ny behörighet; en rollskrivning utan markör (v3.4-form) bevarar behörigheter utanför v3.4-katalogen | Godkänd | 3246 ms |  |
| T4A-06 | Säkerhet | T3-E 5: standardrollen chef når Rapporter; sidan visar inga personnummer eller portkoder (varje rapport följer underliggande behörighet) | Godkänd | 3427 ms |  |
| T4A-07 | Säkerhet | Punkt 7: inaktiverad roll ger ingen behörighet (klient och server) och inga verksamhetsdata | Godkänd | 1158 ms |  |
| NOTIF-02 | Notiser | Tilldelningsnotis: personaldialogen och bulkåtgärden — servern skapar notisen efter bekräftad tilldelning (avsändare, tid och text satta av servern) och bara mottagaren ser den | Godkänd | 3013 ms |  |
| NOTIF-03 | Notiser | Egen markering: notispanelen markerar bara de egna notiserna lästa på servern; andras är orörda; andra enheten ser dem lästa | Godkänd | 1731 ms |  |
| NOTIF-04 | Notiser | Nekad notis åt annan: fältpersonal kan inte skapa notiser åt kollegor (type_not_allowed), inte egna påminnelser åt annan (recipient_not_allowed) och inte via REST (42501); inget ändras och appen fungerar vidare | Godkänd | 2253 ms |  |
| NOTIF-05 | Notiser | Andras notiser når inte klienten: tillstånd, lokal cache och REST innehåller bara egna notiser — även för superadmin; äldre poster utan mottagare syns inte | Godkänd | 4255 ms |  |
| NOTIF-06 | Notiser | Gammal klient (v3.4/T3/T4-A persistNotifs): REST-upserten nekas utan dataförlust och utan att tilldelning, uppgifter och AO bryts | Godkänd | 2540 ms |  |
| T4B-01 | Säkerhet | D-09/D-19/F13: fältet lägger till material utan belopp i väljare och formulär; raden sparas radvis och servern sätter artikelpriset | Godkänd | 4750 ms |  |
| T4B-02 | Säkerhet | D-19: fältets hela materiallista (äldre klient) nekas utan ändring; inga redigera/ta bort-knappar på andras rader | Godkänd | 1663 ms |  |
| T4B-03 | Fakturering | D-10: fritext utan pris är okänd (Pris saknas, aldrig 0 kr), arbetsledaren kompletterar, fastpris-material ingår, servern stoppar okänt pris | Godkänd | 5345 ms |  |
| T4B-04 | Tid | D-11/F13: stämpla ut och Tid visar prisgrupp utan belopp, bara AO:ns grupp; annan grupp nekas; inget timpris i tidposterna | Godkänd | 3203 ms |  |
| T4B-05 | Administration | punkt 247/G12: aktivera/inaktivera prisgrupp — besked efter serverbekräftelse, avslag rullas tillbaka | Godkänd | 8048 ms |  |
| T4B-06 | Tid | K-01/D-08: arbetsledaren (time_view_all) ser all personals tid utan attest; ekonomi (payroll_view) med attest | Godkänd | 5824 ms |  |
| T4B-07 | Tid | T3-B beslut 1: tid på klar AO nekas; ekonomi kompletterar i efterhand med orsak och revisionsrad; fältet får inte rätta | Godkänd | 3405 ms |  |
| T4B-08 | Arbetsorder | F13: lönsamheten visar intern timkostnad som saknad (inget påhittat 250 kr/h) och TB som ofullständigt | Godkänd | 1798 ms |  |

## Skärmbilder av misslyckade tester

Inga — inget test misslyckades i denna körning.

## Simulerat eller verifierat mot STAGING?

Alla tester ovan körs mot den simulerade backenden (`fake-backend.js`). Tester av typen *serverkontrakt* prövar en modell av EF:ernas behörighetsregler — de riktiga källorna finns inte i repot (G4). Inget här är verifierat mot riktig Supabase STAGING; den läsande kontrollen av befintlig STAGING körs separat (`staging-readonly.js`).

## Mätvärden (lokal maskin, simulerad backend utan nätverkslatens)

| Test | Mätvärde | Värde |
|---|---|---|
| AUTH-01 | inloggning → app laddad (ms) | 1338 |
| PAGES-01 | medel renderingstid per sida (ms) | 363 |
| PAGES-01 | långsammaste sida (ms) | 396 |
| RESP-DESKTOP | medel renderingstid (desktop, ms) | 364 |
| RESP-LAPTOP | medel renderingstid (laptop, ms) | 363 |
| RESP-TABLET | medel renderingstid (tablet, ms) | 362 |
| RESP-IPHONE | medel renderingstid (iphone, ms) | 363 |
| RESP-ANDROID | medel renderingstid (android, ms) | 363 |
| CUS-01 | spara ny kund → bekräftelse (ms) | 287 |
| AO-01 | skapa AO → serverbekräftad (ms) | 1280 |
| AO-09 | patch_ao per loggpost | 1 |
| RES-03 | feedback_ms | 9288 |
| PERF-01 | inloggning_till_klar_ms | 917 |
| PERF-01 | anrop_vid_start | 5 |
| PERF-01 | ao_lista_ms | 206 |
| PERF-01 | ao_rader | 151 |
| PERF-01 | ao_detalj_ms | 34 |
| PERF-01 | kundlista_ms | 775 |
| PERF-01 | dashboard_ms | 147 |
| PERF-01 | rapport_tid_ms | 69 |
| PERF-01 | loneunderlag_ms | 1026 |
| PERF-01 | kalender_ms | 144 |
| PERF-01 | kundsokning_ms | 181 |
| PERF-01 | sparning_kund_till_ack_ms | 30 |
| PERF-01 | anrop_i_vila_35s | 5 |
| PERF-01 | js_heap_mb | 17 |
| AOL-06 | 10 AO: rendering_ms | 21 |
| AOL-06 | 10 AO: rader | 9 |
| AOL-06 | 10 AO: statusbyte_ms | 7 |
| AOL-06 | 10 AO: statusbyte_tillbaka_ms | 12 |
| AOL-06 | 10 AO: snabbval_ms | 13 |
| AOL-06 | 10 AO: snabbval_av_ms | 24 |
| AOL-06 | 10 AO: sokning_ms | 139 |
| AOL-06 | 10 AO: sokning_renderingar | 1 |
| AOL-06 | 10 AO: sokning_enbart_rendering_ms | 18 |
| AOL-06 | 10 AO: visa_alla_ms | 17 |
| AOL-06 | 10 AO: rader_visa_alla | 9 |
| AOL-06 | 100 AO: rendering_ms | 59 |
| AOL-06 | 100 AO: rader | 84 |
| AOL-06 | 100 AO: statusbyte_ms | 16 |
| AOL-06 | 100 AO: statusbyte_tillbaka_ms | 34 |
| AOL-06 | 100 AO: snabbval_ms | 15 |
| AOL-06 | 100 AO: snabbval_av_ms | 34 |
| AOL-06 | 100 AO: sokning_ms | 144 |
| AOL-06 | 100 AO: sokning_renderingar | 1 |
| AOL-06 | 100 AO: sokning_enbart_rendering_ms | 19 |
| AOL-06 | 100 AO: visa_alla_ms | 45 |
| AOL-06 | 100 AO: rader_visa_alla | 84 |
| AOL-06 | 1000 AO: rendering_ms | 109 |
| AOL-06 | 1000 AO: rader | 150 |
| AOL-06 | 1000 AO: statusbyte_ms | 71 |
| AOL-06 | 1000 AO: statusbyte_tillbaka_ms | 100 |
| AOL-06 | 1000 AO: snabbval_ms | 88 |
| AOL-06 | 1000 AO: snabbval_av_ms | 66 |
| AOL-06 | 1000 AO: sokning_ms | 184 |
| AOL-06 | 1000 AO: sokning_renderingar | 1 |
| AOL-06 | 1000 AO: sokning_enbart_rendering_ms | 59 |
| AOL-06 | 1000 AO: visa_alla_ms | 314 |
| AOL-06 | 1000 AO: rader_visa_alla | 834 |
| AOL-08 | klick → AO-detalj (ms) | 41 |
| BILL-06 | 10 kandidater: kompakt rendering (median ms) | 1.2 |
| BILL-06 | 10 kandidater: Välj alla / avmarkera (ms) | 10 / 2 |
| BILL-06 | 10 kandidater: Visa alla rader (ms, 27 rader) | 8 |
| BILL-06 | 100 kandidater: kompakt rendering (median ms) | 4.7 |
| BILL-06 | 100 kandidater: Välj alla / avmarkera (ms) | 18 / 4 |
| BILL-06 | 100 kandidater: Visa alla rader (ms, 117 rader) | 33 |
| BILL-06 | 1000 kandidater: kompakt rendering (median ms) | 11.7 |
| BILL-06 | 1000 kandidater: Välj alla / avmarkera (ms) | 21 / 8 |
| BILL-06 | 1000 kandidater: Visa alla rader (ms, 282 rader) | 67 |

## Konsolfel och ej modellerade anrop

- **PROP-03** — ej modellerat: GET /rest/v1/property_images
- **OBJ-01** — ej modellerat: GET /rest/v1/property_images
- **ART-01** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_articles: forbidden`
- **AO-05** — konsol: `[WorkOrderService] Serverskrivning avvisad för AO-007 : forbidden`
- **TIME-04** — konsol: `[TimeService] Manuellt tidsskapande avvisades av servern för TID-e330cfb4-5ef1-4bce-8111-553248ab09ef : forbidden`
- **OFF-04** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_offers: http_503`, `[persist] merge-skrivning avvisad för vift_offers: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **SVC-02** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_properties: http_503`, `[persist] merge-skrivning avvisad för vift_properties: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **ROLE-02** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_roles: http_503`, `[persist] merge-skrivning avvisad för vift_roles: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **STAFF-02** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_staff: http_503`, `[persist] merge-skrivning avvisad för vift_staff: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **ADMIN-01** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_articles: http_503`, `[persist] merge-skrivning avvisad för vift_articles: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **RON-03** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_activityLog: http_503`, `[persist] merge-skrivning avvisad för vift_activityLog: http_503`, `[Storage.writeBusinessKeyMerge] avvisad för vift_ronderingar: http_503`
- **SALES-01** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_salesOpps: http_503`, `[persist] merge-skrivning avvisad för vift_salesOpps: http_503`, `[Storage.writeBusinessKeyMerge] avvisad för vift_activityLog: http_503`
- **IMP-02** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_customers: http_503`, `[persist] merge-skrivning avvisad för vift_customers: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **RES-03** — konsol: `[persist] merge-skrivning avvisad för vift_customers: network_error`, `[persist] merge-skrivning avvisad för vift_activityLog: network_error`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **RES-04** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_customers: http_503`, `[persist] merge-skrivning avvisad för vift_customers: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **G12-01** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_customers: http_503`, `[persist] merge-skrivning avvisad för vift_customers: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **STG-01** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_activityLog: forbidden`, `[persist] merge-skrivning avvisad för vift_activityLog: forbidden`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **RENDER-01** — ej modellerat: GET /rest/v1/property_images
- **RENDER-01-CHEF** — ej modellerat: GET /rest/v1/property_images
- **MISC-PROP-01** — ej modellerat: GET /rest/v1/property_images
- **MISC-PROP-02** — ej modellerat: GET /rest/v1/property_images
- **MISC-HEAD-01** — ej modellerat: GET /rest/v1/property_images
- **MISC-ICON-01** — ej modellerat: GET /rest/v1/property_images
- **SEC-CACHE-04** — konsol: `[persist] BLOCKERAD: senaste läsningen var degraderad (fallback), ingen bulk-skrivning tillåten.`
- **SEC-CACHE-03** — konsol: `[persist] BLOCKERAD: ingen giltig session/åtkomst för den identitet som gjorde ändringen.`
- **SEC-TAB-02** — konsol: `[persist] BLOCKERAD: ingen giltig session/åtkomst för den identitet som gjorde ändringen.`
- **SEC-SESS-01** — konsol: `[Auth] Session expired — re-login required`, `[persist] merge-skrivning avvisad för vift_customers: auth_expired`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **T3C-01** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_staff: forbidden`, `[persist] merge-skrivning avvisad för vift_staff: forbidden`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **T3C-02** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_roles: forbidden`, `[persist] merge-skrivning avvisad för vift_roles: forbidden`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **T3C-03** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_staff: last_superadmin`, `[persist] merge-skrivning avvisad för vift_staff: last_superadmin`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **T3C-06** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_customers: forbidden`, `[persist] merge-skrivning avvisad för vift_customers: forbidden`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **T3E-04** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_activityLog: append_only`, `[persist] merge-skrivning avvisad för vift_activityLog: append_only`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **NOTIF-02** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_activityLog: append_only`, `[persist] merge-skrivning avvisad för vift_activityLog: append_only`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **NOTIF-06** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_activityLog: append_only`, `[persist] merge-skrivning avvisad för vift_activityLog: append_only`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **T4B-05** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_priceGroups: forbidden`, `[persist] merge-skrivning avvisad för vift_priceGroups: forbidden`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
