/**
 * Strict runtime contract for the Backend reviewer API.
 *
 * Every schema is `.strict()`. That matters more than it looks: it is what makes
 * an unexpected backend field a loud failure here rather than a quiet leak of
 * learner data into a staff client. It also means CRM cannot accidentally start
 * depending on a field nobody reviewed.
 *
 * Nothing in this file encodes product truth. The 43 report fields, the R1–R7
 * criteria, the rubric scale and the rejection reasons are all *described* by the
 * backend payload and merely validated here — there is no duplicate schema and no
 * hardcoded scoring authority. If the backend publishes an eighth criterion, this
 * renders eight.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ shared */

/**
 * A submitted field value. The union is the closed set the backend can send.
 * An unrecognised shape fails the parse rather than reaching the renderer as
 * `unknown` — see `07_DEFINITION_DRIVEN_RENDERING`.
 */
export const ReportFieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

export type ReportFieldValue = z.infer<typeof ReportFieldValueSchema>;

/**
 * A field *definition*, as the backend localizes it.
 *
 * `type` is deliberately a plain string, not an enum. The renderer switches on
 * known types and falls through to an explicit "unsupported type" warning for
 * anything else; pinning an enum here would turn a new backend field type into a
 * whole-page parse failure instead of one visibly-degraded row.
 *
 * Note what is absent: there is no localized choice catalog. For a
 * `single_choice` field the backend sends the label of the *field*, never labels
 * for its options, so a stored value like `"up"` can only be shown as its stable
 * code. CRM must not invent translations for those.
 */
export const ReportFieldDefinitionSchema = z
  .object({
    code: z.string().min(1),
    type: z.string().min(1),
    required: z.boolean(),
    label: z.string().min(1),
    helpText: z.string().nullable(),
  })
  .strict();

export type ReportFieldDefinition = z.infer<typeof ReportFieldDefinitionSchema>;

export const ReportAssignmentSchema = z
  .object({
    versionNumber: z.number().int(),
    title: z.string().min(1),
    instructions: z.string(),
    successCriteriaSummary: z.string().nullable(),
    fields: z.array(ReportFieldDefinitionSchema),
  })
  .strict();

export const RubricCriterionSchema = z
  .object({
    code: z.string().min(1),
    categoryCode: z.string(),
    commentRequired: z.boolean(),
    title: z.string().min(1),
    description: z.string(),
  })
  .strict();

export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

export const RubricScaleOptionSchema = z
  .object({
    code: z.string().min(1),
    label: z.string().min(1),
    description: z.string().nullable(),
  })
  .strict();

export type RubricScaleOption = z.infer<typeof RubricScaleOptionSchema>;

export const RubricSchema = z
  .object({
    versionNumber: z.number().int(),
    criteria: z.array(RubricCriterionSchema),
    scale: z.array(RubricScaleOptionSchema),
  })
  .strict();

export type Rubric = z.infer<typeof RubricSchema>;

export const SubmittedRevisionSchema = z
  .object({
    revisionNumber: z.number().int().min(1),
    values: z.record(z.string(), ReportFieldValueSchema),
  })
  .strict();

export const ClaimStateSchema = z.enum(["unclaimed", "owned_by_you", "claimed", "expired"]);
export type ClaimState = z.infer<typeof ClaimStateSchema>;

export const ClaimSchema = z
  .object({ state: ClaimStateSchema, expiresAt: z.string().nullable() })
  .strict();

/* ------------------------------------------------------------------- queue */

export const QueueItemSchema = z
  .object({
    submissionRef: z.string().min(1),
    owner: z.object({ displayName: z.string().min(1) }).strict(),
    curriculum: z.object({ code: z.string(), versionNumber: z.number().int() }).strict(),
    level: z
      .object({
        stableCode: z.string().min(1),
        levelNumber: z.number().int(),
        title: z.string().min(1),
      })
      .strict(),
    assignment: ReportAssignmentSchema,
    rubric: RubricSchema,
    revision: SubmittedRevisionSchema,
    submittedAt: z.string().min(1),
    claim: ClaimSchema,
  })
  .strict();

export type QueueItem = z.infer<typeof QueueItemSchema>;

export const QueuePageSchema = z
  .object({ items: z.array(QueueItemSchema), nextCursor: z.string().nullable() })
  .strict();

export type QueuePage = z.infer<typeof QueuePageSchema>;

/* ------------------------------------------------------------------ detail */

export const RejectionReasonSchema = z
  .object({
    code: z.string().min(1),
    title: z.string().min(1),
    guidance: z.string().nullable(),
  })
  .strict();

export type RejectionReason = z.infer<typeof RejectionReasonSchema>;

/**
 * Attachment descriptors. Present in the contract but always empty while
 * `CURRICULUM_V2_REPORT_ATTACHMENTS_ENABLED` is off. Validated so an unexpected
 * non-empty list is visible in tests; deliberately never rendered, and no
 * attachment route is ever called.
 */
export const DetailAttachmentSchema = z
  .object({
    attachmentId: z.number().int(),
    fileName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int(),
    revisionNumber: z.number().int(),
    availableAt: z.string().nullable(),
  })
  .strict();

export const DetailPayloadSchema = z
  .object({
    owner: z.object({ displayName: z.string().min(1) }).strict(),
    curriculum: z.object({ code: z.string(), versionNumber: z.number().int() }).strict(),
    level: z
      .object({
        stableCode: z.string().min(1),
        levelNumber: z.number().int(),
        title: z.string().min(1),
      })
      .strict(),
    assignment: ReportAssignmentSchema,
    rubric: RubricSchema,
    revision: SubmittedRevisionSchema,
    rejectionReasons: z.array(RejectionReasonSchema),
    attachments: z.array(DetailAttachmentSchema),
  })
  .strict();

