import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  CurriculumVersion,
  LevelDefinition,
  ModuleDefinition,
} from "@prisma/client";
import { isCurriculumDomainError } from "../../src/lib/curriculum/errors";
import type { CurriculumDomainErrorCode } from "../../src/lib/curriculum/errors";
import type { CurriculumDraftSnapshot } from "../../src/lib/curriculum/types";
import { validateCurriculumDraft } from "../../src/lib/curriculum/validation";

// Phase 1B.2 regression: curriculum domain validation and publication lifecycle.
// Part A exercises the pure validator fully in memory.
// Part B uses an isolated throwaway SQLite DB in /tmp (removed in finally).

const dbPath = `/tmp/ata-curriculum-domain-regression-${process.pid}.db`;
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
) {
  try {
    await fn();
  } catch (error) {
    if (isCurriculumDomainError(error, code)) return;
    throw new Error(`expected ${code}, got: ${error}`);
  }
  throw new Error(`expected ${code}, but the operation succeeded`);
}

function hasIssue(result: { issues: Array<{ code: string }> }, code: string) {
  return result.issues.some((item) => item.code === code);
}

// ---------- In-memory snapshot builders (Part A) ----------

function stableCode(levelNumber: number, slug = `step-${levelNumber}`) {
  return `v2.l${String(levelNumber).padStart(3, "0")}.${slug}`;
}

function makeVersion(over: Partial<CurriculumVersion> = {}): CurriculumVersion {
  return {
    id: 1,
    code: "ata-main",
    name: "ATA Curriculum V2",
    status: "draft",
    versionNumber: 1,
    effectiveFrom: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    publishedAt: null,
    createdById: null,
    changeNotes: null,
    ...over,
  };
}

function makeModule(over: Partial<ModuleDefinition> = {}): ModuleDefinition {
  return {
    id: 1,
    curriculumVersionId: 1,
    moduleNumber: 1,
    code: "m01-first-steps",
    title: "First steps",
    description: "",
    firstLevel: 1,
    lastLevel: 3,
    checkpointLevel: 3,
    learningObjective: "learn the basics",
    status: "active",
    ...over,
  };
}

function makeLevel(over: Partial<LevelDefinition> = {}): LevelDefinition {
  const levelNumber = over.levelNumber ?? 1;
  return {
    id: levelNumber,
    curriculumVersionId: 1,
    moduleId: 1,
    levelNumber,
    stableCode: stableCode(levelNumber),
    type: "lesson",
    title: `Level ${levelNumber}`,
    shortDescription: "",
    learningObjective: `objective ${levelNumber}`,
    completionMethod: "manual",
    xpReward: 10,
    requiredXp: 0,
    requiredPreviousLevel: levelNumber === 1 ? null : levelNumber - 1,
    requiredCheckpointLevel: null,
    featureUnlockCode: null,
    visibilityRule: null,
    status: "active",
    ...over,
  };
}

function makeValidSnapshot(): CurriculumDraftSnapshot {
  const version = makeVersion();
  const moduleOne = makeModule();
  const moduleTwo = makeModule({
    id: 2,
    moduleNumber: 2,
    code: "m02-next-steps",
    firstLevel: 4,
    lastLevel: 5,
    checkpointLevel: 5,
  });
  const levels = [
    makeLevel({ levelNumber: 1, type: "external_event", completionMethod: "pocket_postback" }),
    makeLevel({ levelNumber: 2 }),
    makeLevel({ levelNumber: 3, type: "financial_checkpoint", completionMethod: "balance_check" }),
    makeLevel({ levelNumber: 4, moduleId: 2, requiredCheckpointLevel: 3 }),
    makeLevel({ levelNumber: 5, moduleId: 2, type: "financial_checkpoint", completionMethod: "balance_check" }),
  ];
  return { version, modules: [moduleOne, moduleTwo], levels };
}

