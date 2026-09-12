/**
 * Server-side Curriculum V2 reads (SERVER-ONLY).
 *
 * SSR reads the learner's server-authoritative curriculum/progress by calling
 * the Backend directly (server-to-server), forwarding the httpOnly session
 * cookie via next/headers — the same trust boundary as the CI-1 guard. The
 * browser-facing same-origin proxy (/api/backend/curriculum/*) is the client
 * seam and is unit-tested separately. Progress reads are always no-store.
 */
import { cookies } from "next/headers";
import { getAcademyConfig } from "@/config/academy-config";
import { sessionCookieHeader } from "@/lib/auth/constants";
import { REQUEST_ID_HEADER } from "@/lib/api/errors";
import {
  isBackendCurriculumEnvelope,
  isBackendLevelContentEnvelope,
  type BackendCurriculumRead,
  type BackendLevelContent,
} from "@/lib/curriculum/backend-dto";
import {
  categorizeContentHttp,
  categorizeCurrentHttp,
  makeReadError,
  type ContentUnavailable,
  type CurriculumReadError,
} from "@/lib/curriculum/read-errors";

type RawResponse =
  | { kind: "response"; status: number; body: unknown; requestId: string | null }
  | { kind: "network"; aborted: boolean };

async function backendGet(path: string): Promise<RawResponse | { kind: "config" }> {
  const config = getAcademyConfig();
  if (config.mode !== "api" || !config.backendOrigin) return { kind: "config" };

  const cookieStore = await cookies();
  const session = sessionCookieHeader((name) => cookieStore.get(name));
  const headers = new Headers({ accept: "application/json" });
  if (session) headers.set("cookie", session);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.backendOrigin}${path}`, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    const requestId = response.headers.get(REQUEST_ID_HEADER);
    const contentType = response.headers.get("content-type") ?? "";
    let body: unknown = null;
    if (contentType.toLowerCase().includes("application/json")) {
      const text = await response.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { kind: "response", status: response.status, body, requestId };
  } catch (error) {
    return { kind: "network", aborted: error instanceof Error && error.name === "AbortError" };
  } finally {
    clearTimeout(timeout);
  }
}

export type CurrentReadResult =
  | { ok: true; read: BackendCurriculumRead }
  | { ok: false; error: CurriculumReadError };

export async function readCurriculumCurrent(): Promise<CurrentReadResult> {
  const raw = await backendGet("/api/curriculum/v2/current");
  if (raw.kind === "config") return { ok: false, error: makeReadError("CONFIGURATION_ERROR") };
  if (raw.kind === "network") {
    return { ok: false, error: makeReadError(raw.aborted ? "NETWORK_ERROR" : "BACKEND_UNAVAILABLE") };
  }
  if (raw.status !== 200) {
    return { ok: false, error: categorizeCurrentHttp(raw.status, raw.body, raw.requestId) };
  }
  if (!isBackendCurriculumEnvelope(raw.body)) {
    return { ok: false, error: makeReadError("MALFORMED_RESPONSE", { status: 200, requestId: raw.requestId }) };
  }
  return { ok: true, read: raw.body.data };
}

export type ContentReadResult =
  | { ok: true; content: BackendLevelContent }
  | { ok: false; reason: ContentUnavailable };

export async function readLevelContent(stableCode: string, locale: string): Promise<ContentReadResult> {
  const path = `/api/curriculum/v2/levels/${encodeURIComponent(stableCode)}/content?locale=${encodeURIComponent(locale)}`;
  const raw = await backendGet(path);
  if (raw.kind === "config") return { ok: false, reason: "unavailable" };
  if (raw.kind === "network") return { ok: false, reason: "unavailable" };
  if (raw.status !== 200) return { ok: false, reason: categorizeContentHttp(raw.status, raw.body) };
  if (!isBackendLevelContentEnvelope(raw.body)) return { ok: false, reason: "unavailable" };
  return { ok: true, content: raw.body.data };
}
