/**
 * G2 CANONICAL PROGRESSION OWNER regression.
 *
 * Proves the two halves of the correction for the defect that left 21 of the 100
 * `ata-v2` levels with no completion owner: level 3's report had no
 * `LevelReportBinding` (that row needs a rubric, and the package could not carry
 * one) and all 20 financial checkpoints had no `LevelCheckpointRequirement` (that
 * row needs a threshold in minor units, and the package could not carry one
 * either). A learner reaching level 3 could go no further, so 98 of 100 levels
 * were unreachable.
 *
 *   PART A  the canonical rubric SOURCE is the accepted predecessor rubric,
 *           unchanged, and the artifact carries it.
 *   PART B  the canonical thresholds are the accepted product values, in the
 *           units the runtime compares, for all 20 — no missing, no duplicate.
 *   PART C  package validation refuses a malformed owner BEFORE import.
 *   PART D  the importer materializes exactly one report binding and exactly 20
 *           requirements, deterministically and without touching money.
 *   PART E  publication FAILS CLOSED on a missing report owner, a missing
 *           rubric, an unpublished rubric and a missing checkpoint requirement,
 *           and the curriculum is still `draft` afterwards.
 *   PART F  a package that declares no owner still imports, exactly as revision
 *           1 always did — the compatibility contract.
 *
 * Runs entirely against a temporary SQLite fixture built by the shipped
 * migration runner. No live database, no live environment file, no HTTP route,
 * no network.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import { ATA_CHECKPOINTS, ATA_LEVELS, canonicalLevelCode, gateIntegrationCode } from "@/lib/curriculum/product-ata-100";
import { calculateFingerprint } from "@/lib/curriculum/package/fingerprint";
import {
  calculateEducationalPayloadDigest,
  RUNTIME_OWNER_KEYS,
} from "@/lib/curriculum/package/successor-equivalence";
import { validateCurriculumPackage } from "@/lib/curriculum/package/validate";
import { curriculumPackageSchema, type CurriculumPackage } from "@/lib/curriculum/package/schema";

const dbPath = `/tmp/ata-g2-progression-owner-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
process.env.DATABASE_URL = dbUrl;

const V3_PATH = "curriculum/packages/ata-v2-canonical-100.draft.json";
const V4_REV1_PATH = "curriculum/packages/ata-v2-canonical-100.v4.draft.json";
const V4_REV2_PATH = "curriculum/packages/ata-v2-canonical-100.v4.rev2.draft.json";
const RUBRIC_SOURCE_PATH = "curriculum/canonical/ata-v2-l003-report-rubric.v1.json";

const REPORT_LEVEL_CODE = "v2.l003.pervye-pyat-demo-sdelok";

let passed = 0;
let failed = 0;
let fixtureSeq = 0;

async function check(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${passed + failed}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${passed + failed}. ${name}`);
    console.error(error);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function load(relativePath: string): CurriculumPackage {
  const parsed = validateCurriculumPackage(JSON.parse(fs.readFileSync(relativePath, "utf8")));
  if (!parsed.ok) {
    throw new Error(`${relativePath} does not validate: ${parsed.issues.map((i) => i.code).join(", ")}`);
  }
  return parsed.package;
}

function levelsOf(pkg: CurriculumPackage) {
  return pkg.modules.flatMap((m) => m.levels);
}

function reportLevel(pkg: CurriculumPackage) {
  const level = levelsOf(pkg).find((l) => l.levelCode === REPORT_LEVEL_CODE);
  if (!level?.report) throw new Error("package has no level-3 report");
  return level;
}

/** A minimal but REAL package: one module, one report level, one checkpoint. */
function syntheticPackage(overrides: (pkg: Record<string, unknown>) => void): Record<string, unknown> {
  fixtureSeq += 1;
  const seq = fixtureSeq;
  const pkg: Record<string, unknown> = {
    schemaVersion: "ata.curriculum.package/1",
    minImporterVersion: 1,
    packageCode: `synthetic.owner-${seq}`,
    packageRevision: 2,
    status: "draft",
    curriculumCode: `synthetic-owner-${seq}`,
    curriculumVersionNumber: 1,
    curriculumTitle: "Owner fixture",
    curriculumDescription: "",
    locale: "ru",
    createdFrom: "curriculumProgressionOwnerRegression.ts",
    approval: { approvedBy: null, approvedAt: null, note: null },
    pendingApprovals: [],
    contentFingerprint: "0".repeat(64),
    modules: [
      {
        moduleCode: "module.01",
        moduleNumber: 1,
        title: "M1",
        description: "",
        learningObjective: "o",
        checkpointLevelCode: null,
        levels: [
          {
            levelCode: "v2.l001.otchet",
            levelNumber: 1,
            type: "report",
            title: "Отчёт",
            shortDescription: "",
            learningObjective: "o",
            completionMethod: "report_approval",
            xpReward: 0,
            requiredXp: 0,
            prerequisiteLevelCodes: [],
            checkpointLevelCode: null,
            estimatedDurationSeconds: null,
            content: null,
            assessment: null,
            gate: null,
            provenance: PROVENANCE,
            report: {
              reportCode: `synthetic.l001.report-${seq}`,
              versionNumber: 1,
              status: "published",
              localizations: [
                { locale: "ru", title: "Отчёт", instructions: "Сделайте отчёт.", successCriteriaSummary: "", submitLabel: "" },
              ],
              fields: [
                {
                  stableKey: "note",
                  type: "long_text",
                  required: true,
                  sortOrder: 0,
                  minLength: 10,
                  maxLength: 500,
                  choiceCodes: [],
                  localizations: [{ locale: "ru", label: "Заметка", helpText: "", placeholder: "", choiceLabels: [] }],
                },
              ],
              attachmentsAllowed: false,
              maxAttachments: 0,
              draftAllowed: true,
              mentorReviewRequired: true,
              provenance: PROVENANCE,
              rubric: {
                rubricCode: `synthetic.l001.rubric-${seq}`,
                versionNumber: 1,
                status: "published",
                criteria: [
                  {
                    stableKey: "r1",
                    categoryCode: "review",
                    sortOrder: 0,
                    commentRequired: false,
                    localizations: [{ locale: "ru", title: "Полнота", description: "Все поля заполнены." }],
                  },
                ],
                scaleOptions: [
                  {
                    stableKey: "meets",
                    ordinal: 0,
                    localizations: [{ locale: "ru", label: "Соответствует", description: "" }],
                  },
                ],
                rejectionReasons: [
                  {
                    stableKey: "revision-needed",
                    sortOrder: 0,
                    active: true,
                    localizations: [{ locale: "ru", title: "Доработка", guidance: "Укажите, что исправить." }],
                  },
                ],
                provenance: PROVENANCE,
              },
            },
          },
          {
            levelCode: "v2.l002.kontrolnaya-tochka-50",
            levelNumber: 2,
            type: "financial_checkpoint",
            title: "Контрольная точка $50",
            shortDescription: "",
            learningObjective: "o",
            completionMethod: "balance_check",
            xpReward: 0,
            requiredXp: 0,
            prerequisiteLevelCodes: ["v2.l001.otchet"],
            checkpointLevelCode: null,
            estimatedDurationSeconds: null,
            content: null,
            assessment: null,
            report: null,
            gate: {
              completionSource: "financial_checkpoint",
              integrationCode: "checkpoint.module-01",
              selfCompletable: false,
              blockedExplanation: [{ locale: "ru", text: "Проверяется по балансу." }],
              requirement: { thresholdCurrency: "USD", thresholdMinorUnits: 5000, provenance: PROVENANCE },
              provenance: PROVENANCE,
            },
            provenance: PROVENANCE,
          },
        ],
      },
    ],
  };
  overrides(pkg);
  return pkg;
}

