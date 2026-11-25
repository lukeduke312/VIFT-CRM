# Ingen serverkod här (KÄLLA-1)

**Serverkod finns endast i `lukeduke312/VIFT-CRM`, gren `claude/vift-system-restructure-8fUme`,
katalog `supabase/`.** Lokalt är det arbetskopian `/home/user/vift-v2`
(`git -C /home/user/vift-v2 remote -v` ger `https://github.com/lukeduke312/VIFT-CRM`).
Servercommit vid flytten: commit `fb71f26eef576937896ab5dab7be42557fd5c06d` (MIG-1; T3-0-verktygen i föregående commit fd576b5).

Beslut: BESLUT-2026-11-28, KÄLLA-1, alternativ A. `vift-v2/supabase` är den enda auktoritativa
serverkodbasen. Där finns:
- databasmigrationer (`migrations/`, `MIGRATIONSORDNING.txt`, `MIGRATIONSMAPPNING.md`);
- Edge Functions (`functions/`) och `config.toml`;
- STAGING-only (`staging-only/`) och manuella körningar (`manual/`);
- STAGING-inventeringen (`inventering/`).

Denna katalog innehöll tidigare en inaktuell spegel: 21 migrationer, varav 3 oapplicerade
PROPOSAL-filer, äldre EF-versioner och `manual/`. Spegeln togs bort 2026-11-28 (T3-0). Före
flytten jämfördes varje fil med vift-v2: alla fanns där, oförändrade eller i vift-v2:s
Git-historik. Historiken finns kvar i Git i denna gren. Detsamma gäller de tidigare filerna
`supabase-setup.sql` och `push_subscriptions.sql` i klientroten, som är kvar i vift-v2:s rot.

**Regler**
- Kör aldrig `supabase db push`, `supabase functions deploy` eller `supabase migration repair`
  från klientgrenen.
- Installation sker bara från den auktoritativa källan och bara efter godkännande av Lucas
  Samuelsson. Se `vift-v2/supabase/INSTALLATIONSUNDERLAG-MIGRATIONER.md`.
- Klienttester som behöver serverkällan läser den via `tests/lib/serverkalla.js`
  (`VIFT_SERVER_ROOT`, standard `/home/user/vift-v2/supabase`). Saknas källan underkänns testet;
  det hoppas inte över.
- `tests/serverkalla_guard.test.js` underkänns om serverkod återinförs här: `supabase/migrations`,
  `supabase/functions`, `config.toml` eller `.sql`-filer för installation.
