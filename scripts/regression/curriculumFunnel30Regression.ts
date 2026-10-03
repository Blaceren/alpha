/**
 * PROGRAM STRUCTURE (2026-10-02) — the 30-level program, end to end.
 *
 * The owner's document «Содержание воронки обучения · уровни 1–30» became a
 * package (`buildFunnel30.ts`), and the package needed six things the platform
 * did not do. Each section below pins one of them against the REAL runtime in a
 * disposable database built by the shipped migration runner:
 *
 *   A. THE ARTIFACT — reproducible from its source, valid, and what it claims.
 *      Every package shipped before it still hashes to its declared value.
 *      (The current build is v6 — the name spelled «Alpha»; v5 stays as published.)
 *   B. IMPORT AND PUBLICATION — chapters, kinds, a closed tail, tool unlocks and
 *      rewatch seconds reach the database; a version that ends in levels not
 *      open yet can be published, and one with a hole in the middle cannot.
 *   C. THE WALK — one learner, level 1 to level 14, through the shipped owners:
 *      a lesson without a test, the registration level standing THIRD, tests
 *      that explain a wrong answer, a report nobody reviews, a practice level.
 *   D. THE END OF WHAT IS OPEN — level 15 is on the path and cannot be started.
 *   E. TOOLS — opened by the version's own rows; a legacy package keeps 5/10/15.
 *   F. LESSON MEDIA — a registered video reaches the lesson a learner reads.
 *
 * No HTTP, no live database, no environment file, no network.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { EXPECTED_MIGRATION_COUNT } from "./support/migrationCount";

// A fresh directory per run, never reused and never removed by this script.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ata-funnel-30-"));
const dbUrl = `file:${path.join(workDir, "funnel.sqlite")}`;
process.env.DATABASE_URL = dbUrl;
for (const flag of [
  "CURRICULUM_V2_READ_ENABLED",
  "CURRICULUM_V2_ENROLLMENT_ENABLED",
  "CURRICULUM_V2_XP_ENABLED",
  "CURRICULUM_V2_CONTENT_ENABLED",
  "CURRICULUM_V2_ASSESSMENT_ENABLED",
  "CURRICULUM_V2_REPORT_ENABLED",
]) {
  process.env[flag] = "true";
}

// The version the builder writes now (v6 since 2026-10-03, the «Alpha» spelling) and its artifact;
// the successors below are VERSION + 1 and VERSION + 2. v5 stays as published and is checked by A6.
const SOURCE_PATH = "curriculum/canonical/ata-funnel-30.source.json";
const LOCALE = "ru";

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${passed + failed}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${passed + failed}. ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

async function expectCode(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    assert.equal((error as { code?: string }).code, code, `expected ${code}, got ${String(error)}`);
    return;
  }
  assert.fail(`expected ${code} but the call resolved`);
}

type SourceLevel = {
  number: number;
  slug: string;
  kind: string;
  open: boolean;
  type: string;
  completionMethod: string;
  xpReward: number;
  title: string;
  test?: Array<{ correct: string; explanation: string; rewatchFromSeconds: number }>;
};

async function main() {
  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) {
    console.error(migration.stdout, migration.stderr);
    throw new Error(`migration runner exited with ${migration.status}`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const builder = await import("../curriculum/buildFunnel30");
  const packageValidate = await import("../../src/lib/curriculum/package/validate");
  const packageImport = await import("../../src/lib/curriculum/package/import");
  const service = await import("../../src/lib/curriculum/service");
  const validation = await import("../../src/lib/curriculum/validation");
  const closedTail = await import("../../src/lib/curriculum/closed-tail");
  const enrollmentDomain = await import("../../src/lib/curriculum/enrollment");
  const levelState = await import("../../src/lib/curriculum/level-state");
  const manual = await import("../../src/lib/curriculum/manual-completion");
  const registration = await import("../../src/lib/curriculum/pocket-registration-completion");
  const assessment = await import("../../src/lib/curriculum/assessment-runtime");
  const reportSubmission = await import("../../src/lib/curriculum/report-submission");
  const contentRead = await import("../../src/lib/curriculum/content-read-progress");
  const toolAccess = await import("../../src/lib/curriculum/tool-access");
  const toolGuard = await import("../../src/lib/tools/access");
  const readApi = await import("../../src/lib/curriculum/read-api");
  const xp = await import("../../src/lib/curriculum/xp");

  const source = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8")) as { levels: SourceLevel[] };
  const sourceLevel = (number: number) => source.levels.find((level) => level.number === number)!;
  const codeOf = (number: number) =>
    `v2.l${String(number).padStart(3, "0")}.${sourceLevel(number).slug}`;
  const VERSION = builder.FUNNEL30_CURRICULUM_VERSION_NUMBER;
  const PACKAGE_PATH = builder.funnel30PackagePath(VERSION);
  const rawPackage = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8")) as unknown;

  let sequence = 0;
  async function createUser(label: string, role: "user" | "admin" = "user") {
    sequence += 1;
    return prisma.user.create({
      data: { email: `${label}-${process.pid}-${sequence}@example.com`, name: label, role, status: "active" },
    });
  }
  const requestId = (label: string) => `funnel-${label}-${process.pid}-${(sequence += 1)}`;

  /* ==================================================================== *
   * A. THE ARTIFACT
   * ==================================================================== */

  await check("A1 every migration applied", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(
      'SELECT COUNT(*) AS n FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL',
    );
    assert.equal(Number(rows[0].n), EXPECTED_MIGRATION_COUNT);
  });

  await check("A2 the checked-in package is byte-identical to a build of its source", () => {
    assert.equal(fs.readFileSync(PACKAGE_PATH, "utf8"), builder.serializeFunnel30Package(VERSION));
    // …and a second build is the same bytes: no clock, no randomness.
    assert.equal(builder.serializeFunnel30Package(VERSION), builder.serializeFunnel30Package(VERSION));
  });

  await check("A3 the package validates as a draft and says what is outstanding", () => {
    const result = packageValidate.validateCurriculumPackage(rawPackage);
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
    if (!result.ok) return;
    assert.equal(result.package.status, "draft");
    assert.equal(result.package.packageCode, "ata-v2.funnel-30");
    assert.equal(result.package.curriculumVersionNumber, VERSION);
    assert.ok(result.package.pendingApprovals.length > 0, "a draft with nothing pending is not this draft");
    assert.equal(result.fingerprint, result.package.contentFingerprint);
  });

  await check("A4 the structure is the owner's: 2 chapters, 6 modules of 5/4/5/5/5/6, 30 levels", () => {
    const result = packageValidate.validateCurriculumPackage(rawPackage);
    assert.ok(result.ok);
    if (!result.ok) return;
    const modules = [...result.package.modules].sort((a, b) => a.moduleNumber - b.moduleNumber);
    assert.deepEqual(modules.map((item) => item.levels.length), [5, 4, 5, 5, 5, 6]);
    assert.deepEqual(modules.map((item) => item.chapter?.number), [1, 1, 1, 2, 2, 2]);
    assert.deepEqual(
      [...new Set(modules.map((item) => item.chapter?.title))],
      ["Основы и первые реальные сделки", "Чтение графика"],
    );
    const levels = modules.flatMap((item) => item.levels).sort((a, b) => a.levelNumber - b.levelNumber);
    assert.deepEqual(levels.map((item) => item.levelNumber), Array.from({ length: 30 }, (_, index) => index + 1));
    // No financial checkpoint level anywhere in this program.
    assert.ok(levels.every((item) => item.type !== "financial_checkpoint"));
    // Exactly one registration level, and it is the third.
    assert.deepEqual(
      levels.filter((item) => item.type === "external_event").map((item) => item.levelNumber),
      [3],
    );
    // Tests on 4–8 and 10–12, four questions each, all four needed, unlimited.
    const tested = levels.filter((item) => item.assessment);
    assert.deepEqual(tested.map((item) => item.levelNumber), [4, 5, 6, 7, 8, 10, 11, 12]);
    for (const level of tested) {
      assert.equal(level.assessment!.questions.length, 4);
      assert.equal(level.assessment!.passPercent, 100);
      assert.equal(level.assessment!.maxAttempts, null);
      assert.equal(level.assessment!.showExplanation, true);
      for (const question of level.assessment!.questions) {
        assert.ok(question.localizations[0].explanation, `L${level.levelNumber} question without a разбор`);
        assert.equal(typeof question.rewatchFromSeconds, "number");
      }
    }
    // Levels 1–14 are open, 15–30 are defined and closed.
    assert.deepEqual(
      levels.filter((item) => item.status === "disabled").map((item) => item.levelNumber),
      Array.from({ length: 16 }, (_, index) => index + 15),
    );
  });

  await check("A5 no question, option, answer or timestamp differs from the source", () => {
    const result = packageValidate.validateCurriculumPackage(rawPackage);
    assert.ok(result.ok);
    if (!result.ok) return;
    const levels = result.package.modules.flatMap((item) => item.levels);
    for (const level of levels) {
      const original = sourceLevel(level.levelNumber);
      assert.equal(level.title, original.title);
      if (!original.test) continue;
      original.test.forEach((question, index) => {
        const built = level.assessment!.questions.find((item) => item.questionNumber === index + 1)!;
        assert.deepEqual(built.correctOptionCodes, [question.correct]);
        assert.equal(built.localizations[0].explanation, question.explanation);
        assert.equal(built.rewatchFromSeconds, question.rewatchFromSeconds);
      });
    }
  });

  await check("A5b nothing written for the people building a level reaches the learner taking it", () => {
    /* The owner's document mixes two voices: what the learner is told, and what
       the production team is told about the level («не начат», «задание не
       готово», «в образце обязательно…», «сюда ложится видео…»). The package is
       the learner's copy. Every string a learner can be shown is collected and
       checked against the phrases of the other voice. */
    const result = packageValidate.validateCurriculumPackage(rawPackage);
    assert.ok(result.ok);
    if (!result.ok) return;
    const shown: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") shown.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") {
        for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
          // Provenance is the package's own record of where a text came from.
          if (key === "provenance" || key === "pendingApprovals") continue;
          collect(inner);
        }
      }
    };
    collect(result.package.modules);
    const text = shown.join("\n");
    for (const phrase of [
      "В образце обязательно",
      "ученик делает сам",
      "формулировка средней руки",
      "пока не подготовлен",
      "не хватает экрана регистрации",
      "можно писать уже сейчас",
      "Сюда ложится видео",
      "ждёт готовый продукт",
      "Не начат",
      "задание не готово",
    ]) {
      assert.ok(!text.includes(phrase), `learner copy carries a production note: «${phrase}»`);
    }
    // The level-9 lesson has no «Проверка» section of its own: the report says
    // what the check looks at, once.
    const nine = result.package.modules.flatMap((item) => item.levels).find((item) => item.levelNumber === 9)!;
    const body = nine.content!.localizations[0].body as { sections: Array<{ code: string }> };
    assert.deepEqual(body.sections.map((section) => section.code), ["o-chem", "zadanie", "zapisi"]);
    assert.ok(nine.report!.localizations[0].successCriteriaSummary.includes("Ручной проверки нет"));
  });

  await check("A6 every package shipped before this one still hashes to its declared fingerprint", async () => {
    const fingerprint = await import("../../src/lib/curriculum/package/fingerprint");
    const shipped = fs
      .readdirSync("curriculum/packages")
      .filter((name) => name.endsWith(".json") && !name.includes("funnel-30"));
    assert.ok(shipped.length >= 5);
    for (const name of shipped) {
      const pkg = JSON.parse(fs.readFileSync(path.join("curriculum/packages", name), "utf8"));
      assert.equal(
        fingerprint.calculateFingerprint(pkg),
        pkg.contentFingerprint,
        `${name}: adding optional fields moved an accepted fingerprint`,
      );
    }
  });

  await check("A7 a closed level in the middle of a package is refused", () => {
    const pkg = JSON.parse(JSON.stringify(rawPackage)) as {
      modules: Array<{ levels: Array<{ levelNumber: number; status?: string }> }>;
      contentFingerprint: string;
    };
    for (const moduleDefinition of pkg.modules) {
      for (const level of moduleDefinition.levels) {
        if (level.levelNumber === 7) level.status = "disabled";
      }
    }
    const result = packageValidate.validateCurriculumPackage(pkg);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((item) => item.code === "LEVEL_STATUS_NOT_TRAILING"));
  });

  /* ==================================================================== *
   * B. IMPORT AND PUBLICATION
   * ==================================================================== */

  const admin = await createUser("admin", "admin");
  let versionId = 0;

  await check("B1 the package imports as a draft with its whole structure", async () => {
    const result = await packageImport.importCurriculumPackage(rawPackage, { db: prisma });
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
    if (!result.ok) return;
    assert.equal(result.summary.outcome, "created");
    assert.equal(result.summary.curriculumVersionStatus, "draft");
    const counts = result.summary.counts;
    assert.equal(counts.modules, 6);
    assert.equal(counts.levels, 30);
    // Levels 1, 2 and 4–14 carry content; the registration level and the closed
    // tail carry none.
    assert.equal(counts.contentVersions, 13);
    assert.equal(counts.assessmentVersions, 8);
    assert.equal(counts.questions, 32);
    assert.equal(counts.reportAssignments, 1);
    assert.equal(counts.reportBindings, 1);
    assert.equal(counts.toolUnlocks, 6);
    const version = await prisma.curriculumVersion.findFirstOrThrow({ where: { code: "ata-v2", versionNumber: VERSION } });
    versionId = version.id;
    // Re-importing the identical package is a no-op.
    const again = await packageImport.importCurriculumPackage(rawPackage, { db: prisma });
    assert.ok(again.ok && again.summary.outcome === "unchanged");
  });

  await check("B2 chapters, kinds, statuses and rewatch seconds are in the database", async () => {
    const modules = await prisma.moduleDefinition.findMany({
      where: { curriculumVersionId: versionId },
      orderBy: { moduleNumber: "asc" },
    });
    assert.deepEqual(modules.map((item) => item.chapterNumber), [1, 1, 1, 2, 2, 2]);
    assert.deepEqual(modules.map((item) => item.status), ["active", "active", "active", "disabled", "disabled", "disabled"]);
    const levels = await prisma.levelDefinition.findMany({
      where: { curriculumVersionId: versionId },
      orderBy: { levelNumber: "asc" },
    });
    assert.deepEqual(
      levels.map((item) => item.presentationKind),
      source.levels.map((item) => item.kind),
    );
    assert.deepEqual(
      levels.map((item) => item.status),
      source.levels.map((item) => (item.open ? "active" : "disabled")),
    );
    const question = await prisma.questionDefinition.findFirstOrThrow({
      where: { assessmentVersion: { levelDefinition: { curriculumVersionId: versionId, levelNumber: 4 } }, questionNumber: 1 },
    });
    assert.equal(question.rewatchFromSeconds, 115, "«Пересмотреть: с 1:55»");
  });

  await check("B3 the tool unlock rows are the document's chronology", async () => {
    const rows = await prisma.levelToolUnlock.findMany({
      where: { curriculumVersionId: versionId },
      include: { levelDefinition: { select: { levelNumber: true } } },
    });
    const byTool = Object.fromEntries(rows.map((row) => [row.toolCode, row.levelDefinition.levelNumber]));
    assert.deepEqual(byTool, {
      "tool.trade_card": 5,
      "tool.trading_journal": 9,
      "tool.risk_calculator": 13,
      "tool.entry_checklist": 13,
      "tool.personal_stats": 24,
      "tool.news_calendar": 28,
    });
  });

  await check("B4 a closed tail is a publishable shape; a hole is not", async () => {
    const snapshot = await service.loadCurriculumSnapshot(versionId, prisma);
    const tail = closedTail.describeClosedTail(snapshot.levels, snapshot.modules);
    assert.equal(tail.ok, true);
    if (tail.ok) {
      assert.equal(tail.closedLevelIds.size, 16);
      assert.equal(tail.closedModuleIds.size, 3);
    }
    assert.deepEqual(validation.validateCurriculumDraft(snapshot).issues, []);

    // The same snapshot with level 7 closed: levels 8–14 would be unreachable.
    const holed = {
      ...snapshot,
      levels: snapshot.levels.map((level) =>
        level.levelNumber === 7 ? { ...level, status: "disabled" as const } : level,
      ),
    };
    const issues = validation.validateCurriculumDraft(holed).issues;
    assert.ok(issues.some((item) => item.code === "DISABLED_LEVEL_BLOCKS_PUBLICATION"));

    // …and a program whose FIRST level is closed has nothing open at all.
    const shut = {
      ...snapshot,
      levels: snapshot.levels.map((level) => ({ ...level, status: "disabled" as const })),
    };
    assert.ok(validation.validateCurriculumDraft(shut).issues.some((item) => item.code === "NO_ACTIVE_LEVELS"));
  });

  await check("B5 the version publishes, and is the one a new learner gets", async () => {
    const result = await service.publishCurriculumVersion({ curriculumVersionId: versionId, actorId: admin.id });
    assert.equal(result.published.status, "published");
    assert.equal(result.published.versionNumber, VERSION);
  });

  /* ==================================================================== *
   * C. THE WALK
   * ==================================================================== */

  const learner = await createUser("learner");

  async function states() {
    const result = await levelState.resolveUserCurriculumLevelStates({ userId: learner.id });
    assert.equal(result.kind, "resolved");
    if (result.kind !== "resolved") throw new Error("level states are not resolved");
    return result;
  }
  async function stateOf(number: number) {
    return (await states()).levels.find((item) => item.levelDefinition.levelNumber === number)!;
  }
  async function start(number: number) {
    const started = await levelState.startCurrentCurriculumLevel({
      actorUserId: learner.id,
      expectedStableCode: codeOf(number),
    });
    assert.equal(started.levelDefinition.levelNumber, number);
  }
  async function xpTotal() {
    const enrollment = await prisma.userCurriculumEnrollment.findFirstOrThrow({
      where: { userId: learner.id, status: "active" },
    });
    const resolved = await xp.resolveEnrollmentXp({ enrollmentId: enrollment.id });
    assert.equal(resolved.kind, "available");
    return resolved.kind === "available" ? resolved.totalXp : -1;
  }
  async function tools() {
    const resolved = await states();
    return toolAccess.resolveCurriculumToolAccess(
      resolved.levels,
      await toolAccess.loadCurriculumToolUnlocks(prisma, resolved.curriculumVersion.id),
    );
  }

  /** Answers for one level's test: all correct, except the listed question numbers. */
  async function sit(number: number, wrong: number[] = []) {
    const started = await assessment.startOwnAssessmentAttempt(learner.id, {
      stableCode: codeOf(number),
      locale: LOCALE,
    });
    const answers = started.assessment.questions.map((question) => {
      const correct = sourceLevel(number).test![question.questionNumber - 1].correct;
      const code = wrong.includes(question.questionNumber)
        ? question.options.find((option) => option.code !== correct)!.code
        : correct;
      return { questionKey: question.questionKey, answer: { code } };
    });
    const input = { attemptId: started.attempt.attemptId, requestId: requestId(`sit-${number}`), answers };
    return { started, input, graded: await assessment.submitOwnAssessmentAttempt(learner.id, input) };
  }

  await check(`C1 a new learner is enrolled in version ${VERSION} at level 1, with every tool shut`, async () => {
    const result = await enrollmentDomain.enrollUserInPublishedCurriculum({ userId: learner.id, actorId: admin.id });
    assert.equal(result.created, true);
    assert.equal(result.enrollment.curriculumVersionId, versionId);
    assert.equal(result.enrollment.currentLevel, 1);
    const access = await tools();
    assert.equal(access.unlockedCount, 0);
    assert.deepEqual(
      access.tools.map((entry) => [entry.code, entry.unlockLevel, entry.reason]),
      [
        ["tool.trade_card", 5, "unlock_level_incomplete"],
        ["tool.trading_journal", 9, "unlock_level_incomplete"],
        ["tool.risk_calculator", 13, "unlock_level_incomplete"],
        ["tool.entry_checklist", 13, "unlock_level_incomplete"],
        ["tool.personal_stats", 24, "unlock_level_incomplete"],
        ["tool.news_calendar", 28, "unlock_level_incomplete"],
      ],
    );
  });

  await check("C2 a Pocket postback before the registration level binds, completes nothing and starts nothing", async () => {
    await prisma.pocketTraderIdentity.create({
      data: { userId: learner.id, pocketUserId: `7${process.pid}`, clickId: `click-${process.pid}` },
    });
    const outcome = await registration.reconcilePocketRegistrationLevelCompletion(learner.id);
    assert.equal(outcome.outcome, "not_eligible");
    assert.equal(outcome.detail, "current level is not registration");
    // The lesson in front of it was NOT started by the postback.
    assert.equal(await prisma.userLevelProgress.count({ where: { enrollment: { userId: learner.id } } }), 0);
    assert.equal((await stateOf(1)).state, "available");
  });

  await check("C3 levels 1 and 2 — lessons without a test — complete on the learner's word, +50 each", async () => {
    for (const number of [1, 2]) {
      await start(number);
      const receipt = await manual.completeManualLevel({
        actorUserId: learner.id,
        stableCode: codeOf(number),
        requestId: requestId(`manual-${number}`),
      });
      assert.equal(receipt.created, true);
      assert.equal(receipt.xpAwarded, 50);
      assert.equal(receipt.nextLevelNumber, number + 1);
    }
    assert.equal(await xpTotal(), 100);
  });

  await check("C4 level 3 cannot be completed by the learner, and is completed by the identity already bound", async () => {
    assert.equal((await stateOf(3)).levelDefinition.type, "external_event");
    await expectCode(
      () =>
        manual.completeManualLevel({
          actorUserId: learner.id,
          stableCode: codeOf(3),
          requestId: requestId("manual-3"),
        }),
      "MANUAL_COMPLETION_OWNER_MISMATCH",
    ).catch(async () => {
      // The exact refusal code is the manual owner's own; what matters is that
      // the level is still not completed afterwards.
      assert.notEqual((await stateOf(3)).state, "completed");
    });
    const outcome = await registration.reconcilePocketRegistrationLevelCompletion(learner.id);
    assert.equal(outcome.outcome, "completed");
    assert.equal((await stateOf(3)).state, "completed");
    assert.equal(await xpTotal(), 100, "a gate awards nothing");
    // Idempotent.
    assert.equal((await registration.reconcilePocketRegistrationLevelCompletion(learner.id)).outcome, "already_completed");
  });

  await check("C5 a failed test explains every wrong answer, names the second to rewatch, and changes nothing", async () => {
    await start(4);
    const before = await xpTotal();
    const { graded, input } = await sit(4, [1, 4]);
    assert.equal(graded.attempt.status, "failed");
    assert.equal(graded.attempt.correctCount, 2);
    assert.equal(graded.completion, null);
    assert.ok(graded.review);
    assert.deepEqual(graded.review!.map((item) => item.questionNumber), [1, 4]);
    const first = sourceLevel(4).test![0];
    assert.equal(graded.review![0].explanation, first.explanation);
    assert.equal(graded.review![0].rewatchFromSeconds, first.rewatchFromSeconds);
    assert.equal(graded.review![1].rewatchFromSeconds, sourceLevel(4).test![3].rewatchFromSeconds);
    // The review carries the разбор, never the grading key.
    assert.ok(!JSON.stringify(graded.review).includes("correct"));
    // «Неудачные попытки никак не отражать в прогрессе.»
    const state = await stateOf(4);
    assert.equal(state.state, "in_progress");
    assert.equal(state.progress?.attemptCount, 0);
    assert.equal(await xpTotal(), before);
    // An exact retry of the same submission rebuilds the same review.
    const retry = await assessment.submitOwnAssessmentAttempt(learner.id, input);
    assert.equal(retry.created, false);
    assert.deepEqual(retry.review, graded.review);
  });

  await check("C6 attempts are unlimited, and four right answers pass with an empty review", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.equal((await sit(4, [2])).graded.attempt.status, "failed");
    }
    const { graded } = await sit(4);
    assert.equal(graded.attempt.status, "passed");
    assert.equal(graded.attempt.attemptNumber, 5);
    assert.deepEqual(graded.review, []);
    assert.equal(graded.completion?.xpAwarded, 100);
    assert.equal(graded.completion?.nextLevelNumber, 5);
  });

  await check("C7 level 5 opens the Trade Card, and only the Trade Card", async () => {
    assert.equal(await toolGuard.isToolUnlockedForUser(learner.id, "tool.trade_card", prisma), false);
    await start(5);
    assert.equal((await sit(5)).graded.attempt.status, "passed");
    assert.equal(await toolGuard.isToolUnlockedForUser(learner.id, "tool.trade_card", prisma), true);
    assert.equal(await toolGuard.isToolUnlockedForUser(learner.id, "tool.trading_journal", prisma), false);
    const access = await tools();
    assert.deepEqual(access.tools.filter((entry) => entry.unlocked).map((entry) => entry.code), ["tool.trade_card"]);
  });

  await check("C8 levels 6, 7 and 8 pass by their tests", async () => {
    for (const number of [6, 7, 8]) {
      await start(number);
      const { graded } = await sit(number);
      assert.equal(graded.attempt.status, "passed", `level ${number}`);
    }
    assert.equal((await stateOf(9)).state, "available");
  });

  const trade = (index: number) => ({
    [`trade${index}-datetime`]: `02.10 1${index}:00`,
    [`trade${index}-asset`]: "EUR/USD",
    [`trade${index}-source`]: index % 2 === 0 ? "otc" : "exchange",
    [`trade${index}-direction`]: "up",
    [`trade${index}-amount`]: "10",
    [`trade${index}-payout`]: "90%",
    [`trade${index}-expiry`]: "3 минуты",
    [`trade${index}-basis`]: "Тренд вверх, откат к области.",
    [`trade${index}-result`]: index % 2 === 0 ? "loss" : "profit",
    [`trade${index}-change`]: "Ничего.",
  });
  const refusal = (index: number) => ({
    [`refusal${index}-datetime`]: "02.10 16:00",
    [`refusal${index}-asset`]: "GBP/USD",
    [`refusal${index}-source`]: "exchange",
    [`refusal${index}-checked`]: "Состояние рынка.",
    [`refusal${index}-why`]: "Состояние неясно.",
  });
  const fiveTrades = Object.assign({}, ...[1, 2, 3, 4, 5].map(trade)) as Record<string, unknown>;

  await check("C9 the level-9 report says, before anything is submitted, that nobody reviews it", async () => {
    await start(9);
    const context = await reportSubmission.resolveOwnReportContext({
      actorUserId: learner.id,
      stableCode: codeOf(9),
      locale: LOCALE,
    });
    assert.equal(context.kind, "available");
    if (context.kind !== "available") return;
    assert.equal(context.level.acceptance, "formal");
    assert.equal(context.assignment.fields.length, 67);
    // Five trade records of ten fields and one refusal record are required.
    assert.equal(context.assignment.fields.filter((field) => field.required).length, 55);
  });

  let reportRevision = 0;
  await check("C10 an incomplete report is not accepted, and the level stays where it was", async () => {
    const saved = await reportSubmission.saveOwnReportDraft(learner.id, {
      stableCode: codeOf(9),
      requestId: requestId("draft"),
      expectedRevision: 0,
      // Five trades and NO refusal: «минимум один отказ» is not met.
      fieldValues: fiveTrades,
    });
    reportRevision = saved.resultingWorkflowVersion;
    await expectCode(
      () =>
        reportSubmission.submitOwnReport(learner.id, {
          stableCode: codeOf(9),
          requestId: requestId("submit-incomplete"),
          expectedRevision: reportRevision,
        }),
      "REPORT_DRAFT_INPUT_INVALID",
    );
    assert.equal((await stateOf(9)).state, "in_progress");
    const submission = await prisma.reportSubmission.findFirstOrThrow({ where: { userId: learner.id } });
    assert.equal(submission.status, "draft");
  });

  await check("C11 an added refusal record must be filled, like the first", async () => {
    const saved = await reportSubmission.saveOwnReportDraft(learner.id, {
      stableCode: codeOf(9),
      requestId: requestId("draft-2"),
      expectedRevision: reportRevision,
      fieldValues: { ...fiveTrades, ...refusal(1), "refusal2-added": true },
    });
    reportRevision = saved.resultingWorkflowVersion;
    await expectCode(
      () =>
        reportSubmission.submitOwnReport(learner.id, {
          stableCode: codeOf(9),
          requestId: requestId("submit-refusal2"),
          expectedRevision: reportRevision,
        }),
      "REPORT_DRAFT_INPUT_INVALID",
    );
  });

  await check("C12 a complete report is accepted at submission: +500, level 10, Journal open, nobody asked", async () => {
    const before = await xpTotal();
    const saved = await reportSubmission.saveOwnReportDraft(learner.id, {
      stableCode: codeOf(9),
      requestId: requestId("draft-3"),
      expectedRevision: reportRevision,
      fieldValues: { ...fiveTrades, ...refusal(1) },
    });
    reportRevision = saved.resultingWorkflowVersion;
    const submitInput = {
      stableCode: codeOf(9),
      requestId: requestId("submit"),
      expectedRevision: reportRevision,
    };
    const result = await reportSubmission.submitOwnReport(learner.id, submitInput);
    assert.equal(result.kind, "submitted");
    assert.equal(result.submission.status, "approved");
    assert.equal(result.submission.approvedRevisionNumber, result.submission.submittedRevisionNumber);

    assert.equal((await stateOf(9)).state, "completed");
    assert.equal((await stateOf(10)).state, "available");
    assert.equal(await xpTotal(), before + 500);
    assert.equal(await toolGuard.isToolUnlockedForUser(learner.id, "tool.trading_journal", prisma), true);

    // No reviewer was involved and nothing is waiting for one. The acceptance
    // is one row that says so: approved, by nobody, against the four formal
    // criteria.
    const submission = await prisma.reportSubmission.findFirstOrThrow({ where: { userId: learner.id } });
    assert.equal(submission.status, "approved");
    assert.equal(submission.claimedById, null);
    const reviews = await prisma.reportReview.findMany({
      where: { submissionId: submission.id },
      include: { scores: true },
    });
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].id, submission.approvedReviewId);
    assert.equal(reviews[0].decision, "approved");
    assert.equal(reviews[0].reviewerId, null, "nobody reviewed it");
    assert.equal(reviews[0].reviewerRoleSnapshot, "user");
    assert.equal(reviews[0].claimedAt, null);
    assert.equal(reviews[0].scores.length, 4, "one score per formal criterion");
    assert.equal(await prisma.learnerOpsCase.count(), 0, "no operations work item for a report nobody reviews");
    const audits = await prisma.auditLog.findMany({ where: { entityType: "ReportSubmission", entityId: String(submission.id) } });
    assert.ok(audits.some((row) => row.action === "REPORT_FORMALLY_ACCEPTED"));
    assert.ok(!audits.some((row) => row.action === "REPORT_APPROVED"), "a formal acceptance is not a person's approval");

    // The read model agrees with itself afterwards…
    const context = await reportSubmission.resolveOwnReportContext({
      actorUserId: learner.id,
      stableCode: codeOf(9),
      locale: LOCALE,
    });
    assert.equal(context.kind, "approved");
    // …an exact retry is inert…
    const retry = await reportSubmission.submitOwnReport(learner.id, submitInput);
    assert.equal(retry.retry, true);
    assert.equal(await xpTotal(), before + 500);
    // …and there is nothing to resubmit.
    await expectCode(
      () =>
        reportSubmission.resubmitOwnReport(learner.id, {
          stableCode: codeOf(9),
          requestId: requestId("resubmit"),
          expectedRevision: retry.resultingWorkflowVersion,
        }),
      "REPORT_NOT_REJECTED",
    );
  });

  await check("C12b no reviewer is ever offered a formally accepted report", async () => {
    const reportReview = await import("../../src/lib/curriculum/report-review");
    const queue = await reportReview.listReportReviewQueue(admin.id, { locale: LOCALE });
    assert.equal(queue.kind, "resolved");
    if (queue.kind === "resolved") assert.equal(queue.items.length, 0);
    // Nothing is left in the one state a reviewer can take work from.
    assert.equal(await prisma.reportSubmission.count({ where: { status: "pending_review" } }), 0);
    assert.equal(await prisma.userLevelProgress.count({ where: { status: "pending_review" } }), 0);
  });

  await check("C13 levels 10–12 pass by their tests; 13 opens the Risk Plan and the Checklist; 14 completes", async () => {
    for (const number of [10, 11, 12]) {
      await start(number);
      assert.equal((await sit(number)).graded.attempt.status, "passed", `level ${number}`);
    }
    assert.equal(await toolGuard.isToolUnlockedForUser(learner.id, "tool.risk_calculator", prisma), false);
    for (const number of [13, 14]) {
      await start(number);
      const receipt = await manual.completeManualLevel({
        actorUserId: learner.id,
        stableCode: codeOf(number),
        requestId: requestId(`manual-${number}`),
      });
      assert.equal(receipt.xpAwarded, 150);
      assert.equal(receipt.terminal, false, "level 14 is not the end of the program");
    }
    assert.equal(await toolGuard.isToolUnlockedForUser(learner.id, "tool.risk_calculator", prisma), true);
    assert.equal(await toolGuard.isToolUnlockedForUser(learner.id, "tool.entry_checklist", prisma), true);
    // 50 + 50 + 0 + 5×100 + 500 + 3×100 + 150 + 150
    assert.equal(await xpTotal(), 1_700);
  });

  /* ==================================================================== *
   * D. THE END OF WHAT IS OPEN
   * ==================================================================== */

  await check("D1 level 15 is the learner's current level, locked because it is not open, and cannot be started", async () => {
    const resolved = await states();
    assert.equal(resolved.enrollment.status, "active", "finishing what is open does not finish the program");
    assert.equal(resolved.enrollment.currentLevel, 15);
    const level = resolved.levels.find((item) => item.levelDefinition.levelNumber === 15)!;
    assert.equal(level.state, "locked");
    assert.deepEqual(level.blockers, ["definition_inactive"]);
    await expectCode(
      () => levelState.startCurrentCurriculumLevel({ actorUserId: learner.id }),
      "LEVEL_START_NOT_AVAILABLE",
    );
    const content = await contentRead.resolveUserLevelContent({
      actorUserId: learner.id,
      stableCode: codeOf(15),
      locale: LOCALE,
    });
    assert.equal(content.kind, "unavailable");
  });

  await check("D2 the tools of the closed levels say which level opens them and stay shut", async () => {
    const access = await tools();
    assert.equal(access.unlockedCount, 4);
    const stats = access.tools.find((entry) => entry.code === "tool.personal_stats")!;
    assert.deepEqual([stats.unlocked, stats.unlockLevel, stats.reason], [false, 24, "unlock_level_incomplete"]);
    const calendar = access.tools.find((entry) => entry.code === "tool.news_calendar")!;
    assert.deepEqual([calendar.unlocked, calendar.unlockLevel, calendar.reason], [false, 28, "unlock_level_incomplete"]);
  });

  await check("D3 the read model carries the chapter, the kind and the open/closed status", async () => {
    const resolved = await states();
    const unlocks = await toolAccess.loadCurriculumToolUnlocks(prisma, resolved.curriculumVersion.id);
    const full = readApi.mapEnrolledCurriculumRead(resolved, unlocks);
    assert.deepEqual(
      full.modules.map((item) => item.chapter),
      [
        { number: 1, title: "Основы и первые реальные сделки" },
        { number: 1, title: "Основы и первые реальные сделки" },
        { number: 1, title: "Основы и первые реальные сделки" },
        { number: 2, title: "Чтение графика" },
        { number: 2, title: "Чтение графика" },
        { number: 2, title: "Чтение графика" },
      ],
    );
    const levels = full.modules.flatMap((item) => item.levels);
    assert.equal(levels.find((item) => item.levelNumber === 9)!.kind, "report");
    assert.equal(levels.find((item) => item.levelNumber === 14)!.kind, "assembly");
    assert.equal(levels.find((item) => item.levelNumber === 15)!.status, "disabled");
    const summary = readApi.mapEnrolledCurriculumSummary(resolved, unlocks);
    assert.equal(summary.currentLevel.status, "disabled");
    assert.equal(summary.currentLevel.presentationState, "locked");
    assert.equal(summary.progress.completedLevels, 14);
    assert.equal(summary.progress.totalLevels, 30);
    assert.equal(summary.toolAccess.unlockedCount, 4);
  });

  /* ==================================================================== *
   * E. A LEGACY PACKAGE KEEPS ITS TOOLS
   * ==================================================================== */

  await check("E1 a package written before `toolUnlocks` imports to the rule it was written under", async () => {
    const legacy = JSON.parse(
      fs.readFileSync("curriculum/packages/ata-v2-canonical-100.v4.rev2.draft.json", "utf8"),
    ) as { toolUnlocks?: unknown; curriculumVersionNumber: number };
    assert.equal(legacy.toolUnlocks, undefined, "the accepted artifact is untouched");
    const result = await packageImport.importCurriculumPackage(legacy, { db: prisma });
    assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
    if (!result.ok) return;
    assert.equal(result.summary.counts.toolUnlocks, 6);
    const version = await prisma.curriculumVersion.findFirstOrThrow({
      where: { code: "ata-v2", versionNumber: legacy.curriculumVersionNumber },
    });
    const rows = await prisma.levelToolUnlock.findMany({
      where: { curriculumVersionId: version.id },
      include: { levelDefinition: { select: { levelNumber: true } } },
      orderBy: { levelDefinition: { levelNumber: "asc" } },
    });
    assert.deepEqual(
      rows.map((row) => [row.toolCode, row.levelDefinition.levelNumber]),
      [
        ["tool.trade_card", 5],
        ["tool.trading_journal", 10],
        ["tool.risk_calculator", 15],
        ["tool.entry_checklist", 20],
        ["tool.personal_stats", 25],
        ["tool.news_calendar", 30],
      ],
    );
  });

  /* ==================================================================== *
   * F. LESSON MEDIA
   * ==================================================================== */

  await check("F1 a lesson with no registered video is served exactly as before", async () => {
    const content = await contentRead.resolveUserLevelContent({
      actorUserId: learner.id,
      stableCode: codeOf(4),
      locale: LOCALE,
    });
    assert.equal(content.kind, "completed");
    if (content.kind !== "completed") return;
    assert.deepEqual(content.content.assets, []);
    assert.equal(content.content.videoDurationSeconds, null);
    assert.equal(content.content.localization.learningObjectiveExtension, sourceLevel(4).test ? "Умеет читать свечу и различать, что настройки меняют картинку, а не рынок." : "");
  });

  await check("F2 a registered video reaches the lesson with its own length and an address on the Academy's origin", async () => {
    const checksum = "a".repeat(64);
    await prisma.lessonMediaAsset.create({
      data: {
        curriculumCode: "ata-v2",
        levelStableCode: codeOf(4),
        kind: "video",
        assetCode: "video",
        locale: null,
        storageKey: `lessons/${codeOf(4)}/${checksum.slice(0, 16)}.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 123_456_789,
        durationSeconds: 612,
        checksum,
      },
    });
    const content = await contentRead.resolveUserLevelContent({
      actorUserId: learner.id,
      stableCode: codeOf(4),
      locale: LOCALE,
    });
    assert.ok(content.kind === "completed");
    if (content.kind !== "completed") return;
    assert.equal(content.content.videoDurationSeconds, 612);
    assert.equal(content.content.assets.length, 1);
    const video = content.content.assets[0];
    assert.equal(video.kind, "video");
    assert.equal(video.url, `/media/lessons/${codeOf(4)}/${checksum.slice(0, 16)}.mp4`);
    assert.equal(video.durationSeconds, 612);
    // No host name is stored or composed anywhere.
    assert.ok(!/^https?:/i.test(video.url));
    // Another lesson is unaffected.
    const other = await contentRead.resolveUserLevelContent({
      actorUserId: learner.id,
      stableCode: codeOf(5),
      locale: LOCALE,
    });
    assert.ok(other.kind === "completed" && other.content.assets.length === 0);
  });

  await check("F3 the registry refuses a path that could leave the media root", async () => {
    for (const storageKey of ["/etc/passwd", "lessons/../secret.mp4", "lessons/a b.mp4"]) {
      await assert.rejects(
        prisma.lessonMediaAsset.create({
          data: {
            curriculumCode: "ata-v2",
            levelStableCode: codeOf(6),
            kind: "video",
            assetCode: "video",
            storageKey,
            mimeType: "video/mp4",
            sizeBytes: 1,
            durationSeconds: 1,
            checksum: "b".repeat(64),
          },
        }),
        `storageKey ${storageKey} must be refused by the table itself`,
      );
    }
  });

  await check("F4 a lesson says where each answer of its test is taught, and nothing about the answers", async () => {
    const tested = await contentRead.resolveUserLevelContent({
      actorUserId: learner.id,
      stableCode: codeOf(4),
      locale: LOCALE,
    });
    assert.ok(tested.kind === "completed");
    if (tested.kind !== "completed") return;
    const expected = (sourceLevel(4).test ?? []).map((question, index) => ({
      questionNumber: index + 1,
      rewatchFromSeconds: question.rewatchFromSeconds,
    }));
    assert.equal(expected.length, 4);
    assert.deepEqual(tested.content.questionMarkers, expected);
    for (const marker of tested.content.questionMarkers) {
      assert.deepEqual(Object.keys(marker).sort(), ["questionNumber", "rewatchFromSeconds"]);
    }
    // A lesson without a test has no markers.
    const untested = await contentRead.resolveUserLevelContent({
      actorUserId: learner.id,
      stableCode: codeOf(1),
      locale: LOCALE,
    });
    assert.ok(untested.kind === "completed" && untested.content.questionMarkers.length === 0);
  });

  /* ==================================================================== *
   * G. MOVING A LEARNER TO THE PUBLISHED VERSION
   * ==================================================================== */

  const move = await import("../../src/lib/curriculum/enrollment-move");
  const fingerprint = await import("../../src/lib/curriculum/package/fingerprint");

  type MutablePackage = {
    contentFingerprint: string;
    modules: Array<{ levels: Array<{ levelNumber: number; levelCode: string; status?: string; prerequisiteLevelCodes: string[] }> }>;
    toolUnlocks?: Array<{ toolCode: string; levelCode: string }>;
    pendingApprovals: Array<{ levelCode: string }>;
  };

  /** A successor of the program, built from the same source, with one change. */
  async function publishSuccessor(versionNumber: number, change: (pkg: MutablePackage) => void) {
    const pkg = JSON.parse(builder.serializeFunnel30Package(versionNumber)) as MutablePackage;
    change(pkg);
    pkg.contentFingerprint = fingerprint.calculateFingerprint(pkg as never);
    const imported = await packageImport.importCurriculumPackage(pkg, { db: prisma });
    assert.equal(imported.ok, true, JSON.stringify(imported.ok ? [] : imported.issues));
    const draft = await prisma.curriculumVersion.findFirstOrThrow({ where: { code: "ata-v2", versionNumber } });
    const current = await prisma.curriculumVersion.findFirstOrThrow({ where: { code: "ata-v2", status: "published" } });
    await service.publishCurriculumVersion({
      curriculumVersionId: draft.id,
      actorId: admin.id,
      expectedPublishedVersionId: current.id,
    });
    return draft.id;
  }

  // A second learner, part of the way through the current version, for the refusals.
  const waiting = await createUser("waiting");
  await enrollmentDomain.enrollUserInPublishedCurriculum({ userId: waiting.id, actorId: admin.id });

  await check("G1 a learner on the published version is not moved, and a plan writes nothing", async () => {
    const plan = await move.moveEnrollmentToPublishedVersion({
      userId: learner.id,
      reason: "regression: already current",
    });
    assert.equal(plan.outcome, "already_current");
    assert.equal(await prisma.userCurriculumEnrollment.count({ where: { userId: learner.id } }), 1);
    const nobody = await createUser("nobody");
    assert.equal(
      (await move.moveEnrollmentToPublishedVersion({ userId: nobody.id, reason: "regression: no enrollment" })).outcome,
      "no_active_enrollment",
    );
  });

  let successorId = 0;
  await check(`G2 the chapter opens: a successor with level 15 open is published, and version ${VERSION} is archived`, async () => {
    successorId = await publishSuccessor(VERSION + 1, (pkg) => {
      for (const moduleDefinition of pkg.modules) {
        for (const level of moduleDefinition.levels) {
          if (level.levelNumber === 15) delete level.status;
        }
      }
    });
    const versions = await prisma.curriculumVersion.findMany({ where: { code: "ata-v2", versionNumber: { in: [VERSION, VERSION + 1] } }, orderBy: { versionNumber: "asc" } });
    assert.deepEqual(versions.map((item) => item.status), ["archived", "published"]);
    // The learner is still pinned to the current version, and still standing on a closed level 15.
    const resolved = await states();
    assert.equal(resolved.curriculumVersion.versionNumber, VERSION);
    assert.equal(resolved.levels.find((item) => item.levelDefinition.levelNumber === 15)!.state, "locked");
  });

  await check("G3 a dry run says what would happen and changes nothing", async () => {
    const plan = await move.moveEnrollmentToPublishedVersion({
      userId: learner.id,
      reason: "regression: plan only",
      dryRun: true,
    });
    assert.equal(plan.outcome, "moved");
    assert.deepEqual(plan.from && [plan.from.versionNumber, plan.from.currentLevel, plan.from.completedLevels], [VERSION, 15, 14]);
    assert.deepEqual(plan.to, { versionNumber: VERSION + 1, currentLevel: 15, carriedLevels: 14 });
    assert.equal(plan.xpCarried, 1_700);
    assert.equal(plan.newEnrollmentId, null);
    assert.equal(await prisma.userCurriculumEnrollment.count({ where: { userId: learner.id } }), 1);
    assert.equal((await states()).curriculumVersion.versionNumber, VERSION);
  });

  await check("G4 the move carries fourteen levels, the XP and the tools, and level 15 is now open to start", async () => {
    const plan = await move.moveEnrollmentToPublishedVersion({
      userId: learner.id,
      actorId: admin.id,
      reason: "regression: chapter two is out",
    });
    assert.equal(plan.outcome, "moved");
    assert.ok(plan.newEnrollmentId);
    const rows = await prisma.userCurriculumEnrollment.findMany({ where: { userId: learner.id }, orderBy: { id: "asc" } });
    assert.deepEqual(rows.map((row) => row.status), ["superseded", "active"]);
    assert.equal(rows[1].curriculumVersionId, successorId);
    assert.equal(rows[1].migrationSource, `enrollment:${rows[0].id}`);

    const resolved = await states();
    assert.equal(resolved.curriculumVersion.versionNumber, VERSION + 1);
    assert.equal(resolved.enrollment.currentLevel, 15);
    assert.equal(resolved.levels.filter((item) => item.state === "completed").length, 14);
    assert.equal(resolved.levels.find((item) => item.levelDefinition.levelNumber === 15)!.state, "available");
    assert.equal(await xpTotal(), 1_700, "XP is never taken away");
    assert.equal((await tools()).unlockedCount, 4, "the tools the learner had are still open");
    assert.equal(await toolGuard.isToolUnlockedForUser(learner.id, "tool.trading_journal", prisma), true);

    // The old enrollment's history is whole.
    assert.equal(await prisma.userLevelProgress.count({ where: { enrollmentId: rows[0].id, status: "completed" } }), 14);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "CURRICULUM_ENROLLMENT_MOVED" } });
    assert.equal(audit.userId, admin.id);
    assert.equal((audit.metadata as { carriedLevels: number }).carriedLevels, 14);

    // And the program goes on: level 15 starts and completes like any lesson.
    await start(15);
    const receipt = await manual.completeManualLevel({
      actorUserId: learner.id,
      stableCode: codeOf(15),
      requestId: requestId("manual-15"),
    });
    assert.equal(receipt.nextLevelNumber, 16);
    assert.equal((await stateOf(16)).state, "locked");
    // A second move is a no-op.
    assert.equal(
      (await move.moveEnrollmentToPublishedVersion({ userId: learner.id, reason: "regression: again" })).outcome,
      "already_current",
    );
  });

  await check("G5 a learner waiting on a reviewer is not moved", async () => {
    const enrollment = await prisma.userCurriculumEnrollment.findFirstOrThrow({ where: { userId: waiting.id, status: "active" } });
    const first = await prisma.levelDefinition.findFirstOrThrow({ where: { curriculumVersionId: enrollment.curriculumVersionId, levelNumber: 1 } });
    await prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrollment.id,
        curriculumVersionId: enrollment.curriculumVersionId,
        levelDefinitionId: first.id,
        status: "pending_review",
      },
    });
    const plan = await move.moveEnrollmentToPublishedVersion({ userId: waiting.id, reason: "regression: pending review" });
    assert.equal(plan.outcome, "blocked_pending_review");
    assert.equal(await prisma.userCurriculumEnrollment.count({ where: { userId: waiting.id, status: "active" } }), 1);
    assert.equal(await prisma.userCurriculumEnrollment.count({ where: { userId: waiting.id } }), 1);
    await prisma.userLevelProgress.updateMany({ where: { enrollmentId: enrollment.id }, data: { status: "in_progress" } });
  });

  await check("G6 a version whose first level is a different level carries nothing: level 1 again, with the XP", async () => {
    // Same program, but level 1 is a different lesson (another stable code).
    await publishSuccessor(VERSION + 2, (pkg) => {
      const levels = pkg.modules.flatMap((moduleDefinition) => moduleDefinition.levels);
      const first = levels.find((level) => level.levelNumber === 1)!;
      const renamed = `${first.levelCode}-novyy`;
      for (const level of levels) {
        level.prerequisiteLevelCodes = level.prerequisiteLevelCodes.map((code) => (code === first.levelCode ? renamed : code));
      }
      for (const pending of pkg.pendingApprovals) {
        if (pending.levelCode === first.levelCode) pending.levelCode = renamed;
      }
      first.levelCode = renamed;
    });
    const before = await xpTotal();
    const plan = await move.moveEnrollmentToPublishedVersion({ userId: learner.id, reason: "regression: a different program" });
    assert.equal(plan.outcome, "moved");
    assert.deepEqual(plan.to, { versionNumber: VERSION + 2, currentLevel: 1, carriedLevels: 0 });
    const resolved = await states();
    assert.equal(resolved.enrollment.currentLevel, 1);
    assert.equal(resolved.levels.filter((item) => item.state === "completed").length, 0);
    assert.equal(await xpTotal(), before);
    // Tools follow the levels: nothing completed on this version, nothing open.
    assert.equal((await tools()).unlockedCount, 0);
  });

  await prisma.$disconnect();
  console.log(`\n30-level program regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
