import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireAdmin,
} from "@/lib/apiAuth";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { CurriculumDomainError } from "@/lib/curriculum/errors";
import type { CurriculumDomainErrorCode } from "@/lib/curriculum/errors";
import { isCurriculumV2AdminEnabled } from "@/lib/env";
import { rateLimit } from "@/lib/rateLimit";

// HTTP glue for the feature-gated V2 curriculum admin API.

export const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export function curriculumFeatureDisabledResponse() {
  // Deliberately indistinguishable from a missing route.
  return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}

export type CurriculumReadErrorCode =
  | "INVALID_QUERY"
  | "CURRICULUM_STATE_CORRUPT"
  | "XP_STATE_CORRUPT"
  | "INTERNAL_ERROR";

const CURRICULUM_READ_STATUS: Record<CurriculumReadErrorCode, number> = {
  INVALID_QUERY: 400,
  CURRICULUM_STATE_CORRUPT: 409,
  XP_STATE_CORRUPT: 409,
  INTERNAL_ERROR: 500,
};

// Shared safe mapper for self-service curriculum reads. Callers may pass only
// stable issue codes; database errors, cursor contents and internal messages
// are never serialized.
export function curriculumReadErrorResponse(
  code: CurriculumReadErrorCode,
  issueCode?: string,
) {
  const body =
    issueCode && code === "CURRICULUM_STATE_CORRUPT"
      ? { error: code, reason: issueCode, issues: [{ code: issueCode }] }
      : issueCode && code !== "INTERNAL_ERROR"
        ? { error: code, issues: [{ code: issueCode }] }
        : { error: code };
  return NextResponse.json(body, {
    status: CURRICULUM_READ_STATUS[code],
    headers: NO_STORE_HEADERS,
  });
}

type AdminUser = Awaited<ReturnType<typeof requireAdmin>>;

type GateResult =
  | { ok: true; admin: AdminUser }
  | { ok: false; response: NextResponse };

// One shared rate-limit bucket per admin covers EVERY curriculum admin
// mutation, so the limit cannot be bypassed by rotating routes or resource
// IDs. rateKey is accepted for readability/telemetry but never widens the
// bucket. Limit sized to leave admin authoring flows comfortable headroom
// while still tripping under sustained hammering.
const CURRICULUM_ADMIN_WRITE_LIMIT = 50;

// Write-request order: feature flag -> authentication -> active admin ->
// rate limit -> CSRF. Body validation and domain calls happen in the route.
export async function gateCurriculumAdmin(
  request: Request,
  options: { write: boolean; rateKey?: string } = { write: false },
): Promise<GateResult> {
  if (!isCurriculumV2AdminEnabled()) {
    return { ok: false, response: curriculumFeatureDisabledResponse() };
  }

  let admin: AdminUser;
  try {
    admin = await requireAdmin();
  } catch (error) {
    return { ok: false, response: await apiAuthErrorResponse(error, request) };
  }

  if (options.write) {
    const limit = rateLimit(`curriculum:admin:write:${admin.id}`, {
      limit: CURRICULUM_ADMIN_WRITE_LIMIT,
      windowMs: 10 * 60 * 1000,
    });
    if (!limit.allowed) {
      return { ok: false, response: rateLimitedResponse() };
    }

    if (!validateCsrfToken(request)) {
      return { ok: false, response: await csrfFailureResponse(request) };
    }
  }

  return { ok: true, admin };
}

const HTTP_STATUS_BY_CODE: Record<CurriculumDomainErrorCode, number> = {
  CURRICULUM_INPUT_INVALID: 400,
  CURRICULUM_ACTOR_FORBIDDEN: 403,
  CURRICULUM_NOT_FOUND: 404,
  MODULE_NOT_FOUND: 404,
  LEVEL_NOT_FOUND: 404,
  CURRICULUM_INVALID: 422,
  CURRICULUM_EFFECTIVE_FROM_FUTURE: 422,
  CURRICULUM_CONFLICT: 409,
  CURRICULUM_NOT_EMPTY: 409,
  CURRICULUM_NOT_DRAFT: 409,
  CURRICULUM_NOT_PUBLISHED: 409,
  CURRICULUM_PUBLISHED_IMMUTABLE: 409,
  CURRICULUM_ARCHIVED_IMMUTABLE: 409,
  CURRICULUM_REPLACEMENT_REQUIRED: 409,
  CURRICULUM_REPLACEMENT_MISMATCH: 409,
  CURRICULUM_NO_CHANGES: 409,
  MODULE_CONFLICT: 409,
  MODULE_NOT_EMPTY: 409,
  MODULE_VERSION_MISMATCH: 409,
  MODULE_NO_CHANGES: 409,
  LEVEL_CONFLICT: 409,
  LEVEL_NO_CHANGES: 409,
};

