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
 * Report levels: the assignment, its localizations and its fields are imported,
 * but `LevelReportBinding` is deliberately NOT created — that row requires a
 * `reportRubricVersionId`, and inventing rubric criteria would fabricate mentor
 * acceptance rules. Binding a report is therefore a follow-up once rubric
 * criteria are approved.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { validateCurriculumPackage, type PackageIssue } from "@/lib/curriculum/package/validate";
import type { CurriculumPackage, PackageQuestion } from "@/lib/curriculum/package/schema";

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
    questions: number;
    questionLocalizations: number;
    reportAssignments: number;
    reportLocalizations: number;
    reportFields: number;
    reportFieldLocalizations: number;
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
  | "VERSION_NOT_PACKAGE_MANAGED";

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
    questions: 0,
    questionLocalizations: 0,
    reportAssignments: 0,
    reportLocalizations: 0,
    reportFields: 0,
    reportFieldLocalizations: 0,
  };
}

/**
 * Correct answers are stored as `QuestionDefinition.correctAnswer` (Json), in the
 * shape the assessment runtime already expects: option codes for choice
 * questions, a numeric value for numeric ones.
 */
function correctAnswerJson(question: PackageQuestion): Prisma.InputJsonValue {
  return question.type === "numeric"
    ? { kind: "numeric", value: question.correctNumericValue }
    : { kind: "options", optionCodes: [...question.correctOptionCodes].sort() };
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
          requiredCheckpointLevel:
            level.checkpointLevelCode !== null ? levelNumberByCode.get(level.checkpointLevelCode) ?? null : null,
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

        for (const question of level.assessment.questions) {
          const questionRow = await tx.questionDefinition.create({
            data: {
              assessmentVersionId: assessmentVersion.id,
              questionNumber: question.questionNumber,
              stableKey: question.questionCode,
              type: question.type,
              skillTag: question.skillTag,
              options: question.optionCodes.length > 0 ? (question.optionCodes as unknown as Prisma.InputJsonValue) : undefined,
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
                optionLabels:
                  localization.optionLabels.length > 0
                    ? (localization.optionLabels as unknown as Prisma.InputJsonValue)
                    : undefined,
                explanation: localization.explanation,
              },
            });
            counts.questionLocalizations += 1;
          }
        }
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

  const notes: string[] = [];
  if (pkg.modules.some((m) => m.levels.some((l) => l.report !== null))) {
    notes.push(
      "report assignment imported without LevelReportBinding: binding requires an approved reportRubricVersion",
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
