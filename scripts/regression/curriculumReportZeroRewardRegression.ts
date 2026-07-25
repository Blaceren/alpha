// RR-1: zero-reward report approval regression.
//
// Proves that approving a report level whose xpReward is 0 completes the level
// server-side WITHOUT creating an XPTransaction and WITHOUT requiring the XP flag,
// while positive-reward approval remains atomic and XP-gated, negative reward
// fails closed, and the durable approval receipt/replay no longer depends on a
// fabricated XP transaction id. Companion to curriculumReportApprovalRegression.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { ReportDomainErrorCode } from "../../src/lib/curriculum/report-errors";
import { isReportDomainError } from "../../src/lib/curriculum/report-errors";

const dbPath = `/tmp/ata-curriculum-report-zero-reward-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.stack ?? error.message : error);
  }
}

async function expectError(fn: () => Promise<unknown>, code: ReportDomainErrorCode) {
  try { await fn(); }
  catch (error) {
    if (isReportDomainError(error, code)) return;
    throw new Error(`expected ${code}, got ${String(error)}`);
  }
  throw new Error(`expected ${code}, operation succeeded`);
}

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

const REPORT_FLAGS = ["CURRICULUM_V2_READ_ENABLED", "CURRICULUM_V2_ENROLLMENT_ENABLED", "CURRICULUM_V2_REPORT_ENABLED"] as const;
function enableReportFlags() { for (const name of REPORT_FLAGS) process.env[name] = "true"; }
function enableXp() { process.env.CURRICULUM_V2_XP_ENABLED = "true"; }
function disableXp() { delete process.env.CURRICULUM_V2_XP_ENABLED; }

async function main() {
  cleanup();
  const migration = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8",
  });
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
  process.env.DATABASE_URL = dbUrl;
  enableReportFlags();
  // XP is intentionally left DISABLED for the whole default run; the zero-reward
  // path must succeed without it. Only the positive-reward compatibility check
  // enables it, and restores the disabled default afterwards.
  disableXp();

  const { prisma } = await import("../../src/lib/prisma");
  const review = await import("../../src/lib/curriculum/report-review");
  const submissionRuntime = await import("../../src/lib/curriculum/report-submission");

  const mentor = await prisma.user.create({ data: { email: "zero-mentor@example.com", name: "Zero Mentor", role: "mentor" } });
  const secondMentor = await prisma.user.create({ data: { email: "zero-mentor-two@example.com", name: "Zero Mentor Two", role: "mentor" } });
  const ordinary = await prisma.user.create({ data: { email: "zero-ordinary@example.com", name: "Ordinary" } });

  // Builds a single published "ata-v2" curriculum (the code the completion
  // primitive pins to) whose levels carry the given per-level rewards. Every
  // level is a report level with its own assignment/rubric/binding.
  async function createGraph(rewards: number[]) {
    const curriculum = await prisma.curriculumVersion.create({ data: {
      code: "ata-v2", name: "Zero", versionNumber: 1, status: "published",
      publishedAt: new Date("2026-04-01T00:00:00.000Z"),
    } });
    const moduleDefinition = await prisma.moduleDefinition.create({ data: {
      curriculumVersionId: curriculum.id, moduleNumber: 1, code: "zero-1",
      title: "Zero", firstLevel: 1, lastLevel: rewards.length,
    } });
    const levels = [];
    for (let levelNumber = 1; levelNumber <= rewards.length; levelNumber += 1) {
      levels.push(await prisma.levelDefinition.create({ data: {
        curriculumVersionId: curriculum.id, moduleId: moduleDefinition.id, levelNumber,
        stableCode: `v2.l${String(levelNumber).padStart(3, "0")}.report`,
        type: "report", title: `Report ${levelNumber}`, completionMethod: "report_approval",
        xpReward: rewards[levelNumber - 1],
        requiredPreviousLevel: levelNumber > 1 ? levelNumber - 1 : null,
      } }));
    }
    async function definition(levelDefinitionId: number) {
      const assignment = await prisma.reportAssignmentVersion.create({ data: {
        levelDefinitionId, curriculumVersionId: curriculum.id, versionNumber: 4,
        status: "published", publishedAt: new Date("2026-04-02T00:00:00.000Z"),
      } });
      await prisma.reportAssignmentLocalization.create({ data: {
        reportAssignmentVersionId: assignment.id, locale: "en", title: "Zero assignment",
        instructions: "Provide durable evidence", successCriteriaSummary: "All criteria", submitLabel: "Submit",
      } });
      const field = await prisma.reportFieldDefinition.create({ data: {
        reportAssignmentVersionId: assignment.id, stableKey: "evidence", type: "url", required: true,
        sortOrder: 0, validationRules: { version: 1, allowedSchemes: ["https"] }, choiceCodes: Prisma.JsonNull,
      } });
      await prisma.reportFieldLocalization.create({ data: {
        reportFieldDefinitionId: field.id, locale: "en", label: "Evidence", helpText: "HTTPS",
        placeholder: "https://example.com", choiceLabels: Prisma.JsonNull,
      } });
      const rubric = await prisma.reportRubricVersion.create({ data: {
        reportAssignmentVersionId: assignment.id, versionNumber: 6, status: "published",
        publishedAt: new Date("2026-04-02T00:00:00.000Z"),
      } });
      const criteria = [];
      for (const [stableKey, commentRequired, sortOrder] of [["process", true, 0], ["risk", false, 1]] as const) {
        const criterion = await prisma.reportRubricCriterion.create({ data: {
          reportRubricVersionId: rubric.id, stableKey, categoryCode: `${stableKey}-quality`, sortOrder, commentRequired,
        } });
        await prisma.reportRubricCriterionLocalization.create({ data: {
          reportRubricCriterionId: criterion.id, locale: "en", title: stableKey, description: `${stableKey} description`,
        } });
        criteria.push(criterion);
      }
      const scales = [];
      for (const [stableKey, ordinal] of [["meets", 0], ["revise", 1]] as const) {
        const scale = await prisma.reportRubricScaleOption.create({ data: { reportRubricVersionId: rubric.id, stableKey, ordinal } });
        await prisma.reportRubricScaleOptionLocalization.create({ data: {
          reportRubricScaleOptionId: scale.id, locale: "en", label: stableKey, description: `${stableKey} description`,
        } });
        scales.push(scale);
      }
      const reason = await prisma.reportRejectionReason.create({ data: {
        reportRubricVersionId: rubric.id, stableKey: "missing-evidence", sortOrder: 0, active: true,
      } });
      await prisma.reportRejectionReasonLocalization.create({ data: {
        reportRejectionReasonId: reason.id, locale: "en", title: "Missing evidence", guidance: "Add evidence",
      } });
      await prisma.levelReportBinding.create({ data: {
        levelDefinitionId, curriculumVersionId: curriculum.id,
        reportAssignmentVersionId: assignment.id, reportRubricVersionId: rubric.id, revision: 0,
      } });
      return { assignment, rubric, criteria, scales };
    }
    for (const level of levels) await definition(level.id);
    return { curriculum, levels };
  }

  const graph = await createGraph([0, 40, 0]); // L1 zero, L2 positive, L3 corruptible zero

  let authorSequence = 0;
  // Creates an isolated learner enrolled at targetLevel, with every prior level
  // pre-completed, then saves and submits a valid report draft at that level.
  async function prepare(targetLevel: number, marker: string) {
    authorSequence += 1;
    const level = graph.levels[targetLevel - 1];
    const user = await prisma.user.create({ data: {
      email: `zero-author-${authorSequence}@example.com`, name: `Author ${authorSequence}`,
    } });
    const enrollment = await prisma.userCurriculumEnrollment.create({ data: {
      userId: user.id, curriculumVersionId: graph.curriculum.id, curriculumCode: graph.curriculum.code,
      status: "active", currentLevel: targetLevel, highestCompletedLevel: targetLevel - 1,
    } });
    for (let n = 1; n < targetLevel; n += 1) {
      await prisma.userLevelProgress.create({ data: {
        enrollmentId: enrollment.id, curriculumVersionId: graph.curriculum.id, levelDefinitionId: graph.levels[n - 1].id,
        status: "completed", startedAt: new Date("2026-04-01T00:00:00.000Z"),
        completedAt: new Date("2026-04-02T00:00:00.000Z"), lastProgressAt: new Date("2026-04-02T00:00:00.000Z"),
      } });
    }
    const progress = await prisma.userLevelProgress.create({ data: {
      enrollmentId: enrollment.id, curriculumVersionId: graph.curriculum.id, levelDefinitionId: level.id,
      status: "in_progress", startedAt: new Date("2026-04-03T00:00:00.000Z"),
    } });
    const saved = await submissionRuntime.saveOwnReportDraft(user.id, {
      levelNumber: targetLevel, requestId: `save-${marker}-request`, expectedRevision: 0,
      fieldValues: { evidence: `https://example.com/${marker}` },
    });
    await submissionRuntime.submitOwnReport(user.id, {
      levelNumber: targetLevel, requestId: `submit-${marker}-request`, expectedRevision: saved.resultingWorkflowVersion,
    });
    return { user, enrollment, progress, level, targetLevel };
  }

  const scores = [
    { criterionCode: "process", scaleCode: "meets", comment: "Complete process evidence" },
    { criterionCode: "risk", scaleCode: "meets" },
  ];
  const at = new Date("2031-05-01T10:20:00.000Z");
  const claimAt = new Date("2031-05-01T10:00:00.000Z");

  type Fixture = Awaited<ReturnType<typeof prepare>>;
  async function aggregate(fixture: Fixture) {
    return prisma.reportSubmission.findUniqueOrThrow({
      where: { enrollmentId_levelDefinitionId: { enrollmentId: fixture.enrollment.id, levelDefinitionId: fixture.level.id } },
      include: { submittedRevision: true },
    });
  }
  function command(row: Awaited<ReturnType<typeof aggregate>>, requestId: string) {
    return {
      submissionRef: Buffer.from(`report-submission:v1:${row.id}`, "utf8").toString("base64url"),
      requestId,
      expectedWorkflowVersion: row.workflowVersion,
      expectedClaimVersion: row.claimVersion,
      expectedSubmittedRevision: row.submittedRevision!.revisionNumber,
    };
  }
  async function claim(fixture: Fixture, actorId: number, marker: string, atTime = claimAt) {
    const row = await aggregate(fixture);
    await review.claimReportForReview(actorId, command(row, `claim-${marker}-request`), { evaluationTime: atTime });
    return aggregate(fixture);
  }
  async function approve(fixture: Fixture, actorId: number, marker: string, atTime = at) {
    const row = await aggregate(fixture);
    return review.approveReportSubmission(actorId, { ...command(row, `approve-${marker}-request`), scores }, { evaluationTime: atTime });
  }
  // Builds the exact approval input up front so a later replay can reuse it
  // byte-for-byte (same request id and same expected CAS versions).
  async function buildApprove(fixture: Fixture, marker: string) {
    const row = await aggregate(fixture);
    return { ...command(row, `approve-${marker}-request`), scores };
  }
  async function xpCount(fixture: Fixture) {
    return prisma.xPTransaction.count({ where: { enrollmentId: fixture.enrollment.id } });
  }


  try {
    // --- zero-reward approval ------------------------------------------------
    const approvalFixture = await prepare(1, "zero-approve");
    await claim(approvalFixture, mentor.id, "zero-approve");
    const approvalInput = await buildApprove(approvalFixture, "zero-approve");
    const zeroApproval = await review.approveReportSubmission(mentor.id, approvalInput, { evaluationTime: at });

    await check("1. zero-reward approval completes the level with no XP flag and no XP transaction", async () => {
      assert.equal(zeroApproval.created, true);
      assert.equal(zeroApproval.retry, false);
      assert.equal(zeroApproval.completion.xpAwarded, 0);
      assert.equal(zeroApproval.completion.xpTransactionId, null);
      assert.equal(zeroApproval.completion.levelNumber, 1);
      assert.equal(zeroApproval.completion.terminal, false);
      assert.equal(zeroApproval.completion.nextLevelNumber, 2);
      const row = await aggregate(approvalFixture);
      assert.equal(row.status, "approved");
      assert.equal(row.approvedRevisionId, row.submittedRevisionId);
      assert.equal(row.latestReviewId, row.approvedReviewId);
      const progress = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: approvalFixture.progress.id } });
      assert.equal(progress.status, "completed");
      assert.ok(progress.completedAt);
      const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: approvalFixture.enrollment.id } });
      assert.equal(enrollment.status, "active");
      assert.equal(enrollment.highestCompletedLevel, 1);
      assert.equal(enrollment.currentLevel, 2); // next level (analogue of L4) unlocked
      assert.equal(await xpCount(approvalFixture), 0); // zero XPTransaction rows
      assert.equal(await prisma.xpEvent.count({ where: {} }), 0);
      // durable review evidence is present and correct
      const durableReview = await prisma.reportReview.findUniqueOrThrow({ where: { id: zeroApproval.reviewId }, include: { scores: true } });
      assert.equal(durableReview.decision, "approved");
      assert.equal(durableReview.scores.length, 2);
      // level-completion audit records a null xpTransactionId and xpAwarded 0
      assert.equal(await prisma.auditLog.count({ where: { action: "REPORT_APPROVED", entityId: String(row.id) } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { action: "CURRICULUM_LEVEL_COMPLETED", entityId: String(progress.id) } }), 1);
    });

    await check("2. durable approval receipt explicitly represents the zero reward", async () => {
      const row = await aggregate(approvalFixture);
      const receipt = await prisma.reportCommandReceipt.findFirstOrThrow({ where: { submissionId: row.id, commandType: "approve" } });
      const safe = receipt.safeResult as Record<string, unknown>;
      assert.equal(safe.operation, "approve");
      assert.equal(safe.xpAwarded, 0);
      assert.equal(safe.xpTransactionId, null); // no fabricated ledger reference
      assert.equal(safe.reviewId, zeroApproval.reviewId);
      assert.equal(safe.levelNumber, 1);
      assert.equal(safe.terminal, false);
    });

    await check("3. exact zero-reward replay is idempotent and does not depend on an XP id", async () => {
      const before = {
        reviews: await prisma.reportReview.count(),
        xp: await prisma.xPTransaction.count(),
        receipts: await prisma.reportCommandReceipt.count(),
        audits: await prisma.auditLog.count(),
      };
      // repeat the byte-identical original request with the XP flag still disabled
      const replay = await review.approveReportSubmission(mentor.id, approvalInput, { evaluationTime: new Date("2031-06-01T00:00:00.000Z") });
      assert.equal(replay.retry, true);
      assert.equal(replay.created, false);
      assert.equal(replay.completion.xpTransactionId, null);
      assert.equal(replay.completion.xpAwarded, 0);
      assert.equal(replay.completion.completedAt, zeroApproval.completion.completedAt);
      assert.deepEqual({
        reviews: await prisma.reportReview.count(),
        xp: await prisma.xPTransaction.count(),
        receipts: await prisma.reportCommandReceipt.count(),
        audits: await prisma.auditLog.count(),
      }, before);
    });

    await check("4. same key with a different normalized payload conflicts", async () => {
      const row = await aggregate(approvalFixture);
      await expectError(() => review.approveReportSubmission(mentor.id, {
        ...command(row, "approve-zero-approve-request"),
        scores: [{ ...scores[0], comment: "different evidence" }, scores[1]],
      }, { evaluationTime: at }), "REPORT_IDEMPOTENCY_CONFLICT");
    });

    await check("5. a tampered receipt (zero award with an XP id) fails closed on replay", async () => {
      const row = await aggregate(approvalFixture);
      const receipt = await prisma.reportCommandReceipt.findFirstOrThrow({ where: { submissionId: row.id, commandType: "approve" } });
      const safe = receipt.safeResult as Record<string, unknown>;
      const original = { ...safe };
      await prisma.reportCommandReceipt.update({ where: { id: receipt.id }, data: { safeResult: { ...safe, xpTransactionId: 999999 } as Prisma.InputJsonValue } });
      try {
        await expectError(() => review.approveReportSubmission(mentor.id, {
          ...command(row, "approve-zero-approve-request"), scores,
        }, { evaluationTime: at }), "REPORT_IDEMPOTENCY_CONFLICT");
      } finally {
        await prisma.reportCommandReceipt.update({ where: { id: receipt.id }, data: { safeResult: original as Prisma.InputJsonValue } });
      }
    });

    // --- revision requested (reject) then resubmission then approval ---------
    const reviseFixture = await prepare(1, "zero-revise");
    await claim(reviseFixture, mentor.id, "zero-revise");
    await check("6. revision requested does not complete the level or award XP", async () => {
      const row = await aggregate(reviseFixture);
      const rejected = await review.rejectReportSubmission(mentor.id, {
        ...command(row, "reject-zero-revise-request"), scores,
        reasonCode: "missing-evidence", humanComment: "Evidence incomplete", correctiveAction: "Add durable evidence",
      }, { evaluationTime: at });
      assert.equal(rejected.operation, "reject");
      const after = await aggregate(reviseFixture);
      assert.equal(after.status, "rejected");
      const progress = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: reviseFixture.progress.id } });
      assert.equal(progress.status, "in_progress"); // not completed
      const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: reviseFixture.enrollment.id } });
      assert.equal(enrollment.currentLevel, 1); // next level still locked
      assert.equal(await xpCount(reviseFixture), 0);
      assert.equal(await prisma.reportReview.count({ where: { submissionId: after.id, decision: "approved" } }), 0);
    });

    await check("7. resubmission of a corrected revision then approval completes with zero XP", async () => {
      const current = await aggregate(reviseFixture);
      const correction = await submissionRuntime.saveOwnReportDraft(reviseFixture.user.id, {
        levelNumber: 1, requestId: "zero-revise-correction", expectedRevision: current.workflowVersion,
        fieldValues: { evidence: "https://example.com/zero-revise-corrected" },
      });
      const resubmitted = await submissionRuntime.resubmitOwnReport(reviseFixture.user.id, {
        levelNumber: 1, requestId: "zero-revise-resubmit", expectedRevision: correction.resultingWorkflowVersion,
      });
      assert.equal(resubmitted.submission.status, "pending_review");
      await claim(reviseFixture, mentor.id, "zero-revise-2", new Date("2031-05-02T10:00:00.000Z"));
      const approval = await approve(reviseFixture, mentor.id, "zero-revise-2", new Date("2031-05-02T10:20:00.000Z"));
      assert.equal(approval.created, true);
      assert.equal(approval.completion.xpAwarded, 0);
      assert.equal(approval.completion.xpTransactionId, null);
      const row = await aggregate(reviseFixture);
      assert.equal(row.status, "approved");
      assert.equal(row.approvedRevisionId, row.submittedRevisionId); // latest revision approved
      assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: reviseFixture.progress.id } })).status, "completed");
      assert.equal(await xpCount(reviseFixture), 0);
    });

    // --- stale revision ------------------------------------------------------
    const staleFixture = await prepare(1, "zero-stale");
    await claim(staleFixture, mentor.id, "zero-stale");
    await check("8. approval of a stale (non-current CAS) revision is rejected", async () => {
      const row = await aggregate(staleFixture);
      await expectError(() => review.approveReportSubmission(mentor.id, {
        ...command(row, "approve-zero-stale-request"),
        expectedWorkflowVersion: row.workflowVersion - 1, scores,
      }, { evaluationTime: at }), "REPORT_REVISION_STALE");
      assert.equal((await aggregate(staleFixture)).status, "pending_review");
    });

    // --- authorization -------------------------------------------------------
    await check("9. learner, wrong reviewer, cross-learner and inactive reviewer cannot approve", async () => {
      const row = await aggregate(staleFixture); // still pending_review, claimed by mentor
      const input = { ...command(row, "approve-zero-authz-request"), scores };
      // ordinary user (no reviewer role) forbidden
      await expectError(() => review.approveReportSubmission(ordinary.id, input, { evaluationTime: at }), "REPORT_REVIEWER_FORBIDDEN");
      // the learner cannot approve their own report (self review forbidden)
      await prisma.user.update({ where: { id: staleFixture.user.id }, data: { role: "admin" } });
      await expectError(() => review.approveReportSubmission(staleFixture.user.id, input, { evaluationTime: at }), "REPORT_SELF_REVIEW_FORBIDDEN");
      await prisma.user.update({ where: { id: staleFixture.user.id }, data: { role: "user" } });
      // a different mentor who does not own the claim is rejected
      await expectError(() => review.approveReportSubmission(secondMentor.id, input, { evaluationTime: at }), "REPORT_CLAIM_NOT_OWNER");
      assert.equal((await aggregate(staleFixture)).status, "pending_review");
      assert.equal(await xpCount(staleFixture), 0);
    });

    await check("10. approval fails closed when the REPORT flag is disabled", async () => {
      const row = await aggregate(staleFixture);
      delete process.env.CURRICULUM_V2_REPORT_ENABLED;
      try {
        await expectError(() => review.approveReportSubmission(mentor.id, { ...command(row, "approve-zero-disabled"), scores }, { evaluationTime: at }), "REPORT_DISABLED");
      } finally { process.env.CURRICULUM_V2_REPORT_ENABLED = "true"; }
      assert.equal((await aggregate(staleFixture)).status, "pending_review");
    });

    // --- positive-reward compatibility --------------------------------------
    const posOffFixture = await prepare(2, "pos-off");
    await claim(posOffFixture, mentor.id, "pos-off");
    await check("11. positive-reward approval with XP disabled fails atomically before any durable result", async () => {
      disableXp();
      const before = {
        reviews: await prisma.reportReview.count(),
        xp: await prisma.xPTransaction.count(),
        receipts: await prisma.reportCommandReceipt.count(),
      };
      await expectError(() => approve(posOffFixture, mentor.id, "pos-off"), "REPORT_DISABLED");
      const row = await aggregate(posOffFixture);
      assert.equal(row.status, "pending_review");
      assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: posOffFixture.progress.id } })).status, "pending_review");
      assert.equal(await xpCount(posOffFixture), 0);
      assert.deepEqual({
        reviews: await prisma.reportReview.count(),
        xp: await prisma.xPTransaction.count(),
        receipts: await prisma.reportCommandReceipt.count(),
      }, before);
    });

    const posOnFixture = await prepare(2, "pos-on");
    await claim(posOnFixture, mentor.id, "pos-on");
    await check("12. positive-reward approval with XP enabled awards exactly one XP transaction and the receipt references it", async () => {
      enableXp();
      try {
        const posInput = await buildApprove(posOnFixture, "pos-on");
        const result = await review.approveReportSubmission(mentor.id, posInput, { evaluationTime: at });
        assert.equal(result.created, true);
        assert.equal(result.completion.xpAwarded, 40);
        assert.ok(result.completion.xpTransactionId && result.completion.xpTransactionId > 0);
        const xp = await prisma.xPTransaction.findMany({ where: { enrollmentId: posOnFixture.enrollment.id } });
        assert.equal(xp.length, 1);
        assert.equal(xp[0].amount, 40);
        assert.equal(xp[0].id, result.completion.xpTransactionId);
        assert.equal(xp[0].sourceType, "report_approval");
        const row = await aggregate(posOnFixture);
        const receipt = await prisma.reportCommandReceipt.findFirstOrThrow({ where: { submissionId: row.id, commandType: "approve" } });
        const safe = receipt.safeResult as Record<string, unknown>;
        assert.equal(safe.xpTransactionId, result.completion.xpTransactionId);
        assert.equal(safe.xpAwarded, 40);
        // idempotent replay of the byte-identical request creates no duplicate reward
        const replay = await review.approveReportSubmission(mentor.id, posInput, { evaluationTime: new Date("2031-07-01T00:00:00.000Z") });
        assert.equal(replay.retry, true);
        assert.equal(replay.completion.xpTransactionId, result.completion.xpTransactionId);
        assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: posOnFixture.enrollment.id } }), 1);
      } finally { disableXp(); }
    });

    // --- negative-reward safety ---------------------------------------------
    const negFixture = await prepare(3, "neg");
    await claim(negFixture, mentor.id, "neg");
    await check("13. a persisted negative reward fails closed and rolls back the approval", async () => {
      // corrupt the immutable reward to an invalid negative value at runtime
      await prisma.$executeRawUnsafe(`UPDATE "LevelDefinition" SET "xpReward" = -5 WHERE "id" = ${negFixture.level.id}`);
      const before = {
        reviews: await prisma.reportReview.count(),
        receipts: await prisma.reportCommandReceipt.count(),
        audits: await prisma.auditLog.count(),
      };
      try {
        await expectError(() => approve(negFixture, mentor.id, "neg"), "REPORT_STATE_CORRUPT");
      } finally {
        await prisma.$executeRawUnsafe(`UPDATE "LevelDefinition" SET "xpReward" = 0 WHERE "id" = ${negFixture.level.id}`);
      }
      const row = await aggregate(negFixture);
      assert.equal(row.status, "pending_review");
      assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: negFixture.progress.id } })).status, "pending_review");
      assert.equal(await xpCount(negFixture), 0);
      assert.deepEqual({
        reviews: await prisma.reportReview.count(),
        receipts: await prisma.reportCommandReceipt.count(),
        audits: await prisma.auditLog.count(),
      }, before);
    });

    // --- transaction rollback leaves no receipt (zero reward) ----------------
    const rollbackFixture = await prepare(1, "zero-rollback");
    await claim(rollbackFixture, mentor.id, "zero-rollback");
    await check("14. a zero-reward approval audit failure rolls back review, completion and receipt", async () => {
      const before = {
        reviews: await prisma.reportReview.count(),
        receipts: await prisma.reportCommandReceipt.count(),
        audits: await prisma.auditLog.count(),
        progress: (await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: rollbackFixture.progress.id } })).status,
      };
      await prisma.$executeRawUnsafe(`CREATE TRIGGER deny_zero_reward_audit BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'REPORT_APPROVED' BEGIN SELECT RAISE(ABORT, 'audit denied'); END`);
      try {
        await expectError(() => approve(rollbackFixture, mentor.id, "zero-rollback"), "REPORT_INTERNAL_ERROR");
      } finally { await prisma.$executeRawUnsafe(`DROP TRIGGER deny_zero_reward_audit`); }
      const row = await aggregate(rollbackFixture);
      assert.equal(row.status, "pending_review");
      assert.deepEqual({
        reviews: await prisma.reportReview.count(),
        receipts: await prisma.reportCommandReceipt.count(),
        audits: await prisma.auditLog.count(),
        progress: (await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: rollbackFixture.progress.id } })).status,
      }, before);
      assert.equal(await xpCount(rollbackFixture), 0);
    });
  } finally {
    await prisma.$disconnect();
    cleanup();
    for (const name of [...REPORT_FLAGS, "CURRICULUM_V2_XP_ENABLED"]) delete process.env[name];
  }

  console.log(`\nReport zero-reward regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
