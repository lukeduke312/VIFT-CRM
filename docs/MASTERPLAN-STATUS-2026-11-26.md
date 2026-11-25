# VIFT CRM – Statusrapport för masterplanen (2026-11-26)

**Typ:** endast läsning och dokumentation. Ingen kod, databas, git push eller Supabase-/webbanrop har gjorts för rapporten.

**Källor:**
- `docs/MASTERPLAN.md` (707 rader, punkt 1–210, senast 2026-11-24);
- `docs/MASTERPLAN-UNDERHALLSPLAN.md`;
- `docs/PROJECT_STATUS.md`;
- `docs/E2E-RAPPORT-2026-11-23.md`, `SLUTRAPPORT-2026-11-23.md`, `RELEASEKANDIDAT-2026-11-23.md`, `STAGING-VERIFIERING-G6-G9-G13.md`;
- `docs/qa-2026-11-24/QA-RAPPORT-V3-SLUTTEST.md`;
- `docs/qa-2026-11-25/QA-RAPPORT-2026-11-25.md` och `C5-LASBEHORIGHET.md`;
- `docs/qa-2026-11-26/`: slutrapporten för nattkörningen, `SAKERHET-DEL10.md`, `KARTA-UTREDNING.md`, `TESTDATA-INVENTERING.md`, `REFERENSLAGE.md` och de nio blockdokumenten;
- `vift-v2/docs/INSTALLATIONSPLAN-STAGING-2026-11-22.md` §6.6–§7, `vift-v2/docs/staging-rapporter/` och `git log` i `vift-v2` (60 senaste);
- fakta från sessionen (se uppdraget).

---

## Statusregler i denna rapport

Varje punkt har exakt en status.

| Status | Betyder |
|---|---|
| **Färdig och verifierad** | Kärnfunktionen är prövad mot **riktig STAGING** (märkt **[S]**). Undantag: ren klientlogik eller presentation utan serverberoende, som ingår i den publicerade STAGING-klienten v3.4 och har ett namngivet automatiskt test som var grönt i slutkörningen 2026-11-26 (märkt **[T]**). |
| **Utvecklad, ej slutverifierad** | Koden finns, men kärnfunktionen är bara prövad mot simulerad server, eller inte alls, eller installerad men inte aktiverad eller testad. |
| **Delvis färdig** | En del av punktens innehåll saknas eller är kvar att bygga eller besluta. |
| **Ej påbörjad** | Planerad, uppskjuten eller platshållare utan kod. |

Leveranser som är dokument, testverktyg eller paket räknas som verifierade när leveransen finns och har använts (märkt [D] eller [T]).

**Belägg** anges som [S] = riktig STAGING, [T] = automatiskt test mot simulerad server eller enhetstest, [D] = bara dokumentation eller kodgranskning.

**Var punkten finns:**
- **STAGING:** klient v3.4 är publicerad och verifierad (40/40 filer). Servern har allt som installerats 2026-11-24–25.
- **LIVE** (`crm.viftfast.se`) har **inget** av det som installerats eller publicerats i STAGING sedan 2026-11-22. Det gäller C-5, `ao-time-write` v5, lastChanged-triggern, GO-5–GO-8, `time-entries-list`, klient v2 och V3.x. LIVE är **NO-GO**.
- "LIVE äldre" betyder att funktionen finns i LIVE:s äldre klient. Ingen inventering av LIVE har gjorts. Vilken version LIVE har av varje punkt: **Källa saknas**.

---

## 1. Sammanfattning

Masterplanens rubrik säger "153 punkter", men den uppräknade serien är i dag **1–210** (punkt 92 finns bara i Fas 4) plus **E2b-1–E2b-6**. Det ger **216 numrerade punkter**. Därtill kommer 12 delar i Leverans F4, 8 blockerare (A1–C2) och modulen Teknisk underhållsplanering. Dessa redovisas separat i 2.2–2.4.

### Numrerade punkter (216)

| Status | Antal | Därav [S] | Därav bara [T] |
|---|---|---|---|
| Färdig och verifierad | **111** | 85 | 23 (+ 3 [D]) |
| Utvecklad, ej slutverifierad | **88** | – | – |
| Delvis färdig | **9** | – | – |
| Ej påbörjad | **8** | – | – |
| **Summa** | **216** | | |

### Övriga poster (2.2–2.4)

| Del | Färdig och verifierad | Utvecklad, ej slutverifierad | Delvis färdig | Ej påbörjad |
|---|---|---|---|---|
| F4-delar (12) | 0 | 11 | 0 | 1 |
| Blockerare A1–C2 (8) | 5 | 2 | 1 | 0 |
| Underhållsplanering (1 modul, 5 etapper) | 0 | 0 | 0 | 1 |

### Läget i korthet

- Hela affärsflödet är verifierat mot riktig STAGING: kund → offert → kundgodkännande → AO → tid, material, checklista och bild → fakturaunderlag (F6, 28/28).
- Dessutom gröna mot riktig STAGING: F7 och F8 (kunden nekar respektive begär ändring), läsbehörighet per roll (C-5 26/26), R0 för sex roller, X1 (XSS), A1 (Admin) samt GO-5–GO-8d.
- **Inte prövat** mot riktig STAGING:
  - rondering;
  - serviceintervall och `service-monitor`;
  - återkommande ärenden;
  - import och export (XLSX med riktiga filer);
  - rapporter och löneunderlag;
  - kalender;
  - Leverans D (ansvariga och kontakter);
  - E7 (påminnelser och analys);
  - riktig push och e-post.

  Därför står 88 punkter som "Utvecklad, ej slutverifierad", trots att många har gröna simulerade tester.

---

## 2. Status per punkt

### 2.1 Numrerade punkter 1–210 och E2b

#### Fas 0 — Kärninfrastruktur

| # | Funktion | Status | Belägg | Var |
|---|---|---|---|---|
| 1 | SPA, hash-routing | Färdig och verifierad | [S] R0 sex roller, alla sidor utan JS-fel; [T] PAGES-01/02 | STAGING · LIVE äldre |
| 2 | Supabase single-table store | Färdig och verifierad | [S] F6, nivå 0–2, md5-kontroller före och efter GO | STAGING · LIVE äldre |
| 3 | Auth (login, roller, RLS, `Auth.can`) | Färdig och verifierad | [S] R0, c5-read 26/26, authz-read 22/0, authz-mutation 51/0 (QA V3 B1) | STAGING · LIVE äldre |
| 4 | Service Worker | Färdig och verifierad | [S] installationsplan §6.4b: SW aktiv, versionsjämförelse 0 avvikelser; [T] SW-01 | STAGING · LIVE äldre |
| 5 | DataSync-polling | Färdig och verifierad | [S] F6.11b: kundens godkännande syns i arbetsledarens klient (efter C-4). Kvar: G11 | STAGING · LIVE äldre |
| 6 | ActivityService – revisionslogg | Delvis färdig | [S] aktivitetsflödet (punkt 195) installerat, GO-6 19/19. Det är klientrapporterat. Verifierad revisionslogg (punkt 200) är inte byggd. | STAGING |
| 7 | ActivitiesService – Att göra | Färdig och verifierad | [S] GO-6 19/19 (egen uppgift tillåten, annans nekad) | STAGING |
| 8 | Push-notiser (send-push, VAPID) | Utvecklad, ej slutverifierad | send-push v9 i STAGING (`REFERENSLAGE.md`); [T] NOTIF-01; riktig push-leverans aldrig prövad (E2E §7) | STAGING |

#### Fas 1 — CRM-kärna

