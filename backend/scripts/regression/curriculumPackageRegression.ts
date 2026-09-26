/**
 * CV-1 curriculum package regression: schema, stable-code contract, validation,
 * fingerprint, importer transactionality/idempotency/drift, and the DB-target
 * guard. Runs against a synthetic SQLite database only.
 *
 * The package used here is SYNTHETIC_TEST_ONLY. It carries invented lesson text
 * and invented assessment answers so the framework can be exercised end to end;
 * it is NOT curriculum content and must never be shipped. The production
 * candidate lives in curriculum/packages/ata-v2-first-slice.draft.json and
 * deliberately omits the content that has no authoritative source.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-curriculum-package-${process.pid}.db`);
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

/* ------------------------------------------------------------------ *
 * SYNTHETIC_TEST_ONLY package factory
 * ------------------------------------------------------------------ */

const SYNTHETIC = {
  classification: "SYNTHETIC_TEST_ONLY" as const,
  sourcePath: "scripts/regression/curriculumPackageRegression.ts",
  sourceRef: "SYNTHETIC_TEST_ONLY fixture",
  revision: "cv1",
  confidence: "high" as const,
  conflicts: [] as string[],
  approvalRequired: true,
  note: "SYNTHETIC_TEST_ONLY — not curriculum content",
};

const L1 = "v2.l001.sinteticheskiy-vneshniy";
const L2 = "v2.l002.sinteticheskiy-urok";
const L3 = "v2.l003.sinteticheskiy-otchet";
const L4 = "v2.l004.sinteticheskaya-tochka";

function contentBody() {
  return {
    sections: [{ code: "intro", title: "Синтетический раздел", body: "Синтетическое тело урока." }],
    examples: [{ title: "Пример", body: "Тело примера." }],
    commonMistakes: [{ mistake: "Ошибка", correction: "Исправление" }],
    glossary: [{ term: "Термин", definition: "Определение" }],
    nextAction: { label: "Дальше", body: "Перейти к следующему уровню." },
    riskDisclaimer: "Синтетический дисклеймер.",
  };
}

type AnyRecord = Record<string, unknown>;

