# VIFT CRM – Masterplanstillägg: Teknisk underhållsplanering

**Roadmap-ID:** `ROADMAP-UNDERHALL-2026-10-23`
**Datum:** 2026-10-23
**Status:** 🔴 EJ PÅBÖRJAD / PLANERAD FRAMTIDA MODUL
**Prioritet:** Efter aktuell R6/R9B-stabilisering, centrala flödestester, RLS Fas 2 och godkänd LIVE-release.
**Placering:** Refereras additivt från `docs/MASTERPLAN.md`. Detta dokument är ett färdigt utvecklingsunderlag men ändrar ännu inte Git-repots övriga filer — ingen SQL, frontend, Edge Function eller LIVE-ändring har gjorts för underhållsplanen.

## Modul och huvudmål

Bygg en **fullvärdig modul i VIFT CRM** för långsiktig teknisk underhållsplanering för fastighetsägare, fastighetsförvaltare och bostadsrättsföreningar. Den ska återanvända CRM:s befintliga fastighetsregister, organisationsgränser, användare, rättigheter, dokument och arbetsorder där dessa är lämpliga. Bygg **inte** ett parallellt register som skapar motstridiga fastigheter eller kunduppgifter. Underhållsåtgärder och historik har egen normaliserad serverlagring; förvaltningens ordinarie AO-system kan användas som utförande-/beställningskoppling efter tydlig design.

Planeringshorisont **10–50 år**. Teknik, risk, prioritet, årsrullning, ekonomi, historik och faktisk utförd åtgärd måste vara långsiktigt korrekta, inte bara illustrerade med en statisk årslista.

### Kärnkrav och avgränsningar

- **Objekthierarki:** fastighetsbestånd → fastighet → byggnad → byggnadsdel/installation → komponent → underhållsåtgärd. Separata instanser för t.ex. flera ventilationsaggregat i samma byggnad. Varje nivå har tydlig identitet, teknisk information och historik.
- **Inventering:** besiktningar, skick 1–5, risk/konsekvens, teknisk livslängd som _redigerbar uppskattning_, bild, plats, utförare, daterad dokumentation och osäkerhet. Gamla inventeringar skrivs aldrig över.
- **Planering:** åtgärdsdefinition, planerat år och tidigaste/senaste år, intervall, ansvarig, prioritet, beslut, status, faktisk kostnad och genomförandedatum; hantera akut/planerat, helrenovering/delåtgärd/reparation och ändrad komponentålder efter utbyte.
- **Återkommande underhåll:** beräkna nästa tillfälle från relevant installationsår eller faktiskt genomförandedatum, med individuella åtgärdsintervall; ingen dubbelgenerering vid årsbyte eller omplanering.
- **Ekonomi:** mängd × enhetspris + etablering/projektering/övrigt/reserv, basår, index, fasta/löpande priser, moms, CAPEX/OPEX, årsbudget, låsta budgetversioner, utfall, prognoser 10/20/30/50 år, kr/m² med uttrycklig areatyp och scenarier.
- **Prioritering:** skick, följdskaderisk, säkerhet/myndighetskrav, driftstopp, ekonomi, hyresgäster och samordning. Beslutsmotivering och möjlighet till manuell justering.
- **Status:** Identifierad → Planerad → Budgeterad → Beslutad → Beställd → Pågående → Genomförd → Slutkontrollerad; dessutom Uppskjuten, Avbruten och Ersatt. Samtliga ändringar revisionsloggas.
- **Årsprocess:** verkliga utfall, omplanering, avvikelseförklaringar, låst årsversion, jämförelse mellan versioner; genomförda åtgärder och deras faktiska kostnader är historiskt oföränderliga.
- **Underhållsskuld:** beteckna förfallna/uppskjutna behov som underhållsskuld enligt definierad metod, inte samtliga framtida underhållskostnader.
- **Rapporter:** dashboard med hela beståndet, prognos-/utfallsdiagram, Gantt/tidslinje, åtgärdslistor, inventeringsprotokoll, 5-årsplan och **PDF/Excel-export** med tydlig planversion.
- **Import/export:** Excel/CSV-mappning, validering, förhandsgranskning, dubblettskontroll samt full dataexport vid systembyte.
- **Säkerhet:** Supabase/PostgreSQL-datamodell med separerade organisationer och backendbehörighet/RLS, skyddade bilagor, säker backup/återställning, revisionshistorik och konfliktsäkra samtidiga ändringar.

