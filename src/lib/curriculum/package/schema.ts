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
import { contentBodySchema } from "@/lib/curriculum/content-body";
import { optionalSafeText, safeText } from "@/lib/curriculum/content-safe-text";

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

/**
 * PHASE-C. Every learner-visible string in a package now goes through the shared
 * sanitizer (`content-safe-text.ts`) instead of a bare
 * `z.string().trim().min(1)`.
 *
 * This closes a real hole rather than tidying one. The importer does NOT call
 * `validateContentPublication`, so before this change a package could carry
 * `<script>` in a lesson section, a report prompt or a gate explanation, pass
 * package validation, be imported, and only be refused later at publication —
 * and gate explanations and report prompts never go through publication
 * validation at all.
 *
 * The `legacy_v1` policy is used for these fields (not `blocks_v2`): it keeps the
 * https-markdown-link allowance that report instructions have always had, while
 * still refusing HTML, event handlers, non-https schemes, encoded tag openers
 * and control/bidi characters. The shipped approved packages contain none of
 * those, so nothing already approved changes meaning.
 */
const text = (max: number, label = "text") => safeText(max, label, "legacy_v1");
const optionalText = (max: number, label = "text") => optionalSafeText(max, label, "legacy_v1");

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

/**
 * PHASE-C. `body` is now the VERSIONED body contract
 * (`src/lib/curriculum/content-body.ts`): legacy v1 or the v2 block model,
 * triaged by an explicit `format`/`version` tag. The shape is no longer restated
 * here — restating it is what let the package schema and the authoring schema
 * drift into two different definitions of the same column.
 */
const contentLocalizationSchema = z.strictObject({
  locale: localeSchema,
  title: text(300, "content title"),
  subtitle: optionalText(1_000, "content subtitle"),
  learningObjectiveExtension: optionalText(4_000, "learningObjectiveExtension"),
  summary: optionalText(8_000, "content summary"),
  transcript: optionalText(200_000, "transcript").nullable(),
  body: contentBodySchema,
});

/**
 * PHASE-C §10 — the asset URL contract is enforced HERE, not only at publication.
 *
 * `contentAssetPayloadSchema` (the authoring path) has always required absolute
 * HTTPS without userinfo; the package path accepted any non-empty string, so an
 * `http://` or `javascript:` asset URL could be imported and would only be
 * caught if someone later republished the content version. The two paths write
 * the same column, so they now enforce the same rule.
 *
 * Structural only: the URL must be well-formed and safe. Whether the object is
 * actually reachable is FUTURE ASSET AVAILABILITY QA and deliberately not part
 * of package validation — validating a package must never require the network.
 */
const contentAssetSchema = z.strictObject({
  kind: z.enum(["video", "subtitles", "image", "chart", "attachment"]),
  assetCode: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64),
  locale: localeSchema.nullable(),
  url: z
    .string()
    .trim()
    .min(1)
    .max(2_000)
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "";
      } catch {
        return false;
      }
    }, "asset URL must be absolute HTTPS without userinfo"),
  mimeType: z.string().trim().min(1).max(255).regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i),
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

/**
 * PROGRESSION OWNER — the mentor grading standard a report is approved against.
 *
 * ============================ WHY IT IS HERE ============================
 * `LevelReportBinding.reportRubricVersionId` is NOT NULL and
 * `ReportRubricVersion` is ASSIGNMENT-scoped, so a report level has no
 * completion owner until a rubric exists for its own assignment. Revision 1 of
 * this package carried the assignment and no rubric, and recorded the fact in
 * its own `pendingApprovals` (`element: "report_rubric"`). The importer then
 * refused — correctly — to invent one, and `ata-v2@v3` published a level 3 that
 * no learner can ever complete.
 *
 * The rubric is therefore product data the package MUST be able to carry, not a
 * row the importer may make up. It is optional so that every already-approved
 * artifact keeps validating unchanged; a package that omits it is still a valid
 * package, and still an unpublishable curriculum once the completeness gate
 * (`resource-completeness.ts`) sees a `report_approval` level with no owner.
 *
 * Criteria carry no weights and no pass threshold: `validateReportRubricPublication`
 * refuses a profit-only criterion, and the review domain — not the rubric —
 * decides approval. The shape below is exactly the four tables the authoring
 * domain writes, so an imported rubric and an authored one are the same graph.
 */
const reportRubricCriterionSchema = z.strictObject({
  stableKey: z.string().trim().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(64),
  /** Grouping label, e.g. `review`. Profit-only categories are refused later. */
  categoryCode: z.string().trim().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(64),
  sortOrder: z.number().int().min(0).max(999),
  commentRequired: z.boolean(),
  localizations: z
    .array(
      z.strictObject({
        locale: localeSchema,
        title: text(300, "criterion title"),
        /** May be empty: the title alone can be the whole criterion. */
        description: optionalText(2_000, "criterion description"),
      }),
    )
    .min(1)
    .max(20),
});

const reportRubricScaleOptionSchema = z.strictObject({
  stableKey: z.string().trim().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(64),
  ordinal: z.number().int().min(0).max(999),
  localizations: z
    .array(
      z.strictObject({
        locale: localeSchema,
        label: text(300, "scale label"),
        description: optionalText(2_000, "scale description"),
      }),
    )
    .min(1)
    .max(20),
});

const reportRejectionReasonSchema = z.strictObject({
  stableKey: z.string().trim().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/).max(64),
  sortOrder: z.number().int().min(0).max(999),
  active: z.boolean(),
  localizations: z
    .array(
      z.strictObject({
        locale: localeSchema,
        title: text(300, "rejection reason title"),
        guidance: text(2_000, "rejection reason guidance"),
      }),
    )
    .min(1)
    .max(20),
});

