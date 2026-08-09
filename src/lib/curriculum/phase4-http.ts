import { NextResponse } from "next/server";
import { z } from "zod";
import { apiAuthErrorResponse, rateLimitedResponse, requireAdmin, requireUser } from "@/lib/apiAuth";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { AssessmentDomainError } from "./assessment-errors";
import { authoringErrorStatus, isAuthoringDomainError } from "./authoring-errors";
import { gateCurriculumAuthoring } from "./authoring-authorization";
import { AssessmentRuntimeError } from "./assessment-runtime";
import { ContentDomainError } from "./content-errors";
import { CurriculumDomainError } from "./errors";
import { LessonProgressDomainError } from "./content-read-progress";
import { isLevelStartDomainError } from "./level-state";
import {
  isManualCompletionError,
  type ManualCompletionErrorCode,
} from "./manual-completion";
import {
  isCurriculumV2AdminEnabled,
  isCurriculumV2AssessmentEnabled,
  isCurriculumV2ContentEnabled,
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
} from "@/lib/env";
import { rateLimit } from "@/lib/rateLimit";

export const PHASE4_NO_STORE = { "Cache-Control": "no-store" } as const;
export type Phase4Profile = "content" | "assessment";

function withNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function phase4Data(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: PHASE4_NO_STORE });
}

export function phase4Error(error: string, status: number, issues?: unknown[]) {
  return NextResponse.json(
    issues && issues.length ? { error, issues } : { error },
    { status, headers: PHASE4_NO_STORE },
  );
}

export function phase4Disabled() {
  return phase4Error("NOT_FOUND", 404);
}

function profileEnabled(profile: Phase4Profile) {
  return profile === "content"
    ? isCurriculumV2ContentEnabled()
    : isCurriculumV2AssessmentEnabled();
}

/**
 * What a passed gate hands the route: the SERVER-derived actor and nothing
 * else. Exported so the route module can name it without spelling an authority
 * field of its own — the accepted surface guard reads that module for
 * caller-shaped authority names, and it should keep being able to.
 */
export type Phase4GrantedGate = { ok: true; actorId: number };

type AdminGate = Phase4GrantedGate | { ok: false; response: NextResponse };

export async function gatePhase4Admin(
  request: Request,
  profile: Phase4Profile,
  write: boolean,
): Promise<AdminGate> {
  if (!isCurriculumV2AdminEnabled() || !profileEnabled(profile)) {
    return { ok: false, response: phase4Disabled() };
  }
  try {
    const admin = await requireAdmin();
    const limit = rateLimit(`curriculum:admin:${admin.id}`, {
      limit: 200,
      windowMs: 10 * 60 * 1000,
    });
    if (!limit.allowed) return { ok: false, response: withNoStore(rateLimitedResponse()) };
    if (write && !validateCsrfToken(request)) {
      return { ok: false, response: withNoStore(await csrfFailureResponse(request)) };
    }
    return { ok: true, actorId: admin.id };
  } catch (error) {
    return { ok: false, response: withNoStore(await apiAuthErrorResponse(error, request)) };
  }
}

