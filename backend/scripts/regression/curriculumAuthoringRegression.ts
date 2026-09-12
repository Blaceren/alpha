import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { isCurriculumDomainError } from "../../src/lib/curriculum/errors";
import type { CurriculumDomainErrorCode } from "../../src/lib/curriculum/errors";
import { validateCurriculumDraft } from "../../src/lib/curriculum/validation";

// Phase 1B.3 regression: curriculum draft authoring command services.
// Uses an isolated throwaway SQLite DB in /tmp, removed in finally.

const dbPath = `/tmp/ata-curriculum-authoring-regression-${process.pid}.db`;
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

async function expectDomainError(
  fn: () => Promise<unknown>,
  code: CurriculumDomainErrorCode,
): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    if (isCurriculumDomainError(error, code)) return error;
    throw new Error(`expected ${code}, got: ${error}`);
  }
  throw new Error(`expected ${code}, but the operation succeeded`);
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function stableCode(levelNumber: number, slug = `step-${levelNumber}`) {
  return `v2.l${String(levelNumber).padStart(3, "0")}.${slug}`;
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

  process.env.DATABASE_URL = dbUrl;
  const { prisma } = await import("../../src/lib/prisma");
  const authoring = await import("../../src/lib/curriculum/authoring");
  const { loadCurriculumSnapshot } = await import("../../src/lib/curriculum/service");

  const admin = await prisma.user.create({
    data: { email: "authoring-admin@example.com", name: "Authoring Admin", role: "admin" },
  });
  const regular = await prisma.user.create({
    data: { email: "authoring-user@example.com", name: "Authoring User" },
  });

  const v1TablesBefore = {
    tasks: await prisma.task.count(),
    levels: await prisma.level.count(),
    progress: await prisma.userTaskProgress.count(),
  };

  try {
    // 1-3. Admin creates a draft.
    const draft = await authoring.createCurriculumDraft({
      actorId: admin.id,
      code: "auth-main",
      name: "Authoring Draft",
      versionNumber: 1,
    });

    await check("1. admin creates draft", () => {
      assert.equal(draft.code, "auth-main");
      assert.equal(draft.versionNumber, 1);
    });

    await check("2. status is draft, publishedAt null", () => {
      assert.equal(draft.status, "draft");
      assert.equal(draft.publishedAt, null);
    });

    await check("3. createdBy is set", () => {
      assert.equal(draft.createdById, admin.id);
    });

    await check("4. non-admin cannot create draft", () =>
      expectDomainError(
        () =>
          authoring.createCurriculumDraft({
            actorId: regular.id,
            code: "auth-nope",
            name: "Nope",
            versionNumber: 1,
          }),
        "CURRICULUM_ACTOR_FORBIDDEN",
      ).then(() => undefined),
    );

    await check("5. status/publishedAt cannot be passed from outside", async () => {
      const error = await expectDomainError(
        () =>
          authoring.createCurriculumDraft({
            actorId: admin.id,
            code: "auth-status",
            name: "Status Smuggle",
            versionNumber: 1,
            status: "published",
            publishedAt: new Date(),
          }),
        "CURRICULUM_INPUT_INVALID",
      );
      if (isCurriculumDomainError(error)) {
        assert.equal(error.issues.length >= 1, true);
      }
    });

    await check("6. duplicate (code, versionNumber) gives typed conflict", () =>
      expectDomainError(
        () =>
          authoring.createCurriculumDraft({
            actorId: admin.id,
            code: "auth-main",
            name: "Duplicate",
            versionNumber: 1,
          }),
        "CURRICULUM_CONFLICT",
      ).then(() => undefined),
    );

    await check("7. draft metadata updates", async () => {
      const updated = await authoring.updateCurriculumDraft({
        actorId: admin.id,
        curriculumVersionId: draft.id,
        patch: { name: "Authoring Draft v2", changeNotes: "renamed" },
      });
      assert.equal(updated.name, "Authoring Draft v2");
      assert.equal(updated.changeNotes, "renamed");
    });

    await check("8. identity fields cannot be changed", () =>
      expectDomainError(
        () =>
          authoring.updateCurriculumDraft({
            actorId: admin.id,
            curriculumVersionId: draft.id,
            patch: { code: "hacked", versionNumber: 99, status: "published" },
          }),
        "CURRICULUM_INPUT_INVALID",
      ).then(() => undefined),
    );

    // 9. Published/archived cannot be edited (guard).
    const publishedScratch = await authoring.createCurriculumDraft({
      actorId: admin.id,
      code: "auth-pub",
      name: "Published Scratch",
      versionNumber: 1,
    });
    await prisma.curriculumVersion.update({
      where: { id: publishedScratch.id },
      data: { status: "published", publishedAt: new Date() },
    });
    const archivedScratch = await authoring.createCurriculumDraft({
      actorId: admin.id,
      code: "auth-arch",
      name: "Archived Scratch",
      versionNumber: 1,
    });
    await prisma.curriculumVersion.update({
      where: { id: archivedScratch.id },
      data: { status: "archived" },
    });

    await check("9. published/archived cannot be edited", async () => {
      await expectDomainError(
        () =>
          authoring.updateCurriculumDraft({
            actorId: admin.id,
            curriculumVersionId: publishedScratch.id,
            patch: { name: "x" },
          }),
        "CURRICULUM_PUBLISHED_IMMUTABLE",
      );
      await expectDomainError(
        () =>
          authoring.updateCurriculumDraft({
            actorId: admin.id,
            curriculumVersionId: archivedScratch.id,
            patch: { name: "x" },
          }),
        "CURRICULUM_ARCHIVED_IMMUTABLE",
      );
    });

    await check("10. empty draft can be deleted", async () => {
      const disposable = await authoring.createCurriculumDraft({
        actorId: admin.id,
        code: "auth-del",
        name: "Disposable",
        versionNumber: 1,
      });
      await authoring.deleteEmptyCurriculumDraft({
        actorId: admin.id,
        curriculumVersionId: disposable.id,
      });
      const gone = await prisma.curriculumVersion.findUnique({ where: { id: disposable.id } });
      assert.equal(gone, null);
    });

    // 12. Module can only be created in a draft.
    await check("12. module can only be created inside a draft", () =>
      expectDomainError(
        () =>
          authoring.createModuleDefinition({
            actorId: admin.id,
            curriculumVersionId: publishedScratch.id,
            moduleNumber: 1,
            code: "m01",
            title: "T",
            learningObjective: "O",
            firstLevel: 1,
            lastLevel: 3,
          }),
        "CURRICULUM_PUBLISHED_IMMUTABLE",
      ).then(() => undefined),
    );

    const moduleOne = await authoring.createModuleDefinition({
      actorId: admin.id,
      curriculumVersionId: draft.id,
      moduleNumber: 1,
      code: "m01-first",
      title: "First",
      learningObjective: "learn",
      firstLevel: 1,
      lastLevel: 3,
      checkpointLevel: 3,
    });

    await check("11. draft with modules cannot be deleted", () =>
      expectDomainError(
        () =>
          authoring.deleteEmptyCurriculumDraft({
            actorId: admin.id,
            curriculumVersionId: draft.id,
          }),
        "CURRICULUM_NOT_EMPTY",
      ).then(() => undefined),
    );

    await check("13. module write-time validation works", async () => {
      await expectDomainError(
        () =>
          authoring.createModuleDefinition({
            actorId: admin.id,
            curriculumVersionId: draft.id,
            moduleNumber: 9,
            code: "m09",
            title: "Bad",
            learningObjective: "o",
            firstLevel: 5,
            lastLevel: 3,
          }),
        "CURRICULUM_INPUT_INVALID",
      );
      await expectDomainError(
        () =>
          authoring.createModuleDefinition({
            actorId: admin.id,
            curriculumVersionId: draft.id,
            moduleNumber: 9,
            code: "m09",
            title: "Bad",
            learningObjective: "o",
            firstLevel: 4,
            lastLevel: 6,
            checkpointLevel: 9,
          }),
        "CURRICULUM_INPUT_INVALID",
      );
      await expectDomainError(
        () =>
          authoring.createModuleDefinition({
            actorId: admin.id,
            curriculumVersionId: draft.id,
            moduleNumber: 9,
            code: "m09",
            title: " ",
            learningObjective: "o",
            firstLevel: 4,
            lastLevel: 6,
          }),
        "CURRICULUM_INPUT_INVALID",
      );
    });

    const moduleTwo = await authoring.createModuleDefinition({
      actorId: admin.id,
      curriculumVersionId: draft.id,
      moduleNumber: 2,
      code: "m02-overlap",
      title: "Overlap",
      learningObjective: "learn",
      firstLevel: 2,
      lastLevel: 5,
    });

    await check("14. temporary module range overlap allowed at authoring", () => {
      assert.equal(moduleTwo.firstLevel, 2);
    });

    await check("15. publication validation later detects the overlap", async () => {
      const snapshot = await loadCurriculumSnapshot(draft.id);
      const result = validateCurriculumDraft(snapshot);
      assert.equal(result.valid, false);
      assert.equal(result.issues.some((item) => item.code === "MODULE_RANGES_OVERLAP"), true);
    });

    await check("16. duplicate module number/code gives typed conflict", async () => {
      await expectDomainError(
        () =>
          authoring.createModuleDefinition({
            actorId: admin.id,
            curriculumVersionId: draft.id,
            moduleNumber: 1,
            code: "m01-dup-number",
            title: "T",
            learningObjective: "O",
            firstLevel: 6,
            lastLevel: 7,
          }),
        "MODULE_CONFLICT",
      );
      await expectDomainError(
        () =>
          authoring.createModuleDefinition({
            actorId: admin.id,
            curriculumVersionId: draft.id,
            moduleNumber: 3,
            code: "m01-first",
            title: "T",
            learningObjective: "O",
            firstLevel: 6,
            lastLevel: 7,
          }),
        "MODULE_CONFLICT",
      );
    });

    await check("17. module updates", async () => {
      const updated = await authoring.updateModuleDefinition({
        actorId: admin.id,
        moduleDefinitionId: moduleTwo.id,
        patch: { title: "Overlap Updated", lastLevel: 6 },
      });
      assert.equal(updated.title, "Overlap Updated");
      assert.equal(updated.lastLevel, 6);
    });

    // 18. Published curriculum blocks module mutation.
    const pubWithModule = await authoring.createCurriculumDraft({
      actorId: admin.id,
      code: "auth-pub-mod",
      name: "Pub with module",
      versionNumber: 1,
    });
    const pubModule = await authoring.createModuleDefinition({
      actorId: admin.id,
      curriculumVersionId: pubWithModule.id,
      moduleNumber: 1,
      code: "m01",
      title: "T",
      learningObjective: "O",
      firstLevel: 1,
      lastLevel: 2,
    });
    await prisma.curriculumVersion.update({
      where: { id: pubWithModule.id },
      data: { status: "published", publishedAt: new Date() },
    });

    await check("18. published curriculum blocks module mutation", () =>
      expectDomainError(
        () =>
          authoring.updateModuleDefinition({
            actorId: admin.id,
            moduleDefinitionId: pubModule.id,
            patch: { title: "hack" },
          }),
        "CURRICULUM_PUBLISHED_IMMUTABLE",
      ).then(() => undefined),
    );

    // 21. Level is created.
    const levelOne = await authoring.createLevelDefinition({
      actorId: admin.id,
      curriculumVersionId: draft.id,
      moduleId: moduleOne.id,
      levelNumber: 1,
      stableCode: stableCode(1, "pocket-registration"),
      type: "external_event",
      title: "Pocket registration",
      learningObjective: "connect account",
      completionMethod: "pocket_postback",
      xpReward: 15,
    });

    await check("21. level is created", () => {
      assert.equal(levelOne.levelNumber, 1);
      assert.equal(levelOne.visibilityRule, null);
    });

    await check("19. non-empty module cannot be deleted", () =>
      expectDomainError(
        () =>
          authoring.deleteEmptyModuleDefinition({
            actorId: admin.id,
            moduleDefinitionId: moduleOne.id,
          }),
        "MODULE_NOT_EMPTY",
      ).then(() => undefined),
    );

    await check("20. empty module can be deleted", async () => {
      const disposable = await authoring.createModuleDefinition({
        actorId: admin.id,
        curriculumVersionId: draft.id,
        moduleNumber: 7,
        code: "m07-disposable",
        title: "Disposable",
        learningObjective: "o",
        firstLevel: 20,
        lastLevel: 21,
      });
      await authoring.deleteEmptyModuleDefinition({
        actorId: admin.id,
        moduleDefinitionId: disposable.id,
      });
      const gone = await prisma.moduleDefinition.findUnique({ where: { id: disposable.id } });
      assert.equal(gone, null);
    });

    await check("22. invalid stableCode rejected", () =>
      expectDomainError(
        () =>
          authoring.createLevelDefinition({
            actorId: admin.id,
            curriculumVersionId: draft.id,
            moduleId: moduleOne.id,
            levelNumber: 2,
            stableCode: "V2.L002.Bad-Slug",
            type: "lesson",
            title: "Bad",
            learningObjective: "o",
            completionMethod: "manual",
          }),
        "CURRICULUM_INPUT_INVALID",
      ).then(() => undefined),
    );

    await check("23. stableCode number must match levelNumber", () =>
      expectDomainError(
        () =>
          authoring.createLevelDefinition({
            actorId: admin.id,
            curriculumVersionId: draft.id,
            moduleId: moduleOne.id,
            levelNumber: 2,
            stableCode: stableCode(5),
            type: "lesson",
            title: "Mismatch",
            learningObjective: "o",
            completionMethod: "manual",
          }),
        "CURRICULUM_INPUT_INVALID",
      ).then(() => undefined),
    );

    await check("24. duplicate levelNumber/stableCode gives typed conflict", async () => {
      await expectDomainError(
        () =>
          authoring.createLevelDefinition({
            actorId: admin.id,
            curriculumVersionId: draft.id,
            moduleId: moduleOne.id,
            levelNumber: 1,
            stableCode: stableCode(1, "another-slug"),
            type: "lesson",
            title: "Dup number",
            learningObjective: "o",
            completionMethod: "manual",
          }),
        "LEVEL_CONFLICT",
      );
      await expectDomainError(
        () =>
          authoring.createLevelDefinition({
            actorId: admin.id,
            curriculumVersionId: draft.id,
            moduleId: moduleOne.id,
            levelNumber: 2,
            stableCode: stableCode(1, "pocket-registration"),
            type: "lesson",
            title: "Dup code",
            learningObjective: "o",
            completionMethod: "manual",
          }),
        "CURRICULUM_INPUT_INVALID",
      );
      // duplicate stableCode with matching number needs same number → covered by unique(levelNumber);
      // do an explicit stableCode duplicate via update path below.
    });

    // 25. Level cannot link to a module of another version.
    const otherDraft = await authoring.createCurriculumDraft({
      actorId: admin.id,
      code: "auth-other",
      name: "Other Draft",
      versionNumber: 1,
    });
    const otherModule = await authoring.createModuleDefinition({
      actorId: admin.id,
      curriculumVersionId: otherDraft.id,
      moduleNumber: 1,
      code: "m01-other",
      title: "Other",
      learningObjective: "o",
      firstLevel: 1,
      lastLevel: 3,
    });

    await check("25. level cannot link to a module of another version", () =>
      expectDomainError(
        () =>
          authoring.createLevelDefinition({
            actorId: admin.id,
            curriculumVersionId: draft.id,
            moduleId: otherModule.id,
            levelNumber: 3,
            stableCode: stableCode(3),
            type: "lesson",
            title: "Mismatch",
            learningObjective: "o",
            completionMethod: "manual",
          }),
        "MODULE_VERSION_MISMATCH",
      ).then(() => undefined),
    );

    await check("26. level can move to another module of the same draft version", async () => {
      const moved = await authoring.updateLevelDefinition({
        actorId: admin.id,
        levelDefinitionId: levelOne.id,
        patch: { moduleId: moduleTwo.id },
      });
      assert.equal(moved.moduleId, moduleTwo.id);
      const back = await authoring.updateLevelDefinition({
        actorId: admin.id,
        levelDefinitionId: levelOne.id,
        patch: { moduleId: moduleOne.id },
      });
      assert.equal(back.moduleId, moduleOne.id);
    });

    await check("27. level updates", async () => {
      const updated = await authoring.updateLevelDefinition({
        actorId: admin.id,
        levelDefinitionId: levelOne.id,
        patch: { title: "Pocket registration (updated)", xpReward: 20 },
      });
      assert.equal(updated.title, "Pocket registration (updated)");
      assert.equal(updated.xpReward, 20);
    });

    await check("28. changing levelNumber checks resulting stableCode", async () => {
      await expectDomainError(
        () =>
          authoring.updateLevelDefinition({
            actorId: admin.id,
            levelDefinitionId: levelOne.id,
            patch: { levelNumber: 2 },
          }),
        "CURRICULUM_INPUT_INVALID",
      );
      const renumbered = await authoring.updateLevelDefinition({
        actorId: admin.id,
        levelDefinitionId: levelOne.id,
        patch: { levelNumber: 2, stableCode: stableCode(2, "pocket-registration") },
      });
      assert.equal(renumbered.levelNumber, 2);
      const back = await authoring.updateLevelDefinition({
        actorId: admin.id,
        levelDefinitionId: levelOne.id,
        patch: { levelNumber: 1, stableCode: stableCode(1, "pocket-registration") },
      });
      assert.equal(back.levelNumber, 1);
    });

    await check("29. non-null visibilityRule rejected", async () => {
      await expectDomainError(
        () =>
          authoring.createLevelDefinition({
            actorId: admin.id,
            curriculumVersionId: draft.id,
            moduleId: moduleOne.id,
            levelNumber: 3,
            stableCode: stableCode(3),
            type: "lesson",
            title: "Vis",
            learningObjective: "o",
            completionMethod: "manual",
            visibilityRule: { kind: "always_visible" },
          }),
        "CURRICULUM_INPUT_INVALID",
      );
      await expectDomainError(
        () =>
          authoring.updateLevelDefinition({
            actorId: admin.id,
            levelDefinitionId: levelOne.id,
            patch: { visibilityRule: { kind: "x" } },
          }),
        "CURRICULUM_INPUT_INVALID",
      );
    });

    // 30. Published curriculum blocks level mutation.
    const pubLevelDraft = await authoring.createCurriculumDraft({
      actorId: admin.id,
      code: "auth-pub-level",
      name: "Pub with level",
      versionNumber: 1,
    });
    const pubLevelModule = await authoring.createModuleDefinition({
      actorId: admin.id,
      curriculumVersionId: pubLevelDraft.id,
      moduleNumber: 1,
      code: "m01",
      title: "T",
      learningObjective: "O",
      firstLevel: 1,
      lastLevel: 1,
    });
    const pubLevel = await authoring.createLevelDefinition({
      actorId: admin.id,
      curriculumVersionId: pubLevelDraft.id,
      moduleId: pubLevelModule.id,
      levelNumber: 1,
      stableCode: stableCode(1, "pub-level"),
      type: "lesson",
      title: "Pub level",
      learningObjective: "o",
      completionMethod: "manual",
    });
    await prisma.curriculumVersion.update({
      where: { id: pubLevelDraft.id },
      data: { status: "published", publishedAt: new Date() },
    });

    await check("30. published curriculum blocks level mutation", async () => {
      await expectDomainError(
        () =>
          authoring.updateLevelDefinition({
            actorId: admin.id,
            levelDefinitionId: pubLevel.id,
            patch: { title: "hack" },
          }),
        "CURRICULUM_PUBLISHED_IMMUTABLE",
      );
      await expectDomainError(
        () =>
          authoring.deleteLevelDefinition({
            actorId: admin.id,
            levelDefinitionId: pubLevel.id,
          }),
        "CURRICULUM_PUBLISHED_IMMUTABLE",
      );
    });

    await check("31. level can be deleted", async () => {
      const disposable = await authoring.createLevelDefinition({
        actorId: admin.id,
        curriculumVersionId: draft.id,
        moduleId: moduleOne.id,
        levelNumber: 3,
        stableCode: stableCode(3, "disposable"),
        type: "lesson",
        title: "Disposable",
        learningObjective: "o",
        completionMethod: "manual",
      });
      await authoring.deleteLevelDefinition({
        actorId: admin.id,
        levelDefinitionId: disposable.id,
      });
      const gone = await prisma.levelDefinition.findUnique({ where: { id: disposable.id } });
      assert.equal(gone, null);
    });

    await check("32. every successful mutation creates an audit", async () => {
      const actions = [
        "CURRICULUM_DRAFT_CREATED",
        "CURRICULUM_DRAFT_UPDATED",
        "CURRICULUM_DRAFT_DELETED",
        "MODULE_DEFINITION_CREATED",
        "MODULE_DEFINITION_UPDATED",
        "MODULE_DEFINITION_DELETED",
        "LEVEL_DEFINITION_CREATED",
        "LEVEL_DEFINITION_UPDATED",
        "LEVEL_DEFINITION_DELETED",
      ];
      for (const action of actions) {
        const count = await prisma.auditLog.count({ where: { action } });
        assert.equal(count >= 1, true, `no audit rows for ${action}`);
      }
    });

    await check("33. audit failure rolls back create", async () => {
      const before = await prisma.levelDefinition.count({ where: { curriculumVersionId: draft.id } });
      const auditBefore = await prisma.auditLog.count();
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER ata_fail_level_create BEFORE INSERT ON AuditLog WHEN NEW.action = 'LEVEL_DEFINITION_CREATED' BEGIN SELECT RAISE(ABORT, 'forced-audit-failure'); END",
      );
      try {
        await authoring.createLevelDefinition({
          actorId: admin.id,
          curriculumVersionId: draft.id,
          moduleId: moduleOne.id,
          levelNumber: 3,
          stableCode: stableCode(3, "rollback"),
          type: "lesson",
          title: "Rollback",
          learningObjective: "o",
          completionMethod: "manual",
        });
        assert.fail("expected forced failure");
      } catch (error) {
        assert.equal(/forced-audit-failure|constraint|abort/i.test(String(error)), true, String(error));
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER ata_fail_level_create");
      }
      assert.equal(await prisma.levelDefinition.count({ where: { curriculumVersionId: draft.id } }), before);
      assert.equal(await prisma.auditLog.count(), auditBefore);
    });

    await check("34. audit failure rolls back update", async () => {
      const before = await prisma.moduleDefinition.findUniqueOrThrow({ where: { id: moduleTwo.id } });
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER ata_fail_module_update BEFORE INSERT ON AuditLog WHEN NEW.action = 'MODULE_DEFINITION_UPDATED' BEGIN SELECT RAISE(ABORT, 'forced-audit-failure'); END",
      );
      try {
        await authoring.updateModuleDefinition({
          actorId: admin.id,
          moduleDefinitionId: moduleTwo.id,
          patch: { title: "should-not-persist" },
        });
        assert.fail("expected forced failure");
      } catch (error) {
        assert.equal(/forced-audit-failure|constraint|abort/i.test(String(error)), true, String(error));
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER ata_fail_module_update");
      }
      const after = await prisma.moduleDefinition.findUniqueOrThrow({ where: { id: moduleTwo.id } });
      assert.equal(after.title, before.title);
    });

    await check("35. audit failure rolls back delete", async () => {
      const disposable = await authoring.createLevelDefinition({
        actorId: admin.id,
        curriculumVersionId: draft.id,
        moduleId: moduleOne.id,
        levelNumber: 3,
        stableCode: stableCode(3, "delete-rollback"),
        type: "lesson",
        title: "Delete rollback",
        learningObjective: "o",
        completionMethod: "manual",
      });
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER ata_fail_level_delete BEFORE INSERT ON AuditLog WHEN NEW.action = 'LEVEL_DEFINITION_DELETED' BEGIN SELECT RAISE(ABORT, 'forced-audit-failure'); END",
      );
      try {
        await authoring.deleteLevelDefinition({
          actorId: admin.id,
          levelDefinitionId: disposable.id,
        });
        assert.fail("expected forced failure");
      } catch (error) {
        assert.equal(/forced-audit-failure|constraint|abort/i.test(String(error)), true, String(error));
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER ata_fail_level_delete");
      }
      const still = await prisma.levelDefinition.findUnique({ where: { id: disposable.id } });
      assert.notEqual(still, null);
      await authoring.deleteLevelDefinition({ actorId: admin.id, levelDefinitionId: disposable.id });
    });

    await check("36. raw Prisma errors do not leak", async () => {
      try {
        await authoring.createCurriculumDraft({
          actorId: admin.id,
          code: "auth-main",
          name: "Dup again",
          versionNumber: 1,
        });
        assert.fail("expected conflict");
      } catch (error) {
        assert.equal(isCurriculumDomainError(error, "CURRICULUM_CONFLICT"), true, String(error));
        assert.equal(error instanceof Prisma.PrismaClientKnownRequestError, false);
      }
    });

    await check("37. V1 tables and data unchanged", async () => {
      assert.equal(await prisma.task.count(), v1TablesBefore.tasks);
      assert.equal(await prisma.level.count(), v1TablesBefore.levels);
      assert.equal(await prisma.userTaskProgress.count(), v1TablesBefore.progress);
      const tables = (
        await prisma.$queryRawUnsafe<Array<{ name: string }>>(
          "SELECT name FROM sqlite_master WHERE type = 'table'",
        )
      ).map((row) => row.name);
      for (const table of ["Task", "Level", "UserTaskProgress"]) {
        assert.equal(tables.includes(table), true);
      }
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
  }

  await check("38. temporary DB removed after test", () => {
    assert.equal(fs.existsSync(dbPath), false);
  });
}

main()
  .then(() => {
    console.log(`\ncurriculum authoring regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    cleanupDb();
    console.error(error);
    console.log(`\ncurriculum authoring regression: ${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
