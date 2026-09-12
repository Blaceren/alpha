/**
 * L4VC-1 — HTTP glue for the learner-owned checkpoint verification route.
 *
 * Gate order matches every other V2 learner mutation and is strict:
 *   feature flags (uniform 404 before any authentication) -> session ->
 *   active principal -> actor rate limit -> CSRF -> strict body -> domain.
 *
 * NO STAFF OVERRIDE EXISTS. There is no admin, mentor or reviewer route that
 * marks a checkpoint verified: a financial gate that staff could wave someone
 * through is not a financial gate. Elevated roles reach this endpoint only as
 * learners, for their own enrollment.
 *
 * THE REQUEST BODY CARRIES ONE FIELD. The learner supplies a `requestId` and
 * nothing else — no balance, no currency, no login, no account id, no account
 * type, no deposit amount. The schema is strict, so any of those is a 400
 * rather than an ignored extra key.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ApiAuthError,
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireUser,
} from "@/lib/apiAuth";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import {
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
} from "@/lib/env";
import { rateLimit } from "@/lib/rateLimit";
import {
  CHECKPOINT_REQUEST_ID_PATTERN,
  isCheckpointVerificationError,
  type CheckpointVerificationErrorCode,
  type VerifyCheckpointResult,
} from "./checkpoint-verification";

export const CHECKPOINT_NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Transport-level allowance for the endpoint itself, on top of the durable
 * 5-per-hour verification allowance in the domain.
 *
 * The two protect different things: this one stops a client hammering the route
 * (including with requests that never reach a provider), the durable one is the
 * learner's actual verification budget. Sized so a learner retrying legitimately
 * is never blocked by transport before the domain has explained why.
 */
const CHECKPOINT_MUTATION_LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 };

export function checkpointData(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: CHECKPOINT_NO_STORE });
}

export function checkpointError(error: string, status: number, issues?: unknown[]) {
  return NextResponse.json(
    issues && issues.length ? { error, issues } : { error },
    { status, headers: CHECKPOINT_NO_STORE },
  );
}

/** Deliberately indistinguishable from a missing route. */
export function checkpointDisabled() {
  return checkpointError("NOT_FOUND", 404);
}

const DOMAIN_STATUS: Record<CheckpointVerificationErrorCode, number> = {
  CHECKPOINT_DISABLED: 404,
  CHECKPOINT_INPUT_INVALID: 400,
  CHECKPOINT_NOT_ENROLLED: 409,
  CHECKPOINT_FORBIDDEN: 403,
  CHECKPOINT_LEVEL_NOT_FOUND: 404,
  CHECKPOINT_LEVEL_WRONG_TYPE: 409,
  CHECKPOINT_LEVEL_NOT_CURRENT: 409,
  CHECKPOINT_SEQUENCE_INCOMPLETE: 409,
  CHECKPOINT_REQUIREMENT_UNCONFIGURED: 409,
  CHECKPOINT_REQUEST_CONFLICT: 409,
  CHECKPOINT_STATE_CORRUPT: 409,
  CHECKPOINT_INTERNAL_ERROR: 500,
};

/**
 * Domain error -> HTTP. Never leaks a Prisma error, a stack, a provider
 * message or anything a provider returned.
 */
export function checkpointException(error: unknown) {
  if (isCheckpointVerificationError(error)) {
    const status = DOMAIN_STATUS[error.code] ?? 500;
    if (status === 500) {
      console.error("checkpoint verification api internal error");
      return checkpointError("CHECKPOINT_INTERNAL_ERROR", 500);
    }
    return checkpointError(error.code, status);
  }
  console.error("checkpoint verification api internal error");
  return checkpointError("CHECKPOINT_INTERNAL_ERROR", 500);
}

/** The complete request contract. Strict: any other key is a 400. */
export const verifyCheckpointBodySchema = z.strictObject({
  requestId: z.string().regex(CHECKPOINT_REQUEST_ID_PATTERN),
});

/** stableCode path segment: conservative identity charset, bounded length. */
const STABLE_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function checkpointStableCodePath(raw: string): string {
  if (!STABLE_CODE.test(raw)) {
    // A malformed identity collapses into the uniform not-found so probing
    // reveals nothing about which levels exist.
    throw Object.assign(new Error("NOT_FOUND"), { __checkpointNotFound: true });
  }
  return raw;
}

export function isCheckpointNotFoundMarker(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "__checkpointNotFound" in error,
  );
}

export async function checkpointJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

type GateOk = { ok: true; actorId: number };
type GateFailed = { ok: false; response: NextResponse };
export type CheckpointGateResult = GateOk | GateFailed;

function withNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/**
 * Learner gate for checkpoint verification.
 *
 * READ + ENROLLMENT are required because verification reads and may complete a
 * curriculum level. The CHECKPOINT and provider flags are NOT checked here on
 * purpose: they select the provider inside the domain, which answers with a
 * typed unavailable state. Collapsing them into a 404 would tell the learner
 * "no such thing" about a level they can plainly see, which is exactly the
 * dishonesty the honest gate removed.
 */
export async function gateCheckpointSelf(request: Request): Promise<CheckpointGateResult> {
  if (!isCurriculumV2ReadEnabled() || !isCurriculumV2EnrollmentEnabled()) {
    return { ok: false, response: checkpointDisabled() };
  }

  let actorId: number;
  try {
    const user = await requireUser();
    if (user.status !== "active") throw new ApiAuthError(403, user.id, user.role);
    actorId = user.id;
  } catch (error) {
    return { ok: false, response: withNoStore(await apiAuthErrorResponse(error, request)) };
  }

  const limit = rateLimit(`checkpoint:verify:${actorId}`, CHECKPOINT_MUTATION_LIMIT);
  if (!limit.allowed) {
    return { ok: false, response: withNoStore(rateLimitedResponse()) };
  }
  if (!validateCsrfToken(request)) {
    return { ok: false, response: withNoStore(await csrfFailureResponse(request)) };
  }
  return { ok: true, actorId };
}

/**
 * The complete response DTO.
 *
 * Built field by field from the typed result — never spread from a provider
 * value — so there is no path by which a raw balance, an account currency, a
 * remaining amount, a login, a token or a provider payload could appear.
 */
export function checkpointVerificationDto(result: VerifyCheckpointResult) {
  if (result.kind === "refused") {
    return {
      verificationState: result.verificationState,
      verificationReason: result.verificationReason,
      retryAfterSeconds: result.retryAfterSeconds,
      completed: false,
      replayed: false,
      level: null,
      nextLevelNumber: null,
      xpAwarded: 0 as const,
      xpTransactionId: null,
    };
  }
  return {
    verificationState: result.verificationState,
    verificationReason: result.verificationReason,
    retryAfterSeconds: result.retryAfterSeconds,
    completed: result.completed,
    replayed: result.replayed,
    level: { levelNumber: result.levelNumber, stableCode: result.stableCode },
    nextLevelNumber: result.nextLevelNumber,
    // A financial checkpoint is a gate, not an achievement.
    xpAwarded: 0 as const,
    xpTransactionId: null,
  };
}
