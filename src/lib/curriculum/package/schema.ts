/**
 * Curriculum V2 package format (CV-1).
 *
 * A package is a versioned, human-reviewable JSON description of one curriculum
 * version. It carries structure, content, assessment and report definitions plus
 * the provenance of every content element, and it is the ONLY supported way to
 * import a curriculum outside the admin authoring API.
 *
 * Strictness is deliberate: `z.strictObject` everywhere, so an unknown field
 * that could affect grading or progression is a hard error rather than a silent
 * drop. Correct answers live here (this file is Backend-only) but never reach a
 * learner DTO — the learner content route builds its own payload.
 */
import { z } from "zod";
import { requiredWhenSchema } from "@/lib/curriculum/report-required-when";

export const PACKAGE_SCHEMA_VERSION = "ata.curriculum.package/1" as const;
export const MIN_IMPORTER_VERSION = 1 as const;

/** Where a piece of content came from. Only the first four may ship in production. */
export const PROVENANCE_VALUES = [
  "EXISTING_ACADEMY_SOURCE",
  "EXISTING_BACKEND_SOURCE",
  "APPROVED_PRODUCTION_SOURCE",
  "EXPLICIT_OPERATOR_APPROVAL",
  "SYNTHETIC_TEST_ONLY",
  "MISSING",
  "CONFLICTING",
] as const;
export type Provenance = (typeof PROVENANCE_VALUES)[number];

export const PRODUCTION_PROVENANCE: ReadonlySet<Provenance> = new Set<Provenance>([
  "EXISTING_ACADEMY_SOURCE",
  "EXISTING_BACKEND_SOURCE",
  "APPROVED_PRODUCTION_SOURCE",
  "EXPLICIT_OPERATOR_APPROVAL",
]);

const provenanceSchema = z.enum(PROVENANCE_VALUES);

/** Provenance record for one content element. Never contains IDs or secrets. */
const provenanceRecordSchema = z.strictObject({
  classification: provenanceSchema,
  sourcePath: z.string().trim().min(1).max(400).nullable(),
  sourceRef: z.string().trim().max(200).nullable(),
  revision: z.string().trim().max(120).nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  conflicts: z.array(z.string().trim().min(1).max(400)).max(20),
  approvalRequired: z.boolean(),
  note: z.string().trim().max(600).nullable(),
});
export type ProvenanceRecord = z.infer<typeof provenanceRecordSchema>;

const localeSchema = z.string().trim().regex(/^[a-z]{2}(-[a-z0-9]{2,8})?$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max);

const levelTypeSchema = z.enum([
  "external_event",
  "lesson",
  "scenario",
  "practice",
  "report",
  "mentor_review",
  "financial_checkpoint",
  "final_exam",
]);

const questionTypeSchema = z.enum([
  "single_choice",
  "multiple_choice",
  "true_false",
  "ordered_steps",
  "scenario_choice",
  "numeric",
  "chart_choice",
]);

const reportFieldTypeSchema = z.enum([
  "short_text",
  "long_text",
  "url",
  "integer",
  "boolean",
  "single_choice",
  "multi_choice",
]);

/* ------------------------------- content -------------------------------- */

const contentSectionSchema = z.strictObject({
  code: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64),
  title: text(300),
  body: text(8_000),
});

const contentBodySchema = z.strictObject({
  sections: z.array(contentSectionSchema).max(30),
  examples: z.array(z.strictObject({ title: text(300), body: text(8_000) })).max(50),
  commonMistakes: z.array(z.strictObject({ mistake: text(8_000), correction: text(8_000) })).max(50),
  glossary: z.array(z.strictObject({ term: text(300), definition: text(8_000) })).max(50),
  nextAction: z.strictObject({ label: text(300), body: text(8_000) }),
  riskDisclaimer: text(8_000),
});

const contentLocalizationSchema = z.strictObject({
  locale: localeSchema,
  title: text(300),
  subtitle: optionalText(1_000),
  learningObjectiveExtension: optionalText(4_000),
  summary: optionalText(8_000),
  transcript: z.string().trim().max(200_000).nullable(),
  body: contentBodySchema,
});

