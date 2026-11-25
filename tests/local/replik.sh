#!/usr/bin/env bash
# T3-0: bygger den lokala STAGING-replikan (migrationskedjan + Supabase-stubbar +
# syntetiska data) i den lokala PostgreSQL:en och kontrollerar den mot STAGING-facit.
#
#   PGHOST=/var/tmp/vift-localpg PGUSER=postgres tests/local/replik.sh [--behall] [--staging-only] [--namn=DB]
#
#   --behall        databasen tas inte bort efteråt (för felsökning; ta bort med dropdb)
#   --staging-only  även de två STAGING-only-migrationerna på sin plats (som STAGING)
#   --namn=DB       eget databasnamn (standard vift_replik_<pid>_<slump>)
#
# Kör aldrig mot STAGING eller LIVE: biblioteket avbryter om PGHOST inte är en lokal socketkatalog.
set -u
cd "$(dirname "$0")/../.."
behall=false; so=false; namn=""
for a in "$@"; do case "$a" in --behall) behall=true;; --staging-only) so=true;; --namn=*) namn="${a#--namn=}";; *) echo "okänd flagga $a"; exit 2;; esac; done
BEHALL=$behall SO=$so NAMN="$namn" node -e '
const { byggReplik } = require("./tests/local/lib/replik");
const o = { behall: process.env.BEHALL === "true", stagingOnly: process.env.SO === "true" };
if (process.env.NAMN) o.namn = process.env.NAMN;
const r = byggReplik(o);
console.log("Replik: " + r.db + " — " + r.steg.length + " migrationssteg, schemajämförelse: " + r.rapport.identiska + " identiska, " + r.rapport.forklarade + " förklarade, " + r.rapport.oforklarade + " oförklarade");
console.log("Syntetiska data: " + r.data.anvandare.length + " användare, " + Object.keys(r.data.store).length + " store-nycklar, " + r.data.kansliga.length + " rader i property_sensitive_access");
console.log(o.behall ? "Databasen behålls: " + r.db : "Databasen tas bort.");
process.exitCode = r.rapport.oforklarade === 0 ? 0 : 1;
'
