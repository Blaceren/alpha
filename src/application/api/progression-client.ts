/**
 * PHASE-1 ADMIN — the three progression clients.
 *
 *   GET  /api/crm/v1/users/{userId}/progression          canonical V2 snapshot
 *   POST /api/crm/v1/users/{userId}/progression/preview  consequences, pure
 *   POST /api/crm/v1/users/{userId}/progression/adjust   the correction
 *
 * Relative paths only, exactly like every other CRM api-mode client: the browser
 * never learns the backend origin, the Next rewrite maps these paths
 * server-side, and the session cookie stays host-only with no CORS involved.
 *
 * A MISSING CSRF TOKEN IS A HARD LOCAL FAILURE on both POSTs. If `csrfHeaders()`
 * cannot supply one the request is abandoned before it is made rather than sent
 * without it — the same posture as the affiliate lead reveal, and for a stronger
 * reason: this is the only CRM mutation that changes what a learner has
 * completed.
 *
 * EVERY RESPONSE IS VALIDATED before it is returned. There is no fallback data
 * and no partial render: if we cannot parse what the backend said, nothing is
 * shown and nothing is reported as changed.
 */
import { z } from "zod";
import { csrfHeaders } from "@/application/api/auth-client";

export const PROGRESSION_TIMEOUT_MS = 12_000;

export const PROGRESSION_REASON_CODES = [
  "preprod_qa",
  "support_correction",
  "state_recovery",
  "data_correction",
  "other",
] as const;
export type ProgressionReasonCode = (typeof PROGRESSION_REASON_CODES)[number];

export const PROGRESSION_REASON_LABEL: Record<ProgressionReasonCode, string> = {
  preprod_qa: "PREPROD QA",
  support_correction: "Исправление по обращению",
  state_recovery: "Восстановление состояния",
  data_correction: "Исправление данных",
  other: "Другое",
};

const levelSchema = z.object({
  levelNumber: z.number().int().positive(),
  stableCode: z.string(),
  title: z.string(),
  type: z.string(),
  completionMethod: z.string(),
  xpReward: z.number().int().nonnegative(),
});

export const progressionSnapshotSchema = z.union([
  z.object({ kind: z.literal("not_enrolled"), learnerUserId: z.number().int() }),
  z.object({
    kind: z.literal("enrolled"),
    learnerUserId: z.number().int(),
    enrollmentId: z.number().int(),
    enrollmentStatus: z.string(),
    curriculumCode: z.string(),
    curriculumVersionId: z.number().int(),
    curriculumVersionNumber: z.number().int(),
    curriculumStatus: z.string(),
    totalLevels: z.number().int(),
    highestCompletedLevel: z.number().int(),
    currentLevel: z.number().int(),
    currentLevelDefinition: levelSchema.nullable(),
    completedLevelCount: z.number().int(),
    xpTotal: z.number().int().nullable(),
    toolsUnlockedCount: z.number().int(),
    toolsTotal: z.number().int(),
    consistent: z.boolean(),
    levels: z.array(
      levelSchema.extend({
        status: z.enum(["none", "in_progress", "pending_review", "completed"]),
      }),
    ),
  }),
]);

export type ProgressionSnapshot = z.infer<typeof progressionSnapshotSchema>;
export type ProgressionSnapshotEnrolled = Extract<ProgressionSnapshot, { kind: "enrolled" }>;

export const progressionPlanSchema = z.object({
  learnerUserId: z.number().int(),
  enrollmentId: z.number().int(),
  curriculumCode: z.string(),
  curriculumVersionId: z.number().int(),
  curriculumVersionNumber: z.number().int(),
  totalLevels: z.number().int(),
  fromCurrentLevel: z.number().int(),
  fromHighestCompletedLevel: z.number().int(),
  targetCurrentLevel: z.number().int(),
  targetStableCode: z.string(),
  levels: z.array(
    levelSchema.extend({
      currentStatus: z.enum(["none", "in_progress", "pending_review", "completed"]),
    }),
  ),
  xpTotal: z.number().int().nonnegative(),
  toolsUnlocked: z.array(z.string()),
  communitySpacesOpened: z.array(z.string()),
  warnings: z.array(z.string()),
  blocker: z
    .object({
      levelNumber: z.number().int(),
      stableCode: z.string(),
      title: z.string(),
      type: z.string(),
      reason: z.string(),
    })
    .nullable(),
  canApply: z.boolean(),
  refusalCode: z.string().nullable(),
});

export type ProgressionPlan = z.infer<typeof progressionPlanSchema>;

export const progressionReceiptSchema = z.object({
  created: z.boolean(),
  learnerUserId: z.number().int(),
  enrollmentId: z.number().int(),
  curriculumVersionId: z.number().int(),
  fromCurrentLevel: z.number().int(),
  toCurrentLevel: z.number().int(),
  levelsCompleted: z.array(z.number().int()),
  xpAwarded: z.number().int(),
  xpTransactionIds: z.array(z.number().int()),
  auditLogId: z.number().int(),
  adjustedAt: z.string(),
});

