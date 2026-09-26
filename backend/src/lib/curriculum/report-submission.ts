import { createHash } from "node:crypto";
import { Prisma, type PrismaClient, type ReportCommandType } from "@prisma/client";
import { z } from "zod";
import { CURRICULUM_AUDIT_ACTIONS, STABLE_CODE_PATTERN } from "@/lib/curriculum/constants";
import { ReportDomainError, isReportDomainError } from "@/lib/curriculum/report-errors";
import {
  reportAssignmentLocalizationPayloadSchema,
  reportCriterionLocalizationPayloadSchema,
  reportCriterionPayloadSchema,
  reportFieldDefinitionPayloadSchema,
  reportFieldLocalizationPayloadSchema,
  reportLocaleSchema,
  reportReasonLocalizationPayloadSchema,
  reportReasonPayloadSchema,
  reportScaleLocalizationPayloadSchema,
  reportScaleOptionPayloadSchema,
} from "@/lib/curriculum/report-schemas";
import {
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
  isCurriculumV2ReportAttachmentsEnabled,
  isCurriculumV2ReportEnabled,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { emitReportSubmittedEvent } from "@/lib/growth/product-events";
import { resolveUserCurriculumLevelStates } from "@/lib/curriculum/level-state";
import { resolveUserCurriculumContext } from "@/lib/curriculum/resolver";
import {
  ensureReportReviewWorkItem,
  reconcileReportReviewOperationalState,
  resolveOperationalActor,
} from "@/lib/learner-ops/review-work-items";
import {
  isRequiredWhenActive,
  parseRequiredWhen,
  validateRequiredWhen,
  type RequiredWhen,
  type RequiredWhenFieldRef,
} from "@/lib/curriculum/report-required-when";

const MAX_INT = 2_147_483_647;
const MAX_COMMAND_BYTES = 256 * 1024;
const MAX_COMMAND_DEPTH = 10;
const MAX_COMMAND_NODES = 5_000;
const MAX_FIELD_VALUE_BYTES = 256 * 1024;
const MAX_TRANSACTION_ATTEMPTS = 3;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
const UNSAFE_TEXT = /<\/?[a-z][^>]*>|\bon[a-z]+\s*=|javascript\s*:|data\s*:/i;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

type TransactionClient = Prisma.TransactionClient;
type Selector = { levelNumber: number; stableCode?: never } | { stableCode: string; levelNumber?: never };
type CommandDb = Pick<PrismaClient, "$transaction">;

const selectorSchema = z.union([
  z.strictObject({ levelNumber: z.number().int().positive().max(MAX_INT) }),
  z.strictObject({ stableCode: z.string().trim().regex(STABLE_CODE_PATTERN) }),
]);
const commandBase = {
  levelNumber: z.number().int().positive().max(MAX_INT).optional(),
  stableCode: z.string().trim().regex(STABLE_CODE_PATTERN).optional(),
  requestId: z.string().trim().regex(REQUEST_ID),
  expectedRevision: z.number().int().nonnegative().max(MAX_INT - 1),
};
const saveCommandSchema = z.strictObject({
  ...commandBase,
  fieldValues: z.record(z.string(), z.unknown()),
}).refine((value) => Number(value.levelNumber !== undefined) + Number(value.stableCode !== undefined) === 1, {
  message: "exactly one level selector is required",
});
const transitionCommandSchema = z.strictObject(commandBase).refine(
  (value) => Number(value.levelNumber !== undefined) + Number(value.stableCode !== undefined) === 1,
  { message: "exactly one level selector is required" },
);

export type ResolveOwnReportContextInput = {
  actorUserId: number;
  locale: string;
  db?: TransactionClient;
} & Selector;

export type ReportReadSafeReason =
  | "report_not_configured"
  | "localization_unavailable"
  | "level_not_accessible"
  | "level_not_started"
  | "wrong_level_type"
  | "binding_corrupt"
  | "assignment_corrupt"
  | "submission_corrupt"
  | "revision_pointer_corrupt"
  | "receipt_corrupt";

export type SafeReportPresentation = {
  level: {
    levelNumber: number;
    stableCode: string;
    type: "report";
    title: string;
    shortDescription: string;
    learningObjective: string;
  };
  assignment: {
    versionNumber: number;
    locale: string;
    title: string;
    instructions: string;
    successCriteriaSummary: string;
    submitLabel: string;
    fields: Array<{
      stableKey: string;
      type: "short_text" | "long_text" | "url" | "integer" | "boolean" | "single_choice" | "multi_choice";
      required: boolean;
      sortOrder: number;
      validation: Prisma.JsonValue | null;
      /**
       * Bounded conditional requiredness (RC-1). Safe declarative rule only: a
       * controller field code, the `equals` operator and a typed value. Never an
       * executable expression, a database id, or the correct-answer of anything.
       */
      requiredWhen: { fieldCode: string; operator: "equals"; value: boolean | string | number | null } | null;
      choices: Array<{ code: string; label: string }>;
      label: string;
      helpText: string;
      placeholder: string;
    }>;
  };
  rubric: {
    versionNumber: number;
    criteria: Array<{
      stableKey: string;
      categoryCode: string;
      sortOrder: number;
      commentRequired: boolean;
      title: string;
      description: string;
    }>;
    scale: Array<{
      stableKey: string;
      ordinal: number;
      label: string;
      description: string;
    }>;
  };
};

export type SafeReportSubmission = {
  status: "draft" | "pending_review" | "approved" | "rejected";
  workflowVersion: number;
  activeRevisionNumber: number | null;
  submittedRevisionNumber: number | null;
  approvedRevisionNumber: number | null;
  fieldValues: Record<string, unknown>;
  firstSubmittedAt: string | null;
  submittedAt: string | null;
  rejection: {
    reasonCode: string;
    reasonTitle: string;
    humanComment: string;
    correctiveAction: string;
    reviewedAt: string;
  } | null;
  history: Array<{
    revisionNumber: number;
    kind: "draft_autosave" | "initial_submission" | "resubmission";
    createdAt: string;
    submittedAt: string | null;
    /**
     * The completed, learner-visible review OF THIS REVISION, or null while it
     * has not been reviewed.
     *
     * ADDITIVE AND CORRELATED BY REVISION. A consumer that does not know this
     * field keeps working, and one that does never has to guess which review
     * belongs to which version by comparing timestamps — the nesting is the
     * correlation.
     *
     * SINGULAR BECAUSE THE SCHEMA IS. `ReportReview` carries
     * `@@unique([revisionId])`, so a revision can never accumulate a second
     * review. An array here would advertise a multiplicity the database
     * forbids, and every consumer would have to write a loop that can only ever
     * run once — and decide, wrongly, what to do if it ran twice.
     */
    review: LearnerReportReviewEvent | null;
  }>;
};

/**
 * ONE COMPLETED REVIEW, as the learner may see it.
 *
 * WHY THIS EXISTS. `rejection` above reports only `latestReview`, and only
 * while its decision is `rejected`. So the moment a report is accepted, every
 * review it ever received becomes invisible: a learner who submitted, was asked
 * to correct something, corrected it and was accepted could see the two
 * versions but nothing about the request that produced the second one.
 *
 * WHAT AN APPROVED EVENT CARRIES. Its decision and when it was made, and
 * nothing else. The rejection fields stay null rather than borrowing the words
 * of an earlier rejection — an acceptance did not say those things.
 */
export type LearnerReportReviewEvent = {
  decision: "approved" | "rejected";
  reviewedAt: string;
  reasonCode: string | null;
  reasonTitle: string | null;
  humanComment: string | null;
  correctiveAction: string | null;
};

export type ResolveOwnReportContextResult =
  | { kind: "disabled" }
  | { kind: "user_not_found" }
  | { kind: "not_enrolled" }
  | { kind: "unavailable"; reason: ReportReadSafeReason }
  | { kind: "locked"; reason: "level_not_accessible" }
  | ({ kind: "available"; submission: null } & SafeReportPresentation)
  | ({ kind: "draft"; submission: SafeReportSubmission } & SafeReportPresentation)
  | ({ kind: "pending_review"; submission: SafeReportSubmission } & SafeReportPresentation)
  | ({ kind: "rejected"; submission: SafeReportSubmission } & SafeReportPresentation)
  | ({ kind: "approved"; submission: SafeReportSubmission } & SafeReportPresentation)
  | { kind: "corrupt"; reason: ReportReadSafeReason };

export type SafeReportCommandResult = {
  kind: "saved" | "submitted" | "resubmitted";
  created: boolean;
  retry: boolean;
  acceptedRevision: number;
  resultingWorkflowVersion: number;
  appliedAt: string;
  submission: SafeReportSubmission;
};

type Scope = {
  actorUserId: number;
  enrollmentId: number;
  enrollmentStatus: "active" | "completed";
  curriculumVersionId: number;
  curriculumStatus: "published" | "archived";
  level: {
    id: number;
    levelNumber: number;
    stableCode: string;
    type: string;
    completionMethod: string;
    title: string;
    shortDescription: string;
    learningObjective: string;
    status: string;
  };
  progress: {
    id: number;
    status: "in_progress" | "pending_review" | "completed";
  } | null;
  access: "available" | "locked" | "in_progress" | "pending_review" | "completed";
};

type DefinitionGraph = {
  assignment: Prisma.ReportAssignmentVersionGetPayload<{
    include: { localizations: true; fields: { include: { localizations: true } } };
  }>;
  rubric: Prisma.ReportRubricVersionGetPayload<{
    include: {
      criteria: { include: { localizations: true } };
      scaleOptions: { include: { localizations: true } };
      rejectionReasons: { include: { localizations: true } };
    };
  }>;
};

type SubmissionGraph = Prisma.ReportSubmissionGetPayload<{
  include: {
    revisions: { include: { reviews: { include: { reason: { include: { localizations: true } } } } } };
    receipts: true;
    latestReview: { include: { reason: { include: { localizations: true } } } };
  };
}>;

/**
 * THE ONE PROJECTION OF A REVIEW, used by all three learner read paths.
 *
 * The context read, the revision list and the revision detail each used to
 * inline their own copy of these five fields. Three copies of a privacy
 * boundary is three chances to widen one of them by accident, so the boundary
 * is written once, here, as an explicit construction.
 *
 * WHAT IS DELIBERATELY ABSENT, and must stay absent: `reviewerId`, the
 * reviewer's name, `reviewerRoleSnapshot`, `claimedAt`, `claimExpiresAt`,
 * `requestId`, `payloadFingerprint`, rubric `scores`, and every database id.
 * Nothing here spreads a Prisma row — each field is named.
 */
type LearnerReviewRow = {
  decision: string;
  reviewedAt: Date;
  humanComment: string | null;
  correctiveAction: string | null;
  reason: { stableKey: string; localizations: Array<{ locale: string; title: string }> } | null;
};

/**
 * The four rejection fields as a REJECTION carries them — all four present, or
 * nothing. Declared separately from `LearnerReportReviewEvent`, whose copies
 * are nullable because an approved review has none of them: picking from the
 * event would make these four nullable too and quietly let a half-built
 * rejection through the older `rejection` field, which promises all four.
 */
type LearnerRejectionFields = {
  reasonCode: string;
  reasonTitle: string;
  humanComment: string;
  correctiveAction: string;
};

/** The four rejection fields, or null when they are not all available. */
function learnerRejectionFields(
  review: LearnerReviewRow,
  locale: string | null | undefined,
): LearnerRejectionFields | null {
  if (review.decision !== "rejected") return null;
  const reason = review.reason;
  const localization = locale ? reason?.localizations.find((item) => item.locale === locale) : null;
  if (!reason || !localization || !review.humanComment || !review.correctiveAction) return null;
  return {
    reasonCode: reason.stableKey,
    reasonTitle: localization.title,
    humanComment: review.humanComment,
    correctiveAction: review.correctiveAction,
  };
}

/**
 * One review as a learner-visible event. An approved review reports its
 * decision and its time with the four rejection fields null; a rejected one
 * reports them when the reason, its localization, the comment and the
 * corrective action are all present, and null when any is missing — a partial
 * rejection is never assembled, and never filled in from a different review.
 */
function learnerReviewEvent(review: LearnerReviewRow, locale: string | null | undefined): LearnerReportReviewEvent | null {
  if (review.decision !== "approved" && review.decision !== "rejected") return null;
  const fields = learnerRejectionFields(review, locale);
  return {
    decision: review.decision,
    reviewedAt: review.reviewedAt.toISOString(),
    reasonCode: fields?.reasonCode ?? null,
    reasonTitle: fields?.reasonTitle ?? null,
    humanComment: fields?.humanComment ?? null,
    correctiveAction: fields?.correctiveAction ?? null,
  };
}

/**
 * The review of one revision, or null. The schema allows one; a row that is
 * neither approved nor rejected is not a completed review and yields null
 * rather than a half-event.
 */
function learnerReviewOf(
  reviews: readonly LearnerReviewRow[],
  locale: string | null | undefined,
): LearnerReportReviewEvent | null {
  const row = reviews[0];
  return row ? learnerReviewEvent(row, locale) : null;
}

function flagsEnabled() {
  return isCurriculumV2ReadEnabled() && isCurriculumV2EnrollmentEnabled() && isCurriculumV2ReportEnabled();
}

function fail(code: ConstructorParameters<typeof ReportDomainError>[0], message: string): never {
  throw new ReportDomainError(code, message);
}

function safeDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

function parseSelector(input: { levelNumber?: number; stableCode?: string }): Selector | null {
  const candidate = input.levelNumber !== undefined
    ? { levelNumber: input.levelNumber, ...(input.stableCode !== undefined ? { stableCode: input.stableCode } : {}) }
    : { stableCode: input.stableCode };
  const parsed = selectorSchema.safeParse(candidate);
  return parsed.success ? parsed.data as Selector : null;
}

function assertSafeStructure(value: unknown, maxBytes = MAX_COMMAND_BYTES) {
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { fail("REPORT_DRAFT_INPUT_INVALID", "report input must be JSON serializable"); }
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > maxBytes) {
    fail("REPORT_DRAFT_INPUT_INVALID", "report input is too large");
  }
  let nodes = 0;
  const visit = (current: unknown, depth: number) => {
    nodes += 1;
    if (nodes > MAX_COMMAND_NODES || depth > MAX_COMMAND_DEPTH) fail("REPORT_DRAFT_INPUT_INVALID", "report input is too complex");
    if (current === null || typeof current !== "object") return;
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string" || DANGEROUS_KEYS.has(key.toLowerCase())) fail("REPORT_DRAFT_INPUT_INVALID", "report input contains a forbidden key");
      visit((current as Record<string, unknown>)[key], depth + 1);
    }
  };
  visit(value, 0);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function hash(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

async function resolveScopeWithin(
  tx: TransactionClient,
  actorUserId: number,
  selector: Selector,
  evaluationTime: Date,
): Promise<Scope | ResolveOwnReportContextResult> {
  const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { id: true, status: true } });
  if (!user || user.status !== "active") return { kind: "user_not_found" };
  const context = await resolveUserCurriculumContext({ userId: actorUserId, asOf: evaluationTime, db: tx });
  if (context.kind === "disabled") return { kind: "disabled" };
  if (context.kind === "user_not_found") return { kind: "user_not_found" };
  if (context.kind === "candidate" || context.kind === "unavailable") return { kind: "not_enrolled" };
  if (context.kind === "corrupt") return { kind: "corrupt", reason: "submission_corrupt" };
  if (context.kind !== "enrolled" && context.kind !== "completed") return { kind: "not_enrolled" };
  const level = context.levels.find((item) => "levelNumber" in selector ? item.levelNumber === selector.levelNumber : item.stableCode === selector.stableCode);
  if (!level) return { kind: "unavailable", reason: "level_not_accessible" };
  const moduleDefinition = context.modules.find((item) => item.id === level.moduleId);
  if (!moduleDefinition || level.status !== "active" || moduleDefinition.status !== "active") return { kind: "unavailable", reason: "level_not_accessible" };
  if (level.type !== "report" || level.completionMethod !== "report_approval") return { kind: "unavailable", reason: "wrong_level_type" };
  const durable = context.progress.find((item) => item.levelDefinitionId === level.id) ?? null;
  let access: Scope["access"];
  if (context.kind === "completed") {
    if (!durable || durable.status !== "completed") return { kind: "unavailable", reason: "level_not_accessible" };
    access = "completed";
  } else {
    const states = await resolveUserCurriculumLevelStates({ userId: actorUserId, asOf: evaluationTime, db: tx });
    if (states.kind === "corrupt") return { kind: "corrupt", reason: "submission_corrupt" };
    if (states.kind !== "resolved") return { kind: "not_enrolled" };
    const state = states.levels.find((item) => item.levelDefinition.id === level.id);
    if (!state) return { kind: "corrupt", reason: "submission_corrupt" };
    // `checkpoint_unverified` is unreachable here (the level type is already
    // constrained to `report` above) but is folded into `locked` so a future
    // state can never widen report access by falling through.
    access =
      state.state === "locked" ||
      state.state === "xp_eligible" ||
      state.state === "checkpoint_unverified"
        ? "locked"
        : state.state;
  }
  return {
    actorUserId,
    enrollmentId: context.enrollment.id,
    enrollmentStatus: context.enrollment.status as Scope["enrollmentStatus"],
    curriculumVersionId: context.curriculumVersion.id,
    curriculumStatus: context.curriculumVersion.status as Scope["curriculumStatus"],
    level: {
      id: level.id, levelNumber: level.levelNumber, stableCode: level.stableCode, type: level.type,
      completionMethod: level.completionMethod, title: level.title, shortDescription: level.shortDescription,
      learningObjective: level.learningObjective, status: level.status,
    },
    progress: durable ? { id: durable.id, status: durable.status as "in_progress" | "pending_review" | "completed" } : null,
    access,
  };
}