/**
 * PHASE-G1 — the SAME accepted endpoints, reachable by curriculum staff.
 *
 * G0 built `gateCurriculumAuthoring` and wired it to nothing: the 87 accepted
 * `/api/admin/curriculum/**` endpoints still demanded `UserRole=admin`, so the
 * Studio's content team could not read a lesson, let alone edit one. The naive
 * fixes were both rejected in G0 and are still wrong — promoting content staff
 * to `UserRole=admin` hands them every unrelated admin endpoint, and cloning the
 * endpoints under `/api/crm/**` gives one domain two owners.
 *
 * So this gate delegates to the accepted bridge, which accepts EITHER
 * `UserRole=admin` (PATH A, byte-identical to today for every existing
 * integration) OR a StaffProfile whose stored role grants the specific
 * permission. Nothing is widened: a `content_manager` reaching these routes
 * still gains nothing outside curriculum authoring and is refused by every other
 * `/api/admin/**` route exactly as before.
 *
 * WHICH ROUTES GET IT, AND WHICH DELIBERATELY DO NOT. This gate is applied to
 * the SUBSTANTIVE AUTHORING operations only — version, localization, asset,
 * question and question-localization reads and writes, which is what the Studio
 * edits. `publish`, `archive`, `content-binding` and `assessment-binding` keep
 * `gatePhase4Admin`: publication is a runtime activation and a binding is
 * product structure, and §35 is explicit that an ordinary content editor gets
 * neither. Both gates read the same flags, so nothing about activation changes.
 *
 * The capability follows the METHOD: a read needs `curriculum_read`, a write
 * needs `curriculum_author`. CSRF and the per-actor rate limit are the accepted
 * bridge's, not a second implementation.
 */
export async function gatePhase4Authoring(
  request: Request,
  profile: Phase4Profile,
  write: boolean,
): Promise<AdminGate> {
  if (!isCurriculumV2AdminEnabled() || !profileEnabled(profile)) {
    return { ok: false, response: phase4Disabled() };
  }
  const gate = await gateCurriculumAuthoring(request, write ? "author" : "read");
  if (!gate.ok) return { ok: false, response: gate.response };
  return { ok: true, actorId: gate.actor.actorId };
}

type SelfGate =
  | { ok: true; actorId: number }
  | { ok: false; response: NextResponse };

export async function gatePhase4Self(
  request: Request,
  profile: Phase4Profile,
  write: boolean,
): Promise<SelfGate> {
  if (!isCurriculumV2ReadEnabled() || !isCurriculumV2EnrollmentEnabled() || !profileEnabled(profile)) {
    return { ok: false, response: phase4Disabled() };
  }
  try {
    const user = await requireUser();
    if (write) {
      const limit = rateLimit(`curriculum:self:mutation:${user.id}`, {
        limit: 100,
        windowMs: 10 * 60 * 1000,
      });
      if (!limit.allowed) return { ok: false, response: withNoStore(rateLimitedResponse()) };
      if (!validateCsrfToken(request)) {
        return { ok: false, response: withNoStore(await csrfFailureResponse(request)) };
      }
    }
    return { ok: true, actorId: user.id };
  } catch (error) {
    return { ok: false, response: withNoStore(await apiAuthErrorResponse(error, request)) };
  }
}

export function positivePathId(raw: string, reference = "id") {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Phase4HttpError("INPUT_INVALID", 400, [{ code: "INPUT_INVALID", reference }]);
  }
  return value;
}

export function strictQuery(request: Request, allowed: readonly string[]) {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (!allowed.includes(key)) {
      throw new Phase4HttpError("INVALID_QUERY", 400, [{ code: "INPUT_INVALID", reference: key }]);
    }
  }
  return params;
}

export async function jsonBody(request: Request) {
  const text = await request.text();
  if (!text.trim()) return {};
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

export function strictBody<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Phase4HttpError("INPUT_INVALID", 400, parsed.error.issues.map((issue) => ({
      code: "INPUT_INVALID",
      reference: issue.path.join(".") || "body",
      message: issue.message,
    })));
  }
  return parsed.data;
}

export function idempotencyKey(request: Request) {
  const key = request.headers.get("Idempotency-Key");
  if (!key || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/.test(key)) {
    throw new Phase4HttpError("IDEMPOTENCY_KEY_INVALID", 400, [
      { code: "INPUT_INVALID", reference: "Idempotency-Key" },
    ]);
  }
  return key;
}

export class Phase4HttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly issues: unknown[] = [],
  ) { super(code); }
}

