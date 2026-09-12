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
import { CRM_SESSION_PERMISSION_CONTRACT } from "@/domain/identity/crm-session-permission-contract";

/**
 * The canonical permissions the backend may send, in the backend's exact
 * canonical order.
 *
 * G4-R7 — THIS IS NO LONGER A SECOND HAND-MAINTAINED COPY. It used to be a
 * literal array beside a comment promising it would "track the backend's
 * `CRM_PERMISSIONS` exactly, not approximately". It did not: the backend
 * appended four `curriculum_*` permissions in PHASE-G0 and PHASE-G2 and this
 * array stayed at eleven, so `PermissionSchema` — a CLOSED enum — rejected
 * every session that carried one, and `crm_admin`, `crm_manager`,
 * `content_manager` and `read_only` could log in but never hold a session.
 *
 * It is now the canonical contract itself, so a CRM-internal divergence is not
 * expressible, and the contract's own parity assertions plus
 * `session-permission-contract.test.ts` cover divergence from the backend.
 *
 * The `satisfies` clause is retained deliberately: it proves the contract is a
 * subset of the `Permission` union, which combined with the union's own
 * `AssertEqual` parity check makes the two exactly equal.
 */
export const SESSION_PERMISSIONS =
  CRM_SESSION_PERMISSION_CONTRACT satisfies readonly Permission[];

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
