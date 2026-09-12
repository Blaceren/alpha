import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-assessment-runtime-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const previousDatabaseUrl = process.env.DATABASE_URL;
const flags = [
  "CURRICULUM_V2_READ_ENABLED",
  "CURRICULUM_V2_ENROLLMENT_ENABLED",
  "CURRICULUM_V2_ASSESSMENT_ENABLED",
  "CURRICULUM_V2_XP_ENABLED",
] as const;
const previousFlags = Object.fromEntries(flags.map((flag) => [flag, process.env[flag]]));
let passed = 0;
let failed = 0;
let sequence = 0;

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

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

async function main() {
  cleanup();
  const migrate = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migrate.status !== 0) throw new Error(`${migrate.stdout}\n${migrate.stderr}`);
  process.env.DATABASE_URL = dbUrl;
  for (const flag of flags) delete process.env[flag];

  const { prisma } = await import("../../src/lib/prisma");
  const runtime = await import("../../src/lib/curriculum/assessment-runtime");
  const completion = await import("../../src/lib/curriculum/completion");

  function enableBase(xp = true) {
    process.env.CURRICULUM_V2_READ_ENABLED = "true";
    process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
    process.env.CURRICULUM_V2_ASSESSMENT_ENABLED = "true";
    process.env.CURRICULUM_V2_XP_ENABLED = xp ? "true" : "false";
  }

  async function expectError(fn: () => Promise<unknown>, code: string) {
    try {
      await fn();
    } catch (error) {
      if (!runtime.isAssessmentRuntimeError(error)) {
        throw new Error(`expected ${code}, got non-runtime error: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      }
      assert.equal((error as { code: string }).code, code);
      const serialized = JSON.stringify({ name: (error as Error).name, code: (error as { code: string }).code });
      assert.equal(serialized.includes("correctAnswer"), false);
      assert.equal(serialized.includes(dbPath), false);
      return;
    }
    throw new Error(`expected ${code}, operation succeeded`);
  }

  type FixtureOptions = {
    levelType?: "lesson" | "final_exam" | "practice";
    maxAttempts?: number | null;
    xpReward?: number;
    progress?: boolean;
    curriculumStatus?: "published" | "archived";
    finalLevel?: boolean;
    actorStatus?: "active" | "blocked";
  };

  async function resetV2() {
    await prisma.auditLog.deleteMany();
    await prisma.xPTransaction.deleteMany();
    await prisma.assessmentAttempt.deleteMany();
    await prisma.userLessonProgressSaveReceipt.deleteMany();
    await prisma.userLessonProgress.deleteMany();
    await prisma.userLevelProgress.deleteMany();
    await prisma.levelResourceBinding.deleteMany();
    await prisma.questionLocalization.deleteMany();
    await prisma.questionDefinition.deleteMany();
    await prisma.assessmentVersion.deleteMany();
    await prisma.contentAsset.deleteMany();
    await prisma.contentLocalization.deleteMany();
    await prisma.contentVersion.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.user.deleteMany();
  }

  async function fixture(options: FixtureOptions = {}) {
    await resetV2();
    sequence += 1;
    const levelType = options.levelType ?? "lesson";
    const finalLevel = options.finalLevel ?? false;
    const now = new Date(`2026-07-${String(1 + (sequence % 20)).padStart(2, "0")}T10:00:00.000Z`);
    const user = await prisma.user.create({
      data: {
        email: `assessment-runtime-${sequence}@example.com`,
        name: `Runtime ${sequence}`,
        status: options.actorStatus ?? "active",
      },
    });
    const curriculum = await prisma.curriculumVersion.create({
      data: {
        code: "ata-v2",
        name: `Runtime ${sequence}`,
        versionNumber: 10_000 + sequence,
        status: options.curriculumStatus ?? "published",
        publishedAt: now,
      },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: curriculum.id,
        moduleNumber: 1,
        code: `runtime-${sequence}`,
        title: "Runtime",
        firstLevel: 1,
        lastLevel: finalLevel ? 1 : 2,
      },
    });
    const level = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: curriculum.id,
        moduleId: moduleDefinition.id,
        levelNumber: 1,
        stableCode: `v2.l001.runtime-${sequence}`,
        type: levelType,
        title: "Assessed level",
        completionMethod: "assessment_pass",
        xpReward: options.xpReward ?? 37,
      },
    });
    if (!finalLevel) {
      await prisma.levelDefinition.create({
        data: {
          curriculumVersionId: curriculum.id,
          moduleId: moduleDefinition.id,
          levelNumber: 2,
          stableCode: `v2.l002.runtime-next-${sequence}`,
          type: "lesson",
          title: "Next level",
          completionMethod: "manual",
          xpReward: 10,
          requiredPreviousLevel: 1,
        },
      });
    }
    const enrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: user.id,
        curriculumVersionId: curriculum.id,
        curriculumCode: "ata-v2",
        status: "active",
        currentLevel: 1,
        highestCompletedLevel: 0,
        enrolledAt: now,
      },
    });
    const progress = options.progress === false ? null : await prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrollment.id,
        curriculumVersionId: curriculum.id,
        levelDefinitionId: level.id,
        status: "in_progress",
        startedAt: now,
        lastProgressAt: now,
      },
    });
    const assessment = await prisma.assessmentVersion.create({
      data: {
        levelDefinitionId: level.id,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        status: "published",
        passPercent: 80,
        maxAttempts: options.maxAttempts ?? null,
        publishedAt: now,
      },
    });
    const count = levelType === "final_exam" ? 30 : 5;
    for (let number = 1; number <= count; number += 1) {
      const type = levelType === "final_exam"
        ? number <= 3 ? "scenario_choice" : "single_choice"
        : (["single_choice", "multiple_choice", "true_false", "ordered_steps", "scenario_choice"] as const)[number - 1];
      const optionsForQuestion = type === "true_false"
        ? [{ code: "true" }, { code: "false" }]
        : [{ code: "alpha" }, { code: "beta" }, { code: "gamma" }];
      const correctAnswer = type === "multiple_choice"
        ? { codes: ["alpha", "gamma"] }
        : type === "ordered_steps"
          ? { codes: ["beta", "alpha", "gamma"] }
          : type === "true_false" ? { code: "true" } : { code: "alpha" };
      const question = await prisma.questionDefinition.create({
        data: {
          assessmentVersionId: assessment.id,
          questionNumber: number,
          stableKey: `question-${number}`,
          type,
          status: "active",
          options: optionsForQuestion,
          correctAnswer,
        },
      });
      await prisma.questionLocalization.create({
        data: {
          questionId: question.id,
          locale: "en",
          prompt: `Prompt ${number}`,
          optionLabels: Object.fromEntries(optionsForQuestion.map(({ code }) => [code, code.toUpperCase()])),
        },
      });
    }
    await prisma.levelResourceBinding.create({
      data: {
        levelDefinitionId: level.id,
        curriculumVersionId: curriculum.id,
        assessmentVersionId: assessment.id,
      },
    });
    return { user, curriculum, level, enrollment, progress, assessment, now };
  }

  function answerFor(type: string, correct: boolean) {
    if (type === "multiple_choice") return { codes: correct ? ["gamma", "alpha"] : ["beta"] };
    if (type === "ordered_steps") return { codes: correct ? ["beta", "alpha", "gamma"] : ["alpha", "beta", "gamma"] };
    if (type === "true_false") return { code: correct ? "true" : "false" };
    return { code: correct ? "alpha" : "beta" };
  }

  function answers(start: Awaited<ReturnType<typeof runtime.startOwnAssessmentAttempt>>, correctCount?: number) {
    return start.assessment.questions.map((question, index) => ({
      questionKey: question.questionKey,
      answer: answerFor(question.type, correctCount === undefined || index < correctCount),
    }));
  }

  const startAt = new Date("2026-07-15T10:00:00.000Z");
  const submitAt = new Date("2026-07-15T10:01:00.000Z");

  const disabled = await fixture();
  await check("READ/ENROLLMENT/ASSESSMENT default false", () =>
    expectError(
      () => runtime.startOwnAssessmentAttempt(disabled.user.id, { levelNumber: 1, locale: "en" }),
      "ASSESSMENT_RUNTIME_DISABLED",
    ));
  await check("ADMIN/CONTENT/XP cannot replace base gates", async () => {
    process.env.CURRICULUM_V2_ADMIN_ENABLED = "true";
    process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
    process.env.CURRICULUM_V2_XP_ENABLED = "true";
    await expectError(
      () => runtime.startOwnAssessmentAttempt(disabled.user.id, { levelNumber: 1, locale: "en" }),
      "ASSESSMENT_RUNTIME_DISABLED",
    );
  });
  enableBase();
  await check("missing actor is rejected", () =>
    expectError(
      () => runtime.startOwnAssessmentAttempt(2_000_000_000, { levelNumber: 1, locale: "en" }),
      "ASSESSMENT_USER_NOT_FOUND",
    ));
  const blocked = await fixture({ actorStatus: "blocked" });
  await check("blocked actor is rejected", () =>
    expectError(
      () => runtime.startOwnAssessmentAttempt(blocked.user.id, { levelNumber: 1, locale: "en" }),
      "ASSESSMENT_USER_NOT_FOUND",
    ));
  await check("caller-controlled ownership and score fields are rejected", async () => {
    await expectError(
      () => runtime.startOwnAssessmentAttempt(disabled.user.id, { levelNumber: 1, locale: "en", enrollmentId: 9 } as never),
      "ASSESSMENT_SUBMISSION_INVALID",
    );
  });
  const unsupported = await fixture({ levelType: "practice" });
  await check("unsupported level owner fails closed", () =>
    expectError(
      () => runtime.startOwnAssessmentAttempt(unsupported.user.id, { levelNumber: 1, locale: "en" }),
      "ASSESSMENT_LEVEL_UNSUPPORTED",
    ));
  const notStarted = await fixture({ progress: false });
  await check("runtime never lazy-starts level progress", () =>
    expectError(
      () => runtime.startOwnAssessmentAttempt(notStarted.user.id, { levelNumber: 1, locale: "en" }),
      "ASSESSMENT_LEVEL_NOT_STARTED",
    ));

  const ordinary = await fixture({ maxAttempts: 2 });
  await check("locale is exact without fallback", () =>
    expectError(
      () => runtime.startOwnAssessmentAttempt(ordinary.user.id, { levelNumber: 1, locale: "fr" }),
      "ASSESSMENT_LOCALIZATION_UNAVAILABLE",
    ));
  const first = await runtime.startOwnAssessmentAttempt(
    ordinary.user.id,
    { stableCode: ordinary.level.stableCode, locale: "en" },
    { evaluationTime: startAt },
  );
  await check("assessed lesson starts with server attempt number", () => {
    assert.equal(first.created, true);
    assert.equal(first.attempt.attemptNumber, 1);
    assert.equal(first.assessment.questions.length, 5);
  });
  await check("safe question mapper exposes no answer or internal ownership IDs", () => {
    const serialized = JSON.stringify(first);
    for (const forbidden of ["correctAnswer", "explanation", "assessmentVersionId", "enrollmentId", "curriculumVersionId", "createdById"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });
  const startAuditCount = await prisma.auditLog.count({ where: { action: "CURRICULUM_ASSESSMENT_ATTEMPT_STARTED" } });
  const storedBeforeResume = await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: first.attempt.attemptId } });
  const resumed = await runtime.startOwnAssessmentAttempt(
    ordinary.user.id,
    { levelNumber: 1, locale: "en" },
    { evaluationTime: new Date("2026-07-15T10:05:00.000Z") },
  );
  await check("resume returns exact active attempt without timestamp touch", async () => {
    assert.equal(resumed.created, false);
    assert.equal(resumed.attempt.attemptId, first.attempt.attemptId);
    const stored = await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: first.attempt.attemptId } });
    assert.equal(stored.updatedAt.toISOString(), storedBeforeResume.updatedAt.toISOString());
  });
  await check("resume does not duplicate audit", async () => {
    assert.equal(await prisma.auditLog.count({ where: { action: "CURRICULUM_ASSESSMENT_ATTEMPT_STARTED" } }), startAuditCount);
  });
  await check("submit payload cannot define score/status/XP", () =>
    expectError(
      () => runtime.submitOwnAssessmentAttempt(ordinary.user.id, {
        attemptId: first.attempt.attemptId,
        requestId: "runtime:strict-submit",
        answers: answers(first),
        scoreBasisPoints: 10_000,
      } as never),
      "ASSESSMENT_SUBMISSION_INVALID",
    ));
  await check("missing answers are rejected", () =>
    expectError(
      () => runtime.submitOwnAssessmentAttempt(ordinary.user.id, {
        attemptId: first.attempt.attemptId,
        requestId: "runtime:missing-answer",
        answers: answers(first).slice(0, 4),
      }),
      "ASSESSMENT_SUBMISSION_INVALID",
    ));
  await check("duplicate answers are rejected", () => {
    const duplicated = answers(first);
    duplicated[4] = duplicated[0];
    return expectError(
      () => runtime.submitOwnAssessmentAttempt(ordinary.user.id, {
        attemptId: first.attempt.attemptId,
        requestId: "runtime:duplicate-answer",
        answers: duplicated,
      }),
      "ASSESSMENT_SUBMISSION_INVALID",
    );
  });
  await check("foreign attempt is hidden as not found", async () => {
    const foreign = await prisma.user.create({
      data: { email: "assessment-foreign-actor@example.com", name: "Foreign", status: "active" },
    });
    await expectError(
      () => runtime.submitOwnAssessmentAttempt(foreign.id, {
        attemptId: first.attempt.attemptId,
        requestId: "runtime:foreign-attempt",
        answers: answers(first),
      }),
      "ASSESSMENT_ATTEMPT_NOT_FOUND",
    );
  });

  const failedResult = await runtime.submitOwnAssessmentAttempt(
    ordinary.user.id,
    { attemptId: first.attempt.attemptId, requestId: "runtime:failed-attempt", answers: answers(first, 3) },
    { evaluationTime: submitAt },
  );
  await check("integer scoring fails below 80 percent", () => {
    assert.equal(failedResult.attempt.status, "failed");
    assert.equal(failedResult.attempt.correctCount, 3);
    assert.equal(failedResult.attempt.scoreBasisPoints, 6_000);
    assert.equal(failedResult.completion, null);
  });
  await check("failed attempt leaves progress/enrollment/XP unchanged", async () => {
    assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: ordinary.progress!.id } })).status, "in_progress");
    assert.equal((await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: ordinary.enrollment.id } })).currentLevel, 1);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: ordinary.enrollment.id } }), 0);
  });
  const failedStored = await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: first.attempt.attemptId } });
  const failedAuditCount = await prisma.auditLog.count({ where: { entityType: "AssessmentAttempt", entityId: String(first.attempt.attemptId) } });
  const failedRetry = await runtime.submitOwnAssessmentAttempt(
    ordinary.user.id,
    { attemptId: first.attempt.attemptId, requestId: "runtime:failed-attempt", answers: answers(first, 3) },
    { evaluationTime: new Date("2026-07-15T11:00:00.000Z") },
  );
  await check("exact failed retry returns stored result without touch", async () => {
    assert.equal(failedRetry.created, false);
    const stored = await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: first.attempt.attemptId } });
    assert.equal(stored.updatedAt.toISOString(), failedStored.updatedAt.toISOString());
    assert.equal(await prisma.auditLog.count({ where: { entityType: "AssessmentAttempt", entityId: String(first.attempt.attemptId) } }), failedAuditCount);
  });
  await check("terminal retry with different identity conflicts", () =>
    expectError(
      () => runtime.submitOwnAssessmentAttempt(ordinary.user.id, {
        attemptId: first.attempt.attemptId,
        requestId: "runtime:different-key",
        answers: answers(first, 3),
      }),
      "ASSESSMENT_SUBMISSION_CONFLICT",
    ));
  const second = await runtime.startOwnAssessmentAttempt(ordinary.user.id, { levelNumber: 1, locale: "en" });
  await check("failed attempt permits deterministic next attempt", () => {
    assert.equal(second.created, true);
    assert.equal(second.attempt.attemptNumber, 2);
  });
  await runtime.submitOwnAssessmentAttempt(
    ordinary.user.id,
    { attemptId: second.attempt.attemptId, requestId: "runtime:failed-second", answers: answers(second, 0) },
  );
  await check("exhausted attempt limit is typed and level stays open", async () => {
    await expectError(
      () => runtime.startOwnAssessmentAttempt(ordinary.user.id, { levelNumber: 1, locale: "en" }),
      "ASSESSMENT_ATTEMPT_LIMIT_REACHED",
    );
    assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: ordinary.progress!.id } })).status, "in_progress");
  });

  const xpGate = await fixture();
  const xpGateStart = await runtime.startOwnAssessmentAttempt(xpGate.user.id, { levelNumber: 1, locale: "en" }, { evaluationTime: startAt });
  enableBase(false);
  await check("passing submit additionally requires XP flag and rolls back", async () => {
    await expectError(
      () => runtime.submitOwnAssessmentAttempt(xpGate.user.id, {
        attemptId: xpGateStart.attempt.attemptId,
        requestId: "runtime:xp-disabled",
        answers: answers(xpGateStart, 4),
      }, { evaluationTime: submitAt }),
      "ASSESSMENT_RUNTIME_DISABLED",
    );
    assert.equal((await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: xpGateStart.attempt.attemptId } })).status, "in_progress");
  });
  enableBase();
  const passResult = await runtime.submitOwnAssessmentAttempt(
    xpGate.user.id,
    { attemptId: xpGateStart.attempt.attemptId, requestId: "runtime:xp-disabled", answers: answers(xpGateStart, 4) },
    { evaluationTime: submitAt },
  );
  await check("exact 80 percent atomically passes assessed lesson", async () => {
    assert.equal(passResult.attempt.status, "passed");
    assert.equal(passResult.attempt.correctCount, 4);
    assert.equal(passResult.completion?.xpAwarded, 37);
    assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: xpGate.progress!.id } })).status, "completed");
    assert.equal((await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: xpGate.enrollment.id } })).currentLevel, 2);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: xpGate.enrollment.id } }), 1);
  });
  await check("passed attempt owns grading, XP and completion audits", async () => {
    const actions = (await prisma.auditLog.findMany({ where: { userId: xpGate.user.id }, select: { action: true } })).map(({ action }) => action);
    for (const action of ["CURRICULUM_ASSESSMENT_ATTEMPT_STARTED", "CURRICULUM_ASSESSMENT_ATTEMPT_GRADED", "CURRICULUM_XP_AWARDED", "CURRICULUM_LEVEL_COMPLETED"]) {
      assert.equal(actions.filter((candidate) => candidate === action).length, 1, action);
    }
    assert.equal(JSON.stringify(await prisma.auditLog.findMany({ where: { userId: xpGate.user.id } })).includes("correctAnswer"), false);
  });
  const beforePassRetry = {
    attempt: await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: xpGateStart.attempt.attemptId } }),
    xp: await prisma.xPTransaction.count({ where: { enrollmentId: xpGate.enrollment.id } }),
    audits: await prisma.auditLog.count({ where: { userId: xpGate.user.id } }),
  };
  const passRetry = await runtime.submitOwnAssessmentAttempt(
    xpGate.user.id,
    { attemptId: xpGateStart.attempt.attemptId, requestId: "runtime:xp-disabled", answers: answers(xpGateStart, 4) },
  );
  await check("exact passed retry verifies durable state without duplicates", async () => {
    assert.equal(passRetry.created, false);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: xpGate.enrollment.id } }), beforePassRetry.xp);
    assert.equal(await prisma.auditLog.count({ where: { userId: xpGate.user.id } }), beforePassRetry.audits);
    assert.equal((await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: xpGateStart.attempt.attemptId } })).updatedAt.toISOString(), beforePassRetry.attempt.updatedAt.toISOString());
  });
  await check("terminal retry is anchored to its historical assessment snapshot", async () => {
    await prisma.assessmentVersion.update({
      where: { id: xpGate.assessment.id },
      data: { status: "archived", archivedAt: new Date("2026-07-15T12:00:00.000Z") },
    });
    const replacement = await prisma.assessmentVersion.create({
      data: {
        levelDefinitionId: xpGate.level.id,
        curriculumVersionId: xpGate.curriculum.id,
        versionNumber: 2,
        status: "published",
        passPercent: 80,
        publishedAt: new Date("2026-07-15T12:00:00.000Z"),
      },
    });
    await prisma.levelResourceBinding.update({
      where: { levelDefinitionId: xpGate.level.id },
      data: { assessmentVersionId: replacement.id },
    });
    const retry = await runtime.submitOwnAssessmentAttempt(
      xpGate.user.id,
      { attemptId: xpGateStart.attempt.attemptId, requestId: "runtime:xp-disabled", answers: answers(xpGateStart, 4) },
    );
    assert.equal(retry.created, false);
    assert.equal(retry.completion?.xpAwarded, 37);
  });
  await check("lesson assessment completion cannot be called without durable pass proof", async () => {
    const direct = await fixture();
    const result = await completion.completeCurriculumLevel({
      db: prisma,
      enrollmentId: direct.enrollment.id,
      levelDefinitionId: direct.level.id,
      sourceType: "assessment_pass",
      sourceId: "assessment-attempt:999999999",
      actorId: direct.user.id,
    });
    assert.deepEqual(result, { kind: "corrupt", code: "COMPLETION_STATE_CORRUPT" });
  });

  const finalExam = await fixture({ levelType: "final_exam", finalLevel: true, xpReward: 91 });
  const finalStart = await runtime.startOwnAssessmentAttempt(finalExam.user.id, { levelNumber: 1, locale: "en" });
  const finalPass = await runtime.submitOwnAssessmentAttempt(finalExam.user.id, {
    attemptId: finalStart.attempt.attemptId,
    requestId: "runtime:final-exam",
    answers: answers(finalStart, 30),
  });
  await check("final_exam grader completes terminal curriculum", async () => {
    assert.equal(finalPass.completion?.terminal, true);
    assert.equal(finalPass.completion?.xpAwarded, 91);
    const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: finalExam.enrollment.id } });
    assert.equal(enrollment.status, "completed");
    assert.equal(enrollment.currentLevel, 2);
  });
  const archived = await fixture({ curriculumStatus: "archived" });
  const archivedStart = await runtime.startOwnAssessmentAttempt(archived.user.id, { levelNumber: 1, locale: "en" });
  await check("archived curriculum pin remains usable and exact", () => {
    assert.equal(archivedStart.level.stableCode, archived.level.stableCode);
  });

  const concurrentStartFixture = await fixture();
  const starts = await Promise.all([
    runtime.startOwnAssessmentAttempt(concurrentStartFixture.user.id, { levelNumber: 1, locale: "en" }),
    runtime.startOwnAssessmentAttempt(concurrentStartFixture.user.id, { levelNumber: 1, locale: "en" }),
  ]);
  await check("concurrent start creates one active attempt", async () => {
    assert.equal(new Set(starts.map((result) => result.attempt.attemptId)).size, 1);
    assert.equal(starts.filter((result) => result.created).length, 1);
    assert.equal(await prisma.assessmentAttempt.count({ where: { enrollmentId: concurrentStartFixture.enrollment.id, status: "in_progress" } }), 1);
  });

  const concurrentSubmitFixture = await fixture();
  const concurrentAttempt = await runtime.startOwnAssessmentAttempt(concurrentSubmitFixture.user.id, { levelNumber: 1, locale: "en" });
  const identical = await Promise.all([
    runtime.submitOwnAssessmentAttempt(concurrentSubmitFixture.user.id, {
      attemptId: concurrentAttempt.attempt.attemptId,
      requestId: "runtime:concurrent-same",
      answers: answers(concurrentAttempt, 5),
    }),
    runtime.submitOwnAssessmentAttempt(concurrentSubmitFixture.user.id, {
      attemptId: concurrentAttempt.attempt.attemptId,
      requestId: "runtime:concurrent-same",
      answers: answers(concurrentAttempt, 5),
    }),
  ]);
  await check("concurrent identical submit has one transition and durable recovery", async () => {
    assert.equal(identical.filter((result) => result.created).length, 1);
    assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: concurrentSubmitFixture.enrollment.id } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { userId: concurrentSubmitFixture.user.id, action: "CURRICULUM_ASSESSMENT_ATTEMPT_GRADED" } }), 1);
  });

  async function withTrigger(name: string, sql: string, fn: () => Promise<void>) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name}`);
    await prisma.$executeRawUnsafe(sql);
    try {
      await fn();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name}`);
    }
  }

  const rollback = await fixture();
  const rollbackStart = await runtime.startOwnAssessmentAttempt(rollback.user.id, { levelNumber: 1, locale: "en" });
  await check("grading audit failure rolls back attempt, completion and XP", () =>
    withTrigger(
      "fail_assessment_grade_audit",
      `CREATE TRIGGER fail_assessment_grade_audit BEFORE INSERT ON "AuditLog" WHEN NEW."action"='CURRICULUM_ASSESSMENT_ATTEMPT_GRADED' BEGIN SELECT RAISE(ABORT, 'grade-audit-failure'); END`,
      async () => {
        await expectError(
          () => runtime.submitOwnAssessmentAttempt(rollback.user.id, {
            attemptId: rollbackStart.attempt.attemptId,
            requestId: "runtime:rollback-grade",
            answers: answers(rollbackStart, 5),
          }),
          "ASSESSMENT_INTERNAL_ERROR",
        );
        assert.equal((await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: rollbackStart.attempt.attemptId } })).status, "in_progress");
        assert.equal((await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: rollback.progress!.id } })).status, "in_progress");
        assert.equal(await prisma.xPTransaction.count({ where: { enrollmentId: rollback.enrollment.id } }), 0);
      },
    ));

  const noSideEffects = await fixture();
  const sideStart = await runtime.startOwnAssessmentAttempt(noSideEffects.user.id, { levelNumber: 1, locale: "en" });
  const beforeLegacy = {
    xp: await prisma.xpEvent.count(),
    progress: await prisma.userTaskProgress.count(),
    notifications: await prisma.notification.count(),
    crm: await prisma.crmUserCohort.count(),
  };
  await runtime.submitOwnAssessmentAttempt(noSideEffects.user.id, {
    attemptId: sideStart.attempt.attemptId,
    requestId: "runtime:no-side-effects",
    answers: answers(sideStart, 5),
  });
  await check("runtime creates no V1, notification or CRM side effects", async () => {
    assert.deepEqual({
      xp: await prisma.xpEvent.count(),
      progress: await prisma.userTaskProgress.count(),
      notifications: await prisma.notification.count(),
      crm: await prisma.crmUserCohort.count(),
    }, beforeLegacy);
  });
  await check("no assessment HTTP or generic completion route was added", () => {
    for (const candidate of [
      "src/app/api/curriculum/v2/assessment/route.ts",
      "src/app/api/curriculum/v2/assessments/route.ts",
      "src/app/api/curriculum/v2/complete/route.ts",
    ]) assert.equal(fs.existsSync(candidate), false, candidate);
  });

  await prisma.$disconnect();
}

main()
  .then(() => {
    console.log(`\ncurriculum assessment runtime regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    console.log(`\ncurriculum assessment runtime regression: ${passed} passed, ${failed + 1} failed`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    for (const flag of flags) {
      const value = previousFlags[flag];
      if (value === undefined) delete process.env[flag];
      else process.env[flag] = value;
    }
    cleanup();
  });
