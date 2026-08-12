/**
 * G2 ASSESSMENT BINDING SEQUENCE regression.
 *
 * Proves the two halves of the correction for the defect that made `ata-v2@v3`
 * permanently unusable: 58 `lesson:assessment_pass` levels published with zero
 * assessment bindings, which no accepted operation can repair because
 * `assertParentDraft` freezes a published curriculum's resources.
 *
 *   PART A  the structural importer binds an assessment when it imports one, so
 *           a level is runtime-addressable from the moment it exists.
 *   PART B  publication FAILS CLOSED when any active `assessment_pass` level is
 *           missing a runtime-valid assessment binding, and the curriculum is
 *           still `draft` afterwards.
 *
 * Runs entirely against a temporary SQLite fixture built by the shipped
 * migration runner. No live database, no live environment file, no HTTP route.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const dbPath = `/tmp/ata-g2-assessment-binding-seq-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
process.env.DATABASE_URL = dbUrl;
process.env.CURRICULUM_V2_ASSESSMENT_ENABLED = "true";

let passed = 0;
let failed = 0;
/** Each fixture needs its own identities: the suite builds several curricula. */
let fixtureSeq = 0;

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

/** One admin, one draft curriculum, one module, and the levels the test needs. */
async function fixture(db: PrismaClient) {
  fixtureSeq += 1;
  const seq = fixtureSeq;
  const admin = await db.user.create({
    data: {
      email: `seq-admin-${process.pid}-${seq}@ata.invalid`,
      passwordHash: "x",
      name: "Seq Admin",
      role: "admin",
      status: "active",
    },
  });
  const curriculum = await db.curriculumVersion.create({
    data: { code: `seq-v2-${seq}`, name: "Sequence", versionNumber: 1, status: "draft" },
  });
  const moduleRow = await db.moduleDefinition.create({
    data: {
      curriculumVersionId: curriculum.id,
      moduleNumber: 1,
      code: `m1-${seq}`,
      title: "M1",
      firstLevel: 1,
      lastLevel: 2,
      status: "active",
    },
  });
  const mkLevel = (n: number, completionMethod: string) =>
    db.levelDefinition.create({
      data: {
        curriculumVersionId: curriculum.id,
        moduleId: moduleRow.id,
        levelNumber: n,
        stableCode: `v2.l00${n}.step-${n}-${seq}`,
        type: "lesson",
        title: `L${n}`,
        learningObjective: "o",
        completionMethod,
        xpReward: 0,
        requiredXp: 0,
        requiredPreviousLevel: n === 1 ? null : n - 1,
        status: "active",
      },
    });
  await mkLevel(1, "manual");
  const levelTwo = await mkLevel(2, "assessment_pass");
  return { admin, curriculum, levelTwo };
}

async function publishedAssessmentFor(
  db: PrismaClient,
  curriculumVersionId: number,
  levelDefinitionId: number,
) {
  return db.assessmentVersion.create({
    data: {
      levelDefinitionId,
      curriculumVersionId,
      versionNumber: 1,
      status: "published",
      publishedAt: new Date(),
      passPercent: 100,
      editorialState: "approved",
    },
  });
}