| # | Funktion | Status | Belägg | Var |
|---|---|---|---|---|
| 9 | AO – CRUD, wizard, statusflöde | Färdig och verifierad | [S] F6.12–F6.19 | STAGING · LIVE äldre |
| 10 | AO – checklista, material, tid, fakturering | Färdig och verifierad | [S] F2, F6.15–F6.23, GO-5 8/8, qa-ao-material 17/17 | STAGING · LIVE äldre |
| 11 | AO – objectId/objectName | Utvecklad, ej slutverifierad | Riktat test: Källa saknas | STAGING |
| 12 | AO – snapshot-fält | Utvecklad, ej slutverifierad | Riktat test: Källa saknas | STAGING |
| 13 | AO – sökning på objekt, port, trapphus | Utvecklad, ej slutverifierad | [T] PERF-01 och AOL (sökning generellt); objektfälten: Källa saknas | STAGING |
| 14 | Kundregister | Färdig och verifierad | [S] F6.1, F6.3; [T] CUS-01–03 | STAGING · LIVE äldre |
| 15 | Fastighetsregister (CRUD, teknik, bilder) | Utvecklad, ej slutverifierad | [S] F6.2 (skapa). Bilder (`property_images`) aldrig prövade (E2E §7). | STAGING · LIVE äldre |
| 16 | Offertmodul | Färdig och verifierad | [S] F6.4–F6.11, F7, F8 | STAGING · LIVE äldre |
| 17 | Fakturaunderlag | Färdig och verifierad | [S] F6.20–F6.23 (belopp, 25 % moms, rätt kund, ingen dubbelfakturering). Öppet: intern kommentar skrivs ut på PDF:en | STAGING · LIVE äldre |
| 18 | Tidrapportering och stämpling | Färdig och verifierad | [S] F3, F6.15, GO-3 G6 (1 tidpost), time-entries-list per person | STAGING · LIVE äldre |
| 19 | Återkommande ärenden | Utvecklad, ej slutverifierad | [T] REC-01, FALT; inget flöde mot STAGING (QA V3 åtgärd 6). Automatisk skapning finns inte (`FALTSIDOR.md`). | STAGING · LIVE äldre |
| 20 | Säljchanser | Utvecklad, ej slutverifierad | [T] SALES-01; [S] bara skrivbehörighet (G13 `vift_salesOpps`). Vyn är inte omarbetad. | STAGING · LIVE äldre |
| 21 | Personalregister | Utvecklad, ej slutverifierad | [T] STAFF-01/02. Skydd mot att inaktivera sig själv eller sista superadmin saknas (`REGISTER.md`). | STAGING · LIVE äldre |
| 22 | Artikelregister | Utvecklad, ej slutverifierad | [T] ART-01. Beslut B1 om inköpspris öppet. | STAGING · LIVE äldre |
| 23 | Prisgrupper | Utvecklad, ej slutverifierad | [T] ART-01. Aktivera/inaktivera utan serverbekräftelse (`REGISTER.md`). | STAGING · LIVE äldre |
| 24 | Admin (roller, inställningar) | Utvecklad, ej slutverifierad | [S] A1 (bara visning); [T] ROLE-01/02, ARP-01–07. `vift_settings` skrivs som helhet. | STAGING · LIVE äldre |
| 25 | Dashboard – KPI, öppna AO, avvikelser | Färdig och verifierad | [T] DASH-01, DASH-E-01–11; [S] R0 laddar per roll. (Kartan: se 181.) | STAGING · LIVE äldre |
| 26 | Sidebar med badges | Utvecklad, ej slutverifierad | [S] R0 menyer per roll; badge-räkning: Källa saknas | STAGING · LIVE äldre |

#### Fas 2 — Rondering

| # | Funktion | Status | Belägg | Var |
|---|---|---|---|---|
| 27 | Ronderingsmallar | Utvecklad, ej slutverifierad | [T] RON-01–03; inget flöde mot STAGING | STAGING · LIVE äldre |
| 28 | Ronderingspass | Utvecklad, ej slutverifierad | [T] RON-01; `rondering-pass-write` v3 finns i STAGING, men källan finns inte i repot (G4). Fältrollen når inte rondering (saknar `ao_view_all`). | STAGING · LIVE äldre |
| 29 | Avvikelser | Utvecklad, ej slutverifierad | [T] RON-01 | STAGING · LIVE äldre |
| 30 | Ronderingsrapport | Utvecklad, ej slutverifierad | Ingen riktad test. Vyn står som "Kvar" i nattkörningen. | STAGING · LIVE äldre |
| 31 | Avvikelse – objectId | Utvecklad, ej slutverifierad | Riktat test: Källa saknas | STAGING |

#### Leverans 1 — Serviceintervall

| # | Funktion | Status | Belägg | Var |
|---|---|---|---|---|
| 32 | ServiceIntervalService v3, typer och kategorier | Färdig och verifierad | [T] `service_intervals.test.js` (36 kontroller, ren beräkning) | STAGING |
| 33 | Kalenderbaserad datumberäkning | Färdig och verifierad | [T] samma test (datumgränser, skottår) | STAGING |
| 34 | Service-flik i fastighetskortet | Utvecklad, ej slutverifierad | [T] SVC-UI-01, MISC-PROP-01/02 | STAGING |
| 35 | Markera utförd | Utvecklad, ej slutverifierad | [T] SVC-01; inget flöde mot STAGING | STAGING |
| 36 | Pausa/återuppta | Utvecklad, ej slutverifierad | [T] pausning i `service_intervals.test.js` | STAGING |
| 37 | Stäng Att göra vid utförd | Utvecklad, ej slutverifierad | [T] SVC-01 | STAGING |
| 38 | Ansvarig i Dagens drift | Utvecklad, ej slutverifierad | [T] FALT (Dagens drift); riktat: Källa saknas | STAGING |
| 39 | Daglig klientkörning (`runDailyCheck`) | Utvecklad, ej slutverifierad | [T] idempotens (punkt 146) | STAGING |
| 40 | Schemalagd EF (`service-monitor`) | Utvecklad, ej slutverifierad | v15 installerad i STAGING, pg_cron `active=false`. Testlistan i installationsplan §3 är inte körd. | STAGING (installerad, av) |
| 41 | Server-side dubblettskydd | Utvecklad, ej slutverifierad | Som 40 | STAGING (installerad, av) |
| 42 | Web-push per ansvarig | Utvecklad, ej slutverifierad | Som 40. Riktig push aldrig prövad. | STAGING (installerad, av) |
| 43 | Automatisk AO via EF | Utvecklad, ej slutverifierad | Som 40 (atomisk `work_order_create`) | STAGING (installerad, av) |

#### Leverans B — Kundimport och -export

| # | Funktion | Status | Belägg | Var |
|---|---|---|---|---|
| 44 | Schema: kundnummer, externt id, betalningsvillkor | Utvecklad, ej slutverifierad | Riktat test: Källa saknas | STAGING |
| 45 | ImportExportService (CSV/XLSX) | Utvecklad, ej slutverifierad | [T] IMP-01 (CSV). XLSX med riktiga filer aldrig prövat (F4-13). | STAGING |
| 46 | Importlogg-schema | Utvecklad, ej slutverifierad | [T] IMP-01 | STAGING |
| 47 | Importguide i sex steg | Utvecklad, ej slutverifierad | [T] IMP-01, MISC-IMP-01 | STAGING |
| 48 | Kolumnmatchning, Bokio-profil | Utvecklad, ej slutverifierad | Bokio-fil aldrig prövad (F4-13) | STAGING |
| 49 | Dubblettdetektering | Utvecklad, ej slutverifierad | [T] IMP-01 | STAGING |
| 50 | Konfliktlösning per rad | Utvecklad, ej slutverifierad | Diff-vyn byggd i F4-6 (22e8ed3), men raden säger "diff-vy EJ BYGGD". Masterplanen motsäger sig själv. | STAGING |
| 51 | Kundexport CSV | Utvecklad, ej slutverifierad | [T] EXP-01 | STAGING |
| 52 | Kundexport XLSX, flera blad | Utvecklad, ej slutverifierad | [T] EXP-01 | STAGING |
| 53 | Importlogg med ångra | Utvecklad, ej slutverifierad | [T] IMP-01 ("ångra återställer servern", simulerat) | STAGING |
| 54 | Bara admin importerar; portkod aldrig i export | Utvecklad, ej slutverifierad | [T] EXP-01. `SAKERHET-DEL10.md`: "kontrolleras i paketets regression", men inget STAGING-belägg. | STAGING |

