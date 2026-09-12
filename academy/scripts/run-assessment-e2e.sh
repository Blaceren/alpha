#!/usr/bin/env bash
# Reproducible isolated CI-3 assessment E2E.
#
# Stands up TWO isolated corrected Backends from the feature worktree
# (assessment ON / OFF) each with a fresh synthetic DB (34 migrations + approved
# rev3 imported + L2 assessment published/bound + synthetic learners), and TWO
# Academy (api-mode) servers pointing at them, all on scanned free loopback
# ports. Runs the assessment E2E journeys A-D. NEVER touches live DEV
# (3010/3050/3100/3199) or the DEV database.
set -euo pipefail

ACADEMY_REPO="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_REPO="${BACKEND_REPO:-/home/ubuntu/workspaces/ata-assessment-contract-ac1}"
PKG="curriculum/packages/ata-v2-first-slice.rev3.approved.json"
WANT_FP="860751bff541439ac76858c917ed2572e2b3e92b41109cfbea74122eb46625ad"
WORKDIR="$(mktemp -d)"
RESULTS="$ACADEMY_REPO/test-results/assessment-e2e"
# The protected all-correct fixture lives OUTSIDE Playwright's outputDir, which
# Playwright wipes at the start of a run.
FIXTURE_DIR="$ACADEMY_REPO/test-results/ci3-fixture"
ANSWERS="$FIXTURE_DIR/answers.json"
mkdir -p "$RESULTS" "$FIXTURE_DIR"

[ -n "${ACADEMY_TOOLING_NODE:-}" ] && export PATH="$ACADEMY_TOOLING_NODE:$PATH"

FORBIDDEN="3010 3050 3100 3199"
scan_port() {
  local p
  for p in $(seq "$1" "$2"); do
    case " $FORBIDDEN " in *" $p "*) continue;; esac
    if ! ss -ltn 2>/dev/null | grep -q ":$p "; then echo "$p"; return 0; fi
  done
  echo "no free port in $1-$2" >&2; return 1
}

BO=$(scan_port 3410 3450)   # backend ON
BF=$(scan_port 3451 3490)   # backend OFF
AO=$(scan_port 3491 3520)   # academy ON
AF=$(scan_port 3521 3560)   # academy OFF
echo "ports: backendON=$BO backendOFF=$BF academyON=$AO academyOFF=$AF"

