/**
 * LEARNER-OPERATIONS-V1 — the browser client.
 *
 * RELATIVE PATHS ONLY. The browser never learns the backend origin: the Next
 * rewrite maps each allowlisted path server-side, which keeps the session
 * cookie host-only and removes any need for CORS. Every path used here appears
 * in `PROXIED_PATHS` — a path that is not allowlisted 404s at the CRM origin
 * rather than reaching the backend.
 *
 * EVERY FAILURE MAPS TO A CLOSED OUTCOME. There is no fallback data, no mock
 * fallback and no partial render: a response that fails validation reports
 * `malformed_response` and the surface shows an error, because a half-parsed
 * operational queue looks like the real backlog with rows silently missing.
 *
 * THE CLIENT IS NOT A GATE. It sends what the operator asked for; the backend
 * re-checks the identical permission on every route. Hiding a control here is a
 * convenience, never authorization.
 */
import { z } from "zod";
import {
  analyticsSchema,
  caseDetailSchema,
  configSchema,
  escalationsSchema,
  eventsPageSchema,
  knowledgeArticleSchema,
  knowledgePageSchema,
  learner360Schema,
  learnerOpsErrorSchema,
  messagesPageSchema,
  notesPageSchema,
  qaPageSchema,
  queuePageSchema,
  vocPageSchema,
} from "@/data/contracts/api/learner-ops";

export const LEARNER_OPS_ENDPOINT = "/api/crm/v1/learner-ops";
export const LEARNER_OPS_TIMEOUT_MS = 10_000;

export type Outcome<T> =
  | { status: "success"; data: T }
  | { status: "invalid_input"; detail?: string; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; requestId?: string }
  | { status: "not_found"; requestId?: string }
  | { status: "conflict"; detail?: string; requestId?: string }
  | { status: "unavailable" }
  | { status: "malformed_response" };

/**
 * The single request primitive. Everything below is a thin, typed call through
 * this one function, so timeout, abort, status mapping and validation cannot
 * differ between endpoints.
 */
async function request<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  init?: RequestInit,
): Promise<Outcome<z.infer<T>>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LEARNER_OPS_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal: controller.signal,
      // The session cookie is host-only and same-origin. `same-origin` is
      // stated rather than left to the default so a future default change
      // cannot silently start or stop sending it.
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    return { status: "unavailable" };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let requestId: string | undefined;
    let detail: string | undefined;
    try {
      const parsed = learnerOpsErrorSchema.safeParse(await response.json());
      if (parsed.success) {
        requestId = parsed.data.requestId;
        detail = parsed.data.detail ?? undefined;
      }
    } catch {
      // An unparseable error body is still an error. The status code decides.
    }
    switch (response.status) {
      case 400:
        return { status: "invalid_input", detail, requestId };
      case 401:
        return { status: "unauthenticated", requestId };
      case 403:
        return { status: "forbidden", requestId };
      case 404:
        return { status: "not_found", requestId };
      case 409:
        return { status: "conflict", detail, requestId };
      default:
        return { status: "unavailable" };
    }
  }

  try {
    const body: unknown = await response.json();
    const envelope = z.object({ data: schema }).safeParse(body);
    if (!envelope.success) return { status: "malformed_response" };
    return { status: "success", data: envelope.data.data };
  } catch {
    return { status: "malformed_response" };
  }
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

/* ------------------------------------------------------------------ reads */

export type QueueFilters = {
  queueKey?: string;
  status?: string;
  type?: string;
  priority?: string;
  assignment?: "any" | "me" | "unassigned";
  breached?: "any" | "only";
  limit?: number;
  cursor?: string;
};

export function fetchQueue(filters: QueueFilters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const query = params.toString();
  return request(`${LEARNER_OPS_ENDPOINT}/cases${query ? `?${query}` : ""}`, queuePageSchema);
}

export function fetchCase(caseId: string) {
  return request(`${LEARNER_OPS_ENDPOINT}/cases/${encodeURIComponent(caseId)}`, caseDetailSchema);
}

export function fetchMessages(caseId: string) {
  return request(
    `${LEARNER_OPS_ENDPOINT}/cases/${encodeURIComponent(caseId)}/messages`,
    messagesPageSchema,
  );
}

export function fetchNotes(caseId: string) {
  return request(
    `${LEARNER_OPS_ENDPOINT}/cases/${encodeURIComponent(caseId)}/notes`,
    notesPageSchema,
  );
}

export function fetchEvents(caseId: string) {
  return request(
    `${LEARNER_OPS_ENDPOINT}/cases/${encodeURIComponent(caseId)}/events`,
    eventsPageSchema,
  );
}

export function fetchEscalations(caseId: string) {
  return request(
    `${LEARNER_OPS_ENDPOINT}/cases/${encodeURIComponent(caseId)}/escalations`,
    escalationsSchema,
  );
}

export function fetchConfig() {
  return request(`${LEARNER_OPS_ENDPOINT}/config`, configSchema);
}