async function loadSubmission(tx: TransactionClient, scope: Scope): Promise<SubmissionGraph | null> {
  return tx.reportSubmission.findUnique({
    where: { enrollmentId_levelDefinitionId: { enrollmentId: scope.enrollmentId, levelDefinitionId: scope.level.id } },
    include: {
      /* Reviews are loaded THROUGH the revision they reviewed, so the pairing
         is structural rather than a timestamp comparison. History order is the
         canonical `revisionNumber`; `reviewedAt` is the time an event happened,
         never the thing that orders the history. The nested `orderBy` is
         defensive only — `@@unique([revisionId])` allows one row. */
      revisions: {
        orderBy: [{ revisionNumber: "asc" }, { id: "asc" }],
        include: {
          reviews: {
            include: { reason: { include: { localizations: true } } },
            orderBy: [{ id: "asc" }],
          },
        },
      },
      receipts: { where: { actorUserId: scope.actorUserId }, orderBy: [{ appliedAt: "asc" }, { id: "asc" }] },
      latestReview: { include: { reason: { include: { localizations: true } } } },
    },
  });
}

async function loadDefinitionGraph(tx: TransactionClient, scope: Scope, submission: SubmissionGraph | null): Promise<DefinitionGraph | ResolveOwnReportContextResult> {
  let assignmentId: number;
  let rubricId: number;
  let pinned = false;
  if (submission) {
    assignmentId = submission.reportAssignmentVersionId;
    rubricId = submission.reportRubricVersionId;
    pinned = true;
  } else {
    const binding = await tx.levelReportBinding.findUnique({ where: { levelDefinitionId: scope.level.id } });
    if (!binding) return { kind: "unavailable", reason: "report_not_configured" };
    if (binding.levelDefinitionId !== scope.level.id || binding.curriculumVersionId !== scope.curriculumVersionId) return { kind: "corrupt", reason: "binding_corrupt" };
    assignmentId = binding.reportAssignmentVersionId;
    rubricId = binding.reportRubricVersionId;
  }
  const [assignment, rubric] = await Promise.all([
    tx.reportAssignmentVersion.findUnique({ where: { id: assignmentId }, include: { localizations: true, fields: { include: { localizations: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } }),
    tx.reportRubricVersion.findUnique({ where: { id: rubricId }, include: {
      criteria: { include: { localizations: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      scaleOptions: { include: { localizations: true }, orderBy: [{ ordinal: "asc" }, { id: "asc" }] },
      rejectionReasons: { include: { localizations: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    } }),
  ]);
  if (!assignment || !rubric) return { kind: "corrupt", reason: "assignment_corrupt" };
  if (
    assignment.id !== assignmentId || assignment.levelDefinitionId !== scope.level.id || assignment.curriculumVersionId !== scope.curriculumVersionId ||
    rubric.id !== rubricId || rubric.reportAssignmentVersionId !== assignment.id
  ) return { kind: "corrupt", reason: "assignment_corrupt" };
  const allowed = pinned ? new Set(["published", "archived"]) : new Set(["published"]);
  if (!allowed.has(assignment.status) || !allowed.has(rubric.status)) return { kind: "corrupt", reason: "assignment_corrupt" };
  if (!pinned && (!assignment.publishedAt || !rubric.publishedAt)) return { kind: "corrupt", reason: "assignment_corrupt" };
  return { assignment, rubric };
}

type ParsedField = z.infer<typeof reportFieldDefinitionPayloadSchema> & {
  id: number;
  requiredWhen: RequiredWhen | null;
  localizations: DefinitionGraph["assignment"]["fields"][number]["localizations"];
};

function parseDefinitionGraph(graph: DefinitionGraph): ParsedField[] | null {
  const fields: ParsedField[] = [];
  const keys = new Set<string>();
  const orders = new Set<number>();
  for (const field of graph.assignment.fields) {
    const parsed = reportFieldDefinitionPayloadSchema.safeParse({
      stableKey: field.stableKey, type: field.type, required: field.required, sortOrder: field.sortOrder,
      validationRules: field.validationRules, choiceCodes: field.choiceCodes,
    });
    // A persisted requiredWhen that does not parse is corrupt: fail closed rather
    // than silently drop the requirement.
    const requiredWhen = parseRequiredWhen(field.requiredWhen);
    if (!parsed.success || !requiredWhen.ok || keys.has(field.stableKey) || orders.has(field.sortOrder)) return null;
    keys.add(field.stableKey); orders.add(field.sortOrder);
    const locales = new Set<string>();
    for (const localization of field.localizations) {
      const checked = reportFieldLocalizationPayloadSchema.safeParse({
        locale: localization.locale, label: localization.label, helpText: localization.helpText,
        placeholder: localization.placeholder, choiceLabels: localization.choiceLabels,
      });
      if (!checked.success || locales.has(localization.locale)) return null;
      locales.add(localization.locale);
    }
    fields.push({ id: field.id, ...parsed.data, requiredWhen: requiredWhen.rule, localizations: field.localizations });
  }
  if (fields.length === 0) return null;
  // A stored condition that is inconsistent with the field set (missing / self /
  // late / type-incompatible controller, or paired with static required) is
  // corrupt: fail closed so no submission is ever validated against it.
  const fieldRefs = new Map<string, RequiredWhenFieldRef>(
    fields.map((field) => [field.stableKey, {
      stableKey: field.stableKey,
      type: field.type,
      sortOrder: field.sortOrder,
      required: field.required,
      choiceCodes: Array.isArray(field.choiceCodes) ? (field.choiceCodes as string[]) : null,
    }]),
  );
  for (const field of fields) {
    if (field.requiredWhen && validateRequiredWhen(field.requiredWhen, fieldRefs.get(field.stableKey)!, fieldRefs)) {
      return null;
    }
  }
  const assignmentLocales = new Set<string>();
  for (const localization of graph.assignment.localizations) {
    const checked = reportAssignmentLocalizationPayloadSchema.safeParse({
      locale: localization.locale, title: localization.title, instructions: localization.instructions,
      successCriteriaSummary: localization.successCriteriaSummary, submitLabel: localization.submitLabel,
    });
    if (!checked.success || assignmentLocales.has(localization.locale)) return null;
    assignmentLocales.add(localization.locale);
  }
  if (assignmentLocales.size === 0 || graph.rubric.criteria.length === 0 || graph.rubric.scaleOptions.length === 0) return null;
  const criterionKeys = new Set<string>();
  const criterionOrders = new Set<number>();
  for (const criterion of graph.rubric.criteria) {
    const checked = reportCriterionPayloadSchema.safeParse({ stableKey: criterion.stableKey, categoryCode: criterion.categoryCode, sortOrder: criterion.sortOrder, commentRequired: criterion.commentRequired });
    if (!checked.success || criterionKeys.has(criterion.stableKey) || criterionOrders.has(criterion.sortOrder) || ["profit", "pnl", "roi", "return"].includes(criterion.categoryCode)) return null;
    criterionKeys.add(criterion.stableKey); criterionOrders.add(criterion.sortOrder);
    const locales = new Set<string>();
    for (const localization of criterion.localizations) {
      const localized = reportCriterionLocalizationPayloadSchema.safeParse({ locale: localization.locale, title: localization.title, description: localization.description });
      if (!localized.success || locales.has(localization.locale)) return null;
      locales.add(localization.locale);
    }
    if (locales.size === 0) return null;
  }
  const scaleKeys = new Set<string>();
  const scaleOrdinals = new Set<number>();
  for (const option of graph.rubric.scaleOptions) {
    const checked = reportScaleOptionPayloadSchema.safeParse({ stableKey: option.stableKey, ordinal: option.ordinal });
    if (!checked.success || scaleKeys.has(option.stableKey) || scaleOrdinals.has(option.ordinal)) return null;
    scaleKeys.add(option.stableKey); scaleOrdinals.add(option.ordinal);
    const locales = new Set<string>();
    for (const localization of option.localizations) {
      const localized = reportScaleLocalizationPayloadSchema.safeParse({ locale: localization.locale, label: localization.label, description: localization.description });
      if (!localized.success || locales.has(localization.locale)) return null;
      locales.add(localization.locale);
    }
    if (locales.size === 0) return null;
  }
  for (const reason of graph.rubric.rejectionReasons) {
    const checked = reportReasonPayloadSchema.safeParse({ stableKey: reason.stableKey, sortOrder: reason.sortOrder, active: reason.active });
    if (!checked.success) return null;
    const locales = new Set<string>();
    for (const localization of reason.localizations) {
      const localized = reportReasonLocalizationPayloadSchema.safeParse({ locale: localization.locale, title: localization.title, guidance: localization.guidance });
      if (!localized.success || locales.has(localization.locale)) return null;
      locales.add(localization.locale);
    }
    if (reason.active && locales.size === 0) return null;
  }
  return fields;
}

function fieldRules(field: ParsedField) {
  return field.validationRules as Record<string, unknown> | null;
}

function normalizeFieldValues(fields: ParsedField[], value: unknown, complete: boolean): Record<string, unknown> {
  assertSafeStructure(value, MAX_FIELD_VALUE_BYTES);
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("REPORT_DRAFT_INPUT_INVALID", "fieldValues must be an object");
  const input = value as Record<string, unknown>;
  const definitions = new Map(fields.map((field) => [field.stableKey, field]));
  for (const key of Object.keys(input)) if (!definitions.has(key)) fail("REPORT_DRAFT_INPUT_INVALID", "fieldValues contains an unknown field");
  const normalized: Record<string, unknown> = {};
  for (const field of [...fields].sort((left, right) => left.sortOrder - right.sortOrder || left.stableKey.localeCompare(right.stableKey))) {
    if (!(field.stableKey in input)) {
      if (complete && field.required) fail("REPORT_DRAFT_INPUT_INVALID", "required report field is missing");
      // Conditional requiredness is evaluated server-side against the submitted
      // controller value already normalized earlier in this pass (the validator
      // guarantees the controller precedes the dependent field). A frontend
      // `isRequired` flag is never consulted. Missing controller -> inactive.
      if (complete && !field.required && field.requiredWhen && isRequiredWhenActive(field.requiredWhen, normalized)) {
        throw new ReportDomainError("REPORT_DRAFT_INPUT_INVALID", "required report field is missing", [
          {
            code: "REQUIRED_WHEN",
            path: field.stableKey,
            message: `field is required when ${field.requiredWhen.fieldCode} equals ${JSON.stringify(field.requiredWhen.value)}`,
          },
        ]);
      }
      continue;
    }
    const raw = input[field.stableKey];
    const rules = fieldRules(field);
    if (field.type === "short_text" || field.type === "long_text") {
      if (typeof raw !== "string") fail("REPORT_DRAFT_INPUT_INVALID", "text report field must be a string");
      const text = raw.trim();
      if (text.length > 16_000 || UNSAFE_TEXT.test(text)) fail("REPORT_DRAFT_INPUT_INVALID", "text report field is unsafe or too long");
      const minimum = typeof rules?.minLength === "number" ? rules.minLength : 0;
      const maximum = typeof rules?.maxLength === "number" ? rules.maxLength : 16_000;
      if (text.length < minimum || text.length > maximum) fail("REPORT_DRAFT_INPUT_INVALID", "text report field violates length rules");
      normalized[field.stableKey] = text;
      continue;
    }
    if (field.type === "url") {
      if (typeof raw !== "string" || raw.length > 2_048 || UNSAFE_TEXT.test(raw)) fail("REPORT_DRAFT_INPUT_INVALID", "URL report field is invalid");
      let url: URL;
      try { url = new URL(raw); } catch { fail("REPORT_DRAFT_INPUT_INVALID", "URL report field is invalid"); }
      if (url.protocol !== "https:" || url.username || url.password) fail("REPORT_DRAFT_INPUT_INVALID", "URL report field must use HTTPS without credentials");
      normalized[field.stableKey] = url.toString();
      continue;
    }
    if (field.type === "integer") {
      if (typeof raw !== "number" || !Number.isSafeInteger(raw)) fail("REPORT_DRAFT_INPUT_INVALID", "integer report field must be a safe integer");
      const minimum = typeof rules?.minValue === "number" ? rules.minValue : Number.MIN_SAFE_INTEGER;
      const maximum = typeof rules?.maxValue === "number" ? rules.maxValue : Number.MAX_SAFE_INTEGER;
      if (raw < minimum || raw > maximum) fail("REPORT_DRAFT_INPUT_INVALID", "integer report field violates range rules");
      normalized[field.stableKey] = raw;
      continue;
    }
    if (field.type === "boolean") {
      if (typeof raw !== "boolean") fail("REPORT_DRAFT_INPUT_INVALID", "boolean report field must be boolean");
      normalized[field.stableKey] = raw;
      continue;
    }
    const codes = new Set(field.choiceCodes ?? []);
    if (field.type === "single_choice") {
      if (typeof raw !== "string" || !codes.has(raw)) fail("REPORT_DRAFT_INPUT_INVALID", "single-choice report field is invalid");
      normalized[field.stableKey] = raw;
      continue;
    }
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string" || !codes.has(item)) || new Set(raw).size !== raw.length) {
      fail("REPORT_DRAFT_INPUT_INVALID", "multi-choice report field is invalid");
    }
    const maximum = typeof rules?.maxSelections === "number" ? rules.maxSelections : codes.size;
    if (raw.length > maximum) fail("REPORT_DRAFT_INPUT_INVALID", "multi-choice report field exceeds selection limit");
    normalized[field.stableKey] = [...raw].sort();
  }
  return normalized;
}

function contentFingerprint(content: Record<string, unknown>) {
  return hash({ version: 1, fieldValues: content });
}

function mapPresentation(scope: Scope, graph: DefinitionGraph, locale: string): SafeReportPresentation | null {
  const assignmentLocalization = graph.assignment.localizations.find((item) => item.locale === locale);
  if (!assignmentLocalization) return null;
  const fields = graph.assignment.fields.map((field) => {
    const localization = field.localizations.find((item) => item.locale === locale);
    if (!localization) return null;
    const labels = localization.choiceLabels && typeof localization.choiceLabels === "object" && !Array.isArray(localization.choiceLabels)
      ? localization.choiceLabels as Record<string, unknown> : {};
    const parsedRequiredWhen = parseRequiredWhen(field.requiredWhen);
    return {
      stableKey: field.stableKey,
      type: field.type,
      required: field.required,
      sortOrder: field.sortOrder,
      validation: field.validationRules,
      requiredWhen: parsedRequiredWhen.ok ? parsedRequiredWhen.rule : null,
      choices: (Array.isArray(field.choiceCodes) ? field.choiceCodes : []).map((code) => ({ code: String(code), label: String(labels[String(code)] ?? "") })),
      label: localization.label,
      helpText: localization.helpText,
      placeholder: localization.placeholder,
    };
  });
  if (fields.some((field) => field === null)) return null;
  const criteria = graph.rubric.criteria.map((criterion) => {
    const localization = criterion.localizations.find((item) => item.locale === locale);
    return localization ? { stableKey: criterion.stableKey, categoryCode: criterion.categoryCode, sortOrder: criterion.sortOrder, commentRequired: criterion.commentRequired, title: localization.title, description: localization.description } : null;
  });
  const scale = graph.rubric.scaleOptions.map((option) => {
    const localization = option.localizations.find((item) => item.locale === locale);
    return localization ? { stableKey: option.stableKey, ordinal: option.ordinal, label: localization.label, description: localization.description } : null;
  });
  if (criteria.some((item) => item === null) || scale.some((item) => item === null)) return null;
  return {
    level: { levelNumber: scope.level.levelNumber, stableCode: scope.level.stableCode, type: "report", title: scope.level.title, shortDescription: scope.level.shortDescription, learningObjective: scope.level.learningObjective },
    assignment: {
      versionNumber: graph.assignment.versionNumber, locale,
      title: assignmentLocalization.title, instructions: assignmentLocalization.instructions,
      successCriteriaSummary: assignmentLocalization.successCriteriaSummary, submitLabel: assignmentLocalization.submitLabel,
      fields: fields as SafeReportPresentation["assignment"]["fields"],
    },
    rubric: { versionNumber: graph.rubric.versionNumber, criteria: criteria as SafeReportPresentation["rubric"]["criteria"], scale: scale as SafeReportPresentation["rubric"]["scale"] },
  };
}

const receiptSafeResultSchema = z.strictObject({
  version: z.literal(1),
  kind: z.enum(["saved", "submitted", "resubmitted"]),
  acceptedRevision: z.number().int().positive().max(MAX_INT),
  resultingWorkflowVersion: z.number().int().positive().max(MAX_INT),
});

type InspectedSubmission = {
  safe: SafeReportSubmission;
  byId: Map<number, SubmissionGraph["revisions"][number]>;
  active: SubmissionGraph["revisions"][number];
  submitted: SubmissionGraph["revisions"][number] | null;
};

function inspectSubmission(
  scope: Scope,
  graph: DefinitionGraph,
  fields: ParsedField[],
  submission: SubmissionGraph,
  locale: string | null,
): InspectedSubmission | ReportReadSafeReason {
  if (
    submission.userId !== scope.actorUserId || submission.enrollmentId !== scope.enrollmentId ||
    submission.curriculumVersionId !== scope.curriculumVersionId || submission.levelDefinitionId !== scope.level.id ||
    submission.userLevelProgressId !== scope.progress?.id || submission.reportAssignmentVersionId !== graph.assignment.id ||
    submission.reportRubricVersionId !== graph.rubric.id || !Number.isSafeInteger(submission.workflowVersion) || submission.workflowVersion < 1
  ) return "submission_corrupt";
  if (submission.revisions.length === 0) return "revision_pointer_corrupt";
  const byId = new Map(submission.revisions.map((revision) => [revision.id, revision]));
  for (let index = 0; index < submission.revisions.length; index += 1) {
    const revision = submission.revisions[index];
    if (revision.revisionNumber !== index + 1 || revision.submissionId !== submission.id || revision.createdById !== scope.actorUserId || !FINGERPRINT.test(revision.contentFingerprint)) return "revision_pointer_corrupt";
    const complete = revision.kind !== "draft_autosave";
    let normalized: Record<string, unknown>;
    try { normalized = normalizeFieldValues(fields, revision.content, complete); } catch { return "revision_pointer_corrupt"; }
    if (contentFingerprint(normalized) !== revision.contentFingerprint || stableJson(normalized) !== stableJson(revision.content)) return "revision_pointer_corrupt";
    if (revision.kind === "draft_autosave") {
      if (revision.submittedAt !== null) return "revision_pointer_corrupt";
    } else {
      if (!revision.submittedAt || revision.sourceRevisionId === null) return "revision_pointer_corrupt";
      const source = byId.get(revision.sourceRevisionId);
      if (!source || source.kind !== "draft_autosave" || source.revisionNumber >= revision.revisionNumber) return "revision_pointer_corrupt";
    }
    if (revision.sourceRevisionId !== null) {
      const source = byId.get(revision.sourceRevisionId);
      if (!source || source.revisionNumber >= revision.revisionNumber) return "revision_pointer_corrupt";
    }
  }
  const active = submission.activeRevisionId ? byId.get(submission.activeRevisionId) ?? null : null;
  const submitted = submission.submittedRevisionId ? byId.get(submission.submittedRevisionId) ?? null : null;
  const approved = submission.approvedRevisionId ? byId.get(submission.approvedRevisionId) ?? null : null;
  if (!active) return "revision_pointer_corrupt";
  if (submission.status === "draft") {
    if (active.kind !== "draft_autosave" || submitted || approved || submission.firstSubmittedAt || submission.submittedAt || submission.latestReviewId) return "submission_corrupt";
  } else if (submission.status === "pending_review") {
    if (!submitted || active.id !== submitted.id || (submitted.kind !== "initial_submission" && submitted.kind !== "resubmission") || !submission.firstSubmittedAt || !submission.submittedAt || approved || submission.rejectedAt) return "submission_corrupt";
  } else if (submission.status === "rejected") {
    if (!submitted || (submitted.kind !== "initial_submission" && submitted.kind !== "resubmission") || !submission.latestReview || submission.latestReview.decision !== "rejected" || submission.latestReview.revisionId !== submitted.id || !submission.reviewedAt || !submission.rejectedAt || approved) return "submission_corrupt";
    if (active.id !== submitted.id && (active.kind !== "draft_autosave" || active.revisionNumber <= submitted.revisionNumber)) return "submission_corrupt";
  } else if (submission.status === "approved") {
    if (!submitted || !approved || active.id !== submitted.id || approved.id !== submitted.id || !submission.latestReview || submission.latestReview.decision !== "approved" || submission.latestReview.revisionId !== submitted.id || submission.approvedReviewId !== submission.latestReview.id || !submission.reviewedAt || !submission.approvedAt) return "submission_corrupt";
  } else return "submission_corrupt";
  const expectedProgress = submission.status === "pending_review" ? "pending_review" : submission.status === "approved" ? "completed" : "in_progress";
  if (scope.progress?.status !== expectedProgress) return "submission_corrupt";
  if (submission.status === "approved" && scope.access !== "completed") return "submission_corrupt";
  if (submission.status !== "approved" && scope.enrollmentStatus !== "active") return "submission_corrupt";
  for (const receipt of submission.receipts) {
    // Attachment command receipts belong to the Phase 5B.5b attachment
    // runtime, which validates their safe-result contract itself; here only
    // the shared durable identity invariants are enforced.
    if (receipt.commandType === "attachment_initiate" || receipt.commandType === "attachment_finalize") {
      if (
        receipt.actorUserId !== scope.actorUserId ||
        receipt.submissionId !== submission.id ||
        !FINGERPRINT.test(receipt.payloadFingerprint)
      ) return "receipt_corrupt";
      continue;
    }
    const safe = receiptSafeResultSchema.safeParse(receipt.safeResult);
    const target = receipt.targetRevisionId ? byId.get(receipt.targetRevisionId) : null;
    const result = receipt.resultRevisionId ? byId.get(receipt.resultRevisionId) : null;
    if (
      receipt.actorUserId !== scope.actorUserId || receipt.submissionId !== submission.id || !FINGERPRINT.test(receipt.payloadFingerprint) ||
      receipt.resultingWorkflowVersion < 1 || receipt.resultingWorkflowVersion > submission.workflowVersion || !safe.success ||
      safe.data.resultingWorkflowVersion !== receipt.resultingWorkflowVersion || !result || safe.data.acceptedRevision !== result.revisionNumber
    ) return "receipt_corrupt";
    if (receipt.commandType === "save_draft") {
      if (safe.data.kind !== "saved" || result.kind !== "draft_autosave") return "receipt_corrupt";
    } else if (receipt.commandType === "submit") {
      if (safe.data.kind !== "submitted" || !target || target.kind !== "draft_autosave" || result.kind !== "initial_submission" || result.sourceRevisionId !== target.id) return "receipt_corrupt";
    } else if (receipt.commandType === "resubmit") {
      if (safe.data.kind !== "resubmitted" || !target || target.kind !== "draft_autosave" || result.kind !== "resubmission" || result.sourceRevisionId !== target.id) return "receipt_corrupt";
    }
  }
  let fieldValues: Record<string, unknown>;
  try { fieldValues = normalizeFieldValues(fields, active.content, active.kind !== "draft_autosave"); } catch { return "revision_pointer_corrupt"; }
  /* UNCHANGED BEHAVIOUR, ONE FEWER COPY. This still reports only the latest
     review and only while it is a rejection, and it still treats an incomplete
     rejection as a corrupt submission when a locale was asked for. What moved
     is where the five fields are named: `learnerRejectionFields` now owns that,
     so this path and the two history paths cannot drift apart. */
  let rejection: SafeReportSubmission["rejection"] = null;
  if (submission.latestReview?.decision === "rejected") {
    const review = submission.latestReview;
    const fields = learnerRejectionFields(review, locale);
    if (!fields) {
      if (locale) return "submission_corrupt";
    } else {
      rejection = { ...fields, reviewedAt: review.reviewedAt.toISOString() };
    }
  }
  return {
    byId, active, submitted,
    safe: {
      status: submission.status,
      workflowVersion: submission.workflowVersion,
      activeRevisionNumber: active.revisionNumber,
      submittedRevisionNumber: submitted?.revisionNumber ?? null,
      approvedRevisionNumber: approved?.revisionNumber ?? null,
      fieldValues,
      firstSubmittedAt: safeDate(submission.firstSubmittedAt),
      submittedAt: safeDate(submission.submittedAt),
      rejection,
      history: submission.revisions.map((revision) => ({
        revisionNumber: revision.revisionNumber,
        kind: revision.kind,
        createdAt: revision.createdAt.toISOString(),
        submittedAt: safeDate(revision.submittedAt),
        /* The completed review of THIS revision, or null while none exists. */
        review: learnerReviewOf(revision.reviews, locale),
      })),
    },
  };
}

function resultKind(status: SafeReportSubmission["status"]): "draft" | "pending_review" | "rejected" | "approved" {
  return status;
}

async function resolveWithin(
  tx: TransactionClient,
  data: Omit<ResolveOwnReportContextInput, "db">,
  evaluationTime: Date,
): Promise<ResolveOwnReportContextResult> {
  const selector = parseSelector(data);
  const locale = reportLocaleSchema.safeParse(data.locale);
  if (!selector || !locale.success || locale.data !== data.locale.trim() || !Number.isSafeInteger(data.actorUserId) || data.actorUserId < 1) return { kind: "unavailable", reason: "level_not_accessible" };
  const scopeResult = await resolveScopeWithin(tx, data.actorUserId, selector, evaluationTime);
  if ("kind" in scopeResult) return scopeResult;
  const scope = scopeResult;
  if (scope.access === "locked") return { kind: "locked", reason: "level_not_accessible" };
  const submission = await loadSubmission(tx, scope);
  const graphResult = await loadDefinitionGraph(tx, scope, submission);
  if ("kind" in graphResult) return graphResult;
  const fields = parseDefinitionGraph(graphResult);
  if (!fields) return { kind: "corrupt", reason: "assignment_corrupt" };
  const presentation = mapPresentation(scope, graphResult, locale.data);
  if (!presentation) return { kind: "unavailable", reason: "localization_unavailable" };
  if (!submission) {
    if (scope.access === "pending_review" || scope.access === "completed") return { kind: "corrupt", reason: "submission_corrupt" };
    return { kind: "available", submission: null, ...presentation };
  }
  const inspected = inspectSubmission(scope, graphResult, fields, submission, locale.data);
  if (typeof inspected === "string") return { kind: "corrupt", reason: inspected };
  return { kind: resultKind(inspected.safe.status), submission: inspected.safe, ...presentation };
}

export async function resolveOwnReportContext(input: ResolveOwnReportContextInput): Promise<ResolveOwnReportContextResult> {
  if (!flagsEnabled()) return { kind: "disabled" };
  const { db, ...data } = input;
  const evaluationTime = new Date();
  if (db) return resolveWithin(db, data, evaluationTime);
  return prisma.$transaction((tx) => resolveWithin(tx, data, evaluationTime));
}

// --- owner revision history (read-only) -------------------------------------

type OwnReportHistoryFailure = Exclude<
  ResolveOwnReportContextResult,
  { kind: "available" | "draft" | "pending_review" | "rejected" | "approved" }
>;

type OwnReportHistoryContext =
  | OwnReportHistoryFailure
  | { kind: "no_submission" }
  | { kind: "ok"; scope: Scope; fields: ParsedField[]; submission: SubmissionGraph; inspected: InspectedSubmission };

async function loadOwnHistoryWithin(
  tx: TransactionClient,
  data: { actorUserId: number; locale: string; levelNumber?: number; stableCode?: string },
  evaluationTime: Date,
): Promise<OwnReportHistoryContext> {
  const selector = parseSelector(data);
  const locale = reportLocaleSchema.safeParse(data.locale);
  if (!selector || !locale.success || locale.data !== data.locale.trim() || !Number.isSafeInteger(data.actorUserId) || data.actorUserId < 1) {
    return { kind: "unavailable", reason: "level_not_accessible" };
  }
  const scopeResult = await resolveScopeWithin(tx, data.actorUserId, selector, evaluationTime);
  if ("kind" in scopeResult) return scopeResult as OwnReportHistoryFailure;
  const scope = scopeResult;
  if (scope.access === "locked") return { kind: "locked", reason: "level_not_accessible" };
  const submission = await loadSubmission(tx, scope);
  const graphResult = await loadDefinitionGraph(tx, scope, submission);
  if ("kind" in graphResult) return graphResult as OwnReportHistoryFailure;
  const fields = parseDefinitionGraph(graphResult);
  if (!fields) return { kind: "corrupt", reason: "assignment_corrupt" };
  if (!submission) {
    if (scope.access === "pending_review" || scope.access === "completed") return { kind: "corrupt", reason: "submission_corrupt" };
    return { kind: "no_submission" };
  }
  const inspected = inspectSubmission(scope, graphResult, fields, submission, locale.data);
  if (typeof inspected === "string") return { kind: "corrupt", reason: inspected };
  return { kind: "ok", scope, fields, submission, inspected };
}

const ownHistoryListSchema = z.strictObject({
  levelNumber: z.number().int().positive().max(MAX_INT).optional(),
  stableCode: z.string().trim().regex(STABLE_CODE_PATTERN).optional(),
  locale: reportLocaleSchema,
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.number().int().positive().max(MAX_INT).optional(),
}).refine((value) => Number(value.levelNumber !== undefined) + Number(value.stableCode !== undefined) === 1, {
  message: "exactly one level selector is required",
});

const ownRevisionDetailSchema = z.strictObject({
  levelNumber: z.number().int().positive().max(MAX_INT).optional(),
  stableCode: z.string().trim().regex(STABLE_CODE_PATTERN).optional(),
  locale: reportLocaleSchema,
  revisionNumber: z.number().int().positive().max(MAX_INT),
}).refine((value) => Number(value.levelNumber !== undefined) + Number(value.stableCode !== undefined) === 1, {
  message: "exactly one level selector is required",
});

export type OwnReportRevisionSummary = {
  revisionNumber: number;
  kind: "draft_autosave" | "initial_submission" | "resubmission";
  createdAt: string;
  submittedAt: string | null;
  /** Same additive field, same correlation, so the two history routes agree. */
  review: LearnerReportReviewEvent | null;
};

export type OwnReportRevisionAttachment = {
  attachmentId: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  revisionNumber: number;
  createdAt: string;
  availableAt: string | null;
};

export type OwnReportRevisionDetail = OwnReportRevisionSummary & {
  fieldValues: Record<string, unknown>;
  feedback: {
    reasonCode: string;
    reasonTitle: string;
    humanComment: string;
    correctiveAction: string;
    reviewedAt: string;
  } | null;
  attachments: OwnReportRevisionAttachment[];
};

export type OwnReportRevisionListResult =
  | OwnReportHistoryFailure
  | { kind: "no_submission" }
  | { kind: "resolved"; status: SafeReportSubmission["status"]; workflowVersion: number; revisions: OwnReportRevisionSummary[]; nextCursor: number | null };

export type OwnReportRevisionDetailResult =
  | OwnReportHistoryFailure
  | { kind: "no_submission" }
  | { kind: "not_found" }
  | { kind: "resolved"; status: SafeReportSubmission["status"]; workflowVersion: number; revision: OwnReportRevisionDetail };

type HistoryOptions = { db?: TransactionClient; evaluationTime?: Date };

// Bounded, deterministic owner-only revision history. Revisions are immutable,
// ordered by their server-assigned revision number, and the cursor is simply
// the last revision number already seen. No writes or timestamp touches.
export async function listOwnReportRevisions(
  actorUserId: number,
  input: unknown,
  options: HistoryOptions = {},
): Promise<OwnReportRevisionListResult> {
  if (!flagsEnabled()) return { kind: "disabled" };
  assertSafeStructure(input, 4_096);
  const parsed = ownHistoryListSchema.safeParse(input);
  if (!parsed.success) fail("REPORT_INPUT_INVALID", "report revision query is invalid");
  const run = async (tx: TransactionClient): Promise<OwnReportRevisionListResult> => {
    const evaluationTime = options.evaluationTime ?? new Date();
    const context = await loadOwnHistoryWithin(tx, { actorUserId, ...parsed.data }, evaluationTime);
    if (context.kind !== "ok") return context;
    const cursor = parsed.data.cursor ?? 0;
    const ordered = [...context.submission.revisions]
      .sort((left, right) => left.revisionNumber - right.revisionNumber)
      .filter((revision) => revision.revisionNumber > cursor);
    const page = ordered.slice(0, parsed.data.limit);
    const nextCursor = ordered.length > page.length && page.length > 0 ? page[page.length - 1].revisionNumber : null;
    return {
      kind: "resolved",
      status: context.inspected.safe.status,
      workflowVersion: context.submission.workflowVersion,
      revisions: page.map((revision) => ({
        revisionNumber: revision.revisionNumber,
        kind: revision.kind,
        createdAt: revision.createdAt.toISOString(),
        submittedAt: safeDate(revision.submittedAt),
        review: learnerReviewOf(revision.reviews, parsed.data.locale),
      })),
      nextCursor,
    };
  };
  if (options.db) return run(options.db);
  return prisma.$transaction(run);
}

// Exact owned immutable revision with its validated payload, the approved
// user-facing rejection feedback when this revision is the reviewed one, and
// safe attachment descriptors. Reviewer-private scores, claim data, receipts,
// fingerprints and storage internals are never exposed here.
export async function getOwnReportRevision(
  actorUserId: number,
  input: unknown,
  options: HistoryOptions = {},
): Promise<OwnReportRevisionDetailResult> {
  if (!flagsEnabled()) return { kind: "disabled" };
  assertSafeStructure(input, 4_096);
  const parsed = ownRevisionDetailSchema.safeParse(input);
  if (!parsed.success) fail("REPORT_INPUT_INVALID", "report revision query is invalid");
  const run = async (tx: TransactionClient): Promise<OwnReportRevisionDetailResult> => {
    const evaluationTime = options.evaluationTime ?? new Date();
    const { revisionNumber, ...query } = parsed.data;
    const context = await loadOwnHistoryWithin(tx, { actorUserId, ...query }, evaluationTime);
    if (context.kind !== "ok") return context;
    const revision = context.submission.revisions.find((item) => item.revisionNumber === revisionNumber);
    if (!revision) return { kind: "not_found" };
    let fieldValues: Record<string, unknown>;
    try {
      fieldValues = normalizeFieldValues(context.fields, revision.content, revision.kind !== "draft_autosave");
    } catch {
      return { kind: "corrupt", reason: "revision_pointer_corrupt" };
    }
    /* THE REVISION'S OWN REVIEW, not the submission's latest one.
       The shape is unchanged and so is the rule — a rejection, complete, or
       null. What changed is which review is read: this used to consult
       `latestReview` and require it to point at this revision, so asking about
       an earlier rejected version of an accepted report returned nothing. The
       docblock above already described the behaviour written here. */
    const review = learnerReviewOf(revision.reviews, parsed.data.locale);
    const rejectedRow = revision.reviews.find((row) => row.decision === "rejected");
    const rejectedFields = rejectedRow ? learnerRejectionFields(rejectedRow, parsed.data.locale) : null;
    const feedback: OwnReportRevisionDetail["feedback"] =
      rejectedRow && rejectedFields
        ? { ...rejectedFields, reviewedAt: rejectedRow.reviewedAt.toISOString() }
        : null;
    let attachments: OwnReportRevisionAttachment[] = [];
    if (isCurriculumV2ReportAttachmentsEnabled()) {
      const rows = await tx.reportAttachment.findMany({
        where: { submissionId: context.submission.id, status: { not: "deleted" } },
        select: {
          id: true, originalName: true, mimeType: true, sizeBytes: true, status: true,
          createdAt: true, availableAt: true,
          revision: { select: { revisionNumber: true } },
        },
        orderBy: { id: "asc" },
      });
      const submittedNumbers = context.submission.revisions
        .filter((item) => item.kind !== "draft_autosave")
        .map((item) => item.revisionNumber)
        .sort((left, right) => left - right);
      const lastSubmitted = submittedNumbers.length ? submittedNumbers[submittedNumbers.length - 1] : 0;
      const toDescriptor = (row: (typeof rows)[number]): OwnReportRevisionAttachment => ({
        attachmentId: row.id,
        fileName: row.originalName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        status: row.status,
        revisionNumber: row.revision.revisionNumber,
        createdAt: row.createdAt.toISOString(),
        availableAt: row.availableAt?.toISOString() ?? null,
      });
      if (revision.kind !== "draft_autosave") {
        const previousSubmitted = submittedNumbers.filter((number) => number < revision.revisionNumber).pop() ?? 0;
        attachments = rows
          .filter((row) => row.status === "available" &&
            row.revision.revisionNumber > previousSubmitted && row.revision.revisionNumber < revision.revisionNumber)
          .map(toDescriptor);
      } else if (context.inspected.active.id === revision.id) {
        attachments = rows
          .filter((row) => row.revision.revisionNumber > lastSubmitted)
          .map(toDescriptor);
      }
    }
    return {
      kind: "resolved",
      status: context.inspected.safe.status,
      workflowVersion: context.submission.workflowVersion,
      revision: {
        revisionNumber: revision.revisionNumber,
        kind: revision.kind,
        createdAt: revision.createdAt.toISOString(),
        submittedAt: safeDate(revision.submittedAt),
        review,
        fieldValues,
        feedback,
        attachments,
      },
    };
  };
  if (options.db) return run(options.db);
  return prisma.$transaction(run);
}

export type SaveOwnReportDraftInput = z.input<typeof saveCommandSchema>;
export type SubmitOwnReportInput = z.input<typeof transitionCommandSchema>;

type CommandOptions = { db?: CommandDb; evaluationTime?: Date };
type ParsedSaveCommand = z.output<typeof saveCommandSchema>;
type ParsedTransitionCommand = z.output<typeof transitionCommandSchema>;

function commandSelector(command: ParsedSaveCommand | ParsedTransitionCommand): Selector {
  return command.levelNumber !== undefined
    ? { levelNumber: command.levelNumber }
    : { stableCode: command.stableCode! };
}

function mapScopeFailure(result: ResolveOwnReportContextResult): never {
  if (result.kind === "disabled") fail("REPORT_DISABLED", "report workflow is disabled");
  if (result.kind === "user_not_found") fail("REPORT_USER_NOT_FOUND", "report actor was not found");
  if (result.kind === "not_enrolled") fail("REPORT_NOT_ENROLLED", "report actor is not enrolled");
  if (result.kind === "locked") fail("REPORT_LEVEL_NOT_STARTED", "report level is not started");
  const reason = "reason" in result ? result.reason : "submission_corrupt";
  if (reason === "report_not_configured") fail("REPORT_NOT_CONFIGURED", "report is not configured");
  if (reason === "localization_unavailable") fail("REPORT_LOCALIZATION_UNAVAILABLE", "report localization is unavailable");
  if (reason === "wrong_level_type") fail("REPORT_LEVEL_WRONG_TYPE", "level is not a report level");
  if (reason === "level_not_started" || reason === "level_not_accessible") fail("REPORT_LEVEL_NOT_STARTED", "report level is not started");
  fail("REPORT_STATE_CORRUPT", "report workflow state is corrupt");
}

async function commandScope(
  tx: TransactionClient,
  actorUserId: number,
  command: ParsedSaveCommand | ParsedTransitionCommand,
  evaluationTime: Date,
) {
  const resolved = await resolveScopeWithin(tx, actorUserId, commandSelector(command), evaluationTime);
  if ("kind" in resolved) mapScopeFailure(resolved);
  if (resolved.enrollmentStatus !== "active") fail("REPORT_SUBMISSION_IMMUTABLE", "completed enrollment is immutable");
  if (!resolved.progress || resolved.access === "locked") fail("REPORT_LEVEL_NOT_STARTED", "report level is not started");
  return resolved;
}

function assertExpectedRevision(expected: number, actual: number) {
  if (expected < actual) fail("REPORT_REVISION_STALE", "expected workflow revision is stale");
  if (expected > actual) fail("REPORT_REVISION_CONFLICT", "expected workflow revision is ahead of durable state");
}

function commandFingerprint(input: {
  actorUserId: number;
  scope: Scope;
  graph: DefinitionGraph;
  commandType: ReportCommandType;
  expectedRevision: number;
  payload?: unknown;
}) {
  return hash({
    version: 1,
    actorUserId: input.actorUserId,
    enrollmentId: input.scope.enrollmentId,
    curriculumVersionId: input.scope.curriculumVersionId,
    levelDefinitionId: input.scope.level.id,
    reportAssignmentVersionId: input.graph.assignment.id,
    reportRubricVersionId: input.graph.rubric.id,
    commandType: input.commandType,
    expectedRevision: input.expectedRevision,
    payload: input.payload ?? null,
  });
}

function safeReceiptResult(kind: SafeReportCommandResult["kind"], acceptedRevision: number, resultingWorkflowVersion: number) {
  return { version: 1, kind, acceptedRevision, resultingWorkflowVersion };
}

async function currentCommandSnapshot(
  tx: TransactionClient,
  scope: Scope,
  graph: DefinitionGraph,
  fields: ParsedField[],
) {
  const submission = await loadSubmission(tx, scope);
  if (!submission) fail("REPORT_STATE_CORRUPT", "report submission disappeared");
  const inspected = inspectSubmission(scope, graph, fields, submission, null);
  if (typeof inspected === "string") fail("REPORT_STATE_CORRUPT", `report submission is corrupt: ${inspected}`);
  return { submission, inspected };
}

async function exactReceiptRetry(input: {
  tx: TransactionClient;
  actorUserId: number;
  requestId: string;
  scope: Scope;
  graph: DefinitionGraph;
  fields: ParsedField[];
  commandType: ReportCommandType;
  fingerprint: string;
}): Promise<SafeReportCommandResult | null> {
  const receipt = await input.tx.reportCommandReceipt.findUnique({
    where: { actorUserId_requestId: { actorUserId: input.actorUserId, requestId: input.requestId } },
  });
  if (!receipt) return null;
  if (receipt.commandType !== input.commandType || receipt.payloadFingerprint !== input.fingerprint) {
    fail("REPORT_IDEMPOTENCY_CONFLICT", "request id was already used with a different report command");
  }
  const { submission, inspected } = await currentCommandSnapshot(input.tx, input.scope, input.graph, input.fields);
  if (receipt.submissionId !== submission.id) fail("REPORT_IDEMPOTENCY_CONFLICT", "request id belongs to a different report submission");
  const safe = z.strictObject({
    version: z.literal(1),
    kind: z.enum(["saved", "submitted", "resubmitted"]),
    acceptedRevision: z.number().int().positive(),
    resultingWorkflowVersion: z.number().int().positive(),
  }).safeParse(receipt.safeResult);
  const resultRevision = receipt.resultRevisionId ? inspected.byId.get(receipt.resultRevisionId) : null;
  if (
    !safe.success || safe.data.resultingWorkflowVersion !== receipt.resultingWorkflowVersion ||
    safe.data.resultingWorkflowVersion > submission.workflowVersion || !resultRevision ||
    safe.data.acceptedRevision !== resultRevision.revisionNumber
  ) fail("REPORT_STATE_CORRUPT", "report command receipt is corrupt");
  return {
    kind: safe.data.kind,
    created: false,
    retry: true,
    acceptedRevision: safe.data.acceptedRevision,
    resultingWorkflowVersion: safe.data.resultingWorkflowVersion,
    appliedAt: receipt.appliedAt.toISOString(),
    submission: inspected.safe,
  };
}

function isRetryableTransactionError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return true;
  const text = error instanceof Error ? error.message : String(error);
  return /database is locked|SQLITE_BUSY/i.test(text);
}

async function executeCommand<T>(db: CommandDb, operation: (tx: TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(operation);
    } catch (error) {
      if (isReportDomainError(error)) throw error;
      if (isRetryableTransactionError(error) && attempt < MAX_TRANSACTION_ATTEMPTS) continue;
      throw new ReportDomainError("REPORT_INTERNAL_ERROR", "report command failed");
    }
  }
  throw new ReportDomainError("REPORT_INTERNAL_ERROR", "report command failed");
}

function parseActor(actorUserId: number) {
  if (!Number.isSafeInteger(actorUserId) || actorUserId < 1) fail("REPORT_INPUT_INVALID", "actor user id is invalid");
}

function parseSaveCommand(input: unknown) {
  assertSafeStructure(input);
  const parsed = saveCommandSchema.safeParse(input);
  if (!parsed.success) fail("REPORT_DRAFT_INPUT_INVALID", "report draft command is invalid");
  return parsed.data;
}

function parseTransitionCommand(input: unknown) {
  assertSafeStructure(input);
  const parsed = transitionCommandSchema.safeParse(input);
  if (!parsed.success) fail("REPORT_INPUT_INVALID", "report transition command is invalid");
  return parsed.data;
}

async function commandDefinition(
  tx: TransactionClient,
  scope: Scope,
  submission: SubmissionGraph | null,
) {
  const loaded = await loadDefinitionGraph(tx, scope, submission);
  if ("kind" in loaded) mapScopeFailure(loaded);
  const fields = parseDefinitionGraph(loaded);
  if (!fields) fail("REPORT_STATE_CORRUPT", "report definition graph is corrupt");
  return { graph: loaded, fields };
}

export async function saveOwnReportDraft(
  actorUserId: number,
  input: unknown,
  options: CommandOptions = {},
): Promise<SafeReportCommandResult> {
  if (!flagsEnabled()) fail("REPORT_DISABLED", "report workflow is disabled");
  parseActor(actorUserId);
  const command = parseSaveCommand(input);
  const evaluationTime = options.evaluationTime ?? new Date();
  return executeCommand(options.db ?? prisma, async (tx) => {
    const scope = await commandScope(tx, actorUserId, command, evaluationTime);
    let submission = await loadSubmission(tx, scope);
    const { graph, fields } = await commandDefinition(tx, scope, submission);
    const normalized = normalizeFieldValues(fields, command.fieldValues, false);
    const fingerprint = commandFingerprint({
      actorUserId, scope, graph, commandType: "save_draft", expectedRevision: command.expectedRevision,
      payload: normalized,
    });
    const retry = await exactReceiptRetry({
      tx, actorUserId, requestId: command.requestId, scope, graph, fields,
      commandType: "save_draft", fingerprint,
    });
    if (retry) return retry;

    let created = false;
    if (!submission) {
      assertExpectedRevision(command.expectedRevision, 0);
      if (scope.progress!.status !== "in_progress") fail("REPORT_REVISION_CONFLICT", "report progress is not writable");
      submission = await tx.reportSubmission.create({
        data: {
          userId: actorUserId,
          enrollmentId: scope.enrollmentId,
          curriculumVersionId: scope.curriculumVersionId,
          levelDefinitionId: scope.level.id,
          userLevelProgressId: scope.progress!.id,
          reportAssignmentVersionId: graph.assignment.id,
          reportRubricVersionId: graph.rubric.id,
          status: "draft",
          workflowVersion: 0,
        },
        include: {
          /* A submission created in this call has no revisions yet, so this
             include adds no rows — it is here because the graph type is one
             shape and a second one would drift. */
          revisions: {
            orderBy: [{ revisionNumber: "asc" }, { id: "asc" }],
            include: {
              reviews: {
                include: { reason: { include: { localizations: true } } },
                orderBy: [{ id: "asc" }],
              },
            },
          },
          receipts: true,
          latestReview: { include: { reason: { include: { localizations: true } } } },
        },
      });
      created = true;
    } else {
      const inspected = inspectSubmission(scope, graph, fields, submission, null);
      if (typeof inspected === "string") fail("REPORT_STATE_CORRUPT", `report submission is corrupt: ${inspected}`);
      if (submission.status === "pending_review") fail("REPORT_ALREADY_SUBMITTED", "submitted report cannot be edited");
      if (submission.status === "approved") fail("REPORT_SUBMISSION_IMMUTABLE", "approved report is immutable");
      assertExpectedRevision(command.expectedRevision, submission.workflowVersion);
    }

    const sourceRevisionId = submission.activeRevisionId;
    const nextRevisionNumber = submission.revisions.length === 0
      ? 1
      : Math.max(...submission.revisions.map((item) => item.revisionNumber)) + 1;
    const revision = await tx.reportRevision.create({ data: {
      submissionId: submission.id,
      revisionNumber: nextRevisionNumber,
      kind: "draft_autosave",
      sourceRevisionId,
      content: normalized as Prisma.InputJsonValue,
      contentFingerprint: hash({ version: 1, fieldValues: normalized }),
      createdById: actorUserId,
    } });
    const updated = await tx.reportSubmission.updateMany({
      where: {
        id: submission.id,
        workflowVersion: command.expectedRevision,
        activeRevisionId: sourceRevisionId,
        status: submission.status,
      },
      data: { activeRevisionId: revision.id, workflowVersion: { increment: 1 } },
    });
    if (updated.count !== 1) fail("REPORT_REVISION_CONFLICT", "report draft changed concurrently");
    const resultingWorkflowVersion = command.expectedRevision + 1;
    const safeResult = safeReceiptResult("saved", revision.revisionNumber, resultingWorkflowVersion);
    const receipt = await tx.reportCommandReceipt.create({ data: {
      actorUserId,
      submissionId: submission.id,
      commandType: "save_draft",
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      targetRevisionId: sourceRevisionId,
      resultRevisionId: revision.id,
      resultingWorkflowVersion,
      safeResult,
      appliedAt: evaluationTime,
    } });
    const current = await currentCommandSnapshot(tx, scope, graph, fields);
    return {
      kind: "saved", created, retry: false, acceptedRevision: revision.revisionNumber,
      resultingWorkflowVersion, appliedAt: receipt.appliedAt.toISOString(), submission: current.inspected.safe,
    };
  });
}

async function transitionOwnReport(
  actorUserId: number,
  input: unknown,
  commandType: "submit" | "resubmit",
  options: CommandOptions,
): Promise<SafeReportCommandResult> {
  if (!flagsEnabled()) fail("REPORT_DISABLED", "report workflow is disabled");
  parseActor(actorUserId);
  const command = parseTransitionCommand(input);
  const evaluationTime = options.evaluationTime ?? new Date();
  return executeCommand(options.db ?? prisma, async (tx) => {
    const scope = await commandScope(tx, actorUserId, command, evaluationTime);
    const submission = await loadSubmission(tx, scope);
    if (!submission) fail("REPORT_SUBMISSION_NOT_FOUND", "report submission was not found");
    const { graph, fields } = await commandDefinition(tx, scope, submission);
    const inspected = inspectSubmission(scope, graph, fields, submission, null);
    if (typeof inspected === "string") fail("REPORT_STATE_CORRUPT", `report submission is corrupt: ${inspected}`);
    const target = inspected.active;
    const fingerprint = commandFingerprint({
      actorUserId, scope, graph, commandType, expectedRevision: command.expectedRevision,
    });
    const retry = await exactReceiptRetry({
      tx, actorUserId, requestId: command.requestId, scope, graph, fields, commandType, fingerprint,
    });
    if (retry) return retry;
    const normalized = normalizeFieldValues(fields, target.content, true);
    assertExpectedRevision(command.expectedRevision, submission.workflowVersion);
    if (commandType === "submit") {
      if (submission.status === "pending_review") fail("REPORT_ALREADY_SUBMITTED", "report is already submitted");
      if (submission.status === "approved") fail("REPORT_SUBMISSION_IMMUTABLE", "approved report is immutable");
      if (submission.status === "rejected") fail("REPORT_RESUBMISSION_REQUIRED", "rejected report must be resubmitted");
      if (submission.status !== "draft") fail("REPORT_STATE_CORRUPT", "report status is corrupt");
    } else {
      if (submission.status !== "rejected") fail("REPORT_NOT_REJECTED", "only a rejected report can be resubmitted");
      if (target.kind !== "draft_autosave" || !inspected.submitted || target.revisionNumber <= inspected.submitted.revisionNumber) {
        fail("REPORT_CORRECTION_REQUIRED", "a newer correction draft is required before resubmission");
      }
      if (submission.claimedById || submission.claimedAt || submission.claimExpiresAt || submission.reviewStartedAt) {
        fail("REPORT_REVISION_CONFLICT", "report still has an active review claim");
      }
    }
    if (target.kind !== "draft_autosave") fail("REPORT_CORRECTION_REQUIRED", "active revision must be a draft");
    if (scope.progress!.status !== "in_progress") fail("REPORT_REVISION_CONFLICT", "report progress is not ready for submission");

    const nextRevisionNumber = Math.max(...submission.revisions.map((item) => item.revisionNumber)) + 1;
    const kind = commandType === "submit" ? "initial_submission" : "resubmission";
    const revision = await tx.reportRevision.create({ data: {
      submissionId: submission.id,
      revisionNumber: nextRevisionNumber,
      kind,
      sourceRevisionId: target.id,
      content: normalized as Prisma.InputJsonValue,
      contentFingerprint: hash({ version: 1, fieldValues: normalized }),
      createdById: actorUserId,
      submittedAt: evaluationTime,
    } });
    const updated = await tx.reportSubmission.updateMany({
      where: {
        id: submission.id,
        workflowVersion: command.expectedRevision,
        status: submission.status,
        activeRevisionId: target.id,
        ...(commandType === "resubmit" ? { submittedRevisionId: submission.submittedRevisionId, latestReviewId: submission.latestReviewId } : {}),
      },
      data: {
        status: "pending_review",
        workflowVersion: { increment: 1 },
        activeRevisionId: revision.id,
        submittedRevisionId: revision.id,
        firstSubmittedAt: submission.firstSubmittedAt ?? evaluationTime,
        submittedAt: evaluationTime,
        reviewDueAt: null,
        rejectedAt: null,
        claimedById: null,
        claimedAt: null,
        claimExpiresAt: null,
        reviewStartedAt: null,
        slaExceededAt: null,
      },
    });
    if (updated.count !== 1) fail("REPORT_REVISION_CONFLICT", "report changed concurrently");

    // G4-GROWTH — the canonical `report_submitted` event.
    //
    // KEYED ON THE SUBMISSION, so a resubmission after a rejection does NOT
    // produce a second event. The learner submitted one report and revised it;
    // counting that as two submissions would inflate the report-submission rate
    // every time a mentor asked for changes, making a stricter reviewer look
    // like better learner engagement.
    //
    // `occurredAt` is `firstSubmittedAt` for the same reason — a resubmission
    // must not move the original submission into a later reporting period and
    // silently change a month that has already closed.
    await emitReportSubmittedEvent(tx, {
      submissionId: submission.id,
      userId: submission.userId,
      enrollmentId: submission.enrollmentId,
      levelDefinitionId: submission.levelDefinitionId,
      occurredAt: submission.firstSubmittedAt ?? evaluationTime,
    });

    const progress = await tx.userLevelProgress.updateMany({
      where: { id: scope.progress!.id, status: "in_progress" },
      data: { status: "pending_review", lastProgressAt: evaluationTime },
    });
    if (progress.count !== 1) fail("REPORT_REVISION_CONFLICT", "report progress changed concurrently");
    scope.progress!.status = "pending_review";

    // LO-REVIEW-WORKITEM-UNREACHABLE-1 — the operational mirror, IN THIS
    // TRANSACTION.
    //
    // A submitted report that no operations queue knows about is the defect
    // this closes, so creation is atomic with the submission rather than a
    // best-effort follow-up: if the work item cannot be created the submission
    // does not happen either, and the learner is told, instead of the product
    // claiming a successful review workflow with nobody responsible for it.
    //
    // `ensure` on BOTH submit and resubmit, keyed on the submission: the first
    // submission creates it, a resubmission after a revision request finds the
    // same one. Reconciling to `pending_review` afterwards is what returns a
    // resubmitted report's case out of `waiting_learner` and restarts its
    // resolution clock — with no second case and no second timeline.
    const learnerActor = await resolveOperationalActor(tx, actorUserId);
    await ensureReportReviewWorkItem(tx, {
      submissionId: submission.id,
      userId: submission.userId,
      levelNumber: scope.level.levelNumber,
      levelTitle: scope.level.title,
      actor: learnerActor,
    });
    await reconcileReportReviewOperationalState(tx, {
      submissionId: submission.id,
      canonicalState: "pending_review",
      actor: learnerActor,
      reason: commandType === "submit" ? "report:submitted" : "report:resubmitted",
    });
    const resultingWorkflowVersion = command.expectedRevision + 1;
    const resultKindValue = commandType === "submit" ? "submitted" : "resubmitted";
    const safeResult = safeReceiptResult(resultKindValue, revision.revisionNumber, resultingWorkflowVersion);
    const receipt = await tx.reportCommandReceipt.create({ data: {
      actorUserId,
      submissionId: submission.id,
      commandType,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      targetRevisionId: target.id,
      resultRevisionId: revision.id,
      resultingWorkflowVersion,
      safeResult,
      appliedAt: evaluationTime,
    } });
    await tx.auditLog.create({ data: {
      userId: actorUserId,
      action: commandType === "submit" ? CURRICULUM_AUDIT_ACTIONS.reportSubmitted : CURRICULUM_AUDIT_ACTIONS.reportResubmitted,
      entityType: "ReportSubmission",
      entityId: String(submission.id),
      metadata: {
        actorUserId,
        enrollmentId: scope.enrollmentId,
        curriculumVersionId: scope.curriculumVersionId,
        levelDefinitionId: scope.level.id,
        submissionId: submission.id,
        revisionNumber: revision.revisionNumber,
        workflowVersion: resultingWorkflowVersion,
        commandType,
      },
    } });
    const current = await currentCommandSnapshot(tx, scope, graph, fields);
    return {
      kind: resultKindValue, created: false, retry: false, acceptedRevision: revision.revisionNumber,
      resultingWorkflowVersion, appliedAt: receipt.appliedAt.toISOString(), submission: current.inspected.safe,
    };
  });
}

export function submitOwnReport(
  actorUserId: number,
  input: unknown,
  options: CommandOptions = {},
) {
  return transitionOwnReport(actorUserId, input, "submit", options);
}

export function resubmitOwnReport(
  actorUserId: number,
  input: unknown,
  options: CommandOptions = {},
) {
  return transitionOwnReport(actorUserId, input, "resubmit", options);
}