export type DetailPayload = z.infer<typeof DetailPayloadSchema>;

/**
 * The reviewer detail.
 *
 * Two access tiers, and the distinction drives the whole workflow: the backend
 * releases the report payload **only** to the holder of the active claim. Before
 * claiming, a reviewer sees `access: "summary"` with `payload: null` — enough to
 * issue a claim (the three CAS versions) and nothing else. This is not a CRM
 * choice to work around; it is the contract.
 */
export const ReviewDetailSchema = z
  .object({
    submissionRef: z.string().min(1),
    access: z.enum(["summary", "full"]),
    status: z.literal("pending_review"),
    submittedRevision: z.number().int().min(1),
    workflowVersion: z.number().int().min(0),
    claimVersion: z.number().int().min(0),
    submittedAt: z.string().min(1),
    claim: ClaimSchema,
    reviewStartedAt: z.string().nullable(),
    payload: DetailPayloadSchema.nullable(),
    /**
     * LO-REVIEW-WORKITEM-UNREACHABLE-1 §15 — the operational half of the same
     * work. A POINTER, never authority: it lets a reviewer see that the work is
     * tracked in the unified queue, who owns it operationally, and navigate to
     * it. The educational decision is still made here, by the canonical
     * commands below.
     */
    operationalWorkItem: z
      .object({
        caseId: z.string().min(1),
        reference: z.string().min(1),
        status: z.string().min(1),
        assignedStaffDisplayName: z.string().nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type ReviewDetail = z.infer<typeof ReviewDetailSchema>;

/* --------------------------------------------------------------- decisions */

/** The three-way optimistic-concurrency tuple every reviewer command carries. */
export const CasSchema = z
  .object({
    expectedWorkflowVersion: z.number().int().min(0),
    expectedClaimVersion: z.number().int().min(0),
    expectedSubmittedRevision: z.number().int().min(1),
  })
  .strict();

export type Cas = z.infer<typeof CasSchema>;

export const ReviewScoreSchema = z
  .object({
    criterionCode: z.string().min(1).max(64),
    scaleCode: z.string().min(1).max(64),
    comment: z.string().min(1).max(4_000).optional(),
  })
  .strict();

export type ReviewScore = z.infer<typeof ReviewScoreSchema>;

export const CommandResultSchema = z
  .object({
    operation: z.string(),
    created: z.boolean(),
    retry: z.boolean(),
    submissionRef: z.string(),
    submittedRevision: z.number().int(),
    workflowVersion: z.number().int(),
    claimVersion: z.number().int(),
    claim: z
      .object({
        state: z.enum(["active", "released", "closed"]),
        expiresAt: z.string().nullable(),
        reviewerRole: z.string().nullable(),
      })
      .strict(),
    reasonCode: z.string().nullable(),
    appliedAt: z.string(),
  })
  .strict();

export type CommandResult = z.infer<typeof CommandResultSchema>;

/**
 * The approval receipt.
 *
 * `completion.xpTransactionId` is `null` for a zero-reward level and carries the
 * exact ledger id otherwise. `xpAwarded` is 0 for L3. CRM renders these values;
 * it never computes completion or unlock itself.
 */
export const ApprovalResultSchema = z
  .object({
    operation: z.literal("approve"),
    created: z.boolean(),
    retry: z.boolean(),
    submissionRef: z.string(),
    submittedRevision: z.number().int(),
    workflowVersion: z.number().int(),
    claimVersion: z.number().int(),
    reviewId: z.number().int(),
    completion: z
      .object({
        xpTransactionId: z.number().int().nullable(),
        xpAwarded: z.number().int(),
        levelNumber: z.number().int(),
        nextLevelNumber: z.number().int().nullable(),
        terminal: z.boolean(),
        completedAt: z.string(),
      })
      .strict(),
    appliedAt: z.string(),
  })
  .strict();

export type ApprovalResult = z.infer<typeof ApprovalResultSchema>;

/* ----------------------------------------------------------------- errors */

/**
 * The backend's error envelope. Only the stable `error` discriminator is read;
 * the human `message` is Russian prose written for the learner product and is
 * never rendered as CRM copy.
 */
export const ReportErrorSchema = z
  .object({
    error: z.string(),
    message: z.string().optional(),
    issues: z
      .array(z.object({ code: z.string(), reference: z.string().optional(), message: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

/** Backend error codes this UI branches on. Anything else is a bounded failure. */
export const REPORT_CONFLICT_CODES = [
  "REPORT_IDEMPOTENCY_CONFLICT",
  "REPORT_WORKFLOW_VERSION_CONFLICT",
  "REPORT_CLAIM_VERSION_CONFLICT",
  "REPORT_REVISION_CONFLICT",
  "REPORT_CLAIM_CONFLICT",
  "REPORT_SUBMISSION_STATE_CONFLICT",
] as const;

/* ------------------------------------------------------------- CRM routes */

/**
 * The exact reviewer paths the CRM origin forwards. Each is a deliberate
 * addition to the rewrite allowlist — never a wildcard. `:submissionRef` matches
 * exactly one segment.
 */
export const REVIEW_QUEUE_ENDPOINT = "/api/curriculum/v2/report-reviews/queue";
export const REVIEW_SUBMISSIONS_ENDPOINT = "/api/curriculum/v2/report-submissions";

/** Header name for the per-decision idempotency key. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/**
 * The backend's accepted key shape: starts alphanumeric, then 7–127 more of
 * `[A-Za-z0-9._:/-]`. Mirrored here so a malformed key is caught locally rather
 * than costing a request that can only 400.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;
