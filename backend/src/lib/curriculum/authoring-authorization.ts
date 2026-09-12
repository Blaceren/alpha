/**
 * PHASE-G0 — the curriculum-authoring authorization gate.
 *
 * THE PROBLEM THIS SOLVES. Two authorization axes already exist and both are
 * correct for what they guard:
 *
 *   • `requireAdmin()` -> `User.role === "admin"`, which is what every
 *     `/api/admin/**` route has always meant, and what the 87 accepted
 *     curriculum admin endpoints check today.
 *   • `resolveCrmSession()` -> `StaffProfile.staffRole` -> `CrmPermission[]`,
 *     which is what every `/api/crm/**` route means.
 *
 * The Authoring Studio needs the SECOND set of people to reach the FIRST set of
 * endpoints. The naive fixes are both wrong: promoting content staff to
 * `UserRole=admin` would hand them every unrelated admin endpoint in the
 * product, and cloning the 87 endpoints under `/api/crm/**` would give the same
 * domain two owners that will drift.
 *
 * WHY NO IDENTITY TRANSLATION IS INVENTED HERE. The two axes are already the
 * same identity, and this module only reads that fact rather than constructing
 * it. Both `requireAdmin` (via `getCurrentUser` -> `getSessionUserId`) and
 * `resolveCrmSession` (via `getSession`) verify the SAME HMAC-signed
 * `trading_platform_session` cookie and resolve the SAME `session.userId`.
 * `StaffProfile.userId` is `@unique`, so a staff profile is a 1:1 extension of
 * that very `User` row — not a second account, not a mapping table, not a
 * lookup by email. One cookie, one User, optionally one StaffProfile.
 *
 * WHAT THE GATE DOES. It resolves the session ONCE and then asks a single
 * question — "may this actor do this authoring operation?" — for which there are
 * exactly two sufficient answers:
 *
 *   PATH A (compatibility): the actor is `UserRole=admin`. This is exactly the
 *   authority the accepted endpoints already grant, so nothing anywhere is
 *   widened and every existing admin integration keeps working byte-identically.
 *
 *   PATH B (staff): the actor has a StaffProfile whose STORED role grants the
 *   specific `CrmPermission` this operation needs.
 *
 * The two paths are alternatives, never a merge: a CRM staff actor does not
 * become an admin, gains nothing outside curriculum authoring, and is refused by
 * every other `/api/admin/**` route exactly as before.
 *
 * FAIL-CLOSED EVERYWHERE. No session, blocked account, unknown staff role,
 * missing permission, disabled flag — every one of them denies. There is no
 * branch in this file that grants on the ABSENCE of information.
 */
