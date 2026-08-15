import type { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ApiAuthError,
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireAdmin,
  requireTaskReportReviewer,
  requireUser,
} from "@/lib/apiAuth";
import { hasCrmReviewAuthority } from "@/lib/learner-ops/review-authority";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { CurriculumDomainError } from "@/lib/curriculum/errors";
import { ReportDomainError } from "@/lib/curriculum/report-errors";
import type { ReportDomainErrorCode } from "@/lib/curriculum/report-errors";
import { isReportAttachmentScannerError } from "@/lib/curriculum/report-attachment-scanner";
import { isReportAttachmentStorageError } from "@/lib/curriculum/report-attachment-storage";
import {
  isCurriculumV2AdminEnabled,
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
  isCurriculumV2ReportAttachmentsEnabled,
  isCurriculumV2ReportEnabled,
} from "@/lib/env";
import { rateLimit } from "@/lib/rateLimit";

// HTTP glue for the feature-gated V2 report API (Phase 5B.6). Gate order is
// strict everywhere: feature flags (uniform 404 before any authentication) ->
// session -> active principal/role -> actor rate limit for mutations -> CSRF
// -> strict path/query/body validation -> domain service. Actor identity only
// ever comes from the session; every response is Cache-Control: no-store.

export const REPORT_NO_STORE = { "Cache-Control": "no-store" } as const;

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;
const SUBMISSION_REF_PATH = /^[A-Za-z0-9_-]{8,128}$/;

function withNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function reportData(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: REPORT_NO_STORE });
}

export function reportError(error: string, status: number, issues?: unknown[]) {
  return NextResponse.json(
    issues && issues.length ? { error, issues } : { error },
    { status, headers: REPORT_NO_STORE },
  );
}

// Deliberately indistinguishable from a missing route.
export function reportDisabled() {
  return reportError("NOT_FOUND", 404);
}

export class ReportHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly issues: unknown[] = [],
  ) { super(code); }
}

// --- typed error -> HTTP status ---------------------------------------------

