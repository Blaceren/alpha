import { NextResponse } from "next/server";
import { CrmAuthError, crmRequestId, resolveCrmSession } from "@/lib/crm/session";
import { crmOwnerResponseSchema } from "@/lib/crm/schemas";
import { CrmUserDetailInputError, parseCrmUserId } from "@/lib/crm/user-detail";
import {
  assertCanAssignOwner,
  assertNoOwnerQueryParams,
  assignCrmUserOwner,
  CrmOwnerConflictError,
  CrmOwnerForbiddenError,
  CrmOwnerInputError,
  CrmOwnerNotFoundError,
  parseCrmOwnerMutationBody,
  resolveCrmUserOwner,
} from "@/lib/crm/user-owner";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Next 15 async route params — no synchronous compatibility path.
type RouteContext = {
  params: Promise<{ userId: string }>;
};

// This route exports exactly GET and PUT. The current owner is a mutable
// singleton whose complete desired state is expressed by one PUT body, so there
// is no POST, PATCH, DELETE or /owner/[employeeId] here. The immutable owner
// HISTORY is a separate read-only sibling route (./history), never a method on
// this one. An unsupported method gets Next's own 405 without reaching here.

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

  if (error instanceof CrmOwnerForbiddenError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 403, headers },
    );
  }

  if (error instanceof CrmOwnerInputError || error instanceof CrmUserDetailInputError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 400, headers },
    );
  }

  if (error instanceof CrmOwnerNotFoundError) {
    // One envelope for every miss: nonexistent/staff/system learner, and
    // missing/ineligible/blocked candidate. The response must not tell which.
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 404, headers },
    );
  }

  if (error instanceof CrmOwnerConflictError) {
    // Stale expectedVersion, lost conditional update, or concurrent first-create.
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: 409, headers },
    );
  }

  // CrmOwnerInternalError (unusable stored owner name) and anything else —
  // Prisma errors, Zod issues — collapse to one safe internal envelope.
  return NextResponse.json(
    { code: "internal", messageKey: "crm.users.owner.internal", requestId },
    { status: 500, headers },
  );
}

// GET /api/crm/v1/users/[userId]/owner
//
// Returns the learner's current owner (or null) plus the opaque ownerVersion.
// Requires only a valid StaffProfile — NO Owner-specific permission — because
// the current owner is visible to every authenticated employee. Absence of a
// stored row is the pristine state: owner null, ownerVersion 0.
//
// Contract: docs/CRM_USER_OWNER_V1.md
export async function GET(request: Request, context: RouteContext) {
  const requestId = crmRequestId();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };

  try {
    // 401/403 (session, StaffProfile) resolved before the path parameter.
    await resolveCrmSession();

    assertNoOwnerQueryParams(new URL(request.url).searchParams);
    const { userId } = await context.params;
    const state = await resolveCrmUserOwner(parseCrmUserId(userId));

    return NextResponse.json(crmOwnerResponseSchema.parse(state), { headers });
  } catch (error) {
    return errorResponse(error, requestId, headers);
  }
}

// PUT /api/crm/v1/users/[userId]/owner
//
// Assigns, replaces or unassigns the learner's owner under optimistic
// concurrency. Requires `assign_owner`. Body is exactly
// `{ ownerEmployeeId: string | null, expectedVersion: number }`; the actor comes
// only from the session and is not persisted in v1. Returns the new state.
export async function PUT(request: Request, context: RouteContext) {
  const requestId = crmRequestId();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };

  try {
    const session = await resolveCrmSession();
    assertCanAssignOwner(session.effectivePermissions);

    // PUT accepts no query parameters at all.
    assertNoOwnerQueryParams(new URL(request.url).searchParams);

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      // Malformed JSON is plain 400 input; the parser exception never escapes.
      throw new CrmOwnerInputError("crm.users.owner.body_invalid");
    }

    const mutation = parseCrmOwnerMutationBody(raw);
    const { userId } = await context.params;
    // The actor is the authenticated StaffProfile from the session — never the
    // request body — and it becomes the mandatory actorStaffId on the history row.
    const state = await assignCrmUserOwner(parseCrmUserId(userId), session.employeeId, mutation);

    return NextResponse.json(crmOwnerResponseSchema.parse(state), { headers });
  } catch (error) {
    return errorResponse(error, requestId, headers);
  }
}
