# Auktoritativ källa för server och klient (G1/G4 del 2, 2026-11-27)

Det här är ett förslag tills Lucas Samuelsson har fastställt det. Det ändrar ingenting i
VIFT-CRM.

## Uppdelning

| Del | Auktoritativ kodbas | Omfattning |
|---|---|---|
| **Server** | `lukeduke312/VIFT-CRM` i arbetskopian **vift-v2**, gren `claude/vift-system-restructure-8fUme`, katalogen **`supabase/`** | `migrations/` + `MIGRATIONSORDNING.txt` (databas), `functions/` (Edge Functions), `config.toml` (verify_jwt), `staging-only/` (aldrig LIVE), `manual/` (manuella körningar efter godkännande), `inventering/` (STAGING-ögonblicksbild som referens, ändras inte) |
| **Klient** | VIFT-CRM, gren **`claude/vift-v3-major-redesign`** | `index.html`, `src/`, `public-offer.html`, `service-worker.js`, `config.js` och klienttester |

Servern verifieras med `tests/local/migrationskedja.sh`, som kör hela kedjan mot tom lokal
PostgreSQL och jämför mot STAGING. Varje ny servermigration ska läggas till i
`supabase/MIGRATIONSORDNING.txt` och få kedjan att förbli grön.

## Läget i VIFT-CRM:s `supabase/` (gren `claude/vift-v3-major-redesign`, 6181e7c)

- `supabase/migrations/` har **21 filer**. Alla 21 är byte för byte lika med filer i vift-v2,
  men tre av dem (`*_PROPOSAL_*`) har i vift-v2 flyttats till
  `supabase/forslag-ej-applicerade/`, eftersom de aldrig applicerats i STAGING.
- VIFT-CRM **saknar** 28 filer som vift-v2 nu har:
  - 17 migrationer som är återställda ur STAGING:s historik,
  - 3 kandidater för de tomma migrationerna,
  - 5 rekonstruerade migrationer,
  - 20261125000002 och 20261125000003,
  - `MIGRATIONSORDNING.txt`.
- `supabase/functions/` i VIFT-CRM saknar `invoice-write`, `rondering-pass-write` och
  `_shared/public-base-url.ts`. Där finns också de äldre versionerna av offer-respond,
  offer-token-validate, send-offer-email, get-/set-sensitive-fields och send-push.

## Förslag: VIFT-CRM:s `supabase/` får inte divergera

Rekommendation **A**, enklast och säkrast:
1. Ta bort `supabase/` ur klientgrenen, eller ersätt katalogen med en `supabase/README.md`
   som bara säger "Serverkällan finns i vift-v2/supabase (se AUKTORITATIV-KALLA.md). Kör
   aldrig `supabase db push` eller `supabase functions deploy` härifrån."
2. Lägg till en CI- eller testkontroll i klientgrenen som fallerar om
   `supabase/migrations/` eller `supabase/functions/` innehåller filer.

Alternativ **B**, om katalogen måste finnas kvar i klienten (t.ex. för klienttester som
läser `supabase/migrations/20261125000001_offer_attachment_patch.sql`):
1. Märk den som **inaktuell spegel** med en README överst och döp om den till
   `supabase-spegel/`, så att Supabase CLI inte hittar den.
2. Synka den enbart med ett skript som kopierar från vift-v2:s `supabase/` och kontrollerar
   sha256 per fil. Ingen handredigering.
3. Klienttester som läser servermigrationer pekar om till spegeln.

Ingen av varianterna är genomförd. VIFT-CRM har inte ändrats i den här omgången.

## Regler

- Servermigrationer, Edge Functions och `config.toml` ändras **bara** i vift-v2/`supabase/`.
- Ingen deploy från en kodbas som inte är den auktoritativa.
- STAGING-only ligger i `supabase/staging-only/` och finns aldrig i `migrations/` eller `functions/`.
- `PUBLIC_BASE_URL` sätts per miljö som Edge Function-secret. Det finns inget reservvärde i koden.
