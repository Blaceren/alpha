/**
 * LEARNER-OPERATIONS-V1 — the response contracts.
 *
 * Every backend response is parsed by a schema before it reaches a component.
 * A response that does not validate renders NOTHING and reports
 * `malformed_response` — there is no partial render and no fallback shape,
 * because a half-parsed operational queue is worse than an error: it looks like
 * the real backlog with rows silently missing.
 *
 * The enums are CLOSED and mirror the backend's vocabulary exactly. A status or
 * type the client cannot name is a bug in one repository or the other, and it
 * should surface as a loud parse failure rather than as an unlabelled row.
 */
import { z } from "zod";

export const learnerOpsStatusSchema = z.enum([
  "new",
  "open",
  "in_progress",
  "waiting_learner",
  "waiting_internal",
  "waiting_external",
  "escalated",
  "resolved",
  "closed",
]);
export type LearnerOpsStatus = z.infer<typeof learnerOpsStatusSchema>;

export const learnerOpsTypeSchema = z.enum([
  "support_request",
  "report_review",
  "mentor_review",
  "educational_escalation",
  "complaint",
  "service_recovery",
  "operational_followup",
]);
export type LearnerOpsType = z.infer<typeof learnerOpsTypeSchema>;

export const learnerOpsPrioritySchema = z.enum(["urgent", "high", "normal", "low"]);
export type LearnerOpsPriority = z.infer<typeof learnerOpsPrioritySchema>;

const slaClockSchema = z.object({
  state: z.enum(["none", "running", "paused", "met", "breached", "stopped"]),
  dueAt: z.string().nullable(),
  remainingMs: z.number().nullable(),
  overdueMs: z.number().nullable(),
});

export const slaViewSchema = z.object({
  policyKey: z.string().nullable(),
  /**
   * Provenance travels with every SLA number the CRM renders. The workspace
   * prints "PREPROD fixture" next to any target stamped
   * `preprod_acceptance_fixture`, so an acceptance number is never mistaken for
   * a business commitment.
   */
  origin: z.enum(["preprod_acceptance_fixture", "product_owner_supplied"]).nullable(),
  firstResponse: slaClockSchema,
  resolution: slaClockSchema,
  breached: z.boolean(),
});
export type SlaView = z.infer<typeof slaViewSchema>;

export const queueItemSchema = z.object({
  id: z.string(),
  reference: z.string(),
  type: learnerOpsTypeSchema,
  status: learnerOpsStatusSchema,
  priority: learnerOpsPrioritySchema,
  subject: z.string(),
  queueKey: z.string(),
  queueName: z.string(),
  learner: z.object({ id: z.number(), name: z.string() }),
  assignedTo: z.object({ staffId: z.string(), displayName: z.string() }).nullable(),
  assignmentVersion: z.number(),
  version: z.number(),
  openedAt: z.string(),
  lastActivityAt: z.string(),
  reopenCount: z.number(),
  sla: slaViewSchema,
});
export type QueueItem = z.infer<typeof queueItemSchema>;

export const queuePageSchema = z.object({
  items: z.array(queueItemSchema),
  nextCursor: z.string().nullable(),
});
export type QueuePage = z.infer<typeof queuePageSchema>;

/**
 * The anchored educational object. `source` names the CANONICAL OWNER that
 * answered, and the workspace renders it — an operator can always see which
 * system said a thing rather than assuming the case knows.
 */
export const anchorSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("report_submission"),
      source: z.literal("curriculum.report"),
      submissionId: z.number(),
      status: z.string(),
      levelNumber: z.number().nullable(),
      submittedAt: z.string().nullable(),
      claimedByStaffDisplayName: z.string().nullable(),
    }),
    z.object({
      kind: z.literal("user_level_progress"),
      source: z.literal("curriculum.progression"),
      progressId: z.number(),
      status: z.string(),
      levelNumber: z.number().nullable(),
    }),
  ])
  .nullable();

export const caseDetailSchema = queueItemSchema.extend({
  /**
   * Server-projected from the canonical transition table. The CRM renders these
   * and nothing else, so the choices an operator is offered and the transitions
   * the domain accepts are the same list read once, not two tables that drift.
   */
  allowedTransitions: z.array(learnerOpsStatusSchema),
  details: z.string(),
  reasonCode: z
    .object({ code: z.string(), category: z.string(), label: z.string() })
    .nullable(),
  resolvedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  reopenedAt: z.string().nullable(),
  firstRespondedAt: z.string().nullable(),
  anchor: anchorSchema,
});
export type CaseDetail = z.infer<typeof caseDetailSchema>;

