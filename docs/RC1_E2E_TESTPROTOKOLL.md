# VIFT CRM 1.0.0 RC1 — E2E-testprotokoll
Datum: 2026-07-20  
Testmiljö: _______________  
Testare: _______________

## Resultatlegenda
- **GODKÄND** — flödet fungerar som förväntat
- **UNDERKÄND** — fel, krasch eller felaktigt beteende observerat
- **BLOCKERAD** — kan inte testas (saknar förutsättning, ej driftsatt)
- **EJ TESTBAR** — utanför scope, t.ex. kräver hårdvara eller live-tjänst

---

## A. AO-flöde (arbetsorder)

### A1. Skapa AO via FastighetsObjectsida
| Steg | Förväntat | Resultat | Notering |
|------|-----------|----------|----------|
| Öppna fastighetsobjekt med registrerad portkod | Portkod syns i tabellen (om användaren har objects_sensitive) | _______ | |
| Skapa AO från objektvyn | Wizard öppnas, accessCode-fältet är förfyllt för behörig roll | _______ | |
| Skapa AO utan objects_sensitive | accessCode-fältet är tomt i wizarden | _______ | |
| Spara AO | AO skapas, syns i AO-listan, status "ny" | _______ | |

### A2. AO-detalj och statushantering
| Steg | Förväntat | Resultat | Notering |
|------|-----------|----------|----------|
| Öppna AO-detalj som admin | Portkod visas om tilldelad | _______ | |
| Öppna AO-detalj som fastighetsskötare (utan objects_sensitive) | Portkod visas INTE | _______ | |
| Ändra status via dropdown | Status sparas, tidsstämpel uppdateras | _______ | |
| Attest av AO | Attesteringsknapp syns för rätt roll | _______ | |

### A3. CalendarPage — AO-schemaläggning
| Steg | Förväntat | Resultat | Notering |
|------|-----------|----------|----------|
| Öppna kalendern, veckovy | AO:n syns som chip på rätt dag | _______ | |
| Long-press (480 ms) på AO-chip (mobil) | Förflyttningsläge aktiveras | _______ | |
| Dra AO till annan dag | AO byter datum, scroll blockeras ej | _______ | |
| Tangentbord-flöde: klick på AO | Detalj-modal öppnas | _______ | |

---

## B. Offertflöde

### B1. Skapa och skicka offert
| Steg | Förväntat | Resultat | Notering |
|------|-----------|----------|----------|
| Skapa ny offert (FastighetsDetailPage → Offertknapp) | Offertformulär öppnas | _______ | |
| Lägg till offertrader (artikel/textrad) | Summering uppdateras live | _______ | |
| Skicka offert via e-post | EF send-offer-email anropas, toast visas | _______ | |
| Bifoga fil (PDF/bild) | Upload via offer-attachment-upload, fil syns i listan | _______ | |
| Ladda ner bilaga | Signerad URL hämtas, nedladdning startar | _______ | |
| Dubbelklick på "Skicka" | Andra klick blockeras (idempotensguard 5 min) | _______ | |

### B2. Kund-vy (publik token)
| Steg | Förväntat | Resultat | Notering |
|------|-----------|----------|----------|
| Öppna /#/offer/<token> | Kundvy visas med offertinnehåll | _______ | |
| Kundvy visar inte interna fält | lockedSnapshotJSON, TB, marginal etc saknas | _______ | |
| Kund godkänner offert | offer-respond EF kallas, status → godkänd | _______ | |
| Kund försöker svara igen | 403 Forbidden (idempotensguard) | _______ | |
| Utgånget token | 410 Expired-sida visas | _______ | |

---

## C. Rondering (serviceintervall)

### C1. Serviceintervall på objekt
| Steg | Förväntat | Resultat | Notering |
|------|-----------|----------|----------|
| Öppna fastighetsobjekt → fliken Serviceintervall | Lista visas (kan vara tom) | _______ | |
| Skapa nytt serviceintervall | Formulär sparas, rad visas i listan | _______ | |
| Redigera intervall (period, ansvarig) | Ändringar sparas korrekt | _______ | |
| Ta bort intervall | Raden försvinner, inga spår i state.properties[].serviceIntervals | _______ | |

### C2. service-monitor EF
| Steg | Förväntat | Resultat | Notering |
|------|-----------|----------|----------|
| Manuell anrop av service-monitor (med SERVICE_ROLE_KEY) | Returnerar { checked, notified, aoGenerated } | _______ | |
| Kör en gång med samma data | Inga dubbelnotiser (idempotens via lastNotificationSentForDueDate) | _______ | |
| Kör utan giltig auth | 401 Unauthorized | _______ | |