const DOMAIN_STATUS: Record<ReportDomainErrorCode, number> = {
  REPORT_DISABLED: 404,
  REPORT_ATTACHMENTS_DISABLED: 404,
  REPORT_NOT_CONFIGURED: 404,
  REPORT_LEVEL_NOT_FOUND: 404,
  REPORT_ASSIGNMENT_NOT_FOUND: 404,
  REPORT_LOCALIZATION_NOT_FOUND: 404,
  REPORT_FIELD_NOT_FOUND: 404,
  REPORT_FIELD_LOCALIZATION_NOT_FOUND: 404,
  REPORT_RUBRIC_NOT_FOUND: 404,
  REPORT_CRITERION_NOT_FOUND: 404,
  REPORT_CRITERION_LOCALIZATION_NOT_FOUND: 404,
  REPORT_SCALE_OPTION_NOT_FOUND: 404,
  REPORT_SCALE_LOCALIZATION_NOT_FOUND: 404,
  REPORT_REASON_NOT_FOUND: 404,
  REPORT_REASON_LOCALIZATION_NOT_FOUND: 404,
  REPORT_BINDING_NOT_FOUND: 404,
  REPORT_SUBMISSION_NOT_FOUND: 404,
  REPORT_ATTACHMENT_NOT_FOUND: 404,
  REPORT_REVIEW_NOT_FOUND: 404,
  REPORT_INPUT_INVALID: 400,
  REPORT_DRAFT_INPUT_INVALID: 400,
  REPORT_ACTOR_FORBIDDEN: 403,
  REPORT_USER_NOT_FOUND: 403,
  REPORT_REVIEWER_FORBIDDEN: 403,
  REPORT_SELF_REVIEW_FORBIDDEN: 403,
  REPORT_CLAIM_NOT_OWNER: 403,
  REPORT_ASSIGNMENT_CONFLICT: 409,
  REPORT_ASSIGNMENT_NOT_DRAFT: 409,
  REPORT_PUBLISHED_IMMUTABLE: 409,
  REPORT_ARCHIVED_IMMUTABLE: 409,
  REPORT_REPLACEMENT_REQUIRED: 409,
  REPORT_REPLACEMENT_MISMATCH: 409,
  REPORT_RUBRIC_CONFLICT: 409,
  REPORT_BINDING_CONFLICT: 409,
  REPORT_VERSION_MISMATCH: 409,
  REPORT_NOT_EMPTY: 409,
  REPORT_NO_CHANGES: 409,
  REPORT_LEVEL_TYPE_INVALID: 409,
  REPORT_NOT_ENROLLED: 409,
  REPORT_LEVEL_NOT_STARTED: 409,
  REPORT_LEVEL_WRONG_TYPE: 409,
  REPORT_REVISION_CONFLICT: 409,
  REPORT_REVISION_STALE: 409,
  REPORT_IDEMPOTENCY_CONFLICT: 409,
  REPORT_SUBMISSION_IMMUTABLE: 409,
  REPORT_ALREADY_SUBMITTED: 409,
  REPORT_NOT_REJECTED: 409,
  REPORT_RESUBMISSION_REQUIRED: 409,
  REPORT_CORRECTION_REQUIRED: 409,
  REPORT_NOT_PENDING_REVIEW: 409,
  REPORT_CLAIM_CONFLICT: 409,
  REPORT_CLAIM_EXPIRED: 409,
  REPORT_ATTACHMENT_REVISION_IMMUTABLE: 409,
  REPORT_ATTACHMENT_REVISION_STALE: 409,
  REPORT_ATTACHMENT_UPLOAD_INCOMPLETE: 409,
  REPORT_ATTACHMENT_SCAN_PENDING: 409,
  REPORT_ATTACHMENT_CLEANUP_RETRY: 409,
  REPORT_STATE_CORRUPT: 409,
  REPORT_ATTACHMENT_TOO_LARGE: 413,
  REPORT_ATTACHMENT_AGGREGATE_EXCEEDED: 413,
  REPORT_ATTACHMENT_TYPE_INVALID: 415,
  REPORT_PUBLICATION_INVALID: 422,
  REPORT_LOCALIZATION_UNAVAILABLE: 422,
  REPORT_REVIEW_INPUT_INVALID: 422,
  REPORT_RUBRIC_MISMATCH: 422,
  REPORT_REASON_MISMATCH: 422,
  REPORT_ATTACHMENT_NAME_INVALID: 422,
  REPORT_ATTACHMENT_CHECKSUM_MISMATCH: 422,
  REPORT_ATTACHMENT_EMPTY: 422,
  REPORT_ATTACHMENT_COUNT_EXCEEDED: 422,
  REPORT_ATTACHMENT_SCAN_REJECTED: 422,
  REPORT_ATTACHMENT_STORAGE_UNAVAILABLE: 503,
  REPORT_ATTACHMENT_SCANNER_UNAVAILABLE: 503,
  REPORT_APPROVAL_ENGINE_UNAVAILABLE: 503,
  REPORT_INTERNAL_ERROR: 500,
};

// Centralized report error -> HTTP mapper. Permanent validation failures are
// never converted into retryable storage errors and raw Prisma/S3/ClamAV
// content, paths, env values and stacks never reach the response body.
export function reportException(error: unknown, label = "report api") {
  if (error instanceof ReportHttpError) return reportError(error.code, error.status, error.issues);
  if (error instanceof ReportDomainError) {
    const status = DOMAIN_STATUS[error.code] ?? 500;
    if (status === 500) {
      console.error(`${label} internal error`);
      return reportError("REPORT_INTERNAL_ERROR", 500);
    }
    return reportError(error.code, status, error.issues);
  }
  if (error instanceof CurriculumDomainError) {
    // Curriculum scope failures surfacing through report routes stay generic.
    return reportError("REPORT_NOT_FOUND", 404);
  }
  if (isReportAttachmentStorageError(error)) return reportError("REPORT_ATTACHMENT_STORAGE_UNAVAILABLE", 503);
  if (isReportAttachmentScannerError(error)) return reportError("REPORT_ATTACHMENT_SCANNER_UNAVAILABLE", 503);
  console.error(`${label} internal error`);
  return reportError("REPORT_INTERNAL_ERROR", 500);
}

