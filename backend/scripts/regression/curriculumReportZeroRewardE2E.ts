// RR-1 isolated end-to-end proof on the REAL approved first-slice revision 3.
//
// Imports the operator-approved package (fingerprint 860751b…), authors the
// R1–R7 review rubric + binding for the real L3 report assignment, publishes and
// activates the pinned curriculum, then drives the real zero-reward L3 report
// journey through the real domain services against a fresh migrated database on
// no live port: draft (43 fields, five requiredWhen), submit, revision-requested,
// resubmission, approve → L3 completes, L4 available, zero XPTransaction, replay.
//
// Positive-reward compatibility is proven separately (a synthetic positive level)
// in curriculumReportZeroRewardRegression; revision 3 is never mutated here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dbPath = `/tmp/ata-report-zero-reward-e2e-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const PACKAGE = "curriculum/packages/ata-v2-first-slice.rev3.approved.json";
const EXPECTED_FP = "860751bff541439ac76858c917ed2572e2b3e92b41109cfbea74122eb46625ad";
const L3_CODE = "v2.l003.pervye-pyat-demo-sdelok";

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error instanceof Error ? error.stack ?? error.message : error); }
}
function cleanup() { for (const s of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true }); }

type AnyRecord = Record<string, unknown>;

async function main() {
  cleanup();
  const migration = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8",
  });
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
  process.env.DATABASE_URL = dbUrl;
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
  process.env.CURRICULUM_V2_ASSESSMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_REPORT_ENABLED = "true";
  delete process.env.CURRICULUM_V2_XP_ENABLED; // XP stays OFF for the zero-reward L3

  const { prisma } = await import("../../src/lib/prisma");
  const { importCurriculumPackage } = await import("../../src/lib/curriculum/package/import");
  const submissionRuntime = await import("../../src/lib/curriculum/report-submission");
  const review = await import("../../src/lib/curriculum/report-review");
  const { calculateFingerprint } = await import("../../src/lib/curriculum/package/fingerprint");

  const pkg = JSON.parse(fs.readFileSync(PACKAGE, "utf8")) as AnyRecord;

  // ---------- import + fingerprint ----------
  let versionId = 0;
  let l3LevelId = 0;
  let assignmentId = 0;
  await check("E1 rev3 imports and matches the operator-approved fingerprint", async () => {
    const computed = calculateFingerprint({ ...pkg, contentFingerprint: "0".repeat(64) } as never);
    assert.equal(computed, EXPECTED_FP, "package fingerprint must equal the approved fp");
    const result = await importCurriculumPackage(pkg, { db: prisma });
    assert.equal(result.ok, true, JSON.stringify(("code" in result ? result : {})));
    const version = await prisma.curriculumVersion.findFirstOrThrow({ where: { code: "ata-v2" } });
    versionId = version.id;
    const l3 = await prisma.levelDefinition.findFirstOrThrow({ where: { curriculumVersionId: versionId, stableCode: L3_CODE } });
    l3LevelId = l3.id;
    assert.equal(l3.type, "report");
    assert.equal(l3.completionMethod, "report_approval");
    assert.equal(l3.xpReward, 0, "the real L3 report level is zero reward");
  });

  await check("E2 the real L3 assignment has 43 fields and five requiredWhen conditionals", async () => {
    const assignment = await prisma.reportAssignmentVersion.findFirstOrThrow({ where: { levelDefinitionId: l3LevelId } });
    assignmentId = assignment.id;
    assert.equal(await prisma.reportFieldDefinition.count({ where: { reportAssignmentVersionId: assignmentId } }), 43);
    const conditional = await prisma.reportFieldDefinition.findMany({ where: { reportAssignmentVersionId: assignmentId, stableKey: { endsWith: "deviation-note" } } });
    assert.equal(conditional.length, 5);
  });

  // ---------- author R1–R7 rubric + binding, publish, activate ----------
  const criteriaCodes = ["r1-process", "r2-risk", "r3-discipline", "r4-evidence", "r5-reflection", "r6-accuracy", "r7-completeness"];
  const scaleCodes = ["meets", "revise"] as const;
  let rubricId = 0;
  const criterionRows: Array<{ id: number; stableKey: string; commentRequired: boolean }> = [];
  const scaleRows: Array<{ id: number; stableKey: string }> = [];
  await check("E3 author R1–R7 rubric, scale, reason and level binding; publish and activate", async () => {
    // publish the imported assignment
    await prisma.reportAssignmentVersion.update({ where: { id: assignmentId }, data: { status: "published", publishedAt: new Date("2026-06-02T00:00:00.000Z") } });
    const rubric = await prisma.reportRubricVersion.create({ data: {
      reportAssignmentVersionId: assignmentId, versionNumber: 1, status: "published", publishedAt: new Date("2026-06-02T00:00:00.000Z"),
    } });
    rubricId = rubric.id;
    for (let i = 0; i < criteriaCodes.length; i += 1) {
      const code = criteriaCodes[i];
      const commentRequired = i === 0; // R1 requires a comment
      const criterion = await prisma.reportRubricCriterion.create({ data: {
        reportRubricVersionId: rubricId, stableKey: code, categoryCode: `${code}-cat`, sortOrder: i, commentRequired,
      } });
      await prisma.reportRubricCriterionLocalization.create({ data: {
        reportRubricCriterionId: criterion.id, locale: "ru", title: code, description: `${code} description`,
      } });
      criterionRows.push({ id: criterion.id, stableKey: code, commentRequired });
    }
    for (let i = 0; i < scaleCodes.length; i += 1) {
      const scale = await prisma.reportRubricScaleOption.create({ data: { reportRubricVersionId: rubricId, stableKey: scaleCodes[i], ordinal: i } });
      await prisma.reportRubricScaleOptionLocalization.create({ data: { reportRubricScaleOptionId: scale.id, locale: "ru", label: scaleCodes[i], description: `${scaleCodes[i]} d` } });
      scaleRows.push({ id: scale.id, stableKey: scaleCodes[i] });
    }
    const reason = await prisma.reportRejectionReason.create({ data: { reportRubricVersionId: rubricId, stableKey: "missing-evidence", sortOrder: 0, active: true } });
    await prisma.reportRejectionReasonLocalization.create({ data: { reportRejectionReasonId: reason.id, locale: "ru", title: "Missing evidence", guidance: "Add evidence" } });
    await prisma.levelReportBinding.create({ data: {
      levelDefinitionId: l3LevelId, curriculumVersionId: versionId, reportAssignmentVersionId: assignmentId, reportRubricVersionId: rubricId, revision: 0,
    } });
    // publish + activate the pinned curriculum version
    const past = new Date("2026-06-01T00:00:00.000Z");
    await prisma.curriculumVersion.update({ where: { id: versionId }, data: { status: "published", publishedAt: past, effectiveFrom: past } });
  });

  // ---------- synthetic learner + reviewer ----------
  const mentor = await prisma.user.create({ data: { email: "e2e-mentor@example.com", name: "E2E Mentor", role: "mentor" } });
  const past = new Date("2026-06-01T00:00:00.000Z");
  const learner = await prisma.user.create({ data: { email: "e2e-learner@example.com", name: "E2E Learner" } });
  const enrollment = await prisma.userCurriculumEnrollment.create({ data: {
    userId: learner.id, curriculumVersionId: versionId, curriculumCode: "ata-v2", status: "active",
    enrolledAt: past, currentLevel: 3, highestCompletedLevel: 2, lastMeaningfulActionAt: past,
  } });
  const orderedLevels = await prisma.levelDefinition.findMany({ where: { curriculumVersionId: versionId }, orderBy: { levelNumber: "asc" } });
  for (const lvl of orderedLevels.filter((l) => l.levelNumber < 3)) {
    await prisma.userLevelProgress.create({ data: {
      enrollmentId: enrollment.id, curriculumVersionId: versionId, levelDefinitionId: lvl.id, status: "completed",
      startedAt: past, lastProgressAt: past, completedAt: past, attemptCount: 1,
    } });
  }
  const l3Progress = await prisma.userLevelProgress.create({ data: {
    enrollmentId: enrollment.id, curriculumVersionId: versionId, levelDefinitionId: l3LevelId, status: "in_progress", startedAt: past,
  } });

  // ---------- generate a valid 43-field draft (satisfying five requiredWhen) ----------
  const fieldDefs = await prisma.reportFieldDefinition.findMany({ where: { reportAssignmentVersionId: assignmentId }, orderBy: { sortOrder: "asc" } });
  function textOfLength(min: number, max: number): string {
    // no spaces, so the runtime's trim() never shortens the value below `min`
    const target = Math.min(Math.max(min, 8), max);
    const base = "DurableDemoTradeReviewNarrativeConcreteDetail";
    let s = "";
    while (s.length < target) s += base;
    return s.slice(0, target);
  }
  function valueFor(def: { stableKey: string; type: string; choiceCodes: unknown; validationRules: unknown }): string | number | boolean | string[] {
    const choices = Array.isArray(def.choiceCodes) ? (def.choiceCodes as string[]) : [];
    const rules = (def.validationRules ?? {}) as { minLength?: number | null; maxLength?: number | null };
    const min = typeof rules.minLength === "number" ? rules.minLength : 0;
    const max = typeof rules.maxLength === "number" ? rules.maxLength : 16_000;
    switch (def.type) {
      case "boolean":
        // tradeN-plan-followed = false triggers the deviation-note requirement (exercises requiredWhen)
        return def.stableKey.endsWith("plan-followed") ? false : true;
      case "short_text":
      case "long_text": return textOfLength(min, max);
      case "single_choice": return choices[0] ?? "up";
      case "multi_choice": return choices.length ? [choices[0]] : [];
      case "integer": return 1;
      case "url": return "https://example.com/evidence";
      default: return textOfLength(min, max);
    }
  }
  const fieldValues: Record<string, string | number | boolean | string[]> = {};
  for (const def of fieldDefs) fieldValues[def.stableKey] = valueFor(def);

  const scores = criterionRows.map((c) => ({ criterionCode: c.stableKey, scaleCode: "meets", ...(c.commentRequired ? { comment: "Complete evidence" } : {}) }));
  const scoresWithComment = scores;

  await check("E4 learner saves and submits a valid 43-field L3 report draft (five requiredWhen satisfied)", async () => {
    const saved = await submissionRuntime.saveOwnReportDraft(learner.id, { levelNumber: 3, requestId: "e2e-save-1", expectedRevision: 0, fieldValues });
    await submissionRuntime.submitOwnReport(learner.id, { levelNumber: 3, requestId: "e2e-submit-1", expectedRevision: saved.resultingWorkflowVersion });
    const sub = await prisma.reportSubmission.findFirstOrThrow({ where: { enrollmentId: enrollment.id, levelDefinitionId: l3LevelId } });
    assert.equal(sub.status, "pending_review");
  });

  async function aggregate() {
    return prisma.reportSubmission.findFirstOrThrow({ where: { enrollmentId: enrollment.id, levelDefinitionId: l3LevelId }, include: { submittedRevision: true } });
  }
  function command(row: Awaited<ReturnType<typeof aggregate>>, requestId: string) {
    return {
      submissionRef: Buffer.from(`report-submission:v1:${row.id}`, "utf8").toString("base64url"),
      requestId, expectedWorkflowVersion: row.workflowVersion, expectedClaimVersion: row.claimVersion,
      expectedSubmittedRevision: row.submittedRevision!.revisionNumber,
    };
  }

  // ---------- Journey A: revision requested ----------
  await check("E5 mentor requests a revision — L3 stays incomplete, L4 locked, no XP", async () => {
    const row = await aggregate();
    await review.claimReportForReview(mentor.id, command(row, "e2e-claim-a"), { evaluationTime: new Date("2026-06-03T10:00:00.000Z") });
    const claimed = await aggregate();
    await review.rejectReportSubmission(mentor.id, {
      ...command(claimed, "e2e-reject-a"), scores: scoresWithComment,
      reasonCode: "missing-evidence", humanComment: "Add durable evidence", correctiveAction: "Attach the missing trade rationale",
    }, { evaluationTime: new Date("2026-06-03T10:20:00.000Z") });
    const after = await aggregate();
    assert.equal(after.status, "rejected");
    assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: l3Progress.id } })).status, "in_progress");
    assert.equal((await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } })).currentLevel, 3);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: enrollment.id } }), 0);
  });

  await check("E6 learner resubmits a corrected revision", async () => {
    const current = await aggregate();
    // make a genuine, length-valid correction by flipping a single_choice field
    const dirDef = fieldDefs.find((d) => d.stableKey === "trade1-direction");
    const dirChoices = Array.isArray(dirDef?.choiceCodes) ? (dirDef!.choiceCodes as string[]) : ["up", "down"];
    const altDir = dirChoices.find((c) => c !== fieldValues["trade1-direction"]) ?? dirChoices[0];
    const corrected = { ...fieldValues, "trade1-direction": altDir };
    const correction = await submissionRuntime.saveOwnReportDraft(learner.id, { levelNumber: 3, requestId: "e2e-correct", expectedRevision: current.workflowVersion, fieldValues: corrected });
    const resubmitted = await submissionRuntime.resubmitOwnReport(learner.id, { levelNumber: 3, requestId: "e2e-resubmit", expectedRevision: correction.resultingWorkflowVersion });
    assert.equal(resubmitted.submission.status, "pending_review");
  });

  // ---------- Journey B: approve (zero reward) ----------
  let approvalInput: AnyRecord = {};
  await check("E7 mentor approves the latest revision — L3 completes, L4 available, zero XP", async () => {
    await review.claimReportForReview(mentor.id, command(await aggregate(), "e2e-claim-b"), { evaluationTime: new Date("2026-06-04T10:00:00.000Z") });
    approvalInput = { ...command(await aggregate(), "e2e-approve"), scores: scoresWithComment };
    const result = await review.approveReportSubmission(mentor.id, approvalInput, { evaluationTime: new Date("2026-06-04T10:20:00.000Z") });
    assert.equal(result.created, true);
    assert.equal(result.completion.xpAwarded, 0);
    assert.equal(result.completion.xpTransactionId, null);
    assert.equal(result.completion.levelNumber, 3);
    assert.equal(result.completion.nextLevelNumber, 4);
    assert.equal(result.completion.terminal, false);
    const progress = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: l3Progress.id } });
    assert.equal(progress.status, "completed");
    const enr = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    assert.equal(enr.highestCompletedLevel, 3);
    assert.equal(enr.currentLevel, 4); // L4 available
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: enrollment.id } }), 0);
    // durable receipt records the zero reward explicitly
    const submissionId = (await aggregate()).id;
    const receipt = await prisma.reportCommandReceipt.findFirstOrThrow({ where: { submissionId, commandType: "approve" } });
    const safe = receipt.safeResult as AnyRecord;
    assert.equal(safe.xpAwarded, 0);
    assert.equal(safe.xpTransactionId, null);
  });

  await check("E8 idempotent replay reconstructs the same completed state without an XP id", async () => {
    const before = { reviews: await prisma.reportReview.count(), xp: await prisma.xPTransaction.count(), receipts: await prisma.reportCommandReceipt.count() };
    const replay = await review.approveReportSubmission(mentor.id, approvalInput, { evaluationTime: new Date("2026-07-01T00:00:00.000Z") });
    assert.equal(replay.retry, true);
    assert.equal(replay.completion.xpTransactionId, null);
    assert.deepEqual({ reviews: await prisma.reportReview.count(), xp: await prisma.xPTransaction.count(), receipts: await prisma.reportCommandReceipt.count() }, before);
  });

  await check("E9 with REPORT disabled the review surface fails closed", async () => {
    delete process.env.CURRICULUM_V2_REPORT_ENABLED;
    try {
      const row = await aggregate();
      const queue = await review.listReportReviewQueue(mentor.id, { locale: "ru" });
      assert.equal(queue.kind, "disabled");
      await review.approveReportSubmission(mentor.id, { ...command(row, "e2e-disabled"), scores: scoresWithComment }, { evaluationTime: new Date("2026-07-02T00:00:00.000Z") })
        .then(() => { throw new Error("approval should have failed closed"); })
        .catch((e: unknown) => { if ((e as { code?: string }).code !== "REPORT_DISABLED") throw e; });
    } finally { process.env.CURRICULUM_V2_REPORT_ENABLED = "true"; }
  });

  const summary = {
    fingerprint: EXPECTED_FP,
    l3Zero: true,
    xpTransactions: await prisma.xPTransaction.count({ where: { enrollmentId: enrollment.id } }),
    l3Status: (await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: l3Progress.id } })).status,
    currentLevel: (await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } })).currentLevel,
  };

  await prisma.$disconnect();
  cleanup();
  for (const n of ["CURRICULUM_V2_READ_ENABLED", "CURRICULUM_V2_ENROLLMENT_ENABLED", "CURRICULUM_V2_CONTENT_ENABLED", "CURRICULUM_V2_ASSESSMENT_ENABLED", "CURRICULUM_V2_REPORT_ENABLED"]) delete process.env[n];

  console.log(`\nRR-1 E2E (rev3 real L3): ${passed} passed, ${failed} failed`);
  console.log(`E2E_SUMMARY ${JSON.stringify(summary)}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error); cleanup(); process.exitCode = 1; });
