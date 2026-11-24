# Del 10 – Åtkomst till känsliga uppgifter i STAGING (2026-11-26)

**Källor:**
- RLS-policyer på `public.store`;
- regelfunktionerna från C-5;
- Edge Functions i STAGING;
- fältinventering via SQL-läsning (endast fältnamn, inga värden).

**Avgränsning:**
- Inga regler har ändrats i den här körningen.
- LIVE är inte läst.

## Sammanställning

| Uppgift | Var den finns | Vem kan läsa den i STAGING | Bedömning |
|---|---|---|---|
| **Inköpspriser** | `vift_articles[].buyPrice` | Alla aktiva användare | **Beslutspunkt B1** |
| **Timpriser (försäljning)** | `vift_priceGroups[].hourRate`; kopieras till `timeEntries[].hourRate` | Prisgrupper: alla. Tidposter: se nedan. | Försäljningspriser står även på offerter till kund. Låg känslighet. **Beslutspunkt B2** |
| **Intern timkostnad, bankgiro** | `vift_settings` | Full läsning: `admin_manage`, `invoice_*`, `reports_view`, `offer_manage`, `ao_view_all`, `ao_edit`. Övriga får värdet utan fälten. | Åtgärdat (C-5) |
| **Fakturaunderlag** | `vift_invoices` | `invoice_*`, `reports_view`, `ao_view_all`, `ao_edit`. Fält och begränsad roll: inget. Skrivning bara via EF. | Åtgärdat (C-5) |
| **Personnummer, org.nr för privatpersoner** | `vift_customers` | Full läsning för kundrelaterade roller. Övriga får inte fälten. | Åtgärdat (C-5) |
| **Personalregister** | `vift_staff`: namn, e-post, telefon, roll, titel, behörigheter. **Ingen lön, inget personnummer.** | Alla aktiva. Skrivning bara admin. | Kontaktuppgifter till kollegor behövs för tilldelning och kontakt. **Beslutspunkt B3** |
| **Tidposter (lönegrund)** | `vift_timeEntries` | Ingen direktläsning (RLS). `time-entries-list`: `payroll_view`/`all` ser alla, övriga **bara sina egna**. | Åtgärdat (tidigare BLOCKER-1) |
| **Aktivitetslogg** | `vift_activityLog`: typ, beskrivning, användar-id, kopplingar till kund, AO, offert, faktura m.m. | Alla aktiva | Beskrivningarna kan nämna kund och belopp. **Beslutspunkt B4** |
| **Portkoder, nyckelinformation** | `vift_propertyObjects` (`doorCode`, `keyInformation`, `accessInformation`), AO `accessCode`, `vift_recurringOrders.accessCode`; dessutom separat tabell `property_sensitive_access` via `get-/set-sensitive-fields` | Full läsning: `objects_sensitive` och skrivare (`customer_manage`, `recurring_manage`). AO-portkod bara till `objects_sensitive`/`ao_edit`. Övriga får inte fälten. | Åtgärdat, med en kvarstående avvägning: skrivare utan `objects_sensitive` ser fälten i data, men klienten döljer dem. Fullständig lösning kräver fältvis sammanslagning på servern. **Beslutspunkt B5** |
| **Offerttoken** | `vift_offers[].publicToken`/`token*` | Bara `offer_manage`. Övriga får offerten utan token och interna fält. | Åtgärdat (C-5). Kunden använder token via `offer-token-validate`/`offer-respond`. |
| **Export** | Exportcenter | Enligt CLAUDE.md får export aldrig automatiskt ta med portkoder, nyckelinfo eller lösenord | Kontrolleras i paketets regression (se slutrapporten) |

## Beslutspunkter (kräver ditt beslut, inget är ändrat)

| Nr | Fråga | Rekommendation | Konsekvens |
|---|---|---|---|
| B1 | Ska fältpersonal kunna läsa inköpspriser? | Nej. Servern räknar materialets försäljningspris. Fält får artikel, enhet och försäljningspris, inte `buyPrice`. | Kräver projektion av `vift_articles` för roller utan `article_manage`/`invoice_*`/`reports_view`, samt att fältets materialformulär inte behöver `buyPrice`. Det används i dag som underlag och behöver ses över. Medelstor ändring med test och rollback. |
| B2 | Är prisgruppernas timpriser känsliga? | Nej, låt dem vara läsbara. Det är försäljningspriser som också står i offerter. | Ingen ändring. |
| B3 | Personalregistret | Behåll läsning för alla aktiva. Lägg aldrig lön, personnummer eller bankkonto i `vift_staff`. Om lön behövs: egen tabell med egen RLS. | Ingen ändring nu. |
| B4 | Aktivitetsloggen | Begränsa till interna roller (`ao_view_all`, `customer_manage`, `reports_view`, `admin_manage`). Fält ser bara händelser för egna AO. | Kräver projektion per rad, motsvarande `work-orders-list`. Medelstor ändring. |
| B5 | Portkoder för skrivare utan `objects_sensitive` | Fältvis sammanslagning i `store-key-write`: servern behåller dolda fält när en roll utan läsrätt skriver. | Störst ändring. Konsekvensanalys, backup och rollback krävs före införande. |

## Fynd i löneunderlaget (UI, inte behörighet)

- **Vad siffran är:** "Estimerad lönekostnad" i Löneunderlag är timmar × `timeEntry.hourRate`. Det är **prisgruppens försäljningstaxa** (392/430/595/695 kr/h), inte en lönekostnad.
- **Systemet har ingen lönedata.** Personalposter saknar lön.
- **Rättning i den här körningen:** etiketten och hjälptexten byts, beräkningen är oförändrad. Se slutrapporten.
- **Verklig lönekostnad** kräver lönedata och ett eget beslut (se B3).
