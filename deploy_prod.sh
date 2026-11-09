#!/bin/bash
#
# Deploy what is on origin/main to PRODUCTION.
#
# Ordering rationale:
#   1. Pre-flight gates run BEFORE anything is touched: clean tree, on main,
#      local HEAD == origin/main, and CI green for exactly this commit.
#   2. Migrations are pushed BEFORE code (functions, then frontend). Every
#      migration in a release must therefore be backward-compatible with the
#      currently-deployed code (expand-only: add nullable columns/tables; no
#      drops / renames / NOT NULL tightening in the same release as the code
#      that needs them). This keeps a failed `db push` from leaving new code
#      running against an old schema.
#   3. A post-deploy smoke check hits the public URL, then checks that every
#      JS/CSS build file the live index.html reaches is served (not the SPA
#      fallback HTML), and fails loudly.
#
# Escape hatches (all opt-in; use sparingly and know why):
#   SKIP_CI_CHECK=1     skip the "CI is green for HEAD" gate
#   SKIP_NPM_CI=1       reuse existing node_modules instead of `npm ci`
#   SKIP_LOCAL_GATES=1  skip local typecheck/lint/tests (rely on CI green)
#   SKIP_HEALTHCHECK=1  skip the post-deploy smoke check (incl. the build-file check)
#   AUTO_CONFIRM=yes    skip the interactive confirmation prompt
#   PROD_URL=<url>      override the smoke-check URL

set -Eeo pipefail

PROD_REF="hqnnhtxcxedisasvtbqv"
DEV_REF="qcrzwsazasaojqoqxwnr"
PROD_URL="${PROD_URL:-https://gigwrangler.com}"
CI_WORKFLOW="ci.yml"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p ./backups
LOG_FILE="./backups/deploy-$TIMESTAMP.log"

# Mirror all output to a timestamped log for post-mortems.
exec > >(tee -a "$LOG_FILE") 2>&1

# Progress markers so the exit trap can describe how far we got.
DEPLOY_STAGE="pre-flight"
PROD_MUTATED=""
BACKUP_FILE=""
DATA_BACKUP_FILE=""

# Single trap on EXIT covers every path — explicit `exit`, failed command
# under `set -e`, or normal completion. It (a) reports blast radius on failure
# and (b) always leaves the Supabase CLI linked back to dev.
finish() {
  local ec=$?
  if [ "$ec" -ne 0 ]; then
    echo ""
    echo "############################################################"
    echo "#  DEPLOY FAILED (exit $ec) — stage: $DEPLOY_STAGE"
    if [ -n "$PROD_MUTATED" ]; then
      echo "#  PRODUCTION WAS MODIFIED. Restore from backups if needed:"
      if [ -s "$BACKUP_FILE" ];      then echo "#    schema: $BACKUP_FILE"; fi
      if [ -s "$DATA_BACKUP_FILE" ]; then echo "#    data  : $DATA_BACKUP_FILE  (see AGENTS.md 'Restoring Data')"; fi
    else
      echo "#  No production changes were made."
    fi
    echo "############################################################"
  fi
  echo "--- Relinking Supabase CLI to dev ($DEV_REF) ---"
  supabase link --project-ref "$DEV_REF" >/dev/null 2>&1 \
    || echo "Warning: failed to relink to dev. Run: supabase link --project-ref $DEV_REF"
  echo "Full log: $LOG_FILE"
}
trap finish EXIT

die() { echo "Error: $*" >&2; exit 1; }

# --------------------------------------------------------------------------
# Pre-flight gates
# --------------------------------------------------------------------------

[ -z "$(git status --porcelain)" ] || {
  echo "Working tree is dirty:"; git status --short
  die "commit or stash all changes before deploying to prod."
}

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$CURRENT_BRANCH" = "main" ] || die "prod deploys must run from main (current branch: $CURRENT_BRANCH)."

echo "--- Checking local main is in sync with origin/main ---"
git fetch origin --quiet
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/main)
if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
  echo "  local  main: $LOCAL_SHA"
  echo "  origin main: $REMOTE_SHA"
  die "local main does not match origin/main. Run 'git pull --ff-only' (and push any local commits) first."
fi
echo "Confirmed: HEAD == origin/main ($LOCAL_SHA)"

if [ "${SKIP_CI_CHECK:-}" = "1" ]; then
  echo "--- SKIP_CI_CHECK=1 — not verifying CI status ---"
else
  echo "--- Verifying CI is green for $LOCAL_SHA ---"
  command -v gh >/dev/null 2>&1 || die "gh CLI not found. Install it ('brew install gh' then 'gh auth login') or re-run with SKIP_CI_CHECK=1."
  CI_CONCLUSION=$(gh run list --workflow "$CI_WORKFLOW" --branch main --limit 50 \
    --json headSha,status,conclusion \
    --jq "[.[] | select(.headSha==\"$LOCAL_SHA\")][0] | \"\(.status)/\(.conclusion)\"" 2>/dev/null || true)
  case "$CI_CONCLUSION" in
    completed/success)
      echo "Confirmed: CI passed for this commit." ;;
    ""|null*|null/*)
      die "no completed CI run found for $LOCAL_SHA yet. Wait for CI to finish, or SKIP_CI_CHECK=1." ;;
    completed/*)
      die "CI for $LOCAL_SHA concluded '${CI_CONCLUSION#completed/}'. Fix it before deploying (or SKIP_CI_CHECK=1)." ;;
    *)
      die "CI for $LOCAL_SHA is '$CI_CONCLUSION' (not finished). Wait for it, or SKIP_CI_CHECK=1." ;;
  esac
fi

if [ "${SKIP_NPM_CI:-}" = "1" ]; then
  echo "--- SKIP_NPM_CI=1 — reusing existing node_modules ---"
else
  echo "--- Installing dependencies from lockfile (npm ci) ---"
  npm ci
fi

if [ "${SKIP_LOCAL_GATES:-}" = "1" ]; then
  echo "--- SKIP_LOCAL_GATES=1 — skipping local typecheck/lint/tests ---"
else
  echo "--- Local quality gates (typecheck, lint, tests) ---"
  npm run typecheck
  npm run lint
  npm run test:run
fi

echo "All pre-flight gates passed."

# --------------------------------------------------------------------------
# Target prod and let the operator confirm
# --------------------------------------------------------------------------

DEPLOY_STAGE="linking to prod"
echo "--- Targeting prod ---"
supabase link --project-ref "$PROD_REF"

[ -f supabase/.temp/project-ref ] || die "supabase/.temp/project-ref not found after linking."
CURRENT_REF=$(cat supabase/.temp/project-ref)
[ "$CURRENT_REF" = "$PROD_REF" ] || die "not linked to prod. Current ref: $CURRENT_REF"
echo "Confirmed: linked to prod ($PROD_REF)"

echo "--- Migrations status on prod (rows with no Remote entry will be pushed) ---"
supabase migration list --linked || true

echo ""
echo "About to deploy to PRODUCTION:"
echo "  commit : $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"
echo "  db     : $PROD_REF"
echo "  web    : $PROD_URL"
echo ""
if [ "${AUTO_CONFIRM:-}" = "yes" ]; then
  echo "AUTO_CONFIRM=yes — proceeding without prompt."
elif [ -t 0 ]; then
  printf "Type 'deploy' to proceed: "
  read -r REPLY_CONFIRM
  [ "$REPLY_CONFIRM" = "deploy" ] || die "aborted at confirmation prompt."
else
  die "non-interactive shell and AUTO_CONFIRM != yes — aborting."
fi

# --------------------------------------------------------------------------
# Pre-migration backups (Docker required for supabase db dump)
# --------------------------------------------------------------------------

DEPLOY_STAGE="pre-migration backup"
echo "Checking Docker Desktop..."
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Starting Docker Desktop..."
    open -a Docker
  else
    die "please start Docker and try again."
  fi

  echo "Waiting for Docker to start (timeout 60s)..."
  MAX_RETRIES=12
  COUNT=0
  while ! docker info >/dev/null 2>&1; do
    if [ $COUNT -ge $MAX_RETRIES ]; then
      die "timeout waiting for Docker to start."
    fi
    sleep 5
    COUNT=$((COUNT + 1))
    echo "Still waiting ($(( COUNT * 5 ))s)..."
  done
  echo "Docker started."
fi

BACKUP_FILE="./backups/prod-schema-backup-$TIMESTAMP.sql"
echo "Running pre-migration schema backup to $BACKUP_FILE..."
supabase db dump --schema public --schema auth --linked -f "$BACKUP_FILE"
[ -s "$BACKUP_FILE" ] || die "schema backup failed or file is empty!"
echo "Schema backup successful: $BACKUP_FILE"

DATA_BACKUP_FILE="./backups/prod-data-backup-$TIMESTAMP.sql"
echo "Running data-only backup to $DATA_BACKUP_FILE..."
supabase db dump --data-only --schema public --schema auth --use-copy --linked -f "$DATA_BACKUP_FILE"
[ -s "$DATA_BACKUP_FILE" ] || die "data backup failed or file is empty!"
echo "Data backup successful: $DATA_BACKUP_FILE"

# --------------------------------------------------------------------------
# Deploy — migrations first, then code
# --------------------------------------------------------------------------

PROD_MUTATED="1"

DEPLOY_STAGE="db push (migrations)"
echo "Pushing migrations..."
supabase db push --yes

# One release name for the web app and the edge functions in Sentry (A18): the build reads
# BUILD_TIMESTAMP, and the functions read SENTRY_RELEASE.
export BUILD_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

DEPLOY_STAGE="functions deploy"
echo "Setting SENTRY_RELEASE=gigwrangler@$BUILD_TIMESTAMP for the edge functions..."
supabase secrets set "SENTRY_RELEASE=gigwrangler@$BUILD_TIMESTAMP"
echo "Deploying edge functions..."
supabase functions deploy

DEPLOY_STAGE="frontend build + deploy"
echo "Building frontend..."
# With SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT set, the build uploads source maps to
# Sentry and deletes them; the bundle check then confirms none are left to deploy.
npm run build
npm run check:bundle
echo "Deploying frontend to Cloudflare Pages..."
npx wrangler pages deploy build/ --project-name gigwrangler

# --------------------------------------------------------------------------
# Post-deploy smoke check
# --------------------------------------------------------------------------

if [ "${SKIP_HEALTHCHECK:-}" = "1" ]; then
  echo "--- SKIP_HEALTHCHECK=1 — not smoke-testing $PROD_URL ---"
else
  DEPLOY_STAGE="post-deploy smoke check"
  echo "--- Smoke-testing $PROD_URL ---"
  HEALTHY=""
  for i in 1 2 3 4 5 6; do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$PROD_URL" || true)
    if [ "$CODE" = "200" ]; then HEALTHY="1"; echo "  $PROD_URL -> 200 OK"; break; fi
    echo "  attempt $i: got '${CODE:-no response}'"
    if [ "$i" -lt 6 ]; then sleep 10; fi
  done
  [ -n "$HEALTHY" ] || die "$PROD_URL did not return 200 after deploy. The deploy completed — VERIFY PRODUCTION MANUALLY NOW."

  # Every JS/CSS file the new index.html loads (and the lazy chunks those
  # load) must be served as itself, not as the SPA's index.html, and a missing
  # build file must get a real 404. Retries ~60 s for CDN propagation.
  echo "--- Checking the deployed JS/CSS build files on $PROD_URL ---"
  node scripts/check-deployed-assets.mjs "$PROD_URL" 60 \
    || die "deployed build files are missing or served as HTML at $PROD_URL. The deploy completed — VERIFY PRODUCTION MANUALLY NOW (users may hit 'This screen couldn't load')."
fi

DEPLOY_STAGE="done"
echo ""
echo "=================================================="
echo "  Production deploy complete: $(git rev-parse --short HEAD)"
echo "  Backups: $BACKUP_FILE"
echo "           $DATA_BACKUP_FILE"
echo "=================================================="
# The EXIT trap relinks the Supabase CLI to dev.
