#!/usr/bin/env bash
# ===========================================================================
# CALLPRO CRM - verify migrations + RLS against a real PostgreSQL server.
#
# Creates a throwaway database, applies the Supabase shim, the three real
# migrations, synthetic fixtures and the assertion suite. Any failed assertion
# raises a SQL exception and aborts with a non-zero exit code.
#
# Connection comes from the standard libpq environment variables:
#   PGHOST PGPORT PGUSER PGPASSWORD   (or a working local socket/peer setup)
# The role must be able to CREATE DATABASE and CREATE ROLE.
#
# Usage:  npm run test:rls
# ===========================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${CALLPRO_TEST_DB:-callpro_rls_verify}"
MAINTENANCE_DB="${CALLPRO_MAINTENANCE_DB:-postgres}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found - install PostgreSQL client tools to run the RLS verification." >&2
  exit 1
fi

psql_run() {
  psql -X -q -v ON_ERROR_STOP=1 "$@"
}

echo "==> recreating test database \"$DB\""
psql_run -d "$MAINTENANCE_DB" -v db="$DB" \
  -c "drop database if exists \"$DB\"" >/dev/null
psql_run -d "$MAINTENANCE_DB" -v db="$DB" -c "create database \"$DB\"" >/dev/null

# Structural SQL: shim, then the real migrations in deployment order.
for file in \
  supabase/tests/00_local_shim.sql \
  supabase/migrations/001_schema.sql \
  supabase/migrations/002_rls.sql \
  supabase/migrations/003_functions.sql \
  supabase/tests/10_fixtures.sql
do
  echo "==> applying ${file}"
  psql_run -d "$DB" -f "$ROOT/$file" >/dev/null
done

echo "==> running assertions"
set +e
OUTPUT="$(psql_run -d "$DB" -f "$ROOT/supabase/tests/20_rls_assertions.sql" 2>&1)"
STATUS=$?
set -e

echo "$OUTPUT" | grep -E '^(NOTICE:  (ok|FAIL)|psql:.*ERROR)' | sed 's/^NOTICE:  //' || true

PASSED="$(echo "$OUTPUT" | grep -c 'NOTICE:  ok' || true)"
echo
if [ "$STATUS" -ne 0 ]; then
  echo "RLS verification FAILED ($PASSED assertions passed)." >&2
  echo "$OUTPUT" | grep -E 'ERROR|FAIL' >&2 || true
  exit 1
fi

if [ "${CALLPRO_KEEP_DB:-0}" = "1" ]; then
  echo "RLS verification PASSED - $PASSED assertions, database \"$DB\" kept."
else
  psql_run -d "$MAINTENANCE_DB" -c "drop database if exists \"$DB\"" >/dev/null
  echo "RLS verification PASSED - $PASSED assertions."
fi
