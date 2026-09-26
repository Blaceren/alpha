import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { ReportDomainErrorCode } from "../../src/lib/curriculum/report-errors";
import { isReportDomainError } from "../../src/lib/curriculum/report-errors";

const dbPath = `/tmp/ata-curriculum-report-submission-${process.pid}.db`;
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
    console.error(error instanceof Error ? error.stack ?? error.message : error);
  }
}

async function expectError(fn: () => Promise<unknown>, code: ReportDomainErrorCode) {
  try { await fn(); } catch (error) {
    if (isReportDomainError(error, code)) return error;
    throw new Error(`expected ${code}, got ${String(error)}`);
  }
  throw new Error(`expected ${code}, operation succeeded`);
}

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

function fingerprint(marker: string) {
  return `sha256:${createHash("sha256").update(marker).digest("hex")}`;
}

async function main() {
  cleanup();
  const migration = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8",
  });
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
  process.env.DATABASE_URL = dbUrl;
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  delete process.env.CURRICULUM_V2_REPORT_ENABLED;
  const { prisma } = await import("../../src/lib/prisma");
  const runtime = await import("../../src/lib/curriculum/report-submission");

  const user = await prisma.user.create({ data: { email: "report-submission@example.com", name: "Report User" } });
  const other = await prisma.user.create({ data: { email: "report-other@example.com", name: "Other User" } });
  const blocked = await prisma.user.create({ data: { email: "report-blocked@example.com", name: "Blocked User", status: "blocked" } });
  const unconfigured = await prisma.user.create({ data: { email: "report-unconfigured@example.com", name: "Unconfigured User" } });
  const notStarted = await prisma.user.create({ data: { email: "report-not-started@example.com", name: "Not Started User" } });
  const reviewer = await prisma.user.create({ data: { email: "report-reviewer@example.com", name: "Reviewer", role: "mentor" } });
  const curriculum = await prisma.curriculumVersion.create({
    data: { code: "ata-v2", name: "ATA V2", versionNumber: 1, status: "published", publishedAt: new Date("2026-01-01T00:00:00.000Z") },
  });
  const moduleDefinition = await prisma.moduleDefinition.create({
    data: { curriculumVersionId: curriculum.id, moduleNumber: 1, code: "reports", title: "Reports", firstLevel: 1, lastLevel: 2 },
  });
  const reportLevel = await prisma.levelDefinition.create({ data: {
    curriculumVersionId: curriculum.id, moduleId: moduleDefinition.id, levelNumber: 1,
    stableCode: "v2.l001.report", type: "report", title: "Trading report",
    shortDescription: "Safe report", learningObjective: "Explain a process", completionMethod: "report_approval",
  } });
  await prisma.levelDefinition.create({ data: {
    curriculumVersionId: curriculum.id, moduleId: moduleDefinition.id, levelNumber: 2,
    stableCode: "v2.l002.lesson", type: "lesson", title: "Lesson", completionMethod: "lesson", requiredPreviousLevel: 1,
  } });

  async function createPublishedGraph(versionNumber: number, marker: string) {
    const publishedAt = new Date(`2026-01-0${versionNumber}T00:00:00.000Z`);
    const assignment = await prisma.reportAssignmentVersion.create({ data: {
      levelDefinitionId: reportLevel.id, curriculumVersionId: curriculum.id, versionNumber,
      status: "published", publishedAt,
    } });
    await prisma.reportAssignmentLocalization.create({ data: {
      reportAssignmentVersionId: assignment.id, locale: "en", title: `Assignment ${marker}`,
      instructions: `Instructions ${marker}`, successCriteriaSummary: "Provide evidence", submitLabel: "Submit",
    } });
    const evidence = await prisma.reportFieldDefinition.create({ data: {
      reportAssignmentVersionId: assignment.id, stableKey: `evidence-${marker}`, type: "url", required: true,
      sortOrder: 0, validationRules: { version: 1, allowedSchemes: ["https"] }, choiceCodes: Prisma.JsonNull,
    } });
    await prisma.reportFieldLocalization.create({ data: {
      reportFieldDefinitionId: evidence.id, locale: "en", label: "Evidence", helpText: "HTTPS evidence", placeholder: "https://example.com", choiceLabels: Prisma.JsonNull,
    } });
    const notes = await prisma.reportFieldDefinition.create({ data: {
      reportAssignmentVersionId: assignment.id, stableKey: `notes-${marker}`, type: "long_text", required: false,
      sortOrder: 1, validationRules: { version: 1, minLength: 3, maxLength: 500 }, choiceCodes: Prisma.JsonNull,
    } });
    await prisma.reportFieldLocalization.create({ data: {
      reportFieldDefinitionId: notes.id, locale: "en", label: "Notes", helpText: "Process notes", placeholder: "Explain", choiceLabels: Prisma.JsonNull,
    } });
    const rubric = await prisma.reportRubricVersion.create({ data: {
      reportAssignmentVersionId: assignment.id, versionNumber: 1, status: "published", publishedAt,
    } });
    const criterion = await prisma.reportRubricCriterion.create({ data: {
      reportRubricVersionId: rubric.id, stableKey: `process-${marker}`, categoryCode: "risk-management", sortOrder: 0, commentRequired: true,
    } });
    await prisma.reportRubricCriterionLocalization.create({ data: {
      reportRubricCriterionId: criterion.id, locale: "en", title: "Process", description: "Process quality",
    } });
    const scale = await prisma.reportRubricScaleOption.create({ data: {
      reportRubricVersionId: rubric.id, stableKey: `meets-${marker}`, ordinal: 0,
    } });
    await prisma.reportRubricScaleOptionLocalization.create({ data: {
      reportRubricScaleOptionId: scale.id, locale: "en", label: "Meets", description: "Meets expectations",
    } });
    const reason = await prisma.reportRejectionReason.create({ data: {
      reportRubricVersionId: rubric.id, stableKey: `missing-${marker}`, sortOrder: 0, active: true,
    } });
    await prisma.reportRejectionReasonLocalization.create({ data: {
      reportRejectionReasonId: reason.id, locale: "en", title: "Missing evidence", guidance: "Add evidence",
    } });
    return { assignment, rubric, evidence, notes, criterion, scale, reason };
  }

  const first = await createPublishedGraph(1, "one");
  await prisma.levelReportBinding.create({ data: {
    levelDefinitionId: reportLevel.id, curriculumVersionId: curriculum.id,
    reportAssignmentVersionId: first.assignment.id, reportRubricVersionId: first.rubric.id, revision: 0,
  } });
  const enrollment = await prisma.userCurriculumEnrollment.create({ data: {
    userId: user.id, curriculumVersionId: curriculum.id, curriculumCode: "ata-v2",
    status: "active", currentLevel: 1, highestCompletedLevel: 0,
  } });
  const progress = await prisma.userLevelProgress.create({ data: {
    enrollmentId: enrollment.id, curriculumVersionId: curriculum.id, levelDefinitionId: reportLevel.id,
    status: "in_progress", startedAt: new Date("2026-01-03T00:00:00.000Z"),
  } });
  const unconfiguredEnrollment = await prisma.userCurriculumEnrollment.create({ data: {
    userId: unconfigured.id, curriculumVersionId: curriculum.id, curriculumCode: "ata-v2",
    status: "active", currentLevel: 1, highestCompletedLevel: 0,
  } });
  await prisma.userLevelProgress.create({ data: {
    enrollmentId: unconfiguredEnrollment.id, curriculumVersionId: curriculum.id,
    levelDefinitionId: reportLevel.id, status: "in_progress",
  } });
  await prisma.userCurriculumEnrollment.create({ data: {
    userId: notStarted.id, curriculumVersionId: curriculum.id, curriculumCode: "ata-v2",
    status: "active", currentLevel: 1, highestCompletedLevel: 0,
  } });
  const baseline = {
    xp: await prisma.xPTransaction.count(), notifications: await prisma.notification.count(),
    v1: await prisma.taskReport.count(), reviews: await prisma.reportReview.count(), attachments: await prisma.reportAttachment.count(),
    enrollments: await prisma.userCurriculumEnrollment.count(), progressRows: await prisma.userLevelProgress.count(),
  };
  const incomplete = { "notes-one": "draft notes" };
  const complete = { "evidence-one": "https://example.com/proof", "notes-one": "complete notes" };

  try {
    await check("1. READ + ENROLLMENT + REPORT gates are all required dynamically", async () => {
      assert.deepEqual(await runtime.resolveOwnReportContext({ actorUserId: user.id, levelNumber: 1, locale: "en" }), { kind: "disabled" });
      await expectError(() => runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "draft-gate-0001", expectedRevision: 0, fieldValues: {} }), "REPORT_DISABLED");
      process.env.CURRICULUM_V2_REPORT_ENABLED = "true";
      delete process.env.CURRICULUM_V2_READ_ENABLED;
      assert.deepEqual(await runtime.resolveOwnReportContext({ actorUserId: user.id, levelNumber: 1, locale: "en" }), { kind: "disabled" });
      process.env.CURRICULUM_V2_READ_ENABLED = "true";
    });
    await check("2. unrelated feature flags cannot substitute for the report matrix", async () => {
      process.env.CURRICULUM_V2_XP_ENABLED = "true";
      process.env.CURRICULUM_V2_ADMIN_ENABLED = "true";
      delete process.env.CURRICULUM_V2_ENROLLMENT_ENABLED;
      await expectError(() => runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "draft-gate-0002", expectedRevision: 0, fieldValues: {} }), "REPORT_DISABLED");
      process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
    });
    await check("3. resolver GET is read-only and returns exact published presentation", async () => {
      const before = await prisma.reportSubmission.count();
      const result = await runtime.resolveOwnReportContext({ actorUserId: user.id, stableCode: reportLevel.stableCode, locale: "en" });
      assert.equal(result.kind, "available");
      if (result.kind === "available") assert.equal(result.assignment.versionNumber, 1);
      assert.equal(await prisma.reportSubmission.count(), before);
    });
    await check("4. resolver fails closed for actor, enrollment, level type and locale", async () => {
      assert.equal((await runtime.resolveOwnReportContext({ actorUserId: other.id, levelNumber: 1, locale: "en" })).kind, "not_enrolled");
      assert.equal((await runtime.resolveOwnReportContext({ actorUserId: blocked.id, levelNumber: 1, locale: "en" })).kind, "user_not_found");
      assert.equal((await runtime.resolveOwnReportContext({ actorUserId: 2_000_000_000, levelNumber: 1, locale: "en" })).kind, "user_not_found");
      assert.deepEqual(await runtime.resolveOwnReportContext({ actorUserId: user.id, levelNumber: 2, locale: "en" }), { kind: "unavailable", reason: "wrong_level_type" });
      assert.deepEqual(await runtime.resolveOwnReportContext({ actorUserId: user.id, levelNumber: 1, locale: "ru" }), { kind: "unavailable", reason: "localization_unavailable" });
      await expectError(() => runtime.saveOwnReportDraft(notStarted.id, { levelNumber: 1, requestId: "not-started-01", expectedRevision: 0, fieldValues: {} }), "REPORT_LEVEL_NOT_STARTED");
    });
    await check("5. strict command DTO rejects actor injection, extra keys and unsafe values", async () => {
      await expectError(() => runtime.saveOwnReportDraft(user.id, { actorUserId: other.id, levelNumber: 1, requestId: "strict-input-01", expectedRevision: 0, fieldValues: {} }), "REPORT_DRAFT_INPUT_INVALID");
      await expectError(() => runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "strict-input-02", expectedRevision: 0, fieldValues: { "notes-one": "<script>x</script>" } }), "REPORT_DRAFT_INPUT_INVALID");
      await expectError(() => runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "strict-input-03", expectedRevision: 0, fieldValues: { unknown: true } }), "REPORT_DRAFT_INPUT_INVALID");
    });
    const firstSave = await runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "save-draft-0001", expectedRevision: 0, fieldValues: incomplete });
    await check("6. first save atomically creates aggregate, revision one, pointer and receipt", async () => {
      assert.equal(firstSave.created, true); assert.equal(firstSave.acceptedRevision, 1); assert.equal(firstSave.resultingWorkflowVersion, 1);
      const aggregate = await prisma.reportSubmission.findUniqueOrThrow({ where: { enrollmentId_levelDefinitionId: { enrollmentId: enrollment.id, levelDefinitionId: reportLevel.id } } });
      assert.equal(aggregate.activeRevisionId !== null, true); assert.equal(await prisma.reportRevision.count({ where: { submissionId: aggregate.id } }), 1);
      assert.equal(await prisma.reportCommandReceipt.count({ where: { submissionId: aggregate.id } }), 1);
    });
    await check("7. exact save retry returns durable receipt without a duplicate revision", async () => {
      const retry = await runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "save-draft-0001", expectedRevision: 0, fieldValues: incomplete });
      assert.equal(retry.retry, true); assert.equal(retry.acceptedRevision, 1);
      assert.equal(await prisma.reportRevision.count(), 1);
    });
    await check("8. reused request id with a different payload is an idempotency conflict", async () => {
      await expectError(() => runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "save-draft-0001", expectedRevision: 0, fieldValues: complete }), "REPORT_IDEMPOTENCY_CONFLICT");
    });
    await check("9. incomplete draft is allowed but cannot be submitted", async () => {
      await expectError(() => runtime.submitOwnReport(user.id, { levelNumber: 1, requestId: "submit-incomplete", expectedRevision: 1 }), "REPORT_DRAFT_INPUT_INVALID");
      assert.equal(await prisma.auditLog.count({ where: { action: "REPORT_SUBMITTED" } }), 0);
    });
    const secondSave = await runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "save-draft-0002", expectedRevision: 1, fieldValues: complete });
    await check("10. subsequent save appends an immutable source-linked draft revision", async () => {
      assert.equal(secondSave.acceptedRevision, 2); assert.equal(secondSave.resultingWorkflowVersion, 2);
      const revisions = await prisma.reportRevision.findMany({ orderBy: { revisionNumber: "asc" } });
      assert.equal(revisions[1].sourceRevisionId, revisions[0].id); assert.deepEqual(revisions[0].content, incomplete);
    });
    await check("11. an old exact retry survives newer revisions", async () => {
      const oldRetry = await runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "save-draft-0001", expectedRevision: 0, fieldValues: incomplete });
      assert.equal(oldRetry.retry, true); assert.equal(oldRetry.acceptedRevision, 1); assert.equal(oldRetry.submission.workflowVersion, 2);
    });
    const thirdSave = await runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "save-draft-0003", expectedRevision: 2, fieldValues: complete });
    await check("12. identical content with a new request still creates an immutable revision", async () => {
      assert.equal(thirdSave.acceptedRevision, 3); assert.equal(await prisma.reportRevision.count(), 3);
    });
    await check("13. stale and ahead workflow revisions fail with distinct typed errors", async () => {
      await expectError(() => runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "save-stale-0001", expectedRevision: 2, fieldValues: complete }), "REPORT_REVISION_STALE");
      await expectError(() => runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "save-ahead-0001", expectedRevision: 99, fieldValues: complete }), "REPORT_REVISION_CONFLICT");
    });
    let sameRaceWorkflow = 0;
    await check("13a. concurrent identical request is applied once and recovered from its receipt", async () => {
      const results = await Promise.all([
        runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "save-same-race", expectedRevision: 3, fieldValues: complete }),
        runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "save-same-race", expectedRevision: 3, fieldValues: complete }),
      ]);
      assert.equal(results.filter((item) => item.retry === false).length, 1);
      assert.equal(results.filter((item) => item.retry === true).length, 1);
      assert.equal(results[0].acceptedRevision, results[1].acceptedRevision);
      sameRaceWorkflow = results[0].resultingWorkflowVersion;
    });
    let winningSave: Awaited<ReturnType<typeof runtime.saveOwnReportDraft>> | undefined;
    await check("14. competing saves cannot both advance the same workflow version", async () => {
      const results = await Promise.allSettled([
        runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "save-race-0001", expectedRevision: sameRaceWorkflow, fieldValues: complete }),
        runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "save-race-0002", expectedRevision: sameRaceWorkflow, fieldValues: { ...complete, "notes-one": "racing notes" } }),
      ]);
      assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(results.filter((item) => item.status === "rejected" && isReportDomainError(item.reason, "REPORT_REVISION_STALE")).length, 1);
      winningSave = results.find((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof runtime.saveOwnReportDraft>>> => item.status === "fulfilled")!.value;
    });
    await check("14a. awaited submit audit failure rolls back revision, receipt, pointers and progress", async () => {
      const before = await prisma.reportSubmission.findFirstOrThrow();
      const revisions = await prisma.reportRevision.count();
      const receipts = await prisma.reportCommandReceipt.count();
      await prisma.$executeRawUnsafe(`CREATE TRIGGER deny_report_submit_audit BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'REPORT_SUBMITTED' BEGIN SELECT RAISE(ABORT, 'audit denied'); END`);
      try {
        await expectError(() => runtime.submitOwnReport(user.id, { levelNumber: 1, requestId: "submit-audit-fail", expectedRevision: winningSave!.resultingWorkflowVersion }), "REPORT_INTERNAL_ERROR");
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER deny_report_submit_audit`);
      }
      const after = await prisma.reportSubmission.findFirstOrThrow();
      assert.equal(after.workflowVersion, before.workflowVersion); assert.equal(after.status, "draft");
      assert.equal(await prisma.reportRevision.count(), revisions); assert.equal(await prisma.reportCommandReceipt.count(), receipts);
      assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progress.id } })).status, "in_progress");
    });
    const submitRace = await Promise.allSettled([
      runtime.submitOwnReport(user.id, { levelNumber: 1, requestId: "submit-report-01", expectedRevision: winningSave!.resultingWorkflowVersion }),
      runtime.submitOwnReport(user.id, { levelNumber: 1, requestId: "submit-report-02", expectedRevision: winningSave!.resultingWorkflowVersion }),
    ]);
    const submittedRequestId = submitRace[0].status === "fulfilled" ? "submit-report-01" : "submit-report-02";
    const submitted = submitRace.find((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof runtime.submitOwnReport>>> => item.status === "fulfilled")!.value;
    await check("15. one competing submit wins, copies the draft and moves progress atomically", async () => {
      assert.equal(submitRace.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(submitRace.filter((item) => item.status === "rejected" && isReportDomainError(item.reason, "REPORT_REVISION_STALE")).length, 1);
      assert.equal(submitted.kind, "submitted"); assert.equal(submitted.submission.status, "pending_review");
      const aggregate = await prisma.reportSubmission.findFirstOrThrow();
      const revision = await prisma.reportRevision.findUniqueOrThrow({ where: { id: aggregate.submittedRevisionId! } });
      assert.equal(revision.kind, "initial_submission"); assert.equal(revision.sourceRevisionId !== null, true);
      assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progress.id } })).status, "pending_review");
      assert.equal(aggregate.reviewDueAt, null);
    });
    await check("16. submit writes one safe audit and exact retry is stable", async () => {
      const retry = await runtime.submitOwnReport(user.id, { levelNumber: 1, requestId: submittedRequestId, expectedRevision: winningSave!.resultingWorkflowVersion });
      assert.equal(retry.retry, true); assert.equal(retry.acceptedRevision, submitted.acceptedRevision);
      const audits = await prisma.auditLog.findMany({ where: { action: "REPORT_SUBMITTED" } });
      assert.equal(audits.length, 1); assert.equal(JSON.stringify(audits[0].metadata).includes("fieldValues"), false);
    });
    await check("17. pending and approved-like immutable states reject self editing", async () => {
      await expectError(() => runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "save-pending-01", expectedRevision: submitted.resultingWorkflowVersion, fieldValues: complete }), "REPORT_ALREADY_SUBMITTED");
      await expectError(() => runtime.submitOwnReport(user.id, { levelNumber: 1, requestId: "submit-again-01", expectedRevision: submitted.resultingWorkflowVersion }), "REPORT_ALREADY_SUBMITTED");
    });
    await prisma.reportAssignmentVersion.update({ where: { id: first.assignment.id }, data: { status: "archived", archivedAt: new Date() } });
    await prisma.reportRubricVersion.update({ where: { id: first.rubric.id }, data: { status: "archived", archivedAt: new Date() } });
    const second = await createPublishedGraph(2, "two");
    await prisma.levelReportBinding.update({ where: { levelDefinitionId: reportLevel.id }, data: {
      reportAssignmentVersionId: second.assignment.id, reportRubricVersionId: second.rubric.id, revision: { increment: 1 },
    } });
    await check("18. existing submission remains pinned to archived definitions after binding replacement", async () => {
      const resolved = await runtime.resolveOwnReportContext({ actorUserId: user.id, levelNumber: 1, locale: "en" });
      assert.equal(resolved.kind, "pending_review");
      if (resolved.kind === "pending_review") {
        assert.equal(resolved.assignment.versionNumber, 1);
        const serialized = JSON.stringify(resolved);
        for (const privateKey of ["reportAssignmentVersionId", "reportRubricVersionId", "payloadFingerprint", "createdById", "actorUserId"]) {
          assert.equal(serialized.includes(privateKey), false);
        }
      }
    });
    const aggregate = await prisma.reportSubmission.findFirstOrThrow();
    const reviewTime = new Date(Date.now() + 2_000);
    const review = await prisma.reportReview.create({ data: {
      submissionId: aggregate.id, revisionId: aggregate.submittedRevisionId!, curriculumVersionId: curriculum.id,
      levelDefinitionId: reportLevel.id, reportAssignmentVersionId: first.assignment.id, reportRubricVersionId: first.rubric.id,
      reviewerId: reviewer.id, reviewerRoleSnapshot: "mentor", decision: "rejected", humanComment: "Evidence is incomplete",
      correctiveAction: "Provide complete evidence", rejectionReasonId: first.reason.id, requestId: "review-reject-01",
      payloadFingerprint: fingerprint("review-reject-01"), reviewedAt: reviewTime,
    } });
    await prisma.$transaction([
      prisma.reportSubmission.update({ where: { id: aggregate.id }, data: {
        status: "rejected", latestReviewId: review.id, reviewedAt: reviewTime, rejectedAt: reviewTime,
      } }),
      prisma.userLevelProgress.update({ where: { id: progress.id }, data: { status: "in_progress", lastProgressAt: reviewTime } }),
    ]);
    await check("19. rejected resolver exposes only public correction feedback", async () => {
      const resolved = await runtime.resolveOwnReportContext({ actorUserId: user.id, levelNumber: 1, locale: "en" });
      assert.equal(resolved.kind, "rejected");
      if (resolved.kind === "rejected") {
        assert.equal(resolved.submission.rejection?.reasonCode, "missing-one");
        assert.equal(JSON.stringify(resolved).includes("payloadFingerprint"), false);
        assert.equal(JSON.stringify(resolved).includes("reviewerId"), false);
      }
    });
    await check("20. resubmit requires a newer correction draft", async () => {
      await expectError(() => runtime.resubmitOwnReport(user.id, { levelNumber: 1, requestId: "resubmit-no-fix", expectedRevision: aggregate.workflowVersion }), "REPORT_CORRECTION_REQUIRED");
    });
    const correction = await runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "save-correct-01", expectedRevision: aggregate.workflowVersion, fieldValues: { ...complete, "notes-one": "corrected evidence" } });
    await check("21. rejected correction appends a draft but keeps aggregate rejected", async () => {
      assert.equal(correction.submission.status, "rejected");
      assert.equal((await prisma.reportSubmission.findFirstOrThrow()).status, "rejected");
      assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progress.id } })).status, "in_progress");
    });
    await check("21a. awaited resubmit audit failure rolls back the full transition", async () => {
      const before = await prisma.reportSubmission.findFirstOrThrow();
      const revisions = await prisma.reportRevision.count();
      const receipts = await prisma.reportCommandReceipt.count();
      await prisma.$executeRawUnsafe(`CREATE TRIGGER deny_report_resubmit_audit BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'REPORT_RESUBMITTED' BEGIN SELECT RAISE(ABORT, 'audit denied'); END`);
      try {
        await expectError(() => runtime.resubmitOwnReport(user.id, { levelNumber: 1, requestId: "resubmit-audit-fail", expectedRevision: correction.resultingWorkflowVersion }), "REPORT_INTERNAL_ERROR");
      } finally {
        await prisma.$executeRawUnsafe(`DROP TRIGGER deny_report_resubmit_audit`);
      }
      const after = await prisma.reportSubmission.findFirstOrThrow();
      assert.equal(after.workflowVersion, before.workflowVersion); assert.equal(after.status, "rejected");
      assert.equal(await prisma.reportRevision.count(), revisions); assert.equal(await prisma.reportCommandReceipt.count(), receipts);
      assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progress.id } })).status, "in_progress");
    });
    const resubmitted = await runtime.resubmitOwnReport(user.id, { levelNumber: 1, requestId: "resubmit-report", expectedRevision: correction.resultingWorkflowVersion });
    await check("22. resubmit creates resubmission and returns aggregate/progress to pending review", async () => {
      assert.equal(resubmitted.kind, "resubmitted"); assert.equal(resubmitted.submission.status, "pending_review");
      const current = await prisma.reportSubmission.findFirstOrThrow();
      const revision = await prisma.reportRevision.findUniqueOrThrow({ where: { id: current.submittedRevisionId! } });
      assert.equal(revision.kind, "resubmission"); assert.equal(current.rejectedAt, null); assert.equal(current.reviewDueAt, null);
      assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progress.id } })).status, "pending_review");
    });
    await check("23. exact resubmit retry survives the state transition", async () => {
      const retry = await runtime.resubmitOwnReport(user.id, { levelNumber: 1, requestId: "resubmit-report", expectedRevision: correction.resultingWorkflowVersion });
      assert.equal(retry.retry, true); assert.equal(retry.acceptedRevision, resubmitted.acceptedRevision);
      assert.equal(await prisma.auditLog.count({ where: { action: "REPORT_RESUBMITTED" } }), 1);
    });
    await check("24. resolver and commands never mutate out-of-scope domains", async () => {
      assert.equal(await prisma.xPTransaction.count(), baseline.xp);
      assert.equal(await prisma.notification.count(), baseline.notifications);
      assert.equal(await prisma.taskReport.count(), baseline.v1);
      assert.equal(await prisma.reportReview.count(), baseline.reviews + 1);
      assert.equal(await prisma.reportAttachment.count(), baseline.attachments);
      assert.equal(await prisma.userCurriculumEnrollment.count(), baseline.enrollments);
      assert.equal(await prisma.userLevelProgress.count(), baseline.progressRows);
      const stableEnrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
      assert.equal(stableEnrollment.currentLevel, 1); assert.equal(stableEnrollment.highestCompletedLevel, 0);
    });
    await check("25. command errors do not leak raw database failures", async () => {
      const brokenDb = { $transaction: async () => { throw new Error("SQLITE secret path /private.db"); } };
      const error = await expectError(() => runtime.saveOwnReportDraft(user.id, { levelNumber: 1, requestId: "safe-error-0001", expectedRevision: 99, fieldValues: complete }, { db: brokenDb as never }), "REPORT_INTERNAL_ERROR");
      assert.equal(error.message.includes("private.db"), false);
    });
    await check("26. receipt and revision chains remain complete and monotonic", async () => {
      const current = await prisma.reportSubmission.findFirstOrThrow({ include: { revisions: { orderBy: { revisionNumber: "asc" } }, receipts: true } });
      assert.deepEqual(current.revisions.map((item) => item.revisionNumber), current.revisions.map((_, index) => index + 1));
      assert.equal(current.workflowVersion, current.receipts.length);
      assert.equal(current.receipts.every((item) => item.resultRevisionId !== null), true);
    });
    await check("27. missing current binding is unavailable without affecting pinned submissions", async () => {
      const binding = await prisma.levelReportBinding.delete({ where: { levelDefinitionId: reportLevel.id } });
      try {
        assert.deepEqual(await runtime.resolveOwnReportContext({ actorUserId: unconfigured.id, levelNumber: 1, locale: "en" }), { kind: "unavailable", reason: "report_not_configured" });
        assert.equal((await runtime.resolveOwnReportContext({ actorUserId: user.id, levelNumber: 1, locale: "en" })).kind, "pending_review");
      } finally {
        await prisma.levelReportBinding.create({ data: {
          levelDefinitionId: binding.levelDefinitionId, curriculumVersionId: binding.curriculumVersionId,
          reportAssignmentVersionId: binding.reportAssignmentVersionId, reportRubricVersionId: binding.reportRubricVersionId,
          createdById: binding.createdById, revision: binding.revision,
        } });
      }
    });
    await check("28. corrupt receipt evidence fails closed and is never returned partially", async () => {
      const receipt = await prisma.reportCommandReceipt.findFirstOrThrow({ orderBy: { id: "asc" } });
      const safeResult = receipt.safeResult;
      await prisma.reportCommandReceipt.update({ where: { id: receipt.id }, data: { safeResult: { version: 1, kind: "saved", acceptedRevision: 999, resultingWorkflowVersion: receipt.resultingWorkflowVersion } } });
      try {
        assert.deepEqual(await runtime.resolveOwnReportContext({ actorUserId: user.id, levelNumber: 1, locale: "en" }), { kind: "corrupt", reason: "receipt_corrupt" });
      } finally {
        await prisma.reportCommandReceipt.update({ where: { id: receipt.id }, data: { safeResult: safeResult as Prisma.InputJsonValue } });
      }
    });
    await check("29. tampered immutable revision evidence fails closed", async () => {
      const revision = await prisma.reportRevision.findFirstOrThrow({ orderBy: { revisionNumber: "asc" } });
      await prisma.reportRevision.update({ where: { id: revision.id }, data: { contentFingerprint: fingerprint("tampered-revision") } });
      try {
        assert.deepEqual(await runtime.resolveOwnReportContext({ actorUserId: user.id, levelNumber: 1, locale: "en" }), { kind: "corrupt", reason: "revision_pointer_corrupt" });
      } finally {
        await prisma.reportRevision.update({ where: { id: revision.id }, data: { contentFingerprint: revision.contentFingerprint } });
      }
    });
    await check("30. submission/progress contradiction fails closed", async () => {
      await prisma.userLevelProgress.update({ where: { id: progress.id }, data: { status: "in_progress" } });
      try {
        assert.deepEqual(await runtime.resolveOwnReportContext({ actorUserId: user.id, levelNumber: 1, locale: "en" }), { kind: "corrupt", reason: "submission_corrupt" });
      } finally {
        await prisma.userLevelProgress.update({ where: { id: progress.id }, data: { status: "pending_review" } });
      }
    });
    await check("31. archived curriculum pin remains readable without repinning", async () => {
      await prisma.curriculumVersion.update({ where: { id: curriculum.id }, data: { status: "archived" } });
      const resolved = await runtime.resolveOwnReportContext({ actorUserId: user.id, levelNumber: 1, locale: "en" });
      assert.equal(resolved.kind, "pending_review");
      if (resolved.kind === "pending_review") assert.equal(resolved.assignment.versionNumber, 1);
    });
  } finally {
    await prisma.$disconnect();
    cleanup();
  }
  console.log(`\nReport submission regression: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  cleanup();
  process.exitCode = 1;
});
