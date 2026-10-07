import { proxyToBackend } from "@/server/proxy/backend-proxy";
import { isCrossSiteRequest } from "@/server/proxy/cross-site";
import { LEGACY_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/lib/auth/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * «Выйти» ALWAYS ENDS THE SESSION ON THIS DEVICE (2026-10-04, launch audit).
 *
 * The Backend revokes the session and expires the cookie when it accepts the
 * logout. When it does not — a rate limit, an outage — the Academy used to pass
 * the refusal on and the shell went to /login anyway, so the learner believed
 * they were out while the browser still held a valid session: on a shared
 * computer, the next person was signed in. Now a refused logout still expires
 * both session cookies here, with the Backend's own attributes; the server-side
 * session then simply lapses, and nobody on this browser can use it. (The CRM's
 * logout does the same.)
 */
export async function POST(request: Request): Promise<Response> {
  const response = await proxyToBackend(request, "logout");
  if (response.ok) return response;
  // A logout that another site's page asked for is refused, and changes nothing
  // on this device either (2026-10-07 audit).
  if (isCrossSiteRequest(request)) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`);
  headers.append("set-cookie", `${LEGACY_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
