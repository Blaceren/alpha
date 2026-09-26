#!/usr/bin/env bash
# Reproducible isolated CI-4 report E2E.
#
# Stands up TWO isolated RR-1 Backends (report zero-reward feature worktree) —
# REPORT ON / OFF — each with a fresh synthetic DB (34 migrations + approved rev3
# imported + the REAL L3 report definition published/bound + an R1-R7 review
# rubric + synthetic learners/mentor), and TWO Academy (api-mode) servers pointing
# at them, all on scanned free loopback ports. Runs the report E2E journeys A-G.
# NEVER touches live DEV (3010/3050/3100/3199) or the DEV database. Backend/CRM
# repositories are never modified (temp scripts live in the gitignored tmp/).
set -euo pipefail

ACADEMY_REPO="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_REPO="${BACKEND_REPO:-/home/ubuntu/workspaces/ata-report-zero-reward-rr1}"
MENTOR="ci4-mentor@e2e.test"
PASSWORD="Test-Passw0rd"
LEARNERS_ON="ci4-draft@e2e.test ci4-submit@e2e.test ci4-revision@e2e.test ci4-approve@e2e.test ci4-stale@e2e.test ci4-double@e2e.test"
LEARNER_OFF="ci4-off@e2e.test"
WORKDIR="$(mktemp -d)"
RESULTS="$ACADEMY_REPO/test-results/report-e2e"
VALUES="$RESULTS/values.json"
mkdir -p "$RESULTS"

DEFAULT_TOOLING="/home/ubuntu/workspaces/.tooling/node/bin"
[ -z "${ACADEMY_TOOLING_NODE:-}" ] && [ -d "$DEFAULT_TOOLING" ] && ACADEMY_TOOLING_NODE="$DEFAULT_TOOLING"
[ -n "${ACADEMY_TOOLING_NODE:-}" ] && export PATH="$ACADEMY_TOOLING_NODE:$PATH"

TSX="$BACKEND_REPO/node_modules/tsx/dist/cli.mjs"
HELPER="$BACKEND_REPO/tmp/ci4-backend-helper.ts"
ACTOR="$BACKEND_REPO/tmp/ci4-run.sh"

FORBIDDEN="3010 3050 3100 3199"
scan_port() {
  local p
  for p in $(seq "$1" "$2"); do
    case " $FORBIDDEN " in *" $p "*) continue;; esac
    if ! ss -ltn 2>/dev/null | grep -q ":$p "; then echo "$p"; return 0; fi
  done
  echo "no free port in $1-$2" >&2; return 1
}

BO=$(scan_port 3610 3650)   # backend ON
BF=$(scan_port 3651 3690)   # backend OFF
AO=$(scan_port 3691 3720)   # academy ON
AF=$(scan_port 3721 3760)   # academy OFF
echo "ports: backendON=$BO backendOFF=$BF academyON=$AO academyOFF=$AF"

DB_ON="$WORKDIR/report-on.sqlite"
DB_OFF="$WORKDIR/report-off.sqlite"

PIDS=()
cleanup() {
  cp "$WORKDIR"/*.log "$RESULTS/" 2>/dev/null || true
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  for p in $BO $BF $AO $AF; do
    pid="$(ss -ltnp 2>/dev/null | grep ":$p " | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  rm -f "$HELPER" "$ACTOR"
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

mkdir -p "$BACKEND_REPO/tmp"
cp "$ACADEMY_REPO/e2e-report/support/ci4-backend-helper.ts" "$HELPER"

# actor wrapper used by the Playwright spec (targets the REPORT-ON DB)
cat > "$ACTOR" <<EOF
#!/usr/bin/env bash
cd "$BACKEND_REPO"
export DATABASE_URL="file:$DB_ON"
export CURRICULUM_V2_READ_ENABLED=true CURRICULUM_V2_ENROLLMENT_ENABLED=true CURRICULUM_V2_CONTENT_ENABLED=true CURRICULUM_V2_ASSESSMENT_ENABLED=true CURRICULUM_V2_REPORT_ENABLED=true
export CI4_BACKEND_REPO="$BACKEND_REPO" CI4_MENTOR="$MENTOR" CI4_PASSWORD="$PASSWORD"
exec node "$TSX" "$HELPER" "\$@"
EOF
chmod +x "$ACTOR"

run_helper() { # $1=db  $2.. = helper args
  local DB="$1"; shift
  ( cd "$BACKEND_REPO" && DATABASE_URL="file:$DB" \
    CURRICULUM_V2_READ_ENABLED=true CURRICULUM_V2_ENROLLMENT_ENABLED=true CURRICULUM_V2_CONTENT_ENABLED=true CURRICULUM_V2_ASSESSMENT_ENABLED=true CURRICULUM_V2_REPORT_ENABLED=true \
    CI4_BACKEND_REPO="$BACKEND_REPO" CI4_MENTOR="$MENTOR" CI4_PASSWORD="$PASSWORD" \
    node "$TSX" "$@" )
}

seed_db() { # $1=db  $2=learners  $3=writeValues(1|"")
  local DB="$1" LEARNERS="$2" WV="${3:-}"
  echo "  migrate $DB"; run_helper "$DB" "$BACKEND_REPO/prisma/migrate.ts" >/dev/null
  echo "  seed definition"; run_helper "$DB" "$HELPER" seed >/dev/null
  echo "  create mentor"; run_helper "$DB" "$HELPER" create-mentor "$MENTOR" >/dev/null
  for L in $LEARNERS; do run_helper "$DB" "$HELPER" create-learner "$L" >/dev/null; done
  if [ -n "$WV" ]; then
    echo "  emit valid values"; run_helper "$DB" "$HELPER" emit-values > "$WORKDIR/values.raw"
    grep '^CI4_JSON ' "$WORKDIR/values.raw" | sed 's/^CI4_JSON //' > "$VALUES"
  fi
}

echo "== seed backend-ON db =="; seed_db "$DB_ON" "$LEARNERS_ON" 1
echo "== seed backend-OFF db =="; seed_db "$DB_OFF" "$LEARNER_OFF" ""

start_backend() { # $1=port $2=db $3=reportFlag(true/"")
  local PORT="$1" DB="$2" REP="$3"
  (
    cd "$BACKEND_REPO"
    export DATABASE_URL="file:$DB" SESSION_SECRET="ci4-e2e-secret" CAPTCHA_DEV_BYPASS="true" NODE_ENV="development"
    export CURRICULUM_V2_READ_ENABLED="true" CURRICULUM_V2_ENROLLMENT_ENABLED="true" CURRICULUM_V2_CONTENT_ENABLED="true" CURRICULUM_V2_ASSESSMENT_ENABLED="true"
    [ -n "$REP" ] && export CURRICULUM_V2_REPORT_ENABLED="true"
    setsid npx next dev -p "$PORT" -H 127.0.0.1 >"$WORKDIR/backend-$PORT.log" 2>&1 < /dev/null &
  )
}
start_academy() { # $1=port $2=backendOrigin
  (
    cd "$ACADEMY_REPO"
    export ACADEMY_MODE="api" BACKEND_ORIGIN="$2"
    setsid npx next start -p "$1" -H 127.0.0.1 >"$WORKDIR/academy-$1.log" 2>&1 < /dev/null &
  )
}

wait_ready() { # $1=url $2=label
  local url="$1" label="$2" i
  for i in $(seq 1 240); do
    curl -sf "$url" >/dev/null 2>&1 && { echo "  ready: $label"; return 0; }
    sleep 1
  done
  echo "  NOT READY: $label ($url)"; tail -20 "$WORKDIR"/*.log 2>/dev/null || true; return 1
}

echo "== start backendON =="; start_backend "$BO" "$DB_ON" "true"
wait_ready "http://127.0.0.1:$BO/api/auth/session-status" "backendON"
echo "== start backendOFF =="; start_backend "$BF" "$DB_OFF" ""
wait_ready "http://127.0.0.1:$BF/api/auth/session-status" "backendOFF"

echo "== build academy (production) =="
( cd "$ACADEMY_REPO" && npm run build >"$WORKDIR/academy-build.log" 2>&1 ) || { echo "academy build failed"; tail -20 "$WORKDIR/academy-build.log"; exit 1; }

echo "== start academyON =="; start_academy "$AO" "http://127.0.0.1:$BO"
wait_ready "http://127.0.0.1:$AO/login" "academyON"
echo "== start academyOFF =="; start_academy "$AF" "http://127.0.0.1:$BF"
wait_ready "http://127.0.0.1:$AF/login" "academyOFF"

echo "== run report E2E =="
cd "$ACADEMY_REPO"
ACADEMY_RPT_ON_PORT="$AO" ACADEMY_RPT_OFF_PORT="$AF" CI4_VALUES="$VALUES" CI4_ACTOR="$ACTOR" \
  npx playwright test --config playwright.report.config.ts