### Data- och integrationsprinciper

- Åtgärdsmall, planerat åtgärdstillfälle och faktisk utförd åtgärd är **olika** entiteter. Samma kostnad får inte räknas två gånger.
- Redigering av dagens prisantagande får **inte** skriva om låst budget eller historiskt faktiskt utfall.
- Upprätta relationer till befintlig CRM-fastighet, byggnad/objekt (där relevant), kund/organisation, dokument, arbetsorder och eventuellt projekt. Behörigheter måste följa CRM:s serverkontroller och organisationsgränser.
- Förslagna branschschabloner och teknisk livslängd ska märkas som antaganden med källa eller grund; aldrig som säkra belopp eller automatiska byteskrav.
- Funktionalitet ska vara riktig och beständig över omstart och flera användare. Ingen demodata i verkliga beräkningar.

### Genomförandeordning (framtida – **inte** nuvarande uppgift)

1. **Datamodell och grund:** fastighet–byggnad–komponent, behörigheter, normaliserad databasmigrering, säker inventeringsregistrering.
2. **Underhållsplan:** åtgärder, livslängd/intervall, status, prioritet, grundkalkyl, säker årsplanering och oföränderlig historik.
3. **Ekonomi:** årsbudget, prisbasår/index, scenarier, budgetversioner, prognos och faktiskt utfall.
4. **Uppföljning:** återkommande åtgärder, årsöversyn, uppdaterad risk och skick, avslutsflöden och koppling till CRM-arbetsorder.
5. **Presentation och rapportering:** dashboard, diagram, filtrering, export till PDF/Excel och mobiloptimering.

**Definition av klart:** verifierade tester mot riktig STAGING-databas med flera fastigheter/organisationer, rättigheter, historik, årsrullning, scenario-/budgetberäkning, import/export, och att osparade eller samtidiga ändringar inte orsakar dataförlust.

### Releasegräns och masterplanplacering

Detta är **framtida produktutveckling**, inte en blockerare för pågående R6/R9B-STAGING-rättning. Ingen SQL, frontend, Edge Function eller LIVE-ändring ska göras för underhållsplanen nu. Detta tillägg är additivt till den befintliga huvudmasterplanen, utan att byta ut annan backlog eller påbörja utveckling.

---

## Fullständig originalkravspecifikation från användaren (bevarad)

Följande är den ursprungliga, detaljerade specifikationen. Alla dess krav ska finnas kvar vid framtida design. Där originalet beskriver en separat webbapplikation avses i VIFT-kontexten en integrerad modul i CRM, såvida inte ett senare uttryckligt produktbeslut anger annat.

Bygg en professionell, komplett och långsiktigt användbar webbapplikation för tekniska underhållsplaner inom svensk fastighetsförvaltning.

Applikationen ska fungera som ett levande besluts- och förvaltningssystem för fastighetsägare, fastighetsförvaltare, tekniska förvaltare och bostadsrättsföreningar.

ÖVERGRIPANDE MÅL
Systemet ska kunna:
- Inventera fastigheter och deras byggnadsdelar.
- Skapa realistiska och ekonomiskt förankrade underhållsplaner för 10–50 år.
- Prioritera underhåll efter skick, risk, ekonomi och verksamhetspåverkan.
- Hantera både planerat och akut uppkommet underhåll.
- Följa planerade, beslutade, pågående, uppskjutna och genomförda åtgärder.
- Dokumentera verklig kostnad, utförare, datum och resultat.
- Beräkna nästa underhållstillfälle när åtgärder genomförs.
- Behålla historik, tidigare prognoser och beslutsunderlag.
- Följa underhållsskuld, budgetavvikelser och framtida investeringsbehov.
- Fungera på riktigt år efter år, inte enbart som en snygg prototyp.

