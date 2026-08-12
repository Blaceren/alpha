/**
 * Deterministic, transactional, idempotent curriculum package importer.
 *
 * Contract:
 *  - every validation completes BEFORE the transaction opens;
 *  - the whole import is one transaction — any failure rolls back every row;
 *  - re-importing the exact same package is a no-op;
 *  - the same curriculum version with different content is rejected as drift;
 *  - a non-draft (published/archived) version is never mutated;
 *  - nothing is published, activated or enrolled; no learner rows are created;
 *  - legacy (pre-V2) curriculum tables are never touched.
 *
 * The import fingerprint is recorded in `CurriculumVersion.changeNotes` behind a
 * machine marker. That keeps CV-1 free of a Prisma migration while still giving
 * idempotency and drift detection a durable anchor.
 *
 * Report levels: the assignment, its localizations and its fields are always
 * imported. Its `LevelReportBinding` is created if — and ONLY if — the package
 * declares the rubric to bind. The importer still never invents rubric criteria;
 * what changed is that the package can now carry them (revision 2), so the
 * binding is a copy of a declared product decision rather than a fabricated one.
 * A package without a rubric imports exactly as it always did, and leaves a
 * report level with no completion owner — which `resource-completeness.ts` then
 * refuses to publish.
 *
 * Financial checkpoints: the same rule. `LevelCheckpointRequirement` is created
 * from `gate.requirement` when the package declares it, and not at all when it
 * does not. The importer reads no balance, calls no provider and writes no
 * financial event: a requirement is product CONFIGURATION — which threshold, in
 * which currency, for which integration — and verifying a learner against it is
 * the checkpoint engine's job, not the importer's.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { validateCurriculumPackage, type PackageIssue } from "@/lib/curriculum/package/validate";
import {
  expectedTakeIdFor,
  isAtaVideoProfileLevel,
} from "@/lib/curriculum/authoring-level-profile";
import type { CurriculumPackage, PackageQuestion } from "@/lib/curriculum/package/schema";
import { canonicalizeQuestion, localizationIsComplete } from "@/lib/curriculum/assessment-validation";
import {
  isCanonicalAssessmentQuestionKey,
  MAX_ASSESSMENT_QUESTION_KEY_LENGTH,
} from "@/lib/curriculum/stable-code";

export const IMPORTER_VERSION = 1 as const;

const MARKER = "ata-package";

export type ImportOutcome = "created" | "unchanged";

export type ImportSummary = {
  outcome: ImportOutcome;
  packageCode: string;
  packageRevision: number;
  fingerprint: string;
  curriculumCode: string;
  curriculumVersionNumber: number;
  curriculumVersionStatus: string;
  counts: {
    modules: number;
    levels: number;
    contentVersions: number;
    contentLocalizations: number;
    contentAssets: number;
    contentBindings: number;
    assessmentVersions: number;
    assessmentBindings: number;
    questions: number;
    questionLocalizations: number;
    reportAssignments: number;
    reportLocalizations: number;
    reportFields: number;
    reportFieldLocalizations: number;
    reportRubrics: number;
    reportCriteria: number;
    reportScaleOptions: number;
    reportRejectionReasons: number;
    reportBindings: number;
    checkpointRequirements: number;
  };
  warnings: PackageIssue[];
  notes: string[];
};

export type ImportResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; code: ImportErrorCode; issues: PackageIssue[] };

export type ImportErrorCode =
  | "PACKAGE_INVALID"
  | "IMPORTER_TOO_OLD"
  | "VERSION_IMMUTABLE"
  | "PACKAGE_DRIFT"
  | "VERSION_NOT_PACKAGE_MANAGED"
  | "ASSESSMENT_NOT_CANONICAL";

function marker(pkg: CurriculumPackage, fingerprint: string): string {
  return `${MARKER}:${pkg.packageCode}@${pkg.packageRevision}:${fingerprint}`;
}

function readMarker(changeNotes: string | null): { packageCode: string; revision: number; fingerprint: string } | null {
  if (!changeNotes) return null;
  const match = new RegExp(`^${MARKER}:([^@\\s]+)@(\\d+):([0-9a-f]{64})$`).exec(changeNotes.trim());
  if (!match) return null;
  return { packageCode: match[1], revision: Number(match[2]), fingerprint: match[3] };
}

function emptyCounts(): ImportSummary["counts"] {
  return {
    modules: 0,
    levels: 0,
    contentVersions: 0,
    contentLocalizations: 0,
    contentAssets: 0,
    contentBindings: 0,
    assessmentVersions: 0,
    assessmentBindings: 0,
    questions: 0,
    questionLocalizations: 0,
    reportAssignments: 0,
    reportLocalizations: 0,
    reportFields: 0,
    reportFieldLocalizations: 0,
    reportRubrics: 0,
    reportCriteria: 0,
    reportScaleOptions: 0,
    reportRejectionReasons: 0,
    reportBindings: 0,
    checkpointRequirements: 0,
  };
}

/* ------------------- canonical assessment representation ------------------- */
/**
 * AC-1 — the importer persists exactly the ONE canonical assessment shape that
 * `canonicalizeQuestion` / `localizationIsComplete` / the learner runtime read:
 *
 *   QuestionDefinition.options            = [{ code }, …]   (explicit order)
 *   QuestionDefinition.correctAnswer      = { code } | { codes } | { value }
 *   QuestionLocalization.optionLabels     = { [optionCode]: label }
 *
 * Before AC-1 it wrote `options: string[]`, `optionLabels: string[]` (positional)
 * and `correctAnswer: { kind, optionCodes }`. None of those three shapes is
 * readable by the runtime, so every published package assessment failed closed
 * with `ASSESSMENT_STATE_CORRUPT`. The old `{ kind: … }` envelope was written
 * only here and read by nothing, so there is no legacy consumer to keep.
 *
 * The package's positional `optionLabels` are *not* ambiguous: the package
 * validator already rejects any localization whose `optionLabels.length` differs
 * from `optionCodes.length` (`QUESTION_OPTION_LABELS_MISMATCH`), and
 * `optionCodes` is an explicitly ordered list of unique stable codes. The
 * label↔code mapping is therefore total, injective and deterministic:
 * `optionLabels[i] ↦ optionCodes[i]`. Nothing is guessed or repaired.
 */
