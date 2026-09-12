import { NextResponse } from "next/server";
import { CsrfTokenSchema } from "@/data/contracts/api/auth";
import { BACKEND_PATHS, callBackend } from "@/server/backend-client";
import { applyBridgedCookies, noStoreJson } from "@/server/auth-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/crm/auth/csrf
 *
 * Same-origin front door for the backend's double-submit CSRF token. It forwards
 * `GET /api/csrf`, bridges the `trading_platform_csrf` cookie onto the CRM
 * origin, and echoes the token in the body.
 *
 * Both halves are needed and neither is redundant: the cookie is what the
 * backend compares against, and the body is how the client learns the value
 * without having to read the cookie. Reading it from the body is also why this
 * works unchanged if the cookie ever becomes HttpOnly.
 *
 * This is a GET that mints a token, so it is deliberately uncached
 * (`force-dynamic` + `no-store`): a cached CSRF token shared between employees
 * would defeat the whole scheme.
 */
export async function GET() {
  const result = await callBackend({ path: BACKEND_PATHS.csrf, method: "GET" });

  if (result.status === "misconfigured") {
    return noStoreJson({ code: "server_error" }, 500);
  }
  if (result.status === "unreachable") {
    return noStoreJson({ code: "upstream_unavailable" }, 503);
  }

  const parsed = CsrfTokenSchema.safeParse(result.body);
  if (result.httpStatus !== 200 || !parsed.success) {
    // A CSRF endpoint that answers with anything but a well-formed token is not
    // something to improvise around: without a valid token every write would
    // fail at the backend anyway, so fail closed and let the caller retry.
    return noStoreJson({ code: "upstream_unavailable" }, 503);
  }

  const response = NextResponse.json(parsed.data, {
    headers: { "Cache-Control": "no-store" },
  });
  return applyBridgedCookies(response, result.cookies);
}
