#!/usr/bin/env bash
#
# Restore drill: restores the newest production backup into a throwaway database on a
# LOCAL PostgreSQL server, then prints row counts for the main tables and the latest
# migration, so you can see the backup is usable. It never connects anywhere but local.
#
# Usage: scripts/restore-drill.sh [--dry-run] [--dest DIR] [--dump FILE] [--db NAME]
#   --dry-run    show which dump and database would be used; restore nothing
#   --dest DIR   backup folder (default: $GIGWRANGLER_BACKUP_DIR or ~/Dropbox/GigWrangler-backups)
#   --dump FILE  restore this dump instead of the newest one
#   --db NAME    local database to (re)create (default gw_restore_drill; must start with gw_restore_drill)
#
# Connects with the usual PG* variables (PGHOST, PGPORT, PGUSER), which must point at
# this machine: PGHOST unset, a socket directory, localhost, 127.0.0.1 or ::1.
# Needs PostgreSQL 17+ client tools and server (set PG_RESTORE / PSQL to pick binaries).

set -Eeuo pipefail

DRY_RUN=0
DEST="${GIGWRANGLER_BACKUP_DIR:-$HOME/Dropbox/GigWrangler-backups}"
DUMP=""
DB="gw_restore_drill"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
PSQL="${PSQL:-psql}"

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --dest) [ $# -ge 2 ] || { echo "--dest needs a folder" >&2; exit 2; }; DEST="$2"; shift ;;
    --dump) [ $# -ge 2 ] || { echo "--dump needs a file" >&2; exit 2; }; DUMP="$2"; shift ;;
    --db) [ $# -ge 2 ] || { echo "--db needs a name" >&2; exit 2; }; DB="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

die() { echo "FAILED: $*" >&2; exit 1; }

# --- Local only --------------------------------------------------------------------
case "${PGHOST:-}" in
  ''|/*|localhost|127.0.0.1|::1) ;;
  *) die "PGHOST is '$PGHOST'; the drill restores to a local server only" ;;
esac
for var in DATABASE_URL GIGWRANGLER_PROD_DB_URL PGSERVICE; do
  if [ -n "${!var:-}" ]; then die "$var is set; unset it so nothing can point the drill at a remote database"; fi
done
case "$DB" in
  gw_restore_drill*) ;;
  *) die "--db must start with gw_restore_drill (it is dropped and recreated)" ;;
esac
[[ "$DB" =~ ^[a-z0-9_]+$ ]] || die "--db may use lower-case letters, digits and _ only"

# --- Which dump -----------------------------------------------------------------------
if [ -z "$DUMP" ]; then
  for dir in "$DEST"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]; do
    [ -f "$dir/gigwrangler-prod.dump" ] && DUMP="$dir/gigwrangler-prod.dump"
  done
fi
[ -n "$DUMP" ] || die "no backup found under $DEST"
[ -f "$DUMP" ] || die "$DUMP does not exist"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "DRY RUN: would restore $DUMP into local database $DB (dropped and recreated)"
  exit 0
fi

command -v "$PG_RESTORE" >/dev/null 2>&1 || die "$PG_RESTORE not found"
command -v "$PSQL" >/dev/null 2>&1 || die "$PSQL not found"
"$PG_RESTORE" --list "$DUMP" > /dev/null || die "pg_restore cannot read $DUMP"

# --- Restore ------------------------------------------------------------------------
echo "Restoring $DUMP into local database $DB..."
PGOPTIONS="-c client_min_messages=warning" "$PSQL" -qX -v ON_ERROR_STOP=1 -d postgres \
  -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" > /dev/null

# What a Supabase database has that the dump expects: the API roles (policies name them)
# and the extensions schema (defaults call extensions.uuid_generate_v4() and the like).
"$PSQL" -qX -v ON_ERROR_STOP=1 -d "$DB" > /dev/null <<'SQL'
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin', 'supabase_admin'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;
DROP SCHEMA public CASCADE;  -- the dump creates it
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SQL

# Supabase-only objects (e.g. auth functions owned by its own roles, other extensions)
# can fail to restore locally; count those errors rather than stop on the first.
RESTORE_LOG="$(mktemp)"
trap 'rm -f "$RESTORE_LOG"' EXIT
"$PG_RESTORE" --no-owner --no-privileges --dbname="$DB" "$DUMP" 2> "$RESTORE_LOG" || true
ERRORS="$(grep -c '^pg_restore: error:' "$RESTORE_LOG" || true)"

# --- Report -------------------------------------------------------------------------
echo
echo "Row counts:"
"$PSQL" -qX -d "$DB" -At -F ' ' <<'SQL'
SELECT rpad(t, 32) || coalesce(
  (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %s', t), false, true, '')))[1]::text,
  'missing')
FROM unnest(ARRAY[
  'auth.users', 'public.users', 'public.organizations', 'public.organization_members',
  'public.gigs', 'public.gig_participants', 'public.gig_staff_slots', 'public.gig_staff_assignments',
  'public.gig_financials', 'public.assets', 'public.purchases', 'public.attachments',
  'public.invitations', 'public.access_requests'
]) AS t
WHERE to_regclass(t) IS NOT NULL
UNION ALL
SELECT rpad(t, 32) || 'missing' FROM unnest(ARRAY['auth.users', 'public.users', 'public.organizations', 'public.gigs']) AS t
WHERE to_regclass(t) IS NULL;
SQL

echo
LATEST="$("$PSQL" -qX -d "$DB" -At -c \
  "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1" 2>/dev/null || true)"
echo "Latest migration: ${LATEST:-unknown (supabase_migrations.schema_migrations not restored)}"
echo "Restore errors:   $ERRORS (Supabase-only objects; see the log below if the counts look wrong)"
if [ "$ERRORS" -gt 0 ]; then
  grep '^pg_restore: error:' "$RESTORE_LOG" | sort | uniq -c | sort -rn | head -n 10
fi
echo
echo "Done. Drop the drill database when finished: $PSQL -d postgres -c 'DROP DATABASE $DB'"