const conflict = new Set([
  "CONFLICT", "STALE", "IMMUTABLE", "VERSION_MISMATCH", "IDEMPOTENCY_CONFLICT",
  "CONTENT_VERSION_CONFLICT", "CONTENT_VERSION_NOT_DRAFT", "CONTENT_PUBLISHED_IMMUTABLE",
  "CONTENT_ARCHIVED_IMMUTABLE", "CONTENT_REPLACEMENT_REQUIRED", "CONTENT_REPLACEMENT_MISMATCH",
  "CONTENT_LOCALIZATION_CONFLICT", "CONTENT_ASSET_CONFLICT", "CONTENT_BINDING_CONFLICT",
  "CONTENT_VERSION_MISMATCH", "CONTENT_NOT_EMPTY", "CONTENT_NO_CHANGES",
  "ASSESSMENT_VERSION_CONFLICT", "ASSESSMENT_VERSION_NOT_DRAFT", "ASSESSMENT_PUBLISHED_IMMUTABLE",
  "ASSESSMENT_ARCHIVED_IMMUTABLE", "ASSESSMENT_QUESTION_CONFLICT", "ASSESSMENT_LOCALIZATION_CONFLICT",
  "ASSESSMENT_REPLACEMENT_REQUIRED", "ASSESSMENT_REPLACEMENT_MISMATCH", "ASSESSMENT_BINDING_CONFLICT",
  "ASSESSMENT_VERSION_MISMATCH", "ASSESSMENT_NOT_EMPTY", "ASSESSMENT_NO_CHANGES",
  "ASSESSMENT_ATTEMPT_CONFLICT", "ASSESSMENT_ATTEMPT_IMMUTABLE", "ASSESSMENT_SUBMISSION_CONFLICT",
  "ASSESSMENT_STATE_CORRUPT", "CONTENT_STATE_CORRUPT",
]);

const notFound = new Set([
  "CONTENT_LEVEL_NOT_FOUND", "CONTENT_VERSION_NOT_FOUND", "CONTENT_LOCALIZATION_NOT_FOUND",
  "CONTENT_ASSET_NOT_FOUND", "CONTENT_BINDING_NOT_FOUND", "ASSESSMENT_LEVEL_NOT_FOUND",
  "ASSESSMENT_VERSION_NOT_FOUND", "ASSESSMENT_QUESTION_NOT_FOUND", "ASSESSMENT_LOCALIZATION_NOT_FOUND",
  "ASSESSMENT_BINDING_NOT_FOUND", "ASSESSMENT_ATTEMPT_NOT_FOUND", "CONTENT_LEVEL_NOT_FOUND",
]);

const forbidden = new Set(["CONTENT_ACTOR_FORBIDDEN", "ASSESSMENT_ACTOR_FORBIDDEN", "CONTENT_USER_NOT_FOUND", "ASSESSMENT_USER_NOT_FOUND"]);
const unprocessable = new Set(["CONTENT_PUBLICATION_INVALID", "ASSESSMENT_PUBLICATION_INVALID"]);

/**
 * A1 — manual completion refusals.
 *
 * Every code has its own status because every one is a different fact the
 * client has to act on differently: 404 means the feature or the level is not
 * there, 403 means the actor may not act at all, 409 means the learner is not
 * where they think they are (or somebody already finished this), and 400 means
 * the request itself was malformed. Collapsing them would make "you already
 * completed this" indistinguishable from "you cannot complete this".
 */
const MANUAL_COMPLETION_STATUS: Record<ManualCompletionErrorCode, number> = {
  MANUAL_COMPLETION_DISABLED: 404,
  MANUAL_COMPLETION_INPUT_INVALID: 400,
  MANUAL_COMPLETION_FORBIDDEN: 403,
  MANUAL_COMPLETION_NOT_ENROLLED: 409,
  MANUAL_COMPLETION_LEVEL_NOT_FOUND: 404,
  MANUAL_COMPLETION_LEVEL_WRONG_OWNER: 409,
  MANUAL_COMPLETION_LEVEL_NOT_CURRENT: 409,
  MANUAL_COMPLETION_LEVEL_NOT_STARTED: 409,
  MANUAL_COMPLETION_REQUEST_CONFLICT: 409,
  MANUAL_COMPLETION_STATE_CORRUPT: 409,
  MANUAL_COMPLETION_INTERNAL_ERROR: 500,
};

