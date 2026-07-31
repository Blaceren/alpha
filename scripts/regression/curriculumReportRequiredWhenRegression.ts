/**
 * RC-1 — conditional report-field requiredness (`requiredWhen`).
 *
 * Runs against a synthetic SQLite database only. Covers the RC-1 test matrix:
 *   A. unit    — parser, cross-field validator, coercion-free evaluator;
 *   B. package — schema/validator/fingerprint/importer;
 *   C. service — learner DTO exposure, draft permissiveness, server-side final
 *                submission enforcement, lifecycle/progression safety, fail-closed;
 *   D. migration — additive column, existing rows default to no condition.
 *
 * No live DEV port is ever contacted; every fixture is SYNTHETIC_TEST_ONLY.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { isReportDomainError } from "../../src/lib/curriculum/report-errors";
import type { RequiredWhen, RequiredWhenFieldRef } from "../../src/lib/curriculum/report-required-when";
import { EXPECTED_MIGRATION_COUNT } from "./support/migrationCount";

const dbPath = `/tmp/ata-curriculum-required-when-${process.pid}.db`;
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

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

type AnyRecord = Record<string, unknown>;

/* ------------------------------------------------------------------ *
 * SYNTHETIC_TEST_ONLY package with one conditional report field
 * ------------------------------------------------------------------ */
const SYNTHETIC = {
  classification: "SYNTHETIC_TEST_ONLY" as const,
  sourcePath: "scripts/regression/curriculumReportRequiredWhenRegression.ts",
  sourceRef: "SYNTHETIC_TEST_ONLY", revision: "rc1", confidence: "high" as const,
  conflicts: [] as string[], approvalRequired: true, note: "SYNTHETIC_TEST_ONLY — not curriculum content",
};
const L1 = "v2.l001.rc1-external";
const L2 = "v2.l002.rc1-lesson";
const L3 = "v2.l003.rc1-report";
const L4 = "v2.l004.rc1-checkpoint";

function reportFields(withRequiredWhen: boolean) {
  const dependent: AnyRecord = {
    stableKey: "deviation-note", type: "long_text", required: false, sortOrder: 2,
    minLength: 20, maxLength: 300, choiceCodes: [],
    localizations: [{ locale: "ru", label: "Отклонение", helpText: "", placeholder: "", choiceLabels: [] }],
  };
  if (withRequiredWhen) dependent.requiredWhen = { fieldCode: "plan-followed", operator: "equals", value: false };
  return [
    {
      stableKey: "confirm-demo-only", type: "boolean", required: true, sortOrder: 0,
      minLength: null, maxLength: null, choiceCodes: [],
      localizations: [{ locale: "ru", label: "Demo-only", helpText: "", placeholder: "", choiceLabels: [] }],
    },
    {
      stableKey: "plan-followed", type: "boolean", required: true, sortOrder: 1,
      minLength: null, maxLength: null, choiceCodes: [],
      localizations: [{ locale: "ru", label: "План соблюдён", helpText: "", placeholder: "", choiceLabels: [] }],
    },
    dependent,
  ];
}

