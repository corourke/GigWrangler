#!/usr/bin/env bash
# Runs the #135 worksheet queries against fixture.sql and checks what each returns.
# Needs the migrated test database from supabase/tests/rls/run.sh (gw_rls_test by default).
# Usage (repo root): PGHOST=... PGUSER=postgres scripts/audit/2026-purchases/test/run.sh
set -euo pipefail
DB=${DB:-gw_rls_test}
here=scripts/audit/2026-purchases
{
  echo "BEGIN;"
  cat supabase/tests/rls/_harness.sql supabase/tests/rls/_fixture.sql "$here/test/fixture.sql"
  for f in "$here"/0*.sql; do
    n=$(basename "$f" | cut -c1-2)
    echo "CREATE TEMP VIEW q$n AS"
    sed -e 's/;[[:space:]]*$//' "$f"
    echo ";"
  done
  cat "$here/test/checks.sql"
  echo "SELECT rls_test.report(); ROLLBACK;"
} | psql -qX -o /dev/null -v ON_ERROR_STOP=1 -d "$DB"