---

## D. Personal (behörighetssystem)

### D1. objects_sensitive-rättighet
| Roll | Kan se portkod i objektvy | Kan se portkod i AO-wizard | Kan se portkod i AO-detalj | Kan exportera känsliga fält |
|------|--------------------------|---------------------------|---------------------------|-----------------------------|
| admin | _______ | _______ | _______ | _______ |
| förvaltare | _______ | _______ | _______ | _______ |
| arbetsledare + objects_sensitive | _______ | _______ | _______ | _______ |
| fastighetsskötare (inga extra rättigheter) | EJ SYNLIG | EJ SYNLIG | EJ SYNLIG | EJ SYNLIG |

### D2. AdminPage — rättighetstilldelning
| Steg | Förväntat | Resultat | Notering |
|------|-----------|----------|----------|
| Öppna Admin → Roller → arbetsledare | Gruppen "Säkerhet & Åtkomst" syns | _______ | |
| Kryssa i "Visa känsliga fält (portkod, nyckel, larm)" | Rättigheten objects_sensitive sparas | _______ | |
| Logga in som den redigerade rollen | Känsliga fält visas nu | _______ | |
| Ta bort rättigheten | Känsliga fält döljs igen | _______ | |

### D3. Direkt URL-skydd
| Steg | Förväntat | Resultat | Notering |
|------|-----------|----------|----------|
| Navigera direkt till /#/payroll utan rätt roll | Omdirigeras till startsida | _______ | |
| Navigera direkt till /#/reports utan rätt roll | Omdirigeras till startsida | _______ | |
| Navigera direkt till /#/admin utan admin-roll | Omdirigeras till startsida | _______ | |

---

## E. Import/Export

### E1. CSV-import
| Steg | Förväntat | Resultat | Notering |
|------|-----------|----------|----------|
| Ladda upp kundlista (CSV) | Förhandsvisning visas med kolumnmappning | _______ | |
| Importera med historicalImport=true | Inga automatiska AO, notiser eller faktureringsactions | _______ | |
| Dublettdetektering (samma kundnamn) | Varning eller merge-dialog visas | _______ | |

### E2. Export
| Steg | Förväntat | Resultat | Notering |
|------|-----------|----------|----------|
| Exportera kunder som XLSX | Fil laddas ner med korrekt kolumner | _______ | |
| Känsliga fält (portkod) ingår EJ som standard | Sensitive-toggle är av, portkod saknas i export | _______ | |
| Aktivera känsliga fält som admin | Toggle visas, portkod inkluderas | _______ | |
| Försök aktivera som fastighetsskötare (utan rättighet) | Toggle syns INTE | _______ | |

---

## F. Mobil smoke-test

| Viewport | Startsida | Navigation | AO-wizard | Modal | Import-wizard | Resultat |
|----------|-----------|------------|-----------|-------|----------------|----------|
| 320 px | _______ | _______ | _______ | _______ | _______ | _______ |
| 375 px | _______ | _______ | _______ | _______ | _______ | _______ |
| 390 px (iPhone 14) | _______ | _______ | _______ | _______ | _______ | _______ |
| 768 px (iPad) | _______ | _______ | _______ | _______ | _______ | _______ |
| 1440 px (desktop) | _______ | _______ | _______ | _______ | _______ | _______ |

Specifika kontroller:
- [ ] Safe-area-inset (notch/home-indicator) orsakar inte innehållsklippning
- [ ] Lång-press 480 ms i kalender fungerar utan att trigga kontextmeny (browser)
- [ ] Import-mappning visar en kolumn per rad på 420 px (ej overflow)
- [ ] Bilage-rad wrappas korrekt på 420 px
- [ ] Statkortet täcker ≥50 % av bred vid 479 px
- [ ] Inga horisontella scrollbars på 320 px

---

## Sammanfattning

| Flöde | Antal testfall | Godkända | Underkända | Blockerade | Ej testbara |
|-------|----------------|----------|-----------|------------|-------------|
| A. AO-flöde | 8 | | | | |
| B. Offertflöde | 10 | | | | |
| C. Rondering | 6 | | | | |
| D. Personal | 12 | | | | |
| E. Import/Export | 8 | | | | |
| F. Mobil | 30+ | | | | |
| **Totalt** | **74+** | | | | |

Testprotokollet godkänt för RC1: ____________________  Datum: __________