1. ANVÄNDARUPPLEVELSE OCH DESIGN
Skapa en modern, stilren och mycket lättnavigerad applikation som känns som ett professionellt förvaltningssystem.

Design:
- Svenskt gränssnitt.
- Desktop-first men fullt responsivt för mobil och surfplatta.
- Tydlig navigering mellan fastigheter, underhållsplan, ekonomi, historik och rapporter.
- Professionell dashboard med nyckeltal och diagram.
- Ljusa neutrala färger och tydliga statusmarkeringar.
- Snygga, redigerbara tabeller med filtrering, sortering och sökning.
- Få klick för att registrera eller uppdatera en åtgärd.
- Tydliga knappar för att spara, ändra, avsluta och exportera.
- Alla belopp i SEK och datum i svenskt format.
- Ingen överdriven användning av animationer.

2. FASTIGHETSREGISTER
Användaren ska kunna skapa och hantera obegränsat antal fastigheter.

Information per fastighet:
- Fastighetsnamn
- Fastighetsbeteckning
- Adress
- Fastighetsägare
- Förvaltare
- Byggår och större ombyggnadsår
- Fastighetstyp
- Antal byggnader
- Antal lägenheter
- Antal lokaler
- BOA, LOA, BTA och Atemp där uppgifter finns
- Tomtarea
- Teknisk beskrivning
- Bilder, ritningar och dokument
- Egna anteckningar

Stöd hierarkin:
Fastighetsbestånd → Fastighet → Byggnad → Byggnadsdel/Installation → Komponent → Underhållsåtgärd.

En fastighet kan innehålla flera byggnader. En byggnad kan innehålla flera komponenter av samma typ, exempelvis fem ventilationsaggregat med olika ålder och skick.

3. BYGGNADSDELAR OCH KOMPONENTREGISTER
Skapa ett strukturerat register med standardkategorier:

- Tak och taksäkerhet
- Fasad och balkonger
- Fönster och dörrar
- Grund och dränering
- Trapphus och gemensamma utrymmen
- Ytskikt
- Värmesystem
- Fjärrvärmecentral och värmeväxlare
- Pumpar, ventiler och expansionskärl
- Vatten och avlopp
- VVC-system
- Ventilation och aggregat
- Styr- och reglerteknik/DUC
- Elinstallationer
- Belysning
- Hissar
- Brand- och säkerhetsinstallationer
- Markanläggningar
- Parkeringsytor och garage
- Utemiljö, planteringar och träd
- Övrigt

Det ska vara möjligt att skapa egna kategorier, komponenttyper och åtgärder.

Varje komponent ska ha:
- Unikt ID
- Placering och tillhörande byggnad
- Fabrikat/modell när relevant
- Installationsår
- Senaste större underhåll
- Bedömd teknisk livslängd
- Bedömt underhållsintervall
- Mängd och enhet (m², m, st, löpmeter osv.)
- Skick och riskbedömning
- Foton
- Besiktningsprotokoll
- Historiska åtgärder
- Framtida åtgärder

Standardvärden för teknisk livslängd får finnas som redigerbara förslag, men får aldrig presenteras som säkra fakta. En teknisk livslängd ska inte automatiskt innebära att en komponent måste bytas.

4. INVENTERING OCH SKICKBEDÖMNING
Skapa ett inventeringsflöde där förvaltaren kan gå igenom en fastighet på plats.

För varje komponent:
- Skick: 1–5 enligt tydligt definierad skala.
- Bedömd återstående livslängd.
- Identifierade brister.
- Konsekvens vid utebliven åtgärd.
- Fotodokumentation.
- Datum för inventering.
- Inventerande person.
- Rekommenderad åtgärd.
- Osäkerhet i bedömningen.

Det ska gå att registrera en ny inventering utan att tidigare inventeringsresultat skrivs över.

Systemet ska tydligt skilja på verifierat skick, uppskattat skick och okänt skick.

5. UNDERHÅLLSPLANERING
Detta är systemets viktigaste funktion.

