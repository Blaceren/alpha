/**
 * TOOLS-V2 NEWS — the CRM's client for the news API.
 *
 * Same rules as every CRM client: same-origin, no-store, a timeout, a closed
 * outcome type, and a body is never rendered unless its schema parsed. Writes
 * carry the CSRF header, and a missing token abandons the write locally.
 * The backend re-checks `news_publish` on every call; nothing here is a gate.
 */
import { csrfHeaders } from "@/application/api/auth-client";
import {
  newsErrorSchema,
  newsItemResponseSchema,
  newsListResponseSchema,
  newsWriteResponseSchema,
  type NewsItem,
  type NewsList,
  type NewsReference,
  type NewsStatus,
} from "@/data/contracts/api/news";

export const NEWS_ENDPOINT = "/api/crm/v1/news";
export const NEWS_TIMEOUT_MS = 8_000;

export type NewsOutcome<T> =
  | { status: "success"; data: T }
  | { status: "invalid_input"; detail: string | null; requestId?: string }
  | { status: "stale"; requestId?: string }
  | { status: "not_found" }
  | { status: "unauthenticated" }
  | { status: "forbidden"; reason: "no_permission" | "csrf" }
  | { status: "rate_limited" }
  | { status: "upstream_unavailable" }
  | { status: "malformed_response" };

export interface NewsRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injection seam for tests; production always uses global fetch. */
  fetchImpl?: typeof fetch;
}

/** What the editor sends. The release is typed in `timeZone` and stored as one instant. */
export interface NewsForm {
  title: string;
  summary: string;
  body: string;
  country: string;
  importance: number;
  releaseDate: string;
  releaseTime: string;
  timeZone: string;
  forecast: string;
  previous: string;
  actual: string;
  sourceName: string;
  sourceUrl: string;
}

async function readRefusal(response: Response) {
  try {
    const parsed = newsErrorSchema.safeParse(await response.json());
    if (parsed.success) return parsed.data;
  } catch {
    /* no body */
  }
  return {};
}

async function request<T>(
  path: string,
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  init: RequestInit,
  options: NewsRequestOptions,
): Promise<NewsOutcome<T>> {
  const { fetchImpl = fetch } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? NEWS_TIMEOUT_MS);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await fetchImpl(path, { ...init, credentials: "same-origin", cache: "no-store", signal: controller.signal });
  } catch {
    return { status: "upstream_unavailable" };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) return { status: "unauthenticated" };
  if (response.status === 403) {
    const refusal = await readRefusal(response);
    return { status: "forbidden", reason: refusal.messageKey === "crm.news.csrf_invalid" ? "csrf" : "no_permission" };
  }
  if (response.status === 404) return { status: "not_found" };
  if (response.status === 409) return { status: "stale", requestId: (await readRefusal(response)).requestId };
  if (response.status === 429) return { status: "rate_limited" };
  if (response.status === 400) {
    const refusal = await readRefusal(response);
    return { status: "invalid_input", detail: refusal.detail ?? null, requestId: refusal.requestId };
  }
  if (!response.ok) return { status: "upstream_unavailable" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "malformed_response" };
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? { status: "success", data: parsed.data } : { status: "malformed_response" };
}

async function mutate<T>(
  path: string,
  schema: Parameters<typeof request<T>>[1],
  method: "POST" | "PATCH",
  body: unknown,
  options: NewsRequestOptions,
): Promise<NewsOutcome<T>> {
  const headers = await csrfHeaders({ fetchImpl: options.fetchImpl });
  if (!headers["x-csrf-token"]) return { status: "forbidden", reason: "csrf" };
  return request<T>(
    path,
    schema,
    { method, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) },
    options,
  );
}

function itemPath(id: string): string {
  return `${NEWS_ENDPOINT}/${encodeURIComponent(id)}`;
}

export type NewsFilter = "all" | NewsStatus;

export async function fetchNewsList(
  input: { status: NewsFilter; page: number },
  options: NewsRequestOptions = {},
): Promise<NewsOutcome<NewsList>> {
  const query = new URLSearchParams({ status: input.status, page: String(input.page) });
  const outcome = await request(`${NEWS_ENDPOINT}?${query}`, newsListResponseSchema, { method: "GET" }, options);
  return outcome.status === "success" ? { status: "success", data: outcome.data.data } : outcome;
}

export async function fetchNewsItem(
  id: string,
  options: NewsRequestOptions = {},
): Promise<NewsOutcome<{ item: NewsItem; reference: NewsReference }>> {
  const outcome = await request(itemPath(id), newsItemResponseSchema, { method: "GET" }, options);
  return outcome.status === "success" ? { status: "success", data: outcome.data.data } : outcome;
}

export async function createNewsItem(form: NewsForm, options: NewsRequestOptions = {}): Promise<NewsOutcome<NewsItem>> {
  const outcome = await mutate(NEWS_ENDPOINT, newsWriteResponseSchema, "POST", { item: form }, options);
  return outcome.status === "success" ? { status: "success", data: outcome.data.data.item } : outcome;
}

export async function updateNewsItem(
  id: string,
  form: NewsForm,
  expectedUpdatedAt: string,
  options: NewsRequestOptions = {},
): Promise<NewsOutcome<NewsItem>> {
  const outcome = await mutate(itemPath(id), newsWriteResponseSchema, "PATCH", { item: form, expectedUpdatedAt }, options);
  return outcome.status === "success" ? { status: "success", data: outcome.data.data.item } : outcome;
}

export async function setNewsItemStatus(
  id: string,
  status: NewsStatus,
  expectedUpdatedAt: string,
  options: NewsRequestOptions = {},
): Promise<NewsOutcome<NewsItem>> {
  const outcome = await mutate(`${itemPath(id)}/status`, newsWriteResponseSchema, "POST", { status, expectedUpdatedAt }, options);
  return outcome.status === "success" ? { status: "success", data: outcome.data.data.item } : outcome;
}
