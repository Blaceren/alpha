import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

const dbPath = `/tmp/ata-curriculum-report-schema-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const migrationName = "20260716000000_report_workflow_foundation";
const migrationPath = path.join(process.cwd(), "prisma", "migrations", migrationName, "migration.sql");
const reportTables = [
  "ReportAssignmentVersion", "ReportAssignmentLocalization", "ReportFieldDefinition",
  "ReportFieldLocalization", "LevelReportBinding", "ReportRubricVersion",
  "ReportRubricCriterion", "ReportRubricCriterionLocalization", "ReportRubricScaleOption",
  "ReportRubricScaleOptionLocalization", "ReportRejectionReason",
  "ReportRejectionReasonLocalization", "ReportSubmission", "ReportRevision",
  "ReportReview", "ReportReviewScore", "ReportAttachment", "ReportCommandReceipt",
] as const;
const now = "2026-07-16T10:00:00.000Z";
const later = "2026-07-16T10:05:00.000Z";
const reviewed = "2026-07-16T10:10:00.000Z";
const fingerprintA = `sha256:${"a".repeat(64)}`;
const fingerprintB = `sha256:${"b".repeat(64)}`;

let prisma: PrismaClient | null = null;
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

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

function runMigrations() {
  return spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8",
  });
}

function isConstraintError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P2002", "P2003", "P2010"].includes(error.code);
  }
  return error instanceof Error && /constraint|foreign key|not null|unique|check/i.test(error.message);
}

async function expectConstraint(fn: () => Promise<unknown>, label: string) {
  try { await fn(); } catch (error) {
    assert.equal(isConstraintError(error), true, `${label}: expected constraint error, got ${error}`);
    return;
  }
  assert.fail(`${label}: expected constraint violation`);
}

async function rawInsert(table: string, columns: string[], values: unknown[]) {
  assert.ok(prisma);
  const names = columns.map((name) => `"${name}"`).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `INSERT INTO "${table}" (${names}) VALUES (${placeholders}) RETURNING "id"`, ...values,
  );
  return Number(rows[0].id);
}

async function insertAssignment(levelId: number, curriculumVersionId: number, versionNumber: number, createdById: number | null, status = "draft") {
  return rawInsert("ReportAssignmentVersion", [
    "levelDefinitionId", "curriculumVersionId", "versionNumber", "status", "createdById",
    "createdAt", "updatedAt", "publishedAt",
  ], [levelId, curriculumVersionId, versionNumber, status, createdById, now, now, status === "published" ? now : null]);
}

async function insertRubric(assignmentId: number, versionNumber: number, createdById: number | null, status = "draft") {
  return rawInsert("ReportRubricVersion", [
    "reportAssignmentVersionId", "versionNumber", "status", "createdById", "createdAt", "updatedAt", "publishedAt",
  ], [assignmentId, versionNumber, status, createdById, now, now, status === "published" ? now : null]);
}

async function insertSubmission(input: {
  userId: number; enrollmentId: number; curriculumVersionId: number; levelId: number;
  progressId: number; assignmentId: number; rubricId: number;
}) {
  return rawInsert("ReportSubmission", [
    "userId", "enrollmentId", "curriculumVersionId", "levelDefinitionId", "userLevelProgressId",
    "reportAssignmentVersionId", "reportRubricVersionId", "createdAt", "updatedAt",
  ], [input.userId, input.enrollmentId, input.curriculumVersionId, input.levelId, input.progressId,
    input.assignmentId, input.rubricId, now, now]);
}

async function insertRevision(input: {
  submissionId: number; revisionNumber: number; kind: string; createdById: number;
  sourceRevisionId?: number | null; fingerprint?: string; submittedAt?: string | null;
}) {
  return rawInsert("ReportRevision", [
    "submissionId", "revisionNumber", "kind", "sourceRevisionId", "content", "contentFingerprint",
    "createdById", "createdAt", "submittedAt",
  ], [input.submissionId, input.revisionNumber, input.kind, input.sourceRevisionId ?? null,
    JSON.stringify({ summary: `revision-${input.revisionNumber}` }), input.fingerprint ?? fingerprintA,
    input.createdById, now, input.submittedAt ?? null]);
}

async function main() {
  cleanupDb();
  const firstRunner = runMigrations();
  if (firstRunner.status !== 0) throw new Error(`${firstRunner.stdout}\n${firstRunner.stderr}`);
  prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    await check("1. complete migration chain applies", () => {
      assert.match(firstRunner.stdout, new RegExp(`Migration ${migrationName} applied`));
    });

    const tables = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )).map((row) => row.name);
    await check("2. all report workflow tables exist", () => {
      for (const table of reportTables) assert.equal(tables.includes(table), true, `missing ${table}`);
    });

    const migrationSql = fs.readFileSync(migrationPath, "utf8");
    await check("3. migration contains only additive CREATE statements", () => {
      const withoutComments = migrationSql.replace(/^--.*$/gm, "");
      assert.doesNotMatch(withoutComments, /\b(?:ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX)|RENAME\s+TO|CREATE\s+TRIGGER)\b|^\s*(?:INSERT|UPDATE|DELETE)\b/im);
      const statements = withoutComments.split(";").map((part) => part.trim()).filter(Boolean);
      assert.equal(statements.every((statement) => /^CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\b/i.test(statement)), true);
    });

    await check("4. partial publication indexes and exact pointer indexes exist", async () => {
      const indexes = await prisma!.$queryRawUnsafe<Array<{ name: string; sql: string }>>(
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL",
      );
      const byName = new Map(indexes.map((row) => [row.name, row.sql]));
      assert.match(byName.get("ReportAssignmentVersion_published_per_level_key") ?? "", /WHERE "status" = 'published'/);
      assert.match(byName.get("ReportRubricVersion_published_per_assignment_key") ?? "", /WHERE "status" = 'published'/);
      assert.ok(byName.has("ReportSubmission_submittedRevisionId_id_key"));
      assert.ok(byName.has("UserLevelProgress_id_enrollmentId_curriculumVersionId_levelDefinitionId_key"));
    });

    await check("5. Prisma schema has approved neutral enums and no numeric rubric policy", () => {
      const schema = fs.readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
      for (const value of ["pending_review", "draft_autosave", "initial_submission", "resubmission", "attachment_finalize"]) {
        assert.match(schema, new RegExp(`\\b${value}\\b`));
      }
      const rubricBlock = schema.match(/model ReportRubricVersion \{[\s\S]*?\n\}/)?.[0] ?? "";
      assert.doesNotMatch(rubricBlock, /weight|threshold|passScore|profit/i);
    });

    const initialCounts = new Map<string, number>();
    for (const table of reportTables) {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) count FROM "${table}"`);
      initialCounts.set(table, Number(rows[0].count));
    }
    await check("6. new report tables are empty after migration", () => {
      assert.equal([...initialCounts.values()].every((count) => count === 0), true);
    });

    const secondRunner = runMigrations();
    await check("7. custom semicolon-splitting runner is idempotent", () => {
      assert.equal(secondRunner.status, 0, `${secondRunner.stdout}\n${secondRunner.stderr}`);
      assert.match(secondRunner.stdout, new RegExp(`Migration ${migrationName} already applied`));
    });

    await check("8. parent SQL tables gained no report columns", async () => {
      for (const table of ["User", "CurriculumVersion", "LevelDefinition", "UserCurriculumEnrollment", "UserLevelProgress"]) {
        const columns = (await prisma!.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`)).map((row) => row.name);
        assert.equal(columns.some((name) => /^report/i.test(name)), false, `${table} has report column`);
      }
    });

    const ownerA = await prisma.user.create({ data: { email: "report-owner-a@example.com", name: "Owner A" } });
    const ownerB = await prisma.user.create({ data: { email: "report-owner-b@example.com", name: "Owner B" } });
    const author = await prisma.user.create({ data: { email: "report-author@example.com", name: "Author", role: "admin" } });
    const reviewerUser = await prisma.user.create({ data: { email: "report-reviewer@example.com", name: "Reviewer", role: "mentor" } });
    const versionA = await prisma.curriculumVersion.create({ data: { code: "report-a", name: "Report A", versionNumber: 1, status: "published", publishedAt: new Date(now) } });
    const versionB = await prisma.curriculumVersion.create({ data: { code: "report-b", name: "Report B", versionNumber: 1, status: "published", publishedAt: new Date(now) } });
    const moduleA = await prisma.moduleDefinition.create({ data: { curriculumVersionId: versionA.id, moduleNumber: 1, code: "report-module-a", title: "A", firstLevel: 1, lastLevel: 2 } });
    const moduleB = await prisma.moduleDefinition.create({ data: { curriculumVersionId: versionB.id, moduleNumber: 1, code: "report-module-b", title: "B", firstLevel: 1, lastLevel: 1 } });
    const levelA = await prisma.levelDefinition.create({ data: { curriculumVersionId: versionA.id, moduleId: moduleA.id, levelNumber: 1, stableCode: "v2.report.a1", type: "report", title: "A1", completionMethod: "report_approval" } });
    const levelA2 = await prisma.levelDefinition.create({ data: { curriculumVersionId: versionA.id, moduleId: moduleA.id, levelNumber: 2, stableCode: "v2.report.a2", type: "report", title: "A2", completionMethod: "report_approval" } });
    const levelB = await prisma.levelDefinition.create({ data: { curriculumVersionId: versionB.id, moduleId: moduleB.id, levelNumber: 1, stableCode: "v2.report.b1", type: "report", title: "B1", completionMethod: "report_approval" } });
    const enrollmentA = await prisma.userCurriculumEnrollment.create({ data: { userId: ownerA.id, curriculumVersionId: versionA.id, curriculumCode: versionA.code } });
    const enrollmentB = await prisma.userCurriculumEnrollment.create({ data: { userId: ownerB.id, curriculumVersionId: versionA.id, curriculumCode: versionA.code } });
    const progressA = await prisma.userLevelProgress.create({ data: { enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelDefinitionId: levelA.id } });
    const progressB = await prisma.userLevelProgress.create({ data: { enrollmentId: enrollmentB.id, curriculumVersionId: versionA.id, levelDefinitionId: levelA.id } });

    const assignmentA = await insertAssignment(levelA.id, versionA.id, 1, author.id, "published");
    await check("9. valid versioned assignment is accepted", () => assert.ok(assignmentA > 0));
    await check("10. assignment version and one-published-per-level uniqueness hold", async () => {
      await expectConstraint(() => insertAssignment(levelA.id, versionA.id, 1, null), "duplicate assignment version");
      await expectConstraint(() => insertAssignment(levelA.id, versionA.id, 2, null, "published"), "second published assignment");
    });
    await check("11. assignment cross-version ownership is rejected", () => expectConstraint(
      () => insertAssignment(levelA.id, versionB.id, 3, null), "cross-version assignment",
    ));

    const assignmentA2 = await insertAssignment(levelA2.id, versionA.id, 1, null, "published");
    const assignmentB = await insertAssignment(levelB.id, versionB.id, 1, null, "published");
    const rubricA = await insertRubric(assignmentA, 1, author.id, "published");
    const rubricA2 = await insertRubric(assignmentA2, 1, null, "published");
    await insertRubric(assignmentB, 1, null, "published");
    await check("12. rubric version and one-published-per-assignment uniqueness hold", async () => {
      await expectConstraint(() => insertRubric(assignmentA, 1, null), "duplicate rubric version");
      await expectConstraint(() => insertRubric(assignmentA, 2, null, "published"), "second published rubric");
    });

    const bindingA = await rawInsert("LevelReportBinding", [
      "levelDefinitionId", "curriculumVersionId", "reportAssignmentVersionId", "reportRubricVersionId",
      "createdById", "updatedAt",
    ], [levelA.id, versionA.id, assignmentA, rubricA, author.id, now]);
    await check("13. exact level assignment rubric binding is accepted", () => assert.ok(bindingA > 0));
    await check("14. cross-level and cross-assignment bindings are rejected", async () => {
      await expectConstraint(() => rawInsert("LevelReportBinding", ["levelDefinitionId", "curriculumVersionId", "reportAssignmentVersionId", "reportRubricVersionId", "updatedAt"], [levelA2.id, versionA.id, assignmentA, rubricA, now]), "cross-level binding");
      await expectConstraint(() => rawInsert("LevelReportBinding", ["levelDefinitionId", "curriculumVersionId", "reportAssignmentVersionId", "reportRubricVersionId", "updatedAt"], [levelB.id, versionB.id, assignmentB, rubricA, now]), "cross-assignment rubric binding");
    });

    const submissionA = await insertSubmission({ userId: ownerA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA.id, progressId: progressA.id, assignmentId: assignmentA, rubricId: rubricA });
    const submissionB = await insertSubmission({ userId: ownerB.id, enrollmentId: enrollmentB.id, curriculumVersionId: versionA.id, levelId: levelA.id, progressId: progressB.id, assignmentId: assignmentA, rubricId: rubricA });
    await check("15. valid submission aggregate is accepted", () => assert.ok(submissionA > 0 && submissionB > 0));
    await check("16. one aggregate per enrollment and level is enforced", () => expectConstraint(
      () => insertSubmission({ userId: ownerA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA.id, progressId: progressA.id, assignmentId: assignmentA, rubricId: rubricA }), "duplicate aggregate",
    ));
    await check("17. cross-user enrollment and cross-progress submissions are rejected", async () => {
      await expectConstraint(() => insertSubmission({ userId: ownerB.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA2.id, progressId: progressA.id, assignmentId: assignmentA2, rubricId: rubricA2 }), "cross-user enrollment");
      await expectConstraint(() => insertSubmission({ userId: ownerA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA2.id, progressId: progressA.id, assignmentId: assignmentA2, rubricId: rubricA2 }), "cross-level progress");
    });

    const draftA = await insertRevision({ submissionId: submissionA, revisionNumber: 1, kind: "draft_autosave", createdById: ownerA.id });
    const submittedA = await insertRevision({ submissionId: submissionA, revisionNumber: 2, kind: "initial_submission", sourceRevisionId: draftA, createdById: ownerA.id, submittedAt: later });
    const draftB = await insertRevision({ submissionId: submissionB, revisionNumber: 1, kind: "draft_autosave", createdById: ownerB.id, fingerprint: fingerprintB });
    await prisma.$executeRawUnsafe(
      `UPDATE "ReportSubmission" SET "activeRevisionId"=?, "submittedRevisionId"=?, "status"='pending_review', "workflowVersion"=2, "firstSubmittedAt"=?, "submittedAt"=?, "reviewDueAt"=?, "updatedAt"=? WHERE "id"=?`,
      submittedA, submittedA, later, later, reviewed, later, submissionA,
    );
    await prisma.$executeRawUnsafe('UPDATE "ReportSubmission" SET "activeRevisionId"=?, "updatedAt"=? WHERE "id"=?', draftB, later, submissionB);
    await check("18. immutable draft and submitted revisions are accepted", () => assert.ok(draftA > 0 && submittedA > 0));
    await check("19. revision number and submitted-kind shape are enforced", async () => {
      await expectConstraint(() => insertRevision({ submissionId: submissionA, revisionNumber: 2, kind: "draft_autosave", createdById: ownerA.id }), "duplicate revision number");
      await expectConstraint(() => insertRevision({ submissionId: submissionA, revisionNumber: 3, kind: "initial_submission", createdById: ownerA.id }), "submitted revision without source and time");
    });
    await check("20. source and aggregate revision pointers cannot cross submissions", async () => {
      await expectConstraint(() => insertRevision({ submissionId: submissionB, revisionNumber: 2, kind: "resubmission", sourceRevisionId: draftA, createdById: ownerB.id, submittedAt: later }), "foreign source revision");
      await expectConstraint(() => prisma!.$executeRawUnsafe('UPDATE "ReportSubmission" SET "activeRevisionId"=? WHERE "id"=?', draftB, submissionA), "foreign active pointer");
    });

    const receiptA = await rawInsert("ReportCommandReceipt", [
      "actorUserId", "submissionId", "commandType", "requestId", "payloadFingerprint",
      "targetRevisionId", "resultRevisionId", "resultingWorkflowVersion", "safeResult",
    ], [ownerA.id, submissionA, "submit", "submit-request-0001", fingerprintA, draftA, submittedA, 2, JSON.stringify({ status: "pending_review" })]);
    await check("21. durable command receipt with same-submission pointers is accepted", () => assert.ok(receiptA > 0));
    await check("22. receipt actor identity and fingerprint constraints hold", async () => {
      await expectConstraint(() => rawInsert("ReportCommandReceipt", ["actorUserId", "submissionId", "commandType", "requestId", "payloadFingerprint", "resultingWorkflowVersion", "safeResult"], [ownerA.id, submissionA, "submit", "submit-request-0001", fingerprintA, 2, "{}"]), "duplicate actor request");
      await expectConstraint(() => rawInsert("ReportCommandReceipt", ["actorUserId", "submissionId", "commandType", "requestId", "payloadFingerprint", "resultingWorkflowVersion", "safeResult"], [ownerB.id, submissionB, "save_draft", "bad-fingerprint-0001", "sha256:BAD", 1, "{}"]), "bad fingerprint");
    });
    await check("23. receipt revision pointers cannot cross submissions", () => expectConstraint(
      () => rawInsert("ReportCommandReceipt", ["actorUserId", "submissionId", "commandType", "requestId", "payloadFingerprint", "targetRevisionId", "resultingWorkflowVersion", "safeResult"], [ownerA.id, submissionA, "save_draft", "cross-revision-0001", fingerprintA, draftB, 3, "{}"]), "foreign receipt revision",
    ));
    const newerDraft = await insertRevision({ submissionId: submissionA, revisionNumber: 3, kind: "draft_autosave", createdById: ownerA.id, fingerprint: fingerprintB });
    await prisma.$executeRawUnsafe('UPDATE "ReportSubmission" SET "activeRevisionId"=?, "workflowVersion"=3, "updatedAt"=? WHERE "id"=?', newerDraft, reviewed, submissionA);
    await check("24. old receipts remain after newer revisions", async () => {
      const rows = await prisma!.$queryRawUnsafe<Array<{ resultRevisionId: number }>>('SELECT "resultRevisionId" FROM "ReportCommandReceipt" WHERE "id"=?', receiptA);
      assert.equal(rows[0].resultRevisionId, submittedA);
    });

    const criterionA = await rawInsert("ReportRubricCriterion", ["reportRubricVersionId", "stableKey", "categoryCode", "sortOrder", "updatedAt"], [rubricA, "logic", "logic", 0, now]);
    const scaleA = await rawInsert("ReportRubricScaleOption", ["reportRubricVersionId", "stableKey", "ordinal"], [rubricA, "meets", 0]);
    const reasonA = await rawInsert("ReportRejectionReason", ["reportRubricVersionId", "stableKey", "sortOrder", "updatedAt"], [rubricA, "needs_detail", 0, now]);
    const criterionOther = await rawInsert("ReportRubricCriterion", ["reportRubricVersionId", "stableKey", "categoryCode", "sortOrder", "updatedAt"], [rubricA2, "other", "other", 0, now]);
    const reasonOther = await rawInsert("ReportRejectionReason", ["reportRubricVersionId", "stableKey", "sortOrder", "updatedAt"], [rubricA2, "other_reason", 0, now]);
    await check("25. rejection reason must belong to the exact rubric", () => expectConstraint(
      () => rawInsert("ReportReview", ["submissionId", "revisionId", "curriculumVersionId", "levelDefinitionId", "reportAssignmentVersionId", "reportRubricVersionId", "reviewerId", "reviewerRoleSnapshot", "decision", "humanComment", "correctiveAction", "rejectionReasonId", "requestId", "payloadFingerprint", "reviewedAt", "createdAt"], [submissionA, submittedA, versionA.id, levelA.id, assignmentA, rubricA, reviewerUser.id, "mentor", "rejected", "Needs detail", "Add detail", reasonOther, "review-wrong-reason", fingerprintA, reviewed, later]), "foreign rejection reason",
    ));
    await check("26. review binding is same-submission and immutable when the submitted pointer moves", async () => {
      // Cross-submission review revisions remain impossible at the SQL level.
      await expectConstraint(
        () => rawInsert("ReportReview", ["submissionId", "revisionId", "curriculumVersionId", "levelDefinitionId", "reportAssignmentVersionId", "reportRubricVersionId", "reviewerId", "reviewerRoleSnapshot", "decision", "requestId", "payloadFingerprint", "reviewedAt", "createdAt"], [submissionA, draftB, versionA.id, levelA.id, assignmentA, rubricA, reviewerUser.id, "mentor", "approved", "review-wrong-revision", fingerprintA, reviewed, later]), "cross-submission review revision",
      );
      // The Phase 5B.6 corrective migration removed the 5B.1 cascade that
      // silently rebound historical reviews to the newest submitted revision
      // (which corrupted immutable history and blocked approval after a
      // resubmission). Exact current-submitted binding at creation time is
      // service-owned; durable history must survive later pointer advances.
      const probe = await rawInsert("ReportReview", ["submissionId", "revisionId", "curriculumVersionId", "levelDefinitionId", "reportAssignmentVersionId", "reportRubricVersionId", "reviewerId", "reviewerRoleSnapshot", "decision", "requestId", "payloadFingerprint", "reviewedAt", "createdAt"], [submissionA, draftA, versionA.id, levelA.id, assignmentA, rubricA, reviewerUser.id, "mentor", "approved", "review-history-probe", fingerprintA, reviewed, later]);
      await prisma!.$executeRawUnsafe('UPDATE "ReportSubmission" SET "submittedRevisionId"=?, "updatedAt"=? WHERE "id"=?', newerDraft, reviewed, submissionA);
      const pinned = (await prisma!.$queryRawUnsafe<Array<{ revisionId: number }>>('SELECT "revisionId" FROM "ReportReview" WHERE "id"=?', probe))[0];
      assert.equal(pinned.revisionId, draftA);
      await prisma!.$executeRawUnsafe('UPDATE "ReportSubmission" SET "submittedRevisionId"=?, "updatedAt"=? WHERE "id"=?', submittedA, reviewed, submissionA);
      await prisma!.$executeRawUnsafe('DELETE FROM "ReportReview" WHERE "id"=?', probe);
    });
    await check("27. rejected review requires reason comment and corrective action", async () => {
      await expectConstraint(() => rawInsert("ReportReview", ["submissionId", "revisionId", "curriculumVersionId", "levelDefinitionId", "reportAssignmentVersionId", "reportRubricVersionId", "reviewerId", "reviewerRoleSnapshot", "decision", "rejectionReasonId", "requestId", "payloadFingerprint", "reviewedAt", "createdAt"], [submissionA, submittedA, versionA.id, levelA.id, assignmentA, rubricA, reviewerUser.id, "mentor", "rejected", reasonA, "review-missing-text", fingerprintA, reviewed, later]), "rejected review without text");
    });

    const reviewA = await rawInsert("ReportReview", [
      "submissionId", "revisionId", "curriculumVersionId", "levelDefinitionId", "reportAssignmentVersionId",
      "reportRubricVersionId", "reviewerId", "reviewerRoleSnapshot", "decision", "humanComment",
      "correctiveAction", "rejectionReasonId", "requestId", "payloadFingerprint", "claimedAt",
      "claimExpiresAt", "reviewStartedAt", "reviewedAt", "createdAt",
    ], [submissionA, submittedA, versionA.id, levelA.id, assignmentA, rubricA, reviewerUser.id, "mentor",
      "rejected", "Explain the risk plan", "Add concrete risk limits", reasonA, "review-request-0001",
      fingerprintA, now, reviewed, later, reviewed, later]);
    await prisma.$executeRawUnsafe(
      `UPDATE "ReportSubmission" SET "latestReviewId"=?, "status"='rejected', "reviewedAt"=?, "rejectedAt"=?, "updatedAt"=? WHERE "id"=?`,
      reviewA, reviewed, reviewed, reviewed, submissionA,
    );
    await check("28. exact immutable review and terminal rejection state are accepted", () => assert.ok(reviewA > 0));
    await check("29. only one immutable review exists per revision", () => expectConstraint(
      () => rawInsert("ReportReview", ["submissionId", "revisionId", "curriculumVersionId", "levelDefinitionId", "reportAssignmentVersionId", "reportRubricVersionId", "reviewerId", "reviewerRoleSnapshot", "decision", "requestId", "payloadFingerprint", "reviewedAt", "createdAt"], [submissionA, submittedA, versionA.id, levelA.id, assignmentA, rubricA, reviewerUser.id, "mentor", "approved", "review-second-0001", fingerprintB, reviewed, later]), "second review for revision",
    ));
    await check("30. score criterion and scale option must belong to review rubric", async () => {
      const score = await rawInsert("ReportReviewScore", ["reportReviewId", "reportRubricVersionId", "rubricCriterionId", "rubricScaleOptionId"], [reviewA, rubricA, criterionA, scaleA]);
      assert.ok(score > 0);
      await expectConstraint(() => rawInsert("ReportReviewScore", ["reportReviewId", "reportRubricVersionId", "rubricCriterionId", "rubricScaleOptionId"], [reviewA, rubricA, criterionOther, scaleA]), "foreign criterion");
    });

    const attachmentA = await rawInsert("ReportAttachment", [
      "submissionId", "revisionId", "ownerUserId", "storageKey", "originalName", "mimeType", "sizeBytes", "checksum",
    ], [submissionA, submittedA, ownerA.id, "reports/a/evidence.pdf", "evidence.pdf", "application/pdf", 128, fingerprintA]);
    await check("31. attachment metadata is pinned to exact owner submission revision", () => assert.ok(attachmentA > 0));
    await check("32. attachment cross-revision and storage-key reuse are rejected", async () => {
      await expectConstraint(() => rawInsert("ReportAttachment", ["submissionId", "revisionId", "ownerUserId", "storageKey", "originalName", "mimeType", "sizeBytes"], [submissionA, draftB, ownerA.id, "reports/a/cross.pdf", "cross.pdf", "application/pdf", 1]), "cross-submission revision attachment");
      await expectConstraint(() => rawInsert("ReportAttachment", ["submissionId", "revisionId", "ownerUserId", "storageKey", "originalName", "mimeType", "sizeBytes"], [submissionA, submittedA, ownerA.id, "reports/a/evidence.pdf", "duplicate.pdf", "application/pdf", 1]), "duplicate storage key");
    });

    await prisma.user.delete({ where: { id: author.id } });
    await check("33. author references use SetNull without deleting history", async () => {
      const assignment = (await prisma!.$queryRawUnsafe<Array<{ createdById: number | null }>>('SELECT "createdById" FROM "ReportAssignmentVersion" WHERE "id"=?', assignmentA))[0];
      const rubric = (await prisma!.$queryRawUnsafe<Array<{ createdById: number | null }>>('SELECT "createdById" FROM "ReportRubricVersion" WHERE "id"=?', rubricA))[0];
      const binding = (await prisma!.$queryRawUnsafe<Array<{ createdById: number | null }>>('SELECT "createdById" FROM "LevelReportBinding" WHERE "id"=?', bindingA))[0];
      assert.deepEqual([assignment.createdById, rubric.createdById, binding.createdById], [null, null, null]);
    });
    await prisma.user.delete({ where: { id: reviewerUser.id } });
    await check("34. reviewer deletion preserves review with role snapshot", async () => {
      const row = (await prisma!.$queryRawUnsafe<Array<{ reviewerId: number | null; reviewerRoleSnapshot: string }>>('SELECT "reviewerId", "reviewerRoleSnapshot" FROM "ReportReview" WHERE "id"=?', reviewA))[0];
      assert.deepEqual(row, { reviewerId: null, reviewerRoleSnapshot: "mentor" });
    });
    await check("35. historical assignment submission revision and attachment ownership are Restrict", async () => {
      await expectConstraint(() => prisma!.$executeRawUnsafe('DELETE FROM "ReportAssignmentVersion" WHERE "id"=?', assignmentA), "assignment history delete");
      await expectConstraint(() => prisma!.$executeRawUnsafe('DELETE FROM "ReportRevision" WHERE "id"=?', submittedA), "revision history delete");
      await expectConstraint(() => prisma!.user.delete({ where: { id: ownerA.id } }), "submission owner delete");
    });

    const task = await prisma.task.create({ data: { stepNumber: 99001, title: "V1 report task", description: "legacy", rewardType: "xp", actionLabel: "Send", requiresReport: true } });
    const legacy = await prisma.taskReport.create({ data: { userId: ownerB.id, taskId: task.id, reportText: "V1 remains operational" } });
    await check("36. representative V1 TaskReport create and read still work", async () => {
      const row = await prisma!.taskReport.findUniqueOrThrow({ where: { id: legacy.id } });
      assert.equal(row.reportText, "V1 remains operational");
    });
  } finally {
    await prisma.$disconnect();
    prisma = null;
    cleanupDb();
  }

  await check("37. temporary DB WAL journal SHM cleanup invariant", () => {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) assert.equal(fs.existsSync(`${dbPath}${suffix}`), false);
  });
  assert.equal(passed + failed, 37, "curriculum report schema scenario count drifted");
}

main().then(() => {
  console.log(`\ncurriculum report schema regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch((error) => {
  cleanupDb();
  console.error(error);
  console.log(`\ncurriculum report schema regression: ${passed} passed, ${failed + 1} failed`);
  process.exit(1);
});
