/**
 * TOOLS-V2 — the HTTP boundary of the tool APIs.
 *
 * THE GATE. A tool belongs to a learner: `User.role === "user"` and
 * `status === "active"`, the same learner gate Community and Learner Operations
 * use. Identity comes only from the server-side session — a request can name a
 * card, never an owner. Mutations validate the double-submit CSRF token.
 *
 * TOOL DATA IS PRIVATE TO THE LEARNER (owner decision 2026-09-21): mentors and
 * support have no route here, and no staff gate exists in this module.
 */
import { NextResponse } from "next/server";
import { ApiAuthError, apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { crmRequestId } from "@/lib/crm/session";
import { rateLimit } from "@/lib/rateLimit";
import { ToolError, isToolError } from "./errors";

export const TOOL_NO_STORE = { "Cache-Control": "no-store" } as const;

export function toolData(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: TOOL_NO_STORE });
}

export function toolErrorResponse(error: unknown, context: string) {
  const requestId = crmRequestId();
  if (isToolError(error)) {
    return NextResponse.json(
      { error: error.code, ...(error.detail ? { detail: error.detail } : {}), requestId },
      { status: error.status, headers: TOOL_NO_STORE },
    );
  }
  console.error(`[tools] ${context}`, error);
  return NextResponse.json({ error: "TOOL_INTERNAL", requestId }, { status: 500, headers: TOOL_NO_STORE });
}

export type ToolLearnerGate = { readonly userId: number } | { readonly response: NextResponse };

export async function requireToolLearner(
  request: Request,
  options: { readonly mutation: boolean },
): Promise<ToolLearnerGate> {
  try {
    const user = await requireUser();
    if (user.role !== "user" || user.status !== "active") {
      return { response: await apiAuthErrorResponse(new ApiAuthError(403, user.id, user.role), request) };
    }
    if (options.mutation && !validateCsrfToken(request)) {
      return { response: await csrfFailureResponse(request) };
    }
    return { userId: user.id };
  } catch (error) {
    return { response: await apiAuthErrorResponse(error, request) };
  }
}

/** Per learner, per kind. In-memory like every limiter on this host. */
const LIMITS = {
  read: { limit: 120, windowMs: 10 * 60 * 1000 },
  write: { limit: 40, windowMs: 10 * 60 * 1000 },
} as const;

export function enforceToolRateLimit(userId: number, kind: keyof typeof LIMITS): void {
  if (!rateLimit(`tools:${kind}:${userId}`, LIMITS[kind]).allowed) throw new ToolError("TOOL_RATE_LIMITED");
}

export function assertNoQueryParams(request: Request): void {
  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    throw new ToolError("TOOL_VALIDATION", "unexpected_query_parameter");
  }
}

export async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ToolError("TOOL_VALIDATION", "body_not_json");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ToolError("TOOL_VALIDATION", "body_must_be_object");
  }
  return body as Record<string, unknown>;
}

/** A cuid-shaped id, or a 404: never a path, a query or a slash. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

export function validateCardId(raw: string): string {
  if (!ID_RE.test(raw)) throw new ToolError("TRADE_CARD_NOT_FOUND");
  return raw;
}
