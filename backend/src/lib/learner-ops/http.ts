/**
 * LEARNER-OPERATIONS-V1 — the HTTP boundary.
 *
 * Two gates, because there are two kinds of caller and they authenticate on
 * different axes.
 *
 *   `gateLearnerOpsStaff`   a CRM employee, identified by StaffProfile and
 *                           authorized by CRM permission.
 *   `gateLearnerOpsLearner` a learner, identified by the ordinary user session,
 *                           authorized only over their own cases.
 *
 * NEITHER GATE READS AUTHORIZATION FROM THE REQUEST. Role, permissions, staff
 * id and learner id all come from the server-side session, never from a header,
 * a query parameter or a body field. A caller can name a resource, never a
 * capability.
 *
 * CSRF POSTURE, STATED EXPLICITLY BECAUSE IT DIFFERS BY SURFACE. The CRM v1
 * mutation surface relies on the session cookie's `SameSite=Lax` attribute,
 * which is the established posture of every shipped CRM mutation (notes, owner)
 * and which browsers honour by refusing to attach the cookie to a cross-site
 * POST. The LEARNER surface additionally validates the CSRF token, because that
 * is the established posture of every shipped learner mutation (report submit,
 * mentor-review request). Each surface follows its own repository convention
 * rather than inventing a third.
 */
import { NextResponse } from "next/server";
import type { CrmPermission } from "@/lib/crm/roles";
import { CrmAuthError, crmRequestId, resolveCrmSession } from "@/lib/crm/session";
import { ApiAuthError, apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { isLearnerOpsError, LearnerOpsError } from "@/lib/learner-ops/errors";
import { prisma } from "@/lib/prisma";
import type { StaffActor } from "@/lib/learner-ops/case";

export const LEARNER_OPS_NO_STORE = { "Cache-Control": "no-store" } as const;

export function learnerOpsData(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: LEARNER_OPS_NO_STORE });
}

/**
 * The one error envelope. A Zod issue, a Prisma error, a stack, a SQL fragment,
 * a filesystem path, a role name and a permission name are all absent by
 * construction: only the closed error code and an optional operator-facing
 * detail written by this codebase ever reach the client.
 */
export function learnerOpsErrorResponse(error: unknown, context: string) {
  const requestId = crmRequestId();

  if (error instanceof CrmAuthError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: error.status, headers: LEARNER_OPS_NO_STORE },
    );
  }
  if (isLearnerOpsError(error)) {
    return NextResponse.json(
      { code: error.code, detail: error.detail ?? null, requestId },
      { status: error.status, headers: LEARNER_OPS_NO_STORE },
    );
  }
  // Never surface a raw exception. The context string is a fixed literal from
  // the call site, never anything the caller supplied.
  console.error(`[learner-ops] ${context}`, error);
  return NextResponse.json(
    { code: "internal", requestId },
    { status: 500, headers: LEARNER_OPS_NO_STORE },
  );
}

/* -------------------------------------------------------------- staff gate */

export type LearnerOpsStaffGate = {
  readonly actor: StaffActor;
  readonly employeeId: string;
  readonly displayName: string;
  readonly role: string;
  readonly permissions: readonly CrmPermission[];
};

/**
 * Resolve the CRM staff identity and assert EVERY listed permission.
 *
 * `required` is a list and every entry must be held — there is no "any of"
 * form, deliberately. An operation that could be satisfied by either of two
 * permissions is an operation whose authorization rule is ambiguous, and the
 * two review gates in particular must never become satisfiable by a single
 * broad permission.
 */
export async function requireLearnerOpsStaff(
  required: readonly CrmPermission[],
): Promise<LearnerOpsStaffGate> {
  const session = await resolveCrmSession();
  const held = new Set(session.effectivePermissions);
  for (const permission of required) {
    if (!held.has(permission)) {
      // 403 without naming which permission was missing — the envelope must not
      // become a map of the permission model for an unauthorized caller.
      throw new LearnerOpsError("LEARNER_OPS_FORBIDDEN");
    }
  }

  // The StaffProfile id is the domain actor. The User id is carried only so the
  // AuditLog row can be attributed, and never lands in a domain column.
  const profile = await prisma.staffProfile.findUnique({
    where: { id: session.employeeId },
    select: { id: true, userId: true },
  });
  if (!profile) {
    throw new LearnerOpsError("LEARNER_OPS_FORBIDDEN");
  }

  return {
    actor: { staffId: profile.id, userId: profile.userId },
    employeeId: session.employeeId,
    displayName: session.displayName,
    role: session.role,
    permissions: session.effectivePermissions,
  };
}

/* ------------------------------------------------------------ learner gate */

export type LearnerOpsLearnerGate = {
  readonly userId: number;
};

/**
 * The learner half. A learner is `User.role === "user"` — a staff account does
 * not get a learner support surface, because its cases would be indistinguishable
 * from the work it is handling.
 *
 * Mutations additionally validate CSRF, matching the learner mutation posture
 * the curriculum routes already use.
 */
export async function requireLearnerOpsLearner(
  request: Request,
  options: { readonly mutation: boolean },
): Promise<LearnerOpsLearnerGate | { readonly response: NextResponse }> {
  try {
    const user = await requireUser();
    if (user.role !== "user" || user.status !== "active") {
      return {
        response: await apiAuthErrorResponse(new ApiAuthError(403, user.id, user.role), request),
      };
    }
    if (options.mutation && !validateCsrfToken(request)) {
      return { response: await csrfFailureResponse(request) };
    }
    return { userId: user.id };
  } catch (error) {
    return { response: await apiAuthErrorResponse(error, request) };
  }
}

export function isLearnerGateFailure(
  gate: LearnerOpsLearnerGate | { readonly response: NextResponse },
): gate is { readonly response: NextResponse } {
  return "response" in gate;
}

/* ------------------------------------------------------------ query guard */

/**
 * Reject any query parameter the route does not declare. An unrecognised
 * parameter is a 400 rather than something silently ignored, so a filter that
 * a caller believes is narrowing their view can never be quietly dropped —
 * which is how a pagination or filter bug becomes a disclosure bug.
 */
export function assertOnlyQueryParams(request: Request, allowed: readonly string[]): void {
  const permitted = new Set(allowed);
  for (const key of new URL(request.url).searchParams.keys()) {
    if (!permitted.has(key)) {
      throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", `unexpected query parameter: ${key}`);
    }
  }
}

/** Parse a JSON body, failing closed on anything that is not a JSON object. */
export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "body must be a JSON object");
    }
    return body;
  } catch (error) {
    if (isLearnerOpsError(error)) throw error;
    throw new LearnerOpsError("LEARNER_OPS_INPUT_INVALID", "body is not valid JSON");
  }
}
