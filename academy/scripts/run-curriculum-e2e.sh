#!/usr/bin/env bash
# Reproducible isolated API-mode curriculum-read E2E (CI-2).
#
# Spins an ISOLATED Backend on 127.0.0.1:3213 with a synthetic published
# curriculum (L1 completed -> L2 available -> L3 locked -> L4 checkpoint-locked),
# the minimum read flags enabled (READ + ENROLLMENT + CONTENT), and runs the
# Academy (api mode) curriculum E2E on 127.0.0.1:3041. Never touches live DEV
# (3100/3010) or the DEV database.
set -euo pipefail

BACKEND_REPO="${BACKEND_REPO:-/home/ubuntu/workspaces/alfa-trade-academy-v2}"
ACADEMY_REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="$(mktemp -d)"
DB_FILE="$WORKDIR/backend-ci2.sqlite"
BACKEND_PORT=3213
ACADEMY_PORT=3041

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
export SESSION_SECRET="synthetic-ci2-session-secret"
export CAPTCHA_DEV_BYPASS="true"
export NODE_ENV="development"
export CURRICULUM_V2_READ_ENABLED="true"
export CURRICULUM_V2_ENROLLMENT_ENABLED="true"
export CURRICULUM_V2_CONTENT_ENABLED="true"

echo "== migrate + seed isolated curriculum =="
( cd "$BACKEND_REPO" && npx prisma migrate deploy >/dev/null )
node - "$BACKEND_REPO" <<'NODE'
const { createRequire } = require("node:module");
const backend = process.argv[2];
const req = createRequire(backend + "/package.json");
const { PrismaClient } = req("@prisma/client");
const bcrypt = req("bcryptjs");
const prisma = new PrismaClient();
const PAST = new Date("2026-06-01T00:00:00.000Z");
(async () => {
  const passwordHash = await bcrypt.hash("Test-Passw0rd", 10);
  const user = await prisma.user.upsert({ where: { email: "learner@ci1.test" }, update: { passwordHash, status: "active" }, create: { email: "learner@ci1.test", name: "CI1 Learner", passwordHash, role: "user", status: "active" } });
  const version = await prisma.curriculumVersion.create({ data: { code: "ata-v2", name: "ATA V2 (CI-2 synthetic)", versionNumber: 1, status: "published", publishedAt: PAST, effectiveFrom: PAST } });
  const m = await prisma.moduleDefinition.create({ data: { curriculumVersionId: version.id, moduleNumber: 1, code: "module.01", title: "Первое знакомство", firstLevel: 1, lastLevel: 4, checkpointLevel: 4, learningObjective: "Основы ATA" } });
  // Titles are seeded explicitly: the Academy level detail renders the LEVEL
  // DEFINITION title, so a stableCode-as-title seed would make the read
  // assertions vacuous.
  const spec = [
    { n: 1, c: "v2.l001.otkrytie-scheta", t: "external_event", cm: "external", xp: 10, prev: null, cp: null, ti: "Открытие счёта", lo: "Пройти внешний шаг" },
    { n: 2, c: "v2.l002.kak-ustroen-put", t: "lesson", cm: "video_test", xp: 20, prev: 1, cp: null, ti: "Как устроен Alfa Trade Academy", lo: "Понять структуру пути" },
    { n: 3, c: "v2.l003.pervyy-otchet", t: "report", cm: "report", xp: 30, prev: 2, cp: null, ti: "Первый отчёт", lo: "Оформить отчёт" },
    { n: 4, c: "v2.l004.kontrolnaya-tochka", t: "financial_checkpoint", cm: "checkpoint", xp: 0, prev: 3, cp: 4, ti: "Контрольная точка модуля", lo: "Подтвердить готовность" },
  ];
  const levels = {};
  for (const l of spec) levels[l.n] = await prisma.levelDefinition.create({ data: { curriculumVersionId: version.id, moduleId: m.id, levelNumber: l.n, stableCode: l.c, type: l.t, title: l.ti, learningObjective: l.lo, completionMethod: l.cm, xpReward: l.xp, requiredXp: 0, requiredPreviousLevel: l.prev, requiredCheckpointLevel: l.cp } });

  // Published content bound to L2 only, so the E2E exercises the real
  // content-metadata read path (available) AND the not-configured path (L3/L4).
  const contentVersion = await prisma.contentVersion.create({ data: { levelDefinitionId: levels[2].id, curriculumVersionId: version.id, versionNumber: 1, status: "published", publishedAt: PAST, videoDurationSeconds: 600 } });
  await prisma.contentLocalization.create({ data: {
    contentVersionId: contentVersion.id,
    locale: "ru",
    title: "Урок 2 — знакомство с путём",
    subtitle: "Обзор модулей и контрольных точек",
    learningObjectiveExtension: "Разобрать, как уровни открываются последовательно",
    summary: "Короткий обзор того, как устроен путь обучения и что даёт каждый уровень.",
    transcript: "Расшифровка урока для синтетического теста.",
    body: {
      sections: [{ code: "intro", title: "Введение", body: "Путь состоит из модулей и уровней." }],
      examples: [],
      commonMistakes: [],
      glossary: [],
      nextAction: { label: "Перейти к следующему уровню", body: "Завершите урок, чтобы открыть отчёт." },
      riskDisclaimer: "Обучение не является инвестиционной рекомендацией.",
    },
  } });
  await prisma.levelResourceBinding.create({ data: { levelDefinitionId: levels[2].id, curriculumVersionId: version.id, contentVersionId: contentVersion.id } });
  const enr = await prisma.userCurriculumEnrollment.create({ data: { userId: user.id, curriculumVersionId: version.id, curriculumCode: "ata-v2", status: "active", enrolledAt: PAST, currentLevel: 2, highestCompletedLevel: 1, lastMeaningfulActionAt: PAST } });
  await prisma.userLevelProgress.create({ data: { enrollmentId: enr.id, curriculumVersionId: version.id, levelDefinitionId: levels[1].id, status: "completed", startedAt: PAST, lastProgressAt: PAST, completedAt: PAST, completionMethod: "external", attemptCount: 1 } });
  await prisma.$disconnect();
})();
NODE

echo "== start isolated backend on $BACKEND_PORT =="
( cd "$BACKEND_REPO" && setsid npx next dev -p $BACKEND_PORT -H 127.0.0.1 >"$WORKDIR/backend.log" 2>&1 < /dev/null & )
for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$BACKEND_PORT/api/auth/session-status" >/dev/null && break; sleep 1; done

echo "== run curriculum E2E =="
cd "$ACADEMY_REPO"
npx playwright test --config playwright.curriculum.config.ts
