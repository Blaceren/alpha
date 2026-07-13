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

type AdminUser = Awaited<ReturnType<typeof requireAdmin>>;

type GateResult =
  | { ok: true; admin: AdminUser }
  | { ok: false; response: NextResponse };

// Write-request order: feature flag -> authentication -> active admin ->
// rate limit -> CSRF. Body validation and domain calls happen in the route.
export async function gateCurriculumAdmin(
  request: Request,
  options: { write: boolean; rateKey?: string; rateLimitMax?: number } = { write: false },
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
    const limit = rateLimit(
      `curriculum:admin:${options.rateKey ?? "write"}:${admin.id}`,
      { limit: options.rateLimitMax ?? 30, windowMs: 10 * 60 * 1000 },
    );
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
  LEVEL_CONFLICT: 409,
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
