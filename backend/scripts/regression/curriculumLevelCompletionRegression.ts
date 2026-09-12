import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  Prisma,
  PrismaClient,
  type CurriculumVersionStatus,
  type LevelDefinition,
  type LevelDefinitionType,
  type UserCurriculumEnrollment,
  type UserLevelProgressStatus,
} from "@prisma/client";

// Phase 3B.4 regression: every scenario owns a temporary SQLite fixture. No
// HTTP route, live database, notification provider or external owner is used.
const dbPath = `/tmp/ata-curriculum-level-completion-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = dbUrl;

const EVALUATION_TIME = new Date("2026-07-01T12:00:00.000Z");
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

type Flags = { read?: boolean; enrollment?: boolean; xp?: boolean; admin?: boolean };

function setFlags(flags: Flags) {
  const values: Record<string, boolean | undefined> = {
    CURRICULUM_V2_READ_ENABLED: flags.read,
    CURRICULUM_V2_ENROLLMENT_ENABLED: flags.enrollment,
    CURRICULUM_V2_XP_ENABLED: flags.xp,
    CURRICULUM_V2_ADMIN_ENABLED: flags.admin,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
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
  const completion = await import("../../src/lib/curriculum/completion");
  const levelState = await import("../../src/lib/curriculum/level-state");
  const resolver = await import("../../src/lib/curriculum/resolver");
  const xp = await import("../../src/lib/curriculum/xp");

  let sequence = 0;
  const rollbackProofs: boolean[] = [];

  async function reset() {
    for (const trigger of [
      "fail_xp_audit",
      "fail_completion_audit",
      "fail_progress_update",
      "fail_enrollment_update",
      "fail_unknown_update",
    ]) {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger}`);
    }
    // POCKET-REG-INGRESS-1: migration 47's Growth ledger references the
    // enrollment/level/user rows with Restrict; ledger rows first, or the
    // cleanup below violates the FK it predates.
    await prisma.growthEventOutbox.deleteMany();
    await prisma.growthEvent.deleteMany();
    await prisma.xPTransaction.deleteMany();
    await prisma.userLevelProgress.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.crmUserCohort.deleteMany();
    await prisma.userTaskProgress.deleteMany();
    await prisma.xpEvent.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.user.deleteMany();
    setFlags({ read: true, enrollment: true, xp: true, admin: false });
  }

  async function createUser(label: string) {
    sequence += 1;
    return prisma.user.create({
      data: {
        email: `${label}-${process.pid}-${sequence}@example.com`,
        name: label,
        status: "active",
      },
    });
  }

  type LevelSpec = {
    type?: LevelDefinitionType;
    completionMethod?: string;
    xpReward?: number;
    requiredXp?: number;
    requiredCheckpointLevel?: number | null;
    status?: "active" | "disabled";
  };

  async function createGraph(input: {
    status?: CurriculumVersionStatus;
    code?: string;
    levels?: LevelSpec[];
  } = {}) {
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
      },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 1,
        code: `m-${version.id}`,
        title: "Completion module",
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
            stableCode: `v2.l${String(levelNumber).padStart(3, "0")}.completion-${version.id}`,
            type: spec.type ?? "lesson",
            title: `Level ${levelNumber}`,
            completionMethod: spec.completionMethod ?? "lesson",
            xpReward: spec.xpReward ?? 25 + levelNumber,
            requiredXp: spec.requiredXp ?? 0,
            requiredPreviousLevel: levelNumber === 1 ? null : levelNumber - 1,
            requiredCheckpointLevel: spec.requiredCheckpointLevel ?? null,
            status: spec.status ?? "active",
          },
        }),
      );
    }
    return { version, moduleDefinition, levels };
  }

  async function enroll(
    userId: number,
    versionId: number,
    input: {
      status?: "active" | "completed" | "superseded";
      currentLevel?: number;
      highestCompletedLevel?: number;
      completedAt?: Date | null;
    } = {},
  ) {
    const status = input.status ?? "active";
    const version = await prisma.curriculumVersion.findUniqueOrThrow({
      where: { id: versionId },
    });
    return prisma.userCurriculumEnrollment.create({
      data: {
        userId,
        curriculumVersionId: version.id,
        curriculumCode: version.code,
        status,
        enrolledAt: EVALUATION_TIME,
        currentLevel: input.currentLevel ?? 1,
        highestCompletedLevel: input.highestCompletedLevel ?? 0,
        completedAt:
          input.completedAt === undefined
            ? status === "completed"
              ? EVALUATION_TIME
              : null
            : input.completedAt,
      },
    });
  }

  async function progress(
    enrollment: UserCurriculumEnrollment,
    level: LevelDefinition,
    input: {
      status?: UserLevelProgressStatus;
      attemptCount?: number;
      completedAt?: Date | null;
      completionEvidence?: Prisma.InputJsonValue | typeof Prisma.DbNull;
    } = {},
  ) {
    const status = input.status ?? "in_progress";
    return prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrollment.id,
        curriculumVersionId: enrollment.curriculumVersionId,
        levelDefinitionId: level.id,
        status,
        startedAt: EVALUATION_TIME,
        lastProgressAt: EVALUATION_TIME,
        completedAt:
          input.completedAt === undefined
            ? status === "completed"
              ? EVALUATION_TIME
              : null
            : input.completedAt,
        completionEvidence: input.completionEvidence,
        attemptCount: input.attemptCount ?? 0,
      },
    });
  }

  async function setup(input: {
    graphStatus?: CurriculumVersionStatus;
    levels?: LevelSpec[];
    progressStatus?: UserLevelProgressStatus;
    attemptCount?: number;
  } = {}) {
    await reset();
    const user = await createUser("owner");
    const graph = await createGraph({
      status: input.graphStatus,
      levels: input.levels,
    });
    const enrollment = await enroll(user.id, graph.version.id);
    const levelProgress = await progress(enrollment, graph.levels[0], {
      status: input.progressStatus,
      attemptCount: input.attemptCount,
    });
    return { user, graph, enrollment, levelProgress };
  }

  function commandInput(
    fixture: Awaited<ReturnType<typeof setup>>,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      enrollmentId: fixture.enrollment.id,
      levelDefinitionId: fixture.graph.levels[0].id,
      sourceType: "level_completion" as const,
      sourceId: `lesson-owner-${fixture.enrollment.id}`,
      actorId: fixture.user.id,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
      ...overrides,
    };
  }

  async function run(
    fixture: Awaited<ReturnType<typeof setup>>,
    overrides: Record<string, unknown> = {},
  ) {
    return completion.completeCurriculumLevel(
      commandInput(fixture, overrides) as Parameters<
        typeof completion.completeCurriculumLevel
      >[0],
    );
  }

  function expectResult(
    result: Awaited<ReturnType<typeof completion.completeCurriculumLevel>>,
    kind: Awaited<ReturnType<typeof completion.completeCurriculumLevel>>["kind"],
    code?: string,
  ) {
    assert.equal(result.kind, kind);
    if (code) assert.equal((result as { code?: string }).code, code);
  }

  /**
   * Nothing was written — asserted WITHOUT touching `rollbackProofs`.
   *
   * `assertRolledBack` below records into that array, which check 64 counts to
   * prove every INJECTED failure rolled back. A plain refusal is not an injected
   * failure, so counting one there would inflate a number that means something
   * else.
   */
  async function assertUntouched(fixture: Awaited<ReturnType<typeof setup>>) {
    const storedProgress = await prisma.userLevelProgress.findUniqueOrThrow({
      where: { id: fixture.levelProgress.id },
    });
    const storedEnrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: fixture.enrollment.id },
    });
    assert.equal(storedProgress.status, fixture.levelProgress.status);
    assert.equal(storedProgress.completedAt, null);
    assert.equal(storedProgress.completionEvidence, null);
    assert.equal(storedEnrollment.currentLevel, fixture.enrollment.currentLevel);
    assert.equal(
      storedEnrollment.highestCompletedLevel,
      fixture.enrollment.highestCompletedLevel,
    );
  }

  async function assertRolledBack(fixture: Awaited<ReturnType<typeof setup>>) {
    const storedProgress = await prisma.userLevelProgress.findUniqueOrThrow({
      where: { id: fixture.levelProgress.id },
    });
    const storedEnrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: fixture.enrollment.id },
    });
    const proof =
      storedProgress.status === "in_progress" &&
      storedProgress.completedAt === null &&
      storedEnrollment.currentLevel === 1 &&
      storedEnrollment.highestCompletedLevel === 0 &&
      (await prisma.xPTransaction.count()) === 0 &&
      (await prisma.auditLog.count()) === 0;
    rollbackProofs.push(proof);
    assert.equal(proof, true);
  }

  async function withTrigger(name: string, sql: string, fn: () => Promise<void>) {
    await prisma.$executeRawUnsafe(sql);
    try {
      await fn();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name}`);
    }
  }

  // Flags (1-5)
  await check("READ off disables completion", async () => {
    const fixture = await setup();
    setFlags({ read: false, enrollment: true, xp: true });
    expectResult(await run(fixture), "disabled", "COMPLETION_DISABLED");
  });
  await check("ENROLLMENT off disables completion", async () => {
    const fixture = await setup();
    setFlags({ read: true, enrollment: false, xp: true });
    expectResult(await run(fixture), "disabled", "COMPLETION_DISABLED");
  });
  await check("XP off disables completion", async () => {
    const fixture = await setup();
    setFlags({ read: true, enrollment: true, xp: false });
    expectResult(await run(fixture), "disabled", "COMPLETION_DISABLED");
  });
  await check("ADMIN does not replace required flags", async () => {
    const fixture = await setup();
    setFlags({ read: false, enrollment: false, xp: false, admin: true });
    expectResult(await run(fixture), "disabled", "COMPLETION_DISABLED");
  });
  await check("flag failure writes nothing", async () => {
    const fixture = await setup();
    setFlags({ read: false, enrollment: true, xp: true });
    await run(fixture);
    assert.equal(await prisma.xPTransaction.count(), 0);
    assert.equal(await prisma.auditLog.count(), 0);
    assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: fixture.levelProgress.id } })).status, "in_progress");
  });

  // Validation (6-22)
  await check("missing enrollment is rejected", async () => {
    await reset();
    const result = await completion.completeCurriculumLevel({
      db: prisma,
      enrollmentId: 999999,
      levelDefinitionId: 999999,
      sourceType: "level_completion",
      sourceId: "missing-owner",
      evaluationTime: EVALUATION_TIME,
    });
    expectResult(result, "rejected", "COMPLETION_ENROLLMENT_NOT_FOUND");
  });
  await check("draft pin is corrupt", async () => {
    const fixture = await setup({ graphStatus: "draft" });
    expectResult(await run(fixture), "corrupt", "COMPLETION_ENROLLMENT_CORRUPT");
  });
  await check("archived pin remains completable", async () => {
    const fixture = await setup({ graphStatus: "archived" });
    const result = await run(fixture);
    assert.equal(result.kind, "completed");
    assert.equal(result.created, true);
  });
  await check("foreign-version level is rejected", async () => {
    const fixture = await setup();
    const foreign = await createGraph({ status: "draft", code: "foreign-v2" });
    expectResult(
      await run(fixture, { levelDefinitionId: foreign.levels[0].id }),
      "rejected",
      "COMPLETION_LEVEL_NOT_CURRENT",
    );
  });
  await check("inactive definition is corrupt", async () => {
    const fixture = await setup({
      graphStatus: "archived",
      levels: [{ status: "disabled" }, {}],
    });
    expectResult(await run(fixture), "corrupt", "COMPLETION_STATE_CORRUPT");
  });
  await check("previous active level is not current", async () => {
    const fixture = await setup();
    await prisma.userLevelProgress.delete({ where: { id: fixture.levelProgress.id } });
    await prisma.userCurriculumEnrollment.update({
      where: { id: fixture.enrollment.id },
      data: { currentLevel: 2, highestCompletedLevel: 1 },
    });
    expectResult(await run(fixture), "rejected", "COMPLETION_LEVEL_NOT_CURRENT");
  });
  await check("future level is not current", async () => {
    const fixture = await setup();
    expectResult(
      await run(fixture, { levelDefinitionId: fixture.graph.levels[1].id }),
      "rejected",
      "COMPLETION_LEVEL_NOT_CURRENT",
    );
  });
  await check("missing progress is typed not-started", async () => {
    const fixture = await setup();
    await prisma.userLevelProgress.delete({ where: { id: fixture.levelProgress.id } });
    expectResult(await run(fixture), "rejected", "COMPLETION_PROGRESS_NOT_STARTED");
  });
  await check("invalid persisted progress status is rejected", async () => {
    const fixture = await setup();
    await prisma.$executeRawUnsafe(
      `UPDATE "UserLevelProgress" SET "status"='invalid_status' WHERE "id"=${fixture.levelProgress.id}`,
    );
    expectResult(await run(fixture), "rejected", "COMPLETION_STATUS_INVALID");
  });
  await check("sequence gap is corrupt", async () => {
    const fixture = await setup();
    await prisma.userLevelProgress.delete({ where: { id: fixture.levelProgress.id } });
    await prisma.userCurriculumEnrollment.update({
      where: { id: fixture.enrollment.id },
      data: { currentLevel: 2, highestCompletedLevel: 1 },
    });
    await progress(fixture.enrollment, fixture.graph.levels[1]);
    expectResult(
      await run(fixture, { levelDefinitionId: fixture.graph.levels[1].id }),
      "corrupt",
      "COMPLETION_STATE_CORRUPT",
    );
  });
  await check("summary contradiction is corrupt", async () => {
    const fixture = await setup();
    await prisma.userCurriculumEnrollment.update({
      where: { id: fixture.enrollment.id },
      data: { currentLevel: 2, highestCompletedLevel: 0 },
    });
    expectResult(await run(fixture), "corrupt", "COMPLETION_STATE_CORRUPT");
  });
  await check("owner/source mismatch is rejected", async () => {
    const fixture = await setup();
    expectResult(
      await run(fixture, { sourceType: "report_approval" }),
      "rejected",
      "COMPLETION_OWNER_MISMATCH",
    );
  });
  for (const [number, source] of [
    [18, "promocode"],
    [19, "migration_adjustment"],
  ] as const) {
    await check(`${source} cannot complete a level`, async () => {
      void number;
      const fixture = await setup();
      expectResult(
        await run(fixture, { sourceType: source }),
        "rejected",
        "COMPLETION_OWNER_MISMATCH",
      );
    });
  }

  // PHASE-1 ADMIN — `admin_correction` USED TO BE IN THE LIST ABOVE.
  //
  // It was an XP-ledger source with no completion owner, so the engine refused
  // it as `COMPLETION_OWNER_MISMATCH` exactly like `promocode` and
  // `migration_adjustment`. It is now the administrative forward-correction
  // owner, so that assertion is obsolete — but the property it protected is
  // not, and these three checks are what replace it: the owner cannot be
  // reached without provenance, cannot reach a protected gate, and still
  // refuses a level it does not own.
  await check("admin_correction is refused without administrative provenance", async () => {
    const fixture = await setup();
    expectResult(
      await run(fixture, { sourceType: "admin_correction" }),
      "rejected",
      "COMPLETION_INPUT_INVALID",
    );
    await assertUntouched(fixture);
  });

  await check("admin_correction completes an owned pair when provenance is supplied", async () => {
    const fixture = await setup();
    const result = await run(fixture, {
      sourceType: "admin_correction",
      sourceId: "admin-correction:probe-00000001:l1",
      administrativeProvenance: {
        reasonCode: "preprod_qa",
        actorStaffProfileId: "stubstaffprofileid",
        requestIdHash: `sha256:${"a".repeat(64)}`,
        referenceId: null,
      },
    });
    expectResult(result, "completed");
    const stored = await prisma.userLevelProgress.findUniqueOrThrow({
      where: { id: fixture.levelProgress.id },
    });
    assert.equal(stored.status, "completed");
    assert.equal(stored.completionMethod, "admin_correction");
    assert.ok(stored.completionEvidence, "administrative provenance must be durable");
  });

  await check("admin_correction cannot complete a protected gate", async () => {
    const fixture = await setup();
    await prisma.levelDefinition.update({
      where: { id: fixture.graph.levels[0].id },
      data: {
        type: "financial_checkpoint",
        completionMethod: "balance_check",
        xpReward: 0,
      },
    });
    expectResult(
      await run(fixture, {
        sourceType: "admin_correction",
        sourceId: "admin-correction:probe-00000002:l1",
        administrativeProvenance: {
          reasonCode: "preprod_qa",
          actorStaffProfileId: "stubstaffprofileid",
          requestIdHash: `sha256:${"b".repeat(64)}`,
          referenceId: null,
        },
      }),
      "rejected",
      // `assertOwnerRule` refuses it FIRST, because the pair belongs to
      // `checkpoint_verification` and is absent from the administrative owner's
      // derived pair set — so the engine can say the precise thing ("this source
      // does not own this level") rather than the vaguer "no owner exists".
      // `assertAdminCorrectionBoundary` sits behind that as the second,
      // independent assertion and only fires if the derivation itself breaks.
      "COMPLETION_OWNER_MISMATCH",
    );
    await assertUntouched(fixture);
  });
  await check("a financial checkpoint has exactly one owner (L4VC-1)", async () => {
    // Before L4VC-1 `financial_checkpoint:balance_check` had NO owner at all,
    // so every source was refused as OWNER_UNAVAILABLE. It now has exactly one
    // (`checkpoint_verification`), so the default source is refused as the
    // WRONG owner instead. The level is still not completed either way.
    const fixture = await setup({
      graphStatus: "archived",
      levels: [{ type: "financial_checkpoint", completionMethod: "balance_check" }, {}],
    });
    expectResult(await run(fixture), "rejected", "COMPLETION_OWNER_MISMATCH");
  });
  await check("an unmapped level type still has no owner at all", async () => {
    // `scenario:manual` remains unowned, so OWNER_UNAVAILABLE is still reachable
    // and still means what it always meant.
    const fixture = await setup({
      graphStatus: "archived",
      levels: [{ type: "scenario", completionMethod: "manual" }, {}],
    });
    expectResult(await run(fixture), "rejected", "COMPLETION_OWNER_UNAVAILABLE");
  });
  await check("the checkpoint owner cannot complete without a verification proof", async () => {
    const fixture = await setup({
      graphStatus: "archived",
      levels: [{ type: "financial_checkpoint", completionMethod: "balance_check" }, {}],
    });
    // No CheckpointVerificationAttempt exists, so the proof is missing.
    expectResult(
      await run(fixture, {
        sourceType: "checkpoint_verification",
        sourceId: "checkpoint-verification:1",
      }),
      "corrupt",
      "COMPLETION_STATE_CORRUPT",
    );
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: fixture.enrollment.id } }), 0);
  });
  await check("zero reward completes without an XPTransaction (platform rule)", async () => {
    // Operator platform decision (2026-07-25): a level with xpReward === 0 completes
    // server-side without creating an XPTransaction. Negative rewards remain invalid.
    const fixture = await setup({ levels: [{ xpReward: 0 }, {}] });
    const result = await run(fixture);
    assert.equal(result.kind, "completed");
    assert.equal((result as { xpAwarded: number }).xpAwarded, 0);
    assert.equal((result as { xpTransactionId: number | null }).xpTransactionId, null);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: fixture.enrollment.id } }), 0);
  });
  await check("negative reward is corrupt", async () => {
    const fixture = await setup({ levels: [{ xpReward: -1 }, {}] });
    expectResult(await run(fixture), "corrupt", "COMPLETION_REWARD_INVALID");
  });

  // Success (23-39)
  const ordinary = await setup({ attemptCount: 3, levels: [{ xpReward: 41 }, {}] });
  const v1Before = {
    xp: await prisma.xpEvent.count(),
    progress: await prisma.userTaskProgress.count(),
    notifications: await prisma.notification.count(),
    crm: await prisma.crmUserCohort.count(),
  };
  const ordinaryResult = await run(ordinary);
  await check("valid ordinary completion", () => {
    assert.equal(ordinaryResult.kind, "completed");
    assert.equal(ordinaryResult.created, true);
  });
  await check("valid assessment completion", async () => {
    const fixture = await setup({
      levels: [{ type: "final_exam", completionMethod: "assessment_pass" }, {}],
    });
    const result = await run(fixture, { sourceType: "assessment_pass", sourceId: "assessment-1" });
    assert.equal(result.kind, "completed");
  });
  await check("report approval without durable approved review evidence is rejected", async () => {
    const fixture = await setup({
      progressStatus: "pending_review",
      levels: [{ type: "report", completionMethod: "report_approval" }, {}],
    });
    const result = await run(fixture, { sourceType: "report_approval", sourceId: "report-1" });
    expectResult(result, "rejected", "COMPLETION_OWNER_MISMATCH");
  });
  await check("valid mentor completion", async () => {
    const fixture = await setup({
      progressStatus: "pending_review",
      levels: [{ type: "mentor_review", completionMethod: "mentor_review" }, {}],
    });
    const result = await run(fixture, { sourceType: "mentor_completion", sourceId: "mentor-1" });
    assert.equal(result.kind, "completed");
  });

  await reset();
  const ordinary2 = await setup({ attemptCount: 3, levels: [{ xpReward: 41 }, {}] });
  const ordinary2Result = await run(ordinary2);
  const ordinaryXp = await prisma.xPTransaction.findFirstOrThrow();
  const ordinaryProgress = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: ordinary2.levelProgress.id } });
  const ordinaryEnrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: ordinary2.enrollment.id } });
  const ordinaryAudits = await prisma.auditLog.findMany({ orderBy: { id: "asc" } });
  await check("XP amount is derived from immutable definition", () => {
    assert.equal(ordinary2Result.kind, "completed");
    assert.equal(ordinaryXp.amount, 41);
    assert.equal(ordinary2Result.xpAwarded, 41);
  });
  await check("completion creates one XP row", async () => {
    assert.equal(await prisma.xPTransaction.count(), 1);
  });
  await check("XP audit is written", () => {
    assert.equal(ordinaryAudits.filter((row) => row.action === "CURRICULUM_XP_AWARDED").length, 1);
  });
  await check("completion audit is written", () => {
    assert.equal(ordinaryAudits.filter((row) => row.action === "CURRICULUM_LEVEL_COMPLETED").length, 1);
  });
  await check("progress becomes completed", () => {
    assert.equal(ordinaryProgress.status, "completed");
  });
  await check("progress timestamps equal evaluationTime", () => {
    assert.equal(ordinaryProgress.completedAt?.toISOString(), EVALUATION_TIME.toISOString());
    assert.equal(ordinaryProgress.lastProgressAt?.toISOString(), EVALUATION_TIME.toISOString());
  });
  await check("enrollment summary advances once", () => {
    assert.equal(ordinaryEnrollment.highestCompletedLevel, 1);
    assert.equal(ordinaryEnrollment.currentLevel, 2);
  });
  await check("lastMeaningfulActionAt equals evaluationTime", () => {
    assert.equal(ordinaryEnrollment.lastMeaningfulActionAt?.toISOString(), EVALUATION_TIME.toISOString());
  });
  await check("next progress is not materialized", async () => {
    assert.equal(await prisma.userLevelProgress.count(), 1);
  });
  await check("attemptCount is unchanged", () => {
    assert.equal(ordinaryProgress.attemptCount, 3);
  });
  await check("V1 XP and progress are untouched", async () => {
    assert.equal(await prisma.xpEvent.count(), v1Before.xp);
    assert.equal(await prisma.userTaskProgress.count(), v1Before.progress);
  });
  await check("notifications and CRM are untouched", async () => {
    assert.equal(await prisma.notification.count(), v1Before.notifications);
    assert.equal(await prisma.crmUserCohort.count(), v1Before.crm);
  });
  await check("archived pin is not rebound", async () => {
    const fixture = await setup({ graphStatus: "archived" });
    const pinnedId = fixture.enrollment.curriculumVersionId;
    await run(fixture);
    const stored = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: fixture.enrollment.id } });
    assert.equal(stored.curriculumVersionId, pinnedId);
    assert.equal((await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: pinnedId } })).status, "archived");
  });

  // Final level (40-44)
  const finalFixture = await setup({ levels: [{}] });
  const finalResult = await run(finalFixture);
  const finalEnrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: finalFixture.enrollment.id } });
  await check("final level completes enrollment", () => {
    assert.equal(finalEnrollment.status, "completed");
  });
  await check("final enrollment stores completedAt", () => {
    assert.equal(finalEnrollment.completedAt?.toISOString(), EVALUATION_TIME.toISOString());
  });
  await check("terminal summary uses max plus one currentLevel", () => {
    assert.equal(finalEnrollment.highestCompletedLevel, 1);
    assert.equal(finalEnrollment.currentLevel, 2);
    assert.equal(finalResult.kind === "completed" && finalResult.terminal, true);
  });
  await check("terminal retry is idempotent", async () => {
    const retry = await run(finalFixture);
    assert.equal(retry.kind, "completed");
    assert.equal(retry.created, false);
  });
  await check("terminal completion creates no re-enrollment", async () => {
    assert.equal(await prisma.userCurriculumEnrollment.count(), 1);
  });

  // Idempotency (45-53)
  const retryFixture = await setup({ levels: [{ xpReward: 37 }, {}] });
  const firstRetryResult = await run(retryFixture);
  const firstStoredProgress = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: retryFixture.levelProgress.id } });
  const firstStoredEnrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: retryFixture.enrollment.id } });
  const beforeRetry = {
    xp: await prisma.xPTransaction.count(),
    audits: await prisma.auditLog.count(),
  };
  const exactRetry = await run(retryFixture);
  const afterRetryProgress = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: retryFixture.levelProgress.id } });
  const afterRetryEnrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: retryFixture.enrollment.id } });
  await check("exact retry returns created=false", () => {
    assert.equal(firstRetryResult.kind, "completed");
    assert.equal(exactRetry.kind, "completed");
    assert.equal(exactRetry.created, false);
  });
  await check("retry does not duplicate XP", async () => {
    assert.equal(await prisma.xPTransaction.count(), beforeRetry.xp);
  });
  await check("retry does not duplicate audits", async () => {
    assert.equal(await prisma.auditLog.count(), beforeRetry.audits);
  });
  await check("retry does not touch timestamps", () => {
    assert.equal(afterRetryProgress.updatedAt.toISOString(), firstStoredProgress.updatedAt.toISOString());
    assert.equal(afterRetryEnrollment.updatedAt.toISOString(), firstStoredEnrollment.updatedAt.toISOString());
  });
  await check("retry does not advance currentLevel again", () => {
    assert.equal(afterRetryEnrollment.currentLevel, 2);
  });
  await check("different payload conflicts", async () => {
    const otherActor = await createUser("other-actor");
    expectResult(
      await run(retryFixture, { actorId: otherActor.id }),
      "conflict",
      "COMPLETION_IDEMPOTENCY_CONFLICT",
    );
  });
  await check("different source identity conflicts", async () => {
    expectResult(
      await run(retryFixture, { sourceId: "different-owner-identity" }),
      "conflict",
      "COMPLETION_CONFLICT",
    );
  });
  await check("completed progress without XP is corrupt", async () => {
    const fixture = await setup();
    await prisma.userLevelProgress.update({
      where: { id: fixture.levelProgress.id },
      data: { status: "completed", completedAt: EVALUATION_TIME },
    });
    await prisma.userCurriculumEnrollment.update({
      where: { id: fixture.enrollment.id },
      data: { currentLevel: 2, highestCompletedLevel: 1, lastMeaningfulActionAt: EVALUATION_TIME },
    });
    expectResult(await run(fixture), "corrupt", "COMPLETION_STATE_CORRUPT");
  });
  await check("XP without completed progress is corrupt", async () => {
    const fixture = await setup();
    await xp.recordCurriculumXp({
      db: prisma,
      enrollmentId: fixture.enrollment.id,
      levelDefinitionId: fixture.graph.levels[0].id,
      sourceType: "level_completion",
      sourceId: `lesson-owner-${fixture.enrollment.id}`,
      amount: fixture.graph.levels[0].xpReward,
      actorId: fixture.user.id,
    });
    expectResult(await run(fixture), "corrupt", "COMPLETION_STATE_CORRUPT");
  });

  // Rollback (54-59)
  await check("XP audit failure rolls back", async () => {
    const fixture = await setup();
    await withTrigger(
      "fail_xp_audit",
      `CREATE TRIGGER fail_xp_audit BEFORE INSERT ON "AuditLog" WHEN NEW."action"='CURRICULUM_XP_AWARDED' BEGIN SELECT RAISE(ABORT, 'xp-audit-failure'); END`,
      async () => {
        expectResult(await run(fixture), "corrupt", "COMPLETION_INTERNAL_ERROR");
      },
    );
    await assertRolledBack(fixture);
  });
  await check("completion audit failure rolls back", async () => {
    const fixture = await setup();
    await withTrigger(
      "fail_completion_audit",
      `CREATE TRIGGER fail_completion_audit BEFORE INSERT ON "AuditLog" WHEN NEW."action"='CURRICULUM_LEVEL_COMPLETED' BEGIN SELECT RAISE(ABORT, 'completion-audit-failure'); END`,
      async () => {
        await assert.rejects(() => run(fixture));
      },
    );
    await assertRolledBack(fixture);
  });
  await check("progress update failure rolls back", async () => {
    const fixture = await setup();
    await withTrigger(
      "fail_progress_update",
      `CREATE TRIGGER fail_progress_update BEFORE UPDATE ON "UserLevelProgress" BEGIN SELECT RAISE(ABORT, 'progress-update-failure'); END`,
      async () => {
        await assert.rejects(() => run(fixture));
      },
    );
    await assertRolledBack(fixture);
  });
  await check("enrollment update failure rolls back", async () => {
    const fixture = await setup();
    await withTrigger(
      "fail_enrollment_update",
      `CREATE TRIGGER fail_enrollment_update BEFORE UPDATE ON "UserCurriculumEnrollment" BEGIN SELECT RAISE(ABORT, 'enrollment-update-failure'); END`,
      async () => {
        await assert.rejects(() => run(fixture));
      },
    );
    await assertRolledBack(fixture);
  });
  await check("outer owner transaction failure rolls back", async () => {
    const fixture = await setup();
    await assert.rejects(() =>
      prisma.$transaction(async (tx) => {
        await completion.completeCurriculumLevelInTransaction(tx, {
          enrollmentId: fixture.enrollment.id,
          levelDefinitionId: fixture.graph.levels[0].id,
          sourceType: "level_completion",
          sourceId: `lesson-owner-${fixture.enrollment.id}`,
          actorId: fixture.user.id,
          evaluationTime: EVALUATION_TIME,
        });
        throw new Error("outer-owner-failure");
      }),
    );
    await assertRolledBack(fixture);
  });
  await check("all injected failures prove full rollback", () => {
    assert.equal(rollbackProofs.length, 5);
    assert.equal(rollbackProofs.every(Boolean), true);
  });

  // Concurrency (60-66)
  const concurrent = await setup();
  const parallelResults = await Promise.all([run(concurrent), run(concurrent)]);
  await check("controlled parallel completion resolves both calls", () => {
    assert.equal(parallelResults.every((result) => result.kind === "completed"), true);
  });
  await check("parallel completion has one winner", () => {
    assert.equal(parallelResults.filter((result) => result.kind === "completed" && result.created).length, 1);
  });
  await check("parallel loser recovers exact retry", () => {
    assert.equal(parallelResults.filter((result) => result.kind === "completed" && !result.created).length, 1);
  });
  await check("parallel completion creates one XP row", async () => {
    assert.equal(await prisma.xPTransaction.count(), 1);
  });
  await check("parallel completion creates exactly two audit actions", async () => {
    const actions = await prisma.auditLog.findMany({ select: { action: true } });
    assert.deepEqual(
      actions.map((row) => row.action).sort(),
      ["CURRICULUM_LEVEL_COMPLETED", "CURRICULUM_XP_AWARDED"],
    );
  });
  await check("parallel completion advances summary once", async () => {
    const stored = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: concurrent.enrollment.id } });
    assert.equal(stored.currentLevel, 2);
    assert.equal(stored.highestCompletedLevel, 1);
  });
  await check("unknown database error is not masked as recovery", async () => {
    const fixture = await setup();
    await withTrigger(
      "fail_unknown_update",
      `CREATE TRIGGER fail_unknown_update BEFORE UPDATE ON "UserLevelProgress" BEGIN SELECT RAISE(ABORT, 'unknown-db-marker'); END`,
      async () => {
        await assert.rejects(
          () => run(fixture),
          (error: unknown) => {
            assert.equal(completion.isCurriculumLevelCompletionError(error), false);
            return true;
          },
        );
      },
    );
  });

  // Post-state (67-72)
  const postState = await setup({ levels: [{ xpReward: 50 }, {}, {}] });
  await run(postState);
  const postResolved = await levelState.resolveUserCurriculumLevelStates({
    userId: postState.user.id,
    db: prisma,
  });
  assert.equal(postResolved.kind, "resolved");
  const resolvedLevels = postResolved.kind === "resolved" ? postResolved.levels : [];
  await check("completed level resolves as completed", () => {
    assert.equal(resolvedLevels[0].state, "completed");
  });
  await check("next level resolves available when gates pass", () => {
    assert.equal(resolvedLevels[1].state, "available");
  });
  await check("future sequence level resolves xp_eligible", () => {
    assert.equal(resolvedLevels[2].state, "xp_eligible");
  });
  await check("checkpoint remains a blocker", async () => {
    const fixture = await setup({
      levels: [{}, { requiredCheckpointLevel: 1 }, {}],
    });
    await run(fixture);
    const state = await levelState.resolveUserCurriculumLevelStates({ userId: fixture.user.id, db: prisma });
    assert.equal(state.kind, "resolved");
    if (state.kind === "resolved") {
      assert.equal(state.levels[1].state, "locked");
      assert.equal(state.levels[1].blockers.includes("checkpoint_engine_unavailable"), true);
    }
  });
  await check("at most one level is available", () => {
    assert.equal(resolvedLevels.filter((level) => level.state === "available").length, 1);
  });
  await check("final curriculum resolver returns completed", async () => {
    const fixture = await setup({ levels: [{}] });
    await run(fixture);
    const resolved = await resolver.resolveUserCurriculumContext({
      userId: fixture.user.id,
      db: prisma,
    });
    assert.equal(resolved.kind, "completed");
  });

  // Security (73-76)
  await check("generic HTTP completion route is absent", () => {
    for (const candidate of [
      "src/app/api/curriculum/v2/complete/route.ts",
      "src/app/api/curriculum/v2/levels/complete/route.ts",
      "src/app/api/curriculum/v2/level-completion/route.ts",
    ]) {
      assert.equal(fs.existsSync(candidate), false, candidate);
    }
  });
  await check("caller cannot define XP amount, user or version", () => {
    const source = fs.readFileSync("src/lib/curriculum/completion.ts", "utf8");
    const inputBlock = source.match(/export type CompleteCurriculumLevelInput = \{([\s\S]*?)\n\};/);
    assert.ok(inputBlock);
    for (const forbidden of ["userId", "curriculumVersionId", "levelNumber", "amount", "xpReward", "idempotencyKey", "payloadFingerprint"]) {
      assert.equal(inputBlock[1].includes(forbidden), false, forbidden);
    }
  });
  await check("completionEvidence and raw owner payload are not stored", async () => {
    const fixture = await setup();
    await run(fixture, { rawPayload: { secret: "must-not-persist" }, completionEvidence: { answer: "x" } });
    const stored = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: fixture.levelProgress.id } });
    assert.equal(stored.completionEvidence, null);
    const serializedAudits = JSON.stringify(await prisma.auditLog.findMany());
    assert.equal(serializedAudits.includes("must-not-persist"), false);
    assert.equal(serializedAudits.includes("answer"), false);
  });
  await check("public failure results are sanitized", async () => {
    await reset();
    const result = await completion.completeCurriculumLevel({
      db: prisma,
      enrollmentId: 999999,
      levelDefinitionId: 999999,
      sourceType: "level_completion",
      sourceId: "sanitized-error",
    });
    assert.deepEqual(result, {
      kind: "rejected",
      code: "COMPLETION_ENROLLMENT_NOT_FOUND",
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("/home/"), false);
    assert.equal(serialized.includes("DATABASE_URL"), false);
    assert.equal(serialized.includes("sanitized-error"), false);
  });

  await prisma.$disconnect();
  // 77 before L4VC-1; +2 for the checkpoint owner split (unmapped type still
  // unowned, and the checkpoint owner refused without a verification proof).
  // PHASE-1 ADMIN: -1 (`admin_correction cannot complete a level` is obsolete —
  // it IS an owner now) +3 (refused without provenance, completes an owned pair
  // with it, and still cannot reach a protected gate) = 81.
  assert.equal(passed + failed, 81, "regression scenario count changed");
}

main()
  .then(() => {
    console.log(`\ncurriculum level completion regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    console.log(`\ncurriculum level completion regression: ${passed} passed, ${failed + 1} failed`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    cleanupDb();
  });