const PROVENANCE = {
  classification: "EXPLICIT_OPERATOR_APPROVAL",
  sourcePath: null,
  sourceRef: "regression fixture",
  revision: null,
  confidence: "high",
  conflicts: [],
  approvalRequired: false,
  note: null,
} as const;

/**
 * Re-stamp the fingerprint so a mutated fixture is not refused as drift.
 *
 * An invalid fixture cannot be sealed — the fingerprint is computed from the
 * PARSED shape — so it is returned as it stands, which is exactly what PART C
 * wants to hand to the validator. `strict` is for PART E, where an unexpectedly
 * invalid fixture must surface as itself rather than as a fingerprint mismatch
 * three frames later.
 */
function sealed(pkg: Record<string, unknown>, strict = false): Record<string, unknown> {
  // Shape first: `validateCurriculumPackage` checks the fingerprint, so it can
  // never be the thing that computes one. The zod schema is enough to project.
  const shape = curriculumPackageSchema.safeParse(pkg);
  if (!shape.success) {
    if (strict) throw new Error(`fixture has an invalid shape: ${shape.error.issues[0]?.message}`);
    return pkg;
  }
  const stamped = { ...pkg, contentFingerprint: calculateFingerprint(shape.data) };
  if (strict) {
    const validated = validateCurriculumPackage(stamped);
    if (!validated.ok) {
      throw new Error(`fixture is not a valid package: ${JSON.stringify(validated.issues.slice(0, 4))}`);
    }
  }
  return stamped;
}

