# VIFT CRM — E2E-resultat

Genererad 2026-11-24T16:51:31.538Z. Mål: simulerad backend (FakeSupabase). Webbläsare: Chromium (Playwright).

**112 tester: 110 godkända, 0 misslyckade, 1 blockerade, 1 kända fel (reproducerade, ej åtgärdade).**

Simulerad backend: klientens beteende mot en modell av Supabase-kontrakten — inte verifierat mot riktig STAGING.

**Modultäckning: 32 av 32 moduler har minst ett godkänt webbläsartest. Kritiska arbetsflöden: 13 av 13 godkända.** Ett godkänt test visar att det beskrivna flödet fungerar — inte att varje knapp på sidan är prövad; se kolumnen Omfattning.

| # | Modul | Tester | Godkända | Misslyckade | Kända fel | Blockerade | Omfattning |
|---|---|---|---|---|---|---|---|
| 1 | Inloggning och utloggning | AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06 | 6 | 0 | 0 | 0 | UI-funktioner |
| 2 | Dashboard | DASH-01, MAP-01 | 2 | 0 | 0 | 0 | UI-funktioner |
| 3 | Navigering och menyer | PAGES-01, PAGES-02 | 2 | 0 | 0 | 0 | UI-funktioner |
| 4 | Kundregister | CUS-01, CUS-02, CUS-03, G12-01 | 4 | 0 | 0 | 0 | UI-funktioner |
| 5 | Kontaktpersoner | CON-01 | 1 | 0 | 0 | 0 | UI-funktioner |
| 6 | Fastighetsregister | PROP-01, PROP-02, PROP-03 | 3 | 0 | 0 | 0 | UI-funktioner |
| 7 | Objekt och lägenheter | OBJ-01 | 1 | 0 | 0 | 0 | UI-funktioner |
| 8 | Arbetsordrar | AO-01, AO-02, AO-03, AO-04, AO-05, AO-06, AO-07, AO-09 | 7 | 0 | 1 | 0 | UI-funktioner |
| 9 | Arbetsorderchecklistor | CHK-01, CHK-02, CHK-03, CHK-04, CHK-05, CHK-06, CHK-07, SYNC-AO-01 | 8 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 10 | Arbetsorderloggar | LOG-01, LOG-02, LOG-03, LOG-04, LOG-05, AO-07B, AO-07C, AO-07D | 8 | 0 | 0 | 0 | UI-funktioner |
| 11 | Bilder och dokument | IMG-01, IMG-02, IMG-03 | 3 | 0 | 0 | 0 | UI-funktioner |
| 12 | Materialregistrering | MAT-01 | 1 | 0 | 0 | 0 | UI-funktioner |
| 13 | Tidregistrering och instämpling | TIME-01, TIME-02, TIME-03, TIME-04, TIME-05, TIME-06 | 6 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 14 | Mina jobb | MYJOBS-01 | 1 | 0 | 0 | 0 | UI-funktioner |
| 15 | Personalregister | STAFF-01, STAFF-02 | 2 | 0 | 0 | 0 | UI-funktioner |
| 16 | Användarroller och behörigheter | ROLE-01, AO-08, ROLE-02, PERM-01, PERM-02, PERM-03, PERM-04 | 6 | 0 | 0 | 1 | UI + serverkontrakt (simulerat) |
| 17 | Offertmodulen | FLOW-01, OFF-03, OFF-02, ATT-01, ATT-02, G8-01 | 6 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 18 | Digitala offertlänkar och kundsvar | OFF-04, OFF-01 | 2 | 0 | 0 | 0 | UI-funktioner |
| 19 | Fakturering och fakturaunderlag | INV-01, INV-02, ECO-01, G10-01 | 4 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 20 | Prisgrupper och artiklar | ART-01 | 1 | 0 | 0 | 0 | UI-funktioner |
| 21 | Projekt | PROJ-01 | 1 | 0 | 0 | 0 | UI-funktioner |
| 22 | Rondering | RON-01, RON-03 | 2 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 23 | Avvikelser | RON-02 | 1 | 0 | 0 | 0 | UI-funktioner |
| 24 | Serviceintervall | SVC-01, SVC-02, SVC-03 | 3 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 25 | Återkommande AO | REC-01 | 1 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 26 | Att göra | TASK-01, TASK-02 | 2 | 0 | 0 | 0 | UI-funktioner |
| 27 | Kalender | CAL-01, CAL-02 | 2 | 0 | 0 | 0 | UI-funktioner |
| 28 | Säljchanser | SALES-01 | 1 | 0 | 0 | 0 | UI-funktioner |
| 29 | Rapporter och statistik | REP-01 | 1 | 0 | 0 | 0 | UI-funktioner |
| 30 | Import och export | IMP-01, IMP-02, EXP-01 | 3 | 0 | 0 | 0 | arbetsflöde end-to-end |
| 31 | Inställningar och administration | ADMIN-01, MODAL-01 | 2 | 0 | 0 | 0 | UI-funktioner |
| 32 | Push och notifieringsgränssnitt | NOTIF-01 | 1 | 0 | 0 | 0 | UI-funktioner |

**Tvärgående:** Responsiv layout (5/5 godkända: RESP-DESKTOP, RESP-LAPTOP, RESP-TABLET, RESP-IPHONE, RESP-ANDROID); Robusthet (5/5 godkända: RES-01, RES-02, RES-03, RES-04, SW-01); Prestanda (1/1 godkända: PERF-01); Designstandard (3/3 godkända: UI-KV-01, UI-PROP-01, UI-BDG-01); Sparning och synk (1/1 godkända: STG-01); Aktivitetslogg (1/1 godkända: ACT-01).

## Per test

| Id | Modul | Test | Resultat | Tid | Anmärkning |
|---|---|---|---|---|---|
| AUTH-01 | Inloggning och utloggning | Inloggning med giltigt konto visar appen och rätt användare | Godkänd | 964 ms | Laddade 15 AO och 7 kunder |
| AUTH-02 | Inloggning och utloggning | Fel lösenord ger begripligt fel och ingen inloggning | Godkänd | 530 ms |  |
| AUTH-03 | Inloggning och utloggning | Utloggning via menyn rensar session och skyddad cache | Godkänd | 1057 ms |  |
| AUTH-04 | Inloggning och utloggning | Användarbyte på samma enhet: ny användare ser inte föregåendes lönedata | Godkänd | 1746 ms | ekonomi såg 6 poster, fältarbetaren 3 |
| AUTH-05 | Inloggning och utloggning | Sessionen överlever omladdning | Godkänd | 1264 ms |  |
| AUTH-06 | Inloggning och utloggning | Snabb inmatning direkt när inloggningen visas: lösenordet hamnar aldrig i e-postfältet (fördröjd autofokus) | Godkänd | 1065 ms |  |
| PAGES-01 | Navigering och menyer | Alla 37 registrerade sidor öppnas utan JS-fel och utan "undefined/NaN" (admin, laptop) | Godkänd | 14468 ms | pg-project-detail: ingen testdata (projectId) — tomt läge; pg-propobj-detail: ingen testdata (objId) — tomt läge |
| PAGES-02 | Navigering och menyer | Sidomenyn: varje synligt menyval öppnar sin sida; tillbaka-knappen fungerar | Godkänd | 8729 ms | 23 menyval klickade |
| RESP-DESKTOP | Responsiv layout | Alla sidor i desktop: ingen horisontell scroll, inga knappar utanför skärmen | Godkänd | 14588 ms | pg-project-detail: ingen testdata (projectId) — tomt läge; pg-propobj-detail: ingen testdata (objId) — tomt läge |
| RESP-LAPTOP | Responsiv layout | Alla sidor i laptop: ingen horisontell scroll, inga knappar utanför skärmen | Godkänd | 14685 ms | pg-project-detail: ingen testdata (projectId) — tomt läge; pg-propobj-detail: ingen testdata (objId) — tomt läge |
| RESP-TABLET | Responsiv layout | Alla sidor i tablet: ingen horisontell scroll, inga knappar utanför skärmen | Godkänd | 14581 ms | pg-project-detail: ingen testdata (projectId) — tomt läge; pg-propobj-detail: ingen testdata (objId) — tomt läge |
| RESP-IPHONE | Responsiv layout | Alla sidor i iphone: ingen horisontell scroll, inga knappar utanför skärmen | Godkänd | 14626 ms | pg-project-detail: ingen testdata (projectId) — tomt läge; pg-propobj-detail: ingen testdata (objId) — tomt läge |
| RESP-ANDROID | Responsiv layout | Alla sidor i android: ingen horisontell scroll, inga knappar utanför skärmen | Godkänd | 14663 ms | pg-project-detail: ingen testdata (projectId) — tomt läge; pg-propobj-detail: ingen testdata (objId) — tomt läge |
| CUS-01 | Kundregister | Ny kund via formulär sparas på servern, syns i listan och hittas med sökning | Godkänd | 3599 ms | besked: Kund skapad |
| CUS-02 | Kundregister | Tomt kundnamn nekas med begripligt besked, inget sparas | Godkänd | 2207 ms |  |
| CUS-03 | Kundregister | Redigera kund (telefon) sparas på servern | Godkänd | 2703 ms |  |
| CON-01 | Kontaktpersoner | Kontaktperson på fastighet läggs till och sparas på servern | Godkänd | 2705 ms |  |
| PROP-01 | Fastighetsregister | Ny fastighet utan objects_sensitive: portkodsfält visas inte, ingen portkod i registret | Godkänd | 1752 ms |  |
| PROP-02 | Fastighetsregister | Portkod vid ny fastighet (admin) sparas skyddat — aldrig i delade registret; fältarbetare kan inte läsa den | Godkänd | 2661 ms |  |
| PROP-03 | Fastighetsregister | Fastighetskortets alla flikar öppnas utan fel | Godkänd | 3095 ms |  |
| OBJ-01 | Objekt och lägenheter | Lägg till objekt på fastighet och öppna objektkortet | Godkänd | 2927 ms | objektformulär: new-obj-type, new-obj-num, new-obj-name, new-obj-entrance, new-obj-stairwell, new-obj-floor, new-obj-area, new-obj-status, new-obj-access |
| STAFF-01 | Personalregister | Ny personal via formulär sparas; listan visar personen | Godkänd | 2751 ms |  |
| ROLE-01 | Användarroller och behörigheter | Menyn visar bara sidor rollen får se; direktnavigering till otillåten sida nekas | Godkänd | 9205 ms |  |
| ART-01 | Prisgrupper och artiklar | Ny artikel och ny prisgrupp sparas; utan article_manage nekar servern direktskrivning | Godkänd | 5391 ms | serverkontrollen är modellerad — måste upprepas mot riktig STAGING |
| AO-01 | Arbetsordrar | Ny AO via guiden (3 steg) skapas på servern via ao-time-write och får AO-nummer | Godkänd | 2212 ms | besked: AO-(sparas…) skapad |
| AO-02 | Arbetsordrar | Dubbelklick på "Skapa order" ger exakt en AO | Godkänd | 4345 ms |  |
| LOG-01 | Arbetsorderloggar | Loggpost (fältarbetare på egen AO): "Sparar…" och sedan "sparad" först efter serverns ACK | Godkänd | 3013 ms |  |
| LOG-02 | Arbetsorderloggar | Servern nekar loggpost: aldrig "sparad", posten försvinner och fel visas | Godkänd | 1727 ms |  |
| LOG-03 | Arbetsorderloggar | Avbrott mitt i sparning: ingen bekräftelse; efter återanslutning skickas posten exakt en gång | Godkänd | 3492 ms |  |
| LOG-04 | Arbetsorderloggar | Servern svarar inte (timeout): "sparad" visas aldrig före serverns bekräftelse; exakt en post | Godkänd | 4166 ms |  |
| LOG-05 | Arbetsorderloggar | Osäkert utfall (servern sparade, svaret tappades): "sparad" först efter bekräftelse, ingen dubblett vid återförsök | Godkänd | 2822 ms |  |
| CHK-01 | Arbetsorderchecklistor | Admin lägger till kontrollpunkt; fältarbetare bockar av — båda på servern | Godkänd | 5941 ms |  |
| MAT-01 | Materialregistrering | Material läggs till på AO med antal, pris och moms; servern får raden | Godkänd | 3190 ms |  |
| AO-03 | Arbetsordrar | Starta arbete ändrar status på servern | Godkänd | 2831 ms |  |
| AO-04 | Arbetsordrar | Arkivera med bekräftelse → servern arkiverad; besked först efter ACK; återställ fungerar | Godkänd | 1774 ms |  |
| AO-05 | Arbetsordrar | Arkivering som servern nekar: AO:n återställs lokalt, inget "arkiverad" | Godkänd | 1798 ms |  |
| AO-06 | Arbetsordrar | Två användare redigerar samma AO samtidigt (olika fält): båda ändringarna finns kvar på servern | Godkänd | 3502 ms |  |
| AO-07 | Arbetsordrar | Samtidiga loggposter från två enheter på samma AO (känt gap G5) | Känt fel | 5239 ms | Kontroll misslyckades: båda loggposterna borde finnas kvar — loggen skickas som hel array (G5) |
| AO-07B | Arbetsorderloggar | G5 med serverstöd (append_log): samtidiga loggposter från två enheter bevaras båda; borttagning tar bara bort sin post; ingen hel-array-patch | Godkänd | 4019 ms |  |
| AO-07C | Arbetsorderloggar | Två enheter sparar loggpost under samma millisekund: båda posterna får egna id och finns kvar på servern (tidigare samma id → den ena tappades tyst trots "sparad") | Godkänd | 3445 ms | id: LOG-1795000000000-226af04d, LOG-1795000000000-31e41d88 |
| AO-09 | Arbetsordrar | En AO-ändring = en serverskrivning (ingen extra geokodnings-patch när adressen inte kan geokodas) | Godkänd | 3456 ms |  |
| IMG-01 | Bilder och dokument | Foto i AO-logg laddas upp via EF (bara imagePath i AO), visas via signerad URL | Godkänd | 2330 ms |  |
| IMG-02 | Bilder och dokument | Fil som inte är en bild nekas av servern; loggposten sparas inte | Godkänd | 1778 ms |  |
| IMG-03 | Bilder och dokument | Radera loggpost med foto: filen raderas först efter serverbekräftad radering | Godkänd | 3465 ms |  |
| AO-08 | Användarroller och behörigheter | Begränsad användare: servern levererar bara egna/pool-AO; direkt patch av annan AO → 403 | Godkänd | 930 ms |  |
| TIME-01 | Tidregistrering och instämpling | Flöde: fältarbetare stämplar in/ut på AO → serverbekräftad tidpost → löneadmin ser och attesterar → posten låst | Godkänd | 3171 ms |  |
| TIME-02 | Tidregistrering och instämpling | Stämpla in på mobil → datorn visar instämplad vid flikfokus; stämpla ut på datorn → mobilen visar utstämplad | Godkänd | 2817 ms |  |
| TIME-03 | Tidregistrering och instämpling | Dubbel utstämpling av samma pass från två enheter → exakt en tidpost | Godkänd | 5299 ms |  |
| TIME-04 | Tidregistrering och instämpling | Manuell tid på Tid-sidan: "Sparar tiden…" → "Tid sparad" efter ACK; nekad → borttagen och tydligt fel | Godkänd | 2380 ms |  |
| TIME-05 | Tidregistrering och instämpling | Användarbyte med osynkad utstämpling: tidposten tappas inte och skickas inte i fel användares namn | Godkänd | 9223 ms |  |
| TIME-06 | Tidregistrering och instämpling | Löneskydd: fältarbetare får bara egna tidposter, även vid direktanrop | Godkänd | 897 ms |  |
| MYJOBS-01 | Mina jobb | Mina jobb visar egna tilldelade AO; "Starta" startar jobbet på servern | Godkänd | 2771 ms |  |
| FLOW-01 | Offertmodulen | Arbetsflöde kund → fakturaunderlag: samma belopp i offertguide, kundlänk, AO, fakturakö och fakturautkast | Godkänd | 18579 ms | offertguide: 3952 / 988 / 4940 kr; OfferCalc: 3952 / 988 / 4940; AO prismodell fast, fast pris 3952; underlag: [{"id":"fixed:AO-f4edf1e5-47b4-40fe-8fa6-9710592610a3","type":"fixed","amount":3952,"sel":true,"issues":[]}]; |
| OFF-03 | Offertmodulen | Rabatt i offertguiden: kontrollen visas när första engångsraden läggs till; 10 % rabatt ger samma belopp i guide, OfferCalc, PDF och kundlänk | Godkänd | 3768 ms | guide 1890 / 473 / 2363; OfferCalc 2100 − 210 = 1890, moms 473, totalt 2363 |
| OFF-04 | Digitala offertlänkar och kundsvar | Generera och återkalla kundlänk; serverfel vid återkallning ger inget "återkallad"-besked medan länken fortfarande fungerar | Godkänd | 10936 ms | toasts vid serverfel: Sparar… / Länken är INTE återkallad — servern bekräftade inte ändringen och kunden kan fortfarande öppna den — ändringen ligger kvar som osparad; välj Återuppta eller Kasta i meddelandet överst. |
| OFF-01 | Digitala offertlänkar och kundsvar | Kundlänk: ogiltig/återkallad/redan besvarad ger begripligt besked; dubbelt godkännande nekas | Godkänd | 1025 ms |  |
| INV-01 | Fakturering och fakturaunderlag | Fakturautkast: rad, rabatt och ROT större än totalen; servern nekar ändring av skickad faktura | Godkänd | 1356 ms |  |
| INV-02 | Fakturering och fakturaunderlag | Utan invoice_create: knappar dolda och servern nekar direktanrop | Godkänd | 928 ms |  |
| OFF-02 | Offertmodulen | Offert-PDF (genereras i webbläsaren) visar samma totalsumma som OfferCalc för samtliga befintliga offerter | Godkänd | 9517 ms | 5 offerter kontrollerade |
| ECO-01 | Fakturering och fakturaunderlag | Löpande AO: 80 min à 595 kr + material 3 × 33,33 kr → fakturakö → fakturautkast → ROT; öresavrundning och ROT på arbete inkl. moms (samma regel som offerten) | Godkänd | 11131 ms | underlag: [{"id":"time:TID-f59c50c8-a209-499c-b06e-ef628b99d5c9","type":"time","q":1.33,"p":595,"a":791.35,"sel":true,"issues":[]},{"id":"material:AO-a9617094-e169-4cd8-a060-07db3a8bb1e1:M1795538747393","type":"material" |
| SVC-01 | Serviceintervall | Flöde: skapa intervall → förfallodatum → Att göra vid uppstart → markera utförd med AO och kommentar → historik, uppgift stängd | Godkänd | 12058 ms |  |
| SVC-02 | Serviceintervall | Serverfel vid "Markera utförd" ger inget definitivt "utfört"-besked och ingen tyst förlust | Godkänd | 6835 ms | toasts: Sparar… / Utförandet kunde inte sparas — den ligger kvar som osparad; välj Återuppta eller Kasta i meddelandet överst. |
| SVC-03 | Serviceintervall | Översikten: filter, sök och paus/återuppta sparas på servern; fältarbetare utan customer_manage nekas sidan | Godkänd | 6215 ms |  |
| ROLE-02 | Användarroller och behörigheter | Ändra rolls behörighet: serverfel → inget "Roll uppdaterad", behörigheten oförändrad; lyckad ändring slår igenom för rollens användare | Godkänd | 5764 ms | toasts: Sparar… / Rollen "Tekniker / Personal" kunde inte sparas — behörigheterna är OFÖRÄNDRADE — den ligger kvar som osparad; välj Återuppta eller Kasta i meddelandet överst. |
| STAFF-02 | Personalregister | Byta roll på en person: serverfel → inget "Sparat"; lyckat byte sparas på servern | Godkänd | 4864 ms | toasts: Sparar… / Ändringen för Sofia Lindgren kunde inte sparas — den ligger kvar som osparad; välj Återuppta eller Kasta i meddelandet överst. |
| ADMIN-01 | Inställningar och administration | Admin-flikarna öppnas utan fel; fältarbetare nekas Admin; äldre sparväg utan bekräftelse ger varning vid serverfel | Godkänd | 7079 ms | toasts: Sparat / Varning: servern bekräftade inte den senaste ändringen (artiklar). Den kan vara osparad — kontrollera och försök igen. |
| RON-01 | Rondering | Flöde: skapa rondering i guiden → tillfälle → utför på mobil (OK, anmärkning med AO, ej aktuell) → slutför → rapport → AO klar → avvikelse åtgärdad | Godkänd | 12361 ms |  |
| RON-02 | Avvikelser | Fältarbetare utan ao_view_all nekas rondering i UI och vid direktanrop; serverfel vid punkt ger tydligt fel och ingen lokal ändring | Godkänd | 4212 ms |  |
| RON-03 | Rondering | Serverfel när ronderingen sparas: inget "Rondering skapad", inga tillfällen skapas för en rondering servern saknar | Godkänd | 5229 ms | toasts: Sparar… / Varning: servern bekräftade inte den senaste ändringen (ronderingar). Den kan vara osparad — kontrollera och försök igen. / Ronderingen kunde inte skapas — den ligger kvar som osparad; välj Återuppta el |
| REC-01 | Återkommande AO | Skapa återkommande ärende (fastighet, checklista, personal) → "Skapa AO nu" → AO på servern med checklista; schemat flyttas fram först efter serverns bekräftelse; dubbelt klick ger en AO | Godkänd | 8747 ms | AO för tillfället: AO-164d17e7-3774-493d-ab47-2b06f9555852 2026-11-24 |
| SALES-01 | Säljchanser | Skapa säljchans → skapa offert från den → kopplad först när offerten sparats → markera vunnen; serverfel ger varning | Godkänd | 6802 ms | toasts: Sparar… / Ändringen kunde inte sparas — den ligger kvar som osparad; välj Återuppta eller Kasta i meddelandet överst. |
| PROJ-01 | Projekt | Skapa projekt → koppla befintlig AO → projektets AO-flik visar den; AO:n bär projectId på servern; arkivera/återställ | Godkänd | 6477 ms |  |
| TASK-01 | Att göra | Skapa uppgift åt fältarbetare → fältarbetaren ser och klarmarkerar den på mobilen → servern; fältarbetaren kan inte ta bort andras uppgift | Godkänd | 8613 ms | serverns per-nyckel-behörighet för activities kan inte verifieras i simulerad backend (G4) — upprepa mot STAGING |
| CAL-01 | Kalender | Kalender: dra AO till annan dag (dator) och flytta via långtryck-dialog (mobil) → servern; vyer dag/vecka/månad/agenda öppnas | Godkänd | 7116 ms |  |
| IMP-01 | Import och export | Flöde: importera 3 syntetiska kunder (1 dubblett) → dubbletten uppdateras → serverkontroll → ångra import → servern återställd | Godkänd | 6539 ms |  |
| IMP-02 | Import och export | Import när servern nekar: inget "Import slutförd" utan förbehåll; ogiltig fil ger begripligt fel | Godkänd | 7152 ms | toasts: Varning: servern bekräftade inte den senaste ändringen (kunder, importloggar). Den kan vara osparad — kontrollera och försök igen. |
| EXP-01 | Import och export | Export av fastigheter och objekt innehåller aldrig portkod/nyckelinformation; kunder exporteras som CSV | Godkänd | 4739 ms | property: ﻿Namn;Fastighetsbeteckning;Adress;Postnummer;Ort;Objektnummer;Fastighetstyp;Byggnadsår;Antal lägenheter;Total yta (m²);Förvaltningsform;Driftområde;Status;Antec; propertyObject: ﻿Namn;Objektnummer;Typ (lagenhet |
| REP-01 | Rapporter och statistik | Ekonomirapporten: "Fakturerat" = summan av utställda fakturor exkl. moms (samma beräkning som fakturavyn); tidrapporten kopplar tid till AO | Godkänd | 4124 ms | förväntat fakturerat (exkl. moms): 17975 |
| DASH-01 | Dashboard | Dashboard per roll: widgets laddar utan fel; klick på AO-räknare leder till filtrerad AO-lista; fältarbetaren ser inga ekonomisiffror | Godkänd | 7698 ms |  |
| NOTIF-01 | Push och notifieringsgränssnitt | Notiser: in-app-notis visas i notislistan, kan markeras läst; push-prenumeration registreras utan att något skickas på riktigt | Godkänd | 2958 ms | simulerade push-utskick: 0 (inga riktiga utskick — send-push registreras bara) |
| RES-01 | Robusthet | Mobilen tappar nätet: loggpost köas; när nätet kommer tillbaka skickas den automatiskt (utan omladdning) exakt en gång | Godkänd | 3575 ms |  |
| RES-02 | Robusthet | Omladdning mitt i sparning (AO-logg och kundändring): båda hamnar på servern exakt en gång efter omladdning | Godkänd | 5601 ms |  |
| RES-03 | Robusthet | Servern svarar inte på kundändring (timeout): inget "uppdaterad", tydligt besked inom rimlig tid | Godkänd | 10585 ms | besked efter 9308 ms: Kunde inte spara kunden. Ändringen ligger kvar som osparad — välj Återuppta eller Kasta i meddelandet överst. |
| RES-04 | Robusthet | Utloggning med osparad kundändring: nästa användare skickar den inte i sitt namn; när ägaren loggar in igen skickas den | Godkänd | 8965 ms |  |
| SW-01 | Robusthet | Service Worker: ny driftsättning (ny ?v=) hämtas vid omladdning — ingen gammal cachad fil; offline-start visar appen från cache | Godkänd | 1458 ms | offline-start: {"hasLogin":true,"hasApp":true,"router":true} |
| PERM-01 | Användarroller och behörigheter | Fältarbetare: direktanrop mot annans AO, faktura, roller, portkod och andras tid nekas av servern | Godkänd | 867 ms |  |
| PERM-02 | Användarroller och behörigheter | Arbetsledare (utan lön/portkod) och begränsad AO-användare: servern nekar det rollen saknar | Godkänd | 2898 ms |  |
| PERM-03 | Användarroller och behörigheter | Generiska nycklar (kunder, offerter, säljchanser, att göra) per roll vid direktanrop mot store-key-write | Blockerad |  | Kan inte verifieras mot simulerad backend: store-key-write:s per-nyckel-behörighet för generiska nycklar är okänd (källan finns inte i repot, G4; BLOCKER-2 i PROJECT_STATUS). Den simulerade servern tillåter alla inloggad |
| PERM-04 | Användarroller och behörigheter | Sidåtkomst per roll (6 roller × alla sidor): otillåten sida nekas med besked, tillåten sida öppnas utan fel | Godkänd | 16222 ms | admin: 26 tillåtna, 0 nekade; chef: 20 tillåtna, 6 nekade; falt: 6 tillåtna, 20 nekade; ekonomi: 11 tillåtna, 15 nekade; begransad: 5 tillåtna, 21 nekade; falt2: 6 tillåtna, 20 nekade |
| PERF-01 | Prestanda | Stor datamängd (2 000 kunder, 3 000 fastigheter, 3 000 AO, 20 000 tidposter): inloggning, AO-lista, AO-detalj, kundsökning, sparning — uppmätta tider och anrop | Godkänd | 40291 ms | observation: pollningen var pausad så länge sökfältet hade fokus; mätvärden: {"inloggning_till_klar_ms":1131,"anrop_vid_start":5,"ao_lista_ms":860,"ao_rader":0,"ao_detalj_ms":173,"kundlista_ms":390,"dashboard_ms":289,"ra |
| MODAL-01 | Inställningar och administration | Dialoger som använder okLabel/ok har en Spara-knapp: nytt avtal och ny e-postmall kan skapas och sparas på servern | Godkänd | 4087 ms |  |
| ATT-01 | Offertmodulen | Redigera offertbilaga: med serverstöd sparas "synlig i kundvy" på servern; utan (driftsatt EF i dag) tydligt fel och ingen lokal ändring | Godkänd | 2640 ms |  |
| G12-01 | Kundregister | G12: sparvägar som tidigare sa "Sparat" före serverns svar — vid serverfel inget framgångsbesked och lokal återställning; när servern svarar sparas ändringen | Godkänd | 22054 ms |  |
| ATT-02 | Offertmodulen | Ta bort offertbilaga: Bekräfta tar faktiskt bort bilagan på servern (await Modal.confirm gav tidigare undefined) | Godkänd | 2912 ms |  |
| G10-01 | Fakturering och fakturaunderlag | G10: godkänd offert med ROT → AO → fakturautkast: varning, "skickad" spärras tills avdraget lagts in (förifyllt från offerten) eller "utan avdrag" bekräftats | Godkänd | 5720 ms |  |
| G8-01 | Offertmodulen | G8: RUT-avdrag större än totalen (efter rabatt) — offerten kan inte sparas; kundsidan visar inget negativt belopp och tillåter inte godkännande | Godkänd | 4751 ms |  |
| MAP-01 | Dashboard | Karta: två AO på Vasaplatsen 8 → en markör med "2", popup listar båda med status och Akut; olika adress med samma koordinat grupperas inte ihop; räknaren skiljer jobb/platser/ej placerade | Godkänd | 2094 ms | räknare: 13 aktiva jobb · 2 platser på kartan · 10 kunde inte placeras |
| CAL-02 | Kalender | Kalender (veckovy): överlappande arbetsordrar ritas sida vid sida — ingen döljer den andra | Godkänd | 1628 ms | händelser: 4 |
| UI-KV-01 | Designstandard | Etikett/värde (kv): på dator står värdet nära etiketten; på mobil står etikett och värde kvar på samma rad (staplade rader gjorde säljkorten ~20 % högre) | Godkänd | 3256 ms |  |
| UI-PROP-01 | Designstandard | Fastighetskortets åtgärdsrad: namnet visas på dator; på mobil kapas ingen rubrik (bara numret visas, namnet står redan i kortet) | Godkänd | 3072 ms | laptop: {"nameShown":true,"clipped":false,"text":"Solgläntan Hus A OBJ-001"}; iphone: {"nameShown":false,"clipped":false,"text":"OBJ-001"} |
| UI-BDG-01 | Designstandard | AO-listan: "Redo fakturering" är ett ljust statusmärke som övriga, inte ett fyllt marinblått filterchip | Godkänd | 3176 ms | laptop: {"cls":"bdg bdg-blue ao-ready-inv","lum":232}; iphone: {"cls":"bdg bdg-blue ao-ready-inv","lum":232} |
| CHK-02 | Arbetsorderchecklistor | Påbörja → "Sparar…" tills servern svarat → Pågår med vem/när; AO:ns status oförändrad; Utförd registrerar vem/när | Godkänd | 2845 ms | badge: 2/4 utförda |
| CHK-03 | Arbetsorderchecklistor | Två användare/enheter: flera punkter pågående samtidigt, inget skrivs över; synkas till den andra enheten; indikatorn skiljer pågående från utförda | Godkänd | 4061 ms | badge A: 1/4 utförda · 2 pågår |
| CHK-04 | Arbetsorderchecklistor | Återställ: egen åtgärd med ao_checklist; annans och äldre punkt kräver ao_edit — nekas på servern även vid direktanrop | Godkänd | 4182 ms |  |
| CHK-05 | Arbetsorderchecklistor | Serverfel/timeout: aldrig "Pågår"/"Utförd" utan ACK; tydligt fel; raden tillbaka | Godkänd | 1601 ms | efter synk: utford (servern: utförd) |
| CHK-06 | Arbetsorderchecklistor | Äldre server (före migrationen): ingen Påbörja-knapp, befintlig OK/avvikelse fungerar som förut, inget tolkas som "återställ" | Godkänd | 2183 ms |  |
| CHK-07 | Arbetsorderchecklistor | Mobil: kompakt checklista — knappar under texten, tryckyta ≥ 36 px, ingen horisontell scroll; dator: knappar till höger | Godkänd | 2548 ms | iphone: {"scroll":false,"minBtn":36,"below":true,"right":false,"states":"ej_paborjad,pagaende,utford,avvikelse"}; laptop: {"scroll":false,"minBtn":28,"below":false,"right":true,"states":"ej_paborjad,pagaende,utford,avvik |
| SYNC-AO-01 | Arbetsorderchecklistor | Synk mellan enheter: en annan enhets AO-ändring syns utan ny åtgärd även när AO-hämtningen blir klar efter omritningen | Godkänd | 2551 ms |  |
| STG-01 | Sparning och synk | STAGING-regler: fältarbetarens aktivitetsloggpost nekas av servern (admin_manage) — ingen återkommande falsk varning; en nekad ändring av användarens egna data varnar fortfarande | Godkänd | 22500 ms | aktivitetslogg-skrivningar nekade av servern: 3; toasts: ["","",""] |
| TASK-02 | Att göra | TASK-01-rättningen (per-post-regel): fältarbetaren klarmarkerar sin tilldelade uppgift mot STAGING-regler; direktanrop mot annans uppgift, förfalskad ny uppgift åt annan och radering av annans uppgift nekas av servern | Godkänd | 3269 ms | direktanrop: {"complete_other":403,"forge_new":403,"delete_other":403,"full_write":403} |
| ACT-01 | Aktivitetslogg | Klientrapporterat aktivitetsflöde: fältarbetarens händelser sparas en och en (appendActivity), servern verifierar bara användare och tid (source=klientrapport); hela listan skickas aldrig; generisk skrivning av loggen nekas (append-only) | Godkänd | 5382 ms | poster: [["time_entry_created","ST-004","klientrapport"],["work_order_updated","ST-004","klientrapport"]] |
| AO-07D | Arbetsorderloggar | work-order-log-write: servern stämplar staffId; annans loggpost kan inte tas bort utan ao_edit (direktanrop); egen kan; ingen hel-array-patch | Godkänd | 1881 ms |  |

## Skärmbilder av misslyckade tester

Inga — inget test misslyckades i denna körning.

## Simulerat eller verifierat mot STAGING?

Alla tester ovan körs mot den simulerade backenden (`fake-backend.js`). Tester av typen *serverkontrakt* prövar en modell av EF:ernas behörighetsregler — de riktiga källorna finns inte i repot (G4). Inget här är verifierat mot riktig Supabase STAGING; den läsande kontrollen av befintlig STAGING körs separat (`staging-readonly.js`).

## Mätvärden (lokal maskin, simulerad backend utan nätverkslatens)

| Test | Mätvärde | Värde |
|---|---|---|
| AUTH-01 | inloggning → app laddad (ms) | 905 |
| PAGES-01 | medel renderingstid per sida (ms) | 362 |
| PAGES-01 | långsammaste sida (ms) | 376 |
| RESP-DESKTOP | medel renderingstid (desktop, ms) | 362 |
| RESP-LAPTOP | medel renderingstid (laptop, ms) | 362 |
| RESP-TABLET | medel renderingstid (tablet, ms) | 361 |
| RESP-IPHONE | medel renderingstid (iphone, ms) | 362 |
| RESP-ANDROID | medel renderingstid (android, ms) | 362 |
| CUS-01 | spara ny kund → bekräftelse (ms) | 296 |
| AO-01 | skapa AO → serverbekräftad (ms) | 1262 |
| AO-09 | patch_ao per loggpost | 1 |
| RES-03 | feedback_ms | 9305 |
| PERF-01 | inloggning_till_klar_ms | 1131 |
| PERF-01 | anrop_vid_start | 5 |
| PERF-01 | ao_lista_ms | 860 |
| PERF-01 | ao_rader | 0 |
| PERF-01 | ao_detalj_ms | 173 |
| PERF-01 | kundlista_ms | 390 |
| PERF-01 | dashboard_ms | 289 |
| PERF-01 | rapport_tid_ms | 122 |
| PERF-01 | loneunderlag_ms | 658 |
| PERF-01 | kalender_ms | 173 |
| PERF-01 | kundsokning_ms | 395 |
| PERF-01 | sparning_kund_till_ack_ms | 34 |
| PERF-01 | anrop_i_vila_35s | 5 |
| PERF-01 | js_heap_mb | 16 |

## Konsolfel och ej modellerade anrop

- **PROP-03** — ej modellerat: GET /rest/v1/property_images
- **OBJ-01** — ej modellerat: GET /rest/v1/property_images
- **ART-01** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_articles: forbidden`
- **LOG-02** — konsol: `[WorkOrderService] Serverskrivning avvisad för AO-007 : forbidden`
- **LOG-03** — konsol: `[persist] merge-skrivning avvisad för vift_activityLog: network_error`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`, `[persist] merge-skrivning avvisad för vift_activityLog: network_error`
- **AO-05** — konsol: `[WorkOrderService] Serverskrivning avvisad för AO-007 : forbidden`
- **IMG-03** — konsol: `[WorkOrderService] Serverskrivning avvisad för AO-007 : forbidden`
- **TIME-04** — konsol: `[TimeService] Manuellt tidsskapande avvisades av servern för TID-336e177b-4e9f-4724-93cf-e581546caf63 : forbidden`
- **FLOW-01** — konsol: `[WorkOrderService] Serverskrivning avvisad för AO-f4edf1e5-47b4-40fe-8fa6-9710592610a3 : forbidden`
- **OFF-04** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_offers: http_503`, `[persist] merge-skrivning avvisad för vift_offers: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **ECO-01** — konsol: `[WorkOrderService] Serverskrivning avvisad för AO-a9617094-e169-4cd8-a060-07db3a8bb1e1 : forbidden`
- **SVC-02** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_properties: http_503`, `[persist] merge-skrivning avvisad för vift_properties: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **ROLE-02** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_roles: http_503`, `[persist] merge-skrivning avvisad för vift_roles: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **STAFF-02** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_staff: http_503`, `[persist] merge-skrivning avvisad för vift_staff: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **ADMIN-01** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_articles: http_503`, `[persist] merge-skrivning avvisad för vift_articles: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **RON-03** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_activityLog: http_503`, `[persist] merge-skrivning avvisad för vift_activityLog: http_503`, `[Storage.writeBusinessKeyMerge] avvisad för vift_ronderingar: http_503`
- **SALES-01** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_salesOpps: http_503`, `[persist] merge-skrivning avvisad för vift_salesOpps: http_503`, `[Storage.writeBusinessKeyMerge] avvisad för vift_activityLog: http_503`
- **IMP-02** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_customers: http_503`, `[persist] merge-skrivning avvisad för vift_customers: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **RES-01** — konsol: `[persist] merge-skrivning avvisad för vift_activityLog: network_error`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`, `[persist] merge-skrivning avvisad för vift_activityLog: network_error`
- **RES-03** — konsol: `[persist] merge-skrivning avvisad för vift_customers: network_error`, `[persist] merge-skrivning avvisad för vift_activityLog: network_error`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **RES-04** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_customers: http_503`, `[persist] merge-skrivning avvisad för vift_customers: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **G12-01** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_customers: http_503`, `[persist] merge-skrivning avvisad för vift_customers: http_503`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
- **STG-01** — konsol: `[Storage.writeBusinessKeyMerge] avvisad för vift_activityLog: forbidden`, `[persist] merge-skrivning avvisad för vift_activityLog: forbidden`, `[persist] Server-write misslyckades — DataSync._lastSig lämnas oförändrat (senast bekräftade värde).`