import type { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiAuthErrorResponse, rateLimitedResponse } from "@/lib/apiAuth";
import {
  canAdjudicateCurriculumSourceAuthority,
  canApproveCurriculum,
  canAuthorCurriculum,
  canReadCurriculumAuthoring,
  isCrmStaffRole,
  resolveEffectivePermissions,
  type CrmPermission,
} from "@/lib/crm/roles";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { isCurriculumV2AdminEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { getSession } from "@/lib/session";

/**
 * The four things an authoring caller can be asking to do.
 *
 * PHASE-G2 adds `adjudicate` as a PEER of the other three, not as a synonym for
 * `approve`. Approving accepts a draft as editorial truth; adjudicating decides
 * which of two competing SOURCES a field should follow. A bank that has been
 * adjudicated still owes the product a normal review by someone else, so the two
 * must never be satisfiable by the same permission.
 */
export type AuthoringCapability = "read" | "author" | "approve" | "adjudicate";

/**
 * How the actor was authorized. Recorded on every audit row, because "an admin
 * did it" and "a content manager did it" are different facts about the same
 * mutation and an operator reading the trail must be able to tell them apart.
 */
export type AuthoringActorKind = "user_role_admin" | "crm_staff";

export type AuthoringActor = {
  actorId: number;
  kind: AuthoringActorKind;
  /** Present only for `crm_staff`. `null` for the compatibility admin path. */
  staffRole: string | null;
  /** Canonical-order permissions, empty for the compatibility admin path. */
  permissions: readonly CrmPermission[];
};

export type AuthoringGate =
  | { ok: true; actor: AuthoringActor }
  | { ok: false; response: NextResponse };

const CAPABILITY_PERMISSION: Record<AuthoringCapability, CrmPermission> = {
  read: "curriculum_read",
  author: "curriculum_author",
  approve: "curriculum_approve",
  adjudicate: "curriculum_source_authority",
};

function withNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function disabledResponse(): NextResponse {
  return withNoStore(
    NextResponse.json(
      { error: "CURRICULUM_ADMIN_DISABLED", message: "Authoring API is disabled" },
      { status: 404 },
    ),
  );
}

function forbidden(): NextResponse {
  return withNoStore(
    NextResponse.json(
      { error: "FORBIDDEN", message: "Недостаточно прав" },
      { status: 403 },
    ),
  );
}

function unauthorized(): NextResponse {
  return withNoStore(
    NextResponse.json(
      { error: "UNAUTHORIZED", message: "Необходимо войти в аккаунт" },
      { status: 401 },
    ),
  );
}

/** Exactly the fields the decision depends on. Nothing else may influence it. */
export type AuthoringIdentity = {
  id: number;
  role: string;
  status: string;
  staffProfile: { staffRole: string } | null;
};

export type AuthoringDecision =
  | { ok: true; actor: AuthoringActor }
  | { ok: false; status: 401 | 403 };

/**
 * THE DECISION, as a pure function of a loaded identity.
 *
 * Split out from the session read on purpose: this is the rule the product
 * cares about, and keeping it free of `cookies()` means the regression can
 * exercise it against REAL database rows for every staff role rather than
 * asserting it indirectly through HTTP. A rule that can only be tested through
 * a request scope tends not to be tested for every role.
 */
export function authorizeAuthoringIdentity(
  user: AuthoringIdentity | null,
  capability: AuthoringCapability,
): AuthoringDecision {
  // A missing or blocked account is 401 in both existing systems, and stays 401
  // here so a blocked staff member cannot distinguish "blocked" from "logged
  // out" by watching the status code.
  if (!user || user.status === "blocked") return { ok: false, status: 401 };

  // PATH A — the accepted compatibility authority. An admin already holds every
  // one of these operations through the existing endpoints, so recognising them
  // here widens nothing and is what keeps the migration of the 87 endpoints a
  // no-op for existing callers.
  if ((user.role as UserRole) === "admin") {
    return {
      ok: true,
      actor: { actorId: user.id, kind: "user_role_admin", staffRole: null, permissions: [] },
    };
  }

  // PATH B — CRM staff. The permission set is ALWAYS recomputed from the stored
  // role: nothing the caller sends is consulted, and an unrecognised stored role
  // resolves to the empty set rather than to a guess.
  const staffRole = user.staffProfile?.staffRole;
  if (!staffRole || !isCrmStaffRole(staffRole)) return { ok: false, status: 403 };

  const permissions = resolveEffectivePermissions(staffRole);
  const granted =
    capability === "read"
      ? canReadCurriculumAuthoring(permissions)
      : capability === "author"
        ? canAuthorCurriculum(permissions)
        : capability === "approve"
          ? canApproveCurriculum(permissions)
          : canAdjudicateCurriculumSourceAuthority(permissions);

  if (!granted) return { ok: false, status: 403 };

  return {
    ok: true,
    actor: { actorId: user.id, kind: "crm_staff", staffRole, permissions },
  };
}

/**
 * Resolve the authoring actor for a capability, or explain the denial.
 *
 * Reads the session cookie, loads the canonical identity, and delegates the
 * decision above. Deliberately does NOT read the request body, the query string
 * or any header other than the cookie and the CSRF token: authorization must
 * not depend on anything the caller can shape.
 */
export async function resolveAuthoringActor(
  capability: AuthoringCapability,
): Promise<AuthoringDecision> {
  const session = await getSession();
  if (!session) return { ok: false, status: 401 };

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      role: true,
      status: true,
      staffProfile: { select: { staffRole: true } },
    },
  });

  return authorizeAuthoringIdentity(user, capability);
}

