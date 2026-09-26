import { createHash } from "node:crypto";
import { Prisma, type PrismaClient, type ReportCommandType, type UserRole } from "@prisma/client";
import { z } from "zod";
import { CURRICULUM_AUDIT_ACTIONS } from "@/lib/curriculum/constants";
import { ReportDomainError, isReportDomainError, type ReportDomainErrorCode } from "@/lib/curriculum/report-errors";
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
import {
  reconcileReportReviewOperationalState,
  resolveOperationalActor,
} from "@/lib/learner-ops/review-work-items";
import { emitReportApprovedEvent } from "@/lib/growth/product-events";
import {
  completeCurriculumLevelInTransaction,
  isCurriculumLevelCompletionError,
  type CurriculumLevelCompletedResult,
} from "@/lib/curriculum/completion";

const MAX_INT = 2_147_483_647;
const CLAIM_LEASE_MS = 60 * 60 * 1_000;
const MAX_TRANSACTION_ATTEMPTS = 3;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;
const STABLE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
const UNSAFE_TEXT = /<\/?[a-z][^>]*>|\bon[a-z]+\s*=|javascript\s*:|data\s*:/i;
const REASSIGN_REASONS = [
  "reviewer_unavailable",
  "claim_stale",
  "workload_rebalance",
  "operational_override",
] as const;

type TransactionClient = Prisma.TransactionClient;
type CommandDb = Pick<PrismaClient, "$transaction">;
type ReviewerRole = "admin" | "mentor";
type ReviewOperation = "claim" | "renew" | "release" | "start_review" | "reassign" | "reject" | "approve";
type CommandOptions = { db?: CommandDb; evaluationTime?: Date };

const submissionRefSchema = z.string().trim().min(8).max(128);
const commandBase = {
  submissionRef: submissionRefSchema,
  requestId: z.string().trim().regex(REQUEST_ID),
  expectedWorkflowVersion: z.number().int().nonnegative().max(MAX_INT - 1),
  expectedClaimVersion: z.number().int().nonnegative().max(MAX_INT - 1),
  expectedSubmittedRevision: z.number().int().positive().max(MAX_INT),
};
const claimCommandSchema = z.strictObject(commandBase);
const reassignCommandSchema = z.strictObject({
  ...commandBase,
  targetReviewerId: z.number().int().positive().max(MAX_INT),
  reasonCode: z.enum(REASSIGN_REASONS),
});
const scoreSchema = z.strictObject({
  criterionCode: z.string().trim().regex(STABLE_KEY),
  scaleCode: z.string().trim().regex(STABLE_KEY),
  comment: z.string().trim().min(1).max(4_000).optional(),
});
const reviewEvidenceSchema = z.strictObject({
  ...commandBase,
  scores: z.array(scoreSchema).min(1).max(100),
});
const rejectCommandSchema = reviewEvidenceSchema.extend({
  reasonCode: z.string().trim().regex(STABLE_KEY),
  humanComment: z.string().trim().min(1).max(4_000),
  correctiveAction: z.string().trim().min(1).max(4_000),
});
const queueSchema = z.strictObject({
  locale: reportLocaleSchema,
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().trim().min(8).max(256).optional(),
});
const receiptResultSchema = z.strictObject({
  version: z.literal(1),
  operation: z.enum(["claim", "renew", "release", "start_review", "reassign", "reject"]),
  submissionRef: submissionRefSchema,
  submittedRevision: z.number().int().positive(),
  workflowVersion: z.number().int().positive(),
  claimVersion: z.number().int().nonnegative(),
  claimState: z.enum(["active", "released", "closed"]),
  claimExpiresAt: z.string().datetime().nullable(),
  reviewerRole: z.enum(["admin", "mentor"]).nullable(),
  reasonCode: z.string().nullable(),
});
// The durable approval receipt no longer assumes every completion awards XP.
// A completion is one of exactly two shapes, enforced by the refinement below:
//   - zero reward:     xpAwarded === 0 && xpTransactionId === null (no ledger row);
//   - positive reward: xpAwarded > 0  && xpTransactionId is the exact ledger id.
// Any other pairing (0 with an id, positive without an id, negative award) is a
// corrupt receipt and is rejected before it can be trusted or replayed.
const approvalReceiptResultSchema = z
  .strictObject({
    version: z.literal(1),
    operation: z.literal("approve"),
    submissionRef: submissionRefSchema,
    submittedRevision: z.number().int().positive(),
    workflowVersion: z.number().int().positive(),
    claimVersion: z.number().int().positive(),
    reviewId: z.number().int().positive(),
    xpTransactionId: z.number().int().positive().nullable(),
    xpAwarded: z.number().int().nonnegative(),
    levelNumber: z.number().int().positive(),
    nextLevelNumber: z.number().int().positive().nullable(),
    terminal: z.boolean(),
    completedAt: z.string().datetime(),
  })
  .superRefine((value, ctx) => {
    const zeroReward = value.xpAwarded === 0 && value.xpTransactionId === null;
    const positiveReward = value.xpAwarded > 0 && value.xpTransactionId !== null;
    if (!zeroReward && !positiveReward) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "report approval reward and XP transaction pairing is inconsistent",
      });
    }
  });

