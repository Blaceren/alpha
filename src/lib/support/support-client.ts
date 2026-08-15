/**
 * The learner's support client.
 *
 * Same shape as every other learner API client here: relative paths through the
 * `/api/backend` same-origin proxy, a CSRF token bootstrapped per mutation, a
 * bounded JSON read, and a NORMALIZED error rather than a thrown exception.
 *
 * WHAT THE LEARNER CAN ASK FOR, AND IT IS THE WHOLE SURFACE. List my requests,
 * open one, read one of mine, reply to one of mine. There is no parameter that
 * names another learner, no parameter that names a queue, a priority or a
 * reason code, and no route that returns an internal note — the Backend does
 * not expose one and the proxy could not forward it if it did.
 */
import { makeError, normalizeHttpError, REQUEST_ID_HEADER, type NormalizedError } from "@/lib/api/errors";

const PROXY_BASE = "/api/backend";
const MAX_RESPONSE_BYTES = 512 * 1024;

export type SupportCaseSummary = {
  id: string;
  reference: string;
  type: string;
  status: string;
  subject: string;
  openedAt: string;
  lastActivityAt: string;
  resolvedAt: string | null;
};

export type SupportMessage = {
  id: string;
  authorKind: "staff" | "learner";
  authorName: string;
  body: string;
  createdAt: string;
};

export type SupportCaseDetail = SupportCaseSummary & {
  details: string;
  messages: SupportMessage[];
};

export type SupportResult<T> = { ok: true; data: T } | { ok: false; error: NormalizedError };

async function readBoundedJson(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
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
      error: normalizeHttpError({
        status: response.status,
        body: parsed.ok ? parsed.value : undefined,
        requestId,
      }),
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

function isSummary(value: unknown): value is SupportCaseSummary {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.reference === "string" &&
    typeof row.type === "string" &&
    typeof row.status === "string" &&
    typeof row.subject === "string" &&
    typeof row.openedAt === "string" &&
    typeof row.lastActivityAt === "string"
  );
}

function isMessage(value: unknown): value is SupportMessage {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    (row.authorKind === "staff" || row.authorKind === "learner") &&
    typeof row.authorName === "string" &&
    typeof row.body === "string" &&
    typeof row.createdAt === "string"
  );
}

async function readEnvelope<T>(
  response: Response,
  guard: (value: unknown) => value is T,
): Promise<SupportResult<T>> {
  const requestId = response.headers.get(REQUEST_ID_HEADER);
  const parsed = await readBoundedJson(response);
  if (!response.ok) {
    return {
      ok: false,
      error: normalizeHttpError({
        status: response.status,
        body: parsed.ok ? parsed.value : undefined,
        requestId,
      }),
    };
  }
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE", { requestId }) };
  }
  const data = (parsed.value as { data?: unknown }).data;
  if (!guard(data)) return { ok: false, error: makeError("MALFORMED_RESPONSE", { requestId }) };
  return { ok: true, data };
}

export async function listSupportCases(
  signal?: AbortSignal,
): Promise<SupportResult<SupportCaseSummary[]>> {
  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/support/cases`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }
  return readEnvelope(response, (value): value is SupportCaseSummary[] => {
    if (typeof value !== "object" || value === null) return false;
    const items = (value as { items?: unknown }).items;
    return Array.isArray(items) && items.every(isSummary);
  }).then((result) =>
    result.ok
      ? { ok: true as const, data: (result.data as unknown as { items: SupportCaseSummary[] }).items }
      : result,
  );
}

export async function getSupportCase(
  caseId: string,
  signal?: AbortSignal,
): Promise<SupportResult<SupportCaseDetail>> {
  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/support/cases/${encodeURIComponent(caseId)}`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }
  return readEnvelope(response, (value): value is SupportCaseDetail => {
    if (!isSummary(value)) return false;
    const row = value as unknown as Record<string, unknown>;
    return (
      typeof row.details === "string" && Array.isArray(row.messages) && row.messages.every(isMessage)
    );
  });
}

export async function openSupportCase(
  input: { subject: string; details: string },
  signal?: AbortSignal,
): Promise<SupportResult<{ id: string; reference: string }>> {
  const csrf = await fetchCsrfToken(signal);
  if (!csrf.ok) return { ok: false, error: csrf.error };

  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}/support/cases`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-csrf-token": csrf.token,
      },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(input),
      signal,
    });
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }
  return readEnvelope(response, (value): value is { id: string; reference: string } => {
    if (typeof value !== "object" || value === null) return false;
    const row = value as Record<string, unknown>;
    return typeof row.id === "string" && typeof row.reference === "string";
  });
}

export async function replyToSupportCase(
  caseId: string,
  body: string,
  signal?: AbortSignal,
): Promise<SupportResult<{ id: string }>> {
  const csrf = await fetchCsrfToken(signal);
  if (!csrf.ok) return { ok: false, error: csrf.error };

  let response: Response;
  try {
    response = await fetch(
      `${PROXY_BASE}/support/cases/${encodeURIComponent(caseId)}/messages`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-csrf-token": csrf.token,
        },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ body }),
        signal,
      },
    );
  } catch {
    return { ok: false, error: makeError("NETWORK_ERROR") };
  }
  return readEnvelope(response, (value): value is { id: string } => {
    if (typeof value !== "object" || value === null) return false;
    return typeof (value as Record<string, unknown>).id === "string";
  });
}
