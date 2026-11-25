# VIFT CRM – beslutsunderlag för behörigheter (B1–B5 och övriga frågor)

2026-11-26. Underlaget beskriver läget i STAGING. Ingen regel är ändrad. LIVE har inget av C-5-skyddet, och där kan alla aktiva användare läsa alla nycklar.

## Roller som underlaget utgår från

| Roll (exempel i STAGING) | Behörigheter | Typisk användare |
|---|---|---|
| Administratör | `all` | Ledning, systemansvarig |
| Arbetsledare | ao_view_all, ao_create/edit/complete, ao_time/material/checklist, customer_manage, offer_manage, sales_manage, staff_view | Arbetsledare/säljare |
| Ekonomi | invoice_view/create, ao_view_all, reports_view | Ekonomi/fakturering |
| Fält | ao_view_own, ao_time, ao_material, ao_checklist, ao_complete | Fastighetsskötare |
| Begränsad | ao_view_own | Inhyrd/extern |

## Grundprincip: så får fältpersonalen det de behöver utan att se mer

1. **Servern bestämmer vad som lämnas ut.** Klienten döljer bara, och skyddar därför inget. Varje nyckel eller post skickas till rollen i projicerad form (C-5-mönstret: `vift_store_project`). Fält som rollen inte ska se finns då aldrig i webbläsaren.
2. **Smala serveråtgärder i stället för breda läs- och skrivrättigheter.**
   - Fältet behöver inte läsa prislistor. Det räcker att servern tar emot "artikel X, antal 2" och själv räknar fram pris, moms och inköpspris (mönstret i `ao-time-write`).
   - Fältet behöver inte läsa alla portkoder. Det räcker att servern lämnar ut portkoden till *tilldelad* personal för *den AO:n*, och loggar uttaget (finns: `get-sensitive-fields` + `sensitive_access_audit`).
3. **Urval per tilldelning.** Fältpersonal ser sina egna och delade pool-AO. Det finns redan i `work-orders-list` och `time-entries-list`. Samma urval används för aktivitetslogg och bilder.
4. **Skrivare får hela posten bara om skrivningen kräver det.** Med fältvis sammanslagning på servern (B5) kan även skrivare få en projicerad post, utan risk att dolda fält skrivs över.

---

## B1 – Inköpspriser (artiklar)

| | |
|---|---|
| **Nu** | `vift_articles` (med `buyPrice`) kan läsas av alla aktiva användare. Fältets materialdialog visar "Ink: … kr" och har fältet "Ink-pris". AO-detaljens ekonomi räknar täckning från inköpspris. |
| **Risk** | Fältpersonal och externa kan se marginaler. Affärskänsligt, men inga personuppgifter. |
| **Rekommendation** | Projicera `vift_articles` utan `buyPrice` för roller utan `article_manage`/`invoice_*`/`reports_view`/`ao_edit`. Materialdialogen för fält visar då artikel, enhet och försäljningspris, och servern (`ao-time-write`) slår själv upp inköpspriset från artikel-id. |
| **Konsekvens per roll** | **Admin/ekonomi/arbetsledare:** oförändrat. **Fält:** ser inte inköpspris och kan inte sätta ett eget. Material utan artikel (fritext) får servern sätta till 0 eller kräva godkännande, vilket kräver beslut. **Begränsad:** ingen materialåtkomst. |
| **Insats** | Medel: projektion i databasregeln, ändring i `ao-time-write` för materialpris och ändrad materialdialog. Kräver test och rollback. |

## B2 – Timpriser (prisgrupper)

| | |
|---|---|
| **Nu** | `vift_priceGroups.hourRate` kan läsas av alla. Varje tidpost bär prisgruppens timpris. |
| **Risk** | Låg. Det är försäljningspriser som också står i offerter till kund. |
| **Rekommendation** | **Behåll som i dag.** Den interna timkostnaden (`internalHourlyCost`) är redan dold för roller utan ekonomiläsning. |
| **Konsekvens** | Ingen. |

## B3 – Personalregistret

| | |
|---|---|
| **Nu** | `vift_staff` (namn, e-post, telefon, roll, titel, behörigheter) kan läsas av alla aktiva. Skrivning bara admin. Ingen lön, inget personnummer. |
| **Risk** | Låg till medel. Kollegors kontaktuppgifter syns, och även behörighetslistan. |
| **Rekommendation** | Behåll läsning av namn, titel och kontakt för alla aktiva, eftersom de behövs för tilldelning, kontakt och listor. Projicera bort `permissions` och `email` för roller utan `staff_view`. Lägg aldrig lön, personnummer eller bankkonto i `vift_staff`. Behövs lönedata: egen tabell med egen RLS (se Löneunderlag). |
| **Konsekvens per roll** | **Fält/begränsad:** ser namn och telefon, inte behörigheter. **Övriga:** oförändrat. |
| **Insats** | Liten. En projektion i databasregeln. |

## B4 – Aktivitetsloggen

