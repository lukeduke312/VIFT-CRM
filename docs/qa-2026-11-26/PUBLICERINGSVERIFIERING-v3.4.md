# Verifiering av publicerad v3.4 på STAGING (2026-11-25)

**Resultat: godkänd.** Allt nedan är kört mot den publicerade webbplatsen `staging-crm.viftfast.se` och den riktiga STAGING-servern. LIVE är inte kontaktat.

| Kontroll | Resultat |
|---|---|
| Filer mot `MANIFEST-v3.4.txt` (SHA-256) | **40/40 identiska** (`tools/verify-staging-deploy.sh`) |
| `index.html` på webbplatsen | Samma kontrollsumma som i paketet (`35425649…`) |
| Alla filer som `index.html` refererar | **93/93 svarar 200** |
| Nya CSS-filer med rätt version | `v3-dashboard ?v=3`, `v3-aolist ?v=2`, `v3-aodetail ?v=2`, `v3-billing ?v=2`, `v3-admin ?v=3`, `v3-misc ?v=11`, `v3-service ?v=3`, `v3-falt ?v=2`, `v3-register ?v=2`, `v3-offers ?v=1`: alla laddas |
| Laddas i webbläsaren | Alla lokala stilmallar har regler, och inga JS-fel uppstod vid 81 sidvisningar (37 vyer dator, 37 mobil, 7 fältroll) |
| R0: sex roller, alla tillåtna sidor | **6/6**, inga JS-fel (admin 37, chef 28, ekonomi 15, fält 7+7, begränsad 6) |
| A1: Admin, dator och mobil | **2/2**: 11 avsnitt med ikoner som SVG, ingen markup som text |
| X1: lagrad XSS, 4 roller, 91 sidvisningar | **4/4**: inget skript kördes |
| Miljö | Inga anrop till andra Supabase-projekt |

## Verksamhetsdata

- **Mina kontroller har inte ändrat något.** Senaste skrivning i hela `store` var 09:21:45 UTC, före mina prov.
- **Alla nycklar utom två** är identiska med referensen från morgonens paketprov.
- **`vift_workOrders` och `vift_activityLog`** ändrades efter uppladdningen av STAGING-administratörens eget konto, från en Windows/Chrome-klient. AO `AO-62bd54f9…` skapades 09:18, redigerades 09:20 och checklistan ändrades 09:21:45. Det är inte mina tester, och jag har inte rört det.
- **Falsklarm i R0/A1/X1:** testverktygets kontroll av affärsposter flaggade "ACT-003 ändrad". Servern visar oförändrad kontrollsumma för `vift_activities` (`5b55cf10f640`, senast skriven 07:55). Felet var att ett "ä" lästes fel i verktygets ögonblicksbild. Det är ett fel i testverktyget och står i problemlistan (#28).

## Observation om testmiljön (inte ett fel i systemet)

- Testmiljöns nät (proxyn) avbröt slumpvis en enskild CSS-fil per sidladdning, varje gång en annan fil. Sidan ritades då fel, till exempel med mobilens bottenmeny överst på datorbredd.
- Med upprepade hämtningar svarar alla filer 200. Skärmbilderna i bildpaketet är tagna först när alla stilmallar bekräftats laddade.
- Gårdagens bilder av publicerade v3.3 kan ha samma fel och är märkta så i bildpaketet.
- Ser du något liknande i en vanlig webbläsare (sällan, men möjligt om webbhotellet avbryter samtidiga hämtningar), säg till. Då behöver det undersökas hos Loopia.