#### Leverans C — Objekt, lägenheter och lokaler

| # | Funktion | Status | Belägg | Var |
|---|---|---|---|---|
| 55 | Objekttyper och statusar | Utvecklad, ej slutverifierad | [T] OBJ-01 | STAGING |
| 56 | `Schema.propertyObject()` | Utvecklad, ej slutverifierad | [T] OBJ-01 | STAGING |
| 57 | State `propertyObjects` | Utvecklad, ej slutverifierad | [S] bara läsprojektion per roll (c5-read); [T] OBJ-01 | STAGING |
| 58 | PropertyObjectService | Utvecklad, ej slutverifierad | [T] OBJ-01 | STAGING |
| 59 | Raderingsskydd | Utvecklad, ej slutverifierad | Masterplanen: "BEHÖVER TEST". Test: Källa saknas. | STAGING |
| 60 | Objekt-flik i fastighetskortet | Utvecklad, ej slutverifierad | [T] OBJ-01, MISC-PROP-01 | STAGING |
| 61 | Objektkortet (PropertyObjectPage) | Utvecklad, ej slutverifierad | [T] OBJ-01; [S] vyn öppnas i publicerad v3.4 (skärmbild 1366_29) | STAGING |
| 62 | Objektkort – serviceintervall | Utvecklad, ej slutverifierad | "BEHÖVER TEST"; Källa saknas | STAGING |
| 63 | Objektkort – avvikelser | Utvecklad, ej slutverifierad | "BEHÖVER TEST"; Källa saknas | STAGING |
| 64 | Objektkort – bilder och dokument | Utvecklad, ej slutverifierad | "BEHÖVER TEST"; bilduppladdning aldrig prövad | STAGING |
| 65 | Router `/objekt/:objId` | Färdig och verifierad | [S] vyn öppnas i publicerad v3.4 (BILDPAKET-INDEX rad 9) | STAGING |
| 66 | AO-wizard objektväljare och portkod | Utvecklad, ej slutverifierad | [T] PROP-01/02 (portkodsläcka rättad) | STAGING |
| 67 | AO-wizard prefill från objekt | Utvecklad, ej slutverifierad | Riktat test: Källa saknas | STAGING |
| 68 | AO-detalj visar objekt | Utvecklad, ej slutverifierad | Riktat test: Källa saknas | STAGING |
| 69 | Serviceintervall – objectId | Utvecklad, ej slutverifierad | Riktat test: Källa saknas | STAGING |
| 70 | Avvikelse – objectId i rondering | Utvecklad, ej slutverifierad | Riktat test: Källa saknas | STAGING |
| 71 | Kontakter/hyresgäster på objekt | Utvecklad, ej slutverifierad | "BEHÖVER TEST"; Källa saknas | STAGING |
| 72 | Rollbaserad åtkomst till portkod och nyckel | Färdig och verifierad | [S] c5-read med syntetiska portkoder, rätt för 7 roller. Kvar: B5 (skrivare utan `objects_sensitive` ser portkoder i data). | STAGING |

#### Fas 4 — Avancerade funktioner

| # | Funktion | Status | Belägg | Var |
|---|---|---|---|---|
| 73 | Generell import/export | Delvis färdig | Se 2.2. Filtrerad export och Åter.ronderingar är inte byggda; F4-13 inte gjord. | STAGING |
| 74 | Rondering – visningsrapport (skriv ut, dela) | Utvecklad, ej slutverifierad | Ingen test. Ronderingsrapporten står som "Kvar". | STAGING |
| 75 | Kalender, dra och släpp | Utvecklad, ej slutverifierad | [T] CAL-01/02, MISC-CAL-01; pekskärm på riktig enhet aldrig prövad | STAGING |
| 76 | Löneunderlag | Utvecklad, ej slutverifierad | [T] ARP. Lönedata saknas; beslut om CSV-kolumnen "Kostnad (SEK)" behövs. | STAGING |
| 77 | Rapporter | Utvecklad, ej slutverifierad | [T] REP-01. Masterplanens testlista (7 punkter) är obockad. | STAGING |
| 78 | Mina jobb | Färdig och verifierad | [S] R0 fältroller, qa-ao-material 17/17 (Starta, Ta jobbet) | STAGING |
| 79 | Avancerat behörighetssystem | Ej påbörjad | Uppskjuten | – |
| 80 | E-post via EF (Resend) | Utvecklad, ej slutverifierad | send-offer-email v11 i STAGING (`REFERENSLAGE.md`). Secrets: Källa saknas. F6 körs "utan mejl". | STAGING |
| 81 | Kontrakthantering | Utvecklad, ej slutverifierad | [T] MISC. Momsbas för belopp kräver beslut. | STAGING |
| 82 | Offline-läge | Ej påbörjad | Uppskjuten | – |
| 92 | Push – ansvarig titel | Utvecklad, ej slutverifierad | Riktig push aldrig prövad | STAGING |
| 129 | Klickbara rapportunderlag | Delvis färdig | Bara AO-staplarna leder till filtrerad AO-lista ([T] DASH-01). Masterplanens avsnitt "kvarvarande uppgift, punkt 129" säger att staplarna går till kort. Masterplanen motsäger sig själv. | STAGING |

#### Leverans D — Ansvariga och kontakter

| # | Funktion | Status | Belägg | Var |
|---|---|---|---|---|
| 83 | `Schema.propertyRole()` | Utvecklad, ej slutverifierad | Riktat test: Källa saknas | STAGING |
| 84 | `Schema.propertyContact()` | Utvecklad, ej slutverifierad | [T] CON-01 | STAGING |
| 85 | State och DataSync för roller och kontakter | Utvecklad, ej slutverifierad | Blockerare B2 (DataSync för övriga entiteter) är inte verifierad | STAGING |
| 86 | Titelregister i Admin | Utvecklad, ej slutverifierad | Riktat test: Källa saknas | STAGING |
| 87 | Fastighetskortet – Ansvariga och kontakter | Utvecklad, ej slutverifierad | [S] F6.3 (lägg till kontakt). Primär, giltighet och redigering är inte prövade. | STAGING |
| 88 | Objektkort – kontakter | Utvecklad, ej slutverifierad | "BEHÖVER TEST" (punkt 71) | STAGING |
| 89 | AO-wizard föreslår kontakt | Utvecklad, ej slutverifierad | Riktat test: Källa saknas | STAGING |
| 90 | Dagens drift – ansvariga | Utvecklad, ej slutverifierad | [T] FALT | STAGING |
| 91 | PropertyContactService | Utvecklad, ej slutverifierad | [T] CON-01 | STAGING |

#### Leverans E — Digitala offerter och kundsvar