/*
 * PHASE-G2 CORRECTION-1 — these three are EXPORTED so the editorial overlay can
 * derive a target's expected structural baseline through the same mapping that
 * produced it. `questionCode` is not `stableKey`, `optionCodes` is not `options`
 * and `correctOptionCodes` is not `correctAnswer`; a second copy of those rules
 * living in the overlay could drift from this one without any test noticing, and
 * a baseline hash computed from a drifted mapping would compare two different
 * things while looking authoritative. One definition, two readers.
 */
export function canonicalOptionsJson(question: PackageQuestion): Prisma.InputJsonValue | undefined {
  if (question.optionCodes.length === 0) return undefined;
  return question.optionCodes.map((code) => ({ code }));
}

export function canonicalOptionLabelsJson(
  question: PackageQuestion,
  optionLabels: readonly string[],
): Prisma.InputJsonValue | undefined {
  if (question.optionCodes.length === 0) return undefined;
  const record: Record<string, string> = {};
  question.optionCodes.forEach((code, index) => {
    record[code] = optionLabels[index];
  });
  return record;
}

/**
 * Correct answers are stored as `QuestionDefinition.correctAnswer` (Json) in the
 * exact per-type shape `canonicalizeQuestion` accepts. Multiple choice is a
 * sorted canonical set; ordered steps keep the approved permutation order.
 */
export function correctAnswerJson(question: PackageQuestion): Prisma.InputJsonValue {
  switch (question.type) {
    case "numeric":
      return { value: canonicalNumericString(question.correctNumericValue) };
    case "multiple_choice":
      return { codes: [...question.correctOptionCodes].sort() };
    case "ordered_steps":
      return { codes: [...question.correctOptionCodes] };
    default:
      return { code: question.correctOptionCodes[0] };
  }
}

/** `canonicalizeQuestion` requires a decimal *string*; never a float literal. */
function canonicalNumericString(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return Number.isInteger(value) ? value.toFixed(0) : String(value);
}

