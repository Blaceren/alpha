#!/usr/bin/env bash
# Reproducible isolated authentication E2E runner (CI-1).
#
# Starts an ISOLATED Backend (synthetic SQLite DB, synthetic learner, synthetic
# session secret, Pocket disabled, Curriculum V2 absent) on 127.0.0.1:3212 and
# runs the Academy auth E2E (api mode) on 127.0.0.1:3040. Never touches the live
# DEV runtime (3100/3010) or the DEV database.
#
# Usage:  ACADEMY_TOOLING_NODE=/home/ubuntu/workspaces/.tooling/node/bin \
#         BACKEND_REPO=/home/ubuntu/workspaces/alfa-trade-academy-v2 \
#         bash scripts/run-auth-e2e.sh
set -euo pipefail

BACKEND_REPO="${BACKEND_REPO:-/home/ubuntu/workspaces/alfa-trade-academy-v2}"
ACADEMY_REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="$(mktemp -d)"
DB_FILE="$WORKDIR/backend-test.sqlite"
BACKEND_PORT=3212
ACADEMY_PORT=3040

[ -n "${ACADEMY_TOOLING_NODE:-}" ] && export PATH="$ACADEMY_TOOLING_NODE:$PATH"

cleanup() {
  for p in $BACKEND_PORT $ACADEMY_PORT; do
    pid="$(ss -ltnp 2>/dev/null | grep ":$p " | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

export DATABASE_URL="file:$DB_FILE"
export SESSION_SECRET="synthetic-ci1-session-secret"
export CAPTCHA_DEV_BYPASS="true"
export NODE_ENV="development"

echo "== migrate isolated backend DB =="
( cd "$BACKEND_REPO" && npx prisma migrate deploy >/dev/null )

echo "== seed synthetic learner =="
node - "$BACKEND_REPO" <<'NODE'
const { createRequire } = require("node:module");
const backend = process.argv[2];
const require2 = createRequire(backend + "/package.json");
const { PrismaClient } = require2("@prisma/client");
const bcrypt = require2("bcryptjs");
const prisma = new PrismaClient();
(async () => {
  const passwordHash = await bcrypt.hash("Test-Passw0rd", 10);
  await prisma.user.upsert({
    where: { email: "learner@ci1.test" },
    update: { passwordHash, status: "active", role: "user", name: "CI1 Learner" },
    create: { email: "learner@ci1.test", name: "CI1 Learner", passwordHash, role: "user", status: "active" },
  });
  await prisma.$disconnect();
})();
NODE

echo "== start isolated backend on $BACKEND_PORT =="
( cd "$BACKEND_REPO" && setsid npx next dev -p $BACKEND_PORT -H 127.0.0.1 >"$WORKDIR/backend.log" 2>&1 < /dev/null & )
for i in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$BACKEND_PORT/api/auth/session-status" >/dev/null && break
  sleep 1
done

echo "== run auth E2E =="
cd "$ACADEMY_REPO"
npx playwright test --config playwright.auth.config.ts