| # | Funktion | Status | Belägg | Var |
|---|---|---|---|---|
| 93 | Schema offerEvent och token-fält | Färdig och verifierad | [S] F6.8 (token ≥ 32 tecken, låst snapshot) | STAGING |
| 94 | Händelselogg per offert | Färdig och verifierad | [S] F6 (14 händelser städade), c5-read | STAGING |
| 95 | State offerEvents, DataSync | Färdig och verifierad | [S] F6.11b | STAGING |
| 96 | Digital länk-panel | Färdig och verifierad | [S] F6.8; GO-8c: återkallad och utgången nekas | STAGING |
| 97 | Låsning vid utskick | Färdig och verifierad | [S] F6.8 `lockedSnapshotJSON` | STAGING |
| 98 | Token-fält på offer | Färdig och verifierad | [S] F6.8 | STAGING |
| 99 | offer-token-validate | Färdig och verifierad | [S] F6.10, GO-8c 9/9 (v11). Rate-limit aldrig prövad. | STAGING |
| 100 | offer-respond | Färdig och verifierad | [S] F6.11, F7, F8 | STAGING |
| 101 | Generera digital länk | Färdig och verifierad | [S] F6.8 | STAGING |
| 102 | Återkalla, förläng, ny token (UI) | Utvecklad, ej slutverifierad | [T] OFF-04. Serverns nekande av återkallad token är [S] GO-8c, men UI-flödet är inte prövat mot STAGING. | STAGING |
| E2b-1 | Schema `offerAttachment` | Färdig och verifierad | [S] F6.5, GO-8a 11/11 | STAGING |
| E2b-2 | Dropzone och offer-attachment-upload | Färdig och verifierad | [S] F6.5, GO-8a (v13 med PATCH) | STAGING |
| E2b-3 | Kundåtkomst via signerad URL | Färdig och verifierad | [S] GO-8a–d (QA V3 B1: token A ger bara A, återkallad 403, utgången 410) | STAGING |
| E2b-4 | Samlad PDF (`offer-pdf`) med bilagor | Utvecklad, ej slutverifierad | offer-pdf v10 i STAGING. F6.9 prövar kund-PDF:en (`offer-public-pdf`), inte den samlade PDF:en. | STAGING |
| E2b-5 | Versionslåsning av bilagor | Utvecklad, ej slutverifierad | `lockedInVersion` inte kontrollerat; Källa saknas | STAGING |
| E2b-6 | Token-kontroll, storagePath exponeras aldrig | Färdig och verifierad | [S] GO-8a–d | STAGING |
| 103 | Kundvy – huvud och uppgifter | Färdig och verifierad | [S] F6.10 | STAGING |
| 104 | Kundvy – offertposter | Färdig och verifierad | [S] F6.10; [T] paritet 120/120 i riktig webbläsare (punkt 147) | STAGING |
| 105 | Kundvy – summering, RUT/ROT | Färdig och verifierad | [S] F6.10 (4 940 kr); [T] G8-01 | STAGING |
| 106 | Kundvy – villkor | Utvecklad, ej slutverifierad | Riktat test: Källa saknas | STAGING |
| 107 | Kundvy – statusmeddelanden | Utvecklad, ej slutverifierad | [S] serverstatus i F7/F8; meddelandena på kundsidan: Källa saknas | STAGING |
| 108 | Kundvy – skriv ut, responsiv (iOS Safari) | Utvecklad, ej slutverifierad | Safari och riktiga telefoner aldrig prövade (E2E §7) | STAGING |
| 109 | Godkänn – formulär | Färdig och verifierad | [S] F6.10–F6.11 | STAGING |
| 110 | Godkänn – EF | Färdig och verifierad | [S] F6.11 (`approvedByName`) | STAGING |
| 111 | Begär ändring – formulär | Färdig och verifierad | [S] F8 | STAGING |
| 112 | Begär ändring – EF | Färdig och verifierad | [S] F8 (status `ändring-begärd`) | STAGING |
| 113 | Neka – formulär | Färdig och verifierad | [S] F7 | STAGING |
| 114 | Neka – EF | Färdig och verifierad | [S] F7 (status `nekad` med skäl) | STAGING |
| 115 | Kundbekräftelse och push till VIFT | Utvecklad, ej slutverifierad | Pushen aldrig prövad; bekräftelseboxen: Källa saknas | STAGING |
| 116 | Push vid kundsvar | Utvecklad, ej slutverifierad | Riktig push aldrig prövad | STAGING |
| 117 | Notisformat | Utvecklad, ej slutverifierad | Som 116 | STAGING |
| 118 | Tidslinje-UI | Utvecklad, ej slutverifierad | [T] OFFD; riktat mot STAGING: Källa saknas | STAGING |
| 119 | Visningsstatistik | Utvecklad, ej slutverifierad | Källa saknas | STAGING |
| 120 | Skapa AO från godkänd offert | Färdig och verifierad | [S] F6.12 | STAGING |
| 121 | AO ärver kund, fastighet, belopp | Färdig och verifierad | [S] F6.13 (kund, fastighet, belopp); checklistans arv inte kontrollerat | STAGING |
| 122 | Länk offert ↔ AO | Färdig och verifierad | [S] F6.12 (`offerId` på AO) | STAGING |
| 123 | Dubbelkonverteringsskydd | Färdig och verifierad | [S] F6.12b | STAGING |
| 124 | Påminnelseflaggor | Utvecklad, ej slutverifierad | Ingen test funnen | STAGING |
| 125 | Manuell påminnelse | Utvecklad, ej slutverifierad | Ingen test funnen (mailto) | STAGING |
| 126 | Analysdata | Utvecklad, ej slutverifierad | Ingen test funnen | STAGING |
| 127 | Rapporter – offertflik | Utvecklad, ej slutverifierad | Ingen riktad test funnen | STAGING |
| 128 | Säkerhetsverifiering av offertflödet | Delvis färdig | [S] interna fält (GO-8c), token (GO-8a–d), dubbelkonvertering (F6.12b), XSS (X1). Rate-limit aldrig prövad. | STAGING |

#### Leverans G — Driftsstabilitet och platshållare

| # | Funktion | Status | Belägg | Var |
|---|---|---|---|---|
| 130 | Diff-medveten `persist()` | Färdig och verifierad | Överspelad. STAGING-klientens per-element-merge används ([S] F6, md5 oförändrade efter GO). | STAGING |
| 131 | AO-loggfoton i Storage | Färdig och verifierad | [S] GO-8b 14/14, F6.18 | STAGING |
| 132 | AI-arbetsorderinkorg | Ej påbörjad | Specifikation saknas | – |
| 133 | Integrationer (Bokio, Momentum) | Ej påbörjad | Specifikation saknas | – |
| 134 | Säker bildradering | Färdig och verifierad | [S] GO-8b (borttagning); [T] IMG-03 | STAGING |
| 135 | Tidpostfilter (BLOCKER-1) | Färdig och verifierad | Ersatt av `time-entries-list` och RESTRICTIVE-policy ([S] verifierat: egna tidposter, `payroll_view` ser alla) | STAGING |
| 136 | Idempotensnycklar `runDailyCheck`/`service-monitor` | Utvecklad, ej slutverifierad | [T] `service_intervals.test.js`. `service-monitor` är inte aktiverad, och §3 är inte körd. | STAGING |
| 137 | Serverkontroll av AO-bilder | Färdig och verifierad | [S] GO-8b 14/14 | STAGING |
| 138 | Delete-EF, MIME-sniffning, skrivtimeout | Färdig och verifierad | [S] GO-8b; [T] `write_timeout.test.js` | STAGING |
| 139 | STAGING-reconciliation | Färdig och verifierad | [D] `STAGING-FAKTISK-KOD-DIFF`. Följdgapet G1 är öppet (se 4). | Repo/dokument |

#### Leverans H — En kodbas och säker skrivväg

| # | Funktion | Status | Belägg | Var |
|---|---|---|---|---|
| 140 | En kodbas med LIVE-överlägg | Färdig och verifierad | [T] `env_overlay_guard`; [S] rätt projekt i STAGING vid v2 och v3.4 | Repo · STAGING |
| 141 | AO/tid: inget "sparat" före ACK | Färdig och verifierad | [S] F5 (aldrig "sparad" offline), F3 | STAGING |
| 142 | Molnstämpling | Färdig och verifierad | [S] F3, GO-3 G6 (1 tidpost) | STAGING |
| 143 | Skrivtimeout 20 s | Färdig och verifierad | [S] F5; [T] `write_timeout` | STAGING |
| 144 | AO-loggbilder i Storage, ACK-styrt | Färdig och verifierad | [S] GO-8b, F6.18 | STAGING |
| 145 | Säker rendering av inbäddade bilder | Färdig och verifierad | [S] X1 (4 roller, 91 sidvisningar); [T] XSS-01 | STAGING |
| 146 | Serviceintervall: idempotens och översiktssida | Utvecklad, ej slutverifierad | [T] 36 kontroller, SVC-UI-01; inget flöde mot STAGING | STAGING |
| 147 | Kundsidans total med `OfferCalc` | Färdig och verifierad | [T] 120/120 i riktig webbläsare; [S] F6.10 | STAGING |
| 148 | Faktureringskö: visat = fakturerat | Färdig och verifierad | [S] F6.21 | STAGING |
| 149 | Automatisk testsvit | Färdig och verifierad | [T] `run-all.sh` 15/19 gröna, 4 överhoppade (PostgreSQL saknas) | Repo |
| 150 | Aktivitetslogg som egen tabell | Ej påbörjad | Planerad | – |
| 151 | `append_log`/`remove_log` (G5) | Färdig och verifierad | Löst via 196: [S] GO-7 11/11, F4 | STAGING |
| 152 | Historisk bildmigrering (G7) | Ej påbörjad | Planerad; kräver egen plan och GO | – |
| 153 | Prisintegration Solar/Ahlsell | Ej påbörjad | Planerad; första steg CSV-prisimport | – |

