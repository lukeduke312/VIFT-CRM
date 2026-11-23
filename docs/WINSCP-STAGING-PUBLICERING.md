# VIFT CRM — publicera STAGING med WinSCP

Gäller publiceringspaketet **VIFT-CRM-STAGING-2026-11-24-v2** (se `MANIFEST-v2.txt`). Äldre zip-filer med namnet `…-2026-11-24-publicering.zip` (utan `v2`) är **ersatta** och får inte laddas upp.

Publicera bara efter GO. Det här rör **bara STAGING** (`staging-crm.viftfast.se`), aldrig LIVE (`crm.viftfast.se`).

## 1. Anslut

1. Öppna WinSCP och logga in på Loopias FTP med samma uppgifter som när LIVE publiceras med FileZilla. Värd och användare står i Loopia Kundzon under "FTP".
2. Gå till mappen som **STAGING-webbplatsen** serveras från. Kontrollera att det är rätt mapp, så att filerna inte laddas upp i LIVE:
   - Mappen ska innehålla `index.html`, `config.js`, `public-offer.html`, `service-worker.js` och mappen `src/`.
   - **Den ska innehålla filen `staging-banner.js`.** Den filen finns bara i STAGING.
   - Öppna `src/data/storage.js` i WinSCP (visa, inte redigera). Raden `SUPABASE_URL` ska innehålla `yyzljlqyzzcbxmcdbual`. Står det `hjplzjsbbowiyoyhdghc` är det **LIVE**, och du ska avbryta.

## 2. Ta en egen kopia (rekommenderas)

Ladda ner hela mappen `src/` samt `index.html` och `public-offer.html` till en mapp på datorn, till exempel `STAGING-före-2026-11-24`. Återställningspaketet innehåller samma filer, men en egen kopia är en extra säkerhet.

## 3. Ladda upp

Packa upp `VIFT-CRM-STAGING-2026-11-24-v2-publicering.zip` på datorn. Den innehåller bara filer som ska ersättas eller läggas till: `src/…`, `index.html` och `public-offer.html`.

1. **Först:** dra mappen `src/` från det uppackade paketet till STAGING-mappen. Välj **"Skriv över"** för alla filer. Inga filer ska tas bort.
2. **Sist:** ladda upp `index.html` och `public-offer.html` och skriv över.

Rör inte följande:
- `config.js`, eftersom den innehåller STAGING-inställningarna och inte ingår i paketet
- `staging-banner.js`, `service-worker.js` och `manifest.json`
- `assets/` och övriga filer eller mappar som inte finns i paketet

## 4. Verifiera

Meddela Claude att uppladdningen är klar. Claude kör:

1. `tools/verify-staging-deploy.sh MANIFEST-v2.txt`. Den hämtar varje fil som webbplatsen faktiskt levererar och jämför SHA-256 med manifestet. Alla filer ska vara identiska.
2. Nivå 0 (`tests/e2e/staging-readonly.js`). Versionsjämförelsen ska visa att STAGING har samma versioner som paketet.

Själv kan du öppna `https://staging-crm.viftfast.se`, göra en hård omladdning (Ctrl+Shift+R) och kontrollera:
- den gula etiketten "STAGING · TESTMILJÖ" syns;
- inloggningen fungerar;
- checklistan i en arbetsorder har knappen "Påbörja", förutsatt att servern har installerats (installationsplan §2g).

## 5. Återställning

Om något är fel:

1. Packa upp `VIFT-CRM-STAGING-2026-11-24-aterstallning.zip`. Den innehåller filerna exakt som de låg på STAGING före publiceringen (`26ce058`).
2. Ladda upp `src/` först och skriv över, och därefter `index.html` och `public-offer.html`.
3. Följande nya filer kan ligga kvar utan att användas: `src/pages/ServiceIntervalsPage.js`, `src/services/MapGrouping.js` och `src/services/WorkOrderImageService.js`.
4. Claude verifierar återställningen mot återställningsmanifestet.