Varje underhållsåtgärd ska innehålla:
- Rubrik och beskrivning
- Fastighet och byggnadsdel
- Kopplad komponent
- Åtgärdstyp
- Planerat år
- Tidigaste respektive senaste rekommenderade år
- Prioritet
- Skick och risk
- Mängd och enhet
- Enhetspris
- Övriga kostnadsposter
- Planerad totalkostnad
- Prisnivå/basår
- Eventuell årlig prisuppräkning
- Ansvarig
- Status
- Kommentar och beslutsmotivering
- Bilagor
- Genomförandedatum
- Verklig kostnad
- Entreprenör
- Nästa rekommenderade underhållstillfälle

Stöd både engångsåtgärder och återkommande åtgärder.

Återkommande åtgärder ska kunna planeras baserat på installationsår eller senast utförd åtgärd, beroende på åtgärdens karaktär.

VIKTIG LOGIK:
- Att skjuta upp en åtgärd ska inte räknas som att den är utförd.
- Att genomföra en åtgärd ska kunna skapa eller uppdatera nästa planerade tillfälle.
- En utförd åtgärd ska aldrig försvinna ur historiken.
- En tidigare budget ska kunna jämföras med faktiskt utfall.
- Systemet får aldrig skapa dubbla åtgärder vid omplanering eller årsövergång.
- En komponent får ha olika intervall för exempelvis tillsyn, reparation, målning och utbyte.
- En ersatt komponent ska få nytt installationsår och nya planeringsförutsättningar.
- Systemet ska kunna skilja på helrenovering, delåtgärd och löpande reparation.

Exempel:
En fasad målades 2018 och har ett bedömt intervall på 18 år. Nästa målning föreslås 2036. Om åtgärden faktiskt utförs 2037 ska detta dokumenteras, faktisk kostnad sparas och nästa föreslagna målning beräknas utifrån 2037 och det intervall som då gäller.

6. EKONOMISK PLANERING OCH KALKYLER
Skapa en fullständig ekonomidel.

Kostnadsberäkning:
Mängd × à-pris + etablering + projektering + övriga kostnader + eventuell reserv.

Samtliga kostnadsposter ska kunna redigeras, granskas och dokumenteras.

Visa:
- Planerat underhåll per år
- Prognostiserat underhåll 10, 20, 30 och 50 år
- Underhåll per kategori
- Underhåll per fastighet
- Underhåll per m², med angiven areatyp
- Budget kontra prognos
- Budget kontra faktiskt utfall
- Ackumulerat underhållsbehov
- Kostnader för uppskjutna åtgärder
- Ekonomiskt behov kommande 1, 3, 5 och 10 år

Stöd:
- Prisbasår
- Årlig kostnadsuppräkning, valbar per kategori
- Kostnader i fasta och löpande priser
- Separata budgetar per år och fastighet
- Investeringsutgifter respektive löpande underhållskostnader
- Moms inklusive/exklusive, med tydlig hantering utan att förutsätta avdragsrätt
- Möjlig medfinansiering
- Flera kalkylscenarier

Förändringar av dagens prisantaganden får inte förändra historiska faktiska kostnader eller tidigare låsta budgetversioner.

Visa tydligt om en kostnad är kalkylerad, offererad, beslutad eller faktiskt utfall.

Använd aldrig påhittade marknadspriser som säkra belopp. Schabloner får användas om de är märkta som antaganden med källa eller angiven grund.

7. PRIORITERING OCH RISKBEDÖMNING
Bygg ett system där åtgärder kan prioriteras utifrån:
- Teknisk status
- Risk för följdskador
- Säkerhet och myndighetskrav
- Ekonomisk konsekvens
- Risk för driftstopp
- Påverkan på hyresgäster
- Kvarvarande livslängd
- Möjlighet att samordna med andra arbeten

Skapa prioriteringsnivåerna:
1. Akut
2. Hög
3. Normal
4. Låg

Systemet ska kunna föreslå prioritet, men förvaltaren ska alltid kunna justera den med en motivering.

En låg prioritet får inte automatiskt användas enbart för att åtgärden är dyr.

8. ARBETSFLÖDE OCH STATUS
Varje åtgärd ska kunna följa processen:

Identifierad → Planerad → Budgeterad → Beslutad → Beställd → Pågående → Genomförd → Slutkontrollerad.

