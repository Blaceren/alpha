import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type {
  CurriculumVersion,
  Prisma,
  UserRole,
  UserCurriculumEnrollment,
} from "@prisma/client";
import type { EnrollmentCommandDb } from "../../src/lib/curriculum/enrollment";

// Phase 2B.3 regression: controlled, transactional, admin-only ata-v2 enrollment.
// Uses a throwaway SQLite DB in /tmp and never starts an HTTP server.

const dbPath = `/tmp/ata-curriculum-enrollment-command-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
process.env.DATABASE_URL = dbUrl;

const AS_OF = new Date("2026-07-14T15:00:00.000Z");
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

function setFlags(input: { admin?: boolean; read?: boolean; enrollment?: boolean }) {
  if (input.admin === undefined) delete process.env.CURRICULUM_V2_ADMIN_ENABLED;
  else process.env.CURRICULUM_V2_ADMIN_ENABLED = String(input.admin);
  if (input.read === undefined) delete process.env.CURRICULUM_V2_READ_ENABLED;
  else process.env.CURRICULUM_V2_READ_ENABLED = String(input.read);
  if (input.enrollment === undefined) delete process.env.CURRICULUM_V2_ENROLLMENT_ENABLED;
  else process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = String(input.enrollment);
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
  const enrollmentCommand = await import("../../src/lib/curriculum/enrollment");

  async function resetFixtures() {
    await prisma.userLevelProgress.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.userTaskProgress.deleteMany();
    await prisma.task.deleteMany();
    await prisma.level.deleteMany();
    await prisma.user.deleteMany();
  }

  async function createUser(
    label: string,
    input: { role?: UserRole; status?: "active" | "blocked" } = {},
  ) {
    userSequence += 1;
    return prisma.user.create({
      data: {
        email: `${label}-${process.pid}-${userSequence}@example.com`,
        name: label,
        role: input.role ?? "user",
        status: input.status ?? "active",
      },
    });
  }

  async function createGraph(input: {
    versionNumber?: number;
    status?: "draft" | "published" | "archived";
    publishedAt?: Date | null;
    effectiveFrom?: Date | null;
    disabled?: boolean;
  } = {}) {
    const status = input.status ?? "published";
    const version = await prisma.curriculumVersion.create({
      data: {
        code: "ata-v2",
        name: `ata-v2 v${input.versionNumber ?? 1}`,
        versionNumber: input.versionNumber ?? 1,
        status,
        publishedAt:
          input.publishedAt === undefined
            ? status === "published"
              ? AS_OF
              : null
            : input.publishedAt,
        effectiveFrom: input.effectiveFrom ?? null,
      },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 1,
        code: "m01",
        title: "Module 1",
        firstLevel: 1,
        lastLevel: 1,
        status: input.disabled ? "disabled" : "active",
      },
    });
    const level = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleId: moduleDefinition.id,
        levelNumber: 1,
        stableCode: `v2.l001.enrollment-${version.id}`,
        type: "lesson",
        title: "Level 1",
        completionMethod: "lesson",
        status: "active",
      },
    });
    return { version, module: moduleDefinition, level };
  }

  async function createEnrollment(input: {
    userId: number;
    version: CurriculumVersion;
    status?: "active" | "completed" | "superseded";
    completedAt?: Date | null;
    enrolledAt?: Date;
  }) {
    const status = input.status ?? "active";
    return prisma.userCurriculumEnrollment.create({
      data: {
        userId: input.userId,
        curriculumVersionId: input.version.id,
        curriculumCode: input.version.code,
        status,
        completedAt:
          input.completedAt === undefined
            ? status === "completed"
              ? AS_OF
              : null
            : input.completedAt,
        enrolledAt: input.enrolledAt ?? AS_OF,
      },
    });
  }

  async function expectDomain(
    code: string,
    fn: () => Promise<unknown>,
  ) {
    await assert.rejects(fn, (error: unknown) => {
      assert.equal(enrollmentCommand.isEnrollmentDomainError(error), true);
      assert.equal((error as { code: string }).code, code);
      return true;
    });
  }

  async function writeCounts() {
    return {
      enrollments: await prisma.userCurriculumEnrollment.count(),
      progress: await prisma.userLevelProgress.count(),
      audits: await prisma.auditLog.count(),
    };
  }

  function minimalTx(
    client: Prisma.TransactionClient,
    overrides: Partial<{
      userCurriculumEnrollment: unknown;
      auditLog: unknown;
    }> = {},
  ) {
    return {
      user: client.user,
      curriculumVersion: client.curriculumVersion,
      userCurriculumEnrollment:
        overrides.userCurriculumEnrollment ?? client.userCurriculumEnrollment,
      auditLog: overrides.auditLog ?? client.auditLog,
    } as unknown as Prisma.TransactionClient;
  }

  let createdResult: Awaited<
    ReturnType<typeof enrollmentCommand.enrollUserInPublishedCurriculum>
  > | null = null;
  let createdActorId = 0;
  let createdTargetId = 0;
  let createdVersionId = 0;
  let createdUpdatedAt = "";

  try {
    await check("1. both flags off -> ENROLLMENT_DISABLED and no writes", async () => {
      await resetFixtures();
      setFlags({ read: false, enrollment: false });
      const before = await writeCounts();
      await expectDomain("ENROLLMENT_DISABLED", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({ userId: 1, actorId: 1 }),
      );
      assert.deepEqual(await writeCounts(), before);
    });

    await check("2. enrollment on and READ off -> CURRICULUM_READ_DISABLED", async () => {
      setFlags({ read: false, enrollment: true });
      const before = await writeCounts();
      await expectDomain("CURRICULUM_READ_DISABLED", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({ userId: 1, actorId: 1 }),
      );
      assert.deepEqual(await writeCounts(), before);
    });

    await check("3. READ on and enrollment off -> ENROLLMENT_DISABLED", async () => {
      setFlags({ read: true, enrollment: false });
      const before = await writeCounts();
      await expectDomain("ENROLLMENT_DISABLED", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({ userId: 1, actorId: 1 }),
      );
      assert.deepEqual(await writeCounts(), before);
    });

    await check("4. admin flag does not enable enrollment", async () => {
      setFlags({ admin: true, read: false, enrollment: false });
      await expectDomain("ENROLLMENT_DISABLED", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({ userId: 1, actorId: 1 }),
      );
    });

    await check("5. missing actor is forbidden", async () => {
      await resetFixtures();
      setFlags({ read: true, enrollment: true });
      const target = await createUser("target");
      await expectDomain("ENROLLMENT_ACTOR_FORBIDDEN", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({
          userId: target.id,
          actorId: 999_999,
        }),
      );
      assert.deepEqual(await writeCounts(), { enrollments: 0, progress: 0, audits: 0 });
    });

    await check("6. non-admin actor is forbidden", async () => {
      await resetFixtures();
      const actor = await createUser("actor-user");
      const target = await createUser("target");
      await expectDomain("ENROLLMENT_ACTOR_FORBIDDEN", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({
          userId: target.id,
          actorId: actor.id,
        }),
      );
    });

    await check("7. inactive admin actor is forbidden", async () => {
      await resetFixtures();
      const actor = await createUser("actor-blocked", { role: "admin", status: "blocked" });
      const target = await createUser("target");
      await expectDomain("ENROLLMENT_ACTOR_FORBIDDEN", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({
          userId: target.id,
          actorId: actor.id,
        }),
      );
    });

    await check("8. missing target user returns not found", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      await expectDomain("ENROLLMENT_USER_NOT_FOUND", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({
          userId: 999_999,
          actorId: actor.id,
        }),
      );
    });

    await check("9. blocked target user returns inactive", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target-blocked", { status: "blocked" });
      await expectDomain("ENROLLMENT_USER_INACTIVE", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({
          userId: target.id,
          actorId: actor.id,
        }),
      );
      assert.deepEqual(await writeCounts(), { enrollments: 0, progress: 0, audits: 0 });
    });

    await check("10. missing published target returns unavailable", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target");
      await expectDomain("ENROLLMENT_TARGET_UNAVAILABLE", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({
          userId: target.id,
          actorId: actor.id,
          asOf: AS_OF,
        }),
      );
    });

    await check("11. future effectiveFrom target returns unavailable", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target");
      await createGraph({ effectiveFrom: new Date(AS_OF.getTime() + 60_000) });
      await expectDomain("ENROLLMENT_TARGET_UNAVAILABLE", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({
          userId: target.id,
          actorId: actor.id,
          asOf: AS_OF,
        }),
      );
    });

    await check("12. corrupt published target is rejected", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target");
      await createGraph({ disabled: true });
      await expectDomain("ENROLLMENT_TARGET_CORRUPT", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({
          userId: target.id,
          actorId: actor.id,
          asOf: AS_OF,
        }),
      );
    });

    await check("13. valid target creates an active enrollment", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target", { role: "mentor" });
      const graph = await createGraph();
      createdResult = await enrollmentCommand.enrollUserInPublishedCurriculum({
        userId: target.id,
        actorId: actor.id,
        asOf: AS_OF,
      });
      createdActorId = actor.id;
      createdTargetId = target.id;
      createdVersionId = graph.version.id;
      createdUpdatedAt = createdResult.enrollment.updatedAt.toISOString();
      assert.equal(createdResult.kind, "enrolled");
      assert.equal(createdResult.created, true);
      assert.equal(createdResult.enrollment.status, "active");
    });

    await check("14. initial enrollment fields are exact", () => {
      assert.ok(createdResult);
      assert.equal(createdResult.enrollment.enrolledAt.toISOString(), AS_OF.toISOString());
      assert.equal(createdResult.enrollment.highestCompletedLevel, 0);
      assert.equal(createdResult.enrollment.currentLevel, 1);
      assert.equal(createdResult.enrollment.lastMeaningfulActionAt, null);
      assert.equal(createdResult.enrollment.completedAt, null);
      assert.equal(createdResult.enrollment.migrationSource, null);
    });

    await check("15. curriculumCode is always ata-v2", () => {
      assert.ok(createdResult);
      assert.equal(createdResult.enrollment.curriculumCode, "ata-v2");
    });

    await check("16. pin targets the exact resolved published version", () => {
      assert.ok(createdResult);
      assert.equal(createdResult.enrollment.curriculumVersionId, createdVersionId);
      assert.equal(createdResult.enrollment.userId, createdTargetId);
    });

    await check("17. enrollment creates no UserLevelProgress rows", async () => {
      assert.equal(await prisma.userLevelProgress.count(), 0);
    });

    await check("18. success audit is created in the transaction", async () => {
      const audits = await prisma.auditLog.findMany({
        where: { action: "CURRICULUM_USER_ENROLLED" },
      });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].entityType, "UserCurriculumEnrollment");
      assert.equal(audits[0].entityId, String(createdResult?.enrollment.id));
    });

    await check("19. audit contains actor and target identifiers", async () => {
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "CURRICULUM_USER_ENROLLED" },
      });
      const metadata = audit.metadata as Record<string, unknown>;
      assert.equal(audit.userId, createdActorId);
      assert.equal(metadata.actorId, createdActorId);
      assert.equal(metadata.targetUserId, createdTargetId);
      assert.equal(metadata.enrollmentId, createdResult?.enrollment.id);
      assert.equal(metadata.curriculumVersionId, createdVersionId);
      assert.equal(metadata.curriculumCode, "ata-v2");
      assert.equal(metadata.versionNumber, 1);
      // A3 added `provenance` so an audit reader can tell an operator
      // enrollment from an automatic one without parsing prose. The ADMIN
      // command must always say `admin_command`; `system_registration` belongs
      // to `enrollActiveCurriculumForNewUser` and can never appear here.
      assert.equal(metadata.provenance, "admin_command");
      assert.deepEqual(Object.keys(metadata).sort(), [
        "actorId",
        "curriculumCode",
        "curriculumVersionId",
        "enrollmentId",
        "provenance",
        "targetUserId",
        "versionNumber",
      ]);
      // Still no PII: the key set above is exhaustive and carries only ids.
      const serialized = JSON.stringify(metadata);
      assert.equal(serialized.includes("@"), false);
    });

    let repeated: UserCurriculumEnrollment | null = null;
    await check("20. repeat command returns created=false", async () => {
      const result = await enrollmentCommand.enrollUserInPublishedCurriculum({
        userId: createdTargetId,
        actorId: createdActorId,
        asOf: new Date(AS_OF.getTime() + 60_000),
      });
      assert.equal(result.created, false);
      assert.equal(result.enrollment.id, createdResult?.enrollment.id);
      repeated = result.enrollment;
    });

    await check("21. repeat command does not touch timestamps", () => {
      assert.ok(repeated);
      assert.equal(repeated.updatedAt.toISOString(), createdUpdatedAt);
      assert.equal(repeated.enrolledAt.toISOString(), AS_OF.toISOString());
    });

    await check("22. repeat command creates no second audit", async () => {
      assert.equal(
        await prisma.auditLog.count({ where: { action: "CURRICULUM_USER_ENROLLED" } }),
        1,
      );
    });

    await check("23. newer published version does not replace active pin", async () => {
      await prisma.curriculumVersion.update({
        where: { id: createdVersionId },
        data: { status: "archived" },
      });
      await createGraph({ versionNumber: 2 });
      const result = await enrollmentCommand.enrollUserInPublishedCurriculum({
        userId: createdTargetId,
        actorId: createdActorId,
        asOf: new Date(AS_OF.getTime() + 120_000),
      });
      assert.equal(result.created, false);
      assert.equal(result.enrollment.curriculumVersionId, createdVersionId);
    });

    await check("24. archived pin remains a valid existing active enrollment", async () => {
      const result = await enrollmentCommand.enrollUserInPublishedCurriculum({
        userId: createdTargetId,
        actorId: createdActorId,
        asOf: new Date(AS_OF.getTime() + 180_000),
      });
      assert.equal(result.created, false);
      assert.equal(result.enrollment.curriculumVersionId, createdVersionId);
    });

    await check("25. active enrollment with completedAt is history corrupt", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target");
      const graph = await createGraph();
      await createEnrollment({
        userId: target.id,
        version: graph.version,
        completedAt: AS_OF,
      });
      await expectDomain("ENROLLMENT_HISTORY_CORRUPT", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({
          userId: target.id,
          actorId: actor.id,
        }),
      );
    });

    await check("26. active enrollment pinned to draft is history corrupt", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target");
      const graph = await createGraph({ status: "draft" });
      await createEnrollment({ userId: target.id, version: graph.version });
      await expectDomain("ENROLLMENT_HISTORY_CORRUPT", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({
          userId: target.id,
          actorId: actor.id,
        }),
      );
    });

    await check("27. completed history blocks ordinary re-enrollment", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target");
      const graph = await createGraph();
      await createEnrollment({
        userId: target.id,
        version: graph.version,
        status: "completed",
      });
      await expectDomain("ENROLLMENT_ALREADY_COMPLETED", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({
          userId: target.id,
          actorId: actor.id,
        }),
      );
      assert.equal(await prisma.userCurriculumEnrollment.count(), 1);
    });

    await check("28. superseded history without active replacement is corrupt", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target");
      const graph = await createGraph();
      await createEnrollment({
        userId: target.id,
        version: graph.version,
        status: "superseded",
      });
      await expectDomain("ENROLLMENT_HISTORY_CORRUPT", () =>
        enrollmentCommand.enrollUserInPublishedCurriculum({
          userId: target.id,
          actorId: actor.id,
        }),
      );
    });

    await check("29. superseded history plus valid active returns active", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target");
      const graph = await createGraph();
      await createEnrollment({
        userId: target.id,
        version: graph.version,
        status: "superseded",
        enrolledAt: new Date(AS_OF.getTime() - 60_000),
      });
      const active = await createEnrollment({ userId: target.id, version: graph.version });
      const result = await enrollmentCommand.enrollUserInPublishedCurriculum({
        userId: target.id,
        actorId: actor.id,
      });
      assert.equal(result.created, false);
      assert.equal(result.enrollment.id, active.id);
    });

    let raceResult: Awaited<
      ReturnType<typeof enrollmentCommand.enrollUserInPublishedCurriculum>
    > | null = null;
    await check("30. controlled unique race leaves one active enrollment", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target");
      await createGraph();
      let injectConflict = true;
      const raceDb = {
        async $transaction(
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) {
          const enrollmentDelegate = injectConflict
            ? {
                findMany: prisma.userCurriculumEnrollment.findMany.bind(
                  prisma.userCurriculumEnrollment,
                ),
                create: async (
                  args: Parameters<typeof prisma.userCurriculumEnrollment.create>[0],
                ) => {
                  injectConflict = false;
                  await prisma.userCurriculumEnrollment.create(args);
                  return prisma.userCurriculumEnrollment.create(args);
                },
              }
            : prisma.userCurriculumEnrollment;
          return callback(
            minimalTx(
              prisma as unknown as Prisma.TransactionClient,
              { userCurriculumEnrollment: enrollmentDelegate },
            ),
          );
        },
      } as unknown as EnrollmentCommandDb;
      raceResult = await enrollmentCommand.enrollUserInPublishedCurriculum({
        userId: target.id,
        actorId: actor.id,
        asOf: AS_OF,
        db: raceDb,
      });
      assert.equal(
        await prisma.userCurriculumEnrollment.count({
          where: { userId: target.id, curriculumCode: "ata-v2", status: "active" },
        }),
        1,
      );
    });

    await check("31. controlled race loser returns created=false", async () => {
      assert.ok(raceResult);
      assert.equal(raceResult.created, false);
      assert.equal(raceResult.enrollment.status, "active");
      assert.equal(await prisma.auditLog.count(), 0);
    });

    await check("32. audit failure rolls back enrollment", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target");
      await createGraph();
      const auditFailure = new Error("controlled audit failure");
      const auditFailureDb = {
        async $transaction(
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) {
          return prisma.$transaction((tx) =>
            callback(
              minimalTx(tx, {
                auditLog: {
                  ...tx.auditLog,
                  create: async () => {
                    throw auditFailure;
                  },
                },
              }),
            ),
          );
        },
      } as unknown as EnrollmentCommandDb;
      await assert.rejects(
        () =>
          enrollmentCommand.enrollUserInPublishedCurriculum({
            userId: target.id,
            actorId: actor.id,
            asOf: AS_OF,
            db: auditFailureDb,
          }),
        (error) => error === auditFailure,
      );
      assert.deepEqual(await writeCounts(), { enrollments: 0, progress: 0, audits: 0 });
    });

    await check("33. unexpected Prisma-side error is not masked", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target");
      await createGraph();
      const unexpected = new Error("unexpected database failure");
      const unexpectedDb = {
        async $transaction(
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) {
          return prisma.$transaction((tx) =>
            callback(
              minimalTx(tx, {
                userCurriculumEnrollment: {
                  ...tx.userCurriculumEnrollment,
                  findMany: tx.userCurriculumEnrollment.findMany.bind(
                    tx.userCurriculumEnrollment,
                  ),
                  create: async () => {
                    throw unexpected;
                  },
                },
              }),
            ),
          );
        },
      } as unknown as EnrollmentCommandDb;
      await assert.rejects(
        () =>
          enrollmentCommand.enrollUserInPublishedCurriculum({
            userId: target.id,
            actorId: actor.id,
            asOf: AS_OF,
            db: unexpectedDb,
          }),
        (error) => error === unexpected,
      );
    });

    await check("34. V1 User/Task/progression data remains unchanged", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target");
      const v1Level = await prisma.level.create({
        data: { number: 1, title: "V1 Level", requiredXp: 0, status: "active" },
      });
      const task = await prisma.task.create({
        data: {
          code: "v1_enrollment_guard",
          stepNumber: 1,
          title: "V1 Task",
          description: "unchanged",
          rewardType: "xp",
          actionLabel: "Complete",
        },
      });
      const progress = await prisma.userTaskProgress.create({
        data: { userId: target.id, taskId: task.id, status: "available" },
      });
      await createGraph();
      const before = {
        user: await prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
        task: await prisma.task.findUniqueOrThrow({ where: { id: task.id } }),
        level: await prisma.level.findUniqueOrThrow({ where: { id: v1Level.id } }),
        progress: await prisma.userTaskProgress.findUniqueOrThrow({
          where: { id: progress.id },
        }),
      };
      await enrollmentCommand.enrollUserInPublishedCurriculum({
        userId: target.id,
        actorId: actor.id,
        asOf: AS_OF,
      });
      const after = {
        user: await prisma.user.findUniqueOrThrow({ where: { id: target.id } }),
        task: await prisma.task.findUniqueOrThrow({ where: { id: task.id } }),
        level: await prisma.level.findUniqueOrThrow({ where: { id: v1Level.id } }),
        progress: await prisma.userTaskProgress.findUniqueOrThrow({
          where: { id: progress.id },
        }),
      };
      assert.deepEqual(after, before);
    });

    await check("35. resolver and writes use only the supplied transaction client", async () => {
      await resetFixtures();
      const actor = await createUser("actor", { role: "admin" });
      const target = await createUser("target");
      await createGraph();
      let transactionCalls = 0;
      const transactionOnlyDb = {
        async $transaction(
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) {
          transactionCalls += 1;
          return prisma.$transaction(callback);
        },
      } as unknown as EnrollmentCommandDb;
      const result = await enrollmentCommand.enrollUserInPublishedCurriculum({
        userId: target.id,
        actorId: actor.id,
        asOf: AS_OF,
        db: transactionOnlyDb,
      });
      assert.equal(result.created, true);
      assert.equal(transactionCalls, 1);
      assert.equal(await prisma.userLevelProgress.count(), 0);
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
    restoreFlag("CURRICULUM_V2_ADMIN_ENABLED", originalFlags.admin);
    restoreFlag("CURRICULUM_V2_READ_ENABLED", originalFlags.read);
    restoreFlag("CURRICULUM_V2_ENROLLMENT_ENABLED", originalFlags.enrollment);
  }

  await check("36. temporary DB and journals are removed", () => {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      assert.equal(fs.existsSync(`${dbPath}${suffix}`), false, `leftover ${dbPath}${suffix}`);
    }
  });

  await check("37. regression leaves no test listener", () => {
    const listeners = spawnSync("ss", ["-ltn"], { encoding: "utf8" });
    assert.equal(listeners.status, 0, listeners.stderr);
    assert.doesNotMatch(listeners.stdout, /:39\d{2}\b/);
  });
}

main()
  .then(() => {
    console.log(
      `\ncurriculum enrollment command regression: ${passed} passed, ${failed} failed`,
    );
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    cleanupDb();
    restoreFlag("CURRICULUM_V2_ADMIN_ENABLED", originalFlags.admin);
    restoreFlag("CURRICULUM_V2_READ_ENABLED", originalFlags.read);
    restoreFlag("CURRICULUM_V2_ENROLLMENT_ENABLED", originalFlags.enrollment);
    console.error(error);
    console.log(
      `\ncurriculum enrollment command regression: ${passed} passed, ${failed + 1} failed`,
    );
    process.exit(1);
  });