#### Leverans I — Webbläsartest av hela systemet

| # | Funktion | Status | Belägg | Var |
|---|---|---|---|---|
| 154 | E2E-svit | Färdig och verifierad | [T] 216/218 (0 misslyckade) 2026-11-26 | Repo |
| 155 | Verktygsrader på mobil | Färdig och verifierad | [T] RESP-*, PAGES-01 | STAGING |
| 156 | Portkodsläcka | Färdig och verifierad | [S] c5-read; [T] PROP-01/02 | STAGING |
| 157 | Dubbel AO-skrivning vid geokodning | Färdig och verifierad | [T] AO-09 | STAGING |
| 158 | Utkorg per användare | Färdig och verifierad | [T] TIME-05 | STAGING |
| 159 | Rabattfältet i offertguiden | Färdig och verifierad | [T] OFF-03 | STAGING |
| 160 | Serviceintervall: besked efter ACK | Färdig och verifierad | [T] SVC-01–03 | STAGING |
| 161 | Offertlänk, roller, personal: "Sparat" vid fel | Färdig och verifierad | [T] OFF-04, ROLE-02, STAFF-02, ADMIN-01 | STAGING |
| 162 | Rondering: pass utan serverns rondering | Färdig och verifierad | [T] RON-01–03 | STAGING |
| 163 | Återkommande: dubbel AO | Färdig och verifierad | [T] REC-01 | STAGING |
| 164 | Exportcentret och importens besked | Färdig och verifierad | [T] EXP-01, IMP-02 | STAGING |
| 165 | Rapporter: Fakturerat och tid per AO | Färdig och verifierad | [T] REP-01 | STAGING |
| 166 | Kön vid återanslutning | Färdig och verifierad | [S] F5; [T] RES-01–04 | STAGING |
| 167 | Snabbare id-uppslag | Färdig och verifierad | [T] PERF-01 | STAGING |
| 168 | Faktura-ROT inkl. moms | Färdig och verifierad | [T] ECO-01 | STAGING |
| 169 | Cachebuster och SW-test | Färdig och verifierad | [S] nivå 0, 0 versionsskillnader; [T] SW-01 | STAGING |
| 170 | Autofokus vid inloggning | Färdig och verifierad | [T] AUTH-06 | STAGING |
| 171 | Läsande STAGING-kontroll | Färdig och verifierad | [S] 11/11 | Repo |
| 172 | G10/G9/G11/G12 | Delvis färdig | G10 → 178 och G12 → 175 klara. G9: [S] ekonomi nekas (403), men serverregeln kräver beslut. G11 är öppen. | STAGING |
| 173 | E2E mot STAGING med testkonton | Delvis färdig | [S] GO-1, GO-3, GO-9, F6–F8. Rondering, serviceintervall, återkommande, import/export och massåtgärder är inte körda (QA V3 åtgärd 6). | STAGING |

#### Leverans J — Stabilisering, UI/UX, releasekandidat och V3

| # | Funktion | Status | Belägg | Var |
|---|---|---|---|---|
| 174 | G5 klient | Färdig och verifierad | [S] F4, GO-7 | STAGING |
| 175 | G12 bekräftad sparning | Delvis färdig | [T] G12-01. Kvar utan serverbekräftelse: Personal inaktivera, Prisgrupper aktivera/inaktivera, "Ta jobbet" (`REGISTER.md`, `FALTSIDOR.md`). | STAGING |
| 176 | Döda dialogknappar | Färdig och verifierad | [T] MODAL-01 | STAGING |
| 177 | Bilagornas metadata (PATCH) | Färdig och verifierad | [S] GO-8a 11/11 | STAGING |
| 178 | G10 ROT/RUT till faktura | Färdig och verifierad | [T] G10-01 | STAGING |
| 179 | G8 inget negativt "att betala" | Färdig och verifierad | [T] G8-01, paritet 120 | STAGING |
| 180 | G13/G9/G6 STAGING-verifiering | Färdig och verifierad | [S] GO-3: G13 36/36, G9 nekad, G6 1 tidpost. Täckningen för G13 är delvis, se PERM-03 i 4. | STAGING |
| 181 | Kartgruppering | Utvecklad, ej slutverifierad | [T] MAP-01 och `map_grouping` (9). I STAGING placeras 0 av 205 jobb (0 koordinater, troligen domänlåst Mapbox-token). | STAGING |
| 182 | Kalender: överlappande händelser | Färdig och verifierad | [T] CAL-02 | STAGING |
| 183 | Designstandard | Färdig och verifierad | [D] visuellt granskad; vidareförd i `V3-KOMPONENTSTANDARD.md` | STAGING |
| 184 | UI som återstår | Delvis färdig | Fastighetskortets flikar (F-06) och flera tomlägen är rättade i nattkörningen. "Klocka"-texter, inline `font-size` m.m.: Källa saknas. | STAGING |
| 185 | Visuella regressioner på mobil | Färdig och verifierad | [T] UI-KV-01, UI-PROP-01, UI-BDG-01 | STAGING |
| 186 | Checklista med tre lägen | Färdig och verifierad | [S] GO-5 8/8, F2, F6.17 | STAGING |
| 187 | Synk av AO mellan enheter | Färdig och verifierad | [T] SYNC-AO-01; [S] F6.11b | STAGING |
| 188 | Testverktyg nivå 0–2 | Färdig och verifierad | [S] körda (GO-3, GO-9) | Repo |
| 189 | Publiceringsväg | Färdig och verifierad | [S] v2 47/47, v3.4 40/40 | Repo · STAGING |
| 190 | Aktivitetslogg undantas från varning | Färdig och verifierad | [T] STG-01; [S] GO-6 | STAGING |
| 191 | `newEntryId()` | Färdig och verifierad | [S] F4; [T] AO-07C | STAGING |
| 192 | Fynd TASK-01 | Färdig och verifierad | Löst via 194 ([S] GO-6 19/19) | STAGING |
| 193 | `offer-public-pdf` och projektdokument saknas | Färdig och verifierad | [S] GO-8c 9/9, GO-8d 13/13 | STAGING |
| 194 | TASK-01 serverregel | Färdig och verifierad | [S] GO-6 19/19 (`store-key-write` v4, nu v5) | STAGING |
| 195 | Aktivitetsflöde append-only | Färdig och verifierad | [S] GO-6. Klientrapporterat och inget revisionsbevis (se 200). | STAGING |
| 196 | G5 serverdel (`work-order-log-write`) | Färdig och verifierad | [S] GO-7 11/11, F4 | STAGING |
| 197 | `e2e-real.js` | Färdig och verifierad | [S] körd (R0, F2–F8) | Repo |
| 198 | Publiceringspaket v2 | Färdig och verifierad | [S] 47/47 | STAGING |
| 199 | Kvar: ekonomikedjan, `ao-time-write`-källa, typvarning | Delvis färdig | Ekonomikedjan automatiserad ([S] F6). `ao-time-write` finns i `vift-v2` (16946d1). Typvarningen: Källa saknas. | Repo |
| 200 | Verifierad revisionslogg | Ej påbörjad | Planerad | – |
| 201 | Delad återhämtning (`recovery.js`) | Färdig och verifierad | [T] 40/40, 26/26; [S] använd i körningar | Repo |
| 202 | Releasekandidat frusen | Färdig och verifierad | [D] genomförd; ersatt av v3.x | Repo |
| 203 | STAGING-klient v2 publicerad | Färdig och verifierad | [S] 47/47, nivå 0 11/11 | STAGING |
| 204 | V3 designsystem | Färdig och verifierad | [S] publicerad (v3 → v3.4), R0, A1 | STAGING |
| 205 | V3 AO-lista | Färdig och verifierad | [S] R0, F6; [T] AOL-01–09 | STAGING |
| 206 | V3 AO-detalj | Färdig och verifierad | [S] F6 via UI; [T] AOD-01–09 | STAGING |
| 207 | V3 dashboard, Mina jobb, säljkort | Färdig och verifierad | [S] R0; [T] DASH-E, FALT | STAGING |
| 208 | V3 rättade fel | Färdig och verifierad | [T] `local_date`, TIME-07 | STAGING |
| 209 | V3 omgång 2 | Färdig och verifierad | [T] DASH-M-01 m.fl.; [S] publicerad | STAGING |
| 210 | V3 slutpolering | Färdig och verifierad | [T] QBAR-01, ECO-V3-01/02; [S] publicerad | STAGING |

