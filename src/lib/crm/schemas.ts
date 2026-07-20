import { z } from "zod";
import { CRM_PERMISSIONS, CRM_STAFF_ROLES } from "./roles";

// Runtime contract for the CRM session DTO. Kept strict so the response can
// never carry an unexpected key (no learner payload leakage).
export const staffRoleSchema = z.enum(CRM_STAFF_ROLES);
export const crmPermissionSchema = z.enum(CRM_PERMISSIONS);

export const crmSessionResponseSchema = z
  .object({
    employeeId: z.string().min(1),
    displayName: z.string().min(1),
    role: staffRoleSchema,
    effectivePermissions: z.array(crmPermissionSchema),
    permissionVersion: z.number().int().positive(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type CrmSessionResponse = z.infer<typeof crmSessionResponseSchema>;

// Runtime contract for the CRM users list (v1). Strict at every level so an
// extra key — a stray financial field, an owner id, a raw Prisma column —
// fails serialization here instead of reaching the client.
export const crmUserListItemSchema = z
  .object({
    // User.id serialized as an opaque decimal string. Clients must not parse it.
    userId: z.string().min(1),
    displayName: z.string().min(1),
    email: z
      .object({
        value: z.string().min(1),
        visibility: z.enum(["full", "masked"]),
      })
      .strict(),
    status: z.enum(["active", "blocked"]),
    level: z.number().int(),
    emailConfirmed: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const crmUsersResponseSchema = z
  .object({
    items: z.array(crmUserListItemSchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();

export type CrmUsersResponse = z.infer<typeof crmUsersResponseSchema>;

// Runtime contract for the CRM user detail foundation (v1). Strict so an extra
// key — an owner id, a financial value, a raw Prisma column — fails here rather
// than reaching the client.
//
// `xp` is nonnegative by a proven backend invariant: User.xp starts at 0, no
// code path decrements it, task rewards are `Int @default(0)` validated
// `min(0)`, promocode awards hard-fail below 1, referral bonuses are positive
// defaults with no write path, and the admin update validates `min(0)`.
// `level` keeps the same plain-integer shape as the accepted Users v1 contract
// so the two endpoints stay adapter-compatible.
export const crmUserDetailResponseSchema = z
  .object({
    userId: z.string().min(1),
    displayName: z.string().min(1),
    email: z
      .object({
        value: z.string().min(1),
        visibility: z.enum(["full", "masked"]),
      })
      .strict(),
    status: z.enum(["active", "blocked"]),
    level: z.number().int(),
    xp: z.number().int().nonnegative(),
    emailConfirmed: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type CrmUserDetailResponse = z.infer<typeof crmUserDetailResponseSchema>;

// Safe CRM error envelope. Never carries raw exceptions or resource existence.
export const crmErrorResponseSchema = z
  .object({
    code: z.string(),
    messageKey: z.string(),
    requestId: z.string(),
  })
  .strict();

export type CrmErrorResponse = z.infer<typeof crmErrorResponseSchema>;
