# VIFT CRM – bildpaket för oberoende UI/UX-granskning (2026-11-26)

**Syfte:** underlag för en oberoende granskning av gränssnittet efter nattkörningen (version v3.4, publicerad på STAGING 2026-11-25).

**Allmänt om bilderna:**
- All data är testdata i STAGING eller i en simulerad testmiljö. Den innehåller avsiktligt testposter med HTML/skript i fritext, till exempel `<img src=x onerror=…>`. De ska visas **som text**, vilket visar att XSS-skyddet fungerar.
- Den gula etiketten "STAGING · TESTMILJÖ" finns bara i testmiljön.
- Sidomenyns brun-grå färg är en egen primärfärg som administratören valt i STAGING (#6a5353), inte standardfärgen.

## Mappar

| Mapp | Innehåll | Källa |
|---|---|---|
| `1-efter-publicerad-v3.4/dator-1366` | Alla 37 vyer, dator 1366 px, admin | Publicerad STAGING v3.4, riktig STAGING-data, tagna 2026-11-25. Bara navigering, inga klick. Högst 4 000 px höga. |
| `1-efter-publicerad-v3.4/mobil-390-admin` | Alla 37 vyer, mobil 390 px, admin | Som ovan |
| `1-efter-publicerad-v3.4/mobil-390-faltroll` | De vyer fältpersonal ser (7), mobil 390 px | Som ovan, fältroll |
| `2-fore-efter-per-omrade/<område>` | Före och efter per arbetsblock. Fler bredder (360/390/768/1024/1366/1920), dialoger, formulär, statuslägen, realistiska datamängder (10/100/1 000) och mobilflöden steg för steg. | Simulerad testmiljö (lokal server, påhittad men realistisk data) |
| `3-fore-alla-vyer-v3.3-simulerad` | Alla 37 vyer före nattkörningen (v3.3), dator och 1920. Även Admins tio flikar (38–47) och dialoger på mobil (62–63). | Simulerad testmiljö 2026-11-25 |
| `4-publicerad-v3.3-fore-OBS-natfel` | Publicerad v3.3 före nattkörningen | **Varning:** testmiljöns nät avbröt slumpvis enstaka CSS-filer när bilderna togs. Felaktig layout här, till exempel ikoner på egen rad, kan bero på det och inte på systemet. Jämför helst mot mapp 3. |
| `5-tidigare-fore-efter` | Äldre före/efter (V3-omgången) | Simulerad |

### Områden i mapp 2
- `dashboard`: anpassningsläget, widgetar, kartans orsaker.
- `aolist`: AO-lista.
- `aodetail`: AO-detalj, alla statusar × roller, fältflöde.
- `billing`: faktureringskö och underlag.
- `offers`: offertdetalj och guide.
- `service`: serviceintervall.
- `register`: Kunder, Fastigheter, Artiklar, Prisgrupper, Personal, Offerttjänster, Uppgifter.
- `misc`: Fastighetskort, Objekt, Kundkort, Projekt, Kontrakt, Kalender, Rondering, Import/Export.
- `falt`: Mina jobb, Tid & stämpla, Dagens drift, Återkommande.
- `admin`: Admin, Rapporter, Löneunderlag.

**Filnamn:** `fore-*`/`efter-*`, bredd i px, och `-realistisk`/`-mycket`/`-100`/`-1000` för större datamängder.

## Alla 37 vyer och var de finns

| # | Vy | Sid-id | Status i nattkörningen | Efter, dator (mapp 1) | Efter, mobil admin | Efter, mobil fält | Före (mapp 3) | Fler bilder (mapp 2) |
|---|---|---|---|---|---|---|---|---|
| 1 | Dashboard | `pg-dash` | Omarbetad | 1366_01_pg-dash.png | 390_01_pg-dash.png | 390-falt_01_pg-dash.png | 01_pg-dash.png, 01_pg-dash_1920.png | dashboard |
| 2 | Arbetsorder (lista) | `pg-ao` | Omarbetad | 1366_02_pg-ao.png | 390_02_pg-ao.png | 390-falt_02_pg-ao.png | 02_pg-ao.png, 02_pg-ao_1920.png | aolist |
| 3 | Arbetsorder (detalj) | `pg-ao-detail` | Omarbetad | 1366_03_pg-ao-detail.png | 390_03_pg-ao-detail.png | 390-falt_03_pg-ao-detail.png | 03_pg-ao-detail.png | aodetail |
| 4 | Kunder | `pg-crm` | Omarbetad | 1366_04_pg-crm.png | 390_04_pg-crm.png | — | 04_pg-crm.png, 04_pg-crm_1920.png | register |
| 5 | Kundkort | `pg-crm-detail` | Delvis (huvud, flikar, kontaktlänkar) | 1366_05_pg-crm-detail.png | 390_05_pg-crm-detail.png | — | 05_pg-crm-detail.png | misc |
| 6 | Fastigheter | `pg-objects` | Omarbetad | 1366_06_pg-objects.png | 390_06_pg-objects.png | — | 06_pg-objects.png, 06_pg-objects_1920.png | register |
| 7 | Serviceintervall | `pg-service-intervals` | Omarbetad | 1366_08_pg-service-intervals.png | 390_08_pg-service-intervals.png | — | 08_pg-service-intervals.png | service |
| 8 | Fastighetskort | `pg-obj-detail` | Omarbetad | 1366_07_pg-obj-detail.png | 390_07_pg-obj-detail.png | — | 07_pg-obj-detail.png | misc |
| 9 | Objekt (lägenhet/lokal) | `pg-propobj-detail` | Omarbetad | 1366_29_pg-propobj-detail.png | 390_29_pg-propobj-detail.png | — | 29_pg-propobj-detail.png | misc |
| 10 | Offerter (lista) | `pg-offer` | Ej omarbetad (endast XSS-rättning) | 1366_09_pg-offer.png | 390_09_pg-offer.png | — | 09_pg-offer.png, 09_pg-offer_1920.png | — |
| 11 | Offert (detalj) | `pg-offer-detail` | Omarbetad (även offertguiden) | 1366_10_pg-offer-detail.png | 390_10_pg-offer-detail.png | — | 10_pg-offer-detail.png | offers |
| 12 | Fakturering (kö och lista) | `pg-invoices` | Omarbetad | 1366_11_pg-invoices.png | 390_11_pg-invoices.png | — | 11_pg-invoices.png, 11_pg-invoices_1920.png | billing |
| 13 | Fakturaunderlag (detalj) | `pg-inv-detail` | Omarbetad | 1366_12_pg-inv-detail.png | 390_12_pg-inv-detail.png | — | 12_pg-inv-detail.png | billing |
| 14 | Tid & stämpla | `pg-tid` | Omarbetad | 1366_16_pg-tid.png | 390_16_pg-tid.png | 390-falt_05_pg-tid.png | 16_pg-tid.png | falt |
| 15 | Kalender | `pg-calendar` | Omarbetad | 1366_17_pg-calendar.png | 390_17_pg-calendar.png | 390-falt_06_pg-calendar.png | 17_pg-calendar.png, 17_pg-calendar_1920.png | misc |
| 16 | Kontrakt | `pg-contracts` | Omarbetad | 1366_18_pg-contracts.png | 390_18_pg-contracts.png | — | 18_pg-contracts.png, 18_pg-contracts_1920.png | misc |
| 17 | Projekt | `pg-projects` | Omarbetad | 1366_19_pg-projects.png | 390_19_pg-projects.png | — | 19_pg-projects.png, 19_pg-projects_1920.png | misc |
| 18 | Projektkort | `pg-project-detail` | Omarbetad | 1366_20_pg-project-detail.png | 390_20_pg-project-detail.png | — | 20_pg-project-detail.png | misc |
| 19 | Rondering | `pg-rondering` | Omarbetad | 1366_21_pg-rondering.png | 390_21_pg-rondering.png | — | 21_pg-rondering.png | misc |
| 20 | Ny rondering | `pg-rondering-wizard` | Omarbetad | 1366_35_pg-rondering-wizard.png | 390_35_pg-rondering-wizard.png | — | 35_pg-rondering-wizard.png | misc |
| 21 | Utför rondering | `pg-rondering-utfor` | Omarbetad | 1366_36_pg-rondering-utfor.png | 390_36_pg-rondering-utfor.png | — | 36_pg-rondering-utfor.png | misc |
| 22 | Ronderingsrapport | `pg-rondering-rapport` | Ej omarbetad | 1366_37_pg-rondering-rapport.png | 390_37_pg-rondering-rapport.png | — | 37_pg-rondering-rapport.png | — |
| 23 | Artiklar | `pg-articles` | Omarbetad | 1366_22_pg-articles.png | 390_22_pg-articles.png | — | 22_pg-articles.png, 22_pg-articles_1920.png | register |
| 24 | Prisgrupper | `pg-pricegroups` | Omarbetad | 1366_23_pg-pricegroups.png | 390_23_pg-pricegroups.png | — | 23_pg-pricegroups.png | register |
| 25 | Löneunderlag | `pg-payroll` | Omarbetad | 1366_24_pg-payroll.png | 390_24_pg-payroll.png | — | 24_pg-payroll.png | admin |
| 26 | Rapporter | `pg-reports` | Omarbetad | 1366_25_pg-reports.png | 390_25_pg-reports.png | — | 25_pg-reports.png | admin |
| 27 | Personal | `pg-staff` | Omarbetad | 1366_26_pg-staff.png | 390_26_pg-staff.png | — | 26_pg-staff.png, 26_pg-staff_1920.png | register |
| 28 | Admin | `pg-admin` | Omarbetad | 1366_27_pg-admin.png | 390_27_pg-admin.png | — | 27_pg-admin.png | admin |
| 29 | Återkommande ärenden | `pg-recurring` | Omarbetad | 1366_28_pg-recurring.png | 390_28_pg-recurring.png | — | 28_pg-recurring.png | falt |
| 30 | Säljchanser | `pg-sales` | Ej omarbetad (V3 sedan tidigare) | 1366_13_pg-sales.png | 390_13_pg-sales.png | — | 13_pg-sales.png, 13_pg-sales_1920.png | — |
| 31 | Uppgifter | `pg-activities` | Omarbetad | 1366_33_pg-activities.png | 390_33_pg-activities.png | 390-falt_07_pg-activities.png | 33_pg-activities.png | register |
| 32 | Offerttjänster | `pg-service-templates` | Omarbetad | 1366_34_pg-service-templates.png | 390_34_pg-service-templates.png | — | 34_pg-service-templates.png | register |
| 33 | Mina jobb | `pg-myjobs` | Omarbetad | 1366_14_pg-myjobs.png | 390_14_pg-myjobs.png | 390-falt_04_pg-myjobs.png | 14_pg-myjobs.png | falt |
| 34 | Dagens drift | `pg-operations` | Omarbetad | 1366_15_pg-operations.png | 390_15_pg-operations.png | — | 15_pg-operations.png | falt |
| 35 | Importera | `pg-import-wizard` | Omarbetad | 1366_30_pg-import-wizard.png | 390_30_pg-import-wizard.png | — | 30_pg-import-wizard.png | misc |
| 36 | Importlogg | `pg-import-log` | Omarbetad | 1366_31_pg-import-log.png | 390_31_pg-import-log.png | — | 31_pg-import-log.png | misc |
| 37 | Exportcenter | `pg-export-center` | Omarbetad | 1366_32_pg-export-center.png | 390_32_pg-export-center.png | — | 32_pg-export-center.png | misc |

## Dialoger, formulär och statuslägen (urval)
- **AO-detalj:** `2-…/aodetail/`, alla statusar (ny, planerad, pågår, pausad, klar, fakturerad, avbruten) × roller, åtgärdsmeny, dialoger för material/logg/prissättning, fältflödet 390 px steg för steg.
- **Offerter:** `2-…/offers/`, detalj i alla statusar, guiden steg 1–4 på dator och mobil, granskningssteget.
- **Fakturering:** `2-…/billing/`, kön ihopfälld/utfälld, Kräver åtgärd, bekräftelsedialog, underlag i alla statusar, 100 och 1 000 kandidater.
- **Dashboard:** `2-…/dashboard/`, anpassningsläget (dra/flytta, storlek, dolda widgets), kartans tomlägen.
- **Admin:** `2-…/admin/` (11 avsnitt, färgval, teknik och underhåll) och `3-…/38–47` (äldre flikar).
- **Formulär:** `3-…/62_dialog-ny-arbetsorder_390.png`, `63_dialog-ny-kund_390.png`, guiden för Ny rondering, Importera och offertguiden.

## Kända begränsningar i underlaget
- Säljchanser, Ronderingsrapport och offertlistan är **inte omarbetade** i nattkörningen. De finns med för helhetens skull.
- Mapbox-kartan kan inte visas i testmiljön, eftersom nätet blockerar api.mapbox.com. Därför visar kartwidgeten "Kartan kunde inte laddas".
- Bilderna i mapp 1 är beskurna vid 4 000 px höjd.