/**
 * The HTTP gate. Composes the flag check, the actor resolution, the per-actor
 * rate limit and the CSRF check in that order.
 *
 * ORDER MATTERS. The flag is checked FIRST and answers 404, so an environment
 * that has not activated the Authoring Studio does not disclose that these
 * routes exist. CSRF is checked LAST, after the actor is known, so a CSRF
 * failure can be audited against a real identity.
 */
export async function gateCurriculumAuthoring(
  request: Request,
  capability: AuthoringCapability,
): Promise<AuthoringGate> {
  if (!isCurriculumV2AdminEnabled()) {
    return { ok: false, response: disabledResponse() };
  }

  let resolved: Awaited<ReturnType<typeof resolveAuthoringActor>>;
  try {
    resolved = await resolveAuthoringActor(capability);
  } catch (error) {
    return { ok: false, response: withNoStore(await apiAuthErrorResponse(error, request)) };
  }

  if (!resolved.ok) {
    return { ok: false, response: resolved.status === 401 ? unauthorized() : forbidden() };
  }

  const limit = rateLimit(`curriculum:authoring:${resolved.actor.actorId}`, {
    limit: 200,
    windowMs: 10 * 60 * 1000,
  });
  if (!limit.allowed) return { ok: false, response: withNoStore(rateLimitedResponse()) };

  const isWrite = capability !== "read";
  if (isWrite && !validateCsrfToken(request)) {
    return { ok: false, response: withNoStore(await csrfFailureResponse(request)) };
  }

  return { ok: true, actor: resolved.actor };
}

/** The permission a capability requires. Exported for the regression suite. */
export function permissionForCapability(capability: AuthoringCapability): CrmPermission {
  return CAPABILITY_PERMISSION[capability];
}

/**
 * PHASE-G1 — does a STORED staff role grant a curriculum-authoring capability?
 *
 * WHY THE DOMAIN NEEDS THIS AT ALL. The content and assessment domains carry
 * their own actor assertions (`CONTENT_ACTOR_FORBIDDEN`,
 * `ASSESSMENT_ACTOR_FORBIDDEN`), and they are not decoration: they are what
 * makes a domain command safe for a script, the importer and every future
 * caller that never passes through an HTTP gate. Widening only the HTTP edge
 * would have produced a studio in which every save was refused by the layer
 * underneath — which is exactly what the first G1 test run showed.
 *
 * ONE DEFINITION, NOT TWO. The permission set is resolved from the STORED role
 * through the same accepted `resolveEffectivePermissions` /
 * `canAuthorCurriculum` pair the HTTP gate uses. Nothing here reads a request,
 * a header or a caller-supplied role, and there is no second permission table.
 *
 * IT WIDENS AUTHORING ONLY. Callers that guard PUBLICATION, ARCHIVAL or
 * RESOURCE BINDING keep the unchanged `UserRole=admin` assertion, so a content
 * editor still cannot activate content for learners or rebind a level — at the
 * domain, not merely in the UI.
 */
export function staffRoleGrantsCurriculumCapability(
  staffRole: string | null | undefined,
  capability: AuthoringCapability,
): boolean {
  if (!staffRole || !isCrmStaffRole(staffRole)) return false;
  const permissions = resolveEffectivePermissions(staffRole);
  return capability === "read"
    ? canReadCurriculumAuthoring(permissions)
    : capability === "author"
      ? canAuthorCurriculum(permissions)
      : capability === "approve"
        ? canApproveCurriculum(permissions)
        : canAdjudicateCurriculumSourceAuthority(permissions);
}