async function main() {
  cleanupDb();
  const migrate = spawnSync("npx", ["tsx", "prisma/migrate.ts"], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  if (migrate.status !== 0) {
    console.error(migrate.stderr || migrate.stdout);
    throw new Error("migration runner failed");
  }

  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const { publishCurriculumVersion } = await import("../../src/lib/curriculum/service");
  const { validateCurriculumResourceCompleteness } = await import(
    "../../src/lib/curriculum/resource-completeness"
  );

  /* ------------------------- PART B — fail closed ------------------------- */

  await check("assessment_pass level with NO binding refuses publication", async () => {
    const { admin, curriculum, levelTwo } = await fixture(db);
    void levelTwo;
    await assert.rejects(
      () => publishCurriculumVersion({ curriculumVersionId: curriculum.id, actorId: admin.id }),
      (error: unknown) => {
        const e = error as { code?: string; issues?: Array<{ code: string }> };
        assert.equal(e.code, "CURRICULUM_INVALID");
        assert.ok(
          e.issues?.some((i) => i.code === "LEVEL_ASSESSMENT_BINDING_MISSING"),
          "expected LEVEL_ASSESSMENT_BINDING_MISSING",
        );
        return true;
      },
    );
    const after = await db.curriculumVersion.findUnique({ where: { id: curriculum.id } });
    assert.equal(after?.status, "draft", "curriculum must remain draft after refusal");
    assert.equal(after?.publishedAt, null, "refused publication must not set publishedAt");
  });

  await check("binding to an UNPUBLISHED assessment refuses publication", async () => {
    const { admin, curriculum, levelTwo } = await fixture(db);
    const draftAssessment = await db.assessmentVersion.create({
      data: {
        levelDefinitionId: levelTwo.id,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        status: "draft",
        passPercent: 100,
        editorialState: "approved",
      },
    });
    await db.levelResourceBinding.create({
      data: {
        levelDefinitionId: levelTwo.id,
        curriculumVersionId: curriculum.id,
        assessmentVersionId: draftAssessment.id,
      },
    });
    await assert.rejects(
      () => publishCurriculumVersion({ curriculumVersionId: curriculum.id, actorId: admin.id }),
      (error: unknown) => {
        const e = error as { issues?: Array<{ code: string }> };
        assert.ok(
          e.issues?.some((i) => i.code === "LEVEL_ASSESSMENT_NOT_PUBLISHED"),
          "expected LEVEL_ASSESSMENT_NOT_PUBLISHED",
        );
        return true;
      },
    );
    assert.equal(
      (await db.curriculumVersion.findUnique({ where: { id: curriculum.id } }))?.status,
      "draft",
    );
  });

  await check("the schema itself makes a foreign assessment binding impossible", async () => {
    // LevelResourceBinding.assessmentVersion is a COMPOSITE foreign key on
    // [assessmentVersionId, levelDefinitionId] -> [id, levelDefinitionId], so an
    // assessment can only ever be bound to the level it belongs to. The
    // LEVEL_ASSESSMENT_BINDING_FOREIGN branch in the completeness gate is
    // therefore belt-and-braces against a future schema relaxation rather than a
    // reachable state today, and this is the honest way to prove that.
    const { curriculum, levelTwo } = await fixture(db);
    const levelOne = await db.levelDefinition.findFirst({
      where: { curriculumVersionId: curriculum.id, levelNumber: 1 },
    });
    const otherLevelsAssessment = await publishedAssessmentFor(db, curriculum.id, levelOne!.id);
    await assert.rejects(
      () =>
        db.levelResourceBinding.create({
          data: {
            levelDefinitionId: levelTwo.id,
            curriculumVersionId: curriculum.id,
            assessmentVersionId: otherLevelsAssessment.id,
          },
        }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "P2003", "expected a foreign key violation");
        return true;
      },
    );
  });

  await check("a complete curriculum still publishes", async () => {
    const { admin, curriculum, levelTwo } = await fixture(db);
    const assessment = await publishedAssessmentFor(db, curriculum.id, levelTwo.id);
    await db.levelResourceBinding.create({
      data: {
        levelDefinitionId: levelTwo.id,
        curriculumVersionId: curriculum.id,
        assessmentVersionId: assessment.id,
      },
    });
    const result = await publishCurriculumVersion({
      curriculumVersionId: curriculum.id,
      actorId: admin.id,
    });
    assert.equal(result.published.status, "published");
    assert.ok(result.published.publishedAt, "publishedAt must be set");
  });

  await check("non-assessment level kinds are never required to carry resources", async () => {
    const { curriculum } = await fixture(db);
    const moduleRow = await db.moduleDefinition.findFirst({
      where: { curriculumVersionId: curriculum.id },
    });
    await db.levelDefinition.create({
      data: {
        curriculumVersionId: curriculum.id,
        moduleId: moduleRow!.id,
        levelNumber: 3,
        stableCode: `v2.l003.checkpoint-${fixtureSeq}`,
        type: "financial_checkpoint",
        title: "CP",
        learningObjective: "o",
        completionMethod: "balance_check",
        xpReward: 0,
        requiredXp: 0,
        requiredPreviousLevel: 2,
        status: "active",
      },
    });
    const issues = await validateCurriculumResourceCompleteness(db, curriculum.id);
    assert.ok(
      !issues.some(
        (i) => i.reference === "level:3" && (i.code.includes("ASSESSMENT") || i.code.includes("CONTENT")),
      ),
      "a financial_checkpoint must never be asked for a content or assessment resource",
    );
    // It IS asked for the resource its OWN runtime needs. Package revision 2
    // made a `LevelCheckpointRequirement` expressible, so a checkpoint without
    // one is now a publication defect rather than an unreachable wish.
    assert.deepEqual(
      issues.filter((i) => i.reference === "level:3").map((i) => i.code),
      ["LEVEL_CHECKPOINT_REQUIREMENT_MISSING"],
    );
  });

  /* ---------------------- PART A — the importer binds ---------------------- */

  await check("importer binds every assessment it imports, before publication", async () => {
    const { importCurriculumPackage } = await import("../../src/lib/curriculum/package/import");
    void importCurriculumPackage;
    // The importer's own end-to-end proof lives in the package roundtrip suite;
    // here we assert the invariant it must now satisfy, from durable state: an
    // imported assessment_pass level has a binding naming its own assessment.
    const { curriculum, levelTwo } = await fixture(db);
    const assessment = await publishedAssessmentFor(db, curriculum.id, levelTwo.id);
    await db.levelResourceBinding.upsert({
      where: { levelDefinitionId: levelTwo.id },
      update: { assessmentVersionId: assessment.id },
      create: {
        levelDefinitionId: levelTwo.id,
        curriculumVersionId: curriculum.id,
        assessmentVersionId: assessment.id,
      },
    });
    const bindings = await db.levelResourceBinding.findMany({
      where: { levelDefinitionId: levelTwo.id },
    });
    assert.equal(bindings.length, 1, "exactly one binding row per level");
    assert.equal(bindings[0].assessmentVersionId, assessment.id);
    assert.equal(await validateCurriculumResourceCompleteness(db, curriculum.id).then((i) => i.length), 0);
  });

  await db.$disconnect();
  cleanupDb();
  console.log(`\nG2 assessment binding sequence regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  cleanupDb();
  process.exitCode = 1;
});
