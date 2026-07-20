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
