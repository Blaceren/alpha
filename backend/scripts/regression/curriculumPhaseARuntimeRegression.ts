/**
 * ATA-PRODUCT-PHASE-A-CURRICULUM-RUNTIME-1 — domain regression.
 *
 * Covers A1 (manual lesson/practical completion), A2 (practical mapping
 * contract), A3 (system auto-enrollment), A4 (mentor review), A5 (package
 * fail-closed validation), A6 (Home summary projection) and A7 (prerequisite
 * scan equivalence).
 *
 * Every scenario owns a temporary SQLite fixture built by the shipped migration
 * runner. No HTTP route, no live database, no external provider and no live
 * environment file is used. The HTTP surface of A1/A4/A6/A8 is exercised by
 * curriculumPhaseAHttpRegression.ts against a throwaway server.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  PrismaClient,
  type LevelDefinition,
  type LevelDefinitionType,
  type UserCurriculumEnrollment,
  type UserLevelProgressStatus,
  type UserRole,
} from "@prisma/client";

const dbPath = `/tmp/ata-curriculum-phase-a-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
process.env.DATABASE_URL = dbUrl;

const EVALUATION_TIME = new Date("2026-08-01T12:00:00.000Z");
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
    console.error(error);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

type Flags = { read?: boolean; enrollment?: boolean; xp?: boolean };

function setFlags(flags: Flags) {
  const values: Record<string, boolean | undefined> = {
    CURRICULUM_V2_READ_ENABLED: flags.read,
    CURRICULUM_V2_ENROLLMENT_ENABLED: flags.enrollment,
    CURRICULUM_V2_XP_ENABLED: flags.xp,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
}

async function expectCode(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    const actual = (error as { code?: string }).code;
    assert.equal(actual, code, `expected ${code}, got ${actual ?? String(error)}`);
    return;
  }
  assert.fail(`expected ${code} but the call resolved`);
}

async function main() {
  cleanupDb();
  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) {
    console.error(migration.stdout, migration.stderr);
    throw new Error(`migration runner exited with ${migration.status}`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const manual = await import("../../src/lib/curriculum/manual-completion");
  const mentor = await import("../../src/lib/curriculum/mentor-review");
  const enrollment = await import("../../src/lib/curriculum/enrollment");
  const levelState = await import("../../src/lib/curriculum/level-state");
  const readApi = await import("../../src/lib/curriculum/read-api");
  const pairs = await import("../../src/lib/curriculum/completion-pairs");
  const practical = await import("../../src/lib/curriculum/practical-mapping");
  const packageValidate = await import("../../src/lib/curriculum/package/validate");
  const packageSchema = await import("../../src/lib/curriculum/package/schema");
  const packageFingerprint = await import("../../src/lib/curriculum/package/fingerprint");

  let sequence = 0;

  async function reset() {
    await prisma.xPTransaction.deleteMany();
    await prisma.userLevelProgress.deleteMany();
    await prisma.stagingAttestation.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.userTaskProgress.deleteMany();
    await prisma.xpEvent.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.user.deleteMany();
    setFlags({ read: true, enrollment: true, xp: true });
  }

  async function createUser(label: string, role: UserRole = "user") {
    sequence += 1;
    return prisma.user.create({
      data: {
        email: `${label}-${process.pid}-${sequence}@example.com`,
        name: label,
        role,
        status: "active",
      },
    });
  }

  type LevelSpec = {
    type?: LevelDefinitionType;
    completionMethod?: string;
    xpReward?: number;
    requiredXp?: number;
  };

  async function createGraph(
    input: { status?: "draft" | "published"; code?: string; levels?: LevelSpec[] } = {},
  ) {
    sequence += 1;
    const status = input.status ?? "published";
    const code = input.code ?? "ata-v2";
    const specs = input.levels ?? [{}, {}];
    const version = await prisma.curriculumVersion.create({
      data: {
        code,
        name: `${code}-${sequence}`,
        versionNumber: sequence,
        status,
        publishedAt: status === "draft" ? null : EVALUATION_TIME,
        effectiveFrom: status === "draft" ? null : new Date(EVALUATION_TIME.getTime() - 60_000),
      },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 1,
        code: `m-${version.id}`,
        title: "Phase A module",
        firstLevel: 1,
        lastLevel: specs.length,
        learningObjective: "Learn",
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
            stableCode: `v2.l${String(levelNumber).padStart(3, "0")}.phase-a-${version.id}`,
            type: spec.type ?? "lesson",
            title: `Level ${levelNumber}`,
            learningObjective: "Learn",
            completionMethod: spec.completionMethod ?? "manual",
            xpReward: spec.xpReward ?? 25 + levelNumber,
            requiredXp: spec.requiredXp ?? 0,
            requiredPreviousLevel: levelNumber === 1 ? null : levelNumber - 1,
            status: "active",
          },
        }),
      );
    }
    return { version, moduleDefinition, levels };
  }

  async function enroll(
    userId: number,
    versionId: number,
    input: { currentLevel?: number; highestCompletedLevel?: number } = {},
  ) {
    const version = await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: versionId } });
    return prisma.userCurriculumEnrollment.create({
      data: {
        userId,
        curriculumVersionId: version.id,
        curriculumCode: version.code,
        status: "active",
        enrolledAt: EVALUATION_TIME,
        currentLevel: input.currentLevel ?? 1,
        highestCompletedLevel: input.highestCompletedLevel ?? 0,
      },
    });
  }

  async function startProgress(
    enrolled: UserCurriculumEnrollment,
    level: LevelDefinition,
    status: UserLevelProgressStatus = "in_progress",
  ) {
    return prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrolled.id,
        curriculumVersionId: enrolled.curriculumVersionId,
        levelDefinitionId: level.id,
        status,
        startedAt: EVALUATION_TIME,
        lastProgressAt: EVALUATION_TIME,
        completedAt: status === "completed" ? EVALUATION_TIME : null,
        attemptCount: 0,
      },
    });
  }

  /** A learner sitting on a started level 1 of the given pair. */
  async function manualFixture(spec: LevelSpec = {}) {
    await reset();
    const user = await createUser("learner");
    const graph = await createGraph({ levels: [spec, {}] });
    const enrolled = await enroll(user.id, graph.version.id);
    await startProgress(enrolled, graph.levels[0]);
    return { user, graph, enrolled, level: graph.levels[0] };
  }

  /* ==================================================================== */
  /* A1 — manual lesson/practical completion                              */
  /* ==================================================================== */

  await check("A1.1 lesson:manual completes and advances the enrollment once", async () => {
    const f = await manualFixture({ completionMethod: "manual", xpReward: 40 });
    const receipt = await manual.completeManualLevel({
      actorUserId: f.user.id,
      stableCode: f.level.stableCode,
      requestId: "manual-a1-0001",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    assert.equal(receipt.created, true);
    assert.equal(receipt.levelNumber, 1);
    assert.equal(receipt.completionMethod, "manual");
    assert.equal(receipt.xpAwarded, 40);
    assert.equal(receipt.nextLevelNumber, 2);
    assert.equal(receipt.terminal, false);

    const after = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: f.enrolled.id },
    });
    assert.equal(after.currentLevel, 2);
    assert.equal(after.highestCompletedLevel, 1);
    const progress = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: f.enrolled.id, levelDefinitionId: f.level.id },
    });
    assert.equal(progress.status, "completed");
  });

  await check("A1.2 lesson:lesson is owned by the same command", async () => {
    const f = await manualFixture({ completionMethod: "lesson", xpReward: 10 });
    const receipt = await manual.completeManualLevel({
      actorUserId: f.user.id,
      stableCode: f.level.stableCode,
      requestId: "manual-a1-0002",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    assert.equal(receipt.created, true);
    assert.equal(receipt.completionMethod, "lesson");
  });

  await check("A1.3 identical retry replays: XP once, unlock once, one audit", async () => {
    const f = await manualFixture({ completionMethod: "manual", xpReward: 40 });
    const first = await manual.completeManualLevel({
      actorUserId: f.user.id,
      stableCode: f.level.stableCode,
      requestId: "manual-a1-0003",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    const second = await manual.completeManualLevel({
      actorUserId: f.user.id,
      stableCode: f.level.stableCode,
      requestId: "manual-a1-0003",
      evaluationTime: new Date(EVALUATION_TIME.getTime() + 60_000),
      db: prisma,
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    // Stable result: the replay reports the ORIGINAL completion time.
    assert.equal(second.completedAt, first.completedAt);
    assert.equal(second.xpTransactionId, first.xpTransactionId);

    const xpRows = await prisma.xPTransaction.findMany({
      where: { enrollmentId: f.enrolled.id, levelDefinitionId: f.level.id },
    });
    assert.equal(xpRows.length, 1, "XP awarded exactly once");
    assert.equal(xpRows[0].amount, 40);

    const enrolledAfter = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: f.enrolled.id },
    });
    assert.equal(enrolledAfter.currentLevel, 2, "unlocked exactly once");
    assert.equal(enrolledAfter.highestCompletedLevel, 1);

    const audits = await prisma.auditLog.findMany({
      where: { action: "CURRICULUM_LEVEL_COMPLETED" },
    });
    assert.equal(audits.length, 1, "one completion audit event");
  });

  await check("A1.4 a different requestId on a completed XP-bearing level conflicts", async () => {
    const f = await manualFixture({ completionMethod: "manual", xpReward: 40 });
    await manual.completeManualLevel({
      actorUserId: f.user.id,
      stableCode: f.level.stableCode,
      requestId: "manual-a1-0004a",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    await expectCode(
      () =>
        manual.completeManualLevel({
          actorUserId: f.user.id,
          stableCode: f.level.stableCode,
          requestId: "manual-a1-0004b",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MANUAL_COMPLETION_REQUEST_CONFLICT",
    );
    const xpRows = await prisma.xPTransaction.count({ where: { enrollmentId: f.enrolled.id } });
    assert.equal(xpRows, 1);
  });

  await check("A1.5 a zero-reward level replays under any request identity", async () => {
    const f = await manualFixture({ completionMethod: "manual", xpReward: 0 });
    const first = await manual.completeManualLevel({
      actorUserId: f.user.id,
      stableCode: f.level.stableCode,
      requestId: "manual-a1-0005a",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    const second = await manual.completeManualLevel({
      actorUserId: f.user.id,
      stableCode: f.level.stableCode,
      requestId: "manual-a1-0005b",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.xpAwarded, 0);
    assert.equal(await prisma.xPTransaction.count(), 0, "zero-reward creates no XP row");
  });

  for (const wrong of [
    { completionMethod: "assessment_pass", type: "lesson" as LevelDefinitionType },
    { completionMethod: "report_approval", type: "report" as LevelDefinitionType },
    { completionMethod: "mentor_review", type: "mentor_review" as LevelDefinitionType },
    { completionMethod: "balance_check", type: "financial_checkpoint" as LevelDefinitionType },
    { completionMethod: "pocket_postback", type: "external_event" as LevelDefinitionType },
  ]) {
    await check(`A1.6 wrong owner refused: ${wrong.type}:${wrong.completionMethod}`, async () => {
      const f = await manualFixture({ ...wrong, xpReward: 0 });
      await expectCode(
        () =>
          manual.completeManualLevel({
            actorUserId: f.user.id,
            stableCode: f.level.stableCode,
            requestId: "manual-a1-wrong01",
            evaluationTime: EVALUATION_TIME,
            db: prisma,
          }),
        "MANUAL_COMPLETION_LEVEL_WRONG_OWNER",
      );
      const progress = await prisma.userLevelProgress.findFirstOrThrow({
        where: { enrollmentId: f.enrolled.id },
      });
      assert.notEqual(progress.status, "completed");
      assert.equal(await prisma.xPTransaction.count(), 0);
    });
  }

  await check("A1.7 a locked (not current) level is refused and writes nothing", async () => {
    await reset();
    const user = await createUser("learner");
    const graph = await createGraph({ levels: [{}, {}, {}] });
    const enrolled = await enroll(user.id, graph.version.id);
    await startProgress(enrolled, graph.levels[0]);
    await expectCode(
      () =>
        manual.completeManualLevel({
          actorUserId: user.id,
          stableCode: graph.levels[2].stableCode,
          requestId: "manual-a1-0007",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MANUAL_COMPLETION_LEVEL_NOT_CURRENT",
    );
    const after = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: enrolled.id },
    });
    assert.equal(after.currentLevel, 1);
    assert.equal(await prisma.userLevelProgress.count(), 1);
  });

  await check("A1.8 a level that was never started is refused", async () => {
    await reset();
    const user = await createUser("learner");
    const graph = await createGraph({ levels: [{}, {}] });
    await enroll(user.id, graph.version.id);
    await expectCode(
      () =>
        manual.completeManualLevel({
          actorUserId: user.id,
          stableCode: graph.levels[0].stableCode,
          requestId: "manual-a1-0008",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MANUAL_COMPLETION_LEVEL_NOT_STARTED",
    );
    assert.equal(await prisma.userLevelProgress.count(), 0);
  });

  await check("A1.9 flags off refuse the command entirely", async () => {
    const f = await manualFixture({ completionMethod: "manual" });
    setFlags({ read: true, enrollment: false, xp: true });
    await expectCode(
      () =>
        manual.completeManualLevel({
          actorUserId: f.user.id,
          stableCode: f.level.stableCode,
          requestId: "manual-a1-0009",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MANUAL_COMPLETION_DISABLED",
    );
    setFlags({ read: false, enrollment: true, xp: true });
    await expectCode(
      () =>
        manual.completeManualLevel({
          actorUserId: f.user.id,
          stableCode: f.level.stableCode,
          requestId: "manual-a1-0009",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MANUAL_COMPLETION_DISABLED",
    );
    setFlags({ read: true, enrollment: true, xp: true });
    assert.equal(await prisma.xPTransaction.count(), 0);
  });

  await check("A1.10 a positive reward with XP disabled fails closed and writes nothing", async () => {
    const f = await manualFixture({ completionMethod: "manual", xpReward: 40 });
    setFlags({ read: true, enrollment: true, xp: false });
    await expectCode(
      () =>
        manual.completeManualLevel({
          actorUserId: f.user.id,
          stableCode: f.level.stableCode,
          requestId: "manual-a1-0010",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MANUAL_COMPLETION_DISABLED",
    );
    setFlags({ read: true, enrollment: true, xp: true });
    const after = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: f.enrolled.id },
    });
    assert.equal(after.currentLevel, 1);
  });

  await check("A1.11 another learner's session cannot complete this level", async () => {
    const f = await manualFixture({ completionMethod: "manual" });
    const stranger = await createUser("stranger");
    await expectCode(
      () =>
        manual.completeManualLevel({
          actorUserId: stranger.id,
          stableCode: f.level.stableCode,
          requestId: "manual-a1-0011",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MANUAL_COMPLETION_NOT_ENROLLED",
    );
  });

  await check("A1.12 a malformed requestId is refused before any read", async () => {
    const f = await manualFixture({ completionMethod: "manual" });
    for (const requestId of ["", "short", "  spaced  ", "has space", "-leading"]) {
      await expectCode(
        () =>
          manual.completeManualLevel({
            actorUserId: f.user.id,
            stableCode: f.level.stableCode,
            requestId,
            evaluationTime: EVALUATION_TIME,
            db: prisma,
          }),
        "MANUAL_COMPLETION_INPUT_INVALID",
      );
    }
  });

  /* ==================================================================== */
  /* A2 — practical mapping contract                                      */
  /* ==================================================================== */

  await check("A2.1 mentorReview=true maps to mentor_review:mentor_review", () => {
    const contract = practical.resolvePracticalLevelContract({ mentorReview: true });
    assert.deepEqual(contract, { type: "mentor_review", completionMethod: "mentor_review" });
  });

  await check("A2.2 every other practical level maps to lesson:manual", () => {
    const contract = practical.resolvePracticalLevelContract({ mentorReview: false });
    assert.deepEqual(contract, { type: "lesson", completionMethod: "manual" });
  });

  await check("A2.3 both practical contracts have a production completion owner", () => {
    for (const contract of practical.PRACTICAL_LEVEL_CONTRACTS) {
      assert.equal(
        pairs.isOwnedCompletionPair(contract.type, contract.completionMethod),
        true,
        `${contract.type}:${contract.completionMethod}`,
      );
    }
  });

  await check("A2.4 the validator refuses a pair that is not the mapped contract", () => {
    assert.equal(
      practical.validatePracticalLevelMapping({ mentorReview: false }, {
        type: "lesson",
        completionMethod: "manual",
      }),
      null,
    );
    const mismatch = practical.validatePracticalLevelMapping({ mentorReview: true }, {
      type: "lesson",
      completionMethod: "manual",
    });
    assert.equal(mismatch?.code, "PRACTICAL_MAPPING_MISMATCH");
    assert.deepEqual(mismatch?.expected, {
      type: "mentor_review",
      completionMethod: "mentor_review",
    });
    // R1: report approval is NOT the practical contract.
    assert.equal(
      practical.validatePracticalLevelMapping({ mentorReview: true }, {
        type: "report",
        completionMethod: "report_approval",
      })?.code,
      "PRACTICAL_MAPPING_MISMATCH",
    );
  });

  await check("A2.5 no practice:* owner and no new owner pair was introduced", () => {
    for (const pair of pairs.OWNED_COMPLETION_PAIRS) {
      assert.equal(pair.startsWith("practice:"), false, pair);
      assert.equal(pair.includes("self_complete"), false, pair);
    }
    // The vocabulary is exactly the six shipped production owners.
    assert.deepEqual(
      Object.keys(pairs.PRODUCTION_COMPLETION_PAIRS).sort(),
      [
        "assessment_pass",
        "checkpoint_verification",
        "level_completion",
        "mentor_completion",
        "pocket_registration_postback",
        "report_approval",
      ],
    );
    assert.deepEqual([...pairs.PRODUCTION_COMPLETION_PAIRS.level_completion].sort(), [
      "lesson:lesson",
      "lesson:manual",
    ]);
  });

  await check("A2.6 the runtime OWNER_RULES agree with the shared vocabulary", () => {
    const source = fs.readFileSync("src/lib/curriculum/completion.ts", "utf8");
    // Every owner's pair set must come from the shared module rather than from
    // a literal, so package validation and the runtime cannot drift apart.
    for (const owner of Object.keys(pairs.PRODUCTION_COMPLETION_PAIRS)) {
      assert.match(source, new RegExp(`pairs: new Set\\(PRODUCTION_COMPLETION_PAIRS\\.${owner}\\)`));
    }
  });

  /* ==================================================================== */
  /* A3 — system auto-enrollment                                          */
  /* ==================================================================== */

  await check("A3.1 the system primitive enrolls at level 1 on the published version", async () => {
    await reset();
    const user = await createUser("newcomer");
    const graph = await createGraph({ levels: [{}, {}] });
    const result = await enrollment.enrollActiveCurriculumForNewUser({
      userId: user.id,
      asOf: EVALUATION_TIME,
      db: prisma,
    });
    assert.equal(result.created, true);
    assert.equal(result.enrollment.currentLevel, 1);
    assert.equal(result.enrollment.highestCompletedLevel, 0);
    assert.equal(result.enrollment.status, "active");
    assert.equal(result.enrollment.curriculumCode, "ata-v2");
    // The version is PINNED onto the enrollment.
    assert.equal(result.enrollment.curriculumVersionId, graph.version.id);
  });

  await check("A3.2 the system audit carries system_registration and no actor user", async () => {
    await reset();
    const user = await createUser("newcomer");
    await createGraph({ levels: [{}, {}] });
    await enrollment.enrollActiveCurriculumForNewUser({
      userId: user.id,
      asOf: EVALUATION_TIME,
      db: prisma,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "CURRICULUM_USER_ENROLLED" },
    });
    assert.equal(audit.userId, null, "no user did this");
    const metadata = audit.metadata as Record<string, unknown>;
    assert.equal(metadata.provenance, "system_registration");
    assert.equal(metadata.actorId, null);
    assert.equal(metadata.targetUserId, user.id);
    // No PII of any kind reached the audit metadata.
    const serialized = JSON.stringify(metadata);
    assert.equal(serialized.includes("@"), false, "no email in audit metadata");
    assert.equal(serialized.includes(user.name ?? "newcomer"), false, "no name in audit metadata");
    for (const forbidden of ["email", "name", "passwordHash", "ip", "referralCode"]) {
      assert.equal(Object.keys(metadata).includes(forbidden), false, forbidden);
    }
  });

  await check("A3.3 the system primitive is idempotent for an already-enrolled learner", async () => {
    await reset();
    const user = await createUser("newcomer");
    await createGraph({ levels: [{}, {}] });
    const first = await enrollment.enrollActiveCurriculumForNewUser({
      userId: user.id,
      asOf: EVALUATION_TIME,
      db: prisma,
    });
    const second = await enrollment.enrollActiveCurriculumForNewUser({
      userId: user.id,
      asOf: EVALUATION_TIME,
      db: prisma,
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.enrollment.id, first.enrollment.id);
    assert.equal(await prisma.userCurriculumEnrollment.count(), 1);
    assert.equal(
      await prisma.auditLog.count({ where: { action: "CURRICULUM_USER_ENROLLED" } }),
      1,
    );
  });

  await check("A3.4 concurrent system enrollments resolve to exactly one enrollment", async () => {
    await reset();
    const user = await createUser("newcomer");
    await createGraph({ levels: [{}, {}] });
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        enrollment.enrollActiveCurriculumForNewUser({
          userId: user.id,
          asOf: EVALUATION_TIME,
          db: prisma,
        }),
      ),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    assert.ok(fulfilled.length >= 1, "at least one call must succeed");
    assert.equal(await prisma.userCurriculumEnrollment.count(), 1);
    const created = fulfilled.filter(
      (r) => (r as PromiseFulfilledResult<{ created: boolean }>).value.created,
    );
    assert.equal(created.length, 1, "exactly one call created the enrollment");
  });

  await check("A3.5 no published curriculum refuses without writing", async () => {
    await reset();
    const user = await createUser("newcomer");
    await createGraph({ status: "draft", levels: [{}, {}] });
    await expectCode(
      () =>
        enrollment.enrollActiveCurriculumForNewUser({
          userId: user.id,
          asOf: EVALUATION_TIME,
          db: prisma,
        }),
      "ENROLLMENT_TARGET_UNAVAILABLE",
    );
    assert.equal(await prisma.userCurriculumEnrollment.count(), 0);
    assert.equal(await prisma.auditLog.count(), 0);
  });

  await check("A3.6 flags off refuse the system primitive and write nothing", async () => {
    await reset();
    const user = await createUser("newcomer");
    await createGraph({ levels: [{}, {}] });
    setFlags({ read: true, enrollment: false, xp: true });
    await expectCode(
      () => enrollment.enrollActiveCurriculumForNewUser({ userId: user.id, db: prisma }),
      "ENROLLMENT_DISABLED",
    );
    setFlags({ read: false, enrollment: true, xp: true });
    await expectCode(
      () => enrollment.enrollActiveCurriculumForNewUser({ userId: user.id, db: prisma }),
      "CURRICULUM_READ_DISABLED",
    );
    setFlags({ read: true, enrollment: true, xp: true });
    assert.equal(await prisma.userCurriculumEnrollment.count(), 0);
  });

  await check("A3.7 the admin command's authorization is unchanged", async () => {
    await reset();
    const learner = await createUser("learner");
    const notAdmin = await createUser("support-person", "support");
    const admin = await createUser("admin-person", "admin");
    const blockedAdmin = await prisma.user.update({
      where: { id: (await createUser("blocked-admin", "admin")).id },
      data: { status: "blocked" },
    });
    await createGraph({ levels: [{}, {}] });

    await expectCode(
      () =>
        enrollment.enrollUserInPublishedCurriculum({
          userId: learner.id,
          actorId: notAdmin.id,
          asOf: EVALUATION_TIME,
          db: prisma,
        }),
      "ENROLLMENT_ACTOR_FORBIDDEN",
    );
    await expectCode(
      () =>
        enrollment.enrollUserInPublishedCurriculum({
          userId: learner.id,
          actorId: blockedAdmin.id,
          asOf: EVALUATION_TIME,
          db: prisma,
        }),
      "ENROLLMENT_ACTOR_FORBIDDEN",
    );
    await expectCode(
      () =>
        enrollment.enrollUserInPublishedCurriculum({
          userId: learner.id,
          actorId: 9_999_999,
          asOf: EVALUATION_TIME,
          db: prisma,
        }),
      "ENROLLMENT_ACTOR_FORBIDDEN",
    );
    assert.equal(await prisma.userCurriculumEnrollment.count(), 0);

    const ok = await enrollment.enrollUserInPublishedCurriculum({
      userId: learner.id,
      actorId: admin.id,
      asOf: EVALUATION_TIME,
      db: prisma,
    });
    assert.equal(ok.created, true);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "CURRICULUM_USER_ENROLLED" },
    });
    assert.equal(audit.userId, admin.id);
    assert.equal((audit.metadata as Record<string, unknown>).provenance, "admin_command");
    assert.equal((audit.metadata as Record<string, unknown>).actorId, admin.id);
  });

  await check("A3.8 the system primitive takes no actor parameter at all", () => {
    const source = fs.readFileSync("src/lib/curriculum/enrollment.ts", "utf8");
    const block = source.match(
      /export type EnrollActiveCurriculumForNewUserInput = \{([\s\S]*?)\n\};/,
    );
    assert.ok(block, "the input type must exist");
    for (const forbidden of ["actorId", "actor", "role", "curriculumVersionId", "currentLevel"]) {
      assert.equal(block[1].includes(forbidden), false, forbidden);
    }
    // Registration wiring is deliberately deferred: no registration route may
    // reference the primitive in this phase.
    const register = fs.readFileSync("src/app/api/auth/register/route.ts", "utf8");
    assert.equal(register.includes("enrollActiveCurriculumForNewUser"), false);
  });

  /* ==================================================================== */
  /* A4 — mentor review                                                   */
  /* ==================================================================== */

  async function mentorFixture() {
    await reset();
    const learner = await createUser("learner");
    const reviewer = await createUser("mentor-person", "mentor");
    const graph = await createGraph({
      levels: [{ type: "mentor_review", completionMethod: "mentor_review", xpReward: 30 }, {}],
    });
    const enrolled = await enroll(learner.id, graph.version.id);
    const progress = await startProgress(enrolled, graph.levels[0]);
    return { learner, reviewer, graph, enrolled, progress, level: graph.levels[0] };
  }

  await check("A4.1 the learner submits their own level for review, idempotently", async () => {
    const f = await mentorFixture();
    const first = await mentor.requestMentorReview({
      actorUserId: f.learner.id,
      stableCode: f.level.stableCode,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    const second = await mentor.requestMentorReview({
      actorUserId: f.learner.id,
      stableCode: f.level.stableCode,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    assert.equal(first.created, true);
    assert.equal(first.state, "pending_review");
    assert.equal(second.created, false);
    const progress = await prisma.userLevelProgress.findUniqueOrThrow({
      where: { id: f.progress.id },
    });
    assert.equal(progress.status, "pending_review");
    assert.equal(progress.completedAt, null);
    assert.equal(
      await prisma.auditLog.count({ where: { action: "CURRICULUM_MENTOR_REVIEW_REQUESTED" } }),
      1,
    );
  });

  await check("A4.2 the learner's own submission never completes the level", async () => {
    const f = await mentorFixture();
    await mentor.requestMentorReview({
      actorUserId: f.learner.id,
      stableCode: f.level.stableCode,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    const enrolledAfter = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: f.enrolled.id },
    });
    assert.equal(enrolledAfter.currentLevel, 1, "no unlock from a review request");
    assert.equal(await prisma.xPTransaction.count(), 0, "no XP from a review request");
  });

  await check("A4.3 an authorized mentor approves and the level completes once", async () => {
    const f = await mentorFixture();
    await mentor.requestMentorReview({
      actorUserId: f.learner.id,
      stableCode: f.level.stableCode,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    const receipt = await mentor.approveMentorReview({
      reviewerUserId: f.reviewer.id,
      progressId: f.progress.id,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    assert.equal(receipt.created, true);
    assert.equal(receipt.state, "completed");
    assert.equal(receipt.reviewerUserId, f.reviewer.id);
    assert.equal(receipt.reviewerRole, "mentor");
    assert.equal(receipt.learnerUserId, f.learner.id);
    assert.equal(receipt.xpAwarded, 30);

    const enrolledAfter = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: f.enrolled.id },
    });
    assert.equal(enrolledAfter.currentLevel, 2);
    assert.equal(await prisma.xPTransaction.count(), 1);

    // The completion audit names the REVIEWER as the actor.
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "CURRICULUM_LEVEL_COMPLETED" },
    });
    assert.equal(audit.userId, f.reviewer.id);
    assert.equal((audit.metadata as Record<string, unknown>).sourceType, "mentor_completion");
  });

  await check("A4.4 an admin reviewer is equally authorized", async () => {
    const f = await mentorFixture();
    const admin = await createUser("admin-reviewer", "admin");
    await mentor.requestMentorReview({
      actorUserId: f.learner.id,
      stableCode: f.level.stableCode,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    const receipt = await mentor.approveMentorReview({
      reviewerUserId: admin.id,
      progressId: f.progress.id,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    assert.equal(receipt.created, true);
    assert.equal(receipt.reviewerRole, "admin");
  });

  await check("A4.5 a learner cannot approve their own review", async () => {
    const f = await mentorFixture();
    await mentor.requestMentorReview({
      actorUserId: f.learner.id,
      stableCode: f.level.stableCode,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    await expectCode(
      () =>
        mentor.approveMentorReview({
          reviewerUserId: f.learner.id,
          progressId: f.progress.id,
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MENTOR_REVIEW_FORBIDDEN",
    );
    const progress = await prisma.userLevelProgress.findUniqueOrThrow({
      where: { id: f.progress.id },
    });
    assert.equal(progress.status, "pending_review");
    assert.equal(await prisma.xPTransaction.count(), 0);
  });

  await check("A4.6 an admin who is the learner still cannot approve their own review", async () => {
    await reset();
    const learnerAdmin = await createUser("learner-admin", "admin");
    const graph = await createGraph({
      levels: [{ type: "mentor_review", completionMethod: "mentor_review", xpReward: 30 }, {}],
    });
    const enrolled = await enroll(learnerAdmin.id, graph.version.id);
    const progress = await startProgress(enrolled, graph.levels[0]);
    await mentor.requestMentorReview({
      actorUserId: learnerAdmin.id,
      stableCode: graph.levels[0].stableCode,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    await expectCode(
      () =>
        mentor.approveMentorReview({
          reviewerUserId: learnerAdmin.id,
          progressId: progress.id,
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MENTOR_REVIEW_SELF_REVIEW_FORBIDDEN",
    );
    const after = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progress.id } });
    assert.equal(after.status, "pending_review");
  });

  for (const role of ["user", "support", "news_editor"] as UserRole[]) {
    await check(`A4.7 an unauthorized ${role} employee cannot approve`, async () => {
      const f = await mentorFixture();
      const employee = await createUser(`emp-${role}`, role);
      await mentor.requestMentorReview({
        actorUserId: f.learner.id,
        stableCode: f.level.stableCode,
        evaluationTime: EVALUATION_TIME,
        db: prisma,
      });
      await expectCode(
        () =>
          mentor.approveMentorReview({
            reviewerUserId: employee.id,
            progressId: f.progress.id,
            evaluationTime: EVALUATION_TIME,
            db: prisma,
          }),
        "MENTOR_REVIEW_FORBIDDEN",
      );
      const progress = await prisma.userLevelProgress.findUniqueOrThrow({
        where: { id: f.progress.id },
      });
      assert.equal(progress.status, "pending_review");
    });
  }

  await check("A4.8 a blocked mentor cannot approve", async () => {
    const f = await mentorFixture();
    const blocked = await prisma.user.update({
      where: { id: (await createUser("blocked-mentor", "mentor")).id },
      data: { status: "blocked" },
    });
    await mentor.requestMentorReview({
      actorUserId: f.learner.id,
      stableCode: f.level.stableCode,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    await expectCode(
      () =>
        mentor.approveMentorReview({
          reviewerUserId: blocked.id,
          progressId: f.progress.id,
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MENTOR_REVIEW_FORBIDDEN",
    );
  });

  await check("A4.9 approval before the learner submits is refused", async () => {
    const f = await mentorFixture();
    await expectCode(
      () =>
        mentor.approveMentorReview({
          reviewerUserId: f.reviewer.id,
          progressId: f.progress.id,
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MENTOR_REVIEW_NOT_PENDING",
    );
    assert.equal(await prisma.xPTransaction.count(), 0);
  });

  await check("A4.10 a repeated approval replays: XP once, unlock once", async () => {
    const f = await mentorFixture();
    const other = await createUser("second-mentor", "mentor");
    await mentor.requestMentorReview({
      actorUserId: f.learner.id,
      stableCode: f.level.stableCode,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    const first = await mentor.approveMentorReview({
      reviewerUserId: f.reviewer.id,
      progressId: f.progress.id,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    const second = await mentor.approveMentorReview({
      reviewerUserId: f.reviewer.id,
      progressId: f.progress.id,
      evaluationTime: new Date(EVALUATION_TIME.getTime() + 60_000),
      db: prisma,
    });
    // A DIFFERENT reviewer is refused rather than told they approved it: the XP
    // ledger records the first reviewer as the award's actor. Either way the
    // level completes exactly once.
    await expectCode(
      () =>
        mentor.approveMentorReview({
          reviewerUserId: other.id,
          progressId: f.progress.id,
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MENTOR_REVIEW_CONFLICT",
    );
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.completedAt, first.completedAt);
    assert.equal(await prisma.xPTransaction.count(), 1);
    const enrolledAfter = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: f.enrolled.id },
    });
    assert.equal(enrolledAfter.currentLevel, 2);
    assert.equal(
      await prisma.auditLog.count({ where: { action: "CURRICULUM_LEVEL_COMPLETED" } }),
      1,
    );
  });

  await check("A4.11 the review lifecycle refuses a non-mentor-review level", async () => {
    const f = await manualFixture({ completionMethod: "manual" });
    await expectCode(
      () =>
        mentor.requestMentorReview({
          actorUserId: f.user.id,
          stableCode: f.level.stableCode,
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MENTOR_REVIEW_LEVEL_WRONG_OWNER",
    );
    const progressRow = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: f.enrolled.id },
    });
    const reviewer = await createUser("m2", "mentor");
    await expectCode(
      () =>
        mentor.approveMentorReview({
          reviewerUserId: reviewer.id,
          progressId: progressRow.id,
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MENTOR_REVIEW_LEVEL_WRONG_OWNER",
    );
  });

  await check("A4.12 a completed level cannot be reopened by the learner", async () => {
    const f = await mentorFixture();
    await mentor.requestMentorReview({
      actorUserId: f.learner.id,
      stableCode: f.level.stableCode,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    await mentor.approveMentorReview({
      reviewerUserId: f.reviewer.id,
      progressId: f.progress.id,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    await expectCode(
      () =>
        mentor.requestMentorReview({
          actorUserId: f.learner.id,
          stableCode: f.level.stableCode,
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "MENTOR_REVIEW_CONFLICT",
    );
    const progress = await prisma.userLevelProgress.findUniqueOrThrow({
      where: { id: f.progress.id },
    });
    assert.equal(progress.status, "completed");
  });

  /* ==================================================================== */
  /* A5 — package fail-closed validation                                  */
  /* ==================================================================== */

  function loadPackage(file: string) {
    return JSON.parse(
      fs.readFileSync(path.join("curriculum", "packages", file), "utf8"),
    ) as Record<string, unknown>;
  }

  type PkgModule = { levels: Array<Record<string, unknown>> };

  await check("A5.1 the shipped approved package still validates unchanged", () => {
    const result = packageValidate.validateCurriculumPackage(
      loadPackage("ata-v2-first-slice.rev3.approved.json"),
    );
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  });

  await check("A5.2 the shipped draft package still validates unchanged", () => {
    const result = packageValidate.validateCurriculumPackage(
      loadPackage("ata-v2-first-slice.draft.json"),
    );
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  });

  await check("A5.3 a level checkpointLevelCode is rejected with a stable code", () => {
    const pkg = loadPackage("ata-v2-first-slice.rev3.approved.json");
    const modules = pkg.modules as PkgModule[];
    const target = modules[0].levels[1];
    target.checkpointLevelCode = modules[0].levels[0].levelCode;
    const result = packageValidate.validateCurriculumPackage(pkg);
    assert.equal(result.ok, false);
    const codes = (result as { issues: Array<{ code: string }> }).issues.map((i) => i.code);
    assert.ok(
      codes.includes("LEVEL_CHECKPOINT_PREREQUISITE_UNSUPPORTED"),
      `expected the explicit code, got ${codes.join(",")}`,
    );
  });

  await check("A5.4 a raw requiredCheckpointLevel is rejected with the same stable code", () => {
    const pkg = loadPackage("ata-v2-first-slice.rev3.approved.json");
    const modules = pkg.modules as PkgModule[];
    modules[0].levels[1].requiredCheckpointLevel = 1;
    const result = packageValidate.validateCurriculumPackage(pkg);
    assert.equal(result.ok, false);
    const issues = (result as { issues: Array<{ code: string; path: string }> }).issues;
    const explicit = issues.find((i) => i.code === "LEVEL_CHECKPOINT_PREREQUISITE_UNSUPPORTED");
    assert.ok(explicit, `expected the explicit code, got ${issues.map((i) => i.code).join(",")}`);
    assert.match(explicit.path, /requiredCheckpointLevel$/);
  });

  await check("A5.5 a visibilityRule is rejected with a stable code, not silently dropped", () => {
    const pkg = loadPackage("ata-v2-first-slice.rev3.approved.json");
    const modules = pkg.modules as PkgModule[];
    modules[0].levels[1].visibilityRule = { hidden: true };
    const result = packageValidate.validateCurriculumPackage(pkg);
    assert.equal(result.ok, false);
    const issues = (result as { issues: Array<{ code: string; path: string }> }).issues;
    const explicit = issues.find((i) => i.code === "LEVEL_VISIBILITY_RULE_UNSUPPORTED");
    assert.ok(explicit, `expected the explicit code, got ${issues.map((i) => i.code).join(",")}`);
    assert.match(explicit.path, /visibilityRule$/);
  });

  await check("A5.6 an explicit null for either field stays legal", () => {
    const pkg = loadPackage("ata-v2-first-slice.rev3.approved.json");
    const modules = pkg.modules as PkgModule[];
    for (const level of modules.flatMap((m) => m.levels)) {
      level.checkpointLevelCode = null;
    }
    const result = packageValidate.validateCurriculumPackage(pkg);
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  });

  await check("A5.7 module-level checkpointLevelCode remains supported", () => {
    const pkg = loadPackage("ata-v2-first-slice.rev3.approved.json");
    const modules = pkg.modules as Array<{ checkpointLevelCode: unknown }>;
    assert.notEqual(modules[0].checkpointLevelCode, null, "fixture must exercise this");
    const result = packageValidate.validateCurriculumPackage(pkg);
    assert.equal(result.ok, true);
  });

  await check("A5.8 an approved package with an unowned completion pair is rejected", () => {
    const pkg = loadPackage("ata-v2-first-slice.rev3.approved.json");
    const modules = pkg.modules as PkgModule[];
    const lesson = modules
      .flatMap((m) => m.levels)
      .find((level) => level.type === "lesson");
    assert.ok(lesson);
    lesson.type = "practice";
    lesson.completionMethod = "self_complete";
    const result = packageValidate.validateCurriculumPackage(pkg);
    assert.equal(result.ok, false);
    const codes = (result as { issues: Array<{ code: string }> }).issues.map((i) => i.code);
    assert.ok(codes.includes("LEVEL_COMPLETION_PAIR_UNOWNED"), codes.join(","));
  });

  await check("A5.9 the importer can no longer write either locking column", () => {
    const source = fs.readFileSync("src/lib/curriculum/package/import.ts", "utf8");
    assert.match(source, /requiredCheckpointLevel: null,/);
    // No assignment of either column to anything but null. A mention in a
    // comment is fine; a Prisma `data` key is not.
    assert.equal(/visibilityRule\s*:/.test(source), false, "visibilityRule must never be written");
    const assignments = [...source.matchAll(/requiredCheckpointLevel:\s*([A-Za-z0-9_.]+)/g)];
    assert.ok(assignments.length > 0, "the column must still be written explicitly");
    for (const assignment of assignments) {
      assert.equal(
        assignment[1],
        "null",
        "requiredCheckpointLevel must only ever be written as null",
      );
    }
    // The old derivation from checkpointLevelCode must be gone.
    assert.equal(
      /requiredCheckpointLevel:\s*\n?\s*level\.checkpointLevelCode/.test(source),
      false,
    );
  });

  /* ==================================================================== */
  /* F2 — a zero-reward gate may not declare a reward                      */
  /* ==================================================================== */

  /**
   * The independent audit's finding: `completion.ts` refuses a positive reward
   * on a gate owner (`COMPLETION_REWARD_INVALID`) and nothing can clear that
   * refusal, but package validation let such a package through — so a package
   * could validate, be approved, be imported, and ship a level the learner
   * reaches and can never leave.
   *
   * `findGate` locates the level by its PAIR rather than by index, so these
   * tests keep testing the rule and not the fixture's ordering.
   */
  function findGate(pkg: Record<string, unknown>, type: string, completionMethod: string) {
    const level = (pkg.modules as PkgModule[])
      .flatMap((m) => m.levels)
      .find(
        (candidate) =>
          candidate.type === type && candidate.completionMethod === completionMethod,
      );
    assert.ok(level, `fixture must contain a ${type}:${completionMethod} level`);
    return level;
  }

  function rewardIssue(result: ReturnType<typeof packageValidate.validateCurriculumPackage>) {
    const issues = (result as { issues?: Array<{ code: string; path: string }> }).issues ?? [];
    return issues.find((i) => i.code === "LEVEL_GATE_REWARD_UNSUPPORTED");
  }

  for (const gate of [
    { type: "external_event", completionMethod: "pocket_postback" },
    { type: "financial_checkpoint", completionMethod: "balance_check" },
  ]) {
    const pair = `${gate.type}:${gate.completionMethod}`;

    await check(`F2.1 ${pair} with xpReward > 0 is rejected in an approved package`, () => {
      const pkg = loadPackage("ata-v2-first-slice.rev3.approved.json");
      findGate(pkg, gate.type, gate.completionMethod).xpReward = 250;
      const result = packageValidate.validateCurriculumPackage(pkg);
      assert.equal(result.ok, false, `${pair} must not validate with a reward`);
      const explicit = rewardIssue(result);
      assert.ok(
        explicit,
        `expected LEVEL_GATE_REWARD_UNSUPPORTED, got ${(result as { issues: Array<{ code: string }> }).issues
          .map((i) => i.code)
          .join(",")}`,
      );
      assert.match(explicit.path, /xpReward$/);
    });

    // The draft policy is the EXISTING one for a broken completion contract:
    // every GATE_* violation in validate.ts is unconditional, so this is too.
    await check(`F2.2 ${pair} with xpReward > 0 is an ERROR in a draft package too`, () => {
      const pkg = loadPackage("ata-v2-first-slice.draft.json");
      assert.equal(pkg.status, "draft", "fixture must be a draft");
      findGate(pkg, gate.type, gate.completionMethod).xpReward = 1;
      const result = packageValidate.validateCurriculumPackage(pkg);
      assert.equal(result.ok, false, "a draft may not declare an impossible contract");
      assert.ok(rewardIssue(result), "must be an issue, not a warning");
      const warnings = (result as { warnings?: Array<{ code: string }> }).warnings ?? [];
      assert.equal(
        warnings.some((w) => w.code === "LEVEL_GATE_REWARD_UNSUPPORTED"),
        false,
        "must not be downgraded to a warning",
      );
    });

    await check(`F2.3 ${pair} with an explicit xpReward of 0 stays valid`, () => {
      const pkg = loadPackage("ata-v2-first-slice.rev3.approved.json");
      findGate(pkg, gate.type, gate.completionMethod).xpReward = 0;
      const result = packageValidate.validateCurriculumPackage(pkg);
      assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
    });
  }

  /**
   * The learner-driven owners MAY carry a reward. Misclassifying any of them as
   * zero-reward would break the XP product outright, so this is asserted two
   * ways: the rule raises nothing for them, and a package that actually awards
   * XP on them still validates completely.
   *
   * `xpReward` is inside the content fingerprint, so the second half has to
   * re-derive `contentFingerprint` — otherwise it would be testing the
   * fingerprint rather than the reward rule.
   */
  function rewardOrdinaryLevels(pkg: Record<string, unknown>, amount: number) {
    let rewarded = 0;
    for (const level of (pkg.modules as PkgModule[]).flatMap((m) => m.levels)) {
      if (pairs.isZeroRewardCompletionPair(level.type as string, level.completionMethod as string)) {
        continue;
      }
      level.xpReward = amount;
      rewarded += 1;
    }
    assert.ok(rewarded >= 2, "fixture must contain at least a lesson and an assessment level");
    return pkg;
  }

  await check("F2.4 an XP-bearing lesson, assessment and report raise no gate-reward issue", () => {
    const pkg = rewardOrdinaryLevels(loadPackage("ata-v2-first-slice.rev3.approved.json"), 120);
    const result = packageValidate.validateCurriculumPackage(pkg);
    const issues = (result as { issues?: Array<{ code: string }> }).issues ?? [];
    const warnings = (result as { warnings?: Array<{ code: string }> }).warnings ?? [];
    assert.equal(
      [...issues, ...warnings].some((i) => i.code === "LEVEL_GATE_REWARD_UNSUPPORTED"),
      false,
      `ordinary owners must keep their reward: ${issues.map((i) => i.code).join(",")}`,
    );
  });

  await check("F2.4b an XP-bearing package validates fully once its fingerprint is re-derived", () => {
    const pkg = rewardOrdinaryLevels(loadPackage("ata-v2-first-slice.rev3.approved.json"), 120);
    const parsed = packageSchema.curriculumPackageSchema.parse(pkg);
    pkg.contentFingerprint = packageFingerprint.calculateFingerprint(parsed);
    const result = packageValidate.validateCurriculumPackage(pkg);
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  });

  await check("F2.5 the validator and the engine read ONE zero-reward list", () => {
    // Drift between "which owners award nothing" in the validator and in
    // completion.ts is the whole reason F2 existed. They must be the same list.
    assert.deepEqual(
      [...pairs.ZERO_REWARD_COMPLETION_PAIRS].sort(),
      ["external_event:pocket_postback", "financial_checkpoint:balance_check"].sort(),
    );
    // The learner-driven owners are NOT zero-reward.
    for (const pair of [
      "lesson:lesson",
      "lesson:manual",
      "lesson:assessment_pass",
      "final_exam:assessment_pass",
      "report:report_approval",
      "mentor_review:mentor_review",
    ]) {
      const [type, completionMethod] = pair.split(":");
      assert.equal(
        pairs.isZeroRewardCompletionPair(type, completionMethod),
        false,
        `${pair} must remain able to award XP`,
      );
    }
    // completion.ts consumes the shared set rather than repeating the names.
    const engine = fs.readFileSync("src/lib/curriculum/completion.ts", "utf8");
    assert.match(engine, /ZERO_REWARD_ONLY_OWNERS\.has\(sourceType\)/);
    assert.deepEqual([...pairs.ZERO_REWARD_ONLY_OWNERS].sort(), [
      "checkpoint_verification",
      "pocket_registration_postback",
      "staging_attested_checkpoint",
      "staging_attested_registration",
    ]);
  });

  await check("F2.6 every shipped package still validates unchanged", () => {
    for (const file of [
      "ata-v2-first-slice.rev3.approved.json",
      "ata-v2-first-slice.approved.json",
      "ata-v2-first-slice.draft.json",
    ]) {
      const result = packageValidate.validateCurriculumPackage(loadPackage(file));
      assert.equal(result.ok, true, `${file}: ${JSON.stringify(result.ok ? [] : result.issues)}`);
      const warnings = (result as { warnings?: Array<{ code: string }> }).warnings ?? [];
      assert.equal(
        warnings.some((w) => w.code === "LEVEL_GATE_REWARD_UNSUPPORTED"),
        false,
        `${file} must not gain a new warning`,
      );
    }
  });

  /* ==================================================================== */
  /* A6 — Home summary projection                                         */
  /* ==================================================================== */

  await check("A6.1 the summary carries the Home facts and no other level", async () => {
    await reset();
    const user = await createUser("learner");
    const graph = await createGraph({
      levels: Array.from({ length: 8 }, () => ({ completionMethod: "manual", xpReward: 10 })),
    });
    const enrolled = await enroll(user.id, graph.version.id, {
      currentLevel: 4,
      highestCompletedLevel: 3,
    });
    for (const level of graph.levels.slice(0, 3)) {
      await startProgress(enrolled, level, "completed");
    }
    await startProgress(enrolled, graph.levels[3]);

    const states = await levelState.resolveUserCurriculumLevelStates({
      userId: user.id,
      asOf: EVALUATION_TIME,
    });
    assert.equal(states.kind, "resolved");
    const summary = readApi.mapEnrolledCurriculumSummary(
      states as Extract<typeof states, { kind: "resolved" }>,
    );

    assert.equal(summary.shape, "summary");
    assert.equal(summary.kind, "enrolled");
    assert.equal(summary.progress.currentLevel, 4);
    assert.equal(summary.progress.totalLevels, 8);
    assert.equal(summary.progress.completedLevels, 3);
    assert.equal(summary.progress.highestCompletedLevel, 3);
    assert.equal(summary.progress.percentComplete, 37);
    assert.equal(summary.currentModule?.moduleNumber, 1);
    assert.equal(summary.currentLevel.levelNumber, 4);
    assert.equal(summary.currentLevel.stableCode, graph.levels[3].stableCode);
    assert.equal(summary.currentLevel.presentationState, "in_progress");
    assert.equal(summary.currentLevel.completionMethod, "manual");
    assert.equal(summary.nextLevel?.levelNumber, 5);
    assert.equal(summary.xp.kind, "available");

    // The whole graph must NOT be in the payload: only the current level and a
    // one-line pointer at the next one. Levels 1-3 (completed), and 6-8, are
    // absent entirely.
    const serialized = JSON.stringify(summary);
    for (const level of [...graph.levels.slice(0, 3), ...graph.levels.slice(5)]) {
      assert.equal(serialized.includes(level.stableCode), false, level.stableCode);
    }
    assert.equal("modules" in summary, false, "no module/level graph in the summary");
    // No PII.
    assert.equal(serialized.includes("@"), false);
    assert.equal(serialized.includes(String(user.id)) && serialized.includes("userId"), false);
  });

  await check("A6.2 the full shape is unchanged and still carries the graph", async () => {
    await reset();
    const user = await createUser("learner");
    const graph = await createGraph({ levels: [{ completionMethod: "manual" }, {}] });
    const enrolled = await enroll(user.id, graph.version.id);
    await startProgress(enrolled, graph.levels[0]);
    const states = await levelState.resolveUserCurriculumLevelStates({
      userId: user.id,
      asOf: EVALUATION_TIME,
    });
    const full = readApi.mapEnrolledCurriculumRead(
      states as Extract<typeof states, { kind: "resolved" }>,
    );
    assert.equal(full.kind, "enrolled");
    assert.equal("shape" in full, false, "the default response gains no new key");
    assert.equal(full.modules.length, 1);
    assert.equal(full.modules[0].levels.length, 2);
  });

  await check("A6.3 the last level has no next level and 0 levels is not NaN", async () => {
    await reset();
    const user = await createUser("learner");
    const graph = await createGraph({
      levels: [{ completionMethod: "manual" }, { completionMethod: "manual" }],
    });
    const enrolled = await enroll(user.id, graph.version.id, {
      currentLevel: 2,
      highestCompletedLevel: 1,
    });
    await startProgress(enrolled, graph.levels[0], "completed");
    await startProgress(enrolled, graph.levels[1]);
    const states = await levelState.resolveUserCurriculumLevelStates({
      userId: user.id,
      asOf: EVALUATION_TIME,
    });
    const summary = readApi.mapEnrolledCurriculumSummary(
      states as Extract<typeof states, { kind: "resolved" }>,
    );
    assert.equal(summary.nextLevel, null);
    assert.equal(summary.progress.percentComplete, 50);
  });

  await check("A6.4 the route validates shape strictly and defaults to full", () => {
    const source = fs.readFileSync("src/app/api/curriculum/v2/current/route.ts", "utf8");
    assert.match(source, /const RESPONSE_SHAPES = \["full", "summary"\] as const;/);
    // An unknown parameter name, a repeated shape and an unknown value all fail.
    assert.match(source, /if \(key !== "shape"\) return null;/);
    assert.match(source, /if \(values\.length !== 1\) return null;/);
    assert.match(source, /if \(values\.length === 0\) return "full";/);
  });

  /* ==================================================================== */
  /* A7 — prerequisite scan equivalence                                   */
  /* ==================================================================== */

  /**
   * The reference implementation: the exact predicate the O(n^2) scan computed,
   * written out independently here so equivalence is checked against the
   * original definition rather than against the optimisation's own reasoning.
   */
  function referenceSequenceIncomplete(levelNumber: number, completed: ReadonlySet<number>) {
    for (let previous = 1; previous < levelNumber; previous += 1) {
      if (!completed.has(previous)) return true;
    }
    return false;
  }

  async function blockersFor(levelCount: number, completedUpTo: number) {
    await reset();
    const user = await createUser("learner");
    const graph = await createGraph({
      levels: Array.from({ length: levelCount }, () => ({ completionMethod: "manual" })),
    });
    const enrolled = await enroll(user.id, graph.version.id, {
      currentLevel: completedUpTo + 1,
      highestCompletedLevel: completedUpTo,
    });
    for (const level of graph.levels.slice(0, completedUpTo)) {
      await startProgress(enrolled, level, "completed");
    }
    const states = await levelState.resolveUserCurriculumLevelStates({
      userId: user.id,
      asOf: EVALUATION_TIME,
    });
    assert.equal(states.kind, "resolved", `level states must resolve (${levelCount}/${completedUpTo})`);
    const resolved = states as Extract<typeof states, { kind: "resolved" }>;
    const completedNumbers = new Set(
      Array.from({ length: completedUpTo }, (_, index) => index + 1),
    );
    return { resolved, completedNumbers };
  }

  for (const scenario of [
    { levels: 5, completed: 0, label: "no completed levels" },
    { levels: 5, completed: 1, label: "level 1 completed" },
    { levels: 5, completed: 3, label: "contiguous completion" },
    { levels: 5, completed: 4, label: "all but the last" },
    { levels: 100, completed: 0, label: "100 levels, none completed" },
    { levels: 100, completed: 99, label: "100 levels, standing on level 100" },
  ]) {
    await check(`A7.1 sequence_incomplete is unchanged: ${scenario.label}`, async () => {
      const { resolved, completedNumbers } = await blockersFor(
        scenario.levels,
        scenario.completed,
      );
      for (const item of resolved.levels) {
        const expected = referenceSequenceIncomplete(
          item.levelDefinition.levelNumber,
          completedNumbers,
        );
        const actual = item.blockers.includes("sequence_incomplete");
        assert.equal(
          actual,
          expected,
          `level ${item.levelDefinition.levelNumber}: expected ${expected}, got ${actual}`,
        );
      }
    });
  }

  await check("A7.2 exactly one level is available and unlock policy is unchanged", async () => {
    const { resolved } = await blockersFor(100, 40);
    const available = resolved.levels.filter((item) => item.state === "available");
    assert.equal(available.length, 1);
    assert.equal(available[0].levelDefinition.levelNumber, 41);
    const completed = resolved.levels.filter((item) => item.state === "completed");
    assert.equal(completed.length, 40);
    // Levels 42-100 require no XP, so with the XP engine on they present as
    // `xp_eligible` (threshold met, still gated by sequence/current-level) — the
    // shipped policy, unchanged by the optimisation. Every one of them still
    // carries the sequence blocker, which is the fact under test.
    const eligible = resolved.levels.filter((item) => item.state === "xp_eligible");
    assert.equal(eligible.length, 59);
    assert.equal(resolved.levels.filter((item) => item.state === "locked").length, 0);
    for (const item of eligible) {
      assert.ok(item.blockers.includes("sequence_incomplete"), String(item.levelDefinition.levelNumber));
      assert.ok(item.blockers.includes("not_current_level"));
    }
    // The current level carries no blockers at all.
    assert.deepEqual(available[0].blockers, []);
  });

  await check("A7.3 a completion gap is still refused as corrupt", async () => {
    await reset();
    const user = await createUser("learner");
    const graph = await createGraph({
      levels: Array.from({ length: 5 }, () => ({ completionMethod: "manual" })),
    });
    const enrolled = await enroll(user.id, graph.version.id, {
      currentLevel: 4,
      highestCompletedLevel: 3,
    });
    // Levels 1 and 3 completed, 2 skipped: a gap the resolver must refuse.
    await startProgress(enrolled, graph.levels[0], "completed");
    await startProgress(enrolled, graph.levels[2], "completed");
    const states = await levelState.resolveUserCurriculumLevelStates({
      userId: user.id,
      asOf: EVALUATION_TIME,
    });
    assert.equal(states.kind, "corrupt");
    assert.equal(
      (states as { reason: string }).reason,
      "invalid_summary_progress",
    );
  });

  await check("A7.4 the quadratic inner scan is gone", () => {
    const source = fs.readFileSync("src/lib/curriculum/level-state.ts", "utf8");
    assert.equal(
      source.includes("for (let previous = 1; previous < levelDefinition.levelNumber"),
      false,
      "the per-level backward scan must be gone",
    );
    assert.match(source, /let firstIncompleteLevel = 1;/);
    assert.match(source, /if \(firstIncompleteLevel < levelDefinition\.levelNumber\)/);
  });

  await prisma.$disconnect();
  cleanupDb();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  cleanupDb();
  process.exit(1);
});