### 2.2 Leverans F4 — delar (punkt 73)

| Del | Status | Belägg |
|---|---|---|
| F4-1 Kundimport, generisk motor | Utvecklad, ej slutverifierad | [T] IMP-01 |
| F4-2/3 Fastigheter, objekt, artiklar, prisgrupper, personal | Utvecklad, ej slutverifierad | Config byggd; riktat test: Källa saknas |
| F4-4/5 AO, tid, faktura, ronderingsmall, avvikelse | Utvecklad, ej slutverifierad | [T] IMP-03 (AO-id-dubbletter rättade 2026-11-26) |
| F4-6 Diff- och konfliktvy | Utvecklad, ej slutverifierad | Källa saknas |
| F4-7 Exportcenter | Utvecklad, ej slutverifierad | [T] EXP-01, MISC (kolumnräknaren rättad) |
| F4-8 Stabilisering | Utvecklad, ej slutverifierad | Källa saknas |
| F4-9 Sex saknade register | Utvecklad, ej slutverifierad | Källa saknas |
| F4-10 Import/export-UI på AO, tid, faktura, rondering | Utvecklad, ej slutverifierad | [T] MISC-IMP-01 |
| F4-11 Markerad export | Utvecklad, ej slutverifierad | [T] AOL (massmarkering) |
| F4-12 Relationsdialog | Utvecklad, ej slutverifierad | Källa saknas |
| F4-historicalImport | Utvecklad, ej slutverifierad | Källa saknas |
| F4-13 Riktiga filer (Bokio, Excel, Numbers, Safari iOS) | Ej påbörjad | "Ej testad" |
| Registermatris | (sammanfattning) | **Ej byggt:** filtrerad export för samtliga 17 register, Åter.ronderingar helt, import av kontaktpersoner, materialrader, fakturaunderlag och serviceintervall, egen UI-sida för kontaktpersoner, objekt, materialrader och serviceintervall. Kolumnen "Testad" är "Ej testad" för alla register. |

### 2.3 Blockerare inför v1.0 STAGING (masterplanens tabell)

| Blockerare | Status | Belägg |
|---|---|---|
| A1 `objects_sensitive` i roller | Färdig och verifierad | [S] c5-read per roll |
| A2 RLS på store | Färdig och verifierad | [S] `store_read_by_role` och RESTRICTIVE-skrivspärrar (STAGING). LIVE: nej. |
| A3 Privat bucket för offertbilagor | Färdig och verifierad | [S] GO-8a |
| A4 EF-säkerhet (JWT) | Färdig och verifierad | [S] oinloggad REST och EF ger 401 (QA 2026-11-25) |
| B1 DataSync för offerEvents och offerAttachments | Färdig och verifierad | [S] F6.11b |
| B2 Övriga fem entiteter i DataSync | Utvecklad, ej slutverifierad | Källa saknas |
| C1 Deploy av Edge Functions | Delvis färdig | Alla åtta i masterplanens checklista finns i STAGING (`REFERENSLAGE.md`). LIVE: Källa saknas, sannolikt äldre eller saknas. |
| C2 Secrets för send-offer-email | Utvecklad, ej slutverifierad | EF v11 finns i STAGING; secrets och utskick: Källa saknas |

### 2.4 Framtida modul

| ID | Status | Belägg |
|---|---|---|
| `ROADMAP-UNDERHALL-2026-10-23` Teknisk underhållsplanering (etapp 1–5) | Ej påbörjad | `MASTERPLAN-UNDERHALLSPLAN.md`. Villkorad av godkänd LIVE-release och RLS fas 2. |

---

## 3. Tillkommet sedan 2026-11-24 som saknas i masterplanen

Masterplanen slutar vid punkt 210. Där står fortfarande att 186, 194, 196, 177, 144 och 193 är "EJ installerade, kräver GO" och att V3 är "ej publicerad". Följande har skett sedan dess och finns inte där.

### Installationer i STAGING

| Del | Innehåll | Belägg |
|---|---|---|
| GO-1 och GO-1b | Sex E2E-testkonton, testrollerna `e2e_falt`, `e2e_arbetsledare`, `e2e_ekonomi` och `e2e_begransad` | Installationsplan §6.6, §6.9; nivå 1: 22 OK |
| GO-2 | Backup i databasen och extern kopia, verifierad med md5 och återställningsprov | §6.4c |
| GO-3 | authz-mutation mot riktig server | §6.7: G13 36/36, G9 nekad (403), G6 1 tidpost, 0 säkerhetsavvikelser |
| GO-5 | Checklistans tre lägen (`work-order-checklist-resolve` v2) | 8/8 |
| GO-6 | Uppgifter och aktivitetslogg (`store-key-write` v4, `activity_log_append`) | 19/19 |
| GO-7 | `work-order-log-write` v1 (G5 atomisk) | 11/11 |
| GO-8a | Bilagornas PATCH (`offer-attachment-upload` v13) | 11/11 |
| GO-8b | Bucket `workorder-images` och tre bild-EF:er (CORS `apikey` rättad före deploy) | 14/14 |
| GO-8c | `offer-public-pdf` v1, logotyp i privat bucket `vift-branding` | 9/9 |
| GO-8d | Projektdokument: bucket, tre RPC:er, två EF:er | 13/13 |
| GO-9 | `e2e-real` i riktig webbläsare (R0, F2–F5); rättningar F3/F5 | `a01f38d` |
| C-1/C-2 | `ao-time-write` v5: fältrollen kan spara material, starta jobb och ta jobb | qa-ao-material 17/17; `16946d1` |
| C-4 | lastChanged-trigger (migration `20261125000002`): kundsvar syns för personalen | F6.11b; `2ad290a` |
| C-5 | Läsbehörighet per roll: `store_read_by_role`, `store-key-write` v5, `work-orders-list` v3 (portkod bara till `objects_sensitive`/`ao_edit`) | c5-read 26/26; `e3fca8b`, `921d205` |
| Tidposter | `time-entries-list`: egna tidposter, `payroll_view` ser alla | Sessionsfakta, `SAKERHET-DEL10.md` |
| Testverktyg | `e2e-test-cleanup` v1 och migration `20261125000004` (bara STAGING, får **aldrig** till LIVE) | QA 2026-11-25 §4 |
| Tillfällig funktion | `vift-admin-storage` (nu en 410-stubb) | §6.10 |

### Klientversioner på STAGING

| Version | Innehåll | Status |
|---|---|---|
| V3 | 21 filer | Publicerad 2026-11-24, 21/21 |
| V3.1 | XSS-rättning (C-3, cirka 180 HTML-sänkor), 18 filer | Publicerad och verifierad: X1 4 roller, 91 sidvisningar |
| V3.2 | – | Ersatt, aldrig publicerad |
| V3.3 | Admin-flikar med rå SVG rättade; färgväljaren skrev hela `vift_settings` per input-händelse | Publicerad (A1, RENDER-01, BRAND-01) |
| V3.4 | Nattkörningen, 40 filer | Publicerad 2026-11-25 och verifierad: 40/40, R0, X1, A1, F2–F8; simulerat 216/218 |