export function phase4Exception(error: unknown, label = "phase4 api") {
  if (error instanceof Phase4HttpError) return phase4Error(error.code, error.status, error.issues);
  // PHASE-G0 CORRECTION — the aggregate authoring boundary now refuses writes on
  // these accepted routes, so its vocabulary has to reach the client with the
  // right status instead of falling through to a 500. `authoringErrorStatus` is
  // the SAME mapping the authoring domain already declares: 409 for a genuine
  // concurrency loss or an immutable state, 403 for self-approval, 422 for a
  // validation refusal. `actualRevision` travels with a conflict so an editor
  // can reload and re-apply rather than guess.
  if (isAuthoringDomainError(error)) {
    const status = authoringErrorStatus(error.code);
    const issues = error.issues.length > 0 ? error.issues : undefined;
    if (error.actualRevision !== null) {
      return NextResponse.json(
        issues
          ? { error: error.code, actualRevision: error.actualRevision, issues }
          : { error: error.code, actualRevision: error.actualRevision },
        { status, headers: PHASE4_NO_STORE },
      );
    }
    return phase4Error(error.code, status, issues);
  }
  if (isManualCompletionError(error)) {
    const status = MANUAL_COMPLETION_STATUS[error.code] ?? 500;
    if (status === 500) {
      console.error(`${label} internal error`);
      return phase4Error("MANUAL_COMPLETION_INTERNAL_ERROR", 500);
    }
    return phase4Error(error.code, status);
  }
  if (error instanceof ContentDomainError || error instanceof AssessmentDomainError || error instanceof CurriculumDomainError) {
    const code = error.code;
    const status = notFound.has(code) ? 404 : forbidden.has(code) ? 403 : conflict.has(code) ? 409 : unprocessable.has(code) ? 422 : code.endsWith("INPUT_INVALID") ? 400 : code.endsWith("DISABLED") ? 404 : code.endsWith("INTERNAL_ERROR") ? 500 : 409;
    const issues = "issues" in error ? error.issues : [];
    return phase4Error(code, status, issues);
  }
  if (isLevelStartDomainError(error)) {
    // Starting a level fails for exactly three reasons, and the status has to
    // tell them apart: the feature is off (404, indistinguishable from a route
    // that does not exist), the actor may not act at all (403), or the learner
    // is simply not standing where they think they are (409). The last one is
    // the common case and is NOT an error condition of the system — it is a
    // true statement about the learner's position, which is why the blockers
    // the resolver produced travel with it. They are a closed vocabulary of
    // codes and carry nothing identifying.
    const code = error.code;
    const status = code.endsWith("DISABLED")
      ? 404
      : code === "LEVEL_START_LEVEL_NOT_FOUND"
        ? 404
        : code === "LEVEL_START_USER_NOT_FOUND" ||
            code === "LEVEL_START_USER_INACTIVE" ||
            code === "LEVEL_START_LOCKED"
          ? 403
          : 409;
    return phase4Error(code, status, error.blockers);
  }
  if (error instanceof LessonProgressDomainError || error instanceof AssessmentRuntimeError) {
    const code = error.code;
    const status = code.includes("INPUT") || code.includes("SUBMISSION_INVALID") ? 400 : notFound.has(code) ? 404 : forbidden.has(code) ? 403 : conflict.has(code) || code.includes("CORRUPT") ? 409 : code.includes("DISABLED") ? 404 : code.includes("NOT_ENROLLED") || code.includes("NOT_STARTED") || code.includes("LOCKED") ? 409 : code.includes("LIMIT") ? 409 : 500;
    return phase4Error(code, status);
  }
  console.error(`${label} internal error`);
  return phase4Error("INTERNAL_ERROR", 500);
}
