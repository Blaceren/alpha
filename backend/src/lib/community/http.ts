/**
 * COMMUNITY-V1 — the HTTP boundary.
 *
 * Two gates, exactly as Learner Operations has, and for the same reason: a
 * learner and a CRM employee authenticate on different axes and must not be
 * satisfiable by one check.
 *
 *   `requireCommunityLearner`   a learner, ordinary session, authorized only
 *                               over spaces their own V2 progression opened
 *   `requireCommunityModerator` a CRM employee, identified by StaffProfile and
 *                               holding `community_moderate`
 *
 * NEITHER GATE READS AUTHORIZATION FROM THE REQUEST. Role, permissions, staff
 * id and learner id all come from the server-side session — never a header,
 * query parameter or body field. A caller can name a resource, never a
 * capability.
 *
 * WHY NOT `canModerateChat(User.role)`. That is the V1 axis, and it answers
 * "admin or moderator" for a column the CRM permission model was built to
 * replace. `crm/roles.ts` already records that the `moderator` StaffProfile in
 * PREPROD carries `User.role = "admin"`, which under a `User.role` check would
 * hand it authority nobody granted deliberately. Community authorizes on the
 * permission, so revoking `community_moderate` actually revokes it.
 */
import { NextResponse } from "next/server";
import type { CrmPermission } from "@/lib/crm/roles";
import { CrmAuthError, crmRequestId, resolveCrmSession } from "@/lib/crm/session";
import { ApiAuthError, apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { CommunityError, isCommunityError } from "./errors";

export const COMMUNITY_NO_STORE = { "Cache-Control": "no-store" } as const;

export const COMMUNITY_MODERATE: CrmPermission = "community_moderate";

export function communityData(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: COMMUNITY_NO_STORE });
}

/**
 * The one error envelope. A Zod issue, a Prisma error, a stack, a SQL fragment,
 * a filesystem path, a role name and a permission name are all absent by
 * construction.
 */
export function communityErrorResponse(error: unknown, context: string) {
  const requestId = crmRequestId();

  if (error instanceof CrmAuthError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: error.status, headers: COMMUNITY_NO_STORE },
    );
  }
  if (isCommunityError(error)) {
    return NextResponse.json(
      { code: error.code, detail: error.detail, requestId },
      { status: error.status, headers: COMMUNITY_NO_STORE },
    );
  }
  console.error(`[community] ${context}`, error);
  return NextResponse.json(
    { code: "COMMUNITY_INTERNAL", requestId },
    { status: 500, headers: COMMUNITY_NO_STORE },
  );
}

/* ---------------------------------------------------------- learner gate */

export type CommunityLearnerGate = {
  readonly userId: number;
  /**
   * True only when the learner ALSO holds the moderation permission. It widens
   * reading and the removal of others' content, never posting.
   */
  readonly isModerator: boolean;
};

/**
 * Does this session additionally hold Community moderation?
 *
 * Resolved through the CRM session, and it FAILS CLOSED to `false` on every
 * error: no CRM session, an expired one, a staff profile that no longer exists.
 * A moderation capability is never the consequence of an exception.
 */
async function resolveModeratorFlag(): Promise<boolean> {
  try {
    const session = await resolveCrmSession();
    return session.effectivePermissions.includes(COMMUNITY_MODERATE);
  } catch {
    return false;
  }
}

/**
 * The learner half.
 *
 * A learner is `User.role === "user"` and `status === "active"`, matching the
 * Learner Operations learner gate exactly. Mutations validate CSRF, matching the
 * posture every shipped learner mutation already uses.
 */
export async function requireCommunityLearner(
  request: Request,
  options: { readonly mutation: boolean },
): Promise<CommunityLearnerGate | { readonly response: NextResponse }> {
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
    return { userId: user.id, isModerator: false };
  } catch (error) {
    return { response: await apiAuthErrorResponse(error, request) };
  }
}

export function isLearnerGateFailure(
  gate: CommunityLearnerGate | { readonly response: NextResponse },
): gate is { readonly response: NextResponse } {
  return "response" in gate;
}

/* --------------------------------------------------------- moderator gate */

export type CommunityModeratorGate = {
  readonly staffId: string;
  readonly userId: number;
  readonly displayName: string;
};

/**
 * Resolve the CRM staff identity and assert `community_moderate`.
 *
 * A 403 never names the missing permission: the envelope must not become a map
 * of the permission model for an unauthorized caller.
 */
export async function requireCommunityModerator(): Promise<CommunityModeratorGate> {
  const session = await resolveCrmSession();
  if (!session.effectivePermissions.includes(COMMUNITY_MODERATE)) {
    throw new CommunityError("COMMUNITY_FORBIDDEN");
  }

  const profile = await prisma.staffProfile.findUnique({
    where: { id: session.employeeId },
    select: { id: true, userId: true, displayName: true },
  });
  if (!profile) throw new CommunityError("COMMUNITY_FORBIDDEN");

  return { staffId: profile.id, userId: profile.userId, displayName: profile.displayName };
}

/** Exported for the learner routes that want the read-widening flag. */
export { resolveModeratorFlag };

/* ------------------------------------------------------------ input guard */

export function assertOnlyQueryParams(request: Request, allowed: readonly string[]): void {
  const permitted = new Set(allowed);
  for (const key of new URL(request.url).searchParams.keys()) {
    if (!permitted.has(key)) {
      throw new CommunityError("COMMUNITY_VALIDATION", "unexpected_query_parameter");
    }
  }
}

export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new CommunityError("COMMUNITY_VALIDATION", "body_must_be_object");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (isCommunityError(error)) throw error;
    throw new CommunityError("COMMUNITY_VALIDATION", "body_not_json");
  }
}

/**
 * A cuid-shaped identifier, or a refusal.
 *
 * Conservative identity charset with a bounded length: admits a cuid, refuses a
 * path traversal, a query string, an absolute URL and anything with a slash.
 */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

export function validateId(raw: string, code: "COMMUNITY_DISCUSSION_NOT_FOUND" | "COMMUNITY_REPLY_NOT_FOUND"): string {
  if (!ID_RE.test(raw)) throw new CommunityError(code);
  return raw;
}

/** A space code, e.g. `channel.start_questions`. */
const SPACE_CODE_RE = /^[a-z][a-z0-9_.]{2,63}$/;

export function validateSpaceCode(raw: string): string {
  if (!SPACE_CODE_RE.test(raw)) throw new CommunityError("COMMUNITY_SPACE_NOT_FOUND");
  return raw;
}