Dessutom:
- Uppskjuten
- Avbruten
- Ersatt av annan åtgärd

Alla statusförändringar ska loggas med tidpunkt och användare.

Möjlighet att:
- Tilldela ansvarig.
- Lägga in förfallodatum.
- Bifoga offerter och fakturor.
- Registrera faktiskt start- och slutdatum.
- Kommentera avvikelser.
- Genomföra delåtgärder utan att felaktigt avsluta hela projektet.
- Koppla samman relaterade underhållsåtgärder.

9. ÅRLIG UPPFÖLJNING
Systemet ska stödja en tydlig årsprocess.

Vid varje nytt år ska förvaltaren kunna:
- Granska föregående års planerade åtgärder.
- Se vilka som genomförts.
- Se vilka som kvarstår.
- Granska budgetavvikelser.
- Dokumentera orsaker till förseningar.
- Uppdatera skick och risk.
- Omplanera kommande åtgärder.
- Fastställa en ny årlig underhållsbudget.
- Spara en låst version av underhållsplanen för året.

Historiska planer ska vara läsbara och jämförbara.

Skapa möjlighet att jämföra exempelvis planen för 2027 med den uppdaterade planen för 2028 och se varför prognosen har förändrats.

10. UNDERHÅLLSSKULD OCH SCENARIER
Visa förfallna eller uppskjutna underhållsåtgärder och deras bedömda kostnad.

Använd inte ordet underhållsskuld som om alla framtida planerade kostnader redan vore en skuld.

Skapa minst tre scenarier:
- Basplan: tekniskt och ekonomiskt rimligt underhåll.
- Begränsad budget: vilka åtgärder kan skjutas upp och vilka risker uppstår?
- Förstärkt underhåll: vilka förbättringar och riskreduceringar kan uppnås?

Scenarier ska inte automatiskt ändra den beslutade huvudplanen.

11. DASHBOARD OCH VISUALISERINGAR
Startsidan ska ge en tydlig översikt över hela beståndet.

Nyckeltal:
- Antal fastigheter
- Totalt planerat underhåll kommande fem år
- Årets budget
- Årets prognos
- Årets faktiskt utfall
- Antal förfallna åtgärder
- Antal akuta/högt prioriterade åtgärder
- Andel genomförda planerade åtgärder
- Kostnad per m² där relevant

Diagram:
- Stapeldiagram över underhållskostnader per år.
- Fördelning per byggnadsdel.
- Kostnader per fastighet.
- Budget mot prognos och utfall.
- Förfallna åtgärder över tid.

Skapa även en tidslinje/Gantt-liknande vy för framtida arbeten.

Diagram och nyckeltal ska beräknas från sparade data och inte innehålla hårdkodade demonstrationsvärden.

12. RAPPORTER OCH EXPORT
Bygg en rapportmodul för:
- Komplett underhållsplan 10–50 år
- Årlig underhållsbudget
- Femårsplan
- Åtgärdslista per fastighet
- Genomförda åtgärder
- Budgetavvikelser
- Risk- och prioriteringsrapport
- Inventeringsprotokoll
- Ekonomisk sammanställning för hela beståndet

Export till Excel och PDF.

Rapporter ska ha professionell layout, tydlig tabellstruktur, datum, fastighet, kostnadsnivå och vilken planversion underlaget kommer från.

Användaren ska kunna exportera både en sammanfattande rapport för en styrelse eller ledning och en detaljerad arbetsrapport för teknisk förvaltning.

13. IMPORT OCH DATAHANTERING
Stöd import från Excel/CSV med möjlighet att mappa kolumner.

Importen ska:
- Visa förhandsgranskning.
- Validera obligatoriska fält.
- Upptäcka möjliga dubbletter.
- Redovisa felaktiga rader.
- Inte skriva över befintliga data utan godkännande.

Stöd export av samtliga fastighetsdata för framtida migrering.

14. ANVÄNDARE OCH SÄKERHET
Bygg för flera användare och flera organisationer.

Roller:
- Systemadministratör
- Organisationsadministratör
- Förvaltare
- Tekniker
- Ekonomi/läsbehörighet
- Extern användare med begränsad åtkomst

