# VIFT CRM – QA-rapport 2026-11-25: V3.1-verifiering, UI-regression och säkerhetsbrist C-5

**Miljö:** STAGING (`staging-crm.viftfast.se`, Supabase `yyzljlqyzzcbxmcdbual`). LIVE har inte rörts.

**Grenar:**
- V3-klienten: `claude/vift-v3-major-redesign`
- Server och testverktyg: `claude/vift-system-restructure-8fUme`

**Bilagor:**
- `C5-LASBEHORIGHET.md` – karta per roll, nyckel och fält
- `UI-UX-INVENTERING.md` med `ui/` – 65 skärmbilder
- `bilder/` – Admin-flikar, dator och mobil
- `loggar/` – körrapporter

## Slutbeslut

| Område | Status |
|---|---|
| V3.1 på STAGING | **Verifierad:** 18/18 filer, XSS-skyddet fungerar mot riktig data |
| UI-regression Admin-flikar (rå SVG) | **Rättad.** Finns i **v3.3**, inte publicerad förrän paketet laddats upp |
| **C-5 läsbehörighet** | **Verifierat rättad i STAGING** (server). Inte installerad i LIVE |
| Fortsatt produktionsförberedelse | **GO**, efter uppladdning och verifiering av v3.3 |
| LIVE | **NO-GO** tills STAGING-ändringarna förts över enligt en separat, godkänd LIVE-plan (se nedan) |

---

## 1. V3.1 – publicering och regression (riktig STAGING)

- **Manifest:** 18/18 filer identiska.
- **X1 – lagrad XSS mot den publicerade klienten**, 4 roller och 91 sidvisningar: inget skript kördes. Den befintliga QA-kunden med `<img onerror=alert>` körde skript före v3.1; nu gör den det inte.
- **R0:** sex roller, alla sidor utan JS-fel (sista körningen: 6/6).
- **F6–F8** körda två gånger, före och efter C-5, med samma utfall:
  - kund → offert → kundgodkännande → AO → tid, material, checklista och bild → fakturaunderlag;
  - belopp: 3 952 + 300 = 4 252 kr exkl. moms, 1 063 kr moms (25 %), totalt 5 315 kr, rätt kund, ingen dubbelfakturering;
  - kunden nekar offert och kunden begär ändring.

## 2. Regression: rå SVG i Admin-flikarna

- **Orsak:** `AdminPage.render()` hade `ic()`-markup i flikarnas `label`, som XSS-rättningen escapade till synlig text.
- **Rättning:** ikonen ligger i ett eget fält och renderas som betrodd markup; texten escapas fortfarande.
- **Sökning efter fler fall:**
  - Nytt test **RENDER-01** (simulerat) går igenom alla sidor, admin-flikar, flikar/chips, detaljsidor och vanliga AO-dialoger för fyra roller. Det underkänns mot v3.1 och godkänns med rättningen.
  - Statisk genomgång av alla `esc()`-anrop som lades till.
  - UI-inventeringen: 37 sidor × 2 bredder, 10 admin-flikar, 186 flik- och chipklick och 40 dialoger.
  - **Inga fler fall.**
- **Verkligt test:** A1 i riktig webbläsare mot riktig STAGING, dator och mobil. Mot publicerad v3.1 underkänd (bekräftade felet); mot paket v3.3 godkänd, med 5 ikoner som riktiga SVG-element. Skärmbilder i `bilder/`.

**Följdfynd: färgväljaren.** Den sparade hela `vift_settings` vid varje `input`-händelse. Rättat: förhandsvisning medan man drar, en enda sparning vid change. Test **BRAND-01**: godkänns med rättningen, underkänns mot tidigare kod.

## 3. C-5 – läsbehörighet (verifierat rättad i STAGING)

- **Före:** alla aktiva roller kunde läsa alla affärsnycklar via REST och via `readAllWithHashes`/`readWithHash`, bl.a. offerttoken, fakturor, personnummer, portkoder, bankgiro och internt timpris.
- **Efter:** en gemensam regel i databasen används av RLS (ny restriktiv policy), `store-key-write` v5 och `work-orders-list` v3. Karta per roll, nyckel och fält finns i `C5-LASBEHORIGHET.md`.

**Tester mot riktig STAGING:**

| Test | Utfall |
|---|---|
| `c5-read`, sex konton × REST/readAllWithHashes/readWithHash/work-orders-list, tillåtet och nekat | **26/26** |
| Syntetiska värden: personnummer, portkod, nyckelinformation, AO-portkod per roll | Rätt för alla 7 roller i STAGING |
| R0, sex roller (sidor och JS-fel) | 6/6 |
| X1 (XSS), F2–F5 (checklista, stämpling på två enheter, samtidiga loggposter, nätavbrott) | Gröna |
| F6–F8 (affärsflödet) | Gröna |
| `authz-mutation`, `qa-ao-material` (17), `go7-ao-log` (11) | Gröna, affärsposter identiska |
| Oinloggad REST och EF | 401 |

**Kvarstående medvetna avvägningar (inte blockerare för STAGING, bör beslutas före LIVE):**
- Inköpspris i artiklar och timpris i prisgrupper är läsbara för alla, eftersom fältets materialformulär använder dem.
- Personalregistret och aktivitetsloggen är läsbara för alla aktiva användare.
- Skrivare utan `objects_sensitive` (arbetsledare) ser portkoder i data. Klienten döljer dem.

