import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { isCrmStaffRole, resolveEffectivePermissions } from "@/lib/crm/roles";
import { crmSessionResponseSchema, type CrmSessionResponse } from "@/lib/crm/schemas";

export type CrmAuthStatus = 401 | 403;

// Typed CRM auth failure. Both 401 and 403 surface the same client-facing code
// ("unauthorized") but carry distinct messageKeys, and never leak whether some
// other user's StaffProfile exists.
export class CrmAuthError extends Error {
  readonly code = "unauthorized" as const;

  constructor(
    readonly status: CrmAuthStatus,
    readonly messageKey: string,
  ) {
    super(messageKey);
    this.name = "CrmAuthError";
  }
}

// Local safe request id for CRM API responses. The project has no canonical
// request-id helper, so this is a self-contained opaque identifier.
export function crmRequestId(): string {
  return crypto.randomUUID();
}

// Resolve the CRM session from the existing signed auth cookie. The backend is
// the sole source of authorization: this reads the canonical User, verifies it
// via existing session semantics, then computes the CRM identity from the
// separate StaffProfile axis. It never trusts client-supplied identity, role,
// permissions or permissionVersion.
export async function resolveCrmSession(): Promise<CrmSessionResponse> {
  const session = await getSession();

  // 401 — session absent, signature invalid, or expired (existing semantics).
  if (!session) {
    throw new CrmAuthError(401, "crm.session.unauthenticated");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      status: true,
      staffProfile: {
        select: {
          id: true,
          displayName: true,
          staffRole: true,
          permissionVersion: true,
        },
      },
    },
  });

  // 401 — account missing, blocked or revoked (existing auth semantics).
  if (!user || user.status === "blocked") {
    throw new CrmAuthError(401, "crm.session.unauthenticated");
  }

  // 403 — authenticated, but the account is not usable as a CRM employee.
  // Fail closed if the stored staffRole is somehow not a known StaffRole.
  const profile = user.staffProfile;
  if (!profile || !isCrmStaffRole(profile.staffRole)) {
    throw new CrmAuthError(403, "crm.session.not_staff");
  }

  const dto = {
    employeeId: profile.id,
    displayName: profile.displayName,
    role: profile.staffRole,
    effectivePermissions: resolveEffectivePermissions(profile.staffRole),
    permissionVersion: profile.permissionVersion,
    expiresAt: session.expiresAt.toISOString(),
  };

  // Validate the exact shape before returning (no extra keys, canonical order).
  return crmSessionResponseSchema.parse(dto);
}