const contentAssetSchema = z.strictObject({
  kind: z.enum(["video", "subtitles", "image", "chart", "attachment"]),
  assetCode: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64),
  locale: localeSchema.nullable(),
  url: z.string().trim().min(1).max(2_000),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().nullable(),
  durationSeconds: z.number().int().positive().nullable(),
  sortOrder: z.number().int().min(0).max(999),
});

const contentSchema = z.strictObject({
  contentCode: z.string().trim().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/).max(120),
  versionNumber: z.number().int().positive().max(10_000),
  status: z.enum(["draft", "published"]),
  videoDurationSeconds: z.number().int().positive().max(86_400).nullable(),
  localizations: z.array(contentLocalizationSchema).min(1).max(20),
  assets: z.array(contentAssetSchema).max(50),
  provenance: provenanceRecordSchema,
});

/* ------------------------------ assessment ------------------------------ */

const questionSchema = z.strictObject({
  questionCode: z.string().trim().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/).max(120),
  questionNumber: z.number().int().positive().max(500),
  type: questionTypeSchema,
  skillTag: z.string().trim().max(120).nullable(),
  /** Stable option codes, in presentation order. Empty only for numeric. */
  optionCodes: z.array(z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64)).max(20),
  /** Option codes (or a numeric value) that are correct. Backend-only. */
  correctOptionCodes: z.array(z.string().trim().min(1).max(64)).max(20),
  correctNumericValue: z.number().nullable(),
  localizations: z
    .array(
      z.strictObject({
        locale: localeSchema,
        prompt: text(2_000),
        optionLabels: z.array(text(1_000)).max(20),
        explanation: z.string().trim().max(4_000).nullable(),
      }),
    )
    .min(1)
    .max(20),
  /** Which lesson takeaway teaches this answer — required for review. */
  lessonTakeawayRef: z.string().trim().max(300).nullable(),
  provenance: provenanceRecordSchema,
});

const assessmentSchema = z.strictObject({
  assessmentCode: z.string().trim().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/).max(120),
  versionNumber: z.number().int().positive().max(10_000),
  status: z.enum(["draft", "published"]),
  passPercent: z.number().int().min(1).max(100),
  maxAttempts: z.number().int().positive().max(100).nullable(),
  showExplanation: z.boolean(),
  questions: z.array(questionSchema).min(1).max(200),
  provenance: provenanceRecordSchema,
});

/* -------------------------------- report -------------------------------- */

const reportFieldSchema = z.strictObject({
  stableKey: z.string().trim().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(64),
  type: reportFieldTypeSchema,
  required: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
  minLength: z.number().int().min(0).max(100_000).nullable(),
  maxLength: z.number().int().min(1).max(100_000).nullable(),
  choiceCodes: z.array(z.string().trim().min(1).max(64)).max(50),
  /**
   * Bounded conditional requiredness (RC-1). When present, the field is required
   * during final submission only when the referenced controller field equals the
   * given typed value. `required: true` combined with a condition is rejected by
   * the validator. Cross-field checks (controller exists, precedes, type-compat)
   * run in the package validator, which has the whole report in scope.
   */
  requiredWhen: requiredWhenSchema.nullable().optional(),
  localizations: z
    .array(
      z.strictObject({
        locale: localeSchema,
        label: text(300),
        helpText: optionalText(2_000),
        placeholder: optionalText(300),
        choiceLabels: z.array(text(300)).max(50),
      }),
    )
    .min(1)
    .max(20),
});

const reportSchema = z.strictObject({
  reportCode: z.string().trim().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/).max(120),
  versionNumber: z.number().int().positive().max(10_000),
  status: z.enum(["draft", "published"]),
  localizations: z
    .array(
      z.strictObject({
        locale: localeSchema,
        title: text(300),
        instructions: text(20_000),
        successCriteriaSummary: optionalText(4_000),
        submitLabel: optionalText(120),
      }),
    )
    .min(1)
    .max(20),
  fields: z.array(reportFieldSchema).min(1).max(50),
  attachmentsAllowed: z.boolean(),
  maxAttachments: z.number().int().min(0).max(20),
  draftAllowed: z.boolean(),
  mentorReviewRequired: z.boolean(),
  provenance: provenanceRecordSchema,
});

/* -------------------------------- levels -------------------------------- */

