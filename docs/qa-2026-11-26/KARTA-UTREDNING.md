# Dashboardkartan: varför jobb inte placeras (2026-11-26)

Källa:
- SQL-läsning mot STAGING `public.store` (endast läsning);
- kodgranskning av `Dashboard._initOpsMap` och `AddressService`.

LIVE är inte läst.

## Fakta i riktig STAGING

| Mått | Antal |
|---|---|
| Aktiva jobb (nytt, pool, planerad, pågående, ej arkiverade) | 205 |
| Med sparade koordinater (lat/lng) | **0** |
| Egen adress med postnummer eller ort | 190 |
| Egen adress utan ort | 1 |
| Saknar egen adress, och ingen kopplad fastighet med ort | 14 |
| Därav QA-LOAD-poster (inlagda utan geokodning) | 179 |

## Hur kartan placerar jobb

1. **Sparade koordinater används direkt.** De skrivs när en AO sparas, via `WorkOrderService.geocodeAddressIfNeeded`.
2. **Annars geokodas adressen i webbläsaren** mot Mapbox:
   - högst 20 nya anrop per visning (`MAX_LOOKUPS`);
   - cachen ligger i minnet och nollställs när sidan laddas om;
   - utan ortskontext görs ingen träff, hellre ingen nål än fel stad.
3. **Allt som inte placeras räknas i dag ihop** som "kunde inte placeras", även nätverks- och behörighetsfel.

## Orsaker, åtskilda

| Orsak | Bedömning |
|---|---|
| **Saknade koordinater** | **Bekräftat:** 0/205. Testdata har lagts in direkt utan geokodning. |
| **Gräns 20 per visning** | **Bekräftat i kod.** Även när geokodningen fungerar kan högst cirka 20 äldre jobb placeras per sidvisning. |
| **Mapbox nekar anrop från staging-domänen** | **Troligt, ej verifierat.** Skärmbilden visade cirka 206 av 206 oplacerade, alltså misslyckades även de första 20 som nästan alla har ortskontext. `config.js` anger att token ska begränsas till crm.viftfast.se. `api.mapbox.com` är blockerat i testmiljön, så det går inte att prova härifrån. |
| **Felaktiga eller saknade adresser** | **Bekräftat för 15 jobb:** 1 utan ort, 14 utan adress. |
| **Fel i kartkomponenten** | **Inget tecken på det.** Om Mapbox GL inte laddas visas "Kartan kunde inte laddas", inte en räknare. |

## Kontroll som behöver göras i webbläsare

Öppna STAGING-dashboarden och välj DevTools → Network → filtrera på `api.mapbox.com`.
- Svarar `geocoding/v5` eller stilen med 401/403: token är domänbegränsad.
- **Åtgärd:** lägg till `https://staging-crm.viftfast.se` bland tillåtna adresser för token i Mapbox-kontot, eller använd en separat STAGING-token i STAGING-paketets `config.js`. Det är en kontoinställning som Lucas beslutar om, ingen kodändring.

## Förslag (kräver separat beslut, inte utfört)

- **Engångsgeokodning av befintliga jobb och fastigheter med kontrollerad skrivning av koordinater.** Då behöver kartan inte geokoda i webbläsaren vid varje visning.
  - Det är en dataändring i STAGING och, senare, LIVE.
  - Görs med backup och journal.
  - Görs inte på testdata som ändå bör rensas.
- **Kartans räknare och tomläge visar orsakerna separat:**
  - placerade;
  - ej geokodade än;
  - geokodning nekad/misslyckad;
  - adress utan ort;
  - saknar adress.

  Det ingår i dashboardarbetet i den här körningen.
