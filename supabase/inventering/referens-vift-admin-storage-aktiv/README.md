# REFERENS: den aktiva versionen av vift-admin-storage (ALDRIG LIVE)

`index.ts` i den här katalogen är repots tidigare, **aktiva** version av den tillfälliga
underhållsfunktionen `vift-admin-storage`. Den kunde ladda upp logotypen till
`vift-branding` och ta bort testobjekt, och krävde behörigheten `all`. Den sparades här
2026-11-27 (G1/G4 del 2) som referens.

- Den får **aldrig** deployas, varken till LIVE eller igen till STAGING utan nytt beslut.
- Den deploybara versionen är 410-stubben i `supabase/staging-only/functions/vift-admin-storage/`,
  som är identisk med STAGING v8.
- Katalogen ligger under `inventering/` och inte under `functions/`, så den kommer inte med
  i någon deploy.
