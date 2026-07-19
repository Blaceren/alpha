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

// Safe CRM error envelope. Never carries raw exceptions or resource existence.
export const crmErrorResponseSchema = z
  .object({
    code: z.string(),
    messageKey: z.string(),
    requestId: z.string(),
  })
  .strict();

export type CrmErrorResponse = z.infer<typeof crmErrorResponseSchema>;
