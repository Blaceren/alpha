/**
 * A8 — the operator route for STAGING_ATTESTED QA verification.
 *
 * GATE ORDER, STRICT AND IN THIS ORDER:
 *   1. environment    -- not staging, or the flag is off -> 404, before any
 *                        authentication and before the database is touched. In
 *                        production this route is indistinguishable from a route
 *                        that does not exist: it does not 403, it does not hint,
 *                        it is simply not there.
 *   2. admin session  -- `requireAdmin`. The actor comes from the session and
 *                        there is no body field through which it could be set.
 *   3. rate limit     -- per operator.
 *   4. CSRF           -- this is a browser-reachable mutation.
 *   5. strict body    -- unknown keys are 400s, not ignored extras.
 *   6. domain         -- which re-checks the environment, re-checks the operator
 *                        role from the database, and refuses self-attestation.
 *
 * A LEARNER CANNOT REACH THIS. It lives under `/api/admin`, requires the admin
 * role, and the domain refuses an operator who owns the target enrollment even
 * if they hold that role.
 *
 * THE BODY CANNOT DESCRIBE MONEY. Four fields: which QA event, which learner,
 * which level, and an idempotency identity. There is no amount, no currency, no
 * balance, no account, no Pocket id and no completion status — a strict schema
 * makes each of those a 400 rather than something quietly dropped. This endpoint
 * cannot be used to submit a balance to be persisted as truth, because it has
 * nowhere to put one.
 *
 * IT IS NOT A GENERIC "COMPLETE ANY LEVEL" ENDPOINT. Each event class is bound
 * to exactly one level pair, so a lesson, a report, an assessment, a mentor
 * review or a final exam is refused with `LEVEL_WRONG_KIND`.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiAuthErrorResponse, rateLimitedResponse, requireAdmin } from "@/lib/apiAuth";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { STABLE_CODE_PATTERN } from "@/lib/curriculum/constants";
import {
  attestStagingGate,
  isStagingAttestationError,
  STAGING_ATTESTATION_EVENT_CLASSES,
  STAGING_ATTESTATION_REQUEST_ID_PATTERN,
  type StagingAttestationErrorCode,
} from "@/lib/curriculum/staging-attestation";
import { isStagingAttestationUsable } from "@/lib/curriculum/staging-attestation-policy";
import { rateLimit } from "@/lib/rateLimit";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const OPERATOR_LIMIT = { limit: 60, windowMs: 10 * 60 * 1000 };

const DOMAIN_STATUS: Record<StagingAttestationErrorCode, number> = {
  STAGING_ATTESTATION_DISABLED: 404,
  STAGING_ATTESTATION_INPUT_INVALID: 400,
  STAGING_ATTESTATION_FORBIDDEN: 403,
  STAGING_ATTESTATION_LEARNER_NOT_FOUND: 404,
  STAGING_ATTESTATION_NOT_ENROLLED: 409,
  STAGING_ATTESTATION_LEVEL_NOT_FOUND: 404,
  STAGING_ATTESTATION_LEVEL_WRONG_KIND: 409,
  STAGING_ATTESTATION_LEVEL_NOT_CURRENT: 409,
  STAGING_ATTESTATION_REQUEST_CONFLICT: 409,
  STAGING_ATTESTATION_COMPLETION_REFUSED: 409,
  STAGING_ATTESTATION_STATE_CORRUPT: 409,
  STAGING_ATTESTATION_INTERNAL_ERROR: 500,
};

function body(payload: unknown, status: number) {
  return NextResponse.json(payload, { status, headers: NO_STORE });
}

function withNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Deliberately indistinguishable from a missing route. */
function notFound() {
  return body({ error: "NOT_FOUND" }, 404);
}

const attestBodySchema = z.strictObject({
  eventClass: z.enum(STAGING_ATTESTATION_EVENT_CLASSES),
  learnerUserId: z.number().int().positive(),
  stableCode: z.string().regex(STABLE_CODE_PATTERN),
  requestId: z.string().regex(STAGING_ATTESTATION_REQUEST_ID_PATTERN),
});

export async function POST(request: Request) {
  // 1. The environment gate, before authentication and before any read.
  if (!isStagingAttestationUsable()) return notFound();

  let operatorId: number;
  try {
    const admin = await requireAdmin();
    if (admin.status !== "active") return withNoStore(await apiAuthErrorResponse(null, request));
    operatorId = admin.id;
  } catch (error) {
    return withNoStore(await apiAuthErrorResponse(error, request));
  }

  const limit = rateLimit(`curriculum:staging-attestation:${operatorId}`, OPERATOR_LIMIT);
  if (!limit.allowed) return withNoStore(rateLimitedResponse());
  if (!validateCsrfToken(request)) {
    return withNoStore(await csrfFailureResponse(request));
  }

  if (new URL(request.url).searchParams.size !== 0) {
    return body({ error: "INVALID_QUERY" }, 400);
  }

  let raw: unknown;
  try {
    const text = await request.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    return body({ error: "STAGING_ATTESTATION_INPUT_INVALID" }, 400);
  }
  const parsed = attestBodySchema.safeParse(raw);
  if (!parsed.success) {
    return body(
      {
        error: "STAGING_ATTESTATION_INPUT_INVALID",
        issues: parsed.error.issues.map((issue) => ({
          code: "INPUT_INVALID",
          reference: issue.path.join(".") || "body",
        })),
      },
      400,
    );
  }

  try {
    const receipt = await attestStagingGate({
      operatorUserId: operatorId,
      eventClass: parsed.data.eventClass,
      learnerUserId: parsed.data.learnerUserId,
      stableCode: parsed.data.stableCode,
      requestId: parsed.data.requestId,
    });
    return body({ data: { ok: true, ...receipt } }, receipt.created ? 201 : 200);
  } catch (error) {
    if (isStagingAttestationError(error)) {
      const status = DOMAIN_STATUS[error.code] ?? 500;
      if (status === 404 && error.code === "STAGING_ATTESTATION_DISABLED") return notFound();
      if (status === 500) {
        console.error("staging attestation api internal error");
        return body({ error: "STAGING_ATTESTATION_INTERNAL_ERROR" }, 500);
      }
      return body({ error: error.code }, status);
    }
    console.error("staging attestation api internal error");
    return body({ error: "STAGING_ATTESTATION_INTERNAL_ERROR" }, 500);
  }
}
