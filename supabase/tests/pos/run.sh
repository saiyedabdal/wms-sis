#!/usr/bin/env bash
# Replays every migration on a throwaway local database and runs the POS tests.
#   PGHOST=/path/to/socket PGPORT=54329 supabase/tests/pos/run.sh
# Needs a local Postgres 16 superuser connection (psql defaults / PG* env vars).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
db="${POS_TEST_DB:-pos_test}"
export PGUSER="${PGUSER:-postgres}"

psql -q -d postgres -c "drop database if exists $db with (force)" -c "create database $db"
export PGDATABASE="$db"
psql -q -v ON_ERROR_STOP=1 -f "$here/00_supabase_shim.sql"
for f in "$root"/supabase/migrations/*.sql; do
  # pg_cron is absent locally; cron.schedule is stubbed by the shim
  sed -e 's/^create extension if not exists pg_cron;$/-- (pg_cron skipped locally)/' "$f" \
    | psql -q -v ON_ERROR_STOP=1 -X >/dev/null 2>"$here/.last_err" || { echo "FAILED: $(basename "$f")"; cat "$here/.last_err"; exit 1; }
  echo "applied $(basename "$f")"
done
rm -f "$here/.last_err"

[ "${1:-}" = "--migrate-only" ] && exit 0
psql -q -v ON_ERROR_STOP=1 -X -f "$here/10_fixtures.sql" >/dev/null
for t in "$here"/2*_test_*.sql; do
  psql -q -v ON_ERROR_STOP=1 -X -f "$t" 2>&1 >/dev/null | sed -n -e 's/^.*NOTICE:  //p' -e '/ERROR/,$p'
done
for t in "$here"/3*_*.sh; do
  bash "$t"
done
echo "ALL POS TESTS PASSED"
