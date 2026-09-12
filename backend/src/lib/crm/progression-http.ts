/**
 * PHASE-1 ADMIN — the HTTP boundary for administrative progression correction.
 *
 * ONE GATE, AND IT READS NOTHING FROM THE REQUEST. The actor's StaffProfile,
 * User id and permission set all come from `resolveCrmSession()`. There is no
 * `actorId`, `actorRole` or `permissions` body field to forge, because the
 * schemas are `z.strictObject` and would reject one as an unknown key.
 *
 * CSRF POSTURE, AND WHY IT DIFFERS FROM NOTES AND OWNER. The older CRM v1
 * mutations (notes, owner) rely on the session cookie's `SameSite=Lax`
 * attribute alone, and `learner-ops/http.ts` records that as the surface's
 * convention. The affiliate lead REVEAL — the most sensitive CRM mutation
 * shipped so far — went further and validates the token, and the CRM client
 * already carries the plumbing for it (`csrfHeaders()` in
 * `application/api/auth-client.ts`, treating an unavailable token as a hard
 * local failure). This endpoint follows the reveal, not the notes: it is the
 * only CRM mutation that changes what a learner has completed, and it is worth
 * the one extra header. No third posture is invented — this is the stricter of
 * the repository's two existing ones.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { STABLE_CODE_PATTERN } from "@/lib/curriculum/constants";
import { PROGRESSION_ADJUSTMENT_REASON_CODES } from "@/lib/curriculum/constants";
import {
  PROGRESSION_ADJUSTMENT_REASON_TEXT_MAX,
  PROGRESSION_ADJUSTMENT_REASON_TEXT_MIN,
  PROGRESSION_ADJUSTMENT_REQUEST_ID_PATTERN,
  isProgressionAdjustmentError,
  type ProgressionAdjustmentErrorCode,
} from "@/lib/curriculum/progression-adjustment";
import { canOverrideProgression, canViewProgression, type CrmPermission } from "@/lib/crm/roles";
import { CrmAuthError, crmRequestId, resolveCrmSession } from "@/lib/crm/session";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";

export const PROGRESSION_NO_STORE = { "Cache-Control": "no-store" } as const;

/** Per-operator, and generous enough that a legitimate session never meets it. */
const OPERATOR_LIMIT = { limit: 60, windowMs: 10 * 60 * 1000 };

export class ProgressionHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.name = "ProgressionHttpError";
    this.status = status;
    this.code = code;
  }
}

export type ProgressionGate = {
  readonly actorStaffProfileId: string;
  readonly actorUserId: number;
  readonly permissions: readonly CrmPermission[];
};

/**
 * Resolve the operator and check ONE capability.
 *
 * `mutation` additionally validates CSRF and rate-limits. The permission check
 * happens before either, so an unauthorized caller learns nothing about which
 * limits exist.
 */
export async function requireProgressionStaff(
  request: Request,
  capability: "read" | "override",
): Promise<ProgressionGate> {
  const session = await resolveCrmSession();
  const permissions = session.effectivePermissions;
  const allowed =
    capability === "override"
      ? canOverrideProgression(permissions)
      : canViewProgression(permissions);
  if (!allowed) {
    // 403 without naming the missing permission: the envelope must not become a
    // map of the permission model for a caller who may not have it.
    throw new ProgressionHttpError(403, "PROGRESSION_ADJUST_FORBIDDEN");
  }

  const profile = await prisma.staffProfile.findUnique({
    where: { id: session.employeeId },
    select: { id: true, userId: true },
  });
  if (!profile) {
    throw new ProgressionHttpError(403, "PROGRESSION_ADJUST_FORBIDDEN");
  }

  if (capability === "override") {
    const limit = rateLimit(`crm:progression-adjust:${profile.id}`, OPERATOR_LIMIT);
    if (!limit.allowed) {
      throw new ProgressionHttpError(429, "PROGRESSION_ADJUST_RATE_LIMITED");
    }
  }

  return {
    actorStaffProfileId: profile.id,
    actorUserId: profile.userId,
    permissions,
  };
}

/** Mutations validate the CSRF token; reads never do. */
export async function assertProgressionCsrf(request: Request): Promise<NextResponse | null> {
  if (validateCsrfToken(request)) return null;
  return csrfFailureResponse(request);
}

