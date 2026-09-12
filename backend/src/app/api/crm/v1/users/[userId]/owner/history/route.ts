import { NextResponse } from "next/server";
import { CrmAuthError, crmRequestId, resolveCrmSession } from "@/lib/crm/session";
import { crmOwnerHistoryResponseSchema } from "@/lib/crm/schemas";
import { CrmUserDetailInputError, parseCrmUserId } from "@/lib/crm/user-detail";
import {
  assertCanViewOwnerHistory,
  CrmOwnerHistoryForbiddenError,
  CrmOwnerHistoryInputError,
  CrmOwnerHistoryNotFoundError,
  listCrmUserOwnerHistory,
  parseCrmOwnerHistoryQuery,
} from "@/lib/crm/user-owner-history";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Next 15 async route params — no synchronous compatibility path.
type RouteContext = {
  params: Promise<{ userId: string }>;
};

// This route exports exactly GET. Owner history is immutable and append-only:
// there is no POST, PUT, PATCH or DELETE, no /history/[id], and no manual
// creation, backfill or bulk-import route. Rows are written only by the owner
// mutation, inside its own transaction. An unsupported method gets Next's own
// 405 without reaching this module.

/**
 * Shared error mapping. Every failure collapses to the safe
 * `{code, messageKey, requestId}` envelope — no Zod issue, Prisma error, SQL,
 * stack, filesystem path, StaffRole, permission or hidden-employee existence
 * ever escapes.
 */
function errorResponse(error: unknown, requestId: string, headers: Record<string, string>) {
  if (error instanceof CrmAuthError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: error.status, headers },
    );
  }

  if (error instanceof CrmOwnerHistoryForbiddenError) {
    // 403 — authenticated CRM employee, but without `view_audit`. The envelope
    // never names the role or the permission.
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 403, headers },
    );
  }

  if (error instanceof CrmOwnerHistoryInputError || error instanceof CrmUserDetailInputError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 400, headers },
    );
  }

  if (error instanceof CrmOwnerHistoryNotFoundError) {
    // One envelope for every miss: nonexistent id, staff account, admin, any
    // non-learner. The response must not tell a caller which.
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 404, headers },
    );
  }

  // CrmOwnerHistoryInternalError (an unusable stored label or transition) and
  // anything else — Prisma errors, Zod issues — collapse to one safe envelope.
  return NextResponse.json(
    { code: "internal", messageKey: "crm.users.owner_history.internal", requestId },
    { status: 500, headers },
  );
}

// GET /api/crm/v1/users/[userId]/owner/history
//
// Lists a learner's immutable owner transitions, newest first, keyset-paginated
// by ownerVersion. Requires `view_audit` — there is NO fallback to
// `assign_owner`, so a role that may reassign the owner still cannot read the
// log. Default limit 20, maximum 50, no offset and no total count.
//
// Contract: docs/CRM_USER_OWNER_HISTORY_OH1.md
export async function GET(request: Request, context: RouteContext) {
  const requestId = crmRequestId();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };

  try {
    // Order is deliberate: session (401), StaffProfile (403), operation
    // permission (403), then input and target. A caller without `view_audit`
    // never learns whether the target learner exists.
    const session = await resolveCrmSession();
    assertCanViewOwnerHistory(session.effectivePermissions);

    const query = parseCrmOwnerHistoryQuery(new URL(request.url).searchParams);
    const { userId } = await context.params;
    const page = await listCrmUserOwnerHistory(parseCrmUserId(userId), query);

    // Validate the exact shape before it leaves the process.
    return NextResponse.json(crmOwnerHistoryResponseSchema.parse(page), { headers });
  } catch (error) {
    return errorResponse(error, requestId, headers);
  }
}
