# Referensläge före nattkörningen 2026-11-26 (STAGING)

Taget 2026-11-24 22:27 UTC, före alla ändringar i nattkörningen. Endast läsning.

## Klient (publicerad på staging-crm.viftfast.se)
- V3.3 publicerad: `release/staging-2026-11-25-v3.3/MANIFEST-v3.3.txt` → 2/2 identiska (index.html, src/pages/PageShells.js).
- Övriga 16 filer från v3.1 oförändrade (`MANIFEST-v3.1.txt`: 16/18 identiska; de 2 avvikande är de som v3.3 ersatte).
- Verifierat i webbläsare mot publicerad klient: A1 Admin-flikar dator+mobil (ikoner som SVG-element, ingen markup som text), X1 lagrad XSS 4 roller (inget skript), R0 alla sex roller utan JS-fel, C-5 `c5-read` 26/26.

## Backend (Supabase STAGING yyzljlqyzzcbxmcdbual)
Edge Functions (version): work-orders-list 3, store-key-write 5, ao-time-write 5, invoice-write 9, offer-respond 10, offer-token-validate 11, offer-attachment-upload 13, offer-attachment-url 11, offer-pdf 10, offer-public-pdf 1, send-offer-email 11, time-entries-list 3, work-order-log-write 1, work-order-checklist-resolve 2, work-order-image-upload/-url/-delete 1, project-document-upload/-url 1, rondering-pass-write 3, get-/set-sensitive-fields 9, send-push 9, service-monitor 15, e2e-test-cleanup 1 (endast STAGING), vift-admin-storage 8 (410-stubb).
RLS på public.store: 25 policyer inkl. `store_read_by_role` (C-5).

## Verksamhetsdata (md5 av värdet, 12 tecken; antal element)
```
vift_activities=5b55cf10f640(8) vift_activityLog=6d77199d0966(165) vift_articles=5a2b80f01e51(26) vift_avvikelser=6f693875b235(2)
vift_contracts=d75171398898(0) vift_customers=2221c19c2d8e(543) vift_deviationCategories=d75171398898(0) vift_emailTemplates=0a3531eb6290(5)
vift_importLogs=3382f73dc995(1) vift_inspections=d75171398898(0) vift_invoices=5aff1e802c4b(87) vift_notifications=ef2fcd0e0480(4)
vift_offerAttachments=4e632a6307e5(13) vift_offerEvents=f49aef552739(33) vift_offers=a9f69bf4c171(74) vift_priceGroups=f06b69c987eb(5)
vift_priceProfiles=68a8ae530eef(5) vift_projects=0d121be76413(3) vift_properties=0c32456c0ab1(131) vift_propertyCategories=e8589f60b048(18)
vift_propertyContacts=b727c99f4eb5(2) vift_propertyObjects=8a2913eeb1cc(8) vift_propertyRoles=f27c5bc8b4ef(1) vift_recurringOrders=d57f594c95b7(1)
vift_roles=1d7ba65d1c18(7) vift_ronderingar=70b1ccbcf4ab(3) vift_ronderingsmallar=090d4f29026d(1) vift_ronderingspass=27c26a58d0c1(5)
vift_salesOpps=50a2f46464f3(1) vift_serviceMonitorLog=c586e12b2680(42) vift_serviceTemplates=5668661c8576(7) vift_settings=b4ba3e3406f4(obj)
vift_staff=3cac58824816(9) vift_timeEntries=a3b0414b4df6(1122) vift_titles=a48a6803dca4(15) vift_workOrders=f2813b050c58(363)
```
Lagring: 14 objekt. op_idempotency: 2368. Aktiva stämplingar: 0.

**Ändringar sedan föregående rapport (inte av testerna):** STAGING-administratörens session (`ST-STAGING-ADMIN`) redigerade 2026-11-24 21:48–21:52 UTC AO `AO-0fbc2897…` (QA-LOAD-AO0004), skapade fakturaunderlag F-089 från kön och satte det till skickad → betald. Därför avviker vift_workOrders, vift_invoices och vift_activityLog från förra rapportens referens. Inget har återställts.

## Fakta som påverkar arbetet
- Kartan: 0 av 363 AO och 0 av 131 fastigheter har lat/lng (337 AO har adress, 28 har geocodedAddress men inga koordinater).
- AO-nummer: alla 363 har `displayNumber`; exakt ett par delar nummer: `AO-001` (id AO-001, "GTE", 2026-07-23) och id `AO-bfc37f77…` ("TEST-R9B", 2026-10-22). Ingen data ändras.
- 430 kr/tim = prisgrupp PG-002 "Fastighetsservice standard" (314 AO använder den). PG-001 392, PG-003 595, PG-004 695, PG-005 månadsdebitering. Inga avtal (vift_contracts tom). internalHourlyCost 250.
- Testdata: se TESTDATA-INVENTERING.md.