**Rollback:** `DROP POLICY` + funktioner, och `store-key-write` v4 / `work-orders-list` v2 från backup. Exakta kommandon i `C5-LASBEHORIGHET.md`.

## 4. Testverktygets städning

Ny STAGING-only Edge Function `e2e-test-cleanup` med SQL-funktion. Spärrar:
- vägrar utanför STAGING;
- kräver `all`;
- rör bara poster vars titel börjar med `[E2E-TEST]`;
- raderar bara inom postens egen mapp.

Verifierat: fält och arbetsledare nekas, riktig offert och AO nekas, ogiltigt id nekas, oinloggad nekas.

e2e-real städar nu automatiskt fakturautkast (officiell `draftDelete`), offertbilagor med filer, offerthändelser och AO-bilder. I en verklig körning togs 3 offerter (2 bilagor, 2 filer, 14 händelser) och 1 AO-bild bort automatiskt. Ett fel i läsningen av fakturautkast hittades och rättades: `readWithHash` tillåter inte `vift_invoices`.

**Datakontroll efter all städning:**
- Alla affärsnycklar är identiska med referensläget, och lagringen har 14 objekt.
- Kvar:
  - revisionsposter för de raderade testutkasten (behålls avsiktligt);
  - `vift_settings` (se 6);
  - `lastChanged`;
  - idempotenshistorik.

## 5. Materialraden med 0 kr

Ej reproducerad: tre verkliga körningar och 10 av 10 lokala försök sparade 150 kr. Prislogiken är oförändrad. Faktureringskön spärrar en rad utan pris ("Saknar försäljningspris"), så felaktig fakturering kan inte uppstå. Kvar som bevakningspunkt.

## 6. Ändringen i `vift_settings` (fakta, ingen tolkning av vem)

- **Vad hände:** 23 skrivningar av hela `vift_settings` på 15 s, 2026-11-24 20:10:51–20:11:06 UTC. Alla gav 200.
- **Konto och klient:** kontot `ST-STAGING-ADMIN` (domän viftfast.se), från en Windows/Chrome-session. Kontot hade också en iPhone/Safari-session 20:07.
- **Storlek:** 628 byte per anrop, vilket motsvarar en hel skrivning av settings.
- **Mekanism:** mönstret stämmer med färgväljaren (en skrivning per input-händelse, nu rättat).
- **Nuvarande värden:** primärfärg `#6a5353`, sekundärfärg `#005fcc`. Båda skiljer sig från standard.
- Inga äldre värden har skrivits tillbaka.

## 7. UI/UX

Se `UI-UX-INVENTERING.md`.

**Klassning:**
- **V3:** 4 sidor (Dashboard, AO-lista, AO-detalj, Säljchanser).
- **Delvis V3:** 24 sidor.
- **Äldre design:** 9 sidor (Kontrakt, Projekt, Löneunderlag, Rapporter, Admin, Importera, Importlogg, Exportcenter, Ronderingsrapport).

**Fynd:**
- Ingen annan bekräftad V3-regression.
- **Viktigast att åtgärda först** (förbättringsplanens fas 0):
  - F-01 (P1, fanns före V3): vald period i Rapporter syns inte, kontrast 1,1:1;
  - ikoner som hamnar på egen rad (P2, 58 ställen);
  - Importera på mobil klipps (P2);
  - Löneunderlagets tabell (P2);
  - flikrader som döljer flikar (P2).
- Planen är ordnad från punkträttningar till senare harmonisering. Ingen stor omdesign är påbörjad.

## 8. Publicering

| Paket | Innehåll | Status |
|---|---|---|
| v3.1 | XSS-rättning (18 filer) | **Publicerad och verifierad** |
| v3.2 | Admin-flikar | **Ersatt av v3.3**, ladda inte upp |
| **v3.3** | `src/pages/PageShells.js` + `index.html`: Admin-flikar och färgväljare | **Att ladda upp.** Förprövad mot riktig STAGING: A1, X1, R0 |

**Backend är redan installerad i STAGING (ingen uppladdning behövs):**
- migrationerna `20261125000003` (C-5) och `20261125000004` (testverktyg);
- `store-key-write` v5, `work-orders-list` v3, `e2e-test-cleanup` v1;
- `vift-admin-storage` är 410-stubb.

## 9. Blockerare inför LIVE och nästa åtgärder (max 10)

1. Ladda upp v3.3. Verifiera 2/2 filer, A1, R0.
2. **LIVE-plan:** samtliga STAGING-serverändringar sedan 2026-11-24 ska föras till LIVE med backup och återställningsväg. Det gäller C-5, `ao-time-write` v5, lastChanged-triggern och GO-5–GO-8. Kräver ditt separata beslut. `e2e-test-cleanup` får **aldrig** följa med.
3. Besluta om avvägningarna i C-5: artikelpriser, personalregister, portkoder för skrivare utan `objects_sensitive`.
4. Fas 0 i UI-planen: F-01 kontrast i Rapporter, ikonradbrytning, Importera på mobil, Löneunderlagets tabell, flikrader.
5. Avveckla de sex E2E-kontona och e2e-rollerna när testuppdraget avslutats.
6. Bevaka materialpriset (C-6) i kommande fältkörningar.
7. Fältvis sammanslagning på servern för redigerade fält, så att portkoder kan döljas även för skrivare utan `objects_sensitive`.
