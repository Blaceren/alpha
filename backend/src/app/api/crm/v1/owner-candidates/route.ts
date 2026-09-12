import { NextResponse } from "next/server";
import { CrmAuthError, crmRequestId, resolveCrmSession } from "@/lib/crm/session";
import { crmOwnerCandidatesResponseSchema } from "@/lib/crm/schemas";
import {
  assertCanAssignOwner,
  CrmOwnerForbiddenError,
  CrmOwnerInputError,
  listCrmOwnerCandidates,
  parseCrmOwnerCandidatesQuery,
} from "@/lib/crm/user-owner";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// This route exports exactly GET. Owner v1 candidate listing is read-only: there
// is no POST, PUT, PATCH or DELETE, and no per-employee or search route. An
// unsupported method gets Next's own 405 without ever reaching this module.

// GET /api/crm/v1/owner-candidates
//
// Lists eligible owner candidates (StaffProfile-backed, active User, eligible
// StaffRole, nonblank displayName), sorted displayName ASC / employeeId ASC and
// keyset-paginated. Requires `assign_owner`: you enumerate candidates only in
// order to assign one. The DTO carries exactly employeeId + displayName — never
// StaffRole, email or any other field.
//
// Contract: docs/CRM_USER_OWNER_V1.md
export async function GET(request: Request) {
  const requestId = crmRequestId();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };

  try {
    // Order is deliberate: session (401), StaffProfile (403), operation
    // permission (403), then query parsing.
    const session = await resolveCrmSession();
    assertCanAssignOwner(session.effectivePermissions);

    const query = parseCrmOwnerCandidatesQuery(new URL(request.url).searchParams);
    const page = await listCrmOwnerCandidates(query);

    // Validate the exact shape before it leaves the process.
    return NextResponse.json(crmOwnerCandidatesResponseSchema.parse(page), { headers });
  } catch (error) {
    if (error instanceof CrmAuthError) {
      return NextResponse.json(
        { code: error.code, messageKey: error.messageKey, requestId },
        { status: error.status, headers },
      );
    }

    if (error instanceof CrmOwnerForbiddenError) {
      return NextResponse.json(
        { code: error.code, messageKey: error.messageKey, requestId },
        { status: 403, headers },
      );
    }

    if (error instanceof CrmOwnerInputError) {
      return NextResponse.json(
        { code: error.code, messageKey: error.messageKey, requestId },
        { status: 400, headers },
      );
    }

    // Prisma errors, Zod issues and anything else collapse to a safe envelope.
    // No SQL, stack, database path, StaffRole or permission ever escapes.
    return NextResponse.json(
      { code: "internal", messageKey: "crm.owner_candidates.internal", requestId },
      { status: 500, headers },
    );
  }
}
