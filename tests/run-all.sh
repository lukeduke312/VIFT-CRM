#!/usr/bin/env bash
# Kör alla automatiska tester i tests/ (Node, inga npm-beroenden).
# Lokala sandlådetester — INTE en verifierad serveroperation i STAGING.
set -u
cd "$(dirname "$0")"
total=0; fails=0
for t in *.test.js; do
  total=$((total+1))
  if node "$t" > "/tmp/vift-test-$t.log" 2>&1; then
    echo "PASS  $t  ($(grep -o 'RESULT: .*' "/tmp/vift-test-$t.log"))"
  else
    fails=$((fails+1))
    echo "FAIL  $t  ($(grep -o 'RESULT: .*' "/tmp/vift-test-$t.log" || echo 'krasch'))"
    grep -E '^FAIL|Error' "/tmp/vift-test-$t.log" | head -10 | sed 's/^/        /'
  fi
done
echo "--- $((total-fails))/$total testfiler gröna"
exit $fails