export const messagesPageSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      authorKind: z.enum(["staff", "learner"]),
      authorName: z.string(),
      body: z.string(),
      createdAt: z.string(),
      readByLearnerAt: z.string().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type MessagesPage = z.infer<typeof messagesPageSchema>;

export const notesPageSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      authorName: z.string(),
      body: z.string(),
      createdAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type NotesPage = z.infer<typeof notesPageSchema>;

export const eventsPageSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      caseVersion: z.number(),
      eventType: z.string(),
      actorName: z.string().nullable(),
      previousStatus: learnerOpsStatusSchema.nullable(),
      nextStatus: learnerOpsStatusSchema.nullable(),
      previousPriority: learnerOpsPrioritySchema.nullable(),
      nextPriority: learnerOpsPrioritySchema.nullable(),
      previousAssignee: z.string().nullable(),
      nextAssignee: z.string().nullable(),
      reason: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type EventsPage = z.infer<typeof eventsPageSchema>;

export const escalationsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      class: z.enum([
        "educational_methodology",
        "technical_product",
        "external_provider",
        "security_abuse",
        "operational_lead",
      ]),
      reason: z.string(),
      raisedAt: z.string(),
      raisedBy: z.string(),
      targetQueue: z.object({ key: z.string(), name: z.string() }).nullable(),
      targetStaff: z.string().nullable(),
      resolvedAt: z.string().nullable(),
      resolvedBy: z.string().nullable(),
      resolution: z.string().nullable(),
      returnedToOwnerAt: z.string().nullable(),
    }),
  ),
});
export type Escalations = z.infer<typeof escalationsSchema>;

export const configSchema = z.object({
  queues: z.array(
    z.object({ key: z.string(), name: z.string(), description: z.string().nullable() }),
  ),
  reasonCodes: z.array(
    z.object({ code: z.string(), category: z.string(), label: z.string() }),
  ),
  slaPolicies: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      priority: learnerOpsPrioritySchema,
      firstResponseTargetMinutes: z.number().nullable(),
      resolutionTargetMinutes: z.number().nullable(),
      pausesOnWaitingLearner: z.boolean(),
      pausesOnWaitingInternal: z.boolean(),
      pausesOnWaitingExternal: z.boolean(),
      origin: z.enum(["preprod_acceptance_fixture", "product_owner_supplied"]),
    }),
  ),
  assignableStaff: z.array(
    z.object({ staffId: z.string(), displayName: z.string(), role: z.string() }),
  ),
});
export type LearnerOpsConfig = z.infer<typeof configSchema>;

/** Every value carries the canonical owner that answered for it. */
const sourced = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value, source: z.string() });

export const learner360Schema = z.object({
  identity: z.object({
    id: z.number(),
    name: z.string(),
    email: sourced(z.string()),
    emailMasked: z.boolean(),
    status: sourced(z.string()),
    role: z.string(),
    registeredAt: z.string(),
    emailVerifiedAt: z.string().nullable(),
  }),
  enrollment: sourced(
    z.object({
      id: z.number(),
      status: z.string(),
      curriculumCode: z.string(),
      curriculumStatus: z.string(),
      curriculumVersionNumber: z.number(),
    }),
  ).nullable(),
  progression: sourced(
    z.object({
      completedLevels: z.number(),
      /** The curriculum's level count — NOT the number of progress rows. */
      totalLevels: z.number(),
      /** How many levels this learner has actually started. */
      startedLevels: z.number(),
      currentLevel: z
        .object({ levelNumber: z.number(), title: z.string(), type: z.string() })
        .nullable(),
      pendingReview: z.array(
        z.object({
          progressId: z.number(),
          levelNumber: z.number(),
          title: z.string(),
          type: z.string(),
        }),
      ),
    }),
  ),
  reports: sourced(
    z.array(
      z.object({
        submissionId: z.number(),
        status: z.string(),
        levelNumber: z.number().nullable(),
        submittedAt: z.string().nullable(),
      }),
    ),
  ),
  operations: sourced(
    z.array(
      z.object({
        id: z.string(),
        reference: z.string(),
        type: learnerOpsTypeSchema,
        status: learnerOpsStatusSchema,
        priority: learnerOpsPrioritySchema,
        subject: z.string(),
        assignedTo: z.string().nullable(),
        openedAt: z.string(),
        resolvedAt: z.string().nullable(),
        reopenCount: z.number(),
        active: z.boolean(),
      }),
    ),
  ),
  notifications: sourced(
    z.array(
      z.object({
        id: z.number(),
        type: z.string(),
        createdAt: z.string(),
        read: z.boolean(),
      }),
    ),
  ),
  external: z.object({
    pocketIdentity: sourced(
      z.object({
        state: z.enum(["linked", "pending"]),
        playerId: z.string().nullable(),
        linkedAt: z.string().nullable(),
        source: z.string().nullable(),
      }),
    ),
    /**
     * ABSENT when the caller lacks `view_exact_financials`. Absent, not empty —
     * the backend omits the section entirely rather than sending zeros the
     * client hides, so a permission cannot be defeated by reading the payload.
     *
     * Note what it never contains: a balance, a P&L, a deposit AMOUNT. It
     * carries the BOOLEAN first-deposit fact and the evidence that answered it.
     */
    financial: sourced(
      z.object({
        firstDepositConfirmed: z.boolean(),
        firstDepositAt: z.string().nullable(),
        firstDepositEvidence: z.enum(["canonical_conversion", "legacy_account_record", "none"]),
        checkpoints: z.array(
          z.object({
            levelNumber: z.number().nullable(),
            outcome: z.string(),
            at: z.string(),
          }),
        ),
      }),
    ).nullable(),
    financialVisible: z.boolean(),
  }),
});
export type Learner360 = z.infer<typeof learner360Schema>;

