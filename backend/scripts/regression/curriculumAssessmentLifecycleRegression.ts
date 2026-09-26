import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isAssessmentDomainError } from "../../src/lib/curriculum/assessment-errors";
import type { AssessmentDomainErrorCode } from "../../src/lib/curriculum/assessment-errors";
import { canonicalizeQuestion } from "../../src/lib/curriculum/assessment-validation";

const dbPath = path.join(os.tmpdir(), `ata-assessment-lifecycle-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
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

async function expectError(fn: () => Promise<unknown>, code: AssessmentDomainErrorCode) {
  try {
    await fn();
  } catch (error) {
    if (isAssessmentDomainError(error, code)) return error;
    throw new Error(`expected ${code}, got ${String(error)}`);
  }
  throw new Error(`expected ${code}, operation succeeded`);
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

const choiceOptions = [{ code: "alpha" }, { code: "beta" }, { code: "gamma" }];
const choiceLabels = { alpha: "Alpha", beta: "Beta", gamma: "Gamma" };

async function main() {
  cleanupDb();
  const runner = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (runner.status !== 0) throw new Error(`${runner.stdout}\n${runner.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  delete process.env.CURRICULUM_V2_ASSESSMENT_ENABLED;
  const { prisma } = await import("../../src/lib/prisma");
  const assessment = await import("../../src/lib/curriculum/assessment");
  const lifecycleForPublish = await import("../../src/lib/curriculum/authoring-lifecycle");

  /**
   * PHASE-G0 CORRECTION — the assessment domain now REQUIRES the aggregate
   * revision on every substantive mutation. Same rationale as the content
   * suite: this file tests the accepted assessment rules, and the stale-write
   * refusal is proven where it belongs — in the authoring foundation and the
   * mutation-boundary suites, which pass deliberately stale values.
   */
  async function assessmentRev(target: {
    assessmentVersionId?: number;
    questionDefinitionId?: number;
    questionLocalizationId?: number;
  }): Promise<number> {
    let id = target.assessmentVersionId;
    let questionId = target.questionDefinitionId;
    if (id === undefined && questionId === undefined && target.questionLocalizationId !== undefined) {
      const loc = await prisma.questionLocalization.findUnique({
        where: { id: target.questionLocalizationId },
        select: { questionId: true },
      });
      questionId = loc?.questionId;
    }
    if (id === undefined && questionId !== undefined) {
      const q = await prisma.questionDefinition.findUnique({
        where: { id: questionId },
        select: { assessmentVersionId: true },
      });
      id = q?.assessmentVersionId;
    }
    if (id === undefined) return 1;
    const version = await prisma.assessmentVersion.findUnique({
      where: { id },
      select: { revision: true },
    });
    return version?.revision ?? 1;
  }

  /**
   * PHASE-G0 PUBLISH GATE — see the identical note in the content suite. A bank
   * must be editorially approved before it may enter the runtime, so fixtures
   * that test the PUBLICATION rules are driven through the real lifecycle by
   * three distinct actors first.
   */
  async function approveForPublish(assessmentVersionId: number) {
    const current = await lifecycleForPublish.readAggregate("assessment", assessmentVersionId);
    if (current.editorialState === "approved") return;
    const revision = await lifecycleForPublish.bumpAggregate(prisma as never, {
      kind: "assessment",
      id: assessmentVersionId,
      expectedRevision: current.revision,
      actorId: admin.id,
    });
    await lifecycleForPublish.submitForReview({
      kind: "assessment",
      id: assessmentVersionId,
      expectedRevision: revision,
      actorId: regular.id,
    });
    await lifecycleForPublish.approveVersion({
      kind: "assessment",
      id: assessmentVersionId,
      expectedRevision: revision,
      actorId: reviewer.id,
      validationPassed: true,
    });
  }

  /** Approve, then publish through the accepted command. */
  async function publishApprovedAssessment(args: {
    actorId: number;
    assessmentVersionId: number;
    expectedPublishedAssessmentVersionId?: number | null;
  }) {
    await approveForPublish(args.assessmentVersionId);
    return assessment.publishAssessmentVersion(args);
  }

  const admin = await prisma.user.create({ data: { email: "assessment-admin@example.com", name: "Admin", role: "admin" } });
  const regular = await prisma.user.create({ data: { email: "assessment-user@example.com", name: "User" } });
  const blocked = await prisma.user.create({ data: { email: "assessment-blocked@example.com", name: "Blocked", role: "admin", status: "blocked" } });
  const reviewer = await prisma.user.create({
    data: { email: "assessment-reviewer@example.com", name: "Reviewer", role: "admin" },
  });
  const curriculum = await prisma.curriculumVersion.create({ data: { code: "assessment-life", name: "Assessment", versionNumber: 1 } });
  const curriculumModule = await prisma.moduleDefinition.create({
    data: { curriculumVersionId: curriculum.id, moduleNumber: 1, code: "assessment-module", title: "Assessment", firstLevel: 1, lastLevel: 8 },
  });
  const levels = await Promise.all(Array.from({ length: 8 }, (_, index) => prisma.levelDefinition.create({
    data: {
      curriculumVersionId: curriculum.id,
      moduleId: curriculumModule.id,
      levelNumber: index + 1,
      stableCode: `v2.l${String(index + 1).padStart(3, "0")}.assessment-${index + 1}`,
      type: index === 7 ? "final_exam" : "lesson",
      title: `Level ${index + 1}`,
      completionMethod: "assessment_pass",
    },
  })));
  const foreignCurriculum = await prisma.curriculumVersion.create({ data: { code: "assessment-foreign", name: "Foreign", versionNumber: 1 } });
  const foreignModule = await prisma.moduleDefinition.create({
    data: { curriculumVersionId: foreignCurriculum.id, moduleNumber: 1, code: "foreign", title: "Foreign", firstLevel: 1, lastLevel: 1 },
  });
  const foreignLevel = await prisma.levelDefinition.create({
    data: { curriculumVersionId: foreignCurriculum.id, moduleId: foreignModule.id, levelNumber: 1, stableCode: "v2.l001.foreign-assessment", type: "lesson", title: "Foreign", completionMethod: "assessment_pass" },
  });

  const baseline = {
    attempts: await prisma.assessmentAttempt.count(),
    xp: await prisma.xPTransaction.count(),
    lessonProgress: await prisma.userLessonProgress.count(),
    v1Tasks: await prisma.task.count(),
    v1Progress: await prisma.userTaskProgress.count(),
  };

  async function createDraft(levelDefinitionId: number, passPercent = 80) {
    return assessment.createAssessmentVersion({ actorId: admin.id, levelDefinitionId, passPercent, maxAttempts: null, showExplanation: false, changeNotes: null });
  }

  async function addQuestion(
    assessmentVersionId: number,
    questionNumber: number,
    options: unknown = choiceOptions,
    correctAnswer: unknown = { code: "alpha" },
    type: "single_choice" | "multiple_choice" | "true_false" | "ordered_steps" | "scenario_choice" | "numeric" | "chart_choice" = "single_choice",
    locale = "en",
  ) {
    const question = await assessment.createAssessmentQuestion({ expectedRevision: await assessmentRev({ assessmentVersionId: assessmentVersionId }),
      actorId: admin.id,
      assessmentVersionId,
      questionNumber,
      stableKey: `question-${questionNumber}`,
      type,
      skillTag: null,
      options,
      correctAnswer,
    });
    const labels = type === "numeric" ? null : Object.fromEntries((options as Array<{ code: string }>).map((item) => [item.code, item.code.toUpperCase()]));
    await assessment.createQuestionLocalization({ expectedRevision: await assessmentRev({ questionDefinitionId: question.id }),
      actorId: admin.id,
      questionDefinitionId: question.id,
      locale,
      prompt: `Prompt ${questionNumber}`,
      optionLabels: labels,
      explanation: null,
    });
    return question;
  }

  async function fillChoiceDraft(levelDefinitionId: number, locale = "en") {
    const draft = await createDraft(levelDefinitionId);
    for (let index = 1; index <= 5; index += 1) await addQuestion(draft.id, index, choiceOptions, { code: "alpha" }, "single_choice", locale);
    return draft;
  }

  try {
    await check("1. assessment flag defaults off without writes", async () => {
      const before = await prisma.assessmentVersion.count();
      await expectError(() => createDraft(levels[0].id), "ASSESSMENT_DISABLED");
      assert.equal(await prisma.assessmentVersion.count(), before);
    });
    await check("2. unrelated flags cannot enable assessment", async () => {
      process.env.CURRICULUM_V2_ADMIN_ENABLED = "true";
      process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
      process.env.CURRICULUM_V2_XP_ENABLED = "true";
      await expectError(() => createDraft(levels[0].id), "ASSESSMENT_DISABLED");
    });
    process.env.CURRICULUM_V2_ASSESSMENT_ENABLED = "true";
    await check("3. assessment flag is dynamic", async () => {
      const draft = await createDraft(levels[0].id);
      assert.equal(draft.status, "draft");
      assert.equal(draft.createdById, admin.id);
      await assessment.deleteAssessmentVersion({ expectedRevision: await assessmentRev({ assessmentVersionId: draft.id }), actorId: admin.id, assessmentVersionId: draft.id });
    });
    await check("4. missing actor is rejected", () => expectError(
      () => assessment.createAssessmentVersion({ actorId: 2_000_000_000, levelDefinitionId: levels[0].id, passPercent: 80 }),
      "ASSESSMENT_ACTOR_FORBIDDEN",
    ).then(() => undefined));
    await check("5. non-admin actor is rejected", () => expectError(
      () => assessment.createAssessmentVersion({ actorId: regular.id, levelDefinitionId: levels[0].id, passPercent: 80 }),
      "ASSESSMENT_ACTOR_FORBIDDEN",
    ).then(() => undefined));
    await check("6. blocked admin is rejected", () => expectError(
      () => assessment.createAssessmentVersion({ actorId: blocked.id, levelDefinitionId: levels[0].id, passPercent: 80 }),
      "ASSESSMENT_ACTOR_FORBIDDEN",
    ).then(() => undefined));
    await check("7. lifecycle and identity fields are strict-forbidden", () => expectError(
      () => assessment.createAssessmentVersion({ actorId: admin.id, levelDefinitionId: levels[0].id, passPercent: 80, versionNumber: 99, status: "published", createdById: regular.id }),
      "ASSESSMENT_INPUT_INVALID",
    ).then(() => undefined));

    const empty = await createDraft(levels[0].id);
    const next = await createDraft(levels[0].id);
    await check("8. version numbers are monotonic and server allocated", () => {
      assert.equal(empty.versionNumber, 1);
      assert.equal(next.versionNumber, 2);
    });
    await check("9. draft assessment metadata updates", async () => {
      const updated = await assessment.updateAssessmentVersion({ expectedRevision: await assessmentRev({ assessmentVersionId: empty.id }), actorId: admin.id, assessmentVersionId: empty.id, patch: { maxAttempts: 3, showExplanation: true } });
      assert.equal(updated.maxAttempts, 3);
      assert.equal(updated.showExplanation, true);
    });
    await check("10. no-change assessment update is rejected without audit", async () => {
      const before = await prisma.auditLog.count();
      await expectError(async () => assessment.updateAssessmentVersion({ expectedRevision: await assessmentRev({ assessmentVersionId: empty.id }), actorId: admin.id, assessmentVersionId: empty.id, patch: { maxAttempts: 3 } }), "ASSESSMENT_NO_CHANGES");
      assert.equal(await prisma.auditLog.count(), before);
    });
    await check("11. empty unbound draft deletes", async () => {
      const deleted = await assessment.deleteAssessmentVersion({ expectedRevision: await assessmentRev({ assessmentVersionId: next.id }), actorId: admin.id, assessmentVersionId: next.id });
      assert.equal(deleted.id, next.id);
    });

    await check("12. single-choice schema canonicalizes", () => {
      assert.deepEqual(canonicalizeQuestion("single_choice", choiceOptions, { code: "beta" }).correctAnswer, { code: "beta" });
    });
    await check("13. multiple-choice is canonical set equality", () => {
      assert.deepEqual(canonicalizeQuestion("multiple_choice", choiceOptions, { codes: ["gamma", "alpha"] }).correctAnswer, { codes: ["alpha", "gamma"] });
      assert.throws(() => canonicalizeQuestion("multiple_choice", choiceOptions, { codes: ["alpha", "alpha"] }));
    });
    await check("14. true-false uses fixed ordered codes", () => {
      assert.deepEqual(canonicalizeQuestion("true_false", [{ code: "true" }, { code: "false" }], { code: "false" }).correctAnswer, { code: "false" });
      assert.throws(() => canonicalizeQuestion("true_false", [{ code: "false" }, { code: "true" }], { code: "false" }));
    });
    await check("15. ordered-steps requires a full permutation", () => {
      assert.deepEqual(canonicalizeQuestion("ordered_steps", choiceOptions, { codes: ["beta", "alpha", "gamma"] }).correctAnswer, { codes: ["beta", "alpha", "gamma"] });
      assert.throws(() => canonicalizeQuestion("ordered_steps", choiceOptions, { codes: ["alpha", "beta"] }));
    });
    await check("16. scenario-choice schema is deterministic", () => {
      assert.deepEqual(canonicalizeQuestion("scenario_choice", choiceOptions, { code: "gamma" }).correctAnswer, { code: "gamma" });
    });
    await check("17. numeric canonicalizes decimal strings without float", () => {
      assert.deepEqual(canonicalizeQuestion("numeric", null, { value: "-0.000" }).correctAnswer, { value: "0" });
      assert.deepEqual(canonicalizeQuestion("numeric", null, { value: "001.2300" }).correctAnswer, { value: "1.23" });
      assert.throws(() => canonicalizeQuestion("numeric", null, { value: 1.23 }));
    });
    await check("18. chart-choice authoring schema is deterministic", () => {
      assert.deepEqual(canonicalizeQuestion("chart_choice", choiceOptions, { code: "alpha" }).correctAnswer, { code: "alpha" });
    });
    await check("19. prototype keys and extra answer keys are rejected", () => {
      assert.throws(() => canonicalizeQuestion("single_choice", choiceOptions, { code: "alpha", isCorrect: true }));
      assert.throws(() => canonicalizeQuestion("single_choice", choiceOptions, { code: "alpha", constructor: {} }));
    });

    const question = await assessment.createAssessmentQuestion({ expectedRevision: await assessmentRev({ assessmentVersionId: empty.id }),
      actorId: admin.id, assessmentVersionId: empty.id, questionNumber: 1, stableKey: "first-question", type: "single_choice", skillTag: null, options: choiceOptions, correctAnswer: { code: "beta" },
    });
    await check("20. correct answer is stored canonical and never accepted in localization", async () => {
      assert.deepEqual(question.correctAnswer, { code: "beta" });
      await expectError(async () => assessment.createQuestionLocalization({ expectedRevision: await assessmentRev({ questionDefinitionId: question.id }), actorId: admin.id, questionDefinitionId: question.id, locale: "en", prompt: "Prompt", optionLabels: choiceLabels, explanation: null, correctAnswer: { code: "beta" } }), "ASSESSMENT_INPUT_INVALID");
    });
    await check("21. localization requires exact option-label keys", async () => {
      await expectError(async () => assessment.createQuestionLocalization({ expectedRevision: await assessmentRev({ questionDefinitionId: question.id }), actorId: admin.id, questionDefinitionId: question.id, locale: "en", prompt: "Prompt", optionLabels: { alpha: "A", beta: "B" }, explanation: null }), "ASSESSMENT_INPUT_INVALID");
    });
    const localization = await assessment.createQuestionLocalization({ expectedRevision: await assessmentRev({ questionDefinitionId: question.id }), actorId: admin.id, questionDefinitionId: question.id, locale: "en", prompt: "Prompt", optionLabels: choiceLabels, explanation: null });
    await check("22. locale is normalized and unique", async () => {
      assert.equal(localization.locale, "en");
      await expectError(async () => assessment.createQuestionLocalization({ expectedRevision: await assessmentRev({ questionDefinitionId: question.id }), actorId: admin.id, questionDefinitionId: question.id, locale: "EN", prompt: "Other", optionLabels: choiceLabels, explanation: null }), "ASSESSMENT_LOCALIZATION_CONFLICT");
    });
    await check("23. question cannot delete before its localizations", () => expectError(
      async () => assessment.deleteAssessmentQuestion({ expectedRevision: await assessmentRev({ questionDefinitionId: question.id }), actorId: admin.id, questionDefinitionId: question.id }),
      "ASSESSMENT_QUESTION_CONFLICT",
    ).then(() => undefined));
    await check("24. localization and question draft CRUD is audited", async () => {
      const updated = await assessment.updateQuestionLocalization({ expectedRevision: await assessmentRev({ questionLocalizationId: localization.id }), actorId: admin.id, questionLocalizationId: localization.id, patch: { prompt: "Updated prompt" } });
      assert.equal(updated.prompt, "Updated prompt");
      await assessment.deleteQuestionLocalization({ expectedRevision: await assessmentRev({ questionLocalizationId: localization.id }), actorId: admin.id, questionLocalizationId: localization.id });
      await assessment.deleteAssessmentQuestion({ expectedRevision: await assessmentRev({ questionDefinitionId: question.id }), actorId: admin.id, questionDefinitionId: question.id });
      const actions = await prisma.auditLog.findMany({ where: { entityId: { in: [String(question.id), String(localization.id)] } }, select: { action: true } });
      assert(actions.some((item) => item.action === "ASSESSMENT_QUESTION_DELETED"));
      assert(actions.some((item) => item.action === "ASSESSMENT_LOCALIZATION_UPDATED"));
    });
    await check("25. assessment with questions cannot delete", async () => {
      await addQuestion(empty.id, 1);
      await expectError(async () => assessment.deleteAssessmentVersion({ expectedRevision: await assessmentRev({ assessmentVersionId: empty.id }), actorId: admin.id, assessmentVersionId: empty.id }), "ASSESSMENT_NOT_EMPTY");
    });

    const badPass = await fillChoiceDraft(levels[1].id);
    await assessment.updateAssessmentVersion({ expectedRevision: await assessmentRev({ assessmentVersionId: badPass.id }), actorId: admin.id, assessmentVersionId: badPass.id, patch: { passPercent: 70 } });
    /*
     * AC-1: passPercent is now a bounded integer contract (1..100) instead of the
     * single value 80, so 70 is legitimately publishable and can no longer stand
     * in for "invalid". Out-of-range values are unreachable through both the
     * authoring command schema (int 1..100) and the DB CHECK, so the publication
     * validator's pass-percent branch is pure defence in depth and is covered
     * directly by curriculumAssessmentContractRegression (cases 3–5). The
     * publication-rejection + audit path is exercised here with a question count
     * outside the approved lesson bounds instead.
     */
    await check("26. publication collects safe question-count issues and audits rejection", async () => {
      const tooFew = await createDraft(levels[1].id);
      await addQuestion(tooFew.id, 1);
      await addQuestion(tooFew.id, 2);
      await addQuestion(tooFew.id, 3);
      const error = await expectError(() => assessment.publishAssessmentVersion({ actorId: admin.id, assessmentVersionId: tooFew.id }), "ASSESSMENT_PUBLICATION_INVALID");
      assert(error.issues.some((item) => item.code === "ASSESSMENT_LESSON_QUESTION_COUNT"));
      assert(await prisma.auditLog.findFirst({ where: { action: "ASSESSMENT_PUBLICATION_REJECTED", entityId: String(tooFew.id) } }));
      assert.equal((await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: tooFew.id } })).status, "draft");
    });
    await check("26b. bounded non-standard pass percent (70) is publishable", async () => {
      const bounded = await fillChoiceDraft(levels[1].id);
      await assessment.updateAssessmentVersion({ expectedRevision: await assessmentRev({ assessmentVersionId: bounded.id }), actorId: admin.id, assessmentVersionId: bounded.id, patch: { passPercent: 70 } });
      const result = await publishApprovedAssessment({ actorId: admin.id, assessmentVersionId: bounded.id });
      assert.equal(result.published.status, "published");
      assert.equal(result.published.passPercent, 70);
      await prisma.assessmentVersion.update({ where: { id: bounded.id }, data: { status: "archived", archivedAt: new Date() } });
    });

    const noCommon = await createDraft(levels[2].id);
    for (let index = 1; index <= 5; index += 1) await addQuestion(noCommon.id, index, choiceOptions, { code: "alpha" }, "single_choice", index === 5 ? "fr" : "en");
    await check("27. publication requires one common complete locale without default", async () => {
      const error = await expectError(() => assessment.publishAssessmentVersion({ actorId: admin.id, assessmentVersionId: noCommon.id }), "ASSESSMENT_PUBLICATION_INVALID");
      assert(error.issues.some((item) => item.code === "ASSESSMENT_COMMON_LOCALE_REQUIRED"));
    });

    const numeric = await createDraft(levels[3].id);
    await addQuestion(numeric.id, 1, null, { value: "12.50" }, "numeric");
    for (let index = 2; index <= 5; index += 1) await addQuestion(numeric.id, index);
    await check("28. numeric publication fails closed until grading is approved", async () => {
      const error = await expectError(() => assessment.publishAssessmentVersion({ actorId: admin.id, assessmentVersionId: numeric.id }), "ASSESSMENT_PUBLICATION_INVALID");
      assert(error.issues.some((item) => item.code === "ASSESSMENT_GRADING_UNSUPPORTED"));
    });

    const chart = await createDraft(levels[4].id);
    await addQuestion(chart.id, 1, choiceOptions, { code: "alpha" }, "chart_choice");
    for (let index = 2; index <= 5; index += 1) await addQuestion(chart.id, index);
    await check("29. chart publication fails closed until asset ownership is approved", async () => {
      const error = await expectError(() => assessment.publishAssessmentVersion({ actorId: admin.id, assessmentVersionId: chart.id }), "ASSESSMENT_PUBLICATION_INVALID");
      assert(error.issues.some((item) => item.code === "ASSESSMENT_CHART_ASSET_UNRESOLVED"));
    });

    const first = await fillChoiceDraft(levels[5].id);
    await check("30. valid lesson assessment publishes without auto-binding", async () => {
      const result = await publishApprovedAssessment({ actorId: admin.id, assessmentVersionId: first.id, expectedPublishedAssessmentVersionId: null });
      assert.equal(result.published.status, "published");
      assert.equal(result.replaced, null);
      assert.equal(await prisma.levelResourceBinding.findUnique({ where: { levelDefinitionId: levels[5].id } }), null);
    });
    await check("31. published assessment, question and localization are service-immutable", async () => {
      const publishedQuestion = await prisma.questionDefinition.findFirstOrThrow({ where: { assessmentVersionId: first.id }, include: { localizations: true } });
      await expectError(async () => assessment.updateAssessmentVersion({ expectedRevision: await assessmentRev({ assessmentVersionId: first.id }), actorId: admin.id, assessmentVersionId: first.id, patch: { changeNotes: "no" } }), "ASSESSMENT_PUBLISHED_IMMUTABLE");
      await expectError(async () => assessment.updateAssessmentQuestion({ expectedRevision: await assessmentRev({ questionDefinitionId: publishedQuestion.id }), actorId: admin.id, questionDefinitionId: publishedQuestion.id, patch: { stableKey: "changed" } }), "ASSESSMENT_PUBLISHED_IMMUTABLE");
      await expectError(async () => assessment.updateQuestionLocalization({ expectedRevision: await assessmentRev({ questionLocalizationId: publishedQuestion.localizations[0].id }), actorId: admin.id, questionLocalizationId: publishedQuestion.localizations[0].id, patch: { prompt: "changed" } }), "ASSESSMENT_PUBLISHED_IMMUTABLE");
    });
    await check("32. exact binding rejects cross-level ownership", () => expectError(
      () => assessment.setLevelAssessmentBinding({ actorId: admin.id, levelDefinitionId: foreignLevel.id, assessmentVersionId: first.id }),
      "ASSESSMENT_VERSION_MISMATCH",
    ).then(() => undefined));
    await assessment.setLevelAssessmentBinding({ actorId: admin.id, levelDefinitionId: levels[5].id, assessmentVersionId: first.id });
    await check("33. bound published assessment cannot archive directly", () => expectError(
      () => assessment.archiveAssessmentVersion({ actorId: admin.id, assessmentVersionId: first.id }),
      "ASSESSMENT_BINDING_CONFLICT",
    ).then(() => undefined));

    const content = await prisma.contentVersion.create({
      data: { levelDefinitionId: levels[5].id, curriculumVersionId: curriculum.id, versionNumber: 1, status: "published", createdById: admin.id, publishedAt: new Date() },
    });
    await prisma.levelResourceBinding.update({ where: { levelDefinitionId: levels[5].id }, data: { contentVersionId: content.id } });
    const replacement = await fillChoiceDraft(levels[5].id);
    await check("34. replacement requires exact current published ID", async () => {
      await expectError(() => publishApprovedAssessment({ actorId: admin.id, assessmentVersionId: replacement.id }), "ASSESSMENT_REPLACEMENT_REQUIRED");
      await expectError(() => publishApprovedAssessment({ actorId: admin.id, assessmentVersionId: replacement.id, expectedPublishedAssessmentVersionId: badPass.id }), "ASSESSMENT_REPLACEMENT_MISMATCH");
    });
    await check("35. exact replacement archives old and moves only its assessment pin", async () => {
      const result = await publishApprovedAssessment({ actorId: admin.id, assessmentVersionId: replacement.id, expectedPublishedAssessmentVersionId: first.id });
      assert.equal(result.replaced?.status, "archived");
      assert.equal(result.bindingMoved, true);
      const binding = await prisma.levelResourceBinding.findUniqueOrThrow({ where: { levelDefinitionId: levels[5].id } });
      assert.equal(binding.assessmentVersionId, replacement.id);
      assert.equal(binding.contentVersionId, content.id);
    });
    await check("36. clearing assessment preserves content side", async () => {
      const result = await assessment.clearLevelAssessmentBinding({ actorId: admin.id, levelDefinitionId: levels[5].id });
      assert.equal(result.deleted, false);
      assert.equal(result.binding?.contentVersionId, content.id);
      assert.equal(result.binding?.assessmentVersionId, null);
    });
    await check("37. unbound published assessment archives and cannot rebind", async () => {
      const archived = await assessment.archiveAssessmentVersion({ actorId: admin.id, assessmentVersionId: replacement.id });
      assert.equal(archived.status, "archived");
      await expectError(() => assessment.setLevelAssessmentBinding({ actorId: admin.id, levelDefinitionId: levels[5].id, assessmentVersionId: replacement.id }), "ASSESSMENT_BINDING_CONFLICT");
    });

    const onlyAssessment = await fillChoiceDraft(levels[6].id);
    await publishApprovedAssessment({ actorId: admin.id, assessmentVersionId: onlyAssessment.id });
    await assessment.setLevelAssessmentBinding({ actorId: admin.id, levelDefinitionId: levels[6].id, assessmentVersionId: onlyAssessment.id });
    await check("38. clearing assessment-only binding deletes the empty row", async () => {
      const result = await assessment.clearLevelAssessmentBinding({ actorId: admin.id, levelDefinitionId: levels[6].id });
      assert.equal(result.deleted, true);
      assert.equal(await prisma.levelResourceBinding.findUnique({ where: { levelDefinitionId: levels[6].id } }), null);
    });
    await check("39. audit metadata contains no answer or localized text", async () => {
      const rows = await prisma.auditLog.findMany({ where: { action: { startsWith: "ASSESSMENT_" } } });
      const serialized = JSON.stringify(rows.map((row) => row.metadata)).toLowerCase();
      for (const forbidden of ["correctanswer", "optionlabels", "prompt", "explanation", "updated prompt"]) {
        assert.equal(serialized.includes(forbidden), false, forbidden);
      }
    });
    await check("40. attempts, scoring, XP, lesson progress and V1 remain untouched", async () => {
      assert.deepEqual({
        attempts: await prisma.assessmentAttempt.count(),
        xp: await prisma.xPTransaction.count(),
        lessonProgress: await prisma.userLessonProgress.count(),
        v1Tasks: await prisma.task.count(),
        v1Progress: await prisma.userTaskProgress.count(),
      }, baseline);
    });

    const finalExam = await createDraft(levels[7].id);
    for (let index = 1; index <= 29; index += 1) await addQuestion(finalExam.id, index);
    await check("41. final exam requires exactly thirty questions", async () => {
      const error = await expectError(() => assessment.publishAssessmentVersion({ actorId: admin.id, assessmentVersionId: finalExam.id }), "ASSESSMENT_PUBLICATION_INVALID");
      assert(error.issues.some((item) => item.code === "ASSESSMENT_FINAL_EXAM_QUESTION_COUNT"));
    });
    await addQuestion(finalExam.id, 30);
    await check("42. final exam requires at least three scenario questions", async () => {
      const error = await expectError(() => assessment.publishAssessmentVersion({ actorId: admin.id, assessmentVersionId: finalExam.id }), "ASSESSMENT_PUBLICATION_INVALID");
      assert(error.issues.some((item) => item.code === "ASSESSMENT_FINAL_EXAM_SCENARIOS_REQUIRED"));
    });
    const firstThree = await prisma.questionDefinition.findMany({ where: { assessmentVersionId: finalExam.id }, orderBy: { questionNumber: "asc" }, take: 3 });
    for (const item of firstThree) {
      await assessment.updateAssessmentQuestion({ expectedRevision: await assessmentRev({ questionDefinitionId: item.id }), actorId: admin.id, questionDefinitionId: item.id, patch: { type: "scenario_choice" } });
    }
    await check("43. complete final exam publishes with approved deterministic types", async () => {
      const result = await publishApprovedAssessment({ actorId: admin.id, assessmentVersionId: finalExam.id });
      assert.equal(result.published.status, "published");
    });

    const beforeRollbackCreate = await prisma.assessmentVersion.count();
    await check("44. audit failure rolls back assessment create", async () => {
      await prisma.$executeRawUnsafe("CREATE TRIGGER fail_assessment_create_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'ASSESSMENT_VERSION_CREATED' BEGIN SELECT RAISE(ABORT, 'forced-audit-failure'); END");
      try {
        await expectError(() => createDraft(levels[0].id), "ASSESSMENT_INTERNAL_ERROR");
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER fail_assessment_create_audit");
      }
      assert.equal(await prisma.assessmentVersion.count(), beforeRollbackCreate);
    });

    const rollbackDraft = await createDraft(levels[0].id);
    await check("45. audit failure rolls back assessment update", async () => {
      await prisma.$executeRawUnsafe("CREATE TRIGGER fail_assessment_update_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'ASSESSMENT_VERSION_UPDATED' BEGIN SELECT RAISE(ABORT, 'forced-audit-failure'); END");
      try {
        await expectError(async () => assessment.updateAssessmentVersion({ expectedRevision: await assessmentRev({ assessmentVersionId: rollbackDraft.id }), actorId: admin.id, assessmentVersionId: rollbackDraft.id, patch: { changeNotes: "must rollback" } }), "ASSESSMENT_INTERNAL_ERROR");
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER fail_assessment_update_audit");
      }
      assert.equal((await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: rollbackDraft.id } })).changeNotes, null);
    });
    await check("46. audit failure rolls back assessment delete", async () => {
      await prisma.$executeRawUnsafe("CREATE TRIGGER fail_assessment_delete_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'ASSESSMENT_VERSION_DELETED' BEGIN SELECT RAISE(ABORT, 'forced-audit-failure'); END");
      try {
        await expectError(async () => assessment.deleteAssessmentVersion({ expectedRevision: await assessmentRev({ assessmentVersionId: rollbackDraft.id }), actorId: admin.id, assessmentVersionId: rollbackDraft.id }), "ASSESSMENT_INTERNAL_ERROR");
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER fail_assessment_delete_audit");
      }
      assert(await prisma.assessmentVersion.findUnique({ where: { id: rollbackDraft.id } }));
    });

    await assessment.updateAssessmentVersion({ expectedRevision: await assessmentRev({ assessmentVersionId: badPass.id }), actorId: admin.id, assessmentVersionId: badPass.id, patch: { passPercent: 80 } });
    await check("47. audit failure rolls back assessment publication", async () => {
      await prisma.$executeRawUnsafe("CREATE TRIGGER fail_assessment_publish_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'ASSESSMENT_VERSION_PUBLISHED' BEGIN SELECT RAISE(ABORT, 'forced-audit-failure'); END");
      try {
        await expectError(() => publishApprovedAssessment({ actorId: admin.id, assessmentVersionId: badPass.id }), "ASSESSMENT_INTERNAL_ERROR");
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER fail_assessment_publish_audit");
      }
      assert.equal((await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: badPass.id } })).status, "draft");
    });
    await check("48. audit failure rolls back exact assessment binding", async () => {
      await prisma.$executeRawUnsafe("CREATE TRIGGER fail_assessment_bind_audit BEFORE INSERT ON AuditLog WHEN NEW.action = 'ASSESSMENT_BOUND' BEGIN SELECT RAISE(ABORT, 'forced-audit-failure'); END");
      try {
        await expectError(() => assessment.setLevelAssessmentBinding({ actorId: admin.id, levelDefinitionId: levels[7].id, assessmentVersionId: finalExam.id }), "ASSESSMENT_INTERNAL_ERROR");
      } finally {
        await prisma.$executeRawUnsafe("DROP TRIGGER fail_assessment_bind_audit");
      }
      assert.equal(await prisma.levelResourceBinding.findUnique({ where: { levelDefinitionId: levels[7].id } }), null);
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
  }

  assert.equal(passed + failed, 49, "assessment lifecycle scenario count drifted");
  if (failed > 0) throw new Error(`${failed} assessment lifecycle scenario(s) failed`);
  console.log(`\ncurriculum assessment lifecycle regression: ${passed} passed, ${failed} failed`);
  console.log("logical groups: gate/admin 7; version lifecycle 4; answer contracts 8; question/localization CRUD 6; publication validation 7; publish/binding/replacement 10; isolation 1; audit atomicity 5");
}

main().catch((error) => {
  cleanupDb();
  console.error(`\ncurriculum assessment lifecycle regression failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