// Centralized domain-error -> HTTP mapper. Never leaks Prisma/SQL/stack.
export function curriculumErrorResponse(error: unknown) {
  if (error instanceof CurriculumDomainError) {
    const status = HTTP_STATUS_BY_CODE[error.code] ?? 500;
    const body =
      error.issues.length > 0
        ? { error: error.code, issues: error.issues }
        : { error: error.code };
    return NextResponse.json(body, { status });
  }

  console.error("curriculum admin api internal error", error);
  return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
}

export function parseCurriculumPathId(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new CurriculumDomainError("CURRICULUM_INPUT_INVALID", "invalid id", [
      {
        code: "INPUT_INVALID",
        entity: "curriculumVersion",
        reference: "id",
        message: "id must be a positive integer",
      },
    ]);
  }
  return value;
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseApiBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new CurriculumDomainError("CURRICULUM_INPUT_INVALID", "invalid request body",
      result.error.issues.map((issue) => ({
        code: "INPUT_INVALID",
        entity: "curriculumVersion" as const,
        reference: issue.path.join(".") || "body",
        message: issue.message,
      })),
    );
  }
  return result.data;
}

// --- API body contracts (strict: unknown keys are rejected) ---

const isoDate = z.string().datetime({ offset: true }).or(z.string().datetime());

export const createVersionBodySchema = z.strictObject({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  versionNumber: z.number().int().positive(),
  effectiveFrom: isoDate.nullable().optional(),
  changeNotes: z.string().trim().nullable().optional(),
});

export const patchVersionBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).optional(),
    effectiveFrom: isoDate.nullable().optional(),
    changeNotes: z.string().trim().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

export const publishBodySchema = z.strictObject({
  expectedPublishedVersionId: z.number().int().positive().nullable().optional(),
});

export const archiveBodySchema = z.strictObject({});

export function toEffectiveFromDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}

// --- Module body contracts ---

const nonNegativeInt = z.number().int().min(0);
const positiveInt = z.number().int().positive();
const requiredText = z.string().trim().min(1);
const optionalText = z.string().trim();

const definitionStatus = z.enum(["active", "disabled"]);

const levelTypeEnum = z.enum([
  "external_event",
  "lesson",
  "scenario",
  "practice",
  "report",
  "mentor_review",
  "financial_checkpoint",
  "final_exam",
]);

export const createModuleBodySchema = z.strictObject({
  moduleNumber: positiveInt,
  code: requiredText,
  title: requiredText,
  description: optionalText.optional(),
  firstLevel: positiveInt,
  lastLevel: positiveInt,
  checkpointLevel: positiveInt.nullable().optional(),
  learningObjective: requiredText,
  status: definitionStatus.optional(),
});

export const patchModuleBodySchema = z
  .strictObject({
    moduleNumber: positiveInt.optional(),
    code: requiredText.optional(),
    title: requiredText.optional(),
    description: optionalText.optional(),
    firstLevel: positiveInt.optional(),
    lastLevel: positiveInt.optional(),
    checkpointLevel: positiveInt.nullable().optional(),
    learningObjective: requiredText.optional(),
    status: definitionStatus.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

// --- Level body contracts (visibilityRule / contentVersionId /
// assessmentVersionId are intentionally absent, so strict parsing rejects them) ---

export const createLevelBodySchema = z.strictObject({
  moduleId: positiveInt,
  levelNumber: positiveInt,
  stableCode: requiredText,
  type: levelTypeEnum,
  title: requiredText,
  shortDescription: optionalText.optional(),
  learningObjective: requiredText,
  completionMethod: requiredText,
  xpReward: nonNegativeInt,
  requiredXp: nonNegativeInt,
  requiredPreviousLevel: positiveInt.nullable().optional(),
  requiredCheckpointLevel: positiveInt.nullable().optional(),
  featureUnlockCode: requiredText.nullable().optional(),
  status: definitionStatus.optional(),
});

export const patchLevelBodySchema = z
  .strictObject({
    moduleId: positiveInt.optional(),
    levelNumber: positiveInt.optional(),
    stableCode: requiredText.optional(),
    type: levelTypeEnum.optional(),
    title: requiredText.optional(),
    shortDescription: optionalText.optional(),
    learningObjective: requiredText.optional(),
    completionMethod: requiredText.optional(),
    xpReward: nonNegativeInt.optional(),
    requiredXp: nonNegativeInt.optional(),
    requiredPreviousLevel: positiveInt.nullable().optional(),
    requiredCheckpointLevel: positiveInt.nullable().optional(),
    featureUnlockCode: requiredText.nullable().optional(),
    status: definitionStatus.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });
