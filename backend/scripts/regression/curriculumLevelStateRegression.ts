import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type {
  CurriculumVersion,
  LevelDefinition,
  Prisma,
  UserCurriculumEnrollment,
} from "@prisma/client";
import type { LevelStartCommandDb } from "../../src/lib/curriculum/level-state";

// Phase 2B.4 regression: read-only effective Level State plus transactional lazy start.
// Uses only a throwaway SQLite database in /tmp and starts no HTTP server.

const dbPath = `/tmp/ata-curriculum-level-state-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
process.env.DATABASE_URL = dbUrl;

const AS_OF = new Date("2026-07-14T17:00:00.000Z");
const originalFlags = {
  admin: process.env.CURRICULUM_V2_ADMIN_ENABLED,
  read: process.env.CURRICULUM_V2_READ_ENABLED,
  enrollment: process.env.CURRICULUM_V2_ENROLLMENT_ENABLED,
};

let passed = 0;
let failed = 0;
let userSequence = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.stack ?? error.message : error);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function restoreFlag(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function setFlags(input: { read?: boolean; enrollment?: boolean; admin?: boolean }) {
  if (input.read === undefined) delete process.env.CURRICULUM_V2_READ_ENABLED;
  else process.env.CURRICULUM_V2_READ_ENABLED = String(input.read);
  if (input.enrollment === undefined) delete process.env.CURRICULUM_V2_ENROLLMENT_ENABLED;
  else process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = String(input.enrollment);
  if (input.admin === undefined) delete process.env.CURRICULUM_V2_ADMIN_ENABLED;
  else process.env.CURRICULUM_V2_ADMIN_ENABLED = String(input.admin);
}

async function main() {
  cleanupDb();
  const runner = spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  if (runner.status !== 0) {
    console.error(runner.stdout);
    console.error(runner.stderr);
    throw new Error(`migration runner exited with ${runner.status}`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const levelState = await import("../../src/lib/curriculum/level-state");

  async function resetFixtures() {
    // POCKET-REG-INGRESS-1: migration 47 gave completions a Growth ledger
    // projection whose enrollment/level/user relations are Restrict, so the
    // ledger rows a scenario produced must go before the rows they reference —
    // this cleanup predates the ledger and had been failing since it landed.
    await prisma.growthEventOutbox.deleteMany();
    await prisma.growthEvent.deleteMany();
    await prisma.userLevelProgress.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.user.deleteMany();
  }

  async function createUser(label: string, status: "active" | "blocked" = "active") {
    userSequence += 1;
    return prisma.user.create({
      data: {
        email: `${label}-${process.pid}-${userSequence}@example.com`,
        name: label,
        status,
      },
    });
  }

  async function createGraph(input: {
    status?: "draft" | "published" | "archived";
    versionNumber?: number;
    levelCount?: number;
    requiredXp?: Record<number, number>;
    checkpoints?: number[];
    visibility?: number[];
    moduleStatus?: "active" | "disabled";
    levelStatus?: Record<number, "active" | "disabled">;
    reverseLevels?: boolean;
  } = {}) {
    const status = input.status ?? "published";
    const levelCount = input.levelCount ?? 3;
    const version = await prisma.curriculumVersion.create({
      data: {
        code: "ata-v2",
        name: `ata-v2 v${input.versionNumber ?? 1}`,
        versionNumber: input.versionNumber ?? 1,
        status,
        publishedAt: status === "published" ? AS_OF : null,
      },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 1,
        code: "m01",
        title: "Module 1",
        firstLevel: 1,
        lastLevel: levelCount,
        status: input.moduleStatus ?? "active",
      },
    });
    const numbers = Array.from({ length: levelCount }, (_, index) => index + 1);
    if (input.reverseLevels) numbers.reverse();
    const levels: LevelDefinition[] = [];
    for (const levelNumber of numbers) {
      levels.push(
        await prisma.levelDefinition.create({
          data: {
            curriculumVersionId: version.id,
            moduleId: moduleDefinition.id,
            levelNumber,
            stableCode: `v2.l${String(levelNumber).padStart(3, "0")}.state-${version.id}`,
            type: "lesson",
            title: `Level ${levelNumber}`,
            completionMethod: "lesson",
            requiredXp: input.requiredXp?.[levelNumber] ?? 0,
            requiredPreviousLevel: levelNumber === 1 ? null : levelNumber - 1,
            requiredCheckpointLevel: input.checkpoints?.includes(levelNumber)
              ? Math.max(1, levelNumber - 1)
              : null,
            visibilityRule: input.visibility?.includes(levelNumber)
              ? { unsupported: true }
              : undefined,
            status: input.levelStatus?.[levelNumber] ?? "active",
          },
        }),
      );
    }
    levels.sort((left, right) => left.levelNumber - right.levelNumber);
    return { version, module: moduleDefinition, levels };
  }

  async function createEnrollment(input: {
    userId: number;
    version: CurriculumVersion;
    status?: "active" | "completed" | "superseded";
    currentLevel?: number;
    highestCompletedLevel?: number;
  }) {
    const status = input.status ?? "active";
    return prisma.userCurriculumEnrollment.create({
      data: {
        userId: input.userId,
        curriculumVersionId: input.version.id,
        curriculumCode: input.version.code,
        status,
        enrolledAt: AS_OF,
        currentLevel: input.currentLevel ?? 1,
        highestCompletedLevel: input.highestCompletedLevel ?? 0,
        completedAt: status === "completed" ? AS_OF : null,
      },
    });
  }

  async function createProgress(input: {
    enrollment: UserCurriculumEnrollment;
    level: LevelDefinition;
    status: "in_progress" | "pending_review" | "completed";
    completedAt?: Date | null;
  }) {
    return prisma.userLevelProgress.create({
      data: {
        enrollmentId: input.enrollment.id,
        curriculumVersionId: input.enrollment.curriculumVersionId,
        levelDefinitionId: input.level.id,
        status: input.status,
        startedAt: AS_OF,
        lastProgressAt: AS_OF,
        completedAt:
          input.completedAt === undefined
            ? input.status === "completed"
              ? AS_OF
              : null
            : input.completedAt,
      },
    });
  }

  function findLevel(
    result: Extract<Awaited<ReturnType<typeof levelState.resolveUserCurriculumLevelStates>>, { kind: "resolved" }>,
    levelNumber: number,
  ) {
    const item = result.levels.find(
      (level) => level.levelDefinition.levelNumber === levelNumber,
    );
    assert.ok(item, `missing effective level ${levelNumber}`);
    return item;
  }

  async function expectStartError(
    code: string,
    fn: () => Promise<unknown>,
  ) {
    await assert.rejects(fn, (error: unknown) => {
      assert.equal(levelState.isLevelStartDomainError(error), true);
      assert.equal((error as { code: string }).code, code);
      return true;
    });
  }

  function minimalTx(
    client: Prisma.TransactionClient,
    overrides: Partial<{
      userLevelProgress: unknown;
      auditLog: unknown;
    }> = {},
  ) {
    return {
      user: client.user,
      curriculumVersion: client.curriculumVersion,
      userCurriculumEnrollment: client.userCurriculumEnrollment,
      userLevelProgress: overrides.userLevelProgress ?? client.userLevelProgress,
      auditLog: overrides.auditLog ?? client.auditLog,
    } as unknown as Prisma.TransactionClient;
  }

  try {
    await check("1. READ flag off returns disabled without querying", async () => {
      setFlags({ read: false });
      const queryGuard = new Proxy(
        {},
        { get: () => { throw new Error("disabled level resolver touched DB"); } },
      ) as unknown as Prisma.TransactionClient;
      assert.deepEqual(
        await levelState.resolveUserCurriculumLevelStates({ userId: 1, db: queryGuard }),
        { kind: "disabled" },
      );
    });

    await check("2. enrollment flag does not enable read resolver", async () => {
      setFlags({ read: false, enrollment: true });
      assert.equal(
        (await levelState.resolveUserCurriculumLevelStates({ userId: 1 })).kind,
        "disabled",
      );
    });

    await check("3. read resolver works while enrollment mutation is disabled", async () => {
      await resetFixtures();
      setFlags({ read: true, enrollment: false });
      const user = await createUser("reader");
      const graph = await createGraph();
      await createEnrollment({ userId: user.id, version: graph.version });
      assert.equal(
        (await levelState.resolveUserCurriculumLevelStates({ userId: user.id })).kind,
        "resolved",
      );
    });

    await check("4. start requires both READ and ENROLLMENT flags", async () => {
      setFlags({ read: false, enrollment: true });
      await expectStartError("CURRICULUM_READ_DISABLED", () =>
        levelState.startCurrentCurriculumLevel({ actorUserId: 1 }),
      );
      setFlags({ read: true, enrollment: false });
      await expectStartError("LEVEL_START_DISABLED", () =>
        levelState.startCurrentCurriculumLevel({ actorUserId: 1 }),
      );
    });

    await check("5. read resolver reports user_not_found", async () => {
      setFlags({ read: true, enrollment: true });
      assert.deepEqual(
        await levelState.resolveUserCurriculumLevelStates({ userId: 999_999 }),
        { kind: "user_not_found" },
      );
    });

    await check("6. start reports missing user", async () => {
      await expectStartError("LEVEL_START_USER_NOT_FOUND", () =>
        levelState.startCurrentCurriculumLevel({ actorUserId: 999_999 }),
      );
    });

    await check("7. start rejects inactive user", async () => {
      await resetFixtures();
      const user = await createUser("blocked", "blocked");
      await expectStartError("LEVEL_START_USER_INACTIVE", () =>
        levelState.startCurrentCurriculumLevel({ actorUserId: user.id }),
      );
      assert.equal(await prisma.userLevelProgress.count(), 0);
    });

    await check("8. no active enrollment is unavailable", async () => {
      await resetFixtures();
      const user = await createUser("unenrolled");
      await createGraph();
      const result = await levelState.resolveUserCurriculumLevelStates({
        userId: user.id,
        asOf: AS_OF,
      });
      assert.deepEqual(result, { kind: "unavailable", reason: "no_active_enrollment" });
      await expectStartError("LEVEL_START_NO_ACTIVE_ENROLLMENT", () =>
        levelState.startCurrentCurriculumLevel({ actorUserId: user.id }),
      );
    });

    await check("9. completed enrollment cannot resolve or start active levels", async () => {
      await resetFixtures();
      const user = await createUser("completed");
      const graph = await createGraph();
      await createEnrollment({ userId: user.id, version: graph.version, status: "completed" });
      assert.deepEqual(
        await levelState.resolveUserCurriculumLevelStates({ userId: user.id }),
        { kind: "unavailable", reason: "enrollment_completed" },
      );
      await expectStartError("LEVEL_START_ENROLLMENT_COMPLETED", () =>
        levelState.startCurrentCurriculumLevel({ actorUserId: user.id }),
      );
    });

    await check("10. valid published pin resolves", async () => {
      await resetFixtures();
      const user = await createUser("published");
      const graph = await createGraph();
      await createEnrollment({ userId: user.id, version: graph.version });
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: user.id });
      assert.equal(result.kind, "resolved");
      if (result.kind === "resolved") assert.equal(result.curriculumVersion.id, graph.version.id);
    });

    await check("11. archived historical pin resolves", async () => {
      const enrollment = await prisma.userCurriculumEnrollment.findFirstOrThrow();
      await prisma.curriculumVersion.update({
        where: { id: enrollment.curriculumVersionId },
        data: { status: "archived" },
      });
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: enrollment.userId });
      assert.equal(result.kind, "resolved");
    });

    await check("12. newer published version never replaces archived pin", async () => {
      const enrollment = await prisma.userCurriculumEnrollment.findFirstOrThrow();
      await createGraph({ versionNumber: 2 });
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: enrollment.userId });
      assert.equal(result.kind, "resolved");
      if (result.kind === "resolved") {
        assert.equal(result.curriculumVersion.id, enrollment.curriculumVersionId);
      }
    });

    await check("13. draft pin is corrupt", async () => {
      await resetFixtures();
      const user = await createUser("draft");
      const graph = await createGraph({ status: "draft" });
      await createEnrollment({ userId: user.id, version: graph.version });
      assert.equal(
        (await levelState.resolveUserCurriculumLevelStates({ userId: user.id })).kind,
        "corrupt",
      );
    });

    await check("14. cross-code pin is reported as corrupt by injected snapshot", async () => {
      await resetFixtures();
      const user = await createUser("cross-code");
      const graph = await createGraph();
      await createEnrollment({ userId: user.id, version: graph.version });
      const snapshot = await prisma.userCurriculumEnrollment.findFirstOrThrow({
        include: {
          curriculumVersion: { include: { modules: true, levels: true } },
          levelProgress: { include: { levelDefinition: true } },
        },
      });
      const fakeDb = {
        user: { findUnique: async () => ({ id: user.id }) },
        userCurriculumEnrollment: {
          findMany: async () => [{ ...snapshot, curriculumCode: "other-v2" }],
        },
      } as unknown as Prisma.TransactionClient;
      const result = await levelState.resolveUserCurriculumLevelStates({
        userId: user.id,
        db: fakeDb,
      });
      assert.equal(result.kind, "corrupt");
      if (result.kind === "corrupt") assert.equal(result.reason, "code_mismatch");
    });

    await check("15. modules and levels are sorted deterministically", async () => {
      await resetFixtures();
      const user = await createUser("sorting");
      const graph = await createGraph({ levelCount: 3, reverseLevels: true });
      await createEnrollment({ userId: user.id, version: graph.version });
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: user.id });
      assert.equal(result.kind, "resolved");
      if (result.kind === "resolved") {
        assert.deepEqual(
          result.levels.map((item) => item.levelDefinition.levelNumber),
          [1, 2, 3],
        );
        assert.deepEqual(result.modules.map((item) => item.moduleNumber), [1]);
      }
    });

    await check("16. first zero-gate level is available", async () => {
      const user = await prisma.user.findFirstOrThrow();
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: user.id });
      assert.equal(result.kind, "resolved");
      if (result.kind === "resolved") assert.equal(findLevel(result, 1).state, "available");
    });

    await check("17. at most one level is available and future levels are locked", async () => {
      const user = await prisma.user.findFirstOrThrow();
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: user.id });
      assert.equal(result.kind, "resolved");
      if (result.kind === "resolved") {
        assert.equal(result.levels.filter((item) => item.state === "available").length, 1);
        assert.equal(findLevel(result, 2).state, "locked");
        assert.ok(findLevel(result, 2).blockers.includes("not_current_level"));
      }
    });

    await check("18. missing previous completion produces sequence blocker", async () => {
      await resetFixtures();
      const user = await createUser("sequence");
      const graph = await createGraph();
      await createEnrollment({ userId: user.id, version: graph.version, currentLevel: 2 });
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: user.id });
      assert.equal(result.kind, "resolved");
      if (result.kind === "resolved") {
        const current = findLevel(result, 2);
        assert.equal(current.state, "locked");
        assert.ok(current.blockers.includes("sequence_incomplete"));
      }
    });

    await check("19. requiredXp=0 does not block the current level", async () => {
      await resetFixtures();
      const user = await createUser("xp-zero");
      const graph = await createGraph({ levelCount: 1, requiredXp: { 1: 0 } });
      await createEnrollment({ userId: user.id, version: graph.version });
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: user.id });
      assert.equal(result.kind, "resolved");
      if (result.kind === "resolved") assert.equal(findLevel(result, 1).state, "available");
    });

    await check("20. requiredXp>0 fails closed without reading legacy XP", async () => {
      await resetFixtures();
      const user = await createUser("xp-gated");
      await prisma.user.update({ where: { id: user.id }, data: { xp: 999_999 } });
      const graph = await createGraph({ levelCount: 1, requiredXp: { 1: 10 } });
      await createEnrollment({ userId: user.id, version: graph.version });
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: user.id });
      assert.equal(result.kind, "resolved");
      if (result.kind === "resolved") {
        const current = findLevel(result, 1);
        assert.equal(current.state, "locked");
        assert.ok(current.blockers.includes("xp_engine_unavailable"));
      }
    });

    await check("21. checkpoint dependency fails closed", async () => {
      await resetFixtures();
      const user = await createUser("checkpoint");
      const graph = await createGraph({ levelCount: 1, checkpoints: [1] });
      await createEnrollment({ userId: user.id, version: graph.version });
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: user.id });
      assert.equal(result.kind, "resolved");
      if (result.kind === "resolved") {
        assert.ok(findLevel(result, 1).blockers.includes("checkpoint_engine_unavailable"));
      }
    });

    await check("22. unsupported visibility rule fails closed without hidden state", async () => {
      await resetFixtures();
      const user = await createUser("visibility");
      const graph = await createGraph({ levelCount: 1, visibility: [1] });
      await createEnrollment({ userId: user.id, version: graph.version });
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: user.id });
      assert.equal(result.kind, "resolved");
      if (result.kind === "resolved") {
        const current = findLevel(result, 1);
        assert.equal(current.state, "locked");
        assert.ok(current.blockers.includes("visibility_rule_unsupported"));
      }
    });

    await check("23. persisted in_progress is represented exactly", async () => {
      await resetFixtures();
      const user = await createUser("in-progress");
      const graph = await createGraph();
      const enrollment = await createEnrollment({ userId: user.id, version: graph.version });
      await createProgress({ enrollment, level: graph.levels[0], status: "in_progress" });
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: user.id });
      assert.equal(result.kind, "resolved");
      if (result.kind === "resolved") assert.equal(findLevel(result, 1).state, "in_progress");
    });

    await check("24. persisted pending_review is represented exactly", async () => {
      await prisma.userLevelProgress.updateMany({ data: { status: "pending_review" } });
      const user = await prisma.user.findFirstOrThrow();
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: user.id });
      assert.equal(result.kind, "resolved");
      if (result.kind === "resolved") assert.equal(findLevel(result, 1).state, "pending_review");
    });

    await check("25. persisted completed is represented exactly", async () => {
      await resetFixtures();
      const user = await createUser("completed-level");
      const graph = await createGraph();
      const enrollment = await createEnrollment({
        userId: user.id,
        version: graph.version,
        currentLevel: 2,
        highestCompletedLevel: 1,
      });
      await createProgress({ enrollment, level: graph.levels[0], status: "completed" });
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: user.id });
      assert.equal(result.kind, "resolved");
      if (result.kind === "resolved") {
        assert.equal(findLevel(result, 1).state, "completed");
        assert.equal(findLevel(result, 2).state, "available");
      }
    });

    await check("26. summary/progress contradiction is corrupt", async () => {
      await prisma.userCurriculumEnrollment.updateMany({
        data: { currentLevel: 1, highestCompletedLevel: 1 },
      });
      const user = await prisma.user.findFirstOrThrow();
      const result = await levelState.resolveUserCurriculumLevelStates({ userId: user.id });
      assert.equal(result.kind, "corrupt");
    });

    await check("27. invalid progress timestamps are corrupt", async () => {
      await resetFixtures();
      const user = await createUser("bad-progress-time");
      const graph = await createGraph();
      const enrollment = await createEnrollment({ userId: user.id, version: graph.version });
      await createProgress({
        enrollment,
        level: graph.levels[0],
        status: "completed",
        completedAt: null,
      });
      assert.equal(
        (await levelState.resolveUserCurriculumLevelStates({ userId: user.id })).kind,
        "corrupt",
      );
    });

    await check("28. read resolver performs no writes or timestamp/audit changes", async () => {
      await resetFixtures();
      const user = await createUser("read-only");
      const graph = await createGraph();
      const enrollment = await createEnrollment({ userId: user.id, version: graph.version });
      const before = {
        updatedAt: enrollment.updatedAt.toISOString(),
        lastMeaningfulActionAt: enrollment.lastMeaningfulActionAt,
        progress: await prisma.userLevelProgress.count(),
        audit: await prisma.auditLog.count(),
      };
      await levelState.resolveUserCurriculumLevelStates({ userId: user.id });
      const fresh = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      });
      assert.deepEqual(
        {
          updatedAt: fresh.updatedAt.toISOString(),
          lastMeaningfulActionAt: fresh.lastMeaningfulActionAt,
          progress: await prisma.userLevelProgress.count(),
          audit: await prisma.auditLog.count(),
        },
        before,
      );
    });

    let started: Awaited<ReturnType<typeof levelState.startCurrentCurriculumLevel>> | null = null;
    let startUserId = 0;
    let startEnrollmentBefore: UserCurriculumEnrollment | null = null;
    await check("29. successful start creates exactly one progress row", async () => {
      await resetFixtures();
      const user = await createUser("starter");
      const graph = await createGraph();
      const enrollment = await createEnrollment({ userId: user.id, version: graph.version });
      startUserId = user.id;
      startEnrollmentBefore = enrollment;
      started = await levelState.startCurrentCurriculumLevel({
        actorUserId: user.id,
        asOf: AS_OF,
      });
      assert.equal(started.created, true);
      assert.equal(await prisma.userLevelProgress.count(), 1);
    });

    await check("30. start timestamps, ownership and attemptCount are exact", () => {
      assert.ok(started);
      assert.equal(started.progress.enrollmentId, started.enrollment.id);
      assert.equal(started.progress.curriculumVersionId, started.enrollment.curriculumVersionId);
      assert.equal(started.progress.levelDefinitionId, started.levelDefinition.id);
      assert.equal(started.progress.status, "in_progress");
      assert.equal(started.progress.startedAt.toISOString(), AS_OF.toISOString());
      assert.equal(started.progress.lastProgressAt?.toISOString(), AS_OF.toISOString());
      assert.equal(started.progress.attemptCount, 0);
    });

    await check("31. lastMeaningfulActionAt changes only on creation", () => {
      assert.ok(started);
      assert.equal(startEnrollmentBefore?.lastMeaningfulActionAt, null);
      assert.equal(started.enrollment.lastMeaningfulActionAt?.toISOString(), AS_OF.toISOString());
    });

    await check("32. start preserves summaries and pinned version", () => {
      assert.ok(started);
      assert.ok(startEnrollmentBefore);
      assert.equal(started.enrollment.currentLevel, startEnrollmentBefore.currentLevel);
      assert.equal(
        started.enrollment.highestCompletedLevel,
        startEnrollmentBefore.highestCompletedLevel,
      );
      assert.equal(
        started.enrollment.curriculumVersionId,
        startEnrollmentBefore.curriculumVersionId,
      );
      assert.equal(started.enrollment.completedAt, null);
    });

    await check("33. start audit is awaited and contains only safe identifiers", async () => {
      assert.ok(started);
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "CURRICULUM_LEVEL_STARTED" },
      });
      const metadata = audit.metadata as Record<string, unknown>;
      assert.equal(audit.userId, startUserId);
      assert.deepEqual(Object.keys(metadata).sort(), [
        "actorUserId",
        "curriculumVersionId",
        "enrollmentId",
        "levelDefinitionId",
        "levelNumber",
        "stableCode",
        "userId",
      ]);
      assert.equal(metadata.actorUserId, startUserId);
      assert.equal(metadata.enrollmentId, started.enrollment.id);
      assert.equal(metadata.levelDefinitionId, started.levelDefinition.id);
    });

    await check("34. repeated start is fully idempotent", async () => {
      assert.ok(started);
      const progressUpdatedAt = started.progress.updatedAt.toISOString();
      const enrollmentUpdatedAt = started.enrollment.updatedAt.toISOString();
      const result = await levelState.startCurrentCurriculumLevel({
        actorUserId: startUserId,
        asOf: new Date(AS_OF.getTime() + 60_000),
      });
      assert.equal(result.created, false);
      assert.equal(result.progress.id, started.progress.id);
      assert.equal(result.progress.updatedAt.toISOString(), progressUpdatedAt);
      assert.equal(result.enrollment.updatedAt.toISOString(), enrollmentUpdatedAt);
      assert.equal(result.enrollment.lastMeaningfulActionAt?.toISOString(), AS_OF.toISOString());
      assert.equal(await prisma.auditLog.count({ where: { action: "CURRICULUM_LEVEL_STARTED" } }), 1);
    });

    await check("35. controlled P2002 race returns existing progress", async () => {
      await resetFixtures();
      const user = await createUser("race");
      const graph = await createGraph();
      await createEnrollment({ userId: user.id, version: graph.version });
      let injectConflict = true;
      const raceDb = {
        async $transaction(
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) {
          const progressDelegate = injectConflict
            ? {
                create: async (
                  args: Parameters<typeof prisma.userLevelProgress.create>[0],
                ) => {
                  injectConflict = false;
                  await prisma.userLevelProgress.create(args);
                  return prisma.userLevelProgress.create(args);
                },
              }
            : prisma.userLevelProgress;
          return callback(
            minimalTx(prisma as unknown as Prisma.TransactionClient, {
              userLevelProgress: progressDelegate,
            }),
          );
        },
      } as unknown as LevelStartCommandDb;
      const result = await levelState.startCurrentCurriculumLevel({
        actorUserId: user.id,
        asOf: AS_OF,
        db: raceDb,
      });
      assert.equal(result.created, false);
      assert.equal(await prisma.userLevelProgress.count(), 1);
      assert.equal(await prisma.auditLog.count(), 0);
    });

    await check("36. audit failure rolls back progress and enrollment timestamp", async () => {
      await resetFixtures();
      const user = await createUser("audit-failure");
      const graph = await createGraph();
      const enrollment = await createEnrollment({ userId: user.id, version: graph.version });
      const auditFailure = new Error("controlled audit failure");
      const auditFailureDb = {
        async $transaction(
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) {
          return prisma.$transaction((tx) =>
            callback(
              minimalTx(tx, {
                auditLog: {
                  create: async () => { throw auditFailure; },
                },
              }),
            ),
          );
        },
      } as unknown as LevelStartCommandDb;
      await assert.rejects(
        () =>
          levelState.startCurrentCurriculumLevel({
            actorUserId: user.id,
            asOf: AS_OF,
            db: auditFailureDb,
          }),
        (error) => error === auditFailure,
      );
      const fresh = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      });
      assert.equal(await prisma.userLevelProgress.count(), 0);
      assert.equal(await prisma.auditLog.count(), 0);
      assert.equal(fresh.lastMeaningfulActionAt, null);
      assert.equal(fresh.updatedAt.toISOString(), enrollment.updatedAt.toISOString());
    });

    await check("37. start has no XP/checkpoint/report/notification side effects", async () => {
      const user = await prisma.user.findFirstOrThrow();
      const before = {
        xp: user.xp,
        xpEvents: await prisma.xpEvent.count(),
        checkpoints: await prisma.checkpoint.count(),
        reports: await prisma.taskReport.count(),
        notifications: await prisma.notification.count(),
      };
      await levelState.startCurrentCurriculumLevel({ actorUserId: user.id, asOf: AS_OF });
      const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.deepEqual(
        {
          xp: fresh.xp,
          xpEvents: await prisma.xpEvent.count(),
          checkpoints: await prisma.checkpoint.count(),
          reports: await prisma.taskReport.count(),
          notifications: await prisma.notification.count(),
        },
        before,
      );
    });

    await check("38. typed domain errors expose no raw infrastructure details", async () => {
      await resetFixtures();
      const user = await createUser("safe-error");
      let captured: unknown;
      try {
        await levelState.startCurrentCurriculumLevel({ actorUserId: user.id });
      } catch (error) {
        captured = error;
      }
      assert.equal(levelState.isLevelStartDomainError(captured), true);
      const message = (captured as Error).message;
      assert.doesNotMatch(message, /Prisma|SQL|\/tmp|password|secret|stack/i);
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
    restoreFlag("CURRICULUM_V2_ADMIN_ENABLED", originalFlags.admin);
    restoreFlag("CURRICULUM_V2_READ_ENABLED", originalFlags.read);
    restoreFlag("CURRICULUM_V2_ENROLLMENT_ENABLED", originalFlags.enrollment);
  }

  await check("39. temporary DB and journals are removed", () => {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      assert.equal(fs.existsSync(`${dbPath}${suffix}`), false, `leftover ${dbPath}${suffix}`);
    }
  });

  await check("40. regression leaves no test listener", () => {
    const listeners = spawnSync("ss", ["-ltn"], { encoding: "utf8" });
    assert.equal(listeners.status, 0, listeners.stderr);
    assert.doesNotMatch(listeners.stdout, /:39\d{2}\b/);
  });
}

main()
  .then(() => {
    console.log(`\ncurriculum level state regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    cleanupDb();
    restoreFlag("CURRICULUM_V2_ADMIN_ENABLED", originalFlags.admin);
    restoreFlag("CURRICULUM_V2_READ_ENABLED", originalFlags.read);
    restoreFlag("CURRICULUM_V2_ENROLLMENT_ENABLED", originalFlags.enrollment);
    console.error(error);
    console.log(`\ncurriculum level state regression: ${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
