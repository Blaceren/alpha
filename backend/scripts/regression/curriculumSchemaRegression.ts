import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

// Phase 1B.1 regression: curriculum versioning schema foundation.
//
// Runs the full migration chain from scratch against an isolated throwaway
// SQLite database in the system temp directory (never a production path),
// then proves the V2 curriculum tables, unique constraints, composite
// cross-version protection, Restrict delete behaviour and the partial
// published-uniqueness index — and that V1 tables are intact.

const dbPath = `/tmp/ata-curriculum-schema-regression-${process.pid}.db`;
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

function isConstraintError(error: unknown, codes: string[] = ["P2002", "P2003"]) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return codes.includes(error.code);
  }
  return error instanceof Error && /constraint/i.test(error.message);
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

  // 1-2. Apply the full migration chain from scratch with the existing runner.
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
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
    ).map((row) => row.name);

    await check("new curriculum tables exist", () => {
      for (const table of ["CurriculumVersion", "ModuleDefinition", "LevelDefinition"]) {
        assert.equal(tables.includes(table), true, `missing table ${table}`);
      }
    });

    await check("core V1 tables survived the chain", () => {
      for (const table of ["User", "Task", "Level", "UserTaskProgress", "Checkpoint", "XpEvent"]) {
        assert.equal(tables.includes(table), true, `missing V1 table ${table}`);
      }
    });

    // 5. User + draft version with createdBy.
    const user = await prisma.user.create({
      data: { email: "curriculum-regression@example.com", name: "Curriculum Regression" },
    });

    const versionA = await prisma.curriculumVersion.create({
      data: {
        code: "ata-main",
        name: "ATA Curriculum V2",
        versionNumber: 1,
        createdById: user.id,
        changeNotes: "phase 1b.1 regression draft",
      },
    });

    await check("draft CurriculumVersion created with createdBy", () => {
      assert.equal(versionA.status, "draft");
      assert.equal(versionA.createdById, user.id);
      assert.equal(versionA.publishedAt, null);
    });

    // 6. ModuleDefinition.
    const moduleA1 = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: versionA.id,
        moduleNumber: 1,
        code: "m01-first-steps",
        title: "First steps",
        firstLevel: 1,
        lastLevel: 4,
        checkpointLevel: 4,
      },
    });

    await check("ModuleDefinition created inside version A", () => {
      assert.equal(moduleA1.curriculumVersionId, versionA.id);
      assert.equal(moduleA1.status, "active");
    });

    // 7. LevelDefinition with correct composite relation.
    const levelA1 = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: versionA.id,
        moduleId: moduleA1.id,
        levelNumber: 1,
        stableCode: "v2.l001.pocket-registration",
        type: "external_event",
        title: "Pocket registration",
        completionMethod: "pocket_postback",
        xpReward: 15,
        requiredXp: 0,
      },
    });

    await check("LevelDefinition created with valid composite module link", () => {
      assert.equal(levelA1.curriculumVersionId, versionA.id);
      assert.equal(levelA1.moduleId, moduleA1.id);
      assert.equal(levelA1.visibilityRule, null);
    });

    // 8. Duplicate (code, versionNumber).
    await check("duplicate (code, versionNumber) rejected", () =>
      expectConstraint(
        () =>
          prisma.curriculumVersion.create({
            data: { code: "ata-main", name: "dup", versionNumber: 1 },
          }),
        "duplicate code+versionNumber",
        ["P2002"],
      ),
    );

    // 9. Duplicate moduleNumber inside one version.
    await check("duplicate moduleNumber within a version rejected", () =>
      expectConstraint(
        () =>
          prisma.moduleDefinition.create({
            data: {
              curriculumVersionId: versionA.id,
              moduleNumber: 1,
              code: "m01-duplicate",
              title: "dup",
              firstLevel: 5,
              lastLevel: 8,
            },
          }),
        "duplicate moduleNumber",
        ["P2002"],
      ),
    );

    // 10. Same moduleNumber allowed in another version.
    const versionB = await prisma.curriculumVersion.create({
      data: { code: "ata-main", name: "ATA Curriculum V2 draft 2", versionNumber: 2 },
    });
    const moduleB1 = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: versionB.id,
        moduleNumber: 1,
        code: "m01-first-steps",
        title: "First steps (v2 draft)",
        firstLevel: 1,
        lastLevel: 4,
      },
    });

    await check("same moduleNumber and module code allowed in another version", () => {
      assert.equal(moduleB1.moduleNumber, moduleA1.moduleNumber);
      assert.equal(moduleB1.code, moduleA1.code);
    });

    // 11. Duplicate levelNumber inside a version.
    await check("duplicate levelNumber within a version rejected", () =>
      expectConstraint(
        () =>
          prisma.levelDefinition.create({
            data: {
              curriculumVersionId: versionA.id,
              moduleId: moduleA1.id,
              levelNumber: 1,
              stableCode: "v2.l001.duplicate-number",
              type: "lesson",
              title: "dup",
              completionMethod: "manual",
            },
          }),
        "duplicate levelNumber",
        ["P2002"],
      ),
    );

    // 12. Duplicate stableCode inside a version.
    await check("duplicate stableCode within a version rejected", () =>
      expectConstraint(
        () =>
          prisma.levelDefinition.create({
            data: {
              curriculumVersionId: versionA.id,
              moduleId: moduleA1.id,
              levelNumber: 2,
              stableCode: "v2.l001.pocket-registration",
              type: "lesson",
              title: "dup",
              completionMethod: "manual",
            },
          }),
        "duplicate stableCode",
        ["P2002"],
      ),
    );

    // 13. Same stableCode allowed in another version.
    const levelB1 = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: versionB.id,
        moduleId: moduleB1.id,
        levelNumber: 1,
        stableCode: "v2.l001.pocket-registration",
        type: "external_event",
        title: "Pocket registration",
        completionMethod: "pocket_postback",
      },
    });

    await check("same stableCode allowed in another version", () => {
      assert.equal(levelB1.stableCode, levelA1.stableCode);
      assert.notEqual(levelB1.curriculumVersionId, levelA1.curriculumVersionId);
    });

    // 14. Cross-version module mismatch rejected by composite FK.
    await check("level pointing to a module of another version rejected", () =>
      expectConstraint(
        () =>
          prisma.levelDefinition.create({
            data: {
              curriculumVersionId: versionB.id,
              moduleId: moduleA1.id,
              levelNumber: 3,
              stableCode: "v2.l003.cross-version-mismatch",
              type: "lesson",
              title: "mismatch",
              completionMethod: "manual",
            },
          }),
        "cross-version module mismatch",
        ["P2003"],
      ),
    );

    // 15. Multiple drafts of the same code allowed.
    await check("multiple draft versions of one code allowed", async () => {
      const drafts = await prisma.curriculumVersion.count({
        where: { code: "ata-main", status: "draft" },
      });
      assert.equal(drafts >= 2, true, `expected >=2 drafts, got ${drafts}`);
    });

    // 16-17. Published/archived uniqueness semantics.
    const versionC = await prisma.curriculumVersion.create({
      data: { code: "ata-main", name: "v3", versionNumber: 3 },
    });
    const versionD = await prisma.curriculumVersion.create({
      data: { code: "ata-main", name: "v4", versionNumber: 4 },
    });

    await prisma.curriculumVersion.update({
      where: { id: versionC.id },
      data: { status: "archived" },
    });
    await prisma.curriculumVersion.update({
      where: { id: versionD.id },
      data: { status: "archived" },
    });

    await check("multiple archived versions of one code allowed", async () => {
      const archived = await prisma.curriculumVersion.count({
        where: { code: "ata-main", status: "archived" },
      });
      assert.equal(archived, 2);
    });

    await prisma.curriculumVersion.update({
      where: { id: versionA.id },
      data: { status: "published", publishedAt: new Date() },
    });

    await check("second published version of one code rejected (partial unique index)", () =>
      expectConstraint(
        () =>
          prisma.curriculumVersion.update({
            where: { id: versionB.id },
            data: { status: "published", publishedAt: new Date() },
          }),
        "second published version",
        ["P2002"],
      ),
    );

    await check("failed publish attempt left version B unchanged", async () => {
      const fresh = await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: versionB.id } });
      assert.equal(fresh.status, "draft");
    });

    await check("published version of a different code is allowed", async () => {
      const other = await prisma.curriculumVersion.create({
        data: { code: "ata-side-track", name: "side", versionNumber: 1, status: "published", publishedAt: new Date() },
      });
      assert.equal(other.status, "published");
    });

    // 18. SetNull for createdBy.
    await prisma.user.delete({ where: { id: user.id } });

    await check("createdBy becomes null after user deletion (SetNull)", async () => {
      const fresh = await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: versionA.id } });
      assert.equal(fresh.createdById, null);
    });

    // 19. Restrict: version with modules cannot be deleted.
    await check("deleting a CurriculumVersion with modules is restricted", () =>
      expectConstraint(
        () => prisma.curriculumVersion.delete({ where: { id: versionA.id } }),
        "restrict version delete",
        ["P2003"],
      ),
    );

    // 20. Restrict: module with levels cannot be deleted.
    await check("deleting a ModuleDefinition with levels is restricted", () =>
      expectConstraint(
        () => prisma.moduleDefinition.delete({ where: { id: moduleA1.id } }),
        "restrict module delete",
        ["P2003"],
      ),
    );

    await check("explicit bottom-up delete works (levels, then module, then version)", async () => {
      await prisma.levelDefinition.deleteMany({ where: { curriculumVersionId: versionB.id } });
      await prisma.moduleDefinition.deleteMany({ where: { curriculumVersionId: versionB.id } });
      await prisma.curriculumVersion.delete({ where: { id: versionB.id } });
      const gone = await prisma.curriculumVersion.findUnique({ where: { id: versionB.id } });
      assert.equal(gone, null);
    });

    // 21. V1 schema is still queryable through the Prisma client.
    await check("V1 Task/Level/UserTaskProgress schema is accessible", async () => {
      assert.deepEqual(await prisma.task.findMany(), []);
      assert.deepEqual(await prisma.level.findMany(), []);
      assert.deepEqual(await prisma.userTaskProgress.findMany(), []);
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
  }
}

main()
  .then(() => {
    console.log(`\ncurriculum schema regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    cleanupDb();
    console.error(error);
    console.log(`\ncurriculum schema regression: ${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
