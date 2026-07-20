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

// Safe CRM error envelope. Never carries raw exceptions or resource existence.
export const crmErrorResponseSchema = z
  .object({
    code: z.string(),
    messageKey: z.string(),
    requestId: z.string(),
  })
  .strict();

export type CrmErrorResponse = z.infer<typeof crmErrorResponseSchema>;