### Nattkörningen 2026-11-26

- 34 av 37 vyer omarbetade.
- Kvar: Ronderingsrapport, Offertlista och Säljchanser. Kundkortets brödtext är bara delvis omarbetad.
- Fem funktionsfel rättade, alla med regressionstest:
  - SVC-UI-01 (serviceintervallets sökfält);
  - IMP-03 (AO-id-dubbletter vid import);
  - SYNC-ED-01 (synken ritade om offertguiden och osparade ändringar försvann);
  - TIME-08 (stämpling på annan enhet ritade inte om Tid & stämpla);
  - XSS-01 (offertlistans titel och fler mallar).
- Säkerhet:
  - Personalens Inaktivera kräver `staff_manage`.
  - "Rensa lokal cache" kräver `admin_manage`.
  - Push-diagnostiken visar inga nycklar.
- Övrigt:
  - Löneunderlaget visar "Debiterbart värde".
  - Dashboarden har ett anpassa-läge, och kartan redovisar orsakerna separat.
  - AO-listan märker dubbla nummer med kort id.
  - Faktureringskön är kompakt (PROJECT_STATUS punkt 83 är därmed genomförd).
- Prestanda i riktig STAGING: fakturering 257 → 36 ms, minne 20 → 14 MB.

### Utredningar och händelser

- `SAKERHET-DEL10.md`: beslutspunkterna B1–B5 och fyndet att lönekostnad saknas.
- `KARTA-UTREDNING.md`: 0 av 205 aktiva jobb har koordinater.
- `TESTDATA-INVENTERING.md`: inget raderat; rensning av QA-LOAD är ett separat beslut.
- `REFERENSLAGE.md`: EF-versioner, md5 per nyckel och dubbla AO-nummer (ett par, "AO-001").
- `HANDELSE-ACT-006-007.md`: två uppgifter som ett skript klarmarkerat är återställda med journal.
- UI-UX-inventeringen (65 bilder).
- Händelsen med `vift_settings` (23 skrivningar på 15 s).
- Öppna fynd från QA V3:
  - C-6: material med 0 kr, ej reproducerat, bevakas;
  - C-7: stämplingsnycklar ligger kvar i localStorage efter utloggning, och inloggningen gör fem seriella anrop. Åtgärd: Källa saknas.

---

## 4. Tidigare beslutade funktioner och ambitioner som riskerar att tappas

Var och en av dessa finns i en källa men saknar ägare, nästa steg eller tydlig status.

1. **Teknisk underhållsplanering** (`ROADMAP-UNDERHALL-2026-10-23`, `MASTERPLAN-UNDERHALLSPLAN.md`).
   - En hel modul i fem etapper. Inget är byggt.
   - Villkoret är "godkänd LIVE-release". Varje försening av LIVE skjuter därför modulen framåt utan nytt beslut.
2. **Punkt 129, klickbara rapportunderlag.** Masterplanen säger KLAR, men avsnittet under punkt 77 säger "kvarvarande uppgift". Bara AO-staplarna leder till filtrerade listor. Tid, avvikelser, ekonomi, material och serviceintervall gör det inte.
3. **Punkt 77, rapporternas testlista.** Sju punkter är obockade: webbläsare, periodfilter med verklig data, "Visa poster", stapelklick, XLSX-filnamn, beläggning > 100 %, ekonomi mot fakturor.
4. **Leverans D** (83–91).
   - Rubriken säger "DELVIS BYGGD", men raderna säger KLAR.
   - Ingen av punkterna är prövad mot STAGING utöver att lägga till en kontakt (F6.3).
   - Push till ansvarig (92) är aldrig prövad.
5. **E7** (124–128).
   - Leverans E:s rubrik säger "E5, E6, E7 återstår", men raderna säger KLAR.
   - Påminnelseflaggor, manuell påminnelse, analysdata och offertfliken saknar test.
   - Rate-limit i 128 är aldrig prövad.
6. **F4-registermatrisen och F4-13.**
   - Filtrerad export finns inte i något register.
   - Åter.ronderingar saknas helt.
   - Fyra register saknar import, fyra saknar UI-sida.
   - Riktiga filer (Bokio, Excel, Numbers, Safari iOS) är aldrig prövade.
   - XLSX med DEFLATE64 faller.
7. **Platshållare i Leverans G:** 132 AI-arbetsorderinkorg och 133 Integrationer (Bokio, Momentum). Ingen specifikation finns.
8. **153 Solar/Ahlsell** och första steget, CSV-prisimport via befintlig importmotor.
9. **150** aktivitetslogg som egen tabell, **152/G7** historisk bildmigrering och **200** verifierad revisionslogg.
   - G7 påverkar direkt LIVE:s kända problem med disk-IO och WAL.
10. **79** avancerat behörighetssystem och **82** offline-läge. Båda är uppskjutna utan datum.
11. **`service-monitor`** (40–43).
    - Finns i STAGING, men cron är avstängd och testlistan i §3 är inte körd.
    - Läs-ändra-skriv av `vift_properties` bör göras atomiskt före LIVE.
12. **G11:** DataSync pausar medan fokus står i ett sökfält. Planerad sedan 2026-11-23, men ingen har tagit den.
13. **G1/G4.**
    - Migrationen för `work_order_create` och nummergeneratorn finns inte i något repo.
    - Källorna till `invoice-write` (v9) och `rondering-pass-write` (v3) saknas.
    - Migrationskatalogen i denna arbetskopia saknar `20261125000002`–`04`. CLAUDE.md påstår att katalogen saknas helt; i grenen V3 finns 21 filer, och i `vift-v2` finns 24.
14. **R9B LIVE-releaseplan** (`PLAN-LIVE-RELEASE.md`, "levererad separat 2026-10-25"): **Källa saknas**, filen finns inte i något av repona. LIVE saknar fortfarande R9B:s faktureringsarkitektur.
15. **Funktioner som saknas helt** (enligt blockdokumenten 2026-11-26):
    - "Tillägg" på AO;
    - AO-bilagor (dokument);
    - `contractId` på AO;
    - fastighetsdokument;
    - automatisk skapning av återkommande AO;
    - visning av andras stämplingsstatus i Dagens drift;
    - synk av dashboardlayout mellan enheter;
    - serverlagrade logotyper;
    - eget fakturadatumfält.
16. **Punkt 184, UI-rester.** Inget står längre på "klocka"-texterna, de cirka 1 300 inline-`font-size` eller tryckytorna på 36–38 px (krav 40 px på mobil). Dessutom: F-12 ("Om 1 dagar") och F-02 (ikoner på egen rad) är bara rättade lokalt.
17. **Test av stämpling över sommartidsövergången** (QA V3 åtgärd 7). Ej gjort.
18. **Avveckling av de sex E2E-kontona och e2e-rollerna**, samt beslut om rensning av QA-LOAD (cirka 1 000 poster).

---

## 5. Beroenden mellan återstående moment