/**
 * Strict pre-transaction proof that every assessment question the importer is
 * about to write is canonical and runtime-readable. Runs before any row is
 * created, so a malformed package fails the import instead of persisting data
 * the learner runtime would later reject as corrupt. Never echoes prompts,
 * labels or answer values into an issue.
 */
function assessmentCanonicalIssues(pkg: CurriculumPackage): PackageIssue[] {
  const issues: PackageIssue[] = [];
  pkg.modules.forEach((module, mi) => {
    module.levels.forEach((level, li) => {
      const assessment = level.assessment;
      if (!assessment) return;
      const base = `modules[${mi}].levels[${li}].assessment`;
      assessment.questions.forEach((question, qi) => {
        const path = `${base}.questions[${qi}]`;
        if (!isCanonicalAssessmentQuestionKey(question.questionCode)) {
          issues.push({
            code: "QUESTION_CODE_NOT_CANONICAL",
            path: `${path}.questionCode`,
            message: `questionCode is not a canonical assessment question key (max ${MAX_ASSESSMENT_QUESTION_KEY_LENGTH} chars, lowercase alphanumeric segments separated by . _ -)`,
          });
        }
        const options = canonicalOptionsJson(question);
        try {
          canonicalizeQuestion(question.type, options ?? null, correctAnswerJson(question), path);
        } catch {
          issues.push({
            code: "QUESTION_NOT_CANONICAL",
            path,
            message: "question options/correctAnswer do not satisfy the canonical runtime contract for this question type",
          });
        }
        question.localizations.forEach((localization, li2) => {
          const labels = canonicalOptionLabelsJson(question, localization.optionLabels) ?? null;
          if (
            !localizationIsComplete(
              { type: question.type, options: (options ?? null) as Prisma.JsonValue },
              { prompt: localization.prompt, optionLabels: labels as Prisma.JsonValue },
            )
          ) {
            issues.push({
              code: "QUESTION_LOCALIZATION_NOT_CANONICAL",
              path: `${path}.localizations[${li2}].optionLabels`,
              message: "localization does not map exactly onto the canonical option codes",
            });
          }
        });
      });
    });
  });
  return issues;
}