// --- strict request parsing -------------------------------------------------

export function positiveReportPathId(raw: string, reference = "id") {
  const value = Number(raw);
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new ReportHttpError("REPORT_INPUT_INVALID", 400, [{ code: "INPUT_INVALID", reference }]);
  }
  return value;
}

// The public submission identity is the opaque submissionRef; malformed path
// values collapse into the uniform not-found so probing reveals nothing.
export function submissionRefPath(raw: string) {
  if (!SUBMISSION_REF_PATH.test(raw)) {
    throw new ReportHttpError("REPORT_NOT_FOUND", 404);
  }
  return raw;
}

export function strictReportQuery(request: Request, allowed: readonly string[]) {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (!allowed.includes(key)) {
      throw new ReportHttpError("REPORT_QUERY_INVALID", 400, [{ code: "INPUT_INVALID", reference: key }]);
    }
  }
  return params;
}

export async function reportJsonBody(request: Request) {
  const text = await request.text();
  if (!text.trim()) return {};
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

export function strictReportBody<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ReportHttpError("REPORT_INPUT_INVALID", 400, parsed.error.issues.map((issue) => ({
      code: "INPUT_INVALID",
      reference: issue.path.join(".") || "body",
      message: issue.message,
    })));
  }
  return parsed.data;
}

// Mandatory idempotency identity for every mutation with a durable receipt
// contract. Validated against a strict allowlisted charset and length.
export function reportIdempotencyKey(request: Request) {
  const key = request.headers.get("Idempotency-Key");
  if (!key || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ReportHttpError("REPORT_IDEMPOTENCY_KEY_INVALID", 400, [
      { code: "INPUT_INVALID", reference: "Idempotency-Key" },
    ]);
  }
  return key;
}

// --- gates ------------------------------------------------------------------

type GateOk = { ok: true; actorId: number; role: string };
type GateFailed = { ok: false; response: NextResponse };
export type ReportGateResult = GateOk | GateFailed;

const ADMIN_MUTATION_LIMIT = { limit: 200, windowMs: 10 * 60 * 1000 };
const SELF_MUTATION_LIMIT = { limit: 100, windowMs: 10 * 60 * 1000 };
const ATTACHMENT_MUTATION_LIMIT = { limit: 60, windowMs: 10 * 60 * 1000 };
const REVIEW_MUTATION_LIMIT = { limit: 100, windowMs: 10 * 60 * 1000 };
const DOWNLOAD_LIMIT = { limit: 120, windowMs: 10 * 60 * 1000 };

function selfFlagsEnabled() {
  return isCurriculumV2ReadEnabled() && isCurriculumV2EnrollmentEnabled() && isCurriculumV2ReportEnabled();
}

async function activePrincipal<T extends { id: number; role: UserRole; status: string }>(
  request: Request,
  authorize: () => Promise<T>,
): Promise<ReportGateResult> {
  try {
    const user = await authorize();
    if (user.status !== "active") {
      throw new ApiAuthError(403, user.id, user.role);
    }
    return { ok: true, actorId: user.id, role: user.role };
  } catch (error) {
    return { ok: false, response: withNoStore(await apiAuthErrorResponse(error, request)) };
  }
}

// Admin authoring gate: ADMIN + REPORT flags fail closed before auth; ADMIN
// does not substitute for REPORT and vice versa.
export async function gateReportAdmin(request: Request, write: boolean): Promise<ReportGateResult> {
  if (!isCurriculumV2AdminEnabled() || !isCurriculumV2ReportEnabled()) {
    return { ok: false, response: reportDisabled() };
  }
  const gate = await activePrincipal(request, requireAdmin);
  if (!gate.ok) return gate;
  if (write) {
    const limit = rateLimit(`report:admin:${gate.actorId}`, ADMIN_MUTATION_LIMIT);
    if (!limit.allowed) return { ok: false, response: withNoStore(rateLimitedResponse()) };
    if (!validateCsrfToken(request)) {
      return { ok: false, response: withNoStore(await csrfFailureResponse(request)) };
    }
  }
  return gate;
}

