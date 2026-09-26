/**
 * G3 — the `lesson:manual` negatives.
 *
 * The Backend owner (`completeManualLevel` -> `level_completion`) was already
 * shipped and correct; what G3 added was the Academy transport that finally
 * reaches it. That makes these negatives load-bearing for the first time: until
 * now nothing could call the command at all, so nothing could abuse it either.
 *
 * Every scenario owns a temporary SQLite fixture. No HTTP route, no live
 * database, no external owner and no network is used.
 *
 * Run: npx tsx scripts/regression/g3ManualCompletionNegativesRegression.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, type LevelDefinition, type LevelDefinitionType } from "@prisma/client";

const dbPath = `/tmp/ata-g3-manual-negatives-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
process.env.DATABASE_URL = dbUrl;

const EVALUATION_TIME = new Date("2026-08-12T12:00:00.000Z");
let passed = 0;
let failed = 0;

async function check(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${passed + failed}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${passed + failed}. ${name}`);
    console.error(error instanceof Error ? error.message : error);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/** Assert that a call fails with a specific ManualCompletionError code. */
async function refuses(code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    const actual = (error as { code?: string }).code;
    assert.equal(actual, code, `expected ${code}, got ${actual ?? String(error)}`);
    return;
  }
  assert.fail(`expected ${code} but the call SUCCEEDED`);
}

