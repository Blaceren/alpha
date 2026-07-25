/**
 * AC-1 — assessment publication policy, canonical option representation, the
 * assessment question stable-key class and canonical importer persistence.
 *
 * Guards the corrected contract that lets the approved four-question /
 * passPercent-100 lesson assessment publish and be served, without weakening
 * validation and without any assessment-specific special case.
 *
 * Pure in-process checks plus one synthetic-DB import; never touches live DEV.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-assessment-contract-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const previousDatabaseUrl = process.env.DATABASE_URL;
const APPROVED = "curriculum/packages/ata-v2-first-slice.approved.json";
const APPROVED_FINGERPRINT = "7e298cc16bdbbf747db31abe467f017681eb2e7eb24c45990d3e5f689da1293c";
const L2 = "v2.l002.kak-ustroen-alfa-trade-academy";

let passed = 0;
let failed = 0;

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
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

type SnapshotOverrides = {
  passPercent?: number;
  levelType?: "lesson" | "final_exam" | "report";
  questionCount?: number;
  optionCount?: number;
  stableKeys?: string[];
  options?: unknown;
  optionLabels?: unknown;
  correctAnswer?: unknown;
};

/** Minimal in-memory snapshot shaped exactly like AssessmentPublicationSnapshot. */
function snapshot(overrides: SnapshotOverrides = {}) {
  const questionCount = overrides.questionCount ?? 4;
  const optionCount = overrides.optionCount ?? 4;
  const codes = ["a", "b", "c", "d", "e", "f", "g", "h"].slice(0, optionCount);
  const questions = Array.from({ length: questionCount }, (_, index) => {
    const options = overrides.options !== undefined ? overrides.options : codes.map((code) => ({ code }));
    const optionLabels =
      overrides.optionLabels !== undefined
        ? overrides.optionLabels
        : Object.fromEntries(codes.map((code) => [code, `label-${code}`]));
    return {
      id: index + 1,
      stableKey: overrides.stableKeys?.[index] ?? `ata-v2.l002.q${index + 1}`,
      questionNumber: index + 1,
      type: "single_choice" as const,
      status: "active" as const,
      skillTag: null,
      options,
      correctAnswer: overrides.correctAnswer !== undefined ? overrides.correctAnswer : { code: codes[0] },
      localizations: [{ id: index + 1, locale: "ru", prompt: `prompt ${index + 1}`, optionLabels, explanation: null }],
    };
  });
  return {
    id: 1,
    passPercent: overrides.passPercent ?? 100,
    maxAttempts: null,
    questions,
    levelDefinition: {
      type: overrides.levelType ?? ("lesson" as const),
      curriculumVersion: { status: "published" as const },
    },
  };
}

