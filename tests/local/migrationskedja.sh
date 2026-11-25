#!/usr/bin/env bash
# T2: kör HELA serverns migrationskedja mot en tom lokal PostgreSQL och jämför
# resultatet mot STAGING-facit (tests/local/staging-schema-facit-2026-11-25.json).
#
#   PGHOST=/var/tmp/vift-localpg PGUSER=postgres tests/local/migrationskedja.sh [ordning|filnamn|bada]
#
#   ordning  (standard) filerna i supabase/MIGRATIONSORDNING.txt, STAGING:s ordning
#   filnamn  alla filer i supabase/migrations/ i filnamnsordning (som `supabase db push`)
#   bada     båda varianterna
#
# Skapar en egen databas (vift_kedja_<pid>_<variant>) och tar bort den efteråt.
# Kör aldrig mot STAGING eller LIVE: skriptet använder bara den lokala psql-anslutningen,
# och avbryter om PGHOST pekar på något annat än en lokal socketkatalog.
set -u
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
SUPA="$ROOT/supabase"
VARIANT="${1:-ordning}"

case "${PGHOST:-}" in
  /*) ;;
  *) echo "AVBRYTER: PGHOST måste vara en lokal unix-socketkatalog (t.ex. /var/tmp/vift-localpg), inte '${PGHOST:-}'."; exit 2 ;;
esac
if ! psql -d postgres -qAt -c 'select 1' >/dev/null 2>&1; then
  echo "RESULT: 0 passed, 0 failed (HOPPAS ÖVER — ingen lokal PostgreSQL; INTE godkänt, inte kört)"; exit 0
fi

fel=0
kontroll_tackning() {
  # Varje fil i supabase/migrations/ ska finnas exakt en gång i MIGRATIONSORDNING.txt,
  # och inga staging-only-filer får finnas där.
  local listade
  listade=$(grep -vE '^\s*(#|$)' "$SUPA/MIGRATIONSORDNING.txt" | awk '{print $2}')
  for f in "$SUPA"/migrations/*.sql; do
    local rel="migrations/$(basename "$f")"
    local n; n=$(echo "$listade" | grep -cxF "$rel")
    if [ "$n" != "1" ]; then echo "FAIL täckning: $rel finns $n gånger i MIGRATIONSORDNING.txt"; fel=$((fel+1)); fi
  done
  for rel in $listade; do
    [ -f "$SUPA/$rel" ] || { echo "FAIL täckning: $rel i MIGRATIONSORDNING.txt saknas på disk"; fel=$((fel+1)); }
    case "$rel" in staging-only/*) echo "FAIL täckning: STAGING-only-fil $rel får inte vara aktiv i ordningen"; fel=$((fel+1));; esac
  done
  for f in "$SUPA"/staging-only/migrations/*.sql; do
    [ -e "$SUPA/migrations/$(basename "$f")" ] && { echo "FAIL: STAGING-only-filen $(basename "$f") ligger även i supabase/migrations/"; fel=$((fel+1)); }
  done
  echo "täckning kontrollerad: $(echo "$listade" | wc -l) aktiva steg"
}

kor_variant() {
  local variant="$1" db="vift_kedja_$$_$1" filer
  psql -d postgres -qAt -c "drop database if exists $db with (force)" -c "create database $db" >/dev/null || return 1
  trap "psql -d postgres -qAt -c 'drop database if exists $db with (force)' >/dev/null 2>&1" RETURN
  psql -d "$db" -qAt -v ON_ERROR_STOP=1 -f "$ROOT/tests/local/supabase-stubbar.sql" >/dev/null 2>&1 || { echo "FAIL stubbar"; return 1; }
  psql -d postgres -qAt -c "alter database $db set search_path = \"\$user\", public, extensions" >/dev/null
  if [ "$variant" = "ordning" ]; then
    filer=$(grep -vE '^\s*(#|$)' "$SUPA/MIGRATIONSORDNING.txt" | awk '{print $2}')
  else
    filer=$(cd "$SUPA" && ls migrations/*.sql | sort)
  fi
  local n=0
  for rel in $filer; do
    n=$((n+1))
    if ! out=$(psql -d "$db" -qAt -v ON_ERROR_STOP=1 -f "$SUPA/$rel" 2>&1); then
      echo "FAIL [$variant] steg $n $rel"; echo "$out" | grep -E 'ERROR|FEL' | head -3 | sed 's/^/        /'; return 1
    fi
  done
  echo "PASS [$variant] $n migrationsfiler körda utan fel"
  echo "--- schemajämförelse mot STAGING-facit [$variant]"
  node "$ROOT/tests/local/jamfor-schema.js" "$db" "${RAPPORT_DIR:-/tmp}/migrationskedja-$variant.json"
}

kontroll_tackning
case "$VARIANT" in
  ordning|filnamn) kor_variant "$VARIANT" || fel=$((fel+1)) ;;
  bada) kor_variant ordning || fel=$((fel+1)); kor_variant filnamn || fel=$((fel+1)) ;;
  *) echo "okänd variant $VARIANT"; exit 2 ;;
esac
echo "RESULT: migrationskedjan $([ $fel -eq 0 ] && echo 'GRÖN' || echo "RÖD ($fel fel)")"
exit $fel
