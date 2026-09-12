import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { ReportDomainErrorCode } from "../../src/lib/curriculum/report-errors";
import { isReportDomainError } from "../../src/lib/curriculum/report-errors";

const dbPath = `/tmp/ata-curriculum-report-approval-${process.pid}.db`;
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

async function main() {
  cleanup();
  const migration = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8",
  });
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
  // AFD-5D2A — pinned to ONE connection, for the same reason as
  // `curriculumXpReadApiRegression`: this suite brackets a deliberately
  // FK-violating fixture write with `PRAGMA foreign_keys = OFF` / `= ON`, and
  // that pragma is PER-CONNECTION in SQLite. Through Prisma's pool the UPDATE
  // could land on a connection that never saw the `OFF` and fail with error
  // 787. The defect had not yet fired here; it is the same defect. Foreign keys
  // remain enforced — only the bracket is made to apply to the writing
  // connection.
  process.env.DATABASE_URL = `${dbUrl}?connection_limit=1`;
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_REPORT_ENABLED = "true";
  process.env.CURRICULUM_V2_XP_ENABLED = "true";

  const { prisma } = await import("../../src/lib/prisma");
  const review = await import("../../src/lib/curriculum/report-review");
  const submissionRuntime = await import("../../src/lib/curriculum/report-submission");
  const completion = await import("../../src/lib/curriculum/completion");

  const admin = await prisma.user.create({ data: { email: "approval-admin@example.com", name: "Approval Admin", role: "admin" } });
  const mentor = await prisma.user.create({ data: { email: "approval-mentor@example.com", name: "Approval Mentor", role: "mentor" } });
  const secondMentor = await prisma.user.create({ data: { email: "approval-mentor-two@example.com", name: "Approval Mentor Two", role: "mentor" } });
  const blocked = await prisma.user.create({ data: { email: "approval-blocked@example.com", name: "Blocked", role: "mentor", status: "blocked" } });
  const ordinary = await prisma.user.create({ data: { email: "approval-ordinary@example.com", name: "Ordinary" } });

  async function createGraph(versionNumber: number, levelCount: number, xpReward: number) {
    const curriculum = await prisma.curriculumVersion.create({ data: {
      code: "ata-v2", name: `Approval ${versionNumber}`, versionNumber, status: "published",
      publishedAt: new Date("2026-04-01T00:00:00.000Z"),
    } });
    const moduleDefinition = await prisma.moduleDefinition.create({ data: {
      curriculumVersionId: curriculum.id, moduleNumber: 1, code: `approval-${versionNumber}`,
      title: "Approval", firstLevel: 1, lastLevel: levelCount,
    } });
    const levels = [];
    for (let levelNumber = 1; levelNumber <= levelCount; levelNumber += 1) {
      levels.push(await prisma.levelDefinition.create({ data: {
        curriculumVersionId: curriculum.id, moduleId: moduleDefinition.id, levelNumber,
        stableCode: `v2.l${String(levelNumber).padStart(3, "0")}.report`,
        type: "report", title: `Report ${levelNumber}`, completionMethod: "report_approval",
        xpReward: levelNumber === 1 ? xpReward : 17,
        requiredPreviousLevel: levelNumber > 1 ? levelNumber - 1 : null,
      } }));
    }
    const level = levels[0];
    const assignment = await prisma.reportAssignmentVersion.create({ data: {
      levelDefinitionId: level.id, curriculumVersionId: curriculum.id, versionNumber: 4,
      status: "published", publishedAt: new Date("2026-04-02T00:00:00.000Z"),
    } });
    await prisma.reportAssignmentLocalization.create({ data: {
      reportAssignmentVersionId: assignment.id, locale: "en", title: "Approval assignment",
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
      levelDefinitionId: level.id, curriculumVersionId: curriculum.id,
      reportAssignmentVersionId: assignment.id, reportRubricVersionId: rubric.id, revision: 0,
    } });
    let terminalDefinition: { level: typeof level; assignment: typeof assignment; rubric: typeof rubric; criteria: typeof criteria; scales: typeof scales; xpReward: number } | null = null;
    if (levels.length > 1) {
      const terminalLevel = levels[1];
      const terminalAssignment = await prisma.reportAssignmentVersion.create({ data: {
        levelDefinitionId: terminalLevel.id, curriculumVersionId: curriculum.id, versionNumber: 4,
        status: "published", publishedAt: new Date("2026-04-02T00:00:00.000Z"),
      } });
      await prisma.reportAssignmentLocalization.create({ data: {
        reportAssignmentVersionId: terminalAssignment.id, locale: "en", title: "Terminal approval assignment",
        instructions: "Provide final durable evidence", successCriteriaSummary: "All criteria", submitLabel: "Submit",
      } });
      const terminalField = await prisma.reportFieldDefinition.create({ data: {
        reportAssignmentVersionId: terminalAssignment.id, stableKey: "evidence", type: "url", required: true,
        sortOrder: 0, validationRules: { version: 1, allowedSchemes: ["https"] }, choiceCodes: Prisma.JsonNull,
      } });
      await prisma.reportFieldLocalization.create({ data: {
        reportFieldDefinitionId: terminalField.id, locale: "en", label: "Evidence", helpText: "HTTPS",
        placeholder: "https://example.com", choiceLabels: Prisma.JsonNull,
      } });
      const terminalRubric = await prisma.reportRubricVersion.create({ data: {
        reportAssignmentVersionId: terminalAssignment.id, versionNumber: 6, status: "published",
        publishedAt: new Date("2026-04-02T00:00:00.000Z"),
      } });
      const terminalCriteria = [];
      for (const [stableKey, commentRequired, sortOrder] of [["process", true, 0], ["risk", false, 1]] as const) {
        const criterion = await prisma.reportRubricCriterion.create({ data: {
          reportRubricVersionId: terminalRubric.id, stableKey, categoryCode: `${stableKey}-quality`, sortOrder, commentRequired,
        } });
        await prisma.reportRubricCriterionLocalization.create({ data: {
          reportRubricCriterionId: criterion.id, locale: "en", title: stableKey, description: `${stableKey} description`,
        } });
        terminalCriteria.push(criterion);
      }
      const terminalScales = [];
      for (const [stableKey, ordinal] of [["meets", 0], ["revise", 1]] as const) {
        const scale = await prisma.reportRubricScaleOption.create({ data: { reportRubricVersionId: terminalRubric.id, stableKey, ordinal } });
        await prisma.reportRubricScaleOptionLocalization.create({ data: {
          reportRubricScaleOptionId: scale.id, locale: "en", label: stableKey, description: `${stableKey} description`,
        } });
        terminalScales.push(scale);
      }
      const terminalReason = await prisma.reportRejectionReason.create({ data: {
        reportRubricVersionId: terminalRubric.id, stableKey: "missing-evidence", sortOrder: 0, active: true,
      } });
      await prisma.reportRejectionReasonLocalization.create({ data: {
        reportRejectionReasonId: terminalReason.id, locale: "en", title: "Missing evidence", guidance: "Add evidence",
      } });
      await prisma.levelReportBinding.create({ data: {
        levelDefinitionId: terminalLevel.id, curriculumVersionId: curriculum.id,
        reportAssignmentVersionId: terminalAssignment.id, reportRubricVersionId: terminalRubric.id, revision: 0,
      } });
      terminalDefinition = {
        level: terminalLevel, assignment: terminalAssignment, rubric: terminalRubric,
        criteria: terminalCriteria, scales: terminalScales, xpReward: 17,
      };
    }
    return { curriculum, moduleDefinition, levels, level, assignment, rubric, criteria, scales, xpReward, terminalDefinition };
  }

  const ordinaryGraph = await createGraph(41, 2, 73);
  assert.ok(ordinaryGraph.terminalDefinition);
  const finalGraph = { ...ordinaryGraph, ...ordinaryGraph.terminalDefinition, xpReward: 17 };
  let authorSequence = 0;
  async function prepare(graph: typeof ordinaryGraph, marker: string, levelNumber = 1) {
    authorSequence += 1;
    const user = await prisma.user.create({ data: {
      email: `approval-author-${authorSequence}@example.com`, name: `Author ${authorSequence}`,
    } });
    const enrollment = await prisma.userCurriculumEnrollment.create({ data: {
      userId: user.id, curriculumVersionId: graph.curriculum.id, curriculumCode: graph.curriculum.code,
      status: "active", currentLevel: levelNumber, highestCompletedLevel: levelNumber - 1,
    } });
    if (levelNumber > 1) {
      await prisma.userLevelProgress.create({ data: {
        enrollmentId: enrollment.id, curriculumVersionId: graph.curriculum.id, levelDefinitionId: graph.levels[0].id,
        status: "completed", startedAt: new Date("2026-04-01T00:00:00.000Z"),
        completedAt: new Date("2026-04-02T00:00:00.000Z"), lastProgressAt: new Date("2026-04-02T00:00:00.000Z"),
      } });
    }
    const progress = await prisma.userLevelProgress.create({ data: {
      enrollmentId: enrollment.id, curriculumVersionId: graph.curriculum.id, levelDefinitionId: graph.level.id,
      status: "in_progress", startedAt: new Date("2026-04-03T00:00:00.000Z"),
    } });
    const saved = await submissionRuntime.saveOwnReportDraft(user.id, {
      levelNumber, requestId: `save-${marker}-request`, expectedRevision: 0,
      fieldValues: { evidence: `https://example.com/${marker}` },
    });
    await submissionRuntime.submitOwnReport(user.id, {
      levelNumber, requestId: `submit-${marker}-request`, expectedRevision: saved.resultingWorkflowVersion,
    });
    return { user, enrollment, progress, graph };
  }

  const fixtures = [
    await prepare(ordinaryGraph, "flags"), await prepare(ordinaryGraph, "mentor"), await prepare(ordinaryGraph, "admin"),
    await prepare(ordinaryGraph, "expired"), await prepare(ordinaryGraph, "retry"), await prepare(ordinaryGraph, "race-one"),
    await prepare(ordinaryGraph, "race-two"), await prepare(ordinaryGraph, "audit"), await prepare(ordinaryGraph, "xp-failure"),
    await prepare(ordinaryGraph, "completion-failure"), await prepare(ordinaryGraph, "corrupt"),
    await prepare(ordinaryGraph, "rejected-proof"), await prepare(ordinaryGraph, "wrong-proof"),
    // LO-REVIEW-WORKITEM-UNREACHABLE-1 — prepared HERE with every other
    // fixture, because the suite archives the curriculum immediately below and
    // `prepare()` cannot run against an archived version afterwards.
    await prepare(ordinaryGraph, "mirror-resubmit"), await prepare(ordinaryGraph, "mirror-race"),
    await prepare(ordinaryGraph, "mirror-refuse"), await prepare(ordinaryGraph, "mirror-approve"),
    await prepare(ordinaryGraph, "mirror-repair"), await prepare(ordinaryGraph, "mirror-decision-race"),
    await prepare(finalGraph, "final", 2),
  ];
  const [flagFixture, mentorFixture, adminFixture, expiredFixture, retryFixture, approveRaceFixture,
    decisionRaceFixture, auditFixture, xpFailureFixture, completionFailureFixture, corruptFixture,
    rejectedProofFixture, wrongProofFixture,
    mirrorResubmitFixture, mirrorRaceFixture, mirrorRefuseFixture, mirrorApproveFixture,
    mirrorRepairFixture, mirrorDecisionRaceFixture,
    finalFixture] = fixtures;

  await prisma.curriculumVersion.updateMany({ data: { status: "archived" } });
  await prisma.reportAssignmentVersion.updateMany({ data: { status: "archived", archivedAt: new Date("2027-01-01T00:00:00.000Z") } });
  await prisma.reportRubricVersion.updateMany({ data: { status: "archived", archivedAt: new Date("2027-01-01T00:00:00.000Z") } });

  const scores = [
    { criterionCode: "process", scaleCode: "meets", comment: "Complete process evidence" },
    { criterionCode: "risk", scaleCode: "meets" },
  ];
  const evaluationTime = new Date("2031-05-01T10:20:00.000Z");
  async function aggregate(fixture: typeof flagFixture) {
    return prisma.reportSubmission.findUniqueOrThrow({
      where: { enrollmentId_levelDefinitionId: { enrollmentId: fixture.enrollment.id, levelDefinitionId: fixture.graph.level.id } },
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
  async function claim(fixture: typeof flagFixture, actorId: number, marker: string, at = new Date("2031-05-01T10:00:00.000Z")) {
    const row = await aggregate(fixture);
    await review.claimReportForReview(actorId, command(row, `claim-${marker}-request`), { evaluationTime: at });
    return aggregate(fixture);
  }
  async function approve(fixture: typeof flagFixture, actorId: number, marker: string, at = evaluationTime) {
    const row = await aggregate(fixture);
    return review.approveReportSubmission(actorId, { ...command(row, `approve-${marker}-request`), scores }, { evaluationTime: at });
  }
  async function unchanged(fixture: typeof flagFixture) {
    const row = await aggregate(fixture);
    assert.equal(row.status, "pending_review");
    assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: fixture.progress.id } })).status, "pending_review");
    assert.equal(await prisma.reportReview.count({ where: { submissionId: row.id } }), 0);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: fixture.enrollment.id } }), 0);
    assert.equal(await prisma.reportCommandReceipt.count({ where: { submissionId: row.id, commandType: "approve" } }), 0);
  }

  try {
    await claim(flagFixture, mentor.id, "flags");
    await check("1. READ, ENROLLMENT, REPORT and XP flags are all required", async () => {
      for (const name of ["CURRICULUM_V2_READ_ENABLED", "CURRICULUM_V2_ENROLLMENT_ENABLED", "CURRICULUM_V2_REPORT_ENABLED", "CURRICULUM_V2_XP_ENABLED"] as const) {
        delete process.env[name];
        await expectError(() => approve(flagFixture, mentor.id, `disabled-${name.toLowerCase()}`), "REPORT_DISABLED");
        process.env[name] = "true";
      }
      await unchanged(flagFixture);
    });
    await check("2. inactive, ordinary and self reviewers are forbidden", async () => {
      const row = await aggregate(flagFixture);
      const input = { ...command(row, "approve-forbidden-request"), scores };
      await expectError(() => review.approveReportSubmission(blocked.id, input, { evaluationTime }), "REPORT_REVIEWER_FORBIDDEN");
      await expectError(() => review.approveReportSubmission(ordinary.id, input, { evaluationTime }), "REPORT_REVIEWER_FORBIDDEN");
      await prisma.user.update({ where: { id: flagFixture.user.id }, data: { role: "admin" } });
      await expectError(() => review.approveReportSubmission(flagFixture.user.id, input, { evaluationTime }), "REPORT_SELF_REVIEW_FORBIDDEN");
      await prisma.user.update({ where: { id: flagFixture.user.id }, data: { role: "user" } });
    });
    await claim(mentorFixture, mentor.id, "mentor");
    const mentorApproval = await approve(mentorFixture, mentor.id, "mentor");
    await check("3. mentor approval atomically writes immutable evidence, exact XP and non-final progression", async () => {
      assert.equal(mentorApproval.created, true); assert.equal(mentorApproval.completion.xpAwarded, 73);
      assert.equal(mentorApproval.completion.nextLevelNumber, 2); assert.equal(mentorApproval.completion.terminal, false);
      const row = await aggregate(mentorFixture);
      assert.equal(row.status, "approved"); assert.equal(row.claimedById, null);
      assert.equal(row.approvedRevisionId, row.submittedRevisionId); assert.equal(row.latestReviewId, row.approvedReviewId);
      const durableReview = await prisma.reportReview.findUniqueOrThrow({ where: { id: mentorApproval.reviewId }, include: { scores: true } });
      assert.equal(durableReview.decision, "approved"); assert.equal(durableReview.scores.length, 2);
      assert.equal(durableReview.rejectionReasonId, null); assert.equal(durableReview.humanComment, null);
      const progress = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: mentorFixture.progress.id } });
      const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: mentorFixture.enrollment.id } });
      assert.equal(progress.status, "completed"); assert.equal(enrollment.status, "active");
      assert.equal(enrollment.highestCompletedLevel, 1); assert.equal(enrollment.currentLevel, 2);
      const xp = await prisma.xPTransaction.findMany({ where: { enrollmentId: enrollment.id } });
      assert.equal(xp.length, 1); assert.equal(xp[0].amount, mentorFixture.graph.xpReward);
      assert.equal(xp[0].sourceType, "report_approval"); assert.equal(xp[0].sourceId, `report-review:${durableReview.id}`);
      assert.equal(await prisma.auditLog.count({ where: { action: "REPORT_APPROVED", entityId: String(row.id) } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { action: "CURRICULUM_LEVEL_COMPLETED", entityId: String(progress.id) } }), 1);
    });
    await claim(adminFixture, admin.id, "admin");
    await check("4. active admin can approve an archived pinned graph", async () => {
      const result = await approve(adminFixture, admin.id, "admin");
      assert.equal(result.created, true);
      assert.equal((await prisma.reportReview.findUniqueOrThrow({ where: { id: result.reviewId } })).reviewerRoleSnapshot, "admin");
    });
    await claim(expiredFixture, mentor.id, "expired", new Date("2031-05-01T08:00:00.000Z"));
    await check("5. active owner and unexpired exact claim are mandatory", async () => {
      await expectError(() => approve(expiredFixture, secondMentor.id, "wrong-owner"), "REPORT_CLAIM_NOT_OWNER");
      await expectError(() => approve(expiredFixture, mentor.id, "expired"), "REPORT_CLAIM_EXPIRED");
      const expired = await aggregate(expiredFixture);
      await review.claimReportForReview(mentor.id, command(expired, "claim-expired-fresh"), { evaluationTime: new Date("2031-05-01T10:00:00.000Z") });
      const stale = await aggregate(expiredFixture);
      await expectError(() => review.approveReportSubmission(mentor.id, {
        ...command(stale, "approve-stale-cas"), expectedWorkflowVersion: stale.workflowVersion - 1, scores,
      }, { evaluationTime }), "REPORT_REVISION_STALE");
    });
    await check("6. incomplete, duplicate and foreign rubric evidence fails before durable writes", async () => {
      const row = await aggregate(expiredFixture);
      const base = command(row, "approve-invalid-rubric");
      await expectError(() => review.approveReportSubmission(mentor.id, { ...base, scores: [scores[0]] }, { evaluationTime }), "REPORT_REVIEW_INPUT_INVALID");
      await expectError(() => review.approveReportSubmission(mentor.id, { ...base, requestId: "approve-duplicate-rubric", scores: [scores[0], scores[0]] }, { evaluationTime }), "REPORT_REVIEW_INPUT_INVALID");
      await expectError(() => review.approveReportSubmission(mentor.id, {
        ...base, requestId: "approve-foreign-rubric", scores: [{ criterionCode: "process", scaleCode: "foreign", comment: "complete" }, scores[1]],
      }, { evaluationTime }), "REPORT_RUBRIC_MISMATCH");
      await unchanged(expiredFixture);
    });
    await claim(retryFixture, mentor.id, "retry");
    const retryRow = await aggregate(retryFixture);
    const retryInput = { ...command(retryRow, "approve-exact-retry"), scores };
    const first = await review.approveReportSubmission(mentor.id, retryInput, { evaluationTime });
    await check("7. exact retry verifies durable state and is timestamp/audit/XP inert", async () => {
      const before = { reviews: await prisma.reportReview.count(), scores: await prisma.reportReviewScore.count(), xp: await prisma.xPTransaction.count(), audits: await prisma.auditLog.count() };
      const retried = await review.approveReportSubmission(mentor.id, retryInput, { evaluationTime: new Date("2031-05-01T11:00:00.000Z") });
      assert.equal(retried.created, false); assert.equal(retried.retry, true);
      assert.equal(retried.appliedAt, first.appliedAt); assert.equal(retried.completion.completedAt, first.completion.completedAt);
      assert.deepEqual({ reviews: await prisma.reportReview.count(), scores: await prisma.reportReviewScore.count(), xp: await prisma.xPTransaction.count(), audits: await prisma.auditLog.count() }, before);
    });
    await check("8. same key with another normalized payload conflicts", async () => {
      await expectError(() => review.approveReportSubmission(mentor.id, {
        ...retryInput, scores: [{ ...scores[0], comment: "different" }, scores[1]],
      }, { evaluationTime }), "REPORT_IDEMPOTENCY_CONFLICT");
    });
    await claim(approveRaceFixture, mentor.id, "approve-race");
    await check("9. competing approve commands have exactly one winner", async () => {
      const row = await aggregate(approveRaceFixture);
      const outcomes = await Promise.allSettled([
        review.approveReportSubmission(mentor.id, { ...command(row, "approve-race-first"), scores }, { evaluationTime }),
        review.approveReportSubmission(mentor.id, { ...command(row, "approve-race-second"), scores }, { evaluationTime }),
      ]);
      assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(await prisma.reportReview.count({ where: { submissionId: row.id } }), 1);
      assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: approveRaceFixture.enrollment.id } }), 1);
    });
    await claim(decisionRaceFixture, mentor.id, "decision-race");
    await check("10. approve/reject race has exactly one atomic terminal winner", async () => {
      const row = await aggregate(decisionRaceFixture);
      const base = command(row, "decision-race-approve");
      const outcomes = await Promise.allSettled([
        review.approveReportSubmission(mentor.id, { ...base, scores }, { evaluationTime }),
        review.rejectReportSubmission(mentor.id, {
          ...base, requestId: "decision-race-reject", scores, reasonCode: "missing-evidence",
          humanComment: "Evidence is incomplete", correctiveAction: "Add durable evidence",
        }, { evaluationTime }),
      ]);
      assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
      const durable = await aggregate(decisionRaceFixture);
      assert.ok(durable.status === "approved" || durable.status === "rejected");
      assert.equal(await prisma.reportReview.count({ where: { submissionId: row.id } }), 1);
      assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: decisionRaceFixture.enrollment.id } }), durable.status === "approved" ? 1 : 0);
    });
    async function rollbackWithTrigger(fixture: typeof flagFixture, trigger: string, marker: string) {
      await claim(fixture, mentor.id, marker);
      const row = await aggregate(fixture);
      const beforeAudits = await prisma.auditLog.count();
      await prisma.$executeRawUnsafe(trigger);
      try { await expectError(() => approve(fixture, mentor.id, marker), "REPORT_INTERNAL_ERROR"); }
      finally { await prisma.$executeRawUnsafe(`DROP TRIGGER deny_${marker.replaceAll("-", "_")}`); }
      await unchanged(fixture);
      assert.equal(await prisma.auditLog.count(), beforeAudits);
      assert.equal((await aggregate(fixture)).workflowVersion, row.workflowVersion);
    }
    await check("11. report approval audit failure rolls back review, XP, completion, receipt and audits", async () => {
      await rollbackWithTrigger(auditFixture,
        `CREATE TRIGGER deny_audit_failure BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'REPORT_APPROVED' BEGIN SELECT RAISE(ABORT, 'audit denied'); END`,
        "audit-failure");
    });
    await check("12. XP write failure rolls back the complete approval transaction", async () => {
      await rollbackWithTrigger(xpFailureFixture,
        `CREATE TRIGGER deny_xp_failure BEFORE INSERT ON "XPTransaction" BEGIN SELECT RAISE(ABORT, 'xp denied'); END`,
        "xp-failure");
    });
    await check("13. completion progress failure rolls back the complete approval transaction", async () => {
      await rollbackWithTrigger(completionFailureFixture,
        `CREATE TRIGGER deny_completion_failure BEFORE UPDATE ON "UserLevelProgress" WHEN NEW."status" = 'completed' BEGIN SELECT RAISE(ABORT, 'completion denied'); END`,
        "completion-failure");
    });
    await claim(corruptFixture, mentor.id, "corrupt");
    await check("14. invalid immutable NEGATIVE XP reward fails closed and rolls back approval evidence", async () => {
      // xpReward 0 is a valid zero-reward level (RR-1); a NEGATIVE reward is the
      // genuinely invalid case that must fail closed and roll back all evidence.
      await prisma.levelDefinition.update({ where: { id: corruptFixture.graph.level.id }, data: { xpReward: -5 } });
      await expectError(() => approve(corruptFixture, mentor.id, "corrupt"), "REPORT_STATE_CORRUPT");
      await unchanged(corruptFixture);
      await prisma.levelDefinition.update({ where: { id: corruptFixture.graph.level.id }, data: { xpReward: corruptFixture.graph.xpReward } });
    });
    async function manualReview(fixture: typeof flagFixture, decision: "approved" | "rejected") {
      const row = await claim(fixture, mentor.id, `${decision}-proof`);
      const revision = row.submittedRevision!;
      const fingerprint = `sha256:${"a".repeat(64)}`;
      const created = await prisma.reportReview.create({ data: {
        submissionId: row.id, revisionId: revision.id,
        curriculumVersionId: row.curriculumVersionId, levelDefinitionId: row.levelDefinitionId,
        reportAssignmentVersionId: row.reportAssignmentVersionId, reportRubricVersionId: row.reportRubricVersionId,
        reviewerId: mentor.id, reviewerRoleSnapshot: "mentor", decision,
        humanComment: decision === "rejected" ? "Rejected" : null,
        correctiveAction: decision === "rejected" ? "Correct" : null,
        rejectionReasonId: decision === "rejected" ? (await prisma.reportRejectionReason.findFirstOrThrow({ where: { reportRubricVersionId: row.reportRubricVersionId } })).id : null,
        requestId: `manual-${decision}-proof`, payloadFingerprint: fingerprint,
        claimedAt: row.claimedAt, claimExpiresAt: row.claimExpiresAt, reviewedAt: evaluationTime,
      } });
      await prisma.reportReviewScore.createMany({ data: fixture.graph.criteria.map((criterion) => ({
        reportReviewId: created.id, reportRubricVersionId: fixture.graph.rubric.id,
        rubricCriterionId: criterion.id, rubricScaleOptionId: fixture.graph.scales[0].id,
        comment: criterion.commentRequired ? "Complete evidence" : null,
      })) });
      return created;
    }
    await check("15. rejected review cannot serve as report_approval evidence", async () => {
      const rejected = await manualReview(rejectedProofFixture, "rejected");
      const result = await completion.completeCurriculumLevel({
        enrollmentId: rejectedProofFixture.enrollment.id, levelDefinitionId: rejectedProofFixture.graph.level.id,
        sourceType: "report_approval", sourceId: `report-review:${rejected.id}`, actorId: mentor.id, evaluationTime,
      });
      assert.deepEqual(result, { kind: "corrupt", code: "COMPLETION_STATE_CORRUPT" });
      assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: rejectedProofFixture.progress.id } })).status, "pending_review");
    });
    await check("16. approved review for a different revision cannot serve as report_approval evidence", async () => {
      const wrong = await manualReview(wrongProofFixture, "approved");
      const row = await aggregate(wrongProofFixture);
      const replacement = await prisma.reportRevision.create({ data: {
        submissionId: row.id,
        revisionNumber: row.submittedRevision!.revisionNumber + 1,
        kind: "resubmission",
        sourceRevisionId: row.submittedRevisionId,
        content: row.submittedRevision!.content as Prisma.InputJsonValue,
        contentFingerprint: row.submittedRevision!.contentFingerprint,
        createdById: wrongProofFixture.user.id,
        submittedAt: evaluationTime,
      } });
      await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = OFF`);
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "ReportSubmission" SET "activeRevisionId" = ?, "submittedRevisionId" = ?, "submittedAt" = ? WHERE "id" = ?`,
          replacement.id, replacement.id, evaluationTime, row.id,
        );
      } finally {
        await prisma.$executeRawUnsafe(`PRAGMA foreign_keys = ON`);
      }
      const shifted = await aggregate(wrongProofFixture);
      const shiftedReview = await prisma.reportReview.findUniqueOrThrow({ where: { id: wrong.id } });
      assert.equal(shifted.submittedRevisionId, replacement.id);
      assert.equal(shiftedReview.revisionId, wrong.revisionId);
      assert.notEqual(shiftedReview.revisionId, shifted.submittedRevisionId);
      const result = await completion.completeCurriculumLevel({
        enrollmentId: wrongProofFixture.enrollment.id, levelDefinitionId: wrongProofFixture.graph.level.id,
        sourceType: "report_approval", sourceId: `report-review:${wrong.id}`, actorId: mentor.id, evaluationTime,
      });
      assert.deepEqual(result, { kind: "corrupt", code: "COMPLETION_STATE_CORRUPT" });
    });
    await claim(finalFixture, mentor.id, "final");
    await check("17. final report approval completes the pinned enrollment", async () => {
      const result = await approve(finalFixture, mentor.id, "final");
      assert.equal(result.completion.terminal, true); assert.equal(result.completion.nextLevelNumber, null);
      assert.equal(result.completion.levelNumber, 2); assert.equal(result.completion.xpAwarded, 17);
      const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: finalFixture.enrollment.id } });
      assert.equal(enrollment.status, "completed"); assert.equal(enrollment.highestCompletedLevel, 2);
      assert.equal(enrollment.currentLevel, 3); assert.equal(enrollment.completedAt?.toISOString(), evaluationTime.toISOString());
    });
    await check("18. Phase 5B.5a writes no V1, notification, CRM or attachment records", async () => {
      assert.equal(await prisma.taskReport.count(), 0);
      assert.equal(await prisma.xpEvent.count(), 0);
      assert.equal(await prisma.notification.count(), 0);
      assert.equal(await prisma.reportAttachment.count(), 0);
      assert.equal(await prisma.auditLog.count({ where: { action: { contains: "CRM" } } }), 0);
    });
    /* ------------------------------------------------------------------ */
    /* LO-REVIEW-WORKITEM-UNREACHABLE-1 — the derived operational mirror.   */
    /*                                                                      */
    /* These live HERE, beside the canonical fixtures, rather than in a      */
    /* suite of their own: the whole claim is that the mirror is produced BY */
    /* the canonical owner, so proving it against anything other than the    */
    /* real submit/reject/approve commands would prove nothing.              */
    /* ------------------------------------------------------------------ */

    async function workItems(fixture: typeof flagFixture) {
      const row = await aggregate(fixture);
      return prisma.learnerOpsCase.findMany({ where: { reportSubmissionId: row.id } });
    }

    await check("R1. submitting a report creates exactly one anchored report_review work item", async () => {
      // `prepare()` above submitted through the real command. If the integration
      // were absent this is 0, which is the defect as found in PREPROD.
      const cases = await workItems(auditFixture);
      assert.equal(cases.length, 1, "exactly one operational mirror per canonical report");
      const [item] = cases;
      assert.equal(item.type, "report_review");
      assert.equal(item.userId, auditFixture.user.id, "anchored to the learner who submitted");
      assert.ok(item.reportSubmissionId, "the canonical anchor must be present");
      const queue = await prisma.learnerOpsQueue.findUniqueOrThrow({ where: { id: item.queueId } });
      assert.equal(queue.key, "report_review", "routed to the seeded report-review queue");
      assert.ok(item.slaPolicyId, "the operational SLA policy must be applied");
      assert.ok(item.resolutionDueAt, "a review work item carries a resolution target");
      const events = await prisma.learnerOpsCaseEvent.findMany({ where: { caseId: item.id } });
      assert.ok(events.some((e) => e.eventType === "created"), "operational timeline provenance exists");
    });

    await check("R2. a resubmission reuses the SAME work item — no second case", async () => {
      const fixture = mirrorResubmitFixture;
      const first = await workItems(fixture);
      assert.equal(first.length, 1);

      // Reject through the real command, then resubmit through the real command.
      await claim(fixture, mentor.id, "mirror-resubmit");
      const claimed = await aggregate(fixture);
      const reason = await prisma.reportRejectionReason.findFirstOrThrow({
        where: { reportRubricVersionId: claimed.reportRubricVersionId },
      });
      await review.rejectReportSubmission(mentor.id, {
        ...command(claimed, "reject-mirror-resubmit-request"),
        scores, reasonCode: reason.stableKey,
        humanComment: "Нужно добавить доказательство.", correctiveAction: "Добавьте ссылку.",
      }, { evaluationTime });

      const afterReject = await workItems(fixture);
      assert.equal(afterReject.length, 1, "a revision request must not open a second case");
      assert.equal(
        afterReject[0].status, "waiting_learner",
        "R4: the ball is with the learner, and the SLA engine pauses on exactly this state",
      );
      assert.ok(afterReject[0].clockPausedAt, "the resolution clock must actually be paused");

      const rejected = await aggregate(fixture);
      const saved = await submissionRuntime.saveOwnReportDraft(fixture.user.id, {
        levelNumber: 1, requestId: "save-mirror-resubmit-2", expectedRevision: rejected.workflowVersion,
        fieldValues: { evidence: "https://example.com/mirror-resubmit-2" },
      });
      await submissionRuntime.resubmitOwnReport(fixture.user.id, {
        levelNumber: 1, requestId: "resubmit-mirror-request", expectedRevision: saved.resultingWorkflowVersion,
      });

      const afterResubmit = await workItems(fixture);
      assert.equal(afterResubmit.length, 1, "R5: still one case after the resubmission");
      assert.equal(afterResubmit[0].id, first[0].id, "and it is the SAME case, not a replacement");
      assert.equal(afterResubmit[0].status, "in_progress", "operational work is actionable again");
      assert.equal(afterResubmit[0].clockPausedAt, null, "the clock resumed when the learner answered");
      assert.ok(afterResubmit[0].pausedMs > 0, "the paused interval was banked, not discarded");

      // The whole history survives.
      const events = await prisma.learnerOpsCaseEvent.findMany({
        where: { caseId: first[0].id }, orderBy: { caseVersion: "asc" },
      });
      assert.ok(events.length >= 3, "created + revision requested + resubmitted at minimum");
    });

    await check("R3. a concurrent ensure cannot produce two work items", async () => {
      const fixture = mirrorRaceFixture;
      const row = await aggregate(fixture);
      const workItemModule = await import("../../src/lib/learner-ops/review-work-items");
      const ensureOnce = () =>
        prisma.$transaction((tx) =>
          workItemModule.ensureReportReviewWorkItem(tx, {
            submissionId: row.id, userId: fixture.user.id,
            levelNumber: 1, levelTitle: "Report 1",
          }),
        );
      const results = await Promise.allSettled([ensureOnce(), ensureOnce(), ensureOnce()]);
      const cases = await workItems(fixture);
      assert.equal(cases.length, 1, "the partial unique index is the backstop and it held");
      assert.ok(
        results.some((r) => r.status === "fulfilled"),
        "at least one ensure must succeed",
      );
      for (const settled of results) {
        if (settled.status === "fulfilled") {
          assert.equal(settled.value.caseId, cases[0].id, "every winner names the same case");
        }
      }
    });

    await check("R6. a generic resolve is refused while the report is not approved", async () => {
      const fixture = mirrorRefuseFixture;
      const [item] = await workItems(fixture);
      const learnerOps = await import("../../src/lib/learner-ops/case");
      const staffProfile = await prisma.staffProfile.upsert({
        where: { userId: mentor.id },
        create: { userId: mentor.id, displayName: "Approval Mentor", staffRole: "mentor" },
        update: {},
      });
      const actor = { staffId: staffProfile.id, userId: mentor.id };
      for (const nextStatus of ["resolved", "closed"] as const) {
        let code: string | null = null;
        try {
          await learnerOps.transitionCase({
            caseId: item.id, expectedVersion: item.version, nextStatus, actor,
          });
        } catch (error) {
          code = (error as { code?: string }).code ?? null;
        }
        assert.equal(
          code, "LEARNER_OPS_CANONICAL_REVIEW_OPEN",
          `${nextStatus} must be refused while the canonical report is open`,
        );
      }
      // ...and the projection withholds them, so no operator is offered the failure.
      const queue = await import("../../src/lib/learner-ops/queue");
      const detail = await queue.getCaseDetail(item.id);
      assert.ok(!detail.allowedTransitions.includes("resolved"));
      assert.ok(!detail.allowedTransitions.includes("closed"));
      // The canonical report is untouched by the refusals.
      assert.equal((await aggregate(fixture)).status, "pending_review");
    });

    await check("R7/R8. canonical approval resolves the mirror exactly once", async () => {
      const fixture = mirrorApproveFixture;
      const [before] = await workItems(fixture);
      await claim(fixture, mentor.id, "mirror-approve");
      const result = await approve(fixture, mentor.id, "mirror-approve");
      assert.ok(result);

      const [after] = await workItems(fixture);
      assert.equal(after.id, before.id, "the same case, reconciled — not a new one");
      assert.equal(after.status, "resolved", "the mirror follows the canonical outcome");
      assert.ok(after.resolvedAt, "resolvedAt is stamped");
      assert.equal((await aggregate(fixture)).status, "approved");

      const versionAfterFirst = after.version;
      const resolvedEvents = await prisma.learnerOpsCaseEvent.count({
        where: { caseId: after.id, eventType: "resolved" },
      });
      assert.equal(resolvedEvents, 1, "exactly one resolution in the timeline");

      // R8 — a retry of the canonical decision changes nothing operational.
      const retryRow = await aggregate(fixture);
      await review.approveReportSubmission(mentor.id, {
        ...command(retryRow, `approve-mirror-approve-request`), scores,
      }, { evaluationTime }).catch(() => undefined);
      const [afterRetry] = await workItems(fixture);
      assert.equal(afterRetry.version, versionAfterFirst, "no second version bump");
      assert.equal(
        await prisma.learnerOpsCaseEvent.count({ where: { caseId: after.id, eventType: "resolved" } }),
        1,
        "no second resolution event",
      );
      assert.equal(
        await prisma.userLevelProgress.count({
          where: { enrollmentId: fixture.enrollment.id, levelDefinitionId: fixture.graph.level.id, status: "completed" },
        }),
        1,
        "progression completed exactly once",
      );
    });

    await check("R9. a missing mirror can be rebuilt without touching canonical state", async () => {
      const fixture = mirrorRepairFixture;
      const row = await aggregate(fixture);
      const [item] = await workItems(fixture);

      // Simulate the pre-fix world: a canonical pending report with no mirror.
      await prisma.learnerOpsCaseEvent.deleteMany({ where: { caseId: item.id } });
      await prisma.learnerOpsCase.delete({ where: { id: item.id } });
      assert.equal((await workItems(fixture)).length, 0);

      const canonicalBefore = await aggregate(fixture);
      const progressBefore = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: fixture.progress.id } });

      const reconciler = await import("../../src/lib/learner-ops/reconcile-review-work-items");
      const outcome = await reconciler.reconcileReviewWorkItems({ apply: true });
      assert.ok(outcome.reportsRepaired >= 1, "the reconciler rebuilt the missing mirror");

      const rebuilt = await workItems(fixture);
      assert.equal(rebuilt.length, 1);
      assert.equal(rebuilt[0].reportSubmissionId, row.id, "anchored to the same canonical report");

      const canonicalAfter = await aggregate(fixture);
      assert.equal(canonicalAfter.status, canonicalBefore.status, "canonical report state untouched");
      assert.equal(canonicalAfter.workflowVersion, canonicalBefore.workflowVersion);
      assert.deepEqual(
        await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: fixture.progress.id } }),
        progressBefore,
        "progression untouched by repair",
      );

      // Idempotent: a second run repairs nothing.
      const second = await reconciler.reconcileReviewWorkItems({ apply: true });
      assert.equal(second.reportsRepaired, 0);
      assert.equal((await workItems(fixture)).length, 1);
    });

    await check("§22. approve vs revision-request: one winner, one operational truth", async () => {
      // The decision race, run against a sanctioned parallel fixture so the
      // accepted journey is never destroyed to produce it.
      // Its OWN fixture: `decisionRaceFixture` is already spent by the
      // canonical decision race earlier in this suite.
      const fixture = mirrorDecisionRaceFixture;
      const [item] = await workItems(fixture);
      assert.ok(item, "the racing fixture must already carry its mirror");

      await claim(fixture, mentor.id, "decision-race-mirror");
      const row = await aggregate(fixture);
      const reason = await prisma.reportRejectionReason.findFirstOrThrow({
        where: { reportRubricVersionId: row.reportRubricVersionId },
      });

      const [approveOutcome, rejectOutcome] = await Promise.allSettled([
        review.approveReportSubmission(mentor.id, {
          ...command(row, "race-approve-request"), scores,
        }, { evaluationTime }),
        review.rejectReportSubmission(mentor.id, {
          ...command(row, "race-reject-request"), scores, reasonCode: reason.stableKey,
          humanComment: "Нужны доказательства.", correctiveAction: "Добавьте ссылку.",
        }, { evaluationTime }),
      ]);

      const winners = [approveOutcome, rejectOutcome].filter((r) => r.status === "fulfilled");
      assert.equal(winners.length, 1, "exactly one canonical decision may win");

      const canonical = await aggregate(fixture);
      assert.ok(["approved", "rejected"].includes(canonical.status));

      const after = await workItems(fixture);
      assert.equal(after.length, 1, "no duplicate work item survived the race");
      // The operational state follows the winner and nothing else.
      assert.equal(
        after[0].status,
        canonical.status === "approved" ? "resolved" : "waiting_learner",
        "the mirror reflects the canonical winner",
      );

      // No double progression whichever way it went.
      assert.ok(
        (await prisma.userLevelProgress.count({
          where: {
            enrollmentId: fixture.enrollment.id,
            levelDefinitionId: fixture.graph.level.id,
            status: "completed",
          },
        })) <= 1,
        "a level cannot complete twice",
      );
      assert.ok(
        (await prisma.learnerOpsCaseEvent.count({
          where: { caseId: after[0].id, eventType: "resolved" },
        })) <= 1,
        "at most one operational resolution",
      );
    });

    await check("§11. every pending canonical review has exactly one work item, both directions", async () => {
      const reconciler = await import("../../src/lib/learner-ops/reconcile-review-work-items");
      const outcome = await reconciler.reconcileReviewWorkItems({ apply: false });
      assert.equal(
        outcome.reportsMissingWorkItem, 0,
        "no canonical pending report may lack its operational item",
      );
      assert.equal(
        outcome.mentorReviewsMissingWorkItem, 0,
        "no canonical pending mentor review may lack its operational item",
      );
      assert.equal(outcome.orphanedWorkItems, 0, "and no operational item may lack its canonical object");
      // Second direction, asked of the database rather than of the reporter.
      const duplicated = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*) AS n FROM (
           SELECT "reportSubmissionId" FROM "LearnerOpsCase"
           WHERE "reportSubmissionId" IS NOT NULL
           GROUP BY "reportSubmissionId" HAVING COUNT(*) > 1
         )`,
      );
      assert.equal(Number(duplicated[0].n), 0, "no canonical report carries two work items");
    });

    await check("R10. an orphan report_review case is impossible", async () => {
      const learnerOps = await import("../../src/lib/learner-ops/case");
      let code: string | null = null;
      try {
        await learnerOps.createCase({
          userId: ordinary.id, type: "report_review", queueKey: "report_review",
          subject: "Без якоря", details: "Не должно существовать", actor: null,
        });
      } catch (error) {
        code = (error as { code?: string }).code ?? null;
      }
      assert.equal(code, "LEARNER_OPS_ANCHOR_REQUIRED", "the domain refuses an anchorless review case");

      // And the database refuses it too, independently of the domain.
      let dbRefused = false;
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "LearnerOpsCase" ("id","reference","userId","type","queueId","subject","details","updatedAt")
           VALUES ('orphan-probe','LO-ORPHAN',${ordinary.id},'report_review','loq_report_review','x','y',CURRENT_TIMESTAMP)`,
        );
      } catch {
        dbRefused = true;
      }
      assert.ok(dbRefused, "the CHECK constraint refuses it at the storage layer");
    });

  } finally {
    await prisma.$disconnect();
    cleanup();
    for (const name of ["CURRICULUM_V2_READ_ENABLED", "CURRICULUM_V2_ENROLLMENT_ENABLED", "CURRICULUM_V2_REPORT_ENABLED", "CURRICULUM_V2_XP_ENABLED"]) delete process.env[name];
  }

  console.log(`\nReport approval regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