export const reportRubricSchema = z.strictObject({
  /** Source-stable identity, like `reportCode`. Not a database column. */
  rubricCode: z.string().trim().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/).max(120),
  versionNumber: z.number().int().positive().max(10_000),
  status: z.enum(["draft", "published"]),
  criteria: z.array(reportRubricCriterionSchema).min(1).max(50),
  /**
   * At least one NEUTRAL scale option. `validateReportRubricPublication`
   * requires one; a rubric with none cannot be published and so could never
   * back a binding.
   */
  scaleOptions: z.array(reportRubricScaleOptionSchema).min(1).max(20),
  /** At least one ACTIVE reason, enforced by the package validator. */
  rejectionReasons: z.array(reportRejectionReasonSchema).min(1).max(50),
  provenance: provenanceRecordSchema,
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
  /**
   * OPTIONAL, and the option is the compatibility contract: revision 1 of
   * `ata-v2.canonical-100` and both approved first-slice revisions omit it, so
   * they keep parsing and keep their fingerprints. `null` and absent mean the
   * same thing — no rubric was declared — and both leave the level without a
   * completion owner.
   */
  rubric: reportRubricSchema.nullable().optional(),
  provenance: provenanceRecordSchema,
});

/* -------------------------------- levels -------------------------------- */

/**
 * PROGRESSION OWNER — the threshold a `financial_checkpoint` is verified against.
 *
 * Stored in the units the runtime actually compares: `LevelCheckpointRequirement`
 * has `thresholdCurrency` + `thresholdMinorUnits`, both NOT NULL, and
 * `checkpoint-verification.ts` returns `CHECKPOINT_REQUIREMENT_UNCONFIGURED`
 * without them. Revision 1 of this package carried only `integrationCode`, so
 * the `$50` in a level TITLE was the only place the number existed and all 20
 * checkpoints were unverifiable.
 *
 * Money is never a float and never a display string: `"$1,000"` is not a
 * threshold, `100000` minor units of `USD` is. The currency is an enum of one
 * because the requirement table's CHECK constraint is — a currency the platform
 * cannot compare against must be an `unsupported_currency` outcome, never a
 * silently coerced comparison.
 *
 * Optional for the same compatibility reason as `report.rubric`.
 */
const gateRequirementSchema = z.strictObject({
  thresholdCurrency: z.enum(["USD"]),
  thresholdMinorUnits: z.number().int().positive().max(1_000_000_000),
  provenance: provenanceRecordSchema,
});

const gateSchema = z.strictObject({
  /** Completion is produced outside the learner UI. Never client-completable. */
  completionSource: z.enum(["external_event", "financial_checkpoint"]),
  integrationCode: z.string().trim().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/).max(120),
  selfCompletable: z.literal(false),
  blockedExplanation: z
    .array(z.strictObject({ locale: localeSchema, text: text(2_000) }))
    .min(1)
    .max(20),
  /**
   * Only a `financial_checkpoint` may carry one — enforced in the package
   * validator, which can see `completionSource` and this field together. An
   * `external_event` gate has no balance to compare.
   */
  requirement: gateRequirementSchema.nullable().optional(),
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
  /**
   * CORRECTIONS §14 — is `xpReward` a PRODUCT DECISION or a placeholder?
   *
   * The independent audit established that no authoritative non-zero XP
   * schedule exists in any accepted source: Academy's fixture says in its own
   * header that it carries "no XP logic", `CURRICULUM_AND_UNLOCKS.md` never
   * mentions XP, and `les-prog.txt` mentions it only as a concept. Zero is
   * therefore honest — but `xpReward: 0` on a lesson cannot be allowed to mean
   * "the product decided this lesson is worth nothing", because no such decision
   * was ever taken.
   *
   * This field carries that distinction rather than inventing a schedule:
   *
   *   "approved"   — the zero is a real product decision. Gates are the only
   *                  case today: an `external_event` or `financial_checkpoint`
   *                  level awards no XP BY DESIGN, and the generic validator
   *                  already refuses a gate that awards any.
   *   "unresolved" — the number is a compatibility placeholder and the product
   *                  decision is still outstanding.
   *
   * Optional with an "approved" default so every already-shipped package keeps
   * validating byte-identically and no existing fingerprint moves. The ATA-100
   * profile is where "unresolved" becomes a release gate: a DRAFT may carry it
   * freely, an APPROVED full-product package may not.
   */
  xpRewardStatus: z.enum(["approved", "unresolved"]).optional(),
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
        /**
         * CORRECTIONS §5 — «proposed» is not «missing».
         *
         * The audit blocked the previous candidate partly on this enum: 57
         * video lessons whose question banks EXIST as a production-ready
         * editorial proposal were recorded as `MISSING`, which asserts they do
         * not exist. `PROPOSED` is the state the product actually has, and it is
         * distinct from both neighbours in a way that matters:
         *
         *   MISSING     nobody has written it — production work is outstanding
         *   PROPOSED    it exists and is awaiting approval — REVIEW is outstanding
         *   CONFLICTING two accepted sources disagree — a DECISION is outstanding
         *
         * All three still set `blocksReadiness`, so nothing becomes shippable by
         * being relabelled; what changes is that a content plan can now tell the
         * difference between "write 232 questions" and "review 232 questions".
         */
        classification: z.enum(["MISSING", "PROPOSED", "CONFLICTING"]),
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
export type PackageReportRubric = z.infer<typeof reportRubricSchema>;
export type PackageGate = z.infer<typeof gateSchema>;
export type PackageGateRequirement = z.infer<typeof gateRequirementSchema>;