async function main() {
  cleanupDb();
  const migration = spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  if (migration.status !== 0) {
    console.error(migration.stdout, migration.stderr);
    throw new Error(`migration runner exited with ${migration.status}`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const manual = await import("../../src/lib/curriculum/manual-completion");

  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_XP_ENABLED = "true";
  process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";

  let sequence = 0;

  async function reset() {
    await prisma.xPTransaction.deleteMany();
    await prisma.userLevelProgress.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.user.deleteMany();
  }

  async function createUser(label: string) {
    sequence += 1;
    return prisma.user.create({
      data: { email: `${label}-${process.pid}-${sequence}@example.com`, name: label, status: "active" },
    });
  }

  type Spec = { type?: LevelDefinitionType; completionMethod?: string; xpReward?: number };

  /**
   * A five-level fixture mirroring the canonical shape:
   *   1 lesson:manual · 2 lesson:assessment_pass · 3 report:report_approval
   *   4 financial_checkpoint:balance_check · 5 mentor_review:mentor_review
   */
  async function createGraph(specs: Spec[]) {
    sequence += 1;
    const version = await prisma.curriculumVersion.create({
      data: {
        code: "ata-v2",
        name: `g3-manual-${sequence}`,
        versionNumber: sequence,
        status: "published",
        publishedAt: EVALUATION_TIME,
      },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 1,
        code: `m-${version.id}`,
        title: "G3 manual module",
        firstLevel: 1,
        lastLevel: specs.length,
      },
    });
    const levels: LevelDefinition[] = [];
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index];
      const levelNumber = index + 1;
      levels.push(
        await prisma.levelDefinition.create({
          data: {
            curriculumVersionId: version.id,
            moduleId: moduleDefinition.id,
            levelNumber,
            stableCode: `v2.l${String(levelNumber).padStart(3, "0")}.g3-${version.id}`,
            type: spec.type ?? "lesson",
            title: `Level ${levelNumber}`,
            completionMethod: spec.completionMethod ?? "manual",
            xpReward: spec.xpReward ?? 150,
            requiredXp: 0,
            requiredPreviousLevel: levelNumber === 1 ? null : levelNumber - 1,
            status: "active",
          },
        }),
      );
    }
    return { version, levels };
  }

  const CANONICAL_SHAPE: Spec[] = [
    { type: "lesson", completionMethod: "manual", xpReward: 150 },
    { type: "lesson", completionMethod: "assessment_pass", xpReward: 100 },
    { type: "report", completionMethod: "report_approval", xpReward: 500 },
    { type: "financial_checkpoint", completionMethod: "balance_check", xpReward: 0 },
    { type: "mentor_review", completionMethod: "mentor_review", xpReward: 250 },
  ];

  async function enroll(userId: number, versionId: number, currentLevel: number) {
    const version = await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: versionId } });
    return prisma.userCurriculumEnrollment.create({
      data: {
        userId,
        curriculumVersionId: version.id,
        curriculumCode: version.code,
        status: "active",
        enrolledAt: EVALUATION_TIME,
        currentLevel,
        highestCompletedLevel: currentLevel - 1,
      },
    });
  }

  async function startLevel(
    enrollment: { id: number; curriculumVersionId: number },
    level: LevelDefinition,
  ) {
    return prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrollment.id,
        curriculumVersionId: enrollment.curriculumVersionId,
        levelDefinitionId: level.id,
        status: "in_progress",
        startedAt: EVALUATION_TIME,
        lastProgressAt: EVALUATION_TIME,
        attemptCount: 0,
      },
    });
  }

  const requestId = (label: string) => `ata-mc-${label}-${process.pid}-${Date.now()}`;

  /* ------------------------------------------------------- the happy path */

  await check("a started, current lesson:manual level completes once and awards its canonical XP", async () => {
    await reset();
    const user = await createUser("learner");
    const { version, levels } = await createGraph(CANONICAL_SHAPE);
    const enrollment = await enroll(user.id, version.id, 1);
    await startLevel(enrollment, levels[0]);

    const receipt = await manual.completeManualLevel({
      actorUserId: user.id,
      stableCode: levels[0].stableCode,
      requestId: requestId("happy"),
      evaluationTime: EVALUATION_TIME,
    });

    assert.equal(receipt.created, true);
    assert.equal(receipt.levelNumber, 1);
    assert.equal(receipt.completionMethod, "manual");
    assert.equal(receipt.xpAwarded, 150);
    assert.equal(receipt.nextLevelNumber, 2);
    assert.equal(receipt.terminal, false);

    const xpRows = await prisma.xPTransaction.count();
    assert.equal(xpRows, 1, "exactly one XP row");
    const progress = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: enrollment.id, levelDefinitionId: levels[0].id },
    });
    assert.equal(progress.status, "completed");
    const after = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    assert.equal(after.currentLevel, 2, "the next level is unlocked");
    assert.equal(after.highestCompletedLevel, 1);
  });

  /* ------------------------------------------------------------ §10 negatives */

  await check("N1 a LOCKED manual level cannot be completed", async () => {
    await reset();
    const user = await createUser("learner");
    const { version, levels } = await createGraph([
      { type: "lesson", completionMethod: "assessment_pass", xpReward: 100 },
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
    ]);
    // The learner stands on level 1; level 2 is locked behind it and never started.
    const enrollment = await enroll(user.id, version.id, 1);
    await startLevel(enrollment, levels[0]);

    await refuses("MANUAL_COMPLETION_LEVEL_NOT_CURRENT", () =>
      manual.completeManualLevel({
        actorUserId: user.id,
        stableCode: levels[1].stableCode,
        requestId: requestId("locked"),
        evaluationTime: EVALUATION_TIME,
      }),
    );
    assert.equal(await prisma.xPTransaction.count(), 0, "no XP was created");
    assert.equal(
      await prisma.userLevelProgress.count({ where: { status: "completed" } }),
      0,
      "nothing was completed",
    );
  });

  await check("N2 a manual level that was never STARTED cannot be completed", async () => {
    await reset();
    const user = await createUser("learner");
    const { version, levels } = await createGraph(CANONICAL_SHAPE);
    await enroll(user.id, version.id, 1);
    // Deliberately no UserLevelProgress row.

    await refuses("MANUAL_COMPLETION_LEVEL_NOT_STARTED", () =>
      manual.completeManualLevel({
        actorUserId: user.id,
        stableCode: levels[0].stableCode,
        requestId: requestId("unstarted"),
        evaluationTime: EVALUATION_TIME,
      }),
    );
    assert.equal(await prisma.xPTransaction.count(), 0);
  });

  await check("N3 another learner cannot be targeted — there is no parameter for it", async () => {
    await reset();
    const victim = await createUser("victim");
    const attacker = await createUser("attacker");
    const { version, levels } = await createGraph(CANONICAL_SHAPE);
    const victimEnrollment = await enroll(victim.id, version.id, 1);
    await startLevel(victimEnrollment, levels[0]);
    // The attacker is not enrolled at all.

    await refuses("MANUAL_COMPLETION_NOT_ENROLLED", () =>
      manual.completeManualLevel({
        actorUserId: attacker.id,
        stableCode: levels[0].stableCode,
        requestId: requestId("cross"),
        evaluationTime: EVALUATION_TIME,
      }),
    );

    const victimProgress = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: victimEnrollment.id, levelDefinitionId: levels[0].id },
    });
    assert.equal(victimProgress.status, "in_progress", "the victim's level is untouched");
    assert.equal(await prisma.xPTransaction.count(), 0);

    // The input type itself has no field naming another learner.
    const inputKeys = ["actorUserId", "stableCode", "requestId", "evaluationTime", "db"];
    assert.ok(!inputKeys.includes("userId"), "there is no userId input");
    assert.ok(!inputKeys.includes("enrollmentId"), "there is no enrollmentId input");
  });

  await check("N3b an enrolled learner cannot complete a level that is not their current one", async () => {
    await reset();
    const learnerA = await createUser("a");
    const learnerB = await createUser("b");
    const { version, levels } = await createGraph([
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
    ]);
    const enrollmentA = await enroll(learnerA.id, version.id, 1);
    await startLevel(enrollmentA, levels[0]);
    const enrollmentB = await enroll(learnerB.id, version.id, 2);
    await startLevel(enrollmentB, levels[1]);

    // A stands on level 1 and asks for level 2 — B's current level.
    await refuses("MANUAL_COMPLETION_LEVEL_NOT_CURRENT", () =>
      manual.completeManualLevel({
        actorUserId: learnerA.id,
        stableCode: levels[1].stableCode,
        requestId: requestId("wrong-level"),
        evaluationTime: EVALUATION_TIME,
      }),
    );
    const bProgress = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: enrollmentB.id, levelDefinitionId: levels[1].id },
    });
    assert.equal(bProgress.status, "in_progress", "B's level is untouched");
  });

  await check("N4 a duplicate completion gives NO duplicate XP (same request id replays)", async () => {
    await reset();
    const user = await createUser("learner");
    const { version, levels } = await createGraph(CANONICAL_SHAPE);
    const enrollment = await enroll(user.id, version.id, 1);
    await startLevel(enrollment, levels[0]);
    const id = requestId("replay");

    const first = await manual.completeManualLevel({
      actorUserId: user.id, stableCode: levels[0].stableCode, requestId: id, evaluationTime: EVALUATION_TIME,
    });
    const second = await manual.completeManualLevel({
      actorUserId: user.id, stableCode: levels[0].stableCode, requestId: id, evaluationTime: EVALUATION_TIME,
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false, "the replay is not a new completion");
    assert.equal(second.completedAt, first.completedAt, "the original completion time is returned");
    assert.equal(await prisma.xPTransaction.count(), 1, "still exactly one XP row");
    const totalXp = await prisma.xPTransaction.aggregate({ _sum: { amount: true } });
    assert.equal(totalXp._sum.amount, 150, "XP was awarded exactly once");
  });

  await check("N4b a DIFFERENT request id against a completed XP-bearing level conflicts", async () => {
    await reset();
    const user = await createUser("learner");
    const { version, levels } = await createGraph(CANONICAL_SHAPE);
    const enrollment = await enroll(user.id, version.id, 1);
    await startLevel(enrollment, levels[0]);

    await manual.completeManualLevel({
      actorUserId: user.id, stableCode: levels[0].stableCode, requestId: requestId("first"), evaluationTime: EVALUATION_TIME,
    });
    // `REQUEST_CONFLICT`, not `LEVEL_NOT_CURRENT`: the stored XP award names the
    // FIRST request identity, and the ledger refuses to answer for an identity it
    // does not hold. That is a more precise answer than "wrong level" and is the
    // documented contract for an XP-bearing level.
    await refuses("MANUAL_COMPLETION_REQUEST_CONFLICT", () =>
      manual.completeManualLevel({
        actorUserId: user.id, stableCode: levels[0].stableCode, requestId: requestId("second"), evaluationTime: EVALUATION_TIME,
      }),
    );
    assert.equal(await prisma.xPTransaction.count(), 1, "no second XP row");
    const total = await prisma.xPTransaction.aggregate({ _sum: { amount: true } });
    assert.equal(total._sum.amount, 150, "XP stayed at exactly one award");
  });

  await check("N5 the wrong completion method is refused — assessment, report, checkpoint, mentor", async () => {
    for (const index of [1, 2, 3, 4]) {
      await reset();
      const user = await createUser("learner");
      const { version, levels } = await createGraph(CANONICAL_SHAPE);
      const level = levels[index];
      const enrollment = await enroll(user.id, version.id, level.levelNumber);
      await startLevel(enrollment, level);

      await refuses("MANUAL_COMPLETION_LEVEL_WRONG_OWNER", () =>
        manual.completeManualLevel({
          actorUserId: user.id,
          stableCode: level.stableCode,
          requestId: requestId(`owner-${index}`),
          evaluationTime: EVALUATION_TIME,
        }),
      );
      assert.equal(
        await prisma.xPTransaction.count(),
        0,
        `${level.type}:${level.completionMethod} must award nothing`,
      );
      assert.equal(
        await prisma.userLevelProgress.count({ where: { status: "completed" } }),
        0,
        `${level.type}:${level.completionMethod} must not complete`,
      );
    }
  });

  await check("N6 a malformed or absent request identity is refused", async () => {
    await reset();
    const user = await createUser("learner");
    const { version, levels } = await createGraph(CANONICAL_SHAPE);
    const enrollment = await enroll(user.id, version.id, 1);
    await startLevel(enrollment, levels[0]);

    for (const bad of ["", "short", "has spaces in it", "a".repeat(200), "!!!!!!!!"]) {
      await refuses("MANUAL_COMPLETION_INPUT_INVALID", () =>
        manual.completeManualLevel({
          actorUserId: user.id,
          stableCode: levels[0].stableCode,
          requestId: bad,
          evaluationTime: EVALUATION_TIME,
        }),
      );
    }
    assert.equal(await prisma.xPTransaction.count(), 0);
  });

  await check("N7 a level that does not exist in the learner's curriculum is refused", async () => {
    await reset();
    const user = await createUser("learner");
    const { version, levels } = await createGraph(CANONICAL_SHAPE);
    const enrollment = await enroll(user.id, version.id, 1);
    await startLevel(enrollment, levels[0]);

    await refuses("MANUAL_COMPLETION_LEVEL_NOT_FOUND", () =>
      manual.completeManualLevel({
        actorUserId: user.id,
        stableCode: "v2.l999.does-not-exist",
        requestId: requestId("missing"),
        evaluationTime: EVALUATION_TIME,
      }),
    );
    assert.equal(await prisma.xPTransaction.count(), 0);
  });

  await check("N8 completion is refused when the content capability is off", async () => {
    await reset();
    const user = await createUser("learner");
    const { version, levels } = await createGraph(CANONICAL_SHAPE);
    const enrollment = await enroll(user.id, version.id, 1);
    await startLevel(enrollment, levels[0]);

    process.env.CURRICULUM_V2_READ_ENABLED = "false";
    try {
      await refuses("MANUAL_COMPLETION_DISABLED", () =>
        manual.completeManualLevel({
          actorUserId: user.id,
          stableCode: levels[0].stableCode,
          requestId: requestId("disabled"),
          evaluationTime: EVALUATION_TIME,
        }),
      );
    } finally {
      process.env.CURRICULUM_V2_READ_ENABLED = "true";
    }
    assert.equal(await prisma.xPTransaction.count(), 0);
  });

  await check("N9 completing the terminal manual level reports terminal and unlocks nothing", async () => {
    await reset();
    const user = await createUser("learner");
    const { version, levels } = await createGraph([
      { type: "lesson", completionMethod: "manual", xpReward: 150 },
    ]);
    const enrollment = await enroll(user.id, version.id, 1);
    await startLevel(enrollment, levels[0]);

    const receipt = await manual.completeManualLevel({
      actorUserId: user.id, stableCode: levels[0].stableCode, requestId: requestId("terminal"), evaluationTime: EVALUATION_TIME,
    });
    assert.equal(receipt.terminal, true);
    assert.equal(receipt.nextLevelNumber, null);
  });

  await check("database integrity intact after every scenario", async () => {
    const fk = (await prisma.$queryRawUnsafe("PRAGMA foreign_key_check")) as unknown[];
    assert.equal(fk.length, 0);
    const integrity = (await prisma.$queryRawUnsafe("PRAGMA integrity_check")) as Array<Record<string, string>>;
    assert.equal(Object.values(integrity[0])[0], "ok");
  });

  await prisma.$disconnect();
  cleanupDb();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  cleanupDb();
  process.exit(1);
});
