/**
 * The learner's Community client.
 *
 * Same shape as every other learner API client here: relative paths through the
 * `/api/backend` same-origin proxy, a CSRF token bootstrapped per mutation, a
 * bounded JSON read, and a NORMALIZED error rather than a thrown exception.
 *
 * ACCESS IS NOT DECIDED HERE. `canRead`, `canWrite` and `lockedReason` arrive
 * already resolved from the one Backend owner. This file has no threshold
 * constant, no level arithmetic and no space list — a second copy of the gating
 * rule in the browser is exactly what the product contract forbids, and the
 * browser is not given the inputs it would need to build one.
 */
import { makeError, normalizeHttpError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

const PROXY_BASE = "/api/backend";
const MAX_RESPONSE_BYTES = 512 * 1024;

/** Why a space is closed. Mirrors the Backend's closed vocabulary. */
export type CommunityLockReason =
  | "not_enrolled"
  | "level_incomplete"
  | "write_level_incomplete"
  | "progression_unavailable";

export type CommunityAuthor = {
  id: number;
  displayName: string;
  roleLabel: string | null;
  moduleNumber: number | null;
  isViewer: boolean;
};

export type CommunityBody =
  | { kind: "visible"; text: string }
  | { kind: "removed"; removedBy: "author" | "moderator" };

export type CommunityDiscussionSummary = {
  id: string;
  title: string;
  author: CommunityAuthor;
  createdAt: string;
  lastActivityAt: string;
  replyCount: number;
  isRemoved: boolean;
  spaceCode?: string;
  spaceTitle?: string;
};

export type CommunitySpaceSummary = {
  code: string;
  title: string;
  purpose: string;
  canRead: boolean;
  canWrite: boolean;
  lockedReason: CommunityLockReason | null;
  requiredModuleNumber: number | null;
  /** The discussions this plate shows. Empty for a space the learner cannot read. */
  preview: CommunityDiscussionSummary[];
};

export type CommunityOverview = {
  enrolled: boolean;
  currentModuleNumber: number | null;
  completedLevels: number;
  isModerator: boolean;
  spaces: CommunitySpaceSummary[];
};

export type CommunitySpaceView = {
  space: {
    code: string;
    title: string;
    purpose: string;
    canWrite: boolean;
    lockedReason: CommunityLockReason | null;
    requiredModuleNumber: number | null;
  };
  discussions: CommunityDiscussionSummary[];
};

export type CommunityReplyView = {
  id: string;
  author: CommunityAuthor;
  body: CommunityBody;
  createdAt: string;
  canRemove: boolean;
  canReport: boolean;
};

export type CommunityThreadView = {
  discussion: {
    id: string;
    title: string;
    author: CommunityAuthor;
    body: CommunityBody;
    createdAt: string;
    canRemove: boolean;
    canReport: boolean;
  };
  space: { code: string; title: string; canWrite: boolean };
  replies: CommunityReplyView[];
};

export type CommunityResult<T> = { ok: true; data: T } | { ok: false; error: NormalizedError };

async function readBoundedJson(
  response: Response,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const raw = await response.arrayBuffer();
    if (raw.byteLength > MAX_RESPONSE_BYTES) return { ok: false };
    if (raw.byteLength === 0) return { ok: true, value: undefined };
    return { ok: true, value: JSON.parse(new TextDecoder().decode(raw)) as unknown };
  } catch {
    return { ok: false };
  }
}

async function fetchCsrfToken(
  signal?: AbortSignal,
): Promise<{ ok: true; token: string } | { ok: false; error: NormalizedError }> {
  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/csrf`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  const parsed = await readBoundedJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: normalizeHttpError({ status: response.status, body: parsed.ok ? parsed.value : undefined, requestId }),
    };
  }
  const token =
    parsed.ok && typeof parsed.value === "object" && parsed.value !== null
      ? (parsed.value as { csrfToken?: unknown }).csrfToken
      : undefined;
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE") };
  }
  return { ok: true, token };
}

async function readEnvelope<T>(
  response: Response,
  guard: (value: unknown) => value is T,
): Promise<CommunityResult<T>> {
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  const parsed = await readBoundedJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: normalizeHttpError({ status: response.status, body: parsed.ok ? parsed.value : undefined, requestId }),
    };
  }
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { requestId }) };
  }
  const data = (parsed.value as { data?: unknown }).data;
  if (!guard(data)) return { ok: false, error: makeError("MALFORMED_RESPONSE", { requestId }) };
  return { ok: true, data };
}

/* ------------------------------------------------------------------ guards */

function isAuthor(value: unknown): value is CommunityAuthor {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "number" &&
    typeof row.displayName === "string" &&
    (row.roleLabel === null || typeof row.roleLabel === "string") &&
    (row.moduleNumber === null || typeof row.moduleNumber === "number") &&
    typeof row.isViewer === "boolean"
  );
}

function isBody(value: unknown): value is CommunityBody {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (row.kind === "visible") return typeof row.text === "string";
  if (row.kind === "removed") return row.removedBy === "author" || row.removedBy === "moderator";
  return false;
}

function isDiscussionSummary(value: unknown): value is CommunityDiscussionSummary {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.title === "string" &&
    isAuthor(row.author) &&
    typeof row.createdAt === "string" &&
    typeof row.lastActivityAt === "string" &&
    typeof row.replyCount === "number" &&
    typeof row.isRemoved === "boolean"
  );
}

function isSpaceSummary(value: unknown): value is CommunitySpaceSummary {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.code === "string" &&
    typeof row.title === "string" &&
    typeof row.purpose === "string" &&
    typeof row.canRead === "boolean" &&
    typeof row.canWrite === "boolean" &&
    (row.lockedReason === null || typeof row.lockedReason === "string") &&
    (row.requiredModuleNumber === null || typeof row.requiredModuleNumber === "number") &&
    Array.isArray(row.preview) &&
    row.preview.every(isDiscussionSummary)
  );
}

function isReply(value: unknown): value is CommunityReplyView {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    isAuthor(row.author) &&
    isBody(row.body) &&
    typeof row.createdAt === "string" &&
    typeof row.canRemove === "boolean" &&
    typeof row.canReport === "boolean"
  );
}

/* ------------------------------------------------------------------- reads */

export async function fetchCommunityOverview(
  signal?: AbortSignal,
): Promise<CommunityResult<CommunityOverview>> {
  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/community/overview`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }
  return readEnvelope(response, (value): value is CommunityOverview => {
    if (typeof value !== "object" || value === null) return false;
    const row = value as Record<string, unknown>;
    return (
      typeof row.enrolled === "boolean" &&
      Array.isArray(row.spaces) &&
      row.spaces.every(isSpaceSummary)
    );
  });
}