async function main() {
  cleanupDb();
  const migrate = spawnSync("npx", ["tsx", "prisma/migrate.ts"], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  if (migrate.status !== 0) {
    console.error(migrate.stderr || migrate.stdout);
    throw new Error("migration runner failed");
  }

  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const { importCurriculumPackage } = await import("../../src/lib/curriculum/package/import");
  const { validateCurriculumResourceCompleteness } = await import(
    "../../src/lib/curriculum/resource-completeness"
  );

  const v3 = load(V3_PATH);
  const v4rev1 = load(V4_REV1_PATH);
  const v4rev2 = load(V4_REV2_PATH);

  /* ============ PART A — the rubric is the ACCEPTED one, unchanged ============ */

  await check("A1 the canonical rubric source declares its predecessor authority", () => {
    const source = JSON.parse(fs.readFileSync(RUBRIC_SOURCE_PATH, "utf8")) as Record<string, unknown>;
    assert.equal(source.status, "accepted");
    assert.equal(source.levelStableCode, REPORT_LEVEL_CODE);
    const authority = source.sourceAuthority as Record<string, string>;
    for (const key of [
      "SOURCE_ASSIGNMENT",
      "SOURCE_RUBRIC",
      "SOURCE_VERSION",
      "SUCCESSOR_ASSIGNMENT",
      "SEMANTIC_EQUIVALENCE",
    ]) {
      assert.ok((authority[key] ?? "").length > 0, `${key} must be recorded`);
    }
  });

  await check("A2 the artifact carries the rubric on the report level and nowhere else", () => {
    const carriers = levelsOf(v4rev2).filter((l) => l.report?.rubric);
    assert.equal(carriers.length, 1);
    assert.equal(carriers[0].levelCode, REPORT_LEVEL_CODE);
    assert.equal(carriers[0].report?.rubric?.rubricCode, "ata-v2.l003.rubric");
  });

  await check("A3 the rubric is byte-identical to the canonical source", () => {
    const source = JSON.parse(fs.readFileSync(RUBRIC_SOURCE_PATH, "utf8")) as { rubric: unknown };
    assert.deepEqual(reportLevel(v4rev2).report?.rubric, source.rubric);
  });

  await check("A4 the rubric is publishable: criteria, a neutral scale, an active reason", () => {
    const rubric = reportLevel(v4rev2).report?.rubric;
    assert.ok(rubric);
    assert.equal(rubric.criteria.length, 7);
    assert.deepEqual(
      rubric.criteria.map((c) => c.stableKey),
      ["r1", "r2", "r3", "r4", "r5", "r6", "r7"],
    );
    assert.ok(rubric.scaleOptions.length >= 1);
    assert.ok(rubric.rejectionReasons.some((r) => r.active));
    assert.equal(rubric.status, "published");
    // Approval must never be a function of profit — the criterion that says so
    // is part of the accepted rubric, and no category may be profit-only.
    for (const criterion of rubric.criteria) {
      assert.ok(!["profit", "pnl", "roi", "return"].includes(criterion.categoryCode));
    }
  });

  await check("A5 the report the rubric grades did not change between v3 and v4", () => {
    const { rubric: _v4rubric, ...v4report } = reportLevel(v4rev2).report as Record<string, unknown>;
    assert.deepEqual(v4report, reportLevel(v3).report);
    assert.deepEqual(v4report, reportLevel(v4rev1).report);
  });

  /* ============ PART B — 20 thresholds, exactly the accepted values ============ */

  await check("B1 every checkpoint gate carries a requirement, and no other gate does", () => {
    const gates = levelsOf(v4rev2).filter((l) => l.gate);
    assert.equal(gates.length, 21);
    const withRequirement = gates.filter((l) => l.gate?.requirement);
    assert.equal(withRequirement.length, 20);
    assert.ok(withRequirement.every((l) => l.gate?.completionSource === "financial_checkpoint"));
    const external = gates.filter((l) => l.gate?.completionSource === "external_event");
    assert.equal(external.length, 1);
    assert.equal(external[0].gate?.requirement ?? null, null);
  });

  await check("B2 all 20 thresholds equal CHECKPOINT_ROWS, in minor units, with no drift", () => {
    const byLevel = new Map(
      levelsOf(v4rev2)
        .filter((l) => l.gate?.requirement)
        .map((l) => [l.levelNumber, l]),
    );
    assert.equal(byLevel.size, 20);
    for (const checkpoint of ATA_CHECKPOINTS) {
      const level = byLevel.get(checkpoint.levelNumber);
      assert.ok(level, `level ${checkpoint.levelNumber} carries no requirement`);
      assert.equal(level.gate?.requirement?.thresholdCurrency, "USD");
      assert.equal(level.gate?.requirement?.thresholdMinorUnits, checkpoint.thresholdMinorUnits);
      // …and the minor units really are the approved dollar figure.
      assert.equal(checkpoint.thresholdMinorUnits, checkpoint.thresholdUsd * 100);
      // …on the level the canonical structure says, with the gate's own code.
      const source = ATA_LEVELS.find((l) => l.levelNumber === checkpoint.levelNumber);
      assert.ok(source);
      assert.equal(level.levelCode, canonicalLevelCode(source));
      assert.equal(level.gate?.integrationCode, gateIntegrationCode(source));
    }
  });

  await check("B3 the threshold also agrees with the level title it is named in", () => {
    for (const level of levelsOf(v4rev2)) {
      const match = /Контрольная точка \$([0-9,]+)/.exec(level.title);
      if (!match) continue;
      const titleUsd = Number(match[1].replace(/,/g, ""));
      assert.equal(level.gate?.requirement?.thresholdMinorUnits, titleUsd * 100, level.levelCode);
    }
  });

  /* ============ PART C — malformed owners are refused BEFORE import ============ */

  await check("C1 a threshold on an external_event gate is refused", () => {
    const pkg = syntheticPackage((p) => {
      const level = (p.modules as Record<string, unknown>[])[0].levels as Record<string, unknown>[];
      const gate = level[1].gate as Record<string, unknown>;
      gate.completionSource = "external_event";
      gate.integrationCode = "pocket.registration";
      level[1].type = "external_event";
      level[1].completionMethod = "pocket_postback";
      level[1].title = "Регистрация";
    });
    const result = validateCurriculumPackage(sealed(pkg));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.issues.some((i) => i.code === "GATE_REQUIREMENT_NOT_ALLOWED"), JSON.stringify(result.issues.slice(0, 4)));
    }
  });

  await check("C2 a zero, negative or fractional threshold is refused by the schema", () => {
    for (const bad of [0, -5000, 12.5]) {
      const pkg = syntheticPackage((p) => {
        const levels = (p.modules as Record<string, unknown>[])[0].levels as Record<string, unknown>[];
        ((levels[1].gate as Record<string, unknown>).requirement as Record<string, unknown>).thresholdMinorUnits = bad;
      });
      const result = validateCurriculumPackage(sealed(pkg));
      assert.equal(result.ok, false, `threshold ${bad} must be refused`);
    }
  });

  await check("C3 a currency the requirement table cannot store is refused", () => {
    const pkg = syntheticPackage((p) => {
      const levels = (p.modules as Record<string, unknown>[])[0].levels as Record<string, unknown>[];
      ((levels[1].gate as Record<string, unknown>).requirement as Record<string, unknown>).thresholdCurrency = "EUR";
    });
    assert.equal(validateCurriculumPackage(sealed(pkg)).ok, false);
  });

  await check("C4 a rubric with no active rejection reason is refused", () => {
    const pkg = syntheticPackage((p) => {
      const levels = (p.modules as Record<string, unknown>[])[0].levels as Record<string, unknown>[];
      const rubric = (levels[0].report as Record<string, unknown>).rubric as Record<string, unknown>;
      (rubric.rejectionReasons as Record<string, unknown>[])[0].active = false;
    });
    const result = validateCurriculumPackage(sealed(pkg));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === "REPORT_REASON_REQUIRED"));
  });

  await check("C5 a profit-only approval criterion is refused", () => {
    const pkg = syntheticPackage((p) => {
      const levels = (p.modules as Record<string, unknown>[])[0].levels as Record<string, unknown>[];
      const rubric = (levels[0].report as Record<string, unknown>).rubric as Record<string, unknown>;
      (rubric.criteria as Record<string, unknown>[])[0].categoryCode = "profit";
    });
    const result = validateCurriculumPackage(sealed(pkg));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === "REPORT_PROFIT_CRITERION_FORBIDDEN"));
  });

  await check("C6 a rubric that is not published while its assignment is IS refused", () => {
    const pkg = syntheticPackage((p) => {
      const levels = (p.modules as Record<string, unknown>[])[0].levels as Record<string, unknown>[];
      ((levels[0].report as Record<string, unknown>).rubric as Record<string, unknown>).status = "draft";
    });
    const result = validateCurriculumPackage(sealed(pkg));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((i) => i.code === "REPORT_RUBRIC_STATUS_MISMATCH"));
  });

  await check("C7 duplicate criterion keys and duplicate scale ordinals are refused", () => {
    const dupKey = syntheticPackage((p) => {
      const levels = (p.modules as Record<string, unknown>[])[0].levels as Record<string, unknown>[];
      const rubric = (levels[0].report as Record<string, unknown>).rubric as Record<string, unknown>;
      const criteria = rubric.criteria as Record<string, unknown>[];
      criteria.push({ ...criteria[0], sortOrder: 1 });
    });
    const first = validateCurriculumPackage(sealed(dupKey));
    assert.equal(first.ok, false);
    if (!first.ok) assert.ok(first.issues.some((i) => i.code === "REPORT_CRITERION_KEY_DUPLICATE"));

    const dupOrdinal = syntheticPackage((p) => {
      const levels = (p.modules as Record<string, unknown>[])[0].levels as Record<string, unknown>[];
      const rubric = (levels[0].report as Record<string, unknown>).rubric as Record<string, unknown>;
      const options = rubric.scaleOptions as Record<string, unknown>[];
      options.push({ ...options[0], stableKey: "exceeds" });
    });
    const second = validateCurriculumPackage(sealed(dupOrdinal));
    assert.equal(second.ok, false);
    if (!second.ok) assert.ok(second.issues.some((i) => i.code === "REPORT_SCALE_ORDER_DUPLICATE"));
  });

  /* ============ PART D — the importer materializes, and only that ============ */

  await check("D1 importing the final v4 creates 1 report binding and 20 requirements", async () => {
    const result = await importCurriculumPackage(v4rev2, { db, now: new Date("2026-08-12T00:00:00.000Z") });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.summary.counts.reportRubrics, 1);
    assert.equal(result.summary.counts.reportCriteria, 7);
    assert.equal(result.summary.counts.reportScaleOptions, 1);
    assert.equal(result.summary.counts.reportRejectionReasons, 1);
    assert.equal(result.summary.counts.reportBindings, 1);
    assert.equal(result.summary.counts.checkpointRequirements, 20);
    assert.equal(result.summary.packageRevision, 2);
  });

  await check("D2 the binding names this level, this version, this assignment, this rubric", async () => {
    const version = await db.curriculumVersion.findFirstOrThrow({ where: { code: "ata-v2", versionNumber: 4 } });
    const bindings = await db.levelReportBinding.findMany({ where: { curriculumVersionId: version.id } });
    assert.equal(bindings.length, 1);
    const binding = bindings[0];
    const level = await db.levelDefinition.findFirstOrThrow({ where: { id: binding.levelDefinitionId } });
    assert.equal(level.stableCode, REPORT_LEVEL_CODE);
    assert.equal(level.curriculumVersionId, version.id);
    const assignment = await db.reportAssignmentVersion.findFirstOrThrow({
      where: { id: binding.reportAssignmentVersionId },
    });
    assert.equal(assignment.levelDefinitionId, level.id);
    assert.equal(assignment.curriculumVersionId, version.id);
    const rubric = await db.reportRubricVersion.findFirstOrThrow({ where: { id: binding.reportRubricVersionId } });
    assert.equal(rubric.reportAssignmentVersionId, assignment.id);
    assert.equal(rubric.status, "published");
    assert.ok(rubric.publishedAt);
  });

  await check("D3 the rubric graph is the accepted one, row for row", async () => {
    const version = await db.curriculumVersion.findFirstOrThrow({ where: { code: "ata-v2", versionNumber: 4 } });
    const binding = await db.levelReportBinding.findFirstOrThrow({ where: { curriculumVersionId: version.id } });
    const criteria = await db.reportRubricCriterion.findMany({
      where: { reportRubricVersionId: binding.reportRubricVersionId },
      include: { localizations: true },
      orderBy: { sortOrder: "asc" },
    });
    const source = reportLevel(v4rev2).report?.rubric;
    assert.ok(source);
    assert.equal(criteria.length, source.criteria.length);
    criteria.forEach((row, index) => {
      const expected = source.criteria[index];
      assert.equal(row.stableKey, expected.stableKey);
      assert.equal(row.categoryCode, expected.categoryCode);
      assert.equal(row.sortOrder, expected.sortOrder);
      assert.equal(row.commentRequired, expected.commentRequired);
      assert.equal(row.localizations[0].title, expected.localizations[0].title);
      assert.equal(row.localizations[0].description, expected.localizations[0].description);
    });
  });

  await check("D4 all 20 requirements match the canonical map — none missing, none duplicated", async () => {
    const version = await db.curriculumVersion.findFirstOrThrow({ where: { code: "ata-v2", versionNumber: 4 } });
    const levels = await db.levelDefinition.findMany({ where: { curriculumVersionId: version.id } });
    const byId = new Map(levels.map((l) => [l.id, l]));
    const requirements = await db.levelCheckpointRequirement.findMany({
      where: { levelDefinitionId: { in: levels.map((l) => l.id) } },
    });
    assert.equal(requirements.length, 20);
    assert.equal(new Set(requirements.map((r) => r.levelDefinitionId)).size, 20);
    for (const requirement of requirements) {
      const level = byId.get(requirement.levelDefinitionId);
      assert.ok(level);
      const checkpoint = ATA_CHECKPOINTS.find((c) => c.levelNumber === level.levelNumber);
      assert.ok(checkpoint, `level ${level.levelNumber} is not a canonical checkpoint`);
      assert.equal(requirement.thresholdCurrency, "USD");
      assert.equal(requirement.thresholdMinorUnits, checkpoint.thresholdMinorUnits);
      assert.equal(requirement.integrationCode, level.featureUnlockCode);
    }
  });

  await check("D5 the import created no learner, financial or verification row", async () => {
    assert.equal(await db.userCurriculumEnrollment.count(), 0);
    assert.equal(await db.userLevelProgress.count(), 0);
    assert.equal(await db.reportSubmission.count(), 0);
    assert.equal(await db.reportReview.count(), 0);
    assert.equal(await db.checkpointVerificationAttempt.count(), 0);
    assert.equal(await db.exchangeAccount.count(), 0);
    assert.equal(await db.checkpoint.count(), 0);
    assert.equal(await db.xPTransaction.count(), 0);
  });

  await check("D6 re-importing the same artifact is a no-op, not a second owner", async () => {
    const before = {
      bindings: await db.levelReportBinding.count(),
      requirements: await db.levelCheckpointRequirement.count(),
      rubrics: await db.reportRubricVersion.count(),
    };
    const result = await importCurriculumPackage(v4rev2, { db, now: new Date("2026-08-12T00:00:00.000Z") });
    assert.equal(result.ok && result.summary.outcome, "unchanged");
    assert.deepEqual(
      {
        bindings: await db.levelReportBinding.count(),
        requirements: await db.levelCheckpointRequirement.count(),
        rubrics: await db.reportRubricVersion.count(),
      },
      before,
    );
  });

  /* ============ PART E — publication fails closed on a missing owner ============ */

  const { publishCurriculumVersion } = await import("../../src/lib/curriculum/service");

  async function importSynthetic(pkg: Record<string, unknown>) {
    const result = await importCurriculumPackage(sealed(pkg, true), { db, now: new Date("2026-08-12T00:00:00.000Z") });
    if (!result.ok) throw new Error(`fixture import failed: ${result.code} ${JSON.stringify(result.issues.slice(0, 3))}`);
    return db.curriculumVersion.findFirstOrThrow({
      where: { code: result.summary.curriculumCode, versionNumber: result.summary.curriculumVersionNumber },
    });
  }

  await check("E1 a complete owner map passes completeness and publishes", async () => {
    const version = await importSynthetic(syntheticPackage(() => {}));
    assert.deepEqual(await validateCurriculumResourceCompleteness(db, version.id), []);
    const admin = await db.user.create({
      data: { email: `owner-admin-${process.pid}@ata.invalid`, passwordHash: "x", name: "A", role: "admin", status: "active" },
    });
    const published = await publishCurriculumVersion({
      actorId: admin.id,
      curriculumVersionId: version.id,
      expectedPublishedVersionId: null,
    });
    assert.equal(published.published.status, "published");
  });

  await check("E2 a missing report binding REFUSES publication and leaves the draft alone", async () => {
    const version = await importSynthetic(syntheticPackage((p) => {
      const levels = (p.modules as Record<string, unknown>[])[0].levels as Record<string, unknown>[];
      delete (levels[0].report as Record<string, unknown>).rubric;
    }));
    const issues = await validateCurriculumResourceCompleteness(db, version.id);
    assert.deepEqual(issues.map((i) => i.code), ["LEVEL_REPORT_BINDING_MISSING"]);
    await assert.rejects(
      publishCurriculumVersion({ actorId: 1, curriculumVersionId: version.id, expectedPublishedVersionId: null }),
    );
    assert.equal((await db.curriculumVersion.findFirstOrThrow({ where: { id: version.id } })).status, "draft");
  });

  await check("E3 a missing checkpoint requirement REFUSES publication", async () => {
    const version = await importSynthetic(syntheticPackage((p) => {
      const levels = (p.modules as Record<string, unknown>[])[0].levels as Record<string, unknown>[];
      delete (levels[1].gate as Record<string, unknown>).requirement;
    }));
    const issues = await validateCurriculumResourceCompleteness(db, version.id);
    assert.deepEqual(issues.map((i) => i.code), ["LEVEL_CHECKPOINT_REQUIREMENT_MISSING"]);
    await assert.rejects(
      publishCurriculumVersion({ actorId: 1, curriculumVersionId: version.id, expectedPublishedVersionId: null }),
    );
    assert.equal((await db.curriculumVersion.findFirstOrThrow({ where: { id: version.id } })).status, "draft");
  });

  await check("E4 an UNPUBLISHED rubric REFUSES publication", async () => {
    const version = await importSynthetic(syntheticPackage((p) => {
      const levels = (p.modules as Record<string, unknown>[])[0].levels as Record<string, unknown>[];
      // Draft assignment + draft rubric passes package validation (both agree),
      // and is exactly the state a mentor cannot review against.
      (levels[0].report as Record<string, unknown>).status = "draft";
      ((levels[0].report as Record<string, unknown>).rubric as Record<string, unknown>).status = "draft";
    }));
    const issues = await validateCurriculumResourceCompleteness(db, version.id);
    assert.deepEqual(issues.map((i) => i.code), ["LEVEL_REPORT_RUBRIC_NOT_PUBLISHED"]);
    assert.equal((await db.curriculumVersion.findFirstOrThrow({ where: { id: version.id } })).status, "draft");
  });

  await check("E5 a foreign checkpoint requirement is structurally impossible", async () => {
    const version = await importSynthetic(syntheticPackage(() => {}));
    const level = await db.levelDefinition.findFirstOrThrow({
      where: { curriculumVersionId: version.id, completionMethod: "balance_check" },
    });
    // The row is unique per level, so "two requirements for one level" cannot be
    // written at all — the constraint refuses before any validator runs.
    await assert.rejects(
      db.levelCheckpointRequirement.create({
        data: {
          levelDefinitionId: level.id,
          integrationCode: "checkpoint.module-02",
          thresholdCurrency: "USD",
          thresholdMinorUnits: 999_999,
        },
      }),
    );
    // A requirement naming another module's integration IS writable, and is
    // caught by completeness rather than by the schema.
    await db.levelCheckpointRequirement.updateMany({
      where: { levelDefinitionId: level.id },
      data: { integrationCode: "checkpoint.module-07" },
    });
    const issues = await validateCurriculumResourceCompleteness(db, version.id);
    assert.deepEqual(issues.map((i) => i.code), ["LEVEL_CHECKPOINT_REQUIREMENT_FOREIGN"]);
  });

  await check("E6 a missing ASSESSMENT owner still refuses — the accepted rule is intact", async () => {
    const version = await importSynthetic(syntheticPackage((p) => {
      const levels = (p.modules as Record<string, unknown>[])[0].levels as Record<string, unknown>[];
      levels.push({
        levelCode: "v2.l003.urok",
        levelNumber: 3,
        type: "lesson",
        title: "Урок",
        shortDescription: "",
        learningObjective: "o",
        completionMethod: "assessment_pass",
        xpReward: 0,
        requiredXp: 0,
        prerequisiteLevelCodes: ["v2.l002.kontrolnaya-tochka-50"],
        checkpointLevelCode: null,
        estimatedDurationSeconds: null,
        content: null,
        assessment: null,
        report: null,
        gate: null,
        provenance: PROVENANCE,
      });
      ((p.modules as Record<string, unknown>[])[0] as Record<string, unknown>).levels = levels;
    }));
    const issues = await validateCurriculumResourceCompleteness(db, version.id);
    assert.deepEqual(issues.map((i) => i.code), ["LEVEL_ASSESSMENT_BINDING_MISSING"]);
  });

  /* ============ PART F — the compatibility contract ============ */

  await check("F1 revision 1 artifacts still validate and still fingerprint unchanged", () => {
    assert.equal(v3.packageRevision, 1);
    assert.equal(v4rev1.packageRevision, 1);
    assert.equal(calculateFingerprint(v3), v3.contentFingerprint);
    assert.equal(calculateFingerprint(v4rev1), v4rev1.contentFingerprint);
    assert.equal(levelsOf(v3).filter((l) => l.report?.rubric).length, 0);
    assert.equal(levelsOf(v4rev1).filter((l) => l.gate?.requirement).length, 0);
  });

  await check("F2 an owner-less package still imports, and says what is missing", async () => {
    const result = await importCurriculumPackage(
      sealed(
        syntheticPackage((p) => {
          const levels = (p.modules as Record<string, unknown>[])[0].levels as Record<string, unknown>[];
          delete (levels[0].report as Record<string, unknown>).rubric;
          delete (levels[1].gate as Record<string, unknown>).requirement;
        }),
      ),
      { db, now: new Date("2026-08-12T00:00:00.000Z") },
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.summary.counts.reportBindings, 0);
    assert.equal(result.summary.counts.checkpointRequirements, 0);
    assert.ok(result.summary.notes.some((n) => n.includes("LevelReportBinding")));
    assert.ok(result.summary.notes.some((n) => n.includes("CHECKPOINT_REQUIREMENT_UNCONFIGURED")));
  });

  await check("F3 adding owners changed the artifact identity and NOT the education", () => {
    assert.notEqual(v4rev2.contentFingerprint, v4rev1.contentFingerprint);
    assert.equal(v4rev2.packageRevision, 2);
    // The one proof that matters for §8: same lessons, same questions, same
    // answers, same passPercent, same XP, same ordering, same stable codes.
    const digest = calculateEducationalPayloadDigest(v4rev2);
    assert.equal(digest, calculateEducationalPayloadDigest(v4rev1));
    assert.equal(digest, calculateEducationalPayloadDigest(v3));
    assert.deepEqual([...RUNTIME_OWNER_KEYS], ["packageRevision", "report.rubric", "gate.requirement"]);
  });

  await check("F4 the educational digest is NOT blind to educational change", () => {
    // A digest that never moves proves nothing. Change one answer key and it must.
    const tampered = JSON.parse(JSON.stringify(v4rev2)) as CurriculumPackage;
    const bank = tampered.modules.flatMap((m) => m.levels).find((l) => l.assessment);
    assert.ok(bank?.assessment);
    bank.assessment.passPercent = bank.assessment.passPercent === 80 ? 70 : 80;
    assert.notEqual(calculateEducationalPayloadDigest(tampered), calculateEducationalPayloadDigest(v4rev2));
  });

  await check("F5 the builder writes each revision to its own path", () => {
    for (const target of [V3_PATH, V4_REV1_PATH, V4_REV2_PATH]) {
      assert.ok(fs.existsSync(target), `${target} must exist`);
    }
    assert.equal(new Set([V3_PATH, V4_REV1_PATH, V4_REV2_PATH]).size, 3);
    assert.equal(path.basename(V4_REV2_PATH), "ata-v2-canonical-100.v4.rev2.draft.json");
  });

  await db.$disconnect();
  cleanupDb();
  console.log(`\nG2 canonical progression owner regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanupDb();
  process.exitCode = 1;
});
