/**
 * PHASE-G1 CORRECTIONS — the regression that would have caught both blockers.
 *
 * ===================== WHY IT USES THE REAL PACKAGE =====================
 * The G1 self-report ran against a hand-built structural fixture whose question
 * rows were written with direct `prisma.questionDefinition.create` calls
 * carrying `stableKey: "T5.1"`. That state was unreachable through any product
 * path, so a rule the product could not satisfy still looked satisfied, and 58
 * of 58 ATA banks were permanently un-submittable in the real world while the
 * suite stayed green.
 *
 * This suite therefore imports `curriculum/packages/ata-v2-canonical-100.draft.json`
 * through the ACCEPTED importer and bootstraps the ACCEPTED
 * `ata-video-production-contracts.v1.json`, and asserts the durable result. If
 * the product import path cannot produce a bank whose four questions carry their
 * four canonical takes, this fails — which is exactly what it is for.
 *
 * DISPOSABLE DATABASE ONLY. Built from the accepted migration chain and deleted
 * on the way out. No live database, no live env, no flag anywhere real.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const OUT = process.env.REGRESSION_SUMMARY_PATH ?? null;
const dbPath = path.join(os.tmpdir(), `ata-authoring-corrections-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

let passed = 0;
let failed = 0;
const results: Array<{ name: string; ok: boolean; error?: string }> = [];

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    results.push({ name, ok: false, error: message });
    console.error(`FAIL ${name}`);
    console.error(message);
  }
}

function rm(file: string) {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${file}${suffix}`, { force: true });
}

async function refusedWith(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    const actual = (error as { code?: string }).code;
    assert.equal(actual, code, `expected ${code}, got ${actual}: ${String(error)}`);
    return error as { code: string; issues?: Array<{ code: string; message?: string }> };
  }
  return assert.fail(`expected a refusal with ${code}`);
}

async function main() {
  rm(dbPath);
  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  process.env.CURRICULUM_V2_ADMIN_ENABLED = "true";
  process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
  process.env.CURRICULUM_V2_ASSESSMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_READ_ENABLED = "true";

  const { prisma } = await import("../../src/lib/prisma");
  const profile = await import("../../src/lib/curriculum/authoring-level-profile");
  const schemas = await import("../../src/lib/curriculum/assessment-schemas");
  const assessment = await import("../../src/lib/curriculum/assessment");
  const read = await import("../../src/lib/curriculum/authoring-read");
  const readiness = await import("../../src/lib/curriculum/authoring-readiness");
  const validation = await import("../../src/lib/curriculum/authoring-validation-service");
  const handoff = await import("../../src/lib/curriculum/authoring-handoff");
  const previewModule = await import("../../src/lib/curriculum/authoring-preview");
  const clone = await import("../../src/lib/curriculum/authoring-version-clone");
  const importer = await import("../../src/lib/curriculum/package/import");
  const contracts = await import("../../src/lib/curriculum/video-production-contract");
  const videoAuthoring = await import("../../src/lib/curriculum/video-production-authoring");

  try {
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("CorrectionsPass123!", 4);
    const admin = await prisma.user.create({
      data: { email: "corr-admin@example.com", passwordHash: hash, role: "admin", status: "active", name: "Admin" },
    });
    const authorUser = await prisma.user.create({
      data: { email: "corr-author@example.com", passwordHash: hash, role: "user", status: "active", name: "A" },
    });
    await prisma.staffProfile.create({
      data: { userId: authorUser.id, staffRole: "content_manager" as never, displayName: "A" },
    });

    /* ================= A. the canonical Take-ID vocabulary ================= */

    await check("T1 the write schema ACCEPTS a canonical ATA take id", () => {
      const parsed = schemas.createAssessmentQuestionSchema.safeParse({
        actorId: 1, expectedRevision: 1, assessmentVersionId: 1,
        questionNumber: 1, stableKey: "T5.1", type: "single_choice",
        options: [{ code: "a" }], correctAnswer: { code: "a" },
      });
      assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    });

    await check("T2 the write schema still ACCEPTS the generic lowercase vocabulary", () => {
      const parsed = schemas.updateAssessmentQuestionSchema.safeParse({
        actorId: 1, expectedRevision: 1, questionDefinitionId: 1,
        patch: { stableKey: "risk-question-1" },
      });
      assert.equal(parsed.success, true);
    });

    await check("T3 near-miss take shapes are STILL refused — this is not a widening", () => {
      for (const bad of ["t5.1", "T5-1", "T5.5", "T5.0", "TAKE5.1", "T5.1x", "T.5.1", "T5..1"]) {
        const parsed = schemas.updateAssessmentQuestionSchema.safeParse({
          actorId: 1, expectedRevision: 1, questionDefinitionId: 1, patch: { stableKey: bad },
        });
        assert.equal(parsed.success, false, `${bad} must be refused`);
      }
    });

    await check("T4 the parser answers level ownership, not just shape", () => {
      assert.equal(profile.isCanonicalTakeId("T5.1"), true);
      assert.equal(profile.isCanonicalTakeId("t5.1"), false);
      assert.equal(profile.isTakeIdForLevel("T5.1", 5), true);
      assert.equal(profile.isTakeIdForLevel("T6.1", 5), false);
      assert.deepEqual(profile.canonicalTakeIdsForLevel(5), ["T5.1", "T5.2", "T5.3", "T5.4"]);
    });

    /* ============ B. ONE editorial-content rule, four callers ============ */

    await check("P1 the shared profile keeps report / registration / checkpoint out of teaching", () => {
      assert.equal(
        profile.requiresLearnerTeachingContent({ levelNumber: 3, stableCode: "v2.l003.pervye-pyat-demo-sdelok", type: "report" }),
        false,
        "a report level owes a report assignment, not a Body v2 lesson",
      );
      assert.equal(
        profile.requiresLearnerTeachingContent({ levelNumber: 1, stableCode: "v2.l001.registraciya-pocket", type: "external_event" }),
        false,
      );
      assert.equal(
        profile.requiresLearnerTeachingContent({ levelNumber: 4, stableCode: "v2.l004.kontrolnaya-tochka-50", type: "financial_checkpoint" }),
        false,
      );
      assert.equal(
        profile.requiresLearnerTeachingContent({ levelNumber: 5, stableCode: "v2.l005.zhiznennyy-cikl-sdelki", type: "lesson" }),
        true,
      );
    });

    /* ============ C. the REAL canonical import, end to end ============ */

    const raw = JSON.parse(
      fs.readFileSync(path.join(ROOT, "curriculum/packages/ata-v2-canonical-100.draft.json"), "utf8"),
    ) as unknown;
    const imported = await importer.importCurriculumPackage(raw, { db: prisma as never, dryRun: false });
    assert.equal(imported.ok, true, JSON.stringify(imported).slice(0, 400));
    const curriculum = await prisma.curriculumVersion.findFirstOrThrow({ orderBy: { id: "desc" } });

    const contractsFile = contracts.videoProductionContractsFileSchema.parse(
      JSON.parse(
        fs.readFileSync(path.join(ROOT, "curriculum/canonical/ata-video-production-contracts.v1.json"), "utf8"),
      ) as unknown,
    );
    await videoAuthoring.bootstrapVideoProductionVersions({
      file: contractsFile,
      curriculumVersionId: curriculum.id,
      actorId: admin.id,
    });

    let overview = await read.readAuthoringOverview(curriculum.id);

    await check("I1 the REAL import produces 58 banks, 232 questions and 232 CANONICAL take mappings", async () => {
      assert.equal(await prisma.assessmentVersion.count(), 58);
      assert.equal(await prisma.questionDefinition.count(), 232);
      const videoLevels = overview.filter((level) => level.video !== null);
      assert.equal(videoLevels.length, 58);
      const mapped = videoLevels.reduce((sum, level) => sum + (level.assessment?.mappedTakeCount ?? 0), 0);
      assert.equal(mapped, 232, "every ATA question must carry its canonical take");
      for (const level of videoLevels) {
        assert.equal(level.assessment?.mappedTakeCount, 4, `L${level.levelNumber} take mapping`);
      }
    });

    await check("I2 the take ids are the canonical strings, character for character", async () => {
      const rows = await prisma.questionDefinition.findMany({
        where: { assessmentVersion: { levelDefinition: { levelNumber: 5 } } },
        orderBy: { questionNumber: "asc" },
        select: { stableKey: true },
      });
      assert.deepEqual(rows.map((row) => row.stableKey), ["T5.1", "T5.2", "T5.3", "T5.4"]);
    });

    await check("I3 no take mapping blocker survives the real import", () => {
      const summary = readiness.summarizeReadiness(overview);
      assert.equal(summary.blockersByCode.ASSESSMENT_TAKE_MAPPING_INCOMPLETE, 0);
      assert.equal(summary.contentNeedsAuthoringLevels, 77, "the accepted backlog figure is unchanged");
      assert.equal(summary.contentRequiredLevels, 78);
    });

    await check("I4 provenance is untouched: 57 proposals, L18 source-backed, L2 conflicting, 0 approved", async () => {
      const summary = readiness.summarizeReadiness(overview);
      assert.equal(summary.assessmentProposedLevels, 56);
      assert.equal(summary.assessmentSourceBackedLevels, 1);
      assert.equal(summary.assessmentConflictingLevels, 1);
      assert.equal(summary.assessmentApprovedLevels, 0);
      assert.equal(summary.assessmentConflictRecords, 7);
      assert.equal(await prisma.assessmentVersion.count({ where: { editorialState: "approved" } }), 0);
      const l18 = overview.find((level) => level.levelNumber === 18)!;
      assert.equal(l18.assessment?.provenance, "SOURCE_BACKED");
      assert.equal(l18.assessment?.sourceApproval, "AWAITING_APPROVAL");
      const l2 = overview.find((level) => level.levelNumber === 2)!;
      assert.equal(l2.assessment?.provenance, "CONFLICTING");
      assert.equal(l2.assessment?.conflictCount, 7);
    });

    /* ====== D. readiness and validation can no longer disagree ====== */

    await check("C1 EVERY level readiness calls ready also PASSES server validation", async () => {
      const disagreements: string[] = [];
      for (const level of overview) {
        if (!readiness.levelHandoffStatus(level).ready) continue;
        const report = await validation.validateLevelAuthoring({
          curriculumVersionId: curriculum.id,
          levelDefinitionId: level.levelDefinitionId,
        });
        if (report && !report.ok) {
          disagreements.push(`L${level.levelNumber}: ${report.issues.map((i) => i.code).join(",")}`);
        }
      }
      assert.deepEqual(disagreements, [], "readiness and validation must answer the same question");
    });

    await check("C2 the report level is READY and validates — the L3 handoff blocker is closed", async () => {
      const l3 = overview.find((level) => level.levelNumber === 3)!;
      assert.equal(readiness.levelHandoffStatus(l3).ready, true);
      const report = await validation.validateLevelAuthoring({
        curriculumVersionId: curriculum.id,
        levelDefinitionId: l3.levelDefinitionId,
      });
      assert.equal(report?.ok, true, JSON.stringify(report?.issues));
    });

    /* ============= E. honest handoff vocabulary and scopes ============= */

    await check("Q1 levels with no editorial requirement do NOT inflate the approved bucket", () => {
      const counts = readiness.countWorkQueue(readiness.classifyWorkQueue(overview));
      assert.equal(counts.APPROVED_READY_FOR_HANDOFF, 0, "nothing has been approved yet");
      assert.equal(counts.EDITORIAL_HANDOFF_NOT_REQUIRED, 22, "the gates, checkpoints and report level");
      assert.equal(counts.NEEDS_FULL_CONTENT, 77);
      assert.equal(counts.NEEDS_ASSESSMENT_APPROVAL, 56);
      assert.equal(counts.SOURCE_BACKED_AWAITING_REVIEW, 1);
      assert.equal(counts.SOURCE_CONFLICT, 1);
    });

    await check("H1 a WHOLE-curriculum bundle is refused while any level is blocked", async () => {
      const error = await refusedWith(
        () => handoff.buildHandoffBundle({ curriculumVersionId: curriculum.id, actorId: null }),
        "AUTHORING_HANDOFF_BLOCKED",
      );
      assert.ok((error.issues ?? []).length > 0, "the refusal names the blockers");
    });

    await check("H2 a level-scoped bundle of a source-owned level succeeds and is deterministic", async () => {
      const first = await handoff.buildHandoffBundle({
        curriculumVersionId: curriculum.id,
        levelNumbers: [4],
        actorId: null,
      });
      const second = await handoff.buildHandoffBundle({
        curriculumVersionId: curriculum.id,
        levelNumbers: [4],
        actorId: null,
      });
      assert.equal(first.scope, "levels");
      assert.equal(first.fingerprint, second.fingerprint);
      assert.equal(JSON.stringify(first), JSON.stringify(second));
    });

    await check("H3 a level-scoped bundle naming a BLOCKED level is refused by name", async () => {
      await refusedWith(
        () => handoff.buildHandoffBundle({ curriculumVersionId: curriculum.id, levelNumbers: [5], actorId: null }),
        "AUTHORING_HANDOFF_BLOCKED",
      );
    });

    /* ============ F. the structural preview of a gate level ============ */

    await check("S1 a source-owned level previews structurally, with no snapshot row", async () => {
      const before = await prisma.authoringPreviewSnapshot.count();
      for (const levelNumber of [1, 3, 4]) {
        const level = await prisma.levelDefinition.findFirstOrThrow({
          where: { curriculumVersionId: curriculum.id, levelNumber },
        });
        const projection = await previewModule.readStructuralPreview(level.id);
        assert.equal(projection.structural, true);
        assert.equal(projection.payload.content, null);
        assert.equal(projection.payload.assessment, null);
        assert.equal(projection.payload.level.levelNumber, levelNumber);
        assert.equal(projection.pinned.curriculumVersionId, curriculum.id);
        assert.ok(projection.pinned.curriculumVersionCode.length > 0);
      }
      assert.equal(await prisma.authoringPreviewSnapshot.count(), before, "a projection stores nothing");
    });

    await check("S2 the structural route REFUSES a level that carries authored learner content", async () => {
      const level = await prisma.levelDefinition.findFirstOrThrow({
        where: { curriculumVersionId: curriculum.id, levelNumber: 5 },
      });
      await refusedWith(() => previewModule.readStructuralPreview(level.id), "AUTHORING_INPUT_INVALID");
    });

    await check("S3 the structural payload carries NO answer key and NO production internals", async () => {
      const level = await prisma.levelDefinition.findFirstOrThrow({
        where: { curriculumVersionId: curriculum.id, levelNumber: 4 },
      });
      const projection = await previewModule.readStructuralPreview(level.id);
      const text = JSON.stringify(projection);
      for (const forbidden of ["correctAnswer", "correctOptionCode", "explanation", "contractPayload", "qaState", "scriptState"]) {
        assert.equal(text.includes(forbidden), false, `${forbidden} must not appear`);
      }
    });

    /* ============ G. the take mapping is writable through the domain ============ */

    const l6 = await prisma.levelDefinition.findFirstOrThrow({
      where: { curriculumVersionId: curriculum.id, levelNumber: 6 },
    });
    const bank6 = await prisma.assessmentVersion.findFirstOrThrow({
      where: { levelDefinitionId: l6.id },
      include: { questions: { orderBy: { questionNumber: "asc" } } },
    });

    /*
     * PHASE-G1 TAKE-SLOT CORRECTION — W1..W3 previously asserted the OPPOSITE.
     *
     * They proved an editor could park a question on a generic key and complete
     * a swap, and that the resulting permutation still satisfied the validator.
     * The independent closeout then showed why that was wrong: the accepted
     * assessment projection derives each question's take POSITIONALLY, so a
     * permuted bank made the durable key and the video evidence's fingerprint
     * describe different lessons while the handoff shipped the durable one.
     *
     * The product decision is that `T{level}.1..4` are four fixed SLOTS, and
     * these checks now assert the invariant rather than its violation.
     */
    await check("W1 a take REASSIGNMENT is refused — ATA slots are positional", async () => {
      const [first, second] = bank6.questions;
      void second;
      const revision = (await prisma.assessmentVersion.findUniqueOrThrow({
        where: { id: bank6.id }, select: { revision: true },
      })).revision;

      // The parking key that used to make a swap possible.
      const parked = await refusedWith(
        () =>
          assessment.updateAssessmentQuestion({
            actorId: authorUser.id,
            questionDefinitionId: first!.id,
            expectedRevision: revision,
            patch: { stableKey: "temporary-take-slot" },
          }),
        "ASSESSMENT_INPUT_INVALID",
      );
      assert.match(JSON.stringify(parked.issues ?? []), /not an ATA take identifier/);

      // And the swap itself, stated directly.
      const swapped = await refusedWith(
        () =>
          assessment.updateAssessmentQuestion({
            actorId: authorUser.id,
            questionDefinitionId: first!.id,
            expectedRevision: revision,
            patch: { stableKey: "T6.2" },
          }),
        "ASSESSMENT_INPUT_INVALID",
      );
      assert.match(JSON.stringify(swapped.issues ?? []), /cannot be reassigned/);

      const after = await prisma.questionDefinition.findMany({
        where: { assessmentVersionId: bank6.id },
        orderBy: { questionNumber: "asc" },
        select: { stableKey: true },
      });
      assert.deepEqual(after.map((row) => row.stableKey), ["T6.1", "T6.2", "T6.3", "T6.4"]);
      const now = (await prisma.assessmentVersion.findUniqueOrThrow({
        where: { id: bank6.id }, select: { revision: true },
      })).revision;
      assert.equal(now, revision, "a refused write moves no revision");
    });

    await check("W2 a FOREIGN level's take is refused by the domain", async () => {
      const revision = (await prisma.assessmentVersion.findUniqueOrThrow({
        where: { id: bank6.id }, select: { revision: true },
      })).revision;
      const error = await refusedWith(
        () =>
          assessment.updateAssessmentQuestion({
            actorId: authorUser.id,
            questionDefinitionId: bank6.questions[0]!.id,
            expectedRevision: revision,
            patch: { stableKey: "T7.1" },
          }),
        "ASSESSMENT_INPUT_INVALID",
      );
      assert.match(JSON.stringify(error.issues ?? []), /belongs to level 7, not 6/);
    });

    await check("W3 the CANONICAL positional mapping satisfies the ATA validator", async () => {
      const report = await validation.validateLevelAuthoring({
        curriculumVersionId: curriculum.id,
        levelDefinitionId: l6.id,
      });
      const takeIssues = (report?.issues ?? []).filter((issue) => issue.code.startsWith("ASSESSMENT_TAKE"));
      assert.deepEqual(takeIssues, [], "every question sits in its own slot");
    });

    await check("W4 question CONTENT is still freely editable inside a fixed slot", async () => {
      const revision = (await prisma.assessmentVersion.findUniqueOrThrow({
        where: { id: bank6.id }, select: { revision: true },
      })).revision;
      await assessment.updateAssessmentQuestion({
        actorId: authorUser.id,
        questionDefinitionId: bank6.questions[0]!.id,
        expectedRevision: revision,
        patch: { correctAnswer: { code: "b" } },
      });
      const row = await prisma.questionDefinition.findUniqueOrThrow({
        where: { id: bank6.questions[0]!.id },
      });
      assert.equal(row.stableKey, "T6.1", "the slot is untouched by a content edit");
      assert.equal((row.correctAnswer as { code: string }).code, "b");
    });

    /* ============ H. video production stays cloneable ============ */

    await check("V1 an approved production version can be superseded by a NEW draft", async () => {
      const row = await prisma.videoProductionVersion.findFirstOrThrow({ where: { levelNumber: 6 } });
      const cloned = await clone.cloneVideoProductionVersion({
        videoProductionVersionId: row.id,
        actorId: authorUser.id,
      });
      assert.equal(cloned.kind, "video_production");
      assert.equal(cloned.revision, 1);
      assert.ok(cloned.versionNumber > row.versionNumber);
      const created = await prisma.videoProductionVersion.findUniqueOrThrow({ where: { id: cloned.id } });
      assert.equal(created.editorialState, "draft");
      assert.equal(created.approvedById, null, "a clone is never born approved");
      // Fingerprints are recomputed server-side from the copied contract.
      assert.match(created.contractFingerprint, /^[0-9a-f]{64}$/);
      const original = await prisma.videoProductionVersion.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(original.revision, row.revision, "the source version is untouched");
      assert.equal(original.contractFingerprint, row.contractFingerprint);
    });

    overview = await read.readAuthoringOverview(curriculum.id);
    await check("Z1 the corrected fixture still reports the accepted ATA backlog shape", () => {
      const summary = readiness.summarizeReadiness(overview);
      assert.equal(summary.totalLevels, 100);
      assert.equal(summary.videoContractLevels, 58);
      assert.equal(summary.contentNeedsAuthoringLevels, 77);
    });
  } finally {
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
    rm(dbPath);
  }

  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ passed, failed, results }, null, 2));
  console.log(`\nPHASE-G1 corrections: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  rm(dbPath);
  process.exit(1);
});