async function writePackage(
  tx: Prisma.TransactionClient,
  pkg: CurriculumPackage,
  fingerprint: string,
  effectiveAt: Date,
): Promise<ImportSummary["counts"]> {
  const counts = emptyCounts();

  const version = await tx.curriculumVersion.create({
    data: {
      code: pkg.curriculumCode,
      name: pkg.curriculumTitle,
      versionNumber: pkg.curriculumVersionNumber,
      // Import never publishes and never activates.
      status: "draft",
      changeNotes: marker(pkg, fingerprint),
    },
  });

  // Level codes -> created row ids, so prerequisites/checkpoints resolve by code.
  const levelIdByCode = new Map<string, number>();
  const levelNumberByCode = new Map<string, number>();
  for (const moduleDefinition of pkg.modules) {
    for (const level of moduleDefinition.levels) {
      levelNumberByCode.set(level.levelCode, level.levelNumber);
    }
  }

  for (const moduleDefinition of pkg.modules) {
    const levelNumbers = moduleDefinition.levels.map((l) => l.levelNumber);
    const created = await tx.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: moduleDefinition.moduleNumber,
        code: moduleDefinition.moduleCode,
        title: moduleDefinition.title,
        description: moduleDefinition.description,
        learningObjective: moduleDefinition.learningObjective,
        firstLevel: Math.min(...levelNumbers),
        lastLevel: Math.max(...levelNumbers),
        checkpointLevel:
          moduleDefinition.checkpointLevelCode !== null
            ? levelNumberByCode.get(moduleDefinition.checkpointLevelCode) ?? null
            : null,
      },
    });
    counts.modules += 1;

    for (const level of moduleDefinition.levels) {
      const previous = level.prerequisiteLevelCodes
        .map((code) => levelNumberByCode.get(code))
        .filter((n): n is number => typeof n === "number")
        .sort((a, b) => b - a)[0];

      const levelRow = await tx.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: created.id,
          levelNumber: level.levelNumber,
          stableCode: level.levelCode,
          type: level.type,
          title: level.title,
          shortDescription: level.shortDescription,
          learningObjective: level.learningObjective,
          completionMethod: level.completionMethod,
          xpReward: level.xpReward,
          requiredXp: level.requiredXp,
          requiredPreviousLevel: previous ?? null,
          // A5. Always NULL, and not merely because validation refused a
          // non-null `checkpointLevelCode` upstream. `requiredCheckpointLevel`
          // and `visibilityRule` are the two columns that permanently lock a
          // level with no owner to clear them, so the importer — the one code
          // path that could ever set them at scale — is not given the option.
          // `visibilityRule` is left to its schema default of NULL for the same
          // reason and is deliberately absent from this object.
          requiredCheckpointLevel: null,
          featureUnlockCode: level.gate?.integrationCode ?? null,
          status: "active",
        },
      });
      counts.levels += 1;
      levelIdByCode.set(level.levelCode, levelRow.id);

      /* ---------------------------- content ---------------------------- */
      if (level.content) {
        const contentVersion = await tx.contentVersion.create({
          data: {
            levelDefinitionId: levelRow.id,
            curriculumVersionId: version.id,
            versionNumber: level.content.versionNumber,
            status: level.content.status,
            publishedAt: level.content.status === "published" ? effectiveAt : null,
            videoDurationSeconds: level.content.videoDurationSeconds,
          },
        });
        counts.contentVersions += 1;

        for (const localization of level.content.localizations) {
          await tx.contentLocalization.create({
            data: {
              contentVersionId: contentVersion.id,
              locale: localization.locale,
              title: localization.title,
              subtitle: localization.subtitle,
              learningObjectiveExtension: localization.learningObjectiveExtension,
              summary: localization.summary,
              transcript: localization.transcript,
              body: localization.body as unknown as Prisma.InputJsonValue,
            },
          });
          counts.contentLocalizations += 1;
        }

        for (const asset of level.content.assets) {
          await tx.contentAsset.create({
            data: {
              contentVersionId: contentVersion.id,
              kind: asset.kind,
              assetCode: asset.assetCode,
              locale: asset.locale,
              url: asset.url,
              mimeType: asset.mimeType,
              sizeBytes: asset.sizeBytes,
              durationSeconds: asset.durationSeconds,
              sortOrder: asset.sortOrder,
            },
          });
          counts.contentAssets += 1;
        }

        // The binding the learner content route resolves through.
        await tx.levelResourceBinding.create({
          data: {
            levelDefinitionId: levelRow.id,
            curriculumVersionId: version.id,
            contentVersionId: contentVersion.id,
          },
        });
        counts.contentBindings += 1;
      }

      /* --------------------------- assessment --------------------------- */
      if (level.assessment) {
        const assessmentVersion = await tx.assessmentVersion.create({
          data: {
            levelDefinitionId: levelRow.id,
            curriculumVersionId: version.id,
            versionNumber: level.assessment.versionNumber,
            status: level.assessment.status,
            publishedAt: level.assessment.status === "published" ? effectiveAt : null,
            passPercent: level.assessment.passPercent,
            maxAttempts: level.assessment.maxAttempts,
            showExplanation: level.assessment.showExplanation,
          },
        });
        counts.assessmentVersions += 1;

        /**
         * PHASE-G1 CORRECTION — an ATA video lesson's bank is imported WITH its
         * canonical take mapping.
         *
         * `QuestionDefinition.stableKey` is where the accepted validator and the
         * deterministic handoff bundle read a question's take binding. Importing
         * the package's own `questionCode` there left every one of the 58 ATA
         * banks permanently `ASSESSMENT_TAKE_MAPPING_INCOMPLETE`: a durable state
         * no editor and no HTTP call could repair, because the product had no
         * path that could write a take id at all.
         *
         * The take is DERIVED, never invented: `expectedTakeIdFor` is the same
         * `takeIdFor(levelNumber, questionNumber)` binding the accepted
         * fingerprint projection already uses, so the imported mapping and the
         * fingerprinted mapping are the same fact and no bank fingerprint moves.
         *
         * It applies ONLY to canonical ATA `video_test` levels — decided from the
         * structural source by exact `stableCode`, not by level number — so a
         * non-ATA package keeps its own `questionCode` vocabulary untouched.
         */
        const ataVideoBank = isAtaVideoProfileLevel({
          levelNumber: level.levelNumber,
          stableCode: level.levelCode,
          type: level.type,
        });

        for (const question of level.assessment.questions) {
          const questionRow = await tx.questionDefinition.create({
            data: {
              assessmentVersionId: assessmentVersion.id,
              questionNumber: question.questionNumber,
              stableKey: ataVideoBank
                ? expectedTakeIdFor(level.levelNumber, question.questionNumber)
                : question.questionCode,
              type: question.type,
              skillTag: question.skillTag,
              options: canonicalOptionsJson(question),
              correctAnswer: correctAnswerJson(question),
              status: "active",
            },
          });
          counts.questions += 1;

          for (const localization of question.localizations) {
            await tx.questionLocalization.create({
              data: {
                questionId: questionRow.id,
                locale: localization.locale,
                prompt: localization.prompt,
                optionLabels: canonicalOptionLabelsJson(question, localization.optionLabels),
                explanation: localization.explanation,
              },
            });
            counts.questionLocalizations += 1;
          }
        }

        /*
         * G2 ASSESSMENT BINDING SEQUENCE CORRECTION — the binding the assessment
         * runtime resolves through, established here rather than left for later.
         *
         * WHAT WENT WRONG WITHOUT IT. The content branch above creates a
         * `LevelResourceBinding` the moment it creates a `ContentVersion`, so a
         * lesson is runtime-addressable from the instant it is imported. The
         * assessment branch created the bank and its questions and stopped, so an
         * `assessment_pass` level was imported with a bank nothing pointed at.
         * Binding it afterwards is only possible while the parent curriculum is
         * still a draft — `setLevelAssessmentBinding` loads the level through
         * `assertParentDraft` — and nothing in the accepted activation sequence
         * did it. Once the curriculum was published the window shut permanently:
         * ata-v2@v3 reached `published` with 58 assessment_pass levels and zero
         * assessment bindings, which no accepted operation can now repair.
         *
         * WHY IT IS AN UPSERT AND NOT A CREATE. `LevelResourceBinding` is unique
         * per `levelDefinitionId`, and every one of the 58 canonical
         * assessment_pass levels also carries content, so the content branch has
         * already created the row. Creating a second one would violate the
         * constraint; updating the existing one is the same shape the accepted
         * `setLevelAssessmentBinding` uses when a binding is already present.
         *
         * WHY A DRAFT BANK MAY BE BOUND HERE. The canonical package ships its
         * resources as drafts (57 of 58 assessments, 77 of 78 contents) and the
         * reviewed activation plan publishes them IN PLACE afterwards — which is
         * exactly why 77 of the 78 content rows were `PUBLISH_IN_PLACE`. The
         * binding names the resource; publication makes it servable. The runtime
         * still refuses an unpublished bank (`assessment-runtime` requires
         * `status === "published"` and a `publishedAt`), so binding early grants
         * no learner access — it only makes the level addressable so publication
         * can find it.
         */
        await tx.levelResourceBinding.upsert({
          where: { levelDefinitionId: levelRow.id },
          update: { assessmentVersionId: assessmentVersion.id },
          create: {
            levelDefinitionId: levelRow.id,
            curriculumVersionId: version.id,
            assessmentVersionId: assessmentVersion.id,
          },
        });
        counts.assessmentBindings += 1;
      }

      /* ----------------------------- report ----------------------------- */
      if (level.report) {
        const assignment = await tx.reportAssignmentVersion.create({
          data: {
            levelDefinitionId: levelRow.id,
            curriculumVersionId: version.id,
            versionNumber: level.report.versionNumber,
            status: level.report.status,
            publishedAt: level.report.status === "published" ? effectiveAt : null,
          },
        });
        counts.reportAssignments += 1;

        for (const localization of level.report.localizations) {
          await tx.reportAssignmentLocalization.create({
            data: {
              reportAssignmentVersionId: assignment.id,
              locale: localization.locale,
              title: localization.title,
              instructions: localization.instructions,
              successCriteriaSummary: localization.successCriteriaSummary,
              submitLabel: localization.submitLabel,
            },
          });
          counts.reportLocalizations += 1;
        }

        for (const field of level.report.fields) {
          const fieldRow = await tx.reportFieldDefinition.create({
            data: {
              reportAssignmentVersionId: assignment.id,
              stableKey: field.stableKey,
              type: field.type,
              required: field.required,
              sortOrder: field.sortOrder,
              validationRules:
                field.minLength !== null || field.maxLength !== null
                  ? // The `version: 1` marker is required by the report read schema
                    // (report-schemas.ts textRules); without it an imported text
                    // field is rejected by parseDefinitionGraph and the report
                    // reads corrupt. Package min/max drive the fingerprint, so this
                    // storage detail does not change package identity.
                    ({ version: 1, minLength: field.minLength, maxLength: field.maxLength } as unknown as Prisma.InputJsonValue)
                  : undefined,
              choiceCodes:
                field.choiceCodes.length > 0 ? (field.choiceCodes as unknown as Prisma.InputJsonValue) : undefined,
              // Conditional requiredness rule (RC-1), already validated against the
              // report's own fields before the transaction opened. Absent -> NULL.
              requiredWhen: field.requiredWhen
                ? ({
                    fieldCode: field.requiredWhen.fieldCode,
                    operator: field.requiredWhen.operator,
                    value: field.requiredWhen.value,
                  } as unknown as Prisma.InputJsonValue)
                : undefined,
            },
          });
          counts.reportFields += 1;

          for (const localization of field.localizations) {
            await tx.reportFieldLocalization.create({
              data: {
                reportFieldDefinitionId: fieldRow.id,
                locale: localization.locale,
                label: localization.label,
                helpText: localization.helpText,
                placeholder: localization.placeholder,
                choiceLabels:
                  localization.choiceLabels.length > 0
                    ? (localization.choiceLabels as unknown as Prisma.InputJsonValue)
                    : undefined,
              },
            });
            counts.reportFieldLocalizations += 1;
          }
        }

        /* ------------------- report rubric + binding ------------------- */
        /*
         * The completion owner for a `report_approval` level, materialized here
         * because here is the only place it CAN be.
         *
         * `publishReportRubric` and `setLevelReportBinding` both load the level
         * through `assertParentDraft`, so the window in which a report can be
         * given an owner closes the moment the curriculum is published — and
         * there is no unpublish. `ata-v2@v3` went through that window with its
         * level 3 unbound, which is why level 3 is where the learner journey
         * stops today. Creating the binding inside the import transaction is the
         * same fix, and for the same reason, as the assessment binding above.
         *
         * Every value below is copied from the package. The importer chooses
         * nothing: not the criteria, not their order, not the scale, not which
         * rubric a level gets. A package with no rubric creates none of these
         * rows and no binding.
         */
        if (level.report.rubric) {
          const rubricSource = level.report.rubric;
          const rubric = await tx.reportRubricVersion.create({
            data: {
              reportAssignmentVersionId: assignment.id,
              // Spelled out rather than through the local alias: the successor
              // regression proves at SOURCE level that every version this
              // importer writes is read off the package it was handed.
              versionNumber: level.report.rubric.versionNumber,
              status: rubricSource.status,
              publishedAt: rubricSource.status === "published" ? effectiveAt : null,
            },
          });
          counts.reportRubrics += 1;

          for (const criterion of rubricSource.criteria) {
            const criterionRow = await tx.reportRubricCriterion.create({
              data: {
                reportRubricVersionId: rubric.id,
                stableKey: criterion.stableKey,
                categoryCode: criterion.categoryCode,
                sortOrder: criterion.sortOrder,
                commentRequired: criterion.commentRequired,
              },
            });
            counts.reportCriteria += 1;
            for (const localization of criterion.localizations) {
              await tx.reportRubricCriterionLocalization.create({
                data: {
                  reportRubricCriterionId: criterionRow.id,
                  locale: localization.locale,
                  title: localization.title,
                  description: localization.description,
                },
              });
            }
          }

          for (const option of rubricSource.scaleOptions) {
            const optionRow = await tx.reportRubricScaleOption.create({
              data: {
                reportRubricVersionId: rubric.id,
                stableKey: option.stableKey,
                ordinal: option.ordinal,
              },
            });
            counts.reportScaleOptions += 1;
            for (const localization of option.localizations) {
              await tx.reportRubricScaleOptionLocalization.create({
                data: {
                  reportRubricScaleOptionId: optionRow.id,
                  locale: localization.locale,
                  label: localization.label,
                  description: localization.description,
                },
              });
            }
          }

          for (const reason of rubricSource.rejectionReasons) {
            const reasonRow = await tx.reportRejectionReason.create({
              data: {
                reportRubricVersionId: rubric.id,
                stableKey: reason.stableKey,
                sortOrder: reason.sortOrder,
                active: reason.active,
              },
            });
            counts.reportRejectionReasons += 1;
            for (const localization of reason.localizations) {
              await tx.reportRejectionReasonLocalization.create({
                data: {
                  reportRejectionReasonId: reasonRow.id,
                  locale: localization.locale,
                  title: localization.title,
                  guidance: localization.guidance,
                },
              });
            }
          }

          // `LevelReportBinding` is unique per level, and the level was created
          // in this transaction, so this is a create and never an upsert: a
          // second binding for the same level is a constraint violation that
          // must roll the import back rather than quietly win.
          await tx.levelReportBinding.create({
            data: {
              levelDefinitionId: levelRow.id,
              curriculumVersionId: version.id,
              reportAssignmentVersionId: assignment.id,
              reportRubricVersionId: rubric.id,
              revision: 0,
            },
          });
          counts.reportBindings += 1;
        }
      }

      /* ---------------------- checkpoint requirement ---------------------- */
      /*
       * The completion owner for a `balance_check` level.
       *
       * `integrationCode` is taken from the GATE, not restated by the
       * requirement, so the two can never name different integrations for the
       * same level — `checkpoint-verification.ts` resolves the requirement by
       * level and then compares its integration code with the gate's.
       *
       * This writes CONFIGURATION and nothing else. No balance is read, no
       * Pocket call is made, no `ExchangeAccount`, `Checkpoint`,
       * `CheckpointVerificationAttempt` or financial event row is touched, and
       * no amount is attributed to any learner.
       */
      if (level.gate?.requirement) {
        await tx.levelCheckpointRequirement.create({
          data: {
            levelDefinitionId: levelRow.id,
            integrationCode: level.gate.integrationCode,
            thresholdCurrency: level.gate.requirement.thresholdCurrency,
            thresholdMinorUnits: level.gate.requirement.thresholdMinorUnits,
          },
        });
        counts.checkpointRequirements += 1;
      }
    }
  }

  return counts;
}