Säkerställ:
- Säker inloggning.
- Dataseparering mellan organisationer.
- Behörighetskontroll i backend.
- Row Level Security vid användning av Supabase.
- Ingen offentlig åtkomst till skyddade fastighetsuppgifter.
- Inga hemliga nycklar i frontend.
- Ändringshistorik på viktiga objekt.
- Säker hantering av uppladdade dokument.
- Möjlighet till återställning och backup enligt faktisk driftmiljö.

15. TEKNISK ARKITEKTUR
Använd en robust databasbaserad lösning, exempelvis React/TypeScript med Supabase och PostgreSQL.

Skapa normaliserade databastabeller för minst:
- Organisationer
- Användare och behörigheter
- Fastigheter
- Byggnader
- Komponenter
- Inventeringar
- Skickbedömningar
- Åtgärdsdefinitioner
- Planerade åtgärdstillfällen
- Utförda åtgärder
- Kostnadsberäkningar
- Budgetar
- Budgetversioner
- Scenarier
- Dokument
- Ändringslogg

Skilj på åtgärdsmallar, framtida åtgärdstillfällen och faktiskt genomförda arbeten för att undvika felaktiga kostnadssummeringar och dubbletter.

Databasen måste bevara tidigare information och klara långsiktig användning.

16. REALISM OCH DEMODATA
Skapa en realistisk demonstrationsfastighet, exempelvis ett svenskt flerbostadshus byggt 1975 med 40 lägenheter, fjärrvärme, ventilation, tak, fasad, markytor och övriga installationer.

Visa ett komplett exempel med åtgärder över 30 år, olika prioriteringar och kostnader.

Alla demouppgifter ska märkas DEMODATA och ska kunna tas bort utan att systemets struktur påverkas.

17. GENOMFÖRANDE OCH KVALITETSSÄKRING
Bygg systemet i kontrollerade etapper:

ETAPP 1 – Grunden:
Inloggning, fastighetsregister, byggnadshierarki, komponenter, databas och behörigheter.

ETAPP 2 – Underhållsplanen:
Åtgärder, intervall, planerade år, kostnadsberäkning, status och historik.

ETAPP 3 – Ekonomi:
Årsbudget, kostnadsprognoser, budgetavvikelser, indexering och scenariohantering.

ETAPP 4 – Uppföljning:
Inventering, faktisk kostnad, återkommande åtgärder, årsrullning och låsta planversioner.

ETAPP 5 – Presentation och rapportering:
Dashboard, diagram, export, rapporter och förbättrat mobilgränssnitt.

För varje etapp:
- Implementera riktiga databasoperationer.
- Säkerställ att funktionerna fungerar även efter siduppdatering.
- Testa behörigheter, ändringar och historik.
- Undvik knappar som inte gör någonting.
- Skapa inte fejkade integrationer eller beräkningar.
- Dokumentera eventuella begränsningar.

Testa särskilt:
1. Att ett genomfört arbete behåller sitt faktiska datum och sin verkliga kostnad.
2. Att ett återkommande arbete får rätt nästa underhållsdatum.
3. Att en uppskjuten åtgärd ligger kvar som ej genomförd.
4. Att tidigare låsta budgetar inte förändras.
5. Att samma åtgärd inte räknas dubbelt i prognoser.
6. Att flera fastigheter kan hanteras separat och tillsammans.
7. Att användare inte kan läsa andra organisationers skyddade data.
8. Att PDF- och Excel-exporter motsvarar informationen i systemet.

VIKTIGT:
Prioritera korrekt funktionalitet, datakvalitet, ekonomisk logik och långsiktig hållbarhet framför mängden funktioner.

Jag vill inte ha en enkel klickbar prototyp eller en statisk årslista. Jag vill ha en riktig, användbar underhållsplaneringsapplikation som en professionell fastighetsförvaltare kan arbeta i under många år.

Börja med att presentera datamodell, huvudflöden och en konkret implementeringsordning. Bygg därefter den första fungerande etappen, verifiera den och fortsätt stegvis. Alla övriga funktioner ska finnas kvar i den övergripande utvecklingsplanen.
