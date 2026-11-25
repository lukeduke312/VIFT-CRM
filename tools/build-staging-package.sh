#!/usr/bin/env bash
# Bygger STAGING-publiceringspaketet (VIFT CRM) i en arbetskopia av
# STAGING-repot. Ändrar ingenting i STAGING eller LIVE.
#
#   tools/build-staging-package.sh <staging-arbetskopia> <publicerad-commit>
#
# - Grund: den PUBLICERADE STAGING-versionen (Loopia), t.ex. branchen
#   chatgpt/staging-all-blockers-2026-11-17 (26ce058).
# - Klientfiler kopieras från HEAD i detta repo (docs/, tests/, supabase/,
#   tools/ följer inte med).
# - config.js behålls från STAGING.
# - STAGING-överlägget återinförs med trevägssammanslagning mot
#   baslinjen 56a943d (där LIVE-överlägget infördes) för storage.js,
#   AuthService.js och index.html; public-offer.html får STAGING-adressen.
# - Avbryter vid sammanslagningskonflikt eller om LIVE-projektet finns kvar
#   någon annanstans än i återställningslänkarna i AuthService.js.
set -euo pipefail
W="$1"; DEPLOYED="$2"; BASE=56a943d
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LIVE_REF=hjplzjsbbowiyoyhdghc
STG_URL=$(git -C "$W" show "$DEPLOYED:src/data/storage.js" | sed -n "s/^const SUPABASE_URL *= *'\(.*\)';/\1/p")
[ -n "$STG_URL" ] || { echo "Hittar inte STAGING-adressen i publicerad storage.js"; exit 1; }
case "$STG_URL" in *$LIVE_REF*) echo "Publicerad storage.js pekar på LIVE — avbryter"; exit 1;; esac
git -C "$W" checkout -q "$DEPLOYED" -- .
cd "$REPO"
n=0
for f in $(git ls-tree -r --name-only HEAD | grep -v '^docs/\|^tests/\|^supabase/\|^tools/\|^\.gitignore$\|^CLAUDE.md$\|^README'); do
  case "$f" in config.js|src/data/storage.js|src/services/AuthService.js|index.html|public-offer.html) continue;; esac
  if [ ! -f "$W/$f" ] || ! cmp -s <(git show "HEAD:$f") "$W/$f"; then mkdir -p "$W/$(dirname "$f")"; git show "HEAD:$f" > "$W/$f"; n=$((n+1)); fi
done
T=$(mktemp -d)
for f in src/data/storage.js src/services/AuthService.js index.html; do
  git show "HEAD:$f" > "$T/cur"; git show "$BASE:$f" > "$T/base"; git -C "$W" show "$DEPLOYED:$f" > "$T/oth"
  if ! git merge-file -p "$T/cur" "$T/base" "$T/oth" > "$W/$f"; then
    # T3-B (2026-11-28): index.html får konflikter som BARA gäller ?v=-numren (den
    # publicerade versionen byggdes från en annan commit). Paketet innehåller HEAD:s
    # klientfiler, så HEAD:s ?v=-nummer är de rätta. Allt annat ger fortfarande avbrott.
    if [ "$f" = index.html ] && node -e '
      const s = require("fs").readFileSync(process.argv[1], "utf8");
      const re = /<<<<<<< [^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> [^\n]*\n/g; let m, ok = true, n = 0;
      const utanV = (x) => x.replace(/\?v=\d+/g, "?v=");
      while ((m = re.exec(s))) { n++; if (utanV(m[1]) !== utanV(m[2])) ok = false; }
      process.exit(ok && n > 0 ? 0 : 1);' "$W/$f"; then
      cp "$T/cur" "$W/$f"; echo "index.html: konflikterna gällde bara ?v= — HEAD:s version används"
    # T3-C (2026-11-28): storage.js — den publicerade STAGING-versionen har kod som HEAD
    # också har ändrat (skrivtidsgränsen) intill T3-A:s rader, så trevägssammanslagningen ger
    # konflikt fast STAGING-överlägget bara är de två raderna SUPABASE_URL/SUPABASE_AKEY.
    # Då används HEAD:s fil med exakt de två publicerade raderna; allt annat måste vara
    # identiskt med HEAD (kontrolleras), annars avbrott.
    elif [ "$f" = src/data/storage.js ]; then
      u=$(grep -m1 "^const SUPABASE_URL *=" "$T/oth"); a=$(grep -m1 "^const SUPABASE_AKEY *=" "$T/oth")
      [ -n "$u" ] && [ -n "$a" ] || { echo "KONFLIKT i $f och inga överläggsrader — avbryter"; exit 1; }
      U="$u" A="$a" node -e '
        const fs = require("fs"); const s = fs.readFileSync(process.argv[1], "utf8").split("\n");
        const ut = s.map((l) => /^const SUPABASE_URL *=/.test(l) ? process.env.U : /^const SUPABASE_AKEY *=/.test(l) ? process.env.A : l);
        const diff = ut.filter((l, i) => l !== s[i]).length;
        if (diff > 2) process.exit(1);
        fs.writeFileSync(process.argv[2], ut.join("\n"));' "$T/cur" "$W/$f" \
        || { echo "KONFLIKT i $f — avbryter"; exit 1; }
      echo "storage.js: HEAD:s version med STAGING-överläggets två rader (SUPABASE_URL/SUPABASE_AKEY)"
    else echo "KONFLIKT i $f — avbryter"; exit 1; fi
  fi
done
git show HEAD:public-offer.html | sed "s#'https://$LIVE_REF.supabase.co'#'$STG_URL'#" > "$W/public-offer.html"
rm -rf "$T"
bad=$(cd "$W" && grep -rln "$LIVE_REF" --include=*.js --include=*.html --include=*.json . | grep -v '^./_staging_integration' | grep -v '^./src/services/AuthService.js$' || true)
[ -z "$bad" ] || { echo "LIVE-projektet finns kvar i: $bad"; exit 1; }
for r in $(cd "$W" && grep -ohE '(src|assets)/[^"? ]+\.(js|css|png|svg|json)' index.html public-offer.html | sort -u); do [ -f "$W/$r" ] || { echo "SAKNAS: $r"; exit 1; }; done
echo "Paket byggt i $W: $n klientfiler + 4 överläggsfiler. Inga LIVE-anrop; alla resurser finns."