const gateSchema = z.strictObject({
  /** Completion is produced outside the learner UI. Never client-completable. */
  completionSource: z.enum(["external_event", "financial_checkpoint"]),
  integrationCode: z.string().trim().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/).max(120),
  selfCompletable: z.literal(false),
  blockedExplanation: z
    .array(z.strictObject({ locale: localeSchema, text: text(2_000) }))
    .min(1)
    .max(20),
  provenance: provenanceRecordSchema,
});

const levelSchema = z.strictObject({
  levelCode: z.string().trim().min(1).max(128),
  levelNumber: z.number().int().positive().max(1_000),
  type: levelTypeSchema,
  title: text(300),
  shortDescription: optionalText(1_000),
  learningObjective: text(1_000),
  completionMethod: z.string().trim().min(1).max(64),
  xpReward: z.number().int().min(0).max(100_000),
  requiredXp: z.number().int().min(0).max(1_000_000),
  /** Canonical level codes this level depends on. */
  prerequisiteLevelCodes: z.array(z.string().trim().min(1).max(128)).max(20),
  checkpointLevelCode: z.string().trim().min(1).max(128).nullable(),
  estimatedDurationSeconds: z.number().int().positive().max(86_400).nullable(),
  content: contentSchema.nullable(),
  assessment: assessmentSchema.nullable(),
  report: reportSchema.nullable(),
  gate: gateSchema.nullable(),
  provenance: provenanceRecordSchema,
});

const moduleSchema = z.strictObject({
  moduleCode: z.string().trim().min(1).max(120),
  moduleNumber: z.number().int().positive().max(1_000),
  title: text(300),
  description: optionalText(2_000),
  learningObjective: text(1_000),
  checkpointLevelCode: z.string().trim().min(1).max(128).nullable(),
  levels: z.array(levelSchema).min(1).max(200),
});

/* ------------------------------- package -------------------------------- */

export const curriculumPackageSchema = z.strictObject({
  schemaVersion: z.literal(PACKAGE_SCHEMA_VERSION),
  minImporterVersion: z.number().int().positive().max(1_000),
  packageCode: z.string().trim().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/).max(120),
  packageRevision: z.number().int().positive().max(100_000),
  /** `draft` may carry unapproved provenance; `approved` may not. */
  status: z.enum(["draft", "approved"]),
  curriculumCode: z.string().trim().min(1).max(120),
  curriculumVersionNumber: z.number().int().positive().max(10_000),
  curriculumTitle: text(300),
  curriculumDescription: optionalText(2_000),
  locale: localeSchema,
  createdFrom: z.string().trim().min(1).max(400),
  approval: z.strictObject({
    approvedBy: z.string().trim().max(200).nullable(),
    approvedAt: z.string().trim().max(40).nullable(),
    note: z.string().trim().max(2_000).nullable(),
  }),
  /**
   * Every content decision this package cannot make on its own authority.
   * A `draft` may carry entries (they surface as warnings); an `approved`
   * package must have none. This is what stops "structure shipped, content
   * silently absent" from reading as a complete package.
   */
  pendingApprovals: z
    .array(
      z.strictObject({
        levelCode: z.string().trim().min(1).max(128),
        element: z.enum([
          "lesson_content",
          "video_reference",
          "estimated_duration",
          "assessment",
          "correct_answers",
          "pass_policy",
          "report_prompt",
          "report_fields",
          "report_rubric",
          "gate_copy",
        ]),
        classification: z.enum(["MISSING", "CONFLICTING"]),
        detail: text(1_000),
        blocksReadiness: z.boolean(),
      }),
    )
    .max(200),
  /** sha256 over the canonical semantic projection; verified before import. */
  contentFingerprint: z.string().trim().regex(/^[0-9a-f]{64}$/),
  modules: z.array(moduleSchema).min(1).max(100),
});

export type CurriculumPackage = z.infer<typeof curriculumPackageSchema>;
export type PackageModule = z.infer<typeof moduleSchema>;
export type PackageLevel = z.infer<typeof levelSchema>;
export type PackageContent = z.infer<typeof contentSchema>;
export type PackageAssessment = z.infer<typeof assessmentSchema>;
export type PackageQuestion = z.infer<typeof questionSchema>;
export type PackageReport = z.infer<typeof reportSchema>;
export type PackageGate = z.infer<typeof gateSchema>;
