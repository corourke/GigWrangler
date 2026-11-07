#!/usr/bin/env bash
#
# Nightly backup of the PRODUCTION database to a local folder (Dropbox by default).
#
# Writes <dest>/YYYY-MM-DD/:
#   gigwrangler-prod.dump   pg_dump custom format (-Fc): schemas public, auth and
#                           supabase_migrations, schema and data. Restore with
#                           pg_restore (see scripts/restore-drill.sh).
#   schema.sql              the same schemas, schema only, as plain SQL (for diffs).
# then checks the dump is readable and not suspiciously small, deletes dated folders
# older than the retention period, and appends to <dest>/backup.log.
#
# The database URL is never stored in the repository. It comes from, in order:
#   1. the GIGWRANGLER_PROD_DB_URL environment variable, or
#   2. the macOS keychain item "gigwrangler-prod-db":
#        security add-generic-password -a "$USER" -s gigwrangler-prod-db -w '<url>'
# Use the Supabase session pooler URL (dashboard → Connect → Session pooler); its user
# name carries the project ref, which this script checks is production's.
#
# Usage: scripts/backup-prod.sh [--dry-run] [--dest DIR] [--keep-days N]
#   --dry-run      check the target and print what would happen; dump and delete nothing
#   --dest DIR     backup folder (default: $GIGWRANGLER_BACKUP_DIR or ~/Dropbox/GigWrangler-backups)
#   --keep-days N  keep dated folders this many days (default 30)
#
# Environment: PG_DUMP / PG_RESTORE to use specific binaries (e.g. Homebrew's
# /opt/homebrew/opt/libpq/bin/pg_dump). They must be version 17 or newer, like the server.
# MIN_DUMP_BYTES (default 102400) is the smallest dump accepted. ALLOW_OLD_PG_DUMP=1 skips the
# version check; it is only for trying the script against an older local server.

set -Eeuo pipefail

PROD_REF="hqnnhtxcxedisasvtbqv"
DEV_REF="qcrzwsazasaojqoqxwnr"
MIN_PG_MAJOR=17

DRY_RUN=0
DEST="${GIGWRANGLER_BACKUP_DIR:-$HOME/Dropbox/GigWrangler-backups}"
KEEP_DAYS=30
MIN_DUMP_BYTES="${MIN_DUMP_BYTES:-102400}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --dest) [ $# -ge 2 ] || { echo "--dest needs a folder" >&2; exit 2; }; DEST="$2"; shift ;;
    --keep-days) [ $# -ge 2 ] || { echo "--keep-days needs a number" >&2; exit 2; }; KEEP_DAYS="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

case "$KEEP_DAYS" in ''|*[!0-9]*) echo "--keep-days must be a whole number" >&2; exit 2 ;; esac

LOG_FILE="$DEST/backup.log"
log() {
  local line
  line="$(date '+%Y-%m-%d %H:%M:%S') $*"
  echo "$line"
  if [ "$DRY_RUN" -eq 0 ]; then echo "$line" >> "$LOG_FILE"; fi
}
die() { log "FAILED: $*"; exit 1; }

# --- Target --------------------------------------------------------------------------
DB_URL="${GIGWRANGLER_PROD_DB_URL:-}"
if [ -z "$DB_URL" ] && command -v security >/dev/null 2>&1; then
  DB_URL="$(security find-generic-password -s gigwrangler-prod-db -w 2>/dev/null || true)"
fi

if [ "$DRY_RUN" -eq 0 ]; then mkdir -p "$DEST"; fi

[ -n "$DB_URL" ] || die "no database URL: set GIGWRANGLER_PROD_DB_URL or add the keychain item gigwrangler-prod-db"
case "$DB_URL" in
  *"$DEV_REF"*) die "the database URL points at the development project; this script backs up production only" ;;
  *"$PROD_REF"*) ;;
  *) die "the database URL does not name the production project ($PROD_REF)" ;;
esac
case "$DB_URL" in
  postgres://*|postgresql://*) ;;
  *) die "the database URL must start with postgres:// or postgresql://" ;;
esac