export function fetchLearner360(userId: number) {
  return request(`${LEARNER_OPS_ENDPOINT}/learners/${userId}`, learner360Schema);
}

export function fetchAnalytics() {
  return request(`${LEARNER_OPS_ENDPOINT}/analytics`, analyticsSchema);
}

export function fetchKnowledge(params: { status?: string; search?: string } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  const suffix = query.toString();
  return request(
    `${LEARNER_OPS_ENDPOINT}/knowledge${suffix ? `?${suffix}` : ""}`,
    knowledgePageSchema,
  );
}

export function fetchKnowledgeArticle(slug: string) {
  return request(
    `${LEARNER_OPS_ENDPOINT}/knowledge/${encodeURIComponent(slug)}`,
    knowledgeArticleSchema,
  );
}

export function fetchVoc(params: { status?: string } = {}) {
  const query = params.status ? `?status=${encodeURIComponent(params.status)}` : "";
  return request(`${LEARNER_OPS_ENDPOINT}/voc${query}`, vocPageSchema);
}

export function fetchQaReviews() {
  return request(`${LEARNER_OPS_ENDPOINT}/qa`, qaPageSchema);
}

/* -------------------------------------------------------------- mutations */

const okSchema = z.unknown();

export function createCase(body: {
  userId: number;
  type: string;
  queueKey: string;
  subject: string;
  details: string;
  priority?: string;
  reasonCode?: string;
  reportSubmissionId?: number;
  userLevelProgressId?: number;
}) {
  return request(`${LEARNER_OPS_ENDPOINT}/cases`, okSchema, json(body));
}

/**
 * Every mutation below carries the version the operator's screen was showing.
 * The backend compares and swaps on it, so a stale screen produces a 409 the
 * caller must resolve by re-reading — never a silent overwrite of somebody
 * else's work.
 */
export function transitionCase(caseId: string, body: {
  expectedVersion: number;
  nextStatus: string;
  reason?: string;
}) {
  return request(
    `${LEARNER_OPS_ENDPOINT}/cases/${encodeURIComponent(caseId)}/status`,
    okSchema,
    json(body),
  );
}

export function assignCase(caseId: string, body: {
  expectedAssignmentVersion: number;
  targetStaffId: string | null;
  reason?: string;
}) {
  return request(
    `${LEARNER_OPS_ENDPOINT}/cases/${encodeURIComponent(caseId)}/assign`,
    okSchema,
    json(body),
  );
}

export function changePriority(caseId: string, body: {
  expectedVersion: number;
  nextPriority: string;
  reason?: string;
}) {
  return request(
    `${LEARNER_OPS_ENDPOINT}/cases/${encodeURIComponent(caseId)}/priority`,
    okSchema,
    json(body),
  );
}

/** Learner-VISIBLE. The separate `addNote` below never reaches the learner. */
export function sendMessage(caseId: string, body: string) {
  return request(
    `${LEARNER_OPS_ENDPOINT}/cases/${encodeURIComponent(caseId)}/messages`,
    okSchema,
    json({ body }),
  );
}

/** INTERNAL. A different endpoint, a different table, never learner-visible. */
export function addNote(caseId: string, body: string) {
  return request(
    `${LEARNER_OPS_ENDPOINT}/cases/${encodeURIComponent(caseId)}/notes`,
    okSchema,
    json({ body }),
  );
}

export function raiseEscalation(caseId: string, body: {
  class: string;
  reason: string;
  targetQueueKey?: string;
  targetStaffId?: string;
}) {
  return request(
    `${LEARNER_OPS_ENDPOINT}/cases/${encodeURIComponent(caseId)}/escalations`,
    okSchema,
    json(body),
  );
}

export function resolveEscalation(escalationId: string, body: {
  resolution: string;
  returnToOwner: boolean;
}) {
  return request(
    `${LEARNER_OPS_ENDPOINT}/escalations/${encodeURIComponent(escalationId)}/resolve`,
    okSchema,
    json(body),
  );
}

export function recordQa(caseId: string, body: {
  result: string;
  feedback?: string;
  coachingRequired: boolean;
}) {
  return request(
    `${LEARNER_OPS_ENDPOINT}/cases/${encodeURIComponent(caseId)}/qa`,
    okSchema,
    json(body),
  );
}

export function createVocSignal(body: { theme: string; category: string; severity: string }) {
  return request(`${LEARNER_OPS_ENDPOINT}/voc`, okSchema, json(body));
}

export function linkVocCase(signalId: string, caseId: string) {
  return request(
    `${LEARNER_OPS_ENDPOINT}/voc/${encodeURIComponent(signalId)}/cases`,
    okSchema,
    json({ caseId }),
  );
}

export function createKnowledgeArticle(body: {
  slug: string;
  title: string;
  body: string;
  status?: string;
}) {
  return request(`${LEARNER_OPS_ENDPOINT}/knowledge`, okSchema, json(body));
}
