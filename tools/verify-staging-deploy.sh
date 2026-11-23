#!/usr/bin/env bash
# Efterkontroll av en STAGING-publicering (nivå 0: bara GET av statiska filer).
# Jämför SHA-256 för varje fil som webbplatsen FAKTISKT levererar med
# manifestet från publiceringspaketet.
#
#   tools/verify-staging-deploy.sh <MANIFEST.txt> [bas-url]
#
# Utgångskod 0 = alla filer identiska, 1 = avvikelse.
set -uo pipefail
MAN="$1"; BASE="${2:-https://staging-crm.viftfast.se}"
ok=0; bad=0
while read -r sum file; do
  [[ "$sum" =~ ^[0-9a-f]{64}$ ]] || continue
  got=$(curl -s --max-time 30 -H 'Cache-Control: no-cache' "$BASE/$file?verify=$(date +%s%N)" | sha256sum | cut -d' ' -f1)
  if [ "$got" = "$sum" ]; then ok=$((ok+1)); else bad=$((bad+1)); echo "AVVIKER: $file"; fi
done < "$MAN"
echo "Identiska: $ok · avvikande: $bad"
[ "$bad" -eq 0 ]
