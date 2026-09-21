/**
 * NEWS — the CRM boundary.
 *
 * THE GATE. A CRM session on the StaffProfile axis (`resolveCrmSession`) whose
 * permissions include `news_publish`: the copywriter and `crm_admin`. The
 * `UserRole` column is not consulted, so the legacy `news_editor` role grants
 * nothing here on its own.
 *
 * WRITES also need the double-submit CSRF token (a failure is audited with the
 * route path only, never the body, the token or the cookie), are limited per
 * staff member, and are audited one row per change by the routes.
 *
 * Auth refusals keep the CRM's own envelope, `{ code, messageKey, requestId }`,
 * as every other `/api/crm/v1` route does; news refusals use the news envelope.
 */
import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import { canPublishNews } from "@/lib/crm/roles";
import { CrmAuthError, crmRequestId, resolveCrmSession } from "@/lib/crm/session";
import { validateCsrfToken } from "@/lib/csrf";
import { rateLimit } from "@/lib/rateLimit";
import { getSession } from "@/lib/session";
import { NewsError } from "./news";
import { NEWS_NO_STORE } from "./http";

export type NewsStaffGate =
  | { readonly actorUserId: number; readonly employeeId: string }
  | { readonly response: NextResponse };

/** A copywriter entering a week of releases in one sitting stays well inside this. */
const WRITE_LIMIT = { limit: 120, windowMs: 10 * 60 * 1000 } as const;

/** A news item's body is at most 20 000 characters; Cyrillic is two bytes each, plus the rest of the form. */
export const NEWS_MAX_BODY_BYTES = 96 * 1024;

function authRefusal(error: CrmAuthError): NextResponse {
  return NextResponse.json(
    { code: error.code, messageKey: error.messageKey, requestId: crmRequestId() },
    { status: error.status, headers: NEWS_NO_STORE },
  );
}

export async function requireNewsStaff(
  request: Request,
  options: { readonly mutation: boolean },
): Promise<NewsStaffGate> {
  try {
    const session = await resolveCrmSession();
    if (!canPublishNews(session.effectivePermissions)) throw new CrmAuthError(403, "crm.news.forbidden");

    if (options.mutation && !validateCsrfToken(request)) {
      const path = new URL(request.url).pathname;
      await createAuditLog({
        action: "CSRF_INVALID",
        entityType: "API_ROUTE",
        entityId: path,
        metadata: { path, method: request.method },
        request,
      });
      throw new CrmAuthError(403, "crm.news.csrf_invalid");
    }

    // The actor is recorded on the User axis, as every CRM write's audit row is.
    const actor = await getSession();
    if (!actor) throw new CrmAuthError(401, "crm.session.unauthenticated");
    return { actorUserId: actor.userId, employeeId: session.employeeId };
  } catch (error) {
    if (error instanceof CrmAuthError) return { response: authRefusal(error) };
    throw error;
  }
}

export function enforceNewsWriteLimit(actorUserId: number): void {
  if (!rateLimit(`news:write:${actorUserId}`, WRITE_LIMIT).allowed) throw new NewsError("NEWS_RATE_LIMITED");
}

/** The body as JSON, refused before parsing when it is larger than any real form. */
export async function readNewsBody(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text().catch(() => {
    throw new NewsError("NEWS_VALIDATION", "body_not_json");
  });
  if (Buffer.byteLength(raw, "utf8") > NEWS_MAX_BODY_BYTES) throw new NewsError("NEWS_VALIDATION", "body_too_large");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new NewsError("NEWS_VALIDATION", "body_not_json");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new NewsError("NEWS_VALIDATION", "body_must_be_object");
  }
  return body as Record<string, unknown>;
}

/** A cuid-shaped id, or the same 404 an unknown item gets. */
export function parseNewsId(raw: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(raw)) throw new NewsError("NEWS_NOT_FOUND");
  return raw;
}

/** The `updatedAt` the editor loaded, as the item's version token. */
export function parseExpectedUpdatedAt(raw: unknown): string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) {
    throw new NewsError("NEWS_VALIDATION", "invalid_updated_at");
  }
  return raw;
}