export type ImportOptions = {
  /** When true, validate + plan only; no transaction is opened. */
  dryRun?: boolean;
  /** Injected so callers control the database target explicitly. */
  db: PrismaClient;
  /** Fixed clock for deterministic tests. */
  now?: Date;
};

export async function importCurriculumPackage(input: unknown, options: ImportOptions): Promise<ImportResult> {
  const validation = validateCurriculumPackage(input);
  if (!validation.ok) return { ok: false, code: "PACKAGE_INVALID", issues: validation.issues };

  const pkg = validation.package;
  const fingerprint = validation.fingerprint;

  if (pkg.minImporterVersion > IMPORTER_VERSION) {
    return {
      ok: false,
      code: "IMPORTER_TOO_OLD",
      issues: [
        {
          code: "IMPORTER_TOO_OLD",
          path: "minImporterVersion",
          message: `package requires importer >= ${pkg.minImporterVersion}, this importer is ${IMPORTER_VERSION}`,
        },
      ],
    };
  }

  // AC-1: prove every assessment question is canonical and runtime-readable
  // BEFORE the transaction opens. Never persist data the learner runtime would
  // later reject as ASSESSMENT_STATE_CORRUPT.
  const canonicalIssues = assessmentCanonicalIssues(pkg);
  if (canonicalIssues.length > 0) {
    return { ok: false, code: "ASSESSMENT_NOT_CANONICAL", issues: canonicalIssues };
  }

  const notes: string[] = [];
  const unownedReportLevels = pkg.modules.flatMap((m) =>
    m.levels.filter((l) => l.report !== null && !l.report.rubric),
  );
  if (unownedReportLevels.length > 0) {
    notes.push(
      "report assignment imported without LevelReportBinding: binding requires an approved reportRubricVersion",
    );
  }
  const unownedCheckpointLevels = pkg.modules.flatMap((m) =>
    m.levels.filter((l) => l.gate?.completionSource === "financial_checkpoint" && !l.gate.requirement),
  );
  if (unownedCheckpointLevels.length > 0) {
    notes.push(
      `financial checkpoints imported without LevelCheckpointRequirement: ${unownedCheckpointLevels.length} level(s) will fail verification with CHECKPOINT_REQUIREMENT_UNCONFIGURED`,
    );
  }
  const conditionalFieldCount = pkg.modules.reduce(
    (total, m) =>
      total +
      m.levels.reduce(
        (sub, l) => sub + (l.report?.fields.filter((f) => (f.requiredWhen ?? null) !== null).length ?? 0),
        0,
      ),
    0,
  );
  if (conditionalFieldCount > 0) {
    notes.push(`conditional report fields (requiredWhen): ${conditionalFieldCount}`);
  }
  // Bounded record of the canonical assessment projection (counts only — never a
  // prompt, a label or an answer value).
  const canonicalQuestionCount = pkg.modules.reduce(
    (total, m) => total + m.levels.reduce((sub, l) => sub + (l.assessment?.questions.length ?? 0), 0),
    0,
  );
  if (canonicalQuestionCount > 0) {
    notes.push(`assessment questions persisted in the canonical runtime representation: ${canonicalQuestionCount}`);
  }

  const existing = await options.db.curriculumVersion.findUnique({
    where: { code_versionNumber: { code: pkg.curriculumCode, versionNumber: pkg.curriculumVersionNumber } },
    select: { id: true, status: true, changeNotes: true },
  });

  if (existing) {
    if (existing.status !== "draft") {
      return {
        ok: false,
        code: "VERSION_IMMUTABLE",
        issues: [
          {
            code: "VERSION_IMMUTABLE",
            path: "curriculumVersionNumber",
            message: `curriculum version is ${existing.status} and cannot be modified; publish a new version`,
          },
        ],
      };
    }
    const existingMarker = readMarker(existing.changeNotes);
    if (!existingMarker) {
      return {
        ok: false,
        code: "VERSION_NOT_PACKAGE_MANAGED",
        issues: [
          {
            code: "VERSION_NOT_PACKAGE_MANAGED",
            path: "curriculumVersionNumber",
            message: "an existing curriculum version with this code/version was not created by the importer",
          },
        ],
      };
    }
    if (existingMarker.fingerprint !== fingerprint) {
      return {
        ok: false,
        code: "PACKAGE_DRIFT",
        issues: [
          {
            code: "PACKAGE_DRIFT",
            path: "contentFingerprint",
            message: "this curriculum version already exists with different content; bump curriculumVersionNumber",
          },
        ],
      };
    }
    // Exact same package, already imported: no-op.
    return {
      ok: true,
      summary: {
        outcome: "unchanged",
        packageCode: pkg.packageCode,
        packageRevision: pkg.packageRevision,
        fingerprint,
        curriculumCode: pkg.curriculumCode,
        curriculumVersionNumber: pkg.curriculumVersionNumber,
        curriculumVersionStatus: existing.status,
        counts: emptyCounts(),
        warnings: validation.warnings,
        notes,
      },
    };
  }

  if (options.dryRun) {
    return {
      ok: true,
      summary: {
        outcome: "unchanged",
        packageCode: pkg.packageCode,
        packageRevision: pkg.packageRevision,
        fingerprint,
        curriculumCode: pkg.curriculumCode,
        curriculumVersionNumber: pkg.curriculumVersionNumber,
        curriculumVersionStatus: "not-created (dry run)",
        counts: emptyCounts(),
        warnings: validation.warnings,
        notes: [...notes, "dry run: no transaction was opened and no row was written"],
      },
    };
  }

  const effectiveAt = options.now ?? new Date();
  const counts = await options.db.$transaction(async (tx) => writePackage(tx, pkg, fingerprint, effectiveAt));

  return {
    ok: true,
    summary: {
      outcome: "created",
      packageCode: pkg.packageCode,
      packageRevision: pkg.packageRevision,
      fingerprint,
      curriculumCode: pkg.curriculumCode,
      curriculumVersionNumber: pkg.curriculumVersionNumber,
      curriculumVersionStatus: "draft",
      counts,
      warnings: validation.warnings,
      notes,
    },
  };
}
