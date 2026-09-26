import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LessonProgressErrorCode } from "../../src/lib/curriculum/content-read-progress";

const dbPath = path.join(os.tmpdir(), `ata-content-read-progress-${process.pid}.db`);
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
    console.error(error instanceof Error ? error.stack ?? error.message : error);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

function body(marker: string) {
  return {
    sections: [
      { code: `intro-${marker}`, title: `Intro ${marker}`, body: `Body ${marker}` },
      { code: `risk-${marker}`, title: `Risk ${marker}`, body: `Risk body ${marker}` },
    ],
    examples: [{ title: `Example ${marker}`, body: `Example body ${marker}` }],
    commonMistakes: [{ mistake: `Mistake ${marker}`, correction: `Correction ${marker}` }],
    glossary: [{ term: `Term ${marker}`, definition: `Definition ${marker}` }],
    nextAction: { label: `Action ${marker}`, body: `Action body ${marker}` },
    riskDisclaimer: `Disclaimer ${marker}`,
  };
}

async function main() {
  cleanupDb();
  const runner = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (runner.status !== 0) throw new Error(`${runner.stdout}\n${runner.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
  delete process.env.CURRICULUM_V2_XP_ENABLED;

  const { prisma } = await import("../../src/lib/prisma");
  const domain = await import("../../src/lib/curriculum/content-read-progress");

  async function expectError(fn: () => Promise<unknown>, code: LessonProgressErrorCode) {
    try {
      await fn();
    } catch (error) {
      if (domain.isLessonProgressDomainError(error, code)) return error;
      throw new Error(`expected ${code}, got ${String(error)}`);
    }
    throw new Error(`expected ${code}, operation succeeded`);
  }

  const user = await prisma.user.create({ data: { email: "phase4b4-user@example.com", name: "Phase 4B.4 User" } });
  const candidate = await prisma.user.create({ data: { email: "phase4b4-candidate@example.com", name: "Candidate" } });
  const curriculum = await prisma.curriculumVersion.create({
    data: { code: "ata-v2", name: "ATA V2", versionNumber: 1, status: "published", publishedAt: new Date("2026-01-01T00:00:00.000Z") },
  });
  const moduleDefinition = await prisma.moduleDefinition.create({
    data: { curriculumVersionId: curriculum.id, moduleNumber: 1, code: "phase4b4", title: "Phase 4B.4", firstLevel: 1, lastLevel: 3 },
  });
  const lesson = await prisma.levelDefinition.create({
    data: { curriculumVersionId: curriculum.id, moduleId: moduleDefinition.id, levelNumber: 1, stableCode: "v2.l001.pinned-lesson", type: "lesson", title: "Pinned lesson", shortDescription: "Safe", learningObjective: "Learn", completionMethod: "lesson" },
  });
  const report = await prisma.levelDefinition.create({
    data: { curriculumVersionId: curriculum.id, moduleId: moduleDefinition.id, levelNumber: 2, stableCode: "v2.l002.pinned-report", type: "report", title: "Report", completionMethod: "review", requiredPreviousLevel: 1 },
  });
  const practice = await prisma.levelDefinition.create({
    data: { curriculumVersionId: curriculum.id, moduleId: moduleDefinition.id, levelNumber: 3, stableCode: "v2.l003.unsupported", type: "practice", title: "Practice", completionMethod: "practice", requiredPreviousLevel: 2 },
  });
  const content = await prisma.contentVersion.create({
    data: { levelDefinitionId: lesson.id, curriculumVersionId: curriculum.id, versionNumber: 1, status: "published", publishedAt: new Date("2026-01-02T00:00:00.000Z"), videoDurationSeconds: 120 },
  });
  await prisma.contentVersion.create({
    data: { levelDefinitionId: lesson.id, curriculumVersionId: curriculum.id, versionNumber: 2, status: "draft" },
  });
  await prisma.contentLocalization.createMany({ data: [
    { contentVersionId: content.id, locale: "ru", title: "Урок", subtitle: "", learningObjectiveExtension: "", summary: "Кратко", transcript: null, body: body("ru") },
    { contentVersionId: content.id, locale: "en", title: "Lesson", subtitle: "", learningObjectiveExtension: "", summary: "Summary", transcript: null, body: body("en") },
  ] });
  await prisma.contentAsset.createMany({ data: [
    { contentVersionId: content.id, kind: "video", assetCode: "video-main", locale: null, url: "https://cdn.example.com/main.mp4", mimeType: "video/mp4", durationSeconds: 120, sortOrder: 0 },
    { contentVersionId: content.id, kind: "subtitles", assetCode: "subs-ru", locale: "ru", url: "https://cdn.example.com/ru.vtt", mimeType: "text/vtt", sortOrder: 1 },
    { contentVersionId: content.id, kind: "subtitles", assetCode: "subs-en", locale: "en", url: "https://cdn.example.com/en.vtt", mimeType: "text/vtt", sortOrder: 2 },
  ] });
  await prisma.levelResourceBinding.create({ data: { levelDefinitionId: lesson.id, curriculumVersionId: curriculum.id, contentVersionId: content.id } });
  const enrollment = await prisma.userCurriculumEnrollment.create({
    data: { userId: user.id, curriculumVersionId: curriculum.id, curriculumCode: "ata-v2", status: "active", currentLevel: 1, highestCompletedLevel: 0 },
  });
  const durable = await prisma.userLevelProgress.create({
    data: { enrollmentId: enrollment.id, curriculumVersionId: curriculum.id, levelDefinitionId: lesson.id, status: "in_progress", startedAt: new Date("2026-01-03T00:00:00.000Z") },
  });

  const mutationBaseline = async () => ({
    xp: await prisma.xPTransaction.count(), attempts: await prisma.assessmentAttempt.count(), audits: await prisma.auditLog.count(),
    notifications: await prisma.notification.count(), levelProgress: await prisma.userLevelProgress.count(), enrollments: await prisma.userCurriculumEnrollment.count(),
  });

  try {
    await check("1. all three feature gates are required dynamically", async () => {
      for (const key of ["CURRICULUM_V2_READ_ENABLED", "CURRICULUM_V2_ENROLLMENT_ENABLED", "CURRICULUM_V2_CONTENT_ENABLED"] as const) {
        const previous = process.env[key];
        delete process.env[key];
        assert.deepEqual(await domain.resolveUserLevelContent({ actorUserId: user.id, levelNumber: 1, locale: "ru" }), { kind: "disabled" });
        await expectError(
          () => domain.saveOwnLessonProgress({}),
          key === "CURRICULUM_V2_READ_ENABLED" ? "CONTENT_READ_DISABLED" : "LESSON_PROGRESS_DISABLED",
        );
        process.env[key] = previous;
      }
    });

    await check("2. exact pinned content and exact locale are returned through a safe mapper", async () => {
      const result = await domain.resolveUserLevelContent({ actorUserId: user.id, stableCode: lesson.stableCode, locale: "ru" });
      assert.equal(result.kind, "available");
      if (result.kind !== "available") return;
      assert.equal(result.content.versionNumber, 1);
      assert.equal(result.content.localization.locale, "ru");
      assert.deepEqual(result.content.assets.map((asset) => asset.assetCode), ["video-main", "subs-ru"]);
      assert.doesNotMatch(JSON.stringify(result), /(^|\")(id|correctAnswer|xpReward|fingerprint)(\"|:)/i);
    });

    await check("3. locale has no fallback or implicit normalization", async () => {
      assert.deepEqual(await domain.resolveUserLevelContent({ actorUserId: user.id, levelNumber: 1, locale: "de" }), { kind: "unavailable", reason: "localization_unavailable" });
      assert.deepEqual(await domain.resolveUserLevelContent({ actorUserId: user.id, levelNumber: 1, locale: "RU" }), { kind: "unavailable", reason: "level_not_accessible" });
    });

    await check("4. missing users, candidates, locked levels and unsupported levels fail closed", async () => {
      assert.deepEqual(await domain.resolveUserLevelContent({ actorUserId: 2_000_000_000, levelNumber: 1, locale: "ru" }), { kind: "user_not_found" });
      assert.deepEqual(await domain.resolveUserLevelContent({ actorUserId: candidate.id, levelNumber: 1, locale: "ru" }), { kind: "not_enrolled" });
      assert.deepEqual(await domain.resolveUserLevelContent({ actorUserId: user.id, levelNumber: report.levelNumber, locale: "ru" }), { kind: "locked", reason: "level_not_accessible" });
      assert.deepEqual(await domain.resolveUserLevelContent({ actorUserId: user.id, levelNumber: practice.levelNumber, locale: "ru" }), { kind: "unavailable", reason: "unsupported_level_type" });
    });

    await check("5. resolver is read-only and an archived curriculum pin remains valid", async () => {
      const before = await mutationBaseline();
      await prisma.curriculumVersion.update({ where: { id: curriculum.id }, data: { status: "archived" } });
      const result = await domain.resolveUserLevelContent({ actorUserId: user.id, levelNumber: 1, locale: "ru" });
      assert.equal(result.kind, "available");
      assert.deepEqual(await mutationBaseline(), before);
    });

    const save1 = {
      actorUserId: user.id, levelNumber: 1, requestId: "autosave-request-0001", expectedRevision: 0,
      playbackPositionSeconds: 10, completedSections: ["intro-ru"], progressData: { activeSectionCode: "risk-ru" },
    };

    await check("6. first autosave atomically creates revision one and its receipt", async () => {
      const before = await mutationBaseline();
      const result = await domain.saveOwnLessonProgress(save1);
      assert.equal(result.created, true);
      assert.equal(result.retry, false);
      assert.equal(result.acceptedRevision, 1);
      assert.equal(await prisma.userLessonProgressSaveReceipt.count(), 1);
      assert.deepEqual(await mutationBaseline(), before);
    });

    await check("7. exact request retry returns its accepted revision without touching timestamps", async () => {
      const before = await prisma.userLessonProgress.findFirstOrThrow();
      const result = await domain.saveOwnLessonProgress(save1);
      const after = await prisma.userLessonProgress.findFirstOrThrow();
      assert.equal(result.retry, true);
      assert.equal(result.acceptedRevision, 1);
      assert.equal(after.updatedAt.toISOString(), before.updatedAt.toISOString());
      assert.equal(after.lastProgressAt.toISOString(), before.lastProgressAt.toISOString());
    });

    await check("8. same requestId with different payload is an idempotency conflict", async () => {
      await expectError(() => domain.saveOwnLessonProgress({ ...save1, playbackPositionSeconds: 11 }), "IDEMPOTENCY_CONFLICT");
    });

    const save2 = { ...save1, requestId: "autosave-request-0002", expectedRevision: 1, playbackPositionSeconds: 22, completedSections: ["risk-ru", "intro-ru"] };
    await check("9. existing progress uses CAS, normalizes sections and increments exactly once", async () => {
      const result = await domain.saveOwnLessonProgress(save2);
      assert.equal(result.acceptedRevision, 2);
      assert.deepEqual(result.progress.completedSections, ["intro-ru", "risk-ru"]);
      assert.equal(await prisma.userLessonProgressSaveReceipt.count(), 2);
    });

    await check("10. stale, revision gap, monotonicity and no-change inputs do not mutate", async () => {
      const before = await prisma.userLessonProgress.findFirstOrThrow();
      await expectError(() => domain.saveOwnLessonProgress({ ...save2, requestId: "autosave-request-0003", expectedRevision: 1, playbackPositionSeconds: 23 }), "STALE");
      await expectError(() => domain.saveOwnLessonProgress({ ...save2, requestId: "autosave-request-0004", expectedRevision: 3, playbackPositionSeconds: 24 }), "STALE");
      await expectError(() => domain.saveOwnLessonProgress({ ...save2, requestId: "autosave-request-0005", expectedRevision: 2, completedSections: ["intro-ru"] }), "CONFLICT");
      await expectError(() => domain.saveOwnLessonProgress({ ...save2, requestId: "autosave-request-0006", expectedRevision: 2 }), "CONFLICT");
      const after = await prisma.userLessonProgress.findFirstOrThrow();
      assert.equal(after.revision, before.revision);
      assert.equal(after.updatedAt.toISOString(), before.updatedAt.toISOString());
      assert.equal(await prisma.userLessonProgressSaveReceipt.count(), 2);
    });

    await check("11. payload validation rejects unsafe IDs, selectors, timestamps and unknown sections", async () => {
      await expectError(() => domain.saveOwnLessonProgress({ ...save2, requestId: "short" }), "INPUT_INVALID");
      await expectError(() => domain.saveOwnLessonProgress({ ...save2, stableCode: lesson.stableCode }), "INPUT_INVALID");
      await expectError(() => domain.saveOwnLessonProgress({ ...save2, expectedRevision: -1 }), "INPUT_INVALID");
      await expectError(() => domain.saveOwnLessonProgress({ ...save2, requestId: "autosave-request-0007", expectedRevision: 2, completedSections: ["unknown"] }), "INPUT_INVALID");
    });

    await check("12. playback clamps to the pinned duration while completedAt stays untouched", async () => {
      const result = await domain.saveOwnLessonProgress({ ...save2, requestId: "autosave-request-0008", expectedRevision: 2, playbackPositionSeconds: 999 });
      assert.equal(result.acceptedRevision, 3);
      assert.equal(result.progress.playbackPositionSeconds, 120);
      assert.equal(result.progress.completedAt, null);
    });

    await check("13. identical concurrent submissions apply once and recover through the durable receipt", async () => {
      const concurrent = { ...save2, requestId: "autosave-request-0009", expectedRevision: 3, playbackPositionSeconds: 45 };
      const results = await Promise.all([domain.saveOwnLessonProgress(concurrent), domain.saveOwnLessonProgress(concurrent)]);
      assert.deepEqual(results.map((item) => item.acceptedRevision), [4, 4]);
      assert.equal(results.filter((item) => item.retry).length, 1);
      assert.equal((await prisma.userLessonProgress.findFirstOrThrow()).revision, 4);
    });

    await check("14. competing same-revision submissions have one winner and one stale loser", async () => {
      const inputs = [46, 47].map((position, index) => domain.saveOwnLessonProgress({
        ...save2, requestId: `autosave-race-000${index}`, expectedRevision: 4, playbackPositionSeconds: position,
      }));
      const results = await Promise.allSettled(inputs);
      assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
      const rejected = results.find((item): item is PromiseRejectedResult => item.status === "rejected");
      assert(rejected && domain.isLessonProgressDomainError(rejected.reason, "STALE"));
    });

    await check("15. an old exact retry returns its original receipt and the current snapshot", async () => {
      const result = await domain.saveOwnLessonProgress(save1);
      assert.equal(result.retry, true);
      assert.equal(result.acceptedRevision, 1);
      assert.equal(result.progress.revision, 5);
      assert.equal(result.appliedAt, (await prisma.userLessonProgressSaveReceipt.findUniqueOrThrow({ where: { userId_requestId: { userId: user.id, requestId: save1.requestId } } })).appliedAt.toISOString());
    });

    await check("16. completed durable level blocks new saves but permits old exact receipt retries", async () => {
      await prisma.userLevelProgress.update({ where: { id: durable.id }, data: { status: "completed", completedAt: new Date(), completionMethod: "lesson" } });
      await prisma.userCurriculumEnrollment.update({ where: { id: enrollment.id }, data: { currentLevel: 2, highestCompletedLevel: 1 } });
      const read = await domain.resolveUserLevelContent({ actorUserId: user.id, levelNumber: 1, locale: "ru" });
      assert.equal(read.kind, "completed");
      await expectError(() => domain.saveOwnLessonProgress({ ...save2, requestId: "autosave-request-0010", expectedRevision: 5, playbackPositionSeconds: 48 }), "IMMUTABLE");
      assert.equal((await domain.saveOwnLessonProgress(save1)).acceptedRevision, 1);
    });

    await check("17. ordinary lesson pending_review is not readable", async () => {
      await prisma.userLevelProgress.update({ where: { id: durable.id }, data: { status: "pending_review", completedAt: null, completionMethod: null } });
      await prisma.userCurriculumEnrollment.update({ where: { id: enrollment.id }, data: { currentLevel: 1, highestCompletedLevel: 0 } });
      assert.deepEqual(await domain.resolveUserLevelContent({ actorUserId: user.id, levelNumber: 1, locale: "ru" }), { kind: "unavailable", reason: "level_not_accessible" });
    });

    await check("18. only lesson progress and receipts changed; V1, XP, attempts, audit and notifications stayed untouched", async () => {
      assert.equal(await prisma.xPTransaction.count(), 0);
      assert.equal(await prisma.assessmentAttempt.count(), 0);
      assert.equal(await prisma.auditLog.count(), 0);
      assert.equal(await prisma.notification.count(), 0);
      assert.equal(await prisma.userTaskProgress.count(), 0);
      assert.equal((await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } })).lastMeaningfulActionAt, null);
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  cleanupDb();
  console.error(error);
  process.exitCode = 1;
});
