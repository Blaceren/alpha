import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

// Phase 2B.1 regression: apply the complete migration chain to an isolated
// SQLite DB, then prove enrollment/progress defaults, history semantics,
// partial uniqueness, composite cross-version protection and Restrict FKs.

const dbPath = `/tmp/ata-curriculum-enrollment-schema-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;

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

function isConstraintError(error: unknown, codes: string[] = ["P2002", "P2003", "P2010"]) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return codes.includes(error.code);
  }
  return error instanceof Error && /constraint|foreign key|unique/i.test(error.message);
}

async function expectConstraint(fn: () => Promise<unknown>, label: string, codes?: string[]) {
  try {
    await fn();
  } catch (error) {
    assert.equal(isConstraintError(error, codes), true, `${label}: expected constraint error, got: ${error}`);
    return;
  }
  assert.fail(`${label}: expected a constraint violation, but the operation succeeded`);
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
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

  try {
    const tables = (
      await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
    ).map((row) => row.name);

    await check("1. full migration chain applies from scratch", () => {
      assert.match(runner.stdout, /migration/i);
    });

    await check("2. enrollment and progress tables exist", () => {
      for (const table of ["UserCurriculumEnrollment", "UserLevelProgress"]) {
        assert.equal(tables.includes(table), true, `missing ${table}`);
      }
    });

    await check("3. V1 and Phase 1 curriculum tables remain available", () => {
      for (const table of [
        "User", "Task", "Level", "UserTaskProgress", "Checkpoint", "XpEvent",
        "CurriculumVersion", "ModuleDefinition", "LevelDefinition",
      ]) {
        assert.equal(tables.includes(table), true, `missing ${table}`);
      }
    });

    const userA = await prisma.user.create({
      data: { email: "enrollment-a@example.com", name: "Enrollment A" },
    });
    const userB = await prisma.user.create({
      data: { email: "enrollment-b@example.com", name: "Enrollment B" },
    });
    const userRestrict = await prisma.user.create({
      data: { email: "enrollment-restrict@example.com", name: "Enrollment Restrict" },
    });

    const versionA = await prisma.curriculumVersion.create({
      data: {
        code: "ata-v2",
        name: "ATA V2 published",
        versionNumber: 1,
        status: "published",
        publishedAt: new Date(),
      },
    });
    const versionB = await prisma.curriculumVersion.create({
      data: { code: "ata-v2", name: "ATA V2 archived", versionNumber: 2, status: "archived" },
    });
    const sideVersion = await prisma.curriculumVersion.create({
      data: {
        code: "ata-side",
        name: "ATA side line",
        versionNumber: 1,
        status: "published",
        publishedAt: new Date(),
      },
    });
    const enrollmentOnlyVersion = await prisma.curriculumVersion.create({
      data: {
        code: "ata-enrollment-only",
        name: "Enrollment-only version",
        versionNumber: 1,
        status: "published",
        publishedAt: new Date(),
      },
    });

    const moduleA = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: versionA.id,
        moduleNumber: 1,
        code: "m01",
        title: "Module A",
        firstLevel: 1,
        lastLevel: 3,
      },
    });
    const moduleB = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: versionB.id,
        moduleNumber: 1,
        code: "m01",
        title: "Module B",
        firstLevel: 1,
        lastLevel: 1,
      },
    });

    const levelA1 = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: versionA.id,
        moduleId: moduleA.id,
        levelNumber: 1,
        stableCode: "v2.l001.start",
        type: "lesson",
        title: "Start",
        completionMethod: "lesson",
      },
    });
    const levelA2 = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: versionA.id,
        moduleId: moduleA.id,
        levelNumber: 2,
        stableCode: "v2.l002.review",
        type: "mentor_review",
        title: "Review",
        completionMethod: "mentor_review",
      },
    });
    const levelA3 = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: versionA.id,
        moduleId: moduleA.id,
        levelNumber: 3,
        stableCode: "v2.l003.complete",
        type: "lesson",
        title: "Complete",
        completionMethod: "lesson",
      },
    });
    const levelB1 = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: versionB.id,
        moduleId: moduleB.id,
        levelNumber: 1,
        stableCode: "v2.l001.start",
        type: "lesson",
        title: "Start B",
        completionMethod: "lesson",
      },
    });

    const activeEnrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: userA.id,
        curriculumVersionId: versionA.id,
        curriculumCode: "ata-v2",
      },
    });

    await check("4. enrollment is created for a published CurriculumVersion", async () => {
      const row = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
        where: { id: activeEnrollment.id },
        include: { curriculumVersion: true },
      });
      assert.equal(row.curriculumVersion.status, "published");
    });

    await check("5. official curriculumCode ata-v2 is preserved", () => {
      assert.equal(activeEnrollment.curriculumCode, "ata-v2");
    });

    await check("6. enrollment defaults are applied", () => {
      assert.equal(activeEnrollment.status, "active");
      assert.equal(activeEnrollment.highestCompletedLevel, 0);
      assert.equal(activeEnrollment.currentLevel, 1);
      assert.equal(activeEnrollment.completedAt, null);
      assert.equal(activeEnrollment.lastMeaningfulActionAt, null);
      assert.equal(activeEnrollment.migrationSource, null);
    });

    await check("7. curriculumVersionId/curriculumCode mismatch is rejected", () =>
      expectConstraint(
        () => prisma.userCurriculumEnrollment.create({
          data: {
            userId: userB.id,
            curriculumVersionId: versionA.id,
            curriculumCode: "ata-side",
          },
        }),
        "enrollment version/code mismatch",
        ["P2003", "P2010"],
      ),
    );

    await check("8. second active enrollment for one user/curriculum line is rejected", () =>
      expectConstraint(
        () => prisma.userCurriculumEnrollment.create({
          data: {
            userId: userA.id,
            curriculumVersionId: versionB.id,
            curriculumCode: "ata-v2",
          },
        }),
        "duplicate active enrollment",
        ["P2002", "P2010"],
      ),
    );

    const otherUserActive = await prisma.userCurriculumEnrollment.create({
      data: { userId: userB.id, curriculumVersionId: versionA.id, curriculumCode: "ata-v2" },
    });
    const otherLineActive = await prisma.userCurriculumEnrollment.create({
      data: { userId: userA.id, curriculumVersionId: sideVersion.id, curriculumCode: "ata-side" },
    });

    await check("9. different users may have active ata-v2 enrollments", () => {
      assert.notEqual(otherUserActive.userId, activeEnrollment.userId);
    });

    await check("10. one user may have an active enrollment in another curriculum line", () => {
      assert.equal(otherLineActive.userId, activeEnrollment.userId);
      assert.notEqual(otherLineActive.curriculumCode, activeEnrollment.curriculumCode);
    });

    const completedEnrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: userA.id,
        curriculumVersionId: versionA.id,
        curriculumCode: "ata-v2",
        status: "completed",
        completedAt: new Date(),
      },
    });
    const supersededEnrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: userA.id,
        curriculumVersionId: versionB.id,
        curriculumCode: "ata-v2",
        status: "superseded",
        migrationSource: "version_migration",
      },
    });
    const secondCompletedEnrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: userA.id,
        curriculumVersionId: versionB.id,
        curriculumCode: "ata-v2",
        status: "completed",
        completedAt: new Date(),
      },
    });

    await check("11. completed history may coexist with one active enrollment", () => {
      assert.equal(completedEnrollment.status, "completed");
      assert.equal(activeEnrollment.status, "active");
    });

    await check("12. superseded history may coexist with one active enrollment", () => {
      assert.equal(supersededEnrollment.status, "superseded");
    });

    await check("13. multiple completed/superseded historical rows are allowed", async () => {
      const history = await prisma.userCurriculumEnrollment.count({
        where: { userId: userA.id, curriculumCode: "ata-v2", status: { in: ["completed", "superseded"] } },
      });
      assert.equal(history, 3);
      assert.equal(secondCompletedEnrollment.status, "completed");
    });

    const restrictEnrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: userRestrict.id,
        curriculumVersionId: enrollmentOnlyVersion.id,
        curriculumCode: "ata-enrollment-only",
      },
    });

    await check("14. deleting an enrolled CurriculumVersion is restricted", () =>
      expectConstraint(
        () => prisma.curriculumVersion.delete({ where: { id: enrollmentOnlyVersion.id } }),
        "enrollment version delete",
        ["P2003"],
      ),
    );

    await check("15. deleting an enrolled User is restricted", () =>
      expectConstraint(
        () => prisma.user.delete({ where: { id: userRestrict.id } }),
        "enrollment user delete",
        ["P2003"],
      ),
    );

    const progressA1 = await prisma.userLevelProgress.create({
      data: {
        enrollmentId: activeEnrollment.id,
        curriculumVersionId: versionA.id,
        levelDefinitionId: levelA1.id,
      },
    });
    const progressA2 = await prisma.userLevelProgress.create({
      data: {
        enrollmentId: activeEnrollment.id,
        curriculumVersionId: versionA.id,
        levelDefinitionId: levelA2.id,
        status: "pending_review",
      },
    });
    const progressA3 = await prisma.userLevelProgress.create({
      data: {
        enrollmentId: activeEnrollment.id,
        curriculumVersionId: versionA.id,
        levelDefinitionId: levelA3.id,
        status: "completed",
        completedAt: new Date(),
        completionMethod: "lesson",
      },
    });

    await check("16. same-version progress is created", () => {
      assert.equal(progressA1.curriculumVersionId, versionA.id);
      assert.equal(progressA1.levelDefinitionId, levelA1.id);
    });

    await check("17. cross-version progress is rejected by composite FKs", () =>
      expectConstraint(
        () => prisma.userLevelProgress.create({
          data: {
            enrollmentId: activeEnrollment.id,
            curriculumVersionId: versionA.id,
            levelDefinitionId: levelB1.id,
          },
        }),
        "cross-version progress",
        ["P2003", "P2010"],
      ),
    );

    await check("18. duplicate enrollment/level progress is rejected", () =>
      expectConstraint(
        () => prisma.userLevelProgress.create({
          data: {
            enrollmentId: activeEnrollment.id,
            curriculumVersionId: versionA.id,
            levelDefinitionId: levelA1.id,
          },
        }),
        "duplicate enrollment/level progress",
        ["P2002", "P2010"],
      ),
    );

    await check("19. different levels in one enrollment are allowed", async () => {
      const count = await prisma.userLevelProgress.count({ where: { enrollmentId: activeEnrollment.id } });
      assert.equal(count, 3);
    });

    const historicalProgress = await prisma.userLevelProgress.create({
      data: {
        enrollmentId: completedEnrollment.id,
        curriculumVersionId: versionA.id,
        levelDefinitionId: levelA1.id,
        status: "completed",
        completedAt: new Date(),
        completionMethod: "lesson",
      },
    });

    await check("20. one level may exist in different historical enrollments", () => {
      assert.equal(historicalProgress.levelDefinitionId, progressA1.levelDefinitionId);
      assert.notEqual(historicalProgress.enrollmentId, progressA1.enrollmentId);
    });

    await check("21. persisted progress statuses are exactly usable", () => {
      assert.deepEqual(
        [progressA1.status, progressA2.status, progressA3.status].sort(),
        ["completed", "in_progress", "pending_review"],
      );
    });

    await check("22. progress defaults are applied", () => {
      assert.equal(progressA1.status, "in_progress");
      assert.equal(progressA1.attemptCount, 0);
      assert.equal(progressA1.startedAt instanceof Date, true);
      assert.equal(progressA1.completionEvidence, null);
    });

    await check("23. deferred XP/review/checkpoint columns are absent", async () => {
      const enrollmentColumns = (
        await prisma.$queryRawUnsafe<Array<{ name: string }>>(
          'PRAGMA table_info("UserCurriculumEnrollment")',
        )
      ).map((row) => row.name);
      const progressColumns = (
        await prisma.$queryRawUnsafe<Array<{ name: string }>>(
          'PRAGMA table_info("UserLevelProgress")',
        )
      ).map((row) => row.name);
      assert.equal(enrollmentColumns.includes("currentXp"), false);
      for (const column of ["userId", "reviewId", "checkpointVerificationId", "assessmentAttemptId", "xpTransactionId"]) {
        assert.equal(progressColumns.includes(column), false, `unexpected column ${column}`);
      }
    });

    await check("24. partial active index exists with lower-case active predicate", async () => {
      const rows = await prisma.$queryRawUnsafe<Array<{ sql: string | null }>>(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='UserCurriculumEnrollment_userId_curriculumCode_active_key'",
      );
      assert.equal(rows.length, 1);
      assert.equal(/where\s+"?status"?\s*=\s*'active'/i.test(rows[0].sql ?? ""), true, rows[0].sql ?? "no sql");
    });

    await check("25. progress parent relations use Restrict and Cascade", async () => {
      const fks = await prisma.$queryRawUnsafe<Array<{ table: string; on_delete: string; on_update: string }>>(
        'PRAGMA foreign_key_list("UserLevelProgress")',
      );
      const parents = new Set(fks.map((fk) => fk.table));
      assert.deepEqual(parents, new Set(["UserCurriculumEnrollment", "LevelDefinition"]));
      assert.equal(fks.every((fk) => fk.on_delete.toUpperCase() === "RESTRICT"), true);
      assert.equal(fks.every((fk) => fk.on_update.toUpperCase() === "CASCADE"), true);
    });

    await check("26. enrollment with progress cannot be deleted", () =>
      expectConstraint(
        () => prisma.userCurriculumEnrollment.delete({ where: { id: activeEnrollment.id } }),
        "progress enrollment delete",
        ["P2003"],
      ),
    );

    await check("27. level with progress cannot be deleted", () =>
      expectConstraint(
        () => prisma.levelDefinition.delete({ where: { id: levelA1.id } }),
        "progress level delete",
        ["P2003"],
      ),
    );

    await check("28. V1 CRUD remains operational", async () => {
      const level = await prisma.level.create({
        data: { number: 991, title: "V1 compatibility", requiredXp: 0, status: "locked" },
      });
      assert.equal((await prisma.level.findUniqueOrThrow({ where: { id: level.id } })).title, "V1 compatibility");
      await prisma.level.delete({ where: { id: level.id } });
    });

    assert.equal(restrictEnrollment.status, "active");
  } finally {
    await prisma.$disconnect();
    cleanupDb();
  }

  await check("29. temporary DB and journals are removed", () => {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      assert.equal(fs.existsSync(`${dbPath}${suffix}`), false, `leftover ${dbPath}${suffix}`);
    }
  });
}

main()
  .then(() => {
    console.log(`\ncurriculum enrollment schema regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    cleanupDb();
    console.error(error);
    console.log(`\ncurriculum enrollment schema regression: ${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
