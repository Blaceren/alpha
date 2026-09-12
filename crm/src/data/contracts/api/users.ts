/**
 * Strict runtime contract for the backend `GET /api/crm/v1/users` response.
 *
 * The backend validates its own output, but this is a trust boundary and the
 * frontend validates independently: a contract drift, a proxy misconfiguration
 * or a stray field must fail closed here rather than reach a CRM screen.
 *
 * Source contract: alfa-trade-academy-v2/docs/CRM_USERS_V1.md
 * This file deliberately contains no backend implementation — only the shape.
 */
import { z } from "zod";

/**
 * `userId` is opaque. It is a string on the wire and stays a string here: it is
 * never parsed as a JavaScript number, never used for arithmetic and never
 * assumed to remain numeric. It is only a React key and a stable row identity.
 */
/**
 * The list-row owner projection. Strict and displayName-only, mirroring the
 * backend contract exactly (docs/CRM_USERS_V1.md → Owner projection): the list
 * carries the live `StaffProfile.displayName` and NOTHING else. An owner
 * `employeeId`, internal `ownerId`, `ownerVersion`, `StaffRole`/`role`, email,
 * `status`, permission or timestamp riding along is contract drift and must fail
 * closed here rather than reach a CRM row.
 *
 * This is deliberately NOT the richer User-detail Owner contract
 * (`crmOwnerIdentitySchema`, which carries `employeeId`): a list row only names
 * the owner, it never lets you act on them, so it never learns their id.
 */
export const crmApiUserOwnerSchema = z
  .object({
    // Non-blank after trim, matching the row `displayName` policy and the
    // backend's `min(1)` live-name guarantee (a blank name fails closed on the
    // backend before it can reach the wire).
    displayName: z.string().refine((v) => v.trim().length > 0, {
      message: "owner displayName must be non-empty after trim",
    }),
  })
  .strict();

export type CrmApiUserOwner = z.infer<typeof crmApiUserOwnerSchema>;

export const crmApiUserSchema = z
  .object({
    userId: z.string().min(1),
    displayName: z.string().refine((v) => v.trim().length > 0, {
      message: "displayName must be non-empty after trim",
    }),
    email: z
      .object({
        value: z.string().min(1),
        visibility: z.enum(["full", "masked"]),
      })
      .strict(),
    status: z.enum(["active", "blocked"]),
    level: z.number().int(),
    emailConfirmed: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
    // Current learner owner — displayName only, or null. `null` covers BOTH the
    // pristine (no owner row) and persisted-unassigned states; the list does not
    // distinguish them. Required key: the backend always sends it, so its
    // absence is drift and fails closed.
    owner: crmApiUserOwnerSchema.nullable(),
  })
  .strict();

export type CrmApiUser = z.infer<typeof crmApiUserSchema>;

export const crmApiUsersResponseSchema = z
  .object({
    items: z.array(crmApiUserSchema).refine(
      (items) => new Set(items.map((i) => i.userId)).size === items.length,
      // A duplicate userId would break React keys and, more importantly, would
      // mean pagination is not stable — fail closed rather than render it.
      { message: "items must not contain duplicate userId values" },
    ),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();

export type CrmApiUsersResponse = z.infer<typeof crmApiUsersResponseSchema>;

/**
 * Safe backend error envelope. The HTTP status stays authoritative; only
 * `requestId` is ever surfaced to a person. `messageKey` is backend copy, not
 * CRM copy, and is deliberately never rendered.
 */
export const crmApiErrorSchema = z
  .object({
    code: z.enum(["invalid_input", "unauthorized", "internal"]),
    messageKey: z.string(),
    requestId: z.string(),
  })
  .strict();

export type CrmApiError = z.infer<typeof crmApiErrorSchema>;
