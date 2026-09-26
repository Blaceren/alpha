/**
 * NEWS — the HTTP boundary shared by the public and the CRM news APIs.
 *
 * The envelope is the tools' one: `{ data }`, or `{ error, detail?, requestId }`
 * with an error from `NEWS_ERROR_STATUS`. Never a Prisma message or a stack.
 */
import { NextResponse } from "next/server";
import { crmRequestId } from "@/lib/crm/session";
import { NewsError, isNewsError } from "./news";

export const NEWS_NO_STORE = { "Cache-Control": "no-store" } as const;

export function newsData(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: NEWS_NO_STORE });
}

export function newsErrorResponse(error: unknown, context: string) {
  const requestId = crmRequestId();
  if (isNewsError(error)) {
    return NextResponse.json(
      { error: error.code, ...(error.detail ? { detail: error.detail } : {}), requestId },
      { status: error.status, headers: NEWS_NO_STORE },
    );
  }
  console.error(`[news] ${context}`, error);
  return NextResponse.json({ error: "NEWS_INTERNAL", requestId }, { status: 500, headers: NEWS_NO_STORE });
}

/** Only the named query parameters, each at most once. */
export function assertOnlyParams(params: URLSearchParams, allowed: readonly string[]): void {
  for (const key of params.keys()) {
    if (!allowed.includes(key)) throw new NewsError("NEWS_VALIDATION", "unexpected_query_parameter");
    if (params.getAll(key).length > 1) throw new NewsError("NEWS_VALIDATION", `invalid_${key}`);
  }
}

/** `?page=N`, 1 when absent; a page number is a whole number from 1 to 1000. */
export function parsePage(params: URLSearchParams): number {
  const raw = params.get("page");
  if (raw === null) return 1;
  if (!/^[1-9]\d{0,3}$/.test(raw) || Number(raw) > 1000) throw new NewsError("NEWS_VALIDATION", "invalid_page");
  return Number(raw);
}

export async function parseNewsJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new NewsError("NEWS_VALIDATION", "body_not_json");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new NewsError("NEWS_VALIDATION", "body_must_be_object");
  }
  return body as Record<string, unknown>;
}