| Moment | Kräver |
|---|---|
| **LIVE-installation** (C-5, `ao-time-write` v5, lastChanged, GO-5–GO-8, `time-entries-list`, klient v3.x) | En godkänd LIVE-plan och G4/G1, så att källorna kan återskapas. Dessutom backup av LIVE, kontroll av RPC-ägarrollen i LIVE, fil-diff mellan LIVE och STAGING samt att LIVE först får STAGING:s grund: R9B och Oct18-migrationerna, `ao-time-write`, RPC:er och RESTRICTIVE-policyer i samma ordning som STAGING. `e2e-test-cleanup` utesluts. |
| LIVE-planens innehåll (C-5-regler) | Beslut B1–B5 och om fältrollens `ao_complete`/`ao_view_all`, annars måste reglerna ändras igen efter LIVE |
| LIVE-planens säkerhetsgrind | Utökad PERM-03/G13 mot STAGING (objektformade nycklar som `vift_settings`, ändring och borttagning av befintliga poster, skrivning av hel nyckel, fältnivå) och att de fyra PostgreSQL-testerna körts gröna |
| AO-nummergenerator (unik kontroll och serie över högsta nummer) | G1: källan för `work_order_create` och displayNumber-migrationen i repot. Test i STAGING. Ska ingå i LIVE-planen, så att LIVE får rätt generator från start. |
| B5 fältvis sammanslagning för portkoder | Beslut B5, ändring i `store-key-write`, konsekvensanalys, backup och rollback |
| B1 inköpspriser dolda för fält | Beslut B1, projektion av `vift_articles` och ett materialformulär som inte behöver `buyPrice` |
| B4 aktivitetslogg per roll | Beslut B4 och radprojektion motsvarande `work-orders-list` |
| Verklig lönekostnad i Löneunderlag | Lönedata i en egen tabell med egen RLS (B3) och beslut om CSV-kolumnen |
| Kartan i STAGING och LIVE | Lucas kontroll av Mapbox-tokenens domän, sedan beslut om engångsgeokodning (backup och journal), sedan rättning i AddressService (fel ≠ ingen träff) och postnummer/ort i AO-importen |
| `service-monitor` aktiv | Manuella tester enligt §3, aktiveringsbeslut och atomisk skrivning av `vift_properties` (före LIVE) |
| G7 historisk bildmigrering | Egen plan, backup och GO. Bör vägas in i LIVE-planen på grund av IO och WAL i LIVE. |
| 150 aktivitetslogg som tabell | Migration och ändring i `store-key-write` |
| 200 verifierad revisionslogg | Källorna för de skrivande RPC:erna i repot (G4: `invoice-write` saknas) |
| G9 serverregel för ekonomi | Affärsbeslut (smal regel `klar` ↔ `fakturerad`) |
| Intern kommentar på faktura-PDF | Beslut: intern eller kundsynlig |
| `vift_settings` per nyckel och skydd för sista superadmin | Ändring i server/`state.js` och `StaffPage`; ingen extern beroende |
| Funktionell verifiering av rondering, serviceintervall, återkommande, import/export, rapporter, Leverans D och E7 | Testkonton (finns) och tillägg i `e2e-real`. För fältrollens rondering: beslut om `ao_view_all`. |
| F4-13 och CSV-prisimport (153, steg 1) | Riktiga exportfiler (Bokio, Excel, Numbers) |
| Avveckling av E2E-konton | Att de sista STAGING-testerna (ovan) är klara |
| Rensning av QA-LOAD | Beslut, backup, referenskontroll mot skickade och betalda underlag |
| Teknisk underhållsplanering | Godkänd LIVE-release, RLS fas 2 och produktbeslut (enligt modulens egen villkor) |
| 132 och 133 | Specifikation från Lucas |

---

## 6. Rekommenderad ordning för nästa större utvecklingsomgång

1. **Behörighetsbeslut B1–B5** och de anknutna rollfrågorna.
   - Rollfrågorna gäller fältrollens `ao_complete` och `ao_view_all` (rondering), "Starta arbete" i AO-detaljen, G9 och om fältet ska se timpriser.
   - *Motivering:* bara beslut, ingen kod. Avgör vilka serverregler LIVE ska få. Tas de efter LIVE måste C-5-reglerna installeras två gånger.
2. **G4/G1 komplett i repot.**
   - Hämta källorna till `invoice-write`, `rondering-pass-write` och `work_order_create` med displayNumber-migrationen.
   - Synka migrationerna `20261125000002`–`03` och `ao-time-write`/`work-orders-list` till VIFT-CRM-arbetskopian, utan `20261125000004` och `e2e-test-cleanup` i LIVE-spåret.
   - *Motivering:* förutsättning för både AO-nummergeneratorn och en återskapbar LIVE-installation.
3. **Säkerhets- och databastester.**
   - Kör de fyra PostgreSQL-testerna i en miljö med PostgreSQL: `checklist_progress_sql`, `server_rpcs_sql`, `staging_backup_export` och `offer_attachment_upload` del 2–3.
   - Utöka PERM-03/G13 i `authz-mutation` mot riktig STAGING: objektformade nycklar, ändring och borttagning av befintliga poster, skrivning av hel nyckel, fältnivå.
   - *Motivering:* BLOCKER-2 är bara delvis prövad (skapa ny post i nio register). Det ska vara klart innan LIVE-planen godkänns.
4. **AO-nummergenerator.**
   - Unik constraint, en serie som börjar över högsta befintliga nummer och kontroll mot id-nummer.
   - Installeras och testas i STAGING. Befintliga nummer ändras inte.
   - *Motivering:* ett känt dataintegritetsfel. LIVE ska inte få den felaktiga generatorn.
5. **Små korrektheter som bör finnas före LIVE.**
   - Beslut om den interna kommentaren på faktura-PDF:en.
   - Skydd mot att inaktivera sig själv eller sista superadmin.
   - Sammanslagning per nyckel för `vift_settings`.
   - De sista G12-vägarna: Personal, Prisgrupper och "Ta jobbet".
   - `WorkOrdersPage.onSyncStatusChanged`.
   - Säker utloggning (C-7, stämplingsnycklar).
   - Bevakning av C-6.
   - *Motivering:* små ändringar med verklig risk för data eller behörighet. De är billiga att testa i samma omgång.
6. **Funktionell STAGING-verifiering av de moduler som bara är simulerat testade.**
   - Rondering, serviceintervall (inklusive §3 för `service-monitor` och aktiveringsbeslut), återkommande, import/export med riktiga filer (F4-13), massåtgärder, rapporter (punkt 77:s lista), Leverans D och E7.
   - Även riktig push och e-post, om secrets finns.
   - *Motivering:* flyttar cirka 50 av de 88 "utvecklade" punkterna till verifierade, och visar om LIVE-planen behöver fler serverändringar.
7. **LIVE-plan: skriva, granska och få godkänd** (genomförs av Lucas efter beslut).
   - Fil-diff mellan LIVE och STAGING, backup och återställning per steg, och kontroll av RPC-ägarrollen i LIVE.
   - Ordning: först grunden (R9B, `ao-time-write`, RPC:er, RESTRICTIVE), sedan C-5, lastChanged och GO-5–GO-8, sedan klient v3.x via FTP.
   - Ta ställning till G7 (historiska bilder) med tanke på LIVE:s IO.
   - *Motivering:* masterplanens egen princip är "bygg inte stora nya funktioner förrän … fungerar stabilt live". Punkt 1–6 gör planen genomförbar.
8. **Kartan.**
   - Lucas kontrollerar Mapbox-tokenens domän och beslutar om engångsgeokodning.
   - Därefter rättas felhanteringen i AddressService, och AO-importen får postnummer och ort.
   - *Motivering:* synligt fel på dashboarden, men inte en säkerhetsfråga. Delvis ett kontobeslut.
9. **Kvarvarande vyer och UI-rester.**
   - Ronderingsrapport, offertlista, säljchanser, kundkortets brödtext och stegvis rendering av långa register.
   - Tryckytor ≥ 40 px, F-12 och F-02 globalt, samt kontrast med egna varumärkesfärger (`--brand-primary-text`).
   - *Motivering:* låg risk, hög synlighet. Görs efter säkerhet och LIVE-förberedelse.
10. **Kostnad och spårbarhet efter LIVE:** 150 (aktivitetslogg som tabell), 200 (verifierad revisionslogg) och G11.
11. **Städning:** avveckla E2E-konton och e2e-roller efter sista STAGING-test, och fatta beslut om rensning av QA-LOAD.
12. **Framtid**, efter godkänd LIVE-release och i denna ordning:
    1. CSV-prisimport (153, steg 1);
    2. teknisk underhållsplanering, etapp 1 (datamodell);
    3. 133 integrationer;
    4. 132 AI-inkorg.

    De två sista först när det finns en specifikation.