function mutate(
  build: (snapshot: CurriculumDraftSnapshot) => void,
): CurriculumDraftSnapshot {
  const snapshot = makeValidSnapshot();
  build(snapshot);
  return snapshot;
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

async function partA() {
  await check("1. valid draft snapshot passes validation", () => {
    const result = validateCurriculumDraft(makeValidSnapshot());
    assert.equal(result.valid, true, JSON.stringify(result.issues));
    assert.equal(result.issues.length, 0);
  });

  await check("2. validation returns multiple issues in one pass", () => {
    const snapshot = mutate((s) => {
      s.version.name = " ";
      s.levels[1].xpReward = -5;
      s.levels[4].stableCode = "broken";
    });
    const result = validateCurriculumDraft(snapshot);
    assert.equal(result.valid, false);
    assert.equal(result.issues.length >= 3, true, `expected >=3 issues, got ${result.issues.length}`);
    assert.equal(hasIssue(result, "VERSION_NAME_EMPTY"), true);
    assert.equal(hasIssue(result, "LEVEL_XP_REWARD_NEGATIVE"), true);
    assert.equal(hasIssue(result, "LEVEL_STABLE_CODE_INVALID"), true);
  });

  await check("3. stableCode with wrong number rejected", () => {
    const result = validateCurriculumDraft(
      mutate((s) => {
        s.levels[1].stableCode = stableCode(3);
      }),
    );
    assert.equal(hasIssue(result, "LEVEL_STABLE_CODE_NUMBER_MISMATCH"), true);
  });

  await check("4. stableCode with uppercase/invalid slug rejected", () => {
    const result = validateCurriculumDraft(
      mutate((s) => {
        s.levels[1].stableCode = "v2.l002.Bad-Slug";
      }),
    );
    assert.equal(hasIssue(result, "LEVEL_STABLE_CODE_INVALID"), true);
  });

  await check("5. overlapping module ranges rejected", () => {
    const result = validateCurriculumDraft(
      mutate((s) => {
        s.modules[1].firstLevel = 3;
      }),
    );
    assert.equal(hasIssue(result, "MODULE_RANGES_OVERLAP"), true);
  });

  await check("6. gap between module ranges rejected", () => {
    const result = validateCurriculumDraft(
      mutate((s) => {
        s.modules[1].firstLevel = 5;
        s.modules[1].lastLevel = 6;
      }),
    );
    assert.equal(hasIssue(result, "MODULE_RANGES_GAP"), true);
  });

  await check("7. level outside its module range rejected", () => {
    const result = validateCurriculumDraft(
      mutate((s) => {
        s.levels[1].moduleId = 2;
      }),
    );
    assert.equal(hasIssue(result, "LEVEL_OUT_OF_MODULE_RANGE"), true);
  });

  await check("8. missing level in range rejected", () => {
    const result = validateCurriculumDraft(
      mutate((s) => {
        s.levels.splice(2, 1);
      }),
    );
    assert.equal(hasIssue(result, "LEVEL_RANGE_INCOMPLETE"), true);
    assert.equal(hasIssue(result, "LEVEL_NUMBERS_NOT_SEQUENTIAL"), true);
  });

  await check("9. disabled module blocks publication", () => {
    const result = validateCurriculumDraft(
      mutate((s) => {
        s.modules[1].status = "disabled";
      }),
    );
    assert.equal(hasIssue(result, "DISABLED_MODULE_BLOCKS_PUBLICATION"), true);
  });

  await check("10. disabled level blocks publication", () => {
    const result = validateCurriculumDraft(
      mutate((s) => {
        s.levels[1].status = "disabled";
      }),
    );
    assert.equal(hasIssue(result, "DISABLED_LEVEL_BLOCKS_PUBLICATION"), true);
  });

  await check("11. wrong requiredPreviousLevel rejected", () => {
    const result = validateCurriculumDraft(
      mutate((s) => {
        s.levels[2].requiredPreviousLevel = 1;
        s.levels[0].requiredPreviousLevel = 1;
      }),
    );
    assert.equal(hasIssue(result, "LEVEL_PREVIOUS_INVALID"), true);
    assert.equal(hasIssue(result, "LEVEL_PREVIOUS_MUST_BE_NULL"), true);
  });

  await check("12. requiredCheckpointLevel pointing to a regular level rejected", () => {
    const result = validateCurriculumDraft(
      mutate((s) => {
        s.levels[3].requiredCheckpointLevel = 2;
      }),
    );
    assert.equal(hasIssue(result, "LEVEL_CHECKPOINT_NOT_FINANCIAL"), true);
  });

  await check("13. module checkpointLevel without financial_checkpoint rejected", () => {
    const result = validateCurriculumDraft(
      mutate((s) => {
        s.modules[0].checkpointLevel = 2;
      }),
    );
    assert.equal(hasIssue(result, "MODULE_CHECKPOINT_NOT_FINANCIAL"), true);
  });

  await check("14. non-null visibilityRule rejected in Phase 1", () => {
    const result = validateCurriculumDraft(
      mutate((s) => {
        s.levels[1].visibilityRule = { kind: "always_visible" };
      }),
    );
    assert.equal(hasIssue(result, "LEVEL_VISIBILITY_RULE_NOT_NULL"), true);
  });
}

// ---------- Part B: real lifecycle on an isolated temp DB ----------

async function partB() {
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
  const {
    archiveCurriculumVersion,
    assertCurriculumEditable,
    publishCurriculumVersion,
  } = await import("../../src/lib/curriculum/service");

  const admin = await prisma.user.create({
    data: { email: "domain-admin@example.com", name: "Domain Admin", role: "admin" },
  });
  const regular = await prisma.user.create({
    data: { email: "domain-user@example.com", name: "Domain User" },
  });

  async function insertCurriculum(input: {
    code: string;
    versionNumber: number;
    invalid?: boolean;
    effectiveFrom?: Date;
  }) {
    const version = await prisma.curriculumVersion.create({
      data: {
        code: input.code,
        name: `${input.code} v${input.versionNumber}`,
        versionNumber: input.versionNumber,
        createdById: admin.id,
        effectiveFrom: input.effectiveFrom ?? null,
      },
    });

    const moduleOne = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 1,
        code: "m01-first-steps",
        title: "First steps",
        firstLevel: 1,
        lastLevel: 3,
        checkpointLevel: 3,
        learningObjective: "learn the basics",
      },
    });
    const moduleTwo = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 2,
        code: "m02-next-steps",
        title: "Next steps",
        firstLevel: 4,
        lastLevel: 5,
        checkpointLevel: 5,
        learningObjective: "keep going",
      },
    });

    const levelRows = [
      { levelNumber: 1, moduleId: moduleOne.id, type: "external_event", completionMethod: "pocket_postback" },
      { levelNumber: 2, moduleId: moduleOne.id, type: "lesson", completionMethod: "manual" },
      { levelNumber: 3, moduleId: moduleOne.id, type: "financial_checkpoint", completionMethod: "balance_check" },
      { levelNumber: 4, moduleId: moduleTwo.id, type: "lesson", completionMethod: "manual", requiredCheckpointLevel: 3 },
      { levelNumber: 5, moduleId: moduleTwo.id, type: "financial_checkpoint", completionMethod: "balance_check" },
    ] as const;

    for (const row of levelRows) {
      const created = await prisma.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: row.moduleId,
          levelNumber: row.levelNumber,
          stableCode: stableCode(row.levelNumber),
          type: row.type,
          title: `Level ${row.levelNumber}`,
          learningObjective:
            input.invalid && row.levelNumber === 2 ? "" : `objective ${row.levelNumber}`,
          completionMethod: row.completionMethod,
          xpReward: 10,
          requiredXp: 0,
          requiredPreviousLevel: row.levelNumber === 1 ? null : row.levelNumber - 1,
          requiredCheckpointLevel:
            "requiredCheckpointLevel" in row ? row.requiredCheckpointLevel : null,
        },
      });

      // L4VC-1 — A LEVEL THAT COMPLETES BY `balance_check` MUST DECLARE ITS
      // THRESHOLD, and publish validation refuses the version otherwise
      // (`LEVEL_CHECKPOINT_REQUIREMENT_MISSING`). This fixture predates that
      // rule: it created levels 3 and 5 as financial checkpoints and never gave
      // them a requirement, so every publish in part B was refused for two
      // issues that have nothing to do with what part B is testing.
      //
      // The threshold is INTEGER minor units, so $50.00 is 5000 and no float
      // can ever move a gate. `featureUnlockCode` is deliberately left null on
      // the level: when it is set, `resource-completeness` additionally requires
      // it to equal `integrationCode`, and pinning that agreement is a different
      // test's job.
      if (row.completionMethod === "balance_check") {
        await prisma.levelCheckpointRequirement.create({
          data: {
            levelDefinitionId: created.id,
            integrationCode: "pocket_balance",
            thresholdCurrency: "USD",
            thresholdMinorUnits: 5000 * row.levelNumber,
          },
        });
      }
    }

    return version;
  }

  try {
    const draftOne = await insertCurriculum({ code: "ata-main", versionNumber: 1 });

    await check("15. non-admin cannot publish", () =>
      expectDomainError(
        () => publishCurriculumVersion({ curriculumVersionId: draftOne.id, actorId: regular.id }),
        "CURRICULUM_ACTOR_FORBIDDEN",
      ),
    );

    const firstPublish = await publishCurriculumVersion({
      curriculumVersionId: draftOne.id,
      actorId: admin.id,
    });

    await check("16. valid draft publishes successfully", () => {
      assert.equal(firstPublish.published.status, "published");
      assert.equal(firstPublish.replaced, null);
    });

    await check("17. publishedAt is set", () => {
      assert.notEqual(firstPublish.published.publishedAt, null);
    });

    await check("18. publish creates audit", async () => {
      const count = await prisma.auditLog.count({
        where: { action: "CURRICULUM_VERSION_PUBLISHED", entityId: String(draftOne.id) },
      });
      assert.equal(count, 1);
    });

    await check("19. published version fails editable guard", () =>
      expectDomainError(
        async () => assertCurriculumEditable(firstPublish.published),
        "CURRICULUM_PUBLISHED_IMMUTABLE",
      ),
    );

    await check("20. archived version fails editable guard", () =>
      expectDomainError(
        async () => assertCurriculumEditable({ id: 999, status: "archived" }),
        "CURRICULUM_ARCHIVED_IMMUTABLE",
      ),
    );

    const invalidDraft = await insertCurriculum({ code: "ata-invalid", versionNumber: 1, invalid: true });

    await check("21. invalid draft keeps status and returns all issues", async () => {
      try {
        await publishCurriculumVersion({ curriculumVersionId: invalidDraft.id, actorId: admin.id });
        assert.fail("expected CURRICULUM_INVALID");
      } catch (error) {
        assert.equal(isCurriculumDomainError(error, "CURRICULUM_INVALID"), true, String(error));
        if (isCurriculumDomainError(error)) {
          assert.equal(error.issues.length >= 1, true);
          assert.equal(error.issues.some((item) => item.code === "LEVEL_OBJECTIVE_EMPTY"), true);
        }
      }
      const fresh = await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: invalidDraft.id } });
      assert.equal(fresh.status, "draft");
      assert.equal(fresh.publishedAt, null);
    });

    await check("22. invalid draft creates no success audit (rejected audit allowed)", async () => {
      const successCount = await prisma.auditLog.count({
        where: { action: "CURRICULUM_VERSION_PUBLISHED", entityId: String(invalidDraft.id) },
      });
      assert.equal(successCount, 0);
      const rejectedCount = await prisma.auditLog.count({
        where: { action: "CURRICULUM_PUBLICATION_REJECTED", entityId: String(invalidDraft.id) },
      });
      assert.equal(rejectedCount, 1);
    });

    const draftTwo = await insertCurriculum({ code: "ata-main", versionNumber: 2 });

    await check("23. replacement requires expectedPublishedVersionId", () =>
      expectDomainError(
        () => publishCurriculumVersion({ curriculumVersionId: draftTwo.id, actorId: admin.id }),
        "CURRICULUM_REPLACEMENT_REQUIRED",
      ),
    );

    await check("24. wrong expectedPublishedVersionId rejected", () =>
      expectDomainError(
        () =>
          publishCurriculumVersion({
            curriculumVersionId: draftTwo.id,
            actorId: admin.id,
            expectedPublishedVersionId: 999999,
          }),
        "CURRICULUM_REPLACEMENT_MISMATCH",
      ),
    );

    const oldLevelsBefore = await prisma.levelDefinition.findMany({
      where: { curriculumVersionId: draftOne.id },
      orderBy: { levelNumber: "asc" },
    });

    const replacement = await publishCurriculumVersion({
      curriculumVersionId: draftTwo.id,
      actorId: admin.id,
      expectedPublishedVersionId: draftOne.id,
    });

    await check("25. correct expected ID archives old and publishes new atomically", async () => {
      assert.equal(replacement.published.id, draftTwo.id);
      assert.equal(replacement.published.status, "published");
      assert.equal(replacement.replaced?.id, draftOne.id);
      const oldFresh = await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: draftOne.id } });
      assert.equal(oldFresh.status, "archived");
    });

    await check("26. replaced version definitions remain unchanged", async () => {
      const oldLevelsAfter = await prisma.levelDefinition.findMany({
        where: { curriculumVersionId: draftOne.id },
        orderBy: { levelNumber: "asc" },
      });
      assert.deepEqual(oldLevelsAfter, oldLevelsBefore);
    });

    await check("27. replacement creates correct audit", async () => {
      const replaced = await prisma.auditLog.findFirst({
        where: { action: "CURRICULUM_VERSION_REPLACED", entityId: String(draftOne.id) },
      });
      assert.notEqual(replaced, null);
      const metadata = replaced?.metadata as { replacedByVersionId?: number };
      assert.equal(metadata.replacedByVersionId, draftTwo.id);
    });

    const draftThree = await insertCurriculum({ code: "ata-main", versionNumber: 3 });

    await check("28. failure inside transaction rolls back both status changes and audit", async () => {
      const auditCountBefore = await prisma.auditLog.count();
      await prisma.$executeRawUnsafe(
        "CREATE TRIGGER ata_fail_publish_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'CURRICULUM_VERSION_PUBLISHED' BEGIN SELECT RAISE(ABORT, 'forced-audit-failure'); END",
      );
      try {
        await publishCurriculumVersion({
          curriculumVersionId: draftThree.id,
          actorId: admin.id,
          expectedPublishedVersionId: draftTwo.id,
        });
        assert.fail("expected forced failure");
      } catch (error) {
        assert.equal(/forced-audit-failure|RAISE|constraint|abort/i.test(String(error)), true, String(error));
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER ata_fail_publish_audit");
      }

      const target = await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: draftThree.id } });
      const current = await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: draftTwo.id } });
      assert.equal(target.status, "draft");
      assert.equal(current.status, "published");
      assert.equal(await prisma.auditLog.count(), auditCountBefore);
    });

    await check("29. partial unique index blocks race-like second published row", async () => {
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "CurriculumVersion" SET "status" = 'published' WHERE "id" = ${draftThree.id}`,
        );
        assert.fail("expected unique constraint violation");
      } catch (error) {
        assert.equal(/unique|constraint/i.test(String(error)), true, String(error));
      }
      const fresh = await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: draftThree.id } });
      assert.equal(fresh.status, "draft");
    });

    const futureDraft = await insertCurriculum({
      code: "ata-future",
      versionNumber: 1,
      effectiveFrom: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await check("30. future effectiveFrom rejected", async () => {
      await expectDomainError(
        () => publishCurriculumVersion({ curriculumVersionId: futureDraft.id, actorId: admin.id }),
        "CURRICULUM_EFFECTIVE_FROM_FUTURE",
      );
      const fresh = await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: futureDraft.id } });
      assert.equal(fresh.status, "draft");
    });

    const archived = await archiveCurriculumVersion({
      curriculumVersionId: draftTwo.id,
      actorId: admin.id,
    });

    await check("31. archive of published version succeeds", () => {
      assert.equal(archived.status, "archived");
    });

    await check("32. archive creates audit", async () => {
      const count = await prisma.auditLog.count({
        where: { action: "CURRICULUM_VERSION_ARCHIVED", entityId: String(draftTwo.id) },
      });
      assert.equal(count, 1);
    });

    await check("33. draft cannot be archived via this service (and re-archive is not success)", async () => {
      await expectDomainError(
        () => archiveCurriculumVersion({ curriculumVersionId: draftThree.id, actorId: admin.id }),
        "CURRICULUM_NOT_PUBLISHED",
      );
      await expectDomainError(
        () => archiveCurriculumVersion({ curriculumVersionId: draftTwo.id, actorId: admin.id }),
        "CURRICULUM_NOT_PUBLISHED",
      );
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
  }

  await check("34. temporary DB removed after test", () => {
    assert.equal(fs.existsSync(dbPath), false);
  });
}

async function main() {
  cleanupDb();
  await partA();
  try {
    await partB();
  } finally {
    cleanupDb();
  }
}

main()
  .then(() => {
    console.log(`\ncurriculum domain regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    cleanupDb();
    console.error(error);
    console.log(`\ncurriculum domain regression: ${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
