/**
 * COMMUNITY-V1 — the browser client for Community moderation.
 *
 * RELATIVE PATH ONLY, allowlisted in `PROXIED_PATHS`. The browser never learns
 * the backend origin.
 *
 * THE CLIENT IS NOT A GATE. It sends what the moderator asked for; the backend
 * re-checks `community_moderate` on every request. Hiding a button here is a
 * convenience, never authorization — which is why the negative-control test
 * calls the API directly rather than looking for the button.
 */
import { z } from "zod";
import {
  communityErrorSchema,
  moderationQueueSchema,
  type CommunityModerationQueue,
} from "@/data/contracts/api/community-moderation";

export const COMMUNITY_MODERATION_ENDPOINT = "/api/crm/v1/community/moderation";
export const COMMUNITY_MODERATION_TIMEOUT_MS = 10_000;

export type Outcome<T> =
  | { status: "success"; data: T }
  | { status: "invalid_input"; detail?: string; requestId?: string }
  | { status: "unauthenticated"; requestId?: string }
  | { status: "forbidden"; requestId?: string }
  | { status: "not_found"; requestId?: string }
  | { status: "conflict"; detail?: string; requestId?: string }
  | { status: "unavailable" }
  | { status: "malformed_response" };

async function request<T extends z.ZodTypeAny>(
  schema: T,
  init?: RequestInit,
): Promise<Outcome<z.infer<T>>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMMUNITY_MODERATION_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(COMMUNITY_MODERATION_ENDPOINT, {
      ...init,
      signal: controller.signal,
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
      const parsed = communityErrorSchema.safeParse(await response.json());
      if (parsed.success) {
        requestId = parsed.data.requestId;
        detail = parsed.data.detail ?? undefined;
      }
    } catch {
      // An unparseable error body is still an error. The status decides.
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
    const parsed = schema.safeParse(body);
    if (!parsed.success) return { status: "malformed_response" };
    return { status: "success", data: parsed.data };
  } catch {
    return { status: "malformed_response" };
  }
}

export async function fetchModerationQueue(): Promise<Outcome<CommunityModerationQueue>> {
  const outcome = await request(moderationQueueSchema, { method: "GET" });
  return outcome.status === "success"
    ? { status: "success", data: outcome.data.data }
    : outcome;
}

export type ModerationCommand =
  | { action: "discussion.remove"; id: string; reason?: string }
  | { action: "discussion.restore"; id: string }
  | { action: "reply.remove"; id: string; reason?: string }
  | { action: "reply.restore"; id: string }
  | { action: "report.actioned"; id: string }
  | { action: "report.dismissed"; id: string };

export async function applyModerationCommand(
  command: ModerationCommand,
): Promise<Outcome<{ ok: true }>> {
  const outcome = await request(z.object({ data: z.object({ ok: z.literal(true) }) }), {
    method: "POST",
    body: JSON.stringify(command),
  });
  return outcome.status === "success" ? { status: "success", data: outcome.data.data } : outcome;
}
