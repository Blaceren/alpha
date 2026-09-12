/**
 * A4 — HTTP glue for the mentor-review lifecycle.
 *
 * Gate order matches every other V2 mutation and is strict:
 *   feature flags (uniform 404 before any authentication) -> session ->
 *   active principal/role -> actor rate limit -> CSRF -> strict path/body ->
 *   domain.
 *
 * TWO GATES, DELIBERATELY DIFFERENT
 *   `gateMentorReviewSelf`     any active learner, for their own level
 *   `gateMentorReviewReviewer` an active admin or mentor
 *
 * The reviewer gate reuses `requireTaskReportReviewer` — the shipped
 * admin|mentor model the report review workflow already uses. There is no new
 * role, and the role is never taken from the request.
 *
 * FLAGS. READ + ENROLLMENT and nothing else. A mentor-review level carries no
 * lesson content, no assessment and no report, so demanding CONTENT, ASSESSMENT
 * or REPORT here would make the route's availability depend on flags that say
 * nothing about it. The XP flag is likewise not a precondition: approval of a
 * zero-reward level awards nothing, and a positive reward with XP disabled is
 * refused inside the completion primitive, atomically.
 */
import { NextResponse } from "next/server";
import {
  ApiAuthError,
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireTaskReportReviewer,
  requireUser,
} from "@/lib/apiAuth";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import {
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
} from "@/lib/env";
import { rateLimit } from "@/lib/rateLimit";
import { hasCrmReviewAuthority } from "@/lib/learner-ops/review-authority";
import { isMentorReviewError, type MentorReviewErrorCode } from "./mentor-review";

export const MENTOR_REVIEW_NO_STORE = { "Cache-Control": "no-store" } as const;

const SELF_MUTATION_LIMIT = { limit: 60, windowMs: 10 * 60 * 1000 };
const REVIEWER_MUTATION_LIMIT = { limit: 120, windowMs: 10 * 60 * 1000 };

export function mentorReviewData(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: MENTOR_REVIEW_NO_STORE });
}

export function mentorReviewError(error: string, status: number, issues?: unknown[]) {
  return NextResponse.json(
    issues && issues.length ? { error, issues } : { error },
    { status, headers: MENTOR_REVIEW_NO_STORE },
  );
}

/** Deliberately indistinguishable from a missing route. */
export function mentorReviewDisabled() {
  return mentorReviewError("NOT_FOUND", 404);
}

const DOMAIN_STATUS: Record<MentorReviewErrorCode, number> = {
  MENTOR_REVIEW_DISABLED: 404,
  MENTOR_REVIEW_INPUT_INVALID: 400,
  MENTOR_REVIEW_FORBIDDEN: 403,
  MENTOR_REVIEW_SELF_REVIEW_FORBIDDEN: 403,
  MENTOR_REVIEW_NOT_ENROLLED: 409,
  MENTOR_REVIEW_LEVEL_NOT_FOUND: 404,
  MENTOR_REVIEW_LEVEL_WRONG_OWNER: 409,
  MENTOR_REVIEW_LEVEL_NOT_CURRENT: 409,
  MENTOR_REVIEW_LEVEL_NOT_STARTED: 409,
  MENTOR_REVIEW_NOT_PENDING: 409,
  MENTOR_REVIEW_CONFLICT: 409,
  MENTOR_REVIEW_STATE_CORRUPT: 409,
  MENTOR_REVIEW_INTERNAL_ERROR: 500,
};

/** Domain error -> HTTP. Never leaks a Prisma error, a stack or learner data. */
export function mentorReviewException(error: unknown, label = "mentor review api") {
  if (isMentorReviewError(error)) {
    const status = DOMAIN_STATUS[error.code] ?? 500;
    if (status === 500) {
      console.error(`${label} internal error`);
      return mentorReviewError("MENTOR_REVIEW_INTERNAL_ERROR", 500);
    }
    return mentorReviewError(error.code, status);
  }
  console.error(`${label} internal error`);
  return mentorReviewError("MENTOR_REVIEW_INTERNAL_ERROR", 500);
}

type GateOk = { ok: true; actorId: number };
type GateFailed = { ok: false; response: NextResponse };
export type MentorReviewGateResult = GateOk | GateFailed;

function withNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function flagsEnabled() {
  return isCurriculumV2ReadEnabled() && isCurriculumV2EnrollmentEnabled();
}

async function gate(
  request: Request,
  authorize: () => Promise<{ id: number; status: string; role: never | string }>,
  bucket: string,
  limits: { limit: number; windowMs: number },
): Promise<MentorReviewGateResult> {
  if (!flagsEnabled()) {
    return { ok: false, response: mentorReviewDisabled() };
  }
  let actorId: number;
  try {
    const user = await authorize();
    if (user.status !== "active") throw new ApiAuthError(403, user.id);
    actorId = user.id;
  } catch (error) {
    return { ok: false, response: withNoStore(await apiAuthErrorResponse(error, request)) };
  }
  const limit = rateLimit(`${bucket}:${actorId}`, limits);
  if (!limit.allowed) {
    return { ok: false, response: withNoStore(rateLimitedResponse()) };
  }
  if (!validateCsrfToken(request)) {
    return { ok: false, response: withNoStore(await csrfFailureResponse(request)) };
  }
  return { ok: true, actorId };
}

export function gateMentorReviewSelf(request: Request) {
  return gate(request, requireUser, "curriculum:mentor-review:self", SELF_MUTATION_LIMIT);
}

/**
 * LO-AUTH-AXIS-1 — the reviewer gate now requires BOTH axes.
 *
 * `requireTaskReportReviewer` is unchanged and still runs first: the caller must
 * be an active `admin` or `mentor`. The second assertion is INTERSECTED with
 * it, so this can only ever narrow who may approve a mentor review, never
 * widen it. A reviewer with no CRM StaffProfile, or whose staff role does not
 * hold `learner_ops_mentor_review`, is refused with the SAME 403 the role check
 * produces — the client cannot tell the two apart, so the response does not
 * become a map of the permission model.
 */
async function requireMentorReviewAuthority() {
  const user = await requireTaskReportReviewer();
  if (!(await hasCrmReviewAuthority(user.id, "mentor"))) {
    throw new ApiAuthError(403, user.id, user.role);
  }
  return user;
}

export function gateMentorReviewReviewer(request: Request) {
  return gate(
    request,
    requireMentorReviewAuthority,
    "curriculum:mentor-review:reviewer",
    REVIEWER_MUTATION_LIMIT,
  );
}

/** Strict query: this lifecycle takes no query parameters at all. */
export function assertNoMentorReviewQuery(request: Request) {
  if (new URL(request.url).searchParams.size !== 0) {
    throw Object.assign(new Error("INVALID_QUERY"), { __mentorReviewQuery: true });
  }
}

export function isMentorReviewQueryMarker(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "__mentorReviewQuery" in error);
}

/** A positive integer path segment. Anything else is a 400, never a lookup. */
export function mentorReviewPathId(raw: string): number {
  const value = Number(raw);
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) {
    throw Object.assign(new Error("INPUT_INVALID"), { __mentorReviewPath: true });
  }
  return value;
}

export function isMentorReviewPathMarker(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "__mentorReviewPath" in error);
}