function basePackage(withRequiredWhen = true): AnyRecord {
  const gate = (source: string, code: string) => ({
    completionSource: source, integrationCode: code, selfCompletable: false,
    blockedExplanation: [{ locale: "ru", text: "Подтверждается внешней системой." }], provenance: { ...SYNTHETIC },
  });
  return {
    schemaVersion: "ata.curriculum.package/1", minImporterVersion: 1,
    packageCode: "synthetic.rc1", packageRevision: 1, status: "draft",
    curriculumCode: "rc1-pkg", curriculumVersionNumber: 1,
    curriculumTitle: "Синтетический курс", curriculumDescription: "SYNTHETIC_TEST_ONLY", locale: "ru",
    createdFrom: "SYNTHETIC_TEST_ONLY", approval: { approvedBy: null, approvedAt: null, note: "SYNTHETIC_TEST_ONLY" },
    pendingApprovals: [], contentFingerprint: "0".repeat(64),
    modules: [{
      moduleCode: "module.01", moduleNumber: 1, title: "M", description: "SYNTHETIC_TEST_ONLY",
      learningObjective: "Цель", checkpointLevelCode: L4,
      levels: [
        { levelCode: L1, levelNumber: 1, type: "external_event", title: "Внешний", shortDescription: "",
          learningObjective: "Шаг", completionMethod: "pocket_postback", xpReward: 0, requiredXp: 0,
          prerequisiteLevelCodes: [], checkpointLevelCode: null, estimatedDurationSeconds: null,
          content: null, assessment: null, report: null, gate: gate("external_event", "pocket.registration"), provenance: { ...SYNTHETIC } },
        { levelCode: L2, levelNumber: 2, type: "lesson", title: "Урок", shortDescription: "",
          learningObjective: "Понять", completionMethod: "assessment_pass", xpReward: 0, requiredXp: 0,
          prerequisiteLevelCodes: [L1], checkpointLevelCode: null, estimatedDurationSeconds: null,
          content: {
            contentCode: "synthetic.l002.content", versionNumber: 1, status: "published", videoDurationSeconds: null,
            localizations: [{ locale: "ru", title: "Материал", subtitle: "", learningObjectiveExtension: "", summary: "",
              transcript: null, body: { sections: [{ code: "intro", title: "Раздел", body: "Тело." }], examples: [],
              commonMistakes: [], glossary: [], nextAction: { label: "Дальше", body: "К тесту." }, riskDisclaimer: "XP не деньги." } }],
            assets: [], provenance: { ...SYNTHETIC },
          },
          assessment: null, report: null, gate: null, provenance: { ...SYNTHETIC } },
        { levelCode: L3, levelNumber: 3, type: "report", title: "Отчёт", shortDescription: "",
          learningObjective: "Отчёт", completionMethod: "report_approval", xpReward: 0, requiredXp: 0,
          prerequisiteLevelCodes: [L2], checkpointLevelCode: null, estimatedDurationSeconds: null,
          content: null, assessment: null,
          report: {
            reportCode: "synthetic.l003.report", versionNumber: 1, status: "published",
            localizations: [{ locale: "ru", title: "Отчёт", instructions: "Задание.", successCriteriaSummary: "", submitLabel: "" }],
            fields: reportFields(withRequiredWhen),
            attachmentsAllowed: false, maxAttachments: 0, draftAllowed: true, mentorReviewRequired: true, provenance: { ...SYNTHETIC },
          },
          gate: null, provenance: { ...SYNTHETIC } },
        { levelCode: L4, levelNumber: 4, type: "financial_checkpoint", title: "Точка", shortDescription: "",
          learningObjective: "Баланс", completionMethod: "balance_check", xpReward: 0, requiredXp: 0,
          prerequisiteLevelCodes: [L3], checkpointLevelCode: null, estimatedDurationSeconds: null,
          content: null, assessment: null, report: null, gate: gate("financial_checkpoint", "checkpoint.module-01"), provenance: { ...SYNTHETIC } },
      ],
    }],
  };
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }

async function main() {
  cleanup();
  const migration = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8",
  });
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
  process.env.DATABASE_URL = dbUrl;
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_REPORT_ENABLED = "true";

  const rw = await import("../../src/lib/curriculum/report-required-when");
  const { validateCurriculumPackage } = await import("../../src/lib/curriculum/package/validate");
  const { calculateFingerprint } = await import("../../src/lib/curriculum/package/fingerprint");
  const { importCurriculumPackage } = await import("../../src/lib/curriculum/package/import");
  const { prisma } = await import("../../src/lib/prisma");
  const runtime = await import("../../src/lib/curriculum/report-submission");

  function seal(pkg: AnyRecord): AnyRecord {
    const withPlaceholder = { ...pkg, contentFingerprint: "0".repeat(64) };
    const parsed = validateCurriculumPackage(withPlaceholder);
    const fingerprint = parsed.ok ? parsed.fingerprint : calculateFingerprint(withPlaceholder as never);
    return { ...pkg, contentFingerprint: fingerprint };
  }
  function expectInvalid(pkg: AnyRecord, code: string) {
    const result = validateCurriculumPackage(seal(pkg));
    assert.equal(result.ok, false, `expected ${code}, package validated`);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === code), `expected ${code}, got ${result.issues.map((i) => i.code).join(",")}`);
  }
  const reportFieldsOf = (pkg: AnyRecord) => ((pkg.modules as AnyRecord[])[0].levels as AnyRecord[])[2].report as AnyRecord;
  const dependentOf = (pkg: AnyRecord) => (reportFieldsOf(pkg).fields as AnyRecord[])[2];

  /* ============================ A. UNIT ============================ */
  const boolCtrl: RequiredWhenFieldRef = { stableKey: "plan-followed", type: "boolean", sortOrder: 1, required: true, choiceCodes: null };
  const dep: RequiredWhenFieldRef = { stableKey: "deviation-note", type: "long_text", sortOrder: 2, required: false, choiceCodes: null };
  const fieldMap = new Map([[boolCtrl.stableKey, boolCtrl], [dep.stableKey, dep]]);
  const rule = (over: Partial<RequiredWhen> = {}): RequiredWhen => ({ fieldCode: "plan-followed", operator: "equals", value: false, ...over });

  await check("A1 static required field parses with no condition", () => {
    assert.deepEqual(rw.parseRequiredWhen(null), { ok: true, rule: null });
    assert.deepEqual(rw.parseRequiredWhen(undefined), { ok: true, rule: null });
  });
  await check("A2 valid boolean equals condition validates", () => {
    assert.equal(rw.validateRequiredWhen(rule(), dep, fieldMap), null);
  });
  await check("A3 required:true + requiredWhen rejected", () => {
    assert.equal(rw.validateRequiredWhen(rule(), { ...dep, required: true }, fieldMap)?.code, "REQUIRED_WHEN_CONFLICT");
  });
  await check("A4 unsupported operator rejected at parse", () => {
    assert.equal(rw.parseRequiredWhen({ fieldCode: "plan-followed", operator: "notEquals", value: false }).ok, false);
  });
  await check("A5 self-reference rejected", () => {
    assert.equal(rw.validateRequiredWhen(rule({ fieldCode: "deviation-note" }), dep, fieldMap)?.code, "REQUIRED_WHEN_SELF");
  });
  await check("A6 missing controller rejected", () => {
    assert.equal(rw.validateRequiredWhen(rule({ fieldCode: "nope" }), dep, fieldMap)?.code, "REQUIRED_WHEN_CONTROLLER_MISSING");
  });
  await check("A7 controller must precede dependent", () => {
    const late = new Map([[boolCtrl.stableKey, { ...boolCtrl, sortOrder: 5 }], [dep.stableKey, dep]]);
    assert.equal(rw.validateRequiredWhen(rule(), dep, late)?.code, "REQUIRED_WHEN_ORDER");
  });
  await check("A8 incompatible boolean/string comparison rejected", () => {
    assert.equal(rw.validateRequiredWhen(rule({ value: "false" }), dep, fieldMap)?.code, "REQUIRED_WHEN_TYPE");
  });
  await check("A9 malformed condition (unknown key / non-finite) rejected", () => {
    assert.equal(rw.parseRequiredWhen({ fieldCode: "plan-followed", operator: "equals", value: false, extra: 1 }).ok, false);
    assert.equal(rw.parseRequiredWhen({ fieldCode: "plan-followed", operator: "equals", value: Infinity }).ok, false);
  });
  await check("A10 prototype-pollution controller key rejected", () => {
    assert.equal(rw.parseRequiredWhen({ fieldCode: "__proto__", operator: "equals", value: false }).ok, false);
    assert.equal(rw.isRequiredWhenActive(rule({ fieldCode: "__proto__" }), {}), false);
  });
  await check("A11 evaluator: false active, true inactive, missing inactive, no coercion", () => {
    assert.equal(rw.isRequiredWhenActive(rule(), { "plan-followed": false }), true);
    assert.equal(rw.isRequiredWhenActive(rule(), { "plan-followed": true }), false);
    assert.equal(rw.isRequiredWhenActive(rule(), {}), false, "missing controller must not activate");
    assert.equal(rw.isRequiredWhenActive(rule(), { "plan-followed": "false" }), false, "string 'false' must not equal boolean false");
    assert.equal(rw.isRequiredWhenActive(rule({ value: 0 }), { "plan-followed": 0 }), true);
    assert.equal(rw.isRequiredWhenActive(rule({ value: 0 }), { "plan-followed": "0" }), false, "'0' must not equal 0");
  });

  /* ============================ B. PACKAGE ============================ */
  await check("B11 approved conditional field validates in a package", () => {
    const result = validateCurriculumPackage(seal(basePackage(true)));
    assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.issues));
  });
  await check("B11b package rejects required:true + requiredWhen", () => {
    const pkg = basePackage(true); (dependentOf(pkg) as AnyRecord).required = true;
    expectInvalid(pkg, "REPORT_FIELD_REQUIRED_WHEN_CONFLICT");
  });
  await check("B11c package rejects self / missing / late / type-incompatible controller", () => {
    let pkg = basePackage(true); (dependentOf(pkg).requiredWhen as AnyRecord).fieldCode = "deviation-note";
    expectInvalid(pkg, "REPORT_FIELD_REQUIRED_WHEN_SELF");
    pkg = basePackage(true); (dependentOf(pkg).requiredWhen as AnyRecord).fieldCode = "ghost";
    expectInvalid(pkg, "REPORT_FIELD_REQUIRED_WHEN_CONTROLLER_MISSING");
    pkg = basePackage(true); (dependentOf(pkg).requiredWhen as AnyRecord).value = "false";
    expectInvalid(pkg, "REPORT_FIELD_REQUIRED_WHEN_TYPE");
    pkg = basePackage(true); (dependentOf(pkg) as AnyRecord).sortOrder = 0; (reportFieldsOf(pkg).fields as AnyRecord[])[0].sortOrder = 2;
    expectInvalid(pkg, "REPORT_FIELD_REQUIRED_WHEN_ORDER");
  });
  await check("B12 requiredWhen is deterministic and part of the fingerprint", () => {
    assert.equal(calculateFingerprint(seal(basePackage(true)) as never), calculateFingerprint(seal(basePackage(true)) as never));
    const withCond = calculateFingerprint(seal(basePackage(true)) as never);
    const withoutCond = calculateFingerprint(seal(basePackage(false)) as never);
    assert.notEqual(withCond, withoutCond, "removing the condition must change the fingerprint");
  });
  await check("B13 changing controller / value changes the fingerprint", () => {
    const before = calculateFingerprint(seal(basePackage(true)) as never);
    const p1 = basePackage(true); (dependentOf(p1).requiredWhen as AnyRecord).value = true;
    // value:true against a boolean controller is still type-valid, so it validates but hashes differently
    assert.notEqual(before, calculateFingerprint(seal(p1) as never));
    const p2 = basePackage(true);
    // add an earlier controller alias to reference; changing fieldCode changes hash
    (reportFieldsOf(p2).fields as AnyRecord[])[0].type = "boolean";
    (dependentOf(p2).requiredWhen as AnyRecord).fieldCode = "confirm-demo-only";
    assert.notEqual(before, calculateFingerprint(seal(p2) as never));
  });
  const importable = () => { const p = clone(basePackage(true)); return seal(p); };
  await check("B14 importer persists requiredWhen; B15 rerun no-op; B17 dry-run zero", async () => {
    const dry = await importCurriculumPackage(importable(), { db: prisma, dryRun: true });
    assert.equal(dry.ok, true);
    assert.equal(await prisma.reportFieldDefinition.count(), 0);
    const first = await importCurriculumPackage(importable(), { db: prisma });
    assert.equal(first.ok, true);
    if (first.ok) assert.ok(first.summary.notes.some((n) => n.includes("conditional report fields (requiredWhen): 1")));
    const stored = await prisma.reportFieldDefinition.findFirstOrThrow({ where: { stableKey: "deviation-note" } });
    assert.deepEqual(stored.requiredWhen, { fieldCode: "plan-followed", operator: "equals", value: false });
    assert.equal(stored.required, false);
    const controller = await prisma.reportFieldDefinition.findFirstOrThrow({ where: { stableKey: "plan-followed" } });
    assert.equal(controller.requiredWhen, null);
    const rerun = await importCurriculumPackage(importable(), { db: prisma });
    assert.equal(rerun.ok && rerun.summary.outcome, "unchanged");
  });
  await check("B16 same revision with changed condition rejected as drift", async () => {
    const pkg = clone(basePackage(true)); (dependentOf(pkg).requiredWhen as AnyRecord).value = true;
    const result = await importCurriculumPackage(seal(pkg), { db: prisma });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PACKAGE_DRIFT");
  });
  await check("B18 forced failure rolls back all rows", async () => {
    const pkg = clone(basePackage(true)); pkg.curriculumVersionNumber = 98;
    (reportFieldsOf(pkg) as AnyRecord).versionNumber = -1 as unknown as number;
    const beforeV = await prisma.curriculumVersion.count();
    const beforeF = await prisma.reportFieldDefinition.count();
    const result = await importCurriculumPackage(seal(pkg), { db: prisma });
    assert.equal(result.ok, false);
    assert.equal(await prisma.curriculumVersion.count(), beforeV);
    assert.equal(await prisma.reportFieldDefinition.count(), beforeF);
  });
  await check("B23 revision-1 CV-1 fingerprint is unchanged by RC-1", () => {
    const raw = JSON.parse(fs.readFileSync(path.join("curriculum", "packages", "ata-v2-first-slice.draft.json"), "utf8")) as never;
    assert.equal(calculateFingerprint({ ...(raw as AnyRecord), contentFingerprint: "0".repeat(64) } as never),
      "4a8fde320fff8e5fb9c46f01415c8189d1c142a52c6c288f25c05cac0d42e229");
  });

  /* ============================ C. SERVICE ============================ */
  // The learner context resolver pins the DEFAULT curriculum code ("ata-v2"), so
  // the service curriculum uses it. One published report level with a boolean
  // controller and a conditional dependent field; two learners exercise the two
  // accept paths independently (a successful submit is terminal per submission).
  const curriculum = await prisma.curriculumVersion.create({ data: { code: "ata-v2", name: "ATA V2", versionNumber: 1, status: "published", publishedAt: new Date("2026-01-01T00:00:00.000Z") } });
  const moduleDef = await prisma.moduleDefinition.create({ data: { curriculumVersionId: curriculum.id, moduleNumber: 1, code: "reports", title: "Reports", firstLevel: 1, lastLevel: 2, learningObjective: "m" } });
  const reportLevel = await prisma.levelDefinition.create({ data: { curriculumVersionId: curriculum.id, moduleId: moduleDef.id, levelNumber: 1, stableCode: "v2.l001.svc-report", type: "report", title: "Report", shortDescription: "", learningObjective: "o", completionMethod: "report_approval" } });
  await prisma.levelDefinition.create({ data: { curriculumVersionId: curriculum.id, moduleId: moduleDef.id, levelNumber: 2, stableCode: "v2.l002.svc-lesson", type: "lesson", title: "Lesson", completionMethod: "lesson", requiredPreviousLevel: 1 } });
  const assignment = await prisma.reportAssignmentVersion.create({ data: { levelDefinitionId: reportLevel.id, curriculumVersionId: curriculum.id, versionNumber: 1, status: "published", publishedAt: new Date("2026-01-02T00:00:00.000Z") } });
  await prisma.reportAssignmentLocalization.create({ data: { reportAssignmentVersionId: assignment.id, locale: "en", title: "A", instructions: "Do it", successCriteriaSummary: "", submitLabel: "Submit" } });
  const confirmField = await prisma.reportFieldDefinition.create({ data: { reportAssignmentVersionId: assignment.id, stableKey: "confirm-demo-only", type: "boolean", required: true, sortOrder: 0, validationRules: { version: 1 }, choiceCodes: Prisma.JsonNull, requiredWhen: Prisma.JsonNull } });
  await prisma.reportFieldLocalization.create({ data: { reportFieldDefinitionId: confirmField.id, locale: "en", label: "Demo", helpText: "", placeholder: "", choiceLabels: Prisma.JsonNull } });
  const planField = await prisma.reportFieldDefinition.create({ data: { reportAssignmentVersionId: assignment.id, stableKey: "plan-followed", type: "boolean", required: true, sortOrder: 1, validationRules: { version: 1 }, choiceCodes: Prisma.JsonNull, requiredWhen: Prisma.JsonNull } });
  await prisma.reportFieldLocalization.create({ data: { reportFieldDefinitionId: planField.id, locale: "en", label: "Plan", helpText: "", placeholder: "", choiceLabels: Prisma.JsonNull } });
  const deviationField = await prisma.reportFieldDefinition.create({ data: { reportAssignmentVersionId: assignment.id, stableKey: "deviation-note", type: "long_text", required: false, sortOrder: 2, validationRules: { version: 1, minLength: 20, maxLength: 300 }, choiceCodes: Prisma.JsonNull, requiredWhen: { fieldCode: "plan-followed", operator: "equals", value: false } } });
  await prisma.reportFieldLocalization.create({ data: { reportFieldDefinitionId: deviationField.id, locale: "en", label: "Deviation", helpText: "", placeholder: "", choiceLabels: Prisma.JsonNull } });
  const rubric = await prisma.reportRubricVersion.create({ data: { reportAssignmentVersionId: assignment.id, versionNumber: 1, status: "published", publishedAt: new Date("2026-01-02T00:00:00.000Z") } });
  const crit = await prisma.reportRubricCriterion.create({ data: { reportRubricVersionId: rubric.id, stableKey: "process", categoryCode: "process", sortOrder: 0, commentRequired: true } });
  await prisma.reportRubricCriterionLocalization.create({ data: { reportRubricCriterionId: crit.id, locale: "en", title: "P", description: "d" } });
  const scale = await prisma.reportRubricScaleOption.create({ data: { reportRubricVersionId: rubric.id, stableKey: "meets", ordinal: 0 } });
  await prisma.reportRubricScaleOptionLocalization.create({ data: { reportRubricScaleOptionId: scale.id, locale: "en", label: "Meets", description: "d" } });
  const reason = await prisma.reportRejectionReason.create({ data: { reportRubricVersionId: rubric.id, stableKey: "missing", sortOrder: 0, active: true } });
  await prisma.reportRejectionReasonLocalization.create({ data: { reportRejectionReasonId: reason.id, locale: "en", title: "Missing", guidance: "g" } });
  await prisma.levelReportBinding.create({ data: { levelDefinitionId: reportLevel.id, curriculumVersionId: curriculum.id, reportAssignmentVersionId: assignment.id, reportRubricVersionId: rubric.id, revision: 0 } });

  let seq = 0;
  const rid = () => `rc1-req-${String(++seq).padStart(4, "0")}`;
  // A fresh enrolled learner per scenario keeps every submission's workflow
  // version deterministic (first save is always expectedRevision 0), so the
  // conditional-validation assertions never fight the concurrency bookkeeping.
  async function enrol() {
    const learner = await prisma.user.create({ data: { email: `rc1-${++seq}@example.com`, name: "RC1" } });
    const enrollment = await prisma.userCurriculumEnrollment.create({ data: { userId: learner.id, curriculumVersionId: curriculum.id, curriculumCode: "ata-v2", status: "active", currentLevel: 1, highestCompletedLevel: 0 } });
    await prisma.userLevelProgress.create({ data: { enrollmentId: enrollment.id, curriculumVersionId: curriculum.id, levelDefinitionId: reportLevel.id, status: "in_progress", startedAt: new Date("2026-01-03T00:00:00.000Z") } });
    return learner.id;
  }
  const baseline = { reviews: await prisma.reportReview.count(), completed: await prisma.userLevelProgress.count({ where: { status: "completed" } }) };
  async function draftThenSubmit(userId: number, values: AnyRecord) {
    const save = await runtime.saveOwnReportDraft(userId, { levelNumber: 1, requestId: rid(), expectedRevision: 0, fieldValues: values });
    return runtime.submitOwnReport(userId, { levelNumber: 1, requestId: rid(), expectedRevision: save.resultingWorkflowVersion });
  }
  async function expectSubmitReject(values: AnyRecord) {
    const userId = await enrol();
    try { await draftThenSubmit(userId, values); }
    catch (error) { if (isReportDomainError(error, "REPORT_DRAFT_INPUT_INVALID")) return error; throw new Error(`unexpected ${String(error)}`); }
    throw new Error("expected REPORT_DRAFT_INPUT_INVALID, submit succeeded");
  }

  await check("C19/20/21 DTO: static fields carry requiredWhen null, conditional carries the safe rule", async () => {
    const ctx = await runtime.resolveOwnReportContext({ actorUserId: await enrol(), levelNumber: 1, locale: "en" });
    assert.equal(ctx.kind, "available");
    if (ctx.kind !== "available") return;
    const fields = ctx.assignment.fields;
    assert.equal(fields.find((f) => f.stableKey === "confirm-demo-only")?.requiredWhen, null);
    assert.equal(fields.find((f) => f.stableKey === "plan-followed")?.requiredWhen, null);
    assert.deepEqual(fields.find((f) => f.stableKey === "deviation-note")?.requiredWhen, { fieldCode: "plan-followed", operator: "equals", value: false });
    // C22 no DB ids leak in the DTO field shape
    for (const f of fields) assert.ok(!("id" in (f as AnyRecord)) && !("reportAssignmentVersionId" in (f as AnyRecord)));
  });
  await check("C24/25 draft save is permissive and does not complete the level", async () => {
    const save = await runtime.saveOwnReportDraft(await enrol(), { levelNumber: 1, requestId: rid(), expectedRevision: 0, fieldValues: { "plan-followed": false } });
    assert.equal(save.created, true);
    assert.equal(await prisma.userLevelProgress.count({ where: { status: "completed" } }), baseline.completed);
  });
  await check("C27 planFollowed=false + no deviationNote -> reject (REQUIRED_WHEN)", async () => {
    const err = await expectSubmitReject({ "confirm-demo-only": true, "plan-followed": false });
    assert.ok(err.issues.some((i) => i.code === "REQUIRED_WHEN" && i.path === "deviation-note"), `issues: ${JSON.stringify(err.issues)}`);
  });
  await check("C28/29/30 false + null/empty/whitespace -> reject", async () => {
    await expectSubmitReject({ "confirm-demo-only": true, "plan-followed": false, "deviation-note": null });
    await expectSubmitReject({ "confirm-demo-only": true, "plan-followed": false, "deviation-note": "" });
    await expectSubmitReject({ "confirm-demo-only": true, "plan-followed": false, "deviation-note": "                     " });
  });
  await check("C31/34 false + 19 chars and + 301 chars -> reject", async () => {
    await expectSubmitReject({ "confirm-demo-only": true, "plan-followed": false, "deviation-note": "x".repeat(19) });
    await expectSubmitReject({ "confirm-demo-only": true, "plan-followed": false, "deviation-note": "x".repeat(301) });
  });
  await check("C38 missing controller -> controller's own required error, not requiredWhen", async () => {
    const err = await expectSubmitReject({ "confirm-demo-only": true, "deviation-note": "x".repeat(30) });
    assert.ok(!err.issues.some((i) => i.code === "REQUIRED_WHEN"), "missing controller must not be reported as a requiredWhen error");
  });
  await check("C40 frontend metadata cannot bypass the condition", async () => {
    // an injected isRequired:false is an unknown field and is rejected outright
    await expectSubmitReject({ "confirm-demo-only": true, "plan-followed": false, isRequired: false } as AnyRecord);
  });
  await check("C32/36 false + valid 20..300 char note -> ACCEPT and follows lifecycle", async () => {
    const result = await draftThenSubmit(await enrol(), { "confirm-demo-only": true, "plan-followed": false, "deviation-note": "x".repeat(25) });
    assert.equal(result.submission.status, "pending_review");
  });
  await check("C35 planFollowed=true + no deviationNote -> ACCEPT (condition inactive)", async () => {
    const result = await draftThenSubmit(await enrol(), { "confirm-demo-only": true, "plan-followed": true });
    assert.equal(result.submission.status, "pending_review");
  });
  await check("C41/42/43 no rejected submission created review / completion / unlock", async () => {
    assert.equal(await prisma.reportReview.count(), baseline.reviews);
    assert.equal(await prisma.userLevelProgress.count({ where: { status: "completed" } }), baseline.completed);
  });
  await check("C23 malformed persisted requiredWhen fails closed (report reads corrupt)", async () => {
    const reader = await enrol();
    // Corrupt the stored rule (unknown operator) and confirm a fresh read fails closed.
    await prisma.$executeRawUnsafe(`UPDATE "ReportFieldDefinition" SET "requiredWhen" = json('{"fieldCode":"plan-followed","operator":"regex","value":".*"}') WHERE "id" = ${deviationField.id}`);
    const ctx = await runtime.resolveOwnReportContext({ actorUserId: reader, levelNumber: 1, locale: "en" });
    assert.equal(ctx.kind, "corrupt", `expected corrupt, got ${ctx.kind}`);
  });

  /* ============================ D. MIGRATION ============================ */
  await check("D46/48 fresh schema at the canonical migration count; old-style rows default to no condition", async () => {
    const applied = (await prisma.$queryRawUnsafe(`SELECT COUNT(*) c FROM _prisma_migrations`) as Array<{ c: number | bigint }>)[0].c;
    // AFD-3B2. The number used to be written out here as 34 and had been failing
    // since the repository passed 34, so it guarded nothing. It now comes from
    // the single canonical owner and is just as strict: an unplanned migration
    // still fails this gate, and the assertion is not weakened to a range.
    assert.equal(Number(applied), EXPECTED_MIGRATION_COUNT);
    const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("ReportFieldDefinition")`) as Array<{ name: string }>;
    assert.ok(cols.some((c) => c.name === "requiredWhen"));
    // Simulate a pre-existing row written by old code (no requiredWhen provided).
    const asg = await prisma.reportAssignmentVersion.findFirstOrThrow();
    await prisma.$executeRawUnsafe(`INSERT INTO "ReportFieldDefinition" ("reportAssignmentVersionId","stableKey","type","required","sortOrder","updatedAt") VALUES (${asg.id}, 'legacy-field', 'short_text', 1, 90, CURRENT_TIMESTAMP)`);
    const legacy = await prisma.reportFieldDefinition.findFirstOrThrow({ where: { stableKey: "legacy-field" } });
    assert.equal(legacy.requiredWhen, null);
    assert.equal(legacy.required, true);
  });
  await check("D50/51 integrity_check ok and foreign_key_check empty", async () => {
    const ic = await prisma.$queryRawUnsafe(`PRAGMA integrity_check`) as Array<Record<string, string>>;
    assert.equal(Object.values(ic[0])[0], "ok");
    const fk = await prisma.$queryRawUnsafe(`PRAGMA foreign_key_check`) as unknown[];
    assert.equal(fk.length, 0);
  });

  await prisma.$disconnect();
}

main()
  .then(() => { console.log(`\n${passed} passed, ${failed} failed`); if (failed > 0) process.exitCode = 1; })
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(cleanup);
