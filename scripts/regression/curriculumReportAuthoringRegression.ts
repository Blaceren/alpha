import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ReportDomainErrorCode } from "../../src/lib/curriculum/report-errors";
import { isReportDomainError } from "../../src/lib/curriculum/report-errors";

const dbPath = `/tmp/ata-curriculum-report-authoring-${process.pid}.db`;
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

async function main() {
  cleanup();
  const migration = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8",
  });
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
  process.env.DATABASE_URL = dbUrl;
  delete process.env.CURRICULUM_V2_REPORT_ENABLED;
  const { prisma } = await import("../../src/lib/prisma");
  const report = await import("../../src/lib/curriculum/report-authoring");

  const admin = await prisma.user.create({ data: { email: "report-admin@example.com", name: "Admin", role: "admin" } });
  const user = await prisma.user.create({ data: { email: "report-user@example.com", name: "User" } });
  const mentor = await prisma.user.create({ data: { email: "report-mentor@example.com", name: "Mentor", role: "mentor" } });
  const blocked = await prisma.user.create({ data: { email: "report-blocked@example.com", name: "Blocked", role: "admin", status: "blocked" } });
  const curriculum = await prisma.curriculumVersion.create({ data: { code: "report-authoring", name: "Report Authoring", versionNumber: 1 } });
  const curriculumModule = await prisma.moduleDefinition.create({ data: { curriculumVersionId: curriculum.id, moduleNumber: 1, code: "reports", title: "Reports", firstLevel: 1, lastLevel: 4 } });
  const reportLevel = await prisma.levelDefinition.create({ data: { curriculumVersionId: curriculum.id, moduleId: curriculumModule.id, levelNumber: 1, stableCode: "v2.report.1", type: "report", title: "Report", completionMethod: "report_approval" } });
  const auditLevel = await prisma.levelDefinition.create({ data: { curriculumVersionId: curriculum.id, moduleId: curriculumModule.id, levelNumber: 2, stableCode: "v2.report.2", type: "report", title: "Audit", completionMethod: "report_approval" } });
  const wrongLevel = await prisma.levelDefinition.create({ data: { curriculumVersionId: curriculum.id, moduleId: curriculumModule.id, levelNumber: 3, stableCode: "v2.lesson.3", type: "lesson", title: "Lesson", completionMethod: "manual" } });
  const mentorLevel = await prisma.levelDefinition.create({ data: { curriculumVersionId: curriculum.id, moduleId: curriculumModule.id, levelNumber: 4, stableCode: "v2.mentor.4", type: "mentor_review", title: "Mentor", completionMethod: "mentor_review" } });

  const baseline = {
    submissions: await prisma.reportSubmission.count(), revisions: await prisma.reportRevision.count(),
    reviews: await prisma.reportReview.count(), xp: await prisma.xPTransaction.count(), v1: await prisma.taskReport.count(),
  };

  try {
    await check("1. REPORT flag defaults false and fails before writes", async () => {
      await expectError(() => report.createReportAssignment({ actorId: admin.id, levelDefinitionId: reportLevel.id }), "REPORT_DISABLED");
      assert.equal(await prisma.reportAssignmentVersion.count(), 0);
    });
    await check("2. unrelated flags cannot enable report authoring", async () => {
      process.env.CURRICULUM_V2_ADMIN_ENABLED = "true";
      process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
      process.env.CURRICULUM_V2_ASSESSMENT_ENABLED = "true";
      await expectError(() => report.createReportAssignment({ actorId: admin.id, levelDefinitionId: reportLevel.id }), "REPORT_DISABLED");
    });
    process.env.CURRICULUM_V2_REPORT_ENABLED = "true";
    await check("3. REPORT flag is read dynamically", async () => {
      const draft = await report.createReportAssignment({ actorId: admin.id, levelDefinitionId: auditLevel.id });
      assert.equal(draft.status, "draft");
      await report.deleteReportAssignment({ actorId: admin.id, reportAssignmentVersionId: draft.id });
    });
    await check("4. missing, non-admin, mentor and blocked actors are forbidden", async () => {
      for (const actorId of [2_000_000_000, user.id, mentor.id, blocked.id]) {
        await expectError(() => report.createReportAssignment({ actorId, levelDefinitionId: reportLevel.id }), "REPORT_ACTOR_FORBIDDEN");
      }
    });
    await check("5. strict DTO rejects lifecycle ownership and prototype fields", async () => {
      await expectError(() => report.createReportAssignment({ actorId: admin.id, levelDefinitionId: reportLevel.id, status: "published" }), "REPORT_INPUT_INVALID");
      await expectError(() => report.createReportAssignment(JSON.parse(`{"actorId":${admin.id},"levelDefinitionId":${reportLevel.id},"__proto__":{"polluted":true}}`)), "REPORT_INPUT_INVALID");
    });
    await check("6. lesson and mentor_review levels reject report assignments", async () => {
      await expectError(() => report.createReportAssignment({ actorId: admin.id, levelDefinitionId: wrongLevel.id }), "REPORT_LEVEL_TYPE_INVALID");
      await expectError(() => report.createReportAssignment({ actorId: admin.id, levelDefinitionId: mentorLevel.id }), "REPORT_LEVEL_TYPE_INVALID");
    });
    await check("7. awaited audit failure rolls assignment creation back", async () => {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER deny_report_audit BEFORE INSERT ON "AuditLog" WHEN NEW."action" = 'REPORT_ASSIGNMENT_CREATED' BEGIN SELECT RAISE(ABORT, 'audit denied'); END`);
      try { await assert.rejects(() => report.createReportAssignment({ actorId: admin.id, levelDefinitionId: auditLevel.id })); }
      finally { await prisma.$executeRawUnsafe(`DROP TRIGGER deny_report_audit`); }
      assert.equal(await prisma.reportAssignmentVersion.count({ where: { levelDefinitionId: auditLevel.id } }), 0);
    });
    await check("7a. complete draft child CRUD surface remains transactional", async () => {
      const assignment = await report.createReportAssignment({ actorId: admin.id, levelDefinitionId: auditLevel.id, changeNotes: "scratch" });
      await report.updateReportAssignment({ actorId: admin.id, reportAssignmentVersionId: assignment.id, patch: { changeNotes: "scratch-updated" } });
      const assignmentLocale = await report.createReportAssignmentLocalization({ actorId: admin.id, reportAssignmentVersionId: assignment.id, locale: "en", title: "Scratch", instructions: "Scratch instructions", successCriteriaSummary: "Scratch criteria", submitLabel: "Send" });
      await report.updateReportAssignmentLocalization({ actorId: admin.id, reportAssignmentLocalizationId: assignmentLocale.id, patch: { submitLabel: "Submit" } });
      const field = await report.createReportField({ actorId: admin.id, reportAssignmentVersionId: assignment.id, stableKey: "scratch-field", type: "boolean", required: false, sortOrder: 0, validationRules: { version: 1 }, choiceCodes: null });
      await report.updateReportField({ actorId: admin.id, reportFieldDefinitionId: field.id, patch: { required: true } });
      const fieldLocale = await report.createReportFieldLocalization({ actorId: admin.id, reportFieldDefinitionId: field.id, locale: "en", label: "Scratch field", helpText: "Help", placeholder: "Value", choiceLabels: null });
      await report.updateReportFieldLocalization({ actorId: admin.id, reportFieldLocalizationId: fieldLocale.id, patch: { helpText: "Updated help" } });
      const rubric = await report.createReportRubric({ actorId: admin.id, reportAssignmentVersionId: assignment.id, changeNotes: "scratch rubric" });
      await report.updateReportRubric({ actorId: admin.id, reportRubricVersionId: rubric.id, patch: { changeNotes: "scratch rubric updated" } });
      const criterion = await report.createReportCriterion({ actorId: admin.id, reportRubricVersionId: rubric.id, stableKey: "scratch-criterion", categoryCode: "process", sortOrder: 0, commentRequired: false });
      await report.updateReportCriterion({ actorId: admin.id, reportRubricCriterionId: criterion.id, patch: { commentRequired: true } });
      const criterionLocale = await report.createReportCriterionLocalization({ actorId: admin.id, reportRubricCriterionId: criterion.id, locale: "en", title: "Criterion", description: "Criterion description" });
      await report.updateReportCriterionLocalization({ actorId: admin.id, reportRubricCriterionLocalizationId: criterionLocale.id, patch: { description: "Updated criterion" } });
      const scale = await report.createReportScaleOption({ actorId: admin.id, reportRubricVersionId: rubric.id, stableKey: "scratch-scale", ordinal: 0 });
      await report.updateReportScaleOption({ actorId: admin.id, reportRubricScaleOptionId: scale.id, patch: { stableKey: "scratch-scale-updated" } });
      const scaleLocale = await report.createReportScaleLocalization({ actorId: admin.id, reportRubricScaleOptionId: scale.id, locale: "en", label: "Scale", description: "Scale description" });
      await report.updateReportScaleLocalization({ actorId: admin.id, reportRubricScaleOptionLocalizationId: scaleLocale.id, patch: { description: "Updated scale" } });
      const reason = await report.createReportReason({ actorId: admin.id, reportRubricVersionId: rubric.id, stableKey: "scratch-reason", sortOrder: 0, active: true });
      await report.updateReportReason({ actorId: admin.id, reportRejectionReasonId: reason.id, patch: { active: false } });
      const reasonLocale = await report.createReportReasonLocalization({ actorId: admin.id, reportRejectionReasonId: reason.id, locale: "en", title: "Reason", guidance: "Reason guidance" });
      await report.updateReportReasonLocalization({ actorId: admin.id, reportRejectionReasonLocalizationId: reasonLocale.id, patch: { guidance: "Updated guidance" } });
      await report.deleteReportReasonLocalization({ actorId: admin.id, reportRejectionReasonLocalizationId: reasonLocale.id });
      await report.deleteReportReason({ actorId: admin.id, reportRejectionReasonId: reason.id });
      await report.deleteReportScaleLocalization({ actorId: admin.id, reportRubricScaleOptionLocalizationId: scaleLocale.id });
      await report.deleteReportScaleOption({ actorId: admin.id, reportRubricScaleOptionId: scale.id });
      await report.deleteReportCriterionLocalization({ actorId: admin.id, reportRubricCriterionLocalizationId: criterionLocale.id });
      await report.deleteReportCriterion({ actorId: admin.id, reportRubricCriterionId: criterion.id });
      await report.deleteReportRubric({ actorId: admin.id, reportRubricVersionId: rubric.id });
      await report.deleteReportFieldLocalization({ actorId: admin.id, reportFieldLocalizationId: fieldLocale.id });
      await report.deleteReportField({ actorId: admin.id, reportFieldDefinitionId: field.id });
      await report.deleteReportAssignmentLocalization({ actorId: admin.id, reportAssignmentLocalizationId: assignmentLocale.id });
      await report.deleteReportAssignment({ actorId: admin.id, reportAssignmentVersionId: assignment.id });
      assert.equal(await prisma.reportAssignmentVersion.count({ where: { levelDefinitionId: auditLevel.id } }), 0);
    });

    const buildDraft = async (marker: string) => {
      const assignment = await report.createReportAssignment({ actorId: admin.id, levelDefinitionId: reportLevel.id, changeNotes: `assignment-${marker}` });
      await report.createReportAssignmentLocalization({ actorId: admin.id, reportAssignmentVersionId: assignment.id, locale: "en", title: `Assignment ${marker}`, instructions: `Instructions ${marker}`, successCriteriaSummary: "Complete evidence", submitLabel: "Submit" });
      const field = await report.createReportField({ actorId: admin.id, reportAssignmentVersionId: assignment.id, stableKey: `evidence-${marker}`, type: "url", required: true, sortOrder: 0, validationRules: { version: 1, allowedSchemes: ["https"] }, choiceCodes: null });
      await report.createReportFieldLocalization({ actorId: admin.id, reportFieldDefinitionId: field.id, locale: "en", label: `Evidence ${marker}`, helpText: "HTTPS only", placeholder: "https://example.com", choiceLabels: null });
      const rubric = await report.createReportRubric({ actorId: admin.id, reportAssignmentVersionId: assignment.id, changeNotes: `rubric-${marker}` });
      const criterion = await report.createReportCriterion({ actorId: admin.id, reportRubricVersionId: rubric.id, stableKey: `risk-${marker}`, categoryCode: "risk-management", sortOrder: 0, commentRequired: true });
      await report.createReportCriterionLocalization({ actorId: admin.id, reportRubricCriterionId: criterion.id, locale: "en", title: `Risk ${marker}`, description: "Risk process evidence" });
      const scale = await report.createReportScaleOption({ actorId: admin.id, reportRubricVersionId: rubric.id, stableKey: `meets-${marker}`, ordinal: 0 });
      await report.createReportScaleLocalization({ actorId: admin.id, reportRubricScaleOptionId: scale.id, locale: "en", label: "Meets", description: "Meets expectations" });
      const reason = await report.createReportReason({ actorId: admin.id, reportRubricVersionId: rubric.id, stableKey: `missing-${marker}`, sortOrder: 0, active: true });
      await report.createReportReasonLocalization({ actorId: admin.id, reportRejectionReasonId: reason.id, locale: "en", title: "Missing evidence", guidance: "Add the requested evidence" });
      return { assignment, field, rubric, criterion, scale, reason };
    };

    const first = await buildDraft("one");
    await check("8. assignment, field, rubric, criterion, scale and reason drafts are authored", async () => {
      assert.equal(await prisma.reportAssignmentLocalization.count({ where: { reportAssignmentVersionId: first.assignment.id } }), 1);
      assert.equal(await prisma.reportFieldDefinition.count({ where: { reportAssignmentVersionId: first.assignment.id } }), 1);
      assert.equal(await prisma.reportRubricCriterion.count({ where: { reportRubricVersionId: first.rubric.id } }), 1);
      assert.equal(await prisma.reportRubricScaleOption.count({ where: { reportRubricVersionId: first.rubric.id } }), 1);
      assert.equal(await prisma.reportRejectionReason.count({ where: { reportRubricVersionId: first.rubric.id } }), 1);
    });
    await check("9. no-change produces typed error and no audit", async () => {
      const before = await prisma.auditLog.count();
      await expectError(() => report.updateReportAssignment({ actorId: admin.id, reportAssignmentVersionId: first.assignment.id, patch: { changeNotes: "assignment-one" } }), "REPORT_NO_CHANGES");
      assert.equal(await prisma.auditLog.count(), before);
    });
    await check("10. field grammar rejects unsupported semantics and numeric formulas", async () => {
      await expectError(() => report.createReportField({ actorId: admin.id, reportAssignmentVersionId: first.assignment.id, stableKey: "unsafe", type: "url", required: true, sortOrder: 1, validationRules: { version: 1, regex: ".*" }, choiceCodes: null }), "REPORT_INPUT_INVALID");
      await expectError(() => report.createReportCriterion({ actorId: admin.id, reportRubricVersionId: first.rubric.id, stableKey: "weighted", categoryCode: "quality", sortOrder: 1, commentRequired: false, weight: 10 }), "REPORT_INPUT_INVALID");
    });
    await check("11. duplicate keys, order and locales fail closed", async () => {
      await expectError(() => report.createReportField({ actorId: admin.id, reportAssignmentVersionId: first.assignment.id, stableKey: "another", type: "boolean", required: false, sortOrder: 0, validationRules: { version: 1 }, choiceCodes: null }), "REPORT_ASSIGNMENT_CONFLICT");
      await expectError(() => report.createReportReason({ actorId: admin.id, reportRubricVersionId: first.rubric.id, stableKey: first.reason.stableKey, sortOrder: 1, active: true }), "REPORT_RUBRIC_CONFLICT");
      await expectError(() => report.createReportReasonLocalization({ actorId: admin.id, reportRejectionReasonId: first.reason.id, locale: "en", title: "Duplicate", guidance: "Duplicate" }), "REPORT_RUBRIC_CONFLICT");
    });
    await check("12. non-empty draft deletion is rejected", async () => {
      await expectError(() => report.deleteReportRubric({ actorId: admin.id, reportRubricVersionId: first.rubric.id }), "REPORT_NOT_EMPTY");
      await expectError(() => report.deleteReportAssignment({ actorId: admin.id, reportAssignmentVersionId: first.assignment.id }), "REPORT_NOT_EMPTY");
    });
    await check("13. incomplete rubric publication aggregates issues", async () => {
      const empty = await report.createReportRubric({ actorId: admin.id, reportAssignmentVersionId: first.assignment.id });
      const error = await expectError(() => report.publishReportRubric({ actorId: admin.id, reportRubricVersionId: empty.id, expectedPublishedReportRubricVersionId: null }), "REPORT_PUBLICATION_INVALID");
      assert.ok(error.issues.length >= 4);
      await report.deleteReportRubric({ actorId: admin.id, reportRubricVersionId: empty.id });
    });
    await check("14. profit-only criterion blocks publication", async () => {
      await report.updateReportCriterion({ actorId: admin.id, reportRubricCriterionId: first.criterion.id, patch: { categoryCode: "profit" } });
      const error = await expectError(() => report.publishReportRubric({ actorId: admin.id, reportRubricVersionId: first.rubric.id, expectedPublishedReportRubricVersionId: null }), "REPORT_PUBLICATION_INVALID");
      assert.ok(error.issues.some((issue) => issue.code === "REPORT_PROFIT_CRITERION_FORBIDDEN"));
      await report.updateReportCriterion({ actorId: admin.id, reportRubricCriterionId: first.criterion.id, patch: { categoryCode: "risk-management" } });
    });
    await check("15. valid rubric and assignment publish full snapshots", async () => {
      const rubric = await report.publishReportRubric({ actorId: admin.id, reportRubricVersionId: first.rubric.id, expectedPublishedReportRubricVersionId: null });
      assert.equal(rubric.published.status, "published");
      const assignment = await report.publishReportAssignment({ actorId: admin.id, reportAssignmentVersionId: first.assignment.id, reportRubricVersionId: first.rubric.id, expectedPublishedReportAssignmentVersionId: null });
      assert.equal(assignment.published.status, "published");
    });
    await check("16. published definitions are immutable", async () => {
      await expectError(() => report.updateReportAssignment({ actorId: admin.id, reportAssignmentVersionId: first.assignment.id, patch: { changeNotes: "changed" } }), "REPORT_PUBLISHED_IMMUTABLE");
      await expectError(() => report.updateReportReason({ actorId: admin.id, reportRejectionReasonId: first.reason.id, patch: { active: false } }), "REPORT_PUBLISHED_IMMUTABLE");
    });
    let binding = await report.setReportBinding({ actorId: admin.id, levelDefinitionId: reportLevel.id, reportAssignmentVersionId: first.assignment.id, reportRubricVersionId: first.rubric.id, expectedBindingRevision: null });
    await check("17. exact published assignment and rubric bind with revision zero", () => {
      assert.equal(binding.revision, 0); assert.equal(binding.reportRubricVersionId, first.rubric.id);
    });
    await check("18. exact no-op bind creates no audit", async () => {
      const before = await prisma.auditLog.count();
      await expectError(() => report.setReportBinding({ actorId: admin.id, levelDefinitionId: reportLevel.id, reportAssignmentVersionId: first.assignment.id, reportRubricVersionId: first.rubric.id, expectedBindingRevision: 0 }), "REPORT_NO_CHANGES");
      assert.equal(await prisma.auditLog.count(), before);
    });
    await check("19. bound published assignment and rubric cannot be archived", async () => {
      await expectError(() => report.archiveReportAssignment({ actorId: admin.id, reportAssignmentVersionId: first.assignment.id }), "REPORT_BINDING_CONFLICT");
      await expectError(() => report.archiveReportRubric({ actorId: admin.id, reportRubricVersionId: first.rubric.id }), "REPORT_BINDING_CONFLICT");
    });

    const second = await buildDraft("two");
    await report.publishReportRubric({ actorId: admin.id, reportRubricVersionId: second.rubric.id, expectedPublishedReportRubricVersionId: null });
    await check("20. assignment replacement requires exact published ID and binding CAS", async () => {
      await expectError(() => report.publishReportAssignment({ actorId: admin.id, reportAssignmentVersionId: second.assignment.id, reportRubricVersionId: second.rubric.id, expectedBindingRevision: binding.revision }), "REPORT_REPLACEMENT_REQUIRED");
      await expectError(() => report.publishReportAssignment({ actorId: admin.id, reportAssignmentVersionId: second.assignment.id, reportRubricVersionId: second.rubric.id, expectedPublishedReportAssignmentVersionId: 2_000_000_000, expectedBindingRevision: binding.revision }), "REPORT_REPLACEMENT_MISMATCH");
      await expectError(() => report.publishReportAssignment({ actorId: admin.id, reportAssignmentVersionId: second.assignment.id, reportRubricVersionId: second.rubric.id, expectedPublishedReportAssignmentVersionId: first.assignment.id, expectedBindingRevision: 99 }), "REPORT_VERSION_MISMATCH");
    });
    await check("21. assignment replacement atomically archives old graph and rebinds", async () => {
      const result = await report.publishReportAssignment({ actorId: admin.id, reportAssignmentVersionId: second.assignment.id, reportRubricVersionId: second.rubric.id, expectedPublishedReportAssignmentVersionId: first.assignment.id, expectedBindingRevision: binding.revision });
      assert.equal(result.replaced?.status, "archived");
      assert.equal(result.binding?.reportAssignmentVersionId, second.assignment.id);
      assert.equal(result.binding?.revision, 1);
      binding = result.binding!;
      assert.equal((await prisma.reportRubricVersion.findUniqueOrThrow({ where: { id: first.rubric.id } })).status, "archived");
      assert.equal(await prisma.reportAssignmentVersion.count({ where: { levelDefinitionId: reportLevel.id, status: "published" } }), 1);
    });

    const replacementRubric = await report.createReportRubric({ actorId: admin.id, reportAssignmentVersionId: second.assignment.id, changeNotes: "rubric replacement" });
    const replacementCriterion = await report.createReportCriterion({ actorId: admin.id, reportRubricVersionId: replacementRubric.id, stableKey: "process", categoryCode: "process-quality", sortOrder: 0, commentRequired: true });
    await report.createReportCriterionLocalization({ actorId: admin.id, reportRubricCriterionId: replacementCriterion.id, locale: "en", title: "Process", description: "Process quality" });
    const replacementScale = await report.createReportScaleOption({ actorId: admin.id, reportRubricVersionId: replacementRubric.id, stableKey: "meets", ordinal: 0 });
    await report.createReportScaleLocalization({ actorId: admin.id, reportRubricScaleOptionId: replacementScale.id, locale: "en", label: "Meets", description: "Meets" });
    const replacementReason = await report.createReportReason({ actorId: admin.id, reportRubricVersionId: replacementRubric.id, stableKey: "incomplete", sortOrder: 0, active: true });
    await report.createReportReasonLocalization({ actorId: admin.id, reportRejectionReasonId: replacementReason.id, locale: "en", title: "Incomplete", guidance: "Complete it" });
    await check("22. rubric replacement atomically archives old rubric and moves binding", async () => {
      const result = await report.publishReportRubric({ actorId: admin.id, reportRubricVersionId: replacementRubric.id, expectedPublishedReportRubricVersionId: second.rubric.id, expectedBindingRevision: binding.revision });
      assert.equal(result.replaced?.status, "archived");
      assert.equal(result.binding?.reportRubricVersionId, replacementRubric.id);
      assert.equal(result.binding?.revision, 2);
      binding = result.binding!;
    });
    await check("23. stale unbind fails; exact revision unbinds without deleting definitions", async () => {
      await expectError(() => report.clearReportBinding({ actorId: admin.id, levelDefinitionId: reportLevel.id, expectedBindingRevision: 1 }), "REPORT_VERSION_MISMATCH");
      await report.clearReportBinding({ actorId: admin.id, levelDefinitionId: reportLevel.id, expectedBindingRevision: binding.revision });
      assert.equal(await prisma.levelReportBinding.count({ where: { levelDefinitionId: reportLevel.id } }), 0);
      assert.ok(await prisma.reportAssignmentVersion.findUnique({ where: { id: second.assignment.id } }));
    });
    await check("24. unbound published assignment archives with its published rubric", async () => {
      const archived = await report.archiveReportAssignment({ actorId: admin.id, reportAssignmentVersionId: second.assignment.id });
      assert.equal(archived.status, "archived");
      assert.equal((await prisma.reportRubricVersion.findUniqueOrThrow({ where: { id: replacementRubric.id } })).status, "archived");
    });
    await check("25. published parent curriculum is immutable", async () => {
      const locked = await prisma.curriculumVersion.create({ data: { code: "locked-report", name: "Locked", versionNumber: 1, status: "published", publishedAt: new Date() } });
      const lockedModule = await prisma.moduleDefinition.create({ data: { curriculumVersionId: locked.id, moduleNumber: 1, code: "locked", title: "Locked", firstLevel: 1, lastLevel: 1 } });
      const lockedLevel = await prisma.levelDefinition.create({ data: { curriculumVersionId: locked.id, moduleId: lockedModule.id, levelNumber: 1, stableCode: "v2.locked.report", type: "report", title: "Locked", completionMethod: "report_approval" } });
      await expectError(() => report.createReportAssignment({ actorId: admin.id, levelDefinitionId: lockedLevel.id }), "REPORT_PUBLISHED_IMMUTABLE");
    });
    await check("26. authoring never touches submissions, reviews, XP or V1 reports", async () => {
      assert.deepEqual({
        submissions: await prisma.reportSubmission.count(), revisions: await prisma.reportRevision.count(),
        reviews: await prisma.reportReview.count(), xp: await prisma.xPTransaction.count(), v1: await prisma.taskReport.count(),
      }, baseline);
    });
    await check("27. audit metadata excludes presentation and JSON payloads", async () => {
      const rows = await prisma.auditLog.findMany({ where: { action: { startsWith: "REPORT_" } } });
      const serialized = JSON.stringify(rows.map((row) => row.metadata));
      assert.doesNotMatch(serialized, /Instructions|Complete evidence|HTTPS only|Missing evidence|requested evidence/);
      assert.ok(rows.length > 20);
    });
  } finally {
    await prisma.$disconnect();
    cleanup();
    delete process.env.CURRICULUM_V2_REPORT_ENABLED;
  }

  console.log(`\nReport authoring regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