# --- Tools ---------------------------------------------------------------------------
pg_major() { "$1" --version 2>/dev/null | sed -E 's/[^0-9]*([0-9]+).*/\1/' | head -n 1; }
for tool in "$PG_DUMP" "$PG_RESTORE"; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool not found (install PostgreSQL $MIN_PG_MAJOR client tools, or set PG_DUMP / PG_RESTORE)"
done
DUMP_MAJOR="$(pg_major "$PG_DUMP")"
if [ -z "$DUMP_MAJOR" ] || [ "$DUMP_MAJOR" -lt "$MIN_PG_MAJOR" ]; then
  if [ "${ALLOW_OLD_PG_DUMP:-0}" != "1" ]; then
    die "$PG_DUMP is version ${DUMP_MAJOR:-unknown}; production runs PostgreSQL $MIN_PG_MAJOR, so use pg_dump $MIN_PG_MAJOR or newer"
  fi
fi

DAY="$(date +%Y-%m-%d)"
DAY_DIR="$DEST/$DAY"
DUMP_FILE="$DAY_DIR/gigwrangler-prod.dump"
SCHEMA_FILE="$DAY_DIR/schema.sql"
SCHEMAS=(--schema=public --schema=auth --schema=supabase_migrations)

# Dated folders (YYYY-MM-DD) older than KEEP_DAYS, by name.
cutoff_day() {
  if date -v-1d +%Y-%m-%d >/dev/null 2>&1; then
    date -v-"${KEEP_DAYS}"d +%Y-%m-%d          # macOS / BSD date
  else
    date -d "${KEEP_DAYS} days ago" +%Y-%m-%d  # GNU date
  fi
}
expired_dirs() {
  local cutoff dir name
  cutoff="$(cutoff_day)"
  [ -d "$DEST" ] || return 0
  for dir in "$DEST"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    if [[ "$name" < "$cutoff" ]]; then echo "$dir"; fi
  done
}

if [ "$DRY_RUN" -eq 1 ]; then
  log "DRY RUN: target is production ($PROD_REF); pg_dump $DUMP_MAJOR"
  log "DRY RUN: would write $DUMP_FILE and $SCHEMA_FILE"
  log "DRY RUN: would check the dump is at least $MIN_DUMP_BYTES bytes and readable by pg_restore"
  while IFS= read -r dir; do
    [ -n "$dir" ] && log "DRY RUN: would delete $dir (older than $KEEP_DAYS days)"
  done < <(expired_dirs)
  exit 0
fi

# --- Dump ----------------------------------------------------------------------------
mkdir -p "$DAY_DIR"
log "Backing up production ($PROD_REF) to $DAY_DIR"

"$PG_DUMP" --dbname="$DB_URL" --format=custom --no-owner --no-privileges "${SCHEMAS[@]}" --file="$DUMP_FILE.partial" \
  || die "pg_dump failed"
mv "$DUMP_FILE.partial" "$DUMP_FILE"

"$PG_DUMP" --dbname="$DB_URL" --schema-only --no-owner --no-privileges "${SCHEMAS[@]}" --file="$SCHEMA_FILE.partial" \
  || die "schema dump failed"
mv "$SCHEMA_FILE.partial" "$SCHEMA_FILE"

# --- Checks --------------------------------------------------------------------------
file_size() { wc -c < "$1" | tr -d ' '; }
SIZE="$(file_size "$DUMP_FILE")"
[ "$SIZE" -ge "$MIN_DUMP_BYTES" ] || die "the dump is only $SIZE bytes (expected at least $MIN_DUMP_BYTES)"
"$PG_RESTORE" --list "$DUMP_FILE" > /dev/null || die "pg_restore cannot read the dump"
TABLES="$("$PG_RESTORE" --list "$DUMP_FILE" | grep -c ' TABLE DATA ' || true)"

# Warn (not fail) when the dump shrank by more than half since the previous backup.
PREVIOUS=""
for dir in "$DEST"/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]; do
  [ -f "$dir/gigwrangler-prod.dump" ] && [ "$dir" != "$DAY_DIR" ] && PREVIOUS="$dir/gigwrangler-prod.dump"
done
if [ -n "$PREVIOUS" ]; then
  PREV_SIZE="$(file_size "$PREVIOUS")"
  if [ "$PREV_SIZE" -gt 0 ] && [ $((SIZE * 2)) -lt "$PREV_SIZE" ]; then
    log "WARNING: the dump is $SIZE bytes, under half of the previous one ($PREV_SIZE bytes, $PREVIOUS)"
  fi
fi

log "OK: $DUMP_FILE ($SIZE bytes, $TABLES tables with data)"

# --- Retention -----------------------------------------------------------------------
while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  rm -rf -- "$dir"
  log "Deleted $dir (older than $KEEP_DAYS days)"
done < <(expired_dirs)
