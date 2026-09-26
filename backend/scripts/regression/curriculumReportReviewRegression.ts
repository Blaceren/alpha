import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { ReportDomainErrorCode } from "../../src/lib/curriculum/report-errors";
import { isReportDomainError } from "../../src/lib/curriculum/report-errors";

const dbPath = `/tmp/ata-curriculum-report-review-${process.pid}.db`;
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
    if (isReportDomainError(error, code)) return error;
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
  process.env.DATABASE_URL = dbUrl;
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  delete process.env.CURRICULUM_V2_REPORT_ENABLED;

  const { prisma } = await import("../../src/lib/prisma");
  const review = await import("../../src/lib/curriculum/report-review");
  const submissionRuntime = await import("../../src/lib/curriculum/report-submission");

  const admin = await prisma.user.create({ data: { email: "review-admin@example.com", name: "Review Admin", role: "admin" } });
  const mentorOne = await prisma.user.create({ data: { email: "review-mentor-one@example.com", name: "Mentor One", role: "mentor" } });
  const mentorTwo = await prisma.user.create({ data: { email: "review-mentor-two@example.com", name: "Mentor Two", role: "mentor" } });
  const blockedMentor = await prisma.user.create({ data: { email: "review-blocked@example.com", name: "Blocked Mentor", role: "mentor", status: "blocked" } });
  const blockedAdmin = await prisma.user.create({ data: { email: "review-blocked-admin@example.com", name: "Blocked Admin", role: "admin", status: "blocked" } });
  const ordinaryUser = await prisma.user.create({ data: { email: "review-user@example.com", name: "Ordinary User" } });
  const authorOne = await prisma.user.create({ data: { email: "review-author-one@example.com", name: "Author One" } });
  const authorTwo = await prisma.user.create({ data: { email: "review-author-two@example.com", name: "Author Two" } });
  const authorThree = await prisma.user.create({ data: { email: "review-author-three@example.com", name: "Author Three" } });

  const curriculum = await prisma.curriculumVersion.create({ data: {
    code: "ata-v2", name: "ATA Review", versionNumber: 1, status: "published",
    publishedAt: new Date("2026-02-01T00:00:00.000Z"),
  } });
  const moduleDefinition = await prisma.moduleDefinition.create({ data: {
    curriculumVersionId: curriculum.id, moduleNumber: 1, code: "review", title: "Review", firstLevel: 1, lastLevel: 1,
  } });
  const level = await prisma.levelDefinition.create({ data: {
    curriculumVersionId: curriculum.id, moduleId: moduleDefinition.id, levelNumber: 1,
    stableCode: "v2.l001.review-report", type: "report", title: "Review report",
    completionMethod: "report_approval",
  } });
  const assignment = await prisma.reportAssignmentVersion.create({ data: {
    levelDefinitionId: level.id, curriculumVersionId: curriculum.id, versionNumber: 7,
    status: "published", publishedAt: new Date("2026-02-02T00:00:00.000Z"),
  } });
  await prisma.reportAssignmentLocalization.create({ data: {
    reportAssignmentVersionId: assignment.id, locale: "en", title: "Pinned assignment",
    instructions: "Explain the process", successCriteriaSummary: "Complete evidence", submitLabel: "Submit",
  } });
  const field = await prisma.reportFieldDefinition.create({ data: {
    reportAssignmentVersionId: assignment.id, stableKey: "evidence", type: "url", required: true,
    sortOrder: 0, validationRules: { version: 1, allowedSchemes: ["https"] }, choiceCodes: Prisma.JsonNull,
  } });
  await prisma.reportFieldLocalization.create({ data: {
    reportFieldDefinitionId: field.id, locale: "en", label: "Evidence", helpText: "HTTPS only",
    placeholder: "https://example.com", choiceLabels: Prisma.JsonNull,
  } });
  const rubric = await prisma.reportRubricVersion.create({ data: {
    reportAssignmentVersionId: assignment.id, versionNumber: 3, status: "published",
    publishedAt: new Date("2026-02-02T00:00:00.000Z"),
  } });
  const processCriterion = await prisma.reportRubricCriterion.create({ data: {
    reportRubricVersionId: rubric.id, stableKey: "process", categoryCode: "process-quality", sortOrder: 0, commentRequired: true,
  } });
  const riskCriterion = await prisma.reportRubricCriterion.create({ data: {
    reportRubricVersionId: rubric.id, stableKey: "risk", categoryCode: "risk-management", sortOrder: 1, commentRequired: false,
  } });
  for (const [criterionId, title] of [[processCriterion.id, "Process"], [riskCriterion.id, "Risk"]] as const) {
    await prisma.reportRubricCriterionLocalization.create({ data: {
      reportRubricCriterionId: criterionId, locale: "en", title, description: `${title} description`,
    } });
  }
  const meets = await prisma.reportRubricScaleOption.create({ data: {
    reportRubricVersionId: rubric.id, stableKey: "meets", ordinal: 0,
  } });
  const revise = await prisma.reportRubricScaleOption.create({ data: {
    reportRubricVersionId: rubric.id, stableKey: "revise", ordinal: 1,
  } });
  for (const [optionId, label] of [[meets.id, "Meets"], [revise.id, "Revise"]] as const) {
    await prisma.reportRubricScaleOptionLocalization.create({ data: {
      reportRubricScaleOptionId: optionId, locale: "en", label, description: `${label} description`,
    } });
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

  async function prepareAuthor(userId: number, marker: string) {
    const enrollment = await prisma.userCurriculumEnrollment.create({ data: {
      userId, curriculumVersionId: curriculum.id, curriculumCode: curriculum.code,
      status: "active", currentLevel: 1, highestCompletedLevel: 0,
    } });
    const progress = await prisma.userLevelProgress.create({ data: {
      enrollmentId: enrollment.id, curriculumVersionId: curriculum.id, levelDefinitionId: level.id,
      status: "in_progress", startedAt: new Date("2026-02-03T00:00:00.000Z"),
    } });
    const saved = await submissionRuntime.saveOwnReportDraft(userId, {
      levelNumber: 1, requestId: `prepare-save-${marker}`, expectedRevision: 0,
      fieldValues: { evidence: `https://example.com/${marker}` },
    });
    await submissionRuntime.submitOwnReport(userId, {
      levelNumber: 1, requestId: `prepare-submit-${marker}`, expectedRevision: saved.resultingWorkflowVersion,
    });
    const aggregate = await prisma.reportSubmission.findUniqueOrThrow({
      where: { enrollmentId_levelDefinitionId: { enrollmentId: enrollment.id, levelDefinitionId: level.id } },
      include: { submittedRevision: true },
    });
    return { enrollment, progress, aggregate };
  }

  process.env.CURRICULUM_V2_REPORT_ENABLED = "true";
  const first = await prepareAuthor(authorOne.id, "one");
  const second = await prepareAuthor(authorTwo.id, "two");
  const third = await prepareAuthor(authorThree.id, "three");
  const adminAuthored = await prepareAuthor(admin.id, "admin");
  await prisma.curriculumVersion.update({ where: { id: curriculum.id }, data: { status: "archived" } });
  const archivedAt = new Date("2030-02-01T00:00:00.000Z");
  await prisma.reportAssignmentVersion.update({ where: { id: assignment.id }, data: { status: "archived", archivedAt } });
  await prisma.reportRubricVersion.update({ where: { id: rubric.id }, data: { status: "archived", archivedAt } });

  const scorePayload = [
    { criterionCode: "process", scaleCode: "revise", comment: "Show the complete sequence" },
    { criterionCode: "risk", scaleCode: "meets" },
  ];
  const at = (iso: string) => new Date(iso.replace("2026-03", "2030-03"));
  const commandFor = (aggregate: typeof first.aggregate, requestId: string) => ({
    submissionRef: Buffer.from(`report-submission:v1:${aggregate.id}`, "utf8").toString("base64url"),
    requestId,
    expectedWorkflowVersion: aggregate.workflowVersion,
    expectedClaimVersion: aggregate.claimVersion,
    expectedSubmittedRevision: aggregate.submittedRevision!.revisionNumber,
  });
  const initialBaseline = {
    xp: await prisma.xPTransaction.count(), events: await prisma.xpEvent.count(), notifications: await prisma.notification.count(),
    v1: await prisma.taskReport.count(), enrollmentLevel: first.enrollment.currentLevel,
    revisions: await prisma.reportRevision.count(), submissions: await prisma.reportSubmission.count(),
  };

  try {
    await check("1. READ + ENROLLMENT + REPORT are required dynamically and default false is safe", async () => {
      delete process.env.CURRICULUM_V2_REPORT_ENABLED;
      assert.deepEqual(await review.listReportReviewQueue(mentorOne.id, { locale: "en" }), { kind: "disabled" });
      await expectError(() => review.claimReportForReview(mentorOne.id, commandFor(first.aggregate, "claim-disabled-01")), "REPORT_DISABLED");
      process.env.CURRICULUM_V2_REPORT_ENABLED = "true";
      delete process.env.CURRICULUM_V2_READ_ENABLED;
      assert.deepEqual(await review.listReportReviewQueue(mentorOne.id, { locale: "en" }), { kind: "disabled" });
      process.env.CURRICULUM_V2_READ_ENABLED = "true";
    });
    await check("2. active admin and mentor are reviewers; inactive, blocked and ordinary users are forbidden", async () => {
      assert.equal((await review.listReportReviewQueue(admin.id, { locale: "en" })).kind, "resolved");
      assert.equal((await review.listReportReviewQueue(mentorOne.id, { locale: "en" })).kind, "resolved");
      assert.deepEqual(await review.listReportReviewQueue(blockedMentor.id, { locale: "en" }), { kind: "forbidden" });
      assert.deepEqual(await review.listReportReviewQueue(blockedAdmin.id, { locale: "en" }), { kind: "forbidden" });
      assert.deepEqual(await review.listReportReviewQueue(ordinaryUser.id, { locale: "en" }), { kind: "forbidden" });
    });
    await check("3. queue is deterministic, bounded, pinned, archived-safe and read-only", async () => {
      const before = await prisma.reportSubmission.findMany({ orderBy: { id: "asc" } });
      const pageOne = await review.listReportReviewQueue(mentorOne.id, { locale: "en", limit: 1 });
      assert.equal(pageOne.kind, "resolved");
      if (pageOne.kind !== "resolved") return;
      assert.equal(pageOne.items.length, 1); assert.ok(pageOne.nextCursor);
      assert.equal(pageOne.items[0].assignment.versionNumber, 7);
      assert.equal(pageOne.items[0].rubric.versionNumber, 3);
      assert.equal(pageOne.items[0].revision.revisionNumber, 2);
      assert.equal(pageOne.items[0].revision.values.evidence, "https://example.com/one");
      assert.equal(pageOne.items[0].rubric.criteria.length, 2);
      assert.equal(pageOne.items[0].assignment.fields.length, 1);
      assert.equal("userId" in pageOne.items[0], false);
      const pageTwo = await review.listReportReviewQueue(mentorOne.id, { locale: "en", limit: 1, cursor: pageOne.nextCursor! });
      assert.equal(pageTwo.kind, "resolved");
      if (pageTwo.kind === "resolved") assert.notEqual(pageTwo.items[0].submissionRef, pageOne.items[0].submissionRef);
      assert.deepEqual(await prisma.reportSubmission.findMany({ orderBy: { id: "asc" } }), before);
    });
    await check("4. self-review is excluded from queue and forbidden for admin direct claim", async () => {
      const queue = await review.listReportReviewQueue(admin.id, { locale: "en", limit: 50 });
      assert.equal(queue.kind, "resolved");
      if (queue.kind === "resolved") assert.equal(queue.items.some((item) => item.owner.displayName === "Review Admin"), false);
      await expectError(() => review.claimReportForReview(admin.id, commandFor(adminAuthored.aggregate, "admin-self-claim")), "REPORT_SELF_REVIEW_FORBIDDEN");
    });
    const firstClaimInput = commandFor(first.aggregate, "claim-first-0001");
    const firstClaim = await review.claimReportForReview(mentorOne.id, firstClaimInput, { evaluationTime: at("2026-03-01T10:00:00.000Z") });
    await check("5. claim uses a server-owned exact 60-minute lease and awaited audit", async () => {
      assert.equal(firstClaim.created, true); assert.equal(firstClaim.retry, false);
      assert.equal(firstClaim.claim.expiresAt, "2030-03-01T11:00:00.000Z");
      const row = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: first.aggregate.id } });
      assert.equal(row.claimedAt?.toISOString(), "2030-03-01T10:00:00.000Z");
      assert.equal(row.claimExpiresAt?.toISOString(), "2030-03-01T11:00:00.000Z");
      assert.equal(await prisma.auditLog.count({ where: { action: "REPORT_CLAIMED" } }), 1);
    });
    await check("6. exact claim retry does not extend the lease or duplicate audit", async () => {
      const retry = await review.claimReportForReview(mentorOne.id, firstClaimInput, { evaluationTime: at("2026-03-01T10:30:00.000Z") });
      assert.equal(retry.created, false); assert.equal(retry.retry, true);
      assert.equal(retry.claim.expiresAt, "2030-03-01T11:00:00.000Z");
      assert.equal(await prisma.auditLog.count({ where: { action: "REPORT_CLAIMED" } }), 1);
    });
    await check("7. same request with different operation or payload conflicts", async () => {
      await expectError(() => review.renewOwnReportClaim(mentorOne.id, firstClaimInput, { evaluationTime: at("2026-03-01T10:31:00.000Z") }), "REPORT_IDEMPOTENCY_CONFLICT");
      await expectError(() => review.claimReportForReview(mentorOne.id, { ...firstClaimInput, expectedClaimVersion: 99 }), "REPORT_IDEMPOTENCY_CONFLICT");
    });
    const afterClaim = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: first.aggregate.id }, include: { submittedRevision: true } });
    const renewInput = commandFor(afterClaim, "renew-first-0001");
    await check("8. only the active owner renews from evaluation time and exact retry is inert", async () => {
      await expectError(() => review.renewOwnReportClaim(mentorTwo.id, renewInput, { evaluationTime: at("2026-03-01T10:40:00.000Z") }), "REPORT_CLAIM_NOT_OWNER");
      const renewed = await review.renewOwnReportClaim(mentorOne.id, renewInput, { evaluationTime: at("2026-03-01T10:40:00.000Z") });
      assert.equal(renewed.claim.expiresAt, "2030-03-01T11:40:00.000Z");
      const retry = await review.renewOwnReportClaim(mentorOne.id, renewInput, { evaluationTime: at("2026-03-01T10:50:00.000Z") });
      assert.equal(retry.retry, true); assert.equal(retry.claim.expiresAt, "2030-03-01T11:40:00.000Z");
    });
    const afterRenew = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: first.aggregate.id }, include: { submittedRevision: true } });
    const releaseInput = commandFor(afterRenew, "release-first-0001");
    await check("9. active owner release clears only claim state and is exactly retryable", async () => {
      const before = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: first.aggregate.id } });
      const released = await review.releaseOwnReportClaim(mentorOne.id, releaseInput, { evaluationTime: at("2026-03-01T11:00:00.000Z") });
      assert.equal(released.claim.state, "released");
      const after = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: first.aggregate.id } });
      assert.equal(after.claimedById, null); assert.equal(after.claimedAt, null); assert.equal(after.claimExpiresAt, null);
      assert.equal(after.status, before.status); assert.equal(after.submittedRevisionId, before.submittedRevisionId);
      assert.equal((await review.releaseOwnReportClaim(mentorOne.id, releaseInput, { evaluationTime: at("2026-03-01T11:10:00.000Z") })).retry, true);
    });
    const unclaimedFirst = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: first.aggregate.id }, include: { submittedRevision: true } });
    await review.claimReportForReview(mentorOne.id, commandFor(unclaimedFirst, "claim-first-0002"), { evaluationTime: at("2026-03-01T12:00:00.000Z") });
    const freshFirst = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: first.aggregate.id }, include: { submittedRevision: true } });
    await check("10. fresh claim blocks ordinary reviewers but admin can reassign with allowlisted reason", async () => {
      await expectError(() => review.claimReportForReview(mentorTwo.id, commandFor(freshFirst, "claim-fresh-other"), { evaluationTime: at("2026-03-01T12:10:00.000Z") }), "REPORT_CLAIM_CONFLICT");
      const reassigned = await review.reassignReportClaim(admin.id, {
        ...commandFor(freshFirst, "reassign-first-01"), targetReviewerId: mentorTwo.id, reasonCode: "workload_rebalance",
      }, { evaluationTime: at("2026-03-01T12:10:00.000Z") });
      assert.equal(reassigned.claim.expiresAt, "2030-03-01T13:10:00.000Z");
      assert.equal(reassigned.claim.reviewerRole, "mentor");
      assert.equal(await prisma.auditLog.count({ where: { action: "REPORT_REASSIGNED" } }), 1);
    });
    await check("11. reassignment requires active admin, active reviewer target, non-author target and allowlisted reason", async () => {
      const row = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: first.aggregate.id }, include: { submittedRevision: true } });
      const base = commandFor(row, "reassign-invalid-01");
      await expectError(() => review.reassignReportClaim(mentorOne.id, { ...base, targetReviewerId: mentorTwo.id, reasonCode: "claim_stale" }), "REPORT_REVIEWER_FORBIDDEN");
      await expectError(() => review.reassignReportClaim(admin.id, { ...base, targetReviewerId: blockedMentor.id, reasonCode: "claim_stale" }), "REPORT_REVIEWER_FORBIDDEN");
      await expectError(() => review.reassignReportClaim(admin.id, { ...base, targetReviewerId: authorOne.id, reasonCode: "claim_stale" }), "REPORT_SELF_REVIEW_FORBIDDEN");
      await expectError(() => review.reassignReportClaim(admin.id, { ...base, targetReviewerId: mentorOne.id, reasonCode: "free_text" }), "REPORT_REVIEW_INPUT_INVALID");
    });
    await check("12. expired claim cannot renew and can be won by a normal fresh claim", async () => {
      const row = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: first.aggregate.id }, include: { submittedRevision: true } });
      await expectError(() => review.renewOwnReportClaim(mentorTwo.id, commandFor(row, "renew-expired-01"), { evaluationTime: at("2026-03-01T13:10:00.000Z") }), "REPORT_CLAIM_EXPIRED");
      const claimed = await review.claimReportForReview(mentorOne.id, commandFor(row, "reclaim-expired-01"), { evaluationTime: at("2026-03-01T13:10:00.000Z") });
      assert.equal(claimed.claim.expiresAt, "2030-03-01T14:10:00.000Z");
    });
    await check("13. competing claims have exactly one durable winner", async () => {
      const row = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: second.aggregate.id }, include: { submittedRevision: true } });
      const [one, two] = await Promise.allSettled([
        review.claimReportForReview(mentorOne.id, commandFor(row, "claim-race-one"), { evaluationTime: at("2026-03-02T10:00:00.000Z") }),
        review.claimReportForReview(mentorTwo.id, commandFor(row, "claim-race-two"), { evaluationTime: at("2026-03-02T10:00:00.000Z") }),
      ]);
      assert.equal([one, two].filter((item) => item.status === "fulfilled").length, 1);
      assert.equal((await prisma.reportSubmission.findUniqueOrThrow({ where: { id: second.aggregate.id } })).claimVersion, 1);
      assert.equal(await prisma.auditLog.count({ where: { action: "REPORT_CLAIMED", entityId: String(second.aggregate.id) } }), 1);
    });
    await check("14. stale and ahead workflow/claim expectations are distinct conflicts", async () => {
      const row = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: third.aggregate.id }, include: { submittedRevision: true } });
      await expectError(() => review.claimReportForReview(mentorOne.id, { ...commandFor(row, "claim-stale-01"), expectedWorkflowVersion: row.workflowVersion - 1 }), "REPORT_REVISION_STALE");
      await expectError(() => review.claimReportForReview(mentorOne.id, { ...commandFor(row, "claim-ahead-01"), expectedClaimVersion: row.claimVersion + 1 }), "REPORT_REVISION_CONFLICT");
    });
    const firstOwned = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: first.aggregate.id }, include: { submittedRevision: true } });
    const readinessBase = { ...commandFor(firstOwned, "readiness-valid-01"), scores: scorePayload };
    await check("15. approval readiness validates complete pinned rubric evidence without writes", async () => {
      const before = { reviews: await prisma.reportReview.count(), scores: await prisma.reportReviewScore.count(), audits: await prisma.auditLog.count() };
      const ready = await review.validateReportApprovalReadiness(mentorOne.id, readinessBase, { evaluationTime: at("2026-03-01T13:20:00.000Z") });
      assert.equal(ready.kind, "ready"); assert.equal(ready.scoreCount, 2); assert.equal(ready.reviewerRole, "mentor");
      assert.deepEqual({ reviews: await prisma.reportReview.count(), scores: await prisma.reportReviewScore.count(), audits: await prisma.auditLog.count() }, before);
    });
    await check("16. missing, duplicate, unknown, foreign-scale and required-comment rubric evidence fails closed", async () => {
      const base = { ...readinessBase, requestId: "readiness-invalid-01" };
      await expectError(() => review.validateReportApprovalReadiness(mentorOne.id, { ...base, scores: [scorePayload[0]] }, { evaluationTime: at("2026-03-01T13:20:00.000Z") }), "REPORT_REVIEW_INPUT_INVALID");
      await expectError(() => review.validateReportApprovalReadiness(mentorOne.id, { ...base, scores: [scorePayload[0], scorePayload[0]] }, { evaluationTime: at("2026-03-01T13:20:00.000Z") }), "REPORT_REVIEW_INPUT_INVALID");
      await expectError(() => review.validateReportApprovalReadiness(mentorOne.id, { ...base, scores: [{ criterionCode: "unknown", scaleCode: "meets" }, scorePayload[1]] }, { evaluationTime: at("2026-03-01T13:20:00.000Z") }), "REPORT_RUBRIC_MISMATCH");
      await expectError(() => review.validateReportApprovalReadiness(mentorOne.id, { ...base, scores: [{ criterionCode: "process", scaleCode: "foreign" }, scorePayload[1]] }, { evaluationTime: at("2026-03-01T13:20:00.000Z") }), "REPORT_RUBRIC_MISMATCH");
      await expectError(() => review.validateReportApprovalReadiness(mentorOne.id, { ...base, scores: [{ criterionCode: "process", scaleCode: "meets" }, scorePayload[1]] }, { evaluationTime: at("2026-03-01T13:20:00.000Z") }), "REPORT_REVIEW_INPUT_INVALID");
    });
    await check("17. rejection reason must belong to the exact pinned rubric", async () => {
      await expectError(() => review.rejectReportSubmission(mentorOne.id, {
        ...commandFor(firstOwned, "reject-wrong-reason"), scores: scorePayload, reasonCode: "reason-from-another-rubric",
        humanComment: "Insufficient evidence", correctiveAction: "Add the missing evidence",
      }, { evaluationTime: at("2026-03-01T13:25:00.000Z") }), "REPORT_REASON_MISMATCH");
    });
    const rejectInput = {
      ...commandFor(firstOwned, "reject-first-0001"), scores: scorePayload, reasonCode: "missing-evidence",
      humanComment: "Insufficient evidence", correctiveAction: "Add the missing evidence",
    };
    const rejected = await review.rejectReportSubmission(mentorOne.id, rejectInput, { evaluationTime: at("2026-03-01T13:30:00.000Z") });
    await check("18. reject atomically writes immutable review/scores, closes claim and reopens progress", async () => {
      assert.equal(rejected.claim.state, "closed");
      const aggregate = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: first.aggregate.id } });
      assert.equal(aggregate.status, "rejected"); assert.equal(aggregate.claimedById, null);
      assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: first.progress.id } })).status, "in_progress");
      assert.equal(await prisma.reportReview.count({ where: { submissionId: first.aggregate.id, decision: "rejected" } }), 1);
      assert.equal(await prisma.reportReviewScore.count({ where: { review: { submissionId: first.aggregate.id } } }), 2);
      assert.equal(await prisma.reportRevision.count({ where: { submissionId: first.aggregate.id } }), 2);
      assert.equal(await prisma.auditLog.count({ where: { action: "REPORT_REJECTED", entityId: String(first.aggregate.id) } }), 1);
    });
    await check("19. exact reject retry is inert and same key with another payload conflicts", async () => {
      const retry = await review.rejectReportSubmission(mentorOne.id, rejectInput, { evaluationTime: at("2026-03-01T13:40:00.000Z") });
      assert.equal(retry.retry, true); assert.equal(retry.created, false);
      assert.equal(await prisma.reportReview.count({ where: { submissionId: first.aggregate.id } }), 1);
      await expectError(() => review.rejectReportSubmission(mentorOne.id, { ...rejectInput, humanComment: "Different feedback" }), "REPORT_IDEMPOTENCY_CONFLICT");
    });
    await check("20. old exact reject retry survives a later correction draft", async () => {
      const current = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: first.aggregate.id } });
      await submissionRuntime.saveOwnReportDraft(authorOne.id, {
        levelNumber: 1, requestId: "correction-after-reject", expectedRevision: current.workflowVersion,
        fieldValues: { evidence: "https://example.com/corrected" },
      });
      const retry = await review.rejectReportSubmission(mentorOne.id, rejectInput, { evaluationTime: at("2026-03-01T14:00:00.000Z") });
      assert.equal(retry.retry, true); assert.equal(retry.workflowVersion, rejected.workflowVersion);
    });
    await check("21. audit failure rolls back review, scores, submission, progress and receipt", async () => {
      const aggregate = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: third.aggregate.id }, include: { submittedRevision: true } });
      await review.claimReportForReview(mentorTwo.id, commandFor(aggregate, "claim-third-audit"), { evaluationTime: at("2026-03-03T10:00:00.000Z") });
      const claimed = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: third.aggregate.id }, include: { submittedRevision: true } });
      const before = { submission: await prisma.reportSubmission.findUniqueOrThrow({ where: { id: third.aggregate.id } }), reviews: await prisma.reportReview.count(), scores: await prisma.reportReviewScore.count(), receipts: await prisma.reportCommandReceipt.count() };
      await prisma.$executeRawUnsafe(`CREATE TRIGGER deny_report_reject_audit BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'REPORT_REJECTED' BEGIN SELECT RAISE(ABORT, 'audit denied'); END`);
      try {
        await expectError(() => review.rejectReportSubmission(mentorTwo.id, {
          ...commandFor(claimed, "reject-third-audit"), scores: scorePayload, reasonCode: "missing-evidence",
          humanComment: "Insufficient evidence", correctiveAction: "Add evidence",
        }, { evaluationTime: at("2026-03-03T10:10:00.000Z") }), "REPORT_INTERNAL_ERROR");
      } finally { await prisma.$executeRawUnsafe(`DROP TRIGGER deny_report_reject_audit`); }
      const after = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: third.aggregate.id } });
      assert.equal(after.status, before.submission.status); assert.equal(after.workflowVersion, before.submission.workflowVersion);
      assert.equal(await prisma.reportReview.count(), before.reviews); assert.equal(await prisma.reportReviewScore.count(), before.scores);
      assert.equal(await prisma.reportCommandReceipt.count(), before.receipts);
      assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: third.progress.id } })).status, "pending_review");
    });
    await check("22. corrupt pinned state fails closed", async () => {
      const aggregate = await prisma.reportSubmission.findUniqueOrThrow({ where: { id: third.aggregate.id }, include: { submittedRevision: true } });
      await prisma.reportSubmission.update({ where: { id: third.aggregate.id }, data: { claimedById: null } });
      try {
        await expectError(() => review.validateReportApprovalReadiness(mentorTwo.id, {
          ...commandFor(aggregate, "readiness-corrupt-01"), scores: scorePayload,
        }, { evaluationTime: at("2026-03-03T10:20:00.000Z") }), "REPORT_STATE_CORRUPT");
      } finally { await prisma.reportSubmission.update({ where: { id: third.aggregate.id }, data: { claimedById: mentorTwo.id } }); }
    });
    await check("23. XP flag is no longer a blanket approval precondition, but REPORT still is", async () => {
      // RR-1: the XP flag is not an independent reviewer-gate precondition. A
      // missing XP flag alone no longer makes approval fail closed (a zero-reward
      // level needs no XP flag; a positive reward is enforced inside completion).
      // The REPORT flag remains an independent precondition. Neither path here
      // creates a durable approval, review or XP row.
      const before = { approved: await prisma.reportSubmission.count({ where: { status: "approved" } }), reviews: await prisma.reportReview.count({ where: { decision: "approved" } }), xp: await prisma.xPTransaction.count() };
      delete process.env.CURRICULUM_V2_XP_ENABLED;
      // XP off, REPORT on: not REPORT_DISABLED anymore — the request reaches input
      // validation instead of being short-circuited by a blanket XP gate.
      await expectError(() => review.approveReportSubmission(mentorOne.id, {}, { evaluationTime: at("2026-03-03T10:30:00.000Z") }), "REPORT_REVIEW_INPUT_INVALID");
      // REPORT off: still fail closed regardless of XP.
      delete process.env.CURRICULUM_V2_REPORT_ENABLED;
      try {
        await expectError(() => review.approveReportSubmission(mentorOne.id, {}, { evaluationTime: at("2026-03-03T10:31:00.000Z") }), "REPORT_DISABLED");
      } finally { process.env.CURRICULUM_V2_REPORT_ENABLED = "true"; }
      assert.deepEqual({ approved: await prisma.reportSubmission.count({ where: { status: "approved" } }), reviews: await prisma.reportReview.count({ where: { decision: "approved" } }), xp: await prisma.xPTransaction.count() }, before);
    });
    await check("24. reject does not touch XP, completion, enrollment summary, V1, notifications or submitted revision history", async () => {
      assert.deepEqual({
        xp: await prisma.xPTransaction.count(), events: await prisma.xpEvent.count(), notifications: await prisma.notification.count(),
        v1: await prisma.taskReport.count(), enrollmentLevel: (await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: first.enrollment.id } })).currentLevel,
        submissions: await prisma.reportSubmission.count(),
      }, {
        xp: initialBaseline.xp, events: initialBaseline.events, notifications: initialBaseline.notifications,
        v1: initialBaseline.v1, enrollmentLevel: initialBaseline.enrollmentLevel, submissions: initialBaseline.submissions,
      });
    });
    await check("25. audit allowlist excludes payload, feedback, localization text and fingerprints", async () => {
      const rows = await prisma.auditLog.findMany({ where: { action: { in: ["REPORT_CLAIMED", "REPORT_REASSIGNED", "REPORT_REJECTED"] } } });
      const serialized = JSON.stringify(rows.map((row) => row.metadata));
      assert.doesNotMatch(serialized, /Insufficient evidence|Add the missing|Pinned assignment|sha256:|example\.com/);
      assert.match(serialized, /actorRoleSnapshot/);
    });
  } finally {
    await prisma.$disconnect();
    cleanup();
    delete process.env.CURRICULUM_V2_REPORT_ENABLED;
  }

  console.log(`\nReport review regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
