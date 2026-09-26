/**
 * LEARNER-OPERATIONS-V1 — request validation.
 *
 * Every schema is a `strictObject`, so an unexpected key is a 400 rather than
 * something silently dropped. That is what closes mass assignment: a caller
 * cannot smuggle `status`, `assignedStaffId`, `version`, `firstRespondedAt` or
 * `slaPolicyId` into a create or an update, because those keys do not appear in
 * any schema a client is allowed to send.
 *
 * Free text is bounded and screened for markup. The screen is deliberately a
 * REFUSAL rather than a sanitiser: silently rewriting an operator's words would
 * make the stored record differ from what they wrote, and the record is
 * evidence.
 */
import { z } from "zod";
import {
  LEARNER_OPS_BODY_MAX,
  LEARNER_OPS_PAGE_DEFAULT,
  LEARNER_OPS_PAGE_MAX,
  LEARNER_OPS_PRIORITIES,
  LEARNER_OPS_REASON_MAX,
  LEARNER_OPS_STATUSES,
  LEARNER_OPS_SUBJECT_MAX,
  LEARNER_OPS_TYPES,
} from "@/lib/learner-ops/contract";

/**
 * The same screen the report domain applies to reviewer prose. It refuses tags,
 * inline event handlers and the `javascript:` / `data:` schemes, which is what
 * keeps a stored message from becoming stored XSS in any renderer.
 */
const UNSAFE_TEXT = /<\/?[a-z][^>]*>|\bon[a-z]+\s*=|javascript\s*:|data\s*:/i;