// Self report gate. Attachment routes additionally require the attachment
// flag and use their own shared mutation bucket.
export async function gateReportSelf(
  request: Request,
  write: boolean,
  options: { attachments?: boolean } = {},
): Promise<ReportGateResult> {
  if (!selfFlagsEnabled() || (options.attachments && !isCurriculumV2ReportAttachmentsEnabled())) {
    return { ok: false, response: reportDisabled() };
  }
  const gate = await activePrincipal(request, requireUser);
  if (!gate.ok) return gate;
  if (write) {
    const bucket = options.attachments ? `report:attachment:${gate.actorId}` : `report:self:${gate.actorId}`;
    const limit = rateLimit(bucket, options.attachments ? ATTACHMENT_MUTATION_LIMIT : SELF_MUTATION_LIMIT);
    if (!limit.allowed) return { ok: false, response: withNoStore(rateLimitedResponse()) };
    if (!validateCsrfToken(request)) {
      return { ok: false, response: withNoStore(await csrfFailureResponse(request)) };
    }
  }
  return gate;
}

// Reviewer gate. READ + ENROLLMENT + REPORT are required; the XP flag is NOT a
// reviewer-gate precondition, because approval of a zero-reward level awards no XP.
// Positive-reward XP enforcement is reward-conditional and lives in the completion
// primitive (a positive reward with XP disabled fails closed and rolls the approval
// back atomically). An incomplete flag set behaves exactly like a missing route.
export async function gateReportReviewer(
  request: Request,
  write: boolean,
): Promise<ReportGateResult> {
  if (!selfFlagsEnabled()) {
    return { ok: false, response: reportDisabled() };
  }
  const gate = await activePrincipal(request, requireTaskReportReviewer);
  if (!gate.ok) return gate;
  // LO-AUTH-AXIS-1 — the SECOND axis, intersected with the role check above.
  //
  // The `admin`/`mentor` check has already passed. This additionally requires
  // the caller's CRM StaffProfile to hold `learner_ops_report_review`, so
  // report-review authority is finally something the CRM can display, grant and
  // revoke. It is ADDITIONAL, never alternative: no caller gains review here
  // that `requireTaskReportReviewer` would have refused, so this can only
  // narrow. A caller without a StaffProfile, or whose staff role lacks the
  // permission, gets the SAME 403 shape the role check produces.
  if (!(await hasCrmReviewAuthority(gate.actorId, "report"))) {
    return {
      ok: false,
      response: withNoStore(
        await apiAuthErrorResponse(new ApiAuthError(403, gate.actorId), request),
      ),
    };
  }
  if (write) {
    const limit = rateLimit(`report:review:${gate.actorId}`, REVIEW_MUTATION_LIMIT);
    if (!limit.allowed) return { ok: false, response: withNoStore(rateLimitedResponse()) };
    if (!validateCsrfToken(request)) {
      return { ok: false, response: withNoStore(await csrfFailureResponse(request)) };
    }
  }
  return gate;
}

// Private attachment download gate (GET, no CSRF): any active session holder
// passes the gate; owner/reviewer authorization is decided by the domain
// services afterwards so unauthorized existence never leaks.
export async function gateReportDownload(request: Request): Promise<ReportGateResult> {
  if (!selfFlagsEnabled() || !isCurriculumV2ReportAttachmentsEnabled()) {
    return { ok: false, response: reportDisabled() };
  }
  const gate = await activePrincipal(request, requireUser);
  if (!gate.ok) return gate;
  const limit = rateLimit(`report:download:${gate.actorId}`, DOWNLOAD_LIMIT);
  if (!limit.allowed) return { ok: false, response: withNoStore(rateLimitedResponse()) };
  return gate;
}