PIDS=()
cleanup() {
  cp "$WORKDIR"/*.log "$RESULTS/" 2>/dev/null || true
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  for p in $BO $BF $AO $AF; do
    pid="$(ss -ltnp 2>/dev/null | grep ":$p " | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

seed_db() {
  # $1 = db file
  local DB="$1"
  local DBURL="file:$DB"
  ( cd "$BACKEND_REPO" && DATABASE_URL="$DBURL" npx prisma migrate deploy >/dev/null )
  ( cd "$BACKEND_REPO" && npx tsx scripts/curriculum/importCurriculumPackage.ts --package "$PKG" --database "$DBURL" >/dev/null )
  DATABASE_URL="$DBURL" WRITE_ANSWERS="${2:-}" ANSWERS_OUT="$ANSWERS" node - "$BACKEND_REPO" <<'NODE'
const { createRequire } = require("node:module");
const fs = require("node:fs");
const backend = process.argv[2];
const req = createRequire(backend + "/package.json");
const { PrismaClient } = req("@prisma/client");
const bcrypt = req("bcryptjs");
const prisma = new PrismaClient();
const PAST = new Date("2026-06-01T00:00:00.000Z");
const L1 = "v2.l001.registraciya-pocket", L2 = "v2.l002.kak-ustroen-alfa-trade-academy";
(async () => {
  const version = await prisma.curriculumVersion.findFirstOrThrow({ where: { code: "ata-v2" } });
  const l1 = await prisma.levelDefinition.findFirstOrThrow({ where: { curriculumVersionId: version.id, stableCode: L1 } });
  const l2 = await prisma.levelDefinition.findFirstOrThrow({ where: { curriculumVersionId: version.id, stableCode: L2 } });
  const av = await prisma.assessmentVersion.findFirstOrThrow({ where: { levelDefinitionId: l2.id } });
  // Bind the published L2 assessment (raw update, mirrors setLevelAssessmentBinding) while draft, then publish+activate.
  await prisma.levelResourceBinding.update({ where: { levelDefinitionId: l2.id }, data: { assessmentVersionId: av.id } });
  await prisma.curriculumVersion.update({ where: { id: version.id }, data: { status: "published", publishedAt: PAST, effectiveFrom: PAST } });
  const passwordHash = await bcrypt.hash("Test-Passw0rd", 10);
  async function learner(email) {
    const u = await prisma.user.upsert({ where: { email }, update: { passwordHash, status: "active" }, create: { email, name: email, passwordHash, role: "user", status: "active" } });
    const en = await prisma.userCurriculumEnrollment.create({ data: { userId: u.id, curriculumVersionId: version.id, curriculumCode: "ata-v2", status: "active", enrolledAt: PAST, currentLevel: 2, highestCompletedLevel: 1, lastMeaningfulActionAt: PAST } });
    await prisma.userLevelProgress.create({ data: { enrollmentId: en.id, curriculumVersionId: version.id, levelDefinitionId: l1.id, status: "completed", startedAt: PAST, lastProgressAt: PAST, completedAt: PAST, completionMethod: "external", attemptCount: 1 } });
    await prisma.userLevelProgress.create({ data: { enrollmentId: en.id, curriculumVersionId: version.id, levelDefinitionId: l2.id, status: "in_progress", startedAt: PAST, lastProgressAt: PAST, attemptCount: 0 } });
  }
  for (const email of ["ci3-a@e2e.test", "ci3-c@e2e.test", "ci3-d@e2e.test"]) await learner(email);
  if (process.env.WRITE_ANSWERS === "1") {
    const qs = await prisma.questionDefinition.findMany({ where: { assessmentVersionId: av.id }, orderBy: { questionNumber: "asc" } });
    const out = {};
    for (const q of qs) { const ca = q.correctAnswer || {}; out[q.stableKey] = ca.code ?? (ca.codes && ca.codes[0]) ?? (ca.optionCodes && ca.optionCodes[0]); }
    fs.writeFileSync(process.env.ANSWERS_OUT, JSON.stringify(out));
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
NODE
}

echo "== seed backend-ON db =="; DB_ON="$WORKDIR/on.sqlite"; seed_db "$DB_ON" 1
echo "== seed backend-OFF db =="; DB_OFF="$WORKDIR/off.sqlite"; seed_db "$DB_OFF" ""

start_backend() {
  # $1=port $2=db $3=assessmentFlag(true/absent)
  local PORT="$1" DB="$2" ASMT="$3"
  (
    cd "$BACKEND_REPO"
    export DATABASE_URL="file:$DB" SESSION_SECRET="ci3-e2e-secret" CAPTCHA_DEV_BYPASS="true" NODE_ENV="development"
    export CURRICULUM_V2_READ_ENABLED="true" CURRICULUM_V2_ENROLLMENT_ENABLED="true" CURRICULUM_V2_CONTENT_ENABLED="true"
    [ -n "$ASMT" ] && export CURRICULUM_V2_ASSESSMENT_ENABLED="true"
    setsid npx next dev -p "$PORT" -H 127.0.0.1 >"$WORKDIR/backend-$PORT.log" 2>&1 < /dev/null &
  )
}
start_academy() {
  # $1=port $2=backendOrigin — PRODUCTION start (one shared build), so two
  # instances stay light (no per-request compile). BACKEND_ORIGIN is read at
  # request time, so the same build serves both the ON and OFF origins.
  (
    cd "$ACADEMY_REPO"
    export ACADEMY_MODE="api" BACKEND_ORIGIN="$2"
    setsid npx next start -p "$1" -H 127.0.0.1 >"$WORKDIR/academy-$1.log" 2>&1 < /dev/null &
  )
}

wait_ready() {
  # $1=url $2=label — poll up to 240s; last curl output on failure.
  local url="$1" label="$2" i
  for i in $(seq 1 240); do
    curl -sf "$url" >/dev/null 2>&1 && { echo "  ready: $label"; return 0; }
    sleep 1
  done
  echo "  NOT READY: $label ($url)"; return 1
}

# Start backends SEQUENTIALLY — two simultaneous next-dev cold compiles contend
# and one can exceed the readiness window; one-at-a-time is deterministic.
echo "== start backendON =="
start_backend "$BO" "$DB_ON" "true"
wait_ready "http://127.0.0.1:$BO/api/auth/session-status" "backendON"
echo "== start backendOFF =="
start_backend "$BF" "$DB_OFF" ""
wait_ready "http://127.0.0.1:$BF/api/auth/session-status" "backendOFF"

# One production build shared by both Academy instances (light startup).
echo "== build academy (production) =="
( cd "$ACADEMY_REPO" && npm run build >"$WORKDIR/academy-build.log" 2>&1 ) || { echo "academy build failed"; tail -20 "$WORKDIR/academy-build.log"; exit 1; }

echo "== start academyON =="
start_academy "$AO" "http://127.0.0.1:$BO"
wait_ready "http://127.0.0.1:$AO/login" "academyON"
echo "== start academyOFF =="
start_academy "$AF" "http://127.0.0.1:$BF"
wait_ready "http://127.0.0.1:$AF/login" "academyOFF"

echo "== run assessment E2E =="
cd "$ACADEMY_REPO"
ACADEMY_ASMT_ON_PORT="$AO" ACADEMY_ASMT_OFF_PORT="$AF" ACADEMY_ASMT_ANSWERS="$ANSWERS" \
  npx playwright test --config playwright.assessment.config.ts
