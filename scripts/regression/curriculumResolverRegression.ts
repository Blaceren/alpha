import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { CurriculumVersion, UserCurriculumEnrollment } from "@prisma/client";
import type {
  CurriculumResolverDb,
  EnrollmentResolutionGraph,
} from "../../src/lib/curriculum/resolver";

// Phase 2B.2 regression: feature-gated, typed, read-only curriculum resolution.
// Uses only a throwaway SQLite DB in /tmp and never starts an HTTP server.

const dbPath = `/tmp/ata-curriculum-resolver-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
process.env.DATABASE_URL = dbUrl;

const AS_OF = new Date("2026-07-14T12:00:00.000Z");
const originalFlags = {
  admin: process.env.CURRICULUM_V2_ADMIN_ENABLED,
  read: process.env.CURRICULUM_V2_READ_ENABLED,
  enrollment: process.env.CURRICULUM_V2_ENROLLMENT_ENABLED,
};

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
    console.error(error instanceof Error ? error.message : error);
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
  const resolver = await import("../../src/lib/curriculum/resolver");

  async function resetFixtures() {
    await prisma.userLevelProgress.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();
  }

  async function createUser(label: string) {
    return prisma.user.create({
      data: {
        email: `${label}-${process.pid}@example.com`,
        name: label,
      },
    });
  }

  async function createGraph(input: {
    code?: string;
    versionNumber?: number;
    status?: "draft" | "published" | "archived";
    publishedAt?: Date | null;
    effectiveFrom?: Date | null;
    moduleStatus?: "active" | "disabled";
    levelStatus?: "active" | "disabled";
    levelCount?: number;
  } = {}) {
    const code = input.code ?? "ata-v2";
    const status = input.status ?? "published";
    const version = await prisma.curriculumVersion.create({
      data: {
        code,
        name: `${code} v${input.versionNumber ?? 1}`,
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
        lastLevel: input.levelCount ?? 1,
        status: input.moduleStatus ?? "active",
      },
    });
    const levels = [];
    for (let levelNumber = 1; levelNumber <= (input.levelCount ?? 1); levelNumber += 1) {
      levels.push(
        await prisma.levelDefinition.create({
          data: {
            curriculumVersionId: version.id,
            moduleId: moduleDefinition.id,
            levelNumber,
            stableCode: `v2.l${String(levelNumber).padStart(3, "0")}.resolver-${version.id}`,
            type: "lesson",
            title: `Level ${levelNumber}`,
            completionMethod: "lesson",
            status: input.levelStatus ?? "active",
          },
        }),
      );
    }
    return { version, module: moduleDefinition, levels };
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
        enrolledAt: input.enrolledAt,
      },
    });
  }

  try {
    const queryGuard = new Proxy(
      {},
      {
        get() {
          throw new Error("disabled resolver touched the DB");
        },
      },
    ) as CurriculumResolverDb;

    await check("1. READ flag off returns disabled", async () => {
      setFlags({ read: false });
      assert.deepEqual(
        await resolver.resolvePublishedCurriculum({ db: queryGuard }),
        { kind: "disabled" },
      );
    });

    await check("2. disabled resolver performs no Prisma query", async () => {
      setFlags({});
      const result = await resolver.resolveUserCurriculumContext({
        userId: 1,
        db: queryGuard,
      });
      assert.equal(result.kind, "disabled");
    });

    await check("3. admin flag does not enable READ resolver", async () => {
      setFlags({ admin: true, read: false });
      assert.equal((await resolver.resolvePublishedCurriculum({ db: queryGuard })).kind, "disabled");
    });

    await check("4. enrollment flag does not enable READ resolver", async () => {
      setFlags({ enrollment: true, read: false });
      assert.equal((await resolver.resolvePublishedCurriculum({ db: queryGuard })).kind, "disabled");
    });

    await check("5. no published version returns unavailable", async () => {
      await resetFixtures();
      setFlags({ read: true });
      const result = await resolver.resolvePublishedCurriculum({ asOf: AS_OF, db: prisma });
      assert.deepEqual(result, { kind: "unavailable", reason: "no_published_version" });
    });

    await check("6. draft does not become a candidate", async () => {
      await resetFixtures();
      await createGraph({ status: "draft" });
      setFlags({ read: true });
      const result = await resolver.resolvePublishedCurriculum({ asOf: AS_OF, db: prisma });
      assert.deepEqual(result, { kind: "unavailable", reason: "no_published_version" });
    });

    await check("7. archived version does not become a new-user candidate", async () => {
      await resetFixtures();
      await createGraph({ status: "archived" });
      setFlags({ read: true });
      const result = await resolver.resolvePublishedCurriculum({ asOf: AS_OF, db: prisma });
      assert.deepEqual(result, { kind: "unavailable", reason: "no_published_version" });
    });

    await check("8. valid effective published version is available", async () => {
      await resetFixtures();
      const graph = await createGraph();
      setFlags({ read: true });
      const result = await resolver.resolvePublishedCurriculum({ asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "available");
      if (result.kind === "available") assert.equal(result.curriculumVersion.id, graph.version.id);
    });

    await check("9. future effectiveFrom returns not_effective_yet", async () => {
      await resetFixtures();
      await createGraph({ effectiveFrom: new Date("2026-07-15T00:00:00.000Z") });
      setFlags({ read: true });
      const result = await resolver.resolvePublishedCurriculum({ asOf: AS_OF, db: prisma });
      assert.deepEqual(result, { kind: "unavailable", reason: "not_effective_yet" });
    });

    await check("10. future publishedAt returns not_effective_yet", async () => {
      await resetFixtures();
      await createGraph({ publishedAt: new Date("2026-07-15T00:00:00.000Z") });
      setFlags({ read: true });
      const result = await resolver.resolvePublishedCurriculum({ asOf: AS_OF, db: prisma });
      assert.deepEqual(result, { kind: "unavailable", reason: "not_effective_yet" });
    });

    await check("11. published version without publishedAt is corrupt", async () => {
      await resetFixtures();
      await createGraph({ publishedAt: null });
      setFlags({ read: true });
      const result = await resolver.resolvePublishedCurriculum({ asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "corrupt");
      if (result.kind === "corrupt") assert.equal(result.reason, "published_without_published_at");
    });

    await check("12. modules and levels use deterministic number/id sorting", async () => {
      await resetFixtures();
      const version = await prisma.curriculumVersion.create({
        data: {
          code: "ata-v2",
          name: "Sorted graph",
          versionNumber: 1,
          status: "published",
          publishedAt: AS_OF,
        },
      });
      const module2 = await prisma.moduleDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleNumber: 2,
          code: "m02",
          title: "M2",
          firstLevel: 2,
          lastLevel: 2,
        },
      });
      const module1 = await prisma.moduleDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleNumber: 1,
          code: "m01",
          title: "M1",
          firstLevel: 1,
          lastLevel: 1,
        },
      });
      await prisma.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: module2.id,
          levelNumber: 2,
          stableCode: "v2.l002.sorted",
          type: "lesson",
          title: "L2",
          completionMethod: "lesson",
        },
      });
      await prisma.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: module1.id,
          levelNumber: 1,
          stableCode: "v2.l001.sorted",
          type: "lesson",
          title: "L1",
          completionMethod: "lesson",
        },
      });
      setFlags({ read: true });
      const result = await resolver.resolvePublishedCurriculum({ asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "available");
      if (result.kind === "available") {
        assert.deepEqual(result.modules.map((item) => item.moduleNumber), [1, 2]);
        assert.deepEqual(result.levels.map((item) => item.levelNumber), [1, 2]);
      }
    });

    await check("13. disabled definition in published graph is corrupt", async () => {
      await resetFixtures();
      await createGraph({ levelStatus: "disabled" });
      setFlags({ read: true });
      const result = await resolver.resolvePublishedCurriculum({ asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "corrupt");
      if (result.kind === "corrupt") assert.equal(result.reason, "invalid_curriculum_graph");
    });

    await check("14. duplicate published versions are reported as corrupt", async () => {
      await resetFixtures();
      await prisma.$executeRawUnsafe('DROP INDEX "CurriculumVersion_code_published_key"');
      await createGraph({ versionNumber: 1 });
      await createGraph({ versionNumber: 2 });
      setFlags({ read: true });
      const result = await resolver.resolvePublishedCurriculum({ asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "corrupt");
      if (result.kind === "corrupt") assert.equal(result.reason, "duplicate_published_version");
      await resetFixtures();
      await prisma.$executeRawUnsafe(
        'CREATE UNIQUE INDEX "CurriculumVersion_code_published_key" ON "CurriculumVersion"("code") WHERE "status" = \'published\'',
      );
    });

    await check("15. missing user returns user_not_found", async () => {
      await resetFixtures();
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: 999999, asOf: AS_OF, db: prisma });
      assert.deepEqual(result, { kind: "user_not_found" });
    });

    await check("16. user without history receives a candidate", async () => {
      await resetFixtures();
      const graph = await createGraph();
      const user = await createUser("candidate");
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "candidate");
      if (result.kind === "candidate") assert.equal(result.curriculumVersion.id, graph.version.id);
    });

    await check("17. active enrollment resolves as enrolled", async () => {
      await resetFixtures();
      const graph = await createGraph();
      const user = await createUser("active");
      const enrollment = await createEnrollment({ userId: user.id, version: graph.version });
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "enrolled");
      if (result.kind === "enrolled") assert.equal(result.enrollment.id, enrollment.id);
    });

    await check("18. active enrollment remains pinned after version archive", async () => {
      await resetFixtures();
      const graph = await createGraph();
      const user = await createUser("archived-pin");
      await createEnrollment({ userId: user.id, version: graph.version });
      await prisma.curriculumVersion.update({ where: { id: graph.version.id }, data: { status: "archived" } });
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "enrolled");
      if (result.kind === "enrolled") assert.equal(result.curriculumVersion.status, "archived");
    });

    await check("19. newer published version does not replace active pin", async () => {
      await resetFixtures();
      const oldGraph = await createGraph({ versionNumber: 1 });
      const user = await createUser("stable-pin");
      await createEnrollment({ userId: user.id, version: oldGraph.version });
      await prisma.curriculumVersion.update({ where: { id: oldGraph.version.id }, data: { status: "archived" } });
      const newGraph = await createGraph({ versionNumber: 2 });
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "enrolled");
      if (result.kind === "enrolled") {
        assert.equal(result.curriculumVersion.id, oldGraph.version.id);
        assert.notEqual(result.curriculumVersion.id, newGraph.version.id);
      }
    });

    await check("20. active enrollment pinned to draft is corrupt", async () => {
      await resetFixtures();
      const graph = await createGraph({ status: "draft" });
      const user = await createUser("draft-pin");
      await createEnrollment({ userId: user.id, version: graph.version });
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "corrupt");
      if (result.kind === "corrupt") assert.equal(result.reason, "draft_pinned_version");
    });

    await check("21. completed enrollment resolves as completed", async () => {
      await resetFixtures();
      const graph = await createGraph();
      const user = await createUser("completed");
      const enrollment = await createEnrollment({ userId: user.id, version: graph.version, status: "completed" });
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "completed");
      if (result.kind === "completed") assert.equal(result.enrollment.id, enrollment.id);
    });

    await check("22. completed enrollment does not receive a newer candidate", async () => {
      await resetFixtures();
      const oldGraph = await createGraph({ versionNumber: 1 });
      const user = await createUser("completed-pin");
      await createEnrollment({ userId: user.id, version: oldGraph.version, status: "completed" });
      await prisma.curriculumVersion.update({ where: { id: oldGraph.version.id }, data: { status: "archived" } });
      const newGraph = await createGraph({ versionNumber: 2 });
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "completed");
      if (result.kind === "completed") {
        assert.equal(result.curriculumVersion.id, oldGraph.version.id);
        assert.notEqual(result.curriculumVersion.id, newGraph.version.id);
      }
    });

    await check("23. completed enrollment without completedAt is corrupt", async () => {
      await resetFixtures();
      const graph = await createGraph();
      const user = await createUser("completed-no-date");
      await createEnrollment({ userId: user.id, version: graph.version, status: "completed", completedAt: null });
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "corrupt");
      if (result.kind === "corrupt") assert.equal(result.diagnostics.issue, "completed_without_completed_at");
    });

    await check("24. active enrollment with completedAt is corrupt", async () => {
      await resetFixtures();
      const graph = await createGraph();
      const user = await createUser("active-with-date");
      await createEnrollment({ userId: user.id, version: graph.version, status: "active", completedAt: AS_OF });
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "corrupt");
      if (result.kind === "corrupt") assert.equal(result.diagnostics.issue, "active_with_completed_at");
    });

    await check("25. superseded enrollment without replacement is corrupt", async () => {
      await resetFixtures();
      const graph = await createGraph();
      const user = await createUser("superseded-only");
      await createEnrollment({ userId: user.id, version: graph.version, status: "superseded" });
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "corrupt");
      if (result.kind === "corrupt") assert.equal(result.reason, "superseded_without_replacement");
    });

    await check("26. newer completed enrollment supersedes older superseded history", async () => {
      await resetFixtures();
      const graph = await createGraph();
      const user = await createUser("superseded-completed");
      await createEnrollment({
        userId: user.id,
        version: graph.version,
        status: "superseded",
        enrolledAt: new Date("2026-07-10T00:00:00.000Z"),
      });
      const completed = await createEnrollment({
        userId: user.id,
        version: graph.version,
        status: "completed",
        enrolledAt: new Date("2026-07-11T00:00:00.000Z"),
      });
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "completed");
      if (result.kind === "completed") assert.equal(result.enrollment.id, completed.id);
    });

    await check("27. persisted progress is returned in levelNumber/id order", async () => {
      await resetFixtures();
      const graph = await createGraph({ levelCount: 2 });
      const user = await createUser("progress-sort");
      const enrollment = await createEnrollment({ userId: user.id, version: graph.version });
      await prisma.userLevelProgress.create({
        data: {
          enrollmentId: enrollment.id,
          curriculumVersionId: graph.version.id,
          levelDefinitionId: graph.levels[1].id,
        },
      });
      await prisma.userLevelProgress.create({
        data: {
          enrollmentId: enrollment.id,
          curriculumVersionId: graph.version.id,
          levelDefinitionId: graph.levels[0].id,
        },
      });
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "enrolled");
      if (result.kind === "enrolled") {
        assert.deepEqual(result.progress.map((item) => item.levelDefinition.levelNumber), [1, 2]);
      }
    });

    await check("28. absent progress rows are not created", async () => {
      await resetFixtures();
      const graph = await createGraph({ levelCount: 2 });
      const user = await createUser("no-progress-write");
      await createEnrollment({ userId: user.id, version: graph.version });
      const before = await prisma.userLevelProgress.count();
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      const after = await prisma.userLevelProgress.count();
      assert.equal(result.kind, "enrolled");
      if (result.kind === "enrolled") assert.deepEqual(result.progress, []);
      assert.equal(after, before);
    });

    await check("29. pure validator detects cross-version and code corruption", async () => {
      await resetFixtures();
      const graphA = await createGraph({ versionNumber: 1 });
      const user = await createUser("pure-validator");
      const enrollment = await createEnrollment({ userId: user.id, version: graphA.version });
      await prisma.userLevelProgress.create({
        data: {
          enrollmentId: enrollment.id,
          curriculumVersionId: graphA.version.id,
          levelDefinitionId: graphA.levels[0].id,
        },
      });
      const snapshot = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
        include: {
          curriculumVersion: { include: { modules: true, levels: true } },
          levelProgress: { include: { levelDefinition: true } },
        },
      });
      const crossVersion = {
        ...snapshot,
        levelProgress: snapshot.levelProgress.map((item) => ({
          ...item,
          curriculumVersionId: graphA.version.id + 1000,
        })),
      } as EnrollmentResolutionGraph;
      const crossVersionResult = resolver.validatePinnedEnrollmentSnapshot(crossVersion);
      assert.equal(crossVersionResult?.reason, "invalid_progress_state");
      const codeMismatch = {
        ...snapshot,
        curriculumCode: "ata-other",
      } as EnrollmentResolutionGraph;
      const codeResult = resolver.validatePinnedEnrollmentSnapshot(codeMismatch);
      assert.equal(codeResult?.reason, "code_mismatch");
    });

    await check("30. another curriculumCode is not mixed with ata-v2", async () => {
      await resetFixtures();
      const mainGraph = await createGraph({ code: "ata-v2", versionNumber: 1 });
      const sideGraph = await createGraph({ code: "ata-side", versionNumber: 1 });
      const user = await createUser("separate-lines");
      await createEnrollment({ userId: user.id, version: sideGraph.version });
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      assert.equal(result.kind, "candidate");
      if (result.kind === "candidate") assert.equal(result.curriculumVersion.id, mainGraph.version.id);
    });

    let lastReadOnlyEnrollment: UserCurriculumEnrollment | null = null;
    await check("31. resolver leaves counts, updatedAt and audit rows unchanged", async () => {
      await resetFixtures();
      const graph = await createGraph();
      const user = await createUser("read-only-state");
      lastReadOnlyEnrollment = await createEnrollment({ userId: user.id, version: graph.version });
      const before = {
        users: await prisma.user.count(),
        enrollments: await prisma.userCurriculumEnrollment.count(),
        progress: await prisma.userLevelProgress.count(),
        audits: await prisma.auditLog.count(),
        updatedAt: lastReadOnlyEnrollment.updatedAt.toISOString(),
      };
      setFlags({ read: true });
      await resolver.resolveUserCurriculumContext({ userId: user.id, asOf: AS_OF, db: prisma });
      const fresh = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
        where: { id: lastReadOnlyEnrollment.id },
      });
      const after = {
        users: await prisma.user.count(),
        enrollments: await prisma.userCurriculumEnrollment.count(),
        progress: await prisma.userLevelProgress.count(),
        audits: await prisma.auditLog.count(),
        updatedAt: fresh.updatedAt.toISOString(),
      };
      assert.deepEqual(after, before);
    });

    await check("32. resolver uses only bounded read delegates and performs no writes", async () => {
      assert.notEqual(lastReadOnlyEnrollment, null);
      const enrollment = lastReadOnlyEnrollment as UserCurriculumEnrollment;
      const userId = enrollment.userId;
      const calls: string[] = [];
      const readDb = {
        curriculumVersion: {
          findMany: async (...args: Parameters<typeof prisma.curriculumVersion.findMany>) => {
            calls.push("curriculumVersion.findMany");
            return prisma.curriculumVersion.findMany(...args);
          },
        },
        user: {
          findUnique: async (...args: Parameters<typeof prisma.user.findUnique>) => {
            calls.push("user.findUnique");
            return prisma.user.findUnique(...args);
          },
        },
        userCurriculumEnrollment: {
          findMany: async (...args: Parameters<typeof prisma.userCurriculumEnrollment.findMany>) => {
            calls.push("userCurriculumEnrollment.findMany");
            return prisma.userCurriculumEnrollment.findMany(...args);
          },
        },
      } as unknown as CurriculumResolverDb;
      const before = await prisma.$queryRawUnsafe<Array<{ changes: bigint }>>(
        "SELECT total_changes() AS changes",
      );
      setFlags({ read: true });
      const result = await resolver.resolveUserCurriculumContext({ userId, asOf: AS_OF, db: readDb });
      const after = await prisma.$queryRawUnsafe<Array<{ changes: bigint }>>(
        "SELECT total_changes() AS changes",
      );
      assert.equal(result.kind, "enrolled");
      assert.deepEqual(calls, ["user.findUnique", "userCurriculumEnrollment.findMany"]);
      assert.equal(after[0].changes, before[0].changes);
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
    restoreFlag("CURRICULUM_V2_ADMIN_ENABLED", originalFlags.admin);
    restoreFlag("CURRICULUM_V2_READ_ENABLED", originalFlags.read);
    restoreFlag("CURRICULUM_V2_ENROLLMENT_ENABLED", originalFlags.enrollment);
  }

  await check("33. temporary DB and journals are removed", () => {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      assert.equal(fs.existsSync(`${dbPath}${suffix}`), false, `leftover ${dbPath}${suffix}`);
    }
  });

  await check("34. regression leaves no test listener", () => {
    const listeners = spawnSync("ss", ["-ltn"], { encoding: "utf8" });
    assert.equal(listeners.status, 0, listeners.stderr);
    assert.doesNotMatch(listeners.stdout, /:39\d{2}\b/);
  });
}

main()
  .then(() => {
    console.log(`\ncurriculum resolver regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    cleanupDb();
    restoreFlag("CURRICULUM_V2_ADMIN_ENABLED", originalFlags.admin);
    restoreFlag("CURRICULUM_V2_READ_ENABLED", originalFlags.read);
    restoreFlag("CURRICULUM_V2_ENROLLMENT_ENABLED", originalFlags.enrollment);
    console.error(error);
    console.log(`\ncurriculum resolver regression: ${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