const DOMAIN_STATUS: Record<ProgressionAdjustmentErrorCode, number> = {
  PROGRESSION_ADJUST_DISABLED: 409,
  PROGRESSION_ADJUST_INPUT_INVALID: 400,
  PROGRESSION_ADJUST_FORBIDDEN: 403,
  PROGRESSION_ADJUST_LEARNER_NOT_FOUND: 404,
  PROGRESSION_ADJUST_LEARNER_INACTIVE: 409,
  PROGRESSION_ADJUST_NOT_ENROLLED: 409,
  PROGRESSION_ADJUST_WRONG_CURRICULUM: 409,
  PROGRESSION_ADJUST_TARGET_INVALID: 400,
  PROGRESSION_ADJUST_NO_CHANGE: 409,
  PROGRESSION_ADJUST_BACKWARD_UNSUPPORTED: 409,
  PROGRESSION_ADJUST_GATE_LEVEL_REFUSED: 409,
  PROGRESSION_ADJUST_STALE_STATE: 409,
  PROGRESSION_ADJUST_REQUEST_CONFLICT: 409,
  PROGRESSION_ADJUST_STATE_CORRUPT: 409,
  PROGRESSION_ADJUST_INTERNAL_ERROR: 500,
};

export function progressionData(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: PROGRESSION_NO_STORE });
}

/**
 * The one error envelope. A Zod issue, a Prisma error, a stack, a SQL fragment,
 * a role name and a permission name are all absent by construction.
 */
export function progressionErrorResponse(error: unknown, context: string) {
  const requestId = crmRequestId();
  const headers = { ...PROGRESSION_NO_STORE, "X-Request-Id": requestId };

  if (error instanceof CrmAuthError) {
    return NextResponse.json(
      { code: error.code, messageKey: error.messageKey, requestId },
      { status: error.status, headers },
    );
  }
  if (error instanceof ProgressionHttpError) {
    return NextResponse.json({ code: error.code, requestId }, { status: error.status, headers });
  }
  if (isProgressionAdjustmentError(error)) {
    const status = DOMAIN_STATUS[error.code] ?? 500;
    if (status === 500) {
      console.error(`${context}: internal error`);
      return NextResponse.json(
        { code: "PROGRESSION_ADJUST_INTERNAL_ERROR", requestId },
        { status: 500, headers },
      );
    }
    return NextResponse.json(
      {
        code: error.code,
        blockingLevelNumber: error.blockingLevelNumber,
        requestId,
      },
      { status, headers },
    );
  }
  console.error(`${context}: internal error`);
  return NextResponse.json(
    { code: "PROGRESSION_ADJUST_INTERNAL_ERROR", requestId },
    { status: 500, headers },
  );
}

export function parseLearnerUserId(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== raw) {
    throw new ProgressionHttpError(400, "PROGRESSION_ADJUST_INPUT_INVALID");
  }
  return parsed;
}

export function assertNoQueryParams(request: Request): void {
  if (new URL(request.url).searchParams.size !== 0) {
    throw new ProgressionHttpError(400, "PROGRESSION_ADJUST_INPUT_INVALID");
  }
}

export async function parseStrictJson<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    const text = await request.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new ProgressionHttpError(400, "PROGRESSION_ADJUST_INPUT_INVALID");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ProgressionHttpError(400, "PROGRESSION_ADJUST_INPUT_INVALID");
  }
  return parsed.data;
}

export const previewBodySchema = z.strictObject({
  targetStableCode: z.string().regex(STABLE_CODE_PATTERN),
});

export const adjustBodySchema = z.strictObject({
  targetStableCode: z.string().regex(STABLE_CODE_PATTERN),
  expectedCurrentLevel: z.number().int().positive(),
  expectedCurriculumVersionId: z.number().int().positive(),
  reasonCode: z.enum(PROGRESSION_ADJUSTMENT_REASON_CODES),
  reasonText: z
    .string()
    .trim()
    .min(PROGRESSION_ADJUSTMENT_REASON_TEXT_MIN)
    .max(PROGRESSION_ADJUSTMENT_REASON_TEXT_MAX),
  referenceId: z.string().min(1).max(128).nullish(),
  requestId: z.string().regex(PROGRESSION_ADJUSTMENT_REQUEST_ID_PATTERN),
});