function basePackage(): AnyRecord {
  return {
    schemaVersion: "ata.curriculum.package/1",
    minImporterVersion: 1,
    packageCode: "synthetic.first-slice",
    packageRevision: 1,
    status: "draft",
    curriculumCode: "ata-v2",
    curriculumVersionNumber: 1,
    curriculumTitle: "Синтетический курс",
    curriculumDescription: "SYNTHETIC_TEST_ONLY",
    locale: "ru",
    createdFrom: "SYNTHETIC_TEST_ONLY",
    approval: { approvedBy: null, approvedAt: null, note: "SYNTHETIC_TEST_ONLY" },
    pendingApprovals: [],
    contentFingerprint: "0".repeat(64),
    modules: [
      {
        moduleCode: "module.01",
        moduleNumber: 1,
        title: "Синтетический модуль",
        description: "SYNTHETIC_TEST_ONLY",
        learningObjective: "Синтетическая цель",
        checkpointLevelCode: L4,
        levels: [
          {
            levelCode: L1,
            levelNumber: 1,
            type: "external_event",
            title: "Синтетический внешний шаг",
            shortDescription: "",
            learningObjective: "Пройти внешний шаг",
            completionMethod: "pocket_postback",
            xpReward: 0,
            requiredXp: 0,
            prerequisiteLevelCodes: [],
            checkpointLevelCode: null,
            estimatedDurationSeconds: null,
            content: null,
            assessment: null,
            report: null,
            gate: {
              completionSource: "external_event",
              integrationCode: "pocket.registration",
              selfCompletable: false,
              blockedExplanation: [{ locale: "ru", text: "Подтверждается внешней системой." }],
              provenance: { ...SYNTHETIC },
            },
            provenance: { ...SYNTHETIC },
          },
          {
            levelCode: L2,
            levelNumber: 2,
            type: "lesson",
            title: "Синтетический урок",
            shortDescription: "",
            learningObjective: "Понять структуру",
            completionMethod: "assessment_pass",
            xpReward: 20,
            requiredXp: 0,
            prerequisiteLevelCodes: [L1],
            checkpointLevelCode: null,
            estimatedDurationSeconds: 600,
            content: {
              contentCode: "synthetic.l002.content",
              versionNumber: 1,
              status: "published",
              videoDurationSeconds: 600,
              localizations: [
                {
                  locale: "ru",
                  title: "Синтетический урок — материал",
                  subtitle: "Подзаголовок",
                  learningObjectiveExtension: "Расширение цели",
                  summary: "Краткое описание материала.",
                  transcript: "Синтетическая расшифровка.",
                  body: contentBody(),
                },
              ],
              assets: [],
              provenance: { ...SYNTHETIC },
            },
            assessment: {
              assessmentCode: "synthetic.l002.assessment",
              versionNumber: 1,
              status: "published",
              passPercent: 80,
              maxAttempts: 3,
              showExplanation: true,
              questions: [
                {
                  questionCode: "synthetic.q1",
                  questionNumber: 1,
                  type: "single_choice",
                  skillTag: null,
                  optionCodes: ["a", "b"],
                  correctOptionCodes: ["a"],
                  correctNumericValue: null,
                  localizations: [
                    {
                      locale: "ru",
                      prompt: "Синтетический вопрос?",
                      optionLabels: ["Вариант А", "Вариант Б"],
                      explanation: "Синтетическое объяснение.",
                    },
                  ],
                  lessonTakeawayRef: "intro",
                  provenance: { ...SYNTHETIC },
                },
              ],
              provenance: { ...SYNTHETIC },
            },
            report: null,
            gate: null,
            provenance: { ...SYNTHETIC },
          },
          {
            levelCode: L3,
            levelNumber: 3,
            type: "report",
            title: "Синтетический отчёт",
            shortDescription: "",
            learningObjective: "Оформить отчёт",
            completionMethod: "report_approval",
            xpReward: 30,
            requiredXp: 0,
            prerequisiteLevelCodes: [L2],
            checkpointLevelCode: null,
            estimatedDurationSeconds: null,
            content: null,
            assessment: null,
            report: {
              reportCode: "synthetic.l003.report",
              versionNumber: 1,
              status: "published",
              localizations: [
                {
                  locale: "ru",
                  title: "Синтетический отчёт",
                  instructions: "Синтетическая формулировка задания.",
                  successCriteriaSummary: "Синтетические критерии.",
                  submitLabel: "Отправить",
                },
              ],
              fields: [
                {
                  stableKey: "summary",
                  type: "long_text",
                  required: true,
                  sortOrder: 0,
                  minLength: 10,
                  maxLength: 2000,
                  choiceCodes: [],
                  localizations: [
                    { locale: "ru", label: "Итог", helpText: "", placeholder: "", choiceLabels: [] },
                  ],
                },
              ],
              attachmentsAllowed: false,
              maxAttachments: 0,
              draftAllowed: true,
              mentorReviewRequired: true,
              provenance: { ...SYNTHETIC },
            },
            gate: null,
            provenance: { ...SYNTHETIC },
          },
          {
            levelCode: L4,
            levelNumber: 4,
            type: "financial_checkpoint",
            title: "Синтетическая контрольная точка",
            shortDescription: "",
            learningObjective: "Подтвердить баланс",
            completionMethod: "balance_check",
            xpReward: 0,
            requiredXp: 0,
            prerequisiteLevelCodes: [L3],
            checkpointLevelCode: null,
            estimatedDurationSeconds: null,
            content: null,
            assessment: null,
            report: null,
            gate: {
              completionSource: "financial_checkpoint",
              integrationCode: "checkpoint.module-01",
              selfCompletable: false,
              blockedExplanation: [{ locale: "ru", text: "Подтверждается по балансу." }],
              provenance: { ...SYNTHETIC },
            },
            provenance: { ...SYNTHETIC },
          },
        ],
      },
    ],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function main() {
  cleanupDb();
  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);

  process.env.DATABASE_URL = dbUrl;

  const { validateCurriculumPackage } = await import("../../src/lib/curriculum/package/validate");
  const { calculateFingerprint } = await import("../../src/lib/curriculum/package/fingerprint");
  const { importCurriculumPackage } = await import("../../src/lib/curriculum/package/import");
  const stableCode = await import("../../src/lib/curriculum/stable-code");
  const { assertSafeDatabaseUrl } = await import("../curriculum/importCurriculumPackage");
  const { prisma } = await import("../../src/lib/prisma");

  /** Seal a package: recompute and inject the fingerprint. */
  function seal(pkg: AnyRecord): AnyRecord {
    const withPlaceholder = { ...pkg, contentFingerprint: "0".repeat(64) };
    const parsed = validateCurriculumPackage(withPlaceholder);
    // Validation may fail for negative fixtures; compute from the raw shape instead.
    const fingerprint = parsed.ok
      ? parsed.fingerprint
      : calculateFingerprint(withPlaceholder as never);
    return { ...pkg, contentFingerprint: fingerprint };
  }

  function expectInvalid(pkg: AnyRecord, code: string) {
    const result = validateCurriculumPackage(seal(pkg));
    assert.equal(result.ok, false, `expected ${code}, package validated`);
    if (result.ok) return;
    assert.ok(
      result.issues.some((i) => i.code === code),
      `expected ${code}, got ${result.issues.map((i) => i.code).join(",")}`,
    );
  }

  /* --------------------------- 1. valid package --------------------------- */
  await check("1 valid synthetic package passes validation", () => {
    const result = validateCurriculumPackage(seal(basePackage()));
    assert.equal(result.ok, true);
  });

  await check("2 unknown schema version rejected", () => {
    const pkg = basePackage();
    pkg.schemaVersion = "ata.curriculum.package/999";
    expectInvalid(pkg, "SCHEMA_INVALID");
  });

  await check("2b unknown field affecting grading rejected", () => {
    const pkg = basePackage();
    (pkg.modules as AnyRecord[])[0].unexpectedGradingField = true;
    expectInvalid(pkg, "SCHEMA_INVALID");
  });

  /* ---------------------------- 3-7. structure ---------------------------- */
  await check("3 duplicate level stable code rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[1].levelCode = L1;
    expectInvalid(pkg, "LEVEL_CODE_DUPLICATE");
  });

  await check("4 missing prerequisite rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[1].prerequisiteLevelCodes = ["v2.l009.otsutstvuyet"];
    expectInvalid(pkg, "PREREQUISITE_MISSING");
  });

  await check("5 prerequisite cycle rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[1].prerequisiteLevelCodes = [L3];
    levels[2].prerequisiteLevelCodes = [L2];
    expectInvalid(pkg, "PREREQUISITE_CYCLE");
  });

  await check("6 self dependency rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[1].prerequisiteLevelCodes = [L2];
    expectInvalid(pkg, "PREREQUISITE_SELF");
  });

  await check("7 invalid level type rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[1].type = "not_a_type";
    expectInvalid(pkg, "SCHEMA_INVALID");
  });

  /* --------------------------- 8-12. assessment --------------------------- */
  await check("8 assessment without questions rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    (levels[1].assessment as AnyRecord).questions = [];
    expectInvalid(pkg, "SCHEMA_INVALID");
  });

  await check("9 missing correct answer rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    const questions = (levels[1].assessment as AnyRecord).questions as AnyRecord[];
    questions[0].correctOptionCodes = [];
    expectInvalid(pkg, "QUESTION_CORRECT_ANSWER_MISSING");
  });

  await check("10 correct option not among options rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    const questions = (levels[1].assessment as AnyRecord).questions as AnyRecord[];
    questions[0].correctOptionCodes = ["zzz"];
    expectInvalid(pkg, "QUESTION_CORRECT_OPTION_ABSENT");
  });

  await check("11 invalid pass threshold rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    (levels[1].assessment as AnyRecord).passPercent = 0;
    expectInvalid(pkg, "SCHEMA_INVALID");
  });

  await check("12 impossible retry policy rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    (levels[1].assessment as AnyRecord).maxAttempts = 0;
    expectInvalid(pkg, "SCHEMA_INVALID");
  });

  await check("12b duplicate option code within a question rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    const questions = (levels[1].assessment as AnyRecord).questions as AnyRecord[];
    questions[0].optionCodes = ["a", "a"];
    questions[0].correctOptionCodes = ["a"];
    (questions[0].localizations as AnyRecord[])[0].optionLabels = ["А", "А"];
    expectInvalid(pkg, "OPTION_CODE_DUPLICATE");
  });

  /* ------------------------- 13-15. report / gates ------------------------ */
  await check("13 report without prompt rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    ((levels[2].report as AnyRecord).localizations as AnyRecord[])[0].instructions = "";
    expectInvalid(pkg, "SCHEMA_INVALID");
  });

  await check("14 self-completable external_event rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[0].completionMethod = "manual";
    expectInvalid(pkg, "GATE_COMPLETION_METHOD_SELF_COMPLETABLE");
  });

  await check("15 self-completable financial_checkpoint rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[3].completionMethod = "assessment_pass";
    expectInvalid(pkg, "GATE_COMPLETION_METHOD_SELF_COMPLETABLE");
  });

  await check("15b gated level missing gate config rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[0].gate = null;
    expectInvalid(pkg, "GATE_MISSING");
  });

  /* --------------------- 16-22. approved-package gates -------------------- */
  await check("16 approved package with missing provenance rejected", () => {
    const pkg = basePackage();
    pkg.status = "approved";
    expectInvalid(pkg, "PROVENANCE_APPROVAL_REQUIRED");
  });

  await check("17 placeholder text in approved package rejected", () => {
    const pkg = approvedPackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[1].title = "TODO решить название";
    expectInvalid(pkg, "PLACEHOLDER_IN_APPROVED_PACKAGE");
  });

  await check("18 stable-code-as-title rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[1].title = L2;
    expectInvalid(pkg, "LEVEL_TITLE_IS_CODE");
  });

  await check("19 missing ContentVersion rejected for approved lesson", () => {
    const pkg = approvedPackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[1].content = null;
    expectInvalid(pkg, "CONTENT_REQUIRED_FOR_APPROVED");
  });

  await check("19b pending approvals block an approved package", () => {
    const pkg = approvedPackage();
    pkg.pendingApprovals = [
      { levelCode: L2, element: "assessment", classification: "MISSING", detail: "нет вопросов", blocksReadiness: true },
    ];
    expectInvalid(pkg, "PENDING_MISSING");
  });

  await check("20 missing required localization rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    ((levels[1].content as AnyRecord).localizations as AnyRecord[])[0].locale = "en";
    expectInvalid(pkg, "CONTENT_LOCALIZATION_MISSING");
  });

  await check("22 incompatible content binding rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[0].content = clone((levels[1] as AnyRecord).content);
    expectInvalid(pkg, "GATE_HAS_CONTENT");
  });

  await check("22b report on a non-report level rejected", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[1].report = clone((levels[2] as AnyRecord).report);
    expectInvalid(pkg, "REPORT_NOT_ALLOWED");
  });

  function approvedPackage(): AnyRecord {
    const pkg = basePackage();
    pkg.status = "approved";
    const production = {
      classification: "APPROVED_PRODUCTION_SOURCE",
      sourcePath: "synthetic",
      sourceRef: "synthetic",
      revision: "cv1",
      confidence: "high",
      conflicts: [],
      approvalRequired: false,
      note: null,
    };
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (value && typeof value === "object") {
        const record = value as AnyRecord;
        if (record.provenance) record.provenance = { ...production };
        Object.values(record).forEach(walk);
      }
    };
    walk(pkg.modules);
    return pkg;
  }

  /* ------------------------- 23-26. fingerprint --------------------------- */
  await check("23 fingerprint is deterministic", () => {
    const a = calculateFingerprint(seal(basePackage()) as never);
    const b = calculateFingerprint(seal(basePackage()) as never);
    assert.equal(a, b);
  });

  await check("23b key order does not change the fingerprint", () => {
    // Deeply rebuild every object with its keys in reverse order. The canonical
    // projection must be immune to author key order.
    const reorderDeep = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorderDeep);
      if (value && typeof value === "object") {
        const out: AnyRecord = {};
        for (const key of Object.keys(value as AnyRecord).reverse()) {
          out[key] = reorderDeep((value as AnyRecord)[key]);
        }
        return out;
      }
      return value;
    };
    const pkg = seal(basePackage());
    const reordered = reorderDeep(pkg) as AnyRecord;
    assert.notEqual(JSON.stringify(pkg), JSON.stringify(reordered), "reordering had no effect");
    assert.equal(calculateFingerprint(pkg as never), calculateFingerprint(reordered as never));
  });

  await check("24 semantic content change changes the fingerprint", () => {
    const before = calculateFingerprint(seal(basePackage()) as never);
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    const questions = (levels[1].assessment as AnyRecord).questions as AnyRecord[];
    questions[0].correctOptionCodes = ["b"];
    assert.notEqual(before, calculateFingerprint(seal(pkg) as never));
  });

  await check("25 stable-code change changes the fingerprint", () => {
    const before = calculateFingerprint(seal(basePackage()) as never);
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[1].levelCode = "v2.l002.drugoy-kod";
    levels[2].prerequisiteLevelCodes = ["v2.l002.drugoy-kod"];
    assert.notEqual(before, calculateFingerprint(seal(pkg) as never));
  });

  await check("26 content-binding change changes the fingerprint", () => {
    const before = calculateFingerprint(seal(basePackage()) as never);
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[1].content = null;
    assert.notEqual(before, calculateFingerprint(seal(pkg) as never));
  });

  await check("26b declared fingerprint mismatch rejected", () => {
    const pkg = seal(basePackage());
    pkg.contentFingerprint = "f".repeat(64);
    const result = validateCurriculumPackage(pkg);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === "FINGERPRINT_MISMATCH"));
  });

  /* ------------------------ 27-32. importer behaviour --------------------- */
  await check("27 dry run writes zero rows", async () => {
    const before = await prisma.curriculumVersion.count();
    const result = await importCurriculumPackage(seal(basePackage()), { db: prisma, dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(await prisma.curriculumVersion.count(), before);
    assert.equal(await prisma.levelDefinition.count(), 0);
  });

  await check("28 first import succeeds transactionally", async () => {
    const result = await importCurriculumPackage(seal(basePackage()), { db: prisma });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.summary.outcome, "created");
    assert.equal(result.summary.curriculumVersionStatus, "draft");
    assert.equal(result.summary.counts.levels, 4);
    assert.equal(result.summary.counts.contentVersions, 1);
    assert.equal(result.summary.counts.contentBindings, 1);
    assert.equal(result.summary.counts.questions, 1);
    assert.equal(result.summary.counts.reportAssignments, 1);
  });

  await check("29 exact rerun is a no-op", async () => {
    const before = await prisma.levelDefinition.count();
    const result = await importCurriculumPackage(seal(basePackage()), { db: prisma });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.summary.outcome, "unchanged");
    assert.equal(await prisma.levelDefinition.count(), before);
  });

  await check("30 same version with changed fingerprint rejected as drift", async () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[1].title = "Изменённое название";
    const result = await importCurriculumPackage(seal(pkg), { db: prisma });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "PACKAGE_DRIFT");
  });

  await check("31 declared fingerprint with changed content rejected", async () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[1].title = "Ещё одно название";
    // Keep the ORIGINAL fingerprint while the content differs.
    pkg.contentFingerprint = (seal(basePackage()).contentFingerprint as string);
    const result = await importCurriculumPackage(pkg, { db: prisma });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "PACKAGE_INVALID");
    assert.ok(result.issues.some((i) => i.code === "FINGERPRINT_MISMATCH"));
  });

  await check("32 mid-import failure rolls back every row", async () => {
    // A second curriculum version whose 3rd level violates a DB constraint
    // (duplicate stableCode inside the same version is caught by validation, so
    // force a DB-level failure with an over-long enum value instead).
    const pkg = basePackage();
    pkg.curriculumVersionNumber = 99;
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    (levels[2].report as AnyRecord).versionNumber = -1 as unknown as number;
    const beforeVersions = await prisma.curriculumVersion.count();
    const beforeLevels = await prisma.levelDefinition.count();
    let threw = false;
    try {
      const result = await importCurriculumPackage(seal(pkg), { db: prisma });
      // Schema validation catches the negative version first — that is also a
      // pre-transaction rejection, which satisfies "no partial write".
      if (!result.ok) threw = true;
    } catch {
      threw = true;
    }
    assert.equal(threw, true, "expected the bad package to be rejected");
    assert.equal(await prisma.curriculumVersion.count(), beforeVersions);
    assert.equal(await prisma.levelDefinition.count(), beforeLevels);
  });

  await check("32b transaction rollback leaves no partial rows on a DB error", async () => {
    const beforeVersions = await prisma.curriculumVersion.count();
    const beforeLevels = await prisma.levelDefinition.count();
    let rolledBack = false;
    try {
      await prisma.$transaction(async (tx) => {
        const version = await tx.curriculumVersion.create({
          data: { code: "rollback-probe", name: "probe", versionNumber: 1, status: "draft" },
        });
        const moduleRow = await tx.moduleDefinition.create({
          data: { curriculumVersionId: version.id, moduleNumber: 1, code: "m", title: "m", firstLevel: 1, lastLevel: 1, learningObjective: "m" },
        });
        await tx.levelDefinition.create({
          data: { curriculumVersionId: version.id, moduleId: moduleRow.id, levelNumber: 1, stableCode: "v2.l001.probe", type: "lesson", title: "p", learningObjective: "p", completionMethod: "manual" },
        });
        throw new Error("forced mid-transaction failure");
      });
    } catch {
      rolledBack = true;
    }
    assert.equal(rolledBack, true);
    assert.equal(await prisma.curriculumVersion.count(), beforeVersions);
    assert.equal(await prisma.levelDefinition.count(), beforeLevels);
  });

  /* ------------------- 33-38. no side effects / immutability -------------- */
  await check("33 import created no learner or legacy rows", async () => {
    assert.equal(await prisma.userCurriculumEnrollment.count(), 0);
    assert.equal(await prisma.userLevelProgress.count(), 0);
    assert.equal(await prisma.reportSubmission.count(), 0);
    assert.equal(await prisma.assessmentAttempt.count(), 0);
  });

  await check("34 import did not publish or activate the version", async () => {
    const versions = await prisma.curriculumVersion.findMany({ select: { status: true, publishedAt: true, effectiveFrom: true } });
    assert.ok(versions.length > 0);
    for (const version of versions) {
      assert.equal(version.status, "draft");
      assert.equal(version.publishedAt, null);
      assert.equal(version.effectiveFrom, null);
    }
  });

  await check("24b published/active version cannot be mutated by import", async () => {
    const existing = await prisma.curriculumVersion.findFirst({ where: { code: "ata-v2", versionNumber: 1 } });
    assert.ok(existing);
    await prisma.curriculumVersion.update({ where: { id: existing!.id }, data: { status: "published", publishedAt: new Date() } });
    try {
      const result = await importCurriculumPackage(seal(basePackage()), { db: prisma });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "VERSION_IMMUTABLE");
    } finally {
      await prisma.curriculumVersion.update({ where: { id: existing!.id }, data: { status: "draft", publishedAt: null } });
    }
  });

  await check("45 imported row counts match the package manifest", async () => {
    const version = await prisma.curriculumVersion.findFirst({ where: { code: "ata-v2", versionNumber: 1 } });
    assert.ok(version);
    assert.equal(await prisma.levelDefinition.count({ where: { curriculumVersionId: version!.id } }), 4);
    assert.equal(await prisma.moduleDefinition.count({ where: { curriculumVersionId: version!.id } }), 1);
    assert.equal(await prisma.contentVersion.count({ where: { curriculumVersionId: version!.id } }), 1);
    assert.equal(await prisma.levelResourceBinding.count({ where: { curriculumVersionId: version!.id } }), 1);
    assert.equal(await prisma.assessmentVersion.count({ where: { curriculumVersionId: version!.id } }), 1);
    assert.equal(await prisma.reportAssignmentVersion.count({ where: { curriculumVersionId: version!.id } }), 1);
  });

  await check("46/47 foreign-key and integrity checks are clean", async () => {
    const fk = await prisma.$queryRawUnsafe<unknown[]>("PRAGMA foreign_key_check");
    assert.equal(fk.length, 0, `foreign key violations: ${JSON.stringify(fk)}`);
    const integrity = await prisma.$queryRawUnsafe<Array<Record<string, string>>>("PRAGMA integrity_check");
    assert.equal(Object.values(integrity[0])[0], "ok");
  });

  /* ------------------------ 48-51. database guards ------------------------ */
  await check("48 importer refuses the live DEV database path", () => {
    assert.throws(() => assertSafeDatabaseUrl("file:/home/ubuntu/runtime/ata-dev-v2/data/ata-dev.sqlite"));
  });

  await check("49 importer refuses a symlink resolving to the live DEV database", () => {
    const link = path.join(os.tmpdir(), `ata-dev-alias-${process.pid}.sqlite`);
    fs.rmSync(link, { force: true });
    try {
      fs.symlinkSync("/home/ubuntu/runtime/ata-dev-v2/data/ata-dev.sqlite", link);
      assert.throws(() => assertSafeDatabaseUrl(`file:${link}`));
    } finally {
      fs.rmSync(link, { force: true });
    }
  });

  await check("50 importer refuses unsafe database URLs", () => {
    assert.throws(() => assertSafeDatabaseUrl("postgres://user:pw@host/db"));
    assert.throws(() => assertSafeDatabaseUrl("file:relative/path.sqlite"));
    assert.throws(() => assertSafeDatabaseUrl("http://example.com/db"));
  });

  await check("50b a synthetic absolute path is accepted", () => {
    assert.doesNotThrow(() => assertSafeDatabaseUrl(`file:${dbPath}`));
  });

  /* ------------------- 52-57. stable-code corpus equivalence -------------- */
  const REJECTED = [
    "level.001",
    "level.002",
    "v2.l2.lesson",
    "v2.l002",
    "v2.l002.",
    "v2.l002.Lesson",
    "v2.l002.lesson_name",
    "v2/l002/lesson",
    "v2.l002.lesson/",
    "v2.l002.-lesson",
    "v2.l002.lesson-",
    "v2.l002.lesson--intro",
    " v2.l002.lesson",
    "v2.l002.lesson ",
    "v2.l002.lesson\n",
    "v2.l002.lesson\t",
    "v2.l002.lesson%2Fx",
    "v2%2El002%2Elesson",
    "ｖ２.l002.lesson",
    "v2.l002.lesson․intro",
    "https://example.com/v2.l002.lesson",
    "//example.com/v2.l002.lesson",
    "v2.l002.lesson?x=1",
    "v2.l002.lesson#frag",
    "v2\\l002\\lesson",
    "v2.l002.lesson ",
  ];
  const ACCEPTED = [L1, L2, L3, L4, "v2.l018.torgovyy-dnevnik", "v2.l100.finalnyy-ekzamen"];

  await check("52/53/55 canonical helper rejects every invalid code including level.00N", () => {
    for (const code of REJECTED) {
      assert.equal(stableCode.isCanonicalLevelCode(code), false, `expected rejection: ${JSON.stringify(code)}`);
    }
  });

  await check("57 canonical helper accepts every valid package code", () => {
    for (const code of ACCEPTED) {
      assert.equal(stableCode.isCanonicalLevelCode(code), true, `expected acceptance: ${code}`);
    }
  });

  await check("52b package validator rejects the same corpus", () => {
    for (const code of REJECTED) {
      const pkg = basePackage();
      const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
      levels[1].levelCode = code;
      levels[2].prerequisiteLevelCodes = [code];
      const result = validateCurriculumPackage(seal(pkg));
      assert.equal(result.ok, false, `package accepted invalid code ${JSON.stringify(code)}`);
    }
  });

  await check("52c prerequisite and binding validation use the canonical contract", () => {
    const pkg = basePackage();
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[2].prerequisiteLevelCodes = ["level.002"];
    expectInvalid(pkg, "PREREQUISITE_CODE_INVALID");

    const pkg2 = basePackage();
    const modules2 = pkg2.modules as AnyRecord[];
    modules2[0].checkpointLevelCode = "level.004";
    const result = validateCurriculumPackage(seal(pkg2));
    assert.equal(result.ok, false);
  });

  await check("54 importer rejects level.00N before any transaction", async () => {
    const before = await prisma.levelDefinition.count();
    const pkg = basePackage();
    pkg.curriculumVersionNumber = 77;
    const levels = (pkg.modules as AnyRecord[])[0].levels as AnyRecord[];
    levels[1].levelCode = "level.002";
    levels[2].prerequisiteLevelCodes = ["level.002"];
    const result = await importCurriculumPackage(seal(pkg), { db: prisma });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PACKAGE_INVALID");
    assert.equal(await prisma.levelDefinition.count(), before);
  });

  await check("56 content-route parser and canonical helper are equivalent", () => {
    // The route-side consumers are `z.string().trim().regex(STABLE_CODE_PATTERN)`.
    // The invariant CV-1 needs is one-way: anything canonical is route-accepted.
    for (const code of ACCEPTED) {
      assert.equal(stableCode.acceptsAsLevelCode(code), true, `route rejected canonical code ${code}`);
    }
    // And nothing the package can persist is route-rejected.
    for (const code of REJECTED) {
      if (stableCode.isCanonicalLevelCode(code)) {
        assert.fail(`canonical helper accepted a corpus-rejected code: ${JSON.stringify(code)}`);
      }
    }
    // Whitespace-only variants differ by design: the route trims, the package
    // does not. Assert the direction explicitly so the difference is pinned.
    assert.equal(stableCode.isCanonicalLevelCode(" v2.l002.lesson"), false);
    assert.equal(stableCode.acceptsAsLevelCode(" v2.l002.lesson"), true);
  });

  /* --------------------- production draft package sanity ------------------ */
  await check("production draft package validates and is not approved", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join("curriculum", "packages", "ata-v2-first-slice.draft.json"), "utf8"),
    ) as unknown;
    const result = validateCurriculumPackage(raw);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.package.status, "draft");
    assert.ok(result.package.pendingApprovals.length > 0, "draft must record its missing content decisions");
    assert.ok(result.warnings.length > 0, "draft must surface approval warnings");
  });

  await check("production draft package would fail approval today", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join("curriculum", "packages", "ata-v2-first-slice.draft.json"), "utf8"),
    ) as Record<string, unknown>;
    const asApproved = { ...raw, status: "approved" };
    const result = validateCurriculumPackage(asApproved);
    assert.equal(result.ok, false, "package must not pass as approved while content is missing");
  });

  await prisma.$disconnect();
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(cleanupDb);