export type ProgressionReceipt = z.infer<typeof progressionReceiptSchema>;

export type ProgressionOutcome<T> =
  | { status: "success"; data: T }
  | { status: "invalid_input"; code?: string; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; requestId?: string }
  | { status: "not_found"; requestId?: string }
  /** A typed domain refusal — backward, protected gate, stale state, conflict. */
  | { status: "refused"; code: string; blockingLevelNumber?: number | null; requestId?: string }
  | { status: "rate_limited"; requestId?: string }
  | { status: "csrf_unavailable" }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export type ProgressionRequestOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function progressionEndpoint(userId: string, suffix = ""): string {
  return `/api/crm/v1/users/${encodeURIComponent(userId)}/progression${suffix}`;
}

const errorEnvelopeSchema = z.object({
  code: z.string().optional(),
  blockingLevelNumber: z.number().int().nullish(),
  requestId: z.string().optional(),
});

async function progressionRequest<T>(
  url: string,
  init: RequestInit,
  schema: z.ZodType<T>,
  options: ProgressionRequestOptions,
): Promise<ProgressionOutcome<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? PROGRESSION_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    return { status: "upstream_unavailable" };
  } finally {
    clearTimeout(timer);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const envelope = errorEnvelopeSchema.safeParse(payload);
  const requestId = envelope.success ? envelope.data.requestId : undefined;

  if (response.ok) {
    // The envelope is unwrapped before validation rather than being described as
    // `z.object({ data: schema })`: a generic `ZodType<T>` nested inside an
    // object literal loses its own output type, and the resulting `T | undefined`
    // would have to be cast away — which is exactly the kind of cast that lets a
    // malformed response through later.
    if (payload === null || typeof payload !== "object" || !("data" in payload)) {
      return { status: "malformed_response" };
    }
    const body = schema.safeParse((payload as { data: unknown }).data);
    if (!body.success) return { status: "malformed_response" };
    return { status: "success", data: body.data };
  }
  if (response.status === 401) return { status: "unauthenticated", requestId };
  if (response.status === 403) return { status: "forbidden", requestId };
  if (response.status === 404) return { status: "not_found", requestId };
  if (response.status === 429) return { status: "rate_limited", requestId };
  if (response.status === 400) {
    return {
      status: "invalid_input",
      code: envelope.success ? envelope.data.code : undefined,
      requestId,
    };
  }
  if (response.status === 409) {
    return {
      status: "refused",
      code: (envelope.success && envelope.data.code) || "PROGRESSION_ADJUST_STATE_CORRUPT",
      blockingLevelNumber: envelope.success ? envelope.data.blockingLevelNumber ?? null : null,
      requestId,
    };
  }
  return { status: "upstream_unavailable" };
}

export async function fetchProgression(
  userId: string,
  options: ProgressionRequestOptions = {},
): Promise<ProgressionOutcome<ProgressionSnapshot>> {
  return progressionRequest(
    progressionEndpoint(userId),
    { method: "GET" },
    progressionSnapshotSchema,
    options,
  );
}

export async function previewProgression(
  userId: string,
  targetStableCode: string,
  options: ProgressionRequestOptions = {},
): Promise<ProgressionOutcome<ProgressionPlan>> {
  const headers = await csrfHeaders({ fetchImpl: options.fetchImpl });
  if (!headers["x-csrf-token"]) return { status: "csrf_unavailable" };
  return progressionRequest(
    progressionEndpoint(userId, "/preview"),
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ targetStableCode }),
    },
    progressionPlanSchema,
    options,
  );
}

export type AdjustProgressionBody = {
  targetStableCode: string;
  expectedCurrentLevel: number;
  expectedCurriculumVersionId: number;
  reasonCode: ProgressionReasonCode;
  reasonText: string;
  referenceId?: string | null;
  requestId: string;
};

export async function adjustProgression(
  userId: string,
  body: AdjustProgressionBody,
  options: ProgressionRequestOptions = {},
): Promise<ProgressionOutcome<ProgressionReceipt>> {
  const headers = await csrfHeaders({ fetchImpl: options.fetchImpl });
  if (!headers["x-csrf-token"]) return { status: "csrf_unavailable" };
  return progressionRequest(
    progressionEndpoint(userId, "/adjust"),
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        ...body,
        referenceId: body.referenceId?.trim() ? body.referenceId.trim() : null,
      }),
    },
    progressionReceiptSchema,
    options,
  );
}

/**
 * A stable, client-generated request identity.
 *
 * Generated ONCE per attempt and reused across retries of that attempt, so a
 * double-click or a browser retry replays instead of correcting twice. A new
 * attempt gets a new identity, which is what makes a genuine second correction
 * possible.
 */
export function newProgressionRequestId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(16).slice(2).padEnd(16, "0");
  return `crm-progression-${random}`.slice(0, 128);
}