async function main() {
  const { validateAssessmentPublication } = await import("../../src/lib/curriculum/assessment-validation");
  const {
    isCanonicalAssessmentQuestionKey,
    MAX_ASSESSMENT_QUESTION_KEY_LENGTH,
  } = await import("../../src/lib/curriculum/stable-code");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const codesOf = (o: SnapshotOverrides = {}) => validateAssessmentPublication(snapshot(o) as any).map((i) => i.code);

  /* ------------------------- publication policy ------------------------- */
  await check("1 passPercent 80 is valid", () => assert.deepEqual(codesOf({ passPercent: 80, questionCount: 5 }), []));
  await check("2 passPercent 100 is valid (approved D1–D8)", () => assert.deepEqual(codesOf({ passPercent: 100 }), []));
  await check("3 passPercent 0 is invalid", () =>
    assert.equal(codesOf({ passPercent: 0 }).includes("ASSESSMENT_PASS_PERCENT_INVALID"), true));
  await check("4 passPercent 101 is invalid", () =>
    assert.equal(codesOf({ passPercent: 101 }).includes("ASSESSMENT_PASS_PERCENT_INVALID"), true));
  await check("5 non-integer passPercent is invalid", () =>
    assert.equal(codesOf({ passPercent: 80.5 }).includes("ASSESSMENT_PASS_PERCENT_INVALID"), true));
  await check("6 four lesson questions valid (approved D1–D8)", () =>
    assert.deepEqual(codesOf({ questionCount: 4 }), []));
  await check("7 existing five/six/seven-question lesson assessments stay valid", () => {
    for (const questionCount of [5, 6, 7]) assert.deepEqual(codesOf({ questionCount }), []);
  });
  await check("8 zero questions invalid", () => {
    const codes = codesOf({ questionCount: 0 });
    assert.equal(codes.includes("ASSESSMENT_QUESTION_REQUIRED"), true);
    assert.equal(codes.includes("ASSESSMENT_LESSON_QUESTION_COUNT"), true);
  });
  await check("9 three questions and eight questions are out of lesson bounds", () => {
    for (const questionCount of [3, 8]) {
      assert.equal(codesOf({ questionCount }).includes("ASSESSMENT_LESSON_QUESTION_COUNT"), true);
    }
  });
  await check("9b final_exam still requires exactly 30", () => {
    assert.equal(
      codesOf({ levelType: "final_exam", questionCount: 4 }).includes("ASSESSMENT_FINAL_EXAM_QUESTION_COUNT"),
      true,
    );
  });

  /* --------------------------- option contract --------------------------- */
  await check("10 canonical four-option question valid", () => assert.deepEqual(codesOf({ optionCount: 4 }), []));
  await check("11 duplicate option code invalid", () =>
    assert.equal(
      codesOf({ options: [{ code: "a" }, { code: "a" }, { code: "b" }, { code: "c" }] }).includes(
        "ASSESSMENT_ANSWER_SCHEMA_INVALID",
      ),
      true,
    ));
  await check("12 missing option label invalid", () =>
    assert.equal(
      codesOf({ optionLabels: { a: "x", b: "y", c: "z" } }).includes("ASSESSMENT_LOCALIZATION_INCOMPLETE"),
      true,
    ));
  await check("13 unknown label key invalid", () =>
    assert.equal(
      codesOf({ optionLabels: { a: "x", b: "y", c: "z", zz: "q" } }).includes("ASSESSMENT_LOCALIZATION_INCOMPLETE"),
      true,
    ));
  await check("14 correctAnswer not among options invalid", () =>
    assert.equal(codesOf({ correctAnswer: { code: "zz" } }).includes("ASSESSMENT_ANSWER_SCHEMA_INVALID"), true));
  await check("15 legacy positional shapes are rejected, not silently accepted", () => {
    assert.equal(codesOf({ options: ["a", "b", "c", "d"] }).includes("ASSESSMENT_ANSWER_SCHEMA_INVALID"), true);
    assert.equal(codesOf({ optionLabels: ["a", "b", "c", "d"] }).includes("ASSESSMENT_LOCALIZATION_INCOMPLETE"), true);
    assert.equal(
      codesOf({ correctAnswer: { kind: "options", optionCodes: ["a"] } }).includes("ASSESSMENT_ANSWER_SCHEMA_INVALID"),
      true,
    );
  });
  await check("16 option objects carrying extra keys are rejected", () =>
    assert.equal(
      codesOf({ options: [{ code: "a", label: "x" }, { code: "b" }, { code: "c" }, { code: "d" }] }).includes(
        "ASSESSMENT_ANSWER_SCHEMA_INVALID",
      ),
      true,
    ));

  /* ---------------------------- stable keys ---------------------------- */
  await check("18 canonical dotted question keys valid", () => {
    assert.deepEqual(codesOf({ stableKeys: ["ata-v2.l002.q1", "ata-v2.l002.q2", "ata-v2.l002.q3", "ata-v2.l002.q4"] }), []);
    for (const key of ["ata-v2.l002.q1", "q1", "a_b-c.d", "x".repeat(MAX_ASSESSMENT_QUESTION_KEY_LENGTH)]) {
      assert.equal(isCanonicalAssessmentQuestionKey(key), true, key);
    }
  });
  await check("20 malformed keys rejected (uppercase, whitespace, traversal, separators, overlong)", () => {
    for (const key of [
      "ATA-v2.q1", " q1", "q1 ", "a..b", ".q1", "q1.", "a/b", "../etc", "a b", "-q1", "q1-", "a__b".replace("__", "._"),
      "x".repeat(MAX_ASSESSMENT_QUESTION_KEY_LENGTH + 1), "", "a.-b",
    ]) {
      assert.equal(isCanonicalAssessmentQuestionKey(key), false, `should reject: ${JSON.stringify(key)}`);
    }
    assert.equal(isCanonicalAssessmentQuestionKey(123), false);
    assert.equal(isCanonicalAssessmentQuestionKey(null), false);
  });
  await check("21 duplicate question keys rejected", () =>
    assert.equal(
      codesOf({ stableKeys: ["ata-v2.l002.q1", "ata-v2.l002.q1", "ata-v2.l002.q3", "ata-v2.l002.q4"] }).includes(
        "ASSESSMENT_QUESTION_KEY_DUPLICATE",
      ),
      true,
    ));
  await check("22 invalid key surfaces ASSESSMENT_QUESTION_KEY_INVALID", () =>
    assert.equal(
      codesOf({ stableKeys: ["ata-v2.l002.Q1", "ata-v2.l002.q2", "ata-v2.l002.q3", "ata-v2.l002.q4"] }).includes(
        "ASSESSMENT_QUESTION_KEY_INVALID",
      ),
      true,
    ));
  await check("22b the level stable-code grammar is NOT reused for question keys", async () => {
    const { isCanonicalLevelCode } = await import("../../src/lib/curriculum/stable-code");
    // a valid question key that is deliberately not a valid level code
    assert.equal(isCanonicalAssessmentQuestionKey("ata-v2.l002.q1"), true);
    assert.equal(isCanonicalLevelCode("ata-v2.l002.q1"), false);
  });

  /* ------------------------------ importer ------------------------------ */
  cleanup();
  const migrate = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migrate.status !== 0) throw new Error(`${migrate.stdout}\n${migrate.stderr}`);
  process.env.DATABASE_URL = dbUrl;

  const { prisma } = await import("../../src/lib/prisma");
  const { importCurriculumPackage } = await import("../../src/lib/curriculum/package/import");
  const approved = JSON.parse(fs.readFileSync(APPROVED, "utf8"));

  await check("23 importer persists the canonical representation", async () => {
    const result = await importCurriculumPackage(approved, { db: prisma });
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.issues));
    assert.equal(result.ok && result.summary.fingerprint, APPROVED_FINGERPRINT);

    const questions = await prisma.questionDefinition.findMany({
      where: { assessmentVersion: { levelDefinition: { stableCode: L2 } } },
      include: { localizations: true },
      orderBy: { questionNumber: "asc" },
    });
    assert.equal(questions.length, 4);
    for (const question of questions) {
      const options = question.options as Array<{ code: string }>;
      assert.deepEqual(options, [{ code: "a" }, { code: "b" }, { code: "c" }, { code: "d" }]);
      const labels = question.localizations[0].optionLabels as Record<string, string>;
      assert.equal(Array.isArray(labels), false);
      assert.deepEqual(Object.keys(labels).sort(), ["a", "b", "c", "d"]);
      const correct = question.correctAnswer as { code?: string };
      assert.deepEqual(Object.keys(correct), ["code"]);
      assert.equal(options.some((option) => option.code === correct.code), true);
      assert.equal(isCanonicalAssessmentQuestionKey(question.stableKey), true);
    }
  });

  await check("23b the imported approved assessment passes publication validation", async () => {
    const stored = await prisma.assessmentVersion.findFirstOrThrow({
      where: { levelDefinition: { stableCode: L2 } },
      include: {
        levelDefinition: { include: { curriculumVersion: true } },
        questions: { include: { localizations: true } },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.deepEqual(validateAssessmentPublication(stored as any), []);
    assert.equal(stored.passPercent, 100);
  });

  await check("24 exact rerun is a no-op", async () => {
    const before = await prisma.questionDefinition.count();
    const rerun = await importCurriculumPackage(approved, { db: prisma });
    assert.equal(rerun.ok && rerun.summary.outcome, "unchanged");
    assert.equal(await prisma.questionDefinition.count(), before);
  });

  await check("25 drift on the same curriculum version is rejected", async () => {
    const { calculateFingerprint } = await import("../../src/lib/curriculum/package/fingerprint");
    const { curriculumPackageSchema } = await import("../../src/lib/curriculum/package/schema");
    const drifted = JSON.parse(JSON.stringify(approved));
    drifted.modules[0].levels[1].assessment.passPercent = 90;
    drifted.contentFingerprint = calculateFingerprint(curriculumPackageSchema.parse(drifted));
    const result = await importCurriculumPackage(drifted, { db: prisma });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, "PACKAGE_DRIFT");
  });

  await check("26 a non-canonical assessment is refused BEFORE the transaction", async () => {
    const { calculateFingerprint } = await import("../../src/lib/curriculum/package/fingerprint");
    const { curriculumPackageSchema } = await import("../../src/lib/curriculum/package/schema");
    const broken = JSON.parse(JSON.stringify(approved));
    broken.curriculumVersionNumber = 2;
    broken.packageRevision = 3;
    // a question code the DB stableKey CHECK (<= 64 chars) could not hold
    broken.modules[0].levels[1].assessment.questions[0].questionCode = `q.${"x".repeat(80)}`;
    broken.contentFingerprint = calculateFingerprint(curriculumPackageSchema.parse(broken));
    const versionsBefore = await prisma.curriculumVersion.count();
    const result = await importCurriculumPackage(broken, { db: prisma });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, "ASSESSMENT_NOT_CANONICAL");
    assert.equal(!result.ok && result.issues[0].code, "QUESTION_CODE_NOT_CANONICAL");
    // nothing was written: no partial curriculum version
    assert.equal(await prisma.curriculumVersion.count(), versionsBefore);
  });

  await check("27 import created no activation, learner, enrollment or attempt rows", async () => {
    assert.equal(await prisma.userCurriculumEnrollment.count(), 0);
    assert.equal(await prisma.assessmentAttempt.count(), 0);
    assert.equal(await prisma.userLevelProgress.count(), 0);
    assert.equal(await prisma.xPTransaction.count(), 0);
    const version = await prisma.curriculumVersion.findFirstOrThrow({ where: { code: "ata-v2" } });
    assert.equal(version.status, "draft");
  });

  await check("28 no answer material or learner-visible text leaks into the import result", async () => {
    const result = await importCurriculumPackage(approved, { db: prisma });
    const serialized = JSON.stringify(result);
    for (const forbidden of ["correctAnswer", "correctOptionCodes", "correctNumericValue", "explanation"]) {
      assert.equal(serialized.includes(forbidden), false, `import result leaked "${forbidden}"`);
    }
    // no actual prompt / option-label / explanation VALUES from the package
    const question = approved.modules[0].levels[1].assessment.questions[0];
    const localization = question.localizations[0];
    for (const value of [localization.prompt, localization.explanation, ...localization.optionLabels]) {
      assert.equal(serialized.includes(value), false, "import result leaked learner-visible or answer text");
    }
  });

  await prisma.$disconnect();
}

main()
  .catch((error) => {
    failed += 1;
    console.error("FATAL", error);
  })
  .finally(() => {
    cleanup();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  });
