/**
 * TOOLS-V2 — Risk Plan persistence, against a real SQLite database.
 *
 * SELF-CONTAINED AND ISOLATED. It creates its own empty database in a fresh
 * temporary directory, applies EVERY migration with the production runner, and
 * never reads DATABASE_URL from the environment.
 *
 * What it proves:
 *   - the tool opens with L15 durably completed and not a level before;
 *   - a save adds a version and the newest is the plan in force; a save that
 *     says nothing new adds nothing; the history keeps the earlier versions,
 *     numbered, newest first, ten at most;
 *   - another learner sees none of it;
 *   - the table refuses states the service never writes (raw SQL);
 *   - deleting a learner deletes their plans.
 *
 *   npx tsx scripts/regression/toolRiskPlanRegression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedLegacyToolUnlocks } from "./support/toolUnlocks";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "ata-tool-risk-"));
const dbUrl = `file:${path.join(scratchDir, "regression.sqlite")}`;
process.env.DATABASE_URL = dbUrl;

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

function cleanupScratch() {
  if (scratchDir.startsWith(os.tmpdir()) && path.basename(scratchDir).startsWith("ata-tool-risk-")) {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

async function main() {
  const migrate = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  assert.equal(migrate.status, 0, `migrate failed: ${migrate.stderr}`);

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const service = await import("@/lib/tools/risk-service");
  const { parseRiskPlan } = await import("@/lib/tools/risk");
  const { isToolUnlockedForUser } = await import("@/lib/tools/access");
  const { EXPECTED_MIGRATION_COUNT } = await import("./support/migrationCount");

  const plan = (overrides: Record<string, unknown> = {}) =>
    parseRiskPlan({
      capital: "400",
      payoutPercent: 90,
      riskPercent: 2,
      dailyLimitPercent: 6,
      scenario: "Работаю только отскоки от уровней, отмеченных до начала сессии.",
      cancelCondition: "Рядом с ценой нет отмеченного уровня или payout ниже 85%.",
      ...overrides,
    });

  /* A published ata-v2 graph with fifteen levels; the learners complete levels by row. */
  const version = await db.curriculumVersion.create({
    data: { code: "ata-v2", name: "risk", versionNumber: 1, status: "published", publishedAt: new Date(), effectiveFrom: new Date() },
  });
  const moduleDefinition = await db.moduleDefinition.create({
    data: { curriculumVersionId: version.id, moduleNumber: 1, code: "m1", title: "M", firstLevel: 1, lastLevel: 15, learningObjective: "L" },
  });
  const levels: { id: number; levelNumber: number }[] = [];
  for (let n = 1; n <= 15; n += 1) {
    levels.push(
      await db.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: moduleDefinition.id,
          levelNumber: n,
          stableCode: `v2.l${String(n).padStart(3, "0")}.risk`,
          type: "lesson",
          title: `Level ${n}`,
          learningObjective: "L",
          completionMethod: "manual",
          requiredPreviousLevel: n === 1 ? null : n - 1,
          status: "active",
        },
      }),
    );
  }
  await seedLegacyToolUnlocks(db, version.id, levels);
  async function learner(email: string, completedThrough: number) {
    const user = await db.user.create({ data: { email, name: email, role: "user", passwordHash: "x" } });
    const enrollment = await db.userCurriculumEnrollment.create({
      data: {
        userId: user.id,
        curriculumVersionId: version.id,
        curriculumCode: "ata-v2",
        status: "active",
        enrolledAt: new Date(),
        currentLevel: completedThrough + 1,
        highestCompletedLevel: completedThrough,
      },
    });
    for (const level of levels.filter((candidate) => candidate.levelNumber <= completedThrough)) {
      await db.userLevelProgress.create({
        data: { enrollmentId: enrollment.id, curriculumVersionId: version.id, levelDefinitionId: level.id, status: "completed", startedAt: new Date(), completedAt: new Date() },
      });
    }
    return { user, enrollment };
  }

  const alice = await learner("risk-alice@example.invalid", 14);
  const bob = await learner("risk-bob@example.invalid", 15);

  try {
    await check("every migration applied, the Risk Plan one among them", async () => {
      const rows = await db.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
      assert.equal(rows.length, EXPECTED_MIGRATION_COUNT);
      assert.ok(rows.some((row) => row.migration_name === "20260921200000_tool_risk_plan"));
    });

    await check("the tool opens with L15 durably completed, and not a level before", async () => {
      assert.equal(await isToolUnlockedForUser(alice.user.id, "tool.risk_calculator", db), false);
      assert.equal(await isToolUnlockedForUser(bob.user.id, "tool.risk_calculator", db), true);
      await db.userLevelProgress.create({
        data: {
          enrollmentId: alice.enrollment.id,
          curriculumVersionId: version.id,
          levelDefinitionId: levels[14]!.id,
          status: "completed",
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
      assert.equal(await isToolUnlockedForUser(alice.user.id, "tool.risk_calculator", db), true);
    });

    await check("a learner starts with no plan", async () => {
      const state = await service.readRiskPlans(bob.user.id, db);
      assert.equal(state.current, null);
      assert.deepEqual(state.history, []);
    });

    await check("a save is version 1 and the plan in force", async () => {
      const { created, state } = await service.saveRiskPlan(bob.user.id, plan(), db);
      assert.equal(created, true);
      assert.equal(state.current?.version, 1);
      assert.equal(state.current?.row.capitalMinor, 40_000);
      assert.equal(state.current?.row.riskPercent, 2);
      assert.equal(state.history.length, 0);
    });

    await check("a save that says nothing new adds nothing", async () => {
      const { created, state } = await service.saveRiskPlan(bob.user.id, plan(), db);
      assert.equal(created, false);
      assert.equal(state.current?.version, 1);
      assert.equal(await db.toolRiskPlan.count({ where: { userId: bob.user.id } }), 1);
    });

    await check("a changed plan is version 2; version 1 stays, untouched, in the history", async () => {
      const first = await db.toolRiskPlan.findFirstOrThrow({ where: { userId: bob.user.id } });
      const { created, state } = await service.saveRiskPlan(bob.user.id, plan({ riskPercent: 1, dailyLimitPercent: 5 }), db);
      assert.equal(created, true);
      assert.equal(state.current?.version, 2);
      assert.equal(state.current?.row.riskPercent, 1);
      assert.equal(state.history.length, 1);
      assert.equal(state.history[0]?.version, 1);
      assert.deepEqual(state.history[0]?.row, first);
    });

    await check("the history keeps ten earlier versions, numbered, newest first", async () => {
      for (let n = 0; n < 11; n += 1) {
        await service.saveRiskPlan(bob.user.id, plan({ dailyLimitPercent: 10 + n }), db);
      }
      const state = await service.readRiskPlans(bob.user.id, db);
      assert.equal(state.current?.version, 13);
      assert.equal(state.current?.row.dailyLimitPercent, 20);
      assert.deepEqual(
        state.history.map((item) => item.version),
        [12, 11, 10, 9, 8, 7, 6, 5, 4, 3],
      );
      assert.equal(await db.toolRiskPlan.count({ where: { userId: bob.user.id } }), 13);
    });

    await check("another learner sees none of it", async () => {
      const state = await service.readRiskPlans(alice.user.id, db);
      assert.equal(state.current, null);
      const { state: own } = await service.saveRiskPlan(alice.user.id, plan({ capital: "250" }), db);
      assert.equal(own.current?.version, 1);
      assert.equal(own.current?.row.capitalMinor, 25_000);
      assert.equal((await service.readRiskPlans(bob.user.id, db)).current?.version, 13);
    });

    await check("the table refuses states the service never writes (raw SQL)", async () => {
      const insert = (capital: unknown, payout: unknown, risk: unknown, limit: unknown, scenario: string, cancel: string) =>
        db.$executeRawUnsafe(
          `INSERT INTO "ToolRiskPlan" ("id","userId","capitalMinor","payoutPercent","riskPercent","dailyLimitPercent","scenario","cancelCondition","createdAt") VALUES (?,?,?,?,?,?,?,?,?)`,
          `raw${Math.random().toString(36).slice(2, 12)}`,
          bob.user.id,
          capital,
          payout,
          risk,
          limit,
          scenario,
          cancel,
          Date.now(),
        );
      await assert.rejects(insert(40_000, 90, 4, 6, "Сценарий", "Отмена"), "a share the lessons do not teach");
      await assert.rejects(insert(99, 90, 2, 6, "Сценарий", "Отмена"), "under a dollar of capital");
      await assert.rejects(insert(100_000_001, 90, 2, 6, "Сценарий", "Отмена"), "past the typo guard");
      // A numeric string is stored as an integer by column affinity; words are not.
      await assert.rejects(insert("четыреста", 90, 2, 6, "Сценарий", "Отмена"), "capital as words");
      await assert.rejects(insert(40_000, 0, 2, 6, "Сценарий", "Отмена"), "payout of nothing");
      await assert.rejects(insert(40_000, 90, 2, 0, "Сценарий", "Отмена"), "no daily limit");
      await assert.rejects(insert(40_000, 90, 2, 6, "   ", "Отмена"), "an empty scenario");
      await assert.rejects(insert(40_000, 90, 2, 6, "Сценарий", ""), "an empty cancel condition");
      assert.equal(await insert(40_000, 90, 2, 6, "Сценарий", "Отмена"), 1);
    });

    await check("deleting a learner deletes their plans", async () => {
      // No enrollment, so nothing but the plans hold the user row.
      const carol = await db.user.create({ data: { email: "risk-carol@example.invalid", name: "c", role: "user", passwordHash: "x" } });
      await service.saveRiskPlan(carol.id, plan(), db);
      await service.saveRiskPlan(carol.id, plan({ riskPercent: 3 }), db);
      assert.equal(await db.toolRiskPlan.count({ where: { userId: carol.id } }), 2);
      await db.user.delete({ where: { id: carol.id } });
      assert.equal(await db.toolRiskPlan.count({ where: { userId: carol.id } }), 0);
    });
  } finally {
    await db.$disconnect();
    cleanupScratch();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanupScratch();
  process.exitCode = 1;
});
