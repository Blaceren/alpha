import { NextResponse } from "next/server";
import { CrmAuthError, crmRequestId, resolveCrmSession } from "@/lib/crm/session";
import { crmUsersResponseSchema } from "@/lib/crm/schemas";
import { CrmUsersInputError, listCrmUsers, parseCrmUsersQuery } from "@/lib/crm/users";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/crm/v1/users
//
// Cursor-paginated CRM users list. Authorization reuses the accepted CRM session
// resolver — there is no second cookie or token path here — and field
// projection uses that session's server-computed effectivePermissions, never
// UserRole and never anything the request supplied.
//
// Contract: docs/CRM_USERS_V1.md
export async function GET(request: Request) {
  const requestId = crmRequestId();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };

  try {
    // 401/403 resolved here, before any query parsing or data access.
    const session = await resolveCrmSession();

    const query = parseCrmUsersQuery(new URL(request.url).searchParams, session.effectivePermissions);
    // `session.employeeId` is the authenticated StaffProfile.id — the only
    // identity used for owner=mine. It is never read from the request.
    const page = await listCrmUsers(query, session.effectivePermissions, session.employeeId);

    // Validate the exact shape before it leaves the process.
    return NextResponse.json(crmUsersResponseSchema.parse(page), { headers });
  } catch (error) {
    if (error instanceof CrmAuthError) {
      return NextResponse.json(
        { code: error.code, messageKey: error.messageKey, requestId },
        { status: error.status, headers },
      );
    }

    if (error instanceof CrmUsersInputError) {
      return NextResponse.json(
        { code: error.code, messageKey: error.messageKey, requestId },
        { status: 400, headers },
      );
    }

    // Prisma errors, Zod issues and anything else collapse to a safe envelope.
    // No SQL, stack, cursor decoder detail or database path ever escapes.
    return NextResponse.json(
      { code: "internal", messageKey: "crm.users.internal", requestId },
      { status: 500, headers },
    );
  }
}
