/**
 * Strict runtime contract for `GET /api/crm/v1/session`.
 *
 * This is a trust boundary, so the schema is closed in every direction it can
 * be: unknown roles, unknown permissions, duplicate permissions and unknown
 * extra fields are all rejected rather than ignored. `.strict()` matters more
 * than it looks — it is what makes an accidental `email` or `xp` field on the
 * backend a loud failure here instead of a quiet leak into the client.
 *
 * `employeeId` is treated as an opaque string. It is deliberately NOT validated
 * as a cuid/UUID/hex: constraining the format would couple the CRM to the
 * backend's current ID implementation.
 */
import { z } from "zod";
import { CRM_ROLES, type CrmRole, type Permission } from "@/domain/identity/roles";

/**
 * The ten canonical permissions, as sent by the backend, in the backend's exact
 * canonical order. The first eight are the accepted session contract and keep
 * their exact relative order; CRM User Notes v1 appended the last two.
 */
export const SESSION_PERMISSIONS = [
  "view_exact_financials",
  "view_identity_full_email",
  "reveal_pii",
  "assign_owner",
  "export",
  "view_audit",
  "manage_settings",
  "edit_user_notes",
  "view_user_notes",
  "create_user_notes",
] as const satisfies readonly Permission[];

const RoleSchema = z.enum(CRM_ROLES as unknown as [CrmRole, ...CrmRole[]]);
const PermissionSchema = z.enum(SESSION_PERMISSIONS);

const EffectivePermissionsSchema = z
  .array(PermissionSchema)
  .refine((list) => new Set(list).size === list.length, {
    message: "effectivePermissions must not contain duplicates",
  });

export const SessionDtoSchema = z
  .object({
    employeeId: z.string().min(1, "employeeId must be a non-empty opaque string"),
    displayName: z
      .string()
      .refine((v) => v.trim().length > 0, { message: "displayName must be non-empty after trim" }),
    role: RoleSchema,
    effectivePermissions: EffectivePermissionsSchema,
    permissionVersion: z.number().int().positive("permissionVersion must be a positive integer"),
    expiresAt: z.string().datetime({ offset: true, message: "expiresAt must be an ISO datetime" }),
  })
  .strict();

export type SessionDto = z.infer<typeof SessionDtoSchema>;

/**
 * Safe optional envelope for 401/403 bodies. The HTTP status stays
 * authoritative — this only lets the UI surface a support reference. The
 * backend's `messageKey` is intentionally never rendered as user-facing copy.
 */
export const SessionErrorEnvelopeSchema = z
  .object({
    code: z.literal("unauthorized"),
    messageKey: z.string(),
    requestId: z.string(),
  })
  .strict();

export type SessionErrorEnvelope = z.infer<typeof SessionErrorEnvelopeSchema>;