export const analyticsSchema = z.object({
  generatedAt: z.string(),
  truncated: z.boolean(),
  backlog: z.object({
    total: z.number(),
    open: z.number(),
    unassigned: z.number(),
    awaitingFirstResponse: z.number(),
    averageAgeMs: z.number(),
    oldestAgeMs: z.number(),
  }),
  sla: z.object({
    firstResponseBreached: z.number(),
    resolutionBreached: z.number(),
    medianResolutionMs: z.number().nullable(),
    resolvedSampleSize: z.number(),
  }),
  byStatus: z.array(z.object({ status: learnerOpsStatusSchema, count: z.number() })),
  byType: z.array(z.object({ type: learnerOpsTypeSchema, count: z.number() })),
  byPriority: z.array(z.object({ priority: learnerOpsPrioritySchema, count: z.number() })),
  byQueue: z.array(
    z.object({ queueKey: z.string(), queueName: z.string(), count: z.number() }),
  ),
  byOwner: z.array(
    z.object({
      staffId: z.string().nullable(),
      displayName: z.string().nullable(),
      count: z.number(),
    }),
  ),
  taxonomy: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      category: z.string(),
      count: z.number(),
    }),
  ),
  escalations: z.array(z.object({ class: z.string(), count: z.number() })),
  qa: z.object({
    byResult: z.array(z.object({ result: z.string(), count: z.number() })),
    reviewedCases: z.number(),
    completedCases: z.number(),
  }),
  voc: z.array(z.object({ status: z.string(), count: z.number() })),
  /**
   * The backend labels these OBSERVATIONAL and the workspace renders that
   * label. They describe what happened; nothing here claims to predict
   * retention or to establish that operations caused an outcome.
   */
  observational: z.object({
    classification: z.literal("observational"),
    note: z.string(),
    reopenedCases: z.number(),
    reopenRate: z.number(),
    complaints: z.number(),
    serviceRecovery: z.number(),
  }),
});
export type LearnerOpsAnalytics = z.infer<typeof analyticsSchema>;

export const knowledgePageSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      title: z.string(),
      status: z.enum(["draft", "published", "archived"]),
      version: z.number(),
      owner: z.string(),
      updatedAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type KnowledgePage = z.infer<typeof knowledgePageSchema>;

export const knowledgeArticleSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  body: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  version: z.number(),
  owner: z.string(),
  updatedAt: z.string(),
});
export type KnowledgeArticle = z.infer<typeof knowledgeArticleSchema>;

export const vocPageSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      theme: z.string(),
      category: z.string(),
      severity: z.enum(["critical", "high", "medium", "low"]),
      status: z.enum(["open", "under_review", "accepted", "rejected", "resolved"]),
      evidenceCount: z.number(),
      owner: z.string().nullable(),
      createdBy: z.string(),
      resolutionReference: z.string().nullable(),
      resolutionNote: z.string().nullable(),
      updatedAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type VocPage = z.infer<typeof vocPageSchema>;

export const qaPageSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      caseId: z.string(),
      caseReference: z.string(),
      caseType: learnerOpsTypeSchema,
      result: z.enum(["meets", "needs_improvement", "does_not_meet"]),
      feedback: z.string().nullable(),
      coachingRequired: z.boolean(),
      dimensions: z.unknown(),
      reviewer: z.string(),
      createdAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type QaPage = z.infer<typeof qaPageSchema>;

/** The backend's closed error envelope. */
export const learnerOpsErrorSchema = z.object({
  code: z.string(),
  detail: z.string().nullable().optional(),
  messageKey: z.string().optional(),
  requestId: z.string().optional(),
});

export const envelopeSchema = <T extends z.ZodTypeAny>(data: T) => z.object({ data });