export async function fetchCommunitySpace(
  spaceCode: string,
  signal?: AbortSignal,
): Promise<CommunityResult<CommunitySpaceView>> {
  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/community/spaces/${encodeURIComponent(spaceCode)}`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }
  return readEnvelope(response, (value): value is CommunitySpaceView => {
    if (typeof value !== "object" || value === null) return false;
    const row = value as Record<string, unknown>;
    const space = row.space as Record<string, unknown> | undefined;
    return (
      typeof space === "object" &&
      space !== null &&
      typeof space.code === "string" &&
      typeof space.title === "string" &&
      typeof space.canWrite === "boolean" &&
      Array.isArray(row.discussions) &&
      row.discussions.every(isDiscussionSummary)
    );
  });
}

export async function fetchCommunityThread(
  discussionId: string,
  signal?: AbortSignal,
): Promise<CommunityResult<CommunityThreadView>> {
  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/community/discussions/${encodeURIComponent(discussionId)}`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }
  return readEnvelope(response, (value): value is CommunityThreadView => {
    if (typeof value !== "object" || value === null) return false;
    const row = value as Record<string, unknown>;
    const discussion = row.discussion as Record<string, unknown> | undefined;
    return (
      typeof discussion === "object" &&
      discussion !== null &&
      typeof discussion.id === "string" &&
      typeof discussion.title === "string" &&
      isAuthor(discussion.author) &&
      isBody(discussion.body) &&
      Array.isArray(row.replies) &&
      row.replies.every(isReply)
    );
  });
}

/* -------------------------------------------------------------- mutations */

async function postJson<T>(
  path: string,
  payload: unknown,
  guard: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<CommunityResult<T>> {
  const csrf = await fetchCsrfToken(signal);
  if (!csrf.ok) return { ok: false, error: csrf.error };

  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-csrf-token": csrf.token,
      },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(payload),
      signal,
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }
  return readEnvelope(response, guard);
}

export async function createDiscussion(
  spaceCode: string,
  input: { title: string; body: string },
  signal?: AbortSignal,
): Promise<CommunityResult<{ id: string; deduplicated: boolean }>> {
  return postJson(
    `/community/spaces/${encodeURIComponent(spaceCode)}/discussions`,
    input,
    (value): value is { id: string; deduplicated: boolean } =>
      typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string",
    signal,
  );
}

export async function createReply(
  discussionId: string,
  body: string,
  signal?: AbortSignal,
): Promise<CommunityResult<{ id: string; deduplicated: boolean }>> {
  return postJson(
    `/community/discussions/${encodeURIComponent(discussionId)}/replies`,
    { body },
    (value): value is { id: string; deduplicated: boolean } =>
      typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string",
    signal,
  );
}

export type ReportReason = "spam" | "off_topic" | "abuse" | "other";

export async function reportContent(
  target: { discussionId: string } | { replyId: string },
  reason: ReportReason,
  note: string | undefined,
  signal?: AbortSignal,
): Promise<CommunityResult<{ received: true }>> {
  return postJson(
    "/community/content/report",
    { ...target, reason, note },
    (value): value is { received: true } =>
      typeof value === "object" && value !== null && (value as { received?: unknown }).received === true,
    signal,
  );
}

export async function removeOwnContent(
  target: { discussionId: string } | { replyId: string },
  signal?: AbortSignal,
): Promise<CommunityResult<{ removed: true }>> {
  return postJson(
    "/community/content/remove",
    target,
    (value): value is { removed: true } =>
      typeof value === "object" && value !== null && (value as { removed?: unknown }).removed === true,
    signal,
  );
}