function safeText(max: number, label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} must not be empty`)
    .max(max)
    .refine((value) => !UNSAFE_TEXT.test(value), {
      message: `${label} must not contain markup or script`,
    });
}

const STABLE_KEY = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
const CUID = /^[a-z0-9]{20,40}$/;

export const caseIdSchema = z.string().trim().regex(CUID, "invalid identifier");
export const stableKeySchema = z.string().trim().regex(STABLE_KEY).max(64);

export const prioritySchema = z.enum(LEARNER_OPS_PRIORITIES);
export const statusSchema = z.enum(LEARNER_OPS_STATUSES);
export const typeSchema = z.enum(LEARNER_OPS_TYPES);

/** Version fields are always REQUIRED on a mutation — there is no blind write. */
const versionSchema = z.number().int().nonnegative().max(2_147_483_646);

/* --------------------------------------------------------------- creation */

export const staffCreateCaseSchema = z.strictObject({
  userId: z.number().int().positive(),
  type: typeSchema,
  queueKey: stableKeySchema,
  subject: safeText(LEARNER_OPS_SUBJECT_MAX, "subject"),
  details: safeText(LEARNER_OPS_BODY_MAX, "details"),
  priority: prioritySchema.optional(),
  reasonCode: stableKeySchema.optional(),
  reportSubmissionId: z.number().int().positive().optional(),
  userLevelProgressId: z.number().int().positive().optional(),
});

/**
 * The learner's own create. Note what it CANNOT carry: no userId (taken from
 * the session), no type (always `support_request`), no queue, no priority, no
 * reason code, no anchor. A learner may describe a problem and nothing else —
 * classification and routing are operational decisions.
 */
export const learnerCreateCaseSchema = z.strictObject({
  subject: safeText(LEARNER_OPS_SUBJECT_MAX, "subject"),
  details: safeText(LEARNER_OPS_BODY_MAX, "details"),
});

/* -------------------------------------------------------------- mutations */

export const transitionSchema = z.strictObject({
  expectedVersion: versionSchema,
  nextStatus: statusSchema,
  reason: safeText(LEARNER_OPS_REASON_MAX, "reason").optional(),
});

export const assignSchema = z.strictObject({
  expectedAssignmentVersion: versionSchema,
  /** `null` releases. A caller must say so explicitly rather than omitting it. */
  targetStaffId: z.union([caseIdSchema, z.null()]),
  reason: safeText(LEARNER_OPS_REASON_MAX, "reason").optional(),
});

export const claimSchema = z.strictObject({
  expectedAssignmentVersion: versionSchema,
});

export const prioritySchemaBody = z.strictObject({
  expectedVersion: versionSchema,
  nextPriority: prioritySchema,
  reason: safeText(LEARNER_OPS_REASON_MAX, "reason").optional(),
});

export const messageSchema = z.strictObject({
  body: safeText(LEARNER_OPS_BODY_MAX, "message"),
});

export const noteSchema = z.strictObject({
  body: safeText(LEARNER_OPS_BODY_MAX, "note"),
});

/* ------------------------------------------------------------- escalation */

export const escalationSchema = z.strictObject({
  class: z.enum([
    "educational_methodology",
    "technical_product",
    "external_provider",
    "security_abuse",
    "operational_lead",
  ]),
  reason: safeText(LEARNER_OPS_REASON_MAX, "reason"),
  targetQueueKey: stableKeySchema.optional(),
  targetStaffId: caseIdSchema.optional(),
});

export const escalationResolveSchema = z.strictObject({
  resolution: safeText(LEARNER_OPS_REASON_MAX, "resolution"),
  returnToOwner: z.boolean().default(true),
});

/* --------------------------------------------------------------------- QA */

export const qaSchema = z.strictObject({
  result: z.enum(["meets", "needs_improvement", "does_not_meet"]),
  feedback: safeText(LEARNER_OPS_BODY_MAX, "feedback").optional(),
  coachingRequired: z.boolean().default(false),
  /**
   * A free-form dimension map. No rubric is imposed because none has been
   * supplied — but the shape is bounded so it cannot become an arbitrary blob.
   */
  dimensions: z
    .record(stableKeySchema, z.enum(["meets", "needs_improvement", "does_not_meet"]))
    .optional(),
});

/* -------------------------------------------------------------- knowledge */

export const knowledgeCreateSchema = z.strictObject({
  slug: stableKeySchema,
  title: safeText(LEARNER_OPS_SUBJECT_MAX, "title"),
  body: safeText(LEARNER_OPS_BODY_MAX, "body"),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
});

export const knowledgeUpdateSchema = z.strictObject({
  expectedVersion: versionSchema,
  title: safeText(LEARNER_OPS_SUBJECT_MAX, "title").optional(),
  body: safeText(LEARNER_OPS_BODY_MAX, "body").optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

/* -------------------------------------------------------------------- VOC */

export const vocCreateSchema = z.strictObject({
  theme: safeText(LEARNER_OPS_SUBJECT_MAX, "theme"),
  category: stableKeySchema,
  severity: z.enum(["critical", "high", "medium", "low"]),
});

export const vocUpdateSchema = z.strictObject({
  status: z.enum(["open", "under_review", "accepted", "rejected", "resolved"]).optional(),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
  ownerStaffId: z.union([caseIdSchema, z.null()]).optional(),
  resolutionReference: safeText(LEARNER_OPS_SUBJECT_MAX, "reference").optional(),
  resolutionNote: safeText(LEARNER_OPS_BODY_MAX, "note").optional(),
});

export const vocLinkSchema = z.strictObject({
  caseId: caseIdSchema,
});

/* ----------------------------------------------------------------- paging */

/**
 * Keyset paging over an opaque cursor. `limit` is bounded so a caller cannot
 * request an unbounded page, which is both a performance and a disclosure
 * control.
 */
export const listQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(LEARNER_OPS_PAGE_MAX).default(LEARNER_OPS_PAGE_DEFAULT),
  cursor: z.string().trim().min(1).max(256).optional(),
});

export const queueQuerySchema = listQuerySchema.extend({
  queueKey: stableKeySchema.optional(),
  status: statusSchema.optional(),
  type: typeSchema.optional(),
  priority: prioritySchema.optional(),
  /** `me` and `unassigned` are the two named views the inbox needs. */
  assignment: z.enum(["any", "me", "unassigned"]).default("any"),
  breached: z.enum(["any", "only"]).default("any"),
});