const submissionInclude = Prisma.validator<Prisma.ReportSubmissionInclude>()({
  user: { select: { id: true, name: true, status: true } },
  enrollment: { select: { id: true, status: true } },
  curriculumVersion: { select: { id: true, status: true, versionNumber: true, code: true } },
  levelDefinition: { select: { id: true, status: true, type: true, completionMethod: true, stableCode: true, levelNumber: true, title: true } },
  progress: { select: { id: true, status: true } },
  assignment: {
    include: {
      localizations: true,
      fields: { include: { localizations: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  },
  rubric: {
    include: {
      criteria: { include: { localizations: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      scaleOptions: { include: { localizations: true }, orderBy: [{ ordinal: "asc" }, { id: "asc" }] },
      rejectionReasons: { include: { localizations: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  },
  submittedRevision: true,
});

type ReviewSubmission = Prisma.ReportSubmissionGetPayload<{ include: typeof submissionInclude }>;

export type SafeReviewerQueueItem = {
  submissionRef: string;
  owner: { displayName: string };
  curriculum: { code: string; versionNumber: number };
  level: { stableCode: string; levelNumber: number; title: string };
  assignment: {
    versionNumber: number;
    title: string;
    instructions: string;
    successCriteriaSummary: string | null;
    fields: Array<{
      code: string;
      type: string;
      required: boolean;
      label: string;
      helpText: string | null;
    }>;
  };
  rubric: {
    versionNumber: number;
    criteria: Array<{
      code: string;
      categoryCode: string;
      commentRequired: boolean;
      title: string;
      description: string;
    }>;
    scale: Array<{ code: string; label: string; description: string | null }>;
  };
  revision: {
    revisionNumber: number;
    values: Record<string, string | number | boolean | string[]>;
  };
  submittedAt: string;
  claim: { state: "unclaimed" | "owned_by_you" | "claimed" | "expired"; expiresAt: string | null };
};

export type ReviewerQueueResult =
  | { kind: "disabled" }
  | { kind: "forbidden" }
  | { kind: "resolved"; items: SafeReviewerQueueItem[]; nextCursor: string | null };

export type SafeReviewCommandResult = {
  operation: ReviewOperation;
  created: boolean;
  retry: boolean;
  submissionRef: string;
  submittedRevision: number;
  workflowVersion: number;
  claimVersion: number;
  claim: { state: "active" | "released" | "closed"; expiresAt: string | null; reviewerRole: ReviewerRole | null };
  reasonCode: string | null;
  appliedAt: string;
};

export type ApprovalReadinessResult = {
  kind: "ready";
  submissionRef: string;
  submittedRevision: number;
  workflowVersion: number;
  claimVersion: number;
  reviewerRole: ReviewerRole;
  scoreCount: number;
};

export type SafeReportApprovalResult = {
  operation: "approve";
  created: boolean;
  retry: boolean;
  submissionRef: string;
  submittedRevision: number;
  workflowVersion: number;
  claimVersion: number;
  reviewId: number;
  completion: {
    // null for a zero-reward level completion; the exact ledger id otherwise.
    xpTransactionId: number | null;
    xpAwarded: number;
    levelNumber: number;
    nextLevelNumber: number | null;
    terminal: boolean;
    completedAt: string;
  };
  appliedAt: string;
};

function flagsEnabled() {
  return isCurriculumV2ReadEnabled() && isCurriculumV2EnrollmentEnabled() && isCurriculumV2ReportEnabled();
}

function fail(code: ReportDomainErrorCode, message: string): never {
  throw new ReportDomainError(code, message);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function hash(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function submissionRef(id: number) {
  return Buffer.from(`report-submission:v1:${id}`, "utf8").toString("base64url");
}

function parseSubmissionRef(value: string) {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const match = /^report-submission:v1:([1-9]\d*)$/.exec(decoded);
    if (!match || Buffer.from(decoded, "utf8").toString("base64url") !== value) return null;
    const id = Number(match[1]);
    return Number.isSafeInteger(id) && id <= MAX_INT ? id : null;
  } catch { return null; }
}

function encodeCursor(submittedAt: Date, id: number) {
  return Buffer.from(JSON.stringify({ version: 1, submittedAt: submittedAt.toISOString(), id }), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): { submittedAt: Date; id: number } | null | undefined {
  if (value === undefined) return undefined;
  try {
    const raw = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(raw, "utf8").toString("base64url") !== value) return null;
    const parsed = z.strictObject({ version: z.literal(1), submittedAt: z.string().datetime(), id: z.number().int().positive().max(MAX_INT) }).safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const submittedAt = new Date(parsed.data.submittedAt);
    return Number.isNaN(submittedAt.getTime()) ? null : { submittedAt, id: parsed.data.id };
  } catch { return null; }
}

function parseActorId(actorUserId: number) {
  if (!Number.isSafeInteger(actorUserId) || actorUserId < 1) fail("REPORT_REVIEWER_FORBIDDEN", "reviewer is forbidden");
}

async function requireReviewer(tx: TransactionClient, actorUserId: number): Promise<{ id: number; role: ReviewerRole }> {
  const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { id: true, role: true, status: true } });
  if (!actor || actor.status !== "active" || (actor.role !== "admin" && actor.role !== "mentor")) {
    fail("REPORT_REVIEWER_FORBIDDEN", "reviewer is forbidden");
  }
  return { id: actor.id, role: actor.role };
}

async function loadSubmission(tx: TransactionClient, id: number) {
  return tx.reportSubmission.findUnique({ where: { id }, include: submissionInclude });
}

function validateDefinitionGraph(submission: ReviewSubmission, locale?: string) {
  if (
    submission.assignment.id !== submission.reportAssignmentVersionId ||
    submission.assignment.levelDefinitionId !== submission.levelDefinitionId ||
    submission.assignment.curriculumVersionId !== submission.curriculumVersionId ||
    submission.rubric.id !== submission.reportRubricVersionId ||
    submission.rubric.reportAssignmentVersionId !== submission.assignment.id ||
    !["published", "archived"].includes(submission.assignment.status) ||
    !["published", "archived"].includes(submission.rubric.status)
  ) fail("REPORT_STATE_CORRUPT", "report definition graph is corrupt");
  const assignmentLocale = locale ? submission.assignment.localizations.find((item) => item.locale === locale) : null;
  if (locale && (!assignmentLocale || !reportAssignmentLocalizationPayloadSchema.safeParse({
    locale: assignmentLocale.locale,
    title: assignmentLocale.title,
    instructions: assignmentLocale.instructions,
    successCriteriaSummary: assignmentLocale.successCriteriaSummary,
    submitLabel: assignmentLocale.submitLabel,
  }).success)) {
    fail("REPORT_LOCALIZATION_UNAVAILABLE", "report localization is unavailable");
  }
  if (submission.assignment.fields.length === 0 || submission.rubric.criteria.length === 0 || submission.rubric.scaleOptions.length === 0) {
    fail("REPORT_STATE_CORRUPT", "report definition graph is incomplete");
  }
  const fieldKeys = new Set<string>();
  for (const field of submission.assignment.fields) {
    const parsed = reportFieldDefinitionPayloadSchema.safeParse({
      stableKey: field.stableKey, type: field.type, required: field.required, sortOrder: field.sortOrder,
      validationRules: field.validationRules, choiceCodes: field.choiceCodes,
    });
    if (!parsed.success || fieldKeys.has(field.stableKey)) fail("REPORT_STATE_CORRUPT", "report field graph is corrupt");
    fieldKeys.add(field.stableKey);
    if (locale) {
      const localized = field.localizations.find((item) => item.locale === locale);
      if (!localized || !reportFieldLocalizationPayloadSchema.safeParse({
        locale: localized.locale, label: localized.label, helpText: localized.helpText,
        placeholder: localized.placeholder, choiceLabels: localized.choiceLabels,
      }).success) fail("REPORT_LOCALIZATION_UNAVAILABLE", "report localization is unavailable");
    }
  }
  const criteria = new Map<string, ReviewSubmission["rubric"]["criteria"][number]>();
  for (const criterion of submission.rubric.criteria) {
    if (!reportCriterionPayloadSchema.safeParse({
      stableKey: criterion.stableKey, categoryCode: criterion.categoryCode,
      sortOrder: criterion.sortOrder, commentRequired: criterion.commentRequired,
    }).success || criteria.has(criterion.stableKey)) fail("REPORT_STATE_CORRUPT", "report rubric is corrupt");
    criteria.set(criterion.stableKey, criterion);
    if (locale) {
      const localized = criterion.localizations.find((item) => item.locale === locale);
      if (!localized || !reportCriterionLocalizationPayloadSchema.safeParse({
        locale: localized.locale, title: localized.title, description: localized.description,
      }).success) fail("REPORT_LOCALIZATION_UNAVAILABLE", "report localization is unavailable");
    }
  }
  const scale = new Map<string, ReviewSubmission["rubric"]["scaleOptions"][number]>();
  for (const option of submission.rubric.scaleOptions) {
    if (!reportScaleOptionPayloadSchema.safeParse({ stableKey: option.stableKey, ordinal: option.ordinal }).success || scale.has(option.stableKey)) fail("REPORT_STATE_CORRUPT", "report scale is corrupt");
    scale.set(option.stableKey, option);
    if (locale) {
      const localized = option.localizations.find((item) => item.locale === locale);
      if (!localized || !reportScaleLocalizationPayloadSchema.safeParse({
        locale: localized.locale, label: localized.label, description: localized.description,
      }).success) fail("REPORT_LOCALIZATION_UNAVAILABLE", "report localization is unavailable");
    }
  }
  const reasons = new Map<string, ReviewSubmission["rubric"]["rejectionReasons"][number]>();
  for (const reason of submission.rubric.rejectionReasons) {
    if (!reportReasonPayloadSchema.safeParse({
      stableKey: reason.stableKey, sortOrder: reason.sortOrder, active: reason.active,
    }).success || reasons.has(reason.stableKey)) fail("REPORT_STATE_CORRUPT", "report rejection catalog is corrupt");
    reasons.set(reason.stableKey, reason);
    if (locale) for (const localized of reason.localizations) {
      if (!reportReasonLocalizationPayloadSchema.safeParse({
        locale: localized.locale, title: localized.title, guidance: localized.guidance,
      }).success) fail("REPORT_STATE_CORRUPT", "report rejection catalog is corrupt");
    }
  }
  return { assignmentLocale, criteria, scale, reasons };
}

function validatePendingSubmission(submission: ReviewSubmission) {
  if (
    submission.status !== "pending_review" || submission.enrollment.status !== "active" ||
    !["published", "archived"].includes(submission.curriculumVersion.status) ||
    submission.levelDefinition.status !== "active" || submission.levelDefinition.type !== "report" ||
    submission.levelDefinition.completionMethod !== "report_approval" || submission.progress.status !== "pending_review" ||
    !submission.submittedRevision || submission.submittedRevisionId !== submission.activeRevisionId ||
    submission.submittedRevision.submissionId !== submission.id ||
    (submission.submittedRevision.kind !== "initial_submission" && submission.submittedRevision.kind !== "resubmission") ||
    !submission.submittedAt || !submission.firstSubmittedAt || submission.approvedRevisionId || submission.approvedReviewId ||
    submission.approvedAt || submission.rejectedAt || !Number.isSafeInteger(submission.workflowVersion) ||
    !Number.isSafeInteger(submission.claimVersion)
  ) fail("REPORT_STATE_CORRUPT", "pending report submission is corrupt");
  if (
    (submission.claimedById === null && (submission.claimedAt !== null || submission.claimExpiresAt !== null || submission.reviewStartedAt !== null)) ||
    (submission.claimedById !== null && (!submission.claimedAt || !submission.claimExpiresAt || submission.claimExpiresAt <= submission.claimedAt))
  ) fail("REPORT_STATE_CORRUPT", "report claim state is corrupt");
  validateDefinitionGraph(submission);
}

function safeSubmittedValues(submission: ReviewSubmission) {
  const raw = submission.submittedRevision!.content;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("REPORT_STATE_CORRUPT", "submitted report content is corrupt");
  const source = raw as Record<string, Prisma.JsonValue>;
  const allowed = new Set(submission.assignment.fields.map((field) => field.stableKey));
  if (Object.keys(source).some((key) => !allowed.has(key))) fail("REPORT_STATE_CORRUPT", "submitted report content is corrupt");
  const values: Record<string, string | number | boolean | string[]> = {};
  for (const field of submission.assignment.fields) {
    const value = source[field.stableKey];
    if (value === undefined) {
      if (field.required) fail("REPORT_STATE_CORRUPT", "submitted report content is incomplete");
      continue;
    }
    const choices = Array.isArray(field.choiceCodes) && field.choiceCodes.every((item) => typeof item === "string")
      ? field.choiceCodes as string[]
      : [];
    if (["short_text", "long_text", "url", "single_choice"].includes(field.type) && typeof value === "string") {
      if (value.length > 12_000 || UNSAFE_TEXT.test(value)) fail("REPORT_STATE_CORRUPT", "submitted report content is unsafe");
      if (field.type === "url") {
        try {
          const url = new URL(value);
          if (url.protocol !== "https:" || url.username || url.password) fail("REPORT_STATE_CORRUPT", "submitted report URL is corrupt");
        } catch { fail("REPORT_STATE_CORRUPT", "submitted report URL is corrupt"); }
      }
      if (field.type === "single_choice" && !choices.includes(value)) fail("REPORT_STATE_CORRUPT", "submitted report choice is corrupt");
      values[field.stableKey] = value;
    } else if (field.type === "integer" && typeof value === "number") {
      if (!Number.isSafeInteger(value)) fail("REPORT_STATE_CORRUPT", "submitted report content is corrupt");
      values[field.stableKey] = value;
    } else if (field.type === "boolean" && typeof value === "boolean") {
      values[field.stableKey] = value;
    } else if (field.type === "multi_choice" && Array.isArray(value) && value.length <= 100 &&
      value.every((item) => typeof item === "string" && item.length <= 300 && choices.includes(item) && !UNSAFE_TEXT.test(item)) &&
      new Set(value).size === value.length) {
      values[field.stableKey] = value as string[];
    } else {
      fail("REPORT_STATE_CORRUPT", "submitted report content is corrupt");
    }
  }
  return values;
}

function assertPendingReview(submission: ReviewSubmission) {
  if (submission.status !== "pending_review") fail("REPORT_NOT_PENDING_REVIEW", "report is not pending review");
}

function assertNotSelfReview(actorUserId: number, submission: ReviewSubmission, targetReviewerId = actorUserId) {
  if (submission.userId === actorUserId || submission.userId === targetReviewerId) fail("REPORT_SELF_REVIEW_FORBIDDEN", "self review is forbidden");
}

function assertExpected(command: z.infer<typeof claimCommandSchema>, submission: ReviewSubmission) {
  if (command.expectedSubmittedRevision !== submission.submittedRevision!.revisionNumber) fail("REPORT_REVISION_STALE", "submitted revision is stale");
  if (command.expectedWorkflowVersion < submission.workflowVersion || command.expectedClaimVersion < submission.claimVersion) fail("REPORT_REVISION_STALE", "review workflow is stale");
  if (command.expectedWorkflowVersion > submission.workflowVersion || command.expectedClaimVersion > submission.claimVersion) fail("REPORT_REVISION_CONFLICT", "review workflow is ahead of durable state");
}

function commandFingerprint(input: {
  operation: ReviewOperation;
  actorUserId: number;
  submission: ReviewSubmission;
  command: z.infer<typeof claimCommandSchema>;
  payload?: unknown;
}) {
  return hash({
    version: 1,
    operation: input.operation,
    actorUserId: input.actorUserId,
    submissionId: input.submission.id,
    curriculumVersionId: input.submission.curriculumVersionId,
    levelDefinitionId: input.submission.levelDefinitionId,
    reportAssignmentVersionId: input.submission.reportAssignmentVersionId,
    reportRubricVersionId: input.submission.reportRubricVersionId,
    expectedSubmittedRevision: input.command.expectedSubmittedRevision,
    expectedWorkflowVersion: input.command.expectedWorkflowVersion,
    expectedClaimVersion: input.command.expectedClaimVersion,
    payload: input.payload ?? null,
  });
}

function safeReceiptResult(input: {
  operation: ReviewOperation;
  submission: ReviewSubmission;
  workflowVersion: number;
  claimVersion: number;
  claimState: "active" | "released" | "closed";
  claimExpiresAt: Date | null;
  reviewerRole: ReviewerRole | null;
  reasonCode?: string | null;
}) {
  return {
    version: 1 as const,
    operation: input.operation,
    submissionRef: submissionRef(input.submission.id),
    submittedRevision: input.submission.submittedRevision!.revisionNumber,
    workflowVersion: input.workflowVersion,
    claimVersion: input.claimVersion,
    claimState: input.claimState,
    claimExpiresAt: input.claimExpiresAt?.toISOString() ?? null,
    reviewerRole: input.reviewerRole,
    reasonCode: input.reasonCode ?? null,
  };
}

function resultFromReceipt(receipt: { safeResult: Prisma.JsonValue; appliedAt: Date }, retry: boolean): SafeReviewCommandResult {
  const parsed = receiptResultSchema.safeParse(receipt.safeResult);
  if (!parsed.success) fail("REPORT_STATE_CORRUPT", "report receipt is corrupt");
  return {
    operation: parsed.data.operation,
    created: !retry,
    retry,
    submissionRef: parsed.data.submissionRef,
    submittedRevision: parsed.data.submittedRevision,
    workflowVersion: parsed.data.workflowVersion,
    claimVersion: parsed.data.claimVersion,
    claim: { state: parsed.data.claimState, expiresAt: parsed.data.claimExpiresAt, reviewerRole: parsed.data.reviewerRole },
    reasonCode: parsed.data.reasonCode,
    appliedAt: receipt.appliedAt.toISOString(),
  };
}

async function exactRetry(input: {
  tx: TransactionClient;
  actorUserId: number;
  requestId: string;
  submission: ReviewSubmission;
  commandType: ReportCommandType;
  fingerprint: string;
  operation: ReviewOperation;
  expectedSubmittedRevision: number;
}) {
  const receipt = await input.tx.reportCommandReceipt.findUnique({
    where: { actorUserId_requestId: { actorUserId: input.actorUserId, requestId: input.requestId } },
  });
  if (!receipt) return null;
  const safe = receiptResultSchema.safeParse(receipt.safeResult);
  const revisionIds = [receipt.targetRevisionId, receipt.resultRevisionId].filter((id): id is number => id !== null);
  const revisions = revisionIds.length === 2
    ? await input.tx.reportRevision.findMany({
        where: { id: { in: [...new Set(revisionIds)] }, submissionId: input.submission.id },
        select: { id: true, revisionNumber: true },
      })
    : [];
  const revisionsMatch = revisionIds.length === 2 && revisionIds.every((id) =>
    revisions.some((revision) => revision.id === id && revision.revisionNumber === input.expectedSubmittedRevision));
  if (
    receipt.submissionId !== input.submission.id || receipt.commandType !== input.commandType ||
    receipt.payloadFingerprint !== input.fingerprint || !safe.success || safe.data.operation !== input.operation ||
    safe.data.submissionRef !== submissionRef(input.submission.id) ||
    !revisionsMatch || safe.data.submittedRevision !== input.expectedSubmittedRevision ||
    receipt.resultingWorkflowVersion !== safe.data.workflowVersion || !FINGERPRINT.test(receipt.payloadFingerprint)
  ) fail("REPORT_IDEMPOTENCY_CONFLICT", "request id was already used for a different report review command");
  return resultFromReceipt(receipt, true);
}

function isRetryable(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return true;
  return /database is locked|SQLITE_BUSY/i.test(error instanceof Error ? error.message : String(error));
}

async function executeCommand<T>(db: CommandDb, operation: (tx: TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try { return await db.$transaction(operation); }
    catch (error) {
      if (isReportDomainError(error)) throw error;
      if (isRetryable(error) && attempt < MAX_TRANSACTION_ATTEMPTS) continue;
      throw new ReportDomainError("REPORT_INTERNAL_ERROR", "report review command failed");
    }
  }
  throw new ReportDomainError("REPORT_INTERNAL_ERROR", "report review command failed");
}

async function writeAudit(tx: TransactionClient, input: {
  actor: { id: number; role: ReviewerRole };
  submission: ReviewSubmission;
  action: string;
  workflowVersion: number;
  claimVersion: number;
  targetReviewerId?: number;
  reasonCode?: string;
  reviewId?: number;
  // A zero-reward approval completes with a null xpTransactionId and xpAwarded 0.
  // The durable receipt (ReportCommandReceipt.safeResult) records both explicitly;
  // this audit metadata simply omits the XP fields when there is no award, keeping
  // a zero-reward approval's audit free of a fabricated ledger reference.
  xpTransactionId?: number | null;
  xpAwarded?: number;
  terminal?: boolean;
  status?: "approved";
}) {
  await tx.auditLog.create({ data: {
    userId: input.actor.id,
    action: input.action,
    entityType: "ReportSubmission",
    entityId: String(input.submission.id),
    metadata: {
      actorUserId: input.actor.id,
      actorRoleSnapshot: input.actor.role,
      submissionId: input.submission.id,
      curriculumVersionId: input.submission.curriculumVersionId,
      levelDefinitionId: input.submission.levelDefinitionId,
      submittedRevisionNumber: input.submission.submittedRevision!.revisionNumber,
      workflowVersion: input.workflowVersion,
      claimVersion: input.claimVersion,
      ...(input.targetReviewerId ? { targetReviewerId: input.targetReviewerId } : {}),
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
      ...(input.reviewId ? { reviewId: input.reviewId } : {}),
      ...(input.xpTransactionId ? { xpTransactionId: input.xpTransactionId } : {}),
      ...(input.xpAwarded ? { xpAwarded: input.xpAwarded } : {}),
      ...(input.terminal !== undefined ? { terminal: input.terminal } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
  } });
}

function parseCommand<T>(schema: z.ZodType<T>, input: unknown, code: ReportDomainErrorCode = "REPORT_REVIEW_INPUT_INVALID") {
  const parsed = schema.safeParse(input);
  if (!parsed.success) fail(code, "report review input is invalid");
  return parsed.data;
}

async function getCommandContext(
  tx: TransactionClient,
  actorUserId: number,
  command: z.infer<typeof claimCommandSchema>,
) {
  const actor = await requireReviewer(tx, actorUserId);
  const id = parseSubmissionRef(command.submissionRef);
  if (!id) fail("REPORT_SUBMISSION_NOT_FOUND", "report submission was not found");
  const submission = await loadSubmission(tx, id);
  if (!submission) fail("REPORT_SUBMISSION_NOT_FOUND", "report submission was not found");
  return { actor, submission };
}

function normalizeScores(submission: ReviewSubmission, values: z.infer<typeof scoreSchema>[]) {
  const graph = validateDefinitionGraph(submission);
  if (values.length !== graph.criteria.size) fail("REPORT_REVIEW_INPUT_INVALID", "all rubric criteria are required");
  const seen = new Set<string>();
  return values.map((value) => {
    if (seen.has(value.criterionCode)) fail("REPORT_REVIEW_INPUT_INVALID", "rubric criterion is duplicated");
    seen.add(value.criterionCode);
    const criterion = graph.criteria.get(value.criterionCode);
    const option = graph.scale.get(value.scaleCode);
    if (!criterion || !option) fail("REPORT_RUBRIC_MISMATCH", "rubric score does not belong to the pinned rubric");
    const comment = value.comment?.trim() ?? null;
    if (criterion.commentRequired && !comment) fail("REPORT_REVIEW_INPUT_INVALID", "rubric criterion comment is required");
    if (comment && UNSAFE_TEXT.test(comment)) fail("REPORT_REVIEW_INPUT_INVALID", "rubric comment is unsafe");
    return { criterion, option, comment, criterionCode: criterion.stableKey, scaleCode: option.stableKey };
  }).sort((left, right) => left.criterion.sortOrder - right.criterion.sortOrder || left.criterionCode.localeCompare(right.criterionCode));
}

function approvalReceiptResult(input: {
  submission: ReviewSubmission;
  workflowVersion: number;
  claimVersion: number;
  reviewId: number;
  completion: CurriculumLevelCompletedResult;
}) {
  return {
    version: 1 as const,
    operation: "approve" as const,
    submissionRef: submissionRef(input.submission.id),
    submittedRevision: input.submission.submittedRevision!.revisionNumber,
    workflowVersion: input.workflowVersion,
    claimVersion: input.claimVersion,
    reviewId: input.reviewId,
    xpTransactionId: input.completion.xpTransactionId,
    xpAwarded: input.completion.xpAwarded,
    levelNumber: input.completion.levelNumber,
    nextLevelNumber: input.completion.nextLevelNumber,
    terminal: input.completion.terminal,
    completedAt: input.completion.completedAt.toISOString(),
  };
}

function approvalResultFromReceipt(
  receipt: { safeResult: Prisma.JsonValue; appliedAt: Date },
  retry: boolean,
): SafeReportApprovalResult {
  const parsed = approvalReceiptResultSchema.safeParse(receipt.safeResult);
  if (!parsed.success) fail("REPORT_STATE_CORRUPT", "report approval receipt is corrupt");
  const safe = parsed.data;
  return {
    operation: "approve",
    created: !retry,
    retry,
    submissionRef: safe.submissionRef,
    submittedRevision: safe.submittedRevision,
    workflowVersion: safe.workflowVersion,
    claimVersion: safe.claimVersion,
    reviewId: safe.reviewId,
    completion: {
      xpTransactionId: safe.xpTransactionId,
      xpAwarded: safe.xpAwarded,
      levelNumber: safe.levelNumber,
      nextLevelNumber: safe.nextLevelNumber,
      terminal: safe.terminal,
      completedAt: safe.completedAt,
    },
    appliedAt: receipt.appliedAt.toISOString(),
  };
}

async function runReportCompletion(
  tx: TransactionClient,
  submission: ReviewSubmission,
  reviewId: number,
  actorUserId: number,
  evaluationTime: Date,
) {
  try {
    return await completeCurriculumLevelInTransaction(tx, {
      enrollmentId: submission.enrollmentId,
      levelDefinitionId: submission.levelDefinitionId,
      sourceType: "report_approval",
      sourceId: `report-review:${reviewId}`,
      actorId: actorUserId,
      evaluationTime,
    });
  } catch (error) {
    if (!isCurriculumLevelCompletionError(error)) throw error;
    if (error.code === "COMPLETION_DISABLED") fail("REPORT_DISABLED", "report approval is disabled");
    if (error.code === "COMPLETION_CONFLICT" || error.code === "COMPLETION_IDEMPOTENCY_CONFLICT") {
      fail("REPORT_REVISION_CONFLICT", "report completion changed concurrently");
    }
    if (error.code === "COMPLETION_INTERNAL_ERROR") fail("REPORT_INTERNAL_ERROR", "report completion failed");
    fail("REPORT_STATE_CORRUPT", "report completion evidence is missing or corrupt");
  }
}

async function exactApprovalRetry(input: {
  tx: TransactionClient;
  actorUserId: number;
  command: z.infer<typeof reviewEvidenceSchema>;
  submission: ReviewSubmission;
  fingerprint: string;
}) {
  const receipt = await input.tx.reportCommandReceipt.findUnique({
    where: { actorUserId_requestId: { actorUserId: input.actorUserId, requestId: input.command.requestId } },
  });
  if (!receipt) return null;
  const safe = approvalReceiptResultSchema.safeParse(receipt.safeResult);
  if (
    receipt.submissionId !== input.submission.id || receipt.commandType !== "approve" ||
    receipt.payloadFingerprint !== input.fingerprint || !FINGERPRINT.test(receipt.payloadFingerprint) ||
    !safe.success || safe.data.submissionRef !== submissionRef(input.submission.id) ||
    safe.data.submittedRevision !== input.command.expectedSubmittedRevision ||
    receipt.targetRevisionId !== input.submission.submittedRevisionId ||
    receipt.resultRevisionId !== input.submission.submittedRevisionId ||
    receipt.resultingWorkflowVersion !== safe.data.workflowVersion
  ) fail("REPORT_IDEMPOTENCY_CONFLICT", "request id was already used for a different report approval command");

  const expectedScores = normalizeScores(input.submission, input.command.scores);
  const review = await input.tx.reportReview.findUnique({ where: { id: safe.data.reviewId }, include: { scores: true } });
  const durableScores = new Map(review?.scores.map((score) => [score.rubricCriterionId, score]));
  if (
    !review || review.submissionId !== input.submission.id ||
    review.revisionId !== input.submission.submittedRevisionId ||
    review.curriculumVersionId !== input.submission.curriculumVersionId ||
    review.levelDefinitionId !== input.submission.levelDefinitionId ||
    review.reportAssignmentVersionId !== input.submission.reportAssignmentVersionId ||
    review.reportRubricVersionId !== input.submission.reportRubricVersionId ||
    review.reviewerId !== input.actorUserId || review.decision !== "approved" ||
    review.rejectionReasonId !== null || review.humanComment !== null || review.correctiveAction !== null ||
    review.requestId !== input.command.requestId || review.payloadFingerprint !== input.fingerprint ||
    review.reviewedAt.toISOString() !== safe.data.completedAt ||
    durableScores.size !== expectedScores.length ||
    expectedScores.some((score) => {
      const durable = durableScores.get(score.criterion.id);
      return !durable || durable.reportRubricVersionId !== input.submission.reportRubricVersionId ||
        durable.rubricScaleOptionId !== score.option.id || durable.comment !== score.comment;
    }) ||
    input.submission.status !== "approved" ||
    input.submission.approvedRevisionId !== input.submission.submittedRevisionId ||
    input.submission.latestReviewId !== review.id || input.submission.approvedReviewId !== review.id ||
    input.submission.workflowVersion !== safe.data.workflowVersion ||
    input.submission.claimVersion !== safe.data.claimVersion ||
    input.submission.reviewedAt?.toISOString() !== safe.data.completedAt ||
    input.submission.approvedAt?.toISOString() !== safe.data.completedAt ||
    input.submission.claimedById !== null || input.submission.claimedAt !== null ||
    input.submission.claimExpiresAt !== null || input.submission.reviewStartedAt !== null ||
    receipt.appliedAt.toISOString() !== safe.data.completedAt
  ) fail("REPORT_STATE_CORRUPT", "durable report approval result is corrupt");

  const completion = await runReportCompletion(
    input.tx, input.submission, review.id, input.actorUserId, new Date(safe.data.completedAt),
  );
  if (
    completion.created || completion.xpTransactionId !== safe.data.xpTransactionId ||
    completion.xpAwarded !== safe.data.xpAwarded || completion.levelNumber !== safe.data.levelNumber ||
    completion.nextLevelNumber !== safe.data.nextLevelNumber || completion.terminal !== safe.data.terminal ||
    completion.completedAt.toISOString() !== safe.data.completedAt ||
    await input.tx.auditLog.count({
      where: { action: CURRICULUM_AUDIT_ACTIONS.reportApproved, entityType: "ReportSubmission", entityId: String(input.submission.id) },
    }) !== 1
  ) fail("REPORT_STATE_CORRUPT", "durable report approval completion is corrupt");
  return approvalResultFromReceipt(receipt, true);
}

async function mutateClaim(
  actorUserId: number,
  input: unknown,
  operation: "claim" | "renew" | "release" | "start_review",
  options: CommandOptions = {},
): Promise<SafeReviewCommandResult> {
  if (!flagsEnabled()) fail("REPORT_DISABLED", "report workflow is disabled");
  parseActorId(actorUserId);
  const command = parseCommand(claimCommandSchema, input);
  return executeCommand(options.db ?? prisma, async (tx) => {
    const evaluationTime = options.evaluationTime ?? new Date();
    const expiresAt = new Date(evaluationTime.getTime() + CLAIM_LEASE_MS);
    const { actor, submission } = await getCommandContext(tx, actorUserId, command);
    const fingerprint = commandFingerprint({ operation, actorUserId, submission, command });
    const retry = await exactRetry({
      tx, actorUserId, requestId: command.requestId, submission, commandType: "claim", fingerprint, operation,
      expectedSubmittedRevision: command.expectedSubmittedRevision,
    });
    if (retry) return retry;
    assertPendingReview(submission);
    validatePendingSubmission(submission);
    assertNotSelfReview(actorUserId, submission);
    assertExpected(command, submission);
    const active = submission.claimedById !== null && !!submission.claimExpiresAt && submission.claimExpiresAt > evaluationTime;
    if (operation === "claim") {
      if (active) fail("REPORT_CLAIM_CONFLICT", "report already has an active claim");
    } else {
      if (submission.claimedById !== actorUserId) fail("REPORT_CLAIM_NOT_OWNER", "review claim belongs to another reviewer");
      if (!active) fail("REPORT_CLAIM_EXPIRED", "review claim has expired");
    }
    if (operation === "start_review" && submission.reviewStartedAt !== null) {
      // reviewStartedAt is set exactly once per claim; a NEW request against an
      // already-started review is a typed no-change conflict, while the exact
      // durable retry above returns the original result without any write.
      fail("REPORT_NO_CHANGES", "report review was already started");
    }
    const workflowVersion = submission.workflowVersion + 1;
    const claimVersion = submission.claimVersion + 1;
    const where: Prisma.ReportSubmissionWhereInput = {
      id: submission.id,
      status: "pending_review",
      submittedRevisionId: submission.submittedRevisionId,
      workflowVersion: submission.workflowVersion,
      claimVersion: submission.claimVersion,
      claimedById: submission.claimedById,
      claimedAt: submission.claimedAt,
      claimExpiresAt: submission.claimExpiresAt,
    };
    const data: Prisma.ReportSubmissionUncheckedUpdateManyInput = operation === "release"
      ? {
          workflowVersion: { increment: 1 }, claimVersion: { increment: 1 },
          claimedById: null, claimedAt: null, claimExpiresAt: null, reviewStartedAt: null,
        }
      : operation === "start_review"
        ? {
            // The claim itself is untouched: the lease is deliberately NOT
            // extended and the server owns the one-time reviewStartedAt.
            workflowVersion: { increment: 1 }, claimVersion: { increment: 1 },
            reviewStartedAt: evaluationTime,
          }
        : {
            workflowVersion: { increment: 1 }, claimVersion: { increment: 1 },
            claimedById: actorUserId,
            ...(operation === "claim" ? { claimedAt: evaluationTime, reviewStartedAt: null } : {}),
            claimExpiresAt: expiresAt,
          };
    const updated = await tx.reportSubmission.updateMany({ where, data });
    if (updated.count !== 1) fail("REPORT_REVISION_CONFLICT", "review claim changed concurrently");
    const safeResult = safeReceiptResult({
      operation, submission, workflowVersion, claimVersion,
      claimState: operation === "release" ? "released" : "active",
      claimExpiresAt: operation === "release"
        ? null
        : operation === "start_review" ? submission.claimExpiresAt : expiresAt,
      reviewerRole: operation === "release" ? null : actor.role,
    });
    const receipt = await tx.reportCommandReceipt.create({ data: {
      actorUserId, submissionId: submission.id, commandType: "claim", requestId: command.requestId,
      payloadFingerprint: fingerprint, targetRevisionId: submission.submittedRevisionId,
      resultRevisionId: submission.submittedRevisionId, resultingWorkflowVersion: workflowVersion,
      safeResult, appliedAt: evaluationTime,
    } });
    if (operation === "claim" || operation === "start_review") await writeAudit(tx, {
      actor, submission,
      action: operation === "claim" ? CURRICULUM_AUDIT_ACTIONS.reportClaimed : CURRICULUM_AUDIT_ACTIONS.reportReviewStarted,
      workflowVersion, claimVersion,
      targetReviewerId: actorUserId,
    });
    return resultFromReceipt(receipt, false);
  });
}

export function claimReportForReview(actorUserId: number, input: unknown, options: CommandOptions = {}) {
  return mutateClaim(actorUserId, input, "claim", options);
}

export function renewOwnReportClaim(actorUserId: number, input: unknown, options: CommandOptions = {}) {
  return mutateClaim(actorUserId, input, "renew", options);
}

export function releaseOwnReportClaim(actorUserId: number, input: unknown, options: CommandOptions = {}) {
  return mutateClaim(actorUserId, input, "release", options);
}

// Marks the one-time server-owned reviewStartedAt for the caller's own active,
// unexpired claim. The lease is never extended, release/reassignment clear the
// marker through their existing contracts, and renew leaves it untouched.
export function startOwnReportReview(actorUserId: number, input: unknown, options: CommandOptions = {}) {
  return mutateClaim(actorUserId, input, "start_review", options);
}

export async function reassignReportClaim(actorUserId: number, input: unknown, options: CommandOptions = {}): Promise<SafeReviewCommandResult> {
  if (!flagsEnabled()) fail("REPORT_DISABLED", "report workflow is disabled");
  parseActorId(actorUserId);
  const command = parseCommand(reassignCommandSchema, input);
  return executeCommand(options.db ?? prisma, async (tx) => {
    const evaluationTime = options.evaluationTime ?? new Date();
    const expiresAt = new Date(evaluationTime.getTime() + CLAIM_LEASE_MS);
    const { actor, submission } = await getCommandContext(tx, actorUserId, command);
    if (actor.role !== "admin") fail("REPORT_REVIEWER_FORBIDDEN", "admin reviewer is required");
    const fingerprint = commandFingerprint({
      operation: "reassign", actorUserId, submission, command,
      payload: { targetReviewerId: command.targetReviewerId, reasonCode: command.reasonCode },
    });
    const retry = await exactRetry({
      tx, actorUserId, requestId: command.requestId, submission, commandType: "reassign", fingerprint,
      operation: "reassign", expectedSubmittedRevision: command.expectedSubmittedRevision,
    });
    if (retry) return retry;
    assertPendingReview(submission);
    validatePendingSubmission(submission);
    assertNotSelfReview(actorUserId, submission, command.targetReviewerId);
    assertExpected(command, submission);
    if (submission.claimedById === null) fail("REPORT_CLAIM_CONFLICT", "unclaimed report must be claimed normally");
    const target = await requireReviewer(tx, command.targetReviewerId);
    const workflowVersion = submission.workflowVersion + 1;
    const claimVersion = submission.claimVersion + 1;
    const updated = await tx.reportSubmission.updateMany({
      where: {
        id: submission.id, status: "pending_review", submittedRevisionId: submission.submittedRevisionId,
        workflowVersion: submission.workflowVersion, claimVersion: submission.claimVersion,
        claimedById: submission.claimedById, claimedAt: submission.claimedAt, claimExpiresAt: submission.claimExpiresAt,
      },
      data: {
        workflowVersion: { increment: 1 }, claimVersion: { increment: 1 },
        claimedById: target.id, claimedAt: evaluationTime, claimExpiresAt: expiresAt, reviewStartedAt: null,
      },
    });
    if (updated.count !== 1) fail("REPORT_REVISION_CONFLICT", "review claim changed concurrently");
    const safeResult = safeReceiptResult({
      operation: "reassign", submission, workflowVersion, claimVersion, claimState: "active",
      claimExpiresAt: expiresAt, reviewerRole: target.role, reasonCode: command.reasonCode,
    });
    const receipt = await tx.reportCommandReceipt.create({ data: {
      actorUserId, submissionId: submission.id, commandType: "reassign", requestId: command.requestId,
      payloadFingerprint: fingerprint, targetRevisionId: submission.submittedRevisionId,
      resultRevisionId: submission.submittedRevisionId, resultingWorkflowVersion: workflowVersion,
      safeResult, appliedAt: evaluationTime,
    } });
    await writeAudit(tx, {
      actor, submission, action: CURRICULUM_AUDIT_ACTIONS.reportReassigned,
      workflowVersion, claimVersion, targetReviewerId: target.id, reasonCode: command.reasonCode,
    });
    return resultFromReceipt(receipt, false);
  });
}

async function validateReadinessWithin(
  tx: TransactionClient,
  actorUserId: number,
  command: z.infer<typeof reviewEvidenceSchema>,
  evaluationTime: Date,
) {
  const { actor, submission } = await getCommandContext(tx, actorUserId, command);
  assertPendingReview(submission);
  validatePendingSubmission(submission);
  assertNotSelfReview(actorUserId, submission);
  assertExpected(command, submission);
  if (submission.claimedById !== actorUserId) fail("REPORT_CLAIM_NOT_OWNER", "review claim belongs to another reviewer");
  if (!submission.claimExpiresAt || submission.claimExpiresAt <= evaluationTime) fail("REPORT_CLAIM_EXPIRED", "review claim has expired");
  const scores = normalizeScores(submission, command.scores);
  return { actor, submission, scores };
}

export async function validateReportApprovalReadiness(
  actorUserId: number,
  input: unknown,
  options: CommandOptions = {},
): Promise<ApprovalReadinessResult> {
  if (!flagsEnabled()) fail("REPORT_DISABLED", "report workflow is disabled");
  parseActorId(actorUserId);
  const command = parseCommand(reviewEvidenceSchema, input);
  const run = async (tx: TransactionClient) => {
    const evaluationTime = options.evaluationTime ?? new Date();
    const { actor, submission, scores } = await validateReadinessWithin(tx, actorUserId, command, evaluationTime);
    return {
      kind: "ready" as const,
      submissionRef: submissionRef(submission.id),
      submittedRevision: submission.submittedRevision!.revisionNumber,
      workflowVersion: submission.workflowVersion,
      claimVersion: submission.claimVersion,
      reviewerRole: actor.role,
      scoreCount: scores.length,
    };
  };
  if (options.db) return options.db.$transaction(run);
  return prisma.$transaction(run);
}

export async function rejectReportSubmission(actorUserId: number, input: unknown, options: CommandOptions = {}): Promise<SafeReviewCommandResult> {
  if (!flagsEnabled()) fail("REPORT_DISABLED", "report workflow is disabled");
  parseActorId(actorUserId);
  const command = parseCommand(rejectCommandSchema, input);
  if (UNSAFE_TEXT.test(command.humanComment) || UNSAFE_TEXT.test(command.correctiveAction)) fail("REPORT_REVIEW_INPUT_INVALID", "review feedback is unsafe");
  return executeCommand(options.db ?? prisma, async (tx) => {
    const evaluationTime = options.evaluationTime ?? new Date();
    const { actor, submission } = await getCommandContext(tx, actorUserId, command);
    const normalizedScores = command.scores.map((score) => ({
      criterionCode: score.criterionCode, scaleCode: score.scaleCode, comment: score.comment?.trim() ?? null,
    })).sort((left, right) => left.criterionCode.localeCompare(right.criterionCode));
    const fingerprint = commandFingerprint({
      operation: "reject", actorUserId, submission, command,
      payload: {
        reasonCode: command.reasonCode,
        humanComment: command.humanComment.trim(),
        correctiveAction: command.correctiveAction.trim(),
        scores: normalizedScores,
      },
    });
    const retry = await exactRetry({
      tx, actorUserId, requestId: command.requestId, submission, commandType: "reject", fingerprint,
      operation: "reject", expectedSubmittedRevision: command.expectedSubmittedRevision,
    });
    if (retry) return retry;
    const readiness = await validateReadinessWithin(tx, actorUserId, command, evaluationTime);
    const reason = validateDefinitionGraph(submission).reasons.get(command.reasonCode);
    if (!reason || !reason.active) fail("REPORT_REASON_MISMATCH", "rejection reason does not belong to the pinned rubric");
    const review = await tx.reportReview.create({ data: {
      submissionId: submission.id,
      revisionId: submission.submittedRevisionId!,
      curriculumVersionId: submission.curriculumVersionId,
      levelDefinitionId: submission.levelDefinitionId,
      reportAssignmentVersionId: submission.reportAssignmentVersionId,
      reportRubricVersionId: submission.reportRubricVersionId,
      reviewerId: actorUserId,
      reviewerRoleSnapshot: actor.role as UserRole,
      decision: "rejected",
      humanComment: command.humanComment.trim(),
      correctiveAction: command.correctiveAction.trim(),
      rejectionReasonId: reason.id,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      claimedAt: submission.claimedAt,
      claimExpiresAt: submission.claimExpiresAt,
      reviewStartedAt: submission.reviewStartedAt,
      reviewedAt: evaluationTime,
    } });
    await tx.reportReviewScore.createMany({ data: readiness.scores.map((score) => ({
      reportReviewId: review.id,
      reportRubricVersionId: submission.reportRubricVersionId,
      rubricCriterionId: score.criterion.id,
      rubricScaleOptionId: score.option.id,
      comment: score.comment,
    })) });
    const workflowVersion = submission.workflowVersion + 1;
    const claimVersion = submission.claimVersion + 1;
    const updated = await tx.reportSubmission.updateMany({
      where: {
        id: submission.id, status: "pending_review", submittedRevisionId: submission.submittedRevisionId,
        workflowVersion: submission.workflowVersion, claimVersion: submission.claimVersion,
        claimedById: actorUserId, claimedAt: submission.claimedAt, claimExpiresAt: submission.claimExpiresAt,
      },
      data: {
        status: "rejected", workflowVersion: { increment: 1 }, claimVersion: { increment: 1 },
        latestReviewId: review.id, reviewedAt: evaluationTime, rejectedAt: evaluationTime,
        claimedById: null, claimedAt: null, claimExpiresAt: null, reviewStartedAt: null,
      },
    });
    if (updated.count !== 1) fail("REPORT_REVISION_CONFLICT", "report review changed concurrently");
    const progress = await tx.userLevelProgress.updateMany({
      where: { id: submission.userLevelProgressId, status: "pending_review" },
      data: { status: "in_progress", lastProgressAt: evaluationTime },
    });
    if (progress.count !== 1) fail("REPORT_REVISION_CONFLICT", "report progress changed concurrently");

    // LO-REVIEW-WORKITEM-UNREACHABLE-1 — mirror the revision request.
    //
    // `rejected` is this domain's vocabulary for "changes requested": the
    // decision carries a required reason and corrective action, and the learner
    // resubmits the SAME submission. Operationally the ball is now with the
    // learner, so the derived case moves to `waiting_learner` — which is
    // already the state the SLA engine pauses the resolution clock on, so ATA
    // stops being charged for time it is not waiting on.
    await reconcileReportReviewOperationalState(tx, {
      submissionId: submission.id,
      canonicalState: "rejected",
      actor: await resolveOperationalActor(tx, actorUserId),
      reason: "report:revision_requested",
    });

    const safeResult = safeReceiptResult({
      operation: "reject", submission, workflowVersion, claimVersion,
      claimState: "closed", claimExpiresAt: null, reviewerRole: null, reasonCode: reason.stableKey,
    });
    const receipt = await tx.reportCommandReceipt.create({ data: {
      actorUserId, submissionId: submission.id, commandType: "reject", requestId: command.requestId,
      payloadFingerprint: fingerprint, targetRevisionId: submission.submittedRevisionId,
      resultRevisionId: submission.submittedRevisionId, resultingWorkflowVersion: workflowVersion,
      safeResult, appliedAt: evaluationTime,
    } });
    await writeAudit(tx, {
      actor, submission, action: CURRICULUM_AUDIT_ACTIONS.reportRejected,
      workflowVersion, claimVersion, reasonCode: reason.stableKey,
    });
    return resultFromReceipt(receipt, false);
  });
}

export async function listReportReviewQueue(
  actorUserId: number,
  input: unknown,
  options: { db?: TransactionClient; evaluationTime?: Date } = {},
): Promise<ReviewerQueueResult> {
  if (!flagsEnabled()) return { kind: "disabled" };
  if (!Number.isSafeInteger(actorUserId) || actorUserId < 1) return { kind: "forbidden" };
  const parsed = queueSchema.safeParse(input);
  if (!parsed.success) fail("REPORT_REVIEW_INPUT_INVALID", "review queue query is invalid");
  const cursor = decodeCursor(parsed.data.cursor);
  if (cursor === null) fail("REPORT_REVIEW_INPUT_INVALID", "review queue cursor is invalid");
  const run = async (tx: TransactionClient): Promise<ReviewerQueueResult> => {
    const evaluationTime = options.evaluationTime ?? new Date();
    let actor: { id: number; role: ReviewerRole };
    try { actor = await requireReviewer(tx, actorUserId); }
    catch (error) { if (isReportDomainError(error, "REPORT_REVIEWER_FORBIDDEN")) return { kind: "forbidden" }; throw error; }
    const rows = await tx.reportSubmission.findMany({
      where: {
        status: "pending_review",
        userId: { not: actorUserId },
        ...(cursor ? { OR: [{ submittedAt: { gt: cursor.submittedAt } }, { submittedAt: cursor.submittedAt, id: { gt: cursor.id } }] } : {}),
      },
      include: submissionInclude,
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      take: parsed.data.limit + 1,
    });
    const items: SafeReviewerQueueItem[] = [];
    for (const submission of rows.slice(0, parsed.data.limit)) {
      validatePendingSubmission(submission);
      const graph = validateDefinitionGraph(submission, parsed.data.locale);
      const assignmentLocale = graph.assignmentLocale!;
      const scale = submission.rubric.scaleOptions.map((option) => {
        const localized = option.localizations.find((item) => item.locale === parsed.data.locale);
        if (!localized) fail("REPORT_LOCALIZATION_UNAVAILABLE", "report localization is unavailable");
        return { code: option.stableKey, label: localized.label, description: localized.description };
      });
      const fields = submission.assignment.fields.map((field) => {
        const localized = field.localizations.find((item) => item.locale === parsed.data.locale);
        if (!localized) fail("REPORT_LOCALIZATION_UNAVAILABLE", "report localization is unavailable");
        return {
          code: field.stableKey, type: field.type, required: field.required,
          label: localized.label, helpText: localized.helpText,
        };
      });
      const criteria = submission.rubric.criteria.map((criterion) => {
        const localized = criterion.localizations.find((item) => item.locale === parsed.data.locale);
        if (!localized) fail("REPORT_LOCALIZATION_UNAVAILABLE", "report localization is unavailable");
        return {
          code: criterion.stableKey, categoryCode: criterion.categoryCode,
          commentRequired: criterion.commentRequired, title: localized.title, description: localized.description,
        };
      });
      const active = submission.claimedById !== null && !!submission.claimExpiresAt && submission.claimExpiresAt > evaluationTime;
      const claimState = submission.claimedById === null
        ? "unclaimed" as const
        : active && submission.claimedById === actor.id
          ? "owned_by_you" as const
          : active ? "claimed" as const : "expired" as const;
      items.push({
        submissionRef: submissionRef(submission.id),
        owner: { displayName: submission.user.name },
        curriculum: { code: submission.curriculumVersion.code, versionNumber: submission.curriculumVersion.versionNumber },
        level: { stableCode: submission.levelDefinition.stableCode, levelNumber: submission.levelDefinition.levelNumber, title: submission.levelDefinition.title },
        assignment: {
          versionNumber: submission.assignment.versionNumber,
          title: assignmentLocale.title,
          instructions: assignmentLocale.instructions,
          successCriteriaSummary: assignmentLocale.successCriteriaSummary,
          fields,
        },
        rubric: { versionNumber: submission.rubric.versionNumber, criteria, scale },
        revision: {
          revisionNumber: submission.submittedRevision!.revisionNumber,
          values: safeSubmittedValues(submission),
        },
        submittedAt: submission.submittedAt!.toISOString(),
        claim: { state: claimState, expiresAt: submission.claimExpiresAt?.toISOString() ?? null },
      });
    }
    const last = rows.length > parsed.data.limit ? rows[parsed.data.limit - 1] : null;
    return { kind: "resolved", items, nextCursor: last?.submittedAt ? encodeCursor(last.submittedAt, last.id) : null };
  };
  if (options.db) return run(options.db);
  return prisma.$transaction(run);
}

const detailSchema = z.strictObject({
  submissionRef: submissionRefSchema,
  locale: reportLocaleSchema,
});

export type SafeReviewerDetailAttachment = {
  attachmentId: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  revisionNumber: number;
  availableAt: string | null;
};

export type SafeReviewerSubmissionDetail = {
  submissionRef: string;
  access: "summary" | "full";
  status: "pending_review";
  submittedRevision: number;
  workflowVersion: number;
  claimVersion: number;
  submittedAt: string;
  claim: { state: "unclaimed" | "owned_by_you" | "claimed" | "expired"; expiresAt: string | null };
  reviewStartedAt: string | null;
  payload: {
    owner: { displayName: string };
    curriculum: { code: string; versionNumber: number };
    level: { stableCode: string; levelNumber: number; title: string };
    assignment: SafeReviewerQueueItem["assignment"];
    rubric: SafeReviewerQueueItem["rubric"];
    revision: SafeReviewerQueueItem["revision"];
    rejectionReasons: Array<{ code: string; title: string; guidance: string | null }>;
    attachments: SafeReviewerDetailAttachment[];
  } | null;
  /**
   * LO-REVIEW-WORKITEM-UNREACHABLE-1 §15 — the OPERATIONAL half of the same
   * work, so the specialized review view and the unified Learner Operations
   * queue reconcile to one object instead of being two independent truth sets.
   *
   * It is a POINTER, not authority: the reference and the operational status
   * let a reviewer navigate to the case and see who owns it and what its SLA
   * says. Nothing about the educational decision is read from here, and nothing
   * written here can change one.
   */
  operationalWorkItem: {
    caseId: string;
    reference: string;
    status: string;
    assignedStaffDisplayName: string | null;
  } | null;
};

export type ReviewerDetailResult =
  | { kind: "disabled" }
  | { kind: "forbidden" }
  | { kind: "resolved"; detail: SafeReviewerSubmissionDetail };

// Read-only reviewer detail. The summary tier exposes only the CAS versions
// and claim state a reviewer needs to issue a claim; the full report payload,
// localized definitions, rejection catalog and available attachment
// descriptors are revealed exclusively to the current active, unexpired claim
// owner. Admins get no bypass without their own claim. Ownership, wrong-state
// and unknown identities collapse into one not-found. No writes, audits or
// timestamp touches happen here.
export async function getReportReviewDetail(
  actorUserId: number,
  input: unknown,
  options: { db?: TransactionClient; evaluationTime?: Date } = {},
): Promise<ReviewerDetailResult> {
  if (!flagsEnabled()) return { kind: "disabled" };
  if (!Number.isSafeInteger(actorUserId) || actorUserId < 1) return { kind: "forbidden" };
  const parsed = detailSchema.safeParse(input);
  if (!parsed.success) fail("REPORT_REVIEW_INPUT_INVALID", "review detail query is invalid");
  const run = async (tx: TransactionClient): Promise<ReviewerDetailResult> => {
    const evaluationTime = options.evaluationTime ?? new Date();
    let actor: { id: number; role: ReviewerRole };
    try { actor = await requireReviewer(tx, actorUserId); }
    catch (error) { if (isReportDomainError(error, "REPORT_REVIEWER_FORBIDDEN")) return { kind: "forbidden" }; throw error; }
    const id = parseSubmissionRef(parsed.data.submissionRef);
    if (!id) fail("REPORT_SUBMISSION_NOT_FOUND", "report submission was not found");
    const submission = await loadSubmission(tx, id);
    if (
      !submission || submission.userId === actor.id || submission.status !== "pending_review"
    ) fail("REPORT_SUBMISSION_NOT_FOUND", "report submission was not found");
    validatePendingSubmission(submission);
    const active = submission.claimedById !== null && !!submission.claimExpiresAt && submission.claimExpiresAt > evaluationTime;
    const claimState = submission.claimedById === null
      ? "unclaimed" as const
      : active && submission.claimedById === actor.id
        ? "owned_by_you" as const
        : active ? "claimed" as const : "expired" as const;
    const base = {
      submissionRef: submissionRef(submission.id),
      status: "pending_review" as const,
      submittedRevision: submission.submittedRevision!.revisionNumber,
      workflowVersion: submission.workflowVersion,
      claimVersion: submission.claimVersion,
      submittedAt: submission.submittedAt!.toISOString(),
      claim: { state: claimState, expiresAt: submission.claimExpiresAt?.toISOString() ?? null },
    };
    // The operational pointer is available at BOTH tiers: knowing that a case
    // exists and who owns it operationally is not privileged review content,
    // and withholding it from the summary tier would leave the unclaimed queue
    // unable to show that the work is already tracked.
    const workItem = await tx.learnerOpsCase.findFirst({
      where: { reportSubmissionId: submission.id },
      select: {
        id: true, reference: true, status: true,
        assignedStaff: { select: { displayName: true } },
      },
    });
    const operationalWorkItem = workItem
      ? {
          caseId: workItem.id,
          reference: workItem.reference,
          status: workItem.status,
          assignedStaffDisplayName: workItem.assignedStaff?.displayName ?? null,
        }
      : null;

    if (claimState !== "owned_by_you") {
      return {
        kind: "resolved",
        detail: { ...base, access: "summary", reviewStartedAt: null, payload: null, operationalWorkItem },
      };
    }
    const graph = validateDefinitionGraph(submission, parsed.data.locale);
    const assignmentLocale = graph.assignmentLocale!;
    const fields = submission.assignment.fields.map((field) => {
      const localized = field.localizations.find((item) => item.locale === parsed.data.locale);
      if (!localized) fail("REPORT_LOCALIZATION_UNAVAILABLE", "report localization is unavailable");
      return { code: field.stableKey, type: field.type, required: field.required, label: localized.label, helpText: localized.helpText };
    });
    const criteria = submission.rubric.criteria.map((criterion) => {
      const localized = criterion.localizations.find((item) => item.locale === parsed.data.locale);
      if (!localized) fail("REPORT_LOCALIZATION_UNAVAILABLE", "report localization is unavailable");
      return { code: criterion.stableKey, categoryCode: criterion.categoryCode, commentRequired: criterion.commentRequired, title: localized.title, description: localized.description };
    });
    const scale = submission.rubric.scaleOptions.map((option) => {
      const localized = option.localizations.find((item) => item.locale === parsed.data.locale);
      if (!localized) fail("REPORT_LOCALIZATION_UNAVAILABLE", "report localization is unavailable");
      return { code: option.stableKey, label: localized.label, description: localized.description };
    });
    const rejectionReasons = submission.rubric.rejectionReasons
      .filter((reason) => reason.active)
      .map((reason) => ({ reason, localized: reason.localizations.find((item) => item.locale === parsed.data.locale) }))
      .filter((entry) => entry.localized !== undefined)
      .sort((left, right) => left.reason.sortOrder - right.reason.sortOrder || left.reason.stableKey.localeCompare(right.reason.stableKey))
      .map((entry) => ({ code: entry.reason.stableKey, title: entry.localized!.title, guidance: entry.localized!.guidance }));
    let attachments: SafeReviewerDetailAttachment[] = [];
    if (isCurriculumV2ReportAttachmentsEnabled()) {
      const revisions = await tx.reportRevision.findMany({
        where: { submissionId: submission.id },
        select: { revisionNumber: true, kind: true },
      });
      const submittedNumber = submission.submittedRevision!.revisionNumber;
      let previousSubmitted = 0;
      for (const revision of revisions) {
        if (revision.kind !== "draft_autosave" && revision.revisionNumber < submittedNumber && revision.revisionNumber > previousSubmitted) {
          previousSubmitted = revision.revisionNumber;
        }
      }
      const rows = await tx.reportAttachment.findMany({
        where: { submissionId: submission.id, status: "available" },
        select: {
          id: true, originalName: true, mimeType: true, sizeBytes: true, availableAt: true,
          revision: { select: { revisionNumber: true } },
        },
        orderBy: { id: "asc" },
      });
      attachments = rows
        .filter((row) => row.revision.revisionNumber > previousSubmitted && row.revision.revisionNumber < submittedNumber)
        .map((row) => ({
          attachmentId: row.id,
          fileName: row.originalName,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          revisionNumber: row.revision.revisionNumber,
          availableAt: row.availableAt?.toISOString() ?? null,
        }));
    }
    return {
      kind: "resolved",
      detail: {
        ...base,
        access: "full",
        reviewStartedAt: submission.reviewStartedAt?.toISOString() ?? null,
        operationalWorkItem,
        payload: {
          owner: { displayName: submission.user.name },
          curriculum: { code: submission.curriculumVersion.code, versionNumber: submission.curriculumVersion.versionNumber },
          level: { stableCode: submission.levelDefinition.stableCode, levelNumber: submission.levelDefinition.levelNumber, title: submission.levelDefinition.title },
          assignment: {
            versionNumber: submission.assignment.versionNumber,
            title: assignmentLocale.title,
            instructions: assignmentLocale.instructions,
            successCriteriaSummary: assignmentLocale.successCriteriaSummary,
            fields,
          },
          rubric: { versionNumber: submission.rubric.versionNumber, criteria, scale },
          revision: { revisionNumber: submittedRevisionNumberOf(submission), values: safeSubmittedValues(submission) },
          rejectionReasons,
          attachments,
        },
      },
    };
  };
  if (options.db) return run(options.db);
  return prisma.$transaction(run);
}

function submittedRevisionNumberOf(submission: ReviewSubmission) {
  return submission.submittedRevision!.revisionNumber;
}

export async function approveReportSubmission(
  actorUserId: number,
  input: unknown,
  options: CommandOptions = {},
): Promise<SafeReportApprovalResult> {
  // REPORT (with READ + ENROLLMENT) gates approval at entry. The XP flag is NOT
  // required here: per the operator platform rule it is required only for a
  // positive reward, which the completion primitive enforces once the level (and
  // therefore its reward) is loaded — a positive reward with XP disabled surfaces
  // as COMPLETION_DISABLED and is mapped to REPORT_DISABLED inside runReportCompletion,
  // rolling the whole approval back atomically. A zero-reward level needs no XP flag.
  if (!flagsEnabled()) fail("REPORT_DISABLED", "report approval is disabled");
  parseActorId(actorUserId);
  const command = parseCommand(reviewEvidenceSchema, input);
  return executeCommand(options.db ?? prisma, async (tx) => {
    const evaluationTime = options.evaluationTime ?? new Date();
    const { actor, submission } = await getCommandContext(tx, actorUserId, command);
    const normalizedPayload = command.scores.map((score) => ({
      criterionCode: score.criterionCode,
      scaleCode: score.scaleCode,
      comment: score.comment?.trim() ?? null,
    })).sort((left, right) => left.criterionCode.localeCompare(right.criterionCode));
    const fingerprint = commandFingerprint({
      operation: "approve",
      actorUserId,
      submission,
      command,
      payload: { scores: normalizedPayload },
    });
    const retry = await exactApprovalRetry({ tx, actorUserId, command, submission, fingerprint });
    if (retry) return retry;

    const readiness = await validateReadinessWithin(tx, actorUserId, command, evaluationTime);
    const review = await tx.reportReview.create({ data: {
      submissionId: submission.id,
      revisionId: submission.submittedRevisionId!,
      curriculumVersionId: submission.curriculumVersionId,
      levelDefinitionId: submission.levelDefinitionId,
      reportAssignmentVersionId: submission.reportAssignmentVersionId,
      reportRubricVersionId: submission.reportRubricVersionId,
      reviewerId: actorUserId,
      reviewerRoleSnapshot: actor.role as UserRole,
      decision: "approved",
      humanComment: null,
      correctiveAction: null,
      rejectionReasonId: null,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      claimedAt: submission.claimedAt,
      claimExpiresAt: submission.claimExpiresAt,
      reviewStartedAt: submission.reviewStartedAt,
      reviewedAt: evaluationTime,
    } });
    await tx.reportReviewScore.createMany({ data: readiness.scores.map((score) => ({
      reportReviewId: review.id,
      reportRubricVersionId: submission.reportRubricVersionId,
      rubricCriterionId: score.criterion.id,
      rubricScaleOptionId: score.option.id,
      comment: score.comment,
    })) });

    const completion = await runReportCompletion(tx, submission, review.id, actorUserId, evaluationTime);
    if (!completion.created) fail("REPORT_STATE_CORRUPT", "report completion existed before approval");
    const workflowVersion = submission.workflowVersion + 1;
    const claimVersion = submission.claimVersion + 1;
    const updated = await tx.reportSubmission.updateMany({
      where: {
        id: submission.id,
        status: "pending_review",
        activeRevisionId: submission.submittedRevisionId,
        submittedRevisionId: submission.submittedRevisionId,
        approvedRevisionId: null,
        approvedReviewId: null,
        workflowVersion: submission.workflowVersion,
        claimVersion: submission.claimVersion,
        claimedById: actorUserId,
        claimedAt: submission.claimedAt,
        claimExpiresAt: submission.claimExpiresAt,
      },
      data: {
        status: "approved",
        workflowVersion: { increment: 1 },
        claimVersion: { increment: 1 },
        approvedRevisionId: submission.submittedRevisionId,
        latestReviewId: review.id,
        approvedReviewId: review.id,
        reviewedAt: evaluationTime,
        approvedAt: evaluationTime,
        rejectedAt: null,
        claimedById: null,
        claimedAt: null,
        claimExpiresAt: null,
        reviewStartedAt: null,
      },
    });
    if (updated.count !== 1) fail("REPORT_REVISION_CONFLICT", "report approval changed concurrently");

    // LO-REVIEW-WORKITEM-UNREACHABLE-1 — resolve the operational mirror.
    //
    // AFTER the canonical row already says `approved`, and inside the same
    // transaction. That ordering is what lets this pass the terminal invariant
    // in `review-work-item-invariants.ts`: the invariant refuses `resolved`
    // while the report is not approved, and by this line it is. No exemption,
    // no privileged actor, no flag — the canonical decision simply happened
    // first, which is the whole authority model in one line of ordering.
    await reconcileReportReviewOperationalState(tx, {
      submissionId: submission.id,
      canonicalState: "approved",
      actor: await resolveOperationalActor(tx, actorUserId),
      reason: "report:approved",
    });

    // G4-GROWTH — the canonical `report_approved` event.
    //
    // KEYED ON THE SUBMISSION, not on this review row. A submission is approved
    // once, and a key on the review would let a second approval of the same work
    // — however it arose — produce a second business event. The review id is
    // still recorded as the source ENTITY, so the exact row that approved it
    // stays traceable.
    //
    // The level completion this approval drives emits its own `level_completed`
    // from the completion owner. Both are true and neither is derived from the
    // other.
    await emitReportApprovedEvent(tx, {
      submissionId: submission.id,
      reviewId: review.id,
      userId: submission.userId,
      enrollmentId: submission.enrollmentId,
      levelDefinitionId: submission.levelDefinitionId,
      occurredAt: evaluationTime,
    });

    const safeResult = approvalReceiptResult({
      submission, workflowVersion, claimVersion, reviewId: review.id, completion,
    });
    const receipt = await tx.reportCommandReceipt.create({ data: {
      actorUserId,
      submissionId: submission.id,
      commandType: "approve",
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      targetRevisionId: submission.submittedRevisionId,
      resultRevisionId: submission.submittedRevisionId,
      resultingWorkflowVersion: workflowVersion,
      safeResult,
      appliedAt: evaluationTime,
    } });
    await writeAudit(tx, {
      actor,
      submission,
      action: CURRICULUM_AUDIT_ACTIONS.reportApproved,
      workflowVersion,
      claimVersion,
      reviewId: review.id,
      xpTransactionId: completion.xpTransactionId,
      xpAwarded: completion.xpAwarded,
      terminal: completion.terminal,
      status: "approved",
    });
    return approvalResultFromReceipt(receipt, false);
  });
}
