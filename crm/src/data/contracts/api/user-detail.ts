/**
 * Strict runtime contract for the backend `GET /api/crm/v1/users/[userId]`
 * response.
 *
 * The backend validates its own output; this validates independently, because
 * a contract drift, a proxy misconfiguration or a stray field must fail closed
 * here rather than reach a CRM screen.
 *
 * Source contract: alfa-trade-academy-v2/docs/CRM_USER_DETAIL_V1.md
 * That endpoint is a learner detail FOUNDATION, not a complete User 360 — this
 * shape is deliberately small and carries no owner, notes, financial, activity,
 * lifecycle or timeline data, because the backend has none.
 */
import { z } from "zod";

export const crmApiUserDetailSchema = z
  .object({
    // Opaque. Stays a string; never parsed as a number, never used for maths.
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
    // Nonnegative by a proven backend invariant (no code path decrements xp).
    xp: z.number().int().nonnegative(),
    emailConfirmed: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type CrmApiUserDetail = z.infer<typeof crmApiUserDetailSchema>;

/**
 * Safe backend error envelope for this endpoint. Adds `not_found` to the codes
 * the users list can return. The HTTP status stays authoritative; only
 * `requestId` is ever surfaced, and `messageKey` is backend copy that is
 * deliberately never rendered.
 */
export const crmApiUserDetailErrorSchema = z
  .object({
    code: z.enum(["invalid_input", "unauthorized", "not_found", "internal"]),
    messageKey: z.string(),
    requestId: z.string(),
  })
  .strict();

export type CrmApiUserDetailError = z.infer<typeof crmApiUserDetailErrorSchema>;