| | |
|---|---|
| **Nu** | `vift_activityLog` (179 poster) kan läsas av alla aktiva. Beskrivningarna nämner kunder, AO, offerter, fakturor och ibland belopp. |
| **Risk** | Medel. Fältpersonal kan läsa vad som händer i hela verksamheten, till exempel fakturor och offerter. |
| **Rekommendation** | Full läsning för `ao_view_all`, `customer_manage`, `reports_view` och `admin_manage`. Fält och begränsad ser bara poster om AO de är tilldelade, enligt samma urval som `work-orders-list`. Posterna skrivs redan via `store-key-write` (GO-6), så bara läsningen behöver ändras. |
| **Konsekvens per roll** | **Fält:** AO-detaljens historik fungerar som nu. Dashboardens "Senaste händelser" visar bara egna AO. |
| **Insats** | Medel. Projektion per post på servern plus test per roll. |

## B5 – Portkoder och nyckelinformation för skrivare utan `objects_sensitive`

| | |
|---|---|
| **Nu** | Läsare utan `objects_sensitive` får objekten utan `doorCode`/`keyInformation`/`accessInformation` och AO utan `accessCode`. Skrivare (`customer_manage`, `recurring_manage`, `ao_edit`) får hela posten, men klienten döljer fälten. Annars skulle en skrivning utan fälten radera dem. |
| **Risk** | Medel. En arbetsledare utan `objects_sensitive` kan läsa portkoder via webbläsarens verktyg. |
| **Rekommendation** | **Fältvis sammanslagning i `store-key-write`:** när en roll utan läsrätt skriver en post behåller servern de dolda fälten från den lagrade posten. Därefter kan även skrivare få projicerade poster. Portkod till fält går fortsatt via `get-sensitive-fields` för tilldelad AO, med revisionslogg. |
| **Konsekvens per roll** | **Arbetsledare utan `objects_sensitive`:** ser inte portkoder alls. **Fält:** ser portkod bara för egna AO, och varje uttag loggas. **Admin:** oförändrat. |
| **Insats** | Störst. Ändrad skrivväg för register: konsekvensanalys, backup, rollback och full regressionskörning. |

**Rekommenderad ordning:**
1. B2 (inget att göra).
2. B3.
3. B4.
4. B1.
5. B5.

B3 och B4 är små och avgränsade. B1 och B5 ändrar skrivvägar och bör göras i samma serveromgång med full testning.

---

## Övriga öppna behörighetsfrågor

| Nr | Fråga | Läge nu | Rekommendation |
|---|---|---|---|
| Ö1 | "Starta arbete" i AO-detaljen för tilldelad fältarbetare | Infört i v3.4, samma villkor och serveranrop som Mina jobb. Ingen ny behörighet. | Bekräfta, eller ta bort (en rad, `_canStartOwn`). |
| Ö2 | Fältrollen och `ao_complete` | STAGING:s testfältroll har den. Standardrollen `personal` (som nya personalposter får) finns inte i STAGING:s rollregister. | Definiera standardrollerna (personal, arbetsledare, ekonomi) i både STAGING och LIVE. Besluta om fält får klarmarkera. |
| Ö3 | Fältrollen och rondering | Ronderingssidorna kräver `ao_view_all`, som fältet saknar. Fält kan alltså inte utföra rondering. | Ny smal behörighet `rondering_utfor` (utföra tilldelade pass) i stället för `ao_view_all`. |
| Ö4 | Timpris i fältets egna tidposter och i stämpla-ut-dialogen | Fältet ser det. | Dölj i klienten och projicera bort `hourRate` i `time-entries-list` för fält (B1-omgången). |
| Ö5 | Personal: inaktivera sig själv eller sista superadmin | Inget skydd. | Serverregel: neka om det leder till 0 aktiva med `all`. Se problemlistan. |
| Ö6 | PERM-03 / BLOCKER-2: skrivbehörighet per nyckel för generiska nycklar | Kan inte verifieras i den simulerade servern. Generiska nycklar skyddas av RLS-mönster på STAGING. | Riktigt test mot STAGING per roll och nyckel (läsande och skrivande med återställning) innan LIVE. |
| Ö7 | Uppgifter (`vift_activities`) | Läses av alla och skrivs via `store-key-write`. Per-post-regeln är oförändrad. | Samma urval som B4: fält ser egna och tilldelade. |
| Ö8 | Admin → "Rensa lokal cache" och push-diagnostik | Kräver `admin_manage`, varnar för osynkade ändringar och visar inga nycklar. | Klart, inget beslut behövs. |
| Ö9 | E2E-konton och testroller (`e2e_*`, `v7_sakerhetstest`, `qa_p2_avgransad`) | Finns i STAGING. | Avveckla när testuppdraget är slut. Får aldrig följa med till LIVE. |
| Ö10 | LIVE | Inget av skydden ovan finns i LIVE. | Del av LIVE-planen: C-5, time-entries-list, store-key-write v5 m.fl. |
