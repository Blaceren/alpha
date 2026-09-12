/**
 * Strict runtime contract for the CRM Learner Owner History (OH-1) API.
 *
 * Written independently of the backend implementation — the CRM validates every
 * response for itself and never trusts a payload because the backend "should"
 * have produced it. `.strict()` at every level turns an accidental `email`,
 * `actorStaffId`, `previousOwnerId`, `nextOwnerId`, `ipAddress`, `userAgent`,
 * `staffRole`, `reason` or AuditLog metadata into a loud failure here instead of
 * a quiet leak into the client.
 *
 * This module deliberately does NOT reuse the mock owner/audit types. The
 * production history contract carries only what the CRM renders: a transition
 * type derived server-side, the resulting version, a timestamp and up to three
 * display-safe staff references (actor, previous owner, next owner).
 */
import { z } from "zod";

/** The closed set of transition kinds. Derived by the backend from the stored
 * previous/next owner ids — never an arbitrary action string. */
export const CRM_OWNER_TRANSITIONS = ["assigned", "reassigned", "unassigned"] as const;
export type CrmApiOwnerTransition = (typeof CRM_OWNER_TRANSITIONS)[number];

/**
 * A staff reference on a history row — exactly two fields. `displayName` must be
 * non-empty after trim (a blank name is a backend data fault, not something to
 * render). There is no StaffRole, email, id-under-another-key or status: a
 * payload carrying one is rejected.
 */
export const crmApiOwnerHistoryActorSchema = z
  .object({
    employeeId: z.string().min(1, "employeeId must be a non-empty opaque string"),
    displayName: z
      .string()
      .refine((v) => v.trim().length > 0, { message: "displayName must be non-empty after trim" }),
  })
  .strict();

export type CrmApiOwnerHistoryActor = z.infer<typeof crmApiOwnerHistoryActorSchema>;

/**
 * One immutable owner transition. `ownerVersion` is the RESULTING current owner
 * version after the transition — a positive integer, unique and monotonic per
 * learner, and the keyset the list walks. `previousOwner`/`nextOwner` are null
 * exactly when the transition is an assign-from-unowned or an unassign.
 */
export const crmApiOwnerHistoryItemSchema = z
  .object({
    historyId: z.string().min(1),
    transition: z.enum(CRM_OWNER_TRANSITIONS),
    ownerVersion: z.number().int().positive(),
    createdAt: z.string().datetime(),
    actor: crmApiOwnerHistoryActorSchema,
    previousOwner: crmApiOwnerHistoryActorSchema.nullable(),
    nextOwner: crmApiOwnerHistoryActorSchema.nullable(),
  })
  .strict();

export type CrmApiOwnerHistoryItem = z.infer<typeof crmApiOwnerHistoryItemSchema>;

export const crmApiOwnerHistoryPageSchema = z
  .object({
    items: z.array(crmApiOwnerHistoryItemSchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();

export type CrmApiOwnerHistoryPage = z.infer<typeof crmApiOwnerHistoryPageSchema>;

/**
 * Safe optional error envelope. The HTTP status stays authoritative; this only
 * lets the UI surface a support reference. `messageKey` is parsed so the
 * envelope validates, but it is NEVER rendered as user-facing copy.
 */
export const crmApiOwnerHistoryErrorSchema = z
  .object({
    code: z.enum(["invalid_input", "unauthorized", "not_found", "internal"]),
    messageKey: z.string(),
    requestId: z.string(),
  })
  .strict();

export type CrmApiOwnerHistoryError = z.infer<typeof crmApiOwnerHistoryErrorSchema>;
