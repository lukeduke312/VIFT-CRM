# C-5 – Läsbehörighet per roll (STAGING, installerad 2026-11-25)

**Status: åtgärdad och verifierad i STAGING. Inte installerad i LIVE.**

## Hur det fungerar

Det finns en enda regelkälla i databasen:
- `vift_store_full_access(nyckel, behörigheter)` avgör om rollen får se hela värdet.
- `vift_store_project(nyckel, värde, behörigheter)` ger det redigerade värdet.

Reglerna används på tre ställen:

| Läsväg | Före | Efter |
|---|---|---|
| Direkt REST `GET /rest/v1/store` | Alla aktiva användare läste alla nycklar utom AO och tid. | Ny RESTRICTIVE-policy `store_read_by_role`: en rad lämnas bara ut om rollen har full läsrätt till nyckeln. |
| `store-key-write` `readAllWithHashes` (klientens inloggning och synk) | Fullständiga värden till alla. | Värdena projiceras per roll (`store_read_all_with_hashes_projected`). |
| `store-key-write` `readWithHash` | Fullständigt värde till alla. | Projiceras per roll. |
| `work-orders-list` | `accessCode` (portkod) till alla som såg AO:n. | `accessCode` bara till `objects_sensitive` eller `ao_edit`. |

**Grundregel:** `all` och den som har *skrivbehörighet* för en nyckel får alltid hela värdet. Annars skulle klienten skriva tillbaka element där fält saknas (t.ex. portkoder), och konfliktkontrollen skulle stoppa all redigering. Redigering sker bara för roller som enbart läser nyckeln.

## Karta: nyckel → vem som får vad

| Nyckel | Hela värdet | Redigerat värde | Ingenting (tomt) |
|---|---|---|---|
| `vift_offers` | `offer_manage` | Interna roller (`customer_manage`, `sales_manage`, `invoice_*`, `reports_view`, `ao_view_all`, `ao_edit`, `ao_create`). Tas bort: `publicToken`, `token*`, `lockedSnapshotJSON`, `customerApproval`, `manualApproval`, `emailSentTo`, `openCount`, `openedAt`, `reminderSentAt`, `internalNote`, samt radernas `calculationNote`, `inputValues`, `priceRuleRef`. | – |
| `vift_offers`, övriga roller | – | Bara id, titel, status, kund, fastighet, AO, projekt, version, datum, borttagen/arkiverad. Inga belopp. | – |
| `vift_offerEvents`, `vift_offerAttachments` | `offer_manage` | – | Övriga |
| `vift_emailTemplates` | `offer_manage`, `admin_manage` | – | Övriga |
| `vift_invoices` | `invoice_view`, `invoice_create`, `reports_view`, `ao_view_all`, `ao_edit` | – | Övriga (fält, begränsad) |
| `vift_salesOpps` | `sales_manage`, `reports_view` | – | Övriga |
| `vift_contracts` | `customer_manage`, `invoice_*`, `reports_view` | – | Övriga |
| `vift_priceProfiles` | `article_manage`, `offer_manage`, `customer_manage`, `invoice_create`, `admin_manage`, `recurring_manage` | – | Övriga |
| `vift_importLogs` | `admin_manage` | – | Övriga |
| `vift_serviceMonitorLog` | `admin_manage`, `ao_view_all` | – | Övriga |
| `vift_settings` | `admin_manage`, `invoice_*`, `reports_view`, `offer_manage`, `ao_view_all`, `ao_edit` | Övriga: utan `internalHourlyCost` och `bankgiro` | – |
| `vift_customers` | `customer_manage`, `invoice_*`, `offer_manage`, `sales_manage`, `ao_view_all` | Övriga: utan `personnr`, och utan `orgNr` för privatpersoner | – |
| `vift_propertyObjects` | `objects_sensitive`, `customer_manage` (skrivare) | Övriga: utan `doorCode`, `keyInformation`, `accessInformation` | – |
| `vift_recurringOrders` | `objects_sensitive`, `recurring_manage` (skrivare) | Övriga: utan `accessCode` | – |
| Övriga nycklar (personal, roller, fastigheter, artiklar, prisgrupper, aktivitetslogg, `lastChanged`, `ronderingspass` …) | Alla aktiva användare (oförändrat) | – | – |

## Utfall per testroll (verifierat mot STAGING-data)

| Roll | Offerttoken | Offertrader/belopp | Fakturor | Personnummer | Portkod (objekt/AO) | Bankgiro/internt timpris | Offerthändelser |
|---|---|---|---|---|---|---|---|
| admin (`all`) | ja | ja | ja | ja | ja | ja | ja |
| arbetsledare (`e2e_arbetsledare`) | ja (har `offer_manage`) | ja | ja | ja | ja (skrivare `customer_manage`) | ja | ja |
| ekonomi | **nej** | ja | ja | ja (ROT/RUT) | **nej** | ja | **nej** |
| fält 1, fält 2 | **nej** | **nej** | **nej** | **nej** | **nej** | **nej** | **nej** |
| begränsad | **nej** | **nej** | **nej** | **nej** | **nej** | **nej** | **nej** |

## Kvarstående medvetna avvägningar

- Prislistor i artiklar (`buyPrice`) och prisgrupper (`hourRate`) är fortfarande läsbara för alla. Fältpersonalens materialformulär använder inköpspriset. Ändringen kräver ett produktbeslut.
- Personalregistret (namn, e-post, telefon till kollegor) och aktivitetsloggen är läsbara för alla aktiva användare.
- En arbetsledare utan `objects_sensitive` men med `customer_manage` ser objektens portkoder i data, eftersom hen är skrivare. Klienten döljer dem i gränssnittet. En helt korrekt lösning kräver att servern bevarar redigerade fält vid skrivning (fältvis sammanslagning).
- AO:ns `fixedPrice` och materialpriser lämnas ut till tilldelad fältpersonal, som tidigare. Klienten döljer dem utan prisbehörighet.

## Återställning

```sql
DROP POLICY store_read_by_role ON public.store;
DROP FUNCTION public.store_read_all_with_hashes_projected(text[], text[]);
DROP FUNCTION public.vift_store_project(text, jsonb, text[]);
DROP FUNCTION public.vift_store_full_access(text, text[]);
DROP FUNCTION public.vift_caller_perms();
```

Installera sedan om:
- `store-key-write` v4 från `supabase/backup/ef-installerade-2026-11-25/store-key-write-v4/`;
- `work-orders-list` utan C-5-blocket (se README i backupkatalogen).

Inga data ändrades av C-5. Endast läsregler och funktioner påverkas.
